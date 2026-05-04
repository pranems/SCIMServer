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
  version: {
    version: string;
    node: string;
    uptime: number;
  };
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
