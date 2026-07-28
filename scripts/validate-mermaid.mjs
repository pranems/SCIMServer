/**
 * Validate every ```mermaid block in the repo's Markdown so a broken diagram can
 * never ship. A Mermaid syntax error does not fail any build - it silently
 * renders as an error box (or nothing) in the VS Code preview and on GitHub,
 * which is exactly the "I cannot see the diagrams" symptom.
 *
 * Usage:
 *   node scripts/validate-mermaid.mjs            # validate docs/ + root *.md
 *   node scripts/validate-mermaid.mjs <path...>  # validate specific files/dirs
 *
 * Exits non-zero when any block fails to parse.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { JSDOM } from 'jsdom';

// Mermaid's parser touches the DOM even when only parsing, so stand up a
// minimal one before importing it.
const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// `navigator` is a getter-only global on modern Node, so define it instead of
// assigning (assignment throws TypeError).
if (!('navigator' in globalThis) || globalThis.navigator === undefined) {
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
}

const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

const ROOT = process.cwd();
const targets = process.argv.slice(2);
const roots = targets.length > 0 ? targets : ['docs', '.'];

/** Collect .md files, skipping node_modules and build output. */
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
    // For the repo root only scan top-level *.md (docs/ is walked separately).
    if (st.isDirectory()) {
      if (dir === '.' && depth === 0 && entry !== 'docs') continue;
      collect(full, out, depth + 1);
    } else if (extname(entry).toLowerCase() === '.md') {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const r of roots) {
  try {
    const st = statSync(r);
    if (st.isDirectory()) collect(r, files);
    else files.push(r);
  } catch {
    console.error(`skip (not found): ${r}`);
  }
}

const FENCE = /^```mermaid[ \t]*$/;
let total = 0;
const failures = [];

for (const file of [...new Set(files)].sort()) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE.test(lines[i])) continue;
    const start = i + 1;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !/^```\s*$/.test(lines[j]); j++) body.push(lines[j]);
    i = j;
    total++;
    const text = body.join('\n');
    try {
      await mermaid.parse(text);
    } catch (err) {
      failures.push({
        file: relative(ROOT, file).replace(/\\/g, '/'),
        line: start,
        message: String(err?.message ?? err).split('\n').slice(0, 6).join('\n'),
      });
    }
  }
}

console.log(`Mermaid blocks parsed: ${total}`);
if (failures.length === 0) {
  console.log('All Mermaid diagrams parse cleanly.');
  process.exit(0);
}

console.error(`\n${failures.length} Mermaid diagram(s) FAILED to parse:\n`);
for (const f of failures) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.message.replace(/\n/g, '\n    ')}\n`);
}
process.exit(1);
