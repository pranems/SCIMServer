const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assessor = require('../performance/assess-membership.cjs');
const protocol = require('../performance/membership-protocol.json');

function fixture() {
  const block = protocol.blocks[0];
  const roles = assessor.rolesFor(protocol, block);
  const rows = ['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role,
    version: roles[role].version,
    image: roles[role].image,
    status: 'PASS',
    complete: true,
    cpuLimit: 0.5,
    memoryLimit: 1073741824,
    warmupIterations: 100,
    requestCount: 4407,
    samples: Object.fromEntries(
      ['add', 'populatedRead', 'remove', 'emptyRead'].map(operation => [
        operation, Array.from({ length: 1000 }, (_, index) => index + 1),
      ]),
    ),
  }));
  return { block, roles, rows };
}

test('descriptive stability analysis exists without creating admission', () => {
  assert.equal(typeof assessor.describeStability, 'function',
    'Missing descriptive stability collector');
  const { rows, block, roles } = fixture();
  const before = structuredClone(rows);
  const report = assessor.describeStability(rows, block, roles);
  assert.equal(report.diagnosticOnly, true);
  assert.equal(report.admissionEligible, false);
  assert.equal(report.uncertaintyEstimated, false);
  assert.equal(report.warmupConvergenceEstablished, false);
  assert.deepEqual(report.qualificationAssessment, assessor.assessBlock(rows, block, roles));
  assert.deepEqual(rows, before, 'Retained samples must not be sorted or rewritten in place');
});

test('all chronological windows retain exact boundaries and nearest-rank percentiles', () => {
  const { rows, block, roles } = fixture();
  const report = assessor.describeStability(rows, block, roles);
  assert.equal(report.rounds.length, 4);
  assert.deepEqual(report.rounds.map(round => round.visit), [1, 1, 2, 2]);
  const operation = report.rounds[0].operations.add;
  assert.equal(operation.windows.length, 4);
  assert.deepEqual(operation.windows[0], {
    startCycle: 0, endCycleExclusive: 250, sampleCount: 250,
    samples: Array.from({ length: 250 }, (_, index) => index + 1),
    p50: 125, p95: 238, p99: 248,
  });
  assert.deepEqual(operation.windows[3], {
    startCycle: 750, endCycleExclusive: 1000, sampleCount: 250,
    samples: Array.from({ length: 250 }, (_, index) => index + 751),
    p50: 875, p95: 988, p99: 998,
  });
  assert.equal(operation.lastToFirstP95Ratio, 988 / 238);
  for (const round of report.rounds) {
    for (const entry of Object.values(round.operations)) {
      assert.equal(entry.windows.reduce((sum, window) => sum + window.sampleCount, 0), 1000);
    }
  }
});

test('the report independently retains every raw observation in its original chronological order', () => {
  const { rows, block, roles } = fixture();
  for (const row of rows) row.samples.add.reverse();
  const report = assessor.describeStability(rows, block, roles);
  for (const [index, round] of report.rounds.entries()) {
    for (const [operation, entry] of Object.entries(round.operations)) {
      assert.deepEqual(entry.windows.flatMap(window => window.samples), rows[index].samples[operation],
        'The report must contain all raw observations, not only summaries or their sorted order');
    }
  }
});

test('pooled same-image acceptance is not evidence of within-round convergence', () => {
  const { rows, block, roles } = fixture();
  const report = assessor.describeStability(rows, block, roles);
  assert.equal(report.qualificationAssessment.passed, true);
  assert.ok(report.rounds[0].operations.emptyRead.lastToFirstP95Ratio > 4);
  assert.equal(report.admissionEligible, false);
  assert.equal(report.warmupConvergenceEstablished, false);
});

test('descriptive analysis retains failure instead of converting it to a pass', () => {
  const { rows, block, roles } = fixture();
  for (const row of rows.filter(row => row.role === 'candidate')) {
    row.samples.remove = row.samples.remove.map(value => value * 2);
  }
  const report = assessor.describeStability(rows, block, roles);
  assert.equal(report.qualificationAssessment.passed, false);
  assert.equal(report.admissionEligible, false);
});

test('partial, malformed and instrumented receipts remain explicit failures', () => {
  for (const mutate of [
    rows => { rows[0].complete = false; },
    rows => { rows[0].samples.add.pop(); },
    rows => { rows[0].samples.add[0] = NaN; },
    rows => { rows[0].diagnosticOnly = true; },
    rows => { rows.reverse(); rows[0].role = 'baseline'; },
  ]) {
    const { rows, block, roles } = fixture();
    mutate(rows);
    assert.throws(() => assessor.describeStability(rows, block, roles),
      /Partial receipts|Every measured sample|Invalid latency sample|Diagnostic receipts|Actual role order/);
  }
});

test('actual descriptive CLI writes a non-admitting report and refuses overwrite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-stability-'));
  try {
    const { rows, block } = fixture();
    const protocolPath = path.join(directory, 'protocol.json');
    const rowsPath = path.join(directory, 'rounds.json');
    const output = path.join(directory, 'stability.json');
    fs.writeFileSync(protocolPath, JSON.stringify(protocol));
    fs.writeFileSync(rowsPath, JSON.stringify(rows));
    const args = [
      path.resolve(__dirname, '../performance/assess-membership.cjs'),
      '--describe-stability', protocolPath, block.name, rowsPath, output,
    ];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.admissionEligible, false);
    assert.equal(report.rounds.length, 4);
    const { createHash } = require('node:crypto');
    assert.equal(report.inputHashes.rounds,
      createHash('sha256').update(fs.readFileSync(rowsPath)).digest('hex'));
    assert.equal(report.inputHashes.protocol,
      createHash('sha256').update(fs.readFileSync(protocolPath)).digest('hex'));
    const original = fs.readFileSync(output);
    const repeated = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(repeated.status, 1);
    assert.match(repeated.stderr, /EEXIST/);
    assert.deepEqual(fs.readFileSync(output), original);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('actual CLI hashes exactly the input bytes it parsed even if the input paths change after reading', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-stability-input-race-'));
  try {
    const { rows, block } = fixture();
    const protocolPath = path.join(directory, 'protocol.json');
    const rowsPath = path.join(directory, 'rounds.json');
    const output = path.join(directory, 'stability.json');
    const preload = path.join(directory, 'replace-after-read.cjs');
    const originalProtocol = Buffer.from(JSON.stringify(protocol));
    const originalRows = Buffer.from(JSON.stringify(rows));
    fs.writeFileSync(protocolPath, originalProtocol);
    fs.writeFileSync(rowsPath, originalRows);
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const read = fs.readFileSync;
      const targets = new Set([process.env.STABILITY_TEST_PROTOCOL, process.env.STABILITY_TEST_ROUNDS]);
      fs.readFileSync = function(file, ...args) {
        const content = read.call(this, file, ...args);
        if (targets.has(file)) {
          fs.writeFileSync(file, Buffer.concat([Buffer.from(content), Buffer.from('\\n')]));
        }
        return content;
      };
    `);
    const result = spawnSync(process.execPath, [
      '--require', preload, path.resolve(__dirname, '../performance/assess-membership.cjs'),
      '--describe-stability', protocolPath, block.name, rowsPath, output,
    ], { encoding: 'utf8', timeout: 10000, env: { ...process.env,
      STABILITY_TEST_PROTOCOL: protocolPath, STABILITY_TEST_ROUNDS: rowsPath } });
    assert.equal(result.status, 0, result.stderr);
    assert.notDeepEqual(fs.readFileSync(protocolPath), originalProtocol, 'Protocol mutation actually executed');
    assert.notDeepEqual(fs.readFileSync(rowsPath), originalRows, 'Rounds mutation actually executed');
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    const { createHash } = require('node:crypto');
    assert.equal(report.inputHashes.protocol, createHash('sha256').update(originalProtocol).digest('hex'),
      'Protocol hash must identify the parsed buffer, not a later pathname read');
    assert.equal(report.inputHashes.rounds, createHash('sha256').update(originalRows).digest('hex'),
      'Rounds hash must identify the parsed buffer, not a later pathname read');
    assert.deepEqual(report.qualificationAssessment, assessor.assessBlock(rows, block, assessor.rolesFor(protocol, block)));
  } finally { fs.rmSync(directory, { recursive: true }); }
});
