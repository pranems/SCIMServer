# 📚 SCIMServer Documentation Index

> Quick navigation to all project documentation. Updated March 17, 2026 (v0.29.0).
>
> 51 active docs in `docs/` · 35 archived docs in `docs/archive/` · Presets in `api/presets/*.json`

---

## Project Health

| Document | Description |
|----------|-------------|
| [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md) | **Living document** — Codebase stats, LoC, architecture, test counts, dependencies |

## Getting Started

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview, 4 deployment options, SCIM compliance matrix, architecture, Entra setup |
| [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md) | Running instances, connection info, credentials, Azure costs |
| [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) | End-to-end Azure deployment, configuration, Entra setup |
| [DOCKER_GUIDE_AND_TEST_REPORT.md](DOCKER_GUIDE_AND_TEST_REPORT.md) | Docker build/run guide and test report |
| [README_VISUAL_STUDIO_DEBUG.md](README_VISUAL_STUDIO_DEBUG.md) | VS Code debugging configurations |
| [admin.md](../admin.md) | Release/admin workflow (versioning, tagging, publish, update) |
| [CHANGELOG.md](../CHANGELOG.md) | Version history |

## Architecture & Design

| Document | Description |
|----------|-------------|
| [COMPLETE_API_REFERENCE.md](COMPLETE_API_REFERENCE.md) | Complete REST API reference with curl examples |
| [TECHNICAL_DESIGN_DOCUMENT.md](TECHNICAL_DESIGN_DOCUMENT.md) | Full as-built technical design (architecture, data model, pipelines) |
| [USER_API_CALL_TRACE.md](USER_API_CALL_TRACE.md) | Annotated end-to-end call trace for POST /Users |
| [MULTI_ENDPOINT_GUIDE.md](MULTI_ENDPOINT_GUIDE.md) | Multi-endpoint architecture, API reference, data isolation |
| [ENDPOINT_PROFILE_ARCHITECTURE.md](ENDPOINT_PROFILE_ARCHITECTURE.md) | Endpoint profile system — creation, update, expansion, validation, presets |
| [SCHEMA_TEMPLATES_DESIGN.md](SCHEMA_TEMPLATES_DESIGN.md) | Profile configuration design document (v0.28.0 Phase 13) |
| [SCHEMA_CUSTOMIZATION_GUIDE.md](SCHEMA_CUSTOMIZATION_GUIDE.md) | Schema customization operator guide |

## SCIM Protocol & Compliance

| Document | Description |
|----------|-------------|
| [SCIM_REFERENCE.md](SCIM_REFERENCE.md) | SCIM v2 API reference with example payloads |
| [SCIM_COMPLIANCE.md](SCIM_COMPLIANCE.md) | RFC 7643/7644 compliance status + Entra compatibility matrix |
| [SCIM_RFC_COMPLIANCE_LAYER.md](SCIM_RFC_COMPLIANCE_LAYER.md) | Technical implementation of RFC compliance |
| [SCIM_CASE_INSENSITIVITY_REFERENCE.md](SCIM_CASE_INSENSITIVITY_REFERENCE.md) | Case-insensitivity rules per RFC 7643 §2.1 |
| [RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md](RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md) | RFC schema & extensions deep dive |
| [DISCOVERY_ENDPOINTS_RFC_AUDIT.md](DISCOVERY_ENDPOINTS_RFC_AUDIT.md) | Discovery endpoints vs RFC — all 6 gaps resolved |

## Per-Endpoint Configuration

| Document | Description |
|----------|-------------|
| [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | **Complete flag reference** — 12 persisted boolean settings + 2 derived + logLevel |
| [MULTI_MEMBER_PATCH_CONFIG_FLAG.md](MULTI_MEMBER_PATCH_CONFIG_FLAG.md) | Multi-member PATCH config flags |
| [FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md](FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md) | Soft delete, strict schema, custom extensions |
| [COLLISION-TESTING-GUIDE.md](COLLISION-TESTING-GUIDE.md) | Entra collision (409) testing guide |

## Feature Implementation Docs

| Document | Description |
|----------|-------------|
| [G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md](G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md) | Custom resource type registration |
| [G8C_PATCH_READONLY_PREVALIDATION.md](G8C_PATCH_READONLY_PREVALIDATION.md) | PATCH readOnly pre-validation |
| [G8E_RETURNED_CHARACTERISTIC_FILTERING.md](G8E_RETURNED_CHARACTERISTIC_FILTERING.md) | Response `returned` characteristic filtering |
| [G8F_GROUP_UNIQUENESS_PUT_PATCH.md](G8F_GROUP_UNIQUENESS_PUT_PATCH.md) | Group uniqueness on PUT/PATCH |
| [G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md](G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md) | Write-response attribute projection |
| [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md) | Per-endpoint credentials (3-tier auth) |
| [PHASE_09_BULK_OPERATIONS.md](PHASE_09_BULK_OPERATIONS.md) | Bulk operations (RFC 7644 §3.7) |
| [PHASE_10_ME_ENDPOINT.md](PHASE_10_ME_ENDPOINT.md) | /Me endpoint (RFC 7644 §3.11) |
| [PHASE_12_SORTING_AND_DEDUP.md](PHASE_12_SORTING_AND_DEDUP.md) | Sorting + service deduplication |
| [READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md](READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md) | ReadOnly attribute stripping & warnings |
| [P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md](P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md) | P2 attribute characteristic enforcement |
| [H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md](H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md) | PATCH validation + immutable enforcement |

## Attribute Characteristics & RFC Audits

| Document | Description |
|----------|-------------|
| [ATTRIBUTE_CHARACTERISTICS_GAPS.md](ATTRIBUTE_CHARACTERISTICS_GAPS.md) | Attribute characteristics gap matrix |
| [RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md](RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md) | RFC gap analysis G1–G15 |
| [RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md](RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md) | Full RFC 7643 compliance audit |
| [P3_REMAINING_ATTRIBUTE_CHARACTERISTIC_GAPS.md](P3_REMAINING_ATTRIBUTE_CHARACTERISTIC_GAPS.md) | P3 remaining gaps |

## Validation & Testing

| Document | Description |
|----------|-------------|
| [TESTING-WORKFLOW.md](TESTING-WORKFLOW.md) | Pre-release testing workflow |
| [LIVE_TEST_NORMS_AND_BEST_PRACTICES.md](LIVE_TEST_NORMS_AND_BEST_PRACTICES.md) | Live integration test norms |
| [TEST_FAILURE_ANALYSIS.md](TEST_FAILURE_ANALYSIS.md) | v0.28.0→v0.29.0 test failure analysis (all resolved) |
| [TEST_INVENTORY.md](TEST_INVENTORY.md) | Current test file inventory |
| [ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md](ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md) | Issues, bugs & root cause analysis |
| [SELF_IMPROVING_TEST_HEALTH_PROMPT.md](SELF_IMPROVING_TEST_HEALTH_PROMPT.md) | Reusable AI prompt for test health |

## Operations & Observability

| Document | Description |
|----------|-------------|
| [LOGGING_AND_OBSERVABILITY.md](LOGGING_AND_OBSERVABILITY.md) | Structured logging, ring buffer, SSE stream |
| [REMOTE_DEBUGGING_AND_DIAGNOSIS.md](REMOTE_DEBUGGING_AND_DIAGNOSIS.md) | Remote diagnosis playbooks |
| [AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md](AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md) | Known Azure issues and fixes |

## Development Context

| Document | Description |
|----------|-------------|
| [CONTEXT_INSTRUCTIONS.md](CONTEXT_INSTRUCTIONS.md) | AI assistant context (stack, conventions, patterns) |
| [REPO_API_UNDERSTANDING_BASELINE.md](REPO_API_UNDERSTANDING_BASELINE.md) | Implementation baseline reference |
| [TECHNICAL_REQUIREMENTS_DOCUMENT.md](TECHNICAL_REQUIREMENTS_DOCUMENT.md) | Functional/non-functional requirements |

## Archive (35 historical docs)

Historical, superseded, and migration-plan documents are preserved in [`docs/archive/`](archive/).
These cover the SQLite era, pre-implementation designs, completed migration plans, and point-in-time analyses.

## API Artifacts

| Format | Location |
|--------|----------|
| OpenAPI v3 | [docs/openapi/](openapi/) |
| Postman | [docs/postman/](postman/) |
| Insomnia | [docs/insomnia/](insomnia/) |
| Mermaid diagrams | [docs/create-user-sequence.mmd](create-user-sequence.mmd), [list-get-user-sequence.mmd](list-get-user-sequence.mmd) |

## Preset JSON Files

Profile preset definitions (source of truth for `GET /admin/profile-presets`):

| Preset | File |
|--------|------|
| entra-id (default) | [api/presets/entra-id.json](../api/presets/entra-id.json) |
| entra-id-minimal | [api/presets/entra-id-minimal.json](../api/presets/entra-id-minimal.json) |
| rfc-standard | [api/presets/rfc-standard.json](../api/presets/rfc-standard.json) |
| minimal | [api/presets/minimal.json](../api/presets/minimal.json) |
| user-only | [api/presets/user-only.json](../api/presets/user-only.json) |
