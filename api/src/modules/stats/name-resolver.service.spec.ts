/**
 * NameResolverService - TDD spec (RED first).
 *
 * Batched SCIM resource name resolution with LRU cache.
 * Tests written BEFORE implementation per DELIVERY_PLAN.md S7 TDD rules.
 *
 * @see docs/DELIVERY_PLAN.md UI-B4
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S6.5
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NameResolverService } from './name-resolver.service';
import { USER_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../domain/repositories/group.repository.interface';
import type { UserRecord } from '../../domain/models/user.model';
import type { GroupWithMembers } from '../../domain/models/group.model';

// ---- Helpers: mock record factories ---

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'internal-1',
    endpointId: 'ep-1',
    scimId: 'scim-u-1',
    externalId: null,
    userName: 'alice',
    displayName: 'Alice Smith',
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

describe('NameResolverService', () => {
  let service: NameResolverService;
  let userRepo: jest.Mocked<IUserRepository>;
  let groupRepo: jest.Mocked<IGroupRepository>;

  beforeEach(async () => {
    userRepo = {
      findAll: jest.fn().mockResolvedValue([]),
      findByScimId: jest.fn().mockResolvedValue(null),
      findByScimIds: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findConflict: jest.fn(),
    } as any;

    groupRepo = {
      findAllWithMembers: jest.fn().mockResolvedValue([]),
      findWithMembers: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findByScimId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByDisplayName: jest.fn(),
      findByExternalId: jest.fn(),
      addMembers: jest.fn(),
      updateGroupWithMembers: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NameResolverService,
        { provide: USER_REPOSITORY, useValue: userRepo },
        { provide: GROUP_REPOSITORY, useValue: groupRepo },
      ],
    }).compile();

    service = module.get(NameResolverService);
  });

  // ─── 1. Single user resolution ─────────────────────────────────────

  describe('resolveUserName', () => {
    it('should resolve a user scimId to displayName', async () => {
      userRepo.findByScimId.mockResolvedValue(
        makeUser({ scimId: 'u1', displayName: 'Alice Smith' }),
      );

      const name = await service.resolveUserName('ep-1', 'u1');
      expect(name).toBe('Alice Smith');
    });

    it('should fall back to userName when displayName is null', async () => {
      userRepo.findByScimId.mockResolvedValue(
        makeUser({ scimId: 'u1', displayName: null, userName: 'alice@corp.com' }),
      );

      const name = await service.resolveUserName('ep-1', 'u1');
      expect(name).toBe('alice@corp.com');
    });

    it('should return null for non-existent user', async () => {
      userRepo.findByScimId.mockResolvedValue(null);

      const name = await service.resolveUserName('ep-1', 'nonexistent');
      expect(name).toBeNull();
    });
  });

  // ─── 2. Single group resolution ────────────────────────────────────

  describe('resolveGroupName', () => {
    it('should resolve a group scimId to displayName', async () => {
      groupRepo.findWithMembers.mockResolvedValue(
        makeGroup({ scimId: 'g1', displayName: 'Engineering' }),
      );

      const name = await service.resolveGroupName('ep-1', 'g1');
      expect(name).toBe('Engineering');
    });

    it('should return null for non-existent group', async () => {
      groupRepo.findWithMembers.mockResolvedValue(null);

      const name = await service.resolveGroupName('ep-1', 'nonexistent');
      expect(name).toBeNull();
    });
  });

  // ─── 3. LRU caching ───────────────────────────────────────────────

  describe('LRU caching', () => {
    it('should cache user name and not query DB again', async () => {
      userRepo.findByScimId.mockResolvedValue(
        makeUser({ scimId: 'u1', displayName: 'Alice' }),
      );

      const name1 = await service.resolveUserName('ep-1', 'u1');
      const name2 = await service.resolveUserName('ep-1', 'u1');

      expect(name1).toBe('Alice');
      expect(name2).toBe('Alice');
      expect(userRepo.findByScimId).toHaveBeenCalledTimes(1); // Only one DB query
    });

    it('should cache group name and not query DB again', async () => {
      groupRepo.findWithMembers.mockResolvedValue(
        makeGroup({ scimId: 'g1', displayName: 'Eng' }),
      );

      const name1 = await service.resolveGroupName('ep-1', 'g1');
      const name2 = await service.resolveGroupName('ep-1', 'g1');

      expect(name1).toBe('Eng');
      expect(name2).toBe('Eng');
      expect(groupRepo.findWithMembers).toHaveBeenCalledTimes(1);
    });

    it('should use composite cache key (endpointId + scimId)', async () => {
      userRepo.findByScimId
        .mockResolvedValueOnce(makeUser({ scimId: 'u1', displayName: 'Alice EP1', endpointId: 'ep-1' }))
        .mockResolvedValueOnce(makeUser({ scimId: 'u1', displayName: 'Alice EP2', endpointId: 'ep-2' }));

      const name1 = await service.resolveUserName('ep-1', 'u1');
      const name2 = await service.resolveUserName('ep-2', 'u1');

      expect(name1).toBe('Alice EP1');
      expect(name2).toBe('Alice EP2');
      expect(userRepo.findByScimId).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 4. Batch resolution ──────────────────────────────────────────

  describe('resolveUserNames (batch)', () => {
    it('should resolve multiple user IDs in one call', async () => {
      userRepo.findByScimIds.mockResolvedValue([
        { id: 'i1', scimId: 'u1' },
        { id: 'i2', scimId: 'u2' },
      ]);
      // For display names, service needs to query individual records or
      // use findAll. Let's mock findAll for batch resolution.
      userRepo.findAll.mockResolvedValue([
        makeUser({ scimId: 'u1', displayName: 'Alice' }),
        makeUser({ scimId: 'u2', displayName: 'Bob' }),
        makeUser({ scimId: 'u3', displayName: 'Charlie' }),
      ]);

      const names = await service.resolveUserNames('ep-1', ['u1', 'u2']);
      expect(names.get('u1')).toBe('Alice');
      expect(names.get('u2')).toBe('Bob');
    });

    it('should return undefined for unknown IDs in batch', async () => {
      userRepo.findAll.mockResolvedValue([
        makeUser({ scimId: 'u1', displayName: 'Alice' }),
      ]);

      const names = await service.resolveUserNames('ep-1', ['u1', 'unknown']);
      expect(names.get('u1')).toBe('Alice');
      expect(names.get('unknown')).toBeUndefined();
    });

    it('should populate LRU cache from batch results', async () => {
      userRepo.findAll.mockResolvedValue([
        makeUser({ scimId: 'u1', displayName: 'Alice' }),
      ]);

      await service.resolveUserNames('ep-1', ['u1']);

      // Subsequent single resolve should hit cache - no extra DB query
      const name = await service.resolveUserName('ep-1', 'u1');
      expect(name).toBe('Alice');
      expect(userRepo.findByScimId).not.toHaveBeenCalled();
    });
  });

  // ─── 5. Cache invalidation ────────────────────────────────────────

  describe('cache management', () => {
    it('should allow manual cache invalidation', async () => {
      userRepo.findByScimId
        .mockResolvedValueOnce(makeUser({ scimId: 'u1', displayName: 'Alice' }))
        .mockResolvedValueOnce(makeUser({ scimId: 'u1', displayName: 'Alice Updated' }));

      const name1 = await service.resolveUserName('ep-1', 'u1');
      expect(name1).toBe('Alice');

      service.invalidate('ep-1', 'u1');

      const name2 = await service.resolveUserName('ep-1', 'u1');
      expect(name2).toBe('Alice Updated');
      expect(userRepo.findByScimId).toHaveBeenCalledTimes(2);
    });

    it('should allow clearing the entire cache', async () => {
      userRepo.findByScimId.mockResolvedValue(
        makeUser({ scimId: 'u1', displayName: 'Alice' }),
      );

      await service.resolveUserName('ep-1', 'u1');
      service.clearCache();

      await service.resolveUserName('ep-1', 'u1');
      expect(userRepo.findByScimId).toHaveBeenCalledTimes(2);
    });
  });
});
