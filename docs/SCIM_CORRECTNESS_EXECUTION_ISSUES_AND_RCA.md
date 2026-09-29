# SCIM correctness implementation: issues and lessons

> **Last verified:** 2026-09-28
>
> **Status:** Implementation ledger, updated when an issue is confirmed
>
> **Design and progress:** [SCIM correctness design](SCIM_CORRECTNESS_DESIGN_AND_IMPLEMENTATION.md)

## Purpose

This ledger records problems encountered while delivering the fixes, not only
the product defects being fixed. Each entry states what failed, why, how it was
resolved, and what will prevent the same mistake. Full execution logs remain
in ignored test-results directories.

The [independent analysis](SCIM_FRESH_MASTER_ANALYSIS_2026-09-25.md) and its
database evidence retain the earlier investigation history. They are not
rewritten as implementation success.

## Entries

P1 confirmed implementation issues and their detection-stage analysis are in
[SCIM_P1_EXECUTION_RCA.md](SCIM_P1_EXECUTION_RCA.md). The original entries below
remain the design-preparation record.

| ID | Type / severity | Symptom | Root cause | Resolution and why it works | Earliest possible / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| I01 | Tooling / Low | Knowledge-graph overlay cannot be produced | This worktree has no `.understand-anything/knowledge-graph.json` | Use actual Git/source/tests as evidence; do not invent graph nodes | Intake / intake | Optional graph generation remains separate; not a product blocker |
| I02 | Reproducibility / Medium | Historical reproducers would reject HEAD after a documentation commit | Their source guard intentionally requires the exact original baseline | Document a detached baseline replay worktree and copy only the committed analysis harness into it | Before commit / before commit | Do not weaken database or source guards to get a green run; permanent implementation tests must record their own tip |
| P3-I01 | Persistence / High | Same-version HTTP PUT/PATCH both returned 200 and stored v3; concurrent DELETE returned 404 to the loser | Services checked a snapshot, then repositories wrote by internal id without a version predicate | Optional expected version now participates in the actual Prisma mutation or synchronous InMemory map mutation; Group checks inside its aggregate transaction. New current-source harness: `scripts/scim-conditional-writes/run.cjs`; first GREEN `test-results/conditional-writes/postgres-72183a7df22c1b3c`, 24/24 per backend | Repository unit / deterministic HTTP plus real database | Permanent barriers call original repositories; verify one winner, v2 and winner fields, not just success status |
| P3-I02 | Backend parity / High | InMemory stored two case-insensitive duplicate User names and accepted conflicting renames | Only an awaited service uniqueness precheck existed; PostgreSQL already had CITEXT uniqueness | Check name collision synchronously before create/update map mutation, excluding only the current internal id; test endpoint isolation and versions 1/2 after conflicting renames. Same first GREEN as P3-I01 | Repository unit / dual-backend HTTP | No redundant migration. Group/schema-driven uniqueness is explicitly P3b, not claimed fixed |
| P3-I03 | Capability / Medium | Custom resource PATCH rejected stale If-Match even when ETags were disabled | Generic service did not supply its resolved endpoint profile to the existing helper | All three Generic write methods now use the same profile-aware helper as User/Group; ETag-disabled test passes on both backends | Service unit / dual-backend HTTP | Cover on/off capability and wildcard separately from version-specific comparisons |
| P3-I04 | Test correctness / Low | First new error-envelope check rejected the legitimate Diagnostics extension | Test used an invented ErrorDetail URN instead of the existing response contract | Corrected allowlist to the published Diagnostics URN before production edits; corrected RED is 13 InMemory and 10 PostgreSQL failures, not the earlier 22/22 fixture-contaminated totals | Fixture review / first HTTP RED | Separate harness/fixture errors from product RED; retain both run records |
| P3-I05 | Environment/tooling / Low | New worktree lacked Jest; an early PowerShell brace-list read failed | Worktree dependencies are not copied, and PowerShell does not support shell brace expansion | First validation attempt confirmed missing dependency; owned junction reuses frozen installed API dependencies read-only, and Prisma generation targets this worktree's `api/src/generated` only. Read files with explicit paths | Intake / intake | No install or lockfile rewrite, no shared generated-client writes; container config tool was unavailable, so the checked-in Docker CLI runner was used |
| P3-I06 | Test maintenance / Low | 40 neighboring unit assertions failed after the optional write argument and atomic uniqueness were introduced | Strict mocks counted `undefined` as an extra argument; old uniqueness-unrelated fixtures reused `Alice`; old missing-row assertions depended on adapter-specific text | Updated exact expected arguments, made fixture names distinct, and asserted typed NOT_FOUND codes. Targeted suite is 689/689 GREEN at this checkpoint | Unit / unit | Keep wire behavior assertions separate from adapter diagnostic text; do not weaken duplicate tests to preserve invalid fixtures |
| P3-I07 | Harness/typing / Low | Expanded suite failed compilation while unchanged ETag suite passed; initial listener smoke failed because the server was already listening | Union spy rest arguments were not tuples; Nest `getHttpServer` has no method generic; shared helper already binds an ephemeral server | Use explicit typed spy parameters, type the HTTP boundary, and rebind the existing owned server to loopback. Failures remain setup failures, not protocol RED. InMemory expanded tests then reached 27 passing behavioral cases | Test compile / matrix setup | Runner records runtime-error suites and checks exit status, not only failed-test count; smoke new harness code before repeating both database lanes |
| P3-I08 | Framework surprise / Medium | Live PowerShell POST returned 201 but subsequent PATCH targeted a missing id and returned 404 | `Invoke-WebRequest` returned `application/scim+json` content as `byte[]`; piping to ConvertFrom-Json parsed individual byte numbers rather than one resource | Decode byte content as UTF-8 before JSON parsing, assert created id exists, then rerun smoke: 33 assertions passed across User/Group/Device | Live author smoke / live author smoke | New live runner normalizes string/byte content at its transport boundary; status-only checks are insufficient |
| P3-I09 | Documentation environment / Low | Renderer initially skipped; relative-link sweep found three missing historical Session links; renderer discovery reports built-in version 0.0.0 | Worktree had no web/root dependencies; historical Session links refer to removed specs/local editor settings; built-in version metadata is not usable | After the missing-dependency attempt, owned read-only junctions reuse installed tooling. Five diagrams render in both strict themes. Three broken links are verified unchanged from HEAD and accepted outside this narrow package | Doc check / doc check | Do not describe SKIP as render proof or reinstall a fictitious Mermaid 0.0.0; parent consolidation may repair old Session links separately |
| P3-I10 | Handoff tooling / Low | First post-commit handoff generator had a JavaScript syntax error; later shell cleanup still ran | A stray quote in a regex broke the inline generator, and PowerShell semicolon sequencing did not propagate that native exit status | Rebuilt the handoff with a guarded fingerprint command and a PowerShell object. Verified the committed API/scripts fingerprint exactly matches final tested source; handoff lists all 39 files. Three owned dependency junctions were removed and worktree remains clean | Handoff syntax / final artifact verification | Check LASTEXITCODE before dependent shell actions; verify the artifact exists instead of trusting the final command's exit code |
| P5-I01 | Protocol / High | RFC search arrays returned 400 for Users/Groups and 500 for custom resources | String-only DTOs rejected arrays; the unvalidated generic body reached a string-only projection function | Shared typed DTO plus explicit array-to-query adapter; all 61 focused HTTP checks pass on both backends | Normative HTTP assertion / P5 RED | Permanent array, legacy string, GET, nested projection and key/value tests |
| P5-I02 | Error contract / Medium | Multiple genuine DTO errors produced array-valued `detail` | The exception wrapper copied Nest `message` without normalizing the scalar SCIM field | Join string messages with semicolons only at the SCIM boundary; preserve diagnostic lists and OAuth passthrough | Error-body assertion / P5 RED | Genuine invalid pagination/order tests in all three families plus error filter units |
| P5-I03 | Framework coercion / Medium | Some malformed arrays passed User/Group DTO validation | Implicit conversion of a property reflected as String changed inputs before validation | Union-typed boundary keeps the original array/object shape; validator rejects mixed, nested, blank, comma-bearing and oversized arrays | Adversarial DTO/HTTP tests / P5 RED | Invalid shape corpus, including null, plus aggregate/item bounds |
| P5-I04 | Tooling / Low | Editor test/problems/container-config tools were unavailable; first CLI test could not find Jest | Isolated worktree has no installed dependencies; editor providers cannot address this worktree | Use existing CLI runners after observed missing dependency, with a removable junction to installed API tooling; generate Prisma exclusively into this worktree | Tool invocation / same | Never count unavailable tooling or compile failure as behavioral RED |
| P5-I05 | Test correctness / Low | Initial HTTP corpus failed TypeScript before execution; legacy hardening tests then expected the old decorator name | Fixture IDs were typed unknown; two tests asserted `maxLength` rather than the bound's message | Give HTTP fixtures explicit wire types; assert the new validator still rejects above 2000 characters | Compile / same; focused unit / same | Keep boundary validation assertions about accepted/rejected values and policy, not framework implementation names |
| P5-I06 | Tooling / Low | Shell probes failed or returned oversized logs | Bash-style brace expansion is invalid in PowerShell; a selector matched two helper names; broad context returned too much output | Explicit paths and anchored searches; bounded summaries and persisted logs | Local command / same | One precise selector and bounded output per evidence query |
| P5-I07 | Test tooling / Low | Explicit lint of the new E2E file rejected untyped Supertest bodies | The existing API lint normally scopes `src`; the new targeted run included `test/e2e` under stricter unsafe-access rules | Model wire resource/list/error interfaces, keeping runtime key/value assertions | Focused lint / same | New HTTP regression files are explicitly included in focused lint |
| P5-I08 | Harness / Medium | Cleanup hardening initially removed the wrong URL assignment; identity check rejected inert port 1 before any migration | A patch matched the first identical statement rather than the cleanup block | Restore the setup assignment and anchor cleanup by its enclosing block; run `b01b97e27edd4260` passed both backends | Ownership guard / same | Guard remains fail-closed; cleanup verifies owner independently of runtime health |
| P5-I09 | Harness isolation / High | A concurrently created E2E marker could override the previously verified database URL | Ordinary app bootstrap rediscovers a marker after global setup | Owned bootstrap re-verifies and explicitly pins the actual app URL, skipping marker reads; RED showed unowned URL winning, GREEN proves pinned selection and no marker read | Bootstrap isolation test / independent code review | Permanent three-test no-I/O regression; four fail-closed harness controls retained |
| P5-I10 | Harness readiness / Medium | Socket readiness can precede TCP readiness during PostgreSQL initialization | Official image starts a temporary socket-only server first | Probe `pg_isready -h 127.0.0.1`, then verify identity through the published loopback port | Readiness review / independent code review | Explicit TCP readiness; fresh 22-migration run `9730861ef88ffd7d` and both backends pass |
| P5-I11 | Documentation/tooling / Low | Initial render commands reported SKIP; full link scan found old missing links; renderer reports version 0.0.0 | Isolated root/web tooling was absent; Session historical links predate this work; built-in renderer detector has known sentinel drift | Restore frozen root/web tooling after missing-tool evidence; all four diagrams render with pinned 11.15.0 in both strict themes; compare link findings against HEAD | Doc validation / same | SKIP is not PASS; retain 3 baseline missing links and renderer-version uncertainty as explicit consolidation notes |
| P5-I12 | Supply-chain status / Medium | Frozen web tooling install reports 12 high and 3 moderate vulnerabilities; root reports 2 moderate | Existing locked dependency audit status, not a dependency edit | No audit-fix or lockfile regeneration; immutable manifests checked; forward report to consolidation | Frozen install / same | Dependency remediation remains separate parent-owned work; no claim of a clean CVE gate |

### P5 evidence and dispositions

See [the P5 implementation report](SCIM_SEARCH_CONTRACT_IMPLEMENTATION.md).
Confirmed local results: 354 focused unit tests; 61 HTTP tests per backend;
61 local live assertions. The PostgreSQL run replayed all 22 migrations on
PostgreSQL 17.8 and removed its verified task-owned container. No historical
evidence, shared database, product version, cloud deployment, or customer data
was changed.

**Test/gate improvement: applied.** Previously green legacy string tests did
not prove RFC array support. The new corpus tests both shapes, actual projected
values, malformed shape limits, and a genuinely invalid DTO error separately.
The standalone live section is also wired into the main live runner.

**Design/architecture disposition: accepted.** One cohesive validator and one
boundary adapter serve three actual consumers. Existing projection, repository
and query internals remain unchanged. A controller hierarchy or query rewrite
would be speculative and outside P5.

**Completeness provenance:** recorded from this isolated P5 worktree's commands,
independent review and saved RED/GREEN logs as issues were resolved. No full
parent transcript was supplied to this worker; transcript-wide reconciliation
remains a consolidation gate, not a claimed completed check.

### P6a issues

| ID | Type / severity | Symptom | Root cause | Resolution and why it works | Earliest possible / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| P6-I01 | Environment / Low | Jest was missing, then PrismaService types were unavailable | A fresh worktree has neither dependencies nor a generated client | After the actual failures, reuse an owned dependency junction and generate from this worktree's schema with an inert URL; the focused tests then execute | First test command / same | Never count import/setup errors as RED; preserve frozen dependencies |
| P6-I02 | Test fixture / Low | Group fixture failed creation instead of exercising its Bulk capability | DTO supplies `members`, but the minimal schema omitted it | Include `members`, rerun against the baseline, then observe all seven intended behavior assertions fail | Fixture setup / first run | Positive fixture creation precedes negative capability assertions |
| P6-I03 | Test contract / Low | A Bulk test expected a diagnostics extension that the documented embedded envelope does not expose | Assumed direct and embedded error shapes were identical | Assert the exact existing Bulk error envelope, including scalar status/detail, then verify unchanged stored state | Test authoring / first GREEN attempt | Check the public envelope before writing shape expectations |
| P6-I04 | Test typing / Low | New test lacked ResourceType description and unsafe Supertest values failed lint | Incomplete typed fixture and raw library body access | Supply the required description, guard resource IDs, and reuse shared HTTP helpers; new test lint and unit/HTTP tests pass | Type/lint check / focused validation | New tests must compile and pass their applicable type-aware lint rules |
| P6-I05 | Tooling / Low | Local readiness command had a PowerShell catch syntax error | Missing whitespace before a typed catch clause | Corrected the command, verified health, ran 7/7 smoke checks and stopped the owned process | Shell parse / same | Use valid typed catch syntax; readiness must succeed before smoke |
| P6-I06 | Design/test correctness / Medium | The first shared read guard blocked `/Me` when client filtering was disabled | `/Me` uses the User service's filtered lookup internally; an internal lookup is not a client query capability | Added a failing `/Me` regression, retained User/Group query guards at their existing HTTP boundary, and kept custom list plus all PATCH checks at their service boundary; 69 HTTP and 346 unit tests pass | Cross-flow design review / focused review before commit | Every capability move must identify internal callers and include an unaffected-caller control |
| P6-I07 | Test tooling / Low | Two PostgreSQL attempts stopped before migration/tests | First guard compared different IP/CIDR forms; the next inline script shadowed the global URL constructor used by pg | Final runner reuses the existing ownership/database guards, normalizes CIDR for address comparison, and uses `databaseUrl`; 22 migrations and 69 PostgreSQL HTTP tests pass, exact container removed | Runner initialization / same | Do not weaken ownership checks; preserve failed setup separately from behavior evidence; avoid globals named URL |

## Initial integration, 2026-09-28

| ID | Type / severity | Symptom | Root cause | Resolution and why it works | Earliest possible / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| C0-I01 | Integration / High | P1 and P3 live helpers were not reachable from the main runner; P5 and P6a both used `9z-CO` | Independently valid package runners do not prove their combined entry-point wiring | Three permanent wiring regressions failed, then passed after one shared section invokes all four packages under `9z-CO` through `9z-CR`. P1/P3 retain their guarded standalone entry points and share only explicit-target HTTP assertions | Entry-point contract / initial assembly | `live-correctness-wiring.spec.ts` locks reachability, pre-cleanup ordering, and distinct sections. Live execution/cleanup proof is recorded below when confirmed |
| C0-I02 | Merge/process / Low | Shared progress, INDEX and RCA edits conflicted | Each package correctly updated the same baseline independently | Retained every package link and issue row, combined progress as integrated rather than deployed, and retained all source commits via ordered cherry-picks | Cherry-pick / same | No blanket ours/theirs, no overwritten historical analysis, and combined overlap suites before handoff |
| C0-I03 | Environment/tooling / Low | Initial build could not find `tsc`; next build could not find generated Prisma client; editor Problems provider failed | Fresh integration worktree has no dependency tree, generated client or usable editor provider | After observed failures, reuse one owned API dependency junction without modifying its target; generate Prisma only into the integration worktree and validate through CLI with an explicit inert URL | Build intake / same | No package install, version/lock rewrite, inherited database, or shared generated-client mutation |
| C0-I04 | Documentation / Medium | F4 source coupling rejected Custom Extensions and Schema Customization guides | P1 changed `schema-validator.ts`, but these two source-bound guides had no corresponding package update | Add operator-facing typed-selector, strict-off syntax, namespace/caseExact and diagnostic notes with explicit not-deployed status. Fifteen literal JSON blocks in edited docs parse; content audit passes. The coupled gate's explicit BaseRef mode compares committed HEAD, so final-range verification follows this commit rather than pretending uncommitted changes are visible | Package source-coupling audit / initial integration | Keep the existing F4 gate unchanged; a feature-specific implementation report does not replace each bound operator guide |
| C0-I05 | Integration/test coverage / Medium | P8a added endpoint freshness under `9z-CR`, already owned by conditional writes | Independently chosen section identifiers collided; the original uniqueness regression inspected shared helpers but not new declarations in the main script | Two focused regressions failed with missing shared invocation and 4 distinct identifiers for 5 declarations. Move P8a into the shared orchestrator as `9z-CS` and inspect identifiers across the main script and both helper layers. All three wiring tests pass within 166 focused units | Entry-point/section contract / P8a assembly | Applied: future main-script additions cannot evade this integration-section uniqueness check. P8a's dedicated endpoint cleanup and optional two-reader arguments remain unchanged |
| C0-I06 | Integration / Low | P8c declared `9z-CS`, already assigned to P8a | Source packages authored against separate snapshots cannot reserve global live-section IDs | Existing cross-runner uniqueness coverage caught six declarations with only five identifiers; the new package-route assertion also failed. Move P8c into the shared orchestrator as `9z-CT`. All 175 units, 30 InMemory HTTP cases and 86 live checks pass; endpoint collection remains identical | Existing integration regression / P8c assembly | Applied: extend the package invocation inventory, retain the cross-main/helper uniqueness gate, and preserve P8c's dedicated fixture cleanup and optional second reader |

**Test/gate improvement: applied.** Package-local live success is now paired
with a main-runner reachability/section regression. A helper existing on disk
does not establish deployment-runner coverage.

**Design/architecture disposition: accepted.** One small live orchestrator
coordinates four actual package contracts. Production services are unchanged
by the wiring fix; guarded source/database harnesses remain distinct from
explicit-target HTTP helpers. No universal protocol executor or new runner
framework is introduced.

**Initial integration provenance:** source commits, their package receipts,
this worktree's complete command results, and ignored
`test-results/scim-integration-initial/` logs are the evidence for this assembly.
This is not a full parent-transcript reconciliation or final C0/release gate.

Live confirmation: the combined section passed **71 reported checks** on an
owned InMemory API. Those checks include all **58 P1** and **33 P3** assertions,
**61 P5** and **7 P6a** checks, and the extra P3 endpoint cleanup check. The
endpoint collection was byte-for-byte equal before and after the run, and the
owned API process was stopped. Both original P1/P3 standalone entry points
still reject unowned inputs before network/database access.

P8a incremental confirmation: the same main-runner entry point now passes
**78 checks**, adding all seven freshness assertions. The endpoint collection
remains identical and the owned process is stopped. The original 71-check
receipt is retained unchanged; new logs use `test-results/scim-integration-p8a/`.
No new PostgreSQL/two-process proof is claimed by this incremental run.
**Design disposition: accepted.** A fifth real package extends the existing
small orchestrator; no production logic, ownership guard, cleanup policy or
P8b guarantee was added by the section-wiring correction.

P8c incremental confirmation: **86 combined live checks** pass, including all
eight new conditional endpoint checks. Existing endpoint state is unchanged,
the owned API is stopped, and earlier checkpoint receipts remain unchanged.
New evidence is in `test-results/scim-integration-p8c/`.
**Design disposition: accepted.** The actual CAS/snapshot behavior remains the
reviewed P8c rollback unit; this wiring-only follow-up adds its sixth real
consumer to the existing small orchestrator. PC-4 and instruction 3a.4 are
retained, and no P8b deletion/cleanup implementation is imported.

## P8a issues

| ID | Type / severity | Symptom | Root cause | Resolution and why it works | Earliest possible / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| P8-I01 | Test contract / Medium | Old endpoint unit fixtures failed after authoritative reads replaced cache-only reads | They expected no database access and used non-UUID IDs with UUID-lookup mocks | Use valid IDs and model the saved database row; 120 unit tests pass without weakening response assertions | Unit fixture review / focused unit run | A persistent cache test must distinguish database state from cached state |
| P8-I02 | Test correctness / Low | The first HTTP rename case returned 200 at the old name | Endpoint names are not an editable admin property; the test assumed an unsupported update | Exercise supported displayName and active updates through HTTP; retain the direct external-rename cache test at service level | DTO inspection / HTTP | Assert the actual endpoint update contract before choosing fixtures |
| P8-I03 | Harness authentication / Low | All three two-reader PostgreSQL cases returned 401 before exercising freshness | Each test application generated its own temporary OAuth signing key; the writer's token was not valid on the reader | Acquire a token from each application. Both backend HTTP runs pass 18/18; PostgreSQL used two independent application instances and replayed 22 migrations | Two-app harness setup / PostgreSQL HTTP | Independent apps need separate test tokens or an explicitly shared signing key; never bypass authentication to test freshness |
| P8-I04 | Product correctness / High | Statistics still succeeded for a cached endpoint deleted by another writer | The statistics entry point used its own cache-only existence check | Resolve the endpoint through the authoritative read before counting. A dedicated regression changed from a resolved response to the expected 404 | Cache-consumer review / focused unit RED | Cover alternate endpoint entry points as well as ordinary item/list requests |
| P8-I05 | Environment / Low | Initial unit commands could not find Jest, then the generated Prisma client | A fresh worktree does not contain installed dependencies or generated code | Link only existing tooling after the missing-dependency failure and generate the client from this worktree's schema with an inert URL | First validation command / first validation command | Setup errors are not TDD RED; record the subsequent behavioral failure separately |
| P8-I06 | Documentation / Low | Coupled freshness gate rejected the package | The first documentation pass updated the operator guide but missed the profile architecture document bound to the endpoint service | Update its timing guarantee and distinguish historical single-instance evidence from new two-process evidence; coupled freshness passes | Source-to-doc mapping / existing F4 gate | Existing coupling gate worked; no new gate is needed |
| P8-I07 | Harness readiness / Low | First local health call received connection refused | The detached server was still starting when the caller probed it | Verify readiness before smoke testing; the two-process PostgreSQL harness uses a bounded health wait and fails if its owned server exits | Server setup / first health call | A running process is not yet a ready HTTP server |
| P8-I08 | Tooling / Low | Two guessed paths did not exist and symbol lookup could not resolve the sibling worktree | The controller has a different filename, no shared InMemory database file exists, and the language provider did not accept the sibling-worktree reference | Use file discovery and scoped source search instead of inventing a shared storage object | File discovery / attempted read | No product change; repository boundaries must be verified from actual declarations |
| P8-I09 | Test typing / Low | Lint rejected two list assertions, including the first attempted matcher rewrite | Supertest response bodies and nested asymmetric matcher assignments are typed as `any` | Validate the body as `unknown` and require an actual endpoint array before checking its contents. Final focused HTTP and lint checks pass | Static analysis / targeted lint | Test HTTP boundaries with real type guards rather than casts or weakened lint rules |
| P8c-I01 | Product correctness / High | Two different endpoint PATCH edits with the same token both returned 200 on both backends | The controller compared the token before the service write; the two checks could both pass | Move the check into the synchronous InMemory write and condition the PostgreSQL update on the old persisted editable fields. The controlled race now returns one 200 and one 412, with only the winning state stored | Forced-interleaving HTTP test / forced-interleaving HTTP test | Keep the barrier regression and the persistence-condition unit test; sequential stale-token tests do not prove race safety |
| P8c-I02 | Response contract / High | Summary GET published a token different from the full editable-state token | The token was hashed from the projected response with its profile removed | Resolve one snapshot and derive the projected body plus full-state token together; summary-edit regression is GREEN on both backends without exposing the full profile | Alternate-view contract test / alternate-view contract test | Every view publishing a write token must prove the token can authorize an unchanged edit |
| P8c-I03 | Environment / Low | First command could not find Jest in the new worktree | Dependencies and generated client are not copied into a new worktree | After that failure, reuse the installed tooling through an owned junction and generate the local client with an inert URL | First validation command / first validation command | Keep setup failures separate from the confirmed race RED |
| P8c-I04 | Documentation / Medium | The older concurrency guide described per-key settings merges as unconditionally safe | Sequential merge semantics were mistaken for isolation between simultaneous database operations | Correct the claim: send If-Match for competing edits; no-header and wildcard writes deliberately retain their existing behavior | Read/write isolation review / implementation documentation review | Name the isolation boundary and distinguish conditional calls from unconditional calls |

## Entry checklist

For each new issue record:

1. Type and severity.
2. Observed failure, with evidence path.
3. Actual mechanism, not only the error text.
4. Confirmed resolution and commit when available.
5. Why the resolution fixes the cause.
6. Preventative test, check, or rule.
7. Earliest gate that could detect it versus the gate that did.

## Completeness and design disposition

This initial ledger covers design/commit preparation in this continuation.
It does not claim a full-transcript implementation reconciliation before
implementation has occurred. Each implementation context records confirmed
issues as it works; consolidation reconciles the package logs and available
full execution transcripts without importing unrelated analysis conclusions.

P3 evidence reconciliation: reviewed the complete per-run logs and receipts
under `test-results/conditional-writes`, plus the implementation tool results,
including failed setup runs. The RED fixture correction, missing dependencies,
unit fixture updates, test compile errors, listener reuse, binary SCIM response
decoding and renderer/link limitations map to P3-I01 through P3-I09. No external
session transcript was imported into this isolated worktree, so this is not a
claim of full-transcript reconciliation; that remains a parent consolidation
check. False signals dismissed: unchanged 147 lint warnings, setup-only failures
with zero failed test assertions, and three pre-existing Session links.

Final P3 matrix `postgres-69bf7bf777debff5`: 55/55 HTTP tests on each backend,
33 live assertions on each owned runtime, 22 migrations replayed on PostgreSQL
17.8, exact owned container cleanup verified. Final unit count: 692/692.

**Test/gate disposition:** historical failure evidence is retained; permanent
regression tests are required before production edits.

**Design disposition:** retain narrow work packages and resource repository
boundaries. No new infrastructure dependency is justified by this ledger.

### P8a transcript reconciliation

The parent session's complete `events.jsonl` was scanned through the P8a
documentation checks (15,894 events at that checkpoint), rather than relying
only on the compacted conversation. The scan correlated tool starts and results,
selected endpoint-worktree executions, and checked both error signals and
diagnosis terms such as `root cause`, `stale` and `no-op`.
The P8 entries above cover the confirmed setup, contract, HTTP, product and
documentation issues. Source/doc quotations, search echoes, and earlier
packages' 401 discussions were excluded as non-issues for P8a.

This is a package-scoped reconciliation, not a claim that every still-running
implementation package or its separate transcript has been reconciled.

### P8c transcript reconciliation and final gates

The complete parent event log was scanned through 21,967 events, correlating
tool inputs/results for the conditional-endpoint worktree and checking error
and diagnosis signals. The confirmed race, projected-token mismatch, dependency
setup failure and overbroad merge-safety claim are recorded as P8c-I01 through
P8c-I04. PostgreSQL RED receipts were also checked explicitly. Source quotations,
review reads, passing tests whose names contain "stale", and expected synthetic
error paths were excluded as additional incidents.

Final focused gates: 172 unit tests; 32 HTTP tests per backend; eight live
checks per backend; PostgreSQL 17.8 with 22 migrations and two live Node
processes; build; lint at the unchanged 0-error/21-warning scope baseline;
43 JSON blocks in touched Markdown files; content/freshness; four changed-doc
diagrams in both strict themes. Independent review found no significant issues.
The recurring atomicity gap is promoted as PC-4 and the conditional-write rule.
No release, deployment or live-data repair is implied.
