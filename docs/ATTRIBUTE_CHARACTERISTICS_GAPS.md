# Attribute Characteristics Gaps, Bugs & Issues

> **Date:** 2026-03-01  
> **Scope:** RFC 7643 §2 attribute characteristics across all flows + extension/custom extension handling

---

## Master Gap Matrix

### Characteristic × Flow Coverage

| Characteristic | POST | PUT | PATCH | GET | List/Filter | Discovery |
|:--|:--:|:--:|:--:|:--:|:--:|:--:|
| **name** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **type** | ✅^1^ | ✅^1^ | ✅^1^ | -- | -- | ✅ |
| **multiValued** | ✅^1^ | ✅^1^ | ✅^1^ | -- | -- | ✅ |
| **description** | -- | -- | -- | -- | -- | ✅ |
| **required** | ✅ | ✅ | ✅^2^ | -- | -- | ✅ |
| **canonicalValues** | ❌ | ❌ | ❌ | -- | -- | ❌ |
| **caseExact** | ❌ | ❌ | ❌ | -- | ✅^7^ | ✅^3^ |
| **mutability** | ✅^1^ | ✅^1,6^ | ✅^1^ | -- | -- | ✅ |
| **returned** | ✅^8^ | ✅^8^ | ✅^8^ | ✅^8^ | ✅^8^ | ✅ |
| **uniqueness** | ✅^4^ | ✅^4^ | ✅^4^ | -- | -- | ✅^5^ |
| **referenceTypes** | ❌ | ❌ | ❌ | -- | -- | ✅ |
| **subAttributes** | ✅^1^ | ✅^1^ | ✅^1^ | ✅ | ✅ | ✅ |

^1^ Only when `StrictSchemaValidation=true`  
^2^ Correctly skipped per RFC 7644 §3.5.2  
^3^ Declared in schema constants but never consumed by validation/filtering  
^4^ Hardcoded for userName, externalId, displayName — not schema-driven  
^5^ Missing from all extension attribute definitions  
^6^ Immutable enforcement via `SchemaValidator.checkImmutable()` (old-vs-new comparison)  
^7^ Schema-driven caseExact-aware filtering via `apply-scim-filter.ts` column map (v0.24.0 R-CASE-1)  
^8^ Schema-driven `returned` enforcement: always-returned, returned:never stripping, writeOnly→never (v0.24.0 R-RET-1/2/3, R-MUT-1)  

---

## Issues Ranked by Severity

### BUG-001: PATCH custom extension URN not recognized (CRITICAL)

**Location:** `scim-patch-path.ts` L84, `scim-constants.ts` L22-28  
**RFC:** 7644 §3.5.2

`isExtensionPath()` and `parseExtensionPath()` default to `KNOWN_EXTENSION_URNS` — a **hardcoded array** of 5 URNs. Custom extensions registered via `EndpointSchema` table are not included.

**Impact:** PATCH operations targeting custom extension attributes (e.g., `urn:example:custom:2.0:User:field`) silently store the full URN path as a flat key in rawPayload instead of nesting under the extension namespace. This corrupts:
- Response building (extension not in `schemas[]`)
- Filtering (attribute not found under extension namespace)
- Subsequent GET operations (wrong structure)

**Current behavior:**
```json
// After PATCH: op=replace, path="urn:custom:ext:2.0:User:field", value="X"
rawPayload = {
  "urn:custom:ext:2.0:User:field": "X"  // ← WRONG: flat key
}
// Expected:
rawPayload = {
  "urn:custom:ext:2.0:User": { "field": "X" }  // ← Correct: nested
}
```

**Affected flows:** UserPatchEngine.apply() L188, L255; resolveNoPathValue() L391  
**Fix:** Pass `extensionUrns` from `schemaRegistry.getExtensionUrns(endpointId)` into PatchEngine via `PatchConfig`, then plumb through to all `isExtensionPath()`/`parseExtensionPath()` calls.

---

### BUG-002: `returned:"never"` attributes not stripped from responses (HIGH)

**Location:** `endpoint-scim-users.service.ts` L475-500 (`toScimUserResource`), `endpoint-scim-groups.service.ts` L547-590 (`toScimGroupResource`)  
**RFC:** 7643 §2.2

Response builders blindly spread `rawPayload` into responses. No attribute is filtered based on its `returned` characteristic. If an attribute with `returned:"never"` were stored (e.g., a password hash), it would be leaked in every GET/LIST response.

**Impact:** Currently zero live impact (no `returned:"never"` attributes are defined), but adding one (e.g., `password`, `secretKey`) would create a **data leak**.

**Fix:** After building the response, consult schema definitions and strip attributes where `returned === 'never'`. For `returned === 'request'`, only include when explicitly requested via `?attributes=`.

---

### BUG-003: `returned:"always"` partially hardcoded (HIGH)

**Location:** `scim-attribute-projection.ts` L21  
**RFC:** 7643 §7

```typescript
const ALWAYS_RETURNED = new Set(['schemas', 'id', 'meta']);
```

Only 3 attributes are hardcoded. `userName` is declared `returned:"always"` in schema constants but can be excluded via `?excludedAttributes=userName`. Per RFC, `returned:"always"` attributes MUST appear in every response.

**Impact:** `?excludedAttributes=userName` can remove `userName` from responses. Same for Group's `displayName` (`returned:"always"`).

**Fix:** Build `ALWAYS_RETURNED` dynamically from schema definitions, or at minimum add `userName` (User) and `displayName` (Group) to the hardcoded set.

---

### BUG-004: `immutable` mutability not enforced on PUT (MEDIUM)

**Location:** `schema-validator.ts` L203-210  
**RFC:** 7643 §2.2

SchemaValidator only checks for `readOnly`:
```typescript
if (attrDef.mutability === 'readOnly' && (options.mode === 'create' || options.mode === 'replace')) {
```

`immutable` attributes (set-once, then locked) can be freely changed via PUT. Current schema constants declare `members.value` as `immutable` — this means group member IDs could theoretically be changed via PUT (though member replacement works differently in practice).

**Fix:** Add `immutable` check: if `mode === 'replace'` and `attr.mutability === 'immutable'` → error.

---

### BUG-005: PATCH has no mutability enforcement (MEDIUM)

**Location:** `user-patch-engine.ts`, `group-patch-engine.ts`  
**RFC:** 7643 §2.2

Neither PatchEngine checks attribute mutability against schema. A `readOnly` attribute could be patched without error. `validatePayloadSchema()` is only called from `createUserForEndpoint()` and `replaceUserForEndpoint()`, never from `patchUserForEndpoint()`.

**Impact:** Currently low because first-class fields (userName, active, etc.) are all `readWrite`, and the User schema doesn't define any `readOnly` top-level attributes. But Group `members.value` is `immutable`, and extension attributes could have `readOnly`/`immutable` mutability.

**Fix:** Not adding full schema validation to PATCH in this iteration (too complex — requires path-to-attrDef resolution). Document as known limitation.

---

### BUG-006: `caseExact` never consulted by any code path — ✅ PARTIALLY FIXED

**Location:** `apply-scim-filter.ts`, `schema.prisma`  
**RFC:** 7643 §2.2

**Status:** ✅ **FIXED for `externalId`** (the only first-class `caseExact: true` string attribute).

`externalId` column changed from `@db.Citext` (case-insensitive) to `@db.Text` (case-sensitive) per RFC 7643 §3.1 (`caseExact: true`). Filter engine now uses `'text'` column type for `externalId` — `co`/`sw`/`ew` operators omit `mode: 'insensitive'`, and `eq` uses PostgreSQL `TEXT =` (case-sensitive). Migration: `20260225181836_externalid_citext_to_text`.

**Remaining:** Schema-driven `caseExact` lookup is still not implemented for dynamic/extension attributes. All first-class indexed columns (`userName`, `displayName`, `externalId`, `id`, `active`) now have correct case semantics through their column types. See `docs/EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md` for details.

---

### BUG-007: `canonicalValues` absent from type system and schema constants (LOW)

**Location:** `validation-types.ts`, `scim-schemas.constants.ts`  
**RFC:** 7643 §2.4

`canonicalValues` is not in `SchemaAttributeDefinition`, not in any schema constant, and not validated. RFC says these are "suggested" not "enforced", so servers MAY omit them. But `/Schemas` SHOULD advertise them.

**Example:** `emails.type` should suggest `["work", "home", "other"]`.

**Fix:** Add `canonicalValues` to type definitions and schema constants. No enforcement needed (RFC says suggestions only).

---

### BUG-008: `uniqueness` missing from extension attribute definitions (LOW)

**Location:** `scim-schemas.constants.ts` (enterprise user attributes)  
**RFC:** 7643 §2.2

None of the enterprise extension attributes specify `uniqueness`. Per RFC, the default is `"none"`, but `/Schemas` SHOULD explicitly declare it. It's missing from `SchemaAttributeDefinition.uniqueness` on most attributes.

**Fix:** Add `uniqueness: 'none'` to all extension attributes that don't have it.

---

### BUG-009: `referenceTypes` not validated at runtime (LOW)

**Location:** `schema-validator.ts` L256-260  
**RFC:** 7643 §2.3.7

`reference` type attributes only check `typeof value === 'string'`. No validation that the reference points to a valid resource of the declared type.

**Impact:** `manager.$ref` (with `referenceTypes: ['User']`) accepts any string. Group member resolution (`resolveMemberInputs()`) does verify user existence but that's member-specific, not schema-driven.

**Fix:** Not fixing — most SCIM servers don't validate referenceTypes. RFC says MAY.

---

### BUG-010: No validation on custom schema JSONB structure (LOW)

**Location:** `scim-schema-registry.ts` L167  
**RFC:** N/A (implementation quality)

`EndpointSchema.attributes` (JSONB) is stored as-is from admin input and cast blindly:
```typescript
row.attributes as ScimSchemaAttribute[]
```

Missing or malformed attribute definitions (no `type`, no `multiValued`) cause SchemaValidator to silently skip type/multiValued checks.

**Fix:** Add structural validation when registering/loading custom schemas.

---

## Extension-Specific Issues

### EXT-001: GroupPatchEngine has no extension path handling

**Location:** `group-patch-engine.ts`  
**Impact:** Group PATCH can only target `displayName`, `externalId`, and `members`. Any other path throws `invalidPath`. Extension attributes can only reach rawPayload via no-path replace (which stores raw keys), not via URN-prefixed paths.

---

### EXT-002: Built-in vs custom extension parity in PATCH

| Feature | Built-in Extensions | Custom Extensions |
|---|---|---|
| PATCH `urn:...:attr` path | ✅ Recognized | ❌ Not in KNOWN_EXTENSION_URNS |
| PATCH no-path with URN keys | ✅ | ❌ |
| POST/PUT validation | ✅ | ✅ (same code path) |
| Response building | ✅ | ✅ |
| Discovery | ✅ | ✅ |

---

## Fixes Applied

| # | Fix | Status | Files Changed |
|---|-----|--------|---------------|
| 1 | **BUG-001**: Pass `extensionUrns` to PatchEngines | ✅ DONE | patch-types.ts, user-patch-engine.ts, group-patch-engine.ts, endpoint-scim-users.service.ts, endpoint-scim-groups.service.ts, scim-patch-path.ts |
| 2 | **BUG-004**: Enforce `immutable` mutability on PUT+PATCH (H-2) | ✅ DONE | schema-validator.ts (checkImmutable), endpoint-scim-users.service.ts, endpoint-scim-groups.service.ts |
| 3 | **BUG-003**: Add `userName`/`displayName` to ALWAYS_RETURNED | ✅ DONE | scim-attribute-projection.ts, scim-attribute-projection.spec.ts, endpoint-scim-users.controller.spec.ts |
| 4 | **BUG-007**: Add `canonicalValues` to types + schema constants | ✅ DONE | validation-types.ts, scim-schemas.constants.ts |
| 5 | **BUG-008**: Add `uniqueness` to extension attributes | ✅ DONE | scim-schemas.constants.ts |
| 6 | **EXT-001**: GroupPatchEngine extension path handling | ✅ DONE | group-patch-engine.ts (add/replace/remove all handle extension URN paths) |
| 7 | Tests for all fixes | ✅ DONE | user-patch-engine.spec.ts, group-patch-engine.spec.ts, scim-patch-path.spec.ts |
| 8 | **H-1**: PATCH SchemaValidator integration | ✅ DONE | endpoint-scim-users.service.ts, endpoint-scim-groups.service.ts |
| 9 | **H-2**: Immutable attribute enforcement | ✅ DONE | schema-validator.ts, endpoint-scim-users.service.ts, endpoint-scim-groups.service.ts |
| — | Full test suite | ✅ All pass | — |
| 10 | **BUG-006**: `caseExact` in filter evaluation — externalId CITEXT→TEXT | ✅ DONE (v0.17.2) | schema.prisma, apply-scim-filter.ts, apply-scim-filter.spec.ts, endpoint-scim-groups.service.spec.ts, scim-validator-compliance.e2e-spec.ts, live-test.ps1, migration `20260225181836_externalid_citext_to_text` |

### Deferred (documented, not fixing now)

| # | Issue | Reason |
|---|-------|--------|
| BUG-002 | `returned:"never"` stripping | No `returned:"never"` attributes currently exist; requires response builder refactor |
| ~~BUG-004~~ | ~~`immutable` mutability enforcement~~ | ✅ Fixed — `SchemaValidator.checkImmutable()` + service integration |
| ~~BUG-005~~ | ~~PATCH mutability enforcement~~ | ✅ Fixed — post-PATCH `SchemaValidator.validate()` with mode:'patch' |
| ~~BUG-006~~ | ~~`caseExact` in filter parser~~ | ✅ Fixed (v0.17.2) — externalId changed from CITEXT→TEXT, filter engine uses `'text'` column type for case-sensitive matching |
| BUG-009 | `referenceTypes` validation | RFC says MAY; most servers don't |
| BUG-010 | Custom schema JSONB validation | Needs admin API changes |

---

*Generated: 2026-02-24 | Updated: 2026-03-01*
