const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn, fork } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { ObserverChannel } = require('./membership-observer.cjs');
const { sourceTip, windowDelta, validateReceipt, validatePrivacy, finalizeOwned, runVisits } = require('./membership-history.cjs');
const { statementDelta, summarizeStatements } = require('./membership-statements.cjs');
const fixture = require('./membership-statement-fixture.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const protocol = require('./membership-protocol.json');
const roles = {
  A: { version: '0.55.20', image: protocol.baseline.image },
  B: { version: '0.55.60', image: 'ghcr.io/pranems/scimserver@sha256:316a645f021b5c9b833c295d94248e7df00ee37aa13d6d5614e55f9f04c83a4b' },
};
const blocks = ['BAAB', 'ABBA'].map(order => ({ name: order.toLowerCase(),
  order, history: 'reused', visits: [...order] }));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const distributionHashScript = `const fs=require('fs'),c=require('crypto'),p=require('path');
function hash(d){const h=c.createHash('sha256');function walk(q){for(const n of fs.readdirSync(q).sort()){
const f=p.join(q,n);if(fs.statSync(f).isDirectory())walk(f);else{h.update(p.relative(d,f));h.update(fs.readFileSync(f));}}}
walk(d);return h.digest('hex');}
console.log(JSON.stringify({version:require('/app/package.json').version,dist:hash('/app/dist'),fixture:hash('/app/prisma')}));`;

async function main() {
  assert.equal(process.argv[2], '--diagnostic-only', 'Explicit statement diagnostic opt-in required');
  assert.equal(process.argv.length, 4);
  assert.ok(!process.env.NODE_OPTIONS && !process.env.SCIM_BENCH_HISTORY && !process.env.SCIM_BENCH_PROFILE);
  const directory = path.resolve(process.argv[3]);
  assert.ok(directory.startsWith(root + path.sep));
  fs.mkdirSync(directory);
  const started = Date.now();
  const deadline = started + 45 * 60000;
  const workDeadline = deadline - 90000;
  const run = crypto.randomUUID().replaceAll('-', '');
  const owner = 'membership-statement-diagnostic';
  const prefix = `scim-statements-${run.slice(0, 12)}`;
  const network = `${prefix}-net`;
  const resources = [];
  const images = {};
  const removed = new Set();
  const labels = ['--label', `scimserver.owner=${owner}`, '--label', `scimserver.run=${run}`];
  const credentials = Object.fromEntries(['POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET',
    'JWT_SECRET', 'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK'].map(key => [key, crypto.randomBytes(32).toString('hex')]));
  const passwords = Object.fromEntries(['a', 'b', 'observer'].map(key => [key, crypto.randomBytes(32).toString('hex')]));
  const environment = { ...process.env, ...credentials };
  const report = { family: owner, diagnosticOnly: true, admissionEligible: false,
    status: 'INCOMPLETE', run, startedAtUtc: new Date(started).toISOString(),
    deadlineUtc: new Date(deadline).toISOString(), rounds: [], epochs: [], readiness: [], failures: [] };
  let networkCreated = false;
  let channel;
  let admin;
  let statistics;
  let stage = 'preflight';
  const checkDeadline = () => assert.ok(Date.now() < workDeadline, 'Phase-two work cap; cleanup reservation begins');
  async function docker(args, cleanup = false, combined = false) {
    if (!cleanup) checkDeadline();
    try {
      const row = await exec('docker', ['--context', 'desktop-linux', ...args], {
        cwd: root, env: environment, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
        timeout: cleanup ? 15000 : Math.max(1, Math.min(60000, workDeadline - Date.now())),
      });
      return (combined ? row.stdout + row.stderr : row.stdout).trim();
    } catch (error) { throw new Error(`Owned Docker ${args[0]} failed (${error.code || error.signal}); output withheld`); }
  }
  async function allocate(args) {
    const id = await docker(['run', '-d', ...labels, ...args]);
    assert.match(id, /^[a-f0-9]{64}$/);
    resources.push(id);
    return id;
  }
  async function inspect(id, cleanup = false) {
    const row = JSON.parse(await docker(['inspect', '--format',
      '{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State}},"labels":{{json .Config.Labels}},"nanoCpus":{{json .HostConfig.NanoCpus}},"memory":{{json .HostConfig.Memory}}}', id], cleanup));
    assert.equal(row.labels['scimserver.owner'], owner);
    assert.equal(row.labels['scimserver.run'], run);
    return row;
  }
  async function remove(id) {
    if (removed.has(id)) return;
    await inspect(id, true);
    await docker(['rm', '-f', id], true);
    removed.add(id);
  }
  async function launch(role, block, target) {
    environment.DATABASE_URL = `postgresql://${target.role}:${passwords[role.toLowerCase()]}@database:5432/${target.database}`;
    const id = await allocate(['--name', `${prefix}-${block}-${role}`, '--network', network,
      '--publish', '127.0.0.1::8080', '--cpus', '0.5', '--memory', '1g',
      '--env', 'DATABASE_URL', ...Object.keys(credentials).filter(key => key !== 'POSTGRES_PASSWORD').flatMap(key => ['--env', key]),
      '--env', 'PERSISTENCE_BACKEND=prisma', '--env', 'NODE_ENV=production', '--env', 'PORT=8080',
      '--entrypoint', 'sh', roles[role].image, '-c',
      'node node_modules/prisma/build/index.js migrate deploy >/dev/null && exec node dist/main.js']);
    const port = await docker(['port', id, '8080/tcp']);
    assert.match(port, /^127\.0\.0\.1:\d+$/);
    const url = `http://${port}`;
    let ready = false;
    for (let attempt = 1; attempt <= 90; attempt++) {
      checkDeadline();
      let status = null;
      try { status = (await fetch(`${url}/scim/health`, { signal: AbortSignal.timeout(2000) })).status; }
      catch (error) { if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error; }
      report.readiness.push({ id, attempt, status, atUtc: new Date().toISOString() });
      if (status === 200) { ready = true; break; }
      await delay(1000);
    }
    assert.ok(ready, 'Owned app readiness failed');
    const info = await inspect(id);
    assert.equal(info.state.Running, true);
    assert.equal(info.state.OOMKilled, false);
    assert.equal(info.nanoCpus, 500000000);
    assert.equal(info.memory, 1073741824);
    assert.equal(info.image, images[role].id, 'Actual platform image ID must match cached digest resolution');
    const initial = await channel.request({ kind: 'bind', id, pid: String(info.state.Pid) });
    const distribution = JSON.parse(await docker(['exec', id, 'node', '-e', distributionHashScript]));
    assert.equal(distribution.version, roles[role].version);
    report.epochs.push({ id, block, role, target, imageId: info.image,
      initial, distribution, configuredCpu: info.nanoCpus, configuredMemory: info.memory });
    return { id, role, url, target, epoch: initial.epoch, distribution };
  }
  async function boundary(app) {
    checkDeadline();
    const startUtc = new Date().toISOString();
    const start = process.hrtime.bigint();
    const cpu = await channel.request({ kind: 'snapshot', id: app.id });
    assert.equal(cpu.epoch, app.epoch);
    const pg = await fixture.captureStatements(statistics.observer, app.target, statistics.columns);
    const result = { cpu, pg, hostRead: { startUtc, endUtc: new Date().toISOString(),
      elapsedMs: Number(process.hrtime.bigint() - start) / 1e6 } };
    const encoded = JSON.stringify(result);
    for (const secret of [...Object.values(credentials), ...Object.values(passwords)])
      assert.ok(!encoded.includes(secret), 'Private collector canary leaked');
    return result;
  }
  async function round(app, block, role, visit) {
    const name = `${block.name}-${visit}-${role}`;
    const output = path.join(directory, `${name}.json`);
    const row = { block: block.name, order: block.order, role, visit,
      version: roles[role].version, image: roles[role].image, appId: app.id,
      epoch: app.epoch, receipt: `${name}.json`, boundaries: {}, complete: false };
    report.rounds.push(row);
    const child = fork(path.join(__dirname, 'benchmark-membership.cjs'), [], {
      cwd: root, silent: true, timeout: Math.max(1, workDeadline - Date.now() + 70000),
      env: { ...environment, SCIM_BENCH_BASE_URL: app.url, SCIM_BENCH_TOKEN: credentials.SCIM_SHARED_SECRET,
        SCIM_BENCH_VERSION: roles[role].version, SCIM_BENCH_OUTPUT: output,
        SCIM_BENCH_DEADLINE_UTC: String(workDeadline), SCIM_BENCH_TRACE: '1',
        SCIM_BENCH_HISTORY: '1', SCIM_BENCH_HISTORY_OWNER: 'membership-history-diagnostic' },
    });
    child.stdout.resume();
    child.stderr.resume();
    let failure;
    let active = false;
    const expected = ['warmup-before', 'warmup-after', 'measured-before', 'measured-after'];
    child.on('message', async message => {
      try {
        assert.equal(active, false, 'Overlapping workload boundary');
        assert.equal(message.boundary, expected[Object.keys(row.boundaries).length]);
        active = true;
        row.boundaries[message.boundary] = await boundary(app);
        active = false;
        if (child.connected) child.send({ boundary: message.boundary, ok: true });
      } catch (error) {
        failure = error;
        if (child.connected) child.send({ boundary: message.boundary, ok: false });
      }
    });
    row.exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    write(path.join(directory, `${name}-windows.json`), row);
    if (failure) throw failure;
    assert.equal(row.exit.code, 0, 'Original workload failed; partial receipt retained');
    const receipt = JSON.parse(fs.readFileSync(output));
    validateReceipt(receipt, roles[role].version);
    row.receiptSha256 = hash(fs.readFileSync(output));
    for (const phase of ['warmup', 'measured']) {
      const before = row.boundaries[`${phase}-before`];
      const after = row.boundaries[`${phase}-after`];
      row[phase] = { cpu: windowDelta(before.cpu, after.cpu),
        pg: statementDelta(before.pg.snapshot, after.pg.snapshot, statistics.columns) };
      row[phase].fingerprints = summarizeStatements(row[phase].pg.statements);
    }
    row.tails = Object.fromEntries(Object.entries(receipt.samples).map(([op, samples]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return [op, Object.fromEntries([50, 95, 99].map(q => [`p${q}`,
        sorted[Math.ceil(q * sorted.length / 100) - 1]]))];
    }));
    row.complete = true;
    write(path.join(directory, `${name}-summary.json`), row);
    console.log(`${name}: 4407 original checked requests; diagnostic-only statement windows retained`);
  }
  try {
    const smoke = JSON.parse(fs.readFileSync(path.join(root, 'test-results/observer-stream-20261023/smoke/report.json')));
    assert.equal(smoke.status, 'OBSERVER-SMOKE-COMPLETE');
    assert.equal(smoke.snapshots.length, 32);
    assert.ok(smoke.latency.medianMs <= 250 && smoke.latency.p95Ms <= 1000);
    assert.equal(smoke.restart.detected, true);
    assert.equal(smoke.remainingOwned, '');
    const pgProbeBytes = fs.readFileSync(path.join(root,
      'test-results/observer-stream-20261023/pg-capability-probe.json'));
    const pgProbe = JSON.parse(pgProbeBytes);
    assert.equal(pgProbe.exit, 0);
    assert.equal(pgProbe.image, protocol.postgres);
    const librarySha256 = pgProbe.output[1].split(' ')[0];
    assert.match(librarySha256, /^[a-f0-9]{64}$/);
    for (const [name, image] of Object.entries({ A: roles.A.image, B: roles.B.image, postgres: protocol.postgres })) {
      images[name] = JSON.parse(await docker(['image', 'inspect', '--format',
        '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}}}', image]));
      assert.ok(images[name].digests.includes(image));
      assert.equal(images[name].os, 'linux');
    }
    const files = ['run-membership-statements.cjs', 'membership-statement-fixture.cjs',
      'membership-statements.cjs', 'membership-observer.cjs', 'membership-history.cjs',
      'membership-cpu-trace.cjs', 'benchmark-membership.cjs', 'membership-protocol.json',
      'membership-history-contract.ps1'];
    const manifest = { family: owner, diagnosticOnly: true, admissionEligible: false,
      run, roles, blocks, images, sourceTip: await sourceTip(root),
      sourceHashes: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))])),
      client: { node: process.version, platform: process.platform, executableSha256: hash(fs.readFileSync(process.execPath)),
        pgVersion: require(path.join(root, 'api/node_modules/pg/package.json')).version,
        pgEntrySha256: hash(fs.readFileSync(require.resolve('pg', { paths: [path.join(root, 'api')] }))) },
      observerSmokeManifestSha256: smoke.manifestSha256,
      postgresLibraryProbe: { receiptSha256: hash(pgProbeBytes), librarySha256,
        provenance: 'Prior disposable probe of the same exact cached PostgreSQL image' },
      policy: { rounds: 8, warmupCycles: 100, measuredCycles: 1000, operations: 4,
        requestsPerRound: 4407, timingSamples: 32000, appCpu: 0.5, memory: 1073741824,
        rssCeiling: 402653184, cpuMax: '50000 100000', cpuBurst: 0,
        finiteAncestorQuota: 'reject', wallCapMinutes: 45, cleanupReservationMs: 90000,
        history: 'reused two-app block, new equivalent role databases each block',
        statistics: 'NEW owned PG fixture, preload pg_stat_statements, compute_query_id=on, track=all',
        statsReset: false, eviction: 'invalidate', collection: 'persistent pipe CPU then persistent native pg connection',
        legacyContract: 'Original 4407 checked requests per round; no current-only minimal-members assertions',
        currentContract: 'Original checked workload plus 66-outcome current runtime contract after each block',
        forcedGc: false, queryTextExported: false, phaseOneReinterpretation: false },
      startedAtUtc: report.startedAtUtc, deadlineUtc: report.deadlineUtc };
    write(path.join(directory, 'preregistered-plan.json'), manifest);
    await docker(['network', 'create', ...labels, network]);
    networkCreated = true;
    const observer = await allocate(['--name', `${prefix}-observer`, '--network', 'none',
      '--read-only', '--no-healthcheck', '--pid', 'host', '--cgroupns', 'host',
      '--mount', 'type=bind,source=/sys/fs/cgroup,target=/host-cgroup,readonly',
      '--mount', `type=bind,source=${__dirname},target=/diagnostic,readonly`,
      '--entrypoint', 'node', roles.B.image, '-e', 'setInterval(()=>{},3600000)']);
    channel = new ObserverChannel(spawn('docker', ['--context', 'desktop-linux', 'exec', '-i',
      observer, 'node', '/diagnostic/membership-observer.cjs', '--serve', run],
    { cwd: root, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), run, 3000);
    const pg = await allocate(['--name', `${prefix}-pg`, '--network', network, '--network-alias', 'database',
      '--publish', '127.0.0.1::5432', '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data',
      '--env', 'POSTGRES_USER=scim', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=postgres',
      protocol.postgres, '-c', 'shared_preload_libraries=pg_stat_statements',
      '-c', 'compute_query_id=on', '-c', 'pg_stat_statements.track=all']);
    const port = await docker(['port', pg, '5432/tcp']);
    assert.match(port, /^127\.0\.0\.1:\d+$/);
    const pgPort = Number(port.split(':')[1]);
    stage = 'owned-pg-capability';
    for (let attempt = 0; attempt < 30; attempt++) {
      checkDeadline();
      admin = fixture.client({ port: pgPort, user: 'scim', password: credentials.POSTGRES_PASSWORD,
        application_name: 'scim-statement-fixture-admin' });
      try { await admin.connect(); break; }
      catch (error) {
        await admin.end();
        if (!['ECONNREFUSED', '57P03'].includes(error.code)) throw error;
        if (attempt === 29) throw error;
        await delay(500);
      }
    }
    statistics = await fixture.initialize(admin, pgPort, passwords);
    report.postgres = { id: pg, initial: await inspect(pg), capability: statistics.capability,
      availableCounters: statistics.columns };
    manifest.postgres = report.postgres;
    for (const [index, block] of blocks.entries()) {
      stage = `block-${block.name}`;
      const apps = {};
      for (const role of ['A', 'B']) {
        const target = await fixture.createDatabase(admin, pgPort, index, role);
        apps[role] = await launch(role, block.name, target);
        const canaryClient = fixture.client({ port: pgPort, database: target.database,
          user: target.role, password: passwords[role.toLowerCase()] });
        try {
          await canaryClient.connect();
          await canaryClient.query('SELECT $1::text AS diagnostic_private_canary', [credentials.JWT_SECRET]);
        } finally { await canaryClient.end(); }
        const canary = await boundary(apps[role]);
        assert.ok(canary.pg.snapshot.entries.length > 0);
        write(path.join(directory, `${block.name}-${role}-privacy-canary.json`), {
          diagnosticOnly: true, queryTextExported: false, secretAbsent: true,
          snapshot: canary.pg.snapshot, collectorHostRead: canary.hostRead });
      }
      if (index === 0) {
        manifest.appDistributions = Object.fromEntries(Object.entries(apps).map(([role, app]) => [role, app.distribution]));
        manifest.client.loadedModuleHashes = Object.fromEntries(Object.keys(require.cache)
          .filter(file => file.startsWith(path.join(root, 'api/node_modules') + path.sep))
          .sort().map(file => [path.relative(root, file), hash(fs.readFileSync(file))]));
        manifest.frozenAtUtc = new Date().toISOString();
        write(path.join(directory, 'manifest.json'), manifest);
        report.manifestSha256 = hash(fs.readFileSync(path.join(directory, 'manifest.json')));
        fs.mkdirSync(path.join(directory, 'frozen-inputs'));
        for (const file of files) {
          fs.copyFileSync(path.join(__dirname, file), path.join(directory, 'frozen-inputs', file));
          assert.equal(hash(fs.readFileSync(path.join(directory, 'frozen-inputs', file))), manifest.sourceHashes[file]);
        }
      } else {
        for (const role of ['A', 'B']) assert.deepEqual(apps[role].distribution, manifest.appDistributions[role]);
      }
      await runVisits(block, apps, { checkDeadline, restart() { throw Error('No restart scheduled'); },
        visit: (app, role, visit) => round(app, block, role, visit) });
      stage = `contract-${block.name}`;
      await exec('pwsh', ['-NoProfile', '-File', path.join(__dirname, 'membership-history-contract.ps1'),
        '-BaseUrl', apps.B.url, '-OutputPath', path.join(directory, `${block.name}-current-contract.json`)],
      { cwd: root, env: environment, timeout: Math.max(1, Math.min(120000, workDeadline - Date.now())) });
      for (const role of ['A', 'B']) {
        const app = apps[role];
        const headers = { Authorization: `Bearer ${credentials.SCIM_SHARED_SECRET}` };
        const flushed = await fetch(`${app.url}/scim/admin/logs/flush`,
          { method: 'POST', headers, signal: AbortSignal.timeout(10000) });
        assert.ok(flushed.ok, 'Original buffered log flush');
        const privateClient = fixture.client({ port: pgPort, database: app.target.database,
          user: 'scim', password: credentials.POSTGRES_PASSWORD });
        let logs;
        try {
          await privateClient.connect();
          logs = (await privateClient.query(`SELECT "requestId","endpointId",status,
            "durationMs","requestHeaders" FROM "RequestLog"
            WHERE url LIKE '%/Groups%' AND (status >= 400 OR method='PATCH')
            ORDER BY "createdAt" DESC LIMIT 200`)).rows;
        } finally { await privateClient.end(); }
        const consoleLog = await docker(['logs', '--tail', '300', app.id], false, true);
        const secrets = [...Object.values(credentials), ...Object.values(passwords)];
        let privacy;
        if (role === 'B') privacy = validatePrivacy(logs, consoleLog, secrets);
        else {
          assert.equal(logs.length, 200);
          for (const secret of secrets)
            assert.ok(!JSON.stringify(logs).includes(secret) && !consoleLog.includes(secret), 'Legacy credential leaked');
          for (const row of logs) assert.equal(JSON.parse(row.requestHeaders).authorization, '[REDACTED]');
          privacy = { diagnosticOnly: true, complete: true, validatedRows: logs.length,
            contract: 'Legacy redaction only; no current-only error categorization assertion', rawLogsExported: false };
        }
        write(path.join(directory, `${block.name}-${role}-privacy.json`), privacy);
        await remove(app.id);
      }
      const current = await inspect(pg);
      assert.equal(current.state.StartedAt, report.postgres.initial.state.StartedAt);
    }
    assert.equal(report.rounds.filter(row => row.complete).length, 8);
    report.status = 'STATEMENT-DIAGNOSTIC-COMPLETE';
  } catch (error) {
    report.status = 'INVALID';
    report.failures.push({ stage, code: error.code || error.name,
      message: error.code ? 'PG/child operation failed; raw text withheld for privacy' : error.message,
      causalFrames: error.stack?.split('\n').slice(1, 7) });
    process.exitCode = 1;
  } finally {
    for (const [name, connection] of [['observer', statistics?.observer], ['admin', admin]]) {
      if (!connection) continue;
      try { await connection.end(); }
      catch (error) {
        report.failures.push({ stage: `close-${name}`, code: error.code || error.name });
        report.status = 'INVALID';
      }
    }
    if (channel) {
      report.observerClose = await channel.close();
      if (channel.failure || report.observerClose.code !== 0) report.status = 'INVALID';
    }
    try {
      const ids = await docker(['ps', '-aq', '--no-trunc', '--filter', `label=scimserver.run=${run}`], true);
      for (const id of ids.split('\n').filter(Boolean)) {
        assert.match(id, /^[a-f0-9]{64}$/);
        if (!resources.includes(id)) resources.push(id);
      }
    } catch { report.discoveryFailed = true; report.status = 'INVALID'; }
    report.cleanup = await finalizeOwned(resources, {
      async capture(id) { if (!removed.has(id)) await inspect(id, true); },
      remove,
      async verify(id) {
        return !(await docker(['ps', '-aq', '--no-trunc', '--filter', `label=scimserver.run=${run}`], true))
          .split('\n').includes(id);
      },
    });
    try {
      report.remainingOwned = await docker(['ps', '-aq', '--no-trunc',
        '--filter', `label=scimserver.run=${run}`], true);
      assert.equal(report.remainingOwned, '', 'Final owner inventory must be empty');
    } catch { report.status = 'INVALID'; }
    if (networkCreated) {
      try {
        const found = JSON.parse(await docker(['network', 'inspect', '--format', '{{json .Labels}}', network], true));
        assert.equal(found['scimserver.run'], run);
        assert.equal(found['scimserver.owner'], owner);
        await docker(['network', 'rm', network], true);
        assert.equal(await docker(['network', 'ls', '-q', '--filter', `label=scimserver.run=${run}`], true), '');
        report.cleanup.networkVerified = true;
      } catch { report.cleanup.networkVerified = false; report.status = 'INVALID'; }
    }
    report.elapsedMsIncludingCleanup = Date.now() - started;
    report.finishedAtUtc = new Date().toISOString();
    if (!report.cleanup.verified || report.cleanup.rows.some(row => !row.capture) ||
        report.elapsedMsIncludingCleanup > 45 * 60000) report.status = 'INVALID';
    write(path.join(directory, 'report.json'), report);
    if (report.status !== 'STATEMENT-DIAGNOSTIC-COMPLETE') process.exitCode = 1;
    console.log(JSON.stringify({ status: report.status, rounds: report.rounds.filter(row => row.complete).length,
      elapsedMsIncludingCleanup: report.elapsedMsIncludingCleanup,
      cleanup: report.cleanup.verified, failures: report.failures }));
  }
}

module.exports = { blocks, roles };
if (require.main === module) main().catch(error => {
  console.error(`Statement diagnostic startup failed (${error.code || error.name}); details withheld`);
  process.exitCode = 1;
});
