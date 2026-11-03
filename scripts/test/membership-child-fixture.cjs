const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { performance } = require('node:perf_hooks');

async function prepareChild(setup, operation, startupMs = 10000, maxOutput = 131072) {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const started = performance.now();
  const child = fork(__filename, ['--fixture'], {
    env: environment, execArgv: [], silent: true,
  });
  const messages = new Map();
  const pending = new Map();
  const timings = {};
  let stdout = '';
  let stderr = '';
  let failure;
  let exited;
  const closed = new Promise(resolve => child.once('close', (status, signal) => {
    exited = { status, signal };
    for (const waiter of pending.values()) waiter.reject(coded('FIXTURE_EOF'));
    resolve(exited);
  }));
  function coded(code) {
    return Object.assign(new Error(code), { code, timings: { ...timings } });
  }
  function reject(code) {
    failure ||= coded(code);
    for (const waiter of pending.values()) waiter.reject(failure);
    if (!exited) child.kill('SIGKILL');
  }
  child.on('error', () => reject('FIXTURE_SPAWN'));
  child.on('message', value => {
    if (value?.type === 'failed') return reject(value.code === 'dispatch'
      ? 'FIXTURE_EXTERNAL_DISPATCH' : 'FIXTURE_CHILD_FAILURE');
    messages.set(value?.type, value);
    pending.get(value?.type)?.resolve(value);
  });
  for (const [stream, field] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']])
    stream.on('data', bytes => {
      if (field === 'stdout') stdout += bytes;
      else stderr += bytes;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxOutput)
        reject('FIXTURE_OUTPUT_LIMIT');
    });
  async function wait(type, timeoutMs, code) {
    if (failure) throw failure;
    if (messages.has(type)) return messages.get(type);
    if (exited) throw coded('FIXTURE_EOF');
    let timer;
    try {
      return await new Promise((resolve, rejectWait) => {
        pending.set(type, { resolve, reject: rejectWait });
        timer = setTimeout(() => reject(code), timeoutMs);
      });
    } finally {
      clearTimeout(timer);
      pending.delete(type);
    }
  }
  async function close() {
    if (!exited) child.kill('SIGKILL');
    let timer;
    try {
      return await Promise.race([closed, new Promise((_resolve, rejectClose) => {
        timer = setTimeout(() => rejectClose(coded('FIXTURE_CLOSE_TIMEOUT')), 1000);
      })]);
    } finally { clearTimeout(timer); }
  }
  const startupDeadline = started + startupMs;
  child.send({ setup, operation });
  try {
    await wait('boot', Math.max(1, startupDeadline - performance.now()), 'FIXTURE_STARTUP_TIMEOUT');
    timings.bootMs = Math.round(performance.now() - started);
    await wait('ready', Math.max(1, startupDeadline - performance.now()), 'FIXTURE_STARTUP_TIMEOUT');
    timings.startupMs = Math.round(performance.now() - started);
  } catch (error) { await close(); throw error; }
  return {
    child, timings, close,
    async start(operationMs = 2000, awaitExit = true) {
      const operationStarted = performance.now();
      const operationDeadline = operationStarted + operationMs;
      const finished = wait('done', operationMs, 'FIXTURE_OPERATION_TIMEOUT');
      child.send({ type: 'go' });
      try {
        const done = await finished;
        assert.equal(done.dispatches, 0, 'No external subprocess dispatch is permitted');
        assert.equal(done.testContext, false, 'Fixture must not inherit test discovery context');
        if (awaitExit) {
          let timer;
          try {
            await Promise.race([closed, new Promise((_resolve, rejectExit) => {
              timer = setTimeout(() => {
                reject('FIXTURE_OPERATION_TIMEOUT');
                rejectExit(failure);
              }, Math.max(1, operationDeadline - performance.now()));
            })]);
          } finally { clearTimeout(timer); }
        }
        timings.operationMs = Math.round(performance.now() - operationStarted);
        return { ...exited, stdout, stderr, value: done.value, timings };
      } catch (error) { await close(); throw error; }
    },
  };
}

async function runChild(setup, operation, operationMs = 2000, startupMs = 10000) {
  const fixture = await prepareChild(setup, operation, startupMs, 4096);
  try { return await fixture.start(operationMs); }
  finally { await fixture.close(); }
}

async function runDefaultChild(file, message, args = [], operationMs = 2000) {
  return runChild(`
    const file=${JSON.stringify(file)};
    require(file);
    const a=require('node:assert/strict');
    const Module=require('node:module');
    let guardHits=0;
    for(const key of ['ok','equal']) {
      const original=a[key];
      a[key]=function(...values) {
        try { return original.apply(this,values); }
        catch(error) {
          if(error.code==='ERR_ASSERTION' && (values.at(-1)===${JSON.stringify(message)} ||
            (${message === null} && key==='equal' && values[0]===3 && values[1]===4)))
            guardHits++;
          throw error;
        }
      };
    }
  `, `
    process.argv=[process.execPath,file,...${JSON.stringify(args)}];
    delete require.cache[file];
    // Execute the unchanged main entry after its imports have acknowledged readiness.
    Module._load(file,null,true);
    await new Promise(setImmediate);
    return {guardHits};
  `, operationMs);
}

if (require.main === module) {
  assert.equal(process.argv[2], '--fixture');
  let dispatches = 0;
  const cp = require('node:child_process');
  for (const key of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'])
    cp[key] = () => {
      dispatches++;
      throw Object.assign(new Error('FIXTURE_EXTERNAL_DISPATCH_REFUSED'),
        { code: 'FIXTURE_EXTERNAL_DISPATCH_REFUSED' });
    };
  process.send({ type: 'boot' });
  process.once('message', async ({ setup, operation }) => {
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const body = await new AsyncFunction('require', `${setup}\nreturn async () => {${operation}\n};`)(require);
      process.once('message', async message => {
        if (message?.type !== 'go') return process.exit(2);
        try {
          const value = await body();
          process.send({ type: 'done', value, dispatches, testContext: !!process.env.NODE_TEST_CONTEXT },
            () => process.disconnect());
        } catch (error) {
          process.send({ type: 'failed', code: error.code === 'FIXTURE_EXTERNAL_DISPATCH_REFUSED'
            ? 'dispatch' : 'operation' }, () => process.disconnect());
          process.exitCode = 2;
        }
      });
      process.send({ type: 'ready' });
    } catch {
      process.send({ type: 'failed' }, () => process.disconnect());
      process.exitCode = 2;
    }
  });
}

module.exports = { prepareChild, runChild, runDefaultChild };
