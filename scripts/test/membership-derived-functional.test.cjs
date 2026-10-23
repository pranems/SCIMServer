const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, fork, execFileSync } = require('node:child_process');
const { runDefaultChild } = require('./membership-child-fixture.cjs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const proofRoot = path.join(root, 'test-results/derived-reference-20261023');
function implementation() {
  let tool;
  assert.doesNotThrow(() => { tool = require('../performance/membership-derived-functional.cjs'); },
    'Derived immutable proof and functional guards must exist');
  return tool;
}
function inputs() {
  return Object.fromEntries(Object.entries({
    manifest: 'offline-build/manifest.json', receipt: 'offline-build/receipt.json',
    source: 'source/proof.json',
  }).map(([key, file]) => [key, fs.readFileSync(path.join(proofRoot, file))]));
}
test('exact retained build/source proof binds only the immutable derived image',
  { skip: !fs.existsSync(path.join(proofRoot, 'offline-build/receipt.json')) }, () => {
  const tool = implementation();
  const proof = tool.validateBuildProof(inputs());
  assert.equal(proof.imageId, 'sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4');
  const manifest = JSON.parse(inputs().manifest);
  const image = { id: proof.imageId, os: 'linux', architecture: 'amd64', labels: manifest.labels };
  assert.equal(tool.verifyDerivedImage(image, proof), true);
  for (const changed of [{ ...image, id: manifest.parentImage }, { ...image, id: 'mutable-tag' },
    { ...image, labels: {} }, { ...image, os: 'windows' },
    { ...image, labels: { ...image.labels, 'io.scimserver.reference.admission-eligible': 'true' } }])
    assert.throws(() => tool.verifyDerivedImage(changed, proof));
  for (const key of ['manifest', 'receipt', 'source']) {
    const absent = inputs(); delete absent[key];
    assert.throws(() => tool.validateBuildProof(absent));
    const drift = inputs(); drift[key] = Buffer.concat([drift[key], Buffer.from('\n')]);
    assert.throws(() => tool.validateBuildProof(drift));
  }
});
test('derived privacy requires all private sources and exact masks, preserving safe source/kind failures', () => {
  const tool = implementation();
  const rows = Array.from({ length: 4 }, () => ({ requestHeaders: '{"authorization":"[REDACTED]"}' }));
  const canaries = [{ kind: 'scim-shared-secret', value: 'PRIVATE_DERIVED_SENTINEL' }];
  const consoles = { 'app-console': 'startup', 'pg-console': 'ready', 'tool-console': 'owned' };
  assert.equal(tool.validateFunctionalPrivacy(rows, consoles, canaries).validatedRows, 4);
  for (const source of Object.keys(consoles)) {
    for (const text of [undefined, '', '   ', canaries[0].value]) {
      assert.throws(() => tool.validateFunctionalPrivacy(rows, { ...consoles, [source]: text }, canaries), error => {
        assert.equal(error.code, 'DIAGNOSTIC_PRIVACY');
        assert.equal(error.safeDetails.source, source);
        assert.equal(error.safeDetails.credentialKind, text === canaries[0].value ? 'scim-shared-secret' : 'not-applicable');
        assert.doesNotMatch(JSON.stringify(error.safeDetails), /PRIVATE_DERIVED_SENTINEL/);
        return true;
      });
    }
  }
  assert.throws(() => tool.validateFunctionalPrivacy(rows.map(() => ({ requestHeaders: '{}' })), consoles, canaries),
    error => error.safeDetails.reason === 'authorization-missing');
  assert.throws(() => tool.validateFunctionalPrivacy(rows, consoles, []));
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => tool.validateFunctionalPrivacy([cyclic, ...rows.slice(1)], consoles, canaries),
    error => error.safeDetails.reason === 'private-source-serialization' &&
      error.safeDetails.source === 'selected-rows' && error.safeDetails.rowIndex === 0);
  assert.throws(() => tool.validateFunctionalPrivacy([undefined, ...rows.slice(1)], consoles, canaries),
    error => error.safeDetails.source === 'selected-rows' && error.safeDetails.rowIndex === 0);
  assert.throws(() => tool.validateFunctionalPrivacy(rows, null, canaries),
    error => error.code === 'DIAGNOSTIC_PRIVACY' && error.safeDetails.source === 'privacy-inputs');
});
test('real default child and derived family cannot dispatch or enter admission', async () => {
  const file = path.join(root, 'scripts/performance/run-membership-privacy-functional.cjs');
  for (const args of [[], ['--unknown'], ['--derived-reference-functional-only']]) {
    const child = await runDefaultChild(file, args[0] === '--derived-reference-functional-only'
      ? null : 'Explicit functional opt-in required', args, 3000);
    assert.equal(child.status, 1);
    assert.equal(child.value.guardHits, 1);
    assert.doesNotMatch(child.stdout, /FUNCTIONAL-COMPLETE|QUALIFIED/);
  }
  const { assessBlock } = require('../performance/assess-membership.cjs');
  assert.throws(() => assessBlock(['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role, family: 'membership-derived-reference-functional', derivedReference: true, diagnosticOnly: true,
    admissionEligible: false,
  })), { order: 'BAAB', sameImage: false }, {}), /Diagnostic receipts cannot enter release admission/);
});
test('prospective mask fixture must request and independently verify both false policies before windows', () => {
  const tool = implementation();
  assert.deepEqual(tool.maskPolicyPatch(), { profile: { settings: { PersistRequestSecrets: false } } });
  assert.equal(tool.verifyMaskPolicy('false', false), true);
  for (const pair of [[undefined, undefined], ['true', false], ['false', undefined], ['false', true],
    ['false', 'false']]) assert.throws(() => tool.verifyMaskPolicy(...pair));
  const runner = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-statements.cjs'), 'utf8');
  assert.match(runner, /PERSIST_REQUEST_SECRETS=false/);
  assert.match(runner, /SCIM_BENCH_REQUIRE_MASKS: '1'/);
  assert.match(runner, /verifyMaskPolicy/);
  assert.match(runner, /fixture-policy/);
  const old = execFileSync('git', ['show', 'a7e79e82:scripts/performance/run-membership-statements.cjs'],
    { cwd: root, encoding: 'utf8' });
  assert.throws(() => assert.match(old, /PERSIST_REQUEST_SECRETS=false/),
    'Negative control must reject the old omitted server policy');
  assert.throws(() => assert.match(old, /verifyMaskPolicy/),
    'Negative control must reject the old omitted effective-policy verification');
});
test('derived qualification cannot pass on verified removal with failed final capture', () => {
  const tool = implementation();
  assert.equal(typeof tool.completeOwnedCleanup, 'function');
  const cleanup = { verified: true, rows: [0, 1].map(() => ({ capture: true, removed: true, verified: true })) };
  assert.equal(tool.completeOwnedCleanup(cleanup), true);
  for (const key of ['capture', 'removed', 'verified']) {
    const changed = structuredClone(cleanup); changed.rows[0][key] = false;
    assert.equal(tool.completeOwnedCleanup(changed), false);
  }
  assert.equal(tool.completeOwnedCleanup({ verified: true, rows: [] }), false);
  assert.equal(tool.completeOwnedCleanup({ verified: true, rows: [] }, 0), true);
});
test('only DERIVED app metadata requires labels; PG optional labels must not be queried', () => {
  const tool = implementation();
  assert.equal(typeof tool.imageMetadataFormat, 'function');
  assert.match(tool.imageMetadataFormat('app', true), /\.Config\.Labels/);
  for (const pair of [['pg', true], ['pg', false], ['app', false]])
    assert.doesNotMatch(tool.imageMetadataFormat(...pair), /\.Config\.Labels/);
  assert.throws(() => tool.imageMetadataFormat('unknown', true));
  const source = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-privacy-functional.cjs'), 'utf8');
  assert.ok(source.indexOf("write('intent.json'") > 0);
  assert.ok(source.indexOf("write('intent.json'") < source.indexOf('const images = {}'),
    'Intent must be sealed even when metadata preflight fails');
});
function runFunctionalPreflightChild(mode) {
  const directory = path.join(root, 'test-results/derived-functional-unit', randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, 'output');
  const eventsFile = path.join(directory, 'events.jsonl');
  const preload = path.join(directory, 'preload.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const path = require('node:path');
    const cp = require('node:child_process');
    const {promisify} = require('node:util');
    const originalWrite = fs.writeFileSync;
    const execute = promisify(cp.execFile);
    const output = ${JSON.stringify(output)};
    const mode = ${JSON.stringify(mode)};
    const record = value => fs.appendFileSync(${JSON.stringify(eventsFile)}, JSON.stringify(value)+'\\n');
    fs.writeFileSync = (file, bytes, options) => {
      const result = originalWrite(file, bytes, options);
      if (path.resolve(file) === path.join(output, 'intent.json'))
        record({kind:'intent',exclusive:options.flag==='wx'});
      if (path.resolve(file) === path.join(output, 'manifest.json')) {
        record({kind:'manifest',exclusive:options.flag==='wx'});
        if (mode === 'manifest-drift') {
          const changed = JSON.parse(bytes);
          changed.policy.maximumAuthenticatedRequests = 8;
          originalWrite(file, JSON.stringify(changed));
        } else if (mode === 'frozen-drift')
          originalWrite(path.join(output,'frozen-inputs','membership-protocol.json'),'{}');
      }
      return result;
    };
    const intercepted = async (file,args,options) => {
      if (file === 'git' && args[0] === 'status') return {stdout:'',stderr:''};
      if (file !== 'docker') return execute(file,args,options);
      const command = args.slice(2);
      record({kind:'docker',command:command.slice(0,2)});
      if (command[0] === 'image') {
        if (mode === 'metadata-failure')
          throw Object.assign(new Error('withheld fixture metadata'), {
            code:1,stdout:'',stderr:'PRIVATE_FAKE_METADATA_OUTPUT'});
        const tool = require(${JSON.stringify(path.join(root, 'scripts/performance/membership-derived-functional.cjs'))});
        const proof = tool.loadBuildProof(${JSON.stringify(root)});
        const isApp = command.at(-1) === proof.imageId;
        return {stdout:JSON.stringify({id:isApp?proof.imageId:command.at(-1).split('@')[1],
          digests:[command.at(-1)],os:'linux',architecture:'amd64',
          ...(isApp?{labels:proof.labels}:{})}),stderr:''};
      }
      if (command[0] === 'ps' || (command[0] === 'network' && command[1] === 'ls'))
        return {stdout:'',stderr:''};
      throw Object.assign(new Error('No real Docker dispatch allowed'),{code:1,stdout:'',stderr:''});
    };
    cp.execFile = () => { throw new Error('Unexpected direct child process dispatch'); };
    Object.defineProperty(cp.execFile,promisify.custom,{value:intercepted});
    require('node:assert/strict').equal(promisify(cp.execFile),intercepted);
  `, { flag: 'wx' });
  const child = spawnSync(process.execPath, ['--require', preload,
    path.join(root, 'scripts/performance/run-membership-privacy-functional.cjs'),
    '--derived-reference-functional-only', output], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 16384,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout + child.stderr, /PRIVATE_FAKE_METADATA_OUTPUT/);
  const events = fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const reportText = fs.readFileSync(path.join(output, 'report.json'), 'utf8');
  assert.doesNotMatch(reportText, /PRIVATE_FAKE_METADATA_OUTPUT|stack|stderr/);
  const report = JSON.parse(reportText);
  assert.equal(report.status, 'INVALID');
  assert.equal(report.requests.length, 0);
  assert.equal(report.readiness.length, 0);
  assert.deepEqual(report.cleanup, { rows: [], verified: true });
  assert.equal(report.remainingOwned, '');
  assert.equal(report.remainingNetworks, '');
  assert.equal(report.artifactPrivacyQualified, false);
  return { output, events, report };
}
test('real bounded functional child seals exclusive intent before failing fake metadata',
  { skip: !fs.existsSync(path.join(proofRoot, 'offline-build/receipt.json')) }, () => {
  const { output, events, report } = runFunctionalPreflightChild('metadata-failure');
  assert.deepEqual(events[0], { kind: 'intent', exclusive: true });
  assert.deepEqual(events[1], { kind: 'docker', command: ['image', 'inspect'] });
  assert.equal(events.some(event => event.kind === 'manifest'), false);
  assert.equal(events.some(event => /run|create|start/.test(event.command?.join(' ') ?? '')), false);
  const intent = JSON.parse(fs.readFileSync(path.join(output, 'intent.json')));
  const tool = implementation();
  assert.equal(intent.requestedImages.app, tool.imageId);
  assert.equal(intent.requestedImages.pg, require('../performance/membership-protocol.json').postgres);
  assert.match(intent.sourceTip, /^[a-f0-9]{40}$/);
  assert.match(intent.hypothesis, /sole approved logging backport/);
  assert.deepEqual([intent.policy.maximumAuthenticatedRequests, intent.policy.maximumReadinessProbes,
    intent.policy.wallCapMs, intent.policy.cleanupReservationMs], [7, 15, 300000, 120000]);
  const { createHash } = require('node:crypto');
  assert.equal(Object.keys(intent.sourceHashes).length, 7);
  for (const [file, hash] of Object.entries(intent.sourceHashes))
    assert.equal(hash, createHash('sha256').update(fs.readFileSync(path.join(root, 'scripts/performance', file))).digest('hex'));
  assert.deepEqual(report.failures, [{ stage: 'app-image-preflight', code: 'OWNED_DOCKER' }]);
});
for (const mode of ['manifest-drift', 'frozen-drift'])
  test(`real bounded functional child rejects ${mode} before any resource creation`,
    { skip: !fs.existsSync(path.join(proofRoot, 'offline-build/receipt.json')) }, () => {
    const { events, report } = runFunctionalPreflightChild(mode);
    assert.equal(events.some(event => event.kind === 'manifest' && event.exclusive), true);
    assert.equal(events.some(event => /run|create|start/.test(event.command?.join(' ') ?? '')), false,
      'The full resolved manifest and frozen bytes must be validated before any resource creation');
    assert.deepEqual(report.failures, [{ stage: 'resolved-manifest-validation', code: 'ERR_ASSERTION' }]);
  });
test('local real-child regressions explicitly skip when retained immutable proof is unavailable', () => {
  const directory = path.join(root, 'test-results/derived-functional-unit', randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  const preload = path.join(directory, 'missing-proof.cjs');
  fs.writeFileSync(preload, `
    const fs=require('node:fs'),path=require('node:path');
    const exists=fs.existsSync;
    const missing=${JSON.stringify(path.join(proofRoot, 'offline-build/receipt.json'))};
    fs.existsSync=file=>path.resolve(file)===missing?false:exists(file);
  `, { flag: 'wx' });
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--require', preload, '--test',
    '--test-name-pattern=real bounded functional child', __filename],
  { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 16384, env: environment });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, 'A clean checkout without ignored local evidence must not fail the runner');
  assert.match(child.stdout, /tests 3/);
  assert.match(child.stdout, /pass 0/);
  assert.match(child.stdout, /skipped 3/);
});
test('real bounded workload child stops before Group requests when fixture policy is rejected', async () => {
  const routes = [];
  const endpointId = '11111111-1111-4111-8111-111111111111';
  const server = http.createServer((request, response) => {
    routes.push(`${request.method} ${request.url}`);
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/scim/admin/version') response.end('{"version":"0.55.20"}');
    else if (request.method === 'POST') response.end(JSON.stringify({ id: endpointId }));
    else if (request.method === 'DELETE') response.end('{}');
    else response.end('{"endpoints":[]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = path.join(root, 'test-results/derived-functional-unit');
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `${randomUUID()}.json`);
  let child;
  try {
    child = fork(path.join(root, 'scripts/performance/benchmark-membership.cjs'), [], {
      silent: true, timeout: 5000, cwd: root,
      env: { ...process.env, SCIM_BENCH_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        SCIM_BENCH_TOKEN: 'unit-fixture-only', SCIM_BENCH_VERSION: '0.55.20', SCIM_BENCH_OUTPUT: output,
        SCIM_BENCH_DEADLINE_UTC: String(Date.now() + 4000), SCIM_BENCH_TRACE: '1',
        SCIM_BENCH_HISTORY: '1', SCIM_BENCH_HISTORY_OWNER: 'membership-history-diagnostic',
        SCIM_BENCH_REQUIRE_MASKS: '1' },
    });
    child.stdout.resume(); child.stderr.resume();
    const messages = [];
    child.on('message', message => {
      messages.push(message);
      child.send({ boundary: message.boundary, ok: false });
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
    });
    assert.equal(code, 1);
    assert.deepEqual(messages, [{ boundary: 'fixture-policy', endpointId }]);
    assert.equal(routes.some(route => /\/Groups|\/Users/.test(route)), false);
    const receipt = JSON.parse(fs.readFileSync(output));
    assert.equal(receipt.status, 'FAIL');
    assert.equal(receipt.cleanup.verified, true);
    assert.ok(Object.values(receipt.samples).every(values => values.length === 0));
  } finally {
    if (child && child.exitCode === null) child.kill();
    await new Promise(resolve => server.close(resolve));
  }
});
