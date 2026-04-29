# SCIMServer Documentation Index

> **Version:** 0.40.0 - **Updated:** April 28, 2026  
> 83 API routes - 19 controllers - 6 presets - 16 config flags - 4,557 tests (3,429 unit + 1,128 E2E)

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
| [README_VISUAL_STUDIO_DEBUG.md](README_VISUAL_STUDIO_DEBUG.md) | VS Code debugging - launch configs, remote attach |
| [REMOTE_DEBUGGING_AND_DIAGNOSIS.md](REMOTE_DEBUGGING_AND_DIAGNOSIS.md) | Zero-access diagnosis - SSE, ring buffer, per-endpoint isolation, 4 workflows |

## Architecture & Design

| Document | Description |
|----------|-------------|
| [COMPLETE_API_REFERENCE.md](COMPLETE_API_REFERENCE.md) | **Full REST API** - all 83 routes, request/response examples, route summary table |
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
| OpenAPI Spec | [openapi/](openapi/) | OpenAPI 3.0 spec - all 83 endpoints, full schemas |
| Postman Collection | [postman/](postman/) | Importable Postman collection - all 83 endpoints, 14 folders |
| Insomnia Collection | [insomnia/](insomnia/) | Importable Insomnia workspace - all 83 endpoints, 14 folders |
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
| E2E | 53 | 1,128 | All pass |
| Live (main) | 60 sections | ~817 | All pass |
| Live (Lexmark ISV) | 13 sections | 112 | All pass |
| **Total** | **~210** | **~5,486** | **All pass** |

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
