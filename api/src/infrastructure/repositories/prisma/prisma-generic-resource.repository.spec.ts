/**
 * PrismaGenericResourceRepository — Unit tests for error wrapping.
 *
 * Verifies that all write operations (create/update/delete) wrap
 * Prisma errors into typed RepositoryError instances via wrapPrismaError().
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

  // ─── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('should insert into scimResource and return mapped record', async () => {
      const input = {
        endpointId: 'ep-1',
        resourceType: 'Device',
        scimId: SCIM_ID,
        externalId: null,
        displayName: 'MyDevice',
        active: true,
        rawPayload: '{}',
        meta: '{}',
      };
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(fakeScimResource());

      const result = await repo.create(input);

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

    it('should throw RepositoryError CONFLICT on P2002 unique constraint', async () => {
      const prismaError = Object.assign(new Error('Unique constraint violation'), { code: 'P2002' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create({
        endpointId: 'ep-1', resourceType: 'Device', scimId: SCIM_ID,
        externalId: null, displayName: 'MyDevice', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toThrow(RepositoryError);

      await expect(repo.create({
        endpointId: 'ep-1', resourceType: 'Device', scimId: SCIM_ID,
        externalId: null, displayName: 'MyDevice', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should throw RepositoryError CONNECTION on P1001 connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create({
        endpointId: 'ep-1', resourceType: 'Device', scimId: SCIM_ID,
        externalId: null, displayName: 'MyDevice', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toMatchObject({ code: 'CONNECTION' });
    });

    it('should throw RepositoryError UNKNOWN on unexpected Prisma error', async () => {
      const prismaError = Object.assign(new Error('Something bad'), { code: 'P9999' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create({
        endpointId: 'ep-1', resourceType: 'Device', scimId: SCIM_ID,
        externalId: null, displayName: 'MyDevice', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toMatchObject({ code: 'UNKNOWN' });
    });
  });

  // ─── findByScimId ─────────────────────────────────────────────────────

  describe('findByScimId', () => {
    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.scimResource.findFirst as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findByScimId('ep-1', 'Device', SCIM_ID))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.scimResource.findMany as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findAll('ep-1', 'Device'))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('should throw RepositoryError NOT_FOUND on P2025', async () => {
      const prismaError = Object.assign(new Error('Record not found'), { code: 'P2025' });
      (prisma.scimResource.update as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.update('nonexistent', { active: false }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should throw RepositoryError NOT_FOUND on P2025', async () => {
      const prismaError = Object.assign(new Error('Record not found'), { code: 'P2025' });
      (prisma.scimResource.delete as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.delete('nonexistent'))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
