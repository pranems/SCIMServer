/**
 * EndpointScimGenericService - Phase 8b Generic SCIM Resource Service
 *
 * Handles CRUD operations for custom resource types registered via the
 * Admin API. Resources are stored in the polymorphic ScimResource table
 * with the custom resourceType discriminator.
 *
 * Full RFC 7643/7644 attribute characteristic parity with User/Group services:
 *   - Schema-driven payload validation (StrictSchemaValidation)
 *   - Immutable attribute enforcement on PUT/PATCH
 *   - Boolean string coercion (AllowAndCoerceBooleanStrings)
 *   - Attribute projection (attributes/excludedAttributes query params)
 *   - externalId + displayName uniqueness enforcement (always 409 on conflict)
 *   - UserSoftDeleteEnabled / UserHardDeleteEnabled / GroupHardDeleteEnabled gates
 *   - sanitizeBooleanStringsByParent on output
 *   - returned:never stripping on output
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IGenericResourceRepository } from '../../../domain/repositories/generic-resource.repository.interface';
import type {
  GenericResourceRecord,
  GenericResourceCreateInput,
} from '../../../domain/models/generic-resource.model';
import { GENERIC_RESOURCE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import {
  getConfigBoolean,
  getConfigString,
  ENDPOINT_CONFIG_FLAGS,
  type EndpointConfig,
} from '../../endpoint/endpoint-config.interface';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { createScimError } from '../common/scim-errors';
// assertIfMatch replaced by enforceIfMatch for RequireIfMatch 428 parity
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_SCHEMA,
} from '../common/scim-constants';
import {
  parseJson,
  ensureSchema,
  enforceIfMatch,
  sanitizeBooleanStringsByParent,
  coercePatchOpBooleans,
  stripNeverReturnedFromPayload,
  stripReadOnlyAttributes,
  stripReadOnlyPatchOps,
  assertSchemaUniqueness,
  handleRepositoryError,
} from '../common/scim-service-helpers';
import { SchemaValidator } from '../../../domain/validation';
import type { SchemaDefinition, SchemaAttributeDefinition, SchemaCharacteristicsCache } from '../../../domain/validation';
import { ScimMetadataService } from './scim-metadata.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimResourceType } from '../discovery/scim-schema-registry';
import { GenericPatchEngine } from '../../../domain/patch/generic-patch-engine';
import { PatchError } from '../../../domain/patch/patch-error';
import type { PatchOperation } from '../../../domain/patch/patch-types';
import { parseScimFilter, extractFilterPaths } from '../filters/scim-filter-parser';
import { buildGenericFilter } from '../filters/apply-scim-filter';

interface ListGenericParams {
  filter?: string;
  startIndex?: number;
  count?: number;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
}

interface PatchDto {
  schemas: string[];
  Operations: PatchOperation[];
}

@Injectable()
export class EndpointScimGenericService {

  constructor(
    @Inject(GENERIC_RESOURCE_REPOSITORY)
    private readonly genericRepo: IGenericResourceRepository,
    private readonly metadata: ScimMetadataService,
    private readonly scimLogger: ScimLogger,
    private readonly schemaRegistry: ScimSchemaRegistry,
    private readonly endpointContext: EndpointContextStorage,
  ) {}

  /**
   * Build schema definitions for a dynamic resource type.
   * Unlike Users/Groups which have fixed core URNs, generic resources
   * resolve schemas from the registered resource type at runtime.
   *
   * Profile-aware: when a profile is set in context, profile schemas are
   * preferred (they include custom extension attribute characteristics).
   */
  private getSchemaDefinitions(
    resourceType: ScimResourceType,
    endpointId: string,
  ): SchemaDefinition[] {
    const profile = this.endpointContext.getProfile?.();
    const profileSchemaMap = new Map<string, any>();
    if (profile?.schemas) {
      for (const ps of profile.schemas) {
        if (ps.id) profileSchemaMap.set(ps.id, ps);
      }
    }

    const schemas: SchemaDefinition[] = [];

    // Core schema: prefer profile version, fall back to global registry
    const profileCore = profileSchemaMap.get(resourceType.schema);
    if (profileCore && Array.isArray(profileCore.attributes)) {
      schemas.push({
        id: profileCore.id,
        attributes: profileCore.attributes as unknown as SchemaAttributeDefinition[],
        isCoreSchema: true,
      });
    } else {
      const coreDef = this.schemaRegistry.getSchema(resourceType.schema);
      if (coreDef) schemas.push({ ...coreDef, isCoreSchema: true } as SchemaDefinition);
    }

    // Extension schemas from the resource type
    for (const ext of resourceType.schemaExtensions) {
      const profileExt = profileSchemaMap.get(ext.schema);
      if (profileExt && Array.isArray(profileExt.attributes)) {
        schemas.push({
          id: profileExt.id,
          attributes: profileExt.attributes as unknown as SchemaAttributeDefinition[],
        });
      } else {
        const extDef = this.schemaRegistry.getSchema(ext.schema);
        if (extDef) schemas.push(extDef as SchemaDefinition);
      }
    }

    return schemas;
  }

  // ─── CREATE ────────────────────────────────────────────────────────────

  async createResource(
    body: Record<string, unknown>,
    baseUrl: string,
    endpointId: string,
    resourceType: ScimResourceType,
    config?: EndpointConfig,
  ): Promise<Record<string, unknown>> {
    this.scimLogger.enrichContext({ resourceType: resourceType.name, operation: 'create' });
    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Creating ${resourceType.name}`, { endpointId });
    const coreSchema = resourceType.schema;

    // GEN-11: Validate schemas array includes the core schema (same as ensureSchema)
    ensureSchema(body.schemas as string[] | undefined, coreSchema);

    // GEN-11: Strict schema enforcement - reject undeclared/unregistered extension URNs
    this.enforceStrictSchemaValidation(body, resourceType, endpointId, config);

    // GEN-03: Coerce boolean strings ("True"/"False") → native booleans before validation
    this.coerceBooleanStringsIfEnabled(body, resourceType, endpointId, config);

    // G8h: Enforce primary sub-attribute constraint (RFC 7643 section 2.4)
    this.enforcePrimaryConstraint(body, resourceType, endpointId, config);

    // GEN-01: Attribute-level payload validation against schema definitions
    this.validatePayloadSchema(body, resourceType, endpointId, config, 'create');

    // Strip readOnly attributes using precomputed cache (RFC 7643 §2.2)
    const readOnlyCache = this.getSchemaCacheForRT(resourceType, endpointId)?.readOnlyCollected;
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    const strippedAttrs = stripReadOnlyAttributes(body, schemaDefs, readOnlyCache);
    if (strippedAttrs.length > 0) {
      this.scimLogger.warn(LogCategory.SCIM_RESOURCE, 'Stripped readOnly attributes from POST payload', {
        method: 'POST', path: resourceType.endpoint, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

    const externalId = typeof body.externalId === 'string' ? body.externalId : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const active = body.active !== false;

    // externalId and displayName are NOT checked for uniqueness - saved as received per RFC 7643.

    const scimId = randomUUID();

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrs = this.getSchemaCacheForRT(resourceType, endpointId)?.uniqueAttrs ?? [];
    if (uniqueAttrs.length > 0) {
      const allResources = await this.genericRepo.findAll(endpointId, resourceType.name);
      assertSchemaUniqueness(endpointId, body, uniqueAttrs, allResources.map(r => ({ scimId: r.scimId, rawPayload: r.rawPayload })));
    }

    const now = this.metadata.currentIsoTimestamp();
    const location = this.metadata.buildLocation(
      baseUrl,
      resourceType.endpoint.replace(/^\//, ''),
      scimId,
    );

    const metaObj = {
      resourceType: resourceType.name,
      created: now,
      lastModified: now,
      location,
      version: 'W/"1"',
    };

    const payload: Record<string, unknown> = { ...body };
    delete payload.schemas; // structural key, never stored in payload

    const input: GenericResourceCreateInput = {
      endpointId,
      resourceType: resourceType.name,
      scimId,
      externalId,
      displayName,
      active,
      rawPayload: JSON.stringify(payload),
      meta: JSON.stringify(metaObj),
    };

    let record;
    try {
      record = await this.genericRepo.create(input);
    } catch (error) {
      handleRepositoryError(error, `create ${resourceType.name}`, this.scimLogger, LogCategory.SCIM_RESOURCE, { scimId, endpointId });
    }

    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Created ${resourceType.name}`, {
      scimId,
      endpointId,
      resourceType: resourceType.name,
    });

    return this.toScimResponse(record, resourceType);
  }

  // ─── READ ──────────────────────────────────────────────────────────────

  async getResource(
    scimId: string,
    baseUrl: string,
    endpointId: string,
    resourceType: ScimResourceType,
    config?: EndpointConfig,
  ): Promise<Record<string, unknown>> {
    this.scimLogger.enrichContext({ resourceType: resourceType.name, resourceId: scimId, operation: 'get' });
    this.scimLogger.debug(LogCategory.SCIM_RESOURCE, `Get ${resourceType.name}`, { scimId, endpointId });
    const record = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!record) {
      this.scimLogger.debug(LogCategory.SCIM_RESOURCE, `${resourceType.name} not found`, { scimId, endpointId });
      throw createScimError({
        status: 404,
        scimType: 'noTarget',
        detail: `${resourceType.name} "${scimId}" not found.`,
        diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' },
      });
    }

    // GEN-12: Config-aware soft-delete guard (RFC 7644 §3.6)
    // [Removed in Settings v7: deletedAt no longer exists - DELETE always hard-deletes]

    return this.toScimResponse(record, resourceType);
  }

  // ─── LIST ──────────────────────────────────────────────────────────────

  async listResources(
    params: ListGenericParams,
    baseUrl: string,
    endpointId: string,
    resourceType: ScimResourceType,
    config?: EndpointConfig,
  ): Promise<Record<string, unknown>> {
    this.scimLogger.enrichContext({ resourceType: resourceType.name, operation: 'list' });
    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `List ${resourceType.name}`, { endpointId, filter: params.filter });
    const startIndex = Math.max(params.startIndex ?? 1, 1);
    const count = Math.min(Math.max(params.count ?? DEFAULT_COUNT, 0), MAX_COUNT);

    // Validate filter attribute paths against schema definitions (RFC 7644 §3.4.2.2)
    if (params.filter) {
      this.validateFilterAttributePaths(params.filter, resourceType, endpointId);
    }

    // RFC 7644 §3.4.2.2: Full AST-based filter with DB push-down + in-memory fallback
    const caseExactAttrs = this.getSchemaCacheForRT(resourceType, endpointId)?.caseExactPaths;
    let filterResult: ReturnType<typeof buildGenericFilter>;
    try {
      filterResult = buildGenericFilter(params.filter, caseExactAttrs);
    } catch (e) {
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: `Invalid or unsupported filter expression: '${params.filter}'.`,
        diagnostics: { errorCode: 'FILTER_INVALID', parseError: (e as Error).message, filterExpression: params.filter },
      });
    }

    let records = await this.genericRepo.findAll(
      endpointId,
      resourceType.name,
      filterResult.fetchAll ? undefined : filterResult.dbWhere,
    );

    // Convert to SCIM representation for in-memory filtering + response
    let resources = records.map((r) => this.toScimResponse(r, resourceType));

    // Apply in-memory filter when the filter couldn't be fully pushed to DB
    if (filterResult.inMemoryFilter) {
      resources = resources.filter(filterResult.inMemoryFilter);
    }

    // In-memory sort for generic resources (RFC 7644 §3.4.2.3)
    if (params.sortBy) {
      const sortField = params.sortBy.toLowerCase();
      const direction = params.sortOrder === 'descending' ? -1 : 1;
      // Map SCIM attribute names to record fields
      const fieldMap: Record<string, string> = {
        id: 'id',
        externalid: 'externalId',
        displayname: 'displayName',
        'meta.created': 'meta.created',
        'meta.lastmodified': 'meta.lastModified',
      };
      const mappedField = fieldMap[sortField] ?? sortField;
      resources.sort((a, b) => {
        const va = String(this.resolveNestedValue(a, mappedField) ?? '');
        const vb = String(this.resolveNestedValue(b, mappedField) ?? '');
        return va.localeCompare(vb) * direction;
      });
    }

    const totalResults = resources.length;
    const pageResources = resources.slice(startIndex - 1, startIndex - 1 + count);

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: pageResources.length,
      Resources: pageResources,
    };
  }

  // ─── UPDATE (PUT) ─────────────────────────────────────────────────────

  async replaceResource(
    scimId: string,
    body: Record<string, unknown>,
    baseUrl: string,
    endpointId: string,
    resourceType: ScimResourceType,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<Record<string, unknown>> {
    this.scimLogger.enrichContext({ resourceType: resourceType.name, resourceId: scimId, operation: 'replace' });
    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Replace ${resourceType.name} (PUT)`, { scimId, endpointId });
    const coreSchema = resourceType.schema;

    // GEN-11: Validate schemas array includes the core schema
    ensureSchema(body.schemas as string[] | undefined, coreSchema);

    // GEN-11: Strict schema enforcement - reject undeclared/unregistered extension URNs
    this.enforceStrictSchemaValidation(body, resourceType, endpointId, config);

    // GEN-03: Coerce boolean strings before schema validation
    this.coerceBooleanStringsIfEnabled(body, resourceType, endpointId, config);

    // G8h: Enforce primary sub-attribute constraint (RFC 7643 section 2.4)
    this.enforcePrimaryConstraint(body, resourceType, endpointId, config);

    // GEN-01: Attribute-level payload validation
    this.validatePayloadSchema(body, resourceType, endpointId, config, 'replace');

    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing) {
      this.scimLogger.debug(LogCategory.SCIM_RESOURCE, `Replace target ${resourceType.name} not found`, { scimId, endpointId });
      throw createScimError({
        status: 404,
        scimType: 'noTarget',
        detail: `${resourceType.name} "${scimId}" not found.`,
        diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' },
      });
    }

    // GEN-12: Config-aware soft-delete guard
    // [Removed in Settings v7: deletedAt no longer exists - DELETE always hard-deletes]

    enforceIfMatch(existing.version, ifMatch, config);

    // GEN-02: Immutable attribute enforcement - compare existing with incoming
    this.checkImmutableAttributes(existing, body, resourceType, endpointId, config);

    // Strip readOnly attributes using precomputed cache (RFC 7643 §2.2)
    const readOnlyCachePut = this.getSchemaCacheForRT(resourceType, endpointId)?.readOnlyCollected;
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    const strippedAttrs = stripReadOnlyAttributes(body, schemaDefs, readOnlyCachePut);
    if (strippedAttrs.length > 0) {
      this.scimLogger.warn(LogCategory.SCIM_RESOURCE, 'Stripped readOnly attributes from PUT payload', {
        method: 'PUT', path: `${resourceType.endpoint}/${scimId}`, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

    const externalId = typeof body.externalId === 'string' ? body.externalId : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const active = body.active !== false;

    // externalId and displayName are NOT checked for uniqueness - saved as received per RFC 7643.

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrsPut = this.getSchemaCacheForRT(resourceType, endpointId)?.uniqueAttrs ?? [];
    if (uniqueAttrsPut.length > 0) {
      const allResources = await this.genericRepo.findAll(endpointId, resourceType.name);
      assertSchemaUniqueness(endpointId, body, uniqueAttrsPut, allResources.map(r => ({ scimId: r.scimId, rawPayload: r.rawPayload })), scimId);
    }

    const now = this.metadata.currentIsoTimestamp();
    const location = this.metadata.buildLocation(
      baseUrl,
      resourceType.endpoint.replace(/^\//, ''),
      scimId,
    );
    const newVersion = existing.version + 1;

    const metaObj = {
      resourceType: resourceType.name,
      created: existing.createdAt.toISOString(),
      lastModified: now,
      location,
      version: `W/"${newVersion}"`,
    };

    const payload: Record<string, unknown> = { ...body };
    delete payload.schemas; // structural key, never stored in payload

    let updated;
    try {
      updated = await this.genericRepo.update(existing.id, {
        externalId,
        displayName,
        active,
        rawPayload: JSON.stringify(payload),
        meta: JSON.stringify(metaObj),
      });
    } catch (error) {
      handleRepositoryError(error, `replace ${resourceType.name}`, this.scimLogger, LogCategory.SCIM_RESOURCE, { scimId, endpointId });
    }

    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Replaced ${resourceType.name}`, {
      scimId,
      endpointId,
    });

    return this.toScimResponse(updated, resourceType);
  }

  // ─── PATCH ─────────────────────────────────────────────────────────────

  async patchResource(
    scimId: string,
    patchDto: PatchDto,
    baseUrl: string,
    endpointId: string,
    resourceType: ScimResourceType,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<Record<string, unknown>> {
    this.scimLogger.enrichContext({ resourceType: resourceType.name, resourceId: scimId, operation: 'patch' });
    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Patch ${resourceType.name}`, { scimId, endpointId });
    // Validate PATCH schema
    ensureSchema(patchDto.schemas, SCIM_PATCH_SCHEMA);

    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing) {
      this.scimLogger.debug(LogCategory.SCIM_RESOURCE, `Patch target ${resourceType.name} not found`, { scimId, endpointId });
      throw createScimError({
        status: 404,
        scimType: 'noTarget',
        detail: `${resourceType.name} "${scimId}" not found.`,
        diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' },
      });
    }

    // GEN-12: Config-aware soft-delete guard
    // [Removed in Settings v7: deletedAt no longer exists - DELETE always hard-deletes]

    enforceIfMatch(existing.version, ifMatch, config);

    // AUDIT-4: ReadOnly attribute stripping for PATCH operations (RFC 7643 §2.2)
    // Matrix: strict OFF → strip; strict ON + IgnorePatchRO ON → strip; strict ON + IgnorePatchRO OFF → reject 400
    // Sequencing aligned with Users/Groups: gate the strip, then conditionally reject or apply.
    const strictSchemaEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION);
    const ignorePatchReadOnly = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH);
    if (!strictSchemaEnabled || ignorePatchReadOnly) {
      const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
      const readOnlyCachePatch = this.getSchemaCacheForRT(resourceType, endpointId)?.readOnlyCollected;
      const { filtered, stripped } = stripReadOnlyPatchOps(patchDto.Operations, schemaDefs, readOnlyCachePatch);
      if (stripped.length > 0) {
        this.scimLogger.warn(LogCategory.SCIM_RESOURCE, 'Stripped readOnly PATCH operations', {
          count: stripped.length, attributes: stripped,
        });
        this.endpointContext.addWarnings(
          stripped.map(attr => `Attribute '${attr}' is readOnly and was ignored in PATCH`),
        );
        patchDto.Operations = filtered;
      }
    }

    // GEN-03/04: Pre-PATCH boolean coercion + validation for strict mode
    if (strictSchemaEnabled) {
      const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);

      // Coerce boolean strings in PATCH operation values before validation (parent-aware)
      const coerceEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS);
      if (coerceEnabled) {
        const boolMap = this.getBooleansByParentForRT(resourceType, endpointId);
        const coreUrnLower = this.getSchemaCacheForRT(resourceType, endpointId)?.coreSchemaUrn ?? resourceType.schema.toLowerCase();
        coercePatchOpBooleans(patchDto.Operations, boolMap, coreUrnLower);
      }

      // GEN-01: Pre-PATCH validation - validate each operation value against schema
      for (const [opIndex, op] of patchDto.Operations.entries()) {
        const preResult = SchemaValidator.validatePatchOperationValue(
          op.op, op.path, op.value, schemaDefs,
          this.getAttrMapsForRT(resourceType, endpointId),
        );
        if (!preResult.valid) {
          const messages = preResult.errors.map(e => e.message).join('; ');
          throw createScimError({
            status: 400,
            scimType: preResult.errors[0]?.scimType ?? 'invalidValue',
            detail: `PATCH operation value validation failed: ${messages}`,
            diagnostics: {
              errorCode: 'VALIDATION_SCHEMA',
              triggeredBy: 'StrictSchemaValidation',
              failedOperationIndex: opIndex,
              failedPath: op.path,
              failedOp: op.op,
              attributePaths: preResult.errors.map(e => e.path).filter(Boolean),
              activeConfig: { StrictSchemaValidation: true },
            },
          });
        }
      }
    }

    // Apply patch operations to the payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(existing.rawPayload);
    } catch (e) {
      this.scimLogger.warn(LogCategory.SCIM_RESOURCE, 'Corrupt rawPayload in PATCH - using empty object', {
        scimId: existing.scimId, endpointId, error: (e as Error).message,
      });
      payload = {};
    }

    const extensionUrns = resourceType.schemaExtensions.map(e => e.schema);
    const patchEngine = new GenericPatchEngine(payload, extensionUrns);

    try {
      for (let i = 0; i < patchDto.Operations.length; i++) {
        const op = patchDto.Operations[i];
        try {
          patchEngine.apply(op);
        } catch (err) {
          if (err instanceof PatchError && err.operationIndex === undefined) {
            throw new PatchError(err.status, err.message, err.scimType, {
              operationIndex: i, path: op.path, op: op.op,
            });
          }
          throw err;
        }
      }
    } catch (error) {
      if (error instanceof PatchError) {
        throw createScimError({
          status: error.status,
          scimType: error.scimType,
          detail: error.message,
          diagnostics: {
            errorCode: 'VALIDATION_PATCH',
            triggeredBy: 'PatchEngine',
            failedOperationIndex: error.operationIndex,
            failedPath: error.failedPath,
            failedOp: error.failedOp,
          },
        });
      }
      throw error;
    }

    const patchedPayload = patchEngine.getResult();

    // Extract updated top-level fields from patched payload
    const externalId = typeof patchedPayload.externalId === 'string'
      ? patchedPayload.externalId
      : existing.externalId;
    const displayName = typeof patchedPayload.displayName === 'string'
      ? patchedPayload.displayName
      : existing.displayName;
    const active = patchedPayload.active !== undefined
      ? patchedPayload.active !== false
      : existing.active;

    // GEN-01: Post-PATCH schema validation - validate the resulting payload
    {
      const resultPayload: Record<string, unknown> = {
        schemas: [resourceType.schema],
        ...patchedPayload,
      };
      for (const urn of extensionUrns) {
        if (urn in patchedPayload) {
          (resultPayload.schemas as string[]).push(urn);
        }
      }
      // Coerce boolean strings in post-PATCH payload
      this.coerceBooleanStringsIfEnabled(resultPayload, resourceType, endpointId, config);

      // G8h: Enforce primary on merged post-PATCH payload (RFC 7643 section 2.4)
      this.enforcePrimaryConstraint(resultPayload, resourceType, endpointId, config);

      this.validatePayloadSchema(resultPayload, resourceType, endpointId, config, 'patch');

      // GEN-02: Immutable attribute enforcement on PATCH result
      this.checkImmutableAttributes(existing, resultPayload, resourceType, endpointId, config);
    }

    // externalId and displayName are NOT checked for uniqueness - saved as received per RFC 7643.

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    {
      const uniqueAttrsPatch = this.getSchemaCacheForRT(resourceType, endpointId)?.uniqueAttrs ?? [];
      if (uniqueAttrsPatch.length > 0) {
        const allResources = await this.genericRepo.findAll(endpointId, resourceType.name);
        assertSchemaUniqueness(endpointId, patchedPayload, uniqueAttrsPatch, allResources.map(r => ({ scimId: r.scimId, rawPayload: r.rawPayload })), scimId);
      }
    }

    const now = this.metadata.currentIsoTimestamp();
    const location = this.metadata.buildLocation(
      baseUrl,
      resourceType.endpoint.replace(/^\//, ''),
      scimId,
    );
    const newVersion = existing.version + 1;

    const metaObj = {
      resourceType: resourceType.name,
      created: existing.createdAt.toISOString(),
      lastModified: now,
      location,
      version: `W/"${newVersion}"`,
    };

    let updated;
    try {
      updated = await this.genericRepo.update(existing.id, {
        externalId,
        displayName,
        active,
        rawPayload: JSON.stringify(patchedPayload),
        meta: JSON.stringify(metaObj),
      });
    } catch (error) {
      handleRepositoryError(error, `patch ${resourceType.name}`, this.scimLogger, LogCategory.SCIM_RESOURCE, { scimId, endpointId });
    }

    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Patched ${resourceType.name}`, {
      scimId,
      endpointId,
      operations: patchDto.Operations.length,
    });

    return this.toScimResponse(updated, resourceType);
  }

  // ─── DELETE ────────────────────────────────────────────────────────────

  async deleteResource(
    scimId: string,
    endpointId: string,
    resourceType: ScimResourceType,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<void> {
    this.scimLogger.enrichContext({ resourceType: resourceType.name, resourceId: scimId, operation: 'delete' });
    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Delete ${resourceType.name}`, { scimId, endpointId });
    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing) {
      this.scimLogger.debug(LogCategory.SCIM_RESOURCE, `Delete target ${resourceType.name} not found`, { scimId, endpointId });
      throw createScimError({
        status: 404,
        scimType: 'noTarget',
        detail: `${resourceType.name} "${scimId}" not found.`,
        diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' },
      });
    }

    // GEN-12: Config-aware soft-delete guard (double-delete → 404)
    // [Removed in Settings v7: deletedAt no longer exists - DELETE always hard-deletes]

    enforceIfMatch(existing.version, ifMatch, config);

    // Settings v7: Gate hard delete behind USER_HARD_DELETE_ENABLED (default: true)
    const hardDeleteEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED);
    if (!hardDeleteEnabled) {
      this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Hard delete disabled for ${resourceType.name}`, { scimId, endpointId });
      throw createScimError({
        status: 400,
        detail: `Delete is not enabled for this endpoint.`,
        diagnostics: { errorCode: 'DELETE_DISABLED', triggeredBy: 'UserHardDeleteEnabled' },
      });
    }

    try {
      await this.genericRepo.delete(existing.id);
    } catch (error) {
      handleRepositoryError(error, `delete ${resourceType.name}`, this.scimLogger, LogCategory.SCIM_RESOURCE, { scimId, endpointId });
    }
    this.scimLogger.info(LogCategory.SCIM_RESOURCE, `Deleted ${resourceType.name}`, {
      scimId,
      endpointId,
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Convert a GenericResourceRecord to a SCIM JSON response.
   *
   * Applies:
   * - GEN-04: sanitizeBooleanStringsByParent on output
   * - G8e: returned:never filtering (RFC 7643 §2.4)
   */
  private toScimResponse(
    record: GenericResourceRecord,
    resourceType: ScimResourceType,
  ): Record<string, unknown> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(record.rawPayload);
    } catch (e) {
      this.scimLogger.warn(LogCategory.SCIM_RESOURCE, 'Corrupt rawPayload in toScimResponse - using empty object', {
        scimId: record.scimId, endpointId: record.endpointId, error: (e as Error).message,
      });
      payload = {};
    }

    let meta: Record<string, unknown>;
    try {
      meta = record.meta ? JSON.parse(record.meta) : {};
    } catch (e) {
      this.scimLogger.warn(LogCategory.SCIM_RESOURCE, 'Corrupt meta in toScimResponse - using empty object', {
        scimId: record.scimId, endpointId: record.endpointId, error: (e as Error).message,
      });
      meta = {};
    }

    // Ensure version is current
    meta.version = `W/"${record.version}"`;

    // GEN-04: Parent-context-aware boolean sanitization on output
    const cache = this.getSchemaCacheForRT(resourceType, record.endpointId);
    const coreUrnLower = cache?.coreSchemaUrn ?? resourceType.schema.toLowerCase();
    const boolMap = this.getBooleansByParentForRT(resourceType, record.endpointId);
    sanitizeBooleanStringsByParent(payload, boolMap, coreUrnLower);

    // G8e: Strip returned:'never' attributes + build schemas[] dynamically (G19 / FP-1)
    const neverByParent = cache?.neverReturnedByParent ?? new Map();
    const extSchemaUrns = resourceType.schemaExtensions.map(e => e.schema);
    const visibleExtUrns = stripNeverReturnedFromPayload(payload, neverByParent, coreUrnLower, extSchemaUrns);
    const schemas: string[] = [resourceType.schema, ...visibleExtUrns];

    // Remove schemas from payload - we built it dynamically above (G19 / FP-1)
    delete payload.schemas;

    return {
      schemas,
      id: record.scimId,
      ...payload,
      meta,
    };
  }

  // ─── Validation Helpers (dynamic core URN equivalents of ScimSchemaHelpers) ──

  /**
   * GEN-11: Strict schema enforcement - reject undeclared/unregistered extension URNs.
   * Dynamic-URN equivalent of ScimSchemaHelpers.enforceStrictSchemaValidation().
   */
  private enforceStrictSchemaValidation(
    dto: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    const declaredLower = new Set(declaredSchemas.map((s) => s.toLowerCase()));

    const registeredUrns = resourceType.schemaExtensions.map(e => e.schema);
    const registeredLower = new Set(registeredUrns.map((u) => u.toLowerCase()));

    for (const key of Object.keys(dto)) {
      if (key.startsWith('urn:')) {
        const keyLower = key.toLowerCase();
        if (!declaredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidSyntax',
            detail:
              `Extension URN "${key}" found in request body but not declared in schemas[]. ` +
              `When StrictSchemaValidation is enabled, all extension URNs must be listed in the schemas array.`,
            diagnostics: { errorCode: 'VALIDATION_SCHEMA', triggeredBy: 'StrictSchemaValidation' },
          });
        }
        if (keyLower !== resourceType.schema.toLowerCase() && !registeredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidValue',
            detail:
              `Extension URN "${key}" is not a registered extension schema for this resource type. ` +
              `Registered extensions: [${registeredUrns.join(', ')}].`,
            diagnostics: { errorCode: 'VALIDATION_SCHEMA', triggeredBy: 'StrictSchemaValidation' },
          });
        }
      }
    }
  }

  /**
   * GEN-01: Attribute-level payload validation against schema definitions.
   * Dynamic-URN equivalent of ScimSchemaHelpers.validatePayloadSchema().
   * G2 fix: Required checks run unconditionally on create/replace (RFC 7643 §2.4 "MUST").
   */
  private validatePayloadSchema(
    dto: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
    config: EndpointConfig | undefined,
    mode: 'create' | 'replace' | 'patch',
  ): void {
    const isStrict = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION);

    if (!isStrict) {
      // G2: Required checks run unconditionally for create/replace (RFC 7643 §2.4 "MUST")
      if (mode === 'patch') return;
      const schemas = this.buildSchemaDefinitionsFromPayload(dto, resourceType, endpointId);
      if (schemas.length === 0) return;
      const result = SchemaValidator.validateRequired(dto, schemas, mode,
        this.getAttrMapsForRT(resourceType, endpointId));
      if (!result.valid) {
        const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
        throw createScimError({
          status: 400,
          scimType: result.errors[0]?.scimType ?? 'invalidValue',
          detail: `Schema validation failed: ${details}`,
          diagnostics: {
            errorCode: 'VALIDATION_SCHEMA',
            triggeredBy: 'RequiredAttributeCheck',
            attributePaths: result.errors.map((e) => e.path),
            activeConfig: { StrictSchemaValidation: false },
          },
        });
      }
      return;
    }

    const schemas = this.buildSchemaDefinitionsFromPayload(dto, resourceType, endpointId);
    if (schemas.length === 0) return;

    const result = SchemaValidator.validate(dto, schemas, {
      strictMode: true,
      mode,
    }, this.getAttrMapsForRT(resourceType, endpointId));

    if (!result.valid) {
      const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: result.errors[0]?.scimType ?? 'invalidValue',
        detail: `Schema validation failed: ${details}`,
        diagnostics: {
          errorCode: 'VALIDATION_SCHEMA',
          triggeredBy: 'StrictSchemaValidation',
          attributePaths: result.errors.map((e) => e.path),
          activeConfig: { StrictSchemaValidation: true },
        },
      });
    }
  }

  /**
   * GEN-03: Coerce boolean strings ("True"/"False") to native booleans before validation.
   * Uses parent-context-aware maps from the precomputed cache for precision.
   */
  private coerceBooleanStringsIfEnabled(
    dto: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    const coerceEnabled = getConfigBoolean(
      config,
      ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS,
    );
    if (!coerceEnabled) return;

    const boolMap = this.getBooleansByParentForRT(resourceType, endpointId);
    const coreUrnLower = this.getSchemaCacheForRT(resourceType, endpointId)?.coreSchemaUrn ?? resourceType.schema.toLowerCase();
    sanitizeBooleanStringsByParent(dto, boolMap, coreUrnLower);
  }

  /**
   * G8h: Enforce primary sub-attribute constraint (RFC 7643 section 2.4).
   * Generic service equivalent of ScimSchemaHelpers.enforcePrimaryConstraint().
   *
   * Uses the resource-type-specific schema definitions to identify multi-valued
   * complex attributes with a boolean primary sub-attribute.
   */
  private enforcePrimaryConstraint(
    payload: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    const rawMode = getConfigString(config, ENDPOINT_CONFIG_FLAGS.PRIMARY_ENFORCEMENT);
    const mode = (rawMode ?? 'passthrough').toLowerCase();

    const schemas = this.getSchemaDefinitions(resourceType, endpointId);
    for (const schema of schemas) {
      for (const attr of schema.attributes) {
        if (!attr.multiValued || attr.type !== 'complex') continue;
        const hasPrimarySub = attr.subAttributes?.some(
          (sa: SchemaAttributeDefinition) => sa.name.toLowerCase() === 'primary' && sa.type === 'boolean',
        );
        if (!hasPrimarySub) continue;

        const isCoreSchema = 'isCoreSchema' in schema ? (schema as any).isCoreSchema : true;
        let arr: Record<string, unknown>[] | undefined;
        if (isCoreSchema) {
          const val = payload[attr.name];
          if (Array.isArray(val)) arr = val as Record<string, unknown>[];
        } else {
          const extObj = payload[schema.id] as Record<string, unknown> | undefined;
          if (extObj && typeof extObj === 'object') {
            const val = extObj[attr.name];
            if (Array.isArray(val)) arr = val as Record<string, unknown>[];
          }
        }

        if (!arr || arr.length < 2) continue;

        let primaryCount = 0;
        let firstPrimaryIdx = -1;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i]?.primary === true) {
            primaryCount++;
            if (firstPrimaryIdx === -1) firstPrimaryIdx = i;
          }
        }
        if (primaryCount <= 1) continue;

        if (mode === 'reject') {
          throw createScimError({
            status: 400,
            scimType: 'invalidValue',
            detail: `The 'primary' attribute value 'true' MUST appear no more than once `
              + `in '${attr.name}' (found ${primaryCount}). [RFC 7643 section 2.4]`,
            diagnostics: {
              errorCode: 'PRIMARY_CONSTRAINT_VIOLATION',
              attributePath: attr.name,
              triggeredBy: 'PrimaryEnforcement',
              extra: { primaryCount },
            },
          });
        }

        if (mode === 'passthrough') {
          // Store as-is but warn about the RFC violation
          this.scimLogger.warn(LogCategory.SCIM_RESOURCE,
            `[PrimaryEnforcement] Multiple primary=true in '${attr.name}' (found ${primaryCount}). `
            + `Stored as-is (passthrough mode). [RFC 7643 section 2.4]`,
            { endpointId, attributePath: attr.name, primaryCount },
          );
          continue;
        }

        // mode === 'normalize': keep first, clear rest
        for (let i = 0; i < arr.length; i++) {
          if (arr[i]?.primary === true && i !== firstPrimaryIdx) {
            arr[i].primary = false;
          }
        }
        this.scimLogger.warn(LogCategory.SCIM_RESOURCE,
          `[PrimaryEnforcement] Normalized '${attr.name}': kept index ${firstPrimaryIdx}, `
          + `cleared ${primaryCount - 1} extra primary=true`,
          { endpointId, attributePath: attr.name, firstPrimaryIdx, clearedCount: primaryCount - 1 },
        );
      }
    }
  }

  /**
   * Get the precomputed cache for a resource type, or build one on the fly.
   * Mirrors the pattern used by ScimSchemaHelpers.getSchemaCache().
   */
  private getSchemaCacheForRT(
    resourceType: ScimResourceType,
    endpointId: string,
  ): SchemaCharacteristicsCache | undefined {
    const profile = this.endpointContext.getProfile?.();
    const cacheKey = resourceType.schema;
    if (profile?._schemaCaches?.[cacheKey]?.booleansByParent instanceof Map) {
      return profile._schemaCaches[cacheKey];
    }
    // Fallback: build from schema definitions
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    if (schemaDefs.length === 0) return undefined;
    const extensionUrns = resourceType.schemaExtensions?.map(e => e.schema) ?? [];
    const cache = SchemaValidator.buildCharacteristicsCache(schemaDefs, extensionUrns);
    // Attach to profile for next access within this request
    if (profile) {
      if (!profile._schemaCaches) profile._schemaCaches = {};
      profile._schemaCaches[cacheKey] = cache;
    }
    return cache;
  }

  /**
   * Get booleansByParent map from profile cache or build from schema definitions.
   */
  private getBooleansByParentForRT(
    resourceType: ScimResourceType,
    endpointId: string,
  ): Map<string, Set<string>> {
    return this.getSchemaCacheForRT(resourceType, endpointId)?.booleansByParent ?? new Map();
  }

  /**
   * Get precomputed attribute definition maps from cache.
   */
  private getAttrMapsForRT(
    resourceType: ScimResourceType,
    endpointId: string,
  ): { coreAttrMap: Map<string, SchemaAttributeDefinition>; extensionSchemaMap: Map<string, SchemaDefinition> } | undefined {
    const cache = this.getSchemaCacheForRT(resourceType, endpointId);
    return cache ? { coreAttrMap: cache.coreAttrMap, extensionSchemaMap: cache.extensionSchemaMap } : undefined;
  }

  /**
   * GEN-02: Immutable attribute enforcement (RFC 7643 §2.2).
   * Dynamic-URN equivalent of ScimSchemaHelpers.checkImmutableAttributes().
   * G1 fix: Runs unconditionally (RFC 7643 §2.2 "SHALL NOT").
   */
  private checkImmutableAttributes(
    existing: GenericResourceRecord,
    incomingDto: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    // G1: Immutable enforcement runs unconditionally (RFC 7643 §2.2 "SHALL NOT")
    // Previously gated by StrictSchemaValidation - removed per P4 analysis

    const existingPayload = this.buildExistingPayload(existing, resourceType);
    const schemas = this.buildSchemaDefinitionsFromPayload(incomingDto, resourceType, endpointId);
    if (schemas.length === 0) return;

    // Use precomputed maps from cache when available
    const cache = this.getSchemaCacheForRT(resourceType, endpointId);
    const result = cache
      ? SchemaValidator.checkImmutable(existingPayload, incomingDto, schemas, {
          coreAttrMap: cache.coreAttrMap,
          extensionSchemaMap: cache.extensionSchemaMap,
        })
      : SchemaValidator.checkImmutable(existingPayload, incomingDto, schemas);

    if (!result.valid) {
      const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: 'mutability',
        detail: `Immutable attribute violation: ${details}`,
        diagnostics: {
          errorCode: 'VALIDATION_IMMUTABLE',
          attributePath: result.errors[0]?.path,
          attributePaths: result.errors.map((e) => e.path),
        },
      });
    }
  }

  /**
   * Reconstruct the existing DB record as a SCIM payload for immutable comparison.
   */
  private buildExistingPayload(
    record: GenericResourceRecord,
    resourceType: ScimResourceType,
  ): Record<string, unknown> {
    const rawPayload = parseJson<Record<string, unknown>>(record.rawPayload ?? '{}');
    return {
      schemas: [resourceType.schema],
      ...rawPayload,
      externalId: record.externalId ?? undefined,
      displayName: record.displayName ?? undefined,
      active: record.active,
    };
  }

  /**
   * Build schema definitions for a given payload's declared schemas[].
   * Profile-aware: uses the endpoint's profile schemas when available,
   * falling back to the global registry only when the profile doesn't
   * contain the required schema.
   */
  private buildSchemaDefinitionsFromPayload(
    dto: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
  ): SchemaDefinition[] {
    // Build profile schema lookup map
    const profile = this.endpointContext.getProfile?.();
    const profileSchemaMap = new Map<string, any>();
    if (profile?.schemas) {
      for (const ps of profile.schemas) {
        if (ps.id) profileSchemaMap.set(ps.id, ps);
      }
    }

    const schemas: SchemaDefinition[] = [];

    // Core schema: prefer profile version, fall back to global registry
    const profileCore = profileSchemaMap.get(resourceType.schema);
    if (profileCore && Array.isArray(profileCore.attributes)) {
      schemas.push({
        id: profileCore.id,
        attributes: profileCore.attributes as unknown as SchemaAttributeDefinition[],
        isCoreSchema: true,
      });
    } else {
      const coreSchema = this.schemaRegistry.getSchema(resourceType.schema);
      if (coreSchema) {
        schemas.push({ ...coreSchema, isCoreSchema: true } as SchemaDefinition);
      }
    }

    // Extension schemas declared in the payload's schemas[]
    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    for (const urn of declaredSchemas) {
      if (urn !== resourceType.schema) {
        const profileExt = profileSchemaMap.get(urn);
        if (profileExt && Array.isArray(profileExt.attributes)) {
          schemas.push({
            id: profileExt.id,
            attributes: profileExt.attributes as unknown as SchemaAttributeDefinition[],
          });
        } else {
          const extSchema = this.schemaRegistry.getSchema(urn);
          if (extSchema) {
            schemas.push(extSchema as SchemaDefinition);
          }
        }
      }
    }

    return schemas;
  }

  // ─── Public Accessors for Controller Attribute Projection (GEN-05/06/07) ──

  /**
   * Get the returned:'always' ByParent map for projection.
   */
  getAlwaysReturnedByParent(
    resourceType: ScimResourceType,
    endpointId: string,
  ): Map<string, Set<string>> {
    return this.getSchemaCacheForRT(resourceType, endpointId)?.alwaysReturnedByParent ?? new Map();
  }

  /**
   * Get the returned:'request' ByParent map for projection.
   */
  getRequestReturnedByParent(
    resourceType: ScimResourceType,
    endpointId: string,
  ): Map<string, Set<string>> {
    return this.getSchemaCacheForRT(resourceType, endpointId)?.requestReturnedByParent ?? new Map();
  }

  /**
   * Validate that attribute paths in a filter expression are known to the
   * schema definitions for this resource type (RFC 7644 §3.4.2.2).
   */
  private validateFilterAttributePaths(
    filter: string,
    resourceType: ScimResourceType,
    endpointId: string,
  ): void {
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    if (schemaDefs.length === 0) return;

    let ast;
    try {
      ast = parseScimFilter(filter);
    } catch (err) {
      // Syntax errors are handled by buildGenericFilter in the caller
      if (process.env.NODE_ENV !== 'test') {
        console.debug?.('[generic-service] Filter parse failed in validateFilterAttributePaths:', (err as Error).message);
      }
      return;
    }
    const paths = extractFilterPaths(ast);
    if (paths.length === 0) return;

    const result = SchemaValidator.validateFilterAttributePaths(paths, schemaDefs,
      this.getAttrMapsForRT(resourceType, endpointId),
    );
    if (!result.valid) {
      const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: `Filter validation failed: ${details}`,
        diagnostics: {
          errorCode: 'VALIDATION_FILTER',
          triggeredBy: 'StrictSchemaValidation',
          attributePaths: result.errors.map((e) => e.path),
          activeConfig: { StrictSchemaValidation: true },
          filterExpression: filter,
        },
      });
    }
  }

  /**
   * Resolve a potentially nested dotted path on an object.
   * E.g. resolveNestedValue(obj, 'meta.created') → obj.meta.created
   */
  private resolveNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
