# Phase 7 - ETag & Conditional Requests

**Date:** 2026-02-24  
**Version:** 0.16.0  
**Gaps Resolved:** G7 (If-Match NOT enforced - HIGH), G13 (ETag uses timestamp - MEDIUM)

## Overview

Phase 7 replaces the timestamp-based ETag system with a version-based, monotonic ETag scheme and adds pre-write If-Match enforcement at the service layer. A new `RequireIfMatch` config flag enables per-endpoint opt-in to strict concurrency control (428 on missing header).

## Architecture Changes

### Before (Pre-Phase 7)

```
ETag format:     W/"2024-01-01T00:00:00.000Z"  (timestamp, collision-prone)
If-Match check:  Post-write in interceptor (BROKEN - modifies THEN checks)
Version column:  Existed in schema.prisma but never read or incremented
Config flags:    No RequireIfMatch
```

### After (Phase 7)

```
ETag format:     W/"v1", W/"v2", W/"v3", ...   (monotonic integer, deterministic)
If-Match check:  Pre-write in service enforceIfMatch() (correct - checks THEN modifies)
Version column:  Mapped in domain models, atomically incremented on every update
Config flags:    RequireIfMatch (default: false)
```

## Files Modified (19)

### Production Code (14)

| File | Change |
|------|--------|
| `user.model.ts` | Added `version: number` to `UserRecord` |
| `group.model.ts` | Added `version: number` to `GroupRecord` |
| `prisma-user.repository.ts` | `toUserRecord()` maps version; `update()` uses `version: { increment: 1 }` |
| `prisma-group.repository.ts` | Same; plus `updateGroupWithMembers()` transaction includes version increment |
| `inmemory-user.repository.ts` | `create()` sets `version: 1`; `update()` increments |
| `inmemory-group.repository.ts` | Same pattern |
| `endpoint-scim-users.service.ts` | `enforceIfMatch()` + ifMatch param on PATCH/PUT/DELETE + ETag `W/"v{N}"` |
| `endpoint-scim-groups.service.ts` | Same pattern |
| `endpoint-scim-users.controller.ts` | Extracts `If-Match` header, passes to service |
| `endpoint-scim-groups.controller.ts` | Same |
| `scim-etag.interceptor.ts` | Simplified to read-side only (ETag header + If-None-Match→304) |
| `endpoint-config.interface.ts` | Added `REQUIRE_IF_MATCH` constant, interface field, default, validation |

### Test Code (7)

| File | Change |
|------|--------|
| `prisma-user.repository.spec.ts` | Updated 2 assertions (version in model, version increment in update) |
| `prisma-group.repository.spec.ts` | Updated 3 assertions (same pattern) |
| `endpoint-scim-users.controller.spec.ts` | Updated 3 assertions (ifMatch param) |
| `endpoint-scim-groups.controller.spec.ts` | Updated 3 assertions (same) |
| `endpoint-scim-users.service.spec.ts` | Added `version: 1` to mockUser + 13 new Phase 7 tests |
| `endpoint-scim-groups.service.spec.ts` | Added `version: 1` to mockGroup + 11 new Phase 7 tests |
| `etag-conditional.e2e-spec.ts` | 17 new E2E tests (version format, If-Match, RequireIfMatch) |

## Key Implementation Details

### enforceIfMatch() (both services)

```typescript
private enforceIfMatch(currentVersion: number, ifMatch?: string, config?: EndpointConfig): void {
  const requireIfMatch = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH);
  if (!ifMatch) {
    if (requireIfMatch) throw createScimError({ status: 428, detail: '...' });
    return; // not required, allow
  }
  const currentETag = `W/"v${currentVersion}"`;
  assertIfMatch(currentETag, ifMatch); // 412 on mismatch
}
```

### Atomic Version Increment (Prisma)

```typescript
// prisma-user.repository.ts / prisma-group.repository.ts
prismaData.version = { increment: 1 };  // Atomic DB-level increment
```

### ETag Format in buildMeta()

```typescript
version: `W/"v${user.version}"`,  // Was: W/"${updatedAt.toISOString()}"
```

## Test Coverage

| Category | Tests | Status |
|----------|-------|--------|
| Unit: PATCH If-Match match → success | 2 | ✅ |
| Unit: PATCH If-Match mismatch → 412 | 2 | ✅ |
| Unit: PATCH RequireIfMatch=true → 428 | 2 | ✅ |
| Unit: PATCH RequireIfMatch=false → success | 1 | ✅ |
| Unit: PATCH wildcard → success | 2 | ✅ |
| Unit: PUT If-Match match/mismatch/428 | 6 | ✅ |
| Unit: DELETE If-Match match/mismatch/428 | 6 | ✅ |
| Unit: ETag format W/"v{N}" | 3 | ✅ |
| E2E: Version-based format validation | 5 | ✅ |
| E2E: If-Match enforcement (412) | 7 | ✅ |
| E2E: RequireIfMatch config (428) | 5 | ✅ |
| **Total new tests** | **41** | **✅** |

## Concurrency Protection Flow

```
Client A: GET /Users/123 → ETag: W/"v1"
Client A: PATCH /Users/123 (If-Match: W/"v1") → 200 OK, ETag: W/"v2"
Client B: PATCH /Users/123 (If-Match: W/"v1") → 412 Precondition Failed (stale!)
Client B: GET /Users/123 → ETag: W/"v2" (re-read)
Client B: PATCH /Users/123 (If-Match: W/"v2") → 200 OK, ETag: W/"v3"
```

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking change for clients caching timestamp ETags | ETags should be opaque per RFC; clients should not parse |
| RequireIfMatch=true breaks lazy clients | Default is `false`; opt-in per endpoint |
| Version overflow | Int64 range; would need billions of updates per resource |
