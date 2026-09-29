const assert = require("node:assert/strict");
const cp = require("node:child_process");
const { ROOT } = require("./safety.cjs");
const script = `
  require('./scripts/p1-validation/safety.cjs')
    .testGuard().then(()=>process.exit(0),()=>process.exit(2));
`;
const output = require("node:path").join(
  ROOT,
  "test-results",
  "p1",
  "safety-check",
);
for (const [label, env] of [
  ["missing explicit backend", { PERSISTENCE_BACKEND: "" }],
  ["Prisma missing task container identity", { PERSISTENCE_BACKEND: "prisma" }],
  [
    "InMemory with arbitrary DB URL",
    {
      PERSISTENCE_BACKEND: "inmemory",
      DATABASE_URL: "postgresql://127.0.0.1:5432/not_task_owned",
    },
  ],
]) {
  const result = cp.spawnSync(process.execPath, ["-e", script], {
    cwd: ROOT,
    env: {
      ...process.env,
      PG_ANALYSIS_CONTAINER_ID: "",
      PG_ANALYSIS_RUN: "",
      PG_ANALYSIS_OUTPUT: output,
      ...env,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 2, label);
  console.log(`REJECTED safely before database access: ${label}`);
}
const positive = cp.spawnSync(process.execPath, ["-e", script], {
  cwd: ROOT,
  env: { ...process.env, PERSISTENCE_BACKEND: "inmemory",
    DATABASE_URL: "postgresql://127.0.0.1:1/scim_p1_inmemory_never_connect", PG_ANALYSIS_OUTPUT: output },
});
assert.equal(positive.status, 0, "The valid InMemory control must pass.");
console.log("ACCEPTED: owned InMemory control");
