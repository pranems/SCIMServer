# 📚 SCIMServer Documentation Index

> **Version:** 0.37.0 · **Updated:** April 15, 2026  
> 65 active docs in `docs/` · 46 E2E suites (965 pass) · 82 unit suites (3,241 pass) · 6 built-in presets

---

## Project Health & Quick Start

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Overview, quick start, architecture, compliance, deployment |
| [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md) | Living stats — LoC, test counts, dependency versions, architecture |
| [CHANGELOG.md](../CHANGELOG.md) | Version history from v0.1.0 → v0.37.0 |
| [admin.md](../admin.md) | Release workflow (version, tag, publish, update) |

## Deployment Guides

| Document | Description |
|----------|-------------|
| [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) | End-to-end Azure Container Apps deployment + Entra ID setup |
| [SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md](SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md) | Azure Government, BLEU (France), China — sovereign cloud deployment |
| [DOCKER_GUIDE_AND_TEST_REPORT.md](DOCKER_GUIDE_AND_TEST_REPORT.md) | Docker Compose build/run, healthcheck, test report |
| [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md) | Running instances, connection info, credentials, Azure costs |
| [README_VISUAL_STUDIO_DEBUG.md](README_VISUAL_STUDIO_DEBUG.md) | VS Code debugging — launch configs, remote attach |
| [REMOTE_DEBUGGING_AND_DIAGNOSIS.md](REMOTE_DEBUGGING_AND_DIAGNOSIS.md) | **v3.0** Zero-access diagnosis — copy-paste quick start script, 20 troubleshooting scenarios, SSE, ring buffer, per-endpoint isolation, 4 workflows, log file reference |

## Architecture & Design

| Document | Description |
|----------|-------------|
| [COMPLETE_API_REFERENCE.md](COMPLETE_API_REFERENCE.md) | **Full REST API** — all 82 endpoints, request/response, status codes, summary table |
| [ENDPOINT_LIFECYCLE_AND_USAGE.md](ENDPOINT_LIFECYCLE_AND_USAGE.md) | **Quick start** — endpoint lifecycle, usage recipes, common operations |
| [TECHNICAL_DESIGN_DOCUMENT.md](TECHNICAL_DESIGN_DOCUMENT.md) | As-built architecture — layers, modules, data flow, Prisma schema |
| [USER_API_CALL_TRACE.md](USER_API_CALL_TRACE.md) | Annotated end-to-end POST /Users call trace |
| [MULTI_ENDPOINT_GUIDE.md](MULTI_ENDPOINT_GUIDE.md) | Multi-endpoint architecture, data isolation, tenant provisioning |
| [ENDPOINT_PROFILE_ARCHITECTURE.md](ENDPOINT_PROFILE_ARCHITECTURE.md) | Profile system — creation, expansion, validation, 6 presets |
| [SCHEMA_TEMPLATES_DESIGN.md](SCHEMA_TEMPLATES_DESIGN.md) | Profile configuration design (Phase 13) — decisions, types, flows |
| [SCHEMA_CUSTOMIZATION_GUIDE.md](SCHEMA_CUSTOMIZATION_GUIDE.md) | **v3.0** Operator guide — custom extensions, resource types, profile-based (source-verified) |
| [H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md](H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md) | PATCH validation architecture + immutable enforcement |
| [LOGGING_AND_OBSERVABILITY.md](LOGGING_AND_OBSERVABILITY.md) | **v4.0** Structured logging — 21 sections, 3 Mermaid diagrams, 10 troubleshooting scenarios, source-verified, zero-dep stack |
| [WEB_UI_FLOWS_AND_BEHAVIORS.md](WEB_UI_FLOWS_AND_BEHAVIORS.md) | **v1.0** Web UI — 20 sections, 5 screens, data source matrix, 116 tests, 7 Mermaid diagrams, source-verified |

## SCIM Protocol & RFC Compliance

| Document | Description |
|----------|-------------|
| [SCIM_REFERENCE.md](SCIM_REFERENCE.md) | SCIM v2 protocol reference with example payloads |
| [SCIM_COMPLIANCE.md](SCIM_COMPLIANCE.md) | RFC 7643/7644 compliance matrix + Entra compatibility |
| [SCIM_RFC_COMPLIANCE_LAYER.md](SCIM_RFC_COMPLIANCE_LAYER.md) | Technical compliance implementation details |
| [SCIM_CASE_INSENSITIVITY_REFERENCE.md](SCIM_CASE_INSENSITIVITY_REFERENCE.md) | Case-insensitivity rules (RFC 7643 §2.1) |
| [RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md](RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md) | RFC schema & extension URN deep dive |
| [DISCOVERY_ENDPOINTS_RFC_AUDIT.md](DISCOVERY_ENDPOINTS_RFC_AUDIT.md) | Discovery endpoints RFC audit — all gaps resolved |

## Per-Endpoint Configuration

| Document | Description |
|----------|-------------|
| [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | **Complete flag reference** — 13 persisted settings + logLevel |
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
| [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md) | Per-endpoint credentials — 3-tier auth chain |
| [PHASE_09_BULK_OPERATIONS.md](PHASE_09_BULK_OPERATIONS.md) | Bulk operations (RFC 7644 §3.7) |
| [PHASE_10_ME_ENDPOINT.md](PHASE_10_ME_ENDPOINT.md) | /Me endpoint (RFC 7644 §3.11) |
| [PHASE_12_SORTING_AND_DEDUP.md](PHASE_12_SORTING_AND_DEDUP.md) | Sorting + service deduplication |
| [READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md](READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md) | ReadOnly attribute stripping & warning headers |
| [P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md](P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md) | Attribute characteristic enforcement (Phase P2) |
| [P3_REMAINING_ATTRIBUTE_CHARACTERISTIC_GAPS.md](P3_REMAINING_ATTRIBUTE_CHARACTERISTIC_GAPS.md) | Remaining characteristic gaps (Phase P3) |

## Attribute Characteristics & RFC Audits

| Document | Description |
|----------|-------------|
| [P4_ATTRIBUTE_CHARACTERISTIC_DEEP_ANALYSIS.md](P4_ATTRIBUTE_CHARACTERISTIC_DEEP_ANALYSIS.md) | **Latest (v0.37.0)** — source-verified gap analysis, 19 gaps, 3 actionable fixes |
| [ATTRIBUTE_CHARACTERISTICS_GAPS.md](ATTRIBUTE_CHARACTERISTICS_GAPS.md) | Gap matrix — characteristic enforcement status |
| [RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md](RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md) | Full RFC 7643 attribute characteristic audit |
| [RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md](RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md) | Attribute characteristics analysis |

## Testing & Validation

| Document | Description |
|----------|-------------|
| [SCIM_VALIDATOR_RESULTS_32_LEXMARK_ANALYSIS.md](SCIM_VALIDATOR_RESULTS_32_LEXMARK_ANALYSIS.md) | SCIM Validator #32 — Lexmark schema analysis (2 false positives, full compliance) |
| [VALIDATOR_RUN32_FALSE_POSITIVE_ANALYSIS.md](VALIDATOR_RUN32_FALSE_POSITIVE_ANALYSIS.md) | Successful false positive analysis — validator missed issues in passing tests |
| [TESTING-WORKFLOW.md](TESTING-WORKFLOW.md) | Test pyramid — unit, E2E, live, and ISV-specific tests |
| [LIVE_TEST_NORMS_AND_BEST_PRACTICES.md](LIVE_TEST_NORMS_AND_BEST_PRACTICES.md) | Live test conventions — section naming, result tracking |
| [TEST_INVENTORY.md](TEST_INVENTORY.md) | Test file inventory with coverage scope |
| [TEST_FAILURE_ANALYSIS.md](TEST_FAILURE_ANALYSIS.md) | Test failure root cause analysis |
| [SELF_IMPROVING_TEST_HEALTH_PROMPT.md](SELF_IMPROVING_TEST_HEALTH_PROMPT.md) | AI-assisted test health monitoring prompt |
| [PROMPT_LOGGING_VERIFICATION.md](PROMPT_LOGGING_VERIFICATION.md) | **v3.0** Self-improving logging audit — 71-check, 12-section verification prompt |
| [PROMPT_ERROR_HANDLING_VERIFICATION.md](PROMPT_ERROR_HANDLING_VERIFICATION.md) | **v3.0** Self-improving error handling audit — 55-check, 10-section verification prompt |

## Issues, Audits & Root Cause Analysis

| Document | Description |
|----------|-------------|
| [DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md](DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md) | **v0.37.0 deep analysis** — security, SOLID, DRY, DTO, data integrity, RFC gaps, 25-item roadmap |
| [LOGGING_ERROR_HANDLING_QUALITY_AUDIT.md](LOGGING_ERROR_HANDLING_QUALITY_AUDIT.md) | **v3.0 quality audit** — 20-gap register, 5 open, 14 resolved, 1 accepted, source-verified |
| [LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md](LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md) | **v3.0 error handling architecture** — 21 sections, error catalog by status code, 5 Mermaid diagrams, 5-layer error boundary |
| [ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md](ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md) | Historical bug log with RCA and resolution |
| [POST_V034_CHANGES_ROOT_CAUSE_ANALYSIS.md](POST_V034_CHANGES_ROOT_CAUSE_ANALYSIS.md) | **Post-v0.34.0** — 26 commits, 12 issues, N+1 fix, UI bugs, migration risk, auto-prune, 3 Mermaid diagrams |
| [AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md](AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md) | Azure-specific deployment troubleshooting |

## Requirements & Compliance

| Document | Description |
|----------|-------------|
| [TECHNICAL_REQUIREMENTS_DOCUMENT.md](TECHNICAL_REQUIREMENTS_DOCUMENT.md) | Original requirements specification |
| [REPO_API_UNDERSTANDING_BASELINE.md](REPO_API_UNDERSTANDING_BASELINE.md) | API understanding baseline |

## Context & Session Files

| Document | Description |
|----------|-------------|
| [CONTEXT_INSTRUCTIONS.md](CONTEXT_INSTRUCTIONS.md) | AI session context — architecture, file map, conventions |
| [Session_starter.md](../Session_starter.md) | Session memory — progress log, decisions, discoveries |

## API Examples & Artifacts

| Artifact | Location | Description |
|----------|----------|-------------|
| OpenAPI Spec | [openapi/](openapi/) | OpenAPI 3.0 spec — all 82 endpoints, full schemas |
| Postman Collection | [postman/](postman/) | Importable Postman collection — all 82 endpoints, 14 folders |
| Insomnia Collection | [insomnia/](insomnia/) | Importable Insomnia workspace — all 82 endpoints, 14 folders |
| Example JSONs | [examples/](examples/) | Request/response samples for all resource types |
| Extension Examples | [examples/endpoint/create-endpoint-with-custom-extensions.json](examples/endpoint/create-endpoint-with-custom-extensions.json) | 12 one-click endpoint+extension combos + PATCH/User/Group usage examples |
| Mermaid Diagrams | [create-user-sequence.mmd](create-user-sequence.mmd), [list-get-user-sequence.mmd](list-get-user-sequence.mmd) | Sequence diagrams |

> **Note:** All collections were regenerated for v0.37.0 with full 82-endpoint coverage (19 controllers) including multi-tenant endpoint architecture, admin management, per-endpoint credentials, /Me, custom resource types, database browser, activity feed, per-endpoint logs, and structured logging.

## Archived Documentation

| Location | Description |
|----------|-------------|
| [archive/](archive/) | Superseded docs preserved for historical context |

---

## Current Test Counts (v0.37.0)

| Suite | Suites | Tests | Status |
|-------|--------|-------|--------|
| Unit | 82 | 3,241 | ✅ All pass |
| E2E | 46 | 965 | ✅ All pass |
| Live (main) | 43 sections | ~753 | ✅ All pass |
| Live (Lexmark ISV) | 13 sections | 112 | ✅ All pass |
| **Total** | **~184** | **~5,000** | **✅ All pass** |
