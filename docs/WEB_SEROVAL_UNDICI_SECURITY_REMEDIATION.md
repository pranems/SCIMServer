# Web Seroval and Undici advisory remediation

**Last verified:** 2026-10-29
**Status:** 0.55.62 CI locks authenticated and restored; focused web dependency checks pass. Final protected Validate and exact-tip hosted review are pending. Not merged or deployed.

## Executive summary

This independent patch addresses only the web Seroval and Undici records in
[issue #256](https://github.com/pranems/SCIMServer/issues/256).
Reserve 0.55.62 from verified master
`727860866c53c7ec8d01d1ff5bae858f80a1715d` (0.55.61).
Pin Seroval 1.6.3 to 1.6.11 and Undici 7.29.1 to 7.30.1, preserving compatible
owner ranges and the existing API body-parser, multer and global iconv-lite
correction. The six remaining API advisory records are outside this outcome;
issue #256 must remain open.

## Actual ownership and patch selection

| Package | Actual incoming web lock edges | Minimal selected patch | Publication and quarantine eligibility (UTC) |
|---|---|---|---|
| Seroval | `@tanstack/router-core`: dependency `^1.5.4`; `seroval-plugins`: peer `^1.0` | 1.6.11 covers all five listed records, including three High; earlier listed floors 1.6.8 and 1.6.10 are insufficient collectively | Published 2026-10-18T11:47:50Z; eligible 2026-10-25T11:47:50Z |
| Undici | `jsdom`: dependency `^7.25.0` | 7.30.1 covers all eight listed records, including four High | Published 2026-10-15T14:18:31Z; eligible 2026-10-22T14:18:31Z |

Both locks initially contain exactly one occurrence of each package.
Installed resolution from all three owner contexts confirms the old versions.
Both selected patches are compatible with the observed ranges and Node 24.
The Seroval engine minimum is Node 10; Undici requires Node >=20.18.1.
Public sha512 metadata and approved-feed availability were verified before
installation. Internal proxy tarball URLs must never enter source locks.

Lockfile `dev` flags are not deployment or exploitability evidence. Seroval
is a web application dependency; Undici is reached through the jsdom test
stack. An image High/Critical scan cannot certify bundled browser dependency
security. This patch makes no browser exploitability or universal clearance
claim.

## Validation and publication sequence

1. Before changing manifests, write six exact-pin, all-occurrence and actual
   installed-owner regressions. All six fail on real old versions, not a
   tooling failure. Preserve the RED log and test draft in ignored
   `test-results/web-advisory-remediation-20261029/`.
2. Publish the manifest/version and documentation bootstrap through the
   ordinary protected hook. The test draft is not yet a source regression:
   it is added after CI lock import, rather than weakening assertions or
   adding a temporary skip. Bootstrap gates use the old installed tree and
   do not establish patched dependency GREEN.
3. Use the unchanged `Regenerate lockfile` workflow for both workspaces.
   Authenticate exact source, run and artifact digest. API changes must be
   root version metadata only; web package changes must be only the two
   selected patches. Verify every changed entry's age and public sha512
   provenance before import.
4. Restore through the approved registry with `npm ci --no-audit --no-fund`.
   Check both lock hashes, actual installed owners and full `npm ls --all`
   exit status. Add the preserved source tests and require focused GREEN.
5. Final normal Validate owns the applicable broad local suites. Require
   exact-tip hosted image/smoke/Trivy, CodeQL, documentation and fresh Copilot
   review. Fix relevant review comments and leave the PR in draft.

No application behavior or UI layout is changed, so synthetic HTTP or
Playwright tests would not prove this dependency outcome. Existing tests
remain independent regression evidence; no dev/browser validation is claimed.

## Execution issues and prevention

**Low, evidence timestamp transcription:** continuation prose gave publication
times six hours later than its retained JSON. Fresh approved-feed metadata
matches the original JSON exactly: 11:47:50Z for Seroval and 14:18:31Z for
Undici. Use those original UTC strings, not timezone-adjusted prose, for age
calculations. Both remain eligible. Detection and correction occurred during
metadata preflight, the earliest applicable gate.

**Confirmed and fixed failure (High, dependency pin drift):** exact overrides
retained vulnerable releases after their original fixes aged. The focused
regressions fail 6/6: expected Seroval 1.6.11, received 1.6.3; expected Undici
7.30.1, received 7.29.1. Detection is the initial focused unit lane, the earliest
applicable stage. Authenticated lock import and clean restore resolve all six
assertions; the combined existing/new dependency specs pass 35/35.
The exact pins remove the vulnerable versions from every actual web lock
occurrence and all installed owner contexts, not merely manifest metadata.

**Pre-existing API inventory finding (Medium, separate follow-up):** full `npm ls --all`
reports the two intentionally stale web packages after the manifest edit.
It also reports API `debug`, `get-intrinsic` and `call-bind-apply-helpers`
invalid in the existing installed tree, although no API override or locked
package was changed. A clean API restore of the authenticated unchanged
package graph retains the same three invalidity classes. Top-level API
`npm ls` exits 0 but is not full-tree clearance. This patch does not change
API overrides or label the errors harmless. Web `npm ls --all` exits 0 with
no problems after its clean restore. The initial and restored failure logs
are retained separately from intentional pin RED. Detection was full
inventory preflight, earlier than broad tests; a top-level-only inventory
would miss these owner-context errors. Track diagnosis with the independent
API work in issue #256 (owner: repository maintainer; target: 2026-11-05).

## Authenticated CI locks and measured results

| Evidence | Result |
|---|---|
| Regeneration | [Run 40895972413](https://github.com/pranems/SCIMServer/actions/runs/40895972413), SUCCESS; unchanged workflow, both workspaces; exact source `419596869f3f2de0aa605290d958dcda7ad57e80` |
| Artifact authentication | `regenerated-lockfiles`, ID 12906712562; downloaded ZIP SHA-256 `a84a0114a0cd91bcb2596815fa7ce72f0711b65f3c8778f802f4ad759980e928`, equal to GitHub's authenticated artifact digest |
| Entire graph delta | API has zero non-root package changes; web has only Seroval 1.6.3 -> 1.6.11 and Undici 7.29.1 -> 7.30.1. Both root versions become 0.55.62 |
| CI publication ages | Checked 2026-10-29T14:53:28.243Z: Seroval 11.1289 days, Undici 14.0243 days. CI's original registry timestamps also retain milliseconds; approved-feed timestamps agree to seconds |
| API artifact/after-restore SHA-256 | `7e0a61ca78c652ceac6239a4db5ac92ca597cab7a5a9ad8041ecdeb08277a087` |
| Web artifact/after-restore SHA-256 | `312b4337d1571c0f962178272d5b7330b453cd6994686a57b90dabd962ce1ecb` |
| Provenance and metadata | Every non-root entry uses public registry URLs and sha512; both changed integrity values equal the approved exact-version metadata |
| Clean restores | `npm --prefix api ci --no-audit --no-fund` and `npm --prefix web ci --no-audit --no-fund`: PASS; both lockfiles byte-identical to their CI artifacts afterward |
| Focused GREEN | API `npm test -- --runInBand --runTestsByPath src/scripts/web-advisory-pins.spec.ts src/scripts/check-dependency-pins.spec.ts`: 35/35 in two suites |
| Actual web inventory | `npm --prefix web ls --all --json`: exit 0, no problems. Both actual Seroval owners and jsdom's Undici resolve the intended patches |
| Advisory scan | `npm --prefix api run check:pins`: web eight pins, zero findings; overall exit 1 correctly retains six separate API advisory records. No scanner suppression or blanket clearance |
| Bootstrap hook only | Normal Fast push at bootstrap source: 25/25 gates, 618.2 seconds; units 6,220, HTTP 2,514 plus 42 skips. The existing HTTP worker warning remains distinct from unit fixture correctness |

Baseline locks in this Windows checkout use CRLF, whereas CI artifacts and
Git source use LF. Normalizing the baseline's line endings matches the
parent-authenticated source hashes exactly: API
`b8b3b3e0395879222e19e7a95c2dc1eb8ee1be8b9f6514eb3f06f32c9f67be1e`,
web `b0ae8b65b876e51f7c915df2f7f6586f05192cade4094ba0109430acca57252a`.
No baseline package content changed before CI import.

**Self-improvement: applied.** The regression checks every actual lock
occurrence and resolves from every installed owner, so a valid-looking root
pin cannot conceal a stale nested package or incompatible override context.
The existing full npm inventory remains required separately.

**Design disposition: accepted.** Two exact overrides use existing tooling.
No new strategy, runtime abstraction, policy exception or gate redesign is
justified. The broader browser-bundle scan coverage question is a bounded
follow-up, not part of this patch.
Owner: repository maintainer; target: next dependency-gate review by
2026-11-05. Evaluate bundled browser dependency scanning separately from
runtime-image scanning without introducing an exception here.

## Limitations and handoff

This is reconstructed continuation, not a restored deleted transcript.
Source evidence is the focused logs and this patch's command receipts; no
claim is made that an unavailable earlier transcript was reconciled.
Final receipt path:
`test-results/web-advisory-remediation-20261029/HANDOFF.md`.

No merge, deployment, release admission or overall security clearance is
authorized. Preserve performance ratio 1.23928982 >1.10, customer data/restore,
cleanup 403, measured browser/human visual verification, native/OS Windows
delay and competing Mermaid renderer holds. PR #251 remains untouched.
Repository CodeQL's 107 pre-existing alerts are distinct from no-new-alert
checks on this patch.
