/**
 * Shutdown-ordering regression test.
 *
 * ORIGIN (2026-07-30): the Prisma-backend E2E run was fully green - 87 suites,
 * 1439 tests - while emitting `prisma:error Cannot use a pool after calling end
 * on the pool` to stdout. Nothing failed, because the only consumer of that
 * failure is a `catch` that logs and moves on.
 *
 * THE BUG
 * `LoggingService.onModuleDestroy()` drains the audit-log buffer with
 * `splice(0)` and then awaits a `createMany`. `PrismaService` used to end the
 * connection pool in its OWN `onModuleDestroy()`. Nest runs every module's
 * `onModuleDestroy` in the same phase and guarantees no ordering BETWEEN two
 * modules, so the pool could close first. When it did, the flush threw, the
 * catch swallowed it, and **up to 50 already-drained audit rows were lost
 * silently**.
 *
 * That is not a test-only artifact. `main.ts` calls `enableShutdownHooks()`, so
 * this runs on SIGTERM - which is exactly what Azure Container Apps sends on
 * every revision swap, deploy and scale-in. It is the same failure shape as the
 * two audit-log-loss vectors fixed in v0.54.85 and v0.54.89: buffer drained
 * BEFORE the insert is attempted, failure only logged.
 *
 * THE FIX
 * Connection teardown moved to `onApplicationShutdown()`. Nest's documented
 * termination order is `onModuleDestroy` -> `beforeApplicationShutdown` ->
 * `onApplicationShutdown`, so every module's flush is guaranteed to have
 * completed while the pool was still usable.
 *
 * These tests assert the ORDERING OUTCOME (a query issued during the
 * onModuleDestroy phase still succeeds), not merely that a method exists.
 */

import { PrismaService } from './prisma.service';

const mockPoolEnd = jest.fn().mockResolvedValue(undefined);
const mockPool = { end: mockPoolEnd };
jest.mock('pg', () => ({
  __esModule: true,
  default: { Pool: jest.fn().mockImplementation(() => mockPool) },
}));
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    constructor(_opts?: unknown) {}
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
  },
}));

describe('PrismaService shutdown ordering (audit-log durability)', () => {
  const originalBackend = process.env.PERSISTENCE_BACKEND;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PERSISTENCE_BACKEND = 'prisma';
  });

  afterEach(() => {
    if (originalBackend === undefined) delete process.env.PERSISTENCE_BACKEND;
    else process.env.PERSISTENCE_BACKEND = originalBackend;
  });

  it('does NOT close the connection during the onModuleDestroy phase', () => {
    const service = new PrismaService();

    service.onModuleDestroy();

    // Both must still be open here - another module's onModuleDestroy may still
    // need to flush through this connection.
    expect(mockPoolEnd).not.toHaveBeenCalled();
    expect(service.$disconnect).not.toHaveBeenCalled();
  });

  it('closes the connection in onApplicationShutdown, after all module teardown', async () => {
    const service = new PrismaService();

    await service.onApplicationShutdown();

    expect(service.$disconnect).toHaveBeenCalledTimes(1);
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);
  });

  it('still ends the pool on the inmemory backend, without calling $disconnect', async () => {
    process.env.PERSISTENCE_BACKEND = 'inmemory';
    const service = new PrismaService();

    await service.onApplicationShutdown();

    expect(service.$disconnect).not.toHaveBeenCalled();
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);
  });

  it('a late flush issued during onModuleDestroy still reaches a live pool', async () => {
    // This is the assertion that actually encodes the bug: simulate Nest running
    // PrismaService's module-destroy hook FIRST (the worst-case ordering), then
    // another module flushing. It must not observe a closed connection.
    const service = new PrismaService();
    const flushSpy = jest.fn(() => {
      if (mockPoolEnd.mock.calls.length > 0) {
        throw new Error('Cannot use a pool after calling end on the pool');
      }
      return Promise.resolve();
    });

    service.onModuleDestroy(); // worst-case: Prisma tears down first
    await expect(flushSpy()).resolves.toBeUndefined(); // another module flushes

    await service.onApplicationShutdown(); // only now is it safe to close
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);
  });

  it('is idempotent if shutdown runs twice', async () => {
    const service = new PrismaService();

    await service.onApplicationShutdown();
    await service.onApplicationShutdown();

    // A double close must not throw; pg tolerates it, but we must not rely on
    // that silently - assert the second call is a no-op at our layer.
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);
  });
});
