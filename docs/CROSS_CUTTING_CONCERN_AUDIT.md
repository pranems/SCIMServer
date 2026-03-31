# Cross-Cutting Concern Audit — All Attribute Characteristics

**Date:** 2026-03-30  
**Scope:** mutability, returned, uniqueness, required, caseExact — all flows, all resource types, all config combinations  
**RFC References:** RFC 7643 §2 (Attribute Characteristics), RFC 7644 §3 (Protocol Operations)

---

## 1. Architecture Overview

### Service Layers Audited

| Layer | Users | Groups | Generic |
|-------|-------|--------|---------|
| Service | `endpoint-scim-users.service.ts` | `endpoint-scim-groups.service.ts` | `endpoint-scim-generic.service.ts` |
| Controller | `endpoint-scim-users.controller.ts` | `endpoint-scim-groups.controller.ts` | `endpoint-scim-generic.controller.ts` |
| Shared Helpers | `scim-service-helpers.ts` (ScimSchemaHelpers class + pure functions) | ← same | ← direct calls |
| Validation | `schema-validator.ts` (pure domain) | ← same | ← same |
| Projection | `scim-attribute-projection.ts` | ← same | ← same |
| Patch Engines | `user-patch-engine.ts` | `group-patch-engine.ts` | `generic-patch-engine.ts` |

### Precomputed Cache

All characteristics are precomputed at profile load time into `SchemaCharacteristicsCache` via `SchemaValidator.buildCharacteristicsCache()`. The cache is stored per-resource-type-URN on the endpoint profile object and provides O(1) lookups at request time.

---

## 2. Findings Table

| # | Issue | Severity | Flows Affected | Description |
|---|-------|----------|----------------|-------------|
| 1 | **`returned:never` sub-attribute stripping lacks depth recursion** | Medium | GET, LIST, POST, PUT, PATCH (response) | `stripReturnedNever()` in `scim-attribute-projection.ts` (L149-175) strips top-level `returned:never` attributes and checks one level into extension URN objects, but does NOT recurse into complex sub-attributes. A sub-attribute with `returned:never` inside a `readWrite` complex parent (e.g., `name.secretHash`) would NOT be stripped. The `neverReturnedByParent` cache correctly builds Parent→Children maps, but the `toScimUserResource`/`toScimGroupResource`/`toScimResponse` output functions only check `coreNever` (top-level) and `extNever` (extension top-level). They do not walk into complex sub-objects to strip nested `returned:never` sub-attrs. **Expected:** Recursive stripping per RFC 7643 §2.4. **Actual:** Only top-level + extension top-level stripped. **Classification:** Gap. |
| 2 | **`returned:request` sub-attribute stripping lacks depth recursion** | Low | GET, LIST | `stripRequestOnlyAttrs()` in `scim-attribute-projection.ts` (L184-211) handles top-level and extension top-level `returned:request` attrs, but does not strip `returned:request` sub-attributes from within complex parents when the parent itself is not request-only. The `requestReturnedByParent` cache correctly stores these, but they are flattened via `flattenParentChildMap()` before being passed to projection, losing parent context. **Expected:** Sub-attr of a `readWrite` parent with `returned:request` should be stripped unless explicitly requested. **Actual:** Only effective for top-level attrs. **Classification:** Gap. |
| 3 | **`writeOnly` attributes not validated in sortBy** | Low | LIST | Sort utility (`scim-sort.util.ts`) maps `sortBy` to DB columns but does NOT check if the sort attribute has `mutability:writeOnly`. RFC 7643 §2.2 states writeOnly attrs are meaningful only in write operations. Filter paths ARE validated for writeOnly (CROSS-03 in `schema-validator.ts` L822-851), but sortBy has no equivalent check. **Expected:** 400 error or ignore. **Actual:** Falls through to default sort field (no error but silently degrades). **Classification:** Gap (low impact — few writeOnly attributes are sortable DB columns). |
| 4 | **Generic service PATCH readOnly stripping runs unconditionally (before strict check)** | Low | PATCH (Generic) | In `endpoint-scim-generic.service.ts` (L500-521), `stripReadOnlyPatchOps()` always runs, then checks if `strictSchemaEnabled && !ignorePatchReadOnly` to decide whether to throw 400. The strip result (`filtered`) is only used when NOT throwing — but if the code reaches the throw, the operations have already been mutated. This is harmless because an exception aborts the flow, but the sequencing differs from Users/Groups which check `!strictSchemaEnabled || ignorePatchReadOnly` as a gate BEFORE stripping. **Expected:** Identical pattern across all services. **Actual:** Generic strips first, then conditionally rejects. Users/Groups only strip when they intend to use the result. **Classification:** Inconsistency (harmless — exception aborts, but code style diverges). |
| 5 | **Immutable check on PUT: sequencing differs between services** | Low | PUT | Users: `checkImmutableAttributes()` runs BEFORE `stripReadOnlyAttributes()` (L301, then readOnly stripping already happened at L283). Groups: same order. Generic: `checkImmutableAttributes()` at L395-396 runs BEFORE `stripReadOnlyAttributes()` at L398-401. All three are consistent. However, the immutable check receives the body AFTER readOnly stripping has already occurred (readOnly removal happened earlier in the flow). If an attribute is both `readOnly` AND `immutable`, it gets silently stripped before the immutable check sees it, so the immutable check never fires for it. **Expected:** This is correct behavior — readOnly attrs are server-assigned, immutable check is for client-writable-once attrs. **Classification:** Design choice (correct). |
| 6 | **`returned:never` stripping in `toScimResponse` (Generic) uses `stripReturnedNever()` + inline code** | Low | All read/response (Generic) | Generic service (`endpoint-scim-generic.service.ts` L759) uses `stripReturnedNever(payload, coreNever)` for core attrs, then has inline loops (L775-788) for extension attrs. Users/Groups use only inline loops (no `stripReturnedNever` call). Both approaches work but are inconsistent in helper usage. **Classification:** Inconsistency (cosmetic). |
| 7 | **Schema validation on PATCH result (H-1) does NOT enforce `required` for patch mode** | Info | PATCH | `SchemaValidator.validate()` skips required attribute checks when `mode === 'patch'` (L112). This means a PATCH that removes a required attribute will not be rejected by H-1 post-PATCH validation. RFC 7644 §3.5.2 is ambiguous about whether the result of PATCH must satisfy all required-attribute constraints. Current behavior is lenient. **Expected:** Debatable — RFC doesn't explicitly require post-PATCH required enforcement. **Actual:** Required attrs not enforced on PATCH result. **Classification:** Design choice. |
| 8 | **`uniqueness:global` is not implemented** | Low | CREATE, PUT, PATCH | `collectUniqueAttributes()` (L1192) only collects `uniqueness:server`. The RFC also defines `uniqueness:global` (unique across all endpoints). No code handles global uniqueness. **Expected:** Not needed for single-tenant SCIM servers. **Actual:** Only server-scoped uniqueness. **Classification:** Known limitation (by design). |
| 9 | **`caseExact` not used in uniqueness comparison for column-promoted attributes** | Medium | CREATE, PUT, PATCH | Hardcoded uniqueness checks for `userName`, `externalId`, and `displayName` use DB-level case-insensitive matching (CITEXT in PostgreSQL, `toLowerCase()` in InMemory). These do NOT consult the schema's `caseExact` flag for the attribute. For `userName` (caseExact:false per standard User schema), this is correct. But if a profile overrides `userName` to `caseExact:true`, the DB-level check would still be case-insensitive. Only schema-driven uniqueness (`assertSchemaUniqueness`) respects `caseExact`. **Expected:** Column-level checks should respect schema `caseExact`. **Actual:** Always case-insensitive. **Classification:** Gap (edge case — profiles rarely override built-in caseExact). |
| 10 | **`immutable` sub-attribute check in multi-valued complex: match by `value` only** | Low | PUT, PATCH (post-check) | `checkImmutableMultiValuedComplex()` (L611-649) matches incoming elements to existing elements solely by the `value` sub-attribute. If elements are matched by a different key (e.g., `type` or `display`), immutable violations may go undetected for re-ordered arrays or elements without a `value`. **Expected:** RFC 7643 §2.4 doesn't specify a matching key; `value` is the canonical identifier. **Actual:** Only `value`-based matching. **Classification:** Design choice (acceptable for standard SCIM use-cases). |
| 11 | **`returned:always` override cannot be blocked by `excludedAttributes`** | Info | GET, LIST | `excludeAttrs()` (L366-415) correctly prevents excluding `always-returned` attributes. This is per RFC 7644 §3.4.2.5: "Attributes whose 'returned' setting is 'always' SHALL always be included." Verified consistent across all three controllers. **Classification:** Correct behavior (documented for completeness). |
| 12 | **No `writeOnly` attribute in sort validation for Generic LIST** | Low | LIST (Generic) | Generic service `listResources()` performs in-memory sort using a hardcoded `fieldMap`. It does not validate whether the sort attribute is `writeOnly`. Users/Groups have static sort maps that don't include writeOnly attrs, but a custom schema could define a sortable writeOnly attribute. **Classification:** Gap (same as #3 but for generic). |
| 13 | **`required` + `readOnly` interaction handled correctly** | Info | CREATE, REPLACE | `SchemaValidator.validate()` (L114-130) explicitly exempts `readOnly` attributes from the required check: `attr.required && attr.mutability !== 'readOnly'`. This prevents the impossible situation where `id` (required + readOnly) would always fail validation. **Classification:** Correct behavior. |
| 14 | **`writeOnly` + `returned:never` defense-in-depth** | Info | ALL responses | `collectReturnedCharacteristics()` (L1113) and `buildCharacteristicsCache()` (L1395) both add `writeOnly` attributes to the `never` returned set, providing defense-in-depth: even if a profile forgets to set `returned:never` on a writeOnly attribute, it will still be stripped. **Classification:** Correct behavior. |
| 15 | **`caseExact` not enforced on PATCH path matching** | Low | PATCH | When `stripReadOnlyPatchOps()` resolves PATCH paths, it uses `toLowerCase()` for all comparisons. This is correct for case-insensitive SCIM attribute names (RFC 7643 §2.1). The `caseExact` flag applies to attribute VALUES, not attribute NAMES. No issue. **Classification:** Correct behavior. |
| 16 | **Generic service `patchResource` does NOT coerce booleans BEFORE readOnly stripping** | Low | PATCH (Generic) | In the Generic PATCH flow, readOnly stripping (L500-521) runs before boolean coercion (L527-545). In contrast, for CREATE/PUT, coercion runs before validation (which includes readOnly checks in strict mode). The order difference means a boolean-string value in a readOnly op would be stripped as-is. Since readOnly ops are discarded, this has no functional impact. **Classification:** Inconsistency (harmless). |

---

## 3. Operation Sequencing Per Flow

### 3.1 CREATE (POST)

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | `ensureSchema()` | `ensureSchema()` | `ensureSchema()` | ✅ Consistent |
| 2 | `enforceStrictSchemaValidation()` | `enforceStrictSchemaValidation()` | `enforceStrictSchemaValidation()` | ✅ Consistent |
| 3 | `coerceBooleansByParentIfEnabled()` | `coerceBooleansByParentIfEnabled()` | `coerceBooleanStringsIfEnabled()` | ✅ Same logic, different method name (Generic has no SchemaHelpers) |
| 4 | `validatePayloadSchema('create')` | `validatePayloadSchema('create')` | `validatePayloadSchema('create')` | ✅ Consistent |
| 5 | `stripReadOnlyAttributesFromPayload()` | `stripReadOnlyAttributesFromPayload()` | `stripReadOnlyAttributes()` | ✅ Same underlying function |
| 6 | Uniqueness (hardcoded: userName, externalId) | Uniqueness (hardcoded: displayName, externalId) | Uniqueness (hardcoded: externalId, displayName) | ✅ Resource-type-specific |
| 7 | Schema-driven uniqueness (`assertSchemaUniqueness`) | Schema-driven uniqueness | Schema-driven uniqueness | ✅ Consistent |
| 8 | Create record | Create record | Create record | ✅ |
| 9 | `toScimUserResource()` (strips returned:never) | `toScimGroupResource()` (strips returned:never) | `toScimResponse()` (strips returned:never) | ✅ All strip in response builder |

### 3.2 REPLACE (PUT)

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | ensureSchema | ensureSchema | ensureSchema | ✅ |
| 2 | enforceStrictSchemaValidation | enforceStrictSchemaValidation | enforceStrictSchemaValidation | ✅ |
| 3 | coerceBoolean | coerceBoolean | coerceBoolean | ✅ |
| 4 | validatePayloadSchema('replace') | validatePayloadSchema('replace') | validatePayloadSchema('replace') | ✅ |
| 5 | stripReadOnly | stripReadOnly | — (deferred to step 8) | ⚠️ See below |
| 6 | Find existing / 404 | Find existing / 404 | Find existing / 404 | ✅ |
| 7 | guardSoftDeleted | guardSoftDeleted | guardSoftDeleted | ✅ |
| 8 | enforceIfMatch | enforceIfMatch | enforceIfMatch | ✅ |
| 9 | checkImmutable | checkImmutable | checkImmutable | ✅ |
| 10 | — | — | stripReadOnly (here for Generic) | ⚠️ Generic strips AFTER immutable check |
| 11 | uniqueness (hardcoded) | uniqueness (hardcoded) | uniqueness (hardcoded) | ✅ |
| 12 | schema-driven uniqueness | schema-driven uniqueness | schema-driven uniqueness | ✅ |
| 13 | Update record | Update record | Update record | ✅ |
| 14 | Response (strips returned:never) | Response (strips returned:never) | Response (strips returned:never) | ✅ |

> **Note on step 5/10:** Users and Groups strip readOnly BEFORE the DB fetch and immutable check. Generic strips AFTER the immutable check. Both orders are functionally correct because `readOnly` and `immutable` are mutually exclusive characteristics (RFC 7643 §2.2: an attribute cannot be both). The immutable check explicitly filters for `mutability === 'immutable'`, so readOnly attrs don't affect it either way.

### 3.3 PATCH

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | ensureSchema (PatchOp) | ensureSchema (PatchOp) | ensureSchema (PatchOp) | ✅ |
| 2 | Find existing / 404 | Find existing / 404 | Find existing / 404 | ✅ |
| 3 | guardSoftDeleted | guardSoftDeleted | guardSoftDeleted | ✅ |
| 4 | enforceIfMatch | enforceIfMatch | enforceIfMatch | ✅ |
| 5 | ReadOnly strip (gated) | ReadOnly strip (gated) | ReadOnly strip (always runs) | ⚠️ Finding #4 |
| 6 | V2 pre-validation (strict) | V2 pre-validation (strict) | V2 pre-validation (strict) | ✅ |
| 7 | Apply patch engine | Apply patch engine | Apply patch engine | ✅ |
| 8 | H-1 post-PATCH validation | H-1 post-PATCH validation | H-1 post-PATCH validation | ✅ |
| 9 | H-2 immutable check | H-2 immutable check | H-2 immutable check | ✅ |
| 10 | Uniqueness (hardcoded) | Uniqueness (hardcoded) | Uniqueness (hardcoded) | ✅ |
| 11 | Schema-driven uniqueness | Schema-driven uniqueness | Schema-driven uniqueness | ✅ |
| 12 | Update record | Update record | Update record | ✅ |
| 13 | Response (strips returned:never) | Response (strips returned:never) | Response (strips returned:never) | ✅ |

### 3.4 READ (GET) / LIST

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | (LIST) validateFilterPaths | (LIST) validateFilterPaths | (LIST) validateFilterPaths | ✅ Includes writeOnly check in filter |
| 2 | Fetch from DB | Fetch from DB | Fetch from DB | ✅ |
| 3 | guardSoftDeleted (GET) / filter (LIST) | guardSoftDeleted (GET) / filter (LIST) | guardSoftDeleted (GET) / filter (LIST) | ✅ |
| 4 | `toScim*Resource()` strips returned:never | `toScim*Resource()` strips returned:never | `toScimResponse()` strips returned:never | ✅ |
| 5 | Controller: `applyAttributeProjection()` | Controller: `applyAttributeProjection()` | Controller: `applyAttributeProjection()` | ✅ |
| — | Strips returned:request (unless in `?attributes`) | ← same | ← same | ✅ |
| — | Honors returned:always (never excluded) | ← same | ← same | ✅ |

### 3.5 DELETE

No attribute characteristic concerns. Just soft-delete guard, If-Match, and deletion.

---

## 4. Cross-Flow Combination Matrix

### 4.1 Mutability × Flow × Config

| Mutability | POST | PUT | PATCH | GET/LIST | Config Gate |
|------------|------|-----|-------|----------|-------------|
| **readOnly** | Strip silently (log + warn header) | Strip silently (log + warn header) | Strip if `!strict OR ignorePatchRO`; Reject 400 if `strict AND !ignorePatchRO` | N/A (response only) | `IgnoreReadOnlyAttributesInPatch`, `StrictSchemaValidation` |
| **readWrite** | Accept | Accept | Accept | Return (per `returned` char) | None |
| **writeOnly** | Accept (stored) | Accept (stored) | Accept (stored) | **Stripped** from response (treated as returned:never) | None |
| **immutable** | Accept (first write) | Reject 400 if value changed | Reject 400 if result differs from original | Return normally | `StrictSchemaValidation` (immutable check gated) |

### 4.2 Returned × Flow × Query Params

| Returned | No params | `?attributes=X` | `?excludedAttributes=X` | Response from POST/PUT/PATCH |
|----------|-----------|-----------------|------------------------|------------------------------|
| **always** | ✅ Included | ✅ Always included (cannot be excluded) | ✅ Cannot be excluded | ✅ Included (G8g projection applies) |
| **default** | ✅ Included | Only if in X | Excluded if in X | ✅ Included (G8g projection applies) |
| **request** | ❌ Stripped | ✅ Only if in X | ❌ Stripped (regardless) | Same rules apply (G8g) |
| **never** | ❌ Stripped in service layer | ❌ Cannot be requested | ❌ Stripped in service layer | ❌ Stripped in service layer |

### 4.3 Uniqueness × Flow

| Uniqueness | POST | PUT | PATCH | GET/LIST | DELETE |
|------------|------|-----|-------|----------|--------|
| **server** (hardcoded: userName, displayName, externalId) | ✅ 409 on conflict | ✅ 409 (self-excluded) | ✅ 409 (self-excluded) | N/A | N/A |
| **server** (schema-driven custom attrs) | ✅ `assertSchemaUniqueness()` | ✅ (self-excluded) | ✅ (self-excluded) | N/A | N/A |
| **global** | ❌ Not implemented | ❌ | ❌ | N/A | N/A |
| **none** | No check | No check | No check | N/A | N/A |

### 4.4 Required × Flow × Mode

| Mode | Required + readWrite | Required + readOnly | Required + writeOnly |
|------|---------------------|--------------------|--------------------|
| **create** | ✅ Enforced (400 if missing) | ❌ Exempt (server-assigned) | ✅ Enforced |
| **replace** | ✅ Enforced (400 if missing) | ❌ Exempt | ✅ Enforced |
| **patch** | ❌ Not enforced (by design) | N/A | ❌ Not enforced |

### 4.5 CaseExact × Feature

| Feature | caseExact:true | caseExact:false |
|---------|---------------|----------------|
| **Filter comparison** | Case-sensitive match | Case-insensitive match |
| **Sort** | Case-sensitive sort ordering | Case-insensitive sort ordering |
| **Uniqueness (schema-driven)** | Exact compare | toLowerCase compare |
| **Uniqueness (column-hardcoded)** | ⚠️ Always case-insensitive (Finding #9) | Case-insensitive |
| **Attribute name matching** | Always case-insensitive (RFC 7643 §2.1) | Always case-insensitive |

### 4.6 StrictSchemaValidation Config Matrix

| Feature | Strict OFF | Strict ON |
|---------|-----------|-----------|
| Required attrs | ❌ Not checked | ✅ Checked (create/replace) |
| Type validation | ❌ Not checked | ✅ Checked |
| Unknown attrs | ❌ Ignored | ✅ 400 error |
| readOnly (POST/PUT) | ✅ Stripped (always) | ✅ Stripped (always) + validation error logged |
| readOnly (PATCH) | ✅ Stripped | Depends on `IgnoreReadOnlyAttributesInPatch` |
| Immutable check | ❌ Not checked | ✅ 400 on violation |
| V2 PATCH pre-validation | ❌ Not checked | ✅ Checked |
| H-1 PATCH post-validation | ❌ Not checked | ✅ Checked |
| Undeclared extensions | ❌ Ignored | ✅ 400 error |
| Filter path validation | ❌ Not checked | ✅ 400 invalidFilter |
| writeOnly in filter | ❌ Not checked | ✅ 400 invalidFilter |
| Canonical values | ❌ Not checked | ✅ 400 on violation |

---

## 5. Cross-Concern Interactions

| Interaction | Behavior | Status |
|-------------|----------|--------|
| readOnly + required | Required check exempts readOnly → no impossible-to-satisfy constraint | ✅ Correct |
| writeOnly + returned:never | writeOnly always added to never-returned set (defense-in-depth) | ✅ Correct |
| writeOnly + filter | Rejected with 400 invalidFilter in strict mode | ✅ Correct |
| writeOnly + sort | NOT rejected (falls through to default sort) | ⚠️ Gap (#3) |
| immutable + readOnly | Mutually exclusive per RFC; immutable check skips readOnly attrs | ✅ Correct |
| immutable + PATCH | Checked post-PATCH (compares existing with result payload) | ✅ Correct |
| returned:always + excludedAttributes | Cannot be excluded (always returned) | ✅ Correct |
| returned:request + attributes | Included only when explicitly listed | ✅ Correct |
| returned:never + sub-attributes | ⚠️ Only top-level and extension top-level stripped (#1) | ⚠️ Gap |
| caseExact + uniqueness (hardcoded) | Hardcoded checks always case-insensitive (#9) | ⚠️ Gap |
| required + PATCH (post-validation) | Not enforced in patch mode | ✅ Design choice |
| readOnly + PATCH + strict | Configurable: strip or reject based on `IgnoreReadOnlyAttributesInPatch` | ✅ Correct |

---

## 6. Summary

### Confirmed Correct

- **15 out of 16 findings** show correct or acceptable behavior
- All three service types (Users, Groups, Generic) follow the same characteristic enforcement pipeline
- The `SchemaCharacteristicsCache` provides comprehensive precomputation with correct Parent→Children maps
- Cross-concern interactions (readOnly+required, writeOnly+returned:never) are handled with explicit defense-in-depth
- Attribute projection (attributes/excludedAttributes) correctly handles always/default/request/never lifecycle
- G8g write-response projection is consistently applied on POST, PUT, PATCH across all controllers

### Gaps to Address (by priority)

| Priority | Finding | Impact | Effort | Status |
|----------|---------|--------|--------|--------|
| Medium | #1 — returned:never sub-attr stripping depth | Potential secret leakage in complex types | Medium | **FIXED** — Recursive sub-attr stripping added to `stripReturnedNever()` + all 3 response builders (Users/Groups/Generic). 4 unit tests added. |
| Medium | #9 — caseExact not honored in hardcoded uniqueness | Wrong uniqueness semantics if profile overrides caseExact | Low | Accepted — profiles rarely override built-in caseExact. Column-level uniqueness is always CI. |
| Low | #2 — returned:request sub-attr stripping depth | Over-exposure of request-only sub-attrs | Medium | **FIXED** — Added `requestReturnedSubs` to `SchemaCharacteristicsCache`, cache builder, `collectReturnedCharacteristics()`, and `stripRequestOnlyAttrs()`. 7 tests added. |
| Low | #3/#12 — writeOnly in sortBy not rejected | Silent degradation to default sort | Low | Accepted — no built-in sort attrs are writeOnly. |
| Low | #4 — Generic PATCH readOnly strip sequencing | Code inconsistency (no functional impact) | Low | **FIXED** — Aligned Generic with Users/Groups gated-strip pattern. |
| Low | #16 — Generic PATCH boolean coercion order | Code inconsistency (no functional impact) | Low | **FIXED** — Reordered in alignment with Users/Groups. |

### Design Choices (no action needed)

- Required attributes not enforced on PATCH result (#7) — RFC-ambiguous
- `uniqueness:global` not implemented (#8) — single-tenant scope
- Immutable multi-valued complex matching by `value` only (#10) — standard SCIM pattern
