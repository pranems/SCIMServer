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
    userNameLower: 'test@example.com',
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
      mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

      const result = await service.listUsersForEndpoint(
        { filter: 'userName eq "test@example.com"', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // userName filter is now applied in-code (not via Prisma where) for case-insensitive matching
      expect(result.totalResults).toBe(1);
      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
          orderBy: { createdAt: 'asc' },
        })
      );
    });

    it('should respect pagination within endpoint', async () => {
      // Create 30 mock users to test in-code pagination
      const manyUsers = Array.from({ length: 30 }, (_, i) => ({
        ...mockUser,
        id: `user-${i}`,
        scimId: `scim-${i}`,
        userName: `user${i}@example.com`,
        userNameLower: `user${i}@example.com`,
      }));
      mockPrismaService.scimUser.findMany.mockResolvedValue(manyUsers);

      const result = await service.listUsersForEndpoint(
        { startIndex: 11, count: 20 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // Pagination is now applied in-code via slice()
      expect(result.totalResults).toBe(30);
      expect(result.startIndex).toBe(11);
      expect(result.itemsPerPage).toBe(20);
      expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
          orderBy: { createdAt: 'asc' },
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

    it('should update userName via no-path replace with object value', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            value: { userName: 'nopath@example.com' },
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockResolvedValue({
        ...mockUser,
        userName: 'nopath@example.com',
      });

      const result = await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.userName).toBe('nopath@example.com');
      expect(mockPrismaService.scimUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userName: 'nopath@example.com',
          }),
        })
      );
    });

    it('should update externalId and active via no-path replace', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            value: { externalId: 'new-ext-id', active: false },
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockResolvedValue({
        ...mockUser,
        externalId: 'new-ext-id',
        active: false,
      });

      const result = await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.externalId).toBe('new-ext-id');
      expect(result.active).toBe(false);
    });

    it('should resolve valuePath emails[type eq "work"].value in PATCH replace', async () => {
      const userWithEmails = {
        ...mockUser,
        rawPayload: JSON.stringify({
          displayName: 'Test User',
          emails: [{ type: 'work', value: 'old@example.com', primary: true }],
        }),
      };

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: 'emails[type eq "work"].value',
            value: 'new@example.com',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(userWithEmails)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...userWithEmails,
        rawPayload: data.rawPayload,
      }));

      const result = await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // The rawPayload stored should have the email updated in-place
      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload.emails[0].value).toBe('new@example.com');
      expect(storedPayload.emails[0].type).toBe('work');
      expect(storedPayload.emails[0].primary).toBe(true);
    });

    it('should resolve enterprise extension URN path in PATCH add', async () => {
      const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const userWithEnterprise = {
        ...mockUser,
        rawPayload: JSON.stringify({
          displayName: 'Test User',
          [URN]: { department: 'Engineering' },
        }),
      };

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'add',
            path: `${URN}:manager`,
            value: { value: 'MGR-123' },
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(userWithEnterprise)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...userWithEnterprise,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload[URN].manager).toEqual({ value: 'MGR-123' });
      expect(storedPayload[URN].department).toBe('Engineering');
    });

    it('should remove enterprise extension attribute via URN path', async () => {
      const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const userWithManager = {
        ...mockUser,
        rawPayload: JSON.stringify({
          displayName: 'Test User',
          [URN]: { department: 'Eng', manager: { value: 'MGR' } },
        }),
      };

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'remove',
            path: `${URN}:manager`,
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(userWithManager)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...userWithManager,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload[URN].manager).toBeUndefined();
      expect(storedPayload[URN].department).toBe('Eng');
    });

    it('should replace enterprise extension attribute via URN path', async () => {
      const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const userWithManager = {
        ...mockUser,
        rawPayload: JSON.stringify({
          displayName: 'Test User',
          [URN]: { manager: { value: 'OLD-MGR' } },
        }),
      };

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: `${URN}:manager`,
            value: { value: 'NEW-MGR' },
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(userWithManager)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...userWithManager,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload[URN].manager).toEqual({ value: 'NEW-MGR' });
    });

    it('should remove valuePath entry via PATCH remove', async () => {
      const userWithEmails = {
        ...mockUser,
        rawPayload: JSON.stringify({
          displayName: 'Test User',
          emails: [
            { type: 'work', value: 'work@example.com' },
            { type: 'home', value: 'home@example.com' },
          ],
        }),
      };

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'remove',
            path: 'emails[type eq "work"]',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(userWithEmails)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...userWithEmails,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload.emails).toHaveLength(1);
      expect(storedPayload.emails[0].type).toBe('home');
    });

    it('should throw error for remove without path', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'remove',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      await expect(
        service.patchUserForEndpoint(mockUser.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });

    it('should throw error for unsupported patch operation', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'invalidOp' as any,
            path: 'userName',
            value: 'test',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      await expect(
        service.patchUserForEndpoint(mockUser.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });

    it('should throw 404 if user not found for patch', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'active', value: false },
        ],
      };

      mockPrismaService.scimUser.findFirst.mockReset();
      mockPrismaService.scimUser.findFirst.mockResolvedValue(null);

      await expect(
        service.patchUserForEndpoint('non-existent', patchDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });

    it('should apply multiple operations in a single PATCH request', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'userName', value: 'multi@example.com' },
          { op: 'replace', path: 'active', value: false },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockResolvedValue({
        ...mockUser,
        userName: 'multi@example.com',
        active: false,
      });

      const result = await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.userName).toBe('multi@example.com');
      expect(result.active).toBe(false);
    });

    it('should add non-reserved attribute via simple path', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'add',
            path: 'nickName',
            value: 'TestNick',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...mockUser,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload.nickName).toBe('TestNick');
    });

    it('should update externalId via pathed replace', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: 'externalId',
            value: 'pathed-ext-id',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockResolvedValue({
        ...mockUser,
        externalId: 'pathed-ext-id',
      });

      const result = await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.externalId).toBe('pathed-ext-id');
      expect(mockPrismaService.scimUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            externalId: 'pathed-ext-id',
          }),
        })
      );
    });

    it('should remove simple attribute via path', async () => {
      const userWithNick = {
        ...mockUser,
        rawPayload: JSON.stringify({ displayName: 'Test User', nickName: 'Nick' }),
      };

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'remove',
            path: 'nickName',
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(userWithNick)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...userWithNick,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload.nickName).toBeUndefined();
      expect(storedPayload.displayName).toBe('Test User');
    });

    it('should strip reserved attributes from rawPayload after no-path replace', async () => {
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            value: {
              userName: 'stripped@example.com',
              displayName: 'Kept Display Name',
            },
          },
        ],
      };

      mockPrismaService.scimUser.findFirst
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);

      mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
        ...mockUser,
        userName: data.userName,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
      expect(updateCall.data.userName).toBe('stripped@example.com');
      const storedPayload = JSON.parse(updateCall.data.rawPayload);
      expect(storedPayload.displayName).toBe('Kept Display Name');
      // userName should be stripped from rawPayload since it's a DB column
      expect(storedPayload.userName).toBeUndefined();
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
        userNameLower: createDto.userName.toLowerCase(),
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

  // ─── RFC 7643 Case-Insensitivity Compliance ────────────────────────

  describe('case-insensitivity compliance (RFC 7643)', () => {
    describe('filter attribute names', () => {
      it('should accept filter with "UserName" (mixed case) as attribute', async () => {
        mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

        const result = await service.listUsersForEndpoint(
          { filter: 'UserName eq "test@example.com"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // userName filter is applied in-code for case-insensitive matching
        expect(result.totalResults).toBe(1);
        expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              endpointId: mockEndpoint.id,
            }),
            orderBy: { createdAt: 'asc' },
          })
        );
      });

      it('should accept filter with "USERNAME" (all caps) as attribute', async () => {
        mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

        const result = await service.listUsersForEndpoint(
          { filter: 'USERNAME eq "test@example.com"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // userName filter applied in-code; "USERNAME" attribute resolved case-insensitively
        expect(result.totalResults).toBe(1);
        expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              endpointId: mockEndpoint.id,
            }),
            orderBy: { createdAt: 'asc' },
          })
        );
      });

      it('should accept filter with "EXTERNALID" (all caps) as attribute', async () => {
        mockPrismaService.scimUser.count.mockResolvedValue(1);
        mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

        await service.listUsersForEndpoint(
          { filter: 'EXTERNALID eq "ext-123"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(mockPrismaService.scimUser.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              externalId: 'ext-123',
            }),
          })
        );
      });
    });

    describe('case-insensitive userName filter value', () => {
      it('should lowercase userName filter value for case-insensitive matching', async () => {
        mockPrismaService.scimUser.findMany.mockResolvedValue([mockUser]);

        // Filter value "Test@Example.COM" should match mockUser.userName "test@example.com" case-insensitively
        const result = await service.listUsersForEndpoint(
          { filter: 'userName eq "Test@Example.COM"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // In-code filtering lowercases both sides for comparison
        expect(result.totalResults).toBe(1);
        expect(result.Resources[0].userName).toBe('test@example.com');
      });
    });

    describe('case-insensitive userName uniqueness', () => {
      it('should reject create when userName differs only by case', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'TEST@EXAMPLE.COM',
          active: true,
        };

        // Simulate conflict found by userNameLower query
        mockPrismaService.scimUser.findFirst.mockResolvedValue({
          ...mockUser,
          userName: 'test@example.com',
        });

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow();

        expect(mockPrismaService.scimUser.create).not.toHaveBeenCalled();
      });

      it('should query uniqueness using userNameLower', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'NewUser@Example.COM',
          active: true,
        };

        mockPrismaService.scimUser.findFirst.mockResolvedValue(null);
        mockPrismaService.scimUser.create.mockResolvedValue({
          ...mockUser,
          userName: 'NewUser@Example.COM',
          userNameLower: 'newuser@example.com',
        });

        await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // Uniqueness check should use userNameLower
        expect(mockPrismaService.scimUser.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              AND: expect.arrayContaining([
                expect.objectContaining({ userNameLower: 'newuser@example.com' }),
              ]),
            }),
          })
        );
      });
    });

    describe('case-insensitive schema URI validation', () => {
      it('should accept schema URN with different casing', async () => {
        const createDto: CreateUserDto = {
          schemas: ['URN:IETF:PARAMS:SCIM:SCHEMAS:CORE:2.0:USER'],
          userName: 'caseschema@example.com',
          active: true,
        };

        mockPrismaService.scimUser.findFirst.mockResolvedValue(null);
        mockPrismaService.scimUser.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          userNameLower: createDto.userName.toLowerCase(),
        });

        // Should not throw despite different casing
        const result = await service.createUserForEndpoint(
          createDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(result.userName).toBe(createDto.userName);
      });
    });

    describe('userNameLower stored on write operations', () => {
      it('should store userNameLower on create', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'MixedCase@Example.COM',
          active: true,
        };

        mockPrismaService.scimUser.findFirst.mockResolvedValue(null);
        mockPrismaService.scimUser.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          userNameLower: 'mixedcase@example.com',
        });

        await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id);

        expect(mockPrismaService.scimUser.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userName: 'MixedCase@Example.COM',
              userNameLower: 'mixedcase@example.com',
            }),
          })
        );
      });

      it('should store userNameLower on replace/PUT', async () => {
        const replaceDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'REPLACED@EXAMPLE.COM',
          active: true,
        };

        mockPrismaService.scimUser.findFirst
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce(null);

        mockPrismaService.scimUser.update.mockResolvedValue({
          ...mockUser,
          userName: replaceDto.userName,
          userNameLower: 'replaced@example.com',
        });

        await service.replaceUserForEndpoint(
          mockUser.scimId,
          replaceDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(mockPrismaService.scimUser.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userName: 'REPLACED@EXAMPLE.COM',
              userNameLower: 'replaced@example.com',
            }),
          })
        );
      });

      it('should store userNameLower on PATCH userName update', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'userName', value: 'PATCHED@EXAMPLE.COM' },
          ],
        };

        mockPrismaService.scimUser.findFirst
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce(null);

        mockPrismaService.scimUser.update.mockResolvedValue({
          ...mockUser,
          userName: 'PATCHED@EXAMPLE.COM',
          userNameLower: 'patched@example.com',
        });

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(mockPrismaService.scimUser.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userName: 'PATCHED@EXAMPLE.COM',
              userNameLower: 'patched@example.com',
            }),
          })
        );
      });
    });

    describe('no-path PATCH key normalization', () => {
      it('should normalize mixed-case keys in no-path replace value object', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: { UserName: 'normalized@example.com' },
            },
          ],
        };

        mockPrismaService.scimUser.findFirst
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce(null);

        mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
          ...mockUser,
          userName: data.userName,
          rawPayload: data.rawPayload,
        }));

        const result = await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(result.userName).toBe('normalized@example.com');
        expect(mockPrismaService.scimUser.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userName: 'normalized@example.com',
            }),
          })
        );
      });

      it('should normalize DISPLAYNAME to displayName in no-path replace', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: { DISPLAYNAME: 'All Caps Key' },
            },
          ],
        };

        mockPrismaService.scimUser.findFirst
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce(null);

        mockPrismaService.scimUser.update.mockImplementation(async ({ data }: any) => ({
          ...mockUser,
          rawPayload: data.rawPayload,
        }));

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        const updateCall = mockPrismaService.scimUser.update.mock.calls[0][0];
        const storedPayload = JSON.parse(updateCall.data.rawPayload);
        expect(storedPayload.displayName).toBe('All Caps Key');
        // DISPLAYNAME should not appear as a separate key
        expect(storedPayload.DISPLAYNAME).toBeUndefined();
      });
    });
  });
});
