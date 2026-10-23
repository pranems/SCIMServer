# Low-disturbance membership observation and statement diagnosis

**Last verified:** 2026-10-23
**Scope:** Unreleased local diagnostics, not release admission.

## Functional qualification of the DERIVED artifact (2026-10-23)

One functional run of the immutable local DERIVED image was authorized,
not production-baseline adoption, an original-image retry or a performance
experiment. Its sole invocation stopped INVALID in metadata preflight,
before fixture creation; functional privacy remains unqualified.
The explicit entry is
`--derived-reference-functional-only`; default, unknown and incomplete calls
reject before Docker dispatch. The build manifest, successful receipt and
original unstarted source proof must match their pinned byte hashes.
The app is requested by immutable image ID `sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4`,
not by its local tag; actual image identity and DERIVED labels must match.
This reuses the completed whole-distribution proof without hashing it again.

The fixed functional policy retains at most seven authenticated requests,
15 readiness probes and five minutes including a 120-second cleanup
reservation. Prospective corrected source writes an exclusive intent before
metadata inspection and a full frozen manifest before owned fixture creation.
The executed attempt did not reach either write; its missing preregistration
is documented below, not retrospectively repaired.
Server false is checked independently from stored endpoint false before
four correlated Group requests. All four exact authorization masks remain
mandatory. Selected rows and complete app, PostgreSQL and tool console inputs
are separately scanned in memory for every generated credential; missing or
empty console input rejects. No raw console/header material is exported.
Only this new artifact can receive functional privacy qualification; original
privacy failures and all performance/admission holds remain unchanged.

### Prospective statement fixture correction, not an executed diagnostic

The old statement fixture omitted both explicit false policies while requiring
masked rows. Future statement source now requests server false at app startup
and verifies its actual environment. An opt-in workload IPC gate pauses after
endpoint creation, before User/Group setup and all counter windows. The parent
uses the supported endpoint PATCH to set false, independently reads the stored
policy, then acknowledges the gate. Missing, true or string `"false"` stored
values reject. This additional setup HTTP request and administrator policy
read are reported separately; the original 4,407 checked child requests,
payloads, cycles, samples and default/admission behavior remain unchanged.
No statement diagnostic is authorized or executed here.

### Focused evidence and preparation issues

Evidence root: `test-results/derived-functional-20261023/`.
Initial RED retained three failed new guard tests and one existing default/
admission rejection success. After implementation, the five-file focused
selection passed 80 tests with zero skips; a final five-test targeted run
passed after scope correction. The actual bounded workload child test rejects
the fixture-policy acknowledgement and proves zero User/Group requests or
timing samples, with successful fake-fixture cleanup. Negative controls reject
the old omitted statement policy.
After final private-structure and cleanup-evidence negative controls, the
four-file source/privacy selection passed 30 tests with zero skips. Six-file
syntax and scoped correctness lint remain green. All checks are local and
unreleased, with no dependency restoration.

| Issue | Cause, correction and prevention | Detection stage |
|---|---|---|
| DF-01, tooling / Low | A shell wildcard was passed as a literal ripgrep path and an endpoint service was sought outside its `services` directory. Corrected bounded path discovery located the DTO and source. No production behavior was involved. | Source exploration; earliest applicable stage |
| DF-02, source correctness / Medium | The new policy callback initially referenced `pgPort` declared inside the later try block. Scoped `no-undef` caught it; the port now lives in the enclosing runner scope. | Static gate, before any fixture or timed workload; no runtime escape |
| DF-03, checking-tool correctness / Low | The scoped lint harness initially omitted Node's standard `URL` global and flagged unchanged code. Declaring that real global removed the false positive without disabling a rule or editing the application. Six-file syntax and scoped seven-rule lint then passed with zero errors. | Static harness; earliest applicable stage |
| DF-04, privacy telemetry / Medium | An undefined selected row serialized to undefined and reached the shared missing-input guard without its row index; a null console collection would have raised a generic TypeError. Targeted RED reproduced the lost row attribution. The new validator now rejects serialization and console-collection shape through the closed source/kind schema, retaining the applicable row index. Thirty focused tests pass after the fix. | New negative control before functional execution; no runtime escape |
| DF-05, qualification safeguard / Medium | The existing finalizer intentionally reports removal verification independently from final metadata capture. A new DERIVED result must not count verified absence as complete final evidence. RED/GREEN added a narrow qualification check requiring both owned resources captured, removed and independently verified. The shared finalizer and its OS-17 observability limitation are unchanged. | Source review and new negative control before execution |

Self-improvement disposition: **applied** immutable-proof drift tests,
closed source/kind privacy negatives, old-policy negative controls and a real
pre-window IPC failure test. Design/architecture disposition: **accepted**:
shared two-policy checks live in the existing statement privacy module, with
two actual callers; the statement runner does not depend on DERIVED build
identity tooling. No speculative framework or shared cleanup refactor.
The sole functional invocation stopped INVALID during metadata preflight;
the actual result and tested-but-unexecuted source correction follow.

Reproducible validation commands and retained results:

| Command | Result |
|---|---|
| `node --test scripts\test\membership-derived-functional.test.cjs` before implementation | RED: three failures, one existing rejection test passed; `red.log` |
| `node --test scripts\test\membership-derived-functional.test.cjs scripts\test\membership-privacy-functional.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-statements.test.cjs scripts\test\membership-performance.test.cjs` | 80 passed, zero skips before the final narrow guards; `green-focused.log` |
| `node --test scripts\test\membership-derived-functional.test.cjs scripts\test\membership-privacy-functional.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-statements.test.cjs` | Final 30 passed, zero skips; `green-source-final.log` |
| `node test-results\derived-functional-20261023\validate.cjs static-source-final.json` | Six syntax checks and scoped seven-rule ESLint: zero errors. This is the retained exclusive-output invocation, not the unavailable full normal lint configuration. |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | Before execution, passed 27 documents; `freshness-source-content.log`. Content-only, not the full coupled gate. |

The `--test-name-pattern` RED invocations and exact safe assertion stacks
are retained in `red-private-structure.log` and `red-cleanup-proof.log`.
No full suite was duplicated. Full-transcript reconciliation is unavailable
because no debug-log location is exposed; this new issue list is reconciled
against the retained commands and outputs of this bounded activity, not
claimed complete for earlier sessions.

### Sole actual invocation: INVALID before fixture creation

Executed committed source: `1ac355932a2625f0df15a2798b423964437f8519`.
Run ID: `8032f52ecc0546b780b49421da6df9b5`.
The command was:

```powershell
node scripts\performance\run-membership-privacy-functional.cjs `
  --derived-reference-functional-only `
  test-results\derived-functional-20261023\attempt1
```

It exited 1 after **27,828 ms**, with zero authenticated requests, zero
readiness probes, zero app/PostgreSQL containers allocated, zero SQL and no
performance samples. The safe receipt records `preflight / OWNED_DOCKER`.
The two-resource completion safeguard also emitted
`derived-cleanup-evidence / INCOMPLETE_CLEANUP_PROOF` because the allocated
set was empty. That second finding is not evidence of leaked resources.
Both independent owner inventories were empty and no network was created.
The derived artifact has **not** received functional privacy qualification.
No original or candidate app started, and no replacement run was attempted.

**The requested preregistration was not fully achieved.** The implementation
placed its full `manifest.json` write after image metadata inspection, so
that file and its frozen-input directory do not exist for this attempt.
The hypothesis, fixed limits and immutable image/proof binding were in the
pre-run source commit, but that is not a substitute for the requested
on-disk preregistration. No manifest has been backdated or reconstructed as
though it existed before execution.
Before correcting source, unchanged executed bytes were copied into
`attempt1/postrun-executed-source/` and sealed in
`attempt1/postrun-source-proof.json`, explicitly marked captured after the
run and not preregistered. For the executed runner, on-disk SHA-256 is
`6fa2208b59f6554de0ed0042c262fe94cf2234db78444a82dcde0ce723813a36`;
Git-normalized SHA-256 is
`60291a6e677e4e79174420e314b68c3e8552dbb25c80bba5e2509c44aec3ce23`.
Raw bytes differ; all seven retained inputs match after CRLF normalization.

### Actual failure diagnosis and prospective correction

Read-only metadata diagnosis, not another functional fixture, established:

1. The exact DERIVED image ID resolves with the expected labels, parent,
   platform and digest. The local artifact is present and unchanged.
2. The newly extended metadata template asked **both** images for
   `.Config.Labels`. The exact cached PostgreSQL image omits that optional
   key. Replaying that metadata-only command returns
   `map has no entry for key "Labels"`.
3. Role-specific formatting retains mandatory labels for the DERIVED app
   but does not request optional PostgreSQL labels. A single metadata-only
   correction check on the same cached PG image returns exit 0, its exact
   pinned ID/digest and `linux/amd64`.

The original Docker stderr was withheld by the existing generic wrapper and
was not recovered. The deterministic source-level PG formatting defect is
confirmed by the later metadata-only reproduction; this is not a claimed
reconstruction of the destroyed original stderr. There is no evidence here
of an application compatibility or application privacy failure.

| Issue | Root cause, fix and prevention | Detection / escape |
|---|---|---|
| DF-06, harness compatibility / Medium | A DERIVED-label requirement was mistakenly imposed on the PG image metadata query. Real PG metadata inspection rejected an omitted optional key. RED/GREEN now tests role-specific formatting, keeps all DERIVED app labels mandatory and verifies the corrected PG-only command succeeds. | Functional preflight caught it; an image-role capability check could have caught it before the sole invocation. No app or data-plane escape. |
| DF-07, evidence ordering / Medium | The full frozen manifest was written only after metadata preflight, losing the on-disk preregistration when that preflight failed. A new exclusive `intent.json` is now written before any Docker metadata command, including source commit/input hashes, immutable requested images, hypothesis and fixed limits; the full resolved manifest still precedes fixture creation. Static ordering regression added. This correction has not been functionally executed. | Discovered while inspecting the failed attempt; earliest gate was source-ordering review. The missing historical manifest stays missing. |
| DF-08, tooling / Low | An inline Node diagnostic hit PowerShell string-escape parsing (`Invalid string escape`) before calling Docker. Moving the public-image-only command into a retained native Node script removed shell interpolation. It did not allocate a resource or repeat functional requests. | Immediate syntax error; earliest possible stage |
| DF-09, result classification / Low | The new cleanup completeness guard assumed two allocations even after an early zero-allocation failure. It now checks the actual allocated count; a fully completed run still necessarily has two owned resources. Negative control distinguishes empty verified cleanup from incomplete final capture. The old receipt remains INVALID with both original findings. | Safe-receipt review after preflight; could have been caught by a zero-allocation failure test |

After these prospective corrections, the same four-file focused selection
passed **31 tests, zero skips**, and six-file syntax/scoped correctness lint
passed with zero errors. Exact outputs are
`green-postrun-correction.log` and `static-postrun-correction.json`.
The post-run static command was
`node test-results\derived-functional-20261023\validate.cjs static-postrun-correction.json`.
The source tests used the four-file command above.
Public-image metadata command arguments and outcomes are retained separately
in `metadata-diagnosis.json`, `metadata-pg-diagnosis.json` and
`metadata-pg-correction.json`; none starts a container or SQL connection.
These successes do **not** replace the INVALID functional result.

The tested, functionally unexecuted correction is committed locally as
`462365dbe3c51614d658a6169411bcb6342dd4c5`, separate from executed
`1ac355932a2625f0df15a2798b423964437f8519`.
Post-run content-only freshness passed 27 documents using
`pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling`;
`freshness-postrun-content.log` retains its result. This is not the full
coupled documentation gate.

### Independent closeout preservation and cleanup

`test-results/derived-functional-20261023/closeout-proof.json` records a
read-only final check. The exact run has zero remaining owned containers
and networks. The same three unrelated shared containers remain running,
untouched. Original baseline, unchanged current candidate and local DERIVED
image identities still match their immutable references. The three sealed
build/source proof hashes, earlier retained manifest hashes and all seven
post-run preserved executed inputs verify. No application distribution
rehash, container startup, SQL, build or functional replacement was performed.
The 90 local branches and ten stashes are preserved; local qualification
remains `d25b6155bace7af2ec4ccb89f2eb0048e2db0c26` and its origin reference
remains `f6f03a523b6370eccc63f1499c3c111dd5cdf200`.

The actual INVALID receipt SHA-256 is
`0d42ce93932add958e17a2a02a2ee7de6c815c8d506c26416468e6f177058ab7`.
Its absence of a manifest remains explicit in the closeout proof.
The artifact is stored locally but **functionally unqualified**; adoption,
publication, performance and deployment remain held.

Self-improvement disposition: **applied** role-specific optional-metadata
tests, preregistration-before-preflight ordering and zero-allocation cleanup
tests. Design disposition: **accepted**, narrow opt-in helper changes only;
no default/admission image switch, generic cleanup refactor or new framework.
Next engineering action is a separately authorized new bounded functional
check of the corrected source. There is no authorization here for another
attempt, baseline adoption, statement execution, performance or publication.

## Offline DERIVED reference preparation, not baseline adoption

**Exact-image source proof now confirms the known raw database-URL startup
emitter.** One explicitly owned, never-started container was created from
the cached immutable 0.55.20 parent. Its exact compiled Prisma file has SHA-256
`00ea9943fb8f6ecf296b34af5c9072d447b346d15b213669ba83d1f422f92c33`
and contains both logging statements corrected by reviewed commit
`5896771677e3a67308160d2853c69349ad4188c3`. This strengthens the earlier
release-associated source evidence; it still does not reconstruct any
destroyed matched runtime line or OS-07 row.

The source container remained in `created`, with `Running=false` and a zero
start timestamp. Its entire `/app` distribution was copied as a sealed archive
without starting an entrypoint, health check, application, Node or PostgreSQL
process. Ownership-checked removal and a separate empty inventory check
succeeded. Evidence is retained in
`test-results/derived-reference-20261023/source/`.

An explicit-opt-in local builder,
`scripts/performance/build-membership-privacy-reference.cjs`, produced
the separately named **DERIVED** privacy reference. It does not modify
the frozen baseline protocol, existing images, application-reported version,
admission logic, request paths, SQL, dependencies, fixtures or resource limits.
The only intended content change is removal of the known successful-startup
database-URL message and replacement of its fallback warning with the
reviewed static warning.

The complete original compiled-file hash and exact startup-statement source
hash are pinned before transformation. The resulting compiled-file hash must
be exactly
`f558ea53e53492776ed88fc7f44ee36e30a2a706025703264ca071e6b3c68c24`.
These are hashes of source files/statements, not generated credentials.
No displayed/redacted source literal is used as a replacement authority.

The recipe uses the exact cached parent, no external Dockerfile frontend,
`--pull=false`, `--network=none`, no `RUN` or npm steps, fixed copied-file
timestamps and `SOURCE_DATE_EPOCH=0`. Only the approved compiled file is
copied, preserving its actual mode, UID and GID. New labels disclose DERIVED,
parent, source commit and no runtime qualification/admission. A unique local
tag prevents overwriting any tag. One build is bounded by five minutes with
45 seconds reserved for cleanup; no retry or application startup is dispatched.

Verification compares the whole application path set, file bytes, links,
modes and ownership, allowing exactly that compiled-file delta. It also
requires unchanged parent filesystem layers, exactly one added layer and
identical nonlabel image runtime configuration. Application file timestamps
are not compared, and reproducibility of a second build will not be claimed
from this single authorized build.

### Preparation issues and prevention, captured before the build

| ID | Type / severity | Actual issue and resolution | Detection / prevention |
|---|---|---|---|
| DR-01 | Tooling / Low | The installed `docker buildx inspect` rejected `--format`. Supported plain inspection established the existing running `docker` driver and BuildKit v0.33.1, without bootstrap or installation. | Capability probe before build; no unsupported flag is used in the recipe. |
| DR-02 | Source-proof correctness / High | A tool-rendered startup literal contained a masking placeholder not present in the exact source. Synthetic fixtures passed, but the actual-source preflight failed `Exact reviewed statement count` with `0 !== 1`. The correction pins full compiled bytes plus the complete startup-statement source hash, then removes the exact in-memory statement; no credential-bearing source literal is copied into new tracked code. | Actual-source RED and seven-test GREEN, with zero skips when `DERIVED_REFERENCE_SOURCE` points to the retained extraction. A synthetic fixture alone is not exact-image proof. |
| DR-03 | Image metadata compatibility / Medium | The first committed preparation stopped after 22.293 seconds because the image JSON omits optional `OnBuild`, while the guard required explicit null. The retained `build1/receipt.json` is INVALID. No build command, frozen build manifest, derived image or verification container was created. Explicit absence, null and an empty array now mean no declared inherited instruction; any present unknown value or nonempty array still rejects. | Source-only structural replay proved field omission. Targeted RED preceded the correction; eight builder tests, including the exact extracted source, then passed with zero skips. Two-file syntax/scoped lint also passed. This correction precedes the one actual build and does not reinterpret the failed preflight. |

Self-improvement: **applied** actual extracted-source validation alongside
synthetic drift, missing/duplicate statement, archive-framing, whole-distribution
and real-child default/admission rejection checks.
Design/architecture disposition: **accepted** one cohesive opt-in source/build
tool using native Node and Docker; no generic patch engine or framework seam.
The existing OS-17 capture-observability follow-up remains separate.

### Actual local artifact and proof

**Status: DERIVED_BUILD_VERIFIED, source/build proof only.** The one actual
Docker build and unstarted verification finished in 150.417 seconds, including
owned verification-container cleanup, below the fixed five-minute limit.
The earlier 22.293-second INVALID preflight dispatched zero builds; both its
receipt and the later build receipt are preserved in different directories.

| Identity or proof | Actual result |
|---|---|
| Local named deliverable | `scimserver-local:0.55.20-privacy-reference-derived-1b39d0d7-86f` |
| Local image ID / emitted manifest digest | `sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4` |
| Emitted image config digest | `sha256:2c54358449ffe03dec98400e27e649473843068c8511e350a353e5d7fc71da91` |
| Exact cached parent reference | `ghcr.io/pranems/scimserver@sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a` |
| Observed parent platform image ID | `sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a`, `linux/amd64` |
| Executed builder source commit | `b7fdb9c6afa576057abcc38731cc4f271fb74e41` |
| Frozen manifest SHA-256 | `100490fd58eec02c9fec29169a6d25882a475920fdc8a136d8c08a5ab9a2fd54` |
| Receipt SHA-256 | `b0fd28138a4f622927d5816ea8180e7edb87a792be5e39b0e58b6a5596d03a9d` |
| Dockerfile recipe SHA-256 | `bea96a0fe7fd8766a33476c741f9aad83b92de4d9a8d1f3faf23966066bd0cab` |
| Application distribution | All 13,678 entries compared: 12,011 regular files, 11 symlinks and 1,656 directories. Exactly one regular-file content/size delta, the pinned Prisma logging file; all other entries and compared metadata identical. |
| Approved compiled delta | Original 4,020 bytes / hash `00ea9943...`; derived 3,848 bytes / hash `f558ea53...`, matching the full pinned hashes above |
| File metadata | Original and derived mode `0644`, UID/GID `1001:1001`; symlink targets and all non-target file hashes unchanged |
| Inherited runtime | Parent filesystem layers identical, exactly one added COPY layer, all nonlabel image runtime configuration identical |
| Version and labels | Package-declared `0.55.20` retained; new image labels explicitly disclose DERIVED, parent, source commit, no admission eligibility and no runtime qualification. No version endpoint was invoked. |
| Deterministic controls | Fixed copied-file/image creation epoch observed; no second build was performed, so repeated-build reproducibility is not empirically established |
| Tools | Host Node v24.13.0; Docker 29.8.2; buildx v0.37.2; existing Docker-driver BuildKit v0.33.1 |
| Image-declared Node | `NODE_VERSION=24.20.0`; read from cached image metadata, not asserted as a newly executed binary version |
| Cleanup | Original source and derived verification containers both removed, with independent empty owner-label inventory. No application, PostgreSQL, health-check or entrypoint process started. |

The authoritative executed input is the frozen on-disk builder file:
SHA-256 `1d72a8dfd9404c7d500f577d78e715228b0a08a1d689857b7ef80b5e300c09ec`.
The committed Git blob has SHA-256
`60a9a22f1ba8f3d41f0c6198c0893adf9e83913b7c41f53bfe5f6d4da8412532`.
They differ as raw bytes and match after CRLF-to-LF normalization; raw-byte
identity is not claimed.

Actual provenance command, not permission to rerun it:

```powershell
node scripts\performance\build-membership-privacy-reference.cjs `
  --build-derived-reference `
  test-results\derived-reference-20261023\source `
  test-results\derived-reference-20261023\offline-build
```

That output directory is exclusive and already exists. The build log records
a cached parent, a 3.88 kB context and one COPY step; there are no RUN,
package-install or downloaded-layer steps. The exact Docker arguments,
`--pull=false`, `--network=none`, fixed epoch and source/recipe hashes were
frozen in `offline-build/manifest.json` before the build. No frontend was
downloaded. Packet-level daemon network activity was not independently
instrumented; `--network=none` governs build-step networking, not a claim that
packet capture proved the daemon made no metadata lookup.

Evidence root: `test-results/derived-reference-20261023/`.
The successful `offline-build/` directory holds `manifest.json`, `receipt.json`,
`build.log`, `image-id.txt`, the frozen executed builder, exact Dockerfile and
corrected compiled input, both complete distribution manifests, and the
unstarted derived application archive. The separate `source/` directory holds
the original exact source, full archive, unstarted identity proof and exact
extraction commands. The named local image remains as the requested build
deliverable, not a deployment.
`closeout-proof.json` independently seals the source-extraction script/proof,
frozen builder, exact recipe, both application archives and compiled input;
all checks match. It also records unchanged original 0.55.20 and 0.55.60 image
identities, four unchanged earlier manifest hashes, zero owned source
containers and exactly one build command across both preparations.
Local qualification `d25b6155` and origin qualification `f6f03a52` remain
unchanged; all 90 local branches and ten stashes are preserved.

### Validation, limits and pending decision

All 31 focused builder/privacy tests passed, including seven builder tests
and the actual extracted source with zero skips. Two changed code files passed
native syntax and scoped ESLint using the existing engine; no dependency was
installed. After the optional image-field correction, eight builder tests
again passed with zero skips, plus fresh syntax/scoped lint. The 24 unchanged
privacy tests retain their earlier GREEN result, not an invented new run.

| Exact validation command | Result and retained output |
|---|---|
| `node --test scripts\test\membership-privacy-reference.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-privacy-functional.test.cjs scripts\test\membership-statements.test.cjs` with `DERIVED_REFERENCE_SOURCE=test-results\derived-reference-20261023\source` | 31 passed / zero skipped, `green-consolidated.log` |
| `node --test scripts\test\membership-privacy-reference.test.cjs` with the same source setting | Eight passed / zero skipped after correction, `green-optional-image-config.log` |
| `node --check scripts\performance\build-membership-privacy-reference.cjs` and `node --check scripts\test\membership-privacy-reference.test.cjs` | Both passed after correction |
| `node test-results\derived-reference-20261023\validate.cjs` using the existing ESLint engine with seven explicit correctness rules | Two files, zero errors; `static.json` and `static-correction.json`. This is the retained invocation, not permission to overwrite its exclusive output or rerun; scoped correctness lint, not the unavailable normal configuration's full gate. |
| Sole offline build command above | Exit 0 / DERIVED_BUILD_VERIFIED; `offline-build-command.log` |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | Passed, 27 documents; `freshness-sourcebuild-content.log`. Content-only, not the full coupled gate. |
| `git diff --check` | Passed. Whitespace check only; not runtime or admission qualification. |

Source was first committed as `c26768ba`; the optional-field correction is
committed as `b7fdb9c6` before the one actual build. The first failed preflight
is preserved verbatim, not overwritten or described as a build failure.

**Pending explicit decision:** whether this separately identified derivative
may become a prospective diagnostic reference. Neither this build nor the
unavailable user's earlier design choice grants that approval. Runtime
privacy, functional behavior and performance have not been measured on it.
Removing startup logging changes startup work and may affect initial process
history, so request-path byte preservation is not proof of performance
equivalence. Source maps remain original, and file timestamps are excluded
from distribution comparison. The original 0.55.20 image and receipts, negative
0.55.58 admission result, unchanged 0.55.60 candidate, PR #251 and all remaining
release/deployment holds retain their prior meaning.

RCA covers retained commands and failures DR-01 through DR-03 from this
source/build activity. A full earlier-session transcript is not available
through `VSCODE_TARGET_SESSION_LOG`; no full-history reconciliation is claimed.
OS-17 remains separate. No runtime probe, SQL request, performance campaign,
workflow, push, PR mutation, cloud change or deployment was performed.

## Attempt 2 closeout: credential source located, strict result INVALID

**The sole conditional reproduction localized the new privacy rejection to
application-container console output and the PostgreSQL administrative
password role.** It did not fail the four correlated Group authorization
checks: all four had exact masks. No further reproduction or performance
experiment was run or is authorized by this result.

| Observed fact | Result |
|---|---|
| Executed source commit | `fe63bd8df8e4d32036a3233078f8c59ccf184315` |
| Frozen manifest SHA-256 | `8e53459fcf7090725243698ba2f1f79df41f0901f88cd0bb357ba8316aacdc11` |
| Run identity | `950e3bc2253f49e483e51b4e377a2a42` |
| Start / total elapsed | 2026-10-23T20:33:53.939Z / 224.078 seconds, within the five-minute cap including cleanup |
| Actual application | Exact cached 0.55.20 baseline, 0.5 CPU and 1 GiB |
| Persistence policy | Actual server setting `"false"` and stored endpoint setting false; preset setting absent |
| Requests | Seven authenticated functional requests and 13 separate readiness probes, below their respective caps |
| Correlated Group rows | Four expected method/route/status/request-ID/endpoint matches; all `authorization-redacted` |
| Privacy rejection | `generated-credential-detected`, source `app-console`, kind `postgres-admin-password` |
| Other scanned inputs | No generated-credential match in selected rows, PostgreSQL console or Docker tool console |
| Outcome | **INVALID**, not privacy success, admission or release PASS |
| Cleanup | Both exact owned containers and their network removed; post-removal inventory empty |
| Final capture limitation | Application metadata capture failed before removal. Ownership-checked removal and independent absence verification succeeded. Its underlying capture error code was not retained. |

The preregistered source review and hypothesis are retained in
`test-results/os07-functional-20261023/source-review-2.json`. The immutable
attempt lives under `test-results/os07-functional-20261023/attempt2/`, with
`manifest.json`, `report.json`, six frozen executed inputs,
`source-byte-proof.json`, `source-attribution.json` and `held-proof.json`.
No raw private console, credential value, matching substring, context,
credential hash or credential length was exported.

### What the source evidence explains, and what it does not

Release-associated 0.55.20 source at
`6785200ff59ccbc12f62b795439fb245e1635480` contains a Prisma startup message
that interpolates the configured database connection string. The exact
copied compiled legacy logger sanitizes structured data but appends the
message string directly to console output. Together, these facts are strongly
consistent with the observed application-console administrative-password
category. Existing fix `5896771677e3a67308160d2853c69349ad4188c3`
removed that successful-startup emitter and made fallback diagnostics static.
That fix is an ancestor of current 0.55.60 source.

**Attribution limit at the attempt-2 closeout:** the exact compiled legacy Prisma startup file was not
in the retained source copy, the image metadata lacks a valid source-revision
label, and the matching raw console line was deliberately not retained.
Therefore this is not proof of a unique emitted line in the exact historical
image from those attempt-2 artifacts alone. The subsequent unstarted extraction
above now confirms the exact image contains the known emitter, but still does
not reconstruct attempt 1's destroyed match or identify the
destroyed OS-07 row. The newly established result is the safe source/kind
category in attempt 2.

Current repository Prisma source matches 0.55.60 master and does not contain
the known emitter. Its existing 13-test unit suite passes. That is source and
unit evidence, not another runtime privacy qualification of the current image.
The immutable baseline cannot be historically patched, and strict privacy
checks remain unchanged. A future timing comparison is blocked pending a
separately authorized, independently justified privacy-compatible baseline.

### Final validation and preservation

| Exact command or check | Actual result |
|---|---|
| `node --test scripts\test\membership-statements.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-privacy-functional.test.cjs` | 23 passed before execution; 24 passed after the additional fallback regression below |
| `node --test --test-name-pattern='deadline or first failure\|finalization attempts\|admission rejects' scripts\test\membership-history.test.cjs` | Three unchanged targeted tests passed before execution |
| `node test-results\os07-functional-20261023\validate-attempt2.cjs` | Seven source/test files passed syntax and scoped ESLint before execution; this exclusive-output artifact was not overwritten |
| `node test-results\os07-functional-20261023\validate-closeout.cjs` | Two post-run files passed syntax and scoped ESLint, zero errors; retained in `static-closeout-final.json` |
| `node scripts\performance\run-membership-privacy-functional.cjs --functional-only test-results\os07-functional-20261023\attempt2` | Sole execution, exit 1 / INVALID with safe source/kind retained |
| `npm --prefix api test -- --runInBand --runTestsByPath src/modules/prisma/prisma.service.spec.ts` | One suite, 13 tests passed; no new current-image runtime |
| Four earlier manifest hashes | Phase 1, observer smoke, phase 2 and attempt 1 matched their previously retained hashes |
| Available older frozen-input proof | All nine phase-two and five attempt-one `sourceHashes` entries matched their frozen files |
| Six attempt-two frozen inputs | All matched manifest hashes. Raw Git bytes differ; all match after CRLF-to-LF normalization. Frozen on-disk bytes are authoritative. |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | 27 documents passed content-only checks; `freshness-closeout-content.log`, not a full coupled gate |
| `git diff --check` | Passed; whitespace evidence only, not runtime or admission evidence |

After the run, an additional real bounded-child negative test exposed a
fallback-receipt defect: the minimal writer copied unchecked family/run,
cleanup and inventory fields from the rejected report. A private value there
could reject the fallback too and prevent the safe receipt from being written.
The correction uses a fixed family, projects only the proven cleanup boolean,
and records nonempty inventories as `unverified` instead of copying strings.
RED was actual child exit 1 versus expected 0; all 24 focused tests are GREEN
after the fix. This correction is **tested but not used in attempt 2**;
`fe63bd8d` and all six executed frozen files remain unchanged.

Retained validation logs are under
`test-results/os07-functional-20261023/`, including
`red-recursive-receipt.log`, `green-recursive-receipt.log`,
`regression-owned-finalization.log`, `static-attempt2-final.json`,
`functional-attempt2.log` and `current-prisma-source-regression.log`.
Documentation freshness checks using `-SkipCoupling` are content-only
checks, not evidence that the full source-coupled freshness gate passed.

RCA completeness is reconciled against retained command outputs and the
current activity's actual failures. `VSCODE_TARGET_SESSION_LOG` is unavailable,
so a full prior-session transcript reconciliation cannot be claimed.
Destroyed private evidence was not reconstructed. No push, PR #251 mutation,
remote CI, cloud operation, new image installation or deployment occurred.
Original 0.55.58 negative admission evidence and all customer, migration,
capacity, operational, cleanup-403 and visual holds remain unchanged.

## Source-only policy review before attempt 2

**The frozen phase-two fixture did not request masking.** It omitted both
the server persistence environment variable and an endpoint persistence
override. The exact cached 0.55.20 image has no image-level override, and its
copied `rfc-standard` preset omits `PersistRequestSecrets`. Exact compiled
source therefore predicts the legacy default, true. Requiring a mask without
explicitly disabling persistence was an unjustified fixture assumption.
Confidence in that source-level contract conflict is high; the destroyed
runtime settings, cache and individual OS-07 row are still unknown.

| Input or state | Frozen phase two | First new functional fixture |
|---|---|---|
| Launcher `PERSIST_REQUEST_SECRETS` | Not passed | Explicit false, independently observed false |
| Cached image environment override | Absent | Same exact baseline image |
| Requested endpoint preset | `rfc-standard` | `rfc-standard` |
| Exact copied preset persistence setting | Absent | Observed absent before explicit update |
| Explicit endpoint persistence update | None | False, independently read from owned database |
| Effective setting of the destroyed old row | Not retained | Not reconstructed from the new fixture |

This does not establish that the old mismatch was a raw generated
authorization header: the frozen validator's generated-credential check
preceded its mask assertion and did not fail there. A raw generated credential
would have failed that earlier check. The old SQL also lacked endpoint and
request-ID correlation. Policy inheritance explains why the asserted contract
was unsupported, not which destroyed row or value caused OS-07.

The separate OS-11 failure from functional attempt 1 remains a different
question. That fixture sent credentials only through its authorization
header, selected four correlated Group records, observed four exact masks,
and then rejected a generated-credential match somewhere in its selected rows
or combined console input. The selected nonheader fields derive from owned
identifiers, static routes/methods and statuses; no body was selected.
Application-container startup runs Prisma migrations before the application.
Its migration stdout is suppressed but stderr is not. The logging sanitizer
redacts sensitive object keys; a string containing a credential is not
necessarily redacted by that key-based mechanism. These are possible paths,
not an identified emitter.

The new discriminating hypothesis is that startup/migration or other
container output, rather than a Group authorization field, supplied OS-11.
The implementation separately scans selected rows, application-container
records, PostgreSQL-container records and Docker tool output. Docker
`--timestamps` prefixes distinguish container records from unframed tool
diagnostics; they do not identify a particular application statement.
PostgreSQL administrative output and tool diagnostics must not be mislabeled
as application defects. No raw stream or matching context is persisted.

### Executable information-preservation safeguard

`membership-privacy.cjs` now constructs every rejection in this diagnostic
privacy family through a closed schema: static reason, input source,
credential kind, and row index when applicable. Credential roles are declared
by the real callers, not inferred from values. All matching source/role
combinations are retained, rather than only the first. Missing inputs,
invalid roles, serialization failures, malformed headers, missing masks,
provenance failures and report-output rejection keep the same safe contract.
Unknown metadata is rejected using a fixed safe category, never echoed.

The report writer rejects private output before writing and preserves a
minimal INVALID receipt with safe cause/source/kind and cleanup facts. An
actual bounded Node child verifies that path. Tests also reject added
private-value, credential-hash, length or context fields in failure metadata.
A static regression selector prevents bare canary assertions from returning
to the active statement helper and both current diagnostic runners.
The original admission/default path and all frozen input directories remain
unchanged; this is prospective diagnostic tooling only.

Before any conditional attempt, 23 focused tests and three unchanged
deadline/finalization/admission selectors passed. Seven changed code files
passed native syntax and scoped ESLint correctness rules with zero errors.
This is not a repeated performance campaign.

### Execution issues and immediate prevention

| Issue | Type / severity | Confirmed cause and fix | Detection and earliest applicable check |
|---|---|---|---|
| OS-13 | Diagnostic evidence / High | The previous correction retained a row/console location but lost credential role; input and output assertions could bypass metadata entirely. One typed, allowlisted failure seam now covers real callers, all private inputs and final receipt writing. No secret-derived identifier or context is exported. | Focused RED observed missing `source`; complete input/output negative tests and bounded-child GREEN now prevent recurrence. |
| OS-14 | Test/tooling / Low | An insertion matched an inner closing brace. The first name-filtered command executed no matching subtest and reported only a file-level success. A full small selector exposed the missing metadata. A later misplaced helper declaration failed module loading. Both were corrected using full function boundaries. | Whole-file selectors and `no-undef` catch these before execution; file-level success is not evidence that a named test ran. |
| OS-15 | Static correctness / Low | A newly added throw inside `finally` violated `no-unsafe-finally`. The minimal-receipt writer was extracted into a small cohesive function, then proved in an actual bounded child. | Scoped ESLint caught it before any fixture; zero errors after the correction. |
| OS-16 | Legacy privacy evidence / High | Attempt 2 proves an application-console match for the PostgreSQL administrative password role, while all four selected authorization fields are masked. A release-associated raw database-URL startup emitter is strongly consistent and was already removed in current source by `58967716`; exact emitted-line attribution remains unproven. The immutable baseline stays INVALID. | Complete static source/kind telemetry caught the new category during bounded functional proof. Existing current Prisma tests pass; no privacy waiver or historical image modification. |
| OS-17 | Cleanup observability / Medium | Final application metadata capture failed; the existing finalizer retained only a boolean, so the original error code is unknown. Exact owned removal and independent absence checks succeeded. Final captures must not be described as uniformly successful. | Finalization receipt caught the capture failure, but an earlier safe error-category retention check could have preserved its cause. Follow-up owner: diagnostic maintainer; target 2026-10-24, separately authorized source-only cleanup-telemetry hardening. No retry in this scope. |
| OS-18 | Diagnostic receipt / High | A post-run negative child proved unchecked cleanup/inventory/family fields could trigger a second rejection in the fallback itself. The fallback now projects a fixed schema with no unchecked strings. This correction was not used in attempt 2. | Actual child RED (`1 !== 0`) before correction; focused GREEN 24/24 afterward. This closes the newly found receipt-loss route without weakening privacy. |

The source-only facts and exact command evidence are retained under
`test-results/os07-functional-20261023/`: `source-review-2.json`,
`red-source-kind-full.log`, `red-complete-functional-telemetry.log`,
`red-final-receipt-and-null-row.log`, `green-attempt2-ready.log`,
`regression-owned-finalization.log`, and `static-attempt2-final.json`.
No new container was created for the source-only review.

Self-improvement: **applied** the closed failure schema, branch-matrix negative
tests, static bare-assertion check and real-child minimal receipt proof.
Design/architecture disposition: **applied** one small shared privacy seam
for two real diagnostic callers; default/admission behavior and historical
application images are not generalized or changed. No new framework is needed.

## OS-07 first bounded functional follow-up

**Outcome: INVALID and inconclusive for OS-07.** The single functional run
completed seven authenticated requests and verified cleanup in 182.033 seconds.
All four known authorized Group rows had object-shaped serialized headers with
the exact mask. However, generated-credential absence failed on private input.
No retry ran. This neither reproduces the old mask mismatch nor establishes
an application defect; no original private evidence has been reconstructed.

Exact cached 0.55.20 source confirms that `resolvePersistSecrets` inherits
`PERSIST_REQUEST_SECRETS`, defaulting to true, unless endpoint settings override
it. The interceptor copies request headers, the exception filter uses captured
headers or a request-header fallback, and `stringifyValue` serializes stored
headers with `JSON.stringify`. None identifies the destroyed OS-07 row.
The executed phase-two SQL selected the latest 200 Group PATCH/error rows
without correlating their request IDs to the workload.

The single functional fixture explicitly disabled server and endpoint secret
persistence. Seven generated-authenticated requests were preregistered:
endpoint creation and policy update, Group creation and update, missing-Group
GET and PATCH, and one flush. Four exact authorized Group rows must match
endpoint, request ID, method, route and expected status. Omission, duplicates,
foreign rows and missing masks fail. Readiness is counted separately.
The cap is five minutes including a two-minute cleanup reservation, with a
ten-second bounded SQL flush wait. There are no timing cycles.

The shared privacy validator accepts an explicit required count for this
four-row proof. Its existing default remains exactly 200 and every selected
row still requires the exact `[REDACTED]` authorization value.
Generated-credential absence is checked privately in rows and both console
streams. No raw header value, connection string, payload or credential is
written.

Before execution, 13 focused tests passed, including actual bounded child
default rejection, admission rejection, privacy negative canaries, exact
provenance/count rejection and successful empty flush responses. Four files
passed native syntax and scoped ESLint correctness checks. RED evidence and
the frozen manifest belong under
`test-results/os07-functional-20261023/`, separate from all previous runs.

### Actual functional observations and their limits

Run `03050f4d33d740a398deff7d0eb419ba` started at
`2026-10-23T20:05:01.542Z` from committed source
`ec745e7a387bcb2b969bcfa3ba7bc264ed076aa5`.
The exact cached baseline digest ends `8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a`;
the exact cached PG17.11 digest ends
`2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.
Requested digests and actual platform image IDs matched.
The application reported 0.55.20 and `PERSIST_REQUEST_SECRETS=false`;
the endpoint's stored setting was independently read as false.
The unmodified `rfc-standard` preset had no value for this setting in the
new fixture. That absence is not proof of the old run's effective policy.
Actual application limits were 0.5 CPU and 1 GiB, with no observed OOM flag.

| Known authorized route | Method | Observed status | Endpoint/request/method/route/status proof | Header classification | Old SQL predicate |
|---|---|---:|---|---|---|
| Group creation | POST | 201 | Matched | Authorization present, exact mask | Excluded |
| Existing Group update | PATCH | 200 | Matched | Authorization present, exact mask | Included |
| Missing Group read | GET | 404 | Matched | Authorization present, exact mask | Included |
| Missing Group update | PATCH | 404 | Matched | Authorization present, exact mask | Included |

The other authenticated requests were endpoint creation (201), endpoint
policy update (200), and flush (204). Fifteen unauthenticated health readiness
attempts were recorded separately. They were not eligible for the selected
four-row cohort. Three of these four rows satisfy the old Group PATCH/error
SQL predicate. This proves that particular new cohort's provenance and mask
shape, not the provenance of the old 200 rows.

The strict privacy check then rejected a generated credential match in either
the private selected rows or combined application console streams. Its executed
failure classification did not retain which input matched. The header
classifications do not prove that other private fields or console output were
safe. No raw value was saved, and neither source nor credential kind can now be
recovered from this receipt. **There is no overall privacy PASS.**

Both owned application/database containers and their network were removed.
Capture, removal and post-removal verification succeeded for each container;
the final run-label container and network inventories were empty.
The two unstarted source-inspection containers were also removed.
The three pre-existing shared containers were untouched.

The manifest hash is
`6ca5d02cc4875a4935e5eecbb527b3910375e41fd5380bc72e3372242645d52e`.
All five frozen inputs match their manifest hashes. None matches its Git blob
byte-for-byte; all five match after CRLF-to-LF normalization.
The frozen on-disk bytes, not a reconstructed Git checkout, identify this run.
`attempt1/source-byte-proof.json` records both comparisons.

### Validation and retained evidence

| Exact command | Result |
|---|---|
| `node --test --test-name-pattern='small functional privacy sample' scripts\test\membership-statements.test.cjs` | Confirmed RED on exact row count, after correcting test discovery |
| `node --test scripts\test\membership-privacy-functional.test.cjs` | Confirmed RED on accepting duplicate/foreign rows; later GREEN |
| `node --test --test-name-pattern='legacy flush' scripts\test\membership-privacy-functional.test.cjs` | RED on absent successful-empty decoder; later GREEN |
| `node --test scripts\test\membership-statements.test.cjs scripts\test\membership-privacy-functional.test.cjs` | 13 tests GREEN before execution; 14 GREEN after the unmeasured metadata correction |
| `node scripts\performance\run-membership-privacy-functional.cjs --functional-only test-results\os07-functional-20261023\attempt1` | INVALID, exit 1; seven authenticated requests, no replacement, cleanup verified |
| `node --test --test-name-pattern='generated-credential rejection retains' scripts\test\membership-statements.test.cjs` | Post-run RED on missing row-versus-console provenance; later GREEN |
| `node test-results\os07-functional-20261023\validate-final.cjs` | Four files passed native `node --check` and scoped ESLint correctness rules; zero lint errors |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | 27 manifest documents passed content-only currency/link checks; source coupling was explicitly skipped, so this is not the full coupled gate |
| `git diff --check` | Passed |

The evidence directory holds separate RED/GREEN logs, frozen inputs,
`functional-run.log`, the manifest, and the privacy-safe `report.json`.
No phase-one/phase-two receipt, raw sample or executed source was changed.
The diagnostic document remains indexed in `docs/INDEX.md`. The freshness
result above covers the manifest's 27 documents, not an invented full-project
documentation gate.

Execution issues confirmed during preparation:

- **OS-09, source inspection / Low:** an assumed controller filename was absent
  from the cached image. The unstarted source container was still removed.
  Already copied exact logging/filter/config/DTO source supplies the relevant
  contract; no historical application was modified. Oversized tool output was
  reissued as bounded original-source reads; automatically generated temporary
  output files were never opened. A mismatched document-heading patch was
  corrected after reading the actual heading. These were preparation-time
  tooling failures, with no runtime escape or waived result.
- **OS-10, test selection / Medium:** an initially nested test was not selected
  by its standalone name, producing only a file-level green result. Moving it
  to top level exposed the expected row-count assertion RED. Named assertion
  evidence, not a file-only green, is required. The subsequent 13-test run
  includes the actual named regression.
- **OS-11, functional privacy rejection / unresolved severity:** all four
  selected authorization fields had the mask, but the broader canary check
  rejected private input. The underlying mechanism is unresolved, not an
  established application defect. Resolution: retain INVALID and stop. The
  functional privacy check was the first applicable runtime detector.
- **OS-12, failure provenance / Medium:** the executed canary classifier
  intentionally suppressed values but also omitted whether rows or console
  matched. That omission was detected when reviewing this stopped run; the
  earliest possible detector was a negative-canary unit test before execution.
  A focused assertion first failed, then passed after retaining only static
  `rows`/`console` locations. This correction is tested but unmeasured. It does
  not add missing facts to `attempt1/report.json`.

This follow-up ledger is reconciled against the retained source-inspection,
RED/GREEN, static-check and single functional-run records available for this
turn. It does not claim reconciliation against a full historical session
transcript, and it does not reconstruct any discarded private input.

Self-improvement is **applied** through exact known-request provenance and
negative canaries. The design disposition is **accepted**: one cohesive,
opt-in functional fixture reuses the existing client, strict privacy classifier
and cleanup finalizer. No new framework or speculative abstraction is needed.

### Remaining work is blocked on a new bounded authorization

OS-07 remains unresolved. Before any further runtime diagnosis, explicitly
authorize a new functional scope that uses the tested canary-location metadata.
If it identifies console input, inspect the exact legacy startup/logging source;
if it identifies rows, inspect only safe request provenance and structural
fields privately. Do not relax the mask or generated-secret checks. No new
performance experiment, admission retry or deployment is authorized by this
result. All earlier publication, customer-data, operational and release holds
remain unchanged.

## Executive summary

The previous boundary collector paused the workload for 12.981-24.731 seconds
per observation because it launched two serial Docker CLI commands. That is a
measurement-system defect, not application latency. The replacement starts one
owned read-only observer channel and uses bounded JSON-lines requests after
startup. No prior receipt is relabeled as using this corrected collector.

The fixed observer-only smoke has passed. SQL capability and privacy checks on
a separate disposable cached-PG fixture also passed. The single subsequent
eight-round statement attempt is **INVALID after four complete BAAB rounds**:
an exact legacy header-redaction assertion failed after the block. All owned
resources were removed. No ABBA or replacement run was attempted. No additional
16-round history experiment, remote publication, deployment or release
admission is authorized.

## Request and identity flow

```text
Owned app creation -> inspect exact owner, image, PID and resource configuration
                  -> bind PID/container to actual Linux process-start epoch
Host boundary     -> one outstanding framed pipe request
Owned observer    -> read actual process, cgroup, quota, memory and CPU counters
                  -> recheck process-start and cgroup after reading
Host boundary     <- bounded matching request ID and snapshot
Intentional restart -> old binding must fail -> explicit new PID/epoch binding
```

Only intentional creation or restart needs Docker inspection. Every snapshot
still checks actual Linux process identity and resource policy, so cached
metadata cannot turn a restarted process into a successful old-epoch read.
Unknown owners, targets, request IDs, duplicate frames, missing fields,
oversized frames, unexpected stderr, EOF and timeouts fail closed. Expected
restart detection quarantines that target until an explicit refresh; other
protocol failures terminate the channel. Raw failed frames and stderr are
withheld rather than logged.

## Frozen smoke policy

| Item | Fixed value |
|---|---|
| Snapshots | 32 successful reads, 16 before and 16 after one intentional restart |
| Extra reads | Two explicit bindings and one expected old-epoch rejection, reported separately |
| Host round-trip limits | Median <= 250 ms, nearest-rank p95 <= 1,000 ms |
| Total cap | 180 seconds including startup and cleanup; reserve 60 seconds for cleanup |
| Target | Owned idle Node fixture in cached immutable 0.55.60 image |
| Resources | 0.5 CPU, 1 GiB, 100 ms CPU period, zero burst, original 384 MiB RSS ceiling |
| Observation | One persistent Docker exec channel, host PID/cgroup visibility, read-only mounts |
| Workload requests | None |

All durations and Linux read windows must be retained. A threshold failure,
partial result or cleanup failure is INVALID, not permission to repeat until
fast. The phase-one frozen manifest and raw arrays remain untouched.

## Focused validation and execution ledger

The initial protocol/privacy tests failed before implementation (`red.log`).
The intentional-refresh test separately failed before its correction
(`red-restart.log`). The combined observer/history suite then passed all
19 tests (`green-final.log`), including actual bounded subprocesses, capture-failure
cleanup and the normal workload child path. Syntax checks passed.
Seven unchanged admission selectors passed. Scoped existing-engine ESLint
reported zero errors. A third RED/privacy control proved that missing counter
fields or private extra fields could not be accepted after the snapshot
allowlist correction (`red-snapshot-privacy.log`).

Evidence is under `test-results/observer-stream-20261023/`.
The smoke outcome below comes from its actual immutable receipt, not unit tests.

### Actual observer-only result

The single smoke is **OBSERVER-SMOKE-COMPLETE**: 32/32 snapshots,
median **3.5414 ms**, nearest-rank p95 **4.9941 ms**, startup binding
7,820.2621 ms, and total elapsed including cleanup **110,587 ms**.
The expected old-process read was rejected after one intentional restart;
the same observer stream accepted the explicit new PID/start-time binding.
Both owned containers were removed and the final owner-filtered inventory
was empty. No workload requests were issued.

The frozen manifest SHA-256 is
`fc88251b0d7a9455074b41ca562c308102c843ce7e53290dee4df94b8c387831`;
its source tip is `c732737b45001567ae8e69f71bd4fbf02df700c5`.
All 32 host durations, underlying Linux read windows, both bindings, actual
resource configuration and restart metadata are in `smoke/report.json`.
Startup and the expected restart-rejection probe are separate from the
32-sample latency distribution. This fixes the observed boundary-launch
defect in this owned idle-fixture test; it is not request-latency admission.

The cached PostgreSQL capability probe also succeeded without installation:
PostgreSQL 17.11 contains `pg_stat_statements.so`, SHA-256
`d312f84eb42f20c46022c94f69842615b974ac6ac88d4bf5b43ac6d125473258`.
The disposable read-only probe container was removed. Its receipt is
`pg-capability-probe.json`.

### Statement implementation and real SQL capability check

The real SQL probe passed once in **43,688 ms including verified cleanup**,
run `faa8335989c446aea9b9b83de5804bd3`. It enabled only the already-present
extension on its own disposable PostgreSQL 17.11 fixture. PostgreSQL's builtin
SHA-256 matched the host's known value. A persistent existing `pg` client
verified exact database/application-user scope, a two-call/two-row delta,
new-entry handling, string query IDs, separately counted observer calls and
private-canary exclusion. No application workload or shared reset occurred.
Evidence: `test-results/membership-statements-20261023/pg-sql-probe.log`.

The new explicit-opt-in runner fixes A to immutable 0.55.20 and B to immutable
0.55.60. Its frozen schedule is BAAB then ABBA once, with two reused role apps per
block and new equivalent role databases. It retains 100 warmup and 1,000
measured complete four-operation cycles per round, 4,407 checked workload
requests per round, 0.5 CPU/1 GiB apps, 384 MiB RSS ceiling, 100 ms CPU period,
zero burst and the existing ancestor policy. The cap is 45 minutes with a
90-second cleanup reservation. There is no favorable retry or replacement.

```text
Existing workload child -> boundary IPC -> persistent Linux observer
                                     -> persistent native PostgreSQL client
PostgreSQL application-user statistics -> in-database whitespace normalization
                                      -> in-database SHA-256 fingerprint
                                      -> allowlisted numeric/identity receipt
Raw SQL, parameters and credentials stay out of exported receipts
```

This is a new prospective PostgreSQL configuration: preloaded
`pg_stat_statements`, `compute_query_id=on`, tracking `all`, separate identical
non-superuser application roles/database owners and a read-only statistics
observer granted `pg_read_all_stats`. It is not attributed to earlier runs.
No extension package, dependency or image was installed.

Each warmup/measured window retains both boundary snapshots, actual capture
timestamps and host read durations, CPU/process epochs, statement fingerprints,
opaque query ID strings, top-level/nested identities, calls, execution
milliseconds, rows and all available PG17 block/temp/WAL counters. Reset,
eviction, missing entry, counter decrease or epoch change invalidates the
window. A new entry starts at zero only with proven no reset/eviction.
Window mean is execution delta divided by call delta. Zero-call means are null.
Observer-user calls/execution are separate from application-user statistics.
Static table-reference labels and unresolved/mixed buckets are descriptive,
not proof of code ownership or commit causation.

The original checked workload is unchanged. The legacy receipt version is
explicitly 0.55.20 only in this runner; the helper default remains 0.55.60.
Current-only 66-outcome contract assertions run only against B after each block.
Private header-log checks run after the windows; raw logs/payloads are not
persisted. No current-only error-correlation requirement is imposed on A.

Focused validation now passes **27 tests**, including real child framing,
duplicate replies, normal-default non-dispatch, an exact admission-rejection
reason, legacy receipt selection and SQL privacy/reset/mix guards. Seven
unchanged admission selectors and scoped existing-engine ESLint also pass.
The real SQL probe is one additional integration test, not an eight-round run.
Frozen runtime source bytes, resolved platform IDs, application distribution
hashes, 33 loaded PostgreSQL-client module hashes and the final manifest
identify the execution. Git's CRLF normalization does not redefine those
on-disk hashes.

## Actual phase-two attempt: INVALID, four rounds retained

The source was committed before execution as
`f6731ffb1f94f92e1c6b3d4c364b204d2fb179ce`. The single attempt was
`c00c5c2d419a4ce4870446aa670853ac`, starting at 19:20:07.645 UTC and
finishing, including cleanup, after **532,487 ms (8.875 minutes)**.
Its manifest was frozen at 19:22:22.838 UTC, before the workload, with SHA-256
`ef712837359d4149d6e85d6cb89c9c1c071880ed66d48f4f9b7816e529041d0a`.
The host client was Node v24.13.0 with existing `pg` 8.22.0; PostgreSQL was
17.11 with statement extension 1.11. Actual settings are in the manifest.

Four BAAB visits completed all original assertions: **17,628 checked requests,
16,000 measured timings and 1,600 warmup timings**. Eight CPU/statement windows
and all 16 corresponding boundary snapshots are retained. The current-only
runtime contract completed 66 outcomes. Neither role's post-block privacy
receipt completed: A was checked first and failed its exact authorization-mask
assertion. The subsequent B privacy check and the entire ABBA block did not
run. This is not a completed comparison or release acceptance.

### Failure and exact boundary of knowledge

The first causal frame is frozen runner line 339, in the legacy loop requiring
`JSON.parse(row.requestHeaders).authorization === '[REDACTED]'`.
The 200-row count and generated-secret absence checks preceding that assertion
completed. The retained error is `ERR_ASSERTION` at stage `contract-baab`;
the privacy-safe handler withheld actual header values, but also failed to
retain whether the field was missing or had a different non-secret value.

Two unstarted, explicitly owned source-only containers were used afterward to
read the exact cached baseline's compiled logging/redaction code, then removed.
That source uses the **same** `[REDACTED]` sentinel and captures request headers.
It does not justify blaming an alternative legacy sentinel or relaxing the
assertion. The exact differing private value and underlying application cause
cannot be reconstructed after required cleanup. They remain **unresolved**.
No raw headers, SQL text, parameters, payloads or credentials were saved to
answer that question retrospectively.

A subsequent test-first source correction preserves the strict requirement
and emits only safe categories for absent authorization, mask mismatch,
unparseable headers or a generated-credential detection. All **28 focused
tests** pass, including negative private-value canaries. This correction is
**tested but unmeasured**: it did not produce, rewrite or validate the four
frozen receipts, and no experiment was repeated.

### Descriptive measured-window observations, not accepted evidence

Each row below covers 1,000 complete four-operation cycles. CPU is application
cgroup CPU-use delta per cycle, not PostgreSQL execution time. Statement
execution sums include nested statements and are not non-overlapping database
wall time.

| Visit / release | Statement calls | Statement execution sum (ms) | Rows | App CPU ms/cycle | Add p99 (ms) | Remove p99 (ms) |
|---|---:|---:|---:|---:|---:|---:|
| B1 / 0.55.60 | 25,243 | 1,357.025 | 23,003 | 25.888 | 95.422 | 97.051 |
| A2 / 0.55.20 | 26,243 | 858.202 | 20,003 | 28.241 | 98.945 | 89.271 |
| A3 / 0.55.20 | 26,240 | 885.784 | 20,000 | 24.939 | 84.214 | 89.657 |
| B4 / 0.55.60 | 25,243 | 1,180.598 | 23,003 | 22.650 | 84.631 | 99.763 |

Warmup CPU-use per cycle was respectively 36.688, 49.478, 29.277 and
29.266 ms; its statement execution sums were 134.133, 101.844, 91.491 and
120.821 ms. These are separate windows, not subtracted across process epochs.
All operation p50/p95/p99 values remain in each round summary; no tails were
dropped.

Across the two retained visits per role, B recorded **3.805% fewer calls**
(50,486 versus 52,483), **45.507% greater summed statement execution**
(2,537.623 versus 1,743.986 ms), and 46,006 versus 40,003 rows.
Top-level execution sums were 2,509.290 versus 1,709.100 ms; nested sums were
28.333 versus 34.887 ms, with 4,000 nested calls in each role.
These totals describe the retained BAAB block only.

The following table combines the two measured visits within each role.
Fingerprint prefixes identify full hashes in the exported tables. Distinct
fingerprints are not assumed to be equivalent SQL, even when labels match.

| Role | Fingerprint prefix | Proven static reference / operation | Calls | Execution sum (ms) | Rows |
|---|---|---|---:|---:|---:|
| A | `1287f7333f07` | RequestLog / insert | 160 | 635.263 | 8,000 |
| B | `871c0a0b86c9` | RequestLog / insert | 160 | 1,056.233 | 8,000 |
| A | `893e9aa443db` | ScimResource / select | 12,000 | 331.591 | 12,000 |
| A | `01629902672b` | ResourceMember / insert | 2,000 | 253.382 | 2,000 |
| B | `66ef960f4507` | ResourceMember / unresolved operation | 2,000 | 291.197 | 2,000 |
| B | `dd988e886af7` | Mixed ResourceMember/ScimResource references / select | 8,000 | 462.567 | 8,000 |
| B | `848a6f179312` | Mixed ResourceMember/ScimResource references / select | 4,000 | 227.067 | 4,000 |
| A | `666edf15fe19` | ScimResource / update | 4,000 | 178.931 | 4,000 |
| B | `8d070fa04d58` | ScimResource / update | 4,000 | 174.588 | 4,000 |

The RequestLog insert families alone account for **53.04% of the aggregate
execution-sum difference**, despite equal 160 calls and 8,000 rows. Their
window-derived execution means are 3.970 versus 6.601 ms per call. B's family
recorded 239,490 versus 192,527 shared-buffer hits and 43,233,469 versus
26,248,514 WAL bytes; both recorded zero shared-block reads in these windows.
This points descriptively toward logging insert shape/work and changed query
mix as useful concerns, not a proven code change, payload-size cause, CPU
cause or disk/network-latency cause. WAL is write-ahead-log volume, not a
duration. The fingerprints differ, and raw SQL was intentionally unavailable.

The resource-label mapping is limited to the named repository concerns:
`RequestLog` is persisted request logging, `ResourceMember` is membership
storage, `ScimResource` is resource storage, and mixed/unresolved entries remain
unresolved. No commit or per-request attribution is claimed.

### Observer cost, accounting and limitations

The 16 actual combined CPU-plus-PG boundary reads cost **18.293-35.105 ms**,
median **24.067 ms**, nearest-rank p95 **35.105 ms**. PG host reads cost
14.488-25.327 ms; underlying Linux reads cost 0.663-2.888 ms. Each measured
window separately recorded one observer-user call, with execution-counter
deltas 14.844, 10.069, 9.178 and 10.397 ms. These queries are excluded from
application-user statement statistics. Initialization, readiness, bindings,
canary checks, contracts and private-log reads are separate from the 4,407
workload requests per round.

The two app processes retained their original epochs throughout the BAAB
block. Required counter, reset, eviction, resource and epoch guards passed
for the retained windows. Maximum observed Node high-water RSS was
223.023 MiB, and cgroup memory peak was 289.113 MiB; OOM counters remained zero.
All four owned containers (two apps, PostgreSQL and observer) and the owned
network were verified removed; the stream closed with code zero and final
owner inventory was empty.

This remains a shared Windows/WSL scheduling environment with three unrelated
containers left untouched. Boundary collection still perturbs execution and
quota phase. Buffered logging, background work, database/OS cache history and
unobserved host interference remain. Only one BAAB block exists, not the
planned ABBA contrast; repeated visits to two processes are not independent
replicates. PostgreSQL execution counters are not CPU time or network round
trip, and statement means are not request p99. This compares 0.55.20 with
0.55.60, not the old 0.55.58 incident.

### Reproducible evidence

Everything below is under
`test-results/membership-statements-20261023/`, separate from phase one:

| Evidence | Actual result |
|---|---|
| `phase2/manifest.json`, `preregistered-plan.json`, `frozen-inputs/` | Executed source/configuration identity, immutable raw inputs |
| `phase2/report.json`, `phase2.log` | INVALID, four complete visits, first causal frame and verified cleanup |
| `phase2/baab-*.json`, `*-windows.json`, `*-summary.json` | Original timing arrays, cycle/operation links, all boundary/window records |
| `phase2/baab-current-contract.json` | 66 current contract outcomes complete |
| `phase2/per-round-fingerprints.csv` | 1,090 per-round/per-phase fingerprint rows, including zero-call entries and all block/temp/WAL counters |
| `phase2/analysis.json` | Numeric-only descriptive summaries, full fingerprint/query-ID identity sets and observation costs |
| `phase2/source-byte-proof.json` | All nine frozen hashes match; zero match raw Git bytes, all nine match after CRLF-to-LF normalization |
| `legacy-image-source/` | Exact immutable baseline compiled redaction/logging code and source-only container provenance |
| `red-privacy-cause.log`, `green-postrun-privacy.log` | Post-run safe-cause correction RED/GREEN, 28 focused tests |
| `red-privacy-missingness.log`, `green-privacy-final.log`, `postrun-static-final.json` | Required private sample/canary checks RED/GREEN, nine statement tests rerun, eight syntax/lint files clean |

Primary executed input SHA-256 values:

| Input | Frozen on-disk SHA-256 |
|---|---|
| `run-membership-statements.cjs` | `0e829068762684bf9db4d70344a6c5e730c730e3fb1b2247594f668d60b94237` |
| `membership-statements.cjs` | `4beb5738dcfc9529611933726cd710f437f8f2944527bff3a5a3b1fe07db277d` |
| `membership-statement-fixture.cjs` | `a9a8661d1396c83868bcf71c6c3287ba1fbf1a4fc20fa044764cb2f2b9f2daa9` |

The manifest contains all nine runtime input hashes, the Node executable hash,
33 loaded-client module hashes, app distribution/Prisma hashes, PostgreSQL
library hash and actual platform image IDs. These are the executed identities;
the post-run tested correction is not substituted for them.

### Commands and actual validation results

All commands ran from the exclusive worktree. These are historical execution
records, not authorization to repeat either timed run.

```powershell
node --test `
  scripts\test\membership-observer.test.cjs `
  scripts\test\membership-history.test.cjs `
  scripts\test\membership-statements.test.cjs
```

Result: 27 passed before execution; 28 passed after the additional safe-cause
RED/GREEN correction. The separate RED logs retain the missing implementation,
legacy receipt-version rejection, nesting omission and exact admission-fixture
failure rather than treating an arbitrary exception as the intended guard.

```powershell
$env:SCIM_RUN_OWNED_PG_PROBE = '1'
node --test scripts\test\membership-statements-pg.test.cjs
```

Result: one actual SQL integration test passed once, including cleanup,
43.688 seconds. The environment variable was scoped to that command process.

```powershell
node --test `
  --test-name-pattern='identical samples|tail-only regression|A/A requires|nearest-rank|incomplete, reordered|unknown order|preregistered protocol' `
  scripts\test\membership-performance.test.cjs

node test-results\membership-statements-20261023\validate-source.cjs
pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling
git diff --check
```

Results: seven unchanged admission selectors passed; eight CommonJS syntax
checks and eight scoped existing-engine ESLint checks passed with zero errors;
27 documentation freshness checks passed; no whitespace errors. Editor
diagnostics reported no errors in the changed diagnostic source. No dependency
installation, product-version change or full-suite repetition was needed.

```powershell
node scripts\performance\run-membership-statements.cjs `
  --diagnostic-only `
  test-results\membership-statements-20261023\phase2
```

Result: exit 1, INVALID after four complete visits, with exact cleanup as
reported above. The existing output directory and frozen files were preserved.

## Issues, root causes and improvement dispositions

| ID | Type / severity | Observed issue and mechanism | Correction and detection |
|---|---|---|---|
| OS-01 | Measurement architecture / High | Two serial Docker CLI launches dominated boundary cost by seconds. The earlier collector preserved read cost but had no executable low-disturbance gate. | Persistent owned stream plus the single passing real-fixture smoke above. Earliest possible detection: observer-only smoke before workload execution; detection escaped to the phase-one workload report. |
| OS-02 | Lifecycle / Medium | Initial strict protocol treated an intentional process change as an unrecoverable framing failure, preventing an explicit refresh on the same stream. | A narrowly typed epoch-change response quarantines only that binding. Actual-child RED/GREEN proves detection and refresh without silently accepting the old epoch. |
| OS-03 | Diagnostic contract / High | An epoch-only reply check initially accepted missing counters or arbitrary private extra fields from a faulty collector. | RED privacy canaries preceded an exact snapshot-key allowlist and full counter/policy validation on both stream ends. Unknown fields never become persisted receipts. Detection: focused child privacy test; earliest: the same test before encoder implementation. |
| OS-04 | Compatibility / Medium | The history helper intentionally fixed receipt version to 0.55.60, so an explicit 0.55.20 comparison was rejected before useful diagnosis. | Retained legacy-receipt RED followed by an explicit expected-version argument, preserving the existing default. Focused GREEN confirms both selections. Detected at the earliest unit-test stage, before the workload. |
| OS-05 | Test correctness / Medium | A generic admission `throws` check initially succeeded on the wrong role-order assertion, not diagnostic exclusion. | The test now uses actual admission role labels and requires the exact diagnostic-rejection message. Tightened check caught the faulty fixture before execution; focused GREEN confirms the intended guard. |
| OS-06 | Summary correctness / Medium | Grouping by fingerprint alone did not expose mixed top-level/nested identities when their query ID was unchanged. | A specific undefined-versus-expected-array RED preceded explicit retained top-level sets and mix flags. Detected at the earliest unit-test stage, before workload execution. |
| OS-07 | Runtime privacy contract / High, unresolved | Exact authorization-mask validation failed in the legacy private log sample after four completed rounds. Baseline compiled source uses the same expected sentinel; the actual differing value was not retained. | The attempt remains INVALID. No mask allowance, missing-as-success rule, replacement or retry was introduced. Detected by post-block privacy; a correctly scoped earlier app-log contract check could have detected it sooner, but would itself need a separately frozen history policy. |
| OS-08 | Failure evidence / Medium | The catch handler grouped `ERR_ASSERTION` with PG/child errors and suppressed the distinction between missing authorization and a wrong mask. | A dedicated private-value-free classifier retains only static reasons, row index and presence. Actual negative canaries passed RED/GREEN. An additional missing-exception RED closed empty-canary/missing-console acceptance in the proposed helper; all nine statement tests then passed. This is tested but unmeasured and does not reconstruct OS-07's missing private detail. Earliest detection: failure-path unit tests before the workload; actual detection: reviewing the stopped attempt. |

**Self-improvement: applied.** Disturbance is now a separately measured gate,
and privacy canaries exercise real child streams before any new diagnostic.
Negative admission tests require the intended rejection reason, and real
PostgreSQL verifies SQL capability/delta/privacy assumptions before workload.
Safe privacy-failure categories are now regression-tested without exporting
the values they reject. The original failing legacy requirement is preserved.

**Design disposition: accepted.** One concrete channel serves the history
runner and the real smoke. Both reuse the existing collector and epoch/policy
guards. There is no new benchmark framework, dependency or application code.
The statement runner is a bounded orchestration file; SQL/privacy/delta math
and disposable database setup live in separate cohesive helpers. Further
strategy abstractions would have only one implementation and are declined.

**Provenance/completeness:** This ledger was reconciled against available tool
outputs, the retained RED/GREEN logs, both owned probe receipts, the single
workload attempt and its finalization records. The complete subagent JSONL
transcript was not exposed; full-transcript completeness is not claimed.
Read-only source inspection disproved an alternate-redaction-sentinel
explanation. It did not establish the actual missing/wrong header value.

## Unchanged holds

The original negative 0.55.58 admission evidence, phase-one evidence, customer
data, migration, capacity, operational, cleanup-403 and visual holds remain.
Even a successful smoke or statement diagnostic is not release PASS and cannot
retroactively prove the cause of the 0.55.58 incident.
