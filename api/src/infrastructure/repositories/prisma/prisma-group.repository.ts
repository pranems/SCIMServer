/**
 * PrismaGroupRepository — IGroupRepository backed by Prisma (PostgreSQL).
 *
 * Phase 3: Queries the unified `ScimResource` table with `resourceType = 'Group'`
 * and `ResourceMember`. CITEXT on displayName handles case-insensitive matching
 * natively — no displayNameLower helper column. JSONB payload is converted
 * to/from string at the repository boundary.
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
import { wrapPrismaError } from './prisma-error.util';
import { isValidUuid } from './uuid-guard';

/** Maps a ScimResource row (with JSONB payload) to the GroupRecord domain type. */
function toGroupRecord(resource: Record<string, unknown>): GroupRecord {
  const payload = resource.payload;
  const rawPayload = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return {
    id: resource.id as string,
    endpointId: resource.endpointId as string,
    scimId: resource.scimId as string,
    externalId: (resource.externalId as string) ?? null,
    displayName: resource.displayName as string,
    active: (resource.active as boolean) ?? true,
    rawPayload,
    version: (resource.version as number) ?? 1,
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
    try {
      const created = await this.prisma.scimResource.create({
        data: {
          resourceType: 'Group',
          scimId: input.scimId,
          externalId: input.externalId,
          displayName: input.displayName,
          active: input.active ?? true,  // Settings v7: Groups default active=true
          payload: JSON.parse(input.rawPayload),   // domain string → JSONB
          meta: input.meta,
          endpoint: { connect: { id: input.endpointId } },
        },
      });
      return toGroupRecord(created as unknown as Record<string, unknown>);
    } catch (error) {
      throw wrapPrismaError(error, `Group create(${input.scimId})`);
    }
  }

  async findByScimId(endpointId: string, scimId: string): Promise<GroupRecord | null> {
    if (!isValidUuid(scimId)) return null;   // PostgreSQL UUID column rejects non-UUID strings
    try {
      const resource = await this.prisma.scimResource.findFirst({
        where: { scimId, endpointId, resourceType: 'Group' },
      });
      return resource ? toGroupRecord(resource as unknown as Record<string, unknown>) : null;
    } catch (error) {
      throw wrapPrismaError(error, `Group findByScimId(${scimId})`);
    }
  }

  async findWithMembers(endpointId: string, scimId: string): Promise<GroupWithMembers | null> {
    if (!isValidUuid(scimId)) return null;   // PostgreSQL UUID column rejects non-UUID strings
    try {
      const resource = await this.prisma.scimResource.findFirst({
        where: { scimId, endpointId, resourceType: 'Group' },
        include: { membersAsGroup: true },
      });
      return resource ? toGroupWithMembers(resource as unknown as Record<string, unknown>) : null;
    } catch (error) {
      throw wrapPrismaError(error, `Group findWithMembers(${scimId})`);
    }
  }

  async findAllWithMembers(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc'; caseExact?: boolean },
  ): Promise<GroupWithMembers[]> {
    const where: Prisma.ScimResourceWhereInput = {
      ...(dbFilter as Prisma.ScimResourceWhereInput),
      endpointId,
      resourceType: 'Group',
    };

    const prismaOrderBy = orderBy
      ? { [orderBy.field]: orderBy.direction }
      : { createdAt: 'asc' as const };

    try {
      const resources = await this.prisma.scimResource.findMany({
        where,
        orderBy: prismaOrderBy,
        include: { membersAsGroup: true },
      });
      return resources.map((r) => toGroupWithMembers(r as unknown as Record<string, unknown>));
    } catch (error) {
      throw wrapPrismaError(error, `Group findAllWithMembers(${endpointId})`);
    }
  }

  async update(id: string, data: GroupUpdateInput): Promise<GroupRecord> {
    // Convert rawPayload string → JSONB if present in the update
    const prismaData: Record<string, unknown> = { ...data };
    if (data.rawPayload !== undefined) {
      prismaData.payload = JSON.parse(data.rawPayload);
      delete prismaData.rawPayload;
    }
    // Phase 7: Atomically increment version for ETag-based concurrency control
    prismaData.version = { increment: 1 };
    try {
      const updated = await this.prisma.scimResource.update({
        where: { id },
        data: prismaData as Prisma.ScimResourceUpdateInput,
      });
      return toGroupRecord(updated as unknown as Record<string, unknown>);
    } catch (error) {
      throw wrapPrismaError(error, `Group update(${id})`);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.scimResource.delete({ where: { id } });
    } catch (error) {
      throw wrapPrismaError(error, `Group delete(${id})`);
    }
  }

  async findByDisplayName(
    endpointId: string,
    displayName: string,
    excludeScimId?: string,
  ): Promise<{ scimId: string; active: boolean } | null> {
    // Phase 3: CITEXT handles case-insensitive comparison natively
    const where: Prisma.ScimResourceWhereInput = {
      endpointId,
      resourceType: 'Group',
      displayName,
    };
    if (excludeScimId) {
      where.NOT = { scimId: excludeScimId };
    }

    try {
      const conflict = await this.prisma.scimResource.findFirst({
        where,
        select: { scimId: true, active: true },
      });
      return conflict ? { scimId: conflict.scimId, active: conflict.active } : null;
    } catch (error) {
      throw wrapPrismaError(error, `Group findByDisplayName(${endpointId}, ${displayName})`);
    }
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

    try {
      const resource = await this.prisma.scimResource.findFirst({ where });
      return resource ? toGroupRecord(resource as unknown as Record<string, unknown>) : null;
    } catch (error) {
      throw wrapPrismaError(error, `Group findByExternalId(${endpointId}, ${externalId})`);
    }
  }

  async addMembers(groupId: string, members: MemberCreateInput[]): Promise<void> {
    if (members.length === 0) return;
    try {
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
    } catch (error) {
      throw wrapPrismaError(error, `Group addMembers(${groupId})`);
    }
  }

  async updateGroupWithMembers(
    groupId: string,
    data: GroupUpdateInput,
    members: MemberCreateInput[],
  ): Promise<void> {
    // Convert rawPayload string → JSONB if present in the update
    const prismaData: Record<string, unknown> = { ...data };
    if (data.rawPayload !== undefined) {
      prismaData.payload = JSON.parse(data.rawPayload);
      delete prismaData.rawPayload;
    }

    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Phase 7: Include version increment in the transaction
        await tx.scimResource.update({
          where: { id: groupId },
          data: {
            ...prismaData,
            version: { increment: 1 },
          } as Prisma.ScimResourceUpdateInput,
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
    ).catch((error) => {
      throw wrapPrismaError(error, `Group updateGroupWithMembers(${groupId})`);
    });
  }
}
