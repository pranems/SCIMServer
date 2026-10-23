const assert = require('node:assert/strict');
const { parseCounters } = require('./membership-cpu-trace.cjs');

const operations = ['add', 'populatedRead', 'remove', 'emptyRead'];
const cpuKeys = ['usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec'];

function requiredUnsigned(value) {
  assert.equal(typeof value, 'string', 'Required raw unsigned counter');
  assert.match(value, /^\d+$/, 'Malformed raw unsigned counter');
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number), 'Unsafe raw unsigned counter');
  return number;
}

async function sourceTip(root, parent = 'd25b6155bace7af2ec4ccb89f2eb0048e2db0c26') {
  const { promisify } = require('node:util');
  const exec = promisify(require('node:child_process').execFile);
  assert.match(parent, /^[a-f0-9]{40}$/);
  const options = { cwd: root, timeout: 10000, windowsHide: true };
  await exec('git', ['merge-base', '--is-ancestor', parent, 'HEAD'], options);
  const tip = (await exec('git', ['rev-parse', 'HEAD'], options)).stdout.trim();
  assert.match(tip, /^[a-f0-9]{40}$/);
  return tip;
}

function schedule(seed) {
  assert.ok(Number.isSafeInteger(seed) && seed >= 0, 'Explicit schedule seed');
  const orders = seed % 2 ? ['BAAB', 'ABBA'] : ['ABBA', 'BAAB'];
  return orders.flatMap(order => ['fresh', 'reused'].map(history => ({
    name: `${history}-${order.toLowerCase()}`, history, order, visits: [...order],
  })));
}

async function runVisits(block, apps, lifecycle) {
  for (const [index, role] of block.visits.entries()) {
    lifecycle.checkDeadline();
    if (block.history === 'fresh') apps[role] = await lifecycle.restart(role, apps[role]);
    lifecycle.checkDeadline();
    await lifecycle.visit(apps[role], role, index + 1);
  }
}

function validateSnapshot(row) {
  assert.equal(typeof row.epoch, 'string');
  assert.ok(row.epoch.length > 0);
  assert.ok(Number.isFinite(Date.parse(row.readStartUtc)));
  assert.ok(Date.parse(row.readEndUtc) >= Date.parse(row.readStartUtc));
  assert.match(row.readStartNs, /^\d+$/, 'Required monotonic start');
  assert.match(row.readEndNs, /^\d+$/, 'Required monotonic end');
  assert.ok(BigInt(row.readEndNs) > BigInt(row.readStartNs));
  for (const key of cpuKeys)
    assert.ok(Number.isSafeInteger(row.cpu[key]) && row.cpu[key] >= 0, `Missing CPU ${key}`);
  for (const key of ['rssBytes', 'highWaterRssBytes', 'memoryPeakBytes', 'oom', 'oomKill'])
    assert.ok(Number.isSafeInteger(row[key]) && row[key] >= 0, `Missing memory ${key}`);
  assert.ok(row.rssBytes > 0 && row.highWaterRssBytes > 0 && row.memoryPeakBytes > 0);
  assert.ok(row.highWaterRssBytes < 402653184, 'Original 384 MiB Node RSS ceiling');
  assert.ok(row.memoryPeakBytes < 1073741824, 'Original cgroup memory ceiling');
  assert.equal(row.oom, 0, 'OOM event');
  assert.equal(row.oomKill, 0, 'OOM kill');
  assert.equal(row.cpuMax, '50000 100000', 'Original CPU quota/period');
  assert.equal(row.cpuBurst, 0, 'No CPU burst');
  assert.ok(Array.isArray(row.ancestors) && row.ancestors.length > 0, 'Ancestor policy unavailable');
  assert.equal(row.ancestors.at(-1).root, true, 'Complete root ancestry required');
  assert.equal(row.ancestors.at(-1).path, '/');
  assert.equal(row.ancestors.filter(ancestor => ancestor.root).length, 1);
  for (const ancestor of row.ancestors) {
    if (ancestor.root && ancestor.cpuMax === null) {
      assert.equal(ancestor.cpuBurst, null);
      continue;
    }
    assert.match(ancestor.cpuMax, /^max \d+$/, 'Finite ancestor CPU quota');
    assert.equal(ancestor.cpuBurst, 0, 'Ancestor CPU burst');
  }
}

function windowDelta(before, after) {
  validateSnapshot(before);
  validateSnapshot(after);
  assert.equal(after.epoch, before.epoch, 'Cannot subtract across process lifetimes');
  assert.ok(BigInt(after.readStartNs) > BigInt(before.readEndNs), 'Overlapping read windows');
  const cpu = {};
  for (const key of cpuKeys) {
    assert.ok(after.cpu[key] >= before.cpu[key], 'CPU counters reset');
    cpu[key] = after.cpu[key] - before.cpu[key];
  }
  return { cpu, before, after, diagnosticOnly: true };
}

function validateReceipt(row, expectedVersion = '0.55.60') {
  assert.equal(row.diagnosticOnly, true);
  assert.equal(row.complete, true, 'Incomplete workload');
  assert.equal(row.status, 'PASS', 'Workload assertions failed');
  assert.ok(['0.55.20', '0.55.60'].includes(expectedVersion));
  assert.equal(row.version, expectedVersion);
  assert.equal(row.warmupIterations, 100);
  assert.equal(row.requestCount, 4407);
  assert.equal(row.cleanup.verified, true);
  assert.deepEqual(Object.keys(row.samples), operations);
  for (const op of operations) {
    assert.equal(row.samples[op].length, 1000);
    assert.ok(row.samples[op].every(x => Number.isFinite(x) && x > 0));
    for (const phase of ['warmup', 'measured']) {
      const spans = row.spans.filter(s => s.operation === op && s.phase === phase);
      assert.equal(spans.length, phase === 'warmup' ? 100 : 1000);
      assert.deepEqual(spans.map(s => s.cycle),
        Array.from({ length: spans.length }, (_, i) => i));
      assert.ok(spans.every(s => s.succeeded && s.status === 200));
      if (phase === 'measured')
        assert.deepEqual(spans.map(s => s.ms), row.samples[op]);
    }
  }
  assert.equal(row.spans.length, 4407);
}

async function finalizeOwned(resources, actions) {
  const rows = [];
  for (const id of [...resources].reverse()) {
    const row = { id, capture: false, removed: false, verified: false };
    try { await actions.capture(id); row.capture = true; }
    catch { row.captureError = true; }
    try { await actions.remove(id); row.removed = true; }
    catch { row.removeError = true; }
    try { row.verified = await actions.verify(id); }
    catch { row.verifyError = true; }
    rows.push(row);
  }
  return { rows, verified: rows.every(r => r.verified) };
}

function validatePrivacy(rows, consoleLog, secrets) {
  assert.equal(rows.length, 200, 'Original private log sample');
  const privateLog = JSON.stringify(rows);
  for (const secret of secrets) {
    assert.ok(typeof secret === 'string' && secret.length > 0);
    assert.ok(!privateLog.includes(secret) && !consoleLog.includes(secret), 'Generated credential leaked');
  }
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  for (const row of rows) {
    assert.match(row.requestId, uuid);
    assert.match(row.endpointId, uuid);
    assert.ok(Number.isFinite(row.durationMs) && row.durationMs >= 0);
    assert.ok([200, 201, 400].includes(row.status));
    assert.equal(JSON.parse(row.requestHeaders).authorization, '[REDACTED]');
  }
  const errors = rows.filter(row => row.status >= 400);
  assert.ok(errors.length > 0, 'Negative-path log required');
  const requestId = errors[0].requestId;
  const sameRecord = consoleLog.split(/\r?\n/).some(line => {
    if (line.startsWith('{"timestamp":')) {
      const record = JSON.parse(line);
      return record.category === 'scim.patch' && record.requestId === requestId;
    }
    return new RegExp(`^\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\\s+scim\\.patch\\s+\\[${requestId.slice(0, 8)}\\]`)
      .test(line.replace(/\x1b\[[0-9;]*m/g, ''));
  });
  assert.ok(sameRecord, 'Same-record categorized error correlation required');
  return { diagnosticOnly: true, complete: true, validatedRows: rows.length,
    errorRows: errors.length, sameRecordPresent: sameRecord, rawLogsExported: false };
}

// Runs only in the owned read-only observer container, never at import time.
function collect(pid, containerId) {
  const fs = require('node:fs');
  const path = require('node:path').posix;
  const readStartUtc = new Date().toISOString();
  const readStartNs = process.hrtime.bigint().toString();
  assert.match(pid, /^\d+$/);
  assert.match(containerId, /^[a-f0-9]{64}$/);
  const proc = `/proc/${pid}`;
  const membership = fs.readFileSync(`${proc}/cgroup`, 'utf8').trim();
  assert.match(membership, /^0::\/[^\n]+$/);
  const relative = membership.slice(3);
  assert.ok(relative.includes(containerId), 'Unexpected app cgroup ownership');
  const root = '/host-cgroup';
  const directory = path.join(root, relative);
  assert.ok(directory.startsWith(`${root}/`));
  const text = name => fs.readFileSync(path.join(directory, name), 'utf8').trim();
  const ancestors = [];
  for (let parent = path.dirname(directory); ; parent = path.dirname(parent)) {
    assert.ok(parent === root || parent.startsWith(`${root}/`));
    const rootNode = parent === root;
    const maxPath = path.join(parent, 'cpu.max');
    const burstPath = path.join(parent, 'cpu.max.burst');
    ancestors.push({
      path: path.relative(root, parent) || '/', root: rootNode,
      cpuMax: rootNode && !fs.existsSync(maxPath) ? null : fs.readFileSync(maxPath, 'utf8').trim(),
      cpuBurst: rootNode && !fs.existsSync(burstPath) ? null : requiredUnsigned(fs.readFileSync(burstPath, 'utf8').trim()),
    });
    if (rootNode) break;
  }
  const status = fs.readFileSync(`${proc}/status`, 'utf8');
  const kib = key => {
    const hit = status.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'm'));
    assert.ok(hit, `Missing ${key}`);
    const bytes = requiredUnsigned(hit[1]) * 1024;
    assert.ok(Number.isSafeInteger(bytes));
    return bytes;
  };
  const stat = fs.readFileSync(`${proc}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  assert.ok(requiredUnsigned(startTicks) > 0, 'Required process lifetime');
  const events = {};
  for (const line of text('memory.events').split('\n')) {
    const fields = line.split(/\s+/);
    assert.equal(fields.length, 2);
    assert.ok(!Object.hasOwn(events, fields[0]), 'Duplicate memory counter');
    events[fields[0]] = requiredUnsigned(fields[1]);
  }
  const cpuStatRaw = text('cpu.stat');
  const result = {
    epoch: `${containerId}:${pid}:${startTicks}`, pid: Number(pid), startTicks,
    readStartUtc, readStartNs, cpu: parseCounters(cpuStatRaw),
    cpuStatRaw, cpuMax: text('cpu.max'),
    cpuBurst: requiredUnsigned(text('cpu.max.burst')), ancestors,
    rssBytes: kib('VmRSS'), highWaterRssBytes: kib('VmHWM'),
    memoryPeakBytes: requiredUnsigned(text('memory.peak')),
    memoryMaxBytes: requiredUnsigned(text('memory.max')),
    oom: events.oom, oomKill: events.oom_kill,
    readEndUtc: new Date().toISOString(), readEndNs: process.hrtime.bigint().toString(),
  };
  assert.equal(result.memoryMaxBytes, 1073741824, 'Actual cgroup memory limit changed');
  const finalStat = fs.readFileSync(`${proc}/stat`, 'utf8');
  assert.equal(finalStat.slice(finalStat.lastIndexOf(')') + 2).split(' ')[19], startTicks,
    'Process lifetime changed during read');
  assert.equal(fs.readFileSync(`${proc}/cgroup`, 'utf8').trim(), membership,
    'Process cgroup changed during read');
  result.readEndUtc = new Date().toISOString();
  result.readEndNs = process.hrtime.bigint().toString();
  validateSnapshot(result);
  return result;
}

module.exports = { schedule, runVisits, windowDelta, validateSnapshot, validateReceipt, validatePrivacy, finalizeOwned, collect, requiredUnsigned, sourceTip };
if (require.main === module) {
  assert.equal(process.argv[2], '--collect', 'Explicit collector invocation required');
  process.stdout.write(JSON.stringify(collect(process.argv[3], process.argv[4])));
}
