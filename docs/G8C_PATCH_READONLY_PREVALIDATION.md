# G8c — PATCH readOnly Pre-Validation

> **Document Purpose**: Feature reference for the G8c gap closure — readOnly mutability enforcement during PATCH operations.
>
> **Created**: February 25, 2026
> **Version**: v0.17.3
> **RFC Reference**: RFC 7643 §2.2 (Mutability), RFC 7644 §3.5.2 (Modifying with PATCH)

---

## Overview

**Gap G8c** in the [MIGRATION_PLAN_CURRENT_TO_IDEAL_v3](MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md) identified that PATCH operations did not enforce `mutability: 'readOnly'` constraints. Attributes declared as `readOnly` in the SCIM schema (e.g., `groups`, `meta`) could be silently modified via PATCH add/replace/remove operations — a direct RFC compliance violation.

### Problem Statement

Before v0.17.3, the `SchemaValidator.validatePatchOperationValue()` method performed type-checking and unknown-attribute detection on PATCH values but **explicitly skipped mutability checks**. The `mode: 'patch'` flag in `validatePayloadSchema()` also bypassed readOnly checks in post-PATCH validation. This meant:

- `PATCH replace groups` → silently accepted (should be 400)
- `PATCH add {"groups": [...]}` → silently accepted (should be 400)
- `PATCH remove groups` → silently accepted (should be 400)
- `PATCH replace groups[value eq "x"].display` → silently accepted (should be 400 — parent `groups` is readOnly)

### Solution

Added readOnly mutability pre-validation directly in `validatePatchOperationValue()`, which runs inside the `if (StrictSchemaValidation)` guard in both `endpoint-scim-users.service.ts` and `endpoint-scim-groups.service.ts`. This ensures:

1. **Entra compatibility**: When `StrictSchemaValidation` is `false` (default), readOnly checks are skipped — matching Azure AD / Microsoft Entra behavior.
2. **RFC compliance**: When `StrictSchemaValidation` is `true`, all PATCH operations targeting readOnly attributes are rejected with HTTP 400.
3. **Zero PatchEngine changes**: The fix lives in the validation layer, not the patch engine — maintaining clean separation of concerns.

---

## Architecture

### Validation Flow

```
PATCH Request
    │
    ▼
Service Layer (endpoint-scim-users.service.ts / endpoint-scim-groups.service.ts)
    │
    ├─ if (!StrictSchemaValidation) → skip validation → proceed to PatchEngine
    │
    └─ if (StrictSchemaValidation) → SchemaValidator.validatePatchOperationValue()
        │
        ├─ Path-based operation (op has path)?
        │   ├─ Resolve attribute definition from path
        │   ├─ ★ G8c: Check attrDef.mutability === 'readOnly' → REJECT 400
        │   ├─ ★ G8c: resolveRootAttribute() → check parent readOnly → REJECT 400
        │   └─ Continue with type/value validation
        │
        └─ No-path operation (op has no path)?
            ├─ For each key in value object:
            │   ├─ ★ G8c: Check attrDef.mutability === 'readOnly' → REJECT 400
            │   └─ Continue with type validation
            └─ For each extension URN block:
                └─ For each key in extension object:
                    ├─ ★ G8c: Check extAttrDef.mutability === 'readOnly' → REJECT 400
                    └─ Continue with type validation
```

### Key Components

| Component | File | Role |
|-----------|------|------|
| `SchemaValidator.validatePatchOperationValue()` | `api/src/domain/validation/schema-validator.ts` | Main readOnly enforcement logic |
| `SchemaValidator.resolveRootAttribute()` | `api/src/domain/validation/schema-validator.ts` | Resolves first path segment to check parent readOnly status |
| `USER_SCHEMA_ATTRIBUTES` | `api/src/modules/scim/discovery/scim-schemas.constants.ts` | Added `groups` attribute with `mutability: 'readOnly'` (RFC 7643 §4.1) |
| `endpoint-scim-users.service.ts` | `api/src/modules/scim/services/` | Caller (inside `StrictSchemaValidation` guard) |
| `endpoint-scim-groups.service.ts` | `api/src/modules/scim/services/` | Caller (inside `StrictSchemaValidation` guard) |

---

## RFC Compliance

### RFC 7643 §2.2 — Mutability

> **readOnly**: The attribute SHALL NOT be modified.

The SCIM standard explicitly states that `readOnly` attributes cannot be modified by any operation. This includes PATCH `add`, `replace`, and `remove` operations.

### RFC 7643 §4.1 — User Schema

The `groups` attribute is defined as:

> **groups** — A list of groups to which the user belongs [...]. This attribute has a mutability of **"readOnly"**.

### RFC 7644 §3.5.2 — Modifying with PATCH

> If the target attribute of a PATCH operation is readOnly, the service provider SHOULD return a 400 error.

---

## Implementation Details

### 1. Path-Based Operations (add/replace/remove with `path`)

When a PATCH operation includes a path (e.g., `path: "groups"` or `path: "groups[value eq \"abc\"].display"`):

1. **Direct attribute check**: If `resolvePatchPath()` returns an attribute definition and `attrDef.mutability === 'readOnly'`, reject immediately.
2. **Root attribute check**: `resolveRootAttribute()` extracts the first segment of the path (e.g., `groups` from `groups[value eq "x"].display`) and checks if that root attribute is readOnly. This handles cases where a sub-attribute itself may not be readOnly, but its parent is.

### 2. No-Path Operations (add/replace with value object)

When a PATCH operation has no path and provides a value object:

1. **Core attribute keys**: Each key in the value object is matched against core schema attributes. If the matching attribute is readOnly, reject.
2. **Extension URN blocks**: If a key matches a registered extension URN (e.g., `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`), each sub-key in the extension block is checked against the extension's attribute definitions.

### 3. Remove Operations

For `remove` operations targeting readOnly attributes, the same rejection applies with a contextual message: `"cannot be removed via PATCH"` instead of `"cannot be modified via PATCH"`.

### 4. Case-Insensitive Matching

All attribute name comparisons use case-insensitive matching (`.toLowerCase()`) per RFC 7643 §2.1:

> Attribute names [...] are case insensitive.

---

## Error Response Format

When a PATCH operation targets a readOnly attribute in strict mode, the server returns:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "400",
  "detail": "PATCH operation value validation failed: Attribute 'groups' is readOnly and cannot be modified via PATCH."
}
```

For `remove` operations:
```json
{
  "detail": "PATCH operation value validation failed: Attribute 'groups' is readOnly and cannot be removed via PATCH."
}
```

---

## Schema Constants Update

Added `groups` attribute to `USER_SCHEMA_ATTRIBUTES` in `scim-schemas.constants.ts` per RFC 7643 §4.1:

```typescript
{
  name: 'groups',
  type: 'complex',
  multiValued: true,
  required: false,
  mutability: 'readOnly',
  returned: 'default',
  description: 'A list of groups to which the user belongs...',
  subAttributes: [
    { name: 'value',   type: 'string',    mutability: 'readOnly' },
    { name: '$ref',    type: 'reference',  mutability: 'readOnly' },
    { name: 'display', type: 'string',     mutability: 'readOnly' },
    { name: 'type',    type: 'string',     mutability: 'readOnly',
      canonicalValues: ['direct', 'indirect'] },
  ],
}
```

This was previously missing entirely from the schema constants, meaning `/Schemas` endpoint did not expose `groups` in the User schema — also an RFC compliance gap now resolved.

---

## Configuration

### Controlled by `StrictSchemaValidation` Flag

| Flag Value | Behavior |
|------------|----------|
| `true` | readOnly mutability enforced on PATCH — 400 returned |
| `false` (default) | readOnly checks skipped — Entra-compatible |

Set via endpoint config:
```http
PUT /scim/admin/endpoints/:id/config
Authorization: Bearer <token>
Content-Type: application/json

{
  "StrictSchemaValidation": "True"
}
```

---

## Test Coverage

### Unit Tests (25 new tests)

File: `api/src/domain/validation/schema-validator-v2-v10-v25-v31.spec.ts`

| Describe Block | Tests | Coverage |
|----------------|-------|----------|
| Path-based ops | 5 | replace/add/remove on readOnly, sub-attribute via dot path, extension URN path |
| No-path ops | 4 | Object key on readOnly, case-insensitive matching, readWrite is allowed, extension attribute |
| Value-filter paths | 3 | `groups[value eq "x"].display` → root is readOnly, `emails[type eq "work"].value` → root is readWrite ∴ allowed, `groups` direct path |
| Remove operations | 2 | Remove on readOnly rejected, remove on readWrite allowed |
| Reserved keys & edge cases | 2 | `schemas` key skipped (reserved), multiple ops with mixed readOnly/readWrite |

### E2E Tests (7 new tests)

File: `api/test/e2e/schema-validation.e2e-spec.ts` (§15)

| Test | Assertion |
|------|-----------|
| PATCH replace `groups` → 400 | readOnly rejection in strict mode |
| PATCH add `groups` → 400 | readOnly rejection in strict mode |
| PATCH remove `groups` → 400 | readOnly rejection in strict mode |
| PATCH no-path with `groups` key → 400 | No-path readOnly rejection |
| PATCH replace `displayName` → 200 | readWrite attribute allowed in strict mode |
| PATCH add `groups` in lenient mode → 200 | StrictSchemaValidation=false allows it |
| PATCH replace `groups` in lenient mode → 200 | StrictSchemaValidation=false allows it |

### Test Counts After G8c

| Category | Count | Suites |
|----------|-------|--------|
| Unit | 2,116 | 61 |
| E2E | 374 | 19 |
| **Total** | **2,490** | **80** |

---

## Files Changed

| File | Change |
|------|--------|
| `api/src/domain/validation/schema-validator.ts` | Added readOnly checks in `validatePatchOperationValue()`, added `resolveRootAttribute()` helper |
| `api/src/modules/scim/discovery/scim-schemas.constants.ts` | Added `groups` attribute to `USER_SCHEMA_ATTRIBUTES` (RFC 7643 §4.1) |
| `api/src/domain/validation/schema-validator-v2-v10-v25-v31.spec.ts` | Added 25 G8c unit tests |
| `api/test/e2e/schema-validation.e2e-spec.ts` | Added §15 G8c E2E tests (7 tests) |
| `api/package.json` | Version bump 0.17.2 → 0.17.3 |

---

## Migration Plan Impact

- **Gap G8c**: ✅ CLOSED — PatchEngine readOnly pre-validation is now enforced via `SchemaValidator.validatePatchOperationValue()`
- **Heat Map**: `schema-validator.ts` moves to GREEN (all G8c validations implemented)
- **Remaining gaps**: G8e (response `returned` filter), G8b (custom resource type registration), G2/G17 (unified resource table), G9-G12 (advanced features)
