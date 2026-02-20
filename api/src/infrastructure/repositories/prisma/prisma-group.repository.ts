/**
 * PrismaGroupRepository — IGroupRepository backed by Prisma (SQLite / PostgreSQL).
 *
 * Phase 2: Queries the unified `ScimResource` table with `resourceType = 'Group'`
 * and `ResourceMember` instead of the legacy `ScimGroup` / `GroupMember` tables.
 * The domain types (GroupRecord, MemberRecord, etc.) remain unchanged.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IGroupRepository } from '../../../domain/repositories/group.repository.interface';
import type {
  GroupRecord,
  GroupWithMembers,
  GroupCreateInput,
  GroupUpdateInput,
  MemberCreateInput,
  MemberRecord,
} from '../../../domain/models/group.model';
import type { Prisma } from '../../../generated/prisma/client';

/** Maps a ScimResource row to the GroupRecord domain type. */
function toGroupRecord(resource: Record<string, unknown>): GroupRecord {
  return {
    id: resource.id as string,
    endpointId: resource.endpointId as string,
    scimId: resource.scimId as string,
    externalId: (resource.externalId as string) ?? null,
    displayName: resource.displayName as string,
    displayNameLower: resource.displayNameLower as string,
    rawPayload: resource.rawPayload as string,
    meta: (resource.meta as string) ?? null,
    createdAt: resource.createdAt as Date,
    updatedAt: resource.updatedAt as Date,
  };
}

/** Maps a ResourceMember row to the MemberRecord domain type. */
function toMemberRecord(member: Record<string, unknown>): MemberRecord {
  return {
    id: member.id as string,
    groupId: member.groupResourceId as string,
    userId: (member.memberResourceId as string) ?? null,
    value: member.value as string,
    type: (member.type as string) ?? null,
    display: (member.display as string) ?? null,
    createdAt: member.createdAt as Date,
  };
}

/** Maps a ScimResource row (with membersAsGroup relation) to GroupWithMembers. */
function toGroupWithMembers(resource: Record<string, unknown>): GroupWithMembers {
  const members = (resource.membersAsGroup as Record<string, unknown>[]) ?? [];
  return {
    ...toGroupRecord(resource),
    members: members.map(toMemberRecord),
  };
}

@Injectable()
export class PrismaGroupRepository implements IGroupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: GroupCreateInput): Promise<GroupRecord> {
    const created = await this.prisma.scimResource.create({
      data: {
        resourceType: 'Group',
        scimId: input.scimId,
        externalId: input.externalId,
        displayName: input.displayName,
        displayNameLower: input.displayNameLower,
        rawPayload: input.rawPayload,
        meta: input.meta,
        endpoint: { connect: { id: input.endpointId } },
      },
    });
    return toGroupRecord(created as unknown as Record<string, unknown>);
  }

  async findByScimId(endpointId: string, scimId: string): Promise<GroupRecord | null> {
    const resource = await this.prisma.scimResource.findFirst({
      where: { scimId, endpointId, resourceType: 'Group' },
    });
    return resource ? toGroupRecord(resource as unknown as Record<string, unknown>) : null;
  }

  async findWithMembers(endpointId: string, scimId: string): Promise<GroupWithMembers | null> {
    const resource = await this.prisma.scimResource.findFirst({
      where: { scimId, endpointId, resourceType: 'Group' },
      include: { membersAsGroup: true },
    });
    return resource ? toGroupWithMembers(resource as unknown as Record<string, unknown>) : null;
  }

  async findAllWithMembers(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<GroupWithMembers[]> {
    const where: Prisma.ScimResourceWhereInput = {
      ...(dbFilter as Prisma.ScimResourceWhereInput),
      endpointId,
      resourceType: 'Group',
    };

    const prismaOrderBy = orderBy
      ? { [orderBy.field]: orderBy.direction }
      : { createdAt: 'asc' as const };

    const resources = await this.prisma.scimResource.findMany({
      where,
      orderBy: prismaOrderBy,
      include: { membersAsGroup: true },
    });
    return resources.map((r) => toGroupWithMembers(r as unknown as Record<string, unknown>));
  }

  async update(id: string, data: GroupUpdateInput): Promise<GroupRecord> {
    const updated = await this.prisma.scimResource.update({
      where: { id },
      data: data as Prisma.ScimResourceUpdateInput,
    });
    return toGroupRecord(updated as unknown as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.scimResource.delete({ where: { id } });
  }

  async findByDisplayName(
    endpointId: string,
    displayNameLower: string,
    excludeScimId?: string,
  ): Promise<{ scimId: string } | null> {
    const where: Prisma.ScimResourceWhereInput = {
      endpointId,
      resourceType: 'Group',
      displayNameLower,
    };
    if (excludeScimId) {
      where.NOT = { scimId: excludeScimId };
    }

    const conflict = await this.prisma.scimResource.findFirst({
      where,
      select: { scimId: true },
    });
    return conflict;
  }

  async findByExternalId(
    endpointId: string,
    externalId: string,
    excludeScimId?: string,
  ): Promise<GroupRecord | null> {
    const where: Prisma.ScimResourceWhereInput = {
      endpointId,
      resourceType: 'Group',
      externalId,
    };
    if (excludeScimId) {
      where.NOT = { scimId: excludeScimId };
    }

    const resource = await this.prisma.scimResource.findFirst({ where });
    return resource ? toGroupRecord(resource as unknown as Record<string, unknown>) : null;
  }

  async addMembers(groupId: string, members: MemberCreateInput[]): Promise<void> {
    if (members.length === 0) return;
    await this.prisma.resourceMember.createMany({
      data: members.map((m) => ({
        groupResourceId: groupId,
        memberResourceId: m.userId,
        value: m.value,
        type: m.type,
        display: m.display,
        createdAt: new Date(),
      })),
    });
  }

  async updateGroupWithMembers(
    groupId: string,
    data: GroupUpdateInput,
    members: MemberCreateInput[],
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.scimResource.update({
          where: { id: groupId },
          data: data as Prisma.ScimResourceUpdateInput,
        });

        await tx.resourceMember.deleteMany({ where: { groupResourceId: groupId } });

        if (members.length > 0) {
          await tx.resourceMember.createMany({
            data: members.map((m) => ({
              groupResourceId: groupId,
              memberResourceId: m.userId,
              value: m.value,
              type: m.type,
              display: m.display,
              createdAt: new Date(),
            })),
          });
        }
      },
      { maxWait: 10000, timeout: 30000 },
    );
  }
}
