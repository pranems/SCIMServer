const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const cp = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const privacy = require('../performance/membership-privacy.cjs');
const root = path.resolve(__dirname, '../..');
const fixture = path.join(__dirname, 'membership-console-child.cjs');
const context = { role: 'reference-app', source: 'app-console', phase: 'work' };
const canaries = privacy.credentialCanaries(Object.fromEntries(
  ['POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK']
    .map((key, i) => [key, `synthetic-private-common-${i}-only`])), {
  a: 'synthetic-private-role-a-only', b: 'synthetic-private-role-b-only',
  observer: 'synthetic-private-observer-only',
});
const scanner = () => require('../performance/membership-console.cjs');
const wrapperFixture = path.join(__dirname, 'fixtures/membership-maxbuffer-wrapper.txt');
const retainedRunner = path.join(root,
  'test-results/derived-statements-20261023/attempt1-20261023T233120820Z/run/frozen-inputs/run-membership-statements.cjs');
let dockerDispatches = 0;
const spawn = cp.spawn;
cp.spawn = function (file, ...args) {
  if (String(file).toLowerCase().includes('docker')) {
    dockerDispatches++;
    throw Error('Real Docker dispatch forbidden');
  }
  return spawn(file, ...args);
};
const exec = promisify(cp.execFile);
async function child(mode, value, options = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const processChild = cp.spawn(process.execPath, [fixture, mode, ...(value ? [value] : [])],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], ...options });
  await Promise.race([once(processChild, 'message').then(([message]) => {
    assert.deepEqual(message, { fixture: 'ready' });
  }), new Promise((_, reject) => {
    const timer = setTimeout(() => { processChild.kill(); reject(Error('Bounded fixture boot failed')); }, 4000);
    timer.unref();
    processChild.once('close', () => clearTimeout(timer));
    processChild.once('message', () => clearTimeout(timer));
  })]);
  return processChild;
}
async function capture(mode, value, extra = {}) {
  const instance = await child(mode, value);
  const closed = once(instance, 'close');
  let chunks = 0;
  if (mode === 'split') instance.stderr.on('data', () => {
    chunks++;
    if (instance.connected) instance.send({ fixture: 'next' }, () => {});
  });
  try {
    const result = scanner().captureChild(instance, {
      ...context, canaries, deadline: Date.now() + 7000, ...extra,
    });
    instance.send({ fixture: 'go' });
    return await result;
  } finally {
    if (instance.exitCode === null && instance.signalCode === null) instance.kill();
    await closed;
    if (mode === 'split') assert.ok(chunks >= value.length, 'Real separately acknowledged output chunks required');
  }
}

test('committed work-wrapper fixture matches retained historical source when available', {
  skip: fs.existsSync(retainedRunner) ? false : 'Retained historical runner unavailable in this checkout',
}, () => {
  const frozen = fs.readFileSync(retainedRunner, 'utf8');
  const body = frozen.slice(frozen.indexOf('  async function docker('), frozen.indexOf('  async function allocate('));
  assert.equal(fs.readFileSync(wrapperFixture, 'utf8').replaceAll('\r\n', '\n').trim(),
    body.replaceAll('\r\n', '\n').trim());
});

test('committed work wrapper reproduces large-output failure with closed native code', { timeout: 15000 }, async () => {
  const body = fs.readFileSync(wrapperFixture, 'utf8');
  let native;
  const sandbox = { derived: true, environment: {}, root, toolConsole: '', Date, Error,
    commandTimeout: () => 10000, workDeadline: Date.now() + 10000, deadline: Date.now() + 10000,
    splitDockerLogOutput: require('../performance/run-membership-privacy-functional.cjs').splitDockerLogOutput,
    dockerOperation: () => 'logs', lifecycleFailure: privacy.lifecycleFailure,
    exec: async (file, args, options) => {
      assert.equal(file, 'docker');
      assert.deepEqual(Array.from(args), ['--context', 'desktop-linux', 'logs', '--timestamps', 'fixture']);
      try { return await exec(process.execPath, [fixture, 'bulk'], { ...options, env: process.env }); }
      catch (error) { native = error.code; throw error; }
    } };
  const docker = vm.runInNewContext(`${body};docker`, sandbox);
  const failure = await docker(['logs', '--timestamps', 'fixture']).then(() => null, error => error);
  assert.equal(native, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  assert.equal(failure.code, 'OWNED_DOCKER');
  assert.equal(failure.actionFailure.category, 'output-limit');
  assert.equal(failure.actionFailure.nativeCode, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
});

test('streaming drains greater than eight MiB on each channel without retaining console', { timeout: 15000 }, async () => {
  const receipt = await capture('bulk');
  assert.equal(receipt.complete, true);
  assert.ok(receipt.totalBytes > 18 * 1024 * 1024);
  assert.equal(receipt.stdoutEof && receipt.stderrEof, true);
  assert.equal(receipt.exitCode, 0);
  assert.deepEqual(receipt.credentialKinds, canaries.map(row => row.kind));
  scanner().requireCapture(receipt, { ...context, canaries });
  assert.throws(() => scanner().requireCapture({ ...receipt }, { ...context, canaries }),
    /capture proof/i);
  assert.throws(() => scanner().requireCapture(receipt, { ...context,
    canaries: canaries.map(row => ({ ...row, value: 'changed-private-input' })) }),
  /Matching capture canary inputs/);
  for (const key of ['stdout', 'stderr', 'text', 'tail', 'record', 'message', 'args'])
    assert.equal(Object.hasOwn(receipt, key), false);
});

test('real native contract children preserve overflow, exit and first cause through private output rejection',
  { timeout: 15000 }, async () => {
    const source = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-statements.cjs'), 'utf8');
    const body = source.slice(source.indexOf('  async function native('), source.indexOf('  async function captureLogs('));
    for (const mode of ['bulk', 'exit', 'exit-private']) {
      const sandbox = { derived: true, Date, Error, assert, lifecycleFailure: privacy.lifecycleFailure,
        appendTool: text => privacy.assertCanariesAbsent([{ source: 'tool-console', text }], canaries),
        exec: async (file, args, options) => {
          assert.equal(file, 'pwsh');
          assert.deepEqual(Array.from(args), ['fixed-contract-fixture']);
          return exec(process.execPath, [fixture, mode, canaries[0].value], options);
        } };
      const native = vm.runInNewContext(`${body};native`, sandbox);
      await assert.rejects(native('pwsh', ['fixed-contract-fixture'], {
        timeout: 5000, maxBuffer: 8 * 1024 * 1024,
      }), error => {
        assert.equal(error.code, mode === 'exit-private' ? 'DIAGNOSTIC_PRIVACY' : 'OWNED_NATIVE');
        assert.equal(error.actionFailure.command, 'contract');
        assert.equal(error.actionFailure.role, 'client');
        assert.equal(error.actionFailure.category, mode === 'bulk' ? 'output-limit' : 'exit');
        if (mode !== 'bulk') assert.equal(error.actionFailure.exitCode, 7);
        if (mode === 'exit-private') {
          assert.equal(error.secondaryActionFailure.category, 'privacy');
          assert.deepEqual(privacy.projectLifecycleFailures([error.actionFailure, error.secondaryActionFailure]),
            [error.actionFailure, error.secondaryActionFailure]);
        }
        assert.equal(JSON.stringify(error).includes(canaries[0].value), false);
        return true;
      });
    }
  });

test('active minimal statement receipt preserves native codes and exact capture roles without recycling private fields', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-statements.cjs'), 'utf8');
  const start = source.lastIndexOf("writeResult(path.join(directory, 'report.json'), { family: owner");
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf('\n        } else {', start));
  const actions = [['reference-app', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'], ['pg', 'ENOBUFS']]
    .map(([role, code]) => privacy.lifecycleFailure({ code }, { operation: 'capture', role,
      stage: 'docker-command', phase: 'work', command: 'logs' }));
  const report = { actionFailures: actions, elapsedMsIncludingCleanup: 123,
    cleanup: { verified: false, privateExtra: canaries[0].value }, extra: canaries[0].value };
  let error;
  try { privacy.encodeSafeJson(report, canaries); } catch (caught) { error = caught; }
  assert.equal(error.code, 'DIAGNOSTIC_PRIVACY');
  let saved;
  vm.runInNewContext(body, { path, directory: 'fixture', report, error,
    owner: 'membership-derived-statement-diagnostic', run: 'fixed',
    projectLifecycleFailures: privacy.projectLifecycleFailures,
    validateSafeFailure: privacy.validateSafeFailure,
    writeResult(_file, value) { saved = JSON.parse(privacy.encodeSafeJson(value, canaries)); } });
  assert.deepEqual(saved.actionFailures, actions);
  assert.deepEqual(saved.cleanup, { verified: false });
  assert.equal(JSON.stringify(saved).includes(canaries[0].value), false);
});

test('all eight roles reject split timestamp/chunk and ambiguous channel canaries', { timeout: 30000 }, async () => {
  for (const canary of canaries)
    for (const mode of ['split', 'cross-frame', 'ambiguous', 'cross-channel', 'cross-channel-reverse']) {
      await assert.rejects(capture(mode, canary.value), error => {
        assert.equal(error.code, 'DIAGNOSTIC_PRIVACY');
        assert.equal(error.safeDetails.credentialKind, canary.kind);
        assert.ok(['app-console', 'ambiguous-console'].includes(error.safeDetails.source));
        assert.equal(error.actionFailure.role, 'reference-app');
        assert.equal(JSON.stringify(error).includes(canary.value), false);
        return true;
      });
    }
  await assert.rejects(capture('cross-channel', canaries[0].value), error =>
    error.code === 'DIAGNOSTIC_PRIVACY' &&
    error.safeDetails.source === 'ambiguous-console' &&
    error.safeDetails.credentialKind === canaries[0].kind);
});

test('real child missing channel, spawn, termination and unknown private native events fail closed',
  { timeout: 10000 }, async () => {
    for (const mode of ['missing', 'unknown', 'terminated', 'spawn']) {
      const instance = mode === 'spawn'
        ? cp.spawn(process.execPath, [fixture, 'ok'], { cwd: path.join(root, 'nonexistent-console-fixture'),
          windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        : await child('hang', undefined, mode === 'missing' ? { stdio: ['ignore', 'pipe', 'ignore', 'ipc'] } : {});
      const closed = new Promise(resolve => instance.once('close', resolve));
      const result = scanner().captureChild(instance, { ...context, canaries, deadline: Date.now() + 2000 });
      if (mode === 'unknown') instance.emit('error', Object.assign(Error(canaries[0].value), {
        code: canaries[0].value, stderr: canaries[1].value, args: [canaries[2].value],
      }));
      if (mode === 'terminated') instance.kill();
      await assert.rejects(result, error => {
        assert.equal(error.actionFailure.category,
          { missing: 'incomplete-output', unknown: 'unexpected', terminated: 'terminated', spawn: 'spawn' }[mode]);
        assert.equal(error.actionFailure.nativeCode,
          { missing: 'CAPTURE_CHANNEL', unknown: 'UNRECOGNIZED', terminated: 'UNRECOGNIZED', spawn: 'ENOENT' }[mode]);
        for (const canary of canaries) assert.equal(JSON.stringify(error).includes(canary.value), false);
        return true;
      });
      await closed;
    }
  });

test('observer native spawn failure retains its finite cause without private exception text', async () => {
  const { ObserverChannel } = require('../performance/membership-observer.cjs');
  const instance = cp.spawn(process.execPath, [fixture, 'ok'], {
    cwd: path.join(root, 'nonexistent-console-fixture'), windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const channel = new ObserverChannel(instance, 'a'.repeat(32), 1000);
  await assert.rejects(channel.request({}), error =>
    error.actionFailure?.nativeCode === 'ENOENT' && error.actionFailure?.role === 'observer');
  await channel.close();
});

test('streamed statement inputs require live proofs, all database roles and unchanged current correlation',
  { timeout: 15000 }, async () => {
    const tool = require('../performance/membership-derived-statements.cjs');
    const rows = Array.from({ length: 200 }, () => ({ requestHeaders: '{"authorization":"[REDACTED]"}' }));
    const app = await capture('ok');
    const pg = await capture('ok', undefined, { role: 'pg', source: 'pg-console' });
    assert.equal(tool.validateStreamedPrivateInputs(rows, app, pg, 'owned metadata read', canaries, 'A')
      .validatedRows, 200);
    assert.throws(() => tool.validateStreamedPrivateInputs(rows, app, pg, 'owned metadata read',
      canaries.slice(0, 5), 'A'), error => error.code === 'DIAGNOSTIC_PRIVACY' &&
      error.safeDetails.reason === 'canaries-required');
    assert.throws(() => tool.validateStreamedPrivateInputs(rows, { ...app }, pg, 'owned metadata read',
      canaries, 'A'), /Live complete capture proof/);
    for (const canary of canaries) {
      assert.throws(() => tool.validateStreamedPrivateInputs(rows, app, pg, canary.value, canaries, 'A'),
        error => error.code === 'DIAGNOSTIC_PRIVACY' &&
          error.safeDetails.source === 'tool-console' && error.safeDetails.credentialKind === canary.kind);
      const changed = [...rows]; changed[7] = { requestHeaders: JSON.stringify({ authorization: canary.value }) };
      assert.throws(() => tool.validateStreamedPrivateInputs(changed, app, pg, 'metadata', canaries, 'A'),
        error => error.code === 'DIAGNOSTIC_PRIVACY' &&
          error.safeDetails.source === 'selected-rows' && error.safeDetails.credentialKind === canary.kind);
    }
    assert.throws(() => tool.validateStreamedPrivateInputs(rows, app, pg, '', canaries, 'A'),
      error => error.safeDetails.reason === 'private-source-missing' && error.safeDetails.source === 'tool-console');
    const requestId = '12345678-1234-1234-1234-123456789012';
    const current = rows.map((row, index) => ({ ...row, requestId, endpointId: requestId,
      durationMs: 0, status: index === 0 ? 400 : 200 }));
    const candidate = await capture('correlation', requestId, {
      role: 'candidate-app', correlationRequestId: requestId,
    });
    assert.equal(tool.validateStreamedPrivateInputs(current, candidate, pg, 'metadata', canaries, 'B')
      .sameRecordPresent, true);
    current[0].requestId = '87654321-1234-1234-1234-123456789012';
    assert.throws(() => tool.validateStreamedPrivateInputs(current, candidate, pg, 'metadata', canaries, 'B'),
      /strictly equal/);
    assert.equal(dockerDispatches, 0);
  });

test('fixed frame/total caps, empty, incomplete, failed exit and deadline reject causally', { timeout: 30000 }, async () => {
  for (const [mode, category] of [['long', 'output-limit'], ['total', 'output-limit'],
    ['empty', 'incomplete-output'], ['partial', 'incomplete-output'], ['exit', 'exit']]) {
    await assert.rejects(capture(mode), error => {
      assert.equal(error.actionFailure.category, category);
      assert.equal(error.actionFailure.role, 'reference-app');
      if (mode === 'exit') assert.equal(error.actionFailure.exitCode, 7);
      return true;
    });
  }
  const instance = await child('hang');
  const closed = once(instance, 'close');
  const result = scanner().captureChild(instance, { ...context, canaries, deadline: Date.now() + 500 });
  instance.send({ fixture: 'go' });
  await assert.rejects(result, error => error.actionFailure.category === 'timeout');
  await closed;
});

test('current error correlation remains mandatory and source identity/metadata are closed', { timeout: 10000 }, async () => {
  const requestId = '12345678-1234-1234-1234-123456789012';
  const receipt = await capture('correlation', requestId, { role: 'candidate-app', correlationRequestId: requestId });
  assert.equal(receipt.correlationPresent, true);
  await assert.rejects(capture('ok', undefined, { role: 'candidate-app', correlationRequestId: requestId }), error =>
    error.actionFailure.nativeCode === 'CAPTURE_CORRELATION');
  const secret = canaries[0].value;
  for (const [code, category] of [['ENOBUFS', 'native-buffer'], ['ABORT_ERR', 'aborted'],
    ['ENOENT', 'spawn'], ['EIO', 'native-io'], ['ENOMEM', 'native-memory'],
    [secret, 'unexpected']]) {
    const row = privacy.lifecycleFailure(Object.assign(Error(secret), {
      code, stderr: secret, args: [secret], cause: Error(secret),
    }), { operation: 'capture', role: 'candidate-app', stage: 'docker-command', phase: 'work', command: 'logs' });
    assert.equal(row.category, category);
    assert.equal(JSON.stringify(row).includes(secret), false);
    assert.deepEqual(privacy.projectLifecycleFailures([row]), [row]);
    assert.throws(() => privacy.validateLifecycleFailure({ ...row, nativeCode: secret }));
  }
  assert.equal(dockerDispatches, 0);
});

test('shared row extraction preserves the original default console-privacy first cause', () => {
  const { validatePrivacy } = require('../performance/membership-history.cjs');
  const id = '12345678-1234-1234-1234-123456789012';
  const rows = Array.from({ length: 200 }, () => ({ requestId: id, endpointId: id,
    durationMs: -1, status: 400, requestHeaders: '{"authorization":"[REDACTED]"}' }));
  assert.throws(() => validatePrivacy(rows, canaries[0].value, [canaries[0].value]),
    /Generated credential leaked/);
});
