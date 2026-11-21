import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('../api/node_modules/js-yaml');
const workflowSource = readFileSync(new URL('../.github/workflows/regen-lockfile.yml', import.meta.url), 'utf8');
const workflow = yaml.load(workflowSource);
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
  check('workflow supports targeted CI-only Zod and product artifacts without shell interpolation', () => {
    assert.equal(workflow.on.workflow_dispatch.inputs.targetZodVersion.type, 'string');
    assert.equal(workflow.on.workflow_dispatch.inputs.productVersion.type, 'string');
    assert.equal(workflow.jobs.regen.env.REGEN_ZOD_VERSION, '${{ inputs.targetZodVersion }}');
    assert.equal(workflow.jobs.regen.env.REGEN_PRODUCT_VERSION, '${{ inputs.productVersion }}');
    assert.match(workflowSource, /Use targetZodVersion and productVersion/);
    assert.match(workflowSource, /without first pushing mismatched manifests and locks/);
    const commands = workflow.jobs.regen.steps.filter(step => step.run).map(step => step.run).join('\n');
    assert.match(commands, /prepare-targeted/);
    assert.match(commands, /verify-targeted/);
    assert.doesNotMatch(commands, /\$\{\{ inputs\.(?:targetZodVersion|productVersion)/);
    assert.match(commands, /cp --parents "\$d\/package.json" "\$d\/package-lock.json"/);
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
    const product = { name: 'web', version: '0.55.68',
      dependencies: { zod: '^4.4.3', react: '^19.2.0' }, scripts: { test: 'vitest' } };
    check('targeted manifest pins only Zod and product version without mutating its source', () => {
      const original = structuredClone(product);
      assert.deepEqual(mod.prepareManifest(product, 'web', '4.6.6', '0.55.69'), {
        ...product, version: '0.55.69', dependencies: { ...product.dependencies, zod: '4.6.6' },
      });
      assert.deepEqual(product, original);
      assert.deepEqual(mod.prepareManifest(product, 'api', '4.6.6', '0.55.69'),
        { ...product, version: '0.55.69' });
      assert.deepEqual(mod.prepareManifest(product, 'web', '', ''), product);
    });
    check('targeted versions reject ranges and shell-shaped input', () => {
      for (const version of ['^4.6.6', 'latest', '04.6.6', '4.6.6-beta.1',
        '4.6.6; echo invalid', '$(echo invalid)']) {
        assert.throws(() => mod.prepareManifest(product, 'web', version, ''), /stable version/);
        assert.throws(() => mod.prepareManifest(product, 'web', '', version), /stable version/);
      }
      assert.throws(() => mod.prepareManifest({ dependencies: {} }, 'web', '4.6.6', ''), /Zod/);
    });
    check('targeted artifact validation rejects unrelated changes and wrong Zod versions', () => {
      const before = { packages: {
        '': { version: '0.55.68' }, 'node_modules/zod': { version: '4.4.3' },
        'node_modules/react': { version: '19.2.0' },
        'node_modules/parent/node_modules/zod': { version: '4.4.3' },
      } };
      const after = structuredClone(before);
      after.packages[''].version = '0.55.69';
      after.packages['node_modules/zod'].version = '4.6.6';
      assert.doesNotThrow(() => mod.verifyTargetedPackages(before, after, 'web', '4.6.6'));
      assert.throws(() => mod.verifyTargetedPackages(before, before, 'web', '4.6.6'), /Zod/);
      after.packages['node_modules/react'].version = '19.3.0';
      assert.throws(() => mod.verifyTargetedPackages(before, after, 'web', '4.6.6'), /Unrelated/);
      assert.throws(() => mod.verifyTargetedPackages(before, after, 'api', '4.6.6'), /Unrelated/);
      for (const mutation of [
        value => { delete value.packages['node_modules/react']; },
        value => { value.packages['node_modules/unrequested'] = { version: '1.0.0' }; },
        value => { value.packages['node_modules/parent/node_modules/zod'].version = '4.6.6'; },
      ]) {
        const candidate = structuredClone(before);
        candidate.packages['node_modules/zod'].version = '4.6.6';
        mutation(candidate);
        assert.throws(() => mod.verifyTargetedPackages(before, candidate, 'web', '4.6.6'), /Unrelated/);
      }
    });
    check('targeted artifact preparation cannot mutate manifests outside CI', () => {
      const original = JSON.stringify(product);
      writeFileSync(join(scratch, 'package.json'), original);
      const result = spawnSync(process.execPath, [script, 'prepare-targeted', 'both'], {
        cwd: scratch, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false',
          REGEN_ZOD_VERSION: '4.6.6', REGEN_PRODUCT_VERSION: '0.55.69' },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /CI only/);
      assert.equal(readFileSync(join(scratch, 'package.json'), 'utf8'), original);
    });
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
    check('CI seed retains existing versions without changing requested Mermaid or nested identities', () => {
      const manifest = { name: 'fixture', devDependencies: { mermaid: '11.17.0', 'markdown-it': '^14.3.0' } };
      const before = { packages: {
        '': { name: 'fixture', devDependencies: { mermaid: '11.15.0', 'markdown-it': '^14.3.0' } },
        'node_modules/mermaid': { version: '11.15.0' },
        'node_modules/markdown-it': { version: '14.3.0' },
        'node_modules/transitive': { version: '1.2.3' },
        'node_modules/parent/node_modules/transitive': { version: '0.9.0' },
      } };
      assert.deepEqual(mod.seedManifest(manifest, before).devDependencies,
        { mermaid: '11.17.0', 'markdown-it': '14.3.0', transitive: '1.2.3' });
      assert.equal(manifest.devDependencies['markdown-it'], '^14.3.0');
    });
    check('root regeneration cannot execute outside CI', () => {
      const result = spawnSync(process.execPath, [script, 'regenerate-root', 'root'], {
        cwd: scratch, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /CI only/);
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
