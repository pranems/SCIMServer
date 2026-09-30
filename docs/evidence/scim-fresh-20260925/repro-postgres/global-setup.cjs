const { testGuard } = require("./safety.cjs");
module.exports = async () => {
  await testGuard();
};
