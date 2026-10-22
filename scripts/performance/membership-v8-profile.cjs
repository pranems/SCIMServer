const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateDiagnosticRound } = require("./membership-cpu-trace.cjs");

function summarizeProfile(profile) {
  assert.ok(
    profile && typeof profile === "object",
    "Native profile object required",
  );
  assert.ok(
    Array.isArray(profile.nodes) && profile.nodes.length > 0,
    "Native call tree required",
  );
  assert.ok(
    Array.isArray(profile.samples) && profile.samples.length > 0,
    "Native observations required",
  );
  assert.ok(
    Array.isArray(profile.timeDeltas),
    "Native observation gaps required",
  );
  assert.equal(
    profile.samples.length,
    profile.timeDeltas.length,
    "Every observation needs a gap",
  );
  assert.ok(
    Number.isSafeInteger(profile.startTime) && profile.startTime >= 0,
    "Invalid profile start",
  );
  assert.ok(
    Number.isSafeInteger(profile.endTime) &&
      profile.endTime > profile.startTime,
    "Invalid profile end",
  );
  let observedWallMicroseconds = 0;
  let outOfOrderSamples = 0;
  let maximumBackwardStepMicroseconds = 0;
  const profileWallMicroseconds = profile.endTime - profile.startTime;
  for (const delta of profile.timeDeltas) {
    assert.ok(Number.isSafeInteger(delta), "Invalid native observation gap");
    observedWallMicroseconds += delta;
    assert.ok(
      Number.isSafeInteger(observedWallMicroseconds),
      "Unsafe native observation clock",
    );
    assert.ok(
      observedWallMicroseconds >= 0 &&
        observedWallMicroseconds <= profileWallMicroseconds,
      "Observation timestamp outside native profile span",
    );
    if (delta < 0) {
      // Count timestamp reordering without sorting, dropping or weighting samples.
      outOfOrderSamples++;
      maximumBackwardStepMicroseconds = Math.max(
        maximumBackwardStepMicroseconds,
        -delta,
      );
    }
  }

  const nodes = new Map();
  const functions = new Map();
  const modules = new Map();
  for (const node of profile.nodes) {
    assert.ok(
      Number.isSafeInteger(node.id) && node.id > 0 && !nodes.has(node.id),
      "Invalid or duplicate native node",
    );
    const frame = node.callFrame;
    assert.ok(
      frame &&
        typeof frame.functionName === "string" &&
        typeof frame.url === "string" &&
        typeof frame.scriptId === "string",
      "Native source identity required",
    );
    assert.ok(
      Number.isSafeInteger(frame.lineNumber) &&
        frame.lineNumber >= -1 &&
        Number.isSafeInteger(frame.columnNumber) &&
        frame.columnNumber >= -1,
      "Invalid native source location",
    );
    assert.ok(
      node.children === undefined || Array.isArray(node.children),
      "Invalid native child list",
    );
    const key = JSON.stringify([
      frame.functionName,
      frame.url,
      frame.lineNumber,
      frame.columnNumber,
      frame.scriptId,
    ]);
    if (!functions.has(key)) {
      functions.set(key, {
        functionName: frame.functionName,
        url: frame.url,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
        scriptId: frame.scriptId,
        callTreeNodes: 0,
        samples: 0,
      });
    }
    functions.get(key).callTreeNodes++;
    nodes.set(node.id, { node, key });
    if (!modules.has(frame.url))
      modules.set(frame.url, { url: frame.url, samples: 0 });
  }
  for (const { node } of nodes.values()) {
    for (const child of node.children ?? []) {
      assert.ok(
        Number.isSafeInteger(child) && nodes.has(child),
        "Native child references missing node",
      );
    }
  }
  for (const id of profile.samples) {
    assert.ok(
      Number.isSafeInteger(id) && nodes.has(id),
      "Native observation references missing node",
    );
    const { node, key } = nodes.get(id);
    functions.get(key).samples++;
    modules.get(node.callFrame.url).samples++;
  }
  const summarize = (values) =>
    [...values]
      .map((item) => ({
        ...item,
        samplePercent: (100 * item.samples) / profile.samples.length,
      }))
      .sort(
        (left, right) =>
          right.samples - left.samples ||
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  return {
    diagnosticOnly: true,
    admissionEligible: false,
    interpretation:
      "Unweighted exclusive function observations, not CPU time or causal request delay. Native idle observations remain included.",
    totalSamples: profile.samples.length,
    profileWallMicroseconds,
    outOfOrderSamples,
    maximumBackwardStepMicroseconds,
    maximumSampleGapMicroseconds: profile.timeDeltas.reduce(
      (maximum, delta) => Math.max(maximum, delta),
      0,
    ),
    functions: summarize(functions.values()),
    modules: summarize(modules.values()),
  };
}

function analyze(directory) {
  const load = (name) =>
    JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  const protocol = require("./membership-protocol.json");
  assert.deepEqual(
    load("../protocol.json"),
    protocol,
    "Original frozen protocol required",
  );
  const identities = load("../images.json");
  const rows = load("rounds.json");
  assert.deepEqual(
    rows.map((row) => row.role),
    ["candidate", "baseline", "baseline", "candidate"],
  );
  const profiles = [];
  let requestSpans = 0;
  for (const role of ["baseline", "candidate"]) {
    const matchingIdentities = identities.filter((item) => item.role === role);
    assert.equal(
      matchingIdentities.length,
      1,
      "Exactly one immutable role identity required",
    );
    const identity = matchingIdentities[0];
    assert.equal(identity.reference, protocol[role].image);
    assert.equal(identity.version, protocol[role].version);
    assert.match(identity.id, /^sha256:[a-f0-9]{64}$/);
    assert.match(identity.nodeVersion, /^v\d+\.\d+\.\d+$/);
    const capture = load(`profile-${role}-status.json`);
    assert.equal(capture.diagnosticOnly, true);
    assert.equal(capture.admissionEligible, false);
    assert.equal(
      capture.workComplete,
      true,
      "Partial work cannot produce a complete diagnostic",
    );
    assert.equal(capture.captureStatus, "COMPLETE");
    assert.equal(capture.exitCode, 0);
    assert.equal(capture.failureStage, null);
    assert.equal(capture.filesCollected, true);
    assert.match(capture.containerId, /^[a-f0-9]{64}$/);
    const metadata = load(`profile-${role}-meta.json`);
    assert.equal(metadata.diagnosticOnly, true);
    assert.equal(metadata.admissionEligible, false);
    assert.equal(
      metadata.nodeVersion,
      identity.nodeVersion,
      "Actual server runtime must match frozen image",
    );
    assert.equal(metadata.clock, "process.hrtime.bigint");
    assert.match(metadata.bootstrapNs, /^\d+$/);
    const raw = load(`profile-${role}.cpuprofile`);
    const summary = summarizeProfile(raw);
    const start = BigInt(raw.startTime) * 1000n;
    const end = BigInt(raw.endTime) * 1000n;
    assert.ok(
      BigInt(metadata.bootstrapNs) >= start &&
        BigInt(metadata.bootstrapNs) <= end,
      "Bootstrap and native profile must share the monotonic clock",
    );
    for (const [index, row] of rows.entries()) {
      if (row.role !== role) continue;
      assert.equal(
        row.image,
        identity.reference,
        "Round must use the pinned role image",
      );
      assert.equal(row.imageId, identity.id);
      assert.equal(row.version, identity.version);
      assert.equal(row.appContainerId, capture.containerId);
      const client = load(`round-${index + 1}-${role}.json`);
      validateDiagnosticRound(row, client);
      let previousEnd = start;
      for (const [spanIndex, span] of client.spans.entries()) {
        assert.equal(span.requestIndex, spanIndex + 1);
        assert.equal(span.succeeded, true);
        assert.ok(
          Number.isInteger(span.status) &&
            span.status >= 200 &&
            span.status < 300,
        );
        assert.ok(Number.isFinite(span.ms) && span.ms >= 0);
        assert.match(span.startNs, /^\d+$/);
        assert.match(span.endNs, /^\d+$/);
        assert.ok(
          BigInt(span.startNs) >= previousEnd &&
            BigInt(span.endNs) > BigInt(span.startNs) &&
            BigInt(span.endNs) <= end,
          "Native profile must cover every ordered request span",
        );
        previousEnd = BigInt(span.endNs);
      }
      requestSpans += client.spans.length;
    }
    profiles.push({
      role,
      image: identity.reference,
      version: identity.version,
      nodeVersion: metadata.nodeVersion,
      ...summary,
    });
  }
  const privacy = load("privacy.json");
  assert.equal(privacy.passed, true);
  assert.equal(privacy.contractAssertions, 66);
  assert.equal(privacy.checkedRows, 200);
  assert.equal(privacy.rawLogsExported, false);
  const cleanup = load("cleanup.json");
  assert.equal(cleanup.containersAbsent, true);
  assert.equal(cleanup.networksAbsent, true);
  const output = {
    diagnosticOnly: true,
    admissionEligible: false,
    requestSpans,
    measuredSamples: 16000,
    profiles,
    limitations: [
      "Profiles cover the whole process lifetime, including startup, idle, background work and privacy checks.",
      "Unweighted exclusive observations are not CPU time; wall-clock gaps can include quota suspension.",
      "Native profiling and client tracing perturb execution. This is not a latency admission experiment.",
      "Node runtime versions differ between the pinned images; observed differences are hypotheses, not application-only causal effects.",
      "Role order and first/second visits are retained, not pooled into a favorable release result.",
    ],
  };
  fs.writeFileSync(
    path.join(directory, "native-functions.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  console.log("Complete native function diagnostic; not release admission.");
}

module.exports = { summarizeProfile };

if (require.main === module) {
  try {
    const [command, directory, ...extra] = process.argv.slice(2);
    assert.ok(
      command === "analyze" && directory && extra.length === 0,
      "Explicit analyze directory required",
    );
    analyze(directory);
  } catch (error) {
    const reason = error.message.split(/\r?\n/, 1)[0].slice(0, 200);
    console.error(
      `Native function analysis failed: ${error.code ?? error.name}; ${reason}; no attribution or admission.`,
    );
    process.exitCode = 1;
  }
}
