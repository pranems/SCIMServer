import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findMermaidRenderers } from './mermaid-renderers.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'mermaid-gates-'));
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
function runRender() {
  return spawnSync(process.execPath, [join(root, 'scripts', 'render-mermaid.mjs')], {
    cwd: root, encoding: 'utf8',
  });
}

try {
  mkdirSync(join(root, 'scripts'));
  for (const name of ['render-mermaid.mjs', 'mermaid-renderers.mjs', 'doctor-mermaid.mjs']) {
    copyFileSync(join(scripts, name), join(root, 'scripts', name));
  }
  check('missing Playwright rejects required render', () => {
    const result = runRender();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /playwright/i);
  });
  const playwright = join(root, 'web', 'node_modules', 'playwright-core');
  mkdirSync(playwright, { recursive: true });
  writeFileSync(join(playwright, 'index.js'), 'module.exports = { chromium: {} };');
  check('missing Mermaid rejects required render', () => {
    const result = runRender();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /mermaid/i);
  });

  // Discovery uses a scratch install, never mutates an installed editor.
  const saved = { ProgramFiles: process.env.ProgramFiles, LOCALAPPDATA: process.env.LOCALAPPDATA,
    USERPROFILE: process.env.USERPROFILE };
  const bundleDir = join(root, 'editor', 'Microsoft VS Code', 'resources', 'app',
    'extensions', 'mermaid-markdown-features');
  mkdirSync(join(bundleDir, 'markdown-preview-out'), { recursive: true });
  writeFileSync(join(bundleDir, 'package.json'), '{"version":"10.0.0"}');
  const bundle = join(bundleDir, 'markdown-preview-out', 'index.js');
  process.env.ProgramFiles = join(root, 'editor');
  process.env.LOCALAPPDATA = root;
  process.env.USERPROFILE = root;
  try {
    const discover = () => findMermaidRenderers().find((r) => r.dir === bundleDir)?.version;
    check('profiling placeholder cannot become an actionable pin', () => {
      writeFileSync(bundle, 'globalThis.injected={version:"0.0.0"};');
      assert.equal(discover(), null);
    });
    check('Mermaid info database wins over placeholder and React version', () => {
      writeFileSync(bundle, 'globalThis.injected={version:"0.0.0"};\n' +
        'DEFAULT_INFO_DB = { version: "11.17.0" + (true ? "" : "-tiny") };\n' +
        'var react={version:"19.2.3"};');
      assert.equal(discover(), '11.17.0');
    });
    check('unattributed dependency version is unknown', () => {
      writeFileSync(bundle, 'var react={version:"19.2.3"};');
      assert.equal(discover(), null);
    });
    check('placeholder Mermaid info version is unknown', () => {
      writeFileSync(bundle, 'DEFAULT_INFO_DB={version:"0.0.0"};');
      assert.equal(discover(), null);
    });
    check('compact Mermaid info version is identified', () => {
      writeFileSync(bundle, 'DEFAULT_INFO_DB={version:"11.15.0"};');
      assert.equal(discover(), '11.15.0');
    });
    check('split minified info-diagram module identifies its getter-owned version', () => {
      writeFileSync(bundle, 'import "./infoDiagram-test.js";');
      const info = join(bundleDir, 'markdown-preview-out', 'infoDiagram-test.js');
      try {
        writeFileSync(info, 'globalThis.injected={version:"0.0.0"};' +
          'var m={version:"11.17.0"},v=r(()=>m.version,"getVersion"),d={getVersion:v};');
        assert.equal(discover(), '11.17.0');
      } finally {
        unlinkSync(info);
      }
    });
    const mermaidDir = join(root, 'node_modules', 'mermaid');
    mkdirSync(mermaidDir, { recursive: true });
    writeFileSync(join(mermaidDir, 'package.json'), '{"version":"11.15.0"}');
    const diagnose = () => {
      // Windows restores ProgramFiles in child environments. Feed the doctor
      // the actual discovery result rather than letting it scan the host again.
      const renderer = { kind: 'builtin', id: 'vscode.mermaid-markdown-features',
        dir: bundleDir, version: discover() };
      writeFileSync(join(root, 'scripts', 'mermaid-renderers.mjs'),
        `export function findMermaidRenderers() { return ${JSON.stringify([renderer])}; }\n` +
        'export function authoritativeRenderer(renderers) { return renderers[0]; }\n');
      const result = spawnSync(process.execPath, [join(root, 'scripts', 'doctor-mermaid.mjs')], {
        cwd: root, encoding: 'utf8',
      });
      return { ...result, output: result.stdout + result.stderr };
    };
    check('unknown renderer diagnostic never recommends placeholder pin', () => {
      writeFileSync(bundle, 'globalThis.injected={version:"0.0.0"};');
      const result = diagnose();
      assert.match(result.output, /Authoritative renderer Mermaid version is unknown/);
      assert.match(result.output, /equivalence is unverified/);
      assert.doesNotMatch(result.output, /mermaid@0\.0\.0/);
    });
    check('identified real version drift remains a diagnostic blocker', () => {
      writeFileSync(bundle, 'DEFAULT_INFO_DB={version:"11.17.0"};');
      const result = diagnose();
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /VERSION DRIFT/);
      assert.match(result.output, /mermaid@11\.17\.0/);
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  check('render summary does not certify editor equivalence', () => {
    copyFileSync(join(scripts, 'mermaid-renderers.mjs'), join(root, 'scripts', 'mermaid-renderers.mjs'));
    const mermaidDist = join(root, 'node_modules', 'mermaid', 'dist');
    mkdirSync(mermaidDist);
    writeFileSync(join(mermaidDist, 'mermaid.min.js'), '');
    writeFileSync(join(playwright, 'index.js'),
      'module.exports = { chromium: { launch: async () => ({\n' +
      '  newPage: async () => ({ setContent: async () => {}, addScriptTag: async () => {}, evaluate: async () => {} }),\n' +
      '  close: async () => {}\n' +
      '}) } };\n');
    const result = runRender();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /x2 themes, securityLevel=strict/);
    assert.doesNotMatch(result.stdout, /matches the VS Code extension/);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`Mermaid gate controls: ${11 - failures} passed, ${failures} failed.`);
process.exitCode = failures ? 1 : 0;
