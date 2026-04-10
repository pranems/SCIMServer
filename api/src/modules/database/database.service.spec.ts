/**
 * DatabaseService Unit Tests
 *
 * Tests the admin-facing database query service used by the web UI.
 * All methods query the unified scimResource/resourceMember models (Phase 2/3).
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from './database.service';
import { PrismaService } from '../prisma/prisma.service';
import { USER_REPOSITORY, GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { LoggingService } from '../logging/logging.service';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let prisma: {
    scimResource: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
    };
    requestLog: {
      count: jest.Mock;
    };
  };

  const mockUserRepo = { findAll: jest.fn().mockResolvedValue([]), findByScimId: jest.fn() };
  const mockGroupRepo = { findAllWithMembers: jest.fn().mockResolvedValue([]), findWithMembers: jest.fn() };

  beforeEach(async () => {
    prisma = {
      scimResource: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      requestLog: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: PrismaService, useValue: prisma },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: GROUP_REPOSITORY, useValue: mockGroupRepo },
        { provide: EndpointService, useValue: { listEndpoints: jest.fn().mockResolvedValue({ endpoints: [] }) } },
        { provide: LoggingService, useValue: { listLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }) } },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
  });

  // ── getUsers ───────────────────────────────────────────────────────────────

  describe('getUsers', () => {
    it('should query scimResource with resourceType "User"', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getUsers({ page: 1, limit: 10 });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: 'User' }),
        }),
      );
    });

    it('should calculate skip from page and limit', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getUsers({ page: 3, limit: 10 });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });

    it('should add search filter across userName, scimId, externalId', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getUsers({ page: 1, limit: 10, search: 'test' });

      const call = prisma.scimResource.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userName: expect.objectContaining({ contains: 'test' }) }),
          expect.objectContaining({ scimId: expect.objectContaining({ contains: 'test' }) }),
          expect.objectContaining({ externalId: expect.objectContaining({ contains: 'test' }) }),
        ]),
      );
    });

    it('should filter by active status when provided', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getUsers({ page: 1, limit: 10, active: true });

      const call = prisma.scimResource.findMany.mock.calls[0][0];
      expect(call.where.active).toBe(true);
    });

    it('should select membersAsMember relations', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getUsers({ page: 1, limit: 10 });

      const call = prisma.scimResource.findMany.mock.calls[0][0];
      expect(call.select.membersAsMember).toBeDefined();
    });

    it('should return pagination metadata', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(25);

      const result = await service.getUsers({ page: 2, limit: 10 });

      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        pages: 3,
      });
    });

    it('should parse JSONB payload object', async () => {
      prisma.scimResource.findMany.mockResolvedValue([
        {
          id: 'u1',
          userName: 'alice',
          scimId: 'scim-1',
          externalId: null,
          active: true,
          payload: { displayName: 'Alice Smith', emails: [{ value: 'a@test.com' }] },
          createdAt: new Date(),
          updatedAt: new Date(),
          membersAsMember: [],
        },
      ]);
      prisma.scimResource.count.mockResolvedValue(1);

      const result = await service.getUsers({ page: 1, limit: 10 });

      expect(result.users[0]).toEqual(
        expect.objectContaining({
          displayName: 'Alice Smith',
          groups: [],
        }),
      );
    });
  });

  // ── getGroups ──────────────────────────────────────────────────────────────

  describe('getGroups', () => {
    it('should query scimResource with resourceType "Group"', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getGroups({ page: 1, limit: 10 });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: 'Group' }),
        }),
      );
    });

    it('should add search filter on displayName', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getGroups({ page: 1, limit: 10, search: 'eng' });

      const call = prisma.scimResource.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ displayName: expect.objectContaining({ contains: 'eng' }) }),
        ]),
      );
    });

    it('should select _count for membersAsGroup', async () => {
      prisma.scimResource.findMany.mockResolvedValue([]);
      prisma.scimResource.count.mockResolvedValue(0);

      await service.getGroups({ page: 1, limit: 10 });

      const call = prisma.scimResource.findMany.mock.calls[0][0];
      expect(call.select._count).toBeDefined();
    });

    it('should map memberCount from _count.membersAsGroup', async () => {
      prisma.scimResource.findMany.mockResolvedValue([
        {
          id: 'g1',
          displayName: 'Engineering',
          payload: { displayName: 'Engineering' },
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { membersAsGroup: 5 },
        },
      ]);
      prisma.scimResource.count.mockResolvedValue(1);

      const result = await service.getGroups({ page: 1, limit: 10 });

      expect(result.groups[0].memberCount).toBe(5);
    });
  });

  // ── getUserDetails ─────────────────────────────────────────────────────────

  describe('getUserDetails', () => {
    it('should query by id with resourceType "User"', async () => {
      prisma.scimResource.findFirst.mockResolvedValue({
        id: 'u1',
        userName: 'alice',
        resourceType: 'User',
        membersAsMember: [],
      });

      await service.getUserDetails('u1');

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1', resourceType: 'User' },
        }),
      );
    });

    it('should throw when user not found', async () => {
      prisma.scimResource.findFirst.mockResolvedValue(null);

      await expect(service.getUserDetails('nonexistent')).rejects.toThrow('User not found');
    });

    it('should include membersAsMember with group details', async () => {
      prisma.scimResource.findFirst.mockResolvedValue({
        id: 'u1',
        userName: 'alice',
        resourceType: 'User',
        membersAsMember: [
          { group: { id: 'g1', displayName: 'Engineering' } },
        ],
      });

      const result = await service.getUserDetails('u1');

      expect(result.groups).toEqual([{ id: 'g1', displayName: 'Engineering' }]);
    });
  });

  // ── getGroupDetails ────────────────────────────────────────────────────────

  describe('getGroupDetails', () => {
    it('should query by id with resourceType "Group"', async () => {
      prisma.scimResource.findFirst.mockResolvedValue({
        id: 'g1',
        displayName: 'Engineering',
        resourceType: 'Group',
        membersAsGroup: [],
      });

      await service.getGroupDetails('g1');

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'g1', resourceType: 'Group' },
        }),
      );
    });

    it('should throw when group not found', async () => {
      prisma.scimResource.findFirst.mockResolvedValue(null);

      await expect(service.getGroupDetails('nonexistent')).rejects.toThrow('Group not found');
    });

    it('should include membersAsGroup with member details', async () => {
      prisma.scimResource.findFirst.mockResolvedValue({
        id: 'g1',
        displayName: 'Engineering',
        resourceType: 'Group',
        membersAsGroup: [
          { member: { id: 'u1', userName: 'alice', active: true } },
        ],
      });

      const result = await service.getGroupDetails('g1');

      expect(result.members).toEqual([{ id: 'u1', userName: 'alice', active: true }]);
    });
  });

  // ── getStatistics ──────────────────────────────────────────────────────────

  describe('getStatistics', () => {
    it('should count users by resourceType "User"', async () => {
      prisma.scimResource.count.mockResolvedValue(0);
      prisma.requestLog.count.mockResolvedValue(0);

      await service.getStatistics();

      expect(prisma.scimResource.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resourceType: 'User' } }),
      );
    });

    it('should count active users', async () => {
      prisma.scimResource.count.mockResolvedValue(0);
      prisma.requestLog.count.mockResolvedValue(0);

      await service.getStatistics();

      expect(prisma.scimResource.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resourceType: 'User', active: true },
        }),
      );
    });

    it('should count groups by resourceType "Group"', async () => {
      prisma.scimResource.count.mockResolvedValue(0);
      prisma.requestLog.count.mockResolvedValue(0);

      await service.getStatistics();

      expect(prisma.scimResource.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resourceType: 'Group' } }),
      );
    });

    it('should return correct statistics structure', async () => {
      // Mock returns: totalUsers=10, activeUsers=8, totalGroups=3, totalLogs=100, recentActivity=20
      prisma.scimResource.count
        .mockResolvedValueOnce(10)  // totalUsers
        .mockResolvedValueOnce(8)   // activeUsers
        .mockResolvedValueOnce(3);  // totalGroups
      prisma.requestLog.count
        .mockResolvedValueOnce(100) // totalLogs
        .mockResolvedValueOnce(20); // recentActivity

      const result = await service.getStatistics();

      expect(result).toEqual({
        users: { total: 10, active: 8, inactive: 2 },
        groups: { total: 3 },
        activity: { totalRequests: 100, last24Hours: 20 },
      });
    });
  });

  // ── InMemory fallback paths ───────────────────────────────────────────────

  describe('InMemory backend fallback', () => {
    let inmemService: DatabaseService;
    let inmemUserRepo: { findAll: jest.Mock; findByScimId: jest.Mock };
    let inmemGroupRepo: { findAllWithMembers: jest.Mock; findWithMembers: jest.Mock };
    let inmemEndpointService: { listEndpoints: jest.Mock };

    beforeEach(async () => {
      const savedEnv = process.env.PERSISTENCE_BACKEND;
      process.env.PERSISTENCE_BACKEND = 'inmemory';

      inmemUserRepo = {
        findAll: jest.fn().mockResolvedValue([
          { scimId: 'u1', userName: 'alice', active: true, rawPayload: '{}', createdAt: new Date() },
          { scimId: 'u2', userName: 'bob', active: false, rawPayload: '{}', createdAt: new Date() },
        ]),
        findByScimId: jest.fn(),
      };
      inmemGroupRepo = {
        findAllWithMembers: jest.fn().mockResolvedValue([
          { scimId: 'g1', displayName: 'Group1', rawPayload: '{}', members: [], createdAt: new Date() },
        ]),
        findWithMembers: jest.fn(),
      };
      inmemEndpointService = {
        listEndpoints: jest.fn().mockResolvedValue({ endpoints: [{ id: 'ep-1' }] }),
      };

      const module = await Test.createTestingModule({
        providers: [
          DatabaseService,
          { provide: PrismaService, useValue: prisma },
          { provide: USER_REPOSITORY, useValue: inmemUserRepo },
          { provide: GROUP_REPOSITORY, useValue: inmemGroupRepo },
          { provide: EndpointService, useValue: inmemEndpointService },
          { provide: LoggingService, useValue: { listLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }) } },
        ],
      }).compile();

      inmemService = module.get<DatabaseService>(DatabaseService);
      process.env.PERSISTENCE_BACKEND = savedEnv;
    });

    it('should use userRepo.findAll for getUsers in inmemory mode', async () => {
      const result = await inmemService.getUsers({ page: 1, limit: 10 });
      expect(inmemUserRepo.findAll).toHaveBeenCalledWith('ep-1');
      expect(result.users).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      // Prisma should NOT be called
      expect(prisma.scimResource.findMany).not.toHaveBeenCalled();
    });

    it('should use groupRepo.findAllWithMembers for getGroups in inmemory mode', async () => {
      const result = await inmemService.getGroups({ page: 1, limit: 10 });
      expect(inmemGroupRepo.findAllWithMembers).toHaveBeenCalledWith('ep-1');
      expect(result.groups).toHaveLength(1);
      expect(prisma.scimResource.findMany).not.toHaveBeenCalled();
    });

    it('should return counts from repos for getStatistics in inmemory mode', async () => {
      const result = await inmemService.getStatistics();
      expect(result.users.total).toBe(2);
      expect(result.users.active).toBe(1);
      expect(result.users.inactive).toBe(1);
      expect(result.groups.total).toBe(1);
      expect(result.activity).toEqual({ totalRequests: 0, last24Hours: 0 });
    });

    it('should filter users by search term in inmemory mode', async () => {
      const result = await inmemService.getUsers({ page: 1, limit: 10, search: 'alice' });
      expect(result.users).toHaveLength(1);
    });

    it('should filter users by active status in inmemory mode', async () => {
      const result = await inmemService.getUsers({ page: 1, limit: 10, active: false });
      expect(result.users).toHaveLength(1);
    });
  });
});
