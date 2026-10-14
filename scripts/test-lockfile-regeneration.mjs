import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('../api/node_modules/js-yaml');
const workflow = yaml.load(readFileSync(new URL('../.github/workflows/regen-lockfile.yml', import.meta.url), 'utf8'));
const script = fileURLToPath(new URL('./lockfile-regeneration.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'lockfile-regen-'));
let failures = 0;
function check(name, action) {
  try {
    action();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${name}: ${error.message}`);
  }
}
try {
  check('workflow accepts root selection', () => {
    assert.ok(workflow.on.workflow_dispatch.inputs.workspace.options.includes('root'));
  });
  check('workflow executes shared root-aware validation and selected artifacts', () => {
    const steps = workflow.jobs.regen.steps;
    const commands = steps.filter((step) => step.run).map((step) => step.run).join('\n');
    assert.match(commands, /node scripts\/lockfile-regeneration\.mjs workspaces/);
    assert.match(commands, /node scripts\/lockfile-regeneration\.mjs verify/);
    assert.match(commands, /node scripts\/lockfile-regeneration\.mjs ages/);
    assert.equal(steps.find((step) => step.uses?.startsWith('actions/upload-artifact@')).with.path,
      'regenerated-lockfiles/');
  });
  const run = (args) => spawnSync(process.execPath, [script, ...args], { cwd: scratch, encoding: 'utf8' });
  check('root maps to repository directory without selecting API or web', () => {
    const result = run(['workspaces', 'root']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '.');
  });
  check('both preserves API/web semantics and invalid selection fails', () => {
    assert.equal(run(['workspaces', 'both']).stdout.trim(), 'api web');
    assert.equal(run(['workspaces', 'invalid']).status, 1);
  });
  let mod;
  try {
    mod = await import('./lockfile-regeneration.mjs');
  } catch (error) {
    check('validation module exists', () => { throw error; });
  }
  if (mod) {
    const entry = { version: '1.0.0', resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
      integrity: 'sha512-YQ==' };
    const lock = (value) => ({ packages: { '': { name: 'fixture' }, 'node_modules/example': value } });
    check('public sha512 root lock passes actual CLI verification', () => {
      writeFileSync(join(scratch, 'package-lock.json'), JSON.stringify(lock(entry)));
      assert.equal(run(['verify', 'root']).status, 0);
    });
    for (const [name, value] of Object.entries({
      'internal host': { ...entry, resolved: 'https://internal.invalid/example.tgz' },
      'non-http URL': { ...entry, resolved: 'file:example.tgz' },
      'weak integrity': { ...entry, integrity: 'sha1-YQ==' },
      'unknown integrity': { ...entry, integrity: 'other-YQ==' },
      'missing integrity': { ...entry, integrity: undefined },
    })) {
      check(`${name} blocks root artifact`, () => {
        writeFileSync(join(scratch, 'package-lock.json'), JSON.stringify(lock(value)));
        assert.equal(run(['verify', 'root']).status, 1);
      });
    }
    check('root selection does not inspect unrelated workspace files', () => {
      writeFileSync(join(scratch, 'package-lock.json'), JSON.stringify(lock(entry)));
      mkdirSync(join(scratch, 'api'));
      writeFileSync(join(scratch, 'api', 'package-lock.json'), '{}');
      assert.equal(run(['verify', 'root']).status, 0);
      assert.equal(run(['verify', 'api']).status, 1);
    });
    check('changed versions preserve scoped and nested package identities', () => {
      assert.deepEqual(mod.changedPackages({ packages: {} }, { packages: {
        '': { version: '0.0.0' },
        'node_modules/parent/node_modules/@scope/child': { version: '2.0.0' },
      } }), [{ name: '@scope/child', before: '(new)', version: '2.0.0' }]);
    });
    check('unchanged version is excluded and missing old map fails closed', () => {
      assert.deepEqual(mod.changedPackages(lock(entry), lock(entry)), []);
      assert.throws(() => mod.changedPackages({}, lock(entry)), /packages/);
    });
    check('same-version provenance changes still require publication evidence', () => {
      const previous = lock({ ...entry, resolved: 'https://internal.invalid/example.tgz' });
      assert.deepEqual(mod.changedPackages(previous, lock(entry)),
        [{ name: 'example', before: '1.0.0', version: '1.0.0' }]);
    });
    check('seven-day boundary accepted and younger or unknown age rejected', () => {
      const now = Date.parse('2026-10-14T00:00:00Z');
      assert.equal(mod.releaseAge('2026-10-07T00:00:00Z', now), 7);
      assert.throws(() => mod.releaseAge('2026-10-07T00:00:01Z', now), /7 days/);
      assert.throws(() => mod.releaseAge(undefined, now), /unknown/);
      assert.throws(() => mod.releaseAge('invalid', now), /unknown/);
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
