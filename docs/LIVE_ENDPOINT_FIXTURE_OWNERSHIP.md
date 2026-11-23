# Live endpoint fixture ownership

**Last verified:** 2026-11-20

## Executive summary

This is a locally tested, unreleased correction to endpoint fixture cleanup.
The live runner now captures complete original endpoint UUID inventory before
creation and retains only successful, newly created response IDs for teardown.
Names and inventory differences are not ownership evidence. Original endpoints
and concurrent unknown endpoints cannot become endpoint deletion targets.

**This does not authorize running the full live suite against preserved dev.**
The suite still has global mutation risks listed below. No live execution,
network request, runtime startup, authentication, dependency change, commit,
push, pull request, or deployment was performed for this correction.

Scope: existing branch `vprane/scimserver/containers-live-fixture-ownership-20261121`,
base `554f42023fdde30918ef378987cc8f3135e4ed3a`, with no upstream. The separate
uncommitted evidence-redaction outcome was not copied or integrated.

## Ownership lifecycle

The following flow describes endpoint cleanup, not a new SCIM protocol.
A universally unique identifier (UUID) is normalized without depending on case.

```text
GET complete original endpoint inventory
  -> validate envelope, count, every UUID and duplicate identities
  -> permit endpoint creation
POST endpoint
  -> inspect successful response UUID before recording or returning it
  -> reject original, malformed or already-owned IDs without replacing handles
  -> retain new owned handle
  -> caller configures endpoint and seeds resources through the existing API
DELETE registered owned endpoint
  -> require successful HTTP status
  -> GET exact UUID must return 404
  -> mark retained handle complete
Normal exit or actual unhandled-error trap
  -> retry pending registered handles only
  -> propagate any cleanup failure, even if a later retry succeeds
```

The list API returns `{ totalResults, endpoints[] }` without a pagination
contract. `Initialize-LiveEndpointOwnership` requires the entire array and
matching integer total, rejects missing/null envelopes and malformed or duplicate
UUIDs, and fails closed before creation. It cannot replace retained handles.
If pagination is introduced later, completeness must be implemented and tested,
not inferred from an arbitrary `count=500`.

The shared `Invoke-RestMethod` and `Invoke-WebRequest` wrappers register new
responses before caller assignment and before the recorder can interrupt the
request. Endpoint deletion requires a registered handle. Mutation of original
endpoint settings, credentials, schemas, resources and endpoint log overrides is
blocked. POST, PUT, PATCH and DELETE against endpoint-scoped paths require a
registered owned response ID, including when a UUID was absent from the original
inventory. Absence alone never grants mutation permission.
Fixture variables inspected in the
main runner and its invoked helpers derive from creation responses, not inventory.

The only unowned mutation exception is `Invoke-LiveEndpointRejectionProbe`.
Inspection found two actual negative mutation probes: POST schema registration
and POST resource-type registration against the all-zero UUID. Both retain their
existing HTTP 404 assertions. The helper requires an active known-owned cleanup
handle and an exact sentinel GET returning 404 before issuing one POST to either
`schemas` or `resource-types`. It admits no arbitrary UUID, URI, PUT, PATCH,
DELETE or other route. The admission is consumed once and cleared in finally.
The all-zero sentinel cannot be registered as a fixture or admitted in original
inventory. The actual POST exception, body, headers, content-type presence and
common parameters are forwarded unchanged. Unexpected HTTP success is fatal and
remains sticky through known-owned cleanup; it never registers an unowned ID.

Original inventory is immutable once armed, even before the first fixture is
created. Reinitialization rejects before another inventory read, rather than
disarming or replacing a complete baseline with a later empty snapshot.

Both normal reconciliation and the actual script trap use the same registry.
Section-local catches cannot erase failed endpoint cleanup evidence. The final
`Remove-TestResource` helper also rethrows failures and skips only an already
verified completed endpoint handle. No failed HTTP call produces a synthetic
successful response.

These handles are process-local. A terminating PowerShell error is tested;
forced process termination, loss of a successful creation response, or machine
shutdown is not recoverable through this registry. Never compensate by sweeping
names or subtracting inventories. Investigate any ambiguous creation manually
with independently verified ownership.

## Remaining preserved-state blockers

| Surface | Observed risk | Required next action before preserved-dev execution |
|---|---|---|
| Global log configuration, main runner sections 7 and 9z-I | Level/category changes affect every endpoint. Section 9z-I restores `INFO`, not necessarily the original level. Some restoration is normal-path only. | Review global-state ownership, exact before/after values and failure cleanup separately. |
| `DELETE /scim/admin/log-config/recent` | Clears the shared ring buffer through a module-qualified call. Endpoint deletion cannot restore it. | Exclude preserved-state execution until an independently approved isolation or preservation strategy exists. |
| Global pruning configuration, section 9z-L | Changes retention settings; later restoration cannot undo any pruning or audit writes. | Verify retention effects and independent database preservation, not just restored policy values. |
| `Ensure-JwksHostAllowed` | Adds a shared JSON Web Key Set (JWKS) host precondition without restoring it. | Review shared allowlist effects separately; do not assume endpoint cascade cleanup removes global hosts. |
| JWKS host add/edit/remove tests, sections 9z-AT7 and 9z-BE | Random host names are not original-host ownership proof; some deletion failures are caught locally. | Capture host inventory, prove host ownership, and validate exact cleanup in a separate coherent change. |
| `PUT /scim/admin/settings/security`, section 9z-AT10 | Writes global `credentialSecretVisibility = "always"` without restoring the original setting. | Review original-state preservation separately. This endpoint correction does not redesign the policy. |
| Global inventory, logs and dashboard reads | Reads can observe carried records or concurrent activity and create audit/log writes. They are not fixture selectors. | Preserve independent original-state comparisons and explicit handling of legitimate audit writes. |
| Standalone helper entry points | `profile-revision.ps1` can accept an existing endpoint; standalone helpers do not automatically inherit the main runner's wrappers. The main runner invokes profile revision without an existing endpoint. | Do not reuse existing endpoints when invoking helpers independently; qualify those entry points separately. |
| Evidence exports and verbose/HTTP traces | Redaction remains an independent, uncommitted outcome. | Integrate only reviewed redaction work later; do not claim evidence safety from fixture ownership. |

Endpoint-specific schema, credential, authentication and resource mutations in
the main runner use new response IDs. The dot-sourced correctness, snapshot,
profile-revision, minimal-member and schema-cache helpers, and the nested
token-lifetime helper, use the inherited wrappers when called by this runner.
The endpoint log-override DELETE previously bypassed the wrapper and now goes
through it. No API implementation or HTTP contract assertion was weakened.

## Reproduction and results

### Verified source evidence

| Responsibility | Current declaration or exact configuration |
|---|---|
| Complete unpaginated endpoint list | [EndpointController.listEndpoints](../api/src/modules/endpoint/controllers/endpoint.controller.ts:68) |
| Original inventory validation and admission | [Initialize-LiveEndpointOwnership](../scripts/live-endpoint-ownership.ps1:10) |
| UUID identity | [ConvertTo-LiveEndpointUuid](../scripts/live-endpoint-ownership.ps1:1) |
| Original/unowned deletion protection | [Get-LiveEndpointRequest](../scripts/live-endpoint-ownership.ps1:33) |
| Registration and exact-ID cleanup confirmation | [Complete-LiveEndpointRequest](../scripts/live-endpoint-ownership.ps1:73) |
| Explicit bounded rejection-probe admission | [Invoke-LiveEndpointRejectionProbe](../scripts/live-endpoint-ownership.ps1:100) |
| Retained handle reconciliation | [Invoke-OrphanReconciliation](../scripts/live-endpoint-ownership.ps1:132) |
| Shared REST and web transports | [Invoke-RestMethod](../scripts/live-test.ps1:148), [Invoke-WebRequest](../scripts/live-test.ps1:199) |
| Actual trap and final cleanup helper | [script trap](../scripts/live-test.ps1:399), [Remove-TestResource](../scripts/live-test.ps1:16270) |
| Global settings risk examples | [Ensure-JwksHostAllowed](../scripts/live-test.ps1:322), [`credentialSecretVisibility` write](../scripts/live-test.ps1:12265), [shared ring-buffer DELETE](../scripts/live-test.ps1:2581) |

Run only these pure PowerShell controls for this offline outcome:

```powershell
# Deliberately exits 1, using in-process mocks and the pinned original source.
pwsh -NoProfile -File scripts\test\live-endpoint-ownership.contract.ps1 -BaselineRed

# Default-running positive contract, no live runner or network.
pwsh -NoProfile -File scripts\test\live-endpoint-ownership.contract.ps1

pwsh -NoProfile -File scripts\test\run-all-gates.contract.ps1
pwsh -NoProfile -File scripts\test\copilot-customizations.contract.ps1 -GitTree Head
```

| Check | Result |
|---|---|
| Initial pre-edit missing-ownership control | RED, exit 1 before production edits |
| Actual pinned baseline final sweep | RED: mock original `live-test-original` UUID was deleted |
| Actual pinned baseline reconciliation | RED: mock concurrent unknown UUID was deleted |
| Independent-review unknown mutation controls | RED before correction: both wrappers admitted POST, PUT and PATCH against a concurrent unknown UUID |
| Armed baseline lifetime control | RED before correction: reinitialization replaced the original UUID inventory when no owned handles existed |
| Current default ownership contract | GREEN, 133 assertions; previously 104 |
| Shared gate-walker contract | PASS, all assertions |
| Shared customization contract on HEAD | PASS, all assertions; no customization file changed |
| PowerShell syntax and editor diagnostics | PASS, five changed/new PowerShell files parse; no reported editor errors |
| Diff/style and focused documentation links | PASS, `git diff --check`, no new em dashes, and all ownership-document links resolve |

The causal baseline replay was performed after implementation to strengthen the
initial missing-guard RED; it is not described as a pre-edit lifecycle run.
The tests project the actual functions and all actual top-level traps from the
PowerShell syntax tree and substitute only module-qualified transport calls.
The full live runner is never evaluated. Assertions cover original rejection
before assignment, retained finally handles, case-insensitive identity, complete
inventory admission, concurrent unknown retention, both wrappers' cleanup failure
paths, status and exact-ID readback, sticky failure evidence, recorder interruption,
and unchanged method/URI/header/body/content-type/common-parameter forwarding.
An injected interruption in the actual dot-sourced snapshot helper also verifies
that nested calls share the retained registry and complete exact owned cleanup.
Review follow-up controls exercise all three unknown mutation methods on both
wrappers, baseline lifetime without handles, bounded sentinel preflight and
single-use admission, real HTTP 404 propagation, original/route rejection, sticky
unexpected success, unchanged cleanup handles, and both actual unchanged 404
assertions in the runner. The earlier arbitrary unknown-UUID forwarding assertion
was replaced by the two genuine bounded rejection probes, not weakened.
The default pre-push gate and Stage 1 gate walker register this focused contract.

## Execution issues and detection escape

| Issue / severity | Root cause and resolution | Detection and prevention |
|---|---|---|
| Name sweep could delete originals / High | The final sweep treated a naming prefix as proof of ownership. Removed; registry handles are the only endpoint cleanup selectors. | Found during pre-live inspection; reproduced through the actual pinned sweep with mocks. Earliest feasible gate was an ownership lifecycle contract, now default-running. No live deletion was performed. |
| Inventory reconciliation could delete concurrent endpoints / High | A before/after inventory difference included unrelated concurrent creations. Reconciliation now iterates retained successful response IDs only. | Found during pre-live inspection; actual pinned reconciliation reproduces the escape. Concurrent unknown negative control closes the missing cleanup assertion. |
| Logging interruption could lose a new cleanup handle / High | Recording a successful POST before registering it allowed a recorder failure to interrupt ownership capture. Registration now precedes recording and caller assignment. | Found during implementation review before qualification; injected recorder interruption proves actual trap cleanup. Closed at the nearest wrapper contract. |
| Trap projection initially omitted actual cleanup / Medium | PowerShell stores traps in `EndBlock.Traps`, not `EndBlock.Statements`. The actual interruption assertion failed rather than claiming a proxy trap passed. | Focused contract caught this before completion. Projection now includes every actual top-level trap; the interruption control remains mandatory. |
| Mock switches and interpolated helper path / Low | Initial mock parameter types did not model switches, and replacing an interpolated path with extra quotes produced an invalid helper path. Corrected the mock signature and literal path substitution. | Focused execution exposed both before GREEN; the default contract executes the real helper loading and wrapper binding. |
| Unknown mutation admission escaped 104 controls / High | To preserve nonexistent-ID HTTP probes, the first correction allowed every non-original UUID for POST/PUT/PATCH. A concurrent unowned endpoint could therefore be mutated. Admission now requires a registered owned handle; only two exact, checked, single-use all-zero-UUID POST rejection probes are exceptional. | Independent review caught this before runtime; new pre-fix RED records all six wrapper/method combinations. The earlier tests positively asserted arbitrary unknown forwarding instead of distinguishing actual rejection probes. Default controls now enforce that distinction and preserve both HTTP 404 assertions. |
| Armed inventory could be replaced without handles / High | The initialization guard checked only retained-handle count. Before any creation, a second snapshot could erase the original baseline. It now also rejects whenever ownership is already armed, before reading another snapshot. | Independent review prompted an actual pre-fix RED proving baseline replacement. Default controls require rejection, original set identity and continued armed state. |
| Probe-source assertion initially searched only direct statements / Low | The actual rejection try blocks are nested in the syntax tree. Direct `EndBlock.Statements` lookup found none, so the new assertion failed. The assertion now locates actual try blocks recursively and still requires each unchanged HTTP 404 comparison. | Focused contract caught this before final GREEN; no source assertion or HTTP expectation was relaxed. |

No commit SHA is assigned to these resolutions because committing was not
authorized. This ledger was reconciled against this task's observed command
failures and inspected changes, not earlier session recollections or an invented
live run. No claim of full historical transcript reconciliation is made.

## Integration and self-improvement

Integration must preserve the wrapper parameter signatures, module-qualified
transport forwarding, register-before-recorder ordering and sticky cleanup
failure evidence. Resolve expected wrapper/trap conflicts with reviewed
redaction work by composing both concerns, not by bypassing either one.
Run the default ownership contract and the independent redaction contracts on
the integrated source. Review every actual trap, including any added by the other
change. Do not replace them with a first-trap proxy, widen deletion selectors,
reset handles, or swallow cleanup failures to make the merged tests pass.

Test/gate disposition: **applied**. The new default lifecycle contract closes
the name/difference ownership escape, unknown mutation admission, armed baseline
replacement and the actual-trap/probe projection gaps.

Design/architecture disposition: **accepted**. One small cohesive ownership
helper serves both existing transports and all endpoint teardown paths.
No speculative provider layer, API refactor, security redesign or second
migration is justified. Global preservation and redaction remain separate
outcomes, not claims absorbed by this correction.
