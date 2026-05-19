/**
 * UI-B1: Shared type contract compilation tests.
 *
 * These tests verify that the shared type contracts in @scim/types
 * are structurally sound and match the expected API response shapes.
 * They act as compile-time guards - if a type changes in a way that
 * breaks consumers, these tests fail at build time.
 */
import type {
  ResourceStats,
  EndpointStatsResponse,
  SchemaSummary,
  ResourceTypeSummary,
  ServiceProviderConfigSummary,
  ProfileSummary,
  EndpointLinks,
  EndpointResponse,
  EndpointListResponse,
  VersionInfo,
  HealthResponse,
  DashboardHealth,
  DashboardEndpoint,
  DashboardActivity,
  DashboardResponse,
  PresetSummary,
  PresetListResponse,
} from './index';

describe('Shared Type Contracts (@scim/types)', () => {
  // These tests verify structural compatibility at compile time.
  // If a type is changed in a breaking way, TypeScript will fail to compile this file.

  describe('ResourceStats', () => {
    it('should have total, active, inactive fields', () => {
      const stats: ResourceStats = { total: 100, active: 95, inactive: 5 };
      expect(stats.total).toBe(100);
      expect(stats.active).toBe(95);
      expect(stats.inactive).toBe(5);
    });
  });

  describe('EndpointStatsResponse', () => {
    it('should contain users, groups, groupMembers, requestLogs', () => {
      const response: EndpointStatsResponse = {
        users: { total: 10, active: 8, inactive: 2 },
        groups: { total: 3, active: 3, inactive: 0 },
        groupMembers: { total: 15 },
        requestLogs: { total: 500 },
      };
      expect(response.users.total).toBe(10);
      expect(response.groupMembers.total).toBe(15);
    });
  });

  describe('ProfileSummary', () => {
    it('should contain schema and resource type summaries', () => {
      const summary: ProfileSummary = {
        schemaCount: 3,
        schemas: [{ id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributeCount: 21 }],
        resourceTypeCount: 2,
        resourceTypes: [{ name: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', extensions: [], extensionCount: 0 }],
        serviceProviderConfig: { patch: true, bulk: true, filter: true, changePassword: false, sort: true, etag: true },
        activeSettings: { StrictSchemaValidation: true },
      };
      expect(summary.schemaCount).toBe(3);
      expect(summary.schemas[0].name).toBe('User');
      expect(summary.serviceProviderConfig.patch).toBe(true);
    });
  });

  describe('EndpointResponse', () => {
    it('should support summary view (profileSummary, no profile)', () => {
      const ep: EndpointResponse = {
        id: 'uuid-1',
        name: 'test-ep',
        active: true,
        scimBasePath: '/scim/endpoints/uuid-1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        profileSummary: {
          schemaCount: 2,
          schemas: [],
          resourceTypeCount: 1,
          resourceTypes: [],
          serviceProviderConfig: { patch: true, bulk: false, filter: true, changePassword: false, sort: false, etag: true },
          activeSettings: {},
        },
        _links: { self: '/admin/endpoints/uuid-1', stats: '/admin/endpoints/uuid-1/stats', credentials: '/admin/endpoints/uuid-1/credentials', scim: '/scim/endpoints/uuid-1' },
      };
      expect(ep.profileSummary).toBeDefined();
      expect(ep.profile).toBeUndefined();
    });

    it('should support full view (profile, no profileSummary)', () => {
      const ep: EndpointResponse = {
        id: 'uuid-2',
        name: 'full-ep',
        active: true,
        scimBasePath: '/scim/endpoints/uuid-2',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        profile: { schemas: [], resourceTypes: [], serviceProviderConfig: {}, settings: {} },
        _links: { self: '/admin/endpoints/uuid-2', stats: '/admin/endpoints/uuid-2/stats', credentials: '/admin/endpoints/uuid-2/credentials', scim: '/scim/endpoints/uuid-2' },
      };
      expect(ep.profile).toBeDefined();
      expect(ep.profileSummary).toBeUndefined();
    });
  });

  describe('EndpointListResponse', () => {
    it('should have totalResults and endpoints array', () => {
      const list: EndpointListResponse = { totalResults: 0, endpoints: [] };
      expect(list.totalResults).toBe(0);
      expect(list.endpoints).toEqual([]);
    });
  });

  describe('HealthResponse', () => {
    it('should have status, uptime, timestamp', () => {
      const health: HealthResponse = { status: 'ok', uptime: 3600, timestamp: '2026-05-04T00:00:00Z' };
      expect(health.status).toBe('ok');
    });
  });

  describe('DashboardResponse', () => {
    it('should contain all aggregated sections', () => {
      const dashboard: DashboardResponse = {
        health: { status: 'ok', uptime: 86400, dbType: 'postgresql' },
        stats: { totalEndpoints: 5, totalUsers: 847, totalGroups: 23 },
        endpoints: [],
        recentActivity: [],
        requestsLast24hSeries: new Array(24).fill(0),
        version: { version: '0.40.2', node: '24.0.0', uptime: 86400 },
      };
      expect(dashboard.health.status).toBe('ok');
      expect(dashboard.stats.totalUsers).toBe(847);
      expect(dashboard.version.version).toBe('0.40.2');
      expect(dashboard.requestsLast24hSeries).toHaveLength(24);
    });

    it('should support endpoint cards with stats', () => {
      const card: DashboardEndpoint = {
        id: 'ep-1',
        name: 'production',
        displayName: 'Production Endpoint',
        active: true,
        users: { total: 100, active: 95, inactive: 5 },
        groups: { total: 10, active: 10, inactive: 0 },
        createdAt: '2026-01-01T00:00:00Z',
        _links: { self: '/admin/endpoints/ep-1', stats: '/admin/endpoints/ep-1/stats', credentials: '/admin/endpoints/ep-1/credentials', scim: '/scim/endpoints/ep-1' },
      };
      expect(card.users.total).toBe(100);
    });

    it('should support activity feed entries', () => {
      const activity: DashboardActivity = {
        id: 'log-1',
        timestamp: '2026-05-04T12:00:00Z',
        method: 'POST',
        path: '/scim/endpoints/ep-1/Users',
        statusCode: 201,
        durationMs: 42,
        endpointId: 'ep-1',
        endpointName: 'production',
      };
      expect(activity.method).toBe('POST');
      expect(activity.statusCode).toBe(201);
    });
  });

  describe('PresetListResponse', () => {
    it('should have totalResults and presets array', () => {
      const presets: PresetListResponse = {
        totalResults: 5,
        presets: [{
          name: 'entra-id',
          displayName: 'Entra ID',
          isDefault: true,
          schemaCount: 7,
          serviceProviderConfig: { patch: true, bulk: true, filter: true, changePassword: false, sort: true, etag: true },
        }],
      };
      expect(presets.totalResults).toBe(5);
      expect(presets.presets[0].isDefault).toBe(true);
    });
  });

  describe('VersionInfo', () => {
    it('should contain service, runtime, auth, storage sections', () => {
      const version: VersionInfo = {
        version: '0.40.2',
        service: {
          name: 'SCIMServer API',
          environment: 'production',
          apiPrefix: 'scim',
          scimBasePath: '/scim/v2',
          now: '2026-05-04T00:00:00Z',
          startedAt: '2026-05-04T00:00:00Z',
          uptimeSeconds: 86400,
          timezone: 'UTC',
          utcOffset: '+00:00',
        },
        runtime: {
          node: '24.0.0',
          platform: 'linux',
          arch: 'x64',
          pid: 1,
          hostname: 'scimserver',
          cpus: 2,
          containerized: true,
          memory: { rss: 100000000, heapTotal: 50000000, heapUsed: 30000000, external: 1000000, arrayBuffers: 500000 },
        },
        auth: {
          oauthClientSecretConfigured: true,
          jwtSecretConfigured: true,
          scimSharedSecretConfigured: true,
        },
        storage: {
          databaseProvider: 'postgresql',
          persistenceBackend: 'prisma',
        },
      };
      expect(version.version).toBe('0.40.2');
      expect(version.runtime.containerized).toBe(true);
      expect(version.storage.persistenceBackend).toBe('prisma');
    });
  });
});
