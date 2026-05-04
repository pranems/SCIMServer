/**
 * StatsProjectionService - materialized in-memory counter cache.
 *
 * Eliminates all COUNT(*) queries for dashboard/stats rendering.
 *
 * Lifecycle:
 *   1. onModuleInit - seeds counts from IUserRepository / IGroupRepository
 *   2. Event handlers - increment/decrement on SCIM mutations via @OnEvent
 *   3. reconcile() - periodic 60s re-seed from authoritative repos
 *
 * All reads (getGlobalStats, getEndpointStats) are O(1) with zero DB queries.
 *
 * @see docs/DELIVERY_PLAN.md UI-B2
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S6.2
 */
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';

import { USER_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { GENERIC_RESOURCE_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../domain/repositories/group.repository.interface';
import type { IGenericResourceRepository } from '../../domain/repositories/generic-resource.repository.interface';

import {
  SCIM_EVENTS,
  type ScimEventPayload,
  type ScimResourceEventPayload,
  type ScimStatusChangePayload,
  type EndpointStatsSnapshot,
  type GlobalStatsSnapshot,
} from './scim-events';

/** Internal mutable counter state per endpoint */
interface EndpointCounters {
  userCount: number;
  activeUserCount: number;
  groupCount: number;
  activeGroupCount: number;
  genericResourceCount: number;
}

/** Reconciliation interval: 60 seconds */
const RECONCILE_INTERVAL_MS = 60_000;

@Injectable()
export class StatsProjectionService implements OnModuleInit {
  private readonly logger = new Logger(StatsProjectionService.name);

  /** Per-endpoint counters (endpointId -> counters) */
  private readonly counters = new Map<string, EndpointCounters>();

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    @Inject(GROUP_REPOSITORY)
    private readonly groupRepo: IGroupRepository,
    @Optional()
    @Inject(GENERIC_RESOURCE_REPOSITORY)
    private readonly genericRepo: IGenericResourceRepository | null,
    @Inject('EndpointService')
    private readonly endpointService: { listEndpoints(): Promise<{ totalResults: number; endpoints: { id: string }[] }> },
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.seedFromRepositories();
  }

  // ─── Reads (zero DB queries) ────────────────────────────────────────

  /** Get aggregated stats for a single endpoint. Returns zeroed snapshot if unknown. */
  getEndpointStats(endpointId: string): EndpointStatsSnapshot {
    const c = this.counters.get(endpointId);
    if (!c) {
      return { userCount: 0, activeUserCount: 0, groupCount: 0, activeGroupCount: 0, genericResourceCount: 0 };
    }
    return { ...c };
  }

  /** Get global aggregation across all tracked endpoints. */
  getGlobalStats(): GlobalStatsSnapshot {
    let totalUsers = 0;
    let totalGroups = 0;
    let totalGenericResources = 0;

    for (const c of this.counters.values()) {
      totalUsers += c.userCount;
      totalGroups += c.groupCount;
      totalGenericResources += c.genericResourceCount;
    }

    return {
      totalEndpoints: this.counters.size,
      totalUsers,
      totalGroups,
      totalGenericResources,
    };
  }

  /** Get a read-only snapshot map of all tracked endpoints. */
  getAllEndpointStats(): Map<string, EndpointStatsSnapshot> {
    const result = new Map<string, EndpointStatsSnapshot>();
    for (const [id, c] of this.counters.entries()) {
      result.set(id, { ...c });
    }
    return result;
  }

  // ─── Event Handlers (called by EventEmitter2 via @OnEvent) ──────────

  @OnEvent(SCIM_EVENTS.USER_CREATED)
  handleUserCreated(payload: ScimEventPayload): void {
    const c = this.ensureCounters(payload.endpointId);
    c.userCount++;
    if (payload.active !== false) {
      c.activeUserCount++;
    }
  }

  @OnEvent(SCIM_EVENTS.USER_DELETED)
  handleUserDeleted(payload: ScimEventPayload): void {
    const c = this.ensureCounters(payload.endpointId);
    c.userCount = Math.max(0, c.userCount - 1);
    if (payload.active === true) {
      c.activeUserCount = Math.max(0, c.activeUserCount - 1);
    }
  }

  @OnEvent(SCIM_EVENTS.USER_STATUS_CHANGED)
  handleUserStatusChanged(payload: ScimStatusChangePayload): void {
    const c = this.ensureCounters(payload.endpointId);
    if (payload.previousActive && !payload.newActive) {
      c.activeUserCount = Math.max(0, c.activeUserCount - 1);
    } else if (!payload.previousActive && payload.newActive) {
      c.activeUserCount++;
    }
  }

  @OnEvent(SCIM_EVENTS.GROUP_CREATED)
  handleGroupCreated(payload: ScimEventPayload): void {
    const c = this.ensureCounters(payload.endpointId);
    c.groupCount++;
    if (payload.active !== false) {
      c.activeGroupCount++;
    }
  }

  @OnEvent(SCIM_EVENTS.GROUP_DELETED)
  handleGroupDeleted(payload: ScimEventPayload): void {
    const c = this.ensureCounters(payload.endpointId);
    c.groupCount = Math.max(0, c.groupCount - 1);
    if (payload.active === true) {
      c.activeGroupCount = Math.max(0, c.activeGroupCount - 1);
    }
  }

  @OnEvent(SCIM_EVENTS.GROUP_STATUS_CHANGED)
  handleGroupStatusChanged(payload: ScimStatusChangePayload): void {
    const c = this.ensureCounters(payload.endpointId);
    if (payload.previousActive && !payload.newActive) {
      c.activeGroupCount = Math.max(0, c.activeGroupCount - 1);
    } else if (!payload.previousActive && payload.newActive) {
      c.activeGroupCount++;
    }
  }

  @OnEvent(SCIM_EVENTS.RESOURCE_CREATED)
  handleResourceCreated(payload: ScimResourceEventPayload): void {
    const c = this.ensureCounters(payload.endpointId);
    c.genericResourceCount++;
  }

  @OnEvent(SCIM_EVENTS.RESOURCE_DELETED)
  handleResourceDeleted(payload: ScimResourceEventPayload): void {
    const c = this.ensureCounters(payload.endpointId);
    c.genericResourceCount = Math.max(0, c.genericResourceCount - 1);
  }

  // ─── Reconciliation ────────────────────────────────────────────────

  /**
   * Re-seed all counters from authoritative repositories.
   * Called periodically (60s) to correct any drift from missed events.
   */
  @Interval(RECONCILE_INTERVAL_MS)
  async reconcile(): Promise<void> {
    await this.seedFromRepositories();
  }

  // ─── Private ────────────────────────────────────────────────────────

  /** Seed (or re-seed) counters from the authoritative repo layer. */
  private async seedFromRepositories(): Promise<void> {
    let endpoints: { id: string }[];
    try {
      const result = await this.endpointService.listEndpoints();
      endpoints = result.endpoints;
    } catch (error) {
      this.logger.warn(`Failed to list endpoints for stats seeding: ${(error as Error).message}`);
      return; // Graceful degradation - keep existing counters, retry on next reconcile
    }

    const activeEndpointIds = new Set(endpoints.map((ep) => ep.id));

    // Remove stale endpoints
    for (const id of this.counters.keys()) {
      if (!activeEndpointIds.has(id)) {
        this.counters.delete(id);
      }
    }

    // Seed/re-seed each active endpoint (isolated per-endpoint error handling)
    let seededCount = 0;
    for (const ep of endpoints) {
      try {
        const users = await this.userRepo.findAll(ep.id);
        const groups = await this.groupRepo.findAllWithMembers(ep.id);

        const c: EndpointCounters = {
          userCount: users.length,
          activeUserCount: users.filter((u) => u.active).length,
          groupCount: groups.length,
          activeGroupCount: groups.filter((g) => g.active).length,
          genericResourceCount: 0, // Generic resources not seeded from DB - event-driven only; reconcile preserves existing count
        };

        // Preserve existing genericResourceCount if already tracked (event-driven)
        const existing = this.counters.get(ep.id);
        if (existing) {
          c.genericResourceCount = existing.genericResourceCount;
        }

        this.counters.set(ep.id, c);
        seededCount++;
      } catch (error) {
        this.logger.warn(`Failed to seed stats for endpoint ${ep.id}: ${(error as Error).message}`);
        // Skip this endpoint; keep existing counters if any, retry on next reconcile
      }
    }

    this.logger.debug(`Stats seeded: ${seededCount}/${endpoints.length} endpoints`);
  }

  /** Get or create counters for an endpoint (lazy init on event). */
  private ensureCounters(endpointId: string): EndpointCounters {
    let c = this.counters.get(endpointId);
    if (!c) {
      c = { userCount: 0, activeUserCount: 0, groupCount: 0, activeGroupCount: 0, genericResourceCount: 0 };
      this.counters.set(endpointId, c);
    }
    return c;
  }
}
