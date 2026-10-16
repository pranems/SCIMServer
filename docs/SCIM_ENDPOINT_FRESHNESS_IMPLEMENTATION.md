# Endpoint cache freshness across application instances

> **Last verified:** 2026-10-16
>
> **Status:** Freshness is deployed in 0.55.50. The derived-work optimization below is locally validated but not yet consolidated or deployed.
>
> **Related:** [Overall design and progress](SCIM_CORRECTNESS_DESIGN_AND_IMPLEMENTATION.md),
> [execution lessons](SCIM_CORRECTNESS_EXECUTION_ISSUES_AND_RCA.md).

## 1. What was wrong

With PostgreSQL, two application processes share one database but do not share
memory. Previously, each process warmed an endpoint cache at startup. A later
request could return that cached profile without checking the database.

An operator could save a setting on process A while process B continued to use
the old setting indefinitely. The same problem affected endpoint lists,
deletion visibility and the separate statistics existence check.

This was not an InMemory database synchronization failure. InMemory storage is
local to one application instance by design. Two independent InMemory instances
do not represent replicas of the same data.

## 2. The new read boundary

```mermaid
sequenceDiagram
    participant W as Writer process
    participant DB as PostgreSQL
    participant R as Reader process
    participant C as Reader cache
    W->>DB: Save endpoint profile
    DB-->>W: Commit succeeds
    R->>DB: Read authoritative endpoint row
    DB-->>R: Current row, or no row
    alt The row changed
        R->>C: Replace cached snapshot
        R->>R: Refresh schema registry and logging settings
    else The row is unchanged
        R->>C: Reuse hydrated profile
    else The row was deleted
        R->>C: Remove snapshot and derived settings
    end
    R-->>R: Continue with current endpoint, or return 404
```

The important ordering is the database commit followed by the reader's new
lookup. A read already in progress may still observe the earlier committed
snapshot. This change is not a transaction spanning an entire SCIM request, and
it does not claim to cancel in-flight requests when a setting changes.

| Entry point | PostgreSQL behavior | InMemory behavior |
|---|---|---|
| Endpoint by ID or name | Read the database before returning | Read the instance-owned endpoint |
| Endpoint list | Query current rows; unfiltered lists evict missing entries | List the instance-owned endpoints |
| Endpoint statistics | Verify existence through the same read boundary before counting | Verify the local endpoint before counting |
| Missing/deleted endpoint | Remove cached snapshot, logging overrides and schema overlay; return 404 | Return 404 |
| Database failure | Propagate the failure; do not return a stale profile as success | Not applicable |

## 3. Why the cache still exists

The cache now saves **derived work**, not the authoritative database read.
Profiles contain runtime schema indexes that should not be rebuilt every time
an unchanged endpoint is used.

The service hashes the persisted endpoint row before cloning or normalizing
its profile, excluding top-level runtime-only `_schemaCaches`. Equal
fingerprints preserve the existing hydrated object without repeating the
canonical profile revision or deep clone.
Changed fingerprints refresh the snapshot and notify the existing profile
listener. Comparing content also detects two different writes with the same
timestamp; a millisecond timestamp alone is not a reliable revision token.

Startup, creation and updates seed the same persisted fingerprint. InMemory
writes do not invent a persisted fingerprint. Deletion clears the fingerprint
alongside both cache indexes. The canonical write-coordination revision still
comes from the raw persisted profile, before legacy settings normalization.

This uses the existing endpoint service, profile listener and Prisma boundary.
It adds no message broker, distributed cache, schema migration or new
dependency. Resource repositories remain responsible for resource persistence.

Names are not editable through the endpoint PATCH API. The service test for
an externally changed database name protects against stale aliases; it does
not introduce an admin rename feature.

## 4. Performance and consistency trade-off

An unchanged cached ID lookup previously issued zero endpoint queries. It now
issues one authoritative lookup. A failed UUID lookup may additionally try the
supported name fallback. A single HTTP request can resolve an endpoint more
than once in its existing middleware/guard/controller path.

The added database work is deliberate: an indefinite stale authorization or
schema profile is not a valid performance optimization. No claim of unchanged
latency is made. A future request-scoped snapshot optimization must preserve
the same fresh-read boundary rather than reinstate a cross-request cache.

### 4.1 Locally verified derived-work correction

The 0.55.50 read-only dev comparison failed the endpoint-list relative latency
limit: p95 increased from 265.52 to 426.04 ms, or 60.45%. Tracing found that
every persistent row was canonicalized and cloned before deciding whether its
cached representation could be reused. This repeated derived work is verified;
its contribution to the complete live HTTP regression is not yet isolated.

A network-free benchmark uses the actual compiled service, 74 mocked persisted
rows cycling all six expanded built-in profiles, five warmups and 30 measured
list calls. The same fixture and runner produced:

| Measurement | Before | Local correction |
|---|---:|---:|
| Deep profile clones | 2,220 | 0 |
| Canonical revision calculations | 2,220 | 0 |
| Service CPU p50 | 33.0352 ms | 7.5805 ms |
| Service CPU p95 | 43.6404 ms | 13.3925 ms |
| Service CPU p99 | 59.1497 ms | 13.8510 ms |

These are local CPU measurements with mocked persistence, not database or
deployed HTTP latency. Each list still queries persistence. A fresh deployed
comparison remains mandatory before closing the live regression.

Four meaningful RED assertions failed before production edits: unchanged
reads after startup/create/update still cloned their profiles, and a serialized
runtime cache artifact also triggered unnecessary cloning. The corrected
service passes all 119 service cases. Seven related unit suites pass 191
cases, including cache freshness, InMemory parity, conditional writes,
deletion, controllers and entity tags. Three selected InMemory HTTP suites
pass 37 cases, including response-key allowlists and runtime-cache exclusion.
The identical three suites also pass 37 cases on a private PostgreSQL 17
database, including separate reader/writer application instances. Its exact
owned container and anonymous volume were removed and absence verified.
The API TypeScript build passes. Complete release gates,
the planned 0.55.51 version/CI-generated locks, and deployment remain pending.

### 4.2 Execution issues and prevention

| ID | Type / severity | Symptom and root cause | Resolution and why it works | Detection / earliest gate |
|---|---|---|---|---|
| EC-I01 | Performance / High | An unchanged row incurred a deep clone and sorted canonical hash before cache admission. The cache avoided hydration but not expensive conversion. | Compare raw persisted fingerprints first, then convert only changed rows. Four RED cases now pass and the representative workload records zero repeat clones/revisions. Commit pending. | Live latency comparison / a warmed service work-count regression could have caught this before deployment. |
| EC-I02 | Test correctness / Low | Initial new tests counted setup repository calls and expected a disabled setting in `activeSettings`, which intentionally omits disabled values. | Clear query mocks after arrangement and inspect the full profile for the disabled value. Reconfirmed four intended RED failures before production edits; the snapshot case now passes without changing runtime semantics. | Focused RED / focused RED; no escape. |
| EC-I03 | Tooling / Low | The editor test runner discovered no tests in the separately owned worktree. | Run the existing Jest command from that worktree with explicit test paths. No dependency installation or alternate-checkout access. | Test discovery / test discovery; no escape. |
| EC-I04 | Documentation / Low | The version-freshness update touched a guide containing seven pre-existing single-line JSON envelopes. All parsed, but they violated the readability rule. | Pretty-printed those seven examples; all 174 literal JSON blocks in changed documentation parse, with no single-line envelopes remaining. No payload values changed. | Pre-commit documentation check / the same check; no escape. |
| EC-I05 | Tooling / Low | A batched documentation patch updated the README badge before a stale INDEX header context stopped later hunks. The freshness tool had already updated that INDEX header. | Kept the successful badge edit and applied only the remaining RCA hunk. Do not retry an entire partially applied patch or assume every header transformation is identical. | Patch context check / patch context check; no escape. |

Self-improvement **applied**: warmed startup/create/update regressions assert
zero deep clones and canonical revisions as well as authoritative repository
reads and output values. Presence or HTTP 200 alone cannot prove this repair.
Architecture disposition **accepted**: the existing service is a large-file
candidate, but this change adds no responsibility or dependency and reuses its
existing fingerprint map. Splitting it here would be a separate refactor.

Provenance: these entries were captured when focused tests and the local
benchmark turned green. Full continuation-transcript reconciliation is still
pending at release consolidation; unavailable deleted history is not claimed.

The live helper measured 30 successful, sequential admin reads after warmup:

| Local runtime | p50 | p95 | p99 |
|---|---:|---:|---:|
| InMemory, one built Node process | 8.81 ms | 14.47 ms | 27.05 ms |
| PostgreSQL 17.8, two built Node processes sharing one owned database | 13.85 ms | 18.21 ms | 36.05 ms |

These are whole-request observations on a shared development machine, not a
load test or a before/after PostgreSQL benchmark. They must not be used as a
production latency promise. The query-count regression test separately proves
that two unchanged endpoint resolutions perform two authoritative reads while
avoiding repeated registry hydration.

## 5. Tests and reproduction

| Evidence | Result |
|---|---|
| Baseline cache cases | Six behavior failures before the freshness fix |
| Separate statistics regression | Returned statistics instead of 404 before its fix |
| Focused unit tests | 163/163 passed across five service, InMemory, controller and endpoint ETag suites |
| Endpoint profile and freshness HTTP tests | 18/18 on each backend |
| PostgreSQL HTTP setup | Two independent Nest application instances |
| Built-runtime live checks | 7/7 on InMemory; 7/7 across two PostgreSQL-backed Node processes |
| Database replay | 22/22 migrations on task-owned PostgreSQL 17.8 |
| Database cleanup | Exact owned containers removed after each run |
| API build and targeted lint | Build passed; 0 lint errors and 19 unchanged production warnings; new tests clean |
| Documentation | Content and coupled freshness passed; 11 diagrams in touched guides rendered in both strict themes |
| Independent review | No significant issues found in the production and regression-test changes |

The permanent tests are
[service freshness](../api/src/modules/endpoint/services/endpoint-cache-freshness.spec.ts),
[existing endpoint contracts](../api/src/modules/endpoint/services/endpoint.service.spec.ts),
and [HTTP freshness](../api/test/e2e/endpoint-cache-freshness.e2e-spec.ts).
The HTTP suite uses a separate token per application because its temporary
OAuth keys are intentionally independent.

The [live helper](../scripts/test-scim-endpoint-freshness.ps1) is also invoked
from section `9z-CR` of [the main live runner](../scripts/live-test.ps1). It
creates and deletes only its own endpoint. For a two-replica check, pass two
addresses that really target different processes sharing the same PostgreSQL
database:

```powershell
.\scripts\test-scim-endpoint-freshness.ps1 `
  -BaseUrl $WriterBaseUrl `
  -Token $WriterToken `
  -ReaderBaseUrl $ReaderBaseUrl `
  -ReaderToken $ReaderToken
```

Omitting the reader arguments checks one runtime. That is useful for regression
testing, but it is not evidence of cross-process consistency.

Ignored local artifacts are under `test-results/p8/`, including the migration
receipt, focused test logs, two-process live output and build/lint output.
Historical investigation evidence remains unchanged.
The existing renderer detector reports a placeholder editor Mermaid version
of `0.0.0`; actual browser rendering used the pinned 11.15.0. Exact editor
version parity is not claimed and no dependency was changed to that placeholder.

## 6. Boundaries and next steps

* This package fixes endpoint read freshness, not resource PATCH semantics.
* It does not make endpoint read-check-write updates atomic; conditional admin
  writes require their own persistence-boundary treatment.
* P8a did not clean up orphaned InMemory resources after endpoint deletion.
  The separate [P8b repository-lifecycle package](SCIM_ENDPOINT_DELETION_IMPLEMENTATION.md)
  now implements that cleanup and invalidates local WIF cache entries when a
  reader observes remote deletion, without removing the authoritative read.
* It does not turn independent InMemory instances into a replicated backend.
* Consolidation still owns release metadata, the complete applicable matrix,
  reviewed PR and exact-tip CI. This local evidence is not a deployment claim.

**Test/gate improvement: applied.** Added two-reader HTTP and two-process live
checks plus a separate statistics regression. A same-instance test alone could
not detect this defect.

**Design disposition: accepted.** The existing endpoint service already owns
endpoint snapshots and listener notification. The new helpers keep that
responsibility together. The file is already large; creating an abstraction
with only one use would not itself improve the persistence contract.
