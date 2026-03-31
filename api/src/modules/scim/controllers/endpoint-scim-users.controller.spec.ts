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
    
    
    
    getAlwaysReturnedByParent: jest.fn().mockReturnValue(new Map<string, Set<string>>()),
    getRequestReturnedByParent: jest.fn().mockReturnValue(new Map<string, Set<string>>()),
  };

  const mockEndpointService = {
    getEndpoint: jest.fn(),
  };

  const mockEndpointContext = {
    run: jest.fn((endpointId: string, callback: () => any) => callback()),
    getEndpointId: jest.fn(),
    setContext: jest.fn(),
    getWarnings: jest.fn().mockReturnValue([]),
    addWarnings: jest.fn(),
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
          'endpoint-1',
          expect.any(Object)
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
          'endpoint-1',
          expect.any(Object)
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

        // Should include only userName + always-returned (schemas, id, meta, userName)
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
          { filter: undefined, startIndex: 1, count: 10, sortBy: undefined, sortOrder: undefined },
          expect.any(String),
          'endpoint-1',
          expect.any(Object)
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
          'endpoint-1', mockRequest, undefined, '1', '10', undefined, undefined, 'userName', undefined
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
          { filter: 'userName eq "alice@example.com"', startIndex: 1, count: 10, sortBy: undefined, sortOrder: undefined },
          expect.any(String),
          'endpoint-1',
          expect.any(Object)
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
          expect.any(Object),
          undefined,
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
          'endpoint-1',
          expect.any(Object),
          undefined,
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
          'endpoint-1',
          expect.any(Object),
          undefined,
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

  // ───────────── G8e: returned characteristic filtering ─────────────

  describe('G8e — returned:request attribute filtering', () => {
    it('POST createUser should strip returned:request attributes from response', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'g8e-test@example.com',
        active: true,
      };

      const mockUserWithRequestAttr = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'scim-g8e',
        userName: 'g8e-test@example.com',
        active: true,
        secretQuestion: 'What is your pet?',
        meta: { resourceType: 'User' },
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockUsersService.createUserForEndpoint.mockResolvedValue(mockUserWithRequestAttr);
      // Simulate a request-only attribute
      mockUsersService.getRequestReturnedByParent.mockReturnValue(new Map([['urn:ietf:params:scim:schemas:core:2.0:user', new Set(['secretquestion'])]]));

      const result = await controller.createUser('endpoint-1', createDto, mockRequest);

      // secretQuestion has returned:'request' → stripped from write-op response
      expect(result.secretQuestion).toBeUndefined();
      expect(result.userName).toBe('g8e-test@example.com');
    });

    it('GET listUsers should pass requestOnlyAttrs to projection', async () => {
      const mockListResponse = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: 1,
        startIndex: 1,
        itemsPerPage: 1,
        Resources: [
          { schemas: ['s'], id: 'u1', userName: 'user1@example.com', secretQuestion: 'Pet?', meta: {} },
        ],
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockUsersService.listUsersForEndpoint.mockResolvedValue(mockListResponse);
      mockUsersService.getRequestReturnedByParent.mockReturnValue(new Map([['urn:ietf:params:scim:schemas:core:2.0:user', new Set(['secretquestion'])]]));

      const result = await controller.listUsers('endpoint-1', mockRequest);

      // returned:'request' attr should be stripped even without attributes param
      expect(result.Resources[0].secretQuestion).toBeUndefined();
      expect(result.Resources[0].userName).toBe('user1@example.com');
    });

    it('GET getUser should pass requestOnlyAttrs to applyAttributeProjection', async () => {
      const fullUser = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'scim-g8e-get',
        userName: 'g8e-get@example.com',
        active: true,
        secretQuestion: 'Favorite color?',
        meta: { resourceType: 'User' },
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockUsersService.getUserForEndpoint.mockResolvedValue(fullUser);
      mockUsersService.getRequestReturnedByParent.mockReturnValue(new Map([['urn:ietf:params:scim:schemas:core:2.0:user', new Set(['secretquestion'])]]));

      const result = await controller.getUser('endpoint-1', 'scim-g8e-get', mockRequest);

      // returned:'request' attr stripped because not in ?attributes= param
      expect(result.secretQuestion).toBeUndefined();
      expect(result.userName).toBe('g8e-get@example.com');
    });

    it('PUT replaceUser should strip returned:request attributes from response', async () => {
      const replaceDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'g8e-put@example.com',
        active: true,
      };

      const mockUserResult = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'scim-g8e-put',
        userName: 'g8e-put@example.com',
        active: true,
        secretQuestion: 'Birth city?',
        meta: { resourceType: 'User' },
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockUsersService.replaceUserForEndpoint.mockResolvedValue(mockUserResult);
      mockUsersService.getRequestReturnedByParent.mockReturnValue(new Map([['urn:ietf:params:scim:schemas:core:2.0:user', new Set(['secretquestion'])]]));

      const result = await controller.replaceUser('endpoint-1', 'scim-g8e-put', replaceDto, mockRequest);

      expect(result.secretQuestion).toBeUndefined();
      expect(result.userName).toBe('g8e-put@example.com');
    });
  });

  // ───────────── G8g: write-response attribute projection ─────────────

  describe('G8g — write-response attributes/excludedAttributes projection', () => {
    const fullUser = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: 'scim-g8g',
      userName: 'g8g-test@example.com',
      displayName: 'G8g Test User',
      active: true,
      emails: [{ value: 'g8g@example.com', type: 'work', primary: true }],
      meta: { resourceType: 'User', created: '2026-01-01T00:00:00Z' },
    };

    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockUsersService.getRequestReturnedByParent.mockReturnValue(new Map<string, Set<string>>());
    });

    it('POST createUser with ?attributes= should only return requested attributes', async () => {
      mockUsersService.createUserForEndpoint.mockResolvedValue({ ...fullUser });

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        'userName',
        undefined
      );

      expect(result.userName).toBe('g8g-test@example.com');
      expect(result.id).toBe('scim-g8g'); // always-returned
      expect(result.schemas).toBeDefined(); // always-returned
      expect(result.meta).toBeDefined(); // always-returned
      expect(result.displayName).toBeUndefined(); // not requested
      expect(result.emails).toBeUndefined(); // not requested
    });

    it('POST createUser with ?excludedAttributes= should omit specified attributes', async () => {
      mockUsersService.createUserForEndpoint.mockResolvedValue({ ...fullUser });

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        undefined,
        'displayName,emails'
      );

      expect(result.userName).toBe('g8g-test@example.com');
      expect(result.displayName).toBeUndefined(); // excluded
      expect(result.emails).toBeUndefined(); // excluded
      expect(result.active).toBe(true); // not excluded
    });

    it('PUT replaceUser with ?attributes= should project response', async () => {
      mockUsersService.replaceUserForEndpoint.mockResolvedValue({ ...fullUser });

      const result = await controller.replaceUser(
        'endpoint-1',
        'scim-g8g',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        'displayName',
        undefined
      );

      expect(result.displayName).toBe('G8g Test User'); // requested
      expect(result.id).toBe('scim-g8g'); // always-returned
      expect(result.emails).toBeUndefined(); // not requested
      expect(result.active).toBeUndefined(); // not requested
    });

    it('PATCH updateUser with ?attributes= should project response', async () => {
      mockUsersService.patchUserForEndpoint.mockResolvedValue({ ...fullUser });

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { displayName: 'Updated' } }],
      };

      const result = await controller.updateUser(
        'endpoint-1',
        'scim-g8g',
        patchDto,
        mockRequest,
        'displayName,active',
        undefined
      );

      expect(result.displayName).toBe('G8g Test User'); // requested
      expect(result.active).toBe(true); // requested
      expect(result.emails).toBeUndefined(); // not requested
    });

    it('PATCH updateUser with ?excludedAttributes= should omit specified', async () => {
      mockUsersService.patchUserForEndpoint.mockResolvedValue({ ...fullUser });

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { active: false } }],
      };

      const result = await controller.updateUser(
        'endpoint-1',
        'scim-g8g',
        patchDto,
        mockRequest,
        undefined,
        'emails,displayName'
      );

      expect(result.active).toBe(true); // not excluded
      expect(result.emails).toBeUndefined(); // excluded
      expect(result.displayName).toBeUndefined(); // excluded
    });

    it('POST/PUT/PATCH without query params should still return full response', async () => {
      mockUsersService.createUserForEndpoint.mockResolvedValue({ ...fullUser });

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest
      );

      // All attributes present when no projection params
      expect(result.userName).toBe('g8g-test@example.com');
      expect(result.displayName).toBe('G8g Test User');
      expect(result.emails).toBeDefined();
      expect(result.active).toBe(true);
    });

    it('PUT replaceUser with ?excludedAttributes= should omit specified attributes', async () => {
      mockUsersService.replaceUserForEndpoint.mockResolvedValue({ ...fullUser });

      const result = await controller.replaceUser(
        'endpoint-1',
        'scim-g8g',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        undefined,
        'emails,displayName'
      );

      expect(result.userName).toBe('g8g-test@example.com'); // not excluded
      expect(result.emails).toBeUndefined(); // excluded
      expect(result.displayName).toBeUndefined(); // excluded
      expect(result.active).toBe(true); // not excluded
      expect(result.id).toBe('scim-g8g'); // always-returned
    });

    it('POST with both attributes AND excludedAttributes — attributes takes precedence', async () => {
      mockUsersService.createUserForEndpoint.mockResolvedValue({ ...fullUser });

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        'userName,displayName',       // include-only
        'displayName'                 // also try to exclude displayName
      );

      // Per RFC 7644: attributes takes precedence — displayName IS in the include list
      expect(result.userName).toBe('g8g-test@example.com');
      expect(result.displayName).toBe('G8g Test User'); // included via attributes
      expect(result.id).toBe('scim-g8g'); // always-returned
      expect(result.emails).toBeUndefined(); // not in attributes list
    });

    it('returned:request attr should be INCLUDED when explicitly requested via ?attributes=', async () => {
      const userWithRequestAttr = {
        ...fullUser,
        secretQuestion: 'What is your pet?',
      };
      mockUsersService.createUserForEndpoint.mockResolvedValue({ ...userWithRequestAttr });
      mockUsersService.getRequestReturnedByParent.mockReturnValue(new Map([['urn:ietf:params:scim:schemas:core:2.0:user', new Set(['secretquestion'])]]));

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        'userName,secretQuestion',  // explicitly requesting the request-only attr
        undefined
      );

      // returned:'request' attr IS included because client explicitly requested it
      expect(result.secretQuestion).toBe('What is your pet?');
      expect(result.userName).toBe('g8g-test@example.com');
    });

    it('returned:request attr should be STRIPPED when only excludedAttributes is used', async () => {
      const userWithRequestAttr = {
        ...fullUser,
        secretQuestion: 'What is your pet?',
      };
      mockUsersService.createUserForEndpoint.mockResolvedValue({ ...userWithRequestAttr });
      mockUsersService.getRequestReturnedByParent.mockReturnValue(new Map([['urn:ietf:params:scim:schemas:core:2.0:user', new Set(['secretquestion'])]]));

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        undefined,
        'emails'  // excludedAttributes — no explicit request for secretQuestion
      );

      // returned:'request' is stripped because it's not in an attributes= list
      expect(result.secretQuestion).toBeUndefined();
      expect(result.emails).toBeUndefined(); // excluded
      expect(result.userName).toBe('g8g-test@example.com');
    });

    it('excludedAttributes cannot remove always-returned fields (id, schemas, meta)', async () => {
      mockUsersService.createUserForEndpoint.mockResolvedValue({ ...fullUser });

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        undefined,
        'id,schemas,meta,userName'  // try to exclude all always-returned + userName
      );

      // Always-returned fields survive excludedAttributes
      expect(result.id).toBe('scim-g8g');
      expect(result.schemas).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(result.userName).toBe('g8g-test@example.com'); // always-returned for User
    });

    it('dotted sub-attribute path (name.givenName) on POST should return only sub-attr', async () => {
      mockUsersService.createUserForEndpoint.mockResolvedValue({
        ...fullUser,
        name: { givenName: 'Test', familyName: 'User' },
      });

      const result = await controller.createUser(
        'endpoint-1',
        { schemas: fullUser.schemas, userName: 'g8g-test@example.com', active: true } as CreateUserDto,
        mockRequest,
        'name.givenName',
        undefined
      );

      // Only name.givenName sub-attribute included
      expect(result.name).toBeDefined();
      expect((result.name as Record<string, unknown>).givenName).toBe('Test');
      expect((result.name as Record<string, unknown>).familyName).toBeUndefined();
      expect(result.id).toBe('scim-g8g'); // always-returned
      expect(result.emails).toBeUndefined(); // not requested
    });
  });
});
