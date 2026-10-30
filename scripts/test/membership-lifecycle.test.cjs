const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const vm = require('node:vm');
const history = require('../performance/membership-history.cjs');
const privacy = require('../performance/membership-privacy.cjs');
const functional = require('../performance/run-membership-privacy-functional.cjs');
const exec = promisify(childProcess.execFile);
const secret = 'synthetic-private-exception-canary-not-a-credential';
const root = path.resolve(__dirname, '../..');
let dockerDispatches = 0;
const originalExec = childProcess.execFile;
childProcess.execFile = function (file, ...args) {
  if (String(file).toLowerCase().includes('docker')) {
    dockerDispatches++;
    throw Error('Real Docker dispatch forbidden');
  }
  return originalExec(file, ...args);
};

async function fakeCli(code, timeout = 700) {
  assert.equal(process.execPath.toLowerCase().endsWith('node.exe') ||
    path.basename(process.execPath) === 'node', true);
  return exec(process.execPath, ['-e', code], { timeout, windowsHide: true });
}

test('real failing capture and hanging removal retain separate first safe causes', { timeout: 4000 }, async () => {
  const attempted = [];
  const result = await history.finalizeOwned(['app'], {
    role: () => 'app',
    async capture() {
      attempted.push('capture');
      await fakeCli(`process.stderr.write(${JSON.stringify(secret)});process.exit(7)`);
    },
    async remove() {
      attempted.push('remove');
      await fakeCli('setInterval(()=>{},1000)', 120);
    },
    async verify() { attempted.push('verify'); return false; },
  });
  assert.deepEqual(attempted, ['capture', 'remove', 'verify']);
  assert.equal(result.verified, false);
  assert.deepEqual(result.failures.map(row => [row.operation, row.role, row.category]), [
    ['capture', 'app', 'exit'], ['remove', 'app', 'terminated'], ['verify', 'app', 'still-present'],
  ]);
  assert.equal(result.failures[0].exitCode, 7);
  assert.equal(result.failures[1].signal, 'SIGTERM');
  for (const failure of result.failures) {
    privacy.validateLifecycleFailure(failure);
    assert.equal(failure.phase, 'cleanup');
    assert.equal(failure.stage, 'finalization');
    assert.ok(Number.isSafeInteger(failure.durationMs) && failure.durationMs >= 0);
  }
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('exhausted work budget retains reserved cleanup and real slow success', { timeout: 4000 }, async () => {
  const cleanupBudgetMs = 1800;
  const deadline = Date.now() + cleanupBudgetMs;
  const workDeadline = Date.now() - 1;
  assert.throws(() => history.commandTimeout(workDeadline, deadline, false, 700),
    error => error.code === 'LIFECYCLE_DEADLINE' && error.actionFailure.phase === 'work');
  const result = await history.finalizeOwned(['pg'], {
    role: () => 'pg',
    async capture() {
      const timeout = history.commandTimeout(workDeadline, deadline, true, cleanupBudgetMs);
      await fakeCli('setTimeout(()=>process.exit(0),800)', timeout);
    },
    async remove() {
      await fakeCli('process.exit(0)', history.commandTimeout(workDeadline, deadline, true, cleanupBudgetMs));
    },
    async verify() { return true; },
  });
  assert.equal(result.verified, true);
  assert.equal(result.rows[0].capture, true, JSON.stringify(result));
  assert.equal(result.rows[0].removed, true, JSON.stringify(result));
  assert.equal(result.failures, undefined);
  assert.ok(Date.now() < deadline);
});

test('absolute cleanup expiry bounds a real hanging command and refuses later dispatch', { timeout: 4000 }, async () => {
  const workDeadline = Date.now() - 1;
  const deadline = Date.now() + 160;
  let dispatched = 0;
  const action = async () => {
    const timeout = history.commandTimeout(workDeadline, deadline, true, 700);
    dispatched++;
    await fakeCli('setInterval(()=>{},1000)', timeout);
  };
  const result = await history.finalizeOwned(['app'], {
    role: () => 'app', capture: action, remove: action, verify: action,
  });
  assert.equal(dispatched, 1);
  assert.equal(result.rows[0].capture, false);
  assert.equal(result.rows[0].removed, false);
  assert.equal(result.rows[0].verified, false);
  assert.deepEqual(result.failures.map(row => row.category), ['terminated', 'deadline', 'deadline']);
  assert.equal(result.failures[1].phase, 'cleanup');
});

test('actual history wrapper stops expired work while reserved cleanup still dispatches',
  { timeout: 8000 }, async () => {
    const source = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-history.cjs'), 'utf8');
    const first = source.indexOf('  async function docker(');
    const last = source.indexOf('  async function inspect(', first);
    assert.ok(first > 0 && last > first);
    const dispatched = [];
    const context = {
      root, environment: {}, Date, Error,
      workDeadline: Date.now() - 1, deadline: Date.now() + 4000,
      commandTimeout: history.commandTimeout, dockerOperation: history.dockerOperation,
      lifecycleFailure: privacy.lifecycleFailure,
      async exec(file, args, options) {
        assert.equal(file, 'docker');
        dispatched.push(args[2]);
        return fakeCli("setTimeout(()=>console.log('owned-fixture'),20)", options.timeout);
      },
    };
    const command = vm.runInNewContext(`(${source.slice(first, last).trim()})`, context);
    await assert.rejects(command(['inspect', 'fixture'], false), error =>
      error.actionFailure.category === 'deadline' && error.actionFailure.phase === 'work');
    assert.deepEqual(dispatched, []);
    const result = await history.finalizeOwned(['fixture'], {
      role: () => 'app',
      capture: id => command(['inspect', id], true),
      remove: id => command(['rm', '-f', id], true),
      async verify(id) { return (await command(['ps', id], true)) === 'owned-fixture'; },
    });
    assert.equal(result.verified, true);
    assert.deepEqual(dispatched, ['inspect', 'rm', 'ps']);
    assert.ok(Date.now() < context.deadline);
    assert.equal(dockerDispatches, 0);
  });

test('history work and child lifetimes leave ninety seconds inside the unchanged outer cap', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/performance/run-membership-history.cjs'), 'utf8');
  const first = source.indexOf('  const started = Date.now();');
  const last = source.indexOf('  const run =', first);
  const started = Date.now();
  const deadlines = vm.runInNewContext(`${source.slice(first, last)};
    ({ started, deadline, workDeadline: typeof workDeadline === 'undefined' ? null : workDeadline })`,
  { Date: { now: () => started } });
  assert.equal(deadlines.deadline - deadlines.started, 60 * 60 * 1000);
  assert.equal(deadlines.deadline - deadlines.workDeadline, 90000);
  const childStart = source.indexOf('    const child = fork(');
  const childEnd = source.indexOf('    child.stdout.resume();', childStart);
  let options;
  const context = {
    __dirname, root, path, Math, environment: {}, credentials: {}, app: { url: 'fixture' },
    receiptPath: 'fixture', owner: 'fixture', deadline: deadlines.deadline,
    workDeadline: deadlines.workDeadline, commandTimeout: history.commandTimeout,
    Date: { now: () => deadlines.workDeadline - 1000 },
    fork(file, args, value) { options = value; return {}; },
  };
  vm.runInNewContext(source.slice(childStart, childEnd), context);
  assert.equal(options.timeout, 1000);
  assert.equal(Number(options.env.SCIM_BENCH_DEADLINE_UTC), deadlines.workDeadline);
});

test('real fixture ownership mismatch refuses removal without hiding its cause', { timeout: 4000 }, async () => {
  const id = 'a'.repeat(64);
  let removed = false;
  const inspect = async () => {
    const response = await fakeCli(`console.log(JSON.stringify({id:${JSON.stringify(id)},
      labels:{'scimserver.owner':'unrelated','scimserver.run':'other'}}))`);
    return history.requireOwnedContainer(JSON.parse(response.stdout), id, 'owned', 'run');
  };
  const result = await history.finalizeOwned([id], {
    role: () => 'app', capture: inspect,
    async remove() { await inspect(); removed = true; },
    async verify() { return false; },
  });
  assert.equal(removed, false);
  assert.deepEqual(result.failures.map(row => row.category), ['ownership', 'ownership', 'still-present']);
  const own = { id, labels: { 'scimserver.owner': 'owned', 'scimserver.run': 'run' } };
  assert.throws(() => history.requireOwnedContainer(own, 'b'.repeat(64), 'owned', 'run'));
  assert.equal(history.requireOwnedContainer(own, id, 'owned', 'run'), own);
});

test('closed lifecycle metadata rejects private exception fields and unsafe nested causes', () => {
  const error = Object.assign(Error(secret), { stderr: secret, stdout: secret,
    code: secret, signal: secret, cause: { connectionString: secret },
    actionFailure: { operation: secret, role: secret, stage: secret, category: secret } });
  const failure = privacy.lifecycleFailure(error, { operation: 'remove', role: 'pg',
    stage: 'finalization', phase: 'cleanup', durationMs: 1 });
  privacy.validateLifecycleFailure(failure);
  assert.equal(failure.category, 'unexpected');
  assert.equal(JSON.stringify(failure).includes(secret), false);
  for (const field of ['message', 'stderr', 'cause', 'args', 'credentialHash', 'length', 'context'])
    assert.throws(() => privacy.validateLifecycleFailure({ ...failure, [field]: secret }));
  assert.throws(() => privacy.validateLifecycleFailure({ ...failure, signal: secret }));
  const wrapped = privacy.lifecycleFailure(Object.assign(Error(secret), { code: 17 }),
    { operation: 'command', role: 'owned-container', stage: 'docker-command', phase: 'cleanup', durationMs: 2 });
  const preserved = privacy.lifecycleFailure({ actionFailure: wrapped },
    { operation: 'capture', role: 'app', stage: 'finalization', phase: 'cleanup', durationMs: 3 });
  assert.equal(preserved.exitCode, 17);
  assert.equal(preserved.operation, 'capture');
  const rejected = privacy.projectLifecycleFailures([{ ...wrapped, stderr: secret }]);
  assert.equal(rejected[0].category, 'invalid-metadata');
  assert.equal(rejected[0].durationMs, null);
  assert.equal(JSON.stringify(rejected).includes(secret), false);
});

test('safe action projection preserves the actual failing budget phase rather than the caller intention', () => {
  let original;
  try { history.commandTimeout(Date.now() - 1, Date.now() + 1000, false, 100); }
  catch (error) { original = error; }
  assert.ok(original);
  const projected = privacy.lifecycleFailure(original, { operation: 'remove', role: 'app',
    stage: 'finalization', phase: 'cleanup', durationMs: 1 });
  assert.equal(projected.category, 'deadline');
  assert.equal(projected.phase, 'work');
  assert.equal(projected.operation, 'remove');
});

test('privacy fallback keeps closed action causes and original first cause without recursive rejection', () => {
  const canaries = [{ kind: 'postgres-admin-password', value: secret }];
  const first = privacy.lifecycleFailure({ code: 7 }, { operation: 'capture', role: 'app',
    stage: 'finalization', phase: 'cleanup', durationMs: 1 });
  const second = privacy.lifecycleFailure({ code: 'LIFECYCLE_DEADLINE' },
    { operation: 'network-remove', role: 'network', stage: 'finalization', phase: 'cleanup', durationMs: 2 });
  let encoded;
  let attempts = 0;
  const report = { family: 'membership-derived-reference-functional', status: 'INVALID',
    actionFailures: [first, second], unexpected: secret, cleanup: { verified: false } };
  const fallback = functional.writeFunctionalReport((_name, value) => {
    attempts++;
    encoded = privacy.encodeSafeJson(value, canaries);
  }, report);
  assert.equal(fallback, true);
  assert.equal(attempts, 2);
  const saved = JSON.parse(encoded);
  assert.deepEqual(saved.actionFailures, [first, second]);
  assert.equal(saved.actionFailures[0].category, 'exit');
  assert.equal(saved.actionFailures[1].operation, 'network-remove');
  assert.equal(saved.admissionEligible, false);
  assert.equal(encoded.includes(secret), false);
});

test('actual functional cleanup wrapper permits slow metadata inside remaining cleanup budget',
  { timeout: 18000 }, async () => {
    const file = process.env.OS17_FROZEN_RED
      ? path.join(root, 'test-results/derived-functional-continuation-20261023/attempt2/frozen-inputs/run-membership-privacy-functional.cjs')
      : path.join(root, 'scripts/performance/run-membership-privacy-functional.cjs');
    const source = fs.readFileSync(file, 'utf8');
    const first = source.indexOf('async function docker(');
    const last = source.indexOf('async function inspect(', first);
    assert.ok(first > 0 && last > first);
    let nativeDispatches = 0;
    const context = {
      root, environment: {}, toolConsole: '', deadline: Date.now() + 14000,
      workDeadline: Date.now() - 1, commandTimeout: history.commandTimeout,
      dockerOperation: history.dockerOperation, lifecycleFailure: privacy.lifecycleFailure,
      splitDockerLogOutput: functional.splitDockerLogOutput,
      check() { throw Error('Work deadline must not propagate into cleanup'); },
      assert,
      async exec(file, args, options) {
        assert.equal(file, 'docker');
        assert.deepEqual(Array.from(args).slice(0, 2), ['--context', 'desktop-linux']);
        nativeDispatches++;
        if (args[2] === 'network') {
          assert.equal(args[3], 'rm');
          return fakeCli(`process.stderr.write(${JSON.stringify(secret)});process.exit(9)`, options.timeout);
        }
        assert.equal(args[2], 'inspect');
        return fakeCli("setTimeout(()=>console.log('fixture-metadata'),11000)", options.timeout);
      },
    };
    const command = vm.runInNewContext(`(${source.slice(first, last).trim()})`, context);
    assert.equal(await command(['inspect', 'fixture-owned-full-id'], true), 'fixture-metadata');
    assert.equal(nativeDispatches, 1);
    await assert.rejects(command(['network', 'rm', 'fixture-owned-network'], true), error => {
      privacy.validateLifecycleFailure(error.actionFailure);
      assert.equal(error.actionFailure.command, 'network-rm');
      assert.equal(error.actionFailure.exitCode, 9);
      assert.equal(error.actionFailure.category, 'exit');
      assert.equal(error.actionFailure.phase, 'cleanup');
      assert.equal(JSON.stringify(error.actionFailure).includes(secret), false);
      return true;
    });
    assert.throws(() => privacy.assertCanariesAbsent([{ source: 'tool-console', text: context.toolConsole }],
      [{ kind: 'postgres-admin-password', value: secret }]), error => {
      assert.equal(error.code, 'DIAGNOSTIC_PRIVACY');
      assert.equal(error.safeDetails.source, 'tool-console');
      assert.equal(error.safeDetails.credentialKind, 'postgres-admin-password');
      return true;
    });
    assert.ok(Date.now() < context.deadline);
    assert.equal(dockerDispatches, 0);
  });

test('every active shared-finalizer caller preserves action causes and clamps cleanup to outer cap', () => {
  for (const file of ['run-membership-history.cjs', 'run-membership-statements.cjs',
    'run-membership-privacy-functional.cjs', 'run-membership-observer-smoke.cjs']) {
    const source = fs.readFileSync(path.join(root, 'scripts/performance', file), 'utf8');
    assert.match(source, /commandTimeout\(/, file);
    assert.match(source, /actionFailures/, file);
    assert.match(source, /lifecycleFailure\(/, file);
    assert.match(source, /failures: report\.actionFailures/, file);
  }
  assert.equal(dockerDispatches, 0);
});
