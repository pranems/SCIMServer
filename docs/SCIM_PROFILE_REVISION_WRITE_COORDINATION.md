# Endpoint Profile Revision and Resource Write Coordination

> **Status:** Legacy-profile correction merged for v0.55.48; deployment blocked
> **Last verified:** 2026-10-14
> **Product version:** `0.55.48`

## Problem

**Recovery evidence, not deployed proof:** The later isolated serial Prisma
diagnostic passes all 118 suites and 2,492 tests with zero skips in
1,417.31 seconds. Both pipeline owners now use the exercised quiet-console
configuration. Failure stacks and exit 1 remain visible in a negative control;
test assertions, reporters, and timeouts are unchanged. The earlier timeout's
sole cause remains unproven, and a complete authoritative merged-master
deployment run is still required. The parent holds the shared gallery lease
until explicit return; local recovery does not authorize live mutation.

A resource request resolves an endpoint profile before it validates the
candidate. Previously, the profile could change after that validation and
before repository mutation. The late write could then return success even
though it had been evaluated with obsolete schema characteristics or settings.

This is separate from resource ETags. An `If-Match` token coordinates two
writes to one resource. The profile revision coordinates a resource write with
an endpoint-profile update.

## Commit boundary

```mermaid
sequenceDiagram
    participant C as "SCIM request"
    participant V as "Validation"
    participant R as "Resource repository"
    participant E as "Endpoint profile update"
    C->>V: "Resolve profile P1 and validate candidate"
    V->>R: "Write with expected revision hash(P1)"
    alt "Resource write obtains endpoint lock first"
        R->>R: "Confirm persisted revision is P1"
        R->>R: "Commit resource mutation"
        E->>E: "Wait, then commit P2"
    else "Profile update commits P2 first"
        E->>E: "Commit profile P2"
        R->>R: "Observe P2 and reject stale write"
        R-->>C: "409 PROFILE_REVISION_CHANGED"
    end
```

The request context captures a SHA-256 content revision of the persisted
profile, before runtime normalization. The service clones the persisted JSON
before removing caches or migrating deprecated settings. Its internal
`getEndpointForRequest()` method returns the normalized endpoint response
and the original revision from the same resolved cache snapshot. Users,
Groups, custom resources, Bulk, discovery, and `/Me` explicitly use that
revision. It is not added to public endpoint responses.

Hashing the normalized view is incorrect for an older persisted profile:
renaming or dropping a deprecated setting changes the hash without a
concurrent edit. The repository must continue hashing persisted content,
not ignore legacy keys or bypass comparison. Object keys are canonicalized recursively, so equivalent JSON object
ordering does not create a false conflict. Arrays remain ordered because schema
and ResourceType array order is part of the persisted profile representation.

### PostgreSQL

Resource mutations and profile updates use the same endpoint-scoped
transaction advisory lock. A resource transaction acquires the lock, reads the
current endpoint profile, compares its content revision, and only then mutates
the resource. This ordering prevents a profile update from committing between
the revision comparison and the resource write.

The existing uniqueness transaction remains authoritative. Profile locking is
added before the resource-type uniqueness lock, giving one consistent lock
order. No schema migration or second transaction framework is introduced.

### InMemory

The existing endpoint write guard now tracks the current profile revision as
well as deletion tombstones. Endpoint cache publication records the new
revision synchronously. User, Group aggregate, and custom-resource repositories
compare the expected revision immediately before publishing their map
mutation.

## Public failure contract

A stale resource mutation returns HTTP 409 with no misleading SCIM
`uniqueness` or `mutability` classification:

```json
{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:Error"
  ],
  "status": "409",
  "detail": "Endpoint profile changed while the resource write was in progress. Read the current endpoint schema and retry.",
  "urn:scimserver:api:messages:2.0:Diagnostics": {
    "errorCode": "PROFILE_REVISION_CHANGED",
    "triggeredBy": "configuration"
  }
}
```

The rejected operation publishes no resource, scalar update, member
replacement, deletion, version increment, or success event. The client must
read current discovery/profile state, rebuild the request deliberately, and
retry. The server does not reinterpret or silently retry a stale candidate.

## Coverage and evidence

### Release consolidation receipt

The configured Validate-mode pre-push passes all 23 gates, including
6,035 API units, 2,432 InMemory E2E passes with four PostgreSQL-only
exclusions, and 1,591 web tests. These whole-suite results supplement, rather
than replace, the focused PostgreSQL, negative-control, and built-live proof.
The read-only consolidation review found no significant issues in raw revision
capture, atomic snapshot forwarding, genuine-edit guards, or existing-endpoint
cleanup safety.

CI lockfile workflow run `38503638725`, source `d4e368b3`, generated the
v0.55.48 lockfiles. All 684 API and 395 web dependency entries are unchanged;
only root release versions differ. Every resolved host remains public npm
and every integrity value remains SHA-512. No package upgrade, local lock
regeneration, or quarantine exception occurred. Exact-tip CI passed and PR #215 merged normally at `99cdeda3`.
The direct Prisma scheduling follow-up merged normally through PR #217 at
`f96f31b5`. Immutable publication and deployed proof remain blocked.

Both authoritative no-skip pipeline attempts failed direct Prisma E2E
bootstrap hooks. Serial execution reduced the second result to six failed
suites, 2,348 passes, 140 failures, and four skips, but did not produce GREEN.
The second process terminated with exit -1 during the six-mode matrix.
Confirmed partial matrix evidence is 6,035 units per backend and 2,488
InMemory E2E passes with four PostgreSQL-only exclusions. Neither attempt
reached image publication or dev deployment.

The original dev reference was explicitly selected, using its enabled bearer
method and profile-conforming User and Group fixtures. Both POSTs reproduce
409 on v0.55.47. Read-only PostgreSQL transactions before and after verify
that the retired persisted setting remains present and the raw revision is
unchanged. The minimal generic helper lacks the required User `displayName`
for this particular profile, so the direct reference probe supplies it rather
than weakening or rewriting the profile. This is before-deployment evidence,
not proof that the correction is running.

The remaining blocker is complete Prisma-bootstrap diagnosis and successful
authoritative execution. Current-release live/gallery/browser proof and
after-deployment latency comparison have not run. The old 266-browser and
33-gallery receipts remain prior-release evidence. No production promotion
or operator visual verification is claimed.

| Boundary | Outcome |
|---|---|
| User, Group, and custom create | Controlled pause after validation; profile change wins; each stale create returns 409 and publishes no row |
| User, Group aggregate, and custom replace | Same interleaving; original row, payload, members, version, and timestamp remain unchanged |
| User, Group, and custom delete | Same interleaving; target remains readable and stored |
| InMemory | 9/9 controlled HTTP races pass |
| PostgreSQL 17.8 | 9/9 controlled HTTP races pass after all 22 migrations |
| Optional omitted `schemaExtensions` | Endpoint discovery publishes `[]`; custom POST, GET, PUT, PATCH, DELETE pass; malformed explicit containers still return 400 |
| Affected units | 10 suites / 611 tests pass |
| Combined guarded HTTP lane | 571/571 per backend, zero failed or pending |
| Built runtime | P7b 153 cases / 905 assertions and P7a 472 assertions per backend |

The guarded run used working-tree source fingerprint
`499e06389e887394d3f427ab43b7d232f48272452b718ed594476a35dd88c39c`.
The disposable PostgreSQL container and both exact owned API processes were
removed. See the
[validation receipt](evidence/scim-profile-revision-20260929/validation.json).

## Scope

### Legacy-profile regression evidence, 2026-10-14

The service regression first failed because reading a legacy profile mutated
the supplied persisted object. The corrected service preserves the raw object
and pairs its revision with the normalized runtime view. Nine focused unit
suites pass 281 tests, including a controller assertion on the actual
forwarded revision value.

The owned PostgreSQL database `scim_profile_revision_20261014` contains raw
legacy fixtures, introduced directly into test storage because the public
admin API correctly rejects retired setting names. Users, Groups, and Devices
each pass POST, PUT, PATCH, GET, and DELETE without rewriting that profile.
The same suite passes normalized-profile CRUD in InMemory. Both backends pass
all nine genuine concurrent-edit rejection cases: **12/12 per backend,
zero skips**.

A negative control deliberately restored hashing the normalized request
profile. All three PostgreSQL legacy CRUD cases then failed with expected
201 versus actual 409. After restoring the persisted snapshot revision,
the complete PostgreSQL suite passed 12/12 again. The nine selector-filtered
cases in that negative-control run are not missing final matrix evidence.
This evidence is local, not a deployed reference-endpoint or complete
deployment-pipeline result.

The permanent `9z-DP` section in `scripts/live-test.ps1` now exercises User,
Group, and Device CRUD with response-key allowlists and exact cleanup.
Its first built-runtime smoke passes **24/24 per backend**. A separate
raw-legacy endpoint in the isolated PostgreSQL database passes **17/17**
User/Group live checks, including equality of the raw persisted revision
before and after writes. The helper accepts `ExistingEndpointId` for an
explicit reference-endpoint proof without changing that endpoint's profile;
it owns and removes only its temporary resources. It has not completed a
GREEN correction run against the deployed dev reference endpoint. The
pre-deployment profile-conforming direct probe is recorded above.

This change does not alter client resource ETag policy, profile merge policy,
schema declarations, endpoint defaults, database schema, release metadata, or
live data. It does not make a multi-operation Bulk request globally atomic;
each embedded resource mutation is coordinated at its own commit boundary.

**Test/gate improvement: applied.** Presence-level concurrency tests are
insufficient. The permanent tests pause the actual repository call after
validation and assert both the public error and complete stored non-mutation.

**Design/architecture disposition: applied.** One small content-revision
utility and the existing repository transaction/write-guard seams serve three
resource implementations. A new universal repository, policy DSL, or
standalone lock service would duplicate established boundaries.
