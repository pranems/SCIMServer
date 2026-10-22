const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

const implementation = path.resolve(__dirname, '..', 'performance', 'assess-membership.cjs');

function load() {
  assert.ok(fs.existsSync(implementation), 'The portable comparison evaluator must exist.');
  return require(implementation);
}

function receipts(ratio = 1) {
  return ['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
    role,
    status: 'PASS',
    complete: true,
    version: '0.55.58',
    image: 'same-digest',
    cpuLimit: 0.5,
    memoryLimit: 1073741824,
    warmupIterations: 100,
    requestCount: 4407,
    samples: Object.fromEntries(
      ['add', 'populatedRead', 'remove', 'emptyRead'].map(operation =>
        [operation, Array(1000).fill(role === 'candidate' ? 10 * ratio : 10)]),
    ),
  }));
}

const block = { name: 'aa-baab', sameImage: true, order: 'BAAB' };
const roles = {
  baseline: { image: 'same-digest', version: '0.55.58' },
  candidate: { image: 'same-digest', version: '0.55.58' },
};

test('identical samples pass all twelve comparisons with exactly 2000 samples per role', () => {
  const result = load().assessBlock(receipts(), block, roles);
  assert.equal(result.passed, true);
  assert.equal(result.checks.length, 12);
  assert.ok(result.checks.every(check => check.ratio === 1 && check.samplesPerRole === 2000));
});

test('a tail-only regression is not hidden by passing medians or discarded samples', () => {
  const rows = receipts();
  for (const row of rows.filter(row => row.role === 'candidate')) {
    row.samples.emptyRead.fill(20, 980);
  }
  const result = load().assessBlock(rows, block, roles);
  assert.equal(result.passed, false);
  assert.equal(result.checks.find(check => check.operation === 'emptyRead' && check.percentile === 99).ratio, 2);
  assert.equal(result.checks.find(check => check.operation === 'emptyRead' && check.percentile === 50).ratio, 1);
});

test('A/A requires both directions while A/B preserves the original one-sided ceiling', () => {
  assert.equal(load().assessBlock(receipts(0.8), block, roles).passed, false);
  assert.equal(load().assessBlock(receipts(0.8), { ...block, sameImage: false }, roles).passed, true);
  assert.equal(load().assessBlock(receipts(1.1), block, roles).passed, true);
  assert.equal(load().assessBlock(receipts(1.1001), block, roles).passed, false);
});

test('nearest-rank percentile uses raw unrounded samples', () => {
  const rows = receipts();
  for (const row of rows.filter(row => row.role === 'candidate')) row.samples.add.fill(11.00001);
  const result = load().assessBlock(rows, block, roles);
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].candidateMs, 11.00001);
});

test('incomplete, reordered, nonfinite, wrong-image and changed-quota receipts fail closed', () => {
  const mutations = [
    rows => rows.pop(),
    rows => rows.reverse().splice(0, 2, rows[1], rows[0]),
    rows => rows[0].samples.add.pop(),
    rows => { rows[0].samples.remove[0] = NaN; },
    rows => { rows[0].image = 'different-image'; },
    rows => { rows[0].version = '0.55.20'; },
    rows => { rows[0].cpuLimit = 2; },
    rows => { rows[0].memoryLimit *= 2; },
    rows => { rows[0].warmupIterations = 200; },
    rows => { rows[0].requestCount = 4406; },
    rows => { rows[0].status = 'FAIL'; },
    rows => { rows[0].complete = false; },
  ];
  for (const mutate of mutations) {
    const rows = receipts();
    mutate(rows);
    assert.throws(() => load().assessBlock(rows, block, roles), /AssertionError|receipt|round|sample|identity|quota|warmup|request|role/i);
  }
});

test('unknown order is invalid, not an implicit alternative schedule', () => {
  assert.throws(() => load().assessBlock(receipts(), { ...block, order: 'AAAA' }, roles));
});

test('portable PowerShell runner parses', () => {
  const runner = path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1');
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $issues = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
      '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$issues)
    if ($issues.Count) { $issues | ForEach-Object { Write-Output $_.Message }; exit 1 }
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
});

test('actual orchestration stops at either failed control or comparison, without retries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scim-qualification-contract-'));
  const runner = path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1');
  try {
    for (const failAt of [1, 2, 3, 4, 5]) {
      const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
        $ErrorActionPreference = 'Stop'
        $directory = '${directory.replaceAll("'", "''")}'
        $source = '${runner.replaceAll("'", "''")}'
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$null)
        $loop = $ast.Find({ param($item)
          $item -is [System.Management.Automation.Language.ForEachStatementAst] -and
          $item.Variable.VariablePath.UserPath -eq 'block'
        }, $true)
        if (!$loop) { throw 'Missing actual block orchestration' }
        $protocolPath = Join-Path (Split-Path $source) 'membership-protocol.json'
        $protocol = Get-Content $protocolPath -Raw | ConvertFrom-Json
        $summary = @{ Blocks = @() }
        $summaryPath = Join-Path $directory 'summary.json'
        $evaluator = 'mocked evaluator'
        $script:attempts = @()
        function Invoke-Block { param($Block) $script:attempts += $Block.name; return $directory }
        function Assert-WithinDeadline {}
        function node { $global:LASTEXITCODE = if ($script:attempts.Count -eq ${failAt}) { 1 } else { 0 } }
        try {
          & ([scriptblock]::Create($loop.Extent.Text)) *> $null
          if (${failAt} -le 4) { throw 'Failed block did not stop orchestration' }
        } catch {
          if ($_.Exception.Message -notlike 'Preregistered * limits failed; later blocks not run.') { throw }
        }
        ConvertTo-Json -InputObject @($script:attempts) -Compress
      `], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), ['aa-baab', 'aa-abba', 'ab-baab', 'ab-abba'].slice(0, Math.min(failAt, 4)));
    }
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('preregistered protocol rejects budget and schedule changes', () => {
  const protocol = require('../performance/membership-protocol.json');
  load().validateProtocol(protocol);
  for (const [key, value] of [['cpuLimit', 2], ['samplesPerRound', 200], ['ceilingRatio', 1.2]]) {
    assert.throws(() => load().validateProtocol({ ...protocol, [key]: value }));
  }
  assert.throws(() => load().validateProtocol({ ...protocol, blocks: [...protocol.blocks].reverse() }));
});

for (const scenario of ['success', 'corrupt-read', 'cleanup-failure', 'deadline-expired']) {
  test(`HTTP client retains explicit complete/partial evidence for ${scenario}`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scim-client-contract-'));
    const receiptPath = path.join(directory, 'receipt.json');
    const token = randomUUID();
    let members = [];
    let removed = false;
    let requests = 0;
    let reads = 0;
    const serverErrors = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        requests++;
        try {
          assert.equal(request.headers.authorization, `Bearer ${token}`);
          assert.equal(request.headers['content-type'], 'application/scim+json');
          let result;
          if (request.url === '/scim/admin/version') result = { version: '0.55.58' };
          else if (request.method === 'DELETE') {
            if (scenario === 'cleanup-failure') { response.writeHead(500); response.end(); return; }
            removed = true; result = undefined;
          }
          else if (request.url === '/scim/admin/endpoints') {
            result = request.method === 'POST' ? { id: 'endpoint-1' } : { endpoints: removed ? [] : [{ id: 'endpoint-1' }] };
          } else if (request.method === 'POST') {
            result = { id: request.url.endsWith('/Users') ? 'user-1' : 'group-1' };
          } else if (request.method === 'PATCH') {
            const operation = JSON.parse(body).Operations[0];
            assert.ok(['add', 'remove'].includes(operation.op));
            members = operation.op === 'add' ? [{ value: 'user-1' }] : [];
            result = { id: 'group-1', members };
          } else {
            reads++;
            result = { id: 'group-1', members: scenario === 'corrupt-read' && reads === 205 ? [{ value: 'wrong-user' }] : members };
          }
          response.writeHead(result === undefined ? 204 : 200, { 'Content-Type': 'application/scim+json' });
          response.end(result === undefined ? undefined : JSON.stringify(result));
        } catch (error) {
          serverErrors.push(error);
          response.writeHead(500);
          response.end();
        }
      });
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'performance', 'benchmark-membership.cjs')], {
        env: { ...process.env,
          SCIM_BENCH_BASE_URL: `http://127.0.0.1:${server.address().port}`,
          SCIM_BENCH_TOKEN: token, SCIM_BENCH_VERSION: '0.55.58', SCIM_BENCH_OUTPUT: receiptPath,
          SCIM_BENCH_DEADLINE_UTC: String(Date.now() + (scenario === 'deadline-expired' ? -1000 : 60000)) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let diagnostic = '';
      child.stderr.on('data', chunk => { diagnostic += chunk; });
      const [exitCode] = await once(child, 'close');
      assert.deepEqual(serverErrors, []);
      assert.equal(removed, scenario === 'success' || scenario === 'corrupt-read', 'Exact fixture cleanup outcome');
      assert.equal(exitCode, scenario === 'success' ? 0 : 1, diagnostic);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.equal(receipt.complete, scenario === 'success');
      assert.equal(receipt.status, scenario === 'success' ? 'PASS' : 'FAIL');
      assert.equal(JSON.stringify(receipt).includes(token), false, 'No token in retained evidence');
      assert.equal(diagnostic.includes('wrong-user'), false, 'Do not export raw response/assertion data');
      if (scenario === 'corrupt-read') {
        assert.deepEqual(Object.fromEntries(Object.entries(receipt.samples).map(([key, values]) => [key, values.length])),
          { add: 3, populatedRead: 3, remove: 2, emptyRead: 2 });
        assert.equal(receipt.requestCount, 416);
        assert.equal(receipt.failures[0].stage, 'populatedRead');
        assert.equal(receipt.cleanup.verified, true);
      } else if (scenario === 'deadline-expired') {
        assert.equal(requests, 0, 'Expired work deadline must prevent transport');
        assert.ok(Object.values(receipt.samples).every(values => values.length === 0));
        assert.equal(receipt.failures[0].kind, 'DEADLINE');
      } else if (scenario === 'cleanup-failure') {
        assert.ok(Object.values(receipt.samples).every(values => values.length === 1000));
        assert.equal(receipt.cleanup.verified, false);
        assert.equal(receipt.failures[0].stage, 'cleanup');
      } else {
        assert.equal(requests, 4407);
        assert.equal(receipt.requestCount, 4407);
        assert.equal(receipt.warmupIterations, 100);
        assert.ok(Object.values(receipt.samples).every(values =>
          values.length === 1000 && values.every(value => Number.isFinite(value) && value > 0)));
      }

    } finally {
      await new Promise(resolve => { server.close(resolve); });
      fs.rmSync(directory, { recursive: true });
    }
  });
}

for (const unavailable of [false, true]) {
  test(`actual PostgreSQL readiness loop ${unavailable ? 'stays failed when final TCP listener never appears' : 'ignores socket-only initialization until final TCP readiness'}`, () => {
    const runner = path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1');
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
      $loop = $ast.Find({ param($item)
        $item -is [System.Management.Automation.Language.ForEachStatementAst] -and
        $item.Extent.Text.Contains('pg_isready')
      }, $true)
      if (!$loop) { throw 'Missing actual PostgreSQL readiness loop' }
      $pg = 'mocked owned container'
      $ready = $false
      $script:probes = 0
      $script:allTcp = $true
      function docker {
        $script:probes++
        $tcp = $args -contains '--host=127.0.0.1'
        $script:allTcp = $script:allTcp -and $tcp
        $global:LASTEXITCODE = if (!$tcp) { 0 } elseif ($${unavailable} -or $script:probes -lt 3) { 1 } else { 0 }
      }
      function Start-Sleep {}
      function Assert-WithinDeadline {}
      . ([scriptblock]::Create($loop.Extent.Text))
      @{ ready = $ready; probes = $script:probes; allTcp = $script:allTcp } | ConvertTo-Json -Compress
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.equal(actual.allTcp, true, 'Readiness must target TCP, not the temporary initialization socket');
    assert.equal(actual.ready, !unavailable);
    assert.equal(actual.probes, unavailable ? 60 : 3);
  });
}

test('internal work deadline and shorter step cap reserve cleanup/upload before job termination', () => {
  const runner = path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1');
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'performance-qualification.yml'), 'utf8');
  assert.match(workflow, /^    timeout-minutes: 75$/m);
  assert.match(workflow, /^      - name: Run fixed same-image controls before old\/current comparisons\r?\n        timeout-minutes: 65$/m);
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
      '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
    $guard = $ast.Find({ param($item)
      $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Assert-WithinDeadline'
    }, $true)
    if (!$guard) { throw 'Missing actual internal deadline guard' }
    . ([scriptblock]::Create($guard.Extent.Text))
    $campaignClock = @{ Elapsed = [timespan]::FromMinutes(59) }
    Assert-WithinDeadline
    $campaignClock = @{ Elapsed = [timespan]::FromMinutes(60) }
    try { Assert-WithinDeadline; throw 'Expired work budget was accepted' }
    catch { if ($_.Exception.Message -notlike '*work deadline*') { throw } }
    exit 0
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
});

test('actual round orchestration copies a failed client receipt before rejecting it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scim-partial-copy-contract-'));
  const runner = path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1');
  try {
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      $source = '${runner.replaceAll("'", "''")}'
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$null)
      $loop = $ast.Find({ param($item)
        $item -is [System.Management.Automation.Language.ForEachStatementAst] -and
        $item.Variable.VariablePath.UserPath -eq 'role' -and $item.Extent.Text.Contains('$transportExit')
      }, $true)
      if (!$loop) { throw 'Missing actual round orchestration' }
      $directory = '${directory.replaceAll("'", "''")}'
      $apps = @{ candidate = @{ Id = 'owned'; Url = 'http://127.0.0.1' } }
      $roles = @{ candidate = @{ version = '0.55.58' } }
      $protocol = @{ candidate = @{ image = 'pinned fixture' } }
      $clientScript = 'mounted fixture'
      $schedule = @('candidate', 'baseline')
      $containers = [System.Collections.Generic.List[string]]::new()
      $workDeadlineUtc = 1
      $round = 0
      $script:copied = $false
      function Assert-Owned {}
      function Assert-WithinDeadline {}
      function Read-CpuCounters { return @{} }
      function Read-QueryCounters { return @{} }
      function docker { $global:LASTEXITCODE = 1 }
      function Invoke-Docker {
        switch ($args[0]) {
          'create' { return ('a' * 64) }
          'inspect' { return '1' }
          'cp' {
            '{"status":"FAIL","complete":false,"samples":{"add":[12.5]}}' | Set-Content $args[2]
            $script:copied = $true
          }
          default { throw 'Unexpected Docker operation in failed-receipt control' }
        }
      }
      try {
        . ([scriptblock]::Create($loop.Extent.Text))
        throw 'Failed client was admitted'
      } catch {
        if ($_.Exception.Message -ne 'Failed/partial client receipt retained; no admission or later round.') { throw }
      }
      if (!$script:copied -or $round -ne 1) { throw 'Partial receipt lost or later round started' }
      exit 0
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    const partial = JSON.parse(fs.readFileSync(path.join(directory, 'round-1-candidate.json'), 'utf8'));
    assert.deepEqual(partial.samples.add, [12.5]);
    assert.equal(partial.complete, false);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
