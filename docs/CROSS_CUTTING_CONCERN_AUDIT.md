# Cross-Cutting Concern Audit - All Attribute Characteristics

**Status:** Current | **Last Updated:** 2026-04-28 | **Baseline:** v0.40.0  
**Scope:** mutability, returned, uniqueness, required, caseExact - all flows, all resource types, all config combinations  
**RFC References:** RFC 7643 §2 (Attribute Characteristics), RFC 7644 §3 (Protocol Operations)  
**Test Baseline:** 3,429 unit (84 suites) - 1,149 E2E (54 suites) - ~817 live + 112 Lexmark - ALL PASSING

---

## 1. Architecture Overview

### 1.1 Service Layers Audited

| Layer | Users | Groups | Generic |
|-------|-------|--------|---------|
| **Service** | `endpoint-scim-users.service.ts` (663 lines) | `endpoint-scim-groups.service.ts` (775 lines) | `endpoint-scim-generic.service.ts` (1,194 lines) |
| **Controller** | `endpoint-scim-users.controller.ts` (301 lines) | `endpoint-scim-groups.controller.ts` (303 lines) | `endpoint-scim-generic.controller.ts` (399 lines) |
| **Shared Helpers** | `scim-service-helpers.ts` - `ScimSchemaHelpers` class + pure functions (1,305 lines) | ← same | ← direct function imports (no `ScimSchemaHelpers` wrapper) |
| **Validation** | `schema-validator.ts` - pure domain (1,555 lines) | ← same | ← same |
| **Projection** | `scim-attribute-projection.ts` (592 lines) | ← same | ← same |
| **Patch Engines** | `user-patch-engine.ts` | `group-patch-engine.ts` | `generic-patch-engine.ts` |
| **Sort** | `scim-sort.util.ts` - `resolveUserSortParams()` | ← `resolveGroupSortParams()` | In-memory sort via hardcoded `fieldMap` |
| **Filter** | `apply-scim-filter.ts` - `buildUserFilter()` | ← `buildGroupFilter()` | `parseSimpleFilter()` (eq only) + `validateFilterAttributePaths()` |

### 1.2 Precomputed Schema Characteristics Cache

All attribute characteristics are precomputed **once** at profile load time into a `SchemaCharacteristicsCache` via `SchemaValidator.buildCharacteristicsCache()`. The cache is keyed by URN-qualified dot-paths (e.g., `urn:...:core:2.0:user.emails`) and stored per resource-type-URN on the endpoint profile. This provides O(1) lookups at request time with zero per-request tree walks and zero name-collision ambiguity.

**Cache fields** (15 total):

| Field | Type | Purpose |
|-------|------|---------|
| `booleansByParent` | `Map<string, Set<string>>` | Boolean-typed attributes per parent |
| `neverReturnedByParent` | `Map<string, Set<string>>` | `returned:never` + `writeOnly` attributes |
| `alwaysReturnedByParent` | `Map<string, Set<string>>` | `returned:always` attributes |
| `requestReturnedByParent` | `Map<string, Set<string>>` | `returned:request` attributes |
| `readOnlyByParent` | `Map<string, Set<string>>` | `mutability:readOnly` attributes |
| `immutableByParent` | `Map<string, Set<string>>` | `mutability:immutable` attributes |
| `caseExactByParent` | `Map<string, Set<string>>` | `caseExact:true` attributes |
| `caseExactPaths` | `Set<string>` | Flat lowercase dotted paths for filter/sort |
| `uniqueAttrs` | `Array<{schemaUrn, attrName, caseExact}>` | `uniqueness:server` custom attrs |
| `extensionUrns` | `readonly string[]` | Extension URNs for this resource type |
| `coreSchemaUrn` | `string` | Lowercase core URN (root key for runtime walks) |
| `schemaUrnSet` | `ReadonlySet<string>` | All schema URNs for top-level key identification |
| `coreAttrMap` | `Map<string, SchemaAttributeDefinition>` | Core attribute lookup |
| `extensionSchemaMap` | `Map<string, SchemaDefinition>` | Extension schema lookup |
| `readOnlyCollected` | `{core, extensions, coreSubAttrs, extensionSubAttrs}` | Structured shape for `stripReadOnlyAttributes()` |

### 1.3 Helper Architecture

Users and Groups services instantiate a `ScimSchemaHelpers` class in the constructor, parameterized by their core schema URN (`SCIM_CORE_USER_SCHEMA` / `SCIM_CORE_GROUP_SCHEMA`). All cache access, validation, boolean coercion, readOnly stripping, filter path validation, immutable checking, and extension URN resolution are delegated to this class.

The Generic service does NOT use `ScimSchemaHelpers`. Instead, it has equivalent private methods (`enforceStrictSchemaValidation`, `validatePayloadSchema`, `coerceBooleanStringsIfEnabled`, `checkImmutableAttributes`, `getSchemaCacheForRT`, etc.) that accept a `ScimResourceType` parameter for dynamic core URN resolution. The underlying logic is identical - both paths use `SchemaValidator` and `sanitizeBooleanStringsByParent` from the shared helpers module.

Shared pure functions extracted via G17/v0.31.0 deduplication:
- `ensureSchema()`, `enforceIfMatch()` - used identically by all 3 services
- `sanitizeBooleanStringsByParent()` - URN-dot-path boolean coercion (output sanitization)
- `coercePatchOpBooleans()` - PATCH operation boolean coercion (v0.31.0 extraction)
- `stripNeverReturnedFromPayload()` - returned:never stripping + dynamic `schemas[]` building (v0.31.0 extraction)
- `stripReadOnlyAttributes()`, `stripReadOnlyPatchOps()` - readOnly enforcement for POST/PUT and PATCH
- `assertSchemaUniqueness()` - schema-driven uniqueness for custom extension attributes

---

## 2. Findings Table

| # | Issue | Severity | Flows | Description | Status |
|---|-------|----------|-------|-------------|--------|
| 1 | **`caseExact` not honored in hardcoded uniqueness checks** | Low | POST, PUT, PATCH | Hardcoded uniqueness for `userName` (Users) and `displayName` (Groups) uses DB-level CITEXT (PostgreSQL) or `toLowerCase()` (InMemory) - always case-insensitive. `externalId` and `User.displayName` no longer enforce uniqueness (v0.33.0). Schema-driven uniqueness (`assertSchemaUniqueness`) correctly checks `caseExact`, but column-promoted attributes do not. | **Accepted** - profiles rarely override built-in `caseExact`. Column-level uniqueness is always CI by design. |
| 2 | **`writeOnly` attributes not validated in `sortBy`** | Low | LIST | `scim-sort.util.ts` maps `sortBy` to DB columns but does NOT check if the attribute has `mutability:writeOnly`. RFC 7643 §2.2 states writeOnly attrs are meaningful only in write operations. Filter paths ARE validated for writeOnly (in `SchemaValidator.validateFilterAttributePaths`), but sort has no equivalent. Falls through to default sort field silently. | **Accepted** - no built-in sort attributes are writeOnly. |
| 3 | **Generic service sort uses hardcoded `fieldMap` without schema awareness** | Low | LIST (Generic) | Generic `listResources()` sorts in-memory using a static `fieldMap` (`id`, `externalid`, `displayname`, `meta.created`, `meta.lastmodified`). No `caseExact` awareness, no writeOnly validation, no custom attribute sorting. Users/Groups use `resolveUserSortParams()`/`resolveGroupSortParams()` which return `SortParams` with a `caseExact` flag. | **Accepted** - generic resources use JSONB storage; extending sort to custom JSONB paths is a significant effort with low demand. |
| 4 | **Generic service filter limited to eq-only** | Low | LIST (Generic) | `parseSimpleFilter()` handles only `displayName eq "value"` and `externalId eq "value"`. All other filter expressions throw `400 invalidFilter`. Users/Groups have full AST-based filter with 10 operators + AND/OR compound push-down. The `validateFilterAttributePaths()` validates paths against schema, but the actual execution path can only handle `eq`. | **Accepted** - designed this way; full generic filter would require JSONB-path query engine. |
| 5 | **Schema validation on PATCH result (H-1) skips `required` enforcement** | Info | PATCH | `SchemaValidator.validate()` skips required attribute checks when `mode === 'patch'` (line 112). A PATCH that removes a required attribute will not be rejected by post-PATCH validation. RFC 7644 §3.5.2 is ambiguous about whether post-PATCH state must satisfy required constraints. | **Design choice** - lenient by design; RFC doesn't explicitly require it. |
| 6 | **`uniqueness:global` is not implemented** | Low | All writes | `buildCharacteristicsCache()` only collects `uniqueness:server`. RFC 7643 also defines `uniqueness:global` (unique across all endpoints/tenants). | **Known limitation** - not needed for typical single-tenant SCIM deployments. |
| 7 | **Immutable multi-valued complex matching uses `value` sub-attr only** | Low | PUT, PATCH | `SchemaValidator.checkImmutableMultiValuedComplex()` matches incoming elements to existing elements by the `value` sub-attribute. If elements match by a different key (e.g., `type`), violations may go undetected for re-ordered arrays. | **Design choice** - `value` is the canonical member identifier per RFC 7643 §2.4. |
| 8 | **`returned:always` override cannot be blocked by `excludedAttributes`** | Info | GET, LIST | `excludeAttrs()` correctly prevents excluding always-returned attributes. Per RFC 7644 §3.4.2.5: "Attributes whose 'returned' setting is 'always' SHALL always be included." Verified consistent across all three controllers. | **Correct behavior** |
| 9 | **`required` + `readOnly` interaction handled correctly** | Info | POST, PUT | `SchemaValidator.validate()` explicitly exempts `readOnly` attributes from the required check: `attr.required && attr.mutability !== 'readOnly'`. Prevents the impossible `id` (required + readOnly) catch-22. | **Correct behavior** |
| 10 | **`writeOnly` + `returned:never` defense-in-depth** | Info | All responses | `buildCharacteristicsCache()` adds writeOnly attributes to the `neverReturnedByParent` set, providing defense-in-depth: even if a profile omits `returned:never` on a writeOnly attribute, it will still be stripped from responses. | **Correct behavior** |
| 11 | **`caseExact` correctly NOT applied to attribute name matching** | Info | All | `stripReadOnlyPatchOps`, `sanitizeBooleanStringsByParent`, projection functions - all use `toLowerCase()` for attribute NAME matching. `caseExact` applies to attribute VALUES only per RFC 7643 §2.1. | **Correct behavior** |
| 12 | **`readOnly` + PATCH + strict mode configurable matrix** | Info | PATCH | Configurable: `!strict → strip`; `strict + IgnorePatchRO → strip`; `strict + !IgnorePatchRO → keep (G8c 400)`. Consistent across all 3 services. | **Correct behavior** |

---

## 3. Operation Sequencing Per Flow

### 3.1 CREATE (POST)

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | `ensureSchema(schemas, SCIM_CORE_USER_SCHEMA)` | `ensureSchema(schemas, SCIM_CORE_GROUP_SCHEMA)` | `ensureSchema(schemas, resourceType.schema)` | ✅ Consistent - validates core schema URN present |
| 2 | `enforceStrictSchemaValidation(dto)` | `enforceStrictSchemaValidation(dto)` | `enforceStrictSchemaValidation(body, resourceType)` | ✅ Rejects undeclared/unregistered extension URNs |
| 3 | `coerceBooleansByParentIfEnabled(dto)` | `coerceBooleansByParentIfEnabled(dto)` | `coerceBooleanStringsIfEnabled(body, resourceType)` | ✅ Same logic - URN-dot-path boolean coercion |
| 4 | `validatePayloadSchema(dto, 'create')` | `validatePayloadSchema(dto, 'create')` | `validatePayloadSchema(body, resourceType, 'create')` | ✅ Required + type + mutability + unknowns |
| 5 | `stripReadOnlyAttributesFromPayload(dto)` | `stripReadOnlyAttributesFromPayload(dto)` | `stripReadOnlyAttributes(body, schemaDefs, readOnlyCache)` | ✅ RFC 7643 §2.2 - server ignores client readOnly |
| 6 | Hardcoded uniqueness (`findConflict`: userName only) | Hardcoded uniqueness (displayName only) | No hardcoded uniqueness (removed in v0.33.0) | ✅ Resource-type-specific checks |
| 7 | `assertSchemaUniqueness(uniqueAttrs)` | `assertSchemaUniqueness(uniqueAttrs)` | `assertSchemaUniqueness(uniqueAttrs)` | ✅ Schema-driven custom extension uniqueness |
| 8 | Create record (`randomUUID()`) | Create record (`randomUUID()`) | Create record (`randomUUID()`) | ✅ Server-assigned `id` (BF-1) |
| 9 | `toScimUserResource()` → `sanitizeBooleanStringsByParent` + `stripNeverReturnedFromPayload` | `toScimGroupResource()` → same | `toScimResponse()` → same | ✅ All use shared v0.31.0 helpers |
| 10 | Controller: `applyAttributeProjection()` + `attachWarnings()` | Controller: same | Controller: same | ✅ G8g write-response projection |

### 3.2 REPLACE (PUT)

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | `ensureSchema()` | `ensureSchema()` | `ensureSchema()` | ✅ |
| 2 | `enforceStrictSchemaValidation()` | `enforceStrictSchemaValidation()` | `enforceStrictSchemaValidation()` | ✅ |
| 3 | `coerceBooleansByParentIfEnabled()` | `coerceBooleansByParentIfEnabled()` | `coerceBooleanStringsIfEnabled()` | ✅ |
| 4 | `validatePayloadSchema('replace')` | `validatePayloadSchema('replace')` | `validatePayloadSchema('replace')` | ✅ |
| 5 | `stripReadOnlyAttributesFromPayload()` | `stripReadOnlyAttributesFromPayload()` | - (deferred to step 9) | ⚠️ See note |
| 6 | Find existing / 404 | Find existing / 404 | Find existing / 404 | ✅ |
| 7 | `enforceIfMatch()` | `enforceIfMatch()` | `enforceIfMatch()` | ✅ |
| 8 | `checkImmutableAttributes()` | `checkImmutableAttributes()` | `checkImmutableAttributes()` | ✅ H-2 |
| 9 | - | - | `stripReadOnlyAttributes()` | ⚠️ Generic strips AFTER immutable check |
| 10 | Hardcoded uniqueness (self-excluded) | Hardcoded uniqueness (self-excluded) | Hardcoded uniqueness (self-excluded) | ✅ |
| 11 | `assertSchemaUniqueness(self-excluded)` | `assertSchemaUniqueness(self-excluded)` | `assertSchemaUniqueness(self-excluded)` | ✅ |
| 12 | Update record | Update record | Update record | ✅ |
| 13 | Response (strips returned:never) | Response (strips returned:never) | Response (strips returned:never) | ✅ |

> **Note on step 5/9:** Users and Groups strip readOnly BEFORE the DB fetch and immutable check. Generic strips AFTER. Both are correct because `readOnly` and `immutable` are mutually exclusive (RFC 7643 §2.2). The immutable check filters for `mutability === 'immutable'` only, so readOnly attrs don't affect it in either order.

### 3.3 PATCH

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | `ensureSchema(SCIM_PATCH_SCHEMA)` | `ensureSchema(SCIM_PATCH_SCHEMA)` | `ensureSchema(SCIM_PATCH_SCHEMA)` | ✅ |
| 2 | Find existing / 404 | Find existing / 404 | Find existing / 404 | ✅ |
| 3 | `enforceIfMatch()` | `enforceIfMatch()` | `enforceIfMatch()` | ✅ |
| 4 | ReadOnly strip (gated: `!strict` OR `ignorePatchRO`) | ReadOnly strip (gated) | ReadOnly strip (gated) | ✅ All 3 follow identical gating pattern |
| 5 | V2 pre-validation + `coercePatchOpBooleans()` (strict) | V2 pre-validation + `coercePatchOpBooleans()` (strict) | V2 pre-validation + `coercePatchOpBooleans()` (strict) | ✅ |
| 6 | Apply `UserPatchEngine` | Apply `GroupPatchEngine` | Apply `GenericPatchEngine` | ✅ |
| 7 | `coerceBooleansByParentIfEnabled()` on result | `coerceBooleansByParentIfEnabled()` on result | `coerceBooleanStringsIfEnabled()` on result | ✅ Post-PATCH coercion |
| 8 | `validatePayloadSchema('patch')` - H-1 | `validatePayloadSchema('patch')` - H-1 | `validatePayloadSchema('patch')` - H-1 | ✅ |
| 9 | `checkImmutableAttributes()` - H-2 | `checkImmutableAttributes()` - H-2 | `checkImmutableAttributes()` - H-2 | ✅ |
| 10 | Hardcoded uniqueness (self-excluded) | Hardcoded uniqueness (self-excluded) | Hardcoded uniqueness (self-excluded) | ✅ |
| 11 | `assertSchemaUniqueness(self-excluded)` | `assertSchemaUniqueness(self-excluded)` | `assertSchemaUniqueness(self-excluded)` | ✅ |
| 12 | Update record | Update record (transactional `updateGroupWithMembers`) | Update record | ✅ |
| 13 | Response (strips returned:never) | Response (strips returned:never) | Response (strips returned:never) | ✅ |

### 3.4 READ (GET) / LIST

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | (LIST) `buildUserFilter()` + `validateFilterPaths()` | (LIST) `buildGroupFilter()` + `validateFilterPaths()` | (LIST) `validateFilterAttributePaths()` + `parseSimpleFilter()` | ✅ All validate filter paths in strict mode |
| 2 | (LIST) `resolveUserSortParams()` | (LIST) `resolveGroupSortParams()` | (LIST) In-memory sort via `fieldMap` | ⚠️ Finding #3 |
| 3 | Fetch from DB | Fetch from DB | Fetch from DB | ✅ |
| 4 | `toScim*Resource()` → `sanitizeBooleanStringsByParent` + `stripNeverReturnedFromPayload` | Same | Same | ✅ |
| 5 | Controller: `applyAttributeProjection()` | Controller: same | Controller: same | ✅ |
| - | Strips `returned:request` (unless in `?attributes`) | Same | Same | ✅ |
| - | Honors `returned:always` (never excluded) | Same | Same | ✅ |

### 3.5 DELETE

| Step | Users | Groups | Generic | Notes |
|------|-------|--------|---------|-------|
| 1 | Find existing / 404 | Find existing / 404 | Find existing / 404 | ✅ |
| 2 | `enforceIfMatch()` | `enforceIfMatch()` | `enforceIfMatch()` | ✅ |
| 3 | Hard-delete (row physically removed) | Same | Same | ✅ DELETE always hard-deletes |

No attribute characteristic concerns on DELETE.

---

## 4. Cross-Flow Combination Matrix

### 4.1 Mutability × Flow × Config

| Mutability | POST | PUT | PATCH | GET/LIST | Config Gate |
|------------|------|-----|-------|----------|-------------|
| **readOnly** | Strip silently (log + warn header) | Strip silently (log + warn header) | Strip if `!strict OR ignorePatchRO`; Reject 400 if `strict AND !ignorePatchRO` | N/A (response only) | `StrictSchemaValidation`, `IgnoreReadOnlyAttributesInPatch`, `IncludeWarningAboutIgnoredReadOnlyAttribute` |
| **readWrite** | Accept | Accept | Accept | Return (per `returned` characteristic) | None |
| **writeOnly** | Accept (stored) | Accept (stored) | Accept (stored) | **Stripped** from response (defense-in-depth: treated as `returned:never`) | None |
| **immutable** | Accept (first write) | Reject 400 if value changed | Reject 400 if result differs from original | Return normally | `StrictSchemaValidation` (immutable check gated) |

### 4.2 Returned × Flow × Query Params

| Returned | No params | `?attributes=X` | `?excludedAttributes=X` | Response from POST/PUT/PATCH |
|----------|-----------|-----------------|------------------------|------------------------------|
| **always** | ✅ Included | ✅ Always included (cannot be excluded) | ✅ Cannot be excluded | ✅ Included (G8g projection applies) |
| **default** | ✅ Included | Only if in X | Excluded if in X | ✅ Included (G8g projection applies) |
| **request** | ❌ Stripped (controller layer) | ✅ Only if in X | ❌ Stripped (regardless) | Same rules apply (G8g) |
| **never** | ❌ Stripped (service layer - `stripNeverReturnedFromPayload`) | ❌ Cannot be requested | ❌ Stripped (service layer) | ❌ Stripped (service layer) |

### 4.3 Uniqueness × Flow

| Uniqueness | POST | PUT | PATCH | GET/LIST | DELETE |
|------------|------|-----|-------|----------|--------|
| **server** (hardcoded: User.userName, Group.displayName) | ✅ 409 on conflict | ✅ 409 (self-excluded) | ✅ 409 (self-excluded) | N/A | N/A |
| **server** (schema-driven custom attrs via `assertSchemaUniqueness`) | ✅ | ✅ (self-excluded) | ✅ (self-excluded) | N/A | N/A |
| **global** | ❌ Not implemented | ❌ | ❌ | N/A | N/A |
| **none** | No check | No check | No check | N/A | N/A |

### 4.4 Required × Flow × Mode

| Mode | Required + readWrite | Required + readOnly | Required + writeOnly |
|------|---------------------|--------------------|--------------------|
| **POST (create)** | ✅ Enforced (400 if missing) | ❌ Exempt (server-assigned) | ✅ Enforced |
| **PUT (replace)** | ✅ Enforced (400 if missing) | ❌ Exempt | ✅ Enforced |
| **PATCH** | ❌ Not enforced (by design) | N/A | ❌ Not enforced |

### 4.5 CaseExact × Feature

| Feature | caseExact:true | caseExact:false |
|---------|---------------|----------------|
| **Filter comparison** | Case-sensitive match | Case-insensitive match |
| **Sort** (Users/Groups) | Case-sensitive sort ordering | Case-insensitive sort ordering |
| **Sort** (Generic) | ⚠️ Always `localeCompare` (no caseExact) | Always `localeCompare` |
| **Uniqueness (schema-driven)** | Exact compare | `toLowerCase()` compare |
| **Uniqueness (column-hardcoded)** | ⚠️ Always case-insensitive (Finding #1) | Case-insensitive |
| **Attribute name matching** | Always case-insensitive (RFC 7643 §2.1) | Always case-insensitive |
| **PATCH value filter matching** | Case-sensitive (via `PatchConfig.caseExactPaths`) | Case-insensitive |

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
| Undeclared extension URNs | ❌ Ignored | ✅ 400 error |
| Filter path validation | ❌ Not checked | ✅ 400 `invalidFilter` |
| writeOnly in filter | ❌ Not checked | ✅ 400 `invalidFilter` |
| Canonical values | ❌ Not checked | ✅ 400 on violation |

---

## 5. Return Path Analysis (Response Building)

All three services follow the same v0.31.0 response-building pattern using shared helpers:

### 5.1 `toScimUserResource()` / `toScimGroupResource()` / `toScimResponse()`

```
1. Parse rawPayload from DB (JSON string → object)
2. sanitizeBooleanStringsByParent(payload, boolMap, coreUrnLower)
   → Coerces stored "True"/"False" strings to native booleans using URN-dot-path precision
3. stripNeverReturnedFromPayload(payload, neverByParent, coreUrnLower, extensionUrns)
   → Core top-level + core sub-attr + extension top-level + extension sub-attr stripping
   → FP-1: removes empty extension objects after stripping
   → Returns visibleExtUrns for dynamic schemas[] building (G19)
4. Build schemas[] = [coreSchemaUrn, ...visibleExtUrns]
5. Delete reserved keys (id, schemas) from rawPayload to prevent overrides
6. Merge: { schemas, ...rawPayload, id: scimId, firstClassColumns..., meta }
```

### 5.2 Controller Projection Layer

```
1. Service returns full SCIM resource (never-returned already stripped)
2. Controller calls applyAttributeProjection(result, attributes, excludedAttributes,
   alwaysByParent, requestByParent)
   a. If ?attributes=X → includeOnly() - keep only requested + always-returned
   b. If ?excludedAttributes=X → excludeAttrs() - remove specified except always-returned
   c. Always: stripRequestOnlyAttrs() - strip returned:request unless in ?attributes=X
3. Write responses (POST/PUT/PATCH): additionally call attachWarnings()
   for readOnly stripping notifications
```

---

## 6. Cross-Concern Interactions

| Interaction | Behavior | Status |
|-------------|----------|--------|
| readOnly + required | Required check exempts readOnly → no impossible-to-satisfy constraint | ✅ Correct |
| writeOnly + returned:never | writeOnly always added to never-returned set (defense-in-depth) | ✅ Correct |
| writeOnly + filter | Rejected with 400 `invalidFilter` in strict mode | ✅ Correct |
| writeOnly + sort | NOT validated (falls through to default sort) | ⚠️ Finding #2 (accepted) |
| immutable + readOnly | Mutually exclusive per RFC; immutable check skips readOnly attrs | ✅ Correct |
| immutable + PATCH | Checked post-PATCH (H-2: compares existing with result payload) | ✅ Correct |
| returned:always + excludedAttributes | Cannot be excluded (always returned) | ✅ Correct |
| returned:request + attributes | Included only when explicitly listed in `?attributes=` | ✅ Correct |
| returned:never + sub-attributes | Recursive stripping via URN-dot-path `neverByParent` maps + `stripSubAttrs()` | ✅ Correct (fixed in v0.31.0) |
| returned:request + sub-attributes | Recursive stripping via `subReqByAttrName` in `stripRequestOnlyAttrs` | ✅ Correct (fixed in v0.31.0) |
| caseExact + uniqueness (hardcoded) | Hardcoded checks always case-insensitive | ⚠️ Finding #1 (accepted) |
| caseExact + uniqueness (schema-driven) | Correctly uses `caseExact` flag in `uniquenessValuesMatch()` | ✅ Correct |
| required + PATCH (post-validation) | Not enforced in patch mode | ✅ Design choice |
| readOnly + PATCH + strict | Configurable per `IgnoreReadOnlyAttributesInPatch` | ✅ Correct |

---

## 7. Service Parity Comparison

### 7.1 Feature Parity Matrix

| Feature | Users | Groups | Generic |
|---------|-------|--------|---------|
| Schema validation (strict mode) | ✅ via `ScimSchemaHelpers` | ✅ via `ScimSchemaHelpers` | ✅ via private methods |
| Boolean coercion (input) | ✅ `coerceBooleansByParentIfEnabled` | ✅ same | ✅ `coerceBooleanStringsIfEnabled` |
| Boolean sanitization (output) | ✅ `sanitizeBooleanStringsByParent` | ✅ same | ✅ same |
| ReadOnly stripping (POST/PUT) | ✅ via cache | ✅ via cache | ✅ via cache |
| ReadOnly stripping (PATCH ops) | ✅ gated, via cache | ✅ gated, via cache | ✅ gated, via cache |
| ReadOnly warning URN | ✅ `attachWarnings()` | ✅ same | ✅ same |
| Returned:never stripping | ✅ `stripNeverReturnedFromPayload` | ✅ same | ✅ same |
| Returned:request stripping | ✅ controller projection | ✅ controller projection | ✅ controller projection |
| Returned:always enforcement | ✅ `getAlwaysReturnedByParent` | ✅ same | ✅ `getSchemaCacheForRT` |
| Immutable enforcement (H-2) | ✅ via `checkImmutableAttributes` | ✅ same | ✅ via private `checkImmutableAttributes` |
| Post-PATCH validation (H-1) | ✅ `validatePayloadSchema('patch')` | ✅ same | ✅ same |
| V2 PATCH pre-validation | ✅ | ✅ | ✅ |
| PATCH boolean coercion | ✅ `coercePatchOpBooleans` | ✅ same | ✅ same |
| Hardcoded uniqueness | ✅ userName + externalId | ✅ displayName + externalId | ✅ externalId + displayName |
| Schema-driven uniqueness | ✅ `assertSchemaUniqueness` | ✅ same | ✅ same |
| Soft-delete guard | N/A (removed - DELETE always hard-deletes) | N/A | N/A |
| Reprovision on conflict | N/A (removed in v0.33.0) | N/A | N/A |
| If-Match / ETag enforcement | ✅ `enforceIfMatch` | ✅ same | ✅ same |
| Filter path validation | ✅ `validateFilterPaths` | ✅ same | ✅ `validateFilterAttributePaths` |
| Full filter operators | ✅ 10 operators + AND/OR | ✅ same | ❌ eq-only (Finding #4) |
| Sort (caseExact-aware) | ✅ | ✅ | ❌ hardcoded `localeCompare` (Finding #3) |
| Write-response projection (G8g) | ✅ | ✅ | ✅ |
| `.search` POST endpoint | ✅ | ✅ | ✅ |
| Dynamic `schemas[]` in response (G19) | ✅ | ✅ | ✅ |
| Extension URN empty cleanup (FP-1) | ✅ | ✅ | ✅ |

### 7.2 Structural Differences

| Aspect | Users/Groups | Generic |
|--------|-------------|---------|
| Helper class | `ScimSchemaHelpers` (instantiated in constructor) | Private methods accepting `ScimResourceType` |
| Core schema URN | Fixed (`SCIM_CORE_USER_SCHEMA` / `SCIM_CORE_GROUP_SCHEMA`) | Dynamic from `resourceType.schema` |
| Cache access | `this.schemaHelpers.getSchemaCache()` | `this.getSchemaCacheForRT(resourceType, endpointId)` |
| Filter engine | Full AST parser (`buildUserFilter` / `buildGroupFilter`) | `parseSimpleFilter()` (eq-only regex) |
| Sort engine | `resolveUserSortParams` / `resolveGroupSortParams` → `SortParams` with `caseExact` | In-memory `localeCompare` with hardcoded `fieldMap` |
| Patch engine | `UserPatchEngine.apply()` / `GroupPatchEngine.apply()` (static) | `new GenericPatchEngine(payload, extUrns)` (instance) |
| Member handling | Groups: transactional `updateGroupWithMembers` with member resolution | N/A |

---

## 8. Summary

### Confirmed Correct (8 of 12 findings)

- All three services follow an identical characteristic enforcement pipeline
- The `SchemaCharacteristicsCache` provides comprehensive precomputation with URN-qualified dot-path maps for zero per-request tree walks and zero name-collision ambiguity
- v0.31.0 deduplication: `stripNeverReturnedFromPayload()` and `coercePatchOpBooleans()` are single shared implementations used by all 3 services
- `returned:never` sub-attribute stripping is recursive (core + extension, top-level + sub-attr)
- `returned:request` sub-attribute stripping uses parent-context-aware maps
- Cross-concern interactions (`readOnly+required`, `writeOnly+returned:never`, `immutable+readOnly`) are handled with explicit defense-in-depth
- Attribute projection (`attributes`/`excludedAttributes`) correctly handles `always`/`default`/`request`/`never` lifecycle
- G8g write-response projection is consistently applied on POST, PUT, PATCH across all controllers
- Schema-driven uniqueness enforcement correctly uses `caseExact` for comparison

### Accepted Gaps (by priority)

| Priority | Finding | Impact | Status |
|----------|---------|--------|--------|
| Medium | #1 - `caseExact` not honored in hardcoded uniqueness | Wrong uniqueness semantics if profile overrides `caseExact` on built-in attrs | **Accepted** - profiles rarely override; column-level uniqueness is always CI |
| Low | #2 - `writeOnly` in `sortBy` not validated | Silent degradation to default sort | **Accepted** - no built-in sort attrs are writeOnly |
| Low | #3 - Generic sort lacks `caseExact` awareness | Always uses `localeCompare` | **Accepted** - JSONB sort extension is low demand |
| Low | #4 - Generic filter limited to eq-only | All other operators → 400 | **Accepted** - by design; full JSONB filter requires significant effort |

### Design Choices (no action needed)

| Finding | Rationale |
|---------|-----------|
| #5 - Required attrs not enforced on PATCH result | RFC 7644 §3.5.2 is ambiguous; lenient by design |
| #6 - `uniqueness:global` not implemented | Single-tenant scope - not needed |
| #7 - Immutable multi-valued matching by `value` only | Standard SCIM pattern per RFC 7643 §2.4 |

---

*Generated from source at v0.31.0 (2026-04-01), updated at v0.40.0 (2026-04-28). Cross-verified against all service, controller, helper, validator, projection, sort, and filter source files.*
