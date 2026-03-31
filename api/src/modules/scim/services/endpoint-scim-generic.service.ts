/**
 * EndpointScimGenericService — Phase 8b Generic SCIM Resource Service
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
 *   - externalId + displayName uniqueness enforcement
 *   - Reprovision-on-conflict for soft-deleted resources
 *   - Config-aware soft-delete guard
 *   - sanitizeBooleanStringsByParent on output
 *   - returned:never stripping on output
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IGenericResourceRepository } from '../../../domain/repositories/generic-resource.repository.interface';
import type {
  GenericResourceRecord,
  GenericResourceCreateInput,
} from '../../../domain/models/generic-resource.model';
import { GENERIC_RESOURCE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import {
  getConfigBoolean,
  getConfigBooleanWithDefault,
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
  guardSoftDeleted,
  stripReadOnlyAttributes,
  stripReadOnlyPatchOps,
  assertSchemaUniqueness,
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
  private readonly logger2 = new Logger(EndpointScimGenericService.name);

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
    const coreSchema = resourceType.schema;

    // GEN-11: Validate schemas array includes the core schema (same as ensureSchema)
    ensureSchema(body.schemas as string[] | undefined, coreSchema);

    // GEN-11: Strict schema enforcement — reject undeclared/unregistered extension URNs
    this.enforceStrictSchemaValidation(body, resourceType, endpointId, config);

    // GEN-03: Coerce boolean strings ("True"/"False") → native booleans before validation
    this.coerceBooleanStringsIfEnabled(body, resourceType, endpointId, config);

    // GEN-01: Attribute-level payload validation against schema definitions
    this.validatePayloadSchema(body, resourceType, endpointId, config, 'create');

    // Strip readOnly attributes using precomputed cache (RFC 7643 §2.2)
    const readOnlyCache = this.getSchemaCacheForRT(resourceType, endpointId)?.readOnlyCollected;
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    const strippedAttrs = stripReadOnlyAttributes(body, schemaDefs, readOnlyCache);
    if (strippedAttrs.length > 0) {
      this.scimLogger.warn(LogCategory.GENERAL, 'Stripped readOnly attributes from POST payload', {
        method: 'POST', path: resourceType.endpoint, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

    const externalId = typeof body.externalId === 'string' ? body.externalId : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const active = body.active !== false;

    // GEN-08/09: Check for externalId + displayName uniqueness conflict
    const conflict = await this.findConflict(endpointId, resourceType.name, externalId, displayName);
    if (conflict) {
      const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
      const reprovision = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED);

      // GEN-10: Reprovision soft-deleted resource instead of 409
      if (softDelete && reprovision && conflict.deletedAt != null) {
        this.scimLogger.info(LogCategory.GENERAL, `Re-provisioning soft-deleted ${resourceType.name}`, {
          scimId: conflict.scimId, endpointId,
        });
        return this.reprovisionResource(conflict, body, baseUrl, endpointId, resourceType, config);
      }

      // Normal conflict — throw 409
      const reason = externalId && conflict.externalId === externalId
        ? `externalId "${externalId}"`
        : `displayName "${displayName}"`;
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A ${resourceType.name} with ${reason} already exists.`,
      });
    }

    const scimId = randomUUID();

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrs = this.getSchemaCacheForRT(resourceType, endpointId)?.uniqueAttrs ?? [];
    if (uniqueAttrs.length > 0) {
      const allResources = await this.genericRepo.findAll(endpointId, resourceType.name);
      assertSchemaUniqueness(endpointId, body, uniqueAttrs, allResources.map(r => ({ scimId: r.scimId, rawPayload: r.rawPayload, deletedAt: r.deletedAt })));
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

    const record = await this.genericRepo.create(input);

    this.scimLogger.info(LogCategory.GENERAL, `Created ${resourceType.name}`, {
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
    const record = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!record) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

    // GEN-12: Config-aware soft-delete guard (RFC 7644 §3.6)
    guardSoftDeleted(record, config, scimId, this.scimLogger, LogCategory.GENERAL);

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
    const startIndex = Math.max(params.startIndex ?? 1, 1);
    const count = Math.min(Math.max(params.count ?? DEFAULT_COUNT, 0), MAX_COUNT);

    // Validate filter attribute paths against schema definitions (RFC 7644 §3.4.2.2)
    if (params.filter) {
      this.validateFilterAttributePaths(params.filter, resourceType, endpointId);
    }

    // Simple filter support: displayName eq "value" or externalId eq "value"
    const dbFilter = this.parseSimpleFilter(params.filter);

    let records = await this.genericRepo.findAll(
      endpointId,
      resourceType.name,
      dbFilter,
    );

    // GEN-12: Config-aware soft-delete filtering (RFC 7644 §3.6)
    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
    if (softDelete) {
      records = records.filter((r) => !r.deletedAt);
    }

    // In-memory sort for generic resources (RFC 7644 §3.4.2.3)
    if (params.sortBy) {
      const sortField = params.sortBy.toLowerCase();
      const direction = params.sortOrder === 'descending' ? -1 : 1;
      // Map SCIM attribute names to record fields
      const fieldMap: Record<string, string> = {
        id: 'scimId',
        externalid: 'externalId',
        displayname: 'displayName',
        'meta.created': 'createdAt',
        'meta.lastmodified': 'updatedAt',
      };
      const dbField = fieldMap[sortField];
      if (dbField) {
        records.sort((a, b) => {
          const va = String((a as unknown as Record<string, unknown>)[dbField] ?? '');
          const vb = String((b as unknown as Record<string, unknown>)[dbField] ?? '');
          return va.localeCompare(vb) * direction;
        });
      }
    }

    const totalResults = records.length;
    const pageRecords = records.slice(startIndex - 1, startIndex - 1 + count);

    const resources = pageRecords.map((r) => this.toScimResponse(r, resourceType));

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: pageRecords.length,
      Resources: resources,
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
    const coreSchema = resourceType.schema;

    // GEN-11: Validate schemas array includes the core schema
    ensureSchema(body.schemas as string[] | undefined, coreSchema);

    // GEN-11: Strict schema enforcement — reject undeclared/unregistered extension URNs
    this.enforceStrictSchemaValidation(body, resourceType, endpointId, config);

    // GEN-03: Coerce boolean strings before schema validation
    this.coerceBooleanStringsIfEnabled(body, resourceType, endpointId, config);

    // GEN-01: Attribute-level payload validation
    this.validatePayloadSchema(body, resourceType, endpointId, config, 'replace');

    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

    // GEN-12: Config-aware soft-delete guard
    guardSoftDeleted(existing, config, scimId, this.scimLogger, LogCategory.GENERAL);

    enforceIfMatch(existing.version, ifMatch, config);

    // GEN-02: Immutable attribute enforcement — compare existing with incoming
    this.checkImmutableAttributes(existing, body, resourceType, endpointId, config);

    // Strip readOnly attributes using precomputed cache (RFC 7643 §2.2)
    const readOnlyCachePut = this.getSchemaCacheForRT(resourceType, endpointId)?.readOnlyCollected;
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    const strippedAttrs = stripReadOnlyAttributes(body, schemaDefs, readOnlyCachePut);
    if (strippedAttrs.length > 0) {
      this.scimLogger.warn(LogCategory.GENERAL, 'Stripped readOnly attributes from PUT payload', {
        method: 'PUT', path: `${resourceType.endpoint}/${scimId}`, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

    const externalId = typeof body.externalId === 'string' ? body.externalId : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const active = body.active !== false;

    // GEN-08/09: Uniqueness check on PUT (exclude current resource, skip soft-deleted)
    const conflict = await this.findConflict(endpointId, resourceType.name, externalId, displayName, scimId);
    if (conflict && !conflict.deletedAt) {
      const reason = externalId && conflict.externalId === externalId
        ? `externalId "${externalId}"`
        : `displayName "${displayName}"`;
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A ${resourceType.name} with ${reason} already exists.`,
      });
    }

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrsPut = this.getSchemaCacheForRT(resourceType, endpointId)?.uniqueAttrs ?? [];
    if (uniqueAttrsPut.length > 0) {
      const allResources = await this.genericRepo.findAll(endpointId, resourceType.name);
      assertSchemaUniqueness(endpointId, body, uniqueAttrsPut, allResources.map(r => ({ scimId: r.scimId, rawPayload: r.rawPayload, deletedAt: r.deletedAt })), scimId);
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

    const updated = await this.genericRepo.update(existing.id, {
      externalId,
      displayName,
      active,
      rawPayload: JSON.stringify(payload),
      meta: JSON.stringify(metaObj),
    });

    this.scimLogger.info(LogCategory.GENERAL, `Replaced ${resourceType.name}`, {
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
    // Validate PATCH schema
    ensureSchema(patchDto.schemas, SCIM_PATCH_SCHEMA);

    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

    // GEN-12: Config-aware soft-delete guard
    guardSoftDeleted(existing, config, scimId, this.scimLogger, LogCategory.GENERAL);

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
        this.scimLogger.warn(LogCategory.GENERAL, 'Stripped readOnly PATCH operations', {
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
      const coerceEnabled = getConfigBooleanWithDefault(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS, true);
      if (coerceEnabled) {
        const boolMap = this.getBooleansByParentForRT(resourceType, endpointId);
        const coreUrnLower = this.getSchemaCacheForRT(resourceType, endpointId)?.coreSchemaUrn ?? resourceType.schema.toLowerCase();
        coercePatchOpBooleans(patchDto.Operations, boolMap, coreUrnLower);
      }

      // GEN-01: Pre-PATCH validation — validate each operation value against schema
      for (const op of patchDto.Operations) {
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
          });
        }
      }
    }

    // Apply patch operations to the payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(existing.rawPayload);
    } catch {
      payload = {};
    }

    const extensionUrns = resourceType.schemaExtensions.map(e => e.schema);
    const patchEngine = new GenericPatchEngine(payload, extensionUrns);

    try {
      for (const op of patchDto.Operations) {
        patchEngine.apply(op);
      }
    } catch (error) {
      if (error instanceof PatchError) {
        throw createScimError({
          status: 400,
          scimType: 'invalidValue',
          detail: error.message,
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

    // GEN-01: Post-PATCH schema validation — validate the resulting payload
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
      this.validatePayloadSchema(resultPayload, resourceType, endpointId, config, 'patch');

      // GEN-02: Immutable attribute enforcement on PATCH result
      this.checkImmutableAttributes(existing, resultPayload, resourceType, endpointId, config);
    }

    // GEN-08/09: Post-patch uniqueness check (skip soft-deleted)
    const conflict = await this.findConflict(endpointId, resourceType.name, externalId, displayName, scimId);
    if (conflict && !conflict.deletedAt) {
      const reason = externalId && conflict.externalId === externalId
        ? `externalId "${externalId}"`
        : `displayName "${displayName}"`;
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A ${resourceType.name} with ${reason} already exists.`,
      });
    }

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    {
      const uniqueAttrsPatch = this.getSchemaCacheForRT(resourceType, endpointId)?.uniqueAttrs ?? [];
      if (uniqueAttrsPatch.length > 0) {
        const allResources = await this.genericRepo.findAll(endpointId, resourceType.name);
        assertSchemaUniqueness(endpointId, patchedPayload, uniqueAttrsPatch, allResources.map(r => ({ scimId: r.scimId, rawPayload: r.rawPayload, deletedAt: r.deletedAt })), scimId);
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

    const updated = await this.genericRepo.update(existing.id, {
      externalId,
      displayName,
      active,
      rawPayload: JSON.stringify(patchedPayload),
      meta: JSON.stringify(metaObj),
    });

    this.scimLogger.info(LogCategory.GENERAL, `Patched ${resourceType.name}`, {
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
    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

    // GEN-12: Config-aware soft-delete guard (double-delete → 404)
    guardSoftDeleted(existing, config, scimId, this.scimLogger, LogCategory.GENERAL);

    enforceIfMatch(existing.version, ifMatch, config);

    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);

    if (softDelete) {
      await this.genericRepo.update(existing.id, {
        deletedAt: new Date(),
        active: false,
      });
      this.scimLogger.info(LogCategory.GENERAL, `Soft-deleted ${resourceType.name}`, {
        scimId,
        endpointId,
      });
    } else {
      await this.genericRepo.delete(existing.id);
      this.scimLogger.info(LogCategory.GENERAL, `Deleted ${resourceType.name}`, {
        scimId,
        endpointId,
      });
    }
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
    } catch {
      payload = {};
    }

    let meta: Record<string, unknown>;
    try {
      meta = record.meta ? JSON.parse(record.meta) : {};
    } catch {
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

    // Remove schemas from payload — we built it dynamically above (G19 / FP-1)
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
   * GEN-11: Strict schema enforcement — reject undeclared/unregistered extension URNs.
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
          });
        }
        if (keyLower !== resourceType.schema.toLowerCase() && !registeredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidValue',
            detail:
              `Extension URN "${key}" is not a registered extension schema for this resource type. ` +
              `Registered extensions: [${registeredUrns.join(', ')}].`,
          });
        }
      }
    }
  }

  /**
   * GEN-01: Attribute-level payload validation against schema definitions.
   * Dynamic-URN equivalent of ScimSchemaHelpers.validatePayloadSchema().
   */
  private validatePayloadSchema(
    dto: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
    config: EndpointConfig | undefined,
    mode: 'create' | 'replace' | 'patch',
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
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
    const coerceEnabled = getConfigBooleanWithDefault(
      config,
      ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS,
      true,
    );
    if (!coerceEnabled) return;

    const boolMap = this.getBooleansByParentForRT(resourceType, endpointId);
    const coreUrnLower = this.getSchemaCacheForRT(resourceType, endpointId)?.coreSchemaUrn ?? resourceType.schema.toLowerCase();
    sanitizeBooleanStringsByParent(dto, boolMap, coreUrnLower);
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
   */
  private checkImmutableAttributes(
    existing: GenericResourceRecord,
    incomingDto: Record<string, unknown>,
    resourceType: ScimResourceType,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

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

  /**
   * GEN-08/09: Find a conflicting resource by externalId or displayName.
   * Excludes the resource with the given scimId (for PUT/PATCH updates).
   * Returns the conflict regardless of soft-delete status — callers decide
   * whether to reprovision (CREATE) or 409 (PUT/PATCH).
   */
  private async findConflict(
    endpointId: string,
    resourceTypeName: string,
    externalId: string | null,
    displayName: string | null,
    excludeScimId?: string,
  ): Promise<GenericResourceRecord | null> {
    if (externalId) {
      const conflict = await this.genericRepo.findByExternalId(endpointId, resourceTypeName, externalId);
      if (conflict && (!excludeScimId || conflict.scimId !== excludeScimId)) {
        return conflict;
      }
    }
    if (displayName) {
      const conflict = await this.genericRepo.findByDisplayName(endpointId, resourceTypeName, displayName);
      if (conflict && (!excludeScimId || conflict.scimId !== excludeScimId)) {
        return conflict;
      }
    }
    return null;
  }

  /**
   * GEN-10: Re-provision a soft-deleted resource with new payload data.
   * Called when ReprovisionOnConflictForSoftDeletedResource is enabled.
   */
  private async reprovisionResource(
    existing: GenericResourceRecord,
    body: Record<string, unknown>,
    baseUrl: string,
    endpointId: string,
    resourceType: ScimResourceType,
    config?: EndpointConfig,
  ): Promise<Record<string, unknown>> {
    const now = this.metadata.currentIsoTimestamp();
    const location = this.metadata.buildLocation(
      baseUrl,
      resourceType.endpoint.replace(/^\//, ''),
      existing.scimId,
    );

    const existingMeta = parseJson<Record<string, unknown>>(existing.meta ?? '{}');

    const metaObj = {
      resourceType: resourceType.name,
      created: existingMeta.created ?? now,
      lastModified: now,
      location,
      version: `W/"${existing.version + 1}"`,
    };

    const payload: Record<string, unknown> = { ...body };
    delete payload.schemas;

    const externalId = typeof body.externalId === 'string' ? body.externalId : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const active = body.active !== false;

    const updated = await this.genericRepo.update(existing.id, {
      externalId,
      displayName,
      active,
      deletedAt: null, // Clear soft-delete marker
      rawPayload: JSON.stringify(payload),
      meta: JSON.stringify(metaObj),
    });

    this.scimLogger.info(LogCategory.GENERAL, `Re-provisioned soft-deleted ${resourceType.name}`, {
      scimId: existing.scimId, endpointId,
    });

    return this.toScimResponse(updated, resourceType);
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
    } catch {
      // Syntax errors handled by parseSimpleFilter
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
      });
    }
  }

  /**
   * Parse a simple SCIM filter into a DB-level filter object.
   * Supports: displayName eq "value", externalId eq "value"
   * Throws 400 invalidFilter for any unsupported filter expression (RFC 7644 §3.4.2.2).
   */
  private parseSimpleFilter(
    filter?: string,
  ): Record<string, unknown> | undefined {
    if (!filter) return undefined;

    const eqMatch = filter.match(
      /^(\w+)\s+eq\s+"([^"]*)"$/i,
    );
    if (eqMatch) {
      const [, attr, value] = eqMatch;
      const attrLower = attr.toLowerCase();
      if (attrLower === 'displayname') {
        return { displayName: value };
      }
      if (attrLower === 'externalid') {
        return { externalId: value };
      }
    }

    // RFC 7644 §3.4.2.2: MUST return 400 invalidFilter for unsupported expressions
    throw createScimError({
      status: 400,
      scimType: 'invalidFilter',
      detail: `Unsupported or invalid filter expression: '${filter}'.`,
    });
  }
}
