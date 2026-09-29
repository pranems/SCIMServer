import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPost, scimDelete } from './helpers/request.helper';
import { deletionCounts, deletionRepositories, seedDeletionRows, SEEDED_COUNTS, EMPTY_COUNTS, type DeletionFixture } from '../helpers/endpoint-deletion.fixture';
import { EndpointService } from '../../src/modules/endpoint/services/endpoint.service';
import { LoggingService } from '../../src/modules/logging/logging.service';
import { WifTrustCacheService } from '../../src/modules/scim/services/wif-trust-cache.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { InMemoryEndpointCredentialRepository } from '../../src/infrastructure/repositories/inmemory/inmemory-endpoint-credential.repository';

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
    const created = await scimPost(app, '/scim/admin/endpoints', token, { name, profilePreset: 'rfc-standard' }).expect(201);
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

  it('rejects a User HTTP write already past endpoint resolution when deletion wins', async () => {
    const { users } = deletionRepositories(app);
    const create = users.create.bind(users);
    let resume!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    jest.spyOn(users, 'create').mockImplementationOnce(async input => {
      entered();
      await paused;
      return create(input);
    });
    const pending = scimPost(app, `/scim/endpoints/${owned.endpointId}/Users`, token, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'late-http-user',
    }).then(response => response);
    await reached;
    await scimDelete(app, `/scim/admin/endpoints/${owned.endpointId}`, token).expect(204);
    resume();
    const response = await pending;
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(600);
    expect(await deletionCounts(app, owned)).toEqual(EMPTY_COUNTS);
    expect(await deletionCounts(app, other)).toEqual(SEEDED_COUNTS);
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
      () => groups.addMembers(owned.parent.id, [{ userId: null, value: 'late', type: null, display: null }]),
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
