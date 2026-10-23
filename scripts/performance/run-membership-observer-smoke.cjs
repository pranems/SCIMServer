const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { ObserverChannel } = require('./membership-observer.cjs');
const { validateSnapshot, windowDelta, sourceTip } = require('./membership-history.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const image = 'ghcr.io/pranems/scimserver@sha256:316a645f021b5c9b833c295d94248e7df00ee37aa13d6d5614e55f9f04c83a4b';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function main() {
  assert.equal(process.argv[2], '--diagnostic-only');
  assert.equal(process.argv.length, 4);
  assert.ok(!process.env.NODE_OPTIONS, 'No inherited instrumentation');
  const directory = path.resolve(process.argv[3]);
  assert.ok(directory.startsWith(root + path.sep));
  fs.mkdirSync(directory);
  const start = Date.now();
  const deadline = start + 180000;
  const workDeadline = deadline - 60000;
  const run = crypto.randomUUID().replaceAll('-', '');
  const owner = 'membership-observer-smoke';
  const resources = [];
  const labels = ['--label', `scimserver.owner=${owner}`, '--label', `scimserver.run=${run}`];
  const report = { family: owner, diagnosticOnly: true, admissionEligible: false,
    run, startedAtUtc: new Date(start).toISOString(), snapshots: [], cleanup: [],
    status: 'INCOMPLETE', workloadRequests: 0 };
  let channel;
  async function docker(args, cleanup = false) {
    assert.ok(cleanup || Date.now() < workDeadline, 'Smoke work budget exhausted');
    try {
      return (await exec('docker', ['--context', 'desktop-linux', ...args], {
        cwd: root, windowsHide: true, maxBuffer: 131072,
        timeout: cleanup ? 15000 : Math.max(1, Math.min(30000, workDeadline - Date.now())),
      })).stdout.trim();
    } catch (error) {
      throw new Error(`Owned Docker ${args[0]} failed (${error.code || error.signal}); output withheld`);
    }
  }
  async function allocate(args) {
    const id = await docker(['run', '-d', ...labels, ...args]);
    assert.match(id, /^[a-f0-9]{64}$/);
    resources.push(id);
    return id;
  }
  async function inspect(id, cleanup = false) {
    const row = JSON.parse(await docker(['inspect', '--format',
      '{"id":{{json .Id}},"image":{{json .Image}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}},"running":{{json .State.Running}},"oom":{{json .State.OOMKilled}},"nanoCpus":{{json .HostConfig.NanoCpus}},"memory":{{json .HostConfig.Memory}},"labels":{{json .Config.Labels}}}', id], cleanup));
    assert.equal(row.labels['scimserver.owner'], owner);
    assert.equal(row.labels['scimserver.run'], run);
    return row;
  }
  try {
    const identity = JSON.parse(await docker(['image', 'inspect', '--format',
      '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}}}', image]));
    assert.ok(identity.digests.includes(image));
    assert.equal(identity.os, 'linux');
    const inputs = ['run-membership-observer-smoke.cjs', 'membership-observer.cjs',
      'membership-history.cjs', 'membership-cpu-trace.cjs'];
    const manifest = { family: owner, diagnosticOnly: true, admissionEligible: false,
      run, image, identity, sourceTip: await sourceTip(root),
      client: { node: process.version, executableSha256: sha(fs.readFileSync(process.execPath)) },
      hashes: Object.fromEntries(inputs.map(file => [file, sha(fs.readFileSync(path.join(__dirname, file)))])),
      policy: { snapshots: 32, firstEpoch: 16, secondEpoch: 16, medianMaxMs: 250,
        p95MaxMs: 1000, wallCapMs: 180000, reservedCleanupMs: 60000,
        appCpu: 0.5, memory: 1073741824, rssCeiling: 402653184,
        cpuMax: '50000 100000', cpuBurst: 0, finiteAncestorQuota: 'reject',
        intentionalRestart: true, failedDetectionReadsSeparate: true, forcedGc: false },
      frozenAtUtc: new Date().toISOString(), deadlineUtc: new Date(deadline).toISOString() };
    write(path.join(directory, 'manifest.json'), manifest);
    report.manifestSha256 = sha(fs.readFileSync(path.join(directory, 'manifest.json')));
    fs.mkdirSync(path.join(directory, 'frozen-inputs'));
    for (const file of inputs)
      fs.copyFileSync(path.join(__dirname, file), path.join(directory, 'frozen-inputs', file));
    const target = await allocate(['--name', `scim-observe-${run.slice(0, 12)}-idle`,
      '--network', 'none', '--cpus', '0.5', '--memory', '1g', '--no-healthcheck',
      '--entrypoint', 'node', image, '-e', 'setInterval(()=>{},3600000)']);
    const observer = await allocate(['--name', `scim-observe-${run.slice(0, 12)}-reader`,
      '--network', 'none', '--read-only', '--no-healthcheck', '--pid', 'host', '--cgroupns', 'host',
      '--mount', 'type=bind,source=/sys/fs/cgroup,target=/host-cgroup,readonly',
      '--mount', `type=bind,source=${__dirname},target=/diagnostic,readonly`,
      '--entrypoint', 'node', image, '-e', 'setInterval(()=>{},3600000)']);
    let metadata = await inspect(target);
    assert.equal(metadata.running, true);
    assert.equal(metadata.oom, false);
    assert.equal(metadata.nanoCpus, 500000000);
    assert.equal(metadata.memory, 1073741824);
    assert.equal(metadata.image, image.slice(image.indexOf('@') + 1));
    report.initialMetadata = metadata;
    const startup = process.hrtime.bigint();
    channel = new ObserverChannel(spawn('docker', ['--context', 'desktop-linux', 'exec',
      '-i', observer, 'node', '/diagnostic/membership-observer.cjs', '--serve', run],
    { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), run, 30000);
    let baseline = await channel.request({ kind: 'bind', id: target, pid: String(metadata.pid) });
    validateSnapshot(baseline);
    report.startupMs = Number(process.hrtime.bigint() - startup) / 1e6;
    report.bindings = [baseline];
    channel.timeoutMs = 3000;
    for (let index = 0; index < 32; index++) {
      assert.ok(Date.now() < workDeadline, 'Smoke work budget exhausted');
      if (index === 16) {
        await docker(['restart', '--time', '1', target]);
        metadata = await inspect(target);
        assert.equal(metadata.running, true);
        assert.equal(metadata.oom, false);
        assert.equal(metadata.nanoCpus, 500000000);
        assert.equal(metadata.memory, 1073741824);
        assert.notEqual(metadata.started, report.initialMetadata.started);
        let detected = false;
        try { await channel.request({ kind: 'snapshot', id: target }); }
        catch (error) {
          assert.equal(error.message, 'Observer target epoch changed');
          detected = true;
        }
        assert.equal(detected, true, 'Restart must be detected, not cached success');
        report.restart = { detected, metadata };
        baseline = await channel.request({ kind: 'bind', id: target, pid: String(metadata.pid) });
        validateSnapshot(baseline);
        assert.notEqual(baseline.epoch, report.bindings[0].epoch);
        report.bindings.push(baseline);
      }
      const hostStartUtc = new Date().toISOString();
      const before = process.hrtime.bigint();
      const snapshot = await channel.request({ kind: 'snapshot', id: target });
      const elapsedMs = Number(process.hrtime.bigint() - before) / 1e6;
      const delta = windowDelta(baseline, snapshot);
      report.snapshots.push({ index: index + 1, elapsedMs, hostStartUtc,
        hostEndUtc: new Date().toISOString(), snapshot, cpuDelta: delta.cpu });
      baseline = snapshot;
    }
    const sorted = report.snapshots.map(row => row.elapsedMs).sort((a, b) => a - b);
    report.latency = { medianMs: sorted[Math.ceil(32 * 0.5) - 1],
      p95Ms: sorted[Math.ceil(32 * 0.95) - 1], allDurationsMs: report.snapshots.map(row => row.elapsedMs) };
    assert.ok(report.latency.medianMs <= 250, 'Observer median exceeds frozen 250 ms limit');
    assert.ok(report.latency.p95Ms <= 1000, 'Observer p95 exceeds frozen 1000 ms limit');
    report.status = 'OBSERVER-SMOKE-COMPLETE';
  } catch (error) {
    report.status = 'INVALID';
    report.failure = { name: error.name, message: error.message,
      stack: error.stack.split('\n').slice(0, 6).join('\n') };
    process.exitCode = 1;
  } finally {
    if (channel) report.channelClose = await channel.close();
    if (channel && (channel.failure || report.channelClose.code !== 0)) report.status = 'INVALID';
    try {
      const discovered = await docker(['ps', '-aq', '--no-trunc', '--filter',
        `label=scimserver.run=${run}`], true);
      for (const id of discovered.split('\n').filter(Boolean)) {
        assert.match(id, /^[a-f0-9]{64}$/);
        if (!resources.includes(id)) resources.push(id);
      }
    } catch (error) { report.discoveryFailure = error.message; report.status = 'INVALID'; }
    for (const id of resources.reverse()) {
      const row = { id, removed: false };
      try {
        await inspect(id, true);
        await docker(['rm', '-f', id], true);
        row.removed = true;
      } catch (error) { row.error = error.message; }
      report.cleanup.push(row);
    }
    try {
      report.remainingOwned = await docker(['ps', '-aq', '--no-trunc', '--filter',
        `label=scimserver.run=${run}`], true);
      assert.equal(report.remainingOwned, '');
      assert.ok(report.cleanup.every(row => row.removed));
    } catch (error) { report.cleanupFailure = error.message; report.status = 'INVALID'; }
    report.elapsedMsIncludingCleanup = Date.now() - start;
    if (report.elapsedMsIncludingCleanup > 180000) report.status = 'INVALID';
    report.finishedAtUtc = new Date().toISOString();
    write(path.join(directory, 'report.json'), report);
    if (report.status !== 'OBSERVER-SMOKE-COMPLETE') process.exitCode = 1;
    console.log(JSON.stringify({ status: report.status, samples: report.snapshots.length,
      latency: report.latency, elapsedMsIncludingCleanup: report.elapsedMsIncludingCleanup,
      cleanup: report.cleanup, failure: report.failure }));
  }
}

if (require.main === module) main().catch(error => {
  console.error(`Observer smoke startup rejected: ${error.message}`);
  process.exitCode = 1;
});
