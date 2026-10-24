const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
