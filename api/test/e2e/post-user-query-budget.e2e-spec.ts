import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint, scimBasePath, scimDelete, scimGet, scimPost } from './helpers/request.helper';
import { validUser } from './helpers/fixtures';

const postgres = process.env.PERSISTENCE_BACKEND?.toLowerCase() === 'inmemory' ? describe.skip : describe;

postgres('POST User PostgreSQL client-query budget', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string | undefined;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    const inventory = await scimGet(app, '/scim/admin/endpoints', token).expect(200);
    const body: unknown = inventory.body;
    if (!body || typeof body !== 'object' || !('endpoints' in body) || !('totalResults' in body) || !Array.isArray(body.endpoints)) {
      throw new Error('Incomplete original endpoint inventory.');
    }
    const original = body.endpoints.map((endpoint: unknown) => {
      if (!endpoint || typeof endpoint !== 'object' || !('id' in endpoint) || typeof endpoint.id !== 'string') {
        throw new Error('Invalid original endpoint identity.');
      }
      return endpoint.id;
    });
    expect(body.totalResults).toBe(original.length);
    expect(new Set(original).size).toBe(original.length);
    const candidate = await createEndpoint(app, token);
    expect(original).not.toContain(candidate);
    endpointId = candidate;
  });

  afterAll(async () => {
    try {
      if (endpointId) {
        await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, token).expect(204);
        await scimGet(app, `/scim/admin/endpoints/${endpointId}`, token).expect(404);
      }
    } finally {
      await app?.close();
    }
  });

  it('creates the complete resource with at most four client queries and a separate post-lock snapshot', async () => {
    if (!endpointId) throw new Error('An owned endpoint is required.');
    const spy = jest.spyOn(pg.Client.prototype, 'query');
    let queries: string[];
    try {
      const response = await scimPost(app, `${scimBasePath(endpointId)}/Users`, token, validUser({
        userName: 'query-budget-user@example.test',
        displayName: 'Query budget user',
        active: true,
      })).expect(201);
      const body: unknown = response.body;
      if (!body || typeof body !== 'object' || !('id' in body) || !('schemas' in body)) {
        throw new Error('Incomplete created User response.');
      }
      expect(body).toMatchObject({
        userName: 'query-budget-user@example.test',
        displayName: 'Query budget user',
        active: true,
        meta: { resourceType: 'User' },
      });
      expect(body.id).toEqual(expect.any(String));
      expect(body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      const allowed = ['schemas', 'id', 'externalId', 'userName', 'name', 'displayName', 'active', 'emails', 'meta'];
      for (const key of Object.keys(body)) expect(allowed).toContain(key);
      const calls: unknown[][] = spy.mock.calls;
      queries = calls.map(([query]): string => {
        if (typeof query === 'string') return query;
        if (query && typeof query === 'object' && 'text' in query && typeof query.text === 'string') return query.text;
        throw new Error('Unexpected PostgreSQL client-query representation.');
      }).filter(query => !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(query.trim()));
    } finally {
      spy.mockRestore();
    }
    expect(queries.length).toBeLessThanOrEqual(4);
    expect(queries.some(query => /SET TRANSACTION/i.test(query))).toBe(false);
    const lock = queries.findIndex(query => query.includes('WITH profile_lock AS MATERIALIZED'));
    const snapshot = queries.findIndex(query => query.includes('AS "snapshotRevision"'));
    const insert = queries.findIndex(query => query.includes('INSERT INTO "public"."ScimResource"'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(snapshot);
    expect(queries[insert]).toContain('RETURNING');
    expect(queries[insert]).toContain('"public"."ScimResource"."payload"');
  });
});
