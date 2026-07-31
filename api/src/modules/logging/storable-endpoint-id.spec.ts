/**
 * `RequestLog.endpointId` is the SECOND `@db.Uuid` column reachable from
 * caller-controlled input, and it was left open when the `requestId` vector was
 * closed in v0.54.85.
 *
 * Origin: 2026-07-30, read out of the server log of a Prisma live run:
 *
 *   prisma:error Invalid `this.prisma.requestLog.createMany()` invocation
 *   Invalid input value: invalid input syntax for type uuid: "by-name"
 *   Invalid input value: invalid input syntax for type uuid: "dfc2f6d9-...?view=summary"
 *
 * [request-logging.interceptor.ts](./request-logging.interceptor.ts) derives the
 * value with `originalUrl?.match(/\/endpoints\/([^/]+)/)?.[1]` - a raw path
 * segment, with no validation. So `GET /scim/endpoints/<anything>/Users` puts
 * `<anything>` into a uuid column.
 *
 * The consequence is identical to the requestId defect and equally severe: rows
 * flush in batches of up to 50 through a single `createMany`, the batch is
 * drained from the buffer BEFORE the insert is attempted, and a failure is only
 * logged - so ONE poisoned row silently destroys up to 49 unrelated audit-log
 * rows. The interceptor wraps unauthenticated requests too (401s are logged), so
 * a caller can trigger it deliberately to erase the record of their own traffic.
 *
 * Two real, live-observed vectors, neither of them exotic:
 *   - `/scim/admin/endpoints/by-name/<name>`  -> "by-name"
 *   - `/scim/endpoints/<uuid>?view=summary`   -> "<uuid>?view=summary"
 *
 * @see api/src/modules/logging/storable-uuid.ts - the same guard, one column earlier
 * @see api/src/modules/logging/storable-uuid.spec.ts
 */
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { toStorableEndpointId } from './storable-uuid';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('toStorableEndpointId (audit-log integrity guard)', () => {
  it('keeps a valid UUID so endpoint correlation still works', () => {
    const id = randomUUID();
    expect(toStorableEndpointId(id)).toBe(id);
  });

  it('keeps a valid UUID regardless of case', () => {
    const id = randomUUID().toUpperCase();
    expect(toStorableEndpointId(id)).toBe(id);
  });

  it('returns null for undefined, null, empty or whitespace', () => {
    expect(toStorableEndpointId(undefined)).toBeNull();
    expect(toStorableEndpointId(null)).toBeNull();
    expect(toStorableEndpointId('')).toBeNull();
    expect(toStorableEndpointId('   ')).toBeNull();
  });

  it('nulls the two path segments actually observed poisoning a live batch', () => {
    expect(toStorableEndpointId('by-name')).toBeNull();
    expect(toStorableEndpointId('dfc2f6d9-7e10-4cd7-9819-1acd4a0d0729?view=summary')).toBeNull();
  });

  it('nulls other real route segments that are not endpoint ids', () => {
    for (const raw of ['discovery', 'import', 'presets', 'summary', '..']) {
      expect(toStorableEndpointId(raw)).toBeNull();
    }
  });

  it('neutralises hostile path values', () => {
    const hostile = [
      "'; DROP TABLE \"RequestLog\"; --",
      '../../etc/passwd',
      'x'.repeat(10_000),
      '<script>alert(1)</script>',
    ];
    for (const raw of hostile) expect(toStorableEndpointId(raw)).toBeNull();
  });
});

describe('LoggingService - a poisoned endpointId must not reach the batch', () => {
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;

  /**
   * Fails the way Postgres fails. A `createMany` mock that accepted anything
   * would let this suite pass against the unfixed service, which is precisely
   * how the defect survived a full green gate set until a live run printed the
   * driver error.
   */
  function buildPrisma() {
    const createMany = jest.fn().mockImplementation(({ data }: { data: Array<Record<string, unknown>> }) => {
      for (const row of data) {
        for (const col of ['endpointId', 'requestId'] as const) {
          const v = row[col];
          if (v === null || v === undefined) continue;
          if (typeof v !== 'string' || !UUID_RE.test(v)) {
            const err = new Error(
              `Invalid \`prisma.requestLog.createMany()\` invocation\n\n` +
                `Invalid input value: invalid input syntax for type uuid: "${typeof v === 'string' ? v : JSON.stringify(v)}"`,
            ) as Error & { code: string; name: string };
            err.name = 'PrismaClientKnownRequestError';
            err.code = 'P2023';
            return Promise.reject(err);
          }
        }
      }
      return Promise.resolve({ count: data.length });
    });

    return {
      requestLog: {
        createMany,
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      scimResource: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let service: LoggingService;

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'prisma';
    process.env.LOG_AUTO_PRUNE = 'false';
    prisma = buildPrisma();

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

  function record(endpointId: string | undefined, url: string) {
    service.recordRequest({
      method: 'GET',
      url,
      status: 200,
      durationMs: 1,
      requestHeaders: {},
      responseHeaders: {},
      endpointId,
    });
  }

  it('stores null instead of a non-uuid path segment', async () => {
    record('by-name', '/scim/admin/endpoints/by-name/acme');
    await service.flushLogs();

    expect(prisma.requestLog.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.requestLog.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].endpointId).toBeNull();
  });

  it('keeps a genuine endpoint id so correlation is not lost', async () => {
    const epId = randomUUID();
    record(epId, `/scim/endpoints/${epId}/Users`);
    await service.flushLogs();

    const rows = prisma.requestLog.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(rows[0].endpointId).toBe(epId);
  });

  it('ONE poisoned row must not destroy the rest of the batch', async () => {
    const goodId = randomUUID();
    for (let i = 0; i < 5; i++) record(goodId, `/scim/endpoints/${goodId}/Users?i=${i}`);
    record('by-name', '/scim/admin/endpoints/by-name/acme');
    for (let i = 0; i < 5; i++) record(goodId, `/scim/endpoints/${goodId}/Groups?i=${i}`);

    await service.flushLogs();

    // The insert must have SUCCEEDED - an unguarded value rejects the whole
    // createMany, and because the buffer is drained first all 11 rows vanish.
    await expect(prisma.requestLog.createMany.mock.results[0].value).resolves.toEqual({ count: 11 });

    const rows = prisma.requestLog.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(11);
    expect(rows.filter((r) => r.endpointId === goodId)).toHaveLength(10);
    expect(rows.filter((r) => r.endpointId === null)).toHaveLength(1);
  });

  it('negative control: the mock really does reject a non-uuid endpointId', async () => {
    await expect(
      prisma.requestLog.createMany({ data: [{ endpointId: 'by-name', requestId: null }] }),
    ).rejects.toMatchObject({ code: 'P2023' });
  });
});
