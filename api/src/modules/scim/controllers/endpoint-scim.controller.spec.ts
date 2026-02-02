import { Test, TestingModule } from '@nestjs/testing';
import { EndpointScimController } from './endpoint-scim.controller';
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';
import { EndpointScimGroupsService } from '../services/endpoint-scim-groups.service';
import { ScimMetadataService } from '../services/scim-metadata.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { CreateGroupDto } from '../dto/create-group.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';

describe('EndpointScimController', () => {
  let controller: EndpointScimController;
  let usersService: EndpointScimUsersService;
  let groupsService: EndpointScimGroupsService;
  let endpointService: EndpointService;

  const mockEndpoint = {
    id: 'endpoint-1',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'Test endpoint',
    config: null,
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
    originalUrl: '/scim/endpoints/endpoint-1/Users',
  } as any;

  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    setHeader: jest.fn(),
  } as any;

  const mockUsersService = {
    createUserForEndpoint: jest.fn(),
    getUserForEndpoint: jest.fn(),
    listUsersForEndpoint: jest.fn(),
    patchUserForEndpoint: jest.fn(),
    replaceUserForEndpoint: jest.fn(),
    deleteUserForEndpoint: jest.fn(),
  };

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

  const mockMetadataService = {
    buildServiceProviderConfig: jest.fn(),
  };

  const mockEndpointContext = {
    run: jest.fn((endpointId: string, callback: () => any) => callback()),
    getEndpointId: jest.fn(),
    setContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndpointScimController],
      providers: [
        {
          provide: EndpointScimUsersService,
          useValue: mockUsersService,
        },
        {
          provide: EndpointScimGroupsService,
          useValue: mockGroupsService,
        },
        {
          provide: ScimMetadataService,
          useValue: mockMetadataService,
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

    controller = module.get<EndpointScimController>(EndpointScimController);
    usersService = module.get<EndpointScimUsersService>(EndpointScimUsersService);
    groupsService = module.get<EndpointScimGroupsService>(EndpointScimGroupsService);
    endpointService = module.get<EndpointService>(EndpointService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('User Operations', () => {
    describe('POST /endpoints/:endpointId/Users', () => {
      it('should create a user in specific endpoint', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'test@example.com',
          active: true,
        };

        const mockUser = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          id: 'scim-123',
          userName: 'test@example.com',
          active: true,
          meta: {
            resourceType: 'User',
            created: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
            location: 'http://localhost:3000/scim/endpoints/endpoint-1/Users/scim-123',
          },
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.createUserForEndpoint.mockResolvedValue(mockUser);

        const result = await controller.createUser(
          'endpoint-1',
          createDto,
          mockRequest
        );

        expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
        expect(mockUsersService.createUserForEndpoint).toHaveBeenCalledWith(
          createDto,
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockUser);
      });
    });

    describe('GET /endpoints/:endpointId/Users/:id', () => {
      it('should get a user from specific endpoint', async () => {
        const mockUser = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          id: 'scim-123',
          userName: 'test@example.com',
          active: true,
          meta: {},
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.getUserForEndpoint.mockResolvedValue(mockUser);

        await controller.getUser('endpoint-1', 'scim-123', mockRequest);

        expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
        expect(mockUsersService.getUserForEndpoint).toHaveBeenCalledWith(
          'scim-123',
          expect.any(String),
          'endpoint-1'
        );
      });
    });

    describe('GET /endpoints/:endpointId/Users', () => {
      it('should list users from specific endpoint', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 2,
          startIndex: 1,
          itemsPerPage: 2,
          Resources: [
            { id: 'user-1', userName: 'user1@example.com' },
            { id: 'user-2', userName: 'user2@example.com' },
          ],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.listUsersForEndpoint.mockResolvedValue(mockListResponse);

        const result = await controller.listUsers(
          'endpoint-1',
          mockRequest,
          undefined,
          '1',
          '10'
        );

        expect(mockEndpointService.getEndpoint).toHaveBeenCalledWith('endpoint-1');
        expect(mockUsersService.listUsersForEndpoint).toHaveBeenCalledWith(
          { filter: undefined, startIndex: 1, count: 10 },
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockListResponse);
      });
    });

    describe('PATCH /endpoints/:endpointId/Users/:id', () => {
      it('should patch a user in specific endpoint', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'active', value: false }],
        };

        const mockUser = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          id: 'scim-123',
          userName: 'test@example.com',
          active: false,
          meta: {},
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.patchUserForEndpoint.mockResolvedValue(mockUser);

        const result = await controller.updateUser(
          'endpoint-1',
          'scim-123',
          patchDto,
          mockRequest
        );

        expect(mockUsersService.patchUserForEndpoint).toHaveBeenCalledWith(
          'scim-123',
          patchDto,
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockUser);
      });
    });

    describe('PUT /endpoints/:endpointId/Users/:id', () => {
      it('should replace a user in specific endpoint', async () => {
        const replaceDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'replaced@example.com',
          active: true,
        };

        const mockUser = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          id: 'scim-123',
          userName: 'replaced@example.com',
          active: true,
          meta: {},
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.replaceUserForEndpoint.mockResolvedValue(mockUser);

        const result = await controller.replaceUser(
          'endpoint-1',
          'scim-123',
          replaceDto,
          mockRequest
        );

        expect(mockUsersService.replaceUserForEndpoint).toHaveBeenCalledWith(
          'scim-123',
          replaceDto,
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockUser);
      });
    });

    describe('DELETE /endpoints/:endpointId/Users/:id', () => {
      it('should delete a user from specific endpoint', async () => {
        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.deleteUserForEndpoint.mockResolvedValue(undefined);

        await controller.deleteUser('endpoint-1', 'scim-123', mockRequest);

        expect(mockUsersService.deleteUserForEndpoint).toHaveBeenCalledWith(
          'scim-123',
          'endpoint-1'
        );
      });
    });
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
          'endpoint-1'
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
        controller.getUser('invalid-endpoint', 'user-123', mockRequest)
      ).rejects.toThrow('Endpoint not found');

      expect(mockUsersService.getUserForEndpoint).not.toHaveBeenCalled();
    });
  });
});
