import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPost, scimDelete, scimPatch } from './helpers/request.helper';
import { deletionCounts, deletionRepositories, seedDeletionRows, SEEDED_COUNTS, EMPTY_COUNTS, type DeletionFixture } from '../helpers/endpoint-deletion.fixture';
import { EndpointService } from '../../src/modules/endpoint/services/endpoint.service';
import { LoggingService } from '../../src/modules/logging/logging.service';
import { WifTrustCacheService } from '../../src/modules/scim/services/wif-trust-cache.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { InMemoryEndpointCredentialRepository } from '../../src/infrastructure/repositories/inmemory/inmemory-endpoint-credential.repository';
import type { Response } from 'supertest';
import { SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN } from '../../src/modules/scim/common/scim-constants';
import { createScimError } from '../../src/modules/scim/common/scim-errors';
import { RepositoryError } from '../../src/domain/errors/repository-error';
import { EndpointNotFoundError } from '../../src/domain/errors/endpoint-not-found.error';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaUserRepository } from '../../src/infrastructure/repositories/prisma/prisma-user.repository';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const DEVICE_SCHEMA = 'urn:example:params:scim:schemas:custom:2.0:Device';

function pauseCreate<Args extends unknown[], Result>(repository: { create(...args: Args): Promise<Result> }) {
  const create = repository.create.bind(repository);
  let resume!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  let entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  jest.spyOn(repository, 'create').mockImplementationOnce(async (...args: Args) => {
    entered();
    await paused;
    return create(...args);
  });
  return { reached, resume };
}

function expectDeletedEndpointError(response: Response, endpointId: string): void {
  expect(response.status).toBe(404);
  expect(response.headers['content-type']).toMatch(/^application\/scim\+json/);
  const body: unknown = response.body;
  expect(body).toMatchObject({
    schemas: [SCIM_ERROR_SCHEMA], status: '404', detail: 'Endpoint no longer exists',
    [SCIM_DIAGNOSTICS_URN]: { errorCode: 'ENDPOINT_NOT_FOUND', endpointId },
  });
  if (typeof body !== 'object' || body === null) throw new Error('Expected error object');
  expect(Object.keys(body).sort()).toEqual(['schemas', 'status', 'detail', SCIM_DIAGNOSTICS_URN].sort());
  const diagnostics: unknown = Reflect.get(body, SCIM_DIAGNOSTICS_URN);
  if (typeof diagnostics !== 'object' || diagnostics === null) throw new Error('Expected diagnostics');
  for (const key of Object.keys(diagnostics)) {
    expect(['errorCode', 'endpointId', 'requestId', 'logsUrl', 'operation']).toContain(key);
  }

  if ('operation' in diagnostics) expect(diagnostics.operation).toBe('create');
  expect(JSON.stringify(body)).not.toMatch(/Prisma|P20\d\d|foreign.key|constraint|ScimResource|EndpointCredential|stack|driverAdapter/i);
}

function expectSafeError(response: Response, status: number): void {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toMatch(/^application\/scim\+json/);
  const body: unknown = response.body;
  expect(body).toMatchObject({ schemas: [SCIM_ERROR_SCHEMA], status: String(status) });
  if (typeof body !== 'object' || body === null || !('detail' in body)) throw new Error('Expected error detail');
  expect(typeof body.detail).toBe('string');
  for (const key of Object.keys(body)) expect(['schemas', 'status', 'detail', 'scimType', SCIM_DIAGNOSTICS_URN]).toContain(key);
  expect(JSON.stringify(body)).not.toMatch(/Prisma|P20\d\d|foreign.key|constraint|ScimResource|EndpointCredential|stack|driverAdapter|private driver/i);
}

function resourceId(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('id' in body) || typeof body.id !== 'string') {
    throw new Error('Expected resource id');
  }
  return body.id;
}

describe('Endpoint deletion storage and HTTP contract', () => {
  let app: INestApplication;
  let token: string;
  let owned: DeletionFixture;
  let other: DeletionFixture;
  let name: string;
  const isPrisma = process.env.PERSISTENCE_BACKEND === 'prisma';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });
  beforeEach(async () => {
    name = `p8b-${randomUUID()}`;
    const created = await scimPost(app, '/scim/admin/endpoints', token, {
      name,
      profile: {
        schemas: [
          { id: USER_SCHEMA, name: 'User', attributes: 'all' },
          { id: GROUP_SCHEMA, name: 'Group', attributes: 'all' },
          { id: DEVICE_SCHEMA, name: 'Device', attributes: [{ name: 'displayName', type: 'string' }] },
        ],
        resourceTypes: [
          { id: 'User', name: 'User', endpoint: '/Users', schema: USER_SCHEMA, schemaExtensions: [] },
          { id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP_SCHEMA, schemaExtensions: [] },
          { id: 'Device', name: 'Device', endpoint: '/Devices', schema: DEVICE_SCHEMA, schemaExtensions: [] },
        ],
        settings: {
          SecretTokenBearerAuthEnabled: true,
          OAuthClientCredentialsAuthEnabled: true,
          WifCredentialsEnabled: true,
        },
        serviceProviderConfig: { patch: { supported: true }, etag: { supported: true } },
      },
    }).expect(201);
    const survivor = await scimPost(app, '/scim/admin/endpoints', token, { name: `${name}-other` }).expect(201);
    owned = await seedDeletionRows(app, resourceId(created.body));
    other = await seedDeletionRows(app, resourceId(survivor.body));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of [owned?.endpointId, other?.endpointId]) {
      if (id) await scimDelete(app, `/scim/admin/endpoints/${id}`, token);
    }
  });
  afterAll(async () => { await app?.close(); });

  it('the interrupted-create barrier preserves member and uniqueness arguments', async () => {
    const repository = { create: (...args: unknown[]) => Promise.resolve(args) };
    const input = { candidate: true };
    const members = [{ value: 'synthetic-member' }];
    const uniqueness = [{ path: 'synthetic-policy' }];
    const pause = pauseCreate(repository);
    const pending = repository.create(input, members, uniqueness);
    await pause.reached;
    pause.resume();
    expect(await pending).toEqual([input, members, uniqueness]);
  });

  it('deletes every owned row, invalidates derived state and retains old and late audit records', async () => {
    expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
    const cache = app.get(WifTrustCacheService);
    expect((await cache.get(owned.endpointId)).credentials.map(row => row.id)).toEqual([owned.wif.id]);
    expect((await cache.get(other.endpointId)).credentials.map(row => row.id)).toEqual([other.wif.id]);
    await scimGet(app, `/scim/endpoints/${owned.endpointId}/Schemas`, token).expect(200);
    const logs = app.get(LoggingService);
    const marker = `/p8b-audit/${randomUUID()}`;
    const audit = () => logs.recordRequest({
      method: 'POST', url: marker, status: 200, requestHeaders: {},
      endpointId: owned.endpointId, requestId: randomUUID(),
    });
    audit();
    await logs.flushPending();
    expect((await logs.listLogs({ endpointId: owned.endpointId, urlContains: marker })).total).toBe(1);
    const response = await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(204);
    expect(response.text).toBe('');
    expect(Object.keys(response.body as object)).toEqual([]);
    expect(await deletionCounts(app, owned)).toEqual(EMPTY_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
    expect((await cache.get(owned.endpointId)).credentials).toEqual([]);
    expect((await cache.get(other.endpointId)).credentials.map(row => row.id)).toEqual([other.wif.id]);
    expect(app.get(EndpointService).getCachedProfileSettings(owned.endpointId)).toBeUndefined();
    audit();
    await logs.flushPending();
    expect((await logs.listLogs({ endpointId: owned.endpointId, urlContains: marker })).total).toBe(2);
    for (const path of [
      `/scim/admin/endpoints/${owned.endpointId}`,
      `/scim/endpoints/${owned.endpointId}/Users`,
      `/scim/endpoints/${owned.endpointId}/Schemas`,
    ]) await scimGet(app, path, token).expect(404);
    await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(404);
  });

  it('keeps every row and the endpoint when deletion fails', async () => {
    const credentials = deletionRepositories(app).credentials;
    const prisma = app.get(PrismaService);
    const trigger = `p8b_${randomUUID().replaceAll('-', '')}`;
    let triggerInstalled = false;
    if (credentials instanceof InMemoryEndpointCredentialRepository) {
      const prepare = credentials.prepareEndpointDeletion.bind(credentials);
      jest.spyOn(credentials, 'prepareEndpointDeletion').mockImplementationOnce(id => {
        const step = prepare(id);
        return { ...step, commit: () => { step.commit(); throw new Error('P8b injected cascade failure'); } };
      });
    } else if (process.env.PG_ANALYSIS_RUN !== undefined) {
      // This fault injection must never install DDL on a shared database.
      expect(process.env.PG_ANALYSIS_RUN).toMatch(/^[a-f0-9]{16}$/);
      expect(process.env.DATABASE_URL).toContain(`/scim_fresh_${process.env.PG_ANALYSIS_RUN}`);
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD."endpointId" = '${owned.endpointId}'::uuid THEN
            RAISE EXCEPTION 'P8b injected cascade failure';
          END IF;
          RETURN OLD;
        END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE DELETE ON "EndpointCredential"
        FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
      triggerInstalled = true;
    } else {
      // Ordinary PostgreSQL E2E runs must not install fault-injection DDL.
      // They prove failure propagation; the guarded owned run additionally
      // proves the real FK cascade rollback at the database boundary.
      jest.spyOn(prisma.endpoint, 'delete').mockRejectedValueOnce(new Error('P8b injected delete failure'));
    }
    try {
      await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(500);
      expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
      expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
      await scimGet(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(200);
      expect((await app.get(WifTrustCacheService).get(owned.endpointId)).credentials.map(row => row.id)).toEqual([owned.wif.id]);
    } finally {
      if (triggerInstalled) {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "EndpointCredential"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
      }
    }
  });

  it.each(['User', 'Group', 'Device', 'bearer', 'oauth_client', 'wif'] as const)(
    'returns an exact safe 404 for an in-flight %s create after endpoint deletion',
    async kind => {
    const repositories = deletionRepositories(app);
    const pause = kind === 'User' ? pauseCreate(repositories.users)
      : kind === 'Group' ? pauseCreate(repositories.groups)
      : kind === 'Device' ? pauseCreate(repositories.resources)
      : pauseCreate(repositories.credentials);
    const credential = ['bearer', 'oauth_client', 'wif'].includes(kind);
    const path = credential ? `/scim/admin/endpoints/${owned.endpointId}/credentials`
      : `/scim/endpoints/${owned.endpointId}/${kind === 'Device' ? 'Devices' : `${kind}s`}`;
    const body = kind === 'User' ? { schemas: [USER_SCHEMA], userName: 'late-http-user' }
      : kind === 'Group' ? { schemas: [GROUP_SCHEMA], displayName: 'late-http-group', members: [{ value: owned.user.scimId }] }
      : kind === 'Device' ? { schemas: [DEVICE_SCHEMA], displayName: 'late-http-device' }
      : {
        credentialType: kind,
        label: 'late-http-credential',
        ...(kind === 'wif' ? { wif: {
          expectedIssuer: 'https://issuer.example.test',
          expectedSubject: 'late-subject',
          expectedAudience: 'late-audience',
          jwksUri: 'https://issuer.example.test/keys',
          allowedTenantId: 'late-test-tenant',
        } } : {}),
      };
    const pending = scimPost(app, path, token, body).then(response => response);
    try {
      await Promise.race([
        pause.reached,
        pending.then(response => { throw new Error(`Create returned ${response.status} before persistence pause`); }),
      ]);
      await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(204);
    } finally {
      pause.resume();
    }
    expectDeletedEndpointError(await pending, owned.endpointId);
    expect(await deletionCounts(app, owned)).toEqual(EMPTY_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
  });

  it.each(['User', 'Group', 'Device'] as const)('preserves a stale If-Match 412 for %s', async kind => {
    const resource = kind === 'User' ? owned.user : kind === 'Group' ? owned.child : owned.custom;
    const response = await scimPatch(app, `/scim/endpoints/${owned.endpointId}/${kind}s/${resource.scimId}`, token, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: kind === 'User' ? 'active' : 'displayName', value: kind === 'User' ? false : 'changed' }],
    }).set('If-Match', 'W/"999999"');
    expectSafeError(response, 412);
    expect(response.body).not.toMatchObject({ [SCIM_DIAGNOSTICS_URN]: { errorCode: 'ENDPOINT_NOT_FOUND' } });
    expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
  });

  it('preserves a typed member-reference validation error instead of calling it a missing endpoint', async () => {
    const { groups } = deletionRepositories(app);
    jest.spyOn(groups, 'create').mockRejectedValueOnce(createScimError({
      status: 400, scimType: 'invalidValue', detail: 'Invalid member reference',
      diagnostics: { errorCode: 'INVALID_MEMBER_REFERENCE' },
    }));
    const response = await scimPost(app, `/scim/endpoints/${owned.endpointId}/Groups`, token, {
      schemas: [GROUP_SCHEMA], displayName: 'invalid-reference',
    });
    expectSafeError(response, 400);
    expect(response.body).toMatchObject({
      detail: 'Invalid member reference', scimType: 'invalidValue',
      [SCIM_DIAGNOSTICS_URN]: { errorCode: 'INVALID_MEMBER_REFERENCE' },
    });
    expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
  });

  it.each(['User', 'bearer'] as const)('keeps an unrelated %s create failure at 500 without exposing driver detail', async kind => {
    const { users, credentials } = deletionRepositories(app);
    const prisma = app.get(PrismaService);
    const trigger = `p8b_create_${randomUUID().replaceAll('-', '')}`;
    const table = kind === 'User' ? 'ScimResource' : 'EndpointCredential';
    let installed = false;
    if (isPrisma && process.env.PG_ANALYSIS_RUN !== undefined) {
      expect(process.env.PG_ANALYSIS_RUN).toMatch(/^[a-f0-9]{16}$/);
      expect(process.env.DATABASE_URL).toContain(`/scim_fresh_${process.env.PG_ANALYSIS_RUN}`);
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."endpointId" = '${owned.endpointId}'::uuid THEN
            RAISE EXCEPTION 'private driver connect statement failure';
          END IF;
          RETURN NEW;
        END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
      installed = true;
    } else if (isPrisma) {
      const delegate = kind === 'User' ? prisma.scimResource : prisma.endpointCredential;
      jest.spyOn(delegate, 'create').mockRejectedValueOnce(Object.assign(new Error('private driver connect statement failure'), { code: 'P2010' }));
    } else {
      const repository = kind === 'User' ? users : credentials;
      jest.spyOn(repository, 'create').mockRejectedValueOnce(new Error('private driver connect statement failure'));
    }
    try {
      const response = await scimPost(app, kind === 'User'
        ? `/scim/endpoints/${owned.endpointId}/Users`
        : `/scim/admin/endpoints/${owned.endpointId}/credentials`, token,
      kind === 'User' ? { schemas: [USER_SCHEMA], userName: 'fault-user' } : { credentialType: 'bearer' });
      expectSafeError(response, 500);
      expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
      expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
      await scimGet(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(200);
    } finally {
      if (installed) {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
      }
    }
  });

  it.each(['User', 'bearer'] as const)('does not turn a classified %s database outage into 404', async kind => {
    const { users, credentials } = deletionRepositories(app);
    const repository = kind === 'User' ? users : credentials;
    jest.spyOn(repository, 'create').mockRejectedValueOnce(new RepositoryError('CONNECTION', 'Database unavailable'));
    const response = await scimPost(app, kind === 'User'
      ? `/scim/endpoints/${owned.endpointId}/Users`
      : `/scim/admin/endpoints/${owned.endpointId}/credentials`, token,
    kind === 'User' ? { schemas: [USER_SCHEMA], userName: 'offline-user' } : { credentialType: 'bearer' });
    expectSafeError(response, kind === 'User' ? 503 : 500);
    expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
  });

  (isPrisma ? it : it.skip)('keeps the native User FK failure distinct when the endpoint still exists (PostgreSQL only)', async () => {
    const { groups } = deletionRepositories(app);
    const result = await groups.addMembers(owned.parent.id, [
      { userId: randomUUID(), value: randomUUID(), type: 'User', display: null },
    ], []).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(RepositoryError);
    expect(result).not.toBeInstanceOf(EndpointNotFoundError);
    await scimGet(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(200);
    expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
  });

  (isPrisma ? it : it.skip)('preserves sanitized 503 for real pool-acquisition timeouts on create and update (PostgreSQL only)', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000 });
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });
    const held = await pool.connect();
    pool.options.connectionTimeoutMillis = 30;
    const timedOut = new PrismaUserRepository(client as unknown as PrismaService);
    const { users } = deletionRepositories(app);
    try {
      jest.spyOn(users, 'create').mockImplementationOnce((...args: Parameters<typeof users.create>) => timedOut.create(...args));
      const create = await scimPost(app, `/scim/endpoints/${owned.endpointId}/Users`, token, {
        schemas: [USER_SCHEMA], userName: 'timeout-user',
      });
      expectSafeError(create, 503);
      expect(JSON.stringify(create.body)).not.toMatch(/timeout exceeded|trying to connect/i);
      jest.spyOn(users, 'update').mockImplementationOnce((...args: Parameters<typeof users.update>) => timedOut.update(...args));
      const update = await scimPatch(app, `/scim/endpoints/${owned.endpointId}/Users/${owned.user.scimId}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      });
      expectSafeError(update, 503);
      expect(JSON.stringify(update.body)).not.toMatch(/timeout exceeded|trying to connect/i);
      expect(await deletionCounts(app, owned)).toEqual(SEEDED_COUNTS);
      expect(await users.findByScimId(owned.endpointId, owned.user.scimId)).toMatchObject({ active: true });
      expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
    } finally {
      held.release();
      await client.$disconnect();
      await pool.end();
    }
  });

  it('can reuse the endpoint name without inheriting resources or credentials', async () => {
    await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(204);
    const created = await scimPost(app, '/scim/admin/endpoints', token, { name }).expect(201);
    const id = resourceId(created.body);
    try {
      expect(id).not.toBe(owned.endpointId);
      expect(await deletionCounts(app, { ...owned, endpointId: id })).toEqual(EMPTY_COUNTS);
      expect(await deletionCounts(app, owned)).toEqual(EMPTY_COUNTS);
    } finally {
      await scimDelete(app, `/scim/admin/endpoints/${id}`, token).expect(204);
    }
  });

  it('rejects all late repository inserts, member writes and cross-endpoint rotation', async () => {
    const { users, groups, resources, credentials } = deletionRepositories(app);
    await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(204);
    for (const write of [
      () => users.create(owned.userInput),
      () => groups.create(owned.groupInput),
      () => resources.create(owned.customInput),
      () => credentials.create(owned.credentialInput),
      () => groups.addMembers(owned.parent.id, [{ userId: null, value: 'late', type: null, display: null }], []),
      () => credentials.rotate(other.active.id, owned.credentialInput),
    ]) await expect(write()).rejects.toThrow();
    expect(await credentials.findById(other.active.id)).toMatchObject({ active: true });
    expect(await deletionCounts(app, owned)).toEqual(EMPTY_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
  });

  it('invalidates a warmed credential cache when a reader observes remote deletion', async () => {
    const reader = isPrisma ? await createTestApp() : app;
    try {
      const readerToken = reader === app ? token : await getAuthToken(reader);
      await scimGet(reader, `/scim/admin/endpoints/${owned.endpointId}`, readerToken).expect(200);
      const cache = reader.get(WifTrustCacheService);
      expect((await cache.get(owned.endpointId)).credentials.map(row => row.id)).toEqual([owned.wif.id]);
      await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(204);
      await scimGet(reader, `/scim/admin/endpoints/${owned.endpointId}`, readerToken).expect(404);
      expect((await cache.get(owned.endpointId)).credentials).toEqual([]);
    } finally {
      if (reader !== app) await reader.close();
    }
  });
});
