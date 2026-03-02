# SCIM 2.0 Compliance & Entra ID Compatibility

> RFC compliance status and Microsoft Entra ID provisioning compatibility for SCIMServer.

**Last Updated:** March 1, 2026

---

## Compliance Summary

| Category | Score | Notes |
|----------|-------|-------|
| Core Operations (CRUD) | **100%** | All operations for Users and Groups |
| Media Type (RFC 7644 §3.1) | **100%** | `application/scim+json` on all responses including errors |
| Discovery Endpoints (RFC 7644 §4) | **100%** | ServiceProviderConfig, Schemas, ResourceTypes — all RFC requirements met including auth bypass (D1), individual lookups (D2/D3), `schemas` arrays (D4/D5), `primary` flag (D6). See [DISCOVERY_ENDPOINTS_RFC_AUDIT.md](DISCOVERY_ENDPOINTS_RFC_AUDIT.md) |
| Error Handling (RFC 7644 §3.12) | **100%** | SCIM error schema, string status, scimType, detail |
| PATCH Operations (RFC 7644 §3.5.2) | **98%** | add/replace/remove, valuePath, extension URN, no-path merge, boolean coercion |
| Pagination (RFC 7644 §3.4.2) | **100%** | startIndex, count, totalResults, itemsPerPage |
| Filtering (RFC 7644 §3.4.2.2) | **100%** | All 10 operators: `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `lt`, `ge`, `le`, `pr` + `and`/`or`/`not` + grouping |
| POST /.search (RFC 7644 §3.4.3) | **100%** | SearchRequest body with filter, pagination, attributes, excludedAttributes |
| Attribute Projection (RFC 7644 §3.4.2.5) | **100%** | `attributes` and `excludedAttributes` params on GET, /.search, POST, PUT, and PATCH (write-response projection added in v0.19.2 — G8g) |
| ETag / Conditional Requests (RFC 7644 §3.14) | **100%** | Version-based ETags `W/"v{N}"`, If-None-Match → 304, If-Match → 412, RequireIfMatch → 428 |
| Sorting (RFC 7644 §3.4.2.3) | **100%** | `sortBy` / `sortOrder` on GET and POST `/.search` for Users, Groups, Generic. SPC: `sort.supported: true` (v0.20.0) |
| Bulk Operations (RFC 7644 §3.7) | **100%** | `POST /Bulk` with sequential processing, `bulkId` cross-referencing, `failOnErrors` threshold, per-endpoint `BulkOperationsEnabled` flag (v0.19.0) |
| `/Me` Endpoint (RFC 7644 §3.11) | **100%** | JWT `sub` → `userName` identity resolution, full CRUD delegation, attribute projection (v0.20.0) |
| Per-Endpoint Credentials (RFC 7643 §7) | **100%** | bcrypt-hashed per-endpoint tokens, admin CRUD API, 3-tier fallback chain, `PerEndpointCredentialsEnabled` flag (v0.21.0) |

**Overall: 100% RFC 7643/7644 compliant** — All 27 migration gaps (G1–G20) fully resolved as of v0.24.0. P2 attribute characteristic enforcement complete. All 25 Microsoft SCIM Validator tests pass + 7 preview tests pass. 📊 See [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md#test-suite-summary) for current test counts.

### New in v0.24.0

| Feature | Description |
|---------|-------------|
| R-RET-1: Schema-driven always-returned | Attributes with `returned:'always'` in schema definitions are now immune to `attributes=` filtering and `excludedAttributes=` exclusion at the projection level. |
| R-RET-2: Group `active` always returned | Group schema's `active` attribute (`returned:'always'`) is preserved in all Group responses regardless of projection parameters. |
| R-RET-3: Sub-attr `returned:'always'` | Sub-attributes like `emails.value` and `members.value` with `returned:'always'` are included even when only sibling sub-attrs requested (e.g., `?attributes=emails.type` now includes `emails.value`). |
| R-MUT-1: writeOnly → returned:never | Attributes with `mutability:'writeOnly'` are added to the `never` set, ensuring they never appear in responses even if `returned` is not explicitly `'never'`. |
| R-MUT-2: readOnly sub-attr stripping | `stripReadOnlyAttributes()` and `stripReadOnlyPatchOps()` now strip readOnly sub-attributes within readWrite parents (e.g., `manager.displayName`) on POST/PUT/PATCH. |
| R-CASE-1: caseExact-aware filtering | `evaluateFilter()` accepts `caseExactAttrs` set, performs case-sensitive comparisons for `caseExact:true` attributes (`id`, `externalId`, `meta.location`). |
| Test Coverage | 34 new unit + 13 E2E + 13 live tests (section 9v). |

### New in v0.22.0

| Feature | Description |
|---------|-------------|
| ReadOnly Attribute Stripping (RFC 7643 §2.2) | POST/PUT payloads auto-strip `mutability:'readOnly'` attributes (`id`, `meta`, `groups`, custom readOnly). PATCH readOnly ops silently stripped (behavior matrix: strict OFF → strip; strict ON + `IgnoreReadOnlyAttributesInPatch` → strip; strict ON without flag → G8c 400). Covers Users, Groups, AND Generic (custom) resource types. |
| Warning URN Extension | `urn:scimserver:api:messages:2.0:Warning` in responses when `IncludeWarningAboutIgnoredReadOnlyAttribute` enabled. Industry-aligned (Okta, Ping, AWS SSO pattern). |
| 2 New Config Flags | `IncludeWarningAboutIgnoredReadOnlyAttribute` (14th boolean flag, default: false) + `IgnoreReadOnlyAttributesInPatch` (15th boolean flag, default: false). |
| AsyncLocalStorage Middleware | `EndpointContextStorage.createMiddleware()` wraps requests in `storage.run()` for reliable warning accumulation across NestJS interceptor pipeline. Critical fix: `enterWith()` context loss. |
| Generic Service readOnly Support | Dynamic schema resolution via `getSchemaDefinitions()` for custom resource types. Full PATCH behavior matrix coverage. |
| BF-1: Groups `id` Fix | Server-generates `randomUUID()` always — client `id` no longer accepted (RFC 7643 §3.1). |
| Test Coverage | 13 unit (strip helpers) + 10 unit (EndpointContextStorage) + 17 E2E (readonly-stripping) + 10 live (section 9t). |

### New in v0.21.0

| Feature | Description |
|---------|-------------|
| G11 — Per-Endpoint Credentials | `EndpointCredential` Prisma model with bcrypt-hashed tokens. `PerEndpointCredentialsEnabled` flag (12th boolean flag). Admin API at `/admin/endpoints/{id}/credentials` (POST/GET/DELETE). 3-tier auth fallback: per-endpoint bcrypt → OAuth JWT → global secret. Lazy bcrypt loading. 33+16+22 new tests. Compliance: ~99%→**100%**. |

### New in v0.20.0

| Feature | Description |
|---------|-------------|
| Phase 10 — `/Me` Endpoint (RFC 7644 §3.11) | `ScimMeController` — resolves JWT `sub` → `userName`, delegates full CRUD. Attribute projection on all /Me operations. 11+10+15 new tests. |
| Phase 12 — Sorting (RFC 7644 §3.4.2.3) | `scim-sort.util.ts`. `sortBy`/`sortOrder` on GET and POST `/.search`. `sort.supported: true` in SPC. 20+14+11 new tests. |
| G17 — Service Deduplication | `scim-service-helpers.ts`: 13+ duplicate methods extracted from Users/Groups services. Users service −29% LoC, Groups service −28% LoC. 43 new unit tests. |

### New in v0.19.3

| Feature | Description |
|---------|-------------|
| D1\u2013D6 \u2014 Discovery Endpoints RFC Audit | All 6 RFC 7644 \u00a74 / RFC 7643 \u00a75\u2013\u00a77 gaps resolved: D1 (`@Public()` auth bypass on all 4 controllers), D2 (`GET /Schemas/{uri}`), D3 (`GET /ResourceTypes/{id}`), D4/D5 (`schemas[]` arrays), D6 (`primary:true`). 26+16 new tests. |
| Multi-Tenant Discovery Architecture | Two-tier routing: root-level (global defaults) + endpoint-scoped (primary for multi-tenant). Per-endpoint config overlay merging in `ScimSchemaRegistry`. JSDoc + docs updated. 14+9 new tests. |

### New in v0.19.2

| Feature | Description |
|---------|-------------|
| G8g — Write-Response Attribute Projection | `attributes`/`excludedAttributes` query params honored on POST/PUT/PATCH write responses (RFC 7644 §3.9). Replaced 6 inline stripping loops with `applyAttributeProjection()` calls. 23+14+33 new tests. |

### New in v0.19.1

| Feature | Description |
|---------|-------------|
| G8f — Group Uniqueness on PUT/PATCH | `assertUniqueDisplayName()` and `assertUniqueExternalId()` now called on PUT/PATCH paths with `excludeScimId` self-exclusion. 10+6+10 new tests. |

### New in v0.19.0

| Feature | Description |
|---------|-------------|
| Phase 9 — Bulk Operations (RFC 7644 §3.7) | `POST /Bulk` with sequential processing, `bulkId` cross-referencing, `failOnErrors` threshold. `BulkOperationsEnabled` per-endpoint flag (default: false). SPC: `bulk.supported=true, maxOperations=1000, maxPayloadSize=1048576`. 43+24+18 new tests. |

### New in v0.18.0

| Feature | Description |
|---------|-------------|
| G8b — Custom Resource Type Registration | Data-driven extensibility beyond User/Group. Admin API for resource type CRUD. Generic SCIM CRUD controller with wildcard `:resourceType` routing. `GenericPatchEngine` for JSONB-based PATCH. `CustomResourceTypesEnabled` per-endpoint flag (default: false). 121+29+20 new tests. |

### New in v0.17.4

| Feature | Description |
|---------|-------------|
| G8e — `returned` Characteristic Filtering | RFC 7643 §2.4 compliance. Service layer strips `returned:'never'` (e.g. `password`) from ALL responses. Controller layer strips `returned:'request'` from read ops unless explicitly requested. `password` attribute added to User schema constants. Deep-frozen schema constants prevent runtime mutation. 40+8+10 new tests. |

### New in v0.17.3

| Feature | Description |
|---------|-------------|
| G8c — PATCH readOnly Pre-Validation | `SchemaValidator.validatePatchOperationValue()` enforces `mutability:'readOnly'` on PATCH ops. Rejects add/replace/remove on readOnly attrs (e.g. `groups`) with 400. `groups` attribute added to User schema constants. Gated behind `StrictSchemaValidation`. 25+7 new tests. |

### New in v0.17.2

| Feature | Description |
|---------|-------------|
| `AllowAndCoerceBooleanStrings` flag | Coerces `"True"`/`"False"` strings to native booleans before schema validation (default on). Schema-aware: only coerces attributes whose schema type is `"boolean"` (V16/V17 fix). |
| `ReprovisionOnConflictForSoftDeletedResource` flag | Re-activates soft-deleted resources on POST conflict (clears `deletedAt`, sets `active=true`) instead of 409 (requires SoftDeleteEnabled). 10th boolean flag. |
| Soft-delete `deletedAt` tracking | Soft-delete now sets `deletedAt` timestamp + `active=false`. Guard uses `deletedAt != null` (not `active`) to distinguish from PATCH-disabled resources. New Prisma column: `deletedAt DateTime? @db.Timestamptz`. |
| Group `active` field | Groups now include `active: boolean` in domain models and SCIM responses. Created with `active: true`. |
| Reprovision (re-activation) | Soft-deleted Users and Groups can be re-activated on POST conflict when `ReprovisionOnConflictForSoftDeletedResource` is enabled. |
| In-memory EndpointService/LoggingService | Both services support `PERSISTENCE_BACKEND=inmemory` for fully Prisma-free operation |
| Resource-type-aware projection | `displayName` always-returned only for Groups (RFC 7643); excludable for Users |
| `getConfigBooleanWithDefault()` | Config helper for flags defaulting to `true` |
| externalId caseExact compliance | `externalId` column changed from `CITEXT` to `TEXT` — case-sensitive per RFC 7643 §3.1 (`caseExact: true`). Filter engine uses `'text'` type for case-sensitive `co`/`sw`/`ew`. Migration: `20260225181836_externalid_citext_to_text`. See `docs/EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md`. |
| `SchemaValidator.collectBooleanAttributeNames()` | New static method — extracts boolean-typed attribute names from schema definitions for schema-aware coercion |
| `SchemaValidator.validateFilterAttributePaths()` | V32 — validates filter attribute paths against registered schema definitions |
| `scim-filter-parser.ts` | New module for extracting attribute paths from parsed SCIM filter AST |
| Startup StrictSchemaValidation warning | `main.ts` logs warning when StrictSchemaValidation is OFF by default |

### New in v0.17.1

| Feature | Description |
|---------|-------------|
| `SchemaValidator` (816 lines) | Pure domain RFC 7643 payload validator: 8 SCIM types, mutability enforcement, required attrs, unknown attrs, sub-attribute recursion, canonicalValues, size limits |
| Immutable enforcement | `checkImmutable()` enforces RFC 7643 §2.2 on PUT + PATCH flows (old-vs-new comparison) |
| Post-PATCH validation | SchemaValidator.validate() with `mode: 'patch'` in user and group services |
| Adversarial hardening | 30 of 33 validation gaps closed: DTO validators, payload size limits, patch op limits, schema URN validation |
| Version-based ETags | `W/"v{N}"` monotonic ETags with pre-write If-Match enforcement (412) and RequireIfMatch config (428) |

### New in v0.15.0

| Feature | Description |
|---------|-------------|
| `SoftDeleteEnabled` config flag | Soft delete (set `active=false`) instead of physical row deletion on DELETE |
| `StrictSchemaValidation` config flag | Reject extension URNs not declared in `schemas[]` or not registered |
| Custom Extension URNs (msfttest) | 4 msfttest extension schemas registered globally (2 User + 2 Group) |
| Dynamic `schemas[]` on Groups | Group responses include extension URNs from `payload` |
| 7 built-in schemas | User, EnterpriseUser, Group + 4 msfttest extensions (was 3) |

---

## Core Resource Types (RFC 7643)

| Feature | Status | Notes |
|---------|--------|-------|
| User Resource | ✅ | userName, externalId, active, name, emails, roles, etc. |
| Group Resource | ✅ | displayName, externalId, members (value/display/type) |
| `schemas` attribute | ✅ | Present on all resources |
| `meta` attribute | ✅ | resourceType, created, lastModified, location, version |
| `id` | ✅ | Server-assigned UUID, immutable |
| Enterprise User Extension | ✅ | Stored in payload JSONB (employeeNumber, department, manager, etc.) |

## HTTP Operations (RFC 7644)

| Operation | Endpoint | Status |
|-----------|----------|--------|
| POST (Create) | `/Users`, `/Groups` | ✅ 201 + Location header |
| GET (Read) | `/Users/{id}`, `/Groups/{id}` | ✅ With ETag header |
| GET (List) | `/Users`, `/Groups` | ✅ ListResponse with pagination |
| POST (Search) | `/Users/.search`, `/Groups/.search` | ✅ 200 + ListResponse |
| PUT (Replace) | `/Users/{id}`, `/Groups/{id}` | ✅ Full resource replacement |
| PATCH (Update) | `/Users/{id}`, `/Groups/{id}` | ✅ PatchOp with add/replace/remove |
| DELETE | `/Users/{id}`, `/Groups/{id}` | ✅ 204 No Content (supports `SoftDeleteEnabled` for soft delete) |

## PATCH Operations (RFC 7644 §3.5.2)

| Capability | Status |
|-----------|--------|
| `add` / `replace` / `remove` operations | ✅ |
| Case-insensitive op values (`Add`, `Replace`, `Remove`) | ✅ |
| ValuePath filter expressions (`emails[type eq "work"].value`) | ✅ |
| Extension URN paths (`urn:...:enterprise:2.0:User:manager`) | ✅ |
| No-path replace (object merge) | ✅ |
| Empty-value removal (RFC 7644 §3.5.2.3) | ✅ |
| Dot-notation path resolution (`name.givenName`) | ✅ (via VerbosePatchSupported flag) |
| Boolean coercion (string `"True"` → boolean `true`) | ✅ (via `AllowAndCoerceBooleanStrings` flag, default on) |
| Group PATCH returns 200 with body | ✅ |

## Attribute Projection (RFC 7644 §3.4.2.5)

| Feature | Status |
|---------|--------|
| `?attributes=userName,displayName` on GET | ✅ |
| `?excludedAttributes=emails,members` on GET | ✅ |
| `attributes` / `excludedAttributes` in POST /.search body | ✅ |
| `?attributes` / `?excludedAttributes` on POST, PUT, PATCH write responses (RFC 7644 §3.9) | ✅ (G8g) |
| Always-returned attributes (`id`, `schemas`, `meta`) never excluded | ✅ |
| Resource-type-aware always-returned (`displayName` always for Groups, default for Users) | ✅ |
| `attributes` takes precedence over `excludedAttributes` | ✅ |
| Dotted sub-attribute paths (`name.givenName`) in projection | ✅ |
| `returned:'never'` attributes stripped from ALL responses (POST/PUT/PATCH/GET) | ✅ (G8e) |
| `returned:'request'` attributes stripped unless explicitly requested via `?attributes=` | ✅ (G8e/G8g) |

## ETag & Conditional Requests (RFC 7644 §3.14)

| Feature | Status |
|---------|--------|
| `ETag` header on GET/POST/PUT/PATCH responses | ✅ Weak ETag `W/"v{N}"` (version-based, monotonic) |
| `meta.version` matches ETag value | ✅ |
| `If-None-Match` → 304 Not Modified | ✅ |
| `If-None-Match` with stale ETag → 200 | ✅ |
| `If-Match` pre-write enforcement → 412 Precondition Failed | ✅ (PATCH/PUT/DELETE) |
| `RequireIfMatch` config → 428 Precondition Required | ✅ Per-endpoint flag |
| ETag changes after modifications | ✅ Atomic version increment |
| ServiceProviderConfig `etag.supported = true` | ✅ |

---

## Microsoft Entra ID Compatibility

**Overall Entra ID Compatibility: 100%** ✅

SCIMServer passes all critical requirements for Microsoft Entra ID enterprise application provisioning.

### Entra-Specific Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| OAuth 2.0 Client Credentials auth | ✅ | `POST /scim/oauth/token` |
| Bearer token authentication | ✅ | All SCIM endpoints |
| User CRUD (POST/GET/PUT/PATCH/DELETE) | ✅ | Full lifecycle |
| Group CRUD | ✅ | Including member management |
| Case-insensitive PATCH ops (`Add`/`Replace`/`Remove`) | ✅ | Entra sends capitalized op values |
| `filter=externalId eq "..."` | ✅ | Entra's primary lookup method |
| `filter=userName eq "..."` | ✅ | Secondary lookup |
| Multi-member PATCH (add) | ✅ | Via `MultiOpPatchRequestAddMultipleMembersToGroup` flag |
| Multi-member PATCH (remove) | ✅ | Via `MultiOpPatchRequestRemoveMultipleMembersFromGroup` flag |
| Soft delete (`active=false`) | ✅ | User remains queryable |
| 409 Conflict for duplicates | ✅ | userName and externalId uniqueness per endpoint |
| `application/scim+json` Content-Type | ✅ | On all success and error responses |
| Discovery endpoints | ✅ | Schemas, ResourceTypes, ServiceProviderConfig |
| ListResponse for empty results | ✅ | Returns `{"totalResults": 0, "Resources": []}` |

### Not Required by Entra ID

| Feature | Status | Impact |
|---------|--------|--------|
| Bulk operations | ✅ Implemented (v0.19.0) | None — Entra doesn't use `/Bulk` |
| `/Me` endpoint | ✅ Implemented (v0.20.0) | None — Entra provisioning doesn't use `/Me` |
| Complex filter operators (co, sw, ew, etc.) | ✅ Implemented | All 10 operators available (Entra only uses `eq` + `and`) |
| Sorting | ✅ Implemented (v0.20.0) | None — Entra doesn't request sorting |

---

## Remaining Gaps (Optional Enhancements)

| Feature | Priority | Notes |
|---------|----------|-------|
| ~~D1 — Discovery endpoints require auth~~ | ~~High~~ | ✅ Resolved v0.19.3 — `@Public()` on all 4 discovery controllers |
| ~~D2 — No `GET /Schemas/{uri}` individual lookup~~ | ~~Medium~~ | ✅ Resolved v0.19.3 — `@Get(':uri')` route added |
| ~~D3 — No `GET /ResourceTypes/{id}` individual lookup~~ | ~~Medium~~ | ✅ Resolved v0.19.3 — `@Get(':id')` route added |
| ~~D4 — Schema resources missing `schemas` array~~ | ~~Low~~ | ✅ Resolved v0.19.3 — `schemas: ["...Schema"]` added |
| ~~D5 — ResourceType resources missing `schemas` array~~ | ~~Low~~ | ✅ Resolved v0.19.3 — `schemas: ["...ResourceType"]` added |
| ~~D6 — SPC `authenticationSchemes` missing `primary` flag~~ | ~~Very Low~~ | ✅ Resolved v0.19.3 — `primary: true` added |
| ~~`sortBy` / `sortOrder`~~ | ~~Low~~ | ✅ Resolved v0.20.0 — `sort.supported: true`, sortBy/sortOrder on GET and `/.search` |
| ~~`/Me` endpoint~~ | ~~Low~~ | ✅ Resolved v0.20.0 — JWT `sub` → userName identity resolution, full CRUD |
| ~~`caseExact` enforcement in filters~~ | ~~Low~~ | ✅ Resolved v0.24.0 — R-CASE-1: `evaluateFilter()` accepts `caseExactAttrs` set for schema-driven case-sensitive comparisons on `caseExact:true` attributes (`id`, `externalId`, `meta.location`). `externalId` column also TEXT (CITEXT → TEXT in v0.17.2). |

---

## References

- [RFC 7643 — SCIM Core Schema](https://tools.ietf.org/html/rfc7643)
- [RFC 7644 — SCIM Protocol](https://tools.ietf.org/html/rfc7644)
- [Microsoft Entra SCIM Documentation](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)

---

*Consolidated from: SCIM_2.0_COMPLIANCE_ANALYSIS, ENTRA_ID_COMPATIBILITY_ANALYSIS*
