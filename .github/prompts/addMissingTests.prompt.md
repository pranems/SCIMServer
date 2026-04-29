---
name: addMissingTests
description: Audit and add missing tests at all levels - unit, E2E, and live integration - covering all features, config flag combinations, attribute characteristics, and edge cases.
argument-hint: Optional scope like a feature name (e.g. "G8g"), file path, or flag name to narrow the audit.
---

Perform a comprehensive test gap audit across the entire project and add any missing tests. This is a **generic, project-wide** prompt - not scoped to any single feature or recent change.

---

## Step 1 - Inventory Current Coverage

1. **Read project context**: Read `Session_starter.md`, `docs/CONTEXT_INSTRUCTIONS.md`, `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md`, and `CHANGELOG.md` to understand the full feature set, all config flags, attribute characteristics, and current version.
2. **Read implementation source of truth**: Read `api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts` for the `ProfileSettings` interface - the canonical flag list with types and defaults. Also read `api/src/modules/endpoint/services/endpoint.service.ts` for derived flags.
3. **List all test files**: Enumerate all `*.spec.ts` (unit), `*.e2e-spec.ts` (E2E), and `scripts/live-test.ps1` sections to catalog what is already tested.
4. **Collect test names**: For each spec file, run `grep -n 'describe\|it(' <file>` to build a complete test inventory.
5. **Map features to tests**: For each implemented feature/flag/characteristic, verify that corresponding tests exist at all three levels (unit, E2E, live).
6. **Build coverage matrix**: Create a Feature × Test-Level grid (rows = features/flags/characteristics, columns = Unit/E2E/Live) marking ✅/❌ for each cell.

---

## Step 2 - Identify Gaps

Audit for missing tests in these categories:

### A. Config Flag Coverage (13 boolean flags in ProfileSettings + logLevel; settings v7)

For each flag (`UserSoftDeleteEnabled`, `UserHardDeleteEnabled`, `GroupHardDeleteEnabled`, `MultiMemberPatchOpForGroupEnabled`, `SchemaDiscoveryEnabled`, `AllowAndCoerceBooleanStrings`, `StrictSchemaValidation`, `VerbosePatchSupported`, `PatchOpAllowRemoveAllMembers`, `RequireIfMatch`, `PerEndpointCredentialsEnabled`, `IncludeWarningAboutIgnoredReadOnlyAttribute`, `IgnoreReadOnlyAttributesInPatch`, `logFileEnabled`):

**Deprecated flags (settings v7 clean break):** `SoftDeleteEnabled`, `ReprovisionOnConflictForSoftDeletedResource`, `MultiOpPatchRequestAddMultipleMembersToGroup`, `MultiOpPatchRequestRemoveMultipleMembersFromGroup`.
**Derived flags:** `CustomResourceTypesEnabled` (from profile.resourceTypes), `BulkOperationsEnabled` (from profile SPC).

| Check | Unit | E2E | Live |
|-------|------|-----|------|
| Flag ON behavior | ? | ? | ? |
| Flag OFF (default) behavior | ? | ? | ? |
| String values ("True"/"False"/"1"/"0") | ? | ? | ? |
| Invalid values rejected (validation) | ? | ? | ? |
| Flag absent → default applied | ? | ? | ? |

### B. Flag Combination Coverage

Priority combinations to verify:

| Combo | Why it matters | Expected interaction |
|-------|----------------|---------------------|
| `UserSoftDelete + StrictSchema` | Strict rejects bad payloads even when user is deactivated | Both enforced independently |
| `UserSoftDelete + RequireIfMatch` | Soft-deleted user returns 404 before ETag check | 404 before 428 check |
| `UserHardDelete false + UserSoftDelete true` | Only soft-delete allowed, hard-delete blocked | DELETE → 400, PATCH active=false allowed |
| `RequireIfMatch + VerbosePatch` | Both affect PATCH behavior | Independent; both enforced |
| `Bulk + StrictSchema` | Bulk operations should still validate schemas | Per-operation validation |
| `Bulk + CustomResourceTypes` | Bulk should work with custom resource CRUD | Custom type paths in Bulk |
| `StrictSchema + BooleanStrings` | Coercion happens before validation | Coerce first, then validate |
| `MultiMemberPatchOp + PatchOpAllowRemoveAll` | Both control group member PATCH behavior | Independent; each controls its scope |
| `SchemaDiscovery false` | Discovery endpoints return 404 | All 3 discovery endpoints gated |
| `GroupHardDelete false` | DELETE Groups blocked | 400 on DELETE |
| `PerEndpointCredentials + RequireIfMatch` | Both affect request validation flow | Each validated independently |
| `IncludeWarning + IgnoreReadOnly` | Both relate to readOnly handling | Warning emitted even when silently stripping |
| `IgnoreReadOnly` WITHOUT `StrictSchema` | readOnly attributes stripped silently | Stripping happens regardless of strict mode |
| `IncludeWarning` WITHOUT `IgnoreReadOnly` | Warning flag without stripping flag | Warning only when strict mode rejects |

- Three-flag and higher combinations for interacting flags

### C. Attribute Characteristics (RFC 7643 §2.4)

For each characteristic, verify across all operations:

| Characteristic | POST | GET | LIST | .search | PUT | PATCH | DELETE |
|---------------|------|-----|------|---------|-----|-------|--------|
| `returned: always` (id, schemas, meta) | ✅ always in response | ✅ always | ✅ always | ✅ always | ✅ always | ✅ always | N/A |
| `returned: never` (password) | ❌ never in response | ❌ never | ❌ never | ❌ never | ❌ never | ❌ never | N/A |
| `returned: default` (displayName, etc.) | ✅ unless excluded | ✅ unless excluded | ✅ unless excluded | ✅ unless excluded | ✅ unless excluded | ✅ unless excluded | N/A |
| `returned: request` (costCenter, etc.) | ❌ unless `?attributes=` | ❌ unless requested | ❌ unless requested | ❌ unless requested | ❌ unless requested | ❌ unless requested | N/A |
| `mutability: readOnly` (id, meta) | Ignored on input | N/A | N/A | N/A | Ignored | Rejected in PATCH | N/A |
| `mutability: readWrite` (displayName) | Accepted | N/A | N/A | N/A | Accepted | Accepted | N/A |
| `mutability: writeOnly` (password) | Accepted, never returned | N/A | N/A | N/A | Accepted | Accepted | N/A |
| `mutability: immutable` (userName) | Accepted on create | N/A | N/A | N/A | Rejected if changed | Rejected if changed | N/A |
| `uniqueness: server` (User.userName, Group.displayName) | 409 on conflict | N/A | N/A | N/A | 409 on conflict | 409 on conflict | N/A |
| `uniqueness: none` (externalId, User.displayName) | Duplicates allowed (201) | N/A | N/A | N/A | Duplicates allowed (200) | Duplicates allowed (200) | N/A |
| `caseExact: false` (userName) | Case-insensitive uniqueness | N/A | Case-insensitive filter | Case-insensitive filter | Case-insensitive uniqueness | Case-insensitive uniqueness | N/A |
| `required: true` (userName, schemas) | 400 if missing | N/A | N/A | N/A | 400 if missing (User) | N/A | N/A |

### D. Operation × Projection × Characteristic Matrix

Full cross-product to verify:

```
Operations:  POST, PUT, PATCH, GET, LIST, POST /.search
Projections: ?attributes=X, ?excludedAttributes=Y, both, neither
Characteristics: returned:always/never/default/request

= 6 ops × 4 projection combos × 4 returned types = 96 cells
```

Specifically check:
- Write-response projection (POST/PUT/PATCH + `?attributes=` or `?excludedAttributes=`)
- `?attributes=` on read ops includes `returned:request` attrs
- `?excludedAttributes=` on read ops cannot remove `returned:always` attrs
- `returned:never` is NEVER returned regardless of `?attributes=` requesting it
- Both params: `attributes` takes precedence (RFC 7644 §3.4.2.5)

### E. Error Path Coverage

| Error Scenario | Expected Status | Expected scimType | Tested? |
|---------------|----------------|-------------------|---------|
| Invalid/malformed `attributes` value (e.g., `,,`, `   `) | 200 (gracefully ignored) or 400 | - | ? |
| Non-existent attribute name in `?attributes=` | 200 (treated as empty match) | - | ? |
| Empty string `?attributes=` | 200 (full response) | - | ? |
| Spaces in attribute list `?attributes=userName , displayName` | 200 (trimmed) | - | ? |
| Mixed case `?attributes=UserName,DISPLAYNAME` | 200 (case-insensitive) | - | ? |
| `?excludedAttributes=id` attempt on always-returned | 200 (id still present) | - | ? |
| `?attributes=password` requesting returned:never | 200 (password still absent) | - | ? |
| Missing required field on POST | 400 | invalidValue | ? |
| Missing required field on PUT | 400 | invalidValue | ? |
| readOnly field in PATCH body | 400 | mutability | ? |
| Immutable field changed on PUT | 400 | mutability | ? |
| Uniqueness collision POST/PUT/PATCH | 409 | uniqueness | ? |
| Bulk with invalid operation | 200 (per-op 400 in response) | - | ? |
| Bulk without BulkOperationsEnabled | 403 | - | ? |
| Custom resource type without flag enabled | 404 | - | ? |

### F. Cross-Feature Integration

| Integration | Test Scenario | Expected Behavior |
|-------------|--------------|-------------------|
| Bulk + projection | `POST /Bulk` with `?attributes=` on individual ops | Each op response projected |
| Bulk + StrictSchema | Bulk op with unknown attribute + StrictSchema ON | Per-op 400 error |
| Bulk + SoftDelete | Bulk DELETE with SoftDelete ON | Hard-delete blocked (400); Bulk PATCH deactivate works |
| Custom resource types + projection | GET /CustomType?attributes=X | Projection works on custom types |
| Custom resource types + StrictSchema | POST custom type with unknown attr + StrictSchema | 400 rejected |
| ETag/If-Match + SoftDelete | PUT soft-deleted resource | 404 (not 412/428) |
| ETag/If-Match + Bulk | Bulk PUT/PATCH with If-Match per-op | Per-op ETag enforcement |
| SoftDelete + projection on writes | POST reprovision + `?attributes=` | Reprovisioned resource projected |
| SoftDelete + returned:request | GET soft-deleted resource | 404 (no projection check needed) |
| VerbosePatch + projection | PATCH with dot-path + `?attributes=` on response | Dot-path resolved, response projected |

### G. Live Integration Test Parity

- Every E2E test scenario should have a corresponding live test in `scripts/live-test.ps1`
- Live tests should cover both local (port 6000) and Docker (port 8080) scenarios
- Verify all live test sections in `scripts/live-test.ps1` exist by grepping for `TEST SECTION`
- Ensure new sections use the next available number (check current highest before `Section 10`; as of v0.40.0 the latest is **9z-U**)

### H. Resource-Type Symmetry

For every behavior tested on Users, verify the equivalent exists for Groups (and vice versa):

| Behavior | Users tested? | Groups tested? |
|----------|--------------|----------------|
| CRUD lifecycle (POST/GET/LIST/PUT/PATCH/DELETE) | ? | ? |
| Uniqueness enforcement (POST/PUT/PATCH) | ? | ? |
| Soft delete + reprovision | ? | ? |
| Attribute projection (read + write) | ? | ? |
| Schema validation (strict mode) | ? | ? |
| ETag / If-Match enforcement | ? | ? |
| Filter operators (eq, ne, co, sw, ew, gt, lt, ge, le, pr) | ? | ? |
| Boolean string coercion | ? | ? |
| Case-insensitive operations | ? | ? |
| SCIM ID leak prevention | ? | ? |

### I. HTTP Compliance & Protocol Tests

| Scenario | Expected | Tested? |
|----------|----------|---------|
| `Content-Type: application/scim+json` required | 415 if wrong | ✅ E2E + Live |
| `Content-Type: application/json` accepted | 200 | ✅ E2E + Live |
| Missing `Authorization` header | 401 | ? |
| Invalid bearer token | 401 | ? |
| Unknown route | 404 | ? |
| Method not allowed (e.g., DELETE /Users without id) | 405 | ✅ E2E + Live |
| `Location` header on POST 201 | Present with resource URI | ? |
| `ETag` header on all responses | Present when ETag enabled | ? |
| `If-None-Match: *` on GET (304) | 304 Not Modified | ? |
| Large payload (>1MB on Bulk) | 413 Too Large | ✅ E2E (test-gaps-audit) |

### J. Endpoint Profile System (Phase 13)

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| Create endpoint with default preset (entra-id) | ✅ | ✅ | ✅ |
| Create endpoint with named preset (rfc-standard, minimal, etc.) | ✅ | ✅ | ✅ |
| Create endpoint with inline profile | ✅ | ✅ | ? |
| Profile validation: reject loosening required | ✅ | ✅ | ? |
| Profile validation: reject type change | ✅ | ✅ | ? |
| PATCH deep-merge settings | ✅ | ✅ | ? |
| Discovery differs per preset (schemas, SPC) | ✅ | ✅ | ✅ |
| Profile hydration on boot (registry) | ✅ | N/A | ? |
| Profile change listener (registry rehydration) | ✅ | implicit | ? |
| Preset API (list + detail + 404) | ✅ | ✅ | ✅ |
| `configToProfile` backward compat (BulkOperationsEnabled→SPC) | N/A (removed in v0.29.0) | N/A | N/A |
| Mutually exclusive profilePreset + profile → 400 | ✅ | ✅ | ✅ |

### K. Endpoint Cache + Context (Phase 14.1)

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| Cache warm on boot (`onModuleInit` populates `cacheById` + `cacheByName`) | ✅ | N/A | ? |
| Cache-through on create (create → cache.set) | ✅ | implicit | ? |
| Cache-through on update (update → cache.set) | ✅ | implicit | ? |
| Cache-through on delete (delete → cache.delete) | ✅ | implicit | ? |
| Cache hit: `getEndpoint()` returns from cache (no DB) | ✅ | implicit | ? |
| Cache hit: `getEndpointByName()` returns from cache | ✅ | implicit | ? |
| Cache miss: fallback to DB | ✅ | N/A | ? |
| `listEndpoints` serves from cache when warmed | ✅ | implicit | ? |
| `EndpointContext.profile` stored via `setContext()` | ✅ | implicit | ? |
| `getProfile()` returns stored profile | ✅ | N/A | ? |
| `getConfig()` compat shim returns `profile.settings` | ✅ | implicit | ? |
| **Cache does not leak to API** - `_schemaCaches` stripped from `toFullResponse()` | ✅ | ✅ | ✅ |
| **`getExtensionUrns()` filters by `coreSchemaUrn`** - User service gets only User extensions | ✅ | N/A | ? |
| **`getExtensionUrns()` RT isolation** - Group service gets only Group extensions | ✅ | N/A | ? |
| **`getExtensionUrns()` cache hit** - returns cached extensionUrns when valid Map exists | ✅ | N/A | ? |
| **`getExtensionUrns()` fallback** - falls back to global registry when no RTs match | ✅ | N/A | ? |

### L. Registry Simplification + Derived Flags (Phase 14.2–14.4)

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| Minimal registry: `onModuleInit` expands rfc-standard preset | ✅ | N/A | ? |
| Root-level /Schemas returns 3 schemas (rfc-standard) | ✅ | ✅ | ? |
| Discovery controller serves from `profile` (not registry overlay) | implicit | ✅ | ✅ |
| Bulk derived from `profile.serviceProviderConfig.bulk.supported` | implicit | ✅ | ? |
| CustomResourceTypes derived from `profile.resourceTypes` | implicit | ✅ | ? |
| Bulk + StrictSchema combo | ? | ✅ | ? |
| user-only preset blocks Group CRUD | ? | ✅ | ✅ |
| Profile PATCH → config change reflects in endpoint | ? | ✅ | ✅ |
| Inline profile → discovery reflects it | ? | ✅ | ✅ |
| Preset API (list 6 + detail + 404) | ✅ | ✅ | ✅ |
| Per-preset discovery differentiation (schema count, SPC) | ✅ | ✅ | ✅ |

### M. Admin Endpoint API (v0.30.0)

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| List endpoint returns envelope `{ totalResults, endpoints[] }` | ✅ | ✅ | ✅ |
| `?view=summary` returns `profileSummary`, no `profile` | ✅ | ✅ | ✅ |
| `?view=full` returns `profile`, no `profileSummary` | ✅ | ✅ | ✅ |
| List defaults to summary, single-get defaults to full | ✅ | ✅ | ✅ |
| `scimBasePath` field (renamed from `scimEndpoint`) | ✅ | ✅ | ✅ |
| `_links` (self, stats, credentials, scim) on all responses | ✅ | ✅ | ✅ |
| ISO 8601 string timestamps (`createdAt`, `updatedAt`) | ✅ | ✅ | ✅ |
| `GET /admin/endpoints/presets` - list with summaries | ✅ | ✅ | ✅ |
| `GET /admin/endpoints/presets/:name` - full profile | ✅ | ✅ | ✅ |
| Unknown preset → 404 | ✅ | ✅ | ✅ |
| Nested stats: `users.{total,active,softDeleted}`, groups, etc. | ✅ | ✅ | ✅ |
| Old flat stats format absent (`totalUsers`, etc.) | ✅ | ✅ | ✅ |
| `ProfileSummary`: schemaCount, schemas[], resourceTypeCount, resourceTypes[] | ✅ | ✅ | ✅ |
| `ProfileSummary`: serviceProviderConfig boolean flags | ✅ | ✅ | ✅ |
| `ProfileSummary`: activeSettings (non-default only) | ✅ | ✅ | ✅ |
| `buildProfileSummary` handles empty/extension schemas | ✅ | N/A | N/A |
| **Response key allowlist** - full view has ONLY documented keys, no extras | ✅ | ✅ | ✅ |
| **Response key allowlist** - summary view has ONLY documented keys | ✅ | ✅ | ✅ |
| **Profile key allowlist** - only `schemas, settings, resourceTypes, serviceProviderConfig` | ✅ | ✅ | ✅ |
| **No `_schemaCaches` in API response** - internal runtime cache stripped | ✅ | ✅ | ✅ |
| **Profile clean after SCIM operations** - GET admin endpoint after SCIM CRUD shows no cache artifacts | ✅ | ✅ | ✅ |

### N. Logging & Error Handling (v0.32.0 overhaul)

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| Interceptor tiered log levels (5xx->ERROR, 401->WARN, 404->DEBUG, 4xx->INFO) | ✅ | ? | ? |
| GlobalExceptionFilter diagnostics on 500 (requestId/endpointId/logsUrl) | ✅ | ? | ? |
| triggeredBy on guardSoftDeleted, assertSchemaUniqueness, PatchError catches | ✅ | ? | ? |
| Service-level diagnostic logs before uniqueness/reprovision throws | ✅ | ? | ? |
| Silent catches have TRACE/DEBUG logs (15 catches in logging/activity-parser) | ✅ | N/A | N/A |
| Ring buffer default 2000 (was 500) | ✅ | ? | ? |
| Config change audit with before/after values | ✅ | ? | ? |
| Empty ring buffer hint when requestId returns 0 entries | ✅ | ✅ | ? |
| slowRequestThresholdMs runtime-configurable | ✅ | ? | ? |
| 409 conflictingResourceId/conflictingAttribute/incomingValue in diagnostics | ✅ | ✅ | ? |
| PATCH failedOperationIndex/failedPath/failedOp in diagnostics | ✅ | ✅ | ? |
| Filter parseError in invalidFilter diagnostics | ✅ | ✅ | ? |
| 428 currentETag in diagnostics | ✅ | ✅ | ? |
| operation auto-read from correlation context in diagnostics | ✅ | ? | ? |
| errorCode enum in ALL diagnostics (48 sites) | ✅ | ? | ? |
| All 50 createScimError calls have diagnostics (100%) | implicit | ✅ | ? |

### O. File Logging (Phase 1)

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| RotatingFileWriter size-based rotation | ✅ | N/A | ? |
| RotatingFileWriter creates parent directories | ✅ | N/A | ? |
| RotatingFileWriter maxFiles limit | ✅ | N/A | ? |
| FileLogTransport main file write (LOG_FILE) | ✅ | N/A | ? |
| FileLogTransport LOG_FILE="" disables main file | ✅ | N/A | ? |
| FileLogTransport per-endpoint file when logFileEnabled=True | ✅ | N/A | ? |
| FileLogTransport endpoint name sanitization | ✅ | N/A | ? |
| FileLogTransport disableEndpointFile closes handle | ✅ | N/A | ? |
| logFileEnabled profile setting wired to endpoint create/update | implicit | ? | ? |
| Docker volume mount for logs/ | N/A | N/A | ? |

### P. Operational Logging (Phase 4)

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| GET /admin/logs?minDurationMs=5000 filters by duration | ✅ | ? | ? |
| GET /endpoints/:id/logs/history queries DB filtered by endpoint | ✅ | ? | ? |
| GET /admin/log-config/audit returns config/endpoint/auth entries | ✅ | ? | ? |
| POST /admin/logs/prune?retentionDays=30 deletes old entries | ✅ | ? | ? |
| errorCode UNIQUENESS_USERNAME in 409 diagnostics | ✅ | ? | ? |

### Q. API Response Contract Enforcement (v0.37.2)

Every API endpoint response must be verified for **shape integrity** - not just "does field X exist?" but "does ONLY field X exist?" (allowlist) and "does internal field Y NOT exist?" (denylist).

| Scenario | Unit | E2E | Live |
|----------|------|-----|------|
| Full view response key allowlist (no extras) | ✅ | ✅ | ✅ |
| Summary view response key allowlist (no extras) | ✅ | ✅ | ✅ |
| Profile key allowlist (no `_schemaCaches`, no `_prismaMetadata`) | ✅ | ✅ | ✅ |
| `_schemaCaches` stripped even when runtime cache is populated | ✅ | ✅ | ✅ |
| Profile clean after SCIM CRUD triggers cache building | ✅ | ✅ | ✅ |
| Map/Set objects never serialize to `{}` in JSON responses | ✅ | implicit | ✅ |
| `_links` values match endpoint ID | ✅ | ✅ | ✅ |
| Extension URNs scoped per resource type (User ≠ Group) | ✅ | N/A | ? |
| SCIM error responses contain only documented fields | ✅ | ✅ | ✅ |
| List envelope has only `totalResults` + `endpoints` | ? | ✅ | ✅ |

**Anti-Pattern to avoid:**
```typescript
// ❌ BAD - catches absence but NOT leakage of extra fields
expect(result).toHaveProperty('profile');

// ✅ GOOD - catches both absence AND leakage
for (const key of Object.keys(result)) {
  expect(ALLOWED_KEYS).toContain(key);
}
```

---

## Step 3 - Implement Missing Tests

For each identified gap:

### Unit Tests (`.spec.ts`)

- Add to the appropriate existing `*.spec.ts` file following established patterns
- Use proper mock setup (`jest.fn()`, `mockResolvedValue`, `mockRejectedValue`)
- Group with `describe()` blocks matching existing conventions
- Use clear, descriptive `it('should ...')` names
- Example pattern:

```typescript
describe('featureName', () => {
  describe('when flag is ON', () => {
    beforeEach(() => {
      mockEndpointRepo.findOne.mockResolvedValue({
        ...baseEndpoint,
        profile: { settings: { FlagName: 'True' } },
      });
    });

    it('should enforce behavior X', async () => {
      const result = await service.methodName(endpointId, dto);
      expect(result).toHaveProperty('expectedField');
    });
  });

  describe('when flag is OFF (default)', () => {
    it('should skip behavior X', async () => {
      // ... default config
    });
  });
});
```

### E2E Tests (`.e2e-spec.ts`)

- Add to appropriate existing `*.e2e-spec.ts` file or create new one for genuinely new categories
- Use `createEndpointWithConfig()` helper for flag-dependent tests
- Example request/response patterns to test:

```typescript
// POST with attributes projection
const res = await request(app.getHttpServer())
  .post(`/scim/endpoints/${endpointId}/Users?attributes=userName`)
  .set('Authorization', `Bearer ${secret}`)
  .set('Content-Type', 'application/scim+json')
  .send({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName: 'test@example.com',
    displayName: 'Test User',
  })
  .expect(201);

// Verify projected response
expect(res.body).toHaveProperty('id');           // always-returned
expect(res.body).toHaveProperty('schemas');       // always-returned
expect(res.body).toHaveProperty('userName');      // explicitly requested
expect(res.body).not.toHaveProperty('displayName'); // not requested
```

```typescript
// Error: uniqueness conflict (409)
const res = await request(app.getHttpServer())
  .post(`/scim/endpoints/${endpointId}/Users`)
  .set('Authorization', `Bearer ${secret}`)
  .send({ schemas: [...], userName: 'existing@example.com' })
  .expect(409);

expect(res.body).toMatchObject({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
  status: '409',
  scimType: 'uniqueness',
});
```

### Live Integration Tests (`scripts/live-test.ps1`)

- Add new test sections to `scripts/live-test.ps1` **before TEST SECTION 10** (DELETE / Cleanup)
- Check current highest section number and use sequential numbering (`9q`, `9r`, etc.)
- Use `Get-Random` in resource names to avoid collisions across runs
- Use `$scimBase` (SCIM endpoint base URL) and `$headers` (auth headers) established at script top
- Tests must work in all modes: local (`-BaseUrl http://localhost:6000`), Docker (`-BaseUrl http://localhost:8080 -ClientSecret "docker-secret"`), and Azure

**Key variables available:**
- `$baseUrl` - Server root (e.g., `http://localhost:6000`)
- `$scimBase` - SCIM base for the test endpoint (`$baseUrl/scim/endpoints/$EndpointId`)
- `$headers` - `@{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }`
- `$EndpointId`, `$UserId`, `$GroupId` - IDs created in earlier setup sections

#### Pattern 1: Basic CRUD test with setup/verify/cleanup

```powershell
# ============================================
# TEST SECTION 9x: FEATURE NAME DESCRIPTION
$script:currentSection = "9x: Feature Name"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9x: FEATURE NAME DESCRIPTION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create test resources ---
Write-Host "`n--- Setup: Create Test Resources ---" -ForegroundColor Cyan
$testBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "9x-test-$(Get-Random)@test.com"
    displayName = "9x Test User"
    active = $true
} | ConvertTo-Json
$testUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $testBody
Test-Result -Success ($null -ne $testUser.id) -Message "9x.setup: Created test user"

# --- Test 9x.1: Verify behavior ---
Write-Host "`n--- Test 9x.1: Verify Behavior ---" -ForegroundColor Cyan
$result = Invoke-RestMethod -Uri "$scimBase/Users/$($testUser.id)?attributes=userName" -Method GET -Headers $headers
Test-Result -Success ($result.userName -like "*9x-test-*") -Message "9x.1: GET with attributes= returns userName"
Test-Result -Success ($null -eq $result.displayName) -Message "9x.2: GET with attributes= omits displayName"
Test-Result -Success ($null -ne $result.id) -Message "9x.3: always-returned id still present"

# --- Cleanup ---
Invoke-RestMethod -Uri "$scimBase/Users/$($testUser.id)" -Method DELETE -Headers $headers | Out-Null
Test-Result -Success $true -Message "9x.cleanup: Deleted test user"
```

#### Pattern 2: Config flag test (create endpoint with flag, test gated behavior)

```powershell
# --- Setup: Create endpoint WITH flag enabled ---
Write-Host "`n--- Setup: Endpoint with FlagName=True ---" -ForegroundColor Cyan
$flagEndpointBody = @{
    name = "live-test-flagname-$(Get-Random)"
    displayName = "Flag Test Endpoint"
    profilePreset = "rfc-standard"
} | ConvertTo-Json
$flagEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $flagEndpointBody
$FlagEndpointId = $flagEndpoint.id
# PATCH settings onto the new endpoint
$settingsBody = @{ profile = @{ settings = @{ FlagName = "True" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$FlagEndpointId" -Method PATCH -Headers $headers -Body $settingsBody -ContentType "application/json" | Out-Null
$scimBaseFlag = "$baseUrl/scim/endpoints/$FlagEndpointId"
Test-Result -Success ($null -ne $FlagEndpointId) -Message "9x.setup: Created endpoint with FlagName=True"

# --- Also create endpoint WITHOUT flag ---
$noFlagBody = @{
    name = "live-test-noflag-$(Get-Random)"
    displayName = "No Flag Endpoint"
} | ConvertTo-Json
$noFlagEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $noFlagBody
$NoFlagEndpointId = $noFlagEndpoint.id
$scimBaseNoFlag = "$baseUrl/scim/endpoints/$NoFlagEndpointId"

# --- Test: Flag OFF → blocked/default behavior ---
Write-Host "`n--- Test 9x.1: Flag OFF → expected default ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBaseNoFlag/SomeEndpoint" -Method POST -Headers $headers -Body $someBody
    Test-Result -Success $false -Message "9x.1 Should be rejected when flag disabled"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 403) -Message "9x.1 Rejected when flag disabled (HTTP $statusCode)"
}

# --- Test: Flag ON → allowed behavior ---
Write-Host "`n--- Test 9x.2: Flag ON → succeeds ---" -ForegroundColor Cyan
$flagResult = Invoke-RestMethod -Uri "$scimBaseFlag/SomeEndpoint" -Method POST -Headers $headers -Body $someBody
Test-Result -Success ($flagResult.schemas -contains "expected:schema:urn") -Message "9x.2 Succeeds when flag enabled"

# --- Cleanup: Delete both endpoints ---
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$FlagEndpointId" -Method DELETE -Headers $headers | Out-Null
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$NoFlagEndpointId" -Method DELETE -Headers $headers | Out-Null
```

#### Pattern 3: Error response capture (try/catch for expected non-2xx)

```powershell
# --- Test: Expected 409 Conflict ---
Write-Host "`n--- Test 9x.3: Uniqueness conflict → 409 ---" -ForegroundColor Cyan
$conflictBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $existingUser.userName  # duplicate
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $conflictBody
    Test-Result -Success $false -Message "Duplicate userName should return 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 409) -Message "Duplicate userName returns 409 Conflict (got $code)"
}

# --- Test: Expected 400 Bad Request ---
Write-Host "`n--- Test 9x.4: Invalid settings value → 400 ---" -ForegroundColor Cyan
$invalidBody = @{ profile = @{ settings = @{ SomeFlag = "invalid-value" } } } | ConvertTo-Json -Depth 4
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $invalidBody -ContentType "application/json"
    Test-Result -Success $false -Message "Invalid settings value should be rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid settings value rejected with 400 (got $statusCode)"
}
```

#### Pattern 4: Header inspection (Invoke-WebRequest for ETag, Location, Content-Type)

```powershell
# Use Invoke-WebRequest (not Invoke-RestMethod) when you need to inspect response HEADERS
Write-Host "`n--- Test 9x.5: ETag header on response ---" -ForegroundColor Cyan
$rawResponse = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method GET -Headers $headers
$etagHeader = $rawResponse.Headers['ETag']
$etagValue = if ($etagHeader -is [array]) { $etagHeader[0] } else { $etagHeader }
Test-Result -Success ($null -ne $etagValue -and $etagValue.Length -gt 0) -Message "9x.5: Response includes ETag header"
Test-Result -Success ($etagValue -like 'W/"*"') -Message "9x.6: ETag is weak format (W/`"...`")"

# --- Test: If-None-Match → 304 Not Modified ---
Write-Host "`n--- Test 9x.7: If-None-Match → 304 ---" -ForegroundColor Cyan
$conditionalHeaders = @{ Authorization="Bearer $Token"; 'Content-Type'='application/json'; 'If-None-Match'=$etagValue }
$conditionalRaw = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method GET -Headers $conditionalHeaders -SkipHttpErrorCheck
Test-Result -Success ($conditionalRaw.StatusCode -eq 304) -Message "9x.7: Matching If-None-Match returns 304"

# --- Test: POST includes Location header ---
Write-Host "`n--- Test 9x.8: POST includes Location header ---" -ForegroundColor Cyan
$createRaw = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $createBody
Test-Result -Success ($createRaw.StatusCode -eq 201) -Message "9x.8: POST returns 201"
$locationHeader = $createRaw.Headers['Location']
$locationValue = if ($locationHeader -is [array]) { $locationHeader[0] } else { $locationHeader }
Test-Result -Success ($null -ne $locationValue -and $locationValue -like "*Users/*") -Message "9x.9: Location header present with resource URI"
```

#### Pattern 5: Bulk operations test

```powershell
# --- Test: Bulk POST with multiple operations ---
Write-Host "`n--- Test 9x.10: Bulk POST ---" -ForegroundColor Cyan
$bulkBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    failOnErrors = 0
    Operations = @(
        @{
            method = "POST"
            path = "/Users"
            bulkId = "user1"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                userName = "bulk-user-$(Get-Random)@test.com"
                displayName = "Bulk Test"
                active = $true
            }
        }
    )
} | ConvertTo-Json -Depth 5
$bulkResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkBody -ContentType "application/scim+json"
Test-Result -Success ($bulkResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:BulkResponse") -Message "9x.10: Bulk response has correct schema"
Test-Result -Success ($bulkResult.Operations.Count -ge 1) -Message "9x.11: Bulk response contains operations"
$firstOp = $bulkResult.Operations[0]
Test-Result -Success ($firstOp.status -eq "201") -Message "9x.12: First bulk op returns 201"
# Cleanup
$bulkUserId = $firstOp.location -replace '.*/', ''
if ($bulkUserId) {
    try { $null = Invoke-RestMethod -Uri "$scimBaseBulk/Users/$bulkUserId" -Method DELETE -Headers $headers } catch {}
}
```

#### Pattern 6: PATCH operations (no-path, with-path, replace, add, remove)

```powershell
# --- Test: PATCH replace with no-path ---
Write-Host "`n--- Test 9x.13: PATCH replace no-path ---" -ForegroundColor Cyan
$patchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ displayName = "Patched Name" }
    })
} | ConvertTo-Json -Depth 4
$patchResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchBody
Test-Result -Success ($patchResult.displayName -eq "Patched Name") -Message "9x.13: PATCH replace no-path works"

# --- Test: PATCH with path and value ---
$patchPathBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        path = "displayName"
        value = "Path Patched"
    })
} | ConvertTo-Json -Depth 4
$patchPathResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchPathBody
Test-Result -Success ($patchPathResult.displayName -eq "Path Patched") -Message "9x.14: PATCH with path works"
```

#### Pattern 7: Write-response projection (POST/PUT/PATCH + ?attributes=)

```powershell
# --- Test: POST with ?attributes= projection on write response ---
Write-Host "`n--- Test 9x.15: POST with attributes= projection ---" -ForegroundColor Cyan
$projBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "proj-test-$(Get-Random)@test.com"
    displayName = "Projection Test"
    active = $true
} | ConvertTo-Json
$projResult = Invoke-RestMethod -Uri "$scimBase/Users?attributes=userName" -Method POST -Headers $headers -Body $projBody
Test-Result -Success ($null -ne $projResult.id) -Message "9x.15: always-returned id present"
Test-Result -Success ($null -ne $projResult.userName) -Message "9x.16: requested userName present"
Test-Result -Success ($null -eq $projResult.displayName) -Message "9x.17: non-requested displayName absent"
Test-Result -Success ($null -ne $projResult.schemas) -Message "9x.18: always-returned schemas present"

# --- Cleanup ---
Invoke-RestMethod -Uri "$scimBase/Users/$($projResult.id)" -Method DELETE -Headers $headers | Out-Null
```

---

## Step 4 - Verify

1. Run unit tests: `cd api; npx jest --forceExit` - confirm all pass.
2. Run E2E tests: `cd api; npx jest --config test/e2e/jest-e2e.config.ts --forceExit` - confirm all pass.
3. Report added test counts in this format:

| Level | Before | After | Delta |
|-------|--------|-------|-------|
| Unit  | 3,429  | ?     | +?    |
| E2E   | 1,149  | ?     | +?    |
| Live  | ~817   | ?     | +?    |

> *Source of truth for baseline counts: [PROJECT_HEALTH_AND_STATS.md](../../docs/PROJECT_HEALTH_AND_STATS.md#test-suite-summary)*
> *Last updated: v0.40.0 - API Contract Verification #4 (2026-04-29)*

4. Update `Session_starter.md` and `docs/CONTEXT_INSTRUCTIONS.md` with new test counts.

---

## Step 5 - Self-Update This Prompt

After completing the audit and implementation, review **this prompt itself** for staleness:

1. **New config flags**: If any new config flags were added to the project since this prompt was last updated, add them to Section A's flag list and Section B's combination table.
2. **New attribute characteristics or schema changes**: If new `returned`, `mutability`, `uniqueness`, or `required` behaviors were introduced, update Section C's matrix.
3. **New features or modules**: If new features (e.g., new SCIM operations, new resource types, new middleware) exist that aren't reflected in the gap categories (A–I), add a new category or expand existing ones.
4. **New test files or sections**: If new E2E spec files, unit spec files, or live-test sections were created that change the naming or numbering conventions, update Steps 1 and 3.
5. **Retired or renamed flags/features**: Remove or rename any references to flags, features, or files that no longer exist.
6. **Live test section numbering**: Update the "next section" guidance to reflect the latest section numbers actually present in `scripts/live-test.ps1`.
7. **Test count baselines**: If the prompt references expected test counts, update them to the current totals from the latest test run.
8. **New cross-feature integrations**: If new features create new interaction surfaces (e.g., a new flag that interacts with existing ones), add rows to Section F's integration table.
9. **New resource types**: If custom resource types are widely used, add them to Section H's symmetry checks.
10. **Example code patterns**: If test helper signatures change (e.g., `createEndpointWithConfig()` gains new params), update the example snippets in Step 3.

If any updates are needed, apply them directly to this file (`.github/prompts/addMissingTests.prompt.md`) so future runs of this prompt remain accurate and comprehensive.

---

## Standing Rules

- Follow the project's Feature/Bug-Fix Commit Checklist from `.github/copilot-instructions.md`.
- Do NOT create new documentation files unless explicitly requested.
- Follow existing test file patterns, naming conventions, and fixture helpers.
- Use worker-prefixed fixtures for parallel E2E safety (e.g., `worker-1-testuser@test.com`).
- Ensure assertions are specific and non-tautological (no false positives).
- Every test must clean up its own resources (create → test → delete).
- Test both the happy path AND the error path for every feature.
- Use `toMatchObject()` for partial JSON matching, `toHaveProperty()` for field presence.
- **API Response Contract**: Every test that reads an API response MUST include a key allowlist OR denylist assertion. Presence-only tests (`toHaveProperty`) are insufficient - they catch missing fields but not leaked internal fields.
- **Internal Field Denylist**: Runtime-only fields prefixed with `_` (e.g., `_schemaCaches`, `_prismaMetadata`) must NEVER appear in API responses. Add explicit `not.toHaveProperty('_schemaCaches')` assertions.
- **Serialization Safety**: Map/Set objects serialize to `{}` via `JSON.stringify`. Any field containing Maps must be stripped before API response serialization.
- Live tests must work with `-BaseUrl http://localhost:8080 -ClientSecret "devscimclientsecret"` (Docker mode).
