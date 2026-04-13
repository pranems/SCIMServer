/**
 * IUserRepository — persistence port for SCIM User resources.
 *
 * Implementations:
 *   - PrismaUserRepository  (PostgreSQL via Prisma)
 *   - InMemoryUserRepository (testing / lightweight deployments)
 *
 * Phase 3: userNameLower column removed — CITEXT/InMemory handles
 * case-insensitive comparison without a pre-computed lowercase column.
 */
import type {
  UserRecord,
  UserCreateInput,
  UserUpdateInput,
  UserConflictResult,
} from '../models/user.model';

export interface IUserRepository {
  /** Create a new user and return the complete record. */
  create(input: UserCreateInput): Promise<UserRecord>;

  /** Find a user by its SCIM-visible id within an endpoint. */
  findByScimId(endpointId: string, scimId: string): Promise<UserRecord | null>;

  /**
   * List users for an endpoint, optionally filtered.
   *
   * @param endpointId Endpoint identifier (mandatory for isolation).
   * @param dbFilter   Simple key-value filter pushed down from the SCIM filter parser.
   *                   Example: `{ userName: 'alice' }`.
   * @param orderBy    Sort specification, e.g. `{ field: 'createdAt', direction: 'asc' }`.
   */
  findAll(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc'; caseExact?: boolean },
  ): Promise<UserRecord[]>;

  /** Update a user by its internal storage ID. */
  update(id: string, data: UserUpdateInput): Promise<UserRecord>;

  /** Delete a user by its internal storage ID. */
  delete(id: string): Promise<void>;

  /**
   * Check for userName uniqueness within an endpoint.
   *
   * Searches for any existing user whose `userName` matches
   * case-insensitively (via CITEXT or toLowerCase).
   * Optionally excludes a record with the given `scimId` (for PUT/PATCH).
   *
   * Note: externalId and displayName are NOT checked for uniqueness —
   * they are saved as received per RFC 7643.
   *
   * @returns The conflicting record's identifiers, or `null` if unique.
   */
  findConflict(
    endpointId: string,
    userName: string,
    excludeScimId?: string,
  ): Promise<UserConflictResult | null>;

  /**
   * Resolve a batch of SCIM IDs to internal storage IDs.
   * Used by group membership resolution.
   */
  findByScimIds(
    endpointId: string,
    scimIds: string[],
  ): Promise<Array<Pick<UserRecord, 'id' | 'scimId'>>>;
}
