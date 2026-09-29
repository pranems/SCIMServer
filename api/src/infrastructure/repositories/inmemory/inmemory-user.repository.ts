/**
 * InMemoryUserRepository - IUserRepository backed by an in-memory Map.
 *
 * Phase 3: Removed userNameLower - case-insensitive comparison is done at
 * query time via toLowerCase(). Suitable for testing and lightweight deployments.
 *
 * Phase 4: Uses matchesPrismaFilter() to evaluate Prisma-style WHERE clauses
 * produced by the expanded filter push-down (co/sw/ew/ne/gt/ge/lt/le/pr + AND/OR).
 *
 * NOTE: Methods are async to satisfy IUserRepository (Promise<T> return types)
 * even when no await is needed in the in-memory implementation.
 */
/* eslint-disable @typescript-eslint/require-await */
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
import { RepositoryError } from '../../../domain/errors/repository-error';
import { assertUnique, uniquenessPayload, type UniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';
import { assertWritePrecondition, type ExpectedVersion } from '../../../domain/repositories/write-precondition';
import { InMemoryEndpointWriteGuard } from './inmemory-endpoint-write-guard';
import { prepareMapRemoval, type EndpointDeletionStep } from './endpoint-deletion-step';
import type { ProfileRevision } from '../../../domain/repositories/profile-revision';

@Injectable()
export class InMemoryUserRepository implements IUserRepository {
  private users: Map<string, UserRecord> = new Map();

  constructor(private readonly writes: InMemoryEndpointWriteGuard = new InMemoryEndpointWriteGuard()) {}

  prepareEndpointDeletion(endpointId: string): EndpointDeletionStep {
    return prepareMapRemoval(this.users, row => row.endpointId === endpointId, rows => { this.users = rows; });
  }

  async create(input: UserCreateInput, uniqueness: UniquenessPolicy = [], profileRevision?: ProfileRevision): Promise<UserRecord> {
    this.assertUniqueUserName(input.endpointId, input.userName);
    if (uniqueness.length > 0) assertUnique(uniqueness, uniquenessPayload(input), [...this.users.values()]
      .filter((r) => r.endpointId === input.endpointId).map((r) => uniquenessPayload(r)));
    const now = new Date();
    const record: UserRecord = {
      id: randomUUID(),
      endpointId: input.endpointId,
      scimId: input.scimId,
      externalId: input.externalId,
      userName: input.userName,
      displayName: input.displayName,
      active: input.active,
      rawPayload: input.rawPayload,
      version: 1,
      meta: input.meta,
      createdAt: now,
      updatedAt: now,
    };
    this.writes.assertWritable(input.endpointId, profileRevision);
    this.users.set(record.id, record);
    return { ...record };
  }

  async findByScimId(endpointId: string, scimId: string): Promise<UserRecord | null> {
    const normalizedScimId = scimId.toLowerCase();
    for (const user of this.users.values()) {
      if (user.endpointId === endpointId && user.scimId.toLowerCase() === normalizedScimId) {
        return { ...user };
      }
    }
    return null;
  }

  async findAll(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc'; caseExact?: boolean },
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
    const sortCaseExact = orderBy?.caseExact ?? true;
    results.sort((a, b) => {
      let aVal = String((a as unknown as Record<string, unknown>)[sortField] ?? '');
      let bVal = String((b as unknown as Record<string, unknown>)[sortField] ?? '');
      if (!sortCaseExact) { aVal = aVal.toLowerCase(); bVal = bVal.toLowerCase(); }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return results.map((u) => ({ ...u }));
  }

  async update(id: string, data: UserUpdateInput, expectedVersion?: ExpectedVersion, uniqueness: UniquenessPolicy = [], profileRevision?: ProfileRevision): Promise<UserRecord> {
    const existing = this.users.get(id);
    assertWritePrecondition(existing, expectedVersion);
    this.assertUniqueUserName(existing.endpointId, data.userName ?? existing.userName, id);
    if (uniqueness.length > 0) assertUnique(uniqueness, uniquenessPayload({ ...existing, ...data }), [...this.users.values()]
      .filter((r) => r.id !== id && r.endpointId === existing.endpointId).map((r) => uniquenessPayload(r)));
    // Phase 7: Increment version for ETag-based concurrency control
    const updated: UserRecord = {
      ...existing,
      ...data,
      version: (existing.version ?? 1) + 1,
      updatedAt: new Date(),
    };
    this.writes.assertWritable(existing.endpointId, profileRevision);
    this.users.set(id, updated);
    return { ...updated };
  }

  async delete(id: string, expectedVersion?: ExpectedVersion, profileRevision?: ProfileRevision): Promise<void> {
    const existing = this.users.get(id);
    assertWritePrecondition(existing, expectedVersion);
    this.writes.assertWritable(existing.endpointId, profileRevision);
    this.users.delete(id);
  }

  private assertUniqueUserName(endpointId: string, userName: string, excludeId?: string): void {
    const normalized = userName.toLowerCase();
    for (const user of this.users.values()) {
      if (user.id !== excludeId && user.endpointId === endpointId &&
          user.userName.toLowerCase() === normalized) {
        throw new RepositoryError('CONFLICT', 'User userName already exists in this endpoint.');
      }
    }
  }

  async findConflict(
    endpointId: string,
    userName: string,
    excludeScimId?: string,
  ): Promise<UserConflictResult | null> {
    // Only userName is checked - externalId/displayName are NOT unique per RFC 7643.
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
    const idSet = new Set(scimIds.map((id) => id.toLowerCase()));
    const results: Array<Pick<UserRecord, 'id' | 'scimId'>> = [];
    for (const user of this.users.values()) {
      if (user.endpointId === endpointId && idSet.has(user.scimId.toLowerCase())) {
        results.push({ id: user.id, scimId: user.scimId });
      }
    }
    return results;
  }

  /** Clear all data - useful in test teardowns. */
  clear(): void {
    this.users.clear();
  }
}
