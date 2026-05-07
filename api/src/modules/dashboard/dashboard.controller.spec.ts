/**
 * DashboardController - TDD spec (RED first).
 *
 * Tests the BFF endpoint GET /admin/dashboard that aggregates
 * stats, endpoints, activity, health, and version into one response.
 *
 * Phase B1 extends with GET /admin/endpoints/:id/overview - a per-endpoint
 * BFF that aggregates summary, stats, credentials, recent activity, and
 * config flags into a single round trip with zero DB queries.
 *
 * @see docs/DELIVERY_PLAN.md UI-B6
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S14
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase B1
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { StatsProjectionService } from '../stats/stats-projection.service';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { LoggingService } from '../logging/logging.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../domain/repositories/endpoint-credential.repository.interface';
import type { DashboardResponse, EndpointOverviewResponse } from '../../shared/types/dashboard.types';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockStatsService = {
  getGlobalStats: jest.fn().mockReturnValue({
    totalEndpoints: 2,
    totalUsers: 10,
    totalGroups: 3,
    totalGenericResources: 0,
  }),
  getEndpointStats: jest.fn().mockReturnValue({
    userCount: 5,
    activeUserCount: 4,
    groupCount: 2,
    activeGroupCount: 2,
    genericResourceCount: 0,
  }),
  getAllEndpointStats: jest.fn().mockReturnValue(new Map()),
};

const mockEndpointService = {
  listEndpoints: jest.fn().mockResolvedValue({
    totalResults: 2,
    endpoints: [
      {
        id: 'ep-1',
        name: 'prod-ep',
        displayName: 'Production',
        active: true,
        scimBasePath: '/scim/endpoints/ep-1/v2',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        _links: { self: '/admin/endpoints/ep-1', stats: '/admin/endpoints/ep-1/stats', credentials: '/admin/endpoints/ep-1/credentials', scim: '/scim/endpoints/ep-1/v2' },
      },
      {
        id: 'ep-2',
        name: 'dev-ep',
        active: true,
        scimBasePath: '/scim/endpoints/ep-2/v2',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
        _links: { self: '/admin/endpoints/ep-2', stats: '/admin/endpoints/ep-2/stats', credentials: '/admin/endpoints/ep-2/credentials', scim: '/scim/endpoints/ep-2/v2' },
      },
    ],
  }),
};

const mockLoggingService = {
  listLogs: jest.fn().mockResolvedValue({
    items: [
      {
        id: 'log-1',
        endpointId: 'ep-1',
        method: 'POST',
        url: '/scim/endpoints/ep-1/v2/Users',
        status: 201,
        durationMs: 42,
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
      {
        id: 'log-2',
        endpointId: 'ep-2',
        method: 'GET',
        url: '/scim/endpoints/ep-2/v2/Users',
        status: 200,
        durationMs: 15,
        createdAt: new Date('2026-05-01T09:00:00Z'),
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    count: 2,
    hasNext: false,
    hasPrev: false,
  }),
};

const mockCredentialRepo: jest.Mocked<Pick<IEndpointCredentialRepository, 'findByEndpoint'>> = {
  // Default: no credentials. Tests override per-case.
  findByEndpoint: jest.fn().mockResolvedValue([]),
};

// Extend EndpointService mock with getEndpoint (used by overview endpoint).
const mockEndpointWithGet = {
  ...mockEndpointService,
  getEndpoint: jest.fn(),
};

// ─── Test Suite ──────────────────────────────────────────────────────

describe('DashboardController', () => {
  let controller: DashboardController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: StatsProjectionService, useValue: mockStatsService },
        { provide: EndpointService, useValue: mockEndpointWithGet },
        { provide: LoggingService, useValue: mockLoggingService },
        { provide: ENDPOINT_CREDENTIAL_REPOSITORY, useValue: mockCredentialRepo },
      ],
    }).compile();

    controller = module.get(DashboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /admin/dashboard', () => {
    it('should return a DashboardResponse with all sections', async () => {
      const result: DashboardResponse = await controller.getDashboard();

      expect(result).toHaveProperty('health');
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('endpoints');
      expect(result).toHaveProperty('recentActivity');
      expect(result).toHaveProperty('version');
    });

    it('should return health with status ok and uptime', async () => {
      const result = await controller.getDashboard();

      expect(result.health.status).toBe('ok');
      expect(result.health.uptime).toBeGreaterThan(0);
      expect(result.health.dbType).toBe('postgresql');
    });

    it('should return global stats from StatsProjectionService (0 DB queries)', async () => {
      const result = await controller.getDashboard();

      expect(result.stats.totalEndpoints).toBe(2);
      expect(result.stats.totalUsers).toBe(10);
      expect(result.stats.totalGroups).toBe(3);
      expect(mockStatsService.getGlobalStats).toHaveBeenCalledTimes(1);
    });

    it('should return endpoint list with per-endpoint stats', async () => {
      const result = await controller.getDashboard();

      expect(result.endpoints).toHaveLength(2);
      expect(result.endpoints[0].id).toBe('ep-1');
      expect(result.endpoints[0].name).toBe('prod-ep');
      expect(result.endpoints[0].users).toBeDefined();
      expect(result.endpoints[0].users.total).toBe(5);
    });

    it('should return recent activity from LoggingService', async () => {
      const result = await controller.getDashboard();

      expect(result.recentActivity).toHaveLength(2);
      expect(result.recentActivity[0].method).toBe('POST');
      expect(result.recentActivity[0].statusCode).toBe(201);
      expect(result.recentActivity[0].endpointId).toBe('ep-1');
    });

    it('should return version info', async () => {
      const result = await controller.getDashboard();

      expect(result.version.version).toBeDefined();
      expect(result.version.node).toBe(process.version);
      expect(result.version.uptime).toBeGreaterThan(0);
    });

    it('should use inmemory dbType when PERSISTENCE_BACKEND is inmemory', async () => {
      const orig = process.env.PERSISTENCE_BACKEND;
      process.env.PERSISTENCE_BACKEND = 'inmemory';
      try {
        const result = await controller.getDashboard();
        expect(result.health.dbType).toBe('inmemory');
      } finally {
        if (orig) process.env.PERSISTENCE_BACKEND = orig;
        else delete process.env.PERSISTENCE_BACKEND;
      }
    });

    it('should handle empty endpoints list', async () => {
      mockEndpointService.listEndpoints.mockResolvedValueOnce({
        totalResults: 0,
        endpoints: [],
      });
      mockStatsService.getGlobalStats.mockReturnValueOnce({
        totalEndpoints: 0,
        totalUsers: 0,
        totalGroups: 0,
        totalGenericResources: 0,
      });

      const result = await controller.getDashboard();

      expect(result.endpoints).toHaveLength(0);
      expect(result.stats.totalEndpoints).toBe(0);
    });
  });

  // ─── Phase B1: Endpoint Overview BFF ────────────────────────────────

  describe('GET /admin/endpoints/:endpointId/overview (B1)', () => {
    const endpointId = 'ep-1';

    beforeEach(() => {
      // Default endpoint payload returned by EndpointService.getEndpoint.
      mockEndpointWithGet.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'prod-ep',
        displayName: 'Production',
        active: true,
        scimBasePath: '/scim/endpoints/ep-1/v2',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
        profile: {
          preset: 'entra-id',
          settings: {
            StrictSchemaValidation: true,
            UserSoftDeleteEnabled: false,
            BulkOperationsEnabled: true,
          },
        },
        _links: {
          self: '/admin/endpoints/ep-1',
          stats: '/admin/endpoints/ep-1/stats',
          credentials: '/admin/endpoints/ep-1/credentials',
          scim: '/scim/endpoints/ep-1/v2',
        },
      });
      mockStatsService.getEndpointStats.mockReturnValue({
        userCount: 500,
        activeUserCount: 480,
        groupCount: 12,
        activeGroupCount: 11,
        genericResourceCount: 0,
      });
      mockCredentialRepo.findByEndpoint.mockResolvedValue([]);
    });

    it('returns the canonical overview shape (key allowlist)', async () => {
      const result: EndpointOverviewResponse = await controller.getEndpointOverview(endpointId);

      // Top-level keys lock - never add an undocumented key without
      // updating the test, the response contract doc, and the frontend
      // hook's TypeScript shape.
      expect(Object.keys(result).sort()).toEqual(
        ['configFlags', 'credentials', 'endpoint', 'recentActivity', 'stats'].sort(),
      );
      expect(Object.keys(result.endpoint).sort()).toEqual(
        ['active', 'createdAt', 'displayName', 'id', 'name', 'preset', 'scimBasePath'].sort(),
      );
      expect(Object.keys(result.stats).sort()).toEqual(
        ['activeGroupCount', 'activeUserCount', 'genericResourceCount', 'groupCount', 'userCount'].sort(),
      );
    });

    it('reads stats from StatsProjectionService (zero DB queries)', async () => {
      const result = await controller.getEndpointOverview(endpointId);

      expect(mockStatsService.getEndpointStats).toHaveBeenCalledWith(endpointId);
      expect(result.stats.userCount).toBe(500);
      expect(result.stats.activeUserCount).toBe(480);
      expect(result.stats.groupCount).toBe(12);
    });

    it('extracts preset from endpoint profile', async () => {
      const result = await controller.getEndpointOverview(endpointId);
      expect(result.endpoint.preset).toBe('entra-id');
    });

    it('returns empty credentials array when none exist', async () => {
      const result = await controller.getEndpointOverview(endpointId);
      expect(result.credentials).toEqual([]);
    });

    it('returns credentials WITHOUT exposing the credential hash', async () => {
      mockCredentialRepo.findByEndpoint.mockResolvedValueOnce([
        {
          id: 'cred-1',
          endpointId,
          credentialType: 'bearer',
          label: 'Entra',
          active: true,
          createdAt: new Date('2026-02-01T00:00:00Z'),
          expiresAt: null,
          // Hash MUST never appear in the response - the test guard catches
          // a regression where we accidentally pass-through the full row.
          credentialHash: 'super-secret-bcrypt-hash-do-not-leak',
        } as any,
      ]);

      const result = await controller.getEndpointOverview(endpointId);

      expect(result.credentials).toHaveLength(1);
      const cred = result.credentials[0];
      expect(cred.id).toBe('cred-1');
      expect(cred.credentialType).toBe('bearer');
      expect(cred.label).toBe('Entra');
      expect(cred.active).toBe(true);
      // Critical: hash is stripped from the projection.
      expect((cred as unknown as Record<string, unknown>).credentialHash).toBeUndefined();
    });

    it('returns recent activity scoped to the endpoint (last 10)', async () => {
      mockLoggingService.listLogs.mockResolvedValueOnce({
        items: Array.from({ length: 12 }, (_, i) => ({
          id: `log-${i}`,
          endpointId,
          method: 'GET',
          url: '/scim/endpoints/ep-1/v2/Users',
          status: 200,
          durationMs: 5,
          createdAt: new Date(`2026-05-01T${String(10 + i).padStart(2, '0')}:00:00Z`),
        })),
        total: 12,
        page: 1,
        pageSize: 10,
        count: 10,
        hasNext: true,
        hasPrev: false,
      });

      const result = await controller.getEndpointOverview(endpointId);

      // Capped at 10 entries even when the upstream returns more.
      expect(result.recentActivity.length).toBeLessThanOrEqual(10);
      expect(result.recentActivity[0]).toHaveProperty('timestamp');
      expect(result.recentActivity[0]).toHaveProperty('method');
      // listLogs invoked with endpointId filter (not global) so we don't
      // ship cross-endpoint activity.
      expect(mockLoggingService.listLogs).toHaveBeenCalledWith(
        expect.objectContaining({ endpointId, pageSize: 10 }),
      );
    });

    it('returns config flags from profile.settings (all non-undefined)', async () => {
      const result = await controller.getEndpointOverview(endpointId);

      expect(result.configFlags).toEqual({
        StrictSchemaValidation: true,
        UserSoftDeleteEnabled: false,
        BulkOperationsEnabled: true,
      });
    });

    it('throws NotFoundException when the endpoint is unknown', async () => {
      mockEndpointWithGet.getEndpoint.mockRejectedValueOnce(
        new NotFoundException('Endpoint "missing" not found'),
      );

      await expect(controller.getEndpointOverview('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('handles endpoint with no profile.settings (configFlags = {})', async () => {
      mockEndpointWithGet.getEndpoint.mockResolvedValueOnce({
        id: endpointId,
        name: 'minimal-ep',
        active: true,
        scimBasePath: '/scim/endpoints/ep-1/v2',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        profile: { preset: 'minimal' },
        _links: {
          self: '/admin/endpoints/ep-1',
          stats: '/admin/endpoints/ep-1/stats',
          credentials: '/admin/endpoints/ep-1/credentials',
          scim: '/scim/endpoints/ep-1/v2',
        },
      });

      const result = await controller.getEndpointOverview(endpointId);
      expect(result.configFlags).toEqual({});
      expect(result.endpoint.preset).toBe('minimal');
    });
  });
});
