const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prepareChild, runChild, runDefaultChild } = require('./membership-child-fixture.cjs');
const path = require('node:path');
const modulePath = path.resolve(__dirname, '../performance/membership-observer.cjs');
const owner = 'a'.repeat(32);
const id = 'b'.repeat(64);
const fixture = `
  function row(pid,id,ticks=99) { return {
    epoch:id+':'+pid+':'+ticks,pid:Number(pid),startTicks:String(ticks),
    readStartUtc:'2026-10-23T00:00:00.000Z',readEndUtc:'2026-10-23T00:00:00.001Z',
    readStartNs:'1',readEndNs:'2',cpu:{usage_usec:10,nr_periods:2,nr_throttled:1,throttled_usec:3},
    cpuStatRaw:'usage_usec 10\\nnr_periods 2\\nnr_throttled 1\\nthrottled_usec 3',
    cpuMax:'50000 100000',cpuBurst:0,ancestors:[{path:'/',root:true,cpuMax:null,cpuBurst:null}],
    rssBytes:1024,highWaterRssBytes:2048,memoryPeakBytes:4096,memoryMaxBytes:1073741824,oom:0,oomKill:0
  }; }`;

test('fixture clocks exclude cold module startup before the intended operation boundary', () => {
  const fs = require('node:fs');
  for (const name of ['membership-observer.test.cjs', 'membership-privacy-functional.test.cjs',
    'membership-statements.test.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    assert.match(source, /require\('\.\/membership-child-fixture\.cjs'\)/,
      `${name}: cold startup must be acknowledged before the operation clock starts`);
  }
});

async function child(mode = 'server', capture = 'row') {
  return prepareChild(`
    const {serve}=require(${JSON.stringify(modulePath)});
    ${fixture}
  `, `
    if(${JSON.stringify(mode)}==='hang') process.stdin.resume();
    else serve('${owner}', ${capture});
  `);
}

test('real bounded stream binds once, serializes snapshots and rejects unknown targets', async () => {
  const { ObserverChannel } = require(modulePath);
  const instance = await child();
  const channel = new ObserverChannel(instance.child, owner, 1000);
  try {
    await instance.start(1000, false);
    const bound = await channel.request({ kind: 'bind', id, pid: '12' });
    assert.equal(bound.epoch, `${id}:12:99`);
    const first = channel.request({ kind: 'snapshot', id });
    await assert.rejects(channel.request({ kind: 'snapshot', id }), /outstanding/);
    assert.equal((await first).epoch, bound.epoch);
    await assert.rejects(channel.request({ kind: 'snapshot', id: 'c'.repeat(64) }), /rejected/);
  } finally { await channel.close(); await instance.close(); }
});

test('real child timeout and EOF fail closed without leaking supplied text', async () => {
  const { ObserverChannel } = require(modulePath);
  const instance = await child('hang');
  const channel = new ObserverChannel(instance.child, owner, 100);
  try {
    await instance.start(1000, false);
    await assert.rejects(channel.request({ kind: 'bind', id, pid: '12' }), /timeout/);
  } finally { await channel.close(); await instance.close(); }
  const exiting = await prepareChild('', 'process.exitCode=0;');
  const eof = new ObserverChannel(exiting.child, owner, 1000);
  try {
    await exiting.start(1000, false);
    await assert.rejects(eof.request({ kind: 'snapshot', id }), /EOF/);
  } finally { await eof.close(); await exiting.close(); }
});

test('raw frames reject duplicate IDs, owner, missing fields, oversize and privacy canaries', async () => {
  for (const frames of [
    [{ kind: 'bind', id, pid: '12', owner: 'wrong', requestId: 1 }],
    [{ kind: 'bind', id, owner, requestId: 1 }],
    [{ kind: 'bind', id, pid: '12', owner, requestId: 1 },
      { kind: 'snapshot', id, owner, requestId: 1 }],
    [{ kind: 'snapshot', id, owner, requestId: 1, payload: 'PRIVATE_CANARY' }],
    ['PRIVATE_CANARY'.repeat(1000)],
  ]) {
    const prepared = await child();
    const instance = prepared.child;
    let output = '';
    instance.stdout.on('data', bytes => { output += bytes; });
    instance.stderr.resume();
    const exited = new Promise(resolve => instance.once('close', code => resolve(code)));
    await prepared.start(1000, false);
    const timer = setTimeout(() => instance.kill('SIGKILL'), 1500);
    instance.stdin.on('error', () => {});
    instance.stdin.end(frames.map(frame => typeof frame === 'string' ? frame : JSON.stringify(frame)).join('\n') + '\n');
    try {
      assert.equal(await exited, 1);
      assert.ok(!output.includes('PRIVATE_CANARY'));
      assert.match(output, /protocol-error/);
    } finally { clearTimeout(timer); await prepared.close(); }
  }
});

test('reply framing rejects unknown IDs, duplicates, missing snapshots and secret stderr', async () => {
  const { ObserverChannel } = require(modulePath);
  for (const snippet of [
    "process.stdout.write('{\"requestId\":99,\"ok\":true,\"snapshot\":{}}\\n')",
    "process.stdout.write('{\"requestId\":1,\"ok\":true}\\n')",
    "process.stderr.write('PRIVATE_CANARY')",
    "process.stdout.write('PRIVATE_CANARY\\n')",
    "process.stdout.write('x'.repeat(70000))",
    `const reply=JSON.stringify({requestId:1,ok:true,snapshot:row('12','${id}')})+'\\n';
      process.stdout.write(reply+reply)`,
  ]) {
    const instance = await prepareChild(fixture, `process.stdin.once('data',()=>{${snippet}});`);
    const channel = new ObserverChannel(instance.child, owner, 1000);
    try {
      await instance.start(1000, false);
      await assert.rejects(channel.request({ kind: 'snapshot', id }), error => {
        assert.equal(error.message, snippet.includes('stderr.write')
          ? 'Observer stderr rejected; content withheld' : 'Observer reply rejected');
        assert.ok(!error.message.includes('PRIVATE_CANARY'));
        return true;
      });
    } finally { await channel.close(); await instance.close(); }
  }
});

test('expected epoch change quarantines target until explicit refresh on same real stream', async () => {
  const { ObserverChannel } = require(modulePath);
  const instance = await prepareChild(`
    const {serve}=require(${JSON.stringify(modulePath)});
    ${fixture}
    let calls=0;
  `, `
    serve('${owner}', (pid,id)=>row(pid,id,pid==='12' && calls++ ? 100 : 99));
  `);
  const channel = new ObserverChannel(instance.child, owner, 1000);
  try {
    await instance.start(1000, false);
    await channel.request({ kind: 'bind', id, pid: '12' });
    await assert.rejects(channel.request({ kind: 'snapshot', id }), /epoch changed/);
    assert.equal((await channel.request({ kind: 'bind', id, pid: '13' })).epoch, `${id}:13:99`);
  } finally { await channel.close(); await instance.close(); }
});

test('missing counter fields or private extra fields never cross the observer boundary', async t => {
  const { ObserverChannel } = require(modulePath);
  for (const change of ['delete value.cpu', "value.payload='PRIVATE_CANARY'"]) {
    const instance = await child('server', `(pid,id)=>{const value=row(pid,id); ${change}; return value;}`);
    const channel = new ObserverChannel(instance.child, owner, 1000);
    try {
      await instance.start(1000, false);
      await assert.rejects(channel.request({ kind: 'bind', id, pid: '12' }),
        { message: 'Observer reply rejected' });
      t.diagnostic(JSON.stringify(instance.timings));
    } finally { await channel.close(); await instance.close(); }
  }
});

test('real fixture distinguishes bounded startup, operation and external-dispatch rejection', async () => {
  await assert.rejects(runChild('process.stdin.resume(); await new Promise(()=>{});', '', 2000, 150),
    { code: 'FIXTURE_STARTUP_TIMEOUT' });
  await assert.rejects(runChild('', 'process.stdin.resume(); await new Promise(()=>{});', 100),
    { code: 'FIXTURE_OPERATION_TIMEOUT' });
  await assert.rejects(runChild('', "require('node:child_process').execFile('docker',[]);"),
    { code: 'FIXTURE_EXTERNAL_DISPATCH' });
  const result = await runChild('', 'return 7;');
  assert.equal(result.value, 7);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  const otherCause = await runDefaultChild(path.resolve(__dirname, '../performance/run-membership-statements.cjs'),
    'Not the required opt-in assertion');
  assert.equal(otherCause.status, 1);
  assert.equal(otherCause.value.guardHits, 0, 'An arbitrary exit 1 is not the intended rejection cause');
});

test('real held fixture reproduces the old pre-readiness protocol clock failure', async () => {
  const { ObserverChannel } = require(modulePath);
  const instance = await child('server', `(pid,id)=>{const value=row(pid,id); delete value.cpu; return value;}`);
  const channel = new ObserverChannel(instance.child, owner, 100);
  try {
    await assert.rejects(channel.request({ kind: 'bind', id, pid: '12' }),
      { message: 'Observer request timeout' });
  } finally { await channel.close(); await instance.close(); }
});
