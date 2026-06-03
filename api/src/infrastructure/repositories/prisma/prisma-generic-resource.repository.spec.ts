/**
 * PrismaGenericResourceRepository - Unit tests.
 *
 * Covers happy-path behaviour, null / not-found returns, UUID validation
 * short-circuits, payload mapping, and Prisma error wrapping for every
 * public method: create, findByScimId, findAll, update, delete,
 * findByExternalId, findByDisplayName.
 */
import { PrismaGenericResourceRepository } from './prisma-generic-resource.repository';
import type { PrismaService } from '../../../modules/prisma/prisma.service';
import { RepositoryError } from '../../../domain/errors/repository-error';

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

const SCIM_ID = '20000000-0000-4000-a000-000000000001';
const SCIM_ID_2 = '20000000-0000-4000-a000-000000000002';

function fakeScimResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    endpointId: 'ep-1',
    resourceType: 'Device',
    scimId: SCIM_ID,
    externalId: null,
    userName: null,
    displayName: 'MyDevice',
    active: true,
    payload: {},
    version: 1,
    meta: '{"resourceType":"Device"}',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrismaGenericResourceRepository', () => {
  let repo: PrismaGenericResourceRepository;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    repo = new PrismaGenericResourceRepository(prisma);
  });

  // ─── Helper ──────────────────────────────────────────────────────────

  const defaultInput = {
    endpointId: 'ep-1',
    resourceType: 'Device',
    scimId: SCIM_ID,
    externalId: null,
    displayName: 'MyDevice',
    active: true,
    rawPayload: '{}',
    meta: '{}',
  };

  // ─── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('should insert into scimResource and return mapped record', async () => {
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(fakeScimResource());

      const result = await repo.create(defaultInput);

      expect(prisma.scimResource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resourceType: 'Device',
          scimId: SCIM_ID,
          endpoint: { connect: { id: 'ep-1' } },
        }),
      });
      expect(result.scimId).toBe(SCIM_ID);
      expect(result.displayName).toBe('MyDevice');
    });

    it('should parse rawPayload JSON and store as payload', async () => {
      const payload = { urn: 'test', value: 42 };
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(
        fakeScimResource({ payload }),
      );

      await repo.create({ ...defaultInput, rawPayload: JSON.stringify(payload) });

      expect(prisma.scimResource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payload }),
      });
    });

    it('should map all domain fields on the returned record', async () => {
      const row = fakeScimResource({
        externalId: 'ext-1',
        version: 3,
        meta: '{"resourceType":"Device","created":"2025-01-01"}',
      });
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(row);

      const result = await repo.create({ ...defaultInput, externalId: 'ext-1' });

      expect(result).toMatchObject({
        id: 'res-1',
        endpointId: 'ep-1',
        resourceType: 'Device',
        scimId: SCIM_ID,
        externalId: 'ext-1',
        displayName: 'MyDevice',
        active: true,
        version: 3,
      });
      expect(result.rawPayload).toBe('{}');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw RepositoryError CONFLICT on P2002 unique constraint', async () => {
      const prismaError = Object.assign(new Error('Unique constraint violation'), { code: 'P2002' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create(defaultInput)).rejects.toThrow(RepositoryError);
      await expect(repo.create(defaultInput)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should throw RepositoryError CONNECTION on P1001 connection error', async () => {
      const prismaError = Object.assign(new Error("Can't reach database"), { code: 'P1001' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create(defaultInput)).rejects.toMatchObject({ code: 'CONNECTION' });
    });

    it('should throw RepositoryError UNKNOWN on unexpected Prisma error', async () => {
      const prismaError = Object.assign(new Error('Something bad'), { code: 'P9999' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create(defaultInput)).rejects.toMatchObject({ code: 'UNKNOWN' });
    });
  });

  // ─── findByScimId ─────────────────────────────────────────────────────

  describe('findByScimId', () => {
    it('should return mapped record when found', async () => {
      const row = fakeScimResource({ scimId: SCIM_ID });
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(row);

      const result = await repo.findByScimId('ep-1', 'Device', SCIM_ID);

      expect(result).not.toBeNull();
      expect(result!.scimId).toBe(SCIM_ID);
      expect(result!.displayName).toBe('MyDevice');
      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: { scimId: SCIM_ID, endpointId: 'ep-1', resourceType: 'Device' },
      });
    });

    it('should return null when not found (valid UUID)', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await repo.findByScimId('ep-1', 'Device', SCIM_ID_2);

      expect(result).toBeNull();
    });

    it('should return null for non-UUID scimId without hitting DB', async () => {
      const result = await repo.findByScimId('ep-1', 'Device', 'not-a-uuid');

      expect(result).toBeNull();
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });

    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error("Can't reach database"), { code: 'P1001' });
      (prisma.scimResource.findFirst as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findByScimId('ep-1', 'Device', SCIM_ID))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return array of mapped records', async () => {
      const rows = [
        fakeScimResource({ id: 'res-1', scimId: SCIM_ID }),
        fakeScimResource({ id: 'res-2', scimId: SCIM_ID_2, displayName: 'Device2' }),
      ];
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await repo.findAll('ep-1', 'Device');

      expect(result).toHaveLength(2);
      expect(result[0].scimId).toBe(SCIM_ID);
      expect(result[1].scimId).toBe(SCIM_ID_2);
    });

    it('should return empty array when none found', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      const result = await repo.findAll('ep-1', 'Device');

      expect(result).toEqual([]);
    });

    it('should pass endpointId, resourceType and orderBy to Prisma', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAll('ep-1', 'Device');

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ endpointId: 'ep-1', resourceType: 'Device' }),
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should merge dbFilter into where clause', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAll('ep-1', 'Device', { displayName: 'Printer' });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          endpointId: 'ep-1',
          resourceType: 'Device',
          displayName: 'Printer',
        }),
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error("Can't reach database"), { code: 'P1001' });
      (prisma.scimResource.findMany as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findAll('ep-1', 'Device'))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update and return mapped record', async () => {
      const updated = fakeScimResource({ active: false, version: 2 });
      (prisma.scimResource.update as jest.Mock).mockResolvedValue(updated);

      const result = await repo.update('res-1', { active: false });

      expect(result.active).toBe(false);
      expect(result.version).toBe(2);
      expect(prisma.scimResource.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { active: false, version: { increment: 1 } },
      });
    });

    it('should convert rawPayload to parsed payload in update data', async () => {
      const payloadObj = { urn: 'test', value: 99 };
      const updated = fakeScimResource({ payload: payloadObj, version: 2 });
      (prisma.scimResource.update as jest.Mock).mockResolvedValue(updated);

      await repo.update('res-1', { rawPayload: JSON.stringify(payloadObj) });

      const callArgs = (prisma.scimResource.update as jest.Mock).mock.calls[0][0];
      expect(callArgs.data.payload).toEqual(payloadObj);
      expect(callArgs.data).not.toHaveProperty('rawPayload');
    });

    it('should throw RepositoryError NOT_FOUND on P2025', async () => {
      const prismaError = Object.assign(new Error('Record not found'), { code: 'P2025' });
      (prisma.scimResource.update as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.update('nonexistent', { active: false }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw RepositoryError CONNECTION on P1001', async () => {
      const prismaError = Object.assign(new Error("Can't reach database"), { code: 'P1001' });
      (prisma.scimResource.update as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.update('res-1', { active: false }))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });

    it('should throw RepositoryError CONFLICT on P2002', async () => {
      const prismaError = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      (prisma.scimResource.update as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.update('res-1', { displayName: 'dup' }))
        .rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete the resource by id', async () => {
      (prisma.scimResource.delete as jest.Mock).mockResolvedValue({});

      await repo.delete('res-1');

      expect(prisma.scimResource.delete).toHaveBeenCalledWith({ where: { id: 'res-1' } });
    });

    it('should throw RepositoryError NOT_FOUND on P2025', async () => {
      const prismaError = Object.assign(new Error('Record not found'), { code: 'P2025' });
      (prisma.scimResource.delete as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.delete('nonexistent'))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw RepositoryError CONNECTION on P1001', async () => {
      const prismaError = Object.assign(new Error("Can't reach database"), { code: 'P1001' });
      (prisma.scimResource.delete as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.delete('res-1'))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── findByExternalId ────────────────────────────────────────────────

  describe('findByExternalId', () => {
    it('should return mapped record when found', async () => {
      const row = fakeScimResource({ externalId: 'ext-100' });
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(row);

      const result = await repo.findByExternalId('ep-1', 'Device', 'ext-100');

      expect(result).not.toBeNull();
      expect(result!.externalId).toBe('ext-100');
      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: { endpointId: 'ep-1', resourceType: 'Device', externalId: 'ext-100' },
      });
    });

    it('should return null when not found', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await repo.findByExternalId('ep-1', 'Device', 'missing');

      expect(result).toBeNull();
    });

    it('should throw RepositoryError CONNECTION on P1001', async () => {
      const prismaError = Object.assign(new Error("Can't reach database"), { code: 'P1001' });
      (prisma.scimResource.findFirst as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findByExternalId('ep-1', 'Device', 'ext-1'))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── findByDisplayName ───────────────────────────────────────────────

  describe('findByDisplayName', () => {
    it('should return mapped record when found', async () => {
      const row = fakeScimResource({ displayName: 'Printer-A' });
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(row);

      const result = await repo.findByDisplayName('ep-1', 'Device', 'Printer-A');

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Printer-A');
      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: { endpointId: 'ep-1', resourceType: 'Device', displayName: 'Printer-A' },
      });
    });

    it('should return null when not found', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await repo.findByDisplayName('ep-1', 'Device', 'NoSuchDevice');

      expect(result).toBeNull();
    });

    it('should throw RepositoryError CONNECTION on P1001', async () => {
      const prismaError = Object.assign(new Error("Can't reach database"), { code: 'P1001' });
      (prisma.scimResource.findFirst as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findByDisplayName('ep-1', 'Device', 'Printer'))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });
});
