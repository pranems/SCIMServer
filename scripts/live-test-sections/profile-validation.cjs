const { runP7Contract } = require("../live-test-p7.cjs");

runP7Contract(process.env.SCIM_LIVE_BASE_URL, process.env.SCIM_LIVE_TOKEN)
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
