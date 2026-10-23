# Low-disturbance membership observation and statement diagnosis

**Last verified:** 2026-10-23
**Scope:** Unreleased local diagnostics, not release admission.

## Executive summary

The previous boundary collector paused the workload for 12.981-24.731 seconds
per observation because it launched two serial Docker CLI commands. That is a
measurement-system defect, not application latency. The replacement starts one
owned read-only observer channel and uses bounded JSON-lines requests after
startup. No prior receipt is relabeled as using this corrected collector.

The authorized next boundary is one fixed observer-only smoke, followed by one
new eight-round statement diagnostic only if that smoke passes. No additional
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
The smoke outcome will be recorded from its actual immutable receipt, not
inferred from unit tests.

## Issues, root causes and improvement dispositions

| ID | Type / severity | Observed issue and mechanism | Correction and detection |
|---|---|---|---|
| OS-01 | Measurement architecture / High | Two serial Docker CLI launches dominated boundary cost by seconds. The earlier collector preserved read cost but had no executable low-disturbance gate. | Persistent owned stream plus a fixed real-fixture latency smoke. Focused protocol tests are green; actual disturbance remains unverified until the smoke. Earliest possible detection: observer-only smoke before workload execution. |
| OS-02 | Lifecycle / Medium | Initial strict protocol treated an intentional process change as an unrecoverable framing failure, preventing an explicit refresh on the same stream. | A narrowly typed epoch-change response quarantines only that binding. Actual-child RED/GREEN proves detection and refresh without silently accepting the old epoch. |
| OS-03 | Diagnostic contract / High | An epoch-only reply check initially accepted missing counters or arbitrary private extra fields from a faulty collector. | RED privacy canaries preceded an exact snapshot-key allowlist and full counter/policy validation on both stream ends. Unknown fields never become persisted receipts. Detection: focused child privacy test; earliest: the same test before encoder implementation. |

**Self-improvement: applied.** Disturbance is now a separately measured gate,
and privacy canaries exercise real child streams before any new diagnostic.

**Design disposition: accepted.** One concrete channel serves the history
runner and the real smoke. Both reuse the existing collector and epoch/policy
guards. There is no new benchmark framework, dependency or application code.

## Unchanged holds

The original negative 0.55.58 admission evidence, phase-one evidence, customer
data, migration, capacity, operational, cleanup-403 and visual holds remain.
Even a successful smoke or statement diagnostic is not release PASS and cannot
retroactively prove the cause of the 0.55.58 incident.
