# Disposable URL GIN counterfactual

**Last verified:** 2026-10-24

## Executive summary and scope

This is a separate, explicitly opted-in database experiment, not another
application comparison. The implementation changes no production schema,
index, request path, release baseline or admission rule. Its single
executed study compared equivalent fresh current-schema tables,
with exactly one experimental difference: the URL trigram Generalized
Inverted Index (GIN) is present in A and absent in B.

The earlier [DS-03 statement study](MEMBERSHIP_OBSERVER_AND_STATEMENT_DIAGNOSTIC.md)
is complete and remains unchanged. Its additional logging SQL execution
and write-ahead log (WAL) volume motivated this question but did not prove
which index caused either. This experiment cannot retrospectively establish
the unique DS-03 cause or explain HTTP latency tails.

**Actual result: COMPLETE, 8/8 trials, one invocation.** It finished in
191.076 seconds including cleanup. For 32,000 identical rows per condition,
omitting URL GIN reduced measured insertion-plus-drain execution by
981.471 ms (61.32%) and WAL by 58,542,228 bytes (52.55%). This is
0.030671 ms and 1,829.445 WAL bytes per row in this synthetic fixture.

**Recommendation: keep the production index.** The absent-URL read also
changed from a GIN-backed mean of 0.163 ms to a sequential-scan mean of
10.945 ms. The experiment establishes a scoped maintenance tradeoff,
not a safe production drop, a unique DS-03 explanation or release admission.
The next engineering action is a read-preserving logging/index design
with explicit representative URL-search acceptance criteria.

## Fixed experiment

| Item | Fixed choice |
|---|---|
| Entry point | `node scripts\performance\run-membership-gin.cjs --disposable-url-gin-only <unique-project-output>` |
| Family | `membership-url-gin-counterfactual`, diagnostic only, never admission |
| Schedule | BAAB followed by ABBA; eight trials, no replacement or alternate order |
| Dataset | Seed 20261024; 8,000 identical synthetic rows per trial, 160 batches of 50 |
| Table | Current RequestLog semantics replayed from all 30 pinned canonical migrations |
| A | Primary key plus all ten current secondary indexes |
| B | Same columns, defaults, constraints, storage, table/index options and all other indexes; only URL `gin_trgm_ops` omitted |
| PostgreSQL/client | Cached immutable PostgreSQL 17.11 image; installed `pg` 8.22.0; no installation |
| PG resources | One owned process, 1 CPU, 1 GiB, disposable memory-backed data directory |
| Absolute cap | 900 seconds, including 120 seconds reserved for cleanup |
| Native maxima | Work 60 seconds / cleanup 30 seconds, always clamped to the remaining absolute budget |
| Safety recovery | If needed, a separately reported 120-second safety-only removal budget; original diagnostic remains INVALID |
| Server policy | Autovacuum off; checkpoint timeout one hour; maximum WAL size 1 GiB; full-page writes, fsync, synchronous commit and JIT on |
| GIN policy | Canonical default fastupdate on and pending-list limit 4 MiB; no per-index tuning |
| Checkpoints | Explicit checkpoint after each fresh clone and before inserts; verify unchanged checkpoint LSN across insertion plus drain |
| Privacy | Only the actually generated PG administrator password is a required canary; no fabricated application credentials |

The canonical migrations are executed verbatim against the new owned
database. The three concurrent-index migrations remain single top-level
statements, not implicit transaction batches. No API server or migration
helper container starts. Clones use PostgreSQL's `LIKE INCLUDING ALL` and
copy the canonical table maintenance options. Catalog comparisons normalize
index names and table identities but retain definitions and index options.
Every preserved index must be valid, ready and live.

## Actual execution and write results

Executed source: `0de430f8e5db4dd1721800811a7e6e794c43c6cf`.
The worktree was clean before invocation. The sole output directory is
`test-results/gin-counterfactual-20261024/attempt1-20261024T013750203Z/`.
Execution ran from **2026-10-24 01:37:50.402 UTC** to
**01:41:01.478 UTC**. No trial was replaced or reordered.

Every trial retained 160 measured batches, inserted 8,000 rows and
verified their complete database hash. All **1,280 batches / 64,000 rows**
and four A-condition drains are retained. These are synthetic database
rows, not HTTP requests; no application server was started.

| Trial | Block / condition | INSERT execution ms | Drain execution ms | Full write-cycle ms | INSERT WAL bytes | Drain WAL bytes | Full write-cycle WAL bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| 0 | BAAB / B | 176.633 | N/A | 176.633 | 13,214,620 | N/A | 13,214,620 |
| 1 | BAAB / A | 402.844 | 19.058 | 421.902 | 27,148,733 | 701,444 | 27,850,177 |
| 2 | BAAB / A | 370.541 | 16.460 | 387.001 | 27,148,733 | 701,444 | 27,850,177 |
| 3 | BAAB / B | 140.934 | N/A | 140.934 | 13,214,620 | N/A | 13,214,620 |
| 4 | ABBA / A | 386.702 | 16.032 | 402.734 | 27,148,733 | 701,444 | 27,850,177 |
| 5 | ABBA / B | 142.191 | N/A | 142.191 | 13,214,620 | N/A | 13,214,620 |
| 6 | ABBA / B | 159.316 | N/A | 159.316 | 13,214,620 | N/A | 13,214,620 |
| 7 | ABBA / A | 370.822 | 18.086 | 388.908 | 27,148,733 | 701,444 | 27,850,177 |

Here, "full write cycle" means the measured INSERT statements plus final
pending-list drain, not schema creation, checkpoints, result verification,
read guards, transaction-commit WAL or final physical dirty-buffer flush.

| Aggregate, four trials / 32,000 rows each | A: all current indexes | B: only URL GIN absent | B minus A |
|---|---:|---:|---:|
| INSERT execution | 1,530.909 ms | 619.074 ms | -911.835 ms |
| Final-drain execution | 69.636 ms | Not applicable | -69.636 ms |
| Full write-cycle execution | 1,600.545 ms | 619.074 ms | -981.471 ms / -61.32% |
| Full execution per row | 0.050017 ms | 0.019346 ms | -0.030671 ms |
| Full execution per 50-row batch | 2.500852 ms | 0.967303 ms | -1.533548 ms |
| INSERT WAL | 108,594,932 bytes | 52,858,480 bytes | -55,736,452 bytes |
| Final-drain WAL | 2,805,776 bytes | Not applicable | -2,805,776 bytes |
| Full write-cycle WAL | 111,400,708 bytes | 52,858,480 bytes | -58,542,228 bytes / -52.55% |
| Full WAL per row | 3,481.272 bytes | 1,651.828 bytes | -1,829.445 bytes |
| Full WAL per batch | 174,063.606 bytes | 82,591.375 bytes | -91,472.231 bytes |
| Full client statement elapsed | 3,582.440 ms | 2,487.385 ms | -1,095.055 ms |

The direction held in both fixed blocks: B minus A was -491.336 ms
(-60.74%) for BAAB and -490.135 ms (-61.91%) for ABBA. All A trial
full-cycle times were 387.001-421.902 ms; all B times were
140.934-176.633 ms. WAL was identical within each condition. These four
observations per condition are not a production confidence interval.

### Deferred work and buffer accounting

Each A trial began with zero pending pages/tuples. After insertion it
had **458 pending pages / 1,829 pending tuples**; the explicit measured
drain reduced both to zero in all four trials. Foreground GIN flush work
was already inside INSERT measurements. No remaining pending work was
shifted past the reported write cycle. The bundled `pgstattuple` extension
was enabled only in this owned database for pending-list observations.

| Sum of root per-query counters | A INSERT | A final drains | B INSERT |
|---|---:|---:|---:|
| WAL records | 397,416 | 716 | 354,952 |
| WAL full-page images | 256 | 720 | 0 |
| Shared buffer hits | 764,404 | 8,132 | 648,648 |
| Shared buffer reads | 0 | 0 | 0 |
| Shared buffers dirtied | 6,964 | 372 | 4,392 |
| Shared buffers written | 6,924 | 372 | 4,360 |

Every INSERT had zero temporary blocks read/written. These are summed
query counters, not unique page counts or physical device I/O. Checkpoint
LSNs and checkpointer counters were unchanged across every insertion-plus-
drain window; no timed checkpoint occurred. Setup, each explicit pretrial
checkpoint, catalog checks, ANALYZE, result retrieval and schema removal
remain outside INSERT measurements.

## Actual read guards: an observed benefit, not just equal results

All 32 guard executions produced matching corresponding result counts
and digests across all eight trials. Each mean below is four retained
EXPLAIN observations per condition, not HTTP latency.

| Read guard | Rows | A mean ms | B mean ms | Unforced observed plan |
|---|---:|---:|---:|---|
| Present Group URL substring | 4,000 | 11.920 | 13.643 | Both sequential scan plus sort |
| Absent Group URL substring | 0 | 0.163 | 10.945 | A: bitmap scan using cloned URL GIN; B: sequential scan |
| Endpoint timeline | 100 | 0.065 | 0.063 | Both use the createdAt index |
| Activity summary | 4 | 6.122 | 5.778 | Both sequential scan, aggregate and sort |

The absent-search difference is **10.7825 ms**, approximately 67.3 times
the A mean, even at this small scale. A ranged 0.135-0.191 ms and B
10.246-11.612 ms. This directly demonstrates why a write saving must not
be turned into a blind drop recommendation.

## Identity, privacy, limits and cleanup proof

- All eight catalog checks passed: 21 columns and the same defaults,
  constraints, storage, table options and every retained index definition/
  option. A had eleven indexes including the primary key; B had ten,
  omitting only URL GIN.
- PostgreSQL was **17.11 (Debian 17.11-1.pgdg13+2)**, Linux/amd64,
  at immutable image ID and RepoDigest
  `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.
  Actual limits were 1,000,000,000 NanoCPUs / 1,073,741,824 memory bytes;
  OOM was false.
- All declared effective settings passed: full-page writes, synchronous
  commit, fsync and JIT on; autovacuum off; one-hour checkpoint timeout;
  1 GiB maximum WAL; 4 MiB GIN pending-list limit. All four scan-enable
  settings remained on, without forced query plans.
- Seventy loaded runtime/client/canonical input files matched their
  frozen copies before work and again after completion. Exact disk
  SHA-256, committed normalized-content SHA-256 and Git blob identity
  are distinguished in `source-commit-proof.json`; they are not
  interchangeable hash types.
- The actual single generated credential role, `postgres-admin-password`,
  passed the complete PG and tool-output checks. The PG capture retained
  only safe facts: 8,334 bytes, 70 timestamp-framed records, both pipe
  EOFs, exit zero, 7.787 seconds, zero ambiguous records. Tool output was
  3,507 scanned bytes. No raw console, SQL parameters or credential value
  was retained.
- Exact owned PG ID
  `d193a0b0fb511e8d345377f9eac6adf63f823dea34ccbf76701a37c1d4140217`
  passed capture, fresh owner/image-verified removal and independent
  absence checks. The owned network was removed and independently
  absent. All eight unrelated full IDs/states were unchanged.
- A separate post-run metadata check found the same eight shared
  containers, no owned network and no diagnostic/Docker helper left
  running. It did not rerun a workload or alter the experiment's elapsed
  time. No safety recovery or out-of-cap cleanup was needed.
- The run finished 708.924 seconds before its 900-second absolute
  deadline. Summed native cleanup plus console-capture durations were
  99.702 seconds, within the 120-second reservation. A 30-second native
  cleanup maximum is clamped to the original deadline; it is not added
  to that deadline.

### Immutable receipt identities

The seal covers 84 files, including all 70 frozen inputs and eight full
trial receipts. The original report is not rewritten by this closeout.

| Evidence | SHA-256 |
|---|---|
| Intent | `54638c1196c4d62c9a154869ad6da8cfa31e704a361af556cd25d8b5af8c82ea` |
| Preallocation manifest | `d69790d3f33e401fb605c5568226fb5c02bd3b655068690f9e6bef2f0bb8f963` |
| Runtime manifest | `d1ea4d43d6b1b283e0d36440861fc9021e6165a8c8612793240a7397fa026d61` |
| Original report | `198ba6be4845b3df37f52ff60731fe94c74553ec46155289e77d289189e9dd62` |
| Computed findings | `5a0cd1d0c589b7b85634dd3ed0e19bdf175ea09bd9579c6af737bdcd85df0df2` |
| Evidence seal | `3a38fbfef8276a96372338a3f061a7ea8580d0f62551640d0ca946cf132bd090` |
| Canonical catalog semantics | `b766d5a850e65cb17e5d98e429f2d739805850dd3583f293393666ffbe0ca064` |
| Logical fixture | `4f6947a63587212dde0660600220f8b958b72417644f55402c7900477fa927b0` |
| Complete PG row values, every trial | `a69683a3a64ca40af878262b5e5c44e58bcc738da9b53be8b78aed2a9ad00b0b` |

The logical-fixture and database-row hashes use different serializations
and orderings; they need not equal each other. Each was independently
fixed or verified as appropriate.

All 90 local branches and ten stashes remain. Only this working branch
advanced normally; the other 89 tips and qualification tip `d25b6155`
were unchanged. DS-03's 50 sealed files, seal and commit-closeout bytes
were reverified unchanged, preserving their earlier historical evidence
chain. No original/derived application image or release baseline changed.

## Meaning, remaining holds and engineering next action

The sole manipulated table property was URL GIN presence. Equal complete
rows and catalog semantics, deterministic WAL within each condition,
explicit drain accounting and the same timing direction in both blocks
support an index-maintenance contribution **for this synthetic fixture**.
Shared host scheduling and continuing PostgreSQL/cache history still
limit timing generalization.

Do not subtract this 0.030671 ms/row contrast from DS-03's approximately
0.0478 ms/row increase: payloads, instruments, statement shapes and
execution contexts differ. It establishes neither a fraction of the
historical regression nor a unique cause of an HTTP tail. Memory-backed
PG storage also cannot reproduce production disk synchronization costs.
SQL elapsed is not PostgreSQL CPU, and neither is HTTP request latency.

**Next:** retain the production GIN and turn the observed write/read
tradeoff into a separately reviewed read-preserving design. First define
representative present/absent URL search selectivities and read budgets;
use those requirements to evaluate a logging/index design. No further
experiment, planner tuning or production mutation is authorized here.

No release baseline was adopted, no admission PASS was produced, and
PR251, push, CI, cloud and deployment remain untouched. DS-01 remains
INVALID with its actual historical native inner cause unknown.

**Execution time cost:** the final source aggregate took 37.956 seconds;
the actual disposable study took 191.076 seconds including cleanup.
Source editing/review time was not separately instrumented. No runtime
failure occurred; source/test issues and their causal prevention are
recorded below. No unchanged suite was rerun after execution.

## Flow and worked example

```text
Clean committed source + cached modules + canonical migrations
  -> exclusive intent + frozen raw-byte input closure
  -> immutable cached image + shared/owned inventory preflight
  -> fully resolved preallocation manifest
  -> owned network and PostgreSQL only
  -> canonical schema replay + actual settings/catalog/runtime manifest
  -> verify disk and frozen inputs again, before experimental writes
  -> each trial: fresh clone -> optional one-index omission -> catalog proof
       -> explicit checkpoint -> 160 measured INSERT batches
       -> explicit measured GIN pending-list drain for A -> verify empty
       -> complete row hash/count -> ANALYZE -> four read-result guards
       -> persist all numeric evidence -> discard the trial schema
  -> complete bounded PG/tool privacy scan
  -> exact full-ID owner verification -> removal -> independent absence
  -> report actual COMPLETE or first closed INVALID cause
```

Each batch inserts exactly fifty rows using identical values and order.
For example, the first four rows represent add, populated read, remove
and empty read: PATCH, GET, PATCH, GET, with the benchmark's SCIM member
operation shapes. The first 4,000 rows use one fixed synthetic Group URL;
the next 4,000 use a second, representing two visits rather than inventing
thousands of searchable URLs. Resource IDs, request IDs, timestamps,
headers, request/response bodies, authentication fields and endpoint name
are deterministic. They are synthetic, not exported application logs.
The logical fixture hash is preregistered; every trial must return the
same complete PostgreSQL row hash and 8,000-row count.

## Measurement and deferred-work accounting

Every batch uses `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON, TIMING OFF)`
with `RETURNING id`. This **actually inserts rows**. The identical
RETURNING/EXPLAIN overhead is part of both conditions; this is not a
bit-for-bit recreation of Prisma's original SQL.

The root plan's inclusive block and WAL counters are retained once.
Child plan counters are never added to them. All 1,280 batches retain
server execution/planning time, actual rows, shared/local/temp buffers,
WAL records/full-page images/bytes, timestamps and client elapsed time.
No missing metric is silently replaced by zero.

For A, `pgstatginindex` records the pending list before and after the
explicit `gin_clean_pending_list` call. The drain itself is measured
with the same EXPLAIN options, and completion requires zero pending
pages and tuples. Automatic foreground flushes remain inside their
insertion batches. B's drain is explicitly not applicable, not a
fabricated successful measurement. Full-cycle arithmetic includes
insertion **and** final pending-list drain execution and WAL.

These numbers are executor elapsed time, not PostgreSQL CPU time.
Planning, protocol transfer, client processing and commit synchronization
are not executor time; client elapsed includes additional overhead.
Checkpoints, schema/index setup, pending-list observations, ANALYZE and
read guards are outside insertion measurements and identified separately.
Draining GIN's pending list does not claim that every dirty buffer has
already been fsynced. Autovacuum is disabled to prevent unmeasured
background GIN maintenance, at the cost of departing from normal
production maintenance and visibility-map behavior.

## Read guards and interpretation limits

Four unforced read plans and execution measurements are retained after
ANALYZE: present URL substring, absent URL substring, endpoint timeline
and activity summary. Separate result retrieval must produce identical
counts and result digests in all trials. No planner-enable flag is forced.
Only safe node/index identities are retained, not plan filters or query
parameters.

The fixture has only two URL values and 8,000 rows. It cannot reproduce
the historical 467,866-row read wins reported in production history.
Read guards establish equal results and observed small-fixture plans,
not preservation of production read performance. A write saving is not
a license to remove a production index. Shared Windows/WSL scheduling,
one continuing PostgreSQL process, cache history and order effects remain
limitations even with balanced order and equivalent fresh relations.

## Source and test execution issues and prevention

| Issue | Mechanism and resolution | Detection / earliest gate |
|---|---|---|
| Tooling, Low: cached Prisma CLI help exceeded 15 seconds | The exact inner startup cause was not retained. No DB or Docker work occurred. Use verbatim canonical migration replay instead; no install or enlarged CLI timeout. | Source preparation / source preparation |
| Test correctness, Low: admission negative stopped at wrong assertion | Fixture omitted the existing `sameImage` boolean. Supply a valid outer envelope and require the exact diagnostic-receipt rejection. Admission implementation remains unchanged. | Focused test / focused test |
| Harness, Medium: blanket concurrent-index rejection | Three canonical migrations legitimately use concurrent creation. Preserve each verbatim as one top-level statement and lock all 30 / three concurrent files in a test. | Source guard / source guard |
| Test harness, Low: VM omitted CommonJS cache | Real bounded preflight child stopped before intent because its mock `require` lacked `cache`. Supply the real cache and explicit filename; do not change runtime flags or source behavior to fit a mock. | Actual Node child / actual Node child |
| Privacy receipt, Medium: recursive rejection of unchecked metadata | A deliberate malformed safe-details object made the new minimal serializer throw. Validate into the existing finite source/kind catalog; otherwise retain fixed `privacy-metadata-invalid`, never raw input. | Causal RED unit / unit |
| Lifecycle, High: recovery branch preceded normal finalization | Source review found that unset absence flags entered safety recovery before normal capture/removal. A real Node fixture exercising the actual allocated entry reproduced premature removal and lost capture. Move the unchanged recovery block after normal finalization and independent absence checks. The causal test now verifies one complete capture before removal, no unnecessary recovery, preserved initial SQLSTATE and exact owned absence. No real Docker dispatch occurred. | Source review plus causal RED child / allocated-entry child |
| Lifecycle, High: resource invalidity blocked exact owned removal | The same actual-entry fixture with an OOM state reproduced resource assertions refusing both normal and recovery removal. Separate fresh full-ID/owner/image verification from resource qualification: resource assertions still fail capture/qualification, but cannot prohibit removal of that verified owned container. The corrected aggregate passes healthy and OOM branches, preserving the first schema failure and removing both fixtures without real Docker. | Causal RED allocated-entry child / allocated-entry child |
| Test harness, Low: new regression was accidentally nested | The selected name matched no registered top-level test, returning only the file-level envelope. Move registration to the top level and require its explicit named result; the subsequent RED reproduced the intended lifecycle failure and GREEN passed 1/1. The unmatched run is retained, not represented as causal RED. | Selected-test output / test registration review |
| Tooling, Low: optional lint configuration packages absent | Cached ESLint exists, but direct `globals` and `@eslint/js` imports do not. Run twelve explicit built-in rules with declared Node globals using that installation: three files, zero issues; no dependency installation or configuration change. | Scoped lint startup / cached-module resolution |

The malformed-metadata assertion failed before its correction. The
zero-allocation preflight test runs the actual entry flow in a bounded
Node child with fake native metadata produced by another actual Node
child. No real Docker fallback exists. It requires exclusive intent,
source hashes, immutable requested image and fixed caps to survive a
metadata failure, with no allocation and a closed INVALID receipt.

The final changed-source aggregate is **39/39 PASS**, zero failures,
cancellations or skips:

```powershell
node --test --test-concurrency=1 `
  scripts\test\membership-gin.test.cjs `
  scripts\test\membership-console.test.cjs `
  scripts\test\membership-privacy.test.cjs `
  scripts\test\membership-lifecycle.test.cjs
```

It took 37.956 seconds. The earlier 38/38 aggregate predates the additional
allocated-entry regression and is not substituted for this result. All
selected RED runs and the unmatched file-level envelope remain under
`test-results/gin-counterfactual-source-20261024/`. Syntax passed for the
three new CJS files; scoped cached ESLint passed twelve rules with zero
issues. The content-only freshness gate passed all 27 manifest documents.
No application build, old 84-test rerun or real Docker fixture was used.

**Provenance / completeness:** This ledger is reconciled with this
objective's 18 retained preparation/test logs, including initial wrong-cause
and unmatched-selection results. A signal-frequency pass distinguished
repeated stack echoes from actual mechanisms; counts are not presented as
independent incidents. The unmatched selection is explicitly dismissed as
causal evidence. `VSCODE_TARGET_SESSION_LOG` was unavailable, so a full
transcript reconciliation cannot be claimed. This is not a reconstruction
of unretained historical native errors or the earlier full conversation.

**Self-improvement: applied.** Exact-cause negatives, concurrent migration
shape, complete disk/frozen-copy identity and inclusive-counter tests
operationalize the relevant failure classes.

**Design/architecture disposition: accepted.** One focused fixture/catalog
helper and one opt-in orchestration file reuse the established PG client,
stream scanner, finite privacy/native causes, ownership guard, absolute
deadline calculation and finalizer. No new lifecycle framework or
production dependency edge is introduced. The approximately 420-line
orchestrator was reviewed as a size candidate: it remains one bounded
experiment with closure-owned lifecycle state, not a production service.
Splitting that state across a new callback framework for one caller would
add coupling without a second implementation, so that speculative split
was declined.

Provenance is the named source, focused test artifacts and the single
execution's own receipts. No reconstruction of the earlier private
native error or claim of an unavailable full historical transcript is made.

## PostgreSQL 17 references

- [GIN and fast updates](https://www.postgresql.org/docs/17/gin.html#GIN-FAST-UPDATE):
  pending entries defer work and can trigger foreground cleanup.
- [EXPLAIN](https://www.postgresql.org/docs/17/sql-explain.html):
  ANALYZE executes statements; buffer/WAL and timing scopes matter.
- [Introduction to indexes](https://www.postgresql.org/docs/17/indexes-intro.html):
  read acceleration has index-maintenance costs.

These exact version-17 URLs were fetched successfully during source work.
No unverified `gin-implementation.html` URL is used.
