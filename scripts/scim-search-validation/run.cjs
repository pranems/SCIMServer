const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { ROOT, API, OWNER, INERT, docker, markerGuard, ownedContainer, containerGuard, databaseGuard, guard } = require('./safety.cjs');

markerGuard();
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--inmemory'));
const run = crypto.randomBytes(8).toString('hex');
const password = crypto.randomBytes(36).toString('base64url');
const output = path.join(ROOT, 'test-results', 'p5', run);
fs.mkdirSync(output, { recursive: true });
process.env.SCIM_P5_RUN = run;
process.env.DATABASE_URL = INERT;
process.env.LOG_LEVEL = 'OFF';
process.env.LOG_FILE = '';
process.env.NODE_ENV = 'test';
const receipt = {
  run, owner: OWNER,
  source: cp.execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), lanes: [], cleanup: 'not-needed',
};
let id;
let databaseUrl;
const clean = (value) => String(value).split(password).join('[REDACTED]')
  .replace(/postgres(?:ql)?:\/\/[^@\s"']+@/gi, 'postgresql://[REDACTED]@');
function execute(label, argv) {
  const result = cp.spawnSync(process.execPath, argv, {
    cwd: API, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${label}.log`), clean(`${result.stdout ?? ''}\n${result.stderr ?? ''}`));
  if (result.error) throw result.error;
  return result.status;
}
async function main() {
  if (!args.includes('--inmemory')) {
    docker('image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}');
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
    fs.writeFileSync(path.join(output, 'run.json'), JSON.stringify(receipt, null, 2));
    const info = JSON.parse(docker('inspect', id))[0];
    const port = info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
    databaseUrl = `postgresql://p5_runner:${password}@127.0.0.1:${port}/scim_p5_${run}`;
    process.env.DATABASE_URL = databaseUrl;
    containerGuard();
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = cp.spawnSync('docker', ['exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'p5_runner', '-d', `scim_p5_${run}`], { encoding: 'utf8' });
      if (result.status === 0) { ready = true; break; }
      assert.ok([1, 2].includes(result.status));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Disposable database did not become ready.');
    receipt.identity = await databaseGuard(false);
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
    } finally { await client.end(); }
    await databaseGuard();
    assert.equal(execute('migrations', [path.join(API, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy']), 0);
    const verify = new Client({ connectionString: databaseUrl });
    await verify.connect();
    try {
      const migrations = (await verify.query('SELECT migration_name, finished_at IS NOT NULL AS finished FROM "_prisma_migrations" ORDER BY migration_name')).rows;
      assert.deepEqual(migrations.map((row) => row.migration_name), fs.readdirSync(path.join(API, 'prisma', 'migrations'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort());
      assert.ok(migrations.every((row) => row.finished));
      receipt.migrations = migrations.length;
    } finally { await verify.end(); }
  }
  for (const backend of databaseUrl ? ['inmemory', 'prisma'] : ['inmemory']) {
    process.env.PERSISTENCE_BACKEND = backend;
    process.env.DATABASE_URL = backend === 'prisma' ? databaseUrl : INERT;
    await guard();
    const resultFile = path.join(output, `${backend}.json`);
    const exit = execute(backend, [
      path.join(API, 'node_modules', 'jest', 'bin', 'jest.js'),
      '--config', path.join(__dirname, 'jest.config.cjs'), '--runInBand',
      '--runTestsByPath',
      'test/e2e/search-contract.e2e-spec.ts',
      'test/e2e/search-endpoint.e2e-spec.ts',
      'test/e2e/attribute-projection.e2e-spec.ts',
      '--json', '--outputFile', resultFile,
    ]);
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    receipt.lanes.push({ backend, exit, passed: result.numPassedTests, failed: result.numFailedTests, suites: result.numTotalTestSuites });
    if (exit !== 0) process.exitCode = 1;
  }
}
main().catch((error) => {
  receipt.error = clean(error.stack);
  process.stderr.write(`${receipt.error}\n`);
  process.exitCode = 1;
}).finally(() => {
  if (id) {
    try {
      ownedContainer();
      docker('rm', '-f', id);
      assert.ok(!docker('ps', '-aq', '--filter', `id=${id}`).includes(id.slice(0, 12)));
      receipt.cleanup = 'exact-container-removed';
    } catch (error) {
      receipt.cleanup = clean(error.message);
      process.exitCode = 1;
    }
  }
  receipt.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'run.json'), JSON.stringify(receipt, null, 2));
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\nEvidence: ${output}\n`);
});
