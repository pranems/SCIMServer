/**
 * PrismaService Unit Tests
 *
 * Phase 3: Tests the PostgreSQL adapter lifecycle — constructor fallback URL,
 * InMemory skip logic in onModuleInit/onModuleDestroy, and pool cleanup.
 *
 * Note: These tests mock `pg.Pool` and `PrismaPg` to avoid needing a real
 * PostgreSQL instance. Integration-level DB connectivity is tested via E2E.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

import { PrismaService } from './prisma.service';

// Mock pg module
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);
const mockPool = { end: mockPoolEnd };
jest.mock('pg', () => ({
  __esModule: true,
  default: {
    Pool: jest.fn().mockImplementation(() => mockPool),
  },
}));

// Mock PrismaPg adapter
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

// Mock PrismaClient to avoid real DB connection in constructor
jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    constructor(_opts?: unknown) {
      // no-op
    }
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
  },
}));

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

describe('PrismaService', () => {
  const originalDbUrl = process.env.DATABASE_URL;
  const originalBackend = process.env.PERSISTENCE_BACKEND;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.PERSISTENCE_BACKEND;
  });

  afterEach(() => {
    if (originalDbUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDbUrl;
    }
    if (originalBackend === undefined) {
      delete process.env.PERSISTENCE_BACKEND;
    } else {
      process.env.PERSISTENCE_BACKEND = originalBackend;
    }
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should use fallback URL when DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL;
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      new PrismaService();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://scim:scim@localhost:5432/scimdb',
          max: 5,
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DATABASE_URL not set'),
      );
      consoleSpy.mockRestore();
    });

    it('should use DATABASE_URL when set', () => {
      process.env.DATABASE_URL = 'postgresql://custom:custom@custom-host:5433/customdb';

      new PrismaService();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://custom:custom@custom-host:5433/customdb',
          max: 5,
        }),
      );
    });

    it('should use fallback URL when DATABASE_URL is empty string', () => {
      process.env.DATABASE_URL = '   ';
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      new PrismaService();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://scim:scim@localhost:5432/scimdb',
        }),
      );
      consoleSpy.mockRestore();
    });

    it('should create PrismaPg adapter with the pool', () => {
      new PrismaService();

      expect(PrismaPg).toHaveBeenCalledWith(mockPool);
    });

    it('should configure pool with max 5 connections', () => {
      new PrismaService();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({ max: 5 }),
      );
    });
  });

  // ── onModuleInit ───────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should skip $connect when PERSISTENCE_BACKEND is inmemory', async () => {
      process.env.PERSISTENCE_BACKEND = 'inmemory';
      const service = new PrismaService();

      await service.onModuleInit();

      expect(service.$connect).not.toHaveBeenCalled();
    });

    it('should skip $connect when PERSISTENCE_BACKEND is INMEMORY (case-insensitive)', async () => {
      process.env.PERSISTENCE_BACKEND = 'INMEMORY';
      const service = new PrismaService();

      await service.onModuleInit();

      expect(service.$connect).not.toHaveBeenCalled();
    });

    it('should call $connect when PERSISTENCE_BACKEND is prisma', async () => {
      process.env.PERSISTENCE_BACKEND = 'prisma';
      const service = new PrismaService();

      await service.onModuleInit();

      expect(service.$connect).toHaveBeenCalledTimes(1);
    });

    it('should call $connect when PERSISTENCE_BACKEND is not set', async () => {
      delete process.env.PERSISTENCE_BACKEND;
      const service = new PrismaService();

      await service.onModuleInit();

      expect(service.$connect).toHaveBeenCalledTimes(1);
    });
  });

  // ── onModuleDestroy ────────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('should skip $disconnect but still end pool when inmemory', async () => {
      process.env.PERSISTENCE_BACKEND = 'inmemory';
      const service = new PrismaService();

      await service.onModuleDestroy();

      expect(service.$disconnect).not.toHaveBeenCalled();
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it('should call both $disconnect and pool.end() for prisma backend', async () => {
      process.env.PERSISTENCE_BACKEND = 'prisma';
      const service = new PrismaService();

      await service.onModuleDestroy();

      expect(service.$disconnect).toHaveBeenCalledTimes(1);
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it('should always call pool.end() regardless of backend', async () => {
      delete process.env.PERSISTENCE_BACKEND;
      const service = new PrismaService();

      await service.onModuleDestroy();

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });
  });
});
