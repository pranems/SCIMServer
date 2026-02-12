import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EndpointScimGroupsService } from './endpoint-scim-groups.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimMetadataService } from './scim-metadata.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ScimLogger } from '../../logging/scim-logger.service';
import type { CreateGroupDto } from '../dto/create-group.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';

describe('EndpointScimGroupsService', () => {
  let service: EndpointScimGroupsService;
  let prismaService: PrismaService;
  let metadataService: ScimMetadataService;

  const mockEndpoint = {
    id: 'endpoint-1',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'Test endpoint for SCIM',
    config: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroup = {
    id: 'group-1',
    scimId: 'scim-grp-123',
    endpointId: 'endpoint-1',
    externalId: null as string | null,
    displayName: 'Test Group',
    rawPayload: '{"description":"Test group"}',
    meta: JSON.stringify({
      resourceType: 'Group',
      created: '2024-01-01T00:00:00.000Z',
      lastModified: '2024-01-01T00:00:00.000Z',
    }),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    members: [],
  };

  const mockUser = {
    id: 'user-1',
    scimId: 'scim-user-123',
    endpointId: 'endpoint-1',
  };

  // Define type to avoid circular reference issue
  type MockPrismaService = {
    scimGroup: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    scimUser: {
      findMany: jest.Mock;
    };
    groupMember: {
      createMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const mockPrismaService: MockPrismaService = {
    scimGroup: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    scimUser: {
      findMany: jest.fn(),
    },
    groupMember: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockMetadataService = {
    buildLocation: jest.fn((baseUrl: string, resourceType: string, id: string) =>
      `${baseUrl}/${resourceType}/${id}`
    ),
  };

  const mockEndpointContext = {
    setContext: jest.fn(),
    getContext: jest.fn(),
    getEndpointId: jest.fn(),
    getBaseUrl: jest.fn(),
    getConfig: jest.fn().mockReturnValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndpointScimGroupsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ScimMetadataService,
          useValue: mockMetadataService,
        },
        {
          provide: EndpointContextStorage,
          useValue: mockEndpointContext,
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
          },
        },
      ],
    }).compile();

    service = module.get<EndpointScimGroupsService>(EndpointScimGroupsService);
    prismaService = module.get<PrismaService>(PrismaService);
    metadataService = module.get<ScimMetadataService>(ScimMetadataService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createGroupForEndpoint', () => {
    it('should create a group for a specific endpoint', async () => {
      const createDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'New Group',
      };

      mockPrismaService.scimGroup.findMany.mockResolvedValue([]); // uniqueness check
      mockPrismaService.scimGroup.create.mockResolvedValue(mockGroup);
      mockPrismaService.scimGroup.findFirst.mockResolvedValue({
        ...mockGroup,
        displayName: createDto.displayName,
      });

      const result = await service.createGroupForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.displayName).toBe(createDto.displayName);
      expect(result.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
      expect(mockPrismaService.scimGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            displayName: createDto.displayName,
            endpoint: { connect: { id: mockEndpoint.id } },
          }),
        })
      );
    });

    it('should create group with members within endpoint', async () => {
      const createDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Group with Members',
        members: [
          { value: mockUser.scimId, display: 'Test User' },
        ],
      };

      mockPrismaService.scimGroup.findMany.mockResolvedValue([]); // uniqueness check
      mockPrismaService.scimGroup.create.mockResolvedValue(mockGroup);
      mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);
      mockPrismaService.scimGroup.findFirst.mockResolvedValue({
        ...mockGroup,
        members: [
          {
            id: 'member-1',
            groupId: mockGroup.id,
            userId: mockUser.id,
            value: mockUser.scimId,
            display: 'Test User',
            type: null,
            createdAt: new Date(),
          },
        ],
      });

      const result = await service.createGroupForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.members).toHaveLength(1);
      expect(result.members![0].value).toBe(mockUser.scimId);
      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
        })
      );
    });
  });

  describe('getGroupForEndpoint', () => {
    it('should retrieve a group by scimId within endpoint', async () => {
      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);

      const result = await service.getGroupForEndpoint(
        mockGroup.scimId,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.id).toBe(mockGroup.scimId);
      expect(result.displayName).toBe(mockGroup.displayName);
      expect(mockPrismaService.scimGroup.findFirst).toHaveBeenCalledWith({
        where: {
          scimId: mockGroup.scimId,
          endpointId: mockEndpoint.id,
        },
        select: expect.any(Object),
      });
    });

    it('should throw 404 if group not found in endpoint', async () => {
      mockPrismaService.scimGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.getGroupForEndpoint('non-existent', 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });
  });

  describe('listGroupsForEndpoint', () => {
    it('should list groups within a specific endpoint', async () => {
      const groups = [mockGroup, { ...mockGroup, id: 'group-2', scimId: 'scim-grp-456' }];

      mockPrismaService.scimGroup.count.mockResolvedValue(2);
      mockPrismaService.scimGroup.findMany.mockResolvedValue(groups);

      const result = await service.listGroupsForEndpoint(
        { startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
      expect(result.startIndex).toBe(1);
      expect(mockPrismaService.scimGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
        })
      );
    });

    it('should filter groups by displayName within endpoint', async () => {
      mockPrismaService.scimGroup.findMany.mockResolvedValue([mockGroup]);

      const result = await service.listGroupsForEndpoint(
        { filter: 'displayName eq "Test Group"', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // displayName filter is now applied in-code for case-insensitive matching
      expect(result.totalResults).toBe(1);
      expect(mockPrismaService.scimGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
          orderBy: { createdAt: 'asc' },
        })
      );
    });
  });

  describe('patchGroupForEndpoint', () => {
    it('should update group displayName within endpoint', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: 'displayName',
            value: 'Updated Group Name',
          },
        ],
      };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
      mockPrismaService.scimGroup.update.mockResolvedValue({
        ...mockGroup,
        displayName: 'Updated Group Name',
      });

      const result = await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockPrismaService.scimGroup.findFirst).toHaveBeenCalledWith({
        where: {
          scimId: mockGroup.scimId,
          endpointId: mockEndpoint.id,
        },
        select: expect.any(Object),
      });
      expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            displayName: 'Updated Group Name',
          }),
        })
      );
    });

    it('should return updated group resource with 200 OK (RFC 7644 §3.5.2)', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: 'displayName',
            value: 'Patched Group',
          },
        ],
      };

      const updatedGroup = {
        ...mockGroup,
        displayName: 'Patched Group',
      };

      // First call for initial lookup, second call after update to return the resource
      mockPrismaService.scimGroup.findFirst
        .mockResolvedValueOnce(mockGroup)
        .mockResolvedValueOnce(updatedGroup);
      mockPrismaService.scimGroup.update.mockResolvedValue(updatedGroup);

      const result = await service.patchGroupForEndpoint(
        mockGroup.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // Verify the result is a full SCIM Group resource (not void/empty)
      expect(result).toBeDefined();
      expect(result.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
      expect(result.id).toBe(mockGroup.scimId);
      expect(result.displayName).toBe('Patched Group');
      expect(result.meta).toBeDefined();
    });

    it('should add members to group within endpoint', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'add',
            path: 'members',
            value: [{ value: mockUser.scimId }],
          },
        ],
      };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
      mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
        })
      );
    });

    it('should remove members from group', async () => {
      const groupWithMember = {
        ...mockGroup,
        members: [
          {
            id: 'member-1',
            groupId: mockGroup.id,
            userId: mockUser.id,
            value: mockUser.scimId,
            display: null,
            type: null,
            createdAt: new Date(),
          },
        ],
      };

      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'remove',
            path: `members[value eq "${mockUser.scimId}"]`,
          },
        ],
      };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMember);

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
    });

    describe('MultiOpPatchRequestAddMultipleMembersToGroup config flag', () => {
      it('should reject adding multiple members when flag is false (default)', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'add',
              path: 'members',
              value: [
                { value: 'user-1' },
                { value: 'user-2' },
                { value: 'user-3' },
              ],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        // Default config returns empty object (flag is false)
        mockEndpointContext.getConfig.mockReturnValue({});

        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        // Should not attempt to create members
        expect(mockPrismaService.groupMember.createMany).not.toHaveBeenCalled();
      });

      it('should allow adding multiple members when flag is true', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'add',
              path: 'members',
              value: [
                { value: 'user-1' },
                { value: 'user-2' },
                { value: 'user-3' },
              ],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimUser.findMany.mockResolvedValue([]);
        // Enable the flag
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Should process the operation
        expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
        expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      });

      it('should allow adding multiple members when flag is boolean true', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'add',
              path: 'members',
              value: [
                { value: 'user-1' },
                { value: 'user-2' },
              ],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimUser.findMany.mockResolvedValue([]);
        // Enable the flag with boolean
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestAddMultipleMembersToGroup: true,
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      });

      it('should always allow adding single member regardless of flag', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'add',
              path: 'members',
              value: [{ value: mockUser.scimId }],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);
        // Flag is false (default)
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Single member add should succeed
        expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      });

      it('should allow multiple separate add operations with single members each', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'add',
              path: 'members',
              value: [{ value: 'user-1' }],
            },
            {
              op: 'add',
              path: 'members',
              value: [{ value: 'user-2' }],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimUser.findMany.mockResolvedValue([]);
        // Flag is false
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Multiple operations with single member each should succeed
        expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      });
    });

    describe('MultiOpPatchRequestRemoveMultipleMembersFromGroup config flag', () => {
      const groupWithMultipleMembers = {
        ...mockGroup,
        members: [
          { id: 'member-1', groupId: mockGroup.id, userId: 'user-1', value: 'user-1', display: null, type: null, createdAt: new Date() },
          { id: 'member-2', groupId: mockGroup.id, userId: 'user-2', value: 'user-2', display: null, type: null, createdAt: new Date() },
          { id: 'member-3', groupId: mockGroup.id, userId: 'user-3', value: 'user-3', display: null, type: null, createdAt: new Date() },
        ],
      };

      it('should reject removing multiple members via value array when flag is false', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
              value: [
                { value: 'user-1' },
                { value: 'user-2' },
              ],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        // Default config returns empty object (flag is false)
        mockEndpointContext.getConfig.mockReturnValue({});

        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        // Should not attempt to update group
        expect(mockPrismaService.groupMember.deleteMany).not.toHaveBeenCalled();
      });

      it('should allow removing multiple members via value array when flag is "True"', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
              value: [
                { value: 'user-1' },
                { value: 'user-2' },
              ],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
      });

      it('should allow removing multiple members via value array when flag is boolean true', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
              value: [
                { value: 'user-1' },
                { value: 'user-2' },
              ],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestRemoveMultipleMembersFromGroup: true,
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
      });

      it('should always allow removing single member via value array regardless of flag', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
              value: [
                { value: 'user-1' },
              ],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        // Flag is false (default)
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Single member remove should succeed
        expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
      });

      it('should always allow removing single member via path filter regardless of flag', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members[value eq "user-1"]',
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        // Flag is false (default)
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Single member remove should succeed
        expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
      });

      it('should allow multiple separate remove operations with single members each', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
              value: [{ value: 'user-1' }],
            },
            {
              op: 'remove',
              path: 'members',
              value: [{ value: 'user-2' }],
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        // Flag is false
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Multiple operations with single member each should succeed
        expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
      });

      it('should allow removing via path=members without value array when PatchOpAllowRemoveAllMembers is true (default)', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        // Default config - PatchOpAllowRemoveAllMembers defaults to true
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Should remove all members (empty members array)
        expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalled();
        // createMany should not be called since no members remain
        expect(mockPrismaService.groupMember.createMany).not.toHaveBeenCalled();
      });

      it('should reject removing via path=members without value array when PatchOpAllowRemoveAllMembers is false', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        mockEndpointContext.getConfig.mockReturnValue({
          PatchOpAllowRemoveAllMembers: false,
        });

        // path=members without value array should be rejected
        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        expect(mockPrismaService.groupMember.deleteMany).not.toHaveBeenCalled();
      });

      it('should reject removing via path=members without value array when PatchOpAllowRemoveAllMembers is "False"', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'remove',
              path: 'members',
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithMultipleMembers);
        mockEndpointContext.getConfig.mockReturnValue({
          PatchOpAllowRemoveAllMembers: 'False',
        });

        // path=members without value array should be rejected
        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        expect(mockPrismaService.groupMember.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe('no-path replace with object value (Phase 1 Task 2)', () => {
      it('should accept object value with displayName in no-path replace', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: { displayName: 'New Display Name' },
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimGroup.update.mockResolvedValue({
          ...mockGroup,
          displayName: 'New Display Name',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              displayName: 'New Display Name',
            }),
          })
        );
      });

      it('should persist externalId as first-class column from no-path replace object', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: { externalId: 'new-ext-id' },
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimGroup.update.mockResolvedValue({
          ...mockGroup,
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              externalId: 'new-ext-id',
            }),
          })
        );
      });

      it('should handle combined displayName + externalId in no-path replace', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: { displayName: 'Combined', externalId: 'ext-combined' },
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimGroup.update.mockResolvedValue({
          ...mockGroup,
          displayName: 'Combined',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              displayName: 'Combined',
              externalId: 'ext-combined',
            }),
          })
        );
      });

      it('should handle externalId path in replace operation', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              path: 'externalId',
              value: 'pathed-ext-id',
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimGroup.update.mockResolvedValue({
          ...mockGroup,
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              externalId: 'pathed-ext-id',
            }),
          })
        );
      });

      it('should accept no-path replace with string value as displayName', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: 'Direct String Name',
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimGroup.update.mockResolvedValue({
          ...mockGroup,
          displayName: 'Direct String Name',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              displayName: 'Direct String Name',
            }),
          })
        );
      });

      it('should handle no-path replace with members array in object value', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: {
                displayName: 'Group With Members',
                members: [{ value: 'user-scim-1' }],
              },
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
        mockPrismaService.scimUser.findMany.mockResolvedValue([]);
        mockPrismaService.scimGroup.update.mockResolvedValue({
          ...mockGroup,
          displayName: 'Group With Members',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              displayName: 'Group With Members',
            }),
          })
        );
        expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      });

      it('should throw error for no-path replace with invalid value type', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: 42 as any,
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);

        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);
      });

      it('should throw error for unsupported replace path', async () => {
        const patchDto: PatchGroupDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              path: 'unsupportedAttribute',
              value: 'test',
            },
          ],
        };

        mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);

        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);
      });
    });

    it('should throw 404 if group not found for patch', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'displayName', value: 'Updated' },
        ],
      };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.patchGroupForEndpoint('non-existent', patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });

    it('should throw error for unsupported patch operation', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'invalidOp' as any, path: 'displayName', value: 'test' },
        ],
      };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);

      await expect(
        service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });
  });

  describe('replaceGroupForEndpoint', () => {
    it('should replace group data within endpoint', async () => {
      const replaceDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Replaced Group',
        members: [{ value: mockUser.scimId }],
      };

      mockPrismaService.scimGroup.findFirst
        .mockResolvedValueOnce(mockGroup) // Find group to replace
        .mockResolvedValueOnce({
          ...mockGroup,
          displayName: replaceDto.displayName,
          members: [
            {
              id: 'member-1',
              groupId: mockGroup.id,
              userId: mockUser.id,
              value: mockUser.scimId,
              display: null,
              type: null,
              createdAt: new Date(),
            },
          ],
        }); // Return updated group

      mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

      const result = await service.replaceGroupForEndpoint(
        mockGroup.scimId,
        replaceDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.displayName).toBe(replaceDto.displayName);
      expect(result.members).toHaveLength(1);
    });
  });

  describe('deleteGroupForEndpoint', () => {
    it('should delete group within endpoint', async () => {
      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
      mockPrismaService.scimGroup.delete.mockResolvedValue(mockGroup);

      await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id);

      expect(mockPrismaService.scimGroup.findFirst).toHaveBeenCalledWith({
        where: {
          scimId: mockGroup.scimId,
          endpointId: mockEndpoint.id,
        },
      });
      expect(mockPrismaService.scimGroup.delete).toHaveBeenCalledWith({
        where: { id: mockGroup.id },
      });
    });

    it('should throw 404 if group not found in endpoint', async () => {
      mockPrismaService.scimGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteGroupForEndpoint('non-existent', mockEndpoint.id)
      ).rejects.toThrow(HttpException);

      expect(mockPrismaService.scimGroup.delete).not.toHaveBeenCalled();
    });
  });

  describe('endpoint isolation', () => {
    it('should not allow accessing groups from different endpoints', async () => {
      const endpoint2 = { ...mockEndpoint, id: 'endpoint-2' };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.getGroupForEndpoint(mockGroup.scimId, 'http://localhost:3000/scim', endpoint2.id)
      ).rejects.toThrow(HttpException);

      expect(mockPrismaService.scimGroup.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            scimId: mockGroup.scimId,
            endpointId: endpoint2.id,
          },
        })
      );
    });

    it('should allow same displayName across different endpoints', async () => {
      const createDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Shared Group Name',
      };

      mockPrismaService.scimGroup.create.mockResolvedValue({
        ...mockGroup,
        id: 'group-2',
        endpointId: 'endpoint-2',
        displayName: createDto.displayName,
      });
      mockPrismaService.scimGroup.findFirst.mockResolvedValue({
        ...mockGroup,
        id: 'group-2',
        endpointId: 'endpoint-2',
        displayName: createDto.displayName,
      });

      const result = await service.createGroupForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        'endpoint-2'
      );

      expect(result.displayName).toBe(createDto.displayName);
    });

    it('should only add members from same endpoint', async () => {
      const createDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Group with Cross-Endpoint Members',
        members: [{ value: 'user-from-another-endpoint' }],
      };

      mockPrismaService.scimGroup.create.mockResolvedValue(mockGroup);
      // No users found in this endpoint
      mockPrismaService.scimUser.findMany.mockResolvedValue([]);
      mockPrismaService.scimGroup.findFirst.mockResolvedValue({
        ...mockGroup,
        members: [], // No members added
      });

      const result = await service.createGroupForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // User from another endpoint should not be added
      expect(result.members).toHaveLength(0);
      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
        })
      );
    });
  });

  // ─── RFC 7643 Case-Insensitivity Compliance ────────────────────────

  describe('case-insensitivity compliance (RFC 7643)', () => {
    describe('filter attribute names', () => {
      it('should accept filter with "DisplayName" (mixed case) as attribute', async () => {
        mockPrismaService.scimGroup.findMany.mockResolvedValue([mockGroup]);

        const result = await service.listGroupsForEndpoint(
          { filter: 'DisplayName eq "Test Group"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // displayName filter applied in-code; attribute resolved case-insensitively
        expect(result.totalResults).toBe(1);
        expect(mockPrismaService.scimGroup.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              endpointId: mockEndpoint.id,
            }),
            orderBy: { createdAt: 'asc' },
          })
        );
      });

      it('should accept filter with "DISPLAYNAME" (all caps) as attribute', async () => {
        mockPrismaService.scimGroup.findMany.mockResolvedValue([mockGroup]);

        const result = await service.listGroupsForEndpoint(
          { filter: 'DISPLAYNAME eq "Test Group"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // displayName filter applied in-code; "DISPLAYNAME" resolved case-insensitively
        expect(result.totalResults).toBe(1);
        expect(mockPrismaService.scimGroup.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              endpointId: mockEndpoint.id,
            }),
            orderBy: { createdAt: 'asc' },
          })
        );
      });

      it('should filter groups by externalId', async () => {
        const groupWithExt = { ...mockGroup, externalId: 'ext-123' };
        // DB push-down: externalId eq "ext-123" → Prisma where { externalId: 'ext-123' }
        // The mock returns only the matching group (simulating DB-level filtering)
        mockPrismaService.scimGroup.findMany.mockResolvedValue([groupWithExt]);

        const result = await service.listGroupsForEndpoint(
          { filter: 'externalId eq "ext-123"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(result.totalResults).toBe(1);
        expect(result.Resources[0].externalId).toBe('ext-123');
        // externalId eq is pushed to DB via the new filter parser
        expect(mockPrismaService.scimGroup.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              endpointId: mockEndpoint.id,
              externalId: 'ext-123',
            }),
          })
        );
      });

      it('should filter groups by externalId case-insensitively', async () => {
        const groupWithExt = { ...mockGroup, externalId: 'ext-abc-123' };
        mockPrismaService.scimGroup.findMany.mockResolvedValue([groupWithExt]);

        const result = await service.listGroupsForEndpoint(
          { filter: 'externalId eq "EXT-ABC-123"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(result.totalResults).toBe(1);
        expect(result.Resources[0].externalId).toBe('ext-abc-123');
      });
    });

    describe('case-insensitive schema URI validation', () => {
      it('should accept Group schema URN with different casing', async () => {
        const createDto: CreateGroupDto = {
          schemas: ['URN:IETF:PARAMS:SCIM:SCHEMAS:CORE:2.0:GROUP'],
          displayName: 'Case Schema Group',
        };

        mockPrismaService.scimGroup.create.mockResolvedValue(mockGroup);
        mockPrismaService.scimGroup.findFirst.mockResolvedValue({
          ...mockGroup,
          displayName: createDto.displayName,
        });

        // Should not throw despite different casing
        const result = await service.createGroupForEndpoint(
          createDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(result.displayName).toBe(createDto.displayName);
      });
    });
  });

  // ─── externalId Column Support ──────────────────────────────────────

  describe('externalId column support', () => {
    it('should store externalId on create when provided', async () => {
      const createDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'ExtId Group',
        externalId: 'ext-grp-001',
      } as CreateGroupDto;

      mockPrismaService.scimGroup.findMany.mockResolvedValue([]); // displayName uniqueness
      mockPrismaService.scimGroup.findFirst
        .mockResolvedValueOnce(null) // assertUniqueExternalId → no conflict
        .mockResolvedValueOnce({
          ...mockGroup,
          externalId: 'ext-grp-001',
          displayName: 'ExtId Group',
        }); // getGroupWithMembersForEndpoint after create
      mockPrismaService.scimGroup.create.mockResolvedValue({ ...mockGroup, externalId: 'ext-grp-001' });

      const result = await service.createGroupForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(mockPrismaService.scimGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            externalId: 'ext-grp-001',
          }),
        })
      );
      expect(result.externalId).toBe('ext-grp-001');
    });

    it('should return externalId in group resource when set', async () => {
      const groupWithExt = { ...mockGroup, externalId: 'ext-grp-002' };
      mockPrismaService.scimGroup.findFirst.mockResolvedValue(groupWithExt);

      const result = await service.getGroupForEndpoint(
        mockGroup.scimId,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.externalId).toBe('ext-grp-002');
    });

    it('should omit externalId from response when null', async () => {
      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);

      const result = await service.getGroupForEndpoint(
        mockGroup.scimId,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.externalId).toBeUndefined();
    });

    it('should reject duplicate externalId on create within same endpoint', async () => {
      const createDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Another Group',
        externalId: 'ext-duplicate',
      } as CreateGroupDto;

      mockPrismaService.scimGroup.findMany.mockResolvedValue([]); // displayName uniqueness
      mockPrismaService.scimGroup.findFirst.mockResolvedValue({ ...mockGroup, externalId: 'ext-duplicate' }); // externalId conflict

      await expect(
        service.createGroupForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });

    it('should update externalId via PATCH replace with path', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'externalId', value: 'ext-updated' },
        ],
      };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
      mockPrismaService.scimGroup.update.mockResolvedValue({ ...mockGroup, externalId: 'ext-updated' });

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            externalId: 'ext-updated',
          }),
        })
      );
    });

    it('should update externalId via no-path PATCH replace object', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', value: { displayName: 'Renamed', externalId: 'ext-via-nopath' } },
        ],
      };

      mockPrismaService.scimGroup.findFirst.mockResolvedValue(mockGroup);
      mockPrismaService.scimGroup.update.mockResolvedValue({ ...mockGroup, externalId: 'ext-via-nopath' });

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockPrismaService.scimGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            displayName: 'Renamed',
            externalId: 'ext-via-nopath',
          }),
        })
      );
    });
  });
});
