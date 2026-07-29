import { RUNTIME_CONFIG_SPECS, resolveRuntimeConfig } from '../../bootstrap/runtime-config';

/**
 * X15-F3 REGRESSION LOCK.
 *
 * The Prisma v6 -> v7 driver-adapter migration moved pooling to a raw `pg.Pool`.
 * Because the pool was constructed with only `max` passed, every other option
 * silently fell back to the `pg` default - including
 * `connectionTimeoutMillis: 0`, which means WAIT FOREVER for a connection. Prisma
 * v6 had defaulted `pool_timeout` to 10 s, so a real bound disappeared and no
 * test noticed, because no test asserted the bound existed.
 *
 * The generalizable lesson (pattern PG-2): when you depend on a library default,
 * assert it; when you override it, assert the override. These tests fail if
 * anyone constructs the pool without passing every option explicitly.
 */
jest.mock('pg', () => {
  const Pool = jest.fn().mockImplementation(() => ({ end: jest.fn() }));
  return { __esModule: true, default: { Pool }, Pool };
});
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class {
    constructor(..._args: unknown[]) {
      /* no-op base */
    }
  },
}));

import pg from 'pg';
import { PrismaService } from './prisma.service';

const PoolMock = pg.Pool as unknown as jest.Mock;

describe('PrismaService connection pool options (X15-F3 lock)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    PoolMock.mockClear();
    process.env = { ...originalEnv, DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function poolOptions(): Record<string, unknown> {
    new PrismaService();
    expect(PoolMock).toHaveBeenCalledTimes(1);
    return PoolMock.mock.calls[0][0] as Record<string, unknown>;
  }

  it('passes an EXPLICIT acquire timeout - pg would otherwise wait forever', () => {
    const opts = poolOptions();
    expect(opts.connectionTimeoutMillis).toBeDefined();
    expect(opts.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it('passes an explicit max, acquire timeout and idle timeout - never a library default', () => {
    const opts = poolOptions();
    for (const key of ['max', 'connectionTimeoutMillis', 'idleTimeoutMillis']) {
      expect(Object.keys(opts)).toContain(key);
    }
  });

  it('uses the documented defaults when no env is set', () => {
    const opts = poolOptions();
    expect(opts.max).toBe(RUNTIME_CONFIG_SPECS.database.poolMax.default);
    expect(opts.connectionTimeoutMillis).toBe(RUNTIME_CONFIG_SPECS.database.poolAcquireTimeoutMs.default);
    expect(opts.idleTimeoutMillis).toBe(RUNTIME_CONFIG_SPECS.database.poolIdleTimeoutMs.default);
  });

  it('honours the env overrides so the pool can move with the deployment', () => {
    process.env.DB_POOL_MAX = '17';
    process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = '4000';
    process.env.DB_POOL_IDLE_TIMEOUT_MS = '25000';
    const opts = poolOptions();
    expect(opts.max).toBe(17);
    expect(opts.connectionTimeoutMillis).toBe(4000);
    expect(opts.idleTimeoutMillis).toBe(25000);
  });

  it('clamps an absurd pool size rather than letting it exhaust the database', () => {
    process.env.DB_POOL_MAX = '100000';
    const opts = poolOptions();
    expect(opts.max).toBe(RUNTIME_CONFIG_SPECS.database.poolMax.max);
    expect(resolveRuntimeConfig((k) => process.env[k]).groups.database.poolMax.clamped).toBe(true);
  });

  it('still passes the connection string', () => {
    expect(poolOptions().connectionString).toBe('postgresql://u:p@localhost:5432/db');
  });
});
