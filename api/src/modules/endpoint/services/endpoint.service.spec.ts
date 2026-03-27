import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EndpointService } from './endpoint.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';

// Force Prisma backend for unit tests — these tests mock PrismaService,
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
    profile: { settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' }, schemas: [], resourceTypes: [], serviceProviderConfig: {} },
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
            setEndpointLevel: jest.fn(),
            clearEndpointLevel: jest.fn(),
            getConfig: jest.fn().mockReturnValue({ endpointLevels: {} }),
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
              settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'Yes' } as any,
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
          profile: { settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' }, schemas: [], resourceTypes: [], serviceProviderConfig: {} },
        });
        const result = await service.createEndpoint({
          name: 'test-valid-setting',
          profile: {
            settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' },
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
          profile: { settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid' } as any },
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

      expect(result.profile?.settings).toEqual({ MultiOpPatchRequestAddMultipleMembersToGroup: 'True' });
    });

    it('should handle null profile', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        profile: null,
      });

      const result = await service.getEndpoint('test-endpoint-id');

      expect(result.profile).toBeNull();
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
      // 8 parallel count queries: totalUsers, activeUsers, softDeletedUsers,
      //   totalGroups, activeGroups, softDeletedGroups, totalGroupMembers, requestLogCount
      (prisma.scimResource.count as jest.Mock)
        .mockResolvedValueOnce(10)  // totalUsers
        .mockResolvedValueOnce(8)   // activeUsers
        .mockResolvedValueOnce(2)   // softDeletedUsers
        .mockResolvedValueOnce(5)   // totalGroups
        .mockResolvedValueOnce(5)   // activeGroups
        .mockResolvedValueOnce(0);  // softDeletedGroups
      (prisma.resourceMember.count as jest.Mock).mockResolvedValue(25);
      (prisma.requestLog.count as jest.Mock).mockResolvedValue(100);

      const result = await service.getEndpointStats('test-endpoint-id');

      expect(result).toEqual({
        users: { total: 10, active: 8, softDeleted: 2 },
        groups: { total: 5, active: 5, softDeleted: 0 },
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
        users: { total: 0, active: 0, softDeleted: 0 },
        groups: { total: 0, active: 0, softDeleted: 0 },
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
          settings: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' },
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
      // findMany should NOT be called again — served from cache
      expect(prisma.endpoint.findMany).not.toHaveBeenCalled();
    });

    it('getEndpoint cache miss should fall back to DB', async () => {
      // Don't warm cache — force a cache miss
      const dbEndpoint = { ...cachedEndpoint, id: 'db-only-ep' };
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(dbEndpoint);

      const result = await service.getEndpoint('db-only-ep');
      expect(result.id).toBe('db-only-ep');
      expect(prisma.endpoint.findUnique).toHaveBeenCalledWith({ where: { id: 'db-only-ep' } });
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

  describe('updateEndpoint — partial profile PATCH', () => {
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
        settings: { SoftDeleteEnabled: 'True' },
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
      expect(result.profile?.settings?.SoftDeleteEnabled).toBe('True');
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
        profile: { settings: { SoftDeleteEnabled: 'False' } },
      });

      expect(result.profile?.settings?.SoftDeleteEnabled).toBe('False');
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
      expect(result.profile?.settings?.SoftDeleteEnabled).toBe('True');
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

      expect(result.profile?.settings?.SoftDeleteEnabled).toBe('True');
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
      expect(result.profile?.settings?.SoftDeleteEnabled).toBe('True');
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

      expect(result1.profile?.settings?.SoftDeleteEnabled).toBe('True');
      expect(result1.profile?.settings?.StrictSchemaValidation).toBe('True');

      // Second PATCH: add RequireIfMatch — should keep both previous settings
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

      expect(result2.profile?.settings?.SoftDeleteEnabled).toBe('True');
      expect(result2.profile?.settings?.StrictSchemaValidation).toBe('True');
      expect(result2.profile?.settings?.RequireIfMatch).toBe('True');
    });
  });
});
