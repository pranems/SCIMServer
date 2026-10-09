const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const template = require('../../api/test/helpers/binding-uniqueness.json');
const { liveFetch } = require('../live-test-http.cjs');

async function main() {
  const base = process.env.SCIM_LIVE_BASE_URL;
  const token = process.env.SCIM_LIVE_TOKEN;
  assert.ok(base && token, 'Explicit live target and token are required.');
  const origin = new URL(base).origin;
  assert.equal(base.replace(/\/$/, ''), origin);
  const owned = new Set();
  const shared = template.schemas[0].id;
  const other = template.schemas[1].id;
  const patch = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
  let assertions = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const check = condition => { assert.ok(condition); assertions++; };
  const keys = (body, allowed) => { equal(Object.keys(body).filter(key => !allowed.includes(key)), []); };
  async function send(method, path, payload) {
    const response = await liveFetch(`${origin}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
    const body = response.status === 204 ? null : await response.json();
    if (method === 'POST' && path === '/scim/admin/endpoints' && response.status === 201) owned.add(body.id);
    return { status: response.status, body, etag: response.headers.get('etag') };
  }
  const before = await send('GET', '/scim/admin/endpoints');
  equal(before.status, 200);
  try {
    for (const strict of [true, false]) {
      const profile = { ...structuredClone(template), settings: { StrictSchemaValidation: strict } };
      const ep = await send('POST', '/scim/admin/endpoints', { name: `binding-live-${randomUUID()}`, profile });
      equal(ep.status, 201);
      const admin = `/scim/admin/endpoints/${ep.body.id}`;
      const root = `/scim/v2/endpoints/${ep.body.id}`;
      const body = { schemas: [shared], externalId: 'Client-Case', displayName: [3], id: [999], meta: 'ignored' };
      const created = await send('POST', `${root}/Shareds`, body);
      equal(created.status, 201);
      check(typeof created.body.id === 'string');
      equal(created.body.externalId, 'Client-Case');
      equal(created.body.displayName, [3]);
      equal(created.body.meta.resourceType, 'Shared');
      keys(created.body, ['schemas', 'id', 'meta', 'externalId', 'displayName']);
      const second = await send('POST', `${root}/Shareds`, { schemas: [shared], externalId: 'client-case', displayName: [4] });
      equal(second.status, 201);
      const duplicate = await send('POST', `${root}/Shareds`, { schemas: [shared], externalId: 'Client-Case' });
      equal(duplicate.status, 409);
      equal(duplicate.body.scimType, 'uniqueness');
      const replaced = await send('PUT', `${root}/Shareds/${created.body.id}`, body);
      equal(replaced.status, 200);
      equal(replaced.body.id, created.body.id);
      equal(replaced.body.meta.created, created.body.meta.created);
      const failedPatch = await send('PATCH', `${root}/Shareds/${created.body.id}`, {
        schemas: [patch], Operations: [{ op: 'replace', path: 'externalId', value: 'client-case' }],
      });
      equal(failedPatch.status, 409);
      equal(failedPatch.body.scimType, 'uniqueness');
      equal((await send('GET', `${root}/Shareds/${created.body.id}`)).body, replaced.body);
      const independent = { id: [7], externalId: [11], meta: 'extension-owned', displayName: [3] };
      const extBody = { schemas: [other, shared], label: 'other', [shared]: independent };
      const ext = await send('POST', `${root}/Others`, extBody);
      equal(ext.status, 201);
      equal(ext.body[shared], independent);
      keys(ext.body, ['schemas', 'id', 'meta', 'label', shared]);
      for (const [name, value] of Object.entries(independent)) {
        const rejected = await send('POST', `${root}/Others`, { schemas: [other, shared], [shared]: { [name]: value } });
        equal(rejected.status, 409);
        equal(rejected.body.scimType, 'uniqueness');
      }
      equal((await send('PUT', `${root}/Others/${ext.body.id}`, extBody)).status, 200);
      const rootQuery = await send('GET', `${root}/Shareds?filter=${encodeURIComponent('externalId eq "Client-Case"')}`);
      equal(rootQuery.status, 200);
      equal(rootQuery.body.Resources.map(row => row.id), [created.body.id]);
      const extQuery = await send('GET', `${root}/Others?filter=${encodeURIComponent(`${shared}:externalId eq 11`)}`);
      equal(extQuery.status, 200);
      equal(extQuery.body.Resources.map(row => row.id), [ext.body.id]);
      const snapshot = await send('GET', admin);
      equal(snapshot.body.profile.schemas[0].attributes, profile.schemas[0].attributes);
      for (const type of ['boolean', 'dateTime', 'binary', 'complex']) {
        const invalid = structuredClone(profile);
        invalid.schemas[1].attributes.push({ name: 'unsupported', type, uniqueness: 'server' });
        const rejected = await send('PATCH', admin, { profile: invalid });
        equal(rejected.status, 400);
        check(rejected.body.detail.includes('Unsupported uniqueness declaration'));
        keys(rejected.body, ['schemas', 'status', 'detail', 'urn:scimserver:api:messages:2.0:Diagnostics']);
        const after = await send('GET', admin);
        equal(after.body, snapshot.body);
        equal(after.etag, snapshot.etag);
      }
      const free = structuredClone(profile);
      free.schemas[0].attributes.find(attribute => attribute.name === 'externalId').uniqueness = 'none';
      const freeEp = await send('POST', '/scim/admin/endpoints', { name: `binding-free-${randomUUID()}`, profile: free });
      equal(freeEp.status, 201);
      for (const [route, schema] of [['Shareds', shared], ['Others', other]]) {
        const path = `/scim/v2/endpoints/${freeEp.body.id}/${route}`;
        const payload = { schemas: [schema], externalId: 'client-duplicate' };
        const a = await send('POST', path, payload);
        const b = await send('POST', path, payload);
        equal([a.status, b.status], [201, 201]);
        check(a.body.id !== b.body.id);
      }
    }
  } finally {
    const failures = [];
    for (const id of owned) {
      try {
        equal((await send('DELETE', `/scim/admin/endpoints/${id}`)).status, 204);
        equal((await send('GET', `/scim/admin/endpoints/${id}`)).status, 404);
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Owned binding fixture cleanup failed.');
  }
  equal((await send('GET', '/scim/admin/endpoints')).body, before.body);
  console.log(JSON.stringify({ assertions, modes: 2, endpointCollectionUnchanged: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
