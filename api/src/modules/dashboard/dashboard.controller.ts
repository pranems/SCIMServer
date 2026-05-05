/**
 * DashboardController - BFF endpoint for the admin dashboard.
 *
 * Aggregates stats, endpoints, activity, health, and version info into
 * a single GET /admin/dashboard response. Stats come from the in-memory
 * StatsProjectionService (zero DB queries for counters).
 *
 * @see docs/DELIVERY_PLAN.md UI-B6
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S14
 */
import { Controller, Get } from '@nestjs/common';

import { StatsProjectionService } from '../stats/stats-projection.service';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { LoggingService } from '../logging/logging.service';
import type {
  DashboardResponse,
  DashboardEndpoint,
  DashboardActivity,
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
}
