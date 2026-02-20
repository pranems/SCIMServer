/**
 * IGroupRepository — persistence port for SCIM Group resources.
 *
 * Implementations:
 *   - PrismaGroupRepository  (SQLite / PostgreSQL via Prisma)
 *   - InMemoryGroupRepository (testing / lightweight deployments)
 */
import type {
  GroupRecord,
  GroupWithMembers,
  GroupCreateInput,
  GroupUpdateInput,
  MemberCreateInput,
} from '../models/group.model';

export interface IGroupRepository {
  /** Create a new group (without members) and return the record. */
  create(input: GroupCreateInput): Promise<GroupRecord>;

  /** Find a group by SCIM id within a tenant (without members). */
  findByScimId(endpointId: string, scimId: string): Promise<GroupRecord | null>;

  /** Find a group by SCIM id within a tenant, including members. */
  findWithMembers(endpointId: string, scimId: string): Promise<GroupWithMembers | null>;

  /**
   * List groups for a tenant, including members.
   *
   * @param endpointId Tenant identifier.
   * @param dbFilter   Simple key-value filter from the SCIM filter parser.
   * @param orderBy    Sort specification.
   */
  findAllWithMembers(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<GroupWithMembers[]>;

  /** Update a group by its internal storage ID. */
  update(id: string, data: GroupUpdateInput): Promise<GroupRecord>;

  /** Delete a group by its internal storage ID. */
  delete(id: string): Promise<void>;

  /**
   * Check for displayName uniqueness within a tenant.
   * @returns The conflicting record's scimId, or null if unique.
   */
  findByDisplayName(
    endpointId: string,
    displayNameLower: string,
    excludeScimId?: string,
  ): Promise<{ scimId: string } | null>;

  /**
   * Check for externalId uniqueness within a tenant.
   * @returns The conflicting record, or null if unique.
   */
  findByExternalId(
    endpointId: string,
    externalId: string,
    excludeScimId?: string,
  ): Promise<GroupRecord | null>;

  /** Add members to a group. */
  addMembers(groupId: string, members: MemberCreateInput[]): Promise<void>;

  /**
   * Atomically update group fields and replace all members.
   * Wraps update + deleteMany + createMany in a single transaction.
   */
  updateGroupWithMembers(
    groupId: string,
    data: GroupUpdateInput,
    members: MemberCreateInput[],
  ): Promise<void>;
}
