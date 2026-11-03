const assert = require('node:assert/strict');
const fs = require('node:fs');

const operations = ['add', 'populatedRead', 'remove', 'emptyRead'];
const schedules = {
  BAAB: ['candidate', 'baseline', 'baseline', 'candidate'],
  ABBA: ['baseline', 'candidate', 'candidate', 'baseline'],
};

function validateProtocol(protocol) {
  assert.equal(protocol.version, 1);
  assert.equal(protocol.cpuLimit, 0.5);
  assert.equal(protocol.memoryLimit, 1073741824);
  assert.equal(protocol.warmupIterations, 100);
  assert.equal(protocol.samplesPerRound, 1000);
  assert.equal(protocol.ceilingRatio, 1.1);
  assert.deepEqual(protocol.blocks, [
    { name: 'aa-baab', sameImage: true, order: 'BAAB' },
    { name: 'aa-abba', sameImage: true, order: 'ABBA' },
    { name: 'ab-baab', sameImage: false, order: 'BAAB' },
    { name: 'ab-abba', sameImage: false, order: 'ABBA' },
  ]);
  for (const role of ['baseline', 'candidate']) {
    if (role === 'candidate' && protocol.candidate.sourceCommit !== undefined) {
      assert.match(protocol.candidate.sourceCommit, /^[a-f0-9]{40}$/);
      assert.match(protocol.candidate.image, /^sha256:[a-f0-9]{64}$/);
    } else {
      assert.match(protocol[role].image, /^ghcr\.io\/pranems\/scimserver@sha256:[a-f0-9]{64}$/);
    }
    assert.match(protocol[role].version, /^\d+\.\d+\.\d+$/);
  }
  assert.match(protocol.postgres, /^postgres@sha256:[a-f0-9]{64}$/);
}

function checkoutProtocol(protocol, identity, sourceCommit, version) {
  validateProtocol(protocol);
  assert.match(sourceCommit, /^[a-f0-9]{40}$/, 'Exact checkout commit required');
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Exact package version required');
  assert.match(identity.id, /^sha256:[a-f0-9]{64}$/, 'Immutable local image ID required');
  assert.equal(identity.os, 'linux', 'Linux image required');
  assert.equal(identity.architecture, 'amd64', 'Original x64 measurement architecture required');
  assert.equal(identity.sourceCommit, sourceCommit, 'Image revision must match the checkout');
  const current = structuredClone(protocol);
  current.candidate = { image: identity.id, version, sourceCommit };
  validateProtocol(current);
  return current;
}

function rolesFor(protocol, block) {
  validateProtocol(protocol);
  assert.deepEqual(protocol.blocks.find(item => item.name === block.name), block);
  return { baseline: block.sameImage ? protocol.candidate : protocol.baseline, candidate: protocol.candidate };
}

function sortedPercentile(values, percentile) {
  return values[Math.ceil(values.length * percentile / 100) - 1];
}

function assessBlock(rows, block, roles) {
  assert.ok(Object.hasOwn(schedules, block.order), 'Unknown round order');
  assert.equal(typeof block.sameImage, 'boolean');
  assert.equal(rows.length, 4, 'Exactly four round receipts are required');
  assert.deepEqual(rows.map(row => row.role), schedules[block.order], 'Actual role order must match preregistration');
  for (const row of rows) {
    assert.ok(!Object.hasOwn(row, 'diagnosticOnly'), 'Diagnostic receipts cannot enter release admission');
    assert.equal(row.status, 'PASS', 'Failed receipts cannot be admitted');
    assert.equal(row.complete, true, 'Partial receipts cannot be admitted');
    assert.equal(row.image, roles[row.role].image, 'Round image identity');
    assert.equal(row.version, roles[row.role].version, 'Round version identity');
    assert.equal(row.cpuLimit, 0.5, 'Actual CPU quota');
    assert.equal(row.memoryLimit, 1073741824, 'Actual memory quota');
    assert.equal(row.warmupIterations, 100, 'Original warmup');
    assert.equal(row.requestCount, 4407, 'Complete lifecycle, version and cleanup requests');
    assert.deepEqual(Object.keys(row.samples).sort(), [...operations].sort());
    for (const values of Object.values(row.samples)) {
      assert.equal(values.length, 1000, 'Every measured sample must be retained');
      assert.ok(values.every(value => Number.isFinite(value) && value > 0), 'Invalid latency sample');
    }
  }
  const checks = operations.flatMap(operation => {
    const values = role => rows.filter(row => row.role === role).flatMap(row => row.samples[operation]).sort((a, b) => a - b);
    const baseline = values('baseline');
    const candidate = values('candidate');
    return [50, 95, 99].map(percentile => {
      const baselineMs = sortedPercentile(baseline, percentile);
      const candidateMs = sortedPercentile(candidate, percentile);
      const ratio = candidateMs / baselineMs;
      return {
        operation, percentile, samplesPerRole: 2000, baselineMs, candidateMs, ratio,
        passed: ratio <= 1.1 && (!block.sameImage || ratio >= 1 / 1.1),
      };
    });
  });
  return { block: block.name, sameImage: block.sameImage, passed: checks.every(check => check.passed), checks };
}

function describeStability(rows, block, roles) {
  const qualificationAssessment = assessBlock(rows, block, roles);
  const visits = { baseline: 0, candidate: 0 };
  const rounds = rows.map((row, index) => ({
    round: index + 1,
    role: row.role,
    visit: ++visits[row.role],
    operations: Object.fromEntries(operations.map(operation => {
      const windows = Array.from({ length: 4 }, (_, window) => {
        const startCycle = window * 250;
        const samples = row.samples[operation].slice(startCycle, startCycle + 250);
        const values = [...samples].sort((a, b) => a - b);
        return {
          startCycle, endCycleExclusive: startCycle + 250, sampleCount: values.length,
          samples,
          p50: sortedPercentile(values, 50),
          p95: sortedPercentile(values, 95),
          p99: sortedPercentile(values, 99),
        };
      });
      return [operation, {
        windows,
        lastToFirstP95Ratio: windows[3].p95 / windows[0].p95,
      }];
    })),
  }));
  return {
    diagnosticOnly: true,
    admissionEligible: false,
    uncertaintyEstimated: false,
    warmupConvergenceEstablished: false,
    images: structuredClone(roles),
    notes: [
      'Chronological windows describe retained observations, not independent replications.',
      'Cycle bounds are zero-based measured cycles after the protocol warmup.',
      'Window ratios are not subject to the original pooled 2000-sample admission bounds.',
      'No causal attribution, false-failure probability or acceptable warmup is inferred.',
      'The original assessment and every sample are preserved without changing the protocol.',
    ],
    qualificationAssessment,
    rounds,
  };
}

module.exports = { assessBlock, checkoutProtocol, describeStability, rolesFor, validateProtocol };

if (require.main === module) {
  try {
    if (process.argv[2] === '--checkout-image') {
      const [, protocolPath, identityPath, sourceCommit, version, output] = process.argv.slice(2);
      assert.equal(process.argv.length, 8, 'Explicit protocol, identity, commit, version and new output required');
      const current = checkoutProtocol(
        JSON.parse(fs.readFileSync(protocolPath, 'utf8')),
        JSON.parse(fs.readFileSync(identityPath, 'utf8')), sourceCommit, version,
      );
      fs.writeFileSync(output, `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx' });
    } else if (process.argv[2] === '--describe-stability') {
      assert.equal(process.argv.length, 7, 'Explicit protocol, block, receipts and new output required');
      const [protocolPath, blockName, rowsPath, output] = process.argv.slice(3);
      const protocolBytes = fs.readFileSync(protocolPath);
      const rowsBytes = fs.readFileSync(rowsPath);
      const protocol = JSON.parse(protocolBytes.toString('utf8'));
      const block = protocol.blocks.find(item => item.name === blockName);
      assert.ok(block, 'Unknown preregistered block');
      const report = describeStability(
        JSON.parse(rowsBytes.toString('utf8')), block, rolesFor(protocol, block),
      );
      const { createHash } = require('node:crypto');
      report.inputHashes = Object.fromEntries([
        ['protocol', protocolBytes], ['rounds', rowsBytes],
      ].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
      console.log('Descriptive analysis complete; no stability or deployment admission.');
    } else {
      const [protocolPath, blockName, rowsPath, output] = process.argv.slice(2);
      assert.ok(protocolPath && blockName && rowsPath && output, 'Explicit protocol, block, receipts and output required');
      const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
      const block = protocol.blocks.find(item => item.name === blockName);
      assert.ok(block, 'Unknown preregistered block');
      const result = assessBlock(JSON.parse(fs.readFileSync(rowsPath, 'utf8')), block, rolesFor(protocol, block));
      fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
      console.table(result.checks);
      if (!result.passed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
