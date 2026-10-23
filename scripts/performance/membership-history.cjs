const assert = require('node:assert/strict');
const { parseCounters } = require('./membership-cpu-trace.cjs');

const operations = ['add', 'populatedRead', 'remove', 'emptyRead'];
const cpuKeys = ['usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec'];

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
  assert.ok(BigInt(row.readEndNs) > BigInt(row.readStartNs));
  for (const key of cpuKeys)
    assert.ok(Number.isSafeInteger(row.cpu[key]) && row.cpu[key] >= 0, `Missing CPU ${key}`);
  for (const key of ['rssBytes', 'highWaterRssBytes', 'memoryPeakBytes', 'oom', 'oomKill'])
    assert.ok(Number.isSafeInteger(row[key]) && row[key] >= 0, `Missing memory ${key}`);
  assert.ok(row.rssBytes > 0 && row.highWaterRssBytes > 0);
  assert.ok(row.highWaterRssBytes < 402653184, 'Original 384 MiB Node RSS ceiling');
  assert.ok(row.memoryPeakBytes < 1073741824, 'Original cgroup memory ceiling');
  assert.equal(row.oom, 0, 'OOM event');
  assert.equal(row.oomKill, 0, 'OOM kill');
  assert.equal(row.cpuMax, '50000 100000', 'Original CPU quota/period');
  assert.equal(row.cpuBurst, 0, 'No CPU burst');
  assert.ok(Array.isArray(row.ancestors) && row.ancestors.length > 0, 'Ancestor policy unavailable');
  for (const ancestor of row.ancestors) {
    if (ancestor.root && ancestor.cpuMax === null) continue;
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

function validateReceipt(row) {
  assert.equal(row.diagnosticOnly, true);
  assert.equal(row.complete, true, 'Incomplete workload');
  assert.equal(row.status, 'PASS', 'Workload assertions failed');
  assert.equal(row.version, '0.55.60');
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
      cpuBurst: rootNode && !fs.existsSync(burstPath) ? null : Number(fs.readFileSync(burstPath, 'utf8').trim()),
    });
    if (rootNode) break;
  }
  const status = fs.readFileSync(`${proc}/status`, 'utf8');
  const kib = key => {
    const hit = status.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'm'));
    assert.ok(hit, `Missing ${key}`);
    return Number(hit[1]) * 1024;
  };
  const stat = fs.readFileSync(`${proc}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  const events = Object.fromEntries(text('memory.events').split('\n').map(s => s.split(/\s+/)));
  const result = {
    epoch: `${containerId}:${pid}:${startTicks}`, pid: Number(pid), startTicks,
    readStartUtc, readStartNs, cpu: parseCounters(text('cpu.stat')),
    cpuStatRaw: text('cpu.stat'), cpuMax: text('cpu.max'),
    cpuBurst: Number(text('cpu.max.burst')), ancestors,
    rssBytes: kib('VmRSS'), highWaterRssBytes: kib('VmHWM'),
    memoryPeakBytes: Number(text('memory.peak')),
    oom: Number(events.oom), oomKill: Number(events.oom_kill),
    readEndUtc: new Date().toISOString(), readEndNs: process.hrtime.bigint().toString(),
  };
  validateSnapshot(result);
  return result;
}

module.exports = { schedule, runVisits, windowDelta, validateSnapshot, validateReceipt, validatePrivacy, finalizeOwned, collect };
if (require.main === module) {
  assert.equal(process.argv[2], '--collect', 'Explicit collector invocation required');
  process.stdout.write(JSON.stringify(collect(process.argv[3], process.argv[4])));
}
