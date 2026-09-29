/**
 * InMemoryGroupRepository - IGroupRepository backed by in-memory Maps.
 *
 * Phase 3: Removed displayNameLower - case-insensitive comparison done at
 * query time via toLowerCase(). Suitable for testing and lightweight deployments.
 *
 * Phase 4: Uses matchesPrismaFilter() to evaluate Prisma-style WHERE clauses
 * produced by the expanded filter push-down (co/sw/ew/ne/gt/ge/lt/le/pr + AND/OR).
 *
 * NOTE: Methods are async to satisfy IGroupRepository (Promise<T> return types)
 * even when no await is needed in the in-memory implementation.
 */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IGroupRepository } from '../../../domain/repositories/group.repository.interface';
import type {
  GroupRecord,
  GroupWithMembers,
  GroupCreateInput,
  GroupUpdateInput,
  MemberCreateInput,
  MemberRecord,
} from '../../../domain/models/group.model';
import { matchesPrismaFilter } from './prisma-filter-evaluator';
import { assertWritePrecondition, type ExpectedVersion } from '../../../domain/repositories/write-precondition';
import { RepositoryError } from '../../../domain/errors/repository-error';

@Injectable()
export class InMemoryGroupRepository implements IGroupRepository {
  private readonly groups: Map<string, GroupRecord> = new Map();
  private readonly members: Map<string, MemberRecord> = new Map();

  async create(input: GroupCreateInput, members: MemberCreateInput[] = []): Promise<GroupRecord> {
    if (this.findGroup(input.endpointId, input.scimId)) {
      throw new RepositoryError('CONFLICT', 'Group SCIM id already exists in this endpoint.');
    }
    const now = new Date();
    const record: GroupRecord = {
      id: randomUUID(),
      endpointId: input.endpointId,
      scimId: input.scimId,
      externalId: input.externalId,
      displayName: input.displayName,
      active: input.active ?? true,  // Settings v7: Groups don't use active; default true
      rawPayload: input.rawPayload,
      version: 1,
      meta: input.meta,
      createdAt: now,
      updatedAt: now,
    };
    const initialMembers = this.stageMembers(record.id, members, now);
    this.groups.set(record.id, record);
    for (const member of initialMembers) this.members.set(member.id, member);
    return { ...record };
  }

  async findByScimId(endpointId: string, scimId: string): Promise<GroupRecord | null> {
    const group = this.findGroup(endpointId, scimId);
    return group ? { ...group } : null;
  }

  async findWithMembers(endpointId: string, scimId: string): Promise<GroupWithMembers | null> {
    // Read both maps in the same turn: an await here can mix old scalar state
    // with new membership even when writers publish atomically.
    const group = this.findGroup(endpointId, scimId);
    if (!group) return null;
    return {
      ...group,
      members: this.getMembersForGroup(group.id),
    };
  }

  async findAllWithMembers(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc'; caseExact?: boolean },
  ): Promise<GroupWithMembers[]> {
    let results = Array.from(this.groups.values()).filter(
      (g) => g.endpointId === endpointId,
    );

    if (dbFilter && Object.keys(dbFilter).length > 0) {
      results = results.filter((g) =>
        matchesPrismaFilter(g as unknown as Record<string, unknown>, dbFilter),
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

    return results.map((g) => ({
      ...g,
      members: this.getMembersForGroup(g.id),
    }));
  }

  async update(id: string, data: GroupUpdateInput, expectedVersion?: ExpectedVersion): Promise<GroupRecord> {
    const existing = this.groups.get(id);
    assertWritePrecondition(existing, expectedVersion);
    // Phase 7: Increment version for ETag-based concurrency control
    const updated: GroupRecord = {
      ...existing,
      ...data,
      version: (existing.version ?? 1) + 1,
      updatedAt: new Date(),
    };
    this.groups.set(id, updated);
    return { ...updated };
  }

  async delete(id: string, expectedVersion?: ExpectedVersion): Promise<void> {
    assertWritePrecondition(this.groups.get(id), expectedVersion);
    this.groups.delete(id);
    // Cascade: remove associated members
    for (const [memberId, member] of this.members) {
      if (member.groupId === id) {
        this.members.delete(memberId);
      }
    }
  }

  async findByDisplayName(
    endpointId: string,
    displayName: string,
    excludeScimId?: string,
  ): Promise<{ scimId: string; active: boolean } | null> {
    // Phase 3: Case-insensitive comparison at query time (matches CITEXT behavior)
    const lowerName = displayName.toLowerCase();
    for (const group of this.groups.values()) {
      if (group.endpointId !== endpointId) continue;
      if (excludeScimId && group.scimId === excludeScimId) continue;
      if (group.displayName.toLowerCase() === lowerName) {
        return { scimId: group.scimId, active: group.active };
      }
    }
    return null;
  }

  async findByExternalId(
    endpointId: string,
    externalId: string,
    excludeScimId?: string,
  ): Promise<GroupRecord | null> {
    for (const group of this.groups.values()) {
      if (group.endpointId !== endpointId) continue;
      if (excludeScimId && group.scimId === excludeScimId) continue;
      if (group.externalId === externalId) {
        return { ...group };
      }
    }
    return null;
  }

  async addMembers(groupId: string, members: MemberCreateInput[]): Promise<void> {
    if (members.length === 0) return;
    assertWritePrecondition(this.groups.get(groupId));
    const existing = this.getMembersForGroup(groupId);
    const staged = this.stageMembers(groupId, members, new Date(), new Set(existing.map((m) => m.value)));
    for (const member of staged) this.members.set(member.id, member);
  }

  async updateGroupWithMembers(
    groupId: string,
    data: GroupUpdateInput,
    members: MemberCreateInput[],
    expectedVersion?: ExpectedVersion,
  ): Promise<void> {
    const existing = this.groups.get(groupId);
    assertWritePrecondition(existing, expectedVersion);
    // Stage the entire aggregate before committing either map. No await can
    // interleave a second conditional writer between the check and mutation.
    const now = new Date();
    const updated: GroupRecord = {
      ...existing, ...data, version: existing.version + 1, updatedAt: now,
    };
    const replacement = this.stageMembers(groupId, members, now);

    this.groups.set(groupId, updated);
    for (const [memberId, member] of this.members) {
      if (member.groupId === groupId) {
        this.members.delete(memberId);
      }
    }

    for (const member of replacement) this.members.set(member.id, member);
  }

  /** Clear all data - useful in test teardowns. */
  clear(): void {
    this.groups.clear();
    this.members.clear();
  }

  private findGroup(endpointId: string, scimId: string): GroupRecord | null {
    const normalizedScimId = scimId.toLowerCase();
    for (const group of this.groups.values()) {
      if (group.endpointId === endpointId && group.scimId.toLowerCase() === normalizedScimId) return group;
    }
    return null;
  }

  private stageMembers(
    groupId: string, members: MemberCreateInput[], now: Date, values = new Set<string>(),
  ): MemberRecord[] {
    return members.map((m) => {
      const record: MemberRecord = {
        id: randomUUID(), groupId, userId: m.userId, value: m.value,
        type: m.type, display: m.display, createdAt: now,
      };
      if (values.has(record.value)) {
        throw new RepositoryError('CONFLICT', 'Group member value already exists.');
      }
      values.add(record.value);
      return record;
    });
  }

  private getMembersForGroup(groupId: string): MemberRecord[] {
    const result: MemberRecord[] = [];
    for (const member of this.members.values()) {
      if (member.groupId === groupId) {
        result.push({ ...member });
      }
    }
    return result;
  }
}
