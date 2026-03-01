import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AdminResourceTypeController } from './admin-resource-type.controller';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import { ENDPOINT_RESOURCE_TYPE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { InMemoryEndpointResourceTypeRepository } from '../../../infrastructure/repositories/inmemory/inmemory-endpoint-resource-type.repository';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import type { CreateEndpointResourceTypeDto } from '../dto/create-endpoint-resource-type.dto';

describe('AdminResourceTypeController', () => {
  let controller: AdminResourceTypeController;
  let registry: ScimSchemaRegistry;
  let mockEndpointService: { getEndpoint: jest.Mock };

  const endpointId = 'ep-test-1';
  const mockEndpoint = {
    id: endpointId,
    name: 'test',
    active: true,
    config: { CustomResourceTypesEnabled: 'True' },
    scimEndpoint: '/scim/endpoints/' + endpointId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockEndpointDisabled = {
    id: endpointId,
    name: 'test',
    active: true,
    config: null,
    scimEndpoint: '/scim/endpoints/' + endpointId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const sampleDto: CreateEndpointResourceTypeDto = {
    name: 'Device',
    description: 'IoT devices',
    schemaUri: 'urn:ietf:params:scim:schemas:core:2.0:Device',
    endpoint: '/Devices',
    schemaExtensions: [
      { schema: 'urn:example:ext:device:2.0', required: false },
    ],
  };

  beforeEach(async () => {
    mockEndpointService = {
      getEndpoint: jest.fn().mockResolvedValue(mockEndpoint),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminResourceTypeController],
      providers: [
        {
          provide: ENDPOINT_RESOURCE_TYPE_REPOSITORY,
          useClass: InMemoryEndpointResourceTypeRepository,
        },
        ScimSchemaRegistry,
        { provide: EndpointService, useValue: mockEndpointService },
      ],
    }).compile();

    controller = module.get<AdminResourceTypeController>(AdminResourceTypeController);
    registry = module.get<ScimSchemaRegistry>(ScimSchemaRegistry);
  });

  // ─── POST /admin/endpoints/:endpointId/resource-types ─────────────

  describe('POST :endpointId/resource-types', () => {
    it('should register a custom resource type and return the record', async () => {
      const result = await controller.registerResourceType(endpointId, sampleDto);

      expect(result.id).toBeDefined();
      expect(result.endpointId).toBe(endpointId);
      expect(result.name).toBe('Device');
      expect(result.description).toBe('IoT devices');
      expect(result.schemaUri).toBe(sampleDto.schemaUri);
      expect(result.endpoint).toBe('/Devices');
      expect(result.schemaExtensions).toEqual([
        { schema: 'urn:example:ext:device:2.0', required: false },
      ]);
      expect(result.active).toBe(true);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should hydrate the resource type into the in-memory registry', async () => {
      await controller.registerResourceType(endpointId, sampleDto);

      const customTypes = registry.getCustomResourceTypes(endpointId);
      expect(customTypes).toHaveLength(1);
      expect(customTypes[0].id).toBe('Device');
      expect(customTypes[0].endpoint).toBe('/Devices');
    });

    it('should throw NotFoundException for unknown endpoint', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(new NotFoundException('Not found'));

      await expect(
        controller.registerResourceType('unknown', sampleDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when CustomResourceTypesEnabled is not set', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpointDisabled);

      await expect(
        controller.registerResourceType(endpointId, sampleDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for reserved name "User"', async () => {
      await expect(
        controller.registerResourceType(endpointId, { ...sampleDto, name: 'User' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for reserved name "Group"', async () => {
      await expect(
        controller.registerResourceType(endpointId, { ...sampleDto, name: 'Group' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for reserved endpoint path /Users', async () => {
      await expect(
        controller.registerResourceType(endpointId, {
          ...sampleDto,
          name: 'CustomType',
          endpoint: '/Users',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for reserved endpoint path /Schemas', async () => {
      await expect(
        controller.registerResourceType(endpointId, {
          ...sampleDto,
          name: 'CustomType',
          endpoint: '/Schemas',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException for duplicate name', async () => {
      await controller.registerResourceType(endpointId, sampleDto);

      await expect(
        controller.registerResourceType(endpointId, sampleDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow registration without schemaExtensions', async () => {
      const dto: CreateEndpointResourceTypeDto = {
        name: 'Application',
        schemaUri: 'urn:example:app:2.0',
        endpoint: '/Applications',
      };
      const result = await controller.registerResourceType(endpointId, dto);

      expect(result.name).toBe('Application');
      expect(result.schemaExtensions).toEqual([]);
    });

    it('should allow registration without description (defaults to description with name)', async () => {
      const dto: CreateEndpointResourceTypeDto = {
        name: 'Printer',
        schemaUri: 'urn:example:printer:2.0',
        endpoint: '/Printers',
      };
      const result = await controller.registerResourceType(endpointId, dto);

      expect(result.name).toBe('Printer');
      // description is null if not provided
      expect(result.description).toBeNull();
    });
  });

  // ─── GET /admin/endpoints/:endpointId/resource-types ──────────────

  describe('GET :endpointId/resource-types', () => {
    it('should list all custom resource types for an endpoint', async () => {
      await controller.registerResourceType(endpointId, sampleDto);
      await controller.registerResourceType(endpointId, {
        ...sampleDto,
        name: 'Application',
        schemaUri: 'urn:example:app:2.0',
        endpoint: '/Applications',
      });

      const result = await controller.listResourceTypes(endpointId);

      expect(result.totalResults).toBe(2);
      expect(result.resourceTypes).toHaveLength(2);
    });

    it('should return empty list for endpoint with no custom types', async () => {
      const result = await controller.listResourceTypes(endpointId);
      expect(result.totalResults).toBe(0);
      expect(result.resourceTypes).toEqual([]);
    });

    it('should throw NotFoundException for unknown endpoint', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(new NotFoundException('Not found'));
      await expect(controller.listResourceTypes('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── GET /admin/endpoints/:endpointId/resource-types/:name ────────

  describe('GET :endpointId/resource-types/:name', () => {
    it('should return a specific resource type by name', async () => {
      await controller.registerResourceType(endpointId, sampleDto);

      const result = await controller.getResourceType(endpointId, 'Device');
      expect(result.name).toBe('Device');
      expect(result.schemaUri).toBe(sampleDto.schemaUri);
    });

    it('should throw NotFoundException for non-existent name', async () => {
      await expect(
        controller.getResourceType(endpointId, 'NonExistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DELETE /admin/endpoints/:endpointId/resource-types/:name ─────

  describe('DELETE :endpointId/resource-types/:name', () => {
    it('should remove the resource type and return 204', async () => {
      await controller.registerResourceType(endpointId, sampleDto);

      await controller.removeResourceType(endpointId, 'Device');

      // Verify removed from repository
      const list = await controller.listResourceTypes(endpointId);
      expect(list.totalResults).toBe(0);
    });

    it('should remove from the in-memory registry', async () => {
      await controller.registerResourceType(endpointId, sampleDto);
      await controller.removeResourceType(endpointId, 'Device');

      const customTypes = registry.getCustomResourceTypes(endpointId);
      expect(customTypes).toHaveLength(0);
    });

    it('should throw BadRequestException for reserved built-in name "User"', async () => {
      await expect(
        controller.removeResourceType(endpointId, 'User'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent resource type', async () => {
      await expect(
        controller.removeResourceType(endpointId, 'NonExistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
