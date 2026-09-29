const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..', '..');
const API = path.join(ROOT, 'api');
const OWNER = 'scim-search-contract-p5';
const INERT = 'postgresql://127.0.0.1:1/scim_p5_never_connect';
const docker = (...args) => cp.execFileSync('docker', args, {
  encoding: 'utf8', windowsHide: true,
}).trim();

function markerGuard() {
  assert.equal(fs.existsSync(path.join(API, 'test', 'e2e', '.test-db-path')), false,
    'Refusing existing database marker; do not read, replace or delete it.');
}

function ownedContainer() {
  const id = process.env.SCIM_P5_CONTAINER;
  const run = process.env.SCIM_P5_RUN;
  assert.match(id ?? '', /^[a-f0-9]{64}$/);
  assert.match(run ?? '', /^[a-f0-9]{16}$/);
  const container = JSON.parse(docker('inspect', id))[0];
  assert.equal(container.Id, id);
  assert.equal(container.Name, `/scim-search-p5-${run}`);
  assert.equal(container.Config.Labels['scim.validation.owner'], OWNER);
  assert.equal(container.Config.Labels['scim.validation.run'], run);
  return container;
}

function containerGuard() {
  const container = ownedContainer();
  const id = process.env.SCIM_P5_CONTAINER;
  const run = process.env.SCIM_P5_RUN;
  assert.equal(container.State.Running, true);
  assert.equal(container.HostConfig.NetworkMode, 'bridge');
  assert.ok(container.Mounts.every((mount) => mount.Type === 'tmpfs'));
  assert.ok(container.HostConfig.Tmpfs['/var/lib/postgresql/data']);
  const ports = container.NetworkSettings.Ports['5432/tcp'];
  assert.equal(ports.length, 1);
  assert.equal(ports[0].HostIp, '127.0.0.1');
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, ports[0].HostPort);
  assert.equal(url.pathname, `/scim_p5_${run}`);
  assert.equal(url.username, 'p5_runner');
  assert.ok(url.password.length >= 32);
  assert.equal(url.search, '');
  return { id, run, port: ports[0].HostPort };
}

async function databaseGuard(marked = true) {
  const { run } = containerGuard();
  const { Client } = require(path.join(API, 'node_modules', 'pg'));
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const identity = (await client.query(`
      SELECT current_database() AS database, current_user AS username,
        current_setting('cluster_name') AS cluster, version() AS version,
        system_identifier::text FROM pg_control_system()
    `)).rows[0];
    assert.equal(identity.database, `scim_p5_${run}`);
    assert.equal(identity.username, 'p5_runner');
    assert.equal(identity.cluster, `scim-search-p5-${run}`);
    assert.match(identity.version, /^PostgreSQL 17\./);
    if (process.env.SCIM_P5_SYSTEM_ID) assert.equal(identity.system_identifier, process.env.SCIM_P5_SYSTEM_ID);
    if (marked) {
      assert.deepEqual((await client.query('SELECT owner, run FROM p5_guard.ownership')).rows, [{ owner: OWNER, run }]);
    }
    return identity;
  } finally {
    await client.end();
  }
}

async function guard() {
  markerGuard();
  assert.ok(['inmemory', 'prisma'].includes(process.env.PERSISTENCE_BACKEND));
  if (process.env.PERSISTENCE_BACKEND === 'prisma') return databaseGuard();
  assert.equal(process.env.DATABASE_URL, INERT);
}
module.exports = { ROOT, API, OWNER, INERT, docker, markerGuard, ownedContainer, containerGuard, databaseGuard, guard };
