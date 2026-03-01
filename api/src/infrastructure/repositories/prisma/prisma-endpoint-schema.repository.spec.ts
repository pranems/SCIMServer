/**
 * PrismaEndpointSchemaRepository — Unit tests.
 *
 * Verifies that all queries target `endpointSchema` and that the
 * mapping from the Prisma row → EndpointSchemaRecord is correct.
 * Uses a mock PrismaService (no real database).
 */
import { PrismaEndpointSchemaRepository } from './prisma-endpoint-schema.repository';
import type { PrismaService } from '../../../modules/prisma/prisma.service';
import type { EndpointSchemaCreateInput } from '../../../domain/models/endpoint-schema.model';

// ─── Factory helpers ──────────────────────────────────────────────────────────

function createMockPrismaService(): PrismaService {
  return {
    endpointSchema: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

const EP_ID = '00000000-0000-4000-a000-000000000001';
const EP_ID2 = '00000000-0000-4000-a000-000000000002';
const SCHEMA_URN = 'urn:ietf:params:scim:schemas:extension:custom:2.0:User';
const SCHEMA_URN2 = 'urn:ietf:params:scim:schemas:extension:badge:2.0:User';

function fakeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    endpointId: EP_ID,
    schemaUrn: SCHEMA_URN,
    name: 'Custom Extension',
    description: 'Test extension',
    resourceTypeId: 'User',
    required: false,
    attributes: [{ name: 'badge', type: 'string', multiValued: false, required: false }],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function sampleInput(overrides: Partial<EndpointSchemaCreateInput> = {}): EndpointSchemaCreateInput {
  return {
    endpointId: EP_ID,
    schemaUrn: SCHEMA_URN,
    name: 'Custom Extension',
    description: 'Test extension',
    resourceTypeId: 'User',
    required: false,
    attributes: [{ name: 'badge', type: 'string', multiValued: false, required: false }],
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrismaEndpointSchemaRepository', () => {
  let repo: PrismaEndpointSchemaRepository;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    repo = new PrismaEndpointSchemaRepository(prisma);
  });

  // ─── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('should call prisma.endpointSchema.create with correct data', async () => {
      const input = sampleInput();
      const dbRow = fakeDbRow();
      (prisma.endpointSchema.create as jest.Mock).mockResolvedValue(dbRow);

      await repo.create(input);

      expect(prisma.endpointSchema.create).toHaveBeenCalledWith({
        data: {
          endpointId: EP_ID,
          schemaUrn: SCHEMA_URN,
          name: 'Custom Extension',
          description: 'Test extension',
          resourceTypeId: 'User',
          required: false,
          attributes: input.attributes,
        },
      });
    });

    it('should map the DB row to an EndpointSchemaRecord', async () => {
      const dbRow = fakeDbRow({ id: 'created-id' });
      (prisma.endpointSchema.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create(sampleInput());

      expect(result).toEqual(
        expect.objectContaining({
          id: 'created-id',
          endpointId: EP_ID,
          schemaUrn: SCHEMA_URN,
          name: 'Custom Extension',
          description: 'Test extension',
          resourceTypeId: 'User',
          required: false,
        }),
      );
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should default description and resourceTypeId to null when input is null', async () => {
      const input = sampleInput({ description: null, resourceTypeId: null });
      const dbRow = fakeDbRow({ description: null, resourceTypeId: null });
      (prisma.endpointSchema.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create(input);

      expect(result.description).toBeNull();
      expect(result.resourceTypeId).toBeNull();
    });

    it('should default required to false when input has no required field', async () => {
      const input = sampleInput();
      delete (input as any).required;
      const dbRow = fakeDbRow({ required: false });
      (prisma.endpointSchema.create as jest.Mock).mockResolvedValue(dbRow);

      await repo.create(input);

      expect(prisma.endpointSchema.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ required: false }),
      });
    });
  });

  // ─── findByEndpointId ─────────────────────────────────────────────────

  describe('findByEndpointId', () => {
    it('should query for rows matching the endpointId', async () => {
      (prisma.endpointSchema.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findByEndpointId(EP_ID);

      expect(prisma.endpointSchema.findMany).toHaveBeenCalledWith({
        where: { endpointId: EP_ID },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return mapped EndpointSchemaRecords', async () => {
      const rows = [
        fakeDbRow({ id: 'r1', schemaUrn: SCHEMA_URN }),
        fakeDbRow({ id: 'r2', schemaUrn: SCHEMA_URN2 }),
      ];
      (prisma.endpointSchema.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await repo.findByEndpointId(EP_ID);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('r1');
      expect(result[1].id).toBe('r2');
      expect(result[0].schemaUrn).toBe(SCHEMA_URN);
      expect(result[1].schemaUrn).toBe(SCHEMA_URN2);
    });

    it('should return empty array when no rows match', async () => {
      (prisma.endpointSchema.findMany as jest.Mock).mockResolvedValue([]);

      const result = await repo.findByEndpointId('unknown-ep');

      expect(result).toEqual([]);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should call findMany with no where clause', async () => {
      (prisma.endpointSchema.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAll();

      expect(prisma.endpointSchema.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should map all rows to EndpointSchemaRecords', async () => {
      const rows = [
        fakeDbRow({ id: 'r1', endpointId: EP_ID }),
        fakeDbRow({ id: 'r2', endpointId: EP_ID2 }),
      ];
      (prisma.endpointSchema.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await repo.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].endpointId).toBe(EP_ID);
      expect(result[1].endpointId).toBe(EP_ID2);
    });

    it('should return empty array when table is empty', async () => {
      (prisma.endpointSchema.findMany as jest.Mock).mockResolvedValue([]);
      expect(await repo.findAll()).toEqual([]);
    });
  });

  // ─── findByEndpointAndUrn ─────────────────────────────────────────────

  describe('findByEndpointAndUrn', () => {
    it('should query by composite unique key', async () => {
      (prisma.endpointSchema.findUnique as jest.Mock).mockResolvedValue(null);

      await repo.findByEndpointAndUrn(EP_ID, SCHEMA_URN);

      expect(prisma.endpointSchema.findUnique).toHaveBeenCalledWith({
        where: { endpointId_schemaUrn: { endpointId: EP_ID, schemaUrn: SCHEMA_URN } },
      });
    });

    it('should return mapped record when found', async () => {
      const dbRow = fakeDbRow({ id: 'found-it' });
      (prisma.endpointSchema.findUnique as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.findByEndpointAndUrn(EP_ID, SCHEMA_URN);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('found-it');
      expect(result!.schemaUrn).toBe(SCHEMA_URN);
    });

    it('should return null when not found', async () => {
      (prisma.endpointSchema.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await repo.findByEndpointAndUrn(EP_ID, 'urn:not:found');

      expect(result).toBeNull();
    });
  });

  // ─── deleteByEndpointAndUrn ───────────────────────────────────────────

  describe('deleteByEndpointAndUrn', () => {
    it('should delete by composite unique key and return true', async () => {
      (prisma.endpointSchema.delete as jest.Mock).mockResolvedValue(fakeDbRow());

      const result = await repo.deleteByEndpointAndUrn(EP_ID, SCHEMA_URN);

      expect(result).toBe(true);
      expect(prisma.endpointSchema.delete).toHaveBeenCalledWith({
        where: { endpointId_schemaUrn: { endpointId: EP_ID, schemaUrn: SCHEMA_URN } },
      });
    });

    it('should return false when Prisma throws (record not found)', async () => {
      (prisma.endpointSchema.delete as jest.Mock).mockRejectedValue(
        new Error('Record not found'),
      );

      const result = await repo.deleteByEndpointAndUrn(EP_ID, 'urn:not:found');

      expect(result).toBe(false);
    });
  });

  // ─── deleteByEndpointId ───────────────────────────────────────────────

  describe('deleteByEndpointId', () => {
    it('should deleteMany by endpointId and return count', async () => {
      (prisma.endpointSchema.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await repo.deleteByEndpointId(EP_ID);

      expect(result).toBe(3);
      expect(prisma.endpointSchema.deleteMany).toHaveBeenCalledWith({
        where: { endpointId: EP_ID },
      });
    });

    it('should return 0 when no rows match', async () => {
      (prisma.endpointSchema.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await repo.deleteByEndpointId('unknown-ep');

      expect(result).toBe(0);
    });
  });

  // ─── toRecord mapping ────────────────────────────────────────────────

  describe('record mapping', () => {
    it('should preserve attributes as-is (JSONB)', async () => {
      const complexAttrs = [
        {
          name: 'department',
          type: 'complex',
          multiValued: false,
          required: true,
          subAttributes: [
            { name: 'code', type: 'string', multiValued: false, required: true },
            { name: 'name', type: 'string', multiValued: false, required: false },
          ],
        },
      ];
      const dbRow = fakeDbRow({ attributes: complexAttrs });
      (prisma.endpointSchema.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create(sampleInput({ attributes: complexAttrs }));

      expect(result.attributes).toEqual(complexAttrs);
    });

    it('should handle empty attributes array', async () => {
      const dbRow = fakeDbRow({ attributes: [] });
      (prisma.endpointSchema.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create(sampleInput({ attributes: [] }));

      expect(result.attributes).toEqual([]);
    });
  });
});
