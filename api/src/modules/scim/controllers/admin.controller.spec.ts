import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { LoggingService } from '../../logging/logging.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';
import { EndpointScimGroupsService } from '../services/endpoint-scim-groups.service';

describe('AdminController', () => {
  let controller: AdminController;
  let mockLoggingService: Record<string, jest.Mock>;
  let mockPrisma: {
    endpoint: Record<string, jest.Mock>;
    scimResource: Record<string, jest.Mock>;
  };
  let mockUsersService: Record<string, jest.Mock>;
  let mockGroupsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockLoggingService = {
      clearLogs: jest.fn().mockResolvedValue(undefined),
      listLogs: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getLog: jest.fn(),
      pruneOldLogs: jest.fn().mockResolvedValue(5),
    };

    mockPrisma = {
      endpoint: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ep-1', name: 'default' }),
        create: jest.fn().mockResolvedValue({ id: 'ep-new', name: 'default' }),
      },
      scimResource: {
        findFirst: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };

    mockUsersService = {
      createUserForEndpoint: jest.fn().mockResolvedValue({ id: 'u1', userName: 'test' }),
    };

    mockGroupsService = {
      createGroupForEndpoint: jest.fn().mockResolvedValue({ id: 'g1', displayName: 'grp' }),
    };

    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: LoggingService, useValue: mockLoggingService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EndpointScimUsersService, useValue: mockUsersService },
        { provide: EndpointScimGroupsService, useValue: mockGroupsService },
      ],
    }).compile();

    controller = module.get(AdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── clearLogs ──────────────────────────────────────────────────────
  describe('clearLogs', () => {
    it('should delegate to LoggingService.clearLogs', async () => {
      await controller.clearLogs();
      expect(mockLoggingService.clearLogs).toHaveBeenCalledTimes(1);
    });
  });

  // ── listLogs ───────────────────────────────────────────────────────
  describe('listLogs', () => {
    it('should pass parsed query params to LoggingService.listLogs', async () => {
      await controller.listLogs('2', '50', 'POST', '200', 'true', '/scim', undefined, undefined, undefined, undefined, undefined);
      expect(mockLoggingService.listLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          pageSize: 50,
          method: 'POST',
          status: 200,
          hasError: true,
          urlContains: '/scim',
        }),
      );
    });

    it('should handle undefined query params gracefully', async () => {
      await controller.listLogs();
      expect(mockLoggingService.listLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          page: undefined,
          pageSize: undefined,
          method: undefined,
          status: undefined,
        }),
      );
    });

    it('should pass minDurationMs filter to LoggingService (Step 4.1)', async () => {
      await controller.listLogs(
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, '5000',
      );
      expect(mockLoggingService.listLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          minDurationMs: 5000,
        }),
      );
    });
  });

  // ── getLog ─────────────────────────────────────────────────────────
  describe('getLog', () => {
    it('should return a log by id', async () => {
      const log = { id: 'log-1', method: 'GET' };
      mockLoggingService.getLog.mockResolvedValue(log);
      const result = await controller.getLog('log-1');
      expect(result).toBe(log);
    });

    it('should throw NotFoundException when log not found', async () => {
      mockLoggingService.getLog.mockResolvedValue(null);
      await expect(controller.getLog('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteUser ─────────────────────────────────────────────────────
  describe('deleteUser', () => {
    it('should delete user by Prisma id or scimId', async () => {
      mockPrisma.scimResource.findFirst.mockResolvedValue({ id: 'pk-1' });
      await controller.deleteUser('pk-1');
      expect(mockPrisma.scimResource.delete).toHaveBeenCalledWith({ where: { id: 'pk-1' } });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.scimResource.findFirst.mockResolvedValue(null);
      await expect(controller.deleteUser('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── createManualUser ───────────────────────────────────────────────
  describe('createManualUser', () => {
    const mockRequest = {
      protocol: 'https',
      get: (h: string) => (h === 'host' ? 'example.com' : undefined),
      headers: {},
    } as any;

    it('should create a user with minimal fields', async () => {
      await controller.createManualUser({ userName: 'alice' }, mockRequest);
      expect(mockUsersService.createUserForEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ userName: 'alice', active: true }),
        expect.any(String),
        'ep-1',
      );
    });

    it('should include optional fields when provided', async () => {
      await controller.createManualUser(
        {
          userName: 'bob',
          displayName: 'Bob Smith',
          email: 'bob@test.com',
          givenName: 'Bob',
          familyName: 'Smith',
          department: 'Eng',
          active: false,
        },
        mockRequest,
      );
      const payload = mockUsersService.createUserForEndpoint.mock.calls[0][0];
      expect(payload.displayName).toBe('Bob Smith');
      expect(payload.emails).toEqual([{ value: 'bob@test.com', type: 'work', primary: true }]);
      expect(payload.active).toBe(false);
    });
  });

  // ── createManualGroup ──────────────────────────────────────────────
  describe('createManualGroup', () => {
    const mockRequest = {
      protocol: 'https',
      get: (h: string) => (h === 'host' ? 'example.com' : undefined),
      headers: {},
    } as any;

    it('should create a group with displayName', async () => {
      await controller.createManualGroup({ displayName: 'Admins' }, mockRequest);
      expect(mockGroupsService.createGroupForEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Admins' }),
        expect.any(String),
        'ep-1',
      );
    });

    it('should include members when memberIds provided', async () => {
      await controller.createManualGroup(
        { displayName: 'Team', memberIds: ['u1', 'u2'] },
        mockRequest,
      );
      const payload = mockGroupsService.createGroupForEndpoint.mock.calls[0][0];
      expect(payload.members).toEqual([{ value: 'u1' }, { value: 'u2' }]);
    });
  });

  // ── getVersion ─────────────────────────────────────────────────────
  describe('getVersion', () => {
    it('should return version info with required structure', () => {
      const result = controller.getVersion();
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('service');
      expect(result).toHaveProperty('runtime');
      expect(result).toHaveProperty('auth');
      expect(result).toHaveProperty('storage');
    });

    it('should include service metadata', () => {
      const result = controller.getVersion();
      expect(result.service.name).toBe('SCIMServer API');
      expect(result.service.scimBasePath).toContain('/v2');
      expect(result.service.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.service.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof result.service.uptimeSeconds).toBe('number');
    });

    it('should include runtime metadata', () => {
      const result = controller.getVersion();
      expect(result.runtime.node).toMatch(/^v\d+/);
      expect(result.runtime.platform).toBe(process.platform);
      expect(result.runtime.arch).toBe(process.arch);
      expect(result.runtime.pid).toBe(process.pid);
      expect(typeof result.runtime.cpus).toBe('number');
    });

    it('should report auth configuration status', () => {
      const result = controller.getVersion();
      expect(typeof result.auth.oauthClientSecretConfigured).toBe('boolean');
      expect(typeof result.auth.jwtSecretConfigured).toBe('boolean');
      expect(typeof result.auth.scimSharedSecretConfigured).toBe('boolean');
    });

    it('should mask sensitive portions of DATABASE_URL', () => {
      const orig = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://admin:s3cret@host:5432/db';
      try {
        const result = controller.getVersion();
        expect(result.storage.databaseUrl).not.toContain('s3cret');
        expect(result.storage.databaseUrl).toContain('***');
      } finally {
        if (orig) process.env.DATABASE_URL = orig;
        else delete process.env.DATABASE_URL;
      }
    });

    it('should use APP_VERSION env when available', () => {
      const orig = process.env.APP_VERSION;
      process.env.APP_VERSION = '99.0.0';
      try {
        const result = controller.getVersion();
        expect(result.version).toBe('99.0.0');
      } finally {
        if (orig) process.env.APP_VERSION = orig;
        else delete process.env.APP_VERSION;
      }
    });
  });

  describe('pruneLogs (Step 4.4)', () => {
    it('should call loggingService.pruneOldLogs with retention days', async () => {
      const result = await controller.pruneLogs('30');
      expect(mockLoggingService.pruneOldLogs).toHaveBeenCalledWith(30);
      expect(result).toEqual({ pruned: 5 });
    });

    it('should default to LOG_RETENTION_DAYS env or 30 when no param', async () => {
      await controller.pruneLogs();
      expect(mockLoggingService.pruneOldLogs).toHaveBeenCalledWith(30);
    });
  });
});
