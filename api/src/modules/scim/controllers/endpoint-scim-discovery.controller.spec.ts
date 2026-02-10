import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EndpointScimDiscoveryController } from './endpoint-scim-discovery.controller';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';

describe('EndpointScimDiscoveryController', () => {
  let controller: EndpointScimDiscoveryController;

  const mockEndpoint = {
    id: 'endpoint-1',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'Test endpoint',
    config: {},
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRequest = {
    protocol: 'http',
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
        'urn:ietf:params:scim:schemas:core:2.0:ListResponse',
      ]);
      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
      expect(result.Resources[0].id).toBe(
        'urn:ietf:params:scim:schemas:core:2.0:User'
      );
      expect(result.Resources[1].id).toBe(
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
        'urn:ietf:params:scim:schemas:core:2.0:ListResponse',
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
      expect(result.bulk.supported).toBe(false);
      expect(result.filter.supported).toBe(true);
      expect(result.authenticationSchemes).toHaveLength(1);
      expect(result.authenticationSchemes[0].type).toBe('oauthbearertoken');
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
});
