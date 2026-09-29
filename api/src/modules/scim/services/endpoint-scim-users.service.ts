import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { createReadQuery } from '../common/scim-read-query';
import { UserPatchEngine } from '../../../domain/patch/user-patch-engine';
import { PatchError } from '../../../domain/patch/patch-error';
import { SchemaValidator } from '../../../domain/validation';
import {
  parseJson,
  ensureSchema,
  enforceIfMatch,
  sanitizeBooleanStringsByParent,
  coercePatchOpBooleans,
  scopePatchPayloadToTouched,
  stripNeverReturnedFromPayload,
  stripInternalResponseFields,
  ScimSchemaHelpers,
  handleRepositoryError,
} from '../common/scim-service-helpers';
import { resolveNumericLimit } from '../common/capability-resolver';
import { enforcePatchSupported } from '../common/capability-enforcement';
import { SCIM_EVENTS } from '../../stats/scim-events';

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
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.schemaHelpers = new ScimSchemaHelpers(schemaRegistry, SCIM_CORE_USER_SCHEMA, endpointContext);
  }

  async createUserForEndpoint(dto: CreateUserDto, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimUserResource> {
    this.logger.enrichContext({ resourceType: 'User', operation: 'create' });
    ensureSchema(dto.schemas, SCIM_CORE_USER_SCHEMA);
    const strippedAttrs = this.schemaHelpers.stripReadOnlyAttributesFromPayload(dto as Record<string, unknown>, endpointId);
    this.schemaHelpers.enforceStrictSchemaValidation(dto, endpointId, config);

    // Coerce boolean strings ("True"/"False") to native booleans before schema validation.
    // Uses parent-context-aware maps for precision (prevents name-collision false positives).
    this.schemaHelpers.coerceBooleansByParentIfEnabled(dto as Record<string, unknown>, endpointId, config);

    // G8h: Enforce primary sub-attribute constraint (RFC 7643 section 2.4)
    this.schemaHelpers.enforcePrimaryConstraint(dto as Record<string, unknown>, endpointId, config);

    this.schemaHelpers.validatePayloadSchema(dto, endpointId, config, 'create');

    // Strip readOnly attributes (RFC 7643 §2.2: server SHALL ignore client-supplied readOnly values)
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

    const now = new Date();
    const scimId = randomUUID();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const input: UserCreateInput = {
      endpointId,
      scimId,
      externalId: typeof dto.externalId === 'string' ? dto.externalId : null,
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
      created = await this.userRepo.create(input, this.schemaHelpers.getUniquenessPolicy(endpointId));
    } catch (error) {
      handleRepositoryError(error, 'create user', this.logger, LogCategory.SCIM_USER, { userName: dto.userName, endpointId });
    }

    this.logger.info(LogCategory.SCIM_USER, 'User created', { scimId, userName: dto.userName, endpointId });
    this.eventEmitter.emit(SCIM_EVENTS.USER_CREATED, { endpointId, scimId, active: input.active });
    return this.toScimUserResource(created, baseUrl, endpointId);
  }

  async getUserForEndpoint(scimId: string, baseUrl: string, endpointId: string, _config?: EndpointConfig): Promise<ScimUserResource> {
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
    _config?: EndpointConfig,
  ): Promise<ScimListResponse<ScimUserResource>> {
    this.logger.enrichContext({ resourceType: 'User', operation: 'list' });
    // Gap 6: clamp to the per-endpoint filter.maxResults (RFC 7644 §3.4.2.4),
    // falling back to the global MAX_COUNT when the profile does not set it.
    const maxResults = resolveNumericLimit(this.endpointContext.getProfile?.(), (s) => s.filter?.maxResults, MAX_COUNT);
    this.logger.info(LogCategory.SCIM_USER, 'List users', { filter, startIndex, count, endpointId });
    const query = createReadQuery(
      { filter, startIndex, count, sortBy, sortOrder },
      this.schemaHelpers.getSchemaDefinitions(endpointId), maxResults, buildUserFilter,
    );
    // External capability checks stay in controllers: Me also uses this lookup.
    const allDbUsers = await this.userRepo.findAll(
      endpointId,
      query.dbWhere,
      resolveUserSortParams(),
    );
    const page = query.page(
      allDbUsers,
      user => this.toInternalUserResource(user, baseUrl, endpointId),
      user => this.toScimUserResource(user, baseUrl, endpointId),
    );
    this.logger.debug(LogCategory.SCIM_USER, 'List users result', { totalResults: page.totalResults, returned: page.itemsPerPage, endpointId });
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      ...page,
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
    enforcePatchSupported(this.endpointContext.getProfile?.());
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
    const expectedVersion = enforceIfMatch(user.version, ifMatch, config, this.endpointContext.getProfile?.());

    const updatedData = await this.applyPatchOperationsForEndpoint(user, patchDto, endpointId, config);

    let updatedUser: UserRecord;
    try {
      updatedUser = await this.userRepo.update(user.id, updatedData, expectedVersion, this.schemaHelpers.getUniquenessPolicy(endpointId));
    } catch (error) {
      handleRepositoryError(error, 'patch user', this.logger, LogCategory.SCIM_PATCH, { scimId, endpointId });
    }

    this.logger.info(LogCategory.SCIM_PATCH, 'User patched', { scimId, endpointId });
    // Phase J (v0.48.1): broadcast generic update event for cross-tab
    // refresh. The status-changed event below is preserved for the
    // StatsProjectionService active/inactive counters.
    this.eventEmitter.emit(SCIM_EVENTS.USER_UPDATED, { endpointId, scimId });
    if (user.active !== updatedUser.active) {
      this.eventEmitter.emit(SCIM_EVENTS.USER_STATUS_CHANGED, {
        endpointId, scimId, previousActive: user.active, newActive: updatedUser.active,
      });
    }
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
    const strippedAttrs = this.schemaHelpers.stripReadOnlyAttributesFromPayload(dto as Record<string, unknown>, endpointId);
    const user = await this.userRepo.findByScimId(endpointId, scimId);
    if (!user) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }
    const expectedVersion = enforceIfMatch(user.version, ifMatch, config, this.endpointContext.getProfile?.());
    this.schemaHelpers.enforceStrictSchemaValidation(dto, endpointId, config);

    // Coerce boolean strings before schema validation (same as create path - parent-aware)
    this.schemaHelpers.coerceBooleansByParentIfEnabled(dto as Record<string, unknown>, endpointId, config);

    // G8h: Enforce primary sub-attribute constraint (RFC 7643 section 2.4)
    this.schemaHelpers.enforcePrimaryConstraint(dto as Record<string, unknown>, endpointId, config);

    SchemaValidator.prepareReplacement(this.buildExistingPayload(user), dto, this.schemaHelpers.getSchemaDefinitions(endpointId));
    this.schemaHelpers.validatePayloadSchema(dto, endpointId, config, 'replace');

    // Strip readOnly attributes (RFC 7643 §2.2: server SHALL ignore client-supplied readOnly values)
    if (strippedAttrs.length > 0) {
      this.logger.warn(LogCategory.SCIM_USER, 'Stripped readOnly attributes from PUT payload', {
        method: 'PUT', path: `/Users/${scimId}`, stripped: strippedAttrs, endpointId,
      });
      this.endpointContext.addWarnings(strippedAttrs);
    }

    this.logger.info(LogCategory.SCIM_USER, 'Replace user (PUT)', { scimId, userName: dto.userName, endpointId });

    // H-2: Immutable attribute enforcement - compare existing resource with incoming payload
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(user), dto, endpointId, config, 'replace');

    await this.assertUniqueUserNameForEndpoint(dto.userName, endpointId, scimId);

    const now = new Date();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);
    const meta = parseJson<Record<string, unknown>>(String(user.meta ?? '{}'));

    const data: UserUpdateInput = {
      externalId: typeof dto.externalId === 'string' ? dto.externalId : null,
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
      updatedUser = await this.userRepo.update(user.id, data, expectedVersion, this.schemaHelpers.getUniquenessPolicy(endpointId));
    } catch (error) {
      handleRepositoryError(error, 'replace user', this.logger, LogCategory.SCIM_USER, { scimId, endpointId });
    }

    this.logger.info(LogCategory.SCIM_USER, 'User replaced', { scimId, userName: dto.userName, endpointId });
    // Phase J (v0.48.1): broadcast generic update event for cross-tab refresh.
    this.eventEmitter.emit(SCIM_EVENTS.USER_UPDATED, { endpointId, scimId });
    if (user.active !== updatedUser.active) {
      this.eventEmitter.emit(SCIM_EVENTS.USER_STATUS_CHANGED, {
        endpointId, scimId, previousActive: user.active, newActive: updatedUser.active,
      });
    }
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
    const expectedVersion = enforceIfMatch(user.version, ifMatch, config, this.endpointContext.getProfile?.());

    try {
      await this.userRepo.delete(user.id, expectedVersion);
    } catch (error) {
      handleRepositoryError(error, 'delete user', this.logger, LogCategory.SCIM_USER, { scimId, endpointId });
    }
    this.logger.info(LogCategory.SCIM_USER, 'User hard-deleted', { scimId, endpointId });
    this.eventEmitter.emit(SCIM_EVENTS.USER_DELETED, { endpointId, scimId, active: user.active });
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

    // Coercion must precede execution even in lenient mode so primary handoff
    // sees the same native Boolean that will be persisted.
    if (getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS)) {
      coercePatchOpBooleans(patchDto.Operations, this.schemaHelpers.getBooleansByParent(endpointId),
        this.schemaHelpers.getCoreSchemaUrnLower(endpointId));
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
              attributePaths: preResult.errors.map(e => e.path).filter(Boolean),
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
        {
          verbosePatch, extensionUrns, caseExactPaths: this.schemaHelpers.getCaseExactAttributes(endpointId),
          allowAndCoerceBooleanStrings: getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS),
          strictSchema: strictSchemaEnabled,
          ignoreReadOnly: !strictSchemaEnabled || ignorePatchReadOnly,
          onReadOnlyIgnored: path => this.endpointContext.addWarnings([`Attribute '${path}' is readOnly and was ignored in PATCH`]),
          schemaDefinitions: this.schemaHelpers.buildSchemaDefinitions({ schemas: [SCIM_CORE_USER_SCHEMA, ...extensionUrns] }, endpointId),
          normalize: (candidate, operation) => {
            candidate.schemas = [SCIM_CORE_USER_SCHEMA, ...extensionUrns.filter(urn => urn in candidate)];
            this.schemaHelpers.coerceBooleansByParentIfEnabled(candidate, endpointId, config);
            this.schemaHelpers.enforcePrimaryConstraint(candidate, endpointId, config);
            this.schemaHelpers.validatePayloadSchema(
              scopePatchPayloadToTouched(candidate, [operation], extensionUrns), endpointId, config, 'patch',
            );
          },
        },
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

    // Scope strict post-PATCH validation to the attributes this PATCH actually
    // touched, so pre-existing untouched data (e.g. emails stored before this
    // endpoint's schema was corrected) cannot fail a PATCH that never referenced
    // it (RFC 7644 §3.5.2).
    const patchValidationPayload = scopePatchPayloadToTouched(
      resultPayload,
      patchDto.Operations,
      extensionUrns,
    );
    this.schemaHelpers.validatePayloadSchema(patchValidationPayload, endpointId, config, 'patch');

    // H-2: Immutable attribute enforcement - compare existing state with PATCH result
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(user), resultPayload, endpointId, config);

    await this.assertUniqueUserNameForEndpoint(
      extractedFields.userName ?? user.userName,
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
    const resource = this.toInternalUserResource(user, baseUrl, endpointId);
    const visibleExtUrns = stripNeverReturnedFromPayload(
      resource,
      this.schemaHelpers.getNeverReturnedByParent(endpointId),
      this.schemaHelpers.getCoreSchemaUrnLower(endpointId),
      this.schemaHelpers.getExtensionUrns(endpointId),
    );
    resource.schemas = [SCIM_CORE_USER_SCHEMA, ...visibleExtUrns];
    stripInternalResponseFields(resource);
    return resource;
  }

  private toInternalUserResource(user: UserRecord, baseUrl: string, endpointId?: string): ScimUserResource {
    const meta = this.buildMeta(user, baseUrl);
    const rawPayload = parseJson<Record<string, unknown>>(String(user.rawPayload ?? '{}'));

    // Parent-context-aware boolean sanitization - uses precomputed Parent→Children maps
    // for precision. Prevents name-collision false positives (e.g., core `active` boolean
    // vs extension `active` string). Also prevents corruption of string attributes.
    const boolMap = this.schemaHelpers.getBooleansByParent(endpointId);
    const coreUrnLower = this.schemaHelpers.getCoreSchemaUrnLower(endpointId);
    sanitizeBooleanStringsByParent(rawPayload, boolMap, coreUrnLower);

    const extensionUrns = this.schemaHelpers.getExtensionUrns(endpointId);
    const schemas: [string, ...string[]] = [SCIM_CORE_USER_SCHEMA, ...extensionUrns];

    // Remove reserved server-assigned attributes from rawPayload to prevent overwriting
    // (e.g., a client-supplied "id" in the POST body must never override scimId)
    delete rawPayload.id;
    // Remove schemas from rawPayload - we built it dynamically above (G19 / FP-1)
    delete rawPayload.schemas;
    // GAP-2: Remove displayName from rawPayload - DB column is authoritative
    // (matches Groups' hardened pattern: delete blob copy, then set explicit DB column)
    delete rawPayload.displayName;

    return {
      schemas,
      ...rawPayload,
      id: user.scimId,
      userName: user.userName,
      displayName: user.displayName ?? undefined,
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
