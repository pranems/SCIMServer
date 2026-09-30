const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..", "..");
const preload = path.join(__dirname, "preload.cjs");
const historicalRun = path.join(
  ROOT,
  "docs",
  "evidence",
  "scim-fresh-20260925",
  "repro-postgres",
  "run.cjs",
);

function buildRunnerSource(historicalSource) {
  const oldConfig =
    'const config = path.join(__dirname, "jest.config.cjs");';
  const currentConfig =
    'const config = path.join(ROOT, "scripts", "scim-acceptance-current", "jest.config.cjs");';
  assert.equal(
    historicalSource.split(oldConfig).length,
    2,
    "Historical runner config seam changed; review before reuse.",
  );
  const eol = historicalSource.includes("\r\n") ? "\r\n" : "\n";
  const oldOutput = [
    '  "fresh-analysis",',
    "  `postgres-20260928-${run}`,",
  ].join(eol);
  const currentOutput = [
    '  "scim-current-acceptance",',
    "  `${BASE.slice(0, 12)}-${run}`,",
  ].join(eol);
  assert.equal(
    historicalSource.split(oldOutput).length,
    2,
    "Historical runner output seam changed; review before reuse.",
  );
  return historicalSource
    .replace(oldConfig, currentConfig)
    .replace(oldOutput, currentOutput);
}

function main() {
  require(preload);
  const source = buildRunnerSource(fs.readFileSync(historicalRun, "utf8"));
  const loaded = new Module(historicalRun, module);
  loaded.filename = historicalRun;
  loaded.paths = Module._nodeModulePaths(path.dirname(historicalRun));
  loaded._compile(source, historicalRun);
}

if (require.main === module) main();

module.exports = { buildRunnerSource, historicalRun };
