import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EndpointScimGroupsController } from './endpoint-scim-groups.controller';
import { EndpointScimGroupsService } from '../services/endpoint-scim-groups.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { CreateGroupDto } from '../dto/create-group.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';

describe('EndpointScimGroupsController', () => {
  let controller: EndpointScimGroupsController;
  let groupsService: EndpointScimGroupsService;
  let endpointService: EndpointService;

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
    headers: {} as Record<string, string>,
    baseUrl: '/scim',
    get: jest.fn((header: string) => {
      if (header === 'host') return 'localhost:3000';
      return undefined;
    }),
    originalUrl: '/scim/endpoints/endpoint-1/Groups',
  } as any;

  const mockGroupsService = {
    createGroupForEndpoint: jest.fn(),
    getGroupForEndpoint: jest.fn(),
    listGroupsForEndpoint: jest.fn(),
    patchGroupForEndpoint: jest.fn(),
    replaceGroupForEndpoint: jest.fn(),
    deleteGroupForEndpoint: jest.fn(),
  };

  const mockEndpointService = {
    getEndpoint: jest.fn(),
  };

  const mockEndpointContext = {
    run: jest.fn((endpointId: string, callback: () => any) => callback()),
    getEndpointId: jest.fn(),
    setContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndpointScimGroupsController],
      providers: [
        {
          provide: EndpointScimGroupsService,
          useValue: mockGroupsService,
        },
        {
          provide: EndpointService,
          useValue: mockEndpointService,
        },
        {
          provide: EndpointContextStorage,
          useValue: mockEndpointContext,
        },
      ],
    }).compile();

    controller = module.get<EndpointScimGroupsController>(EndpointScimGroupsController);
    groupsService = module.get<EndpointScimGroupsService>(EndpointScimGroupsService);
    endpointService = module.get<EndpointService>(EndpointService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Group Operations', () => {
    describe('POST /endpoints/:endpointId/Groups', () => {
      it('should create a group in specific endpoint', async () => {
        const createDto: CreateGroupDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Test Group',
        };

        const mockGroup = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          id: 'scim-grp-123',
          displayName: 'Test Group',
          members: [],
          meta: {
            resourceType: 'Group',
            created: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
            location: 'http://localhost:3000/scim/endpoints/endpoint-1/Groups/scim-grp-123',
          },
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.createGroupForEndpoint.mockResolvedValue(mockGroup);

        const result = await controller.createGroup(
          'endpoint-1',
          createDto,
          mockRequest
        );

        expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
        expect(mockGroupsService.createGroupForEndpoint).toHaveBeenCalledWith(
          createDto,
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockGroup);
      });
    });

    describe('GET /endpoints/:endpointId/Groups/:id', () => {
      it('should get a group from specific endpoint', async () => {
        const mockGroup = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          id: 'scim-grp-123',
          displayName: 'Test Group',
          members: [],
          meta: {},
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.getGroupForEndpoint.mockResolvedValue(mockGroup);

        await controller.getGroup('endpoint-1', 'scim-grp-123', mockRequest);

        expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
        expect(mockGroupsService.getGroupForEndpoint).toHaveBeenCalledWith(
          'scim-grp-123',
          expect.any(String),
          'endpoint-1'
        );
      });

      it('should apply attribute projection when attributes param is provided', async () => {
        const mockGroup = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          id: 'scim-grp-123',
          displayName: 'Test Group',
          members: [{ value: 'u1' }],
          meta: { resourceType: 'Group' },
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.getGroupForEndpoint.mockResolvedValue(mockGroup);

        const result = await controller.getGroup(
          'endpoint-1', 'scim-grp-123', mockRequest, 'displayName', undefined
        );

        expect(result.displayName).toBe('Test Group');
        expect(result.schemas).toBeDefined();
        expect(result.id).toBe('scim-grp-123');
        expect(result.members).toBeUndefined();
      });

      it('should apply excludedAttributes projection', async () => {
        const mockGroup = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          id: 'scim-grp-123',
          displayName: 'Test Group',
          members: [{ value: 'u1' }],
          meta: { resourceType: 'Group' },
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.getGroupForEndpoint.mockResolvedValue(mockGroup);

        const result = await controller.getGroup(
          'endpoint-1', 'scim-grp-123', mockRequest, undefined, 'members'
        );

        expect(result.displayName).toBe('Test Group');
        expect(result.members).toBeUndefined();
      });
    });

    describe('GET /endpoints/:endpointId/Groups', () => {
      it('should list groups from specific endpoint', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 2,
          startIndex: 1,
          itemsPerPage: 2,
          Resources: [
            { id: 'group-1', displayName: 'Group 1' },
            { id: 'group-2', displayName: 'Group 2' },
          ],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.listGroupsForEndpoint.mockResolvedValue(mockListResponse);

        const result = await controller.listGroups(
          'endpoint-1',
          mockRequest,
          undefined,
          '1',
          '10'
        );

        expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
        expect(mockGroupsService.listGroupsForEndpoint).toHaveBeenCalledWith(
          { filter: undefined, startIndex: 1, count: 10 },
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockListResponse);
      });

      it('should apply attribute projection to list results', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 1,
          startIndex: 1,
          itemsPerPage: 1,
          Resources: [
            { schemas: ['s'], id: 'g1', displayName: 'Group 1', members: [{ value: 'u1' }], meta: {} },
          ],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.listGroupsForEndpoint.mockResolvedValue(mockListResponse);

        const result = await controller.listGroups(
          'endpoint-1', mockRequest, undefined, '1', '10', 'displayName', undefined
        );

        expect(result.Resources[0].displayName).toBe('Group 1');
        expect(result.Resources[0].members).toBeUndefined();
      });
    });

    describe('POST /endpoints/:endpointId/Groups/.search', () => {
      it('should search groups using POST body (RFC 7644 §3.4.3)', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 1,
          startIndex: 1,
          itemsPerPage: 1,
          Resources: [{ id: 'g1', displayName: 'Engineering' }],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.listGroupsForEndpoint.mockResolvedValue(mockListResponse);

        const searchDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
          filter: 'displayName eq "Engineering"',
          startIndex: 1,
          count: 10,
        };

        const result = await controller.searchGroups('endpoint-1', searchDto, mockRequest);

        expect(mockGroupsService.listGroupsForEndpoint).toHaveBeenCalledWith(
          { filter: 'displayName eq "Engineering"', startIndex: 1, count: 10 },
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockListResponse);
      });

      it('should apply excludedAttributes in search', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 1,
          startIndex: 1,
          itemsPerPage: 1,
          Resources: [
            { schemas: ['s'], id: 'g1', displayName: 'Eng', members: [{ value: 'u1' }], meta: {} },
          ],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.listGroupsForEndpoint.mockResolvedValue(mockListResponse);

        const searchDto = {
          filter: 'displayName eq "Eng"',
          excludedAttributes: 'members',
        };

        const result = await controller.searchGroups('endpoint-1', searchDto as any, mockRequest);

        expect(result.Resources[0].displayName).toBe('Eng');
        expect(result.Resources[0].members).toBeUndefined();
      });
    });

    describe('PATCH /endpoints/:endpointId/Groups/:id', () => {
      it('should patch a group in specific endpoint', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'displayName', value: 'Updated Group' }],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.patchGroupForEndpoint.mockResolvedValue(undefined);

        await controller.updateGroup('endpoint-1', 'scim-grp-123', patchDto, mockRequest);

        expect(mockGroupsService.patchGroupForEndpoint).toHaveBeenCalledWith(
          'scim-grp-123',
          patchDto,
          expect.any(String),
          'endpoint-1',
          mockEndpoint.config
        );
      });
    });

    describe('PUT /endpoints/:endpointId/Groups/:id', () => {
      it('should replace a group in specific endpoint', async () => {
        const replaceDto: CreateGroupDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Replaced Group',
        };

        const mockGroup = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          id: 'scim-grp-123',
          displayName: 'Replaced Group',
          members: [],
          meta: {},
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.replaceGroupForEndpoint.mockResolvedValue(mockGroup);

        const result = await controller.replaceGroup(
          'endpoint-1',
          'scim-grp-123',
          replaceDto,
          mockRequest
        );

        expect(mockGroupsService.replaceGroupForEndpoint).toHaveBeenCalledWith(
          'scim-grp-123',
          replaceDto,
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockGroup);
      });
    });

    describe('DELETE /endpoints/:endpointId/Groups/:id', () => {
      it('should delete a group from specific endpoint', async () => {
        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.deleteGroupForEndpoint.mockResolvedValue(undefined);

        await controller.deleteGroup('endpoint-1', 'scim-grp-123', mockRequest);

        expect(mockGroupsService.deleteGroupForEndpoint).toHaveBeenCalledWith(
          'scim-grp-123',
          'endpoint-1'
        );
      });
    });
  });

  describe('Endpoint Validation', () => {
    it('should validate endpoint exists before processing request', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(new Error('Endpoint not found'));

      await expect(
        controller.getGroup('invalid-endpoint', 'group-123', mockRequest)
      ).rejects.toThrow('Endpoint not found');

      expect(mockGroupsService.getGroupForEndpoint).not.toHaveBeenCalled();
    });

    it('should reject SCIM operations on inactive endpoints', async () => {
      const inactiveEndpoint = {
        ...mockEndpoint,
        active: false,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(inactiveEndpoint);

      await expect(
        controller.getGroup('endpoint-1', 'group-123', mockRequest)
      ).rejects.toThrow(ForbiddenException);

      expect(mockGroupsService.getGroupForEndpoint).not.toHaveBeenCalled();
    });

    it('should include endpoint name in inactive endpoint error message', async () => {
      const inactiveEndpoint = {
        ...mockEndpoint,
        name: 'test-endpoint',
        active: false,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(inactiveEndpoint);

      await expect(
        controller.createGroup('endpoint-1', { schemas: [], displayName: 'test' } as any, mockRequest)
      ).rejects.toThrow('Endpoint "test-endpoint" is inactive');
    });

    it('should allow SCIM operations on active endpoints', async () => {
      const activeEndpoint = {
        ...mockEndpoint,
        active: true,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(activeEndpoint);
      mockGroupsService.getGroupForEndpoint.mockResolvedValue({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: 'group-123',
        displayName: 'Test Group',
        members: [],
        meta: {},
      });

      await expect(
        controller.getGroup('endpoint-1', 'group-123', mockRequest)
      ).resolves.toBeDefined();

      expect(mockGroupsService.getGroupForEndpoint).toHaveBeenCalled();
    });
  });
});
