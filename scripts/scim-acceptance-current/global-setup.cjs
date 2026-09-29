const { testGuard } = require("./current-safety.cjs");

module.exports = async () => {
  await testGuard();
};
