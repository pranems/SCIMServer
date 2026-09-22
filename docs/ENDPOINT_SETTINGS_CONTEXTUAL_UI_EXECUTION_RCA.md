# Contextual Endpoint Settings UI - Execution Issues and RCA

> **Status:** Complete through the v0.55.24 dev deployment review - **Last verified:** 2026-09-21
>
> **Scope:** Extraction of the shared endpoint-settings registry, the reusable related-settings panel, contextual placement across Users, Groups, Schemas, Resource types, Logs, and Connect, preservation of Settings as the complete 38-control inventory, authoritative auth-state hardening, and the endpoint-profile/discovery/authentication design reconciliation.
>
> **Companion references:** [PORTABLE_ENDPOINT_PROFILE_AUTHENTICATION_AND_DISCOVERY_DESIGN.md](PORTABLE_ENDPOINT_PROFILE_AUTHENTICATION_AND_DISCOVERY_DESIGN.md), [ENDPOINT_SETTINGS_OPERATOR_GUIDE.md](ENDPOINT_SETTINGS_OPERATOR_GUIDE.md), [UI_GUIDE.md](UI_GUIDE.md), and [CHANGELOG.md](../CHANGELOG.md).
>
> **Provenance / completeness:** Reconciled against the full feature transcript window beginning at transcript line 65775, where the contextual-settings work started, through the final local audit. The reconciliation used an error/signal pass (`error TS`, `FAIL`, `RED`, `timeout`, `missing module`, `stale`, `duplicate`, `baseline`, `diff --check`, `trailing whitespace`, `npx`, `U-T7`) and a diagnosis-language pass (`root cause`, `turned out`, `silently`, `mismatch`, `complete inventory`). Later audit queries that merely repeated earlier findings were discarded. Verified non-issues are listed in Section 6.

---

## 1. Summary

The original contextual-settings slice completed with seventeen execution issues: eleven medium-severity correctness/process findings and six low-severity tooling or hygiene findings. The v0.55.24 UX and architecture follow-up added twenty-two issues, including five High security/contract or authority defects. The runtime defects were closed before merge with unit, E2E, live, and browser coverage; the documentation defects were closed with one canonical authority, historical banners, source-comment corrections, and executable doc gates.

```mermaid
pie showData
    title Contextual settings issues by severity
    "Medium" : 11
    "Low" : 6
```

```mermaid
pie showData
    title Contextual settings issues by type
    "Architecture" : 1
    "Test correctness" : 6
    "Tooling" : 5
    "Process and docs" : 5
```

## 2. Issue Dashboard

| ID | Type | Severity | Symptom | Detected | Earliest possible |
|---|---|---|---|---|---|
| CS-1 | Architecture | Medium | The new shared definitions initially coexisted with the old inline Settings catalogs | Stage 1 TypeScript check | Authoring diff review |
| CS-2 | Test correctness | Medium | User and Group drawer resources remained typed as possibly undefined | Stage 1 TypeScript check | Stage 1 TypeScript check |
| CS-3 | Process and docs | Medium | The operator guide still claimed 27 controls and four numeric settings | Documentation review | Source-to-doc content audit |
| CS-4 | Test correctness | Medium | Browser RED was captured after production implementation rather than before it | Final transcript audit | Test planning |
| CS-5 | Tooling | Low | `npx` resolution attempted unavailable tooling instead of using the installed local binary | Focused test execution | Command selection |
| CS-6 | Tooling | Low | Long validation wrappers timed out or returned stale/ambiguous terminal capture | Full web validation | Command design |
| CS-7 | Tooling | Low | VS Code retained a stale GroupsTab diagnostic after executable TypeScript was clean | Editor diagnostics review | Same stage |
| CS-8 | Process and docs | Low | Ten stamped header lines failed `git diff --check`; two edited guide dates remained stale | Final diff/doc audit | Immediately after doc edit |
| CS-9 | Tooling | Low | The web coverage command was invoked twice from the repository root | Stage 2 coverage | Command construction |
| CS-10 | Test correctness | Medium | Prisma E2E V10 queried a buffered RequestLog row immediately and failed under matrix concurrency | Stage 2 six-mode matrix | Test authoring |
| CS-11 | Test correctness | Medium | Parallel E2E apps rotated one shared production-default log file and raced on rename | Stage 2 six-mode matrix | E2E harness configuration |
| CS-12 | Process and docs | Medium | Production audit found newly published patched floors in four transitive dependency chains | Stage 3b.5 dependency sweep | Scheduled dependency intake |
| CS-13 | Tooling | Medium | The public-registry lock selected sql-escaper 1.5.2, which the corporate feed does not carry | Lockfile reproducibility check | CI artifact review plus managed-device `npm ci` |
| CS-14 | Process and docs | Medium | The dev pipeline could watch an older workflow run and accept stale `latest` content | Stage 4 pre-deploy review | Pipeline contract test |
| CS-15 | Test correctness | Medium | The Prisma matrix consumed a stale `inmemory` marker as its database URL | Full deployment Stage 2 matrix | Cross-mode harness contract |
| CS-16 | Process and docs | Medium | The Schemas visual baseline correctly failed on the new contextual panel | Stage 5.3 Playwright | Visual-regression review |
| CS-17 | Test correctness | Low | Connect Playwright assumed bearer was the default selected method | Full Playwright vs dev | Browser test authoring |

## 3. Detection Density

```mermaid
flowchart LR
    A["Authoring"] -->|"CS-1, CS-5"| B["Stage 0 focused tests"]
    B -->|"CS-2, CS-7"| C["Stage 1 static checks"]
    C -->|"CS-3, CS-6"| D["Full local validation"]
    D -->|"CS-4, CS-8"| E["Final audit"]
```

## 4. Detailed Entries

### CS-1 - Shared registry migration temporarily left two sources of truth

- **Type:** Architecture. **Severity:** Medium.
- **Symptom:** Importing `BOOLEAN_FLAGS`, `ENUM_SETTINGS`, and `NUMBER_SETTINGS` into `SettingsTab` while its old local declarations still existed produced duplicate-definition failures.
- **Root cause:** The extraction crossed an ownership boundary in two steps: create the shared registry, then remove the old private catalog. The intermediate state necessarily contained both.
- **Fix:** Removed the inline catalogs and made both Settings and contextual panels consume `endpoint-settings-definitions.ts`.
- **Why the fix works:** Defaults, bounds, labels, descriptions, and setting keys now have one declarative owner.
- **Prevention:** Applied in-place with `U-T7`, which asserts that Settings renders every registry family and all 38 server-registered controls. Contextual placement can no longer hollow out the complete Settings inventory silently.
- **Escape delta:** Detected by Stage 1 TypeScript; a narrow diff review could have caught it during authoring.

### CS-2 - List resource types did not satisfy the drawer contract

- **Type:** Test correctness. **Severity:** Medium.
- **Symptom:** `UsersTab` and `GroupsTab` passed `Record<string, unknown> | undefined` to a drawer requiring `ScimResource`.
- **Root cause:** List-response resources used a broad record type while the detail drawer kept a private, more specific resource interface. Repeated `.find()` expressions also prevented useful narrowing.
- **Fix:** Exported the existing `ScimResource` interface, typed list resources once, and passed the already-narrowed selected resource to the drawer.
- **Why the fix works:** The list and drawer now share the same structural contract, and the conditional render narrows one stable variable.
- **Prevention:** Executable `tsc --noEmit` is the authority. The repository baseline improved from 96 to 94 diagnostics, with zero diagnostics in changed files.
- **Escape delta:** Zero. Stage 1 TypeScript was the earliest executable detector and caught it.

### CS-3 - User-facing setting counts had drifted

- **Type:** Process and docs. **Severity:** Medium.
- **Symptom:** The endpoint-settings guide described 27 controls and four numeric JWKS settings while the server registry contains 38 controls, including 14 numeric settings.
- **Root cause:** The prose reflected an older settings surface and was not updated as credential caps and JWKS safety controls accumulated.
- **Fix:** Updated the endpoint-settings, UI, and authentication guides to describe the complete inventory and contextual ownership model.
- **Why the fix works:** Operators now see the same count and categories that the source registry exposes.
- **Prevention:** Existing `scripts/audit-doc-content.mjs` checks the total, boolean, numeric, and enum counts against `ENDPOINT_CONFIG_FLAGS_DEFINITIONS`, verifies every key is documented, and rejects phantom settings.
- **Escape delta:** Detected during feature documentation. The semantic content audit was the earliest automated detector available at final validation.

### CS-4 - Browser RED was a deployment regression proof, not the first implementation test

- **Type:** Test correctness. **Severity:** Medium.
- **Symptom:** The three Playwright journeys were run RED against the pre-feature dev deployment after the shared panel had already been implemented locally.
- **Root cause:** Component-level TDD drove the implementation first; assembled-browser coverage was authored after the cross-tab wiring existed.
- **Fix/status:** The core production component did follow RED-first: `EndpointRelatedSettings.test.tsx` failed on the missing production module before implementation, then passed. The Playwright RED is retained honestly as a pre-deployment regression proof and must turn GREEN on v0.55.22 dev.
- **Why this is acceptable but incomplete:** The implementation had a real failing test first, but the browser layer did not independently satisfy strict RED-before-production chronology.
- **Prevention:** For the next UI slice, author the Playwright skeleton and run it against the current deployment before wiring the final page integration. Do not describe a post-implementation deployment RED as the implementation's first RED.
- **Escape delta:** Detected only during the final transcript audit; the earliest possible point was test planning.

### CS-5 - Test runner resolution used the wrong entry point

- **Type:** Tooling. **Severity:** Low.
- **Symptom:** `npx` attempted to resolve tooling instead of consistently using the already-installed project binary.
- **Root cause:** The command relied on package-runner resolution in an environment where missing or differently resolved binaries can trigger installation behavior.
- **Fix:** Used `web/node_modules/.bin/vitest.cmd` for focused execution and did not install anything interactively.
- **Why the fix works:** It executes the repository-pinned binary and cannot fetch a different version.
- **Prevention:** Prefer package scripts or the local `.bin` executable for project tooling on this device.
- **Escape delta:** Zero; detected during the first affected command.

### CS-6 - Long validation capture became ambiguous

- **Type:** Tooling. **Severity:** Low.
- **Symptom:** Wrapper timeouts and reused terminal scrollback made one full-web run impossible to treat as authoritative.
- **Root cause:** Several long commands were grouped under a capture timeout, and a reused terminal contained output from earlier invocations.
- **Fix:** Discarded ambiguous output and ran a fresh authoritative validation, recording the final 105-file / 1,297-test result plus independent build and size results.
- **Why the fix works:** Only output tied to the fresh process is used as evidence.
- **Prevention:** Run long gates through one execution agent without a short timeout, or write each command's output to a uniquely named result file.
- **Escape delta:** Zero; the ambiguity was detected before its output was accepted.

### CS-7 - Editor diagnostic lagged behind executable TypeScript

- **Type:** Tooling. **Severity:** Low.
- **Symptom:** VS Code continued to report a `GroupsTab` resource-type error after the source was corrected.
- **Root cause:** The language-service diagnostic cache had not refreshed, while a fresh TypeScript process evaluated current files.
- **Fix:** Ran `tsc --noEmit` and checked changed-file diagnostics explicitly: 94 repository-baseline diagnostics, zero in changed files.
- **Why the fix works:** A fresh compiler process is independent of stale editor state.
- **Prevention:** When editor and command-line diagnostics disagree, use the executable compiler as the release gate and record both signals.
- **Escape delta:** Zero; detected and resolved within Stage 1.

### CS-8 - Documentation hygiene and provenance failed the final diff audit

- **Type:** Process and docs. **Severity:** Low.
- **Symptom:** Ten product-version header lines carried trailing spaces, causing `git diff --check` to fail; the edited authentication and UI guides still showed the prior verification date.
- **Root cause:** Automated version stamping preserved Markdown hard-break whitespace, and content edits did not update both provenance fields.
- **Fix:** Removed only the reported trailing spaces and updated both edited guides to 2026-09-15.
- **Why the fix works:** `git diff --check` and `audit-doc-freshness.ps1` now both pass.
- **Prevention:** Run both checks immediately after automated doc stamping rather than waiting for final review.
- **Escape delta:** Detected at final diff/doc audit; earliest possible detection was immediately after the doc edit.

### CS-9 - Package-owned coverage command ran from the repository root

- **Type:** Tooling. **Severity:** Low.
- **Symptom:** `npm run test:coverage` failed twice with `Missing script: "test:coverage"` because the persistent terminal was at the repository root, while the script belongs to `web/package.json`.
- **Root cause:** The first command omitted an explicit package directory. The retry relied on the terminal's intended working directory rather than encoding it in the command, so it repeated the same failure.
- **Fix:** Ran `Set-Location <repo>/web; npm run test:coverage` explicitly. The gate passed 105 files / 1,297 tests with 81.05% statements, 73.18% branches, 72.26% functions, and 84.31% lines.
- **Why the fix works:** The command resolves scripts from the owning package manifest regardless of persistent-shell state.
- **Prevention:** Every package-owned terminal command must include an explicit `Set-Location` in the same invocation, even when a previous command used that directory. Prefer the repository orchestrator when it already owns the working-directory transition.
- **Escape delta:** Zero runtime escape; command construction was the earliest possible detector, but the identical failed retry added avoidable friction.

### CS-10 - OAuth RequestLog assertions raced buffered Prisma persistence

- **Type:** Test correctness. **Severity:** Medium (false-red full-matrix gate).
- **Symptom:** The Prisma E2E matrix failed only `endpoint-oauth-client` V10: the 401 response was correct, but an immediate `GET /admin/logs` did not yet contain its buffered RequestLog row. The suite passed alone, confirming concurrency-sensitive timing.
- **Root cause:** V10 and neighboring W1 treated an eventually durable buffered write as immediately queryable. They also matched any endpoint/status 401, so W1 could accidentally select V10's prior row and pass against the wrong request. The shared E2E helper already states that shortening the flush timer narrows this race but does not remove it.
- **Fix:** Capture each rejected request's `X-Request-Id`, then use the existing `waitForLogRowByRequestId` helper, which force-flushes and polls the exact row before assertions.
- **Why the fix works:** Polling follows the persistence contract rather than machine timing, while request-ID selection prevents cross-test row substitution.
- **Prevention:** Any E2E assertion reading a RequestLog row must use `waitForLogRow` or `waitForLogRowByRequestId`; immediate list reads and fixed sleeps are forbidden. Prefer request-ID lookup whenever the triggering response exposes it.
- **Escape delta:** The issue survived isolated execution and was caught by the Stage 2 Prisma matrix. The earliest possible stage was test authoring, where the existing helper should have been used.

### CS-11 - Parallel E2E workers shared the production-default main log file

- **Type:** Test correctness. **Severity:** Medium (13-test false-red and cross-worker filesystem race).
- **Symptom:** After CS-10 was fixed, the next Prisma matrix run failed all 13 `http-error-codes` tests with `ENOENT` while renaming `api/logs/scimserver.log` to `.1`. The suite passed in isolation.
- **Root cause:** Every Jest worker creates its own Nest app, and the E2E helper did not set `LOG_FILE`. `FileLogTransport` therefore gave every process the same production-default main file. Two workers could both pass `existsSync`; one renamed the file before the other called `renameSync`.
- **Fix:** Set `process.env.LOG_FILE = ''` in `createTestApp` before the module compiles. Physical main-file and rotation behavior remains owned by the dedicated `FileLogTransport` and `RotatingFileWriter` unit suites; E2E endpoint-setting tests still validate the `logFileEnabled` profile contract.
- **Why the fix works:** Each E2E app no longer opens the shared main file, so independent test processes cannot race its rotation. Production defaults are unchanged.
- **Prevention:** Any process-parallel integration harness must explicitly isolate or disable shared filesystem transports. A production-default path is not a valid parallel-test default.
- **Escape delta:** Caught by the Stage 2 Prisma matrix; isolated suites could not reproduce it. The earliest possible stage was E2E harness design.

### CS-12 - Production dependency audit found four patchable transitive floors

- **Type:** Process and docs (supply chain). **Severity:** Medium (High advisories, zero Critical).
- **Symptom:** `npm audit --omit=dev` reported 11 High, 5 Moderate, 1 Low, and 0 Critical findings in API production dependencies; web production dependencies reported zero.
- **Root cause:** Four transitive floors had advanced after the previous override review: Multer 2.2.0 is affected by four 2026 advisories; fast-uri 4.1.2 by four URL-normalization advisories; deepmerge-ts below 8 by recursive-graph stack exhaustion; mysql2 through 3.23.0 by auth-downgrade and decompression-bomb advisories. npm expands those transitive findings through NestJS and Prisma parents, inflating the top-level High count.
- **Fix:** Raise overrides to Multer 2.3.0, fast-uri 4.1.3, deepmerge-ts 8.0.0, and mysql2 3.23.1. All four versions are available through the configured corporate feed and were published more than seven days before 2026-09-15. The final exact lockfile audits at 0 Critical / 0 High; 6 Moderate / 1 Low remain below the blocking threshold.
- **Why the fix works:** Each override meets the advisory's patched range without downgrading NestJS 11 or Prisma 7. It changes only vulnerable transitive implementations, not public application APIs.
- **Supply-chain constraint:** The corporate host must not generate the committed lockfile. `.github/workflows/regen-lockfile.yml` regenerates it on a public-registry GitHub runner, verifies registry hosts and sha512 integrity, and publishes a reviewable artifact.
- **Prevention:** Keep the scheduled dependency-pins review and Stage 3b.5 audit active; when a fix is available, verify seven-day age, update the override with advisory IDs, and use the CI lockfile workflow.
- **Escape delta:** Detected at the mandatory dependency sweep. The earliest automated stage is that same sweep; no feature test can detect advisory freshness.

### CS-13 - Clean public lockfile selected a package absent from the corporate feed

- **Type:** Tooling (cross-registry reproducibility). **Severity:** Medium because a clean lockfile that managed devices cannot install blocks every local gate.
- **Symptom:** The first CI-generated lockfile passed public-host and sha512 checks but `npm ci` on the managed device failed 404 for `sql-escaper@1.5.2`.
- **Root cause:** mysql2 3.23.1 declares `sql-escaper ^1.5.1`; the public registry selected 1.5.2, while the configured corporate feed currently exposes versions only through 1.5.1. Provenance correctness alone does not prove cross-registry availability.
- **Fix:** Add an explicit `sql-escaper: 1.5.1` override. It satisfies mysql2's range, carries no advisory in the sweep, and is available through the managed feed. The second public-runner artifact retained public hosts/sha512 and then installed successfully through the managed feed with `npm ci`.
- **Why the fix works:** Both public CI and managed local installs resolve one version that exists in both registries, while mysql2 remains above its patched floor.
- **Prevention:** After every CI lockfile regeneration, run `npm ci` on a managed device before accepting the artifact. The workflow's publish-age report should eventually add a configured-feed availability check for every newly introduced package.
- **Escape delta:** Caught immediately at the required post-artifact `npm ci`; the earliest possible detector is the same cross-environment reproduction check.

### CS-14 - Publish gate selected the newest workflow run without artifact identity

- **Type:** Process and docs (deployment gate correctness). **Severity:** Medium because a false-green publish gate can validate or deploy an older image.
- **Symptom:** Immediately after dispatching v0.55.22, `gh run list --limit 1` returned an older completed master run before the new event appeared. The pipeline used the same newest-run query after a fixed sleep, and its `latest` pull checked only that some image downloaded.
- **Root cause:** Run recency is not run identity. GitHub workflow-dispatch indexing is eventually consistent, so the newest visible row can predate the dispatch or carry another SHA. A successful anonymous pull likewise proves reachability, not that `latest` equals the requested version.
- **Fix:** Add `Select-GithubWorkflowRun`, filtering candidates by exact expected head SHA and `createdAt >= dispatch time`; poll boundedly until that run appears. Stage 4.4 now pulls both the version and latest tags and requires identical local image IDs.
- **Why the fix works:** The watched run is causally tied to the dispatch and source commit, and the pulled alias is byte-content-equivalent to the version tag before import/deploy.
- **Prevention:** The 8-assertion selector contract is a default Fast pre-push gate. It rejects an older different-SHA run, a stale same-SHA run, the prior newest-run query, missing pipeline integration, and a missing version/latest mismatch guard.
- **Escape delta:** Caught in Stage 4 pre-deploy review before any v0.55.22 deployment. The earliest automated detector is the new contract test.

### CS-15 - Cross-mode marker leaked InMemory state into Prisma E2E

- **Type:** Test correctness. **Severity:** Medium because the authoritative matrix produced 304 false failures across 14 unrelated suites and skipped database cleanup.
- **Symptom:** Prisma apps logged `Using database: inmemory`, then pg interpreted the malformed connection string as host `base` and returned `Can't reach database server at base` during endpoint creation.
- **Root cause:** InMemory global setup writes the literal `inmemory` to `.test-db-path`. `createTestApp` in Prisma mode trusted any marker content and assigned it to `DATABASE_URL`. Prisma global teardown could then also see `inmemory`, skip truncation, and leave hundreds of fixture endpoints accumulated in local `scimdb`.
- **Fix:** Add `resolveTestDatabaseUrl`, accepting only `postgresql://` or `postgres://` marker values and otherwise using the current environment/default PostgreSQL URL. The focused E2E contract covers stale InMemory, both valid schemes, empty, and malformed markers.
- **Why the fix works:** Backend mode remains the authority; a marker from another mode cannot override Prisma with a non-URL sentinel.
- **Prevention:** Every cross-mode filesystem marker must be parsed as a typed value rather than trusted as an arbitrary string. Run the full mode sequence on a clean local test database before deployment.
- **Confirmed resolution:** After resetting only local `scimdb`, all six modes passed in sequence; API E2E was 1,520/1,520 on both InMemory and Prisma. The failed deployment pipeline was stopped before Stage 4, so no image or estate received the invalid run.
- **Escape delta:** The issue appeared only when the official pipeline repeated the complete mode sequence. The earliest possible detector is the new pure marker contract.

### CS-16 - Schemas and Users visual baselines detected intended layout changes

- **Type:** Process and docs (visual review). **Severity:** Medium because baseline changes must never be accepted blindly.
- **Symptom:** Stage 5.3 first failed the Schemas pixel baseline; the subsequent complete suite also captured the stable Users-panel layout and failed that prior baseline. Auto-canary remained blocked.
- **Root cause:** The previous baselines showed the schema inventory and Users content immediately below their headings. v0.55.22 intentionally inserts `Schema behavior settings` and `User behavior settings` panels.
- **Classification:** Intended visual changes. Both expected/actual/diff PNG triplets were opened before their baseline updates. Diffs were confined to the new panels and resulting downward content shifts; app chrome, tabs, schema inventory, and Users empty state remained coherent.
- **Fix:** Regenerate only the Schemas and Users baselines against deployed v0.55.22 dev, then rerun the full Playwright suite before canary.
- **Prevention:** Keep baseline refresh behind written intended/unintended classification and diff inspection. Never bulk-update snapshots from a failing full run.
- **Escape delta:** Zero. The visual gate fired at the first stage capable of observing the intended layout change.

### CS-17 - Connect browser test assumed the default method tab

- **Type:** Test correctness. **Severity:** Low.
- **Symptom:** The Connect contextual-settings journey expected the bearer panel immediately after navigation, but WIF was the selected first enabled per-endpoint method.
- **Root cause:** The test asserted an incidental ordering/default instead of exercising the behavior named in the test: settings follow the operator's selected method.
- **Fix:** Explicitly click the bearer tab and assert its active-credential limit, then click WIF and assert its trust/JWKS controls.
- **Why the fix works:** The test now controls its own precondition and verifies both method-specific transitions rather than depending on tab order.
- **Prevention:** Browser tests for tab-specific content must select the tab they assert unless the default-selection contract itself is the behavior under test.
- **Escape delta:** Caught by the first complete Playwright run against deployed v0.55.22; isolated DOM/unit tests could not detect the navigation assumption.

## 5. Escape Analysis

| Issue | Detected stage | Earliest stage | Escape delta | Disposition |
|---|---|---|---:|---|
| CS-1 | Stage 1 | Authoring | 1 | Applied: one registry + U-T7 |
| CS-2 | Stage 1 | Stage 1 | 0 | Applied: shared resource type |
| CS-3 | Documentation | Documentation/content gate | 0 | Applied: guides corrected; C3/C5/C8 already enforce |
| CS-4 | Final audit | Test planning | 3 | Accepted for this slice; prevention recorded |
| CS-5 | Authoring | Authoring | 0 | Applied: local runner |
| CS-6 | Validation | Validation command design | 0 | Applied: discard ambiguous run |
| CS-7 | Stage 1 | Stage 1 | 0 | Applied: executable compiler authority |
| CS-8 | Final audit | Post-doc edit | 1 | Applied: diff + freshness checks |
| CS-9 | Stage 2 coverage | Command construction | 0 | Applied: explicit package directory |
| CS-10 | Stage 2 Prisma matrix | Test authoring | 2 | Applied: request-ID force-flush polling |
| CS-11 | Stage 2 Prisma matrix | Harness design | 2 | Applied: disable shared E2E main log file |
| CS-12 | Stage 3b.5 | Scheduled dependency intake | 0 | Applied: aged overrides + CI lockfile regeneration |
| CS-13 | Lockfile reproduction | Cross-registry availability | 0 | Applied: shared-availability sql-escaper pin |
| CS-14 | Stage 4 pre-deploy | Pipeline contract | 1 | Applied: exact-SHA selector + image-ID equality gate |
| CS-15 | Stage 2 full pipeline | Cross-mode harness contract | 2 | Applied: typed database-marker resolution |
| CS-16 | Stage 5.3 | Stage 5.3 | 0 | Applied: inspected single-baseline update |
| CS-17 | Full Playwright | Browser test authoring | 0 | Applied: explicit tab selection |

## 6. Verified Non-Issues

- No API route, response contract, persistence model, Prisma schema, or backend branch changed.
- Existing live section `9z-Z` already covers settings PATCH, deep merge, follow-up GET, overview projection, and cleanup; another live section would duplicate the same wire contract.
- WIF trusts are secretless and unaffected by the keyed-credential migration. The previously measured live inventories remained complete: dev 7/7, canary 7/7, customer prod 1/1.
- Web TypeScript remains at the accepted baseline with zero changed-file diagnostics.
- The package-lock update changed only root version metadata; 1,190 package entries retained `registry.npmjs.org` resolution and `sha512` integrity.

## 7. Self-Improvement and Architecture Disposition

- **Test/gate disposition: applied.** `U-T7` makes Settings completeness falsifiable even as contextual surfaces grow. Existing semantic doc checks cover setting counts, missing keys, and phantom settings.
- **Design/architecture disposition: accepted.** The shared declarative registry and reusable panel reduce duplication and preserve the established endpoint mutation path. Further splitting would be speculative because there is one implementation with several data-driven consumers, not several competing implementations.
- **Pattern promotion:** No new central pattern is required. CS-1 is another instance of the existing single-source-of-truth rule; CS-4 strengthens the established RED-first discipline but has not escaped twice.

## 8. v0.55.24 UX Refinement Follow-Up

### 8.1 Decision record

The September 17 follow-up applied one ownership rule: a contextual tab shows only settings unique to that workflow. Cross-resource controls remain in the complete Endpoint Settings inventory.

| Decision | Resolution | Why |
|---|---|---|
| Keep User and Group behavior panes? | **Yes, collapsed** | Two User lifecycle and three Group membership/deletion settings are useful beside the resources they govern. |
| Repeat common validation/PATCH/ETag controls in both? | **No** | One endpoint-wide value shown twice looks like two resource-specific values and makes the page longer without adding control. |
| Move every contextual setting back to Settings? | **No** | That restores the navigation round trip the original feature removed. The resource-unique subset is small and task-relevant. |
| Authentication methods presentation | **Four real methods, collapsed, setup order** | OAuth2, WIF, global shared secret and per-endpoint bearer are methods. `PerEndpointCredentialsEnabled` is a legacy fallback, not a fifth method. |
| Method-specific limits | **Remain under the selected Connect subtab, collapsed** | The cap or WIF/JWKS policy is needed while operating that method and is unrelated to other subtabs. |
| Credential actions | **One primary workflow plus More** | Generic credentials expose Rotate; WIF exposes Verify and Connect. Edit/reveal/lifecycle actions move to More; exports remain visible below the summary. |

### 8.2 Follow-up issue dashboard

| ID | Type | Severity | Symptom | Root cause | Resolution and prevention |
|---|---|---|---|---|---|
| UX-1 | Information architecture | Medium | Users and Groups each displayed the same eight common endpoint settings | The first contextual map optimized only for relevance, not for ownership, so endpoint-wide controls were repeated as if resource-specific | User now owns exactly two lifecycle settings and Group exactly three membership/deletion settings; unit + Playwright tests assert exact counts and absence of Strict schema validation |
| UX-2 | Security UX / contract | High | Connect and Settings switches were derived from flat `profile.settings`, but runtime enforcement gives `profile.authentication.methods[]` precedence | The UI reimplemented only the legacy fallback half of `resolveEndpointAuthEnablement`; a flat switch could appear changed while an authoritative method entry kept the opposite state | Central resolver now reports provenance; connection info carries `enablementSource`; Connect and Settings use server-resolved state and disable method-managed flat switches; unit, E2E, live, and Playwright assertions cover the override |
| UX-3 | Lifecycle semantics | Medium | Active credentials/trusts offered both Deactivate and Revoke even though both called the same DELETE route | UI labels implied two server operations and described Revoke as irreversible, while DELETE only sets `active=false` and POST `/activate` reverses it | One state-dependent Activate/Deactivate command remains; obsolete revoke dialog and false irreversible copy were removed; component tests reject a duplicate action |
| UX-4 | Responsive layout | Medium | At a 795 px viewport, main content measured 539 px client width versus 764 px scroll width; method tabs measured 491 px versus 538 px | Endpoint and method tab strips were unconstrained, and credential cards placed metadata and each button as implicit grid children | Tab strips now contain their own horizontal scroll; cards use explicit summary/action regions and stack below 900 px; connection rows stack below 700 px; Playwright measures main/card/action bounds at 820 px |
| UX-5 | Tooling | Low | Fresh-worktree dependency hydration exceeded the command wrapper timeout but completed later | The corporate feed is valid but slower than the wrapper's 120-second capture | Verify installed binaries and manifest cleanliness after timeout; never rerun an install blindly or override the configured registry |
| UX-6 | Environment | Low | `prisma generate` failed before TypeScript build with `Cannot resolve environment variable: DATABASE_URL` | Prisma 7 loads `prisma.config.ts` during generation even though generation does not connect | Supply a process-local syntactically valid URL for generation/build; do not persist it or infer a database dependency |
| UX-7 | Test correctness | Low | The new connection-info unit fixture failed to compile on `id` and `schemaVersion` | The assembler intentionally accepts a minimal `{type, enabled}` projection, while the fixture copied the larger persistence shape | Narrowed the fixture to the owning abstraction's contract; 33/33 service tests pass |
| UX-8 | Tooling | Low | Combined validation wrappers repeatedly exceeded their capture window and returned no authoritative summary | Long gates were grouped under a bounded wrapper | Discard partial output and recover the execution or rerun commands individually with output redirected to an ignored artifact; never infer a gate result from process activity |
| UX-9 | Test harness | Medium | Fifteen local WIF Playwright tests were blocked by a Fluent Dialog backdrop | A fresh InMemory server had zero endpoints, so first-run onboarding opened over specs whose setup seeded only the auth token | Non-onboarding browser setup now also marks onboarding complete before application code runs; one route-mocked and one real-fixture WIF test were rerun independently and passed |
| UX-10 | Environment | Low | The first local fixture run could not create endpoints through Vite | Vite proxies `/scim` to port 3000, while the API was started on the live-test default port 6000 | Restarted the isolated InMemory API on the configured proxy target; do not infer a browser/API port from the live-test default |
| UX-11 | Authentication UX | High | WIF ConnectionPanel and per-trust Connect cards labeled the issued target Client identifier as assertion `sub` | W3.9 separated `targetClientId` from `expectedSubject` server-side, but two UI projections retained the older single-identity model and one component test locked the wrong behavior | `targetClientId` is projected and editable; Client identifier uses `targetClientId ?? endpointId`; Expected assertion subject is a separate copyable/exported row; API, component and Playwright RED/GREEN coverage proves both values |
| UX-12 | Error handling | Medium | Activate, deactivate, reveal, rotate and label-edit failures could leave credential cards unchanged with no explanation | Action callbacks handled success but omitted `onError`, so moving actions into More preserved a pre-existing silent-failure path | Generic and WIF action areas now render scoped error MessageBars; lifecycle RED tests invoke real mutation error callbacks and assert the visible message |
| UX-13 | Tooling | Low | Mermaid render passed all 698 blocks, while the doctor reported the builtin renderer as version `0.0.0` and recommended installing Mermaid `0.0.0` | Builtin renderer version discovery returned a sentinel rather than the bundled Mermaid version | Classified as a known doctor false warning. The real-browser render gate is authoritative and passed both themes; no invalid package was installed. Gate repair remains separate process work. |
| UX-14 | Security / authorization contract | High | A disabled `wif-7523` or `wif-8693` method entry could coexist with `WifCredentialsEnabled=true`, leaving WIF creation, diagnostics, minting, connection info and discovery enabled | WIF was omitted from the shared resolver and its consumers read the flat flag directly | WIF is the fourth resolver facet; all WIF consumers use it; multiple WIF entries aggregate as enabled when any is enabled, matching discovery. Six focused API suites, E2E, live `9z-BV.T4-T6`, and Playwright prove the precedence. |
| UX-15 | Security / API contract | High | The broad endpoint overview response could carry retained plaintext secrets to every endpoint tab when visibility was `always` | Dashboard overview called the secret resolver even though an explicit, AUTH-audited `/connection-info` disclosure route already existed | Overview no longer depends on or calls the secret resolver. Connect fetches the dedicated route and prefers that response. Unit, API E2E, and live `9z-AW.T4b` prove overview withholding while connection-info still discloses under the opted-in policy. |
| UX-16 | Test correctness | Medium | The first pre-push run failed one current-hour dashboard assertion while 1,466 other E2E tests passed | The telemetry bucket assertion is timing-sensitive under the full hook workload | The exact spec passed in isolation, then the complete unchanged hook passed. Deterministic polling remains a scheduled test-harness improvement. |
| UX-17 | Test correctness | Low | The WIF egress-override test stopped before validator invocation after the authoritative gate was added | Its endpoint fixture replaced the settings object and omitted the WIF enablement precondition | Added `WifCredentialsEnabled=true` to that fixture; all six focused API suites then passed 592/592. |
| UX-18 | Tooling | Low | A combined multi-region patch against the large Credentials file failed without changing files | The editor patcher could not reconcile distant offsets in one operation | Split the change into small per-region patches and validated each focused test immediately. |
| UX-19 | Tooling / validation | Low | A lockfile artifact audit falsely reported an under-seven-day package after the CI workflow had passed | The checker matched the warning string in echoed workflow source instead of a package-result row | Replaced it with direct artifact JSON/diff checks; both lockfiles contain public-registry URLs, SHA-512 integrity, only four version-field changes, and zero dependency-version changes. |
| UX-20 | Process / Git | Low | GitHub rejected the first push with `directory file conflict` | A remote branch named `analysis` prevents creation of any `analysis/*` ref | Renamed the local branch to `feat/endpoint-settings-ux-v0.55.24` and pushed the identical commit after the full hook was green. |
| UX-21 | Process / docs | High | Multiple documents still called the live authentication model inert, omitted authentication from the profile, described discovery round-trip as lossless, or equated WIF target client identity with assertion subject | Point-in-time design and delivery documents remained indexed as current authority after later implementation waves changed the facts; no single cross-cutting document owned the profile/discovery/auth boundary | Added the canonical portable-profile/auth/discovery design; corrected or marked historical every high-risk authority; updated the index and source comments. Future cross-cutting changes must update the canonical design or explicitly state why it is unaffected. |
| UX-22 | Tooling / docs | Low | The first Mermaid grammar run failed the new WIF sequence diagram at `participant Create` | `Create` is a Mermaid sequence-diagram keyword, so using it as an actor alias is ambiguous even though the visible label is ordinary prose | Renamed the internal actor token to `Wizard` while preserving the visible label. The existing grammar and Chromium render gates already detect this class, so no new gate is needed. |
| UX-23 | Test correctness / visual gate | Medium | Dev Playwright first failed the Schemas visual baseline, then the complete rerun exposed the same stale state on Users | v0.55.24 intentionally changed contextual panels to collapsed accordions, but the Schemas and Users baselines were not both regenerated after that approved behavior landed | **Intended visual change because the collapsed `Schema behavior settings` and `User behavior settings` accordions are the shipped UX.** Inspected each expected, actual, and diff PNG set before regenerating only the two corresponding win32 snapshots; focused and full Playwright reruns own acceptance. |
| UX-24 | Process / docs | High | The indexed authentication configuration reference still applied to v0.55.13 and claimed unenforced methods were advertised | The canonical design reconciliation updated broad architecture docs but missed one user-facing operator authority | Updated the reference to v0.55.24, corrected keyed credential storage and discovery suppression, and linked the canonical design. Reviewer audit now treats narrative docs as green only after this correction. |
| UX-25 | Test correctness | Medium | One exact-tip CI validation failed P1-X2 while the duplicate validation and every local gate passed | The non-recoverability assertion used `issued.split('_').pop()`, but `_` is legal inside a base64url secret. A random secret could therefore reduce the checked value to a common short suffix or an empty string, producing a false claim that the persisted row contained secret material | Parse the issued token with the production `parseCredentialToken` function and assert the row excludes the complete parsed secret. The exact failed suite passes 15/15. This is a deterministic assertion over the real token grammar, not delimiter folklore. |

### 8.3 Test and architecture dispositions

- **Test/gate disposition: applied.** Exact User/Group ownership assertions, Accordion state checks, authoritative method-provenance tests at resolver/service/E2E/live layers, credential action hierarchy tests, and real-browser width measurements were added or strengthened.
- **Design/architecture disposition: applied.** Enablement provenance stays in the existing central resolver and connection-info contract. The UI does not create another resolver or persistence path.
- **Design/architecture follow-up: scheduled.** UI/auth maintainers will split method setup, WIF trust management, credential cards and diagnostics out of the 2,800-line `CredentialsTab.tsx` before the next authentication-method feature. Doing that inside this behavioral UX change would mix a broad refactor into its rollback unit.
- **Simplicity counter-check: accepted.** No new settings framework, auth-method CRUD UI, or nested disclosure hierarchy was introduced. One shared Accordion panel and existing connection-info response are sufficient.
- **Tooling follow-up: scheduled.** Docs-tooling maintainers will correct builtin Mermaid version discovery before the next Mermaid dependency bump; the required acceptance check is that the doctor reports the real bundled version instead of `0.0.0` while the 698-diagram render gate remains green.
- **Pattern promotion: applied.** UX-2 is now PF-2 in `ENGINEERING_LESSONS_AND_PATTERNS.md` and standing rule R11 in `.github/copilot-instructions.md`: a displayed layered control must consume the enforcement resolver, expose provenance and disable a non-authoritative write path.
- **Documentation authority disposition: applied.** UX-21 now has one canonical cross-cutting owner plus explicit historical/current labels in older documents. This closes the contradiction without deleting their useful delivery evidence.
- **Mermaid disposition: no new improvement required.** UX-22 was caught by the first grammar run and repaired before indexing the document; the existing gate already covers the failure class.
- **Visual-gate disposition: applied.** UX-23 followed the required expected/actual/diff inspection and written intended-change classification before a single-baseline regeneration.
- **Documentation-gate disposition: applied.** UX-24 closes the remaining indexed stale authority found by the post-deploy reviewer audit.
- **CI-test disposition: applied.** UX-25 replaces a random-shape assertion with the production parser; the CI failure itself was the negative control proving the old assertion could fail on legal output.

### 8.4 Provenance and completeness

RCA entries were written when each fix was confirmed RED to GREEN. The final reconciliation scanned the complete 3,208-line session transcript at `transcripts/c6313bb4-738a-49ae-b8e5-9087e8a14b61.jsonl`. Pass one searched error signals including `error TS`, HTTP failures, `RED`, `timeout`, `failed`, `blocked`, `rejected`, `false positive`, lint, parity and provider overrides. Pass two searched diagnosis language including `root cause`, `no-op`, `silently`, `turned out`, `culprit`, `stale` and `regressed`. Each hit was classified against the current v0.55.24 build; quoted standing instructions, self-referential searches, historical terminal scrollback, unrelated worktrees and previously resolved older-release incidents were dismissed. This reconciliation added UX-14 through UX-20 and corrected the earlier temporary claim that the active transcript was unavailable.
