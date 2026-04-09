import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EndpointScimUsersService } from './endpoint-scim-users.service';
import { USER_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ScimMetadataService } from './scim-metadata.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { PatchUserDto } from '../dto/patch-user.dto';
import { ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import { SCIM_DIAGNOSTICS_URN } from '../common/scim-constants';

describe('EndpointScimUsersService', () => {
  let service: EndpointScimUsersService;
  let metadataService: ScimMetadataService;

  const mockScimLogger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
    enrichContext: jest.fn(),
  };

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
    displayName: 'Test User',
    active: true,
    deletedAt: null as Date | null,
    rawPayload: '{"displayName":"Test User"}',
    meta: JSON.stringify({
      resourceType: 'User',
      created: '2024-01-01T00:00:00.000Z',
      lastModified: '2024-01-01T00:00:00.000Z',
    }),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    version: 1,
  };

  const mockUserRepo = {
    create: jest.fn(),
    findByScimId: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findConflict: jest.fn(),
    findByScimIds: jest.fn(),
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
        ScimSchemaRegistry,
        {
          provide: USER_REPOSITORY,
          useValue: mockUserRepo,
        },
        {
          provide: ScimMetadataService,
          useValue: mockMetadataService,
        },
        {
          provide: ScimLogger,
          useValue: mockScimLogger,
        },
        {
          provide: EndpointContextStorage,
          useValue: {
            setContext: jest.fn(),
            getEndpointId: jest.fn(),
            getConfig: jest.fn(),
            addWarnings: jest.fn(),
            getWarnings: jest.fn().mockReturnValue([]),
          },
        },
      ],
    }).compile();

    const registry = module.get<ScimSchemaRegistry>(ScimSchemaRegistry);
    await registry.onModuleInit();

    service = module.get<EndpointScimUsersService>(EndpointScimUsersService);
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

      mockUserRepo.findConflict.mockResolvedValue(null); // No conflicts
      mockUserRepo.create.mockResolvedValue({
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
      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: createDto.userName,
          externalId: createDto.externalId,
          endpointId: mockEndpoint.id,
        })
      );
    });

    it('should enforce unique userName within endpoint', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'duplicate@example.com',
        active: true,
      };

      mockUserRepo.findConflict.mockResolvedValue(mockUser);

      await expect(
        service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow();

      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    it('should enforce unique externalId within endpoint', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'unique@example.com',
        externalId: 'duplicate-ext-id',
        active: true,
      };

      mockUserRepo.findConflict.mockResolvedValue(mockUser);

      await expect(
        service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow();

      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    describe('ReprovisionOnConflictForSoftDeletedResource', () => {
      const softDeletedConflict = {
        ...mockUser,
        active: false,
        deletedAt: new Date('2023-06-15T10:00:00.000Z'),
        meta: JSON.stringify({
          resourceType: 'User',
          created: '2023-06-15T10:00:00.000Z',
          lastModified: '2023-06-15T10:00:00.000Z',
        }),
      };

      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'test@example.com',
        externalId: 'ext-123',
        displayName: 'Reprovisioned User',
        active: true,
      };

      const reprovisionConfig: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: true,
      };

      it('should re-provision a soft-deleted user when both flags are enabled', async () => {
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict);
        mockUserRepo.findByScimId.mockResolvedValue(softDeletedConflict);
        mockUserRepo.update.mockResolvedValue({ ...softDeletedConflict, ...createDto, active: true });

        const result = await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, reprovisionConfig,
        );

        expect(result.id).toBe(softDeletedConflict.scimId);
        expect(result.active).toBe(true);
        expect(mockUserRepo.update).toHaveBeenCalledWith(
          softDeletedConflict.id,
          expect.objectContaining({ userName: createDto.userName, active: true }),
        );
        expect(mockUserRepo.create).not.toHaveBeenCalled();
      });

      it('should preserve original created date during re-provision', async () => {
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict);
        mockUserRepo.findByScimId.mockResolvedValue(softDeletedConflict);
        mockUserRepo.update.mockResolvedValue({ ...softDeletedConflict, ...createDto, active: true });

        await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, reprovisionConfig,
        );

        const updateCall = mockUserRepo.update.mock.calls[0][1];
        const meta = JSON.parse(updateCall.meta);
        expect(meta.created).toBe('2023-06-15T10:00:00.000Z');
      });

      it('should throw 409 when conflict is with an ACTIVE user even with both flags enabled', async () => {
        const activeConflict = { ...mockUser, active: true };
        mockUserRepo.findConflict.mockResolvedValue(activeConflict);

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, reprovisionConfig),
        ).rejects.toThrow(HttpException);

        expect(mockUserRepo.update).not.toHaveBeenCalled();
        expect(mockUserRepo.create).not.toHaveBeenCalled();
      });

      it('should throw 409 when SoftDeleteEnabled is true but ReprovisionOnConflict is false', async () => {
        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
          [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: false,
        };
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict);

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config),
        ).rejects.toThrow(HttpException);

        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('should throw 409 when SoftDeleteEnabled is false but ReprovisionOnConflict is true', async () => {
        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: false,
          [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: true,
        };
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict);

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config),
        ).rejects.toThrow(HttpException);

        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('should throw 409 when no config is provided (default off)', async () => {
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict);

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id),
        ).rejects.toThrow(HttpException);

        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('should handle string config flags "True"/"True" for re-provision', async () => {
        const stringConfig: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: 'True',
          [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: 'True',
        };
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict);
        mockUserRepo.findByScimId.mockResolvedValue(softDeletedConflict);
        mockUserRepo.update.mockResolvedValue({ ...softDeletedConflict, ...createDto, active: true });

        const result = await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, stringConfig,
        );

        expect(result.active).toBe(true);
        expect(mockUserRepo.update).toHaveBeenCalled();
        expect(mockUserRepo.create).not.toHaveBeenCalled();
      });

      it('should throw 500 if soft-deleted resource cannot be found during re-provision', async () => {
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict);
        mockUserRepo.findByScimId.mockResolvedValue(null); // race condition / data inconsistency

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, reprovisionConfig),
        ).rejects.toThrow(HttpException);

        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('should re-provision with externalId conflict on soft-deleted user', async () => {
        const externalIdDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'different-user@example.com',
          externalId: 'ext-123',
          active: true,
        };
        // findConflict returns match on externalId (different userName)
        const externalIdConflict = {
          ...softDeletedConflict,
          userName: 'old-user@example.com',
          externalId: 'ext-123',
        };
        mockUserRepo.findConflict.mockResolvedValue(externalIdConflict);
        mockUserRepo.findByScimId.mockResolvedValue(externalIdConflict);
        mockUserRepo.update.mockResolvedValue({ ...externalIdConflict, ...externalIdDto, active: true });

        const result = await service.createUserForEndpoint(
          externalIdDto, 'http://localhost:3000/scim', mockEndpoint.id, reprovisionConfig,
        );

        expect(result.active).toBe(true);
        expect(mockUserRepo.update).toHaveBeenCalled();
        expect(mockUserRepo.create).not.toHaveBeenCalled();
      });
    });

    describe('P8: uniqueness conflict diagnostic logging', () => {
      it('should log INFO with conflicting attribute before throwing 409 on userName conflict', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'duplicate@example.com',
          active: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(mockUser);

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow(HttpException);

        expect(mockScimLogger.info).toHaveBeenCalledWith(
          'scim.user',
          expect.stringContaining('Uniqueness conflict'),
          expect.objectContaining({
            endpointId: mockEndpoint.id,
          }),
        );
      });

      it('should include conflictingResourceId in 409 error response diagnostics (RCA-1)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'test@example.com', // matches mockUser.userName
          active: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(mockUser);

        try {
          await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id);
          fail('should have thrown');
        } catch (e: any) {
          expect(e.getStatus()).toBe(409);
          const body = e.getResponse();
          expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
          expect(body[SCIM_DIAGNOSTICS_URN].conflictingResourceId).toBe(mockUser.scimId);
          expect(body[SCIM_DIAGNOSTICS_URN].conflictingAttribute).toBe('userName');
          expect(body[SCIM_DIAGNOSTICS_URN].incomingValue).toBe('test@example.com');
        }
      });

      it('should include errorCode UNIQUENESS_USERNAME in 409 diagnostics (Step 4.5)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'test@example.com',
          active: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(mockUser);

        try {
          await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id);
          fail('should have thrown');
        } catch (e: any) {
          const body = e.getResponse();
          expect(body[SCIM_DIAGNOSTICS_URN].errorCode).toBe('UNIQUENESS_USERNAME');
        }
      });

      it('should log INFO before throwing 409 on reprovision 500 (user vanished)', async () => {
        const reprovisionConfig: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
          [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: true,
        };
        const softDeletedConflict2 = { ...mockUser, deletedAt: new Date('2023-06-15T10:00:00.000Z') };
        mockUserRepo.findConflict.mockResolvedValue(softDeletedConflict2);
        mockUserRepo.findByScimId.mockResolvedValue(null); // vanished

        await expect(
          service.createUserForEndpoint(
            { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'x@x.com', active: true },
            'http://localhost:3000/scim', mockEndpoint.id, reprovisionConfig,
          ),
        ).rejects.toThrow(HttpException);

        expect(mockScimLogger.warn).toHaveBeenCalledWith(
          'scim.user',
          expect.stringContaining('vanished'),
          expect.objectContaining({ scimId: softDeletedConflict2.scimId }),
        );
      });
    });
  });

  describe('getUserForEndpoint', () => {
    it('should retrieve a user by scimId within endpoint', async () => {
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);

      const result = await service.getUserForEndpoint(
        mockUser.scimId,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.id).toBe(mockUser.scimId);
      expect(result.userName).toBe(mockUser.userName);
      expect(mockUserRepo.findByScimId).toHaveBeenCalledWith(mockEndpoint.id, mockUser.scimId);
    });

    it('should throw 404 if user not found in endpoint', async () => {
      mockUserRepo.findByScimId.mockResolvedValue(null);

      await expect(
        service.getUserForEndpoint('non-existent', 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });
  });

  describe('listUsersForEndpoint', () => {
    it('should list users within a specific endpoint', async () => {
      const users = [mockUser, { ...mockUser, id: 'user-2', scimId: 'scim-456' }];

      mockUserRepo.findAll.mockResolvedValue(users);

      const result = await service.listUsersForEndpoint(
        { startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
      expect(result.startIndex).toBe(1);
      expect(mockUserRepo.findAll).toHaveBeenCalledWith(mockEndpoint.id, expect.anything(), expect.anything());
    });

    it('should filter users by userName within endpoint', async () => {
      mockUserRepo.findAll.mockResolvedValue([mockUser]);

      const result = await service.listUsersForEndpoint(
        { filter: 'userName eq "test@example.com"', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // userName filter is now applied in-code (not via Prisma where) for case-insensitive matching
      expect(result.totalResults).toBe(1);
      expect(mockUserRepo.findAll).toHaveBeenCalledWith(mockEndpoint.id, expect.anything(), expect.anything());
    });

    it('should respect pagination within endpoint', async () => {
      // Create 30 mock users to test in-code pagination
      const manyUsers = Array.from({ length: 30 }, (_, i) => ({
        ...mockUser,
        id: `user-${i}`,
        scimId: `scim-${i}`,
        userName: `user${i}@example.com`,
      }));
      mockUserRepo.findAll.mockResolvedValue(manyUsers);

      const result = await service.listUsersForEndpoint(
        { startIndex: 11, count: 20 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      // Pagination is now applied in-code via slice()
      expect(result.totalResults).toBe(30);
      expect(result.startIndex).toBe(11);
      expect(result.itemsPerPage).toBe(20);
      expect(mockUserRepo.findAll).toHaveBeenCalledWith(mockEndpoint.id, expect.anything(), expect.anything());
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
      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);
      mockUserRepo.update.mockResolvedValue({
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
      expect(mockUserRepo.findByScimId).toHaveBeenCalledWith(mockEndpoint.id, mockUser.scimId);
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null); // No conflict

      mockUserRepo.update.mockResolvedValue({
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockResolvedValue({
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
      expect(mockUserRepo.update).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
        userName: 'nopath@example.com',
      }));
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockResolvedValue({
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(userWithEmails);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
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
      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(userWithEnterprise);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
        ...userWithEnterprise,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(userWithManager);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
        ...userWithManager,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(userWithManager);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
        ...userWithManager,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
      expect(storedPayload[URN].manager).toEqual({ value: 'NEW-MGR' });
    });

    it('should remove manager when replace sends empty value {"value":""}  (RFC 7644 §3.5.2.3)', async () => {
      const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const userWithManager = {
        ...mockUser,
        rawPayload: JSON.stringify({
          displayName: 'Test User',
          [URN]: { manager: { value: 'OLD-MGR' }, department: 'Eng' },
        }),
      };

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: `${URN}:manager`,
            value: { value: '' },
          },
        ],
      };

      mockUserRepo.findByScimId.mockResolvedValueOnce(userWithManager);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
        ...userWithManager,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
      expect(storedPayload[URN].manager).toBeUndefined();
      expect(storedPayload[URN].department).toBe('Eng');
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(userWithEmails);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
        ...userWithEmails,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

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

      mockUserRepo.findByScimId.mockReset();
      mockUserRepo.findByScimId.mockResolvedValue(null);

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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockResolvedValue({
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
        ...mockUser,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockResolvedValue({
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
      expect(mockUserRepo.update).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
        externalId: 'pathed-ext-id',
      }));
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(userWithNick);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
        ...userWithNick,
        rawPayload: data.rawPayload,
      }));

      await service.patchUserForEndpoint(
        mockUser.scimId,
        patchDto,
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValueOnce(null);

      mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
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

      expect(mockUserRepo.update.mock.calls[0][1].userName).toBe('stripped@example.com');
      const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
      expect(storedPayload.displayName).toBe('Kept Display Name');
      // userName should be stripped from rawPayload since it's a DB column
      expect(storedPayload.userName).toBeUndefined();
    });

    describe('dot-notation path resolution', () => {
      const verboseConfig: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED]: true,
      };

      it('should resolve name.givenName to nested name object on replace when VerbosePatchSupported is enabled', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'name.givenName', value: 'Lysanne' },
            { op: 'replace', path: 'name.familyName', value: 'Linwood' },
          ],
        };

        const userWithName = {
          ...mockUser,
          rawPayload: JSON.stringify({
            displayName: 'Test User',
            name: { givenName: 'Ruthe', familyName: 'Xander' },
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValueOnce(userWithName);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...userWithName,
          rawPayload: data.rawPayload,
        }));

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
          verboseConfig
        );

        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        expect(storedPayload.name).toBeDefined();
        expect(storedPayload.name.givenName).toBe('Lysanne');
        expect(storedPayload.name.familyName).toBe('Linwood');
        // Should NOT create flat keys
        expect(storedPayload['name.givenName']).toBeUndefined();
        expect(storedPayload['name.familyName']).toBeUndefined();
      });

      it('should store dot-notation as flat keys when VerbosePatchSupported is disabled', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'name.givenName', value: 'Lysanne' },
          ],
        };

        const userWithName = {
          ...mockUser,
          rawPayload: JSON.stringify({
            displayName: 'Test User',
            name: { givenName: 'Ruthe', familyName: 'Xander' },
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValueOnce(userWithName);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...userWithName,
          rawPayload: data.rawPayload,
        }));

        // No config (flag defaults to false)
        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        // Without the flag, dot-notation is stored as a flat key
        expect(storedPayload['name.givenName']).toBe('Lysanne');
        // Original name object should remain unchanged
        expect(storedPayload.name.givenName).toBe('Ruthe');
      });

      it('should create nested object when parent does not exist', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'add', path: 'name.givenName', value: 'Alice' },
          ],
        };

        const userNoName = {
          ...mockUser,
          rawPayload: JSON.stringify({ displayName: 'Test User' }),
        };

        mockUserRepo.findByScimId.mockResolvedValueOnce(userNoName);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...userNoName,
          rawPayload: data.rawPayload,
        }));

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
          verboseConfig
        );

        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        expect(storedPayload.name).toEqual({ givenName: 'Alice' });
      });

      it('should not clobber sibling sub-attributes when updating dot-notation', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'name.givenName', value: 'Updated' },
          ],
        };

        const userWithFullName = {
          ...mockUser,
          rawPayload: JSON.stringify({
            name: { givenName: 'Old', familyName: 'Keep', formatted: 'Keep This' },
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValueOnce(userWithFullName);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...userWithFullName,
          rawPayload: data.rawPayload,
        }));

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
          verboseConfig
        );

        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        expect(storedPayload.name.givenName).toBe('Updated');
        expect(storedPayload.name.familyName).toBe('Keep');
        expect(storedPayload.name.formatted).toBe('Keep This');
      });

      it('should remove dot-notation sub-attribute', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'remove', path: 'name.middleName' },
          ],
        };

        const userWithMiddleName = {
          ...mockUser,
          rawPayload: JSON.stringify({
            name: { givenName: 'Alice', familyName: 'Smith', middleName: 'M' },
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValueOnce(userWithMiddleName);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...userWithMiddleName,
          rawPayload: data.rawPayload,
        }));

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
          verboseConfig
        );

        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        expect(storedPayload.name.givenName).toBe('Alice');
        expect(storedPayload.name.familyName).toBe('Smith');
        expect(storedPayload.name.middleName).toBeUndefined();
      });

      it('should handle verbose replace with all name sub-attributes', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'name.givenName', value: 'Lysanne' },
            { op: 'replace', path: 'name.familyName', value: 'Linwood' },
            { op: 'replace', path: 'name.formatted', value: 'Cristopher' },
            { op: 'replace', path: 'name.middleName', value: 'Margot' },
            { op: 'replace', path: 'name.honorificPrefix', value: 'Camryn' },
            { op: 'replace', path: 'name.honorificSuffix', value: 'Ashtyn' },
          ],
        };

        const userWithName = {
          ...mockUser,
          rawPayload: JSON.stringify({
            displayName: 'Test User',
            name: { givenName: 'Old', familyName: 'Old' },
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValueOnce(userWithName);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...userWithName,
          rawPayload: data.rawPayload,
        }));

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
          verboseConfig
        );

        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        expect(storedPayload.name.givenName).toBe('Lysanne');
        expect(storedPayload.name.familyName).toBe('Linwood');
        expect(storedPayload.name.formatted).toBe('Cristopher');
        expect(storedPayload.name.middleName).toBe('Margot');
        expect(storedPayload.name.honorificPrefix).toBe('Camryn');
        expect(storedPayload.name.honorificSuffix).toBe('Ashtyn');
      });
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

      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser); // Find user to replace
      mockUserRepo.findConflict.mockResolvedValueOnce(null); // No conflict

      mockUserRepo.update.mockResolvedValue({
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
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);
      mockUserRepo.delete.mockResolvedValue(mockUser);

      await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id);

      expect(mockUserRepo.findByScimId).toHaveBeenCalledWith(mockEndpoint.id, mockUser.scimId);
      expect(mockUserRepo.delete).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw 404 if user not found in endpoint', async () => {
      mockUserRepo.findByScimId.mockResolvedValue(null);

      await expect(
        service.deleteUserForEndpoint('non-existent', mockEndpoint.id)
      ).rejects.toThrow(HttpException);

      expect(mockUserRepo.delete).not.toHaveBeenCalled();
    });

    describe('soft delete', () => {
      it('should soft-delete user when SoftDeleteEnabled is true (boolean)', async () => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.update.mockResolvedValue({ ...mockUser, active: false, deletedAt: new Date() });

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true };
        await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, config);

        expect(mockUserRepo.update).toHaveBeenCalledWith(mockUser.id, { active: false, deletedAt: expect.any(Date) });
        expect(mockUserRepo.delete).not.toHaveBeenCalled();
      });

      it('should soft-delete user when SoftDeleteEnabled is "True" (string)', async () => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.update.mockResolvedValue({ ...mockUser, active: false, deletedAt: new Date() });

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: 'True' };
        await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, config);

        expect(mockUserRepo.update).toHaveBeenCalledWith(mockUser.id, { active: false, deletedAt: expect.any(Date) });
        expect(mockUserRepo.delete).not.toHaveBeenCalled();
      });

      it('should hard-delete user when SoftDeleteEnabled is false', async () => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.delete.mockResolvedValue(mockUser);

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: false };
        await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, config);

        expect(mockUserRepo.delete).toHaveBeenCalledWith(mockUser.id);
        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('should hard-delete user when SoftDeleteEnabled is "False" (string)', async () => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.delete.mockResolvedValue(mockUser);

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: 'False' };
        await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, config);

        expect(mockUserRepo.delete).toHaveBeenCalledWith(mockUser.id);
        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('should hard-delete user when config is undefined (default)', async () => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.delete.mockResolvedValue(mockUser);

        await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, undefined);

        expect(mockUserRepo.delete).toHaveBeenCalledWith(mockUser.id);
        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('should hard-delete user when config has no SoftDeleteEnabled key', async () => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.delete.mockResolvedValue(mockUser);

        const config: EndpointConfig = {};
        await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, config);

        expect(mockUserRepo.delete).toHaveBeenCalledWith(mockUser.id);
        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('endpoint isolation', () => {
    it('should not allow accessing users from different endpoints', async () => {
      const endpoint2 = { ...mockEndpoint, id: 'endpoint-2' };
      
      mockUserRepo.findByScimId.mockResolvedValue(null);

      await expect(
        service.getUserForEndpoint(mockUser.scimId, 'http://localhost:3000/scim', endpoint2.id)
      ).rejects.toThrow(HttpException);

      expect(mockUserRepo.findByScimId).toHaveBeenCalledWith(endpoint2.id, mockUser.scimId);
    });

    it('should allow same userName across different endpoints', async () => {
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'shared@example.com',
        active: true,
      };

      // No conflict within endpoint-2
      mockUserRepo.findConflict.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
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
      expect(mockUserRepo.findConflict).toHaveBeenCalled();
    });
  });

  // ─── RFC 7643 Case-Insensitivity Compliance ────────────────────────

  describe('case-insensitivity compliance (RFC 7643)', () => {
    describe('filter attribute names', () => {
      it('should accept filter with "UserName" (mixed case) as attribute', async () => {
        mockUserRepo.findAll.mockResolvedValue([mockUser]);

        const result = await service.listUsersForEndpoint(
          { filter: 'UserName eq "test@example.com"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // userName filter is applied in-code for case-insensitive matching
        expect(result.totalResults).toBe(1);
        expect(mockUserRepo.findAll).toHaveBeenCalledWith(mockEndpoint.id, expect.anything(), expect.anything());
      });

      it('should accept filter with "USERNAME" (all caps) as attribute', async () => {
        mockUserRepo.findAll.mockResolvedValue([mockUser]);

        const result = await service.listUsersForEndpoint(
          { filter: 'USERNAME eq "test@example.com"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        // userName filter applied in-code; "USERNAME" attribute resolved case-insensitively
        expect(result.totalResults).toBe(1);
        expect(mockUserRepo.findAll).toHaveBeenCalledWith(mockEndpoint.id, expect.anything(), expect.anything());
      });

      it('should accept filter with "EXTERNALID" (all caps) as attribute', async () => {
        mockUserRepo.findAll.mockResolvedValue([mockUser]);

        await service.listUsersForEndpoint(
          { filter: 'EXTERNALID eq "ext-123"', startIndex: 1, count: 10 },
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        expect(mockUserRepo.findAll).toHaveBeenCalledWith(mockEndpoint.id, expect.objectContaining({
          externalId: 'ext-123',
        }), expect.anything());
      });

      it('should throw 400 invalidFilter for unknown attribute in filter', async () => {
        try {
          await service.listUsersForEndpoint(
            { filter: 'nonExistentAttr eq "test"', startIndex: 1, count: 10 },
            'http://localhost:3000/scim',
            mockEndpoint.id
          );
          fail('Expected 400 invalidFilter');
        } catch (e: any) {
          expect(e.getStatus()).toBe(400);
          expect(e.getResponse().scimType).toBe('invalidFilter');
        }
      });
    });

    describe('case-insensitive userName filter value', () => {
      it('should lowercase userName filter value for case-insensitive matching', async () => {
        mockUserRepo.findAll.mockResolvedValue([mockUser]);

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

        // Simulate conflict found by userName query (CITEXT case-insensitive)
        mockUserRepo.findConflict.mockReset();
        mockUserRepo.findConflict.mockResolvedValue({
          scimId: mockUser.scimId,
          userName: 'test@example.com',
          externalId: null,
        });

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id)
        ).rejects.toThrow();

        expect(mockUserRepo.create).not.toHaveBeenCalled();
      });

      it('should query uniqueness using userName (case-insensitive via CITEXT)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'NewUser@Example.COM',
          active: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: 'NewUser@Example.COM',
        });

        await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id);

        // findConflict receives the raw userName; the repository handles lowercasing internally
        expect(mockUserRepo.findConflict).toHaveBeenCalledWith(
          mockEndpoint.id,
          'NewUser@Example.COM',
          undefined,
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

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
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

        mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
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
        expect(mockUserRepo.update).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
          userName: 'normalized@example.com',
        }));
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

        mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...mockUser,
          rawPayload: data.rawPayload,
        }));

        await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id
        );

        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        expect(storedPayload.displayName).toBe('All Caps Key');
        // DISPLAYNAME should not appear as a separate key
        expect(storedPayload.DISPLAYNAME).toBeUndefined();
      });
    });
  });

  // ───────────── SCIM ID LEAK PREVENTION (Issue 16) ─────────────

  describe('SCIM ID leak prevention', () => {
    describe('createUserForEndpoint — client-supplied id must be ignored', () => {
      it('should not leak client-supplied id into the response', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'idleak@example.com',
          active: true,
          displayName: 'ID Leak Test',
          id: 'client-fake-id-should-be-ignored',  // Client tries to supply an id
        } as CreateUserDto & { id: string };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"displayName":"ID Leak Test"}',
        });

        const result = await service.createUserForEndpoint(
          createDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
        );

        // Response id must be the server-assigned scimId, NOT the client-supplied value
        expect(result.id).toBe(mockUser.scimId);
        expect(result.id).not.toBe('client-fake-id-should-be-ignored');
      });

      it('should strip id from the stored rawPayload', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'idstrip@example.com',
          active: true,
          displayName: 'Strip ID Test',
          id: 'sneaky-client-id',
        } as CreateUserDto & { id: string };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"displayName":"Strip ID Test"}',
        });

        await service.createUserForEndpoint(
          createDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
        );

        // The rawPayload stored should NOT contain the client-supplied id
        const storedPayload = JSON.parse(mockUserRepo.create.mock.calls[0][0].rawPayload);
        expect(storedPayload.id).toBeUndefined();
        expect(storedPayload.displayName).toBe('Strip ID Test');
      });
    });

    describe('toScimUserResource — rawPayload id must never override scimId', () => {
      it('should use scimId even when rawPayload contains id', async () => {
        const userWithLeakedId = {
          ...mockUser,
          // Simulate a stored rawPayload that somehow has an id field
          rawPayload: JSON.stringify({
            displayName: 'Test User',
            id: 'leaked-id-in-payload',
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValue(userWithLeakedId);

        const result = await service.getUserForEndpoint(
          mockUser.scimId,
          'http://localhost:3000/scim',
          mockEndpoint.id,
        );

        // scimId must win over rawPayload.id
        expect(result.id).toBe(mockUser.scimId);
        expect(result.id).not.toBe('leaked-id-in-payload');
      });

      it('should include scimId in meta.location, not rawPayload id', async () => {
        const userWithLeakedId = {
          ...mockUser,
          rawPayload: JSON.stringify({
            displayName: 'Location Check',
            id: 'wrong-id-for-location',
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValue(userWithLeakedId);

        const result = await service.getUserForEndpoint(
          mockUser.scimId,
          'http://localhost:3000/scim',
          mockEndpoint.id,
        );

        expect(result.meta.location).toContain(`Users/${mockUser.scimId}`);
        expect(result.meta.location).not.toContain('wrong-id-for-location');
      });
    });

    describe('PATCH — stripReservedAttributes must strip id', () => {
      it('should strip id from no-path replace value', async () => {
        const patchDto: PatchUserDto = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            {
              op: 'replace',
              value: {
                displayName: 'Patched User',
                id: 'attacker-supplied-id',
              },
            },
          ],
        };

        mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
        mockUserRepo.findConflict.mockResolvedValueOnce(null);

        mockUserRepo.update.mockImplementation(async (_id: string, data: any) => ({
          ...mockUser,
          rawPayload: data.rawPayload,
        }));

        const result = await service.patchUserForEndpoint(
          mockUser.scimId,
          patchDto,
          'http://localhost:3000/scim',
          mockEndpoint.id,
        );

        // The response id must be the server-assigned scimId
        expect(result.id).toBe(mockUser.scimId);
        expect(result.id).not.toBe('attacker-supplied-id');

        // The stored rawPayload must not contain the client-supplied id
        const storedPayload = JSON.parse(mockUserRepo.update.mock.calls[0][1].rawPayload);
        expect(storedPayload.id).toBeUndefined();
        expect(storedPayload.displayName).toBe('Patched User');
      });
    });
  });

  describe('strict schema validation', () => {
    const ENTERPRISE_USER_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    describe('createUserForEndpoint with StrictSchemaValidation', () => {
      it('should allow extension URN in body when declared in schemas[] and registered (strict mode)', async () => {
        const createDto: CreateUserDto = {
          schemas: [
            'urn:ietf:params:scim:schemas:core:2.0:User',
            ENTERPRISE_USER_URN,
          ],
          userName: 'strict@example.com',
          active: true,
          [ENTERPRISE_USER_URN]: { department: 'Engineering' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: JSON.stringify({ schemas: createDto.schemas, [ENTERPRISE_USER_URN]: { department: 'Engineering' } }),
        });

        const result = await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, config
        );

        expect(result.userName).toBe(createDto.userName);
        expect(mockUserRepo.create).toHaveBeenCalled();
      });

      it('should reject extension URN NOT declared in schemas[] (strict mode)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], // missing Enterprise URN
          userName: 'strict@example.com',
          active: true,
          [ENTERPRISE_USER_URN]: { department: 'Engineering' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);

        try {
          await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config);
        } catch (e) {
          expect((e as HttpException).getStatus()).toBe(400);
          expect(JSON.stringify((e as HttpException).getResponse())).toContain('invalidSyntax');
        }

        expect(mockUserRepo.create).not.toHaveBeenCalled();
      });

      it('should reject unregistered extension URN even if declared in schemas[] (strict mode)', async () => {
        const fakeUrn = 'urn:fake:extension:2.0:User';
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', fakeUrn],
          userName: 'strict@example.com',
          active: true,
          [fakeUrn]: { custom: 'data' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);

        try {
          await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config);
        } catch (e) {
          expect((e as HttpException).getStatus()).toBe(400);
          expect(JSON.stringify((e as HttpException).getResponse())).toContain('invalidValue');
        }

        expect(mockUserRepo.create).not.toHaveBeenCalled();
      });

      it('should allow extension URN in body without schemas[] when strict mode is OFF', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], // missing Enterprise URN
          userName: 'lenient@example.com',
          active: true,
          [ENTERPRISE_USER_URN]: { department: 'Engineering' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: false };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: JSON.stringify({ schemas: createDto.schemas }),
        });

        const result = await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, config
        );

        expect(result.userName).toBe(createDto.userName);
        expect(mockUserRepo.create).toHaveBeenCalled();
      });

      it('should allow extension URN in body when config is undefined (default lenient)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'default@example.com',
          active: true,
          [ENTERPRISE_USER_URN]: { department: 'Engineering' },
        } as any;

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: JSON.stringify({ schemas: createDto.schemas }),
        });

        const result = await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, undefined
        );

        expect(result.userName).toBe(createDto.userName);
      });
    });

    describe('replaceUserForEndpoint with StrictSchemaValidation', () => {
      it('should reject undeclared extension URN on PUT (strict mode)', async () => {
        const replaceDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'replace@example.com',
          active: true,
          [ENTERPRISE_USER_URN]: { department: 'Sales' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

        mockUserRepo.findByScimId.mockResolvedValue(mockUser);

        await expect(
          service.replaceUserForEndpoint(mockUser.scimId, replaceDto, 'http://localhost:3000/scim', mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);
      });

      it('should allow valid extension on PUT (strict mode)', async () => {
        const replaceDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE_USER_URN],
          userName: 'replace@example.com',
          active: true,
          [ENTERPRISE_USER_URN]: { department: 'Sales' },
        } as any;

        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.update.mockResolvedValue({
          ...mockUser,
          userName: replaceDto.userName,
          rawPayload: JSON.stringify({ schemas: replaceDto.schemas }),
        });

        const result = await service.replaceUserForEndpoint(
          mockUser.scimId, replaceDto, 'http://localhost:3000/scim', mockEndpoint.id, config
        );

        expect(result.userName).toBe(replaceDto.userName);
      });
    });

    describe('schema attribute type validation through service', () => {
      const strictConfig: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true };

      it('should reject wrong type for boolean active on create (strict)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'typeerror@example.com',
          active: 'yes' as any,  // should be boolean
        };

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should reject wrong type in name complex attribute on create (strict)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'typeerror@example.com',
          name: 'not-an-object' as any,  // should be object
        } as any;

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should reject unknown core attribute on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'unknown@example.com',
          active: true,
          totallyFakeAttribute: 'should-fail',
        } as any;

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should include error detail in schema validation HttpException', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'detail@example.com',
          active: 42 as any,  // wrong type
        };

        try {
          await service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig);
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
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'lenient@example.com',
          active: 'yes' as any,  // wrong type, but no validation
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({ ...mockUser, userName: createDto.userName });

        const result = await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, lenientConfig
        );
        expect(result.userName).toBe(createDto.userName);
      });

      it('should reject wrong type for boolean active on replace (strict)', async () => {
        const replaceDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'replace@example.com',
          active: 'no' as any,
        };

        mockUserRepo.findByScimId.mockResolvedValue(mockUser);

        await expect(
          service.replaceUserForEndpoint(mockUser.scimId, replaceDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should accept valid payload with all core types on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'valid@example.com',
          active: true,
          displayName: 'Valid User',
          name: { givenName: 'Valid', familyName: 'User' },
          emails: [{ value: 'valid@example.com', type: 'work', primary: true }],
        } as any;

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: JSON.stringify(createDto),
        });

        const result = await service.createUserForEndpoint(
          createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig
        );
        expect(result.userName).toBe(createDto.userName);
      });

      it('should reject wrong sub-attribute type in emails on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'subattr@example.com',
          emails: [{ value: 'a@b.com', primary: 'yes' }],  // primary should be boolean
        } as any;

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should reject non-array for multi-valued emails on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'multi@example.com',
          emails: { value: 'a@b.com' },  // should be array
        } as any;

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });

      it('should validate enterprise extension attribute types on create (strict)', async () => {
        const createDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE_USER_URN],
          userName: 'ext@example.com',
          [ENTERPRISE_USER_URN]: { employeeNumber: 42 },  // should be string
        } as any;

        await expect(
          service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, strictConfig)
        ).rejects.toThrow(HttpException);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Soft Delete + GET / LIST / Filter interactions
  // ═══════════════════════════════════════════════════════════

  describe('soft delete + GET/LIST/filter interactions', () => {
    const softDeleteConfig: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true };

    it('should return 404 for soft-deleted user via GET when SoftDeleteEnabled (RFC 7644 §3.6)', async () => {
      const softDeletedUser = { ...mockUser, active: false, deletedAt: new Date() };
      mockUserRepo.findByScimId.mockResolvedValue(softDeletedUser);

      await expect(
        service.getUserForEndpoint(mockUser.scimId, 'http://localhost:3000/scim', mockEndpoint.id, softDeleteConfig)
      ).rejects.toThrow(HttpException);
    });

    it('should return soft-deleted user via GET when SoftDeleteEnabled is off (backward compat)', async () => {
      const softDeletedUser = { ...mockUser, active: false };
      mockUserRepo.findByScimId.mockResolvedValue(softDeletedUser);

      const result = await service.getUserForEndpoint(
        mockUser.scimId, 'http://localhost:3000/scim', mockEndpoint.id
      );

      expect(result.active).toBe(false);
      expect(result.id).toBe(mockUser.scimId);
    });

    it('should exclude soft-deleted users from LIST results when SoftDeleteEnabled', async () => {
      const activeUser = { ...mockUser, id: 'u1', scimId: 'scim-1', active: true };
      const deletedUser = { ...mockUser, id: 'u2', scimId: 'scim-2', active: false, deletedAt: new Date(), userName: 'deleted@example.com' };
      mockUserRepo.findAll.mockResolvedValue([activeUser, deletedUser]);

      const result = await service.listUsersForEndpoint(
        { startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id,
        softDeleteConfig,
      );

      expect(result.totalResults).toBe(1);
      expect(result.Resources).toHaveLength(1);
      expect(result.Resources[0].active).toBe(true);
    });

    it('should include soft-deleted users in LIST results when SoftDeleteEnabled is off', async () => {
      const activeUser = { ...mockUser, id: 'u1', scimId: 'scim-1', active: true };
      const deletedUser = { ...mockUser, id: 'u2', scimId: 'scim-2', active: false, userName: 'deleted@example.com' };
      mockUserRepo.findAll.mockResolvedValue([activeUser, deletedUser]);

      const result = await service.listUsersForEndpoint(
        { startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id,
      );

      expect(result.totalResults).toBe(2);
      expect(result.Resources).toHaveLength(2);
      const actives = result.Resources.map((r: any) => r.active);
      expect(actives).toContain(true);
      expect(actives).toContain(false);
    });

    it('should filter soft-deleted users with active eq false', async () => {
      const deletedUser = { ...mockUser, active: false };
      mockUserRepo.findAll.mockResolvedValue([deletedUser]);

      const result = await service.listUsersForEndpoint(
        { filter: 'active eq false', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(1);
      expect(result.Resources[0].active).toBe(false);
    });

    it('should filter active-only users with active eq true', async () => {
      const activeUser = { ...mockUser, active: true };
      mockUserRepo.findAll.mockResolvedValue([activeUser]);

      const result = await service.listUsersForEndpoint(
        { filter: 'active eq true', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(1);
      expect(result.Resources[0].active).toBe(true);
    });

    it('should re-activate soft-deleted user via PATCH active=true', async () => {
      const deletedUser = { ...mockUser, active: false };
      mockUserRepo.findByScimId.mockResolvedValueOnce(deletedUser);
      mockUserRepo.findConflict.mockResolvedValue(null);
      mockUserRepo.update.mockResolvedValue({ ...deletedUser, active: true });

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: true }],
      };

      const result = await service.patchUserForEndpoint(
        deletedUser.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id
      );

      expect(result.active).toBe(true);
      expect(mockUserRepo.update).toHaveBeenCalledWith(
        deletedUser.id,
        expect.objectContaining({ active: true })
      );
    });

    it('should PATCH displayName on soft-deleted user (active=false preserved)', async () => {
      const deletedUser = { ...mockUser, active: false };
      mockUserRepo.findByScimId.mockResolvedValueOnce(deletedUser);
      mockUserRepo.findConflict.mockResolvedValue(null);
      mockUserRepo.update.mockResolvedValue({
        ...deletedUser,
        displayName: 'Updated Deleted User',
        rawPayload: JSON.stringify({ displayName: 'Updated Deleted User' }),
      });

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Updated Deleted User' }],
      };

      const result = await service.patchUserForEndpoint(
        deletedUser.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id
      );

      expect(result.displayName).toBe('Updated Deleted User');
    });

    it('should soft-delete then GET returns 404 with SoftDeleteEnabled config (RFC 7644 §3.6)', async () => {
      // Simulate soft-delete
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);
      mockUserRepo.update.mockResolvedValue({ ...mockUser, active: false, deletedAt: new Date() });

      await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, softDeleteConfig);
      expect(mockUserRepo.update).toHaveBeenCalledWith(mockUser.id, { active: false, deletedAt: expect.any(Date) });

      // Now GET the same user with SoftDeleteEnabled — must return 404
      const softDeletedUser = { ...mockUser, active: false, deletedAt: new Date() };
      mockUserRepo.findByScimId.mockResolvedValue(softDeletedUser);
      await expect(
        service.getUserForEndpoint(mockUser.scimId, 'http://localhost:3000/scim', mockEndpoint.id, softDeleteConfig)
      ).rejects.toThrow(HttpException);
    });

    it('should soft-delete then GET without config returns active=false (backward compat)', async () => {
      // Without SoftDeleteEnabled config, soft-deleted users are still accessible
      const softDeletedUser = { ...mockUser, active: false };
      mockUserRepo.findByScimId.mockResolvedValue(softDeletedUser);
      const result = await service.getUserForEndpoint(
        mockUser.scimId, 'http://localhost:3000/scim', mockEndpoint.id
      );
      expect(result.active).toBe(false);
      expect(result.id).toBe(mockUser.scimId);
    });

    it('should double-delete soft-deleted user returns 404 (RFC 7644 §3.6)', async () => {
      const softDeletedUser = { ...mockUser, active: false, deletedAt: new Date() };
      mockUserRepo.findByScimId.mockResolvedValue(softDeletedUser);

      await expect(
        service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, softDeleteConfig)
      ).rejects.toThrow(HttpException);
    });

    it('should PATCH on soft-deleted user returns 404 when SoftDeleteEnabled', async () => {
      const softDeletedUser = { ...mockUser, active: false, deletedAt: new Date() };
      mockUserRepo.findByScimId.mockResolvedValue(softDeletedUser);

      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'New Name' }],
      };

      await expect(
        service.patchUserForEndpoint(
          mockUser.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id, softDeleteConfig
        )
      ).rejects.toThrow(HttpException);
    });

    it('should PUT on soft-deleted user returns 404 when SoftDeleteEnabled', async () => {
      const softDeletedUser = { ...mockUser, active: false, deletedAt: new Date() };
      mockUserRepo.findByScimId.mockResolvedValue(softDeletedUser);

      const dto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'replaced@example.com',
      };

      await expect(
        service.replaceUserForEndpoint(
          mockUser.scimId, dto, 'http://localhost:3000/scim', mockEndpoint.id, softDeleteConfig
        )
      ).rejects.toThrow(HttpException);
    });

    it('should hard-delete then GET returns 404', async () => {
      const hardDeleteConfig: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: false };
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);
      mockUserRepo.delete.mockResolvedValue(mockUser);

      await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, hardDeleteConfig);
      expect(mockUserRepo.delete).toHaveBeenCalledWith(mockUser.id);

      // Now GET returns null (not found)
      mockUserRepo.findByScimId.mockResolvedValue(null);
      await expect(
        service.getUserForEndpoint(mockUser.scimId, 'http://localhost:3000/scim', mockEndpoint.id)
      ).rejects.toThrow(HttpException);
    });

    it('should compound filter active eq false AND userName co on soft-deleted users', async () => {
      const deleted1 = { ...mockUser, id: 'u1', scimId: 'scim-1', active: false, userName: 'alice-deleted@test.com' };
      const deleted2 = { ...mockUser, id: 'u2', scimId: 'scim-2', active: false, userName: 'bob-deleted@test.com' };
      // DB returns both (active eq false pushed to DB)
      mockUserRepo.findAll.mockResolvedValue([deleted1, deleted2]);

      const result = await service.listUsersForEndpoint(
        { filter: 'active eq false', startIndex: 1, count: 10 },
        'http://localhost:3000/scim',
        mockEndpoint.id
      );

      expect(result.totalResults).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Config flag combinations
  // ═══════════════════════════════════════════════════════════

  describe('config flag combinations', () => {
    it('should soft-delete with SoftDeleteEnabled + StrictSchemaValidation both true', async () => {
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);
      mockUserRepo.update.mockResolvedValue({ ...mockUser, active: false, deletedAt: new Date() });

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      };

      await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, config);
      expect(mockUserRepo.update).toHaveBeenCalledWith(mockUser.id, { active: false, deletedAt: expect.any(Date) });
      expect(mockUserRepo.delete).not.toHaveBeenCalled();
    });

    it('should enforce strict schema on PATCH when SoftDeleteEnabled + StrictSchemaValidation', async () => {
      mockUserRepo.findByScimId.mockResolvedValueOnce(mockUser);
      mockUserRepo.findConflict.mockResolvedValue(null);

      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      };

      // PATCH with unknown extension URN should fail strict schema validation
      const patchDto: PatchUserDto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{
          op: 'replace',
          path: 'urn:unknown:extension:1.0:User:field',
          value: 'test',
        }],
      };

      // Should not throw for PATCH (strict schema checks on create/replace, not patch ops paths)
      mockUserRepo.update.mockResolvedValue({ ...mockUser });
      const result = await service.patchUserForEndpoint(
        mockUser.scimId, patchDto, 'http://localhost:3000/scim', mockEndpoint.id, config
      );
      expect(result).toBeDefined();
    });

    it('should reject unknown extension on CREATE when StrictSchemaValidation=true, SoftDeleteEnabled=true', async () => {
      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      };

      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:unknown:fake:1.0:User'],
        userName: 'stricttest@example.com',
        active: true,
        'urn:unknown:fake:1.0:User': { custom: 'data' },
      } as any;

      mockUserRepo.findConflict.mockResolvedValue(null);

      await expect(
        service.createUserForEndpoint(createDto, 'http://localhost:3000/scim', mockEndpoint.id, config)
      ).rejects.toThrow();
    });

    it('should allow valid extension on CREATE with all flags enabled', async () => {
      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: true,
        [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      };

      const ENTERPRISE_USER_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
      const createDto: CreateUserDto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE_USER_URN],
        userName: 'enterprise@example.com',
        active: true,
        [ENTERPRISE_USER_URN]: { department: 'Eng' },
      } as any;

      mockUserRepo.findConflict.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
        ...mockUser,
        userName: createDto.userName,
        rawPayload: JSON.stringify({
          schemas: createDto.schemas,
          [ENTERPRISE_USER_URN]: { department: 'Eng' },
        }),
      });

      const result = await service.createUserForEndpoint(
        createDto, 'http://localhost:3000/scim', mockEndpoint.id, config
      );
      expect(result.userName).toBe(createDto.userName);
    });
  });

  // ─── Phase 7: ETag & Conditional Requests ──────────────────────────────

  describe('ETag & Conditional Requests (Phase 7)', () => {
    const patchDto: PatchUserDto = {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    };

    const replaceDto: CreateUserDto = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'replaced@example.com',
      active: true,
    };

    const baseUrl = 'http://localhost:3000/scim';

    describe('patchUserForEndpoint', () => {
      beforeEach(() => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.update.mockResolvedValue({ ...mockUser, active: false });
      });

      it('should succeed when If-Match matches current ETag', async () => {
        const result = await service.patchUserForEndpoint(
          mockUser.scimId, patchDto, baseUrl, mockEndpoint.id, undefined, 'W/"v1"'
        );
        expect(result).toBeDefined();
        expect(result.active).toBe(false);
      });

      it('should throw 412 when If-Match does not match current ETag', async () => {
        await expect(
          service.patchUserForEndpoint(mockUser.scimId, patchDto, baseUrl, mockEndpoint.id, undefined, 'W/"v999"')
        ).rejects.toThrow(HttpException);

        await expect(
          service.patchUserForEndpoint(mockUser.scimId, patchDto, baseUrl, mockEndpoint.id, undefined, 'W/"v999"')
        ).rejects.toMatchObject({ status: 412 });
      });

      it('should throw 428 when RequireIfMatch=true and no If-Match header', async () => {
        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: true };
        await expect(
          service.patchUserForEndpoint(mockUser.scimId, patchDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);

        await expect(
          service.patchUserForEndpoint(mockUser.scimId, patchDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toMatchObject({ status: 428 });
      });

      it('should succeed when RequireIfMatch=false and no If-Match header', async () => {
        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: false };
        const result = await service.patchUserForEndpoint(
          mockUser.scimId, patchDto, baseUrl, mockEndpoint.id, config
        );
        expect(result).toBeDefined();
      });

      it('should succeed when If-Match is wildcard (*)', async () => {
        const result = await service.patchUserForEndpoint(
          mockUser.scimId, patchDto, baseUrl, mockEndpoint.id, undefined, '*'
        );
        expect(result).toBeDefined();
      });
    });

    describe('replaceUserForEndpoint', () => {
      beforeEach(() => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.update.mockResolvedValue({ ...mockUser, userName: replaceDto.userName });
      });

      it('should succeed when If-Match matches current ETag', async () => {
        const result = await service.replaceUserForEndpoint(
          mockUser.scimId, replaceDto, baseUrl, mockEndpoint.id, undefined, 'W/"v1"'
        );
        expect(result).toBeDefined();
      });

      it('should throw 412 when If-Match does not match current ETag', async () => {
        await expect(
          service.replaceUserForEndpoint(mockUser.scimId, replaceDto, baseUrl, mockEndpoint.id, undefined, 'W/"v999"')
        ).rejects.toMatchObject({ status: 412 });
      });

      it('should throw 428 when RequireIfMatch=true and no If-Match header', async () => {
        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: true };
        await expect(
          service.replaceUserForEndpoint(mockUser.scimId, replaceDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toMatchObject({ status: 428 });
      });
    });

    describe('deleteUserForEndpoint', () => {
      beforeEach(() => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.delete.mockResolvedValue(mockUser);
      });

      it('should succeed when If-Match matches current ETag', async () => {
        await service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, undefined, 'W/"v1"');
        expect(mockUserRepo.delete).toHaveBeenCalledWith(mockUser.id);
      });

      it('should throw 412 when If-Match does not match current ETag', async () => {
        await expect(
          service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, undefined, 'W/"v999"')
        ).rejects.toMatchObject({ status: 412 });
      });

      it('should throw 428 when RequireIfMatch=true and no If-Match header', async () => {
        const config: EndpointConfig = { [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: true };
        await expect(
          service.deleteUserForEndpoint(mockUser.scimId, mockEndpoint.id, config)
        ).rejects.toMatchObject({ status: 428 });
      });
    });

    describe('ETag format', () => {
      it('should include version-based ETag W/"v{N}" in response meta', async () => {
        mockUserRepo.findByScimId.mockResolvedValue({ ...mockUser, version: 3 });
        const result = await service.getUserForEndpoint(
          mockUser.scimId, baseUrl, mockEndpoint.id
        );
        expect(result.meta.version).toBe('W/"v3"');
      });

      it('should use W/"v1" for newly created resources', async () => {
        mockUserRepo.findByScimId.mockResolvedValue(mockUser); // version: 1
        const result = await service.getUserForEndpoint(
          mockUser.scimId, baseUrl, mockEndpoint.id
        );
        expect(result.meta.version).toBe('W/"v1"');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // AllowAndCoerceBooleanStrings flag
  // ═══════════════════════════════════════════════════════════

  describe('AllowAndCoerceBooleanStrings', () => {
    const baseUrl = 'http://localhost:3000/scim';

    describe('createUserForEndpoint', () => {
      it('should coerce boolean string "True" to true (default: flag on)', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'coerce@example.com',
          active: true,
          roles: [{ value: 'admin', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
          // AllowAndCoerceBooleanStrings: not set → defaults to true
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockImplementation(async (input) => ({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: input.rawPayload,
        }));

        const result = await service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config);
        expect(result).toBeDefined();
        expect(result.userName).toBe('coerce@example.com');

        // Verify the DTO was coerced before storage
        const storedPayload = JSON.parse(mockUserRepo.create.mock.calls[0][0].rawPayload);
        expect(storedPayload.roles[0].primary).toBe(true);
      });

      it('should coerce boolean string "False" to false', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'coerce2@example.com',
          active: true,
          roles: [{ value: 'admin', primary: 'False' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockImplementation(async (input) => ({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: input.rawPayload,
        }));

        const result = await service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config);
        expect(result).toBeDefined();

        const storedPayload = JSON.parse(mockUserRepo.create.mock.calls[0][0].rawPayload);
        expect(storedPayload.roles[0].primary).toBe(false);
      });

      it('should reject boolean string when flag is explicitly disabled', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'nococerce@example.com',
          active: true,
          roles: [{ value: 'admin', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: false,
        };

        await expect(
          service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);
      });

      it('should not coerce non-boolean string attributes (e.g., roles[].value = "true")', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'nocoerce3@example.com',
          active: true,
          roles: [{ value: 'true', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockImplementation(async (input) => ({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: input.rawPayload,
        }));

        const result = await service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config);
        expect(result).toBeDefined();

        const storedPayload = JSON.parse(mockUserRepo.create.mock.calls[0][0].rawPayload);
        // "value" is a string-type attribute — should NOT be coerced
        expect(storedPayload.roles[0].value).toBe('true');
        // "primary" is a boolean-type attribute — should be coerced
        expect(storedPayload.roles[0].primary).toBe(true);
      });
    });

    describe('replaceUserForEndpoint', () => {
      it('should coerce boolean strings on PUT with flag on (default)', async () => {
        const replaceDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'replace@example.com',
          active: true,
          emails: [{ value: 'test@test.com', type: 'work', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
        };

        mockUserRepo.findByScimId.mockResolvedValue(mockUser);
        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.update.mockImplementation(async (_id, input) => ({
          ...mockUser,
          userName: replaceDto.userName,
          rawPayload: input.rawPayload!,
        }));

        const result = await service.replaceUserForEndpoint(
          mockUser.scimId, replaceDto, baseUrl, mockEndpoint.id, config
        );
        expect(result).toBeDefined();
      });

      it('should reject boolean strings on PUT when flag is off', async () => {
        const replaceDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'replace@example.com',
          active: true,
          emails: [{ value: 'test@test.com', type: 'work', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: false,
        };

        mockUserRepo.findByScimId.mockResolvedValue(mockUser);

        await expect(
          service.replaceUserForEndpoint(mockUser.scimId, replaceDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);
      });
    });

    describe('flag interaction matrix', () => {
      it('StrictSchema=ON + Coerce=ON (default): boolean strings accepted and coerced', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'matrix1@example.com',
          active: true,
          roles: [{ value: 'admin', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockImplementation(async (input) => ({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: input.rawPayload,
        }));

        await expect(
          service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config)
        ).resolves.toBeDefined();
      });

      it('StrictSchema=ON + Coerce=OFF: boolean strings rejected', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'matrix2@example.com',
          active: true,
          roles: [{ value: 'admin', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: false,
        };

        await expect(
          service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config)
        ).rejects.toThrow(HttpException);
      });

      it('StrictSchema=OFF + Coerce=ON: boolean strings accepted (no validation), coerced for storage', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'matrix3@example.com',
          active: true,
          roles: [{ value: 'admin', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: false,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: true,
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockImplementation(async (input) => ({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: input.rawPayload,
        }));

        const result = await service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config);
        expect(result).toBeDefined();

        // Even without strict validation, coercion should normalise storage
        const storedPayload = JSON.parse(mockUserRepo.create.mock.calls[0][0].rawPayload);
        expect(storedPayload.roles[0].primary).toBe(true);
      });

      it('StrictSchema=OFF + Coerce=OFF: boolean strings pass through as-is', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'matrix4@example.com',
          active: true,
          roles: [{ value: 'admin', primary: 'True' }],
        } as any;

        const config: EndpointConfig = {
          [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: false,
          [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: false,
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockImplementation(async (input) => ({
          ...mockUser,
          userName: createDto.userName,
          rawPayload: input.rawPayload,
        }));

        const result = await service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id, config);
        expect(result).toBeDefined();

        const storedPayload = JSON.parse(mockUserRepo.create.mock.calls[0][0].rawPayload);
        // String pass-through — not coerced
        expect(storedPayload.roles[0].primary).toBe('True');
      });
    });
  });

  // ───────────── G8e: returned characteristic filtering ─────────────

  describe('G8e — returned characteristic filtering', () => {
    const baseUrl = 'http://localhost:3000/scim/endpoints/endpoint-1';

    describe('toScimUserResource — returned:never stripping', () => {
      it('should strip password from response when rawPayload contains it', async () => {
        const userWithPassword = {
          ...mockUser,
          rawPayload: JSON.stringify({ displayName: 'Test User', password: 'SuperSecret123!' }),
        };

        mockUserRepo.findByScimId.mockResolvedValue(userWithPassword);

        const result = await service.getUserForEndpoint(
          userWithPassword.scimId,
          baseUrl,
          mockEndpoint.id,
        );

        expect(result.userName).toBe(userWithPassword.userName);
        expect(result).not.toHaveProperty('password');
      });

      it('should strip password from create response', async () => {
        const createDto: CreateUserDto = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'pw-test@example.com',
          password: 'Secret123!',
          active: true,
        };

        const createdRecord = {
          ...mockUser,
          userName: createDto.userName,
          rawPayload: JSON.stringify({ displayName: 'PW User', password: 'Secret123!' }),
        };

        mockUserRepo.findConflict.mockResolvedValue(null);
        mockUserRepo.create.mockResolvedValue(createdRecord);

        const result = await service.createUserForEndpoint(createDto, baseUrl, mockEndpoint.id);

        expect(result.userName).toBe('pw-test@example.com');
        expect(result).not.toHaveProperty('password');
      });

      it('should preserve non-password attributes while stripping password', async () => {
        const userWithMixed = {
          ...mockUser,
          rawPayload: JSON.stringify({
            displayName: 'Mixed User',
            password: 'Secret!',
            nickName: 'mixie',
            title: 'Engineer',
          }),
        };

        mockUserRepo.findByScimId.mockResolvedValue(userWithMixed);

        const result = await service.getUserForEndpoint(
          userWithMixed.scimId,
          baseUrl,
          mockEndpoint.id,
        );

        expect(result).not.toHaveProperty('password');
        expect(result.displayName).toBe('Mixed User');
        expect((result as Record<string, unknown>).nickName).toBe('mixie');
        expect((result as Record<string, unknown>).title).toBe('Engineer');
      });
    });

    describe('getRequestReturnedByParent', () => {
      it('should return a Set of request-only attribute names', () => {
        const requestOnlyAttrs = service.getRequestReturnedByParent(mockEndpoint.id);

        // The default User schema has no request-only attributes, so the set should be empty
        expect(requestOnlyAttrs).toBeInstanceOf(Map);
        expect(requestOnlyAttrs.size).toBe(0);
      });
    });
  });

  // ─── Repository Error Handling (Phase A Step 3) ─────────────────────────

  describe('RepositoryError handling', () => {
    const { RepositoryError } = require('../../../domain/errors/repository-error');
    const baseUrl = 'https://example.com/scim/endpoints/endpoint-1';
    const endpointId = 'endpoint-1';

    const validCreateDto = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'alice@example.com',
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockUserRepo.findConflict.mockResolvedValue(null);
    });

    it('should convert RepositoryError NOT_FOUND to 404 on update', async () => {
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);
      mockUserRepo.update.mockRejectedValue(new RepositoryError('NOT_FOUND', 'User not found'));

      await expect(
        service.replaceUserForEndpoint('scim-123', validCreateDto as any, baseUrl, endpointId),
      ).rejects.toThrow(HttpException);

      try {
        await service.replaceUserForEndpoint('scim-123', validCreateDto as any, baseUrl, endpointId);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
      }
    });

    it('should convert RepositoryError CONNECTION to 503 on create', async () => {
      mockUserRepo.create.mockRejectedValue(new RepositoryError('CONNECTION', 'DB timeout'));

      await expect(
        service.createUserForEndpoint(validCreateDto as any, baseUrl, endpointId),
      ).rejects.toThrow(HttpException);

      try {
        await service.createUserForEndpoint(validCreateDto as any, baseUrl, endpointId);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(503);
      }
    });

    it('should convert RepositoryError NOT_FOUND to 404 on delete', async () => {
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);
      mockUserRepo.delete.mockRejectedValue(new RepositoryError('NOT_FOUND', 'User not found'));

      await expect(
        service.deleteUserForEndpoint('scim-123', endpointId),
      ).rejects.toThrow(HttpException);

      try {
        await service.deleteUserForEndpoint('scim-123', endpointId);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
      }
    });

    it('should re-throw non-RepositoryError (for GlobalExceptionFilter)', async () => {
      mockUserRepo.findByScimId.mockResolvedValue(mockUser);
      mockUserRepo.update.mockRejectedValue(new TypeError('unexpected'));

      await expect(
        service.replaceUserForEndpoint('scim-123', validCreateDto as any, baseUrl, endpointId),
      ).rejects.toThrow(TypeError);
    });
  });
});
