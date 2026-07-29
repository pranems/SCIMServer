/**
 * Export Markdown docs to standalone HTML with every Mermaid diagram
 * PRE-RENDERED as inline SVG.
 *
 * WHY THIS EXISTS
 * ---------------
 * The VS Code Markdown preview renders Mermaid through an extension. That has
 * now failed three times for reasons that had nothing to do with the diagrams
 * (a renderer version drift, a gitignored recommendation, and finally TWO
 * renderers racing in one webview - see scripts/doctor-mermaid.mjs). Every one
 * of those failures presented as "no diagram, no error".
 *
 * This exporter removes the editor from the loop entirely: the SVG is generated
 * here, by the same headless Chromium the render gate uses, and baked into the
 * HTML. The result opens in ANY browser - including VS Code's Simple Browser -
 * with no extension, no workspace trust, and no version pinning involved. It is
 * the guaranteed-visible path when the preview misbehaves, and a convenient way
 * to read or share a long design doc.
 *
 * Output is written under test-results/ (gitignored) - these are build artifacts,
 * not committed documentation.
 *
 * Usage:
 *   node scripts/export-docs-html.mjs                     # docs/auth + docs/perf
 *   node scripts/export-docs-html.mjs docs/auth/FOO.md    # specific files/folders
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const OUT_DIR = join(ROOT, 'test-results', 'docs-html');

let chromium;
try {
  ({ chromium } = require(join(ROOT, 'web', 'node_modules', 'playwright-core')));
} catch {
  console.error('FATAL: playwright-core not found under web/node_modules. Run `npm ci` in web/.');
  process.exit(1);
}
const MERMAID_UMD = join(ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
if (!existsSync(MERMAID_UMD)) {
  console.error('FATAL: mermaid not installed. Run `npm install` at the repo root.');
  process.exit(1);
}
const MarkdownIt = require(join(ROOT, 'node_modules', 'markdown-it'));

function collect(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collect(full, out);
    else if (extname(entry).toLowerCase() === '.md') out.push(full);
  }
  return out;
}

const targets = process.argv.slice(2);
const files = [];
for (const t of targets.length > 0 ? targets : ['docs/auth', 'docs/perf']) {
  try {
    const st = statSync(t);
    if (st.isDirectory()) collect(t, files);
    else files.push(t);
  } catch {
    console.error(`skip (not found): ${t}`);
  }
}
const sorted = [...new Set(files)].sort();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
await page.addScriptTag({ path: MERMAID_UMD });
// Same config the VS Code built-in renderer uses.
await page.evaluate(() =>
  window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', maxTextSize: 50_000 }),
);

/** Render one mermaid source to SVG markup (or an error box). */
async function renderMermaid(source, id) {
  return page.evaluate(
    async ([text, key]) => {
      try {
        const { svg } = await window.mermaid.render(`x${key}`, text);
        return { ok: true, svg };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    [source, id],
  );
}

mkdirSync(OUT_DIR, { recursive: true });

const CSS = `
:root { color-scheme: light; }
body { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem 6rem;
  font: 15px/1.65 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1f2328; }
h1,h2,h3,h4 { line-height:1.25; margin-top:2em; }
h1 { border-bottom:1px solid #d0d7de; padding-bottom:.3em; }
h2 { border-bottom:1px solid #d8dee4; padding-bottom:.25em; }
code { background:#f0f1f3; padding:.15em .35em; border-radius:4px; font-size:.88em; }
pre { background:#f6f8fa; padding:1rem; border-radius:8px; overflow:auto; }
pre code { background:none; padding:0; }
table { border-collapse:collapse; width:100%; margin:1rem 0; display:block; overflow-x:auto; }
th,td { border:1px solid #d0d7de; padding:.45rem .7rem; text-align:left; vertical-align:top; }
th { background:#f6f8fa; }
blockquote { border-left:4px solid #d0d7de; margin:1rem 0; padding:.1rem 1rem; color:#59636e; }
a { color:#0969da; }
.mermaid-figure { margin:1.5rem 0; padding:1rem; border:1px solid #d0d7de;
  border-radius:8px; background:#fff; overflow-x:auto; text-align:center; }
.mermaid-figure svg { max-width:100%; height:auto; }
.mermaid-error { border-color:#cf222e; background:#fff5f5; color:#cf222e; text-align:left; }
.nav { background:#f6f8fa; border:1px solid #d0d7de; border-radius:8px; padding:1rem 1.25rem; margin-bottom:2rem; }
.banner { background:#ddf4ff; border:1px solid #54aeff; border-radius:8px; padding:.75rem 1rem; margin-bottom:1.5rem; font-size:.9em; }
`;

const md = new MarkdownIt({ html: true, linkify: true });
const index = [];
let totalDiagrams = 0;
let totalFailed = 0;
const failures = [];

for (const file of sorted) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');

  // Pull out mermaid fences, render them, and substitute a placeholder that
  // markdown-it will pass through untouched (html:true).
  const figures = [];
  const lines = src.split(/\r?\n/);
  const outLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^```mermaid[ \t]*$/.test(lines[i])) {
      outLines.push(lines[i]);
      continue;
    }
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !/^```\s*$/.test(lines[j]); j++) body.push(lines[j]);
    i = j;
    figures.push(body.join('\n'));
    outLines.push(`@@MERMAID_${figures.length - 1}@@`);
  }

  let html = md.render(outLines.join('\n'));

  for (let k = 0; k < figures.length; k++) {
    totalDiagrams++;
    // NOTE: the id MUST be a plain, selector-safe token. Mermaid uses it in a
    // CSS selector internally, so a filename-derived id (spaces, parentheses,
    // dots) makes render() throw for reasons that have nothing to do with the
    // diagram - which is exactly the false failure this comment prevents.
    const r = await renderMermaid(figures[k], `${totalDiagrams}`);
    let block;
    if (r.ok) {
      block = `<div class="mermaid-figure">${r.svg}</div>`;
    } else {
      totalFailed++;
      failures.push(`${rel} (diagram ${k + 1}): ${r.error}`);
      block = `<div class="mermaid-figure mermaid-error"><strong>Diagram failed to render</strong><pre>${r.error.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre></div>`;
    }
    html = html.replace(new RegExp(`<p>@@MERMAID_${k}@@</p>|@@MERMAID_${k}@@`), block);
  }

  const outName = `${rel.replace(/[\\/]/g, '__').replace(/\.md$/, '')}.html`;
  writeFileSync(
    join(OUT_DIR, outName),
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${rel}</title><style>${CSS}</style></head><body>
<div class="banner">Generated from <code>${rel}</code> with all ${figures.length} Mermaid diagram(s) pre-rendered as inline SVG.
No VS Code extension required. Regenerate with <code>npm run docs:html</code>. <a href="index.html">All docs</a></div>
${html}</body></html>`,
    'utf8',
  );
  index.push({ rel, outName, count: figures.length });
}

await browser.close();

const withDiagrams = index.filter((i) => i.count > 0).sort((a, b) => b.count - a.count);
const without = index.filter((i) => i.count === 0).sort((a, b) => a.rel.localeCompare(b.rel));
writeFileSync(
  join(OUT_DIR, 'index.html'),
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>SCIMServer docs (diagrams pre-rendered)</title>
<style>${CSS}</style></head><body>
<h1>SCIMServer docs - diagrams pre-rendered</h1>
<div class="banner">Every Mermaid diagram below is baked into the HTML as inline SVG by
<code>scripts/export-docs-html.mjs</code>, using the same headless Chromium and the same Mermaid
version the VS Code built-in renderer bundles. Nothing here depends on a VS Code extension,
workspace trust, or the Markdown preview. <strong>${totalDiagrams} diagrams across ${index.length} documents${totalFailed ? `, ${totalFailed} FAILED` : ', all rendered cleanly'}.</strong></div>
<div class="nav"><h2 style="margin-top:0">Documents with diagrams (${withDiagrams.length})</h2><ul>
${withDiagrams.map((i) => `<li><a href="${i.outName}">${i.rel}</a> - <strong>${i.count}</strong> diagram${i.count === 1 ? '' : 's'}</li>`).join('\n')}
</ul></div>
<div class="nav"><h2 style="margin-top:0">Documents without diagrams (${without.length})</h2><ul>
${without.map((i) => `<li><a href="${i.outName}">${i.rel}</a></li>`).join('\n')}
</ul></div>
</body></html>`,
  'utf8',
);

console.log(`Wrote ${index.length} HTML files to ${relative(ROOT, OUT_DIR).replace(/\\/g, '/')}`);
for (const f of failures) console.error('  FAIL ' + f);
console.log(`Diagrams pre-rendered: ${totalDiagrams}${totalFailed ? `  FAILED: ${totalFailed}` : '  (all clean)'}`);
console.log(`Open: ${join(OUT_DIR, 'index.html')}`);
process.exit(totalFailed > 0 ? 1 : 0);
