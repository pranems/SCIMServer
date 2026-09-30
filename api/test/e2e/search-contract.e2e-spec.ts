import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimBasePath, scimDelete, scimGet, scimPost } from './helpers/request.helper';
import { validGroup, validUser } from './helpers/fixtures';
import { SCIM_DIAGNOSTICS_URN, SCIM_ERROR_SCHEMA } from '../../src/modules/scim/common/scim-constants';

const SENSOR_SCHEMA = 'urn:example:params:scim:schemas:custom:2.0:SearchSensor';
const SEARCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest';

interface Resource extends Record<string, unknown> {
  id: string;
  schemas: string[];
}
interface ListResponse {
  Resources: Resource[];
  schemas: string[];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
}
interface ErrorResponse {
  schemas: string[];
  status: string;
  detail: unknown;
}

describe('Search projection wire contract', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;
  const resources: Record<string, Resource> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    const endpoint = await scimPost(app, '/scim/admin/endpoints', token, {
      name: `search-contract-${Date.now()}`,
      profile: {
        schemas: [
          { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
          { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
          {
            id: SENSOR_SCHEMA, name: 'SearchSensor', attributes: [
              { name: 'displayName', type: 'string' },
              { name: 'location', type: 'string' },
            ],
          },
        ],
        resourceTypes: [
          { id: 'User', name: 'User', endpoint: '/Users', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] },
          { id: 'Group', name: 'Group', endpoint: '/Groups', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [] },
          { id: 'SearchSensor', name: 'SearchSensor', endpoint: '/SearchSensors', schema: SENSOR_SCHEMA, schemaExtensions: [] },
        ],
      },
    }).expect(201);
    endpointId = (endpoint.body as Resource).id;
    basePath = scimBasePath(endpointId);
    resources.Users = (await scimPost(app, `${basePath}/Users`, token, validUser({
      userName: 'search-contract@example.test', displayName: 'Search contract',
      name: { givenName: 'Search', familyName: 'Contract' },
    })).expect(201)).body as Resource;
    resources.Groups = (await scimPost(app, `${basePath}/Groups`, token, validGroup({
      displayName: 'Search contract', members: [{ value: resources.Users.id }],
    })).expect(201)).body as Resource;
    resources.SearchSensors = (await scimPost(app, `${basePath}/SearchSensors`, token, {
      schemas: [SENSOR_SCHEMA], displayName: 'Search contract', location: 'Room A',
    }).expect(201)).body as Resource;
  });

  afterAll(async () => {
    if (endpointId) await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, token);
    await app?.close();
  });

  describe.each(['Users', 'Groups', 'SearchSensors'])('%s', (family) => {
    const extra = family === 'Users' ? 'name' : family === 'Groups' ? 'members' : 'location';

    function assertList(body: ListResponse) {
      expect(Object.keys(body).sort()).toEqual(['Resources', 'itemsPerPage', 'schemas', 'startIndex', 'totalResults'].sort());
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
      expect(body.totalResults).toBe(1);
      expect(body.itemsPerPage).toBe(1);
      expect(body.startIndex).toBe(1);
      expect(body.Resources).toHaveLength(1);
      expect(body.Resources[0].id).toBe(resources[family].id);
      expect(body.Resources[0].schemas).toEqual(resources[family].schemas);
      return body.Resources[0];
    }

    it.each(['array', 'legacy string', 'GET query'])('includes only requested fields using %s', async (form) => {
      const path = `${basePath}/${family}`;
      const res = form === 'GET query'
        ? await scimGet(app, `${path}?attributes=displayName`, token).expect(200)
        : await scimPost(app, `${path}/.search`, token, {
          schemas: [SEARCH_SCHEMA], attributes: form === 'array' ? ['displayName'] : 'displayName',
        }).expect(200);
      const resource = assertList(res.body as ListResponse);
      expect(resource.displayName).toBe('Search contract');
      expect(Object.keys(resource).sort()).toEqual([
        'id', 'schemas', 'meta', 'displayName', ...(family === 'Users' ? ['userName'] : []),
      ].sort());
    });

    it.each(['array', 'legacy string', 'GET query'])('excludes populated fields using %s', async (form) => {
      expect(resources[family][extra]).toBeDefined();
      const path = `${basePath}/${family}`;
      const selected = `${extra},displayName`;
      const res = form === 'GET query'
        ? await scimGet(app, `${path}?excludedAttributes=${selected}`, token).expect(200)
        : await scimPost(app, `${path}/.search`, token, {
          excludedAttributes: form === 'array' ? [extra, 'displayName'] : selected,
        }).expect(200);
      const resource = assertList(res.body as ListResponse);
      expect(resource).not.toHaveProperty(extra);
      if (family === 'Groups') expect(resource.displayName).toBe('Search contract');
      else expect(resource).not.toHaveProperty('displayName');
      const full = (await scimGet(app, `${path}/${resources[family].id}`, token).expect(200)).body as Resource;
      delete full[extra];
      if (family !== 'Groups') delete full.displayName;
      expect(resource).toEqual(full);
    });

    it('treats empty arrays as no selection and retains always-returned fields', async () => {
      const path = `${basePath}/${family}`;
      const normal = (await scimGet(app, path, token).expect(200)).body as ListResponse;
      const empty = await scimPost(app, `${path}/.search`, token, { attributes: [], excludedAttributes: [] }).expect(200);
      expect(empty.body).toEqual(normal);
      const res = await scimPost(app, `${path}/.search`, token, { excludedAttributes: ['id', 'schemas'] }).expect(200);
      assertList(res.body as ListResponse);
    });

    it.each(['attributes', 'excludedAttributes'])('rejects malformed %s with a client error', async (field) => {
      for (const value of [
        null, 12, { name: 'id' }, ['id', 12], [null], [['id']], [''], ['  '],
        ['id,displayName'], Array<string>(101).fill('id'), ['a'.repeat(2001)],
        ['a'.repeat(1000), 'b'.repeat(1000)], 'a'.repeat(2001),
      ]) {
        const res = await scimPost(app, `${basePath}/${family}/.search`, token, { [field]: value });
        expect(res.status).toBe(400);
        const body = res.body as ErrorResponse;
        expect(body.schemas).toContain(SCIM_ERROR_SCHEMA);
        expect(body.status).toBe('400');
        expect(typeof body.detail).toBe('string');
        expect(body.detail).toContain(field);
        expect(body.detail).toContain('max 2000 characters');
      }
    });

    it('reports genuine multiple DTO errors as scalar detail', async () => {
      const res = await scimPost(app, `${basePath}/${family}/.search`, token, {
        count: -1, startIndex: 0, sortOrder: 'sideways',
      });
      expect(res.status).toBe(400);
      const body = res.body as ErrorResponse;
      expect(body.schemas).toContain(SCIM_ERROR_SCHEMA);
      expect(body.status).toBe('400');
      expect(typeof body.detail).toBe('string');
      expect(body.detail).toContain('count');
      expect(body.detail).toContain('startIndex');
      expect(body.detail).toContain('sortOrder');
      for (const key of Object.keys(body)) {
        expect(['schemas', 'status', 'detail', 'scimType', SCIM_DIAGNOSTICS_URN]).toContain(key);
      }
    });
  });

  it('preserves nested User projection and attributes precedence', async () => {
    const res = await scimPost(app, `${basePath}/Users/.search`, token, {
      attributes: ['name.givenName'], excludedAttributes: ['name'],
    }).expect(200);
    const body = res.body as ListResponse;
    expect(body.Resources[0].name).toEqual({ givenName: 'Search' });
    expect(Object.keys(body.Resources[0]).sort()).toEqual(['id', 'schemas', 'meta', 'userName', 'name'].sort());
  });
});
