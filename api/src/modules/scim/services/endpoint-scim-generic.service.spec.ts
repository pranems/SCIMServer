import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EndpointScimGenericService } from './endpoint-scim-generic.service';
import { GENERIC_RESOURCE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimMetadataService } from './scim-metadata.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimResourceType } from '../discovery/scim-schema-registry';
import type { GenericResourceRecord } from '../../../domain/models/generic-resource.model';
import { ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';

describe('EndpointScimGenericService', () => {
  let service: EndpointScimGenericService;

  const endpointId = 'ep-gen-1';
  const baseUrl = 'http://localhost:6000/scim';

  const deviceResourceType: ScimResourceType = {
    id: 'Device',
    name: 'Device',
    endpoint: '/Devices',
    description: 'IoT devices',
    schema: 'urn:ietf:params:scim:schemas:core:2.0:Device',
    schemaExtensions: [],
  };

  const mockGenericRecord: GenericResourceRecord = {
    id: 'rec-1',
    endpointId,
    resourceType: 'Device',
    scimId: 'scim-dev-001',
    externalId: 'ext-001',
    displayName: 'Test Device',
    active: true,
    deletedAt: null,
    rawPayload: JSON.stringify({
      displayName: 'Test Device',
      serialNumber: 'SN-001',
    }),
    meta: JSON.stringify({
      resourceType: 'Device',
      created: '2025-01-01T00:00:00.000Z',
      lastModified: '2025-01-01T00:00:00.000Z',
      location: 'http://localhost:6000/scim/Devices/scim-dev-001',
      version: 'W/"1"',
    }),
    version: 1,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockGenericRepo = {
    create: jest.fn(),
    findByScimId: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByExternalId: jest.fn(),
    findByDisplayName: jest.fn(),
  };

  const mockMetadataService = {
    buildLocation: jest.fn(
      (base: string, resourceType: string, id: string) =>
        `${base}/${resourceType}/${id}`,
    ),
    currentIsoTimestamp: jest.fn(() => '2025-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndpointScimGenericService,
        ScimSchemaRegistry,
        {
          provide: GENERIC_RESOURCE_REPOSITORY,
          useValue: mockGenericRepo,
        },
        {
          provide: ScimMetadataService,
          useValue: mockMetadataService,
        },
        {
          provide: ScimLogger,
          useValue: {
            trace: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            fatal: jest.fn(),
            isEnabled: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<EndpointScimGenericService>(EndpointScimGenericService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── createResource ─────────────────────────────────────────────────

  describe('createResource', () => {
    it('should create a generic resource and return SCIM response', async () => {
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.create.mockResolvedValue(mockGenericRecord);

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Test Device',
        externalId: 'ext-001',
        serialNumber: 'SN-001',
      };

      const result = await service.createResource(
        body,
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
      expect(result.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Device');
      expect(result.meta).toBeDefined();
      expect(mockGenericRepo.create).toHaveBeenCalledTimes(1);
    });

    it('should throw 400 if schemas array is missing core schema', async () => {
      const body = {
        schemas: ['urn:wrong:schema'],
        displayName: 'Test',
      };

      await expect(
        service.createResource(body, baseUrl, endpointId, deviceResourceType),
      ).rejects.toThrow(HttpException);

      try {
        await service.createResource(body, baseUrl, endpointId, deviceResourceType);
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
      }
    });

    it('should throw 409 for duplicate externalId', async () => {
      mockGenericRepo.findByExternalId.mockResolvedValue(mockGenericRecord);

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Duplicate',
        externalId: 'ext-001',
      };

      try {
        await service.createResource(body, baseUrl, endpointId, deviceResourceType);
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });

    it('should allow creating without externalId', async () => {
      mockGenericRepo.create.mockResolvedValue({
        ...mockGenericRecord,
        externalId: null,
      });

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'No Ext ID Device',
      };

      const result = await service.createResource(
        body,
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBeDefined();
      expect(mockGenericRepo.findByExternalId).not.toHaveBeenCalled();
    });
  });

  // ─── getResource ──────────────────────────────────────────────────────

  describe('getResource', () => {
    it('should return a SCIM resource by scimId', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      const result = await service.getResource(
        'scim-dev-001',
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
      expect(result.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Device');
    });

    it('should throw 404 for non-existent resource', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(null);

      try {
        await service.getResource('bad-id', baseUrl, endpointId, deviceResourceType);
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });

    it('should throw 404 for soft-deleted resource', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue({
        ...mockGenericRecord,
        deletedAt: new Date(),
      });

      try {
        await service.getResource('scim-dev-001', baseUrl, endpointId, deviceResourceType);
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });
  });

  // ─── listResources ────────────────────────────────────────────────────

  describe('listResources', () => {
    it('should return a ListResponse with resources', async () => {
      mockGenericRepo.findAll.mockResolvedValue([mockGenericRecord]);

      const result = await service.listResources(
        {},
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(result.totalResults).toBe(1);
      expect(result.Resources).toHaveLength(1);
    });

    it('should return empty list when no resources exist', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      const result = await service.listResources(
        {},
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.totalResults).toBe(0);
      expect(result.Resources).toHaveLength(0);
    });

    it('should apply startIndex and count pagination', async () => {
      const records = Array.from({ length: 5 }, (_, i) => ({
        ...mockGenericRecord,
        id: `rec-${i}`,
        scimId: `scim-${i}`,
      }));
      mockGenericRepo.findAll.mockResolvedValue(records);

      const result = await service.listResources(
        { startIndex: 2, count: 2 },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.startIndex).toBe(2);
      expect(result.Resources).toHaveLength(2);
    });
  });

  // ─── replaceResource ─────────────────────────────────────────────────

  describe('replaceResource', () => {
    it('should replace a resource and return updated SCIM response', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        displayName: 'Updated Device',
        rawPayload: JSON.stringify({ displayName: 'Updated Device' }),
        version: 2,
      });

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Updated Device',
      };

      const result = await service.replaceResource(
        'scim-dev-001',
        body,
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
      expect(mockGenericRepo.update).toHaveBeenCalledTimes(1);
    });

    it('should throw 404 for non-existent resource on replace', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(null);

      try {
        await service.replaceResource(
          'bad-id',
          { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'] },
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });
  });

  // ─── patchResource ───────────────────────────────────────────────────

  describe('patchResource', () => {
    it('should apply PATCH operations and return updated resource', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        displayName: 'Patched Device',
        rawPayload: JSON.stringify({
          displayName: 'Patched Device',
          serialNumber: 'SN-001',
        }),
        version: 2,
      });

      const patchBody = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'displayName', value: 'Patched Device' },
        ],
      };

      const result = await service.patchResource(
        'scim-dev-001',
        patchBody,
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
      expect(mockGenericRepo.update).toHaveBeenCalledTimes(1);
    });

    it('should throw 400 for missing PatchOp schema', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      const patchBody = {
        schemas: ['wrong:schema'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'test' }],
      };

      try {
        await service.patchResource(
          'scim-dev-001',
          patchBody,
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 400');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
      }
    });

    it('should throw 404 for non-existent resource on patch', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(null);

      const patchBody = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'test' }],
      };

      try {
        await service.patchResource(
          'bad-id',
          patchBody,
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });

    it('should return 400 for invalid PATCH operation', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      const patchBody = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'invalid_op', path: 'x', value: 'y' }],
      };

      try {
        await service.patchResource(
          'scim-dev-001',
          patchBody,
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 400');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
      }
    });
  });

  // ─── deleteResource ──────────────────────────────────────────────────

  describe('deleteResource', () => {
    it('should hard-delete a resource by default', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.delete.mockResolvedValue(undefined);

      await service.deleteResource(
        'scim-dev-001',
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.delete).toHaveBeenCalledWith(mockGenericRecord.id);
    });

    it('should soft-delete when SoftDeleteEnabled is true', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        deletedAt: new Date(),
      });

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: 'True',
      };

      await service.deleteResource(
        'scim-dev-001',
        endpointId,
        deviceResourceType,
        config,
      );

      expect(mockGenericRepo.update).toHaveBeenCalledWith(
        mockGenericRecord.id,
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      );
    });

    it('should throw 404 for non-existent resource on delete', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(null);

      try {
        await service.deleteResource('bad-id', endpointId, deviceResourceType);
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });
  });
});
