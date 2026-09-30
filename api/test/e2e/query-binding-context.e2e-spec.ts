import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost as rawPost, scimGet as rawGet, scimDelete } from './helpers/request.helper';
import type { TypedHttpTest } from './helpers/typed-http';

const CORE = 'urn:example:query-binding:Host';
const EXTENSION = 'urn:ietf:params:scim:schemas:core:2.0:User';
interface Body extends Record<string, unknown> {
  id: string;
  totalResults: number;
  Resources: Body[];
  [EXTENSION]: { externalId: number[] };
}
const post = (...args: Parameters<typeof rawPost>) => rawPost(...args) as unknown as TypedHttpTest<Body>;
const get = (...args: Parameters<typeof rawGet>) => rawGet(...args) as unknown as TypedHttpTest<Body>;

describe('query consumers honor explicit schema binding roles', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string | undefined;
  let base: string;
  let highId: string;
  let lowId: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    const endpoint = await post(app, '/scim/admin/endpoints', token, {
      name: `query-binding-${randomUUID()}`,
      profile: {
        schemas: [
          { id: CORE, name: 'Host', attributes: [{ name: 'label', type: 'string' }] },
          { id: EXTENSION, name: 'UserShapeExtension', attributes: [
            { name: 'userName', type: 'string' },
            { name: 'externalId', type: 'integer', multiValued: true },
          ] },
        ],
        resourceTypes: [{
          id: 'Host', name: 'Host', endpoint: '/Hosts', schema: CORE,
          schemaExtensions: [{ schema: EXTENSION, required: false }],
        }],
        settings: { StrictSchemaValidation: true, logFileEnabled: false },
        serviceProviderConfig: { filter: { supported: true, maxResults: 100 }, sort: { supported: true } },
      },
    }).expect(201);
    endpointId = endpoint.body.id;
    base = `/scim/v2/endpoints/${endpointId}/Hosts`;
    const high = await post(app, base, token, {
      schemas: [CORE, EXTENSION], label: 'high', externalId: 'Core-A',
      [EXTENSION]: { userName: 'extension-high', externalId: [7, 11] },
    }).expect(201);
    const low = await post(app, base, token, {
      schemas: [CORE, EXTENSION], label: 'low', externalId: 'Core-B',
      [EXTENSION]: { userName: 'extension-low', externalId: [2] },
    }).expect(201);
    highId = high.body.id;
    lowId = low.body.id;
    expect(high.body[EXTENSION].externalId).toEqual([7, 11]);
    expect(low.body[EXTENSION].externalId).toEqual([2]);
  });

  afterAll(async () => {
    if (endpointId) await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, token).expect(204);
    await app?.close();
  });

  it('filters the namespaced numeric value instead of the root common string', async () => {
    const response = await get(app, `${base}?filter=${encodeURIComponent(`${EXTENSION}:externalId eq 11`)}`, token).expect(200);
    expect(response.body.totalResults).toBe(1);
    expect(response.body.Resources.map(resource => resource.id)).toEqual([highId]);
    expect(response.body.Resources[0][EXTENSION].externalId).toEqual([7, 11]);
  });

  it('sorts and paginates by the extension value while root common identity remains exact', async () => {
    const sorted = await get(app, `${base}?sortBy=${encodeURIComponent(`${EXTENSION}:externalId`)}&sortOrder=ascending&count=1`, token).expect(200);
    expect(sorted.body.totalResults).toBe(2);
    expect(sorted.body.Resources.map(resource => resource.id)).toEqual([lowId]);
    const common = await get(app, `${base}?filter=${encodeURIComponent('externalId eq "core-a"')}`, token).expect(200);
    expect(common.body.totalResults).toBe(0);
  });
});
