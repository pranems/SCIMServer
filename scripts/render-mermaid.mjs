/**
 * Render EVERY ```mermaid block in the repo's Markdown in a real Chromium page,
 * which is exactly what the VS Code Markdown preview (a webview) and GitHub do.
 *
 * Why this exists in addition to scripts/validate-mermaid.mjs:
 *   `mermaid.parse()` only checks GRAMMAR. A diagram can parse cleanly and still
 *   FAIL TO RENDER (unsupported shape combination, bad classDef target, a
 *   reserved node id, an edge to an undeclared node, ...). A render failure is
 *   what the operator actually sees as a blank or error box in the preview, so
 *   the render check is the one that matches reality.
 *
 * Usage:
 *   node scripts/render-mermaid.mjs            # docs/ + root *.md
 *   node scripts/render-mermaid.mjs <file...>  # specific files
 *
 * Exits non-zero when any block fails to render.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

// Playwright lives in web/node_modules; mermaid's UMD bundle at the repo root.
let chromium;
try {
  ({ chromium } = require(join(ROOT, 'web', 'node_modules', 'playwright-core')));
} catch {
  try {
    ({ chromium } = require(join(ROOT, 'web', 'node_modules', '@playwright', 'test')));
  } catch {
    console.error('SKIP: playwright not found under web/node_modules. Run `npm ci` in web/.');
    process.exit(0);
  }
}

const MERMAID_UMD = join(ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
if (!existsSync(MERMAID_UMD)) {
  console.error('SKIP: mermaid not installed. Run `npm install` at the repo root.');
  process.exit(0);
}

/**
 * VERSION-DRIFT GUARD.
 *
 * The gate is only trustworthy if it uses the SAME Mermaid version as the thing
 * that actually renders the diagram for a human. On 2026-07-27 the gate ran
 * mermaid 11.6 while the VS Code extension bundled 11.12.2, and two diagrams
 * that 11.6 accepted were rejected by 11.12.2 - so they were broken in the
 * operator's preview while the gate stayed green. Detect that drift loudly.
 */
function checkVersionDrift() {
  const ours = JSON.parse(
    readFileSync(join(ROOT, 'node_modules', 'mermaid', 'package.json'), 'utf8'),
  ).version;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return ours;
  const extRoot = join(home, '.vscode', 'extensions');
  let extDir;
  try {
    extDir = readdirSync(extRoot)
      .filter((d) => d.startsWith('bierner.markdown-mermaid-'))
      .sort()
      .pop();
  } catch {
    return ours;
  }
  if (!extDir) return ours;
  // The extension bundles Mermaid into a single webview bundle; the version is
  // present as a `version:"x.y.z"` literal.
  const candidates = ['dist-preview/index.bundle.js', 'dist-notebook/index.bundle.js'];
  for (const rel of candidates) {
    const p = join(extRoot, extDir, ...rel.split('/'));
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/version:"(1[0-9]\.\d+\.\d+)"/);
    if (m) {
      if (m[1] !== ours) {
        console.warn(
          `\nWARNING: Mermaid VERSION DRIFT.\n` +
            `  gate uses          : mermaid ${ours} (root package.json)\n` +
            `  VS Code renders w/ : mermaid ${m[1]} (${extDir})\n` +
            `  A diagram can pass this gate and still break in the preview.\n` +
            `  Fix: npm install --save-exact mermaid@${m[1]} at the repo root.\n`,
        );
      } else {
        console.log(`Mermaid ${ours} (matches the VS Code extension bundle - no drift).`);
      }
      return ours;
    }
  }
  return ours;
}
checkVersionDrift();

function collect(dir, out = [], depth = 0) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'coverage', 'test-results', 'build'].includes(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (dir === '.' && depth === 0 && entry !== 'docs') continue;
      collect(full, out, depth + 1);
    } else if (extname(entry).toLowerCase() === '.md') {
      out.push(full);
    }
  }
  return out;
}

const targets = process.argv.slice(2);
const files = [];
for (const r of targets.length > 0 ? targets : ['docs', '.']) {
  try {
    const st = statSync(r);
    if (st.isDirectory()) collect(r, files);
    else files.push(r);
  } catch {
    console.error(`skip (not found): ${r}`);
  }
}

const FENCE = /^```mermaid[ \t]*$/;
const blocks = [];
for (const file of [...new Set(files)].sort()) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE.test(lines[i])) continue;
    const start = i + 1;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !/^```\s*$/.test(lines[j]); j++) body.push(lines[j]);
    i = j;
    blocks.push({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      line: start,
      text: body.join('\n'),
    });
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
await page.addScriptTag({ path: MERMAID_UMD });
await page.evaluate(() => {
  window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
});

const failures = [];
for (const [idx, b] of blocks.entries()) {
  const result = await page.evaluate(
    async ([text, id]) => {
      try {
        const { svg } = await window.mermaid.render(`m${id}`, text);
        if (!svg || svg.length === 0) return { ok: false, error: 'render produced an empty SVG' };
        // Mermaid emits an "error icon" SVG instead of throwing for some failures.
        if (/aria-roledescription="error"|class="error-icon"|Syntax error in text/i.test(svg)) {
          return { ok: false, error: 'mermaid produced its ERROR diagram instead of the requested one' };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    [b.text, idx],
  );
  if (!result.ok) failures.push({ ...b, error: result.error });
}

await browser.close();

console.log(`Mermaid blocks rendered: ${blocks.length}`);
if (failures.length === 0) {
  console.log('All Mermaid diagrams render cleanly in a real browser.');
  process.exit(0);
}

console.error(`\n${failures.length} Mermaid diagram(s) FAILED to render:\n`);
for (const f of failures) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.error.split('\n').slice(0, 8).join('\n    ')}\n`);
}
process.exit(1);
