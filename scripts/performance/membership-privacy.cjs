const sources = ['selected-rows', 'app-console', 'pg-console', 'tool-console',
  'collector-snapshot', 'report-output', 'privacy-inputs'];
const credentialKinds = ['postgres-admin-password', 'scim-shared-secret', 'jwt-signing-secret',
  'oauth-client-secret', 'credential-encryption-key', 'role-a-password', 'role-b-password',
  'observer-password', 'not-applicable'];
const reasons = ['generated-credential-detected', 'canaries-required', 'canary-value-invalid',
  'credential-kind-invalid', 'private-source-missing', 'private-source-serialization',
  'required-row-count', 'row-count-mismatch', 'headers-not-json', 'headers-not-object',
  'authorization-missing', 'authorization-mask-mismatch', 'privacy-metadata-invalid',
  'provenance-row-count', 'provenance-duplicate', 'provenance-owner', 'provenance-endpoint',
  'provenance-method', 'provenance-route', 'provenance-status'];
const messages = {
  'canaries-required': 'Required generated-credential canaries',
  'private-source-missing': 'Required private console sample',
  'required-row-count': 'Required private row count',
  'row-count-mismatch': 'Original legacy private log sample',
};

function validateSafeFailure(details) {
  if (!details || !reasons.includes(details.reason) || !sources.includes(details.source) ||
      !credentialKinds.includes(details.credentialKind) ||
      Object.keys(details).some(key =>
        !['reason', 'source', 'credentialKind', 'rowIndex', 'authorizationPresent'].includes(key)) ||
      (Object.hasOwn(details, 'rowIndex') &&
        (!Number.isSafeInteger(details.rowIndex) || details.rowIndex < 0)) ||
      (Object.hasOwn(details, 'authorizationPresent') && typeof details.authorizationPresent !== 'boolean'))
    throw new Error('Invalid safe privacy failure metadata');
  return details;
}

function privacyFailure(details, findings) {
  let safeDetails;
  let safeFindings;
  try {
    safeDetails = { ...validateSafeFailure(details) };
    safeFindings = (findings ?? [details]).map(row => ({ ...validateSafeFailure(row) }));
  } catch {
    safeDetails = { reason: 'privacy-metadata-invalid', source: 'privacy-inputs',
      credentialKind: 'not-applicable' };
    safeFindings = [safeDetails];
  }
  const error = new Error(messages[safeDetails.reason] ??
    'Diagnostic privacy validation failed; private values withheld');
  error.code = 'DIAGNOSTIC_PRIVACY';
  error.safeDetails = safeDetails;
  error.safeFindings = safeFindings;
  return error;
}

function fail(reason, source, credentialKind = 'not-applicable', extra = {}) {
  throw privacyFailure({ reason, source, credentialKind, ...extra });
}

function validateCanaries(canaries) {
  if (!Array.isArray(canaries) || canaries.length === 0)
    fail('canaries-required', 'privacy-inputs');
  const seen = new Set();
  for (const canary of canaries) {
    if (!canary || !credentialKinds.includes(canary.kind) || canary.kind === 'not-applicable' ||
        seen.has(canary.kind) || Object.keys(canary).some(key => !['kind', 'value'].includes(key)))
      fail('credential-kind-invalid', 'privacy-inputs');
    if (typeof canary.value !== 'string' || canary.value.length === 0)
      fail('canary-value-invalid', 'privacy-inputs', canary.kind);
    seen.add(canary.kind);
  }
}

function credentialCanaries(credentials, passwords = {}) {
  const kinds = { POSTGRES_PASSWORD: 'postgres-admin-password', SCIM_SHARED_SECRET: 'scim-shared-secret',
    JWT_SECRET: 'jwt-signing-secret', OAUTH_CLIENT_SECRET: 'oauth-client-secret',
    CREDENTIAL_KEK: 'credential-encryption-key', a: 'role-a-password', b: 'role-b-password',
    observer: 'observer-password' };
  const canaries = Object.entries({ ...credentials, ...passwords })
    .map(([key, value]) => ({ kind: kinds[key], value }));
  validateCanaries(canaries);
  return canaries;
}

function assertCanariesAbsent(inputs, canaries) {
  validateCanaries(canaries);
  if (!Array.isArray(inputs) || inputs.length === 0)
    fail('private-source-missing', 'privacy-inputs');
  const findings = [];
  for (const input of inputs) {
    if (!input || !sources.includes(input.source))
      fail('privacy-metadata-invalid', 'privacy-inputs');
    if (typeof input.text !== 'string') fail('private-source-missing', input.source);
    for (const canary of canaries) {
      if (input.text.includes(canary.value)) {
        const details = { reason: 'generated-credential-detected', source: input.source,
          credentialKind: canary.kind,
          ...(input.rowIndex === undefined ? {} : { rowIndex: input.rowIndex }) };
        try { validateSafeFailure(details); }
        catch { fail('privacy-metadata-invalid', 'privacy-inputs'); }
        findings.push(details);
      }
    }
  }
  if (findings.length) throw privacyFailure(findings[0], findings);
}

function encodeSafeJson(value, canaries) {
  let text;
  try { text = JSON.stringify(value, null, 2) + '\n'; }
  catch { fail('private-source-serialization', 'report-output'); }
  assertCanariesAbsent([{ source: 'report-output', text }], canaries);
  return text;
}

module.exports = { sources, credentialKinds, reasons, validateSafeFailure, privacyFailure,
  fail, validateCanaries, credentialCanaries, assertCanariesAbsent, encodeSafeJson };
