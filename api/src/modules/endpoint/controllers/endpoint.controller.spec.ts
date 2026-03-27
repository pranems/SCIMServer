import { Test, TestingModule } from '@nestjs/testing';
import { EndpointController } from './endpoint.controller';
import { EndpointService } from '../services/endpoint.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('EndpointController', () => {
  let controller: EndpointController;
  let service: EndpointService;

  const mockEndpointResponse = {
    id: 'endpoint-1',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'A test endpoint',
    profile: { settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' }, schemas: [], resourceTypes: [], serviceProviderConfig: {} },
    active: true,
    scimBasePath: '/scim/endpoints/endpoint-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _links: {
      self: '/admin/endpoints/endpoint-1',
      stats: '/admin/endpoints/endpoint-1/stats',
      credentials: '/admin/endpoints/endpoint-1/credentials',
      scim: '/scim/endpoints/endpoint-1',
    },
  };

  const mockEndpointService = {
    createEndpoint: jest.fn(),
    listEndpoints: jest.fn(),
    getEndpoint: jest.fn(),
    getEndpointByName: jest.fn(),
    updateEndpoint: jest.fn(),
    deleteEndpoint: jest.fn(),
    getEndpointStats: jest.fn(),
    listPresets: jest.fn(),
    getPreset: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndpointController],
      providers: [
        {
          provide: EndpointService,
          useValue: mockEndpointService,
        },
      ],
    }).compile();

    controller = module.get<EndpointController>(EndpointController);
    service = module.get<EndpointService>(EndpointService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createEndpoint', () => {
    it('should create an endpoint', async () => {
      mockEndpointService.createEndpoint.mockResolvedValue(mockEndpointResponse);

      const result = await controller.createEndpoint({
        name: 'test-endpoint',
        displayName: 'Test Endpoint',
        profile: { settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' } },
      });

      expect(result).toEqual(mockEndpointResponse);
      expect(mockEndpointService.createEndpoint).toHaveBeenCalledWith({
        name: 'test-endpoint',
        displayName: 'Test Endpoint',
        profile: { settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' } },
      });
    });

    it('should propagate BadRequestException for invalid name', async () => {
      mockEndpointService.createEndpoint.mockRejectedValue(
        new BadRequestException('Endpoint name must contain only alphanumeric characters')
      );

      await expect(
        controller.createEndpoint({ name: 'invalid name!' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate BadRequestException for duplicate name', async () => {
      mockEndpointService.createEndpoint.mockRejectedValue(
        new BadRequestException('Endpoint with name "test-endpoint" already exists')
      );

      await expect(
        controller.createEndpoint({ name: 'test-endpoint' })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listEndpoints', () => {
    it('should list all endpoints when no filter provided', async () => {
      const mockListResponse = { totalResults: 1, endpoints: [mockEndpointResponse] };
      mockEndpointService.listEndpoints.mockResolvedValue(mockListResponse);

      const result = await controller.listEndpoints();

      expect(result).toEqual(mockListResponse);
      expect(mockEndpointService.listEndpoints).toHaveBeenCalledWith(undefined, 'summary');
    });

    it('should list active endpoints when active=true', async () => {
      const mockListResponse = { totalResults: 1, endpoints: [mockEndpointResponse] };
      mockEndpointService.listEndpoints.mockResolvedValue(mockListResponse);

      const result = await controller.listEndpoints('true');

      expect(result).toEqual(mockListResponse);
      expect(mockEndpointService.listEndpoints).toHaveBeenCalledWith(true, 'summary');
    });

    it('should list inactive endpoints when active=false', async () => {
      const inactiveEndpoint = { ...mockEndpointResponse, active: false };
      const mockListResponse = { totalResults: 1, endpoints: [inactiveEndpoint] };
      mockEndpointService.listEndpoints.mockResolvedValue(mockListResponse);

      const result = await controller.listEndpoints('false');

      expect(result).toEqual(mockListResponse);
      expect(mockEndpointService.listEndpoints).toHaveBeenCalledWith(false, 'summary');
    });

    it('should return empty list when no endpoints exist', async () => {
      const mockListResponse = { totalResults: 0, endpoints: [] };
      mockEndpointService.listEndpoints.mockResolvedValue(mockListResponse);

      const result = await controller.listEndpoints();

      expect(result).toEqual(mockListResponse);
    });

    it('should pass view=full when requested', async () => {
      const mockListResponse = { totalResults: 1, endpoints: [mockEndpointResponse] };
      mockEndpointService.listEndpoints.mockResolvedValue(mockListResponse);

      await controller.listEndpoints(undefined, 'full');

      expect(mockEndpointService.listEndpoints).toHaveBeenCalledWith(undefined, 'full');
    });
  });

  describe('getEndpoint', () => {
    it('should get an endpoint by ID (default full view)', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpointResponse);

      const result = await controller.getEndpoint('endpoint-1');

      expect(result).toEqual(mockEndpointResponse);
      expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1', 'full');
    });

    it('should pass view=summary when requested', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpointResponse);

      await controller.getEndpoint('endpoint-1', 'summary');

      expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1', 'summary');
    });

    it('should propagate NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(
        new NotFoundException('Endpoint with ID "non-existent" not found')
      );

      await expect(controller.getEndpoint('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getEndpointByName', () => {
    it('should get an endpoint by name (default full view)', async () => {
      mockEndpointService.getEndpointByName.mockResolvedValue(mockEndpointResponse);

      const result = await controller.getEndpointByName('test-endpoint');

      expect(result).toEqual(mockEndpointResponse);
      expect(mockEndpointService.getEndpointByName).toHaveBeenCalledWith('test-endpoint', 'full');
    });

    it('should propagate NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.getEndpointByName.mockRejectedValue(
        new NotFoundException('Endpoint with name "non-existent" not found')
      );

      await expect(controller.getEndpointByName('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateEndpoint', () => {
    it('should update endpoint displayName', async () => {
      const updatedEndpoint = { ...mockEndpointResponse, displayName: 'Updated Name' };
      mockEndpointService.updateEndpoint.mockResolvedValue(updatedEndpoint);

      const result = await controller.updateEndpoint('endpoint-1', { displayName: 'Updated Name' });

      expect(result).toEqual(updatedEndpoint);
      expect(mockEndpointService.updateEndpoint).toHaveBeenCalledWith('endpoint-1', {
        displayName: 'Updated Name',
      });
    });

    it('should update endpoint profile settings', async () => {
      const newSettings = { MultiOpPatchRequestAddMultipleMembersToGroup: 'False' };
      const updatedEndpoint = { ...mockEndpointResponse, profile: { settings: newSettings, schemas: [], resourceTypes: [], serviceProviderConfig: {} } };
      mockEndpointService.updateEndpoint.mockResolvedValue(updatedEndpoint);

      const result = await controller.updateEndpoint('endpoint-1', { profile: { settings: newSettings } });

      expect(result.profile?.settings).toEqual(newSettings);
    });

    it('should update endpoint active status', async () => {
      const updatedEndpoint = { ...mockEndpointResponse, active: false };
      mockEndpointService.updateEndpoint.mockResolvedValue(updatedEndpoint);

      const result = await controller.updateEndpoint('endpoint-1', { active: false });

      expect(result.active).toBe(false);
    });

    it('should propagate NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.updateEndpoint.mockRejectedValue(
        new NotFoundException('Endpoint with ID "non-existent" not found')
      );

      await expect(
        controller.updateEndpoint('non-existent', { displayName: 'New Name' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException for invalid config', async () => {
      mockEndpointService.updateEndpoint.mockRejectedValue(
        new BadRequestException('Invalid value for config flag')
      );

      await expect(
        controller.updateEndpoint('endpoint-1', {
          profile: { settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid' } },
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteEndpoint', () => {
    it('should delete an endpoint', async () => {
      mockEndpointService.deleteEndpoint.mockResolvedValue(undefined);

      const result = await controller.deleteEndpoint('endpoint-1');

      expect(result).toBeUndefined();
      expect(mockEndpointService.deleteEndpoint).toHaveBeenCalledWith('endpoint-1');
    });

    it('should propagate NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.deleteEndpoint.mockRejectedValue(
        new NotFoundException('Endpoint with ID "non-existent" not found')
      );

      await expect(controller.deleteEndpoint('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getEndpointStats', () => {
    it('should get endpoint statistics (nested format)', async () => {
      const mockStats = {
        users: { total: 10, active: 8, softDeleted: 2 },
        groups: { total: 5, active: 5, softDeleted: 0 },
        groupMembers: { total: 25 },
        requestLogs: { total: 100 },
      };
      mockEndpointService.getEndpointStats.mockResolvedValue(mockStats);

      const result = await controller.getEndpointStats('endpoint-1');

      expect(result).toEqual(mockStats);
      expect(result.users.total).toBe(10);
      expect(result.users.active).toBe(8);
      expect(result.users.softDeleted).toBe(2);
      expect(mockEndpointService.getEndpointStats).toHaveBeenCalledWith('endpoint-1');
    });

    it('should return zero counts for empty endpoint', async () => {
      const emptyStats = {
        users: { total: 0, active: 0, softDeleted: 0 },
        groups: { total: 0, active: 0, softDeleted: 0 },
        groupMembers: { total: 0 },
        requestLogs: { total: 0 },
      };
      mockEndpointService.getEndpointStats.mockResolvedValue(emptyStats);

      const result = await controller.getEndpointStats('endpoint-1');

      expect(result).toEqual(emptyStats);
    });

    it('should propagate NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.getEndpointStats.mockRejectedValue(
        new NotFoundException('Endpoint with ID "non-existent" not found')
      );

      await expect(controller.getEndpointStats('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('presets', () => {
    it('should list built-in presets', () => {
      const mockPresets = {
        totalResults: 2,
        presets: [
          { name: 'entra-id', description: 'Entra ID', default: true, summary: {} },
          { name: 'minimal', description: 'Minimal', default: false, summary: {} },
        ],
      };
      mockEndpointService.listPresets.mockReturnValue(mockPresets);

      const result = controller.listPresets();

      expect(result).toEqual(mockPresets);
      expect(result.totalResults).toBe(2);
    });

    it('should get a single preset by name', () => {
      const mockPreset = { metadata: { name: 'entra-id', description: 'Entra ID', default: true }, profile: {} };
      mockEndpointService.getPreset.mockReturnValue(mockPreset);

      const result = controller.getPreset('entra-id');

      expect(result).toEqual(mockPreset);
      expect(mockEndpointService.getPreset).toHaveBeenCalledWith('entra-id');
    });
  });
});
