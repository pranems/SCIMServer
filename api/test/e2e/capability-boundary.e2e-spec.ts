import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPatch, scimPost, scimBasePath } from './helpers/request.helper';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const WIDGET = 'urn:example:schemas:core:2.0:CapabilityWidget';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const BULK = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest';
const SEARCH = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest';
const DIAGNOSTICS = 'urn:scimserver:api:messages:2.0:Diagnostics';

function resourceId(response: Response): string {
  const body: unknown = response.body;
  if (typeof body !== 'object' || body === null || !('id' in body) || typeof body.id !== 'string') {
    throw new Error('Expected a resource response with a string id.');
  }
  return body.id;
}

describe('Capabilities at the shared application boundary', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let base: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const response = await scimPost(app, '/scim/admin/endpoints', token, {
      name: `capability-boundary-${randomUUID()}`,
      profile: {
        schemas: [
          { id: USER, name: 'User', attributes: [{ name: 'userName' }, { name: 'active' }] },
          { id: GROUP, name: 'Group', attributes: [{ name: 'displayName' }, { name: 'members' }] },
          {
            id: WIDGET,
            name: 'CapabilityWidget',
            attributes: [{ name: 'displayName', type: 'string' }],
          },
        ],
        resourceTypes: [
          { id: 'User', name: 'User', endpoint: '/Users', schema: USER, schemaExtensions: [] },
          { id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP, schemaExtensions: [] },
          {
            id: 'CapabilityWidget',
            name: 'CapabilityWidget',
            endpoint: '/CapabilityWidgets',
            schema: WIDGET,
            schemaExtensions: [],
          },
        ],
        serviceProviderConfig: {
          patch: { supported: true },
          bulk: { supported: true, maxOperations: 100, maxPayloadSize: 1048576 },
          filter: { supported: true, maxResults: 100 },
          sort: { supported: true },
          etag: { supported: true },
        },
        settings: { StrictSchemaValidation: true, logFileEnabled: false },
      },
    }).expect(201);
    endpointId = resourceId(response);
    base = scimBasePath(endpointId);
  });

  async function setCapabilities(capabilities: Record<string, unknown>): Promise<void> {
    await scimPatch(app, `/scim/admin/endpoints/${endpointId}`, token, {
      profile: { serviceProviderConfig: capabilities },
    }).expect(200);
  }

  it.each([
    { collection: 'Users', schema: USER, body: { userName: 'capability-user' }, path: 'userName' },
    {
      collection: 'Groups',
      schema: GROUP,
      body: { displayName: 'capability-group' },
      path: 'displayName',
    },
  ])(
    'blocks disabled $collection PATCH through Bulk without changing stored state',
    async (fixture) => {
      const created = await scimPost(app, `${base}/${fixture.collection}`, token, {
        schemas: [fixture.schema],
        ...fixture.body,
      }).expect(201);
      const id = resourceId(created);
      const location = `${base}/${fixture.collection}/${id}`;
      const before = await scimGet(app, location, token).expect(200);
      const data = {
        schemas: [PATCH],
        Operations: [{ op: 'replace', path: fixture.path, value: 'forbidden-change' }],
      };
      await setCapabilities({ patch: { supported: false } });
      await scimPatch(app, location, token, data).expect(501);
      const response = await scimPost(app, `${base}/Bulk`, token, {
        schemas: [BULK],
        Operations: [{ method: 'PATCH', path: `/${fixture.collection}/${id}`, data }],
      }).expect(200);

      expect(response.body).toEqual({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'],
        Operations: [
          {
            method: 'PATCH',
            status: '501',
            response: {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
              status: '501',
              scimType: 'notImplemented',
              detail:
                'PATCH is not supported by this endpoint (serviceProviderConfig.patch.supported = false).',
            },
          },
        ],
      });
      const after = await scimGet(app, location, token).expect(200);
      expect(after.body).toEqual(before.body);
      expect(after.headers.etag).toBe(before.headers.etag);
    },
  );

  it('blocks disabled custom PATCH before persistence and allows it again after enablement', async () => {
    const created = await scimPost(app, `${base}/CapabilityWidgets`, token, {
      schemas: [WIDGET],
      displayName: 'before',
    }).expect(201);
    const location = `${base}/CapabilityWidgets/${resourceId(created)}`;
    const before = await scimGet(app, location, token).expect(200);
    const patch = {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'displayName', value: 'after' }],
    };
    await setCapabilities({ patch: { supported: false } });
    const rejected = await scimPatch(app, location, token, patch).expect(501);
    expect(rejected.body).toMatchObject({ [DIAGNOSTICS]: { triggeredBy: 'patch.supported' } });
    const unchanged = await scimGet(app, location, token).expect(200);
    expect(unchanged.body).toEqual(before.body);
    expect(unchanged.headers.etag).toBe(before.headers.etag);
    await setCapabilities({ patch: { supported: true } });
    await scimPatch(app, location, token, patch).expect(200);
    const updated = await scimGet(app, location, token).expect(200);
    expect(updated.body).toMatchObject({ displayName: 'after' });
  });

  it.each(['GET', 'POST'])('honors disabled custom filtering on %s queries', async (method) => {
    await scimPost(app, `${base}/CapabilityWidgets`, token, {
      schemas: [WIDGET],
      displayName: 'widget',
    }).expect(201);
    await setCapabilities({ filter: { supported: false } });
    const response =
      method === 'GET'
        ? await scimGet(
            app,
            `${base}/CapabilityWidgets?filter=${encodeURIComponent('displayName eq "widget"')}`,
            token,
          )
        : await scimPost(app, `${base}/CapabilityWidgets/.search`, token, {
            schemas: [SEARCH],
            filter: 'displayName eq "widget"',
          });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ [DIAGNOSTICS]: { triggeredBy: 'filter.supported' } });
    const unfiltered = await scimGet(app, `${base}/CapabilityWidgets`, token).expect(200);
    expect(unfiltered.body).toMatchObject({
      totalResults: 1,
      Resources: [{ displayName: 'widget' }],
    });
  });

  it.each(['GET', 'POST'])('honors disabled custom sorting on %s queries', async (method) => {
    await setCapabilities({ sort: { supported: false } });
    const response =
      method === 'GET'
        ? await scimGet(app, `${base}/CapabilityWidgets?sortBy=displayName`, token)
        : await scimPost(app, `${base}/CapabilityWidgets/.search`, token, {
            schemas: [SEARCH],
            sortBy: 'displayName',
          });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ [DIAGNOSTICS]: { triggeredBy: 'sort.supported' } });
  });

  it('keeps internal Me subject lookup available when client filtering is disabled', async () => {
    const created = await scimPost(app, `${base}/Users`, token, {
      schemas: [USER],
      userName: 'e2e-client',
      active: true,
    }).expect(201);
    const id = resourceId(created);
    await setCapabilities({ filter: { supported: false } });
    await scimGet(
      app,
      `${base}/Users?filter=${encodeURIComponent('userName eq "e2e-client"')}`,
      token,
    ).expect(403);
    const me = await scimGet(app, `${base}/Me`, token).expect(200);
    expect(me.body).toMatchObject({ id, userName: 'e2e-client', active: true });
    await scimPatch(app, `${base}/Me`, token, {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    }).expect(200);
    const after = await scimGet(app, `${base}/Users/${id}`, token).expect(200);
    expect(after.body).toMatchObject({ id, userName: 'e2e-client', active: false });
  });
});
