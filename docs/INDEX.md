# SCIMServer Documentation Index

> **Version:** 0.45.0-alpha.3 - **Updated:** May 8, 2026  
> 84 API routes - 19 controllers - 6 presets - 16 config flags - 5,169 tests (3,643 unit + 1,172 E2E + 385 web vitest) + 7 Playwright + 901 live SCIM

---

## Project Health & Quick Start

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Overview, architecture, quick start, compliance, deployment, full API summary |
| [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md) | Living stats - LoC, test counts, dependency versions, architecture |
| [CHANGELOG.md](../CHANGELOG.md) | Version history from v0.1.0 to v0.40.0 |
| [admin.md](../admin.md) | Release workflow (version, tag, publish, update) |

## Deployment Guides

| Document | Description |
|----------|-------------|
| [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) | End-to-end Azure Container Apps deployment + Entra ID setup |
| [SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md](SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md) | Azure Government, BLEU (France), China - sovereign cloud deployment |
| [DOCKER_GUIDE_AND_TEST_REPORT.md](DOCKER_GUIDE_AND_TEST_REPORT.md) | Docker Compose build/run, 4-stage Dockerfile, healthcheck, testing |
| [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md) | Running instances, connection info, credentials, Azure costs |
| [PROD_TO_DEV_MIRRORING_AND_FIXTURES.md](PROD_TO_DEV_MIRRORING_AND_FIXTURES.md) | Mirror prod data into dev (IDs intact) + synthetic shape-coverage fixtures |
| [README_VISUAL_STUDIO_DEBUG.md](README_VISUAL_STUDIO_DEBUG.md) | VS Code debugging - launch configs, remote attach |
| [REMOTE_DEBUGGING_AND_DIAGNOSIS.md](REMOTE_DEBUGGING_AND_DIAGNOSIS.md) | Zero-access diagnosis - SSE, ring buffer, per-endpoint isolation, 4 workflows |

## Architecture & Design

| Document | Description |
|----------|-------------|
| [COMPLETE_API_REFERENCE.md](COMPLETE_API_REFERENCE.md) | **Full REST API** - all 84 routes, request/response examples, route summary table |
| [ENDPOINT_LIFECYCLE_AND_USAGE.md](ENDPOINT_LIFECYCLE_AND_USAGE.md) | **Quick start** - endpoint lifecycle, CRUD recipes, Entra ID integration |
| [TECHNICAL_DESIGN_DOCUMENT.md](TECHNICAL_DESIGN_DOCUMENT.md) | As-built architecture - layers, modules, data flow, Prisma schema |
| [USER_API_CALL_TRACE.md](USER_API_CALL_TRACE.md) | Annotated end-to-end POST /Users call trace |
| [MULTI_ENDPOINT_GUIDE.md](MULTI_ENDPOINT_GUIDE.md) | Multi-endpoint architecture, data isolation, tenant provisioning |
| [ENDPOINT_PROFILE_ARCHITECTURE.md](ENDPOINT_PROFILE_ARCHITECTURE.md) | **Profile system** - creation flow, 6 presets, auto-expand, tighten-only validation, schema cache |
| [SCHEMA_TEMPLATES_DESIGN.md](SCHEMA_TEMPLATES_DESIGN.md) | Profile configuration design (Phase 13) - decisions, types, flows |
| [SCHEMA_CUSTOMIZATION_GUIDE.md](SCHEMA_CUSTOMIZATION_GUIDE.md) | Operator guide - custom extensions, resource types, profile-based |
| [H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md](H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md) | PATCH validation architecture + immutable enforcement |
| [LOGGING_AND_OBSERVABILITY.md](LOGGING_AND_OBSERVABILITY.md) | Structured logging - ring buffer, SSE, file rotation, auto-prune |
| [WEB_UI_FLOWS_AND_BEHAVIORS.md](WEB_UI_FLOWS_AND_BEHAVIORS.md) | Web UI - 5 screens, data source matrix, Mermaid diagrams |
| [UI_GUIDE.md](UI_GUIDE.md) | **v0.41.0 UI Guide** - Fluent UI pages, screenshots (59), components, data flow, SSE, accessibility, theme system, legacy UI |
| [UI_REDESIGN_ARCHITECTURE_AND_PLAN.md](UI_REDESIGN_ARCHITECTURE_AND_PLAN.md) | **UI Redesign** - architecture options, BFF layer, event-driven stats, 42-step implementation plan |
| [UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md) | **Remaining Gaps Plan** - dependency-ordered Phases A-I to reach 100% UI redesign compliance, mutation layer, cutover lifecycle, ~120 new tests, 12-16 days |
| [PHASE_A1_TANSTACK_ROUTER_FOUNDATION.md](PHASE_A1_TANSTACK_ROUTER_FOUNDATION.md) | **Phase A1 - TanStack Router Foundation** (v0.42.0-alpha.1) - additive scaffolding (10 route files + zod search schemas + test helper), +28 web tests, no production code wired in yet (A2 = cutover) |
| [PHASE_A2_TANSTACK_ROUTER_CUTOVER.md](PHASE_A2_TANSTACK_ROUTER_CUTOVER.md) | **Phase A2 - TanStack Router Cutover** (v0.42.0-beta.1) - URL is now the single source of truth: RouterProvider wired, AppRouter regex matcher removed, currentPath/navigate stripped from Zustand, sidebar uses Link + useRouterState, EndpointDetailPage is layout-only with Outlet for tabs. +6 web tests (274 total), 1.03s build |
| [PHASE_A3_PER_PAGE_URL_STATE.md](PHASE_A3_PER_PAGE_URL_STATE.md) | **Phase A3 - Per-Page URL State** (v0.42.0-beta.2) - pagination + filter inputs hoisted into URL via useSearch + useNavigate. UsersTab/GroupsTab/LogsTab/LogsPage/EndpointsPage all URL-driven. +6 web tests (280 total) |
| [PHASE_A4_ROUTE_LOADERS.md](PHASE_A4_ROUTE_LOADERS.md) | **Phase A4 - Route Loaders + Hover-Prefetch** (v0.42.0-beta.3) - per-route loaders pre-fetch data via queryClient.ensureQueryData; combined with `<Link>` + defaultPreload:'intent', hovering warms cache before click. Shared `xxxQueryOptions()` helpers as single source of truth. +13 web tests (293 total) |
| [PHASE_A5_PLAYWRIGHT_AND_SPA_FALLBACK.md](PHASE_A5_PLAYWRIGHT_AND_SPA_FALLBACK.md) | **Phase A5 - Playwright E2E + SPA Fallback Fix** (v0.42.0-beta.4, closes Phase A) - real-browser tests lock in router contracts; surfaced & fixed critical bug where deep links to /endpoints, /logs, /settings returned NestJS 404 (only /admin had SPA fallback). New `applySpaFallback` middleware + 23 new tests (8 unit + 15 E2E) + 7 Playwright cases |
| [PHASE_B_BFF_OVERVIEW_AND_SSE.md](PHASE_B_BFF_OVERVIEW_AND_SSE.md) | **Phase B - BFF Overview + SSE Audit** (v0.43.0) - new `GET /admin/endpoints/:id/overview` endpoint aggregates summary+stats+credentials+activity+flags into one round trip (zero DB queries on warm cache); `useEndpointOverview` hook replaces 2 separate calls in OverviewTab; `useSSE` made channel-aware so per-endpoint Overview/Users/Groups caches invalidate on the right SCIM events. +9 unit + 3 E2E + 17 live + 10 web tests |
| [PHASE_C_PRIMITIVES_AND_MUTATIONS.md](PHASE_C_PRIMITIVES_AND_MUTATIONS.md) | **Phase C - Reusable Primitives + Mutation Layer** (v0.44.0 + v0.44.1 hardening) - 6 primitives (DetailDrawer / FormDialog / EmptyState / LoadingSkeleton / ErrorBoundary with resetKeys / KpiChart) + 9 mutation hooks with universal optimistic-update pattern (onMutate snapshot -> apply -> onError rollback -> onSettled invalidate). v0.44.1 adds true optimism for User/Group PATCH+DELETE, useUpdateGroup/useDeleteGroup, If-Match ETag header propagation, queryKeys.users.all/groups.all factories, route-aware ErrorBoundary auto-reset. +65 web tests (303 -> 368) |
| [PHASE_D1_OVERVIEW_TAB_DATA_COMPLETE.md](PHASE_D1_OVERVIEW_TAB_DATA_COMPLETE.md) | **Phase D1 - Overview Tab Data-Complete** (v0.45.0-alpha.1) - OverviewTab now composes Phase C primitives (LoadingSkeleton + EmptyState) on top of Phase B BFF: 5 KPI cards (added Config Flags - count of explicitly-true flags), Recent Activity card (10 rows: time / path / METHOD / status badge / duration), EmptyState in Activity slot when zero entries, Skeleton mirrors final layout (CLS=0). +4 web tests (368 -> 372). Frontend-only. |
| [PHASE_D2_ACTIVITY_TAB.md](PHASE_D2_ACTIVITY_TAB.md) | **Phase D2 - Activity Tab** (v0.45.0-alpha.2) - new ActivityTab at `/endpoints/$id/activity` with URL-driven type/severity/search filters (zod-validated closed-set enums). Backend adds optional `?endpointId=` param to `GET /admin/activity` (indexed WHERE, no schema change). SSE invalidation extended so user/group/resource events refetch the activity feed. +2 API unit + 1 E2E + 10 live (`9z-W`) + 6 web vitest. |
| [PHASE_D3_SCHEMAS_TAB.md](PHASE_D3_SCHEMAS_TAB.md) | **Phase D3 - Schemas Tab** (v0.45.0-alpha.3) - new SchemasTab at `/endpoints/$id/schemas` - read-only tree view of every schema declared by the endpoint's profile. Per-attribute characteristic badges (type / required / mutability / returned / uniqueness / multiValued / caseExact). Per-schema Copy URN button. 5min cache (schemas rarely change). LoadingSkeleton + EmptyState (covers SchemaDiscovery=disabled). +7 web vitest. Frontend-only. |
| [PHASE_D4_DASHBOARD_CHARTS.md](PHASE_D4_DASHBOARD_CHARTS.md) | **Phase D4 - Dashboard Charts** (v0.45.0-alpha.4) - 24h request volume sparkline lands on the dashboard. New `LoggingService.getRequestSeries({ hours })` returns fixed-length 24-element array of hourly counts (current hour at index 23, oldest first). DashboardResponse extended with `requestsLast24hSeries: number[]`. KpiChart wired in DashboardPage with sum + current-hour caption. R2/R3 polish: Spinner -> LoadingSkeleton + plain text -> EmptyState. Bonus pre-existing fix: in-memory `listLogs` filter parity (was missing every filter except endpointId). +33 tests across all 4 layers (3,659 unit / 1,175 E2E / 389 web / 907 live). |
| [PHASE_D5_GLOBAL_LOGS_ENHANCEMENT.md](PHASE_D5_GLOBAL_LOGS_ENHANCEMENT.md) | **Phase D5 - Global Logs Enhancement** (v0.45.0-alpha.5) - Global Logs page redesigned. Backend exposes new `endpointId` query param on `GET /admin/logs` (was previously plumbed through service but missing from controller). Frontend ships toolbar with URL contains + endpoint Combobox + status chips (200/201/400/401/403/404/409/500) + time-range chips (1h/24h/7d/30d). All filters URL-driven via Phase A pattern. Click-to-open DetailDrawer (C1) with full request/response headers + bodies, opened via `?detail=<id>`. New `useGlobalLogs` and `useGlobalLog` hooks (R6). R4 polish: Spinner -> LoadingSkeleton + plain text -> EmptyState with conditional CTA. +25 tests across all 4 layers (3,661 unit / 1,178 E2E / 396 web / 919 live). |
| [PHASE_E1_CREDENTIALS_MANAGER.md](PHASE_E1_CREDENTIALS_MANAGER.md) | **Phase E1 - Credentials Manager** (v0.46.0-alpha.1) - first sub-phase of Phase E (Write Operations). New CredentialsTab at `/endpoints/$id/credentials` consumes Phase B BFF (zero extra round trip), uses Phase C5 mutation hooks (useCreateCredential / useDeleteCredential). Plaintext bearer token shown EXACTLY ONCE with copy button + 'save now' warning (server stores only bcrypt hash). Delete flow with optimistic remove + rollback. PerEndpointCredentialsEnabled=False surfaces as MessageBar warning + disabled Add button + link to Settings. +13 web vitest tests. Frontend-only - backend CRUD already shipped in Phase 11 (G11). |
| [PHASE_E2_CONFIG_FLAG_TOGGLES.md](PHASE_E2_CONFIG_FLAG_TOGGLES.md) | **Phase E2 - Config Flag Toggles** (v0.46.0-alpha.2) - SettingsTab is now interactive. 13 known boolean ProfileSettings flags rendered as Switches; toggling fires `useUpdateEndpointConfig` with `{ profile: { settings: { <flag>: <bool> } } }`. The mutation hook now does an **optimistic deep-merge** into both detail.profile.settings AND overview.configFlags caches (was a destructive shallow spread before E2 - any single flag flip would clobber profile.schemas / resourceTypes / sibling flags until the next refetch). Inline MessageBar success/error feedback (auto-dismiss 4s) + pending-flag disable. Boolean coercion handles native booleans and Entra-style 'True' / 'False' strings. Read-only third card surfaces non-boolean settings (PrimaryEnforcement, logLevel). +15 web vitest (12 SettingsTab + 3 mutations) + +12 live (`9z-Z`). Frontend-only - backend PATCH unchanged. |
| [PHASE_E3_MANUAL_PROVISION.md](PHASE_E3_MANUAL_PROVISION.md) | **Phase E3 - Manual Provisioning Redesigned** (v0.46.0-alpha.3) - new top-level `/manual-provision` page replacing the legacy `components/manual/ManualProvision.tsx`. Endpoint Combobox + User/Group TabList; sub-components `CreateUserForm`, `CreateGroupForm`, `ProvisionResult`. Wires Phase C5 mutation hooks (`useCreateUser` / `useCreateGroup`) so cache invalidation flows through standard query keys (UsersTab / GroupsTab / Dashboard / Overview all refetch). Result panel shows id + raw JSON on success, error MessageBar on failure. Sidebar nav item with PersonAdd icon between Endpoints and Logs. +9 web vitest tests covering loading/error/picker/disabled/User+Group submit body shapes/result panel success+error/HTML5 required guard. +1 router test assertion. Frontend-only. |
| [PHASE_E4_DETAIL_DRAWER_PATCH_DELETE.md](PHASE_E4_DETAIL_DRAWER_PATCH_DELETE.md) | **Phase E4 - User/Group Detail Drawer + PATCH/DELETE** (v0.46.0-alpha.4) - final Phase E sub-phase. Clicking a row in UsersTab or GroupsTab opens a `ResourceDetailDrawer` (shared component discriminated by `kind: 'user' \| 'group'`) with read-only metadata (id, created, lastModified) + editable form (User: userName/displayName/active; Group: displayName/externalId/members count). Save builds a real SCIM PATCH Operations envelope (`schemas: ['...PatchOp']`, `Operations: [{ op: 'replace', path, value }, ...]`) with only changed fields (no-op skipped). Wired to Phase C5 hooks `useUpdateUser` / `useUpdateGroup` (optimistic against every cached list page). Delete has inline confirm step (no second modal) firing `useDeleteUser` / `useDeleteGroup`. Drawer state lives in URL via `?detail=<id>` (consistent with D5 LogsPage). +10 web vitest tests covering both User and Group modes. Frontend-only. |
| [PHASE_F1_COMMAND_PALETTE.md](PHASE_F1_COMMAND_PALETTE.md) | **Phase F1 - Command Palette (Cmd+K)** (v0.46.1-alpha.1) - first Phase F sub-phase. Cmd+K (mac) / Ctrl+K (others) opens a Linear/Raycast-style chrome-level overlay built on cmdk + Fluent UI Dialog. Three source groups with cmdk fuzzy-filter: 5 routes (Dashboard / Endpoints / Manual Provision / Logs / Settings), dynamic endpoints from useEndpoints, 2 quick actions (Create user / Create group both route to /manual-provision). Mounted once in AppShell at chrome level. +11 web vitest tests covering all source groups + keyboard shortcut paths + fuzzy filter + Esc close. Added `Element.prototype.scrollIntoView` jsdom stub for cmdk compatibility. Frontend-only. |
| [PHASE_F2_KEYBOARD_SHORTCUTS.md](PHASE_F2_KEYBOARD_SHORTCUTS.md) | **Phase F2 - Keyboard Shortcuts** (v0.46.1-alpha.2) - global GitHub/Linear-style shortcuts. New `useKeyboardShortcuts` hook implements 7 bindings: `g d` Dashboard, `g e` Endpoints, `g m` Manual Provision, `g l` Logs, `g s` Settings, `/` open command palette, `?` open help modal. Sequence buffer with 1000ms reset window; suppression-aware (skips when typing in input/textarea/select/contenteditable, skips under Cmd/Ctrl/Alt modifier). New `KeyboardShortcutsHelp` modal lists every shortcut grouped by intent (Navigation / Search & help) with monospace kbd badges. Both mounted once in AppShell. `/` opens the same F1 palette (doubles as global search). +19 web vitest (15 hook + 4 help). Frontend-only. |
| [PHASE_F3_SSE_INVALIDATION_AUDIT.md](PHASE_F3_SSE_INVALIDATION_AUDIT.md) | **Phase F3 - SSE Invalidation Completeness Audit** (v0.46.1-alpha.3) - audit closed two real gaps in Phase B3 invalidation map. (1) Logs invalidation: Global Logs (`['global-logs', ...]`) and per-endpoint Logs (`['endpoint-logs', ...]`) caches pre-dated the `queryKeys.logs` factory and were never SSE-invalidated; now hit on every channel. (2) Activity invalidation: previously only on user/group/resource channels, now also fires on credential and endpoint events (admin actions land on activity feed). New prefix keys `queryKeys.logs.all` / `globalLogs.all` / `endpointLogs.all`. Pure additive change - no existing invalidation removed. +7 web vitest tests locking the contract. Frontend-only. |
| [PHASE_G_VISUAL_POLISH.md](PHASE_G_VISUAL_POLISH.md) | **Phase G - Visual Polish** (v0.46.1-alpha.4) - closing audit of S10 visual polish gates. **G1**: Spinner -> LoadingSkeleton on 8 surfaces (EndpointsPage 6 card tiles, EndpointDetailPage header+tabs+content bands, UsersTab/GroupsTab/LogsTab 8 row bands, SettingsTab 6 form rows, SettingsPage 3 card tiles, ManualProvisionPage header+picker+form). Each skeleton mirrors the final layout. **G2**: ad-hoc Text -> EmptyState on 4 new surfaces (EndpointsPage with Reset filter CTA, UsersTab, GroupsTab, LogsTab with Reset filter CTA). **G3 + G4**: new `RouteBoundary` primitive ([web/src/layout/RouteBoundary.tsx](../web/src/layout/RouteBoundary.tsx)) wraps the root `<Outlet />` once. G3: ErrorBoundary keyed on pathname auto-resets on navigation; G4: 180 ms opacity fade on every route change honoring `prefers-reduced-motion`. +19 web vitest (5 RouteBoundary + 14 polish audit). Web suite 480 -> 499. Frontend-only. |
| [PHASE_H1_MSW_HANDLERS.md](PHASE_H1_MSW_HANDLERS.md) | **Phase H1 - MSW Handlers** (v0.46.1-alpha.5) - first Phase H sub-phase. Closes plan §5.3 gap: msw@2.14.3 was installed but had zero handlers. New `web/src/test/msw/{fixtures,handlers,error-handlers,server,browser}.ts` (~600 LoC). 15 handlers cover all 12 admin BFF endpoints + SCIM `/Schemas` (real `/scim/v2/*/Schemas` and admin `/admin/endpoints/:id/Schemas` paths). Fixtures typed against `@scim/types/dashboard.types` so any contract change is a `tsc` failure. Per-status-code error factories for 401/403/404/409/500 opt-in coverage. **Lifecycle is opt-in per file** (not global) because MSW v2 in Node intercepts below `globalThis.fetch` and would break 24 legacy `vi.stubGlobal('fetch')` tests in `api/client.test.ts` + `components/{activity,database}/*.test.tsx` (slated for I2 deletion). New integration test [web/src/test/msw.integration.test.tsx](../web/src/test/msw.integration.test.tsx) exercises the real `fetchWithAuth` + `useQuery` pipeline with 5 happy-path + 3 error-override tests. +8 web vitest (499 -> 507). Frontend-only. |
| [PHASE_H2_AXE_A11Y_GATE.md](PHASE_H2_AXE_A11Y_GATE.md) | **Phase H2 - axe-core a11y gate** (v0.46.1-alpha.6) - closes plan §5.1 gap: redesigned UI shipped without an automated a11y gate. Installs axe-core (Microsoft Accessibility Insights / Lighthouse engine) + `@axe-core/playwright`. Two-layer architecture: vitest helper [web/src/test/a11y-helper.ts](../web/src/test/a11y-helper.ts) for per-component / per-page checks (jsdom), Playwright helper [web/e2e/a11y-playwright.ts](../web/e2e/a11y-playwright.ts) for assembled-page checks (Chromium real-theme). Both share `FAIL_IMPACTS=[serious,critical]` constant. Vitest layer disables `color-contrast` / `region` / `landmark-one-main` (jsdom limitations); Playwright layer keeps them enabled and only disables `color-contrast-enhanced` (WCAG AAA, above our AA bar). 10 tests cover every primitive (LoadingSkeleton / EmptyState x2 / ErrorBoundary fallback / KpiChart) + 3 pages (Endpoints / Dashboard / Settings) + helper contract (FAILS on button-without-name). +10 web vitest (507 -> 517). Frontend-only. |
| [PHASE_H3_VISUAL_REGRESSION.md](PHASE_H3_VISUAL_REGRESSION.md) | **Phase H3 - Visual regression** (v0.46.1-alpha.8) - closes plan §5.2 gap: redesigned UI shipped without a visual regression gate. **Two-layer strategy:** Playwright `toHaveScreenshot()` pixel-diff against committed baselines (12 full-page baselines covering Dashboard light+dark, Endpoints, Logs light+dark, Settings, Manual Provision, Endpoint Detail Overview/Users/Schemas, Command Palette open, Keyboard Help open) + vitest `toMatchSnapshot()` HTML structural diff (4 primitive baselines: LoadingSkeleton x2 / EmptyState x2). Vitest snapshots strip Fluent UI CSS-in-JS class hashes via `normalizeFluentHashes()` regex so a Fluent minor upgrade does not invalidate every snapshot. Playwright snapshots use `animations:disabled` + documented `mask` selectors (`NON_DETERMINISTIC_SELECTORS`: uptime ticker, current-time, recharts SVG bars, log timestamps) + `maxDiffPixelRatio:0.002` (0.2% tolerance). Also ships F3-deferred [web/e2e/sse-cross-tab.spec.ts](../web/e2e/sse-cross-tab.spec.ts): two BrowserContexts, Tab A creates user via Manual Provision, Tab B's UsersTab refetches WITHOUT manual reload within 5 s (validates F3 SSE invalidation contract at the cross-tab boundary that vitest cannot model). +4 web vitest (517 -> 521). Frontend-only. |
| [PHASE_H4_COVERAGE_GATES.md](PHASE_H4_COVERAGE_GATES.md) | **Phase H4 - vitest coverage gates** (v0.46.1-alpha.9) - closes plan §5.4 gap: redesigned UI shipped without a coverage gate. Wires `@vitest/coverage-v8` into [web/vite.config.ts](../web/vite.config.ts) with V8 provider + scoped `include` (redesigned-UI surface only) + `exclude` for I2-deletion legacy components + ratchet-floor `thresholds` set 2-3 points below the v0.46.1-alpha.8 measured baseline (lines:78 / branches:70 / functions:65 / statements:75 vs aspirational lines:80 / branches:75 / functions:90 / statements:80). Floor protects against regression while not blocking other phases on test-debt cleanup; aspirational targets reachable via 9 trivial route-wrapper tests + 6 mutation hook tests + 3 filter-combination tests + Phase I2 legacy deletion. New `npm run test:coverage` script. New 6-test config contract spec [web/src/test/coverage-config.test.ts](../web/src/test/coverage-config.test.ts) prevents anyone from silently disabling the gate or lowering thresholds (regex match on each threshold value with `>=` assertion). +6 web vitest (521 -> 527). Frontend-only. |
| [PHASE_H5_TEST_ALL_MODES.md](PHASE_H5_TEST_ALL_MODES.md) | **Phase H5 - test-all-modes orchestrator** (v0.46.1-alpha.10) - closes plan §5.5 / S11.5 gap: redesigned UI shipped without a single command for the full test matrix across persistence backends. New `scripts/test-all-modes.ps1` (~210 LoC) runs 6 modes: `api-unit-{inmemory,prisma}`, `api-e2e-{inmemory,prisma}`, `web-vitest`, `web-coverage-gate`. Per-mode env-var stash + restore in `finally` block prevents `PERSISTENCE_BACKEND=prisma` from leaking into the next mode's `inmemory` run (which would silently mask backend-divergence bugs - the very thing the orchestrator exists to catch, with Phase D4's `LoggingService.listLogs` 9-filter-dimension bug as real-world precedent). Auto-installs missing `api/node_modules` / `web/node_modules` for fresh-clone case. Per-mode logs to `test-results/test-all-modes-<mode>.log`. Exit codes 0 / 1 / 2. New 14-assertion contract test [scripts/test/test-all-modes.contract.ps1](../scripts/test/test-all-modes.contract.ps1) validates orchestrator script syntax + parameter contract on every push without running the ~5-min functional matrix. Frontend-only test infra. |
| [PHASE_H6_SIZE_LIMIT_BUDGETS.md](PHASE_H6_SIZE_LIMIT_BUDGETS.md) | **Phase H6 - size-limit bundle budgets** (v0.46.1-alpha.11) - closes plan §5.6 / S11.6 gap: redesigned UI shipped without a bundle-size gate. Wires `size-limit@12` + `@size-limit/preset-app` into [web/package.json](../web/package.json) with **gzipped ratchet-floor budgets** (JS: 420 KB / CSS: 12 KB) measured at v0.46.1-alpha.10 baseline (394.45 KB JS + 9.73 KB CSS) with ~6-23 % headroom. Why gzipped not raw: browsers download gzip-encoded payload over the wire; raw-byte budgets give false-negative for highly-compressible Fluent UI. New `npm run size` + `npm run size:why` scripts. **Per-route 90/110 KB plan targets are aspirational** - require code-splitting work (dynamic `import()` + Suspense boundaries) deferred to a Phase J follow-up because the current build emits a single combined bundle. New 8-test config contract spec [web/src/test/size-limit-config.test.ts](../web/src/test/size-limit-config.test.ts) prevents silent gate disablement: regression-locks both JS + CSS budget entries present, both enforced gzipped, both within ratchet floor (`<=420 KB` / `<=12 KB` - lowering OK, raising requires deliberate test update), paths target `dist/assets/*` not `src/`, npm scripts present. +8 web vitest (527 -> 535). Frontend-only. |
| [PHASE_I_LEGACY_CLEANUP.md](PHASE_I_LEGACY_CLEANUP.md) | **Phase I (I1+I2+I3) - Legacy Cleanup + UI Cutover** (v0.48.0) - **FINAL UI REDESIGN PHASE**. All three sub-phases ship as one atomic commit because they are tightly coupled (strip switch + delete components + final validation). I1: web/src/App.tsx collapsed from 710 LoC to 10 LoC RouterProvider mount, ?ui=legacy escape hatch + URLSearchParams + AuthProvider/ThemeProvider context wrappers all gone. I2: deleted ~3,850 LoC across api/client.ts (520) + components/{Header,LogList,LogDetail,LogFilters}* (730) + components/{activity,database,manual}/ folders (1,180) + hooks/{useAuth,useTheme}.tsx (270) + app.module.css (80) + old App.tsx + App.test.tsx (920); replacements documented in mapping table (api/queries.ts via TanStack Query, layout/AppHeader.tsx, pages/LogsPage.tsx, pages/UsersTab.tsx + GroupsTab.tsx + Endpoint Detail BFF, pages/ManualProvisionPage.tsx, auth/token.ts + TokenGate, store/ui-store.ts Zustand + Fluent UI FluentProvider). I3: all 11 quality gates verified (TDD, addMissingTests, contract verification, error handling, logging, RFC compliance, security, perf, docs, full validation, live deploy gate). Bundle size dropped 394.45 KB -> 377.33 KB gzipped (-17 KB / 4 % reduction). Web vitest 535 -> **397** (-138 from deleted legacy tests; coverage 77.6/72.98/65.99/80.43 still above floor). 933 live unchanged. coverage include widened to src/**, I2-deletion excludes removed; size-limit CSS budget dropped (Fluent UI uses CSS-in-JS, no separate stylesheet). New 6-test App.test.tsx contract spec (uses stripComments helper to handle docstring references to deleted concepts). Prod promotion: NEVER automatic; explicit-user-only via promote-to-prod.ps1 standing rule. |
| [PHASE_J_SSE_EVENT_BRIDGE.md](PHASE_J_SSE_EVENT_BRIDGE.md) | **Phase J - SCIM Event SSE Bridge + MSW worker mount + DELIVERY_PLAN sweep** (v0.48.1) - closes the cross-tab refresh gap left over from Phase B. Pre-J root cause: `useSSE` reads `data?.type` from each SSE message but the SSE stream only forwarded `StructuredLogEntry` objects (no `type` field) - so NO SCIM mutation events reached the client for ANY channel; cross-tab refresh ran on the 30 s `staleTime` for users / groups / resources / credentials / endpoints. Phase J ships: (1) new `ScimEventSseBridge` service in [api/src/modules/stats/](../api/src/modules/stats/scim-event-sse-bridge.service.ts) with one `@OnEvent` per `SCIM_EVENTS` constant forwarding to a new `ScimLogger.emitScimEvent(type, payload)` channel; (2) extended SSE controller subscribes to BOTH log entries + SCIM events on the same `/admin/log-config/stream` connection; (3) 7 new SCIM_EVENTS constants (USER_UPDATED, GROUP_UPDATED, CREDENTIAL_CREATED, CREDENTIAL_REVOKED, ENDPOINT_CREATED, ENDPOINT_UPDATED, ENDPOINT_DELETED) emitted from the credential controller + endpoint service + user/group PUT/PATCH success paths (emit-after-commit); (4) MSW browser worker mount in [web/src/main.tsx](../web/src/main.tsx) gated on `import.meta.env.VITE_USE_MSW === 'true'` with dynamic `await import()` (production tree-shakes) - unblocks the F3-deferred Playwright cross-tab spec; (5) DELIVERY_PLAN.md sweep marking S-4, S-5, OPS-2, OPS-3, OPS-4, UI-B1..6, all UI Frontend phases as closed (verified in code) + refreshing test counts (3,675 unit / 1,178 E2E / 933 live -> 3,720 / 1,184 / 933 with Phase J additions). PII boundary asserted at unit + E2E: credential SSE payload NEVER carries the bcrypt hash or plaintext token. Test deltas: API unit 3,675 -> 3,720 (+45 across 5 specs), API E2E 1,178 -> 1,184 (+6 in scim-event-sse-bridge), Web vitest 397 -> 403 (+6 in main-msw-mount). Prod promotion: NOT triggered, dev-only deploy per standing rule. |
| [DELIVERY_PLAN.md](DELIVERY_PLAN.md) | **Active 6-week delivery plan** - reconciles UI redesign + Tier-0 security + CI/CD upgrades into one operating model with named defects, TDD process, blue/green to prod, progress log |
| [adr/ADR-004-enable-implicit-conversion.md](adr/ADR-004-enable-implicit-conversion.md) | ADR-004 - keep `enableImplicitConversion: true` (S-5 closure with regression-locked decision) |

## SCIM Protocol & RFC Compliance

| Document | Description |
|----------|-------------|
| [SCIM_REFERENCE.md](SCIM_REFERENCE.md) | SCIM v2 protocol reference with example payloads |
| [SCIM_COMPLIANCE.md](SCIM_COMPLIANCE.md) | RFC 7643/7644 compliance matrix + Entra compatibility |
| [SCIM_RFC_COMPLIANCE_LAYER.md](SCIM_RFC_COMPLIANCE_LAYER.md) | Technical compliance implementation details |
| [SCIM_CASE_INSENSITIVITY_REFERENCE.md](SCIM_CASE_INSENSITIVITY_REFERENCE.md) | Case-insensitivity rules (RFC 7643 S2.1) |
| [RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md](RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md) | RFC schema & extension URN deep dive |
| [DISCOVERY_ENDPOINTS_RFC_AUDIT.md](DISCOVERY_ENDPOINTS_RFC_AUDIT.md) | Discovery endpoints RFC audit - all gaps resolved |

## Per-Endpoint Configuration

| Document | Description |
|----------|-------------|
| [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | **Complete flag reference** - 16 flags with Mermaid diagrams, preset defaults, deprecation notes |
| [SCHEMA_ATTRIBUTE_CUSTOMIZATION_GUIDE.md](SCHEMA_ATTRIBUTE_CUSTOMIZATION_GUIDE.md) | Attribute customization guide - tighten-only rules, 12 scenarios, 4 templates |
| [MULTI_MEMBER_PATCH_CONFIG_FLAG.md](MULTI_MEMBER_PATCH_CONFIG_FLAG.md) | Multi-member PATCH add/remove config |
| [FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md](FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md) | Soft delete, strict schema, custom extensions |
| [COLLISION-TESTING-GUIDE.md](COLLISION-TESTING-GUIDE.md) | Entra collision (409) testing guide |

## Feature Implementation Docs

| Document | Description |
|----------|-------------|
| [G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md](G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md) | Custom resource type registration via inline profile |
| [G8C_PATCH_READONLY_PREVALIDATION.md](G8C_PATCH_READONLY_PREVALIDATION.md) | PATCH readOnly pre-validation |
| [G8E_RETURNED_CHARACTERISTIC_FILTERING.md](G8E_RETURNED_CHARACTERISTIC_FILTERING.md) | Response `returned` characteristic filtering |
| [G8F_GROUP_UNIQUENESS_PUT_PATCH.md](G8F_GROUP_UNIQUENESS_PUT_PATCH.md) | Group displayName uniqueness on PUT/PATCH |
| [G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md](G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md) | Write-response attribute projection |
| [G8H_PRIMARY_ATTRIBUTE_ENFORCEMENT.md](G8H_PRIMARY_ATTRIBUTE_ENFORCEMENT.md) | Primary sub-attribute enforcement (RFC 7643 S2.4) - tri-state config |
| [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md) | Per-endpoint credentials - 3-tier auth chain |
| [PHASE_09_BULK_OPERATIONS.md](PHASE_09_BULK_OPERATIONS.md) | Bulk operations (RFC 7644 S3.7) |
| [PHASE_10_ME_ENDPOINT.md](PHASE_10_ME_ENDPOINT.md) | /Me endpoint (RFC 7644 S3.11) |
| [PHASE_12_SORTING_AND_DEDUP.md](PHASE_12_SORTING_AND_DEDUP.md) | Sorting + service deduplication |
| [READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md](READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md) | ReadOnly attribute stripping & warning headers |
| [MANAGER_PATCH_STRING_COERCION.md](MANAGER_PATCH_STRING_COERCION.md) | Manager PATCH string coercion - complex attribute relaxation |
| [PATCH_SCALAR_BOOLEAN_COERCION.md](PATCH_SCALAR_BOOLEAN_COERCION.md) | PATCH scalar boolean string coercion - Entra ID SCIM Validator fix |
| [P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md](P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md) | Attribute characteristic enforcement (Phase P2) |
| [P3_REMAINING_ATTRIBUTE_CHARACTERISTIC_GAPS.md](P3_REMAINING_ATTRIBUTE_CHARACTERISTIC_GAPS.md) | Remaining characteristic gaps (Phase P3) |

## Attribute Characteristics & RFC Audits

| Document | Description |
|----------|-------------|
| [P5_RFC_SCHEMA_PRESET_COMPLIANCE_AUDIT.md](P5_RFC_SCHEMA_PRESET_COMPLIANCE_AUDIT.md) | **Latest (v0.40.0)** - RFC-verified schema/preset audit, 55 characteristic fixes |
| [P4_ATTRIBUTE_CHARACTERISTIC_DEEP_ANALYSIS.md](P4_ATTRIBUTE_CHARACTERISTIC_DEEP_ANALYSIS.md) | **v0.37.0** - source-verified gap analysis |
| [ATTRIBUTE_CHARACTERISTICS_GAPS.md](ATTRIBUTE_CHARACTERISTICS_GAPS.md) | Gap matrix - characteristic enforcement status |
| [RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md](RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md) | Full RFC 7643 attribute characteristic audit |
| [RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md](RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md) | Attribute characteristics analysis |

## Testing & Validation

| Document | Description |
|----------|-------------|
| [SCIM_VALIDATOR_RESULTS_32_LEXMARK_ANALYSIS.md](SCIM_VALIDATOR_RESULTS_32_LEXMARK_ANALYSIS.md) | SCIM Validator #32 - Lexmark schema analysis |
| [VALIDATOR_RUN32_FALSE_POSITIVE_ANALYSIS.md](VALIDATOR_RUN32_FALSE_POSITIVE_ANALYSIS.md) | Successful false positive analysis |
| [TESTING-WORKFLOW.md](TESTING-WORKFLOW.md) | Test pyramid - unit, E2E, live, and ISV-specific tests |
| [LIVE_TEST_NORMS_AND_BEST_PRACTICES.md](LIVE_TEST_NORMS_AND_BEST_PRACTICES.md) | Live test conventions - section naming, result tracking |
| [TEST_INVENTORY.md](TEST_INVENTORY.md) | Test file inventory with coverage scope |
| [TEST_FAILURE_ANALYSIS.md](TEST_FAILURE_ANALYSIS.md) | Test failure root cause analysis |
| [SELF_IMPROVING_TEST_HEALTH_PROMPT.md](SELF_IMPROVING_TEST_HEALTH_PROMPT.md) | AI-assisted test health monitoring prompt |
| [PROMPT_LOGGING_VERIFICATION.md](PROMPT_LOGGING_VERIFICATION.md) | Self-improving logging audit - 71-check verification prompt |
| [PROMPT_ERROR_HANDLING_VERIFICATION.md](PROMPT_ERROR_HANDLING_VERIFICATION.md) | Self-improving error handling audit - 55-check verification prompt |

## Issues, Audits & Root Cause Analysis

| Document | Description |
|----------|-------------|
| [DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md](DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md) | Security, SOLID, DRY, DTO, data integrity, RFC gaps, 25-item roadmap |
| [CROSS_CUTTING_CONCERN_AUDIT.md](CROSS_CUTTING_CONCERN_AUDIT.md) | Cross-cutting concern audit |
| [LOGGING_ERROR_HANDLING_QUALITY_AUDIT.md](LOGGING_ERROR_HANDLING_QUALITY_AUDIT.md) | Quality audit - 20-gap register, source-verified |
| [LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md](LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md) | Error handling architecture - error catalog, Mermaid diagrams |
| [ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md](ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md) | Historical bug log with RCA and resolution |
| [POST_V034_CHANGES_ROOT_CAUSE_ANALYSIS.md](POST_V034_CHANGES_ROOT_CAUSE_ANALYSIS.md) | Post-v0.34.0 - 26 commits, 12 issues, N+1 fix |
| [AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md](AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md) | Azure-specific deployment troubleshooting |

## Requirements & Compliance

| Document | Description |
|----------|-------------|
| [TECHNICAL_REQUIREMENTS_DOCUMENT.md](TECHNICAL_REQUIREMENTS_DOCUMENT.md) | Original requirements specification |
| [REPO_API_UNDERSTANDING_BASELINE.md](REPO_API_UNDERSTANDING_BASELINE.md) | API understanding baseline |

## Context & Session Files

| Document | Description |
|----------|-------------|
| [CONTEXT_INSTRUCTIONS.md](CONTEXT_INSTRUCTIONS.md) | AI session context - architecture, file map, conventions |
| [Session_starter.md](../Session_starter.md) | Session memory - progress log, decisions, discoveries |
| [INNOVATION_AND_AI_COMPREHENSIVE_REPORT.md](INNOVATION_AND_AI_COMPREHENSIVE_REPORT.md) | Innovation and AI comprehensive report |

## API Examples & Artifacts

| Artifact | Location | Description |
|----------|----------|-------------|
| OpenAPI Spec | [openapi/](openapi/) | OpenAPI 3.0 spec - all 84 endpoints, full schemas |
| Postman Collection | [postman/](postman/) | Importable Postman collection - all 84 endpoints, 14 folders |
| Insomnia Collection | [insomnia/](insomnia/) | Importable Insomnia workspace - all 84 endpoints, 14 folders |
| Example JSONs | [examples/](examples/) | Request/response samples for all resource types |
| Extension Examples | [examples/endpoint/](examples/endpoint/) | One-click endpoint+extension combos |
| Mermaid Diagrams | [create-user-sequence.mmd](create-user-sequence.mmd) | Sequence diagrams |

## Archived Documentation

| Location | Description |
|----------|-------------|
| [archive/](archive/) | Superseded docs preserved for historical context |

---

## Current Test Counts (v0.40.0)

| Suite | Suites | Tests | Status |
|-------|--------|-------|--------|
| Unit | 84 | 3,429 | All pass |
| E2E | 54 | 1,149 | All pass |
| Live (main) | 60 sections | ~817 | All pass |
| Live (Lexmark ISV) | 13 sections | 112 | All pass |
| **Total** | **~211** | **~5,507** | **All pass** |

---

## Source-of-Truth Files

These are the definitive source files for key aspects of the system:

| Aspect | File |
|--------|------|
| Database schema | [api/prisma/schema.prisma](../api/prisma/schema.prisma) |
| App bootstrap | [api/src/main.ts](../api/src/main.ts) |
| Root module | [api/src/modules/app/app.module.ts](../api/src/modules/app/app.module.ts) |
| Auth guard (3-tier) | [api/src/modules/auth/shared-secret.guard.ts](../api/src/modules/auth/shared-secret.guard.ts) |
| Config flags | [api/src/modules/endpoint/endpoint-config.interface.ts](../api/src/modules/endpoint/endpoint-config.interface.ts) |
| Profile types | [api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts](../api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts) |
| Built-in presets | [api/src/modules/scim/endpoint-profile/presets/](../api/src/modules/scim/endpoint-profile/presets/) |
| Schema validator | [api/src/domain/validation/schema-validator.ts](../api/src/domain/validation/schema-validator.ts) |
| SCIM constants | [api/src/modules/scim/utils/scim-constants.ts](../api/src/modules/scim/utils/scim-constants.ts) |
| Filter parser | [api/src/modules/scim/filters/scim-filter-parser.ts](../api/src/modules/scim/filters/scim-filter-parser.ts) |
| Patch engines | [api/src/domain/patch/](../api/src/domain/patch/) |
| Live tests | [scripts/live-test.ps1](../scripts/live-test.ps1) |
| Azure deployment | [scripts/deploy-azure.ps1](../scripts/deploy-azure.ps1) |
| Dockerfile | [Dockerfile](../Dockerfile) |
| Docker Compose | [docker-compose.yml](../docker-compose.yml) |
