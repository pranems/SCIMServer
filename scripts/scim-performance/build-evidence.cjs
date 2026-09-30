const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const {
  ROOT,
  API,
  BASE,
  sourceGuard,
} = require("../scim-acceptance-current/current-safety.cjs");

const relativeRun = process.argv[2];
assert.ok(
  relativeRun,
  "Usage: node build-evidence.cjs <test-results run directory>",
);
const runDirectory = path.resolve(ROOT, relativeRun);
assert.ok(
  runDirectory.startsWith(
    path.join(ROOT, "test-results", "scim-performance") + path.sep,
  ),
  "Performance evidence must come from the owned scim-performance directory.",
);
sourceGuard();
const receiptPath = path.join(runDirectory, "receipt.json");
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
assert.equal(receipt.head, BASE);
assert.equal(receipt.status, "complete");
assert.equal(receipt.dataset.rows, 50_000);
assert.equal(receipt.seed.rows, 50_000);
assert.equal(receipt.migrations.length, 22);
assert.equal(receipt.postgresql.exactFetch.rowsTransferred, 1);
assert.equal(receipt.postgresql.residualFetch.rowsTransferred, 50_000);
assert.equal(receipt.service.exactPushdown.candidateRows, 1);
assert.equal(receipt.service.residualNumeric.candidateRows, 50_000);
assert.equal(receipt.service.residualNumeric.totalResults, 10);
assert.equal(receipt.service.residualNumeric.returned, 5);
assert.equal(receipt.cleanup.removed, true);

const git = (...args) =>
  cp
    .execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      windowsHide: true,
    })
    .trim();
function fingerprint(directory, files) {
  const hash = crypto.createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(directory, file)));
  }
  return {
    files: new Set(files).size,
    sha256: hash.digest("hex"),
  };
}
const sourceFiles = git(
  "ls-files",
  "--",
  "api/src",
  "api/test",
  "api/prisma",
)
  .split("\n")
  .filter(Boolean);
const buildFiles = fs
  .readdirSync(path.join(API, "dist"), { recursive: true })
  .filter((file) => file.endsWith(".js"));
const receiptSha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(receiptPath))
  .digest("hex");

const evidence = {
  generatedAt: new Date().toISOString(),
  source: {
    head: BASE,
    branch: sourceGuard().branch,
    productTreeClean: true,
    fingerprint: fingerprint(ROOT, sourceFiles),
    buildFingerprint: fingerprint(path.join(API, "dist"), buildFiles),
  },
  method: {
    runner: "scripts/scim-performance/run.cjs",
    runtime: process.version,
    database: receipt.beforeMigration.server.version,
    dataset:
      "50,000 custom Device rows in disposable PostgreSQL, payload cost values 0 through 49,999, one indexed displayName target, and a residual numeric predicate selecting 10 rows.",
    samples:
      "Two warmups plus nine PostgreSQL fetch samples; three warmups plus fifteen service-page samples.",
    interpretation:
      "Latency values characterize this local machine and are not a release SLO. Candidate counts, rows transferred, bytes, query-plan work, and selectivity establish the scaling shape.",
  },
  measurements: {
    dataset: receipt.dataset,
    seed: receipt.seed,
    postgresql: receipt.postgresql,
    service: receipt.service,
  },
  assessment: receipt.assessment,
  cleanup: receipt.cleanup,
  rawLocalArtifact: {
    directory: path.relative(ROOT, runDirectory),
    receiptSha256,
  },
};
const outputDirectory = path.join(
  ROOT,
  "docs",
  "evidence",
  "scim-performance-20260929",
);
fs.mkdirSync(outputDirectory, { recursive: true });
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
      rows: evidence.measurements.dataset.rows,
      residualRowsTransferred:
        evidence.measurements.postgresql.residualFetch.rowsTransferred,
      residualP50Ms:
        evidence.measurements.postgresql.residualFetch.latency.p50Ms,
      serviceP50Ms:
        evidence.measurements.service.residualNumeric.latency.p50Ms,
    },
    null,
    2,
  ),
);
