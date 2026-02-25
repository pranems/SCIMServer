# SCIM 2.0 Compliance & Entra ID Compatibility

> RFC compliance status and Microsoft Entra ID provisioning compatibility for SCIMServer.

**Last Updated:** February 24, 2026

---

## Compliance Summary

| Category | Score | Notes |
|----------|-------|-------|
| Core Operations (CRUD) | **100%** | All operations for Users and Groups |
| Media Type (RFC 7644 §3.1) | **100%** | `application/scim+json` on all responses including errors |
| Discovery Endpoints (RFC 7644 §4) | **100%** | ServiceProviderConfig, Schemas, ResourceTypes |
| Error Handling (RFC 7644 §3.12) | **100%** | SCIM error schema, string status, scimType, detail |
| PATCH Operations (RFC 7644 §3.5.2) | **98%** | add/replace/remove, valuePath, extension URN, no-path merge, boolean coercion |
| Pagination (RFC 7644 §3.4.2) | **100%** | startIndex, count, totalResults, itemsPerPage |
| Filtering (RFC 7644 §3.4.2.2) | **100%** | All 10 operators: `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `lt`, `ge`, `le`, `pr` + `and`/`or`/`not` + grouping |
| POST /.search (RFC 7644 §3.4.3) | **100%** | SearchRequest body with filter, pagination, attributes, excludedAttributes |
| Attribute Projection (RFC 7644 §3.4.2.5) | **100%** | `attributes` and `excludedAttributes` params on GET and /.search |
| ETag / Conditional Requests (RFC 7644 §3.14) | **100%** | Version-based ETags `W/"v{N}"`, If-None-Match → 304, If-Match → 412, RequireIfMatch → 428 |
| Sorting (RFC 7644 §3.4.2.3) | **0%** | Not implemented (correctly listed as unsupported) |
| Bulk Operations (RFC 7644 §3.7) | **0%** | Not implemented (correctly listed as unsupported) |

**Overall: ~96% RFC 7643/7644 compliant** (remaining gaps: Bulk, Sorting — both optional per spec). All 25 Microsoft SCIM Validator tests pass + 7 preview tests pass. 2096 unit tests (61 suites), 368 E2E tests (19 suites), 334 live integration tests (334 pass, 0 known failures) — all passing.

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
| Dynamic `schemas[]` on Groups | Group responses include extension URNs from `rawPayload` |
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
| Enterprise User Extension | ✅ | Stored in rawPayload (employeeNumber, department, manager, etc.) |

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
| Always-returned attributes (`id`, `schemas`, `meta`) never excluded | ✅ |
| Resource-type-aware always-returned (`displayName` always for Groups, default for Users) | ✅ |
| `attributes` takes precedence over `excludedAttributes` | ✅ |

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

**Overall Entra ID Compatibility: ~95%** ✅

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
| Bulk operations | ❌ Not implemented | None — Entra doesn't use `/Bulk` |
| `/Me` endpoint | ❌ Not implemented | None — Entra provisioning doesn't use `/Me` |
| Complex filter operators (co, sw, ew, etc.) | ✅ Implemented | All 10 operators available (Entra only uses `eq` + `and`) |
| Sorting | ❌ Not implemented | None — Entra doesn't request sorting |

---

## Remaining Gaps (Optional Enhancements)

| Feature | Priority | Notes |
|---------|----------|-------|
| `sortBy` / `sortOrder` | Low | Listed as unsupported in ServiceProviderConfig |
| Bulk operations (`POST /Bulk`) | Low | Optional per spec; not used by Entra |
| `returned: never` attribute enforcement | Low | Attributes with `returned: 'never'` are not stripped from responses |
| `caseExact` enforcement in filters | Low | ✅ Fixed for `externalId` (CITEXT → TEXT). Schema-driven `caseExact` for dynamic attributes still pending |

---

## References

- [RFC 7643 — SCIM Core Schema](https://tools.ietf.org/html/rfc7643)
- [RFC 7644 — SCIM Protocol](https://tools.ietf.org/html/rfc7644)
- [Microsoft Entra SCIM Documentation](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)

---

*Consolidated from: SCIM_2.0_COMPLIANCE_ANALYSIS, ENTRA_ID_COMPATIBILITY_ANALYSIS*
