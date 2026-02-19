# 📚 SCIMServer Documentation Index

> Quick navigation to all project documentation. Updated February 18, 2026.

> Theme conventions: onboarding-first, current-state metadata, explicit historical-context labeling, and cross-linking to canonical sources.

---

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
| [STORAGE_AND_BACKUP.md](STORAGE_AND_BACKUP.md) | Persistence and backup architecture for SQLite + cloud backup workflows |
| [AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md](AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md) | Known Azure deployment/runtime issues and proven fixes |

## Architecture & Design

| Document | Description |
|----------|-------------|
| [MULTI_ENDPOINT_GUIDE.md](MULTI_ENDPOINT_GUIDE.md) | Multi-endpoint (multi-tenant) architecture, API reference, data isolation |
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

## Diagrams

| File | Description |
|------|-------------|
| [create-user-sequence.mmd](create-user-sequence.mmd) | Mermaid: Create user flow |
| [list-get-user-sequence.mmd](list-get-user-sequence.mmd) | Mermaid: List/get user flow |
