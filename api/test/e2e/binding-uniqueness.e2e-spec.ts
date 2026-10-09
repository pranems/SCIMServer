import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getLegacyToken } from './helpers/auth.helper';
import { bindingUniquenessProfile, SHARED_UNIQUE_SCHEMA as SHARED, OTHER_UNIQUE_SCHEMA as OTHER } from '../helpers/binding-uniqueness.fixture';

interface Body extends Record<string, unknown> {
  id: string;
  Resources: Body[];
  profile: ReturnType<typeof bindingUniquenessProfile>;
}
type Response = Omit<request.Response, 'body'> & { body: Body };

describe('binding-qualified uniqueness at admission and resource HTTP boundaries', () => {
  let app: INestApplication;
  const endpoints: string[] = [];
  const http = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object): Promise<Response> =>
    request(app.getHttpServer() as Server)[method](path)
      .set('Authorization', `Bearer ${getLegacyToken()}`).set('Content-Type', 'application/scim+json').send(body);
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => {
    for (const id of endpoints) expect((await http('delete', `/scim/admin/endpoints/${id}`)).status).toBe(204);
    await app.close();
  });
  it.each([true, false])('uses core precedence and independent namespaced uniqueness, strict=%s', async strict => {
    const profile = bindingUniquenessProfile(strict);
    const ep = await http('post', '/scim/admin/endpoints', { name: `binding-unique-${randomUUID()}`, profile });
    if (ep.status === 201) endpoints.push(ep.body.id);
    expect(ep.status).toBe(201);
    const base = `/scim/v2/endpoints/${ep.body.id}`;
    const coreBody = { schemas: [SHARED], externalId: 'Client-AbC', displayName: [3],
      id: [999], meta: 'ignored' };
    const first = await http('post', `${base}/Shareds`, coreBody);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ externalId: 'Client-AbC', displayName: [3], meta: { resourceType: 'Shared' } });
    expect(typeof first.body.id).toBe('string');
    expect((await http('post', `${base}/Shareds`, { schemas: [SHARED], externalId: 'client-abc', displayName: [4] })).status).toBe(201);
    const duplicate = await http('post', `${base}/Shareds`, { schemas: [SHARED], externalId: 'Client-AbC', displayName: [5] });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.scimType).toBe('uniqueness');
    expect((await http('put', `${base}/Shareds/${first.body.id}`, coreBody)).status).toBe(200);
    const independent = { id: [7], externalId: [11], meta: 'extension-owned', displayName: [3] };
    const extBody = { schemas: [OTHER, SHARED], label: 'other', [SHARED]: independent };
    const ext = await http('post', `${base}/Others`, extBody);
    expect(ext.status).toBe(201);
    expect(ext.body[SHARED]).toEqual(independent);
    for (const [name, value] of Object.entries(independent)) {
      const rejected = await http('post', `${base}/Others`, { schemas: [OTHER, SHARED], [SHARED]: { [name]: value } });
      expect(rejected.status).toBe(409);
      expect(rejected.body.scimType).toBe('uniqueness');
    }
    expect((await http('put', `${base}/Others/${ext.body.id}`, extBody)).status).toBe(200);
    const rootQuery = await http('get', `${base}/Shareds?filter=${encodeURIComponent('externalId eq "Client-AbC"')}`);
    expect(rootQuery.status).toBe(200);
    expect(rootQuery.body.Resources.map(row => row.id)).toEqual([first.body.id]);
    const extensionQuery = await http('get', `${base}/Others?filter=${encodeURIComponent(`${SHARED}:externalId eq 11`)}`);
    expect(extensionQuery.status).toBe(200);
    expect(extensionQuery.body.Resources.map(row => row.id)).toEqual([ext.body.id]);
    expect((await http('get', `/scim/admin/endpoints/${ep.body.id}`)).body.profile.schemas[0].attributes)
      .toEqual(profile.schemas[0].attributes);
    for (const key of Object.keys(first.body)) expect(['schemas', 'id', 'meta', 'externalId', 'displayName']).toContain(key);
    for (const key of Object.keys(ext.body)) expect(['schemas', 'id', 'meta', 'label', SHARED]).toContain(key);
  });
  it.each(['boolean', 'dateTime', 'binary', 'complex'])('rejects unsupported %s uniqueness before endpoint publication', async type => {
    const name = `invalid-unique-${randomUUID()}`;
    const profile = bindingUniquenessProfile();
    profile.schemas[1].attributes.push({ name: 'unsupported', type, multiValued: false, required: false, uniqueness: 'server' });
    const response = await http('post', '/scim/admin/endpoints', { name, profile });
    if (response.status === 201) endpoints.push(response.body.id);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '400',
      detail: expect.stringContaining('ResourceType "Other": Unsupported uniqueness declaration') as unknown,
    });
    for (const key of Object.keys(response.body)) expect(['schemas', 'status', 'detail', 'urn:scimserver:api:messages:2.0:Diagnostics']).toContain(key);
    const published = await http('get', '/scim/admin/endpoints');
    expect(published.status).toBe(200);
    expect(published.body.endpoints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name })]),
    );
  });
  it('rejects an unsupported profile update without changing the published profile or token', async () => {
    const profile = bindingUniquenessProfile();
    const ep = await http('post', '/scim/admin/endpoints', { name: `update-unique-${randomUUID()}`, profile });
    expect(ep.status).toBe(201);
    endpoints.push(ep.body.id);
    const url = `/scim/admin/endpoints/${ep.body.id}`;
    const before = await http('get', url);
    profile.schemas[1].attributes.push({ name: 'unsupported', type: 'boolean', multiValued: false, required: false, uniqueness: 'server' });
    expect((await http('patch', url, { profile })).status).toBe(400);
    const after = await http('get', url);
    expect(after.body).toEqual(before.body);
    expect(after.headers.etag).toBe(before.headers.etag);
  });
  it('preserves default-none common externalId duplicates in both resource types', async () => {
    const profile = bindingUniquenessProfile();
    profile.schemas[0].attributes.find(attribute => attribute.name === 'externalId')!.uniqueness = 'none';
    const ep = await http('post', '/scim/admin/endpoints', { name: `free-unique-${randomUUID()}`, profile });
    expect(ep.status).toBe(201);
    endpoints.push(ep.body.id);
    for (const [route, schema] of [['Shareds', SHARED], ['Others', OTHER]]) {
      const path = `/scim/v2/endpoints/${ep.body.id}/${route}`;
      const payload = { schemas: [schema], externalId: 'client-owned-duplicate' };
      const first = await http('post', path, payload);
      const second = await http('post', path, payload);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.id).not.toBe(second.body.id);
      const list = await http('get', `${path}?filter=${encodeURIComponent('externalId eq "client-owned-duplicate"')}`);
      expect(list.body.Resources.map(row => row.id).sort()).toEqual([first.body.id, second.body.id].sort());
    }
  });
  it('admits omitted optional extension lists but rejects explicit malformed lists without publication', async () => {
    const profile = bindingUniquenessProfile();
    Reflect.deleteProperty(profile.resourceTypes[0], 'schemaExtensions');
    const ep = await http('post', '/scim/admin/endpoints', { name: `omitted-bindings-${randomUUID()}`, profile });
    expect(ep.status).toBe(201);
    endpoints.push(ep.body.id);
    expect(ep.body.profile.resourceTypes[0].schemaExtensions).toEqual([]);
    const base = `/scim/v2/endpoints/${ep.body.id}`;
    const discovered = await http('get', `${base}/ResourceTypes`);
    expect(discovered.status).toBe(200);
    expect(discovered.body.Resources.find(resourceType => resourceType.id === 'Shared'))
      .toMatchObject({ schema: SHARED, schemaExtensions: [] });
    const discoveredOne = await http('get', `${base}/ResourceTypes/Shared`);
    expect(discoveredOne.status).toBe(200);
    expect(discoveredOne.body).toMatchObject({ id: 'Shared', schema: SHARED, schemaExtensions: [] });
    const created = await http('post', `${base}/Shareds`, {
      schemas: [SHARED], externalId: 'omitted-extension-crud', displayName: [1],
    });
    expect(created.status).toBe(201);
    const item = `${base}/Shareds/${created.body.id}`;
    expect((await http('get', item)).body).toMatchObject({
      id: created.body.id, externalId: 'omitted-extension-crud', displayName: [1],
    });
    expect((await http('put', item, {
      schemas: [SHARED], externalId: 'omitted-extension-put', displayName: [2],
    })).body).toMatchObject({ id: created.body.id, externalId: 'omitted-extension-put', displayName: [2] });
    expect((await http('patch', item, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'externalId', value: 'omitted-extension-patch' }],
    })).body).toMatchObject({ id: created.body.id, externalId: 'omitted-extension-patch', displayName: [2] });
    expect((await http('delete', item)).status).toBe(204);
    expect((await http('get', item)).status).toBe(404);
    const before = await http('get', `/scim/admin/endpoints/${ep.body.id}`);
    for (const schemaExtensions of [null, {}, 'invalid']) {
      Reflect.set(profile.resourceTypes[0], 'schemaExtensions', schemaExtensions);
      const rejected = await http('patch', `/scim/admin/endpoints/${ep.body.id}`, { profile });
      expect(rejected.status).toBe(400);
      expect(String(rejected.body.detail)).toContain('schemaExtensions: must be an array');
      const after = await http('get', `/scim/admin/endpoints/${ep.body.id}`);
      expect(after.body).toEqual(before.body);
      expect(after.headers.etag).toBe(before.headers.etag);
    }
  });
});
