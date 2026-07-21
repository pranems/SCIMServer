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
import { Controller, Get, Inject, Optional, Param, Req } from '@nestjs/common';
import type { Request } from 'express';

import { StatsProjectionService } from '../stats/stats-projection.service';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { LoggingService } from '../logging/logging.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../domain/repositories/endpoint-credential.repository.interface';
import { ConnectionInfoService } from '../scim/services/connection-info.service';
import { AuthDecisionRecordStore } from '../../oauth/auth-decision-record.store';
import { ConnectionSecretResolverService } from '../scim/services/connection-secret-resolver.service';
import type { EndpointConfig } from '../endpoint/endpoint-config.interface';
import type {
  DashboardResponse,
  DashboardEndpoint,
  DashboardActivity,
  EndpointOverviewResponse,
  EndpointOverviewActivity,
  EndpointOverviewCredential,
  EndpointOverviewWifTrust,
} from '../../shared/types/dashboard.types';

/**
 * Project a WIF credential's stored metadata to the public display shape,
 * hard-allowlisting the trust-configuration keys. A WIF credential has no
 * secret, but this closed allowlist guarantees a future metadata addition
 * (e.g. an internal seam field) cannot silently leak through the overview.
 */
function projectWifTrust(
  metadata: Record<string, unknown> | null | undefined,
): EndpointOverviewWifTrust | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const roles = metadata.requiredRoles;
  const enforcement = metadata.roleEnforcement;
  return {
    expectedIssuer: asString(metadata.expectedIssuer),
    expectedSubject: asString(metadata.expectedSubject),
    expectedAudience: asString(metadata.expectedAudience),
    jwksUri: asString(metadata.jwksUri),
    allowedTenantId: asString(metadata.allowedTenantId),
    allowedTenantIdSource:
      metadata.allowedTenantIdSource === 'issuer' || metadata.allowedTenantIdSource === 'jwksUri'
        ? metadata.allowedTenantIdSource
        : null,
    requiredRoles: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : null,
    scope: asString(metadata.scope),
    assertionProfile: asString(metadata.assertionProfile),
    issuedTokenTtlSec: typeof metadata.issuedTokenTtlSec === 'number' ? metadata.issuedTokenTtlSec : null,
    roleEnforcement:
      enforcement === 'off' || enforcement === 'shadow' || enforcement === 'enforce' ? enforcement : null,
    lastVerifiedAt: asString(metadata.lastVerifiedAt),
  };
}

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
    private readonly connectionInfo: ConnectionInfoService,
    private readonly secretResolver: ConnectionSecretResolverService,
    @Optional()
    @Inject(AuthDecisionRecordStore)
    private readonly decisionStore?: AuthDecisionRecordStore,
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

    // Parallel: endpoints + recent activity + 24h series. Stats are in-memory (sync).
    const [endpointList, recentLogs, requestsLast24hSeries] = await Promise.all([
      this.endpointService.listEndpoints(),
      this.loggingService.listLogs({ pageSize: 20, page: 1 }),
      this.loggingService.getRequestSeries({ hours: 24 }),
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
      requestsLast24hSeries,
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
    @Req() req: Request,
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
      // Surface the public WIF trust fields so the UI can display + edit
      // the full trust. projectWifTrust returns null for non-wif rows and
      // hard-allowlists the keys so no secret/internal field can leak.
      ...(c.credentialType === 'wif' ? { wif: projectWifTrust(c.metadata) } : {}),
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

    // WI-3: assemble the connection-info (absolute URLs + per-method Entra
    // field set) so the Overview UI never hand-builds URLs. Host is derived
    // from the request exactly as the connection-info controller does.
    const proto = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
    const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
    // When CredentialSecretVisibility=always, inline the actual secrets so the
    // Connect tab (which reads this BFF) can show every connection parameter
    // (incl. the global shared_secret, which has no per-credential reveal path).
    const overviewSecrets = await this.secretResolver.resolveForEndpoint(
      configFlags as EndpointConfig,
      credentialRows,
    );
    const connectionInfo = this.connectionInfo.assemble(
      endpoint,
      credentialRows,
      `${proto}://${host}`,
      overviewSecrets,
      this.decisionStore
        ? ConnectionInfoService.buildAuthHealth(
            this.decisionStore.latestByMethodForEndpoint(endpoint.id),
          )
        : undefined,
    );

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
      connectionInfo,
    };
  }
}
