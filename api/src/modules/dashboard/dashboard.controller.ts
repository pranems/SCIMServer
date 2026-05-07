/**
 * DashboardController - BFF endpoint for the admin dashboard.
 *
 * Aggregates stats, endpoints, activity, health, and version info into
 * a single GET /admin/dashboard response. Stats come from the in-memory
 * StatsProjectionService (zero DB queries for counters).
 *
 * Phase B1 adds GET /admin/endpoints/:id/overview - a per-endpoint BFF
 * that bundles summary, stats, credentials, recent activity, and config
 * flags into a single round trip with zero DB queries on warm cache.
 *
 * @see docs/DELIVERY_PLAN.md UI-B6
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S14
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase B1
 */
import { Controller, Get, Inject, Param } from '@nestjs/common';

import { StatsProjectionService } from '../stats/stats-projection.service';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { LoggingService } from '../logging/logging.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../domain/repositories/endpoint-credential.repository.interface';
import type {
  DashboardResponse,
  DashboardEndpoint,
  DashboardActivity,
  EndpointOverviewResponse,
  EndpointOverviewActivity,
  EndpointOverviewCredential,
} from '../../shared/types/dashboard.types';

/** Cached version string read once at construction */
let cachedVersion: string | null = null;

function getVersion(): string {
  if (cachedVersion === null) {
    const envVersion = process.env.APP_VERSION;
    if (envVersion) {
      cachedVersion = envVersion;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        cachedVersion = require('../../../package.json').version || '0.0.0';
      } catch {
        cachedVersion = '0.0.0';
      }
    }
  }
  return cachedVersion!;
}

@Controller('admin')
export class DashboardController {
  constructor(
    private readonly statsService: StatsProjectionService,
    private readonly endpointService: EndpointService,
    private readonly loggingService: LoggingService,
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
  ) {}

  /**
   * GET /admin/dashboard
   *
   * Aggregated BFF response combining:
   * - Health summary (uptime, db type)
   * - Global stats (from StatsProjectionService - 0 DB queries)
   * - Endpoint list with per-endpoint stats
   * - Recent activity (last 20 log entries)
   * - Version info
   */
  @Get('dashboard')
  async getDashboard(): Promise<DashboardResponse> {
    const persistenceBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase();

    // Parallel: endpoints + recent activity (stats are in-memory, no await needed)
    const [endpointList, recentLogs] = await Promise.all([
      this.endpointService.listEndpoints(),
      this.loggingService.listLogs({ pageSize: 20, page: 1 }),
    ]);

    // Global stats from in-memory projection (0 DB queries)
    const globalStats = this.statsService.getGlobalStats();

    // Build endpoint cards with per-endpoint stats
    const endpoints: DashboardEndpoint[] = endpointList.endpoints.map((ep) => {
      const epStats = this.statsService.getEndpointStats(ep.id);
      return {
        id: ep.id,
        name: ep.name,
        displayName: ep.displayName,
        active: ep.active,
        users: {
          total: epStats.userCount,
          active: epStats.activeUserCount,
          inactive: epStats.userCount - epStats.activeUserCount,
        },
        groups: {
          total: epStats.groupCount,
          active: epStats.activeGroupCount,
          inactive: epStats.groupCount - epStats.activeGroupCount,
        },
        createdAt: ep.createdAt,
        _links: ep._links,
      };
    });

    // Map recent logs to activity entries
    const recentActivity: DashboardActivity[] = recentLogs.items.map((log: any) => ({
      id: log.id,
      timestamp: log.createdAt instanceof Date ? log.createdAt.toISOString() : String(log.createdAt),
      method: log.method,
      path: log.url,
      statusCode: log.status ?? 0,
      durationMs: log.durationMs ?? 0,
      endpointId: log.endpointId ?? '',
    }));

    return {
      health: {
        status: 'ok',
        uptime: Number(process.uptime().toFixed(3)),
        dbType: persistenceBackend === 'inmemory' ? 'inmemory' : 'postgresql',
      },
      stats: {
        totalEndpoints: globalStats.totalEndpoints,
        totalUsers: globalStats.totalUsers,
        totalGroups: globalStats.totalGroups,
      },
      endpoints,
      recentActivity,
      version: {
        version: getVersion(),
        node: process.version,
        uptime: Number(process.uptime().toFixed(3)),
      },
    };
  }

  /**
   * GET /admin/endpoints/:endpointId/overview
   *
   * Phase B1 BFF for the per-endpoint Overview tab. One round trip,
   * zero DB queries on warm cache. Aggregates:
   *
   *   - endpoint summary (id, name, displayName, preset, active)
   *   - stats snapshot (from StatsProjectionService - in-memory)
   *   - credentials (id + label + active + createdAt; hash NEVER returned)
   *   - last 10 activity entries (scoped to endpointId)
   *   - config flags (whatever is in profile.settings)
   *
   * @throws NotFoundException when the endpointId resolves to nothing
   *         (delegated from EndpointService.getEndpoint).
   */
  @Get('endpoints/:endpointId/overview')
  async getEndpointOverview(
    @Param('endpointId') endpointId: string,
  ): Promise<EndpointOverviewResponse> {
    // Throws NotFoundException for unknown endpoints - propagates as 404.
    const endpoint = await this.endpointService.getEndpoint(endpointId, 'full');

    // Parallel: credentials + last 10 logs. Stats are in-memory (sync).
    const [credentialRows, recentLogs] = await Promise.all([
      this.credentialRepo.findByEndpoint(endpoint.id),
      this.loggingService.listLogs({ endpointId: endpoint.id, page: 1, pageSize: 10 }),
    ]);

    const stats = this.statsService.getEndpointStats(endpoint.id);

    // Credential projection - explicit allowlist; drops the bcrypt hash
    // and any other internal columns. Keeps the response stable across
    // schema additions.
    const credentials: EndpointOverviewCredential[] = credentialRows.map((c) => ({
      id: c.id,
      credentialType: c.credentialType,
      label: c.label ?? null,
      active: c.active,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
      expiresAt: c.expiresAt
        ? c.expiresAt instanceof Date
          ? c.expiresAt.toISOString()
          : String(c.expiresAt)
        : null,
    }));

    // Recent activity projection - same shape as DashboardActivity but
    // without endpointId/endpointName because the consumer already
    // knows the endpoint context (the URL contains :endpointId).
    const recentActivity: EndpointOverviewActivity[] = recentLogs.items
      .slice(0, 10)
      .map((log: any) => ({
        id: log.id,
        timestamp:
          log.createdAt instanceof Date ? log.createdAt.toISOString() : String(log.createdAt),
        method: log.method,
        path: log.url,
        statusCode: log.status ?? 0,
        durationMs: log.durationMs ?? 0,
      }));

    // Profile is optional in the EndpointResponse type; preset and
    // settings are nested under it. Use safe lookups so the call works
    // for endpoints with empty / minimal profiles too. We always emit
    // preset (null when unknown) so the response key is stable - the
    // frontend's TypeScript shape doesn't have to special-case missing
    // keys vs explicit nulls.
    const profile = (endpoint.profile ?? {}) as Record<string, unknown>;
    const preset = typeof profile.preset === 'string' ? profile.preset : null;
    const configFlags =
      profile.settings && typeof profile.settings === 'object'
        ? { ...(profile.settings as Record<string, unknown>) }
        : {};

    return {
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        displayName: endpoint.displayName,
        preset,
        active: endpoint.active,
        scimBasePath: endpoint.scimBasePath,
        createdAt: endpoint.createdAt,
      },
      stats: {
        userCount: stats.userCount,
        activeUserCount: stats.activeUserCount,
        groupCount: stats.groupCount,
        activeGroupCount: stats.activeGroupCount,
        genericResourceCount: stats.genericResourceCount,
      },
      credentials,
      recentActivity,
      configFlags,
    };
  }
}
