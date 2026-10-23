const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const file = path.resolve(__dirname, '../performance/build-membership-privacy-reference.cjs');
const extractedSource = process.env.DERIVED_REFERENCE_SOURCE;
function tool() {
  let loaded;
  assert.doesNotThrow(() => { loaded = require(file); }, 'Offline derived-reference guards must exist');
  return loaded;
}

test('only two exact reviewed logging statements change, preserving request and connection bytes', () => {
  const t = tool();
  const startup = t.startupPrefix + "'source-fixture-only'}`);";
  const before = ['connect({url: process.env.DATABASE_URL});', t.oldWarning,
    'await this.$connect();', startup, 'requestHandler();', ''].join('\n');
  assert.equal(t.patchStatements(before, startup), ['connect({url: process.env.DATABASE_URL});',
    t.newWarning, 'await this.$connect();', 'requestHandler();', ''].join('\n'));
  for (const bad of [before.replace(startup, ''), before + startup + '\n',
    before.replace(t.oldWarning, t.oldWarning.trim()), before.replace('Using database:', 'Database:')])
    assert.throws(() => t.patchStatements(bad, startup), /Exact reviewed/);
});

test('pinned original hash rejects drift even when the known logging statements remain', () => {
  const t = tool();
  assert.throws(() => t.patchOriginal(Buffer.from(`${t.oldWarning}\n${t.startupPrefix}\n`)),
    /Exact original compiled hash/);
});

test('real extracted compiled source satisfies the pinned correction without rendered-literal assumptions',
  { skip: !extractedSource }, () => {
    const t = tool();
    const bytes = fs.readFileSync(path.join(extractedSource, 'prisma.service.js'));
    const after = t.patchOriginal(bytes);
    assert.ok(!after.toString('utf8').includes('Using database:'));
    assert.ok(after.toString('utf8').includes(t.newWarning));
  });

test('whole distribution allows exactly the pinned logging delta and rejects omissions or metadata drift', () => {
  const t = tool();
  const entry = { type: '0', mode: 420, uid: 1001, gid: 1000, size: 10, sha256: 'unchanged' };
  const before = { [t.target]: { ...entry, sha256: t.originalHash }, 'app/package.json': entry };
  const after = { ...before, [t.target]: { ...entry, size: 9, sha256: t.derivedHash } };
  assert.equal(t.verifyDistribution(before, after).changedFiles, 1);
  for (const bad of [
    { ...after, 'app/package.json': { ...entry, sha256: 'changed' } },
    { [t.target]: after[t.target] },
    { ...after, extra: entry },
    { ...after, [t.target]: { ...after[t.target], uid: 0 } },
    before,
  ]) assert.throws(() => t.verifyDistribution(before, bad));
});

test('archive framing fails closed on unsupported type, checksum, path, duplicates and truncation', () => {
  const t = tool();
  function tar(name = 'app/a', type = '0') {
    const h = Buffer.alloc(512);
    h.write(name); h.write('0000644\0', 100); h.write('0000000\0', 108);
    h.write('0000000\0', 116); h.write('00000000000\0', 124);
    h.fill(32, 148, 156); h[156] = type.charCodeAt(0);
    const sum = [...h].reduce((a, b) => a + b, 0);
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  }
  const good = Buffer.concat([tar(), Buffer.alloc(1024)]);
  assert.equal(Object.keys(t.readArchive(good).entries).length, 1);
  for (const bad of [Buffer.concat([tar('../escape'), Buffer.alloc(1024)]),
    Buffer.concat([tar('app/a', 'x'), Buffer.alloc(1024)]),
    Buffer.concat([tar(), tar(), Buffer.alloc(1024)]), good.subarray(0, 520),
    Buffer.concat([Buffer.alloc(512, 1), Buffer.alloc(1024)])])
    assert.throws(() => t.readArchive(bad));
});

test('normal/default and unknown invocations cannot dispatch Docker or a build', () => {
  for (const args of [[], ['--admission'], ['--build-derived-reference']]) {
    const child = spawnSync(process.execPath, [file, ...args],
      { encoding: 'utf8', timeout: 2500, env: { ...process.env, PATH: '' } });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Explicit offline derived-reference opt-in/);
  }
});

test('derived evidence and local tags are rejected by unchanged normal admission', () => {
  tool();
  const { assessBlock, validateProtocol } = require('../performance/assess-membership.cjs');
  const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, '../performance/membership-protocol.json')));
  const block = protocol.blocks[0];
  const roles = ['candidate', 'baseline', 'baseline', 'candidate'];
  assert.throws(() => assessBlock(roles.map(role => ({ role, diagnosticOnly: true, derivedReference: true })),
    block, {}), /Diagnostic receipts cannot enter release admission/);
  protocol.baseline.image = 'scimserver-local:05520-privacy-reference-derived';
  assert.throws(() => validateProtocol(protocol));
});
