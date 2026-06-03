# SCIM Validator Run #32 - Successful False Positive Analysis

## Overview

**Target**: SCIMServer with Lexmark profile (endpoint `f265bbb8-9e7a-4aac-9136-6552510f5d05`)  
**Date**: 2026-03-19  
**Focus**: Tests that **PASSED** but where the server response contains RFC compliance issues the validator missed  
**RFC References**: [RFC 7643](https://datatracker.ietf.org/doc/html/rfc7643) (Core Schema), [RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644) (Protocol)

---

## Summary of Findings

| # | Test | False Positives Found | Severity |
|---|------|-----------------------|----------|
| 1 | Create duplicate → 409 | 0 | - |
| 2 | Filter existing user → 200 | 3 | Medium–High |
| 3 | Filter non-existing → 200 | 0 | - |
| 4 | Filter different case → 200 | 3 | Medium–High (same as #2) |
| 5 | PATCH userName → 200 | 3 | Medium–High |
| 6 | PATCH disable → 200 | 2 | Medium |
| 7 | DELETE verify → 404 | 0 | - |
| P1 | Multi-op PATCH different attrs | 1 | Low |
| P2 | Multi-op PATCH same attr | 1 | Low |
| P3 | DELETE non-existent → 404 | 0 | - |
| P4 | DELETE twice → 404 | 0 | - |
| **Total** | | **~7 unique issues** | |

---

## Issue Registry (Deduplicated)

### FP-1: Empty Extension Object `{}` in Response Body + `schemas[]` (MEDIUM-HIGH)

**Affects**: TEST 2, 4, 5, 6, P1, P2  
**RFC Citation**: RFC 7643 §3.1, §8.7.1  

**Observed**: The response always includes:
```json
"schemas": [
  "urn:ietf:params:scim:schemas:core:2.0:User",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  "urn:ietf:params:scim:schemas:extension:custom:2.0:User"
],
"urn:ietf:params:scim:schemas:extension:custom:2.0:User": {}
```

**Problem**: The Lexmark profile's custom extension defines only `badgeCode` (writeOnly/returned:never) and `pin` (writeOnly/returned:never). After `returned:never` stripping, the extension object becomes `{}`. The server:

1. **Includes the extension URN in `schemas[]`** even though no attributes from that extension are present in the response. RFC 7643 §3.1 states: *"The "schemas" attribute is a REQUIRED attribute and is an array of Strings containing URIs that are used to indicate the namespaces of the SCIM schemas"*. Including a schema URN whose corresponding object has zero attributes is misleading.

2. **Includes the empty `{}` object** in the response body. While not a hard protocol violation, it leaks information about the existence of a custom extension schema to clients and adds unnecessary payload bloat. A more compliant approach: if all attributes in an extension are `returned:never`, omit both the URN from `schemas[]` and the empty object from the body.

**Root Cause**: In `toScimUserResource()` ([endpoint-scim-users.service.ts#L612-L628](api/src/modules/scim/services/endpoint-scim-users.service.ts#L612-L628)), the code checks `if (urn in rawPayload)` and strips never-returned keys from inside the extension. But it never checks whether the extension became empty after stripping and does not remove it from `schemas[]` when empty.

**Validator Gap**: The validator checks whether `schemas[]` contains valid URNs but does not verify that each listed extension URN has at least one corresponding attribute in the response body.

---

### FP-2: `meta.location` Path Mismatch vs. Request URL (MEDIUM)

**Affects**: TEST 2, 4, 5, 6, P1, P2  
**RFC Citation**: RFC 7644 §3.1, RFC 7643 §3.1

**Observed**:
- Request URL: `/scim/endpoints/f265bbb8-.../Users` (no `/v2/`)
- `meta.location`: `https://scimserver2.../scim/v2/endpoints/f265bbb8-.../Users/...`

**Problem**: The `meta.location` URI contains `/scim/v2/` but the actual request was sent without `/v2/`. RFC 7644 §3.1 defines `meta.location` as *"the URI of the resource being returned"*. If a client uses the request URL path and the location path differs, the location is not canonically aligned with the client's view of the resource.

**Analysis**: This is a **deliberate design choice** - the server's `buildBaseUrl()` function ([base-url.util.ts#L12-L18](api/src/modules/scim/common/base-url.util.ts#L12-L18)) always advertises the RFC 7644 §3.13 versioned path `/scim/v2` as the canonical URL, while a rewrite middleware in `main.ts` accepts `/scim/v2/*` → `/scim/*`. Both paths resolve to the same resource. This is technically acceptable per RFC 7644 (the URI in `meta.location` is a canonical permalink), but it could confuse strict validators or clients that compare their request URL to the location.

**Severity**: Low-Medium. Not a strict violation since `/scim/v2/...` is a valid, dereferenceable URL that returns the same resource. However, it IS a deviation that a thorough validator should flag as a warning.

**Validator Gap**: The validator does not compare the `meta.location` URL path against the original request URL to verify consistency.

---

### FP-3: Missing `Location` Header on PATCH 200 Responses (LOW)

**Affects**: TEST 5, 6, P1, P2  
**RFC Citation**: RFC 7644 §3.5.2

**Observed**: PATCH responses return 200 with the full resource but without a `Location` response header.

**Analysis**: RFC 7644 §3.5.2 states the response to a successful PATCH is the modified resource as if a GET was issued. Unlike POST (201), the RFC does NOT require a `Location` header on PATCH responses. The server correctly provides `meta.location` in the body.

**Verdict**: **NOT a false positive** - `Location` header is only required on 201 Created. No issue here.

---

### FP-4: `version` Format `W/"v1"` / `W/"v2"` (LOW)

**Affects**: TEST 2, 4, 5, 6, P1, P2  
**RFC Citation**: RFC 7644 §3.14, RFC 7232 §2.3

**Observed**: `meta.version` and `ETag` header use `W/"v1"`, `W/"v2"`, etc.

**Analysis**: RFC 7644 §3.14 states: *"the Version attribute value MUST be the HTTPS ETag for the value"*. RFC 7232 §2.3 defines ETags as either strong (`"xyzzy"`) or weak (`W/"xyzzy"`). The format `W/"v1"` is a valid weak ETag - the `v` prefix is just a cosmetic choice, not a violation.

**Verdict**: **NOT a false positive** - the format is valid per HTTP ETag semantics.

---

### FP-5: `itemsPerPage: 0` When Empty Result (INFORMATIONAL)

**Affects**: TEST 3  
**RFC Citation**: RFC 7644 §3.4.2

**Observed**: `{"totalResults":0,"startIndex":1,"itemsPerPage":0,"Resources":[]}`

**Analysis**: The server sets `itemsPerPage` to the actual number of resources in the current page (`paginatedResources.length`). When there are 0 results, this correctly becomes 0. RFC 7644 §3.4.2 states `itemsPerPage` is *"the number of resources returned in a list response page"*, so 0 is semantically correct.

**Verdict**: **NOT a false positive** - fully compliant.

---

### FP-6: `Resources: []` Present in Empty ListResponse (INFORMATIONAL)

**Affects**: TEST 3  
**RFC Citation**: RFC 7644 §3.4.2

**Observed**: Empty result still includes `"Resources":[]`.

**Analysis**: RFC 7644 §3.4.2 Table 3 states the `Resources` attribute is `REQUIRED` when `totalResults` is non-zero. When `totalResults` is 0, including an empty array is acceptable (explicit vs. omitting it). This is the common implementation pattern and not a violation.

**Verdict**: **NOT a false positive** - acceptable and common practice.

---

### FP-7: Error Response `status` as String (INFORMATIONAL)

**Affects**: TEST 1, 7, P3, P4  
**RFC Citation**: RFC 7644 §3.12

**Observed**: `"status": "409"`, `"status": "404"`

**Analysis**: RFC 7644 §3.12 states the `status` attribute in error responses is *"The HTTP status code (see Section 6 of [RFC7231]) expressed as a JSON string."* - emphasis on **JSON string**. The server correctly returns status as a string, not a number.

**Verdict**: **NOT a false positive** - fully compliant.

---

### FP-8: `scimType: "noTarget"` for 404 Errors (INFORMATIONAL)

**Affects**: TEST 7, P3, P4  
**RFC Citation**: RFC 7644 §3.12 Table 9

**Observed**: `"scimType": "noTarget"` on 404 responses.

**Analysis**: RFC 7644 Table 9 does not list `noTarget` as a recognized `scimType` value. The closest match is no explicit type for 404. However, Table 9 states *"additional scimType values MAY be defined"*. The `noTarget` type is actually used in the PATCH operations spec in §3.5.2.2 for "the specified path did not yield an attribute", not for resource-level 404s.

**Severity**: Low. Using `noTarget` for a missing resource is a slight semantic mismatch (it's defined for PATCH path resolution failures in §3.5.2.2), but since custom scimType values are permitted, this is not a strict violation.

**Validator Gap**: The validator does not verify that `scimType` values are used in their correct semantic context per Table 9.

---

## Detailed Test-by-Test Analysis

### TEST 1: Create Duplicate User → 409 Conflict ✅ **No false positives**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "A resource with userName 'violette_mayert@towne.biz' already exists.",
  "scimType": "uniqueness",
  "status": "409"
}
```

| Check | Result | Notes |
|-------|--------|-------|
| Error schema URI | ✅ | Correct `urn:ietf:params:scim:api:messages:2.0:Error` |
| `status` as string | ✅ | `"409"` per RFC 7644 §3.12 |
| `scimType: "uniqueness"` | ✅ | Listed in Table 9 for 409 |
| `detail` present | ✅ | Descriptive message |
| Content-Type | ✅ | `application/scim+json; charset=utf-8` |

---

### TEST 2: Filter Existing User → 200 ⚠️ **3 false positives**

| Check | Result | Issue |
|-------|--------|-------|
| ListResponse schema | ✅ | Correct `urn:ietf:params:scim:api:messages:2.0:ListResponse` |
| `totalResults` / `itemsPerPage` | ✅ | Both 1, consistent |
| `startIndex: 1` | ✅ | 1-based per RFC 7644 §3.4.2 |
| Content-Type | ✅ | `application/scim+json; charset=utf-8` |
| `meta.resourceType` | ✅ | "User" |
| `meta.version` format | ✅ | Valid weak ETag `W/"v1"` |
| `meta.created` / `lastModified` | ✅ | ISO 8601 format |
| **Empty custom ext `{}`** | ⚠️ **FP-1** | `custom:2.0:User: {}` present in body and in `schemas[]` after all attrs stripped as returned:never |
| **Extension URN in `schemas[]`** | ⚠️ **FP-1** | URN declared but no attributes rendered |
| **`meta.location` path** | ⚠️ **FP-2** | Contains `/v2/` not present in request URL |

---

### TEST 3: Filter Non-existing User → 200 ✅ **No false positives**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 0,
  "startIndex": 1,
  "itemsPerPage": 0,
  "Resources": []
}
```

All fields correct. Empty array with `totalResults: 0` is acceptable.

---

### TEST 4: Filter Different Case → 200 ⚠️ **Same 3 false positives as TEST 2**

Same response structure as TEST 2 - issues FP-1 and FP-2 apply identically.

---

### TEST 5: PATCH User userName → 200 ⚠️ **3 false positives**

**Initial POST 201 response also exhibits FP-1** (empty custom ext), but the test is for the PATCH:

| Check | Result | Issue |
|-------|--------|-------|
| `userName` updated | ✅ | Changed from `ansel.keebler@orn.biz` → `tre@kautzer.uk` |
| `meta.lastModified` updated | ✅ | Changed from `.761Z` → `.011Z` |
| `meta.version` incremented | ✅ | `W/"v1"` → `W/"v2"` |
| `ETag` header matches version | ✅ | `ETag: W/"v2"` matches `meta.version` |
| Content-Type | ✅ | `application/scim+json; charset=utf-8` |
| `meta.created` unchanged | ✅ | Still `.761Z` |
| **Empty custom ext `{}`** | ⚠️ **FP-1** | `custom:2.0:User: {}` in both POST 201 and PATCH 200 |
| **Extension URN in `schemas[]`** | ⚠️ **FP-1** | Declared but no visible attributes |
| **`meta.location` path** | ⚠️ **FP-2** | `/v2/` in location but not in request |

**Additional note on POST 201**: The initial creation response also showed `custom:2.0:User: {}`, meaning `badgeCode` and `pin` values (if supplied in the POST body) were correctly stripped from the response (returned:never), but the empty shell was not cleaned up.

---

### TEST 6: PATCH Disable User → 200 ⚠️ **2 false positives**

| Check | Result | Issue |
|-------|--------|-------|
| `active: false` | ✅ | Correctly set to false |
| `meta.version` incremented | ✅ | `W/"v2"` |
| `ETag` matches | ✅ | Header `W/"v2"` matches body |
| Content-Type | ✅ | Correct |
| **Empty custom ext `{}`** | ⚠️ **FP-1** | Same issue |
| **`meta.location` path** | ⚠️ **FP-2** | Same issue |

---

### TEST 7: DELETE Verify → 404 ✅ **No false positives**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Resource c6b4c35b-cbe6-40c6-afc7-8566ae775128 not found.",
  "scimType": "noTarget",
  "status": "404"
}
```

| Check | Result | Notes |
|-------|--------|-------|
| Error schema | ✅ | Correct |
| 404 status string | ✅ | `"404"` |
| `scimType` | ⚠️ **FP-8** | See FP-8 - `noTarget` used for resource 404 is a minor semantic mismatch but not a strict violation |
| Content-Type | ✅ | Correct |

Note: `scimType` is OPTIONAL on error responses (RFC 7644 §3.12), so even the semantic mismatch is harmless.

---

### PREVIEW P1: Multi-op PATCH Different Attrs → 200 ⚠️ **1 false positive**

| Check | Result | Issue |
|-------|--------|-------|
| `preferredLanguage` absent | ✅ | Correctly removed |
| `externalId` present (added) | ✅ | Correct |
| `displayName` replaced | ✅ | Correct |
| **Empty custom ext `{}`** | ⚠️ **FP-1** | Same persistent issue |

**Note on `preferredLanguage` absence**: The attribute has `returned: "default"` in the schema. After a `remove` operation, the attribute no longer exists on the resource. Its absence from the response is correct - `returned: "default"` means it's returned when it has a value, not that a null placeholder must be present.

---

### PREVIEW P2: Multi-op PATCH Same Attr → 200 ⚠️ **1 false positive**

| Check | Result | Issue |
|-------|--------|-------|
| `externalId` has final value | ✅ | Correct sequential application (remove → add → replace) |
| **Empty custom ext `{}`** | ⚠️ **FP-1** | Same persistent issue |

---

### PREVIEW P3: DELETE Non-existent → 404 ✅ **No false positives**

Proper 404 error response with `scimType: "noTarget"`.

---

### PREVIEW P4: DELETE Same User Twice → 404 ✅ **No false positives**

Second DELETE correctly returns 404. (Note: RFC 7644 §3.6 says DELETE of already-deleted resource MAY return 404.)

---

## Consolidated Actionable Issues

### High Priority (should fix)

| ID | Issue | Occurrences | Fix |
|----|-------|-------------|-----|
| **FP-1** | Empty extension `{}` + URN in `schemas[]` after returned:never stripping | 8 of 11 tests | In `toScimUserResource()` (and equivalent Group/Generic methods): after stripping never-returned attrs from extension objects, check if the object is empty. If empty, remove the URN from `schemas[]` AND delete the empty object from the response payload. |

### Low Priority (cosmetic / edge-case)

| ID | Issue | Occurrences | Fix |
|----|-------|-------------|-----|
| **FP-2** | `meta.location` uses `/v2/` but request used non-`/v2/` path | All resource responses | By design - `buildBaseUrl()` always advertises `/scim/v2` as canonical. Consider documenting this or optionally deriving from the original request URL. |
| **FP-8** | `scimType: "noTarget"` on 404 resource lookups | 3 tests | Technically allowed (custom scimType values are permitted). Could omit `scimType` entirely on 404s for cleaner semantics, or keep as-is since many SCIM implementations use this pattern. |

---

## Validator Gaps Identified

The SCIM validator should be enhanced to detect:

1. **Schema/body consistency**: When `schemas[]` lists an extension URN, verify the response body contains a non-empty object for that URN
2. **meta.location vs request URL**: Compare the path segment of `meta.location` against the original request URL
3. **scimType semantic correctness**: Validate that scimType values are used in the correct context per RFC 7644 Table 9
4. **Empty extension object detection**: Flag `"urn:...:custom:2.0:User": {}` as suspicious
5. **POST 201 Location header verification**: Verify `Location` header is present AND matches `meta.location` value

---

## Proposed Code Fix for FP-1

In [endpoint-scim-users.service.ts](api/src/modules/scim/services/endpoint-scim-users.service.ts#L612-L628), after the never-returned stripping loop:

```typescript
// Current: unconditionally includes extension if urn exists in rawPayload
for (const urn of extensionUrns) {
  if (urn in rawPayload) {
    schemas.push(urn);
    // Strip never-returned attrs inside extension objects
    const extObj = rawPayload[urn];
    if (typeof extObj === 'object' && extObj !== null && !Array.isArray(extObj)) {
      for (const extKey of Object.keys(extObj as Record<string, unknown>)) {
        if (neverAttrs.has(extKey.toLowerCase())) {
          delete (extObj as Record<string, unknown>)[extKey];
        }
      }
    }
  }
}

// Proposed: add empty-check after stripping
for (const urn of extensionUrns) {
  if (urn in rawPayload) {
    const extObj = rawPayload[urn];
    if (typeof extObj === 'object' && extObj !== null && !Array.isArray(extObj)) {
      for (const extKey of Object.keys(extObj as Record<string, unknown>)) {
        if (neverAttrs.has(extKey.toLowerCase())) {
          delete (extObj as Record<string, unknown>)[extKey];
        }
      }
      // If extension is now empty after stripping, remove it entirely
      if (Object.keys(extObj as Record<string, unknown>).length === 0) {
        delete rawPayload[urn];
        continue; // don't add to schemas[]
      }
    }
    schemas.push(urn);
  }
}
```

The same fix should be applied to the equivalent methods in `endpoint-scim-groups.service.ts` and `endpoint-scim-generic.service.ts`.
