# 📚 SCIMServer Documentation Index

> Quick navigation to all project documentation. Updated February 24, 2026.

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

## SCIM Protocol

| Document | Description |
|----------|-------------|
| [SCIM_REFERENCE.md](SCIM_REFERENCE.md) | SCIM v2 API reference with example payloads (implementation-agnostic) |
| [SCIM_COMPLIANCE.md](SCIM_COMPLIANCE.md) | RFC 7643/7644 compliance status + Entra ID compatibility matrix |
| [SCIM_CASE_INSENSITIVITY_REFERENCE.md](SCIM_CASE_INSENSITIVITY_REFERENCE.md) | Case-insensitivity rules per RFC 7643 §2.1 |
| [SCIM_RFC_COMPLIANCE_LAYER.md](SCIM_RFC_COMPLIANCE_LAYER.md) | Comprehensive RFC compliance layer technical reference |
| [MULTI_MEMBER_PATCH_CONFIG_FLAG.md](MULTI_MEMBER_PATCH_CONFIG_FLAG.md) | Multi-member PATCH config flags reference |
| [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | **Complete flag reference** — All 10 boolean flags + logLevel with applicability, precedence, combinations, diagrams, JSON examples |
| [FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md](FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md) | Soft delete, strict schema validation, custom extension URNs — feature docs with diagrams, examples, DB values |
| [EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md](EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md) | externalId CITEXT→TEXT migration — RFC 7643 §3.1 caseExact compliance fix with sequence diagrams, DB diffs, filter examples, rollback strategy |

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
| [RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md](RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md) | RFC 7643/7644 attribute characteristics gap analysis — 15 gaps, sub-phases 8.1-8.5, remediation plans |
| [H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md](H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md) | H-1 (PATCH validation) & H-2 (immutable enforcement) — architecture analysis & implementation |
| [ATTRIBUTE_CHARACTERISTICS_GAPS.md](ATTRIBUTE_CHARACTERISTICS_GAPS.md) | RFC 7643 §2 attribute characteristics gaps, bugs, fixes — master tracking |
| [IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md](IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md) | Ideal SCIM architecture v3 — N-tier, unified table, JSONB, data-driven discovery |
| [INMEMORY_ARCHITECTURE_AND_PLAN_v1_2026-02-20.md](INMEMORY_ARCHITECTURE_AND_PLAN_v1_2026-02-20.md) | In-memory architecture & plan — Map-based repo implementation |
| [MIGRATION_AUTOMATION_STRATEGY_v1_2026-02-20.md](MIGRATION_AUTOMATION_STRATEGY_v1_2026-02-20.md) | Migration automation strategy — AI-assisted effort reduction analysis |

## Phase Documentation

| Document | Description |
|----------|-------------|
| [phases/PHASE_03_POSTGRESQL_MIGRATION.md](phases/PHASE_03_POSTGRESQL_MIGRATION.md) | Phase 3 — PostgreSQL Migration (v0.11.0) |
| [phases/PHASE_04_FILTER_PUSHDOWN.md](phases/PHASE_04_FILTER_PUSHDOWN.md) | Phase 4 — Filter Push-Down Expansion (v0.12.0) |
| [phases/PHASE_05_PATCH_ENGINE.md](phases/PHASE_05_PATCH_ENGINE.md) | Phase 5 — Domain-Layer PATCH Engine (v0.13.0) |
| [phases/PHASE_06_DATA_DRIVEN_DISCOVERY.md](phases/PHASE_06_DATA_DRIVEN_DISCOVERY.md) | Phase 6 — Data-Driven Discovery (v0.14.0) |
| [phases/PHASE_07_ETAG_CONDITIONAL_REQUESTS.md](phases/PHASE_07_ETAG_CONDITIONAL_REQUESTS.md) | Phase 7 — ETag & Conditional Requests (v0.16.0) |
| [phases/PHASE_08_SCHEMA_VALIDATION.md](phases/PHASE_08_SCHEMA_VALIDATION.md) | Phase 8 — Schema Validation Engine (v0.17.0) |
| [PHASE_08_REMAINING_ANALYSIS.md](PHASE_08_REMAINING_ANALYSIS.md) | Phase 8 — Remaining analysis, adversarial validation gaps (33 gaps), Part 2 scope |

## Diagrams

| File | Description |
|------|-------------|
| [create-user-sequence.mmd](create-user-sequence.mmd) | Mermaid: Create user flow |
| [list-get-user-sequence.mmd](list-get-user-sequence.mmd) | Mermaid: List/get user flow |
