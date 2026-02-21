/**
 * InMemoryGroupRepository — IGroupRepository backed by in-memory Maps.
 *
 * Phase 3: Removed displayNameLower — case-insensitive comparison done at
 * query time via toLowerCase(). Suitable for testing and lightweight deployments.
 */
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

@Injectable()
export class InMemoryGroupRepository implements IGroupRepository {
  private readonly groups: Map<string, GroupRecord> = new Map();
  private readonly members: Map<string, MemberRecord> = new Map();

  async create(input: GroupCreateInput): Promise<GroupRecord> {
    const now = new Date();
    const record: GroupRecord = {
      id: randomUUID(),
      endpointId: input.endpointId,
      scimId: input.scimId,
      externalId: input.externalId,
      displayName: input.displayName,
      rawPayload: input.rawPayload,
      meta: input.meta,
      createdAt: now,
      updatedAt: now,
    };
    this.groups.set(record.id, record);
    return { ...record };
  }

  async findByScimId(endpointId: string, scimId: string): Promise<GroupRecord | null> {
    for (const group of this.groups.values()) {
      if (group.endpointId === endpointId && group.scimId === scimId) {
        return { ...group };
      }
    }
    return null;
  }

  async findWithMembers(endpointId: string, scimId: string): Promise<GroupWithMembers | null> {
    const group = await this.findByScimId(endpointId, scimId);
    if (!group) return null;
    return {
      ...group,
      members: this.getMembersForGroup(group.id),
    };
  }

  async findAllWithMembers(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<GroupWithMembers[]> {
    let results = Array.from(this.groups.values()).filter(
      (g) => g.endpointId === endpointId,
    );

    if (dbFilter) {
      for (const [key, value] of Object.entries(dbFilter)) {
        results = results.filter((g) => {
          const stored = (g as unknown as Record<string, unknown>)[key];
          // Case-insensitive comparison for displayName (matches CITEXT behavior)
          if (key === 'displayName' && typeof stored === 'string' && typeof value === 'string') {
            return stored.toLowerCase() === value.toLowerCase();
          }
          return stored === value;
        });
      }
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

    return results.map((g) => ({
      ...g,
      members: this.getMembersForGroup(g.id),
    }));
  }

  async update(id: string, data: GroupUpdateInput): Promise<GroupRecord> {
    const existing = this.groups.get(id);
    if (!existing) {
      throw new Error(`Group with id ${id} not found`);
    }
    const updated: GroupRecord = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.groups.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
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
  ): Promise<{ scimId: string } | null> {
    // Phase 3: Case-insensitive comparison at query time (matches CITEXT behavior)
    const lowerName = displayName.toLowerCase();
    for (const group of this.groups.values()) {
      if (group.endpointId !== endpointId) continue;
      if (excludeScimId && group.scimId === excludeScimId) continue;
      if (group.displayName.toLowerCase() === lowerName) {
        return { scimId: group.scimId };
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
    for (const m of members) {
      const record: MemberRecord = {
        id: randomUUID(),
        groupId,
        userId: m.userId,
        value: m.value,
        type: m.type,
        display: m.display,
        createdAt: new Date(),
      };
      this.members.set(record.id, record);
    }
  }

  async updateGroupWithMembers(
    groupId: string,
    data: GroupUpdateInput,
    members: MemberCreateInput[],
  ): Promise<void> {
    await this.update(groupId, data);

    for (const [memberId, member] of this.members) {
      if (member.groupId === groupId) {
        this.members.delete(memberId);
      }
    }

    await this.addMembers(groupId, members);
  }

  /** Clear all data — useful in test teardowns. */
  clear(): void {
    this.groups.clear();
    this.members.clear();
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
