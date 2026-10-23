const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { statementDelta, validatePgSnapshot, snapshotSql, summarizeStatements } =
  require('../performance/membership-statements.cjs');
const columns = ['shared_blks_hit', 'temp_blks_written', 'wal_bytes'];
function entry(overrides = {}) {
  return { queryId: '-9223372036854775807', fingerprint: 'a'.repeat(64),
    topLevel: true, label: 'references-resource-member', operation: 'select',
    calls: '2', totalExecMs: 10, rows: '4',
    counters: { shared_blks_hit: '5', temp_blks_written: '0', wal_bytes: '0' },
    ...overrides };
}
function snapshot(overrides = {}) {
  return { databaseOid: '10', userOid: '11', postmasterStart: '2026-10-23T00:00:00Z',
    statsReset: '2026-10-23T00:00:00Z', dealloc: '0',
    capturedUtc: '2026-10-23T00:01:00Z', entries: [entry()],
    observer: { calls: '1', totalExecMs: 2 }, ...overrides };
}

test('window means divide execution deltas by call deltas, never cumulative mean differences', () => {
  const result = statementDelta(snapshot(), snapshot({
    entries: [entry({ calls: '4', totalExecMs: 20, rows: '8' })],
  }), columns);
  assert.equal(result.statements[0].calls, 2);
  assert.equal(result.statements[0].execMs, 10);
  assert.equal(result.statements[0].meanExecMs, 5);
  assert.equal(result.statements[0].queryId, '-9223372036854775807');
});

test('new entries require proven no-reset/no-eviction; missing and decreasing entries fail', () => {
  const fresh = statementDelta(snapshot({ entries: [] }), snapshot(), columns);
  assert.equal(fresh.statements[0].newEntry, true);
  for (const bad of [
    { entries: [] }, { dealloc: '1' }, { databaseOid: '12' }, { userOid: '12' },
    { statsReset: '2026-10-23T00:00:01Z' },
    { postmasterStart: '2026-10-23T00:00:01Z' },
    { entries: [entry({ calls: '1' })] },
    { entries: [entry({ totalExecMs: 9 })] },
  ]) assert.throws(() => statementDelta(snapshot(), snapshot(bad), columns));
  assert.throws(() => statementDelta(snapshot({ dealloc: '1' }), snapshot({ dealloc: '1' }), columns));
});

test('numeric query IDs, missing counters, duplicate identities and private canaries are rejected', () => {
  for (const bad of [
    entry({ queryId: 123 }), entry({ calls: '' }), entry({ totalExecMs: NaN }),
    entry({ query: 'PRIVATE_CANARY' }), entry({ label: 'PRIVATE_CANARY' }),
    entry({ counters: { shared_blks_hit: '1' } }),
  ]) assert.throws(() => validatePgSnapshot(snapshot({ entries: [bad] }), columns));
  assert.throws(() => validatePgSnapshot(snapshot({ payload: 'PRIVATE_CANARY' }), columns));
  assert.throws(() => validatePgSnapshot(snapshot({ entries: [entry(), entry()] }), columns));
});

test('SQL hashes normalized text inside PostgreSQL and exports only static allowlisted labels', () => {
  const sql = snapshotSql(columns);
  assert.match(sql, /sha256\(convert_to/);
  assert.match(sql, /queryid::text/);
  assert.match(sql, /regexp_replace/);
  assert.ok(!sql.includes("'query',"));
  assert.ok(!sql.includes("'params',"));
  assert.throws(() => snapshotSql(['query; PRIVATE_CANARY']));
});

test('fingerprint summaries do not assume opaque query IDs align across roles', () => {
  const rows = [
    { fingerprint: 'a'.repeat(64), queryId: '1', calls: 2, execMs: 10,
      rows: 4, label: 'unresolved', operation: 'select', counters: {} },
    { fingerprint: 'a'.repeat(64), queryId: '2', calls: 3, execMs: 30,
      rows: 6, label: 'unresolved', operation: 'select', counters: {} },
  ];
  const result = summarizeStatements(rows);
  assert.equal(result[0].calls, 5);
  assert.equal(result[0].execMs, 40);
  assert.equal(result[0].meanExecMs, 8);
  assert.deepEqual(result[0].queryIds, ['1', '2']);
  assert.equal(result[0].identityMix, true);
});

test('new family is rejected by admission and cannot dispatch without explicit opt-in', () => {
  const { assessBlock } = require('../performance/assess-membership.cjs');
  assert.throws(() => assessBlock(['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role, family: 'membership-statement-diagnostic', diagnosticOnly: true,
  })), { order: 'BAAB', sameImage: false }, {}), /Diagnostic receipts cannot enter release admission/);
  const child = spawnSync(process.execPath,
    [path.resolve(__dirname, '../performance/run-membership-statements.cjs')], {
      timeout: 2000, encoding: 'utf8',
    });
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /checked requests|STATEMENT-DIAGNOSTIC-COMPLETE/);
});

test('new comparison freezes eight reused visits and the two exact authorized images', () => {
  const { blocks, roles } = require('../performance/run-membership-statements.cjs');
  assert.deepEqual(blocks.map(block => block.order), ['BAAB', 'ABBA']);
  assert.equal(blocks.flatMap(block => block.visits).length, 8);
  assert.equal(blocks.flatMap(block => block.visits).length * 4 * 1000, 32000);
  assert.equal(roles.A.version, '0.55.20');
  assert.equal(roles.B.version, '0.55.60');
  assert.match(roles.A.image, /8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a$/);
  assert.match(roles.B.image, /316a645f021b5c9b833c295d94248e7df00ee37aa13d6d5614e55f9f04c83a4b$/);
});

test('safe summaries retain nesting mix even when the opaque query ID is unchanged', () => {
  const base = { fingerprint: 'a'.repeat(64), queryId: '1', label: 'unresolved',
    operation: 'select', calls: 1, rows: 1, execMs: 2, counters: {} };
  const [group] = summarizeStatements([{ ...base, topLevel: true }, { ...base, topLevel: false }]);
  assert.deepEqual(group.topLevels, [false, true]);
  assert.equal(group.identityMix, true);
});

test('legacy privacy retains strict redaction and exports a safe failure category, never header values', () => {
  const { validateLegacyPrivacy } = require('../performance/membership-statements.cjs');
  assert.equal(typeof validateLegacyPrivacy, 'function');
  const rows = Array.from({ length: 200 }, () => ({
    requestHeaders: '{"authorization":"[REDACTED]"}',
  }));
  assert.equal(validateLegacyPrivacy(rows, '', ['PRIVATE_CANARY']).validatedRows, 200);
  assert.throws(() => validateLegacyPrivacy(rows, '', []), /Required generated-credential canaries/);
  assert.throws(() => validateLegacyPrivacy(rows, null, ['PRIVATE_CANARY']), /Required private console sample/);
  for (const [headers, reason, present] of [
    ['{}', 'authorization-missing', false],
    ['{"authorization":"other-mask"}', 'authorization-mask-mismatch', true],
  ]) {
    rows[0].requestHeaders = headers;
    assert.throws(() => validateLegacyPrivacy(rows, '', ['PRIVATE_CANARY']), error => {
      assert.equal(error.code, 'DIAGNOSTIC_PRIVACY');
      assert.deepEqual(error.safeDetails, { reason, rowIndex: 0, authorizationPresent: present });
      assert.ok(!JSON.stringify(error).includes('other-mask'));
      return true;
    });
  }
  rows[0].requestHeaders = '{"authorization":"PRIVATE_CANARY"}';
  assert.throws(() => validateLegacyPrivacy(rows, '', ['PRIVATE_CANARY']), error => {
    assert.equal(error.safeDetails.reason, 'generated-credential-detected');
    assert.ok(!JSON.stringify(error).includes('PRIVATE_CANARY'));
    assert.ok(!error.message.includes('PRIVATE_CANARY'));
    return true;
  });
});

test('small functional privacy sample remains explicitly counted and strictly masked', () => {
  const { validateLegacyPrivacy, classifyLegacyHeaders } = require('../performance/membership-statements.cjs');
  const rows = Array.from({ length: 4 }, () => ({
    requestHeaders: '{"authorization":"[REDACTED]"}',
  }));
  assert.equal(validateLegacyPrivacy(rows, '', ['PRIVATE_CANARY'], 4).validatedRows, 4);
  assert.throws(() => validateLegacyPrivacy(rows, '', ['PRIVATE_CANARY']), /Original legacy private log sample/);
  assert.throws(() => validateLegacyPrivacy(rows, '', ['PRIVATE_CANARY'], 0), /Required private row count/);
  for (const [raw, reason] of [
    ['{}', 'authorization-missing'],
    ['"{\\"authorization\\":\\"PRIVATE_CANARY\\"}"', 'headers-not-object'],
    ['{"authorization":"PRIVATE_CANARY"}', 'authorization-mask-mismatch'],
    ['not-json-PRIVATE_CANARY', 'headers-not-json'],
  ]) {
    const result = classifyLegacyHeaders(raw);
    assert.equal(result.reason, reason);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
  }
  rows[0].requestHeaders = '{}';
  assert.throws(() => validateLegacyPrivacy(rows, '', ['PRIVATE_CANARY'], 4),
    error => error.safeDetails.reason === 'authorization-missing');
});

test('generated-credential rejection retains only static row-versus-console provenance', () => {
  const { validateLegacyPrivacy } = require('../performance/membership-statements.cjs');
  for (const [raw, consoleLog, locations] of [
    ['{"authorization":"PRIVATE_CANARY"}', '', ['rows']],
    ['{"authorization":"[REDACTED]"}', 'PRIVATE_CANARY', ['console']],
    ['{"authorization":"PRIVATE_CANARY"}', 'PRIVATE_CANARY', ['rows', 'console']],
  ]) {
    assert.throws(() => validateLegacyPrivacy([{ requestHeaders: raw }], consoleLog, ['PRIVATE_CANARY'], 1),
      error => {
        assert.deepEqual(error.safeDetails, { reason: 'generated-credential-detected', locations });
        assert.ok(!JSON.stringify(error).includes('PRIVATE_CANARY'));
        return true;
      });
  }
});
