# Disposable URL GIN counterfactual

**Last verified:** 2026-10-24

## Executive summary and scope

This is a separate, explicitly opted-in database experiment, not another
application comparison. The implementation changes no production schema,
index, request path, release baseline or admission rule. Its single
prospective execution compares equivalent fresh current-schema tables,
with exactly one experimental difference: the URL trigram Generalized
Inverted Index (GIN) is present in A and absent in B.

The earlier [DS-03 statement study](MEMBERSHIP_OBSERVER_AND_STATEMENT_DIAGNOSTIC.md)
is complete and remains unchanged. Its additional logging SQL execution
and write-ahead log (WAL) volume motivated this question but did not prove
which index caused either. This experiment cannot retrospectively establish
the unique DS-03 cause or explain HTTP latency tails.

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

## Source/test execution issues and prevention

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
node --test --test-concurrency=1 scripts\test\membership-gin.test.cjs scripts\test\membership-console.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-lifecycle.test.cjs
```

It took 37.956 seconds. The earlier 38/38 aggregate predates the additional
allocated-entry regression and is not substituted for this result. All
selected RED runs and the unmatched file-level envelope remain under
`test-results/gin-counterfactual-source-20261024/`. Syntax passed for the
three new CJS files; scoped cached ESLint passed twelve rules with zero
issues. The content-only freshness gate passed all 27 manifest documents.
No application build, old 84-test rerun or real Docker fixture was used.

**Provenance / completeness:** This ledger is reconciled with this
objective's retained preparation/test logs, including initial wrong-cause
and unmatched-selection results. The unmatched selection is explicitly
dismissed as causal evidence. It is not a reconstruction of unretained
historical native errors or the earlier full conversation.

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
