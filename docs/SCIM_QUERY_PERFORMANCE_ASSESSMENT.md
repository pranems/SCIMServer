# SCIM Query Candidate-Materialization Performance Assessment

**Status:** Measured local baseline - no correctness blocker
**Last verified:** 2026-09-29
**Source:** `7332fdbcc70762a8f5ace4c5a63c67b00582eb87`

## Question and outcome

P6b corrected filtering, typed comparison, sorting, totals, and pagination by
evaluating residual predicates over the complete candidate set before applying
the requested page. The open question was cost: functional GREEN did not prove
that materializing candidates was cheap.

The benchmark confirms the expected scaling boundary. On 50,000 custom Device
resources, indexed `displayName` equality returned one database row. A numeric
custom-payload predicate selecting only 10 rows required all 50,000 rows to be
read, transferred, converted to internal resources, and filtered before a
five-row page could be returned.

## Reproducible method

The owned runner:

1. requires the consolidation branch and a clean API tree;
2. starts PostgreSQL 17 in a loopback-only, tmpfs-backed, labeled disposable
   container;
3. verifies database identity and ownership;
4. replays all 22 migrations;
5. inserts 50,000 Device rows with `cost` values 0 through 49,999;
6. records PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, transferred
   rows/bytes, fetch latency, service candidate callbacks, result selectivity,
   page size, service latency, and process high-water RSS;
7. removes the exact container ID and verifies its absence.

PostgreSQL fetches use two warmups plus nine measured samples. Service paging
uses three warmups plus fifteen measured samples. These local timings
characterize this machine; they are a baseline, not a deployment SLO.

## Results

| Metric | Indexed equality | Residual numeric filter |
|---|---:|---:|
| Dataset rows | 50,000 | 50,000 |
| Matching rows | 1 | 10 |
| Returned page | 1 | 5 |
| Rows transferred from PostgreSQL | 1 | 50,000 |
| Serialized transferred data | negligible | 20,077,781 bytes |
| PostgreSQL plan | Index Scan + Sort | Seq Scan + Sort + Gather Merge |
| PostgreSQL execution time | 0.205 ms | 63.025 ms |
| Fetch p50 / p95 | 2.190 / 2.535 ms | 401.049 / 478.801 ms |
| Service candidate callbacks | 1 | 50,000 |
| Service page p50 / p95 | 0.011 / 0.046 ms | 23.203 / 36.231 ms |
| Selectivity | 100% | 0.02% |
| Materialization ratio | 1x | 50,000x |
| Process max RSS before / after residual paging | n/a | 433,500 / 433,996 KiB |

## Disposition

The behavior is correct and bounded by the endpoint's resource cardinality,
but residual query cost scales with candidate count rather than requested page
size or result selectivity. Page-size caps do not mitigate database transfer
or service filtering work.

No speculative optimizer is added to this correctness consolidation. Safely
pushing schema-resolved JSONB predicates requires its own behavioral change:
it must preserve case rules, typed comparison, missing/null semantics,
valuePath behavior, total result counts, and parity across PostgreSQL and
InMemory. The measured baseline makes that future change testable without
mixing it into the current rollback unit.

Operationally, large endpoints should prefer filters on promoted queryable
columns until JSONB residual pushdown is separately designed and reviewed.

Structured evidence:
[validation.json](evidence/scim-performance-20260929/validation.json).

**Assurance improvement: applied.** Performance evidence now records candidate
cardinality, selectivity, transferred rows/bytes, database work, latency, and
memory rather than inferring cost from correctness tests.
**Design/architecture disposition: accepted.** Keeping residual evaluation in
the shared read planner is cohesive. A partial JSONB optimizer without a full
semantic contract would be riskier than the measured current trade-off.
