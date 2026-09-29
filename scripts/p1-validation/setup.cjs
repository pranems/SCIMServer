module.exports = async () => {
  await require("./safety.cjs").testGuard();
};
