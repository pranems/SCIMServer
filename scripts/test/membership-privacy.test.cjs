const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const canaries = [
  { kind: 'scim-shared-secret', value: 'PRIVATE_SCIM_CANARY' },
  { kind: 'postgres-admin-password', value: 'PRIVATE_PG_CANARY' },
];

function safeFailure(run, expected) {
  assert.throws(run, error => {
    const { validateSafeFailure } = require('../performance/membership-privacy.cjs');
    assert.equal(error.code, 'DIAGNOSTIC_PRIVACY');
    validateSafeFailure(error.safeDetails);
    for (const [key, value] of Object.entries(expected)) assert.equal(error.safeDetails[key], value);
    for (const canary of canaries) assert.ok(!JSON.stringify(error).includes(canary.value));
    return true;
  });
}

test('all input and header rejection branches retain a safe source, kind and applicable row', () => {
  const { validateLegacyPrivacy } = require('../performance/membership-statements.cjs');
  const valid = [{ requestHeaders: '{"authorization":"[REDACTED]"}' }];
  for (const [rows, consoleLog, secrets, count, reason, source, rowIndex] of [
    [valid, '', [], 1, 'canaries-required', 'privacy-inputs'],
    [valid, '', [{ kind: 'scim-shared-secret', value: '' }], 1, 'canary-value-invalid', 'privacy-inputs'],
    [valid, '', [{ kind: 'PRIVATE_SCIM_CANARY', value: 'x' }], 1, 'credential-kind-invalid', 'privacy-inputs'],
    [valid, null, canaries, 1, 'private-source-missing', 'app-console'],
    [valid, '', canaries, 0, 'required-row-count', 'selected-rows'],
    [[], '', canaries, 1, 'row-count-mismatch', 'selected-rows'],
    [[null], '', canaries, 1, 'headers-not-object', 'selected-rows', 0],
    [[{ requestHeaders: 'not-json' }], '', canaries, 1, 'headers-not-json', 'selected-rows', 0],
    [[{ requestHeaders: '[]' }], '', canaries, 1, 'headers-not-object', 'selected-rows', 0],
    [[{ requestHeaders: '{}' }], '', canaries, 1, 'authorization-missing', 'selected-rows', 0],
    [[{ requestHeaders: '{"authorization":"different"}' }], '', canaries, 1,
      'authorization-mask-mismatch', 'selected-rows', 0],
  ]) safeFailure(() => validateLegacyPrivacy(rows, consoleLog, secrets, count),
    { reason, source, credentialKind: reason === 'canary-value-invalid' ? 'scim-shared-secret'
      : 'not-applicable', ...(rowIndex === undefined ? {} : { rowIndex }) });
});

test('row, application, PG, tool, collector and report canaries retain every static credential role', () => {
  const { assertCanariesAbsent, privacyFailure } = require('../performance/membership-privacy.cjs');
  for (const source of ['selected-rows', 'app-console', 'pg-console', 'tool-console',
    'collector-snapshot', 'report-output']) {
    safeFailure(() => assertCanariesAbsent([{
      source, text: 'PRIVATE_SCIM_CANARY PRIVATE_PG_CANARY',
      ...(source === 'selected-rows' ? { rowIndex: 3 } : {}),
    }], canaries), { reason: 'generated-credential-detected', source, credentialKind: 'scim-shared-secret' });
    try {
      assertCanariesAbsent([{ source, text: 'PRIVATE_SCIM_CANARY PRIVATE_PG_CANARY' }], canaries);
      assert.fail('Expected privacy rejection');
    } catch (error) {
      assert.deepEqual(error.safeFindings.map(row => row.credentialKind),
        ['scim-shared-secret', 'postgres-admin-password']);
      for (const finding of error.safeFindings) {
        assert.deepEqual(Object.keys(finding).sort(), ['credentialKind', 'reason', 'source']);
      }
    }
  }
  const invalid = privacyFailure({ reason: 'PRIVATE_SCIM_CANARY', source: 'PRIVATE_PG_CANARY' });
  assert.deepEqual(invalid.safeDetails, {
    reason: 'privacy-metadata-invalid', source: 'privacy-inputs', credentialKind: 'not-applicable',
  });
});

test('serializer and missing-source failures cannot bypass complete privacy metadata', () => {
  const { assertCanariesAbsent, encodeSafeJson } = require('../performance/membership-privacy.cjs');
  safeFailure(() => assertCanariesAbsent([{ source: 'pg-console', text: null }], canaries),
    { reason: 'private-source-missing', source: 'pg-console', credentialKind: 'not-applicable' });
  safeFailure(() => assertCanariesAbsent([{ source: 'PRIVATE_SCIM_CANARY', text: '' }], canaries),
    { reason: 'privacy-metadata-invalid', source: 'privacy-inputs', credentialKind: 'not-applicable' });
  const circular = {}; circular.self = circular;
  safeFailure(() => encodeSafeJson(circular, canaries),
    { reason: 'private-source-serialization', source: 'report-output', credentialKind: 'not-applicable' });
  safeFailure(() => encodeSafeJson({ value: canaries[0].value }, canaries),
    { reason: 'generated-credential-detected', source: 'report-output', credentialKind: 'scim-shared-secret' });
});

test('bounded child retains only complete safe facts on output-canary rejection', () => {
  const modulePath = path.resolve(__dirname, '../performance/membership-privacy.cjs');
  const child = spawnSync(process.execPath, ['-e', `
    const p=require(${JSON.stringify(modulePath)});
    const c=[{kind:'scim-shared-secret',value:'PRIVATE_SCIM_CANARY'}];
    try { p.encodeSafeJson({payload:c[0].value},c); process.exitCode=2; }
    catch(e) { process.stdout.write(p.encodeSafeJson({failure:e.safeDetails},c)); }
  `], { encoding: 'utf8', timeout: 2000, maxBuffer: 2048 });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.doesNotMatch(child.stdout, /PRIVATE_SCIM_CANARY|payload|stack|length/);
  assert.deepEqual(JSON.parse(child.stdout), { failure: {
    reason: 'generated-credential-detected', source: 'report-output', credentialKind: 'scim-shared-secret',
  } });
});

test('real credential callers supply static roles and bare privacy-canary assertions cannot return', () => {
  const { credentialCanaries, privacyFailure } = require('../performance/membership-privacy.cjs');
  const credentials = Object.fromEntries(['POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET',
    'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK'].map(key => [key, 'SYNTHETIC_CANARY']));
  assert.deepEqual(credentialCanaries(credentials).map(row => row.kind), [
    'postgres-admin-password', 'scim-shared-secret', 'jwt-signing-secret',
    'oauth-client-secret', 'credential-encryption-key',
  ]);
  assert.deepEqual(credentialCanaries(credentials, { a: 'a', b: 'b', observer: 'c' })
    .slice(5).map(row => row.kind), ['role-a-password', 'role-b-password', 'observer-password']);
  for (const extra of ['value', 'credentialHash', 'length', 'context']) {
    const failure = privacyFailure({ reason: 'generated-credential-detected',
      source: 'app-console', credentialKind: 'scim-shared-secret', [extra]: 'PRIVATE_SCIM_CANARY' });
    assert.equal(failure.safeDetails.reason, 'privacy-metadata-invalid');
    assert.ok(!JSON.stringify(failure).includes('PRIVATE_SCIM_CANARY'));
  }
  for (const file of ['membership-statements.cjs', 'run-membership-statements.cjs',
    'run-membership-privacy-functional.cjs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../performance', file), 'utf8');
    assert.doesNotMatch(source,
      /assert\.\w+\([^\n;]*(?:\.includes\(secret|(?:privacy|collector|output) canary)/i);
  }
});
