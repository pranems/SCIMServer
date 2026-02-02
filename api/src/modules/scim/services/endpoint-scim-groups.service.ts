import { Injectable } from '@nestjs/common';
import type { GroupMember, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
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

interface ListGroupsParams {
  filter?: string;
  startIndex?: number;
  count?: number;
}

// Narrowed type used internally to avoid Prisma JSON 'any' leakage in intersections
interface GroupWithMembers {
  id: string;
  scimId: string;
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
    private readonly metadata: ScimMetadataService
  ) {}

  async createGroupForEndpoint(dto: CreateGroupDto, baseUrl: string, endpointId: string): Promise<ScimGroupResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);

    const now = new Date();
    const scimId = dto.id && typeof dto.id === 'string' ? dto.id : randomUUID();

    const sanitizedPayload = this.extractAdditionalAttributes(dto);

    const group = await this.prisma.scimGroup.create({
      data: {
        scimId,
        displayName: dto.displayName,
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
    return this.toScimGroupResource(withMembers, baseUrl);
  }

  async getGroupForEndpoint(scimId: string, baseUrl: string, endpointId: string): Promise<ScimGroupResource> {
    const group = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!group) {
      throw createScimError({ status: 404, detail: `Resource ${scimId} not found.` });
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

    const filterWhere = this.buildFilter(filter);
    const where: Prisma.ScimGroupWhereInput = {
      ...filterWhere,
      endpointId
    };

    const [totalResults, groups] = await Promise.all([
      this.prisma.scimGroup.count({ where }),
      this.prisma.scimGroup.findMany({
        where,
        skip: Math.max(startIndex - 1, 0),
        take: Math.max(Math.min(count, MAX_COUNT), 0),
        orderBy: { createdAt: 'asc' },
        include: { members: true }
      })
    ]);

    const resources = groups.map((g) => this.toScimGroupResource(g as GroupWithMembers, baseUrl));

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources
    };
  }

  async patchGroupForEndpoint(scimId: string, dto: PatchGroupDto, endpointId: string): Promise<void> {
    this.ensureSchema(dto.schemas, SCIM_PATCH_SCHEMA);

    const group = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!group) {
      throw createScimError({ status: 404, detail: `Resource ${scimId} not found.` });
    }

    let displayName: string = group.displayName;
    let memberDtos: GroupMemberDto[] = this.memberEntitiesToDtos(group.members);

    for (const operation of dto.Operations) {
      const op = operation.op?.toLowerCase();
      switch (op) {
        case 'replace':
          ({ displayName, members: memberDtos } = this.handleReplace(operation, displayName, memberDtos));
          break;
        case 'add':
          memberDtos = this.handleAdd(operation, memberDtos);
          break;
        case 'remove':
          memberDtos = this.handleRemove(operation, memberDtos);
          break;
        default:
          throw createScimError({
            status: 400,
            detail: `Patch operation '${operation.op}' is not supported.`
          });
      }
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.scimGroup.update({
        where: { id: group.id },
        data: {
          displayName,
          meta: JSON.stringify({
            ...this.parseJson<Record<string, unknown>>(String(group.meta ?? '{}')),
            lastModified: new Date().toISOString()
          })
        }
      });

      await tx.groupMember.deleteMany({ where: { groupId: group.id } });

      if (memberDtos.length > 0) {
        const data = await this.mapMembersForPersistenceForEndpoint(group.id, memberDtos, endpointId, tx);
        await tx.groupMember.createMany({ data });
      }
    });
  }

  async replaceGroupForEndpoint(
    scimId: string,
    dto: CreateGroupDto,
    baseUrl: string,
    endpointId: string
  ): Promise<ScimGroupResource> {
    this.ensureSchema(dto.schemas, SCIM_CORE_GROUP_SCHEMA);

    const group = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!group) {
      throw createScimError({ status: 404, detail: `Resource ${scimId} not found.` });
    }

    const now = new Date();
    const meta = this.parseJson<Record<string, unknown>>(String(group.meta ?? '{}'));

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.scimGroup.update({
        where: { id: group.id },
        data: {
          displayName: dto.displayName,
          rawPayload: JSON.stringify(this.extractAdditionalAttributes(dto)),
          meta: JSON.stringify({
            ...meta,
            lastModified: now.toISOString()
          })
        }
      });

      // Replace all members with new ones
      await tx.groupMember.deleteMany({ where: { groupId: group.id } });

      if (dto.members && dto.members.length > 0) {
        const data = await this.mapMembersForPersistenceForEndpoint(group.id, dto.members, endpointId, tx);
        await tx.groupMember.createMany({ data });
      }
    });

    // Return updated group
    const updatedGroup = await this.getGroupWithMembersForEndpoint(scimId, endpointId);
    if (!updatedGroup) {
      throw createScimError({ status: 500, detail: 'Failed to retrieve updated group.' });
    }

    return this.toScimGroupResource(updatedGroup, baseUrl);
  }

  async deleteGroupForEndpoint(scimId: string, endpointId: string): Promise<void> {
    const group = await this.prisma.scimGroup.findFirst({
      where: {
        scimId,
        endpointId
      }
    });

    if (!group) {
      throw createScimError({ status: 404, detail: `Resource ${scimId} not found.` });
    }

    await this.prisma.scimGroup.delete({ where: { id: group.id } });
  }

  // ===== Private Helper Methods =====

  private ensureSchema(schemas: string[] | undefined, requiredSchema: string): void {
    if (!schemas || !schemas.includes(requiredSchema)) {
      throw createScimError({
        status: 400,
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
        displayName: true,
        rawPayload: true,
        meta: true,
        createdAt: true,
        updatedAt: true,
        members: true
      }
    }) as unknown as Promise<GroupWithMembers | null>;
  }

  private buildFilter(filter?: string): Prisma.ScimGroupWhereInput {
    if (!filter) {
      return {};
    }

    const regex = /(displayName)\s+eq\s+"?([^"]+)"?/i;
    const match = filter.match(regex);
    if (!match) {
      throw createScimError({
        status: 400,
        detail: `Unsupported filter expression: '${filter}'.`
      });
    }

    return { displayName: match[2] };
  }

  private handleReplace(
    operation: PatchGroupDto['Operations'][number],
    currentDisplayName: string,
    members: GroupMemberDto[]
  ): { displayName: string; members: GroupMemberDto[] } {
    const path = operation.path?.toLowerCase();
    if (!path || path === 'displayname') {
      if (typeof operation.value !== 'string') {
        throw createScimError({
          status: 400,
          detail: 'Replace operation for displayName requires a string value.'
        });
      }

      return { displayName: operation.value, members };
    }

    if (path === 'members') {
      if (!Array.isArray(operation.value)) {
        throw createScimError({
          status: 400,
          detail: 'Replace operation for members requires an array value.'
        });
      }

      const normalized = operation.value.map((member) => this.toMemberDto(member));
      return { displayName: currentDisplayName, members: this.ensureUniqueMembers(normalized) };
    }

    throw createScimError({
      status: 400,
      detail: `Patch path '${operation.path ?? ''}' is not supported.`
    });
  }

  private handleAdd(
    operation: PatchGroupDto['Operations'][number],
    members: GroupMemberDto[]
  ): GroupMemberDto[] {
    const path = operation.path?.toLowerCase();
    if (path && path !== 'members') {
      throw createScimError({
        status: 400,
        detail: `Add operation path '${operation.path ?? ''}' is not supported.`
      });
    }

    if (!operation.value) {
      throw createScimError({
        status: 400,
        detail: 'Add operation for members requires a value.'
      });
    }

    const value = Array.isArray(operation.value) ? operation.value : [operation.value];
    const newMembers = value.map((member) => this.toMemberDto(member));

    return this.ensureUniqueMembers([...members, ...newMembers]);
  }

  private handleRemove(
    operation: PatchGroupDto['Operations'][number],
    members: GroupMemberDto[]
  ): GroupMemberDto[] {
    const path = operation.path?.toLowerCase();

    if (!path || path === 'members') {
      return [];
    }

    const memberPathMatch = path.match(/^members\[value\s+eq\s+"?([^"]+)"?\]$/i);
    if (memberPathMatch) {
      const valueToRemove = memberPathMatch[1];
      return members.filter((member) => member.value !== valueToRemove);
    }

    throw createScimError({
      status: 400,
      detail: `Remove operation path '${operation.path ?? ''}' is not supported.`
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
      throw createScimError({ status: 404, detail: 'Resource not found.' });
    }

    const meta = this.buildMeta(group, baseUrl);
    const rawPayload = this.parseJson<Record<string, unknown>>(String(group.rawPayload ?? '{}'));

    return {
      schemas: [SCIM_CORE_GROUP_SCHEMA],
      id: group.scimId,
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
    const { schemas, members, ...rest } = dto;
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
