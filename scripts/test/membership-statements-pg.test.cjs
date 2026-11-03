const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const fixture = require('../performance/membership-statement-fixture.cjs');
const { statementDelta } = require('../performance/membership-statements.cjs');
const exec = promisify(execFile);
const image = require('../performance/membership-protocol.json').postgres;

test('owned cached PG17 verifies real SQL fingerprints, role scope, deltas and private canaries', {
  skip: process.env.SCIM_RUN_OWNED_PG_PROBE !== '1',
  timeout: 180000,
}, async () => {
  const start = Date.now();
  const root = path.resolve(__dirname, '../..');
  const run = randomUUID().replaceAll('-', '');
  const owner = 'membership-statement-sql-probe';
  const password = randomBytes(32).toString('hex');
  const passwords = Object.fromEntries(['a', 'b', 'observer'].map(key => [key, randomBytes(32).toString('hex')]));
  let admin;
  let statistics;
  let application;
  async function docker(args, cleanup = false) {
    assert.ok(cleanup || Date.now() - start < 120000, 'PG probe work cap');
    try {
      return (await exec('docker', ['--context', 'desktop-linux', ...args], {
        cwd: root, env: { ...process.env, POSTGRES_PASSWORD: password },
        timeout: cleanup ? 15000 : 30000, maxBuffer: 131072, windowsHide: true,
      })).stdout.trim();
    } catch (error) { throw new Error(`Owned PG probe ${args[0]} failed (${error.code}); output withheld`); }
  }
  try {
    const id = await docker(['run', '-d', '--name', `scim-sql-probe-${run.slice(0, 12)}`,
      '--label', `scimserver.owner=${owner}`, '--label', `scimserver.run=${run}`,
      '--publish', '127.0.0.1::5432', '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data',
      '--env', 'POSTGRES_USER=scim', '--env', 'POSTGRES_PASSWORD', image,
      '-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'compute_query_id=on',
      '-c', 'pg_stat_statements.track=all']);
    assert.match(id, /^[a-f0-9]{64}$/);
    const portText = await docker(['port', id, '5432/tcp']);
    assert.match(portText, /^127\.0\.0\.1:\d+$/);
    const port = Number(portText.split(':')[1]);
    for (let index = 0; index < 20; index++) {
      admin = fixture.client({ port, user: 'scim', password });
      try { await admin.connect(); break; }
      catch (error) {
        await admin.end();
        if (!['ECONNREFUSED', '57P03'].includes(error.code) || index === 19) throw error;
        await delay(250);
      }
    }
    statistics = await fixture.initialize(admin, port, passwords);
    assert.equal(statistics.capability.sha256,
      createHash('sha256').update('diagnostic-capability').digest('hex'));
    const target = await fixture.createDatabase(admin, port, 0, 'A');
    application = fixture.client({ port, database: target.database,
      user: target.role, password: passwords.a });
    await application.connect();
    await application.query('SELECT $1::text AS private_canary', [password]);
    const before = await fixture.captureStatements(statistics.observer, target, statistics.columns);
    await application.query('SELECT $1::integer AS diagnostic_call', [1]);
    await application.query('SELECT $1::integer AS diagnostic_call', [2]);
    const after = await fixture.captureStatements(statistics.observer, target, statistics.columns);
    const delta = statementDelta(before.snapshot, after.snapshot, statistics.columns);
    assert.equal(delta.totals.calls, 2);
    assert.equal(delta.totals.rows, 2);
    assert.equal(delta.statements.filter(row => row.newEntry).length, 1);
    assert.ok(delta.observer.calls >= 1);
    assert.ok(!JSON.stringify([before, after]).includes(password));
    assert.ok(after.snapshot.entries.every(row => typeof row.queryId === 'string'));
    assert.ok(Date.now() - start < 120000);
    console.log('Owned PG17: builtin SHA256, exact role/database scope, 2-call delta and secret exclusion verified.');
  } finally {
    for (const connection of [application, statistics?.observer, admin]) {
      if (!connection) continue;
      try { await connection.end(); }
      catch { process.exitCode = 1; }
    }
    const ids = (await docker(['ps', '-aq', '--no-trunc', '--filter', `label=scimserver.run=${run}`], true))
      .split('\n').filter(Boolean);
    for (const id of ids) {
      assert.match(id, /^[a-f0-9]{64}$/);
      const labels = JSON.parse(await docker(['inspect', '--format', '{{json .Config.Labels}}', id], true));
      assert.equal(labels['scimserver.owner'], owner);
      assert.equal(labels['scimserver.run'], run);
      await docker(['rm', '-f', id], true);
    }
    assert.equal(await docker(['ps', '-aq', '--filter', `label=scimserver.run=${run}`], true), '');
    assert.ok(Date.now() - start <= 180000, 'PG probe total cap includes cleanup');
    console.log(`Owned SQL probe cleanup verified; run=${run}; elapsedMs=${Date.now() - start}`);
  }
});
