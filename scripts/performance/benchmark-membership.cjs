const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = process.env.SCIM_BENCH_BASE_URL;
const token = process.env.SCIM_BENCH_TOKEN;
const expectedVersion = process.env.SCIM_BENCH_VERSION;
const output = process.env.SCIM_BENCH_OUTPUT;
assert.ok(base && token && expectedVersion && output, 'Explicit target, token, version and output required');
const runId = randomUUID();
const userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User';
const groupSchema = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const patchSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const samples = { add: [], populatedRead: [], remove: [], emptyRead: [] };
let requestCount = 0;

async function request(method, pathname, body) {
  requestCount++;
  const start = performance.now();
  const response = await fetch(new URL(pathname, base), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/scim+json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname}: HTTP ${response.status}`);
  return { body: text ? JSON.parse(text) : undefined, ms: performance.now() - start };
}

async function main() {
  assert.equal((await request('GET', '/scim/admin/version')).body.version, expectedVersion);
  let endpointId;
  try {
    const endpoint = (await request('POST', '/scim/admin/endpoints', {
      name: `owned-membership-perf-${runId}`,
      displayName: `Owned membership performance ${runId}`,
      description: `Exact-cleanup performance fixture ${runId}`,
      profilePreset: 'rfc-standard',
    })).body;
    endpointId = endpoint.id;
    assert.ok(endpointId);
    const scoped = `/scim/endpoints/${endpointId}`;
    const user = (await request('POST', `${scoped}/Users`, {
      schemas: [userSchema],
      userName: `owned-${runId}@example.test`,
    })).body;
    const group = (await request('POST', `${scoped}/Groups`, {
      schemas: [groupSchema],
      displayName: `owned-${runId}`,
    })).body;
    for (let index = 0; index < 1100; index++) {
      const add = await request('PATCH', `${scoped}/Groups/${group.id}`, {
        schemas: [patchSchema],
        Operations: [{ op: 'add', path: 'members', value: [{ value: user.id }] }],
      });
      const populated = await request('GET', `${scoped}/Groups/${group.id}`);
      assert.deepEqual(populated.body.members.map(member => member.value), [user.id]);
      const remove = await request('PATCH', `${scoped}/Groups/${group.id}`, {
        schemas: [patchSchema],
        Operations: [{ op: 'remove', path: `members[value eq "${user.id}"]` }],
      });
      const empty = await request('GET', `${scoped}/Groups/${group.id}`);
      assert.equal((empty.body.members ?? []).length, 0);
      if (index >= 100) {
        samples.add.push(add.ms);
        samples.populatedRead.push(populated.ms);
        samples.remove.push(remove.ms);
        samples.emptyRead.push(empty.ms);
      }
    }
    assert.equal((await request('GET', '/scim/admin/version')).body.version, expectedVersion);
  } finally {
    if (endpointId) {
      await request('DELETE', `/scim/admin/endpoints/${endpointId}`);
      const inventory = (await request('GET', '/scim/admin/endpoints')).body;
      assert.ok(Array.isArray(inventory.endpoints));
      assert.ok(!inventory.endpoints.some(endpoint => endpoint.id === endpointId), 'Exact fixture cleanup');
    }
  }
  assert.equal(requestCount, 4407);
  fs.writeFileSync(output, `${JSON.stringify({
    runId, version: expectedVersion, nodeVersion: process.version,
    measuredAt: new Date().toISOString(), warmupIterations: 100, requestCount, samples,
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
