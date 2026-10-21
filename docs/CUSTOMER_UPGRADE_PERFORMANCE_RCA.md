# Why 0.55.56 is slower than customer production 0.55.20

**Last verified:** 2026-10-20

**Newest local correction:** the
[ordered membership-write follow-up](ENDPOINT_SNAPSHOT_REVISION.md#15-reducing-the-final-populated-membership-write-boundary)
retains the separate scoped parent compare-and-swap, locks and fresh
post-lock reads, while reducing final populated-member storage operations
from three to two. Image `fa482c1b` full half-CPU BAAB `34ca7f2d` passes all
twelve unchanged latency limits; database calls -4.10%, application CPU
-13.39%, empty GET p99 48.879 versus 52.832 ms. Aggregate SQL execution
time is +35.89%, mainly log insertion, an explicit retained cost rather
than database CPU or a claim that every metric improved. Exact inventories,
values, logging/redaction and cleanup pass. This is local synthetic
admission only; the earlier failed images and all independent release
holds remain. No publication or deployment has occurred.

**Earlier endpoint-token measurements, 2026-10-20:** the
[endpoint revision and protected-proof report](ENDPOINT_SNAPSHOT_REVISION.md)
records the subsequent local implementation without removing freshness,
uniqueness or resource-version safeguards. Image `72d2eec3` full half-CPU
BAAB passes eleven limits and fails empty GET p99 +15.15%. Database calls
are +0.026228% and application CPU -3.834776%; this is not admission.
Actual request-id/server-duration correlation and a separate two-CPU
diagnostic show material quota/runtime sensitivity in both versions, not
permission to change production allocation or replace the failed result.
The subsequent same-kernel diagnostic correlates all 1,600 reads and
finds definite throttle-update overlap in 20/29 slow customer and 15/21
slow candidate empty reads, none in fast reads. All slow empty reads have
at least possible overlap. This narrows the investigation without proving
exact stalled durations or closing admission; section 14 retains sampling
uncertainty, observer-cost correction and the failed full result.
The original release attribution below remains historical; it is not the
current corrected source's SQL count or CPU result.

**Research follow-up, 2026-10-20:** the separate
[concurrency and cache coherence proposal](SCIM_CONCURRENCY_AND_CACHE_COHERENCE_DESIGN.md)
critically evaluates one final internal resource CAS, coherent aggregate
reads, independent uniqueness/profile fences and event-based invalidation.
It does not implement those proposals or change the measurements below.

## Executive summary

The strongest evidence identifies two interacting changes, not the UI changes
or a Prisma major-version upgrade:

1. **Fresh endpoint reads became database-backed at existing authentication
   and controller call sites.** A normal endpoint-scoped global-secret request
   now performs three full endpoint reads where the old version returned warm
   cached records.
2. **Writes acquired repository-level uniqueness and profile-revision
   coordination.** Each steady-state membership mutation adds seven SQL
   statements, including two advisory locks, a profile read, a namespace scan
   and an additional member-relation read.

Together these explain approximately 26 additional statements per four-request
membership cycle. The full common-runtime comparison measures 53,372 versus
110,614 database calls and approximately 97% more application CPU. All twelve
latency checks fail. The regression therefore remains when both application
versions use the old production Node/OpenSSL runtime.

Controlled diagnostic removal of the first family restores read medians to
within 5.01% of that campaign's baseline, but writes remain 47.73% and 55.99%
slower. Removing both families brings all four medians within 9.32% and CPU
within 3.73%. This is strong causal evidence for the two families together,
**not a deployable fix**: those counterfactuals intentionally remove freshness,
uniqueness and profile-safety behavior. Their smaller samples still contain
tail failures. Do not revert these safeguards or promote their images.

The recommended next implementation is to reduce the cost of the required
checks while preserving their guarantees, particularly the locked uniqueness
snapshot and repeated authoritative endpoint projections. The then-current safe
local prototype failed five of twelve checks and remains unreleased;
the latest corrected image's separate one-limit failure is linked above.
Customer promotion remains held.

### How to read this report

This root-cause analysis compares a specific Group-membership workload, not
every difference between the two releases. The design explanation below
focuses on the changes that execute in that workload.

| Term | Meaning in this report |
|---|---|
| Endpoint | An isolated SCIM configuration and resource namespace, not one HTTP route. |
| SCIM | System for Cross-domain Identity Management, the protocol used to provision users and groups. |
| Cache | A previously loaded copy held in one running application's memory. A warm cache already contains the record. |
| Authoritative read | A database read that checks current persisted state instead of trusting that memory copy alone. |
| Transaction | A database operation that commits its writes together or rolls them back together. |
| Advisory lock | A database-managed coordination lock. Cooperating writers must acquire the same named lock before proceeding. It is not the same as a unique database constraint. |
| Namespace | Here, one endpoint and one resource type, such as all Groups belonging to endpoint E. |
| Profile fence | A check that the endpoint rules used to validate a write are still current when it commits. |
| SQL statement / roundtrip | A database command / an application-to-database exchange. Reducing returned data does not necessarily remove either. |
| CPU | Processor time consumed by the application, not the total elapsed time a user waits. |
| p50 / p95 / p99 | The median and the 95th/99th percentile latency. A p95 of 50 ms means 95% of measured requests took no more than 50 ms. |
| Counterfactual | An isolated experiment asking what would happen if selected behavior were absent. It is not necessarily a safe implementation. |

**Status key:** "published" means the immutable 0.55.56 artifact; "local
prototype" means tested but unreleased changes; "proposed" means not
implemented or validated. All example identities and timelines below are
invented for explanation, not customer records or observed incidents.

**Figure 1 - the overall trade-off.** The goal is not to return to the older
weaknesses. It is to retain the newer guarantees while doing less unnecessary
work to establish them.

```mermaid
flowchart TB
    OLD["0.55.20: warm local endpoint cache"] --> FAST["Less repeated database work"]
    OLD --> RISK["Other instances can retain older endpoint rules"]
    NEW["Published 0.55.56: fresh reads and coordinated writes"] --> SAFE["Current rules and protected uniqueness checks"]
    NEW --> COST["Repeated profiles, locks and namespace hydration"]
    SAFE --> TARGET["Target: preserve guarantees"]
    COST --> TARGET
    TARGET --> LOCAL["Tested local prototype: less transport and repeated work"]
    LOCAL --> HOLD["Still fails 5 of 12 latency checks"]
    HOLD --> NEXT["Proposed next step: smaller correct uniqueness snapshots"]
    NEXT --> PROOF["Prove correctness and complete performance admission"]
```

Read section 2A for the earlier and published designs, section 2B for a
worked request and data transformations, section 3 for measurements, and
section 5A for the staged correction. The detailed experiment ledger is at
the end so that evidence identifiers do not interrupt the main explanation.

## 1. What was actually compared

| Item | Verified evidence |
|---|---|
| Actual customer baseline | 0.55.20, digest `sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a` |
| Exact old source | `6785200ff59ccbc12f62b795439fb245e1635480`, established by successful [publisher 33823450302](https://github.com/pranems/SCIMServer/actions/runs/33823450302), including version and full-source-SHA aliases |
| Published new source | `d43959e11e36c5607ef58323e2d520458f6cd14d`, PR #244 |
| Published new image | 0.55.56, digest `sha256:07f08b855ebe178c6a9a5b60af80d4177c267b8878c959a09e5f1a64fdc03aa2`, successful [publisher 39043579816](https://github.com/pranems/SCIMServer/actions/runs/39043579816) |
| Current reviewed documentation HEAD | `36724c49`, PR #245; runtime inputs match the published new source |
| Local safe prototype | Uncommitted and not part of the published-image RCA controls |

No local `0.55.20` tag was assumed. A later test-only commit, `f8bf981a`,
is not the source of the actual old production image.

### Runtime differences and how they were controlled

| Actual image | Node | OpenSSL | Prisma/client and adapter | pg | Nest core |
|---|---|---|---|---|---|
| Customer 0.55.20 | 24.20.0 | 3.5.7 | 7.8.0 | 8.22.0 | 11.1.27 |
| Published 0.55.56 | 24.22.0 | 3.5.8 | 7.8.0 | 8.22.0 | 11.1.27 |
| Existing safe local prototype | 24.16.0 | 3.5.6 | 7.8.0 | 8.22.0 | 11.1.27 |
| New RCA controls | 24.20.0 | 3.5.7 | 7.8.0 | 8.22.0 | 11.1.27 |

The RCA images copy the published new application bundle into the exact old
image's runtime/operating-system base. Four selected hot-path compiled-module
hashes match the published application. Actual serving-process receipts
verify the new working directory, old Node version, active treatment and
preserved `--max_old_space_size=384` flag. The old and published images
already use that same heap cap.

Fourteen potential runtime lock entries differ, including body-parser, qs and
proxy-addr. These are possible residual contributors, not separately proven
causes. Prisma, its adapter, pg and Nest core did not change. The old lockfile's
root version metadata says 0.55.17 while its application reports 0.55.20;
metadata mismatch is not evidence of performance causation.

The expanded `rfc-standard` preset is byte-identical in both actual bundles:
21,190 bytes, three schemas, SHA-256
`3a98bed831cde1f4757090c8f8f092732820801f13d0ce1875763419fe6b8437`.
A larger fixture profile does not explain the difference.

## 2. Introducing changes and affected request flow

| Change | Introducing commit | Why it matters | Attribution confidence |
|---|---|---|---|
| Authoritative cross-instance endpoint reads | [a1a62484](https://github.com/pranems/SCIMServer/commit/a1a6248477c7bcf5d19d9a89d55271b2e80863f6) | Existing warm authentication/controller lookups become full database reads and profile transport/preparation. The commit explicitly accepts additional reads for correctness. | High for this family; activated cache counterfactual removes the high-volume endpoint query and restores read medians. |
| Repository-commit schema uniqueness | [1d37e7b8](https://github.com/pranems/SCIMServer/commit/1d37e7b844f4e13da34e59d4c486c803d088bee8) | Adds namespace locking, scope scans, identity/version checks and, in the published Group path, member loading for the uniqueness snapshot. | High together with profile coordination; not separately assigned a CPU percentage. |
| Profile-revision coordination | [7332fdbc](https://github.com/pranems/SCIMServer/commit/7332fdbcc70762a8f5ace4c5a63c67b00582eb87) | Adds an endpoint-wide exclusive advisory lock, current profile read and canonical revision comparison before writes. | High together with uniqueness; their individual latency shares remain unmeasured. |
| Atomic conditional persistence | [c980e1fe](https://github.com/pranems/SCIMServer/commit/c980e1fe6dd9c1bb9101794008a6267b452ab995) | Adds conditional-write correctness. It does not by itself explain every extra statement in this no-ETag workload. | Source-supported correctness change; not independently blamed for the measured regression. |
| Atomic Group creation | [c95d0fb6](https://github.com/pranems/SCIMServer/commit/c95d0fb6f559524b7a1625621e654eee90a55cc9) | Group creation occurs during fixture setup, not each steady-state operation. | Not established as a primary steady-state cause. |
| Accepted Group member references | [9ebbd2e1](https://github.com/pranems/SCIMServer/commit/9ebbd2e1afb8d607eb9814f54ced957bb5b9be80) | Adds member data mapping/persistence, not these new read/lock roundtrips. | Not established as a primary cause. |

The following diagram explains the repeated work in the published new path.
The old version has the same authentication/controller call sites, but its
warm endpoint lookups return from cache.

```text
Endpoint-scoped request with global shared secret
  |
  +-> Endpoint-credential authenticator
  |     getEndpoint -> full database read
  |     then determines the credential method is inapplicable
  |
  +-> Global-secret authenticator
  |     getEndpoint -> independent fresh enablement read
  |
  +-> Group controller
        getEndpoint -> independent request-profile read
        |
        +-> GET: existing Group/member repository reads
        |
        +-> PATCH:
              identity/version read
              endpoint-profile advisory lock
              current profile read and revision assertion
              resource-type namespace advisory lock
              post-lock namespace resource/member snapshot
              version/uniqueness assertion
              existing atomic mutation callback
```

Source boundaries are
[endpoint resolution](../api/src/modules/endpoint/services/endpoint.service.ts),
[credential applicability](../api/src/modules/auth/authenticators/endpoint-credential.authenticator.ts),
[global-secret authorization](../api/src/modules/auth/authenticators/global-shared-secret.authenticator.ts),
[uniqueness coordination](../api/src/infrastructure/repositories/prisma/prisma-uniqueness.ts)
and [profile fencing](../api/src/infrastructure/repositories/prisma/prisma-profile-revision.ts).
Those working-tree files include the separately documented safe prototype;
the commit links above identify the introducing historical changes.

### Existing costs are not automatically newly introduced regressions

The old version already loaded Group members through separate relation
queries. Its public profile projection also stripped internal schema caches.
Optimizing those costs can help, but their existence alone does not establish
why the new version regressed. Conversely, the new uniqueness snapshot adds
another relation read; that additional occurrence is new work.

UI date/time formatting and endpoint-link styling do not execute in this
API-only workload. They are not supported explanations for these measurements.

## 2A. Earlier design, newer design, and why it changed

### Earlier design: what 0.55.20 actually did

At startup, a PostgreSQL-backed application loaded endpoints into its own
memory. A warm `getEndpoint` call returned that cached record; it did not
first ask PostgreSQL whether another application had changed it. A cache
miss could still read the database. Writes through that same application
updated its own cache.

This made repeated authentication and controller lookups inexpensive. It
also made the memory copy local to the process rather than a reliable
cross-instance view. InMemory mode has a different boundary: its state is
intentionally local, so it cannot provide a shared PostgreSQL view.

**Figure 2 - a warm 0.55.20 request.** The repeated endpoint lookups are
already present, but return from memory. A membership write still uses a
database transaction. The old design was not "no database" or "no atomicity."

```mermaid
sequenceDiagram
    participant Client
    participant Auth as Authentication chain
    participant Cache as Local endpoint cache
    participant Service as Controller and Group service
    participant DB as PostgreSQL
    Client->>Auth: Endpoint-scoped request with global secret
    Auth->>Cache: Endpoint-credential probe reads endpoint
    Cache-->>Auth: Warm record
    Note over Auth: Probe decides this method is inapplicable
    Auth->>Cache: Global-secret method reads endpoint rules
    Cache-->>Auth: Warm record
    Auth->>Service: Authorized request
    Service->>Cache: Read endpoint profile
    Cache-->>Service: Warm record
    Service->>DB: Read Group and its member relation
    alt Membership mutation
        Service->>DB: Existing transaction updates Group and membership
        DB-->>Service: Commit
    end
    Service-->>Client: SCIM representation
```

The exact old Group repository already updated Group data, incremented its
resource version and replaced member rows inside one transaction. Existing
service checks and database unique constraints also provided protections.
What it did not contain was the newer general schema-driven namespace
coordination and endpoint-profile revision fence.

### Why the later safeguards were introduced

These are correctness requirements, not arbitrary performance overhead.
The introducing commits in section 2 document them. The timelines below
explain the failure mechanisms; they do not assert that these events occurred
in customer production.

| Problem to prevent | Illustrative failure without the newer protection | Newer protection | Cost |
|---|---|---|---|
| Stale endpoint rules across application instances | Instance A disables a method or changes the profile in PostgreSQL. Instance B continues using its older warm copy. | Read persisted endpoint state before using it. | More database exchanges and repeated profile handling at existing call sites. |
| Two writers both pass an earlier uniqueness check | Both see no Group named Research, then try to give different Groups that name. A service-level lookup alone does not make check-and-write atomic. | A database-owned namespace lock, followed by a fresh uniqueness snapshot and check before commit. | Lock acquisition, a scope scan, conversion/comparison work and potentially member loading. |
| Profile changes between validation and commit | A request validates under rules P1. An administrator publishes P2 before the resource mutation commits. | Compare the expected profile revision with the current profile under the shared coordination protocol. | Endpoint-profile lock, profile read and revision computation. |
| Conditional version changes while waiting | A caller supplied a version condition, but the resource changes before its waiting write acquires the namespace lock. | Preserve the applicable conditional checks, including the post-lock check. | Additional identity/version inspection. The measured loop itself sends no If-Match header. |

For Group names, the database has a non-unique display-name index, not a
universal unique constraint. The server's effective schema policy determines
which promise must be enforced. The measured preset requires both `id` and
case-insensitive `displayName` uniqueness. An endpoint/id unique constraint
therefore does not replace the display-name protection.

**Figure 3 - why checking before the lock is insufficient.** Writer B must
read after Writer A commits, not reuse an earlier "no conflict" result.
The example uses two different Groups being renamed to Research.

```mermaid
sequenceDiagram
    participant A as Writer A
    participant B as Writer B
    participant DB as PostgreSQL
    A->>DB: Earlier lookup finds no conflicting name
    B->>DB: Earlier lookup also finds no conflicting name
    A->>DB: Acquire Group namespace lock
    B->>DB: Request the same lock
    Note over B,DB: Writer B waits
    A->>DB: Read fresh namespace and check uniqueness
    A->>DB: Write Research and commit
    DB-->>B: Lock becomes available
    B->>DB: Read namespace after acquiring lock
    DB-->>B: Research is now owned by another Group
    Note over B: Reject the conflicting mutation
```

The profile lock solves a related but different problem. When a request
captures profile P1 and a coordinated profile update publishes P2 before
that request obtains its profile lock, the repository detects the revision
change and rejects the stale write. If the request already holds the lock,
the profile writer waits. Removing the check would save work by removing
the guarantee, not by implementing it more efficiently.

### Published 0.55.56: what is added to the request

The published artifact keeps the existing call sites but makes their endpoint
reads authoritative. It also coordinates mutations in the repository,
where the final persisted write occurs. Validation earlier in a controller
or service cannot alone protect the interval before that commit.

**Figure 4 - the published membership-write path.** This shows logical
application/database exchanges. It omits ancillary logging and fixture setup;
the exact statement counts remain in section 3.

```mermaid
sequenceDiagram
    participant Client
    participant Auth as Authentication chain
    participant Service as Controller and Group service
    participant Repo as Repository transaction
    participant DB as PostgreSQL
    Client->>Auth: PATCH Group using global shared secret
    Auth->>DB: Full endpoint read for credential probe
    DB-->>Auth: Endpoint and profile
    Note over Auth: Credential probe is inapplicable
    Auth->>DB: Independent endpoint read for global-secret rules
    DB-->>Auth: Current method settings
    Auth->>Service: Authorized request
    Service->>DB: Independent endpoint/profile read
    DB-->>Service: Current profile
    Note over Service: Validate request and capture profile revision
    Service->>DB: Existing target/member and service checks
    Service->>Repo: Mutation plus policy and expected revision
    Repo->>DB: Begin READ COMMITTED transaction
    Repo->>DB: Read identity and applicable version
    Repo->>DB: Acquire endpoint-profile lock
    Repo->>DB: Read profile and compare revision
    Repo->>DB: Acquire resource-type namespace lock
    Repo->>DB: Read namespace and member relations after lock
    Note over Repo: Check uniqueness and applicable post-lock version
    Repo->>DB: Existing atomic mutation and commit
    Repo-->>Service: Success
    Service-->>Client: SCIM result
```

The new design was introduced incrementally to close these gaps. It was not
an intentional change to slow Group membership operations. The freshness
commit explicitly described extra reads as a correctness trade-off; it did
not claim unchanged latency. Correctness checks proved the guarantees, but
did not establish the final accumulated production-relative performance cost.
Here, "the 0.55.56 design" means behavior present in that published artifact.
The relevant safeguards were developed between the compared releases,
including commits in late September 2026; they were not necessarily all
introduced by the final 0.55.56 version bump.

### The important differences at a glance

| Concern | 0.55.20 warm path | Published 0.55.56 | Safe correction direction |
|---|---|---|---|
| Endpoint lookup | Trust local cached record on a hit. | Read persisted endpoint at existing call sites. | Keep authoritative checks, return less unchanged data, and remove only the inapplicable authentication probe. |
| Group/member atomicity | Existing transaction already present. | Transaction retained, with additional coordination. | Retain atomicity and rollback. |
| Schema-driven uniqueness | Existing checks/constraints, without the newer general locked policy snapshot. | Check effective policy in a fresh locked namespace snapshot. | Preserve the promise while loading only the data that policy needs. |
| Profile changes during a write | No newer profile-revision fence. | Lock/read/revision check before resource commit. | Keep the fence; any lock redesign needs separate concurrency proof. |
| Public profile and derived indexes | Public projection strips internal caches. | This remains an existing cost in request preparation. | Keep internal indexes with their verified snapshot, never in public output. |
| Demonstrated performance | Actual customer baseline. | Strict customer-relative comparison fails. | Local prototype also still fails; no accepted replacement exists yet. |

## 2B. Worked request and data transformations

### One request, the same intended outcome

Suppose endpoint E contains Group Research and User Alice. The following
identities are invented UUIDs to make the example concrete:

| Label | Public identity used by the client | Separate database identity |
|---|---|---|
| Endpoint E | `11111111-1111-4111-8111-111111111111` | Same endpoint key in the scoped lookup. |
| User Alice | SCIM id `22222222-2222-4222-8222-222222222222` | Internal resource row `44444444-4444-4444-8444-444444444444`. |
| Group Research | SCIM id `33333333-3333-4333-8333-333333333333` | Internal resource row `55555555-5555-4555-8555-555555555555`. |

This is an illustrative request, not a captured benchmark payload with real
identities. The authorization value is deliberately unusable. Like the
measured membership loop, this example does not send If-Match.

```http
PATCH /scim/endpoints/11111111-1111-4111-8111-111111111111/Groups/33333333-3333-4333-8333-333333333333
Authorization: Bearer example-only-not-a-real-token
Content-Type: application/scim+json

{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:PatchOp"
  ],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        {
          "value": "22222222-2222-4222-8222-222222222222"
        }
      ]
    }
  ]
}
```

Selected public fields before the operation:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "displayName": "Research",
  "members": []
}
```

Selected public fields after the operation:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "displayName": "Research",
  "members": [
    {
      "value": "22222222-2222-4222-8222-222222222222"
    }
  ]
}
```

These are selected-field examples, not complete response contracts.
The intended visible result is identical across designs when no conflicting
change occurs. The difference is how the server establishes permission,
schema validity and safe persistence.

### What changes form as the request moves through the server

**Figure 5 - from public request to stored rows and back.** Public SCIM
identifiers are not automatically the internal database row identifiers.
Membership relations and the resource's additional JSON attributes are
different storage concerns.

```mermaid
flowchart TB
    REQUEST["HTTP JSON: add public User id to public Group id"] --> RULES["Resolve endpoint rules and validate SCIM operation"]
    RULES --> TARGET["Find target Group and resolve member reference"]
    TARGET --> INTERNAL["Internal Group row id and resolved User row id"]
    INTERNAL --> WRITE["Repository mutation input"]
    WRITE --> RESOURCE["ScimResource: typed columns, JSON payload, version"]
    WRITE --> MEMBER["ResourceMember: internal links plus public member value"]
    RESOURCE --> JOIN["Read Group and member relation"]
    MEMBER --> JOIN
    JOIN --> DOMAIN["Domain record: Dates and serialized additional payload"]
    DOMAIN --> RESPONSE["Public SCIM JSON: public ids and allowed fields"]
```

| Boundary | Example transformation | Why it matters |
|---|---|---|
| HTTP to validated operation | Parse `Operations`, recognize `add members`, apply the effective profile. | A syntactically valid JSON document is not necessarily a valid SCIM mutation. |
| Public reference to database link | Public User id `2222...` resolves to internal resource id `4444...` within endpoint E. | Do not accidentally join to another endpoint or confuse public and internal identifiers. |
| Domain input to persistence | Group metadata/typed fields become columns; additional attributes cross the `rawPayload` string / PostgreSQL JSONB boundary; membership inputs become relation rows. | A Group is not stored as one opaque copy of the incoming PATCH document. |
| Membership relation | `groupResourceId = 5555...`, `memberResourceId = 4444...`, `value = 2222...`. | Internal foreign keys support persistence; the public value is retained for SCIM output. Accepted reference/display/type fields also have their own mapping. |
| Database to domain record | Database JSON payload becomes `rawPayload`; timestamps become JavaScript Date values; members map to domain records. | Hydration must preserve UTC time and values, not merely reduce query count. |
| Domain to public response | Reconstruct allowed SCIM fields, public ids and members; exclude internal runtime maps and internal row identities. | Faster internals must not change the response contract or disclose implementation state. |

The mapping is visible in the
[Group repository](../api/src/infrastructure/repositories/prisma/prisma-group.repository.ts),
[Group service](../api/src/modules/scim/services/endpoint-scim-groups.service.ts)
and [database models](../api/prisma/schema.prisma). It largely predates the
regression. The newer coordination surrounds these writes; it does not make
the client use a different membership operation.

### Why an unchanged Group name still causes uniqueness work

This PATCH changes membership, not `displayName`. Nevertheless, the published
repository receives the effective Group uniqueness policy and checks the
candidate document as part of the general mutation boundary. For the measured
preset that includes `id` and `displayName`.

The published general snapshot also loads Group member relations even though
neither of those unique paths uses members. The local prototype removes
that unrelated namespace relation loading. It does **not** remove the
target Group's actual members needed to apply the PATCH and build its result.
Skipping revalidation merely because a field looks unchanged is a separate
proposal requiring proof; it is not what the prototype claims.

### Three different kinds of change detection

Do not confuse these concepts or substitute one for another:

| Value | What it represents | What it can establish | What it cannot replace |
|---|---|---|---|
| Full endpoint-row fingerprint, local prototype | A SHA-256 hash of the database's complete current endpoint row representation. | Whether a captured cached endpoint representation can be reused after a current database check. | Fresh database observation, profile fencing or resource version checks. |
| Canonical profile revision, published safeguard | A SHA-256 hash of normalized profile content, excluding internal schema caches. Object keys are sorted; array order remains significant. | Whether the write's validated profile content still matches current profile content under the fence. | Uniqueness checks on resources or a resource's version condition. |
| Resource version / conditional HTTP tag | A version of one User, Group or other resource. | Whether an applicable client conditional-write requirement still holds. | Endpoint authorization settings or profile/schema revision. |

**Figure 6 - the prototype's current-row validation.** A current database
statement still runs on every applicable lookup. Matching content allows
reuse of the exact captured representation, not a blind cache hit. Hashing
the row is itself work and has not been proved sufficient to meet admission.

```mermaid
flowchart TB
    START["Capture cached endpoint object and its known row fingerprint"] --> READ["Read current endpoint row and compute fingerprint in PostgreSQL"]
    READ --> EXISTS{"Current row exists?"}
    EXISTS -->|"no"| MISSING["Evict stale entry and follow existing not-found resolution"]
    EXISTS -->|"yes"| SAME{"Current fingerprint matches captured fingerprint?"}
    SAME -->|"yes"| REUSE["Return fingerprint without repeated full row payload"]
    REUSE --> CAPTURED["Reuse the captured verified object"]
    SAME -->|"no"| PAYLOAD["Return fingerprint and current full row"]
    PAYLOAD --> HYDRATE["Hydrate timestamps with UTC semantics and replace cached snapshot"]
    HYDRATE --> CLEAR["Discard derived indexes belonging to replaced snapshot"]
    CAPTURED --> PROFILE["Independent request snapshot with profile revision"]
    CLEAR --> PROFILE
    PROFILE --> INTERNAL["Internal request may share snapshot-owned schema indexes"]
    PROFILE --> PUBLIC["Public projection excludes runtime indexes"]
```

For example, suppose the cache carries row fingerprint R1. If the database
still computes R1, it returns no repeated full endpoint payload and the
captured object can be reused. If it computes R2, the prototype receives the
new row and reconstructs the snapshot. R1/R2 are explanatory labels, not
literal hash values or a revision stored in a new database column.

The whole-row check observes changes even when a timestamp happens to remain
equal. A delayed read that verified an older captured object must not switch
to a different, newer global cache entry that its statement never verified.
Independent authorization and controller checks are still independent:
the prototype does not promise both must observe the same revision if an
administrator changes the profile between them. The write fence handles
changes after the request's validation snapshot.

## 2C. Visualizing the extra work

**Figure 7 - expected extra steady-state SQL statements.** This is arithmetic
derived from the measured statement shapes, not a prediction of milliseconds.
The four-request cycle contains two reads and two membership writes.

```mermaid
xychart-beta
    title "Extra SQL statements per four-request cycle"
    x-axis ["Fresh endpoint reads", "Write coordination"]
    y-axis "Additional statements" 0 --> 16
    bar [12, 14]
```

The first bar is `4 requests x 3 endpoint reads`. The second is
`2 mutations x 7 coordination statements`. Their sum is 26. This explains why
both reads and writes slow down, but writes retain substantial overhead after
the diagnostic cache treatment. More statements, larger returned documents,
profile processing and lock waiting are distinct costs; statement counts
alone do not assign exact latency shares.

## 2D. Complete layered component views with flows

These three diagrams show the **complete logical layer stack relevant to this
comparison**, including components outside the timed request. They group
related classes rather than claiming to be exhaustive class/import graphs.
The application composition exists in both versions:
[AppModule](../api/src/modules/app/app.module.ts) includes authentication,
OAuth, endpoints, SCIM, logging, activity parsing, dashboard, statistics,
database administration and web delivery. Backend selection is wired through
the [repository module](../api/src/infrastructure/repositories/repository.module.ts).
Historical components were checked in the exact old source, not inferred from
today's working tree.

**Legend:** solid arrows show a request, data access or returned result.
Numbered arrows trace the central Group request. Dotted arrows show
supporting calls, telemetry or artifact/configuration delivery; they do not
mean that a build pipeline executes on each API request. The database and
InMemory branches are alternatives, not two stores written for one request.
Browser administration and provisioning clients are separate entry points.
The box for external identity services does not imply every method uses an
external network call.

### Figure 8 - 0.55.20 components and end-to-end flow

The key performance feature is the local warm-cache return at steps 3 and 5.
The repository already separates domain operations from PostgreSQL and
InMemory implementations. Credentials, trust settings and observability also
already exist; this diagram does not call them new in 0.55.56.

```mermaid
flowchart TB
    subgraph OCLIENT["Clients and presentation"]
        OPROV["Entra provisioning or another SCIM client"]
        OUI["React browser UI: endpoint panels, operations, logs and diagnostics"]
        OAPI["Browser API client and state"]
        OUI --> OAPI
    end
    subgraph OHOST["Hosting and HTTP boundary"]
        OING["Configured ingress or direct local HTTP listener"]
        OBOOT["Node, Express and Nest bootstrap: routing, parsing, correlation and headers"]
        OSTATIC["Static web bundle and SPA fallback"]
        OGUARD["Shared-secret guard and authentication strategies"]
        OOAUTH["OAuth token and metadata services"]
    end
    subgraph OAPP["Application and request-context layer"]
        OCT["SCIM controllers and request context"]
        OADMIN["Endpoint, credential, trust, database and settings APIs"]
        OREAD["Discovery, dashboard and statistics services"]
        OEND["EndpointService: instance-local endpoint/profile cache"]
        ODOMAIN["User, Group and custom-resource services"]
    end
    subgraph ORULE["Domain rules and transformations"]
        OVALID["Effective schemas, attribute characteristics, filters and PATCH handling"]
        OMAP["SCIM representations, domain records and member-reference resolution"]
        OCHECK["Existing service checks, conditional behavior and database constraints"]
    end
    subgraph OPERSIST["Repository and adapter layer"]
        OPORT["Repository interfaces and backend selection"]
        OPRISMA["Prisma repositories and pg adapter"]
        OTX["Existing Group and membership transaction"]
        OMEM["InMemory repositories: local Maps"]
    end
    subgraph ODATA["Data and external dependencies"]
        OPG[("PostgreSQL: endpoints, resources, members, credentials, settings and logs")]
        OIDP["Configured identity/assertion and JWKS services"]
    end
    subgraph OCROSS["Cross-cutting and delivery"]
        OLOG["Logging, request correlation, activity parsing and events"]
        OBUILD["Reviewed source, CI build, registry image and deployment configuration"]
    end
    OPROV -->|"1 SCIM request"| OING
    OAPI -->|"Admin or SCIM HTTP"| OING
    OING --> OBOOT
    OBOOT --> OSTATIC
    OSTATIC -->|"Web assets"| OUI
    OBOOT -->|"2 protected API"| OGUARD
    OGUARD -->|"3 repeated warm endpoint lookups"| OEND
    OEND -->|"Cache miss only for this lookup path"| OPRISMA
    OGUARD -->|"4 authorized SCIM request"| OCT
    OCT -->|"5 warm profile lookup"| OEND
    OCT -->|"6 resource operation"| ODOMAIN
    OGUARD --> OADMIN
    OGUARD --> OREAD
    OBOOT --> OOAUTH
    OOAUTH -.-> OIDP
    OGUARD -.-> OIDP
    ODOMAIN --> OVALID
    OVALID --> OMAP
    OMAP --> OCHECK
    OCHECK -->|"7 persistence operation"| OPORT
    OADMIN --> OEND
    OADMIN --> OPORT
    OREAD --> OPORT
    OOAUTH --> OPORT
    OPORT -->|"PostgreSQL mode"| OPRISMA
    OPORT -->|"InMemory mode"| OMEM
    OPRISMA --> OTX
    OTX -->|"8 atomic resource/member write"| OPG
    OPRISMA -->|"Resource and supporting reads"| OPG
    OPG -->|"9 rows"| OPRISMA
    OPRISMA --> OMAP
    OMAP -->|"10 public SCIM result"| OCT
    OCT --> OPROV
    OBOOT -.-> OLOG
    ODOMAIN -.-> OLOG
    OLOG -.-> OPG
    OBUILD -.-> OBOOT
    OBUILD -.-> OSTATIC
    OBUILD -.->|"Migration/configuration delivery"| OPG
```

**Read the flow:** a provisioning request reaches the guard, performs the
existing endpoint lookups from warm memory, obtains the request profile,
applies domain rules, then reaches the selected repository. A Group/member
mutation commits through the existing transaction. An admin change can update
this process's endpoint cache, but another process does not automatically
gain that updated copy. Logs and deployment are supporting paths, not extra
stages inside the domain mutation.

### Figure 9 - published 0.55.56 components and end-to-end flow

The same broad layers remain. The changed boundaries are highlighted in the
labels: current endpoint reads before use, profile revision in request
context, and repository coordination around the final write. Current browser
layout/timestamp work and startup redaction are shown in their own layers;
they are not assigned the measured SQL regression.

```mermaid
flowchart TB
    subgraph NCLIENT["Clients and presentation"]
        NPROV["Entra provisioning or another SCIM client"]
        NUI["React browser UI: date-time consistency, plain endpoint links and updated layouts"]
        NAPI["Browser API client, URL-owned filters and state"]
        NUI --> NAPI
    end
    subgraph NHOST["Hosting and HTTP boundary"]
        NING["Configured ingress or direct local HTTP listener"]
        NBOOT["Node, Express and Nest bootstrap: routing, parsing, correlation and headers"]
        NSTATIC["Static web bundle and SPA fallback"]
        NGUARD["Guard and strategies: existing probe plus matching-method authorization"]
        NOAUTH["OAuth services: token JSON media type retained"]
    end
    subgraph NAPP["Application and request-context layer"]
        NCT["SCIM controllers and request context: profile plus expected revision"]
        NADMIN["Endpoint lifecycle, credential, trust, database and settings APIs"]
        NREAD["Discovery, dashboard and statistics services"]
        NEND["EndpointService: authoritative persistent lookup, then cached-representation reuse"]
        NDOMAIN["User, Group and custom-resource services"]
    end
    subgraph NRULE["Domain rules and transformations"]
        NVALID["Effective schemas, characteristics, filters, PATCH and member validation"]
        NMAP["SCIM/domain mapping: accepted member references preserved"]
        NPOLICY["Compiled effective uniqueness policy and captured profile revision"]
    end
    subgraph NPERSIST["Repository and adapter layer"]
        NPORT["Repository interfaces and backend selection"]
        NPRISMA["Prisma repositories and pg adapter"]
        NPROFILE["Coordinated endpoint-profile writer: acquire profile lock and update"]
        NFENCE["Transaction: identity/version, profile lock and current revision check"]
        NUNIQUE["Namespace lock, fresh resource/member snapshot and uniqueness check"]
        NTX["Atomic mutation callback and applicable version checks"]
        NMEM["InMemory: synchronous policy checks and publication"]
    end
    subgraph NDATA["Data and external dependencies"]
        NPG[("PostgreSQL: endpoints, resources, members with reference column, credentials, settings and logs")]
        NIDP["Configured identity/assertion and JWKS services"]
    end
    subgraph NCROSS["Cross-cutting and delivery"]
        NLOG["Logging, correlation, activity parsing and events"]
        NBUILD["Clean-master CI image, registry aliases and migration/deployment checks"]
        NSTART["Startup configuration reporting without database URI disclosure"]
    end
    NPROV -->|"1 SCIM request"| NING
    NAPI -->|"Admin or SCIM HTTP"| NING
    NING --> NBOOT
    NBOOT --> NSTATIC
    NSTATIC --> NUI
    NBOOT -->|"2 protected API"| NGUARD
    NGUARD -->|"3 probe and matching-method endpoint lookups"| NEND
    NEND -->|"Each persistent lookup checks database"| NPRISMA
    NEND -->|"Profile edit path"| NPROFILE
    NPROFILE --> NPG
    NGUARD -->|"4 authorized request"| NCT
    NCT -->|"5 independent current profile lookup"| NEND
    NCT -->|"6 validated resource operation"| NDOMAIN
    NGUARD --> NADMIN
    NGUARD --> NREAD
    NBOOT --> NOAUTH
    NOAUTH -.-> NIDP
    NGUARD -.-> NIDP
    NOAUTH --> NPORT
    NADMIN --> NEND
    NADMIN --> NPORT
    NREAD --> NPORT
    NDOMAIN --> NVALID
    NVALID --> NMAP
    NMAP --> NPOLICY
    NPOLICY -->|"7 mutation with policy and expected revision"| NPORT
    NPORT -->|"PostgreSQL mode"| NPRISMA
    NPORT -->|"InMemory mode"| NMEM
    NPRISMA -->|"8 coordinated mutation"| NFENCE
    NFENCE --> NPG
    NFENCE -->|"9 profile verified"| NUNIQUE
    NUNIQUE -->|"Fresh snapshot after acquiring lock"| NPG
    NUNIQUE -->|"10 checks pass"| NTX
    NTX -->|"11 write and commit"| NPG
    NPRISMA -->|"Ordinary scoped reads"| NPG
    NPG -->|"Rows"| NPRISMA
    NPRISMA --> NMAP
    NMAP -->|"12 public SCIM result"| NCT
    NCT --> NPROV
    NBOOT -.-> NLOG
    NDOMAIN -.-> NLOG
    NLOG -.-> NPG
    NBUILD -.-> NSTART
    NSTART -.-> NBOOT
    NBUILD -.-> NSTATIC
    NBUILD -.->|"Migrations and deployment configuration"| NPG
```

For the measured global-secret path, step 3 includes the inapplicable
endpoint-credential probe and then the matching global-secret method; step 5
adds the controller's independent lookup. On mutation, steps 8 through 10
introduce the profile/namespace safety checks. On a GET, those mutation-only
steps do not run. The namespace snapshot still loads full resource documents
and member relations in the published Group path.

### Figure 10 - proposed solution components and end-to-end flow

This diagram is **not a deployed architecture**. Boxes marked LOCAL are
implemented in the unreleased prototype. The PROPOSED box is the next
unimplemented change. The profile and namespace coordination remain. A
shared-reader profile-lock redesign is deliberately excluded from this
immediate solution.

```mermaid
flowchart TB
    subgraph PCLIENT["Clients and presentation: public contracts retained"]
        PPROV["Entra provisioning or another SCIM client"]
        PUI["Existing released React screens and primitives"]
        PAPI["Existing browser API client and state"]
        PUI --> PAPI
    end
    subgraph PHOST["Hosting and HTTP boundary: no new public protocol"]
        PING["Existing ingress or local listener"]
        PBOOT["Existing routing, parsing, headers, correlation and static delivery"]
        PAUTH["LOCAL: determine method applicability before unnecessary policy read"]
        POAUTH["Existing OAuth and trust verification"]
    end
    subgraph PAPP["Application and request-context layer"]
        PEND["LOCAL: current-row fingerprint check and captured endpoint snapshot reuse"]
        PCT["Controller: independent authoritative snapshot and profile revision"]
        PADMIN["Existing endpoint, credentials, settings, database and trust APIs"]
        PREAD["Existing discovery, dashboard and statistics services"]
        PDOMAIN["Existing User, Group and custom-resource services"]
    end
    subgraph PRULE["Domain rules and transformations"]
        PINDEX["LOCAL: internal indexes owned by verified snapshot"]
        PVALID["Unchanged effective characteristics, validation and uniqueness semantics"]
        PMAP["Unchanged allowed public fields, member values and UTC semantics"]
    end
    subgraph PPERSIST["Repository and adapter layer"]
        PPORT["Existing repository interfaces and backend selection"]
        PPRISMA["Prisma and pg: no extra native pool"]
        PPROFILE["Existing coordinated profile writer: lock and update"]
        PGROUP["LOCAL: one scoped target Group/member aggregate"]
        PFENCE["Retain identity/version and profile lock/read/revision checks"]
        PLOCK["Retain namespace lock"]
        PPROJECTION["PROPOSED: fresh policy-relevant snapshot with complete correct fallback"]
        PWRITE["Retain uniqueness, post-lock conditions and atomic mutation"]
        PMEM["InMemory: equivalent checks and shared invalidation"]
    end
    subgraph PDATA["Data and external dependencies"]
        PPG[("Existing PostgreSQL tables and constraints")]
        PIDP["Existing configured identity/assertion and JWKS services"]
    end
    subgraph PCROSS["Cross-cutting, proof and eventual delivery"]
        PLOG["Existing logging, activity parsing, statistics and events"]
        PTEST["Meaningful RED/GREEN, backend parity, races and contracts"]
        PPERF["Exact-image matched performance: all required percentiles"]
        PDELIVER["Only after PASS: reviewed clean-master publication and same-digest promotion"]
    end
    PPROV -->|"1 unchanged SCIM request"| PING
    PAPI --> PING
    PING --> PBOOT
    PBOOT -->|"Web assets"| PUI
    PBOOT -->|"2 protected API"| PAUTH
    PAUTH -->|"3 only applicable method checks current policy"| PEND
    PEND -->|"Current database check, less unchanged row transport"| PPRISMA
    PEND -->|"Profile edit path"| PPROFILE
    PPROFILE --> PPG
    PAUTH -->|"4 authorized request"| PCT
    PCT -->|"5 independent check remains"| PEND
    PCT -->|"6 resource operation"| PDOMAIN
    PAUTH --> PADMIN
    PAUTH --> PREAD
    PBOOT --> POAUTH
    POAUTH -.-> PIDP
    PAUTH -.-> PIDP
    POAUTH --> PPORT
    PADMIN --> PEND
    PADMIN --> PPORT
    PREAD --> PPORT
    PDOMAIN --> PINDEX
    PINDEX --> PVALID
    PVALID --> PMAP
    PMAP -->|"7 policy and expected revision"| PPORT
    PPORT -->|"PostgreSQL mode"| PPRISMA
    PPORT -->|"InMemory mode"| PMEM
    PPRISMA --> PGROUP
    PGROUP -->|"Scoped target read"| PPG
    PPRISMA -->|"8 coordinated mutation"| PFENCE
    PFENCE --> PPG
    PFENCE -->|"9 lock namespace"| PLOCK
    PLOCK -->|"10 read after waiting"| PPROJECTION
    PPROJECTION --> PPG
    PPROJECTION -->|"11 preserve decision semantics"| PWRITE
    PWRITE -->|"12 atomic commit"| PPG
    PPG -->|"Rows"| PPRISMA
    PPRISMA --> PMAP
    PMAP -->|"13 unchanged SCIM result"| PCT
    PCT --> PPROV
    PBOOT -.-> PLOG
    PDOMAIN -.-> PLOG
    PLOG -.-> PPG
    PTEST -.-> PPERF
    PPERF -.->|"Currently NOT PASSED"| PDELIVER
    PDELIVER -.-> PBOOT
    PDELIVER -.-> PPG
```

The target is fewer avoidable reads, fewer repeated bytes, fewer rebuilt
objects and a smaller correct uniqueness snapshot. It does not promise that
all locks, database checks or roundtrips disappear. The exact local prototype
still fails five latency checks. Until a complete accepted image passes,
step 13 is a design contract, not evidence of release readiness.

### Layer coverage and remaining boundaries

| Layer | Components represented | Important limitation |
|---|---|---|
| External consumers | Browser, Entra/other SCIM clients, configured identity/JWKS dependencies. | No claim that the synthetic benchmark exercised every authentication method. |
| Presentation | React screens, shared primitives, browser API/state and static delivery. | No UI rewrite is proposed by the performance correction. |
| Hosting/transport | Ingress/local listener, Node/Express/Nest bootstrap, routing, parsing, headers and correlation. | Logical boundary, not a fresh cloud topology or live configuration attestation. |
| Authentication | Guard, strategies, OAuth and supporting policy/credential/trust reads. | The three-lookup count is for the specified scoped global-secret workload, not a universal count. |
| Application | Controllers/context, endpoint service, resources, admin APIs, discovery, dashboard and statistics. | Related services are grouped; not every file or route is a separate node. |
| Domain | Schemas, characteristics, validation, filters, PATCH, uniqueness, revision and representation mapping. | The proposed narrower snapshot must preserve all relevant characteristic semantics. |
| Persistence | Repository interfaces, backend selection, Prisma/pg, transactions, locks and InMemory alternatives. | PostgreSQL coordination is not falsely drawn as an InMemory advisory-lock mechanism. |
| Data | Endpoint/resource/member tables, supporting credentials/settings/logs and memory state. | Not a full entity-relationship diagram or a schema migration proposal. |
| Cross-cutting | Correlation, logging, events/activity parsing, testing and artifact delivery. | Tests/pipelines are not API runtime components or substituted for current production observations. |

### How the other flows fit into each component view

| Flow | 0.55.20 | Published 0.55.56 | Proposed immediate correction |
|---|---|---|---|
| Browser navigation | HTTP/static delivery supplies the React application; its API client makes separate protected requests. | Same separation, with the released UI improvements. | No new presentation architecture or navigation contract. |
| Resource GET | Guard, endpoint/profile lookup, service validation/projection, selected repository, data mapping, response. Warm endpoint lookups can use cache. | Existing endpoint lookups observe persisted state. No mutation namespace/profile transaction is added merely because this is a GET. | Keep fresh observations, reduce unchanged transport/index work, use the local scoped Group/member aggregate where implemented. |
| Resource mutation | Same entry path plus existing checks and atomic resource/member persistence. | Pass the profile revision and effective uniqueness policy into coordinated repository commit. | Keep those guarantees; change only proven avoidable work and the explicitly proposed snapshot representation. |
| Endpoint-profile edit | Admin API updates persisted profile and the process's cache. | Coordinated profile writer locks before updating; resource writers use the compatible lock/revision protocol. Other instances refresh on subsequent authoritative reads. | Keep the same coordination; invalidate the replaced snapshot's internal derived indexes. |
| Credential or trust administration | Separate protected admin APIs and supporting repositories. Existing configured authentication integrations use their own services. | Release-specific changes are inventoried in the full comparison; these do not become Group-membership stages. | No performance-specific credential format, trust protocol or secret-store change proposed. |
| OAuth token request | Token service performs the applicable grant/credential validation and returns a token response. It is distinct from resource CRUD. | The 0.55.55 fix retained in 0.55.56 preserves the OAuth JSON media type; SCIM resources retain their SCIM media type. | No token-format or grant redesign. Workload identity federation still uses RFC 7523, not an implemented RFC 8693 exchange. |
| Discovery, logs, dashboard and statistics | Supporting API/service paths inspect profiles, repositories and observed activity as applicable. | Their released improvements remain separate from the measured four-request loop. | Preserve existing behavior; no claim that the Group benchmark certifies all supporting pages. |
| Build and deployment | Source becomes a deployable artifact with its migrations/configuration. | Published 0.55.56 has its own exact source/digest and dev validation; customer admission remains blocked. | Only a reviewed, measured, clean-master image can enter the normal same-digest promotion path. A diagram is not a deployment receipt. |

For the broader release rather than this performance-focused view, read the
[complete 0.55.20-to-0.55.56 change report](CUSTOMER_UPGRADE_05520_TO_05556_REPORT.md).
It separately inventories all published changed paths and change families.

## 3. Controlled measurements

Every campaign uses isolated synthetic PostgreSQL 17 databases, loopback-only
HTTP, 0.5 application CPU, 1 GiB container memory, 100 warmup cycles and
baseline/candidate/candidate/baseline order. One cycle adds a member, reads the
populated Group, removes the member and reads the empty Group. Values, exact
IDs, privacy, lifecycle results and exact owned-resource cleanup pass.
The original collector and workload hashes remain unchanged.

| Campaign | Run ID | Pooled samples per operation | Baseline / candidate DB calls | Application CPU change | Latency checks above 10% |
|---|---|---:|---:|---:|---:|
| Published new bundle, old runtime, no behavioral treatment | `6a4e2ce527c04d5793adcf0fef74546e` | 2,000 | 53,372 / 110,614 | +97.17% | 12/12 |
| Same bundle, diagnostic legacy warm-cache behavior | `470b3bb8cff54f9bab3e0f89f1ff987c` | 400 | 14,585 / 23,009 | +31.33% | 5/12 |
| Same bundle, diagnostic legacy cache plus omitted write coordination | `3f315fdbd28346ceaede4696488e3a46` | 400 | 14,582 / 14,585 | +3.73% | 3/12 |

Each row has its own contemporaneous old-image baseline. Do not subtract
these campaigns' latency/CPU percentages to assign exact component shares.
The smaller treatment runs are attribution experiments, not release gates.

### Median latency, baseline / candidate in milliseconds

| Operation | Untreated common-runtime control | Cache counterfactual | Cache plus no-coordination counterfactual |
|---|---|---|---|
| Add member | 13.615 / 25.735 (+89.01%) | 13.786 / 20.366 (+47.73%) | 13.100 / 14.322 (+9.32%) |
| Populated read | 5.442 / 10.684 (+96.32%) | 5.421 / 5.521 (+1.85%) | 5.314 / 5.567 (+4.75%) |
| Remove member | 11.414 / 23.587 (+106.66%) | 11.564 / 18.038 (+55.99%) | 11.412 / 11.988 (+5.05%) |
| Empty read | 5.352 / 10.602 (+98.11%) | 5.236 / 5.499 (+5.01%) | 5.152 / 5.446 (+5.71%) |

The last treatment still fails remove p95 (+11.67%), empty-read p95 (+61.68%)
and empty-read p99 (+24.62%). Near-baseline medians and CPU do not establish
tail equivalence. No treatment image is eligible for deployment even if its
latencies were all green.

### SQL evidence and a worked example

High-volume statement receipts validate that the intended treatments actually
changed database work:

| Candidate round 2 statement | Full control, 1,000 measured + 100 warmup cycles | Cache, 200 + 100 cycles | Cache plus no coordination, 200 + 100 cycles |
|---|---:|---:|---:|
| Full endpoint UUID lookup | 13,207 | 0 | 0 |
| Profile-fence projection | 2,202 | 602 | 0 |
| Advisory locks, both roles combined | 4,404 | 1,204 | 0 |
| Namespace resource scan | 2,202 | 602 | 0 |
| Identity/version read | 2,200 | 600 | 0 |
| Explicit isolation-level statement | 2,202 | 602 | 0 |
| Group member-relation reads (`groupResourceId IN (...)`) | 8,801 | 2,401 | 1,801 |

The two advisory-lock roles have the same normalized SQL shape. Their split
is established by the two source call sites, not by inventing separate
query IDs. Setup writes explain the two additional fence/scan/isolation
calls and four additional locks.

For one steady-state four-request cycle:

```text
Fresh endpoint reads:       4 requests x 3 reads = 12 extra statements
Write coordination:        2 writes   x 7       = 14 extra statements
                                                 -------------------
Expected steady-state increase:                         26 statements

The seven per write:
  1 identity/version read
  1 endpoint-profile lock
  1 current profile read
  1 uniqueness namespace lock
  1 namespace resource scan
  1 namespace member-relation read
  1 explicit transaction isolation statement
```

The full campaign has 2,200 cycles per role including warmups. That predicts
57,200 additional statements. Aggregate counters measure 57,242 additional
calls, a residual of 42 (about 0.074% of the increase) covering setup and
asynchronous/background differences. This is a workload decomposition, not
an exact synchronized accounting of each setup/logging statement.

**Inventory limitation discovered and retained:** the existing collector
samples aggregate counters and top-50 statement inventories separately.
Low-frequency startup/migration statements can enter the later top 50 and
appear in its delta without representing new workload DDL. Inventory sums
differ from aggregate counters by -4 to +10 calls in these rounds.
Do not present those sums as an exact partition or claim migrations ran
during the timed membership loop. The stable high-volume statement shapes,
their counts and the independent aggregate counters are the attribution
evidence. The collector was not altered to conceal this limitation.

Summed database execution time is 1,765.77 / 12,018.16 ms in the full control,
504.36 / 1,079.82 ms with the cache treatment and 492.95 / 626.31 ms with both
treatments. These are server-side SQL execution totals, not HTTP wall time
or client/transport/serialization time. They cannot be subtracted from
summed request percentiles to allocate a latency percentage.

## 4. What remains unproved

- Profile coordination and uniqueness were removed together. This report does
  not assign an independent CPU or latency percentage to either commit.
- The endpoint-profile lock is exclusive and endpoint-wide across resource
  types. This serial fixture measures its roundtrip cost, not concurrent
  lock-wait amplification.
- The uniqueness snapshot scans the endpoint/resource-type namespace. Larger
  namespaces and populated Groups may increase hydration/comparison cost;
  representative scaling and concurrent throughput are not measured here.
- The effective Group policy includes both server-unique `id` and
  case-insensitive `displayName`. Existing database uniqueness on endpoint/id
  does not make the remaining display-name check unnecessary.
- The same-runtime control proves the application-bundle regression does not
  require the Node patch difference. It does not prove runtime/dependency
  changes have zero effect.
- These synthetic results are not a protected actual-customer-data migration
  receipt, an Azure service-level objective or human visual verification.

## 5. Safe next steps, in order

1. Keep the existing applicability optimization: do not read endpoint policy
   for an authentication method that is already known to be inapplicable.
   Preserve fresh authorization for the method that actually matches.
2. Keep independent authoritative authentication/controller snapshots, but
   reduce unnecessary full-profile transport and reconstruction. The local
   content-validated projection already explores this without stale fallback.
3. Target the newly introduced locked uniqueness snapshot. Avoid unrelated
   member loading and consider bounded, characteristic-correct projections
   for relevant unique paths instead of hydrating the whole namespace.
   Preserve case semantics, extension paths, uniqueness conflicts, both
   version assertions and a fresh snapshot after lock acquisition.
4. Evaluate profile-fence concurrency separately. A shared reader/exclusive
   profile-writer design is a design proposal, not a safe one-line lock
   replacement. Require cross-instance profile/write race tests first.
5. Re-measure any safe correction against the exact old customer image using
   matched runtime/quota and complete sample counts. Current safe run
   `93e57f5bbfd146bebb727c3c2e1cb206` still fails 5/12, including all medians.
6. Only after strict admission passes, follow protected consolidation,
   appropriate versioning, reviewed exact-tip CI, clean-master publication
   and immutable-image dev/canary/customer validation. This RCA alone does not
   warrant a version bump or a new release.

Never combine lock acquisition and the protected snapshot into one statement
whose snapshot could predate waiting. Do not replace the safeguards with the
diagnostic legacy-cache/no-coordination treatment.

## 5A. Proposed correction: retain the guarantees, reduce the work

### First, distinguish the work that exists from the work still proposed

There is **no accepted performance fix yet**. The local prototype contains
five implemented ideas below, with focused correctness evidence described in
the [performance ledger](CUSTOMER_UPGRADE_PERFORMANCE.md). Its latest full
run still fails five of twelve latency comparisons, including every median.
The same-runtime counterfactual campaigns are separate evidence and do not
certify the prototype.

| Change | Status | Mechanism and reason | What remains |
|---|---|---|---|
| Check authentication-method applicability before endpoint policy lookup | Implemented locally, unreleased. | A JWT or the global shared secret need not query policy for an endpoint-credential method that cannot match. Matching-method authorization remains fresh. | Consolidation and final-image admission. |
| Content-validate cached endpoint representations | Implemented locally, unreleased. | Check the entire current row in PostgreSQL, return the full representation only when needed, and preserve captured-snapshot identity. | Server hashing/read cost remains; complete performance threshold is not met. |
| Omit unrelated members from uniqueness snapshots | Implemented locally, unreleased. | Only load builtin Group member relations if an effective unique path actually uses them. Keep extension paths and conflict handling correct. | Remaining namespace rows/payload and coordination cost. |
| Read a target Group and members in one scoped statement | Implemented locally, unreleased. | Aggregate the member relation in the database rather than making a separate relation roundtrip for that target read. | Correctness is tested, including 1,000 members; the total performance gate still fails. |
| Retain derived schema indexes on a verified snapshot | Implemented locally, unreleased. | Reuse internal lookup maps on warm requests; invalidate them at snapshot replacement on both backends. Public/persisted profiles remain clean. | Avoided builds are proven, but that is not complete performance admission. |
| Narrow the remaining locked uniqueness snapshot | Proposed next implementation, not yet validated. | Fetch and transform only what the effective policy needs, rather than every full resource document. | Characteristic-correct projection/fallback design, RED/GREEN tests and full measurement. |
| Shared-reader/exclusive-profile-writer locking | Possible later design, deferred. | Could reduce unrelated concurrent mutation blocking while coordinating profile changes. | Independent race/deadlock proof and evidence that contention warrants it. Not part of the immediate correction. |

### Proposed immediate architecture

Use the current repository/service boundaries. Do not introduce a second
database pool, a stale authorization cache, a new policy language or a broad
framework rewrite. The next question is narrow: **can the existing protected
uniqueness check establish the same answer using less data and conversion?**

**Figure 11 - correction boundaries.** Solid steps describe the tested local
prototype or retained safeguards. The explicitly proposed box is additional
work, not a result already achieved.

```mermaid
flowchart TB
    REQUEST["Endpoint-scoped membership request"] --> APPLIES{"Endpoint-credential method applicable?"}
    APPLIES -->|"no"| SKIP["Skip only that inapplicable policy read"]
    APPLIES -->|"yes"| AUTH
    SKIP --> AUTH["Matching authenticator performs authoritative endpoint check"]
    AUTH --> CONTROLLER["Controller performs its independent current-row/profile check"]
    CONTROLLER --> PREPARE["Validate operation and reuse verified snapshot-owned indexes"]
    PREPARE --> GROUP["Read scoped target Group and members in one statement"]
    GROUP --> TX["Begin transaction and preserve identity/version checks"]
    TX --> FENCE["Acquire profile lock, read profile, verify revision"]
    FENCE --> LOCK["Acquire namespace lock"]
    LOCK --> PROPOSED["PROPOSED: fresh policy-relevant snapshot with exact fallback"]
    PROPOSED --> CHECK["Preserve uniqueness and applicable post-lock version checks"]
    CHECK --> WRITE["Existing atomic mutation and commit"]
    WRITE --> RESULT["Return unchanged public SCIM contract"]
```

The branch is conceptual, not a replacement authentication-chain
implementation. A successful matching endpoint-credential method does not
then need to authenticate using the global secret. The example workload
takes the inapplicable-probe branch and then the global-secret method.

### Worked example of the next proposed data reduction

Suppose the namespace contains many Groups with large additional JSON
attributes and many memberships, but the current effective unique paths are
only `id` and `displayName`. For the uniqueness decision, copying every
unrelated attribute and member into JavaScript is unnecessary in principle.

| Information | Needed for this uniqueness decision? | Proposed handling |
|---|---|---|
| Internal row identity | Yes, to exclude the target record and identify the current target. | Preserve. |
| Public `id` | Yes, this preset promises uniqueness. | Preserve the existing semantics; do not disable the check just because an index also protects the key. |
| `displayName` and its case rules | Yes. Research and research must conflict under this effective policy. | Preserve typed comparison and the effective characteristic values. |
| Unrelated extension content | Not for this particular policy. | Avoid hydrating it only when the compiled paths prove it is unrelated. |
| All other Groups' member lists | Not for `id` and `displayName`. | The existing local prototype already omits them for this policy. |
| Target Group's actual members | Yes for the membership mutation/result, not because names are unique. | Retain the target read and correct mutation behavior. |
| An extension or member path that really is unique | Yes when the effective schema says so. | Select exactly what can be proved equivalent, or keep the existing complete correct path. Never silently skip an unsupported promise. |

This is not yet an implemented SQL plan or an asserted query-count reduction.
A smaller projection can reduce bytes, object creation and comparison work
while retaining the same namespace query and locks. It may therefore leave
roundtrip costs largely unchanged. If its complete measurement still fails,
the next action is another bounded measurement and design decision, not
calling the projection a successful fix.

### Non-negotiable safeguards and verification

| Guarantee | Why it must remain | Proof required for a correction |
|---|---|---|
| Current authorization state | A disabled method must not be accepted from stale cached policy. | Cross-instance changes and post-disablement refusal through real HTTP. |
| Independent request-profile observation | Do not make the controller silently use an authorization snapshot that it did not independently obtain. | Captured-object tests and profile updates between stages. |
| Profile fence | Do not commit under different rules from those used to validate the operation. | Two-process/profile-write races and rejection of a changed revision. |
| Fresh namespace after waiting | A waiter must see the previous writer's commit. | Independent PostgreSQL pools and two-writer uniqueness races. |
| Typed schema semantics | Case handling, extension paths and multi-valued attributes are part of the promise. | Domain units plus positive/conflict HTTP cases for actual effective characteristics. |
| Conditional versions and atomic membership persistence | A faster path must not accept a failed condition or leave partial relations. | Applicable pre/post-lock checks, native rollback and both backend behaviors. |
| Stable public data | Query reduction must not change member values, references or UTC timestamps, or expose internal caches. | Complete value/key assertions, large member sets and non-UTC tests. |
| Actual performance improvement | Fewer queries or a green correctness suite is not the user-visible outcome. | Full immutable-image comparison against 0.55.20 at matched runtime/quota and all required percentiles. |

### Step-by-step route from proposal to deployment

1. Define a single narrow correction and exact conflict/value assertions.
   Capture meaningful failing tests before changing production code.
2. Implement the smallest policy-relevant projection using existing helpers
   and repository boundaries, with a correctness-preserving fallback where
   exact projection cannot be established.
3. Prove unit, real PostgreSQL HTTP, InMemory parity, independent-pool races,
   profile changes, conditional writes and response contracts as applicable.
4. Build an exact experimental image and verify its compiled inputs.
   Use a small diagnostic to confirm the intended work actually changed.
5. Run one complete matched acceptance comparison. Do not replace failed
   p95/p99 results with successful medians, or compare percentages from
   unrelated campaigns as though they were one controlled experiment.
6. If admission passes, complete reviewed consolidation, appropriate version
   management, protected push and exact-tip CI. Publish a clean-master image
   with the standard release/latest naming and promote that same digest.
7. Close the independent actual-data migration, authorized cleanup,
   reviewer/credential-response and final human visual-verification holds.
   Follow canary-first and customer blue/green verification. Existing
   deployment authorization is not a substitute for those results.

No runtime change, version bump or cloud mutation is part of this explanatory
update. The proposed design has not been described as implemented or accepted.

## 6. Experiment issues, root causes and prevention

These entries extend PERF-01 through PERF-26 in the
[existing execution ledger](CUSTOMER_UPGRADE_PERFORMANCE.md).

| ID | Type / severity | Symptom and root cause | Resolution and why it works | Detection / earliest possible detection | Prevention |
|---|---|---|---|---|---|
| PERF-27 | Evidence discovery / Low | Guessed old statement receipts and a guessed schema-helper path did not exist. The original full run predates statement capture. | Use actual artifact discovery, the exact publisher source and current helper location; collect new controlled inventories instead of inventing old data. No production fix/commit. | Direct lookup / artifact discovery before analysis. | Discover instrumentation/version before promising a query decomposition. |
| PERF-28 | Experiment activation / High | Initial cache/no-coordination runs had identical query counts because the existing benchmark overrides image ENTRYPOINT; the intended preloader never ran. | Discard treatment runs `5659bd0d4f7e44c2a46ffee7fb288a70` and `301f5d8c5860483fb42eb7cd600aa27b`. Inject through preserved NODE_OPTIONS and verify actual serving-process activation before accepting results. Lab-only fix, no production commit. | Post-run query counts / serving-process preflight before measurement. Escape delta: one measurement campaign. | Mode/hook/image/run/Node/options receipts plus observed query changes. The initial untreated diagnostic `8e5939ba124b487489e19e0b64ceb9fa` remains valid but is superseded by the complete control. |
| PERF-29 | Environment comparability / High | A candidate NODE_OPTIONS override would have removed the inherited 384 MiB heap cap. | Protective preflight rejected it. Append the preloader to inherited options; actual-process receipts verify both flags. Lab-only fix. | Preflight / image preflight, no measurement escape. | Preserve and compare runtime flags, not only image version labels. |
| PERF-30 | Measurement interpretation / Medium | A strict inventory-sum assertion failed by three calls. Source inspection found separately sampled aggregates and rank-limited top-50 deltas, including old low-frequency DDL entering the later ranking. | Retain all counter values and explicit -4 to +10 inventory deltas. Use stable high-volume shapes and steady-state arithmetic; do not treat the inventory as a synchronized exhaustive partition. Analysis-only fix. | Cross-artifact accounting / collector-semantics inspection before exact-partition claims. | Validate instrumentation completeness and timing before deriving exact totals. No workload/harness change or rerun was used to manufacture agreement. |
| PERF-31 | Report correctness / Low | Draft three-decimal medians were reconstructed from a rounded console table instead of copied from the authoritative assessment. Percent changes and conclusions were unaffected. | Replace them with exact assessment values and mechanically assert that all twelve baseline/candidate median pairs appear in the report. Documentation-only correction, no production commit. | Receipt comparison before publication / direct structured-data extraction during drafting. | Never infer precision from formatted terminal output; validate numeric report claims against retained structured receipts. |
| PERF-32 | Documentation validation tooling / Low | A user-instruction frontmatter check requested the `yaml` package, which is not installed in the owned checkout. | Use the already installed `js-yaml` parser. Both user-scope instruction files then parse and their names, descriptions and global patterns pass. No dependency installation or manifest/lock change. | Parser startup / installed-parser discovery before validation. | Resolve existing validation tools before selecting an optional parser; retain a real parse rather than silently skipping the check. |
| PERF-33 | Source navigation / Low | An initial component-diagram lookup assumed `api/src/app.module.ts`, but this repository keeps the module under `api/src/modules/app/app.module.ts`. | Read the bootstrap import, then inspect that exact module at both source revisions. No runtime change. | File lookup / import-guided navigation before path assumptions. | Establish component locations from the application's real imports before drawing layer relationships. |
| PERF-34 | Evidence-validator correctness / Low | A new inventory validator treated `reportSection: 4-7` as one literal heading and failed, although the report contains sections 4 through 7. | Explicitly parse a single section or an inclusive numeric range, reject unsupported notation, and verify every referenced heading. Exact path/commit/hash checks then pass for all 971 paths and 411 commits. No report inventory or runtime data was changed. | Cross-artifact validation / schema-aware validation design. | Validate the actual evidence schema, not an assumed narrower field format. |

The diagnostic preloader passes six application/migration mode cases plus
invalid-mode rejection. The three corrected collectors exit 0; all three
latency assessors exit 1. Activation verification and unchanged collector/
worker hashes pass. All exact owned containers/networks are removed.

Evidence is retained under run-prefixed `test-results` artifacts and the
current session's `perf-rca-05520-20261018` directory, including activation,
image build, assessment, classified SQL and harness-hash receipts. Raw logs
and experimental images are not release artifacts.

### Provenance and completeness

At the initial comparative-RCA closeout, the full available
current-continuation event stream was reconciled using
signal and causal-narration passes: 32,331 records, including 10,312 in the
approved delivery window. This is not the deleted original session transcript.
The scanner retains record metadata/category labels, not raw credential-bearing
content. New source-discovery, inactive-treatment, heap-comparability and
rank-limited-inventory signals map to PERF-27 through PERF-30; the subsequent
draft-value correction is PERF-31.

Source/search/recording echoes are not additional incidents. Normal CRLF
warnings, offloaded tool output and the old lockfile's root version metadata
were reviewed as reporting context, not new runtime defects or accepted
performance samples. Inactive treatments remain explicitly excluded.

The subsequent component/release-report expansion was reconciled against
the full available continuation again: 33,533 records, including 11,514 in
the approved delivery window. The parser, component-path and section-range
validation issues are accounted for in PERF-32 through PERF-34. Repeated
source/search echoes were reviewed as echoes, not additional incidents.

### Self-improvement and design disposition

**Test/evidence improvement: applied.** Treatment activation, inherited runtime
flags and SQL changes are now separate required proofs in this experiment.
Common-runtime controls prevent application-only claims from relying on
unmatched Node versions. Correctness suites alone did not establish a
production-relative performance budget for the new read/lock multipliers.
The explanatory update also ties diagrams to the exact old source and
current prototype, labels invented examples, distinguishes three different
revision concepts, and keeps proposed improvements separate from results.
Rendered diagrams and literal example parsing are required documentation
checks; no application suite rerun is implied by a prose-only update.

**Design/architecture disposition: accepted.** This phase changes no production
architecture. Lab-only treatments remain outside shipping source, and the
existing workload is unchanged. No speculative pool, cache, strategy seam or
lock redesign was added. A safety-preserving uniqueness/fence optimization
requires its own focused implementation and independent correctness proof.

## 7. Reading and validating the visual report

All eleven diagrams render in real Chromium under the strict configuration in
both light and dark themes. Mermaid 11.17.0 matches this machine's built-in
VS Code renderer. A standalone HTML copy also contains all eleven figures as
pre-rendered SVG images, so it does not require a Mermaid extension or an
active Markdown preview.

The exported document was opened in Chromium: all eleven figures have measured
non-zero bounds and label elements, with no diagram error boxes. This is
documentation-rendering proof, not customer application visual sign-off.
The two literal JSON examples and the HTTP request body parse, and the
existing twelve median pairs still match their structured measurements.

To regenerate the visual copy from the repository root:

```powershell
npm run docs:mermaid:doctor
npm run docs:mermaid:render -- docs\CUSTOMER_UPGRADE_PERFORMANCE_RCA.md
npm run docs:html -- docs\CUSTOMER_UPGRADE_PERFORMANCE_RCA.md
```

Open `test-results\docs-html\docs__CUSTOMER_UPGRADE_PERFORMANCE_RCA.html` in a
browser. For Markdown, use VS Code's Markdown Preview rather than the raw
editor. Long sequence/flow diagrams require vertical scrolling; their entire
content is retained in the standalone export.

The user-level plain-language preference is persisted for the local Copilot
and VS Code instruction locations. It explicitly covers machines, sessions
and windows. Other-machine synchronization has not been verified, and this
report does not claim it has been propagated everywhere.
