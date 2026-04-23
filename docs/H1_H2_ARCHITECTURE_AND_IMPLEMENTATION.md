# H-1 & H-2: Architecture Analysis, Deliberation & Implementation

> **Date:** 2026-02-24 | **Version:** v0.17.0 (implemented)  
> **Scope:** PATCH SchemaValidator integration (H-1) and Immutable attribute enforcement (H-2)  
> **Status:** ✅ IMPLEMENTED

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Analysis](#architecture-analysis)
3. [Design Deliberation](#design-deliberation)
4. [Implementation Plan](#implementation-plan)
5. [H-1: PATCH SchemaValidator Integration](#h-1-patch-schemavalidator-integration)
6. [H-2: Immutable Attribute Enforcement](#h-2-immutable-attribute-enforcement)
7. [Impact Assessment](#impact-assessment)

---

## Problem Statement

### H-1: PATCH Operations Bypass SchemaValidator

**RFC Reference:** RFC 7644 §3.5.2, RFC 7643 §2.1

The `SchemaValidator` (~950 lines, pure domain class) validates payloads on POST (`create`) and PUT (`replace`) operations when `StrictSchemaValidation=true`. However, PATCH operations completely bypass schema validation. After `UserPatchEngine.apply()` or `GroupPatchEngine.apply()` produce the modified resource state, it is saved directly to the DB without any schema validation of the resulting payload.

**Current flow (PATCH):**
```
Request → PatchEngine.apply() → DB save → Response
                                  ↑
                        No SchemaValidator.validate()
```

**Risk:** A PATCH could produce a structurally invalid resource (e.g., setting a boolean attribute to a string via `op:replace, path:active, value:"yes"`) with the result persisted without validation.

### H-2: Immutable Attributes Not Enforced

**RFC Reference:** RFC 7643 §2.2

The `SchemaValidator.validateAttribute()` method (line 202) only checks for `readOnly` mutability:

```typescript
if (attrDef.mutability === 'readOnly' && (options.mode === 'create' || options.mode === 'replace')) {
```

`immutable` attributes - which MAY be set on creation but MUST NOT be changed thereafter - are not enforced. On PUT/PATCH, a client could change an immutable attribute's value without error.

**Current schema attributes with `mutability: 'immutable'`:**
- `Group.members.value` - the member user ID
- `Group.members.display` - the member display name
- `Group.members.type` - the member type (e.g., "User")

These are sub-attributes of the multi-valued `members` complex attribute. In practice, group member replacement works via add/remove operations, not by modifying individual member sub-attributes, so the current gap has **low live impact**. However, any custom extension schemas with `immutable` top-level attributes would be silently modifiable.

---

## Architecture Analysis

### Key Question: How to Compare Old vs New Values for Immutable Enforcement?

Immutable enforcement requires comparing the **existing** resource state with the **incoming** payload. For POST (`create`), immutable attributes are freely settable. For PUT (`replace`) and PATCH, any immutable attribute that was previously set MUST NOT change.

**Existing Machinery:**

1. **`toScimUserResource()`** (endpoint-scim-users.service.ts L475-505): Already reconstructs a full SCIM-shaped object from a DB record by merging `rawPayload` + first-class columns (`userName`, `displayName`, `externalId`, `active`) + `schemas[]` + `meta`.

2. **`toScimGroupResource()`** (endpoint-scim-groups.service.ts L547-590): Same pattern for groups - merges `rawPayload` + first-class columns + members + `schemas[]` + `meta`.

3. **PUT flow** (endpoint-scim-users.service.ts L182-230): Already fetches the existing DB record (`user = repo.findByScimId()`) before applying the update. The record is available but NOT reconstructed as a SCIM object for comparison.

4. **PATCH flow** (endpoint-scim-users.service.ts L422-470): Also fetches the existing record. The `rawPayload` is parsed and fed into `PatchEngine.apply()`. The existing values are available.

**Conclusion:** Both PUT and PATCH flows already have the existing DB record in scope. We can reconstruct it as a SCIM payload object (reusing `toScimUserResource`-like logic) for comparison, then validate the incoming/resulting payload against it.

### Resource Reconstruction Approach

Rather than introducing a new data-fetch round-trip, we propose extracting a **data-only payload builder** that:
- Takes a DB record
- Returns a flat SCIM-shaped object (no `meta`, no `location` - just attribute data)
- Can be compared field-by-field against the incoming payload

This is essentially `toScimUserResource()` minus the `meta` block and `id` override. We'll add a `toScimPayload()` helper for this purpose.

---

## Design Deliberation

### Approach Options Considered

| # | Approach | Pros | Cons | Verdict |
|---|----------|------|------|---------|
| 1 | **Post-operation validation** - validate the *result* of PatchEngine against schemas | Clean separation; PatchEngine stays pure; catches all invalid states | Requires reconstructing full SCIM object from PatchEngine result | ✅ Selected for H-1 |
| 2 | **Pre-operation path validation** - resolve each PATCH path to its schema attribute and validate before applying | More granular error messages; can reject before any state change | Very complex (path→attrDef resolution for all path formats); breaks PatchEngine purity | ❌ Too complex |
| 3 | **SchemaValidator.checkImmutable(existing, incoming, schemas)** - new pure domain method | Clean; reusable across PUT and PATCH; no PatchEngine changes | Needs existing resource as SCIM payload | ✅ Selected for H-2 |
| 4 | **Inline immutability check in services** - ad-hoc comparison in each service method | Simple; no new API | Code duplication; not testable in isolation; maintenance debt | ❌ Rejected |

### Selected Design

**H-1:** Call `SchemaValidator.validate()` on the **result** of PatchEngine with `mode: 'patch'`. This validates the resulting resource payload (type correctness, multiValued, readOnly, unknown attributes) without needing path-to-attrDef resolution.

**H-2:** Add `SchemaValidator.checkImmutable(existing, incoming, schemas)` as a new static method. This compares two SCIM payloads attribute-by-attribute, checking that any attribute where `mutability === 'immutable'` and `existing[attr] !== undefined/null` has not changed.

**Combined flow:**
```
PUT:  validate(incoming, schemas, 'replace') → checkImmutable(existing, incoming) → save
PATCH: PatchEngine.apply() → validate(result, schemas, 'patch') → checkImmutable(existing, result) → save
```

### Performance Considerations

- **No extra DB round-trip**: Both flows already fetch the existing record before modification.
- **Payload reconstruction** from DB record: Already available via `toScimUserResource` machinery. The additional cost is negligible (in-memory object construction, no I/O).
- **SchemaValidator.validate()** on PATCH result: O(n) where n = number of attributes. Typically < 50 attributes. Negligible.
- **SchemaValidator.checkImmutable()**: O(n) comparison of attribute values. Negligible.

### Strict-Mode Gating (H-3 Context)

Both H-1 and H-2 validations are gated behind `StrictSchemaValidation=true`, consistent with the existing design pattern. When the flag is off (default for Entra ID compatibility), no additional validation occurs. This is an intentional trade-off: Entra ID sends payloads that may contain extra attributes or non-standard structures, and strict validation would break provisioning flows.

---

## Implementation Plan

### Files Modified

| File | Change | H-1 | H-2 |
|------|--------|-----|-----|
| `schema-validator.ts` | Add `checkImmutable()` static method | | ✅ |
| `validation-types.ts` | No changes needed (types already support immutable) | | |
| `endpoint-scim-users.service.ts` | Call `validate()` on PATCH result; call `checkImmutable()` on PUT+PATCH | ✅ | ✅ |
| `endpoint-scim-groups.service.ts` | Call `validate()` on PATCH result; call `checkImmutable()` on PUT+PATCH | ✅ | ✅ |
| `schema-validator.spec.ts` | Add `checkImmutable()` unit tests | | ✅ |
| `schema-validator-comprehensive.spec.ts` | Add immutable enforcement tests | | ✅ |
| `endpoint-scim-users.service.spec.ts` (existing) | Add PATCH validation integration tests | ✅ | ✅ |
| `endpoint-scim-groups.service.spec.ts` (existing) | Add PATCH validation integration tests | ✅ | ✅ |
| `ATTRIBUTE_CHARACTERISTICS_GAPS.md` | Update H-1/H-2 status to ✅ DONE | | |

### Implementation Order

1. `SchemaValidator.checkImmutable()` - pure domain method (H-2)
2. Unit tests for `checkImmutable()` (H-2)
3. Private `buildExistingPayload()` helper in both services (shared infra for H-1 + H-2)
4. PATCH validation call in user service (H-1)
5. PATCH validation call in group service (H-1)
6. `checkImmutable()` calls in PUT + PATCH for both services (H-2)
7. Service-level integration tests (H-1 + H-2)
8. Full test suite run

---

## H-1: PATCH SchemaValidator Integration

### Design

After `PatchEngine.apply()` returns the modified payload, reconstruct the full SCIM resource payload (including first-class fields like `userName`, `displayName`) and pass it through `SchemaValidator.validate()` with `mode: 'patch'`.

```typescript
// In patchUserForEndpoint(), after PatchEngine.apply():
const resultPayload = {
  schemas: [SCIM_CORE_USER_SCHEMA],
  userName: extractedFields.userName ?? user.userName,
  displayName: extractedFields.displayName,
  active: extractedFields.active,
  ...payload, // rawPayload from PatchEngine
};
this.validatePayloadSchema(resultPayload, endpointId, config, 'patch');
```

### Behavior

| `StrictSchemaValidation` | PATCH result valid | PATCH result invalid |
|:---:|:---:|:---:|
| `false` (default) | ✅ Saved | ✅ Saved (no validation) |
| `true` | ✅ Saved | ❌ 400 Bad Request with validation errors |

### Key Notes

- `mode: 'patch'` skips required-attribute checks (RFC 7644 §3.5.2: PATCH doesn't need to supply all required attributes)
- `readOnly` check still runs - catches cases where PatchEngine somehow sets a readOnly attribute
- Type validation catches type mismatches introduced by PATCH (e.g., string where boolean expected)
- Extension URN attributes validated against registered schemas

---

## H-2: Immutable Attribute Enforcement

### Design

`SchemaValidator.checkImmutable()` - a new pure static method:

```typescript
static checkImmutable(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  schemas: readonly SchemaDefinition[],
): ValidationResult
```

**Algorithm:**
1. Build attribute definitions map from schemas (core + extensions)
2. For each attribute with `mutability === 'immutable'`:
   a. If the attribute is not set in `existing` (null/undefined) → allow (first write)
   b. If the attribute is set in `existing` and differs in `incoming` → error
   c. Recurse into sub-attributes for complex types
   d. For multi-valued arrays, compare by deep equality
3. Return `ValidationResult` with any immutability violations

### Current Immutable Attributes

| Schema | Attribute | Type | Impact |
|--------|-----------|------|--------|
| Group Core | `members.value` | string (sub-attr) | Member ID within a member entry |
| Group Core | `members.display` | string (sub-attr) | Member display name within entry |
| Group Core | `members.type` | string (sub-attr) | Member type within entry |

Since these are sub-attributes of `members` (multi-valued complex), immutability enforcement applies when an individual member entry's `value`/`display`/`type` changes. In practice, SCIM clients add/remove entire member entries rather than modifying sub-attributes, so this enforcement primarily guards against mis-implementations.

### Extension Considerations

Custom extension schemas registered via admin API may define top-level `immutable` attributes. The generic `checkImmutable()` method handles these uniformly - it iterates all schema attribute definitions regardless of whether they're core or extension.

---

## Impact Assessment

| Dimension | H-1 Impact | H-2 Impact |
|-----------|------------|------------|
| **Breaking changes** | None (gated behind `StrictSchemaValidation`) | None (gated behind `StrictSchemaValidation`) |
| **Performance** | Negligible (O(n) validation) | Negligible (O(n) comparison) |
| **Entra ID compatibility** | ✅ No impact (flag off by default) | ✅ No impact (flag off by default) |
| **RFC compliance** | ✅ Completes RFC 7644 §3.5.2 validation gap | ✅ Completes RFC 7643 §2.2 immutable enforcement |
| **Test count impact** | +10-15 tests | +15-20 tests |
| **Files changed** | 2 services | 1 domain class + 2 services |
