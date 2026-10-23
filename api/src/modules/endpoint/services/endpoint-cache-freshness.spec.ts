import { Test, type TestingModule } from '@nestjs/testing';
import { spawnSync } from 'node:child_process';
import {
  endpointSnapshotFingerprint as databaseFingerprint,
  mockEndpointSnapshotQuery,
} from '../../../../test/helpers/endpoint-snapshot.mock';
import { EndpointService } from './endpoint.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import type { Endpoint } from '../../../generated/prisma/client';
import { ENDPOINT_LIFECYCLE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { PrismaEndpointLifecycleRepository } from '../../../infrastructure/repositories/prisma/prisma-endpoint-lifecycle.repository';
import { endpointProfileRevision } from '../../../domain/repositories/profile-revision';

describe('Persistent endpoint cache freshness', () => {
  let module: TestingModule;
  let service: EndpointService;
  const priorBackend = process.env.PERSISTENCE_BACKEND;
  const id = '76e3c596-22aa-4527-bd6d-234367d798e6';
  const endpoint = (): Endpoint => ({
    id,
    name: 'fresh-endpoint',
    displayName: 'Fresh endpoint',
    description: null,
    active: true,
    profile: {
      schemas: [],
      resourceTypes: [],
      settings: { StrictSchemaValidation: true, logFileEnabled: false },
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  let currentEndpoint: Endpoint | null;
  let databaseError: Error | undefined;
  const readCurrentEndpoint = async (): Promise<Endpoint | null> => {
    if (databaseError) throw databaseError;
    return currentEndpoint;
  };
  const prisma = {
    $queryRaw: jest.fn(),
    endpoint: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    scimResource: { count: jest.fn() },
    resourceMember: { count: jest.fn() },
    requestLog: { count: jest.fn() },
  };
  const listener = jest.fn();
  const logger = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    setEndpointLevel: jest.fn(), clearEndpointLevel: jest.fn(),
    enableEndpointFileLogging: jest.fn(), disableEndpointFileLogging: jest.fn(),
  };

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'prisma';
    jest.resetAllMocks();
    currentEndpoint = endpoint();
    databaseError = undefined;
    prisma.endpoint.findMany.mockResolvedValue([endpoint()]);
    prisma.endpoint.findUnique.mockImplementation(readCurrentEndpoint);
    prisma.endpoint.findFirst.mockResolvedValue(endpoint());
    prisma.$queryRaw.mockImplementation(mockEndpointSnapshotQuery(readCurrentEndpoint));
    prisma.scimResource.count.mockResolvedValue(0);
    prisma.resourceMember.count.mockResolvedValue(0);
    prisma.requestLog.count.mockResolvedValue(0);
    module = await Test.createTestingModule({
      providers: [
        EndpointService,
        { provide: ENDPOINT_LIFECYCLE_REPOSITORY, useClass: PrismaEndpointLifecycleRepository },
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile();
    service = module.get(EndpointService);
    service.setProfileChangeListener(listener);
    await service.onModuleInit();
    listener.mockClear();
  });

  afterEach(async () => {
    await module.close();
    if (priorBackend === undefined) delete process.env.PERSISTENCE_BACKEND;
    else process.env.PERSISTENCE_BACKEND = priorBackend;
  });

  it('refreshes a warmed profile even when two changes have the same timestamp', async () => {
    currentEndpoint = {
      ...endpoint(),
      profile: {
        schemas: [], resourceTypes: [],
        settings: { StrictSchemaValidation: false, logFileEnabled: false },
      },
    };

    const result = await service.getEndpoint(id);
    expect(result.profile?.settings?.StrictSchemaValidation).toBe(false);
    expect(listener).toHaveBeenCalledWith(id, expect.objectContaining({
      settings: expect.objectContaining({ StrictSchemaValidation: false }),
    }));
  });

  it('exposes the warmed display name without a database read', () => {
    const cachedIdentityReader = service as unknown as {
      getCachedEndpointDisplayName(endpointId: string): string | undefined;
    };

    expect(cachedIdentityReader.getCachedEndpointDisplayName(id)).toBe('Fresh endpoint');
    expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    expect(prisma.endpoint.findFirst).not.toHaveBeenCalled();
  });

  it('resolves warmed endpoint identity for an uppercase UUID route value', () => {
    expect(service.getCachedEndpointDisplayName(id.toUpperCase())).toBe('Fresh endpoint');
    expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    expect(prisma.endpoint.findFirst).not.toHaveBeenCalled();
  });

  it('does not serve a warmed endpoint after another writer deletes it', async () => {
    currentEndpoint = null;
    prisma.endpoint.findFirst.mockResolvedValue(null);
    await expect(service.getEndpoint(id)).rejects.toMatchObject({ status: 404 });
    expect(service.getCachedProfileSettings(id)).toBeUndefined();
    expect(listener).toHaveBeenCalledWith(id, null);
  });

  it('does not serve an old name after another writer renames the endpoint', async () => {
    prisma.endpoint.findFirst.mockResolvedValue(null);
    await expect(service.getEndpointByName('fresh-endpoint')).rejects.toMatchObject({ status: 404 });
    expect(prisma.endpoint.findFirst).toHaveBeenCalled();
  });

  it('reads current database results for a warmed endpoint list', async () => {
    prisma.endpoint.findMany.mockResolvedValue([]);
    const result = await service.listEndpoints();
    expect(result).toEqual({ totalResults: 0, endpoints: [] });
    expect(service.getCachedProfileSettings(id)).toBeUndefined();
  });

  it('propagates database failure instead of returning a cached authorization profile', async () => {
    const failure = new Error('Synthetic database outage');
    databaseError = failure;
    await expect(service.getEndpoint(id)).rejects.toBe(failure);
  });

  it('keeps an unchanged profile cache and avoids redundant hydration', async () => {
    await service.getEndpoint(id);
    await service.getEndpoint(id);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.endpoint.findUnique).not.toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.calls[0][2]).toBeNull();
    expect(prisma.$queryRaw.mock.calls[1][2]).toBe(databaseFingerprint(endpoint()));
    expect(listener).not.toHaveBeenCalled();
  });

  it('checks a persisted revision without hashing the whole database row on cache hits', async () => {
    await service.getEndpoint(id);
    await service.getEndpoint(id);
    const sql = prisma.$queryRaw.mock.calls[1][0].join('?');
    expect(sql).toContain('e."snapshotRevision"');
    expect(sql).not.toMatch(/sha256|convert_to/);
    expect(sql).toContain("- 'snapshotRevision'");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();
  });

  it('carries the verified database snapshot with the independent profile-content revision', async () => {
    const result = await service.getEndpointForRequest(id);
    expect(result.profileRevision).toEqual({
      endpointId: id,
      contentRevision: endpointProfileRevision(endpoint().profile),
      snapshotRevision: databaseFingerprint(endpoint()),
    });
    expect(Object.keys(result.endpoint)).not.toContain('snapshotRevision');
    expect(Object.isFrozen(result.profileRevision)).toBe(true);
  });

  it.each([
    { active: false },
    { displayName: 'Changed display' },
    { name: 'changed-name' },
    { description: 'Changed description' },
  ])('refreshes non-profile fields without relying on timestamps: %j', async changes => {
    await service.getEndpoint(id);
    currentEndpoint = { ...endpoint(), ...changes };
    expect(await service.getEndpoint(id)).toMatchObject(changes);
  });

  it('preserves Prisma UTC timestamp semantics for timezone-free PostgreSQL JSON', async () => {
    const result = await service.getEndpoint(id);
    expect(result.createdAt).toBe(endpoint().createdAt.toISOString());
    expect(result.updatedAt).toBe(endpoint().updatedAt.toISOString());
  });

  it('checks PostgreSQL timestamp hydration in a real non-UTC Node process', () => {
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [
      '--require', require.resolve('ts-node/register/transpile-only'),
      require.resolve('../../../../test/fixtures/endpoint-timezone-probe.cjs'),
    ], {
      env: { ...process.env, TZ: 'America/New_York', PERSISTENCE_BACKEND: 'prisma' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (result.error) {
      throw new Error(
        `Non-UTC timestamp probe failed after ${Date.now() - startedAt}ms `
        + `(status=${result.status}, signal=${result.signal}): ${result.error.message}\n`
        + `${result.stdout}\n${result.stderr}`,
        { cause: result.error },
      );
    }
    if (result.status !== 0) {
      throw new Error(`Non-UTC timestamp regression failed:\n${result.stdout}\n${result.stderr}`);
    }
    expect(result.stdout).toContain('"runner":"standalone-production-path"');
    expect(JSON.parse(result.stdout)).toEqual({
      runner: 'standalone-production-path',
      entrypoint: require.resolve('../../../../test/fixtures/endpoint-timezone-probe.cjs'),
      execArgv: ['--require', require.resolve('ts-node/register/transpile-only')],
      timezoneOffset: 300,
      snapshotReads: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }, 35_000);

  it('preserves an explicit timestamp offset without appending another timezone', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      fingerprint: 'offset-snapshot',
      endpoint: {
        ...endpoint(),
        createdAt: '2026-01-01T03:00:00.000+03:00',
        updatedAt: '2026-01-01T03:00:00.000+03:00',
      },
    }]);
    const result = await service.getEndpoint(id);
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects invalid timestamps before publishing a changed profile', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      fingerprint: 'invalid-time-snapshot',
      endpoint: {
        ...endpoint(),
        profile: { schemas: [], resourceTypes: [], settings: { StrictSchemaValidation: false } },
        createdAt: 'invalid',
        updatedAt: '2026-01-01T00:00:00.000',
      },
    }]);
    await expect(service.getEndpoint(id)).rejects.toThrow('Endpoint snapshot has invalid timestamps');
    expect(service.getCachedProfileSettings(id)?.StrictSchemaValidation).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns the captured statement snapshot without reverting a newer cached profile', async () => {
    await service.getEndpoint(id);
    let completeRead: (value: { fingerprint: string; endpoint: null }[]) => void = () => {
      throw new Error('Snapshot read has not started');
    };
    prisma.$queryRaw.mockImplementationOnce(() => new Promise(resolve => { completeRead = resolve; }));
    const olderRead = service.getEndpoint(id);
    currentEndpoint = {
      ...endpoint(),
      profile: { schemas: [], resourceTypes: [], settings: { StrictSchemaValidation: false } },
    };
    const newer = await service.getEndpoint(id);
    expect(newer.profile?.settings?.StrictSchemaValidation).toBe(false);
    completeRead([{ fingerprint: databaseFingerprint(endpoint()), endpoint: null }]);
    expect((await olderRead).profile?.settings?.StrictSchemaValidation).toBe(true);
    expect(service.getCachedProfileSettings(id)?.StrictSchemaValidation).toBe(false);
  });

  it('rejects an unexplained empty payload rather than serving an unvalidated cache entry', async () => {
    prisma.$queryRaw.mockResolvedValue([{ fingerprint: 'unexpected', endpoint: null }]);
    await expect(service.getEndpoint(id)).rejects.toThrow('Endpoint snapshot validation failed');
  });

  it('does not use cached existence to serve statistics for a deleted endpoint', async () => {
    currentEndpoint = null;
    prisma.endpoint.findFirst.mockResolvedValue(null);
    await expect(service.getEndpointStats(id)).rejects.toMatchObject({ status: 404 });
  });
});
