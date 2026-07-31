// Negative control for check-lockfile-provenance.mjs.
//
// A checker that has only ever been run against clean input has not been shown
// to detect anything. This injects the two contamination modes that were
// actually measured on a corp-managed device and asserts the checker fails on
// each, then asserts it passes on the untouched file.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const LOCK = 'api/package-lock.json';
const BAK = 'api/package-lock.json.negctl-bak';

function run() {
  try {
    execFileSync(process.execPath, ['scripts/check-lockfile-provenance.mjs'], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

copyFileSync(LOCK, BAK);
let failures = 0;
const check = (label, expected, actual) => {
  const ok = expected === actual;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (expected exit ${expected}, got ${actual})`);
};

try {
  console.log('negative control: check-lockfile-provenance.mjs');
  check('untouched lockfile passes', 0, run());

  const orig = readFileSync(BAK, 'utf8');

  // Mode 1: internal feed-proxy `resolved` host.
  writeFileSync(
    LOCK,
    orig.replace(
      '"resolved": "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.4.tgz"',
      '"resolved": "https://ms-feed-12.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/fast-uri/-/fast-uri-3.1.4.tgz"',
    ),
  );
  check('internal resolved host is rejected', 1, run());

  // Mode 2: sha1 integrity downgrade.
  writeFileSync(
    LOCK,
    orig.replace(
      /"integrity": "sha512-8JnbkQ[^"]*"/,
      '"integrity": "sha1-DEADBEEFDEADBEEFDEADBEEFDEADBEEF="',
    ),
  );
  check('sha1 integrity is rejected', 1, run());
} finally {
  copyFileSync(BAK, LOCK);
  unlinkSync(BAK);
}

console.log(failures ? `\nNEGATIVE CONTROL FAILED (${failures})` : '\nnegative control: all assertions held');
process.exit(failures ? 1 : 0);
