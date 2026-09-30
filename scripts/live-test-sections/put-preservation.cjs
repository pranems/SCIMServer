const { runPutPreservationContract } = require("../live-test-put-preservation.cjs");

runPutPreservationContract(process.env.SCIM_LIVE_BASE_URL, process.env.SCIM_LIVE_TOKEN)
  .then(receipt => console.log(JSON.stringify(receipt)))
  .catch(error => { console.error(error); process.exitCode = 1; });
