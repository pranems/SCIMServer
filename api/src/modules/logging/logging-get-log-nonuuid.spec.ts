/**
 * LoggingService.getLog - malformed id must not reach Postgres.
 *
 * Origin: 2026-07-30. `GET /scim/admin/logs/stream` returned HTTP 500 on every
 * Prisma estate (dev, proudbush, calmsand). There is no `logs/stream` route, so
 * the request fell through to `@Get('logs/:id')` with `id = 'stream'`.
 * `RequestLog.id` is `@db.Uuid`, so Prisma raised
 * `PrismaClientKnownRequestError` P2023 ("Inconsistent column data: Error
 * creating UUID") which escaped the handler as an unhandled 500.
 *
 * Two defects in one:
 *   1. A malformed path param produced a 500 instead of a 404. An unhandled
 *      persistence error escaping to the wire is also a disclosure risk.
 *   2. Cross-backend parity gap (Stage 2.5 / Finding-B class). The InMemory
 *      branch does `rows.find(r => r.id === id)` and returns null -> 404, so
 *      the same request behaved differently per backend:
 *        inmemory `GET /scim/admin/logs/not-a-uuid` -> 404
 *        prisma   `GET /scim/admin/logs/not-a-uuid` -> 500
 *
 * Behavior locked here: a syntactically invalid id resolves to null on BOTH
 * backends, without a database round trip on Prisma.
 *
 * @see api/src/modules/logging/logging.service.ts getLog
 * @see api/src/modules/scim/controllers/admin.controller.ts @Get('logs/:id')
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';

type PrismaMock = {
  requestLog: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    deleteMany: jest.Mock;
    create: jest.Mock;
    createMany: jest.Mock;
  };
};

/** Ids that Postgres cannot cast to `uuid`. `stream` is the reported symptom. */
const MALFORMED_IDS = [
  'stream',
  'not-a-uuid',
  '',
  '12345',
  'undefined',
  '00000000-0000-0000-0000-00000000000', // 35 hex digits, one short
  "1' OR '1'='1",
];

const VALID_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The mock has to FAIL the way Postgres fails, or every malformed-id assertion
 * passes vacuously against a mock that cheerfully resolves null - which is the
 * R10 presence-not-correctness trap in test-double form. A `null`-resolving
 * findUnique would have shown this suite green against the unfixed service.
 */
function buildPrismaMock(): PrismaMock {
  const findUnique = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    if (!UUID_RE.test(where.id)) {
      const err = new Error(
        `\nInvalid \`prisma.requestLog.findUnique()\` invocation\n\nInconsistent column data: Error creating UUID, invalid character: expected an optional prefix of \`urn:uuid:\` followed by [0-9a-fA-F-], found \`${where.id.slice(0, 1)}\` at 1`,
      ) as Error & { code: string; clientVersion: string; name: string };
      err.name = 'PrismaClientKnownRequestError';
      err.code = 'P2023';
      err.clientVersion = '6.0.0';
      return Promise.reject(err);
    }
    return Promise.resolve(null);
  });

  return {
    requestLog: {
      findUnique,
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
      createMany: jest.fn(),
    },
  };
}

async function buildService(backend: 'prisma' | 'inmemory', prisma: PrismaMock): Promise<LoggingService> {
  process.env.PERSISTENCE_BACKEND = backend;
  process.env.LOG_AUTO_PRUNE = 'false';

  const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), trace: jest.fn() };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LoggingService,
      { provide: PrismaService, useValue: prisma },
      { provide: ScimLogger, useValue: logger },
    ],
  }).compile();

  return module.get<LoggingService>(LoggingService);
}

describe('LoggingService.getLog - malformed id handling', () => {
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;

  afterEach(() => {
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
  });

  describe('prisma backend', () => {
    let service: LoggingService;
    let prisma: PrismaMock;

    beforeEach(async () => {
      prisma = buildPrismaMock();
      service = await buildService('prisma', prisma);
    });

    afterEach(async () => {
      await service.onModuleDestroy?.();
    });

    it.each(MALFORMED_IDS)('returns null for the malformed id %p instead of throwing', async (id) => {
      await expect(service.getLog(id)).resolves.toBeNull();
    });

    it('never issues a query for a malformed id (the P2023 is raised inside Postgres)', async () => {
      for (const id of MALFORMED_IDS) {
        await service.getLog(id);
      }
      expect(prisma.requestLog.findUnique).not.toHaveBeenCalled();
    });

    it('negative control: the mock really does reject a malformed id the way Postgres does', async () => {
      await expect(
        prisma.requestLog.findUnique({ where: { id: 'stream' } }),
      ).rejects.toMatchObject({ code: 'P2023', name: 'PrismaClientKnownRequestError' });
    });

    it('still queries for a syntactically valid uuid', async () => {
      await expect(service.getLog(VALID_UUID)).resolves.toBeNull();
      expect(prisma.requestLog.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.requestLog.findUnique).toHaveBeenCalledWith({ where: { id: VALID_UUID } });
    });

    it('accepts an upper-case uuid, which Postgres also casts', async () => {
      await service.getLog(VALID_UUID.toUpperCase());
      expect(prisma.requestLog.findUnique).toHaveBeenCalledTimes(1);
    });

    it('returns the mapped row when a valid uuid resolves', async () => {
      prisma.requestLog.findUnique.mockResolvedValueOnce({
        id: VALID_UUID,
        endpointId: null,
        method: 'GET',
        url: '/scim/v2/Users',
        status: 200,
        durationMs: 12,
        createdAt: new Date('2026-07-30T00:00:00.000Z'),
        requestHeaders: '{}',
        requestBody: null,
        responseHeaders: '{}',
        responseBody: null,
        errorMessage: null,
        requestId: null,
        authOutcome: null,
        authMethod: null,
        authReason: null,
        authCredentialId: null,
        authDecision: null,
      });

      const row = await service.getLog(VALID_UUID);
      expect(row).not.toBeNull();
      expect(row?.id).toBe(VALID_UUID);
      expect(row?.method).toBe('GET');
    });
  });

  describe('inmemory backend - parity lock', () => {
    let service: LoggingService;

    beforeEach(async () => {
      service = await buildService('inmemory', buildPrismaMock());
    });

    afterEach(async () => {
      await service.onModuleDestroy?.();
    });

    it.each(MALFORMED_IDS)('returns null for the malformed id %p, exactly as Prisma does', async (id) => {
      await expect(service.getLog(id)).resolves.toBeNull();
    });

    it('returns null for an absent but valid uuid, exactly as Prisma does', async () => {
      await expect(service.getLog(VALID_UUID)).resolves.toBeNull();
    });
  });
});
