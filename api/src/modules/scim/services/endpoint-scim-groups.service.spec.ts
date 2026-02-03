import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EndpointScimGroupsService } from './endpoint-scim-groups.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimMetadataService } from './scim-metadata.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
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
      mockPrismaService.scimGroup.count.mockResolvedValue(1);
      mockPrismaService.scimGroup.findMany.mockResolvedValue([mockGroup]);

      const result = await service.listGroupsForEndpoint(
        { filter: 'displayName eq "Test Group"', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(1);
      expect(mockPrismaService.scimGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            displayName: 'Test Group',
            endpointId: mockEndpoint.id,
          }),
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

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id);

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

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id);

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

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id);

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
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id)
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

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id);

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

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id);

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

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id);

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

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, mockEndpoint.id);

        // Multiple operations with single member each should succeed
        expect(mockPrismaService.groupMember.createMany).toHaveBeenCalled();
      });
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
});
