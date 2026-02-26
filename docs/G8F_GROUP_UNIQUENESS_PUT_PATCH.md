# G8f — Group Uniqueness Enforcement on PUT/PATCH

> **Document Purpose**: Feature reference for the G8f gap closure — `displayName` and `externalId` uniqueness enforcement on Group PUT and PATCH operations.
>
> **Created**: February 26, 2026
> **Version**: v0.19.1
> **RFC Reference**: RFC 7644 §3.5.1 (Replacing with PUT), RFC 7644 §3.5.2 (Modifying with PATCH), RFC 7643 §2.4 (uniqueness)

---

## Overview

**Gap G8f** in the [MIGRATION_PLAN_CURRENT_TO_IDEAL_v3](MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md) identified a data integrity bug: the `assertUniqueDisplayName()` and `assertUniqueExternalId()` methods existed in `EndpointScimGroupsService` but were only called during POST (create) operations. PUT (replace) and PATCH (modify) operations bypassed uniqueness validation entirely, allowing clients to silently create duplicate `displayName` or `externalId` values within the same endpoint.

### Problem Statement

Before v0.19.1, the Groups service had these uniqueness helper methods defined:

```typescript
private async assertUniqueDisplayName(displayName, endpointId, excludeScimId?)
private async assertUniqueExternalId(externalId, endpointId, excludeScimId?)
```

Both methods accept an optional `excludeScimId` parameter specifically designed for PUT/PATCH self-exclusion. However, neither was called from:

- `replaceGroupForEndpoint()` (PUT) — could replace a group's `displayName` / `externalId` with values already used by another group
- `patchGroupForEndpoint()` (PATCH) — same issue via PATCH `replace` or `add` operations

This created a **genuine data integrity bug** where:

1. `PUT /Groups/:idB` with `{ displayName: "Same As Group A" }` → **200** (should be **409**)
2. `PATCH /Groups/:idB` with `replace displayName "Same As Group A"` → **200** (should be **409**)
3. Duplicate groups could accumulate, causing undefined behavior in SCIM provisioning

### Solution

Added `assertUniqueDisplayName()` and `assertUniqueExternalId()` calls to both PUT and PATCH code paths, passing the target resource's `scimId` as `excludeScimId` to prevent false self-conflicts:

1. **PUT path** (`replaceGroupForEndpoint`): After `checkImmutableAttributes`, before the database update
2. **PATCH path** (`patchGroupForEndpoint`): After `checkImmutableAttributes`, before member resolution

Both paths now produce **HTTP 409 Conflict** with `scimType: 'uniqueness'` when a collision is detected.

---

## Architecture

### Uniqueness Check Flow

```
PUT /Groups/:id  or  PATCH /Groups/:id
    │
    ▼
Service Layer (endpoint-scim-groups.service.ts)
    │
    ├─ Find existing group (findWithMembers)
    ├─ Guard soft-deleted
    ├─ Enforce If-Match
    ├─ Check immutable attributes
    │
    ├─ ★ G8f: assertUniqueDisplayName(newDisplayName, endpointId, scimId)
    │   ├─ groupRepo.findByDisplayName(endpointId, name, excludeScimId)
    │   ├─ If conflict found (different scimId) → throw 409 uniqueness
    │   └─ If no conflict → continue
    │
    ├─ ★ G8f: assertUniqueExternalId(newExternalId, endpointId, scimId)
    │   ├─ Only called when externalId is non-null
    │   ├─ groupRepo.findByExternalId(endpointId, extId, excludeScimId)
    │   ├─ If conflict found (different scimId) → throw 409 uniqueness
    │   └─ If no conflict → continue
    │
    └─ Proceed to database update / member resolution
```

### Self-Exclusion Pattern

The `excludeScimId` parameter is critical for avoiding false conflicts when a resource keeps its own `displayName` or `externalId` unchanged during a PUT/PATCH:

```
Group A: { scimId: "abc", displayName: "Engineering" }

PUT /Groups/abc { displayName: "Engineering" }
    → assertUniqueDisplayName("Engineering", endpointId, "abc")
    → findByDisplayName returns Group A (scimId="abc")
    → excludeScimId="abc" matches → NOT a conflict
    → 200 OK ✓
```

---

## Implementation Details

### PATCH Path (lines ~335-343)

```typescript
// G8f: Uniqueness enforcement on PATCH — displayName and externalId must remain unique
await this.assertUniqueDisplayName(displayName, endpointId, scimId);
if (externalId) {
  await this.assertUniqueExternalId(externalId, endpointId, scimId);
}
```

Positioned after `checkImmutableAttributes()` and post-PATCH `validatePayloadSchema()`, before member resolution. The `displayName` and `externalId` values come from the resolved post-PATCH state.

### PUT Path (lines ~410-418)

```typescript
// G8f: Uniqueness enforcement on PUT — displayName and externalId must remain unique
await this.assertUniqueDisplayName(dto.displayName, endpointId, scimId);
const newExternalId = typeof (dto as Record<string, unknown>).externalId === 'string'
  ? (dto as Record<string, unknown>).externalId as string
  : null;
if (newExternalId) {
  await this.assertUniqueExternalId(newExternalId, endpointId, scimId);
}
```

Positioned after `checkImmutableAttributes()`, before the database update. The `externalId` is extracted from the DTO with type narrowing since the `CreateGroupDto` type may not declare it directly.

### Error Response Format

Both methods return a standard SCIM error:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "A group with displayName 'Engineering' already exists."
}
```

---

## Test Coverage

### Unit Tests (10 new, in `endpoint-scim-groups.service.spec.ts`)

| # | Test | Validates |
|---|------|-----------|
| 1 | PUT: 409 on displayName conflict | `findByDisplayName` returns conflict → 409 |
| 2 | PUT: 409 on externalId conflict | `findByExternalId` returns conflict → 409 |
| 3 | PUT: self-update success (self-exclusion) | `findByDisplayName` returns self → no error |
| 4 | PUT: excludeScimId verification | `findByDisplayName` called with correct `excludeScimId` |
| 5 | PUT: no externalId check when null | `findByExternalId` NOT called when externalId absent |
| 6 | PATCH: 409 on displayName conflict | Same pattern for PATCH path |
| 7 | PATCH: 409 on externalId conflict | Same pattern for PATCH path |
| 8 | PATCH: self-update success | Self-exclusion works on PATCH |
| 9 | PATCH: excludeScimId verification | Correct parameter passed |
| 10 | PATCH: no externalId check when null | Skipped when not present |

### E2E Tests (6 new, in `group-lifecycle.e2e-spec.ts`)

| # | Test | HTTP Method | Expected |
|---|------|-------------|----------|
| 1 | PUT with conflicting displayName | PUT | 409 |
| 2 | PUT self-update with same name | PUT | 200 |
| 3 | PUT with conflicting externalId | PUT | 409 |
| 4 | PATCH with conflicting displayName | PATCH | 409 |
| 5 | PATCH with unique displayName | PATCH | 200 |
| 6 | PATCH with conflicting externalId | PATCH | 409 |

### Live Integration Tests (8 new, in `scripts/live-test.ps1` section 9o)

| # | Test | Operation | Expected |
|---|------|-----------|----------|
| 9o.1 | PUT GroupB with GroupA's displayName | PUT | 409 |
| 9o.2 | PUT GroupA keeping own displayName | PUT | 200 |
| 9o.3 | PUT GroupB with GroupA's externalId | PUT | 409 |
| 9o.4 | PATCH GroupB with GroupA's displayName | PATCH | 409 |
| 9o.5 | PATCH GroupB with unique displayName | PATCH | 200 |
| 9o.6 | PATCH GroupB with GroupA's externalId | PATCH | 409 |
| setup | Create GroupA + GroupB | POST | 201 × 2 |
| cleanup | Delete GroupA + GroupB | DELETE | 204 × 2 |

### Test Totals Impact

| Level | Before | After | Delta |
|-------|--------|-------|-------|
| Unit | 2,320 | 2,330 | +10 |
| E2E | 435 | 441 | +6 |
| Live | 401 | 411 | +10 |

---

## Files Changed

| File | Change |
|------|--------|
| `api/src/modules/scim/services/endpoint-scim-groups.service.ts` | Added uniqueness calls in `patchGroupForEndpoint` + `replaceGroupForEndpoint` |
| `api/src/modules/scim/services/endpoint-scim-groups.service.spec.ts` | +10 unit tests, mock defaults for `findByDisplayName`/`findByExternalId` |
| `api/test/e2e/group-lifecycle.e2e-spec.ts` | +6 E2E tests for PUT/PATCH uniqueness |
| `scripts/live-test.ps1` | +Section 9o with 10 assertions (6 tests + 2 setup + 2 cleanup) |
| `docs/G8F_GROUP_UNIQUENESS_PUT_PATCH.md` | This document |

---

## Related Documentation

- [RFC Attribute Characteristics Analysis](RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md) — Gap G8f definition
- [MIGRATION_PLAN_CURRENT_TO_IDEAL_v3](MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md) — Phase 8 gap table
- [COLLISION-TESTING-GUIDE](COLLISION-TESTING-GUIDE.md) — Entra collision (409) testing patterns
- [ISSUES_BUGS_ROOT_CAUSE_ANALYSIS](ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md) — Prior collision-related issues
