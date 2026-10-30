const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runChild, runDefaultChild } = require('./membership-child-fixture.cjs');
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

test('functional entry cannot dispatch by default and cannot enter admission', async () => {
  const file = path.resolve(__dirname, '../performance/run-membership-privacy-functional.cjs');
  const child = await runDefaultChild(file, 'Explicit functional opt-in required', [], 3000);
  assert.equal(child.status, 1);
  assert.equal(child.value.guardHits, 1);
  assert.doesNotMatch(child.stdout, /FUNCTIONAL-COMPLETE/);
  const { assessBlock } = require('../performance/assess-membership.cjs');
  assert.throws(() => assessBlock(['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role, diagnosticOnly: true, family: 'membership-privacy-functional',
  })), { order: 'BAAB', sameImage: false }, {}), /Diagnostic receipts cannot enter release admission/);
});

test('private provenance rejections preserve safe cause, input source and applicable row', () => {
  const expected = [{ requestId: 'owned', method: 'GET', url: '/owned', status: 404 }];
  const row = { ...expected[0], endpointId: 'owned' };
  for (const [rows, reason, rowIndex] of [
    [[], 'provenance-row-count'],
    [[{ ...row, requestId: 'foreign' }], 'provenance-owner', 0],
    [[{ ...row, endpointId: 'foreign' }], 'provenance-endpoint', 0],
    [[{ ...row, method: 'PATCH' }], 'provenance-method', 0],
    [[{ ...row, url: '/foreign' }], 'provenance-route', 0],
    [[{ ...row, status: 401 }], 'provenance-status', 0],
  ]) assert.throws(() => verifyProvenance(rows, expected, 'owned'), error => {
    assert.deepEqual(error.safeDetails, { reason, source: 'selected-rows',
      credentialKind: 'not-applicable', ...(rowIndex === undefined ? {} : { rowIndex }) });
    return true;
  });
});

test('timestamped container records stay separate from unframed Docker tool diagnostics', () => {
  const { splitDockerLogOutput, functionalPolicy } =
    require('../performance/run-membership-privacy-functional.cjs');
  assert.equal(typeof splitDockerLogOutput, 'function');
  const result = splitDockerLogOutput({
    stdout: '2026-10-23T20:00:00.123456789Z PRIVATE_APP_CANARY\n',
    stderr: '2026-10-23T20:00:01Z PRIVATE_CONTAINER_STDERR_CANARY\nDocker warning PRIVATE_TOOL_CANARY\n',
  });
  assert.match(result.container, /PRIVATE_APP_CANARY/);
  assert.match(result.container, /PRIVATE_CONTAINER_STDERR_CANARY/);
  assert.doesNotMatch(result.container, /PRIVATE_TOOL_CANARY/);
  assert.match(result.tool, /PRIVATE_TOOL_CANARY/);
  assert.doesNotMatch(result.tool, /PRIVATE_APP_CANARY/);
  assert.equal(functionalPolicy.maximumReadinessProbes, 15);
  assert.equal(functionalPolicy.maximumAuthenticatedRequests, 7);
});

test('functional report-output rejection keeps a minimal safe receipt through a bounded child', async t => {
  const file = path.resolve(__dirname, '../performance/run-membership-privacy-functional.cjs');
  const privacy = path.resolve(__dirname, '../performance/membership-privacy.cjs');
  const child = await runChild(`
    const {writeFunctionalReport}=require(${JSON.stringify(file)});
    const {encodeSafeJson}=require(${JSON.stringify(privacy)});
  `, `
    const canaries=[{kind:'scim-shared-secret',value:'PRIVATE_OUTPUT_CANARY'}];
    const report={family:'membership-privacy-functional',run:'owned',status:'FUNCTIONAL-COMPLETE',
      diagnosticOnly:true,admissionEligible:false,payload:canaries[0].value,cleanup:{verified:true},
      remainingOwned:'',remainingNetworks:'',elapsedMs:1};
    const rejected=writeFunctionalReport((name,data)=>process.stdout.write(encodeSafeJson(data,canaries)),report);
    if(!rejected)process.exitCode=2;
  `);
  t.diagnostic(JSON.stringify(child.timings));
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.doesNotMatch(child.stdout, /PRIVATE_OUTPUT_CANARY|payload|stack/);
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'INVALID');
  assert.equal(report.cleanup.verified, true);
  assert.deepEqual(report.failures[0].safeDetails, { reason: 'generated-credential-detected',
    source: 'report-output', credentialKind: 'scim-shared-secret' });
});

test('minimal privacy receipt never recycles private cleanup or inventory fields into a second rejection', async t => {
  const file = path.resolve(__dirname, '../performance/run-membership-privacy-functional.cjs');
  const privacy = path.resolve(__dirname, '../performance/membership-privacy.cjs');
  const child = await runChild(`
    const {writeFunctionalReport}=require(${JSON.stringify(file)});
    const {encodeSafeJson}=require(${JSON.stringify(privacy)});
  `, `
    const c=[{kind:'scim-shared-secret',value:'PRIVATE_CLEANUP_CANARY'}];
    const report={family:c[0].value,run:c[0].value,status:'INVALID',elapsedMs:1,
      cleanup:{verified:true,unexpected:c[0].value},remainingOwned:c[0].value,remainingNetworks:''};
    writeFunctionalReport((name,data)=>process.stdout.write(encodeSafeJson(data,c)),report);
  `);
  t.diagnostic(JSON.stringify(child.timings));
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.doesNotMatch(child.stdout, /PRIVATE_CLEANUP_CANARY|unexpected/);
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'INVALID');
  assert.equal(report.family, 'membership-privacy-functional');
  assert.deepEqual(report.cleanup, { verified: true });
  assert.equal(report.remainingOwned, 'unverified');
  assert.equal(report.failures[0].safeDetails.source, 'report-output');
  assert.equal(report.failures[0].safeDetails.credentialKind, 'scim-shared-secret');
});
