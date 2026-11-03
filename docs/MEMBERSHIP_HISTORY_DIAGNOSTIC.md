# Local application-history diagnostic

**Last verified:** 2026-10-29
**Scope:** Unreleased local tooling, never release admission.

## Current-master source integration (2026-10-29)

PR #251 preserves exact remote head `e5e107f5` through an ordinary merge of
master `72786086`. Five overlapping documentation files retain both histories;
runtime, Prisma schema, UI source and the incoming logging fixtures match
master. Performance source, frozen protocol and prior review fixes match the
preserved head. Candidate 0.55.65 is reserved independently of drafts #259,
#260 and #261, whose unmerged sources are not included.

Preflight verifies these tree boundaries, both manifest graphs and unchanged
dependency graphs. Restoring the privately owned API/web dependency trees
from master's locks succeeds without changing either lock hash. The incoming
logging fixture and dependency-pin unit tests pass 3 suites / 111 tests.
Focused tooling and archive-descriptor contracts pass 14 with one explicit
external-evidence skip. Full API `npm ls --all --json` still exits 1 with
three invalid override-context packages; that independent baseline is not
waived or fixed by this consolidation.

Source merge `ffc25528` passes 30/30 normal protected Validate gates in
1,126.6 seconds: API 6,220 tests / 213 suites; HTTP 2,514 / 118 with 42 tests
and two existing suites skipped; web 1,655 / 124; membership 226 pass / two
explicit skips. Clean-CI lock run `40936685877` authenticates exact source
`ffc2552832e3f80b1bbdcc14cb6baad2db630660` and artifact `12925301374`.
Its SHA-256 digest is
`55c3e768993862fa1a3b34b4af9b4684d9869bc2c503ab666ed13125fb7c8c06`.
Only four root version fields change .61 -> .65. Package graph, public
registry and SHA-512 provenance remain identical; the seven-day report
contains zero changed package versions.

Final lock-tip protected publication and exact-tip CI/review evidence remain
separate under `test-results/performance-master-integration-20261029/`.
Nine bounded actual review threads are resolved at intake; historical reviews
are not integration-tip approval. The PR remains draft. No benchmark or live
service is started.

Frozen run `39875689201` remains FAILED, with populated-read p99 ratio
`1.23928982 > 1.10`. Cleanup HTTP 403 remains a cleanup failure, not CLEANED.
There is no customer-data restoration, browser/operator visual receipt,
performance qualification or release admission implied by this integration.

Self-improvement is applied through independent history/source/graph
preservation checks. Design/architecture disposition is accepted: no runtime
orchestrator grows, and adding a strategy abstraction would be speculative.

## Current consolidation and release checkpoint (2026-10-28)

The final protected push at `8321dab6` passed 30/30 Validate gates in
1,594.7 seconds. Exact-tip
[Build Test Image 40061707692](https://github.com/pranems/SCIMServer/actions/runs/40061707692)
and [CodeQL 40061707691](https://github.com/pranems/SCIMServer/actions/runs/40061707691)
passed. Local membership reports 224 passed / two explicit skips out of 226;
CI reports 218 passed / eight explicit skips. API unit reports 6,214 passed,
API E2E 2,514 passed with 42 existing skips, and web all 124 files / 1,655
passed. API lint retains 512 warnings and web TypeScript 66 errors within
its 96-error ratchet. These later receipts supersede pending-push wording
in the historical correction entries below.

On 28 October, the preserved diagnostic branch contains both current master
`5bfff2de` and PR #251's remote `f6f03a52` as ancestors. Its API/web trees
match master. All original commits are preserved.
PR #251 was converted to draft before synchronization. The source correction
now skips the three expensive jobs only on draft PR events; non-draft
events, explicit dispatch and the added `ready_for_review` event retain
campaign execution. Both ordinary correctness jobs remain unconditional
and select the complete membership contracts. The normal protected push to
PR #251 advanced its head to `6716b3bb` after 30/30 gates passed in 1,228.6
seconds. It is now conflict-free, still draft. Both image workflows passed
ordinary validation and failed Trivy on the two known HIGH findings.
CodeQL, docs freshness and RFC currency workflows passed. All three campaign
jobs were skipped with null runner identities and zero steps. A draft skip
is not admission. CodeQL also surfaced the archive-race review addressed
in CR-11 below; its correction still needs publication and exact-tip checks.

The recovered Docker engine is responsive through the user's isolated
configuration. A fresh exact-digest scan now confirms two HIGH findings in
published 0.55.60, not a diagnostic performance result. See the
[supply-chain checkpoint](strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md#2026-10-28-exact-release-image-scan-and-approved-feed-hold)
and [issue #256](https://github.com/pranems/SCIMServer/issues/256).
No index removal, new workload, threshold change, baseline adoption, merge
or deployment follows from this checkpoint.

### CR-09: draft synchronization must not repeat frozen campaigns

The workflow audit found that all three old campaigns allocate on a relevant
PR synchronization, even when the intent is only preserving reviewed source
and evidence. This was detected before any new campaign, rather than by
canceling one after allocation. A missing-boundary test failed first.
The three job conditions now evaluate false for draft PRs, true for non-draft
PRs and true for explicit dispatch. The ready-for-review event is explicit.
The test also protects ordinary CI from acquiring a draft skip.

The affected qualification, timeline, native-profile and wiring aggregate
passed 116/116 with no skips; all three workflow YAML files parsed.
Evidence: `test-results/release-resume-20261028/draft-campaign-boundary-red.log`
and `draft-campaign-boundary-green.log`. No application, workload, quota,
sample, timeout, threshold or historical failed receipt changed.

Detection-stage disposition: applied at the pre-publication trigger audit,
the earliest useful stage. Test/gate improvement: applied through the
source-bound job-condition matrix and ordinary-CI counter-check.
Design disposition: accepted. A native draft lifecycle boundary is sufficient;
another scheduler, label policy or general execution framework would add
unnecessary responsibility. PR readiness remains a deliberate transition,
not a way to call skipped performance evidence green.

### CR-10: calendar expiry blocks otherwise unchanged publication

The first protected PR reconciliation push passed 24 gates, then correctly
stopped at RFC currency after 505.9 seconds. The manifest's verification date
was 30 July, 91 days before the current check, exceeding the unchanged 90-day
limit. API unit/E2E, Prisma generation and web tests did not run afterwards.
This is expiring external-source evidence, not a workflow-condition failure.

The sanctioned `scripts/sync-rfcs.ps1 -Update` fetched RFC Editor source data
and verified all 19 mirrors. C1-C5 and online O1-O3 passed; no RFC text bytes,
status or update/obsolete graph changed. Errata metadata changed for RFCs
7643, 9865, 6750, 7519 and 8414, with no new Verified counts. The SCIM README
table now reflects the updated held/reported counts. The manifest was
generated, not hand-restamped; the same offline gate then passed.

Retained evidence: `protected-pr-reconciliation-push.log`,
`rfc-corpus-update.log` and `rfc-corpus-offline-green.log` under
`test-results/release-resume-20261028/`. The failed push published no head.
Another complete normal hook remains required; no gate or expiry was waived.

Detection-stage disposition: applied through real upstream refresh; an
offline expiry check at consolidation entry could have caught this before
the hook's earlier static gates. Self-improvement: check calendar-bound
evidence before long consolidation, rather than assuming an unchanged
source tree preserves its validity. The subsequent protected push passed
all 30 gates. Design disposition: accepted; the existing corpus updater and
90-day gate are sufficient.

### CR-11: captured evidence must not be reopened through a replaceable name

The 28 October CodeQL review
[comment](https://github.com/pranems/SCIMServer/pull/251#discussion_r4407248843)
flagged the derived-reference archive reader. The tool exclusively created
the output, sent Docker's capture to its descriptor, closed it, then read
the pathname. A different file could occupy that name before verification.
This is a High scanner finding in local diagnostic tooling, not evidence
of an observed exploit or an application request-path defect.

The correction retains a single exclusively created read/write descriptor
until capture, container-state verification and archive reading finish.
The reader uses positional reads starting at zero because the capture child
leaves the shared file offset at EOF. Short reads are accumulated, premature
EOF fails explicitly, and the descriptor closes in `finally`. No pathname
is reopened for archive verification. The existing tar, byte-distribution,
ownership, time-budget and non-admission checks remain unchanged.

The new regression was RED before implementation. Its GREEN result proves
that replacing the pathname changes the old pathname-based result but not
the owned-descriptor bytes; it also exercises the EOF offset, short reads
and premature EOF rejection. Three privacy files report 20 passed, zero
failed and one explicit retained-source skip out of 21. Evidence is retained
in `archive-descriptor-red.log` and `archive-descriptor-green.log` under
`test-results/release-resume-20261028/`. No Docker build or campaign ran.

Detection-stage escape: hosted CodeQL review caught what the existing byte
and archive-format tests did not cover; the earliest suitable gate was a
local pathname-replacement regression. Test/gate improvement: applied through
that regression and caller wiring checks. Design disposition: accepted.
One small positional-reader helper supports the existing capture lifecycle;
another filesystem abstraction or scheduler is not justified. A successful
CodeQL workflow alone is not proof of no findings. Publication and hosted
alert confirmation are still required; no alert is manually dismissed.

## Consolidation corrections (2026-10-24, source-only)

Independent review found two reliability defects. Both are corrected and
regression-tested below. No workload was repeated, no historical receipt was
replaced, and no release admission or deployment follows from these checks.

| Issue | Type / severity | Symptom and root cause | Correction and why it works | Detection and prevention |
|---|---|---|---|---|
| CR-01 | Lifecycle / Medium | The history runner gave work and finalization the same deadline. At expiry, even discovery and removal could not dispatch; the child could additionally outlive that deadline by 70 seconds. | Keep the existing 60-minute outer cap, reserve its final 90 seconds for cleanup, and clamp Docker work, the benchmark child, contract execution and log-flush HTTP to the earlier work deadline. Finalization retains the outer deadline. | Fresh review caught what the existing helper and presence-only caller tests missed. New tests execute the actual history wrapper with expired work and available cleanup, verify zero work dispatches and successful capture/removal/verification, and measure the actual configured child lifetime. Earliest useful gate: unit regression. Applied. |
| CR-02 | Test portability / Medium | Two tests read ignored historical proofs or a frozen runner unconditionally. A fresh source checkout failed with `ENOENT`. The closure test also assumed its ignored parent directory already existed. | The positive retained-proof test explicitly skips only when its complete four-file proof set is unavailable. Portable synthetic negative tests still require runtime proof validation to fail closed. A committed work-wrapper fixture reproduces the native output-limit failure; an optional comparison checks it against retained historical source. Temporary closure directories are created independently. | Fresh review found the missing-artifact dependency; a fresh-source reproduction additionally caught the absent parent directory. Earliest useful gate: tests with installed dependencies but without ignored experiment artifacts. Applied. |
| CR-03 | Test automation / Medium | Ordinary application CI and pre-push did not select the newly added membership tooling tests, so their green result could not prove those tools were tested. | Add the complete serial membership test selector to default pre-push and both ordinary branch/release CI validation jobs. Installed API dependencies precede the CI test step. | Independent automation inspection found the gap. Two new wiring regressions failed before the change and passed afterwards; commented-out CI commands cannot satisfy the selector check. Earliest useful gate: test-completeness audit before protected push. Applied; remote execution remains pending. |
| CR-04 | Environment / Low | The first protected Validate push passed 26 gates, then Prisma generation rejected an unset `DATABASE_URL` after 852.1 seconds. This was a missing local code-generation input, not a database failure. | Add an early Validate/Full configuration gate, preserve Fast-mode behavior, and supply an explicit non-connecting local URL only in the retry process. No default credential, live database or runtime fallback is introduced. | The real protected hook caught it at its late generation gate. A new regression now checks the actual early PowerShell block for missing, blank and supplied configuration, plus Fast-mode compatibility. Earliest useful gate: configuration preflight before heavy suites. Applied. |
| CR-05 | Validation capacity / Medium | The configured retry passed 29 gates but Vitest lost 15 worker processes. Only 109/124 files completed, despite 1,301 reported passing assertions. The log retained generic unexpected exits, not a proven native cause. | Run the same complete web selector with two workers. All 124 files / 1,655 tests passed with no pending tests. Apply that explicit worker bound to pre-push and both CI jobs, without changing assertions, skips, timeouts or admission thresholds. | The ordinary web gate correctly rejected incomplete execution. A new wiring regression protects the complete selector and worker limit. The original process exits are not retrospectively attributed to memory exhaustion or another unmeasured cause. Applied; the complete protected retry is still required. |
| CR-06 | Editing scope / Low | A repeated `npm test` command was initially changed in the neighboring API gate instead of the web gate. | Anchor the correction to the named gate blocks and add a negative regression requiring the API command to stay unchanged. | The new web wiring test caught the wrong target before any altered API command ran. Earliest useful gate: focused command-scope regression. Applied. |
| CR-07 | CI input availability / Medium | Exact-tip branch CI failed four tests because checkout retained only the tip commit. Historical `git show` and the pinned ancestor check could not resolve their required commits. The two bounded GIN children consequently stopped before their intended fake-image/SQL failures. | Fetch complete history in both ordinary validation checkouts and protect that setting with a fifth wiring regression. Keep all four tests and their fail-closed source checks unchanged. | CI caught this; an independent depth-one checkout reproduced the same four failures. Fetching history alone made all 38 relevant tests complete with 34 passed / four evidence-dependent skips and zero failures. Earliest useful gate: a real isolated checkout with CI-equivalent history. Applied. |
| CR-08 | Test deadline fidelity / Medium | The next protected hook stopped because a positive cleanup fixture reported capture failure. Its child had an independent 700 ms cap despite 1,800 ms remaining for cleanup. | Keep the original 1,800 ms absolute deadline and 4,000 ms test bound, but let the positive child use the remaining cleanup budget. Make the successful fixture wait 800 ms so the old cap fails deterministically; include safe lifecycle details in failed assertions. No production deadline changes. | The hook caught the original failure. A controlled 800 ms child reproduced termination under the old cap; the corrected lifecycle and wiring files passed 16/16. Earliest useful gate: this focused positive native-child regression. Applied. |

### Evidence and limits

- `test-results/diagnostic-review-fixes-20261024/deadline-red.log`
  records the missing expected work-deadline rejection and missing cleanup
  reservation before the correction.
- `fresh-red.log` records the three missing-file/directory failures.
- `affected-green.log`: all 31 affected tests passed with retained local
  proofs, zero failures and zero skips.
- `gate-wiring-red.log` and `gate-wiring-green.log`: both new automatic
  selector checks changed from failing to passing. Both changed workflow
  files parsed, the pre-push script parsed, five changed CJS files passed
  syntax checks, and the content-only freshness audit passed all 27 docs.
  These checks are not a substitute for the normal protected hook or CI.
- `protected-push.log`: the first normal hook blocked publication at Prisma
  generation. Its completed membership gate passed 221/223 tests with two
  explicit skips; API build/lint, web type-check/build, Mermaid rendering,
  documentation/security-policy contracts, API unit and in-memory E2E
  gates passed. E2E retained 118 passing suites / 2,514 passing tests and
  its existing 42 skipped tests.
- `codegen-preflight-red.log` and `codegen-preflight-green.log`: the new
  early configuration regression failed before the guard, then all three
  gate-wiring tests passed. `prisma-generate-configured.log` confirms that
  `npx --no-install prisma generate` succeeded with
  `DATABASE_URL=postgresql://127.0.0.1:1/prepush_codegen`. That process used
  the existing installed Prisma 7.8.0, without installing packages.
  The next tracking push must still execute the complete normal hook.
- `protected-push-retry.log`: 29 gates passed, including real generation
  and migration linting. Membership tests passed 222/224 with two explicit
  skips. The web gate failed with 15 worker errors and incomplete file
  accounting; that result remains a failed hook, not a release PASS.
- `web-two-workers.json`: a separate complete ordinary web invocation
  using `npm test -- --maxWorkers=2` plus JSON reporting completed all 124
  distinct files and 1,655 tests in 616.860 seconds. Every file status is
  `passed`; failed and pending test counts are zero. This changes validation
  concurrency, not application behavior or performance admission.
- `web-capacity-red.log`, `web-capacity-green.log` and
  `web-capacity-final-green.log` retain the missing-capacity control, the
  caught wrong-gate edit and all four final wiring checks passing.
- `protected-push-bounded-web.log`: the complete third Validate hook
  passed all 30 gates in 1,379.8 seconds and pushed `ff9091c0`.
  Membership passed 223/225 with two explicit skips; API unit passed
  213 suites / 6,214 tests; API E2E passed 118 suites / 2,514 tests with
  existing skips; web passed all 124 files / 1,655 tests. API lint retained
  zero errors / 512 warnings; web TypeScript retained 66 errors within
  the configured 96-error ratchet. Neither is a zero-warning/type-error claim.
- Exact-tip Build Test Image run `40058896931` then failed the membership
  step with 213 passed / four failed / eight explicit skips out of 225.
  Downstream validation and image publication did not run. CodeQL run
  `40058897048` passed on that same `ff9091c0` tip; it does not override
  the failed build.
- `ci-shallow-red.log`: a separate depth-one clone reproduced exactly
  those four test failures, with no Docker dispatch. `ci-history-green.log`
  records 34 passed / zero failed / four explicit skips out of the same
  38 tests after fetching complete history, without changing their files.
  `ci-history-wiring-red.log` and `ci-history-wiring-green.log` retain the
  missing checkout-depth control and all five final wiring tests passing.

The earlier source-archive portability check was nested beneath the owned
repository and could discover its full Git metadata. It established the
absence-of-ignored-evidence claim, not shallow-checkout compatibility.
The isolated clone's own `.git` directory makes that additional condition
explicit. Runtime ancestry checks are not relaxed and missing history is
not converted into a test skip.

The first protected push of the history correction (`8b8129ac`) was blocked
after 140.3 seconds: membership had 223 passed / one failed / two explicit
skips out of 226, and later gates did not run. The original capture assertion
did not retain its child error, so its exact native cause is unverified.
`cleanup-budget-red.log` separately proves that an otherwise successful
800 ms child is terminated by the fixture's 700 ms cap before its unchanged
1,800 ms absolute cleanup deadline. `cleanup-budget-green.log` records
16/16 lifecycle and wiring tests passing after the correction. This repairs
the test's budget model, not a production performance threshold or a waiver.

Design/architecture disposition: accepted. These corrections configure
required CI inputs and align one cohesive fixture with its existing deadline;
they add no production responsibility or dependency edge. Another abstraction
would not improve this bounded correction. Test/gate improvement: applied
through the checkout wiring control and deterministic slow-success fixture.
- `fresh-installed-green-all.log`: all 15 membership test files completed
  in 105.376 seconds, with 213 passed, zero failed and eight explicit
  skips out of 221 registered tests. Seven skips require local evidence
  or extracted source; one requires the separately opt-in PostgreSQL probe.
  No experiment evidence was copied into this source snapshot.
- The first full snapshot check omitted the API dependency directory and
  failed module loading. The corrected check reused the existing installed
  dependencies through a temporary junction, removed afterwards. Nothing
  was installed or changed in the dependency manifests.

These are source and test-portability claims, not a repeat of the original
53.966-minute experiment. Runtime proof hashes remain mandatory; missing or
modified evidence still cannot qualify a reference.

**Self-improvement: applied.** Exercise each real caller's deadline selection,
not just the shared helper or the presence of a helper call. Test a source
checkout without ignored evidence as a separate portability condition.
**Design disposition: accepted.** Reuse the existing deadline and finalizer
helpers; no new application dependency, lifecycle framework or speculative
abstraction is introduced.

**Provenance limit:** This correction was reconciled against the independent
review, current execution output and retained RED/GREEN logs. It is not a
claim of reconciliation against the deleted original conversation or an
unavailable full-session transcript.

## Executive summary

**Actual local outcome: DIAGNOSTIC-COMPLETE, not release PASS.** All 16 rounds
finished in 53.966 minutes including verified cleanup. They retain 64,000
measured samples, 6,400 warmup spans and 70,512 checked workload requests.
All four 66-outcome contracts and four 200-row private-log checks completed.

The opt-in history harness implements the smaller diagnostic-first proposal.
It preserves the old qualification protocol, evaluator, lifecycle runner and
raw evidence. Its one authorized local experiment is recorded under
`test-results/membership-history-20261023/`. A completed diagnostic would still
not admit 0.55.60, replace the failed 0.55.58 control, or authorize deployment.
The final local outcome and exact immutable input hash belong in that run's
`phase1/report.json`, not in an admission receipt.

The source branch starts from ordinary consolidation merge
`d25b6155bace7af2ec4ccb89f2eb0048e2db0c26`. Publication and all remote operations
remain on hold, including changes to PR #251 or its workflow triggers.

### Unchanged admission and operational holds

| Existing evidence or gate | Unchanged interpretation |
|---|---|
| Admission run `39875689201` | FAILED same-image p99 control: 40.650743 versus 50.378052 ms, ratio 1.23928982 above 1.10 |
| Frozen 0.55.58 candidate | `f57b765aab497d2cf2861a3d8a3b6906df8abe075320a454c0ad7e193fbecb82` |
| Frozen baseline | `8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a` |
| Earlier native/timeline evidence | Diagnostic only; cannot retroactively clear the failed run |
| PR #251 | Unmerged, remote qualification head `f6f03a52`; no mutation or synchronization push |
| Operational evidence | Customer data, migration, capacity, operational readiness, cleanup-403 and operator visual holds remain open |

## Implemented request and observation flow

```text
Explicit --diagnostic-only invocation
  -> exact local image and source identity preflight
  -> owned PostgreSQL and read-only observer
  -> immutable manifest before any workload
  -> seeded fresh/reused blocks, two role application slots
       -> restart scheduled role only in fresh mode
       -> real benchmark child, original new-resource fixture
       -> warmup-before / warmup-after boundary observations
       -> measured-before / measured-after boundary observations
       -> all original per-operation assertions and exact fixture cleanup
  -> original 66-outcome runtime contract and private log checks
  -> stop on first failure, never replace a block
  -> attempt capture and deletion for every owned resource
  -> verify exact labeled resource absence, retain complete or partial evidence
```

The diagram separates observations from workload requests. Boundary snapshots
pause the child through an interprocess communication (IPC) handshake. They
can change CPU quota phase, so this flow is deliberately ineligible for normal
admission. The benchmark refuses history instrumentation without the explicit
IPC owner and trace flag. The normal runner cannot dispatch this experiment,
and the unchanged evaluator rejects diagnostic receipts.

## Fixed local design

| Dimension | Implemented value |
|---|---|
| Image | 0.55.60, immutable digest `316a645f021b5c9b833c295d94248e7df00ee37aa13d6d5614e55f9f04c83a4b` |
| Source/publication | Master `5bfff2dea1dec6f3e4b99c9a4cc0e6cb8e27388d`, publication run `39989347764` |
| Seed and interleaving | `20261023`: fresh BAAB, reused BAAB, fresh ABBA, reused ABBA |
| Role meaning | A/A labels, identical images; not release A/B |
| Work per round | 100 complete warmup cycles, 1,000 complete measured cycles, four operations per cycle |
| Accounting | 4,407 checked workload requests per round, 64,000 measured samples over 16 rounds |
| Limits | 0.5 CPU, 1 GiB per app; original 384 MiB RSS and OOM ceiling |
| CPU policy | `50000 100000`, zero burst, reject finite ancestor quota |
| Deadline | 60 minutes of phase-one work; cleanup still attempted afterwards |
| Database lifetime | One unchanged PostgreSQL process; new equivalent role databases at each block |
| Process lifetime | Fresh mode replaces the scheduled app before each visit; reused mode retains both role apps for its block |
| Client | Explicitly identified native host Node child; not the earlier Linux client |
| Exclusions | No new framework/dependencies, GC forcing, cache flushing, logging changes, extra SQL tracing, statistics reset or phase two |

Fresh mode does not restart PostgreSQL or flush operating-system caches. All
rounds keep the original resource creation/deletion path. Process and database
epochs are explicit, and subtraction across process lifetimes is rejected.
The two existing shared Docker containers were left running and unmodified.

## Evidence and interpretation

`preregistered-plan.json` freezes the intended inputs before allocation.
`manifest.json` additionally freezes actual platform image identities,
application distribution and fixture hashes, PostgreSQL identity, client
executable hash and collector hashes before the first workload. Each round
retains original timing arrays and all request spans. The block/role/visit
receipt link connects each measured array entry to its operation and cycle.

Each boundary preserves actual CPU counters, memory observations, process
identity, quota/ancestor settings, UTC timestamps and Linux read intervals.
The outer host read records its duration separately. Windows client
monotonic time is not treated as the Linux observer clock. Only UTC/round
boundaries relate these clocks; there is no per-request throttle attribution.
Readiness probes and observer operations are not included in the 4,407
workload requests.

The original 66-outcome runtime contract is reused directly. Private log
validation requires 200 rows, exact authorization redaction, valid identifiers,
durations and statuses, and same-record categorized negative-path correlation.
Raw logs and generated credentials are inspected only in memory, never
persisted in the evidence. No database execution time is labeled CPU or
network round-trip time.

Two blocks per history on shared Windows/WSL scheduling cannot establish
causal independence, a general false-positive rate or release confidence.
Idle work, background work and unknown host interference remain limitations.
Missing required identities or counters are failures, not zero-valued success.

## Focused implementation validation

| Evidence | Actual result |
|---|---|
| `red.log` | Six diagnostic behavior tests failed because the implementation did not exist; one admission-isolation test passed |
| `red-privacy.log` | Privacy validation failed before its implementation; nine other focused tests passed |
| `green.log` | Ten initial focused tests passed, including real bounded HTTP/IPC child success and capture-failure cleanup |
| `green-final.log` | Eleven focused tests passed after strengthening the missing-owner negative control and adding the real default-mode child path |
| `regression.log` | Seven unchanged admission/protocol/quantile selectors passed |
| `lint-green.log` | Existing ESLint engine, native correctness rules: zero errors across changed CommonJS files |
| Syntax | `node --check` on the three runtime files and test; PowerShell parser on the contract wrapper succeeded |
| `red-input-guards.log` / `green-input-guards.log` | Two new guard tests failed first; the complete corrected focused suite passed 13 tests |
| `lint-input-guards.log` / `freshness-final.log` | Corrected-source native ESLint: zero errors; document freshness: 27 documents passed |
| `post-guard-replay.json` | All 80 retained app snapshots and 32 CPU windows satisfy corrected guards; all ten frozen input hashes remain intact |

No full suite, remote CI, deployment or phase-two experiment was run.

The focused test and static commands were run from the exclusive worktree:

```powershell
node --test scripts\test\membership-history.test.cjs
node --test `
  --test-name-pattern='identical samples|tail-only regression|A/A requires|nearest-rank|incomplete, reordered|unknown order|preregistered protocol' `
  scripts\test\membership-performance.test.cjs
node --check scripts\performance\membership-history.cjs
node --check scripts\performance\run-membership-history.cjs
node --check scripts\performance\benchmark-membership.cjs
node --check scripts\test\membership-history.test.cjs
pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling
git diff --check
```

The scoped lint used the existing `api/node_modules/eslint` engine, not a
new dependency: CommonJS Node globals with `no-unused-vars`, `no-undef`,
`no-unreachable`, `no-dupe-args`, `no-constant-condition`, `no-unsafe-finally`,
`valid-typeof` and `constructor-super`, all at error severity. PowerShell
syntax was checked with `System.Management.Automation.Language.Parser.ParseFile`;
neither command reported errors.

## Actual phase-one findings

The phase ran from **17:34:27.725 to 18:28:25.683 UTC on 2026-10-23**.
Every raw receipt preserves all arrays and request spans. The executed input
manifest SHA-256 is
`0663f9ffc2c36d4a22dcada5cd4644ef20bd53db6a5c16e4f9539adc72fb8066`.
Its exact source bytes are retained under `phase1/frozen-inputs/`; the old
benchmark source is also retained separately as `frozen-original-benchmark.cjs`.
No old receipt or frozen campaign was overwritten.

| Frozen input | SHA-256 or exact identity |
|---|---|
| Diagnostic runner | `96d898fefee268c532f2bfb29609247191edc6ddb78eb9cc94332c238754166f` |
| Diagnostic collector/policy | `ca3de383e50c75bbcab7eda547f6335ccf9d76b6ef882bcec7ec35deccaf1032` |
| Instrumented original client | `54eaf3b011c49bf4b3969bfc516100d63e1657f88dd4a643fa2591a9d1ba2cb7` |
| Unchanged admission protocol | `e55aa0ef47ffa10b26629b9e2a19d780aa55dd18e337826e0f4de91df8c68313` |
| Actual image distribution | `39379de6bb7c417c75204ba26d603bf8f3d372d962fb9e4f2c41af315d7101d3` |
| Actual image fixture/migrations | `5489e49f87e3591b73ff938db38cef08728c8410cad7e416247d73c15037aa10` |
| Host client executable | Node v24.13.0, win32/x64; `d14ba95cdce1ef7dc9ad3ac74949ca5db38b27378ee30f30a23cf26f9e875a11` |
| PostgreSQL | 17.11, Debian 17.11-1.pgdg13+2, immutable image recorded in manifest |

### CPU windows and request tails

These are descriptive observations, not independent release comparisons.
CPU values are application-cgroup CPU counter deltas divided by the 1,000
complete cycles in the measured window. They include background work and
boundary effects; they are not isolated request CPU costs or SQL execution
times.

| History | Warmup CPU ms/cycle, mean | Measured CPU ms/cycle, mean | Throttled / total measured periods |
|---|---:|---:|---:|
| Fresh | 38.124 | 24.162 | 3,588 / 3,936 |
| Reused | 41.418 | 25.684 | 3,933 / 4,223 |

Each pooled operation below contains 8,000 measured samples per history.
Quantiles use all raw samples with the unchanged nearest-rank rule.

| Operation | Fresh p50 / p95 / p99 ms | Reused p50 / p95 / p99 ms |
|---|---:|---:|
| Add member | 12.194 / 47.213 / 86.680 | 11.796 / 54.104 / 104.070 |
| Populated read | 5.540 / 13.955 / 53.625 | 5.152 / 18.952 / 77.066 |
| Remove member | 10.986 / 45.296 / 90.206 | 10.566 / 49.774 / 104.480 |
| Empty read | 5.394 / 15.991 / 60.016 | 4.999 / 18.027 / 62.695 |

The block-level view is important: pooling alone would conceal substantial
block variation.

| Block | Mean measured CPU ms/cycle | Add p99 ms | Populated-read p99 ms | Remove p99 ms | Empty-read p99 ms |
|---|---:|---:|---:|---:|---:|
| Fresh BAAB | 25.612 | 90.538 | 57.973 | 91.736 | 69.970 |
| Reused BAAB | 29.725 | 127.698 | 86.507 | 129.036 | 72.491 |
| Fresh ABBA | 22.711 | 83.093 | 50.763 | 88.060 | 55.402 |
| Reused ABBA | 21.644 | 83.133 | 62.093 | 91.404 | 54.668 |

Repeated visits to each reused role had lower measured CPU deltas than its
first visit, but tails did not uniformly improve. The reused BAAB block was
materially slower than reused ABBA. This does not identify process history as
the sole cause: PostgreSQL/OS cache history, shared scheduling and unknown
background effects remain. It does not establish which SQL statements changed
execution time. Phase two was neither configured nor run.

### Instrumentation cost and cleanup

The 64 boundary snapshots cost **12.981 to 24.731 seconds** at the host, with a
**14.363-second median**. The longest inner Linux file-read interval was
9.681 ms. Each outer snapshot includes two serial Docker CLI interactions and
the IPC pause. That large observation cost is measured, not corrected away.
It makes request-throttle attribution and admission interpretation especially
inappropriate. Inherited image health probes also remained background work;
their entire history was not enumerated as benchmark requests.

Actual process identities confirm four distinct measured epochs in each fresh
block and two retained role epochs in each reused block. PostgreSQL kept its
same process start time across all blocks. Maximum observed Node high-water
RSS was 227.031 MiB, below the original 384 MiB ceiling; all recorded app
quotas, zero-burst checks, unbounded ancestor policy and OOM checks held.

There were 17 explicit readiness checks and 64 phase-boundary reads, recorded
separately from workload requests; initial process-policy reads are retained
with each of the 16 initialization epochs. All 18 owned containers and the
one owned network were removed and verified absent. The two unrelated
pre-existing containers were not stopped, modified or reused.

### Reproduction and evidence

The exact executed workload command was:

```powershell
Set-Location 'C:\Users\v-prasrane\source\repos\SCIMServer-gallery-mapping-20261014'
node scripts\performance\run-membership-history.cjs `
  --diagnostic-only `
  test-results\membership-history-20261023\phase1
```

That directory is immutable evidence, not a rerun destination. Future
experiments need new authorization and a new directory. The implementation
deliberately refuses overwriting an existing output directory.

| Location under `test-results/membership-history-20261023/` | Contents |
|---|---|
| `phase1/manifest.json` and `phase1/frozen-inputs/` | Frozen identities, policy, schedule and exact executed source bytes |
| `phase1/*-A.json`, `phase1/*-B.json` | Complete original timing arrays and request/cycle/operation spans |
| `phase1/*-windows.json`, `phase1/*-summary.json` | Raw counter windows, epochs, read costs and linked round summaries |
| `phase1/*-contract.json`, `phase1/*-privacy.json` | Four original contracts and sanitized private-log outcomes |
| `phase1/report.json` | Final status, every round, actual identities, primary failures and exact owned cleanup |
| `findings.json`, `findings.log`, `summarize.cjs` | Reproducible descriptive aggregation; no tail trimming |
| `red.log`, `red-privacy.log`, `green-final.log`, `regression.log`, `lint-green.log` | Focused test-first and static evidence |

## Execution issues and root-cause analysis

| ID | Type / severity | Symptom and mechanism | Resolution and why it works | Detection / earliest detection |
|---|---|---|---|---|
| HD-01 | Local lint tooling / Low | Existing ESLint was installed, but `@eslint/js` was not resolvable from either the API package or ESLint's dependency scope. A convenience lint command failed before analyzing source. | Reused the installed ESLint engine with explicit native correctness rules and declared Node globals. No package installation, lockfile or quarantine change was needed. `lint-green.log` records zero errors. | Focused lint / checking the exact installed configuration before selecting a convenience preset |
| HD-02 | Docker metadata tooling / Low | An initial manual image-inspect template assumed `.Config.Labels`; the cached image exposed no such key and Docker reported `map has no entry for key "Labels"`. | Used supported image ID, repository-digest, architecture and OS fields, then hashed the actual distribution and fixture. No image label or registry mutation was needed. | Read-only identity preflight / selecting only required supported fields |
| HD-03 | Inspection tooling / Low | Early combined source reads exceeded the tool's inline output limit and were truncated. | Switched to smaller bounded source ranges and targeted field extraction; did not read or write temporary output paths. | Initial source inspection / limiting each evidence read before combining unrelated output |
| HD-04 | Input missingness / High | Post-experiment review found raw `Number('')` could coerce an empty required burst or memory signal to zero, and an empty monotonic start could become `0n`. This was a latent false-success path, not an observed run failure. | Added strict unsigned parsing, nonempty clocks, positive memory peaks and complete root-ancestry guards. Two new RED controls preceded implementation; all 13 focused tests then passed. The collector also parses its retained CPU text from the same single read. | Post-experiment source consolidation / focused negative controls before the workload |
| HD-05 | Source identity / Medium | The executed overlay correctly required HEAD `d25b6155`, but that exact-tip check would reject the harness after its own ordinary local commit. | A bounded read-only real Git check now requires that starting merge as an ancestor and records actual HEAD alongside source hashes. A real Git test accepts committed descendants and rejects unknown ancestry. No branch or history mutation is involved. | Local commit consolidation / testing the committed-source path before the workload |
| HD-06 | Evidence checker tooling / Low | The first post-run byte-proof helper attempted `git show` on the ignored publication closeout and failed because that provenance input is not a Git blob. | Classify tracked source and ignored provenance explicitly; verify every frozen copy against its manifest hash, and compare only tracked files to Git. | Post-run preservation proof / checking input storage class before blob lookup |
| HD-07 | Evidence checker tooling / Low | An expanded snapshot replay treated final Docker inspection records as initial counter snapshots and failed with `Cannot read properties of undefined (reading 'epoch')`. | Explicitly distinguish and validate the two receipt shapes; replay all 64 boundary plus 16 initial snapshots. Unknown record shapes still fail. No workload or original receipt changed. | Expanded post-run replay / inspecting the heterogeneous epoch-record schema first |

This ledger records confirmed problems and their resolutions. Expected test-first
failures are validation evidence, not implementation incidents.
The high host-side observer cost is an observed limitation, not a silently
waived gate or an invitation to change the frozen run.

**Provenance/completeness:** Available tool outputs, the bounded handoff summary
and retained RED/GREEN, lint, phase and findings logs were reconciled for known
failures and diagnosed limitations. Earlier context was summarized and
`VSCODE_TARGET_SESSION_LOG` was not exposed, so a full per-agent JSONL
reconciliation could not be performed. This is an explicit completeness limit,
not a claim that every earlier transcript event or parent-session issue was
reconstructed.

## Self-improvement and architecture disposition

**Applied:** Permanent negative controls now cover process-epoch crossing,
counter reset/missingness, role history, exact cycle/sample/request accounting,
first-failure stop, capture-failure cleanup and diagnostic admission rejection.
The real child test proves the request and cleanup outcomes rather than just
the presence of an IPC message.

**Design disposition: accepted.** The new runner is a bounded orchestration
entry point; schedule, receipt validation, epoch checks, collection and cleanup
policy are testable helpers. It adds no application dependency edge, strategy
framework or speculative benchmark abstraction. The old evaluator and
qualification runner remain separate, preserving the admission boundary.

## Local source preservation and unmeasured guard correction

Commit `8771256b33ca040c4f43a247150a015d6a966ae2` preserves the executed
implementation and actual-results documentation. The subsequent HD-04/HD-05
correction is locally tested, **not remeasured**. It does not produce or replace
the phase-one receipts, change their frozen manifest, or authorize another run.

The executed source hashes above and exact `phase1/frozen-inputs/` copies remain
authoritative for the experiment. After the guard correction, raw working-file
SHA-256 values are:

| Unmeasured corrected input | SHA-256 |
|---|---|
| `membership-history.cjs` | `894d7a4273871acfd28b938bcddaa7f2774afc1606627d396294292a01d377d9` |
| `run-membership-history.cjs` | `42084dc37e418d1ac627f71a5bcb6c3882a9c59d1a3447084507e1d25ecc8cd1` |

The corrected focused suite has 13 passing tests. `red-input-guards.log` and
`green-input-guards.log` retain the additional test-first evidence. This
self-improvement is **applied**; the design disposition remains **accepted**:
small concrete input guards and a read-only identity helper, without a new
framework or application dependency.

### Raw bytes versus Git bytes

With `core.autocrlf=true`, all nine tracked executed inputs were raw CRLF files,
while Git stores LF-normalized blobs. Their raw hashes therefore **do not equal**
the corresponding commit-blob hashes. A read-only proof confirms that every
tracked frozen input equals commit `8771256b` after CRLF-to-LF normalization;
the tenth input is ignored publication provenance, not a Git source blob.
Do not substitute a Git blob hash for an executed-file hash.

The exact raw copies remain under `phase1/frozen-inputs/`. Reproduce the
preservation and strict-guard replay without issuing any workload requests:

```powershell
node test-results\membership-history-20261023\verify-inputs.cjs
```

`post-guard-replay.json` records both hash domains and the 80-snapshot,
32-window replay. It is a source-preservation and compatibility check,
not another experiment or new admission evidence.
