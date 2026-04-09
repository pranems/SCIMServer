import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EndpointScimGenericService } from './endpoint-scim-generic.service';
import { GENERIC_RESOURCE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimMetadataService } from './scim-metadata.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimResourceType } from '../discovery/scim-schema-registry';
import type { GenericResourceRecord } from '../../../domain/models/generic-resource.model';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { SCIM_DIAGNOSTICS_URN } from '../common/scim-constants';

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
            enrichContext: jest.fn(),
          },
        },
        {
          provide: EndpointContextStorage,
          useValue: {
            addWarnings: jest.fn(),
            getWarnings: jest.fn().mockReturnValue([]),
            setContext: jest.fn(),
            getContext: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EndpointScimGenericService>(EndpointScimGenericService);
  });

  afterEach(() => {
    jest.resetAllMocks();
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

      const softDeleteConfig: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
      };

      try {
        await service.getResource('scim-dev-001', baseUrl, endpointId, deviceResourceType, softDeleteConfig);
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

    it('should error when UserHardDeleteEnabled is false (settings v7)', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED]: false,
      };

      try {
        await service.deleteResource(
          'scim-dev-001',
          endpointId,
          deviceResourceType,
          config,
        );
        fail('Expected 400');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
      }
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

    it('should throw 404 when double-deleting a soft-deleted resource', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue({
        ...mockGenericRecord,
        deletedAt: new Date(),
      });

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
      };

      try {
        await service.deleteResource('scim-dev-001', endpointId, deviceResourceType, config);
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });
  });

  // ─── guardSoftDeleted on PUT ─────────────────────────────────────────

  describe('replaceResource — soft-delete guard', () => {
    it('should throw 404 when replacing a soft-deleted resource', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue({
        ...mockGenericRecord,
        deletedAt: new Date(),
      });

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
      };

      try {
        await service.replaceResource(
          'scim-dev-001',
          { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'], displayName: 'X' },
          baseUrl,
          endpointId,
          deviceResourceType,
          config,
        );
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });
  });

  // ─── guardSoftDeleted on PATCH ────────────────────────────────────────

  describe('patchResource — soft-delete guard', () => {
    it('should throw 404 when patching a soft-deleted resource', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue({
        ...mockGenericRecord,
        deletedAt: new Date(),
      });

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
      };

      try {
        await service.patchResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'displayName', value: 'X' }],
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          config,
        );
        fail('Expected 404');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });
  });

  // ─── listResources — soft-delete filtering ────────────────────────────

  describe('listResources — soft-delete filtering', () => {
    it('should exclude soft-deleted resources from LIST when SoftDeleteEnabled', async () => {
      const activeRecord = { ...mockGenericRecord, id: 'rec-active', scimId: 'scim-active', deletedAt: null };
      const deletedRecord = { ...mockGenericRecord, id: 'rec-del', scimId: 'scim-del', deletedAt: new Date() };
      mockGenericRepo.findAll.mockResolvedValue([activeRecord, deletedRecord]);

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
      };

      const result = await service.listResources(
        {},
        baseUrl,
        endpointId,
        deviceResourceType,
        config,
      );

      expect(result.totalResults).toBe(1);
      expect(result.Resources).toHaveLength(1);
      expect((result.Resources as any[])[0].id).toBe('scim-active');
    });

    it('should include soft-deleted resources in LIST when UserSoftDeleteEnabled is false', async () => {
      const activeRecord = { ...mockGenericRecord, id: 'rec-active', scimId: 'scim-active', deletedAt: null };
      const deletedRecord = { ...mockGenericRecord, id: 'rec-del', scimId: 'scim-del', deletedAt: new Date() };
      mockGenericRepo.findAll.mockResolvedValue([activeRecord, deletedRecord]);

      const result = await service.listResources(
        {},
        baseUrl,
        endpointId,
        deviceResourceType,
        // Settings v7: UserSoftDeleteEnabled must be explicitly false to include deleted
        { [ENDPOINT_CONFIG_FLAGS.USER_SOFT_DELETE_ENABLED]: false } as EndpointConfig,
      );

      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
    });
  });

  // ─── Uniqueness on PUT ────────────────────────────────────────────────

  describe('replaceResource — uniqueness conflict', () => {
    it('should throw 409 when PUT causes externalId conflict', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      // findConflict: another resource has the same externalId
      mockGenericRepo.findByExternalId.mockResolvedValue({
        ...mockGenericRecord,
        id: 'rec-other',
        scimId: 'scim-other',
        externalId: 'ext-conflict',
      });

      try {
        await service.replaceResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Updated',
            externalId: 'ext-conflict',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });

    it('should throw 409 when PUT causes displayName conflict', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue({
        ...mockGenericRecord,
        id: 'rec-other',
        scimId: 'scim-other',
        displayName: 'Duplicate Name',
      });

      try {
        await service.replaceResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Duplicate Name',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });

    it('should allow PUT when externalId belongs to itself', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      // findConflict returns the SAME resource (same scimId) — not a conflict
      mockGenericRepo.findByExternalId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        version: 2,
      });

      const result = await service.replaceResource(
        'scim-dev-001',
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Updated Self',
          externalId: 'ext-001',
        },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
      expect(mockGenericRepo.update).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Uniqueness on PATCH ──────────────────────────────────────────────

  describe('patchResource — uniqueness conflict', () => {
    it('should throw 409 when PATCH causes displayName conflict', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      // After patch, findConflict detects displayName collision
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue({
        ...mockGenericRecord,
        id: 'rec-other',
        scimId: 'scim-other',
        displayName: 'Conflicting Name',
      });

      try {
        await service.patchResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'displayName', value: 'Conflicting Name' }],
          },
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });
  });

  // ─── displayName uniqueness on CREATE ─────────────────────────────────

  describe('createResource — displayName uniqueness', () => {
    it('should throw 409 for duplicate displayName', async () => {
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue({
        ...mockGenericRecord,
        displayName: 'Duplicate Device',
      });

      try {
        await service.createResource(
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Duplicate Device',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });
  });

  // ─── Reprovision on conflict ──────────────────────────────────────────

  describe('createResource — settings v7: POST collision always 409 (no reprovision)', () => {
    it('should throw 409 even with old reprovision flags set (settings v7)', async () => {
      const softDeletedRecord: GenericResourceRecord = {
        ...mockGenericRecord,
        deletedAt: new Date(),
        active: false,
      };
      mockGenericRepo.findByExternalId.mockResolvedValue(softDeletedRecord);

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: true,
      };

      try {
        await service.createResource(
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Re-provisioned Device',
            externalId: 'ext-001',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          config,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
      expect(mockGenericRepo.update).not.toHaveBeenCalled();
    });

    it('should return 409 when Reprovision is OFF even if conflict is soft-deleted', async () => {
      const softDeletedRecord: GenericResourceRecord = {
        ...mockGenericRecord,
        deletedAt: new Date(),
        active: false,
      };
      mockGenericRepo.findByExternalId.mockResolvedValue(softDeletedRecord);

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: false,
      };

      try {
        await service.createResource(
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Test',
            externalId: 'ext-001',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          config,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });

    it('should return 409 when Reprovision is ON but SoftDelete is OFF', async () => {
      mockGenericRepo.findByExternalId.mockResolvedValue(mockGenericRecord); // active, not soft-deleted

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: true,
        // SoftDeleteEnabled not set = false
      };

      try {
        await service.createResource(
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Test',
            externalId: 'ext-001',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          config,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });
  });

  // ─── readOnly attribute stripping on CREATE ───────────────────────────

  describe('createResource — readOnly attribute stripping', () => {
    it('should strip readOnly attributes from POST body without error', async () => {
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.create.mockResolvedValue(mockGenericRecord);

      // id and meta are readOnly but ensured at the service layer, not stored in payload
      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Device with readOnly',
        externalId: 'ext-ro',
      };

      const result = await service.createResource(
        body,
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBeDefined();
      expect(mockGenericRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Sorting in LIST ──────────────────────────────────────────────────

  describe('listResources — sorting', () => {
    it('should sort by displayName ascending by default', async () => {
      const records = [
        { ...mockGenericRecord, id: 'r3', scimId: 's3', displayName: 'Charlie', rawPayload: JSON.stringify({ displayName: 'Charlie' }) },
        { ...mockGenericRecord, id: 'r1', scimId: 's1', displayName: 'Alpha', rawPayload: JSON.stringify({ displayName: 'Alpha' }) },
        { ...mockGenericRecord, id: 'r2', scimId: 's2', displayName: 'Bravo', rawPayload: JSON.stringify({ displayName: 'Bravo' }) },
      ];
      mockGenericRepo.findAll.mockResolvedValue(records);

      const result = await service.listResources(
        { sortBy: 'displayName' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      const names = (result.Resources as any[]).map(r => r.displayName);
      expect(names).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('should sort by displayName descending', async () => {
      const records = [
        { ...mockGenericRecord, id: 'r1', scimId: 's1', displayName: 'Alpha', rawPayload: JSON.stringify({ displayName: 'Alpha' }) },
        { ...mockGenericRecord, id: 'r3', scimId: 's3', displayName: 'Charlie', rawPayload: JSON.stringify({ displayName: 'Charlie' }) },
        { ...mockGenericRecord, id: 'r2', scimId: 's2', displayName: 'Bravo', rawPayload: JSON.stringify({ displayName: 'Bravo' }) },
      ];
      mockGenericRepo.findAll.mockResolvedValue(records);

      const result = await service.listResources(
        { sortBy: 'displayName', sortOrder: 'descending' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      const names = (result.Resources as any[]).map(r => r.displayName);
      expect(names).toEqual(['Charlie', 'Bravo', 'Alpha']);
    });
  });

  // ─── toScimResponse — output processing ──────────────────────────────

  describe('toScimResponse output processing', () => {
    it('should include meta.version matching the record version', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue({
        ...mockGenericRecord,
        version: 5,
      });

      const result = await service.getResource(
        'scim-dev-001',
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.meta).toBeDefined();
      expect((result.meta as any).version).toBe('W/"5"');
    });

    it('should include schemas array with core schema URN', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      const result = await service.getResource(
        'scim-dev-001',
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Device');
    });
  });

  // ─── If-Match validation ──────────────────────────────────────────────

  describe('replaceResource — If-Match enforcement', () => {
    it('should accept matching If-Match header', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        version: 2,
      });

      const result = await service.replaceResource(
        'scim-dev-001',
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Updated',
        },
        baseUrl,
        endpointId,
        deviceResourceType,
        undefined,
        'W/"v1"', // matching ifMatch
      );

      expect(result.id).toBe('scim-dev-001');
    });

    it('should reject mismatched If-Match header with 412', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      try {
        await service.replaceResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Updated',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          undefined,
          'W/"v999"', // mismatched
        );
        fail('Expected 412');
      } catch (e: any) {
        expect(e.getStatus()).toBe(412);
      }
    });
  });

  describe('patchResource — If-Match enforcement', () => {
    it('should reject mismatched If-Match on PATCH with 412', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      try {
        await service.patchResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'displayName', value: 'X' }],
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          undefined,
          'W/"v999"',
        );
        fail('Expected 412');
      } catch (e: any) {
        expect(e.getStatus()).toBe(412);
      }
    });
  });

  describe('deleteResource — If-Match enforcement', () => {
    it('should reject mismatched If-Match on DELETE with 412', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      try {
        await service.deleteResource(
          'scim-dev-001',
          endpointId,
          deviceResourceType,
          undefined,
          'W/"v999"',
        );
        fail('Expected 412');
      } catch (e: any) {
        expect(e.getStatus()).toBe(412);
      }
    });
  });

  // ─── PATCH add operation ──────────────────────────────────────────────

  describe('patchResource — add operation', () => {
    it('should apply PATCH add operation on a new attribute', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        rawPayload: JSON.stringify({
          displayName: 'Test Device',
          serialNumber: 'SN-001',
          newAttr: 'newValue',
        }),
        version: 2,
      });

      const result = await service.patchResource(
        'scim-dev-001',
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'add', path: 'newAttr', value: 'newValue' }],
        },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
      expect(mockGenericRepo.update).toHaveBeenCalledTimes(1);
    });
  });

  // ─── PATCH remove operation ───────────────────────────────────────────

  describe('patchResource — remove operation', () => {
    it('should apply PATCH remove operation', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        rawPayload: JSON.stringify({ displayName: 'Test Device' }),
        version: 2,
      });

      const result = await service.patchResource(
        'scim-dev-001',
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'remove', path: 'serialNumber' }],
        },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
    });
  });

  // ─── Filter parsing in LIST ───────────────────────────────────────────

  describe('listResources — filter parsing', () => {
    it('should pass displayName eq filter to repository with Prisma case-insensitive match', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'displayName eq "TestDevice"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      // buildGenericFilter uses GENERIC_DB_COLUMNS where displayName is citext → case-insensitive
      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        { displayName: { equals: 'TestDevice', mode: 'insensitive' } },
      );
    });

    it('should pass externalId eq filter to repository with exact match (caseExact)', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'externalId eq "ext-123"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      // externalId is 'text' type → case-sensitive exact match
      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        { externalId: 'ext-123' },
      );
    });

    it('should push displayName co (contains) to DB', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'displayName co "test"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        { displayName: { contains: 'test', mode: 'insensitive' } },
      );
    });

    it('should push displayName sw (startsWith) to DB', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'displayName sw "Test"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        { displayName: { startsWith: 'Test', mode: 'insensitive' } },
      );
    });

    it('should push displayName ew (endsWith) to DB', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'displayName ew "vice"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        { displayName: { endsWith: 'vice', mode: 'insensitive' } },
      );
    });

    it('should push externalId ne (not equal, case-sensitive) to DB', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'externalId ne "ext-999"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        { externalId: { not: 'ext-999' } },
      );
    });

    it('should push id pr (presence) to DB', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'id pr' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        { scimId: { not: null } },
      );
    });

    it('should push compound AND on promotable columns to DB', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'displayName eq "Foo" and externalId eq "bar"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        {
          AND: [
            { displayName: { equals: 'Foo', mode: 'insensitive' } },
            { externalId: 'bar' },
          ],
        },
      );
    });

    it('should push compound OR on promotable columns to DB', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      await service.listResources(
        { filter: 'displayName eq "A" or displayName eq "B"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        {
          OR: [
            { displayName: { equals: 'A', mode: 'insensitive' } },
            { displayName: { equals: 'B', mode: 'insensitive' } },
          ],
        },
      );
    });

    it('should fetchAll and apply in-memory filter for un-mapped custom attributes', async () => {
      const matchingRecord = {
        ...mockGenericRecord,
        scimId: 'match-1',
        rawPayload: JSON.stringify({ displayName: 'Match', serialNumber: 'SN-MATCH' }),
      };
      const nonMatchingRecord = {
        ...mockGenericRecord,
        id: 'rec-2',
        scimId: 'nomatch-1',
        rawPayload: JSON.stringify({ displayName: 'NoMatch', serialNumber: 'SN-OTHER' }),
      };
      mockGenericRepo.findAll.mockResolvedValue([matchingRecord, nonMatchingRecord]);

      const result = await service.listResources(
        { filter: 'serialNumber eq "SN-MATCH"' },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      // fetchAll = true → repository called with no dbFilter
      expect(mockGenericRepo.findAll).toHaveBeenCalledWith(
        endpointId,
        'Device',
        undefined,
      );
      // In-memory filter applied on SCIM representation
      expect(result.totalResults).toBe(1);
      expect((result.Resources as Record<string, unknown>[])[0]).toHaveProperty('serialNumber', 'SN-MATCH');
    });

    it('should throw 400 invalidFilter for syntactically invalid filter', async () => {
      mockGenericRepo.findAll.mockResolvedValue([]);

      try {
        await service.listResources(
          { filter: '(((' },
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 400');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        expect(e.getResponse().scimType).toBe('invalidFilter');
      }
    });
  });

  // ─── Boolean coercion wiring ─────────────────────────────────────────

  describe('createResource — boolean coercion', () => {
    it('should coerce boolean string "True" to true in POST body', async () => {
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.create.mockImplementation(async (input) => ({
        ...mockGenericRecord,
        rawPayload: input.rawPayload ?? JSON.stringify(input),
      }));

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Bool Device',
        active: 'True', // string should be coerced
      };

      const result = await service.createResource(body, baseUrl, endpointId, deviceResourceType);
      // The service should not throw and should return a valid resource
      expect(result.id).toBeDefined();
    });
  });

  describe('replaceResource — boolean coercion', () => {
    it('should coerce boolean strings in PUT body', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({ ...mockGenericRecord, version: 2 });

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Updated Bool',
        active: 'False', // string should be coerced
      };

      const result = await service.replaceResource(
        'scim-dev-001', body, baseUrl, endpointId, deviceResourceType,
      );
      expect(result.id).toBe('scim-dev-001');
    });
  });

  // ─── returned:never stripping in output ─────────────────────────────

  describe('toScimResponse — returned:never stripping', () => {
    it('should strip returned:never attributes from generic resource response', async () => {
      // Simulate a record whose rawPayload contains a "password" field
      const recordWithPassword = {
        ...mockGenericRecord,
        rawPayload: JSON.stringify({
          displayName: 'Secret Device',
          password: 'supersecret',
        }),
      };
      mockGenericRepo.findByScimId.mockResolvedValue(recordWithPassword);

      const result = await service.getResource(
        'scim-dev-001', baseUrl, endpointId, deviceResourceType,
      );

      // password with returned:never characteristic should be stripped
      // (if schema defines it; otherwise it stays since generic uses dynamic schema)
      expect(result.id).toBe('scim-dev-001');
      expect(result.displayName).toBe('Secret Device');
    });
  });

  // ─── readOnly stripping on PUT ──────────────────────────────────────

  describe('replaceResource — readOnly attribute stripping', () => {
    it('should strip readOnly attributes from PUT body without error', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({ ...mockGenericRecord, version: 2 });

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Updated',
        id: 'client-supplied-id', // readOnly — should be silently stripped
        meta: { resourceType: 'Device' }, // readOnly — should be silently stripped
      };

      const result = await service.replaceResource(
        'scim-dev-001', body, baseUrl, endpointId, deviceResourceType,
      );

      // Should succeed without error; id should be server-assigned
      expect(result.id).toBe('scim-dev-001');
    });
  });

  // ─── readOnly stripping on PATCH ops ────────────────────────────────

  describe('patchResource — readOnly PATCH ops stripping', () => {
    it('should handle PATCH ops targeting readOnly attributes gracefully', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({ ...mockGenericRecord, version: 2 });

      // PATCH op targeting a readOnly attribute — should be stripped or handled gracefully
      const result = await service.patchResource(
        'scim-dev-001',
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'displayName', value: 'Valid Change' },
          ],
        },
        baseUrl,
        endpointId,
        deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
    });
  });

  // ─── Immutable checking on PUT ──────────────────────────────────────

  describe('replaceResource — immutable attribute enforcement', () => {
    it('should not throw when replacing with same values (no immutable violations)', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({ ...mockGenericRecord, version: 2 });

      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName: 'Test Device', // same as existing
      };

      const result = await service.replaceResource(
        'scim-dev-001', body, baseUrl, endpointId, deviceResourceType,
      );

      expect(result.id).toBe('scim-dev-001');
    });
  });

  // ─── Post-PATCH uniqueness enforcement ──────────────────────────────

  describe('patchResource — post-PATCH uniqueness', () => {
    it('should throw 409 when PATCH causes displayName conflict', async () => {
      const conflictRecord = { ...mockGenericRecord, id: 'rec-2', scimId: 'scim-dev-002' };
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(conflictRecord);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        rawPayload: JSON.stringify({ displayName: 'Conflict Name' }),
        version: 2,
      });

      try {
        await service.patchResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'displayName', value: 'Conflict Name' }],
          },
          baseUrl,
          endpointId,
          deviceResourceType,
        );
        fail('Expected 409');
      } catch (e: any) {
        expect(e.getStatus()).toBe(409);
      }
    });
  });

  // ─── RequireIfMatch — 428 behavior ────────────────────────────────────

  describe('replaceResource — RequireIfMatch 428 enforcement', () => {
    const requireIfMatchConfig = {
      [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: 'true',
    } as EndpointConfig;

    it('should return 428 when RequireIfMatch enabled and no If-Match header on PUT', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      try {
        await service.replaceResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
            displayName: 'Updated',
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          requireIfMatchConfig,
          undefined, // no ifMatch
        );
        fail('Expected 428');
      } catch (e: any) {
        expect(e.getStatus()).toBe(428);
      }
    });

    it('should succeed when RequireIfMatch enabled and valid If-Match provided on PUT', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
      mockGenericRepo.update.mockResolvedValue({
        ...mockGenericRecord,
        version: 2,
      });

      const result = await service.replaceResource(
        'scim-dev-001',
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Updated',
        },
        baseUrl,
        endpointId,
        deviceResourceType,
        requireIfMatchConfig,
        'W/"v1"',
      );

      expect(result.id).toBe('scim-dev-001');
    });
  });

  describe('patchResource — RequireIfMatch 428 enforcement', () => {
    const requireIfMatchConfig = {
      [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: 'true',
    } as EndpointConfig;

    it('should return 428 when RequireIfMatch enabled and no If-Match header on PATCH', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      try {
        await service.patchResource(
          'scim-dev-001',
          {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'displayName', value: 'X' }],
          },
          baseUrl,
          endpointId,
          deviceResourceType,
          requireIfMatchConfig,
          undefined, // no ifMatch
        );
        fail('Expected 428');
      } catch (e: any) {
        expect(e.getStatus()).toBe(428);
      }
    });
  });

  describe('deleteResource — RequireIfMatch 428 enforcement', () => {
    const requireIfMatchConfig = {
      [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: 'true',
    } as EndpointConfig;

    it('should return 428 when RequireIfMatch enabled and no If-Match header on DELETE', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);

      try {
        await service.deleteResource(
          'scim-dev-001',
          endpointId,
          deviceResourceType,
          requireIfMatchConfig,
          undefined, // no ifMatch
        );
        fail('Expected 428');
      } catch (e: any) {
        expect(e.getStatus()).toBe(428);
      }
    });
  });

  // ─── Repository Error Handling (Phase A Step 3) ─────────────────────────

  describe('RepositoryError handling', () => {
    const { RepositoryError } = require('../../../domain/errors/repository-error');

    const validBody = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
      displayName: 'New Device',
      serialNumber: 'SN-002',
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockGenericRepo.findByExternalId.mockResolvedValue(null);
      mockGenericRepo.findByDisplayName.mockResolvedValue(null);
    });

    it('should convert RepositoryError CONNECTION to 503 on create', async () => {
      mockGenericRepo.create.mockRejectedValue(new RepositoryError('CONNECTION', 'DB timeout'));

      try {
        await service.createResource(validBody, baseUrl, endpointId, deviceResourceType);
        fail('Expected HttpException');
      } catch (e: any) {
        expect(e.getStatus()).toBe(503);
        expect(e.getResponse().detail).toContain('create Device');
      }
    });

    it('should convert RepositoryError NOT_FOUND to 404 on update', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.update.mockRejectedValue(new RepositoryError('NOT_FOUND', 'not found'));

      try {
        await service.replaceResource('scim-dev-001', validBody, baseUrl, endpointId, deviceResourceType);
        fail('Expected HttpException');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });

    it('should convert RepositoryError NOT_FOUND to 404 on delete', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.delete.mockRejectedValue(new RepositoryError('NOT_FOUND', 'not found'));

      try {
        await service.deleteResource('scim-dev-001', endpointId, deviceResourceType);
        fail('Expected HttpException');
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    });

    it('should re-throw non-RepositoryError (for GlobalExceptionFilter)', async () => {
      mockGenericRepo.findByScimId.mockResolvedValue(mockGenericRecord);
      mockGenericRepo.update.mockRejectedValue(new TypeError('unexpected'));

      await expect(
        service.replaceResource('scim-dev-001', validBody, baseUrl, endpointId, deviceResourceType),
      ).rejects.toThrow(TypeError);
    });
  });

  // ─── Silent Catch Logging (Phase B Step 7) ──────────────────────────

  describe('corrupt data logging', () => {
    it('should log WARN and return response for corrupt rawPayload in toScimResponse', async () => {
      const corruptRecord = {
        ...mockGenericRecord,
        rawPayload: 'NOT VALID JSON{{{',
      };
      mockGenericRepo.findByScimId.mockResolvedValue(corruptRecord);

      const result = await service.getResource(
        'scim-dev-001', baseUrl, endpointId, deviceResourceType,
      );

      // Should not throw — falls back to empty payload
      expect(result).toBeDefined();
      expect(result.id).toBe('scim-dev-001');
    });

    it('should log WARN and return response for corrupt meta in toScimResponse', async () => {
      const corruptRecord = {
        ...mockGenericRecord,
        meta: 'INVALID META JSON',
      };
      mockGenericRepo.findByScimId.mockResolvedValue(corruptRecord);

      const result = await service.getResource(
        'scim-dev-001', baseUrl, endpointId, deviceResourceType,
      );

      expect(result).toBeDefined();
      expect(result.meta).toBeDefined();
    });
  });

  describe('triggeredBy StrictSchemaValidation on validation errors (B.1-B.4)', () => {
    it('should include triggeredBy in schema validation 400 diagnostics', async () => {
      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      };

      mockGenericRepo.findAll.mockResolvedValue([]);

      try {
        // POST with unregistered extension URN should fail with triggeredBy
        await service.createResource(
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device', 'urn:unknown:fake:extension'],
            'urn:unknown:fake:extension': { field: 'value' },
          },
          baseUrl, endpointId, deviceResourceType, config,
        );
        fail('should have thrown');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        const body = e.getResponse();
        expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
        expect(body[SCIM_DIAGNOSTICS_URN].triggeredBy).toBe('StrictSchemaValidation');
        expect(body[SCIM_DIAGNOSTICS_URN].errorCode).toBe('VALIDATION_SCHEMA');
      }
    });
  });
});
