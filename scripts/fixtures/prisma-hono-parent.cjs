'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
if (process.env.SCIM_HONO_ISOLATED !== '1' || process.platform !== 'linux' ||
    !require('node:fs').existsSync('/.dockerenv') ||
    Object.values(require('node:os').networkInterfaces()).flat().some(address => !address.internal)) {
  throw new Error('Actual parent qualification requires the network-isolated container runner.');
}
const { Client } = require('pg');
const { startPrismaDevServer, PortNotAvailableError } = require('@prisma/dev');
const path = require('node:path');
const packageJson = name => require(path.join(path.dirname(require.resolve(name)), '..', 'package.json'));

async function bind(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function main() {
  const adapter = packageJson('@hono/node-server');
  assert.equal(require('prisma/package.json').version, '7.8.0');
  assert.equal(packageJson('@prisma/dev').version, '0.24.3');
  assert.equal(adapter.version, process.env.EXPECT_ADAPTER);
  const name = 'scim-hono-qualification-20261029';
  const original = { Request: globalThis.Request, Response: globalThis.Response, fetch: globalThis.fetch };
  let server;
  const clients = [];
  try {
    server = await startPrismaDevServer({
      name, persistenceMode: 'stateless',
      port: 55113, databasePort: 55114, shadowDatabasePort: 55115,
    });
    const streamsPort = Number(new URL(server.experimental.streams.serverUrl).port);
    console.log('READY', JSON.stringify({
      adapter: adapter.version, parent: '0.24.3', prisma: '7.8.0',
      http: server.http.url, experimental: Object.keys(server.experimental),
    }));
    for (const [key, value] of Object.entries(original)) assert.equal(globalThis[key], value);
    const url = new URL(server.http.url);
    url.hostname = '127.0.0.1';
    const health = await fetch(new URL('/health', url));
    assert.equal(health.status, 200);
    assert.match(health.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await health.json(), { name });
    const missing = await fetch(new URL('/qualification-missing', url));
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), '404 Not Found');
    const invalid = await fetch(new URL('/query', url), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(invalid.status, 401);
    console.log('HTTP_ERROR', invalid.status, await invalid.text());
    for (const purpose of ['database', 'shadowDatabase']) {
      const client = new Client({ connectionString: server[purpose].connectionString });
      clients.push(client);
      await client.connect();
      await client.query('CREATE TABLE qualification (id integer primary key, label text not null)');
      await client.query('INSERT INTO qualification VALUES ($1, $2)', [1, 'synthetic-only']);
      assert.deepEqual((await client.query('SELECT id, label FROM qualification')).rows,
        [{ id: 1, label: 'synthetic-only' }]);
      await client.end();
      clients.pop();
      console.log('DATABASE_OK', purpose);
    }
    const dump = await fetch(new URL('/database/dump', url), { method: 'POST' });
    assert.equal(dump.status, 201);
    const payload = await dump.json();
    assert.deepEqual(Object.keys(payload), ['dumpPath']);
    assert.equal(typeof payload.dumpPath, 'string');
    assert.ok((await fs.stat(payload.dumpPath)).size > 0);
    console.log('DUMP_OK');
    await server.close();
    server = undefined;
    for (const port of [55113, 55114, 55115, streamsPort]) await close(await bind(port));
    console.log('SHUTDOWN_PORTS_RELEASED');
    console.log('RESOURCES_AFTER_CLOSE', process.getActiveResourcesInfo());
    const blocker = await bind(55113);
    try {
      await assert.rejects(startPrismaDevServer({
        name: name + '-conflict', persistenceMode: 'stateless',
        port: 55113, databasePort: 55214, shadowDatabasePort: 55215,
      }), error => error instanceof PortNotAvailableError && error.port === 55113);
      console.log('PORT_CONFLICT_OK');
    } finally {
      await close(blocker);
    }
    for (const port of [55113, 55214, 55215]) await close(await bind(port));
    const dataFiles = await fs.readdir(process.env.XDG_DATA_HOME, { recursive: true, withFileTypes: true })
      .catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    assert.deepEqual(dataFiles.filter(entry => entry.isFile()), []);
    console.log('PASS actual installed Prisma parent lifecycle', adapter.version);
    console.log('RESOURCES_AFTER_ERROR', process.getActiveResourcesInfo());
    await fs.writeFile('result.json', JSON.stringify({
      passed: true, adapter: adapter.version, prisma: '7.8.0', parent: '0.24.3',
      node: process.version,
      claims: ['actual-parent-initialization', 'readiness', 'health-body', 'not-found-body', 'query-auth-error',
        'primary-synthetic-write', 'shadow-synthetic-write', 'nonempty-dump',
        'global-fetch-unchanged', 'http-db-shadow-stream-ports-released',
        'occupied-port-rejection', 'stateless-data-files-removed'],
      naturalProcessExit: 'not asserted; runner records actual container state before cleanup',
    }, null, 2) + '\n');
  } finally {
    for (const client of clients) await client.end();
    if (server) await server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  setTimeout(() => {
    console.log('DELAYED_RESOURCES', process.getActiveResourcesInfo());
    console.log('REFERENCED_LIBUV', JSON.stringify(process.report.getReport().libuv.filter(h => h.is_referenced)));
  }, 1500).unref();
});
