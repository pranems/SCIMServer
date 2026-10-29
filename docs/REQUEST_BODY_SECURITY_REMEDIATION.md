# Request-body dependency security correction

**Last verified:** 2026-10-29
**Status:** Owner-consistency follow-up in progress on draft PR #258. Focused 29/29 and real npm inventory PASS with one shared exact iconv-lite override; fresh CI lock verification, restoration and new-tip hosted outcomes remain required. Unmerged and not deployed.

## Executive summary

Reserve 0.55.61 for two minimal API override corrections from master
`5bfff2dea1dec6f3e4b99c9a4cc0e6cb8e27388d`. Update body-parser 2.3.0 to
2.4.0 and multer 2.4.0 to 2.5.0, without downgrading majors or updating
unrelated pins. Pin their shared, already locked iconv-lite 0.7.3 globally
to make every actual owner's override context consistent.
[Issue #256](https://github.com/pranems/SCIMServer/issues/256)
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

## Immutable lock artifact and focused results

The table below is historical evidence for the initial `78b88d1c` patch,
not acceptance of the subsequent shared-context correction. The follow-up
section records the new source change and requires fresh exact-tip evidence.

| Evidence | Observed result |
|---|---|
| Bootstrap source | `3db7452ad4e6879726189681fd7dee23e5d75187`; ordinary Fast hook 25/25 PASS, 429 seconds |
| Bootstrap focused GREEN | 26/26, old installation only |
| Actual locked-graph RED | 26 passed / two failed on old locked versions |
| Corrected locks with stale installation RED | 26 passed / two failed on old installed versions, after locked-version assertions passed |
| Sanctioned CI | [Run 40873804998](https://github.com/pranems/SCIMServer/actions/runs/40873804998), SUCCESS, exact bootstrap source above, workspace `both` |
| Authenticated artifact | `regenerated-lockfiles`, ID 12897910061; downloaded archive SHA-256 `bfc000e0ca8a956f93932ced34b1f7f43c7291ef2dca61f611c27fd72dff8608`, matches GitHub metadata |
| Complete package delta | API body-parser 2.3.0 -> 2.4.0, multer 2.4.0 -> 2.5.0, iconv-lite 0.7.2 -> 0.7.3; no other package changes. Both roots 0.55.60 -> 0.55.61 |
| Publication ages at CI verification | body-parser 7.035 days, multer 7.022 days, iconv-lite 117.775 days. All approved-proxy exact-version lookups and publication checks pass |
| Public provenance | `node scripts/lockfile-regeneration.mjs verify both` PASS; registry.npmjs.org resolution and sha512 only |
| Approved restoration | API `npm ci --registry=https://packagefeedproxy.microsoft.io/npm/ --no-audit --no-fund`: PASS, 660 packages; web same command: PASS, 364 packages |
| Lock immutability | Before/after SHA-256 unchanged: API `b8b3b3e0395879222e19e7a95c2dc1eb8ee1be8b9f6514eb3f06f32c9f67be1e`, web `b0ae8b65b876e51f7c915df2f7f6586f05192cade4094ba0109430acca57252a` |
| Final focused GREEN | 28/28 after clean restoration; resolves body-parser 2.4.0 from Express and multer 2.5.0 from the Nest adapter, with all locked occurrences checked |
| Bootstrap broad tests | API units 6,214 -> 6,217 in 213 suites; HTTP unchanged 2,514 passed / 42 existing skips, 118 passed suites / two existing skipped suites |
| Bootstrap hosted CI | [Run 40873776817](https://github.com/pranems/SCIMServer/actions/runs/40873776817) FAIL at npm ci, before image build: old locks mismatch the two new overrides and required iconv-lite. Expected bootstrap mismatch, not a scan of the final graph |

iconv-lite is required because the new body-parser declares ^0.7.3; preserving
0.7.2 would violate that dependency. Existing content-type 2.1.0 already satisfies
the new requirement. Existing qs 6.16.0 override is unchanged by design; other
independent pins remain tracked separately rather than silently upgraded.

The successful bootstrap hook still emits existing Jest worker-exit warnings.
They are preserved in `bootstrap-push-corrected.log`, not erased by the green
exit code, and do not establish an application timer leak. Master lacks the
independent PR #257 fixture correction; that work must not be imported here.

## Execution issues and root-cause analysis

| Issue | Type / severity | Symptom and mechanism | Resolution and why it works | Detection / earliest gate | Prevention |
|---|---|---|---|---|---|
| RFC base prerequisite | Environment currency / Medium | Offline RFC check fails on fresh master: corpus verified 91 days ago, limit 90. Security branch inherits expired validation evidence. | Carry only docs/rfcs/README.md and docs/rfcs/rfc-manifest.json byte-identically from `47cf83971ffa418b4ef6d8d9d19172297d15a7f0`, whose source is live-verified `6716b3bb`. Offline check passes; no invented date or age waiver. | Cheap preflight, before heavy hook; earliest offline preflight. Escape delta zero in this run. | Run cheap base-currency checks before protected publication. |
| Version badge | Documentation coupling / Low | First bootstrap hook stopped at C13 after 12 PASS gates: README badge still claimed 0.55.60. The freshness fixer updates headers, not the independent shields.io claim. | Synchronize that one badge to 0.55.61 and confirm the existing content audit GREEN. No gate bypass or test reduction. | Hook C13; earliest cheap content audit immediately after version synchronization. | The version-change preflight includes both freshness and `node scripts/audit-doc-content.mjs`, before the heavy hook. Preserve the failed bootstrap receipt. |
| Bootstrap image install | CI phase boundary / Low | Run 40873776817 fails npm ci with old body-parser, multer and iconv-lite lock entries. Bootstrap intentionally precedes CI-owned regeneration. | Sanctioned run 40873804998 provides verified new locks; clean approved-feed npm ci and 28/28 installed regressions pass. Final exact-tip image evidence is still required. | Hosted install, earliest clean install; not a final graph failure. | Label bootstrap separately and never treat old-installation GREEN as final proof. |
| npm inventory override contexts | Dependency ownership / Medium | npm 11.6.2 `npm ls body-parser multer iconv-lite --all --json` exits ELSPROBLEMS. Body-parser and mysql2 propagate different inherited override contexts onto shared iconv-lite 0.7.3, despite every native range accepting it. The conflicting target context can vary with traversal order. | Initial read-only diagnosis proved semver compatibility but left the actual failing inventory unresolved. That disposition was insufficient. Follow-up adds one exact global iconv-lite 0.7.3 override; all actual incoming edges now select one context. No owner-specific iconv-lite overrides existed to remove. Focused RED fails on the missing shared context; GREEN 29/29 and real npm inventory exit 0 confirm the manifest correction. Fresh CI lock verification and clean restoration remain required before final acceptance. | First actual-tree inventory after restore; correction followed the operator's completion review. | Lock all real owners/ranges and exactly one global context in a permanent regression, and require the actual npm inventory command to exit 0. Never replace that acceptance with a semver-only success report. |

Provenance: this bounded implementation records issues when confirmed.
`red.log`, `rfc-preflight.log` and `rfc-green.log` preserve causal output.
Issue reconciliation covers this implementation's complete, uncompacted
conversation and saved command receipts through the final focused GREEN.
No independent full debug JSONL was supplied to this worker, so a separate
debug-transcript reconciliation is not claimed. No claim is made from the
separate parent's Windows diagnostics. npm deprecation notices are retained
as upstream notices, not additional diagnosed failures.

## Self-improvement and design disposition

Self-improvement applied: permanent exact override and actual ownership tests
cover both affected request-body packages rather than treating an override as
proof that a vulnerable dependency is absent. Locked/installed assertions
separately enforce patched versions and public provenance. The follow-up
strengthens this with a shared-context regression and real npm inventory
exit-zero acceptance; compatibility alone is not a valid installed graph.
Design disposition: **applied**. One existing shared transitive dependency gets
one exact global override, consistent with the repository's flat pin pattern.
No new abstraction, package major, tool upgrade or application refactor is needed.

## Shared iconv-lite owner-consistency follow-up

The earlier `78b88d1c` images passed their scan scope, but that did not resolve
the installed inventory failure. This follow-up stays within 0.55.61 and
PR #258; no previous image or broad-test result is adopted as new-tip proof.

| Complete actual API owner set | Native range | Installed and locked version | Compatible without changing its major? |
|---|---|---|---|
| body-parser | ^0.7.3 | 0.7.3 | Yes |
| mysql2 | ^0.7.2 | 0.7.3 | Yes |
| raw-body | ~0.7.0 | 0.7.3 | Yes |

Both locked and installed inventories contain exactly these three owners.
The web graph has no iconv-lite owner or occurrence. Independent native-range
checks passed for all three before editing. The API manifest had no explicit
owner-specific iconv-lite overrides; the incompatible contexts were inherited
from the distinct body-parser/mysql2 pins. Adding only root
`iconv-lite: 0.7.3` makes both select the same rule without broad upgrades.
Publication 2026-07-03T17:53:11Z remains older than seven days.

Focused command in API:
`npm test -- --runInBand --runTestsByPath src/scripts/check-dependency-pins.spec.ts`.
RED: 28 passes, one missing-shared-context failure. GREEN after the single
manifest addition: 29/29. Actual
`npm ls body-parser multer iconv-lite --all --json` changed from exit 1 to
exit 0; the new exit-zero receipt does not erase the earlier failed command.

Fresh sanctioned CI regeneration is required even if its package graph and
lock bytes remain unchanged. Review that exact-source artifact, approved ages
for any resulting delta, public registry/sha512 provenance, then restore
through the approved registry and verify unchanged lock hashes. Final
`PREPUSH_MODE=Validate` publication owns applicable broad evidence.
Current-tip image scans, hosted checks and review responses are published on
[draft PR #258](https://github.com/pranems/SCIMServer/pull/258); this committed
section is the development checkpoint, not a claim that those future gates ran.
Detailed follow-up receipts live in ignored
`test-results/request-body-security-20261029/owner-consistency/`.

## Open checks

The first owner-consistency Validate push stopped at the documentation freshness
gate: changing `api/package.json` requires a same-change review of
`docs/RELEASE_NOTES.md` (F4). The earlier release-note version restamp did not
document this dependency outcome, and this follow-up omitted the coupled file.
Severity: Low, process/documentation. The correction adds the operator-facing
0.55.61 scope and ownership explanation, not a date-only restamp. Detection was
the normal pre-push gate; the earliest available check was the cheap coupled
freshness audit before publication. Prevention is to run that audit, rather
than only the content audit, before a manifest-changing push. The blocked
attempt and its successful gates remain in `owner-consistency/validate-push.log`.

- [x] Initial CI lock artifact source, changed package inventory and approved ages.
- [x] Initial patched local installation and regression evidence.
- [x] Complete shared iconv-lite owner inventory, focused RED/GREEN and actual npm inventory exit 0.
- Fresh owner-consistency CI lock verification, restored inventory exit 0,
  Validate publication, same draft PR #258 reviews and new-tip image scans.
- Performance admission, customer-data restore, cleanup 403, final admitted
  dev/live/browser artifact and genuine human visual acceptance remain release
  prerequisites outside this branch.
