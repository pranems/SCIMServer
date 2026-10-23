const assert = require('node:assert/strict');
const { requiredUnsigned } = require('./membership-history.cjs');
const counterColumns = ['shared_blks_hit', 'shared_blks_read', 'shared_blks_dirtied',
  'shared_blks_written', 'local_blks_hit', 'local_blks_read', 'local_blks_dirtied',
  'local_blks_written', 'temp_blks_read', 'temp_blks_written', 'wal_records',
  'wal_fpi', 'wal_bytes'];
const labels = ['references-resource-member', 'references-scim-resource',
  'references-request-log', 'references-endpoint', 'mixed', 'unresolved'];
const operations = ['select', 'insert', 'update', 'delete', 'begin', 'commit', 'rollback', 'unresolved'];
const keys = value => Object.keys(value).sort();
const identity = row => JSON.stringify([row.queryId, row.topLevel, row.fingerprint]);

function checkColumns(columns) {
  assert.ok(Array.isArray(columns) && columns.length > 0);
  assert.equal(new Set(columns).size, columns.length);
  for (const column of columns) assert.ok(counterColumns.includes(column));
}

function validatePgSnapshot(value, columns) {
  checkColumns(columns);
  assert.deepEqual(keys(value), ['capturedUtc', 'databaseOid', 'dealloc', 'entries',
    'observer', 'postmasterStart', 'statsReset', 'userOid']);
  for (const field of ['capturedUtc', 'postmasterStart', 'statsReset'])
    assert.ok(Number.isFinite(Date.parse(value[field])), `Required PG ${field}`);
  for (const field of ['databaseOid', 'userOid', 'dealloc']) requiredUnsigned(value[field]);
  assert.deepEqual(keys(value.observer), ['calls', 'totalExecMs']);
  requiredUnsigned(value.observer.calls);
  assert.ok(Number.isFinite(value.observer.totalExecMs) && value.observer.totalExecMs >= 0);
  assert.ok(Array.isArray(value.entries) && value.entries.length <= 5000);
  const seen = new Set();
  for (const row of value.entries) {
    assert.deepEqual(keys(row), ['calls', 'counters', 'fingerprint', 'label',
      'operation', 'queryId', 'rows', 'topLevel', 'totalExecMs']);
    assert.equal(typeof row.queryId, 'string', 'Opaque PG query ID must stay a string');
    assert.match(row.queryId, /^-?\d+$/);
    assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(typeof row.topLevel, 'boolean');
    assert.ok(labels.includes(row.label));
    assert.ok(operations.includes(row.operation));
    requiredUnsigned(row.calls);
    requiredUnsigned(row.rows);
    assert.ok(Number.isFinite(row.totalExecMs) && row.totalExecMs >= 0);
    assert.deepEqual(keys(row.counters), [...columns].sort());
    for (const column of columns) requiredUnsigned(row.counters[column]);
    assert.ok(!seen.has(identity(row)), 'Duplicate PG statement identity');
    seen.add(identity(row));
  }
  return value;
}

function statementDelta(before, after, columns) {
  validatePgSnapshot(before, columns);
  validatePgSnapshot(after, columns);
  for (const field of ['databaseOid', 'userOid', 'postmasterStart', 'statsReset'])
    assert.equal(after[field], before[field], `PG ${field} changed`);
  assert.equal(before.dealloc, '0', 'Cannot prove no prior entry eviction');
  assert.equal(after.dealloc, '0', 'Statement eviction invalidates zero baselines');
  assert.ok(Date.parse(after.capturedUtc) >= Date.parse(before.capturedUtc));
  const earlier = new Map(before.entries.map(row => [identity(row), row]));
  const statements = [];
  for (const row of after.entries) {
    const prior = earlier.get(identity(row));
    const subtract = field => {
      const value = requiredUnsigned(row[field]) - (prior ? requiredUnsigned(prior[field]) : 0);
      assert.ok(value >= 0, `PG ${field} decreased`);
      return value;
    };
    const calls = subtract('calls');
    const rows = subtract('rows');
    const execMs = row.totalExecMs - (prior ? prior.totalExecMs : 0);
    assert.ok(execMs >= 0, 'PG execution counter decreased');
    assert.ok(calls > 0 || (execMs === 0 && rows === 0), 'Execution without completed calls');
    const counters = {};
    for (const column of columns) {
      counters[column] = requiredUnsigned(row.counters[column]) -
        (prior ? requiredUnsigned(prior.counters[column]) : 0);
      assert.ok(counters[column] >= 0, `PG ${column} decreased`);
    }
    if (prior) {
      assert.equal(row.label, prior.label);
      assert.equal(row.operation, prior.operation);
    }
    statements.push({ queryId: row.queryId, fingerprint: row.fingerprint, topLevel: row.topLevel,
      label: row.label, operation: row.operation, newEntry: !prior, calls, rows,
      execMs, meanExecMs: calls ? execMs / calls : null, counters });
    earlier.delete(identity(row));
  }
  assert.equal(earlier.size, 0, 'Unexpected missing PG statement entry');
  const observerCalls = requiredUnsigned(after.observer.calls) - requiredUnsigned(before.observer.calls);
  const observerExecMs = after.observer.totalExecMs - before.observer.totalExecMs;
  assert.ok(observerCalls >= 0 && observerExecMs >= 0, 'Observer counters decreased');
  return { statements, observer: { calls: observerCalls, execMs: observerExecMs },
    totals: { calls: statements.reduce((n, row) => n + row.calls, 0),
      execMs: statements.reduce((n, row) => n + row.execMs, 0),
      rows: statements.reduce((n, row) => n + row.rows, 0) },
    diagnosticOnly: true, executionTimeIsCpuOrNetwork: false };
}

function summarizeStatements(statements) {
  const grouped = new Map();
  for (const row of statements) {
    const group = grouped.get(row.fingerprint) || { fingerprint: row.fingerprint,
      queryIds: [], topLevels: [], label: row.label, operation: row.operation,
      calls: 0, rows: 0, execMs: 0, counters: {} };
    if (!group.queryIds.includes(row.queryId)) group.queryIds.push(row.queryId);
    if (!group.topLevels.includes(row.topLevel)) group.topLevels.push(row.topLevel);
    if (group.label !== row.label) group.label = 'mixed';
    if (group.operation !== row.operation) group.operation = 'unresolved';
    group.calls += row.calls;
    group.rows += row.rows;
    group.execMs += row.execMs;
    for (const [key, value] of Object.entries(row.counters))
      group.counters[key] = (group.counters[key] || 0) + value;
    grouped.set(row.fingerprint, group);
  }
  return [...grouped.values()].map(group => ({ ...group,
    queryIds: group.queryIds.sort(), topLevels: group.topLevels.sort(),
    identityMix: group.queryIds.length > 1 || group.topLevels.length > 1,
    meanExecMs: group.calls ? group.execMs / group.calls : null }))
    .sort((a, b) => b.execMs - a.execMs);
}

function classifyLegacyHeaders(raw) {
  let headers;
  try { headers = JSON.parse(raw); }
  catch { return { reason: 'headers-not-json' }; }
  if (!headers || typeof headers !== 'object' || Array.isArray(headers))
    return { reason: 'headers-not-object' };
  const authorizationPresent = Object.hasOwn(headers, 'authorization');
  if (!authorizationPresent) return { reason: 'authorization-missing', authorizationPresent };
  return { reason: headers.authorization === '[REDACTED]' ? 'authorization-redacted'
    : 'authorization-mask-mismatch', authorizationPresent };
}

function validateLegacyPrivacy(rows, consoleLog, secrets, requiredRows = 200) {
  assert.ok(Array.isArray(secrets) && secrets.length > 0, 'Required generated-credential canaries');
  assert.equal(typeof consoleLog, 'string', 'Required private console sample');
  const fail = safeDetails => {
    const error = new Error('Legacy privacy validation failed; private values withheld');
    error.code = 'DIAGNOSTIC_PRIVACY';
    error.safeDetails = safeDetails;
    throw error;
  };
  assert.ok(Number.isSafeInteger(requiredRows) && requiredRows > 0 && requiredRows <= 200,
    'Required private row count');
  assert.ok(Array.isArray(rows) && rows.length === requiredRows, 'Original legacy private log sample');
  const encoded = JSON.stringify(rows);
  for (const secret of secrets) {
    assert.ok(typeof secret === 'string' && secret.length > 0);
    const locations = [];
    if (encoded.includes(secret)) locations.push('rows');
    if (consoleLog.includes(secret)) locations.push('console');
    if (locations.length) fail({ reason: 'generated-credential-detected', locations });
  }
  for (const [rowIndex, row] of rows.entries()) {
    const result = classifyLegacyHeaders(row.requestHeaders);
    if (result.reason !== 'authorization-redacted')
      fail({ reason: result.reason, rowIndex,
        ...(result.authorizationPresent === undefined ? {} : { authorizationPresent: result.authorizationPresent }) });
  }
  return { diagnosticOnly: true, complete: true, validatedRows: rows.length,
    contract: 'Legacy redaction only; no current-only error categorization assertion',
    rawLogsExported: false };
}

function snapshotSql(columns) {
  checkColumns(columns);
  const counters = columns.map(name => `'${name}',${name}::text`).join(',');
  return `
WITH target AS MATERIALIZED (
  SELECT $1::text AS database_oid,$2::text AS user_oid
), workload AS MATERIALIZED (
  SELECT *, regexp_replace(btrim(query),'[[:space:]]+',' ','g') AS normalized
  FROM public.pg_stat_statements
  WHERE dbid=(SELECT database_oid::oid FROM target)
    AND userid=(SELECT user_oid::oid FROM target)
), observer AS (
  SELECT coalesce(sum(calls),0)::text AS calls,
         coalesce(sum(total_exec_time),0)::float8 AS execution
  FROM public.pg_stat_statements
  WHERE userid=(SELECT oid FROM pg_roles WHERE rolname=current_user)
)
SELECT jsonb_build_object(
  'databaseOid',(SELECT database_oid FROM target),'userOid',(SELECT user_oid FROM target),
  'postmasterStart',pg_postmaster_start_time(),
  'statsReset',info.stats_reset,'dealloc',info.dealloc::text,
  'capturedUtc',clock_timestamp(),
  'observer',jsonb_build_object('calls',observer.calls,'totalExecMs',observer.execution),
  'entries',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'queryId',queryid::text,'topLevel',toplevel,
      'fingerprint',encode(sha256(convert_to(normalized,'UTF8')),'hex'),
      'operation',CASE WHEN lower(split_part(normalized,' ',1)) IN
        ('select','insert','update','delete','begin','commit','rollback')
        THEN lower(split_part(normalized,' ',1)) ELSE 'unresolved' END,
      'label',CASE
        WHEN position('"ResourceMember"' in normalized)>0 AND
          position('"ScimResource"' in normalized)>0 THEN 'mixed'
        WHEN position('"ResourceMember"' in normalized)>0 THEN 'references-resource-member'
        WHEN position('"ScimResource"' in normalized)>0 THEN 'references-scim-resource'
        WHEN position('"RequestLog"' in normalized)>0 THEN 'references-request-log'
        WHEN position('"Endpoint"' in normalized)>0 THEN 'references-endpoint'
        ELSE 'unresolved' END,
      'calls',calls::text,'totalExecMs',total_exec_time,'rows',rows::text,
      'counters',jsonb_build_object(${counters})
    )) FROM workload
  ),'[]'::jsonb)
) AS snapshot
FROM public.pg_stat_statements_info info CROSS JOIN observer`;
}

module.exports = { counterColumns, validatePgSnapshot, statementDelta, snapshotSql, summarizeStatements,
  validateLegacyPrivacy, classifyLegacyHeaders };
