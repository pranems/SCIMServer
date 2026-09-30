const assert = require("node:assert/strict");

const {
  assertOwnedContainerMetadata,
  assertLiveReceipt,
  assertEmptyEndpointInventory,
  buildCommand,
  buildRuntimeEnv,
} = require("./run.cjs");

const build = buildCommand();
assert.equal(build.file, process.execPath);
assert.deepEqual(build.args.slice(-2), ["run", "build"]);
assert.match(build.args[0], /npm-cli\.js$/);

const env = buildRuntimeEnv({
  backend: "inmemory",
  baseUrl: "http://127.0.0.1:49152",
  databaseUrl:
    "postgresql://127.0.0.1:1/scim_fresh_inmemory_never_connect",
  secret: "owned-secret",
});
assert.equal(env.PERSISTENCE_BACKEND, "inmemory");
assert.equal(
  env.DATABASE_URL,
  "postgresql://127.0.0.1:1/scim_fresh_inmemory_never_connect",
);
assert.equal(env.PUBLIC_URL, "http://127.0.0.1:49152");
assert.equal(env.SCIM_SHARED_SECRET, "owned-secret");
assert.equal(env.OAUTH_CLIENT_SECRET, "owned-secret");
assert.doesNotThrow(() =>
  assertEmptyEndpointInventory({ endpoints: [], totalResults: 0 }),
);
assert.throws(
  () =>
    assertEmptyEndpointInventory({
      endpoints: [{ id: "unexpected" }],
      totalResults: 1,
    }),
  /empty endpoint inventory/,
);
assert.throws(
  () => assertEmptyEndpointInventory([]),
  /canonical endpoint inventory/,
);

const containerId = "a".repeat(64);
const containerRun = "b".repeat(16);
const ownedContainer = {
  Id: containerId,
  Name: `/scim-fresh-pg-${containerRun}`,
  Config: {
    Labels: {
      "scim.analysis.owner": "4d48341f-c932-46bf-8171-8534c52447b1",
      "scim.analysis.run": containerRun,
    },
  },
};
assert.doesNotThrow(() =>
  assertOwnedContainerMetadata(ownedContainer, {
    id: containerId,
    run: containerRun,
  }),
);
assert.throws(
  () =>
    assertOwnedContainerMetadata(
      {
        ...ownedContainer,
        Config: {
          Labels: {
            ...ownedContainer.Config.Labels,
            "scim.analysis.owner": "another-owner",
          },
        },
      },
      { id: containerId, run: containerRun },
    ),
  /owner/,
);

const required = [
  "9z-DE: 126 binding-qualified uniqueness",
  "9z-CV: 472 declaration",
  "9z-CY: 19 default-running Entra cases / 1228 assertions",
  "9z-DD: 6 PUT/PATCH retention stability cases / 5474 assertions",
  "9z-DF: 153 P7b PATCH/schema cases / 905 assertions",
];
const valid = {
  passed: 166,
  failed: 0,
  checks: [
    ...required.map((message) => ({ success: true, message })),
    ...Array.from({ length: 161 }, (_, index) => ({
      success: true,
      message: `control-${index}`,
    })),
  ],
};
assert.doesNotThrow(() => assertLiveReceipt(valid));
assert.throws(
  () => assertLiveReceipt({ ...valid, failed: 1 }),
  /failed live assertion/,
);
assert.throws(
  () =>
    assertLiveReceipt({
      ...valid,
      passed: 165,
      checks: valid.checks.slice(0, -1),
    }),
  /live outcome count/,
);
assert.throws(
  () =>
    assertLiveReceipt({
      ...valid,
      checks: valid.checks.map((check) =>
        check.message.startsWith("9z-DF:")
          ? { success: true, message: "replacement-control" }
          : check,
      ),
    }),
  /missing required live outcome/,
);

console.log("Exact-artifact safety contract passed.");
