const sources = ['selected-rows', 'app-console', 'pg-console', 'tool-console',
  'collector-snapshot', 'report-output', 'privacy-inputs', 'ambiguous-console'];
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

const lifecycleOperations = ['command', 'capture', 'remove', 'verify', 'discovery', 'inventory',
  'close-client', 'close-channel', 'network-inspect', 'network-remove', 'network-verify'];
const lifecycleRoles = ['app', 'reference-app', 'candidate-app', 'pg', 'observer', 'owned-container', 'network', 'client'];
const lifecycleCategories = ['unexpected', 'exit', 'terminated', 'timeout', 'spawn',
  'deadline', 'ownership', 'assertion', 'aborted', 'still-present', 'invalid-metadata',
  'output-limit', 'native-buffer', 'native-memory', 'native-io', 'incomplete-output', 'privacy'];
const nativeCategories = {
  ERR_CHILD_PROCESS_STDIO_MAXBUFFER: 'output-limit', ENOBUFS: 'native-buffer',
  ERR_BUFFER_OUT_OF_BOUNDS: 'native-buffer', ERR_BUFFER_TOO_LARGE: 'native-buffer',
  ERR_STRING_TOO_LONG: 'native-buffer', ENOMEM: 'native-memory',
  EIO: 'native-io', EPIPE: 'native-io', EBADF: 'native-io', ENOSPC: 'native-io',
  ECONNRESET: 'native-io', ECONNREFUSED: 'native-io',
  ERR_STREAM_PREMATURE_CLOSE: 'incomplete-output',
  CAPTURE_TOTAL_LIMIT: 'output-limit', CAPTURE_FRAME_LIMIT: 'output-limit',
  CAPTURE_RECORD_LIMIT: 'output-limit', CAPTURE_EMPTY: 'incomplete-output',
  CAPTURE_CHANNEL: 'incomplete-output', CAPTURE_INCOMPLETE: 'incomplete-output',
  CAPTURE_CORRELATION: 'incomplete-output', ABORT_ERR: 'aborted', ECANCELED: 'aborted',
  ETIMEDOUT: 'timeout', ENOENT: 'spawn', EACCES: 'spawn', EPERM: 'spawn',
  E2BIG: 'spawn', ENOEXEC: 'spawn', ERR_IPC_CHANNEL_CLOSED: 'native-io',
  ERR_INVALID_ARG_TYPE: 'invalid-metadata', ERR_OUT_OF_RANGE: 'invalid-metadata',
  LIFECYCLE_DEADLINE: 'deadline', LIFECYCLE_OWNER: 'ownership',
  LIFECYCLE_STILL_PRESENT: 'still-present', LIFECYCLE_METADATA: 'invalid-metadata',
  ERR_ASSERTION: 'assertion', DIAGNOSTIC_PRIVACY: 'privacy',
};
const lifecycleSignals = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'SIGBUS',
  'SIGILL', 'SIGFPE', 'SIGHUP', 'SIGQUIT', 'SIGPIPE', 'SIGTRAP', 'SIGXCPU', 'SIGXFSZ'];
const lifecycleCommands = ['unspecified', 'inspect', 'rm', 'ps', 'network-inspect',
  'network-rm', 'network-ls', 'logs', 'run', 'image-inspect', 'other', 'git', 'contract',
  'workload', 'observer-exec'];

function validateLifecycleFailure(row) {
  const fields = ['operation', 'role', 'stage', 'category', 'phase', 'exitCode', 'signal',
    'durationMs', 'command', 'nativeCode'];
  if (!row || ![fields.length, fields.length - 1].includes(Object.keys(row).length) ||
      Object.keys(row).some(key => !fields.includes(key)) ||
      fields.filter(key => key !== 'nativeCode').some(key => !Object.hasOwn(row, key)) ||
      (Object.hasOwn(row, 'nativeCode') && row.nativeCode !== 'UNRECOGNIZED' &&
        !Object.hasOwn(nativeCategories, row.nativeCode)) ||
      !lifecycleOperations.includes(row.operation) || !lifecycleRoles.includes(row.role) ||
      !['finalization', 'docker-command', 'native-command'].includes(row.stage) ||
      !lifecycleCategories.includes(row.category) || !['work', 'cleanup'].includes(row.phase) ||
      !(row.exitCode === null || (Number.isInteger(row.exitCode) && row.exitCode >= 0 && row.exitCode <= 255)) ||
      !(row.signal === null || lifecycleSignals.includes(row.signal)) ||
      !(row.durationMs === null || (Number.isSafeInteger(row.durationMs) && row.durationMs >= 0)) ||
      !lifecycleCommands.includes(row.command))
    throw new Error('Invalid safe lifecycle failure metadata');
  return row;
}

function lifecycleFailure(error, context) {
  let inner;
  try { inner = validateLifecycleFailure(error?.actionFailure); }
  catch { /* Unvalidated error metadata is never a source of report fields. */ }
  const code = error?.code;
  let category = inner?.category ?? 'unexpected';
  if (!inner) {
    if (typeof code === 'string' && Object.hasOwn(nativeCategories, code)) category = nativeCategories[code];
    else if (Number.isInteger(code) && code >= 0 && code <= 255) category = 'exit';
    else if (error?.killed === true || lifecycleSignals.includes(error?.signal)) category = 'terminated';
  }
  return validateLifecycleFailure({
    operation: lifecycleOperations.includes(context.operation) ? context.operation : 'command',
    role: ['reference-app', 'candidate-app', 'pg'].includes(inner?.role) ? inner.role :
      lifecycleRoles.includes(context.role) ? context.role : 'owned-container',
    stage: ['finalization', 'docker-command', 'native-command'].includes(context.stage) ? context.stage : 'finalization',
    category, phase: inner?.phase ?? (context.phase === 'work' ? 'work' : 'cleanup'),
    exitCode: inner?.exitCode ?? (Number.isInteger(code) && code >= 0 && code <= 255 ? code : null),
    signal: inner?.signal ?? (lifecycleSignals.includes(error?.signal) ? error.signal : null),
    durationMs: Number.isSafeInteger(context.durationMs) && context.durationMs >= 0
      ? context.durationMs : inner?.durationMs ?? null,
    command: lifecycleCommands.includes(context.command) ? context.command : inner?.command ?? 'unspecified',
    nativeCode: inner?.nativeCode ?? (typeof code === 'string' && Object.hasOwn(nativeCategories, code)
      ? code : 'UNRECOGNIZED'),
  });
}

function projectLifecycleFailures(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    try { return { ...validateLifecycleFailure(row) }; }
    catch {
      return lifecycleFailure({ code: 'LIFECYCLE_METADATA' }, { operation: 'command', role: 'owned-container',
        stage: 'finalization', phase: 'cleanup' });
    }
  });
}

module.exports = { sources, credentialKinds, reasons, validateSafeFailure, privacyFailure,
  fail, validateCanaries, credentialCanaries, assertCanariesAbsent, encodeSafeJson,
  validateLifecycleFailure, lifecycleFailure, projectLifecycleFailures };
