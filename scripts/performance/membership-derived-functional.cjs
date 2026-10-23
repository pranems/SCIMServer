const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fail, assertCanariesAbsent } = require('./membership-privacy.cjs');
const { validateLegacyPrivacy, maskPolicyPatch, verifyMaskPolicy } = require('./membership-statements.cjs');
const imageId = 'sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4';
const parentImage = 'ghcr.io/pranems/scimserver@sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a';
const pins = Object.freeze({
  manifest: '100490fd58eec02c9fec29169a6d25882a475920fdc8a136d8c08a5ab9a2fd54',
  receipt: 'b0fd28138a4f622927d5816ea8180e7edb87a792be5e39b0e58b6a5596d03a9d',
  source: 'e2bae6f419acf0c2d05847a0774f22d7b02707228ff3acfdbf94c813192d8824',
});
function validateBuildProof(inputs) {
  const proof = {};
  for (const [key, expected] of Object.entries(pins)) {
    assert.ok(Buffer.isBuffer(inputs[key]), 'Required immutable build proof');
    assert.equal(crypto.createHash('sha256').update(inputs[key]).digest('hex'), expected,
      'Immutable build proof bytes changed');
    proof[key] = JSON.parse(inputs[key]);
  }
  const { manifest, receipt, source } = proof;
  assert.equal(receipt.status, 'DERIVED_BUILD_VERIFIED');
  assert.equal(receipt.derivedImageId, imageId);
  for (const item of [manifest, receipt]) {
    assert.equal(item.parentImage, parentImage);
    assert.equal(item.derivedReference, true);
    assert.equal(item.diagnosticOnly, true);
    assert.equal(item.admissionEligible, false);
    assert.equal(item.baselineAdoptionApproved, false);
    assert.equal(item.runtimeQualified, false);
  }
  assert.equal(receipt.cleanup.verified, true);
  assert.equal(receipt.runtimeConfigEqualExceptLabels, true);
  assert.equal(receipt.inheritedLayersIdentical, true);
  assert.equal(receipt.distribution.entries, 13678);
  assert.equal(receipt.distribution.changedFiles, 1);
  assert.equal(source.image, parentImage);
  assert.equal(source.unstarted, true);
  assert.equal(source.cleanupVerified, true);
  assert.equal(source.compiledSha256, receipt.compiledBeforeSha256);
  assert.equal(manifest.sourceProofSha256, pins.source);
  assert.equal(manifest.derivedHash, receipt.compiledAfterSha256);
  return { imageId, parentImage, proofHashes: { ...pins }, labels: manifest.labels,
    buildSourceCommit: receipt.sourceCommit, compiledSha256: receipt.compiledAfterSha256 };
}
function loadBuildProof(root) {
  const directory = path.join(root, 'test-results/derived-reference-20261023');
  return validateBuildProof(Object.fromEntries(Object.entries({
    manifest: 'offline-build/manifest.json', receipt: 'offline-build/receipt.json', source: 'source/proof.json',
  }).map(([key, file]) => [key, fs.readFileSync(path.join(directory, file))])));
}
function verifyDerivedImage(image, proof) {
  assert.equal(proof.imageId, imageId);
  assert.equal(image.id, imageId, 'Actual immutable derived image required');
  assert.equal(image.os, 'linux');
  assert.equal(image.architecture, 'amd64');
  for (const [key, value] of Object.entries(proof.labels)) assert.equal(image.labels[key], value);
  return true;
}
function validateFunctionalPrivacy(rows, consoles, canaries) {
  if (!Array.isArray(rows) || rows.length !== 4) fail('row-count-mismatch', 'selected-rows');
  const sources = ['app-console', 'pg-console', 'tool-console'];
  if (!consoles || typeof consoles !== 'object' || Array.isArray(consoles) ||
      Object.keys(consoles).some(source => !sources.includes(source)))
    fail('privacy-metadata-invalid', 'privacy-inputs');
  const inputs = rows.map((row, rowIndex) => {
    let text;
    try { text = JSON.stringify(row); }
    catch { fail('private-source-serialization', 'selected-rows', 'not-applicable', { rowIndex }); }
    if (typeof text !== 'string')
      fail('private-source-serialization', 'selected-rows', 'not-applicable', { rowIndex });
    return { source: 'selected-rows', rowIndex, text };
  });
  for (const source of sources) {
    if (typeof consoles[source] !== 'string' || !consoles[source].trim())
      fail('private-source-missing', source);
    inputs.push({ source, text: consoles[source] });
  }
  assertCanariesAbsent(inputs, canaries);
  return validateLegacyPrivacy(rows, consoles['app-console'], canaries, 4);
}
function completeOwnedCleanup(cleanup) {
  return cleanup?.verified === true && Array.isArray(cleanup.rows) && cleanup.rows.length === 2 &&
    cleanup.rows.every(row => row.capture === true && row.removed === true && row.verified === true);
}
module.exports = { validateBuildProof, loadBuildProof, verifyDerivedImage, validateFunctionalPrivacy,
  maskPolicyPatch, verifyMaskPolicy, completeOwnedCleanup, imageId };
