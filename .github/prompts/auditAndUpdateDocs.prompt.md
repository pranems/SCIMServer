---
name: auditAndUpdateDocs
description: Audit all project docs, JSONs, and artifacts for staleness and update them to match current repo state with full norms.
argument-hint: Optional scope like a feature name (e.g. "G8g"), doc file path, or "all" for full audit.
---

Perform a comprehensive documentation freshness audit across the entire project. For every doc, JSON artifact, and explanatory resource, verify it reflects the **current** codebase state and update anything stale. This is a **generic, project-wide** prompt - not scoped to a single feature.

---

## Step 1 - Gather Current State (Source-of-Truth Discovery)

### 1A. Read Project Context
Read `Session_starter.md`, `docs/CONTEXT_INSTRUCTIONS.md`, `docs/INDEX.md`, `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md`, `CHANGELOG.md`, and `package.json` to capture the current version, feature set, test counts, and flag inventory.

### 1B. Deep Controller Survey (Endpoint Inventory)
Read **every** `*.controller.ts` file in `api/src/modules/` to build an authoritative endpoint inventory:
- Controller decorator path prefix (`@Controller('...')`)
- Each method decorator (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`)
- Full route path constructed from prefix + method route
- **Status code verification**: Check for `@HttpCode(N)` decorators. If absent, NestJS defaults apply: `@Post` → 201, `@Get/@Put/@Patch` → 200, `@Delete` → 200 (unless `@HttpCode(204)`)
- `@Public()` decorator presence (no auth required)
- `@Header()` and `@Sse()` decorators
- Query parameters via `@Query()` decorators
- Guard and interceptor registrations

**Baseline**: The server has **82 endpoints across 19 controllers** - verify this count after any feature additions.

### 1C. DTO & Response Shape Verification
Read all `*.dto.ts` files and key interfaces to verify documented request/response shapes:
- `api/src/modules/scim/dto/` - CreateUserDto, CreateGroupDto, PatchUserDto, PatchGroupDto, ManualUserDto, ManualGroupDto, SearchRequestDto, BulkRequestDto, ListQueryDto
- `api/src/modules/endpoint/dto/` - CreateEndpointDto, UpdateEndpointDto
- `api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts` - EndpointProfile, ProfileSettings, ServiceProviderConfig, ShorthandProfileInput
- `api/src/modules/scim/common/scim-types.ts` - ScimUserResource, ScimGroupResource, ScimListResponse, ScimMeta
- `api/src/modules/scim/discovery/scim-schemas.constants.ts` - SCIM_SERVICE_PROVIDER_CONFIG constant
- `api/src/modules/endpoint/services/endpoint.service.ts` - EndpointResponse, EndpointStatsResponse, PresetListResponse
- `api/src/modules/activity-parser/activity-parser.service.ts` - ActivitySummary
- `api/src/modules/logging/log-levels.ts` - LogLevel enum, LogCategory enum (verify category count)

### 1D. Scan Tests
Enumerate `*.spec.ts`, `*.e2e-spec.ts`, and `scripts/live-test.ps1` sections for current test counts and coverage scope. Cross-reference with `api/pipeline-unit.json` and `api/pipeline-e2e.json`.

### 1E. Scan Artifacts
Check `docs/openapi/`, `docs/postman/`, `docs/insomnia/`, `docs/examples/`, `docs/images/readme/` for API artifacts that may reference outdated routes, payloads, schemas, or captured server output.

### 1F. Read Prisma Schema
Read `api/prisma/schema.prisma` for current data model, models, fields (especially `profile Json?` vs legacy `config String?`), and relationships.

### 1G. Read Constants & Enums
- `api/src/modules/logging/log-levels.ts` - LogCategory enum (currently 14 categories: http, auth, scim.user, scim.group, scim.patch, scim.filter, scim.discovery, endpoint, database, oauth, scim.bulk, scim.resource, config, general)
- `api/src/modules/scim/dto/bulk-request.dto.ts` - BULK_MAX_OPERATIONS (1000), BULK_MAX_PAYLOAD_SIZE (1048576)
- Profile presets - currently 6: `entra-id`, `entra-id-minimal`, `rfc-standard`, `minimal`, `user-only`, `user-only-with-custom-ext`

---

## Step 2 - Audit Each Document Category

For every document listed in `docs/INDEX.md`, check:

### A. Feature & Phase Docs
(e.g., `G8B_*.md`, `G8C_*.md`, `G8E_*.md`, `G8F_*.md`, `G8G_*.md`, `G11_*.md`, `P2_*.md`, `READONLY_*.md`, `PHASE_09_*.md`, `PHASE_10_*.md`, `PHASE_12_*.md`, `SCHEMA_TEMPLATES_DESIGN.md`, `phases/*.md`)

| Check | What to verify |
|-------|----------------|
| **Version tag** | Does the `Version:` in the header match `package.json`? |
| **Test counts** | Do Unit/E2E/Live test count tables match actual spec files? |
| **Files Changed** | Does the "Files Changed" table list the correct current file paths? |
| **Code snippets** | Do embedded code snippets match the actual implementation? |
| **Architecture diagrams** | Do Mermaid/ASCII diagrams reflect the current flow? |
| **API examples** | Do request/response JSON samples match actual server behavior? |
| **Related docs links** | Are cross-references still valid (no renamed/deleted targets)? |

### B. Reference & Config Docs
(e.g., `ENDPOINT_CONFIG_FLAGS_REFERENCE.md`, `COMPLETE_API_REFERENCE.md`, `SCIM_COMPLIANCE.md`, `SCIM_REFERENCE.md`)

| Check | What to verify |
|-------|----------------|
| **Flag list completeness** | Are all flags from `ProfileSettings` interface listed? |
| **Default values** | Do documented defaults match code? |
| **Applicability matrix** | Does each flag's scope (POST/PUT/PATCH/DELETE/GET) match implementation? |
| **Flag interaction table** | Are all known flag combinations documented? |
| **Request/response examples** | Headers, URLs, bodies, status codes accurate? |
| **Entra ID recommended config** | Still valid for latest features? |
| **Endpoint count** | Does "82 endpoints" / "19 controllers" match actual count? |
| **Filter operator support** | All operators listed as fully supported (`eq`, `ne`, `co`, `sw`, `ew`, `pr`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`) - no stale "limited support" notes |
| **Query parameter completeness** | `sortBy`, `sortOrder`, `attributes`, `excludedAttributes` documented on all list/get endpoints |
| **Bulk/Me/Custom resources** | All three listed in core endpoint tables |
| **Quick reference cards** | ASCII art reference cards include all routes (presets/:name, by-name/:name, /:id/stats, ?view param) |
| **Endpoint summary table** | Full 76-row endpoint summary with method, path, status, auth |
| **Last Updated dates** | Do date headers match the current date or version? |

### C. Architecture & Design Docs
(e.g., `TECHNICAL_DESIGN_DOCUMENT.md`, `USER_API_CALL_TRACE.md`, `MULTI_ENDPOINT_GUIDE.md`, `ENDPOINT_PROFILE_ARCHITECTURE.md`, `ENDPOINT_LIFECYCLE_AND_USAGE.md`)

| Check | What to verify |
|-------|----------------|
| **Layer diagrams** | Do they reflect current Transport → API → Service → Domain → Persistence layers? |
| **Module inventory** | Are all NestJS modules listed? |
| **Prisma model names** | Match current `schema.prisma`? (`profile Json?` not legacy `config String?`) |
| **Dependency versions** | Node, NestJS, Prisma, TypeScript, Jest, PostgreSQL versions current? |
| **Database schema blocks** | Any inline Prisma schema shows `profile Json?` + `credentials EndpointCredential[]` (not `config String?`) |
| **Endpoint management routes** | All 9 admin endpoint routes listed (including presets, presets/:name, by-name/:name, stats) |
| **SCIM operation tables** | Include /Me, /Bulk, custom resource /{resourceType} routes |
| **Auth chain description** | 3-tier: per-endpoint credentials → OAuth JWT → legacy bearer |

### D. Testing & Validation Docs
(e.g., `LIVE_TEST_NORMS_AND_BEST_PRACTICES.md`, `TESTING-WORKFLOW.md`, `COLLISION-TESTING-GUIDE.md`)

| Check | What to verify |
|-------|----------------|
| **Test counts** | Match actual `unit-results.json`, `e2e-results.json`, and live-test assertion count? |
| **Test file lists** | Are all spec files mentioned? Any missing new ones? |
| **Live-test section list** | Does it match actual sections in `scripts/live-test.ps1`? |
| **Example commands** | Are npm scripts, docker commands, and PowerShell invocations still correct? |

### E. API Collections & Tooling Artifacts
(e.g., `docs/openapi/*.json`, `docs/postman/*.json`, `docs/insomnia/*.json`, `docs/examples/*.json`, `docs/examples/endpoint/*.json`, `docs/images/readme/*.json`)

| Check | What to verify |
|-------|----------------|
| **Endpoint coverage** | Does the collection cover all 82 endpoints (19 controllers)? Calculate coverage % |
| **Multi-tenant path structure** | All SCIM paths use `/endpoints/{endpointId}/...` (not root `/Users`, `/Groups`) |
| **Route accuracy** | Every path in the collection matches an actual controller route |
| **Query parameters** | All `?view`, `?active`, `?filter`, `?sortBy`, `?sortOrder`, `?attributes`, `?excludedAttributes`, `?startIndex`, `?count` params documented |
| **Status codes** | Match actual NestJS decorator status codes (POST→201 unless `@HttpCode`, DELETE→`@HttpCode(204)`) |
| **Schema definitions** | JSON schemas match current DTOs and response shapes (check `additionalProperties`, required fields) |
| **Headers** | `Content-Type: application/scim+json`, auth patterns, `If-Match`/`If-None-Match` documented |
| **Example payloads** | Sample request/response bodies match current server output |
| **Auth schemes** | `specUri`, `documentationUri`, `primary` fields present on authentication schemes |
| **Constant values** | `maxOperations` (1000), `maxPayloadSize` (1048576), `maxResults` (200) match source constants |
| **Postman variables** | `baseUrl`, `token`, `endpointId`, `userId`, `groupId` defined; auto-capture test scripts set variables |
| **Insomnia environments** | Local and Docker environments with correct port numbers |

### E2. Example JSON Files
(e.g., `docs/examples/user.json`, `group.json`, `bulk-request.json`, `serviceproviderconfig.json`, `log-config-response.json`, `schema_custom_extension.json`, etc.)

| Check | What to verify |
|-------|----------------|
| **Log categories** | Only list categories that exist in `LogCategory` enum (11 categories - no phantom `backup`) |
| **Bulk constants** | `maxOperations: 1000` (not 100), `failOnErrors` field present |
| **Auth scheme completeness** | `specUri`, `documentationUri`, `primary` fields on authenticationSchemes |
| **Mutability casing** | RFC 7643 requires lowercase: `readWrite`, `readOnly`, `immutable`, `writeOnly` (not PascalCase) |
| **Uniqueness field** | Present on schema attribute definitions |
| **Preset examples** | All 6 presets covered (`entra-id`, `entra-id-minimal`, `rfc-standard`, `minimal`, `user-only`, `lexmark`) |
| **Meta.location** | Uses relative paths consistent with other examples (not absolute URLs) |
| **`_comment` accuracy** | Descriptive comments match actual content |

### E3. Captured Server Output
(e.g., `docs/images/readme/version-latest.json`, `docs/images/readme/recent-logs-latest.json`)

| Check | What to verify |
|-------|----------------|
| **Version field** | Matches current `package.json` version |
| **migratePhase** | References current phase description and version |
| **Log categories** | Only valid `LogCategory` values appear |

### F. Session & Context Files
(e.g., `Session_starter.md`, `docs/CONTEXT_INSTRUCTIONS.md`, `docs/PROJECT_HEALTH_AND_STATS.md`)

| Check | What to verify |
|-------|----------------|
| **Version** | Matches `package.json` |
| **Test counts** | Match latest run results |
| **Feature list** | All implemented features/phases listed |
| **Open gaps** | Remaining gaps list is current |
| **Stack versions** | Node, NestJS, Prisma, TS, Jest versions current |
| **Endpoint count** | 82 endpoints / 19 controllers (or updated if changed) |
| **Doc count** | Total active docs in `docs/` matches INDEX.md header |

### G. Deployment & Infra Docs
(e.g., `DEPLOYMENT.md`, `DOCKER_GUIDE_AND_TEST_REPORT.md`, `AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md`, `SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md`)

| Check | What to verify |
|-------|----------------|
| **Dockerfile references** | Do they match actual Dockerfile, Dockerfile.optimized, Dockerfile.ultra? |
| **Environment variables** | All required env vars documented (`SCIM_SHARED_SECRET`, `OAUTH_CLIENT_SECRET`, `JWT_SECRET`, `OAUTH_CLIENT_ID`, `PERSISTENCE_BACKEND`, `DATABASE_URL`)? |
| **Bicep templates** | Match `infra/*.bicep` files? |
| **Port numbers** | Correct for local (3000/6000), Docker (8080), Azure? |
| **API prefix** | `/scim` prefix and `/scim/v2/*` → `/scim/*` URL rewriting documented? |

### H. Format Migration Detection
Search across ALL docs for stale data formats that have been superseded:

| Stale Pattern | Current Format | How to Find |
|---------------|----------------|-------------|
| `"config": { "FlagName": "True" }` | `"profile": { "settings": { "FlagName": "True" } }` | `grep -r '"config":' docs/` (exclude archive/, REMOTE_DEBUGGING, ENDPOINT_CONFIG_FLAGS migration notes) |
| `config String?` (Prisma) | `profile Json?` | Search for `config` in schema blocks |
| `maxOperations: 100` | `maxOperations: 1000` | Search for `maxOperations` |
| `"backup"` log category | Remove - only 14 categories exist | Search for `backup` in log category lists |
| `mutability: "ReadWrite"` | `mutability: "readWrite"` (lowercase per RFC 7643) | Search for PascalCase mutability values |
| Root-level SCIM paths `/Users` | Endpoint-scoped `/endpoints/{eid}/Users` | Ensure all operational examples use multi-tenant paths |
| `"8 endpoints"` (LogConfigController) | `"10 endpoints"` | Search for endpoint count near log-config |
| Stale filter operator notes | All operators fully supported | Search for "limited support" near filter operators |

---

## Step 3 - Documentation Norms (Mandatory for All Updates)

Every updated or new doc section **MUST** include the following where applicable:

### Diagrams & Flows
- **Mermaid diagrams** for architecture, data flows, decision trees, and sequence flows
- **ASCII art** for inline flow summaries in code-adjacent contexts
- **Decision flow diagrams** for flag resolution, error handling, and branching logic

### Request/Response Examples
- **Full HTTP request**: method, URL (with query params), headers (`Content-Type`, `Authorization`, `If-Match`), body (JSON with `schemas` array)
- **Full HTTP response**: status code, headers (`ETag`, `Location`), body (JSON with `id`, `meta`, `schemas`)
- **Error responses**: SCIM error format with `status`, `scimType`, `detail`
- **Multiple examples** per feature: success case, error case, edge case

### JSON Examples
```json
// Example: Request body for POST /Users
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "jdoe@example.com",
  "displayName": "John Doe",
  "active": true,
  "emails": [{ "value": "jdoe@example.com", "type": "work", "primary": true }]
}
```

```json
// Example: SCIM Error Response (409 Conflict)
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "A user with userName 'jdoe@example.com' already exists."
}
```

### Tables
- **Test coverage tables** with `#`, `Test`, `Validates` columns (unit, E2E, live)
- **Flag applicability matrices** with operations as columns
- **Files Changed** tables with `File` and `Change` columns
- **Before/After** comparison tables for behavioral changes

### Cross-References
- Link to related docs, source files, and RFC sections
- Use relative paths from `docs/` directory
- Link to test files for verification

---

## Step 4 - Apply Updates

For each stale item found:

1. **Update in-place**: Edit the existing document - do NOT create new files unless a genuinely new topic needs its own doc.
2. **Preserve structure**: Keep the existing document layout; add/update sections as needed.
3. **Update `docs/INDEX.md`**: If any new docs were created or descriptions changed, update the index.
4. **Update version/date headers**: Bump `Last Updated` and `Version` fields in doc headers.
5. **Update `CHANGELOG.md`**: Note documentation updates in the current version entry.
6. **Update `Session_starter.md`**: Reflect documentation freshness status.

---

## Step 5 - Verify Cross-Consistency

After all updates, perform a final cross-check:

1. **Version consistency**: `package.json` version matches all doc headers, `CHANGELOG.md`, `Session_starter.md`, `CONTEXT_INSTRUCTIONS.md`, and `PROJECT_HEALTH_AND_STATS.md`.
2. **Test count consistency**: Unit, E2E, and live counts match across all documents that reference them.
3. **Flag count consistency**: All docs that reference flag counts or list flag names are in sync with `ProfileSettings` interface (13 boolean flags + logLevel + PrimaryEnforcement; settings v7).
4. **Endpoint count consistency**: All docs that mention endpoint counts say "82 endpoints across 19 controllers" (or the updated number if features were added).
5. **Link validation**: All `[text](path)` links in docs resolve to existing files. Check for renamed/deleted targets.
6. **Index completeness**: Every doc in `docs/` has an entry in `docs/INDEX.md`.
7. **Preset count**: All docs that list presets include all 6: `entra-id`, `entra-id-minimal`, `rfc-standard`, `minimal`, `user-only`, `user-only-with-custom-ext`.
8. **Log category count**: All docs listing log categories show exactly 14 (not 11 - added scim.bulk, scim.resource, config in v0.33.0).
9. **Date header freshness**: No doc has a "Last Updated" date older than the current version's release date.
10. **API collection coverage**: OpenAPI/Postman/Insomnia collections cover 100% of endpoints. INDEX.md description reflects actual coverage.
11. **Format migration completeness**: No remaining `"config": {` patterns in active docs (outside archive/ and intentional migration notes).
12. **Capture files**: `docs/images/readme/version-latest.json` version matches `package.json`.

---

## Step 6 - Self-Update This Prompt

After completing the audit, review **this prompt itself** for freshness:

1. **Endpoint count**: If the endpoint/controller count changed from 76/18, update all references in this prompt (Steps 1B, 2B, 2E, 5.4).
2. **New document categories**: If new types of docs (e.g., performance benchmarks, security audit docs, ADRs) were added, add a new sub-section under Step 2.
3. **New artifact directories**: If new artifact folders beyond `openapi/`, `postman/`, `insomnia/`, `examples/`, `images/readme/` were created, add them to Section E.
4. **New config flags**: If the flag count changed from 15 boolean + logLevel + PrimaryEnforcement (13 persisted in ProfileSettings + 2 derived), update all references.
5. **New log categories**: If `LogCategory` enum changed from 14 entries, update Section 1G and the format migration table.
6. **New presets**: If presets beyond the current 6 were added, update Section 1G and cross-consistency checks.
7. **New bulk/SPC constants**: If `BULK_MAX_OPERATIONS`, `BULK_MAX_PAYLOAD_SIZE`, or `maxResults` changed, update format migration table.
8. **New documentation norms**: If the team adopted new standards (e.g., ADR format, PlantUML, Swagger UI), add them to Step 3.
9. **Retired docs**: If any docs listed in this prompt were deleted or merged, remove references.
10. **New context files**: If new session/context files were introduced, add them to Section F.
11. **Port/URL changes**: If default ports or deployment URLs changed, update Section G.
12. **New stale patterns**: If new format migration patterns were discovered during the audit, add them to Section H.
13. **Auth chain changes**: If the authentication flow changed (e.g., new auth tier), update Section C.

Apply updates directly to this file (`.github/prompts/auditAndUpdateDocs.prompt.md`) so future runs remain accurate.

---

## Standing Rules

- Follow the project's Feature/Bug-Fix Commit Checklist from `.github/copilot-instructions.md`.
- Do NOT create new documentation files unless a genuinely new topic requires one.
- Prefer updating existing docs over creating new ones.
- All Mermaid diagrams must be valid syntax (test with a renderer if possible).
- JSON examples must be valid JSON (no trailing commas, proper quoting).
- Use lowercase for SCIM attribute characteristics per RFC 7643 (`readWrite`, not `ReadWrite`).
- When recreating API collections (OpenAPI/Postman/Insomnia), target 100% endpoint coverage.
- Verify status codes from source decorators, not from documentation assumptions.
- When fixing stale `"config"` format, check ENDPOINT_CONFIG_FLAGS_REFERENCE.md migration notes - some `"config"` references are intentional historical examples.
- For log category lists, always verify against `LogCategory` enum in source - do not add categories that don't exist.
- Quick reference cards (ASCII art) must match the actual route inventory.

---

## Audit History (Self-Improving Section)

> Update this section after each audit run. Track scope, findings, and patterns.

| Date | Version | Scope | Stale Items Found | Key Patterns |
|------|---------|-------|-------------------|-------------|
| 2026-03-02 | v0.24.0 | Full audit | 59 across 28 files | Test count propagation, flag name corrections, broken links |
| 2026-03-31 | v0.31.0 | Full audit + JSON recreation | ~25 across 14 files + 3 collections | Format migration (`config`→`profile.settings`), phantom log categories, API collection coverage gap (35-40%→100%), stale constants (maxOperations), RFC casing violations, missing routes in quick ref cards, stale filter operator notes |
| 2026-04-10 | v0.34.0 | Post-deletedAt removal audit | ~8 across 5 files | Stale `deletedAt`/`guardSoftDeleted`/`softDeleted` in 30+ docs (fixed in prior session), stale category counts (11→14 in 3 files), stale test counts (3,191→3,171), stale live test assertions (~951→~739 after dead soft-delete tests removed) |
| 2026-04-15 | v0.36.0 | Post-P0/P1/P2/P3 perf hardening | 16 across 6 files | Version 0.35→0.36, unit 80→82 suites / 3,206→3,237 tests (added auto-prune + timeout specs), fullValidationPipeline baseline update, INDEX version refs v0.35→v0.36 |
| 2026-04-15 | v0.35.0 | Post-UI overhaul audit | 22 across 7 files | E2E count 45→46/950→960 (test-gaps-audit-3), doc count 52→64 active, fullValidationPipeline baselines v0.34→v0.35, CHANGELOG missing web UI test entries + Playwright suite |
| 2026-04-10 | v0.34.0 | Post-P4 fixes full audit | ~20 across 16 files | Endpoint count 76→82 (19 controllers), test counts propagation (3,185 unit/923 E2E/45 suites), version headers 0.31.0→0.34.0 in 8 docs, StrictSchema default documented as false (actual: true), P4 immutable/required now unconditional |
| 2026-04-16 | v0.37.1 | Post error-handling audit | 12 across 9 files + 1 JSON | Unit 83→84 suites / 3,265→3,311 tests (error-handling + generic-resource tests), maxOperations 100→1000 in 2 files, stale backup module ref, doc count 65→67, pipeline-unit.json regenerated |
| 2026-04-17 | v0.37.1 | Post logging+tests audit | 10 across 8 files + 2 JSONs | Unit 3,311→3,318 (+7 interceptor/endpointId), E2E 46→47 suites / 969→986 (+17 test-gaps-audit-4), phantom `backup` category in recent-logs-latest.json (regenerated), pipeline-e2e.json regenerated, CHANGELOG/Session updated with endpointId persistence + Bicep logging defaults |
| 2026-04-21 | v0.37.2 | Post manager PATCH fix + test gap audit | ~25 across 10 files + 2 JSONs + 1 HTML | Unit 3,318->3,345 (+27 schema-validator/service tests), E2E 47->49 suites / 986->1,025 (+39 manager-patch/error-allowlist/group-filters/projection), doc count 67->68, version headers 0.37.1->0.37.2 in 7 files, phantom `backup` category in recent-logs-latest.html, pipeline JSONs regenerated |
| 2026-04-23 | v0.38.0 | Post G8h + RFC audit + test gap audit #5 | ~30 across 22 files + 3 JSONs | Version 0.37.x->0.38.0 in 18 files, test counts 3,345->3,378 unit / 1,025->1,074 E2E / 49->51 suites, added PrimaryEnforcement flag section to ENDPOINT_CONFIG_FLAGS_REFERENCE.md, pipeline JSONs regenerated, version-latest.json synced, CHANGELOG updated with RFC + audit entries, OpenAPI/Postman/Insomnia version refs |
| 2026-04-23 | v0.38.0 | Post passthrough-default freshness audit | ~55 across ~30 files | PrimaryEnforcement default normalize->passthrough in CHANGELOG + G8H doc (10 fixes), version headers 0.35.0->0.38.0 in 20+ docs, test counts propagated (3,378/1,074/~789) to 8 docs, flag counts 13+logLevel->13+logLevel+PrimaryEnforcement in 4 docs, doc count 68->69, Session_starter Status/Current Focus updated |
### Common Staleness Patterns Discovered

| Pattern | Files Typically Affected | Detection Method |
|---------|------------------------|-----------------|
| Old `"config"` endpoint format | Feature docs (G8B, PHASE_09, SOFT_DELETE, MULTI_MEMBER_PATCH) | `grep '"config":' docs/*.md` |
| Phantom `backup` log category | log-config-response.json, LOGGING_AND_OBSERVABILITY.md | Compare doc lists vs `LogCategory` enum |
| `maxOperations: 100` (should be 1000) | serviceproviderconfig.json, OpenAPI specs | `grep maxOperations docs/` |
| PascalCase mutability/returned | schema_custom_extension.json, inline examples | `grep -i '"ReadWrite"\|"ReadOnly"' docs/` |
| Missing routes in endpoint tables | MULTI_ENDPOINT_GUIDE, SCIM_REFERENCE, ENDPOINT_LIFECYCLE | Compare table rows vs controller survey |
| Missing query params (?view, ?active) | ENDPOINT_LIFECYCLE, MULTI_ENDPOINT_GUIDE | Compare `@Query()` decorators vs docs |
| Stale Prisma schema in inline blocks | MULTI_ENDPOINT_GUIDE, TECHNICAL_DESIGN_DOCUMENT | Search for `config String?` in code blocks |
| API collection coverage gap | INDEX.md descriptions, OpenAPI/Postman/Insomnia files | Count operations vs 82 baseline |
| Stale "Last Updated" date headers | ENDPOINT_CONFIG_FLAGS_REFERENCE, SCIM_REFERENCE | Search for `Last Updated.*2026-` and compare |
| Stale feature support notes | SCIM_REFERENCE (filter operators) | Search for \"limited support\" |\n| Stale PrimaryEnforcement default | G8H doc, CHANGELOG, ENDPOINT_CONFIG_FLAGS | Search for `normalize (default)` or `default.*normalize` - should be `passthrough (default)` |
- Every numeric claim (test counts, flag counts, LoC) must be freshly measured - never copy from stale docs.
- Use the `updateProjectHealth` prompt for full stats refresh if `PROJECT_HEALTH_AND_STATS.md` is significantly stale.
