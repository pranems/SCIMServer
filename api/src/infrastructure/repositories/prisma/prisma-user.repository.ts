/**
 * PrismaUserRepository — IUserRepository backed by Prisma (PostgreSQL).
 *
 * Phase 3: Queries the unified `ScimResource` table with `resourceType = 'User'`.
 * CITEXT on userName handles case-insensitive uniqueness natively — no
 * userNameLower helper column. JSONB payload is converted to/from string
 * at the repository boundary so the domain layer stays unchanged.
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
import { isValidUuid } from './uuid-guard';

/** Maps a ScimResource row (with JSONB payload) to the UserRecord domain type. */
function toUserRecord(resource: Record<string, unknown>): UserRecord {
  // payload comes back as a parsed JS object from Prisma JSONB — stringify for domain
  const payload = resource.payload;
  const rawPayload = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return {
    id: resource.id as string,
    endpointId: resource.endpointId as string,
    scimId: resource.scimId as string,
    externalId: (resource.externalId as string) ?? null,
    userName: resource.userName as string,
    active: resource.active as boolean,
    rawPayload,
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
        active: input.active,
        payload: JSON.parse(input.rawPayload),   // domain string → JSONB
        meta: input.meta,
        endpoint: { connect: { id: input.endpointId } },
      },
    });
    return toUserRecord(created as unknown as Record<string, unknown>);
  }

  async findByScimId(endpointId: string, scimId: string): Promise<UserRecord | null> {
    if (!isValidUuid(scimId)) return null;   // PostgreSQL UUID column rejects non-UUID strings
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
    // Convert rawPayload string → JSONB if present in the update
    const prismaData: Record<string, unknown> = { ...data };
    if (data.rawPayload !== undefined) {
      prismaData.payload = JSON.parse(data.rawPayload);
      delete prismaData.rawPayload;
    }
    const updated = await this.prisma.scimResource.update({
      where: { id },
      data: prismaData as Prisma.ScimResourceUpdateInput,
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
    // Phase 3: CITEXT handles case-insensitive comparison natively — no toLowerCase needed
    const orConditions: Prisma.ScimResourceWhereInput[] = [
      { userName },
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
    // Filter out non-UUID values to avoid PostgreSQL P2007 errors
    const validIds = scimIds.filter(isValidUuid);
    if (validIds.length === 0) return [];
    return this.prisma.scimResource.findMany({
      where: { scimId: { in: validIds }, endpointId, resourceType: 'User' },
      select: { id: true, scimId: true },
    });
  }
}
