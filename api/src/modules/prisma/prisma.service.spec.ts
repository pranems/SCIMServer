/**
 * PrismaService Unit Tests
 *
 * Phase 3: Tests the PostgreSQL adapter lifecycle - constructor fallback URL,
 * InMemory skip logic in onModuleInit/onModuleDestroy, and pool cleanup.
 *
 * Note: These tests mock `pg.Pool` and `PrismaPg` to avoid needing a real
 * PostgreSQL instance. Integration-level DB connectivity is tested via E2E.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

import { PrismaService } from './prisma.service';
import { Test } from '@nestjs/testing';
import { ScimLogger } from '../logging/scim-logger.service';
import { LogCategory } from '../logging/log-levels';

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
import { RUNTIME_CONFIG_SPECS } from '../../bootstrap/runtime-config';

describe('PrismaService', () => {
  const originalDbUrl = process.env.DATABASE_URL;
  const originalBackend = process.env.PERSISTENCE_BACKEND;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.PERSISTENCE_BACKEND;
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
          max: RUNTIME_CONFIG_SPECS.database.poolMax.default,
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DATABASE_URL not set'),
      );
      expect(consoleSpy.mock.calls.every(
        ([message]) => message === '[PrismaService] DATABASE_URL not set - using local development fallback.',
      )).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should use DATABASE_URL when set', () => {
      process.env.DATABASE_URL = 'postgresql://custom:custom@custom-host:5433/customdb';

      new PrismaService();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://custom:custom@custom-host:5433/customdb',
          max: RUNTIME_CONFIG_SPECS.database.poolMax.default,
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

    it('should configure the pool with the documented default', () => {
      new PrismaService();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({ max: RUNTIME_CONFIG_SPECS.database.poolMax.default }),
      );
    });
  });

  // ── onModuleInit ───────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('reports connection success without disclosing configured URI components', async () => {
      const password = 'prisma-startup-fixture-password';
      const username = 'prisma-startup-fixture-user';
      const hostname = 'prisma-startup-fixture.invalid';
      const url = `postgresql://${username}:${password}@${hostname}:5432/fixture_database`;
      process.env.DATABASE_URL = url;
      process.env.PERSISTENCE_BACKEND = 'prisma';
      const logger: jest.Mocked<Pick<ScimLogger, 'info' | 'warn' | 'error'>> = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const module = await Test.createTestingModule({
        providers: [PrismaService, { provide: ScimLogger, useValue: logger }],
      }).compile();
      const service = module.get(PrismaService);

      try {
        await service.onModuleInit();

        expect(service.$connect).toHaveBeenCalledTimes(1);
        expect(pg.Pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: url }));
        expect(logger.info).toHaveBeenCalledWith(LogCategory.DATABASE, 'PostgreSQL connected successfully');
        const output = JSON.stringify({
          info: logger.info.mock.calls,
          warn: logger.warn.mock.calls,
          error: logger.error.mock.calls,
        });
        expect([url, password, username, hostname].some(marker => output.includes(marker))).toBe(false);
      } finally {
        await module.close();
      }
    });

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

  // ── shutdown ───────────────────────────────────────────────────────────────
  //
  // Connection teardown moved from `onModuleDestroy` to `onApplicationShutdown`
  // on 2026-07-30, because Nest gives no ordering guarantee between two modules'
  // `onModuleDestroy` hooks and LoggingService flushes drained audit rows in
  // its own. See prisma-shutdown-ordering.spec.ts for the ordering assertions.

  describe('onApplicationShutdown', () => {
    it('should skip $disconnect but still end pool when inmemory', async () => {
      process.env.PERSISTENCE_BACKEND = 'inmemory';
      const service = new PrismaService();

      await service.onApplicationShutdown();

      expect(service.$disconnect).not.toHaveBeenCalled();
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it('should call both $disconnect and pool.end() for prisma backend', async () => {
      process.env.PERSISTENCE_BACKEND = 'prisma';
      const service = new PrismaService();

      await service.onApplicationShutdown();

      expect(service.$disconnect).toHaveBeenCalledTimes(1);
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it('should always call pool.end() regardless of backend', async () => {
      delete process.env.PERSISTENCE_BACKEND;
      const service = new PrismaService();

      await service.onApplicationShutdown();

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });
  });
});
