# 📚 SCIMServer Documentation Index

> Quick navigation to all project documentation. Updated February 11, 2026.

---

## Getting Started

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview, 5-minute deploy, Entra configuration |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | Azure Container Apps deployment guide |
| [admin.md](../admin.md) | Admin panel usage guide |
| [CHANGELOG.md](../CHANGELOG.md) | Version history |

## Architecture & Design

| Document | Description |
|----------|-------------|
| [MULTI_ENDPOINT_GUIDE.md](MULTI_ENDPOINT_GUIDE.md) | Multi-endpoint (multi-tenant) architecture, API reference, data isolation |
| [STORAGE_AND_BACKUP.md](STORAGE_AND_BACKUP.md) | Hybrid storage architecture (local SQLite + Azure Files backup) |
| [COMPLETE_API_REFERENCE.md](COMPLETE_API_REFERENCE.md) | Complete REST API reference with curl examples |
| [LOGGING_AND_OBSERVABILITY.md](LOGGING_AND_OBSERVABILITY.md) | Structured logging, traceability, correlation IDs, admin log-config API, ring buffer |
| [USER_API_CALL_TRACE.md](USER_API_CALL_TRACE.md) | Annotated end-to-end call trace for POST /Users |

## SCIM Protocol

| Document | Description |
|----------|-------------|
| [SCIM_REFERENCE.md](SCIM_REFERENCE.md) | SCIM v2 API reference with example payloads (implementation-agnostic) |
| [SCIM_COMPLIANCE.md](SCIM_COMPLIANCE.md) | RFC 7643/7644 compliance status + Entra ID compatibility matrix |
| [SCIM_CASE_INSENSITIVITY_REFERENCE.md](SCIM_CASE_INSENSITIVITY_REFERENCE.md) | Case-insensitivity rules per RFC 7643 §2.1 |
| [MULTI_MEMBER_PATCH_CONFIG_FLAG.md](MULTI_MEMBER_PATCH_CONFIG_FLAG.md) | Multi-member PATCH config flags reference |

## Validation & Testing

| Document | Description |
|----------|-------------|
| [SCIM_VALIDATION_GAP_ANALYSIS.md](SCIM_VALIDATION_GAP_ANALYSIS.md) | Microsoft SCIM Validator test analysis (13 failures → all fixed) |
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

## Design Explorations (Future / Not Implemented)

| Document | Description |
|----------|-------------|
| [RECOMMENDED_DESIGN_IMPROVEMENTS.md](RECOMMENDED_DESIGN_IMPROVEMENTS.md) | ⚠️ RFC-first schema-driven architecture (aspirational) |
| [MULTI_ENDPOINT-API-BEHAVIOR-STRATEGIES.md](MULTI_ENDPOINT-API-BEHAVIOR-STRATEGIES.md) | ⚠️ Strategy/decorator/plugin pattern comparison |
| [TECHNICAL_REQUIREMENTS_DOCUMENT.md](TECHNICAL_REQUIREMENTS_DOCUMENT.md) | Formal requirements matrix (FR-001–FR-700+) |

## API Artifacts

| Directory | Contents |
|-----------|----------|
| [openapi/](openapi/) | OpenAPI v3 specifications (3 variants) |
| [postman/](postman/) | Postman collection (v1.2) |
| [insomnia/](insomnia/) | Insomnia API client exports |
| [examples/](examples/) | Example JSON payloads |
| [Release notes/](Release%20notes/) | Per-version release notes |

## Diagrams

| File | Description |
|------|-------------|
| [create-user-sequence.mmd](create-user-sequence.mmd) | Mermaid: Create user flow |
| [list-get-user-sequence.mmd](list-get-user-sequence.mmd) | Mermaid: List/get user flow |
