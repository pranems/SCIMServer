const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { validateProtocol } = require('./assess-membership.cjs');

const operations = ['add', 'populatedRead', 'remove', 'emptyRead'];
const percentiles = [50, 95, 99];
const familyAlpha = 0.05;
// Two A/A blocks need 48 one-sided quantile bounds each; two A/B blocks need 24 each.
const componentBounds = 144;
const boundAlpha = familyAlpha / componentBounds;

function quantileRanks(n, p, alpha) {
  assert.ok(Number.isInteger(n) && n > 0 && n <= 10000, 'Sample size must be an integer from 1 to 10000');
  assert.ok(Number.isFinite(p) && p > 0 && p < 1, 'Probability must be strictly between zero and one');
  assert.ok(Number.isFinite(alpha) && alpha > 0 && alpha < 0.5, 'Error budget must be strictly between zero and 0.5');
  const masses = new Float64Array(n + 1);
  const mode = Math.min(n, Math.floor((n + 1) * p));
  masses[mode] = 1;
  for (let k = mode; k > 0; k--) masses[k - 1] = masses[k] * k / (n - k + 1) * (1 - p) / p;
  for (let k = mode; k < n; k++) masses[k + 1] = masses[k] * (n - k) / (k + 1) * p / (1 - p);
  const total = masses.reduce((sum, value) => sum + value, 0);
  let lowerRank = null;
  let upperRank = null;
  let tail = 0;
  for (let k = 0; k < n; k++) {
    tail += masses[k] / total;
    if (tail <= alpha) lowerRank = k + 1;
  }
  tail = 0;
  for (let k = n; k > 0; k--) {
    tail += masses[k] / total;
    if (tail <= alpha) upperRank = k;
  }
  return { lowerRank, upperRank, maximumUpperCoverage: 1 - p ** n };
}

function nearestRank(sorted, percentile) {
  return sorted[Math.ceil(sorted.length * percentile / 100) - 1];
}

function describeSeries(samples) {
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const squares = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const windowP95 = Array.from({ length: 4 }, (_, i) =>
    nearestRank(samples.slice(i * 250, (i + 1) * 250).sort((a, b) => a - b), 95));
  return {
    firstWindowP95: windowP95[0], lastWindowP95: windowP95[3],
    lastToFirstP95Ratio: windowP95[3] / windowP95[0],
    lagCorrelations: [1, 2, 4, 8, 16, 32].map(lag => ({
      lag,
      correlation: squares === 0 ? null : samples.slice(lag).reduce(
        (sum, value, i) => sum + (value - mean) * (samples[i] - mean), 0,
      ) / squares,
    })),
  };
}

function validateCalibrationRows(rows, protocol) {
  validateProtocol(protocol);
  assert.match(protocol.candidate.sourceCommit ?? '', /^[a-f0-9]{40}$/, 'Exact checkout source required');
  assert.ok(Array.isArray(rows) && rows.length === 4, 'Exactly four diagnostic visits required');
  assert.deepEqual(rows.map(row => row.role), ['candidate', 'baseline', 'baseline', 'candidate'], 'Original BAAB order');
  const warmup = rows[0].warmupIterations;
  assert.ok([100, 1000].includes(warmup), 'Uniform warmup must be a registered treatment');
  for (const row of rows) {
    assert.ok(row.status === 'PASS' && row.complete === true, 'Complete successful diagnostic required');
    assert.ok(row.diagnosticOnly === true && row.warmupCalibration === true, 'Explicit calibration markers required');
    assert.equal(row.image, protocol.candidate.image, 'Image identity must match exact-checkout protocol');
    assert.equal(row.imageId, protocol.candidate.image, 'Image identity must match immutable Docker ID');
    assert.equal(row.version, protocol.candidate.version, 'Version identity must match protocol');
    assert.equal(row.cpuLimit, 0.5, 'Original CPU limit required');
    assert.equal(row.cpuMax, '50000 100000', 'Original CPU quota and period required');
    assert.equal(row.memoryLimit, 1073741824, 'Original memory limit required');
    assert.equal(row.oomKilled, false, 'No OOM permitted');
    assert.equal(row.warmupIterations, warmup, 'Uniform warmup required within one treatment');
    assert.equal(row.requestCount, 4 * (warmup + 1000) + 7, 'Complete lifecycle request count required');
    assert.deepEqual(Object.keys(row.samples).sort(), [...operations].sort(), 'All four operation metrics required');
    for (const samples of Object.values(row.samples)) {
      assert.ok(Array.isArray(samples) && samples.length === 1000, '1000 chronological samples required per visit');
      assert.ok(samples.every(value => Number.isFinite(value) && value > 0), 'Positive finite observations required');
    }
  }
  return warmup;
}

function describePrecision(rows, protocol) {
  const warmup = validateCalibrationRows(rows, protocol);
  const comparisons = operations.flatMap(operation => {
    const values = Object.fromEntries(['baseline', 'candidate'].map(role => [role,
      rows.filter(row => row.role === role).flatMap(row => row.samples[operation]).sort((a, b) => a - b),
    ]));
    return percentiles.map(percentile => {
      const ranks = quantileRanks(2000, percentile / 100, boundAlpha);
      const bounds = Object.fromEntries(Object.entries(values).map(([role, samples]) => [role, {
        lower: ranks.lowerRank === null ? null : samples[ranks.lowerRank - 1],
        upper: ranks.upperRank === null ? null : samples[ranks.upperRank - 1],
      }]));
      return {
        operation, percentile, samplesPerRole: 2000, ranks,
        pointRatio: nearestRank(values.candidate, percentile) / nearestRank(values.baseline, percentile),
        conditionalIidBounds: bounds,
        conditionalIidRatioBounds: {
          lower: bounds.candidate.lower === null || bounds.baseline.upper === null
            ? null : bounds.candidate.lower / bounds.baseline.upper,
          upper: bounds.candidate.upper === null || bounds.baseline.lower === null
            ? null : bounds.candidate.upper / bounds.baseline.lower,
        },
      };
    });
  });
  return {
    diagnosticOnly: true, admissionEligible: false, status: 'UNRESOLVED',
    independenceEstablished: false, uncertaintyEstimated: false,
    interpretation: 'Conditional IID sensitivity only, not confidence coverage for these correlated diagnostic data or release admission.',
    sourceCommit: protocol.candidate.sourceCommit, image: protocol.candidate.image,
    version: protocol.candidate.version, warmupIterations: warmup,
    familyAlpha, componentBounds, boundAlpha,
    assumptionsNotEstablished: [
      'Independent identically distributed (IID) request draws from a stable distribution.',
      'Independent visits from a common target distribution; resetting a process alone does not establish this.',
      'A known dependence bound or valid cluster model preserving the original pooled-quantile estimand.',
      'Uninstrumented transportability and prospective power at an explicitly chosen sub-margin alternative.',
    ],
    sensitivity: {
      independentDrawsForFiniteP99Upper: Math.ceil(Math.log(boundAlpha) / Math.log(0.99)),
      twoIndependentDraws: quantileRanks(2, 0.99, boundAlpha),
      statement: 'A perfect within-visit dependence counterexample has only two draws per role. This is not an estimate of effective sample size or a recommended visit count.',
    },
    visits: rows.map((row, i) => ({
      round: i + 1, role: row.role,
      operations: Object.fromEntries(operations.map(operation => [operation, describeSeries(row.samples[operation])])),
    })),
    comparisons,
  };
}

function readBounded(file) {
  const cap = 4 * 1024 * 1024;
  const descriptor = fs.openSync(file, 'r');
  try {
    assert.ok(fs.fstatSync(descriptor).isFile(), 'Evidence must be a regular file');
    const bytes = Buffer.alloc(cap + 1);
    let length = 0;
    let count;
    do {
      count = fs.readSync(descriptor, bytes, length, bytes.length - length, length);
      length += count;
      assert.ok(length <= cap, 'Evidence exceeds the fixed 4 MiB input budget');
    } while (count > 0);
    assert.ok(length > 0, 'Empty evidence is invalid');
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { describePrecision, quantileRanks, validateCalibrationRows, readBounded, nearestRank };

if (require.main === module) {
  try {
    assert.equal(process.argv.length, 5, 'Explicit protocol, diagnostic rounds and new output required');
    const [protocolPath, roundsPath, output] = process.argv.slice(2);
    const protocol = readBounded(protocolPath);
    const rounds = readBounded(roundsPath);
    const report = describePrecision(JSON.parse(rounds.toString('utf8')), JSON.parse(protocol.toString('utf8')));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    report.inputHashes = { protocol: hash(protocol), rounds: hash(rounds) };
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    console.error(`Precision feasibility failed: ${error.message}`);
    process.exitCode = 1;
  }
}
