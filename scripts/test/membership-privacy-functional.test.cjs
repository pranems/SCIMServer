const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { verifyProvenance, readFunctionalResponse } = require('../performance/run-membership-privacy-functional.cjs');

test('legacy flush accepts the original successful empty response contract', async () => {
  assert.equal(typeof readFunctionalResponse, 'function');
  assert.equal(await readFunctionalResponse(new Response(null, { status: 204 })), undefined);
  await assert.rejects(() => readFunctionalResponse(new Response(null, { status: 401 })));
});

test('functional selection proves every known authorized row and rejects foreign, duplicate and wrong-route rows', () => {
  const expected = [{ requestId: 'owned-id', method: 'PATCH',
    url: '/scim/endpoints/owned/Groups/group', status: 200, route: 'group-patch' }];
  const row = { ...expected[0], endpointId: 'owned', requestHeaders: '{"authorization":"[REDACTED]"}' };
  assert.equal(verifyProvenance([row], expected, 'owned'), true);
  for (const rows of [[], [row, row], [{ ...row, endpointId: 'foreign' }],
    [{ ...row, requestId: 'foreign' }], [{ ...row, url: '/scim/health' }],
    [{ ...row, status: 401 }]]) {
    assert.throws(() => verifyProvenance(rows, expected, 'owned'));
  }
});

test('functional entry cannot dispatch by default and cannot enter admission', () => {
  const file = path.resolve(__dirname, '../performance/run-membership-privacy-functional.cjs');
  const child = spawnSync(process.execPath, [file], { timeout: 3000, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /FUNCTIONAL-COMPLETE/);
  const { assessBlock } = require('../performance/assess-membership.cjs');
  assert.throws(() => assessBlock(['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role, diagnosticOnly: true, family: 'membership-privacy-functional',
  })), { order: 'BAAB', sameImage: false }, {}), /Diagnostic receipts cannot enter release admission/);
});
