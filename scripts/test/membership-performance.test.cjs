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

for (const corruptRead of [false, true]) {
  test(`HTTP client ${corruptRead ? 'rejects incorrect readback and still cleans its fixture' : 'measures the complete lifecycle and exact fixture removal'}`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scim-client-contract-'));
    const receiptPath = path.join(directory, 'receipt.json');
    const token = randomUUID();
    let members = [];
    let removed = false;
    let requests = 0;
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
          else if (request.method === 'DELETE') { removed = true; result = undefined; }
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
            result = { id: 'group-1', members: corruptRead && members.length ? [{ value: 'wrong-user' }] : members };
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
          SCIM_BENCH_TOKEN: token, SCIM_BENCH_VERSION: '0.55.58', SCIM_BENCH_OUTPUT: receiptPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let diagnostic = '';
      child.stderr.on('data', chunk => { diagnostic += chunk; });
      const [exitCode] = await once(child, 'close');
      assert.deepEqual(serverErrors, []);
      assert.equal(removed, true, 'Fixture deletion must occur on success and failed readback');
      assert.equal(exitCode, corruptRead ? 1 : 0, diagnostic);
      if (corruptRead) {
        assert.equal(fs.existsSync(receiptPath), false, 'Failed rounds must not emit success receipts');
        assert.match(diagnostic, /wrong-user/);
      } else {
        assert.equal(requests, 4407);
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
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
