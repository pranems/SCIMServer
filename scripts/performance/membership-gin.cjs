const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { lifecycleFailure, validateSafeFailure } = require('./membership-privacy.cjs');
const root = path.resolve(__dirname, '../..');
const policy = Object.freeze({
  family: 'membership-url-gin-counterfactual', diagnosticOnly: true, admissionEligible: false,
  orders: ['BAAB', 'ABBA'], rows: 8000, batches: 160, batchRows: 50, seed: 20261024,
  wallMs: 900000, cleanupMs: 120000, nativeWorkMs: 60000, nativeCleanupMs: 30000,
  safetyRecoveryMs: 120000, readinessProbes: 30,
  postgres: 'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3',
  settings: { autovacuum: 'off', checkpoint_timeout: '1h', max_wal_size: '1GB',
    full_page_writes: 'on', synchronous_commit: 'on', fsync: 'on', jit: 'on',
    gin_pending_list_limit: '4MB', log_statement: 'none', log_min_error_statement: 'panic' },
  checkpoint: 'one explicit checkpoint after each fresh clone, before insertion; none inside full cycle',
  gin: 'canonical default fastupdate=on; no per-index tuning; explicit final pending-list drain',
});
const hash = value => crypto.createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
function optIn(args) {
  assert.ok(args.length === 2 && args[0] === '--disposable-url-gin-only',
    'Explicit disposable URL GIN opt-in and unique output directory required');
}
function uuid(label) {
  const s = hash(`${policy.seed}:${label}`);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
function dataset() {
  const endpoint = uuid('endpoint'), user = uuid('member');
  return Array.from({ length: policy.rows }, (_, i) => {
    const op = i % 4, group = uuid(`group-${Math.floor(i / 4000)}`);
    const members = op < 2 ? [{ value: user }] : [];
    const groupBody = { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: group, displayName: 'owned-membership-synthetic', members };
    return { id: uuid(`row-${i}`), endpointId: endpoint, endpointName: 'owned-membership-synthetic',
      method: op % 2 ? 'GET' : 'PATCH', url: `/scim/endpoints/${endpoint}/Groups/${group}`,
      status: 200, durationMs: 2,
      requestHeaders: JSON.stringify({ authorization: '***', 'content-type': 'application/scim+json' }),
      requestBody: op % 2 ? null : JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: op === 0 ? [{ op: 'add', path: 'members', value: [{ value: user }] }]
          : [{ op: 'remove', path: `members[value eq "${user}"]` }],
      }),
      responseHeaders: JSON.stringify({ 'content-type': 'application/scim+json' }),
      responseBody: JSON.stringify(groupBody), errorMessage: null, errorStack: null,
      identifier: 'owned-membership-synthetic', requestId: uuid(`request-${i}`),
      authOutcome: 'accept', authMethod: 'shared_secret', authReason: 'shared_secret_accepted',
      authCredentialId: null, authDecision: JSON.stringify({ outcome: 'accept', synthetic: true }),
      createdAt: new Date(Date.UTC(2026, 9, 24) + i).toISOString() };
  });
}
function verifyColumns(columns) {
  const source = fs.readFileSync(path.join(root, 'api', 'prisma', 'schema.prisma'), 'utf8');
  const model = source.match(/model RequestLog \{([\s\S]*?)\n\}/);
  assert.ok(model, 'Canonical RequestLog model required');
  const expected = [...model[1].matchAll(/^\s+(\w+)\s+(?:String|Int|DateTime)\??\s/gm)]
    .map(match => match[1]).sort();
  assert.deepEqual([...columns].sort(), expected, 'Canonical RequestLog columns must match fixture exactly');
}
function migrations() {
  const base = path.join(root, 'api', 'prisma', 'migrations');
  return fs.readdirSync(base).sort().filter(name => fs.existsSync(path.join(base, name, 'migration.sql')))
    .map(name => {
      const file = path.join(base, name, 'migration.sql'), sql = fs.readFileSync(file, 'utf8');
      assert.ok(!/\b(?:ALTER SYSTEM|pg_stat_reset)\b/i.test(sql),
        'Only replayable owned-database canonical migrations');
      if (/\bCREATE INDEX CONCURRENTLY\b/.test(sql))
        assert.equal(sql.replace(/--[^\r\n]*/g, '').split(';').filter(part => part.trim()).length,
          1, 'Concurrent canonical migration must remain one top-level statement');
      return { file, sha256: hash(sql), sql };
    });
}
function verifyCatalogs(a, b) {
  for (const key of ['columns', 'constraints', 'options', 'triggers'])
    assert.deepEqual(a[key], b[key], 'Only URL GIN may differ');
  const gin = a.indexes.filter(index => /\bgin \(url gin_trgm_ops\)/.test(index));
  assert.equal(gin.length, 1, 'Exactly one URL GIN in current canonical condition');
  assert.deepEqual(a.indexes.filter(index => index !== gin[0]), b.indexes,
    'Exactly one URL GIN may be omitted; every other index must remain');
  return true;
}
const metricFields = {
  actualRows: 'Actual Rows', loops: 'Actual Loops',
  sharedHit: 'Shared Hit Blocks', sharedRead: 'Shared Read Blocks',
  sharedDirtied: 'Shared Dirtied Blocks', sharedWritten: 'Shared Written Blocks',
  localHit: 'Local Hit Blocks', localRead: 'Local Read Blocks',
  localDirtied: 'Local Dirtied Blocks', localWritten: 'Local Written Blocks',
  tempRead: 'Temp Read Blocks', tempWritten: 'Temp Written Blocks',
  walRecords: 'WAL Records', walFpi: 'WAL FPI', walBytes: 'WAL Bytes',
};
function metrics(explain) {
  assert.ok(Array.isArray(explain) && explain.length === 1, 'Required EXPLAIN envelope');
  const row = explain[0], out = {};
  for (const [key, field] of Object.entries({ executionMs: 'Execution Time', planningMs: 'Planning Time' })) {
    assert.ok(Number.isFinite(row[field]) && row[field] >= 0, `Required EXPLAIN metric ${field}`);
    out[key] = row[field];
  }
  for (const [key, field] of Object.entries(metricFields)) {
    assert.ok(Number.isFinite(row.Plan?.[field]) && row.Plan[field] >= 0,
      `Required EXPLAIN metric ${field}`);
    out[key] = row.Plan[field];
  }
  out.planNodes = [];
  function walk(node) {
    assert.ok(typeof node['Node Type'] === 'string');
    out.planNodes.push({ type: node['Node Type'],
      ...(node['Index Name'] ? { indexName: node['Index Name'] } : {}) });
    for (const child of node.Plans ?? []) walk(child);
  }
  walk(row.Plan);
  return out;
}
const sqlStates = ['23505', '23502', '23503', '23514', '42601', '42P01', '42703', '42704',
  '42883', '42501', '57014', '53300', '53200', '53100', '40P01', '22003', '08006', '57P01'];
function failure(error, stage) {
  const stages = ['preflight', 'readiness', 'schema', 'catalog', 'insert', 'drain', 'read', 'cleanup'];
  let details;
  if (error?.safeDetails) {
    try { details = { ...validateSafeFailure(error.safeDetails) }; }
    catch {
      details = { reason: 'privacy-metadata-invalid', source: 'privacy-inputs', credentialKind: 'not-applicable' };
    }
  }
  return { stage: stages.includes(stage) ? stage : 'preflight',
    sqlState: sqlStates.includes(error?.code) ? error.code : null,
    ...(details ? { privacy: details } : {}),
    action: lifecycleFailure(error, { operation: 'command', role: 'pg',
      stage: 'native-command', phase: stage === 'cleanup' ? 'cleanup' : 'work', command: 'other' }) };
}
function verifyFrozen(directory, hashes) {
  for (const [file, expected] of Object.entries(hashes)) {
    assert.equal(hash(fs.readFileSync(path.join(root, file))), expected, 'Frozen input disk/copy identity');
    assert.equal(hash(fs.readFileSync(path.join(directory, 'frozen-inputs', file))), expected,
      'Frozen input disk/copy identity');
  }
}
async function catalog(client, schema) {
  assert.match(schema, /^(?:public|trial_[0-7])$/);
  const table = `"${schema}"."RequestLog"`;
  const columns = (await client.query(`SELECT a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required,
    a.attidentity AS identity, a.attgenerated AS generated,
    a.attstorage AS storage, a.attcompression AS compression, a.attstattarget AS statistics,
    pg_get_expr(d.adbin,d.adrelid) AS default, c.collname AS collation
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_collation c ON c.oid=a.attcollation
    WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table])).rows;
  const constraints = (await client.query(`SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY 1`, [table])).rows.map(r => r.definition);
  const indexes = (await client.query(`SELECT pg_get_indexdef(i.indexrelid) AS definition,
    c.reloptions AS options, i.indisvalid, i.indisready, i.indislive
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid=$1::regclass`, [table])).rows.map(r => {
    assert.ok(r.indisvalid && r.indisready && r.indislive, 'Every preserved index must be valid/ready/live');
    return r.definition.replace(/^CREATE (UNIQUE )?INDEX .+? ON .+? USING /, (_, unique) =>
      `${unique ? 'unique ' : ''}`) + (r.options ? ` OPTIONS ${JSON.stringify(r.options.sort())}` : '');
  }).sort();
  const options = (await client.query('SELECT reloptions FROM pg_class WHERE oid=$1::regclass',
    [table])).rows[0].reloptions ?? [];
  const triggers = (await client.query(`SELECT pg_get_triggerdef(oid) AS definition
    FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal ORDER BY 1`, [table])).rows;
  return { columns, constraints, indexes, options: options.sort(), triggers };
}
module.exports = { policy, hash, optIn, dataset, verifyColumns, migrations, verifyCatalogs, metrics,
  failure, catalog, verifyFrozen };
