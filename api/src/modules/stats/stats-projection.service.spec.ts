/**
 * StatsProjectionService - TDD spec (RED phase first).
 *
 * Tests written BEFORE implementation per DELIVERY_PLAN.md S7 TDD rules.
 * 20 tests covering: init seeding, event-driven counter updates,
 * reconciliation, edge cases, global aggregation.
 *
 * @see docs/DELIVERY_PLAN.md UI-B2
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S6.2
 */
import { Test, TestingModule } from '@nestjs/testing';
import { StatsProjectionService } from './stats-projection.service';
import { EndpointService } from '../endpoint/services/endpoint.service';
import {
  SCIM_EVENTS,
  type EndpointStatsSnapshot,
  type GlobalStatsSnapshot,
} from './scim-events';
import { USER_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { GENERIC_RESOURCE_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../domain/repositories/group.repository.interface';
import type { IGenericResourceRepository } from '../../domain/repositories/generic-resource.repository.interface';
import type { UserRecord } from '../../domain/models/user.model';
import type { GroupWithMembers } from '../../domain/models/group.model';
import type { GenericResourceRecord } from '../../domain/models/generic-resource.model';

// ---- Helpers: mock record factories --------------------------------------

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'internal-1',
    endpointId: 'ep-1',
    scimId: 'scim-u-1',
    externalId: null,
    userName: 'alice',
    displayName: 'Alice',
    active: true,
    rawPayload: '{}',
    version: 1,
    meta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupWithMembers> = {}): GroupWithMembers {
  return {
    id: 'internal-g-1',
    endpointId: 'ep-1',
    scimId: 'scim-g-1',
    externalId: null,
    displayName: 'Engineering',
    active: true,
    rawPayload: '{}',
    version: 1,
    meta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    ...overrides,
  };
}

function makeGenericResource(
  overrides: Partial<GenericResourceRecord> = {},
): GenericResourceRecord {
  return {
    id: 'internal-r-1',
    endpointId: 'ep-1',
    resourceType: 'Device',
    scimId: 'scim-r-1',
    externalId: null,
    displayName: null,
    active: true,
    rawPayload: '{}',
    version: 1,
    meta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---- Mock endpoint service -----------------------------------------------

const mockEndpointService = {
  listEndpoints: jest.fn().mockResolvedValue({
    totalResults: 0,
    endpoints: [],
  }),
};

// ---- Test suite ----------------------------------------------------------

describe('StatsProjectionService', () => {
  let service: StatsProjectionService;
  let userRepo: jest.Mocked<IUserRepository>;
  let groupRepo: jest.Mocked<IGroupRepository>;
  let genericRepo: jest.Mocked<IGenericResourceRepository>;

  beforeEach(async () => {
    userRepo = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findByScimId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findConflict: jest.fn(),
      findByScimIds: jest.fn(),
    } as any;

    groupRepo = {
      findAllWithMembers: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findByScimId: jest.fn(),
      findWithMembers: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByDisplayName: jest.fn(),
      findByExternalId: jest.fn(),
      addMembers: jest.fn(),
      updateGroupWithMembers: jest.fn(),
    } as any;

    genericRepo = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findByScimId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByExternalId: jest.fn(),
    } as any;

    mockEndpointService.listEndpoints.mockResolvedValue({
      totalResults: 0,
      endpoints: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsProjectionService,
        { provide: USER_REPOSITORY, useValue: userRepo },
        { provide: GROUP_REPOSITORY, useValue: groupRepo },
        { provide: GENERIC_RESOURCE_REPOSITORY, useValue: genericRepo },
        { provide: EndpointService, useValue: mockEndpointService },
      ],
    }).compile();

    service = module.get(StatsProjectionService);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 1. Initialization / Seeding
  // ───────────────────────────────────────────────────────────────────────

  describe('onModuleInit - seeding from repositories', () => {
    it('should seed zero counts when no endpoints exist', async () => {
      await service.onModuleInit();

      const global = service.getGlobalStats();
      expect(global.totalEndpoints).toBe(0);
      expect(global.totalUsers).toBe(0);
      expect(global.totalGroups).toBe(0);
      expect(global.totalGenericResources).toBe(0);
    });

    it('should seed user counts from repository for each endpoint', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'test-ep' }],
      });
      userRepo.findAll.mockResolvedValue([
        makeUser({ active: true }),
        makeUser({ id: 'i2', scimId: 'u2', active: true }),
        makeUser({ id: 'i3', scimId: 'u3', active: false }),
      ]);

      await service.onModuleInit();

      const stats = service.getEndpointStats('ep-1');
      expect(stats.userCount).toBe(3);
      expect(stats.activeUserCount).toBe(2);
    });

    it('should seed group counts from repository for each endpoint', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'test-ep' }],
      });
      groupRepo.findAllWithMembers.mockResolvedValue([
        makeGroup({ active: true }),
        makeGroup({ id: 'g2', scimId: 'g2', active: false }),
      ]);

      await service.onModuleInit();

      const stats = service.getEndpointStats('ep-1');
      expect(stats.groupCount).toBe(2);
      expect(stats.activeGroupCount).toBe(1);
    });

    it('should seed multiple endpoints independently', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 2,
        endpoints: [
          { id: 'ep-1', name: 'ep1' },
          { id: 'ep-2', name: 'ep2' },
        ],
      });
      userRepo.findAll
        .mockResolvedValueOnce([makeUser()])           // ep-1: 1 user
        .mockResolvedValueOnce([makeUser(), makeUser()]); // ep-2: 2 users

      await service.onModuleInit();

      expect(service.getEndpointStats('ep-1').userCount).toBe(1);
      expect(service.getEndpointStats('ep-2').userCount).toBe(2);
      expect(service.getGlobalStats().totalUsers).toBe(3);
      expect(service.getGlobalStats().totalEndpoints).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. Event-driven counter updates - Users
  // ───────────────────────────────────────────────────────────────────────

  describe('user event handlers', () => {
    beforeEach(async () => {
      // Start with seeded state: ep-1 has 2 users (1 active, 1 inactive)
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'test-ep' }],
      });
      userRepo.findAll.mockResolvedValue([
        makeUser({ active: true }),
        makeUser({ id: 'i2', scimId: 'u2', active: false }),
      ]);
      await service.onModuleInit();
    });

    it('should increment userCount and activeUserCount on user.created (active=true)', () => {
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'new-1', active: true });

      const stats = service.getEndpointStats('ep-1');
      expect(stats.userCount).toBe(3);
      expect(stats.activeUserCount).toBe(2);
    });

    it('should increment userCount but not activeUserCount on user.created (active=false)', () => {
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'new-1', active: false });

      const stats = service.getEndpointStats('ep-1');
      expect(stats.userCount).toBe(3);
      expect(stats.activeUserCount).toBe(1);
    });

    it('should decrement userCount on user.deleted', () => {
      service.handleUserDeleted({ endpointId: 'ep-1', scimId: 'u1' });

      const stats = service.getEndpointStats('ep-1');
      expect(stats.userCount).toBe(1);
    });

    it('should decrement activeUserCount on user.deleted when active=true', () => {
      service.handleUserDeleted({ endpointId: 'ep-1', scimId: 'u1', active: true });

      const stats = service.getEndpointStats('ep-1');
      expect(stats.activeUserCount).toBe(0);
    });

    it('should update activeUserCount on user.statusChanged (active true->false)', () => {
      service.handleUserStatusChanged({
        endpointId: 'ep-1',
        scimId: 'u1',
        previousActive: true,
        newActive: false,
      });

      expect(service.getEndpointStats('ep-1').activeUserCount).toBe(0);
    });

    it('should update activeUserCount on user.statusChanged (active false->true)', () => {
      service.handleUserStatusChanged({
        endpointId: 'ep-1',
        scimId: 'u1',
        previousActive: false,
        newActive: true,
      });

      expect(service.getEndpointStats('ep-1').activeUserCount).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. Event-driven counter updates - Groups
  // ───────────────────────────────────────────────────────────────────────

  describe('group event handlers', () => {
    beforeEach(async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'test-ep' }],
      });
      groupRepo.findAllWithMembers.mockResolvedValue([
        makeGroup({ active: true }),
      ]);
      await service.onModuleInit();
    });

    it('should increment groupCount on group.created', () => {
      service.handleGroupCreated({ endpointId: 'ep-1', scimId: 'new-g', active: true });

      expect(service.getEndpointStats('ep-1').groupCount).toBe(2);
      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(2);
    });

    it('should increment groupCount but not activeGroupCount on group.created (active=false)', () => {
      service.handleGroupCreated({ endpointId: 'ep-1', scimId: 'new-g', active: false });

      expect(service.getEndpointStats('ep-1').groupCount).toBe(2);
      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(1);
    });

    it('should decrement groupCount on group.deleted', () => {
      service.handleGroupDeleted({ endpointId: 'ep-1', scimId: 'g1', active: true });

      expect(service.getEndpointStats('ep-1').groupCount).toBe(0);
      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(0);
    });

    it('should not decrement activeGroupCount on group.deleted when active is not true', () => {
      service.handleGroupDeleted({ endpointId: 'ep-1', scimId: 'g1', active: false });

      expect(service.getEndpointStats('ep-1').groupCount).toBe(0);
      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(1);
    });

    it('should update activeGroupCount on group.statusChanged (true->false)', () => {
      service.handleGroupStatusChanged({
        endpointId: 'ep-1',
        scimId: 'g1',
        previousActive: true,
        newActive: false,
      });

      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(0);
    });

    it('should update activeGroupCount on group.statusChanged (false->true)', () => {
      service.handleGroupStatusChanged({
        endpointId: 'ep-1',
        scimId: 'g1',
        previousActive: false,
        newActive: true,
      });

      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(2);
    });

    it('should be a no-op for group.statusChanged same-to-same (true->true)', () => {
      service.handleGroupStatusChanged({
        endpointId: 'ep-1',
        scimId: 'g1',
        previousActive: true,
        newActive: true,
      });

      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. Event-driven counter updates - Generic Resources
  // ───────────────────────────────────────────────────────────────────────

  describe('generic resource event handlers', () => {
    beforeEach(async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'test-ep' }],
      });
      await service.onModuleInit();
    });

    it('should increment genericResourceCount on resource.created', () => {
      service.handleResourceCreated({
        endpointId: 'ep-1',
        scimId: 'r1',
        resourceType: 'Device',
      });

      expect(service.getEndpointStats('ep-1').genericResourceCount).toBe(1);
      expect(service.getGlobalStats().totalGenericResources).toBe(1);
    });

    it('should decrement genericResourceCount on resource.deleted', () => {
      service.handleResourceCreated({
        endpointId: 'ep-1',
        scimId: 'r1',
        resourceType: 'Device',
      });
      service.handleResourceDeleted({
        endpointId: 'ep-1',
        scimId: 'r1',
        resourceType: 'Device',
      });

      expect(service.getEndpointStats('ep-1').genericResourceCount).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. Global stats aggregation
  // ───────────────────────────────────────────────────────────────────────

  describe('getGlobalStats', () => {
    it('should aggregate across all endpoints', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 2,
        endpoints: [
          { id: 'ep-1', name: 'ep1' },
          { id: 'ep-2', name: 'ep2' },
        ],
      });
      userRepo.findAll
        .mockResolvedValueOnce([makeUser()])
        .mockResolvedValueOnce([makeUser(), makeUser()]);
      groupRepo.findAllWithMembers
        .mockResolvedValueOnce([makeGroup()])
        .mockResolvedValueOnce([]);

      await service.onModuleInit();

      const global = service.getGlobalStats();
      expect(global.totalEndpoints).toBe(2);
      expect(global.totalUsers).toBe(3);
      expect(global.totalGroups).toBe(1);
    });

    it('should reflect event-driven changes in global stats', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'ep1' }],
      });
      await service.onModuleInit();

      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u1', active: true });
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u2', active: true });
      service.handleGroupCreated({ endpointId: 'ep-1', scimId: 'g1', active: true });

      const global = service.getGlobalStats();
      expect(global.totalUsers).toBe(2);
      expect(global.totalGroups).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 6. Edge cases
  // ───────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    beforeEach(async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'test-ep' }],
      });
      await service.onModuleInit();
    });

    it('should not decrement below zero on delete for empty endpoint', () => {
      service.handleUserDeleted({ endpointId: 'ep-1', scimId: 'nonexistent' });

      const stats = service.getEndpointStats('ep-1');
      expect(stats.userCount).toBe(0);
      expect(stats.activeUserCount).toBe(0);
    });

    it('should auto-initialize stats for unknown endpoint on event', () => {
      service.handleUserCreated({ endpointId: 'ep-unknown', scimId: 'u1', active: true });

      const stats = service.getEndpointStats('ep-unknown');
      expect(stats.userCount).toBe(1);
      expect(stats.activeUserCount).toBe(1);
    });

    it('should return zeroed snapshot for unknown endpoint on read (no event)', () => {
      const stats = service.getEndpointStats('nonexistent');
      expect(stats.userCount).toBe(0);
      expect(stats.groupCount).toBe(0);
      expect(stats.genericResourceCount).toBe(0);
    });

    it('should not decrement groupCount below zero on delete from empty endpoint', () => {
      service.handleGroupDeleted({ endpointId: 'ep-1', scimId: 'nonexistent', active: true });

      expect(service.getEndpointStats('ep-1').groupCount).toBe(0);
      expect(service.getEndpointStats('ep-1').activeGroupCount).toBe(0);
    });

    it('should not decrement genericResourceCount below zero', () => {
      service.handleResourceDeleted({
        endpointId: 'ep-1',
        scimId: 'nonexistent',
        resourceType: 'Device',
      });

      expect(service.getEndpointStats('ep-1').genericResourceCount).toBe(0);
    });

    it('should treat user.created with active=undefined as active (SCIM default)', () => {
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u1' });

      expect(service.getEndpointStats('ep-1').userCount).toBe(1);
      expect(service.getEndpointStats('ep-1').activeUserCount).toBe(1);
    });

    it('should not decrement activeUserCount on user.deleted with active=false', () => {
      // Seed one active user
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u1', active: true });
      expect(service.getEndpointStats('ep-1').activeUserCount).toBe(1);

      // Delete an inactive user - activeUserCount should stay the same
      service.handleUserDeleted({ endpointId: 'ep-1', scimId: 'u2', active: false });
      expect(service.getEndpointStats('ep-1').activeUserCount).toBe(1);
    });

    it('should be a no-op for user.statusChanged same-to-same (true->true)', () => {
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u1', active: true });
      service.handleUserStatusChanged({
        endpointId: 'ep-1',
        scimId: 'u1',
        previousActive: true,
        newActive: true,
      });

      expect(service.getEndpointStats('ep-1').activeUserCount).toBe(1);
    });

    it('should return snapshot copies that do not mutate internal state', () => {
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u1', active: true });
      const snapshot = service.getEndpointStats('ep-1');
      snapshot.userCount = 999;

      // Internal state should be unaffected
      expect(service.getEndpointStats('ep-1').userCount).toBe(1);
    });

    it('should return getAllEndpointStats copies that do not mutate internal state', () => {
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u1', active: true });
      const all = service.getAllEndpointStats();
      const snap = all.get('ep-1');
      if (snap) snap.userCount = 999;

      expect(service.getEndpointStats('ep-1').userCount).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 7. Periodic reconciliation
  // ───────────────────────────────────────────────────────────────────────

  describe('reconcile', () => {
    it('should re-seed counts from repositories on reconcile', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'ep1' }],
      });
      // Initial: 0 users
      await service.onModuleInit();
      expect(service.getEndpointStats('ep-1').userCount).toBe(0);

      // Meanwhile DB has 3 users (simulating drift)
      userRepo.findAll.mockResolvedValue([
        makeUser(),
        makeUser({ id: 'i2', scimId: 'u2' }),
        makeUser({ id: 'i3', scimId: 'u3', active: false }),
      ]);

      await service.reconcile();

      const stats = service.getEndpointStats('ep-1');
      expect(stats.userCount).toBe(3);
      expect(stats.activeUserCount).toBe(2);
    });

    it('should handle endpoint added between init and reconcile', async () => {
      // Init with 0 endpoints
      await service.onModuleInit();
      expect(service.getGlobalStats().totalEndpoints).toBe(0);

      // Reconcile sees new endpoint
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-new', name: 'new-ep' }],
      });
      userRepo.findAll.mockResolvedValue([makeUser({ endpointId: 'ep-new' })]);

      await service.reconcile();

      expect(service.getGlobalStats().totalEndpoints).toBe(1);
      expect(service.getEndpointStats('ep-new').userCount).toBe(1);
    });

    it('should remove stale endpoint stats on reconcile', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'ep1' }],
      });
      userRepo.findAll.mockResolvedValue([makeUser()]);
      await service.onModuleInit();
      expect(service.getEndpointStats('ep-1').userCount).toBe(1);

      // Reconcile: endpoint deleted
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 0,
        endpoints: [],
      });

      await service.reconcile();

      expect(service.getGlobalStats().totalEndpoints).toBe(0);
      // Stale endpoint should return zeros
      expect(service.getEndpointStats('ep-1').userCount).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 8. getAllEndpointStats
  // ───────────────────────────────────────────────────────────────────────

  describe('getAllEndpointStats', () => {
    it('should return map of all tracked endpoints', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 2,
        endpoints: [
          { id: 'ep-1', name: 'ep1' },
          { id: 'ep-2', name: 'ep2' },
        ],
      });
      userRepo.findAll
        .mockResolvedValueOnce([makeUser()])
        .mockResolvedValueOnce([]);
      await service.onModuleInit();

      const all = service.getAllEndpointStats();
      expect(all.size).toBe(2);
      expect(all.get('ep-1')?.userCount).toBe(1);
      expect(all.get('ep-2')?.userCount).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 9. Error handling / graceful degradation
  // ───────────────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should not crash on init if listEndpoints throws', async () => {
      mockEndpointService.listEndpoints.mockRejectedValue(new Error('DB down'));

      // Should NOT throw - graceful degradation
      await service.onModuleInit();

      expect(service.getGlobalStats().totalEndpoints).toBe(0);
    });

    it('should not crash on reconcile if listEndpoints throws', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'ep1' }],
      });
      await service.onModuleInit();

      // Seed one user so we can verify counters are preserved
      service.handleUserCreated({ endpointId: 'ep-1', scimId: 'u1', active: true });

      // Reconcile fails
      mockEndpointService.listEndpoints.mockRejectedValue(new Error('DB down'));
      await service.reconcile();

      // Existing counters should be preserved
      expect(service.getEndpointStats('ep-1').userCount).toBe(1);
    });

    it('should skip failing endpoint and seed remaining on per-endpoint error', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 2,
        endpoints: [
          { id: 'ep-good', name: 'good' },
          { id: 'ep-bad', name: 'bad' },
        ],
      });
      userRepo.findAll
        .mockResolvedValueOnce([makeUser({ endpointId: 'ep-good' })]) // ep-good succeeds
        .mockRejectedValueOnce(new Error('query failed')); // ep-bad fails

      await service.onModuleInit();

      // ep-good was seeded successfully
      expect(service.getEndpointStats('ep-good').userCount).toBe(1);
      // ep-bad was skipped - returns zeroed
      expect(service.getEndpointStats('ep-bad').userCount).toBe(0);
    });

    it('should preserve genericResourceCount across reconciliation', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue({
        totalResults: 1,
        endpoints: [{ id: 'ep-1', name: 'ep1' }],
      });
      await service.onModuleInit();

      // Add generic resources via events
      service.handleResourceCreated({ endpointId: 'ep-1', scimId: 'r1', resourceType: 'Device' });
      service.handleResourceCreated({ endpointId: 'ep-1', scimId: 'r2', resourceType: 'Device' });
      expect(service.getEndpointStats('ep-1').genericResourceCount).toBe(2);

      // Reconcile should preserve genericResourceCount (not reset to 0)
      await service.reconcile();

      expect(service.getEndpointStats('ep-1').genericResourceCount).toBe(2);
    });
  });
});
