const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

assert.equal(
  process.env.SCIM_BENCH_PROFILE,
  "1",
  "Native profile bootstrap requires explicit diagnostic opt-in",
);
const directory = process.env.SCIM_BENCH_PROFILE_DIRECTORY;
assert.ok(
  directory && path.isAbsolute(directory),
  "Native bootstrap requires an absolute profile directory",
);
fs.writeFileSync(
  path.join(directory, "membership-profile-meta.json"),
  JSON.stringify({
    diagnosticOnly: true,
    admissionEligible: false,
    nodeVersion: process.version,
    clock: "process.hrtime.bigint",
    bootstrapNs: process.hrtime.bigint().toString(),
  }) + "\n",
);

// Only disposable profiling processes use this explicit flush-and-exit signal.
process.once("SIGUSR2", () => process.exit(0));
