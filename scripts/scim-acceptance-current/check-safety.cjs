const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const HISTORICAL_SAFETY = path.join(
  ROOT,
  "docs",
  "evidence",
  "scim-fresh-20260925",
  "repro-postgres",
  "safety.cjs",
);

async function main() {
  const current = require("./current-safety.cjs");
  assert.equal(current.CURRENT_SOURCE, true);
  assert.equal(current.ROOT, ROOT);
  assert.equal(current.sourceGuard().head, current.BASE);

  require("./preload.cjs");
  assert.equal(require(HISTORICAL_SAFETY), current);
  const { buildRunnerSource, historicalRun } = require("./run.cjs");
  const runnerSource = buildRunnerSource(fs.readFileSync(historicalRun, "utf8"));
  assert.match(runnerSource, /"scim-current-acceptance"/);
  assert.match(runnerSource, /`\$\{BASE\.slice\(0, 12\)\}-\$\{run\}`/);
  assert.doesNotMatch(runnerSource, /"fresh-analysis"/);

  const saved = {
    backend: process.env.PERSISTENCE_BACKEND,
    databaseUrl: process.env.DATABASE_URL,
    output: process.env.PG_ANALYSIS_OUTPUT,
  };
  try {
    process.env.PERSISTENCE_BACKEND = "inmemory";
    process.env.DATABASE_URL = current.INERT;
    process.env.PG_ANALYSIS_OUTPUT = path.join(
      ROOT,
      "test-results",
      "scim-current-acceptance",
      "safety-check",
    );
    assert.equal(
      require("./jest.config.cjs").moduleNameMapper[
        "^\\./safety\\.cjs$"
      ],
      path.join(__dirname, "current-safety.cjs"),
    );
    const corpusPath = path.join(
      ROOT,
      "docs",
      "evidence",
      "scim-fresh-20260925",
      "repro-postgres",
      "dual-backend.spec.cjs",
    );
    const adapted = require("./corpus-transformer.cjs").adaptCorpus(
      fs.readFileSync(corpusPath, "utf8"),
      corpusPath,
    );
    assert.match(adapted, /strict && response\.status !== 200/);
    assert.match(adapted, /repos\.Groups\.updateGroupWithMembers = async/);
    assert.match(adapted, /repos\.Groups\.create = async/);
    assert.doesNotMatch(
      fs.readFileSync(corpusPath, "utf8"),
      /strict && response\.status !== 200/,
    );
    assert.deepEqual(await current.testGuard(), {
      backend: "inmemory",
      database: "not connected",
    });

    process.env.PG_ANALYSIS_OUTPUT = path.join(ROOT, "outside-evidence");
    await assert.rejects(current.testGuard(), /owned test-results directory/);

    process.env.PG_ANALYSIS_OUTPUT = path.join(
      ROOT,
      "test-results",
      "scim-current-acceptance",
      "safety-check",
    );
    process.env.PERSISTENCE_BACKEND = "unknown";
    await assert.rejects(current.testGuard(), /Explicit backend is required/);
  } finally {
    if (saved.backend === undefined) delete process.env.PERSISTENCE_BACKEND;
    else process.env.PERSISTENCE_BACKEND = saved.backend;
    if (saved.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.databaseUrl;
    if (saved.output === undefined) delete process.env.PG_ANALYSIS_OUTPUT;
    else process.env.PG_ANALYSIS_OUTPUT = saved.output;
  }

  console.log("Current-source acceptance safety checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
