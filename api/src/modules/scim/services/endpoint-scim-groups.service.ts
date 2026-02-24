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

    this.logger.info(LogCategory.SCIM_GROUP, 'Creating group', { displayName: dto.displayName, memberCount: dto.members?.length ?? 0, endpointId });
    this.logger.trace(LogCategory.SCIM_GROUP, 'Create group payload', { body: dto as unknown as Record<string, unknown> });

    // Check for duplicate displayName within the endpoint (case-insensitive)
    await this.assertUniqueDisplayName(dto.displayName, endpointId);

    // Extract externalId from the DTO (it may come as a top-level property from Entra)
    const externalId = typeof (dto as Record<string, unknown>).externalId === 'string'
      ? (dto as Record<string, unknown>).externalId as string
      : null;

    // Check for duplicate externalId within the endpoint
    if (externalId) {
      await this.assertUniqueExternalId(externalId, endpointId);
    }

    const now = new Date();
    const scimId = dto.id && typeof dto.id === 'string' ? dto.id : randomUUID();

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

  async getGroupForEndpoint(scimId: string, baseUrl: string, endpointId: string): Promise<ScimGroupResource> {
    this.logger.debug(LogCategory.SCIM_GROUP, 'Get group', { scimId, endpointId });
    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Group not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    return this.toScimGroupResource(group, baseUrl, endpointId);
  }

  async listGroupsForEndpoint(
    { filter, startIndex = 1, count = DEFAULT_COUNT }: ListGroupsParams,
    baseUrl: string,
    endpointId: string
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
        { allowMultiMemberAdd, allowMultiMemberRemove, allowRemoveAllMembers },
      );
    } catch (err) {
      if (err instanceof PatchError) {
        throw createScimError({ status: err.status, scimType: err.scimType, detail: err.message });
      }
      throw err;
    }

    const { displayName, externalId, members: memberDtos, payload: rawPayload } = patchResult;

    // SQLite compromise (HIGH): Pre-resolve member user IDs OUTSIDE the transaction to
    // minimise write-lock hold time. Every ms inside $transaction holds the global SQLite
    // writer lock. PostgreSQL’s row-level locking makes this pattern unnecessary.
    // See docs/SQLITE_COMPROMISE_ANALYSIS.md §3.2.3
    // The user data is stable within this request context so the lookup is safe here.
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

    this.logger.info(LogCategory.SCIM_GROUP, 'Replace group (PUT)', { scimId, displayName: dto.displayName, endpointId });

    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    if (!group) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(group.version, ifMatch, config);

    const now = new Date();
    const meta = this.parseJson<Record<string, unknown>>(String(group.meta ?? '{}'));

    const newExternalId = typeof (dto as Record<string, unknown>).externalId === 'string'
      ? (dto as Record<string, unknown>).externalId as string
      : null;

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

    // Phase 7: Pre-write If-Match enforcement
    this.enforceIfMatch(group.version, ifMatch, config);

    const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);

    if (softDelete) {
      this.logger.info(LogCategory.SCIM_GROUP, 'Soft-deleting group (setting active=false)', { scimId, endpointId });
      await this.groupRepo.update(group.id, { active: false });
      this.logger.info(LogCategory.SCIM_GROUP, 'Group soft-deleted', { scimId, endpointId });
    } else {
      await this.groupRepo.delete(group.id);
      this.logger.info(LogCategory.SCIM_GROUP, 'Group hard-deleted', { scimId, endpointId });
    }
  }

  // ===== Private Helper Methods =====

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

    // Remove attributes that have first-class DB columns to prevent stale overrides.
    // displayName is managed via the DB column; rawPayload may hold the original creation value.
    delete rawPayload.displayName;
    delete rawPayload.members;
    delete rawPayload.externalId;
    delete rawPayload.id;  // RFC 7643 §3.1: id is server-assigned — never let rawPayload override

    // Build schemas[] dynamically — include extension URNs present in payload
    const extensionUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    const schemas: [string, ...string[]] = [SCIM_CORE_GROUP_SCHEMA];
    for (const urn of extensionUrns) {
      if (urn in rawPayload) {
        schemas.push(urn);
      }
    }

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
}
