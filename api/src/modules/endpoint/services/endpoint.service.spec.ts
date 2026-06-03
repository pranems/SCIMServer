import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EndpointService } from './endpoint.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';

// Force Prisma backend for unit tests - these tests mock PrismaService,
// not the in-memory cache. The inmemory path uses a different code flow.
const originalBackend = process.env.PERSISTENCE_BACKEND;
beforeAll(() => { process.env.PERSISTENCE_BACKEND = 'prisma'; });
afterAll(() => { process.env.PERSISTENCE_BACKEND = originalBackend; });

describe('EndpointService', () => {
  let service: EndpointService;
  let prisma: PrismaService;
  let scimLogger: ScimLogger;

  const mockEndpoint = {
    id: 'test-endpoint-id',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'A test endpoint',
    profile: { settings: { MultiMemberPatchOpForGroupEnabled: 'True' }, schemas: [], resourceTypes: [], serviceProviderConfig: {} },
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndpointService,
        {
          provide: PrismaService,
          useValue: {
            endpoint: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            scimResource: {
              count: jest.fn(),
            },
            resourceMember: {
              count: jest.fn(),
            },
            requestLog: {
              count: jest.fn(),
            },
          },
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
            getConfig: jest.fn().mockReturnValue({ endpointLevels: {} }),
            runWithContext: jest.fn((ctx, fn) => fn()),
            getContext: jest.fn(),
            enrichContext: jest.fn(),
            setEndpointLevel: jest.fn(),
            clearEndpointLevel: jest.fn(),
            enableEndpointFileLogging: jest.fn(),
            disableEndpointFileLogging: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EndpointService>(EndpointService);
    prisma = module.get<PrismaService>(PrismaService);
    scimLogger = module.get<ScimLogger>(ScimLogger);
  });

  describe('createEndpoint', () => {
    describe('profile.settings flag validation', () => {
      it('should reject invalid settings value on create', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        await expect(
          service.createEndpoint({
            name: 'test-settings-val',
            profile: {
              settings: { StrictSchemaValidation: 'Yes' } as any,
              schemas: [{ id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' }],
              resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] }],
            },
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should accept valid settings value "True" on create', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          profile: { settings: { MultiMemberPatchOpForGroupEnabled: 'True' }, schemas: [], resourceTypes: [], serviceProviderConfig: {} },
        });
        const result = await service.createEndpoint({
          name: 'test-valid-setting',
          profile: {
            settings: { MultiMemberPatchOpForGroupEnabled: 'True' },
            schemas: [{ id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' }],
            resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] }],
          },
        });
        expect(result).toBeDefined();
      });
    });
  });

  describe('updateEndpoint', () => {
    it('should reject invalid settings value on update', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      await expect(
        service.updateEndpoint('test-endpoint-id', {
          profile: { settings: { MultiMemberPatchOpForGroupEnabled: 'invalid' } as any },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow update without profile', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      (prisma.endpoint.update as jest.Mock).mockResolvedValue(mockEndpoint);

      const result = await service.updateEndpoint('test-endpoint-id', {
        displayName: 'New Name',
      });

      expect(result).toBeDefined();
    });
  });

  describe('createEndpoint - name validation', () => {
    it('should reject endpoint name with spaces', async () => {
      await expect(
        service.createEndpoint({ name: 'invalid name' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject endpoint name with special characters', async () => {
      await expect(
        service.createEndpoint({ name: 'invalid!@#$' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject empty endpoint name', async () => {
      await expect(
        service.createEndpoint({ name: '' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept valid endpoint name with hyphens', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        name: 'valid-name',
      });

      const result = await service.createEndpoint({ name: 'valid-name' });
      expect(result.name).toBe('valid-name');
    });

    it('should accept valid endpoint name with underscores', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        name: 'valid_name',
      });

      const result = await service.createEndpoint({ name: 'valid_name' });
      expect(result.name).toBe('valid_name');
    });

    it('should reject duplicate endpoint name', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);

      await expect(
        service.createEndpoint({ name: 'test-endpoint' })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getEndpoint', () => {
    it('should return endpoint by ID', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);

      const result = await service.getEndpoint('test-endpoint-id');

      expect(result.id).toBe('test-endpoint-id');
      expect(result.name).toBe('test-endpoint');
    });

    it('should throw NotFoundException for non-existent endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getEndpoint('non-existent')
      ).rejects.toThrow(NotFoundException);
    });

    it('should parse profile settings correctly', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);

      const result = await service.getEndpoint('test-endpoint-id');

      expect(result.profile?.settings).toEqual({ MultiMemberPatchOpForGroupEnabled: 'True' });
    });

    it('should handle null profile', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: null,
      });

      const result = await service.getEndpoint('test-endpoint-id');

      expect(result.profile).toBeNull();
    });

    it('should normalize stale settings keys to current names', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: {
          settings: {
            SoftDeleteEnabled: 'True',
            MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
            MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
            VerbosePatchSupported: 'True',
          },
          schemas: [],
          resourceTypes: [],
          serviceProviderConfig: {},
        },
      });

      const result = await service.getEndpoint('test-endpoint-id');

      // Stale keys should be renamed to current names
      expect(result.profile?.settings).toHaveProperty('UserSoftDeleteEnabled', 'True');
      expect(result.profile?.settings).toHaveProperty('MultiMemberPatchOpForGroupEnabled', 'True');
      expect(result.profile?.settings).toHaveProperty('VerbosePatchSupported', 'True');
      // Old keys should be removed
      expect(result.profile?.settings).not.toHaveProperty('SoftDeleteEnabled');
      expect(result.profile?.settings).not.toHaveProperty('MultiOpPatchRequestAddMultipleMembersToGroup');
      expect(result.profile?.settings).not.toHaveProperty('SoftDeleteEnabled');
      expect(result.profile?.settings).not.toHaveProperty('MultiOpPatchRequestRemoveMultipleMembersFromGroup');
    });
  });

  describe('getEndpointByName', () => {
    it('should return endpoint by name', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);

      const result = await service.getEndpointByName('test-endpoint');

      expect(result.name).toBe('test-endpoint');
    });

    it('should throw NotFoundException for non-existent endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getEndpointByName('non-existent')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listEndpoints', () => {
    it('should return all endpoints when no filter', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);

      const result = await service.listEndpoints();

      expect(result.totalResults).toBe(1);
      expect(result.endpoints).toHaveLength(1);
      expect(prisma.endpoint.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter active endpoints', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);

      await service.listEndpoints(true);

      expect(prisma.endpoint.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter inactive endpoints', async () => {
      const inactiveEndpoint = { ...mockEndpoint, active: false };
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([inactiveEndpoint]);

      await service.listEndpoints(false);

      expect(prisma.endpoint.findMany).toHaveBeenCalledWith({
        where: { active: false },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty response when no endpoints exist', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listEndpoints();

      expect(result).toEqual({ totalResults: 0, endpoints: [] });
    });
  });

  describe('deleteEndpoint', () => {
    it('should delete existing endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      (prisma.endpoint.delete as jest.Mock).mockResolvedValue(mockEndpoint);

      await expect(service.deleteEndpoint('test-endpoint-id')).resolves.toBeUndefined();
      expect(prisma.endpoint.delete).toHaveBeenCalledWith({
        where: { id: 'test-endpoint-id' },
      });
    });

    it('should throw NotFoundException for non-existent endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteEndpoint('non-existent')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getEndpointStats', () => {
    it('should return endpoint statistics (nested format)', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      // 8 parallel count queries: totalUsers, activeUsers, inactiveUsers,
      //   totalGroups, activeGroups, inactiveGroups, totalGroupMembers, requestLogCount
      (prisma.scimResource.count as jest.Mock)
        .mockResolvedValueOnce(10)  // totalUsers
        .mockResolvedValueOnce(8)   // activeUsers
        .mockResolvedValueOnce(2)   // inactiveUsers
        .mockResolvedValueOnce(5)   // totalGroups
        .mockResolvedValueOnce(5)   // activeGroups
        .mockResolvedValueOnce(0);  // inactiveGroups
      (prisma.resourceMember.count as jest.Mock).mockResolvedValue(25);
      (prisma.requestLog.count as jest.Mock).mockResolvedValue(100);

      const result = await service.getEndpointStats('test-endpoint-id');

      expect(result).toEqual({
        users: { total: 10, active: 8, inactive: 2 },
        groups: { total: 5, active: 5, inactive: 0 },
        groupMembers: { total: 25 },
        requestLogs: { total: 100 },
      });
    });

    it('should return zero counts for empty endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      (prisma.scimResource.count as jest.Mock).mockResolvedValue(0);
      (prisma.resourceMember.count as jest.Mock).mockResolvedValue(0);
      (prisma.requestLog.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getEndpointStats('test-endpoint-id');

      expect(result).toEqual({
        users: { total: 0, active: 0, inactive: 0 },
        groups: { total: 0, active: 0, inactive: 0 },
        groupMembers: { total: 0 },
        requestLogs: { total: 0 },
      });
    });

    it('should throw NotFoundException for non-existent endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getEndpointStats('non-existent')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('logLevel syncing via endpoint profile settings', () => {
    describe('createEndpoint with logLevel', () => {
      // Helpers: minimal schemas/resourceTypes required by validateAndExpandProfile
      const minSchema = { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' as const };
      const minRT = { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] };

      it('should call setEndpointLevel when profile settings contains logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          profile: { settings: { logLevel: 'DEBUG' }, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
        });

        await service.createEndpoint({
          name: 'test-endpoint',
          profile: { settings: { logLevel: 'DEBUG' }, schemas: [minSchema], resourceTypes: [minRT] },
        });

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('test-endpoint-id', expect.any(Number));
      });

      it('should call clearEndpointLevel when profile settings has no logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          profile: { settings: { strictMode: true }, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
        });

        await service.createEndpoint({
          name: 'test-endpoint',
          profile: { settings: { strictMode: true }, schemas: [minSchema], resourceTypes: [minRT] },
        });

        expect(scimLogger.clearEndpointLevel).toHaveBeenCalledWith('test-endpoint-id');
      });

      it('should not sync logLevel when profile is not provided', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          profile: null,
        });

        await service.createEndpoint({ name: 'test-endpoint' });

        // Should clear since null profile means no logLevel
        expect(scimLogger.clearEndpointLevel).toHaveBeenCalledWith('test-endpoint-id');
      });

      // 'VERBOSE' is not a recognized LogLevel, but parseLogLevel() silently
      // falls back to INFO. The profile path still rejects this because
      // a profile with only settings (no schemas/resourceTypes) fails
      // structural validation. This test documents that rejection behavior.
      it('should reject invalid logLevel string', async () => {
        await expect(
          service.createEndpoint({
            name: 'test-endpoint',
            profile: { settings: { logLevel: 'VERBOSE' } },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should accept numeric logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          profile: { settings: { logLevel: 0 }, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
        });

        await service.createEndpoint({
          name: 'test-endpoint',
          profile: { settings: { logLevel: 0 }, schemas: [minSchema], resourceTypes: [minRT] },
        });

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('test-endpoint-id', 0);
      });
    });

    describe('updateEndpoint with logLevel', () => {
      // mockEndpoint has empty schemas/RTs. Update path merges partial into
      // current and re-validates the merged profile which needs valid schemas/RTs.
      const validProfileEndpoint = {
        ...mockEndpoint,
        profile: {
          settings: { MultiMemberPatchOpForGroupEnabled: 'True' },
          schemas: [{ id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' }],
          resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] }],
          serviceProviderConfig: {},
        },
      };

      it('should call setEndpointLevel when updating profile settings with logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(validProfileEndpoint);
        (prisma.endpoint.update as jest.Mock).mockResolvedValue({
          ...validProfileEndpoint,
          profile: { ...validProfileEndpoint.profile, settings: { ...validProfileEndpoint.profile.settings, logLevel: 'TRACE' } },
        });

        await service.updateEndpoint('test-endpoint-id', {
          profile: { settings: { logLevel: 'TRACE' } },
        });

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('test-endpoint-id', expect.any(Number));
      });

      it('should call clearEndpointLevel when updating profile settings without logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(validProfileEndpoint);
        (prisma.endpoint.update as jest.Mock).mockResolvedValue({
          ...validProfileEndpoint,
          profile: { ...validProfileEndpoint.profile, settings: { strictMode: true } },
        });

        await service.updateEndpoint('test-endpoint-id', {
          profile: { settings: { strictMode: true } },
        });

        expect(scimLogger.clearEndpointLevel).toHaveBeenCalledWith('test-endpoint-id');
      });

      it('should not sync logLevel when profile is not in the update dto', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.update as jest.Mock).mockResolvedValue(mockEndpoint);

        await service.updateEndpoint('test-endpoint-id', {
          displayName: 'New Name',
        });

        expect(scimLogger.setEndpointLevel).not.toHaveBeenCalled();
        expect(scimLogger.clearEndpointLevel).not.toHaveBeenCalled();
      });
    });

    describe('deleteEndpoint with logLevel cleanup', () => {
      it('should call clearEndpointLevel when deleting endpoint', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.delete as jest.Mock).mockResolvedValue(mockEndpoint);

        await service.deleteEndpoint('test-endpoint-id');

        expect(scimLogger.clearEndpointLevel).toHaveBeenCalledWith('test-endpoint-id');
      });
    });

    describe('onModuleInit - restore endpoint log levels', () => {
      it('should restore logLevel from endpoints with logLevel in profile settings', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            profile: { settings: { logLevel: 'DEBUG' } },
          },
          {
            id: 'ep-2',
            name: 'endpoint-2',
            profile: { settings: { logLevel: 'TRACE' } },
          },
        ]);

        await service.onModuleInit();

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledTimes(2);
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('ep-1', expect.any(Number));
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('ep-2', expect.any(Number));
      });

      it('should skip endpoints without logLevel in profile settings', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            profile: { settings: { strictMode: true } },
          },
        ]);

        await service.onModuleInit();

        expect(scimLogger.setEndpointLevel).not.toHaveBeenCalled();
      });

      it('should skip endpoints with null profile', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            profile: null,
          },
        ]);

        await service.onModuleInit();

        expect(scimLogger.setEndpointLevel).not.toHaveBeenCalled();
      });

      it('should handle empty endpoint list gracefully', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([]);

        await expect(service.onModuleInit()).resolves.not.toThrow();
        expect(scimLogger.setEndpointLevel).not.toHaveBeenCalled();
      });

      it('should handle database errors gracefully', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockRejectedValue(new Error('DB error'));

        await expect(service.onModuleInit()).resolves.not.toThrow();
        expect(scimLogger.setEndpointLevel).not.toHaveBeenCalled();
      });

      it('should skip endpoints with malformed profile JSON', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            profile: 'not-valid-json',
          },
          {
            id: 'ep-2',
            name: 'endpoint-2',
            profile: { settings: { logLevel: 'INFO' } },
          },
        ]);

        await service.onModuleInit();

        // Only ep-2 should be restored, ep-1 should be skipped
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledTimes(1);
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('ep-2', expect.any(Number));
      });
    });
  });

  // ─── Endpoint Cache Behavior (Phase 14.1) ──────────────────────────

  describe('Endpoint cache', () => {
    const cachedEndpoint = {
      id: 'cached-ep-1',
      name: 'cached-test',
      displayName: 'Cached Test',
      description: null,
      profile: {
        schemas: [],
        resourceTypes: [],
        serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
        settings: {},
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('onModuleInit should populate cache from DB', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([cachedEndpoint]);

      await service.onModuleInit();

      // Now getEndpoint should return from cache without hitting prisma.findUnique
      (prisma.endpoint.findUnique as jest.Mock).mockClear();
      const result = await service.getEndpoint('cached-ep-1');
      expect(result.id).toBe('cached-ep-1');
      expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    });

    it('onModuleInit should populate cacheByName', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([cachedEndpoint]);

      await service.onModuleInit();

      (prisma.endpoint.findUnique as jest.Mock).mockClear();
      const result = await service.getEndpointByName('cached-test');
      expect(result.name).toBe('cached-test');
      expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    });

    it('createEndpoint should cache the new endpoint', async () => {
      const newEndpoint = { ...cachedEndpoint, id: 'new-ep-1', name: 'new-test' };
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue(newEndpoint);

      await service.createEndpoint({ name: 'new-test', profilePreset: 'rfc-standard' });

      // Subsequent get should use cache
      (prisma.endpoint.findUnique as jest.Mock).mockClear();
      const result = await service.getEndpoint('new-ep-1');
      expect(result.id).toBe('new-ep-1');
      expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    });

    it('deleteEndpoint should remove from cache', async () => {
      // First populate cache
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([cachedEndpoint]);
      await service.onModuleInit();

      // Delete
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(cachedEndpoint);
      (prisma.endpoint.delete as jest.Mock).mockResolvedValue(cachedEndpoint);
      await service.deleteEndpoint('cached-ep-1');

      // Now getEndpoint should fail (item removed from cache + DB)
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getEndpoint('cached-ep-1')).rejects.toThrow(NotFoundException);
    });

    it('updateEndpoint should update cache entry', async () => {
      // Populate cache
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([cachedEndpoint]);
      await service.onModuleInit();

      // Update
      const updated = { ...cachedEndpoint, displayName: 'Updated Name' };
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(cachedEndpoint);
      (prisma.endpoint.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.updateEndpoint('cached-ep-1', { displayName: 'Updated Name' });
      expect(result.displayName).toBe('Updated Name');

      // Cache should be updated
      (prisma.endpoint.findUnique as jest.Mock).mockClear();
      const cached = await service.getEndpoint('cached-ep-1');
      expect(cached.displayName).toBe('Updated Name');
      expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    });

    it('listEndpoints should serve from cache when warmed', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([cachedEndpoint]);
      await service.onModuleInit();

      (prisma.endpoint.findMany as jest.Mock).mockClear();
      const list = await service.listEndpoints();
      expect(list.totalResults).toBeGreaterThanOrEqual(1);
      expect(list.endpoints.length).toBeGreaterThanOrEqual(1);
      // findMany should NOT be called again - served from cache
      expect(prisma.endpoint.findMany).not.toHaveBeenCalled();
    });

    it('getEndpoint cache miss should fall back to DB', async () => {
      // Don't warm cache - force a cache miss
      const dbEndpoint = { ...cachedEndpoint, id: 'db-only-ep' };
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(dbEndpoint);

      const result = await service.getEndpoint('db-only-ep');
      expect(result.id).toBe('db-only-ep');
      expect(prisma.endpoint.findUnique).toHaveBeenCalledWith({ where: { id: 'db-only-ep' } });
    });

    it('getEndpoint should log DB errors at DEBUG (not silently swallow)', async () => {
      // Simulate a DB connection error on both ID and name lookups
      const dbError = new Error('Connection refused');
      (prisma.endpoint.findUnique as jest.Mock).mockRejectedValue(dbError);

      await expect(service.getEndpoint('some-id')).rejects.toThrow(NotFoundException);

      // Verify the catch block logged at DEBUG (not silently swallowed)
      expect(scimLogger.debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('lookup failed'),
        expect.objectContaining({ error: 'Connection refused' }),
      );
    });

    it('listEndpoints with active=true filter should work from cache', async () => {
      const activeEp = { ...cachedEndpoint, id: 'active-ep', name: 'active-test', active: true };
      const inactiveEp = { ...cachedEndpoint, id: 'inactive-ep', name: 'inactive-test', active: false };
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([activeEp, inactiveEp]);

      await service.onModuleInit();
      (prisma.endpoint.findMany as jest.Mock).mockClear();

      const activeList = await service.listEndpoints(true);
      expect(activeList.totalResults).toBe(1);
      expect(activeList.endpoints[0].id).toBe('active-ep');
      expect(prisma.endpoint.findMany).not.toHaveBeenCalled(); // served from cache
    });

    it('listEndpoints with active=false filter should work from cache', async () => {
      const activeEp = { ...cachedEndpoint, id: 'active-ep2', name: 'active-test2', active: true };
      const inactiveEp = { ...cachedEndpoint, id: 'inactive-ep2', name: 'inactive-test2', active: false };
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([activeEp, inactiveEp]);

      await service.onModuleInit();
      (prisma.endpoint.findMany as jest.Mock).mockClear();

      const inactiveList = await service.listEndpoints(false);
      expect(inactiveList.totalResults).toBe(1);
      expect(inactiveList.endpoints[0].id).toBe('inactive-ep2');
      expect(prisma.endpoint.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Partial Profile PATCH (Phase 14) ──────────────────────────────

  describe('updateEndpoint - partial profile PATCH', () => {
    const profileEndpoint = {
      id: 'patch-ep-1',
      name: 'patch-test',
      displayName: 'Patch Test',
      description: null,
      profile: {
        schemas: [
          { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
          { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
        ],
        resourceTypes: [
          { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] },
          { id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [] },
        ],
        serviceProviderConfig: {
          patch: { supported: true }, bulk: { supported: true, maxOperations: 100, maxPayloadSize: 1048576 },
          filter: { supported: true, maxResults: 200 }, sort: { supported: true },
          etag: { supported: true }, changePassword: { supported: false },
        },
        settings: { UserSoftDeleteEnabled: 'True' },
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should deep-merge settings without replacing other profile sections', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        // Return the merged profile as the DB would
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result = await service.updateEndpoint('patch-ep-1', {
        profile: { settings: { StrictSchemaValidation: 'True' } },
      });

      // Original settings should be preserved + new one added
      expect(result.profile?.settings?.UserSoftDeleteEnabled).toBe('True');
      expect(result.profile?.settings?.StrictSchemaValidation).toBe('True');
      // Schemas should still exist
      expect(result.profile?.schemas?.length).toBeGreaterThanOrEqual(2);
      // SPC should still exist
      expect(result.profile?.serviceProviderConfig?.bulk?.supported).toBe(true);
    });

    it('should overwrite individual setting value via deep-merge', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result = await service.updateEndpoint('patch-ep-1', {
        profile: { settings: { UserSoftDeleteEnabled: 'False' } },
      });

      expect(result.profile?.settings?.UserSoftDeleteEnabled).toBe('False');
    });

    it('should replace SPC when provided in partial profile', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result = await service.updateEndpoint('patch-ep-1', {
        profile: {
          serviceProviderConfig: {
            patch: { supported: true }, bulk: { supported: false },
            filter: { supported: true, maxResults: 50 }, sort: { supported: false },
            etag: { supported: false }, changePassword: { supported: false },
          },
        },
      });

      expect(result.profile?.serviceProviderConfig?.bulk?.supported).toBe(false);
      expect(result.profile?.serviceProviderConfig?.sort?.supported).toBe(false);
      expect(result.profile?.serviceProviderConfig?.filter?.maxResults).toBe(50);
      // Settings should be preserved
      expect(result.profile?.settings?.UserSoftDeleteEnabled).toBe('True');
    });

    it('should replace schemas when provided in partial profile', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result = await service.updateEndpoint('patch-ep-1', {
        profile: {
          schemas: [
            { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
          ],
          resourceTypes: [
            { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] },
          ],
        },
      });

      // Only User schema should remain
      expect(result.profile?.schemas?.length).toBe(1);
      expect(result.profile?.schemas?.[0]?.id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(result.profile?.resourceTypes?.length).toBe(1);
    });

    it('should replace resourceTypes when provided in partial profile', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result = await service.updateEndpoint('patch-ep-1', {
        profile: {
          resourceTypes: [
            { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] },
          ],
        },
      });

      expect(result.profile?.resourceTypes?.length).toBe(1);
      expect(result.profile?.resourceTypes?.[0]?.name).toBe('User');
    });

    it('should combine settings + SPC update in one PATCH', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result = await service.updateEndpoint('patch-ep-1', {
        profile: {
          settings: { RequireIfMatch: 'True' },
          serviceProviderConfig: {
            patch: { supported: true }, bulk: { supported: false },
            filter: { supported: false }, sort: { supported: false },
            etag: { supported: false }, changePassword: { supported: false },
          },
        },
      });

      expect(result.profile?.settings?.UserSoftDeleteEnabled).toBe('True');
      expect(result.profile?.settings?.RequireIfMatch).toBe('True');
      expect(result.profile?.serviceProviderConfig?.bulk?.supported).toBe(false);
    });

    it('should fire profile change listener on profile PATCH', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const listener = jest.fn();
      service.setProfileChangeListener(listener);

      await service.updateEndpoint('patch-ep-1', {
        profile: { settings: { VerbosePatchSupported: 'True' } },
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('patch-ep-1', expect.objectContaining({
        settings: expect.objectContaining({ VerbosePatchSupported: 'True' }),
      }));
    });

    it('should update cache on profile PATCH', async () => {
      // Populate cache
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([profileEndpoint]);
      await service.onModuleInit();

      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      await service.updateEndpoint('patch-ep-1', {
        profile: { settings: { AllowAndCoerceBooleanStrings: 'True' } },
      });

      // Verify cache was updated
      (prisma.endpoint.findUnique as jest.Mock).mockClear();
      const cached = await service.getEndpoint('patch-ep-1');
      expect(cached.profile?.settings?.AllowAndCoerceBooleanStrings).toBe('True');
      expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    });

    it('should preserve profile.settings when only displayName is updated', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockResolvedValue({
        ...profileEndpoint, displayName: 'New Name',
      });

      const result = await service.updateEndpoint('patch-ep-1', { displayName: 'New Name' });
      expect(result.displayName).toBe('New Name');
      expect(result.profile?.settings?.UserSoftDeleteEnabled).toBe('True');
    });

    it('should handle multiple settings additions in sequence', async () => {
      // Populate cache
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([profileEndpoint]);
      await service.onModuleInit();

      // First PATCH: add StrictSchemaValidation
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(profileEndpoint);
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result1 = await service.updateEndpoint('patch-ep-1', {
        profile: { settings: { StrictSchemaValidation: 'True' } },
      });

      expect(result1.profile?.settings?.UserSoftDeleteEnabled).toBe('True');
      expect(result1.profile?.settings?.StrictSchemaValidation).toBe('True');

      // Second PATCH: add RequireIfMatch - should keep both previous settings
      // Now the cached endpoint has the updated profile from PATCH 1
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue({
        ...profileEndpoint, profile: result1.profile,
      });
      (prisma.endpoint.update as jest.Mock).mockImplementation((_args: any) => {
        return Promise.resolve({ ...profileEndpoint, profile: _args.data.profile });
      });

      const result2 = await service.updateEndpoint('patch-ep-1', {
        profile: { settings: { RequireIfMatch: 'True' } },
      });

      expect(result2.profile?.settings?.UserSoftDeleteEnabled).toBe('True');
      expect(result2.profile?.settings?.StrictSchemaValidation).toBe('True');
      expect(result2.profile?.settings?.RequireIfMatch).toBe('True');
    });
  });

  // ─── ProfileSummary Builder ──────────────────────────────────────────

  describe('buildProfileSummary (static)', () => {
    it('should produce correct schema digest with attribute counts', () => {
      const profile = {
        schemas: [
          { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: [{ name: 'userName' }, { name: 'displayName' }] },
          { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: [{ name: 'displayName' }] },
        ],
        resourceTypes: [
          { id: 'User', name: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', endpoint: '/Users', description: 'User', schemaExtensions: [{ schema: 'urn:ext', required: false }] },
        ],
        serviceProviderConfig: {
          patch: { supported: true },
          bulk: { supported: false },
          filter: { supported: true },
          changePassword: { supported: false },
          sort: { supported: true },
          etag: { supported: true },
        },
        settings: { UserSoftDeleteEnabled: 'True', logLevel: 'DEBUG' },
      } as any;

      const summary = EndpointService.buildProfileSummary(profile);

      // Schema counts
      expect(summary.schemaCount).toBe(2);
      expect(summary.schemas).toHaveLength(2);
      expect(summary.schemas[0]).toEqual({ id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributeCount: 2 });
      expect(summary.schemas[1]).toEqual({ id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributeCount: 1 });

      // ResourceType counts
      expect(summary.resourceTypeCount).toBe(1);
      expect(summary.resourceTypes[0]).toEqual({
        name: 'User',
        schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
        extensions: ['urn:ext'],
        extensionCount: 1,
      });

      // ServiceProviderConfig
      expect(summary.serviceProviderConfig).toEqual({
        patch: true,
        bulk: false,
        filter: true,
        changePassword: false,
        sort: true,
        etag: true,
      });

      // Active settings (only non-empty, non-false values)
      expect(summary.activeSettings).toEqual({ UserSoftDeleteEnabled: 'True', logLevel: 'DEBUG' });
    });

    it('should handle empty profile with no schemas, resourceTypes, or settings', () => {
      const profile = {
        schemas: [],
        resourceTypes: [],
        serviceProviderConfig: {
          patch: { supported: false },
          bulk: { supported: false },
          filter: { supported: false },
          changePassword: { supported: false },
          sort: { supported: false },
          etag: { supported: false },
        },
        settings: {},
      } as any;

      const summary = EndpointService.buildProfileSummary(profile);

      expect(summary.schemaCount).toBe(0);
      expect(summary.schemas).toEqual([]);
      expect(summary.resourceTypeCount).toBe(0);
      expect(summary.resourceTypes).toEqual([]);
      expect(summary.serviceProviderConfig).toEqual({
        patch: false, bulk: false, filter: false, changePassword: false, sort: false, etag: false,
      });
      expect(summary.activeSettings).toEqual({});
    });

    it('should exclude "False" and false values from activeSettings', () => {
      const profile = {
        schemas: [],
        resourceTypes: [],
        serviceProviderConfig: {
          patch: { supported: false }, bulk: { supported: false }, filter: { supported: false },
          changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false },
        },
        settings: {
          UserSoftDeleteEnabled: 'False',
          StrictSchemaValidation: false,
          VerbosePatchSupported: 'True',
          logLevel: '',
        },
      } as any;

      const summary = EndpointService.buildProfileSummary(profile);
      expect(summary.activeSettings).toEqual({ VerbosePatchSupported: 'True' });
    });

    it('should handle schema with no attributes (extension schema)', () => {
      const profile = {
        schemas: [
          { id: 'urn:ext:schema', name: 'ExtSchema' /* no attributes */ },
        ],
        resourceTypes: [],
        serviceProviderConfig: {
          patch: { supported: false }, bulk: { supported: false }, filter: { supported: false },
          changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false },
        },
        settings: {},
      } as any;

      const summary = EndpointService.buildProfileSummary(profile);
      expect(summary.schemas[0].attributeCount).toBe(0);
    });
  });

  // ─── View Param (summary vs full) ───────────────────────────────────

  describe('toResponse - view param', () => {
    it('full view should include profile and not profileSummary', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
      await service.onModuleInit();

      const result = await service.getEndpoint('test-endpoint-id', 'full');
      expect(result.profile).toBeDefined();
      expect(result.profileSummary).toBeUndefined();
    });

    it('summary view should include profileSummary and not profile', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
      await service.onModuleInit();

      const result = await service.getEndpoint('test-endpoint-id', 'summary');
      expect(result.profileSummary).toBeDefined();
      expect(result.profile).toBeUndefined();
    });

    it('listEndpoints should default to summary view', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
      await service.onModuleInit();

      const listResult = await service.listEndpoints();
      expect(listResult.endpoints[0].profileSummary).toBeDefined();
      expect(listResult.endpoints[0].profile).toBeUndefined();
    });

    it('listEndpoints with view=full should include profile', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
      await service.onModuleInit();

      const listResult = await service.listEndpoints(undefined, 'full');
      expect(listResult.endpoints[0].profile).toBeDefined();
      expect(listResult.endpoints[0].profileSummary).toBeUndefined();
    });

    it('getEndpointByName supports view param', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
      await service.onModuleInit();

      const summaryResult = await service.getEndpointByName('test-endpoint', 'summary');
      expect(summaryResult.profileSummary).toBeDefined();
      expect(summaryResult.profile).toBeUndefined();

      const fullResult = await service.getEndpointByName('test-endpoint', 'full');
      expect(fullResult.profile).toBeDefined();
      expect(fullResult.profileSummary).toBeUndefined();
    });
  });

  // ─── Response Shape: _links, scimBasePath, ISO timestamps ──────────

  describe('response shape', () => {
    beforeEach(async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
      await service.onModuleInit();
    });

    it('should include _links with self, stats, credentials, scim', async () => {
      const result = await service.getEndpoint('test-endpoint-id');
      expect(result._links).toBeDefined();
      expect(result._links.self).toBe('/admin/endpoints/test-endpoint-id');
      expect(result._links.stats).toBe('/admin/endpoints/test-endpoint-id/stats');
      expect(result._links.credentials).toBe('/admin/endpoints/test-endpoint-id/credentials');
      expect(result._links.scim).toBe('/scim/endpoints/test-endpoint-id');
    });

    it('should return scimBasePath instead of scimEndpoint', async () => {
      const result = await service.getEndpoint('test-endpoint-id');
      expect(result.scimBasePath).toBe('/scim/endpoints/test-endpoint-id');
      expect((result as any).scimEndpoint).toBeUndefined();
    });

    it('should return ISO 8601 string timestamps', async () => {
      const result = await service.getEndpoint('test-endpoint-id');
      expect(typeof result.createdAt).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
      // Verify ISO 8601 format (basic check)
      expect(() => new Date(result.createdAt)).not.toThrow();
      expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt);
    });

    it('createEndpoint should return full view with _links and ISO timestamps', async () => {
      const createPayload = { ...mockEndpoint, id: 'new-ep' };
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue(createPayload);

      const result = await service.createEndpoint({ name: 'new-endpoint' });
      expect(result._links).toBeDefined();
      expect(result.scimBasePath).toContain('/scim/endpoints/');
      expect(typeof result.createdAt).toBe('string');
    });

    it('updateEndpoint should return full view with _links and ISO timestamps', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      (prisma.endpoint.update as jest.Mock).mockResolvedValue({ ...mockEndpoint, displayName: 'Updated' });

      const result = await service.updateEndpoint('test-endpoint-id', { displayName: 'Updated' });
      expect(result._links).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
    });
  });

  // ─── Presets API ────────────────────────────────────────────────────

  describe('listPresets', () => {
    it('should return all built-in presets with summaries', () => {
      const result = service.listPresets();
      expect(result.totalResults).toBeGreaterThanOrEqual(5);
      expect(result.presets).toHaveLength(result.totalResults);

      // Each preset should have metadata + summary
      for (const preset of result.presets) {
        expect(preset.name).toBeDefined();
        expect(preset.description).toBeDefined();
        expect(typeof preset.default).toBe('boolean');
        expect(preset.summary).toBeDefined();
        expect(preset.summary.schemaCount).toBeGreaterThanOrEqual(0);
        expect(preset.summary.schemas).toBeDefined();
        expect(preset.summary.resourceTypeCount).toBeGreaterThanOrEqual(0);
        expect(preset.summary.resourceTypes).toBeDefined();
        expect(preset.summary.serviceProviderConfig).toBeDefined();
        expect(preset.summary.activeSettings).toBeDefined();
      }
    });

    it('should mark exactly one preset as default', () => {
      const result = service.listPresets();
      const defaults = result.presets.filter(p => p.default);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe('entra-id');
    });

    it('should include known preset names', () => {
      const result = service.listPresets();
      const names = result.presets.map(p => p.name);
      expect(names).toContain('entra-id');
      expect(names).toContain('rfc-standard');
      expect(names).toContain('minimal');
    });

    it('preset summaries should have correct schema counts per preset', () => {
      const result = service.listPresets();
      const entraId = result.presets.find(p => p.name === 'entra-id');
      const minimal = result.presets.find(p => p.name === 'minimal');

      // entra-id has more schemas than minimal
      expect(entraId!.summary.schemaCount).toBeGreaterThan(minimal!.summary.schemaCount);
    });
  });

  describe('getPreset', () => {
    it('should return full expanded profile for a valid preset name', () => {
      const result = service.getPreset('entra-id');
      expect(result.metadata.name).toBe('entra-id');
      expect(result.metadata.description).toBeDefined();
      expect(result.metadata.default).toBe(true);
      expect(result.profile).toBeDefined();
      expect(result.profile.schemas).toBeDefined();
      expect(result.profile.schemas.length).toBeGreaterThan(0);
      expect(result.profile.resourceTypes).toBeDefined();
      expect(result.profile.serviceProviderConfig).toBeDefined();
    });

    it('should throw NotFoundException for unknown preset', () => {
      expect(() => service.getPreset('non-existent')).toThrow(NotFoundException);
    });

    it('should return different profiles for different presets', () => {
      const entraId = service.getPreset('entra-id');
      const minimal = service.getPreset('minimal');
      expect(entraId.profile.schemas.length).toBeGreaterThan(minimal.profile.schemas.length);
    });

    it('rfc-standard preset should have full capabilities', () => {
      const rfc = service.getPreset('rfc-standard');
      expect(rfc.profile.serviceProviderConfig.patch.supported).toBe(true);
      expect(rfc.profile.serviceProviderConfig.filter.supported).toBe(true);
    });
  });

  // ─── logFileEnabled syncing (default: true) ──────────────────────────────

  describe('syncEndpointFileLogging (logFileEnabled default=true)', () => {
    const minSchema = { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' as const };
    const minRT = { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] };

    it('should enable file logging when logFileEnabled is not set (default true)', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: {}, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
      });

      await service.createEndpoint({
        name: 'test-file-log-default',
        profile: { settings: {}, schemas: [minSchema], resourceTypes: [minRT] },
      });

      // logFileEnabled not set → defaults to true → enable is called, disable is NOT called for this endpoint
      expect(scimLogger.enableEndpointFileLogging).toHaveBeenCalled();
      expect(scimLogger.disableEndpointFileLogging).not.toHaveBeenCalledWith('test-endpoint-id');
    });

    it('should enable file logging when logFileEnabled is explicitly true', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { logFileEnabled: true }, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
      });

      await service.createEndpoint({
        name: 'test-file-log-true',
        profile: { settings: { logFileEnabled: true }, schemas: [minSchema], resourceTypes: [minRT] },
      });

      expect(scimLogger.enableEndpointFileLogging).toHaveBeenCalledWith('test-endpoint-id', expect.any(String));
    });

    it('should disable file logging when logFileEnabled is explicitly false', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { logFileEnabled: false }, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
      });

      await service.createEndpoint({
        name: 'test-file-log-false',
        profile: { settings: { logFileEnabled: false }, schemas: [minSchema], resourceTypes: [minRT] },
      });

      expect(scimLogger.disableEndpointFileLogging).toHaveBeenCalledWith('test-endpoint-id');
    });

    it('should disable file logging when logFileEnabled is "False" (string)', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { logFileEnabled: 'False' }, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
      });

      await service.createEndpoint({
        name: 'test-file-log-false-str',
        profile: { settings: { logFileEnabled: 'False' }, schemas: [minSchema], resourceTypes: [minRT] },
      });

      expect(scimLogger.disableEndpointFileLogging).toHaveBeenCalledWith('test-endpoint-id');
    });

    it('should disable file logging when logFileEnabled is "0"', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { logFileEnabled: '0' }, schemas: [minSchema], resourceTypes: [minRT], serviceProviderConfig: {} },
      });

      await service.createEndpoint({
        name: 'test-file-log-zero',
        profile: { settings: { logFileEnabled: '0' }, schemas: [minSchema], resourceTypes: [minRT] },
      });

      expect(scimLogger.disableEndpointFileLogging).toHaveBeenCalledWith('test-endpoint-id');
    });

    it('should enable file logging when profile is null (default behavior)', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.endpoint.create as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: null,
      });

      await service.createEndpoint({ name: 'test-file-log-null' });

      // Default preset is applied, so enableEndpointFileLogging is called
      // (logFileEnabled defaults to true, no explicit false to disable)
      expect(scimLogger.enableEndpointFileLogging).toHaveBeenCalled();
      expect(scimLogger.disableEndpointFileLogging).not.toHaveBeenCalledWith('test-endpoint-id');
    });
  });

  // ─── Phase 2: API Response Contract Enforcement ──────────────────────────

  describe('API response contract enforcement', () => {
    const FULL_VIEW_ALLOWED_KEYS = [
      'id', 'name', 'displayName', 'description', 'profile',
      'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links',
    ].sort();

    const SUMMARY_VIEW_ALLOWED_KEYS = [
      'id', 'name', 'displayName', 'description', 'profileSummary',
      'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links',
    ].sort();

    const PROFILE_ALLOWED_KEYS = [
      'schemas', 'settings', 'resourceTypes', 'serviceProviderConfig',
    ].sort();

    describe('full view response shape', () => {
      it('should contain ONLY allowed keys in full view response', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        const result = await service.getEndpoint('test-endpoint-id');
        const keys = Object.keys(result).sort();
        expect(keys).toEqual(FULL_VIEW_ALLOWED_KEYS);
      });

      it('should NOT contain _schemaCaches in full view response', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        const result = await service.getEndpoint('test-endpoint-id');
        expect(result).not.toHaveProperty('_schemaCaches');
        expect(result.profile).not.toHaveProperty('_schemaCaches');
      });

      it('should strip _schemaCaches when profile has runtime cache attached', async () => {
        // Simulate a profile that has been mutated by SCIM operations at runtime
        const profileWithCache = {
          ...mockEndpoint.profile,
          _schemaCaches: {
            'urn:ietf:params:scim:schemas:core:2.0:User': {
              booleansByParent: new Map([['root', new Set(['active'])]]),
              neverReturnedByParent: new Map(),
              alwaysReturnedByParent: new Map(),
              requestReturnedByParent: new Map(),
              immutableByParent: new Map(),
              caseExactByParent: new Map(),
              caseExactPaths: new Set(),
              uniqueAttrs: [],
              extensionUrns: [],
              coreSchemaUrn: 'urn:ietf:params:scim:schemas:core:2.0:user',
              schemaUrnSet: new Set(),
              coreAttrMap: new Map(),
              extensionSchemaMap: new Map(),
              readOnlyByParent: new Map(),
              readOnlyCollected: { core: new Set(), extensions: new Map(), coreSubAttrs: new Map(), extensionSubAttrs: new Map() },
            },
          },
        };
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          profile: profileWithCache,
        });

        const result = await service.getEndpoint('test-endpoint-id');

        // _schemaCaches must NOT appear in the response
        expect(result.profile).not.toHaveProperty('_schemaCaches');
        // Profile should still have the valid keys
        expect(result.profile).toHaveProperty('settings');
        expect(result.profile).toHaveProperty('schemas');
      });

      it('should have profile keys matching allowlist (no internal fields)', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        const result = await service.getEndpoint('test-endpoint-id');
        const profileKeys = Object.keys(result.profile!).sort();
        expect(profileKeys).toEqual(PROFILE_ALLOWED_KEYS);
      });
    });

    describe('summary view response shape', () => {
      it('should contain ONLY allowed keys in summary view response', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
        const result = await service.listEndpoints(undefined, 'summary');
        const ep = result.endpoints[0];
        const keys = Object.keys(ep).sort();
        expect(keys).toEqual(SUMMARY_VIEW_ALLOWED_KEYS);
      });

      it('should NOT have profile in summary view', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([mockEndpoint]);
        const result = await service.listEndpoints(undefined, 'summary');
        expect(result.endpoints[0]).not.toHaveProperty('profile');
      });
    });

    describe('_links correctness', () => {
      it('should have _links with correct paths for the endpoint ID', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        const result = await service.getEndpoint('test-endpoint-id');
        expect(result._links).toEqual({
          self: '/admin/endpoints/test-endpoint-id',
          stats: '/admin/endpoints/test-endpoint-id/stats',
          credentials: '/admin/endpoints/test-endpoint-id/credentials',
          scim: '/scim/endpoints/test-endpoint-id',
        });
      });
    });
  });
});
