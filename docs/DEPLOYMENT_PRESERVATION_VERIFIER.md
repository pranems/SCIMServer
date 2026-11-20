# Deployment preservation verifier

**Last verified:** 2026-11-20

## Summary and exact claim

The [existing verifier](../scripts/verify-deployment.ps1) now fails closed when
endpoint inventory or authoritative stored-resource totals cannot be measured.
A requested baseline must exist, be valid and use the same count basis before
any HTTP request. This is candidate 0.55.68 source work, not a deployment or
Docker Desktop exit acceptance.

A successful comparison proves this finite claim: the measured endpoint UUID
set is unchanged, and each matching endpoint has equal **stored User and Group
totals** before and after. Totals of zero are valid measurements. Resource UUIDs,
resource content, custom resource families, memberships, credentials and complete
database preservation are **not measured** here. Unchanged totals cannot detect
replacing one resource with another.

The authoritative endpoint is `/scim/admin/endpoints/{endpointId}/stats`.
Its `users.total` and `groups.total` fields count stored User/Group resources,
independently of SCIM publication and visibility policy. The
[service implementation](../api/src/modules/endpoint/services/endpoint.service.ts)
uses endpoint-scoped `scimResource.count` queries for the two resource types on
Prisma, with no SCIM discovery, return policy or active-only filter. Its existing
InMemory branch counts the corresponding repositories. Active and inactive
subtotals are not substituted for `total`.

SCIM discovery and SCIM-visible totals remain a distinct evidence lane.
A valid User-only endpoint need not publish Group, and can still have stored
Group rows. Neither a missing resource type nor HTTP 404 proves a zero stored
count. The global admin statistics are also not substituted for endpoint-level
measurement: matching global sums alone could hide resources moving between
endpoints. Sequential HTTP reads are not a transactional database snapshot;
coordinate a quiet comparison window when interpreting them.

## Earlier behavior and correction

| Boundary | Earlier behavior | Correction |
|---|---|---|
| Endpoint intake | Requested `count=200`, discarded envelope completeness information | Request the current unpaged admin list and require array length equal to its nonnegative integer `totalResults` |
| Endpoint identity | Counted resources through endpoint-name paths | Require unique UUIDs and use the canonical ID-based admin statistics route |
| Count basis | SCIM lists conflate preservation with resource publication and visibility | Measure `users.total` and `groups.total` from existing per-endpoint admin statistics, explicitly marked `stored-user-group-v1` |
| Resource measurement | Swallowed count-request errors and retained null totals | Reject failed statistics requests, missing/array envelopes, and missing, null, string, boolean, array, object, negative or fractional totals |
| Requested baseline | Missing paths skipped comparison; malformed shapes could coerce to apparently equal values | Literal terminating read, JSON object requirement, validated endpoint array/count/UUIDs/resource totals and exact count-basis marker before HTTP |
| Comparison | Allowed resource growth and skipped unknown/null counts | Reject either direction of stored-count change and any endpoint ID-set delta |
| Publication | Could write apparent success containing unknown totals | Publish only complete measurements; file-write errors also fail the run |

The endpoint controller currently exposes an unpaged list, not a paginated
contract. The verifier does not invent pagination. A future partial envelope
fails its completeness check rather than silently accepting a first page.
The 201-endpoint offline fixture proves there is no 200-endpoint ceiling.

The snapshot retains `userCount` and `groupCount`, now explicitly qualified by
the top-level `countBasis` value `stored-user-group-v1`. A missing marker,
a visible-count marker or an unknown marker is rejected. Recapture a baseline;
never relabel an old visible-count artifact as stored-resource evidence.

CLI parameters and selected health, live-SCIM and browser stages are unchanged.
Snapshot-only measures health and inventory and performs a requested comparison,
without running live or browser suites. Exit 0 means all selected checks passed;
exit 1 denotes measurement/check/delta failure; exit 2 denotes a missing, invalid
or incompatible requested baseline.

## Executable offline evidence and normal delivery wiring

```powershell
pwsh -NoProfile -File scripts\test\verify-deployment.contract.ps1
```

The contract invokes the complete real verifier in child PowerShell processes
with in-process REST fixtures, synthetic UUIDs and temporary directories.
It makes no network requests and starts no container, bridge or WSL process.
Checks cover exit codes, diagnostics, absence of invalid snapshot publication,
actual snapshot counts and values, canonical statistics paths, legitimate empty
and zero inventories, nonzero values, renamed endpoints, more than 200 endpoints,
unchanged baselines and both directions of resource-count deltas.

| TDD checkpoint | Observed result |
|---|---|
| Original helper, before production edits | 157 assertions: 38 passed, 119 failed |
| Measurement-boundary diagnostics RED | 196 assertions: 193 passed, 3 failed |
| Singleton-array malformed baseline RED | 199 assertions: 196 passed, 3 failed |
| Authoritative stored-count/User-only/basis controls RED | 240 assertions: 179 passed, 61 failed |
| Final stored-count implementation GREEN | **261 assertions: 261 passed, zero failed** |

The stored-count RED run has fewer assertions because missing successful
snapshots prevent subsequent value checks. The final suite exercises those
values. Representative initial failures were `user-failure returns exit 1
(actual 0)`, `user-null returns exit 1 (actual 0)`, `user-missing returns exit 1
(actual 0)`, `inventory-incomplete returns exit 1 (actual 0)` and `baseline-missing
returns exit 2 (actual 0)`.

The User-only positive fixture publishes only User yet measures four stored
Groups. Its successful unchanged comparison proves the fix does not fabricate
SCIM-visible Group zero or depend on Group publication. The failed count-request
controls and malformed totals now exercise the authoritative statistics route.

The suite is registered in the existing
[runtime runner](../scripts/test-container-runtime.ps1), already invoked by
[normal pre-push](../scripts/pre-push-checks.ps1),
[Windows CI](../.github/workflows/build-test.yml) and the
[deployment pipeline](../scripts/dev-deployment-pipeline.ps1). Behavioral
controls prove this runner dispatches the suite once and propagates its failure.
The existing deployment evidence contract and ten metadata/delivery-consumer
assertions also pass independently.

The complete runtime runner is not executed in this bounded session: its
Compose-rendering contract invokes a real container client, outside the
authorized no-container boundary. Its other suites, the normal complete push
hook and publication remain parent-owned qualification, not an implied pass
from isolated dispatch success. No application test counts changed.

Run document-coupling checks after staging new source and documentation files.
The existing freshness audit discovers changes through Git diffs, which exclude
untracked files. A new bound document on disk alone is not a staged doc change.

## Read-only dev qualification

On November 20, the existing automation profile matched the registry's active
dev tenant, subscription and deployment principal. ARM resource identity and
the registry-derived URL were checked without sign-in or configuration writes.
An authenticated API probe confirmed deployed version 0.55.67.

The final receipt window was **19:42:36.5502582Z to 19:42:55.9512099Z**.
The stored-count verifier captured **76 unique endpoint UUIDs**, with
per-endpoint stored totals summing to **1,175 Users and 428 Groups**, and exited
0. A second read-only SnapshotOnly run compared against that captured baseline
and also exited 0: all endpoint UUIDs and every per-endpoint stored User/Group
total were equal. These numbers are observations, not hardcoded acceptance
thresholds, and are not SCIM-visible totals.
Private receipts record **76 successful per-endpoint statistics requests in
each run**, not just the two aggregate sums.

This is a before/after **self-comparison**, not a deployment comparison.
Raw snapshots, exact failing discovery responses and endpoint-specific evidence
remain in private session storage, not this repository. No token or secret is
saved. No application, profile, authentication, directory, database, container,
bridge or deployment was changed.

## Execution issues, root causes and detection-stage analysis

| Issue | Type / severity | Root cause, fix and why it works | Detection stage / earliest possible |
|---|---|---|---|
| Unknown counts accepted | Test correctness / High | Empty catches converted request failures into null success; diff skipped nulls. Terminating requests and strict integer validation now prevent unmeasured publication. | Parent source research, then offline RED / executable offline verifier contract |
| Incomplete endpoint inventory | Test correctness / High | Only `.endpoints` was retained, without completeness validation. Exact envelope cardinality and unique UUID checks now reject missing or repeated endpoints. | Parent source research, then offline RED / executable offline verifier contract |
| Missing/malformed baseline accepted | Test correctness / High | Conditional `Test-Path` bypassed missing evidence; malformed JSON shapes could coerce. Literal terminating read and validated object/count/IDs/totals reject these before HTTP. Singleton JSON arrays require `-NoEnumerate` plus explicit object validation. | Parent research and offline RED / executable offline baseline contract |
| Increases called preservation | Contract precision / Medium | Only lower counts failed despite a no-delta claim. Exact family counts and both endpoint ID-set directions now match the finite claim. | Contract design, then increase RED / executable offline comparison contract |
| Legitimate User-only profile rejected by intermediate ID-route implementation | Measurement semantics / High | On deployed 0.55.67 the complete intake succeeded, but an active endpoint's canonical Group list returned `RESOURCE_TYPE_NOT_SUPPORTED`; discovery explicitly published only User. Visibility is not stored-data preservation. The existing per-endpoint admin statistics route counts stored resources without depending on publication. The basis marker prevents interpreting older visible totals as stored totals. | Read-only live qualification / offline User-only fixture with nonzero stored Group rows |
| Failure lacked measurement context | Diagnostics / Medium | An HTTP 404 message alone did not identify intake versus resource family. A small current-step label now identifies the exact UUID/statistics or intake boundary without exposing credentials. | Read-only live failure / offline failed-request diagnostic assertion |
| Protected version probe returned 401 | Qualification tooling / Low | A preliminary version request lacked a bearer header. The bounded qualifier now uses the verifier's in-memory authorization header for the read-only version probe; no credential lookup, login or saved token is needed. | Read-only qualifier preflight / protected-route contract awareness |
| Documentation patch partially applied | Tooling friction / Low | A copied header context differed from the file. The tool reported the partial application; the exact header was re-read and only remaining hunks were applied. | Patch tool / exact-context inspection |
| Diagnostic wrapper exit did not reflect nested script exit | Qualification tooling / Low | A PowerShell wrapper ending after a nested script call could itself return zero. Its status is now forwarded explicitly; the original verifier's printed exit-1 failure was never counted as qualification success. | Diagnostic output review / explicit wrapper exit-code propagation |
| Private version receipt lost scalar scope | Qualification tooling / Low | A diagnostic function's script-scoped scalar belonged to the invoked verifier rather than the outer receipt writer. The receipt now retains observations through a shared local collection; the version check itself was already enforced. | Private receipt review / structured receipt assertion |
| Freshness check could not see new untracked bound doc | Validation preparation / Low | The audit's Git diff discovery included the modified verifier but excluded the new untracked document. Normal staging makes both visible; no audit bypass or assertion change is needed. Stage new bound files before the final coupling check. | Final documentation check / staged-change preparation |

The parent never ran the original flawed helper as acceptance. No deployed
data-loss incident is established. The live User-only issue demonstrated a gap
in the initial synthetic fixture population; the new positive fixture closes
that gap at the cheaper offline boundary.

**Self-improvement disposition: applied.** Failed evidence acquisition and mixed
count bases are executable rejection cases. Valid zeros, nonzero stored rows
behind a User-only profile, and runner failure propagation are positive and
negative controls, not source-presence checks.

**Design/architecture disposition: accepted.** Reuse the existing authoritative
statistics endpoint and two small verifier-local validators. No generic
framework, flags, new dependency or application change is justified.
Health/live/browser orchestration remains separate from the finite stored-count
claim. The marker is necessary because two real count bases differ.

**Completeness provenance:** issues were recorded from actual RED/GREEN and
read-only results in this fresh session. A complete **813-record current-session
event-log scan** through the receipt-review boundary used both failure-frequency
and assistant-narration passes. Every actual diagnosed issue maps to the table
above. `error TS`, `ECONNRESET`, `ENOENT` and `Cannot find module` hits were search
echoes, not observed failures. Historical stale-state prose was not classified
as a new failure. HTTP 401/404 qualification failures, partial patch application,
the wrapper/receipt issues and intentional TDD failures are retained explicitly.
No earlier parent transcript is claimed as reconciled.
The subsequent untracked-document freshness result is recorded above from its
actual gate output and confirmed against the audit's Git diff discovery.

## Parent handoff

Keep candidate version 0.55.68; do not make a second bump. Parent-owned shared
readiness, changelog and context documents should record this as a separate
verifier rollback unit: complete endpoint UUID inventory and exact **stored**
User/Group totals now reject missing, unknown or mixed-basis evidence.
SCIM visibility/discovery and resource UUID/content preservation remain distinct.

Offline contracts and real dev read-only self-comparison pass. Normal complete
hook, reviewed integration, exact-tip CI and publication remain parent-owned.
No push, deployment, registry change, credential recovery or Desktop operation
is authorized or performed by this change.
