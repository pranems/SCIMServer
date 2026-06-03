import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { EndpointScimDiscoveryController } from './endpoint-scim-discovery.controller';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import { ScimLogger } from '../../logging/scim-logger.service';

describe('EndpointScimDiscoveryController', () => {
  let controller: EndpointScimDiscoveryController;

  const rfcProfile = {
    schemas: [
      { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', description: 'User Account', attributes: [] },
      { id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User', name: 'EnterpriseUser', description: 'Enterprise User Extension', attributes: [] },
      { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', description: 'Group', attributes: [] },
    ],
    resourceTypes: [
      { id: 'User', name: 'User', endpoint: '/Users', description: 'User Account', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [{ schema: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User', required: false }] },
      { id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [] },
    ],
    serviceProviderConfig: {
      patch: { supported: true },
      bulk: { supported: true, maxOperations: 1000, maxPayloadSize: 1048576 },
      filter: { supported: true, maxResults: 200 },
      sort: { supported: true },
      etag: { supported: true },
      changePassword: { supported: false },
    },
    settings: {},
  } as any;

  const bulkDisabledProfile = {
    ...rfcProfile,
    serviceProviderConfig: {
      ...rfcProfile.serviceProviderConfig,
      bulk: { supported: false, maxOperations: 1000, maxPayloadSize: 1048576 },
    },
  };

  const mockEndpoint = {
    id: 'endpoint-1',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'Test endpoint',
    config: {},
    profile: rfcProfile,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRequest = {
    protocol: 'http',
    headers: {} as Record<string, string>,
    baseUrl: '/scim',
    get: jest.fn((header: string) => {
      if (header === 'host') return 'localhost:3000';
      return undefined;
    }),
    originalUrl: '/scim/endpoints/endpoint-1/Schemas',
  } as any;

  const mockEndpointService = {
    getEndpoint: jest.fn(),
  };

  const mockEndpointContext = {
    setContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndpointScimDiscoveryController],
      providers: [
        { provide: EndpointService, useValue: mockEndpointService },
        { provide: EndpointContextStorage, useValue: mockEndpointContext },
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
            getConfig: jest.fn().mockReturnValue({}),
            runWithContext: jest.fn((ctx, fn) => fn()),
            getContext: jest.fn(),
            enrichContext: jest.fn(),
          },
        },
        ScimSchemaRegistry,
        ScimDiscoveryService,
      ],
    }).compile();

    controller = module.get<EndpointScimDiscoveryController>(
      EndpointScimDiscoveryController
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Schemas ────────────────────────────────────────────────────────

  describe('GET /endpoints/:endpointId/Schemas', () => {
    it('should return SCIM schema definitions', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getSchemas('endpoint-1', mockRequest);

      expect(result.schemas).toEqual([
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
      ]);
      expect(result.totalResults).toBe(3);
      expect(result.Resources).toHaveLength(3);
      expect(result.Resources[0].id).toBe(
        'urn:ietf:params:scim:schemas:core:2.0:User'
      );
      expect(result.Resources[1].id).toBe(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
      );
      expect(result.Resources[2].id).toBe(
        'urn:ietf:params:scim:schemas:core:2.0:Group'
      );
    });

    it('should validate endpoint before returning schemas', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      await controller.getSchemas('endpoint-1', mockRequest);

      expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
      expect(mockEndpointContext.setContext).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: 'endpoint-1',
          baseUrl: expect.stringContaining('endpoint-1'),
        })
      );
    });
  });

  // ─── ResourceTypes ──────────────────────────────────────────────────

  describe('GET /endpoints/:endpointId/ResourceTypes', () => {
    it('should return SCIM resource type definitions', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getResourceTypes('endpoint-1', mockRequest);

      expect(result.schemas).toEqual([
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
      ]);
      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
      expect(result.Resources.map((r: any) => r.id)).toEqual(['User', 'Group']);
    });
  });

  // ─── ServiceProviderConfig ──────────────────────────────────────────

  describe('GET /endpoints/:endpointId/ServiceProviderConfig', () => {
    it('should return service provider configuration', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getServiceProviderConfig(
        'endpoint-1',
        mockRequest
      );

      expect(result.schemas).toEqual([
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      ]);
      expect(result.patch.supported).toBe(true);
      expect(result.bulk.supported).toBe(true);
      expect(result.filter.supported).toBe(true);
      expect(result.authenticationSchemes).toHaveLength(1);
      expect(result.authenticationSchemes[0].type).toBe('oauthbearertoken');
    });

    it('should return bulk.supported=false when endpoint has BulkOperationsEnabled=false', async () => {
      const endpointWithBulkDisabled = {
        ...mockEndpoint,
        profile: bulkDisabledProfile,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(endpointWithBulkDisabled);

      const result = await controller.getServiceProviderConfig(
        'endpoint-1',
        mockRequest
      );

      expect(result.bulk.supported).toBe(false);
      expect(result.bulk.maxOperations).toBe(1000);
    });

    it('should return bulk.supported=true when endpoint has BulkOperationsEnabled=true', async () => {
      const endpointWithBulkEnabled = {
        ...mockEndpoint,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(endpointWithBulkEnabled);

      const result = await controller.getServiceProviderConfig(
        'endpoint-1',
        mockRequest
      );

      expect(result.bulk.supported).toBe(true);
    });
  });

  // ─── Individual Schema Lookup (D2) ────────────────────────────────────

  describe('GET /endpoints/:endpointId/Schemas/:uri', () => {
    it('should return a single schema by URN', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getSchemaByUri(
        'endpoint-1',
        'urn:ietf:params:scim:schemas:core:2.0:User',
        mockRequest,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(result.name).toBe('User');
    });

    it('should throw 404 for unknown schema URN', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      await expect(
        controller.getSchemaByUri('endpoint-1', 'urn:unknown:schema', mockRequest),
      ).rejects.toThrow(HttpException);
    });
  });

  // ─── Individual ResourceType Lookup (D3) ────────────────────────────

  describe('GET /endpoints/:endpointId/ResourceTypes/:id', () => {
    it('should return a single resource type by id', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getResourceTypeById(
        'endpoint-1',
        'User',
        mockRequest,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe('User');
      expect(result.name).toBe('User');
    });

    it('should throw 404 for unknown resource type id', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      await expect(
        controller.getResourceTypeById('endpoint-1', 'Unknown', mockRequest),
      ).rejects.toThrow(HttpException);
    });
  });

  // ─── Endpoint Validation ────────────────────────────────────────────

  describe('Endpoint Validation', () => {
    it('should reject discovery requests on inactive endpoints', async () => {
      const inactiveEndpoint = { ...mockEndpoint, active: false };
      mockEndpointService.getEndpoint.mockResolvedValue(inactiveEndpoint);

      await expect(
        controller.getSchemas('endpoint-1', mockRequest)
      ).rejects.toThrow(ForbiddenException);

      await expect(
        controller.getResourceTypes('endpoint-1', mockRequest)
      ).rejects.toThrow(ForbiddenException);

      await expect(
        controller.getServiceProviderConfig('endpoint-1', mockRequest)
      ).rejects.toThrow(ForbiddenException);
    });

    it('should include endpoint name in inactive endpoint error message', async () => {
      const inactiveEndpoint = {
        ...mockEndpoint,
        name: 'my-endpoint',
        active: false,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(inactiveEndpoint);

      await expect(
        controller.getSchemas('endpoint-1', mockRequest)
      ).rejects.toThrow('Endpoint "my-endpoint" is inactive');
    });

    it('should throw when endpoint does not exist', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(
        new Error('Endpoint not found')
      );

      await expect(
        controller.getSchemas('invalid-id', mockRequest)
      ).rejects.toThrow('Endpoint not found');
    });
  });

  // ─── Multi-Tenant / Endpoint-Specific Behavior ─────────────────────

  describe('Multi-Tenant Discovery', () => {
    it('should pass endpointId to getSchemas for per-tenant schema resolution', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getSchemas('endpoint-1', mockRequest);

      // Returns schemas - endpointId was passed so overlays would be merged
      expect(result.Resources).toBeDefined();
      expect(result.Resources.length).toBeGreaterThanOrEqual(3);
    });

    it('should pass endpointId to getResourceTypes for per-tenant RT resolution', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getResourceTypes('endpoint-1', mockRequest);

      expect(result.Resources).toBeDefined();
      expect(result.Resources.length).toBeGreaterThanOrEqual(2);
    });

    it('should pass endpointId to getSchemaByUrn for per-tenant lookup', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getSchemaByUri(
        'endpoint-1',
        'urn:ietf:params:scim:schemas:core:2.0:User',
        mockRequest,
      );

      expect(result.id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
    });

    it('should pass endpointId to getResourceTypeById for per-tenant lookup', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      const result = await controller.getResourceTypeById(
        'endpoint-1',
        'User',
        mockRequest,
      );

      expect(result.id).toBe('User');
    });

    it('should pass endpoint config to SPC for per-tenant capability flags', async () => {
      const bulkDisabledEndpoint = {
        ...mockEndpoint,
        profile: bulkDisabledProfile,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(bulkDisabledEndpoint);

      const result = await controller.getServiceProviderConfig(
        'endpoint-1',
        mockRequest,
      );

      expect(result.bulk.supported).toBe(false);
    });

    it('different endpoints with different configs produce different SPCs', async () => {
      // Endpoint with bulk disabled
      const epBulkOff = { ...mockEndpoint, id: 'ep-off', profile: bulkDisabledProfile };
      mockEndpointService.getEndpoint.mockResolvedValue(epBulkOff);
      const resultOff = await controller.getServiceProviderConfig('ep-off', mockRequest);

      // Endpoint with bulk enabled
      const epBulkOn = { ...mockEndpoint, id: 'ep-on' };
      mockEndpointService.getEndpoint.mockResolvedValue(epBulkOn);
      const resultOn = await controller.getServiceProviderConfig('ep-on', mockRequest);

      expect(resultOff.bulk.supported).toBe(false);
      expect(resultOn.bulk.supported).toBe(true);
    });

    it('should set endpoint context with correct endpointId and baseUrl', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);

      await controller.getSchemas('endpoint-1', mockRequest);

      expect(mockEndpointContext.setContext).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: 'endpoint-1',
          baseUrl: expect.stringContaining('/endpoints/endpoint-1'),
          config: {},
        }),
      );
    });
  });
});
