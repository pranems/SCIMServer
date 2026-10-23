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
const { fail, credentialCanaries, assertCanariesAbsent, encodeSafeJson,
  validateSafeFailure } = require('./membership-privacy.cjs');
const protocol = require('./membership-protocol.json');
const derivedTool = require('./membership-derived-functional.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const functionalPolicy = Object.freeze({ maximumAuthenticatedRequests: 7, maximumReadinessProbes: 15,
  readinessIntervalMs: 1000, wallCapMs: 300000, cleanupReservationMs: 120000 });

function splitDockerLogOutput(output) {
  const container = [];
  const tool = [];
  for (const stream of [output.stdout, output.stderr]) {
    for (const line of stream.split(/\r?\n/)) {
      const frame = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z /.exec(line);
      if (frame) container.push(line.slice(frame[0].length));
      else tool.push(line);
    }
  }
  return { container: container.join('\n'), tool: tool.join('\n') };
}

function writeFunctionalReport(write, report) {
  try { write('report.json', report); }
  catch (error) {
    if (error.code !== 'DIAGNOSTIC_PRIVACY') throw error;
    report.status = 'INVALID';
    write('report.json', { family: report.family === 'membership-derived-reference-functional'
      ? 'membership-derived-reference-functional' : 'membership-privacy-functional',
      status: 'INVALID', diagnosticOnly: true,
      admissionEligible: false, cleanup: { verified: report.cleanup?.verified === true },
      remainingOwned: report.remainingOwned === '' ? '' : 'unverified',
      remainingNetworks: report.remainingNetworks === '' ? '' : 'unverified',
      failures: [{ stage: 'report-output', code: error.code,
        safeDetails: validateSafeFailure(error.safeDetails),
        safeFindings: error.safeFindings.map(validateSafeFailure) }] });
    return true;
  }
  return false;
}

async function readFunctionalResponse(response, status) {
  if (status === undefined) assert.ok(response.ok, 'Original successful flush contract');
  else assert.equal(response.status, status, 'Functional response status');
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function verifyProvenance(rows, expected, endpointId) {
  if (!Array.isArray(rows) || rows.length !== expected.length)
    fail('provenance-row-count', 'selected-rows');
  if (new Set(rows.map(row => row.requestId)).size !== expected.length)
    fail('provenance-duplicate', 'selected-rows');
  for (const [rowIndex, row] of rows.entries()) {
    const reject = reason => fail(reason, 'selected-rows', 'not-applicable', { rowIndex });
    const request = expected.find(item => item.requestId === row.requestId);
    if (!request) reject('provenance-owner');
    if (row.endpointId !== endpointId) reject('provenance-endpoint');
    for (const [key, reason] of [['method', 'provenance-method'], ['url', 'provenance-route'],
      ['status', 'provenance-status']])
      if (row[key] !== request[key]) reject(reason);
  }
  return true;
}

async function main() {
  assert.ok(['--functional-only', '--derived-reference-functional-only'].includes(process.argv[2]),
    'Explicit functional opt-in required');
  assert.equal(process.argv.length, 4);
  const derived = process.argv[2] === '--derived-reference-functional-only';
  const buildProof = derived ? derivedTool.loadBuildProof(root) : undefined;
  const appImage = derived ? buildProof.imageId : protocol.baseline.image;
  const directory = path.resolve(process.argv[3]);
  assert.ok(directory.startsWith(root + path.sep));
  fs.mkdirSync(directory);
  const started = Date.now();
  const deadline = started + functionalPolicy.wallCapMs;
  const workDeadline = deadline - functionalPolicy.cleanupReservationMs;
  const run = crypto.randomUUID().replaceAll('-', '');
  const owner = derived ? 'membership-derived-reference-functional' : 'membership-privacy-functional';
  const prefix = `${derived ? 'scim-derived-functional' : 'scim-os07'}-${run.slice(0, 12)}`;
  const labels = ['--label', `scimserver.owner=${owner}`, '--label', `scimserver.run=${run}`];
  const names = [`${prefix}-pg`, `${prefix}-app`];
  const network = `${prefix}-net`;
  const secrets = Object.fromEntries(['POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET',
    'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK'].map(key => [key, crypto.randomBytes(32).toString('hex')]));
  const environment = { ...process.env, ...secrets };
  const canaries = credentialCanaries(secrets);
  let toolConsole = '';
  const report = { family: owner, diagnosticOnly: true, admissionEligible: false,
    ...(derived ? { derivedReference: true, baselineAdoptionApproved: false, performanceQualified: false,
      buildProof, artifactPrivacyQualified: false } : {}),
    run, status: 'INCOMPLETE', startedAtUtc: new Date(started).toISOString(),
    deadlineUtc: new Date(deadline).toISOString(), requests: [], readiness: [], failures: [] };
  const write = (name, data) => {
    const bytes = encodeSafeJson(data, canaries);
    fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
  };
  let connection;
  let networkCreated = false;
  let stage = 'preflight';
  const allocated = [];
  const check = () => assert.ok(Date.now() < workDeadline, 'Functional work cap; cleanup reserved');
  async function docker(args, cleanup = false, logs = false) {
    if (!cleanup) check();
    const remaining = (cleanup ? deadline : workDeadline) - Date.now();
    assert.ok(remaining > 0, 'Functional total cap');
    try {
      const result = await exec('docker', ['--context', 'desktop-linux', ...args], {
        cwd: root, env: environment, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
        timeout: Math.min(cleanup ? 10000 : 30000, remaining),
      });
      if (logs) {
        const separated = splitDockerLogOutput(result);
        toolConsole += '\n' + separated.tool;
        return separated.container;
      }
      toolConsole += '\n' + result.stdout + '\n' + result.stderr;
      return result.stdout.trim();
    } catch (error) {
      toolConsole += '\n' + (typeof error.stdout === 'string' ? error.stdout : '') +
        '\n' + (typeof error.stderr === 'string' ? error.stderr : '');
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
    for (const [role, image] of Object.entries({ app: appImage, pg: protocol.postgres })) {
      const row = JSON.parse(await docker(['image', 'inspect', '--format',
        '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}},"labels":{{json .Config.Labels}}}', image]));
      if (derived && role === 'app') derivedTool.verifyDerivedImage(row, buildProof);
      else assert.ok(row.digests.includes(image));
      assert.equal(row.os, 'linux');
      images[role] = { ...row, requested: image };
    }
    const routes = ['endpoint-create', 'endpoint-policy', 'group-create', 'group-patch',
      'group-missing-read', 'group-missing-patch', 'flush'];
    const requestIds = Object.fromEntries(routes.map(route => [route, crypto.randomUUID()]));
    const files = ['run-membership-privacy-functional.cjs', 'membership-statements.cjs', 'membership-privacy.cjs',
      'membership-statement-fixture.cjs', 'membership-history.cjs', 'membership-protocol.json',
      'membership-derived-functional.cjs'];
    const inspected = {};
    const legacyRoot = path.join(root, 'test-results/os07-functional-20261023/legacy-source');
    for (const file of ['logging/logging.service.js', 'logging/request-logging.interceptor.js',
      'filters/scim-exception.filter.js', 'endpoint-config.interface.js', 'dto/update-endpoint.dto.d.ts',
      'endpoint-profile/presets/rfc-standard.json', 'logging/scim-logger.service.js'])
      inspected[file] = digest(fs.readFileSync(path.join(legacyRoot, file)));
    const sourceCommit = await sourceTip(root);
    if (derived) assert.equal((await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim(), '',
      'Derived functional source must be committed and clean');
    const sourceByteIdentity = {};
    for (const file of files) {
      const disk = fs.readFileSync(path.join(__dirname, file));
      const git = Buffer.from((await exec('git', ['show', `${sourceCommit}:scripts/performance/${file}`],
        { cwd: root, timeout: 3000 })).stdout);
      sourceByteIdentity[file] = { onDiskSha256: digest(disk), gitSha256: digest(git),
        rawEqual: disk.equals(git),
        newlineNormalizedEqual: disk.toString('utf8').replace(/\r\n/g, '\n') === git.toString('utf8').replace(/\r\n/g, '\n') };
    }
    const manifest = { ...report, sourceTip: sourceCommit, sourceByteIdentity, images,
      inspectedLegacySourceHashes: inspected,
      client: { node: process.version, executableSha256: digest(fs.readFileSync(process.execPath)),
        pgVersion: require(path.join(root, 'api/node_modules/pg/package.json')).version },
      sourceHashes: Object.fromEntries(files.map(file => [file, digest(fs.readFileSync(path.join(__dirname, file)))])),
      sourceOnlyReviewSha256: digest(fs.readFileSync(path.join(root,
        'test-results/os07-functional-20261023/source-review-2.json'))),
      policy: { ...functionalPolicy, expectedAuthorizedRows: 4,
        workloadRoutes: routes.slice(2, 6), readinessRoute: '/scim/health',
        requestIdRequired: true, exactEndpointMethodRouteStatus: true,
        requestedServerPersistRequestSecrets: false, requestedEndpointPersistRequestSecrets: false,
        profilePreset: 'rfc-standard', appCpu: 0.5, appMemory: 1073741824,
        wallCapMs: 300000, cleanupReservationMs: 120000, flushDeadlineMs: 10000,
        performanceCycles: 0, statisticsExtension: false, rawPrivateExport: false },
      hypothesis: derived
        ? 'The sole approved logging backport should remove the known startup credential emission. With independently verified false server and endpoint persistence, all four correlated Group rows must retain exact masks and every generated credential must be absent from selected rows and separately collected app, PG and tool consoles. This qualifies only this immutable DERIVED artifact, not the production baseline or performance.'
        : 'With explicit false persistence, four known authorized Group rows remain masked. A generated-credential match may originate in application-container startup/migration output rather than Group authorization fields. Separate selected-row, application-container, PG-container and tool inputs plus static credential roles discriminate this; no specific emitter is presumed.',
      expectedCategories: ['All four masks remain mandatory', 'Any generated-credential match is INVALID',
        'Report every matching static source/kind and row index where applicable; never private text'],
      consoleProvenance: 'Docker logs --timestamps prefix identifies container records, not a particular application emitter. Unframed output and all non-log command output are tool-console. No console text is exported.',
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
      '--entrypoint', 'sh', appImage, '-c',
      'node node_modules/prisma/build/index.js migrate deploy >/dev/null && exec node dist/main.js']);
    const appPort = await docker(['port', names[1], '8080/tcp']);
    assert.match(appPort, /^127\.0\.0\.1:\d+$/);
    const base = `http://${appPort}`;
    let ready = false;
    for (let attempt = 0; attempt < functionalPolicy.maximumReadinessProbes; attempt++) {
      check();
      let status;
      try { status = (await fetch(`${base}/scim/health`, { signal: AbortSignal.timeout(1500) })).status; }
      catch (error) { if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error; }
      report.readiness.push({ attempt, status: status ?? null });
      if (status === 200) { ready = true; break; }
      await delay(functionalPolicy.readinessIntervalMs);
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
      assert.ok(report.requests.length < functionalPolicy.maximumAuthenticatedRequests, 'Authenticated request cap');
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
      derivedTool.maskPolicyPatch(), 200);
    report.actualEndpointPersistRequestSecrets = await policy();
    assert.equal(report.actualEndpointPersistRequestSecrets, false, 'Actual endpoint secret persistence');
    derivedTool.verifyMaskPolicy(report.application.persist, report.actualEndpointPersistRequestSecrets);
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
    const logArguments = derived ? ['logs', '--timestamps'] : ['logs', '--timestamps', '--tail', '300'];
    stage = 'app-console-capture';
    const privateConsole = await docker([...logArguments, names[1]], false, true);
    stage = 'pg-console-capture';
    const privatePgConsole = await docker([...logArguments, names[0]], false, true);
    stage = 'private-source-validation';
    report.privateSourcesCollected = ['selected-rows', 'app-console', 'pg-console', 'tool-console'];
    assertCanariesAbsent([
      ...rows.map((row, rowIndex) => ({ source: 'selected-rows', rowIndex, text: JSON.stringify(row) })),
      { source: 'app-console', text: privateConsole }, { source: 'pg-console', text: privatePgConsole },
      { source: 'tool-console', text: toolConsole },
    ], canaries);
    report.privacy = derived
      ? derivedTool.validateFunctionalPrivacy(rows, {
        'app-console': privateConsole, 'pg-console': privatePgConsole, 'tool-console': toolConsole,
      }, canaries)
      : validateLegacyPrivacy(rows, privateConsole, canaries, 4);
    report.status = derived ? 'DERIVED-FUNCTIONAL-PRIVACY-QUALIFIED' : 'FUNCTIONAL-COMPLETE';
  } catch (error) {
    report.status = 'INVALID';
    report.failures.push({ stage, code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : error.name,
      ...(error.code === 'DIAGNOSTIC_PRIVACY' ? { safeDetails: validateSafeFailure(error.safeDetails),
        safeFindings: error.safeFindings.map(validateSafeFailure) } : {}) });
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
    try { assertCanariesAbsent([{ source: 'tool-console', text: toolConsole }], canaries); }
    catch (error) {
      report.failures.push({ stage: 'tool-output-privacy', code: 'DIAGNOSTIC_PRIVACY',
        safeDetails: validateSafeFailure(error.safeDetails),
        safeFindings: error.safeFindings.map(validateSafeFailure) });
    }
    report.elapsedMs = Date.now() - started;
    if (derived && !derivedTool.completeOwnedCleanup(report.cleanup))
      report.failures.push({ stage: 'derived-cleanup-evidence', code: 'INCOMPLETE_CLEANUP_PROOF' });
    if (!report.cleanup.verified || report.remainingOwned !== '' || report.remainingNetworks !== '' ||
      report.elapsedMs > 300000 || report.failures.length) {
      report.status = 'INVALID';
      process.exitCode = 1;
    }
    if (derived) report.artifactPrivacyQualified = report.status === 'DERIVED-FUNCTIONAL-PRIVACY-QUALIFIED';
    if (writeFunctionalReport(write, report)) process.exitCode = 1;
    console.log(JSON.stringify({ status: report.status, run, requests: report.requests.length,
      elapsedMs: report.elapsedMs, cleanup: report.cleanup.verified }));
  }
}

module.exports = { verifyProvenance, readFunctionalResponse, splitDockerLogOutput, functionalPolicy,
  writeFunctionalReport };
if (require.main === module) main().catch(() => {
  console.error('Functional entry failed; private details withheld');
  process.exitCode = 1;
});
