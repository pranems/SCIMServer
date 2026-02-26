## SCIMServer – Condensed Session Memory

This file intentionally trimmed for clarity. Full historic log kept in git history.

### Recent Key Achievements (Chronological)
| Date | Achievement |
|------|-------------|
| 2026-02-26 | ✅ **G8b — Custom Resource Type Registration (v0.18.0):** Data-driven extensibility beyond User/Group. Per-endpoint `CustomResourceTypesEnabled` config flag (default: false). Admin API (POST/GET/GET/:name/DELETE/:name) at `/admin/endpoints/:endpointId/resource-types`. Generic SCIM CRUD controller with wildcard `:resourceType` routing (registered LAST in module). `GenericPatchEngine` for JSONB-based PATCH with URN-aware paths. `EndpointResourceType` DB table with cascade-delete. `ScimSchemaRegistry` enhanced with per-endpoint resource type overlay. Reserved name/path protection. 15 new implementation files, 6 modified files. Created `docs/G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md`. **2,277 unit (67 suites), 411 E2E (21 suites), 20 new live tests — all passing.** |
| 2026-02-25 | ✅ **G8e — Response `returned` Characteristic Filtering (v0.17.4):** Two-layer RFC 7643 §2.4 compliance: (1) Service layer strips `returned:'never'` in `toScim*Resource()` for ALL responses (POST/PUT/PATCH/GET/LIST). (2) Controller layer strips `returned:'request'` via enhanced `applyAttributeProjection()` for read ops, direct stripping for write ops. Added `password` to User schema constants (`returned:'never'`, `mutability:'writeOnly'`). Added `SchemaValidator.collectReturnedCharacteristics()`, `stripReturnedNever()` export, `getRequestOnlyAttributes()` on both services. 40 new unit + 8 E2E tests (service-level + controller-level + projection + validator). Created `docs/G8E_RETURNED_CHARACTERISTIC_FILTERING.md`. Gap G8e: ✅ CLOSED. **2,156 unit (61 suites), 382 E2E (20 suites) — all passing.** |
| 2026-02-25 | ✅ **G8c — PATCH readOnly Pre-Validation (v0.17.3):** Implemented readOnly mutability enforcement in `SchemaValidator.validatePatchOperationValue()` — rejects PATCH add/replace/remove on readOnly attributes (e.g., `groups`) with 400. Added `resolveRootAttribute()` for value-filter paths. Added `groups` attribute to `USER_SCHEMA_ATTRIBUTES` (RFC 7643 §4.1 — was missing entirely). Gated behind `StrictSchemaValidation`. 25 new unit tests + 7 new E2E tests. Created `docs/G8C_PATCH_READONLY_PREVALIDATION.md`. Gap G8c: ✅ CLOSED. **2,116 unit (61 suites), 374 E2E (19 suites), 334/334 live — all passing.** |
| 2026-02-25 | ✅ **Parallel E2E Test Execution:** Removed `resetDatabase()` from 17 E2E specs, switched to worker-prefixed fixtures (`w${JEST_WORKER_ID}-`) and dynamic endpoint names for test isolation. Updated `global-teardown.ts` to PostgreSQL TRUNCATE. Increased `maxWorkers` from 1→4. E2E runtime dropped from ~64s→~22s (65% faster). Updated `docs/MIGRATION_PLAN_CURRENT_TO_IDEAL_v3` gap table (17 gaps marked resolved), heat map, phase overview. Comprehensive doc staleness audit across README, CONTEXT_INSTRUCTIONS, Session_starter, CHANGELOG, package.json. **2,096 unit (61 suites), 368 E2E (19 suites), 334/334 live — all passing.** |
| 2026-02-25 | ✅ **externalId CITEXT→TEXT (RFC 7643 §3.1 caseExact compliance):** Changed `externalId` column from `@db.Citext` to `@db.Text` in Prisma schema. Added `'text'` column type to filter engine — `co`/`sw`/`ew` operators on `text` columns are now case-sensitive (no `mode: 'insensitive'`). Migration: `20260225181836_externalid_citext_to_text`. Updated 5 E2E, 5 unit, 4 live tests. Created `docs/EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md` (350+ lines). Resolved gap G8f. **2,096 unit (61 suites), 368 E2E (19 suites), 334/334 live — all passing, 0 known failures.** |
| 2026-02-25 | ✅ **v0.17.2 — AllowAndCoerceBooleanStrings + ReprovisionOnConflict + Soft-Delete deletedAt + In-Memory Support + RFC Fixes:** (1) Implemented `AllowAndCoerceBooleanStrings` config flag (default `true`) — coerces boolean-typed string values ("True"/"False") to native booleans before schema validation on all write paths. Schema-aware: only coerces attributes whose schema type is "boolean" (V16/V17 fix). Fixes all 17 SCIM Validator #26 failures. Added `getConfigBooleanWithDefault()` helper. (2) Implemented `ReprovisionOnConflictForSoftDeletedResource` config flag (default `false`) — when enabled alongside SoftDeleteEnabled, POST conflicts with soft-deleted resources re-activate the existing resource (clears `deletedAt`, sets `active=true`, replaces payload) instead of 409. 10th boolean flag. (3) Soft-delete now tracks `deletedAt` timestamp — guard uses `deletedAt != null` (not `active === false`) to distinguish soft-deleted from PATCH-disabled resources. New Prisma column: `deletedAt DateTime? @db.Timestamptz`. Domain models updated: `UserRecord`, `GroupRecord`, `UserUpdateInput`, `GroupUpdateInput`, `UserConflictResult`. (4) Group `active` field — Groups now include `active: boolean` in domain models and SCIM responses. (5) In-memory persistence for `EndpointService` and `LoggingService` — both detect `PERSISTENCE_BACKEND=inmemory` and use in-memory stores instead of Prisma. (6) Resource-type-aware attribute projection — `displayName` always-returned only for Groups per RFC 7643. (7) externalId case sensitivity — per RFC 7643 §2.4 `caseExact: true`, case-variant externalId values are distinct. (8) New `SchemaValidator.collectBooleanAttributeNames()` + `validateFilterAttributePaths()` (V32). (9) New `scim-filter-parser.ts` for filter AST attribute extraction. (10) Startup warning when StrictSchemaValidation is OFF. Created `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md` — all 10 boolean flags + logLevel documented. **2063 unit tests (61 suites), 358 E2E tests (19 suites), 334/334 live tests — all passing on both local and Docker in-memory instances.** |
| 2026-02-24 | 📚 **Documentation Staleness Audit & Bulk Update (v0.17.1):** Comprehensive audit of 14+ documentation files against ground truth (1962 unit/59 suites, 342 E2E/19 suites, 318 live, SchemaValidator 816 lines, PostgreSQL 17, version-based ETags). Fixed ~73 stale items: README (version, architecture diagram SQLite→PostgreSQL, test counts), CHANGELOG (added v0.17.1 + v0.17.1-fix1 entries), CONTEXT_INSTRUCTIONS (12 fixes: SQLite→PostgreSQL, service line counts, Prisma models, test counts, gotchas), SCIM_COMPLIANCE (ETag 95→100%, compliance 95→96%, new v0.17.1 section), COMPLETE_API_REFERENCE (ETag format, version), DEPLOYMENT (Docker Compose rewritten with postgres:17-alpine), TESTING-WORKFLOW, REPO_API_UNDERSTANDING_BASELINE, DOCKER_GUIDE_AND_TEST_REPORT, STORAGE_AND_BACKUP (marked historical), PHASE_08_SCHEMA_VALIDATION, PHASE_08_REMAINING_ANALYSIS, INDEX. Bumped `api/package.json` to 0.17.1. |
| 2026-02-24 | ✅ **V2-V31 Adversarial Validation Gap Closure (commit 1ae3453):** Closed 30 of 33 adversarial validation gaps with schema + patch + DTO hardening. `SchemaValidator` grew from 594→816 lines: added `canonicalValues` enforcement, string/array size limits (`maxStringLength`, `maxArrayLength`), payload size limit (`maxPayloadSize`), `uniqueness` checking, deep sub-attribute recursion fixes. DTO hardening: `SearchRequestDto` (filter length, startIndex/count range), `CreateUserDto`/`PatchUserDto`/`CreateGroupDto`/`PatchGroupDto` (class-validator decorators). Patch engine limits: `maxPatchOps` (100), `maxPatchValueSize` (100KB). 5 new test files (2853 lines): `schema-validator-adversarial.spec.ts`, `schema-validator-edge-cases.spec.ts`, `dto-validation.spec.ts`, `patch-engine-hardening.spec.ts`, `group-patch-engine-hardening.spec.ts`. **1962 unit tests (59 suites) — all passing.** |
| 2026-02-24 | ✅ **H-1 & H-2 — PATCH Validation + Immutable Enforcement:** Implemented `SchemaValidator.checkImmutable()` — pure domain method for RFC 7643 §2.2 immutable attribute enforcement (old-vs-new comparison). Added post-PATCH `SchemaValidator.validate()` in both user and group services (H-1). Added `checkImmutable()` calls in PUT + PATCH for both services (H-2). Refactored `validatePayloadSchema()` to support `'patch'` mode. Added `buildSchemaDefinitions()` and `buildExistingPayload()` shared helpers. Added 14 new `checkImmutable` unit tests (schema-validator.spec.ts). Created `docs/H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md` — architecture analysis, design deliberation, implementation plan. Updated gaps doc, INDEX.md. All gated behind `StrictSchemaValidation` flag. **1711 unit tests (54 suites) — all passing.** |
| 2026-02-24 | 🔄 **Adversarial Gap Reanalysis (33→28 open):** Reanalyzed all 33 validation gaps against latest codebase (1711 unit tests, 54 suites). **2 RESOLVED:** V4 (payload size — `json({ limit: '5mb' })` in `main.ts`), V8 (immutable enforcement — `SchemaValidator.checkImmutable()` + service integration). **3 PARTIALLY FIXED:** V2 (post-PATCH `validatePayloadSchema()` added but input values still not pre-validated), V9 (sub-attr type checking works but required sub-attr enforcement missing), V25 (core schema URN presence checked but no format/duplicate validation). **28 STILL OPEN.** Updated `PHASE_08_REMAINING_ANALYSIS.md` §7.5 with status columns, reanalysis section, revised effort estimates (~27-35 hrs). Updated Migration Plan gaps G8d (✅ resolved), G8g (V4 resolved), heat map. |
| 2026-02-24 | 📊 **Adversarial Client Validation Gap Analysis (33 Gaps):** Comprehensive security/validation audit of SchemaValidator, PatchEngine, DTOs, filter parser, and service layer assuming adversarial SCIM clients (not just Entra ID). Identified **33 validation gaps** (8 HIGH, 12 MEDIUM, 13 LOW): schema validation disabled by default, PATCH ops bypass schema validation, prototype pollution risk, required sub-attrs not checked, `canonicalValues` not enforced, filter parser no recursion depth limit, `sanitizeBooleanStrings` corrupts data, group `id` client-assignable, `dateTime` permissive. Root cause: (1) validation opt-in by default, (2) PATCH bypasses all schema checks. Mapped to sub-phases 8.5-8.8. Documented in `PHASE_08_REMAINING_ANALYSIS.md` §7.5 and migration plan gaps G8g-G8i. |
| 2026-02-24 | 📊 **RFC Attribute Characteristics Gap Analysis:** Created comprehensive `docs/RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md` — 10 sections with Mermaid diagrams analyzing all 11 RFC 7643/7644 attribute characteristics (type, multiValued, required, mutability, returned, uniqueness, caseExact, canonicalValues, referenceTypes, description, subAttributes) against current project implementation. Identified **15 gaps (G1-G15)** with severity ratings, HTTP request/response examples, DB value representations, and remediation code snippets. Defined **sub-phases 8.1-8.5** for remaining attribute characteristic enforcement (~22-30 hours estimated). Updated Migration Plan v3 with new gaps (G8c-G8f), Phase 8 completion status, and sub-phase timeline. Updated docs INDEX with new entries. |
| 2026-02-24 | ✅ **Phase 8 — Schema Validation Engine Tests — COMPLETE (v0.17.0):** Created `SchemaValidator` domain class (383 lines) + `validation-types.ts` (70 lines) for pure RFC 7643 payload validation. Added **247 new tests**: 179 comprehensive unit tests (`schema-validator-comprehensive.spec.ts`, 20 describe blocks covering all 8 SCIM types, mutability, required attrs, unknown attrs, extensions, sub-attrs, multi-valued, edge cases), 19 service-level tests (11 Users + 8 Groups), 49 E2E tests (`schema-validation.e2e-spec.ts`, 14 sections). Key discovery: NestJS `ValidationPipe` with `enableImplicitConversion: true` coerces DTO-declared properties before schema validator runs — documented in E2E §13-§14. Final counts: **1685 unit (54 suites), 342 E2E (19 suites), 318 live** — all passing. Docker rebuilt and verified. |
| 2026-02-24 | ✅ **Phase 7 — ETag & Conditional Requests — COMPLETE (v0.16.0):** Replaced timestamp-based ETags (`W/"<ISO>"`) with version-based monotonic ETags (`W/"v{N}"`). Added pre-write `enforceIfMatch()` in both user and group services (412 on mismatch). New `RequireIfMatch` per-endpoint config flag (428 on missing header when enabled). Atomic version increment via `version: { increment: 1 }` in Prisma repos, `(existing.version ?? 1) + 1` in InMemory repos. Simplified ETag interceptor to read-side only (ETag header + If-None-Match→304). Added `version: number` to `UserRecord` and `GroupRecord`. Controllers extract `If-Match` header, pass to services. 19 files changed (617 insertions, 53 deletions). **41 new tests:** 24 unit (13 user + 11 group: If-Match match/mismatch/428/wildcard + ETag format) + 17 E2E (version format, If-Match enforcement, RequireIfMatch). Final counts: **1429 unit (52 suites), 293 E2E (18 suites)** — all passing. Phase doc: `docs/phases/PHASE_07_ETAG_CONDITIONAL_REQUESTS.md`. Gaps resolved: G7 (HIGH), G13 (MEDIUM). |
| 2026-02-23 | 🧪 **v0.15.0 Test Expansion — COMPLETE:** Added 59 new tests (34 unit + 25 E2E) for soft-delete, config flag combinations, and PATCH path patterns. **Unit tests:** 12 user service (soft-delete GET/LIST/filter, config combos), 8 group service (soft-delete interactions, flag combos), 14 user-patch-engine (soft-deleted PATCH, valuePath patterns, dot-notation combos). **E2E tests:** New `soft-delete-flags.e2e-spec.ts` — SoftDeleteEnabled Users (6), Groups (3), PATCH on soft-deleted users (4), config flag combinations (5), StrictSchemaValidation (3), PATCH path patterns (4). Fixed 2 pre-existing discovery-endpoints E2E failures (schema count assertions stale after custom extension URNs). Fixed `package.json` version 0.13.0→0.15.0. Fixed live-test parameter name mismatch (`-ClientSecret` not `-OAuthSecret`). Added 3 new issues (#9-#11) to RCA doc. Final counts: **1405 unit (52 suites), 276 E2E (18 suites), 318 live** — all passing. Updated CHANGELOG, INDEX, Session_starter, ISSUES_BUGS_ROOT_CAUSE_ANALYSIS. |
| 2026-02-23 | 📝 **Phase 8 Part 2 — Custom Resource Type Registration — DOCUMENTED:** Designed and documented comprehensive Phase 8.2 (Custom Resource Type Registration) in migration plan and architecture v3 docs. Covers: `EndpointResourceType` DB model + Prisma migration, `ENDPOINT_RESOURCE_TYPE_REPOSITORY` token + interface + Prisma/InMemory implementations, `ScimSchemaRegistry.registerResourceType()` with per-endpoint overlay + hydration, Admin API `POST/GET/DELETE /admin/endpoints/:id/resource-types`, `customResourceTypesEnabled` config flag (default false), generic wildcard `EndpointScimGenericController` (catches `:resourceType` after dedicated User/Group controllers), `EndpointScimGenericService` with JSONB-only storage + schema-guided validation, `GenericPatchEngine` for JSONB payloads, JSONB-only filter fallback. Full request/response examples, Mermaid sequence/architecture diagrams, discovery impact examples, runtime impact assessment, ~105 test plan, ~9 day effort estimate. Updated: migration plan (TOC, gap table G8b, phase overview, timeline, Gantt, dependency graph P8b node, deployment matrix, summary table), architecture v3 (config flag matrix, ER diagram columns, API route map with admin + generic routes, Appendix B.7b examples). No code changes — documentation only. |
| 2026-02-23 | ✅ **Phase 6 — Data-Driven Discovery — COMPLETE (v0.14.0):** Centralized all SCIM discovery endpoints into injectable `ScimDiscoveryService`, replacing ~280 lines of hardcoded JSON across 4 controllers. Added Enterprise User Extension schema (RFC 7643 §4.3) to `/Schemas` (3 schemas, was 2). Enterprise extension declared on User ResourceType. Dynamic `schemas[]` in User responses (G19). `meta` object on ServiceProviderConfig (RFC 7644 §4). Centralized `KNOWN_EXTENSION_URNS` (G16). Removed 7 dead config flags (G20). Rich RFC 7643 schema constants with full attribute definitions. Full validation: **1171/1171 unit tests** (47 suites, +36 new), **196/196 E2E tests** (15 suites, +3 new). Phase doc: `docs/phases/PHASE_06_DATA_DRIVEN_DISCOVERY.md`. |
| 2026-02-21 | ✅ **Phase 5 — Domain-Layer PATCH Engine — COMPLETE (v0.13.0):** Extracted inline SCIM PATCH logic into pure-domain `UserPatchEngine` (~290 lines) and `GroupPatchEngine` (~240 lines) with zero NestJS/Prisma dependencies. Created `PatchError` domain error class, typed `PatchConfig`/`GroupMemberPatchConfig` interfaces, barrel export. Refactored both services to thin orchestrators (34%/31% line reduction). Added 73 new unit tests (36+37). Full validation: **984/984 unit tests** (29 suites), **193/193 E2E tests** (15 suites). Docker build + container healthy. Phase doc: `docs/phases/PHASE_05_PATCH_ENGINE.md`. |
| 2026-02-21 | 🧪 **Comprehensive Test Gap Analysis & Expansion:** Identified 19 untested source files (59.6% gap rate). Created 14 new test files: `PatchError`, `createScimError`, `buildBaseUrl`, `ScimMetadataService`, `OAuthService` (16 tests), `OAuthController`, `SharedSecretGuard` (11 tests), `ScimAuthGuard`, `RequestLoggingInterceptor`, `ServiceProviderConfigController`, `ResourceTypesController`, `SchemasController`, `DatabaseController`, `AdminController` (18 tests), `WebController`. **Tests: 1135/1135 unit (46 suites) + 193/193 E2E (15 suites). +151 net new tests, +17 new suites.** |
| 2026-02-21 | ✅ **Phase 4 Verification Complete (v0.12.0):** Fixed `displayName` column population (create/replace/patch now write first-class DB column). No-cache Docker rebuild (`scimserver:latest` v0.12.0). Full validation: **911/911 unit tests** (29 suites), **193/193 E2E tests** (15 suites), **302/302 live tests** (Docker container). CHANGELOG Verified section added. |
| 2026-02-21 | 🔍 **Phase 4 — Filter Push-Down Expansion — COMPLETE:** Expanded SCIM filter push-down from eq-only on 3 columns to all 10 operators (eq/ne/co/sw/ew/gt/ge/lt/le/pr) on 5 columns (userName, displayName, externalId, scimId, active). Added column type annotations (citext/varchar/boolean/uuid) for operator validation. Implemented compound AND/OR recursive push-down. Created `prisma-filter-evaluator.ts` for InMemory backend parity. Updated InMemory user/group repos to use shared `matchesPrismaFilter()`. Comprehensive test updates: filter tests verify DB push-down for previously in-memory operators. Created Phase 4 docs. CHANGELOG updated to v0.12.0. |
| 2026-02-21 | ✅ **Full Validation Pipeline Re-Run (Clean Build + Local + Docker):** Completed clean API rebuild and full E2E verification (**193/193 passing**). Ran local instance live validation with latest flow-trace script (**302/302 passing**). Performed no-cache Docker rebuild (`scimserver:latest`), started container against host PostgreSQL, and ran full live suite again (**302/302 passing**). Updated changelog verification status to reflect fully green live matrix. |
| 2026-02-20 | 🌐 **Root SPA + Test Trace JSON Enhancements:** Refreshed root SPA static bundle sync (`web/dist` → `api/public`) to eliminate stale hashed asset mismatch and ensure `/` renders correctly in latest repo state. Added root non-SPA fallback section with quick links (version endpoint, recent logs, README, docs index). Enhanced E2E + live test JSON outputs with step-level flow tracing (request method/url/headers/body, response status/headers/body, timing, action-step IDs linked to assertions). Validated runs: live tests now **302/302 passed** with `totalFlowSteps` and per-test `actionStepIds` in `test-results/live-results-latest.json`; E2E JSON includes `flowSteps` and linked `actionStepIds` in `test-results/e2e-results-latest.json`. |
| 2026-02-21 | 🔧 **Version Endpoint Enhancement (Issue 19):** Added `container` block (app id/name/image/runtime/platform + database host/port/name/provider) when containerized, `utcOffset` field (`±HH:MM`), fixed `maskSensitiveUrl()` to mask userinfo in connection strings (`://user:pass@` → `://***:***@`). Updated web client `VersionInfo` type (sqlite→postgresql + new fields). E2E tests updated with `utcOffset` regex + userinfo masking assertions. SCIM Validator verified: **25/25 passed + 7 preview, 0 false positives** (all 4 previous FPs confirmed fixed). Updated docs: version-latest.json/html, COMPLETE_API_REFERENCE.md, SCIM_VALIDATOR_FALSE_POSITIVES_REPORT.md, PHASE_03_ISSUES_AND_RESOLUTIONS.md. All tests green: **862 unit** (28 suites), **193 E2E** (15 suites). |
| 2026-02-21 | 🔍 **False Positive Test Audit (Issue 18):** Comprehensive audit of all 1,357 tests across 3 levels. Found and fixed 29 false positives: 8 E2E (tautological assertions, empty-loop skips, conditional guards, overly permissive assertions across 5 files), 10 unit (weak `toBeDefined` assertions, no-assertion tests in 2 files), 11 live (hardcoded `$true`, unguarded deletes, vacuously-true loops in `live-test.ps1`). All tests validated green: **862 unit** (28 suites), **193 E2E** (15 suites). Updated 10 source files + 6 documentation files. |
| 2026-02-21 | �🐛 **SCIM ID Leak Fix + Comprehensive Test Coverage (Issues 16-17):** Fixed critical SCIM ID leak bug (client-supplied `id` in POST/PATCH body could override server-assigned `scimId` via `rawPayload` spread). Added `'id'` to `stripReservedAttributes()` reserved set. Updated version endpoint for Phase 3 (removed blob fields, added `persistenceBackend`, `connectionPool`, `migratePhase`). Bumped to v0.11.0. Added 24 new tests: 5 unit tests (ID leak prevention in create/get/patch), 4 E2E tests (POST/PUT/PATCH with client id, GET by server id), 15 live tests (Section 3e). All validation passed: **862 unit tests** (28 suites), **193 E2E tests** (15 suites), **301/302 live tests** on both local server + Docker container (1 pre-existing failure). Updated PHASE_03_ISSUES_AND_RESOLUTIONS.md (Issues 16-17) and PHASE_03_POSTGRESQL_MIGRATION.md (test counts, known issues). |
| 2026-02-21 | 🏗️ **Phase 1 Repository Pattern — COMPLETE:** Extracted full Repository Pattern abstraction from Prisma-direct services. Created 10 new files: domain models (`UserRecord`, `GroupRecord`, `MemberRecord`, `GroupWithMembers`), repository interfaces (`IUserRepository`, `IGroupRepository`), string tokens, Prisma implementations (thin wrappers), in-memory implementations (`Map`-based with secondary indexes), and `RepositoryModule.register()` dynamic module with `PERSISTENCE_BACKEND` env toggle (`prisma` default / `inmemory`). Refactored both SCIM services (`endpoint-scim-users.service.ts`, `endpoint-scim-groups.service.ts`) to use `@Inject(TOKEN)` pattern — zero Prisma imports remain in service layer. Transformed both spec files (~3000 lines total) from `mockPrismaService` to flat repository mocks with context-dependent method mapping. Updated filter module to `Record<string, unknown>`. All verification passed: 666 unit tests (19 suites), 184 e2e tests (15 suites), Docker build + container live tests (admin API, user CRUD, group with member, list operations). |
| 2026-02-20 | � **Migration Automation Strategy Doc:** Created comprehensive `docs/MIGRATION_AUTOMATION_STRATEGY_v1_2026-02-20.md` — 14-section automation analysis covering both PostgreSQL + In-Memory migration paths. Includes full codebase inventory (46 Prisma call sites across 4 services mapped to repository methods), per-phase automation assessment heatmap (60-95% automatable), AI vs Human effort breakdown tables, Copilot Agent session workflow with exact prompt templates, 2-developer parallel execution plan with conflict-free ownership matrix, risk quadrant chart with 8 risks + mitigations, CI pipeline changes for dual-driver testing, quality gate verification workflow, complete Prisma call-site inventory (4 appendix tables), generated file map (31 new + 17 modified files). Timeline: manual 16 weeks → automated 5-6 weeks for both paths (65% reduction). 12 Mermaid diagrams. |
| 2026-02-20 | �🧠 **In-Memory Architecture & Plan Doc:** Created comprehensive `docs/INMEMORY_ARCHITECTURE_AND_PLAN_v1_2026-02-20.md` — 16-section combined architecture, comparison, and migration plan for in-memory (`Map`-based) repository implementation. Includes full PostgreSQL vs In-Memory comparison matrices (feature parity, performance, operational), `InMemoryStore` with secondary indexes, complete `InMemoryResourceRepository`/`InMemoryMembershipRepository`/`InMemoryTenantRepository` implementations, filter/sort/pagination comparison, ETag/concurrency analysis, optional snapshot persistence, decision framework flowchart, 12-phase effort comparison (37% less LOC than PostgreSQL path), side-by-side code examples, 14 Mermaid diagrams, and deployment topology differences. |
| 2026-02-20 | 🚢 **Deployment Modes Analysis:** Added comprehensive Section 17 to Migration Plan v3 — 10 subsections covering all 4 deployment modes (Local Dev, Docker Debug, Docker Production, Azure Container Apps). Includes full file inventory, per-phase impact matrix, Phase 3 PostgreSQL diff-level changes for every deployment artifact (Dockerfile WASM reversal, entrypoint simplification, Bicep rewrite, new `postgresql.bicep`), Dockerfile consolidation plan (5→2), post-migration env var matrix, deployment testing strategy, and 10-step Azure cutover sequence with rollback plan. |
| 2026-02-20 | 🧭 **Architecture v3 + Migration Plan v3:** Deep re-analysis of all 28+ API source files, then created two comprehensive v3 design documents: `docs/IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md` (18 sections: layered N-tier architecture, unified `scim_resource` table with `resource_type` discriminator, PostgreSQL JSONB/CITEXT/GIN schema, data-driven discovery via `tenant_schema`/`tenant_resource_type`, pure domain PatchEngine, monotonic integer ETags, Bulk/Me endpoints, per-tenant credentials, full API route map, Mermaid sequence diagrams, example JSON payloads) and `docs/MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md` (18 gaps mapped, 12 phases with dependency graph, code-level before/after examples, line-of-code impact analysis, risk matrix, critical path P1→P2→P3→P5). |
| 2026-02-20 | 🧭 **Fresh RFC-First Architecture + Migration Blueprint:** Created two new from-scratch design artifacts independent of prior drafts: `docs/IDEAL_SCIM_ARCHITECTURE_RFC_FIRST_FRESH_2026-02-20.md` (complete ideal multi-tenant SCIM architecture, dynamic discovery, schema/resource-type persistence model, flows/diagrams, RFC rationale) and `docs/CURRENT_TO_IDEAL_MIGRATION_PLAN_FRESH_2026-02-20.md` (deep current-API gap mapping and phased implementation plan with concrete file-level workstreams, examples, and rollout guidance). |
| 2026-02-19 | 🔐 **Deploy Secret Reuse on Rerun:** Enhanced `scripts/deploy-azure.ps1` to cache SCIM/JWT/OAuth secrets per `ResourceGroup + AppName` in `scripts/state/deploy-state-<rg>-<app>.json`, auto-reuse them on subsequent reruns when parameters are omitted, and persist cache immediately after prompt/validation so intermediate deployment failures do not lose initial secret inputs. |
| 2026-02-19 | 🧾 **Formatted Version Output in Deploy Summary:** Enhanced `scripts/deploy-azure.ps1` to print the verified `GET /scim/admin/version` response in a readable, formatted block at the end of deployment output (key runtime fields + full pretty JSON payload) alongside existing summary details. |
| 2026-02-19 | ✅ **Post-Deploy Runtime Verification Added:** `scripts/deploy-azure.ps1` now verifies the deployed instance by calling `GET /scim/admin/version` with bearer auth (`SCIM_SHARED_SECRET`) using retry/backoff before declaring success. Deployment now hard-fails if version endpoint never becomes ready. |
| 2026-02-19 | 🗂️ **Per-Run Deploy Logging Added:** `scripts/deploy-azure.ps1` now writes a unique local transcript log for every execution under `scripts/logs/deploy-azure-YYYYMMDD-HHMMSS.log`, capturing full console/runtime output. Failure path now also prints the log file path and closes transcript before exit. |
| 2026-02-19 | 🔁 **Wrapper Deploy Flow Aligned to Local Script:** Updated `deploy.ps1` to prefer local `scripts/deploy-azure.ps1` when running from repo, avoiding stale downloaded script behavior. This ensures current GHCR logic is used: anonymous-by-default for public image, prompt for GH credentials only when anonymous pull is unavailable (private image fallback). |
| 2026-02-19 | 🌐 **Anonymous Public GHCR Deploy Support:** Updated `scripts/deploy-azure.ps1` + `infra/containerapp.bicep` so public `ghcr.io/pranems/scimserver` images deploy without GH username/PAT prompts. GHCR auth is now strictly conditional (both username + password required), defaults to anonymous pull otherwise, and validated via deploy script run showing `GHCR Pull Mode: Anonymous (public image)` with no credential prompts. |
| 2026-02-19 | 🛡️ **Azure Deploy Failure Hardening + Root Cause Isolation:** Confirmed active subscription lacks `Microsoft.Resources/subscriptions/providers/read` (and related RG read) permissions, which blocks provider checks/deployment. Hardened `scripts/deploy-azure.ps1` to fail fast with explicit RBAC diagnostics and non-zero exit (`exit 1`) instead of silent `return` paths, and validated behavior with terminal run (now exits code 1 with actionable message). |
| 2026-02-18 | 🧠 **Repo/API Understanding Docs Update:** Performed code-verified pass over core runtime/auth/routing files (`api/src/main.ts`, OAuth/auth guard, Docker runtime + entrypoint), added a canonical implementation baseline doc (`docs/REPO_API_UNDERSTANDING_BASELINE.md`), updated docs index linkage, and corrected stale Docker guide port guidance from `:80` to current `:8080` runtime behavior. |
| 2026-02-18 | 🏷️ **Final Docs Metadata Normalization:** Completed standardized `Status / Last Updated / Baseline` header blocks for remaining weak-header docs (`docs/SCIM_VALIDATOR_FALSE_POSITIVES_REPORT.md`, `docs/STORAGE_AND_BACKUP.md`, `docs/TEST_ORGANIZATION_RECOMMENDATIONS.md`) and revalidated touched files with no markdown/editor errors. |
| 2026-02-18 | 🧭 **Diagrams + JSON Artifacts Refresh:** Repaired invalid docs JSON exports (`docs/postman/SCIM_v2_Postman_Collection.json`, `docs/openapi/SCIM_v2_openapi_full.json`), validated all `docs/**/*.json` artifacts parse cleanly, and refreshed sequence flow diagrams (`docs/create-user-sequence.mmd`, `docs/list-get-user-sequence.mmd`, `docs/USER_API_CALL_TRACE.md`) to current request-correlation and logging behavior. |
| 2026-02-18 | 📚 **Repository-Wide Docs Reorganization Pass:** Standardized core docs theme (metadata headers, onboarding-first flow, living-vs-historical labeling), corrected deployment/runtime facts (Node 24, Prisma 7 baseline, Docker port `8080`), fixed encoding artifacts in high-traffic docs, refreshed compliance/testing snapshots, and removed AI-conversational leftovers from reference documents. |
| 2026-02-18 | 📘 **README Best-Practice Reorganization:** Reworked README into a modern onboarding-first flow (why, quick start options, prerequisites, configuration, Entra setup, operations, quality status, docs index), corrected Docker run guidance to container port `8080`, and streamlined operational links for maintainability. |
| 2026-02-18 | 🧾 **README Image Removal + Text/JSON Replacement:** Removed all README image embeds (including badges) and replaced visual snapshot sections with formatted metadata table plus structured JSON samples for admin version and recent log outputs, while retaining links to captured raw JSON artifacts. |
| 2026-02-18 | 🧹 **Docs + JSON Current-State Sweep:** Normalized release-facing docs/examples to `v0.10.0`, removed remaining legacy repo naming references, refreshed OpenAPI description/version wording, and aligned long-form analysis docs to current baseline while preserving historical fix context. |
| 2026-02-18 | ✅ **Admin Version Rollout + Full Validation Pipeline:** Updated docs and API collections for expanded `GET /scim/admin/version` payload (`docs/COMPLETE_API_REFERENCE.md`, Postman/Insomnia JSON), aligned web `VersionInfo` typing, and validated end-to-end: clean builds (API + web), lint (0 errors / 74 warnings), unit (666/666), e2e (184/184), live local instance (280/280), fresh `scimserver:latest` Docker build + container live tests (280/280). |
| 2026-02-18 | 🧭 **Admin Version Endpoint Expanded:** `GET /scim/admin/version` now returns full running-instance metadata (service timing, runtime host/process/memory, auth configuration flags, storage details, deployment context) with sensitive values masked. Added e2e coverage in `api/test/e2e/admin-version.e2e-spec.ts` for auth requirement and response contract validation. |
| 2026-02-18 | 🔎 **Log Access UX Improvements:** Added easy log-access output to Azure deploy flow (`scripts/deploy-azure.ps1`) and bootstrap wrapper (`setup.ps1`) with copy/paste commands for recent, stream (SSE), and download endpoints. Added startup console hints in `api/src/main.ts` and updated deployment docs (`DEPLOYMENT.md`, `docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md`) to mirror the same quick commands. |
| 2026-02-18 | 🧪 **Test Coverage Expansion + Full Matrix Validation:** Added missing e2e coverage for `GET /scim/admin/log-config/download` and auth coverage for `GET /scim/admin/log-config/stream`; added live tests for log download formats/filters and SSE stream connectivity. Clean rebuild + full validation completed: 666 unit, 182 e2e, and 280 live tests passing on both local instance (`:6000`) and Docker latest (`:8080`). |
| 2026-02-18 | 🔧 **Remote Debugging & Diagnosis:** SSE live log tailing endpoint (`GET /stream`), log file download (`GET /download`), `scripts/remote-logs.ps1` (4-mode PowerShell script), comprehensive `docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md` (14 sections, Mermaid diagrams, curl/PS examples). 18 new unit tests (134 logging tests total). Postman v1.4 + Insomnia updated. |
| 2026-02-18 | 🚀 **v0.10.0 — Full Stack Upgrade:** Prisma 6→7 (driver adapter, prisma-client generator, prisma.config.ts), ESLint 8→10 (flat config), Jest 29→30, React 18→19, Vite 5→7. All 6 Dockerfiles updated node:22→24. 666 unit + 184 e2e + 280 live tests passing (local + Docker) |
| 2026-02-15 | 📖 **AZURE DEPLOYMENT GUIDE:** Created comprehensive `docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md` with architecture diagrams, step-by-step deployment, Entra ID setup, usage guide, troubleshooting, and cost estimates |
| 2026-02-15 | 📝 **README.md REWRITTEN:** Complete rewrite with architecture diagram, feature tables, Docker/Azure sections, documentation index, and project structure |
| 2026-02-15 | 📝 **DEPLOYMENT.md REWRITTEN:** Streamlined all deployment methods (Azure/Docker/Local) with comparison table, CI/CD pipeline info, and links to detailed guide |
| 2026-02-15 | 🔧 **VS CODE DEBUG CONFIGS:** Added `.vscode/launch.json` with 3 debug configurations (launch, launch+log, attach) and `start:debug:log` npm script |
| 2026-02-15 | ✅ **CI/CD VERIFIED:** GitHub Actions `build-test.yml` and `publish-ghcr.yml` confirmed pointing to `pranems/scimserver` |
| 2026-02-14 | 🧹 **ESLint Hardened:** `.eslintrc.cjs` updated for @typescript-eslint 8.x — 223→0 errors (8 source fixes + config overrides), 48 remaining warnings (intentional `any` + test scaffolding). `fast-xml-parser` CVE patched. |
| 2026-02-14 | 🚀 **Major Dependency Upgrade:** Node 22-alpine Docker, NestJS 10→11, Prisma 5→6, TypeScript 5.4→5.9, tsconfig targets es2022. 492 unit + 154 e2e + 212 live tests passing (local & Docker) |
| 2026-02-14 | 📝 **Docs Updated to Current State:** SCIM_COMPLIANCE (filtering 85→100%), RECOMMENDED_DESIGN_IMPROVEMENTS (§17.1 gap analysis + §18 roadmap refreshed), INDEX.md, TESTING-WORKFLOW.md |
| 2026-02-14 | 📦 **JSON Consolidation:** 32→19 JSON files (41% reduction) — merged PATCH examples, removed duplicates, fixed OpenAPI /Bulk + bulk.supported, fixed update-endpoint strictMode |
| 2026-02-11 | 📚 **Docs Consolidation:** 34→21 markdown files (~45% line reduction) — merged redundant guides, removed stale files |
| 2026-02-11 | 🔊 **Verbose Live Tests:** `live-test.ps1 -Verbose` cmdlet overrides transparently intercept all API calls; 183/183 tests at the time (later expanded to 212) |
| 2026-02-10 | ✅ **Phase 1 RFC Compliance Complete:** SCIM filter parser (10 operators + and/or/not + grouping), POST /.search, ETag/If-None-Match→304, attributes/excludedAttributes projection, centralized error handling, SCIM content-type on all responses |
| 2026-02-10 | 🧪 **492 unit tests + 183 live integration tests passing** (later expanded to 212) — all 25 Microsoft SCIM Validator tests pass (including 7 preview) |
| 2025-11-21 | 🎯 **PAGINATION FIX:** Backend-driven keepalive filtering (TDD implementation) - accurate counts, no empty pages when hideKeepalive enabled |
| 2025-11-21 | Extended executive/technical wiki created (`wiki.md`) for management evaluation |
| 2025-11-21 | Added beginner quickstart & Azure CLI prerequisites to wiki (`wiki.md`) |
| 2025-11-21 | Relocated prerequisites to top of wiki and renumbered sections for clarity |
| 2025-11-21 | Added legacy self-hosted lab reference + GitHub issues guidance to wiki (`wiki.md`) |
| 2025-11-21 | Added emoji heading refresh + optional Bicep CLI prerequisite & note to wiki (`wiki.md`) |
| 2025-10-28 | v0.8.13 tagged (direct update script envvars fix) |
| 2025-10-28 | v0.8.12 tagged (direct update script env fix) |
| 2025-10-27 | v0.8.11 tagged (direct update script auto-secrets + restart) |
| 2025-10-28 | Diagnosed prod SQLite corruption; initiated blob snapshot restore workflow |
| 2025-10-27 | v0.8.10 tagged (runtime secret enforcement + deployment script updates) |
| 2025-10-20 | OAuth module now requires JWT/OAuth secrets from environment; dev auto-generation logs warnings |
| 2025-10-20 | Azure deploy/setup scripts emit JWT & OAuth secrets and pass to Container Apps template |
| 2025-10-20 | Activity feed aggregates multiple pages when hiding keepalive checks, keeping page numbering intuitive |
| 2025-10-20 | v0.8.9 tagged (activity feed keepalive pagination fix) |
| 2025-10-20 | Activity feed pagination skips keepalive-only pages when hide toggle is on |
| 2025-10-20 | publish-ghcr workflow description updated; YAML lint passing with version 0.8.8 example |
| 2025-10-20 | v0.8.8 tagged (keepalive suppression across logs + activity metrics) |
| 2025-10-20 | Activity feed shares keepalive suppression toggle; summary metrics exclude Entra ping checks |
| 2025-10-20 | Raw log viewer can hide Entra keepalive GET pings (toggle + suppression banner) |
| 2025-10-05 | Git tag v0.8.7 created and pushed to origin (manual provisioning release) |
| 2025-10-05 | Web UI upgrade helper now strips leading 'v' from version parameter; GHCR image 0.8.7 published via workflow_dispatch |
| 2025-10-05 | Blob snapshot bootstrap added to Docker entrypoint (restores /tmp DB before migrations) |
| 2025-10-05 | Initiated SCIM duplicate handling refinement: schema uniqueness enforced & service helpers in progress |
| 2025-10-05 | Private storage endpoint rollout: VNet + DNS automation baked into deploy-azure.ps1 |
| 2025-10-05 | Deploy script now reuses existing ACA virtual network & DNS when already configured |
| 2025-10-05 | Setup auto-registers Microsoft.App & Microsoft.ContainerService providers before deployment |
| 2025-10-05 | Networking template no longer pre-delegates subnets (consumption environment compatibility) |
| 2025-10-05 | Deployment script can now reuse existing VNets/DNS by creating only missing sub-resources |
| 2025-10-05 | Interactive prompt now defaults to existing Container App name to avoid accidental redeploys |
| 2025-10-05 | Bootstrap setup script auto-detects existing app/env names per resource group |
| 2025-10-05 | Resource discovery now uses az resource list to avoid extension noise and ensure reuse |
| 2025-10-05 | Web footer fallback version synced with package.json (0.8.3) |
| 2025-10-05 | Manual provisioning console (UI + admin API) for SCIM collision testing |
| 2025-10-05 | Version bumped to v0.8.6 (blob restore bootstrap + duplicate guardrails prep) |
| 2025-10-05 | Version bumped to v0.8.5 across API + Web + docs |
| 2025-10-05 | Version bumped to v0.8.4 across web assets |
| 2025-10-04 | Backup service telemetry + blob snapshot compile fix |
| 2025-10-04 | Upgrade command now auto-fills RG/App and acknowledges blob backups |
| 2025-10-04 | Added manual GHCR publish workflow (publish-ghcr.yml) |
| 2025-10-03 | v0.8.4 released: structured membership change data (addedMembers/removedMembers) & UI rendering; case-insensitive PATCH ops. |
| 2025-10-02 | Unified image build (root Dockerfile ships API + Web) |
| 2025-10-02 | Token resilience: frontend clears bearer on 401 + modal guidance |
| 2025-10-01 | Runtime token enforcement (no build-time secrets) |
| 2025-09-30 | Hybrid storage architecture: local SQLite + timed Azure Files backups |
| 2025-09-30 | Environment / workload profile + timeout & PS5 compatibility fixes |
| 2025-09-30 | Backup route & persistence verification (v0.7.2) |
| 2025-09-28 | Favicon / activity badge system finalized |
| 2025-09-28 | PATCH Add operation fix (Entra compatibility) |
| 2025-09-27 | v0.3.0: Full SCIM 2.0 compliance baseline |

Current Version: v0.18.0 (Prisma 7 + PostgreSQL 17 + ESLint 10 + Jest 30 + React 19 + Vite 7 + Node 24 Docker)

---

## Status
Production Ready (v0.18.0) — **G8b custom resource type registration (data-driven extensibility beyond User/Group), G8e returned characteristic filtering (RFC 7643 §2.4), deep-frozen schema constants, G8c PATCH readOnly pre-validation, Parallel E2E tests (maxWorkers=4), externalId CITEXT→TEXT, AllowAndCoerceBooleanStrings, ReprovisionOnConflict, Adversarial validation hardening (V2-V31), Schema Validation Engine (Phase 8), ETag & Conditional Requests (Phase 7), soft delete, strict schema validation, custom extension URNs, PATCH schema validation (H-1), immutable attribute enforcement (H-2)** (Feb 2026). Phase 8 `SchemaValidator` domain class (950 lines) with RFC 7643 type checking (8 types), mutability enforcement (readOnly + immutable), required attr validation, unknown attr detection (strict mode), sub-attribute recursion, multi-valued array validation, extension schema validation, immutable attribute old-vs-new comparison, canonicalValues enforcement, size limits (payload/string/array), uniqueness checking, required sub-attribute enforcement, filter/PATCH hardening (MAX_FILTER_DEPTH=50, RESERVED_ATTRIBUTES). `checkImmutable()` enforces RFC 7643 §2.2 on PUT + PATCH flows. Post-PATCH `validate()` with `mode: 'patch'` catches invalid payload states. DTO hardening: SearchRequestDto, CreateUser/PatchUser, CreateGroup/PatchGroup validators with @ArrayMaxSize, @MaxLength, @IsIn guards. Version-based ETags (`W/"v{N}"`), pre-write If-Match enforcement (412 Precondition Failed), `RequireIfMatch` config flag (428 Precondition Required), atomic version increment. Centralized `ScimDiscoveryService` with RFC 7643 schema constants + 4 msfttest extension schemas. SQLite→PostgreSQL migration with unified resource table, Prisma 7 driver adapter for `pg`. Repository Pattern (`IUserRepository`/`IGroupRepository`) with `PERSISTENCE_BACKEND` env toggle. Pure-domain `UserPatchEngine`/`GroupPatchEngine`. Full SCIM filter parser (10 operators), POST /.search, ETag conditional requests, attribute projection, centralized error handling. Per-endpoint config flags (11): `SoftDeleteEnabled`, `StrictSchemaValidation`, `RequireIfMatch`, `AllowAndCoerceBooleanStrings`, `ReprovisionOnConflictForSoftDeletedResource`, `CustomResourceTypesEnabled`, multi-member PATCH, verbose PATCH, remove-all-members. 7 built-in schemas (was 3), User extensions 3 (was 1), Group extensions 2 (was 0). externalId column `@db.Text` for RFC 7643 §3.1 caseExact compliance. Parallel E2E execution (worker-prefixed fixtures, maxWorkers=4, ~22s). **2,277 unit tests (67 suites), 411 E2E tests (21 suites), 381+ live integration tests** — all passing. 25 Microsoft SCIM Validator tests passing + 7 preview (0 false positives). Full tech stack at latest: Prisma 7, PostgreSQL 17, ESLint 10, Jest 30, React 19, Vite 7, Node 24.

## Quick Commands
```powershell
# Publish latest image
pwsh ./scripts/publish-acr.ps1 -Registry scimserverpublic -ResourceGroup scimserver-rg -Latest

# Customer update to latest (example)
iex (irm 'https://raw.githubusercontent.com/pranems/SCIMServer/master/scripts/update-scimserver-direct.ps1'); Update-SCIMServerDirect -Version v0.11.0 -ResourceGroup <rg> -AppName <app> -NoPrompt

> NOTE: Direct upgrade one‑liner integrated into UI copy button; user has not yet tested the copied command end‑to‑end.
```

## Project Summary

**Purpose:** SCIM 2.0 server with Microsoft Entra provisioning integration + real-time logging UI

**Key Components:**
- ✅ NestJS SCIM 2.0 server (all operations working)
- ✅ OAuth 2.0 + Bearer token authentication
- ✅ React log viewer UI
- ✅ Dev tunnel integration for public HTTPS
- ✅ Microsoft Entra provisioning compatible

## Single Entry Point

**Main Script:** `setup.ps1`
- Test local: `.\setup.ps1 -TestLocal`
- Start tunnel: `.\setup.ps1 -StartTunnel`
- Clear instructions for Azure Portal setup

**Core Technologies:**
- Node.js 24 & TypeScript 5.9
- NestJS 11 service layer with Prisma 7 ORM (pg driver adapter)
- PostgreSQL 17 (Docker postgres:17-alpine) for persistence
- React 19 + Vite 7 frontend
- ESLint 10 (flat config) + Jest 30
- Docker (node:24-alpine) & Azure Container Apps (deployment target)

AI Assist Notes: Microsoft Docs MCP consulted for SCIM spec alignment when needed.

---

## 🔧 Technical Implementation Notes

### Pagination Fix (2025-11-21)
**Problem:** When `hideKeepalive` toggle was enabled, pagination showed incorrect counts and empty pages. Frontend filtered keepalive requests post-fetch, but backend counted all logs including keepalive, causing mismatch (e.g., "Total 1444 • Page 2 / 29" with empty visible results).

**Root Cause:** Backend `count()` included all logs; frontend filtered keepalive after pagination, resulting in:
- Inaccurate `pagination.total` and `pagination.pages`
- Empty pages when all fetched logs were keepalive requests
- Complex frontend workaround with multi-page aggregation (lines 185-230 in ActivityFeed.tsx)

**Solution (Backend-Driven Filtering):**
Implemented TDD approach with comprehensive test coverage:
1. ✅ **Tests First:** Created 9 test scenarios in `activity.controller.spec.ts`
2. ✅ **Backend Implementation:** Added `hideKeepalive` query param to:
   - `activity.controller.ts` - `/admin/activity` endpoint
   - `admin.controller.ts` - `/admin/logs` endpoint
   - `logging.service.ts` - Core logging service
3. ✅ **Prisma WHERE Clause:** Exclude keepalive using inverse logic:
   ```typescript
   OR: [
     { method: { not: 'GET' } },           // Not a GET request
     { identifier: { not: null } },        // Has an identifier
     { status: { gte: 400 } },             // Error status
     { NOT: { url: { contains: '?filter=' } } }  // No filter parameter
   ]
   ```
4. ✅ **Frontend Simplification:**
   - Removed multi-page aggregation workaround from `ActivityFeed.tsx`
   - Removed `visibleItems` useMemo filtering from `App.tsx`
   - Trust backend pagination metadata completely
   - Simplified code by ~50 lines

**Result:**
- ✅ Accurate pagination counts when `hideKeepalive=true`
- ✅ No empty pages - backend returns only non-keepalive logs
- ✅ Cleaner frontend code - trusts backend pagination
- ✅ All 9 tests passing with TDD green phase
- ✅ Works for both Activity Feed and Raw Logs views

---

## Current Focus
Phase 3 (PostgreSQL Migration) code-complete. SQLite→PostgreSQL migration with unified Resource table, Prisma 7 `pg` driver adapter, docker-compose with postgres:17-alpine. 18 issues found and resolved during migration (see `docs/phases/PHASE_03_ISSUES_AND_RESOLUTIONS.md`). 29 false-positive tests audited and fixed across all levels. All tests green: 862 unit (28 suites), 193 E2E (15 suites), 302 live (302 pass). Latest quality enhancement adds rich per-step flow traces to E2E/live JSON outputs and maps action step IDs back to each assertion.

## Next Steps / Backlog
- [x] ✅ COMPLETED - Phase 1 Repository Pattern extraction (domain models, interfaces, Prisma + in-memory implementations, RepositoryModule, service + spec refactoring)
- [x] ✅ COMPLETED - Finalize docs metadata normalization for remaining weak-header files
- [x] ✅ COMPLETED - Migrate all repo references from kayasax to pranems
- [x] ✅ COMPLETED - Create comprehensive Azure Deployment & Usage Guide (docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md)
- [x] ✅ COMPLETED - Rewrite README.md for current project state
- [x] ✅ COMPLETED - Rewrite DEPLOYMENT.md with all deployment methods
- [x] ✅ COMPLETED - Add VS Code debug configurations (.vscode/launch.json)
- [x] ✅ COMPLETED - Verify GitHub Actions workflows point to pranems/scimserver
- [ ] Validate copied direct upgrade command in production environment
- [ ] Send guidance to existing customers on the v0.8.13 direct-update changes and the need to store generated JWT/OAuth secrets
- [ ] Add rollback command generation (capture previous image tag)
- [ ] Expose deployment metadata via API endpoint (optional runtime flexibility)
- [ ] CI checks: version/tag sync, BOM detection, lockfile sync
- [ ] Parameterize backup interval & retention (env + doc)
- [ ] Add release automation (GitHub Action) for drafts on tag push
- [ ] Provide migration helper to rebuild the Container Apps environment when moving to the private VNet baseline
- [ ] Add SCIM duplicate-handling regression tests (POST + PATCH scenarios)
- [ ] Obtain Azure RBAC on target subscription (`providers/read`, `providers/register/action`, `resourceGroups/*`) or switch to a subscription with deploy rights
## 🏗️ Architecture

**SCIM 2.0 Server:**
- NestJS controllers for `/Users`, `/Groups`, `/ServiceProviderConfig`, `/Schemas`
- Full CRUD operations: POST, GET, PUT, PATCH, DELETE
- Prisma + PostgreSQL for data persistence and request logging
- Bearer token + OAuth 2.0 dual authentication

**Web UI:**
- React frontend with theme support (light/dark)
- Real-time log viewer with search, filtering, and detailed inspection
- Upgrade notifications with GitHub release integration
- Admin tools for log management and system monitoring

**Deployment:**
- Docker multi-stage build with proper permissions
- GitHub Container Registry (`ghcr.io/pranems/scimserver`, public, anonymous pull)
- Azure Container Apps for production hosting
- PowerShell automation for customer updates
- Comprehensive deployment guide: `docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md`

## Architecture Snapshot
| Date | Achievement |
|------|-------------|
| 2025-09-27 | ✅ **v0.3.0 Released** - Full SCIM 2.0 compliance + enhanced UX |
| 2025-09-27 | ✅ **Production Deployed** - Azure Container Apps updated with CORS fixes |
| 2025-09-27 | ✅ **Customer Tools** - PowerShell update function tested and working |
| 2025-09-25 | ✅ README.md created with setup & API documentation |
| 2025-09-25 | 🧪 Initial e2e test (Users create/list/get) added |
| 2025-09-25 | ✅ Logs listing endpoint & e2e test added |
| 2025-09-25 | 🎨 Frontend (React + Vite) scaffolded with log viewer |
| 2025-09-25 | 🚀 Log detail modal (headers/bodies + copy) added |
| 2025-09-25 | 🔍 Full‑text search expanded to include headers/bodies |
| 2025-09-25 | 🏷️ Identifier derivation (user/email/group displayName) implemented (ephemeral) |
| 2025-09-25 | ⚙️ Performance optimization: removed large body columns from list query |
| 2025-09-25 | 🧪 Iterated on persisted identifier column (rolled back pending stable client generation) |
| 2025-09-25 | 📉 Reduced log list latency from ~10s to sub‑second in local tests |
| 2025-09-25 | 📚 Added external exposure (tunnel) deployment guidance drafting |
| 2025-09-26 | 🚀 Azure Container Apps deployment successful - SCIM server running in production |
| 2025-09-26 | 🔧 CORS configuration added to enable web client connection to deployed API |
| 2025-09-26 | ✅ Production web UI monitoring working - full end-to-end deployment complete |
| 2025-09-26 | 🎯 **CONTAINERIZED CLIENT IMPLEMENTED** - Single URL for SCIM + Web UI for teams |
| 2025-09-26 | 📦 Complete containerized solution: SCIM API + monitoring UI in one deployment |
| 2025-09-26 | 🔧 **STATIC ASSETS FIX** - Web UI fully functional with proper CSS/JS serving |
| 2025-09-26 | ✅ **FINAL VERIFICATION** - Web UI accessible without authentication, assets working |
| 2025-09-26 | 🔧 **API URL FIX** - Resolved double /scim prefix issue in web client API calls |
| 2025-09-26 | 🎉 **COMPLETE SUCCESS** - Containerized SCIMServer fully functional and ready for teams |
| 2025-09-26 | 🌿 `feature/acr-automation` branch created and pushed to start Azure Container Registry automation work |
| 2025-09-26 | 🆕 Added /scim/admin/version endpoint (backend version reporting) |
| 2025-09-26 | 🔔 Frontend upgrade banner + remote manifest polling (L1+L2) implemented |
| 2025-09-26 | 🧩 Added dynamic upgrade helper script (GitHub Releases based) |
| 2025-09-26 | 🎨 Microsoft-inspired theming completed (dark/light parity, refined filters, log modal polish) |
| 2025-09-26 | 🔍 Admin log noise hidden from UI; SCIM request list now focused on provisioning traffic |
| 2025-12-29 | 🔁 **GITHUB REGISTRY MIGRATION** - Migrated from ACR to ghcr.io/pranems/scimserver with automated builds |
| 2025-12-26 | 🛠️ **UNIFIED DOCKERFILE** - Multi-stage build (web+API) with fixed SQLite permissions |
| 2025-12-26 | 🚀 **CONTAINER DEPLOYMENT** - Production deployment working via public registry |
| 2025-12-26 | 🔧 **SQLITE PERMISSIONS FIX** - Resolved readonly database errors with proper user ownership |
| 2025-12-26 | 📋 **AUTOMATION SCRIPTS** - publish-acr.ps1, tag-and-release.ps1, update-scimserver.ps1 created |
| 2025-12-26 | 🎯 **UPGRADE BANNER COMPLETE** - Compact banner with modal, hosted PowerShell script integration |
| 2025-12-26 | 📖 **ADMIN DOCUMENTATION** - Complete release workflow and user update process documented |


---

## Priorities (Condensed)
Done: Activity parser, Database browser, Hybrid storage, Update automation.
Near-Term:
- WebSocket/live activity feed (optional)
- Identifier column stabilization
- Minimal health/diagnostics endpoint
Deferred:
- Advanced analytics + FTS
- Mobile polish

---

## Dev Quick Ref
Backend: `cd api && npm run start:dev`
Frontend: `cd web && npm run dev`
Unit Tests: `cd api && npm test` (1962 tests, 59 suites)
Unit Coverage: `cd api && npm run test:cov` → coverage/
E2E Tests: `cd api && npm run test:e2e` (342 tests, 19 suites)
E2E Coverage: `cd api && npm run test:e2e:cov` → coverage-e2e/
All Coverage: `cd api && npm run test:cov:all` (unit + E2E)
Full Pipeline: `cd api && npm run test:all` (unit + E2E + smoke)
Live Tests: `.\scripts\live-test.ps1` (318 assertions)
Live Tests (verbose): `.\scripts\live-test.ps1 -Verbose`

---

*This file serves as persistent project memory for enhanced AI assistant session continuity with MCP server integration.*
## Key Features (Snapshot)

**SCIM 2.0 Compliance (~96% RFC 7643/7644):**
- Complete CRUD operations (POST, GET, PUT, PATCH, DELETE)
- Microsoft Entra ID provisioning compatible (all 25 validator tests pass)
- ServiceProviderConfig, Schemas, ResourceTypes discovery endpoints
- Full SCIM filter parser: 10 operators (`eq`,`ne`,`co`,`sw`,`ew`,`gt`,`lt`,`ge`,`le`,`pr`) + `and`/`or`/`not` + grouping
- POST /.search for Users and Groups
- ETag / If-None-Match → 304 conditional requests
- `attributes` / `excludedAttributes` projection on all GET and .search endpoints
- PATCH: add/replace/remove, valuePath filter, extension URN, no-path merge, boolean coercion
- Centralized SCIM error handling (`scim-exception.filter.ts`)
- `application/scim+json` content-type on all responses including errors
- Proper filtering, pagination, and error handling

**Monitoring & Debugging:**
- Real-time request/response logging
- Searchable log viewer with detailed inspection
- Admin endpoint filtering (hide non-SCIM traffic)
- Performance optimized (<1s load times)

**User Experience:**
- Light/dark theme support
- Upgrade notifications with GitHub integration
- Footer with credits and version info
- Responsive design for mobile/desktop

**DevOps Ready:**
- Docker containerization with proper permissions
- GitHub Container Registry (`ghcr.io/pranems/scimserver`)
- GitHub Actions CI/CD (`build-test.yml`, `publish-ghcr.yml`)
- One-click customer updates via PowerShell
- Automated CI/CD with GitHub releases
- VS Code debug configurations (launch, attach, log-to-file)

**Performance Insights:**
- Expected request volume is low; focus on clarity of logs over throughput.
- PostgreSQL provides robust concurrent access and production-grade persistence.
- Microsoft docs MCP confirmed Entra request patterns to optimize initial test coverage.
- Removing large text columns from primary list query yields major latency reduction.
- Persisting identifiers removes need to parse bodies repeatedly (final integration pending).
- Potential future improvements: FTS5 virtual table for deep search, cursor pagination, optional gzip.

**Known Constraints:**
- Must stay compliant with Microsoft Entra SCIM validator scenarios.
- Deployment must remain low-cost and easily reproducible for Microsoft engineers (Docker + optional ACA).
- Single-user admin workflow; no RBAC planned for MVP.
- Sensitive payload data retained in logs by design; rely on manual purge for case isolation.
- Rely on Microsoft docs MCP for authoritative SCIM updates; monitor for spec changes.
- Identifier persistence currently best-effort; older rows may lack derived names until backfilled.

---

## TODO (Lean)
[-] Investigate lighter framework (Fastify) for image size (deferred)
[ ] Health/diagnostics endpoint
[ ] Optional WebSocket live updates
[ ] Identifier persistence finalization/backfill
[ ] Consider distroless base image

---
*Condensed: older verbose narrative & future-dated/hallucinated entries removed for clarity.*
