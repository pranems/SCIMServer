/**
 * LoggingService.getRequestSeries - Phase D4 Dashboard charts.
 *
 * Returns a fixed-length number[] of per-hour request counts. Powers the
 * dashboard sparkline (Phase C `KpiChart`) wired into DashboardController
 * BFF response (`requestsLast24hSeries`).
 *
 * Behavior locked here:
 *   - length always equals `hours` (default 24, clamped 1..168)
 *   - oldest bucket first (index 0), current hour last (index hours-1)
 *   - admin / health / root traffic excluded (matches listLogs default)
 *   - on Prisma error -> returns zero series (graceful degradation)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';

describe('LoggingService - getRequestSeries (Phase D4)', () => {
  let service: LoggingService;
  let prisma: { requestLog: { findMany: jest.Mock; count: jest.Mock; deleteMany: jest.Mock; create: jest.Mock; createMany: jest.Mock } };
  let logger: { info: jest.Mock; error: jest.Mock; debug: jest.Mock; warn: jest.Mock; trace: jest.Mock };
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'prisma';
    process.env.LOG_AUTO_PRUNE = 'false';

    prisma = {
      requestLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        createMany: jest.fn(),
      },
    };

    logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), trace: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile();
    service = module.get<LoggingService>(LoggingService);
  });

  afterEach(async () => {
    await service.onModuleDestroy?.();
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
  });

  describe('shape contract', () => {
    it('returns an array of exactly 24 entries by default', async () => {
      const series = await service.getRequestSeries();
      expect(series).toHaveLength(24);
      expect(series.every((n) => typeof n === 'number')).toBe(true);
    });

    it('returns an array of exactly `hours` entries when supplied', async () => {
      const series = await service.getRequestSeries({ hours: 6 });
      expect(series).toHaveLength(6);
    });

    it('clamps hours to the inclusive range [1, 168]', async () => {
      const tooSmall = await service.getRequestSeries({ hours: 0 });
      expect(tooSmall).toHaveLength(1);

      const tooBig = await service.getRequestSeries({ hours: 1000 });
      expect(tooBig).toHaveLength(168);
    });

    it('returns zero-filled when no rows match', async () => {
      prisma.requestLog.findMany.mockResolvedValue([]);
      const series = await service.getRequestSeries({ hours: 24 });
      expect(series).toEqual(new Array(24).fill(0));
    });
  });

  describe('bucketing', () => {
    it('passes a 24h-cutoff `gte` to Prisma findMany', async () => {
      const before = Date.now();
      await service.getRequestSeries({ hours: 24 });
      const after = Date.now();

      expect(prisma.requestLog.findMany).toHaveBeenCalledTimes(1);
      const args = prisma.requestLog.findMany.mock.calls[0][0];
      const gte: Date = args.where.createdAt.gte;
      expect(gte).toBeInstanceOf(Date);
      // gte is the start of the OLDEST visible bucket. The current bucket
      // is the one containing `now`; the oldest is 23 buckets earlier.
      // So gte is in the window (now - 24h, now - 23h]:
      //   - upper bound: when now is exactly on the hour, gte = now - 23h
      //   - lower bound: when now is just before the hour ticks, gte ~ now - 24h
      const gteMs = gte.getTime();
      const upperBound = after - 23 * 60 * 60 * 1000 + 60_000;
      const lowerBound = before - 24 * 60 * 60 * 1000 - 60_000;
      expect(gteMs).toBeGreaterThanOrEqual(lowerBound);
      expect(gteMs).toBeLessThanOrEqual(upperBound);
    });

    it('selects only createdAt (no large columns)', async () => {
      await service.getRequestSeries({ hours: 24 });
      const args = prisma.requestLog.findMany.mock.calls[0][0];
      expect(args.select).toEqual({ createdAt: true });
    });

    it('counts rows into the correct hourly bucket', async () => {
      // Bucket-anchored offsets. Compute the same `currentBucketStart`
      // the implementation uses, then place rows at deterministic
      // positions inside specific buckets. Avoids clock-edge flakiness
      // (a "now - 0.1h" offset can land in EITHER the current bucket OR
      // the previous one depending on which minute of the hour we run).
      const now = Date.now();
      const hourMs = 60 * 60 * 1000;
      const currentBucketStart = Math.floor(now / hourMs) * hourMs;
      const halfHour = 30 * 60 * 1000;
      const rows = [
        // Inside current bucket (idx=23): use NOW itself - guaranteed
        // to fall in [currentBucketStart, currentBucketStart + hourMs).
        { createdAt: new Date(now) },
        // Halfway through previous bucket (idx=22).
        { createdAt: new Date(currentBucketStart - halfHour) },
        // Halfway through previous bucket again (idx=22, 2nd row).
        { createdAt: new Date(currentBucketStart - halfHour) },
        // Halfway through bucket 22 hours back (idx=1).
        { createdAt: new Date(currentBucketStart - 22 * hourMs + halfHour) },
      ];
      prisma.requestLog.findMany.mockResolvedValue(rows);

      const series = await service.getRequestSeries({ hours: 24 });

      const total = series.reduce((a, b) => a + b, 0);
      expect(total).toBe(4);
      expect(series[23]).toBe(1); // current hour
      expect(series[22]).toBe(2); // 1 hour ago
      expect(series[1]).toBe(1);  // 22 hours ago
    });

    it('drops rows older than the cutoff', async () => {
      const now = Date.now();
      const hourMs = 60 * 60 * 1000;
      const rows = [
        { createdAt: new Date(now - 25 * hourMs) }, // older than 24h
        { createdAt: new Date(now - 100 * hourMs) },
      ];
      prisma.requestLog.findMany.mockResolvedValue(rows);

      const series = await service.getRequestSeries({ hours: 24 });
      expect(series.reduce((a, b) => a + b, 0)).toBe(0);
    });
  });

  describe('admin / health exclusion', () => {
    it('passes a where-clause that excludes /scim/admin/, /, and /health', async () => {
      await service.getRequestSeries({ hours: 24 });
      const args = prisma.requestLog.findMany.mock.calls[0][0];
      const ands = args.where.AND as Array<Record<string, unknown>>;
      expect(ands).toHaveLength(3);
      expect(ands[0]).toEqual({ url: { not: { contains: '/scim/admin/' } } });
      expect(ands[1]).toEqual({ url: { not: { equals: '/' } } });
      expect(ands[2]).toEqual({ url: { not: { equals: '/health' } } });
    });
  });

  describe('error handling', () => {
    it('returns zeros and logs error when Prisma throws (no 500)', async () => {
      prisma.requestLog.findMany.mockRejectedValueOnce(new Error('connection refused'));
      const series = await service.getRequestSeries({ hours: 24 });
      expect(series).toEqual(new Array(24).fill(0));
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

describe('LoggingService - getRequestSeries (in-memory backend)', () => {
  let service: LoggingService;
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'inmemory';
    process.env.LOG_AUTO_PRUNE = 'false';

    const prisma = {
      requestLog: {
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), trace: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile();
    service = module.get<LoggingService>(LoggingService);
  });

  afterEach(async () => {
    await service.onModuleDestroy?.();
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
  });

  /**
   * In-memory backend exposes the row store via a private field. We seed
   * via the public `recordRequest` API instead - the same path the
   * interceptor uses in production - so the test is faithful.
   */
  function seedRow(opts: { method?: string; url: string; createdAt?: Date }) {
    const meta = {
      method: opts.method ?? 'POST',
      url: opts.url,
      status: 200,
      durationMs: 5,
    };
    service.recordRequest(meta as any);
    // Override the createdAt by reaching into the in-memory store: needed
    // because recordRequest sets `new Date()` internally and we want
    // deterministic bucket placement.
    const rows: any[] = (service as any).inMemoryLogRows;
    const last = rows[rows.length - 1];
    if (last && opts.createdAt) last.createdAt = opts.createdAt;
  }

  it('counts in-memory rows into hourly buckets', async () => {
    // Bucket-anchored offsets - identical pattern to the Prisma test
    // for clock-edge robustness. The "halfway through bucket" choice
    // guarantees the row falls in the intended bucket regardless of
    // wall-clock minute when the test runs.
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const currentBucketStart = Math.floor(now / hourMs) * hourMs;
    const halfHour = 30 * 60 * 1000;
    seedRow({ url: '/scim/endpoints/x/v2/Users', createdAt: new Date(now) });
    seedRow({ url: '/scim/endpoints/x/v2/Users', createdAt: new Date(currentBucketStart - halfHour) });
    seedRow({ url: '/scim/endpoints/x/v2/Groups', createdAt: new Date(currentBucketStart - halfHour) });
    seedRow({ url: '/scim/endpoints/x/v2/Users', createdAt: new Date(currentBucketStart - 22 * hourMs + halfHour) });

    const series = await service.getRequestSeries({ hours: 24 });
    expect(series).toHaveLength(24);
    expect(series.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('excludes /scim/admin/, /, /health (matches Prisma branch)', async () => {
    // Anchor to NOW which is always in the current bucket (idx=23).
    const t = new Date(Date.now());
    seedRow({ url: '/scim/admin/dashboard', createdAt: t });
    seedRow({ url: '/health', createdAt: t });
    seedRow({ url: '/', createdAt: t });
    seedRow({ url: '/scim/endpoints/x/v2/Users', createdAt: t });

    const series = await service.getRequestSeries({ hours: 24 });
    expect(series.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('drops rows older than the cutoff', async () => {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    seedRow({ url: '/scim/endpoints/x/v2/Users', createdAt: new Date(now - 25 * hourMs) });
    seedRow({ url: '/scim/endpoints/x/v2/Users', createdAt: new Date(now - 200 * hourMs) });

    const series = await service.getRequestSeries({ hours: 24 });
    expect(series.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
