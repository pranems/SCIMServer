import { Injectable } from '@nestjs/common';
import type { GroupMember, Prisma } from '../../../generated/prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
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
import type { ScimGroupResource, ScimListResponse } from '../common/scim-types';
import type { CreateGroupDto, GroupMemberDto } from '../dto/create-group.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';
import { ScimMetadataService } from './scim-metadata.service';
import { buildGroupFilter } from '../filters/apply-scim-filter';

interface ListGroupsParams {
  filter?: string;
  startIndex?: number;
  count?: number;
}

// Narrowed type used internally to avoid Prisma JSON 'any' leakage in intersections
interface GroupWithMembers {
  id: string;
  scimId: string;
  externalId: string | null;
  displayName: string;
  rawPayload: string | null;
  meta: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: GroupMember[];
}

/**
 * Endpoint-specific SCIM Groups Service
 * Handles all group operations scoped to a specific endpoint
 */
@Injectable()
export class EndpointScimGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: ScimMetadataService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly logger: ScimLogger,
  ) {}

  async createGroupForEndpoint(dto: CreateGroupDto, baseUrl: string, endpointId: string): Promise<ScimGroupResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);

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

    const group = await this.prisma.scimGroup.create({
      data: {
        scimId,
        externalId,
        displayName: dto.displayName,
        displayNameLower: dto.displayName.toLowerCase(),
        rawPayload: JSON.stringify(sanitizedPayload),
        meta: JSON.stringify({
          resourceType: 'Group',
          created: now.toISOString(),
          lastModified: now.toISOString()
        }),
        endpoint: { connect: { id: endpointId } }
      }
    });

    const members = dto.members ?? [];
    if (members.length > 0) {
      await this.persistMembersForEndpoint(String(group.id), members, endpointId);
    }

    const withMembers = await this.getGroupWithMembersForEndpoint(String(group.scimId), endpointId);
    this.logger.info(LogCategory.SCIM_GROUP, 'Group created', { scimId, displayName: dto.displayName, endpointId });
    return this.toScimGroupResource(withMembers, baseUrl);
  }

  async getGroupForEndpoint(scimId: string, baseUrl: string, endpointId: string): Promise<ScimGroupResource> {
    this.logger.debug(LogCategory.SCIM_GROUP, 'Get group', { scimId, endpointId });
    const group = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Group not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    return this.toScimGroupResource(group, baseUrl);
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

    const where: Prisma.ScimGroupWhereInput = {
      ...filterResult.dbWhere,
      endpointId
    };

    // Fetch groups from DB
    const allGroups = await this.prisma.scimGroup.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { members: true }
    });

    // Build SCIM resources and apply in-memory filter if needed
    let resources = allGroups.map((g) => this.toScimGroupResource(g as GroupWithMembers, baseUrl));
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

  async patchGroupForEndpoint(scimId: string, dto: PatchGroupDto, baseUrl: string, endpointId: string, config?: EndpointConfig): Promise<ScimGroupResource> {
    this.ensureSchema(dto.schemas, SCIM_PATCH_SCHEMA);

    this.logger.info(LogCategory.SCIM_PATCH, 'Patch group', { scimId, endpointId, opCount: dto.Operations?.length });
    this.logger.debug(LogCategory.SCIM_PATCH, 'Patch group operations', {
      operations: dto.Operations?.map(o => ({ op: o.op, path: o.path })),
    });
    this.logger.trace(LogCategory.SCIM_PATCH, 'Patch group full payload', { body: dto as unknown as Record<string, unknown> });

    const group = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!group) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    // Get endpoint config for behavior flags (use passed config or fallback to context)
    const endpointConfig = config ?? this.endpointContext.getConfig();
    const allowMultiMemberAdd = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP);
    const allowMultiMemberRemove = getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP);
    // PatchOpAllowRemoveAllMembers defaults to true if not explicitly set
    const allowRemoveAllMembers = endpointConfig?.[ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS] === undefined 
      ? true 
      : getConfigBoolean(endpointConfig, ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS);

    let displayName: string = group.displayName;
    let externalId: string | null = group.externalId ?? null;
    let memberDtos: GroupMemberDto[] = this.memberEntitiesToDtos(group.members);
    let rawPayload = this.parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}'));

    for (const operation of dto.Operations) {
      const op = operation.op?.toLowerCase();
      switch (op) {
        case 'replace':
          ({ displayName, externalId, members: memberDtos, rawPayload } = this.handleReplace(operation, displayName, externalId, memberDtos, rawPayload));
          break;
        case 'add':
          memberDtos = this.handleAdd(operation, memberDtos, allowMultiMemberAdd);
          break;
        case 'remove':
          memberDtos = this.handleRemove(operation, memberDtos, allowMultiMemberRemove, allowRemoveAllMembers);
          break;
        default:
          throw createScimError({
            status: 400,
            scimType: 'invalidValue',
            detail: `Patch operation '${operation.op}' is not supported.`
          });
      }
    }

    // SQLite compromise (HIGH): Pre-resolve member user IDs OUTSIDE the transaction to
    // minimise write-lock hold time. Every ms inside $transaction holds the global SQLite
    // writer lock. PostgreSQL’s row-level locking makes this pattern unnecessary.
    // See docs/SQLITE_COMPROMISE_ANALYSIS.md §3.2.3
    // The user data is stable within this request context so the lookup is safe here.
    const memberData = memberDtos.length > 0
      ? await this.mapMembersForPersistenceForEndpoint(group.id, memberDtos, endpointId)
      : [];

    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.scimGroup.update({
          where: { id: group.id },
          data: {
            displayName,
            displayNameLower: displayName.toLowerCase(),
            externalId,
            rawPayload: JSON.stringify(rawPayload),
            meta: JSON.stringify({
              ...this.parseJson<Record<string, unknown>>(String(group.meta ?? '{}')),
              lastModified: new Date().toISOString()
            })
          }
        });

        await tx.groupMember.deleteMany({ where: { groupId: group.id } });

        if (memberData.length > 0) {
          await tx.groupMember.createMany({ data: memberData });
        }
      }, { maxWait: 10000, timeout: 30000 });
    } catch (error) {
      this.logger.error(LogCategory.SCIM_PATCH, 'Transaction failed during group patch', { scimId, endpointId, error: String(error) });
      throw createScimError({
        status: 500,
        detail: `Failed to update group: ${error instanceof Error ? error.message : 'transaction error'}`,
      });
    }

    // RFC 7644 §3.5.2: Return the updated resource with 200 OK
    const updatedGroup = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!updatedGroup) {
      throw createScimError({ status: 500, detail: 'Failed to retrieve updated group.' });
    }

    this.logger.info(LogCategory.SCIM_PATCH, 'Group patched', { scimId, endpointId });
    return this.toScimGroupResource(updatedGroup, baseUrl);
  }

  async replaceGroupForEndpoint(
    scimId: string,
    dto: CreateGroupDto,
    baseUrl: string,
    endpointId: string
  ): Promise<ScimGroupResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);

    this.logger.info(LogCategory.SCIM_GROUP, 'Replace group (PUT)', { scimId, displayName: dto.displayName, endpointId });

    const group = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!group) {
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    const now = new Date();
    const meta = this.parseJson<Record<string, unknown>>(String(group.meta ?? '{}'));

    const newExternalId = typeof (dto as Record<string, unknown>).externalId === 'string'
      ? (dto as Record<string, unknown>).externalId as string
      : null;

    // Pre-resolve member user IDs OUTSIDE the transaction to minimise lock hold time.
    const replaceMemberData = (dto.members && dto.members.length > 0)
      ? await this.mapMembersForPersistenceForEndpoint(group.id, dto.members, endpointId)
      : [];

    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.scimGroup.update({
          where: { id: group.id },
          data: {
            displayName: dto.displayName,
            displayNameLower: dto.displayName.toLowerCase(),
            externalId: newExternalId,
            rawPayload: JSON.stringify(this.extractAdditionalAttributes(dto)),
            meta: JSON.stringify({
              ...meta,
              lastModified: now.toISOString()
            })
          }
        });

        // Replace all members with new ones
        await tx.groupMember.deleteMany({ where: { groupId: group.id } });

        if (replaceMemberData.length > 0) {
          await tx.groupMember.createMany({ data: replaceMemberData });
        }
      }, { maxWait: 10000, timeout: 30000 });
    } catch (error) {
      this.logger.error(LogCategory.SCIM_GROUP, 'Transaction failed during group replace', { scimId, endpointId, error: String(error) });
      throw createScimError({
        status: 500,
        detail: `Failed to replace group: ${error instanceof Error ? error.message : 'transaction error'}`,
      });
    }

    // Return updated group
    const updatedGroup = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!updatedGroup) {
      throw createScimError({ status: 500, detail: 'Failed to retrieve updated group.' });
    }

    return this.toScimGroupResource(updatedGroup, baseUrl);
  }

  async deleteGroupForEndpoint(scimId: string, endpointId: string): Promise<void> {
    this.logger.info(LogCategory.SCIM_GROUP, 'Delete group', { scimId, endpointId });
    const group = await this.prisma.scimGroup.findFirst({
      where: {
        scimId,
        endpointId
      }
    });

    if (!group) {
      this.logger.debug(LogCategory.SCIM_GROUP, 'Delete target group not found', { scimId, endpointId });
      throw createScimError({ status: 404, scimType: 'noTarget', detail: `Resource ${scimId} not found.` });
    }

    await this.prisma.scimGroup.delete({ where: { id: group.id } });
    this.logger.info(LogCategory.SCIM_GROUP, 'Group deleted', { scimId, endpointId });
  }

  // ===== Private Helper Methods =====

  /**
   * Assert displayName uniqueness within the endpoint (case-insensitive).
   * Per SCIM spec, duplicate groups should be rejected with 409 Conflict.
   */
  private async assertUniqueDisplayName(
    displayName: string,
    endpointId: string,
    excludeScimId?: string
  ): Promise<void> {
    // Use the displayNameLower column for an efficient DB-level case-insensitive check
    const lowerName = displayName.toLowerCase();
    const filters: Prisma.ScimGroupWhereInput = {
      endpointId,
      displayNameLower: lowerName,
    };
    if (excludeScimId) {
      filters.NOT = { scimId: excludeScimId };
    }

    const conflict = await this.prisma.scimGroup.findFirst({
      where: filters,
      select: { scimId: true }
    });

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
    const filters: Prisma.ScimGroupWhereInput = { endpointId, externalId };
    if (excludeScimId) {
      filters.NOT = { scimId: excludeScimId };
    }

    const existing = await this.prisma.scimGroup.findFirst({ where: filters });
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

  private getGroupWithMembersForEndpoint(scimId: string, endpointId: string): Promise<GroupWithMembers | null> {
    return this.prisma.scimGroup.findFirst({
      where: { 
        scimId,
        endpointId
      },
      select: {
        id: true,
        scimId: true,
        externalId: true,
        displayName: true,
        rawPayload: true,
        meta: true,
        createdAt: true,
        updatedAt: true,
        members: true
      }
    }) as unknown as Promise<GroupWithMembers | null>;
  }

  private handleReplace(
    operation: PatchGroupDto['Operations'][number],
    currentDisplayName: string,
    currentExternalId: string | null,
    members: GroupMemberDto[],
    rawPayload: Record<string, unknown> = {}
  ): { displayName: string; externalId: string | null; members: GroupMemberDto[]; rawPayload: Record<string, unknown> } {
    const path = operation.path?.toLowerCase();

    // No path — value is either a string (displayName) or an object with attribute(s)
    if (!path) {
      if (typeof operation.value === 'string') {
        return { displayName: operation.value, externalId: currentExternalId, members, rawPayload };
      }
      if (typeof operation.value === 'object' && operation.value !== null) {
        const obj = operation.value as Record<string, unknown>;
        let newDisplayName = currentDisplayName;
        let newExternalId = currentExternalId;
        let newMembers = members;
        const updatedPayload = { ...rawPayload };

        if (typeof obj.displayName === 'string') {
          newDisplayName = obj.displayName;
        }
        if ('externalId' in obj) {
          newExternalId = typeof obj.externalId === 'string' ? obj.externalId : null;
        }
        if (Array.isArray(obj.members)) {
          newMembers = (obj.members as unknown[]).map((m) => this.toMemberDto(m));
          newMembers = this.ensureUniqueMembers(newMembers);
        }

        // Store any other attributes in rawPayload
        for (const [key, val] of Object.entries(obj)) {
          if (key !== 'displayName' && key !== 'externalId' && key !== 'members' && key !== 'schemas') {
            updatedPayload[key] = val;
          }
        }

        return { displayName: newDisplayName, externalId: newExternalId, members: newMembers, rawPayload: updatedPayload };
      }
      throw createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: 'Replace operation requires a string or object value.'
      });
    }

    if (path === 'displayname') {
      if (typeof operation.value !== 'string') {
        throw createScimError({
          status: 400,
          scimType: 'invalidValue',
          detail: 'Replace operation for displayName requires a string value.'
        });
      }
      return { displayName: operation.value, externalId: currentExternalId, members, rawPayload };
    }

    if (path === 'externalid') {
      const newExtId = typeof operation.value === 'string' ? operation.value : null;
      return { displayName: currentDisplayName, externalId: newExtId, members, rawPayload };
    }

    if (path === 'members') {
      if (!Array.isArray(operation.value)) {
        throw createScimError({
          status: 400,
          scimType: 'invalidValue',
          detail: 'Replace operation for members requires an array value.'
        });
      }

      const normalized = operation.value.map((member) => this.toMemberDto(member));
      return { displayName: currentDisplayName, externalId: currentExternalId, members: this.ensureUniqueMembers(normalized), rawPayload };
    }

    throw createScimError({
      status: 400,
      scimType: 'invalidPath',
      detail: `Patch path '${operation.path ?? ''}' is not supported.`
    });
  }

  private handleAdd(
    operation: PatchGroupDto['Operations'][number],
    members: GroupMemberDto[],
    allowMultiMemberAdd: boolean = false
  ): GroupMemberDto[] {
    const path = operation.path?.toLowerCase();
    if (path && path !== 'members') {
      throw createScimError({
        status: 400,
        scimType: 'invalidPath',
        detail: `Add operation path '${operation.path ?? ''}' is not supported.`
      });
    }

    if (!operation.value) {
      throw createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: 'Add operation for members requires a value.'
      });
    }

    const value = Array.isArray(operation.value) ? operation.value : [operation.value];
    
    // If MultiOpPatchRequestAddMultipleMembersToGroup is false and multiple members provided,
    // reject the request - each member must be added in a separate operation
    if (!allowMultiMemberAdd && value.length > 1) {
      throw createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: 'Adding multiple members in a single operation is not allowed. ' +
                'Each member must be added in a separate PATCH operation. ' +
                `To enable multi-member add, set endpoint config flag "${ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP}" to "True".`
      });
    }

    const newMembers = value.map((member) => this.toMemberDto(member));

    return this.ensureUniqueMembers([...members, ...newMembers]);
  }

  private handleRemove(
    operation: PatchGroupDto['Operations'][number],
    members: GroupMemberDto[],
    allowMultiMemberRemove: boolean = false,
    allowRemoveAllMembers: boolean = true
  ): GroupMemberDto[] {
    const path = operation.path?.toLowerCase();

    // Check if value array is provided with members to remove
    if (operation.value && Array.isArray(operation.value) && operation.value.length > 0) {
      // Validate: if removing multiple members and flag is not set, reject
      if (!allowMultiMemberRemove && operation.value.length > 1) {
        throw createScimError({
          status: 400,
          scimType: 'invalidValue',
          detail: 'Removing multiple members in a single operation is not allowed. ' +
                  'Each member must be removed in a separate PATCH operation. ' +
                  `To enable multi-member remove, set endpoint config flag "${ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP}" to "True".`
        });
      }

      // Extract member IDs to remove from value array
      const membersToRemove = new Set<string>();
      for (const item of operation.value) {
        if (item && typeof item === 'object' && 'value' in item) {
          membersToRemove.add((item as { value: string }).value);
        }
      }

      // Filter out the specified members
      return members.filter((member) => !membersToRemove.has(member.value));
    }

    // Handle targeted removal: members[value eq "user-id"]
    const memberPathMatch = path?.match(/^members\[value\s+eq\s+"?([^"]+)"?\]$/i);
    if (memberPathMatch) {
      const valueToRemove = memberPathMatch[1];
      return members.filter((member) => member.value !== valueToRemove);
    }

    // Handle path=members without value array - remove all members (RFC 7644 compliant)
    if (path === 'members') {
      if (!allowRemoveAllMembers) {
        throw createScimError({
          status: 400,
          scimType: 'invalidValue',
          detail: 'Removing all members via path=members is not allowed. ' +
                  'Specify members to remove using a value array or path filter like members[value eq "user-id"]. ' +
                  `To enable remove-all, set endpoint config flag "${ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS}" to "True".`
        });
      }
      // Remove all members per RFC 7644 Section 3.5.2.2
      return [];
    }

    // Unsupported path
    throw createScimError({
      status: 400,
      scimType: 'invalidPath',
      detail: `Remove operation path '${operation.path ?? ''}' is not supported for groups.`
    });
  }

  private async persistMembersForEndpoint(groupId: string, members: GroupMemberDto[], endpointId: string): Promise<void> {
    const data = await this.mapMembersForPersistenceForEndpoint(groupId, members, endpointId);
    if (data.length > 0) {
      await this.prisma.groupMember.createMany({ data });
    }
  }

  private async mapMembersForPersistenceForEndpoint(
    groupId: string,
    members: GroupMemberDto[],
    endpointId: string,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<Array<Omit<Prisma.GroupMemberCreateManyInput, 'id'>>> {
    const values = members.map((member) => member.value);
    const users: Array<{ id: string; scimId: string }> = values.length
      ? await tx.scimUser.findMany({
          where: { 
            scimId: { in: values },
            endpointId
          },
          select: { id: true, scimId: true }
        })
      : [];
    const userMap = new Map(users.map((user) => [user.scimId, user.id] as const));

    return members.map((member) => ({
      groupId,
      userId: userMap.get(member.value) ?? null,
      value: member.value,
      type: member.type ?? null,
      display: member.display ?? null,
      createdAt: new Date()
    }));
  }

  private toMemberDto(member: unknown): GroupMemberDto {
    if (!member || typeof member !== 'object' || !('value' in member)) {
      throw createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: 'Member object must include a value property.'
      });
    }

    const typed = member as { value: string; display?: string; type?: string };
    return {
      value: typed.value,
      display: typed.display,
      type: typed.type
    };
  }

  private ensureUniqueMembers(members: GroupMemberDto[]): GroupMemberDto[] {
    const seen = new Map<string, GroupMemberDto>();
    for (const member of members) {
      seen.set(member.value, member);
    }
    return Array.from(seen.values());
  }

  private memberEntitiesToDtos(members: GroupMember[]): GroupMemberDto[] {
    return members.map((member) => ({
      value: member.value,
      display: member.display ?? undefined,
      type: member.type ?? undefined
    }));
  }

  private toScimGroupResource(group: GroupWithMembers | null, baseUrl: string): ScimGroupResource {
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

    return {
      schemas: [SCIM_CORE_GROUP_SCHEMA],
      id: group.scimId,
      externalId: group.externalId ?? undefined,
      displayName: group.displayName,
      members: group.members.map((member) => ({
        value: member.value,
        display: member.display ?? undefined,
        type: member.type ?? undefined
      })),
      ...rawPayload,
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
      version: `W/"${group.updatedAt.toISOString()}"`
    };
  }

  private extractAdditionalAttributes(dto: CreateGroupDto): Record<string, unknown> {
    const { schemas, members: _members, externalId: _externalId, ...rest } = dto as CreateGroupDto & { externalId?: string };
    return {
      schemas,
      ...rest
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
