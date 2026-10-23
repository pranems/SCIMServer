# Low-disturbance membership observation and statement diagnosis

**Last verified:** 2026-10-23
**Scope:** Unreleased local diagnostics, not release admission.

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
