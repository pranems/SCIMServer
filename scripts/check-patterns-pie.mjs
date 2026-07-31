// Verifies the category-distribution pie in ENGINEERING_LESSONS_AND_PATTERNS.md
// matches the patterns actually documented in the file.
//
// Origin: 2026-07-30. Merging two branches that had each appended patterns
// produced a conflict in the pie block, and BOTH sides were wrong - one claimed
// 22 seeded, the other 14, while the document actually contained 24. Nothing
// caught it because a stale pie renders perfectly: Mermaid has no idea what the
// numbers are supposed to mean, so the render gate passes on any integers. The
// doc is consulted at the start of planning and design work, so a wrong count
// understates how much accumulated experience is on the shelf.
//
// Counts **bolded pattern IDs** (`**PA-1**`) because that is how the catalog
// tables declare them, and de-duplicates - an ID may also be cited in the
// escape tracker or a cross-reference further down.
import { readFileSync } from 'node:fs';

const DOC = 'docs/strategy/ENGINEERING_LESSONS_AND_PATTERNS.md';
// Normalise line endings up front. The file is CRLF on Windows checkouts, and
// anchoring on a bare \n silently matched nothing - the first version of this
// script reported "could not find the pie block" on a perfectly good document.
const text = readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');

// Actual patterns present, grouped by category letter.
const ids = [...new Set([...text.matchAll(/\*\*(P([A-G])-\d+)\*\*/g)].map((m) => m[1]))];
const actual = {};
for (const id of ids) {
  const cat = id[1];
  actual[cat] = (actual[cat] ?? 0) + 1;
}
const actualTotal = ids.length;

// Declared distribution, from the pie block.
const pie = text.match(/```mermaid\s*\npie showData\n([\s\S]*?)```/);
if (!pie) {
  console.error(`FAIL - could not find the category-distribution pie block in ${DOC}`);
  process.exit(1);
}
const titleMatch = pie[1].match(/title Patterns by category \((\d+) seeded\)/);
if (!titleMatch) {
  console.error('FAIL - pie block has no "title Patterns by category (N seeded)" line');
  process.exit(1);
}
const declaredTotal = Number(titleMatch[1]);
const declared = {};
for (const m of pie[1].matchAll(/"([A-G]) [^"]*"\s*:\s*(\d+)/g)) {
  declared[m[1]] = Number(m[2]);
}

const problems = [];
const cats = [...new Set([...Object.keys(actual), ...Object.keys(declared)])].sort();
for (const c of cats) {
  const a = actual[c] ?? 0;
  const d = declared[c] ?? 0;
  if (a !== d) problems.push(`  category ${c}: pie says ${d}, document contains ${a}`);
}
const sumDeclared = Object.values(declared).reduce((x, y) => x + y, 0);
if (declaredTotal !== actualTotal) {
  problems.push(`  title says ${declaredTotal} seeded, document contains ${actualTotal}`);
}
if (sumDeclared !== declaredTotal) {
  problems.push(`  pie slices sum to ${sumDeclared} but the title says ${declaredTotal}`);
}

console.log(`patterns pie: ${cats.map((c) => `${c}=${actual[c] ?? 0}`).join(' ')}  total=${actualTotal}`);
if (problems.length) {
  console.error(`\nFAIL - ${DOC} category pie does not match its own contents:`);
  for (const p of problems) console.error(p);
  console.error('\nUpdate the pie block (title + slices) to the measured values above.');
  process.exit(1);
}
console.log('patterns pie matches the documented patterns.');
