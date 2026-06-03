/**
 * ActivityParserService Unit Tests
 *
 * Tests the SCIM request log → human-readable activity parser.
 * Critical: resolveUserName/resolveGroupName must guard against non-UUID
 * identifiers to prevent PostgreSQL "invalid input syntax for type uuid"
 * errors that exhaust the Prisma connection pool.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ActivityParserService } from './activity-parser.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from '../logging/scim-logger.service';

describe('ActivityParserService', () => {
  let service: ActivityParserService;
  let prisma: {
    scimResource: {
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      scimResource: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityParserService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: null },
      ],
    }).compile();

    service = module.get<ActivityParserService>(ActivityParserService);
  });

  // ── resolveUserName UUID guard ─────────────────────────────────────────────

  describe('resolveUserName UUID guard', () => {
    it('should return non-UUID identifier unchanged without querying DB', async () => {
      // Access private method via type assertion for testing
      const result = await (service as any).resolveUserName('alice@example.com');
      expect(result).toBe('alice@example.com');
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });

    it('should return empty-string identifier unchanged', async () => {
      const result = await (service as any).resolveUserName('');
      expect(result).toBe('');
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });

    it('should return random-string identifier unchanged', async () => {
      const result = await (service as any).resolveUserName('dotpath-proj-123@test.com');
      expect(result).toBe('dotpath-proj-123@test.com');
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });

    it('should query DB when identifier is a valid UUID', async () => {
      prisma.scimResource.findFirst.mockResolvedValue({
        userName: 'alice',
        payload: { displayName: 'Alice Smith' },
      });

      const result = await (service as any).resolveUserName('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
      expect(result).toBe('Alice Smith');
      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { scimId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890', resourceType: 'User' },
        }),
      );
    });

    it('should fall back to userName when payload has no displayName', async () => {
      prisma.scimResource.findFirst.mockResolvedValue({
        userName: 'alice@corp.com',
        payload: {},
      });

      const result = await (service as any).resolveUserName('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
      expect(result).toBe('alice@corp.com');
    });

    it('should return UUID unchanged when user not found', async () => {
      prisma.scimResource.findFirst.mockResolvedValue(null);

      const result = await (service as any).resolveUserName('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
      expect(result).toBe('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
    });

    it('should return UUID unchanged when DB throws', async () => {
      prisma.scimResource.findFirst.mockRejectedValue(new Error('connection failed'));

      const result = await (service as any).resolveUserName('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
      expect(result).toBe('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
    });
  });

  // ── resolveGroupName UUID guard ────────────────────────────────────────────

  describe('resolveGroupName UUID guard', () => {
    it('should return non-UUID identifier unchanged without querying DB', async () => {
      const result = await (service as any).resolveGroupName('my-group-name');
      expect(result).toBe('my-group-name');
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });

    it('should query DB when identifier is a valid UUID', async () => {
      prisma.scimResource.findFirst.mockResolvedValue({
        displayName: 'Engineering Team',
      });

      const result = await (service as any).resolveGroupName('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
      expect(result).toBe('Engineering Team');
      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { scimId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890', resourceType: 'Group' },
        }),
      );
    });

    it('should return UUID unchanged when group not found', async () => {
      prisma.scimResource.findFirst.mockResolvedValue(null);

      const result = await (service as any).resolveGroupName('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
      expect(result).toBe('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
    });

    it('should return UUID unchanged when DB throws', async () => {
      prisma.scimResource.findFirst.mockRejectedValue(new Error('connection failed'));

      const result = await (service as any).resolveGroupName('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
      expect(result).toBe('a1b2c3d4-e5f6-4890-abcd-ef1234567890');
    });
  });

  // ── parseActivity ──────────────────────────────────────────────────────────

  describe('parseActivity', () => {
    it('should parse a POST /Users log into a user creation activity', async () => {
      const activity = await service.parseActivity({
        id: 'log-1',
        method: 'POST',
        url: '/scim/endpoints/ep1/Users',
        status: 201,
        requestBody: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'new@test.com',
        }),
        responseBody: JSON.stringify({ id: 'u1', userName: 'new@test.com' }),
        createdAt: '2026-04-16T12:00:00Z',
        identifier: 'u1',
      });

      expect(activity).toHaveProperty('id', 'log-1');
      expect(activity).toHaveProperty('type', 'user');
      expect(activity).toHaveProperty('severity');
      expect(activity).toHaveProperty('message');
      expect(activity).toHaveProperty('timestamp', '2026-04-16T12:00:00Z');
    });

    it('should parse a DELETE /Groups log into a group activity', async () => {
      const activity = await service.parseActivity({
        id: 'log-2',
        method: 'DELETE',
        url: '/scim/endpoints/ep1/Groups/g1',
        status: 204,
        createdAt: '2026-04-16T12:00:00Z',
        identifier: 'g1',
      });

      expect(activity).toHaveProperty('type', 'group');
    });

    it('should not crash when identifier is a non-UUID string', async () => {
      // This was the exact production crash scenario - non-UUID identifiers
      // passed to resolveUserName → prisma.scimResource.findFirst on @db.Uuid column
      const activity = await service.parseActivity({
        id: 'log-3',
        method: 'GET',
        url: '/scim/endpoints/ep1/Users',
        status: 200,
        createdAt: '2026-04-16T12:00:00Z',
        identifier: 'dotpath-proj-1106577013@test.com',
      });

      expect(activity).toHaveProperty('id', 'log-3');
      // Should NOT have called findFirst with a non-UUID
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });
  });
});
