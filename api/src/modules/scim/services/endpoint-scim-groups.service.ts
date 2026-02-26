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
import { getConfigBoolean, getConfigBooleanWithDefault, ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { createScimError } from '../common/scim-errors';
import { assertIfMatch } from '../interceptors/scim-etag.interceptor';
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
import { GroupPatchEngine } from '../../../domain/patch/group-patch-engine';
import { PatchError } from '../../../domain/patch/patch-error';
import { SchemaValidator } from '../../../domain/validation';
import type { SchemaDefinition } from '../../../domain/validation';

interface ListGroupsParams {
  filter?: string;
  startIndex?: number;
  count?: number;
}

/**
 * Endpoint-specific SCIM Groups Service
 * Handles all group operations scoped to a specific endpoint
 */
@Injectable()
export class EndpointScimGroupsService {
  constructor(
    @Inject(GROUP_REPOSITORY)
    private readonly groupRepo: IGroupRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly metadata: ScimMetadataService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly logger: ScimLogger,
    private readonly schemaRegistry: ScimSchemaRegistry,
  ) {}

  async createGroupForEndpoint(dto: CreateGroupDto, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimGroupResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);
    this.enforceStrictSchemaValidation(dto as unknown as Record<string, unknown>, endpointId, config);

    // Coerce boolean strings ("True"/"False") to native booleans before schema validation
    this.coerceBooleanStringsIfEnabled(dto as unknown as Record<string, unknown>, endpointId, config);

    this.validatePayloadSchema(dto as unknown as Record<string, unknown>, endpointId, config, 'create');

    this.logger.info(LogCategory.SCIM_GROUP, 'Creating group', { displayName: dto.displayName, memberCount: dto.members?.length ?? 0, endpointId });
    this.logger.trace(LogCategory.SCIM_GROUP, 'Create group payload', { body: dto as unknown as Record<string, unknown> });

    // Extract externalId from the DTO (it may come as a top-level property from Entra)
    const externalId = typeof (dto as Record<string, unknown>).externalId === 'string'
      ? (dto as Record<string, unknown>).externalId as string
      : null;

    // Check for duplicate displayName — if conflict is with a soft-deleted resource and
    // ReprovisionOnConflictForSoftDeletedResource is enabled, re-activate it instead of 409.
    const displayNameConflict = await this.groupRepo.findByDisplayName(endpointId, dto.displayName);
    if (displayNameConflict) {
      const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
      const reprovision = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED);

      if (softDelete && reprovision && displayNameConflict.deletedAt != null) {
        this.logger.info(LogCategory.SCIM_GROUP, 'Re-provisioning soft-deleted group', { scimId: displayNameConflict.scimId, displayName: dto.displayName, endpointId });
        return this.reprovisionGroup(displayNameConflict.scimId, dto, externalId, baseUrl, endpointId);
      }

      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A group with displayName '${dto.displayName}' already exists.`,
      });
    }

    // Check for duplicate externalId within the endpoint
    if (externalId) {
      const externalIdConflict = await this.groupRepo.findByExternalId(endpointId, externalId);
      if (externalIdConflict) {
        const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
        const reprovision = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED);

        if (softDelete && reprovision && externalIdConflict.deletedAt != null) {
          this.logger.info(LogCategory.SCIM_GROUP, 'Re-provisioning soft-deleted group (externalId match)', { scimId: externalIdConflict.scimId, externalId, endpointId });
          return this.reprovisionGroup(externalIdConflict.scimId, dto, externalId, baseUrl, endpointId);
        }

        throw createScimError({
          status: 409,
          scimType: 'uniqueness',
          detail: `A group with externalId '${externalId}' already exists.`,
        });
      }
    }

    const now = new Date();
    const scimId = dto.id && typeof dto.id === 'string' ? dto.id : randomUUID();

    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const input: GroupCreateInput = {
      endpointId,
      scimId,
      externalId,
      displayName: dto.displayName,
      active: true,
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'Group',
        created: now.toISOString(),
        lastModified: now.toISOString()
      }),
    };

    const group = await this.groupRepo.create(input);

    const members = dto.members ?? [];
    if (members.length > 0) {
      const memberInputs = await this.resolveMemberInputs(members, endpointId);
      await this.groupRepo.addMembers(String(group.id), memberInputs);
    }

    const withMembers = await this.groupRepo.findWithMembers(endpointId, String(group.scimId));
    this.logger.info(LogCategory.SCIM_GROUP, 'Group created', { scimId, displayName: dto.displayName, endpointId });
    return this.toScimGroupResource(withMembers, baseUrl, endpointId);
  }

  async getGroupForEndpoint(scimId: string, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimGroupResource> {
    this.logger.debug(LogCategory.SCIM_GROUP, 'Get group', { scimId, endpointId });
    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Group not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations
    this.guardSoftDeleted(group, config, scimId);

    return this.toScimGroupResource(group, baseUrl, endpointId);
  }

  async listGroupsForEndpoint(
    { filter, startIndex = 1, count = DEFAULT_COUNT }: ListGroupsParams,
    baseUrl: string,
    endpointId: string,
    config?: EndpointConfig,
  ): Promise<ScimListResponse<ScimGroupResource>> {
    if (count > MAX_COUNT) {
      count = MAX_COUNT;
    }

    this.logger.info(LogCategory.SCIM_GROUP, 'List groups', { filter, startIndex, count, endpointId });

    let filterResult;
    try {
      filterResult = buildGroupFilter(filter);
    } catch {
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: `Unsupported or invalid filter expression: '${filter}'.`
      });
    }

    // Fetch groups from DB (repository handles endpointId scoping + member include)
    const allGroups = await this.groupRepo.findAllWithMembers(
      endpointId,
      filterResult.dbWhere,
      { field: 'createdAt', direction: 'asc' },
    );

    // Build SCIM resources and apply in-memory filter if needed
    // RFC 7644 §3.6: Soft-deleted resources (deletedAt set) MUST be omitted from future query results
    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
    const filteredGroups = softDelete
      ? allGroups.filter((g) => g.deletedAt == null)
      : allGroups;
    let resources = filteredGroups.map((g) => this.toScimGroupResource(g, baseUrl, endpointId));

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
    this.ensureSchema(dto.schemas, SCIM_PATCH_SCHEMA);

    this.logger.info(LogCategory.SCIM_PATCH, 'Patch group', { scimId, endpointId, opCount: dto.Operations?.length });
    this.logger.debug(LogCategory.SCIM_PATCH, 'Patch group operations', {
      operations: dto.Operations?.map(o => ({ op: o.op, path: o.path })),
    });
    this.logger.trace(LogCategory.SCIM_PATCH, 'Patch group full payload', { body: dto as unknown as Record<string, unknown> });

    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations
    this.guardSoftDeleted(group, config, scimId);

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(group.version, ifMatch, config);

    // Get endpoint config for behavior flags (use passed config or fallback to context)
    const endpointConfig = config ?? this.endpointContext.getConfig();
    const allowMultiMemberAdd = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP);
    const allowMultiMemberRemove = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP);
    // PatchOpAllowRemoveAllMembers defaults to true if not explicitly set
    const allowRemoveAllMembers = endpointConfig?.[ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS] === undefined 
      ? true 
      : getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS);

    const extensionUrns = this.schemaRegistry.getExtensionUrns(endpointId);

    // V2: Pre-PATCH validation — validate each operation value against schema definitions
    if (getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      const resultPayloadPlaceholder: Record<string, unknown> = {
        schemas: [SCIM_CORE_GROUP_SCHEMA],
      };
      for (const urn of extensionUrns) {
        (resultPayloadPlaceholder.schemas as string[]).push(urn);
      }
      const schemaDefs = this.buildSchemaDefinitions(resultPayloadPlaceholder, endpointId);

      // Coerce boolean strings in PATCH operation values before validation
      const coerceEnabled = getConfigBooleanWithDefault(endpointConfig, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS, true);
      if (coerceEnabled) {
        const booleanKeys = this.getGroupBooleanKeys(endpointId);
        for (const op of dto.Operations) {
          if (op.value && typeof op.value === 'object' && !Array.isArray(op.value)) {
            this.sanitizeBooleanStrings(op.value as Record<string, unknown>, booleanKeys);
          } else if (Array.isArray(op.value)) {
            for (const item of op.value) {
              if (typeof item === 'object' && item !== null) {
                this.sanitizeBooleanStrings(item as Record<string, unknown>, booleanKeys);
              }
            }
          }
        }
      }

      for (const op of dto.Operations) {
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

    let patchResult;
    try {
      patchResult = GroupPatchEngine.apply(
        dto.Operations,
        {
          displayName: group.displayName,
          externalId: group.externalId ?? null,
          members: this.memberRecordsToDtos(group.members),
          rawPayload: this.parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}')),
        },
        { allowMultiMemberAdd, allowMultiMemberRemove, allowRemoveAllMembers, extensionUrns },
      );
    } catch (err) {
      if (err instanceof PatchError) {
        throw createScimError({ status: err.status, scimType: err.scimType, detail: err.message });
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

    // Coerce boolean strings in post-PATCH payload before schema validation
    this.coerceBooleanStringsIfEnabled(resultPayload, endpointId, config);

    this.validatePayloadSchema(resultPayload, endpointId, config, 'patch');

    // H-2: Immutable attribute enforcement — compare existing state with PATCH result
    this.checkImmutableAttributes(group, resultPayload, endpointId, config);

    // G8f: Uniqueness enforcement on PATCH — displayName and externalId must remain unique
    await this.assertUniqueDisplayName(displayName, endpointId, scimId);
    if (externalId) {
      await this.assertUniqueExternalId(externalId, endpointId, scimId);
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
          ...this.parseJson<Record<string, unknown>>(String(group.meta ?? '{}')),
          lastModified: new Date().toISOString()
        })
      }, memberInputs);
    } catch (error) {
      this.logger.error(LogCategory.SCIM_PATCH, 'Transaction failed during group patch', { scimId, endpointId, error: String(error) });
      throw createScimError({
        status: 500,
        detail: `Failed to update group: ${error instanceof Error ? error.message : 'transaction error'}`,
      });
    }

    // RFC 7644 §3.5.2: Return the updated resource with 200 OK
    const updatedGroup = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!updatedGroup) {
      throw createScimError({ status: 500, detail: 'Failed to retrieve updated group.' });
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
    this.ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);
    this.enforceStrictSchemaValidation(dto as unknown as Record<string, unknown>, endpointId, config);

    // Coerce boolean strings before schema validation (same as create path)
    this.coerceBooleanStringsIfEnabled(dto as unknown as Record<string, unknown>, endpointId, config);

    this.validatePayloadSchema(dto as unknown as Record<string, unknown>, endpointId, config, 'replace');

    this.logger.info(LogCategory.SCIM_GROUP, 'Replace group (PUT)', { scimId, displayName: dto.displayName, endpointId });

    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations
    this.guardSoftDeleted(group, config, scimId);

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(group.version, ifMatch, config);

    // H-2: Immutable attribute enforcement — compare existing resource with incoming payload
    this.checkImmutableAttributes(group, dto as unknown as Record<string, unknown>, endpointId, config);

    // G8f: Uniqueness enforcement on PUT — displayName and externalId must remain unique
    await this.assertUniqueDisplayName(dto.displayName, endpointId, scimId);
    const newExternalId = typeof (dto as Record<string, unknown>).externalId === 'string'
      ? (dto as Record<string, unknown>).externalId as string
      : null;
    if (newExternalId) {
      await this.assertUniqueExternalId(newExternalId, endpointId, scimId);
    }

    const now = new Date();
    const meta = this.parseJson<Record<string, unknown>>(String(group.meta ?? '{}'));

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
      this.logger.error(LogCategory.SCIM_GROUP, 'Transaction failed during group replace', { scimId, endpointId, error: String(error) });
      throw createScimError({
        status: 500,
        detail: `Failed to replace group: ${error instanceof Error ? error.message : 'transaction error'}`,
      });
    }

    // Return updated group
    const updatedGroup = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!updatedGroup) {
      throw createScimError({ status: 500, detail: 'Failed to retrieve updated group.' });
    }

    return this.toScimGroupResource(updatedGroup, baseUrl, endpointId);
  }

  async deleteGroupForEndpoint(scimId: string, endpointId: string, config?: EndpointConfig, ifMatch?: string): Promise<void> {
    this.logger.info(LogCategory.SCIM_GROUP, 'Delete group', { scimId, endpointId });
    const group = await this.groupRepo.findByScimId(endpointId, scimId);

    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Delete target group not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // RFC 7644 §3.6: Soft-deleted resources MUST return 404 for all operations (double-delete)
    this.guardSoftDeleted(group, config, scimId);

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(group.version, ifMatch, config);

    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);

    if (softDelete) {
      this.logger.info(LogCategory.SCIM_GROUP, 'Soft-deleting group (setting active=false + deletedAt)', { scimId, endpointId });
      await this.groupRepo.update(group.id, { active: false, deletedAt: new Date() });
      this.logger.info(LogCategory.SCIM_GROUP, 'Group soft-deleted', { scimId, endpointId });
    } else {
      await this.groupRepo.delete(group.id);
      this.logger.info(LogCategory.SCIM_GROUP, 'Group hard-deleted', { scimId, endpointId });
    }
  }

  // ===== Private Helper Methods =====

  /**
   * RFC 7644 §3.6: Guard against operations on soft-deleted resources.
   *
   * When SoftDeleteEnabled is active, a resource with deletedAt set is considered
   * deleted and MUST return 404 for all subsequent operations (GET, PATCH, PUT, DELETE).
   * Note: A group disabled via PATCH (active=false) is NOT soft-deleted — only DELETE sets deletedAt.
   */
  private guardSoftDeleted(group: GroupWithMembers | { active: boolean; deletedAt?: Date | null }, config: EndpointConfig | undefined, scimId: string): void {
    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
    if (softDelete && group.deletedAt != null) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Soft-deleted group accessed — returning 404', { scimId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }
  }

  /**
   * Re-provision a soft-deleted group: reactivate with new payload data and members.
   * Called when ReprovisionOnConflictForSoftDeletedResource is enabled and
   * a POST conflicts with a soft-deleted group.
   */
  private async reprovisionGroup(
    existingScimId: string,
    dto: CreateGroupDto,
    externalId: string | null,
    baseUrl: string,
    endpointId: string,
  ): Promise<ScimGroupResource> {
    const existing = await this.groupRepo.findWithMembers(endpointId, existingScimId);
    if (!existing) {
      throw createScimError({ status: 500, detail: 'Failed to locate soft-deleted group for re-provisioning.' });
    }

    const now = new Date();
    const sanitizedPayload = this.extractAdditionalAttributes(dto);
    const existingMeta = this.parseJson<Record<string, unknown>>(String(existing.meta ?? '{}'));

    // Resolve incoming members
    const members = dto.members ?? [];
    const memberInputs = members.length > 0
      ? await this.resolveMemberInputs(members, endpointId)
      : [];

    // Update group fields + replace members atomically
    await this.groupRepo.updateGroupWithMembers(existing.id, {
      displayName: dto.displayName,
      externalId,
      active: true,
      deletedAt: null,  // Clear soft-delete marker on re-provisioning
      rawPayload: JSON.stringify(sanitizedPayload),
      meta: JSON.stringify({
        resourceType: 'Group',
        created: (existingMeta.created as string) ?? now.toISOString(),
        lastModified: now.toISOString(),
      }),
    }, memberInputs);

    const withMembers = await this.groupRepo.findWithMembers(endpointId, existingScimId);
    this.logger.info(LogCategory.SCIM_GROUP, 'Group re-provisioned (soft-deleted resource reactivated)', {
      scimId: existingScimId, displayName: dto.displayName, endpointId,
    });
    return this.toScimGroupResource(withMembers, baseUrl, endpointId);
  }

  /**
   * Phase 7: Pre-write If-Match enforcement (RFC 7644 §3.14).
   *
   * When the client sends an If-Match header, the resource's current version-based
   * ETag must match — otherwise 412 Precondition Failed is thrown BEFORE the write.
   * When RequireIfMatch is enabled, a missing If-Match header → 428 Precondition Required.
   */
  private enforceIfMatch(currentVersion: number, ifMatch?: string, config?: EndpointConfig): void {
    const requireIfMatch = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH);

    if (!ifMatch) {
      if (requireIfMatch) {
        throw createScimError({
          status: 428,
          detail: 'If-Match header is required for this operation. Include the resource ETag (e.g., If-Match: W/"v1").',
        });
      }
      return; // If-Match not provided and not required → allow
    }

    const currentETag = `W/"v${currentVersion}"`;
    assertIfMatch(currentETag, ifMatch);
  }

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
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A group with displayName '${displayName}' already exists.`
      });
    }
  }

  /**
   * Assert externalId uniqueness within the endpoint.
   * Per SCIM spec, duplicate externalId should be rejected with 409 Conflict.
   */
  private async assertUniqueExternalId(
    externalId: string,
    endpointId: string,
    excludeScimId?: string
  ): Promise<void> {
    const existing = await this.groupRepo.findByExternalId(endpointId, externalId, excludeScimId);
    if (existing) {
      throw createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: `A group with externalId '${externalId}' already exists.`
      });
    }
  }

  private ensureSchema(schemas: string[] | undefined, requiredSchema: string): void {
    const requiredLower = requiredSchema.toLowerCase();
    if (!schemas || !schemas.some(s => s.toLowerCase() === requiredLower)) {
      throw createScimError({
        status: 400,
        scimType: 'invalidSyntax',
        detail: `Missing required schema '${requiredSchema}'.`
      });
    }
  }

  /**
   * Strict Schema Validation — when StrictSchemaValidation is enabled, reject
   * any request body that contains extension URN keys not listed in the
   * request's `schemas[]` array or not registered in the schema registry.
   */
  private enforceStrictSchemaValidation(
    dto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    const declaredLower = new Set(declaredSchemas.map(s => s.toLowerCase()));
    const registeredUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    const registeredLower = new Set(registeredUrns.map(u => u.toLowerCase()));

    for (const key of Object.keys(dto)) {
      if (key.startsWith('urn:')) {
        const keyLower = key.toLowerCase();
        if (!declaredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidSyntax',
            detail: `Extension URN "${key}" found in request body but not declared in schemas[]. ` +
              `When StrictSchemaValidation is enabled, all extension URNs must be listed in the schemas array.`,
          });
        }
        if (!registeredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidValue',
            detail: `Extension URN "${key}" is not a registered extension schema for this endpoint. ` +
              `Registered extensions: [${registeredUrns.join(', ')}].`,
          });
        }
      }
    }
  }

  /**
   * Phase 8: Attribute-level payload validation against schema definitions.
   *
   * When StrictSchemaValidation is enabled, validates:
   *  - Required attributes are present (create/replace only)
   *  - Attribute types match schema definitions
   *  - Mutability constraints (readOnly rejection)
   *  - Unknown attributes in strict mode
   *  - Multi-valued / single-valued enforcement
   *  - Sub-attribute validation for complex types
   *
   * @see RFC 7643 §2.1 — Attribute Characteristics
   */
  private validatePayloadSchema(
    dto: Record<string, unknown>,
    endpointId: string,
    config: EndpointConfig | undefined,
    mode: 'create' | 'replace' | 'patch',
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const schemas = this.buildSchemaDefinitions(dto, endpointId);
    if (schemas.length === 0) return;

    const result = SchemaValidator.validate(dto, schemas, {
      strictMode: true,
      mode,
    });

    if (!result.valid) {
      const details = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: result.errors[0]?.scimType ?? 'invalidValue',
        detail: `Schema validation failed: ${details}`,
      });
    }
  }

  /**
   * Coerce boolean-typed string values to native booleans on write payloads.
   *
   * Gated by AllowAndCoerceBooleanStrings (default: true). When enabled, converts
   * attributes like primary = "True" → true before schema validation,
   * preventing StrictSchemaValidation from rejecting valid-intent payloads.
   *
   * @see RFC 7644 §3.12 — "Be liberal in what you accept" (Postel's Law)
   */
  private coerceBooleanStringsIfEnabled(
    dto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    const coerceEnabled = getConfigBooleanWithDefault(
      config,
      ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS,
      true,
    );
    if (!coerceEnabled) return;

    const booleanKeys = this.getGroupBooleanKeys(endpointId);
    this.sanitizeBooleanStrings(dto, booleanKeys);
  }

  /**
   * H-2: Immutable attribute enforcement (RFC 7643 §2.2).
   *
   * Compares the existing resource state (from DB) with the incoming payload
   * and rejects changes to attributes declared as immutable.
   * Only runs when StrictSchemaValidation is enabled.
   */
  private checkImmutableAttributes(
    existingGroup: GroupWithMembers,
    incomingDto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const schemas = this.buildSchemaDefinitions(incomingDto, endpointId);
    if (schemas.length === 0) return;

    // Reconstruct existing resource as a SCIM payload for comparison
    const existingPayload = this.buildExistingPayload(existingGroup);

    const result = SchemaValidator.checkImmutable(existingPayload, incomingDto, schemas);

    if (!result.valid) {
      const details = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: 'mutability',
        detail: `Immutable attribute violation: ${details}`,
      });
    }
  }

  /**
   * Build schema definitions from the registry for a given payload.
   * Shared by validatePayloadSchema and checkImmutableAttributes.
   */
  private buildSchemaDefinitions(
    dto: Record<string, unknown>,
    endpointId: string,
  ): SchemaDefinition[] {
    const coreSchema = this.schemaRegistry.getSchema(SCIM_CORE_GROUP_SCHEMA, endpointId);
    const schemas: SchemaDefinition[] = [];
    if (coreSchema) {
      schemas.push(coreSchema as SchemaDefinition);
    }

    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    for (const urn of declaredSchemas) {
      if (urn !== SCIM_CORE_GROUP_SCHEMA) {
        const extSchema = this.schemaRegistry.getSchema(urn, endpointId);
        if (extSchema) {
          schemas.push(extSchema as SchemaDefinition);
        }
      }
    }

    return schemas;
  }

  /**
   * Reconstruct existing group DB record as a SCIM payload object (data only, no meta/location).
   * Used for immutable attribute comparison.
   */
  private buildExistingPayload(group: GroupWithMembers): Record<string, unknown> {
    const rawPayload = this.parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}'));
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
      throw createScimError({ status: 404, scimType: 'noTarget', detail: 'Resource not found.' });
    }

    const meta = this.buildMeta(group, baseUrl);
    const rawPayload = this.parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}'));

    // V17 fix: Schema-aware boolean sanitization for Groups (parity with Users V16 fix).
    // Only convert attributes whose schema type is "boolean" (e.g. extension sub-attrs).
    const booleanKeys = this.getGroupBooleanKeys(endpointId);
    this.sanitizeBooleanStrings(rawPayload, booleanKeys);

    // Remove attributes that have first-class DB columns to prevent stale overrides.
    // displayName is managed via the DB column; rawPayload may hold the original creation value.
    delete rawPayload.displayName;
    delete rawPayload.members;
    delete rawPayload.externalId;
    delete rawPayload.active;
    delete rawPayload.id;  // RFC 7643 §3.1: id is server-assigned — never let rawPayload override

    // G8e: Strip returned:'never' attributes from rawPayload
    // Per RFC 7643 §2.4, these MUST NOT appear in any response.
    const { never: neverAttrs } = this.getGroupReturnedCharacteristics(endpointId);
    for (const key of Object.keys(rawPayload)) {
      if (neverAttrs.has(key.toLowerCase())) {
        delete rawPayload[key];
      }
    }

    // Build schemas[] dynamically — include extension URNs present in payload
    const extensionUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    const schemas: [string, ...string[]] = [SCIM_CORE_GROUP_SCHEMA];
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

    return {
      schemas,
      ...rawPayload,
      id: group.scimId,
      externalId: group.externalId ?? undefined,
      displayName: group.displayName,
      active: group.active,
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

  private parseJson<T>(value: string | null | undefined): T {
    if (!value) {
      return {} as T;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }

  /**
   * Get the returned:'request' attribute names for Group resources.
   * Used by controllers to filter response attributes per RFC 7643 §2.4.
   */
  getRequestOnlyAttributes(endpointId?: string): Set<string> {
    const { request } = this.getGroupReturnedCharacteristics(endpointId);
    return request;
  }

  /**
   * Collect returned characteristic sets (never + request) for Group schemas.
   */
  private getGroupReturnedCharacteristics(endpointId?: string): { never: Set<string>; request: Set<string> } {
    const schemas = this.getGroupSchemaDefinitions(endpointId);
    return SchemaValidator.collectReturnedCharacteristics(schemas);
  }

  /**
   * Get all Group schema definitions (core + extensions) for the endpoint.
   */
  private getGroupSchemaDefinitions(endpointId?: string): SchemaDefinition[] {
    const coreSchema = this.schemaRegistry.getSchema(SCIM_CORE_GROUP_SCHEMA, endpointId);
    const schemas: SchemaDefinition[] = [];
    if (coreSchema) schemas.push(coreSchema as SchemaDefinition);
    const extUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    for (const urn of extUrns) {
      const ext = this.schemaRegistry.getSchema(urn, endpointId);
      if (ext) schemas.push(ext as SchemaDefinition);
    }
    return schemas;
  }

  /**
   * Build the set of boolean attribute names for the Group schema.
   */
  private getGroupBooleanKeys(endpointId?: string): Set<string> {
    const schemas = this.getGroupSchemaDefinitions(endpointId);
    return SchemaValidator.collectBooleanAttributeNames(schemas);
  }

  /**
   * Recursively sanitize boolean-like string values ("True"/"False") to actual booleans,
   * but ONLY for attributes whose schema type is "boolean".
   *
   * V17 fix: Groups service parity with Users V16 fix.
   *
   * @param obj          - The object to sanitize (mutated in place)
   * @param booleanKeys  - Set of lowercase attribute names that are type "boolean"
   */
  private sanitizeBooleanStrings(obj: Record<string, unknown>, booleanKeys: Set<string>): void {
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            this.sanitizeBooleanStrings(item as Record<string, unknown>, booleanKeys);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        this.sanitizeBooleanStrings(value as Record<string, unknown>, booleanKeys);
      } else if (typeof value === 'string' && booleanKeys.has(key.toLowerCase())) {
        const lower = value.toLowerCase();
        if (lower === 'true') obj[key] = true;
        else if (lower === 'false') obj[key] = false;
      }
    }
  }
}
