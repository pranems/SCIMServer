# G8g — Write-Response Attribute Projection

> **Document Purpose**: Feature reference for the G8g enhancement — `attributes`/`excludedAttributes` query parameter support on POST, PUT, and PATCH write-response bodies.
>
> **Created**: February 26, 2026
> **Version**: v0.19.1
> **RFC Reference**: RFC 7644 §3.9 (Attribute Notation), RFC 7644 §3.5.1 (PUT), RFC 7644 §3.5.2 (PATCH)

---

## Overview

RFC 7644 §3.9 specifies that clients MAY request partial resource representations on **any** SCIM operation by including `attributes` or `excludedAttributes` query parameters. Prior to this fix, only read operations (GET single, GET list, POST /.search) honored these parameters. Write operations (POST create, PUT replace, PATCH modify) returned full resource representations regardless of client preferences.

### Problem Statement

Before v0.19.1:

- `POST /Users?attributes=userName` → returned full response with all attributes
- `PUT /Users/:id?excludedAttributes=emails` → returned full response
- `PATCH /Users/:id?attributes=displayName` → returned full response

The controllers had an inline loop that only stripped `returned:'request'` attributes from write responses (the G8e fix), but did not accept or process `attributes`/`excludedAttributes` query parameters.

### Solution

Added `@Query('attributes')` and `@Query('excludedAttributes')` optional parameters to all 6 write controller methods, and replaced the inline `returned:'request'` stripping loop with a call to the existing `applyAttributeProjection()` utility function — the same function already used by GET and .search endpoints.

This ensures:
1. **Consistent behavior** across all SCIM operations (read and write)
2. **RFC 7644 §3.9 compliance** for attribute projection on write responses
3. **Code simplification** — removed 6 instances of inline stripping loops, replaced with single-line projection calls
4. **Backward compatible** — when no query params are provided, full response is returned (projection function handles this correctly, including `returned:'request'` stripping)

---

## Architecture

### Projection Flow

```
POST /Users?attributes=userName  or  PUT/PATCH /Users/:id?excludedAttributes=emails
    │
    ▼
Controller Layer (endpoint-scim-users.controller.ts / endpoint-scim-groups.controller.ts)
    │
    ├─ @Query('attributes') attributes?: string
    ├─ @Query('excludedAttributes') excludedAttributes?: string
    │
    ├─ Service call (create/replace/patch) → full resource result
    │
    └─ ★ G8g: applyAttributeProjection(result, attributes, excludedAttributes, requestOnlyAttrs)
        ├─ If attributes provided → includeOnly(result, parseAttrList(attributes))
        │   └─ Always-returned fields preserved: id, schemas, meta, userName
        ├─ Else if excludedAttributes → excludeAttrs(result, parseAttrList(excludedAttributes))
        │   └─ Always-returned fields cannot be excluded
        └─ Strip returned:'request' attributes unless explicitly requested
```

---

## Implementation Details

### Before (6 inline loops)

```typescript
// Each POST/PUT/PATCH method had this pattern:
const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
if (requestOnlyAttrs.size > 0) {
  for (const key of Object.keys(result)) {
    if (requestOnlyAttrs.has(key.toLowerCase())) delete (result as Record<string, unknown>)[key];
  }
}
return result;
```

### After (6 single-line calls)

```typescript
// G8g: Apply attribute projection on write-response (RFC 7644 §3.9)
const requestOnlyAttrs = this.usersService.getRequestOnlyAttributes(endpointId);
return applyAttributeProjection(result, attributes, excludedAttributes, requestOnlyAttrs);
```

### Methods Changed

| Controller | Method | HTTP | Route |
|-----------|--------|------|-------|
| `EndpointScimUsersController` | `createUser` | POST | `/Users` |
| `EndpointScimUsersController` | `replaceUser` | PUT | `/Users/:id` |
| `EndpointScimUsersController` | `updateUser` | PATCH | `/Users/:id` |
| `EndpointScimGroupsController` | `createGroup` | POST | `/Groups` |
| `EndpointScimGroupsController` | `replaceGroup` | PUT | `/Groups/:id` |
| `EndpointScimGroupsController` | `updateGroup` | PATCH | `/Groups/:id` |

---

## Test Coverage

### Unit Tests (23 new across 2 controller specs)

**Users Controller** (12 tests):
| # | Test | Validates |
|---|------|-----------|
| 1 | POST with `?attributes=` returns only requested | `attributes` projection on create |
| 2 | POST with `?excludedAttributes=` omits specified | `excludedAttributes` on create |
| 3 | PUT with `?attributes=` projects response | `attributes` on replace |
| 4 | PATCH with `?attributes=` projects response | `attributes` on update |
| 5 | PATCH with `?excludedAttributes=` omits specified | `excludedAttributes` on update |
| 6 | POST/PUT/PATCH without params returns full response | backward compatibility |
| 7 | PUT with `?excludedAttributes=` omits specified | `excludedAttributes` on replace |
| 8 | POST with both `attributes` AND `excludedAttributes` | attributes takes precedence |
| 9 | `returned:'request'` attr INCLUDED when in `?attributes=` | request-only explicitly requested |
| 10 | `returned:'request'` attr STRIPPED with only `?excludedAttributes=` | request-only not in include list |
| 11 | `excludedAttributes` cannot remove always-returned (id, schemas, meta) | always-returned protection |
| 12 | Dotted sub-attribute path (`name.givenName`) on POST | sub-attribute projection |

**Groups Controller** (11 tests):
| # | Test | Validates |
|---|------|-----------|
| 1 | POST with `?attributes=` returns only requested | `attributes` projection on create |
| 2 | POST with `?excludedAttributes=` omits specified | `excludedAttributes` on create |
| 3 | PUT with `?attributes=` projects response | `attributes` on replace |
| 4 | PATCH with `?attributes=` projects response | `attributes` on update |
| 5 | PATCH with `?excludedAttributes=` omits specified | `excludedAttributes` on update |
| 6 | POST/PUT/PATCH without params returns full response | backward compatibility |
| 7 | PUT with `?excludedAttributes=` omits specified | `excludedAttributes` on replace |
| 8 | POST with both `attributes` AND `excludedAttributes` | attributes takes precedence |
| 9 | `returned:'request'` attr INCLUDED when in `?attributes=` | request-only explicitly requested |
| 10 | `returned:'request'` attr STRIPPED with only `?excludedAttributes=` | request-only not in include list |
| 11 | `excludedAttributes` cannot remove always-returned (id, schemas, meta, displayName) | always-returned protection |

### E2E Tests (14 new in `attribute-projection.e2e-spec.ts`)

| # | Test | HTTP | Expected |
|---|------|------|----------|
| 1 | POST /Users?attributes=userName | POST | Only `userName` + always-returned |
| 2 | POST /Users?excludedAttributes=emails,name | POST | `emails`, `name` omitted |
| 3 | PUT /Users/:id?attributes=userName,active | PUT | Only requested + always-returned |
| 4 | PATCH /Users/:id?attributes=userName | PATCH | Only `userName` + always-returned |
| 5 | PATCH /Users/:id?excludedAttributes=emails,name | PATCH | Specified omitted |
| 6 | POST /Groups?attributes=displayName | POST | Only `displayName` + always-returned |
| 7 | PUT /Groups/:id?attributes=displayName | PUT | Only requested + always-returned |
| 8 | PATCH /Groups/:id?excludedAttributes=members | PATCH | `members` omitted |
| 9 | PATCH /Groups/:id?attributes=displayName | PATCH | Only `displayName` + always-returned |
| 10 | PUT /Users/:id?excludedAttributes=emails,name | PUT | `emails`, `name` omitted |
| 11 | POST /Groups?excludedAttributes=members | POST | `members` omitted |
| 12 | Both `attributes` + `excludedAttributes` on POST write | POST | `attributes` takes precedence |
| 13 | `excludedAttributes=id,schemas,meta` on POST write | POST | Always-returned fields survive |
| 14 | `attributes=name.givenName` on POST write | POST | Only `givenName` sub-attr in `name` |

### Live Integration Tests (33 new in section 9p)

| # | Test | Operation | Validates |
|---|------|-----------|-----------|
| 9p.1 | POST /Users?attributes=userName | POST | 5 assertions (id, userName, schemas present; displayName, emails absent) |
| 9p.2 | PUT /Users?attributes=displayName | PUT | 3 assertions |
| 9p.3 | PATCH /Users?excludedAttributes=name,emails | PATCH | 4 assertions |
| 9p.4 | POST /Groups?attributes=displayName | POST | 3 assertions |
| 9p.5 | PUT /Groups?excludedAttributes=members | PUT | 2 assertions |
| 9p.6 | PATCH /Groups?attributes=displayName | PATCH | 3 assertions |
| 9p.7 | POST /Users with BOTH params — attributes wins | POST | 4 assertions (precedence) |
| 9p.8 | POST /Users?excludedAttributes=id,schemas,meta | POST | 4 assertions (always-returned protection) |
| 9p.9 | PUT /Users?excludedAttributes=emails,name | PUT | 4 assertions |
| setup/cleanup | Create/delete test resources | POST/DELETE | 3 assertions |

---

## Files Changed

| File | Change |
|------|--------|
| `api/src/modules/scim/controllers/endpoint-scim-users.controller.ts` | Added `attributes`/`excludedAttributes` query params to POST/PUT/PATCH; replaced inline loops with `applyAttributeProjection()` |
| `api/src/modules/scim/controllers/endpoint-scim-groups.controller.ts` | Same changes for Groups controller |
| `api/src/modules/scim/controllers/endpoint-scim-users.controller.spec.ts` | +12 G8g unit tests |
| `api/src/modules/scim/controllers/endpoint-scim-groups.controller.spec.ts` | +11 G8g unit tests |
| `api/test/e2e/attribute-projection.e2e-spec.ts` | +14 E2E tests for write-response projection |
| `scripts/live-test.ps1` | +Section 9p with 33 assertions |
| `docs/G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md` | This document |

---

## Related Documentation

- [Attribute Projection E2E tests](../api/test/e2e/attribute-projection.e2e-spec.ts) — Full E2E coverage
- [scim-attribute-projection.ts](../api/src/modules/scim/common/scim-attribute-projection.ts) — Core projection implementation
- [G8E_RETURNED_CHARACTERISTIC_FILTERING.md](G8E_RETURNED_CHARACTERISTIC_FILTERING.md) — Related `returned` characteristic enforcement
- [RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md](RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md) — Full attribute characteristics gap analysis
