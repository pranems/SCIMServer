const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const keys = ['usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec'];
const operations = ['add', 'populatedRead', 'remove', 'emptyRead'];

function parseCounters(text) {
  const result = {};
  for (const line of text.trim().split(/\r?\n/)) {
    const [key, value] = line.trim().split(/\s+/);
    if (!keys.includes(key)) continue;
    assert.ok(!Object.hasOwn(result, key), 'Duplicate CPU counter');
    assert.match(value, /^\d+$/, 'Invalid CPU counter');
    const number = Number(value);
    assert.ok(Number.isSafeInteger(number), 'Unsafe CPU counter');
    result[key] = number;
  }
  for (const key of keys)
    assert.ok(Object.hasOwn(result, key), 'Missing CPU counter');
  return result;
}

function lowerBound(items, field, target) {
  let first = 0;
  let last = items.length;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (BigInt(items[middle][field]) < target) first = middle + 1;
    else last = middle;
  }
  return first;
}

function correlate(observations, spans) {
  assert.ok(observations.length >= 2, 'Insufficient CPU timeline');
  for (const [index, item] of observations.entries()) {
    assert.match(item.ns, /^\d+$/);
    assert.match(item.readStartNs, /^\d+$/);
    assert.ok(BigInt(item.readStartNs) <= BigInt(item.ns));
    if (index) {
      assert.ok(
        BigInt(observations[index - 1].ns) < BigInt(item.readStartNs),
        'Nonmonotonic observation clock',
      );
    }
    for (const key of keys) {
      assert.ok(
        Number.isSafeInteger(item[key]) && item[key] >= 0,
        'Invalid timeline counter',
      );
      if (index)
        assert.ok(
          item[key] >= observations[index - 1][key],
          'CPU counters reset',
        );
    }
  }
  return spans.map((span) => {
    const start = BigInt(span.startNs);
    const end = BigInt(span.endNs);
    assert.ok(
      start >= BigInt(observations[0].readStartNs) &&
        end <= BigInt(observations.at(-1).ns),
      'CPU observer does not cover the request clock',
    );
    assert.ok(end > start, 'Invalid request span');
    const first = lowerBound(observations, 'readStartNs', start);
    const last = lowerBound(observations, 'ns', end + 1n) - 1;
    const count = Math.max(0, last - first + 1);
    if (count < 2)
      return {
        classification: 'insufficient-interior-samples',
        observationsInside: count,
        throttleEvents: null,
        throttledMicroseconds: null,
      };
    const events =
      observations[last].nr_throttled - observations[first].nr_throttled;
    return {
      classification:
        events > 0
          ? 'counter-increased-inside-span'
          : 'no-counter-increase-observed-inside-span',
      observationsInside: count,
      throttleEvents: events,
      throttledMicroseconds:
        observations[last].throttled_usec - observations[first].throttled_usec,
    };
  });
}

async function monitor([directory, output, ready, stop, deadlineText]) {
  assert.ok(
    directory && output && ready && stop,
    'Explicit observer paths required',
  );
  const deadline = Number(deadlineText);
  assert.ok(
    Number.isSafeInteger(deadline) && deadline > Date.now(),
    'Valid observer deadline required',
  );
  const receipt = {
    diagnosticOnly: true,
    admissionEligible: false,
    complete: false,
    failure: null,
    failureStage: 'quota',
    clock: 'process.hrtime.bigint',
    pollIntervalMs: 2,
    sampleCap: 120000,
    cpuMax: null,
    observerCpuMicroseconds: null,
    observations: [],
  };
  const initialCpu = process.cpuUsage();
  function snapshot() {
    if (receipt.observations.length >= receipt.sampleCap) {
      receipt.failure = 'SAMPLE_CAP_REACHED';
      throw new Error('Observer sample cap reached');
    }
    const readStartNs = process.hrtime.bigint().toString();
    const counters = parseCounters(
      fs.readFileSync(path.join(directory, 'cpu.stat'), 'utf8'),
    );
    receipt.observations.push({
      readStartNs,
      ns: process.hrtime.bigint().toString(),
      ...counters,
    });
  }
  try {
    receipt.cpuMax = fs
      .readFileSync(path.join(directory, 'cpu.max'), 'utf8')
      .trim();
    assert.equal(
      receipt.cpuMax,
      '50000 100000',
      'Original quota/period required',
    );
    receipt.failureStage = 'initial-counters';
    snapshot();
    receipt.failureStage = 'readiness';
    fs.writeFileSync(ready, '');
    receipt.failureStage = 'sampling';
    while (!fs.existsSync(stop)) {
      if (Date.now() >= deadline) {
        receipt.failure = 'DEADLINE_REACHED';
        throw new Error('Observer deadline reached');
      }
      snapshot();
      await delay(receipt.pollIntervalMs);
    }
    receipt.failureStage = 'final-counters';
    snapshot();
    receipt.complete = true;
    receipt.failureStage = null;
  } catch (error) {
    receipt.failure ??= 'INVALID_OR_UNAVAILABLE_COUNTERS';
    console.error(
      `CPU timeline failed at ${receipt.failureStage}: ${receipt.failure} (${error.code ?? error.name}); no attribution or admission.`,
    );
    process.exitCode = 1;
  } finally {
    const used = process.cpuUsage(initialCpu);
    receipt.observerCpuMicroseconds = used.user + used.system;
    fs.writeFileSync(output, `${JSON.stringify(receipt)}\n`);
  }
}

function percentile(values, q) {
  assert.ok(
    values.length > 0 &&
      values.every((value) => Number.isFinite(value) && value > 0),
  );
  return [...values].sort((a, b) => a - b)[
    Math.ceil((values.length * q) / 100) - 1
  ];
}

function analyze(directory) {
  const load = (name) =>
    JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const rows = load('rounds.json');
  assert.equal(
    rows.length,
    4,
    'Exactly the diagnostic four-round block required',
  );
  assert.deepEqual(
    rows.map((row) => row.role),
    ['candidate', 'baseline', 'baseline', 'candidate'],
  );
  const frames = [];
  const observerCosts = [];
  for (const [index, row] of rows.entries()) {
    assert.equal(row.diagnosticOnly, true);
    assert.equal(row.status, 'PASS');
    assert.equal(row.complete, true);
    assert.equal(row.cpuMax, '50000 100000');
    assert.equal(row.cpuLimit, 0.5);
    assert.equal(row.memoryLimit, 1073741824);
    assert.equal(row.requestCount, 4407);
    assert.equal(
      row.image,
      rows[0].image,
      'Diagnostic uses the same image in both roles',
    );
    const client = load(`round-${index + 1}-${row.role}.json`);
    const cpu = load(`round-${index + 1}-${row.role}-cpu.json`);
    assert.equal(client.diagnosticOnly, true);
    assert.equal(client.traceClock, 'process.hrtime.bigint');
    assert.equal(client.complete, true);
    assert.equal(client.spans.length, 4407);
    assert.equal(cpu.diagnosticOnly, true);
    assert.equal(cpu.admissionEligible, false);
    assert.equal(cpu.complete, true);
    assert.equal(
      cpu.clock,
      'process.hrtime.bigint',
      'Observer and client must share the monotonic clock',
    );
    assert.ok(
      Number.isSafeInteger(cpu.observerCpuMicroseconds) &&
        cpu.observerCpuMicroseconds >= 0,
      'Observer cost must be retained',
    );
    assert.equal(cpu.cpuMax, row.cpuMax);
    const associations = correlate(cpu.observations, client.spans);
    for (const operation of operations) {
      const measured = client.spans.filter(
        (span) => span.operation === operation && span.phase === 'measured',
      );
      assert.equal(measured.length, 1000);
      assert.deepEqual(
        measured.map((span) => span.ms),
        row.samples[operation],
        'Every original sample retained',
      );
      assert.deepEqual(
        measured.map((span) => span.cycle),
        Array.from({ length: 1000 }, (_, i) => i),
      );
    }
    let maximumGapNs = 0n;
    for (let i = 1; i < cpu.observations.length; i++) {
      const gap =
        BigInt(cpu.observations[i].ns) - BigInt(cpu.observations[i - 1].ns);
      if (gap > maximumGapNs) maximumGapNs = gap;
    }
    observerCosts.push({
      round: index + 1,
      role: row.role,
      observations: cpu.observations.length,
      maximumGapMs: Number(maximumGapNs) / 1e6,
      observerCpuMicroseconds: cpu.observerCpuMicroseconds,
    });
    client.spans.forEach((span, i) =>
      frames.push({
        ...span,
        role: row.role,
        round: index + 1,
        ...associations[i],
      }),
    );
  }
  const comparisons = ['baseline', 'candidate'].flatMap((role) =>
    operations.map((operation) => {
      const selected = frames.filter(
        (frame) =>
          frame.role === role &&
          frame.operation === operation &&
          frame.phase === 'measured',
      );
      const tail = percentile(
        selected.map((frame) => frame.ms),
        99,
      );
      const tailFrames = selected.filter((frame) => frame.ms >= tail);
      const count = (items, classification) =>
        items.filter((item) => item.classification === classification).length;
      return {
        role,
        operation,
        samples: selected.length,
        p50: percentile(
          selected.map((frame) => frame.ms),
          50,
        ),
        p95: percentile(
          selected.map((frame) => frame.ms),
          95,
        ),
        p99: tail,
        tailRequests: tailFrames.length,
        tailWithInteriorCounterIncrease: count(
          tailFrames,
          'counter-increased-inside-span',
        ),
        tailWithoutObservedInteriorIncrease: count(
          tailFrames,
          'no-counter-increase-observed-inside-span',
        ),
        tailWithInsufficientInteriorSamples: count(
          tailFrames,
          'insufficient-interior-samples',
        ),
        allWithInteriorCounterIncrease: count(
          selected,
          'counter-increased-inside-span',
        ),
        allWithInsufficientInteriorSamples: count(
          selected,
          'insufficient-interior-samples',
        ),
      };
    }),
  );
  const summary = {
    diagnosticOnly: true,
    admissionEligible: false,
    interpretation:
      'Temporal CPU-group counter association only; no request-specific causal delay or release admission.',
    comparisons,
    observerCosts,
    limitations: [
      'Counter increases belong to the whole app CPU group, including background work.',
      'No observed increase is not proof that a request was never throttled.',
      'Short requests can have insufficient sampling coverage.',
      'Observer runs outside app quota but can perturb the shared host; its cost and gaps are retained.',
      'No data is discarded and no original admission failure is rewritten.',
    ],
  };
  fs.writeFileSync(
    path.join(directory, 'cpu-attribution.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.table(comparisons);
}

module.exports = { parseCounters, correlate };

if (require.main === module) {
  (async () => {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'monitor') await monitor(args);
    else if (command === 'analyze' && args.length === 1) analyze(args[0]);
    else throw new Error('Explicit monitor or analyze invocation required');
  })().catch((error) => {
    console.error(
      `CPU trace command failed: ${error.code ?? error.name}; no attribution or admission.`,
    );
    process.exitCode = 1;
  });
}
