const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { API, ROOT, sourceGuard, testGuard } = require("./safety.cjs");

async function main() {
  const originalExists = fs.existsSync;
  fs.existsSync = (file) =>
    file === path.join(API, "test", "e2e", ".test-db-path") || originalExists(file);
  assert.throws(sourceGuard, /Refusing existing database marker/);
  fs.existsSync = originalExists;
  process.env.PG_ANALYSIS_OUTPUT = path.join(ROOT, "test-results", "conditional-writes");
  process.env.PERSISTENCE_BACKEND = "inmemory";
  process.env.DATABASE_URL = "postgresql://unowned.invalid/not_allowed";
  await assert.rejects(testGuard);
  process.env.PERSISTENCE_BACKEND = "prisma";
  delete process.env.PG_ANALYSIS_CONTAINER_ID;
  await assert.rejects(testGuard);
  console.log("3 safety negative controls passed; no database contacted.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
