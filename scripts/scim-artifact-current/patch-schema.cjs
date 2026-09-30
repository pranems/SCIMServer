const { runPatchSchema } = require("../live-test-sections/patch-schema.cjs");

runPatchSchema(
  process.env.SCIM_LIVE_BASE_URL,
  process.env.SCIM_LIVE_TOKEN,
)
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
