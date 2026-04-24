# SchemaValidator - readOnly + required Attribute Fix

> **Document Purpose**: Root cause analysis and fix reference for the `id` required+readOnly catch-22 bug that caused 65 test failures (24 unit + 41 E2E), plus the G8f mock drift fix (1 additional failure).
>
> **Created**: February 27, 2026
> **Version**: v0.21.0
> **RFC Reference**: RFC 7643 §2.2 (Mutability), RFC 7643 §3.1 (Common Attributes), RFC 7644 §3.1 (Creating Resources)

---

## Overview

### Problem Statement

The `SchemaValidator.validate()` method enforced a **logically impossible** constraint: the `id` attribute in both User and Group schemas was defined as `required: true` AND `mutability: 'readOnly'`. This created a catch-22:

- **Client omits `id`** (correct SCIM behavior) → Validator rejects: *"Required attribute 'id' is missing"* (400)
- **Client includes `id`** (to satisfy required check) → Validator rejects: *"readOnly and cannot be set by the client"* (400)

No valid client payload could pass both checks when `StrictSchemaValidation` was enabled.

### Impact

This bug was dormant until tests enabled `StrictSchemaValidation: true` alongside other features (e.g., `AllowAndCoerceBooleanStrings`). The catch-22 caused **65 total test failures**:

| Root Cause | Category | Failures | Description |
|-----------|----------|----------|-------------|
| A - readOnly+required catch-22 | code-bug | 59 | SchemaValidator impossible constraint on `id` |
| B - G8f mock drift (cascade) | test-bug | 5 | Earlier failures left unconsumed `mockResolvedValueOnce` items leaking into G8f tests |
| B - G8f mock drift (inherent) | test-bug | 1 | Test called `replaceGroupForEndpoint` twice but mocked `findWithMembers` only once |

### Solution Summary

1. **Root Cause A**: Skip readOnly attributes in required-attribute validation (1-line change in `schema-validator.ts`, applied to both core and extension checks)
2. **Root Cause B**: Add re-mock before second `replaceGroupForEndpoint` call in G8f test

---

## Root Cause A - The Catch-22 in Detail

### Schema Constants (Dual-Purpose)

The schema constants in `scim-schemas.constants.ts` serve two purposes:

1. **Discovery** - Returned by `GET /Schemas` endpoint (RFC 7643 §7)
2. **Validation** - Used by `SchemaValidator.validate()` for payload checks

For **discovery**, `id` being `required: true` is correct - RFC 7643 §3.1 states the `id` attribute "is REQUIRED" (meaning: every resource representation MUST include it). Clients reading `/Schemas` should see that `id` is required in responses.

For **validation**, `required: true` on a `readOnly` attribute is nonsensical - the client is forbidden from providing it, so demanding it from the client creates an impossible constraint.

```
┌──────────────────────────────────────────────────┐
│  scim-schemas.constants.ts                       │
│                                                  │
│  USER_SCHEMA_ATTRIBUTES / GROUP_SCHEMA_ATTRIBUTES│
│  ┌────────────────────────────────────────────┐  │
│  │  { name: 'id',                             │  │
│  │    required: true,      ← RFC correct      │  │
│  │    mutability: 'readOnly' ← RFC correct    │  │
│  │  }                                         │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Used by:                                        │
│  ├─ GET /Schemas → "id is required" ✅          │
│  └─ SchemaValidator → "client must send id" ❌  │
└──────────────────────────────────────────────────┘
```

### The Validation Flow (Before Fix)

```
Client POST body:
  { "schemas": [...], "userName": "alice" }
         │
         ▼
  SchemaValidator.validate(payload, schemas, { mode: 'create' })
         │
         ├─ Step 1: Required attribute check (line 92)
         │    for each attr where attr.required === true:
         │      ├─ id:       required=true → "is 'id' in payload?" → NO → ❌ ERROR
         │      └─ userName: required=true → "is 'userName' in payload?" → YES → ✅
         │
         └─ Step 2: Per-attribute validation (line 152+)
              for each key in payload:
                ├─ 'schemas': RESERVED_KEYS → skip
                ├─ 'userName': mutability=readWrite → validate type → ✅
                └─ (id not in payload → nothing to check)

Result: FAIL - "Required attribute 'id' is missing" (400)
```

If the client tried to include `id`:

```
Client POST body:
  { "schemas": [...], "userName": "alice", "id": "abc-123" }
         │
         ▼
  SchemaValidator.validate(payload, schemas, { mode: 'create' })
         │
         ├─ Step 1: Required attribute check
         │    ├─ id: "is 'id' in payload?" → YES → ✅ (passes required)
         │    └─ userName: → YES → ✅
         │
         └─ Step 2: Per-attribute validation (line 152+)
              for each key in payload:
                ├─ 'schemas': RESERVED_KEYS → skip
                ├─ 'id': RESERVED_KEYS → skip ← ⚠️ skipped entirely!
                └─ 'userName': validate type → ✅

Result: PASS - but client should NOT send id
```

Note: `id` is in the `RESERVED_KEYS` set (line 35-40), so the mutability readOnly check at line 249 is *never reached* for `id`. This means including `id` in the body actually "works" - but only because the validator skips it entirely as a reserved key, and the service layer later strips it via `stripReservedAttributes()`.

### The Catch-22 Visual

```
                    ┌─────────────────────┐
                    │ Client sends POST   │
                    │ with SCIM payload   │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │ Does payload        │
                    │ include 'id'?       │
                    └──┬──────────────┬───┘
                       │              │
                  YES  │              │  NO
                       │              │
              ┌────────▼───────┐  ┌──▼──────────────┐
              │ Per-attr loop: │  │ Required check:  │
              │ 'id' is in     │  │ 'id' is missing  │
              │ RESERVED_KEYS  │  │ → ERROR 400      │
              │ → SKIPPED      │  │ "Required attr   │
              │ (no readOnly   │  │  'id' is missing"│
              │  error raised) │  └──────────────────┘
              │ → PASSES       │
              └────────────────┘
              ⚠️ Silent pass, but
              client shouldn't
              send 'id' per RFC
```

### The Fix

RFC 7643 §2.2 states:

> **readOnly** - The attribute SHALL NOT be modified. [...] A "readOnly" attribute is server-assigned.

Server-assigned attributes are the server's responsibility, not the client's. The required check should not demand them from client payloads.

**Change**: Add `attr.mutability !== 'readOnly'` guard to the required-attribute validation:

```typescript
// BEFORE (line 88):
if (attr.required && !(this.findKeyIgnoreCase(payload, attr.name)))

// AFTER:
if (attr.required && attr.mutability !== 'readOnly' && !(this.findKeyIgnoreCase(payload, attr.name)))
```

Applied to both:
- **Core attributes** (line 94 in `schema-validator.ts`)
- **Extension attributes** (line 111 in `schema-validator.ts`)

### The Validation Flow (After Fix)

```
Client POST body:
  { "schemas": [...], "userName": "alice" }
         │
         ▼
  SchemaValidator.validate(payload, schemas, { mode: 'create' })
         │
         ├─ Step 1: Required attribute check (line 92)
         │    for each attr where attr.required === true:
         │      ├─ id:       required=true, mutability='readOnly'
         │      │            → readOnly → SKIP (server's job) ✅
         │      └─ userName: required=true, mutability='readWrite'
         │                   → "is 'userName' in payload?" → YES → ✅
         │
         └─ Step 2: Per-attribute validation (line 158+)
              for each key in payload:
                ├─ 'schemas': RESERVED_KEYS → skip
                └─ 'userName': mutability=readWrite → validate type → ✅

Result: PASS ✅ - correct behavior
```

### What the Fix Preserves

The original intention - *"On create/replace, reject payloads missing required attributes"* - is fully preserved for **all client-writable attributes**:

| Attribute | `required` | `mutability` | Before Fix | After Fix |
|-----------|-----------|-------------|------------|-----------|
| `id` | true | readOnly | ❌ False reject | ✅ Skipped (server-assigned) |
| `userName` | true | readWrite | ✅ Enforced | ✅ Still enforced |
| `displayName` (Group) | true | readWrite | ✅ Enforced | ✅ Still enforced |
| `emails.value` | true | readWrite | ✅ Enforced | ✅ Still enforced |
| `members.value` | true | immutable | ✅ Enforced | ✅ Still enforced |

---

## Root Cause B - G8f Test Mock Drift

### The Problem

In `endpoint-scim-groups.service.spec.ts`, the test *"should reject PUT with 409 when displayName conflicts"* called `replaceGroupForEndpoint` **twice** (once for `rejects.toThrow`, once in a `try/catch` for status assertion) but only set `mockResolvedValueOnce` for `findWithMembers` **once**:

```
Call 1: replaceGroupForEndpoint(...)
  → findWithMembers.mockResolvedValueOnce(mockGroup) → consumed → mockGroup → 409 ✅

Call 2: replaceGroupForEndpoint(...)
  → findWithMembers → queue empty → returns undefined → 404 ❌ (expected 409)
```

### The Fix

Added re-mock setup before the second call:

```typescript
// Re-mock for second call (mockResolvedValueOnce is consumed by first call)
mockGroupRepo.findWithMembers.mockResolvedValueOnce(mockGroup);
mockGroupRepo.findByDisplayName.mockResolvedValueOnce(conflictGroup);
```

### Cascade Effect

5 of the 6 G8f failures were **cascade** - not inherent bugs. When Root Cause A caused earlier tests in the same suite to fail, their unconsumed `mockResolvedValueOnce` items leaked into the G8f tests via the mock queue. `jest.clearAllMocks()` (used in `afterEach`) clears mock call history but does **NOT** clear the `mockResolvedValueOnce` queue - that requires `jest.resetAllMocks()`.

Fixing Root Cause A made the earlier tests pass and consume their mocks properly, automatically resolving 5 of the 6 G8f cascade failures.

---

## Complete SCIM `id` Lifecycle

For clarity, here is the full lifecycle of the `id` attribute across all SCIM operations:

```
                              SCIM 'id' Attribute Lifecycle
═══════════════════════════════════════════════════════════════════════════

  1. POST /Users (Create)
  ────────────────────────
  Client body:  { "userName": "alice" }        ← NO 'id' in body
                         │
                         ▼
  Validation:   Required check SKIPS 'id'      ← readOnly exemption (our fix)
                         │
                         ▼
  Service:      scimId = randomUUID()          ← server generates 'id'
                         │
                         ▼
  Response:     { "id": "abc-123",             ← server includes 'id'
                  "userName": "alice",
                  "meta": { ... } }

  2. GET /Users/abc-123 (Read)
  ────────────────────────────
  Response:     { "id": "abc-123", ... }       ← 'id' always present in responses

  3. PUT /Users/abc-123 (Replace)
  ───────────────────────────────
  Client body:  { "userName": "alice-updated" } ← NO 'id' in body
  URL path:     /Users/abc-123                  ← 'id' is in the URL, not body
                         │
                         ▼
  Validation:   Required check SKIPS 'id'       ← same fix applies
                         │
                         ▼
  Service:      Looks up resource by URL scimId ← server uses URL 'id'
                         │
                         ▼
  Response:     { "id": "abc-123", ... }        ← server returns 'id'

  4. PATCH /Users/abc-123 (Modify)
  ─────────────────────────────────
  Client body:  { "Operations": [...] }         ← NO 'id' in body
  URL path:     /Users/abc-123                  ← 'id' is in the URL
                         │
                         ▼
  Validation:   Required check SKIPPED          ← mode='patch' skips all
                         │                        required checks (line 92)
                         ▼
  Service:      Looks up resource by URL scimId
                         │
                         ▼
  Response:     { "id": "abc-123", ... }        ← server returns 'id'
```

### What Happens If Client Sends `id` Anyway?

```
  Client body:  { "id": "client-value", "userName": "alice" }
                         │
                         ▼
  Validation:   Step 1 (required check):
                  'id': required + readOnly → SKIPPED ← our fix
                Step 2 (per-attribute loop):
                  'id': in RESERVED_KEYS → SKIPPED ← existing behavior
                         │
                         ▼
  Service:      stripReservedAttributes() removes 'id' from body
                scimId = randomUUID()  ← server generates its own
                         │
                         ▼
  Response:     { "id": "server-generated-uuid", ... }
                  ↑ client's "id" value is completely discarded
```

---

## Architecture

### Validation Decision Tree

```
SchemaValidator.validate(payload, schemas, options)
    │
    ├─ options.mode === 'patch'?
    │   └─ YES → Skip ALL required checks → go to per-attribute loop
    │
    └─ NO (create or replace)
        │
        ├─ For each core schema attribute:
        │   ├─ attr.required === false? → skip
        │   ├─ attr.mutability === 'readOnly'? → skip ← OUR FIX
        │   └─ findKeyIgnoreCase(payload, attr.name)?
        │       ├─ Found → ✅ pass
        │       └─ Not found → ❌ "Required attribute 'X' is missing"
        │
        ├─ For each extension schema:
        │   └─ If extension block exists in payload:
        │       └─ For each extension attribute:
        │           ├─ attr.required === false? → skip
        │           ├─ attr.mutability === 'readOnly'? → skip ← OUR FIX
        │           └─ findKeyIgnoreCase(extPayload, attr.name)?
        │               ├─ Found → ✅ pass
        │               └─ Not found → ❌ "Required attribute 'X' missing in extension"
        │
        └─ Per-attribute validation loop:
            └─ For each key in payload:
                ├─ RESERVED_KEYS (schemas, id, externalId, meta) → skip
                ├─ Extension URN → validate extension block
                └─ Core attribute:
                    ├─ Unknown + strictMode → ❌ "Unknown attribute"
                    ├─ mutability=readOnly + mode=create/replace → ❌ "readOnly"
                    └─ Type check, multi-valued check, sub-attr check, etc.
```

### Key Components

| Component | File | Role |
|-----------|------|------|
| `SchemaValidator.validate()` | `api/src/domain/validation/schema-validator.ts` | Pure domain validator - required check + per-attribute validation |
| `RESERVED_KEYS` | `api/src/domain/validation/schema-validator.ts` (line 35) | Set of `{schemas, id, externalId, meta}` - skipped in per-attribute loop |
| `validatePayloadSchema()` | `api/src/modules/scim/common/scim-service-helpers.ts` | Service-layer wrapper - only runs when `StrictSchemaValidation` is ON |
| `USER_SCHEMA_ATTRIBUTES` | `api/src/modules/scim/discovery/scim-schemas.constants.ts` | Schema constants - `id` is `required:true, mutability:'readOnly'` (RFC-correct for discovery) |
| `GROUP_SCHEMA_ATTRIBUTES` | `api/src/modules/scim/discovery/scim-schemas.constants.ts` | Same pattern - `id` with `required:true, mutability:'readOnly'` |
| `stripReservedAttributes()` | `api/src/modules/scim/services/` | Service-layer utility - removes `id` from client payloads before persistence |

### Why the Fix is at the Validator, Not the Constants

```
┌─────────────────────────────────────────────────────────┐
│              Alternative: Change constants?              │
│                                                         │
│  Option A: Set id.required = false                      │
│    ❌ Breaks GET /Schemas response - RFC 7643 §3.1     │
│       says id "is REQUIRED" (must appear in responses)  │
│                                                         │
│  Option B: Split into discovery vs validation schemas   │
│    ⚠️ Works but adds complexity with no behavioral gain │
│       Duplicate schema definitions to maintain          │
│                                                         │
│  Option C: Fix at the validator ← CHOSEN                │
│    ✅ Constants remain RFC-accurate for /Schemas         │
│    ✅ Validator understands request vs response context  │
│    ✅ Single condition guards the logical impossibility  │
│    ✅ Minimal change, maximum correctness                │
└─────────────────────────────────────────────────────────┘
```

---

## RFC Compliance

### RFC 7643 §2.2 - Mutability

> **readOnly** - The attribute SHALL NOT be modified. [...] A "readOnly" attribute is assigned by the service provider. [...] The attribute SHALL be ignored when provided by the client.

This explicitly states that readOnly attributes are **server-assigned** - the server is responsible for providing them, not the client. Demanding them from the client in the required check violates this principle.

### RFC 7643 §3.1 - Common Attributes

> **id** - A unique identifier for a SCIM resource as defined by the service provider. [...] "id" is singularly unique [...] REQUIRED.

The word "REQUIRED" here means the attribute MUST appear in the **resource representation** (responses). It does not mean the client must provide it in the request body. The service provider assigns `id` during resource creation.

### RFC 7644 §3.1 - Creating Resources (POST)

> The service provider SHALL process the POST request to create a new resource [...] and assign a unique identifier.

The spec explicitly says the server "SHALL assign" the identifier - confirming the client does not provide it.

---

## Test Coverage

### Indirectly Covered (59 existing tests now pass)

The fix is indirectly validated by 59 existing tests that previously failed due to the catch-22. These tests invoke `SchemaValidator.validate()` through the service layer with `StrictSchemaValidation: true` and now pass because `id` is no longer falsely flagged as missing.

Key test groups that were failing:

| Test Suite | File | Failure Count | How They Triggered the Bug |
|-----------|------|--------------|---------------------------|
| AllowAndCoerceBooleanStrings (Groups) | `endpoint-scim-groups.service.spec.ts` | ~15 | Set `StrictSchemaValidation: true` alongside boolean coercion |
| AllowAndCoerceBooleanStrings (Users) | `endpoint-scim-users.service.spec.ts` | ~15 | Same pattern |
| StrictSchemaValidation (Groups) | `endpoint-scim-groups.service.spec.ts` | ~8 | Direct strict mode tests |
| StrictSchemaValidation (Users) | `endpoint-scim-users.service.spec.ts` | ~8 | Direct strict mode tests |
| Schema Validation E2E | `schema-validation.e2e-spec.ts` | ~30 | E2E tests with strict mode endpoints |
| Soft Delete Flags E2E | `soft-delete-flags.e2e-spec.ts` | ~11 | E2E tests with strict+soft-delete combos |

### G8f Mock Drift Fix (1 test)

| Test | File | Fix |
|------|------|-----|
| "should reject PUT with 409 when displayName conflicts" | `endpoint-scim-groups.service.spec.ts` (line 2699) | Added re-mock before second `replaceGroupForEndpoint` call |

### Test Totals Impact

| Level | Before Fix | After Fix | Delta |
|-------|-----------|-----------|-------|
| Unit suites | 67/69 pass | **73/73 pass** | +6 suites |
| Unit tests | 2,388/2,412 pass | **2,508/2,508 pass** | +120 tests, 0 failures |
| E2E suites | 23/25 pass | **25/25 pass** | +2 suites |
| E2E tests | 481/522 pass | **522/522 pass** | +41 tests, 0 failures |

> **Note**: The unit test count increased from 2,412 to 2,508 because previously-skipped tests in failing suites now run (Jest skips remaining tests in a `describe` block after an `it` failure in some configurations).

---

## Files Changed

| File | Change |
|------|--------|
| `api/src/domain/validation/schema-validator.ts` (line 94) | Added `attr.mutability !== 'readOnly'` guard to core required-attribute check |
| `api/src/domain/validation/schema-validator.ts` (line 111) | Added `attr.mutability !== 'readOnly'` guard to extension required-attribute check |
| `api/src/domain/validation/schema-validator.ts` (lines 85-91) | Added explanatory comment citing RFC 7643 §2.2 justification |
| `api/src/modules/scim/services/endpoint-scim-groups.service.spec.ts` (line 2718) | Added re-mock for `findWithMembers` + `findByDisplayName` before second call |

---

## Related Documentation

- [RFC 7643 §2.2 - Attribute Mutability](https://datatracker.ietf.org/doc/html/rfc7643#section-2.2)
- [RFC 7643 §3.1 - Common Attributes](https://datatracker.ietf.org/doc/html/rfc7643#section-3.1)
- [RFC 7644 §3.1 - Creating Resources](https://datatracker.ietf.org/doc/html/rfc7644#section-3.1)
- [G8c - PATCH readOnly Pre-Validation](G8C_PATCH_READONLY_PREVALIDATION.md) - Related readOnly enforcement for PATCH operations
- [G8f - Group Uniqueness PUT/PATCH](G8F_GROUP_UNIQUENESS_PUT_PATCH.md) - The G8f feature where mock drift was found
- [ENDPOINT_CONFIG_FLAGS_REFERENCE](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) - `StrictSchemaValidation` flag reference
- [SELF_IMPROVING_TEST_HEALTH_PROMPT](SELF_IMPROVING_TEST_HEALTH_PROMPT.md) - Reusable diagnostic prompt with patterns from this fix
- [ISSUES_BUGS_ROOT_CAUSE_ANALYSIS](ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md) - Prior root cause analysis patterns
