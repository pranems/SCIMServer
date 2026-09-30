const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const historicalSafety = path.join(
  ROOT,
  "docs",
  "evidence",
  "scim-fresh-20260925",
  "repro-postgres",
  "safety.cjs",
);
const currentSafety = require("./current-safety.cjs");

require.cache[historicalSafety] = {
  id: historicalSafety,
  filename: historicalSafety,
  loaded: true,
  exports: currentSafety,
  children: [],
  paths: module.paths,
};
