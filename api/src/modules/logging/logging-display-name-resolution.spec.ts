/**
 * LoggingService user display-name resolution - the userName fallback must be
 * reachable on Prisma.
 *
 * Origin: 2026-07-30, surfaced by the server log of a real Prisma live-test run
 * while validating the `getLog` fix. Every `GET /scim/admin/logs` emitted:
 *
 *   prisma:error Invalid `this.prisma.scimResource.findFirst()` invocation
 *   Invalid input value: invalid input syntax for type uuid: "live-9z-V-user-639210205098866889"
 *
 * `resolveUserDisplayName` does a two-step lookup: by `scimId` first, then
 * falling back to `userName`. But `ScimResource.scimId` is `@db.Uuid` while
 * `userName` is `@db.Citext`, so whenever the identifier is a userName the
 * FIRST query raises P2023 and control jumps straight to the outer `catch`.
 *
 * The consequence is worse than log noise: the `userName` fallback can only run
 * if the first query returns null, and for a non-uuid it never returns - it
 * throws. So the fallback was unreachable, and every userName-identified log row
 * silently kept its raw identifier instead of resolving to a display name. The
 * `catch` made a functional defect look like a working degrade-to-null.
 *
 * Assertions here are at the OUTCOME level (`listLogs` -> `reportableIdentifier`)
 * rather than on the private helper, so they fail if the resolution is broken
 * for any reason, not only this one.
 *
 * @see api/src/modules/logging/logging.service.ts resolveUserDisplayName
 * @see api/prisma/schema.prisma model ScimResource
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A userName-shaped identifier, exactly the shape observed in the live run. */
const USERNAME_ID = 'live-9z-V-user-639210205098866889';
const SCIM_UUID = '9d6d8f66-5c48-4d17-a948-2a27efdedce1';
const LOG_ROW_ID = '4a38144c-96f6-49a6-bc15-857b261898ee';

type ScimWhere = { scimId?: string; userName?: string; resourceType?: string };

function buildPrisma(identifier: string) {
  /**
   * Models Postgres faithfully: `scimId` is a uuid column, so a non-uuid value
   * raises P2023 rather than returning null. A mock that returned null would let
   * this whole suite pass against the unfixed service - the R10
   * presence-not-correctness trap in test-double form, which is exactly how the
   * defect survived until a live run printed the driver error.
   */
  const scimFindFirst = jest.fn().mockImplementation(({ where }: { where: ScimWhere }) => {
    if (where.scimId !== undefined) {
      if (!UUID_RE.test(where.scimId)) {
        const err = new Error(
          'Invalid `prisma.scimResource.findFirst()` invocation\n\n' +
            `Invalid input value: invalid input syntax for type uuid: "${where.scimId}"`,
        ) as Error & { code: string; name: string };
        err.name = 'PrismaClientKnownRequestError';
        err.code = 'P2023';
        return Promise.reject(err);
      }
      return where.scimId === SCIM_UUID
        ? Promise.resolve({ userName: USERNAME_ID, payload: { displayName: 'Ada Lovelace' } })
        : Promise.resolve(null);
    }

    if (where.userName !== undefined) {
      return where.userName === USERNAME_ID
        ? Promise.resolve({ userName: USERNAME_ID, payload: { displayName: 'Ada Lovelace' } })
        : Promise.resolve(null);
    }

    return Promise.resolve(null);
  });

  return {
    requestLog: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          id: LOG_ROW_ID,
          method: 'GET',
          url: '/scim/endpoints/3f2504e0-4f89-11d3-9a0c-0305e82c3301/Users',
          status: 200,
          durationMs: 4,
          createdAt: new Date('2026-07-30T00:00:00.000Z'),
          errorMessage: null,
          requestId: null,
          endpointId: null,
          authOutcome: null,
          authMethod: null,
          authReason: null,
          authCredentialId: null,
        },
      ]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    scimResource: { findFirst: scimFindFirst },
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: LOG_ROW_ID, identifier }]),
  };
}

async function buildService(prisma: ReturnType<typeof buildPrisma>): Promise<LoggingService> {
  process.env.PERSISTENCE_BACKEND = 'prisma';
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

describe('LoggingService - user display-name resolution (Prisma)', () => {
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;

  afterEach(() => {
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
  });

  describe('identifier is a userName (non-uuid)', () => {
    let prisma: ReturnType<typeof buildPrisma>;
    let service: LoggingService;

    beforeEach(async () => {
      prisma = buildPrisma(USERNAME_ID);
      service = await buildService(prisma);
    });

    afterEach(async () => {
      await service.onModuleDestroy?.();
    });

    it('resolves to the display name via the userName fallback', async () => {
      const res = await service.listLogs({ includeAdmin: true });
      expect(res.items).toHaveLength(1);
      expect(res.items[0].reportableIdentifier).toBe('Ada Lovelace');
    });

    it('never queries the uuid column with a non-uuid value', async () => {
      await service.listLogs({ includeAdmin: true });

      const scimIdCalls = prisma.scimResource.findFirst.mock.calls.filter(
        ([arg]: [{ where: ScimWhere }]) => arg.where.scimId !== undefined,
      );
      expect(scimIdCalls).toHaveLength(0);
    });

    it('does query by userName', async () => {
      await service.listLogs({ includeAdmin: true });

      const userNameCalls = prisma.scimResource.findFirst.mock.calls.filter(
        ([arg]: [{ where: ScimWhere }]) => arg.where.userName === USERNAME_ID,
      );
      expect(userNameCalls).toHaveLength(1);
    });
  });

  describe('identifier is a uuid', () => {
    let prisma: ReturnType<typeof buildPrisma>;
    let service: LoggingService;

    beforeEach(async () => {
      prisma = buildPrisma(SCIM_UUID);
      service = await buildService(prisma);
    });

    afterEach(async () => {
      await service.onModuleDestroy?.();
    });

    it('still resolves through the scimId lookup', async () => {
      const res = await service.listLogs({ includeAdmin: true });
      expect(res.items[0].reportableIdentifier).toBe('Ada Lovelace');

      const scimIdCalls = prisma.scimResource.findFirst.mock.calls.filter(
        ([arg]: [{ where: ScimWhere }]) => arg.where.scimId === SCIM_UUID,
      );
      expect(scimIdCalls).toHaveLength(1);
    });

    it('does not need the userName fallback when the uuid resolves', async () => {
      await service.listLogs({ includeAdmin: true });

      const userNameCalls = prisma.scimResource.findFirst.mock.calls.filter(
        ([arg]: [{ where: ScimWhere }]) => arg.where.userName !== undefined,
      );
      expect(userNameCalls).toHaveLength(0);
    });
  });

  describe('unresolvable identifier', () => {
    it('leaves the raw identifier in place rather than throwing', async () => {
      const prisma = buildPrisma('nobody-here-1234567890');
      const service = await buildService(prisma);

      const res = await service.listLogs({ includeAdmin: true });
      expect(res.items[0].reportableIdentifier).toBe('nobody-here-1234567890');

      await service.onModuleDestroy?.();
    });
  });

  describe('negative control', () => {
    it('the mock really does raise P2023 for a non-uuid scimId', async () => {
      const prisma = buildPrisma(USERNAME_ID);
      await expect(
        prisma.scimResource.findFirst({ where: { scimId: USERNAME_ID, resourceType: 'User' } }),
      ).rejects.toMatchObject({ code: 'P2023' });
    });

    it('the mock resolves a valid uuid scimId', async () => {
      const prisma = buildPrisma(SCIM_UUID);
      await expect(
        prisma.scimResource.findFirst({ where: { scimId: SCIM_UUID, resourceType: 'User' } }),
      ).resolves.toMatchObject({ userName: USERNAME_ID });
    });
  });
});
