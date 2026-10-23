const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { client } = require('./membership-statement-fixture.cjs');
const { finalizeOwned, sourceTip } = require('./membership-history.cjs');
const { validateLegacyPrivacy, classifyLegacyHeaders } = require('./membership-statements.cjs');
const protocol = require('./membership-protocol.json');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function readFunctionalResponse(response, status) {
  if (status === undefined) assert.ok(response.ok, 'Original successful flush contract');
  else assert.equal(response.status, status, 'Functional response status');
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function verifyProvenance(rows, expected, endpointId) {
  assert.equal(rows.length, expected.length, 'Required authorized row count');
  assert.equal(new Set(rows.map(row => row.requestId)).size, expected.length, 'Duplicate private row');
  for (const row of rows) {
    const request = expected.find(item => item.requestId === row.requestId);
    assert.ok(request, 'Unknown request owner');
    assert.equal(row.endpointId, endpointId, 'Foreign endpoint row');
    for (const key of ['method', 'url', 'status'])
      assert.equal(row[key], request[key], `Private row ${key} mismatch`);
  }
  return true;
}

async function main() {
  assert.equal(process.argv[2], '--functional-only', 'Explicit functional opt-in required');
  assert.equal(process.argv.length, 4);
  const directory = path.resolve(process.argv[3]);
  assert.ok(directory.startsWith(root + path.sep));
  fs.mkdirSync(directory);
  const started = Date.now();
  const deadline = started + 300000;
  const workDeadline = deadline - 120000;
  const run = crypto.randomUUID().replaceAll('-', '');
  const owner = 'membership-privacy-functional';
  const prefix = `scim-os07-${run.slice(0, 12)}`;
  const labels = ['--label', `scimserver.owner=${owner}`, '--label', `scimserver.run=${run}`];
  const names = [`${prefix}-pg`, `${prefix}-app`];
  const network = `${prefix}-net`;
  const secrets = Object.fromEntries(['POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET',
    'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK'].map(key => [key, crypto.randomBytes(32).toString('hex')]));
  const environment = { ...process.env, ...secrets };
  const report = { family: owner, diagnosticOnly: true, admissionEligible: false,
    run, status: 'INCOMPLETE', startedAtUtc: new Date(started).toISOString(),
    deadlineUtc: new Date(deadline).toISOString(), requests: [], readiness: [], failures: [] };
  const write = (name, data) => {
    const bytes = JSON.stringify(data, null, 2) + '\n';
    for (const secret of Object.values(secrets)) assert.ok(!bytes.includes(secret), 'Output privacy canary');
    fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
  };
  let connection;
  let networkCreated = false;
  let stage = 'preflight';
  const allocated = [];
  const check = () => assert.ok(Date.now() < workDeadline, 'Functional work cap; cleanup reserved');
  async function docker(args, cleanup = false, combined = false) {
    if (!cleanup) check();
    const remaining = (cleanup ? deadline : workDeadline) - Date.now();
    assert.ok(remaining > 0, 'Functional total cap');
    try {
      const result = await exec('docker', ['--context', 'desktop-linux', ...args], {
        cwd: root, env: environment, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
        timeout: Math.min(cleanup ? 10000 : 30000, remaining),
      });
      return (combined ? result.stdout + result.stderr : result.stdout).trim();
    } catch (error) {
      const safe = new Error('Owned functional Docker operation failed; private output withheld');
      safe.code = ['ENOENT', 'ETIMEDOUT'].includes(error.code) ? error.code : 'OWNED_DOCKER';
      throw safe;
    }
  }
  async function inspect(name, cleanup = false) {
    const row = JSON.parse(await docker(['inspect', '--format',
      '{"id":{{json .Id}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"pid":{{json .State.Pid}},"running":{{json .State.Running}},"oom":{{json .State.OOMKilled}},"started":{{json .State.StartedAt}},"cpu":{{json .HostConfig.NanoCpus}},"memory":{{json .HostConfig.Memory}}}', name], cleanup));
    assert.equal(row.labels['scimserver.owner'], owner);
    assert.equal(row.labels['scimserver.run'], run);
    return row;
  }
  async function allocate(name, args) {
    allocated.push(name);
    const id = await docker(['run', '-d', '--pull=never', '--name', name, ...labels, ...args]);
    assert.match(id, /^[a-f0-9]{64}$/);
    return id;
  }
  try {
    const images = {};
    for (const [role, image] of Object.entries({ app: protocol.baseline.image, pg: protocol.postgres })) {
      const row = JSON.parse(await docker(['image', 'inspect', '--format',
        '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}}}', image]));
      assert.ok(row.digests.includes(image));
      assert.equal(row.os, 'linux');
      images[role] = { ...row, requested: image };
    }
    const routes = ['endpoint-create', 'endpoint-policy', 'group-create', 'group-patch',
      'group-missing-read', 'group-missing-patch', 'flush'];
    const requestIds = Object.fromEntries(routes.map(route => [route, crypto.randomUUID()]));
    const files = ['run-membership-privacy-functional.cjs', 'membership-statements.cjs',
      'membership-statement-fixture.cjs', 'membership-history.cjs', 'membership-protocol.json'];
    const inspected = {};
    const legacyRoot = path.join(root, 'test-results/os07-functional-20261023/legacy-source');
    for (const file of ['logging/logging.service.js', 'logging/request-logging.interceptor.js',
      'filters/scim-exception.filter.js', 'endpoint-config.interface.js', 'dto/update-endpoint.dto.d.ts'])
      inspected[file] = digest(fs.readFileSync(path.join(legacyRoot, file)));
    const manifest = { ...report, sourceTip: await sourceTip(root), images,
      inspectedLegacySourceHashes: inspected,
      client: { node: process.version, executableSha256: digest(fs.readFileSync(process.execPath)),
        pgVersion: require(path.join(root, 'api/node_modules/pg/package.json')).version },
      sourceHashes: Object.fromEntries(files.map(file => [file, digest(fs.readFileSync(path.join(__dirname, file)))])),
      policy: { maximumAuthenticatedRequests: 7, expectedAuthorizedRows: 4,
        workloadRoutes: routes.slice(2, 6), readinessRoute: '/scim/health',
        requestIdRequired: true, exactEndpointMethodRouteStatus: true,
        requestedServerPersistRequestSecrets: false, requestedEndpointPersistRequestSecrets: false,
        profilePreset: 'rfc-standard', appCpu: 0.5, appMemory: 1073741824,
        wallCapMs: 300000, cleanupReservationMs: 120000, flushDeadlineMs: 10000,
        performanceCycles: 0, statisticsExtension: false, rawPrivateExport: false },
      hypothesis: 'With explicit legacy secret persistence disabled, known authorized success/error rows retain object-shaped JSON and the exact mask. Readiness/admin rows are excluded by request IDs and endpoint/method/route.',
      requestIds, ownerNames: names, network };
    fs.mkdirSync(path.join(directory, 'frozen-inputs'));
    for (const file of files) fs.copyFileSync(path.join(__dirname, file), path.join(directory, 'frozen-inputs', file),
      fs.constants.COPYFILE_EXCL);
    write('manifest.json', manifest);
    report.manifestSha256 = digest(fs.readFileSync(path.join(directory, 'manifest.json')));
    stage = 'owned-pg';
    await docker(['network', 'create', ...labels, network]);
    networkCreated = true;
    await allocate(names[0], ['--network', network, '--network-alias', 'database',
      '--publish', '127.0.0.1::5432', '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data',
      '--env', 'POSTGRES_USER=scim', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=os07', protocol.postgres]);
    const pgPort = await docker(['port', names[0], '5432/tcp']);
    assert.match(pgPort, /^127\.0\.0\.1:\d+$/);
    const options = { port: Number(pgPort.split(':')[1]), database: 'os07', user: 'scim',
      password: secrets.POSTGRES_PASSWORD, application_name: 'os07-private-observer' };
    for (let attempt = 0; attempt < 30; attempt++) {
      check();
      connection = client(options);
      try { await connection.connect(); break; }
      catch (error) {
        await connection.end();
        if (!['ECONNREFUSED', '57P03'].includes(error.code) || attempt === 29) throw error;
        await delay(500);
      }
    }
    report.postgresVersion = (await connection.query('SELECT version() AS version')).rows[0].version;
    assert.match(report.postgresVersion, /^PostgreSQL 17\.11 /);
    await connection.query('CREATE EXTENSION citext; CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm; CREATE EXTENSION "uuid-ossp"');
    environment.DATABASE_URL = `postgresql://scim:${secrets.POSTGRES_PASSWORD}@database:5432/os07`;
    stage = 'owned-app';
    await allocate(names[1], ['--network', network, '--publish', '127.0.0.1::8080',
      '--cpus', '0.5', '--memory', '1g', '--env', 'DATABASE_URL',
      ...Object.keys(secrets).filter(key => key !== 'POSTGRES_PASSWORD').flatMap(key => ['--env', key]),
      '--env', 'PERSISTENCE_BACKEND=prisma', '--env', 'NODE_ENV=production',
      '--env', 'PERSIST_REQUEST_SECRETS=false', '--env', 'PORT=8080',
      '--entrypoint', 'sh', protocol.baseline.image, '-c',
      'node node_modules/prisma/build/index.js migrate deploy >/dev/null && exec node dist/main.js']);
    const appPort = await docker(['port', names[1], '8080/tcp']);
    assert.match(appPort, /^127\.0\.0\.1:\d+$/);
    const base = `http://${appPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      check();
      let status;
      try { status = (await fetch(`${base}/scim/health`, { signal: AbortSignal.timeout(1500) })).status; }
      catch (error) { if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error; }
      report.readiness.push({ attempt, status: status ?? null });
      if (status === 200) { ready = true; break; }
      await delay(500);
    }
    assert.ok(ready, 'Owned functional readiness');
    report.app = await inspect(names[1]);
    report.pg = await inspect(names[0]);
    assert.equal(report.app.image, images.app.id);
    assert.equal(report.pg.image, images.pg.id);
    assert.equal(report.app.cpu, 500000000);
    assert.equal(report.app.memory, 1073741824);
    report.application = JSON.parse(await docker(['exec', names[1], 'node', '-e',
      "console.log(JSON.stringify({version:require('/app/package.json').version,persist:process.env.PERSIST_REQUEST_SECRETS}))"]));
    assert.equal(report.application.version, '0.55.20');
    assert.equal(report.application.persist, 'false');
    const expected = [];
    async function request(route, method, url, body, status, workload = false) {
      check();
      stage = route;
      assert.ok(report.requests.length < 7, 'Authenticated request cap');
      const response = await fetch(base + url, { method,
        headers: { Authorization: `Bearer ${secrets.SCIM_SHARED_SECRET}`,
          'Content-Type': 'application/scim+json', 'X-Request-Id': requestIds[route] },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(10000, workDeadline - Date.now())) });
      report.requests.push({ route, method, status: response.status, requestId: requestIds[route] });
      const result = await readFunctionalResponse(response, status);
      if (workload) expected.push({ route, method, url, status, requestId: requestIds[route] });
      return result;
    }
    const endpoint = await request('endpoint-create', 'POST', '/scim/admin/endpoints',
      { name: prefix, displayName: 'Owned OS07 functional fixture', profilePreset: 'rfc-standard' }, 201);
    assert.match(endpoint.id, /^[a-f0-9-]{36}$/i);
    const policy = async () => (await connection.query(`SELECT
      profile->'settings'->'PersistRequestSecrets' AS persist FROM "Endpoint" WHERE id=$1`,
    [endpoint.id])).rows[0].persist;
    report.presetPersistRequestSecrets = await policy();
    await request('endpoint-policy', 'PATCH', `/scim/admin/endpoints/${endpoint.id}`,
      { profile: { settings: { PersistRequestSecrets: false } } }, 200);
    report.actualEndpointPersistRequestSecrets = await policy();
    assert.equal(report.actualEndpointPersistRequestSecrets, false, 'Actual endpoint secret persistence');
    const scope = `/scim/endpoints/${endpoint.id}/Groups`;
    const group = await request('group-create', 'POST', scope,
      { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Owned OS07 group' }, 201, true);
    assert.match(group.id, /^[a-f0-9-]{36}$/i);
    const patch = { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'displayName', value: 'Owned OS07 updated group' }] };
    await request('group-patch', 'PATCH', `${scope}/${group.id}`, patch, 200, true);
    const missing = `${scope}/${crypto.randomUUID()}`;
    await request('group-missing-read', 'GET', missing, undefined, 404, true);
    await request('group-missing-patch', 'PATCH', missing, patch, 404, true);
    await request('flush', 'POST', '/scim/admin/logs/flush', undefined, undefined);
    stage = 'private-row-capture';
    const flushDeadline = Math.min(workDeadline, Date.now() + 10000);
    let rows;
    do {
      check();
      rows = (await connection.query(`SELECT "requestId","endpointId",method,url,status,"requestHeaders",
        (url LIKE '%/Groups%' AND (status >= 400 OR method='PATCH')) AS "legacySelected"
        FROM "RequestLog" WHERE "requestId"::text=ANY($1::text[]) ORDER BY "createdAt"`,
      [expected.map(row => row.requestId)])).rows;
      if (rows.length >= 4) break;
      await delay(250);
    } while (Date.now() < flushDeadline);
    report.rowFacts = rows.map(row => ({
      route: expected.find(item => item.requestId === row.requestId)?.route ?? 'unknown',
      method: ['GET', 'POST', 'PATCH'].includes(row.method) ? row.method : 'unknown',
      status: [200, 201, 404].includes(row.status) ? row.status : null,
      endpointMatches: row.endpointId === endpoint.id,
      legacySelected: row.legacySelected,
      headerStorageType: typeof row.requestHeaders,
      ...classifyLegacyHeaders(row.requestHeaders),
    }));
    verifyProvenance(rows, expected, endpoint.id);
    const privateConsole = await docker(['logs', '--tail', '300', names[1]], false, true);
    report.privacy = validateLegacyPrivacy(rows, privateConsole, Object.values(secrets), 4);
    report.status = 'FUNCTIONAL-COMPLETE';
  } catch (error) {
    report.status = 'INVALID';
    report.failures.push({ stage, code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : error.name,
      ...(error.code === 'DIAGNOSTIC_PRIVACY' ? { safeDetails: error.safeDetails } : {}) });
    process.exitCode = 1;
  } finally {
    if (connection) {
      try { await connection.end(); }
      catch { report.failures.push({ stage: 'close-client', code: 'CLIENT_CLOSE' }); }
    }
    report.cleanup = await finalizeOwned(allocated, {
      capture: name => inspect(name, true),
      remove: async name => { await inspect(name, true); await docker(['rm', '-f', name], true); },
      verify: async name => !(await docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'], true)),
    });
    if (networkCreated) {
      try {
        const actual = JSON.parse(await docker(['network', 'inspect', '--format', '{{json .Labels}}', network], true));
        assert.equal(actual['scimserver.owner'], owner);
        assert.equal(actual['scimserver.run'], run);
        await docker(['network', 'rm', network], true);
      } catch { report.failures.push({ stage: 'cleanup-network', code: 'NETWORK_CLEANUP' }); }
    }
    try {
      report.remainingOwned = await docker(['ps', '-a', '--filter', `label=scimserver.run=${run}`,
        '--format', '{{.ID}}'], true);
      report.remainingNetworks = await docker(['network', 'ls', '--filter', `label=scimserver.run=${run}`,
        '--format', '{{.ID}}'], true);
    } catch { report.failures.push({ stage: 'cleanup-inventory', code: 'INVENTORY' }); }
    report.elapsedMs = Date.now() - started;
    if (!report.cleanup.verified || report.remainingOwned !== '' || report.remainingNetworks !== '' ||
      report.elapsedMs > 300000 || report.failures.length) {
      report.status = 'INVALID';
      process.exitCode = 1;
    }
    write('report.json', report);
    console.log(JSON.stringify({ status: report.status, run, requests: report.requests.length,
      elapsedMs: report.elapsedMs, cleanup: report.cleanup.verified }));
  }
}

module.exports = { verifyProvenance, readFunctionalResponse };
if (require.main === module) main().catch(() => {
  console.error('Functional entry failed; private details withheld');
  process.exitCode = 1;
});
