#!/usr/bin/env node
/**
 * audit-doc-content.mjs - checks what the user-facing docs CLAIM against what
 * the source actually contains.
 *
 * scripts/audit-doc-freshness.ps1 gates a document's CURRENCY MARKERS: version
 * header, provenance date, links, source coupling. None of that reads the
 * prose. A doc can pass every one of those checks while telling the reader
 * there are 86 route handlers when there are 116 - and a freshly stamped
 * document asserting a wrong number is worse than an obviously stale one,
 * because the stamp invites trust.
 *
 * So this gate extracts ground truth from source and compares it to the
 * numbers and identifiers the docs state:
 *
 *   C1  route-handler count claims match the controllers
 *   C2  controller count claims match
 *   C3  endpoint-settings count + type breakdown match the flag registry
 *   C4  preset count claims match built-in-presets
 *   C5  every settings key is documented in the settings guide
 *   C6  every auth reason code is documented in the authentication guide
 *   C7  every shipped web page is mentioned in the UI guide (warning only)
 *   C8  no PHANTOM settings - a doc must not describe a control that does not
 *       exist in the registry (a reader would set it and nothing would happen)
 *   C9  every route handler has a matching path in COMPLETE_API_REFERENCE
 *
 * Usage:
 *   node scripts/audit-doc-content.mjs            # audit
 *   node scripts/audit-doc-content.mjs --truth    # print ground truth only
 *   node scripts/audit-doc-content.mjs --selftest # prove each check can fail
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.DOC_AUDIT_ROOT ?? process.cwd();
const p = (...parts) => join(ROOT, ...parts);

// ---------------------------------------------------------------- helpers
function walk(dir, filter, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

const read = (f) => readFileSync(f, 'utf8');

// ------------------------------------------------------------ ground truth
export function groundTruth() {
  const t = {};

  const ctrls = walk(p('api/src'), (f) => f.endsWith('.controller.ts') && !f.includes('.spec.'));
  let handlers = 0;
  for (const f of ctrls) {
    const src = read(f);
    handlers += [...src.matchAll(/@(Get|Post|Put|Patch|Delete|Head|Options|Sse)\(/g)].length;
  }
  t.controllers = ctrls.length;
  t.routeHandlers = handlers;

  // Full route list (controller base + method segment) for C9.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  t.routes = [];
  for (const f of ctrls) {
    const src = strip(read(f));
    const base = (src.match(/@Controller\(\s*['"`]([^'"`]*)['"`]/) || [, ''])[1];
    const re = /@(Get|Post|Put|Patch|Delete|Head|Options|All|Sse)\s*\(\s*(?:['"`]([^'"`]*)['"`])?/g;
    let mm;
    while ((mm = re.exec(src)) !== null) {
      const seg = mm[2] ?? '';
      t.routes.push({
        verb: mm[1].toUpperCase(),
        path: ('/' + [base, seg].filter(Boolean).join('/')).replace(/\/+/g, '/'),
        file: f.replace(/\\/g, '/').replace(/.*api\/src\//, ''),
      });
    }
  }

  // Settings registry - the file calls itself the single source of truth.
  const regPath = p('api/src/modules/endpoint/endpoint-config.interface.ts');
  const reg = read(regPath);
  const constMap = {};
  for (const m of reg.matchAll(/^\s+([A-Z_0-9]+):\s*'([A-Za-z]+)',/gm)) constMap[m[1]] = m[2];
  const defs = reg.slice(reg.indexOf('ENDPOINT_CONFIG_FLAGS_DEFINITIONS'));
  const starts = [...defs.matchAll(/^ {2}([A-Z_0-9]+):\s*\{/gm)].map((m) => ({ i: m.index }));
  const flags = [];
  for (let i = 0; i < starts.length; i++) {
    const block = defs.slice(starts[i].i, i + 1 < starts.length ? starts[i + 1].i : defs.length);
    const k = block.match(/key:\s*ENDPOINT_CONFIG_FLAGS\.([A-Z_0-9]+)/);
    const ty = block.match(/\btype:\s*'([a-zA-Z]+)'/);
    if (!k || !ty) continue;
    flags.push({ key: constMap[k[1]] ?? k[1], type: ty[1] });
  }
  t.settings = flags;
  t.settingsCount = flags.length;
  t.settingsBool = flags.filter((f) => f.type === 'boolean').length;
  t.settingsNum = flags.filter((f) => f.type === 'number').length;
  t.settingsEnum = new Set(flags.filter((f) => f.type !== 'boolean' && f.type !== 'number').map((f) => f.type)).size;

  // Presets
  const presetsDir = p('api/src/modules/scim/endpoint-profile/presets');
  t.presets = existsSync(presetsDir)
    ? readdirSync(presetsDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
    : [];
  t.presetCount = t.presets.length;

  // Auth reason codes
  const rc = p('api/src/oauth/auth-reason-catalog.ts');
  t.reasonCodes = existsSync(rc)
    ? [...read(rc).matchAll(/reasonCode:\s*'([a-z_]+)'/g)].map((m) => m[1])
    : [];

  // Web pages
  const pagesDir = p('web/src/pages');
  t.webPages = existsSync(pagesDir)
    ? readdirSync(pagesDir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.')).map((f) => f.replace(/\.tsx$/, '')).sort()
    : [];

  // Web route PATHS, derived from TanStack file-based route names:
  //   endpoints.$endpointId.connect.tsx -> /endpoints/{id}/connect
  //   endpoints.new.tsx                 -> /endpoints/new
  //   me.tsx                            -> /me
  const routesDir = p('web/src/routes');
  t.webRoutePaths = existsSync(routesDir)
    ? [...new Set(readdirSync(routesDir)
        .filter((f) => f.endsWith('.tsx') && !f.startsWith('__'))
        .map((f) => f.replace(/\.tsx$/, ''))
        .map((n) => n
          .split('.')
          .filter((seg) => seg !== 'index')
          .map((seg) => (seg.startsWith('$') ? '{id}' : seg))
          .join('/'))
        .map((pth) => '/' + pth)
        .filter((pth) => pth !== '/'))].sort()
    : [];

  return t;
}

// ------------------------------------------------------------------ checks
const USER_FACING = () => {
  const mf = p('docs/.doc-manifest.json');
  if (!existsSync(mf)) return [];
  return JSON.parse(read(mf)).docs.map((d) => d.path);
};

export function audit(truth) {
  const failures = [];
  const warnings = [];
  const docs = USER_FACING().filter((d) => existsSync(p(d)));

  const claimCheck = (id, regex, expected, label) => {
    for (const d of docs) {
      const text = read(p(d));
      for (const m of text.matchAll(regex)) {
        const stated = parseInt(m[1], 10);
        if (stated !== expected) {
          failures.push(`[${id}] ${d}: claims ${stated} ${label}, source has ${expected}  ("${m[0].trim().slice(0, 70)}")`);
        }
      }
    }
  };

  // C1/C2 - route + controller counts
  claimCheck('C1', /(\d+)\s+route handlers/gi, truth.routeHandlers, 'route handlers');
  claimCheck('C2', /(\d+)\s+controllers\b/gi, truth.controllers, 'controllers');

  // C3 - settings count + breakdown
  claimCheck('C3', /(\d+)\s+endpoint settings controls/gi, truth.settingsCount, 'endpoint settings controls');
  claimCheck('C3', /(\d+)\s+boolean flags/gi, truth.settingsBool, 'boolean flags');
  claimCheck('C3', /(\d+)\s+numerics?\b/gi, truth.settingsNum, 'numeric settings');
  claimCheck('C3', /(\d+)\s+enums\b/gi, truth.settingsEnum, 'enum settings');

  // C4 - presets
  claimCheck('C4', /(\d+)\s+presets\b/gi, truth.presetCount, 'presets');

  // C5 - every settings key documented
  const sg = p('docs/ENDPOINT_SETTINGS_OPERATOR_GUIDE.md');
  if (existsSync(sg)) {
    const text = read(sg);
    const missing = truth.settings.map((s) => s.key).filter((k) => !text.includes(k));
    if (missing.length) failures.push(`[C5] docs/ENDPOINT_SETTINGS_OPERATOR_GUIDE.md: ${missing.length} setting(s) undocumented: ${missing.join(', ')}`);
  }

  // C6 - every reason code documented
  const ag = p('docs/AUTHENTICATION_GUIDE.md');
  if (existsSync(ag) && truth.reasonCodes.length) {
    const text = read(ag);
    const missing = truth.reasonCodes.filter((c) => !text.includes(c));
    if (missing.length) failures.push(`[C6] docs/AUTHENTICATION_GUIDE.md: ${missing.length} reason code(s) undocumented: ${missing.join(', ')}`);
  }

  // C7 - every shipped ROUTE is reachable from the UI guide. Checking route
  // PATHS rather than component names, because a path is what a reader
  // navigates and what the guide should name; component naming is editorial.
  const ug = p('docs/UI_GUIDE.md');
  if (existsSync(ug) && truth.webRoutePaths.length) {
    const text = read(ug);
    const missing = truth.webRoutePaths.filter((r) => !text.includes(r));
    if (missing.length) warnings.push(`[C7] docs/UI_GUIDE.md: ${missing.length} route(s) not mentioned: ${missing.join(', ')}`);
  }

  // C8 - PHANTOM settings. The inverse of C5 and the more dangerous direction:
  // C5 means a reader cannot find a control, C8 means a reader CONFIGURES a
  // control that does not exist and silently gets nothing. Found
  // `CustomResourceTypesEnabled` documented while absent from all of api/src.
  if (existsSync(sg)) {
    const real = new Set(truth.settings.map((s) => s.key));
    const named = new Set(
      [...read(sg).matchAll(/`([A-Z][A-Za-z0-9]{6,})`/g)].map((m) => m[1]),
    );
    const settingShaped = /(Enabled|Supported|Visibility|Validation|Enforcement|Strings|Ms|Retries)$/;
    const phantom = [...named].filter((n) => settingShaped.test(n) && !real.has(n));
    if (phantom.length) {
      failures.push(`[C8] docs/ENDPOINT_SETTINGS_OPERATOR_GUIDE.md: documents ${phantom.length} setting(s) that do NOT exist in the registry: ${phantom.join(', ')}`);
    }
  }

  // C9 - API reference route coverage. A stale COUNT is cosmetic; genuinely
  // missing routes are not. This check found 22 undocumented handlers,
  // including the whole JWKS allowlist API and the per-endpoint token endpoint.
  const apiRef = p('docs/COMPLETE_API_REFERENCE.md');
  if (existsSync(apiRef) && truth.routes?.length) {
    const doc = read(apiRef);
    const norm = (path) =>
      path
        .replace(/^\/scim/, '')
        // RFC 7644 S1.3: main.ts rewrites /scim/v2/* onto /scim/*, so the
        // versioned public path never appears in a controller decorator. Both
        // forms must compare equal or every versioned example looks undocumented.
        .replace(/^\/v2(?=\/|$)/, '')
        .replace(/:[A-Za-z0-9_]+/g, '{}')
        .replace(/\{[^}]*\}/g, '{}')
        .replace(/\/+$/, '')
        .toLowerCase() || '/';
    const docPaths = new Set();
    for (const m of doc.matchAll(/(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9_\-{}:/.$]*)/g)) docPaths.add(norm(m[1]));
    for (const m of doc.matchAll(/`(\/[A-Za-z0-9_\-{}:/.$]*)`/g)) docPaths.add(norm(m[1]));
    const uncovered = truth.routes.filter((r) => !docPaths.has(norm(r.path)));
    if (uncovered.length) {
      const sample = uncovered.slice(0, 8).map((r) => `${r.verb} ${r.path}`).join('; ');
      failures.push(`[C9] docs/COMPLETE_API_REFERENCE.md: ${uncovered.length} route handler(s) undocumented: ${sample}${uncovered.length > 8 ? ' ...' : ''}`);
    }
  }

  // C10 - RETIRED infrastructure must never be presented as live. A doc may
  // still NAME a dead estate, but only inside a passage that marks it dead.
  // Found docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md offering a retired FQDN as
  // "Azure (live production)" - a reader following it hits a host that no
  // longer resolves, and no link checker catches that because it is inside a
  // code fence, not a markdown link.
  // Boundary-aware: the registry name `acrscimserver20622` CONTAINS the string
  // "scimserver2", so a naive substring match flags every ACR reference in the
  // repo. Require a non-alphanumeric on the left and a non-digit on the right.
  const RETIRED = [
    'scimserver2',
    'yellowsmoke-af7a3fff',
    'yellowrock-b029dcc6',
    'scimserver-rg-dev',
  ].map((tok) => ({ tok, re: new RegExp(`(?<![A-Za-z0-9])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`) }));
  const DEAD_MARKER = /retired|historical|no longer|decommission|was:|superseded/i;
  for (const d of docs) {
    const lines = read(p(d)).split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      for (const { tok, re } of RETIRED) {
        if (!re.test(lines[i])) continue;
        const from = Math.max(0, i - 12);
        const context = lines.slice(from, i + 2).join('\n');
        if (!DEAD_MARKER.test(context)) hits.push(`L${i + 1} ${tok}`);
      }
    }
    if (hits.length) {
      failures.push(`[C10] ${d}: names retired infrastructure without marking it retired: ${hits.slice(0, 6).join('; ')}${hits.length > 6 ? ' ...' : ''}`);
    }
  }

  // C11 - every literal ```json block must parse. The house rule says a block
  // with placeholders or comments is a SCHEMATIC and must be fenced ```jsonc
  // instead, which keeps this check airtight. Found 9 blocks that were really
  // HTTP examples (a request line followed by a body) mis-fenced as json.
  for (const d of docs) {
    const text = read(p(d));
    const blocks = [...text.matchAll(/```json\r?\n([\s\S]*?)```/g)];
    const bad = [];
    for (const b of blocks) {
      const line = text.slice(0, b.index).split(/\r?\n/).length;
      try {
        JSON.parse(b[1]);
      } catch (err) {
        bad.push(`L${line}: ${String(err.message).slice(0, 60)}`);
      }
    }
    if (bad.length) {
      failures.push(`[C11] ${d}: ${bad.length} \`\`\`json block(s) do not parse (use \`\`\`jsonc for schematics, \`\`\`http for request examples): ${bad.slice(0, 3).join(' | ')}${bad.length > 3 ? ' ...' : ''}`);
    }
  }

  // NOTE: a C12 "doc references a route that no longer exists" check was built
  // and then REMOVED. Docs are full of illustrative paths with truncated ids
  // (`/endpoints/a1b2c3d4-.../stats`), and no normalisation separated those
  // from genuinely dead routes without a false-positive rate that would get the
  // whole gate switched off. C9 already covers the direction that matters (a
  // real route missing from the reference); the reverse direction is left to
  // review. Recorded here so the next person does not rebuild it and rediscover
  // the same noise.

  return { failures, warnings, docs };
}

// -------------------------------------------------------------------- main
// Only run when executed directly, so the self-test can import `audit()`.
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isMain) {
  const truth = groundTruth();

  if (process.argv[2] === '--truth') {
    console.log(JSON.stringify(truth, null, 2));
    process.exit(0);
  }

  console.log('=== doc content audit ===');
  console.log(`route handlers   : ${truth.routeHandlers} across ${truth.controllers} controllers`);
  console.log(`settings         : ${truth.settingsCount} (${truth.settingsBool} boolean + ${truth.settingsEnum} enum + ${truth.settingsNum} numeric)`);
  console.log(`presets          : ${truth.presetCount} [${truth.presets.join(', ')}]`);
  console.log(`auth reason codes: ${truth.reasonCodes.length}`);
  console.log(`web pages        : ${truth.webPages.length}`);
  console.log('');

  const { failures, warnings, docs } = audit(truth);
  console.log(`checked ${docs.length} user-facing docs`);
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const f of failures) console.log(`FAIL  ${f}`);

  if (failures.length) {
    console.log(`\nDOC CONTENT AUDIT FAILED - ${failures.length} issue(s)`);
    process.exit(1);
  }
  console.log('\nDOC CONTENT AUDIT PASSED');
  process.exit(0);
}
