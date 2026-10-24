const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { runDefaultChild } = require('./membership-child-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const qualification = path.join(root, 'test-results/derived-functional-continuation-20261023',
  'attempt3-20261023T230634807Z/qualification-receipt.json');
const tool = () => require('../performance/membership-derived-statements.cjs');

test('derived statement reference binds exact functional receipt and original build proof', () => {
  const implementation = tool();
  const bytes = fs.readFileSync(qualification);
  const result = implementation.validateQualification(bytes);
  assert.equal(result.imageId, require('../performance/membership-derived-functional.cjs').imageId);
  assert.equal(result.referenceKind, 'DERIVEDSTARTUPPRIVACYBACKPORT');
  for (const invalid of [undefined, Buffer.concat([bytes, Buffer.from('\n')]),
    Buffer.from(JSON.stringify({ ...JSON.parse(bytes), status: 'INVALID' })),
    Buffer.from(JSON.stringify({ ...JSON.parse(bytes), imageId: 'arbitrary' }))])
    assert.throws(() => implementation.validateQualification(invalid), /Pinned functional qualification required/);
  const proof = implementation.loadReference(root);
  assert.equal(proof.baselineAdoptionApproved, false);
  assert.equal(proof.admissionEligible, false);
  assert.equal(proof.buildProof.imageId, result.imageId);
});

test('derived closure freezes every local runtime helper and rejects missing or changed bytes', () => {
  const implementation = tool();
  const files = implementation.runtimeFiles(root);
  for (const required of ['membership-privacy.cjs', 'membership-history.cjs', 'membership-observer.cjs',
    'membership-derived-functional.cjs', 'membership-derived-statements.cjs', 'membership-console.cjs',
    'benchmark-membership.cjs', 'membership-history-contract.ps1', 'minimal-group-members.ps1'])
    assert.ok(files.includes(required), required);
  const directory = path.join(root, 'test-results', `derived-closure-test-${crypto.randomUUID()}`);
  fs.mkdirSync(directory);
  try {
    const hashes = implementation.freezeInputs(root, directory);
    assert.equal(implementation.verifyInputs(root, directory, hashes), true);
    const target = path.join(directory, 'frozen-inputs', 'membership-console.cjs');
    fs.appendFileSync(target, '\n');
    assert.throws(() => implementation.verifyInputs(root, directory, hashes), /Frozen runtime input changed/);
    fs.unlinkSync(target);
    assert.throws(() => implementation.verifyInputs(root, directory, hashes), /Frozen runtime input missing/);
    const incomplete = { ...hashes }; delete incomplete['membership-history.cjs'];
    assert.throws(() => implementation.verifyInputs(root, directory, incomplete), /Complete runtime closure required/);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('derived statement privacy requires all complete consoles and retains all static source/kind causes', () => {
  const implementation = tool();
  const rows = Array.from({ length: 200 }, () => ({ requestHeaders: '{"authorization":"[REDACTED]"}' }));
  const consoles = { 'app-console': 'application initialized', 'pg-console': 'database ready',
    'tool-console': 'owned metadata read' };
  const canaries = ['postgres-admin-password', 'scim-shared-secret', 'jwt-signing-secret',
    'oauth-client-secret', 'credential-encryption-key', 'role-a-password', 'role-b-password',
    'observer-password'].map((kind, index) => ({ kind, value: `PRIVATE_SENTINEL_${index}_END` }));
  assert.equal(implementation.validatePrivateInputs(rows, consoles, canaries).validatedRows, 200);
  for (const source of Object.keys(consoles)) {
    assert.throws(() => implementation.validatePrivateInputs(rows, { ...consoles, [source]: '' }, canaries),
      error => error.safeDetails.source === source && error.safeDetails.reason === 'private-source-missing');
    for (const canary of canaries)
      assert.throws(() => implementation.validatePrivateInputs(rows,
        { ...consoles, [source]: canary.value }, canaries), error =>
        error.safeDetails.source === source && error.safeDetails.credentialKind === canary.kind &&
        !JSON.stringify(error).includes(canary.value));
  }
  for (const canary of canaries) {
    const changed = [...rows]; changed[3] = { requestHeaders: JSON.stringify({ authorization: canary.value }) };
    assert.throws(() => implementation.validatePrivateInputs(changed, consoles, canaries),
      error => error.safeDetails.source === 'selected-rows' && error.safeDetails.rowIndex === 3 &&
        error.safeDetails.credentialKind === canary.kind && !JSON.stringify(error).includes(canary.value));
  }
  rows[0].requestHeaders = '{}';
  assert.throws(() => implementation.validatePrivateInputs(rows, consoles, canaries),
    error => error.safeDetails.reason === 'authorization-missing' && error.safeDetails.rowIndex === 0);
});

test('derived statement policy guards reject legacy omissions before workload windows', () => {
  const { verifyMaskPolicy } = require('../performance/membership-statements.cjs');
  assert.equal(verifyMaskPolicy('false', false), true);
  for (const [server, endpoint] of [[undefined, false], ['true', false], ['false', undefined], ['false', true]])
    assert.throws(() => verifyMaskPolicy(server, endpoint), /false/);
});

test('derived family cannot enter release admission for the intended diagnostic reason', () => {
  const { assessBlock } = require('../performance/assess-membership.cjs');
  assert.throws(() => assessBlock([...'BAAB'].map(role => ({
    role: role === 'A' ? 'baseline' : 'candidate', family: tool().family, diagnosticOnly: true,
  })), { order: 'BAAB', sameImage: false }, {}),
    /Diagnostic receipts cannot enter release admission/);
});

test('normal statement default still rejects before any external dispatch', async () => {
  const result = await runDefaultChild(path.join(root, 'scripts/performance/run-membership-statements.cjs'),
    'Explicit statement diagnostic opt-in required');
  assert.equal(result.status, 1);
  assert.equal(result.value.guardHits, 1);
});

test('derived entry guard, preallocation seal, complete console capture and unchanged bounds are wired', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-statements.cjs'), 'utf8');
  assert.ok(source.includes('--derived-statement-diagnostic-only'));
  const intent = source.indexOf("writeResult(path.join(directory, 'intent.json')");
  assert.ok(intent >= 0 && intent < source.indexOf("images[name] ="));
  assert.ok(source.indexOf('derivedTool.verifyInputs(root, directory') < source.indexOf("await docker(['network', 'create'"));
  assert.ok(source.includes('derived && cleanup ? 30000 : cleanup ? 15000 : 60000'));
  assert.ok(source.includes('derivedTool.validateStreamedPrivateInputs'));
  assert.ok(source.includes('await consoleCapture.captureChild'));
  assert.ok(source.includes('manifest.policy.consoleCapture'));
  assert.ok(source.includes("await captureLogs(app.id, false, currentRows?.requestId)"));
  assert.ok(source.includes("derived ? 'runtime-manifest.json' : 'manifest.json'"));
  assert.ok(source.includes('45 * 60000'));
  assert.ok(source.includes("SET default_transaction_read_only=on"));
  assert.ok(source.includes("assert.equal(readOnly, 'on'"));
  assert.ok(source.includes("child.once(derived ? 'close' : 'exit'"));
  assert.ok(!source.includes("derived ? ['BAAB', 'ABBA',"));
});
