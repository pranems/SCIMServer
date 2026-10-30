const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');

const source = path.resolve(
  __dirname,
  '..',
  'performance',
  'membership-cpu-trace.cjs',
);

function implementation() {
  assert.ok(
    fs.existsSync(source),
    'The diagnostic-only CPU timeline implementation must exist',
  );
  return require(source);
}

test('CPU parsing rejects missing, malformed and duplicate counter values', () => {
  const valid =
    'usage_usec 100\nnr_periods 2\nnr_throttled 1\nthrottled_usec 300\n';
  assert.deepEqual(implementation().parseCounters(valid), {
    usage_usec: 100,
    nr_periods: 2,
    nr_throttled: 1,
    throttled_usec: 300,
  });
  for (const text of [
    valid.replace('nr_periods 2\n', ''),
    valid.replace('100', '-1'),
    valid.replace('100', 'NaN'),
    valid + 'nr_periods 2\n',
  ]) {
    assert.throws(() => implementation().parseCounters(text));
  }
});

test('correlation distinguishes a counter increase strictly inside the request from missing coverage', () => {
  const observations = [0, 10, 20, 30, 40].map((time, index) => ({
    readStartNs: String(time * 1000000),
    ns: String(time * 1000000),
    usage_usec: index * 100,
    nr_periods: index,
    nr_throttled: index >= 2 ? 1 : 0,
    throttled_usec: index >= 2 ? 5000 : 0,
  }));
  const spans = [
    { startNs: '9000000', endNs: '31000000' },
    { startNs: '21000000', endNs: '39000000' },
    { startNs: '1000000', endNs: '9000000' },
  ];
  const result = implementation().correlate(observations, spans);
  assert.equal(result[0].classification, 'counter-increased-inside-span');
  assert.equal(result[0].throttleEvents, 1);
  assert.equal(result[0].throttledMicroseconds, 5000);
  assert.equal(result[1].classification, 'insufficient-interior-samples');
  assert.equal(result[1].throttleEvents, null);
  assert.equal(result[2].classification, 'insufficient-interior-samples');
  assert.equal(result[2].throttledMicroseconds, null);
  assert.throws(() =>
    implementation().correlate(observations, [{ startNs: '-1', endNs: '1' }]),
  );
  assert.throws(() =>
    implementation().correlate([...observations].reverse(), spans),
  );
});

test('a covered interval without increases is not mislabelled as proof of no throttling', () => {
  const observations = [0, 10, 20, 30].map((time, index) => ({
    readStartNs: String(time * 1000000),
    ns: String(time * 1000000),
    usage_usec: index,
    nr_periods: 1,
    nr_throttled: 0,
    throttled_usec: 0,
  }));
  const [result] = implementation().correlate(observations, [
    { startNs: '1000000', endNs: '29000000' },
  ]);
  assert.equal(
    result.classification,
    'no-counter-increase-observed-inside-span',
  );
  assert.equal(result.observationsInside, 2);
  assert.equal(result.throttleEvents, 0);
});

for (const scenario of ['complete stop', 'partial failure', 'deadline']) {
  test(`real observer retains ${scenario} evidence`, async () => {
    implementation();
    const corrupt = scenario === 'partial failure';
    const expired = scenario === 'deadline';
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'scim-cpu-observer-'),
    );
    const ready = path.join(directory, 'ready');
    const stop = path.join(directory, 'stop');
    const output = path.join(directory, 'observations.json');
    fs.writeFileSync(path.join(directory, 'cpu.max'), '50000 100000\n');
    fs.writeFileSync(
      path.join(directory, 'cpu.stat'),
      corrupt
        ? 'invalid\n'
        : 'usage_usec 100\nnr_periods 2\nnr_throttled 1\nthrottled_usec 300\n',
    );
    const child = spawn(
      process.execPath,
      [
        source,
        'monitor',
        directory,
        output,
        ready,
        stop,
        String(Date.now() + (expired ? 1000 : 10000)),
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let errors = '';
    child.stderr.on('data', (data) => {
      errors += data;
    });
    try {
      if (!corrupt) {
        const limit = Date.now() + 5000;
        while (
          !fs.existsSync(ready) &&
          Date.now() < limit &&
          child.exitCode === null
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(fs.existsSync(ready), true, errors);
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (!expired) fs.writeFileSync(stop, '');
      }
      const [exit] = await once(child, 'close');
      assert.equal(exit, corrupt || expired ? 1 : 0, errors);
      const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.equal(receipt.diagnosticOnly, true);
      assert.equal(receipt.admissionEligible, false);
      assert.equal(receipt.complete, !corrupt && !expired);
      assert.equal(receipt.cpuMax, '50000 100000');
      if (!corrupt && !expired) {
        assert.ok(receipt.observations.length >= 2);
        assert.ok(receipt.observerCpuMicroseconds >= 0);
        assert.equal(receipt.failure, null);
        assert.equal(receipt.failureStage, null);
      } else {
        assert.equal(
          receipt.failure,
          expired ? 'DEADLINE_REACHED' : 'INVALID_OR_UNAVAILABLE_COUNTERS',
        );
        assert.equal(
          receipt.failureStage,
          expired ? 'sampling' : 'initial-counters',
        );
        assert.equal(fs.existsSync(ready), expired);
      }
    } finally {
      if (child.exitCode === null) {
        fs.writeFileSync(stop, '');
        await once(child, 'close');
      }
      fs.rmSync(directory, { recursive: true });
    }
  });
}

test('owned cgroup mapping rejects another container and root-only namespace membership', () => {
  const helper = path.resolve(
    __dirname,
    '..',
    'performance',
    'membership-cpu-observer.ps1',
  );
  assert.ok(
    fs.existsSync(helper),
    'Owned CPU observer process helpers must exist',
  );
  const result = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-Command',
      `
    $ErrorActionPreference = 'Stop'
    . '${helper.replaceAll("'", "''")}'
    $id = 'a' * 64
    $actual = Get-OwnedCgroupRoot -ContainerId $id -Membership @("0::/system.slice/docker-$id.scope")
    if ($actual -cne "/sys/fs/cgroup/system.slice/docker-$id.scope") { throw 'Wrong owned cgroup' }
    foreach ($membership in @('0::/', ('0::/docker/' + ('b' * 64)), "0::/../docker/$id")) {
      try { $null = Get-OwnedCgroupRoot -ContainerId $id -Membership @($membership); throw 'Unowned cgroup accepted' }
      catch { if ($_.Exception.Message -ne 'Owned cgroup v2 path unavailable.') { throw } }
    }
    exit 0
  `,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stdout + result.stderr,
  );
});

test('actual observer helpers isolate the child and stop it before returning or propagating failure', () => {
  const helper = path.resolve(
    __dirname,
    '..',
    'performance',
    'membership-cpu-observer.ps1',
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'scim-cpu-lifecycle-'),
  );
  try {
    fs.writeFileSync(path.join(directory, 'cpu.max'), '50000 100000\n');
    fs.writeFileSync(
      path.join(directory, 'cpu.stat'),
      'usage_usec 100\nnr_periods 2\nnr_throttled 1\nthrottled_usec 300\n',
    );
    const result = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `
      $ErrorActionPreference = 'Stop'
      . '${helper.replaceAll("'", "''")}'
      $root = '${directory.replaceAll("'", "''")}'
      foreach ($mode in @('valid', 'invalid')) {
        if ($mode -eq 'invalid') { 'invalid' | Set-Content (Join-Path $root 'cpu.stat') }
        $prefix = Join-Path $root $mode
        $startParameters = @{
          Script = '${source.replaceAll("'", "''")}'; CgroupRoot = $root; Prefix = $prefix
          DeadlineUtc = [DateTimeOffset]::UtcNow.AddSeconds(10).ToUnixTimeMilliseconds()
        }
        $observer = Start-CpuObserver @startParameters
        try {
          $allowedEnvironment = if ($IsWindows) { @('SystemRoot') } else { @() }
          foreach ($key in $observer.Process.StartInfo.Environment.Keys) {
            if ($key -cnotin $allowedEnvironment) { throw 'Observer inherited parent environment' }
          }
          try {
            Wait-CpuObserverReady $observer
            if ($mode -eq 'invalid') { throw 'Invalid observer became ready' }
          } catch {
            if ($mode -ne 'invalid' -or $_.Exception.Message -cne 'CPU observer exited before readiness; no attribution.') { throw }
          }
        } finally {
          try { Stop-CpuObserver $observer }
          catch {
            if ($mode -ne 'invalid' -or $_.Exception.Message -cne 'CPU observer failed; partial receipt retained, no attribution.') { throw }
          }
        }
        if (!$observer.Process.HasExited) { throw 'Observer survived lifecycle closure' }
        if (!(Test-Path -LiteralPath "$prefix-cpu.stderr.txt")) { throw 'Observer error stream was lost' }
        $receipt = Get-Content -LiteralPath "$prefix-cpu.json" -Raw | ConvertFrom-Json
        if ($receipt.complete -ne ($mode -eq 'valid') -or $receipt.admissionEligible -ne $false) {
          throw 'Observer evidence completeness or admission changed'
        }
      }
      exit 0
    `,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(
      result.status,
      0,
      result.error?.message ?? result.stdout + result.stderr,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

for (const scenario of [
  'complete',
  'clock-gap',
  'changed-sample',
  'wrong-clock',
  'missing-cost',
  'failed-privacy',
  'missing-privacy',
]) {
  test(`actual diagnostic analyzer accepts only complete matching evidence: ${scenario}`, () => {
    implementation();
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'scim-cpu-analysis-'),
    );
    try {
      const roles = ['candidate', 'baseline', 'baseline', 'candidate'];
      const rows = roles.map((role) => ({
        role,
        image: 'same-immutable-image',
        status: 'PASS',
        complete: true,
        diagnosticOnly: true,
        cpuMax: '50000 100000',
        cpuLimit: 0.5,
        memoryLimit: 1073741824,
        requestCount: 4407,
        samples: Object.fromEntries(
          ['add', 'populatedRead', 'remove', 'emptyRead'].map((op) => [
            op,
            Array(1000).fill(1),
          ]),
        ),
      }));
      for (const [index, role] of roles.entries()) {
        const spans = [];
        const append = (operation, phase, cycle = null) => {
          const start = BigInt(spans.length * 2000000 + 1000000);
          spans.push({
            requestIndex: spans.length + 1,
            operation,
            phase,
            cycle,
            startNs: String(start),
            endNs: String(start + 1000000n),
            ms: 1,
            succeeded: true,
            status: 200,
          });
        };
        for (const op of ['version', 'fixture', 'fixture', 'fixture'])
          append(op, 'lifecycle');
        for (let cycle = 0; cycle < 1100; cycle++) {
          for (const op of ['add', 'populatedRead', 'remove', 'emptyRead']) {
            append(
              op,
              cycle < 100 ? 'warmup' : 'measured',
              cycle < 100 ? cycle : cycle - 100,
            );
          }
        }
        for (const op of ['finalVersion', 'cleanup', 'cleanup'])
          append(op, 'lifecycle');
        const observations = [0, 4000000000, 9000000000].map((ns, i) => ({
          ns: String(ns),
          readStartNs: String(ns),
          usage_usec: i * 100,
          nr_periods: i,
          nr_throttled: 0,
          throttled_usec: 0,
        }));
        if (index === 0 && scenario === 'clock-gap')
          observations.at(-1).ns = '8000000000';
        if (index === 0 && scenario === 'changed-sample') spans[404].ms = 2;
        fs.writeFileSync(
          path.join(directory, `round-${index + 1}-${role}.json`),
          JSON.stringify({
            diagnosticOnly: true,
            traceClock: 'process.hrtime.bigint',
            complete: true,
            spans,
          }),
        );
        const cpu = {
          diagnosticOnly: true,
          admissionEligible: false,
          complete: true,
          clock: 'process.hrtime.bigint',
          cpuMax: '50000 100000',
          observerCpuMicroseconds: 100,
          observations,
        };
        if (index === 0 && scenario === 'wrong-clock') cpu.clock = 'Date.now';
        if (index === 0 && scenario === 'missing-cost')
          delete cpu.observerCpuMicroseconds;
        fs.writeFileSync(
          path.join(directory, `round-${index + 1}-${role}-cpu.json`),
          JSON.stringify(cpu),
        );
      }
      fs.writeFileSync(
        path.join(directory, 'rounds.json'),
        JSON.stringify(rows),
      );
      if (scenario !== 'missing-privacy') {
        fs.writeFileSync(path.join(directory, 'privacy.json'), JSON.stringify({
          passed: scenario !== 'failed-privacy',
          contractAssertions: 66,
          checkedRows: 200,
          rawLogsExported: false,
        }));
      }
      const result = spawnSync(
        process.execPath,
        [source, 'analyze', directory],
        { encoding: 'utf8' },
      );
      assert.equal(
        result.status,
        scenario === 'complete' ? 0 : 1,
        result.stdout + result.stderr,
      );
      const output = path.join(directory, 'cpu-attribution.json');
      assert.equal(fs.existsSync(output), scenario === 'complete');
      if (scenario === 'complete') {
        const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
        assert.equal(receipt.diagnosticOnly, true);
        assert.equal(receipt.admissionEligible, false);
        assert.equal(receipt.comparisons.length, 8);
        assert.ok(
          receipt.comparisons.every(
            (row) => row.samples === 2000 && row.p99 === 1,
          ),
        );
        assert.equal(receipt.observerCosts.length, 4);
      }
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
}

test('actual diagnostic control flow runs one block and never invokes the admission evaluator', () => {
  const runner = path.resolve(
    __dirname,
    '..',
    'performance',
    'run-membership-qualification.ps1',
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'scim-diagnostic-flow-'),
  );
  try {
    const result = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `
      $ErrorActionPreference = 'Stop'
      $source = '${runner.replaceAll("'", "''")}'
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$null)
      $loop = $ast.Find({ param($item)
        $item -is [System.Management.Automation.Language.ForEachStatementAst] -and
        $item.Variable.VariablePath.UserPath -eq 'block'
      }, $true)
      $TraceDiagnostic = $true
      $protocol = Get-Content (Join-Path (Split-Path $source) 'membership-protocol.json') -Raw | ConvertFrom-Json
      $summary = @{ Blocks = @(); AdmissionEligible = $false }
      $summaryPath = '${path.join(directory, 'summary.json').replaceAll("'", "''")}'
      $cpuTrace = 'diagnostic observer'
      $evaluator = 'forbidden admission evaluator'
      $script:attempts = 0
      function Assert-WithinDeadline {}
      function Invoke-Block { param($Block) $script:attempts++; return 'owned block' }
      function node {
        if ($args[0] -cne $cpuTrace -or $args[1] -cne 'analyze') { throw 'Diagnostic reached admission evaluator' }
        $global:LASTEXITCODE = 0
      }
      . ([scriptblock]::Create($loop.Extent.Text))
      if ($script:attempts -ne 1 -or $summary.Blocks.Count -ne 1 -or
          $summary.Blocks[0].AdmissionEligible -ne $false -or $summary.AdmissionEligible -ne $false) {
        throw 'Diagnostic resumed later blocks or became admission'
      }
      exit 0
    `,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(
      result.status,
      0,
      result.error?.message ?? result.stdout + result.stderr,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('actual qualification receipt guard rejects even a complete diagnostic-marked client', () => {
  const runner = path.resolve(
    __dirname,
    '..',
    'performance',
    'run-membership-qualification.ps1',
  );
  const result = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-Command',
      `
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
      '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
    $guard = $ast.Find({ param($item)
      $item -is [System.Management.Automation.Language.IfStatementAst] -and
      $item.Extent.Text.Contains("'Diagnostic client receipt cannot enter qualification.'")
    }, $true)
    if (!$guard) { throw 'Missing actual diagnostic admission guard' }
    $TraceDiagnostic = $false
    foreach ($marker in @($true, $false)) {
      $receipt = [pscustomobject]@{ status = 'PASS'; complete = $true; diagnosticOnly = $marker }
      try { . ([scriptblock]::Create($guard.Extent.Text)); throw 'Diagnostic client admitted' }
      catch { if ($_.Exception.Message -cne 'Diagnostic client receipt cannot enter qualification.') { throw } }
    }
    exit 0
  `,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stdout + result.stderr,
  );
});

test('diagnostic job has bounded non-admitting authority and serializes with qualification', () => {
  const workflow = fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      '..',
      '.github',
      'workflows',
      'membership-cpu-diagnostic.yml',
    ),
    'utf8',
  );
  const caps = [...workflow.matchAll(/timeout-minutes:\s*(\d+)/g)].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(caps, [30, 2, 3, 20, 4]);
  assert.ok(caps.slice(1).reduce((sum, n) => sum + n, 0) < caps[0]);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /group: membership-performance-qualification/);
  assert.match(workflow, /-TraceDiagnostic/);
  assert.doesNotMatch(
    workflow,
    /azure\/login|promote-to-prod|deploy-azure|write-all/,
  );
});
