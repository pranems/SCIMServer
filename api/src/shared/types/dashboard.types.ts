/**
 * Shared type contracts for the SCIMServer Dashboard BFF.
 *
 * These types are the single source of truth consumed by both:
 *   - api/ (NestJS backend - BFF controllers, services, tests)
 *   - web/ (React frontend - via @scim/types Vite alias)
 *
 * Rule: any shape change here must pass `tsc --noEmit` in both projects.
 *
 * @module @scim/types
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S14.1
 * @see docs/DELIVERY_PLAN.md UI-B1
 */
import type { ConnectionInfo } from './connection-info.types';

// ─── Resource Stats ──────────────────────────────────────────────────────

/** User/Group count breakdown */
export interface ResourceStats {
  total: number;
  active: number;
  inactive: number;
}

/** Group member aggregate */
export interface GroupMemberStats {
  total: number;
}

/** Request log aggregate */
export interface RequestLogStats {
  total: number;
}

// ─── Endpoint Stats ──────────────────────────────────────────────────────

export interface EndpointStatsResponse {
  users: ResourceStats;
  groups: ResourceStats;
  groupMembers: GroupMemberStats;
  requestLogs: RequestLogStats;
}

// ─── Endpoint Overview ───────────────────────────────────────────────────

/** Schema summary (compact, no full attribute list) */
export interface SchemaSummary {
  id: string;
  name: string;
  attributeCount: number;
}

/** Resource type summary */
export interface ResourceTypeSummary {
  name: string;
  schema: string;
  extensions: string[];
  extensionCount: number;
}

/** ServiceProviderConfig summary (boolean capability flags) */
export interface ServiceProviderConfigSummary {
  patch: boolean;
  bulk: boolean;
  filter: boolean;
  changePassword: boolean;
  sort: boolean;
  etag: boolean;
}

/** Profile summary for list/summary views */
export interface ProfileSummary {
  schemaCount: number;
  schemas: SchemaSummary[];
  resourceTypeCount: number;
  resourceTypes: ResourceTypeSummary[];
  serviceProviderConfig: ServiceProviderConfigSummary;
  activeSettings: Record<string, unknown>;
}

/** HATEOAS links for an endpoint */
export interface EndpointLinks {
  self: string;
  stats: string;
  credentials: string;
  scim: string;
}

/** Endpoint response (summary or full view) */
export interface EndpointResponse {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  profile?: Record<string, unknown>;
  profileSummary?: ProfileSummary;
  active: boolean;
  scimBasePath: string;
  createdAt: string;
  updatedAt: string;
  _links: EndpointLinks;
}

/** Envelope for endpoint list */
export interface EndpointListResponse {
  totalResults: number;
  endpoints: EndpointResponse[];
}

// ─── Version Info ────────────────────────────────────────────────────────

export interface VersionServiceInfo {
  name: string;
  environment: string;
  apiPrefix: string;
  scimBasePath: string;
  now: string;
  startedAt: string;
  uptimeSeconds: number;
  timezone: string;
  utcOffset: string;
}

export interface VersionMemoryInfo {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface VersionRuntimeInfo {
  node: string;
  platform: string;
  arch: string;
  pid: number;
  hostname: string;
  cpus: number;
  containerized: boolean;
  memory: VersionMemoryInfo;
}

export interface VersionAuthInfo {
  oauthClientId?: string;
  oauthClientSecretConfigured: boolean;
  jwtSecretConfigured: boolean;
  scimSharedSecretConfigured: boolean;
}

export interface VersionStorageInfo {
  databaseUrl?: string;
  databaseProvider: string;
  persistenceBackend: 'prisma' | 'inmemory';
  connectionPool?: {
    maxConnections: number;
  };
}

export interface VersionInfo {
  version: string;
  commit?: string;
  buildTime?: string;
  service: VersionServiceInfo;
  runtime: VersionRuntimeInfo;
  auth: VersionAuthInfo;
  storage: VersionStorageInfo;
  container?: Record<string, unknown>;
  deployment?: Record<string, unknown>;
}

// ─── Health ──────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
}

// ─── Dashboard BFF (aggregated response) ─────────────────────────────────

/** Dashboard health summary */
export interface DashboardHealth {
  status: 'ok' | 'error';
  uptime: number;
  dbType: string;
}

/** Dashboard endpoint card */
export interface DashboardEndpoint {
  id: string;
  name: string;
  displayName?: string;
  active: boolean;
  users: ResourceStats;
  groups: ResourceStats;
  createdAt: string;
  _links: EndpointLinks;
}

/** Activity feed entry */
export interface DashboardActivity {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  endpointId: string;
  endpointName?: string;
}

/** Aggregated dashboard response (BFF endpoint) */
export interface DashboardResponse {
  health: DashboardHealth;
  stats: {
    totalEndpoints: number;
    totalUsers: number;
    totalGroups: number;
  };
  endpoints: DashboardEndpoint[];
  recentActivity: DashboardActivity[];
  /**
   * Phase D4 - Dashboard charts.
   *
   * Hourly request counts for the last 24 hours, oldest first. Length is
   * always exactly 24. `requestsLast24hSeries[0]` is the oldest hour
   * (i.e. ~24h ago), `requestsLast24hSeries[23]` is the current hour.
   * Excludes admin/health/keepalive traffic - matches the same default
   * filter LoggingService.listLogs applies (i.e. `includeAdmin: false`).
   *
   * Computed by LoggingService.getRequestSeries({ hours: 24 }) on each
   * dashboard load - cheap on warm cache (one indexed range scan), no
   * materialization needed at this scale.
   *
   * @see docs/PHASE_D4_DASHBOARD_CHARTS.md
   */
  requestsLast24hSeries: number[];
  version: {
    version: string;
    node: string;
    uptime: number;
  };
}

// ─── Endpoint Overview BFF (Phase B1) ────────────────────────────────────
//
// One round trip for the per-endpoint Overview tab. Reads from in-memory
// caches (StatsProjectionService, EndpointService cache, NameResolverService
// LRU) so the response carries zero database queries on warm cache.
//
// Response shape is locked in by api/test/e2e/dashboard-overview.e2e-spec.ts
// (key allowlist) and api/src/modules/dashboard/dashboard.controller.spec.ts
// (unit-level shape).

/** Endpoint summary embedded in the overview response. */
export interface EndpointOverviewSummary {
  id: string;
  name: string;
  displayName?: string;
  /** Preset name from profile.preset, or null when the endpoint has no preset. */
  preset: string | null;
  active: boolean;
  scimBasePath: string;
  createdAt: string;
}

/** Aggregated per-endpoint stats (matches StatsProjectionService snapshot). */
export interface EndpointOverviewStats {
  userCount: number;
  activeUserCount: number;
  groupCount: number;
  activeGroupCount: number;
  genericResourceCount: number;
}

/** Credential summary embedded in the overview response. Hash NEVER returned. */
export interface EndpointOverviewCredential {
  id: string;
  credentialType: string;
  label?: string | null;
  /**
   * X3/X4 - operator-supplied free-text description (never a secret), stored in
   * metadata.description on any credential type. Null when none was set.
   */
  description?: string | null;
  active: boolean;
  createdAt: string;
  expiresAt?: string | null;
  /**
   * Public WIF trust fields, present ONLY when credentialType === 'wif'.
   * These are all non-secret trust-configuration values (a WIF credential
   * stores no secret), surfaced so the UI can display the full trust and
   * offer inline editing without a second round trip. NEVER includes any
   * secret/hash material (a WIF credential has none).
   */
  wif?: EndpointOverviewWifTrust | null;
  /**
   * U2 - the public client id for an `oauth_client` credential (from
   * metadata.clientId), so each credential row can render its own
   * Connect-to-Entra bundle. Absent for other credential types. Never a secret.
   */
  oauthClientId?: string | null;
}

/**
 * Public projection of a WIF trust for display + edit in the UI. Every
 * field here is a non-secret trust-configuration value. Kept as a closed
 * allowlist so a future metadata addition cannot silently leak.
 */
export interface EndpointOverviewWifTrust {
  expectedIssuer?: string | null;
  expectedSubject?: string | null;
  expectedAudience?: string | null;
  jwksUri?: string | null;
  allowedTenantId?: string | null;
  /** U8 - which input `allowedTenantId` was gleaned from, or null when explicit. */
  allowedTenantIdSource?: 'issuer' | 'jwksUri' | null;
  requiredRoles?: string[] | null;
  scope?: string | null;
  assertionProfile?: string | null;
  issuedTokenTtlSec?: number | null;
  /** Item E - role-enforcement posture (off default | shadow | enforce). */
  roleEnforcement?: 'off' | 'shadow' | 'enforce' | null;
  /** U7 - ISO timestamp of the last successful verify-on-save, or null. */
  lastVerifiedAt?: string | null;
}

/** Recent activity row with display-name resolution. */
export interface EndpointOverviewActivity {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

/** Full BFF response for GET /admin/endpoints/:id/overview (Phase B1). */
export interface EndpointOverviewResponse {
  endpoint: EndpointOverviewSummary;
  stats: EndpointOverviewStats;
  credentials: EndpointOverviewCredential[];
  recentActivity: EndpointOverviewActivity[];
  configFlags: Record<string, unknown>;
  /**
   * WI-3: the assembled connection-info (absolute URLs + per-method Entra
   * field set) so the UI never hand-builds URLs. Same shape the dedicated
   * `GET /admin/endpoints/{id}/connection-info` returns; no secrets.
   */
  connectionInfo: ConnectionInfo;
}

// ─── Presets ─────────────────────────────────────────────────────────────

/** Preset summary in list response */
export interface PresetSummary {
  name: string;
  displayName?: string;
  description?: string;
  isDefault: boolean;
  schemaCount: number;
  serviceProviderConfig: ServiceProviderConfigSummary;
}

/** Preset list envelope */
export interface PresetListResponse {
  totalResults: number;
  presets: PresetSummary[];
}
