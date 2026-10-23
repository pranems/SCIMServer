const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, fork, execFileSync } = require('node:child_process');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const proofRoot = path.join(root, 'test-results/derived-reference-20261023');
function implementation() {
  let tool;
  assert.doesNotThrow(() => { tool = require('../performance/membership-derived-functional.cjs'); },
    'Derived immutable proof and functional guards must exist');
  return tool;
}
function inputs() {
  return Object.fromEntries(Object.entries({
    manifest: 'offline-build/manifest.json', receipt: 'offline-build/receipt.json',
    source: 'source/proof.json',
  }).map(([key, file]) => [key, fs.readFileSync(path.join(proofRoot, file))]));
}
test('exact retained build/source proof binds only the immutable derived image',
  { skip: !fs.existsSync(path.join(proofRoot, 'offline-build/receipt.json')) }, () => {
  const tool = implementation();
  const proof = tool.validateBuildProof(inputs());
  assert.equal(proof.imageId, 'sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4');
  const manifest = JSON.parse(inputs().manifest);
  const image = { id: proof.imageId, os: 'linux', architecture: 'amd64', labels: manifest.labels };
  assert.equal(tool.verifyDerivedImage(image, proof), true);
  for (const changed of [{ ...image, id: manifest.parentImage }, { ...image, id: 'mutable-tag' },
    { ...image, labels: {} }, { ...image, os: 'windows' },
    { ...image, labels: { ...image.labels, 'io.scimserver.reference.admission-eligible': 'true' } }])
    assert.throws(() => tool.verifyDerivedImage(changed, proof));
  for (const key of ['manifest', 'receipt', 'source']) {
    const absent = inputs(); delete absent[key];
    assert.throws(() => tool.validateBuildProof(absent));
    const drift = inputs(); drift[key] = Buffer.concat([drift[key], Buffer.from('\n')]);
    assert.throws(() => tool.validateBuildProof(drift));
  }
});
test('derived privacy requires all private sources and exact masks, preserving safe source/kind failures', () => {
  const tool = implementation();
  const rows = Array.from({ length: 4 }, () => ({ requestHeaders: '{"authorization":"[REDACTED]"}' }));
  const canaries = [{ kind: 'scim-shared-secret', value: 'PRIVATE_DERIVED_SENTINEL' }];
  const consoles = { 'app-console': 'startup', 'pg-console': 'ready', 'tool-console': 'owned' };
  assert.equal(tool.validateFunctionalPrivacy(rows, consoles, canaries).validatedRows, 4);
  for (const source of Object.keys(consoles)) {
    for (const text of [undefined, '', '   ', canaries[0].value]) {
      assert.throws(() => tool.validateFunctionalPrivacy(rows, { ...consoles, [source]: text }, canaries), error => {
        assert.equal(error.code, 'DIAGNOSTIC_PRIVACY');
        assert.equal(error.safeDetails.source, source);
        assert.equal(error.safeDetails.credentialKind, text === canaries[0].value ? 'scim-shared-secret' : 'not-applicable');
        assert.doesNotMatch(JSON.stringify(error.safeDetails), /PRIVATE_DERIVED_SENTINEL/);
        return true;
      });
    }
  }
  assert.throws(() => tool.validateFunctionalPrivacy(rows.map(() => ({ requestHeaders: '{}' })), consoles, canaries),
    error => error.safeDetails.reason === 'authorization-missing');
  assert.throws(() => tool.validateFunctionalPrivacy(rows, consoles, []));
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => tool.validateFunctionalPrivacy([cyclic, ...rows.slice(1)], consoles, canaries),
    error => error.safeDetails.reason === 'private-source-serialization' &&
      error.safeDetails.source === 'selected-rows' && error.safeDetails.rowIndex === 0);
  assert.throws(() => tool.validateFunctionalPrivacy([undefined, ...rows.slice(1)], consoles, canaries),
    error => error.safeDetails.source === 'selected-rows' && error.safeDetails.rowIndex === 0);
  assert.throws(() => tool.validateFunctionalPrivacy(rows, null, canaries),
    error => error.code === 'DIAGNOSTIC_PRIVACY' && error.safeDetails.source === 'privacy-inputs');
});
test('real default child and derived family cannot dispatch or enter admission', () => {
  const file = path.join(root, 'scripts/performance/run-membership-privacy-functional.cjs');
  for (const args of [[], ['--unknown'], ['--derived-reference-functional-only']]) {
    const child = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 3000 });
    assert.equal(child.status, 1);
    assert.doesNotMatch(child.stdout, /FUNCTIONAL-COMPLETE|QUALIFIED/);
  }
  const { assessBlock } = require('../performance/assess-membership.cjs');
  assert.throws(() => assessBlock(['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role, family: 'membership-derived-reference-functional', derivedReference: true, diagnosticOnly: true,
    admissionEligible: false,
  })), { order: 'BAAB', sameImage: false }, {}), /Diagnostic receipts cannot enter release admission/);
});
test('prospective mask fixture must request and independently verify both false policies before windows', () => {
  const tool = implementation();
  assert.deepEqual(tool.maskPolicyPatch(), { profile: { settings: { PersistRequestSecrets: false } } });
  assert.equal(tool.verifyMaskPolicy('false', false), true);
  for (const pair of [[undefined, undefined], ['true', false], ['false', undefined], ['false', true],
    ['false', 'false']]) assert.throws(() => tool.verifyMaskPolicy(...pair));
  const runner = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-statements.cjs'), 'utf8');
  assert.match(runner, /PERSIST_REQUEST_SECRETS=false/);
  assert.match(runner, /SCIM_BENCH_REQUIRE_MASKS: '1'/);
  assert.match(runner, /verifyMaskPolicy/);
  assert.match(runner, /fixture-policy/);
  const old = execFileSync('git', ['show', 'a7e79e82:scripts/performance/run-membership-statements.cjs'],
    { cwd: root, encoding: 'utf8' });
  assert.throws(() => assert.match(old, /PERSIST_REQUEST_SECRETS=false/),
    'Negative control must reject the old omitted server policy');
  assert.throws(() => assert.match(old, /verifyMaskPolicy/),
    'Negative control must reject the old omitted effective-policy verification');
});
test('derived qualification cannot pass on verified removal with failed final capture', () => {
  const tool = implementation();
  assert.equal(typeof tool.completeOwnedCleanup, 'function');
  const cleanup = { verified: true, rows: [0, 1].map(() => ({ capture: true, removed: true, verified: true })) };
  assert.equal(tool.completeOwnedCleanup(cleanup), true);
  for (const key of ['capture', 'removed', 'verified']) {
    const changed = structuredClone(cleanup); changed.rows[0][key] = false;
    assert.equal(tool.completeOwnedCleanup(changed), false);
  }
  assert.equal(tool.completeOwnedCleanup({ verified: true, rows: [] }), false);
});
test('real bounded workload child stops before Group requests when fixture policy is rejected', async () => {
  const routes = [];
  const endpointId = '11111111-1111-4111-8111-111111111111';
  const server = http.createServer((request, response) => {
    routes.push(`${request.method} ${request.url}`);
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/scim/admin/version') response.end('{"version":"0.55.20"}');
    else if (request.method === 'POST') response.end(JSON.stringify({ id: endpointId }));
    else if (request.method === 'DELETE') response.end('{}');
    else response.end('{"endpoints":[]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = path.join(root, 'test-results/derived-functional-unit');
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `${randomUUID()}.json`);
  let child;
  try {
    child = fork(path.join(root, 'scripts/performance/benchmark-membership.cjs'), [], {
      silent: true, timeout: 5000, cwd: root,
      env: { ...process.env, SCIM_BENCH_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        SCIM_BENCH_TOKEN: 'unit-fixture-only', SCIM_BENCH_VERSION: '0.55.20', SCIM_BENCH_OUTPUT: output,
        SCIM_BENCH_DEADLINE_UTC: String(Date.now() + 4000), SCIM_BENCH_TRACE: '1',
        SCIM_BENCH_HISTORY: '1', SCIM_BENCH_HISTORY_OWNER: 'membership-history-diagnostic',
        SCIM_BENCH_REQUIRE_MASKS: '1' },
    });
    child.stdout.resume(); child.stderr.resume();
    const messages = [];
    child.on('message', message => {
      messages.push(message);
      child.send({ boundary: message.boundary, ok: false });
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
    });
    assert.equal(code, 1);
    assert.deepEqual(messages, [{ boundary: 'fixture-policy', endpointId }]);
    assert.equal(routes.some(route => /\/Groups|\/Users/.test(route)), false);
    const receipt = JSON.parse(fs.readFileSync(output));
    assert.equal(receipt.status, 'FAIL');
    assert.equal(receipt.cleanup.verified, true);
    assert.ok(Object.values(receipt.samples).every(values => values.length === 0));
  } finally {
    if (child && child.exitCode === null) child.kill();
    await new Promise(resolve => server.close(resolve));
  }
});
