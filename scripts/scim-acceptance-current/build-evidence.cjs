const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const {
  ROOT,
  BASE,
  CORPUS_HASHES,
  sourceGuard,
} = require("./current-safety.cjs");

const relativeRun = process.argv[2];
assert.ok(
  relativeRun,
  "Usage: node build-evidence.cjs <test-results run directory>",
);
const runDirectory = path.resolve(ROOT, relativeRun);
assert.ok(
  runDirectory.startsWith(path.join(ROOT, "test-results") + path.sep),
  "Run evidence must be under this worktree's test-results directory.",
);

const readJson = (file) =>
  JSON.parse(fs.readFileSync(path.join(runDirectory, file), "utf8"));
const sha256 = (file) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(runDirectory, file)))
    .digest("hex");

sourceGuard();
const run = readJson("run.json");
assert.equal(run.base, BASE);
assert.equal(run.status, "complete");
assert.equal(run.migrations.length, 22);
assert.equal(run.cleanup.removed, true);
assert.equal(run.cleanup.persistentVolumesCreated, 0);
assert.equal(run.cleanup.customNetworksCreated, 0);

const dispositions = [];
const backendSummaries = [];
for (const backend of ["inmemory", "prisma"]) {
  const result = readJson(`${backend}.json`);
  assert.equal(result.base, BASE);
  assert.equal(result.results.length, 82);
  assert.equal(result.summary.cases, 82);
  assert.equal(result.summary.behaviorFailed, 0);
  assert.equal(result.summary.setupFailed, 0);
  assert.equal(result.summary.checksFailed, 0);
  const planned = new Map(
    result.plannedCases.map((entry) => [entry.id, entry]),
  );
  assert.equal(planned.size, 82);
  assert.deepEqual(
    result.results.map((entry) => entry.id).sort(),
    [...planned.keys()].sort(),
  );
  backendSummaries.push({
    backend,
    ...result.summary,
    rawSha256: sha256(`${backend}.json`),
  });
  for (const entry of result.results) {
    dispositions.push({
      caseId: entry.id,
      title: entry.title,
      backend,
      disposition:
        entry.status === "not-applicable" ? "accepted-not-applicable" : "passed",
      checksPassed: entry.checks.filter((check) => check.passed).length,
      checksFailed: entry.checks.filter((check) => !check.passed).length,
      ...(entry.reason ? { reason: entry.reason } : {}),
      permanentCase:
        "docs/evidence/scim-fresh-20260925/repro-postgres/dual-backend.spec.cjs",
    });
  }
}
assert.equal(dispositions.length, 164);
assert.equal(
  dispositions.filter((entry) => entry.disposition === "passed").length,
  163,
);
assert.equal(
  dispositions.filter(
    (entry) => entry.disposition === "accepted-not-applicable",
  ).length,
  1,
);

const outputDirectory = path.join(
  ROOT,
  "docs",
  "evidence",
  "scim-current-acceptance-20260929",
);
fs.mkdirSync(outputDirectory, { recursive: true });
const evidence = {
  generatedAt: new Date().toISOString(),
  source: {
    head: BASE,
    branch: sourceGuard().branch,
    productTreeClean: true,
  },
  immutableCorpus: {
    casesPerBackend: 82,
    normalizedSha256: CORPUS_HASHES,
    source:
      "docs/evidence/scim-fresh-20260925/repro-postgres/dual-backend.spec.cjs",
  },
  currentSourceAdapter: {
    directory: "scripts/scim-acceptance-current",
    adaptations: [
      {
        caseId: "INC-STRICT",
        reason:
          "A valid strict-mode request now succeeds, so the current adapter executes the success readback branch. The historical rejection-preservation branch remains active if the response regresses to non-200.",
        supportingTest: "api/test/e2e/typed-patch-path.e2e-spec.ts",
      },
      {
        caseId: "GROUP-HTTP-FAULT",
        backend: "inmemory",
        reason:
          "Fault injection moved from the obsolete addMembers seam to the aggregate updateGroupWithMembers mutation boundary.",
        supportingTest:
          "api/src/infrastructure/repositories/inmemory/group-aggregate.spec.ts",
      },
      {
        caseId: "GROUP-POST-FAULT",
        backend: "inmemory",
        reason:
          "Fault injection moved from the obsolete addMembers seam to the aggregate create mutation boundary.",
        supportingTest:
          "api/src/infrastructure/repositories/inmemory/group-aggregate.spec.ts",
      },
    ],
  },
  environment: {
    node: process.version,
    dockerServerVersion: run.dockerServerVersion,
    postgresVersion: run.beforeMigration.server.version,
    migrationCount: run.migrations.length,
    migrationNames: run.migrations.map((migration) => migration.migration_name),
  },
  backendSummaries,
  totals: {
    dispositions: dispositions.length,
    passed: dispositions.filter((entry) => entry.disposition === "passed")
      .length,
    acceptedNotApplicable: dispositions.filter(
      (entry) => entry.disposition === "accepted-not-applicable",
    ).length,
    checksPassed: backendSummaries.reduce(
      (total, summary) => total + summary.checksPassed,
      0,
    ),
    checksFailed: backendSummaries.reduce(
      (total, summary) => total + summary.checksFailed,
      0,
    ),
  },
  cleanup: run.cleanup,
  rawLocalArtifact: {
    directory: path.relative(ROOT, runDirectory),
    runSha256: sha256("run.json"),
  },
  dispositions,
};
fs.writeFileSync(
  path.join(outputDirectory, "validation.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      output: path.relative(
        ROOT,
        path.join(outputDirectory, "validation.json"),
      ),
      ...evidence.totals,
    },
    null,
    2,
  ),
);
