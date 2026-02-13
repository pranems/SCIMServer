import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EndpointScimUsersController } from './endpoint-scim-users.controller';
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';

describe('EndpointScimUsersController', () => {
  let controller: EndpointScimUsersController;
  let usersService: EndpointScimUsersService;
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
    originalUrl: '/scim/endpoints/endpoint-1/Users',
  } as any;

  const mockUsersService = {
    createUserForEndpoint: jest.fn(),
    getUserForEndpoint: jest.fn(),
    listUsersForEndpoint: jest.fn(),
    patchUserForEndpoint: jest.fn(),
    replaceUserForEndpoint: jest.fn(),
    deleteUserForEndpoint: jest.fn(),
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
      controllers: [EndpointScimUsersController],
      providers: [
        {
          provide: EndpointScimUsersService,
          useValue: mockUsersService,
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

    controller = module.get<EndpointScimUsersController>(EndpointScimUsersController);
    usersService = module.get<EndpointScimUsersService>(EndpointScimUsersService);
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

      it('should apply attribute projection when attributes param is provided', async () => {
        const mockUser = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          id: 'scim-123',
          userName: 'test@example.com',
          active: true,
          displayName: 'Test User',
          meta: { resourceType: 'User' },
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.getUserForEndpoint.mockResolvedValue(mockUser);

        const result = await controller.getUser(
          'endpoint-1', 'scim-123', mockRequest, 'userName', undefined
        );

        // Should include only userName + always-returned (schemas, id, meta)
        expect(result.userName).toBe('test@example.com');
        expect(result.schemas).toBeDefined();
        expect(result.id).toBe('scim-123');
        expect(result.active).toBeUndefined();
        expect(result.displayName).toBeUndefined();
      });

      it('should apply excludedAttributes projection', async () => {
        const mockUser = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          id: 'scim-123',
          userName: 'test@example.com',
          active: true,
          displayName: 'Test User',
          meta: { resourceType: 'User' },
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.getUserForEndpoint.mockResolvedValue(mockUser);

        const result = await controller.getUser(
          'endpoint-1', 'scim-123', mockRequest, undefined, 'displayName'
        );

        expect(result.userName).toBe('test@example.com');
        expect(result.displayName).toBeUndefined();
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

      it('should apply attribute projection to list results', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 1,
          startIndex: 1,
          itemsPerPage: 1,
          Resources: [
            { schemas: ['s'], id: 'u1', userName: 'user1@example.com', active: true, meta: {} },
          ],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.listUsersForEndpoint.mockResolvedValue(mockListResponse);

        const result = await controller.listUsers(
          'endpoint-1', mockRequest, undefined, '1', '10', 'userName', undefined
        );

        expect(result.Resources[0].userName).toBe('user1@example.com');
        expect(result.Resources[0].active).toBeUndefined();
      });
    });

    describe('POST /endpoints/:endpointId/Users/.search', () => {
      it('should search users using POST body (RFC 7644 §3.4.3)', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 1,
          startIndex: 1,
          itemsPerPage: 1,
          Resources: [{ id: 'u1', userName: 'alice@example.com' }],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.listUsersForEndpoint.mockResolvedValue(mockListResponse);

        const searchDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
          filter: 'userName eq "alice@example.com"',
          startIndex: 1,
          count: 10,
        };

        const result = await controller.searchUsers('endpoint-1', searchDto, mockRequest);

        expect(mockUsersService.listUsersForEndpoint).toHaveBeenCalledWith(
          { filter: 'userName eq "alice@example.com"', startIndex: 1, count: 10 },
          expect.any(String),
          'endpoint-1'
        );
        expect(result).toEqual(mockListResponse);
      });

      it('should apply attribute projection in search', async () => {
        const mockListResponse = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 1,
          startIndex: 1,
          itemsPerPage: 1,
          Resources: [
            { schemas: ['s'], id: 'u1', userName: 'alice', active: true, meta: {} },
          ],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockUsersService.listUsersForEndpoint.mockResolvedValue(mockListResponse);

        const searchDto = {
          filter: 'userName eq "alice"',
          attributes: 'userName',
        };

        const result = await controller.searchUsers('endpoint-1', searchDto as any, mockRequest);

        expect(result.Resources[0].userName).toBe('alice');
        expect(result.Resources[0].active).toBeUndefined();
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
          'endpoint-1',
          expect.any(Object)
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

  describe('Endpoint Validation', () => {
    it('should validate endpoint exists before processing request', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(new Error('Endpoint not found'));

      await expect(
        controller.getUser('invalid-endpoint', 'user-123', mockRequest)
      ).rejects.toThrow('Endpoint not found');

      expect(mockUsersService.getUserForEndpoint).not.toHaveBeenCalled();
    });

    it('should reject SCIM operations on inactive endpoints', async () => {
      const inactiveEndpoint = {
        ...mockEndpoint,
        active: false,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(inactiveEndpoint);

      await expect(
        controller.getUser('endpoint-1', 'user-123', mockRequest)
      ).rejects.toThrow(ForbiddenException);

      expect(mockUsersService.getUserForEndpoint).not.toHaveBeenCalled();
    });

    it('should include endpoint name in inactive endpoint error message', async () => {
      const inactiveEndpoint = {
        ...mockEndpoint,
        name: 'test-endpoint',
        active: false,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(inactiveEndpoint);

      await expect(
        controller.createUser('endpoint-1', { schemas: [], userName: 'test' } as any, mockRequest)
      ).rejects.toThrow('Endpoint "test-endpoint" is inactive');
    });

    it('should allow SCIM operations on active endpoints', async () => {
      const activeEndpoint = {
        ...mockEndpoint,
        active: true,
      };
      mockEndpointService.getEndpoint.mockResolvedValue(activeEndpoint);
      mockUsersService.getUserForEndpoint.mockResolvedValue({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'user-123',
        userName: 'test@example.com',
        active: true,
        meta: {},
      });

      await expect(
        controller.getUser('endpoint-1', 'user-123', mockRequest)
      ).resolves.toBeDefined();

      expect(mockUsersService.getUserForEndpoint).toHaveBeenCalled();
    });
  });
});
