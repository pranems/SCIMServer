/**
 * DashboardController - TDD spec (RED first).
 *
 * Tests the BFF endpoint GET /admin/dashboard that aggregates
 * stats, endpoints, activity, health, and version into one response.
 *
 * @see docs/DELIVERY_PLAN.md UI-B6
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S14
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { StatsProjectionService } from '../stats/stats-projection.service';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { LoggingService } from '../logging/logging.service';
import type { DashboardResponse } from '../../shared/types/dashboard.types';

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

// ─── Test Suite ──────────────────────────────────────────────────────

describe('DashboardController', () => {
  let controller: DashboardController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: StatsProjectionService, useValue: mockStatsService },
        { provide: EndpointService, useValue: mockEndpointService },
        { provide: LoggingService, useValue: mockLoggingService },
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
});
