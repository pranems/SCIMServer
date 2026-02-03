import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EndpointScimUsersService } from './endpoint-scim-users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimMetadataService } from './scim-metadata.service';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';

describe('EndpointScimUsersService', () => {
  let service: EndpointScimUsersService;
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

  const mockUser = {
    id: 'user-1',
    scimId: 'scim-123',
    endpointId: 'endpoint-1',
    externalId: 'ext-123',
    userName: 'test@example.com',
    active: true,
    rawPayload: '{"displayName":"Test User"}',
    meta: JSON.stringify({
      resourceType: 'User',
      created: '2024-01-01T00:00:00.000Z',
      lastModified: '2024-01-01T00:00:00.000Z',
    }),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  const mockPrismaService = {
    scimUser: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockMetadataService = {
    buildLocation: jest.fn((baseUrl: string, resourceType: string, id: string) => 
      `${baseUrl}/${resourceType}/${id}`
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndpointScimUsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ScimMetadataService,
          useValue: mockMetadataService,
        },
      ],
    }).compile();

    service = module.get<EndpointScimUsersService>(EndpointScimUsersService);
    prismaService = module.get<PrismaService>(PrismaService);
    metadataService = module.get<ScimMetadataService>(ScimMetadataService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUserForEndpoint', () => {
    it('should create a user for a specific endpoint', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'newuser@example.com',
        externalId: 'ext-456',
        active: true,
        displayName: 'New User',
      };

      mockPrismaService.scimUser.findFirst.mockResolvedValue(null); // No conflicts
      mockPrismaService.scimUser.create.mockResolvedValue({
        ...mockUser,
        userName: createDto.userName,
        externalId: createDto.externalId,
      });

      const result = await service.createUserForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.userName).toBe(createDto.userName);
      expect(result.externalId).toBe(createDto.externalId);
      expect(result.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(mockPrismaService.scimUser.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userName: createDto.userName,
            externalId: createDto.externalId,
            endpoint: { connect: { id: mockEndpoint.id } },
          }),
        })
      );
    });

    it('should enforce unique userName within endpoint', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'duplicate@example.com',
        active: true,
      };

      mockPrismaService.scimUser.findFirst.mockResolvedValue(mockUser);

      await expect(
        service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow();

      expect(mockPrismaService.scimUser.create).not.toHaveBeenCalled();
    });

    it('should enforce unique externalId within endpoint', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'unique@example.com',
        externalId: 'duplicate-ext-id',
        active: true,
      };

      mockPrismaService.scimUser.findFirst.mockResolvedValue(mockUser);

      await expect(
        service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow();

      expect(mockPrismaService.scimUser.create).not.toHaveBeenCalled();
    });
  });

  describe('getUserForEndpoint', () => {
    it('should retrieve a user by scimId within endpoint', async () => {
      mockPrismaService.scimUser.findFirst.mockResolvedValue(mockUser);

      const result = await service.getUserForEndpoint(
        mockUser.scimId,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.id).toBe(mockUser.scimId);
      expect(result.userName).toBe(mockUser.userName);
      expect(mockPrismaService.scimUser.findFirst).toHaveBeenCalledWith({
        where: {
          scimId: mockUser.scimId,
          endpointId: mockEndpoint.id,
        },
      });
    });

    it('should throw 404 if user not found in endpoint', async () => {
      mockPrismaService.scimUser.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserForEndpoint('non-existent', 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });
  });

  describe('listUsersForEndpoint', () => {
    it('should list users within a specific endpoint', async () => {
      const users = [mockUser, { ...mockUser, id: 'user-2', scimId: 'scim-456' }];

      mockPrismaService.scimUser.count.mockResolvedValue(2);
      mockPrismaService.scimUser.findMany.mockResolvedValue(users);

      const result = await service.listUsersForEndpoint(
        { startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
      expect(result.startIndex).toBe(1);
      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
        })
      );
    });

    it('should filter users by userName within endpoint', async () => {
      mockPrismaService.scimUser.count.mockResolvedValue(1);
      mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

      const result = await service.listUsersForEndpoint(
        { filter: 'userName eq "test@example.com"', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(1);
      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userName: 'test@example.com',
            endpointId: mockEndpoint.id,
          }),
        })
      );
    });

    it('should respect pagination within endpoint', async () => {
      mockPrismaService.scimUser.count.mockResolvedValue(100);
      mockPrismaService.scimUser.findMany.mockResolvedValue([]);

      await service.listUsersForEndpoint(
        { startIndex: 11, count: 20 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 20,
        })
      );
    });
  });

  describe('patchUserForEndpoint', () => {
    it('should update user active status within endpoint', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: 'active',
            value: false,
          },
        ],
      };

      // First call finds the user, second call is for uniqueness check (returns null = no conflict)
      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);
      mockPrismaService.scimUser.update.mockResolvedValue({
        ...mockUser,
        active: false,
      });

      const result = await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.active).toBe(false);
      expect(mockPrismaService.scimUser.findFirst).toHaveBeenCalledWith({
        where: {
          scimId: mockUser.scimId,
          endpointId: mockEndpoint.id,
        },
      });
    });

    it('should update userName ensuring uniqueness within endpoint', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: 'userName',
            value: 'newemail@example.com',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser) // Find user to update
        .mockResolvedValueOnce(null); // No conflict

      mockPrismaService.scimUser.update.mockResolvedValue({
        ...mockUser,
        userName: 'newemail@example.com',
      });

      const result = await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.userName).toBe('newemail@example.com');
    });
  });

  describe('replaceUserForEndpoint', () => {
    it('should replace user data within endpoint', async () => {
      const replaceDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'replaced@example.com',
        externalId: 'replaced-ext',
        active: false,
        displayName: 'Replaced User',
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser) // Find user to replace
        .mockResolvedValueOnce(null); // No conflict

      mockPrismaService.scimUser.update.mockResolvedValue({
        ...mockUser,
        userName: replaceDto.userName,
        externalId: replaceDto.externalId,
        active: replaceDto.active,
      });

      const result = await service.replaceUserForEndpoint(
        mockUser.scimId,
        replaceDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.userName).toBe(replaceDto.userName);
      expect(result.externalId).toBe(replaceDto.externalId);
      expect(result.active).toBe(replaceDto.active);
    });
  });

  describe('deleteUserForEndpoint', () => {
    it('should delete user within endpoint', async () => {
      mockPrismaService.scimUser.findFirst.mockResolvedValue(mockUser);
      mockPrismaService.scimUser.delete.mockResolvedValue(mockUser);

      await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id);

      expect(mockPrismaService.scimUser.findFirst).toHaveBeenCalledWith({
        where: {
          scimId: mockUser.scimId,
          endpointId: mockEndpoint.id,
        },
      });
      expect(mockPrismaService.scimUser.delete).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
    });

    it('should throw 404 if user not found in endpoint', async () => {
      mockPrismaService.scimUser.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteUserForEndpoint('non-existent', mockEndpoint.id)
      ).rejects.toThrow(HttpException);

      expect(mockPrismaService.scimUser.delete).not.toHaveBeenCalled();
    });
  });

  describe('endpoint isolation', () => {
    it('should not allow accessing users from different endpoints', async () => {
      const endpoint2 = { ...mockEndpoint, id: 'endpoint-2' };
      
      mockPrismaService.scimUser.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserForEndpoint(mockUser.scimId, 'http://localhost:3000/scim', endpoint2.id)
      ).rejects.toThrow(HttpException);

      expect(mockPrismaService.scimUser.findFirst).toHaveBeenCalledWith({
        where: {
          scimId: mockUser.scimId,
          endpointId: endpoint2.id,
        },
      });
    });

    it('should allow same userName across different endpoints', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'shared@example.com',
        active: true,
      };

      // No conflict within endpoint-2
      mockPrismaService.scimUser.findFirst.mockResolvedValue(null);
      mockPrismaService.scimUser.create.mockResolvedValue({
        ...mockUser,
        id: 'user-2',
        endpointId: 'endpoint-2',
        userName: createDto.userName,
      });

      const result = await service.createUserForEndpoint(
        createDto,
        'http://localhost:3000/scim',
        'endpoint-2'
      );

      expect(result.userName).toBe(createDto.userName);
      // Verify that endpoint isolation is enforced in the uniqueness check
      expect(mockPrismaService.scimUser.findFirst).toHaveBeenCalled();
    });
  });
});
