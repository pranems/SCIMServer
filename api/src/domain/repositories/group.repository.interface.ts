/**
 * IGroupRepository - persistence port for SCIM Group resources.
 *
 * Implementations:
 *   - PrismaGroupRepository  (PostgreSQL via Prisma)
 *   - InMemoryGroupRepository (testing / lightweight deployments)
 *
 * Phase 3: displayNameLower parameter renamed to displayName - CITEXT/InMemory
 * handles case-insensitive comparison without a pre-computed lowercase column.
 */
import type { ExpectedVersion } from './write-precondition';
import type { UniquenessPolicy } from './uniqueness-policy';
import type {
  GroupRecord,
  GroupWithMembers,
  GroupCreateInput,
  GroupUpdateInput,
  MemberCreateInput,
} from '../models/group.model';

export interface IGroupRepository {
  /** Atomically create a Group and its initial members; failure publishes neither. */
  create(input: GroupCreateInput, members?: MemberCreateInput[], uniqueness?: UniquenessPolicy): Promise<GroupRecord>;

  /** Find a group by SCIM id within an endpoint (without members). */
  findByScimId(endpointId: string, scimId: string): Promise<GroupRecord | null>;

  /** Find a group by SCIM id within an endpoint, including members. */
  findWithMembers(endpointId: string, scimId: string): Promise<GroupWithMembers | null>;

  /**
   * List groups for an endpoint, including members.
   *
   * @param endpointId Endpoint identifier.
   * @param dbFilter   Simple key-value filter from the SCIM filter parser.
   * @param orderBy    Sort specification.
   */
  findAllWithMembers(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc'; caseExact?: boolean },
  ): Promise<GroupWithMembers[]>;

  /** Update a group by its internal storage ID. */
  update(id: string, data: GroupUpdateInput, expectedVersion?: ExpectedVersion, uniqueness?: UniquenessPolicy): Promise<GroupRecord>;

  /** Delete a group by its internal storage ID. */
  delete(id: string, expectedVersion?: ExpectedVersion): Promise<void>;

  /**
   * Check for displayName uniqueness within an endpoint (case-insensitive).
   * @returns The conflicting record's scimId and active status, or null if unique.
   */
  findByDisplayName(
    endpointId: string,
    displayName: string,
    excludeScimId?: string,
  ): Promise<{ scimId: string; active: boolean } | null>;

  /**
   * Check for externalId uniqueness within an endpoint.
   * @returns The conflicting record, or null if unique.
   */
  findByExternalId(
    endpointId: string,
    externalId: string,
    excludeScimId?: string,
  ): Promise<GroupRecord | null>;

  /** Append members atomically; callers must explicitly supply the resource policy. */
  addMembers(groupId: string, members: MemberCreateInput[], uniqueness: UniquenessPolicy): Promise<void>;

  /**
   * Atomically update group fields and replace all members.
   * Wraps update + deleteMany + createMany in a single transaction.
   */
  updateGroupWithMembers(
    groupId: string,
    data: GroupUpdateInput,
    members: MemberCreateInput[],
    expectedVersion?: ExpectedVersion,
    uniqueness?: UniquenessPolicy,
  ): Promise<void>;
}
