const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
const unitCommand = /^\s+run: node --test --test-reporter=tap --test-concurrency=1 scripts\/test\/membership-\*\.test\.cjs\s*$/m;

test('ordinary branch and release CI run all portable membership tests', () => {
  for (const file of ['build-test.yml', 'build-and-push.yml']) {
    const source = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    assert.match(source, unitCommand, `${file} must run the complete membership test selector`);
    assert.doesNotMatch(source.replace(unitCommand, '\n      # run: node --test omitted'), unitCommand);
  }
});

test('ordinary CI retains the Git history required by source identity and historical negative controls', () => {
  for (const file of ['build-test.yml', 'build-and-push.yml']) {
    const source = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    const first = source.indexOf('      - name: Checkout repository');
    const next = source.indexOf('\n      - name:', first + 1);
    assert.ok(first >= 0 && next > first, file);
    assert.match(source.slice(first, next), /^\s+fetch-depth: 0\s*$/m,
      `${file} must provide the immutable historical commits used by the tests`);
  }
});

test('default pre-push runs the complete membership test selector and rejects empty discovery', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/pre-push-checks.ps1'), 'utf8');
  const first = source.indexOf("Invoke-Gate -Name 'tools: membership unit tests'");
  assert.ok(first >= 0, 'Membership tooling must have an active default pre-push gate');
  const next = source.indexOf('\nInvoke-Gate ', first + 1);
  const block = source.slice(first, next < 0 ? undefined : next);
  assert.match(block, /^\s+\$membershipTests = .*Get-ChildItem .* -Filter 'membership-\*\.test\.cjs'/m);
  assert.match(block, /if \(\$membershipTests\.Count -eq 0\) \{ throw /);
  assert.match(block, /^\s+node --test --test-reporter=tap --test-concurrency=1 @membershipTests/m);
});

test('web validation uses two workers without changing the complete test selector', () => {
  for (const file of ['build-test.yml', 'build-and-push.yml']) {
    const source = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    assert.match(source, /working-directory: web\r?\n\s+run: npm test -- --maxWorkers=2\s*$/m, file);
  }
  const source = fs.readFileSync(path.join(root, 'scripts/pre-push-checks.ps1'), 'utf8');
  const first = source.indexOf("Invoke-Gate -Name 'web: vitest'");
  assert.ok(first >= 0);
  assert.match(source.slice(first), /^\s+npm test -- --maxWorkers=2 2>&1 \| Out-Host\s*$/m);
  const api = source.indexOf("Invoke-Gate -Name 'api: unit tests (jest)'");
  assert.ok(api >= 0);
  assert.match(source.slice(api, source.indexOf('\nInvoke-Gate ', api + 1)),
    /^\s+npm test 2>&1 \| Out-Host\s*$/m);
});

test('Validate rejects missing codegen configuration before heavy gates without requiring it in Fast mode',
  { timeout: 45000 }, () => {
    const source = fs.readFileSync(path.join(root, 'scripts/pre-push-checks.ps1'), 'utf8');
    const first = source.indexOf('# Validate configuration preflight');
    const last = source.indexOf('# Fast gates (always run)', first);
    assert.ok(first >= 0 && last > first, 'Validate configuration must be checked before heavy gates');
    assert.ok(last < source.indexOf("Invoke-Gate -Name 'dependencies: ownership negative controls'"));
    for (const [mode, value, expected] of [
      ['Validate', undefined, 1], ['Full', ' ', 1],
      ['Validate', 'postgresql://127.0.0.1:1/prepush_codegen', 0], ['Fast', undefined, 0],
    ]) {
      const env = { ...process.env };
      delete env.DATABASE_URL;
      if (value !== undefined) env.DATABASE_URL = value;
      const result = spawnSync('pwsh', ['-NoProfile', '-Command',
        `$ErrorActionPreference='Stop'; $Mode='${mode}';
        function Invoke-Gate { param([string]$Name, [scriptblock]$Action) & $Action }
        ${source.slice(first, last)}`], {
        env, encoding: 'utf8', windowsHide: true, timeout: 10000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, expected, mode);
      if (expected) assert.match(result.stderr, /DATABASE_URL is required/);
    }
  });
