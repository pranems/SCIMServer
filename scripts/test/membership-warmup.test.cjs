const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assessor = require('../performance/assess-membership.cjs');
const protocol = require('../performance/membership-protocol.json');
const root = path.resolve(__dirname, '..', '..');

test('bounded warmup calibration cannot enter the original assessor even with its diagnostic flag stripped', () => {
  const block = protocol.blocks[0];
  const roles = assessor.rolesFor(protocol, block);
  for (const marker of [false, true]) {
    const rows = ['candidate', 'baseline', 'baseline', 'candidate'].map(role => ({
      role, version: roles[role].version, image: roles[role].image,
      status: 'PASS', complete: true, cpuLimit: 0.5, memoryLimit: 1073741824,
      warmupIterations: 100, requestCount: 4407, warmupCalibration: marker,
      samples: Object.fromEntries(['add', 'populatedRead', 'remove', 'emptyRead']
        .map(operation => [operation, Array(1000).fill(1)])),
    }));
    assert.throws(() => assessor.assessBlock(rows, block, roles),
      /Calibration receipts cannot enter release admission/);
  }
});

test('actual runner calibration preflight requires current-checkout CPU tracing before allocation', () => {
  const runner = path.join(root, 'scripts', 'performance', 'run-membership-qualification.ps1');
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
      '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
    $guard = $ast.Find({ param($item)
      $item -is [System.Management.Automation.Language.IfStatementAst] -and
      $item.Extent.Text.Contains("'Warmup calibration requires current-checkout CPU trace mode.'")
    }, $true)
    if (!$guard) { throw 'Missing actual calibration preflight' }
    $environment = $ast.Find({ param($item)
      $item -is [System.Management.Automation.Language.AssignmentStatementAst] -and
      $item.Left.Extent.Text -ceq '$envNames'
    }, $true)
    if (!$environment) { throw 'Missing actual environment restoration list' }
    . ([scriptblock]::Create($environment.Extent.Text))
    foreach ($name in @('SCIM_BENCH_CALIBRATION_OWNER', 'SCIM_BENCH_WARMUP_ITERATIONS')) {
      if ($envNames -cnotcontains $name) { throw 'Calibration environment escapes campaign restoration' }
    }
    foreach ($case in @(
      @{ warmup = 0; trace = $false; profile = $false; source = $false; rejected = $false },
      @{ warmup = 100; trace = $true; profile = $false; source = $true; rejected = $false },
      @{ warmup = 1000; trace = $true; profile = $false; source = $true; rejected = $false },
      @{ warmup = 1000; trace = $false; profile = $false; source = $true; rejected = $true },
      @{ warmup = 1000; trace = $true; profile = $true; source = $true; rejected = $true },
      @{ warmup = 1000; trace = $true; profile = $false; source = $false; rejected = $true }
    )) {
      $WarmupCalibration = $case.warmup
      $TraceDiagnostic = $case.trace
      $ProfileDiagnostic = $case.profile
      $protocol = @{ candidate = @{ sourceCommit = $(if ($case.source) { 'a' * 40 } else { $null }) } }
      $rejected = $false
      try { . ([scriptblock]::Create($guard.Extent.Text)) }
      catch {
        if ($_.Exception.Message -cne 'Warmup calibration requires current-checkout CPU trace mode.') { throw }
        $rejected = $true
      }
      if ($rejected -ne $case.rejected) { throw 'Calibration authority mismatch' }
    }
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
});

test('shared image builder executes exact-source build and produces a real immutable protocol', () => {
  const builder = path.join(root, 'scripts', 'performance', 'build-membership-image.ps1');
  assert.ok(fs.existsSync(builder), 'Missing shared exact-image builder');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-study-image-'));
  const output = path.join(directory, 'image');
  const image = `sha256:${'b'.repeat(64)}`;
  const source = 'a'.repeat(40);
  const identity = { id: image, os: 'linux', architecture: 'amd64', sourceCommit: source };
  try {
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      function git {
        $global:LASTEXITCODE = 0
        if ($args[0] -ceq 'rev-parse') { return '${source}' }
        if ($args[0] -cne 'diff') { throw 'Unexpected git operation' }
      }
      function docker {
        $global:LASTEXITCODE = 0
        if ($args[0] -ceq 'build') {
          if ($args[1] -cne '--pull' -or
              $args -cnotcontains 'org.opencontainers.image.revision=${source}' -or
              $args -cnotcontains 'IMAGE_TAG=${source}') { throw 'Build is not fresh and source-bound' }
          $index = [Array]::IndexOf($args, '--iidfile')
          if ($index -lt 0) { throw 'Missing immutable output' }
          Set-Content -LiteralPath $args[$index + 1] '${image}'
          return
        }
        if ($args[0] -cne 'image' -or $args[1] -cne 'inspect' -or $args[-1] -cne '${image}') {
          throw 'Unexpected Docker operation'
        }
        return '${JSON.stringify(identity)}'
      }
      & '${builder.replaceAll("'", "''")}' -OutputDirectory '${output.replaceAll("'", "''")}'
      if ($LASTEXITCODE -ne 0) { throw 'Actual binding CLI failed' }
    `], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    const current = JSON.parse(fs.readFileSync(path.join(output, 'protocol.json'), 'utf8'));
    assert.deepEqual(current.candidate, {
      image, sourceCommit: source, version: require('../../api/package.json').version,
    });
    assert.deepEqual(current.baseline, protocol.baseline);
    assert.deepEqual(current.blocks, protocol.blocks);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'identity.json'), 'utf8')), identity);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('warmup study freezes two treatments, bounded cleanup time and non-deployment authority', () => {
  const workflow = path.join(root, '.github', 'workflows', 'membership-warmup-diagnostic.yml');
  assert.ok(fs.existsSync(workflow), 'Missing bounded diagnostic workflow');
  const content = fs.readFileSync(workflow, 'utf8');
  const caps = [...content.matchAll(/timeout-minutes:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.deepEqual(caps, [65, 2, 3, 10, 20, 20, 4]);
  assert.ok(caps.slice(1).reduce((sum, value) => sum + value, 0) < caps[0]);
  assert.deepEqual([...content.matchAll(/-WarmupCalibration (\d+)/g)].map(match => Number(match[1])), [100, 1000]);
  assert.equal((content.match(/-TraceDiagnostic/g) ?? []).length, 2);
  assert.equal((content.match(/-ProtocolPath /g) ?? []).length, 2);
  assert.match(content, /build-membership-image\.ps1/);
  assert.match(content, /contents: read/);
  assert.match(content, /if: always\(\)/);
  assert.match(content, /group: membership-performance-qualification/);
  assert.doesNotMatch(content, /id-token: write|contents: write|azure\/login|deploy-azure|continue-on-error|strategy:|matrix:|docker push|ceilingRatio|retry/i);
});
