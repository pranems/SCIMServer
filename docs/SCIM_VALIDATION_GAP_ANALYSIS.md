# SCIM Validation Gap Analysis & Fix Plan

**Date**: February 6, 2026 (analysis) · February 9, 2026 (all fixes implemented)  
**Test Tool**: Microsoft SCIM Validator  
**Endpoint Under Test**: `http://localhost:6000/scim/endpoints/cml8l0ldv000ki0hiz6uzqxyp`  
**Source File**: `scim-results.json`

---

## Executive Summary

| Category        | Count | Status |
|-----------------|-------|--------|
| ✅ Passed       | 25    | All tests passing |
| ❌ Failed       | 0     | ~~13~~ → All fixed (Feb 9, 2026) |
| 🔍 Preview      | 7     | All passing (informational) |
| ⚠️ Warnings     | 0     | Content-Type header fixed |

> **🎉 FULLY COMPLIANT** — All 13 failures resolved on February 9, 2026. The 13 failures mapped to **8 distinct root-cause bugs** (A–H), all now fixed across 4 source files. 317 unit tests pass.

---

## ⚠️ Global Warning

> **Content-Type**: Responses return `application/json; charset=utf-8` instead of `application/scim+json; charset=utf-8` per RFC 7644 §3.1.

**Status**: ✅ **Fixed** — `ScimContentTypeInterceptor` created and registered globally.

---

## ✅ Passed Tests (25)

| # | Test Name | Method | Endpoint | Fixed? |
|---|-----------|--------|----------|--------|
| 1 | Create User | POST | `/Users` | — |
| 2 | Filter for existing user | GET | `/Users?filter=userName eq "..."` | — |
| 3 | Get User by ID | GET | `/Users/{id}` | — |
| 4 | Disable User | PATCH | `/Users/{id}` | — |
| 5 | Patch User – Add Attributes | PATCH | `/Users/{id}` | — |
| 6 | Delete User | DELETE | `/Users/{id}` | — |
| 7 | Create Group | POST | `/Groups` | — |
| 8 | Filter for existing group | GET | `/Groups?filter=displayName eq "..."` | — |
| 9 | Get Group by ID | GET | `/Groups/{id}` | — |
| 10 | Group – Add Member | PATCH | `/Groups/{id}` | — |
| 11 | Group – Remove Member | PATCH | `/Groups/{id}` | — |
| 12 | Delete Group | DELETE | `/Groups/{id}` | — |
| 13 | Patch User – Replace Attributes (valuePath) | PATCH | `/Users/{id}` | ✅ Bug C |
| 14 | Update User userName (no-path replace) | PATCH | `/Users/{id}` | ✅ Bug A |
| 15 | Patch User – Add Manager (enterprise ext) | PATCH | `/Users/{id}` | ✅ Bug D |
| 16 | Patch User – Replace Manager | PATCH | `/Users/{id}` | ✅ Bug D |
| 17 | Patch User – Remove Manager | PATCH | `/Users/{id}` | ✅ Bug D |
| 18 | Filter user with different case | GET | `/Users?filter=...` | ✅ Bug E |
| 19 | Filter group with different case | GET | `/Groups?filter=...` | ✅ Bug E |
| 20 | Get group by ID excluding members | GET | `/Groups/{id}?excludedAttributes=members` | ✅ Bug F |
| 21 | Filter group excluding members | GET | `/Groups?excludedAttributes=members` | ✅ Bug F |
| 22 | Create duplicate Group → 409 | POST | `/Groups` | ✅ Bug G |
| 23 | Patch Group – Replace Attributes (no-path) | PATCH | `/Groups/{id}` | ✅ Bug B |
| 24 | Update Group displayName | PATCH | `/Groups/{id}` | ✅ Bug B |
| 25 | Boolean serialization (roles[].primary) | GET | `/Users/{id}` | ✅ Bug H |

---

## ~~❌ Failed Tests (13)~~ → ✅ All Fixed (Feb 9, 2026) — Detailed Breakdown

> **All 13 failures below have been resolved.** Each section retains the original analysis for reference, with fix status noted.

---

### FAILURE #1: Patch User — Replace Attributes (valuePath not resolved)

**Test**: `PATCH /Users/Id` — "Patch User - Replace Attributes"

**Request**:
```http
PATCH /scim/endpoints/.../Users/8fac5053-... HTTP/1.1
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "emails[type eq \"work\"].value",
      "value": "lilian.graham@millszboncak.ca"
    },
    {
      "op": "replace",
      "path": "phoneNumbers[type eq \"work\"].value",
      "value": "07-272-0828"
    },
    {
      "op": "replace",
      "path": "addresses[type eq \"work\"].streetAddress",
      "value": "2809 Johns Walk"
    },
    {
      "op": "replace",
      "path": "addresses[type eq \"work\"].locality",
      "value": "KMYVNUJVVZWC"
    }
  ]
}
```

**Actual Response** (200 OK but wrong body):
```json
{
  "emails": [{"type":"work","value":"tressie@brown.com","primary":true}],
  "emails[type eq \"work\"].value": "lilian.graham@millszboncak.ca",
  "phoneNumbers[type eq \"work\"].value": "07-272-0828",
  "addresses[type eq \"work\"].streetAddress": "2809 Johns Walk",
  "addresses[type eq \"work\"].locality": "KMYVNUJVVZWC"
}
```

**Expected Response**: The `emails`, `phoneNumbers`, and `addresses` arrays should be updated **in-place** — matching the element where `type eq "work"` and modifying the specified sub-attribute:
```json
{
  "emails": [{"type":"work","value":"lilian.graham@millszboncak.ca","primary":true}],
  "phoneNumbers": [{"type":"work","value":"07-272-0828","primary":true}],
  "addresses": [{"type":"work","streetAddress":"2809 Johns Walk","locality":"KMYVNUJVVZWC","...":"..."}]
}
```

**Root Cause**: In `endpoint-scim-users.service.ts` line 326, the PATCH handler stores valuePath expressions as literal flat keys:
```typescript
// Current code (line 326):
} else if (originalPath) {
  rawPayload = { ...rawPayload, [originalPath]: operation.value };
}
```
There is **no valuePath parser** that interprets `emails[type eq "work"].value` into "find the email with type=work, set its value".

**Spec Reference**: RFC 7644 §3.5.2 — "If the target location specifies a complex attribute, a set of sub-attributes SHALL be specified..."

---

### FAILURE #2: Update User userName (no-path replace not updating DB fields)

**Test**: `PATCH /Users/Id` — "Update User userName"

**Request**:
```http
PATCH /scim/endpoints/.../Users/8fac5053-... HTTP/1.1
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "value": {
        "userName": "emilio@hermann.uk"
      }
    }
  ]
}
```

**Actual Response** (200 OK):
```json
{
  "userName": "ford_purdy@abernathypadberg.uk"
}
```
userName is **unchanged** — still shows the old value.

**Expected Response**:
```json
{
  "userName": "emilio@hermann.uk"
}
```

**Root Cause**: In `endpoint-scim-users.service.ts` line 327, the no-path replace branch spreads the value object into `rawPayload` but does **not** extract `userName` into the dedicated DB column:
```typescript
// Current code (line 327):
} else if (typeof operation.value === 'object' && operation.value !== null) {
  rawPayload = { ...rawPayload, ...operation.value };
}
```
The `userName` key ends up in `rawPayload`, but `stripReservedAttributes()` on line 358 later **removes** it. Meanwhile the local `userName` variable (which maps to the DB column) is never updated.

The correct pattern checks `!path` first and extracts `userName`, `externalId`, and `active` (as was done in the now-removed legacy `scim-users.service.ts`).

**Spec Reference**: RFC 7644 §3.5.2.3 — "If the target location is not specified, the operation is performed on the resource itself."

---

### FAILURE #3: Patch User — Add Manager (enterprise extension path stored as flat key)

**Test**: `PATCH /Users/Id` — "Patch User - Add Manager"

**Request**:
```http
PATCH /scim/endpoints/.../Users/8fac5053-... HTTP/1.1
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager",
      "value": {
        "value": "AXTKDLNRKMKT"
      }
    }
  ]
}
```

**Actual Response** (200 OK but wrong body):
```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "manager": {"value": "VTNXMVHLRYYD"}
  },
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager": {
    "value": "AXTKDLNRKMKT"
  }
}
```
The manager value appears **twice** — once correctly nested, once as a flat top-level key.

**Expected Response**:
```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "manager": {"value": "AXTKDLNRKMKT"}
  }
}
```

**Root Cause**: The PATCH handler treats `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager` as a literal key:
```typescript
rawPayload = { ...rawPayload, [originalPath]: operation.value };
```
It does not recognize the `urn:...:User:` prefix as the enterprise extension namespace and the suffix `manager` as an attribute within that namespace.

**Spec Reference**: RFC 7644 §3.10 — "For an attribute in a schema extension, the attribute name MUST be prefixed by the schema's URN."

---

### FAILURE #4: Patch User — Replace Manager

**Test**: `PATCH /Users/Id` — "Patch User - Replace Manager"

**Request**:
```http
PATCH /scim/endpoints/.../Users/8fac5053-... HTTP/1.1

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager",
      "value": {
        "value": "CBEQXYNPNAZS"
      }
    }
  ]
}
```

**Actual Response**: Same problem as Failure #3 — the path is stored as a flat key.

**Expected Response**: The `manager` key within `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` should be updated to `{"value": "CBEQXYNPNAZS"}`.

**Root Cause**: Same as Failure #3.

---

### FAILURE #5: Patch User — Remove Manager

**Test**: `PATCH /Users/Id` — "Patch User - Remove Manager"

**Request**:
```http
PATCH /scim/endpoints/.../Users/8fac5053-... HTTP/1.1

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "remove",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager"
    }
  ]
}
```

**Actual Response** (200 OK):
```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "manager": {"value": "CBEQXYNPNAZS"}
  },
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager": ""
}
```
The manager is NOT actually removed from the nested extension — only the flat key is set to `""`.

**Expected Response**:
```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "...",
    "department": "..."
  }
}
```
The `manager` key should be removed from the enterprise extension object entirely.

**Root Cause**: `removeAttribute()` only performs a top-level key match:
```typescript
private removeAttribute(payload, attribute) {
  const target = attribute.toLowerCase();
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => key.toLowerCase() !== target)
  );
}
```
This can't navigate into nested objects like the enterprise extension.

---

### FAILURE #6: Filter for existing user with different case

**Test**: `GET /Users?filter=` — "Filter for an existing user with a different case"

**Request**:
```http
GET /scim/endpoints/.../Users?filter=userName+eq+"FORD_PURDY@ABERNATHYPADBERG.UK" HTTP/1.1
```
(User was created with `userName = "ford_purdy@abernathypadberg.uk"` — lowercase)

**Actual Response** (200 OK):
```json
{
  "totalResults": 0,
  "Resources": []
}
```

**Expected Response**:
```json
{
  "totalResults": 1,
  "Resources": [{"userName": "ford_purdy@abernathypadberg.uk", "...": "..."}]
}
```

**Root Cause**: In `endpoint-scim-users.service.ts` line 236, the filter builds an exact-match Prisma query:
```typescript
case 'userName':
  return { userName: value };  // case-SENSITIVE
```
No `mode: 'insensitive'` option is used.

**Spec Reference**: RFC 7644 §3.4.2.2 — "Comparison of Strings is case insensitive unless the attribute type definition specifies a `caseExact` value of true."

---

### FAILURE #7: Filter for existing group with different case

**Test**: `GET /Groups?filter=` — "Filter for an existing group with a different case"

**Request**:
```http
GET /scim/endpoints/.../Groups?filter=displayName+eq+"uhyywkurutzs" HTTP/1.1
```
(Group was created with `displayName = "UHYYWKURUTZS"` — uppercase)

**Actual Response** (200 OK):
```json
{
  "totalResults": 0,
  "Resources": []
}
```

**Expected Response**: `totalResults: 1` with the matching group.

**Root Cause**: In `endpoint-scim-groups.service.ts` line 289, same issue:
```typescript
return { displayName: match[2] };  // case-SENSITIVE
```

**Spec Reference**: Same as Failure #6.

---

### FAILURE #8: Get group by ID excluding members

**Test**: `GET /Groups/Id` — "Get group by id excluding members"

**Request**:
```http
GET /scim/endpoints/.../Groups/ad398df1-...?excludedAttributes=members HTTP/1.1
```

**Actual Response** (200 OK):
```json
{
  "displayName": "UHYYWKURUTZS",
  "members": []
}
```
The `members` field is **still present** despite `?excludedAttributes=members`.

**Expected Response**:
```json
{
  "displayName": "UHYYWKURUTZS"
}
```
The `members` key should be **absent** from the response.

**Root Cause**: `excludedAttributes` query parameter is not implemented anywhere in the codebase. A grep for `excludedAttributes` across all source files returns **zero results**.

**Spec Reference**: RFC 7644 §3.4.2.5 — "When specified, each resource returned MUST NOT contain the attributes listed."

---

### FAILURE #9: Filter for existing group excluding members

**Test**: `GET /Groups?filter=` — "Filter for existing group excluding members"

**Request**:
```http
GET /scim/endpoints/.../Groups?excludedAttributes=members&filter=displayName+eq+"UHYYWKURUTZS" HTTP/1.1
```

**Actual Response**: Same as #8 — `members` still present.

**Expected Response**: Group(s) returned WITHOUT the `members` attribute.

**Root Cause**: Same as Failure #8 — `excludedAttributes` not implemented.

---

### FAILURE #10: Create a duplicate Group

**Test**: `POST /Groups` — "Create a duplicate Group"

**Request**:
```http
POST /scim/endpoints/.../Groups HTTP/1.1
Content-Type: application/scim+json; charset=utf-8

{
  "displayName": "HNNCQLVVWAJM",
  "externalId": "c420a4bf-cb0d-415a-98ff-bb3c12b0b2e3",
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"]
}
```
(A group with the same `displayName` was already created by a previous test)

**Actual Response** (201 Created):
```json
{
  "id": "c2052468-...",
  "displayName": "HNNCQLVVWAJM",
  "members": [],
  "externalId": "c420a4bf-..."
}
```
The duplicate group was **created successfully** instead of being rejected.

**Expected Response** (409 Conflict):
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "A resource with displayName 'HNNCQLVVWAJM' already exists.",
  "scimType": "uniqueness",
  "status": 409
}
```

**Root Cause**: In `endpoint-scim-groups.service.ts` line 51, `createGroupForEndpoint()` has **no uniqueness check** on `displayName` or `externalId` before creation. The User service has `assertUniqueIdentifiersForEndpoint()` but the Group service does not.

Additionally, the `ScimGroup` Prisma model has no `externalId` DB column — `externalId` is stored inside `rawPayload`, making it impossible to enforce uniqueness at the DB level.

**Spec Reference**: RFC 7644 §3.3 — "If the service provider determines that the creation of the requested resource conflicts with existing resources... the service provider MUST return HTTP status code 409."

---

### FAILURE #11: Patch Group — Replace Attributes (no-path replace with object value)

**Test**: `PATCH /Groups/Id` — "Patch Group - Replace Attributes"

**Request**:
```http
PATCH /scim/endpoints/.../Groups/365c807e-... HTTP/1.1
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "value": {
        "externalId": "c3b97a69-ee33-427b-8bc1-d661b7769314"
      }
    }
  ]
}
```
Note: No `path` field — the value is an **object** with the attribute(s) to replace.

**Actual Response** (400 BadRequest):
```json
{
  "detail": "Replace operation for displayName requires a string value.",
  "scimType": "invalidValue",
  "status": 400
}
```

**Expected Response** (200 OK): The group's `externalId` should be updated to the new value.

**Root Cause**: In `endpoint-scim-groups.service.ts` line 307, `handleReplace()` when `path` is missing assumes the value must be a `displayName` string:
```typescript
if (!path || path === 'displayname') {
  if (typeof operation.value !== 'string') {
    throw createScimError({
      status: 400,
      scimType: 'invalidValue',
      detail: 'Replace operation for displayName requires a string value.'
    });
  }
}
```
When there's no path and the value is an **object** (like `{"externalId": "..."}` or `{"displayName": "..."}`), this immediately throws a 400 instead of processing the object's keys.

---

### FAILURE #12: Update Group displayName

**Test**: `PATCH /Groups/Id` — "Update Group displayName"

**Request**:
```http
PATCH /scim/endpoints/.../Groups/d53ff890-... HTTP/1.1
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "value": {
        "displayName": "MSADPJJZWBUS"
      }
    }
  ]
}
```
Note: Same no-path pattern — value is an object `{"displayName": "MSADPJJZWBUS"}`.

**Actual Response** (400 BadRequest):
```json
{
  "detail": "Replace operation for displayName requires a string value.",
  "scimType": "invalidValue",
  "status": 400
}
```

**Expected Response** (200 OK): The group's `displayName` should be updated to `"MSADPJJZWBUS"`.

**Root Cause**: Same as Failure #11.

---

### FAILURE #13: Boolean serialization — roles[].primary

**Note**: This failure is embedded as a deserialization **warning** in multiple test runs. The Microsoft SCIM validator reports:

> `The value 'True' cannot be parsed as the type 'Boolean'`

The service returns `roles[].primary` as the string `"True"` instead of boolean `true`.

**Example from response**:
```json
"roles": [{
  "primary": "True",
  "display": "KEGJDMBTZXPD",
  "value": "YFPHYSVYNPPK",
  "type": "ABDRTDIQFQMG"
}]
```

**Expected**:
```json
"roles": [{
  "primary": true,
  "display": "KEGJDMBTZXPD",
  "value": "YFPHYSVYNPPK",
  "type": "ABDRTDIQFQMG"
}]
```

**Root Cause**: The `roles` attribute is not defined in the `ScimUserResource` TypeScript interface — it flows through the `rawPayload` spread with no type coercion. The client sends `"True"` (string) and it's stored and returned as-is.

**Spec Reference**: RFC 7643 §2.3.6 — `primary` is defined as a Boolean (JSON `true`/`false`).

---

## 🔍 Preview Tests (7) — All Passing ✅

| # | Test Name | Status |
|---|-----------|--------|
| 1 | Patch User – Multiple Ops on different attributes | ✅ |
| 2 | Patch User – Multiple Ops on same attribute | ✅ |
| 3 | Delete a non-existent User | ✅ |
| 4 | Delete the same User twice | ✅ |
| 5 | Patch Group – Multiple Ops on same attribute | ✅ |
| 6 | Delete a non-existent Group | ✅ |
| 7 | Delete the same Group twice | ✅ |

---

## 🔁 Root-Cause to Failure Mapping

| Root Cause | Failures | Tests Fixed | Status |
|------------|----------|-------------|--------|
| **A.** No-path PATCH replace not resolving dot-notation / URN keys (Users) | #2 | 1 | ✅ Fixed — `resolveNoPathValue()` in `scim-patch-path.ts` |
| **B.** No-path PATCH replace + stale rawPayload displayName (Groups) | #11, #12 | 2 | ✅ Fixed — `toScimGroupResource()` deletes stale keys |
| **C.** ValuePath `add` not creating array/element when missing | #1 | 1 | ✅ Fixed — `addValuePathEntry()` in `scim-patch-path.ts` |
| **D.** Enterprise extension manager stored as string not `{value}` object | #3, #4, #5 | 3 | ✅ Fixed — `applyExtensionUpdate()` wraps manager as `{value}` |
| **E.** Case-insensitive filter not working (SQLite limitation) | #6, #7 | 2 | ✅ Fixed — in-code filtering with `.toLowerCase()` |
| **F.** `excludedAttributes` not implemented for Groups | #8, #9 | 2 | ✅ Fixed — `stripExcludedAttributes()` in groups controller |
| **G.** Duplicate group creation not rejected | #10 | 1 | ✅ Fixed — `assertUniqueDisplayName()` returns 409 |
| **H.** `roles[].primary` returned as string `"True"` not boolean | #13 | 1 | ✅ Fixed — `sanitizeBooleanStrings()` recursive coercion |
| | | **Total: 13** | **All ✅** |

---

## 📋 Holistic Task List & Proposed Fixes

### Task 1: Fix no-path PATCH replace for Users (Bug A)
**Priority**: P0 — Affects 1 test  
**File**: `api/src/modules/scim/services/endpoint-scim-users.service.ts` (line ~327)  
**Effort**: Low  

| Metric | Estimate |
|--------|----------|
| Dev Time | 1–2 hours |
| Lines Changed | ~15 lines (1 file) |
| Testing | ~1 hour (add 3–4 unit tests for no-path replace with userName/externalId/active) |
| Risk | Low — mirrors proven logic from the original PATCH implementation |
| Dependencies | None |

**Current Code**:
```typescript
} else if (typeof operation.value === 'object' && operation.value !== null) {
  rawPayload = { ...rawPayload, ...operation.value };
}
```

**Proposed Fix**:
Add the `!path` guard and extract `userName`, `externalId`, and `active` from the value object before spreading — matching the legacy service logic:
```typescript
} else if (!path && typeof operation.value === 'object' && operation.value !== null) {
  const updateObj = { ...(operation.value as Record<string, unknown>) };
  if ('userName' in updateObj) {
    userName = this.extractStringValue(updateObj.userName, 'userName');
    delete updateObj.userName;
  }
  if ('externalId' in updateObj) {
    externalId = this.extractNullableStringValue(updateObj.externalId, 'externalId');
    delete updateObj.externalId;
  }
  if ('active' in updateObj) {
    active = this.extractBooleanValue(updateObj.active);
    delete updateObj.active;
  }
  rawPayload = { ...rawPayload, ...updateObj };
}
```

---

### Task 2: Fix no-path PATCH replace for Groups (Bug B)
**Priority**: P0 — Affects 2 tests  
**File**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts` (line ~307)  
**Effort**: Medium  

| Metric | Estimate |
|--------|----------|
| Dev Time | 2–3 hours |
| Lines Changed | ~30–40 lines (1 file — `handleReplace` + `patchGroupForEndpoint` caller) |
| Testing | ~1.5 hours (add 4–5 unit tests: no-path with displayName object, externalId object, mixed object, members object, invalid) |
| Risk | Medium — requires changing the return type of `handleReplace()` to include `additionalAttributes` and updating the caller to persist them into `rawPayload` |
| Dependencies | None |

**Current Code**:
```typescript
if (!path || path === 'displayname') {
  if (typeof operation.value !== 'string') {
    throw createScimError({ ... });
  }
  return { displayName: operation.value, members };
}
```

**Proposed Fix**:
Handle the no-path case where value is an object by extracting `displayName`, `externalId`, and `members` from the object:
```typescript
if (!path) {
  if (typeof operation.value === 'string') {
    return { displayName: operation.value, members };
  }
  if (typeof operation.value === 'object' && operation.value !== null) {
    const obj = operation.value as Record<string, unknown>;
    const newDisplayName = typeof obj.displayName === 'string'
      ? obj.displayName : currentDisplayName;
    let newMembers = members;
    if (Array.isArray(obj.members)) {
      newMembers = (obj.members as unknown[]).map(m => this.toMemberDto(m));
      newMembers = this.ensureUniqueMembers(newMembers);
    }
    // Store remaining attributes (externalId, etc.) in rawPayload via caller
    return { displayName: newDisplayName, members: newMembers, additionalAttributes: obj };
  }
  throw createScimError({ ... });
}
if (path === 'displayname') {
  if (typeof operation.value !== 'string') {
    throw createScimError({ ... });
  }
  return { displayName: operation.value, members };
}
```
Also update `patchGroupForEndpoint()` to persist `externalId` and other attributes from `additionalAttributes` into `rawPayload`.

---

### Task 3: Implement valuePath parser for PATCH operations (Bug C)
**Priority**: P0 — Affects 1 test  
**File**: New utility + `endpoint-scim-users.service.ts`  
**Effort**: High  

| Metric | Estimate |
|--------|----------|
| Dev Time | 4–6 hours |
| Lines Changed | ~80–120 lines (new `scim-path-parser.ts` ~60 lines + service integration ~30 lines + tests) |
| Testing | ~2–3 hours (parser unit tests for `emails[type eq "work"].value`, `addresses[type eq "work"].streetAddress`, edge cases like missing array, no match, nested brackets) |
| Risk | High — this is new logic with complex string parsing; must handle quoted values, multiple filter operators, and attribute case-insensitivity. Most impactful single change. |
| Dependencies | None, but Task 4 can reuse the parser infrastructure |

**Proposed Fix**:
Create a `valuePath` parser utility that can interpret SCIM path filter expressions:

1. Create `api/src/modules/scim/utils/scim-path-parser.ts`:
   - Parse paths like `emails[type eq "work"].value` into:
     - `attribute`: `emails`
     - `filter`: `{ type: "work" }`
     - `subAttribute`: `value`
   - Also handle simple paths like `displayName` (no filter)

2. In the PATCH handler's `else if (originalPath)` branch:
   - Check if the path contains a `[` bracket (indicating a valuePath filter)
   - If yes, use the parser to find the matching element in the multi-valued attribute array and update its sub-attribute in place
   - If no brackets, use the current literal key behavior

**Pseudocode**:
```typescript
if (originalPath && originalPath.includes('[')) {
  const { attribute, filterExpr, subAttribute } = parseScimPath(originalPath);
  const arr = (rawPayload[attribute] as unknown[]) ?? [];
  const matchIdx = arr.findIndex(item => matchesFilter(item, filterExpr));
  if (matchIdx >= 0) {
    (arr[matchIdx] as Record<string, unknown>)[subAttribute] = operation.value;
  }
  rawPayload[attribute] = arr;
} else if (originalPath) {
  rawPayload = { ...rawPayload, [originalPath]: operation.value };
}
```

---

### Task 4: Implement enterprise extension URN path resolution (Bug D)
**Priority**: P0 — Affects 3 tests  
**File**: `endpoint-scim-users.service.ts` + path parser from Task 3  
**Effort**: Medium  

| Metric | Estimate |
|--------|----------|
| Dev Time | 2–3 hours |
| Lines Changed | ~25–35 lines (add URN prefix detection in PATCH add/replace/remove branches) |
| Testing | ~1.5 hours (add 4–5 unit tests: add manager, replace manager, remove manager, nested sub-attribute, unknown extension) |
| Risk | Medium — must handle both add/replace and remove operations differently; also need to update `removeAttribute()` or add URN-aware path in the remove branch |
| Dependencies | Builds on Task 3 path parser infrastructure (can share URN detection logic) |

**Proposed Fix**:
Extend the PATCH handler to detect enterprise extension URN prefixes:

1. Detect if a path starts with `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:`
2. Extract the suffix (e.g., `manager`) as the target attribute
3. Navigate into `rawPayload["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"]` and add/replace/remove the attribute there

```typescript
const ENTERPRISE_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

if (originalPath?.startsWith(ENTERPRISE_URN + ':')) {
  const subAttr = originalPath.slice(ENTERPRISE_URN.length + 1); // e.g., "manager"
  const ext = (rawPayload[ENTERPRISE_URN] as Record<string, unknown>) ?? {};

  if (op === 'remove') {
    delete ext[subAttr];
  } else {
    ext[subAttr] = operation.value;
  }
  rawPayload[ENTERPRISE_URN] = ext;
}
```

For `remove`, also update `removeAttribute()` or bypass it entirely for URN paths.

---

### Task 5: Implement case-insensitive filter `eq` operator (Bug E)
**Priority**: P1 — Affects 2 tests  
**File**: `endpoint-scim-users.service.ts` (line ~236) and `endpoint-scim-groups.service.ts` (line ~289)  
**Effort**: Low  

| Metric | Estimate |
|--------|----------|
| Dev Time | 1–2 hours |
| Lines Changed | ~6–10 lines (2 files — change 3 Prisma filter expressions) |
| Testing | ~1 hour (add 2–3 unit tests: uppercase userName filter, lowercase displayName filter, mixed case) |
| Risk | Low-Medium — depends on database provider; Prisma `mode: 'insensitive'` works natively on PostgreSQL but may need a fallback for SQLite dev environments |
| Dependencies | None |

**Current Code (Users)**:
```typescript
case 'userName':
  return { userName: value };
```

**Current Code (Groups)**:
```typescript
return { displayName: match[2] };
```

**Proposed Fix**: Use Prisma's `mode: 'insensitive'` for string comparisons:

```typescript
// Users
case 'userName':
  return { userName: { equals: value, mode: 'insensitive' } };
case 'externalId':
  return { externalId: { equals: value, mode: 'insensitive' } };

// Groups
return { displayName: { equals: match[2], mode: 'insensitive' } };
```

**Note**: If using SQLite (development), `mode: 'insensitive'` may not be supported natively. An alternative is to use raw queries with `LOWER()` or configure the database collation. For PostgreSQL in production, Prisma's `insensitive` mode works directly.

**Fallback for SQLite**:
```typescript
case 'userName':
  return {
    userName: {
      equals: value,
      mode: Prisma.QueryMode.insensitive
    }
  };
```
If SQLite doesn't support this, use a raw query:
```typescript
// Or use Prisma's contains with startsWith/endsWith workaround
return { userName: { contains: value } }; // Not ideal
```
Best approach: switch dev database to PostgreSQL or add a `userNameLower` indexed column.

---

### Task 6: Implement `excludedAttributes` query parameter (Bug F)
**Priority**: P1 — Affects 2 tests  
**Files**: `endpoint-scim-users.controller.ts`, `endpoint-scim-groups.controller.ts`, user/group service files  
**Effort**: Medium  

| Metric | Estimate |
|--------|----------|
| Dev Time | 2–3 hours |
| Lines Changed | ~30–40 lines (new utility function ~15 lines + controller `@Query` params ~10 lines + service call-site wiring ~10 lines across 2–3 files) |
| Testing | ~1.5 hours (add 3–4 unit tests: exclude members, exclude multiple attrs, exclude non-existent attr, ensure `meta`/`schemas`/`id` are never excluded) |
| Risk | Low — straightforward post-serialization filtering; main consideration is ensuring `attributes` (include) and `excludedAttributes` (exclude) don't conflict per RFC 7644 §3.4.2.5 |
| Dependencies | None |

**Proposed Fix**:

1. **Controller**: Add `@Query('excludedAttributes')` parameter to `getGroup`, `listGroups`, `getUser`, `listUsers` endpoints.

2. **Service/Serialization**: After building the response object, strip any attributes listed in `excludedAttributes`:

```typescript
function applyExcludedAttributes<T extends Record<string, unknown>>(
  resource: T,
  excludedAttributes?: string
): T {
  if (!excludedAttributes) return resource;

  const excluded = new Set(
    excludedAttributes.split(',').map(a => a.trim().toLowerCase())
  );
  return Object.fromEntries(
    Object.entries(resource).filter(([key]) => !excluded.has(key.toLowerCase()))
  ) as T;
}
```

3. Apply to both individual resource responses and list response `Resources[]` arrays.

---

### Task 7: Implement duplicate group detection (Bug G)
**Priority**: P2 — Affects 1 test  
**File**: `endpoint-scim-groups.service.ts` (line ~51)  
**Effort**: Low  

| Metric | Estimate |
|--------|----------|
| Dev Time | 1–2 hours |
| Lines Changed | ~20–25 lines (new `assertUniqueGroupForEndpoint()` method + call in `createGroupForEndpoint`) |
| Testing | ~1 hour (add 2–3 unit tests: duplicate displayName → 409, duplicate externalId → 409, unique group → 201) |
| Risk | Low — mirrors proven pattern from user service; note that `externalId` uniqueness check requires scanning `rawPayload` since there's no DB column (optional enhancement: add DB migration for `externalId` column) |
| Dependencies | None (optional: Prisma migration for `externalId` column) |

**Proposed Fix**:
Add an `assertUniqueGroup()` check before creating a group, similar to the user service's `assertUniqueIdentifiersForEndpoint()`:

```typescript
private async assertUniqueGroupForEndpoint(
  displayName: string,
  externalId: string | undefined,
  endpointId: string,
  excludeScimId?: string
): Promise<void> {
  const conditions: Prisma.ScimGroupWhereInput[] = [{ displayName, endpointId }];

  // Also check externalId in rawPayload if provided
  // (requires extracting from rawPayload since there's no DB column)

  const existing = await this.prisma.scimGroup.findFirst({
    where: {
      endpointId,
      OR: conditions,
      ...(excludeScimId ? { NOT: { scimId: excludeScimId } } : {})
    }
  });

  if (existing) {
    throw createScimError({
      status: 409,
      scimType: 'uniqueness',
      detail: `A resource with displayName '${displayName}' already exists.`
    });
  }
}
```

Call this before `this.prisma.scimGroup.create(...)` in `createGroupForEndpoint()`.

**Enhancement**: Consider adding an `externalId` column to the `ScimGroup` Prisma model (with a migration) for proper DB-level uniqueness constraints.

---

### Task 8: Coerce `roles[].primary` to boolean on storage (Bug H)
**Priority**: P2 — Affects 1 test  
**File**: `endpoint-scim-users.service.ts` (serialization/storage)  
**Effort**: Low  

| Metric | Estimate |
|--------|----------|
| Dev Time | 1–1.5 hours |
| Lines Changed | ~20–25 lines (new `normalizeMultiValuedAttributes()` method + calls in create and patch flows) |
| Testing | ~1 hour (add 2–3 unit tests: string "True" → boolean true, string "False" → boolean false, already-boolean passthrough) |
| Risk | Low — pure data transformation with no side effects; applied at storage time so existing data in DB still returns string until re-saved |
| Dependencies | None |

**Proposed Fix**:
Add a normalization step in `extractAdditionalAttributes()` or `toScimUserResource()` that coerces `primary` fields in multi-valued attributes (`emails`, `addresses`, `phoneNumbers`, `roles`, `ims`, `photos`, `entitlements`, `x509Certificates`) to boolean:

```typescript
private normalizeMultiValuedAttributes(payload: Record<string, unknown>): Record<string, unknown> {
  const multiValuedKeys = [
    'emails', 'addresses', 'phoneNumbers', 'roles', 
    'ims', 'photos', 'entitlements', 'x509Certificates'
  ];

  for (const key of multiValuedKeys) {
    const arr = payload[key];
    if (Array.isArray(arr)) {
      payload[key] = arr.map(item => {
        if (typeof item === 'object' && item !== null && 'primary' in item) {
          const obj = item as Record<string, unknown>;
          if (typeof obj.primary === 'string') {
            obj.primary = obj.primary.toLowerCase() === 'true';
          }
        }
        return item;
      });
    }
  }

  return payload;
}
```

Call this during both **create** (in `extractAdditionalAttributes`) and **patch** (before storing rawPayload).

---

## 📊 Implementation Roadmap

### Phase 1 — Critical PATCH Fixes (fixes 7 tests)
| Task | Bug | Tests Fixed | Dev Time | Test Time | LOC Changed | Risk |
|------|-----|-------------|----------|-----------|-------------|------|
| Task 1: No-path PATCH replace for Users | A | #2 | 1–2 hrs | 1 hr | ~15 | Low |
| Task 2: No-path PATCH replace for Groups | B | #11, #12 | 2–3 hrs | 1.5 hrs | ~30–40 | Medium |
| Task 3: ValuePath parser | C | #1 | 4–6 hrs | 2–3 hrs | ~80–120 | High |
| Task 4: Enterprise extension URN resolution | D | #3, #4, #5 | 2–3 hrs | 1.5 hrs | ~25–35 | Medium |
| | | **Subtotal** | **9–14 hrs** | **6–7.5 hrs** | **~150–210** | |

### Phase 2 — Query & Filter Compliance (fixes 4 tests)
| Task | Bug | Tests Fixed | Dev Time | Test Time | LOC Changed | Risk |
|------|-----|-------------|----------|-----------|-------------|------|
| Task 5: Case-insensitive filters | E | #6, #7 | 1–2 hrs | 1 hr | ~6–10 | Low-Med |
| Task 6: `excludedAttributes` parameter | F | #8, #9 | 2–3 hrs | 1.5 hrs | ~30–40 | Low |
| | | **Subtotal** | **3–5 hrs** | **2.5 hrs** | **~36–50** | |

### Phase 3 — Data Integrity & Serialization (fixes 2 tests)
| Task | Bug | Tests Fixed | Dev Time | Test Time | LOC Changed | Risk |
|------|-----|-------------|----------|-----------|-------------|------|
| Task 7: Duplicate group detection | G | #10 | 1–2 hrs | 1 hr | ~20–25 | Low |
| Task 8: Boolean coercion for `primary` | H | #13 | 1–1.5 hrs | 1 hr | ~20–25 | Low |
| | | **Subtotal** | **2–3.5 hrs** | **2 hrs** | **~40–50** | |

### 📊 Overall Totals
| Metric | Estimate |
|--------|----------|
| **Total Dev Time** | **14–22.5 hours** (~2–3 days) |
| **Total Test Time** | **10.5–12 hours** (~1.5–2 days) |
| **Total LOC Changed** | **~226–310 lines** across ~5–6 files |
| **New Files** | 1 (`scim-path-parser.ts`) + 1 test file (`scim-path-parser.spec.ts`) |
| **New Unit Tests** | ~20–27 test cases |
| **End-to-End Duration** | **3–5 working days** (dev + test + validation) |

---

## 📄 Key Source Files Reference

| File | What it does |
|------|-------------|
| `api/src/modules/scim/services/endpoint-scim-users.service.ts` | User CRUD + PATCH operations (endpoint-scoped) |
| `api/src/modules/scim/services/endpoint-scim-groups.service.ts` | Group CRUD + PATCH operations (endpoint-scoped) |
| `api/src/modules/scim/controllers/endpoint-scim-users.controller.ts` | REST controller routing SCIM User endpoints |
| `api/src/modules/scim/controllers/endpoint-scim-groups.controller.ts` | REST controller routing SCIM Group + metadata endpoints |
| `api/src/modules/scim/controllers/admin.controller.ts` | Admin operations (manual user/group creation, logs, version) |
| `api/src/modules/scim/interceptors/scim-content-type.interceptor.ts` | Content-Type header fix (already deployed) |
| `api/prisma/schema.prisma` | Database schema (ScimUser, ScimGroup models) |

---

## ✅ Post-Fix Validation Checklist

All items completed February 9, 2026:

- [x] Run `npm test` — all 317 unit tests pass (11 suites, 0 failures)
- [x] Run Microsoft SCIM Validator — target 25/25 tests passing
- [x] Verify `Content-Type: application/scim+json; charset=utf-8` header in all responses
- [x] Verify case-insensitive filtering works for both Users and Groups
- [x] Verify `excludedAttributes=members` strips members from Group responses
- [x] Verify duplicate Group creation returns `409 Conflict`
- [x] Verify `roles[].primary` returns boolean `true`/`false` not string
- [x] Verify enterprise extension PATCH add/replace/remove works correctly
- [x] Verify valuePath PATCH operations update nested attributes in-place
- [x] Verify no-path PATCH replace updates both DB columns and rawPayload
- [x] Update `Session_starter.md` with completion status
- [x] Update `docs/SCIM_2.0_COMPLIANCE_ANALYSIS.md` with new compliance scores
