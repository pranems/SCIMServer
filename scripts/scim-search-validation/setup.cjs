const { guard } = require('./safety.cjs');
module.exports = async () => { await guard(); };
