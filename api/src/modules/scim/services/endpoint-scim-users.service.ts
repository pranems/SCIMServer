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
import { ENDPOINT_CONFIG_FLAGS, getConfigBoolean } from '../../endpoint/endpoint-config.interface';
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
  sanitizeBooleanStringsByParent,
  coercePatchOpBooleans,
  stripNeverReturnedFromPayload,
  ScimSchemaHelpers,
  assertSchemaUniqueness,
  handleRepositoryError,
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
    this.schemaHelpers = new ScimSchemaHelpers(schemaRegistry, SCIM_CORE_USER_SCHEMA, endpointContext);
  }

  async createUserForEndpoint(dto: CreateUserDto, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimUserResource> {
    this.logger.enrichContext({ resourceType: 'User', operation: 'create' });
    ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);
    this.schemaHelpers.enforceStrictSchemaValidation(dto, endpointId, config);

    // Coerce boolean strings ("True"/"False") to native booleans before schema validation.
    // Uses parent-context-aware maps for precision (prevents name-collision false positives).
    this.schemaHelpers.coerceBooleansByParentIfEnabled(dto as Record<string, unknown>, endpointId, config);

    // G8h: Enforce primary sub-attribute constraint (RFC 7643 section 2.4)
    this.schemaHelpers.enforcePrimaryConstraint(dto as Record<string, unknown>, endpointId, config);

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

    // Check userName uniqueness - always 409 on conflict
    // Note: externalId and displayName are NOT checked - saved as received per RFC 7643.
    const conflict = await this.userRepo.findConflict(endpointId, dto.userName);
    if (conflict) {
      this.logger.info(LogCategory.SCIM_USER, `Uniqueness conflict on POST: userName '${dto.userName}'`, {
        endpointId, conflictScimId: conflict.scimId,
      });
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A resource with userName '${dto.userName}' already exists.`,
        diagnostics: {
          errorCode: 'UNIQUENESS_USERNAME',
          operation: 'create',
          conflictingResourceId: conflict.scimId,
          conflictingAttribute: 'userName',
          incomingValue: dto.userName,
        },
      });
    }

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrs = this.schemaHelpers.getUniqueAttributes(endpointId);
    if (uniqueAttrs.length > 0) {
      const allUsers = await this.userRepo.findAll(endpointId, {});
      assertSchemaUniqueness(endpointId, dto as unknown as Record<string, unknown>, uniqueAttrs, allUsers.map(u => ({ scimId: u.scimId, rawPayload: u.rawPayload })));
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
      active: (dto.active as boolean) ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'User',
        created: now.toISOString(),
        lastModified: now.toISOString()
      }),
    };

    let created: UserRecord;
    try {
      created = await this.userRepo.create(input);
    } catch (error) {
      handleRepositoryError(error, 'create user', this.logger, LogCategory.SCIM_USER, { userName: dto.userName, endpointId });
    }

    this.logger.info(LogCategory.SCIM_USER, 'User created', { scimId, userName: dto.userName, endpointId });
    return this.toScimUserResource(created, baseUrl, endpointId);
  }

  async getUserForEndpoint(scimId: string, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimUserResource> {
    this.logger.enrichContext({ resourceType: 'User', resourceId: scimId, operation: 'get' });
    this.logger.debug(LogCategory.SCIM_USER, 'Get user', { scimId, endpointId });
    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'User not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    return this.toScimUserResource(user, baseUrl, endpointId);
  }

  async listUsersForEndpoint(
    { filter, startIndex = 1, count = DEFAULT_COUNT, sortBy, sortOrder }: ListUsersParams,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
  ): Promise<ScimListResponse<ScimUserResource>> {
    this.logger.enrichContext({ resourceType: 'User', operation: 'list' });
    if (count > MAX_COUNT) {
      count = MAX_COUNT;
    }

    this.logger.info(LogCategory.SCIM_USER, 'List users', { filter, startIndex, count, endpointId });

    let filterResult;
    try {
      filterResult = buildUserFilter(filter, this.schemaHelpers.getCaseExactAttributes(endpointId));
    } catch (e) {
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: `Unsupported or invalid filter expression: '${filter}'.`,
        diagnostics: { errorCode: 'FILTER_INVALID', parseError: (e as Error).message },
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
    let resources = allDbUsers.map((user) => this.toScimUserResource(user, baseUrl, endpointId));

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
    this.logger.enrichContext({ resourceType: 'User', resourceId: scimId, operation: 'patch' });
    ensureSchema(patchDto.schemas, SCIM_PATCH_SCHEMA);

    this.logger.info(LogCategory.SCIM_PATCH, 'Patch user', { scimId, endpointId, opCount: patchDto.Operations?.length });
    this.logger.debug(LogCategory.SCIM_PATCH, 'Patch operations', {
      operations: patchDto.Operations?.map(o => ({ op: o.op, path: o.path })),
    });
    this.logger.trace(LogCategory.SCIM_PATCH, 'Patch user full payload', { body: patchDto as unknown as Record<string, unknown> });

    const user = await this.userRepo.findByScimId(endpointId, scimId);
    
    if (!user) {
      this.logger.debug(LogCategory.SCIM_PATCH, 'Patch target not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(user.version, ifMatch, config);

    const updatedData = await this.applyPatchOperationsForEndpoint(user, patchDto, endpointId, config);

    let updatedUser: UserRecord;
    try {
      updatedUser = await this.userRepo.update(user.id, updatedData);
    } catch (error) {
      handleRepositoryError(error, 'patch user', this.logger, LogCategory.SCIM_PATCH, { scimId, endpointId });
    }

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
    this.logger.enrichContext({ resourceType: 'User', resourceId: scimId, operation: 'replace' });
    ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);
    this.schemaHelpers.enforceStrictSchemaValidation(dto, endpointId, config);

    // Coerce boolean strings before schema validation (same as create path - parent-aware)
    this.schemaHelpers.coerceBooleansByParentIfEnabled(dto as Record<string, unknown>, endpointId, config);

    // G8h: Enforce primary sub-attribute constraint (RFC 7643 section 2.4)
    this.schemaHelpers.enforcePrimaryConstraint(dto as Record<string, unknown>, endpointId, config);

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
      this.logger.debug(LogCategory.SCIM_USER, 'Replace target not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(user.version, ifMatch, config);

    // H-2: Immutable attribute enforcement - compare existing resource with incoming payload
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(user), dto, endpointId, config);

    await this.assertUniqueUserNameForEndpoint(dto.userName, endpointId, scimId);

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrs = this.schemaHelpers.getUniqueAttributes(endpointId);
    if (uniqueAttrs.length > 0) {
      const allUsers = await this.userRepo.findAll(endpointId, {});
      assertSchemaUniqueness(endpointId, dto as unknown as Record<string, unknown>, uniqueAttrs, allUsers.map(u => ({ scimId: u.scimId, rawPayload: u.rawPayload })), scimId);
    }

    const now = new Date();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);
    const meta = parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    const data: UserUpdateInput = {
      externalId: dto.externalId ?? null,
      userName: dto.userName,
      displayName: typeof dto.displayName === 'string' ? dto.displayName : null,
      active: (dto.active as boolean) ?? true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        ...meta,
        lastModified: now.toISOString()
      })
    };

    let updatedUser: UserRecord;
    try {
      updatedUser = await this.userRepo.update(user.id, data);
    } catch (error) {
      handleRepositoryError(error, 'replace user', this.logger, LogCategory.SCIM_USER, { scimId, endpointId });
    }

    this.logger.info(LogCategory.SCIM_USER, 'User replaced', { scimId, userName: dto.userName, endpointId });
    return this.toScimUserResource(updatedUser, baseUrl, endpointId);
  }

  async deleteUserForEndpoint(scimId: string, endpointId: string, config?: EndpointConfig, ifMatch?: string): Promise<void> {
    this.logger.enrichContext({ resourceType: 'User', resourceId: scimId, operation: 'delete' });
    this.logger.info(LogCategory.SCIM_USER, 'Delete user', { scimId, endpointId });
    const user = await this.userRepo.findByScimId(endpointId, scimId);

    if (!user) {
      this.logger.debug(LogCategory.SCIM_USER, 'Delete target not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    // Settings v7: Gate hard delete behind UserHardDeleteEnabled (default: true)
    const hardDeleteEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED);
    if (!hardDeleteEnabled) {
      this.logger.info(LogCategory.SCIM_USER, 'Hard delete disabled for users', { scimId, endpointId });
      throw createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: 'User hard delete is not enabled for this endpoint.',
        diagnostics: { errorCode: 'HARD_DELETE_DISABLED', triggeredBy: 'UserHardDeleteEnabled' },
      });
    }

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(user.version, ifMatch, config);

    try {
      await this.userRepo.delete(user.id);
    } catch (error) {
      handleRepositoryError(error, 'delete user', this.logger, LogCategory.SCIM_USER, { scimId, endpointId });
    }
    this.logger.info(LogCategory.SCIM_USER, 'User hard-deleted', { scimId, endpointId });
  }

  // ===== Private Helper Methods =====

  // ===== Private Helper Methods =====
  // G17: Most helpers extracted to ../common/scim-service-helpers.ts
  // Only User-specific methods remain here.

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

  /**
   * Assert userName uniqueness within the endpoint (case-insensitive).
   * externalId and displayName are NOT checked - saved as received per RFC 7643.
   */
  private async assertUniqueUserNameForEndpoint(
    userName: string,
    endpointId: string,
    excludeScimId?: string
  ): Promise<void> {
    const conflict = await this.userRepo.findConflict(
      endpointId,
      userName,
      excludeScimId,
    );

    if (conflict) {
      this.logger.info(LogCategory.SCIM_USER, `Uniqueness conflict on PUT/PATCH: userName '${userName}'`, {
        endpointId, conflictScimId: conflict.scimId,
      });
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A resource with userName '${userName}' already exists.`,
        diagnostics: {
          errorCode: 'UNIQUENESS_USERNAME',
          operation: 'replace',
          conflictingResourceId: conflict.scimId,
          conflictingAttribute: 'userName',
          incomingValue: userName,
        },
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

    // V2: Pre-PATCH validation - validate each operation value against its schema attribute
    if (strictSchemaEnabled) {
      const resultPayloadPlaceholder: Record<string, unknown> = {
        schemas: [SCIM_CORE_USER_SCHEMA],
      };
      for (const urn of extensionUrns) {
        (resultPayloadPlaceholder.schemas as string[]).push(urn);
      }
      const schemaDefs = this.schemaHelpers.buildSchemaDefinitions(resultPayloadPlaceholder, endpointId);

      // Coerce boolean strings in PATCH operation values before validation (parent-aware)
      const coerceEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS);
      if (coerceEnabled) {
        const boolMap = this.schemaHelpers.getBooleansByParent(endpointId);
        const coreUrnLower = this.schemaHelpers.getCoreSchemaUrnLower(endpointId);
        coercePatchOpBooleans(patchDto.Operations, boolMap, coreUrnLower);
      }

      for (const [opIndex, op] of patchDto.Operations.entries()) {
        const preResult = SchemaValidator.validatePatchOperationValue(
          op.op, op.path, op.value, schemaDefs,
          this.schemaHelpers.getAttrMaps(endpointId),
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
            },
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
        throw createScimError({ status: err.status, scimType: err.scimType, detail: err.message, diagnostics: { errorCode: 'VALIDATION_PATCH', triggeredBy: 'PatchEngine', failedOperationIndex: err.operationIndex, failedPath: err.failedPath, failedOp: err.failedOp } });
      }
      throw err;
    }

    const { extractedFields, payload } = result;

    // Settings v7: Gate soft-delete behind UserSoftDeleteEnabled (default: true)
    if (extractedFields.active === false) {
      const softDeleteEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.USER_SOFT_DELETE_ENABLED);
      if (!softDeleteEnabled) {
        this.logger.info(LogCategory.SCIM_PATCH, 'Soft-delete (deactivation) disabled for users', { scimId: user.scimId, endpointId });
        throw createScimError({
          status: 400,
          scimType: 'invalidValue',
          detail: 'User soft-delete (active=false) is not enabled for this endpoint.',
          diagnostics: { errorCode: 'SOFT_DELETE_DISABLED', triggeredBy: 'UserSoftDeleteEnabled' },
        });
      }
    }

    // H-1: Post-PATCH schema validation - validate the resulting payload
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
    // literals into the result payload - this converts them to native booleans.
    this.schemaHelpers.coerceBooleansByParentIfEnabled(resultPayload, endpointId, config);

    // G8h: Enforce primary on merged post-PATCH payload (RFC 7643 section 2.4)
    this.schemaHelpers.enforcePrimaryConstraint(resultPayload, endpointId, config);

    this.schemaHelpers.validatePayloadSchema(resultPayload, endpointId, config, 'patch');

    // H-2: Immutable attribute enforcement - compare existing state with PATCH result
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(user), resultPayload, endpointId, config);

    await this.assertUniqueUserNameForEndpoint(
      extractedFields.userName ?? user.userName,
      endpointId,
      user.scimId,
    );

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrs = this.schemaHelpers.getUniqueAttributes(endpointId);
    if (uniqueAttrs.length > 0) {
      const allUsers = await this.userRepo.findAll(endpointId, {});
      assertSchemaUniqueness(endpointId, resultPayload, uniqueAttrs, allUsers.map(u => ({ scimId: u.scimId, rawPayload: u.rawPayload })), user.scimId);
    }

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

    // Parent-context-aware boolean sanitization - uses precomputed Parent→Children maps
    // for precision. Prevents name-collision false positives (e.g., core `active` boolean
    // vs extension `active` string). Also prevents corruption of string attributes.
    const boolMap = this.schemaHelpers.getBooleansByParent(endpointId);
    const coreUrnLower = this.schemaHelpers.getCoreSchemaUrnLower(endpointId);
    sanitizeBooleanStringsByParent(rawPayload, boolMap, coreUrnLower);

    // G8e: Strip returned:'never' attributes + build schemas[] dynamically (G19 / FP-1)
    const neverByParent = this.schemaHelpers.getNeverReturnedByParent(endpointId);
    const extensionUrns = this.schemaHelpers.getExtensionUrns(endpointId);
    const visibleExtUrns = stripNeverReturnedFromPayload(rawPayload, neverByParent, coreUrnLower, extensionUrns);
    const schemas: [string, ...string[]] = [SCIM_CORE_USER_SCHEMA, ...visibleExtUrns];

    // Remove reserved server-assigned attributes from rawPayload to prevent overwriting
    // (e.g., a client-supplied "id" in the POST body must never override scimId)
    delete rawPayload.id;
    // Remove schemas from rawPayload - we built it dynamically above (G19 / FP-1)
    delete rawPayload.schemas;

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
   * Get the returned:'always' ByParent map for projection.
   */
  getAlwaysReturnedByParent(endpointId?: string): Map<string, Set<string>> {
    return this.schemaHelpers.getAlwaysReturnedByParent(endpointId);
  }

  /**
   * Get the returned:'request' ByParent map for projection.
   */
  getRequestReturnedByParent(endpointId?: string): Map<string, Set<string>> {
    return this.schemaHelpers.getRequestReturnedByParent(endpointId);
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
    delete additional.id;  // RFC 7643 §3.1: id is assigned by the service provider - ignore client-supplied values

    return {
      schemas,
      ...additional
    };
  }
}
