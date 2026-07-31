#!/usr/bin/env node
/**
 * Self-test for scripts/audit-doc-content.mjs.
 *
 * Same discipline as the freshness gate's self-test: a check nobody has watched
 * FAIL is not a check. Each content check gets a negative control (a scratch
 * doc that violates exactly that rule) and, where the rule has a tempting
 * false-positive, a positive control too.
 *
 * The two positive controls matter as much as the negatives here. Both were
 * real bugs in the first draft of the gate:
 *   - `acrscimserver20622` CONTAINS the retired name "scimserver2", so a naive
 *     substring match flagged every registry reference in the repo.
 *   - a 2-part "**Version:** 4.1" is the DOCUMENT's revision, not a product
 *     version, and must not be read as one.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0;
let fail = 0;

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}`);
    if (detail) console.log(`        ${detail}`);
    fail++;
  }
}

function scratch(docs, manifestDocs) {
  const root = mkdtempSync(join(tmpdir(), 'doccontent-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  for (const [name, body] of Object.entries(docs)) {
    writeFileSync(join(root, 'docs', name), body, 'utf8');
  }
  writeFileSync(
    join(root, 'docs', '.doc-manifest.json'),
    JSON.stringify({ docs: manifestDocs.map((d) => ({ path: `docs/${d}`, sources: [], maxAgeDays: 90 })) }, null, 2),
  );
  return root;
}

// Import once with a neutral root; audit() resolves paths from DOC_AUDIT_ROOT
// captured at module load, so each case re-imports with a cache-busting query.
async function runAudit(root, truth) {
  process.env.DOC_AUDIT_ROOT = root;
  const mod = await import(`./audit-doc-content.mjs?t=${Date.now()}_${Math.random()}`);
  return mod.audit(truth);
}

const BASE_TRUTH = {
  controllers: 31,
  routeHandlers: 117,
  routes: [{ verb: 'GET', path: '/scim/admin/thing', file: 'x.controller.ts' }],
  settings: [{ key: 'AlphaEnabled', type: 'boolean' }],
  settingsCount: 28,
  settingsBool: 21,
  settingsNum: 4,
  settingsEnum: 3,
  presets: ['a', 'b'],
  presetCount: 6,
  reasonCodes: ['bearer_invalid'],
  webPages: [],
  webRoutePaths: [],
};

const roots = [];
async function run(label, docs, manifestDocs, truth, expectId, shouldFail = true) {
  const root = scratch(docs, manifestDocs);
  roots.push(root);
  const { failures, warnings } = await runAudit(root, { ...BASE_TRUTH, ...truth });
  const all = [...failures, ...warnings].join(' | ');
  if (shouldFail) {
    assert(`${label} fires ${expectId}`, all.includes(expectId), all || '(no findings)');
  } else {
    assert(`${label} does NOT fire ${expectId}`, !all.includes(expectId), all);
  }
}

console.log('=== negative controls: each check must FIRE ===');

await run('C1 stale route count', { 'A.md': 'We expose 86 route handlers here.' }, ['A.md'], {}, '[C1]');
await run('C2 stale controller count', { 'A.md': 'Spread over 20 controllers.' }, ['A.md'], {}, '[C2]');
await run('C3 stale settings count', { 'A.md': 'There are 27 endpoint settings controls.' }, ['A.md'], {}, '[C3]');
await run('C4 stale preset count', { 'A.md': 'Ships with 5 presets.' }, ['A.md'], {}, '[C4]');

await run(
  'C5 undocumented setting',
  { 'ENDPOINT_SETTINGS_OPERATOR_GUIDE.md': 'This guide documents nothing at all.' },
  ['ENDPOINT_SETTINGS_OPERATOR_GUIDE.md'],
  { settings: [{ key: 'MissingFromDocsEnabled', type: 'boolean' }] },
  '[C5]',
);

await run(
  'C6 undocumented reason code',
  { 'AUTHENTICATION_GUIDE.md': 'No codes listed.' },
  ['AUTHENTICATION_GUIDE.md'],
  { reasonCodes: ['wif_issuer_mismatch'] },
  '[C6]',
);

await run(
  'C8 phantom setting',
  { 'ENDPOINT_SETTINGS_OPERATOR_GUIDE.md': 'Set `CustomResourceTypesEnabled` to true.' },
  ['ENDPOINT_SETTINGS_OPERATOR_GUIDE.md'],
  { settings: [{ key: 'RealEnabled', type: 'boolean' }] },
  '[C8]',
);

await run(
  'C9 undocumented route',
  { 'COMPLETE_API_REFERENCE.md': 'Nothing documented.' },
  ['COMPLETE_API_REFERENCE.md'],
  { routes: [{ verb: 'POST', path: '/scim/admin/settings/jwks-hosts', file: 'x.ts' }] },
  '[C9]',
);

await run(
  'C10 retired infra presented as live',
  { 'A.md': 'Azure (live production): https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io' },
  ['A.md'],
  {},
  '[C10]',
);

console.log('\n=== positive controls: each check must NOT fire ===');

await run(
  'C10 vs the ACR name acrscimserver20622',
  { 'A.md': 'Pull from acrscimserver20622.azurecr.io/scimserver:latest' },
  ['A.md'],
  {},
  '[C10]',
  false,
);

await run(
  'C10 vs a properly marked historical section',
  { 'A.md': '### Architecture (HISTORICAL)\n\nThese are RETIRED and not live:\n\n- scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io' },
  ['A.md'],
  {},
  '[C10]',
  false,
);

await run(
  'C1 vs a correct count',
  { 'A.md': 'We expose 117 route handlers.' },
  ['A.md'],
  {},
  '[C1]',
  false,
);

await run(
  'C9 vs a documented route',
  { 'COMPLETE_API_REFERENCE.md': '### POST /scim/admin/settings/jwks-hosts\n\nAdds a host.' },
  ['COMPLETE_API_REFERENCE.md'],
  { routes: [{ verb: 'POST', path: '/scim/admin/settings/jwks-hosts', file: 'x.ts' }] },
  '[C9]',
  false,
);

for (const r of roots) rmSync(r, { recursive: true, force: true });

console.log('\n================================');
console.log(` passed: ${pass}   failed: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
