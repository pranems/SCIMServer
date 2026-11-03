const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../performance/membership-cluster-cdf.cjs');
const method = fs.existsSync(script) ? require(script) : {};
const original = require('../performance/membership-protocol.json');
const operations = ['add', 'populatedRead', 'remove', 'emptyRead'];
const alpha = 0.05 / 144;

function fixture(transform = () => 10) {
  const protocol = structuredClone(original);
  protocol.candidate = {
    image: `sha256:${'a'.repeat(64)}`, version: '0.55.67', sourceCommit: 'b'.repeat(40),
  };
  const rows = ['candidate', 'baseline', 'baseline', 'candidate'].map((role, visit) => ({
    role, version: protocol.candidate.version, image: protocol.candidate.image,
    imageId: protocol.candidate.image, status: 'PASS', complete: true,
    cpuLimit: 0.5, cpuMax: '50000 100000', memoryLimit: 1073741824,
    warmupIterations: 100, requestCount: 4407, oomKilled: false,
    diagnosticOnly: true, warmupCalibration: true,
    samples: Object.fromEntries(operations.map(operation => [operation,
      Array.from({ length: 1000 }, (_, cycle) => transform(role, visit, cycle, operation)),
    ])),
  }));
  const campaign = {
    Mode: 'Warmup calibration diagnostic only', AdmissionEligible: false, WarmupIterations: 100,
    StartedAtUtc: '2026-11-03T12:00:00Z', FinishedAtUtc: '2026-11-03T12:02:12.0613075Z',
    Status: 'DIAGNOSTIC COMPLETE: CPU temporal association only; not release admission',
    Blocks: [{ Name: 'aa-baab', DiagnosticComplete: true, AdmissionEligible: false }],
  };
  return { protocol, rows, campaign };
}

test('whole-visit CDF construction has a separate runnable, non-admitting implementation', () => {
  assert.equal(typeof method.clusterCdfAt, 'function', 'Missing whole-visit CDF implementation');
  assert.equal(typeof method.clusterRanks, 'function');
  assert.equal(typeof method.unrestrictedPowerObstruction, 'function');
  assert.equal(typeof method.describeClusterFeasibility, 'function');
});

test('averaging equal-sized visit CDFs preserves pooled quantiles, not averaged visit quantiles', () => {
  const visits = [Array.from({ length: 1000 }, (_, i) => i < 950 ? 1 : 100), Array(1000).fill(2)];
  for (const x of [0, 1, 2, 99, 100]) {
    const cdf = method.clusterCdfAt(visits, x);
    const flat = visits.flat();
    assert.equal(cdf.pooledCount, flat.filter(value => value <= x).length);
    assert.equal(cdf.cdf, cdf.pooledCount / 2000);
    assert.ok(Math.abs(cdf.cdf - cdf.visitCounts.reduce((sum, count) => sum + count / 1000, 0) / 2) < 1e-14);
  }
  const result = fixture((role, visit, cycle) => visits[visit % 2][cycle]);
  const report = method.describeClusterFeasibility(result.rows, result.protocol, result.campaign);
  assert.equal(report.comparisons.find(row => row.percentile === 95).candidate, 2);
  assert.equal(report.comparisons.find(row => row.percentile === 99).candidate, 100);
  assert.notEqual(2, (1 + 2) / 2);
  assert.notEqual(100, (100 + 2) / 2);
});

test('conditional concentration depends on whole visits, never 2000 independent requests', () => {
  const ranks = method.clusterRanks(2, 99, alpha, 0);
  assert.equal(ranks.sampleCount, 2000);
  assert.equal(ranks.statisticalUnits, 2);
  assert.equal(ranks.upperRank, null);
  assert.ok(ranks.lowerRank > 0 && ranks.lowerRank < 1980);
  assert.equal(method.clusterRanks(10, 99, alpha, 0).upperRank, null);
});

test('bounded-CDF KL concentration uses the sharp endpoint rather than a loose range-only bound', () => {
  for (const [percentile, needed] of [[50, 12], [95, 156], [99, 793]]) {
    assert.equal(method.minimumFiniteUpperVisits(percentile, alpha, 0), needed);
    assert.equal(method.clusterRanks(needed - 1, percentile, alpha, 0).upperRank, null);
    const ranks = method.clusterRanks(needed, percentile, alpha, 0);
    assert.notEqual(ranks.upperRank, null);
    assert.ok(needed * method.binaryKl(ranks.upperRank / ranks.sampleCount, percentile / 100) >= Math.log(1 / alpha));
    assert.ok(needed * method.binaryKl((ranks.lowerRank - 1) / ranks.sampleCount, percentile / 100) >= Math.log(1 / alpha));
  }
  assert.equal(method.minimumFiniteUpperVisits(99, 0.05, 0), 299);
});

test('exact finite-tree coverage check allows history-dependent variance, not independent visits', () => {
  const count = 12;
  const a = 0.4;
  const ranks = method.clusterRanks(count, 50, a, 0);
  let upperFailures = 0;
  let lowerFailures = 0;
  let lowerQuantileFailures = 0;
  for (let mask = 0; mask < 2 ** count; mask++) {
    let previous = 0;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const spread = previous >= 0.5 ? 0.25 : 0.5;
      const low = 0.5 - spread;
      const high = 0.5 + spread;
      assert.equal((low + high) / 2, 0.5, 'Every conditional CDF mean is 0.5');
      previous = (mask & (1 << i)) ? high : low;
      sum += previous;
    }
    if (sum * 1000 >= ranks.upperRank) upperFailures++;
    if (sum * 1000 < ranks.lowerRank) lowerFailures++;
    // At a two-point target with F(10)=0.5, the true tied median is 10.
    if (sum * 1000 < ranks.lowerRank) lowerQuantileFailures++;
  }
  assert.ok(upperFailures > 0 && lowerFailures > 0, 'Nonvacuous finite-tree check');
  assert.ok(upperFailures / 2 ** count <= a);
  assert.ok(lowerFailures / 2 ** count <= a);
  assert.equal(lowerQuantileFailures, lowerFailures);
});

test('predictable CDF drift is added explicitly and cannot be estimated away from observations', () => {
  const noDrift = method.clusterRanks(793, 99, alpha, 0);
  assert.notEqual(noDrift.upperRank, null);
  assert.equal(method.clusterRanks(793, 99, alpha, 0.001).upperRank, null);
  assert.equal(method.minimumFiniteUpperVisits(99, alpha, 0.01), null);
  assert.throws(() => method.clusterRanks(10, 99, alpha), /drift bound/);
});

test('arbitrary common regimes impose a count-independent power obstruction at every percentile', () => {
  for (const percentile of [50, 95, 99]) {
    const result = method.unrestrictedPowerObstruction(percentile, 0.8, 0.05);
    assert.equal(result.trueQuantileRatio, 1.2);
    assert.ok(result.rareSlowProbability > 1 - percentile / 100);
    assert.ok(result.allFastProbability < percentile / 100, 'Mixture CDF at 10 lies below the target percentile');
    assert.ok(result.allFastProbability + result.rareSlowProbability >= percentile / 100,
      'Mixture CDF at 12 reaches the percentile, so the true candidate quantile is 12, not an averaged quantile');
    assert.ok(result.falseAdmissionLowerBound > 0.39);
    assert.ok(result.maximumNeutralPower < 0.101);
    assert.equal(result.independentOfFiniteVisitCount, true);
  }
  const result = method.unrestrictedPowerObstruction(99, 0.8, 0.05);
  assert.ok(Math.abs(result.falseAdmissionLowerBound - 0.79192) < 1e-14);
  assert.ok(Math.abs(result.maximumNeutralPower - 0.05 / 0.9899) < 1e-14);
});

test('a stationary ergodic sticky regime also defeats every finite count without a mixing-rate bound', () => {
  const epsilon = 0.0101;
  const transitionScale = 1e-6;
  assert.equal((1 - epsilon) * epsilon * transitionScale, epsilon * (1 - epsilon) * transitionScale);
  for (const visits of [4, 80, 318624]) {
    const allFast = method.stickyAllFastProbability(visits, epsilon, transitionScale);
    assert.ok(allFast * 0.8 > 0.78);
    assert.ok(allFast <= 1 - epsilon);
  }
  assert.equal(method.stickyAllFastProbability(80, epsilon, 0), 1 - epsilon);
});

test('even independent whole-visit regimes give a finite-budget power obstruction, not just a loose confidence bound', () => {
  const limit = method.independentRegimePowerLimit(80, 99, 0.8, 0.05);
  assert.equal(limit.necessaryInformativeVisits, 276);
  assert.ok(limit.maximumNeutralPowerLimit < 0.112);
  assert.ok(limit.exactBadModelFalseAdmissionLowerBound > 0.35);
  assert.ok(0.8 * 0.99 ** 275 > 0.05);
  assert.ok(0.8 * 0.99 ** 276 <= 0.05);
  assert.equal(limit.sufficientForDesiredPower, false);
});

test('dropping the predictable-drift restriction produces exact false coverage in the persistent-regime control', () => {
  const visits = 40000;
  const rareSlowProbability = 0.0101;
  const ranks = method.clusterRanks(visits, 99, alpha, 0);
  assert.notEqual(ranks.upperRank, null, 'Every finite rank equals 10 on the all-fast path');
  const actualFastPathDrift = rareSlowProbability * (visits - 1) / visits;
  assert.ok(actualFastPathDrift > 0.01);
  assert.equal(method.clusterRanks(visits, 99, alpha, actualFastPathDrift).upperRank, null);
  assert.ok(1 - rareSlowProbability > alpha, 'A finite upper endpoint 10 misses the true p99 of 12 with probability 0.9899');
});

test('neutral, within-visit drift and quota-scale correlated controls retain every pooled point ratio', () => {
  for (const transform of [
    () => 10,
    (role, visit, cycle) => 10 + cycle / 100,
    (role, visit, cycle) => cycle % 20 < 10 ? 10 : 30,
  ]) {
    const { rows, protocol, campaign } = fixture(transform);
    const report = method.describeClusterFeasibility(rows, protocol, campaign);
    assert.equal(report.comparisons.length, 12);
    assert.ok(report.comparisons.every(row => row.pointRatio === 1));
    assert.ok(report.comparisons.every(row => row.conditionalRatioUpper === null));
    assert.equal(report.admissionEligible, false);
    assert.equal(report.authorizedCampaignCount, null);
    assert.equal(Object.hasOwn(report, 'passed'), false);
  }
});

test('a greater-than-10% slowdown remains visible separately for every operation and percentile', () => {
  for (const operation of operations) {
    const { rows, protocol, campaign } = fixture((role, visit, cycle, op) =>
      role === 'candidate' && op === operation ? 12 : 10);
    const report = method.describeClusterFeasibility(rows, protocol, campaign);
    for (const row of report.comparisons) {
      assert.equal(row.pointRatio, row.operation === operation ? 1.2 : 1);
      assert.equal(row.originalAaPointWithinLimit, row.operation !== operation);
    }
  }
});

test('whole-visit shocks and tied observations are not discarded or relabeled as admission', () => {
  const { rows, protocol, campaign } = fixture((role, visit) => visit === 3 ? 20 : 10);
  const report = method.describeClusterFeasibility(rows, protocol, campaign);
  for (const row of report.comparisons) {
    assert.equal(row.pointRatio, row.percentile === 50 ? 1 : 2);
    assert.equal(row.originalAaPointWithinLimit, row.percentile === 50);
  }
  const tied = fixture(role => role === 'candidate' ? 11 : 10);
  const boundary = method.describeClusterFeasibility(tied.rows, tied.protocol, tied.campaign);
  assert.ok(boundary.comparisons.every(row => row.originalAaPointWithinLimit));
  assert.equal(boundary.admissionEligible, false);
});

test('fixed count, precision and runtime calculations keep work/step/job limits unchanged', () => {
  const { rows, protocol, campaign } = fixture();
  const report = method.describeClusterFeasibility(rows, protocol, campaign);
  const budget = report.fixedCountSensitivity;
  assert.equal(budget.workSeconds, 2700);
  assert.equal(budget.stepSeconds, 3300);
  assert.equal(budget.jobSeconds, 4500);
  assert.equal(budget.projectedVisitsPerRolePerBlock, 10);
  assert.equal(budget.projectedTotalVisits, 80);
  assert.equal(budget.exactConstantNeutralResolutionPower, 0);
  assert.equal(budget.optimisticAllVisitsInformativePower.necessaryInformativeVisits, 276);
  assert.ok(budget.optimisticNecessaryPowerSeconds > 9000);
  for (const row of budget.minimumFiniteUpper) {
    const needed = row.visitsPerRolePerBlock;
    assert.equal(method.clusterRanks(needed - 1, row.percentile, alpha, 0).upperRank, null);
    assert.notEqual(method.clusterRanks(needed, row.percentile, alpha, 0).upperRank, null);
  }
  const p99 = budget.minimumFiniteUpper.find(row => row.percentile === 99);
  assert.equal(p99.visitsPerRolePerBlock, 793);
  assert.ok(p99.projectedCampaignSeconds > 2 * 24 * 3600);
  assert.ok(p99.requiredAverageVisitSeconds < 0.43);
  assert.equal(p99.sufficientForTenPercentPrecision, false);
});

test('invalid or partial evidence cannot produce a feasibility receipt', () => {
  const invalid = [
    f => f.rows.pop(),
    f => f.rows[0].samples.add.pop(),
    f => { f.rows[0].samples.remove[0] = NaN; },
    f => { f.rows[0].diagnosticOnly = false; },
    f => { f.rows[0].cpuMax = '50000 1000000'; },
    f => { f.rows[0].warmupIterations = 1000; },
    f => { f.campaign.AdmissionEligible = true; },
    f => { f.campaign.Blocks[0].DiagnosticComplete = false; },
    f => { f.campaign.WarmupIterations = 1000; },
    f => { f.campaign.FinishedAtUtc = 'invalid'; },
    f => { f.campaign.FinishedAtUtc = '2026-11-03T12:20:00Z'; },
  ];
  for (const mutate of invalid) {
    const input = fixture();
    mutate(input);
    assert.throws(() => method.describeClusterFeasibility(input.rows, input.protocol, input.campaign));
  }
  for (const args of [[0, 99, alpha, 0], [1e6 + 1, 99, alpha, 0], [10, 90, alpha, 0],
    [10, 99, 0, 0], [10, 99, alpha, -0.1], [10, 99, alpha, NaN]]) {
    assert.throws(() => method.clusterRanks(...args));
  }
});

test('native CLI binds parsed bytes, rejects overwrite and oversized inputs, and never invokes an allocator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-cluster-'));
  try {
    const input = fixture();
    const files = ['protocol', 'rows', 'campaign'].map(key => {
      const file = path.join(dir, `${key}.json`);
      fs.writeFileSync(file, JSON.stringify(input[key]));
      return file;
    });
    const output = path.join(dir, 'result.json');
    const run = () => spawnSync(process.execPath, [script, ...files, output], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    });
    const child = run();
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    const { createHash } = require('node:crypto');
    for (let i = 0; i < files.length; i++) {
      assert.equal(report.inputHashes[['protocol', 'rounds', 'campaign'][i]],
        createHash('sha256').update(fs.readFileSync(files[i])).digest('hex'));
    }
    assert.equal(report.admissionEligible, false);
    assert.equal(report.authorizedCampaignCount, null);
    const before = fs.readFileSync(output);
    assert.notEqual(run().status, 0);
    assert.deepEqual(fs.readFileSync(output), before);
    fs.writeFileSync(files[1], Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    const oversized = run();
    assert.notEqual(oversized.status, 0);
    assert.match(oversized.stderr, /4 MiB/);
    assert.deepEqual(fs.readFileSync(output), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
