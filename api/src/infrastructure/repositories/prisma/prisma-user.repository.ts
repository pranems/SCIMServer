/**
 * PrismaUserRepository — IUserRepository backed by Prisma (SQLite / PostgreSQL).
 *
 * Phase 2: Queries the unified `ScimResource` table with `resourceType = 'User'`
 * instead of the legacy `ScimUser` table. The domain types (UserRecord, etc.)
 * remain unchanged — this repository handles the mapping transparently.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import type {
  UserRecord,
  UserCreateInput,
  UserUpdateInput,
  UserConflictResult,
} from '../../../domain/models/user.model';
import type { Prisma } from '../../../generated/prisma/client';

/** Maps a ScimResource row to the UserRecord domain type. */
function toUserRecord(resource: Record<string, unknown>): UserRecord {
  return {
    id: resource.id as string,
    endpointId: resource.endpointId as string,
    scimId: resource.scimId as string,
    externalId: (resource.externalId as string) ?? null,
    userName: resource.userName as string,
    userNameLower: resource.userNameLower as string,
    active: resource.active as boolean,
    rawPayload: resource.rawPayload as string,
    meta: (resource.meta as string) ?? null,
    createdAt: resource.createdAt as Date,
    updatedAt: resource.updatedAt as Date,
  };
}

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: UserCreateInput): Promise<UserRecord> {
    const created = await this.prisma.scimResource.create({
      data: {
        resourceType: 'User',
        scimId: input.scimId,
        externalId: input.externalId,
        userName: input.userName,
        userNameLower: input.userNameLower,
        active: input.active,
        rawPayload: input.rawPayload,
        meta: input.meta,
        endpoint: { connect: { id: input.endpointId } },
      },
    });
    return toUserRecord(created as unknown as Record<string, unknown>);
  }

  async findByScimId(endpointId: string, scimId: string): Promise<UserRecord | null> {
    const resource = await this.prisma.scimResource.findFirst({
      where: { scimId, endpointId, resourceType: 'User' },
    });
    return resource ? toUserRecord(resource as unknown as Record<string, unknown>) : null;
  }

  async findAll(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<UserRecord[]> {
    const where: Prisma.ScimResourceWhereInput = {
      ...(dbFilter as Prisma.ScimResourceWhereInput),
      endpointId,
      resourceType: 'User',
    };

    const prismaOrderBy = orderBy
      ? { [orderBy.field]: orderBy.direction }
      : { createdAt: 'asc' as const };

    const resources = await this.prisma.scimResource.findMany({
      where,
      orderBy: prismaOrderBy,
    });
    return resources.map((r) => toUserRecord(r as unknown as Record<string, unknown>));
  }

  async update(id: string, data: UserUpdateInput): Promise<UserRecord> {
    const updated = await this.prisma.scimResource.update({
      where: { id },
      data: data as Prisma.ScimResourceUpdateInput,
    });
    return toUserRecord(updated as unknown as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.scimResource.delete({ where: { id } });
  }

  async findConflict(
    endpointId: string,
    userName: string,
    externalId?: string,
    excludeScimId?: string,
  ): Promise<UserConflictResult | null> {
    const orConditions: Prisma.ScimResourceWhereInput[] = [
      { userNameLower: userName.toLowerCase() },
    ];
    if (externalId) {
      orConditions.push({ externalId });
    }

    const filters: Prisma.ScimResourceWhereInput[] = [
      { endpointId, resourceType: 'User' },
    ];
    if (excludeScimId) {
      filters.push({ NOT: { scimId: excludeScimId } });
    }
    if (orConditions.length === 1) {
      filters.push(orConditions[0]);
    } else {
      filters.push({ OR: orConditions });
    }

    const conflict = await this.prisma.scimResource.findFirst({
      where: { AND: filters },
      select: { scimId: true, userName: true, externalId: true },
    });

    if (!conflict || !conflict.userName) return null;
    return {
      scimId: conflict.scimId,
      userName: conflict.userName,
      externalId: conflict.externalId ?? null,
    };
  }

  async findByScimIds(
    endpointId: string,
    scimIds: string[],
  ): Promise<Array<Pick<UserRecord, 'id' | 'scimId'>>> {
    if (scimIds.length === 0) return [];
    return this.prisma.scimResource.findMany({
      where: { scimId: { in: scimIds }, endpointId, resourceType: 'User' },
      select: { id: true, scimId: true },
    });
  }
}
