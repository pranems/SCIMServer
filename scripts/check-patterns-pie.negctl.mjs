// Negative control for check-patterns-pie.mjs.
//
// Asserts the checker rejects the two values that were ACTUALLY wrong when the
// 2026-07-30 merge conflict was resolved (22 from one branch, 14 from the
// other, against a real 24), plus a per-category skew and a title/slice
// mismatch. A checker only ever run against correct input has not been shown
// to detect anything.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/strategy/ENGINEERING_LESSONS_AND_PATTERNS.md';
const BAK = `${DOC}.negctl-bak`;

const run = () => {
  try {
    execFileSync(process.execPath, ['scripts/check-patterns-pie.mjs'], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};

copyFileSync(DOC, BAK);
const original = readFileSync(BAK, 'utf8');
let failures = 0;
const check = (label, expected, actual) => {
  const ok = expected === actual;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (expected exit ${expected}, got ${actual})`);
};

try {
  console.log('negative control: check-patterns-pie.mjs');
  check('correct doc passes', 0, run());

  for (const wrong of ['22', '14']) {
    writeFileSync(DOC, original.replace('(24 seeded)', `(${wrong} seeded)`));
    check(`stale total "${wrong} seeded" is rejected`, 1, run());
  }

  // Per-category skew that still sums to the declared total is the subtler
  // failure: a naive "does the title match the sum" check would miss it.
  writeFileSync(
    DOC,
    original.replace('"A Test/gate integrity" : 8', '"A Test/gate integrity" : 7')
            .replace('"B Environment/deploy" : 3', '"B Environment/deploy" : 4'),
  );
  check('per-category skew is rejected', 1, run());
} finally {
  copyFileSync(BAK, DOC);
  unlinkSync(BAK);
}

console.log(failures ? `\nNEGATIVE CONTROL FAILED (${failures})` : '\nnegative control: all assertions held');
process.exit(failures ? 1 : 0);
