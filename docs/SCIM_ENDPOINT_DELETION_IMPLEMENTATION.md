# Endpoint deletion: owned data, audit history and late writes

> **Last verified:** 2026-09-29
>
> **Status:** P8b implemented and validated locally; not deployed.
>
> **Base:** Reviewed P8a `39841319`; product remains `0.55.35`.
>
> **Related:** [Design and progress](SCIM_CORRECTNESS_DESIGN_AND_IMPLEMENTATION.md),
> [P8a freshness](SCIM_ENDPOINT_FRESHNESS_IMPLEMENTATION.md),
> [execution issues](SCIM_CORRECTNESS_EXECUTION_ISSUES_AND_RCA.md).

## 1. What changes for an operator

Deleting an endpoint removes its provisioning data, not its audit history.
Previously InMemory removed the endpoint from its cache but left the resource
and credential repositories populated. A later GET returned 404, which hid
the retained rows from an HTTP-only check.

Both backends now remove the endpoint's Users, Groups, Group memberships,
every custom resource type and every credential. A successful response is
`204 No Content`, with no response fields. Other endpoints remain intact.
Reusing the deleted endpoint's name creates a new identity with empty stores.

| State | Deletion behavior |
|---|---|
| Users, active or inactive | Removed |
| Groups, including nested Group relationships | Groups and their membership rows removed |
| Custom resources | Removed regardless of whether the type remains registered in the profile |
| Bearer and OAuth credentials | Active, revoked and expired rows removed, including stored envelopes |
| WIF trusts | Removed with the other credentials |
| Endpoint profile and schema characteristics cache | Evicted from the local endpoint cache |
| Endpoint logging overrides and file transport | Cleared/disabled; existing files are not erased |
| Local WIF credential cache | Invalidated on deletion, including when a PostgreSQL reader observes remote deletion |
| RequestLog | Retained with the old endpointId; buffered and later audit records can still be stored |
| Global credential encryption keys, server settings and JWKS allowlist | Not endpoint-owned; unchanged |

Endpoint administration is a server management API, not SCIM resource DELETE.
RFC 7644 section 3.6 governs SCIM resource deletion; this package defines the
application's enclosing endpoint ownership contract. It introduces no new
protocol, endpoint, payload or database migration.

## 2. The storage boundary

```mermaid
flowchart TB
    API["Endpoint DELETE controller"] --> S["EndpointService"]
    S --> PORT["Required endpoint lifecycle repository port"]
    PORT --> PG["PostgreSQL: one endpoint DELETE"]
    PG --> FK["Existing FK cascades resources, memberships and credentials"]
    PORT --> MEM["InMemory: prepare replacement maps"]
    MEM --> COMMIT["Synchronous swaps with rollback"]
    COMMIT --> BARRIER["Remember deleted ID for late-write rejection"]
    S --> CACHE["After successful persistence: evict profile and logging state"]
    CACHE --> EVENT["Existing endpoint-deleted event invalidates WIF cache"]
    AUDIT["RequestLog: independent audit correlation store"]
```

`IEndpointLifecycleRepository` is a narrow deletion port. `RepositoryModule`
binds it to the selected backend and `EndpointModule` explicitly imports that
module. The dependency is required: absent wiring fails application assembly
rather than silently skipping cleanup.

The existing InMemory repositories each own separate maps. No shared
InMemoryDatabase exists, and this change does not introduce one.

| Option considered | Decision |
|---|---|
| Await each repository's ordinary delete method | Rejected: another request can run between destructive stages, and failure leaves partial deletion |
| Move all repositories into a shared database or generalized UnitOfWork | Rejected: unnecessary ownership migration and broad overlap with the other correctness packages |
| Endpoint-specific synchronous preparation and reversible map swaps | Selected: preserves repository ownership, has no await inside commit/rollback, and can be fault-injected at each participant |

Each repository prepares a replacement map without mutating the live map.
The lifecycle adapter prepares all participants before applying any change.
If a commit throws, it restores the applied participants in reverse order,
including the participant that threw after its swap. The endpoint cache is
not evicted, no deletion event is published, and subsequent writes still work.
This guarantee covers ordinary preparation/commit failures, not process death
or unrecoverable memory exhaustion.

Preparation scans the InMemory stores and temporarily holds replacement maps.
This costs O(total stored rows) time and additional map storage during deletion,
in exchange for deterministic rollback without restoring partially modified
maps. It is a lightweight-backend trade-off, not a PostgreSQL performance change.

PostgreSQL still owns its transaction semantics: one endpoint delete cascades
through existing foreign keys. RequestLog intentionally has no endpoint FK.
The guarded test injects a database trigger error on credential deletion and
verifies that all earlier cascade effects roll back.

## 3. A request that was already running

```mermaid
sequenceDiagram
    participant W as In-flight request
    participant E as Endpoint deletion
    participant R as Resource repository
    W->>W: Resolve endpoint and build write input
    E->>R: Delete owned data atomically
    R-->>E: Commit and close write boundary
    E-->>E: Evict local derived state
    W->>R: Attempt previously prepared write
    R-->>W: Reject, endpoint or parent no longer exists
    Note over W,R: No resource or membership is recreated
```

InMemory create and credential-rotation paths check the shared deletion
barrier immediately before writing, with no intervening await. Existing
updates already require the row to exist. Membership insertion now requires
its parent Group to exist, closing the yield inside `updateGroupWithMembers`.
No User, Group or generic-resource update signature changes.

The barrier retains deleted UUIDs for the process lifetime. Its space cost is
one identifier per deleted endpoint. Expiring them would reopen the race for
an arbitrarily delayed request. It is deliberately a deletion barrier, not a
complete emulator of all PostgreSQL foreign keys: standalone repository
fixtures can still use previously unseen endpoint IDs. Production creates
resolve the endpoint before entering these repositories.

In particular, these cleanup tests do **not** prove shared-storage User-FK
semantics. The native PostgreSQL User-FK control is not applicable to the
independent InMemory User and Group repositories. Parent Group existence and
endpoint deletion barriers are the specific InMemory guarantees tested here.

Already-returned snapshots and in-flight authorization work are not cancelled.
The guarantee is that a write after deletion cannot repopulate owned storage.
The paused HTTP probe verifies rejection and exact counts, not a universal
status code: existing FK error translation can differ from InMemory
`NOT_FOUND` in this concurrent-deletion case. Error normalization is separate.

## 4. Evidence

The fixture seeds **each** of two endpoints with one User, two Groups, three
membership rows (User, nested Group and external reference), two custom
resource types and four credentials (active bearer, revoked OAuth, WIF and
expired bearer). It checks raw membership storage by the original Group IDs,
so missing parents cannot hide orphan members.

| Evidence | Result |
|---|---|
| Original TDD RED | Expected all counts zero; observed User 1, Group 1, custom 1, credentials 3 |
| Focused unit/controller matrix | 277 passed across 11 suites, including required-provider assembly failure |
| InMemory rollback | Fault after each of four participants' commits, plus preparation failure; all rows and endpoint preserved |
| Late-write boundary | Every owned insert, credential rotation, paused Group member update and paused User HTTP create reject without leftover rows |
| Both-backend HTTP | 6 new deletion cases plus 18 preserved P8a/profile cases passed per backend |
| PostgreSQL | Task-owned PostgreSQL 17.8; 22 migrations replayed; real FK cascade failure rolled back |
| Remote credential-cache RED/GREEN | Warmed reader retained one WIF trust after 404; deletion observation now invalidates it |
| Live built Node runtimes | 10 deletion checks and 7 P8a freshness checks per backend; PostgreSQL freshness used two processes |
| API static gates | Build passes; full lint has 0 errors and 527 existing warnings; new tests lint clean |
| Documentation | Content and coupled freshness gates pass for all 26 manifest docs; diagrams render in both strict themes |
| Scope | No dependency/lockfile/product-version change, shared database, deployment or push |

Permanent evidence:

* [Service/storage tests](../api/src/modules/endpoint/services/endpoint-deletion.spec.ts).
* [Shared exact-count fixture](../api/test/helpers/endpoint-deletion.fixture.ts).
* [HTTP tests](../api/test/e2e/endpoint-deletion.e2e-spec.ts).
* [Live helper](../scripts/test-scim-endpoint-deletion.ps1), integrated into
  [live-test.ps1](../scripts/live-test.ps1) as `9z-CT`. P8a keeps `9z-CR`;
  sibling P8c reserves `9z-CS`.

The live helper creates and cleans up only its own UUID-named endpoints.
It proves public behavior; it does **not** claim that HTTP 404 proves physical
storage cleanup. The independent storage assertions above make that claim.

Ignored receipts, source identities, migration results and logs are under
`test-results/p8b/`. The reviewed P8a runner was copied there as task-owned
tooling. Database checks verify owner/run labels, loopback-only port mapping,
ephemeral storage, database/cluster identity and all 22 migrations. Cleanup
removes and verifies the exact owned container ID, never a name wildcard.

Ordinary PostgreSQL E2E runs use a nondestructive mocked delete failure.
Only an explicitly guarded `PG_ANALYSIS_RUN` database receives the trigger
fault. Both invocation paths are tested; task-only prerequisites do not break
the ordinary E2E entry point.

Documentation gates passed for 26 manifest documents; 17 diagrams in the
touched feature/architecture guides rendered in both strict themes. The
editor detector still reports the existing Mermaid version placeholder
`0.0.0`; browser rendering used pinned `11.15.0`. Exact editor-version parity
is not claimed, and no dependency was changed to that placeholder.

## 5. Review and remaining boundaries

Independent review found no production blocker. It identified a test-harness
compatibility issue: requiring task-only database variables in ordinary
PostgreSQL E2E runs. That requirement is now confined to the real-trigger path,
with a normal-entry-point run on another owned database.
The follow-up independent review reported no significant issues.

**Test/gate improvement: applied.** Exact raw counts, late-write barriers,
per-stage rollback and remote cache invalidation now have regression checks.
The live fixture explicitly enables the credential methods it creates.

**Design/architecture disposition: accepted.** The deletion adapter is cohesive
and small; it does not turn the already-large EndpointService into a storage
coordinator. Two real backend implementations justify the port. A generalized
transaction abstraction or all-store migration would add unnecessary scope.

P8c conditional endpoint-admin writes, P3 integration, full consolidation
gates and release/deployment remain separate. P8a's authoritative PostgreSQL
reads and fingerprint-based cache hydration remain intact.

Integration coordination: P4 Group aggregate commits `212a6b92` and
`66a7229f`, and P8c conditional endpoint-update commit `8eb2f162`, are merged
by the parent integration task, not this worktree. P8b does not import their
pending changes or change its delete scope to implement their write contracts.
