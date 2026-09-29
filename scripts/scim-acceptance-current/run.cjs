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

require(preload);
const historicalSource = fs.readFileSync(historicalRun, "utf8");
const oldConfig =
  'const config = path.join(__dirname, "jest.config.cjs");';
const currentConfig =
  'const config = path.join(ROOT, "scripts", "scim-acceptance-current", "jest.config.cjs");';
assert.equal(
  historicalSource.split(oldConfig).length,
  2,
  "Historical runner config seam changed; review before reuse.",
);
const oldOutput = `  "fresh-analysis",
  \`postgres-20260928-\${run}\`,`;
const currentOutput = `  "scim-current-acceptance",
  \`\${BASE.slice(0, 12)}-\${run}\`,`;
assert.equal(
  historicalSource.split(oldOutput).length,
  2,
  "Historical runner output seam changed; review before reuse.",
);
const source = historicalSource
  .replace(oldConfig, currentConfig)
  .replace(oldOutput, currentOutput);
const loaded = new Module(historicalRun, module);
loaded.filename = historicalRun;
loaded.paths = Module._nodeModulePaths(path.dirname(historicalRun));
loaded._compile(source, historicalRun);
