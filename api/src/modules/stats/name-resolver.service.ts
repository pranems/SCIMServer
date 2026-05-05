/**
 * NameResolverService - batched SCIM resource name resolution with LRU cache.
 *
 * Resolves SCIM resource IDs (users, groups) to human-readable display names
 * for the activity feed and dashboard rendering. Uses an LRU cache with TTL
 * to minimize DB queries.
 *
 * Performance target: 50-item activity feed render with <=2 DB queries.
 *
 * Cache architecture (L3 tier):
 *   L1 (request-scoped) -> L3 (this LRU, 1000 entries, 5-min TTL) -> L4 (DB)
 *
 * @see docs/DELIVERY_PLAN.md UI-B4
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S6.5
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { USER_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../domain/repositories/group.repository.interface';

/** LRU cache entry with timestamp for TTL eviction */
interface CacheEntry {
  name: string | null;
  cachedAt: number;
}

/** Max cache size */
const MAX_CACHE_SIZE = 1000;

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class NameResolverService {
  private readonly logger = new Logger(NameResolverService.name);

  /**
   * LRU cache: composite key "endpointId:type:scimId" -> CacheEntry.
   * Uses Map insertion order for LRU eviction (oldest first).
   */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    @Inject(GROUP_REPOSITORY)
    private readonly groupRepo: IGroupRepository,
  ) {}

  // ─── Single Resolution ─────────────────────────────────────────────

  /** Resolve a user scimId to displayName (or userName fallback). */
  async resolveUserName(endpointId: string, scimId: string): Promise<string | null> {
    const key = this.cacheKey(endpointId, 'user', scimId);
    const cached = this.getFromCache(key);
    if (cached !== undefined) return cached;

    const user = await this.userRepo.findByScimId(endpointId, scimId);
    const name = user ? (user.displayName ?? user.userName) : null;
    this.putInCache(key, name);
    return name;
  }

  /** Resolve a group scimId to displayName. */
  async resolveGroupName(endpointId: string, scimId: string): Promise<string | null> {
    const key = this.cacheKey(endpointId, 'group', scimId);
    const cached = this.getFromCache(key);
    if (cached !== undefined) return cached;

    const group = await this.groupRepo.findWithMembers(endpointId, scimId);
    const name = group ? group.displayName : null;
    this.putInCache(key, name);
    return name;
  }

  // ─── Batch Resolution ──────────────────────────────────────────────

  /**
   * Resolve multiple user scimIds to displayNames in a single batch query.
   * Populates the LRU cache for subsequent single lookups.
   *
   * @returns Map from scimId to displayName (entries missing for unknown IDs)
   */
  async resolveUserNames(
    endpointId: string,
    scimIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uncached: string[] = [];

    // Check cache first
    for (const scimId of scimIds) {
      const key = this.cacheKey(endpointId, 'user', scimId);
      const cached = this.getFromCache(key);
      if (cached !== undefined && cached !== null) {
        result.set(scimId, cached);
      } else if (cached === undefined) {
        uncached.push(scimId);
      }
      // cached === null means we know it doesn't exist - skip
    }

    if (uncached.length === 0) return result;

    // Batch resolve from DB
    const allUsers = await this.userRepo.findAll(endpointId);
    const userMap = new Map(allUsers.map((u) => [u.scimId, u]));

    for (const scimId of uncached) {
      const user = userMap.get(scimId);
      const name = user ? (user.displayName ?? user.userName) : null;
      const key = this.cacheKey(endpointId, 'user', scimId);
      this.putInCache(key, name);
      if (name) {
        result.set(scimId, name);
      }
    }

    // Also populate cache for all users in the batch result (warming)
    for (const user of allUsers) {
      const key = this.cacheKey(endpointId, 'user', user.scimId);
      if (!this.cache.has(key)) {
        const name = user.displayName ?? user.userName;
        this.putInCache(key, name);
      }
    }

    return result;
  }

  // ─── Cache Management ──────────────────────────────────────────────

  /** Invalidate a specific cache entry. */
  invalidate(endpointId: string, scimId: string): void {
    // Invalidate both user and group keys since caller may not know the type
    this.cache.delete(this.cacheKey(endpointId, 'user', scimId));
    this.cache.delete(this.cacheKey(endpointId, 'group', scimId));
  }

  /** Clear the entire cache. */
  clearCache(): void {
    this.cache.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────

  private cacheKey(endpointId: string, type: 'user' | 'group', scimId: string): string {
    return `${endpointId}:${type}:${scimId}`;
  }

  /** Get from cache, respecting TTL. Returns undefined on miss. */
  private getFromCache(key: string): string | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end for LRU (Map insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.name;
  }

  /** Put into cache, evicting oldest entry if at capacity. */
  private putInCache(key: string, name: string | null): void {
    // Evict oldest if at capacity
    if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { name, cachedAt: Date.now() });
  }
}
