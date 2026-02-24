import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminSchemaController } from './admin-schema.controller';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import { ENDPOINT_SCHEMA_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { InMemoryEndpointSchemaRepository } from '../../../infrastructure/repositories/inmemory/inmemory-endpoint-schema.repository';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEndpointSchemaDto } from '../dto/create-endpoint-schema.dto';

describe('AdminSchemaController', () => {
  let controller: AdminSchemaController;
  let registry: ScimSchemaRegistry;
  let mockPrisma: { endpoint: { findUnique: jest.Mock } };

  const endpointId = 'ep-test-1';
  const mockEndpoint = { id: endpointId, name: 'test', active: true };

  const sampleDto: CreateEndpointSchemaDto = {
    schemaUrn: 'urn:ietf:params:scim:schemas:extension:custom:2.0:User',
    name: 'Custom Extension',
    description: 'A custom extension for testing',
    resourceTypeId: 'User',
    required: false,
    attributes: [
      {
        name: 'badgeNumber',
        type: 'string',
        multiValued: false,
        required: false,
        description: 'Employee badge number',
      },
    ],
  };

  beforeEach(async () => {
    mockPrisma = {
      endpoint: {
        findUnique: jest.fn().mockResolvedValue(mockEndpoint),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSchemaController],
      providers: [
        {
          provide: ENDPOINT_SCHEMA_REPOSITORY,
          useClass: InMemoryEndpointSchemaRepository,
        },
        ScimSchemaRegistry,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<AdminSchemaController>(AdminSchemaController);
    registry = module.get<ScimSchemaRegistry>(ScimSchemaRegistry);
  });

  // ─── POST /admin/endpoints/:endpointId/schemas ─────────────────────

  describe('POST :endpointId/schemas', () => {
    it('should register a schema extension and return the record', async () => {
      const result = await controller.registerSchema(endpointId, sampleDto);

      expect(result.id).toBeDefined();
      expect(result.endpointId).toBe(endpointId);
      expect(result.schemaUrn).toBe(sampleDto.schemaUrn);
      expect(result.name).toBe(sampleDto.name);
      expect(result.description).toBe(sampleDto.description);
      expect(result.resourceTypeId).toBe(sampleDto.resourceTypeId);
      expect(result.required).toBe(false);
      expect(result.attributes).toEqual(sampleDto.attributes);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should hydrate the in-memory registry', async () => {
      await controller.registerSchema(endpointId, sampleDto);

      // Registry should now have the extension for this endpoint
      const schemas = registry.getAllSchemas(endpointId);
      const custom = schemas.find((s) => s.id === sampleDto.schemaUrn);
      expect(custom).toBeDefined();
      expect(custom!.name).toBe(sampleDto.name);
    });

    it('should throw NotFoundException for unknown endpoint', async () => {
      mockPrisma.endpoint.findUnique.mockResolvedValue(null);

      await expect(
        controller.registerSchema('unknown', sampleDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException for duplicate registration', async () => {
      await controller.registerSchema(endpointId, sampleDto);

      await expect(
        controller.registerSchema(endpointId, sampleDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── GET /admin/endpoints/:endpointId/schemas ──────────────────────

  describe('GET :endpointId/schemas', () => {
    it('should list all schemas for an endpoint', async () => {
      await controller.registerSchema(endpointId, sampleDto);
      await controller.registerSchema(endpointId, {
        ...sampleDto,
        schemaUrn: 'urn:test:second',
        name: 'Second',
      });

      const result = await controller.listSchemas(endpointId);

      expect(result.totalResults).toBe(2);
      expect(result.schemas).toHaveLength(2);
    });

    it('should return empty list for endpoint with no schemas', async () => {
      const result = await controller.listSchemas(endpointId);
      expect(result.totalResults).toBe(0);
      expect(result.schemas).toEqual([]);
    });

    it('should throw NotFoundException for unknown endpoint', async () => {
      mockPrisma.endpoint.findUnique.mockResolvedValue(null);

      await expect(controller.listSchemas('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── GET /admin/endpoints/:endpointId/schemas/:urn ──────────────────

  describe('GET :endpointId/schemas/:urn', () => {
    it('should return a specific schema by URN', async () => {
      await controller.registerSchema(endpointId, sampleDto);

      const result = await controller.getSchema(endpointId, sampleDto.schemaUrn);
      expect(result.schemaUrn).toBe(sampleDto.schemaUrn);
      expect(result.name).toBe(sampleDto.name);
    });

    it('should throw NotFoundException for non-existent URN', async () => {
      await expect(
        controller.getSchema(endpointId, 'urn:not:found'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DELETE /admin/endpoints/:endpointId/schemas/:urn ───────────────

  describe('DELETE :endpointId/schemas/:urn', () => {
    it('should remove the schema and return 204', async () => {
      await controller.registerSchema(endpointId, sampleDto);

      await controller.removeSchema(endpointId, sampleDto.schemaUrn);

      // Verify removed from repository
      const list = await controller.listSchemas(endpointId);
      expect(list.totalResults).toBe(0);
    });

    it('should remove from the in-memory registry', async () => {
      await controller.registerSchema(endpointId, sampleDto);
      await controller.removeSchema(endpointId, sampleDto.schemaUrn);

      const schemas = registry.getAllSchemas(endpointId);
      const custom = schemas.find((s) => s.id === sampleDto.schemaUrn);
      expect(custom).toBeUndefined();
    });

    it('should throw NotFoundException for non-existent URN', async () => {
      await expect(
        controller.removeSchema(endpointId, 'urn:not:found'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
