# SCIM correctness implementation: issues and lessons

> **Last verified:** 2026-10-08
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

### Validation continuation, 2026-10-08

The runtime changes in `fix/comprehensive-ui-validation-20260930` remain
uncommitted and undeployed. The final Prisma lane is 118 suites / 2,486 tests.
Current local InMemory and isolated Docker/PostgreSQL live suites each pass
1,700 assertions with zero leaked endpoints. Local Chromium is 238 pass /
15 skip / zero fail. Its skips are twelve canonical-dev pixel baselines,
one MSW-only cross-tab case, one documented hover-prefetch observability case,
and one **coverage gap**: the All-users bounded-table test had no local users.
The latter is not an environment-neutral proof and must not be called covered
by that local run. Final Docker Chromium executes it with seeded Users and
passes the complete 262-case suite: 248 pass / 14 documented skip / zero fail
in 590.086 seconds. The fourteen skips are twelve canonical-dev pixel
baselines, one MSW-only cross-tab case and one documented hover-prefetch case.
Final local regression browsers pass 2/2. Current full web units and coverage
pass 119 suites / 1,577 tests with lines 85.49%, branches 75.39%, functions
75.31% and statements 82.72%.

**Dependency gate: BLOCKED, not waived.** Production `npm audit --omit=dev`
reports API 1 critical / 9 moderate / 1 low and web 1 critical.
The critical production packages are `proxy-addr` and `seroval`.
Full audits, including development dependencies, report API 2 critical /
7 high / 14 moderate / 2 low and web 1 critical / 17 high / 3 moderate.
Raw reports are retained as `test-results/npm-audit-{api,web}-{production,all}-20261008.json`.
These are package-advisory findings, not a claim that each vulnerable API
is reachable in this application. The changed-code security follow-up found
no vulnerabilities. It does not discharge the dependency gate.
Remediation must use the approved quarantine/lockfile workflow and exact-tip
validation; no local lockfile rewrite or publishing occurred.

**Design disposition: accepted.** The new seeded-profile browser matrix is
a bounded, single-purpose opt-in spec against explicitly provisioned fixtures.
It reuses the existing authentication fixture and does not add a production
dependency or a speculative abstraction. **Test improvement: applied.**
The matrix asserts persisted row values, membership counts, actual settings,
unsupported-route outcomes and custom-resource CRUD rather than merely
asserting that the six endpoints exist. The six read-only shape cases,
custom HR extension edit, strict Group edit and custom Device CRUD pass
together with the existing profile-form scenario: 10/10 browser cases on
the rebuilt Docker image. The later final complete run also passes these
cases and the PATCH-envelope cache guard. The companion receipt is
`test-results/comprehensive-validation-receipt-20261008.json`.

| ID | Type / severity | Symptom | Root cause | Resolution / why it works | Earliest / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| RC-I35 | Dependency gate / High | Production audits return nonzero with critical `proxy-addr` and `seroval`; full development audits also contain high/critical findings | Frozen dependency manifests now match newly reported package advisories; a clean changed-code review does not inspect dependency advisory currency | Block publishing; retain production and full JSON reports. No automatic dependency or lockfile rewrite. Remediation remains unresolved and must use the approved quarantine workflow | Dependency sweep / resumed final audit | BLOCKED. Run independent package audits at consolidation and after approved dependency updates |
| RC-I36 | UI/cache timing / High | Docker browser reopening a saved extension showed `EMP-100` although PATCH and list GET both returned `EMP-200`; the failure recurred after strengthening the test's save-response and closed-drawer checks | User, Group and custom update hooks fired query invalidations but discarded their promises. The drawer could close and reopen from the stale list before its refresh finished; same-ID resource updates do not reseed the editable draft | Three unit REDs proved the mutation resolved while refresh promises remained pending. Return `Promise.all` of the two existing invalidations in all three hooks, keeping save pending until the read models refresh. GREEN is 103/103 focused units and 10/10 Docker browser cases. No commit exists yet | Mutation completion unit / full Docker browser (Stage 2 to Stage 5 escape) | Applied: deterministic deferred-refresh tests cover all three resource kinds; browser checks require write response values, drawer closure and reopened values. No broad reset-on-refetch was added, so unrelated background updates do not overwrite unsaved drafts |
| RC-I37 | Test addressing / Medium | The HR extension browser selector resolved to two `employeeNumber` inputs | Enterprise and HR extensions legitimately declare the same leaf name. Test IDs used that leaf name without its namespace | One unit RED returned null for schema-qualified wrappers. Expose the existing `field.id` as `data-profile-field-id`, preserving all existing test IDs and UI labels. The new browser scenario scopes its field to the HR URN. Form GREEN is 3/3 and HR browser edit/independent GET/restore passes | Multi-namespace form unit / explicit seeded browser matrix | Applied: a two-namespace unit asserts distinct values and the correct emitted field ID. Reuse the already qualified descriptor; do not introduce another identifier parser |
| RC-I38 | Runner selection / Low | The first focused Playwright command reported `No tests found` with zero collected cases | Backslash-separated Windows paths were passed as Playwright regular-expression selectors; they were not literal filesystem paths | Use filename-only selectors for this runner. The collected focused run then executed nine cases, exposing RC-I37. The corrected ten-case run is green | Collection preflight / first focused invocation | Applied convention: use native Windows paths for filesystem operations, but runner filename patterns for Playwright selection. Zero collection is not RED or GREEN evidence |
| RC-I39 | UI/cache contract / Medium | User and Group cached resource `schemas` became the `PatchOp` URN and cached rows acquired `Operations` | The legacy optimistic shallow merge treated an operation envelope as if it were a flat resource update. This was tightly coupled to the stale-save path reviewed for RC-I36 | Two unit REDs received `PatchOp` instead of the original resource schema. Recognized PATCH envelopes now skip only that optimistic merge and rely on the awaited server refresh; flat-body optimistic updates and rollback remain unchanged. All 105 focused units pass, including the existing mutation cases. No dependency or protocol changes | Cache-shape unit / focused RCA follow-up before publishing | Applied: User and Group negative controls assert original schema URNs and absence of the transport-only `Operations` field in resource cache |
| RC-I40 | Test fixture typing / Low | Both API unit lanes failed compilation after nullable `RequestLog.endpointName` became a required property of typed log rows | The ActivityController shared fixture omitted the new nullable field even though production queries returned it | Add the field using the existing nullable override convention. Focused ActivityController tests passed 20/20; final unit lanes each pass 209 suites / 6,006 tests. The original type failure was recovered from local event records 5939/5942 during reconciliation | Typed fixture/build check / first backend matrix | Applied: keep shared typed fixture factories aligned with DTO changes; compilation/setup failures are not behavioral RED evidence |
| RC-I41 | Editing tool / Low | A documentation patch applied three files, then failed its unused final changelog context | The final hunk referenced text not present in the changelog; apply_patch preserves successful earlier hunks instead of rolling back the whole batch | Inspected the three applied updates and actual changelog context, then retried only the remaining changelog update. No rollback or duplicated edits | Patch-context check / tool response | Applied convention: treat partial application as a state change; inspect before retrying and do not replay already applied hunks |
| RC-I42 | Browser coverage / High | Cross-tab invalidation was skipped on every real backend because it required the MSW endpoint and an obsolete manual-provision test journey | Mock availability was used as a precondition instead of creating a real isolated endpoint | Replaced the scenario with two authenticated browser contexts, a real User form write, stream response checks, Tab B's independent GET and rendered row, and fixture cleanup. GREEN against combined Compose; suppressing only Tab B mutation events produces a five-second refetch timeout. Inspected both failure screenshots: A has the User, B is empty. No baseline update | Real-browser negative control / combined-source validation | Applied: no MSW-only skip; the test exercises local, container and deployed APIs with the same owned fixture and asserts the specific User, not only a row count |
| RC-I43 | Browser coverage / High | The hover-prefetch case was permanently skipped because onboarding had already warmed the Endpoints query | The chosen query could not distinguish hover-triggered loading from mount-time loading | Test a cold Logs query from Settings: assert zero initial requests, valid prefetched data before any navigation, and reuse on click. Withhold hover as a negative control: the response wait times out. Inspected its Settings screenshot; no product defect or baseline drift was inferred. Both restored browser cases pass together | Observable browser contract / combined-source validation | Applied: choose a cold real route rather than changing onboarding behavior or replacing network proof with a skeleton-presence assertion |
| RC-I44 | Tooling / Low | A focused Playwright invocation collected zero cases again | A filesystem-style backslash path was passed to Playwright's regular-expression selector | Use the filename-only pattern. The corrected command collected and passed the real SSE case | Runner collection / first combined focused command | Existing RC-I38 convention applies; zero collected tests are never green evidence |
| RC-I45 | Test isolation / Medium | Browser and backend-matrix jobs initially shared the disposable database | PostgreSQL E2E fixture state and browser shape inventory are independent claims that must not share mutable state while running concurrently | Created a separate browser database on the same owned PostgreSQL server before running the real browser case, switched the Compose API to it, migrated and seeded it. Matrix retains its separate database | Harness topology / before productive browser execution | Applied: one database per simultaneously running validation lane, even inside an owned disposable estate |
| RC-I46 | Readiness / Low | A fixed five-second delay after API recreation still produced a premature HTTP response | Database migration and startup exceeded the guessed delay | Inspected startup logs, confirmed actual HTTP 200, then seeded and ran browsers. Initial estate startup already used bounded health polling | HTTP preflight / API recreation | Use bounded readiness checks, not a guessed sleep. Do not classify startup transport errors as application assertion failures |
| RC-I47 | Harness contention / Low | The matrix web Vitest lane timed out one dialog test at the default five-second limit while Prisma E2E and browser work were consuming the machine | The test completed normally outside concurrent heavy validation; the matrix coverage lane also passed the complete suite | Re-ran the exact file after competing load ended: 3/3 passed in 16.12 seconds, with the test body taking under one second. No timeout or product code was changed | Full parallel matrix / focused retry | Schedule heavyweight lanes serially on this workstation. A load-induced timeout needs a focused idle retry plus an independent complete-suite pass before classification |
| RC-I48 | Gate drift / High | Normal pre-push blocked on a removed prose fragment even though the newer digest/source identity guards were present and a dedicated deployment contract passed | The older workflow-selection contract checked the historical message `Version/latest image mismatch`; pipeline evolution replaced it with stronger semantic-to-source and cross-registry digest gates without updating this duplicate assertion | Keep the exact-SHA workflow checks, but replace the obsolete prose requirement with the two current guard names. The contract is RED before and GREEN after. No shipping control was weakened | Pre-push contract / first feature push | Applied: contracts assert current control semantics, not retired wording. Deployment changes must run both deployment contract suites before commit |
| RC-I49 | Shell interpolation / Medium | Prisma reported a database named `=public` during isolated migration setup | PowerShell parsed `$db?schema` as one variable reference, removing the intended database name from the URL | Drop only the mistaken session-owned database and delimit the variable as `${db}?schema=public`. Prisma then named and migrated `scim_consolidation_20261009` through all 23 migrations | Migration output / setup before Prisma E2E | Applied convention: delimit a PowerShell variable when URL punctuation immediately follows it, and assert the parsed URL path before migrations |
| RC-I50 | Browser preflight / High | A full run reported 217 failures, 25 skips and only 20 passes, with missing app controls and repeated fixture HTTP 401 responses | Vite targeted an older validation API whose shared secret differed from the supplied browser token. The existing global setup checked only public health, so one authentication setup error cascaded across the suite | Start the exact-tip API with the intended token, then require global setup to read `/scim/admin/endpoints` with that token. A wrong-token negative control now stops once with HTTP 401. Corrected full Chromium passes 250 with only 12 canonical pixel skips | Authenticated preflight / first full exact-tip browser run | Applied: browser validation must prove both liveness and authenticated readiness before collecting cases. Do not count a setup cascade as hundreds of independent regressions |
| RC-I51 | Browser timing / Medium | The corrected representative run passed 15/16; the SSE case timed out waiting five seconds for the stream response even though the API authenticated and flushed it | Playwright's default action timeout was reused for connection establishment under isolated local load. The same five-second bound is meaningful for mutation-triggered refetch, but too narrow for initial Vite/browser/SSE startup | Give only initial stream connection a 15-second bound. Keep the mutation-refetch wait at five seconds. Focused SSE passes in 22.9 seconds, repeats in 18.0 seconds, and the complete corrected run passes | Representative browser run / exact-tip browser stage | Applied: separate startup readiness budgets from behavioral reaction budgets; never widen the assertion that proves the mutation signal |
| RC-I52 | Review / Medium | Expired or rotated SSE credentials caused both realtime consumers to retry forever with the token captured when the hook mounted | The transport flattened HTTP status into a generic error, both hooks classified every failure as transient, and `token` was read outside `connect()` | Preserve HTTP status in `AuthenticatedSseError`. On 401/403, close the stream, clear stored credentials, notify the existing token gate, mark closed and do not schedule a retry. For other failures, call `getStoredToken()` on every attempt. Four RED controls cover both consumers and the focused set passes 53 tests | Final exact-tip code review / post-CI review | Applied: transport failures retain the classification needed by consumers; authentication failures are terminal until credentials change, while transient retries never capture stale auth state |

**2026-10-09 combined-source continuation:** the aged dependency commit
`6075ad3d` plus the preserved UI/runtime overlay is now exercised in a
separate worktree. A fresh-base, no-cache image runs through the repository's
actual Compose file with an owner-labelled isolation override. Full Chromium
passes **250 / 12 pixel-only skips / zero failures** across 262 cases.
The two formerly skipped behavior cases now execute, with inspected negative
controls demonstrating that their assertions depend on SSE and hover.
Compose live HTTP validation passes **1,700 assertions**, with no orphaned
test endpoints. All four API matrix lanes pass: 6,007 units per backend,
2,426 InMemory E2E passes / four PostgreSQL-only skips, and 2,486 Prisma E2E
passes. The web coverage lane passes the complete 1,577-test suite. Its plain
Vitest lane had the RC-I47 load timeout; the exact focused idle retry is green.
This records current execution evidence, not a merged release or Azure proof.

**Exact-tip consolidation continuation:** after dependency owner removal and
CI lock import, API audits have zero critical/high findings and web audits have
zero findings. Serial Prisma E2E passes 118 suites / 2,486 tests. Exact-tip web
coverage passes 119 suites / 1,577 tests. The corrected full Chromium run
passes 250 with 12 canonical-dev pixel skips after RC-I50 and RC-I51 were
resolved. This remains branch evidence, not merged-master or deployed-dev
evidence.

**Self-improvement disposition: applied.** Browser assertion sensitivity is
now measured by suppressing the claimed trigger before accepting the positive
run. **Design disposition: accepted.** The two cases reuse existing auth and
endpoint fixtures without changing product behavior or introducing a new
harness abstraction. This new continuation is recorded from current tool
results; the earlier full-transcript reconciliation does not certify it.

**Cleanup proof:** the final owned estate retained exactly six seeded endpoints,
18 Users, ten Groups, zero Devices and the restored HR employeeNumber. All
captured API/database containers and the network were removed after exact
owner/run verification. The pre-existing non-owned Compose API and PostgreSQL
containers remain running. Local API/Vite were preserved.

**Completeness provenance for this continuation:** reconciled against the full
available local `events.jsonl` stream through record 8,306, using a failure-signal
frequency pass over tool completions and a separate assistant diagnosis/fixture
narration pass. Signals included TypeScript errors, HTTP 401/415/422, connection
errors, missing modules, no-test collection, false positives and provider/rebase
terms. Scanner-output echoes, expected negative HTTP contracts, intentional
REDs and the inherited 66 web TypeScript diagnostics were distinguished from
new issues. The newly diagnosed failures map to RC-I35 through RC-I40; the
earlier continuation issues remain RC-I22 through RC-I34. RC-I41 records the
later final-documentation tool friction when it occurred. This is reconciliation
of the available local event stream, not a claim that external worker histories
or an unavailable cloud session store were inspected.

**Design disposition for RC-I36: accepted.** The existing mutation hooks
remain the cache-settlement boundary. Returning promises adds no dependency,
shared policy engine or class responsibility. The analogous fix covers three
real resource kinds; extracting a generic hook solely for three short existing
invalidation pairs would be speculative. The large query module is pre-existing;
this change does not add another concern to it.

### v0.55.36 release-candidate gate issues

| ID | Type / severity | Symptom | Root cause | Resolution and why it works | Earliest possible / actual detection | Prevention / status |
|---|---|---|---|---|---|---|
| RC-I01 | Correctness / High | Valid resource writes returned a false 409 `PROFILE_REVISION_CHANGED` after an endpoint profile had been read | Lazy schema compilation attaches `_schemaCaches` after the persisted profile revision is recorded, so later request-context hashing included runtime-only Maps that were never profile content | Profile revision canonicalization excludes `_schemaCaches`. A RED unit proved cache population changed the hash; GREEN keeps the content revision stable while preserving changes to persisted profile fields | Revision unit / full InMemory E2E | Permanent unit locks the runtime-only exclusion. Any future runtime cache must be reviewed at the canonical content-revision boundary |
| RC-I02 | Error contract / Medium | Malformed filters returned `invalidFilter` without the documented diagnostics extension | `createReadQuery` caught the parser error but constructed only the base SCIM error | The catch now supplies `FILTER_INVALID`, the original filter expression, and the parser message through the existing diagnostics envelope. Focused RED/GREEN and the complete E2E suite pass | Shared query unit / full InMemory E2E | Permanent unit asserts both SCIM status/type and meaningful diagnostic values |
| RC-I03 | Test correctness / Medium | Four legacy E2E cases returned 400 before reaching uniqueness or immutable-transition assertions | Lexmark fixtures omitted its required Enterprise extension namespace. The immutable fixture tried to redefine common `externalId` as immutable, which current RFC 7643 common-attribute admission correctly rejects | Lexmark requests now carry the required extension namespace. The immutable behavior test uses a custom `employeeNumber` characteristic instead of weakening the common-attribute contract. The two focused suites pass 67/67 | Fixture contract review / focused rerun after full E2E failure | Required-extension transition tests and common-attribute admission remain authoritative; fixtures must satisfy them before testing a later behavior |
| RC-I04 | Harness configuration / Low | Three logging E2E suites reported seven missing-event failures | The ad hoc triage command set `LOG_LEVEL=OFF`, suppressing the events those tests intentionally observe | Rerunning the same suites under their default logging configuration passed. No product or test expectation changed | Command review / focused rerun | Do not override a capability that the selected tests assert. Full E2E confirmation ran with default logging and passed 118/118 suites |
| RC-I05 | Execution monitoring / Medium | The API unit command appeared stalled for hours after producing no further visible output | Jest completed 209/209 suites and 6,000/6,000 tests in 104 seconds, then retained an asynchronous handle. The completed summary was not inspected when the synchronous tool moved to background | The green summary was recovered from the saved artifact and only that owned process tree was stopped. No duplicate suite was launched and no unrelated process was terminated | Bounded post-run monitor / operator escalation | A timed-out gate must be read promptly. Once a complete Jest summary exists, allow only a bounded exit grace, then stop the exact owned session and separately investigate handles rather than waiting indefinitely |
| RC-I06 | Environment / harness / Medium | The exact built InMemory artifact started successfully but its readiness probe received 502 until timing out | On this Windows host Node bound the app on IPv6 wildcard while a machine-owned process held the same port on IPv4 `127.0.0.1`. The runner reserved and probed IPv4, so it reached the unrelated listener instead of its owned runtime | RED changed the safety contract to `localhost` and failed the hard-coded IPv4 assertion. GREEN reserves and probes `localhost`, which resolves to the owned IPv6 listener, while the guarded PostgreSQL database remains pinned to loopback IPv4 | Runtime address ownership assertion / exact-artifact readiness | The safety contract now rejects regression to the conflicting IPv4 runtime URL. The failed run started no database container, and the owner-label cleanup inventory was empty |
| RC-I07 | Harness / cleanup / Medium | The first session-only Prisma matrix wrapper could not load the repository guard, then repeated the same path failure in `finally` before cleanup | The wrapper inherited the caller's working directory instead of pushing the consolidation root, and cleanup made guard success a prerequisite to exact-ID removal | The one owner-labeled tmpfs container was identified by owner/name labels, inspected, and removed by its full ID within 35 seconds. The wrapper now pushes the repository root and always attempts exact-ID removal before reporting a final guard failure. The rerun passed 6,000 unit and 2,485 E2E tests, 22 migrations, final ownership guard, and exact cleanup | Wrapper smoke before database start / first guarded invocation | Session-only wrappers must set their working directory explicitly. Cleanup is unconditional after identity capture; a verification failure may fail the run but must not bypass removal |
| RC-I08 | Harness scope / High | Four Docker live packages produced `PSObject` `op_Addition` exceptions before reporting their 82 SCIM assertions, while the other 1,615 assertions passed | The main live runner's overridden HTTP functions called `Add-FlowStep` from separately invoked `.ps1` files. PowerShell resolved `$script:flowSteps` to each child script scope, not the root runner. The first request stored a scalar `PSCustomObject`; the second attempted scalar addition and failed | A RED process-level contract invoked the real `Add-FlowStep` twice from a nested script and proved the root collection was unchanged. GREEN uses one process-global mutable list as the stable tracing sink, aliases the root runner to it, assigns step IDs from its count, suppresses `List.Add` output, and removes the variable before exit. The four focused packages pass 82/82 with 137 traced requests and unchanged endpoint inventory; the isolated Docker rerun passes 1,697/1,697, 22 migrations, zero remaining endpoints, and exact API/database/network cleanup | Nested-script tracing contract / Docker live gate | The permanent contract executes across an actual child `.ps1` scope rather than checking source text. Any live helper can now use the traced HTTP wrappers without changing the sink scope |
| RC-I09 | Test harness / Low | The first GREEN attempt still failed to observe child calls, then reported missing flow-conversion functions | The temporary child had no `.ps1` extension, and extracting only `Add-FlowStep` omitted its two formatting dependencies | The test now creates a uniquely named `.ps1` file, defines minimal identity formatters, executes the real parsed function twice, and verifies both ordered step IDs in the root collection. The complete wiring suite passes 9/9 | Focused contract / focused contract | An executable scope test must use an executable script extension and provide the direct dependencies of the extracted unit |
| RC-I10 | Tooling / Low | The first focused four-package run reached its final inventory assertion, then `Compare-Object` rejected a null reference | Piping an empty endpoint projection outside the array expression collapsed the zero-endpoint inventory to `$null` | Both pre- and post-run IDs are materialized as arrays before comparison. The rerun passes 82/82 checks, records 137 flow steps, and proves unchanged empty inventory | Focused helper wrapper / focused helper wrapper | Session wrappers must preserve empty collections as empty arrays when equality is part of the gate |
| RC-I11 | Gate drift / Medium | The first push was blocked after 11 Fast gates passed because the patterns-pie checker could not find its required title | The checker still required the historical suffix `(N seeded)`, while the maintained Mermaid title has used `(N)` since before the current 33-pattern update. The numerical distribution was correct, but the stale format matcher made the gate reject valid content | The matcher now validates the maintained `Patterns by category (N)` title and still compares the declared total plus every A-G slice with the de-duplicated catalog. The focused gate reports A=11, B=4, C=4, D=2, E=5, F=3, G=4, total 33 and passes | Checker contract when title format changed / pre-push | Gate parsers must track the canonical artifact syntax while preserving the measured invariant. The fix changes only the obsolete suffix expectation, not any category or total check |
| RC-I12 | Security / High | The first exact-tip CodeQL policy run reported five high-severity remote property-injection paths in shared PATCH execution and read-only preprocessing, plus one regex and two unused-symbol findings. The first sink-local sanitizer pass remained red and expanded the visible helper findings to ten | Parser validation existed, but the computed property operations did not carry a structural proof CodeQL could follow. Passing tainted names through `safePropertyKey` was runtime-safe but did not terminate the query's interprocedural flow. The first regex edit also retained a duplicated underscore | Shared execution uses immutable `put`; readOnly preprocessing now rebuilds objects from validated entry lists and returns the filtered payload explicitly to User, Group, and generic services. No changed helper sink performs a request-derived computed write or delete. Regressions prove JSON own-properties named `__proto__` are not dereferenced and global objects remain unpolluted. Eight unit/service suites pass 639/639, four affected HTTP suites pass 317/317, changed-source lint has zero errors, and the API build passes. The regex class now has one underscore. Exact-tip CodeQL analysis and policy passed at `509844bf`; PR #188 merged as `d6e9a497` | Sink-local static analysis / exact-tip CodeQL | GREEN. A sanitizer that the authoritative analyzer cannot prove is not sufficient release evidence. Remove tainted computed sinks structurally instead of suppressing CodeQL or layering a second policy |
| RC-I13 | Supply chain / High | The first exact-tip image scan found `fast-uri` 4.1.3 vulnerable to CVE-2026-84292 and CVE-2026-84394 | The transitive override was current at its 2026-09-25 review but no longer met the advisory set discovered by the release image scan | The manifest and workflow-generated lockfile advance to fixed 4.1.4 and record both CVEs. Workflow run 36735519112 used the public registry, changed only the package version, URL, and SHA-512 integrity, and reported a 28.2-day publish age. A clean install and API build pass; the production audit exits zero at the HIGH threshold with zero HIGH/CRITICAL, seven MODERATE, and one LOW finding. Exact-tip Trivy passed before merge and for the published v0.55.36 image | Dependency advisory sweep / exact-tip image Trivy | GREEN. Trivy remains an independent release gate. A newly fixed package must still satisfy the seven-day quarantine; neither local lockfile regeneration nor a quarantine bypass is allowed |
| RC-I14 | Test correctness / Medium | The purplecliff Playwright run passed 248 tests but the `user-only-with-custom-ext` preset returned 400 instead of the expected 201 | The test built a core payload from `/Schemas` and assumed extension requirements were published there. RFC discovery declares required schema extensions on `/ResourceTypes/User`, so the test omitted the required Enterprise extension from both `schemas` and the resource body | The preset loop now reads the User ResourceType, adds every required extension URN and an extension object, and keeps the core-schema-driven fields. Focused RED reproduced the 400; focused GREEN passed 1/1; the complete dev suite passed 247 tests with 5 intentional skips | Test design review / post-deploy Playwright | Preset payload builders must combine schema attribute discovery with ResourceType extension bindings. A 200 `/Schemas` assertion alone does not prove a write is schema-conformant |
| RC-I15 | Harness / Low | The first dedicated replication verifier reported blank local/dev versions and stopped before creating either endpoint | In PowerShell 7, `Invoke-WebRequest` exposed `application/scim+json` content as `byte[]`; piping that value directly to `ConvertFrom-Json` parsed bytes instead of one JSON document, repeating the mechanism already recorded in P3-I08 | The verifier decodes byte content as UTF-8 at its transport boundary. The rerun proved both nodes were v0.55.36, replicated an identical profile SHA-256, validated PATCH response plus independent GET on both nodes, and deleted both dedicated endpoints | Verifier transport smoke / first verifier run | Existing P3-I08 prevention applies to every PowerShell HTTP harness, including one-off release receipts. The failed attempt created no endpoint and its receipt records `not-created` cleanup |
| RC-I16 | Harness evidence / High | The deployment receipt labeled `test-all-modes.ps1` as a passing six-mode matrix even though only four log files existed and the Prisma-labeled E2E receipt contained four PostgreSQL-only skips | When `DATABASE_URL` was absent, the orchestrator warned, assigned `SkipPrisma=true`, ran only the remaining modes, and exited zero. An implicit environment omission therefore produced success-shaped evidence for a reduced matrix | A functional sandbox RED invoked the real script with a fake `npm` and proved missing database configuration exited zero after starting the InMemory mode. GREEN exits 2 before any mode unless `-SkipPrisma` is explicit; the explicit opt-out remains a passing one-backend path. The contract now executes both outcomes without running product suites | Orchestrator prerequisite contract / deployment receipt reconciliation | A backend matrix may be reduced only by an explicit caller choice. Missing infrastructure must fail as a prerequisite, never silently convert an authoritative matrix into a partial run |
| RC-I17 | Browser evidence / Medium | The corrected dev run retained aggregate `247 passed / 5 skipped`, but `.last-run.json` contained only `status` and `failedTests`, so the five skip names and annotations could not be reconstructed exactly | The deployment invoked only the line reporter. Playwright's last-run metadata is a retry aid, not a complete result model, and intentionally omits passed/skipped test records | The deployment now combines the readable line reporter with Playwright's JSON reporter and writes `playwright-dev-<timestamp>.json` beside the deployment report. A RED/GREEN source contract requires the dual reporter, durable path, and process-environment restoration; both contracts are wired into pre-push | Reporter-shape review / final assurance reconciliation | Aggregate counts are not diagnostic evidence. Browser gates must retain item-level results and skip annotations so intentional exclusions can be reviewed without rerunning an unchanged suite |
| RC-I18 | Test tooling / Low | The first browser-evidence contract failed to parse, and its first GREEN attempt failed to recognize a valid multiline environment-restoration call | PowerShell did not continue the parenthesized boolean expression across the chosen newline shape, and the regex assumed `SetEnvironmentVariable` plus its argument were on one line | Boolean matches are assigned as complete expressions, and the restoration matcher uses explicit single-line regex mode. The contract then passes all five assertions | Contract parse / contract RED-GREEN | Parse a PowerShell contract before interpreting assertion failures, and use `(?s)` only when a source contract intentionally spans lines |
| RC-I19 | Environment recovery / High | Docker Desktop could not start and reported `desktop-linux` context replacement denied for `.tmp-meta.json -> meta.json`, blocking disposable PostgreSQL and container gates | The original context file retained a Win32 sharing violation 32 after Docker Desktop, its only WSL distribution, and `WSLService` were stopped. ACLs, ownership and file contents were correct; Restart Manager, an elevated handle scanner and signed Sysinternals Handle exposed no user-mode owner. A Windows restart released the persistent kernel or minifilter reference; the initiating actor remains unidentified | Before repair, five Docker disk/config artifacts totaling 65.87 GB were copied and SHA-256 verified. A process-scoped `DOCKER_CONFIG` copy proved the original engine, containers, images, volumes and database remained usable without changing originals. After the guarded service restart proved insufficient, an authorized Windows restart cleared DELETE access from 32 to 0. Docker then passed two normal starts with no override, preserving 3 containers, 16 image IDs and 26 volumes exactly; the original SCIM API/PostgreSQL IDs are healthy, version is 0.55.36, endpoint count is zero and 23 migrations remain. Only two exact temporary config copies were removed; the cold backup is retained | Docker startup popup / post-deployment assurance continuation | Never reset or delete Docker state for an unexplained metadata lock. Prove ACL versus sharing violation, cold-back up disks/config, reject file replacement if a disposable negative control fails, and escalate from idle service restart to an authorized Windows restart before regenerating metadata |
| RC-I20 | Browser harness / Medium | A focused skip-classification run reported two router timeouts and three 70-100% visual diffs after 40 earlier outcomes passed | All three visual actuals were the same 1440x900 solid `#0F1115` blank page, and both router failures also lacked `app-shell`. This was a transient navigation/render failure, not an intended visual change | Every diff was inspected, no baseline was regenerated, dev returned HTTP 200, and the exact five outcomes passed serially with one worker. The new JSON reporter retained the failure and skip identities needed for diagnosis | Focused current browser classification / visual-diff inspection | A visual failure is a blocker until its diff is inspected. Preserve item-level JSON, classify blank-page failures separately from product layout changes, and rerun only the exact failed outcomes before widening scope |
| RC-I21 | Estate evidence / Medium | The current dev endpoint list returns 71 active entries while the historical deployment receipt recorded 60 before and after | The 11 additional IDs are long-lived rows created in August or September and none was created or updated during the focused assurance run. The historical receipt does not retain enough data to reconstruct when or why they became visible | No endpoint was deleted or repaired. The final receipt preserves the historical 60-to-60 claim as a dated observation, records the current 71 count and proves the focused run retained zero created or updated endpoints | Post-focused-run inventory check / could not be determined from historical aggregate | Data-integrity receipts must retain both before and after inventories as durable artifacts. A later count discrepancy must be reconciled by IDs and timestamps before attributing it to the current run |
| RC-I22 | Harness safety / High | The authoritative deployment pipeline could reuse any Docker container publishing host port 5432, or remove a fixed-name container before starting its own PostgreSQL prerequisite | The Stage 2 bootstrap treated a shared host port and a predictable container name as proof of task ownership. It had no run label, random loopback port, tmpfs storage, or identity check before cleanup | A RED source contract failed all three ownership assertions. GREEN starts a unique run-labeled PostgreSQL container on a Docker-assigned loopback port with tmpfs data, injects its exact `DATABASE_URL`, waits for readiness, verifies owner and run labels before removal, removes only the captured full container ID, and verifies absence afterward. The contract passes 8/8 | Pipeline source contract / pre-execution safety audit | Every disposable database gate must create and identify its own database. Port presence or a familiar name is never ownership evidence, and cleanup must target only a captured ID after label verification |
| RC-I23 | Tooling / Low | The first focused contract command failed before running the script | The shell tool starts in the session workspace `SCIMServer`, while the changed branch lives in `SCIMServer-master`; a relative `scripts\...` path therefore resolved in the wrong worktree | The rerun used the absolute worktree path and produced the intended three-assertion RED result | Command construction / first focused run | Commands for a non-default worktree must use an absolute path or set the working directory in the same process |
| RC-I24 | Artifact provenance / High | Docker showed different sizes for GHCR and ACR `latest`; the tags resolved to different image indexes, configs, layers, Node versions and Alpine releases | The pipeline pushed a local Compose rebuild to ACR `latest`, then independently built GHCR `latest` in Actions. The local `--no-cache` build omitted `--pull`, so it reused a May 21 `node:24-alpine` base with Node 24.16.0 / Alpine 3.23.4 while Actions used Node 24.21.0 / Alpine 3.24.2. Stage 4.5 imported only the semantic version back to ACR, leaving its mutable `latest` on the local artifact | Measured registry evidence showed GHCR `latest` at `sha256:49719...` / 123,570,199 bytes and ACR `latest` at `sha256:69c41...` / 119,348,636 bytes, while both `0.55.36` tags already matched `sha256:49719...` and dev ran the GHCR version tag. A RED contract failed local-tag, dual-import, digest-parity and base-refresh assertions. GREEN uses `local-<sha>` only for optional local mirrors, imports the CI-built GHCR version into both ACR version and `latest`, verifies all three registry digests, and adds `--pull` to no-cache local builds. The contract passes 13/13 | Operator Docker-size observation / registry manifest and runtime-content comparison | A tag name is not artifact identity. Every shipping tag replicated across registries must be sourced from one build and compared by digest; local validation tags must be visibly non-shipping, and no-cache builds must also pull the current base |
| RC-I25 | Harness construction / Medium | Direct Prisma E2E and the Prisma E2E matrix lane failed before tests with `P1013`, reporting an unrecognized database URL scheme | The initial harness edit embedded the complete disposable-database URI as one string. Secret sanitization replaced its scheme and credentials with six asterisks in the generated file, leaving a 50-character invalid value that still contained the expected loopback host and schema suffix | A structural probe confirmed both valid schemes were false and the first six code points were asterisks. A RED contract required component-based URI construction without a credential URI literal. GREEN formats the scheme, user, password, host, port and database as separate non-secret test components; the source contract passes 14/14 | Prisma global setup / first full pipeline run | Generated harness code must not embed even disposable credentials in a URI literal. Construct test connection strings from explicit components and lock the final shape with a source contract plus a real migration run |
| RC-I26 | Deployment identity / High | Dev live SCIM minted a valid OAuth token, created three endpoints, then received `bearer_oauth_signature_invalid`; cleanup could no longer authenticate and the data-integrity gate found three new IDs | The same semantic version was redeployed. Stage 4.6b accepted the old revision immediately because it also reported `0.55.36`, then live tests began while ingress moved to the new revision. Both revisions generated their own ephemeral OAuth key, so a token minted on old failed after traffic switched to new. The new replica had restartCount 0, one replica, and 100% traffic after cutover, excluding restart and multi-replica hypotheses | Before/after evidence identified and exact-ID deleted the three live-test endpoints, restoring 71 endpoints with zero remaining owned IDs. A RED contract required exact revision identity, readiness, health, replica count, traffic weight and two authenticated probes. GREEN waits for `latestRevisionName` and `latestReadyRevisionName` to equal the intended revision, requires Healthy / replicas >= 1 / trafficWeight 100, and then requires two consecutive OAuth-authenticated version probes. The source contract passes 15/15 | Live SCIM auth failure / exact revision and replica evidence | A semantic version is not a deployment identity. No live token or test may start until the exact revision is healthy and exclusively serving traffic; same-version redeploys make version-only readiness a false green |
| RC-I27 | Tooling / Low | The focused endpoint-create reproducer succeeded with 201 but printed 76.9 KB of byte values and failed to recover its created ID in `finally` | PowerShell exposed the `application/scim+json` response body as `byte[]`; the reproducer repeated the transport-boundary mistake already documented in P3-I08 and RC-I15 | The endpoint was found by its unique `e2e-create-repro-*` name, deleted with the three pipeline-owned IDs, and verified absent. The current endpoint count returned from 75 to the 71-item baseline | Reproducer output / immediate inventory reconciliation | Reuse the established byte-to-UTF-8 response decoder for every PowerShell HTTP helper, including one-off diagnostics. A unique name is a secondary ownership key, not a substitute for decoding the primary response |
| RC-I28 | Audit usability / Medium | Global Logs showed raw endpoint UUIDs where operators expected names | The ID-to-name UI map worked only while an endpoint still existed. `RequestLog` deliberately survives endpoint deletion but stored only `endpointId`, so deleted-endpoint rows had no human-readable identity to render | Measured browser evidence showed all 12 visible UUIDs belonged to deleted endpoints, while an active endpoint rendered its display name correctly. RED unit tests required the request correlation context and InMemory list/detail to preserve an endpoint-name snapshot; RED Playwright received `ep-deleted` instead of `Deleted Endpoint Snapshot`. GREEN adds nullable `RequestLog.endpointName`, captures displayName/name at the controller's existing endpoint lookup after authentication, persists and returns it on both backends, prefers it in Logs and dashboard activity, hides dead quick-open links, and labels legacy rows `Deleted endpoint (<id>...)`. Requests rejected before controller resolution can still lack a snapshot; this limitation must not be described as pre-auth capture. Focused unit tests pass 46/46 and local Playwright passes 1/1 | Operator UI observation / measured global Logs rows | Durable audit records must snapshot the human identity needed to interpret them after the source entity is deleted or renamed. A live join alone cannot satisfy an append-only audit contract |
| RC-I29 | Security and realtime UI / High | Every UI screen emitted repeated 401s for `/scim/admin/log-config/stream?token=...`; health stayed Degraded and realtime invalidation/notifications/live logs never connected | Native `EventSource` cannot set Authorization headers, so both hooks appended the bearer secret to the URL. The backend correctly ignored query credentials and required the header. The failed URL was then written into request logs, leaking the secret into browser, proxy and server URL surfaces while still not authenticating | RED transport tests required Authorization-header use, no token in URL, split-message parsing and 401 propagation. GREEN introduces one Fetch/ReadableStream SSE adapter consumed by both hooks, retains reconnect/backoff/cleanup behavior, and removes query credentials. Focused tests pass 49/49. A real local-Vite browser against dev recorded zero failed responses, zero page errors, no token-bearing URL, visible Logs, and `System status: Healthy` | Operator UI inspection / browser console and network capture | Browser streaming must use an authenticated transport that supports headers. Secrets in query strings are forbidden even when the server could accept them; URL credentials leak through observability and history surfaces |
| RC-I30 | Test evidence / Medium | A focused Playwright run deleted attachment directories from a concurrently running serial rerun, and parallel InMemory/PostgreSQL E2E runs generated the same second-resolution JSON filename | Independent runners shared mutable evidence paths: Playwright's configured output directory and `.last-run.json`, plus the E2E reporter's `e2e-YYYY-MM-DD_HH-MM-SS.json` and `latest` file. Both runs executed tests correctly, but one could erase or overwrite the other's diagnostic evidence | Playwright execution is now serialized for this activity. The E2E reporter run ID is being hardened separately to include sub-second/process identity; current focused E2E results are taken from each process summary rather than the collided `latest` artifact | Evidence reconciliation / overlapping focused runs | Test execution may be parallel only when every runner owns a unique output directory and immutable receipt name. Shared `latest`, last-run, screenshot, trace or second-resolution paths require serialization |
| RC-I31 | Release immutability and provenance / High | A second full-pipeline run rebuilt and overwrote GHCR/ACR `0.55.36`, changing the recorded release digest even though merged runtime inputs had not changed. Security review then found that checking tag parity and deploying a tag still allowed substitution after the check | The publish gate dispatched unconditionally whenever the pipeline ran. A semantic version was treated as a convenient mutable build target, and the deploy used that mutable tag instead of a digest bound to the merged runtime-source commit | A RED contract required existing-tag detection, parent-version comparison, runtime-input change detection, source-SHA digest binding, digest import and digest deployment. GREEN resolves the last first-parent runtime commit, requires its `sha-<commit>` tag to equal the semantic tag, fails changed runtime inputs without a version bump, reuses existing semantic artifacts, imports GHCR to ACR by digest, verifies GHCR/ACR version/latest parity, and deploys `ghcr.io/...@sha256:<digest>`. The source contract passes 17/17 | Registry investigation and mandatory security specialist / pipeline source audit | Tag parity is not provenance and a tag is never a deployment identity. Bind the selected digest to the exact runtime source SHA, copy by digest, and deploy by digest |
| RC-I32 | Cross-runtime harness / Medium | The first full local-node live run passed 1,684 assertions but nine Node child contracts failed with Fetch `bad port`; a partial adapter pass reduced this to four failures | Port 6000 is on the Fetch standard forbidden-port list. PowerShell requests to the established local form factor succeeded, while Node's built-in Fetch rejected the URL before opening a socket. The live suite mixed those two transports, and the first correction covered only five of nine wrappers | One shared `node:http`/`node:https` adapter now supplies the small Response contract used by every main live corpus wrapper and supports abort/timeouts without applying browser forbidden-port policy. Final local InMemory live evidence passes 1,700/1,700 with the new 9z-DO endpoint-name assertions and zero leaked endpoints | Full local-node live gate / could have been caught when the first Node corpus adopted Fetch on port 6000 | A deployment form factor is not valid unless every harness runtime can address it. Browser/Node Fetch forbidden-port policy differs from PowerShell and raw HTTP; centralize the transport instead of changing dozens of documented URLs |
| RC-I33 | Browser harness / Medium | A clean 253-test Playwright retry produced 128 failures and 1,941 Vite proxy errors over 48.8 minutes even though the API process was healthy on port 6000 | The manually restarted Vite process omitted `VITE_PROXY_TARGET`, so Vite used its port-3000 default. Playwright had no suite-level backend preflight and continued after every proxied SCIM request returned 502 | Direct and proxied health probes isolated the mismatch. Vite was restarted with `VITE_PROXY_TARGET=http://127.0.0.1:6000`; preflight proved both `/scim/health` and the lazy endpoint-detail module returned 200. The unchanged authoritative suite then passed 238 tests with 15 intentional skips and zero failures in 42.2 minutes. A Playwright global setup now probes proxied SCIM health before test 1 | Browser form-factor preflight / full-suite failure cascade | A browser runner must prove the exact proxied API path it will use, not only that the frontend and backend listen independently. An unavailable proxy is a prerequisite failure and must not consume a full suite |
| RC-I34 | Test isolation / Medium | The first Prisma matrix lane had four cross-suite inventory failures under parallel workers; after serializing the lane, exactly one endpoint-deletion test still returned 201 instead of its expected injected 500 | PostgreSQL suites shared one database and could not make whole-database inventory assertions concurrently. The remaining test spied on the root Prisma `scimResource.create`, but User creation calls a transaction-scoped delegate inside `withUniqueWrite`, so the injected failure never reached production code | A RED matrix captured both failure shapes. Prisma E2E now runs `--runInBand`, locked by the orchestrator contract. In ordinary databases the failure is injected at the repository interface the controller actually calls; explicitly guarded `PG_ANALYSIS_RUN` databases retain the real PostgreSQL trigger path. Focused deletion tests passed 22/22; final serial Prisma E2E passed 118 suites / 2,486 tests, retained in `test-results/e2e-2026-10-01_11-31-50-277Z-prisma-20888.json`. The other five unchanged green lanes were not repeated | Full Prisma matrix / should have been enforced by the matrix orchestrator and focused fault-injection test | Shared-database integration suites must run serially unless each worker owns a schema. A mock must intercept the actual abstraction boundary; spying on a root ORM delegate does not intercept transaction-scoped delegates |

**Release-candidate test/gate improvement: applied.** Content revisions now
have a runtime-cache negative control, malformed filters require diagnostic
values, fixture admission is verified before downstream behavior, and nested
live helpers must append requests to the root trace through an executable scope
boundary test.
Exact-tip security findings now require structural removal of tainted computed
writes/deletes, not only a runtime-safe sanitizer that CodeQL cannot infer, and
backend-matrix orchestration now fails before tests when PostgreSQL configuration
is absent unless the caller explicitly selects `-SkipPrisma`.
The deployment pipeline now creates a unique labeled PostgreSQL prerequisite
on a random loopback port with tmpfs data and exact-ID guarded cleanup; it
never treats a shared port or fixed name as ownership.
Registry shipping tags now come from one CI build and are verified by digest
across GHCR and ACR. Optional local builds use only `local-<sha>` tags, and
local no-cache validation also pulls the current base image.
Disposable database URLs are assembled from explicit test components rather
than embedded credential URI literals, preventing secret sanitization from
silently replacing the scheme.
Dev readiness now proves the exact intended revision is healthy and exclusively
serving traffic before minting live-test credentials; semantic version equality
alone is not sufficient.
Durable request logs now carry an endpoint-name snapshot so deletion does not
erase the human identity needed to interpret the audit trail.
Realtime browser streams now use Authorization headers through one shared Fetch
SSE adapter; tokens never enter stream URLs or request logs.
Existing semantic release tags are reused rather than rebuilt, and merged
runtime changes without a version bump block publication.
All Node live corpora use one raw HTTP adapter so the documented local port is
validated consistently across PowerShell and Node runtimes.
Playwright now proves the selected form factor's proxied SCIM health before
test 1, so a missing or incorrect Vite proxy target fails as a prerequisite
instead of producing a long cascade of unrelated UI failures.
Dev Playwright now retains item-level JSON results beside its human-readable
line output,  including every skip annotation.
the transitive dependency correction must pass public-registry lockfile
regeneration, quarantine, CodeQL, and Trivy before merge.
Post-deploy preset tests now compose `/Schemas` attributes with
`/ResourceTypes` extension bindings, and PowerShell verification wrappers
decode byte responses before JSON parsing.

**Design/architecture disposition: accepted.** Filtering the one known
runtime-only cache at the existing canonicalization boundary is cohesive and
does not justify a second profile representation or a generalized cache
registry. The query fix reuses the existing diagnostics envelope. The tracing
fix retains the existing wrapper and one mutable run-owned sink; extracting a
new module for one PowerShell scope boundary would add abstraction without a
second implementation. The CodeQL correction reuses the one canonical
property-key policy and immutable update helpers, with one explicit filtered
payload result consumed by all three resource services. A second sanitizer or
policy layer would create drift without another security model.
The preset correction reuses the existing discovery endpoints and SCIM helper;
introducing a second profile interpreter would be speculative. The dedicated
replication used the public admin and SCIM APIs and an ignored receipt rather
than adding another database mirroring path.

**Provenance / completeness:** the current environment does not expose
`VSCODE_TARGET_SESSION_LOG`, so a raw full-transcript scan was unavailable.
The final reconciliation used the available persisted compact session handoff,
the exact deployment report, PR/CI outcomes, the focused Playwright trace, and
the successful replication receipt. It checked failure signals and diagnosis
phrases for the release, CodeQL, dependency, deployment, browser and verifier
phases. The first no-test `--grep` invocation, intentional Playwright skips,
the deliberately over-strong empty-extension response assertion, and the
failed verifier version check were reviewed rather than misclassified as
product defects. RC-I01 through RC-I15 cover every confirmed issue available
in that persisted record; the missing raw transcript remains an explicit
evidence limitation, not an inferred all-history claim.

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
| C0-I42 | Source-contract conflict / High | Newly supplied4ba9373c claims numeric/MV top-level generic externalId support despite the authoritative all-core String contract | Its committed delta removes the generic common String restriction and adds invalid positive controls; the source commit predates the current authoritative checkpoint | HELD, not imported. Accepted chain stops704d701f; existing common-value negative controls, runtime and fingerprints unchanged. Parent reconciliation is required; no sibling pending diff or source edit | Committed-delta contract review / before cherry-pick | A passing source receipt proves its assertions, not approval of their policy. Resolve common semantics by binding and keep legitimate extension homonyms independent |
| C0-I43 | Corrective history / Medium | The held source later received corrective child2d2da4e1 | Retaining source provenance without qualification could still present the invalid fifth checkpoint as an independently accepted state | Inspect net delta from704d701f first; then preserve d93d1a0d/43b01c4e consecutively, label fifth superseded and test only corrected final code.176units/367IM/369PG HTTP and143live/backend pass; defaultnone unchanged, extension homonyms real, source receipts intact | Corrective-delta review and merged validation / same | C0-I42 is a historical hold now resolved only by the corrective pair. Never rewrite the bad receipt, accept its invalid positives, or revert the correction alone |
| C0-I44 | Binding-context query / High | An RFC core URI explicitly used as an extension filtered/sorted its externalId through the root common value | The read planner used boolean OR for role fallback in two places; explicit false was treated as missing and overwritten by a URI-pattern inference | Two unit and two HTTP REDs before the fix. Use nullish fallback for both schema walking and common qualified aliases; keep legacy inference only when role is absent. Unit/HTTP GREEN and six outcome-based live controls preserve the extension numeric/MV values and root common exact string | P6/P7 cross-package regression / explicit-false role consumer test | An explicit discriminator outranks inferred naming. Test real namespace matches/order, not only correct schema publication or successful writes; retain one planner and existing binding seams |
| C0-I45 | Cleanup failure path / Medium | If the new role-fixture deletion threw, the original query fixture cleanup was not attempted | Two cleanups shared one finally block with an early throw | A permanent unit executes the actual production finally body with injected role/main/both failures; it failed before nested finally was added. Six wiring/cleanup units and a focused52-outcome built-local rerun pass; no unchanged full HTTP/PG run repeated | Final cleanup review plus discriminating RED / adding the second owned fixture | Every owned cleanup must be attempted even when a sibling cleanup fails; verify call outcomes rather than the presence of a finally keyword |
| C0-I46 | Provenance transport / Low | Projecting the at-run source fingerprint initially mismatched despite only the declared cleanup/test delta | git show returned LF blob bytes while the at-run checked-out wiring test used CRLF | Verified newline counts, restored the original checkout representation and reproduced the exact63624d fingerprint. Final683897 fingerprint is separately recorded; no runtime code was changed to match a hash | Post-run byte projection / same | Hash the actual bytes used by a run; distinguish Git object representation from checked-out source before alleging or concealing code drift |
| C0-I47 | Test contract reconciliation / Medium | C0-I22's eight old expectations remained incompatible with accepted P7 contracts | The assertions treated canonical suggestions as a closed enum, silently accepted malformed extension containers and rejected ignored POST/PUT readOnly input | Parent source df3ca957 reproduced8failed/68passed, replaced only contradictory outcomes and added four opposing controls. Imported asbd82e681; all142 focused tests pass on the latest assembly, lint0errors2warnings. No production change or repeated DB run | Parent bounded RED/GREEN plus current integration rerun / exact contract review | C0-I22 is now closed, not suppressed. Preserve the baseline failure artifact, exact error/state assertions, immutable server data and untouched client fixture |
| C0-I48 | Residual correspondence / High | The old neutral matcher returned work/home for omitted-or-changed-type then explicit-work input, stealing the later exact match | Greedy occurrence fallback preceded global exact-type capacity reservation; source review also demonstrated restoration fixed-point and nested immutable gaps | Current-tree assertion RED before importing414e14e8. One canonical attribute-values implementation with compatibility exports, stable typed occurrence redistribution and recursive immutable traversal now passes491units/509IM/511PG HTTP and both live contracts | Committed residual-source comparison plus direct current-helper RED / expanded identity matrix | Preserve earlier bounded evidence but do not generalize it to every discriminator restoration; reserve capacity, consume once and test valid immutable/readOnly restoration without inventing identity |
| C0-I49 | Harness/merge fidelity / Medium | Parallel source introduced another neutral path and older source-selector/bootstrap expectations; its live helper was unreachable from the main entry | Independent branches used different module names and standalone guarded entry points | Keep one implementation, readonly-compatible signature and both compatibility exports; preserve common/public interfaces and all old branch selectors/minimums. Pin PUT/P9 bootstrap, retain unconditional inherited-URL clearing, and add9z-DD after wiring RED. Ten configuration probes and actual backend/live proof pass | Merge review and wiring RED / same | Never merge a parallel baseline wholesale. Namespace branch/fixture guards explicitly; configuration-only stubs are not database-safety evidence, and new live routes must preserve existing cleanup/section identities |
| C0-I50 | Documentation coupling / Low | F4 rejected the retention increment because the existing PATCH guide was unchanged | The source package documented itself and schema customization, but the shared PATCH preservation imports also changed | Update the bound PATCH guide with reserved type capacity, restoration stability, distinct value identities and PATCH-only append intent. The existing source-coupling gate identified the exact files; no gate weakening or version-only workaround | Documentation coupling / same | Shared behavior changes require the existing consumer guide as well as a new feature doc; retain the working F4 binding |
| C0-I51 | Canonical ownership/path reconciliation / Medium | Parent89810f0c targeted the original retained-entries file while an earlier committed parallel-source integration used attribute-values | Delivery/ownership notes arrived after that integration; blind application would create two implementations or drop later work | Preserve parent matcher unchanged in retained-entries, restore original consumers and make attribute-values forwarding-only. Parent84/1764 live expansion passes alongside prior contracts:428units/305IM/306PG HTTP/164main live checks per backend. No repeated414 cherry-pick or history rewrite | Parent handoff/net-delta review / before merge | Keep one implementation and truthful chronology. C0-I48's original defect is greedy stealing; reservation stability/null guards are hazards addressed by that new design, not two extra original b21 defects |

### Binding-qualified uniqueness bridge, 2026-09-29

- **C0-I52 - integration / High.** P7 accepted a schema shared as core and
  extension, while P3b compiled its raw numeric/MV common declarations on core
  writes and returned 400. Applying the common view alone still retained raw
  scalar `meta.uniqueness:server` on the effective complex metadata object.
  A discriminating compiler test and both strict-mode HTTP writes reproduced
  the problem before production edits. Runtime binding normalization now
  delegates to the existing common helper before the sole storage compiler;
  common metadata explicitly has `uniqueness:none`. The extension retains its
  original typed policy. Focused compiler and core/extension HTTP controls
  confirm the correction, including exact-case common values and independent
  extension collisions. Earliest possible detection: combined-schema unit;
  actual detection: the same integration RED. Prevention: shared-URN tests
  must carry explicit promises, not only default-none attributes.
- **C0-I53 - admission / High.** Unsupported Boolean/dateTime/binary/complex
  server promises were accepted at profile creation, then rejected on writes.
  Five admission unit REDs and four HTTP 201-instead-of-400 REDs exposed the
  missing consumer. Admission now compiles each resource type's core and
  extension binding through the same storage capability table before
  publication. Core-only raw computed promises remain rejected; a shared
  declaration is not globally rewritten. Earliest/actual detection: profile
  admission unit. Prevention: compile-capability positive and negative
  controls accompany profile publication and update tests.
- **C0-I54 - input boundary / Medium.** Omitting optional `schemaExtensions`
  passed declaration checks, then threw from tighten-only iteration. The
  omission unit reproduced that TypeError. Expansion now assigns an empty
  array on its copied resource type, while null/object/string remain exact
  declaration failures. Earliest/actual detection: admission unit.
- **C0-I55 - test/tooling friction / Low.** New typed fixtures initially
  omitted the internal required resource-type description and inferred a
  union too narrow for an optional uniqueness field. Explicit fixture types
  corrected compilation without casts masking invalid data. An admission
  test also assumed `scimType:invalidValue`, then assumed a native Nest
  envelope; the observed existing admin mapper emits SCIM status/detail and
  diagnostics without scimType for generic BadRequest. The test now asserts
  that exact existing boundary instead of changing production error policy.
  These were harness failures, not behavior REDs. Missing owned Jest tooling
  used the permitted read-only junction only after MODULE_NOT_FOUND; editor
  adapters remained unavailable. Earliest/actual detection: compiler/HTTP.

- **C0-I56 - harness aggregation / Low.** The copied PostgreSQL wrapper
  expected164 main checks after the new live section increased the actual
  total to165. All320 HTTP and165 live checks passed, but the wrapper failed
  before its final endpoint-inventory comparison. The failed original
  receipt is preserved. After correcting the expected count, only the new126
  live assertions and inventory comparison were replayed on a fresh guarded
  PostgreSQL17.8 instance with22 migrations; both passed. No repeated320-test
  run was needed. Both exact containers and API processes were removed.
  Earliest detection: wrapper configuration review; actual detection:
  post-live aggregation. Prevention: the checked-in live wiring test locks
  both modes and the measured126 assertion count, and receipts distinguish
  check-level success from wrapper completion.
- **C0-I57 - write coordination / High.** A User, Group or custom write could
  validate against profile P1, pause, then commit successfully after endpoint
  profile P2 was published. The request context carried the profile but no
  commit-time revision, and repository transactions coordinated resource
  versions/uniqueness without coordinating endpoint profile state. Three
  controlled create races returned 201 before the fix. A canonical profile
  revision now crosses the existing repository ports. PostgreSQL resource
  transactions and profile updates share one endpoint advisory lock;
  InMemory checks the revision in its synchronous endpoint write guard.
  Expanded create/replace/delete proof is9/9 per backend and verifies exact
  non-mutation. Earliest/actual detection: controlled repository barrier.
  Prevention: every schema-validated write path carries the profile revision
  and the race suite covers every resource adapter and write operation.
- **C0-I58 - race harness / Low.** The first new HTTP spec had three setup
  defects before behavioral RED: a malformed embedded authorization fixture,
  a union-method spy signature that did not compile, and a lazy Supertest
  request that never reached the paused repository. Reuse the test token
  helper, spy through an explicit unknown-argument boundary, and attach a
  promise continuation before awaiting the barrier. The corrected RED was
  three 201 responses instead of expected409. Earliest/actual detection:
  focused TypeScript/Jest run. Prevention: setup failures are not behavior
  RED; prove the barrier was reached before classifying a concurrency result.
- **C0-I59 - unit harness compatibility / Medium.** The first affected-unit
  run failed194 tests because lightweight service-context mocks did not expose
  the new revision getter. After that correction,53 tests still failed because
  exact repository-call assertions observed an extra undefined argument and
  the endpoint Prisma mock lacked the new transaction seam. Optional tuple
  forwarding preserves direct-test call shapes when no request revision
  exists, while the endpoint fixture now executes transactions against its
  existing shared mock client. All611 affected tests pass. Earliest/actual
  detection: affected-unit gate. Prevention: a new commit-boundary dependency
  must be represented in both request-context and persistence test doubles;
  do not weaken exact argument assertions globally.
- **C0-I60 - current-source harness isolation / Low.** The first 82-case
  calibration replayed all22 migrations but every case stopped in setup
  because Jest reloaded the historical `safety.cjs` inside its own module
  registry. Pre-populating Node's `require.cache` reached the runner/config
  process but not transformed test modules. A task-owned Jest config now maps
  only the corpus's relative safety import to the current guard; the historical
  source and guard remain byte-normalized/hash-verified. The failed container
  was exact-ID removed. Earliest detection: a one-case Jest discovery/smoke;
  actual detection: first full calibration. Prevention: the safety check now
  verifies both the Node preload and Jest module mapper before database work.
- **C0-I61 - historical assertion seam drift / Medium.** The first exercised
  current-source corpus produced three InMemory and one PostgreSQL behavior
  failures from two non-product causes. `INC-STRICT` correctly returned200 and
  persisted all four values, while the historical branch still asserted the
  preservation state of its old rejection. Two InMemory Group fault cases
  replaced `addMembers`, a seam no longer called after aggregate
  create/update was introduced. The current adapter chooses success readback
  only when the incident response is200 and moves fault injection to
  `create`/`updateGroupWithMembers`; permanent typed PATCH and late-stage
  aggregate tests independently lock the behavior. Focused3/3 per backend and
  full164 dispositions/769 assertions then passed. Earliest/actual detection:
  current-source case calibration. Prevention: preserve the immutable corpus,
  name every adapter, and fail transformation if an expected seam changes.
- **C0-I62 - benchmark fixture arithmetic / Low.** The first 50,000-row
  performance run measured both paths but failed its final count assertion:
  values0 through49,999 with `cost gt 49,990` yield9 matches, not the declared
  10. The fixture now uses `ge 49,990`, preserving the intended10-row,
  0.02%-selective boundary. The failed receipt is retained locally; the clean
  rerun replayed22 migrations, completed all samples, and exact-ID removed its
  container. Earliest/actual detection: benchmark outcome assertion.
  Prevention: benchmark fixtures assert seed size, transferred rows, candidate
  callbacks, total matches and returned page before publishing measurements.
- **C0-I63 - exact-tip output rewrite / Low.** The first final exact-tip
  invocation failed before starting Jest or Docker because the newly added
  current-source output-path rewrite assumed LF line endings while the
  immutable historical runner was checked out with CRLF. The source guard
  already normalized line endings for hashes, but the separate exact-text
  rewrite did not. The transformer now detects the historical source line
  ending, constructs the guarded two-line seam with that ending, and exposes
  a side-effect-free builder. The safety self-test proves the current output
  path is present and the historical path absent before any runtime starts.
  Earliest/actual detection: final exact-tip wrapper invocation. Prevention:
  every guarded runner rewrite must be exercised by the preflight safety test,
  including checkout line-ending variance.
- **C0-I64 - Windows npm wrapper launch / Low.** The first exact-artifact
  invocation failed before the build or Docker because Node24 on Windows
  returned `EINVAL` for direct `spawnSync npm.cmd`. The runner now resolves
  the installed `npm-cli.js` and invokes it through the current Node
  executable. A preflight contract locks the executable and argument shape.
  Earliest/actual detection: first exact-artifact build invocation.
  Prevention: task-owned Node orchestrators invoke JavaScript CLIs through
  Node rather than relying on Windows command wrappers.
- **C0-I65 - endpoint inventory envelope / Low.** The next invocation built
  successfully, started the owned InMemory artifact and then stopped before
  live contracts because the harness expected a bare empty array. The actual
  canonical admin response is `{ endpoints: [], totalResults: 0 }`. A
  dedicated assertion now requires that envelope before execution and compares
  the complete envelope after cleanup. Positive and nonempty/wrong-shape
  negative controls pass. Earliest/actual detection: built-artifact readiness
  check. Prevention: harness assertions reuse the public wire contract rather
  than an internal collection shape.

**Test/gate improvement: applied.** Per-binding promise tests and admission
publication checks close the original blind spots. **Design/architecture
disposition: accepted.** A thin effective-view adapter and a small admission
consumer reuse one capability compiler; no second type/represented-path table,
new persistence abstraction, or competing PATCH implementation was introduced.
This entry records confirmed fixes immediately; full-session transcript
reconciliation and final C0 acceptance remain separate.

For C0-I50, an explicit BaseRef compares committed `BaseRef...HEAD`, not
unstaged edits. The second pre-commit check therefore correctly still saw
the old committed range. Working-tree freshness passed after the prose fix;
the authoritative committed-range F4 check runs after the final doc commit.
No failed committed-range result is relabeled as a pre-commit PASS.
The later parent canonical-path reconciliation likewise required review of
the bound Custom Extensions guide when schema-validator's matcher import
changed. That committed-range check failed, the existing guide was updated
with the authoritative helper/fixture contract, and the range was rechecked
without changing the F4 binding.

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
| P6b-I14 | Cross-package query correctness / High | Custom numeric/multi-valued displayName and externalId returned zero matches through unqualified equality/presence queries, while their payload values existed | Candidate push-down used a fixed string column selected by attribute name; P6b supplied caseExact but not the resolved type/cardinality. Null promoted columns discarded payload-backed candidates before the correct evaluator ran | The read plan now passes explicit schema shapes to the existing builders, which reject incompatible column push-down for the whole expression. RED was two unit cases and four HTTP cases; GREEN focused InMemory is 100 unit, 92 HTTP, 40 live checks | Cross-package representation review / sibling P3 coordination after initial P6b validation | Test common promoted names with custom numeric and multi-valued schemas, plus compatible scalar controls. Persistence reconstruction remains P3-owned; this follow-up changes no writes |
| P6b-I15 | Standards/test correctness / High | P6c wrongly treated common top-level externalId as customizable numeric/MV; generic string externalId queries also matched the wrong case when explicitly declared without caseExact | Query design generalized custom core attributes without first applying RFC 7643 section 3.1's fixed common-attribute contract. A schema declaration overrode the helper's fallback-only caseExact default | P6d fixes common externalId to string/SV/caseExact in the read plan, retaining writeOnly denial and independent extension semantics. Replace invalid top-level numeric/MV acceptance fixtures with extension homonyms and custom displayName/active controls. Confirmed RED: 3 unit and 1 HTTP wrong-case result; GREEN: 106 unit, 97 InMemory HTTP, 46 owned local live checks | Standards contract before fixture design / parent RFC correction after P6c commit | Common RFC attributes are checked before schema-driven generalization; use namespaced homonyms for custom type/cardinality tests. P3 owns write policy and P7 owns admission; historical P6c commit/receipts remain, but their invalid acceptance claims are superseded |

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

**P6c/P6b-I14 follow-up confirmation:** the same 92 HTTP tests and 40 live
checks passed on task-owned PostgreSQL 17.8 after 22 migrations. Container
`f228d341701a0c9dc0893c0ca18495969f63014ead0e121f05f04b1a87748dea`
was removed by exact identity and both APIs stopped. The retained
`test-results/p6c/` RED/GREEN logs contain no fixture failures; 100 focused
unit tests, API build and the unchanged two-warning lint baseline passed.
No persistence changes were imported from P3. This is focused follow-up
evidence, not full cross-package consolidation or full-transcript proof.

**P6d/P6b-I15 correction confirmation:** historical P6c acceptance evidence
for numeric/MV common externalId is superseded by the fixed RFC contract.
The corrected fixtures, read normalization and extension controls passed
106 unit tests, 97 HTTP tests per backend and 46 live checks per backend.
Owned PostgreSQL 17.8 replayed 22 migrations and exact container
`97473ee0d9e51f4c1a323633f54f62ca1e10ae916e6a843a3c6d96bb17f5fd54`
was removed. Retained `test-results/p6d/` logs show only the intentional
three unit and one HTTP wrong-case RED assertions, not setup failures.
API build, zero-finding changed-file lint and documentation gates passed.

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
