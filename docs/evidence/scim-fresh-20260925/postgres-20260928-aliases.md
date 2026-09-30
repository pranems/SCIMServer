# Bulk, /Me, and discovery: five additional database cases

> **Last verified:** 2026-09-28
>
> **Source:** `ccde1d5d6b5129dd943c6e848989c668a0d00d7a`
>
> Additive evidence only. The original 77 cases, their results, and their artifact counts are unchanged.

## Plain-language result

Four of the five new cases pass on **both** PostgreSQL and InMemory:

* A successful User update through Bulk stores the same values as a direct
  User PATCH.
* A failed PATCH inside Bulk leaves that User unchanged. Another independent
  operation in the same Bulk request can still succeed.
* `/Me`, using a locally minted synthetic OAuth token, reads and updates the
  same User as the direct User route.
* Discovery reflects schema, ResourceType, and capability changes. Turning
  endpoint discovery off hides all three discovery routes; turning it back on
  restores them with the changed schema.

The remaining case exposes a real route inconsistency:

**When `patch.supported` is false, direct User PATCH returns 501 and does not
write, but the same PATCH through Bulk returns embedded status `"200"` and
changes the stored User.** This occurs on both backends.

No alias was unavailable in this run. Each case includes direct-route or
discovery positive controls rather than assuming that an alias works.

## Exact evidence IDs

| ID | PostgreSQL | InMemory | What was actually checked |
|---|---|---|---|
| `ALIAS-BULK-SUCCESS` | Pass | Pass | Direct and Bulk PATCH, GET readback, actual stored extension/active values, one version increment, Bulk version matches GET ETag |
| `ALIAS-BULK-ATOMICITY` | Pass | Pass | Direct 400/noTarget control; Bulk HTTP 200 with embedded statuses `"400"` and `"200"`; failed target payload/version/ETag unchanged; second User updated |
| `ALIAS-BULK-DISABLED` | Behavior failure | Behavior failure | Discovery says PATCH false/Bulk true; direct PATCH blocked with 501; embedded PATCH succeeds and persists the prohibited change |
| `ALIAS-ME-USER` | Pass | Pass | Real local OAuth helper, direct GET control, matching User ID, mutations in both directions, common ETag, persisted final value/version; shared-secret `/Me` returns 404 |
| `ALIAS-DISCOVERY-REFLECTION` | Pass | Pass | Schemas/ResourceTypes/SPC before and after admin change; new attribute/schema/type visible, changed capability/settings reflected, new custom route accepts a resource, hide/restore discovery works |

Bulk atomicity is **per embedded PATCH**, not a transaction around the entire
Bulk envelope. The successful second operation is expected to commit. The test
does not require the whole Bulk request to roll back.

## Counts

### New run only

| Backend | Cases | Passed | Behavior failed | Setup failures | Checks passed / failed |
|---|---:|---:|---:|---:|---:|
| PostgreSQL | 5 | 4 | 1 | **0** | 54 / 3 |
| InMemory | 5 | 4 | 1 | **0** | 54 / 3 |

### Deduplicated combined evidence

The old 77-case set plus these five distinct IDs gives **82 unique cases per
backend**, **164 case executions**, and **771 checks**.

| Backend | Cases | Passed | Behavior failed | Not applicable | Setup failures |
|---|---:|---:|---:|---:|---:|
| PostgreSQL | 82 | 28 | 54 | 0 | **0** |
| InMemory | 82 | 27 | 54 | 1 | **0** |

No original case was rerun or counted twice. The original summaries remain at
77. The expanded totals live in new files:

* [New PostgreSQL observations](postgres-20260928-aliases.prisma.json)
* [New InMemory observations](postgres-20260928-aliases.inmemory.json)
* [New run summary and ownership receipt](postgres-20260928-aliases.summary.json)
* [Combined unique-ID summary](postgres-20260928-expanded.summary.json)
* [Combined 82-row case table](postgres-20260928-expanded.cases.csv)
* [Validation receipt](postgres-20260928-aliases.validation.json)

## Database, authentication, and cleanup safety

The unchanged safe orchestrator created its own container:

* Name: `scim-fresh-pg-e1a910bb0ce3cc16`
* Exact ID: `e5fb2241d170769d22d0211e5bc77a6bde13f45a15e96c751946ded6a17bf9ea`
* Binding: `127.0.0.1:49300`
* Database: `scim_fresh_e1a910bb0ce3cc16`
* Actual server: **PostgreSQL 17.8**
* Storage: tmpfs, no persistent volume or bind mount

Ownership labels, container identity, loopback port, database identity, empty
schema, and task marker were verified before replay and testing. All **22
migrations** completed on the empty database; [replay output](postgres-20260928-aliases.migration-e1a910bb0ce3cc16.txt)
is retained. Extensions were verified as citext, pg_trgm, pgcrypto, uuid-ossp,
and plpgsql.

The random database password remained in memory and child-process environment.
No customer/live database, token, account, or estate was used.

The `/Me` test calls the existing `getAuthToken` helper against the local test
app, using the existing synthetic E2E client. It creates a synthetic User whose
userName matches that local OAuth subject. Authentication and User storage are
not mocked. The helper's trace callback is wrapped only to redact the synthetic
client secret and issued token **before trace persistence**; no token value is
saved in the evidence.

The container was removed by the exact ID above after results were saved.
The global E2E teardown that can delete database tables was not run. Temporary
API tooling and generated client files were cleaned after validation.

## Reproducibility and preservation

See [exact reproduction instructions](repro-postgres/ALIASES.md).
The five cases are implemented in [alias-cases.cjs](repro-postgres/alias-cases.cjs)
and registered through the existing safe dual-backend corpus.

The original 77 case bodies are unchanged. Removing only the additive
registration block from the current corpus file reproduces its previous SHA-256:
`9ce04d6dbbaf8715000823ad50bbb85bdaf618674df16da748c54c40a01a2cc2`.
All original `postgres-20260928.*` evidence files were byte-hash checked before
and after publishing this addendum.

The old full-file harness hashes are historical snapshots. The current file
has an additional registration block, so its full-file hash naturally differs;
this does not rewrite the old evidence or claim the original run executed the
new cases.

## Remaining limits

* Bulk Group/custom operations, forward/cyclic `bulkId` resolution, and
  `failOnErrors` thresholds above zero remain outside these five cases.
* `/Me` PUT/DELETE, other token classes, missing/unrelated subjects, and the
  full authorization matrix were not added.
* Discovery reflection was checked through one local app per backend. It does
  **not** close the earlier two-service cache-staleness finding or prove
  distributed invalidation.
* This is not an exhaustive set of alias/schema/settings permutations or a
  full conformance certification.
* The disabled-PATCH-through-Bulk behavior remains unfixed.

**Assurance disposition:** the new cases close specific alias/discovery evidence
gaps and preserve the original dataset. The capability mismatch now has a direct
control, an alias response, and persisted-state proof. No new abstraction or
production fix was introduced; parent-owned report, Session, and INDEX were not
edited.
