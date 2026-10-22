const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = process.env.SCIM_BENCH_BASE_URL;
const token = process.env.SCIM_BENCH_TOKEN;
const expectedVersion = process.env.SCIM_BENCH_VERSION;
const output = process.env.SCIM_BENCH_OUTPUT;
assert.ok(base && token && expectedVersion && output, 'Explicit target, token, version and output required');
const deadline = Number(process.env.SCIM_BENCH_DEADLINE_UTC);
assert.ok(Number.isSafeInteger(deadline) && deadline > 0, 'Explicit work deadline required');
const runId = randomUUID();
const userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User';
const groupSchema = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const patchSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const samples = { add: [], populatedRead: [], remove: [], emptyRead: [] };
let requestCount = 0;
let cleaningUp = false;

async function request(method, pathname, body) {
  const remaining = cleaningUp ? 30000 : deadline - Date.now();
  if (remaining <= 0) {
    const error = new Error('Work deadline reached');
    error.code = 'SCIM_WORK_DEADLINE';
    throw error;
  }
  requestCount++;
  const start = performance.now();
  const response = await fetch(new URL(pathname, base), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/scim+json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Math.min(30000, remaining)),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname}: HTTP ${response.status}`);
  return { body: text ? JSON.parse(text) : undefined, ms: performance.now() - start };
}

function describeFailure(error, stage) {
  const kinds = { AssertionError: 'ASSERTION', TimeoutError: 'TIMEOUT', AbortError: 'ABORT', SyntaxError: 'INVALID_JSON' };
  return { stage, kind: error.code === 'SCIM_WORK_DEADLINE' ? 'DEADLINE' : kinds[error.name] ?? 'CLIENT_ERROR' };
}

async function main() {
  let endpointId;
  let stage = 'version';
  const failures = [];
  const cleanup = { attempted: false, verified: false };
  try {
    assert.equal((await request('GET', '/scim/admin/version')).body.version, expectedVersion);
    stage = 'fixture';
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
      stage = 'add';
      const add = await request('PATCH', `${scoped}/Groups/${group.id}`, {
        schemas: [patchSchema],
        Operations: [{ op: 'add', path: 'members', value: [{ value: user.id }] }],
      });
      if (index >= 100) samples.add.push(add.ms);
      stage = 'populatedRead';
      const populated = await request('GET', `${scoped}/Groups/${group.id}`);
      if (index >= 100) samples.populatedRead.push(populated.ms);
      assert.deepEqual(populated.body.members.map(member => member.value), [user.id]);
      stage = 'remove';
      const remove = await request('PATCH', `${scoped}/Groups/${group.id}`, {
        schemas: [patchSchema],
        Operations: [{ op: 'remove', path: `members[value eq "${user.id}"]` }],
      });
      if (index >= 100) samples.remove.push(remove.ms);
      stage = 'emptyRead';
      const empty = await request('GET', `${scoped}/Groups/${group.id}`);
      if (index >= 100) samples.emptyRead.push(empty.ms);
      assert.equal((empty.body.members ?? []).length, 0);
    }
    stage = 'finalVersion';
    assert.equal((await request('GET', '/scim/admin/version')).body.version, expectedVersion);
  } catch (error) {
    failures.push(describeFailure(error, stage));
  } finally {
    cleaningUp = true;
    if (endpointId) {
      cleanup.attempted = true;
      try {
        await request('DELETE', `/scim/admin/endpoints/${endpointId}`);
        const inventory = (await request('GET', '/scim/admin/endpoints')).body;
        assert.ok(Array.isArray(inventory.endpoints));
        assert.ok(!inventory.endpoints.some(endpoint => endpoint.id === endpointId), 'Exact fixture cleanup');
        cleanup.verified = true;
      } catch (error) {
        failures.push(describeFailure(error, 'cleanup'));
      }
    }
    if (!failures.length) {
      try {
        assert.equal(requestCount, 4407);
        assert.ok(Object.values(samples).every(values => values.length === 1000));
      } catch (error) {
        failures.push(describeFailure(error, 'completion'));
      }
    }
    const complete = failures.length === 0;
    fs.writeFileSync(output, `${JSON.stringify({
      runId, version: expectedVersion, nodeVersion: process.version,
      measuredAt: new Date().toISOString(), warmupIterations: 100, requestCount, samples,
      status: complete ? 'PASS' : 'FAIL', complete, failures, cleanup,
    }, null, 2)}\n`);
    if (!complete) {
      console.error(`Benchmark failure: ${failures.map(failure => `${failure.stage}/${failure.kind}`).join(', ')}`);
      process.exitCode = 1;
    }
  }
}

main().catch(() => {
  console.error('Benchmark receipt could not be persisted; no admission.');
  process.exitCode = 1;
});
