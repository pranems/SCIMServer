# SCIM correctness implementation: issues and lessons

> **Last verified:** 2026-09-29
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
| C0-I07 | Integration / Medium | P6b's generic If-Match edits conflicted with P3; P7a moved PUT snapshot reads ahead of replacement preparation | The independent packages changed different responsibilities in the same methods | Keep P6b's profile-aware checks and P7a's earlier single snapshot, but bind the returned expected version there and pass it to P3's repository mutation. Remove the obsolete second read. The 229 HTTP cases include real-repository conditional-write barriers alongside typed PATCH, query and P7a contracts; all pass | Merge review / merge review and focused HTTP | Preserve the persistence condition when moving validation order; do not restore an unconditional save or validate replacement from a different snapshot |
| C0-I08 | Integration / Low | P6b reused `9z-CP`; P7a had no main-runner invocation | Package-local smoke helpers do not reserve globally unique sections or prove main-runner reachability | Two wiring assertions failed before edits. Route P6b through `9z-CU` and P7a through `9z-CV`; share P7a's explicit-target HTTP assertions while preserving its original source/database/loopback guards. All three wiring tests pass within 1,044 focused units | Existing wiring regression / same | Applied: eight-package inventory and cross-main/helper identifier checks; no ownership guard is bypassed |
| C0-I09 | Error contract / Medium | P4's deferred raw-error issue was still present after P5: both a private injected message and internal repository context reached HTTP clients | P5 normalizes scalar shape but deliberately preserves an already-SCIM envelope. The shared repository bridge interpolated `RepositoryError.message`, which includes Prisma mapper context/cause text, into server-error detail | Two unit and two HTTP assertions proved RED on the assembled code. Mask mapped 500/503 detail to the operation only; retain status, diagnostics, client-error behavior and logged original cause. Build, 185 helper/filter units and the two HTTP cases pass. Restore raw-marker assertions in the full P4 HTTP contract | P4 error-contract RED / P4 integration closure | Applied: actual Prisma error translation feeds permanent unit and HTTP seam tests; a scalar string is not necessarily safe content. No historical P4 or P5 evidence is rewritten |
| C0-I10 | Integration / Low | P4's standalone helper was not reachable from the main live runner | The helper expected a pre-created owned loopback endpoint; the main runner had neither invocation nor fixture setup | Two wiring assertions failed. Add `9z-CW`, create a dedicated endpoint, share the unchanged 69 HTTP assertions through a callable function, and retain the original guarded script. Three wiring tests and all 121 combined live checks pass; endpoint state is identical after cleanup | Existing wiring regression / same | Applied: nine-package inventory, unique sections and main-runner cleanup proof. An initial insertion matched an earlier repeated finally block; source review moved it after `9z-CV` before execution |
| C0-I11 | Documentation/tooling / Low | Both independent pattern additions had total 31; renderer initially skipped for missing web/root tooling | P4 added PA-10 while the assembled branch already included PC-4; fresh worktree dependency trees were absent | Combine A=10 and C=4 with total 32. After actual missing-tool results, reuse owned read-only web/root links. Both diagrams in the changed ledger render in both strict themes; version discovery still reports the pre-existing 0.0.0 sentinel | Merge review/render gate / same | Preserve both patterns and recompute totals, never choose one side. SKIP is not render proof; no version pin or dependency was changed |
| C0-I12 | Integration / Low | The shared live runner still required the original 156 P7 assertions after importing the 228-assertion recursive readOnly contract | The source helper gained tests independently of its integration receipt check | A new wiring assertion failed before the expected count/message was updated. All four wiring tests now pass, and the real combined live section reports 121 successful checks including the complete 228-assertion P7 contract | Wiring regression / same | Applied: retained guard-first standalone wrapper; loaded the new fixture inside the explicit-target shared contract; original checkpoint counts remain historical |
| C0-I13 | Test typing / Low | Explicit lint including the expanded P7 E2E spec found 124 unsafe-value diagnostics despite zero production-file lint errors | Supertest request/result boundaries and Object.fromEntries had implicit any types; existing and new test cases reused them | Add local typed wire/request interfaces, a typed HTTP server boundary, unknown-valued payload fields and tuple-typed entries. Keep runtime value/key assertions and add a missing-fixture guard. After two residual diagnostic passes, all six selected files have zero errors / 14 existing warnings and all 67 P7 HTTP cases pass | Explicit E2E lint / integration | Applied: lint the touched HTTP spec, not only src; no lint-disable comments, rule relaxations or changed protocol expectations |
| C0-I14 | Harness/integration / Low | P8c unit setup failed eight cases for the new required lifecycle provider; P8b's Group race test timed out | The older P8c test module did not register the new port. P8b paused `groups.update`, but P4 intentionally removed that non-atomic inner call | Register the required test provider. Move the controlled pause before the real aggregate commit, then prove both unconditioned NOT_FOUND and conditioned PRECONDITION_FAILED rejection after endpoint deletion, with zero rows restored. All 305 focused units pass, including unchanged P4 atomic-stage/torn-read tests | Focused integrated unit setup / same | Setup failures are not product RED. Do not reintroduce an await inside P4 to satisfy an obsolete spy; preserve the atomic boundary and test a genuinely suspended caller |
| C0-I15 | Integration / Low | P8b source reserved `9z-CT`, already used by integrated P8c, and lacked a shared-runner route | Source-branch section allocations differed from the assembled map | Two wiring assertions failed before moving P8b to `9z-CX`. Preserve P8a `9z-CS`, P8c `9z-CT`, original standalone deletion helper and fixture cleanup. All four wiring tests pass | Existing cross-runner regression / same | Applied: ten-package invocation/unique-section inventory; source-package reservations remain historical notes rather than overriding assembled identifiers |
| C0-I16 | Integration/harness / Low | P9 was absent from main live coverage; its inherited shared harness expected only 55 P7 HTTP cases | The P9 source branch preceded the accepted 67-case readOnly follow-up and the integration wrapper | Preserve P9's guarded branch and all ownership checks, combine minimums as P9=17/P7=67/P1=24, and share only explicit-target HTTP assertions in `9z-CY`. Two wiring failures turn GREEN in 383 focused units | Merge review and wiring regression / same | Applied: eleven-package route/section inventory; `SCIM_P9_INTEGRATION=1` still requests the two unresolved normative cases instead of silently omitting them |
| C0-I17 | Test typing / Low | Explicit lint of P9's HTTP adapter reported 12 unsafe-value/import errors | CommonJS corpus loading and Supertest server/body boundaries were untyped | Use createRequire with a narrow corpus contract, typed Server input and unknown-valued wire payload. No corpus assertion or expected outcome changed. Six-file lint now passes with zero errors / six existing warnings | Explicit HTTP lint / integration | Applied: keep CJS shared assertions, type the adapter, never suppress lint rules |
| C0-I18 | Integration / Low | P2's owned harness conflicted with the accepted P7/P9 harness branches and case minimums | Independently implemented worktree-specific runners shared the same file paths | Add explicit IS_P2 selection while retaining P1/P7/P9 path/branch checks, all source/database ownership checks, P2 exact 17.8, and P7's 67-case minimum. Baseline transformation is confined to the designated P2 context; the source-built identity check remains intact | Merge review / same | No frozen historical harness or evidence changed; combined code builds with public deepEqual and P7's fifth immutable mode preserved |
| C0-I19 | Integration/coverage / Low | P2 had no main-runner route, and its now-passing I02 case was still opt-in | Source package smoke and compatibility discovery were maintained independently | Two wiring failures precede `9z-CZ`; an additional discovery test fails before removing I02's integration flag. I02 now runs by default in HTTP/live; the measured default P9 corpus is 18 cases / 1,162 live assertions. I03 remains an explicitly executed RED | Wiring/discovery regression / same | Applied: promote fixed cases to default execution; do not hide unresolved I03 or claim a final matrix |
| C0-I20 | Test typing / Low | Explicit lint found 74 unsafe-value errors in ordered PATCH HTTP tests and 54 in the touched manager suite | Supertest and stored JSON boundaries were untyped; narrower annotations hid nested any values | Reuse a type-only HTTP response contract for the two real consumers, retain original request helpers/tracing, and type stored fixture payloads with unknown-valued leaves. Remove obsolete type assertions. HTTP fixture lint is now zero errors/warnings; 162 final selected HTTP cases pass and a last type-only rerun compiles the full spec and passes three selected singleton checks | Explicit HTTP lint / integration | No lint rule or runtime assertion weakened; type-only helper has two actual consumers and no production responsibility |
| C0-I21 | Preservation correctness / High | PUT reordering duplicate values copied the first server-owned state twice; anonymous additions shifted preservation; immutable checking matched the last same-value record | `prepareReplacement` repeatedly called find(value), and the immutable comparator overwrote duplicate keys in a map. P2 already had one-to-one retained matching but PUT did not share it | Nine unit and 48 HTTP REDs before changes. Extract P2's matcher into dependency-free domain/retained-entries.ts and use it for PUT preparation, immutable comparison and PATCH consumers. All 16 new units and 289 focused HTTP cases per backend pass; actual PostgreSQL 17.8/22 migrations and 60 built-live cases/1,260 assertions verify the correction | P7 no-write probe / unit+HTTP reproduction in assembly | Applied: duplicate same-value/different-type reorder, same-type occurrence consumption, anonymous and remove/add controls in core/extensions and all resource adapters. Never count a value as a globally unique identity; no competing matcher or validator-to-PATCH import cycle |
| C0-I22 | Existing test-reconciliation blocker / Medium | Broader neighboring validation run has eight failures despite the new preservation cases passing | Existing extension-flags-validation.spec.ts expects canonical values to reject, malformed extension blocks to be silently skipped and readOnly POST/PUT input to reject, conflicting with accepted P7 behavior | Verified the same eight failures against untouched validator source at 5581e6b7 using an ignored Jest source overlay, with no production rollback or historical guard edits. Current run: 1,324 passes / 8 failures across 21 suites. Test reconciliation remains open with P7; do not count the whole run GREEN | Expanded neighboring unit run / same | Preserve exact failures and baseline proof; do not silently change expected behavior or suppress the suite to close this fix |
| C0-I23 | Environment/tooling / Low | New worktree test command lacked Jest; container configuration adapter returned an execution error | Tooling links had been cleaned after the prior checkpoint and the editor adapter is unavailable | Reuse one owned API junction after the missing-tool failure. A new narrowly scoped owned PG harness adapts existing guarded runner patterns without editing any old guard: explicit random owner/run identity, port/database/cluster/system checks, TCP readiness, pinned bootstrap, 22 migrations, exact-container cleanup | Tool invocation / same | InMemory uses inert URL; PG ignores inherited URLs, refuses markers, verifies 17.8 identity, and records new source/runtime evidence. The focused DB check is not the final C0 matrix |
| C0-I24 | Integration/harness / Low | P8 lifecycle unit/HTTP suites failed compilation after P3b made the append-member policy argument mandatory; P3b had no main-live route | Independent packages changed a repository port and fixtures without the other package's source present | Supply explicit empty policy only in deletion fixture calls that test lifecycle behavior, retaining actual policy propagation for uniqueness tests. Two wiring REDs precede `9z-DB`; all 524 focused units and 382 distinct HTTP cases pass with two explicit native-DB skips. The original guarded standalone helper remains | Compile/wiring gates / same | Required policy arguments are not made optional to hide missing callers. Preserve P3 CAS, P4 staging and P8 barriers together |
| C0-I25 | Standards/representation acceptance / High | Six compiled no-write probes contradict the reviewed P3b contract | The source includes Boolean/dateTime/binary normalized uniqueness, rejects numeric/MV generic displayName based on promoted column type, and overlays generic raw values in uniquenessPayload | OPEN with P3b owner: source behavior is measured in test-results/scim-integration-p3b/contract-probes.json; no speculative policy fix is duplicated in integration. Atomicity suite GREEN is not policy acceptance | Integration source review/probe / before final matrix | Keep implementation description distinct from accepted RFC/provider policy. P7 owns common externalId; P3b owns supported scalar policy and representation-aware candidate extraction |
| C0-I26 | Test typing/tooling / Low | Explicit HTTP lint flagged a redundant outer assertion; the first attempted generic server edit targeted the wrong location | ESLint's range spanned the request chain, not merely its first line; Nest getHttpServer returns the application's generic but is not itself generic | Remove only the redundant Promise cast, retain the established Server assertion and verify the complete spec compiles. Five integration test files now lint at zero errors/warnings; the focused namespace test passes | Explicit lint / same | Inspect diagnostic end ranges before editing. No runtime or lint policy changed |
| C0-I27 | Harness integration / Medium | P9's owned URL could be superseded by a database marker after its early guard; incoming docs also predated default I02 promotion | Ownership was checked before an ordinary bootstrap rediscovered its target; independent branch snapshots carried earlier corpus/status claims | Integrate P9-only pinning wrapper using P5's identical existing optional pin seam; preserve combined P2/P7 selections, 18-case default corpus and parent I03 hold. Eight isolation/discovery units plus 23 resolver/default HTTP cases pass; source package supplies fresh owned dual-backend/live receipts | Worker late-marker RED / focused integration | No source guard weakened, ordinary marker behavior retained, and predecessor receipt identity remains in the updated artifact |
| C0-I28 | Tooling / Low | First config-only branch probe failed before evaluation completed | The ad-hoc VM omitted PG_ANALYSIS_OUTPUT needed to derive Jest's cache path | Supply an owned project output path and rerun all four branch selections; P9-only mapper and P2-only transformer assertions pass | Local probe setup / same | Setup failure is not product RED. The source guard is explicitly stubbed only in this configuration-selection probe; it is not claimed as ownership verification |
| C0-I29 | Cross-package value validation / High | Imported P7 POST/PUT checks did not stop invalid common externalId in lenient PATCH; Group pathless input could become null before final validation | PATCH intentionally skips complete required-state validation. Resource hooks ran before the common-value invariant, and strict PATCH fallback metadata still honored old conflicting readOnly/type declarations | Thirteen domain and 25 HTTP REDs confirmed the gap. Factor a common-value-only checker, validate original common targets before hooks and the completed candidate afterward, and apply common metadata precedence in PATCH fallback/target resolution without mutating cached maps. All 973 targeted units and 392 InMemory HTTP cases pass | Combined domain/HTTP RED / first P7/P2 common-attribute integration | Applied: explicit/pathless targets, all families/both strict modes, late-op rollback including stored versions, extension homonyms, valid custom displayName/active, and a control forbidding full POST required checks on PATCH candidates |
| C0-I30 | Test integration / Low | Imported discovery checks did not compile against the assembly's typed HTTP body; an old Group test expected invalid externalId to clear silently | New discovery Resources were absent from the local wire type, optional declaration lookup lacked a guard, and the old null-coercion expectation codified the confirmed defect | Extend only the test wire shape, guard the expected published declaration, and replace the obsolete Group expectation with rejection plus unchanged input state. Lint and targeted HTTP compile pass; no protocol assertion was weakened | Targeted compile/lint and neighboring unit / same | Treat original-type loss before validation as a defect, not compatibility; keep pre-existing unrelated P7 expectation mismatches separate |
| C0-I31 | Harness fidelity / High | Imported interrupted-create test paused correctly but lost initial member and uniqueness arguments | Its helper wrapped only create(input), predating P3b/P4's extra parameters, so resuming could bypass the intended atomic transaction path | New barrier-forwarding test failed before the variadic tuple fix. Forward every argument, include a real member in the Group race, and preserve all arguments in held-pool callbacks. Integrated PostgreSQL runs actual uniqueness/Group transactions and passes 135 HTTP cases; InMemory passes 131 with four native-only skips | Integration review plus discriminating helper RED / same | Applied: a race barrier must delay, not change, the original operation or its policy. Keep synthetic HTTP race proof distinct from built-live deleted-route smoke |
| C0-I32 | Test classification / Low | Two prior sanitization controls expected 503 for a synthetic string containing bare connect; the new native member control lacked the required policy argument | The narrow mapper deliberately removed the unsafe substring heuristic, while P3b made member policy mandatory | Use actual ECONNREFUSED in the two outage fixtures, retain unknown/injected-500 controls, and pass [] only to the native FK fixture. No production policy broadened; 247 units and exact HTTP/native error controls pass | Integrated unit/HTTP compile / same | Exact native/coded outage shapes are separate from driver text containing a connect statement; do not restore a broad heuristic to satisfy a fake error |
| C0-I33 | Default coverage / Medium | The authorized P2 implementation passed unchanged I02/I03, but default HTTP/live dispatch still excluded I03 and the shared runner expected older counts | Temporary corpus integration metadata, an HTTP TODO branch and live environment selection outlived their unresolved-policy purpose | Two discovery REDs and one main-wiring RED precede removing optional dispatch. Both backends now pass all19 P9 cases by default, 1228 built-live assertions and the expanded188 P2 assertions. Frozen17/2 receipt unchanged | Default-discovery integration RED / same | Applied: assert default case discovery, no optional dispatch, both outcome IDs and exact measured live counts. A supported result must not remain hidden behind opt-in |
| C0-I34 | Operator guidance drift / High | Merged registry descriptions still said verbose-OFF stores literal keys and active coercion is not fully gated after runtime behavior was fixed | Independent textual edits merged without a conflict; existing guidance tests rejected broad bad advice but did not assert the newly authorized policy | Two exact semantic REDs precede correcting descriptions/JSDoc. Guidance/config/default tests pass353; runtime dual-backend controls prove the words describe actual rejection/no-write behavior | Integration guidance review / source-package semantic guidance test | Applied: verify emitted descriptions alongside behavior; conflict-free text merging does not establish semantic agreement. No default or schema policy was changed to fit prose |
| C0-I35 | Test typing / Low | Explicit lint found29 unsafe-value errors in the imported flag HTTP suite although build and HTTP execution passed | API build excludes test files and the suite inherited untyped Supertest bodies/chains | Reuse the established typed HTTP boundary and type stored payload readback. Explicit touched-file lint now0 errors/56 unchanged warnings;356 HTTP cases/backend still pass | Explicit integration test-file lint / source-package changed-test lint | Applied locally: lint changed HTTP tests explicitly; do not suppress unsafe-value rules or count runtime success as TypeScript test hygiene |
| C0-I36 | Probe fixture / Low | All five extra generic-shape scenarios failed before resource assertions | The scratch profile omitted the schemaExtensions array present in the committed source fixture; this was not evidence about uniqueness or filtering | Add explicit[] and rerun only the extra probe, not the already-passing308 HTTP/143 live checks. Both backends now reach45 outcomes,43 passing and two genuine filter failures | First extra built-runtime probe / fixture-shape check | Applied: separate setup failures from exercised product outcomes; use the full established profile shape and preserve the original raw run |
| C0-I37 | Admission error contract / Medium | Omitting resourceTypes[].schemaExtensions returns500 with a TypeError logged by validateStructure | Profile validation iterates the property before checking/defaulting its shape | OPEN for parent P7b: decide normalization to[] versus documented400; safe500 is not structured input validation. No production fix or acceptance is claimed by correcting the probe fixture | Invalid-profile probe / validateStructure malformed-input unit test | Add omission/null/non-array controls with no endpoint creation; do not silently reinterpret the fixture failure as a query regression |
| C0-I38 | Cross-package query representation / High | Valid numeric scalar/MV displayName survives CRUD and uniqueness checks but equality filtering returns empty200 on InMemory and500 on PostgreSQL | Generic filter pushdown still treats displayName as String/CITEXT. Valid raw numeric/MV values have no equivalent scalar column; the hint drops candidates or supplies an invalid Prisma String operand before residual evaluation | OPEN for parent C0 query correction before acceptance. Explicit five-shape probe captures both backend manifestations; all30 write/readback/uniqueness and10 sort checks pass, only two of five equality checks fail. Do not restore invalid custom-schema restrictions | Additional cross-package built-runtime probe / promoted-name filter contract test | Verify candidate completeness against the response's authoritative representation. A residual filter cannot recover rows discarded by an unsafe hint. Promote desired match outcomes into permanent regressions with the fix |
| C0-I39 | Merge fidelity / Medium | P7 context import conflicted with integrated common checks, typed fixtures, live entry split and current status docs; automatic merging duplicated isCoreSchema:false | Independent branches evolved the same helper and schema-builder seams; the source snapshot also predated the resolved PATCH/retention work | Retain both common-view and common-value functions, public deepEqual/fifth mode, neutral matcher, explicit extension role+required, both live entries and all P1/P2/P9 harness branches. Remove only the duplicate property and stale status regressions. Build754units/537IM/538PG HTTP pass | Conflict/source review / same | Merge semantic unions, not whole sides; verify context stays local and fixed defects do not reappear. Two narrow patch-context mismatches were resolved by rereading exact current lines, without treating tooling failures as product RED |
| C0-I40 | Live integration wiring / Low | New P7 helper executed472 assertions but the main entry still required426 | Source package and shared integration runner maintain distinct receipts | Permanent wiring test changed first and failed, then9z-CV was updated to472. Actual built runtimes on both backends pass143 shared checks including the472-assertion P7 contract | Wiring RED / package-increment reconciliation | Keep expanded fixture loading inside the shared HTTP contract while retaining source/database guards on the standalone entry; source minimum increases only for the correct package |
| C0-I41 | Test typing / Low | Imported profile/context suite did not compile against the assembly's WireBody; explicit lint also reported an unsafe asymmetric matcher | The existing wire type only declared meta.version, while new assertions accessed created/resourceType; Jest matcher APIs return any | Declare the actual published metadata fields and type the matcher boundary as unknown without changing expectations. Only the uncompiled108-case suite reran; the other429 InMemory cases were not repeated. Final PostgreSQL538 and zero-error/33-warning lint pass | Targeted HTTP compile plus explicit test lint / same | Framework type declarations are separate evidence from runtime success. A compile/setup failure is not a behavioral RED, and it must not erase already-passing independent results |

**Flag/default-corpus checkpoint provenance:** C0-I33/I34/I35 were reconciled
against this increment's saved RED/GREEN, HTTP, built-live, lint and cleanup
artifacts and actual tool results. Full parent-transcript reconciliation
remains a final C0 owner requirement. The unavailable editor/container
adapters reuse C0-I23's native-tool fallback. A missing Playwright render
reported SKIP with exit0 and was not counted GREEN: approved owned root/web
tooling junctions then enabled four PATCH-guide diagrams in strict light/dark
rendering. Existing editor discovery still reports0.0.0; no version was
changed and no editor-preview parity was claimed.
| C0-I25 follow-up | Partial closure / explicit remaining hold | Unsupported uniqueness types and reference folding were confirmed in the original imported P3b policy | Characteristic applicability was conflated with normalizing any accepted schema value | Source correction cefb540b, integrated as 1f0a024a, removes the unsupported branches and forces exact references. 211 focused units, 167 InMemory HTTP cases, seven compiled no-write controls and the 21-assertion scoped built-local smoke pass | Owner RED/GREEN plus integration revalidation / before final C0 | Type/reference portion closed in focused proof; three generic promoted-column authority probes remain OPEN. Prior source receipts and failed probe evidence are preserved |

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

P6b/P7a incremental confirmation: **119 combined live checks** pass, including
32 query checks and the entire 156-assertion P7a contract. Endpoint state is
unchanged and the owned API process is stopped. Prior checkpoint receipts
remain unchanged; new logs use `test-results/scim-integration-p6b-p7a/`.
**Design disposition: accepted.** Query authorization/evaluation, schema
validation/projection, and atomic persistence retain their existing seams.
The merge does not add a universal repository or a shared mutable snapshot.
Eight real live consumers justify the existing small orchestrator; final
PATCH semantics and P8b cleanup are not silently pulled into this increment.

P4 incremental confirmation: **121 combined live checks** pass, including
all 69 new aggregate assertions and dedicated endpoint cleanup. Endpoint state
is identical, the owned API is stopped, and the standalone guard still rejects
unowned targets. New logs use `test-results/scim-integration-p4/`; previous
receipts remain unchanged. **Design disposition: accepted.** Aggregate
transaction mechanics stay in the Group repository ports; safe server-error
formatting stays in the existing SCIM boundary. The two corrections are
separate rollback units, and no universal transaction framework is introduced.

P7 recursive-readOnly integration confirmation: **645 focused units** and
**186 HTTP cases** pass (one native PostgreSQL FK control is explicitly skipped
on InMemory). The final typed-fixture rerun passes **67 P7 HTTP cases**.
The combined built-local `dist/main.js` smoke still reports **121 checks**,
now containing **228 P7 assertions**, with unchanged endpoint state and the
owned process stopped. Prior receipts remain unchanged; new logs use
`test-results/scim-integration-p7-readonly/`.
**Design disposition: accepted.** The recursive walker keeps the existing
map interface and separation between metadata collection, input stripping and
protocol execution. The test-only response types describe exercised wire
shapes without adding a production abstraction. PATCH execution/flags/defaults
are not changed by this increment.

P8b integration confirmation: **305 focused units**, **69 HTTP cases** plus
one explicitly skipped PostgreSQL-only FK control, and **131 combined live
checks** pass. The live run preserves the existing endpoint collection and
stops its owned API. Logs use `test-results/scim-integration-p8b/`.
**Open boundary, not a resolved issue:** parent review still owns exact
concurrent FK-error normalization. The imported late-User HTTP test accepts
a broad 4xx/5xx non-success range; its no-orphan assertion is not exact error
contract proof. No mapper change or new database claim is hidden in this
cleanup integration. **Design disposition: accepted.** Preserve P3 CAS,
P4 staged aggregates and P8b lifecycle barriers without introducing shared
mutable storage or a generalized transaction framework.

P9 integration confirmation: **383 focused units** pass. All **19** corpus
cases were explicitly executed with `SCIM_P9_INTEGRATION=1`: **17 supported
cases pass, I02 and I03 fail** with the expected unresolved behavior. These
are retained blocking findings, not hidden TODOs or accepted compatibility.
The separately labeled bounded live lane passes **132 reported checks**,
including **17 P9 cases / 1,104 assertions**, and cleans its dedicated endpoint
state exactly. Logs use `test-results/scim-integration-p9/`; no new PostgreSQL
matrix or release proof is claimed. **Design disposition: accepted.** Keep
the shared corpus and thin typed HTTP adapters, preserve ownership guards and
leave P2-owned protocol changes to their package owner.

P2 core integration confirmation: the first combined run passes **1,229
units** and **327 HTTP cases**, with one explicit PostgreSQL-only FK skip
and **I03 still failing**. I02 passes and is promoted to default execution
after a discovery RED/GREEN check; that adds one distinct unit test for
**1,230 total distinct targeted unit passes**. The final typed-fixture/default
corpus rerun passes **162 HTTP cases**, with I03 still an explicit TODO only
in that bounded lane; its failed execution remains in the earlier result JSON.
The combined built-local smoke passes **133 reported checks**, including
P2's **112** assertions and default P9's **18 cases / 1,162 assertions**.
Endpoint state is unchanged and the owned APIs are stopped.

Logs use `test-results/scim-integration-p2/`. Common-attribute and quoted-active/
I03 follow-ups remain separately owned; no production fix is duplicated here.
**Design disposition: accepted.** Public deepEqual and P7 cardinality,
replacement-mode and recursive-readOnly seams coexist with the ordered
executor. The added HTTP helper is type-only and serves two concrete test
consumers; repository boundaries, defaults and live-data policy are unchanged.

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

### P6b confirmed corrections

| ID | Type / severity | Symptom | Root cause | Resolution and why it works | Earliest possible / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| P6b-I01 | Environment / Low | Jest missing; client generation then required DATABASE_URL | Fresh worktree has no dependencies and Prisma configuration requires a URL even for generation | After the failed runner attempt, linked approved existing API tooling and generated only this worktree's client with a nonconnecting loopback URL | Runner setup / same | Missing dependencies are not behavioral RED; no lockfile or shared-target modification |
| P6b-I02 | Fixture / Low | User/Group creation returned 400, then Group returned 409 before query assertions | Strict minimal schemas omitted DTO-default active/members; Group uniqueness rejected case-only duplicate display names | Added the actual default fields and distinct names, then reran baseline: 24 behavior failures, no fixture failures | Fixture authoring / first RED runs | Positive fixture creation is mandatory; setup failures are recorded separately |
| P6b-I03 | Read correctness / High | Hidden filters returned zero instead of three, numeric ordering used text, extension predicates lost their namespace | List services queried response-projected values; fixed column sorting and flattened caseExact paths lacked schema context | Shared request-scoped read plan authorizes qualified paths, filters internal values, orders/counts/pages, then calls existing safe output mappers; initial 32 HTTP tests and 110 unit tests pass | Unit/HTTP assertions / focused RED | Matrix includes all three resource families, GET and string-form JSON search, two colliding extension namespaces and output key checks |
| P6b-I04 | Profile consistency / Medium | Custom PUT/PATCH/DELETE returned 428 although ETag was disabled | Custom calls omitted the resolved profile argument to enforceIfMatch | Pass the profile to all three calls; disabled ETag ignores absent/stale conditions, enabled mode retains 428/412/current-version behavior | HTTP contract / focused RED | Keep discovery/header/write behavior in one profile test; atomic write races remain P3 |
| P6b-I05 | Test contract / Low | Initial assertion expected meta.version to disappear with ETag disabled | Existing policy disables conditional HTTP behavior, not the resource's informational version | Test header suppression and actual write outcomes rather than inventing a mandatory metadata prohibition | Contract review / first RED review | Preserve documented optional metadata policy |
| P6b-I06 | Type checking / Low | New common-attribute definitions failed TypeScript build | Internal SchemaAttributeDefinition requires explicit required/multiValued fields | Supply RFC defaults for synthetic common attributes; API build now passes | API build / same | Typed schema fixtures and production build remain independent gates |
| P6b-I07 | Output correctness / High | Hidden child values survived without a hidden top-level sibling | Output traversal was gated on the presence of a top-level never-returned set | Traverse children independently; the exact unit payload changed from leaking two secret keys to containing only visible values, and HTTP checks cover all resource families | Unit / boundary review | Nested-only schemas are an explicit negative control; production output assembly precedes suppression |
| P6b-I08 | Query edge / Medium | Primitive lists did not sort and null comparisons targeted nonnullable columns | Sort traversal treated every primary/first value as an object; push-down assumed null was accepted by every database column | Preserve scalar list values, require a named complex child, and evaluate null comparisons after fetching candidates | Unit / boundary review | Separate simple-list, complex-child and nonnullable-null tests; PostgreSQL HTTP covers User null comparisons |
| P6b-I09 | Fixture / Low | Neighboring generic service tests rejected query fields; additional HTTP fixtures rejected profile updates | Old mocks omitted custom schemas entirely; profile schema arrays replace rather than merge by ID | Register the schema only for query tests and send the complete schema array when changing characteristics | Fixture authoring / neighboring tests | Mocks must model published query metadata; retain unrelated schemas in replacement arrays |
| P6b-I10 | Tooling / Low | First live readiness probe failed while the API was running | Used `/health` without the application's `/scim` prefix | Read the actual controller/bootstrap contract and probe `/scim/health`; owned local smoke then passed 32 checks | Harness authoring / same | Health paths are verified from source, not inferred |
| P6b-I11 | Standards/test policy / Medium | Draft test accepted a complex sort parent without a scalar child | Confused multi-valued primary selection with permission to infer a complex child | RFC 7644 section 3.4.2.3 requires the child path; reject bare complex parents and test `entries.value` instead | Standards review / focused review | Read the normative clause before treating a convenient shorthand as required behavior |
| P6b-I12 | Tooling / Low | New test lint rejected unsafe Supertest bodies; documentation rendering initially skipped | HTTP library body type is any; root/web tooling was absent after cleanup | Assert object bodies through a typed test helper; restore frozen documentation/browser dependencies after the real missing-tool result | Static gate / same | A skipped renderer is not a render pass; no shared dependency targets or lockfiles are modified |
| P6b-I13 | Documentation diagnostics / Low | Link scan found three old Session references; renderer discovery reported editor version 0.0.0 | Historical Session text names removed tests/ignored settings; available renderer metadata cannot establish a matching bundle version | Compare against starting HEAD, record the existing links, and render with pinned 11.15.0 without changing dependency pins or editor state | Documentation gate / same | No new broken links accepted; historical cleanup and editor-version discovery remain outside P6b |

### P8b confirmed issues

| ID | Type / severity | Symptom and cause | Confirmed resolution | Earliest / actual detection | Prevention |
|---|---|---|---|---|---|
| P8b-I01 | Product / High | Endpoint DELETE returned success while repository counts remained User 1, Group 1, custom 1, credentials 3. Endpoint cache eviction never touched the independent resource stores. | Required lifecycle DI port stages storage swaps and rolls back synchronous commit failures; the original count assertion is now GREEN. PostgreSQL still uses one FK-backed endpoint delete. | Storage contract / focused unit RED | Assert exact remaining rows and raw memberships, not only route 404; cover late writes and failed deletes. |
| P8b-I02 | Tooling / Low | Jest was absent in the isolated worktree. | After the missing-tool failure, junction existing tooling read-only and generate the Prisma client into this worktree with an inert database URL. | Setup / first test command | Do not install or regenerate shared tooling or lockfiles. |
| P8b-I03 | Test typing / Low | Initial fixture used null for required string `meta`; no behavioral test ran. | Use the actual model contract (`'{}'`), then confirm the distinct row-count RED before production edits. | Fixture review / TypeScript test compile | Compilation/setup failures are not TDD RED. |
| P8b-I04 | Cache lifecycle / Medium | A PostgreSQL reader returned 404 after remote deletion but its warmed WIF cache still held one trust. Endpoint cache eviction did not notify credential-cache listeners. | Emit the existing deletion event when an authoritative read forgets an endpoint. Real two-app PostgreSQL HTTP regression now passes; P8a's read boundary is unchanged. | Cache ownership review / PostgreSQL HTTP RED | Verify derived credential state, not only endpoint cache or route status. |
| P8b-I05 | Harness contract / Low | The audit assertion used SCIM `totalResults` but the log service returns `total`. | Type checking identified the mismatch; corrected the assertion before any HTTP behavior was claimed. | Response type inspection / test compile | Use the actual service return shape. |
| P8b-I06 | Live fixture / Low | Credential creation returned 403 on both owned live runtimes. | The minimal inline profile omitted the credential enablement flags. Explicitly enable bearer and OAuth methods in the fixture; both live suites now pass 10 checks and clean their own endpoints. | Fixture policy inspection / immediate live smoke | A fixture must enable the same methods it attempts to use; no production default was weakened. |
| P8b-I07 | Test invocation / Medium | Independent review found ordinary PostgreSQL E2E would fail on missing task-only guard variables. | Confine trigger injection to explicitly guarded runs; ordinary runs use nondestructive failure injection. The standard E2E config passed 6/6 on another owned PostgreSQL 17.8 database with task variables absent in the test process. | Invocation-path test / review | Validate standard and owned-fault invocation paths separately; do not weaken database isolation to make a test pass. |
| P8b-I08 | Tooling / Low | Optional editor/container tools returned execution errors; the first diagram run skipped because web tooling was absent; a patch context containing masked token text did not match. | Use existing native build/lint and guarded P8a tooling; link web tooling only after the missing-tool result; match non-secret headings for documentation edits. All 17 diagrams render under the pinned Mermaid build. | Tool availability / first invocation | Treat a skipped render as missing evidence, never success; do not change a dependency to the editor detector's existing placeholder `0.0.0`. |
| P8b-I09 | Provenance tooling / Low | Full transcript scan hit `includes` on an undefined tool result. | Some completed tool events have no result; normalize that value to an empty string. Full scan completes and counts tool-start/result pairs without printing transcript contents. | Input schema inspection / scan | Missing optional fields in telemetry need explicit handling. |
| P8b-I10 | Test correctness / Medium | Self-audit found the live helper checked an unsupported single-credential GET, which would return 404 even before deletion. | Check the supported credential collection instead, and first prove active and revoked credential IDs/states on that same route. Both live backends pass 10 checks. Audit readback also now uses `flushPending`, which waits for any in-flight buffer flush. | Route/assertion review / self-audit | A post-delete 404 must be paired with a pre-delete successful supported route; audit assertions need completed durability, not a flush request. |

Evidence is in ignored `test-results/p8b/` logs. No shared database, deployment,
product version or dependency manifest was changed.

### P8b exact-error follow-up

| ID | Type / severity | Symptom and cause | Confirmed resolution | Earliest / actual detection | Prevention |
|---|---|---|---|---|---|
| P8b-E01 | API contract / High | The original paused-create check accepted any 400-599. All six exact-contract cases failed on each backend: credentials returned 500; resource errors lacked the consistent endpoint-specific envelope. | A typed missing-endpoint error is emitted by the deletion barrier and by confirmed missing-parent create failures. The existing plane-aware filter serializes the common safe 404. All six cases now pass on both backends with exact status, keys, scalar detail, diagnostics and no driver text. | Exact HTTP assertion / follow-up RED | No-orphan storage checks and exact wire contracts are independent claims; neither replaces the other. |
| P8b-E02 | Error classification / Medium | Already classified repository errors were wrapped again, and raw query text containing `connect` was classified as a database outage. | Preserve classified error identity and remove the broad connect substring heuristic. Typed-code and uncoded-driver controls now pass, preserving aggregate/conditional error classifications without importing sibling code. | Typed-error unit controls / follow-up RED | Match error codes or specific connection signals, not query-source vocabulary. |
| P8b-E03 | Test contract / Low | The initial exact diagnostic allowlist excluded the existing `operation` field emitted for resource creates. | Accept and assert `operation: create` when present, keeping the full outer-key allowlist and no-driver-detail checks. | Envelope-factory inspection / first GREEN attempt | Preserve established plane-specific diagnostics instead of inventing a smaller envelope. |
| P8b-E04 | Test tooling / Low | A newly added shared error assertion was accidentally nested inside another helper and unavailable to four tests. | Move it to module scope; TypeScript and the 19 applicable InMemory HTTP cases pass. | Test compile / test compile | Compile new helpers before interpreting test failures as behavioral RED. |
| P8b-E05 | Error classification / Medium | Independent review found removing broad `connect` matching also changed genuine uncoded pg-pool timeouts from sanitized 503 to UNKNOWN/500. | Add exact native timeout messages, retain causes, and keep the negative query-text controls. Three native-message tests went RED then GREEN. A real saturated one-slot pg Pool through Prisma and the User HTTP create/update paths now proves sanitized 503 and unchanged stored state on owned PostgreSQL. | Driver-positive unit/HTTP control / independent review | Removing an overbroad classifier requires both negative false-positive tests and positive native-driver controls; mocked P100x codes alone do not cover uncoded driver errors. |

### P8b integration coordination

| ID | Type / severity | Symptom and cause | Resolution | Earliest / actual detection | Prevention |
|---|---|---|---|---|---|
| P8b-I11 | Coordination / Low | P8b and sibling P8c independently reserved live section `9z-CS` from the same base. | Move P8b to `9z-CT`, including result prefixes and its feature guide. The focused section-ID assertion was RED at zero CT sections and GREEN at exactly one; the main script parses. | Shared integration planning / parent coordination | Validate shared section identifiers during integration; keep sibling source/signature merges with the parent. |

**Test/gate improvement: applied.** The section-ID check proves uniqueness
without rerunning unchanged backend behavior. **Design/architecture
disposition: accepted.** This is integration metadata only; no lifecycle port,
Group aggregate operation or conditional-update signature changes.

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

**P6b provenance:** reconciled the worktree's complete retained P6b runner,
build, lint, setup, HTTP and smoke logs using failure-signal and diagnosis
passes. The session did not supply `VSCODE_TARGET_SESSION_LOG`; no full
external conversation-transcript reconciliation is claimed. Import/setup
failures, mock/profile fixture failures, the incorrect metadata assertion,
and the non-SCIM health route were excluded from behavioral RED counts.
Final focused evidence is 616 unit tests, 156 HTTP tests per backend and 32
live checks per backend. All owned API processes and exact database
containers were stopped/removed.

The doc render passed with pinned Mermaid 11.15.0 in both themes, but renderer
discovery reported the editor's version as `0.0.0`. That environment diagnostic
is recorded, not "fixed" by changing the pin to an invalid version.

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

### P8b transcript reconciliation and disposition

The complete parent `events.jsonl` was scanned twice by event, not reconstructed
from a compaction summary. At the reconciliation checkpoint it contained
28,601 events, with 226 tool starts selected by the cleanup worktree/P8b scope
and 224 completed results. The local scan artifact records exact counts.
Error-signal passes covered TypeScript failures, missing tools, FAIL/SKIP,
403, assertion and patch errors. A separate narration pass covered root cause,
stale state, no-op, rollback, silent failure, guard and atomicity terms.

The confirmed issues map to P8b-I01 through I10. Source quotations, deliberate
negative controls, reviewer prompts and search echoes were dismissed as
non-issues rather than counted as extra failures. Later confirmation runs
passed the guarded and standard PostgreSQL paths, live tests and final
InMemory HTTP tests. No shared or estate database was involved.

**Test/gate disposition: applied.** Exact row/member counts and supported-route
preconditions prevent false-green deletion checks. Standard and guarded test
entry points are separate assertions, not interchangeable evidence.

**Design/architecture disposition: accepted.** A required narrow lifecycle
port and synchronous storage swaps preserve the existing repository boundaries.
The deleted-ID barrier intentionally does not expire. A generalized UnitOfWork
or shared-store rewrite is not needed for this package.

### Exact-error follow-up reconciliation and disposition

The complete parent transcript was scanned again, with an error/signal pass
and a separate diagnosis-phrase pass. At this checkpoint it contained 36,214
events. Selecting cleanup-worktree/P8b tool calls after the follow-up request
at `2026-09-29T06:10:43Z` yielded 172 starts and 170 completed results.
`test-results/p8b-errors/transcript-scan.json` records the counters.

Confirmed issues map to P8b-E01 through E05. Earlier P8b error excerpts,
intentional negative controls, quoted source and reviewer probe narration
were not counted again as new failures. The unavailable editor diagnostics
tool used the already-recorded native build/lint fallback; no new dependency
or shared-tool mutation was needed. No remaining diagnosed implementation
issue was found in that package-scoped pass.

The final PostgreSQL run passed 39 HTTP tests on 17.8 after all 22 migrations;
InMemory passed 37 with the native FK/pool controls explicitly N/A. The
ordinary PostgreSQL E2E entry point separately passed 21 tests. Latest live
runs passed 16 deletion plus 7 freshness checks per backend, and each exact
owned container was removed. The saturated-pool tests exercise the installed
driver and Prisma adapter, not an invented error message alone.

**Test/gate improvement: applied.** Exact status/envelope/allowlist checks now
accompany storage counts; native-driver positive controls complement
false-positive negative controls. **Design/architecture disposition:
accepted.** The subtype and create-only classifier are narrow extensions of
existing repository and HTTP seams. Independent review's native-timeout
finding was fixed and the follow-up review reported no significant issues.
No P3/P4/P8c source was imported; combined integration remains parent-owned.
