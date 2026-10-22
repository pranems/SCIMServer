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
    assert.match(protocol[role].image, /^ghcr\.io\/pranems\/scimserver@sha256:[a-f0-9]{64}$/);
    assert.match(protocol[role].version, /^\d+\.\d+\.\d+$/);
  }
  assert.match(protocol.postgres, /^postgres@sha256:[a-f0-9]{64}$/);
}

function rolesFor(protocol, block) {
  validateProtocol(protocol);
  assert.deepEqual(protocol.blocks.find(item => item.name === block.name), block);
  return { baseline: block.sameImage ? protocol.candidate : protocol.baseline, candidate: protocol.candidate };
}

function assessBlock(rows, block, roles) {
  assert.ok(Object.hasOwn(schedules, block.order), 'Unknown round order');
  assert.equal(typeof block.sameImage, 'boolean');
  assert.equal(rows.length, 4, 'Exactly four round receipts are required');
  assert.deepEqual(rows.map(row => row.role), schedules[block.order], 'Actual role order must match preregistration');
  for (const row of rows) {
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
      const index = Math.ceil(2000 * percentile / 100) - 1;
      const baselineMs = baseline[index];
      const candidateMs = candidate[index];
      const ratio = candidateMs / baselineMs;
      return {
        operation, percentile, samplesPerRole: 2000, baselineMs, candidateMs, ratio,
        passed: ratio <= 1.1 && (!block.sameImage || ratio >= 1 / 1.1),
      };
    });
  });
  return { block: block.name, sameImage: block.sameImage, passed: checks.every(check => check.passed), checks };
}

module.exports = { assessBlock, rolesFor, validateProtocol };

if (require.main === module) {
  try {
    const [protocolPath, blockName, rowsPath, output] = process.argv.slice(2);
    assert.ok(protocolPath && blockName && rowsPath && output, 'Explicit protocol, block, receipts and output required');
    const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
    const block = protocol.blocks.find(item => item.name === blockName);
    assert.ok(block, 'Unknown preregistered block');
    const result = assessBlock(JSON.parse(fs.readFileSync(rowsPath, 'utf8')), block, rolesFor(protocol, block));
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.table(result.checks);
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
