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

for (const scenario of [
  'buffered', 'functional-failure', 'flush-failure', 'secret-leak',
  'no-errors', 'missing-request', 'missing-category', 'invalid-row', 'functional-write-failure',
  'split-records', 'json-buffered', 'json-split-records', 'json-unrelated-payload',
]) {
  test(`actual privacy phase drains buffered logs and retains sanitized failure evidence: ${scenario}`, () => {
    const runner = fs.readFileSync(path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1'), 'utf8');
    const start = runner.indexOf("        . (Join-Path $root 'scripts\\live-test-sections\\minimal-group-members.ps1')");
    const end = runner.indexOf('        $workComplete = $true', start);
    assert.ok(start >= 0 && end > start, 'Actual privacy phase must be selected');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scim-privacy-phase-'));
    try {
      const fixture = path.join(directory, 'scripts', 'live-test-sections');
      fs.mkdirSync(fixture, { recursive: true });
      fs.writeFileSync(path.join(fixture, 'minimal-group-members.ps1'), `
        function Invoke-MinimalGroupMembersContract {
          foreach ($index in 1..66) {
            Test-Result -Success (!($scenario -in @('functional-failure', 'functional-write-failure') -and $index -eq 6)) -Message 'Synthetic functional outcome'
          }
        }
      `);
      fs.writeFileSync(path.join(directory, 'phase.ps1'), runner.slice(start, end));
      const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
        $ErrorActionPreference = 'Stop'
        $root = '${directory.replaceAll("'", "''")}'
        $directory = $root
        $scenario = '${scenario}'
        $apps = @{ candidate = @{ Url = 'http://127.0.0.1:12345'; Id = 'owned-candidate' } }
        $pg = 'owned-pg'
        $script:flushed = $false
        foreach ($key in @('POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK')) {
          [Environment]::SetEnvironmentVariable($key, [guid]::NewGuid().ToString('N'))
        }
        $requestId = '12345678-1234-4234-8234-123456789abc'
        function Assert-WithinDeadline {}
        function Start-Sleep {}
        function Set-Content {
          param([Parameter(Position=0)]$Path, [Parameter(ValueFromPipeline)]$Value)
          process {
            if ($scenario -eq 'functional-write-failure' -and $Path.EndsWith('privacy.json')) {
              throw 'Synthetic privacy receipt write failure'
            }
            Microsoft.PowerShell.Management\\Set-Content -Path $Path -Value $Value
          }
        }
        function Invoke-RestMethod {
          param($Uri, $Method, $Headers, $TimeoutSec, $ErrorAction)
          if ($Uri -cne 'http://127.0.0.1:12345/scim/admin/logs/flush' -or $Method -cne 'Post' -or
              $Headers.Authorization -cne ('Bearer ' + $env:SCIM_SHARED_SECRET) -or $TimeoutSec -ne 30) {
            throw 'Unexpected private flush request'
          }
          if ($scenario -eq 'flush-failure') { throw 'Synthetic flush failure' }
          $script:flushed = $true
        }
        function Invoke-Docker {
          if ($args[0] -eq 'exec' -and $args[1] -eq $pg) {
            $rows = @(foreach ($index in 1..200) {
              @{
                requestId = $requestId; endpointId = $requestId
                status = $(if ($index -eq 1 -and $script:flushed -and $scenario -ne 'no-errors') { 400 } else { 200 })
                durationMs = $(if ($scenario -eq 'invalid-row' -and $index -eq 200) { -1 } else { 1 })
                requestHeaders = '{"authorization":"[REDACTED]"}'
              }
            })
            return ConvertTo-Json -InputObject $rows -Depth 5 -Compress
          }
          if ($args[0] -eq 'logs' -and $args[-1] -eq $apps.candidate.Id) {
            $prefix = if ($scenario -eq 'missing-request') { '87654321' } else { '12345678' }
            $category = if ($scenario -eq 'missing-category') { 'other' } else { 'scim.group' }
            if ($scenario -eq 'secret-leak') { return $env:JWT_SECRET }
            if ($scenario -eq 'split-records') {
              return @("12:00:00.000 WARN other [$prefix] negative", '12:00:00.001 INFO scim.group [87654321] unrelated') -join [Environment]::NewLine
            }
            if ($scenario.StartsWith('json-')) {
              $record = [ordered]@{ timestamp = '2026-10-22T12:00:00.000Z'; category = $category; requestId = $requestId }
              if ($scenario -eq 'json-unrelated-payload') { $record.category = 'other'; $record.data = @{ category = 'scim.group' } }
              if ($scenario -eq 'json-split-records') {
                $record.category = 'other'
                return @(
                  (ConvertTo-Json -InputObject $record -Compress),
                  '{"timestamp":"2026-10-22T12:00:00.001Z","category":"scim.group","requestId":"87654321-1234-4234-8234-123456789abc"}'
                ) -join [Environment]::NewLine
              }
              return ConvertTo-Json -InputObject $record -Depth 4 -Compress
            }
            return "12:00:00.000 WARN $category [$prefix] synthetic"
          }
          throw 'Unexpected private log operation'
        }
        $failure = $null
        try { . (Join-Path $root 'phase.ps1') } catch { $failure = $_.Exception.Message }
        $apps.Clear()
        $pg = $null
        if ($scenario -eq 'functional-write-failure') {
          if ($failure -cne 'Private runtime contract failed: Synthetic functional outcome') {
            throw 'Privacy receipt write failure replaced primary functional error'
          }
          exit 0
        }
        $success = $scenario -in @('buffered', 'json-buffered')
        if ($success -ne ($null -eq $failure)) { throw "Wrong privacy phase outcome: $failure" }
        $json = Get-Content (Join-Path $directory 'privacy.json') -Raw
        $receipt = $json | ConvertFrom-Json
        foreach ($key in @('POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK')) {
          if ($json.Contains([Environment]::GetEnvironmentVariable($key))) { throw 'Credential reached privacy receipt' }
        }
        $allowed = @('status', 'complete', 'passed', 'failureStage', 'contractAssertions', 'checkedRows',
          'validatedRows', 'rawLogsExported', 'correlation')
        foreach ($property in $receipt.PSObject.Properties.Name) {
          if ($property -notin $allowed) { throw 'Undocumented privacy receipt field' }
        }
        foreach ($property in $receipt.correlation.PSObject.Properties.Name) {
          if ($property -notin @('errorRows', 'requestIdPresent', 'categoryPresent', 'sameRecordPresent')) {
            throw 'Undocumented correlation receipt field'
          }
        }
        if ($json.Contains($requestId) -or
            $receipt.rawLogsExported -ne $false) { throw 'Privacy receipt leaked raw evidence' }
        $expectedStage = switch ($scenario) {
          'functional-failure' { 'functional' }
          'flush-failure' { 'log-flush' }
          'secret-leak' { 'secret-scan' }
          'invalid-row' { 'row-contract' }
          'buffered' { $null }
          'json-buffered' { $null }
          default { 'correlation' }
        }
        if ($receipt.failureStage -cne $expectedStage -or
            $receipt.passed -ne $success -or
            $receipt.complete -ne $success) { throw 'Privacy failure stage/completion lost' }
        $expectedAssertions = if ($scenario -eq 'functional-failure') { 5 } else { 66 }
        if ($receipt.contractAssertions -ne $expectedAssertions) { throw 'Completed functional count lost' }
        if ($success -and
            (!$script:flushed -or $receipt.checkedRows -ne 200 -or $receipt.validatedRows -ne 200)) {
          throw 'Buffered negative records were not durably checked'
        }
        if ($scenario -eq 'invalid-row' -and $receipt.validatedRows -ne 199) { throw 'Partial row validation count lost' }
        if ($scenario -in @('split-records', 'json-split-records', 'json-unrelated-payload')) {
          if (!$receipt.correlation.requestIdPresent -or !$receipt.correlation.categoryPresent -or
              $receipt.correlation.sameRecordPresent -ne $false) { throw 'Unrelated console records incorrectly prove negative correlation' }
        }
        if ($scenario -in @('no-errors', 'missing-request', 'missing-category')) {
          if ($receipt.correlation.errorRows -ne $(if ($scenario -eq 'no-errors') { 0 } else { 1 }) -or
              $receipt.correlation.requestIdPresent -ne ($scenario -eq 'missing-category') -or
              $receipt.correlation.categoryPresent -ne ($scenario -ne 'missing-category')) {
            throw 'Independent sanitized correlation predicates lost'
          }
        }
      `], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
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
    rows => { rows[0].diagnosticOnly = true; },
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

test('actual runner selects pinned role identities and orders for both A/A and A/B blocks', () => {
  const runner = path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1');
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    $source = '${runner.replaceAll("'", "''")}'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$null)
    $assignments = foreach ($name in @('baseline', 'roles', 'schedule')) {
      $assignment = $ast.Find({ param($item)
        $item -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $item.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $item.Left.VariablePath.UserPath -eq $name
      }, $true)
      if (!$assignment) { throw "Missing actual $name selection" }
      $assignment.Extent.Text
    }
    $selection = [scriptblock]::Create(($assignments -join "\`n"))
    $protocol = Get-Content (Join-Path (Split-Path $source) 'membership-protocol.json') -Raw | ConvertFrom-Json
    $selections = @(foreach ($Block in $protocol.blocks) {
      . $selection
      @{ name = $Block.name; roles = $roles; schedule = @($schedule) }
    })
    ConvertTo-Json -InputObject $selections -Depth 8 -Compress
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  const selections = JSON.parse(result.stdout);
  const protocol = require('../performance/membership-protocol.json');
  assert.equal(selections.length, 4);
  for (const [index, selection] of selections.entries()) {
    const expectedBlock = protocol.blocks[index];
    assert.equal(selection.name, expectedBlock.name);
    assert.deepEqual(selection.roles, {
      baseline: expectedBlock.sameImage ? protocol.candidate : protocol.baseline,
      candidate: protocol.candidate,
    });
    assert.deepEqual(selection.schedule, expectedBlock.order === 'BAAB' ?
      ['candidate', 'baseline', 'baseline', 'candidate'] : ['baseline', 'candidate', 'candidate', 'baseline']);
    const rows = receipts().map((row, i) => {
      const role = selection.schedule[i];
      return { ...row, role, image: selection.roles[role].image, version: selection.roles[role].version };
    });
    assert.equal(load().assessBlock(rows, expectedBlock, selection.roles).passed, true);
    rows[0].version = 'wrong-version';
    assert.throws(() => load().assessBlock(rows, expectedBlock, selection.roles));
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
  for (const traced of ['success', 'corrupt-read'].includes(scenario) ? [false, true] : [false]) {
  test(`HTTP client retains explicit complete/partial evidence for ${scenario}${traced ? ' with diagnostic trace' : ''}`, async () => {
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
          SCIM_BENCH_TRACE: traced ? '1' : undefined,
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
      if (traced) {
        assert.equal(receipt.diagnosticOnly, true, 'Instrumented data must never become release admission');
        assert.equal(receipt.traceClock, 'process.hrtime.bigint');
        assert.equal(receipt.spans.length, requests);
        assert.equal(receipt.spans.filter(span => span.phase === 'warmup').length, 400);
        assert.equal(receipt.spans.filter(span => span.phase === 'measured').length, scenario === 'success' ? 4000 : 10);
        let previousEnd = 0n;
        for (const [index, span] of receipt.spans.entries()) {
          assert.deepEqual(Object.keys(span).sort(),
            ['requestIndex', 'operation', 'phase', 'cycle', 'startNs', 'endNs', 'ms', 'status', 'succeeded'].sort());
          assert.equal(span.requestIndex, index + 1);
          assert.ok(BigInt(span.startNs) >= previousEnd);
          assert.ok(BigInt(span.endNs) > BigInt(span.startNs));
          assert.ok(Number(BigInt(span.endNs) - BigInt(span.startNs)) / 1e6 >= span.ms - 0.1);
          assert.equal(span.succeeded, true);
          previousEnd = BigInt(span.endNs);
        }
      } else {
        assert.equal(Object.hasOwn(receipt, 'diagnosticOnly'), false);
        assert.equal(Object.hasOwn(receipt, 'spans'), false);
      }
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
      function Read-CpuCounters { return @{ usage_usec = 1234; nr_periods = 3; nr_throttled = 1; throttled_usec = 300 } }
      function Read-QueryCounters { return @{ calls = 2; executionMs = 5 } }
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
    const resource = JSON.parse(fs.readFileSync(path.join(directory, 'round-1-candidate-resources.json'), 'utf8'));
    assert.equal(resource.status, 'FAIL');
    assert.equal(resource.complete, false);
    assert.equal(resource.failureStage, 'client');
    assert.deepEqual(resource.cpuBefore, { usage_usec: 1234, nr_periods: 3, nr_throttled: 1, throttled_usec: 300 });
    assert.deepEqual(resource.databaseBefore, { calls: 2, executionMs: 5 });
    assert.equal(resource.cpuAfter, null);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

for (const scenario of ['success', 'memory-limit', 'rss-limit', 'oom-killed', 'missing-rss',
  'cpu-unavailable', 'oom-unavailable', 'deadline-after-client', 'status-inspection-failure',
  'status-write-failure', 'client-observer-failure', 'resource-write-failure']) {
  test(`actual round preserves resource evidence through owned cleanup for ${scenario}`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scim-resource-receipt-'));
    const runner = path.resolve(__dirname, '..', 'performance', 'run-membership-qualification.ps1');
    try {
      const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
        $ErrorActionPreference = 'Stop'
        $source = '${runner.replaceAll("'", "''")}'
        $directory = '${directory.replaceAll("'", "''")}'
        $scenario = '${scenario}'
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$null)
        $blockFunction = $ast.Find({ param($item)
          $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Invoke-Block'
        }, $true)
        $blockTry = $blockFunction.Body.Find({ param($item)
          $item -is [System.Management.Automation.Language.TryStatementAst]
        }, $true)
        $loop = $blockFunction.Body.Find({ param($item)
          $item -is [System.Management.Automation.Language.ForEachStatementAst] -and
          $item.Variable.VariablePath.UserPath -eq 'role' -and $item.Extent.Text.Contains('$transportExit')
        }, $true)
        if (!$loop -or !$blockTry.Finally) { throw 'Missing actual round/cleanup orchestration' }
        $cleanup = ($blockTry.Finally.Statements | ForEach-Object { $_.Extent.Text }) -join "\`n"
        $appId = 'b' * 64
        $pg = 'c' * 64
        $networkName = 'owned-resource-control'
        $network = $networkName
        $run = 'resource-control'
        $apps = @{ candidate = @{ Id = $appId; Url = 'http://127.0.0.1'; CpuMax = '50000 100000'; ImageId = 'pinned-id' } }
        $roles = @{ candidate = @{ version = '0.55.58'; image = 'pinned-image' } }
        $protocol = @{ candidate = @{ image = 'pinned-client' } }
        $Block = @{ name = 'resource-control' }
        $clientScript = 'mounted fixture'
        $schedule = if ($scenario -eq 'success') { @('candidate') } else { @('candidate', 'baseline') }
        $containers = [System.Collections.Generic.List[string]]::new()
        $containers.Add($pg)
        $containers.Add($appId)
        $rows = [System.Collections.Generic.List[object]]::new()
        $workDeadlineUtc = 1
        $round = 0
        $script:cpuReads = 0
        $script:sqlReads = 0
        $script:deadlineChecks = 0
        $script:removed = @()
        $script:networkRemoved = $false
        function Assert-Owned {
          param($Id, [switch]$Network)
          if ($Id -notin @($appId, $pg, ('a' * 64), $networkName)) { throw 'Unowned fixture operation' }
        }
        function Assert-WithinDeadline {
          $script:deadlineChecks++
          if ($scenario -eq 'deadline-after-client' -and $script:deadlineChecks -eq 2) {
            throw 'Work deadline reached in resource control.'
          }
        }
        function Start-Sleep {}
        function Read-CpuCounters {
          $script:cpuReads++
          if ($scenario -eq 'client-observer-failure') { Set-Variable observer @{ fixture = $true } -Scope 1 }
          if ($scenario -eq 'cpu-unavailable' -and $script:cpuReads -eq 2) { throw 'CPU counters unavailable in resource control.' }
          return @{ usage_usec = $script:cpuReads * 1000; nr_periods = $script:cpuReads * 20; nr_throttled = 1; throttled_usec = 100 }
        }
        function Read-QueryCounters {
          $script:sqlReads++
          return @{ calls = $script:sqlReads * 400; executionMs = $script:sqlReads * 25 }
        }
        function Stop-CpuObserver { throw 'Synthetic observer shutdown failure.' }
        function Set-Content {
          param([Parameter(ValueFromPipeline)]$Value, [Parameter(Position=0)]$Path)
          process {
            if ($scenario -eq 'status-write-failure' -and $Path.EndsWith('-status.json')) {
              throw 'Synthetic client status write failure.'
            }
            if ($scenario -eq 'resource-write-failure' -and $Path.EndsWith('-resources.json')) {
              throw 'Synthetic resource write failure.'
            }
            Microsoft.PowerShell.Management\\Set-Content -Path $Path -Value $Value
          }
        }
        function docker {
          $global:LASTEXITCODE = if ($scenario -in @('client-observer-failure', 'resource-write-failure')) { 1 } else { 0 }
        }
        function Invoke-Docker {
          switch ($args[0]) {
            'create' { return ('a' * 64) }
            'inspect' {
              if ($args -contains '{{.State.ExitCode}}') {
                if ($scenario -eq 'status-inspection-failure') { throw 'Synthetic client exit inspection failure.' }
                return '0'
              }
              if ($args -contains '{{.State.OOMKilled}}') {
                if ($scenario -eq 'oom-unavailable') { return 'invalid' }
                return $(if ($scenario -eq 'oom-killed') { 'true' } else { 'false' })
              }
              throw 'Unexpected inspect in resource control'
            }
            'cp' {
              '{"status":"PASS","complete":true,"version":"0.55.58","warmupIterations":100,"requestCount":4407,"samples":{"add":[12.5]}}' |
                Set-Content $args[2]
            }
            'exec' {
              switch ($args[-1]) {
                '/sys/fs/cgroup/memory.peak' { return $(if ($scenario -eq 'memory-limit') { 1073741824 } else { 200000000 }) }
                '/proc/1/status' {
                  if ($scenario -ne 'missing-rss') {
                    return $(if ($scenario -eq 'rss-limit') { 'VmRSS: 393216 kB' } else { 'VmRSS: 124000 kB' })
                  }
                }
                default { throw 'Unexpected resource probe' }
              }
            }
            'rm' {
              if ($scenario -ne 'resource-write-failure' -and !(Test-Path (Join-Path $directory 'round-1-candidate-resources.json'))) {
                throw 'Resource measurements missing before owned cleanup'
              }
              $script:removed += $args[-1]
            }
            'network' {
              if ($args[1] -eq 'rm') { $script:networkRemoved = $true }
              elseif ($args[1] -eq 'ls' -and !$script:networkRemoved) { return $network }
              elseif ($args[1] -ne 'ls') { throw 'Unexpected network operation' }
            }
            'ps' {}
            default { throw 'Unexpected Docker operation in resource control' }
          }
        }
        $failure = $null
        try { . ([scriptblock]::Create($loop.Extent.Text)) }
        catch { $workFailure = $_; $failure = $_.Exception.Message }
        finally { . ([scriptblock]::Create($cleanup)) }
        $expected = switch ($scenario) {
          'success' { $null }
          'missing-rss' { 'Node RSS unavailable.' }
          'cpu-unavailable' { 'CPU counters unavailable in resource control.' }
          'oom-unavailable' { 'Container OOM state unavailable.' }
          'deadline-after-client' { 'Work deadline reached in resource control.' }
          'status-inspection-failure' { 'Synthetic client exit inspection failure.' }
          'status-write-failure' { 'Synthetic client status write failure.' }
          'client-observer-failure' { 'Failed/partial client receipt retained; no admission or later round.' }
          'resource-write-failure' { 'Failed/partial client receipt retained; no admission or later round.' }
          default { 'Original memory/Node RSS acceptance ceiling exceeded.' }
        }
        if ($failure -cne $expected) { throw "Unexpected resource outcome: $failure" }
        $expectedRows = if ($scenario -eq 'success') { 1 } else { 0 }
        if ($rows.Count -ne $expectedRows -or $round -ne 1) { throw 'Failed resources admitted or later round started' }
        if ($script:removed.Count -ne 3 -or !$script:networkRemoved) { throw 'Owned cleanup incomplete' }
        exit 0
      `], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
      const cleanup = JSON.parse(fs.readFileSync(path.join(directory, 'cleanup.json'), 'utf8'));
      assert.equal(cleanup.containersAbsent, true);
      assert.equal(cleanup.networksAbsent, true);
      const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'round-1-candidate.json'), 'utf8'));
      assert.deepEqual(receipt.samples.add, [12.5], 'Client timings survive owned source cleanup');
      if (scenario === 'resource-write-failure') {
        assert.match(result.stdout, /Resource receipt write failed/);
        assert.equal(fs.existsSync(path.join(directory, 'rounds.json')), false);
        return;
      }
      const resource = JSON.parse(fs.readFileSync(path.join(directory, 'round-1-candidate-resources.json'), 'utf8'));
      assert.equal(resource.status, scenario === 'success' ? 'PASS' : 'FAIL');
      const clientFailure = ['status-inspection-failure', 'status-write-failure', 'client-observer-failure'].includes(scenario);
      const partialAfter = clientFailure || ['cpu-unavailable', 'deadline-after-client'].includes(scenario);
      assert.equal(resource.complete, !partialAfter && !['missing-rss', 'oom-unavailable'].includes(scenario));
      assert.equal(resource.cpuBefore.usage_usec, 1000);
      assert.equal(resource.cpuAfter?.usage_usec ?? null, partialAfter ? null : 2000);
      assert.equal(resource.databaseCalls, partialAfter ? null : 400);
      assert.equal(resource.databaseExecutionMs, partialAfter ? null : 25);
      assert.equal(resource.peakCgroupBytes, partialAfter ? null : scenario === 'memory-limit' ? 1073741824 : 200000000);
      assert.equal(resource.oomKilled, partialAfter || scenario === 'oom-unavailable' ? null : scenario === 'oom-killed');
      assert.equal(resource.nodeRssBytes, partialAfter || ['missing-rss', 'oom-unavailable'].includes(scenario) ? null :
        scenario === 'rss-limit' ? 402653184 : 126976000);
      assert.equal(resource.failureStage, clientFailure ? 'client' : scenario === 'success' ? null :
        scenario === 'cpu-unavailable' ? 'cpu-after' : scenario === 'missing-rss' ? 'node-rss' :
          scenario === 'oom-unavailable' ? 'oom-state' : scenario === 'deadline-after-client' ? 'work-deadline' : 'acceptance-limits');
      assert.equal(fs.existsSync(path.join(directory, 'rounds.json')), scenario === 'success');
      if (scenario === 'client-observer-failure') {
        assert.equal(resource.observerStopFailed, true);
        assert.match(result.stdout, /observer shutdown failed/);
      }
    } finally {
      fs.rmSync(directory, { recursive: true });
    }

  });
}

    for (const scenario of ['work-and-write-failure', 'write-failure', 'work-failure']) {
      test(`actual campaign restores environment and preserves first error for ${scenario}`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scim-campaign-finalization-'));
        const runner = path.resolve(
          __dirname,
          '..',
          'performance',
          'run-membership-qualification.ps1',
        );
        try {
          const result = spawnSync(
            'pwsh',
            [
              '-NoProfile',
              '-Command',
              `
            $ErrorActionPreference = 'Stop'
            $ast = [System.Management.Automation.Language.Parser]::ParseFile('${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
            $campaign = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] })[-1]
            if (!$campaign.CatchClauses -or !$campaign.Finally) { throw 'Missing actual campaign finalization' }
            $scenario = '${scenario}'
            $summary = [ordered]@{ Status = 'RUNNING'; AdmissionEligible = ($scenario -eq 'write-failure') }
            $summaryPath = Join-Path '${directory.replaceAll("'", "''")}' 'campaign.json'
            $campaignFailure = $null
            $envNames = @('SCIM_TEST_RESTORE_PRESENT', 'SCIM_TEST_RESTORE_ABSENT', 'SCIM_TEST_RESTORE_EMPTY')
            [Environment]::SetEnvironmentVariable($envNames[2], '')
            $emptyWasPresent = [Environment]::GetEnvironmentVariables().Contains($envNames[2])
            $emptyPrior = [Environment]::GetEnvironmentVariable($envNames[2])
            $priorEnvironment = @{
              SCIM_TEST_RESTORE_PRESENT = 'prior-value'; SCIM_TEST_RESTORE_ABSENT = $null
              SCIM_TEST_RESTORE_EMPTY = $emptyPrior
            }
            foreach ($key in $envNames) { [Environment]::SetEnvironmentVariable($key, 'generated-fixture-value') }
            function Set-Content {
              param([Parameter(ValueFromPipeline)]$Value, [Parameter(Position=0)]$Path)
              process {
                if ($scenario -ne 'work-failure') { throw 'Synthetic campaign receipt write failure.' }
                Microsoft.PowerShell.Management\\Set-Content -Path $Path -Value $Value
              }
            }
            $control = 'try { if ($scenario -ne "write-failure") { throw "Primary campaign work failure." } } ' +
              $campaign.CatchClauses[0].Extent.Text + ' finally ' + $campaign.Finally.Extent.Text
            $failure = $null
            try {
              . ([scriptblock]::Create($control))
            } catch { $failure = $_.Exception.Message }
            $expected = if ($scenario -eq 'write-failure') { 'Synthetic campaign receipt write failure.' } else { 'Primary campaign work failure.' }
            if ($failure -cne $expected) { throw "Campaign first-error precedence lost: $failure" }
            if ([Environment]::GetEnvironmentVariable($envNames[0]) -cne 'prior-value' -or
                $null -ne [Environment]::GetEnvironmentVariable($envNames[1])) { throw 'Environment not restored after final receipt failure' }
            if ([Environment]::GetEnvironmentVariables().Contains($envNames[2]) -ne $emptyWasPresent -or
                [Environment]::GetEnvironmentVariable($envNames[2]) -cne $emptyPrior) { throw 'Originally empty environment value changed identity' }
            if ($summary.Status -cne 'FAIL: no deployment admission' -or $summary.AdmissionEligible -ne $false) {
              throw 'Failed campaign retained success/admission state'
            }
          `,
            ],
            { encoding: 'utf8' },
          );
          assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
        } finally {
          fs.rmSync(directory, { recursive: true });
        }
      });
    }
