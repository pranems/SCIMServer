# API shared override context validity

**Last verified:** 2026-10-29

## Executive summary

Proposed product 0.55.63 corrects real complete-tree npm inventory failures
without changing any non-root package version. Four exact root overrides
give shared dependencies a consistent override context: `debug` 4.4.3,
`get-intrinsic` 1.3.0, `call-bind-apply-helpers` 1.0.2 and `hasown` 2.0.4.
All selected versions already exist in the master lock and satisfy every
actual owner range. This is not a security-advisory remediation or a new
runtime feature.

The branch starts independently from master
`727860866c53c7ec8d01d1ff5bae858f80a1715d` (0.55.61).
Draft PR #259 reserves 0.55.62 and is not inherited, edited or admitted.
No merge, deployment, latest-image qualification, auth, schema, UI or
performance changes are included.

### Current integration supersedes the independent preparation boundary

PR #259 subsequently merged normally at
`0a9b3d04535dc51dcfc58e9a2360c1c9e112a41a`. The existing 0.55.63 branch
now integrates that master without rewriting any constituent commit.
Its API graph retains the four exact root overrides; its web graph inherits
the already reviewed Seroval/Undici correction.

The new integrated locks must come from clean CI, with archive authentication
and structural package-union checks before import. Existing authenticated
parent locks are retained unchanged during the bootstrap, not regenerated
locally. New-tip restored checks, protected Validate and hosted CI remain
required. Original development measurements below remain historical.
This integration does not admit a release artifact or authorize deployment.

Integrated lock regeneration run
[`40963173363`](https://github.com/pranems/SCIMServer/actions/runs/40963173363)
passes at exact source `d6b8044dfd4fb28ab61c2ac7de7a49789e828492`.
Artifact `12935469827` has authenticated archive SHA-256
`0c955883595cfe75041e6bb135b60132430d96f64d9d9f8ceb3f4422642a69f7`,
verified before extraction. Both imported roots are 0.55.63. Structural
comparison proves no non-root change: API entries equal the original API
correction, and web entries equal merged #259. Only the web lock's two root
version fields change from the integration bootstrap. The successful serial
clean restores therefore cover the same package graph used by final gates;
no dependency was re-resolved locally.

## Observed mechanism and replacement

The baseline `npm ls --all --json` exits 1 with three invalid package
records, even after an earlier clean restore. Node 24.13.0, npm 11.6.2 and
Arborist 9.1.6 accept the installed semantic versions but reject edges whose
override ancestry differs from the target's ancestry. Examples include
body-parser versus Babel for debug and qs versus form-data for intrinsic
helpers. An invalid override context is a real inventory defect, not a
harmless warning.

```text
Before:
  Owner A under override A -> shared dependency <- Owner B under override B
  Compatible version, incomparable override contexts -> INVALID

After:
  Exact root override -> shared dependency <- every compatible owner
  Same locked version, one shared override context -> valid inventory
```

The existing global iconv-lite correction establishes the same flat exact
override pattern. Existing security overrides remain intact. The pin watcher
already monitors root exact overrides, so no additional production
abstraction or watcher is introduced.

| Package | Exact version | Actual incoming owners | Publication timestamp (UTC) |
|---|---|---:|---|
| debug | 4.4.3 | 16 | 2025-09-13T17:25:19Z |
| get-intrinsic | 1.3.0 | 4 | 2025-02-22T20:54:20Z |
| call-bind-apply-helpers | 1.0.2 | 3 | 2025-02-12T19:24:56Z |
| hasown | 2.0.4 | 3 | 2026-05-28T18:11:39Z |

The regression enumerates every owner path and declared range from the lock,
compares installed owner metadata, verifies semantic compatibility, resolves
the actual package from each owner, and checks every locked occurrence's
public registry URL and SHA-512 integrity. Each shared override must appear
exactly once at the root. A separate assertion executes the actual full
inventory and requires both exit 0 and no problems.

## Execution issues and root-cause analysis

| Issue | Type / severity | Symptom and mechanism | Resolution and why it works | Detection / earliest detection |
|---|---|---|---|---|
| OV-1 | Dependency tooling / High | Three full-tree invalid records despite compatible versions; Arborist rejects incomparable override sets inherited through existing exact security overrides. | Root exact overrides for the three already locked versions unify their contexts without weakening upstream patches. | Baseline full inventory / full inventory after earlier security pin changes. Targeted inventory was insufficient. |
| OV-2 | Dependency tooling / Medium | After the first three fixes, full inventory remains exit 1 for hasown. Clean restore reproduces it. es-set-tostringtag and form-data edges carry form-data ancestry while their target carries get-intrinsic ancestry. | Add hasown 2.0.4 to the same exact root pattern after verifying all three real owners accept it. This directly coupled descendant must be fixed for complete-tree validity. | Focused full-tree regression immediately after first three changes / same stage. No escape. |
| OV-3 | Documentation / Low | The cheap content audit rejects the old README version badge after the ordinary freshness fix updates headers. | Update the badge to the reserved version; keep the existing content audit as the enforcement mechanism. | Cheap preflight / same stage. No escape. |
| OV-4 | Registry metadata / Low | Configured corporate-feed metadata exposes tarball and SHA-1 shasum, not public SHA-512 integrity. | Do not treat absent metadata as a hash match or rewrite locks. Compare downloaded approved-feed bytes to existing SHA-512 locks and authenticate clean CI's public-provenance artifact. | Metadata preflight / same stage. No escape. |
| OV-5 | Evidence tooling / Low | PowerShell's default JSON object conversion rejects the lock's empty-string root package key. | Use `ConvertFrom-Json -AsHashtable` for lock metadata and explicit structural Node comparisons for CI import; no source or lock was changed by the failed read. | Evidence preflight / same stage. No escape. |
| OV-6 | Integration tooling / Low | An overly broad remaining-conflict scan treated a long Markdown equals-sign ruler as a seven-character merge separator. The resolver refused before writing any file. | Require exact separator lines and add negative/positive controls before applying the bulk merge plan. Both historical sections and current-version headers are preserved. | Checked merge plan / same stage. No escape; no partial source edit. |
| OV-7 | Review process / Medium | A reconstructed hold required a GitHub-hosted review even though the written process requires green review and CI without mandating that provider. Empty hosted requests were incorrectly made an additional release dependency. | Verify actual policy and protection settings, complete a separate exact-head technical review, publish its provenance and limitations, then use ordinary PR integration without an invented approval. Web #259 merged at `0a9b3d04`; exact merged-master CodeQL and pin-review jobs pass. | Release continuation / first review-hold classification. The delay could have been avoided at the initial policy check. |
| OV-8 | Filesystem tooling / Medium | After PowerShell `Set-Location`, .NET relative-path resolution still used the process's original directory. Three generated archive files landed in an ignored directory in the original worktree, so the intended owned-path read failed with ENOENT. No source lock import had occurred. | Verify all three files against the authenticated archive, move only that exact generated directory into the owned absolute destination, and remove only the newly created empty parent. Use fully qualified destinations for .NET operations. The import then passes exact graph/provenance checks; no other-worktree source file was edited. | Archive import preflight / destination validation before extraction. One-step escape; close it with an absolute-path guard before any filesystem write. |

OV-1 RED: four actual assertions failed (three missing shared contexts and
the real inventory); three owner/provenance checks already passed.
OV-2 RED: the new hasown context assertion and full inventory failed;
seven other assertions passed. After the fourth pin, all nine new checks
and 29 existing dependency-pin checks pass (38 total, two suites).
The standalone full inventory now exits 0 before final CI-lock restore.
These are focused development measurements, not final release qualification.

Full logs and metadata are retained separately in ignored
`test-results/api-override-context-20261029/`. Baseline and intermediate
full inventories are not replaced with the final success output.
The issue ledger was reconciled against this task's complete tool-call
sequence through focused GREEN; final publication evidence belongs in its
HANDOFF receipt. No diagnosed issue was discarded as harmless.

## Validation and release boundary

### Authenticated CI lock receipt

Unchanged `regen-lockfile.yml` run
[`40913629689`](https://github.com/pranems/SCIMServer/actions/runs/40913629689)
succeeded at source `c9cddb3dfdbb1b7b022ce39404f647c9782006db`.
Artifact `12914787144`, `regenerated-lockfiles`, has authenticated archive
SHA-256 `bad38ee1bd6a8fed20170e71aa8090d589ed0785d449525da91873b123c09d21`.
The downloaded archive matches that digest before extraction or import.

Both locks differ from master only in the two root version fields:
0.55.61 to 0.55.63. Every non-root entry is structurally identical, including
version, source URL, integrity, dependency ranges and flags. No new package
was resolved; the CI publication-age report at 2026-10-29T16:39:01.212Z
therefore has an empty changed-package list and retains the seven-day floor.
The four new pins' publication timestamps above were checked independently.
Approved-feed tarball bytes match each existing public lock's SHA-512.

| CI file | SHA-256 before restore |
|---|---|
| API lock | `0dd66eb53bc7c508cbbef80dc63417ef7178bf9a36f44066299b03f2634b3fb3` |
| Web lock | `fc6121573eb5de28bbc2a70b9f9d9c2eae16d54f660628d7a33d0a2b34269899` |

Both `npm --prefix api ci --no-audit --no-fund` and
`npm --prefix web ci --no-audit --no-fund` PASS serially after physical
ownership checks, through the unchanged configured corporate feed.
Both lock hashes remain byte-identical. The restored full API inventory
exits 0 and all 38 focused checks pass again. The checked-in build-test
workflow supplies the process-only DATABASE_URL prerequisite without
printing its value; no global configuration is edited.

Bootstrap publication used a normal default protected push: 25/25 gates
PASS in 536.4 seconds, API units 6,229 in 214 suites, HTTP 2,514 in 118
suites plus existing 42 skipped tests and two skipped suites. Lint retains
507 warnings and zero errors. The pre-existing parallel HTTP worker-exit
warning remains a separate unresolved observation; no runner setting changed.
This bootstrap evidence does not substitute for the final restored graph's
normal Validate push and exact-tip hosted checks. The final ignored HANDOFF
receipt and draft PR body own those publication results.

1. Retain the actual baseline full inventory and add discriminating RED tests.
2. Verify all real owner ranges and metadata, then add only existing-version
   exact root overrides. Confirm complete-tree GREEN.
3. Use unchanged `regen-lockfile.yml` on clean hosted CI for both versioned
   workspace roots. Authenticate exact source, artifact ID, archive digest,
   provenance and publication ages before importing. No local lock generation.
4. Require zero changed non-root entries in either lock. Recheck physical
   dependency ownership, restore serially through the configured corporate
   feed, and require byte-identical locks and full npm inventory exit 0.
5. A normal protected Validate push owns broad applicable local gates.
   Hosted checks and real review remain independent exact-tip claims.
6. Publish only a draft PR. Rollback reverts this coherent patch; it does not
   remove earlier security overrides or package histories.

HTTP, live, backend-parity, browser and benchmark additions are not applicable:
there is no application source change. Existing broad gates remain unchanged.
The six API security advisory records involving qs, fast-uri and the Hono
server major-version compatibility decision remain outside this change.
No npm upgrade, baseline adoption, quarantine bypass, test suppression,
deadline change, worker change or force-exit change is authorized.

## Self-improvement and design disposition

**Applied:** the regression now requires real complete-tree npm acceptance in
addition to exact shared pins, all owner occurrences and installed resolution.
It caught the newly exposed descendant that a three-record-only fix missed.

**Accepted:** this small manifest correction follows the existing flat exact
override pattern. No class, dependency seam or runtime responsibility grows.
A new resolver abstraction would duplicate npm and is speculative.

The cost is four additional exact pins that need future maintenance; the
existing dependency-pin watcher supplies that monitoring. Complete inventory
success does not prove security-advisory clearance or deployed-image contents.
