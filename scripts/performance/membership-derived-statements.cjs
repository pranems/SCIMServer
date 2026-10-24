const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const reference = require('./membership-derived-functional.cjs');
const { fail, assertCanariesAbsent, validateCanaries, credentialKinds } = require('./membership-privacy.cjs');
const { validateLegacyPrivacy, validateLegacyRows } = require('./membership-statements.cjs');
const { validatePrivacyRows } = require('./membership-history.cjs');
const { requireCapture } = require('./membership-console.cjs');
const family = 'membership-derived-statement-diagnostic';
const qualificationHash = 'cf6b36d17d0f754ae7c57d02d5fc0db801b074c8e80cb90005f0cf1e7d936210';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function validateQualification(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && sha(bytes) === qualificationHash,
    'Pinned functional qualification required');
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.status, 'DERIVED_FUNCTIONAL_QUALIFIED');
  assert.equal(receipt.imageId, reference.imageId);
  assert.equal(receipt.strictPrivacyComplete, true);
  assert.equal(receipt.cleanup.verified, true);
  assert.ok(receipt.cleanup.rows.every(row => row.capture && row.removed && row.verified));
  assert.deepEqual(receipt.remainingOwnedContainers, []);
  assert.deepEqual(receipt.remainingOwnedNetworks, []);
  assert.equal(receipt.admissionEligible, false);
  assert.equal(receipt.baselineAdoptionApproved, false);
  return { imageId: receipt.imageId, parentImage: receipt.parentImage,
    qualificationSha256: qualificationHash, referenceKind: 'DERIVEDSTARTUPPRIVACYBACKPORT',
    buildProofHashes: receipt.buildProofHashes };
}

function loadReference(root) {
  const qualification = validateQualification(fs.readFileSync(path.join(root,
    'test-results/derived-functional-continuation-20261023/attempt3-20261023T230634807Z/qualification-receipt.json')));
  const buildProof = reference.loadBuildProof(root);
  assert.equal(qualification.imageId, buildProof.imageId);
  assert.equal(qualification.parentImage, buildProof.parentImage);
  assert.deepEqual(qualification.buildProofHashes, buildProof.proofHashes);
  return { ...qualification, buildProof, admissionEligible: false,
    baselineAdoptionApproved: false, descriptiveReferenceAuthorizedForThisStudyOnly: true };
}

function runtimeFiles(root) {
  return [...fs.readdirSync(path.join(root, 'scripts/performance'))
    .filter(file => /\.(cjs|json|ps1)$/.test(file)), 'minimal-group-members.ps1'].sort();
}

function inputPath(root, file) {
  return path.join(root, file === 'minimal-group-members.ps1' ? 'scripts/live-test-sections' : 'scripts/performance', file);
}

function freezeInputs(root, directory) {
  fs.mkdirSync(path.join(directory, 'frozen-inputs'));
  return Object.fromEntries(runtimeFiles(root).map(file => {
    const bytes = fs.readFileSync(inputPath(root, file));
    fs.writeFileSync(path.join(directory, 'frozen-inputs', file), bytes, { flag: 'wx' });
    return [file, sha(bytes)];
  }));
}

function verifyInputs(root, directory, hashes) {
  assert.deepEqual(Object.keys(hashes).sort(), runtimeFiles(root), 'Complete runtime closure required');
  for (const [file, hash] of Object.entries(hashes)) {
    const frozen = path.join(directory, 'frozen-inputs', file);
    assert.ok(fs.existsSync(frozen), 'Frozen runtime input missing');
    assert.equal(sha(fs.readFileSync(frozen)), hash, 'Frozen runtime input changed');
    assert.equal(sha(fs.readFileSync(inputPath(root, file))), hash,
      'Loaded runtime input changed');
  }
  return true;
}

function validatePrivateInputs(rows, consoles, canaries) {
  for (const source of ['app-console', 'pg-console', 'tool-console'])
    if (typeof consoles?.[source] !== 'string' || !consoles[source].trim())
      fail('private-source-missing', source);
  assert.ok(Array.isArray(rows) && rows.length === 200, 'Original private row count');
  assertCanariesAbsent([
    ...rows.map((row, rowIndex) => ({ source: 'selected-rows', rowIndex, text: JSON.stringify(row) })),
    ...Object.entries(consoles).map(([source, text]) => ({ source, text })),
  ], canaries);
  return validateLegacyPrivacy(rows, consoles['app-console'], canaries);
}

function validateStreamedPrivateInputs(rows, app, pg, toolConsole, canaries, role) {
  validateCanaries(canaries);
  if (canaries.length !== 8 || credentialKinds.slice(0, 8).some(kind =>
    !canaries.some(row => row.kind === kind))) fail('canaries-required', 'privacy-inputs');
  assert.ok(['A', 'B'].includes(role), 'Static statement application role required');
  if (typeof toolConsole !== 'string' || !toolConsole.trim()) fail('private-source-missing', 'tool-console');
  assertCanariesAbsent([{ source: 'tool-console', text: toolConsole }], canaries);
  const legacy = validateLegacyRows(rows, canaries);
  const checked = role === 'B' ? validatePrivacyRows(rows, canaries.map(row => row.value)) : legacy;
  requireCapture(app, { role: role === 'A' ? 'reference-app' : 'candidate-app', source: 'app-console',
    canaries, ...(role === 'B' ? { correlationRequestId: checked.requestId } : {}) });
  requireCapture(pg, { role: 'pg', source: 'pg-console', canaries });
  const safeRows = { ...checked };
  delete safeRows.requestId;
  return { ...safeRows, consoleCaptures: [app, pg], credentialRoles: canaries.map(row => row.kind),
    ...(role === 'B' ? { sameRecordPresent: app.correlationPresent } : {}) };
}

module.exports = { family, validateQualification, loadReference, runtimeFiles, freezeInputs,
  verifyInputs, validatePrivateInputs, validateStreamedPrivateInputs, inputPath };
