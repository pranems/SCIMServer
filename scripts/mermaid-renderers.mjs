/**
 * Locate every Mermaid RENDERER that can claim the VS Code Markdown preview.
 *
 * There are TWO sources, and the 2026-07-28 investigation was defeated by only
 * knowing about one of them:
 *
 *   1. BUILT-IN: VS Code >= 1.104 ships `vscode.mermaid-markdown-features`
 *      inside its own install directory. It contributes `markdown.previewScripts`
 *      and bundles its own Mermaid. It is present for EVERY user, always.
 *   2. MARKETPLACE: `bierner.markdown-mermaid` under ~/.vscode/extensions, which
 *      predates the built-in and does the SAME job with the SAME config
 *      namespace (`markdown-mermaid.*`).
 *
 * When BOTH are present, two preview scripts are injected into the same webview
 * and two different Mermaid builds race to render the same `<pre class="mermaid">`
 * nodes. Whichever loses can replace or re-parse the other's output, and the
 * result is a blank diagram with no error - the exact recurring symptom.
 *
 * Shared by scripts/doctor-mermaid.mjs and scripts/render-mermaid.mjs so the gate
 * and the diagnostic can never disagree about which Mermaid actually renders.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';

/** Pull a `version:"x.y.z"` literal out of a bundled webview script. */
function versionFromBundle(files) {
  for (const f of files) {
    if (!existsSync(f)) continue;
    let content;
    try {
      content = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const m = content.match(/version:"(\d+\.\d+\.\d+)"/);
    if (m) return m[1];
  }
  return null;
}

/** Candidate roots for the VS Code application's own bundled extensions. */
function appExtensionRoots() {
  const bases = [
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Microsoft VS Code'),
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Microsoft VS Code Insiders'),
    join(process.env.LOCALAPPDATA ?? join(HOME, 'AppData/Local'), 'Programs/Microsoft VS Code'),
    join(process.env.LOCALAPPDATA ?? join(HOME, 'AppData/Local'), 'Programs/Microsoft VS Code Insiders'),
    '/usr/share/code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app',
  ];
  const roots = [];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    // Plain layout: <base>/resources/app/extensions
    const plain = join(base, 'resources', 'app', 'extensions');
    if (existsSync(plain)) roots.push(plain);
    // Versioned layout: <base>/<hash>/resources/app/extensions
    let entries = [];
    try {
      entries = readdirSync(base);
    } catch {
      /* ignore */
    }
    for (const e of entries) {
      const versioned = join(base, e, 'resources', 'app', 'extensions');
      try {
        if (statSync(versioned).isDirectory()) roots.push(versioned);
      } catch {
        /* not a versioned install dir */
      }
    }
  }
  return roots;
}

/**
 * @returns {{kind:'builtin'|'marketplace', id:string, dir:string, version:string|null, defaultTheme:string}[]}
 *          Every renderer found, built-ins first.
 */
export function findMermaidRenderers() {
  const found = [];

  // A Windows install keeps one directory per VS Code version it has ever run
  // (C:\Program Files\Microsoft VS Code\<hash>\...). Only the most recently
  // written one is the ACTIVE editor, so collect candidates and keep the newest.
  const builtinCandidates = [];
  for (const root of appExtensionRoots()) {
    const dir = join(root, 'mermaid-markdown-features');
    if (!existsSync(dir)) continue;
    let mtime = 0;
    try {
      mtime = statSync(dir).mtimeMs;
    } catch {
      /* ignore */
    }
    const version = versionFromBundle([
      join(dir, 'markdown-preview-out', 'index.js'),
      join(dir, 'notebook-out', 'index.js'),
      join(dir, 'chat-webview-out', 'index.js'),
    ]);
    let defaultTheme = 'vscode';
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      defaultTheme =
        pkg?.contributes?.configuration?.properties?.['markdown-mermaid.lightModeTheme']?.default ?? 'vscode';
    } catch {
      /* ignore */
    }
    builtinCandidates.push({ kind: 'builtin', id: 'vscode.mermaid-markdown-features', dir, version, defaultTheme, mtime });
  }
  if (builtinCandidates.length > 0) {
    builtinCandidates.sort((a, b) => b.mtime - a.mtime);
    const active = builtinCandidates[0];
    found.push({ ...active, staleInstallDirs: builtinCandidates.length - 1 });
  }

  const marketRoot = join(HOME, '.vscode', 'extensions');
  let entries = [];
  try {
    entries = readdirSync(marketRoot);
  } catch {
    /* no marketplace extensions */
  }
  // An uninstalled extension stays on disk until VS Code restarts; it is listed
  // in `.obsolete` and is NOT loaded, so it must not be counted as a renderer.
  let obsolete = {};
  try {
    obsolete = JSON.parse(readFileSync(join(marketRoot, '.obsolete'), 'utf8'));
  } catch {
    /* no marker file */
  }
  const bierner = entries
    .filter((d) => d.startsWith('bierner.markdown-mermaid-') && !obsolete[d])
    .sort()
    .pop();
  if (bierner) {
    const dir = join(marketRoot, bierner);
    found.push({
      kind: 'marketplace',
      id: 'bierner.markdown-mermaid',
      dir,
      version: versionFromBundle([
        join(dir, 'dist-preview', 'index.bundle.js'),
        join(dir, 'dist-notebook', 'index.bundle.js'),
      ]),
      defaultTheme: 'default',
    });
  }

  return found;
}

/**
 * The renderer whose Mermaid version the gate must match. The BUILT-IN wins:
 * it ships with the editor, so it is present for every reader of this repo,
 * whereas a marketplace extension is optional (and, since VS Code 1.104, is a
 * redundant conflict that should be uninstalled).
 */
export function authoritativeRenderer(renderers = findMermaidRenderers()) {
  return renderers.find((r) => r.kind === 'builtin') ?? renderers[0] ?? null;
}

/** Directory of this module, for callers that need repo-relative paths. */
export const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
