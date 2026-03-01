/**
 * InMemoryUserRepository — IUserRepository backed by an in-memory Map.
 *
 * Phase 3: Removed userNameLower — case-insensitive comparison is done at
 * query time via toLowerCase(). Suitable for testing and lightweight deployments.
 *
 * Phase 4: Uses matchesPrismaFilter() to evaluate Prisma-style WHERE clauses
 * produced by the expanded filter push-down (co/sw/ew/ne/gt/ge/lt/le/pr + AND/OR).
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import type {
  UserRecord,
  UserCreateInput,
  UserUpdateInput,
  UserConflictResult,
} from '../../../domain/models/user.model';
import { matchesPrismaFilter } from './prisma-filter-evaluator';

@Injectable()
export class InMemoryUserRepository implements IUserRepository {
  private readonly users: Map<string, UserRecord> = new Map();

  async create(input: UserCreateInput): Promise<UserRecord> {
    const now = new Date();
    const record: UserRecord = {
      id: randomUUID(),
      endpointId: input.endpointId,
      scimId: input.scimId,
      externalId: input.externalId,
      userName: input.userName,
      displayName: input.displayName,
      active: input.active,
      deletedAt: null,
      rawPayload: input.rawPayload,
      version: 1,
      meta: input.meta,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(record.id, record);
    return { ...record };
  }

  async findByScimId(endpointId: string, scimId: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.endpointId === endpointId && user.scimId === scimId) {
        return { ...user };
      }
    }
    return null;
  }

  async findAll(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<UserRecord[]> {
    let results = Array.from(this.users.values()).filter(
      (u) => u.endpointId === endpointId,
    );

    if (dbFilter && Object.keys(dbFilter).length > 0) {
      results = results.filter((u) =>
        matchesPrismaFilter(u as unknown as Record<string, unknown>, dbFilter),
      );
    }

    const sortField = orderBy?.field ?? 'createdAt';
    const sortDir = orderBy?.direction ?? 'asc';
    results.sort((a, b) => {
      const aVal = String((a as unknown as Record<string, unknown>)[sortField] ?? '');
      const bVal = String((b as unknown as Record<string, unknown>)[sortField] ?? '');
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return results.map((u) => ({ ...u }));
  }

  async update(id: string, data: UserUpdateInput): Promise<UserRecord> {
    const existing = this.users.get(id);
    if (!existing) {
      throw new Error(`User with id ${id} not found`);
    }
    // Phase 7: Increment version for ETag-based concurrency control
    const updated: UserRecord = {
      ...existing,
      ...data,
      version: (existing.version ?? 1) + 1,
      updatedAt: new Date(),
    };
    this.users.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }

  async findConflict(
    endpointId: string,
    userName: string,
    externalId?: string,
    excludeScimId?: string,
  ): Promise<UserConflictResult | null> {
    const lowerName = userName.toLowerCase();
    for (const user of this.users.values()) {
      if (user.endpointId !== endpointId) continue;
      if (excludeScimId && user.scimId === excludeScimId) continue;
      // Phase 3: Compare at query time instead of relying on pre-computed lowercase column
      if (user.userName.toLowerCase() === lowerName) {
        return {
          scimId: user.scimId,
          userName: user.userName,
          externalId: user.externalId,
          active: user.active,
          deletedAt: user.deletedAt,
        };
      }
      if (externalId && user.externalId === externalId) {
        return {
          scimId: user.scimId,
          userName: user.userName,
          externalId: user.externalId,
          active: user.active,
          deletedAt: user.deletedAt,
        };
      }
    }
    return null;
  }

  async findByScimIds(
    endpointId: string,
    scimIds: string[],
  ): Promise<Array<Pick<UserRecord, 'id' | 'scimId'>>> {
    if (scimIds.length === 0) return [];
    const idSet = new Set(scimIds);
    const results: Array<Pick<UserRecord, 'id' | 'scimId'>> = [];
    for (const user of this.users.values()) {
      if (user.endpointId === endpointId && idSet.has(user.scimId)) {
        results.push({ id: user.id, scimId: user.scimId });
      }
    }
    return results;
  }

  /** Clear all data — useful in test teardowns. */
  clear(): void {
    this.users.clear();
  }
}
