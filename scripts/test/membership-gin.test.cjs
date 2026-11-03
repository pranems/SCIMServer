const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const history = require('../performance/membership-history.cjs');
const privacy = require('../performance/membership-privacy.cjs');
const capture = require('../performance/membership-console.cjs');
const admission = require('../performance/assess-membership.cjs');
const modulePath = path.resolve(__dirname, '../performance/membership-gin.cjs');
const load = () => require(modulePath);
const canaries = [{ kind: 'postgres-admin-password', value: 'synthetic-exception-canary-only' }];
const column = { name: 'id', type: 'uuid', required: true, default: 'gen_random_uuid()' };
const catalog = gin => ({ columns: [column], constraints: ['PRIMARY KEY (id)'],
  options: ['autovacuum_vacuum_threshold=1000'], triggers: [],
  indexes: ['btree (id)', ...(gin ? ['gin (url gin_trgm_ops)'] : [])] });

test('explicit missing opt-in experiment is RED before implementation', () => {
  assert.ok(fs.existsSync(modulePath), 'Missing opt-in disposable GIN counterfactual implementation');
});
test('fixed eight-trial order, row count and complete deterministic dataset', () => {
  const g = load(), first = g.dataset(), second = g.dataset();
  assert.equal(first.length, 8000);
  assert.deepEqual(first, second);
  assert.deepEqual(g.policy.orders, ['BAAB', 'ABBA']);
  assert.equal(g.policy.batchRows, 50);
  assert.equal(g.policy.batches, 160);
  assert.equal(g.policy.wallMs, 900000);
  assert.equal(g.policy.cleanupMs, 120000);
  assert.equal(new Set(first.map(r => r.id)).size, 8000);
  assert.equal(new Set(first.map(r => r.url)).size, 2);
  assert.deepEqual(first.slice(0, 4).map(r => r.method), ['PATCH', 'GET', 'PATCH', 'GET']);
  assert.notEqual(g.hash(first), g.hash([...first].reverse()));
});
test('one-index semantic difference rejects every other catalog drift', () => {
  const g = load();
  assert.equal(g.verifyCatalogs(catalog(true), catalog(false)), true);
  for (const field of ['columns', 'constraints', 'options', 'triggers']) {
    const changed = structuredClone(catalog(false)); changed[field].push('drift');
    assert.throws(() => g.verifyCatalogs(catalog(true), changed), /Only URL GIN may differ/);
  }
  assert.throws(() => g.verifyCatalogs(catalog(true), catalog(true)), /Exactly one URL GIN/);
});
const plan = () => [{ 'Execution Time': 3, 'Planning Time': 0.2,
  Plan: { 'Node Type': 'ModifyTable', 'Actual Rows': 50, 'Actual Loops': 1,
    'Shared Hit Blocks': 12, 'Shared Read Blocks': 2, 'Shared Dirtied Blocks': 4,
    'Shared Written Blocks': 1, 'Local Hit Blocks': 0, 'Local Read Blocks': 0,
    'Local Dirtied Blocks': 0, 'Local Written Blocks': 0,
    'Temp Read Blocks': 0, 'Temp Written Blocks': 0,
    'WAL Records': 7, 'WAL FPI': 1, 'WAL Bytes': 999,
    Plans: [{ 'Node Type': 'Values Scan', 'WAL Bytes': 888 }] } }];
test('inclusive counters use root once and missing metrics fail closed', () => {
  const g = load(), result = g.metrics(plan());
  assert.equal(result.walBytes, 999);
  assert.equal(result.sharedHit, 12);
  const missing = plan(); delete missing[0].Plan['WAL Bytes'];
  assert.throws(() => g.metrics(missing), /Required EXPLAIN metric/);
  const bad = plan(); bad[0]['Execution Time'] = NaN;
  assert.throws(() => g.metrics(bad), /Required EXPLAIN metric/);
});
test('canonical source fixture rejects a guessed or missing column', () => {
  const g = load(), row = g.dataset()[0];
  g.verifyColumns(Object.keys(row));
  assert.throws(() => g.verifyColumns(Object.keys(row).slice(1)), /Canonical RequestLog columns/);
  assert.throws(() => g.verifyColumns([...Object.keys(row), 'guessed']), /Canonical RequestLog columns/);
});
test('normal invocation refuses dispatch and admission rejects diagnostic causal reason', () => {
  const g = load();
  assert.throws(() => g.optIn([]), /Explicit disposable URL GIN opt-in/);
  assert.throws(() => admission.assessBlock(
    [...'BAAB'].map(role => ({ role: role === 'B' ? 'candidate' : 'baseline', diagnosticOnly: true })),
    { order: 'BAAB', sameImage: false }, {}), /Diagnostic receipts cannot enter release admission/);
});
test('real Node child metrics, complete timestamped capture and bounded deadline: no Docker', async () => {
  const child = spawn(process.execPath, ['-e',
    `process.stdout.write('2026-10-24T00:00:00Z synthetic PG fixture ready\\n');process.stderr.write('2026-10-24T00:00:00Z synthetic PG fixture notice\\n')`],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const receipt = await capture.captureChild(child, { role: 'pg', source: 'pg-console',
    phase: 'work', deadline: Date.now() + 15000, canaries });
  assert.equal(receipt.complete, true);
  const started = Date.now();
  assert.ok(history.commandTimeout(started - 1, started + 1000, true, 30000) <= 1000);
  assert.throws(() => history.commandTimeout(started - 1, started + 1000, false, 30000),
    error => error.code === 'LIFECYCLE_DEADLINE');
});
test('first safe SQL/native cause retains finite code, never exception message or parameters', () => {
  const g = load();
  const safe = g.failure(Object.assign(Error(canaries[0].value), {
    code: '23505', detail: canaries[0].value, query: canaries[0].value }), 'insert');
  assert.equal(safe.sqlState, '23505');
  assert.equal(safe.stage, 'insert');
  assert.ok(!JSON.stringify(safe).includes(canaries[0].value));
  assert.equal(g.failure({ code: canaries[0].value }, 'insert').sqlState, null);
  assert.equal(privacy.lifecycleFailure({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
    { operation: 'capture', role: 'pg', stage: 'docker-command', phase: 'work', command: 'logs' }).category,
  'output-limit');
});
test('unchecked privacy metadata cannot recursively reject the minimal failure receipt', () => {
  const safe = load().failure({ code: 'DIAGNOSTIC_PRIVACY',
    safeDetails: { reason: canaries[0].value, source: 'tool-console' } }, 'insert');
  assert.equal(safe.privacy.reason, 'privacy-metadata-invalid');
  assert.ok(!JSON.stringify(safe).includes(canaries[0].value));
  const valid = load().failure({ code: 'DIAGNOSTIC_PRIVACY', safeDetails: {
    reason: 'generated-credential-detected', source: 'pg-console',
    credentialKind: 'postgres-admin-password' } }, 'cleanup');
  assert.equal(valid.privacy.source, 'pg-console');
  assert.equal(valid.privacy.credentialKind, 'postgres-admin-password');
});
test('disk and frozen-copy tampering rejects before allocation or experimental writes', () => {
  const g = load(), dir = path.resolve(__dirname, '../../test-results/gin-counterfactual-source-20261024',
    `hash-${require('node:crypto').randomUUID()}`), relative = path.join('scripts', 'performance', 'membership-gin.cjs');
  const file = path.join(dir, 'frozen-inputs', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = fs.readFileSync(modulePath);
  fs.writeFileSync(file, original);
  g.verifyFrozen(dir, { [relative]: g.hash(original) });
  fs.appendFileSync(file, '\n// tampered synthetic frozen copy\n');
  assert.throws(() => g.verifyFrozen(dir, { [relative]: g.hash(original) }),
    /Frozen input disk\/copy identity/);
});
test('exact ownership refuses nonowned IDs and finalization preserves capture failure', async () => {
  const id = 'a'.repeat(64);
  assert.throws(() => history.requireOwnedContainer({ id, labels: {} }, id, 'gin', 'run'),
    error => error.code === 'LIFECYCLE_OWNER');
  const final = await history.finalizeOwned([id], {
    capture: async () => { throw { code: 'CAPTURE_INCOMPLETE' }; },
    remove: async () => {}, verify: async () => true, role: () => 'pg',
  });
  assert.equal(final.rows[0].capture, false);
  assert.equal(final.rows[0].removed, true);
  assert.equal(final.failures[0].category, 'incomplete-output');
});
test('canonical replay preserves all thirty source migrations including single-statement concurrent indexes', () => {
  const migrations = load().migrations();
  assert.equal(migrations.length, 30);
  assert.equal(migrations.filter(row => /\bCREATE INDEX CONCURRENTLY\b/.test(row.sql)).length, 3);
  assert.ok(migrations.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
});
test('actual bounded Node preflight: exclusive intent survives bad metadata, normal dispatch and allocation forbidden',
  { timeout: 30000 }, async () => {
    const cp = require('node:child_process'), util = require('node:util');
    const dir = path.resolve(__dirname, '../../test-results/gin-counterfactual-source-20261024',
      `child-${require('node:crypto').randomUUID()}`);
    const runner = path.resolve(__dirname, '../performance/run-membership-gin.cjs');
    const code = `
      const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
      const cp=require('child_process'),util=require('util');
      const file=${JSON.stringify(runner)},dir=${JSON.stringify(dir)},calls=[];
      const actualRequire=require('module').createRequire(file);
      const fake=function(){throw Error('No raw native dispatch')};
      fake[util.promisify.custom]=async function(command,args){
        calls.push({command,operation:args[2]??args[0]});
        const stdout=command==='docker'?'{"id":"invalid"}':command==='pwsh'?'[]':'';
        return util.promisify(cp.execFile)(process.execPath,['-e','process.stdout.write('+JSON.stringify(stdout)+')'],
          {timeout:5000,windowsHide:true});
      };
      const shadow={...process,env:{...process.env,NODE_TEST_CONTEXT:undefined,NODE_OPTIONS:undefined}};
      const mod={exports:{}},req=name=>name==='node:child_process'?{...cp,execFile:fake}:actualRequire(name);
      req.cache=actualRequire.cache;
      vm.runInNewContext('(function(require,module,exports,__dirname,__filename,process){'+fs.readFileSync(file,'utf8')+'\\n})',
        {console,Buffer,setTimeout,clearTimeout})(req,mod,mod.exports,path.dirname(file),file,shadow);
      (async()=>{
        await assert.rejects(mod.exports.main([]),/Explicit disposable URL GIN opt-in/);
        assert.equal(calls.length,0);
        const result=await mod.exports.main(['--disposable-url-gin-only',dir]);
        assert.equal(result.status,'INVALID');
        assert.equal(result.failures[0].action.category,'assertion');
        assert.ok(fs.existsSync(path.join(dir,'intent.json')));
        assert.ok(!fs.existsSync(path.join(dir,'manifest.json')));
        const intent=JSON.parse(fs.readFileSync(path.join(dir,'intent.json')));
        assert.equal(intent.wallMs,900000);assert.equal(intent.cleanupMs,120000);
        assert.equal(intent.postgres,actualRequire('./membership-gin.cjs').policy.postgres);
        assert.ok(Object.keys(intent.sourceHashes).some(f=>f.endsWith('run-membership-gin.cjs')));
        assert.equal(result.trials.length,0);
        assert.ok(calls.every(c=>c.command!=='docker'||!['create','run','start','network'].includes(c.operation)));
        assert.ok(!JSON.stringify(result).includes('password='));
        process.stdout.write(JSON.stringify({intent:true,invalid:true,allocations:0,realDockerDispatches:0}));
      })().catch(()=>{process.stderr.write('Bounded preregistration fixture assertion failed');process.exitCode=1});
    `;
    const result = await util.promisify(cp.execFile)(process.execPath, ['-e', code], {
      windowsHide: true, timeout: 25000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: undefined },
    });
    assert.deepEqual(JSON.parse(result.stdout), { intent: true, invalid: true, allocations: 0, realDockerDispatches: 0 });
  });
test('actual allocated-entry failure captures before removal; safety recovery follows failed normal cleanup only',
    { timeout: 30000 }, async () => {
      const cp = require('node:child_process'), util = require('node:util');
      for (const oom of [false, true]) {
      const dir = path.resolve(__dirname, '../../test-results/gin-counterfactual-source-20261024',
        `cleanup-child-${require('node:crypto').randomUUID()}`);
      const runner = path.resolve(__dirname, '../performance/run-membership-gin.cjs');
      const code = `
        const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
        const cp=require('child_process'),util=require('util');
        const file=${JSON.stringify(runner)},dir=${JSON.stringify(dir)},events=[];
        const actualRequire=require('module').createRequire(file);
        const id='a'.repeat(64),net='b'.repeat(64),image='sha256:'+'c'.repeat(64);
        const shared=Array.from({length:8},(_,i)=>({id:String(i+1).repeat(64),state:i<3?'running':'exited'}));
        let live=false,network=false,failedSchema=false;const oom=${oom};
        const labels=()=>{const intent=JSON.parse(fs.readFileSync(path.join(dir,'intent.json')));
          return {'scimserver.owner':intent.family,'scimserver.run':intent.run}};
        const fake=function(){throw Error('No raw native dispatch')};
        fake[util.promisify.custom]=async function(command,args){
          let stdout='';
          if(command==='docker'){
            const a=args.slice(2),op=a[0];events.push(op);
            if(op==='image')stdout=JSON.stringify({id:image,digests:[actualRequire('./membership-gin.cjs').policy.postgres],os:'linux',architecture:'amd64'});
            else if(op==='ps')stdout=(a.includes('--filter')?(live?[{id,state:'running'}]:[]):[...shared,...(live?[{id,state:'running'}]:[])])
              .map(r=>r.id+' '+r.state).sort().join('\\n');
            else if(op==='network'){
              if(a[1]==='create'){network=true;stdout=net}
              else if(a[1]==='ls')stdout=network?net:'';
              else if(a[1]==='inspect')stdout=JSON.stringify({id:net,labels:labels()});
              else if(a[1]==='rm'){network=false;stdout=net}
              else throw Error('Unexpected fake network operation');
            }else if(op==='create'){live=true;stdout=id}
            else if(op==='inspect'){
              assert.ok(live,'Capture/remove verification must precede removal');
              stdout=[id,image,labels(),oom&&failedSchema,1000000000,1073741824].map(JSON.stringify).join('|');
            }else if(op==='port')stdout='127.0.0.1:12345';
            else if(op==='start'||op==='exec')stdout=id;
            else if(op==='rm'){live=false;stdout=id}
            else throw Error('Unexpected fake native operation');
          }else if(command==='pwsh')stdout='[]';
          else assert.equal(command,'git');
          return util.promisify(cp.execFile)(process.execPath,['-e','process.stdout.write('+JSON.stringify(stdout)+')'],
            {timeout:5000,windowsHide:true});
        };
        const fakeSpawn=(command,args,options)=>{
          assert.equal(command,'docker');assert.equal(args[2],'logs');assert.ok(live);
          events.push('capture');
          return cp.spawn(process.execPath,['-e',"process.stdout.write('2026-10-24T00:00:00Z fixture PG ready\\\\n');process.stderr.write('2026-10-24T00:00:00Z fixture PG notice\\\\n')"],options);
        };
        class Client{
          on(){} async connect(){} async end(){}
          async query(){failedSchema=true;throw Object.assign(Error('synthetic schema failure'),{code:'42P01'})}
        }
        const shadow={...process,env:{...process.env,NODE_TEST_CONTEXT:undefined,NODE_OPTIONS:undefined}};
        const mod={exports:{}},req=name=>name==='node:child_process'?{...cp,execFile:fake,spawn:fakeSpawn}:
          name==='../../api/node_modules/pg'?{Client}:actualRequire(name);
        req.cache=actualRequire.cache;
        vm.runInNewContext('(function(require,module,exports,__dirname,__filename,process){'+fs.readFileSync(file,'utf8')+'\\n})',
          {console,Buffer,setTimeout,clearTimeout})(req,mod,mod.exports,path.dirname(file),file,shadow);
        (async()=>{
          const result=await mod.exports.main(['--disposable-url-gin-only',dir]);
          assert.equal(result.status,'INVALID');assert.equal(result.failures[0].sqlState,'42P01');
          assert.equal(result.safetyRecovery,undefined,'Normal cleanup must precede recovery decision');
          assert.equal(result.captures.length,oom?0:1);
          if(!oom){assert.equal(result.captures[0].complete,true);assert.ok(events.indexOf('capture')<events.indexOf('rm'))}
          else assert.ok(!events.includes('capture'));
          assert.deepEqual(JSON.parse(JSON.stringify(result.cleanup.rows)).map(r=>[r.capture,r.removed,r.verified]),[[!oom,true,true]]);
          assert.equal(result.independentOwnedAbsence,true);assert.equal(result.networkAbsent,true);
          assert.equal(live,false);assert.equal(network,false);
          process.stdout.write(JSON.stringify({normalCleanup:true,captureBeforeRemoval:true,realDockerDispatches:0}));
        })().catch(e=>{process.stderr.write(e.message);process.exitCode=1});
      `;
      const result = await util.promisify(cp.execFile)(process.execPath, ['-e', code], {
        windowsHide: true, timeout: 25000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: undefined },
      });
      assert.deepEqual(JSON.parse(result.stdout),
        { normalCleanup: true, captureBeforeRemoval: true, realDockerDispatches: 0 });
      }
    });
