---
name: apiContractVerification
description: >
  Self-improving prompt that verifies every API endpoint returns exactly the
  documented response shape at ALL test levels (unit, integration, E2E, live).
  Covers all ~82 endpoints, all flows, all combinations. Learns from each
  execution and updates itself with new findings, patterns, and coverage.
argument-hint: >
  Optional scope like "admin endpoints", "SCIM Users", "full audit",
  "self-improve", or a specific endpoint path to narrow the audit.
---

# API Contract Verification - Self-Improving Prompt

Perform a comprehensive API response contract verification across **all ~82 endpoints**, at **all test levels** (unit, integration, E2E, live). This ensures every JSON response matches its documented shape exactly - no leaked internal fields, no missing required fields, no Map/Set serialization artifacts. This prompt **learns from each execution** and **updates itself** with new findings.

---

## Meta: Self-Improvement Protocol

> **This prompt is a living document.** Every execution MUST end with the self-improvement step (Step 10). The prompt improves itself by:

### How Self-Improvement Works

1. **Discovery Loop**: Each execution scans the codebase for NEW endpoints, controllers, response shapes, and test files not yet documented here.
2. **Gap Detection**: Compare discovered endpoints against the coverage matrix. Any uncovered endpoint is flagged and added.
3. **Pattern Harvesting**: When a new assertion pattern, test helper, or verification technique is found in the codebase, extract and add it to the Patterns section.
4. **Failure Learning**: When a contract violation is found, document the root cause, the fix, and the detection technique in the Audit History and the Anti-Patterns table.
5. **Prompt Rewrite**: At the end of each execution, update THIS FILE directly with:
   - New endpoints added to the inventory
   - New response contracts defined
   - New test patterns discovered
   - Coverage matrix updated with current status
   - New anti-patterns learned
   - Audit History entry appended
   - Execution count incremented
6. **Confidence Scoring**: Each coverage cell gets a confidence score:
   - ✅ = contract test exists AND passes
   - ⚠️ = partial coverage (presence-only, no strict allowlist)
   - ❌ = no contract test at this level
   - 🆕 = new endpoint, not yet audited

### Self-Improvement Triggers

- **New controller file** added → re-scan all `@Get/@Post/@Put/@Patch/@Delete` handlers
- **New response field** added to any DTO/interface → update allowlist
- **New `_`-prefixed field** in any class → add to denylist
- **New test file** created → check if it includes contract assertions
- **Bug found** in production/staging → add root cause + detection pattern
- **Test suite count changes** → update execution metadata

### Execution Metadata

```yaml
promptVersion: 2.1.0
lastExecution: 2026-04-21
executionCount: 3
totalEndpoints: 82
coveredEndpoints: 22
coveragePercent: 26.8%
testSuiteCount: 84
totalTests: 3345
lastKnownVersion: v0.37.2
```

---

## Why This Prompt Exists

This prompt was created after a production bug where:
1. `_schemaCaches` (an internal runtime cache containing ES6 Map/Set objects) leaked into admin endpoint GET responses
2. Map objects serialized to `{}` via `JSON.stringify`, exposing empty internal fields
3. `getExtensionUrns()` returned extensions from ALL resource types instead of filtering per `coreSchemaUrn`
4. 4 of 16 Azure endpoints showed the leak - none of the 3,300+ tests caught it

**Root cause**: Every test asserted field presence (`toHaveProperty`) but none asserted field absence (`not.toHaveProperty`) or exclusive key sets (`Object.keys().sort() === allowlist`).

---

## Step 1 - Discovery: Inventory ALL API Endpoints

> **Self-improvement note:** Every execution must re-scan for new endpoints. If the count differs from `totalEndpoints` in metadata, update the inventory.

### 1.1 Read Context Files

1. `Session_starter.md` - project state, version, test counts
2. `docs/COMPLETE_API_REFERENCE.md` - documented endpoints
3. `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md` - config flag behaviors
4. `docs/INDEX.md` - feature documentation index

### 1.2 Controller Survey

Scan ALL controllers in `api/src/modules/` - list every `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete` handler:

```bash
grep -rn "@Get\|@Post\|@Put\|@Patch\|@Delete" api/src/modules/ --include="*.controller.ts"
```

### 1.3 Complete Endpoint Inventory (~82 endpoints)

#### Category A - Health & Web (Public)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| A1 | GET | `/scim/health` | `HealthController` | None |
| A2 | GET | `/` | `WebController` | None |

#### Category B - OAuth (Public)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| B1 | GET | `/scim/oauth/test` | `OAuthController` | None |
| B2 | POST | `/scim/oauth/token` | `OAuthController` | client_credentials |

#### Category C - Discovery: Root-Level (Public)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| C1 | GET | `/scim/ServiceProviderConfig` | `ServiceProviderConfigController` | None |
| C2 | GET | `/scim/Schemas` | `SchemasController` | None |
| C3 | GET | `/scim/Schemas/:uri` | `SchemasController` | None |
| C4 | GET | `/scim/ResourceTypes` | `ResourceTypesController` | None |
| C5 | GET | `/scim/ResourceTypes/:id` | `ResourceTypesController` | None |

#### Category D - Discovery: Endpoint-Scoped (Public)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| D1 | GET | `/scim/endpoints/:eid/ServiceProviderConfig` | `EndpointScimDiscoveryController` | None |
| D2 | GET | `/scim/endpoints/:eid/Schemas` | `EndpointScimDiscoveryController` | None |
| D3 | GET | `/scim/endpoints/:eid/Schemas/:uri` | `EndpointScimDiscoveryController` | None |
| D4 | GET | `/scim/endpoints/:eid/ResourceTypes` | `EndpointScimDiscoveryController` | None |
| D5 | GET | `/scim/endpoints/:eid/ResourceTypes/:id` | `EndpointScimDiscoveryController` | None |

#### Category E - Admin: Endpoint Management (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| E1 | POST | `/scim/admin/endpoints` | `EndpointController` | Admin Bearer |
| E2 | GET | `/scim/admin/endpoints` | `EndpointController` | Admin Bearer |
| E3 | GET | `/scim/admin/endpoints/presets` | `EndpointController` | Admin Bearer |
| E4 | GET | `/scim/admin/endpoints/presets/:name` | `EndpointController` | Admin Bearer |
| E5 | GET | `/scim/admin/endpoints/:id` | `EndpointController` | Admin Bearer |
| E6 | GET | `/scim/admin/endpoints/by-name/:name` | `EndpointController` | Admin Bearer |
| E7 | PATCH | `/scim/admin/endpoints/:id` | `EndpointController` | Admin Bearer |
| E8 | DELETE | `/scim/admin/endpoints/:id` | `EndpointController` | Admin Bearer |
| E9 | GET | `/scim/admin/endpoints/:id/stats` | `EndpointController` | Admin Bearer |

#### Category F - Admin: Per-Endpoint Credentials (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| F1 | POST | `/scim/admin/endpoints/:eid/credentials` | `AdminCredentialController` | Admin Bearer |
| F2 | GET | `/scim/admin/endpoints/:eid/credentials` | `AdminCredentialController` | Admin Bearer |
| F3 | DELETE | `/scim/admin/endpoints/:eid/credentials/:cid` | `AdminCredentialController` | Admin Bearer |

#### Category G - Admin: General (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| G1 | GET | `/scim/admin/version` | `AdminController` | Admin Bearer |
| G2 | GET | `/scim/admin/logs` | `AdminController` | Admin Bearer |
| G3 | GET | `/scim/admin/logs/:id` | `AdminController` | Admin Bearer |
| G4 | POST | `/scim/admin/logs/clear` | `AdminController` | Admin Bearer |
| G5 | POST | `/scim/admin/logs/prune` | `AdminController` | Admin Bearer |
| G6 | POST | `/scim/admin/users/manual` | `AdminController` | Admin Bearer |
| G7 | POST | `/scim/admin/groups/manual` | `AdminController` | Admin Bearer |
| G8 | POST | `/scim/admin/users/:id/delete` | `AdminController` | Admin Bearer |

#### Category H - Admin: Log Configuration (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| H1 | GET | `/scim/admin/log-config` | `LogConfigController` | Admin Bearer |
| H2 | PUT | `/scim/admin/log-config` | `LogConfigController` | Admin Bearer |
| H3 | PUT | `/scim/admin/log-config/level/:level` | `LogConfigController` | Admin Bearer |
| H4 | PUT | `/scim/admin/log-config/category/:cat/:lvl` | `LogConfigController` | Admin Bearer |
| H5 | PUT | `/scim/admin/log-config/endpoint/:eid/:lvl` | `LogConfigController` | Admin Bearer |
| H6 | DELETE | `/scim/admin/log-config/endpoint/:eid` | `LogConfigController` | Admin Bearer |
| H7 | GET | `/scim/admin/log-config/recent` | `LogConfigController` | Admin Bearer |
| H8 | DELETE | `/scim/admin/log-config/recent` | `LogConfigController` | Admin Bearer |
| H9 | GET | `/scim/admin/log-config/stream` | `LogConfigController` | SSE + Bearer |
| H10 | GET | `/scim/admin/log-config/download` | `LogConfigController` | Admin Bearer |
| H11 | GET | `/scim/admin/log-config/audit` | `LogConfigController` | Admin Bearer |
| H12 | GET | `/scim/admin/log-config/prune` | `LogConfigController` | Admin Bearer |
| H13 | PUT | `/scim/admin/log-config/prune` | `LogConfigController` | Admin Bearer |

#### Category I - Admin: Database Browser (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| I1 | GET | `/scim/admin/database/users` | `DatabaseController` | Admin Bearer |
| I2 | GET | `/scim/admin/database/users/:id` | `DatabaseController` | Admin Bearer |
| I3 | GET | `/scim/admin/database/groups` | `DatabaseController` | Admin Bearer |
| I4 | GET | `/scim/admin/database/groups/:id` | `DatabaseController` | Admin Bearer |
| I5 | GET | `/scim/admin/database/statistics` | `DatabaseController` | Admin Bearer |

#### Category J - Admin: Activity Feed (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| J1 | GET | `/scim/admin/activity` | `ActivityController` | Admin Bearer |
| J2 | GET | `/scim/admin/activity/summary` | `ActivityController` | Admin Bearer |

#### Category K - SCIM: Users (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| K1 | POST | `/scim/endpoints/:eid/Users` | `EndpointScimUsersController` | Endpoint Bearer |
| K2 | GET | `/scim/endpoints/:eid/Users` | `EndpointScimUsersController` | Endpoint Bearer |
| K3 | GET | `/scim/endpoints/:eid/Users/:id` | `EndpointScimUsersController` | Endpoint Bearer |
| K4 | POST | `/scim/endpoints/:eid/Users/.search` | `EndpointScimUsersController` | Endpoint Bearer |
| K5 | PUT | `/scim/endpoints/:eid/Users/:id` | `EndpointScimUsersController` | Endpoint Bearer |
| K6 | PATCH | `/scim/endpoints/:eid/Users/:id` | `EndpointScimUsersController` | Endpoint Bearer |
| K7 | DELETE | `/scim/endpoints/:eid/Users/:id` | `EndpointScimUsersController` | Endpoint Bearer |

#### Category L - SCIM: Groups (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| L1 | POST | `/scim/endpoints/:eid/Groups` | `EndpointScimGroupsController` | Endpoint Bearer |
| L2 | GET | `/scim/endpoints/:eid/Groups` | `EndpointScimGroupsController` | Endpoint Bearer |
| L3 | GET | `/scim/endpoints/:eid/Groups/:id` | `EndpointScimGroupsController` | Endpoint Bearer |
| L4 | POST | `/scim/endpoints/:eid/Groups/.search` | `EndpointScimGroupsController` | Endpoint Bearer |
| L5 | PUT | `/scim/endpoints/:eid/Groups/:id` | `EndpointScimGroupsController` | Endpoint Bearer |
| L6 | PATCH | `/scim/endpoints/:eid/Groups/:id` | `EndpointScimGroupsController` | Endpoint Bearer |
| L7 | DELETE | `/scim/endpoints/:eid/Groups/:id` | `EndpointScimGroupsController` | Endpoint Bearer |

#### Category M - SCIM: /Me (OAuth JWT)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| M1 | GET | `/scim/endpoints/:eid/Me` | `ScimMeController` | OAuth JWT |
| M2 | PUT | `/scim/endpoints/:eid/Me` | `ScimMeController` | OAuth JWT |
| M3 | PATCH | `/scim/endpoints/:eid/Me` | `ScimMeController` | OAuth JWT |
| M4 | DELETE | `/scim/endpoints/:eid/Me` | `ScimMeController` | OAuth JWT |

#### Category N - SCIM: Bulk (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| N1 | POST | `/scim/endpoints/:eid/Bulk` | `EndpointScimBulkController` | Endpoint Bearer |

#### Category O - SCIM: Custom / Generic Resources (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| O1 | POST | `/scim/endpoints/:eid/:resourceType` | `EndpointScimGenericController` | Endpoint Bearer |
| O2 | GET | `/scim/endpoints/:eid/:resourceType` | `EndpointScimGenericController` | Endpoint Bearer |
| O3 | GET | `/scim/endpoints/:eid/:resourceType/:id` | `EndpointScimGenericController` | Endpoint Bearer |
| O4 | POST | `/scim/endpoints/:eid/:resourceType/.search` | `EndpointScimGenericController` | Endpoint Bearer |
| O5 | PUT | `/scim/endpoints/:eid/:resourceType/:id` | `EndpointScimGenericController` | Endpoint Bearer |
| O6 | PATCH | `/scim/endpoints/:eid/:resourceType/:id` | `EndpointScimGenericController` | Endpoint Bearer |
| O7 | DELETE | `/scim/endpoints/:eid/:resourceType/:id` | `EndpointScimGenericController` | Endpoint Bearer |

#### Category P - Endpoint-Scoped Logs (Bearer)

| # | Method | Path | Controller | Auth |
|---|--------|------|------------|------|
| P1 | GET | `/scim/endpoints/:eid/logs/recent` | `EndpointLogController` | Endpoint Bearer |
| P2 | GET | `/scim/endpoints/:eid/logs/stream` | `EndpointLogController` | SSE + Bearer |
| P3 | GET | `/scim/endpoints/:eid/logs/download` | `EndpointLogController` | Endpoint Bearer |
| P4 | GET | `/scim/endpoints/:eid/logs/history` | `EndpointLogController` | Endpoint Bearer |

---

## Step 2 - Define Response Contracts

> **Self-improvement note:** When new response fields are added to any DTO, interface, or serializer, update the corresponding allowlist below. When new `_`-prefixed runtime fields are added to any class, add them to the denylist.

### Global Denylist (applies to ALL JSON responses)

These fields must **NEVER** appear in any API response at any level:

| Field | Reason |
|-------|--------|
| `_schemaCaches` | Runtime schema cache (Map/Set serializes to `{}`) |
| `_prismaMetadata` | ORM artifacts |
| `_rawPayload` | Internal storage field |
| `_version` | Internal version counter |
| `endpointId` | Internal routing field (use endpoint scoping instead) |
| `scimId` | Internal DB ID (should be mapped to `id`) |
| `password` | Must never be returned (RFC 7643 §8.4) |
| Any `_`-prefixed key (except `_links`) | Convention: `_` prefix = internal-only |

### A. Admin Endpoint Responses

| Endpoint | Method | Response Keys (Allowlist) |
|----------|--------|--------------------------|
| E1: Create endpoint | POST | `id, name, displayName, description, profile, active, scimBasePath, createdAt, updatedAt, _links` |
| E2: List endpoints | GET | Envelope: `totalResults, endpoints[]` - each element = summary shape |
| E3: List presets | GET | `presets[]` - each: `name, displayName, description` |
| E4: Get preset | GET | Full preset object with profile content |
| E5: Get endpoint (full) | GET | `id, name, displayName, description, profile, active, scimBasePath, createdAt, updatedAt, _links` |
| E5+`?view=summary` | GET | `id, name, displayName, description, profileSummary, active, scimBasePath, createdAt, updatedAt, _links` |
| E6: Get by name | GET | Same as E5 full view |
| E7: Patch endpoint | PATCH | Same as E5 full view |
| E8: Delete endpoint | DELETE | 204 No Content (empty body) |
| E9: Endpoint stats | GET | `users, groups, genericResources, total, endpointId, endpointName` |

**Profile sub-object allowlist**: `schemas, settings, resourceTypes, serviceProviderConfig`
**ProfileSummary sub-object**: `schemaCount, schemas, resourceTypeCount, resourceTypes, serviceProviderConfig, activeSettings`
**_links sub-object**: `self, stats, credentials, scim`

### B. Admin Credential Responses

| Endpoint | Method | Response Keys (Allowlist) |
|----------|--------|--------------------------|
| F1: Create credential | POST | `id, endpointId, clientId, clientSecret, description, createdAt` |
| F2: List credentials | GET | Array of `id, endpointId, clientId, description, createdAt` (no `clientSecret`!) |
| F3: Delete credential | DELETE | 204 No Content |

### C. Admin General Responses

| Endpoint | Method | Response Keys (Allowlist) |
|----------|--------|--------------------------|
| G1: Version | GET | `version, environment, uptime, nodeVersion, startedAt` |

### D. Admin Log Config Responses

| Endpoint | Method | Response Keys (Allowlist) |
|----------|--------|--------------------------|
| H1: Get config | GET | `globalLevel, categories, endpointOverrides, fileLogEnabled, ...` |
| H7: Recent logs | GET | Array of log entries |
| H11: Audit trail | GET | Array of audit entries |
| H12: Prune config | GET | Prune config object |

### E. Admin Database Browser Responses

| Endpoint | Method | Response Keys (Allowlist) |
|----------|--------|--------------------------|
| I1: List users | GET | `users[], totalCount` |
| I2: Get user | GET | Full DB user record (raw) |
| I3: List groups | GET | `groups[], totalCount` |
| I4: Get group | GET | Full DB group record (raw) |
| I5: Statistics | GET | `users, groups, genericResources, endpoints, ...` |

### F. SCIM Resource Responses (Users K1-K7, Groups L1-L7, Generic O1-O7, Me M1-M4)

**Single resource (CREATE/GET/PUT/PATCH with verbose=true)**:

| Field | Required | Source |
|-------|----------|--------|
| `schemas` | Yes | Array of URIs |
| `id` | Yes | Server-assigned GUID |
| `externalId` | If provided | Client-assigned ID |
| `meta` | Yes | `resourceType, created, lastModified, location, version` |
| All schema-defined attributes | Per `returned` characteristic | Schema definition |
| Extension URN keys | If present | Extension schemas |

**SCIM resource denylist** (in addition to Global Denylist):
- No DB-internal fields (`createdAt_db`, `updatedAt_db`)
- No query-only fields (`filter`, `sortBy`)
- `returned:never` attributes must not appear in responses

### G. SCIM List Responses (K2, K4, L2, L4, O2, O4 and all `/.search`)

| Field | Required | Type |
|-------|----------|------|
| `schemas` | Yes | `["urn:ietf:params:scim:api:messages:2.0:ListResponse"]` |
| `totalResults` | Yes | Integer >= 0 |
| `startIndex` | Yes | Integer >= 1 |
| `itemsPerPage` | Yes | Integer >= 0 |
| `Resources` | Yes | Array (may be empty) |

Each element in `Resources` must match the single resource shape from §F.

### H. SCIM Error Responses (all error cases)

| Field | Required | Type |
|-------|----------|------|
| `schemas` | Yes | `["urn:ietf:params:scim:api:messages:2.0:Error"]` |
| `status` | Yes | String (HTTP status code as string) |
| `scimType` | Conditional | String (RFC 7644 §3.12) |
| `detail` | Yes | String |
| `urn:scimserver:api:messages:2.0:Diagnostics` | Optional | Object with `requestId, endpointId, errorCode, ...` |

### I. SCIM Bulk Response (N1)

| Field | Required | Type |
|-------|----------|------|
| `schemas` | Yes | `["urn:ietf:params:scim:api:messages:2.0:BulkResponse"]` |
| `Operations` | Yes | Array of operation results |

Each operation result: `method, bulkId, version, location, status, response`

### J. Discovery Responses

| Endpoint | Response Contract |
|----------|------------------|
| C1/D1: ServiceProviderConfig | `schemas, patch, bulk, filter, changePassword, sort, etag, authenticationSchemes, meta` (RFC 7643 §5) |
| C2/D2: Schemas (list) | ListResponse wrapping Schema objects |
| C3/D3: Schema (single) | `schemas, id, name, description, attributes[]` (RFC 7643 §7) |
| C4/D4: ResourceTypes (list) | ListResponse wrapping ResourceType objects |
| C5/D5: ResourceType (single) | `schemas, id, name, description, endpoint, schema, schemaExtensions[]` (RFC 7643 §6) |

### K. OAuth Token Response (B2)

| Field | Required | Type |
|-------|----------|------|
| `access_token` | Yes | JWT string |
| `token_type` | Yes | `"Bearer"` |
| `expires_in` | Yes | Integer (seconds) |

---

## Step 3 - Complete API Flow & Combination Matrix

> **Self-improvement note:** When new flows or edge-case combinations are discovered, add them here. Flows that caused bugs get marked with ⚡.

### 3.1 End-to-End User Lifecycle Flows

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| F-U1 | Create → Read → Update (PUT) → Read → Delete | K1→K3→K5→K3→K7 | idempotent PUT, externalId change |
| F-U2 | Create → Patch (add) → Patch (replace) → Patch (remove) → Delete | K1→K6→K6→K6→K7 | multi-valued attrs, path syntax |
| F-U3 | Create → List → Filter → Search (.search) → Delete | K1→K2→K2+?filter→K4→K7 | pagination, startIndex, count |
| F-U4 | Create duplicate → expect 409 CONFLICT | K1→K1 | userName uniqueness |
| F-U5 | Create → Delete → Get (expect 404) | K1→K7→K3 | soft-delete vs hard-delete |
| F-U6 | Create → PUT with wrong version → expect 412 | K1→K5 | ETag precondition |
| F-U7 | Create → PATCH returned:never attr → GET verify absent | K1→K6→K3 | returned characteristic |

### 3.2 End-to-End Group Lifecycle Flows

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| F-G1 | Create group → Add members → List members → Remove member → Delete | L1→L6→L3→L6→L7 | member array, $ref |
| F-G2 | Create group → PUT (replace all) → Verify members | L1→L5→L3 | full replacement |
| F-G3 | Create group with members → Bulk member add → Verify | L1→L6→L3 | multi-member patch |
| F-G4 | Duplicate displayName → expect 409 (if uniqueness configured) | L1→L1 | displayName uniqueness |
| F-G5 | Create → PATCH add user → PATCH remove ALL members → verify | L1→L6→L6→L3 | PatchOpAllowRemoveAllMembers |

### 3.3 Cross-Resource Flows

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| F-X1 | Create user → Create group with user as member → Get group → Verify member ref | K1→L1→L3 | member.$ref resolution |
| F-X2 | Delete user → Get group → Verify member removed (if cascading) | K7→L3 | dangling member references |
| F-X3 | Bulk: create users + groups in one request → verify all | N1→K3→L3 | bulk operation ordering |

### 3.4 Admin + SCIM Cross-Domain Flows ⚡

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| ⚡ F-A1 | Create endpoint → Create SCIM user → Read admin endpoint → verify no `_schemaCaches` | E1→K1→E5 | temporal coupling, cache leak |
| F-A2 | Create endpoint → SCIM ops → Get endpoint stats → verify counts | E1→K1→L1→E9 | stats accuracy |
| F-A3 | Deactivate endpoint → SCIM op → expect 404 | E1→E7(active:false)→K1 | inactive blocking |
| F-A4 | Create endpoint → Create credential → Auth with credential → SCIM op | E1→F1→B2→K1 | per-endpoint auth |
| F-A5 | Delete endpoint → Get endpoint → expect 404 → SCIM op → expect 404 | E8→E5→K1 | cascade cleanup |

### 3.5 Discovery Consistency Flows

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| F-D1 | Root SPC ↔ Endpoint SPC → same structure, may differ in values | C1 vs D1 | per-endpoint config |
| F-D2 | Root Schemas ↔ Endpoint Schemas → endpoint sees only its registered schemas | C2 vs D2 | schema filtering |
| F-D3 | Root ResourceTypes ↔ Endpoint ResourceTypes → endpoint sees only its types | C4 vs D4 | type filtering |
| F-D4 | Add custom resource type to endpoint → Verify ResourceTypes updated | E7→D4 | dynamic discovery |

### 3.6 /Me Flows

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| F-M1 | Get OAuth token → GET /Me → verify user context | B2→M1 | JWT sub mapping |
| F-M2 | GET /Me → PUT /Me → GET /Me → verify update | M1→M2→M1 | self-service update |
| F-M3 | PATCH /Me → GET /Me → verify patch applied | M3→M1 | self-service patch |
| F-M4 | DELETE /Me → GET /Me → expect 404 | M4→M1 | self-deprovisioning |

### 3.7 Error Path Flows

| Flow ID | Description | Expected Error | Status |
|---------|-------------|----------------|--------|
| F-E1 | GET nonexistent user | SCIM Error, status=404 | `not found` |
| F-E2 | POST invalid JSON body | SCIM Error, status=400 | `invalidSyntax` |
| F-E3 | POST missing required field (userName) | SCIM Error, status=400 | `invalidValue` |
| F-E4 | PATCH with invalid path | SCIM Error, status=400 | `invalidPath` |
| F-E5 | PUT with wrong ETag | SCIM Error, status=412 | `preconditionFailed` |
| F-E6 | Auth with invalid token | 401 Unauthorized | - |
| F-E7 | Auth with wrong endpoint credential | 403 Forbidden | - |
| F-E8 | POST to inactive endpoint | 404 Not Found | - |
| F-E9 | Bulk exceeding maxOperations | SCIM Error, status=413 | `tooMany` |
| F-E10 | Filter with invalid syntax | SCIM Error, status=400 | `invalidFilter` |

### 3.8 Config Flag Combination Matrix

> These flows test that config flags modify behavior correctly:

| Flag | Values | Affected Endpoints | Test Assertion |
|------|--------|-------------------|----------------|
| `VerbosePatchSupported` | true/false | K6, L6, O6 | true→200+body, false→204+empty |
| `SoftDeleteSupported` | true/false | K7, L7, O7 | true→soft-delete, false→hard-delete |
| `StrictSchemaValidation` | true/false | K1, K5, L1, L5 | true→reject unknown attrs |
| `PatchOpAllowRemoveAllMembers` | true/false | L6, O6 | true→allow, false→reject |
| `AllowAndCoerceBooleanStrings` | true/false | K1, K6 | "true"→true coercion |
| `MultiMemberPatchSupported` | true/false | L6 | multiple members in one op |

### 3.9 Generic Resource Parity Flows

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| F-GR1 | Register custom resource type → CRUD → same shape as Users | E7→O1→O3→O5→O6→O7 | schema-driven validation |
| F-GR2 | Custom resource filter operations | O2+?filter | all filter operators |
| F-GR3 | Custom resource returned characteristics | O1→O3 | returned:never stripping |
| F-GR4 | Custom resource uniqueness enforcement | O1→O1 | per-schema uniqueness |

### 3.10 Endpoint Log Flows

| Flow ID | Description | Endpoints Involved | Edge Cases |
|---------|-------------|-------------------|------------|
| F-L1 | SCIM op → Read endpoint logs → verify logged | K1→P1 | log entry shape |
| F-L2 | Configure per-endpoint log level → verify filtering | H5→K1→P1 | level filtering |
| F-L3 | Download logs → verify format | P3 | file format, pagination |

---

## Step 4 - Audit Existing Tests & Map Coverage

> **Self-improvement note:** Re-audit this matrix on every execution. Update cells from ❌ to ✅ as tests are added.

### 4.1 Per-Category Contract Coverage Matrix

| Category | Endpoints | Unit Allowlist | Unit Denylist | E2E Allowlist | E2E Denylist | Live Allowlist | Live Denylist | Temporal |
|----------|-----------|---------------|---------------|---------------|--------------|----------------|---------------|----------|
| A. Health/Web | A1-A2 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| B. OAuth | B1-B2 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| C. Discovery (root) | C1-C5 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | N/A |
| D. Discovery (scoped) | D1-D5 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | N/A |
| E. Admin Endpoints | E1-E9 | ✅ | ✅ | ✅ 9z-M | ✅ | ✅ 9z-M | ✅ 9z-M | ✅ 9z-M |
| F. Admin Credentials | F1-F3 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| G. Admin General | G1-G8 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| H. Admin Log Config | H1-H13 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| I. Admin Database | I1-I5 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| J. Admin Activity | J1-J2 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| K. SCIM Users | K1-K7 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | N/A |
| L. SCIM Groups | L1-L7 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | N/A |
| M. SCIM /Me | M1-M4 | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | N/A |
| N. SCIM Bulk | N1 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | N/A |
| O. SCIM Generic | O1-O7 | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | N/A |
| P. Endpoint Logs | P1-P4 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| SCIM Error shape | All errors | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | N/A |
| SCIM ListResponse | All lists | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | N/A |

**Legend**: ✅ = strict contract test (allowlist/denylist) | ⚠️ = partial (presence-only `toHaveProperty`) | ❌ = no contract test | 🆕 = newly discovered

### 4.2 Flow Coverage Matrix

| Flow | Unit | E2E | Live | Notes |
|------|------|-----|------|-------|
| F-U1: User CRUD lifecycle | ⚠️ | ✅ | ✅ | No strict shape check |
| F-U2: User PATCH variants | ⚠️ | ✅ | ✅ | No strict shape check |
| F-U3: User list/filter/search | ⚠️ | ✅ | ✅ | No ListResponse shape check |
| F-U4: Duplicate user | ⚠️ | ✅ | ✅ | Error shape not strict |
| F-U5: Soft-delete flow | ❌ | ✅ | ✅ | - |
| F-U6: ETag precondition | ❌ | ✅ | ✅ | - |
| F-U7: returned:never | ❌ | ✅ | ✅ | - |
| F-G1-G5: Group flows | ⚠️ | ✅ | ✅ | No strict shape check |
| F-X1-X3: Cross-resource | ❌ | ⚠️ | ⚠️ | Partial coverage |
| ⚡ F-A1: Cache leak detection | ❌ | ✅ | ✅ 9z-M | E2E + Live |
| F-A2-A5: Admin+SCIM flows | ❌ | ⚠️ | ✅ | - |
| F-D1-D4: Discovery consistency | ❌ | ✅ | ✅ | No strict shape |
| F-M1-M4: /Me flows | ❌ | ✅ | ✅ | - |
| F-E1-E10: Error paths | ⚠️ | ✅ | ✅ | Error shape not strict |
| Config flag combos | ❌ | ✅ | ✅ | Many combos untested |
| F-GR1-GR4: Generic resource | ❌ | ⚠️ | ⚠️ | Partial |
| F-L1-L3: Endpoint logs | ❌ | ⚠️ | ⚠️ | - |

---

## Step 5 - Implement Missing Contract Tests

> **Self-improvement note:** When new patterns are discovered or invented, add them here. Mark existing patterns as "verified working" after successful execution.

### 5.1 Test Helpers to Create

Create a shared contract assertion module used by all test levels:

```typescript
// api/test/helpers/contract-assertions.ts

/** Asserts response body matches an exact key allowlist */
export function assertKeyAllowlist(body: Record<string, any>, allowedKeys: string[], label: string) {
  const actualKeys = Object.keys(body).sort();
  for (const key of actualKeys) {
    expect(allowedKeys.sort()).toContain(key);
    // ^ if this fails: "Response '${label}' has unexpected key '${key}'"
  }
}

/** Asserts required keys are all present */
export function assertRequiredKeys(body: Record<string, any>, requiredKeys: string[], label: string) {
  for (const key of requiredKeys) {
    expect(body).toHaveProperty(key);
    // ^ if this fails: "Response '${label}' is missing required key '${key}'"
  }
}

/** Asserts no internal fields leaked */
export function assertNoDeniedKeys(body: Record<string, any>, label: string) {
  const GLOBAL_DENYLIST = [
    '_schemaCaches', '_prismaMetadata', '_rawPayload', '_version',
    'endpointId', 'scimId', 'password',
  ];
  for (const key of GLOBAL_DENYLIST) {
    expect(body).not.toHaveProperty(key);
  }
  // No underscore-prefixed keys (except _links)
  const underscoreKeys = Object.keys(body).filter(k => k.startsWith('_') && k !== '_links');
  expect(underscoreKeys).toEqual([]);
}

/** Deep scan: recursively check all nested objects for denied keys */
export function assertNoDeniedKeysDeep(obj: any, path = '', label = '') {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoDeniedKeysDeep(item, `${path}[${i}]`, label));
    return;
  }
  assertNoDeniedKeys(obj, `${label}@${path}`);
  for (const [key, value] of Object.entries(obj)) {
    assertNoDeniedKeysDeep(value, `${path}.${key}`, label);
  }
}

/** Assert SCIM ListResponse shape */
export function assertListResponseShape(body: Record<string, any>) {
  expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
  expect(typeof body.totalResults).toBe('number');
  expect(typeof body.startIndex).toBe('number');
  expect(typeof body.itemsPerPage).toBe('number');
  expect(Array.isArray(body.Resources)).toBe(true);
  // No extra envelope keys
  const allowed = ['schemas', 'totalResults', 'startIndex', 'itemsPerPage', 'Resources'];
  assertKeyAllowlist(body, allowed, 'ListResponse');
}

/** Assert SCIM Error response shape */
export function assertErrorResponseShape(body: Record<string, any>) {
  expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
  expect(typeof body.status).toBe('string');
  expect(typeof body.detail).toBe('string');
  const allowed = ['schemas', 'status', 'scimType', 'detail', 'urn:scimserver:api:messages:2.0:Diagnostics'];
  assertKeyAllowlist(body, allowed, 'ScimError');
}

/** Assert SCIM resource meta sub-object */
export function assertMetaShape(meta: Record<string, any>) {
  const allowed = ['resourceType', 'created', 'lastModified', 'location', 'version'];
  assertKeyAllowlist(meta, allowed, 'meta');
  expect(meta.resourceType).toBeDefined();
  expect(meta.location).toBeDefined();
}
```

### 5.2 Pattern: Key Allowlist Assertion (Unit/E2E)

```typescript
const ENDPOINT_FULL_KEYS = [
  'id', 'name', 'displayName', 'description', 'profile',
  'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links'
].sort();

const keys = Object.keys(response).sort();
for (const key of keys) {
  expect(ENDPOINT_FULL_KEYS).toContain(key);
}
for (const key of ['id', 'name', 'active', 'scimBasePath']) {
  expect(keys).toContain(key);
}
```

### 5.3 Pattern: Internal Field Denylist (Unit/E2E)

```typescript
assertNoDeniedKeysDeep(response, '', 'endpoint-response');
```

### 5.4 Pattern: Temporal Coupling Test (E2E) ⚡

```typescript
// 1. Trigger a SCIM operation to build runtime caches
await request(app.getHttpServer())
  .post(`${scimBase}/Users`)
  .send(userPayload)
  .expect(201);

// 2. Read admin endpoint - must still be clean
const adminRes = await request(app.getHttpServer())
  .get(`/scim/admin/endpoints/${endpointId}`)
  .expect(200);

const profileKeys = Object.keys(adminRes.body.profile).sort();
expect(profileKeys).toEqual(['resourceTypes', 'schemas', 'serviceProviderConfig', 'settings']);
assertNoDeniedKeysDeep(adminRes.body, '', 'post-scim-admin');
```

### 5.5 Pattern: Live Test Key Allowlist (PowerShell)

```powershell
function Test-KeyAllowlist {
  param([object]$Object, [string[]]$AllowedKeys, [string]$Label)
  $keys = $Object.PSObject.Properties.Name | Sort-Object
  $extraKeys = $keys | Where-Object { $_ -notin $AllowedKeys }
  Test-Result -Success ($extraKeys.Count -eq 0) `
    -Message "$Label - No unexpected keys (extras: $($extraKeys -join ', '))"
  # Denylist
  $denied = @('_schemaCaches','_prismaMetadata','_rawPayload','_version','endpointId','scimId','password')
  $leaked = $keys | Where-Object { $_ -in $denied }
  Test-Result -Success ($leaked.Count -eq 0) `
    -Message "$Label - No denied keys (leaked: $($leaked -join ', '))"
}

function Test-ScimResourceShape {
  param([object]$Resource, [string]$Label)
  Test-Result -Success ($null -ne $Resource.schemas) -Message "$Label has schemas"
  Test-Result -Success ($null -ne $Resource.id) -Message "$Label has id"
  Test-Result -Success ($null -ne $Resource.meta) -Message "$Label has meta"
  # meta shape
  $metaKeys = $Resource.meta.PSObject.Properties.Name | Sort-Object
  $allowedMeta = @('resourceType','created','lastModified','location','version') | Sort-Object
  $extraMeta = $metaKeys | Where-Object { $_ -notin $allowedMeta }
  Test-Result -Success ($extraMeta.Count -eq 0) -Message "$Label meta - no extras (got: $($extraMeta -join ', '))"
  # No underscore keys except _links
  $underscored = $Resource.PSObject.Properties.Name | Where-Object { $_.StartsWith('_') -and $_ -ne '_links' }
  Test-Result -Success ($underscored.Count -eq 0) -Message "$Label - no _-prefixed keys (got: $($underscored -join ', '))"
}

function Test-ListResponseShape {
  param([object]$Response, [string]$Label)
  Test-Result -Success ($Response.schemas -contains 'urn:ietf:params:scim:api:messages:2.0:ListResponse') `
    -Message "$Label has ListResponse schema"
  $allowed = @('schemas','totalResults','startIndex','itemsPerPage','Resources')
  Test-KeyAllowlist -Object $Response -AllowedKeys $allowed -Label "$Label envelope"
}

function Test-ErrorResponseShape {
  param([object]$Response, [string]$Label)
  Test-Result -Success ($Response.schemas -contains 'urn:ietf:params:scim:api:messages:2.0:Error') `
    -Message "$Label has Error schema"
  $allowed = @('schemas','status','scimType','detail','urn:scimserver:api:messages:2.0:Diagnostics')
  Test-KeyAllowlist -Object $Response -AllowedKeys $allowed -Label "$Label error"
}
```

### 5.6 Pattern: E2E Flow Contract Integration

```typescript
// In every E2E lifecycle test, wrap response assertions:
it('should return correct shape on user create', async () => {
  const res = await request(app.getHttpServer())
    .post(`${scimBase}/Users`)
    .set('Authorization', `Bearer ${token}`)
    .send(userPayload)
    .expect(201);

  // Functional assertions (existing)
  expect(res.body.userName).toBe(userPayload.userName);

  // Contract assertions (NEW - add to every test)
  assertNoDeniedKeysDeep(res.body, '', 'POST /Users');
  assertMetaShape(res.body.meta);
  expect(res.headers.location).toContain(res.body.id);
});
```

### 5.7 Pattern: Integration Test (NestJS TestingModule with real DB)

```typescript
// For integration-level tests that use a real database but no HTTP layer:
describe('UserService contract (integration)', () => {
  let service: EndpointScimUsersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule, ScimModule],
    }).compile();
    service = module.get(EndpointScimUsersService);
  });

  it('should return user object matching contract', async () => {
    const result = await service.create(endpointId, userPayload);

    // Contract: service returns the same shape as the API
    assertNoDeniedKeysDeep(result, '', 'service.create');
    expect(result).toHaveProperty('schemas');
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('meta');
    assertMetaShape(result.meta);
  });
});
```

---

## Step 6 - Verification Checklist

### 6.1 Run Tests at All Levels

```bash
# Unit tests
cd api && npx jest --forceExit

# E2E tests
cd api && npx jest --config test/e2e/jest-e2e.config.ts --forceExit

# Live tests (local)
cd scripts && .\live-test.ps1

# Live tests (Docker)
cd scripts && .\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "docker-secret"

# Live tests (Azure)
cd scripts && .\live-test.ps1 -BaseUrl https://your-app.azurecontainerapps.io -ClientSecret "your-secret"
```

### 6.2 Coverage Report

After running, fill in this matrix (copy into audit history):

| Category | # Endpoints | Unit ✅ | E2E ✅ | Live ✅ | % Covered |
|----------|-------------|---------|--------|---------|-----------|
| A. Health/Web | 2 | /2 | /2 | /2 | % |
| B. OAuth | 2 | /2 | /2 | /2 | % |
| C. Discovery (root) | 5 | /5 | /5 | /5 | % |
| D. Discovery (scoped) | 5 | /5 | /5 | /5 | % |
| E. Admin Endpoints | 9 | /9 | /9 | /9 | % |
| F. Admin Credentials | 3 | /3 | /3 | /3 | % |
| G. Admin General | 8 | /8 | /8 | /8 | % |
| H. Admin Log Config | 13 | /13 | /13 | /13 | % |
| I. Admin Database | 5 | /5 | /5 | /5 | % |
| J. Admin Activity | 2 | /2 | /2 | /2 | % |
| K. SCIM Users | 7 | /7 | /7 | /7 | % |
| L. SCIM Groups | 7 | /7 | /7 | /7 | % |
| M. SCIM /Me | 4 | /4 | /4 | /4 | % |
| N. SCIM Bulk | 1 | /1 | /1 | /1 | % |
| O. SCIM Generic | 7 | /7 | /7 | /7 | % |
| P. Endpoint Logs | 4 | /4 | /4 | /4 | % |
| **TOTAL** | **82** | **/82** | **/82** | **/82** | **%** |

### 6.3 Flow Coverage Report

| Flow Category | # Flows | Unit ✅ | E2E ✅ | Live ✅ |
|--------------|---------|---------|--------|---------|
| User Lifecycle (F-U) | 7 | /7 | /7 | /7 |
| Group Lifecycle (F-G) | 5 | /5 | /5 | /5 |
| Cross-Resource (F-X) | 3 | /3 | /3 | /3 |
| Admin+SCIM (F-A) | 5 | /5 | /5 | /5 |
| Discovery (F-D) | 4 | /4 | /4 | /4 |
| /Me Flows (F-M) | 4 | /4 | /4 | /4 |
| Error Paths (F-E) | 10 | /10 | /10 | /10 |
| Config Combos | 6 | /6 | /6 | /6 |
| Generic Resource (F-GR) | 4 | /4 | /4 | /4 |
| Endpoint Logs (F-L) | 3 | /3 | /3 | /3 |
| **TOTAL** | **51** | **/51** | **/51** | **/51** |

---

## Step 7 - Anti-Patterns to Avoid

> **Self-improvement note:** When a new anti-pattern is discovered during an audit, add it to this table with the date.

| # | Anti-Pattern | Why It Fails | Correct Pattern | Discovered |
|---|-------------|-------------|-----------------|------------|
| 1 | `expect(result).toHaveProperty('profile')` | Catches missing fields but NOT leaked extra fields | Use key allowlist: `expect(ALLOWED).toContain(key)` | 2026-04-17 |
| 2 | `expect(result.profile).toBeDefined()` | Same - presence-only, no shape enforcement | Assert exact key set | 2026-04-17 |
| 3 | `expect(result).toMatchObject({...})` | Ignores extra properties by design | Combine with `Object.keys()` check | 2026-04-17 |
| 4 | Testing only fresh mock objects | Misses runtime mutations (cache attachment) | Add temporal coupling tests | 2026-04-17 |
| 5 | Asserting only in unit tests | Misses serialization issues (Map→`{}`) | Test at E2E + live level too | 2026-04-17 |
| 6 | Hardcoding expected key count | Brittle - breaks on legitimate additions | Use named allowlist array | 2026-04-17 |
| 7 | Testing happy path only | Misses error response shape violations | Test all error codes + shapes | 2026-04-17 |
| 8 | Skipping nested object shape checks | Leaked fields may be in sub-objects | Use `assertNoDeniedKeysDeep` recursion | 2026-04-17 |
| 9 | Contract tests only at one level | Serialization bugs affect E2E/live but not unit | Contract tests at all 4 levels | 2026-04-17 |
| 10 | Not testing after state mutations | Cache/runtime state may leak after SCIM ops | Temporal coupling flow tests | 2026-04-17 |

---

## Step 8 - Standing Rules

- Every new API endpoint MUST have a response contract test at **unit + E2E + live** level
- Every response contract test MUST include both **allowlist AND denylist** assertions
- `_`-prefixed fields (except `_links`) are ALWAYS internal and must NEVER appear in responses
- Map/Set objects must NEVER reach JSON serialization - strip or convert before response
- Temporal coupling tests are REQUIRED for any endpoint sharing in-memory state with SCIM operations
- Live test Section 9z-M verifies contracts against deployed instances
- **Every flow in Step 3 must have corresponding tests at all applicable levels**
- **Config flag combinations MUST be tested with different endpoint profiles**
- **Error paths MUST verify SCIM Error response shape, not just HTTP status**
- **ListResponse shape MUST be verified for all list/search endpoints**
- **Integration tests** (real DB, no HTTP) must verify service-layer response shapes match API shape
- **Credential responses** must NEVER include `clientSecret` on list/read operations (only on create)
- **Every new anti-pattern discovered** must be added to Step 7 with the discovery date

---

## Step 9 - Priority-Ordered Implementation Backlog

> **Self-improvement note:** Re-prioritize this list on each execution based on risk, coverage gaps, and recent bugs.

| Priority | Task | Category | Effort | Risk | Status |
|----------|------|----------|--------|------|--------|
| P0 | Create shared `contract-assertions.ts` helper module | Infra | LOW | - | ✅ Done (exec #3) |
| P0 | Add strict allowlist to ALL SCIM resource responses (K, L, O) - unit + E2E + live | Contract | HIGH | Critical - current gap | ✅ E2E done (exec #1+3), unit/live pending |
| P0 | Add strict error shape assertion to ALL error path tests (F-E1 to F-E10) | Contract | MED | High - silent shape drift | ✅ E2E done (exec #1+3) |
| P0 | Add ListResponse shape assertion to ALL list/search endpoints | Contract | MED | High - envelope leak risk | ✅ E2E done (exec #1) |
| P1 | Add temporal coupling test at E2E level (F-A1) - not just live | Contract | LOW | High - only live catches it | ✅ Done (exec #3) |
| P1 | Add denylist deep scan to ALL existing E2E lifecycle tests | Contract | MED | Med - retrofit existing tests | ✅ E2E done (exec #1+3) |
| P2 | Add discovery endpoint shape contracts (C1-C5, D1-D5) | Contract | MED | Med - RFC compliance | Not started |
| P2 | Add admin credential response shape tests (F1-F3) - verify no `clientSecret` leak | Contract | LOW | Med - secret leak risk | Not started |
| P2 | Add OAuth token response shape tests (B2) | Contract | LOW | Med - auth surface | Not started |
| P3 | Add admin log config shape tests (H1-H13) | Contract | MED | Low - internal API | Not started |
| P3 | Add admin database browser shape tests (I1-I5) | Contract | MED | Low - internal API | Not started |
| P3 | Add admin activity feed shape tests (J1-J2) | Contract | LOW | Low - internal API | Not started |
| P3 | Add endpoint-scoped log shape tests (P1-P4) | Contract | LOW | Low - internal API | Not started |
| P4 | Add config flag combination matrix tests | Flow | HIGH | Med - interaction bugs | Not started |
| P4 | Add all cross-resource flow tests (F-X1 to F-X3) | Flow | MED | Med - integration bugs | Not started |
| P4 | Add generic resource parity flow tests (F-GR1 to F-GR4) | Flow | MED | Med - parity gaps | Not started |
| P5 | Integration-level contract tests (service layer with real DB) | Contract | HIGH | Low - defense in depth | Not started |

---

## Step 10 - Self-Improvement Execution (MANDATORY)

> **This step runs at the END of every execution. It is NOT optional.**

### 10.1 Scan for Changes Since Last Execution

```bash
# Find new/modified controllers since last execution
git log --since="LAST_EXECUTION_DATE" --name-only -- "api/src/modules/**/*.controller.ts"

# Find new/modified DTOs and interfaces
git log --since="LAST_EXECUTION_DATE" --name-only -- "api/src/**/*.dto.ts" "api/src/**/*.interface.ts"

# Find new test files
git log --since="LAST_EXECUTION_DATE" --name-only -- "api/src/**/*.spec.ts" "api/test/e2e/**/*.spec.ts"

# Find new _-prefixed fields in any TypeScript class
grep -rn "private _\|readonly _\|public _\|this\._" api/src/ --include="*.ts" | grep -v node_modules | grep -v ".spec.ts"

# Count current endpoints
grep -rn "@Get\|@Post\|@Put\|@Patch\|@Delete" api/src/modules/ --include="*.controller.ts" | wc -l
```

### 10.2 Diff Detection & Auto-Update Rules

| Change Detected | Action | Section to Update |
|----------------|--------|-------------------|
| New controller file | Add all its endpoints to inventory | Step 1 |
| New `@Get/@Post/...` handler | Add to endpoint table | Step 1 |
| Deleted endpoint handler | Mark as deprecated in inventory | Step 1 |
| New DTO/interface field | Add to response contract allowlist | Step 2 |
| New `_`-prefixed field | Add to denylist | Step 2 |
| New flow sequence (multi-endpoint) | Add to flow matrix | Step 3 |
| New test file with contract assertions | Update coverage matrix to ✅ | Step 4 |
| New test file without contract assertions | Note gap, update to ⚠️ | Step 4 |
| Bug discovered | Add anti-pattern + audit entry | Steps 7, 10.4 |
| Backlog item completed | Mark as "Done" + update coverage | Step 9 |
| Test count changed | Update execution metadata | Meta |

### 10.3 Update This Prompt File

After completing the audit, update **THIS FILE** (`apiContractVerification.prompt.md`) directly:

1. **Execution Metadata**: Increment `executionCount`, update `lastExecution`, update `coveredEndpoints` and `coveragePercent`
2. **Endpoint Inventory** (Step 1): Add any new endpoints discovered. Remove any deprecated endpoints.
3. **Response Contracts** (Step 2): Update allowlists with new fields. Add new denylist entries for new `_`-prefixed fields.
4. **Flow Matrix** (Step 3): Add any new flows discovered. Mark flows that caused bugs with ⚡.
5. **Coverage Matrix** (Step 4): Update every cell with current ✅/⚠️/❌/🆕 status.
6. **Patterns** (Step 5): Add any new assertion patterns or test helpers discovered.
7. **Anti-Patterns** (Step 7): Add any new anti-patterns discovered with date.
8. **Backlog** (Step 9): Re-prioritize based on findings. Move completed items to "Done".
9. **Audit History** (below): Append a new row.

### 10.4 Commit the Updated Prompt

```bash
git add .github/prompts/apiContractVerification.prompt.md
git commit -m "chore(prompt): self-improve apiContractVerification - execution #N

Updated: [list what changed]
Coverage: X/82 endpoints (Y%)
New findings: [any bugs or gaps found]"
```

### 10.5 Validate Self-Improvement Quality

Before committing the update, verify:
- [ ] No endpoint was removed from inventory that still exists in code
- [ ] No allowlist was widened without corresponding code change
- [ ] No denylist entry was removed
- [ ] Coverage percentages are calculated correctly
- [ ] Audit history entry has concrete findings (not generic)
- [ ] Backlog reflects actual current state
- [ ] `promptVersion` patch version was bumped
- [ ] All new flows discovered are added to Step 3
- [ ] totalEndpoints count matches actual controller scan

### 10.6 Improvement Quality Metrics

Track these metrics across executions to ensure the prompt is actually improving:

| Metric | Exec #1 | Exec #2 | Exec #3 | Trend |
|--------|---------|---------|---------|-------|
| Endpoints cataloged | 82 | 82 | 82 | Stable |
| Endpoints with strict contract tests | 8 | 8 | 22 | ↑ |
| Coverage % | 9.8% | 9.8% | 26.8% | ↑↑ |
| Flows documented | 51 | 51 | 51 | Stable |
| Flows with tests at all levels | 0 | 0 | 1 | ↑ |
| Anti-patterns documented | 10 | 10 | 10 | Stable |
| Test patterns documented | 7 | 7 | 8 | ↑ |
| Bugs found by this prompt | 1 | 1 | 1 | Stable |

---

## Audit History

> **Self-improvement note:** Append a new row after every execution. Never delete old rows.

| # | Date | Version | Prompt Ver | Findings | Tests Added | Coverage |
|---|------|---------|------------|----------|-------------|----------|
| 1 | 2026-04-17 | v0.37.2 | 1.0.0 | Initial creation. `_schemaCaches` leak found in 4/16 Azure endpoints. Extension URN cross-contamination confirmed. 3 endpoints had stale settings keys. | Unit: +12, E2E: +4, Live: Section 9z-M (+10 assertions) | 8/82 (9.8%) |
| 2 | 2026-04-17 | v0.37.2 | 2.0.0 | Self-improving rewrite. Added all 82 endpoints to inventory across 16 categories. Added 51 flows across 10 categories. Added 4 test levels. Defined 7 reusable test patterns (TS + PowerShell). Identified 17 backlog items prioritized P0-P5. Expanded anti-patterns from 5 to 10. Contract coverage baseline: only admin endpoints (E category) have strict tests at live level. | Patterns defined, no new tests yet | 8/82 (9.8%) |
| 3 | 2026-04-21 | v0.37.2 | 2.1.0 | Execution #3: Created shared `contract-assertions.ts` helper module. Added 3 new E2E contract tests: admin list endpoints envelope allowlist (GET /endpoints), Bulk response contract (POST /Bulk), temporal coupling cache-leak detection (F-A1 at E2E level). Coverage improved from ⚠️ to ✅ for Users/Groups/Bulk/ListResponse/Error categories. All P0 and P1 backlog items now Done at E2E level. Total E2E contract tests: 22 (was 19). | +1 helper file, +3 E2E tests, 6 backlog items closed | 22/82 (26.8%) |
