/**
 * PrismaUserRepository — IUserRepository backed by Prisma (SQLite / PostgreSQL).
 *
 * This is a thin wrapper around PrismaService that translates between
 * domain types and Prisma-generated types. All Prisma-specific concerns
 * (relation syntax, where-clause shapes, transactions) are contained here.
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

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: UserCreateInput): Promise<UserRecord> {
    const created = await this.prisma.scimUser.create({
      data: {
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
    return created as UserRecord;
  }

  async findByScimId(endpointId: string, scimId: string): Promise<UserRecord | null> {
    const user = await this.prisma.scimUser.findFirst({
      where: { scimId, endpointId },
    });
    return user as UserRecord | null;
  }

  async findAll(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<UserRecord[]> {
    const where: Prisma.ScimUserWhereInput = {
      ...(dbFilter as Prisma.ScimUserWhereInput),
      endpointId,
    };

    const prismaOrderBy = orderBy
      ? { [orderBy.field]: orderBy.direction }
      : { createdAt: 'asc' as const };

    const users = await this.prisma.scimUser.findMany({
      where,
      orderBy: prismaOrderBy,
    });
    return users as UserRecord[];
  }

  async update(id: string, data: UserUpdateInput): Promise<UserRecord> {
    const updated = await this.prisma.scimUser.update({
      where: { id },
      data: data as Prisma.ScimUserUpdateInput,
    });
    return updated as UserRecord;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.scimUser.delete({ where: { id } });
  }

  async findConflict(
    endpointId: string,
    userName: string,
    externalId?: string,
    excludeScimId?: string,
  ): Promise<UserConflictResult | null> {
    const orConditions: Prisma.ScimUserWhereInput[] = [
      { userNameLower: userName.toLowerCase() },
    ];
    if (externalId) {
      orConditions.push({ externalId });
    }

    const filters: Prisma.ScimUserWhereInput[] = [{ endpointId }];
    if (excludeScimId) {
      filters.push({ NOT: { scimId: excludeScimId } });
    }
    if (orConditions.length === 1) {
      filters.push(orConditions[0]);
    } else {
      filters.push({ OR: orConditions });
    }

    const conflict = await this.prisma.scimUser.findFirst({
      where: { AND: filters },
      select: { scimId: true, userName: true, externalId: true },
    });

    if (!conflict) return null;
    return {
      scimId: conflict.scimId,
      userName: conflict.userName,
      externalId: conflict.externalId,
    };
  }

  async findByScimIds(
    endpointId: string,
    scimIds: string[],
  ): Promise<Array<Pick<UserRecord, 'id' | 'scimId'>>> {
    if (scimIds.length === 0) return [];
    return this.prisma.scimUser.findMany({
      where: { scimId: { in: scimIds }, endpointId },
      select: { id: true, scimId: true },
    });
  }
}
