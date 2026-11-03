const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../performance/membership-precision.cjs');
const precision = fs.existsSync(script) ? require(script) : {};
const original = require('../performance/membership-protocol.json');

function fixture() {
  const protocol = structuredClone(original);
  protocol.candidate = {
    image: `sha256:${'a'.repeat(64)}`, version: '0.55.67', sourceCommit: 'b'.repeat(40),
  };
  const rows = ['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role, version: protocol.candidate.version, image: protocol.candidate.image,
    imageId: protocol.candidate.image, status: 'PASS', complete: true,
    cpuLimit: 0.5, cpuMax: '50000 100000', memoryLimit: 1073741824,
    warmupIterations: 100, requestCount: 4407, oomKilled: false,
    diagnosticOnly: true, warmupCalibration: true,
    samples: Object.fromEntries(['add', 'populatedRead', 'remove', 'emptyRead']
      .map(operation => [operation, Array.from({ length: 1000 }, (_, i) => 1000 - i)])),
  }));
  return { protocol, rows };
}

test('precision feasibility is implemented separately from release admission', () => {
  assert.equal(typeof precision.quantileRanks, 'function', 'Missing conditional quantile-rank feasibility calculator');
  assert.equal(typeof precision.describePrecision, 'function', 'Missing non-admitting precision report');
});

test('binomial order-statistic ranks agree with exhaustive small-sample probabilities', () => {
  const n = 8;
  for (const p of [0.5, 0.95, 0.99]) {
    const masses = Array(n + 1).fill(0);
    for (let mask = 0; mask < 2 ** n; mask++) {
      const k = mask.toString(2).replaceAll('0', '').length;
      masses[k] += p ** k * (1 - p) ** (n - k);
    }
    for (const alpha of [0.05, 0.2]) {
      const ranks = precision.quantileRanks(n, p, alpha);
      const lower = Array.from({ length: n }, (_, i) => i + 1)
        .filter(l => masses.slice(0, l).reduce((a, b) => a + b, 0) <= alpha).at(-1) ?? null;
      const upper = Array.from({ length: n }, (_, i) => i + 1)
        .find(u => masses.slice(u).reduce((a, b) => a + b, 0) <= alpha) ?? null;
      assert.equal(ranks.lowerRank, lower);
      assert.equal(ranks.upperRank, upper);
    }
  }
});

test('finite p99 upper bound needs 793 independent draws for the explicit simultaneous-bound allocation', () => {
  const alpha = 0.05 / 144;
  assert.equal(precision.quantileRanks(792, 0.99, alpha).upperRank, null);
  assert.equal(precision.quantileRanks(793, 0.99, alpha).upperRank, 793);
  const ranks = precision.quantileRanks(2000, 0.99, alpha);
  assert.ok(ranks.lowerRank < 1980);
  assert.ok(ranks.upperRank > 1980 && ranks.upperRank <= 2000);
  assert.equal(precision.quantileRanks(298, 0.99, 0.05).upperRank, null);
  assert.equal(precision.quantileRanks(299, 0.99, 0.05).upperRank, 299);
});

test('two independent visits cannot be counted as 2000 independent request draws', () => {
  const result = precision.quantileRanks(2, 0.99, 0.05 / 144);
  assert.equal(result.upperRank, null);
  assert.ok(Math.abs(result.maximumUpperCoverage - 0.0199) < 1e-14);
});

test('invalid sample sizes, probabilities and error budgets are rejected explicitly', () => {
  for (const args of [[0, 0.99, 0.05], [10001, 0.99, 0.05], [2.5, 0.99, 0.05],
    [10, 0, 0.05], [10, 1, 0.05], [10, NaN, 0.05], [10, 0.99, 0],
    [10, 0.99, 0.5]]) {
    assert.throws(() => precision.quantileRanks(...args), /Sample size|Probability|Error budget/);
  }
});

test('report preserves all metrics, chronology and the unresolved dependence blocker even for identical samples', () => {
  const { rows, protocol } = fixture();
  const before = structuredClone(rows);
  const report = precision.describePrecision(rows, protocol);
  assert.equal(report.diagnosticOnly, true);
  assert.equal(report.admissionEligible, false);
  assert.equal(report.status, 'UNRESOLVED');
  assert.equal(report.independenceEstablished, false);
  assert.equal(report.comparisons.length, 12);
  assert.ok(report.comparisons.every(c => c.pointRatio === 1));
  assert.equal(report.visits.length, 4);
  assert.equal(report.visits[0].operations.add.firstWindowP95, 988);
  assert.equal(report.visits[0].operations.add.lastWindowP95, 238);
  assert.equal(report.visits[0].operations.add.lagCorrelations.length, 6);
  assert.equal(report.sensitivity.independentDrawsForFiniteP99Upper, 793);
  assert.deepEqual(rows, before, 'Analysis must never sort retained arrays in place');
  assert.equal(Object.hasOwn(report, 'passed'), false);
  assert.equal(Object.hasOwn(report.comparisons[0], 'passed'), false);
  const { assessBlock, rolesFor } = require('../performance/assess-membership.cjs');
  const originalRows = structuredClone(rows);
  for (const row of originalRows) {
    delete row.diagnosticOnly;
    delete row.warmupCalibration;
  }
  const expected = assessBlock(originalRows, protocol.blocks[0], rolesFor(protocol, protocol.blocks[0]));
  assert.deepEqual(report.comparisons.map(c => c.pointRatio), expected.checks.map(c => c.ratio),
    'Synthetic compatibility control must reproduce every original percentile estimator');
});

test('a real 20 percent slowdown is retained, never converted to an admission pass', () => {
  const { rows, protocol } = fixture();
  for (const row of rows.filter(r => r.role === 'candidate')) {
    for (const values of Object.values(row.samples)) {
      for (let i = 0; i < values.length; i++) values[i] *= 1.2;
    }
  }
  const report = precision.describePrecision(rows, protocol);
  for (const c of report.comparisons) {
    assert.ok(Math.abs(c.pointRatio - 1.2) < 1e-12);
    assert.ok(c.conditionalIidRatioBounds.upper > 1.1);
  }
  assert.equal(report.admissionEligible, false);
});

test('constant correlated visits have undefined correlation, not an independence certificate', () => {
  const { rows, protocol } = fixture();
  for (const row of rows) for (const values of Object.values(row.samples)) values.fill(1);
  const report = precision.describePrecision(rows, protocol);
  assert.ok(report.visits[0].operations.add.lagCorrelations.every(c => c.correlation === null));
  assert.equal(report.independenceEstablished, false);
  assert.equal(report.status, 'UNRESOLVED');
});

test('ties at the inclusive 1.10 ceiling do not become diagnostic admission or evidence of independence', () => {
  const { rows, protocol } = fixture();
  for (const row of rows) {
    for (const values of Object.values(row.samples)) values.fill(row.role === 'candidate' ? 1.1 : 1);
  }
  const report = precision.describePrecision(rows, protocol);
  for (const comparison of report.comparisons) {
    assert.equal(comparison.pointRatio, 1.1);
    assert.equal(comparison.conditionalIidRatioBounds.upper, 1.1);
    assert.equal(comparison.conditionalIidRatioBounds.lower, 1.1);
    assert.equal(Object.hasOwn(comparison, 'passed'), false);
  }
  assert.equal(report.status, 'UNRESOLVED');
  assert.equal(report.admissionEligible, false);
  assert.equal(report.independenceEstablished, false);
});

test('incomplete, altered-quota, wrong-image, stripped-marker and malformed observations fail with their intended cause', () => {
  for (const [mutate, message] of [
    [r => { r.pop(); }, /Exactly four/],
    [r => { r[0].complete = false; }, /Complete successful/],
    [r => { r[0].cpuMax = '100000 100000'; }, /Original CPU/],
    [r => { r[0].imageId = `sha256:${'c'.repeat(64)}`; }, /Image identity/],
    [r => { delete r[0].warmupCalibration; }, /Explicit calibration/],
    [r => { r[0].samples.add.pop(); }, /1000 chronological/],
    [r => { r[0].samples.add[0] = NaN; }, /Positive finite/],
    [r => { r[1].warmupIterations = 1000; }, /Uniform warmup/],
    [r => { r[0].oomKilled = true; }, /No OOM/],
    [r => { r.reverse(); r[0].role = 'baseline'; }, /Original BAAB/],
  ]) {
    const { rows, protocol } = fixture();
    mutate(rows);
    assert.throws(() => precision.describePrecision(rows, protocol), message);
  }
});

test('actual offline CLI binds once-read input bytes, refuses overwrite and never creates qualification output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-precision-'));
  try {
    const { rows, protocol } = fixture();
    const p = path.join(directory, 'protocol.json');
    const r = path.join(directory, 'rounds.json');
    const out = path.join(directory, 'precision.json');
    fs.writeFileSync(p, JSON.stringify(protocol));
    fs.writeFileSync(r, JSON.stringify(rows));
    const args = [script, p, r, out];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(out));
    const hash = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    assert.equal(report.inputHashes.protocol, hash(fs.readFileSync(p)));
    assert.equal(report.inputHashes.rounds, hash(fs.readFileSync(r)));
    assert.equal(report.admissionEligible, false);
    const repeated = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(repeated.status, 1);
    assert.match(repeated.stderr, /EEXIST/);
    fs.writeFileSync(r, '{"incomplete":true}');
    const invalid = spawnSync(process.execPath, [script, p, r, path.join(directory, 'invalid.json')],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Exactly four/);
    assert.equal(fs.existsSync(path.join(directory, 'invalid.json')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('actual CLI rejects empty and over-budget files before writing a report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-precision-bounds-'));
  try {
    const { protocol } = fixture();
    const p = path.join(directory, 'protocol.json');
    const r = path.join(directory, 'rounds.json');
    const out = path.join(directory, 'precision.json');
    fs.writeFileSync(p, JSON.stringify(protocol));
    for (const [bytes, reason] of [[Buffer.alloc(0), /Empty evidence/],
      [Buffer.alloc(4 * 1024 * 1024 + 1, 32), /fixed 4 MiB/]]) {
      fs.writeFileSync(r, bytes);
      const result = spawnSync(process.execPath, [script, p, r, out], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, reason);
      assert.equal(fs.existsSync(out), false);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('actual CLI hashes analyzed descriptors even when their paths are replaced after opening', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-precision-race-'));
  try {
    const { rows, protocol } = fixture();
    const p = path.join(directory, 'protocol.json');
    const r = path.join(directory, 'rounds.json');
    const out = path.join(directory, 'precision.json');
    const preload = path.join(directory, 'replace.cjs');
    const protocolBytes = Buffer.from(JSON.stringify(protocol));
    const roundBytes = Buffer.from(JSON.stringify(rows));
    fs.writeFileSync(p, protocolBytes);
    fs.writeFileSync(r, roundBytes);
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const open = fs.openSync;
      fs.openSync = function(file, ...args) {
        const descriptor = open.call(this, file, ...args);
        if ([process.env.PRECISION_PROTOCOL, process.env.PRECISION_ROUNDS].includes(file)) {
          fs.renameSync(file, file + '.old');
          fs.writeFileSync(file, '{"replacement":true}');
        }
        return descriptor;
      };
    `);
    const result = spawnSync(process.execPath, ['--require', preload, script, p, r, out], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PRECISION_PROTOCOL: p, PRECISION_ROUNDS: r },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(out));
    const hash = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    assert.equal(report.inputHashes.protocol, hash(protocolBytes));
    assert.equal(report.inputHashes.rounds, hash(roundBytes));
    assert.equal(report.admissionEligible, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
