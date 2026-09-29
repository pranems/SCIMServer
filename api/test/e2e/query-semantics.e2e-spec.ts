import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimDelete,
  scimGet,
  scimPatch,
  scimPost,
  scimPut,
  scimBasePath,
} from './helpers/request.helper';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const CUSTOM = 'urn:example:query:Widget';
const EXT = 'urn:example:query:Extension';
const OTHER = 'urn:example:query:Other';
const SEARCH = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
interface JsonBody {
  id: string;
  totalResults: number;
  itemsPerPage: number;
  Resources: JsonBody[];
  detail: unknown;
  meta: { resourceType: string };
  entries: unknown[];
  [EXT]: { entries: unknown[] };
}
function jsonBody(response: { body: unknown }): JsonBody {
  expect(response.body).toEqual(expect.any(Object));
  return response.body as JsonBody;
}
const fixtures = [
  { route: 'Users', schema: USER, name: 'User' },
  { route: 'Groups', schema: GROUP, name: 'Group' },
  { route: 'QueryWidgets', schema: CUSTOM, name: 'QueryWidget' },
];

const attributes = [
  { name: 'displayName', type: 'string', caseExact: true },
  { name: 'rank', type: 'integer' },
  { name: 'when', type: 'dateTime' },
  { name: 'hidden', type: 'string', returned: 'never' },
  { name: 'requested', type: 'string', returned: 'request' },
  { name: 'secret', type: 'string', mutability: 'writeOnly' },
  { name: 'code', type: 'string', caseExact: false },
  {
    name: 'entries',
    type: 'complex',
    multiValued: true,
    subAttributes: [
      { name: 'value', type: 'integer' },
      { name: 'primary', type: 'boolean' },
      { name: 'code', type: 'string', caseExact: false },
      { name: 'secret', type: 'string', mutability: 'writeOnly' },
    ],
  },
];

describe('Schema-aware query semantics (P6b)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let base: string;
  let profileSchemas: { id: string; name: string; attributes: Record<string, unknown>[] }[];
  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    profileSchemas = [
      ...fixtures.map((f) => ({
        id: f.schema,
        name: f.name,
        attributes:
          f.name === 'User'
            ? [
                { name: 'userName', type: 'string', required: true },
                { name: 'active', type: 'boolean' },
                ...attributes,
              ]
            : f.name === 'Group'
              ? [
                  {
                    name: 'members',
                    type: 'complex',
                    multiValued: true,
                    subAttributes: [{ name: 'value', type: 'string' }],
                  },
                  ...attributes,
                ]
              : attributes,
      })),
      {
        id: EXT,
        name: 'QueryExtension',
        attributes: attributes.map((a) =>
          a.name === 'code'
            ? { ...a, caseExact: true }
            : a.name === 'entries'
              ? {
                  ...a,
                  subAttributes: a.subAttributes?.map((s) =>
                    s.name === 'code' ? { ...s, caseExact: true } : s,
                  ),
                }
              : a,
        ),
      },
      { id: OTHER, name: 'OtherQueryExtension', attributes },
    ];
    const response = await scimPost(app, '/scim/admin/endpoints', token, {
      name: `p6b-${randomUUID()}`,
      profile: {
        schemas: profileSchemas,
        resourceTypes: fixtures.map((f) => ({
          id: f.name,
          name: f.name,
          endpoint: `/${f.route}`,
          schema: f.schema,
          schemaExtensions: [
            { schema: EXT, required: false },
            { schema: OTHER, required: false },
          ],
        })),
        serviceProviderConfig: {
          filter: { supported: true, maxResults: 100 },
          sort: { supported: true },
          patch: { supported: true },
          etag: { supported: true },
        },
        settings: { StrictSchemaValidation: true, logFileEnabled: false },
      },
    }).expect(201);
    endpointId = jsonBody(response).id;
    base = scimBasePath(endpointId);
  });
  afterEach(async () => {
    await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, token).expect(204);
  });

  async function seed(f: (typeof fixtures)[number]) {
    const ids: string[] = [];
    for (const [index, rank] of [10, 2, undefined].entries()) {
      const values = {
        rank,
        displayName: ['AbC-0', 'abc-1', 'zzz'][index],
        when: ['2026-01-01T00:30:00+02:00', '2025-12-31T23:00:00Z', undefined][index],
        hidden: 'match',
        requested: 'on-demand',
        secret: 'must-not-leak',
        code: 'AbC',
        entries:
          index === 0
            ? [
                { value: 99, code: 'wrong' },
                { value: 10, primary: true, code: 'AbC', secret: 'private' },
              ]
            : index === 1
              ? [
                  { value: 2, code: 'AbC' },
                  { value: 99, code: 'wrong' },
                ]
              : [],
      };
      const response = await scimPost(app, `${base}/${f.route}`, token, {
        schemas: [f.schema, EXT, OTHER],
        ...(f.name === 'User' ? { userName: `p6b-${index}` } : {}),
        ...values,
        [EXT]: values,
        [OTHER]: values,
      }).expect(201);
      ids.push(jsonBody(response).id);
    }
    return ids;
  }

  async function query(route: string, method: string, params: Record<string, string | number>) {
    return method === 'GET'
      ? scimGet(
          app,
          `${base}/${route}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
          token,
        )
      : scimPost(app, `${base}/${route}/.search`, token, { schemas: [SEARCH], ...params });
  }

  describe.each(fixtures)('$route', (f) => {
    it.each(['GET', 'POST'])(
      '%s filters internal hidden/request fields before count, page and projection',
      async (method) => {
        const ids = await seed(f);
        for (const path of ['hidden', `${EXT}:hidden`, 'requested', `${EXT}:requested`]) {
          const response = await query(f.route, method, {
            filter: `${path} eq "${path.endsWith('hidden') ? 'match' : 'on-demand'}"`,
            sortBy: 'rank',
            count: 1,
            startIndex: 2,
            attributes: `id,rank,hidden,secret,requested,${EXT}`,
          });
          expect(response.status).toBe(200);
          expect(jsonBody(response).totalResults).toBe(3);
          expect(jsonBody(response).itemsPerPage).toBe(1);
          expect(jsonBody(response).Resources[0]).toMatchObject({
            id: ids[0],
            rank: 10,
            requested: 'on-demand',
          });
          expect(Object.keys(jsonBody(response)).sort()).toEqual([
            'Resources',
            'itemsPerPage',
            'schemas',
            'startIndex',
            'totalResults',
          ]);
          const text = JSON.stringify(response.body);
          expect(text).not.toMatch(/"hidden"|"secret"|"_[^"]*"/);
          for (const key of Object.keys(jsonBody(response).Resources[0])) {
            expect([
              'schemas',
              'id',
              'meta',
              'rank',
              'requested',
              'userName',
              'displayName',
              EXT,
            ]).toContain(key);
          }
        }
        const normal = await query(f.route, method, { count: 1 });
        expect(JSON.stringify(normal.body)).not.toContain('"requested"');
        const empty = await query(f.route, method, { filter: 'hidden eq "match"', count: 0 });
        expect(empty.body).toMatchObject({ totalResults: 3, itemsPerPage: 0, Resources: [] });
      },
    );

    it.each(['GET', 'POST'])(
      '%s respects parent namespaces and caseExact for every string operator',
      async (method) => {
        await seed(f);
        const expressions = [
          ['code eq "abc"', 3],
          [`${EXT}:code eq "abc"`, 0],
          [`${OTHER}:code eq "abc"`, 3],
          [`${EXT}:entries[primary eq true and value gt 2 and code eq "AbC"]`, 1],
          [`${EXT}:entries[code eq "abc"]`, 0],
          [`${OTHER}:entries[code eq "abc"]`, 2],
          [`${EXT.toUpperCase()}:ENTRIES[CODE eq "AbC"]`, 2],
          [`${f.schema}:entries[value ge 2]`, 2],
          ['entries.value eq 2', 1],
          ['entries[primary eq true and value ge 10]', 1],
          ['displayName eq "abc-0"', 0],
          ['displayName eq "abc-1"', 1],
          ['displayName ne "abc-1"', 2],
          ['displayName co "b"', 2],
          ['displayName sw "a"', 1],
          ['displayName ew "c-1"', 1],
          ['displayName gt "abc-1"', 1],
          ['displayName ge "abc-1"', 2],
          ['displayName lt "abc-1"', 1],
          ['displayName le "abc-1"', 2],
          ['not (displayName eq "abc-1")', 2],
        ] as const;
        for (const [filter, totalResults] of expressions) {
          const response = await query(f.route, method, { filter });
          expect({
            filter,
            status: response.status,
            totalResults: jsonBody(response).totalResults,
          }).toEqual({ filter, status: 200, totalResults });
        }
        if (f.name === 'User') {
          for (const filter of ['userName eq null', 'active eq null']) {
            const response = await query(f.route, method, { filter });
            expect(response.status).toBe(200);
            expect(jsonBody(response).totalResults).toBe(0);
          }
        }
      },
    );

    it('sorts colliding string fields with their own namespace caseExact', async () => {
      const ids: string[] = [];
      for (const code of ['Z', 'a']) {
        const created = await scimPost(app, `${base}/${f.route}`, token, {
          schemas: [f.schema, EXT, OTHER],
          ...(f.name === 'User' ? { userName: `string-${code}` } : {}),
          displayName: `string-${code}`,
          code,
          [EXT]: { code },
          [OTHER]: { code },
        }).expect(201);
        ids.push(jsonBody(created).id);
      }
      for (const sortBy of ['code', `${f.schema}:code`, `${OTHER}:code`]) {
        const response = await query(f.route, 'GET', { sortBy });
        expect(response.status).toBe(200);
        expect(jsonBody(response).Resources.map((r) => r.id)).toEqual([ids[1], ids[0]]);
      }
      const exact = await query(f.route, 'POST', { sortBy: `${EXT}:code` });
      expect(exact.status).toBe(200);
      expect(jsonBody(exact).Resources.map((r) => r.id)).toEqual(ids);
    });

    it('uses typed core and extension sorts, primary/first values and missing placement', async () => {
      const ids = await seed(f);
      for (const path of ['rank', `${EXT}:rank`, 'entries.value', `${EXT}:entries.value`]) {
        const asc = await query(f.route, 'GET', { sortBy: path });
        expect(asc.status).toBe(200);
        expect(jsonBody(asc).Resources.map((r) => r.id)).toEqual([ids[1], ids[0], ids[2]]);
        const desc = await query(f.route, 'POST', { sortBy: path, sortOrder: 'descending' });
        expect(jsonBody(desc).Resources.map((r) => r.id)).toEqual([ids[2], ids[0], ids[1]]);
      }
      for (const path of ['when', `${EXT}:when`]) {
        const response = await query(f.route, 'GET', { sortBy: path });
        expect(jsonBody(response).Resources.map((r) => r.id)).toEqual(ids);
      }
    });

    it('rejects invalid and writeOnly filters/sorts without leaking values', async () => {
      await seed(f);
      for (const filter of [
        'unknown eq 1',
        'rank eq',
        'secret pr',
        'entries[secret pr]',
        `${EXT}:entries[secret pr]`,
        `${EXT}:entries[missing eq true]`,
      ]) {
        const response = await query(f.route, 'GET', { filter });
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ status: '400', scimType: 'invalidFilter' });
        expect(typeof jsonBody(response).detail).toBe('string');
        expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
      }
      for (const sortBy of ['unknown', 'entries', 'secret', `${EXT}:entries.secret`]) {
        const response = await query(f.route, 'GET', { sortBy });
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ status: '400', scimType: 'invalidValue' });
      }
    });

    it('caps pages using the resolved profile, preserving totalResults and count-zero', async () => {
      await seed(f);
      await scimPatch(app, `/scim/admin/endpoints/${endpointId}`, token, {
        profile: { serviceProviderConfig: { filter: { supported: true, maxResults: 1 } } },
      }).expect(200);
      for (const method of ['GET', 'POST']) {
        const page = await query(f.route, method, { count: 50, sortBy: 'rank' });
        expect(page.body).toMatchObject({
          totalResults: 3,
          itemsPerPage: 1,
          startIndex: 1,
          Resources: [{ rank: 2 }],
        });
        const zero = await query(f.route, method, { count: 0 });
        expect(zero.body).toMatchObject({ totalResults: 3, itemsPerPage: 0, Resources: [] });
        const beyond = await query(f.route, method, { count: 1, startIndex: 5 });
        expect(beyond.body).toMatchObject({ totalResults: 3, itemsPerPage: 0, Resources: [] });
      }
    });

    it('suppresses promoted never fields after assembling authoritative columns', async () => {
      await seed(f);
      await scimPatch(app, `/scim/admin/endpoints/${endpointId}`, token, {
        profile: {
          schemas: profileSchemas.map((s) =>
            s.id === f.schema
              ? {
                  ...s,
                  attributes: s.attributes.map((a) =>
                    a.name === 'displayName' ? { ...a, returned: 'never' } : a,
                  ),
                }
              : s,
          ),
        },
      }).expect(200);
      const response = await query(f.route, 'GET', {
        filter: 'displayName eq "AbC-0"',
        attributes: 'id,displayName',
        sortBy: 'displayName',
      });
      expect(response.status).toBe(200);
      expect(jsonBody(response).totalResults).toBe(1);
      expect(jsonBody(response).Resources[0]).not.toHaveProperty('displayName');
      expect(jsonBody(response).Resources[0]).toHaveProperty('id');
    });

    it('suppresses hidden children without top-level hidden attributes on write, GET and search', async () => {
      await scimPatch(app, `/scim/admin/endpoints/${endpointId}`, token, {
        profile: {
          schemas: profileSchemas.map((s) =>
            s.id === f.schema || s.id === EXT
              ? {
                  ...s,
                  attributes: s.attributes.filter(
                    (a) => !['hidden', 'secret', 'requested'].includes(String(a.name)),
                  ),
                }
              : s,
          ),
        },
      }).expect(200);
      const response = await scimPost(app, `${base}/${f.route}`, token, {
        schemas: [f.schema, EXT],
        userName: f.name === 'User' ? 'child-test' : undefined,
        displayName: 'nested-only',
        entries: [{ value: 3, secret: 'nested-private' }],
        [EXT]: { entries: [{ value: 4, secret: 'nested-private' }] },
      }).expect(201);
      const location = `${base}/${f.route}/${jsonBody(response).id}`;
      const get = await scimGet(app, `${location}?attributes=entries,${EXT}`, token).expect(200);
      const search = await query(f.route, 'POST', { attributes: `entries,${EXT}` });
      for (const body of [jsonBody(response), jsonBody(get), jsonBody(search).Resources[0]]) {
        expect(body.entries).toEqual([{ value: 3 }]);
        expect(body[EXT].entries).toEqual([{ value: 4 }]);
        expect(JSON.stringify(body)).not.toContain('"secret"');
      }
    });
  });

  it.each(['PUT', 'PATCH', 'DELETE'])(
    'custom %s uses the same ETag profile as discovery and response',
    async (method) => {
      const f = fixtures[2];
      const ids = await seed(f);
      await scimPatch(app, `/scim/admin/endpoints/${endpointId}`, token, {
        profile: {
          settings: { RequireIfMatch: true },
          serviceProviderConfig: { etag: { supported: false } },
        },
      }).expect(200);
      const location = `${base}/${f.route}/${ids[0]}`;
      const get = await scimGet(app, location, token).expect(200);
      expect(get.headers.etag).toBeUndefined();
      expect(jsonBody(get).meta.resourceType).toBe(f.name);
      const action = () =>
        method === 'DELETE'
          ? scimDelete(app, location, token)
          : method === 'PUT'
            ? scimPut(app, location, token, { schemas: [CUSTOM], displayName: 'replaced' })
            : scimPatch(app, location, token, {
                schemas: [PATCH],
                Operations: [{ op: 'replace', path: 'displayName', value: 'patched' }],
              });
      const response = await action();
      expect(response.status).toBe(method === 'DELETE' ? 204 : 200);
      if (method !== 'DELETE') {
        const ignored = await action().set('If-Match', 'W/"v999"');
        expect(ignored.status).toBe(200);
        await scimPatch(app, `/scim/admin/endpoints/${endpointId}`, token, {
          profile: { serviceProviderConfig: { etag: { supported: true } } },
        }).expect(200);
        await action().expect(428);
        await action().set('If-Match', 'W/"v999"').expect(412);
        const current = await scimGet(app, location, token).expect(200);
        await action().set('If-Match', current.headers.etag).expect(200);
      }
    },
  );
});
