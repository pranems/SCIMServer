const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { test } = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

const source = path.resolve(__dirname, '../performance/membership-history.cjs');
function implementation() {
  assert.ok(fs.existsSync(source), 'Diagnostic history implementation must exist');
  return require(source);
}

test('seeded history schedule retains all 16 visits and 64000 measurements', () => {
  const { schedule } = implementation();
  const blocks = schedule(20261023);
  assert.deepEqual(blocks.map(b => [b.history, b.order]), [
    ['fresh', 'BAAB'], ['reused', 'BAAB'],
    ['fresh', 'ABBA'], ['reused', 'ABBA'],
  ]);
  assert.deepEqual(schedule(20261023), blocks);
  assert.equal(blocks.flatMap(b => b.visits).length, 16);
  assert.equal(blocks.flatMap(b => b.visits).length * 1000 * 4, 64000);
  for (const block of blocks) assert.equal(block.visits.join(''), block.order);
});

test('fresh restarts every scheduled visit; reused retains two role processes', async () => {
  const { runVisits, schedule } = implementation();
  for (const history of ['fresh', 'reused']) {
    const block = schedule(20261023).find(b => b.history === history);
    let sequence = 0;
    const apps = { A: { epoch: 'A0' }, B: { epoch: 'B0' } };
    const rows = [];
    await runVisits(block, apps, {
      checkDeadline() {},
      async restart(role) { return { epoch: `${role}${++sequence}` }; },
      async visit(app, role, visit) { rows.push({ epoch: app.epoch, role, visit }); },
    });
    assert.equal(sequence, history === 'fresh' ? 4 : 0);
    assert.deepEqual(rows.map(r => r.visit), [1, 2, 3, 4]);
    assert.equal(new Set(rows.map(r => r.epoch)).size, history === 'fresh' ? 4 : 2);
  }
});

test('deadline or first failure stops without replacement', async () => {
  const { runVisits, schedule } = implementation();
  let visits = 0;
  await assert.rejects(runVisits(schedule(20261023)[0], {}, {
    checkDeadline() { if (visits === 1) throw Error('wall cap'); },
    async restart() { return {}; },
    async visit() { visits++; },
  }), /wall cap/);
  assert.equal(visits, 1);
  visits = 0;
  await assert.rejects(runVisits(schedule(20261023)[0], {}, {
    checkDeadline() {},
    async restart() { return {}; },
    async visit() { visits++; throw Error('first failure'); },
  }), /first failure/);
  assert.equal(visits, 1);
});

function snapshot(overrides = {}) {
  return {
    epoch: 'container:pid:start', readStartUtc: '2026-10-23T00:00:00.000Z',
    readEndUtc: '2026-10-23T00:00:00.001Z', readStartNs: '1', readEndNs: '2',
    cpu: { usage_usec: 10, nr_periods: 2, nr_throttled: 1, throttled_usec: 3 },
    rssBytes: 1024, highWaterRssBytes: 2048, memoryPeakBytes: 4096,
    oom: 0, oomKill: 0, cpuMax: '50000 100000', cpuBurst: 0,
    ancestors: [{ path: '/', cpuMax: null, cpuBurst: null, root: true }],
    ...overrides,
  };
}

test('counter windows reject reset, epoch crossing, missingness and RSS/OOM breaches', () => {
  const { windowDelta } = implementation();
  const a = snapshot();
  const b = snapshot({ readStartNs: '3', readEndNs: '4',
    cpu: { ...a.cpu, usage_usec: 20 } });
  assert.equal(windowDelta(a, b).cpu.usage_usec, 10);
  for (const bad of [
    { epoch: 'new-process' }, { cpu: { usage_usec: 20 } },
    { cpu: { ...a.cpu, usage_usec: 0 } }, { rssBytes: null },
    { highWaterRssBytes: 384 * 1024 * 1024 + 1 }, { oomKill: 1 },
    { cpuBurst: 1 }, { cpuMax: '10000 100000' },
    { ancestors: [{ path: '/limited', cpuMax: '50000 100000', cpuBurst: 0 }] },
  ]) assert.throws(() => windowDelta(a, { ...b, ...bad }));
});

test('strict raw counter parsing never coerces empty or malformed signals to zero', () => {
  const { requiredUnsigned, windowDelta } = implementation();
  assert.equal(requiredUnsigned('0'), 0);
  assert.equal(requiredUnsigned('42'), 42);
  for (const value of ['', ' ', '-1', 'NaN', '1.5', undefined, '9007199254740992'])
    assert.throws(() => requiredUnsigned(value));
  assert.throws(() => windowDelta(snapshot({ readStartNs: '' }),
    snapshot({ readStartNs: '3', readEndNs: '4' })));
  assert.throws(() => windowDelta(snapshot({ ancestors: [
    { path: 'docker', cpuMax: 'max 100000', cpuBurst: 0 },
  ] }), snapshot({ readStartNs: '3', readEndNs: '4' })));
});

test('source identity preflight accepts committed descendants and rejects unknown ancestry', async () => {
  const { sourceTip } = implementation();
  const root = path.resolve(__dirname, '../..');
  assert.match(await sourceTip(root), /^[a-f0-9]{40}$/);
  await assert.rejects(sourceTip(root, '0'.repeat(40)));
});

test('finalization attempts capture and cleanup for every owned resource', async () => {
  const { finalizeOwned } = implementation();
  const attempted = [];
  const result = await finalizeOwned(['app', 'pg', 'observer'], {
    async capture(id) { attempted.push(`capture:${id}`); throw Error('capture'); },
    async remove(id) { attempted.push(`remove:${id}`); if (id === 'app') throw Error('remove'); },
    async verify(id) { attempted.push(`verify:${id}`); return id !== 'app'; },
  });
  assert.equal(result.verified, false);
  for (const id of ['app', 'pg', 'observer']) {
    assert.ok(attempted.includes(`capture:${id}`));
    assert.ok(attempted.includes(`remove:${id}`));
    assert.ok(attempted.includes(`verify:${id}`));
  }
});

test('real benchmark child refuses history mode without its IPC owner', async () => {
  implementation();
  const child = fork(path.resolve(__dirname, '../performance/benchmark-membership.cjs'), [], {
    silent: true,
    env: { ...process.env, SCIM_BENCH_HISTORY: '1', SCIM_BENCH_TRACE: '1',
      SCIM_BENCH_HISTORY_OWNER: '', SCIM_BENCH_BASE_URL: 'http://127.0.0.1:1',
      SCIM_BENCH_TOKEN: 'test-only', SCIM_BENCH_VERSION: '0.55.60',
      SCIM_BENCH_OUTPUT: path.resolve(__dirname, '../../test-results/never-written-history-guard.json'),
      SCIM_BENCH_DEADLINE_UTC: String(Date.now() + 5000) },
    timeout: 5000,
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(stderr, /History diagnostics require the explicit IPC owner/);
});

test('admission rejects diagnostic receipt and unchanged runner cannot dispatch history', () => {
  const { assessBlock } = require('../performance/assess-membership.cjs');
  assert.throws(() => assessBlock(Array(4).fill({ diagnosticOnly: true }),
    { order: 'BAAB', sameImage: true }, {}));
  const runner = fs.readFileSync(path.resolve(__dirname,
    '../performance/run-membership-qualification.ps1'), 'utf8');
  assert.doesNotMatch(runner, /run-membership-history|membership-history\.cjs/);
});

for (const mode of ['history', 'capture-failure', 'default']) {
  const brokenBoundary = mode === 'capture-failure';
  test(`real workload preserves accounting and cleanup: ${mode}`, async () => {
    const { validateReceipt } = implementation();
    const directory = path.resolve(__dirname, '../../test-results', `history-test-${randomUUID()}`);
    fs.mkdirSync(directory);
    const output = path.join(directory, 'receipt.json');
    let members = [];
    let deleted = false;
    let requests = 0;
    const server = http.createServer((request, response) => {
      let body = '';
      request.on('data', data => { body += data; });
      request.on('end', () => {
        requests++;
        let result;
        if (request.url.endsWith('/version')) result = { version: '0.55.60' };
        else if (request.method === 'DELETE') { deleted = true; }
        else if (request.url === '/scim/admin/endpoints')
          result = request.method === 'POST' ? { id: 'endpoint' } : { endpoints: deleted ? [] : [{ id: 'endpoint' }] };
        else if (request.method === 'POST')
          result = { id: request.url.endsWith('/Users') ? 'user' : 'group' };
        else if (request.method === 'PATCH') {
          members = JSON.parse(body).Operations[0].op === 'add' ? [{ value: 'user' }] : [];
          result = { id: 'group', members };
        } else result = { id: 'group', members };
        response.writeHead(result ? 200 : 204, { 'Content-Type': 'application/scim+json' });
        response.end(result ? JSON.stringify(result) : undefined);
      });
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const boundaries = [];
      const child = fork(path.resolve(__dirname, '../performance/benchmark-membership.cjs'), [], {
        silent: true, timeout: 20000,
        env: { ...process.env, SCIM_BENCH_BASE_URL: `http://127.0.0.1:${server.address().port}`,
          SCIM_BENCH_TOKEN: 'test-only', SCIM_BENCH_VERSION: '0.55.60',
          SCIM_BENCH_OUTPUT: output, SCIM_BENCH_DEADLINE_UTC: String(Date.now() + 15000),
          SCIM_BENCH_TRACE: mode === 'default' ? undefined : '1',
          SCIM_BENCH_HISTORY: mode === 'default' ? undefined : '1',
          SCIM_BENCH_HISTORY_OWNER: mode === 'default' ? undefined : 'membership-history-diagnostic' },
      });
      if (mode === 'default') child.disconnect();
      child.stdout.resume();
      child.stderr.resume();
      child.on('message', message => {
        boundaries.push(message.boundary);
        child.send({ boundary: message.boundary, ok: !brokenBoundary });
      });
      const [code] = await once(child, 'exit');
      const row = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.equal(deleted, true, 'Real child attempts exact fixture cleanup after failed capture');
      assert.equal(row.cleanup.verified, true);
      if (brokenBoundary) {
        assert.equal(code, 1);
        assert.equal(row.complete, false);
        assert.deepEqual(boundaries, ['warmup-before']);
        assert.equal(requests, 6);
      } else {
        assert.equal(code, 0);
        assert.equal(requests, 4407);
        if (mode === 'default') {
          assert.deepEqual(boundaries, []);
          assert.equal(row.spans, undefined);
          assert.equal(row.diagnosticOnly, undefined);
          assert.equal(row.complete, true);
          assert.ok(Object.values(row.samples).every(values => values.length === 1000));
        } else {
          validateReceipt(row);
          assert.deepEqual(boundaries, ['warmup-before', 'warmup-after', 'measured-before', 'measured-after']);
          assert.throws(() => validateReceipt({ ...row, requestCount: 4406 }));
          assert.throws(() => validateReceipt({ ...row, samples: { ...row.samples, add: row.samples.add.slice(1) } }));
        }
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(directory, { recursive: true });
    }
  });
}

test('privacy validator requires same-record error correlation and exact redaction', () => {
  const { validatePrivacy } = implementation();
  const requestId = '12345678-1234-1234-1234-123456789abc';
  const rows = Array.from({ length: 200 }, () => ({
    requestId, endpointId: requestId, durationMs: 1, status: 400,
    requestHeaders: JSON.stringify({ authorization: '[REDACTED]' }),
  }));
  const consoleLog = JSON.stringify({ timestamp: 'now', category: 'scim.patch', requestId });
  assert.equal(validatePrivacy(rows, consoleLog, ['secret-marker']).validatedRows, 200);
  assert.throws(() => validatePrivacy(rows.slice(1), consoleLog, []));
  assert.throws(() => validatePrivacy(rows, '{}', []));
  assert.throws(() => validatePrivacy(rows, `${consoleLog}secret-marker`, ['secret-marker']));
  assert.throws(() => validatePrivacy([{ ...rows[0], requestHeaders: '{}' }, ...rows.slice(1)], consoleLog, []));
});
