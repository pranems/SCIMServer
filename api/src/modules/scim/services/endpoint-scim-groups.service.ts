import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { IGroupRepository } from '../../../domain/repositories/group.repository.interface';
import type { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import type {
  GroupWithMembers,
  GroupCreateInput,
  GroupUpdateInput,
  MemberCreateInput,
  MemberRecord,
} from '../../../domain/models/group.model';
import { USER_REPOSITORY, GROUP_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { getConfigBoolean, ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { createScimError } from '../common/scim-errors';
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_SCHEMA
} from '../common/scim-constants';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimGroupResource, ScimListResponse } from '../common/scim-types';
import type { CreateGroupDto, GroupMemberDto } from '../dto/create-group.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';
import { ScimMetadataService } from './scim-metadata.service';
import { buildGroupFilter } from '../filters/apply-scim-filter';
import { resolveGroupSortParams } from '../common/scim-sort.util';
import { GroupPatchEngine } from '../../../domain/patch/group-patch-engine';
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

interface ListGroupsParams {
  filter?: string;
  startIndex?: number;
  count?: number;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
}

/**
 * Endpoint-specific SCIM Groups Service
 * Handles all group operations scoped to a specific endpoint
 */
@Injectable()
export class EndpointScimGroupsService {
  private readonly schemaHelpers: ScimSchemaHelpers;

  constructor(
    @Inject(GROUP_REPOSITORY)
    private readonly groupRepo: IGroupRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly metadata: ScimMetadataService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly logger: ScimLogger,
    private readonly schemaRegistry: ScimSchemaRegistry,
  ) {
    this.schemaHelpers = new ScimSchemaHelpers(schemaRegistry, SCIM_CORE_GROUP_SCHEMA, endpointContext);
  }

  async createGroupForEndpoint(dto: CreateGroupDto, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimGroupResource> {
    this.logger.enrichContext({ resourceType: 'Group', operation: 'create' });
    ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);

    // Resolve config: use passed config or fall back to endpoint context
    const endpointConfig = config ?? this.endpointContext.getConfig();

    this.schemaHelpers.enforceStrictSchemaValidation(dto as unknown as Record<string, unknown>, endpointId, endpointConfig);

    // Coerce boolean strings ("True"/"False") to native booleans before schema validation (parent-aware)
    this.schemaHelpers.coerceBooleansByParentIfEnabled(dto as unknown as Record<string, unknown>, endpointId, endpointConfig);

    this.schemaHelpers.validatePayloadSchema(dto as unknown as Record<string, unknown>, endpointId, endpointConfig, 'create');

    // Strip readOnly attributes from POST payload (RFC 7643 §2.2)
    const strippedAttrs = this.schemaHelpers.stripReadOnlyAttributesFromPayload(dto as unknown as Record<string, unknown>, endpointId);
    if (strippedAttrs.length > 0) {
      this.logger.warn(LogCategory.SCIM_GROUP, 'Stripped readOnly attributes from POST payload', {
        attributes: strippedAttrs,
      });
      this.endpointContext.addWarnings(
        strippedAttrs.map(attr => `Attribute '${attr}' is readOnly and was ignored`),
      );
    }

    this.logger.info(LogCategory.SCIM_GROUP, 'Creating group', { displayName: dto.displayName, memberCount: dto.members?.length ?? 0, endpointId });
    this.logger.trace(LogCategory.SCIM_GROUP, 'Create group payload', { body: dto as unknown as Record<string, unknown> });

    // Extract externalId from the DTO (it may come as a top-level property from Entra)
    const externalId = typeof (dto as Record<string, unknown>).externalId === 'string'
      ? (dto as Record<string, unknown>).externalId as string
      : null;

    // Check for duplicate displayName — always throw 409 on conflict
    const displayNameConflict = await this.groupRepo.findByDisplayName(endpointId, dto.displayName);
    if (displayNameConflict) {
      this.logger.info(LogCategory.SCIM_GROUP, `Uniqueness conflict on POST: displayName '${dto.displayName}'`, {
        endpointId, conflictScimId: displayNameConflict.scimId,
      });
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A group with displayName '${dto.displayName}' already exists.`,
        diagnostics: {
          errorCode: 'UNIQUENESS_DISPLAY_NAME',
          operation: 'create',
          conflictingResourceId: displayNameConflict.scimId,
          conflictingAttribute: 'displayName',
          incomingValue: dto.displayName,
        },
      });
    }

    // Note: externalId is NOT checked for uniqueness — saved as received per RFC 7643.

    const now = new Date();
    // BF-1: Server MUST generate id (RFC 7643 §2.2 — id is readOnly, server-assigned)
    const scimId = randomUUID();

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrs = this.schemaHelpers.getUniqueAttributes(endpointId);
    if (uniqueAttrs.length > 0) {
      const allGroups = await this.groupRepo.findAllWithMembers(endpointId, {});
      assertSchemaUniqueness(endpointId, dto as unknown as Record<string, unknown>, uniqueAttrs, allGroups.map(g => ({ scimId: g.scimId, rawPayload: g.rawPayload })));
    }

    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const input: GroupCreateInput = {
      endpointId,
      scimId,
      externalId,
      displayName: dto.displayName,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'Group',
        created: now.toISOString(),
        lastModified: now.toISOString()
      }),
    };

    let group;
    try {
      group = await this.groupRepo.create(input);
    } catch (error) {
      handleRepositoryError(error, 'create group', this.logger, LogCategory.SCIM_GROUP, { displayName: dto.displayName, endpointId });
    }

    const members = dto.members ?? [];
    if (members.length > 0) {
      const memberInputs = await this.resolveMemberInputs(members, endpointId);
      try {
        await this.groupRepo.addMembers(String(group.id), memberInputs);
      } catch (error) {
        handleRepositoryError(error, 'add members to group', this.logger, LogCategory.SCIM_GROUP, { scimId, endpointId });
      }
    }

    const withMembers = await this.groupRepo.findWithMembers(endpointId, String(group.scimId));
    this.logger.info(LogCategory.SCIM_GROUP, 'Group created', { scimId, displayName: dto.displayName, endpointId });
    return this.toScimGroupResource(withMembers, baseUrl, endpointId);
  }

  async getGroupForEndpoint(scimId: string, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimGroupResource> {
    this.logger.enrichContext({ resourceType: 'Group', resourceId: scimId, operation: 'get' });
    this.logger.debug(LogCategory.SCIM_GROUP, 'Get group', { scimId, endpointId });
    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Group not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    return this.toScimGroupResource(group, baseUrl, endpointId);
  }

  async listGroupsForEndpoint(
    { filter, startIndex = 1, count = DEFAULT_COUNT, sortBy, sortOrder }: ListGroupsParams,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
  ): Promise<ScimListResponse<ScimGroupResource>> {
    this.logger.enrichContext({ resourceType: 'Group', operation: 'list' });

    if (count > MAX_COUNT) {
      count = MAX_COUNT;
    }

    this.logger.info(LogCategory.SCIM_GROUP, 'List groups', { filter, startIndex, count, endpointId });

    let filterResult;
    try {
      filterResult = buildGroupFilter(filter, this.schemaHelpers.getCaseExactAttributes(endpointId));
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

    // Fetch groups from DB (repository handles endpointId scoping + member include)
    const sortParams = resolveGroupSortParams(sortBy, sortOrder);
    const allGroups = await this.groupRepo.findAllWithMembers(
      endpointId,
      filterResult.dbWhere,
      sortParams,
    );

    // Build SCIM resources and apply in-memory filter if needed
    let resources = allGroups.map((g) => this.toScimGroupResource(g, baseUrl, endpointId));

    if (filterResult.inMemoryFilter) {
      resources = resources.filter(filterResult.inMemoryFilter);
    }

    const totalResults = resources.length;
    const skip = Math.max(startIndex - 1, 0);
    const take = Math.max(Math.min(count, MAX_COUNT), 0);
    const paginatedResources = resources.slice(skip, skip + take);

    this.logger.debug(LogCategory.SCIM_GROUP, 'List groups result', { totalResults, returned: paginatedResources.length, endpointId });

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: paginatedResources.length,
      Resources: paginatedResources
    };
  }

  async patchGroupForEndpoint(scimId: string, dto: PatchGroupDto, baseUrl: string, endpointId: string, config?: EndpointConfig, ifMatch?: string): Promise<ScimGroupResource> {
    this.logger.enrichContext({ resourceType: 'Group', resourceId: scimId, operation: 'patch' });
    ensureSchema(dto.schemas, SCIM_PATCH_SCHEMA);

    this.logger.info(LogCategory.SCIM_PATCH, 'Patch group', { scimId, endpointId, opCount: dto.Operations?.length });
    this.logger.debug(LogCategory.SCIM_PATCH, 'Patch group operations', {
      operations: dto.Operations?.map(o => ({ op: o.op, path: o.path })),
    });
    this.logger.trace(LogCategory.SCIM_PATCH, 'Patch group full payload', { body: dto as unknown as Record<string, unknown> });

    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      this.logger.debug(LogCategory.SCIM_PATCH, 'Group not found for PATCH', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(group.version, ifMatch, config);

    // Get endpoint config for behavior flags (use passed config or fallback to context)
    const endpointConfig = config ?? this.endpointContext.getConfig();
    // Settings v7: Single flag replaces MultiOpPatchRequestAdd/RemoveMultipleMembersToGroup
    const allowMultiMember = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED);
    const allowMultiMemberAdd = allowMultiMember;
    const allowMultiMemberRemove = allowMultiMember;
    // Settings v7: PatchOpAllowRemoveAllMembers defaults to false
    const allowRemoveAllMembers = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS);

    const extensionUrns = this.schemaHelpers.getExtensionUrns(endpointId);

    // ReadOnly attribute stripping for PATCH operations
    // Matrix: strict OFF → strip; strict ON + IgnorePatchRO ON → strip; strict ON + IgnorePatchRO OFF → keep G8c 400
    const strictSchemaEnabled = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION);
    const ignorePatchReadOnly = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH);
    if (!strictSchemaEnabled || ignorePatchReadOnly) {
      const { filtered, stripped } = this.schemaHelpers.stripReadOnlyFromPatchOps(dto.Operations, endpointId);
      if (stripped.length > 0) {
        this.logger.warn(LogCategory.SCIM_PATCH, 'Stripped readOnly PATCH operations on Group', {
          count: stripped.length,
          attributes: stripped,
        });
        this.endpointContext.addWarnings(
          stripped.map(attr => `Attribute '${attr}' is readOnly and was ignored in PATCH`),
        );
        dto.Operations = filtered;
      }
    }

    // V2: Pre-PATCH validation — validate each operation value against schema definitions
    if (strictSchemaEnabled) {
      const resultPayloadPlaceholder: Record<string, unknown> = {
        schemas: [SCIM_CORE_GROUP_SCHEMA],
      };
      for (const urn of extensionUrns) {
        (resultPayloadPlaceholder.schemas as string[]).push(urn);
      }
      const schemaDefs = this.schemaHelpers.buildSchemaDefinitions(resultPayloadPlaceholder, endpointId);

      // Coerce boolean strings in PATCH operation values before validation (parent-aware)
      const coerceEnabled = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS);
      if (coerceEnabled) {
        const boolMap = this.schemaHelpers.getBooleansByParent(endpointId);
        const coreUrnLower = this.schemaHelpers.getCoreSchemaUrnLower(endpointId);
        coercePatchOpBooleans(dto.Operations, boolMap, coreUrnLower);
      }

      for (const op of dto.Operations) {
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
            diagnostics: { errorCode: 'VALIDATION_SCHEMA', triggeredBy: 'StrictSchemaValidation' },
          });
        }
      }
    }

    let patchResult;
    try {
      patchResult = GroupPatchEngine.apply(
        dto.Operations,
        {
          displayName: group.displayName,
          externalId: group.externalId ?? null,
          members: this.memberRecordsToDtos(group.members),
          rawPayload: parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}')),
        },
        { allowMultiMemberAdd, allowMultiMemberRemove, allowRemoveAllMembers, extensionUrns, caseExactPaths: this.schemaHelpers.getCaseExactAttributes(endpointId) },
      );
    } catch (err) {
      if (err instanceof PatchError) {
        throw createScimError({ status: err.status, scimType: err.scimType, detail: err.message, diagnostics: { errorCode: 'VALIDATION_PATCH', triggeredBy: 'PatchEngine', failedOperationIndex: err.operationIndex, failedPath: err.failedPath, failedOp: err.failedOp } });
      }
      throw err;
    }

    const { displayName, externalId, members: memberDtos, payload: rawPayload } = patchResult;

    // H-1: Post-PATCH schema validation — validate the resulting payload
    const resultPayload: Record<string, unknown> = {
      schemas: [SCIM_CORE_GROUP_SCHEMA],
      displayName,
      externalId,
      members: memberDtos,
      ...rawPayload,
    };
    // Include extension URNs in schemas[] for proper validation
    for (const urn of extensionUrns) {
      if (urn in rawPayload) {
        (resultPayload.schemas as string[]).push(urn);
      }
    }

    // Coerce boolean strings in post-PATCH payload before schema validation (parent-aware)
    this.schemaHelpers.coerceBooleansByParentIfEnabled(resultPayload, endpointId, endpointConfig);

    this.schemaHelpers.validatePayloadSchema(resultPayload, endpointId, endpointConfig, 'patch');

    // H-2: Immutable attribute enforcement — compare existing state with PATCH result
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(group), resultPayload, endpointId, endpointConfig);

    // G8f: Uniqueness enforcement on PATCH — only displayName must remain unique
    // externalId is NOT checked — saved as received per RFC 7643.
    await this.assertUniqueDisplayName(displayName, endpointId, scimId);

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrsPatch = this.schemaHelpers.getUniqueAttributes(endpointId);
    if (uniqueAttrsPatch.length > 0) {
      const allGroups = await this.groupRepo.findAllWithMembers(endpointId, {});
      assertSchemaUniqueness(endpointId, resultPayload, uniqueAttrsPatch, allGroups.map(g => ({ scimId: g.scimId, rawPayload: g.rawPayload })), scimId);
    }

    // Pre-resolve member user IDs OUTSIDE the transaction to minimise lock hold time.
    const memberInputs = memberDtos.length > 0
      ? await this.resolveMemberInputs(memberDtos, endpointId)
      : [];

    try {
      await this.groupRepo.updateGroupWithMembers(group.id, {
        displayName,
        externalId,
        rawPayload: JSON.stringify(rawPayload),
        meta: JSON.stringify({
          ...parseJson<Record<string, unknown>>(String(group.meta ?? '{}')),
          lastModified: new Date().toISOString()
        })
      }, memberInputs);
    } catch (error) {
      handleRepositoryError(error, 'patch group (transaction)', this.logger, LogCategory.SCIM_PATCH, { scimId, endpointId });
    }

    // RFC 7644 §3.5.2: Return the updated resource with 200 OK
    const updatedGroup = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!updatedGroup) {
      this.logger.error(LogCategory.SCIM_PATCH, 'Failed to retrieve group after PATCH', { scimId, endpointId });
      throw createScimError({ status: 500, detail: 'Failed to retrieve updated group.', diagnostics: { errorCode: 'DATABASE_ERROR' } });
    }

    this.logger.info(LogCategory.SCIM_PATCH, 'Group patched', { scimId, endpointId });
    return this.toScimGroupResource(updatedGroup, baseUrl, endpointId);
  }

  async replaceGroupForEndpoint(
    scimId: string,
    dto: CreateGroupDto,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
    ifMatch?: string,
  ): Promise<ScimGroupResource> {
    this.logger.enrichContext({ resourceType: 'Group', resourceId: scimId, operation: 'replace' });
    ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);

    // Resolve config: use passed config or fall back to endpoint context
    const endpointConfig = config ?? this.endpointContext.getConfig();

    this.schemaHelpers.enforceStrictSchemaValidation(dto as unknown as Record<string, unknown>, endpointId, endpointConfig);

    // Coerce boolean strings before schema validation (same as create path — parent-aware)
    this.schemaHelpers.coerceBooleansByParentIfEnabled(dto as unknown as Record<string, unknown>, endpointId, endpointConfig);

    this.schemaHelpers.validatePayloadSchema(dto as unknown as Record<string, unknown>, endpointId, endpointConfig, 'replace');

    // Strip readOnly attributes from PUT payload (RFC 7643 §2.2)
    const strippedAttrs = this.schemaHelpers.stripReadOnlyAttributesFromPayload(dto as unknown as Record<string, unknown>, endpointId);
    if (strippedAttrs.length > 0) {
      this.logger.warn(LogCategory.SCIM_GROUP, 'Stripped readOnly attributes from PUT payload', {
        attributes: strippedAttrs,
      });
      this.endpointContext.addWarnings(
        strippedAttrs.map(attr => `Attribute '${attr}' is readOnly and was ignored`),
      );
    }

    this.logger.info(LogCategory.SCIM_GROUP, 'Replace group (PUT)', { scimId, displayName: dto.displayName, endpointId });

    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Group not found for PUT', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(group.version, ifMatch, endpointConfig);

    // H-2: Immutable attribute enforcement — compare existing resource with incoming payload
    this.schemaHelpers.checkImmutableAttributes(this.buildExistingPayload(group), dto as unknown as Record<string, unknown>, endpointId, endpointConfig);

    // G8f: Uniqueness enforcement on PUT — only displayName must remain unique
    // externalId is NOT checked — saved as received per RFC 7643.
    await this.assertUniqueDisplayName(dto.displayName, endpointId, scimId);
    const newExternalId = typeof (dto as Record<string, unknown>).externalId === 'string'
      ? (dto as Record<string, unknown>).externalId as string
      : null;

    // Schema-driven uniqueness for custom extension attributes (RFC 7643 §2.1)
    const uniqueAttrsPut = this.schemaHelpers.getUniqueAttributes(endpointId);
    if (uniqueAttrsPut.length > 0) {
      const allGroups = await this.groupRepo.findAllWithMembers(endpointId, {});
      assertSchemaUniqueness(endpointId, dto as unknown as Record<string, unknown>, uniqueAttrsPut, allGroups.map(g => ({ scimId: g.scimId, rawPayload: g.rawPayload })), scimId);
    }

    const now = new Date();
    const meta = parseJson<Record<string, unknown>>(String(group.meta ?? '{}'));

    // Pre-resolve member user IDs OUTSIDE the transaction to minimise lock hold time.
    const replaceMemberInputs = (dto.members && dto.members.length > 0)
      ? await this.resolveMemberInputs(dto.members, endpointId)
      : [];

    try {
      await this.groupRepo.updateGroupWithMembers(group.id, {
        displayName: dto.displayName,
        externalId: newExternalId,
        rawPayload: JSON.stringify(this.extractAdditionalAttributes(dto)),
        meta: JSON.stringify({
          ...meta,
          lastModified: now.toISOString()
        })
      }, replaceMemberInputs);
    } catch (error) {
      handleRepositoryError(error, 'replace group (transaction)', this.logger, LogCategory.SCIM_GROUP, { scimId, endpointId });
    }

    // Return updated group
    const updatedGroup = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!updatedGroup) {
      this.logger.error(LogCategory.SCIM_GROUP, 'Failed to retrieve group after PUT', { scimId, endpointId });
      throw createScimError({ status: 500, detail: 'Failed to retrieve updated group.', diagnostics: { errorCode: 'DATABASE_ERROR' } });
    }

    this.logger.info(LogCategory.SCIM_GROUP, 'Group replaced', { scimId, displayName: dto.displayName, endpointId });
    return this.toScimGroupResource(updatedGroup, baseUrl, endpointId);
  }

  async deleteGroupForEndpoint(scimId: string, endpointId: string, config?: EndpointConfig, ifMatch?: string): Promise<void> {
    this.logger.enrichContext({ resourceType: 'Group', resourceId: scimId, operation: 'delete' });
    this.logger.info(LogCategory.SCIM_GROUP, 'Delete group', { scimId, endpointId });
    const group = await this.groupRepo.findByScimId(endpointId, scimId);

    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Delete target group not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    // Phase 7: Pre-write If-Match enforcement
    enforceIfMatch(group.version, ifMatch, config);

    // Settings v7: Gate hard delete behind GroupHardDeleteEnabled (default: true)
    const hardDeleteEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.GROUP_HARD_DELETE_ENABLED);
    if (!hardDeleteEnabled) {
      this.logger.info(LogCategory.SCIM_GROUP, 'Group hard-delete disabled by configuration', { scimId, endpointId });
      throw createScimError({
        status: 400,
        detail: 'Group deletion is disabled for this endpoint.',
        diagnostics: { errorCode: 'DELETE_DISABLED', triggeredBy: 'GroupHardDeleteEnabled' },
      });
    }

    try {
      await this.groupRepo.delete(group.id);
    } catch (error) {
      handleRepositoryError(error, 'delete group', this.logger, LogCategory.SCIM_GROUP, { scimId, endpointId });
    }
    this.logger.info(LogCategory.SCIM_GROUP, 'Group hard-deleted', { scimId, endpointId });
  }

  // ===== Private Helper Methods =====
  // G17: Most helpers extracted to ../common/scim-service-helpers.ts
  // Only Group-specific methods remain here.

  /**
   * Assert displayName uniqueness within the endpoint (case-insensitive).
   * Per SCIM spec, duplicate groups should be rejected with 409 Conflict.
   */
  private async assertUniqueDisplayName(
    displayName: string,
    endpointId: string,
    excludeScimId?: string
  ): Promise<void> {
    // Phase 3: Pass original name — CITEXT (PostgreSQL) / toLowerCase (InMemory) handles case-insensitivity
    const conflict = await this.groupRepo.findByDisplayName(endpointId, displayName, excludeScimId);

    if (conflict) {
      this.logger.info(LogCategory.SCIM_GROUP, `Uniqueness conflict on PUT/PATCH: displayName '${displayName}'`, {
        endpointId, conflictScimId: conflict.scimId,
      });
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A group with displayName '${displayName}' already exists.`,
        diagnostics: {
          errorCode: 'UNIQUENESS_DISPLAY_NAME',
          operation: 'replace',
          conflictingResourceId: conflict.scimId,
          conflictingAttribute: 'displayName',
          incomingValue: displayName,
        },
      });
    }
  }

  /**
   * Reconstruct existing group DB record as a SCIM payload object (data only, no meta/location).
   * Used for immutable attribute comparison.
   */
  private buildExistingPayload(group: GroupWithMembers): Record<string, unknown> {
    const rawPayload = parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}'));
    return {
      ...rawPayload,
      displayName: group.displayName,
      externalId: group.externalId ?? undefined,
      members: group.members.map((member) => ({
        value: member.value,
        display: member.display ?? undefined,
        type: member.type ?? undefined,
      })),
    };
  }

  private async resolveMemberInputs(
    memberDtos: GroupMemberDto[],
    endpointId: string,
  ): Promise<MemberCreateInput[]> {
    const values = memberDtos.map((m) => m.value);
    const users = values.length > 0
      ? await this.userRepo.findByScimIds(endpointId, values)
      : [];
    const userMap = new Map(users.map((u) => [u.scimId, u.id] as const));

    return memberDtos.map((m) => ({
      userId: userMap.get(m.value) ?? null,
      value: m.value,
      type: m.type ?? null,
      display: m.display ?? null,
    }));
  }

  private memberRecordsToDtos(members: MemberRecord[]): GroupMemberDto[] {
    return members.map((member) => ({
      value: member.value,
      display: member.display ?? undefined,
      type: member.type ?? undefined
    }));
  }

  private toScimGroupResource(group: GroupWithMembers | null, baseUrl: string, endpointId?: string): ScimGroupResource {
    if (!group) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: 'Resource not found.', diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }

    const meta = this.buildMeta(group, baseUrl);
    const rawPayload = parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}'));

    // Parent-context-aware boolean sanitization for Groups (uses precomputed cache)
    const boolMap = this.schemaHelpers.getBooleansByParent(endpointId);
    const coreUrnLower = this.schemaHelpers.getCoreSchemaUrnLower(endpointId);
    sanitizeBooleanStringsByParent(rawPayload, boolMap, coreUrnLower);

    // Remove attributes that have first-class DB columns to prevent stale overrides.
    // displayName is managed via the DB column; rawPayload may hold the original creation value.
    delete rawPayload.displayName;
    delete rawPayload.members;
    delete rawPayload.externalId;
    delete rawPayload.id;  // RFC 7643 §3.1: id is server-assigned — never let rawPayload override
    // Remove schemas from rawPayload — we build it dynamically below (G19 / FP-1)
    delete rawPayload.schemas;

    // G8e: Strip returned:'never' attributes + build schemas[] dynamically (G19 / FP-1)
    const neverByParent = this.schemaHelpers.getNeverReturnedByParent(endpointId);
    const extensionUrns = this.schemaHelpers.getExtensionUrns(endpointId);
    const visibleExtUrns = stripNeverReturnedFromPayload(rawPayload, neverByParent, coreUrnLower, extensionUrns);
    const schemas: [string, ...string[]] = [SCIM_CORE_GROUP_SCHEMA, ...visibleExtUrns];

    return {
      schemas,
      ...rawPayload,
      id: group.scimId,
      externalId: group.externalId ?? undefined,
      displayName: group.displayName,
      members: group.members.map((member) => ({
        value: member.value,
        display: member.display ?? undefined,
        type: member.type ?? undefined
      })),
      meta
    };
  }

  private buildMeta(group: GroupWithMembers, baseUrl: string) {
    const createdAt = group.createdAt.toISOString();
    const lastModified = group.updatedAt.toISOString();
    const location = this.metadata.buildLocation(baseUrl, 'Groups', String(group.scimId));

    return {
      resourceType: 'Group',
      created: createdAt,
      lastModified,
      location,
      version: `W/"v${group.version}"`
    };
  }

  private extractAdditionalAttributes(dto: CreateGroupDto): Record<string, unknown> {
    const { schemas, members: _members, externalId: _externalId, ...rest } = dto as CreateGroupDto & { externalId?: string };
    const additional = { ...rest } as Record<string, unknown>;
    delete additional.id;  // RFC 7643 §3.1: id is server-assigned
    return {
      schemas,
      ...additional
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
}
