/**
 * Canonical fixtures shared by MSW handlers and the tests that
 * exercise them.
 *
 * Why a single fixtures file: every handler that returns a known shape
 * pulls from here, which keeps assertions like
 * `expect(data.totalResults).toBe(2)` honest - if a fixture changes,
 * every test that depends on it fails noisily instead of silently
 * passing against stale shape assumptions.
 *
 * @see web/src/test/msw/handlers.ts
 * @see docs/PHASE_H1_MSW_HANDLERS.md
 */
import type {
  DashboardResponse,
  EndpointListResponse,
  EndpointResponse,
  EndpointStatsResponse,
  EndpointOverviewResponse,
  VersionInfo,
  HealthResponse,
} from '@scim/types/dashboard.types';

/** Test endpoint id used as the "default" subject of detail/overview/etc. handlers. */
export const FIXTURE_ENDPOINT_ID = 'ep-msw-1';
export const FIXTURE_ENDPOINT_NAME = 'msw-endpoint';
export const FIXTURE_ENDPOINT_DISPLAY_NAME = 'MSW Test Endpoint';

const NOW_ISO = '2026-05-08T12:00:00.000Z';

/**
 * Build a `links` object pointing at the canonical SCIM admin URLs for
 * an endpoint. Inlined here so tests can compare against an exact value
 * instead of ".+/credentials" regex.
 */
function buildLinks(id: string) {
  return {
    self: `/scim/admin/endpoints/${id}`,
    stats: `/scim/admin/endpoints/${id}/stats`,
    credentials: `/scim/admin/endpoints/${id}/credentials`,
    scim: `/scim/v2`,
  };
}

export const FIXTURE_DASHBOARD: DashboardResponse = {
  health: { status: 'ok', uptime: 1234, dbType: 'In-Memory' },
  stats: {
    totalEndpoints: 1,
    totalUsers: 12,
    totalGroups: 3,
  },
  endpoints: [
    {
      id: FIXTURE_ENDPOINT_ID,
      name: FIXTURE_ENDPOINT_NAME,
      displayName: FIXTURE_ENDPOINT_DISPLAY_NAME,
      active: true,
      users: { total: 12, active: 10, inactive: 2 },
      groups: { total: 3, active: 3, inactive: 0 },
      createdAt: NOW_ISO,
      _links: buildLinks(FIXTURE_ENDPOINT_ID),
    },
  ],
  recentActivity: [
    {
      id: 'act-1',
      timestamp: NOW_ISO,
      method: 'POST',
      path: '/scim/v2/Users',
      statusCode: 201,
      durationMs: 42,
      endpointId: FIXTURE_ENDPOINT_ID,
      endpointName: FIXTURE_ENDPOINT_NAME,
    },
  ],
  // Phase D4 chart series: 24 hourly buckets, oldest first.
  requestsLast24hSeries: Array.from({ length: 24 }, (_, i) => i + 1),
  version: {
    version: '0.46.1-alpha.4',
    node: 'v25.9.0',
    uptime: 1234,
  },
};

export const FIXTURE_ENDPOINT_LIST: EndpointListResponse = {
  totalResults: 1,
  endpoints: [
    {
      id: FIXTURE_ENDPOINT_ID,
      name: FIXTURE_ENDPOINT_NAME,
      displayName: FIXTURE_ENDPOINT_DISPLAY_NAME,
      active: true,
      scimBasePath: `/scim/v2/${FIXTURE_ENDPOINT_NAME}`,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      _links: buildLinks(FIXTURE_ENDPOINT_ID),
    },
  ],
};

export const FIXTURE_ENDPOINT: EndpointResponse = {
  id: FIXTURE_ENDPOINT_ID,
  name: FIXTURE_ENDPOINT_NAME,
  displayName: FIXTURE_ENDPOINT_DISPLAY_NAME,
  active: true,
  scimBasePath: `/scim/v2/${FIXTURE_ENDPOINT_NAME}`,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
  // Profile + summary intentionally minimal; tests that need richer
  // shapes can spread into a copy.
  profile: {
    schemas: [],
    resourceTypes: [],
    serviceProviderConfig: { documentationUri: '', patch: { supported: true } },
    settings: {},
  },
  _links: buildLinks(FIXTURE_ENDPOINT_ID),
};

export const FIXTURE_ENDPOINT_STATS: EndpointStatsResponse = {
  users: { total: 12, active: 10, inactive: 2 },
  groups: { total: 3, active: 3, inactive: 0 },
  groupMembers: { total: 8 },
  requestLogs: { total: 100 },
};

export const FIXTURE_ENDPOINT_OVERVIEW: EndpointOverviewResponse = {
  endpoint: {
    id: FIXTURE_ENDPOINT_ID,
    name: FIXTURE_ENDPOINT_NAME,
    displayName: FIXTURE_ENDPOINT_DISPLAY_NAME,
    preset: 'rfc-standard',
    active: true,
    scimBasePath: `/scim/v2/${FIXTURE_ENDPOINT_NAME}`,
    createdAt: NOW_ISO,
  },
  stats: {
    userCount: 12,
    activeUserCount: 10,
    groupCount: 3,
    activeGroupCount: 3,
    genericResourceCount: 0,
  },
  configFlags: {
    StrictSchemaValidation: false,
    AllowAndCoerceBooleanStrings: true,
    PerEndpointCredentialsEnabled: true,
    SchemaDiscoveryEnabled: true,
  },
  credentials: [
    {
      id: 'cred-1',
      label: 'CI provisioning token',
      credentialType: 'bearer',
      active: true,
      createdAt: NOW_ISO,
      expiresAt: null,
    },
  ],
  recentActivity: [
    {
      id: 'act-1',
      timestamp: NOW_ISO,
      method: 'POST',
      path: '/scim/v2/Users',
      statusCode: 201,
      durationMs: 42,
    },
  ],
};

export const FIXTURE_VERSION: VersionInfo = {
  version: '0.46.1-alpha.4',
  service: {
    name: 'SCIMServer API',
    environment: 'test',
    apiPrefix: 'scim',
    scimBasePath: '/scim/v2',
    now: NOW_ISO,
    startedAt: NOW_ISO,
    uptimeSeconds: 1234,
    timezone: 'UTC',
    utcOffset: '+00:00',
  },
  runtime: {
    node: 'v25.9.0',
    platform: 'linux',
    arch: 'x64',
    pid: 1,
    hostname: 'msw-test',
    cpus: 4,
    containerized: true,
    memory: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1, arrayBuffers: 1 },
  },
  auth: {
    oauthClientSecretConfigured: true,
    jwtSecretConfigured: true,
    scimSharedSecretConfigured: true,
  },
  storage: {
    databaseUrl: 'sqlite::memory:',
    databaseProvider: 'sqlite',
    persistenceBackend: 'inmemory',
    connectionPool: { maxConnections: 1 },
  },
  container: {
    app: { name: 'msw-test', runtime: 'Node.js', platform: 'linux/x64' },
    database: { host: 'localhost', port: 5432, name: 'msw', provider: 'In-Memory' },
  },
  deployment: {
    resourceGroup: 'msw',
    containerApp: 'msw',
    registry: 'msw',
    migratePhase: 'Phase H1',
  },
};

export const FIXTURE_HEALTH: HealthResponse = {
  status: 'ok',
  uptime: 1234,
  timestamp: NOW_ISO,
};

/** Fake admin logs row matching the Phase D5 / queries.ts shape. */
export const FIXTURE_LOG_ROW = {
  id: 'log-1',
  endpointId: FIXTURE_ENDPOINT_ID,
  endpointName: FIXTURE_ENDPOINT_NAME,
  method: 'POST',
  url: '/scim/v2/Users',
  status: 201,
  durationMs: 42,
  createdAt: NOW_ISO,
  hasError: false,
  isAdmin: false,
};

export const FIXTURE_LOGS = {
  total: 1,
  page: 1,
  pageSize: 20,
  hasNext: false,
  hasPrev: false,
  items: [FIXTURE_LOG_ROW],
};

export const FIXTURE_LOG_DETAIL = {
  ...FIXTURE_LOG_ROW,
  requestBody: '{"userName":"alice"}',
  responseBody: '{"id":"u1"}',
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/scim+json' },
};

export const FIXTURE_ACTIVITY = {
  activities: [
    {
      id: 'act-1',
      operation: 'POST',
      resource: 'User',
      resourceId: 'u1',
      endpointId: FIXTURE_ENDPOINT_ID,
      endpointName: FIXTURE_ENDPOINT_NAME,
      status: 201,
      timestamp: NOW_ISO,
    },
  ],
  pagination: { total: 1, page: 1, pageSize: 20, hasNext: false, hasPrev: false },
};

/**
 * Minimal SCIM /Schemas response (RFC 7643 §7) - just the User core
 * schema with a single attribute. Tests exercising the `/Schemas`
 * surface don't need the full Entra preset; this is enough to assert
 * the page renders the top-level schema id and attribute name.
 */
export const FIXTURE_SCHEMAS = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 1,
  Resources: [
    {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      name: 'User',
      description: 'SCIM core User schema (test fixture)',
      attributes: [
        {
          name: 'userName',
          type: 'string',
          multiValued: false,
          required: true,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'server',
        },
      ],
      meta: { resourceType: 'Schema', location: '/scim/v2/Schemas/urn:...:User' },
    },
  ],
};
