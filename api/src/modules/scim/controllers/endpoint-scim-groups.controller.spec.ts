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
    getRequestOnlyAttributes: jest.fn().mockReturnValue(new Set<string>()),
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
          'endpoint-1',
          expect.any(Object)
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
          'endpoint-1',
          expect.any(Object)
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
            { schemas: ['s'], id: 'g1', displayName: 'Group 1', members: [{ value: 'u1' }], meta: {} },
          ],
        };

        mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
        mockGroupsService.listGroupsForEndpoint.mockResolvedValue(mockListResponse);

        const result = await controller.listGroups(
          'endpoint-1', mockRequest, undefined, '1', '10', undefined, undefined, 'displayName', undefined
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
          { filter: 'displayName eq "Engineering"', startIndex: 1, count: 10, sortBy: undefined, sortOrder: undefined },
          expect.any(String),
          'endpoint-1',
          expect.any(Object)
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
          mockEndpoint.config,
          undefined,
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
          'endpoint-1',
          expect.any(Object),
          undefined,
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

  // ───────────── G8e: returned characteristic filtering ─────────────

  describe('G8e — returned:request attribute filtering', () => {
    it('POST createGroup should strip returned:request attributes from response', async () => {
      const createDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'G8e Test Group',
      };

      const mockGroupWithRequestAttr = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: 'scim-grp-g8e',
        displayName: 'G8e Test Group',
        members: [],
        secretTag: 'internal-only',
        meta: { resourceType: 'Group' },
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockGroupsService.createGroupForEndpoint.mockResolvedValue(mockGroupWithRequestAttr);
      mockGroupsService.getRequestOnlyAttributes.mockReturnValue(new Set(['secrettag']));

      const result = await controller.createGroup('endpoint-1', createDto, mockRequest);

      expect(result.secretTag).toBeUndefined();
      expect(result.displayName).toBe('G8e Test Group');
    });

    it('GET listGroups should pass requestOnlyAttrs to projection', async () => {
      const mockListResponse = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: 1,
        startIndex: 1,
        itemsPerPage: 1,
        Resources: [
          { schemas: ['s'], id: 'g1', displayName: 'Group 1', secretTag: 'hidden', meta: {} },
        ],
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockGroupsService.listGroupsForEndpoint.mockResolvedValue(mockListResponse);
      mockGroupsService.getRequestOnlyAttributes.mockReturnValue(new Set(['secrettag']));

      const result = await controller.listGroups('endpoint-1', mockRequest);

      expect(result.Resources[0].secretTag).toBeUndefined();
      expect(result.Resources[0].displayName).toBe('Group 1');
    });

    it('GET getGroup should pass requestOnlyAttrs to applyAttributeProjection', async () => {
      const fullGroup = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: 'scim-grp-g8e-get',
        displayName: 'G8e Get Group',
        members: [],
        secretTag: 'confidential',
        meta: { resourceType: 'Group' },
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockGroupsService.getGroupForEndpoint.mockResolvedValue(fullGroup);
      mockGroupsService.getRequestOnlyAttributes.mockReturnValue(new Set(['secrettag']));

      const result = await controller.getGroup('endpoint-1', 'scim-grp-g8e-get', mockRequest);

      expect(result.secretTag).toBeUndefined();
      expect(result.displayName).toBe('G8e Get Group');
    });

    it('PUT replaceGroup should strip returned:request attributes from response', async () => {
      const replaceDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Replaced G8e Group',
      };

      const mockGroupResult = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: 'scim-grp-g8e-put',
        displayName: 'Replaced G8e Group',
        members: [],
        secretTag: 'classified',
        meta: { resourceType: 'Group' },
      };

      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockGroupsService.replaceGroupForEndpoint.mockResolvedValue(mockGroupResult);
      mockGroupsService.getRequestOnlyAttributes.mockReturnValue(new Set(['secrettag']));

      const result = await controller.replaceGroup('endpoint-1', 'scim-grp-g8e-put', replaceDto, mockRequest);

      expect(result.secretTag).toBeUndefined();
      expect(result.displayName).toBe('Replaced G8e Group');
    });
  });

  // ───────────── G8g: write-response attribute projection ─────────────

  describe('G8g — write-response attributes/excludedAttributes projection', () => {
    const fullGroup = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: 'scim-grp-g8g',
      displayName: 'G8g Test Group',
      members: [{ value: 'user-1', display: 'User One' }],
      externalId: 'ext-g8g',
      meta: { resourceType: 'Group', created: '2026-01-01T00:00:00Z' },
    };

    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue(mockEndpoint);
      mockGroupsService.getRequestOnlyAttributes.mockReturnValue(new Set<string>());
    });

    it('POST createGroup with ?attributes= should only return requested attributes', async () => {
      mockGroupsService.createGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const result = await controller.createGroup(
        'endpoint-1',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        'displayName',
        undefined
      );

      expect(result.displayName).toBe('G8g Test Group');
      expect(result.id).toBe('scim-grp-g8g'); // always-returned
      expect(result.schemas).toBeDefined(); // always-returned
      expect(result.meta).toBeDefined(); // always-returned
      expect(result.members).toBeUndefined(); // not requested
      expect(result.externalId).toBeUndefined(); // not requested
    });

    it('POST createGroup with ?excludedAttributes= should omit specified attributes', async () => {
      mockGroupsService.createGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const result = await controller.createGroup(
        'endpoint-1',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        undefined,
        'members,externalId'
      );

      expect(result.displayName).toBe('G8g Test Group');
      expect(result.members).toBeUndefined(); // excluded
      expect(result.externalId).toBeUndefined(); // excluded
    });

    it('PUT replaceGroup with ?attributes= should project response', async () => {
      mockGroupsService.replaceGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const result = await controller.replaceGroup(
        'endpoint-1',
        'scim-grp-g8g',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        'displayName',
        undefined
      );

      expect(result.displayName).toBe('G8g Test Group'); // requested
      expect(result.id).toBe('scim-grp-g8g'); // always-returned
      expect(result.members).toBeUndefined(); // not requested
      expect(result.externalId).toBeUndefined(); // not requested
    });

    it('PATCH updateGroup with ?attributes= should project response', async () => {
      mockGroupsService.patchGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { displayName: 'Updated' } }],
      };

      const result = await controller.updateGroup(
        'endpoint-1',
        'scim-grp-g8g',
        patchDto,
        mockRequest,
        'displayName,members',
        undefined
      );

      expect(result.displayName).toBe('G8g Test Group'); // requested
      expect(result.members).toBeDefined(); // requested
      expect(result.externalId).toBeUndefined(); // not requested
    });

    it('PATCH updateGroup with ?excludedAttributes= should omit specified', async () => {
      mockGroupsService.patchGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { displayName: 'Updated' } }],
      };

      const result = await controller.updateGroup(
        'endpoint-1',
        'scim-grp-g8g',
        patchDto,
        mockRequest,
        undefined,
        'members'
      );

      expect(result.displayName).toBe('G8g Test Group'); // not excluded
      expect(result.externalId).toBe('ext-g8g'); // not excluded
      expect(result.members).toBeUndefined(); // excluded
    });

    it('POST/PUT/PATCH without query params should return full response', async () => {
      mockGroupsService.createGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const result = await controller.createGroup(
        'endpoint-1',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest
      );

      expect(result.displayName).toBe('G8g Test Group');
      expect(result.members).toBeDefined();
      expect(result.externalId).toBe('ext-g8g');
    });

    it('PUT replaceGroup with ?excludedAttributes= should omit specified attributes', async () => {
      mockGroupsService.replaceGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const result = await controller.replaceGroup(
        'endpoint-1',
        'scim-grp-g8g',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        undefined,
        'members,externalId'
      );

      expect(result.displayName).toBe('G8g Test Group'); // not excluded
      expect(result.members).toBeUndefined(); // excluded
      expect(result.externalId).toBeUndefined(); // excluded
      expect(result.id).toBe('scim-grp-g8g'); // always-returned
    });

    it('POST with both attributes AND excludedAttributes — attributes takes precedence', async () => {
      mockGroupsService.createGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const result = await controller.createGroup(
        'endpoint-1',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        'displayName,members',       // include-only
        'members'                    // also try to exclude members
      );

      // Per RFC 7644: attributes takes precedence — members IS in the include list
      expect(result.displayName).toBe('G8g Test Group');
      expect(result.members).toBeDefined(); // included via attributes
      expect(result.id).toBe('scim-grp-g8g'); // always-returned
      expect(result.externalId).toBeUndefined(); // not in attributes list
    });

    it('returned:request attr should be INCLUDED when explicitly requested via ?attributes=', async () => {
      const groupWithRequestAttr = {
        ...fullGroup,
        secretTag: 'internal-only',
      };
      mockGroupsService.createGroupForEndpoint.mockResolvedValue({ ...groupWithRequestAttr });
      mockGroupsService.getRequestOnlyAttributes.mockReturnValue(new Set(['secrettag']));

      const result = await controller.createGroup(
        'endpoint-1',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        'displayName,secretTag',  // explicitly requesting the request-only attr
        undefined
      );

      // returned:'request' attr IS included because client explicitly requested it
      expect(result.secretTag).toBe('internal-only');
      expect(result.displayName).toBe('G8g Test Group');
    });

    it('returned:request attr should be STRIPPED when only excludedAttributes is used', async () => {
      const groupWithRequestAttr = {
        ...fullGroup,
        secretTag: 'internal-only',
      };
      mockGroupsService.createGroupForEndpoint.mockResolvedValue({ ...groupWithRequestAttr });
      mockGroupsService.getRequestOnlyAttributes.mockReturnValue(new Set(['secrettag']));

      const result = await controller.createGroup(
        'endpoint-1',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        undefined,
        'members'  // excludedAttributes — no explicit request for secretTag
      );

      // returned:'request' is stripped because it's not in an attributes= list
      expect(result.secretTag).toBeUndefined();
      expect(result.members).toBeUndefined(); // excluded
      expect(result.displayName).toBe('G8g Test Group');
    });

    it('excludedAttributes cannot remove always-returned fields (id, schemas, meta, displayName)', async () => {
      mockGroupsService.createGroupForEndpoint.mockResolvedValue({ ...fullGroup });

      const result = await controller.createGroup(
        'endpoint-1',
        { schemas: fullGroup.schemas, displayName: 'G8g Test Group' } as CreateGroupDto,
        mockRequest,
        undefined,
        'id,schemas,meta,displayName'  // try to exclude all always-returned
      );

      // Always-returned fields survive excludedAttributes
      expect(result.id).toBe('scim-grp-g8g');
      expect(result.schemas).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(result.displayName).toBe('G8g Test Group'); // always-returned for Group
    });
  });
});
