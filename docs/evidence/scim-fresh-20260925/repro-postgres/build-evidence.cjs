const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { ROOT, BASE } = require("./safety.cjs");
const inputs = process.argv.slice(2);
assert.ok(
  inputs.length > 0,
  "Pass one or more completed task run directories.",
);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const runs = inputs.map((input) => {
  const dir = path.resolve(ROOT, input);
  assert.ok(
    dir.startsWith(
      path.join(ROOT, "test-results", "fresh-analysis") + path.sep,
    ),
  );
  const run = read(path.join(dir, "run.json"));
  assert.equal(run.base, BASE);
  assert.equal(run.status, "complete");
  assert.equal(run.cleanup.removed, true);
  return { dir, run };
});
const dest = path.resolve(__dirname, "..");
const summary = {
  base: BASE,
  collectedAt: new Date().toISOString(),
  evidenceType:
    "Real HTTP plus real persisted repositories, PostgreSQL compared to InMemory",
  runs: runs.map(({ run }) => run),
  backendSummary: {},
  backendDifferences: [],
};
const combined = {};
for (const backend of ["inmemory", "prisma"]) {
  const results = runs.flatMap(({ dir, run }) =>
    read(path.join(dir, `${backend}.json`)).results.map((r) => ({
      ...r,
      run: run.run,
    })),
  );
  assert.equal(
    new Set(results.map((r) => r.id)).size,
    results.length,
    "Repeated case IDs must be reviewed rather than double-counted.",
  );
  assert.ok(results.every((r) => r.status !== "setup-failure"));
  const totals = {
    cases: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    behaviorFailed: results.filter((r) => r.status === "behavior-failed")
      .length,
    notApplicable: results.filter((r) => r.status === "not-applicable").length,
    setupFailed: 0,
    checksPassed: results.flatMap((r) => r.checks).filter((c) => c.passed)
      .length,
    checksFailed: results.flatMap((r) => r.checks).filter((c) => !c.passed)
      .length,
  };
  combined[backend] = { base: BASE, backend, totals, results };
  summary.backendSummary[backend] = totals;
}
assert.deepEqual(
  combined.prisma.results.map((r) => r.id),
  combined.inmemory.results.map((r) => r.id),
);
const table = [
  [
    "id",
    "case",
    "mode",
    "inmemory",
    "postgresql",
    "inmemoryFailedChecks",
    "postgresqlFailedChecks",
  ],
];
for (const pg of combined.prisma.results) {
  const mem = combined.inmemory.results.find((r) => r.id === pg.id);
  const failed = (r) => r.checks.filter((c) => !c.passed).map((c) => c.claim);
  table.push([
    pg.id,
    pg.title,
    pg.mode,
    mem.status,
    pg.status,
    failed(mem).join("; "),
    failed(pg).join("; "),
  ]);
  if (
    mem.status !== pg.status ||
    JSON.stringify(mem.checks.map((c) => c.passed)) !==
      JSON.stringify(pg.checks.map((c) => c.passed))
  ) {
    summary.backendDifferences.push({
      id: pg.id,
      mode: pg.mode,
      inmemory: mem.status,
      postgresql: pg.status,
      inmemoryFailedChecks: failed(mem),
      postgresqlFailedChecks: failed(pg),
    });
  }
}
summary.coverageBoundary = {
  fullConformanceClaim: false,
  plainWireRaces:
    "One observed race per resource/backend, not a probability estimate.",
  barrierRaces:
    "Both real repository calls are paused before actual persistence; storage is not mocked.",
  groupNativeFailure:
    "Real PostgreSQL duplicate-member constraint; InMemory has no corresponding constraint.",
  groupHttpFault:
    "Task-only PostgreSQL trigger raises inside actual persistence; InMemory throws at addMembers seam.",
  cache:
    "Two real EndpointService instances share PostgreSQL. Not a two-process or distributed-cache experiment.",
  notTested: [
    "Customer/live estates",
    "credential cascade and auth-method matrix",
    "Bulk and /Me in this new dual-backend corpus",
    "all filter grammar and all schema-characteristic permutations",
    "multi-process cache invalidation",
    "load/performance percentiles",
    "production deployment, repair, or migration against an existing database",
  ],
};
summary.harnessHashes = Object.fromEntries(
  fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith(".cjs"))
    .map((f) => [
      f,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(__dirname, f)))
        .digest("hex"),
    ]),
);
function persist(file, text) {
  assert.ok(
    !/postgres(?:ql)?:\/\/[^@\s"']+@/i.test(text),
    "Refusing credential-bearing connection string in durable evidence.",
  );
  assert.ok(
    !/"(?:authorization|password|client_secret)"\s*:/i.test(text),
    "Refusing credential field in durable evidence.",
  );
  fs.writeFileSync(path.join(dest, file), text);
}
for (const backend of ["inmemory", "prisma"])
  persist(
    `postgres-20260928.${backend}.json`,
    JSON.stringify(combined[backend], null, 2) + "\n",
  );
persist(
  "postgres-20260928.summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
const quote = (v) => `"${String(v).replaceAll('"', '""')}"`;
persist(
  "postgres-20260928.cases.csv",
  table.map((row) => row.map(quote).join(",")).join("\n") + "\n",
);
for (const { dir, run } of runs) {
  persist(
    `postgres-20260928.migration-${run.run}.txt`,
    fs.readFileSync(path.join(dir, "migration-replay.log"), "utf8"),
  );
}
console.log(
  JSON.stringify(
    {
      casesPerBackend: combined.prisma.results.length,
      backendSummary: summary.backendSummary,
      differenceCases: summary.backendDifferences.length,
    },
    null,
    2,
  ),
);
