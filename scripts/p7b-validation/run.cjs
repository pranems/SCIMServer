// Bounded integration driver. Database ownership, URL, mount and marker checks
// are the existing P5 harness, not a second isolation implementation.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { ROOT, API, OWNER, INERT, docker, markerGuard, ownedContainer, containerGuard,
  databaseGuard, guard } = require('../scim-search-validation/safety.cjs');
const { runPatchSchema } = require('../live-test-sections/patch-schema.cjs');

const git = (...args) => cp.execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
assert.ok(
  ['scimserver-scim-patch-schema-integration', 'scimserver-scim-consolidation']
    .includes(path.basename(ROOT).toLowerCase()),
  'P7b validation requires an owned source or consolidation worktree.',
);
assert.ok(
  ['fix/scim-patch-schema-integration-20260929', 'integrate/scim-correctness-20260928']
    .includes(git('branch', '--show-current')),
  'P7b validation requires its source or consolidation branch.',
);
git('merge-base', '--is-ancestor', '2788304eb5727698a39c563cb544af56e18553e7', 'HEAD');
markerGuard();
const inmemoryOnly = process.argv.includes('--inmemory');
assert.ok(process.argv.slice(2).every(arg => arg === '--inmemory'));
const run = crypto.randomBytes(8).toString('hex');
const password = crypto.randomBytes(36).toString('base64url');
const output = path.join(ROOT, 'test-results', 'p7b', run);
fs.mkdirSync(output, { recursive: true });
delete process.env.DATABASE_URL;
Object.assign(process.env, { SCIM_P5_RUN: run, DATABASE_URL: INERT, LOG_LEVEL: 'OFF', LOG_FILE: '', NODE_ENV: 'test' });
function fingerprint(directory, files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...new Set(files)].sort()) { hash.update(file); hash.update(fs.readFileSync(path.join(directory, file))); }
  return { fileCount: new Set(files).size, sha256: hash.digest('hex') };
}
const source = () => fingerprint(ROOT, git('ls-files', '-co', '--exclude-standard', '--',
  'api/src', 'api/test', 'api/prisma', 'scripts').split('\n').filter(Boolean));
const build = () => fingerprint(path.join(API, 'dist'),
  fs.readdirSync(path.join(API, 'dist'), { recursive: true }).filter(file => file.endsWith('.js')));
const receipt = { run, owner: OWNER, head: git('rev-parse', 'HEAD'), source: source(), build: build(),
  node: process.version, startedAt: new Date().toISOString(), lanes: [], cleanup: 'not-needed' };
let id;
let databaseUrl;
const clean = value => String(value).split(password).join('[REDACTED]')
  .replace(/postgres(?:ql)?:\/\/[^@\s"']+@/gi, 'postgresql://[REDACTED]@');
const save = () => fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
function execute(label, argv) {
  const result = cp.spawnSync(process.execPath, argv, {
    cwd: API, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${label}.log`), clean(`${result.stdout ?? ''}\n${result.stderr ?? ''}`));
  if (result.error) throw result.error;
  return result.status;
}
async function live(backend) {
  await guard();
  const port = await new Promise(resolve => {
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const secret = crypto.randomBytes(36).toString('base64url');
  const child = cp.spawn(process.execPath, [path.join(API, 'dist', 'main.js')], {
    cwd: API, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), SCIM_SHARED_SECRET: secret, JWT_SECRET: secret,
      OAUTH_CLIENT_SECRET: secret, PUBLIC_URL: `http://127.0.0.1:${port}` },
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const state = { backend, pid: child.pid, port, stopped: false };
  receipt.runtimes ??= [];
  receipt.runtimes.push(state);
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      assert.equal(child.exitCode, null, 'Owned API exited before readiness');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/scim/admin/endpoints`, {
          headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(500),
        });
        if (response.status === 200) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Owned API did not authenticate its task secret');
    const result = await runPatchSchema(`http://127.0.0.1:${port}`, secret);
    const p7a = await require('../live-test-p7.cjs').runP7Contract(`http://127.0.0.1:${port}`, secret);
    fs.writeFileSync(path.join(output, `${backend}-live.json`), JSON.stringify({ p7b: result, p7a }, null, 2));
    return { p7bCases: result.cases, p7bAssertions: result.assertions, p7aAssertions: p7a.assertions,
      endpointCollectionUnchanged: result.endpointCollectionUnchanged };
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    state.stopped = true;
    fs.writeFileSync(path.join(output, `${backend}-runtime.log`), clean(log).split(secret).join('[REDACTED]'));
  }
}
async function main() {
  if (!inmemoryOnly) {
    receipt.image = docker('image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}');
    id = cp.execFileSync('docker', [
      'run', '-d', '--pull=never', '--name', `scim-search-p5-${run}`,
      '--label', `scim.validation.owner=${OWNER}`, '--label', `scim.validation.run=${run}`,
      '--network', 'bridge', '--publish', '127.0.0.1::5432',
      '--tmpfs', '/var/lib/postgresql/data:rw', '--env', 'POSTGRES_PASSWORD',
      '--env', 'POSTGRES_USER=p5_runner', '--env', `POSTGRES_DB=scim_p5_${run}`,
      'postgres:17-alpine', 'postgres', '-c', `cluster_name=scim-search-p5-${run}`,
    ], { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } }).trim();
    process.env.SCIM_P5_CONTAINER = id;
    receipt.containerId = id;
    save();
    const info = JSON.parse(docker('inspect', id))[0];
    const port = info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
    databaseUrl = `postgresql://p5_runner:${password}@127.0.0.1:${port}/scim_p5_${run}`;
    process.env.DATABASE_URL = databaseUrl;
    containerGuard();
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = cp.spawnSync('docker', ['exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'p5_runner',
        '-d', `scim_p5_${run}`], { encoding: 'utf8' }).status;
      if (status === 0) { ready = true; break; }
      assert.ok([1, 2].includes(status));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    receipt.identity = await databaseGuard(false);
    assert.match(receipt.identity.version, /^PostgreSQL 17\.8 /);
    process.env.SCIM_P5_SYSTEM_ID = receipt.identity.system_identifier;
    const { Client } = require(path.join(API, 'node_modules', 'pg'));
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
      await client.query('CREATE SCHEMA p5_guard');
      await client.query('CREATE TABLE p5_guard.ownership(owner text NOT NULL, run text NOT NULL)');
      await client.query('INSERT INTO p5_guard.ownership VALUES ($1,$2)', [OWNER, run]);
      await client.query('CREATE EXTENSION "uuid-ossp"');
      await databaseGuard();
      assert.equal(execute('migrations', [path.join(API, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy']), 0);
      receipt.migrations = (await client.query('SELECT migration_name, finished_at IS NOT NULL AS finished FROM "_prisma_migrations" ORDER BY migration_name')).rows;
      assert.deepEqual(receipt.migrations.map(row => row.migration_name), fs.readdirSync(path.join(API, 'prisma', 'migrations'),
        { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort());
      assert.equal(receipt.migrations.length, 22);
      assert.ok(receipt.migrations.every(row => row.finished));
    } finally { await client.end(); }
  }
  const suites = ['patch-schema-contract', 'common-externalid-patch', 'ordered-patch',
    'patch-compatibility-flags', 'profile-validation-p7', 'patch-untouched-attribute-validation'];
  for (const backend of databaseUrl ? ['inmemory', 'prisma'] : ['inmemory']) {
    process.env.PERSISTENCE_BACKEND = backend;
    process.env.DATABASE_URL = backend === 'prisma' ? databaseUrl : INERT;
    await guard();
    const resultFile = path.join(output, `${backend}.json`);
    const exit = execute(backend, [path.join(API, 'node_modules', 'jest', 'bin', 'jest.js'),
      '--config', path.join(ROOT, 'scripts', 'scim-search-validation', 'jest.config.cjs'), '--runInBand',
      '--runTestsByPath', ...suites.map(s => path.join('test', 'e2e', `${s}.e2e-spec.ts`)),
      '--json', '--outputFile', resultFile]);
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.equal(result.numTotalTestSuites, suites.length);
    assert.ok(result.numPassedTests >= 250, 'Unexpected focused test discovery loss');
    const lane = { backend, exit, passed: result.numPassedTests, failed: result.numFailedTests, pending: result.numPendingTests };
    receipt.lanes.push(lane);
    if (exit !== 0) process.exitCode = 1;
    lane.live = await live(backend);
    save();
  }
  assert.deepEqual(source(), receipt.source);
  assert.deepEqual(build(), receipt.build);
}
main().catch(error => { receipt.error = clean(error.stack); process.exitCode = 1; }).finally(() => {
  if (id) {
    try {
      ownedContainer();
      docker('rm', '-f', id);
      assert.equal(docker('ps', '-aq', '--filter', `id=${id}`), '');
      receipt.cleanup = 'exact-container-removed';
    } catch (error) { receipt.cleanup = clean(error.message); process.exitCode = 1; }
  }
  receipt.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ output, lanes: receipt.lanes, error: receipt.error, cleanup: receipt.cleanup }, null, 2));
});
