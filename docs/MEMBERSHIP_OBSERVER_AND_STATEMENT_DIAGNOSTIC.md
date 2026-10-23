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
a separate disposable cached-PG fixture also passed. The next boundary is one
new eight-round statement diagnostic, not yet executed. No additional
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
0.55.60. It will execute BAAB then ABBA once, with two reused role apps per
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
hashes, loaded PostgreSQL-client module hashes and the final manifest will
identify the new execution. Git's CRLF normalization does not redefine those
on-disk hashes.

## Issues, root causes and improvement dispositions

| ID | Type / severity | Observed issue and mechanism | Correction and detection |
|---|---|---|---|
| OS-01 | Measurement architecture / High | Two serial Docker CLI launches dominated boundary cost by seconds. The earlier collector preserved read cost but had no executable low-disturbance gate. | Persistent owned stream plus the single passing real-fixture smoke above. Earliest possible detection: observer-only smoke before workload execution; detection escaped to the phase-one workload report. |
| OS-02 | Lifecycle / Medium | Initial strict protocol treated an intentional process change as an unrecoverable framing failure, preventing an explicit refresh on the same stream. | A narrowly typed epoch-change response quarantines only that binding. Actual-child RED/GREEN proves detection and refresh without silently accepting the old epoch. |
| OS-03 | Diagnostic contract / High | An epoch-only reply check initially accepted missing counters or arbitrary private extra fields from a faulty collector. | RED privacy canaries preceded an exact snapshot-key allowlist and full counter/policy validation on both stream ends. Unknown fields never become persisted receipts. Detection: focused child privacy test; earliest: the same test before encoder implementation. |
| OS-04 | Compatibility / Medium | The history helper intentionally fixed receipt version to 0.55.60, so an explicit 0.55.20 comparison was rejected before useful diagnosis. | Retained legacy-receipt RED followed by an explicit expected-version argument, preserving the existing default. Focused GREEN confirms both selections. Detected at the earliest unit-test stage, before the workload. |
| OS-05 | Test correctness / Medium | A generic admission `throws` check initially succeeded on the wrong role-order assertion, not diagnostic exclusion. | The test now uses actual admission role labels and requires the exact diagnostic-rejection message. Tightened check caught the faulty fixture before execution; focused GREEN confirms the intended guard. |
| OS-06 | Summary correctness / Medium | Grouping by fingerprint alone did not expose mixed top-level/nested identities when their query ID was unchanged. | A specific undefined-versus-expected-array RED preceded explicit retained top-level sets and mix flags. Detected at the earliest unit-test stage, before workload execution. |

**Self-improvement: applied.** Disturbance is now a separately measured gate,
and privacy canaries exercise real child streams before any new diagnostic.
Negative admission tests require the intended rejection reason, and real
PostgreSQL verifies SQL capability/delta/privacy assumptions before workload.

**Design disposition: accepted.** One concrete channel serves the history
runner and the real smoke. Both reuse the existing collector and epoch/policy
guards. There is no new benchmark framework, dependency or application code.
The statement runner is a bounded orchestration file; SQL/privacy/delta math
and disposable database setup live in separate cohesive helpers. Further
strategy abstractions would have only one implementation and are declined.

## Unchanged holds

The original negative 0.55.58 admission evidence, phase-one evidence, customer
data, migration, capacity, operational, cleanup-403 and visual holds remain.
Even a successful smoke or statement diagnostic is not release PASS and cannot
retroactively prove the cause of the 0.55.58 incident.
