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
    config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' },
    active: true,
    scimEndpoint: '/scim/endpoints/endpoint-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEndpointService = {
    createEndpoint: jest.fn(),
    listEndpoints: jest.fn(),
    getEndpoint: jest.fn(),
    getEndpointByName: jest.fn(),
    updateEndpoint: jest.fn(),
    deleteEndpoint: jest.fn(),
    getEndpointStats: jest.fn(),
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
        config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' },
      });

      expect(result).toEqual(mockEndpointResponse);
      expect(mockEndpointService.createEndpoint).toHaveBeenCalledWith({
        name: 'test-endpoint',
        displayName: 'Test Endpoint',
        config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' },
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
      mockEndpointService.listEndpoints.mockResolvedValue([mockEndpointResponse]);

      const result = await controller.listEndpoints();

      expect(result).toEqual([mockEndpointResponse]);
      expect(mockEndpointService.listEndpoints).toHaveBeenCalledWith(undefined);
    });

    it('should list active endpoints when active=true', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue([mockEndpointResponse]);

      const result = await controller.listEndpoints('true');

      expect(result).toEqual([mockEndpointResponse]);
      expect(mockEndpointService.listEndpoints).toHaveBeenCalledWith(true);
    });

    it('should list inactive endpoints when active=false', async () => {
      const inactiveEndpoint = { ...mockEndpointResponse, active: false };
      mockEndpointService.listEndpoints.mockResolvedValue([inactiveEndpoint]);

      const result = await controller.listEndpoints('false');

      expect(result).toEqual([inactiveEndpoint]);
      expect(mockEndpointService.listEndpoints).toHaveBeenCalledWith(false);
    });

    it('should return empty array when no endpoints exist', async () => {
      mockEndpointService.listEndpoints.mockResolvedValue([]);

      const result = await controller.listEndpoints();

      expect(result).toEqual([]);
    });
  });

  describe('getEndpoint', () => {
    it('should get an endpoint by ID', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpointResponse);

      const result = await controller.getEndpoint('endpoint-1');

      expect(result).toEqual(mockEndpointResponse);
      expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
    });

    it('should propagate NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(
        new NotFoundException('Endpoint with ID "non-existent" not found')
      );

      await expect(controller.getEndpoint('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getEndpointByName', () => {
    it('should get an endpoint by name', async () => {
      mockEndpointService.getEndpointByName.mockResolvedValue(mockEndpointResponse);

      const result = await controller.getEndpointByName('test-endpoint');

      expect(result).toEqual(mockEndpointResponse);
      expect(mockEndpointService.getEndpointByName).toHaveBeenCalledWith('test-endpoint');
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

    it('should update endpoint config', async () => {
      const newConfig = { MultiOpPatchRequestAddMultipleMembersToGroup: 'False' };
      const updatedEndpoint = { ...mockEndpointResponse, config: newConfig };
      mockEndpointService.updateEndpoint.mockResolvedValue(updatedEndpoint);

      const result = await controller.updateEndpoint('endpoint-1', { config: newConfig });

      expect(result.config).toEqual(newConfig);
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
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid' },
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
    it('should get endpoint statistics', async () => {
      const mockStats = {
        totalUsers: 10,
        totalGroups: 5,
        totalGroupMembers: 25,
        requestLogCount: 100,
      };
      mockEndpointService.getEndpointStats.mockResolvedValue(mockStats);

      const result = await controller.getEndpointStats('endpoint-1');

      expect(result).toEqual(mockStats);
      expect(mockEndpointService.getEndpointStats).toHaveBeenCalledWith('endpoint-1');
    });

    it('should return zero counts for empty endpoint', async () => {
      const emptyStats = {
        totalUsers: 0,
        totalGroups: 0,
        totalGroupMembers: 0,
        requestLogCount: 0,
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
});
