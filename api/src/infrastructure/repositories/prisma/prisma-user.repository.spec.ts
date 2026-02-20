/**
 * PrismaUserRepository — Unit tests for Phase 2 unified ScimResource table.
 *
 * Verifies that all queries target `scimResource` with `resourceType: 'User'`
 * and that the mapping from ScimResource → UserRecord is correct.
 */
import { PrismaUserRepository } from './prisma-user.repository';
import type { PrismaService } from '../../../modules/prisma/prisma.service';

// ─── Factory helpers ──────────────────────────────────────────────────────────

function createMockPrismaService(): PrismaService {
  return {
    scimResource: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as PrismaService;
}

function fakeScimResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    endpointId: 'ep-1',
    resourceType: 'User',
    scimId: 'scim-1',
    externalId: null,
    userName: 'alice',
    userNameLower: 'alice',
    displayName: null,
    displayNameLower: null,
    active: true,
    rawPayload: '{}',
    version: 1,
    meta: '{"resourceType":"User"}',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrismaUserRepository (Phase 2 — unified table)', () => {
  let repo: PrismaUserRepository;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    repo = new PrismaUserRepository(prisma);
  });

  // ─── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('should insert with resourceType "User" into scimResource', async () => {
      const input = {
        endpointId: 'ep-1',
        scimId: 'scim-1',
        externalId: null,
        userName: 'alice',
        userNameLower: 'alice',
        active: true,
        rawPayload: '{}',
        meta: '{}',
      };

      const dbRow = fakeScimResource(input);
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create(input);

      expect(prisma.scimResource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resourceType: 'User',
          scimId: 'scim-1',
          userName: 'alice',
          endpoint: { connect: { id: 'ep-1' } },
        }),
      });
      expect(result.id).toBe('res-1');
      expect(result.userName).toBe('alice');
    });

    it('should map ScimResource row to UserRecord', async () => {
      const dbRow = fakeScimResource({
        id: 'uid-42',
        userName: 'Bob',
        userNameLower: 'bob',
        externalId: 'ext-99',
        active: false,
      });
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create({
        endpointId: 'ep-1',
        scimId: 'scim-1',
        externalId: 'ext-99',
        userName: 'Bob',
        userNameLower: 'bob',
        active: false,
        rawPayload: '{}',
        meta: '{}',
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'uid-42',
          userName: 'Bob',
          userNameLower: 'bob',
          externalId: 'ext-99',
          active: false,
        }),
      );
      // Should NOT have resourceType or version in domain model
      expect(result).not.toHaveProperty('resourceType');
      expect(result).not.toHaveProperty('version');
    });
  });

  // ─── findByScimId ────────────────────────────────────────────────────

  describe('findByScimId', () => {
    it('should query scimResource with resourceType filter', async () => {
      const dbRow = fakeScimResource();
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(dbRow);

      await repo.findByScimId('ep-1', 'scim-1');

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: { scimId: 'scim-1', endpointId: 'ep-1', resourceType: 'User' },
      });
    });

    it('should return null when not found', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await repo.findByScimId('ep-1', 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return mapped UserRecord when found', async () => {
      const dbRow = fakeScimResource({ scimId: 'found-id' });
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.findByScimId('ep-1', 'found-id');
      expect(result).not.toBeNull();
      expect(result!.scimId).toBe('found-id');
      expect(result!.userName).toBe('alice');
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should include resourceType: User in where clause', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAll('ep-1');

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ endpointId: 'ep-1', resourceType: 'User' }),
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should merge dbFilter with resourceType constraint', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAll('ep-1', { userNameLower: 'alice' });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userNameLower: 'alice',
          endpointId: 'ep-1',
          resourceType: 'User',
        }),
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should pass custom orderBy', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAll('ep-1', undefined, { field: 'userName', direction: 'desc' });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ resourceType: 'User' }),
        orderBy: { userName: 'desc' },
      });
    });

    it('should map all returned rows to UserRecord[]', async () => {
      const rows = [
        fakeScimResource({ id: 'u1', userName: 'alice' }),
        fakeScimResource({ id: 'u2', userName: 'bob' }),
      ];
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await repo.findAll('ep-1');
      expect(result).toHaveLength(2);
      expect(result[0].userName).toBe('alice');
      expect(result[1].userName).toBe('bob');
    });
  });

  // ─── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update scimResource by id', async () => {
      const dbRow = fakeScimResource({ active: false });
      (prisma.scimResource.update as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.update('res-1', { active: false });

      expect(prisma.scimResource.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete from scimResource by id', async () => {
      (prisma.scimResource.delete as jest.Mock).mockResolvedValue({});

      await repo.delete('res-1');

      expect(prisma.scimResource.delete).toHaveBeenCalledWith({
        where: { id: 'res-1' },
      });
    });
  });

  // ─── findConflict ────────────────────────────────────────────────────

  describe('findConflict', () => {
    it('should scope conflict search to resourceType User', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      await repo.findConflict('ep-1', 'alice');

      const call = (prisma.scimResource.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ endpointId: 'ep-1', resourceType: 'User' }),
        ]),
      );
    });

    it('should check userName and externalId conflicts', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      await repo.findConflict('ep-1', 'alice', 'ext-1');

      const call = (prisma.scimResource.findFirst as jest.Mock).mock.calls[0][0];
      const orClause = call.where.AND.find(
        (c: Record<string, unknown>) => c.OR,
      );
      expect(orClause.OR).toEqual(
        expect.arrayContaining([
          { userNameLower: 'alice' },
          { externalId: 'ext-1' },
        ]),
      );
    });

    it('should exclude specific scimId', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      await repo.findConflict('ep-1', 'alice', undefined, 'exclude-me');

      const call = (prisma.scimResource.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ NOT: { scimId: 'exclude-me' } }),
        ]),
      );
    });

    it('should return mapped conflict result when found', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue({
        scimId: 'existing-id',
        userName: 'alice',
        externalId: 'ext-1',
      });

      const result = await repo.findConflict('ep-1', 'alice');
      expect(result).toEqual({
        scimId: 'existing-id',
        userName: 'alice',
        externalId: 'ext-1',
      });
    });

    it('should return null when no conflict', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await repo.findConflict('ep-1', 'alice');
      expect(result).toBeNull();
    });
  });

  // ─── findByScimIds ───────────────────────────────────────────────────

  describe('findByScimIds', () => {
    it('should return empty array for empty input', async () => {
      const result = await repo.findByScimIds('ep-1', []);
      expect(result).toEqual([]);
      expect(prisma.scimResource.findMany).not.toHaveBeenCalled();
    });

    it('should query scimResource with resourceType filter', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([
        { id: 'u1', scimId: 's1' },
        { id: 'u2', scimId: 's2' },
      ]);

      const result = await repo.findByScimIds('ep-1', ['s1', 's2']);

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: { scimId: { in: ['s1', 's2'] }, endpointId: 'ep-1', resourceType: 'User' },
        select: { id: true, scimId: true },
      });
      expect(result).toHaveLength(2);
    });
  });
});
