/**
 * IUserRepository — persistence port for SCIM User resources.
 *
 * Implementations:
 *   - PrismaUserRepository  (SQLite / PostgreSQL via Prisma)
 *   - InMemoryUserRepository (testing / lightweight deployments)
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

  /** Find a user by its SCIM-visible id within a tenant. */
  findByScimId(endpointId: string, scimId: string): Promise<UserRecord | null>;

  /**
   * List users for a tenant, optionally filtered.
   *
   * @param endpointId Tenant identifier (mandatory for isolation).
   * @param dbFilter   Simple key-value filter pushed down from the SCIM filter parser.
   *                   Example: `{ userNameLower: 'alice' }`.
   * @param orderBy    Sort specification, e.g. `{ field: 'createdAt', direction: 'asc' }`.
   */
  findAll(
    endpointId: string,
    dbFilter?: Record<string, unknown>,
    orderBy?: { field: string; direction: 'asc' | 'desc' },
  ): Promise<UserRecord[]>;

  /** Update a user by its internal storage ID. */
  update(id: string, data: UserUpdateInput): Promise<UserRecord>;

  /** Delete a user by its internal storage ID. */
  delete(id: string): Promise<void>;

  /**
   * Check for uniqueness violations within a tenant.
   *
   * Searches for any existing user whose `userNameLower` matches
   * `userName.toLowerCase()` OR whose `externalId` matches `externalId`.
   * Optionally excludes a record with the given `scimId` (for PUT/PATCH).
   *
   * @returns The conflicting record's identifiers, or `null` if unique.
   */
  findConflict(
    endpointId: string,
    userName: string,
    externalId?: string,
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
