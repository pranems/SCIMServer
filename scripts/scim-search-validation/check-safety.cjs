const assert = require('node:assert/strict');
const fs = require('node:fs');
const { INERT, markerGuard, containerGuard, guard } = require('./safety.cjs');

async function main() {
  const original = fs.existsSync;
  try {
    fs.existsSync = () => true;
    assert.throws(markerGuard, /existing database marker/);
  } finally { fs.existsSync = original; }
  process.env.SCIM_P5_CONTAINER = 'not-an-owned-container';
  assert.throws(containerGuard);
  process.env.PERSISTENCE_BACKEND = 'inmemory';
  process.env.DATABASE_URL = 'postgresql://shared.invalid/do_not_connect';
  await assert.rejects(guard);
  process.env.PERSISTENCE_BACKEND = 'unknown';
  await assert.rejects(guard);
  process.env.PERSISTENCE_BACKEND = 'inmemory';
  process.env.DATABASE_URL = INERT;
  await guard();
  process.stdout.write('Safety: 4 negative controls and 1 positive control passed; no database accessed.\n');
}
main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
