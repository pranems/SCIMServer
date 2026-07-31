// Verifies that no lockfile entry carries corporate-feed-proxy provenance.
//
// A Microsoft corp-managed device redirects npm to a feed proxy that serves
// only a legacy `shasum` and no `integrity`. Any entry npm rewrites there comes
// back with an internal `resolved` host and a sha1 integrity, while every other
// entry is sha512. Both are unacceptable in a public repo: the first leaks an
// internal endpoint, the second silently weakens the lockfile's tamper-evidence.
// Measured in docs/strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md Section 5.
//
// Run before staging any lockfile change. The same two checks run in
// .github/workflows/regen-lockfile.yml so the CI path cannot drift from this one.
import { readFileSync, existsSync } from 'node:fs';

let bad = 0;
for (const f of ['api/package-lock.json', 'web/package-lock.json']) {
  if (!existsSync(f)) continue;
  const t = readFileSync(f, 'utf8');
  const hosts = [...new Set([...t.matchAll(/"resolved": "https?:\/\/([^/"]+)/g)].map((m) => m[1]))];
  const weak = (t.match(/"integrity": "sha(1|256|384)-/g) || []).length;
  const sha512 = (t.match(/"integrity": "sha512-/g) || []).length;
  const clean = hosts.length === 1 && hosts[0] === 'registry.npmjs.org' && weak === 0;
  if (!clean) bad++;
  console.log(f);
  console.log('  hosts      :', hosts.join(', '));
  console.log('  sha512     :', sha512, '  non-sha512:', weak);
  console.log('  VERDICT    :', clean ? 'CLEAN' : 'CONTAMINATED');
}
if (bad) {
  console.error(
    `\nFAIL - ${bad} lockfile(s) carry non-public provenance.\n` +
      'Do NOT commit. Regenerate via .github/workflows/regen-lockfile.yml and\n' +
      'commit the artifact. Never hand-write an integrity hash.',
  );
}
process.exit(bad ? 1 : 0);
