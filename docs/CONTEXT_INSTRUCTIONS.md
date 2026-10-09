# SCIMServer - Context Instructions for AI Assistants

> **Purpose**: This file provides complete project context for AI coding assistants (GitHub Copilot, etc.) to enable productive sessions without re-discovery of architecture, patterns, and decisions.
> **Version**: 0.55.39
> **Last Updated**: October 9, 2026
> **Last verified:** 2026-10-09

---

## Active Delivery Process

**Unmerged follow-up, 2026-10-08:** the local
`fix/comprehensive-ui-validation-20260930` branch contains durable request-log
endpoint names, authenticated Fetch streaming and validation/deployment
hardening. Local Chromium is 238 pass / 15 skip / zero fail; local InMemory
and isolated Docker/PostgreSQL live checks each pass 1,700 assertions with
zero leaked endpoints. Serial Prisma E2E passes 118 suites / 2,486 tests.
Final Docker Chromium passes 248 tests / 14 documented skips / zero failures
across 262 cases, including all six seeded profiles and extension/Group/Device
mutation journeys. Final local regression browsers pass 2/2.
Current web units and coverage pass 119 suites / 1,577 tests: lines 85.49%,
branches 75.39%, functions 75.31%, statements 82.72%.
Resource saves now await cache refresh; PATCH envelopes no longer replace
resource schemas in optimistic cache. Final focused tests pass 105/105.
None of these local changes has been committed, merged or deployed.
Production dependency audit blocks release with critical `proxy-addr` (API)
and `seroval` (web) findings. Reviewed release, dependency remediation, Azure
proof and operator visual sign-off remain separate outstanding claims.
The disposable Docker estate was cleaned by exact owner-verified IDs.
Existing Compose containers and local processes were preserved.
No fresh Compose-specific or formal baseline-relative performance gate was run.

**Separate dependency preparation, 2026-10-09:** branch
`chore/regen-lockfile-quarantine-20261009` is pushed at `6075ad3d`, based on
the same merged master, without modifying this UI branch's manifests.
The established company-feed/seven-day procedure was followed: reject the
first under-age CI artifact, pin aged compatible transitive versions, and
accept the second artifact only after reviewing all 51 changed entries.
Exact-tip CI reproduces the accepted public-host/SHA-512 lock bytes.
Owned installations and fresh production audits pass with zero findings
for API and web. New-graph evidence: 20 Fast pre-push gates, 6,007 API units,
2,426 default InMemory E2E passes / four PostgreSQL-only skips, another
55/55 explicitly executed hook-excluded logging tests, 1,568 web tests and
coverage, and passing size/pin checks. Full development audits remain blocked
by five residual leaf dependencies. No merge, image publication or deployment
occurred. These counts belong to the separate master-based dependency graph,
not this unmerged UI overlay; combined-source and deployment proof remains
necessary. The dependency receipt is retained in that worktree's
`test-results/dependency-validation-receipt-20261009.json`.

The feature branch is no longer an uncommitted single risk unit. Four
constituent commits preserve durable endpoint identity, authenticated streaming
and tables, cache/profile fixes, and validation-runner hardening. Combined
dependency + feature Compose proof passes 250 browser cases with 12
pixel-only skips, 1,700 live assertions and all four API backend lanes.
The complete web coverage lane passes 1,577 tests. Two earlier behavioral
browser skips now execute against the real API and have inspected negative
controls. The dashboard PNG changes remain unstaged pending canonical dev
pixel execution; do not accept or regenerate them from local Compose.

Start substantive updates with completed / in-progress / remaining tasks.
The operator has a shared 50,000-credit monthly AI budget across this project
and SyncFabric. Reuse unchanged evidence and keep investigation bounded.
Do not infer exact credit balance or numeric context capacity.

**v0.55.36 dev deployment is complete.** PR #188 merged as
`d6e9a497315739b62ea11d2194a919944c376c31` after exact-tip CodeQL, Trivy and
review gates passed. Workflow run 36747123394 published the v0.55.36 runtime
with digest
`sha256:49719babb9966b416312b25d99d2b30feddb219d0c266664eaf0688f7afc7f21`.
Purplecliff revision `scimserver-dev--vd6e9a497` serves 100% of traffic. The
full live SCIM gate passed, all 60 endpoint IDs were preserved and revision
hygiene retained two active revisions. A required-extension browser fixture
was corrected to use `/ResourceTypes/User` discovery; the complete dev
Playwright suite passes 247 tests with 5 intentional skips. The typed PATCH
incident endpoint was recreated on the local v0.55.36 canary and replicated to
dev from the returned profile with identical SHA-256. PATCH response and
independent GET evidence match on both nodes, reject bracket/dotted-key
corruption, and both dedicated fixtures were deleted. Customer production and
the parallel-prod canary remain unchanged.

Final assurance now includes a guarded exact-tip PostgreSQL rerun at
`b304f663`: 209/209 unit suites and 6,004/6,004 tests, 118/118 E2E suites and
2,485/2,485 tests, all 22 migrations, and exact cleanup. The
[release-assurance receipt](evidence/scim-release-assurance-20260930/validation.json)
records all nine review dispositions, browser supersession, four current skip
identities, and limitations. Five blank-page outcomes in the focused skip
classification passed an exact serial rerun after their visual diffs were
inspected; no baseline was regenerated. Current dev reports 71 long-lived
active endpoints rather than the historical deployment snapshot's 60, while
the focused run retained zero created or updated endpoints. Do not rewrite the
historical receipt or delete those entries without separate provenance.
Operator visual sign-off is still required before any production-readiness
statement.

**Historical C0 local-acceptance checkpoint:** common attribute normalization now
feeds runtime uniqueness compilation per ResourceType, and admission uses the
same compiler before profile publication. Shared declarations are unchanged;
core-only unsupported computed promises remain admission errors. Omitted
optional extension lists are safely normalized. P7b is now assembled once:
whole-namespace validation, evolving required/immutable transitions, and
returned:request presence are integrated without replacing the accepted
binding, query, retention or transaction seams. Focused assembly evidence is
184 overlap units and553 HTTP cases per backend. Built runtimes each pass
P7b153/905 plus P7a472 assertions. PostgreSQL17.8 replayed22 migrations and
exact owned cleanup passed. Omitted `schemaExtensions` additionally has
ResourceTypes discovery and complete custom CRUD proof. Profile revisions now
cross the request/repository commit boundary: nine controlled User, Group and
custom create/replace/delete races return sanitized409 with complete
non-mutation on both backends. Affected units pass611 tests and the expanded
guarded lane passes571 HTTP cases/backend. [Design and evidence](SCIM_PROFILE_REVISION_WRITE_COORDINATION.md).
The immutable82-case corpus now has164 current-source dispositions:81 pass
plus one explicit cache N/A on InMemory,82 pass on PostgreSQL,769 assertions
and0 failures. Broader characteristic overlays are mapped to permanent tests
without a Cartesian-coverage claim. The50,000-row query benchmark records the
known residual cost boundary:50,000 candidates and20.1MB transferred for a
0.02%-selective custom numeric filter,401ms local fetch p50 and23ms service
p50. The exact locally built `dist/main.js` artifact then passes166 live
outcomes/backend on InMemory and PostgreSQL17.8 after all22 migrations; both
owned PIDs stop and exact container cleanup passes. Local implementation and
acceptance were complete at this checkpoint. Push/PR CI, merge, release
metadata and dev deployment were completed later as recorded above.
[Characteristic mapping](SCIM_CHARACTERISTIC_RECONCILIATION.md),
[performance assessment](SCIM_QUERY_PERFORMANCE_ASSESSMENT.md), and
[case evidence](evidence/scim-current-acceptance-20260929/validation.json)
plus [artifact evidence](evidence/scim-exact-artifact-20260929/validation.json).

**Corrected source pair:** `4ba9373c` was held for violating the common
externalId contract. Corrective child `2d2da4e1` restores all-core String/SV
and adds exact-case precedence. Their history is now retained as
`d93d1a0d` / `43b01c4e`, but the fifth commit is never independently
accepted or validated. Default `none` and independent extension homonyms
remain. The [initial hold](SCIM_CORRECTNESS_DESIGN_AND_IMPLEMENTATION.md#1125-held-externalid-relaxation-not-imported-2026-09-29)
is historical; evaluate only the corrected pair's final state.
That final state now passes176 units,367 InMemory HTTP plus two native-only
skips,369 PostgreSQL17.8 HTTP and143 shared live checks/backend.
[Corrected integration evidence](evidence/scim-common-uniqueness-integration-20260929/validation.json).


The bounded [PUT retained-entry correction](SCIM_PUT_ENTRY_PRESERVATION.md)
is a parallel source snapshot on `5581e6b7`. Its additional type-capacity,
restoration stability and nested immutable controls extend the already
integrated b21e44cb fix. The later authoritative parent89810f0c is integrated
ase38b36aa: retained-entries.ts is again canonical, original consumers use
that path, and attribute-values is a compatibility export only. There is
never a second implementation. Source evidence is107 contract checks within1771 tests.
Integration414e14e8 -> d8c9a79a now separately passes491 units,
509 InMemory/511 PostgreSQL HTTP and164 shared live checks/backend,
including6 new corpus cases/5474 assertions. [Merged residual proof](evidence/scim-retention-stability-integration-20260929/validation.json).
The eight base expectations were subsequently
reconciled by parentdf3ca957/bd82e681 and are not reopened.
The parent canonical-path/fixture integration separately passes428 units,
305 InMemory/306 PostgreSQL HTTP and164 main live checks/backend, including
84 retained cases/1764 assertions. [Latest receipt](evidence/scim-parent-reservation-integration-20260929.json).
The [P7b guide](SCIM_P7B_PATCH_SCHEMA_CONTRACTS.md) and its
[source receipt](evidence/scim-patch-schema-p7b-20260929/validation.json)
remain source-specific evidence, not the final C0 matrix.

The local initial assembly now includes P1/P2 core, P3/P3b/P4, P5, P6a/P6b, P7a,
P8a/P8b/P8c and P9. [The integration tracker](SCIM_CORRECTNESS_DESIGN_AND_IMPLEMENTATION.md#1110-p9-compatibility-integration-2026-09-29)
owns current combined results; the records below are source-package evidence,
not deployment claims. P4's raw repository-error gap was closed separately
with value/content regressions, not assumed fixed by P5's scalar formatting.
P7 schema-role/id/meta context, P3b representation/admission/query and the
case-level dispositions were later closed in the current C0 acceptance.
Scoped precise interrupted-create errors have combined proof;
cleanup/no-orphan checks alone are not error-contract proof.

P9 is locally implemented on P7a/P1: emitted strict-on Entra guidance,
honest fixed/inert setting descriptions and a shared 17-case HTTP/live
corpus, including the proven modern pathless shape.
Both owned PostgreSQL 17.8 (22 migrations) and InMemory pass.
The original P9 run had two open P2 checks. After core P2 and authorized
follow-up `29b3b2c6` / `8d2110d1`, both pass unchanged on the assembled
backends. All 19 cases now run by default, without TODO/environment gating.
Each built runtime passes 1,228 P9 and 188 P2 assertions; five focused HTTP
suites pass 356 cases/backend with zero pending/TODO. [Separate integrated
receipt](evidence/scim-flags-default-corpus-20260929/validation.json).
Owned P9 bootstrap now pins the
verified URL against later marker changes; inherited URLs are cleared before
provisioning and readiness checks target TCP.
See [P9 scope/evidence](SCIM_ENTRA_COMPATIBILITY.md) and
[37-setting reconciliation](SCIM_SETTINGS_BEHAVIOR_EVIDENCE.md).
No version/lockfile, UI code, push or deployment changes.
P9 corpus evidence is strict-ON only. The separate P2 flag suite verifies
quoted User active rejection with coercion OFF in both strict modes and
asserts raw repository state. Namespace-only strict prevalidation now has the
bounded P7b proof above. Legacy global uniqueness
can block unrelated profile-subblock edits because merged profiles are fully
revalidated; do not silently downgrade the declaration or call it RFC-invalid.

P7's [common binding-context follow-up](SCIM_P7_COMMON_ATTRIBUTE_CONTEXT.md)
protects generic id/meta and prevents core semantics from mutating independent
extension uses of shared schemas. Admin rejection of core-only conflicts is
provider policy; runtime common precedence is the RFC requirement. Generic
meta timestamps now come from authoritative record fields. Source regression:
1,698 tests,108 HTTP and472 live assertions per backend.
Integration `8d5915ba` -> `e80da689` separately passes754 units,
537 InMemory HTTP plus one native-only skip,538 PostgreSQL17.8 HTTP after
22 migrations, and143 shared live checks/backend including472 P7 assertions.
[Combined receipt](evidence/scim-common-context-integration-20260929/validation.json).
Existing common-PATCH and PUT retention fixes are preserved, not reopened.
Namespace-only strict validation is integrated through P7b. Broader
characteristic and profile-coordination consumers are now closed by the
current characteristic map and profile-revision proof. The parent-owned
eight-expectation reconciliation is integrated as`df3ca957` -> `bd82e681`:142 tests in three
suites pass with exact assertions and four opposing controls; no production
change, skipped case or database rerun was introduced.

P7's [common externalId follow-up](SCIM_P7_COMMON_EXTERNAL_ID.md) corrects
admission/runtime behavior for all resource cores using RFC 7643 3.1, not
column convenience. Namespaced externalId and custom displayName/active
remain independent. Source regression: 1,687 tests. That original source
package did not include completed-candidate PATCH integration, now supplied
by `4a0ac7d5`. The source package also did not fix PUT
duplicate/anonymous retention; assembly separately fixed and verified that
behavior in `b21e44cb`, retaining the neutral matcher.

P7a is implemented locally in its own P1-based worktree. The
[P7a record](SCIM_P7A_PROFILE_VALIDATION.md) covers declaration validation,
scalar/cardinality checks and POST/PUT contracts with 1,507 focused unit
passes and owned backend/live evidence. It does not close P7 ordered-PATCH
integration or remaining uniqueness/reference/deep-compatibility questions.
No product version, lockfile, push or deployment changed.

The separate recursive readOnly follow-up closes the nested-complex
compatibility POST/PUT gap: 1,517 focused units and, per backend, 67 HTTP /
228 live assertions. [Characteristic status](SCIM_P7_CHARACTERISTIC_STATUS.md)
records exact unsupported server-uniqueness shapes for P3b and the intentional
global-uniqueness capability policy. P7 remains open until final P2 integration.
Do not treat optional external referential integrity or raw JSON token
reconstruction as automatically required features.

2026-09-29 P2 follow-up intentionally removes verbose-disabled explicit User
literal dotted writes (400/no-write instead) and makes quoted promoted-active
values honor `AllowAndCoerceBooleanStrings` even in lenient mode. Existing
no-path/extension compatibility is preserved. P9 integration cases now have
default-running P2 HTTP/live regressions; the parent still owns converting
the sibling P9 corpus TODOs after merging.

P2 shared ordered PATCH execution is implemented on isolated
`fix/scim-patch-semantics-20260928`, based on P1 `3ecaba55`. The three
resource adapters share target resolution, append/all-match mutations,
readOnly policy and per-operation required/immutable/primary transitions.
See [P2 implementation and evidence](SCIM_P2_IMPLEMENTATION.md) and
[P2 RCA](SCIM_P2_EXECUTION_RCA.md). Its source package did not implement P3
conditional writes, P7 validation, or P8 lifecycle changes; combined checks
belong to this integration branch.
No product version, locks or deployment changed.

P1 correctness work is implemented locally on the isolated implementation
branch, not on a deployment. [SCIM_P1_IMPLEMENTATION.md](SCIM_P1_IMPLEMENTATION.md)
records the typed-path contract, 1,476 focused unit / 65 HTTP passes and owned
backend/live evidence. Keep P2 operation semantics separate. Version and
CHANGELOG coordination remain the parent integration gate.

P3b adds repository-commit schema uniqueness for User/Group/custom resources,
including scalar multi-values and complex children. Database-owned namespace
locks coordinate PostgreSQL writers; InMemory commits synchronously.
See [contract, compatibility limits and evidence](SCIM_UNIQUENESS_IMPLEMENTATION.md).
P7 admission and P8 profile-revision coordination remain separate packages.
Source follow-up `704d701f`, integrated as `7001d194`, corrects generic
promoted-column assumptions. Focused combined write/transaction checks pass:
245 units, 304 InMemory/308 PostgreSQL HTTP and 143 shared live checks per
backend. Its original independent probe had43/45 passing outcomes, with
numeric scalar/MV displayName equality returning empty200/500. That
[historical failure](evidence/scim-custom-authority-integration-20260929/validation.json)
is now closed by the corrected P6c pair plus explicit binding-role fix.
[New query/write/schema proof](evidence/scim-query-authority-integration-20260929/validation.json):
45/45 additional probe outcomes per backend,398 InMemory/399 PostgreSQL
HTTP and163 shared live checks/backend including52 query outcomes.
Binding-qualified admission is integrated. Profile coordination and broader
characteristic acceptance remain separate; this is not the final matrix.
See [the exact integration hold](SCIM_CORRECTNESS_DESIGN_AND_IMPLEMENTATION.md#1116-p3b-core-assembly-with-contract-corrections-open);
P7 common externalId and P3b uniqueness policies have separate owners.
The RFC follow-up limits unique types to string/integer/decimal/reference;
references are intrinsically exact. The final adapter follow-up rejects only
unrepresented builtin Group member leaves, not same-named extensions.
Generic resources use public rawPayload authority, preserving custom numeric/MV
displayName and other same-named custom fields instead of imposing builtin types.
Common top-level externalId is a single case-exact String under RFC 7643
section 3.1 across all resource types; namespaced extension externalId remains
independent. Numeric/MV custom displayName and extension externalId are covered.
Latest corrected source evidence:654 units,170 PostgreSQL HTTP and168
InMemory plus two database-only N/A. Earlier648/158/156 counts remain
historical; the651/167/165 checkpoint4ba9373c is SUPERSEDED by2d2da4e1,
not independently accepted. The final corrected pair now has the separate
merged proof above; these source counts are not its combined totals.
C0/P6 own representation-aware filter/sort pushdown validation for those names.
P7 common runtime is integrated; shared-policy admission remains parent/C0 work.

P4 Group aggregate transactions are locally validated on top of P3 conditional
writes: 205 focused units, 111 PostgreSQL 17.8 HTTP cases and 110 InMemory
cases (one PostgreSQL-only FK control is skipped). Initial members commit
with creation; failed replacements leave the complete aggregate unchanged.
See [implementation and limits](SCIM_GROUP_TRANSACTIONS_IMPLEMENTATION.md).
This is local branch work, not a deployed-version claim; release metadata and
the integration matrix remain parent-owned.

Local correctness work now includes reviewed P8a (`39841319`) and P8b endpoint
deletion cleanup. P8b uses a required repository lifecycle port, reversible
InMemory storage swaps and deleted-ID write barriers; PostgreSQL remains
FK-backed. RequestLog is retained, not cascaded. See
[the package evidence and boundaries](SCIM_ENDPOINT_DELETION_IMPLEMENTATION.md).
These are local changes, not a new product version or deployment. The source
package excluded P8c/P3; this assembly combines them with P4 while retaining
separate cleanup and concurrent-error-contract acceptance claims.

The P8b exact-error follow-up is now locally verified: interrupted resource
and credential creates return a typed, sanitized endpoint 404; PostgreSQL
confirms parent absence only after relation failure. It preserves typed
conditional errors, 412 responses and native pg timeout classification.
P8 remains open for parent P3/P4/P8c assembly validation, not for an assumed
shared InMemory User-FK contract.

Use [AI_EFFICIENT_CHANGE_DELIVERY_PROCESS.md](strategy/AI_EFFICIENT_CHANGE_DELIVERY_PROCESS.md)
for change sizing, validation lanes, commit/push/PR/merge/deploy ownership,
session boundaries, model routing, and bounded-log/context rules. It preserves
all independent assurance layers while preventing duplicate full-suite runs and
mixed-scope PRs. W3.5 is the completed reference execution: PR #155 merged as
`c10f9ea83822a50650c2b2867ceff9eeaa46c545`, and the same 0.55.23 artifact is
verified on dev and canary. Wave 4 and process-automation refactors remain
separate future changes.

The current source release candidate is v0.55.39. It consolidates the SCIM
correctness work. The previous clean consolidation tip completed local
exact-artifact acceptance on InMemory and PostgreSQL 17.8. Release-candidate
triage additionally fixed runtime-only schema caches changing profile revisions
and restored structured malformed-filter diagnostics. API build/lint, API unit
6,000/6,000, InMemory API E2E 2,481 passed plus 4 skipped, and the focused
Workbench incident regression are green. Publication still requires the
remaining browser/static/documentation gates, a reviewed exact-tip PR,
merged-master build, and purplecliff dev validation. Guarded PostgreSQL unit and E2E parity pass
6,000/6,000 and 2,485/2,485; the exact built artifact passes 166/166 live
outcomes per backend on PostgreSQL 17.8 after all 22 migrations. The Workbench
regression executes the exact four-operation typed PATCH incident and verifies
independent persisted readback. The isolated Docker live suite passes
1,697/1,697 after all 22 migrations, with zero remaining endpoints and exact
owned API, database and network cleanup. Web Vitest passes 118 files and 1,568
tests with all coverage floors met; production build and all 25 size budgets
pass. The TypeScript ratchet reports 66 established errors, below its ceiling.
PR #188 is open. The first exact-tip CI run identified five CodeQL
dynamic-property sinks and two HIGH `fast-uri` CVEs. A sink-local sanitizer was
runtime-safe but remained red in CodeQL, so readOnly preprocessing now rebuilds
validated entry lists immutably and each resource service consumes the returned
payload explicitly. The structural correction passes 639/639 focused units,
317/317 affected HTTP tests, changed-source lint with zero errors, and the API
build. The manifest now selects fixed `fast-uri` 4.1.4;
public-registry workflow run 36735519112 changed only its package version, URL,
and SHA-512 integrity and reported a 28.2-day publish age. Clean install and
build pass with zero HIGH/CRITICAL production-audit findings. Exact-tip CI,
merge, and purplecliff validation are still pending.

The current deployed baseline is v0.55.35 on dev and the proudbush canary. The shared digest is
`sha256:ad8594e2e2b7263e88dc4ae813436a20797cbea30b78457340fdb35dfe7eedfc`.
Customer production remains on v0.55.20 and must not be promoted without explicit operator approval.

The v0.55.34 global-navigation and workflow-context rollback unit is merged and
fully verified on dev. Shell-wide
Back/Forward restores route and typed URL state, including endpoint Logs detail
drawers, Self-service `/Me` endpoint scope, and Manual Provision endpoint plus
ResourceType. Errors-only Logs filtering accepts typed booleans and URL text.
`/Me` preflights shared-secret, stale, and inactive endpoint contexts. Operations
is current inventory, Logs is request history, and Manual Provision is the
choose-target-first creation workspace. Intent-based endpoint controls show
display name, stable name, and active state. Evidence is web 1,567/1,567 across
118 files with all coverage ratchets, focused review 78/78 plus filter-security
29/29, final dev Playwright 246 passed / 5 skipped / 0 failed, dev live
1,532/1,532, all six modes, builds, API lint, route budgets, docs, and 716/716
Mermaid renders. PR #179 merged as `b58af31d`; dev revision
`scimserver-dev--vb58af31d` serves v0.55.34 at 100% with all 60 endpoint IDs
preserved and two active revisions retained. Exact-tip CodeQL found and closed
incomplete subject-filter escaping through the structured RFC 7644 filter
builder. Canary and customer prod are unchanged.

The v0.55.33 API-output-fidelity rollback unit is merged and verified on dev.
URL and SCIM identifiers are case-insensitive
across endpoint names/UUIDs, Bulk, custom ResourceTypes, Schemas, and PATCH
paths. ServiceProviderConfig reflects effective authentication methods, and
Endpoint Settings publishes all 11 authoritative egress values. Recoverable
bearer and OAuth secrets render automatically and populate authenticated admin
exports; WIF remains secretless. Public discovery, broad endpoint projections,
RequestLog, Workbench history, and structured logs do not persist plaintext
credentials. New `once` writes are rejected; legacy purged values require
rotation. Evidence is API unit 5,192/5,192, API E2E 1,533/1,533, web
1,544/1,544, local/dev live 1,532/1,532, and all four executable
persistence/web lanes. The two Prisma lanes were skipped because `DATABASE_URL`
was unavailable. Final dev Playwright passed 241 with 4 intentional skips and
0 failures. Builds, lint, budgets, migration,
docs, Mermaid, and exact-tip CodeQL are green. PR #177 merged as `6565dc60`;
dev revision `scimserver-dev--v6565dc60` serves v0.55.33 at 100% with all 60
endpoint IDs preserved and two active revisions retained. Canary and customer
prod are unchanged.

The v0.55.32 effective WIF/JWKS egress rollback unit is merged and verified on
dev. An endpoint admin GET and the Connect WIF panel
publish all 11 runtime values with configured override, source, units, bounds,
and clamping. Edit/Save/Cancel/Reset-to-inherit use endpoint PATCH with explicit
null-as-unset semantics while preserving sibling settings. Evidence so far is
API unit 5,170/5,170, API E2E 1,529/1,529, web 1,538/1,538, focused API 160/160,
JWKS/provider/wiring 90/90, focused web 99/99, dev live 1,524/1,524, final dev
Playwright 242 passed / 4 skipped / 0 failed, and all six modes. Shared JWKS cache and prewarm state are partitioned by URI
plus the complete effective policy so a lenient endpoint cannot weaken a
stricter endpoint; redirect memory is bounded and zero TTL is exact. PR #175
merged as `566ebd45`; dev revision `scimserver-dev--v566ebd45` serves v0.55.32
at 100% with all 60 endpoint IDs preserved and two revisions retained. Canary
and customer prod are unchanged.

The v0.55.31 context-preserving navigation rollback unit is merged and verified
on dev. Back uses in-app router history with safe direct-link fallbacks. Connect
method, Operations filters/pages, Discovery comparison state, and existing
list/drawer search state are URL-owned, so Back and refresh restore the complete
workflow. Evidence is focused Vitest 155/155, web coverage 1,534/1,534 across
115 files, search schemas 23/23, live 1,516/1,516, and final dev Playwright
241 passed / 4 skipped / 0 failed. The intended Users-tab baseline was inspected;
semantic masks and explicit surface-readiness assertions now reject positional
or shell-only false signals. PR #173 merged as `574d9135`; dev revision
`scimserver-dev--v574d9135` serves v0.55.31 at 100% with all 60 endpoint IDs
preserved and two revisions retained. Canary and customer prod are unchanged.

The v0.55.30 credential lifecycle rollback unit is merged and verified on dev.
Repository-owned atomic rotation prevents
partial replacement, explicit deactivate/activate remains reversible, and
inactive-only purge permanently removes bearer, OAuth, or WIF rows after
confirmation, with the inactive predicate enforced at the storage sink. Evidence
is API unit 5,159/5,159, API E2E 1,528/1,528, focused repository/controller
98/98, web 1,525/1,525, local/dev live 1,516/1,516, final dev Playwright
238 passed / 4 skipped / 0 failed, all six modes, both production builds, docs,
and Mermaid 712/712. PR #171 merged as `524906d0`; dev revision
`scimserver-dev--v524906d0` serves v0.55.30 at 100% with 60 endpoint IDs
preserved. Canary and customer prod are unchanged.

The v0.55.29 custom-resource observability rollback unit is merged and verified
on dev. Activity classifies dynamic
ResourceTypes from profile metadata, derived filters paginate correctly in both
backends, and generic updates emit SSE events. Global and endpoint Logs use one
URL-driven filter toolbar. Evidence is API unit 5,150/5,150 across 174 suites,
API E2E 1,525/1,525 across 96 suites, web 1,521/1,521 across 114 files,
affected API 144/144, affected web 103/103, browser 1/1, and local live
1,507/1,507. Dev live is also 1,507/1,507 and final dev Playwright is 238 passed
/ 2 intentionally skipped / 0 failed. PRs #167/#168/#169 are merged; revision
`scimserver-dev--v5ccafc7c` serves v0.55.29 at 100%, with 60 endpoints and IDs
preserved. Canary and customer prod are unchanged.

The v0.55.28 profile-authoritative resource UI is implemented locally on
`feat/profile-authoritative-resource-ui-v0.55.28`. Create dialogs and Manual
Provision share a bidirectional editable JSON/form surface; controls derive
from the live endpoint schema. Endpoint detail adds Service Provider Config,
and profile mutation invalidates every discovery/resource cache with safe
fallback for removed selected types. The dev fixture adds AIAgent and removes
the accidental Device platform enum. Evidence is full web 1,514/1,514, profile
Playwright 1/1, SPC Playwright 2/2, fixture self-test 16/16, production build,
and 25/25 route budgets. Full consolidation and deployment remain pending.

The v0.55.24 UI change is merged and verified on dev at revision
`scimserver-dev--v0ecf4f2d`, serving `ghcr.io/pranems/scimserver:0.55.24`.
Dev evidence is live SCIM 1,491/1,491, Playwright 230 passed / 4 skipped,
endpoint integrity 60 -> 60 with zero missing IDs, and two active revisions
including the v0.55.23 rollback target. Canary and customer prod were not
touched.

The v0.55.27 Workbench rollback unit is merged through PR #162 and deployed to
dev. Workbench offers static server/admin, selected endpoint, and
discovery-derived ResourceType request examples. Apply loads an editable
method/path/body/header draft; generated PATCH requests use a real resource id
and returned ETag. Enabled headers reach the executor while stored admin
Authorization remains authoritative. `PRTest-Auth-Methods-ISV-1` now publishes
Device plus User/Group provisioning extensions. Clean committed fixture script
`565aa19776fe03333c7df5a4940c84bd513b2f26` passed 8/8 self-tests and named dev
apply/rerun 34/34. Final evidence is web 1,505/1,505 with coverage ratchets,
local and dev live 1,500/1,500, Playwright 233 passed / 4 skipped / 0 failed,
all builds/budgets, and Mermaid 709/709. PR #163 merged the inspected intended
Manual Provision visual baseline. Canary and customer prod are untouched.

The change refines endpoint settings and Connect. Contextual
panes are collapsed; Users owns only its two lifecycle settings and Groups only
its three membership/deletion settings, while common endpoint behavior remains
in Settings. Connect presents four real methods in OAuth2/WIF/global-shared/
bearer order, each backed by its dedicated setting. Connection info carries
`enablementSource`, so the UI follows
the authoritative `profile.authentication.methods[]` override when present.
That precedence now covers WIF creation, diagnostics, token minting, discovery,
connection info, Connect, and Settings as well as bearer/OAuth/shared secret.
The broad endpoint overview always withholds plaintext credentials; Connect
uses the dedicated, audit-logged connection-info route for any disclosure under
`CredentialSecretVisibility=always`.
Credential cards now separate summary, primary actions, More, and export rows.

The canonical architecture for the next endpoint-profile/authentication work is
[PORTABLE_ENDPOINT_PROFILE_AUTHENTICATION_AND_DISCOVERY_DESIGN.md](PORTABLE_ENDPOINT_PROFILE_AUTHENTICATION_AND_DISCOVERY_DESIGN.md).
It preserves one portable `EndpointProfile` for schemas, resource types, SPC
inputs, endpoint settings, and non-secret method declarations. Credentials,
secret envelopes, resources, logs, server policy, and effective-state
provenance remain deployment-local. Discovery import is a normalized contract
baseline with an explicit fidelity report, never an endpoint clone. The target
implementation is intentionally outside PR #157 and is split into separate
read-model, profile-v2/import, canonical-write, consumer-alignment, and legacy-
migration rollback units.

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Name** | SCIMServer |
| **Purpose** | SCIM 2.0 provisioning visibility and monitoring tool for Microsoft Entra ID |
| **Repository** | `C:\Users\v-prasrane\source\repos\SCIMServer` |
| **API Root** | `C:\Users\v-prasrane\source\repos\SCIMServer\api` |
| **Frontend Root** | `C:\Users\v-prasrane\source\repos\SCIMServer\web` |
| **Standards** | RFC 7643 (Core Schema), RFC 7644 (Protocol), RFC 7642 (Concepts) |

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 24.x (Alpine in Docker) |
| **Language** | TypeScript | 5.x |
| **Framework** | NestJS | 11.x |
| **ORM** | Prisma | 7.x |
| **Database** | PostgreSQL 17 | (via Prisma, docker postgres:17, Debian-based to match Azure Flexible Server glibc) |
| **Frontend** | React | 19.x |
| **Bundler** | Vite | 7.x |
| **Auth** | JWT + Bearer token | @nestjs/jwt |
| **Testing** | Jest | 30.x with ts-jest |
| **Deployment** | Azure Container Apps | via Bicep IaC |

---

## 3. Key File Locations

### 3.1 API (NestJS Backend)

```
api/src/main.ts                                          # Bootstrap: NestFactory, CORS, prefix, pipes
api/src/modules/app/app.module.ts                        # Root module - all imports
api/src/modules/scim/scim.module.ts                      # SCIM feature module
api/src/modules/scim/controllers/
  endpoint-scim-users.controller.ts                      # Users CRUD controller
  endpoint-scim-groups.controller.ts                     # Groups CRUD controller
  endpoint-scim-bulk.controller.ts                       # Bulk Operations controller (RFC 7644 §3.7)
  endpoint-scim-discovery.controller.ts                  # SCIM discovery - PRIMARY endpoint-scoped (multi-tenant)
api/src/modules/scim/services/
  endpoint-scim-users.service.ts    (671 lines)          # Users business logic
  endpoint-scim-groups.service.ts   (722 lines)          # Groups business logic
  endpoint-scim-generic.service.ts  (1261 lines)         # Custom resource type CRUD
  bulk-processor.service.ts         (439 lines)          # Bulk operation processor with bulkId resolution
  scim-metadata.service.ts                               # buildLocation, timestamp
api/src/modules/scim/common/
  scim-service-helpers.ts           (353 lines)          # G17: parseJson, ensureSchema, enforceIfMatch, sanitizeBooleanStrings, ScimSchemaHelpers
api/src/modules/scim/dto/
  bulk-request.dto.ts                                    # BulkRequest/Response DTOs (RFC 7644 §3.7)
  create-user.dto.ts                                     # User creation DTO
  patch-user.dto.ts                                      # PATCH operations DTO
  create-group.dto.ts                                    # Group creation DTO
  patch-group.dto.ts                                     # Group PATCH DTO
  list-query.dto.ts                                      # Pagination/filter DTO
api/src/modules/scim/common/
  scim-constants.ts                                      # Schema URNs, pagination limits
  scim-types.ts                                          # ScimUserResource, ScimGroupResource, ScimListResponse
  scim-errors.ts                                         # createScimError()
api/src/modules/scim/utils/
  scim-patch-path.ts                                     # 9 exported patch path utilities
  base-url.util.ts                                       # buildBaseUrl() from request
api/src/modules/scim/controllers/
  scim-me.controller.ts                                  # /Me endpoint (RFC 7644 §3.11, v0.20.0)
  admin-credential.controller.ts                         # Per-endpoint credential CRUD (v0.21.0)
api/src/modules/scim/common/
  scim-sort.util.ts                                      # sortBy/sortOrder mapping utility (v0.20.0)
api/src/modules/endpoint/
  endpoint-config.interface.ts                           # 21 boolean + 2 enum + 14 numeric + 1 bespoke radio (38 settings)
  endpoint-context.storage.ts                            # AsyncLocalStorage for endpoint context
api/src/modules/scim/filters/
  scim-filter-parser.ts                                  # Filter AST attribute path extraction
api/src/modules/scim/interceptors/
  scim-content-type.interceptor.ts                       # Sets application/scim+json
api/src/modules/auth/
  shared-secret.guard.ts                                 # Global auth guard (JWT + legacy)
  public.decorator.ts                                    # @Public() route exemption
api/src/modules/logging/
  scim-logger.service.ts                                 # Central structured logger (AsyncLocalStorage, ring buffer, SSE, file transport)
  log-levels.ts                                          # 7 log levels (TRACE→OFF), 14 categories, LogConfig interface
  logging.service.ts                                     # RequestLog persistence (buffered DB writes, supports in-memory)
  log-config.controller.ts                               # Admin API: GET/PUT config, recent, audit, stream, download
  log-query.service.ts                                   # Shared query/stream/download logic
  request-logging.interceptor.ts                         # X-Request-Id, correlation context, duration, tiered log levels
  file-log-transport.ts                                  # Main + per-endpoint log files
  rotating-file-writer.ts                                # Size-based file rotation (pure Node.js fs)
  logging.module.ts                                      # @Global() module registration
api/src/modules/endpoint/
  endpoint.controller.ts                                 # Admin CRUD for endpoints
  endpoint.service.ts                                    # Endpoint business logic (supports in-memory mode)
api/src/modules/database/
  database.controller.ts                                 # Dashboard data APIs
  database.service.ts                                    # User/group/stats queries
api/src/modules/activity-parser/
  activity-parser.service.ts                             # Log -> human-readable activity
api/src/oauth/
  oauth.controller.ts                                    # Token + discovery endpoints
  oauth.service.ts                                       # JWT generation/validation
api/src/modules/prisma/prisma.service.ts                 # Extended PrismaClient
api/src/modules/web/web.controller.ts                    # SPA serving
api/prisma/schema.prisma                                 # 5 models: Endpoint, RequestLog, ScimResource, ResourceMember, EndpointCredential
```

### 3.2 Frontend (React SPA)

```
web/src/App.tsx                                          # Root component with routing
web/src/components/
  Header.tsx, RequestLogList.tsx, RequestLogDetail.tsx
  LogFilters.tsx, ActivityFeed.tsx, ManualProvisioning.tsx
  DatabaseExplorer.tsx
web/vite.config.ts                                       # Dev proxy to :3000
```

### 3.3 Infrastructure

```
infra/containerapp.bicep                                 # Container App definition
infra/containerapp-env.bicep                             # Environment (VNet-integrated)
infra/acr.bicep                                          # Azure Container Registry
infra/networking.bicep                                   # VNet, subnets (aca-infra, aca-runtime, private-endpoints)
infra/postgres.bicep                                     # Azure PostgreSQL Flexible Server
```

### 3.4 Legacy Files

> `endpoint-scim.controller.ts` was **deleted** (Feb 2026). It was a monolithic controller superseded by the split into Users, Groups, and Discovery controllers.

---

## 4. Development Commands

```powershell
# From api/ directory:
npm run start:dev           # NestJS with --watch (hot reload)
npm run build               # TypeScript compilation to dist/
npm run start               # Production mode (runs prisma migrate deploy first)
npm test                    # Run unit tests (Jest)
npm run test:cov            # Unit tests with coverage → coverage/
npm run test:e2e            # Run E2E suite
npm run test:e2e:cov        # E2E tests with coverage → coverage-e2e/
npm run test:cov:all        # Unit + E2E coverage combined
npm run test:all            # Unit + E2E + live smoke (full pipeline)
npm run test:ci             # Unit + E2E CI sequence
npm run test:smoke          # Live integration tests (PowerShell)
npm test -- --watch         # Watch mode
npm test -- --verbose       # Verbose output
npx prisma migrate dev      # Run migrations
npx prisma migrate deploy   # Apply migrations in production-compatible mode
npx prisma generate         # Regenerate Prisma client
npx prisma studio           # Visual DB browser

# From web/ directory:
npm run dev                 # Vite HMR dev server on :5173
npm run build               # Production build → api/public/

# Docker:
docker build -t scimserver -f Dockerfile .
docker-compose up           # Full stack
```

### 4.1 Runtime Reality Notes (Source-of-truth from code)

- **Do not use repo-root `npm start`** for API startup. Run from `api/` (`npm run start` or `npm run start:dev`).
- **Local API default port**: `3000` when `PORT` is not set (`api/src/main.ts`).
- **Docker runtime port**: `8080` (image `ENV PORT=8080`, `EXPOSE 8080`, healthcheck on `:8080`).
- **SCIM path compatibility**: requests to `/scim/v2/*` are rewritten to `/scim/*` at runtime middleware.
- **Production auth secrets required**: `SCIM_SHARED_SECRET`, `JWT_SECRET`, and `OAUTH_CLIENT_SECRET`.
- **Runtime tuning values are environment-dependent, and most are NOT yet configurable.** Before changing any timeout, retry, cache TTL, pool size, buffer, or cap, read [perf/RUNTIME_TUNING_AND_CONFIGURATION_REFERENCE.md](perf/RUNTIME_TUNING_AND_CONFIGURATION_REFERENCE.md) (X15) - it is the source-audited inventory of every such value with `file:line`, the three-tier configurability model, and a recommended value per deployment form factor. Three live traps recorded there:
  - `REQUEST_TIMEOUT_MS` sets **socket inactivity** and `keepAliveTimeout`, NOT request duration. `server.requestTimeout` and `server.headersTimeout` are never set, so requests are actually bounded by Node's implicit 300 s (X15-F2).
  - The Prisma pool is `max: 5` hardcoded and passes no `connectionTimeoutMillis`, so the `pg` default `0` applies - there is **no acquire timeout** (X15-F3).
  - `JWKS_CACHE_MAX_AGE_MS` defaults to 10 min, which is ~144x more aggressive than [Microsoft's published guidance](https://learn.microsoft.com/en-us/entra/identity-platform/signing-key-rollover) for its own signing keys (24 h TTL + 1 h background refresh). **Do not simply raise it** - the long TTL is only safe once W1.4 lands the background refresher (X15-F1).
- **When adding a new environment-dependent numeric setting**, follow the tier-2 pattern already implemented in [api/src/oauth/egress-policy.ts](../api/src/oauth/egress-policy.ts): a hardcoded default, a bounds constant shared with the endpoint-config validator, a server env resolver that falls through on invalid input rather than throwing, and a merge that lets a per-endpoint override win while clamping at both levels.

---

## 5. Architecture Patterns & Conventions

### 5.1 Code Style

- **Modules**: One module per feature domain (NestJS convention)
- **Controllers**: Thin - validate endpoint, set context, delegate to service
- **Services**: Fat - all business logic, SCIM protocol handling, DB access
- **DTOs**: class-validator decorators for request validation
- **Errors**: Always use `createScimError()` for SCIM-formatted errors
- **Constants**: Centralized in `scim-constants.ts` - never hardcode schema URNs
- **Types**: Shared interfaces in `scim-types.ts`

### 5.2 Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Controllers | `PascalCase` + `Controller` | `EndpointScimUsersController` |
| Services | `PascalCase` + `Service` | `EndpointScimUsersService` |
| DTOs | `PascalCase` + `Dto` | `CreateUserDto` |
| Interfaces | `PascalCase` | `EndpointConfig`, `ScimUserResource` |
| Files | `kebab-case` | `endpoint-scim-users.controller.ts` |
| Routes | SCIM convention: `/Users`, `/Groups` (PascalCase resource names) |
| DB Models | `PascalCase` | `ScimResource`, `ResourceMember`, `Endpoint` |

### 5.3 Data Storage Pattern

The project uses a **"payload (JSONB) + derived columns"** pattern:
- `payload`: Stores the FULL SCIM resource as JSONB (PostgreSQL native JSON type)
- Derived columns (`userName`, `active`, `externalId`, `displayName`): Extracted via CITEXT/VARCHAR for queries and uniqueness
- On read: `payload` is merged with server-managed fields (`id`, `meta`)
- On write: Full JSON is stored in `payload`, derived columns are also updated

### 5.4 Endpoint Isolation Pattern

All SCIM resources are scoped to an `endpointId`:
- Routes: `/scim/endpoints/{endpointId}/Users`
- DB queries: Always include `WHERE endpointId = ?`
- Uniqueness: Composite unique constraints include `endpointId`
- Context: `EndpointContextStorage` (AsyncLocalStorage) propagates endpoint context

### 5.5 Authentication Pattern

**3-tier fallback auth** via global `SharedSecretGuard` (v0.21.0, G11):
1. **Per-endpoint credentials** (if the credential type's dedicated setting is enabled and the endpoint has an active credential) - keyed HMAC verification for current tokens, with bcrypt verification for pre-migration tokens, then `req.authType = 'endpoint_credential'`
2. **OAuth 2.0 JWT** - `OAuthService.validateAccessToken()` (Bearer JWT) → `req.authType = 'oauth'`
3. **Global shared secret** - direct string comparison with `SCIM_SHARED_SECRET` → `req.authType = 'legacy'`
4. Public routes exempted via `@Public()` decorator

**Credential Admin API** (requires the dedicated setting for the requested credential type):
- `POST /scim/admin/endpoints/:id/credentials` - Generate 32-byte base64url token, store bcrypt hash (12 rounds), return plaintext once
- `GET /scim/admin/endpoints/:id/credentials` - List credentials (hash never returned)
- `DELETE /scim/admin/endpoints/:id/credentials/:credentialId` - Revoke (deactivate)

**Source files:**
- Guard: `api/src/modules/auth/shared-secret.guard.ts`
- Credential controller: `api/src/modules/scim/controllers/admin-credential.controller.ts`
- Credential repository: `api/src/modules/scim/repositories/endpoint-credential/`

### 5.6 Error Handling Pattern

```typescript
// Always use createScimError() - never throw raw HttpException for SCIM routes
throw createScimError({
  status: 409,
  detail: `User with userName "${userName}" already exists`,
  scimType: 'uniqueness'
});
```

### 5.7 PATCH Path Handling

Four categories of PATCH paths, handled in order:
1. **No path**: Merge value object into resource (normalize keys first)
2. **Simple path**: Direct property set (`active`, `displayName`)
3. **valuePath**: Bracket filter expression (`emails[type eq "work"].value`)
4. **Extension URN**: Full URN prefix (`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department`)

### 5.8 ReadOnly Attribute Stripping (v0.22.0)

POST/PUT payloads auto-strip `mutability:'readOnly'` attrs (`id`, `meta`, `groups`, custom readOnly) before business logic. PATCH ops targeting readOnly attrs are silently stripped when `StrictSchemaValidation` is OFF or `IgnoreReadOnlyAttributesInPatch` is ON. Warning URN (`urn:scimserver:api:messages:2.0:Warning`) attached when `IncludeWarningAboutIgnoredReadOnlyAttribute` enabled. Covers Users, Groups, AND Generic (custom) resource types.

**Source files:**
- Strip helpers: `api/src/modules/scim/common/scim-service-helpers.ts` (`stripReadOnlyAttributes()`, `stripReadOnlyPatchOps()`)
- Warning accumulation: `api/src/modules/endpoint/endpoint-context.storage.ts` (`addWarnings()`, `getWarnings()`)
- Middleware: `EndpointContextStorage.createMiddleware()` + `ScimModule.configure()` (Express middleware with `storage.run()`)
- Feature doc: `docs/READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md`

### 5.9 P2 Attribute Characteristic Enforcement (v0.24.0)

Six behavioral fixes from the RFC 7643 §2 attribute characteristics audit:

| Item | Description | Key Files |
|------|-------------|----------|
| R-RET-1 | Schema-driven `returned:'always'` at projection level - immune to `attributes=`/`excludedAttributes=` | `scim-attribute-projection.ts` |
| R-RET-2 | Group `active` always returned | `scim-attribute-projection.ts` |
| R-RET-3 | Sub-attribute `returned:'always'` enforcement (e.g., `emails.value`, `members.value`) | `scim-attribute-projection.ts`, `schema-validator.ts` |
| R-MUT-1 | `writeOnly` mutability → `returned:never` defense-in-depth | `schema-validator.ts` |
| R-MUT-2 | readOnly sub-attr stripping within readWrite parents (core+ext, single+multi-valued) | `scim-service-helpers.ts` |
| R-CASE-1 | caseExact-aware in-memory filter evaluation (`caseExactAttrs` set) | `scim-filter-parser.ts`, `apply-scim-filter.ts` |

**Source files:**
- Projection: `api/src/modules/scim/common/scim-attribute-projection.ts` (`applyAttributeProjection()` with 6 params, `includeOnly()` with 4 params)
- Collector: `api/src/domain/validation/schema-validator.ts` (`collectReturnedCharacteristics()` returns `alwaysSubs` map, `collectCaseExactAttributes()`, `collectReadOnlyAttributes()` returns `coreSubAttrs`/`extensionSubAttrs`)
- Strip helpers: `api/src/modules/scim/common/scim-service-helpers.ts` (`getAlwaysReturnedAttributes()`, `getAlwaysReturnedSubAttrs()`, `getCaseExactAttributes()`)
- Filter: `api/src/modules/scim/filters/scim-filter-parser.ts` (`compareValues()` with 4th param `caseExact`, `evaluateFilter()` with 3rd param `caseExactAttrs`)
- Feature doc: `docs/P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md`

---

## 6. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **PostgreSQL 17** (migrated from SQLite in Phase 3) | Production-grade RDBMS with CITEXT for case-insensitive columns, JSONB for schema-free SCIM attributes, GIN indexes for filter push-down |
| **payload as JSONB** | SCIM resources have arbitrary attributes; structured columns can't capture all; JSONB preserves fidelity with native query support |
| **Derived columns** | Indexed VARCHAR/CITEXT columns for uniqueness constraints and efficient filtering |
| **CITEXT columns** | RFC 7643 §2.1 requires case-insensitive userName uniqueness; PostgreSQL CITEXT handles this natively |
| **AsyncLocalStorage** | Endpoint context propagation without threading endpoint ID through every method signature. Uses `storage.run()` via Express middleware (not `enterWith()`) to ensure context survives NestJS interceptor pipeline boundaries. |
| **Repository Pattern** | `IUserRepository`/`IGroupRepository` interfaces with `PERSISTENCE_BACKEND` env toggle (prisma/inmemory) |
| **Dual auth** | OAuth for production clients (Entra); legacy token for simple testing/debugging |
| **Global prefix `/scim`** | All routes under `/scim/`; URL rewrite middleware supports `/scim/v2` for spec compliance |
| **Filter push-down** | All 10 SCIM operators pushed to PostgreSQL WHERE clauses; compound AND/OR supported; no in-memory filtering |

---

## 7. Current Compliance Status

### 7.1 SCIM 2.0 Compliance

| Feature | Status |
|---------|--------|
| ✅ Users CRUD (POST/GET/PUT/PATCH/DELETE) | Complete |
| ✅ Groups CRUD (POST/GET/PUT/PATCH/DELETE) | Complete |
| ✅ PATCH (add/replace/remove, valuePath, extension URNs, no-path merge) | Complete |
| ✅ Case-insensitive behavior (RFC 7643 §2.1) | Complete |
| ✅ Discovery endpoints | 100% - All 6 gaps (D1-D6) resolved. Two-tier multi-tenant architecture: root-level (global defaults) + endpoint-scoped (primary, per-tenant overlays). See [DISCOVERY_ENDPOINTS_RFC_AUDIT.md](../docs/DISCOVERY_ENDPOINTS_RFC_AUDIT.md) |
| ✅ Pagination (startIndex, count) | Complete |
| ✅ Filtering operators (`eq`, `ne`, `co`, `sw`, `ew`, `gt`, `ge`, `lt`, `le`, `pr`) | Complete |
| ✅ Attribute projection (`attributes`, `excludedAttributes`) | Complete |
| ✅ ETag / If-None-Match conditional GET behavior | Complete |
| ✅ Sorting (`sortBy`, `sortOrder`) | Complete (v0.20.0, `sort.supported=true`) |
| ✅ Bulk operations (`/Bulk`) | Complete (v0.19.0, RFC 7644 §3.7, `BulkOperationsEnabled` flag) |
| ✅ `/Me` endpoint | Complete (v0.20.0, JWT sub → userName identity resolution) |
| ✅ Per-endpoint credentials | Complete (dedicated bearer/OAuth/WIF settings, keyed tokens, legacy bcrypt verification, 3-tier fallback) |
| ✅ ReadOnly attribute stripping | Complete (v0.22.0, RFC 7643 §2.2, `IncludeWarningAboutIgnoredReadOnlyAttribute` + `IgnoreReadOnlyAttributesInPatch` flags, warning URN extension) |
| ✅ P2 attribute characteristic enforcement | Complete (v0.24.0, 6 behavioral fixes: R-RET-1 schema-driven always-returned, R-RET-2 Group active always, R-RET-3 sub-attr always, R-MUT-1 writeOnly→never, R-MUT-2 readOnly sub-attr stripping, R-CASE-1 caseExact filter) |

### 7.2 Microsoft Entra ID Compatibility

- ✅ Critical provisioning flows validated
- ✅ Microsoft SCIM Validator: 25/25 pass (+ 7 preview)
- ✅ OAuth client credentials + bearer token flows operational

---

## 8. Test Coverage

> 📊 See [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md#test-suite-summary) for current test counts.

- **Unit** and **E2E** - all passing (0 failures). **Unit**: 4,922 (173 suites, measured 2026-09-16). **E2E**: 1,521 (96 suites, measured on both InMemory and Prisma). **Web vitest**: 1,302 (105 files, unchanged). **Live integration**: local and Docker v0.55.23 **1,484/1,484**; dev **1,484/1,484**; canary post-flip **1,485/1,485**. **Playwright**: N/A for v0.55.23 behavior (no web change); deployment regression coverage passed on dev and canary, with canary **205 passed / 4 skipped**
- **SCIM Validator**: 10/12 mandatory (2 FP on Lexmark returned:never), 25/25 on standard profile + 7/7 preview
- Test runners: `npm test`, `npm run test:e2e`, `npm run test:smoke`
- Coverage runners: `npm run test:cov`, `npm run test:e2e:cov`, `npm run test:cov:all`
- Full pipeline: `npm run test:all` (unit + E2E + live smoke)
- Coverage includes SCIM CRUD, PATCH path variants, case-insensitivity, filtering, projection, ETag behavior, endpoint isolation, auth, logging config, admin operations, and SCIM validator compliance scenarios.

---

## 9. Session History & Completed Work

### Phase 13: Endpoint Profile Configuration (v0.28.0) → Phase 14: Legacy Removal (v0.29.0)
- Unified `Endpoint.profile` JSONB replaces fragmented `config` + `EndpointSchema` + `EndpointResourceType`
- 6 named presets (entra-id default, entra-id-minimal, rfc-standard, minimal, user-only, user-only-with-custom-ext)
- RFC-native SCIM discovery format as configuration input with auto-expand + tighten-only validation
- New API: `GET /admin/profile-presets` (read-only, 6 presets)
- Prisma schema: 5 models (Endpoint, RequestLog, ScimResource, ResourceMember, EndpointCredential)
- 28 files deleted (~4,800 lines removed), 13 new files created
- Design doc: `SCHEMA_TEMPLATES_DESIGN.md` (2,349 lines, 47 code blocks, 19 Mermaid diagrams)

### Phase 1: PATCH Compliance Fixes
- Fixed `op` case-insensitivity (lowercase comparison)
- Added extension URN path support for PATCH
- Added valuePath filter support for PATCH
- Added no-path PATCH merge
- Added 29 new tests (290 → 294)

### Phase 2: Code Cleanup & Refactoring  
- Fixed 12 Prisma TypeScript errors
- Removed 4 legacy SCIM files
- Refactored `endpoint-scim.controller.ts` (deleted) into:
  - `endpoint-scim-users.controller.ts`
  - `endpoint-scim-groups.controller.ts`
  - `endpoint-scim-discovery.controller.ts`

### Phase 3: Case-Insensitivity (RFC 7643 §2.1)
- Added CITEXT columns for userName, externalId (case-insensitive uniqueness)
- Case-insensitive userName uniqueness enforcement
- Case-insensitive filter attribute names
- Case-insensitive schema URI validation
- Case-insensitive extension URN matching
- `normalizeObjectKeys()` for no-path PATCH
- Case-insensitive property lookup in `matchesFilter()`
- `sort.supported: false` across all configs
- 23 new tests (294 → 317)

### Phase 4: Documentation (Current)
- Technical Requirements Document
- Technical Design Document
- Context Instructions (this file)
- Design Improvement Recommendations

---

## 10. Important Gotchas & Warnings

1. **`endpoint-scim.controller.ts` was deleted** - superseded by Users, Groups, and Discovery controllers
2. **payload is JSONB** - native JSON type in PostgreSQL; use Prisma's JSON operations for queries
3. **PostgreSQL CITEXT** - userName and externalId use CITEXT for case-insensitive uniqueness; no derived `*Lower` columns needed
4. **Filter push-down** - ALL 10 SCIM operators are pushed to PostgreSQL WHERE clauses; compound AND/OR supported. No in-memory post-fetch filtering.
5. **Blob backup removed (v0.23.0)** - `BackupService`, `BackupModule`, `blob-restore.ts`, and `infra/blob-storage.bicep` were deleted. PostgreSQL uses Azure-native WAL backup (configured via `backupRetentionDays` in `postgres.bicep`). `@azure/identity` and `@azure/storage-blob` npm packages also removed.
6. **Auto-generated secrets** - In dev mode, `SCIM_SHARED_SECRET` and `OAUTH_CLIENT_SECRET` are auto-generated and logged to console. NEVER do this in production.
7. **ValidationPipe whitelist: false** - We do NOT strip unknown properties, because SCIM resources have arbitrary attributes in extensions
8. **The `/scim/v2` rewrite** - Express middleware in `main.ts` rewrites `/scim/v2/*` to `/scim/*` for spec compliance
9. **SchemaValidator** - 1,664-line pure domain class for RFC 7643 payload validation. Gated behind `StrictSchemaValidation` config flag. Validates type, mutability (readOnly + immutable), required attrs, unknown attrs, sub-attributes, canonicalValues, size limits. New: `collectBooleanAttributeNames()` for schema-aware boolean coercion, `collectReadOnlyAttributes()` for readOnly stripping, `validateFilterAttributePaths()` for filter validation (V32).
10. **Repository Pattern** - `IUserRepository`/`IGroupRepository` interfaces injected via tokens. `PERSISTENCE_BACKEND` env var toggles between `prisma` and `inmemory` implementations.
11. **G2 is DONE + G17 RESOLVED (v0.20.0)** - Database uses a single unified `ScimResource` table. G17 service code deduplication completed: 13+ duplicate private methods extracted into `scim-service-helpers.ts` (`parseJson`, `ensureSchema`, `enforceIfMatch`, `sanitizeBooleanStrings`, `ScimSchemaHelpers`). All 27 migration gaps (G1-G20) are now closed.
12. **3-tier auth guard** - `SharedSecretGuard` now implements 3-tier fallback: per-endpoint bcrypt credentials → OAuth JWT → global `SCIM_SHARED_SECRET`. Per-endpoint credentials use lazy-loaded native bcrypt (12 rounds, cached after first use). Active + non-expired credentials only.
13. **CORS wildcard** - `main.ts` sets `origin: true` (accept all origins). Should be restricted for production deployments.

---

## 11. Quick Reference - Creating New Features

### Adding a new SCIM attribute to Users:
1. No schema change needed (stored in `payload` JSONB)
2. If needed for queries/uniqueness: add derived column in `schema.prisma`
3. Update `formatUserResponse()` if special handling needed
4. Update `matchesFilter()` if it should be filterable
5. Add tests

### Adding a new endpoint config flag:
1. Add to `ENDPOINT_CONFIG_FLAGS` in `endpoint-config.interface.ts`
2. Add to `EndpointConfig` interface
3. Read via `getConfigBoolean()` (defaults absent → `false`) or `getConfigBooleanWithDefault()` (custom default - used for `AllowAndCoerceBooleanStrings` which defaults to `true`)
4. Update `validateEndpointConfig()` if needed
5. Add tests
6. Update [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) - flag summary table (§2), defaults matrix (§2.1), and true/false behavior (§2.2)
7. Add the Switch to [SettingsTab.tsx](../web/src/pages/SettingsTab.tsx) `BOOLEAN_FLAGS` (it carries a `data-testid` of `settings-flag-<Key>` automatically) plus a vitest case, a Playwright spec asserting a measured OUTCOME (not just that the Switch renders), and a `live-test.ps1` section

> **Flag defaults quick ref:** `AllowAndCoerceBooleanStrings`, `UserSoftDeleteEnabled`, `UserHardDeleteEnabled`, `GroupHardDeleteEnabled`, `MultiMemberPatchOpForGroupEnabled`, `SchemaDiscoveryEnabled`, `StrictSchemaValidation`, `EnforceResourceTypes`, and `logFileEnabled` default to `true`. `PatchOpAllowRemoveAllMembers`, `VerbosePatchSupported`, `RequireIfMatch`, `SecretTokenBearerAuthEnabled`, `OAuthClientCredentialsAuthEnabled`, `WifCredentialsEnabled`, `IncludeWarningAboutIgnoredReadOnlyAttribute`, `IgnoreReadOnlyAttributesInPatch`, and `RfcCompliantSubAttributes` default to `false`. `SharedSecretBearerAuthEnabled` defaults to `true`. `PrimaryEnforcement` defaults to `passthrough`. When no profile/preset is specified on endpoint creation, the `entra-id` preset is applied (sets several flags, PrimaryEnforcement to `normalize`).
>
> **`RfcCompliantSubAttributes` is standalone, and only ever TIGHTENS.** It is NOT gated on `StrictSchemaValidation` - the two answer different questions (how carefully do I police this payload vs is this schema shape legal at all). Enforce it in exactly one place per service (`enforceSubAttributeNesting`), BEFORE the strict branch, so the rejection is attributed to the flag that caused it. It governs ONE rule: RFC 7643 2.3.8 complex sub-attributes. A multi-valued SIMPLE sub-attribute (2.3.8 does not forbid it; 1.2 + erratum 5607 permit it) is honoured by `StrictSchemaValidation` itself at any flag setting - that was a validator defect, not a policy, so do NOT re-gate it on the flag. See [RFC_COMPLIANT_SUBATTRIBUTES.md](RFC_COMPLIANT_SUBATTRIBUTES.md).

### Adding a new admin API route:
1. Add method to appropriate controller (`AdminController`, `DatabaseController`, etc.)
2. Add service method
3. Route is auto-prefixed with `/scim/admin/`
4. Authentication applied automatically (global guard)
5. Add tests

---

*This document should be the FIRST thing read at the start of any AI-assisted coding session.*
