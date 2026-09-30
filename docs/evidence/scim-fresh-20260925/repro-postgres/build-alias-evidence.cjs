const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { ROOT, BASE } = require("./safety.cjs");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
assert.equal(
  process.argv.length,
  3,
  "Pass the completed five-case alias run directory.",
);
const input = path.resolve(ROOT, process.argv[2]);
assert.ok(
  input.startsWith(
    path.join(ROOT, "test-results", "fresh-analysis") + path.sep,
  ),
);
const run = read(path.join(input, "run.json"));
assert.equal(run.status, "complete");
assert.equal(run.base, BASE);
assert.equal(run.cleanup.removed, true);
const ids = [
  "ALIAS-BULK-SUCCESS",
  "ALIAS-BULK-ATOMICITY",
  "ALIAS-BULK-DISABLED",
  "ALIAS-ME-USER",
  "ALIAS-DISCOVERY-REFLECTION",
];
assert.deepEqual(run.selectedCases, ids);
const dest = path.resolve(__dirname, "..");
const baselines = {};
const results = {};
const oldFiles = fs
  .readdirSync(dest)
  .filter((f) => f.startsWith("postgres-20260928."));
const originalHashes = Object.fromEntries(
  oldFiles.map((f) => [f, hash(fs.readFileSync(path.join(dest, f)))]),
);
const corpus = fs.readFileSync(
  path.join(__dirname, "dual-backend.spec.cjs"),
  "utf8",
);
const stripped = corpus.replace(
  /require\("\.\/alias-cases\.cjs"\)\(\{[\s\S]*?\}\);\r?\n\r?\n/,
  "",
);
assert.notEqual(stripped, corpus);
assert.equal(
  hash(stripped),
  "9ce04d6dbbaf8715000823ad50bbb85bdaf618674df16da748c54c40a01a2cc2",
);

function persist(name, text) {
  assert.ok(
    name.startsWith("postgres-20260928-aliases.") ||
      name.startsWith("postgres-20260928-expanded."),
  );
  assert.ok(!/postgres(?:ql)?:\/\/[^@\s"']+@/i.test(text));
  assert.ok(
    !/"(?:authorization|password|client_secret|access_token|refresh_token)"\s*:/i.test(
      text,
    ),
  );
  assert.ok(
    !/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text),
    "No JWT in evidence.",
  );
  fs.writeFileSync(path.join(dest, name), text);
}
const summary = {
  base: BASE,
  scope:
    "Five non-overlapping alias/discovery cases; original 77-case evidence preserved.",
  run,
  backendSummary: {},
  priorEvidenceHashes: originalHashes,
  priorHarnessPreservation: {
    original77BodiesUnchanged: true,
    change:
      "Only an additive external case-registration block in dual-backend.spec.cjs.",
    originalFileSha256AfterRemovingRegistration: hash(stripped),
    note: "Original receipt hashes remain historical snapshots; no original evidence artifact was rewritten.",
  },
  currentHarnessHashes: Object.fromEntries(
    fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith(".cjs"))
      .map((f) => [f, hash(fs.readFileSync(path.join(__dirname, f)))]),
  ),
  remainingLimits: [
    "Bulk Group/custom targets, forward or cyclic bulkId references, and failOnErrors thresholds above zero were not added.",
    "/Me PUT/DELETE, unrelated subjects, token classes, and authorization combinations were not added.",
    "Discovery reflection is one live local app per backend, not proof of distributed cache invalidation.",
    "No live/customer calls, real accounts, full conformance, or production fix.",
  ],
};
const combinedSummary = {
  base: BASE,
  originalCasesPerBackend: 77,
  appendedCasesPerBackend: 5,
  uniqueCasesPerBackend: 82,
  totalUniqueCaseExecutions: 164,
  originalSummary: "postgres-20260928.summary.json",
  appendedSummary: "postgres-20260928-aliases.summary.json",
  backendSummary: {},
  cases: [],
};
function totals(rows) {
  return {
    cases: rows.length,
    passed: rows.filter((r) => r.status === "passed").length,
    behaviorFailed: rows.filter((r) => r.status === "behavior-failed").length,
    setupFailed: rows.filter((r) => r.status === "setup-failure").length,
    notApplicable: rows.filter((r) => r.status === "not-applicable").length,
    checksPassed: rows.flatMap((r) => r.checks).filter((c) => c.passed).length,
    checksFailed: rows.flatMap((r) => r.checks).filter((c) => !c.passed).length,
  };
}
for (const backend of ["inmemory", "prisma"]) {
  baselines[backend] = read(
    path.join(dest, `postgres-20260928.${backend}.json`),
  );
  assert.equal(baselines[backend].results.length, 77);
  const added = read(path.join(input, `${backend}.json`));
  assert.deepEqual(
    added.results.map((r) => r.id),
    ids,
  );
  assert.ok(added.results.every((r) => r.status !== "setup-failure"));
  assert.ok(!baselines[backend].results.some((r) => ids.includes(r.id)));
  const all = [...baselines[backend].results, ...added.results];
  assert.equal(new Set(all.map((r) => r.id)).size, 82);
  results[backend] = all;
  summary.backendSummary[backend] = totals(added.results);
  combinedSummary.backendSummary[backend] = totals(all);
  persist(
    `postgres-20260928-aliases.${backend}.json`,
    JSON.stringify(added, null, 2) + "\n",
  );
}
assert.deepEqual(
  results.prisma.map((r) => r.id),
  results.inmemory.map((r) => r.id),
);
const csv = [
  [
    "id",
    "case",
    "mode",
    "inmemory",
    "postgresql",
    "evidenceGroup",
    "inmemoryFailedChecks",
    "postgresqlFailedChecks",
  ],
];
for (const pg of results.prisma) {
  const mem = results.inmemory.find((r) => r.id === pg.id);
  const group = ids.includes(pg.id) ? "appended-aliases" : "original77";
  const failures = (r) => r.checks.filter((c) => !c.passed).map((c) => c.claim);
  combinedSummary.cases.push({
    id: pg.id,
    mode: pg.mode,
    evidenceGroup: group,
    inmemory: mem.status,
    prisma: pg.status,
    evidenceFilePrefix:
      group === "original77"
        ? "postgres-20260928"
        : "postgres-20260928-aliases",
  });
  csv.push([
    pg.id,
    pg.title,
    pg.mode,
    mem.status,
    pg.status,
    group,
    failures(mem).join("; "),
    failures(pg).join("; "),
  ]);
}
persist(
  "postgres-20260928-aliases.summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
persist(
  "postgres-20260928-expanded.summary.json",
  JSON.stringify(combinedSummary, null, 2) + "\n",
);
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
persist(
  "postgres-20260928-expanded.cases.csv",
  csv.map((row) => row.map(quote).join(",")).join("\n") + "\n",
);
persist(
  `postgres-20260928-aliases.migration-${run.run}.txt`,
  fs.readFileSync(path.join(input, "migration-replay.log"), "utf8"),
);
for (const [file, previous] of Object.entries(originalHashes))
  assert.equal(hash(fs.readFileSync(path.join(dest, file))), previous);
console.log(
  JSON.stringify(
    {
      added: summary.backendSummary,
      combined: combinedSummary.backendSummary,
      original77ArtifactsUnchanged: true,
    },
    null,
    2,
  ),
);
