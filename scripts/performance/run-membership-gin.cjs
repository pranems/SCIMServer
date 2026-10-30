const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { Client } = require('../../api/node_modules/pg');
const pgPackage = require('../../api/node_modules/pg/package.json');
const g = require('./membership-gin.cjs');
const privacy = require('./membership-privacy.cjs');
const consoleCapture = require('./membership-console.cjs');
const h = require('./membership-history.cjs');
const root = path.resolve(__dirname, '../..');
const exec = promisify(execFile);
const clock = () => process.hrtime.bigint();
const elapsed = start => Number(clock() - start) / 1e6;
const idPattern = /^[a-f0-9]{64}$/;
const quote = name => { assert.match(name, /^[a-zA-Z0-9_]+$/); return `"${name}"`; };

async function main(args = process.argv.slice(2)) {
  g.optIn(args);
  assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_TEST_CONTEXT && !process.env.PGOPTIONS,
    'Unmodified diagnostic client context');
  const directory = path.resolve(args[1]);
  assert.ok(directory.startsWith(path.join(root, 'test-results') + path.sep), 'Owned evidence directory');
  fs.mkdirSync(directory);
  const started = Date.now(), deadline = started + g.policy.wallMs;
  const workDeadline = deadline - g.policy.cleanupMs;
  const run = crypto.randomUUID().replaceAll('-', ''), owner = g.policy.family;
  const name = `scim-gin-${run.slice(0, 12)}`, network = `${name}-net`;
  const password = crypto.randomBytes(32).toString('hex');
  const canaries = privacy.credentialCanaries({ POSTGRES_PASSWORD: password });
  const env = { ...process.env, POSTGRES_PASSWORD: password };
  const resources = [], removed = new Set();
  const report = { family: owner, diagnosticOnly: true, admissionEligible: false, run,
    status: 'INCOMPLETE', startedAtUtc: new Date(started).toISOString(),
    deadlineUtc: new Date(deadline).toISOString(), trials: [], actions: [], failures: [], captures: [] };
  const write = (file, row) => fs.writeFileSync(path.join(directory, file),
    privacy.encodeSafeJson(row, canaries), { flag: 'wx' });
  let stage = 'preflight', admin, networkCreated = false, allocationBegan = false, tool = '';
  let recoveryDeadline;
  const check = () => h.commandTimeout(workDeadline, deadline, false, g.policy.nativeWorkMs);
  function appendTool(value) {
    assert.ok(Buffer.byteLength(tool) + Buffer.byteLength(value) <= consoleCapture.limits.toolBytes,
      'Fixed tool-console bound');
    privacy.assertCanariesAbsent([{ source: 'tool-console', text: tool.slice(-255) + value }], canaries);
    tool += value;
  }
  async function native(file, argv, cleanup = false) {
    const at = Date.now(), command = file === 'docker' ? h.dockerOperation(argv)
      : file === 'git' ? 'git' : 'other';
    try {
      const result = await exec(file, file === 'docker' ? ['--context', 'desktop-linux', ...argv] : argv,
        { cwd: root, env, windowsHide: true, maxBuffer: consoleCapture.limits.toolBytes,
          timeout: h.commandTimeout(workDeadline, recoveryDeadline ?? deadline, cleanup,
            cleanup ? g.policy.nativeCleanupMs : g.policy.nativeWorkMs) });
      appendTool(result.stdout + result.stderr);
      report.actions.push({ command, phase: cleanup ? 'cleanup' : 'work', durationMs: Date.now() - at,
        exitCode: 0 });
      return result.stdout.trim();
    } catch (error) {
      const safe = privacy.lifecycleFailure(error, { operation: 'command', role: 'pg',
        stage: 'native-command', phase: cleanup ? 'cleanup' : 'work', command,
        durationMs: Date.now() - at });
      report.actions.push(safe);
      try {
        privacy.assertCanariesAbsent([{ source: 'tool-console',
          text: String(error.stdout ?? '') + String(error.stderr ?? '') }], canaries);
      } catch (validation) { validation.actionFailure = safe; throw validation; }
      const withheld = Error('Owned native operation failed; private output withheld');
      withheld.actionFailure = safe;
      const details = g.failure(error, stage).privacy;
      if (details) withheld.safeDetails = details;
      throw withheld;
    }
  }
  const docker = (argv, cleanup = false) => native('docker', argv, cleanup);
  const labels = ['--label', `scimserver.owner=${owner}`, '--label', `scimserver.run=${run}`];
  async function inventory(cleanup = false, owned = false) {
    const text = await docker(['ps', '-a', '--no-trunc', ...(owned
      ? ['--filter', `label=scimserver.owner=${owner}`, '--filter', `label=scimserver.run=${run}`] : []),
    '--format', '{{.ID}} {{.State}}'], cleanup);
    return text ? text.split(/\r?\n/).map(line => {
      const [id, state] = line.split(' '); assert.match(id, idPattern);
      assert.ok(['running', 'exited', 'created', 'dead', 'restarting', 'paused', 'removing'].includes(state));
      return { id, state };
    }).sort((a, b) => a.id.localeCompare(b.id)) : [];
  }
  function verifyPgResources() {
    assert.equal(report.actualPgResources.oomKilled, false, 'Owned PG must not OOM');
    assert.equal(report.actualPgResources.nanoCpus, 1000000000);
    assert.equal(report.actualPgResources.memoryBytes, 1073741824);
  }
  async function inspect(id, cleanup = false) {
    assert.match(id, idPattern);
    const values = (await docker(['inspect', '--format',
      '{{json .Id}}|{{json .Image}}|{{json .Config.Labels}}|{{json .State.OOMKilled}}|{{json .HostConfig.NanoCpus}}|{{json .HostConfig.Memory}}', id], cleanup))
      .split('|').map(value => JSON.parse(value));
    const row = h.requireOwnedContainer({ id: values[0], labels: values[2] }, id, owner, run);
    assert.equal(values[1], report.image.id);
    report.actualPgResources = { nanoCpus: values[4], memoryBytes: values[5], oomKilled: values[3] };
    if (!cleanup) verifyPgResources();
    return row;
  }
  async function query(text, values = [], cleanup = false) {
    return admin.query({ text, values, query_timeout: h.commandTimeout(workDeadline, deadline,
      cleanup, cleanup ? 30000 : 60000) });
  }
  async function explain(text, values = []) {
    const start = clock(), startUtc = new Date().toISOString();
    const result = await query(`EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON, TIMING OFF) ${text}`, values);
    const row = { ...g.metrics(result.rows[0]['QUERY PLAN']), clientElapsedMs: elapsed(start),
      startUtc, endUtc: new Date().toISOString() };
    privacy.assertCanariesAbsent([{ source: 'collector-snapshot', text: JSON.stringify(row) }], canaries);
    return row;
  }
  async function checkpointState() {
    return (await query(`SELECT checkpoint_lsn::text, checkpoint_time::text,
      (SELECT to_jsonb(s) FROM pg_stat_checkpointer s) AS counters
      FROM pg_control_checkpoint()`)).rows[0];
  }
  async function capture(id) {
    await inspect(id, true);
    verifyPgResources();
    const child = spawn('docker', ['--context', 'desktop-linux', 'logs', '--timestamps', id],
      { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let receipt;
    try {
      receipt = await consoleCapture.captureChild(child, { role: 'pg', source: 'pg-console',
        phase: 'cleanup', canaries, deadline: Date.now() +
          h.commandTimeout(workDeadline, deadline, true, g.policy.nativeCleanupMs) });
    } catch (error) { report.failures.push(g.failure(error, 'cleanup')); throw error; }
    consoleCapture.requireCapture(receipt, { role: 'pg', source: 'pg-console', canaries });
    report.captures.push(receipt);
  }
  try {
    assert.equal(pgPackage.version, '8.22.0');
    const sourceCommit = await h.sourceTip(root);
    assert.equal(await native('git', ['status', '--porcelain']), '', 'Clean committed source required');
    const rows = g.dataset(), columns = Object.keys(rows[0]), migrations = g.migrations();
    g.verifyColumns(columns);
    const inputs = [...new Set([...Object.keys(require.cache).filter(file =>
      file.startsWith(root + path.sep) && (file.includes(`${path.sep}scripts${path.sep}performance${path.sep}`) ||
        file.includes(`${path.sep}api${path.sep}node_modules${path.sep}`))),
    __filename, path.join(root, 'api', 'prisma', 'schema.prisma'), ...migrations.map(row => row.file)])].sort();
    const sourceHashes = Object.fromEntries(inputs.map(file =>
      [path.relative(root, file), g.hash(fs.readFileSync(file))]));
    const intent = { ...g.policy, sourceCommit, sourceHashes, run,
      startedAtUtc: report.startedAtUtc, deadlineUtc: report.deadlineUtc,
      hypothesis: 'ONLY omit the URL trigram GIN from equivalent fresh current-schema clones; compare insertion plus complete pending-list drain and read guards',
      datasetHash: g.hash(rows), clientVersion: process.version, pgClient: pgPackage.version,
      clientExecutableHash: g.hash(fs.readFileSync(process.execPath)),
      credentialKinds: canaries.map(row => row.kind), captureLimits: consoleCapture.limits,
      migrations: migrations.map(row => ({ file: path.relative(root, row.file), sha256: row.sha256 })),
      noApplicationProcesses: true, noReleaseBaselineOrAdmission: true };
    write('intent.json', intent);
    for (const [file, expected] of Object.entries(sourceHashes)) {
      const target = path.join(directory, 'frozen-inputs', file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
      assert.equal(g.hash(fs.readFileSync(target)), expected);
    }
    const image = JSON.parse(await docker(['image', 'inspect', '--format',
      '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}}}',
      g.policy.postgres]));
    assert.match(image.id, /^sha256:[a-f0-9]{64}$/);
    assert.ok(image.digests.includes(g.policy.postgres), 'Pinned cached PG digest required');
    assert.equal(image.os, 'linux'); assert.equal(image.architecture, 'amd64');
    report.image = image;
    report.before = await inventory();
    assert.equal(report.before.length, 8, 'Expected eight unrelated shared containers');
    assert.equal(report.before.filter(row => row.state === 'running').length, 3);
    const priorOwned = await docker(['ps', '-a', '--filter', 'label=scimserver.owner', '--format',
      '{{.ID}} {{.State}}']);
    assert.equal(priorOwned, '', 'No concurrent owned diagnostic containers');
    const heavy = JSON.parse(await native('pwsh', ['-NoProfile', '-Command',
      `$rows=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.ProcessId -ne ${process.pid} -and $_.CommandLine -match 'run-membership(?:-[a-z-]+)?\\.cjs' } | ForEach-Object { $_.ProcessId }); ConvertTo-Json -InputObject $rows -Compress`]));
    assert.deepEqual(heavy, [], 'No concurrent diagnostic Node processes');
    write('manifest.json', { ...intent, image, unrelatedContainers: report.before, ownedHeavyProcesses: heavy,
      pgResources: { cpus: 1, memoryBytes: 1073741824, tmpfsData: true },
      readGuards: ['present-url', 'absent-url', 'endpoint-timeline', 'activity-summary'],
      fullyResolvedBeforeAllocation: true });
    g.verifyFrozen(directory, sourceHashes);
    assert.ok(fs.existsSync(path.join(directory, 'manifest.json')), 'Resolved manifest before allocation');
    allocationBegan = true;
    await docker(['network', 'create', ...labels, network]); networkCreated = true;
    const id = await docker(['create', '--name', name, ...labels, '--network', network,
      '--pull', 'never', '--publish', '127.0.0.1::5432', '--cpus', '1', '--memory', '1g',
      '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data', '--env', 'POSTGRES_PASSWORD',
      '--env', 'POSTGRES_USER=scim', '--env', 'POSTGRES_DB=postgres', image.id,
      ...Object.entries(g.policy.settings).flatMap(([key, value]) => ['-c', `${key}=${value}`])]);
    assert.match(id, idPattern); resources.push(id); await inspect(id);
    await docker(['start', id]);
    const port = await docker(['port', id, '5432/tcp']);
    assert.match(port, /^127\.0\.0\.1:\d+$/);
    stage = 'readiness'; report.readiness = [];
    for (let attempt = 0; attempt < g.policy.readinessProbes; attempt++) {
      check();
      try { await docker(['exec', id, 'pg_isready', '-U', 'scim', '-d', 'postgres', '-t', '2']); }
      catch (error) {
        assert.ok([1, 2].includes(error.actionFailure?.exitCode), 'Only explicit PG not-ready is retryable');
        report.readiness.push({ attempt, ready: false, failure: g.failure(error, 'readiness') });
        continue;
      }
      admin = new Client({ host: '127.0.0.1', port: Number(port.split(':')[1]), user: 'scim',
        database: 'postgres', password, connectionTimeoutMillis: 3000,
        statement_timeout: 60000, application_name: owner, ssl: false });
      admin.on('error', error => { report.connectionFailure ??= g.failure(error, stage); });
      await admin.connect(); report.readiness.push({ attempt, ready: true }); break;
    }
    assert.ok(admin, 'Owned PG readiness required');
    stage = 'schema';
    for (const migration of migrations) await query(migration.sql);
    await query('CREATE EXTENSION pgstattuple');
    const canonical = await g.catalog(admin, 'public');
    g.verifyColumns(canonical.columns.map(row => row.name));
    assert.equal(canonical.indexes.length, 11, 'Current PK and ten secondary indexes');
    assert.ok(canonical.indexes.includes('gin (url gin_trgm_ops)'), 'Canonical default fastupdate GIN');
    assert.deepEqual(canonical.triggers, [], 'No synthetic-fixture trigger side effects');
    const settings = (await query(`SELECT name,setting,unit FROM pg_settings WHERE name IN
      ('server_version','autovacuum','checkpoint_timeout','max_wal_size','full_page_writes',
       'synchronous_commit','fsync','jit','gin_pending_list_limit','shared_buffers','work_mem',
       'max_connections','block_size','wal_segment_size','timezone','log_statement','log_min_error_statement',
       'enable_seqscan','enable_indexscan','enable_indexonlyscan','enable_bitmapscan')
      ORDER BY name`)).rows;
    const settingMap = Object.fromEntries(settings.map(row => [row.name, row.setting]));
    assert.match(settingMap.server_version, /^17\.11/);
    for (const [key, expected] of Object.entries({ autovacuum: 'off', checkpoint_timeout: '3600',
      max_wal_size: '1024', full_page_writes: 'on', synchronous_commit: 'on',
      fsync: 'on', jit: 'on', gin_pending_list_limit: '4096', log_statement: 'none',
      log_min_error_statement: 'panic', enable_seqscan: 'on', enable_indexscan: 'on',
      enable_indexonlyscan: 'on', enable_bitmapscan: 'on' }))
      assert.equal(settingMap[key], expected, 'Preregistered actual PG policy');
    write('runtime-manifest.json', { sourceCommit, sourceHashes, image, canonical, settings,
      schemaHash: g.hash(canonical), datasetHash: intent.datasetHash,
      postmasterStartedAt: (await query('SELECT pg_postmaster_start_time()::text AS started')).rows[0].started,
      beforeExperimentalWrites: true });
    g.verifyFrozen(directory, sourceHashes);
    let expectedRowHash, expectedReads;
    for (const [trial, condition] of [...g.policy.orders.join('')].entries()) {
      check(); stage = 'catalog';
      const trialStart = clock(), schema = `trial_${trial}`, table = `"${schema}"."RequestLog"`;
      const row = { trial, block: trial < 4 ? 'BAAB' : 'ABBA', condition, batches: [], reads: [],
        complete: false }; report.trials.push(row);
      await query(`CREATE SCHEMA "${schema}"; CREATE TABLE ${table} (LIKE public."RequestLog" INCLUDING ALL)`);
      if (canonical.options.length) {
        for (const option of canonical.options) assert.match(option, /^autovacuum_[a-z_]+=\d+(?:\.\d+)?$/);
        await query(`ALTER TABLE ${table} SET (${canonical.options.join(',')})`);
      }
      assert.deepEqual(await g.catalog(admin, schema), canonical, 'Fresh clone equals canonical semantics');
      const gin = (await query(`SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_am a ON a.oid=c.relam WHERE i.indrelid=$1::regclass AND a.amname='gin'`, [table])).rows;
      assert.equal(gin.length, 1);
      const ginIndex = `"${schema}".${quote(gin[0].relname)}`;
      if (condition === 'B') await query(`DROP INDEX ${ginIndex}`);
      row.catalog = await g.catalog(admin, schema);
      g.verifyCatalogs(canonical, condition === 'B' ? row.catalog : {
        ...row.catalog, indexes: row.catalog.indexes.filter(index => !/\bgin \(url gin_trgm_ops\)/.test(index)) });
      row.emptyCount = Number((await query(`SELECT count(*) FROM ${table}`)).rows[0].count);
      assert.equal(row.emptyCount, 0);
      const pending = async () => (await query('SELECT * FROM pgstatginindex($1::regclass)', [ginIndex])).rows[0];
      if (condition === 'A') {
        row.pendingInitially = await pending();
        assert.equal(Number(row.pendingInitially.pending_pages), 0);
        assert.equal(Number(row.pendingInitially.pending_tuples), 0);
      }
      await query('CHECKPOINT');
      row.checkpointBefore = await checkpointState();
      stage = 'insert'; row.insertStartUtc = new Date().toISOString();
      for (let batch = 0; batch < g.policy.batches; batch++) {
        const values = [], placeholders = rows.slice(batch * 50, (batch + 1) * 50).map(item =>
          '(' + columns.map(key => { values.push(item[key]); return `$${values.length}`; }).join(',') + ')');
        const measured = await explain(`INSERT INTO ${table} (${columns.map(quote).join(',')})
          VALUES ${placeholders.join(',')} RETURNING "id"`, values);
        assert.equal(measured.actualRows, 50, 'All fifty inserted rows');
        row.batches.push({ batch, ...measured });
      }
      row.insertEndUtc = new Date().toISOString();
      stage = 'drain';
      if (condition === 'A') {
        row.pendingBeforeDrain = await pending();
        row.drain = { applicable: true, ...await explain('SELECT gin_clean_pending_list($1::regclass)', [ginIndex]) };
        row.pendingAfterDrain = await pending();
        assert.equal(Number(row.pendingAfterDrain.pending_pages), 0, 'All GIN pending pages drained');
        assert.equal(Number(row.pendingAfterDrain.pending_tuples), 0, 'All GIN pending tuples drained');
      } else row.drain = { applicable: false, reason: 'URL GIN absent; no deferred GIN work' };
      row.fullCycle = {
        executionMs: row.batches.reduce((sum, batch) => sum + batch.executionMs, 0) +
          (row.drain.applicable ? row.drain.executionMs : 0),
        walBytes: row.batches.reduce((sum, batch) => sum + batch.walBytes, 0) +
          (row.drain.applicable ? row.drain.walBytes : 0),
        clientStatementElapsedMs: row.batches.reduce((sum, batch) => sum + batch.clientElapsedMs, 0) +
          (row.drain.applicable ? row.drain.clientElapsedMs : 0),
        wallMs: Date.now() - Date.parse(row.insertStartUtc),
      };
      row.checkpointAfter = await checkpointState();
      assert.equal(row.checkpointAfter.checkpoint_lsn, row.checkpointBefore.checkpoint_lsn,
        'No checkpoint inside insertion-plus-drain cycle');
      const verified = (await query(`SELECT count(*)::int AS count,
        encode(sha256(convert_to(string_agg(row_to_json(t)::text,E'\\n' ORDER BY id),'UTF8')),'hex') AS hash
        FROM ${table} t`)).rows[0];
      assert.equal(verified.count, 8000); expectedRowHash ??= verified.hash;
      assert.equal(verified.hash, expectedRowHash, 'Identical complete database row values');
      row.rowHash = verified.hash; row.rowCount = verified.count;
      await query(`ANALYZE ${table}`); stage = 'read';
      const reads = [
        ['present-url', `SELECT id FROM ${table} WHERE url ILIKE $1 ORDER BY id`,
          [`%${rows[0].url.split('/').at(-1)}%`]],
        ['absent-url', `SELECT id FROM ${table} WHERE url ILIKE $1 ORDER BY id`, ['%absent-synthetic-group%']],
        ['endpoint-timeline', `SELECT id FROM ${table} WHERE "endpointId"=$1 ORDER BY "createdAt" DESC LIMIT 100`,
          [rows[0].endpointId]],
        ['activity-summary', `SELECT method,url,identifier,status,count(*)::int AS count FROM ${table}
          WHERE "createdAt">=$1 GROUP BY method,url,identifier,status ORDER BY method,url,identifier,status`,
        [rows[0].createdAt]],
      ];
      for (const [kind, sql, parameters] of reads) {
        const evidence = await explain(sql, parameters);
        const result = (await query(sql, parameters)).rows;
        privacy.assertCanariesAbsent([{ source: 'selected-rows', text: JSON.stringify(result) }], canaries);
        row.reads.push({ kind, ...evidence, resultCount: result.length, resultHash: g.hash(result) });
      }
      assert.equal(row.reads[0].resultCount, 4000); assert.equal(row.reads[1].resultCount, 0);
      assert.equal(row.reads[2].resultCount, 100); assert.equal(row.reads[3].resultCount, 4);
      const digests = row.reads.map(r => [r.kind, r.resultCount, r.resultHash]);
      expectedReads ??= digests; assert.deepEqual(digests, expectedReads, 'Identical read-result digests');
      row.complete = true; row.elapsedMsIncludingSetupAndReadGuards = elapsed(trialStart);
      write(`trial-${trial}-${condition}.json`, row);
      await query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    report.status = 'DISPOSABLE-GIN-COUNTERFACTUAL-COMPLETE';
  } catch (error) {
    report.status = 'INVALID'; report.failures.push(g.failure(error, stage));
  } finally {
    stage = 'cleanup';
    if (admin) {
      let timeout;
      try {
        await Promise.race([admin.end(), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Object.assign(Error('Owned client close cap'),
            { code: 'LIFECYCLE_DEADLINE' })), Math.max(1, Math.min(5000, deadline - Date.now())));
        })]);
      } catch (error) {
        admin.connection.stream.destroy();
        report.failures.push(g.failure(error, 'cleanup'));
      }
      finally { clearTimeout(timeout); }
    }
    if (allocationBegan) {
      try {
        for (const row of await inventory(true, true))
          if (!resources.includes(row.id)) resources.push(row.id);
      } catch (error) { report.failures.push(g.failure(error, 'cleanup')); }
      report.cleanup = await h.finalizeOwned(resources, {
        capture, role: () => 'pg',
        remove: async id => { await inspect(id, true); await docker(['rm', '-f', id], true); removed.add(id); },
        verify: async id => { assert.ok(removed.has(id));
          assert.ok(!(await inventory(true)).some(row => row.id === id)); return true; },
      });
      for (const action of report.cleanup.failures ?? [])
        report.failures.push({ stage: 'cleanup', sqlState: null, action });
      try {
        const networks = await docker(['network', 'ls', '--filter', `label=scimserver.owner=${owner}`,
          '--filter', `label=scimserver.run=${run}`, '--no-trunc', '--format', '{{.ID}}'], true);
        if (networks) {
          assert.ok(networkCreated || allocationBegan);
          assert.match(networks, idPattern);
          const metadata = JSON.parse(await docker(['network', 'inspect', '--format',
            '{"id":{{json .Id}},"labels":{{json .Labels}}}', networks], true));
          h.requireOwnedContainer(metadata, networks, owner, run);
          await docker(['network', 'rm', networks], true);
        }
        assert.equal(await docker(['network', 'ls', '--filter', `label=scimserver.run=${run}`,
          '--no-trunc', '--format', '{{.ID}}'], true), '');
        assert.deepEqual(await inventory(true, true), []);
        report.networkAbsent = true;
        report.after = await inventory(true);
        assert.deepEqual(report.after, report.before, 'All eight unrelated identities and states unchanged');
        report.independentOwnedAbsence = true;
      } catch (error) { report.failures.push(g.failure(error, 'cleanup')); }
      if (!report.independentOwnedAbsence || !report.networkAbsent ||
          report.cleanup.rows.some(row => !row.removed || !row.verified)) {
        report.status = 'INVALID';
        report.diagnosticEndedBeforeSafetyRecoveryUtc = new Date().toISOString();
        recoveryDeadline = Date.now() + g.policy.safetyRecoveryMs;
        report.safetyRecovery = { outsideDiagnosticBudget: true, startedAtUtc: new Date().toISOString(),
          deadlineUtc: new Date(recoveryDeadline).toISOString(), failures: [] };
        try {
          const present = await inventory(true, true);
          for (const row of present) {
            await inspect(row.id, true);
            await docker(['rm', '-f', row.id], true);
          }
          const nets = await docker(['network', 'ls', '--filter', `label=scimserver.owner=${owner}`,
            '--filter', `label=scimserver.run=${run}`, '--no-trunc', '--format', '{{.ID}}'], true);
          if (nets) {
            assert.match(nets, idPattern);
            const metadata = JSON.parse(await docker(['network', 'inspect', '--format',
              '{"id":{{json .Id}},"labels":{{json .Labels}}}', nets], true));
            h.requireOwnedContainer(metadata, nets, owner, run);
            await docker(['network', 'rm', nets], true);
          }
          assert.deepEqual(await inventory(true, true), []);
          assert.equal(await docker(['network', 'ls', '--filter', `label=scimserver.run=${run}`,
            '--no-trunc', '--format', '{{.ID}}'], true), '');
          assert.deepEqual(await inventory(true), report.before);
          report.safetyRecovery.verified = true;
        } catch (error) { report.safetyRecovery.failures.push(g.failure(error, 'cleanup')); }
        report.safetyRecovery.finishedAtUtc = new Date().toISOString();
      }
    }
    report.toolConsole = { bytes: Buffer.byteLength(tool), nonempty: tool.length > 0,
      scannedCredentialKinds: canaries.map(row => row.kind) };
    report.finishedAtUtc = new Date().toISOString(); report.elapsedMs = Date.now() - started;
    if (report.failures.length || report.connectionFailure || report.safetyRecovery ||
      report.elapsedMs > g.policy.wallMs ||
      report.trials.length !== 8 || report.trials.some(row => !row.complete) ||
      !report.cleanup?.rows.every(row => row.capture && row.removed && row.verified) ||
      !report.independentOwnedAbsence || !report.networkAbsent || !tool.length) report.status = 'INVALID';
    write('report.json', report);
    process.exitCode = report.status === 'INVALID' ? 1 : 0;
  }
  return report;
}
if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify(g.failure(error, 'preflight')) + '\n'); process.exitCode = 1;
});
module.exports = { main };
