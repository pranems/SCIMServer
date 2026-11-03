const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { validateCalibrationRows, readBounded, nearestRank } = require('./membership-precision.cjs');

const operations = ['add', 'populatedRead', 'remove', 'emptyRead'];
const percentiles = [50, 95, 99];
const samplesPerVisit = 1000;
const familyAlpha = 0.05;
const componentBounds = 144;
const boundAlpha = familyAlpha / componentBounds;
const maxVisits = 1000000;

function binaryKl(t, q) {
  assert.ok(Number.isFinite(t) && t >= 0 && t <= 1 && Number.isFinite(q) && q >= 0 && q <= 1,
    'Binary relative entropy requires probabilities in [0,1]');
  if (t === q) return 0;
  if (q === 0 || q === 1) return Infinity;
  if (t === 0) return -Math.log1p(-q);
  if (t === 1) return -Math.log(q);
  return t * Math.log(t / q) + (1 - t) * Math.log((1 - t) / (1 - q));
}

function tailThreshold(q, exponent, upper) {
  if (q <= 0 || q >= 1 || binaryKl(upper ? 1 : 0, q) < exponent) return null;
  let low = upper ? q : 0;
  let high = upper ? 1 : q;
  for (let i = 0; i < 80; i++) {
    const midpoint = (low + high) / 2;
    if ((binaryKl(midpoint, q) >= exponent) === upper) high = midpoint;
    else low = midpoint;
  }
  return upper ? high : low;
}

function clusterRanks(visits, percentile, alpha, predictableCdfDriftBound) {
  assert.ok(Number.isInteger(visits) && visits > 0 && visits <= maxVisits, 'Whole-visit count outside fixed calculation bounds');
  assert.ok(percentiles.includes(percentile), 'All and only original percentiles are supported');
  assert.ok(Number.isFinite(alpha) && alpha > 0 && alpha < 0.5, 'Invalid one-sided error budget');
  assert.ok(Number.isFinite(predictableCdfDriftBound) && predictableCdfDriftBound >= 0
    && predictableCdfDriftBound <= 1, 'An explicit prospective predictable-CDF drift bound is required');
  const sampleCount = visits * samplesPerVisit;
  const exponent = Math.log(1 / alpha) / visits;
  const qLower = percentile / 100 - predictableCdfDriftBound;
  const qUpper = percentile / 100 + predictableCdfDriftBound;
  const lowerThreshold = tailThreshold(qLower, exponent, false);
  const upperThreshold = tailThreshold(qUpper, exponent, true);
  let lower = lowerThreshold === null ? 0 : Math.floor(sampleCount * lowerThreshold) + 1;
  let upper = upperThreshold === null ? sampleCount + 1 : Math.ceil(sampleCount * upperThreshold);
  // Verify discrete tail exponents after floating-point inversion and rank conversion.
  while (lower > 0 && binaryKl((lower - 1) / sampleCount, qLower) < exponent) lower--;
  while (upper <= sampleCount && binaryKl(upper / sampleCount, qUpper) < exponent) upper++;
  return {
    visits, statisticalUnits: visits, sampleCount, predictableCdfDriftBound,
    lowerThreshold, upperThreshold,
    lowerRank: lower >= 1 && lower <= sampleCount ? lower : null,
    upperRank: upper >= 1 && upper <= sampleCount ? upper : null,
  };
}

function clusterCdfAt(visits, threshold) {
  assert.ok(Array.isArray(visits) && visits.length > 0 && visits.length <= 100,
    'Offline CDF evaluation requires 1 to 100 retained visits');
  assert.ok(Number.isFinite(threshold), 'Finite CDF threshold required');
  const visitCounts = visits.map(samples => {
    assert.ok(Array.isArray(samples) && samples.length === samplesPerVisit, '1000 original samples per visit required');
    assert.ok(samples.every(value => Number.isFinite(value) && value > 0), 'Positive finite observations required');
    return samples.filter(value => value <= threshold).length;
  });
  const pooledCount = visitCounts.reduce((sum, count) => sum + count, 0);
  return { visitCounts, pooledCount, sampleCount: visits.length * samplesPerVisit,
    cdf: pooledCount / (visits.length * samplesPerVisit) };
}

function minimumFiniteUpperVisits(percentile, alpha, drift) {
  clusterRanks(1, percentile, alpha, drift);
  const q = percentile / 100 + drift;
  if (q >= 1) return null;
  let visits = Math.ceil(Math.log(1 / alpha) / -Math.log(q));
  if (visits > maxVisits) return null;
  while (clusterRanks(visits, percentile, alpha, drift).upperRank === null) {
    if (++visits > maxVisits) return null;
  }
  return visits;
}

function unrestrictedPowerObstruction(percentile, neutralPower, falseAdmissionBudget) {
  assert.ok(percentiles.includes(percentile), 'Original percentile required');
  assert.ok(Number.isFinite(neutralPower) && neutralPower > 0 && neutralPower <= 1, 'Invalid neutral power');
  assert.ok(Number.isFinite(falseAdmissionBudget) && falseAdmissionBudget > 0 && falseAdmissionBudget < 1,
    'Invalid false-admission budget');
  const rareSlowProbability = 1 - percentile / 100 + 0.0001;
  const allFastProbability = 1 - rareSlowProbability;
  return {
    percentile, rareSlowProbability, allFastProbability,
    trueQuantileRatio: 1.2, neutralPower, falseAdmissionBudget,
    falseAdmissionLowerBound: allFastProbability * neutralPower,
    maximumNeutralPower: Math.min(1, falseAdmissionBudget / allFastProbability),
    independentOfFiniteVisitCount: true,
  };
}

function stickyAllFastProbability(visits, slowProbability, transitionScale) {
  assert.ok(Number.isInteger(visits) && visits > 0 && visits <= maxVisits, 'Invalid finite horizon');
  assert.ok(Number.isFinite(slowProbability) && slowProbability > 0 && slowProbability < 1, 'Invalid regime probability');
  assert.ok(Number.isFinite(transitionScale) && transitionScale >= 0 && transitionScale <= 1, 'Invalid transition scale');
  return (1 - slowProbability) * Math.exp((visits - 1) * Math.log1p(-slowProbability * transitionScale));
}

function independentRegimePowerLimit(visits, percentile, neutralPower, falseAdmissionBudget) {
  const obstruction = unrestrictedPowerObstruction(percentile, neutralPower, falseAdmissionBudget);
  assert.ok(Number.isInteger(visits) && visits > 0 && visits <= maxVisits, 'Invalid informative-visit count');
  const limitingAllFastProbability = Math.exp(visits * Math.log(percentile / 100));
  return {
    informativeVisits: visits,
    exactBadModelFalseAdmissionLowerBound: neutralPower * Math.exp(visits * Math.log(obstruction.allFastProbability)),
    maximumNeutralPowerLimit: Math.min(1, falseAdmissionBudget / limitingAllFastProbability),
    necessaryInformativeVisits: Math.max(0,
      Math.ceil(Math.log(falseAdmissionBudget / neutralPower) / Math.log(percentile / 100))),
    sufficientForDesiredPower: false,
    interpretation: 'Necessary power constraint over independent Bernoulli whole-visit regimes as rare probability decreases to the percentile tail. A counterexample subclass, not an independence assumption about actual receipts. All visits are optimistically informative; no cross-block pooling is authorized.',
  };
}

function describeClusterFeasibility(rows, protocol, campaign) {
  const warmup = validateCalibrationRows(rows, protocol);
  assert.equal(campaign.Mode, 'Warmup calibration diagnostic only', 'Diagnostic campaign required');
  assert.equal(campaign.AdmissionEligible, false, 'Diagnostic cannot be admission eligible');
  assert.equal(campaign.WarmupIterations, warmup, 'Campaign and observed warmup must match');
  assert.equal(campaign.Status, 'DIAGNOSTIC COMPLETE: CPU temporal association only; not release admission',
    'Complete diagnostic campaign required');
  assert.deepEqual(campaign.Blocks, [{ Name: 'aa-baab', DiagnosticComplete: true, AdmissionEligible: false }],
    'One complete original diagnostic block required');
  const observedBlockSeconds = (Date.parse(campaign.FinishedAtUtc) - Date.parse(campaign.StartedAtUtc)) / 1000;
  assert.ok(Number.isFinite(observedBlockSeconds) && observedBlockSeconds > 0 && observedBlockSeconds <= 900,
    'Finite positive diagnostic runtime within the original 15-minute work budget required');
  const comparisons = operations.flatMap(operation => {
    const values = Object.fromEntries(['baseline', 'candidate'].map(role => [role,
      rows.filter(row => row.role === role).flatMap(row => row.samples[operation]).sort((a, b) => a - b),
    ]));
    return percentiles.map(percentile => {
      const ranks = clusterRanks(2, percentile, boundAlpha, 0);
      const candidate = nearestRank(values.candidate, percentile);
      const baseline = nearestRank(values.baseline, percentile);
      const pointRatio = candidate / baseline;
      const quantileBounds = Object.fromEntries(Object.entries(values).map(([role, samples]) => [role, {
        lower: ranks.lowerRank === null ? null : samples[ranks.lowerRank - 1],
        upper: ranks.upperRank === null ? null : samples[ranks.upperRank - 1],
      }]));
      return {
        operation, percentile, candidate, baseline, pointRatio,
        originalAaPointWithinLimit: pointRatio >= 1 / 1.10 && pointRatio <= 1.10,
        conditionalZeroDriftSensitivity: { ranks, quantileBounds },
        conditionalRatioUpper: quantileBounds.candidate.upper === null || quantileBounds.baseline.lower === null
          ? null : quantileBounds.candidate.upper / quantileBounds.baseline.lower,
        conditionalRatioLower: quantileBounds.candidate.lower === null || quantileBounds.baseline.upper === null
          ? null : quantileBounds.candidate.lower / quantileBounds.baseline.upper,
      };
    });
  });
  const workSeconds = 2700;
  const averageVisitSeconds = observedBlockSeconds / 4;
  const visitsPerRolePerBlock = Math.floor(workSeconds / (8 * averageVisitSeconds));
  assert.ok(visitsPerRolePerBlock > 0 && visitsPerRolePerBlock <= maxVisits, 'Runtime projection outside calculation bounds');
  const countRanks = percentiles.map(percentile => clusterRanks(visitsPerRolePerBlock, percentile, boundAlpha, 0));
  const optimisticPower = independentRegimePowerLimit(8 * visitsPerRolePerBlock, 99, 0.8, familyAlpha);
  return {
    diagnosticOnly: true, admissionEligible: false, authorizedCampaignCount: null,
    status: 'INFEASIBLE_WITHOUT_A_QUANTITATIVE_DEPENDENCE_RESTRICTION',
    sourceCommit: protocol.candidate.sourceCommit, image: protocol.candidate.image,
    version: protocol.candidate.version, warmupIterations: warmup,
    familyAlpha, componentBounds, boundAlpha,
    coverageEstablishedForActualReceipts: false,
    conditionalCoverage: {
      target: 'Quantile of the fixed-horizon average marginal visit CDF, not the average visit quantile or a history-conditioned replacement target.',
      requiredAssumption: 'A prospective almost-sure bound delta on the difference between average predictable visit CDF and target CDF, at each required quantile and its left limit.',
      independentVisitsRequired: false,
      actualPredictableCdfDriftBound: null,
      sensitivityOnlyDriftBound: 0,
      bound: 'For t < p-delta or t > p+delta, each CDF tail is bounded by exp(-R*kl(t,p-/+delta)). Invert the bounded-variable conditional MGF at fixed R, then verify the discrete rank exponent.',
      familyStatement: 'A union bound over 144 endpoints gives at most 5% probability of any erroneous endpoint without independence between metrics or blocks, IF every drift restriction holds.',
      admissionStatement: 'An upper ratio at most 1.10 only bounds false admission for true ratios strictly above 1.10. A/A also needs the reciprocal lower bound.',
    },
    comparisons,
    unrestrictedDependence: percentiles.map(percentile => unrestrictedPowerObstruction(percentile, 0.8, familyAlpha)),
    fixedCountSensitivity: {
      workSeconds, stepSeconds: 3300, jobSeconds: 4500,
      observedBlockSeconds, runtimeResolutionMilliseconds: 1, observedVisits: 4, averageVisitSeconds,
      projectedVisitsPerRolePerBlock: visitsPerRolePerBlock,
      projectedTotalVisits: 8 * visitsPerRolePerBlock,
      projectedWorkSeconds: 8 * visitsPerRolePerBlock * averageVisitSeconds,
      conditionalZeroDriftRanks: countRanks,
      exactConstantNeutralResolutionPower: countRanks.every(row => row.lowerRank !== null && row.upperRank !== null) ? 1 : 0,
      optimisticAllVisitsInformativePower: optimisticPower,
      optimisticNecessaryPowerSeconds: optimisticPower.necessaryInformativeVisits * averageVisitSeconds,
      interpretation: 'Linear measured-cost sensitivity, not a runtime guarantee, accepted model, admission decision, or permission to allocate. Constant-model power is analytic and conditional, not actual-data power.',
      minimumFiniteUpper: percentiles.map(percentile => {
        const visits = minimumFiniteUpperVisits(percentile, boundAlpha, 0);
        assert.notEqual(visits, null, 'Sensitivity count exceeds fixed calculation bound');
        return {
          percentile, visitsPerRolePerBlock: visits, totalCampaignVisits: 8 * visits,
          projectedCampaignSeconds: 8 * visits * averageVisitSeconds,
          requiredAverageVisitSeconds: workSeconds / (8 * visits),
          sufficientForTenPercentPrecision: false,
        };
      }),
    },
    missingExternalInput: 'Externally justified quantitative restrictions on predictable-CDF drift AND within-visit CDF variation or timing dependence for this workload/resource policy, strong enough for coverage AND power in the unchanged budget. Independent visits alone are insufficient for the unrestricted within-visit class at measured cost. Finite ACFs and process resets cannot supply these restrictions.',
  };
}

module.exports = {
  binaryKl, clusterCdfAt, clusterRanks, minimumFiniteUpperVisits, unrestrictedPowerObstruction,
  stickyAllFastProbability, independentRegimePowerLimit, describeClusterFeasibility,
};

if (require.main === module) {
  try {
    assert.equal(process.argv.length, 6, 'Explicit protocol, diagnostic rounds, campaign and new output required');
    const [protocolPath, roundsPath, campaignPath, output] = process.argv.slice(2);
    const protocol = readBounded(protocolPath);
    const rounds = readBounded(roundsPath);
    const campaign = readBounded(campaignPath);
    const report = describeClusterFeasibility(JSON.parse(rounds.toString('utf8')),
      JSON.parse(protocol.toString('utf8')), JSON.parse(campaign.toString('utf8')));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    report.inputHashes = { protocol: hash(protocol), rounds: hash(rounds), campaign: hash(campaign) };
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    console.error(`Cluster-CDF feasibility failed: ${error.message}`);
    process.exitCode = 1;
  }
}
