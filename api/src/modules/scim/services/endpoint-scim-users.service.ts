import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import type { UserRecord, UserCreateInput, UserUpdateInput } from '../../../domain/models/user.model';
import { USER_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { createScimError } from '../common/scim-errors';
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  SCIM_CORE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_SCHEMA,
} from '../common/scim-constants';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimListResponse, ScimUserResource } from '../common/scim-types';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';
import { ScimMetadataService } from './scim-metadata.service';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ENDPOINT_CONFIG_FLAGS, getConfigBoolean, getConfigBooleanWithDefault } from '../../endpoint/endpoint-config.interface';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { buildUserFilter } from '../filters/apply-scim-filter';
import { resolveUserSortParams } from '../common/scim-sort.util';
import { UserPatchEngine } from '../../../domain/patch/user-patch-engine';
import { PatchError } from '../../../domain/patch/patch-error';
import { SchemaValidator } from '../../../domain/validation';
import {
  parseJson,
  ensureSchema,
  enforceIfMatch,
  sanitizeBooleanStrings,
  guardSoftDeleted,
  ScimSchemaHelpers,
} from '../common/scim-service-helpers';

interface ListUsersParams {
  filter?: string;
  startIndex?: number;
  count?: number;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
}

/**
 * Endpoint-specific SCIM Users Service
 * Handles all user operations scoped to a specific endpoint
 */
@Injectable()
export class EndpointScimUsersService {
  private readonly schemaHelpers: ScimSchemaHelpers;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly metadata: ScimMetadataService,
    private readonly logger: ScimLogger,
    private readonly schemaRegistry: ScimSchemaRegistry,
    private readonly endpointContext: EndpointContextStorage,
  ) {
    this.schemaHelpers = new ScimSchemaHelpers(schemaRegistry, SCIM_CORE_USER_SCHEMA);
  }

  async createUserForEndpoint(dto: CreateUserDto, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimUserResource> {
    ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);
    this.schemaHelpers.enforceStrictSchemaValidation(dto, endpointId, config);

    // Coerce boolean strings ("True"/"False") to native booleans before schema validation.
    // Supersedes StrictSchemaValidation boolean type rejections when enabled.
    this.schemaHelpers.coerceBooleanStringsIfEnabled(dto as Record<string, unknown>, endpointId, config);

    this.schemaHelpers.validatePayloadSchema(dto, endpointId, config, 'create');

    // Strip readOnly attributes (RFC 7643 §2.2: server SHALL ignore client-supplied readOnly values)
    const strippedAttrs = this.schemaHelpers.stripReadOnlyAttributesFromPayload(dto as Record<string, unknown>, endpointId);
    if (strippedAttrs.length > 0) {
      this.logger.warn(LogCategory.SCIM_USER, 'Stripped readOnly attributes from POST payload', {
        method: 'POST', path: '/Users', stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

    this.logger.info(LogCategory.SCIM_USER, 'Creating user', { userName: dto.userName, endpointId });
    this.logger.trace(LogCategory.SCIM_USER, 'Create user payload', { body: dto as unknown as Record<string, unknown> });

    // Check uniqueness — if conflict is with a soft-deleted resource and
    // ReprovisionOnConflictForSoftDeletedResource is enabled, re-activate it instead of 409.
    const conflict = await this.userRepo.findConflict(endpointId, dto.userName, dto.externalId ?? undefined);
    if (conflict) {
      const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
      const reprovision = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED);

      if (softDelete && reprovision && conflict.deletedAt != null) {
        this.logger.info(LogCategory.SCIM_USER, 'Re-provisioning soft-deleted user', { scimId: conflict.scimId, userName: dto.userName, endpointId });
        return this.reprovisionUser(conflict.scimId, dto, baseUrl, endpointId, config);
      }

      // Normal conflict — throw 409
      const reason =
        conflict.userName.toLowerCase() === dto.userName.toLowerCase()
          ? `userName '${dto.userName}'`
          : `externalId '${dto.externalId}'`;
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A resource with ${reason} already exists.`,
      });
    }

    const now = new Date();
    const scimId = randomUUID();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const input: UserCreateInput = {
      endpointId,
      scimId,
      externalId: dto.externalId ?? null,
      userName: dto.userName,
      displayName: typeof dto.displayName === 'string' ? dto.displayName : null,
      active: dto.active ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'User',
        created: now.toISOString(),
        lastModified: now.toISOString()
      }),
    };

    const created = await this.userRepo.create(input);

    this.logger.info(LogCategory.SCIM_USER, 'User created', { scimId, userName: dto.userName, endpointId });
    return this.toScimUserResource(created, baseUrl, endpointId);
  }

  async getUserForEndpoint(scimId: string, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimUserResource> {
    this.logger.debug(LogCategory.SCIM_USER, 'Get user', { scimId, endpointId });
    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'User not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations
    guardSoftDeleted(user, config, scimId, this.logger, LogCategory.SCIM_USER);

    return this.toScimUserResource(user, baseUrl, endpointId);
  }

  async listUsersForEndpoint(
    { filter, startIndex = 1, count = DEFAULT_COUNT, sortBy, sortOrder }: ListUsersParams,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
  ): Promise<ScimListResponse<ScimUserResource>> {
    if (count > MAX_COUNT) {
      count = MAX_COUNT;
    }

    this.logger.info(LogCategory.SCIM_USER, 'List users', { filter, startIndex, count, endpointId });

    let filterResult;
    try {
      filterResult = buildUserFilter(filter, this.schemaHelpers.getCaseExactAttributes(endpointId));
    } catch {
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: `Unsupported or invalid filter expression: '${filter}'.`
      });
    }

    // Validate filter attribute paths against schema definitions (RFC 7644 §3.4.2.2)
    if (filter) {
      this.schemaHelpers.validateFilterPaths(filter, endpointId);
    }

    // Fetch users from DB (repository handles endpointId scoping)
    const sortParams = resolveUserSortParams(sortBy, sortOrder);
    const allDbUsers = await this.userRepo.findAll(
      endpointId,
      filterResult.dbWhere,
      sortParams,
    );

    // Build SCIM resources and apply in-memory filter if needed
    // RFC 7644 §3.6: Soft-deleted resources (deletedAt set) MUST be omitted from future query results
    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
    const filteredDbUsers = softDelete
      ? allDbUsers.filter((u) => u.deletedAt == null)
      : allDbUsers;
    let resources = filteredDbUsers.map((user) => this.toScimUserResource(user, baseUrl, endpointId));

    if (filterResult.inMemoryFilter) {
      resources = resources.filter(filterResult.inMemoryFilter);
    }

    const totalResults = resources.length;
    const skip = Math.max(startIndex - 1, 0);
    const take = Math.max(Math.min(count, MAX_COUNT), 0);
    const paginatedResources = resources.slice(skip, skip + take);

    this.logger.debug(LogCategory.SCIM_USER, 'List users result', { totalResults, returned: paginatedResources.length, endpointId });

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: paginatedResources.length,
      Resources: paginatedResources
    };
  }

  async patchUserForEndpoint(
    scimId: string,
    patchDto: PatchUserDto,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<ScimUserResource> {
    ensureSchema(patchDto.schemas, SCIM_PATCH_SCHEMA);

    this.logger.info(LogCategory.SCIM_PATCH, 'Patch user', { scimId, endpointId, opCount: patchDto.Operations?.length });
    this.logger.debug(LogCategory.SCIM_PATCH, 'Patch operations', {
      operations: patchDto.Operations?.map(o => ({ op: o.op, path: o.path })),
    });
    this.logger.trace(LogCategory.SCIM_PATCH, 'Patch user full payload', { body: patchDto as unknown as Record<string, unknown> });

    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations
    guardSoftDeleted(user, config, scimId, this.logger, LogCategory.SCIM_USER);

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(user.version, ifMatch, config);

    const updatedData = await this.applyPatchOperationsForEndpoint(user, patchDto, endpointId, config);

    const updatedUser = await this.userRepo.update(user.id, updatedData);

    this.logger.info(LogCategory.SCIM_PATCH, 'User patched', { scimId, endpointId });
    return this.toScimUserResource(updatedUser, baseUrl, endpointId);
  }

  async replaceUserForEndpoint(
    scimId: string,
    dto: CreateUserDto,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<ScimUserResource> {
    ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);
    this.schemaHelpers.enforceStrictSchemaValidation(dto, endpointId, config);

    // Coerce boolean strings before schema validation (same as create path)
    this.schemaHelpers.coerceBooleanStringsIfEnabled(dto as Record<string, unknown>, endpointId, config);

    this.schemaHelpers.validatePayloadSchema(dto, endpointId, config, 'replace');

    // Strip readOnly attributes (RFC 7643 §2.2: server SHALL ignore client-supplied readOnly values)
    const strippedAttrs = this.schemaHelpers.stripReadOnlyAttributesFromPayload(dto as Record<string, unknown>, endpointId);
    if (strippedAttrs.length > 0) {
      this.logger.warn(LogCategory.SCIM_USER, 'Stripped readOnly attributes from PUT payload', {
        method: 'PUT', path: `/Users/${scimId}`, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

    this.logger.info(LogCategory.SCIM_USER, 'Replace user (PUT)', { scimId, userName: dto.userName, endpointId });

    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations
    guardSoftDeleted(user, config, scimId, this.logger, LogCategory.SCIM_USER);

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(user.version, ifMatch, config);

    // H-2: Immutable attribute enforcement — compare existing resource with incoming payload
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(user), dto, endpointId, config);

    await this.assertUniqueIdentifiersForEndpoint(dto.userName, dto.externalId ?? undefined, endpointId, scimId);

    const now = new Date();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);
    const meta = parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    const data: UserUpdateInput = {
      externalId: dto.externalId ?? null,
      userName: dto.userName,
      displayName: typeof dto.displayName === 'string' ? dto.displayName : null,
      active: dto.active ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        ...meta,
        lastModified: now.toISOString()
      })
    };

    const updatedUser = await this.userRepo.update(user.id, data);

    return this.toScimUserResource(updatedUser, baseUrl, endpointId);
  }

  async deleteUserForEndpoint(scimId: string, endpointId: string, config?: EndpointConfig, ifMatch?: string): Promise<void> {
    this.logger.info(LogCategory.SCIM_USER, 'Delete user', { scimId, endpointId });
    const user = await this.userRepo.findByScimId(endpointId, scimId);

    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'Delete target not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations (double-delete)
    guardSoftDeleted(user, config, scimId, this.logger, LogCategory.SCIM_USER);

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(user.version, ifMatch, config);

    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);

    if (softDelete) {
      this.logger.info(LogCategory.SCIM_USER, 'Soft-deleting user (setting active=false + deletedAt)', { scimId, endpointId });
      await this.userRepo.update(user.id, { active: false, deletedAt: new Date() });
      this.logger.info(LogCategory.SCIM_USER, 'User soft-deleted', { scimId, endpointId });
    } else {
      await this.userRepo.delete(user.id);
      this.logger.info(LogCategory.SCIM_USER, 'User hard-deleted', { scimId, endpointId });
    }
  }

  // ===== Private Helper Methods =====

  // ===== Private Helper Methods =====
  // G17: Most helpers extracted to ../common/scim-service-helpers.ts
  // Only User-specific methods remain here.

  /**
   * Re-provision a soft-deleted user: reactivate with new payload data.
   * Called when ReprovisionOnConflictForSoftDeletedResource is enabled and
   * a POST conflicts with a soft-deleted user.
   */
  private async reprovisionUser(
    existingScimId: string,
    dto: CreateUserDto,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
  ): Promise<ScimUserResource> {
    const existing = await this.userRepo.findByScimId(endpointId, existingScimId);
    if (!existing) {
      throw createScimError({ status: 500, detail: 'Failed to locate soft-deleted resource for re-provisioning.' });
    }

    const now = new Date();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const updateData: UserUpdateInput = {
      userName: dto.userName,
      externalId: dto.externalId ?? null,
      displayName: typeof dto.displayName === 'string' ? dto.displayName : null,
      active: dto.active ?? true,
      deletedAt: null,  // Clear soft-delete marker on re-provisioning
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'User',
        created: (parseJson<Record<string, unknown>>(String(existing.meta ?? '{}')) as Record<string, unknown>).created ?? now.toISOString(),
        lastModified: now.toISOString(),
      }),
    };

    const updated = await this.userRepo.update(existing.id, updateData);
    this.logger.info(LogCategory.SCIM_USER, 'User re-provisioned (soft-deleted resource reactivated)', {
      scimId: existingScimId, userName: dto.userName, endpointId,
    });
    return this.toScimUserResource(updated, baseUrl, endpointId);
  }

  /**
   * Reconstruct the existing DB record as a SCIM payload object (data only, no meta/location).
   * Used for immutable attribute comparison.
   */
  private buildExistingPayload(record: UserRecord): Record<string, unknown> {
    const rawPayload = parseJson<Record<string, unknown>>(String(record.rawPayload ?? '{}'));
    return {
      ...rawPayload,
      userName: record.userName,
      externalId: record.externalId ?? undefined,
      active: record.active,
      displayName: record.displayName ?? undefined,
    };
  }

  private async assertUniqueIdentifiersForEndpoint(
    userName: string,
    externalId: string | undefined,
    endpointId: string,
    excludeScimId?: string
  ): Promise<void> {
    const conflict = await this.userRepo.findConflict(
      endpointId,
      userName,
      externalId,
      excludeScimId,
    );

    if (conflict) {
      const reason =
        conflict.userName.toLowerCase() === userName.toLowerCase()
          ? `userName '${userName}'`
          : `externalId '${externalId}'`;

      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A resource with ${reason} already exists.`
      });
    }
  }

  private async applyPatchOperationsForEndpoint(
    user: UserRecord,
    patchDto: PatchUserDto,
    endpointId: string,
    config?: EndpointConfig
  ): Promise<UserUpdateInput> {
    const verbosePatch = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED);
    const extensionUrns = this.schemaHelpers.getExtensionUrns(endpointId);
    const rawPayload = parseJson<Record<string, unknown>>(String(user.rawPayload ?? '{}'));
    const meta = parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    // ReadOnly attribute stripping for PATCH operations
    // Matrix: strict OFF → strip; strict ON + IgnorePatchRO ON → strip; strict ON + IgnorePatchRO OFF → keep G8c 400
    const strictSchemaEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION);
    const ignorePatchReadOnly = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH);
    if (!strictSchemaEnabled || ignorePatchReadOnly) {
      const { filtered, stripped } = this.schemaHelpers.stripReadOnlyFromPatchOps(patchDto.Operations, endpointId);
      if (stripped.length > 0) {
        this.logger.warn(LogCategory.SCIM_USER, 'Stripped readOnly PATCH operations', {
          count: stripped.length,
          attributes: stripped,
        });
        this.endpointContext.addWarnings(
          stripped.map(attr => `Attribute '${attr}' is readOnly and was ignored in PATCH`),
        );
        patchDto.Operations = filtered;
      }
    }

    // V2: Pre-PATCH validation — validate each operation value against its schema attribute
    if (strictSchemaEnabled) {
      const resultPayloadPlaceholder: Record<string, unknown> = {
        schemas: [SCIM_CORE_USER_SCHEMA],
      };
      for (const urn of extensionUrns) {
        (resultPayloadPlaceholder.schemas as string[]).push(urn);
      }
      const schemaDefs = this.schemaHelpers.buildSchemaDefinitions(resultPayloadPlaceholder, endpointId);

      // Coerce boolean strings in PATCH operation values before validation
      const coerceEnabled = getConfigBooleanWithDefault(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS, true);
      if (coerceEnabled) {
        const booleanKeys = this.schemaHelpers.getBooleanKeys(endpointId);
        for (const op of patchDto.Operations) {
          if (op.value && typeof op.value === 'object' && !Array.isArray(op.value)) {
            sanitizeBooleanStrings(op.value as Record<string, unknown>, booleanKeys);
          } else if (Array.isArray(op.value)) {
            for (const item of op.value) {
              if (typeof item === 'object' && item !== null) {
                sanitizeBooleanStrings(item as Record<string, unknown>, booleanKeys);
              }
            }
          }
        }
      }

      for (const op of patchDto.Operations) {
        const preResult = SchemaValidator.validatePatchOperationValue(
          op.op, op.path, op.value, schemaDefs,
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

    let result;
    try {
      result = UserPatchEngine.apply(
        patchDto.Operations,
        {
          userName: user.userName,
          displayName: user.displayName ?? null,
          externalId: user.externalId ?? null,
          active: user.active,
          rawPayload,
        },
        { verbosePatch, extensionUrns },
      );
    } catch (err) {
      if (err instanceof PatchError) {
        throw createScimError({ status: err.status, scimType: err.scimType, detail: err.message });
      }
      throw err;
    }

    const { extractedFields, payload } = result;

    // H-1: Post-PATCH schema validation — validate the resulting payload
    const resultPayload: Record<string, unknown> = {
      schemas: [SCIM_CORE_USER_SCHEMA],
      userName: extractedFields.userName ?? user.userName,
      displayName: extractedFields.displayName,
      active: extractedFields.active,
      ...payload,
    };
    // Include extension URNs in schemas[] for proper validation
    for (const urn of extensionUrns) {
      if (urn in payload) {
        (resultPayload.schemas as string[]).push(urn);
      }
    }

    // Coerce boolean strings in post-PATCH payload before schema validation.
    // PATCH filter expressions like roles[primary eq "True"] can materialise string
    // literals into the result payload — this converts them to native booleans.
    this.schemaHelpers.coerceBooleanStringsIfEnabled(resultPayload, endpointId, config);

    this.schemaHelpers.validatePayloadSchema(resultPayload, endpointId, config, 'patch');

    // H-2: Immutable attribute enforcement — compare existing state with PATCH result
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(user), resultPayload, endpointId, config);

    await this.assertUniqueIdentifiersForEndpoint(
      extractedFields.userName ?? user.userName,
      extractedFields.externalId ?? undefined,
      endpointId,
      user.scimId,
    );

    return {
      userName: extractedFields.userName,
      displayName: extractedFields.displayName,
      externalId: extractedFields.externalId,
      active: extractedFields.active,
      rawPayload: JSON.stringify(payload),
      meta: JSON.stringify({
        ...meta,
        lastModified: new Date().toISOString()
      })
    } satisfies UserUpdateInput;
  }

  private toScimUserResource(user: UserRecord, baseUrl: string, endpointId?: string): ScimUserResource {
    const meta = this.buildMeta(user, baseUrl);
    const rawPayload = parseJson<Record<string, unknown>>(String(user.rawPayload ?? '{}'));

    // V16 fix: Schema-aware boolean sanitization — only convert attributes whose schema
    // type is "boolean" (e.g. active, emails[].primary). Prevents corruption of string
    // attributes like roles[].value = "true" which is a legitimate string value.
    const booleanKeys = this.schemaHelpers.getBooleanKeys(endpointId);
    sanitizeBooleanStrings(rawPayload, booleanKeys);

    // G8e: Strip returned:'never' attributes from rawPayload (e.g. password)
    // Per RFC 7643 §2.4, these MUST NOT appear in any response.
    const { never: neverAttrs } = this.schemaHelpers.getReturnedCharacteristics(endpointId);
    for (const key of Object.keys(rawPayload)) {
      if (neverAttrs.has(key.toLowerCase())) {
        delete rawPayload[key];
      }
    }

    // Build schemas[] dynamically — include extension URNs present in payload (G19 fix)
    const extensionUrns = this.schemaHelpers.getExtensionUrns(endpointId);
    const schemas: [string, ...string[]] = [SCIM_CORE_USER_SCHEMA];
    for (const urn of extensionUrns) {
      if (urn in rawPayload) {
        schemas.push(urn);
        // Also strip never-returned attrs inside extension objects
        const extObj = rawPayload[urn];
        if (typeof extObj === 'object' && extObj !== null && !Array.isArray(extObj)) {
          for (const extKey of Object.keys(extObj as Record<string, unknown>)) {
            if (neverAttrs.has(extKey.toLowerCase())) {
              delete (extObj as Record<string, unknown>)[extKey];
            }
          }
        }
      }
    }

    // Remove reserved server-assigned attributes from rawPayload to prevent overwriting
    // (e.g., a client-supplied "id" in the POST body must never override scimId)
    delete rawPayload.id;

    return {
      schemas,
      ...rawPayload,
      id: user.scimId,
      userName: user.userName,
      externalId: user.externalId ?? undefined,
      active: user.active,
      meta
    };
  }

  /**
   * Get the returned:'request' attribute names for User resources.
   * Used by controllers to filter response attributes per RFC 7643 §2.4.
   */
  getRequestOnlyAttributes(endpointId?: string): Set<string> {
    return this.schemaHelpers.getRequestOnlyAttributes(endpointId);
  }

  /**
   * Get the returned:'always' attribute names from schema definitions (R-RET-1).
   */
  getAlwaysReturnedAttributes(endpointId?: string): Set<string> {
    return this.schemaHelpers.getAlwaysReturnedAttributes(endpointId);
  }

  /**
   * Get sub-attributes with returned:'always' grouped by parent (R-RET-3).
   */
  getAlwaysReturnedSubAttrs(endpointId?: string): Map<string, Set<string>> {
    return this.schemaHelpers.getAlwaysReturnedSubAttrs(endpointId);
  }

  private buildMeta(user: UserRecord, baseUrl: string) {
    const createdAt = user.createdAt.toISOString();
    const lastModified = user.updatedAt.toISOString();
    const location = this.metadata.buildLocation(baseUrl, 'Users', String(user.scimId));

    return {
      resourceType: 'User',
      created: createdAt,
      lastModified,
      location,
      version: `W/"v${user.version}"`
    };
  }

  private extractAdditionalAttributes(dto: CreateUserDto): Record<string, unknown> {
    const { schemas, ...rest } = dto;
    const additional = { ...rest } as Record<string, unknown>;
    delete additional.userName;
    delete additional.externalId;
    delete additional.active;
    delete additional.id;  // RFC 7643 §3.1: id is assigned by the service provider — ignore client-supplied values

    return {
      schemas,
      ...additional
    };
  }
}
