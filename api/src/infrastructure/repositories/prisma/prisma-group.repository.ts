/**
 * PrismaGroupRepository - IGroupRepository backed by Prisma (PostgreSQL).
 *
 * Phase 3: Queries the unified `ScimResource` table with `resourceType = 'Group'`
 * and `ResourceMember`. CITEXT on displayName handles case-insensitive matching
 * natively - no displayNameLower helper column. JSONB payload is converted
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
import type { Prisma, ResourceMember, ScimResource } from '../../../generated/prisma/client';
import { wrapPrismaError } from './prisma-error.util';
import { resourceWriteWhere, type ExpectedVersion } from '../../../domain/repositories/write-precondition';
import { wrapEndpointCreateError } from './endpoint-create-error';
import { isValidUuid } from './uuid-guard';
import type { UniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';
import { withUniqueWrite } from './prisma-uniqueness';
import type { ProfileRevision } from '../../../domain/repositories/profile-revision';
import type { EndpointResourceCounts } from '../../../domain/repositories/endpoint-resource-counts';
import { collectEndpointResourceCounts } from './prisma-resource-counts';
import { replaceGroupMembers, toMemberData } from './prisma-group-members';

type GroupSnapshot = ScimResource & {
  membersAsGroup: (Omit<ResourceMember, 'createdAt'> & { createdAt: number })[];
};

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
    reference: (member.reference as string) ?? null,
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

  async create(input: GroupCreateInput, members: MemberCreateInput[] = [], uniqueness: UniquenessPolicy = [], profileRevision?: ProfileRevision): Promise<GroupRecord> {
    try {
      const data: Prisma.ScimResourceCreateInput = {
        resourceType: 'Group',
        scimId: input.scimId,
        externalId: input.externalId,
        displayName: input.displayName,
        active: input.active ?? true,  // Settings v7: Groups default active=true
        payload: JSON.parse(input.rawPayload),   // domain string → JSONB
        meta: input.meta,
        endpoint: { connect: { id: input.endpointId } },
      };
      return await withUniqueWrite(this.prisma, uniqueness, { endpointId: input.endpointId, resourceType: 'Group' }, { ...input, active: input.active ?? true },
        async (tx) => {
          const created = await tx.scimResource.create({ data });
          if (members.length > 0) await tx.resourceMember.createMany({ data: toMemberData(created.id, members) });
          return toGroupRecord(created);
        }, { members, transaction: members.length > 0, expectedProfileRevision: profileRevision });
    } catch (error) {
      throw await wrapEndpointCreateError(error, `Group create(${input.scimId})`, input.endpointId, this.prisma);
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
      const rows = await this.prisma.$queryRaw<GroupSnapshot[]>`
        SELECT r.*,
          COALESCE((
            SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object(
              'createdAt', EXTRACT(EPOCH FROM m."createdAt") * 1000
            ))
            FROM "public"."ResourceMember" m
            WHERE m."groupResourceId" = r."id"
          ), '[]'::jsonb) AS "membersAsGroup"
        FROM "public"."ScimResource" r
        WHERE r."scimId" = ${scimId}::uuid
          AND r."endpointId" = ${endpointId}::uuid
          AND r."resourceType" = 'Group'
      `;
      const resource = rows[0];
      if (!resource) return null;
      const membersAsGroup = resource.membersAsGroup.map((member) => {
        // Epoch milliseconds avoid session-dependent JSON timestamp interpretation.
        const createdAt = new Date(member.createdAt);
        if (!Number.isFinite(member.createdAt) || !Number.isFinite(createdAt.getTime())) {
          throw new Error('Group member snapshot has invalid timestamps');
        }
        return { ...member, createdAt };
      });
      return toGroupWithMembers({ ...resource, membersAsGroup });
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

  async countByEndpoint(): Promise<EndpointResourceCounts[]> {
    try {
      const rows = await this.prisma.scimResource.groupBy({
        by: ['endpointId', 'active'],
        where: { resourceType: 'Group' },
        _count: { _all: true },
      });
      return collectEndpointResourceCounts(rows);
    } catch (error) {
      throw wrapPrismaError(error, 'Group countByEndpoint');
    }
  }

  async update(id: string, data: GroupUpdateInput, expectedVersion?: ExpectedVersion, uniqueness: UniquenessPolicy = [], profileRevision?: ProfileRevision): Promise<GroupRecord> {
    // Convert rawPayload string → JSONB if present in the update
    const prismaData: Record<string, unknown> = { ...data };
    if (data.rawPayload !== undefined) {
      prismaData.payload = JSON.parse(data.rawPayload);
      delete prismaData.rawPayload;
    }
    // Phase 7: Atomically increment version for ETag-based concurrency control
    prismaData.version = { increment: 1 };
    try {
      const updated = await withUniqueWrite(this.prisma, uniqueness, { id, expectedVersion }, data, (tx) => tx.scimResource.update({
        where: resourceWriteWhere(id, expectedVersion),
        data: prismaData as Prisma.ScimResourceUpdateInput,
      }), { expectedProfileRevision: profileRevision });
      return toGroupRecord(updated as unknown as Record<string, unknown>);
    } catch (error) {
      throw wrapPrismaError(error, `Group update(${id})`, expectedVersion);
    }
  }

  async delete(id: string, expectedVersion?: ExpectedVersion, profileRevision?: ProfileRevision): Promise<void> {
    try {
      await withUniqueWrite(this.prisma, [], { id, expectedVersion }, {}, tx => tx.scimResource.delete({
        where: resourceWriteWhere(id, expectedVersion),
      }), { expectedProfileRevision: profileRevision });
    } catch (error) {
      throw wrapPrismaError(error, `Group delete(${id})`, expectedVersion);
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

  async addMembers(groupId: string, members: MemberCreateInput[], uniqueness: UniquenessPolicy, profileRevision?: ProfileRevision): Promise<void> {
    if (members.length === 0) return;
    try {
      await withUniqueWrite(this.prisma, uniqueness, { id: groupId }, {}, async (tx) => {
        await tx.scimResource.update({ where: { id: groupId }, data: { version: { increment: 1 } } });
        await tx.resourceMember.createMany({ data: toMemberData(groupId, members) });
      }, { members, appendMembers: true, transaction: true, expectedProfileRevision: profileRevision });
    } catch (error) {
      throw wrapPrismaError(error, `Group addMembers(${groupId})`);
    }
  }

  async updateGroupWithMembers(
    groupId: string,
    data: GroupUpdateInput,
    members: MemberCreateInput[],
    expectedVersion?: ExpectedVersion,
    uniqueness: UniquenessPolicy = [],
    profileRevision?: ProfileRevision,
  ): Promise<GroupWithMembers> {
    // Convert rawPayload string → JSONB if present in the update
    const prismaData: Record<string, unknown> = { ...data };
    if (data.rawPayload !== undefined) {
      prismaData.payload = JSON.parse(data.rawPayload);
      delete prismaData.rawPayload;
    }

    return await withUniqueWrite(this.prisma, uniqueness, { id: groupId, expectedVersion }, data,
      async (tx: Prisma.TransactionClient) => {
        // Phase 7: Include version increment in the transaction
        const updated = await tx.scimResource.update({
          where: resourceWriteWhere(groupId, expectedVersion),
          data: {
            ...prismaData,
            version: { increment: 1 },
          } as Prisma.ScimResourceUpdateInput,
        });

        let inserted: ResourceMember[] = [];
        if (members.length > 0) {
          inserted = await replaceGroupMembers(tx, groupId, members);
        } else {
          await tx.resourceMember.deleteMany({ where: { groupResourceId: groupId } });
        }
        return { ...toGroupRecord(updated), members: inserted.map(toMemberRecord) };
      },
      { members, transaction: true, expectedProfileRevision: profileRevision },
    ).catch((error) => {
      throw wrapPrismaError(error, `Group updateGroupWithMembers(${groupId})`, expectedVersion);
    });
  }
}
