# 📚 SCIMServer Documentation Index

> Quick navigation to all project documentation. Updated March 1, 2026.

> Theme conventions: onboarding-first, current-state metadata, explicit historical-context labeling, and cross-linking to canonical sources.

---

## Project Health

| Document | Description |
|----------|-------------|
| [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md) | **Living document** — Codebase stats, LoC breakdown, architecture, tests, dependencies, scale, known issues, improvements |

## Getting Started

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview, 5-minute deploy, Entra configuration |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | Deployment options (Azure, Docker, local) |
| [admin.md](../admin.md) | Release/admin workflow (versioning, tagging, publish, update) |
| [CHANGELOG.md](../CHANGELOG.md) | Version history |

## Operations & Troubleshooting

| Document | Description |
|----------|-------------|
| [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md) | **Living document** — Instance connection info, credentials, Azure costs, load scenario projections, scaling recommendations |
| [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) | End-to-end Azure deployment, configuration, and operations guide |
| [LOGGING_AND_OBSERVABILITY.md](LOGGING_AND_OBSERVABILITY.md) | Structured logging, runtime log configuration, ring buffer, and SSE stream |
| [REMOTE_DEBUGGING_AND_DIAGNOSIS.md](REMOTE_DEBUGGING_AND_DIAGNOSIS.md) | Remote diagnosis playbooks, log collection patterns, and troubleshooting workflows |
| [DOCKER_GUIDE_AND_TEST_REPORT.md](DOCKER_GUIDE_AND_TEST_REPORT.md) | Docker build/run guide and live test report |
| [STORAGE_AND_BACKUP.md](STORAGE_AND_BACKUP.md) | ⚠️ Historical — SQLite hybrid backup architecture (pre-v0.11.0, replaced by PostgreSQL) |
| [AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md](AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md) | Known Azure deployment/runtime issues and proven fixes |

## Architecture & Design

| Document | Description |
|----------|-------------|
| [MULTI_ENDPOINT_GUIDE.md](MULTI_ENDPOINT_GUIDE.md) | Multi-endpoint (multi-endpoint) architecture, API reference, data isolation |
| [COMPLETE_API_REFERENCE.md](COMPLETE_API_REFERENCE.md) | Complete REST API reference with curl examples |
| [USER_API_CALL_TRACE.md](USER_API_CALL_TRACE.md) | Annotated end-to-end call trace for POST /Users |
| [TECHNICAL_DESIGN_DOCUMENT.md](TECHNICAL_DESIGN_DOCUMENT.md) | Full as-built technical design (architecture, data model, pipelines) |
| [RUNTIME_UPGRADE_ANALYSIS.md](RUNTIME_UPGRADE_ANALYSIS.md) | Completed runtime/dependency upgrade report (Node 24, Prisma 7, React 19, Vite 7) |
| [SQLITE_COMPROMISE_ANALYSIS.md](SQLITE_COMPROMISE_ANALYSIS.md) | SQLite compromise audit (28 items), PostgreSQL migration roadmap, impact diagrams |
| [SCHEMA_LIFECYCLE_AND_REGISTRY.md](SCHEMA_LIFECYCLE_AND_REGISTRY.md) | Schema system internals — ScimSchemaRegistry two-layer architecture, SchemaValidator, boot hydration, Admin controllers, persistence model, GenericPatchEngine, config flags |

## SCIM Protocol

| Document | Description |
|----------|-------------|
| [SCIM_REFERENCE.md](SCIM_REFERENCE.md) | SCIM v2 API reference with example payloads (implementation-agnostic) |
| [SCIM_COMPLIANCE.md](SCIM_COMPLIANCE.md) | RFC 7643/7644 compliance status + Entra ID compatibility matrix |
| [SCIM_CASE_INSENSITIVITY_REFERENCE.md](SCIM_CASE_INSENSITIVITY_REFERENCE.md) | Case-insensitivity rules per RFC 7643 §2.1 |
| [SCIM_RFC_COMPLIANCE_LAYER.md](SCIM_RFC_COMPLIANCE_LAYER.md) | Comprehensive RFC compliance layer technical reference |
| [MULTI_MEMBER_PATCH_CONFIG_FLAG.md](MULTI_MEMBER_PATCH_CONFIG_FLAG.md) | Multi-member PATCH config flags reference |
| [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | **Complete flag reference** — All 14 boolean flags + logLevel (15 total) with applicability, precedence, combinations, diagrams, JSON examples |
| [FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md](FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md) | Soft delete, strict schema validation, custom extension URNs — feature docs with diagrams, examples, DB values |
| [EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md](EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md) | externalId CITEXT→TEXT migration — RFC 7643 §3.1 caseExact compliance fix with sequence diagrams, DB diffs, filter examples, rollback strategy |
| [G8C_PATCH_READONLY_PREVALIDATION.md](G8C_PATCH_READONLY_PREVALIDATION.md) | G8c — PATCH readOnly pre-validation: RFC 7643 §2.2 enforcement, architecture, test coverage |
| [G8E_RETURNED_CHARACTERISTIC_FILTERING.md](G8E_RETURNED_CHARACTERISTIC_FILTERING.md) | G8e — Response `returned` characteristic filtering: RFC 7643 §2.4 enforcement, two-layer architecture, test coverage |
| [G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md](G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md) | G8b — Custom resource type registration: Data-driven extensibility beyond User/Group, Admin API, generic SCIM CRUD, per-endpoint flag gating |
| [G8F_GROUP_UNIQUENESS_PUT_PATCH.md](G8F_GROUP_UNIQUENESS_PUT_PATCH.md) | G8f — Group uniqueness enforcement on PUT/PATCH: `displayName`/`externalId` collision detection with self-exclusion, 409 Conflict responses |
| [G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md](G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md) | G8g — Write-response `attributes`/`excludedAttributes` projection on POST/PUT/PATCH for RFC 7644 §3.9 compliance |
| [PHASE_09_BULK_OPERATIONS.md](PHASE_09_BULK_OPERATIONS.md) | Phase 9 — Bulk Operations (RFC 7644 §3.7): Sequential batch processing, bulkId cross-referencing, failOnErrors, per-endpoint `BulkOperationsEnabled` flag gating |
| [PHASE_10_ME_ENDPOINT.md](PHASE_10_ME_ENDPOINT.md) | Phase 10 — `/Me` Endpoint (RFC 7644 §3.11): JWT sub→userName identity resolution, full GET/PUT/PATCH/DELETE, attribute projection |
| [PHASE_12_SORTING_AND_DEDUP.md](PHASE_12_SORTING_AND_DEDUP.md) | Phase 12 — Sorting (RFC 7644 §3.4.2.3): `sortBy`/`sortOrder` push-down, `sort.supported: true` in SPC, G17 service deduplication (`scim-service-helpers.ts`) |
| [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md) | G11 — Per-Endpoint Credentials: bcrypt-hashed credential storage, 3-tier auth fallback chain, `PerEndpointCredentialsEnabled` flag (12th boolean flag), Admin Credential API |
| [READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md](READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md) | ReadOnly Attribute Stripping & Warnings (v0.22.0): RFC 7643 §2.2 enforcement for Users/Groups/Generic, PATCH behavior matrix, warning URN extension, AsyncLocalStorage middleware, 2 new config flags, 17 E2E + 10 live tests |
| [P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md](P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md) | P2 Attribute Characteristic Enforcement (v0.24.0): 6 behavioral fixes — R-RET-1 schema-driven always-returned, R-RET-2 Group active, R-RET-3 sub-attr always, R-MUT-1 writeOnly→never, R-MUT-2 readOnly sub-attr stripping, R-CASE-1 caseExact filter |
| [DISCOVERY_ENDPOINTS_RFC_AUDIT.md](DISCOVERY_ENDPOINTS_RFC_AUDIT.md) | Discovery endpoints RFC audit — SPC/ResourceTypes/Schemas vs RFC 7643 §5–§7 + RFC 7644 §4: 6 gaps (D1–D6) identified and **all resolved** |
| [RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md](RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md) | **RFC 7642/7643/7644 schema & extensions reference** — Core schema immutability, extension rules, custom resource types, `schemas[]` enforcement, attribute characteristics deep dive, industry patterns |
| [SCHEMA_CUSTOMIZATION_GUIDE.md](SCHEMA_CUSTOMIZATION_GUIDE.md) | Schema customization operator guide — Step-by-step extension registration, custom resource types, config profiles, PATCH operations, troubleshooting, quick reference card |
| [SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md](SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md) | Schema extension behavior matrices — Registration flow outcomes, validation × config flags, discovery responses, `schemas[]` behavior, PATCH path resolution, boot hydration, error matrix |

## Validation & Testing

| Document | Description |
|----------|-------------|
| [SCIM_VALIDATION_GAP_ANALYSIS.md](SCIM_VALIDATION_GAP_ANALYSIS.md) | Microsoft SCIM Validator test analysis (13 failures → all fixed) |
| [SCIM_GROUP_PERFORMANCE_ANALYSIS.md](SCIM_GROUP_PERFORMANCE_ANALYSIS.md) | Group PATCH performance & write-lock analysis (3 failures → all fixed) |
| [PERSISTENCE_PERFORMANCE_ANALYSIS.md](PERSISTENCE_PERFORMANCE_ANALYSIS.md) | Holistic persistence/concurrency analysis (12 issues, 3 critical fixes applied) |
| [PHASE1_PATCH_FIXES_REFERENCE.md](PHASE1_PATCH_FIXES_REFERENCE.md) | Detailed fix reference for 7 validator failures |
| [SCIM_VALIDATOR_FALSE_POSITIVES_REPORT.md](SCIM_VALIDATOR_FALSE_POSITIVES_REPORT.md) | Validator false positives analysis |
| [TEST_ORGANIZATION_RECOMMENDATIONS.md](TEST_ORGANIZATION_RECOMMENDATIONS.md) | Test strategy for NestJS/Prisma/SQLite |
| [TESTING-WORKFLOW.md](TESTING-WORKFLOW.md) | Pre-release testing workflow (branches, CI, deploy) |
| [COLLISION-TESTING-GUIDE.md](COLLISION-TESTING-GUIDE.md) | Entra collision (409) testing guide |
| [ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md](ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md) | Issues, bugs & root cause analysis — 11 issues diagnosed with fixes and lessons learned |
| [SCHEMA_VALIDATOR_READONLY_REQUIRED_FIX.md](SCHEMA_VALIDATOR_READONLY_REQUIRED_FIX.md) | SchemaValidator `id` readOnly+required catch-22 fix — root cause analysis, RFC justification, lifecycle diagrams (65 failures → 0) |
| [LIVE_TEST_NORMS_AND_BEST_PRACTICES.md](LIVE_TEST_NORMS_AND_BEST_PRACTICES.md) | Live integration test norms, best practices & industry recommendations — local, Docker, Azure with PostgreSQL |
| [SCIM_VALIDATOR_RESULTS_26_ANALYSIS.md](SCIM_VALIDATOR_RESULTS_26_ANALYSIS.md) | Microsoft SCIM Validator 26-test analysis — detailed pass/fail review |
| [SELF_IMPROVING_TEST_HEALTH_PROMPT.md](SELF_IMPROVING_TEST_HEALTH_PROMPT.md) | Reusable self-improving AI prompt for diagnosing and resolving test failures — pattern library grows with each use |

## Development

| Document | Description |
|----------|-------------|
| [README_VISUAL_STUDIO_DEBUG.md](README_VISUAL_STUDIO_DEBUG.md) | VS Code / Visual Studio debugging quickstart |
| [CONTEXT_INSTRUCTIONS.md](CONTEXT_INSTRUCTIONS.md) | AI assistant context (stack, conventions, patterns) |

## Documentation Standards

| Document | Description |
|----------|-------------|
| [CONTEXT_INSTRUCTIONS.md](CONTEXT_INSTRUCTIONS.md) | Canonical stack/context source used by AI assistants and contributors |
| [REPO_API_UNDERSTANDING_BASELINE.md](REPO_API_UNDERSTANDING_BASELINE.md) | Code-verified repo/API runtime baseline used to prevent docs drift |

## Exploratory & Historical Docs

| Document | Description |
|----------|-------------|
| [RECOMMENDED_DESIGN_IMPROVEMENTS.md](RECOMMENDED_DESIGN_IMPROVEMENTS.md) | Aspirational RFC-first architecture recommendations |
| [MULTI_ENDPOINT-API-BEHAVIOR-STRATEGIES.md](MULTI_ENDPOINT-API-BEHAVIOR-STRATEGIES.md) | Strategy/decorator/plugin pattern comparison |
| [TECHNICAL_REQUIREMENTS_DOCUMENT.md](TECHNICAL_REQUIREMENTS_DOCUMENT.md) | Formal requirements matrix (FR-001–FR-700+) |
| [COMPLETE_AGNOSTIC_SCIM_ARCHITECTURE.md](COMPLETE_AGNOSTIC_SCIM_ARCHITECTURE.md) | Agnostic SCIM architecture — persistence-neutral N-tier design exploration |
| [CURRENT_STATE_AND_MIGRATION_PLAN.md](CURRENT_STATE_AND_MIGRATION_PLAN.md) | Current state assessment and initial migration considerations |
| [DISCOVERY_AND_ENDPOINT_SCHEMAS.md](DISCOVERY_AND_ENDPOINT_SCHEMAS.md) | ⚠️ **Largely superseded** — Discovery & per-endpoint schema reference (see SCHEMA_LIFECYCLE_AND_REGISTRY.md + SCHEMA_CUSTOMIZATION_GUIDE.md). Retained for DTO rules, error catalog, repo layer |
| [REPOSITORY_INTERFACE_ANALYSIS.md](REPOSITORY_INTERFACE_ANALYSIS.md) | Repository interface pattern analysis — abstraction layer evaluation |
| [RFC_COMPLIANCE_AND_PROJECT_REQUIREMENTS_ANALYSIS.md](RFC_COMPLIANCE_AND_PROJECT_REQUIREMENTS_ANALYSIS.md) | RFC compliance vs project requirements gap analysis |
| [scim-extensions-analysis.md](scim-extensions-analysis.md) | ⚠️ **Superseded** — SCIM extensions analysis v1 (see RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md + SCHEMA_LIFECYCLE_AND_REGISTRY.md + SCHEMA_CUSTOMIZATION_GUIDE.md + SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md) |
| [SCIM_EXTENSIONS_DEEP_ANALYSIS.md](SCIM_EXTENSIONS_DEEP_ANALYSIS.md) | ⚠️ **Superseded** — SCIM extensions deep analysis v2 (see RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md + SCHEMA_LIFECYCLE_AND_REGISTRY.md + SCHEMA_CUSTOMIZATION_GUIDE.md + SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md) |
| [UUID_ANALYSIS_AND_RFC_COMPLIANCE.md](UUID_ANALYSIS_AND_RFC_COMPLIANCE.md) | UUID format analysis and RFC compliance — id generation patterns |
| [Release notes/](Release%20notes/) | Historical release notes (version-specific context retained as originally published) |

## API Artifacts

| Directory | Contents |
|-----------|----------|
| [openapi/](openapi/) | OpenAPI v3 specifications (3 variants) |
| [postman/](postman/) | Postman collection (v1.4) |
| [insomnia/](insomnia/) | Insomnia API client exports |
| [examples/](examples/) | Example JSON payloads |

## Migration & Roadmap

| Document | Description |
|----------|-------------|
| [MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md](MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md) | Master migration plan — 12+ phases, gap table, dependency graph, timeline |
| [CURRENT_TO_IDEAL_MIGRATION_PLAN_FRESH_2026-02-20.md](CURRENT_TO_IDEAL_MIGRATION_PLAN_FRESH_2026-02-20.md) | Fresh migration plan (2026-02-20) — updated current-to-ideal gap analysis |
| [IDEAL_SCIM_ARCHITECTURE_RFC_FIRST.md](IDEAL_SCIM_ARCHITECTURE_RFC_FIRST.md) | Ideal RFC-first SCIM architecture — original exploration |
| [IDEAL_SCIM_ARCHITECTURE_RFC_FIRST_FRESH_2026-02-20.md](IDEAL_SCIM_ARCHITECTURE_RFC_FIRST_FRESH_2026-02-20.md) | Ideal RFC-first SCIM architecture — refreshed 2026-02-20 |
| [RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md](RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md) | RFC 7643/7644 attribute characteristics gap analysis — 15 gaps, sub-phases 8.1-8.5, remediation plans |
| [H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md](H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md) | H-1 (PATCH validation) & H-2 (immutable enforcement) — architecture analysis & implementation |
| [PHASE_08_REMAINING_ANALYSIS.md](PHASE_08_REMAINING_ANALYSIS.md) | Phase 8 remaining adversarial validation gap analysis — 33 gaps, sub-phases 8.5–8.8, effort estimates |
| [ATTRIBUTE_CHARACTERISTICS_GAPS.md](ATTRIBUTE_CHARACTERISTICS_GAPS.md) | RFC 7643 §2 attribute characteristics gaps, bugs, fixes — master tracking |
| [RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md](RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md) | **RFC 7643 §2 full audit** — Every characteristic × every flow × every sub-attribute, DB storage, discovery, 20 remaining work items |
| [IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md](IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md) | Ideal SCIM architecture v3 — N-tier, unified table, JSONB, data-driven discovery |
| [INMEMORY_ARCHITECTURE_AND_PLAN_v1_2026-02-20.md](INMEMORY_ARCHITECTURE_AND_PLAN_v1_2026-02-20.md) | In-memory architecture & plan — Map-based repo implementation |
| [MIGRATION_AUTOMATION_STRATEGY_v1_2026-02-20.md](MIGRATION_AUTOMATION_STRATEGY_v1_2026-02-20.md) | Migration automation strategy — AI-assisted effort reduction analysis |

## Phase Documentation

| Document | Description |
|----------|-------------|
| [phases/PHASE_01_REPOSITORY_PATTERN.md](phases/PHASE_01_REPOSITORY_PATTERN.md) | Phase 1 — Repository Pattern (initial architecture) |
| [phases/PHASE_02_UNIFIED_RESOURCE_TABLE.md](phases/PHASE_02_UNIFIED_RESOURCE_TABLE.md) | Phase 2 — Unified Resource Table |
| [phases/PHASE_03_ISSUES_AND_RESOLUTIONS.md](phases/PHASE_03_ISSUES_AND_RESOLUTIONS.md) | Phase 3 — Issues and Resolutions |
| [phases/PHASE_03_POSTGRESQL_MIGRATION.md](phases/PHASE_03_POSTGRESQL_MIGRATION.md) | Phase 3 — PostgreSQL Migration (v0.11.0) |
| [phases/PHASE_04_FILTER_PUSH_DOWN.md](phases/PHASE_04_FILTER_PUSH_DOWN.md) | Phase 4 — Filter Push-Down Expansion (v0.12.0) |
| [phases/PHASE_05_PATCH_ENGINE.md](phases/PHASE_05_PATCH_ENGINE.md) | Phase 5 — Domain-Layer PATCH Engine (v0.13.0) |
| [phases/PHASE_06_DATA_DRIVEN_DISCOVERY.md](phases/PHASE_06_DATA_DRIVEN_DISCOVERY.md) | Phase 6 — Data-Driven Discovery (v0.14.0) |
| [phases/PHASE_07_ETAG_CONDITIONAL_REQUESTS.md](phases/PHASE_07_ETAG_CONDITIONAL_REQUESTS.md) | Phase 7 — ETag & Conditional Requests (v0.16.0) |
| [phases/PHASE_08_SCHEMA_VALIDATION.md](phases/PHASE_08_SCHEMA_VALIDATION.md) | Phase 8 — Schema Validation Engine (v0.17.0) |
| [PHASE_08_REMAINING_ANALYSIS.md](PHASE_08_REMAINING_ANALYSIS.md) | Phase 8 — Remaining analysis, adversarial validation gaps (33 gaps), Part 2 scope |
| [PHASE_09_BULK_OPERATIONS.md](PHASE_09_BULK_OPERATIONS.md) | Phase 9 — Bulk Operations (v0.19.0, RFC 7644 §3.7) |
| [PHASE_10_ME_ENDPOINT.md](PHASE_10_ME_ENDPOINT.md) | Phase 10 — /Me Endpoint (v0.20.0, RFC 7644 §3.11): Identity resolution via JWT sub → userName, full CRUD delegation |
| [PHASE_12_SORTING_AND_DEDUP.md](PHASE_12_SORTING_AND_DEDUP.md) | Phase 12 — Sorting + Service Dedup (v0.20.0, RFC 7644 §3.4.2.3): sortBy/sortOrder, G17 service helpers extraction |
| [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md) | Phase 11 — Per-Endpoint Credentials (v0.21.0): bcrypt-hashed per-endpoint auth tokens, admin CRUD API, fallback chain |

## Diagrams

| File | Description |
|------|-------------|
| [create-user-sequence.mmd](create-user-sequence.mmd) | Mermaid: Create user flow |
| [list-get-user-sequence.mmd](list-get-user-sequence.mmd) | Mermaid: List/get user flow |
