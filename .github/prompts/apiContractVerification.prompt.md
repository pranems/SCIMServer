---
name: apiContractVerification
description: Verify every API endpoint returns exactly the documented response shape — no extra fields, no missing fields, no internal state leakage.
argument-hint: Optional scope like "admin endpoints", "SCIM Users", or a specific endpoint path to narrow the audit.
---

Perform a comprehensive API response contract verification across all endpoints. This ensures that **every JSON response** matches its documented shape exactly — no leaked internal fields, no missing required fields, no Map/Set serialization artifacts.

---

## Why This Prompt Exists

This prompt was created after a production bug where:
1. `_schemaCaches` (an internal runtime cache containing ES6 Map/Set objects) leaked into admin endpoint GET responses
2. Map objects serialized to `{}` via `JSON.stringify`, exposing empty internal fields
3. `getExtensionUrns()` returned extensions from ALL resource types instead of filtering per `coreSchemaUrn`
4. 4 of 16 Azure endpoints showed the leak — none of the 3,300+ tests caught it

**Root cause**: Every test asserted field presence (`toHaveProperty`) but none asserted field absence (`not.toHaveProperty`) or exclusive key sets (`Object.keys().sort() === allowlist`).

---

## Step 1 — Inventory All API Endpoints

1. **Read context**: Read `Session_starter.md`, `docs/COMPLETE_API_REFERENCE.md`, `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md`
2. **Controller survey**: Find all controllers in `api/src/modules/` — list every `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete` handler
3. **Categorize endpoints**:
   - **Admin API** (`/scim/admin/*`) — endpoint CRUD, stats, credentials, presets, logs, version, database
   - **SCIM API** (`/scim/endpoints/:id/*`) — Users, Groups, custom resources, Bulk, discovery
   - **Auth API** (`/scim/oauth/*`) — token endpoint
4. **Document expected response shapes**: For each endpoint, define the exact set of allowed response keys

---

## Step 2 — Define Response Contracts

### A. Admin Endpoint API

| Endpoint | Method | Response Keys (Allowlist) |
|----------|--------|--------------------------|
| `/admin/endpoints/:id` (full) | GET | `id, name, displayName, description, profile, active, scimBasePath, createdAt, updatedAt, _links` |
| `/admin/endpoints/:id?view=summary` | GET | `id, name, displayName, description, profileSummary, active, scimBasePath, createdAt, updatedAt, _links` |
| `/admin/endpoints` (list) | GET | Envelope: `totalResults, endpoints[]` — each element matches summary shape |
| `/admin/endpoints` | POST | Same as full view |
| `/admin/endpoints/:id` | PATCH | Same as full view |
| `/admin/endpoints/:id` | DELETE | 204 No Content (empty body) |

**Profile sub-object allowlist**: `schemas, settings, resourceTypes, serviceProviderConfig`

**Profile denylist** (internal fields that must NEVER appear):
- `_schemaCaches` — runtime schema cache (Map/Set objects)
- `_prismaMetadata` — ORM artifacts
- Any key prefixed with `_`

**_links sub-object**: `self, stats, credentials, scim`

**ProfileSummary sub-object**: `schemaCount, schemas, resourceTypeCount, resourceTypes, serviceProviderConfig, activeSettings`

### B. SCIM Resource Responses

| Endpoint | Method | Response Keys (Core User) |
|----------|--------|---------------------------|
| `/Users/:id` | GET | `schemas, id, externalId, meta, userName, name, displayName, ...` (per schema definition) |
| `/Users` | POST | Same as GET + `Location` header |
| `/Users/:id` | PUT | Same as GET |
| `/Users/:id` | PATCH | Same as GET (or 204 when VerbosePatch=false) |

**SCIM resource denylist**:
- `_rawPayload` — internal storage field
- `_version` — internal version counter
- `endpointId` — internal routing field
- `scimId` — internal DB ID (should be mapped to `id`)
- Any key prefixed with `_`

### C. SCIM Error Responses

| Field | Required | Type |
|-------|----------|------|
| `schemas` | Yes | `["urn:ietf:params:scim:api:messages:2.0:Error"]` |
| `status` | Yes | String (HTTP status code) |
| `scimType` | Conditional | String (RFC 7644 §3.12) |
| `detail` | Yes | String |
| `urn:scimserver:api:messages:2.0:Diagnostics` | Optional | Object (requestId, endpointId, errorCode, etc.) |

### D. SCIM List Responses

| Field | Required |
|-------|----------|
| `schemas` | Yes — `["urn:ietf:params:scim:api:messages:2.0:ListResponse"]` |
| `totalResults` | Yes |
| `startIndex` | Yes |
| `itemsPerPage` | Yes |
| `Resources` | Yes (array) |

### E. Discovery Endpoints

| Endpoint | Expected shape |
|----------|---------------|
| `/ServiceProviderConfig` | RFC 7643 §5 — `schemas, patch, bulk, filter, changePassword, sort, etag, authenticationSchemes` |
| `/Schemas` | RFC 7643 §7 — `schemas, totalResults, Resources[]` or `ListResponse` |
| `/ResourceTypes` | RFC 7643 §6 — `schemas, totalResults, Resources[]` or `ListResponse` |

---

## Step 3 — Audit Existing Tests

For each endpoint category, check:

| Check | How to verify |
|-------|---------------|
| **Key allowlist assertion** | Test uses `expect(ALLOWED_KEYS).toContain(key)` for every key in response |
| **Key denylist assertion** | Test uses `expect(result).not.toHaveProperty('_schemaCaches')` etc. |
| **Temporal coupling test** | Test performs a mutation (SCIM CRUD), then reads admin API, verifies no leak |
| **Serialization safety** | No Map/Set objects in JSON responses (would appear as `{}`) |
| **Required fields present** | All required fields are asserted |
| **Optional fields handled** | Optional fields are in allowlist but not required |

### Test levels to check:
- **Unit tests** (`*.spec.ts`) — mock-based response shape verification
- **E2E tests** (`*.e2e-spec.ts`) — HTTP-level response shape verification
- **Live tests** (`scripts/live-test.ps1`) — deployment-level response shape verification

---

## Step 4 — Implement Missing Contract Tests

### Pattern: Key Allowlist Assertion (Unit/E2E)

```typescript
const ALLOWED_KEYS = ['id', 'name', 'profile', 'active', ...].sort();

// Every key in response must be in the allowed set
const keys = Object.keys(response).sort();
for (const key of keys) {
  expect(ALLOWED_KEYS).toContain(key);
}
// Required keys must be present
expect(keys).toContain('id');
expect(keys).toContain('name');
```

### Pattern: Internal Field Denylist (Unit/E2E)

```typescript
// Internal fields must NEVER appear
expect(response).not.toHaveProperty('_schemaCaches');
expect(response).not.toHaveProperty('_rawPayload');
expect(response).not.toHaveProperty('_version');
expect(response).not.toHaveProperty('endpointId');

// No underscore-prefixed keys at all
const underscoreKeys = Object.keys(response).filter(k => k.startsWith('_') && k !== '_links');
expect(underscoreKeys).toEqual([]);
```

### Pattern: Temporal Coupling Test (E2E)

```typescript
// 1. Trigger a SCIM operation to build runtime caches
await request(app.getHttpServer())
  .post(`${scimBase}/Users`)
  .send(userPayload)
  .expect(201);

// 2. Read admin endpoint — must still be clean
const adminRes = await request(app.getHttpServer())
  .get(`/scim/admin/endpoints/${endpointId}`)
  .expect(200);

const profileKeys = Object.keys(adminRes.body.profile).sort();
expect(profileKeys).toEqual(['resourceTypes', 'schemas', 'serviceProviderConfig', 'settings']);
```

### Pattern: Live Test Key Allowlist (PowerShell)

```powershell
$endpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Headers $headers
$keys = $endpoint.PSObject.Properties.Name | Sort-Object
$allowedKeys = @('id', 'name', 'displayName', 'description', 'profile', 'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links') | Sort-Object
$extraKeys = $keys | Where-Object { $_ -notin $allowedKeys }
Test-Result -Success ($extraKeys.Count -eq 0) -Message "No unexpected keys (extras: $($extraKeys -join ', '))"
```

---

## Step 5 — Verify

1. Run unit tests: `cd api; npx jest --forceExit` — confirm all pass
2. Run E2E tests: `cd api; npx jest --config test/e2e/jest-e2e.config.ts --forceExit` — confirm all pass
3. Report coverage matrix:

| Endpoint Category | Allowlist Test | Denylist Test | Temporal Test |
|-------------------|---------------|---------------|---------------|
| Admin endpoints (full) | ? | ? | ? |
| Admin endpoints (summary) | ? | ? | ? |
| Admin endpoints (list) | ? | ? | ? |
| SCIM User responses | ? | ? | N/A |
| SCIM Group responses | ? | ? | N/A |
| SCIM Error responses | ? | ? | N/A |
| Discovery endpoints | ? | ? | N/A |

---

## Step 6 — Self-Update This Prompt

After completing the audit:

1. **New endpoints**: If new API endpoints were added, add their response shape to Step 2
2. **New internal fields**: If new runtime-only fields (prefixed with `_`) are introduced, add them to the denylist
3. **New response fields**: If new documented response fields are added, update the allowlists
4. **Test patterns**: If new assertion patterns are discovered, add them to Step 4
5. **Coverage matrix**: Update the coverage matrix in Step 5 with current ✅/❌ status
6. **New resource types**: If custom resource types have specific response shapes, add a section for them
7. **Serialization concerns**: If new non-JSON-safe types (Map, Set, Date, BigInt) are used internally, add serialization safety checks

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why It Fails | Correct Pattern |
|-------------|-------------|-----------------|
| `expect(result).toHaveProperty('profile')` | Catches missing fields but NOT leaked extra fields | Use key allowlist: `expect(ALLOWED).toContain(key)` |
| `expect(result.profile).toBeDefined()` | Same — presence-only, no shape enforcement | Assert exact key set |
| `expect(result).toMatchObject({...})` | Ignores extra properties by design | Combine with `Object.keys()` check |
| Testing only fresh mock objects | Misses runtime mutations (cache attachment) | Add temporal coupling tests |
| Asserting only in unit tests | Misses serialization issues (Map→`{}`) | Test at E2E/live level too |

---

## Standing Rules

- Every new API endpoint MUST have a response contract test at unit + E2E level
- Every response contract test MUST include both allowlist AND denylist assertions
- `_`-prefixed fields (except `_links`) are ALWAYS internal and must NEVER appear in responses
- Map/Set objects must NEVER reach JSON serialization — strip or convert before response
- Temporal coupling tests are REQUIRED for any endpoint that shares in-memory state with SCIM operations
- Live test Section 9z-M verifies contracts against deployed instances

---

## Audit History

| Date | Version | Findings | Tests Added |
|------|---------|----------|-------------|
| 2026-04-17 | v0.37.2 | Initial creation. `_schemaCaches` leak found in 4/16 Azure endpoints. Extension URN cross-contamination confirmed. 3 endpoints had stale settings keys. | Unit: +12, E2E: +4, Live: Section 9z-M (+10 assertions) |
