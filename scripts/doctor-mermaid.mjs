/**
 * MERMAID DOCTOR - diagnose why diagrams are not visible in the VS Code preview.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other mermaid check in this repo validates CONTENT (does the diagram
 * parse / render). The 2026-07-28 investigation proved that content can be
 * 100% healthy - all 596 blocks render under the extension's own config, in
 * both themes - while the operator still sees no diagrams. That is because the
 * remaining failure modes are all RENDERER-SIDE:
 *
 *   the extension is missing, disabled by Workspace Trust, shadowed by another
 *   preview extension, mis-versioned relative to the gate, or the human is
 *   looking at the raw editor instead of the preview.
 *
 * None of those can EVER be caught by a content gate, so each recurrence used
 * to trigger a fresh manual hunt that (twice) went looking for syntax errors
 * that were not there. This script replaces that hunt with one command.
 *
 * Usage:
 *   node scripts/doctor-mermaid.mjs                  # environment only
 *   node scripts/doctor-mermaid.mjs <file.md>        # + measure that file's diagrams
 *
 * Exit codes: 0 = no blocking problem found, 1 = at least one BLOCKER.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const EXT_ID = 'bierner.markdown-mermaid';

const findings = [];
const add = (level, title, detail, remedy) => findings.push({ level, title, detail, remedy });

// ---------------------------------------------------------------------------
// 1. Is the extension installed at all?
// ---------------------------------------------------------------------------
const extRoot = join(HOME, '.vscode', 'extensions');
let extDir = null;
try {
  extDir = readdirSync(extRoot)
    .filter((d) => d.startsWith(`${EXT_ID}-`))
    .sort()
    .pop() ?? null;
} catch {
  /* extensions dir unreadable */
}

if (!extDir) {
  add(
    'BLOCKER',
    'The Mermaid preview extension is NOT installed',
    `No ${EXT_ID}-* directory under ${extRoot}. VS Code's built-in Markdown preview has NO mermaid support of its own, so every diagram renders as a plain code block with no error.`,
    `Install it: code --install-extension ${EXT_ID}  (or search "Markdown Preview Mermaid Support" in the Extensions view)`,
  );
} else {
  add('OK', 'Extension installed', extDir, null);
}

// ---------------------------------------------------------------------------
// 2. Does the gate's mermaid version match the one that actually renders?
//    A mismatch means the gate can be green while the preview is broken.
//    (This exact drift bit us on 2026-07-27: gate 11.6 vs extension 11.12.2.)
// ---------------------------------------------------------------------------
let gateVersion = null;
try {
  gateVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'mermaid', 'package.json'), 'utf8')).version;
} catch {
  add(
    'WARN',
    'Gate mermaid not installed',
    'node_modules/mermaid is absent at the repo root, so the render gate silently SKIPS.',
    'Run `npm install` at the repo root.',
  );
}

let extVersion = null;
if (extDir) {
  for (const rel of ['dist-preview/index.bundle.js', 'dist-notebook/index.bundle.js']) {
    const p = join(extRoot, extDir, ...rel.split('/'));
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/version:"(\d+\.\d+\.\d+)"/);
    if (m) {
      extVersion = m[1];
      break;
    }
  }
}
if (gateVersion && extVersion) {
  if (gateVersion === extVersion) {
    add('OK', 'Mermaid version', `gate and extension both on ${gateVersion}`, null);
  } else {
    add(
      'BLOCKER',
      'Mermaid VERSION DRIFT between the gate and the real renderer',
      `gate uses ${gateVersion}; the VS Code extension renders with ${extVersion}. A diagram can pass the gate and still break in the preview.`,
      `npm install --save-exact mermaid@${extVersion}   (at the repo root, then re-run the render gate)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Workspace Trust. THE SILENT KILLER.
//    Per https://code.visualstudio.com/docs/editing/workspaces/workspace-trust
//    "extensions that have not explicitly opted into Workspace Trust are
//     disabled by default in Restricted Mode."
//    bierner.markdown-mermaid declares no `capabilities.untrustedWorkspaces`,
//    so in Restricted Mode it is DISABLED and mermaid fences fall back to plain
//    code blocks - no diagram, no error, nothing to see. Default
//    security.workspace.trust.startupPrompt is "never", so the only signal is a
//    dismissible banner that is very easy to miss.
// ---------------------------------------------------------------------------
let declaresTrust = null;
if (extDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(extRoot, extDir, 'package.json'), 'utf8'));
    declaresTrust = Boolean(pkg?.capabilities?.untrustedWorkspaces);
  } catch {
    /* ignore */
  }
}

let trustedUris = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = join(process.env.APPDATA || join(HOME, '.config'), 'Code', 'User', 'globalStorage', 'state.vscdb');
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'content.trust.model.key'").get();
    db.close();
    if (row) trustedUris = (JSON.parse(String(row.value)).uriTrustInfo ?? []).filter((u) => u.trusted).map((u) => String(u.uri?.fsPath ?? '').replace(/\\/g, '/').toLowerCase());
  }
} catch {
  /* node:sqlite unavailable (Node < 22) or db locked - degrade to advisory */
}

const here = ROOT.replace(/\\/g, '/').toLowerCase();
if (trustedUris === null) {
  add(
    'CHECK',
    'Workspace Trust could not be read automatically',
    'Restricted Mode DISABLES the mermaid extension entirely (it declares no untrustedWorkspaces support), and the only on-screen signal is a dismissible banner. This is the single most likely cause of "no diagrams, no error".',
    'Command Palette -> "Workspaces: Manage Workspace Trust". If it says Restricted Mode, click Trust and reopen the preview.',
  );
} else {
  const covered = trustedUris.some((t) => t && (here === t || here.startsWith(t.endsWith('/') ? t : `${t}/`)));
  if (covered) {
    add('OK', 'Workspace Trust', 'this folder is covered by a trusted path', null);
  } else {
    add(
      declaresTrust ? 'WARN' : 'BLOCKER',
      'This workspace is NOT in the trusted-folders list',
      `${ROOT} is not covered by any entry in VS Code's trusted-folders store. In Restricted Mode VS Code disables every extension that has not opted into Workspace Trust, and ${EXT_ID} declares ${declaresTrust ? 'support' : 'NO support'} - so mermaid fences render as PLAIN CODE BLOCKS with no error at all.\n     (The store is flushed periodically, so if you trusted this folder in the current session it may not be recorded yet - verify in the UI.)`,
      'Command Palette -> "Workspaces: Manage Workspace Trust" -> Trust. Then reopen the preview.',
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Is the workspace recommendation actually present?
//    copilot-instructions.md claimed this file existed for months. It did not:
//    .gitignore excluded the whole .vscode folder, so a fresh clone never got a
//    recommendation and nobody was ever prompted to install the extension.
// ---------------------------------------------------------------------------
const recFile = join(ROOT, '.vscode', 'extensions.json');
if (!existsSync(recFile)) {
  add(
    'BLOCKER',
    '.vscode/extensions.json is missing',
    'Nobody cloning this repo is prompted to install the mermaid extension, so a fresh machine silently has no diagram rendering.',
    'Create .vscode/extensions.json with the recommendation AND make sure .gitignore does not exclude it.',
  );
} else {
  const rec = readFileSync(recFile, 'utf8');
  if (!rec.includes(EXT_ID)) {
    add('WARN', '.vscode/extensions.json does not recommend the mermaid extension', recFile, `Add "${EXT_ID}" to recommendations[].`);
  } else {
    add('OK', 'Workspace recommendation present', `.vscode/extensions.json recommends ${EXT_ID}`, null);
  }
}

// ---------------------------------------------------------------------------
// 5. Another extension shadowing the Markdown preview.
//    Markdown Preview Enhanced registers its OWN preview command and bundles a
//    DIFFERENT mermaid, so Ctrl+Shift+V can end up in a renderer this repo has
//    never validated against.
// ---------------------------------------------------------------------------
const SHADOWERS = ['shd101wyy.markdown-preview-enhanced', 'goessner.mdmath', 'yzhang.markdown-all-in-one'];
try {
  const installed = readdirSync(extRoot);
  const clashes = SHADOWERS.filter((s) => installed.some((d) => d.startsWith(`${s}-`)));
  if (clashes.length > 0) {
    add(
      'WARN',
      'Another Markdown preview extension is installed',
      clashes.join(', '),
      'Markdown Preview Enhanced in particular hijacks the preview and bundles its own Mermaid. Make sure you are opening the BUILT-IN preview (Ctrl+Shift+V / "Markdown: Open Preview"), not a third-party one.',
    );
  } else {
    add('OK', 'No competing Markdown preview extension', 'built-in preview will be used', null);
  }
} catch {
  /* ignore */
}

// ---------------------------------------------------------------------------
// 6. User settings that can hide an otherwise-healthy diagram.
// ---------------------------------------------------------------------------
try {
  const us = join(process.env.APPDATA || join(HOME, '.config'), 'Code', 'User', 'settings.json');
  if (existsSync(us)) {
    const raw = readFileSync(us, 'utf8');
    const maxHeight = raw.match(/"markdown-mermaid\.maxHeight"\s*:\s*"?([^",}\r\n]+)/);
    if (maxHeight && maxHeight[1].trim() && maxHeight[1].trim() !== '0') {
      add(
        'WARN',
        'markdown-mermaid.maxHeight is set',
        `value = ${maxHeight[1].trim()}. This repo has 96 diagrams taller than 1200px; a small maxHeight clips them so only a sliver is visible.`,
        'Clear markdown-mermaid.maxHeight (empty = unlimited) or raise it.',
      );
    }
    const langs = raw.match(/"markdown-mermaid\.languages"\s*:\s*(\[[^\]]*\])/);
    if (langs && !/mermaid/i.test(langs[1])) {
      add('BLOCKER', 'markdown-mermaid.languages no longer includes "mermaid"', langs[1], 'Restore the default ["mermaid"].');
    }
  }
} catch {
  /* ignore */
}

// ---------------------------------------------------------------------------
// 7. Optional: measure a specific file's diagrams, so "it looks blank" gets a
//    factual answer (rendered? how many pixels? any text?).
// ---------------------------------------------------------------------------
const target = process.argv[2];
let measured = null;
if (target) {
  const file = resolve(ROOT, target);
  if (!existsSync(file)) {
    add('WARN', 'File to measure not found', file, null);
  } else {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^```mermaid[ \t]*$/.test(lines[i])) continue;
      const start = i + 1;
      const body = [];
      let j = i + 1;
      for (; j < lines.length && !/^```\s*$/.test(lines[j]); j++) body.push(lines[j]);
      i = j;
      blocks.push({ line: start, text: body.join('\n') });
    }
    let chromium;
    try {
      ({ chromium } = require(join(ROOT, 'web', 'node_modules', 'playwright-core')));
    } catch {
      add('WARN', 'playwright-core not found', 'cannot measure diagrams', 'npm ci in web/');
    }
    const umd = join(ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
    if (chromium && existsSync(umd)) {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
      await page.addScriptTag({ path: umd });
      // EXACTLY the extension's config for a light VS Code theme.
      await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', maxTextSize: 50000 }));
      measured = [];
      for (const [idx, b] of blocks.entries()) {
        const r = await page.evaluate(
          async ([text, id]) => {
            try {
              const { svg } = await window.mermaid.render(`dr${id}`, text);
              const host = document.getElementById('host');
              host.innerHTML = svg;
              const el = host.querySelector('svg');
              const bb = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
              const textLen = (el ? el.textContent : '').replace(/\s+/g, '').length;
              host.innerHTML = '';
              return { ok: true, w: Math.round(bb.width), h: Math.round(bb.height), textLen };
            } catch (e) {
              return { ok: false, error: String((e && e.message) || e) };
            }
          },
          [b.text, idx],
        );
        measured.push({ line: b.line, ...r });
      }
      await browser.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const ICON = { OK: '  ok  ', WARN: ' warn ', BLOCKER: 'BLOCKER', CHECK: 'CHECK ' };
console.log('\nMermaid preview doctor');
console.log('======================');
console.log(`workspace: ${ROOT}\n`);

for (const f of findings) {
  console.log(`[${ICON[f.level]}] ${f.title}`);
  if (f.level !== 'OK') {
    console.log(`     ${f.detail}`);
    if (f.remedy) console.log(`     FIX: ${f.remedy}`);
  } else if (f.detail) {
    console.log(`     ${f.detail}`);
  }
  console.log();
}

if (measured) {
  console.log(`Measured ${measured.length} diagram(s) in ${relative(ROOT, resolve(ROOT, target)).replace(/\\/g, '/')} using the extension's exact config:`);
  for (const m of measured) {
    if (!m.ok) console.log(`  line ${String(m.line).padStart(5)}  FAILED  ${m.error}`);
    else if (m.w < 40 || m.h < 20 || m.textLen === 0) console.log(`  line ${String(m.line).padStart(5)}  DEGENERATE  ${m.w}x${m.h}px text=${m.textLen}`);
    else console.log(`  line ${String(m.line).padStart(5)}  ok  ${m.w}x${m.h}px text=${m.textLen}`);
  }
  console.log();
}

const blockers = findings.filter((f) => f.level === 'BLOCKER');
const checks = findings.filter((f) => f.level === 'CHECK');

console.log('---');
if (blockers.length > 0) {
  console.log(`${blockers.length} BLOCKER(S) found. Fix these first - they each hide diagrams with NO error message:`);
  for (const b of blockers) console.log(`  - ${b.title}`);
} else {
  console.log('No blocking environment problem detected.');
}
if (checks.length > 0) {
  for (const c of checks) console.log(`  ! ${c.title} - verify manually.`);
}
console.log(
  '\nIf everything above is clean and you STILL see no diagram, in order of likelihood:\n' +
    '  1. You are looking at the RAW EDITOR. Mermaid only renders in the Markdown Preview:\n' +
    '     Ctrl+Shift+V (preview) or Ctrl+K V (side-by-side). It NEVER renders in the editor tab.\n' +
    '  2. The preview is STALE. Close the preview tab and reopen it, or run\n' +
    '     "Developer: Reload Window". The extension only refreshes on config/theme change.\n' +
    '  3. The diagram is very tall (this repo has 96 diagrams over 1200px) and you are\n' +
    '     looking at whitespace inside it. Scroll, or use the diagram zoom controls.\n' +
    '  4. Content really is broken: run `npm run docs:mermaid:render`.\n',
);

process.exit(blockers.length > 0 ? 1 : 0);
