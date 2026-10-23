const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, fork } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { schedule, runVisits, windowDelta, validateReceipt, validatePrivacy, finalizeOwned } = require('./membership-history.cjs');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const image = 'ghcr.io/pranems/scimserver@sha256:316a645f021b5c9b833c295d94248e7df00ee37aa13d6d5614e55f9f04c83a4b';
const protocol = require('./membership-protocol.json');
const owner = 'membership-history-diagnostic';
const seed = 20261023;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = file => sha(fs.readFileSync(file));
const save = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

async function main() {
  assert.deepEqual(process.argv.slice(2, 3), ['--diagnostic-only'], 'Explicit opt-in required');
  assert.equal(process.argv.length, 4, 'Supply one new output directory');
  assert.ok(!process.env.SCIM_BENCH_TRACE && !process.env.SCIM_BENCH_PROFILE &&
    !process.env.SCIM_BENCH_HISTORY && !process.env.NODE_OPTIONS, 'No inherited instrumentation');
  const directory = path.resolve(process.argv[3]);
  assert.ok(directory.startsWith(`${root}${path.sep}`), 'Evidence must remain in exclusive worktree');
  fs.mkdirSync(directory);
  const started = Date.now();
  const deadline = started + 60 * 60 * 1000;
  const run = crypto.randomUUID().replaceAll('-', '');
  const prefix = `scim-history-${run.slice(0, 12)}`;
  const network = `${prefix}-net`;
  const resources = [];
  const removed = new Set();
  const labels = ['--label', `scimserver.owner=${owner}`, '--label', `scimserver.run=${run}`];
  const credentials = Object.fromEntries(
    ['POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK']
      .map(key => [key, crypto.randomBytes(32).toString('hex')]));
  const environment = { ...process.env, ...credentials };
  const report = {
    run, status: 'INCOMPLETE', diagnosticOnly: true, admissionEligible: false,
    startedAtUtc: new Date(started).toISOString(), deadlineUtc: new Date(deadline).toISOString(),
    rounds: [], resourceEpochs: [], readiness: [], failures: [],
    limitation: 'Shared Windows/WSL Docker Desktop scheduling and caches; no dedicated host, per-request throttle attribution, causal independence or release acceptance.',
  };
  let networkCreated = false;
  let observer;
  let pg;
  let stage = 'identity-preflight';
  function checkDeadline() { assert.ok(Date.now() < deadline, 'Phase-one 60-minute work cap reached'); }
  async function docker(args, cleanup = false, combined = false) {
    if (!cleanup) checkDeadline();
    try {
      const result = await exec('docker', ['--context', 'desktop-linux', ...args], {
        cwd: root, env: environment, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
        timeout: cleanup ? 30000 : Math.max(1, Math.min(60000, deadline - Date.now())),
      });
      return (combined ? result.stdout + result.stderr : result.stdout).trim();
    } catch (error) {
      const failure = new Error(`Docker ${args[0]} failed (${error.code ?? error.signal ?? 'unknown'}); command output withheld for privacy`);
      failure.code = error.code;
      throw failure;
    }
  }
  async function inspect(id, cleanup = false) {
    const value = JSON.parse(await docker(['inspect', '--format',
      '{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State}},"labels":{{json .Config.Labels}},"nanoCpus":{{json .HostConfig.NanoCpus}},"memory":{{json .HostConfig.Memory}}}', id], cleanup));
    assert.equal(value.labels['scimserver.owner'], owner);
    assert.equal(value.labels['scimserver.run'], run);
    return value;
  }
  async function allocate(args) {
    const id = await docker(['run', '-d', ...labels, ...args]);
    assert.match(id, /^[a-f0-9]{64}$/);
    resources.push(id);
    return id;
  }
  async function remove(id) {
    if (removed.has(id)) return;
    await inspect(id, true);
    await docker(['rm', '-f', id], true);
    removed.add(id);
  }
  async function capture(app) {
    const before = process.hrtime.bigint();
    const startUtc = new Date().toISOString();
    const info = await inspect(app.id);
    assert.equal(info.state.Running, true);
    assert.equal(info.state.OOMKilled, false);
    const value = JSON.parse(await docker(['exec', observer, 'node',
      '/diagnostic/membership-history.cjs', '--collect', String(info.state.Pid), app.id]));
    value.hostRead = { startUtc, endUtc: new Date().toISOString(),
      elapsedMs: Number(process.hrtime.bigint() - before) / 1e6 };
    assert.equal(value.epoch, app.epoch, 'Application restarted during a round');
    return value;
  }
  async function launch(role, block, database) {
    const id = await allocate(['--network', network, '--publish', '127.0.0.1::8080',
      '--name', `${prefix}-${block}-${role}-${report.resourceEpochs.length}`,
      '--cpus', '0.5', '--memory', '1g',
      '--env', 'DATABASE_URL', ...Object.keys(credentials).filter(k => k !== 'POSTGRES_PASSWORD').flatMap(k => ['--env', k]),
      '--env', 'PERSISTENCE_BACKEND=prisma', '--env', 'NODE_ENV=production', '--env', 'PORT=8080',
      '--entrypoint', 'sh', image, '-c',
      'node node_modules/prisma/build/index.js migrate deploy >/dev/null && exec node dist/main.js']);
    let info = await inspect(id);
    assert.equal(info.nanoCpus, 500000000);
    assert.equal(info.memory, 1073741824);
    assert.equal(info.image, image.slice(image.indexOf('@') + 1));
    const port = await docker(['port', id, '8080/tcp']);
    assert.match(port, /^127\.0\.0\.1:\d+$/);
    const url = `http://${port}`;
    let ready = false;
    for (let attempt = 1; attempt <= 90; attempt++) {
      checkDeadline();
      let status = null;
      try { status = (await fetch(`${url}/scim/health`, { signal: AbortSignal.timeout(2000) })).status; }
      catch (error) {
        if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error;
      }
      report.readiness.push({ id, attempt, status, atUtc: new Date().toISOString() });
      if (status === 200) { ready = true; break; }
      await delay(1000);
    }
    assert.ok(ready, 'Owned application readiness exhausted');
    info = await inspect(id);
    const initial = JSON.parse(await docker(['exec', observer, 'node',
      '/diagnostic/membership-history.cjs', '--collect', String(info.state.Pid), id]));
    report.resourceEpochs.push({ id, block, role, database, imageId: info.image,
      nanoCpus: info.nanoCpus, memory: info.memory, epoch: initial.epoch, initial });
    return { id, url, epoch: initial.epoch };
  }
  async function round(app, block, role, visit) {
    const receiptName = `${block.name}-${visit}-${role}.json`;
    const receiptPath = path.join(directory, receiptName);
    const boundaries = {};
    const row = { block: block.name, history: block.history, order: block.order, role,
      visit, appId: app.id, epoch: app.epoch, receipt: receiptName, diagnosticOnly: true };
    report.rounds.push(row);
    let captureFailure;
    const child = fork(path.join(__dirname, 'benchmark-membership.cjs'), [], {
      cwd: root, silent: true, timeout: Math.max(1, deadline - Date.now() + 70000),
      env: { ...environment, SCIM_BENCH_BASE_URL: app.url, SCIM_BENCH_TOKEN: credentials.SCIM_SHARED_SECRET,
        SCIM_BENCH_VERSION: '0.55.60', SCIM_BENCH_OUTPUT: receiptPath,
        SCIM_BENCH_DEADLINE_UTC: String(deadline), SCIM_BENCH_TRACE: '1',
        SCIM_BENCH_HISTORY: '1', SCIM_BENCH_HISTORY_OWNER: owner },
    });
    child.stdout.resume();
    child.stderr.resume();
    child.on('message', async message => {
      try {
        assert.ok(['warmup-before', 'warmup-after', 'measured-before', 'measured-after'].includes(message.boundary));
        assert.ok(!Object.hasOwn(boundaries, message.boundary), 'Duplicate boundary');
        boundaries[message.boundary] = await capture(app);
        if (child.connected) child.send({ boundary: message.boundary, ok: true });
      } catch (error) {
        captureFailure = error;
        if (child.connected) child.send({ boundary: message.boundary, ok: false });
      }
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    row.exit = exit;
    row.boundaries = boundaries;
    save(path.join(directory, `${block.name}-${visit}-${role}-windows.json`), row);
    if (captureFailure) throw captureFailure;
    assert.equal(exit.code, 0, 'Benchmark child failed; original partial receipt retained');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    validateReceipt(receipt);
    row.warmup = windowDelta(boundaries['warmup-before'], boundaries['warmup-after']);
    row.measured = windowDelta(boundaries['measured-before'], boundaries['measured-after']);
    row.receiptSha256 = fileHash(receiptPath);
    row.tails = Object.fromEntries(Object.entries(receipt.samples).map(([op, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [op, Object.fromEntries([50, 95, 99].map(q => [`p${q}`, sorted[Math.ceil(q * sorted.length / 100) - 1]]))];
    }));
    row.complete = true;
    save(path.join(directory, `${block.name}-${visit}-${role}-summary.json`), row);
    console.log(`${block.name} visit ${visit} ${role}: 4407 checked requests, diagnostic only`);
  }
  try {
    assert.equal((await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(),
      'd25b6155bace7af2ec4ccb89f2eb0048e2db0c26', 'Expected consolidated starting source');
    const identities = {};
    for (const [name, ref] of Object.entries({ app: image, postgres: protocol.postgres })) {
      identities[name] = JSON.parse(await docker(['image', 'inspect', '--format',
        '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"architecture":{{json .Architecture}},"os":{{json .Os}}}', ref]));
      assert.ok(identities[name].digests.includes(ref));
      assert.equal(identities[name].os, 'linux');
    }
    const files = [
      'scripts/performance/run-membership-history.cjs', 'scripts/performance/membership-history.cjs',
      'scripts/performance/benchmark-membership.cjs', 'scripts/performance/membership-cpu-trace.cjs',
      'scripts/performance/membership-protocol.json', 'scripts/performance/run-membership-qualification.ps1',
      'scripts/performance/assess-membership.cjs', 'scripts/performance/membership-history-contract.ps1',
      'scripts/live-test-sections/minimal-group-members.ps1',
      'test-results/ip-address-security-20261023/publication-closeout.md',
    ];
    const manifest = {
      purpose: owner, diagnosticOnly: true, admissionEligible: false, run, seed, blocks: schedule(seed),
      version: '0.55.60', image, postgres: protocol.postgres, identities,
      sourceParent: 'd25b6155bace7af2ec4ccb89f2eb0048e2db0c26',
      appSource: '5bfff2dea1dec6f3e4b99c9a4cc0e6cb8e27388d', publicationRun: '39989347764',
      hashes: Object.fromEntries(files.map(file => [file, fileHash(path.join(root, file))])),
      client: { version: process.version, platform: process.platform, architecture: process.arch,
        executableSha256: fileHash(process.execPath) },
      policy: { cpu: 0.5, memory: 1073741824, rssCeiling: 402653184,
        cpuMax: '50000 100000', cpuBurst: 0, finiteAncestorQuota: 'reject',
        warmupCycles: 100, measuredCycles: 1000, requestsPerRound: 4407, samples: 64000,
        wallMinutes: 60, phaseTwo: false, freshPostgres: false,
        resetSharedStatistics: false, forcedGc: false, instrumentation: 'boundary-only IPC',
        processContrast: 'restart scheduled application only versus retained role processes',
        readinessAndObserverRequests: 'separate report arrays; not workload requests',
        windows: 'warmup and measured read intervals include boundary overhead and background work',
        timingClient: 'host native Node, explicit identity; not old Linux client/admission evidence' },
      host: JSON.parse(await docker(['info', '--format',
        '{"serverVersion":{{json .ServerVersion}},"os":{{json .OperatingSystem}},"cpus":{{json .NCPU}},"memory":{{json .MemTotal}}}'])),
      startedAtUtc: report.startedAtUtc, deadlineUtc: report.deadlineUtc,
    };
    save(path.join(directory, 'preregistered-plan.json'), manifest);
    stage = 'owned-topology';
    await docker(['network', 'create', ...labels, network]);
    networkCreated = true;
    observer = await allocate(['--name', `${prefix}-observer`, '--network', 'none', '--pid', 'host',
      '--cgroupns', 'host', '--mount', 'type=bind,source=/sys/fs/cgroup,target=/host-cgroup,readonly',
      '--mount', `type=bind,source=${__dirname},target=/diagnostic,readonly`,
      '--entrypoint', 'node', image, '-e', 'setInterval(()=>{},3600000)']);
    pg = await allocate(['--name', `${prefix}-pg`, '--network', network, '--network-alias', 'database',
      '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data',
      '--env', 'POSTGRES_USER=scim', '--env', 'POSTGRES_PASSWORD',
      '--env', 'POSTGRES_DB=postgres', protocol.postgres]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = JSON.parse(await docker(['exec', pg, 'pg_isready', '-U', 'scim', '-d', 'postgres']
        .map(String)).then(() => '{"ready":true}', () => '{"ready":false}'));
      report.readiness.push({ id: pg, attempt, ready: state.ready, atUtc: new Date().toISOString() });
      if (state.ready) { ready = true; break; }
      await delay(500);
    }
    assert.ok(ready, 'Owned PostgreSQL readiness exhausted');
    report.postgres = { id: pg, state: (await inspect(pg)).state,
      version: await docker(['exec', pg, 'postgres', '--version']) };
    const sourceIdentity = await docker(['exec', observer, 'node', '-e',
      "const fs=require('fs'),c=require('crypto'),p=require('path');function h(d){const x=c.createHash('sha256');function w(q){for(const n of fs.readdirSync(q).sort()){const f=p.join(q,n);if(fs.statSync(f).isDirectory())w(f);else{x.update(p.relative(d,f));x.update(fs.readFileSync(f));}}}w(d);return x.digest('hex');}console.log(JSON.stringify({version:require('/app/package.json').version,dist:h('/app/dist'),fixture:h('/app/prisma')}));"]);
    report.imageSourceIdentity = JSON.parse(sourceIdentity);
    assert.equal(report.imageSourceIdentity.version, '0.55.60');
    save(path.join(directory, 'image-source-identity.json'), report.imageSourceIdentity);
    manifest.imageSourceIdentity = report.imageSourceIdentity;
    manifest.postgresEpoch = report.postgres;
    manifest.frozenAtUtc = new Date().toISOString();
    save(path.join(directory, 'manifest.json'), manifest);
    report.manifestSha256 = fileHash(path.join(directory, 'manifest.json'));
    for (const [blockIndex, block] of schedule(seed).entries()) {
      stage = `block:${block.name}`;
      const databases = { A: `h${blockIndex}a`, B: `h${blockIndex}b` };
      const apps = {};
      for (const role of ['A', 'B']) {
        const database = databases[role];
        await docker(['exec', pg, 'psql', '-U', 'scim', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
          '-c', `CREATE DATABASE ${database}`]);
        await docker(['exec', pg, 'psql', '-U', 'scim', '-d', database, '-v', 'ON_ERROR_STOP=1',
          '-c', 'CREATE EXTENSION citext; CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm; CREATE EXTENSION "uuid-ossp";']);
        environment.DATABASE_URL = `postgresql://scim:${credentials.POSTGRES_PASSWORD}@database:5432/${database}`;
        apps[role] = await launch(role, block.name, database);
      }
      await runVisits(block, apps, {
        checkDeadline,
        async restart(role, previous) {
          await remove(previous.id);
          environment.DATABASE_URL = `postgresql://scim:${credentials.POSTGRES_PASSWORD}@database:5432/${databases[role]}`;
          const next = await launch(role, block.name, databases[role]);
          assert.notEqual(next.epoch, previous.epoch);
          return next;
        },
        visit: (app, role, visit) => round(app, block, role, visit),
      });
      stage = `privacy:${block.name}`;
      checkDeadline();
      await exec('pwsh', ['-NoProfile', '-File', path.join(__dirname, 'membership-history-contract.ps1'),
        '-BaseUrl', apps.B.url, '-OutputPath', path.join(directory, `${block.name}-contract.json`)], {
        cwd: root, env: environment, timeout: Math.min(120000, deadline - Date.now()),
      });
      const flushed = await fetch(`${apps.B.url}/scim/admin/logs/flush`, {
        method: 'POST', headers: { Authorization: `Bearer ${credentials.SCIM_SHARED_SECRET}` },
        signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now()))),
      });
      assert.ok(flushed.ok, 'Original buffered log flush');
      const sql = 'SELECT COALESCE(json_agg(r),\'[]\') FROM (SELECT "requestId","endpointId",status,"durationMs","requestHeaders","responseHeaders","requestBody","responseBody","authDecision" FROM "RequestLog" WHERE url LIKE \'%/Groups%\' AND (status >= 400 OR method = \'PATCH\') ORDER BY "createdAt" DESC LIMIT 200) r';
      const logs = JSON.parse(await docker(['exec', pg, 'psql', '-U', 'scim', '-d', databases.B, '-tAc', sql]));
      const consoleLog = await docker(['logs', '--tail', '300', apps.B.id], false, true);
      save(path.join(directory, `${block.name}-privacy.json`),
        validatePrivacy(logs, consoleLog, Object.values(credentials)));
      for (const role of ['A', 'B']) await remove(apps[role].id);
      const currentPg = await inspect(pg);
      assert.equal(currentPg.state.StartedAt, report.postgres.state.StartedAt, 'PostgreSQL lifetime changed');
    }
    assert.equal(report.rounds.filter(r => r.complete).length, 16);
    report.status = 'DIAGNOSTIC-COMPLETE';
  } catch (error) {
    report.status = 'INVALID';
    report.failures.push({ stage, name: error.name, message: error.message,
      stack: error.stack?.split('\n').slice(0, 7).join('\n') });
    process.exitCode = 1;
    console.error(`Diagnostic INVALID at ${stage}: ${error.message}`);
  } finally {
    try {
      const owned = await docker(['ps', '-aq', '--no-trunc', '--filter', `label=scimserver.run=${run}`], true);
      for (const id of owned.split('\n').filter(Boolean)) {
        assert.match(id, /^[a-f0-9]{64}$/);
        if (!resources.includes(id)) resources.push(id);
      }
    } catch {
      report.failures.push({ stage: 'cleanup-discovery', message: 'Owned inventory discovery failed; known IDs still attempted' });
      report.status = 'INVALID';
      process.exitCode = 1;
    }
    report.cleanup = await finalizeOwned(resources, {
      async capture(id) { if (!removed.has(id)) report.resourceEpochs.push({ final: await inspect(id, true) }); },
      remove,
      async verify(id) {
        const ids = await docker(['ps', '-aq', '--no-trunc', '--filter', `label=scimserver.run=${run}`], true);
        return !ids.split('\n').includes(id);
      },
    });
    if (networkCreated) {
      try {
        const labelsFound = JSON.parse(await docker(['network', 'inspect', '--format', '{{json .Labels}}', network], true));
        assert.equal(labelsFound['scimserver.run'], run);
        assert.equal(labelsFound['scimserver.owner'], owner);
        await docker(['network', 'rm', network], true);
        const found = await docker(['network', 'ls', '-q', '--filter', `label=scimserver.run=${run}`], true);
        assert.equal(found, '');
        report.cleanup.networkVerified = true;
      } catch { report.cleanup.networkVerified = false; }
    }
    report.finishedAtUtc = new Date().toISOString();
    if (!report.cleanup.verified || report.cleanup.rows.some(row => !row.capture) ||
        (networkCreated && !report.cleanup.networkVerified)) {
      report.status = 'INVALID';
      process.exitCode = 1;
    }
    save(path.join(directory, 'report.json'), report);
    console.log(`${report.status}; ${report.rounds.filter(r => r.complete).length}/16 complete rounds; owned cleanup=${report.cleanup.verified}`);
  }
}

if (require.main === module) main().catch(error => {
  console.error(`Diagnostic startup failed: ${error.message}`);
  process.exitCode = 1;
});
