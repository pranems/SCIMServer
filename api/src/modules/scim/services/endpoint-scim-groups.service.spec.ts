import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EndpointScimGroupsService } from './endpoint-scim-groups.service';
import { USER_REPOSITORY, GROUP_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimMetadataService } from './scim-metadata.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ScimLogger } from '../../logging/scim-logger.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { CreateGroupDto } from '../dto/create-group.dto';
import type { PatchGroupDto } from '../dto/patch-group.dto';
import { ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';

describe('EndpointScimGroupsService', () => {
  let service: EndpointScimGroupsService;
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
    version: 1,
  };

  const mockUser = {
    id: 'user-1',
    scimId: 'scim-user-123',
    endpointId: 'endpoint-1',
  };

  const mockGroupRepo = {
    create: jest.fn(),
    findByScimId: jest.fn(),
    findWithMembers: jest.fn(),
    findAllWithMembers: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByDisplayName: jest.fn(),
    findByExternalId: jest.fn(),
    addMembers: jest.fn(),
    updateGroupWithMembers: jest.fn(),
  };

  const mockUserRepo = {
    findByScimIds: jest.fn(),
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
        ScimSchemaRegistry,
        {
          provide: GROUP_REPOSITORY,
          useValue: mockGroupRepo,
        },
        {
          provide: USER_REPOSITORY,
          useValue: mockUserRepo,
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

      mockGroupRepo.create.mockResolvedValue(mockGroup);
      mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null); // assertUniqueDisplayName → no conflict
      mockGroupRepo.findWithMembers.mockResolvedValueOnce({
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
      expect(mockGroupRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: createDto.displayName,
          endpointId: mockEndpoint.id,
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

      mockGroupRepo.create.mockResolvedValue(mockGroup);
      mockUserRepo.findByScimIds.mockResolvedValue([mockUser]);
      mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null); // assertUniqueDisplayName → no conflict
      mockGroupRepo.findWithMembers.mockResolvedValueOnce({
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
      expect(mockUserRepo.findByScimIds).toHaveBeenCalledWith(mockEndpoint.id, expect.any(Array));
    });
  });

  describe('getGroupForEndpoint', () => {
    it('should retrieve a group by scimId within endpoint', async () => {
      mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);

      const result = await service.getGroupForEndpoint(
        mockGroup.scimId,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.id).toBe(mockGroup.scimId);
      expect(result.displayName).toBe(mockGroup.displayName);
      expect(mockGroupRepo.findWithMembers).toHaveBeenCalledWith(mockEndpoint.id, mockGroup.scimId);
    });

    it('should throw 404 if group not found in endpoint', async () => {
      mockGroupRepo.findWithMembers.mockResolvedValue(null);

      await expect(
        service.getGroupForEndpoint('non-existent', 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });
  });

  describe('listGroupsForEndpoint', () => {
    it('should list groups within a specific endpoint', async () => {
      const groups = [mockGroup, { ...mockGroup, id: 'group-2', scimId: 'scim-grp-456' }];

      mockGroupRepo.findAllWithMembers.mockResolvedValue(groups);

      const result = await service.listGroupsForEndpoint(
        { startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
      expect(result.startIndex).toBe(1);
      expect(mockGroupRepo.findAllWithMembers).toHaveBeenCalledWith(mockEndpoint.id, expect.any(Object), expect.any(Object));
    });

    it('should filter groups by displayName within endpoint', async () => {
      mockGroupRepo.findAllWithMembers.mockResolvedValue([mockGroup]);

      const result = await service.listGroupsForEndpoint(
        { filter: 'displayName eq "Test Group"', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // displayName filter is now applied in-code for case-insensitive matching
      expect(result.totalResults).toBe(1);
      expect(mockGroupRepo.findAllWithMembers).toHaveBeenCalledWith(mockEndpoint.id, expect.any(Object), expect.any(Object));
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

      mockGroupRepo.findWithMembers
        .mockResolvedValueOnce(mockGroup)
        .mockResolvedValueOnce({
          ...mockGroup,
          displayName: 'Updated Group Name',
        });
      mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

      const result = await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockGroupRepo.findWithMembers).toHaveBeenCalledWith(mockEndpoint.id, mockGroup.scimId);
      expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
        displayName: 'Updated Group Name',
      }), expect.any(Array));
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
      mockGroupRepo.findWithMembers
        .mockResolvedValueOnce(mockGroup)
        .mockResolvedValueOnce(updatedGroup);
      mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

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

      mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);
      mockUserRepo.findByScimIds.mockResolvedValue([mockUser]);
      mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
      expect(mockUserRepo.findByScimIds).toHaveBeenCalledWith(mockEndpoint.id, expect.any(Array));
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

      mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMember);
      mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);
        // Default config returns empty object (flag is false)
        mockEndpointContext.getConfig.mockReturnValue({});

        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        // Should not attempt to create members
        expect(mockGroupRepo.updateGroupWithMembers).not.toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);
        mockUserRepo.findByScimIds.mockResolvedValue([]);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Enable the flag
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Should process the operation
        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);
        mockUserRepo.findByScimIds.mockResolvedValue([]);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Enable the flag with boolean
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestAddMultipleMembersToGroup: true,
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);
        mockUserRepo.findByScimIds.mockResolvedValue([mockUser]);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Flag is false (default)
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Single member add should succeed
        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);
        mockUserRepo.findByScimIds.mockResolvedValue([]);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Flag is false
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Multiple operations with single member each should succeed
        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        // Default config returns empty object (flag is false)
        mockEndpointContext.getConfig.mockReturnValue({});

        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        // Should not attempt to update group
        expect(mockGroupRepo.updateGroupWithMembers).not.toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        mockEndpointContext.getConfig.mockReturnValue({
          MultiOpPatchRequestRemoveMultipleMembersFromGroup: true,
        });

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Flag is false (default)
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Single member remove should succeed
        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Flag is false (default)
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Single member remove should succeed
        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Flag is false
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Multiple operations with single member each should succeed
        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
        // Default config - PatchOpAllowRemoveAllMembers defaults to true
        mockEndpointContext.getConfig.mockReturnValue({});

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Should remove all members (empty members array)
        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockEndpointContext.getConfig.mockReturnValue({
          PatchOpAllowRemoveAllMembers: false,
        });

        // path=members without value array should be rejected
        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        expect(mockGroupRepo.updateGroupWithMembers).not.toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers.mockResolvedValue(groupWithMultipleMembers);
        mockEndpointContext.getConfig.mockReturnValue({
          PatchOpAllowRemoveAllMembers: 'False',
        });

        // path=members without value array should be rejected
        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        expect(mockGroupRepo.updateGroupWithMembers).not.toHaveBeenCalled();
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

        mockGroupRepo.findWithMembers
          .mockResolvedValueOnce(mockGroup)
          .mockResolvedValueOnce({
            ...mockGroup,
            displayName: 'New Display Name',
          });
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
          displayName: 'New Display Name',
        }), expect.any(Array));
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

        mockGroupRepo.findWithMembers
          .mockResolvedValueOnce(mockGroup)
          .mockResolvedValueOnce(mockGroup);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
          externalId: 'new-ext-id',
        }), expect.any(Array));
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

        mockGroupRepo.findWithMembers
          .mockResolvedValueOnce(mockGroup)
          .mockResolvedValueOnce({
            ...mockGroup,
            displayName: 'Combined',
          });
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
          displayName: 'Combined',
          externalId: 'ext-combined',
        }), expect.any(Array));
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

        mockGroupRepo.findWithMembers
          .mockResolvedValueOnce(mockGroup)
          .mockResolvedValueOnce(mockGroup);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
          externalId: 'pathed-ext-id',
        }), expect.any(Array));
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

        mockGroupRepo.findWithMembers
          .mockResolvedValueOnce(mockGroup)
          .mockResolvedValueOnce({
            ...mockGroup,
            displayName: 'Direct String Name',
          });
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
          displayName: 'Direct String Name',
        }), expect.any(Array));
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

        mockGroupRepo.findWithMembers
          .mockResolvedValueOnce(mockGroup)
          .mockResolvedValueOnce({
            ...mockGroup,
            displayName: 'Group With Members',
          });
        mockUserRepo.findByScimIds.mockResolvedValue([]);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

        await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
          displayName: 'Group With Members',
        }), expect.any(Array));
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

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);

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

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);

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

      mockGroupRepo.findWithMembers.mockResolvedValue(null);

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

      mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);

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

      mockGroupRepo.findWithMembers
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

      mockUserRepo.findByScimIds.mockResolvedValue([mockUser]);
      mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

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
      mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
      mockGroupRepo.delete.mockResolvedValue(undefined);

      await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id);

      expect(mockGroupRepo.findByScimId).toHaveBeenCalledWith(mockEndpoint.id, mockGroup.scimId);
      expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);
    });

    it('should throw 404 if group not found in endpoint', async () => {
      mockGroupRepo.findByScimId.mockResolvedValue(null);

      await expect(
        service.deleteGroupForEndpoint('non-existent', mockEndpoint.id)
      ).rejects.toThrow(HttpException);

      expect(mockGroupRepo.delete).not.toHaveBeenCalled();
    });

    describe('soft delete', () => {
      it('should soft-delete group when SoftDeleteEnabled is true (boolean)', async () => {
        mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
        mockGroupRepo.update.mockResolvedValue({ ...mockGroup, active: false });

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true };
        await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);

        expect(mockGroupRepo.update).toHaveBeenCalledWith(mockGroup.id, { active: false });
        expect(mockGroupRepo.delete).not.toHaveBeenCalled();
      });

      it('should soft-delete group when SoftDeleteEnabled is "True" (string)', async () => {
        mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
        mockGroupRepo.update.mockResolvedValue({ ...mockGroup, active: false });

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: 'True' };
        await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);

        expect(mockGroupRepo.update).toHaveBeenCalledWith(mockGroup.id, { active: false });
        expect(mockGroupRepo.delete).not.toHaveBeenCalled();
      });

      it('should hard-delete group when SoftDeleteEnabled is false', async () => {
        mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
        mockGroupRepo.delete.mockResolvedValue(undefined);

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: false };
        await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);

        expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);
        expect(mockGroupRepo.update).not.toHaveBeenCalled();
      });

      it('should hard-delete group when SoftDeleteEnabled is "False" (string)', async () => {
        mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
        mockGroupRepo.delete.mockResolvedValue(undefined);

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: 'False' };
        await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);

        expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);
        expect(mockGroupRepo.update).not.toHaveBeenCalled();
      });

      it('should hard-delete group when config is undefined (default)', async () => {
        mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
        mockGroupRepo.delete.mockResolvedValue(undefined);

        await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, undefined);

        expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);
        expect(mockGroupRepo.update).not.toHaveBeenCalled();
      });

      it('should hard-delete group when config has no SoftDeleteEnabled key', async () => {
        mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
        mockGroupRepo.delete.mockResolvedValue(undefined);

        const config: EndpointConfig = {};
        await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);

        expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);
        expect(mockGroupRepo.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('endpoint isolation', () => {
    it('should not allow accessing groups from different endpoints', async () => {
      const endpoint2 = { ...mockEndpoint, id: 'endpoint-2' };

      mockGroupRepo.findWithMembers.mockResolvedValue(null);

      await expect(
        service.getGroupForEndpoint(mockGroup.scimId, 'http://localhost:3000/scim', endpoint2.id)
      ).rejects.toThrow(HttpException);

      expect(mockGroupRepo.findWithMembers).toHaveBeenCalledWith(endpoint2.id, mockGroup.scimId);
    });

    it('should allow same displayName across different endpoints', async () => {
      const createDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Shared Group Name',
      };

      mockGroupRepo.create.mockResolvedValue({
        ...mockGroup,
        id: 'group-2',
        endpointId: 'endpoint-2',
        displayName: createDto.displayName,
      });
      mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null); // assertUniqueDisplayName → no conflict
      mockGroupRepo.findWithMembers.mockResolvedValueOnce({
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

      mockGroupRepo.create.mockResolvedValue(mockGroup);
      // No users found in this endpoint
      mockUserRepo.findByScimIds.mockResolvedValue([]);
      mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null); // assertUniqueDisplayName → no conflict
      mockGroupRepo.findWithMembers.mockResolvedValueOnce({
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
      expect(mockUserRepo.findByScimIds).toHaveBeenCalledWith(mockEndpoint.id, expect.any(Array));
    });
  });

  // ─── RFC 7643 Case-Insensitivity Compliance ────────────────────────

  describe('case-insensitivity compliance (RFC 7643)', () => {
    describe('filter attribute names', () => {
      it('should accept filter with "DisplayName" (mixed case) as attribute', async () => {
        mockGroupRepo.findAllWithMembers.mockResolvedValue([mockGroup]);

        const result = await service.listGroupsForEndpoint(
          { filter: 'DisplayName eq "Test Group"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // displayName filter applied in-code; attribute resolved case-insensitively
        expect(result.totalResults).toBe(1);
        expect(mockGroupRepo.findAllWithMembers).toHaveBeenCalledWith(mockEndpoint.id, expect.any(Object), expect.any(Object));
      });

      it('should accept filter with "DISPLAYNAME" (all caps) as attribute', async () => {
        mockGroupRepo.findAllWithMembers.mockResolvedValue([mockGroup]);

        const result = await service.listGroupsForEndpoint(
          { filter: 'DISPLAYNAME eq "Test Group"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // displayName filter applied in-code; "DISPLAYNAME" resolved case-insensitively
        expect(result.totalResults).toBe(1);
        expect(mockGroupRepo.findAllWithMembers).toHaveBeenCalledWith(mockEndpoint.id, expect.any(Object), expect.any(Object));
      });

      it('should filter groups by externalId', async () => {
        const groupWithExt = { ...mockGroup, externalId: 'ext-123' };
        // DB push-down: externalId eq "ext-123" → Prisma where { externalId: 'ext-123' }
        // The mock returns only the matching group (simulating DB-level filtering)
        mockGroupRepo.findAllWithMembers.mockResolvedValue([groupWithExt]);

        const result = await service.listGroupsForEndpoint(
          { filter: 'externalId eq "ext-123"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(result.totalResults).toBe(1);
        expect(result.Resources[0].externalId).toBe('ext-123');
        // externalId eq is pushed to DB via the new filter parser
        expect(mockGroupRepo.findAllWithMembers).toHaveBeenCalledWith(mockEndpoint.id, expect.objectContaining({
          externalId: 'ext-123',
        }), expect.any(Object));
      });

      it('should filter groups by externalId case-insensitively', async () => {
        const groupWithExt = { ...mockGroup, externalId: 'ext-abc-123' };
        mockGroupRepo.findAllWithMembers.mockResolvedValue([groupWithExt]);

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

        mockGroupRepo.create.mockResolvedValue(mockGroup);
        mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null); // assertUniqueDisplayName → no conflict
        mockGroupRepo.findWithMembers.mockResolvedValueOnce({
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

      mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null); // assertUniqueDisplayName → no conflict
      mockGroupRepo.findByExternalId.mockResolvedValueOnce(null); // assertUniqueExternalId → no conflict
      mockGroupRepo.findWithMembers.mockResolvedValueOnce({
        ...mockGroup,
        externalId: 'ext-grp-001',
        displayName: 'ExtId Group',
      }); // getGroupWithMembersForEndpoint after create
      mockGroupRepo.create.mockResolvedValue({ ...mockGroup, externalId: 'ext-grp-001' });

      const result = await service.createGroupForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(mockGroupRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'ext-grp-001',
        })
      );
      expect(result.externalId).toBe('ext-grp-001');
    });

    it('should return externalId in group resource when set', async () => {
      const groupWithExt = { ...mockGroup, externalId: 'ext-grp-002' };
      mockGroupRepo.findWithMembers.mockResolvedValue(groupWithExt);

      const result = await service.getGroupForEndpoint(
        mockGroup.scimId,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.externalId).toBe('ext-grp-002');
    });

    it('should omit externalId from response when null', async () => {
      mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);

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

      mockGroupRepo.findByDisplayName.mockResolvedValue(null); // displayName uniqueness - no conflict
      mockGroupRepo.findByExternalId.mockResolvedValue({ ...mockGroup, externalId: 'ext-duplicate' }); // externalId conflict

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

      mockGroupRepo.findWithMembers
        .mockResolvedValueOnce(mockGroup)
        .mockResolvedValueOnce({ ...mockGroup, externalId: 'ext-updated' });
      mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
        externalId: 'ext-updated',
      }), expect.any(Array));
    });

    it('should update externalId via no-path PATCH replace object', async () => {
      const patchDto: PatchGroupDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', value: { displayName: 'Renamed', externalId: 'ext-via-nopath' } },
        ],
      };

      mockGroupRepo.findWithMembers
        .mockResolvedValueOnce(mockGroup)
        .mockResolvedValueOnce({ ...mockGroup, externalId: 'ext-via-nopath' });
      mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);

      await service.patchGroupForEndpoint(mockGroup.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id);

      expect(mockGroupRepo.updateGroupWithMembers).toHaveBeenCalledWith(mockGroup.id, expect.objectContaining({
        displayName: 'Renamed',
        externalId: 'ext-via-nopath',
      }), expect.any(Array));
    });
  });

  describe('strict schema validation', () => {
    const ENTERPRISE_USER_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    describe('createGroupForEndpoint with StrictSchemaValidation', () => {
      it('should reject extension URN NOT declared in schemas[] (strict mode)', async () => {
        const createDto: CreateGroupDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Strict Group',
          [ENTERPRISE_USER_URN]: { department: 'Engineering' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

        await expect(
          service.createGroupForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);

        expect(mockGroupRepo.create).not.toHaveBeenCalled();
      });

      it('should allow extension URN when strict mode is OFF', async () => {
        const createDto: CreateGroupDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Lenient Group',
          [ENTERPRISE_USER_URN]: { department: 'Engineering' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: false };

        mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null);
        mockGroupRepo.create.mockResolvedValue(mockGroup);
        mockGroupRepo.findWithMembers.mockResolvedValueOnce({
          ...mockGroup,
          displayName: createDto.displayName,
        });

        const result = await service.createGroupForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, config
        );

        expect(result.displayName).toBe(createDto.displayName);
        expect(mockGroupRepo.create).toHaveBeenCalled();
      });

      it('should allow extension URN when config is undefined (default lenient)', async () => {
        const createDto: CreateGroupDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Default Group',
          [ENTERPRISE_USER_URN]: { department: 'Engineering' },
        } as any;

        mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null);
        mockGroupRepo.create.mockResolvedValue(mockGroup);
        mockGroupRepo.findWithMembers.mockResolvedValueOnce({
          ...mockGroup,
          displayName: createDto.displayName,
        });

        const result = await service.createGroupForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, undefined
        );

        expect(result.displayName).toBe(createDto.displayName);
      });
    });

    describe('replaceGroupForEndpoint with StrictSchemaValidation', () => {
      it('should reject undeclared extension URN on PUT (strict mode)', async () => {
        const replaceDto: CreateGroupDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Replaced Group',
          [ENTERPRISE_USER_URN]: { department: 'Sales' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);

        await expect(
          service.replaceGroupForEndpoint(mockGroup.scimId, replaceDto, 'http://localhost:3000/scim', mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);
      });
    });

    describe('schema attribute type validation through service', () => {
      const strictConfig: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

      it('should reject wrong type for displayName on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 123,  // should be string
        } as any;

        await expect(
          service.createGroupForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should reject unknown core attribute on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Valid Group',
          unknownGroupField: 'should-fail',
        } as any;

        await expect(
          service.createGroupForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should reject non-array members on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Invalid Members Group',
          members: { value: 'u1' },  // should be array
        } as any;

        await expect(
          service.createGroupForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should accept valid Group payload on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Engineering',
          members: [{ value: 'u1', display: 'Alice' }],
        } as any;

        mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null);
        mockGroupRepo.create.mockResolvedValue(mockGroup);
        mockGroupRepo.findWithMembers.mockResolvedValueOnce({
          ...mockGroup,
          displayName: createDto.displayName,
        });

        const result = await service.createGroupForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig
        );
        expect(result.displayName).toBe(createDto.displayName);
      });

      it('should include error detail in schema validation HttpException', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 42,
        } as any;

        try {
          await service.createGroupForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig);
          fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(HttpException);
          const resp = (e as HttpException).getResponse();
          expect(JSON.stringify(resp)).toContain('Schema validation failed');
          expect((e as HttpException).getStatus()).toBe(400);
        }
      });

      it('should NOT reject wrong type when strict mode is OFF', async () => {
        const lenientConfig: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: false };
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: 'Lenient Group',
        } as any;

        mockGroupRepo.findByDisplayName.mockResolvedValueOnce(null);
        mockGroupRepo.create.mockResolvedValue(mockGroup);
        mockGroupRepo.findWithMembers.mockResolvedValueOnce({
          ...mockGroup,
          displayName: createDto.displayName,
        });

        const result = await service.createGroupForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, lenientConfig
        );
        expect(result.displayName).toBe(createDto.displayName);
      });

      it('should reject wrong type on replace (strict)', async () => {
        const replaceDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: false,  // should be string
        } as any;

        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);

        await expect(
          service.replaceGroupForEndpoint(mockGroup.scimId, replaceDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });
    });
  });

  describe('dynamic schemas[] in group response', () => {
    it('should include extension URNs present in rawPayload', async () => {
      const extensionUrn = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const groupWithExtension = {
        ...mockGroup,
        rawPayload: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          [extensionUrn]: { department: 'Test' },
        }),
      };

      mockGroupRepo.findWithMembers.mockResolvedValue(groupWithExtension);

      const result = await service.getGroupForEndpoint(
        mockGroup.scimId, 'http://localhost:3000/scim', mockEndpoint.id
      );

      // The result should have the core schema
      expect(result.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
    });

    it('should not include extension URNs NOT present in rawPayload', async () => {
      const groupWithoutExtension = {
        ...mockGroup,
        rawPayload: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          description: 'Plain group',
        }),
      };

      mockGroupRepo.findWithMembers.mockResolvedValue(groupWithoutExtension);

      const result = await service.getGroupForEndpoint(
        mockGroup.scimId, 'http://localhost:3000/scim', mockEndpoint.id
      );

      expect(result.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:Group']);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Soft Delete + GET / LIST interactions (Groups)
  // ═══════════════════════════════════════════════════════════

  describe('soft delete + GET/LIST interactions (Groups)', () => {
    const softDeleteConfig: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true };

    it('should soft-delete group, then GET returns the group (active=false implied)', async () => {
      mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
      mockGroupRepo.update.mockResolvedValue({ ...mockGroup });

      await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, softDeleteConfig);
      expect(mockGroupRepo.update).toHaveBeenCalledWith(mockGroup.id, { active: false });
      expect(mockGroupRepo.delete).not.toHaveBeenCalled();

      // GET after soft-delete: group still found
      mockGroupRepo.findWithMembers.mockResolvedValue({ ...mockGroup, members: [] });
      const result = await service.getGroupForEndpoint(
        mockGroup.scimId, 'http://localhost:3000/scim', mockEndpoint.id
      );
      expect(result).toBeDefined();
      expect(result.displayName).toBe(mockGroup.displayName);
    });

    it('should hard-delete group, then GET returns 404', async () => {
      const hardDeleteConfig: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: false };
      mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
      mockGroupRepo.delete.mockResolvedValue(mockGroup);

      await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, hardDeleteConfig);
      expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);

      // GET after hard-delete: not found
      mockGroupRepo.findWithMembers.mockResolvedValue(null);
      await expect(
        service.getGroupForEndpoint(mockGroup.scimId, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });

    it('should include soft-deleted groups in LIST results', async () => {
      const activeGroup = { ...mockGroup, id: 'g1', scimId: 'scim-g1', members: [] };
      const deletedGroup = { ...mockGroup, id: 'g2', scimId: 'scim-g2', displayName: 'Deleted Group', members: [] };
      mockGroupRepo.findAllWithMembers.mockResolvedValue([activeGroup, deletedGroup]);

      const result = await service.listGroupsForEndpoint(
        { startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Config flag combinations (Groups)
  // ═══════════════════════════════════════════════════════════

  describe('config flag combinations (Groups)', () => {
    it('should soft-delete with SoftDeleteEnabled + StrictSchemaValidation both true', async () => {
      mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
      mockGroupRepo.update.mockResolvedValue({ ...mockGroup });

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      };

      await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);
      expect(mockGroupRepo.update).toHaveBeenCalledWith(mockGroup.id, { active: false });
      expect(mockGroupRepo.delete).not.toHaveBeenCalled();
    });

    it('should soft-delete with SoftDeleteEnabled + MultiOpPatch flags', async () => {
      mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
      mockGroupRepo.update.mockResolvedValue({ ...mockGroup });

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        MultiOpPatchRequestAddMultipleMembersToGroup: true,
        MultiOpPatchRequestRemoveMultipleMembersFromGroup: true,
      };

      await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);
      expect(mockGroupRepo.update).toHaveBeenCalledWith(mockGroup.id, { active: false });
    });

    it('should hard-delete when SoftDeleteEnabled=false despite other flags', async () => {
      mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
      mockGroupRepo.delete.mockResolvedValue(mockGroup);

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: false,
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
        MultiOpPatchRequestAddMultipleMembersToGroup: true,
      };

      await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config);
      expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);
      expect(mockGroupRepo.update).not.toHaveBeenCalled();
    });

    it('should reject unknown extension on CREATE when StrictSchemaValidation=true', async () => {
      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      };

      const createDto: CreateGroupDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', 'urn:unknown:fake:1.0:Group'],
        displayName: 'Strict Test Group',
        'urn:unknown:fake:1.0:Group': { custom: 'data' },
      } as any;

      mockGroupRepo.findByDisplayName.mockResolvedValue(null);
      mockGroupRepo.findByExternalId.mockResolvedValue(null);

      await expect(
        service.createGroupForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config)
      ).rejects.toThrow();
    });
  });

  // ─── Phase 7: ETag & Conditional Requests ──────────────────────────────

  describe('ETag & Conditional Requests (Phase 7)', () => {
    const patchDto: PatchGroupDto = {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'displayName', value: 'Updated Group' }],
    };

    const replaceDto: CreateGroupDto = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      displayName: 'Replaced Group',
    };

    const baseUrl = 'http://localhost:3000/scim';

    describe('patchGroupForEndpoint', () => {
      beforeEach(() => {
        mockGroupRepo.findWithMembers
          .mockResolvedValueOnce(mockGroup) // initial lookup
          .mockResolvedValueOnce({ ...mockGroup, displayName: 'Updated Group' }); // re-read after update
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
      });

      it('should succeed when If-Match matches current ETag', async () => {
        const result = await service.patchGroupForEndpoint(
          mockGroup.scimId, patchDto, baseUrl, mockEndpoint.id, undefined, 'W/"v1"'
        );
        expect(result).toBeDefined();
      });

      it('should throw 412 when If-Match does not match current ETag', async () => {
        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, baseUrl, mockEndpoint.id, undefined, 'W/"v999"')
        ).rejects.toMatchObject({ status: 412 });
      });

      it('should throw 428 when RequireIfMatch=true and no If-Match header', async () => {
        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: true };
        await expect(
          service.patchGroupForEndpoint(mockGroup.scimId, patchDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toMatchObject({ status: 428 });
      });

      it('should succeed when If-Match is wildcard (*)', async () => {
        const result = await service.patchGroupForEndpoint(
          mockGroup.scimId, patchDto, baseUrl, mockEndpoint.id, undefined, '*'
        );
        expect(result).toBeDefined();
      });
    });

    describe('replaceGroupForEndpoint', () => {
      beforeEach(() => {
        mockGroupRepo.findWithMembers.mockResolvedValue(mockGroup);
        mockGroupRepo.findByDisplayName.mockResolvedValue(null);
        mockGroupRepo.updateGroupWithMembers.mockResolvedValue(undefined);
      });

      it('should succeed when If-Match matches current ETag', async () => {
        const result = await service.replaceGroupForEndpoint(
          mockGroup.scimId, replaceDto, baseUrl, mockEndpoint.id, undefined, 'W/"v1"'
        );
        expect(result).toBeDefined();
      });

      it('should throw 412 when If-Match does not match current ETag', async () => {
        await expect(
          service.replaceGroupForEndpoint(mockGroup.scimId, replaceDto, baseUrl, mockEndpoint.id, undefined, 'W/"v999"')
        ).rejects.toMatchObject({ status: 412 });
      });

      it('should throw 428 when RequireIfMatch=true and no If-Match header', async () => {
        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: true };
        await expect(
          service.replaceGroupForEndpoint(mockGroup.scimId, replaceDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toMatchObject({ status: 428 });
      });
    });

    describe('deleteGroupForEndpoint', () => {
      beforeEach(() => {
        mockGroupRepo.findByScimId.mockResolvedValue(mockGroup);
        mockGroupRepo.delete.mockResolvedValue(mockGroup);
      });

      it('should succeed when If-Match matches current ETag', async () => {
        await service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, undefined, 'W/"v1"');
        expect(mockGroupRepo.delete).toHaveBeenCalledWith(mockGroup.id);
      });

      it('should throw 412 when If-Match does not match current ETag', async () => {
        await expect(
          service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, undefined, 'W/"v999"')
        ).rejects.toMatchObject({ status: 412 });
      });

      it('should throw 428 when RequireIfMatch=true and no If-Match header', async () => {
        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: true };
        await expect(
          service.deleteGroupForEndpoint(mockGroup.scimId, mockEndpoint.id, config)
        ).rejects.toMatchObject({ status: 428 });
      });
    });

    describe('ETag format', () => {
      it('should include version-based ETag W/"v{N}" in response meta', async () => {
        mockGroupRepo.findWithMembers.mockResolvedValue({ ...mockGroup, version: 5 });
        const result = await service.getGroupForEndpoint(
          mockGroup.scimId, baseUrl, mockEndpoint.id
        );
        expect(result.meta.version).toBe('W/"v5"');
      });
    });
  });
});
