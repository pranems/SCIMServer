# Custom Resource Observability Execution Issues and RCA

> **Status:** Consolidated locally - **Last verified:** 2026-09-24 - **Product version:** `0.55.29`

## Dashboard

| ID | Type | Severity | Symptom | Root cause | Prevention |
|---|---|---:|---|---|---|
| CRO-1 | API correctness | High | Devices never appeared in Prisma Activity. | SQL admitted only URLs containing `/Users` or `/Groups`. | Controller test requires endpoint-scoped custom paths before pagination; E2E/live exercise Device. |
| CRO-2 | Domain model | High | Custom requests became generic system messages. | Activity type and parser were closed over User/Group/system. | Parser tests cover custom POST/PATCH/DELETE and discovery negative control. |
| CRO-3 | Event parity | High | Generic PUT/PATCH did not refresh custom lists or observability surfaces. | Only create/delete events existed. | Service and SSE bridge tests require `scim.resource.updated`. |
| CRO-4 | UX drift | Medium | Endpoint Logs exposed only URL search while global Logs had richer filters. | Two pages owned separate filter markup and query contracts. | One shared toolbar/query model is rendered by both surfaces. |
| CRO-5 | Test harness | Medium | First browser run hit an older API despite an exact branch frontend. | Vite's `/scim` proxy was hardcoded to port 3000. | `VITE_PROXY_TARGET` selects the exact worktree API; browser proof rerun against 6101. |
| CRO-6 | Test correctness | Low | Existing row status text assertions became ambiguous after filter chips added the same status. | Assertions searched the whole page instead of the data row. | Scope status assertions to stable row test IDs. |
| CRO-7 | API correctness | High | A non-error severity filter could return an empty page and an unfiltered total even when later matching activities existed. | Prisma and InMemory paginated request logs before parsing the derived activity severity. | Backend-parity tests require parse/filter before pagination for derived filters. |
| CRO-8 | Process/Git | High | The shared toolbar compiled and tested locally but was absent from `git status`. | The broad `logs/` artifact rule also ignored `web/src/components/logs/`. | `.gitignore` explicitly re-includes that source directory; final review checks new source tracking. |
| CRO-9 | Domain model | High | A profile declaring `AIAgent` at `/News` appeared in Activity as `New`. | The parser guessed a singular type name from the URL segment instead of reading the profile. | Parser test uses a deliberately non-inferrable name and requires exact profile metadata. |
| CRO-10 | UI correctness | Medium | Relative-time query keys changed on unrelated renders, endpoint filters disappeared on empty results, and pagination metadata caused a false Reset state. | Time bounds were recomputed during render, empty states returned before the toolbar, and active-filter detection scanned every object value. | Focused UI tests lock stable time bounds, empty-state recovery, and declared-filter-only detection. |
| CRO-11 | Test harness | Medium | Parallel full API E2E, web coverage, and docs runs were interrupted and produced unusable evidence. | Multiple long Node test processes contended in one constrained workstation session. | Consolidation gates run sequentially and only completed artifacts count as evidence. |
| CRO-12 | Test correctness | Medium | Web typecheck failed after `resource` joined the Activity type enum. | `ActivityTab.test.tsx` duplicated the older production search union. | The test now imports `ActivitySearch`; future enum changes compile through one source of truth. |
| CRO-13 | Environment drift | Low | The exact local API reported v0.55.29 while the browser header showed v0.55.28. | Vite started before the package-version edit and does not hot-reload compile-time `define` values. | Restart Vite after version metadata changes; visual review verifies UI/API version agreement. |
| CRO-14 | UI layout | Medium | Global Logs showed two Reset commands and its narrow Auth chip wrapped to 42 px inside a 20 px box, clipping the label. | The old header command remained after toolbar extraction; the shared chip lacked its own no-wrap/ellipsis context. | Playwright asserts one Reset command and measures real chip bounds; the primitive owns left-aligned ellipsis. |
| CRO-15 | Environment drift | Low | Mermaid commands failed in the fresh worktree before parsing any diagram. | Ignored root `node_modules` was absent even though API/web dependencies were linked. | Reuse the existing ignored root dependency junction, then rerun parse and browser render sequentially. |
| CRO-16 | Test design | Low | The first live-test draft tried to create a second custom-resource fixture section. | The nearby existing `9z-CN` Device lifecycle was not identified before the initial patch anchor. | Extend `9z-CN` with T7-T13 so one fixture owns CRUD, Logs, Activity, and cleanup. |
| CRO-17 | Tooling friction | Low | The read-only review agent could not see the sibling worktree; `rg` was unavailable; several broad patch/read guesses missed local paths; generated Prisma signatures rejected simple Promise mocks. | Workspace indexing, shell tooling, patch breadth, path assumptions, and generated mock types differed from the local target. | Use absolute target reads, PowerShell `Select-String`, smaller anchored patches, symbol search, and narrow test-double casts. |
| CRO-18 | Performance | Medium | Correct derived Activity totals required reading every candidate log in one unbounded Prisma query. | Parse-derived severity/system semantics cannot be expressed entirely in the current request-log columns. | Read ordered candidates in 200-row Prisma batches, then parse/filter/page; direct predicates retain SQL pagination. |
| CRO-19 | Test harness | Medium | Three green full-unit Jest processes remained alive and held their shells open after summaries were written. | Existing asynchronous handles prevent Jest from exiting naturally in this repository. | Trust only completed summary artifacts, terminate verified orphan Jest PIDs, and use `--forceExit` for final long-suite consolidation. |
| CRO-20 | CI/Docker context | High | Local and pre-push web builds passed, but both GitHub image builds failed to resolve the new shared toolbar. | `.dockerignore` excluded every `**/logs` directory, including the intentional production source directory. | Re-include the source path and run a generalized Docker source-shadow audit in Fast pre-push. |
| CRO-21 | Test correctness | High | The full Prisma E2E suite returned zero custom lifecycle Logs while InMemory and all focused local checks passed. | The new E2E queried buffered RequestLog rows immediately after DELETE instead of using the repository's durable-log helper. | Use `waitForLogRow()` for POST/PATCH/DELETE; it force-flushes and polls to a deadline. |
| CRO-22 | Deployment tooling | High | The GHCR workflow succeeded, but Stage 4.3 reported JSON conversion failure and immediately cascaded into pull/import/deploy failures. | `gh run list --json` emitted ANSI cursor-control bytes before JSON in this console. | Normalize ANSI/BOM in `ConvertFrom-GithubCliJson()` before exact-SHA run selection; contract test uses real control bytes. |

## Detailed Findings

### CRO-7 - Derived filters ran after pagination

- **Detection:** Final review, after focused and full suites were green.
- **Earliest capable gate:** Activity controller unit tests.
- **Escape delta:** One consolidation stage; existing tests covered only SQL-pushed `resource + error` filters.
- **Fix:** SQL-push exact raw-log predicates where possible, then parse/filter derived type or severity candidates before calculating totals and slicing the requested page. InMemory reads bounded 200-row log pages before applying the same parser contract.
- **Why it works:** Pagination now operates on the same activity set represented by `pagination.total` and returned rows.
- **Prevention:** Prisma and InMemory page-2 regressions use interleaved success/info records and fail under page-first filtering.

### CRO-8 - Source directory hidden by artifact ignore rule

- **Detection:** Final `git status` and `git check-ignore -v` review.
- **Earliest capable gate:** First source-file creation or pre-commit changed-file inventory.
- **Escape delta:** The file passed local build and tests but would have been omitted from the commit.
- **Fix:** Re-include `web/src/components/logs/` and its descendants immediately after the repository-wide `logs/` rule.
- **Why it works:** Git still ignores runtime `logs/` directories while tracking the intentional source directory.
- **Prevention:** Every new source file must appear in `git status --untracked-files=all` before consolidation.

### CRO-9 - URL grammar replaced profile metadata

- **Detection:** Final profile-fidelity review.
- **Earliest capable gate:** Parser unit test with a non-inferrable name.
- **Escape delta:** Device-only tests passed because `/Devices` happens to singularize to `Device`.
- **Fix:** Resolve endpoint-scoped custom paths through the cache-first `EndpointService` profile and return the declared `name` and `endpoint`. Deleted-endpoint history falls back to the raw path segment without grammatical guessing.
- **Why it works:** Activity now consumes the same authoritative ResourceType definition as routing and discovery.
- **Prevention:** `/News` declared as `AIAgent` is the negative control.

### CRO-10 - Shared filter state was not stable in every render state

- **Detection:** Final shared-component review.
- **Earliest capable gate:** Component tests for rerender, empty results, and default pagination state.
- **Escape delta:** Happy-path browser coverage had populated rows and did not advance time between unrelated filter changes.
- **Fix:** Memoize relative `since` values by URL `timeRange`, render endpoint filters before empty/table branching, and inspect only declared log filter fields for Reset visibility.
- **Why it works:** Query keys stay stable for a selected range, every result state remains recoverable, and route metadata cannot masquerade as a filter.
- **Prevention:** Three focused regression assertions cover those state transitions.

### CRO-11 - Parallel consolidation evidence was invalid

- **Detection:** Interrupted terminal output during the first full-gate fan-out.
- **Earliest capable gate:** Consolidation scheduling.
- **Escape delta:** None shipped; invalid artifacts were discarded immediately.
- **Fix:** Rerun long test and docs gates sequentially.
- **Why it works:** Each process receives predictable memory and terminal ownership, and each result has an unambiguous exit state.
- **Prevention:** Do not parallelize full API E2E, web coverage, or browser-backed docs rendering on this workstation.

### CRO-12 - Test-only Activity enum drift

- **Detection:** Full web TypeScript check.
- **Earliest capable gate:** The same typecheck.
- **Escape delta:** None; runtime tests transpiled while the explicit typecheck caught the duplicate union.
- **Fix:** Import `ActivitySearch` into the test instead of restating its shape.
- **Why it works:** Production and test code now compile against the same `resource`-inclusive enum.
- **Prevention:** Unit-2 touched files must contribute zero diagnostics even while the repository retains a known unrelated baseline.

### CRO-13 - Vite retained stale compile-time version metadata

- **Detection:** Populated local visual review.
- **Earliest capable gate:** Browser version check after restarting the dev server.
- **Escape delta:** None; API and package metadata were correct, but the old long-running Vite process rendered stale compile-time state.
- **Fix:** Restart the exact-worktree Vite process after the version edit.
- **Why it works:** `__APP_VERSION__` is read from `web/package.json` only when Vite evaluates its config.
- **Prevention:** Visual verification must compare the header version with `/scim/admin/version` on the same origin.

### CRO-14 - Shared Logs controls and Auth chip failed narrow visual review

- **Detection:** Populated 1002 px browser screenshot plus measured DOM bounds.
- **Earliest capable gate:** Playwright outcome/layout assertion.
- **Escape delta:** Component tests proved controls existed but did not measure duplication or rendered content height.
- **Fix:** Remove the superseded global header Reset command. Make `AuthMethodChip` own a bounded single-line badge with a left-aligned ellipsis span and retain the full label in `title`.
- **Why it works:** Both Logs surfaces now share one command source, while `scrollHeight === clientHeight` prevents vertical clipping regardless of table-cell width.
- **Prevention:** The custom-resource browser journey requires exactly one Reset command and measures chip height and right-edge containment.

### CRO-15 - Fresh worktree omitted root docs dependencies

- **Detection:** Documentation consolidation gate.
- **Earliest capable gate:** First root docs command in the worktree.
- **Escape delta:** None; no diagram was evaluated until dependencies were available.
- **Fix:** Link the existing ignored root `node_modules` from the validated master worktree and rerun content, freshness, grammar, and Chromium rendering sequentially.
- **Why it works:** Root scripts resolve the same pinned Mermaid and browser packages without modifying package metadata or the lockfile.
- **Prevention:** Fresh worktree bootstrap must check root, API, and web generated/dependency artifacts before test fan-out.

### CRO-16 - A second live fixture almost duplicated existing coverage

- **Detection:** Nearby read after the first broad patch anchor failed.
- **Earliest capable gate:** Live-test ownership inventory before editing.
- **Escape delta:** None; the duplicate section never landed.
- **Fix:** Extend the existing `9z-CN` Device lifecycle with delete, persisted Logs, structured Activity, filter, total, and cleanup assertions.
- **Why it works:** One disposable endpoint now proves the complete lifecycle without doubling setup time or orphan risk.
- **Prevention:** Search for the domain fixture and current section owner before adding a live-test section.

### CRO-17 - Sibling-worktree and local-tool boundaries complicated review

- **Detection:** Review-agent report, shell errors, failed exploratory reads, and RED-test compile output.
- **Earliest capable gate:** Tool capability check at the first sibling-worktree operation.
- **Escape delta:** None; all failures occurred before conclusions or commits.
- **Fix:** Review the target through absolute file reads and terminal Git diff, replace unavailable `rg` with `Select-String`, narrow multi-file patches after local reads, locate moved types/modules by symbol search, and cast only the test-double boundary for Prisma-generated signatures.
- **Why it works:** Every conclusion and edit is grounded in the actual target worktree while production types remain strict.
- **Additional tooling incident:** A reversible `.dockerignore` negative control and its restoration check were mistakenly launched in parallel against the same file. The check raced the restore and left a BOM/line-ending-only worktree delta. The committed blob was never changed; the file was restored to a matching normalized Git blob before proceeding.
- **Prevention:** Do not parallelize any tool calls that read and mutate the same path. Do not use PowerShell object-pipeline output to restore a Git blob; use `apply_patch` and verify with `git hash-object --path`.

### CRO-18 - Correct derived totals introduced an unbounded query

- **Detection:** Final design/performance self-audit.
- **Earliest capable gate:** Activity controller unit test with more than one candidate batch.
- **Escape delta:** One review stage; correctness tests used three rows and could not discriminate bounded from unbounded reads.
- **Fix:** Fetch ordered Prisma candidates in pages of 200 whenever type/severity depends on parsed Activity semantics. Parse/filter the accumulated set, compute the filtered total, then slice the requested Activity page.
- **Why it works:** No individual database query is unbounded, while totals remain exact. User, Group, resource, and error predicates still use direct SQL count/skip/take.
- **Prevention:** The page-2 severity regression contains 201 interleaved candidates and requires two `take: 200` calls.

### CRO-19 - Green Jest suites retained live processes

- **Detection:** Process inventory after the full-unit artifact reported 174 suites and 5,150 tests passed.
- **Earliest capable gate:** Post-suite process cleanup.
- **Escape delta:** None; the result artifact was complete, but the parent shell could not return normally.
- **Fix:** Verify each process command line belongs to this worktree and completed `jest --runInBand`, then terminate only those exact PIDs. Final E2E and pre-push test invocations use their existing force-exit path.
- **Why it works:** Completed test evidence remains intact while stale handles no longer contend with subsequent gates.
- **Prevention:** A long-suite result is complete only when its summary artifact is present and matching Jest processes have exited or been explicitly classified and cleaned up.

### CRO-20 - Docker artifact ignore rule removed production source

- **Detection:** PR #167 and push Build Test Image workflows.
- **Earliest capable gate:** Fast pre-push Docker source-context audit.
- **Escape delta:** CI image build; local Vite and TypeScript read the filesystem directly, so neither exercised `.dockerignore`.
- **Fix:** Add `!web/src/components/logs` and `!web/src/components/logs/**` after `**/logs`. Add `audit-docker-source-context.ps1` and invoke it from Fast pre-push.
- **Why it works:** Docker includes the directory and descendants while runtime `logs` artifacts remain excluded. The audit discovers populated directories under `api/src` and `web/src` whose names match broad `**/<name>` rules and requires both exceptions.
- **Prevention:** The audit failed RED on both missing exceptions, passed GREEN after the fix, and a registry-free `FROM scratch` build copied the exact toolbar from the real Docker context.

### CRO-21 - Prisma log readback raced the buffered writer

- **Detection:** Full dev pipeline Stage 2.2 against Prisma.
- **Earliest capable gate:** Focused E2E against Prisma when the test was authored.
- **Escape delta:** Consolidation passed against InMemory; the first direct Prisma read returned `items: []` before the asynchronous buffer enqueue/flush completed.
- **Fix:** Replace the immediate list assertion with the existing `waitForLogRow()` helper for each expected method.
- **Why it works:** The helper repeatedly force-flushes, queries, and checks the structural row predicate until the row is durable or the bounded deadline expires.
- **Prevention:** Any E2E assertion over a just-produced RequestLog row must use the shared durable-log helper, never a fixed sleep or immediate list request.

### CRO-22 - ANSI control bytes broke machine-readable GitHub CLI output

- **Detection:** Full dev pipeline Stage 4.3; GitHub later showed the dispatched `publish-ghcr.yml` run succeeded for exact merged-master SHA `59278a59`.
- **Earliest capable gate:** Workflow-run selector contract with ANSI-prefixed JSON.
- **Escape delta:** Publish-run selection failed locally after successful dispatch; anonymous pull/import ran too early and deployment was correctly blocked.
- **Fix:** Add `ConvertFrom-GithubCliJson()` in the workflow-run helper, strip ANSI CSI sequences and a leading BOM, then parse. Route Stage 4.3 through that adapter.
- **Why it works:** The selector receives pure JSON while retaining exact SHA and dispatch-time discrimination.
- **Prevention:** The workflow selector contract includes real cursor-hide/show bytes and passes 10/10.

## Self-Improvement Dispositions

- **Test/gate:** Applied. Unit, API E2E, browser, and live tests all prove custom lifecycle observability.
- **Design/architecture:** Applied. One activity parser contract and one shared Logs toolbar remove closed User/Group assumptions and duplicated filters.
- **Security:** Accepted. The change exposes existing request metadata only through existing admin-gated APIs; no headers, bodies, or secrets are added to Activity.
- **Performance:** Applied. Exact raw predicates remain SQL-pushed; derived filters use bounded 200-row candidate reads in both backends and correct parse-before-page semantics. Shared query keys include every filter dimension and stable relative-time bounds.

## Provenance

Issues were recorded when RED checks or browser runs exposed them. Before PR, this ledger was reconciled against the full transcript from line 22,424, where the unit-2 worktree was created, through final consolidation. The reconciliation used two passes: error/signal patterns (`error TS`, failed gates, missing modules, terminal interruption, proxy, ignore, pagination, layout) and diagnosis phrases (`root cause`, `stale`, `silently`, `regressed`, `false positive`). Tool-request/search echoes were discarded, and all seven failed tool executions were classified as missing exploratory paths or local patch-context misses already represented by CRO-16/CRO-17.

Verified and dismissed non-issues:

- Mermaid renderer discovery reports built-in version `0.0.0`, but all 711 diagrams parsed and rendered in Chromium under both themes.
- Repeated browser `401` console entries came from unrelated background health/auth polling; authenticated fixture/admin requests and the observed Activity/Logs surfaces returned successfully.
- API lint retained 521 legacy warnings with zero errors; touched modules retain existing `no-explicit-any` and `prefer-const` findings, and this change adds no lint error.
- Web TypeScript retained 69 unrelated baseline diagnostics; unit-2 Activity/Logs/query/schema files contributed zero.
- TanStack Router Devtools emitted its existing package-move warning; it does not affect production behavior.