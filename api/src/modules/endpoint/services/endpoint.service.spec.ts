import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EndpointService } from './endpoint.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EndpointService', () => {
  let service: EndpointService;
  let prisma: PrismaService;

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
      ],
    }).compile();

    service = module.get<EndpointService>(EndpointService);
    prisma = module.get<PrismaService>(PrismaService);
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
});
