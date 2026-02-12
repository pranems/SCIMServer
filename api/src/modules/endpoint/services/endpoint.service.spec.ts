import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EndpointService } from './endpoint.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';

describe('EndpointService', () => {
  let service: EndpointService;
  let prisma: PrismaService;
  let scimLogger: ScimLogger;

  const mockEndpoint = {
    id: 'test-endpoint-id',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'A test endpoint',
    config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: 'True' }),
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
            scimUser: {
              count: jest.fn(),
            },
            scimGroup: {
              count: jest.fn(),
            },
            groupMember: {
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
    describe('config validation for MultiOpPatchRequestAddMultipleMembersToGroup', () => {
      it('should accept "True" as valid value', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue(mockEndpoint);

        const result = await service.createEndpoint({
          name: 'test-endpoint',
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' },
        });

        expect(result).toBeDefined();
      });

      it('should accept "False" as valid value', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: 'False' }),
        });

        const result = await service.createEndpoint({
          name: 'test-endpoint',
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'False' },
        });

        expect(result).toBeDefined();
      });

      it('should accept boolean true as valid value', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: true }),
        });

        const result = await service.createEndpoint({
          name: 'test-endpoint',
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: true },
        });

        expect(result).toBeDefined();
      });

      it('should accept boolean false as valid value', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: false }),
        });

        const result = await service.createEndpoint({
          name: 'test-endpoint',
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: false },
        });

        expect(result).toBeDefined();
      });

      it('should accept "true" (lowercase) as valid value', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: 'true' }),
        });

        const result = await service.createEndpoint({
          name: 'test-endpoint',
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'true' },
        });

        expect(result).toBeDefined();
      });

      it('should accept "1" as valid value', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: '1' }),
        });

        const result = await service.createEndpoint({
          name: 'test-endpoint',
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: '1' },
        });

        expect(result).toBeDefined();
      });

      it('should accept "0" as valid value', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: '0' }),
        });

        const result = await service.createEndpoint({
          name: 'test-endpoint',
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: '0' },
        });

        expect(result).toBeDefined();
      });

      it('should reject invalid string value "Yes"', async () => {
        await expect(
          service.createEndpoint({
            name: 'test-endpoint',
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'Yes' },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject invalid string value "No"', async () => {
        await expect(
          service.createEndpoint({
            name: 'test-endpoint',
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'No' },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject invalid string value "enabled"', async () => {
        await expect(
          service.createEndpoint({
            name: 'test-endpoint',
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'enabled' },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject number value', async () => {
        await expect(
          service.createEndpoint({
            name: 'test-endpoint',
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: 123 },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject object value', async () => {
        await expect(
          service.createEndpoint({
            name: 'test-endpoint',
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: { enabled: true } },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should include helpful error message for invalid value', async () => {
        try {
          await service.createEndpoint({
            name: 'test-endpoint',
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid' },
          });
          fail('Expected BadRequestException');
        } catch (e) {
          const error = e as BadRequestException;
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toContain('Invalid value');
          expect(error.message).toContain('MultiOpPatchRequestAddMultipleMembersToGroup');
          expect(error.message).toContain('Allowed values');
        }
      });
    });
  });

  describe('updateEndpoint', () => {
    describe('config validation for MultiOpPatchRequestAddMultipleMembersToGroup', () => {
      it('should accept "True" as valid value on update', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.update as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ MultiOpPatchRequestAddMultipleMembersToGroup: 'True' }),
        });

        const result = await service.updateEndpoint('test-endpoint-id', {
          config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'True' },
        });

        expect(result).toBeDefined();
      });

      it('should reject invalid string value on update', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);

        await expect(
          service.updateEndpoint('test-endpoint-id', {
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid' },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject number value on update', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);

        await expect(
          service.updateEndpoint('test-endpoint-id', {
            config: { MultiOpPatchRequestAddMultipleMembersToGroup: 42 },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should allow update without config', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.update as jest.Mock).mockResolvedValue(mockEndpoint);

        const result = await service.updateEndpoint('test-endpoint-id', {
          displayName: 'New Name',
        });

        expect(result).toBeDefined();
      });
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

    it('should parse config JSON correctly', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);

      const result = await service.getEndpoint('test-endpoint-id');

      expect(result.config).toEqual({ MultiOpPatchRequestAddMultipleMembersToGroup: 'True' });
    });

    it('should handle null config', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        config: null,
      });

      const result = await service.getEndpoint('test-endpoint-id');

      expect(result.config).toBeUndefined();
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

      expect(result).toHaveLength(1);
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

    it('should return empty array when no endpoints exist', async () => {
      (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listEndpoints();

      expect(result).toEqual([]);
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
    it('should return endpoint statistics', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      (prisma.scimUser.count as jest.Mock).mockResolvedValue(10);
      (prisma.scimGroup.count as jest.Mock).mockResolvedValue(5);
      (prisma.groupMember.count as jest.Mock).mockResolvedValue(25);
      (prisma.requestLog.count as jest.Mock).mockResolvedValue(100);

      const result = await service.getEndpointStats('test-endpoint-id');

      expect(result).toEqual({
        totalUsers: 10,
        totalGroups: 5,
        totalGroupMembers: 25,
        requestLogCount: 100,
      });
    });

    it('should return zero counts for empty endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
      (prisma.scimUser.count as jest.Mock).mockResolvedValue(0);
      (prisma.scimGroup.count as jest.Mock).mockResolvedValue(0);
      (prisma.groupMember.count as jest.Mock).mockResolvedValue(0);
      (prisma.requestLog.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getEndpointStats('test-endpoint-id');

      expect(result).toEqual({
        totalUsers: 0,
        totalGroups: 0,
        totalGroupMembers: 0,
        requestLogCount: 0,
      });
    });

    it('should throw NotFoundException for non-existent endpoint', async () => {
      (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getEndpointStats('non-existent')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('logLevel syncing via endpoint config', () => {
    describe('createEndpoint with logLevel', () => {
      it('should call setEndpointLevel when config contains logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ logLevel: 'DEBUG' }),
        });

        await service.createEndpoint({
          name: 'test-endpoint',
          config: { logLevel: 'DEBUG' },
        });

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('test-endpoint-id', expect.any(Number));
      });

      it('should call clearEndpointLevel when config has no logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ strictMode: true }),
        });

        await service.createEndpoint({
          name: 'test-endpoint',
          config: { strictMode: true },
        });

        expect(scimLogger.clearEndpointLevel).toHaveBeenCalledWith('test-endpoint-id');
      });

      it('should not sync logLevel when config is not provided', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: null,
        });

        await service.createEndpoint({ name: 'test-endpoint' });

        // Should clear since null config means no logLevel
        expect(scimLogger.clearEndpointLevel).toHaveBeenCalledWith('test-endpoint-id');
      });

      it('should reject invalid logLevel string', async () => {
        await expect(
          service.createEndpoint({
            name: 'test-endpoint',
            config: { logLevel: 'VERBOSE' },
          })
        ).rejects.toThrow(BadRequestException);
      });

      it('should accept numeric logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.endpoint.create as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ logLevel: 0 }),
        });

        await service.createEndpoint({
          name: 'test-endpoint',
          config: { logLevel: 0 },
        });

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('test-endpoint-id', 0);
      });
    });

    describe('updateEndpoint with logLevel', () => {
      it('should call setEndpointLevel when updating config with logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.update as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ logLevel: 'TRACE' }),
        });

        await service.updateEndpoint('test-endpoint-id', {
          config: { logLevel: 'TRACE' },
        });

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('test-endpoint-id', expect.any(Number));
      });

      it('should call clearEndpointLevel when updating config without logLevel', async () => {
        (prisma.endpoint.findUnique as jest.Mock).mockResolvedValue(mockEndpoint);
        (prisma.endpoint.update as jest.Mock).mockResolvedValue({
          ...mockEndpoint,
          config: JSON.stringify({ strictMode: true }),
        });

        await service.updateEndpoint('test-endpoint-id', {
          config: { strictMode: true },
        });

        expect(scimLogger.clearEndpointLevel).toHaveBeenCalledWith('test-endpoint-id');
      });

      it('should not sync logLevel when config is not in the update dto', async () => {
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
      it('should restore logLevel from endpoints with logLevel in config', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            config: JSON.stringify({ logLevel: 'DEBUG' }),
          },
          {
            id: 'ep-2',
            name: 'endpoint-2',
            config: JSON.stringify({ logLevel: 'TRACE' }),
          },
        ]);

        await service.onModuleInit();

        expect(scimLogger.setEndpointLevel).toHaveBeenCalledTimes(2);
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('ep-1', expect.any(Number));
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('ep-2', expect.any(Number));
      });

      it('should skip endpoints without logLevel in config', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            config: JSON.stringify({ strictMode: true }),
          },
        ]);

        await service.onModuleInit();

        expect(scimLogger.setEndpointLevel).not.toHaveBeenCalled();
      });

      it('should skip endpoints with null config', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            config: null,
          },
        ]);

        await service.onModuleInit();

        expect(scimLogger.setEndpointLevel).not.toHaveBeenCalled();
      });

      it('should handle empty endpoint list gracefully', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([]);

        await expect(service.onModuleInit()).resolves.not.toThrow();
      });

      it('should handle database errors gracefully', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockRejectedValue(new Error('DB error'));

        await expect(service.onModuleInit()).resolves.not.toThrow();
      });

      it('should skip endpoints with malformed config JSON', async () => {
        (prisma.endpoint.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'ep-1',
            name: 'endpoint-1',
            config: 'not-valid-json',
          },
          {
            id: 'ep-2',
            name: 'endpoint-2',
            config: JSON.stringify({ logLevel: 'INFO' }),
          },
        ]);

        await service.onModuleInit();

        // Only ep-2 should be restored, ep-1 should be skipped
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledTimes(1);
        expect(scimLogger.setEndpointLevel).toHaveBeenCalledWith('ep-2', expect.any(Number));
      });
    });
  });
});
