const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
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

function child(mode = 'server') {
  return spawn(process.execPath, ['-e', `
    const {serve}=require(${JSON.stringify(modulePath)});
    ${fixture}
    if(${JSON.stringify(mode)}==='hang') process.stdin.resume();
    else serve('${owner}', row);
  `], { stdio: ['pipe', 'pipe', 'pipe'] });
}

test('real bounded stream binds once, serializes snapshots and rejects unknown targets', async () => {
  const { ObserverChannel } = require(modulePath);
  const channel = new ObserverChannel(child(), owner, 1000);
  try {
    const bound = await channel.request({ kind: 'bind', id, pid: '12' });
    assert.equal(bound.epoch, `${id}:12:99`);
    const first = channel.request({ kind: 'snapshot', id });
    await assert.rejects(channel.request({ kind: 'snapshot', id }), /outstanding/);
    assert.equal((await first).epoch, bound.epoch);
    await assert.rejects(channel.request({ kind: 'snapshot', id: 'c'.repeat(64) }), /rejected/);
  } finally { await channel.close(); }
});

test('real child timeout and EOF fail closed without leaking supplied text', async () => {
  const { ObserverChannel } = require(modulePath);
  const channel = new ObserverChannel(child('hang'), owner, 100);
  try {
    await assert.rejects(channel.request({ kind: 'bind', id, pid: '12' }), /timeout/);
  } finally { await channel.close(); }
  const eof = new ObserverChannel(spawn(process.execPath, ['-e', 'process.exit(0)']), owner, 1000);
  try { await assert.rejects(eof.request({ kind: 'snapshot', id }), /EOF/); }
  finally { await eof.close(); }
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
    const instance = child();
    let output = '';
    instance.stdout.on('data', bytes => { output += bytes; });
    instance.stderr.resume();
    const exited = new Promise(resolve => instance.once('exit', code => resolve(code)));
    const timer = setTimeout(() => instance.kill(), 1500);
    instance.stdin.on('error', () => {});
    instance.stdin.end(frames.map(frame => typeof frame === 'string' ? frame : JSON.stringify(frame)).join('\n') + '\n');
    try {
      assert.equal(await exited, 1);
      assert.ok(!output.includes('PRIVATE_CANARY'));
      assert.match(output, /protocol-error/);
    } finally { clearTimeout(timer); instance.kill(); }
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
    const instance = spawn(process.execPath, ['-e', `${fixture} process.stdin.once('data',()=>{${snippet}})`]);
    const channel = new ObserverChannel(instance, owner, 1000);
    try {
      await assert.rejects(channel.request({ kind: 'snapshot', id }), error =>
        !error.message.includes('PRIVATE_CANARY'));
    } finally { await channel.close(); }
  }
});

test('expected epoch change quarantines target until explicit refresh on same real stream', async () => {
  const { ObserverChannel } = require(modulePath);
  const instance = spawn(process.execPath, ['-e', `
    const {serve}=require(${JSON.stringify(modulePath)});
    ${fixture}
    let calls=0;
    serve('${owner}', (pid,id)=>row(pid,id,pid==='12' && calls++ ? 100 : 99));
  `]);
  const channel = new ObserverChannel(instance, owner, 1000);
  try {
    await channel.request({ kind: 'bind', id, pid: '12' });
    await assert.rejects(channel.request({ kind: 'snapshot', id }), /epoch changed/);
    assert.equal((await channel.request({ kind: 'bind', id, pid: '13' })).epoch, `${id}:13:99`);
  } finally { await channel.close(); }
});

test('missing counter fields or private extra fields never cross the observer boundary', async () => {
  const { ObserverChannel } = require(modulePath);
  for (const change of ['delete value.cpu', "value.payload='PRIVATE_CANARY'"]) {
    const instance = spawn(process.execPath, ['-e', `
      const {serve}=require(${JSON.stringify(modulePath)}); ${fixture}
      serve('${owner}', (pid,id)=>{const value=row(pid,id); ${change}; return value;});
    `]);
    const channel = new ObserverChannel(instance, owner, 1000);
    try { await assert.rejects(channel.request({ kind: 'bind', id, pid: '12' }), /rejected/); }
    finally { await channel.close(); }
  }
});
