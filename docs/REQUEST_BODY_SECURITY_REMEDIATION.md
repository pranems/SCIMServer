# Request-body dependency security correction

**Last verified:** 2026-10-29
**Status:** Bootstrap implementation; final CI locks, installed evidence and exact-tip image outcomes pending. Unmerged and not deployed.

## Executive summary

Reserve 0.55.61 for two minimal API override corrections from master
`5bfff2dea1dec6f3e4b99c9a4cc0e6cb8e27388d`. Update body-parser 2.3.0 to
2.4.0 and multer 2.4.0 to 2.5.0, without downgrading majors or updating
unrelated pins. [Issue #256](https://github.com/pranems/SCIMServer/issues/256)
tracks other independent concerns too and must not be closed wholesale.
PR #257 fixture cleanup and PR #251 performance qualification are not included.

## Facts and ownership

| Package | Advisory | Affected 2.x range | Exact patch | Actual lock owner |
|---|---|---|---|---|
| body-parser | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), HIGH CVE-2026-111181 | >= 2.0.0, < 2.4.0 | 2.4.0 | Express, requested ^2.2.1 |
| multer | [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), HIGH CVE-2026-113872 | >= 2.0.0, < 2.5.0 | 2.5.0 | @nestjs/platform-express, requested 2.1.1 |

Master has one actual API occurrence of each and none in the web lock.
The request path is HTTP request -> Nest Express adapter -> Express body
parsing, or Nest multipart handling -> multer. Updating the API override
changes those transitive implementations, not application routing or UI.
The web version changes only to remain synchronized with the API.

Approved-proxy metadata confirms publication at 2026-10-22T11:39:38Z
(body-parser) and 2026-10-22T11:58:46Z (multer). Both are older than seven
days at execution on 29 October. Engines require Node >=18 and >=10.16.0
respectively; the host is Node 24.13.0. Both patch metadata records carry
sha512 integrity. Internal metadata tarball URLs are deliberately not copied.
The prospective iconv-lite 0.7.3 dependency was published
2026-07-03T17:53:11Z and is eligible; final changed-package inventory still
requires verification before local restoration.

## Validation lanes and acceptance

1. RED before production manifest edits:
   `npm test -- --runInBand --runTestsByPath src/scripts/check-dependency-pins.spec.ts`
   in `api` failed on exactly the two old overrides: 24 passed, two failed.
2. Bootstrap GREEN checks exact manifests, advisory boundaries and actual
   owner/absence inventory on the old installation. It is not patched-code proof.
3. Ordinary protected bootstrap publication supplies an immutable source
   to `.github/workflows/regen-lockfile.yml` with workspace `both`.
4. Accept only the authenticated artifact from that exact source and successful
   workflow. Inspect every changed package, public registry.npmjs.org resolution,
   sha512 integrity and publication ages. Reject unrelated changes.
5. Add actual locked-occurrence regression assertions and confirm RED against
   old locks before importing. Run approved-feed `npm ci` only after verified
   new locks exist; hash locks before and after to prove no rewrite.
6. Final focused GREEN must inspect the patched installed graph. The final
   protected push uses `PREPUSH_MODE=Validate`; its unchanged broad suites
   are not repeated manually. Hosted exact-tip CI and both image scans remain
   separate evidence, not inferred from local installation.

Evidence stays in ignored `test-results/request-body-security-20261029/`.
No parent diagnostic paths are modified. No worker/time-limit changes,
force-exit changes, exclusion changes, deployment or customer data mutation
are part of this outcome. Existing release holds remain independent.

## Execution issues and root-cause analysis

| Issue | Type / severity | Symptom and mechanism | Resolution and why it works | Detection / earliest gate | Prevention |
|---|---|---|---|---|---|
| RFC base prerequisite | Environment currency / Medium | Offline RFC check fails on fresh master: corpus verified 91 days ago, limit 90. Security branch inherits expired validation evidence. | Carry only docs/rfcs/README.md and docs/rfcs/rfc-manifest.json byte-identically from `47cf83971ffa418b4ef6d8d9d19172297d15a7f0`, whose source is live-verified `6716b3bb`. Offline check passes; no invented date or age waiver. | Cheap preflight, before heavy hook; earliest offline preflight. Escape delta zero in this run. | Run cheap base-currency checks before protected publication. |
| Version badge | Documentation coupling / Low | First bootstrap hook stopped at C13 after 12 PASS gates: README badge still claimed 0.55.60. The freshness fixer updates headers, not the independent shields.io claim. | Synchronize that one badge to 0.55.61 and confirm the existing content audit GREEN. No gate bypass or test reduction. | Hook C13; earliest cheap content audit immediately after version synchronization. | The version-change preflight includes both freshness and `node scripts/audit-doc-content.mjs`, before the heavy hook. Preserve the failed bootstrap receipt. |

Provenance: this bounded implementation records issues when confirmed.
`red.log`, `rfc-preflight.log` and `rfc-green.log` preserve causal output.
Full transcript reconciliation must be stated honestly at final handoff;
no claim is made from the separate parent's Windows diagnostics.

## Self-improvement and design disposition

Self-improvement applied: permanent exact override and actual ownership tests
cover both affected request-body packages rather than treating an override as
proof that a vulnerable dependency is absent. Final locked-occurrence assertions
will separately enforce patched versions and public provenance.
Design disposition: **accepted**. Two exact dependency pins and cohesive
checker regressions require no application abstraction, new strategy or refactor.

## Open checks

- CI lock artifact source, changed package inventory and approved ages.
- Patched local installation and regression evidence.
- Final Validate hook, new draft PR, relevant reviews and exact-tip image scans.
- Performance admission, customer-data restore, cleanup 403, final admitted
  dev/live/browser artifact and genuine human visual acceptance remain release
  prerequisites outside this branch.
