# Phase 12 — Sorting + Service Deduplication

> **Version**: v0.20.0 | **Gaps**: G12 (Sorting), G17 (Service Dedup) | **Status**: ✅ Complete

---

## Sorting (G12 — RFC 7644 §3.4.2.3)

### Overview

SCIM servers MAY support sorting of results using `sortBy` and `sortOrder` query parameters. SCIMServer now supports sorting on GET list endpoints and POST `/.search` for Users, Groups, and Generic resources.

### Implementation

| File | Change |
|------|--------|
| `api/src/modules/scim/common/scim-sort.util.ts` | Sort attribute mapping utility |
| Controllers (Users, Groups, Generic) | Added `sortBy`/`sortOrder` query params |
| Services (Users, Groups, Generic) | Thread sort params to repositories |
| `scim-schemas.constants.ts` | `sort.supported: true` in SPC |

### Supported Parameters

| Parameter | Values | Default |
|-----------|--------|---------|
| `sortBy` | Any SCIM attribute name (e.g., `userName`, `displayName`, `meta.created`) | None |
| `sortOrder` | `ascending`, `descending` | `ascending` |

### Test Coverage

| Category | Count | Status |
|----------|-------|--------|
| Unit tests (scim-sort.util) | 20 | ✅ All passing |
| E2E tests (sorting) | 14 | ✅ All passing |
| Live integration tests (9q) | 11 | ✅ All passing |
| **Total** | **45** | **✅ All passing** |

---

## Service Deduplication (G17)

### Problem

The `EndpointScimUsersService` (~904 lines) and `EndpointScimGroupsService` (~1005 lines) contained 13+ identical private methods for schema validation, boolean coercion, ETag enforcement, and JSON parsing.

### Solution

Extracted shared logic into `scim-service-helpers.ts`:

**Pure Functions** (stateless, no class dependency):
- `parseJson<T>()` — Safe JSON parsing with SCIM error
- `ensureSchema()` — Validates `schemas` array presence
- `enforceIfMatch()` — ETag If-Match header enforcement
- `sanitizeBooleanStrings()` — Boolean string → boolean coercion

**`ScimSchemaHelpers` Class** (parameterized by `schemaRegistry` + `coreSchemaUrn`):
- `enforceStrictSchemaValidation()`
- `validatePayloadSchema()`
- `buildSchemaDefinitions()`
- `getSchemaDefinitions()`
- `getBooleanKeys()`
- `getReturnedCharacteristics()`
- `getRequestOnlyAttributes()`
- `getExtensionUrns()`
- `coerceBooleanStringsIfEnabled()`
- `checkImmutableAttributes()`

### Impact

| Service | Before | After | Reduction |
|---------|--------|-------|-----------|
| Users | ~904 lines | ~640 lines | −29% |
| Groups | ~1005 lines | ~726 lines | −28% |
| Shared helpers | 0 lines | ~386 lines | New |

### Test Coverage

| Category | Count | Status |
|----------|-------|--------|
| Unit tests (scim-service-helpers) | 43 | ✅ All passing |
| Existing service tests | 2,462 | ✅ All passing (24 pre-existing) |
| **Total** | **43 new** | **✅ Zero regressions** |

---

## Combined Phase 12 Test Summary

| Category | New Tests | Total |
|----------|-----------|-------|
| Sorting unit | 20 | 20 |
| Sorting E2E | 14 | 14 |
| Sorting live | 11 | 11 |
| Dedup unit | 43 | 43 |
| **Phase 12 total** | **88** | **88 new tests** |

## RFC References

- **RFC 7644 §3.4.2.3** — Sorting
- **RFC 7643 §5** — ServiceProviderConfig (sort capability)
