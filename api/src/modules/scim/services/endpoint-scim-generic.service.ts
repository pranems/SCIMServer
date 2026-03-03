/**
 * EndpointScimGenericService — Phase 8b Generic SCIM Resource Service
 *
 * Handles CRUD operations for custom resource types registered via the
 * Admin API. Resources are stored in the polymorphic ScimResource table
 * with the custom resourceType discriminator.
 *
 * This service is intentionally simpler than the User/Group services:
 *   - No type-specific field extraction (everything lives in JSONB payload)
 *   - No member management (that's Group-only)
 *   - Supports externalId-based conflict checking
 *   - Standard SCIM meta envelope and ETag support
 *   - Filter support for displayName and externalId
 *   - Soft-delete support via SoftDeleteEnabled flag
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
  ENDPOINT_CONFIG_FLAGS,
  type EndpointConfig,
} from '../../endpoint/endpoint-config.interface';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { createScimError } from '../common/scim-errors';
import { assertIfMatch } from '../interceptors/scim-etag.interceptor';
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_SCHEMA,
} from '../common/scim-constants';
import {
  stripReadOnlyAttributes,
  stripReadOnlyPatchOps,
} from '../common/scim-service-helpers';
import { SchemaValidator } from '../../../domain/validation';
import { stripReturnedNever } from '../common/scim-attribute-projection';
import { ScimMetadataService } from './scim-metadata.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimResourceType } from '../discovery/scim-schema-registry';
import type { SchemaDefinition } from '../../../domain/validation';
import { GenericPatchEngine } from '../../../domain/patch/generic-patch-engine';
import { PatchError } from '../../../domain/patch/patch-error';
import type { PatchOperation } from '../../../domain/patch/patch-types';

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
   */
  private getSchemaDefinitions(
    resourceType: ScimResourceType,
    endpointId: string,
  ): SchemaDefinition[] {
    const schemas: SchemaDefinition[] = [];
    const coreDef = this.schemaRegistry.getSchema(resourceType.schema, endpointId);
    if (coreDef) schemas.push(coreDef as SchemaDefinition);
    for (const ext of resourceType.schemaExtensions) {
      const extDef = this.schemaRegistry.getSchema(ext.schema, endpointId);
      if (extDef) schemas.push(extDef as SchemaDefinition);
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

    // Validate schemas array includes the core schema
    const schemas = body.schemas as string[] | undefined;
    if (!schemas || !schemas.includes(coreSchema)) {
      throw createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: `Request must include "${coreSchema}" in the schemas array.`,
      });
    }

    const externalId = typeof body.externalId === 'string' ? body.externalId : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const active = body.active !== false;

    // Check for externalId conflict
    if (externalId) {
      const conflict = await this.genericRepo.findByExternalId(
        endpointId,
        resourceType.name,
        externalId,
      );
      if (conflict && !conflict.deletedAt) {
        throw createScimError({
          status: 409,
          scimType: 'uniqueness',
          detail: `A ${resourceType.name} with externalId "${externalId}" already exists.`,
        });
      }
    }

    const scimId = randomUUID();
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

    // Strip readOnly attributes using schema definitions (RFC 7643 §2.2)
    // This replaces the hardcoded delete of schemas/meta/id with schema-driven stripping
    const payload: Record<string, unknown> = { ...body };
    delete payload.schemas; // structural key, never stored in payload
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    const strippedAttrs = stripReadOnlyAttributes(payload, schemaDefs);
    if (strippedAttrs.length > 0) {
      this.scimLogger.warn(LogCategory.GENERAL, 'Stripped readOnly attributes from POST payload', {
        method: 'POST', path: resourceType.endpoint, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

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

    if (!record || record.deletedAt) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

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

    // Simple filter support: displayName eq "value" or externalId eq "value"
    const dbFilter = this.parseSimpleFilter(params.filter);

    let records = await this.genericRepo.findAll(
      endpointId,
      resourceType.name,
      dbFilter,
    );

    // Exclude soft-deleted
    records = records.filter((r) => !r.deletedAt);

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
    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing || existing.deletedAt) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

    assertIfMatch(`W/"v${existing.version}"`, ifMatch);

    const externalId = typeof body.externalId === 'string' ? body.externalId : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const active = body.active !== false;

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

    // Strip readOnly attributes using schema definitions (RFC 7643 §2.2)
    const payload: Record<string, unknown> = { ...body };
    delete payload.schemas; // structural key, never stored in payload
    const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
    const strippedAttrs = stripReadOnlyAttributes(payload, schemaDefs);
    if (strippedAttrs.length > 0) {
      this.scimLogger.warn(LogCategory.GENERAL, 'Stripped readOnly attributes from PUT payload', {
        method: 'PUT', path: `${resourceType.endpoint}/${scimId}`, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

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
    if (
      !patchDto.schemas ||
      !patchDto.schemas.includes(SCIM_PATCH_SCHEMA)
    ) {
      throw createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: `PATCH request must include "${SCIM_PATCH_SCHEMA}" in schemas.`,
      });
    }

    const existing = await this.genericRepo.findByScimId(
      endpointId,
      resourceType.name,
      scimId,
    );

    if (!existing || existing.deletedAt) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

    assertIfMatch(`W/"v${existing.version}"`, ifMatch);

    // ReadOnly attribute stripping for PATCH operations (RFC 7643 §2.2)
    // Matrix: strict OFF → strip; strict ON + IgnorePatchRO ON → strip; strict ON + IgnorePatchRO OFF → reject 400
    const strictSchemaEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION);
    const ignorePatchReadOnly = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH);
    {
      const schemaDefs = this.getSchemaDefinitions(resourceType, endpointId);
      const { filtered, stripped } = stripReadOnlyPatchOps(patchDto.Operations, schemaDefs);
      if (stripped.length > 0) {
        if (strictSchemaEnabled && !ignorePatchReadOnly) {
          // G8c: Hard-reject readOnly writes on strict endpoints
          throw createScimError({
            status: 400,
            scimType: 'mutability',
            detail: `Attribute(s) [${stripped.join(', ')}] are readOnly and cannot be modified.`,
          });
        }
        this.scimLogger.warn(LogCategory.GENERAL, 'Stripped readOnly PATCH operations', {
          count: stripped.length, attributes: stripped,
        });
        this.endpointContext.addWarnings(
          stripped.map(attr => `Attribute '${attr}' is readOnly and was ignored in PATCH`),
        );
        patchDto.Operations = filtered;
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

    if (!existing || existing.deletedAt) {
      throw createScimError({
        status: 404,
        detail: `${resourceType.name} "${scimId}" not found.`,
      });
    }

    assertIfMatch(`W/"v${existing.version}"`, ifMatch);

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
   * Applies returned:never filtering (RFC 7643 §2.4) to strip attributes
   * that must never appear in any response (e.g. writeOnly secrets).
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

    // G8e: Strip returned:'never' attributes from payload (e.g. writeOnly secrets)
    // Per RFC 7643 §2.4, these MUST NOT appear in any response.
    const schemaDefs = this.getSchemaDefinitions(resourceType, record.endpointId);
    const { never: neverAttrs } = SchemaValidator.collectReturnedCharacteristics(schemaDefs);
    if (neverAttrs.size > 0) {
      stripReturnedNever(payload, neverAttrs);
    }

    // Build schemas array: core + extension URNs
    const schemas: string[] = [resourceType.schema];
    for (const ext of resourceType.schemaExtensions) {
      if (payload[ext.schema]) {
        schemas.push(ext.schema);
      }
    }

    return {
      schemas,
      id: record.scimId,
      ...payload,
      meta,
    };
  }

  /**
   * Parse a simple SCIM filter into a DB-level filter object.
   * Supports: displayName eq "value", externalId eq "value"
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

    return undefined;
  }
}
