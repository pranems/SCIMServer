/**
 * PrismaGroupRepository — IGroupRepository backed by Prisma (SQLite / PostgreSQL).
 *
 * Encapsulates all Prisma-specific query construction, relation includes,
 * and transactional updates for groups and their members.
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
} from '../../../domain/models/group.model';
import type { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class PrismaGroupRepository implements IGroupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: GroupCreateInput): Promise<GroupRecord> {
    const created = await this.prisma.scimGroup.create({
      data: {
        scimId: input.scimId,
        externalId: input.externalId,
        displayName: input.displayName,
        displayNameLower: input.displayNameLower,
        rawPayload: input.rawPayload,
        meta: input.meta,
        endpoint: { connect: { id: input.endpointId } },
      },
    });
    return created as unknown as GroupRecord;
  }

  async findByScimId(endpointId: string, scimId: string): Promise<GroupRecord | null> {
    const group = await this.prisma.scimGroup.findFirst({
      where: { scimId, endpointId },
    });
    return group as unknown as GroupRecord | null;
  }

  async findWithMembers(endpointId: string, scimId: string): Promise<GroupWithMembers | null> {
    const group = await this.prisma.scimGroup.findFirst({
      where: { scimId, endpointId },
      include: { members: true },
    });
    return group as unknown as GroupWithMembers | null;
  }

  async findAllWithMembers(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<GroupWithMembers[]> {
    const where: Prisma.ScimGroupWhereInput = {
      ...(dbFilter as Prisma.ScimGroupWhereInput),
      endpointId,
    };

    const prismaOrderBy = orderBy
      ? { [orderBy.field]: orderBy.direction }
      : { createdAt: 'asc' as const };

    const groups = await this.prisma.scimGroup.findMany({
      where,
      orderBy: prismaOrderBy,
      include: { members: true },
    });
    return groups as unknown as GroupWithMembers[];
  }

  async update(id: string, data: GroupUpdateInput): Promise<GroupRecord> {
    const updated = await this.prisma.scimGroup.update({
      where: { id },
      data: data as Prisma.ScimGroupUpdateInput,
    });
    return updated as unknown as GroupRecord;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.scimGroup.delete({ where: { id } });
  }

  async findByDisplayName(
    endpointId: string,
    displayNameLower: string,
    excludeScimId?: string,
  ): Promise<{ scimId: string } | null> {
    const where: Prisma.ScimGroupWhereInput = {
      endpointId,
      displayNameLower,
    };
    if (excludeScimId) {
      where.NOT = { scimId: excludeScimId };
    }

    const conflict = await this.prisma.scimGroup.findFirst({
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
    const where: Prisma.ScimGroupWhereInput = { endpointId, externalId };
    if (excludeScimId) {
      where.NOT = { scimId: excludeScimId };
    }

    const group = await this.prisma.scimGroup.findFirst({ where });
    return group as unknown as GroupRecord | null;
  }

  async addMembers(groupId: string, members: MemberCreateInput[]): Promise<void> {
    if (members.length === 0) return;
    await this.prisma.groupMember.createMany({
      data: members.map((m) => ({
        groupId,
        userId: m.userId,
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
        await tx.scimGroup.update({
          where: { id: groupId },
          data: data as Prisma.ScimGroupUpdateInput,
        });

        await tx.groupMember.deleteMany({ where: { groupId } });

        if (members.length > 0) {
          await tx.groupMember.createMany({
            data: members.map((m) => ({
              groupId,
              userId: m.userId,
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
