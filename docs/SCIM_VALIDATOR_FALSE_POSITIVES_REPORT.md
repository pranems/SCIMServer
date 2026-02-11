# SCIM Validator Analysis Report — scim-results-9.json

**Date:** February 11, 2026 (Revised v4 — FP #4 identified & fixed)  
**Source:** `scim-results-9.json` + `scim-results (10).json` — Microsoft SCIM Validator  
**Server:** SCIMTool2022 v0.8.15 → v0.8.17 (NestJS + Prisma + SQLite)  
**Endpoint:** `http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/`

---

## Executive Summary

| Category       | Count |
|----------------|-------|
| Passed Tests   | 24    |
| Failed Tests   | 0     |
| Preview Tests  | 7     |
| Warnings       | 0     |
| `SFComplianceFailed` | `false` |

The validator reports **24/24 passed, 0 failed, 7 preview** with no warnings. A detailed inspection of every captured request/response reveals **4 categories of suspected false positives** where the validator marks tests as **pass despite RFC 7644-inconsistent server behavior**. The validator does not check error response formatting, PATCH response body presence, attribute-removal semantics, or HTTP `Location` header on 201 Created.

### Correction from v1 Report

The v1 report listed "DELETE tests returning 404" as a false positive. **This was inaccurate.** The validator's DELETE tests use a multi-step flow: the actual DELETE returns `204 No Content` (correct per RFC 7644 §3.6), and the validator then issues a verification GET that returns 404 to confirm deletion. The 404 is the expected verification result, not a failed delete. This is confirmed by the "Delete the same User twice" preview test which records `InitialResponseStatuses: ["201 Created", "204 NoContent"]`.

---

## Complete Test Inventory

### All 24 Passed Tests

| # | Test Name | HTTP Method | Final Response | Content-Type | Issues |
|---|-----------|-------------|----------------|--------------|--------|
| 1 | Create a new User | POST → GET verify | 200 OK | `application/scim+json` | ✅ Clean |
| 2 | Create a duplicate User | POST | 409 Conflict | ⚠️ `application/json` | **FP #1** |
| 3 | Filter for an existing user | GET filter | 200 OK | `application/scim+json` | ✅ Clean |
| 4 | Filter for a non-existing user | GET filter | 200 OK | `application/scim+json` | ✅ Clean |
| 5 | Filter for an existing user with a different case | GET filter | 200 OK | `application/scim+json` | ✅ Clean |
| 6 | Patch User - Replace Attributes Verbose | PATCH | 200 OK | `application/scim+json` | ✅ Clean |
| 7 | Update User userName | PATCH | 200 OK | `application/scim+json` | ✅ Clean |
| 8 | Patch User - Disable User | PATCH | 200 OK | `application/scim+json` | ✅ Clean |
| 9 | Patch User - Add Manager | PATCH | 200 OK | `application/scim+json` | ✅ Clean |
| 10 | Patch User - Replace Manager | PATCH | 200 OK | `application/scim+json` | ✅ Clean |
| 11 | Patch User - Remove Manager | PATCH | 200 OK | `application/scim+json` | **FP #3** |
| 12 | Delete a User | DELETE → GET verify | 404 NotFound | ⚠️ `application/json` | **FP #1** |
| 13 | Get group by id excluding members | GET | 200 OK | `application/scim+json` | ✅ Clean |
| 14 | Filter for existing group excluding members | GET filter | 200 OK | `application/scim+json` | ✅ Clean |
| 15 | Filter for an existing group | GET filter | 200 OK | `application/scim+json` | ✅ Clean |
| 16 | Filter for a non-existing group | GET filter | 200 OK | `application/scim+json` | ✅ Clean |
| 17 | Filter for existing group different case | GET filter | 200 OK | `application/scim+json` | ✅ Clean |
| 18 | Create a new Group | POST | 201 Created | `application/scim+json` | **FP #4** |
| 19 | Create a duplicate Group | POST | 409 Conflict | ⚠️ `application/json` | **FP #1** |
| 20 | Patch Group - Replace Attributes | PATCH | 200 OK (empty) | `application/scim+json` | **FP #2** |
| 21 | Update Group displayName | PATCH | 200 OK (empty) | `application/scim+json` | **FP #2** |
| 22 | Patch Group - Add Member | PATCH | 200 OK (empty) | `application/scim+json` | **FP #2** |
| 23 | Patch Group - Remove Member | PATCH | 200 OK (empty) | `application/scim+json` | **FP #2** |
| 24 | Delete a Group | DELETE → GET verify | 404 NotFound | ⚠️ `application/json` | **FP #1** |

### All 7 Preview Tests

| # | Test Name | Final Response | Content-Type | Issues |
|---|-----------|----------------|--------------|--------|
| 1 | Patch User - Multiple Ops different attrs | 200 OK | `application/scim+json` | ✅ Clean |
| 2 | Patch User - Multiple Ops same attr (Skipped) | 201 Created | `application/scim+json` | ✅ Clean |
| 3 | Delete a non-existent User | 404 NotFound | ⚠️ `application/json` | **FP #1** |
| 4 | Delete the same User twice | 404 NotFound | ⚠️ `application/json` | **FP #1** |
| 5 | Patch Group - Multiple Ops same attr | 200 OK (empty) | `application/scim+json` | **FP #2** |
| 6 | Delete a non-existent Group | 404 NotFound | ⚠️ `application/json` | **FP #1** |
| 7 | Delete the same Group twice | 404 NotFound | ⚠️ `application/json` | **FP #1** |

---

## Suspected False Positive #1 — Error Responses: Wrong Content-Type and Numeric `status`

**Affected tests:** 8 total (4 passed + 4 preview)  
**Severity:** Medium — RFC non-compliant, but Entra ID tolerates it  
**RFC Reference:** RFC 7644 §3.12 (HTTP Status and Error Response Handling)

### The Problem

Every SCIM error response from the server uses:
- `Content-Type: application/json` instead of `application/scim+json`
- `"status": 409` (Int64) instead of `"status": "409"` (String)

RFC 7644 §3.12 states:
> The service provider MUST return [...] a JSON body using the Error response schema [...] The "status" attribute is the HTTP status code expressed as a string value.

---

### Complete Flow — Test #2: "Create a duplicate User"

**Validator flow:** Create two users with the same `userName`. The second POST triggers a 409 Conflict.

#### Step 1 — Request (final recorded request)

```http
POST http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users HTTP/1.1
Host: localhost
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "userName": "julien.vonrueden@ondricka.us",
  "active": true,
  "displayName": "NDSQQTECVAAC",
  "title": "CJSGUNOAAMMQ",
  "emails": [
    { "type": "work", "value": "thaddeus@hammes.info", "primary": true }
  ],
  "preferredLanguage": "hi",
  "name": {
    "givenName": "Elfrieda",
    "familyName": "Urban",
    "formatted": "Myah",
    "middleName": "Cindy",
    "honorificPrefix": "Minerva",
    "honorificSuffix": "Micaela"
  },
  "addresses": [
    {
      "type": "work",
      "formatted": "ZQEHBLETAAQE",
      "streetAddress": "25928 Katlyn Row",
      "locality": "YRAKBQCGOHZF",
      "region": "XCCVLAIDMQYR",
      "postalCode": "cx47 4mz",
      "primary": true,
      "country": "Sierra Leone"
    }
  ],
  "phoneNumbers": [
    { "type": "work", "value": "10-040-1308", "primary": true },
    { "type": "mobile", "value": "10-040-1308" },
    { "type": "fax", "value": "10-040-1308" }
  ],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "OXYYEGWVLTGW",
    "department": "ZYWTBPDFHIIP",
    "costCenter": "ASHTVSKANCGL",
    "organization": "DPQRRHJMBXZE",
    "division": "WXNFEJQDRAVI",
    "manager": { "value": "XYMKVVRYDIOO" }
  },
  "roles": [
    {
      "primary": "True",
      "display": "MRONYWGFFHXQ",
      "value": "WDEIISGWWQBE",
      "type": "XVTUOHMYUFRL"
    }
  ],
  "userType": "GZILLRZCFPNC",
  "nickName": "FOGSIQTKHIPG",
  "locale": "RJWNTUNNOHNZ",
  "timezone": "America/Guayaquil",
  "profileUrl": "BAPNQLJSRQGD",
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ]
}
```

#### Step 2 — Actual Server Response (⚠️ non-compliant)

```
HTTP/1.1 409 Conflict
Content-Type: application/json; charset=utf-8          ← ⚠️ WRONG (should be application/scim+json)
Content-Length: 179
ETag: W/"b3-bf5ezy/InD0ua+GvHcitEWpDA/Q"
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "A resource with userName 'julien.vonrueden@ondricka.us' already exists.",
  "scimType": "uniqueness",
  "status": 409
}
```

**⚠️ Two issues:**
- `Content-Type` is `application/json` — should be `application/scim+json`
- `status` is `409` (Int64) — should be `"409"` (String)

#### ✅ RFC-Correct Response

```
HTTP/1.1 409 Conflict
Content-Type: application/scim+json; charset=utf-8     ← CORRECT
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "A resource with userName 'julien.vonrueden@ondricka.us' already exists.",
  "scimType": "uniqueness",
  "status": "409"
}
```

---

### Complete Flow — Test #19: "Create a duplicate Group"

#### Request

```http
POST http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups HTTP/1.1
Host: localhost
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "displayName": "ZGHZBQHCAPZU",
  "externalId": "087af0b9-d1e1-480d-acb8-03ceaa8ea85b",
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"]
}
```

#### Actual Server Response (⚠️ non-compliant)

```
HTTP/1.1 409 Conflict
Content-Type: application/json; charset=utf-8          ← ⚠️ WRONG
Content-Length: 163
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "A group with displayName 'ZGHZBQHCAPZU' already exists.",
  "scimType": "uniqueness",
  "status": 409
}
```

---

### Complete Flow — Test #12: "Delete a User" (verification GET returns 404)

**Validator flow:** The validator creates a user, deletes it (returns 204), then does a verification GET to confirm the resource is gone. Only the verification GET is captured as the final response.

**Important:** The actual DELETE returned `204 No Content` (confirmed via "Delete the same User twice" preview test where `InitialResponseStatuses: ["201 Created", "204 NoContent"]`). The 404 is the verification step, not the delete response.

#### Verification Request (recorded as final request)

```http
GET http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users/952145b5-de89-42ac-bbe3-1f56c287ed74 HTTP/1.1
Host: localhost
```

#### Verification Response (⚠️ error formatting non-compliant)

```
HTTP/1.1 404 NotFound
Content-Type: application/json; charset=utf-8          ← ⚠️ WRONG
Content-Length: 162
ETag: W/"a2-P4VSQn5kz9i58P/f1akFVe5NMEc"
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Resource 952145b5-de89-42ac-bbe3-1f56c287ed74 not found.",
  "scimType": "noTarget",
  "status": 404
}
```

---

### Complete Flow — Test #24: "Delete a Group" (verification GET returns 404)

#### Verification Request

```http
GET http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/a0891725-bf13-48fb-ac3e-c536309a0bfb HTTP/1.1
Host: localhost
```

#### Verification Response (⚠️ error formatting non-compliant)

```
HTTP/1.1 404 NotFound
Content-Type: application/json; charset=utf-8          ← ⚠️ WRONG
Content-Length: 162
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Resource a0891725-bf13-48fb-ac3e-c536309a0bfb not found.",
  "scimType": "noTarget",
  "status": 404
}
```

---

### Complete Flow — Preview Test #3: "Delete a non-existent User"

#### Request

```http
DELETE http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users/d950a5ce-61da-4979-8423-4600c745a897 HTTP/1.1
Host: localhost
```

#### Response (⚠️ non-compliant error formatting)

```
HTTP/1.1 404 NotFound
Content-Type: application/json; charset=utf-8          ← ⚠️ WRONG
Content-Length: 162
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Resource d950a5ce-61da-4979-8423-4600c745a897 not found.",
  "scimType": "noTarget",
  "status": 404
}
```

**Validator message:** `"DELETE request on a non-existent resource returns 404 NotFound as expected"` — correct behavior, but error format is non-compliant.

---

### Complete Flow — Preview Test #4: "Delete the same User twice"

This test is the key evidence that DELETE itself works correctly.

#### Step 1 — Create User (Initial)

```http
POST http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users HTTP/1.1
Content-Type: application/scim+json; charset=utf-8
```

Response: `201 Created` with user ID `eaa6f856-3e49-4f6b-9b70-aaf4c1606682`

#### Step 2 — First DELETE (Initial)

```http
DELETE http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users/eaa6f856-3e49-4f6b-9b70-aaf4c1606682 HTTP/1.1
Host: localhost
```

Response: **`204 NoContent`** ← ✅ **This confirms DELETE works correctly per RFC 7644 §3.6**

#### Step 3 — Second DELETE (Final recorded request)

```http
DELETE http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users/eaa6f856-3e49-4f6b-9b70-aaf4c1606682 HTTP/1.1
Host: localhost
```

Response: `404 NotFound` ← Correct (resource already deleted)

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Resource eaa6f856-3e49-4f6b-9b70-aaf4c1606682 not found.",
  "scimType": "noTarget",
  "status": 404
}
```

---

### Summary — All 8 Affected Error Responses

| Test | HTTP Status | Content-Type | `status` type | Validator |
|------|-------------|--------------|---------------|-----------|
| Create a duplicate User | 409 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |
| Create a duplicate Group | 409 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |
| Delete a User (verify GET) | 404 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |
| Delete a Group (verify GET) | 404 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |
| Delete non-existent User (preview) | 404 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |
| Delete same User twice (preview) | 404 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |
| Delete non-existent Group (preview) | 404 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |
| Delete same Group twice (preview) | 404 | `application/json` ⚠️ | Int64 ⚠️ | ✅ pass |

---

## Suspected False Positive #2 — Group PATCH: 200 OK with Empty Body

**Affected tests:** 5 total (4 passed + 1 preview)  
**Severity:** High — Response body is missing when RFC requires it for 200  
**RFC Reference:** RFC 7644 §3.5.2 (Modifying with PATCH)

### The Problem

All Group PATCH operations return `200 OK` with `Content-Length: 0` and an empty body. RFC 7644 §3.5.2 states:

> The server MUST return a 200 OK response code and the entire resource within the response body [...] or MAY return HTTP response code 204 (No Content) and the appropriate response headers for a successful PATCH request.

The server returns neither: it returns 200 (which requires a body) with no body (which is only valid with 204).

**Contrast with User PATCH:** All 6 User PATCH tests correctly return `200 OK` with the full updated User resource body — proving the server knows how to do this correctly for Users but not for Groups.

---

### Complete Flow — Test #20: "Patch Group - Replace Attributes"

#### Step 1 — Setup: Create Group (Initial request)

```http
POST http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups HTTP/1.1
Host: localhost
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "displayName": "NUSHDROHXPIN",
  "externalId": "6d1ca7c2-09f0-4be1-bba9-a7a2668d5540",
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"]
}
```

#### Step 1 — Response: 201 Created ✅

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "90b63fd7-197d-4634-ac88-4faafb2a19cb",
  "externalId": "6d1ca7c2-09f0-4be1-bba9-a7a2668d5540",
  "displayName": "NUSHDROHXPIN",
  "members": [],
  "meta": {
    "resourceType": "Group",
    "created": "2026-02-10T04:33:17.761Z",
    "lastModified": "2026-02-10T04:33:17.761Z",
    "location": "http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/90b63fd7-197d-4634-ac88-4faafb2a19cb",
    "version": "W/\"2026-02-10T04:33:17.761Z\""
  }
}
```

#### Step 2 — PATCH Request (replace `externalId`)

```http
PATCH http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/90b63fd7-197d-4634-ac88-4faafb2a19cb HTTP/1.1
Host: localhost
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "value": {
        "externalId": "663fa3a8-e2b6-4ac0-96c8-363432cdc01d"
      }
    }
  ]
}
```

#### Step 2 — Actual Server Response (⚠️ non-compliant)

```
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
Content-Length: 0                                       ← ⚠️ EMPTY BODY
```

```
(empty — no response body)
```

#### ✅ RFC-Correct Response (Option A: 200 + body)

```
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "90b63fd7-197d-4634-ac88-4faafb2a19cb",
  "externalId": "663fa3a8-e2b6-4ac0-96c8-363432cdc01d",
  "displayName": "NUSHDROHXPIN",
  "members": [],
  "meta": {
    "resourceType": "Group",
    "created": "2026-02-10T04:33:17.761Z",
    "lastModified": "2026-02-10T04:33:17.999Z",
    "location": "http://localhost:6000/scim/endpoints/.../Groups/90b63fd7-...",
    "version": "W/\"2026-02-10T04:33:17.999Z\""
  }
}
```

#### ✅ RFC-Correct Response (Option B: 204, no body)

```
HTTP/1.1 204 No Content
```

---

### Complete Flow — Test #21: "Update Group displayName"

#### Step 1 — Setup: Create Group → 201 Created

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "3a63d3fa-7c79-435d-b622-c9198cc2f0cf",
  "externalId": "f16709e6-bbed-4501-99ba-c3f1e2b09f4a",
  "displayName": "OXVCXOPGWFGA",
  "members": [],
  "meta": {
    "resourceType": "Group",
    "created": "2026-02-10T04:33:17.867Z",
    "lastModified": "2026-02-10T04:33:17.867Z",
    "location": "http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/3a63d3fa-7c79-435d-b622-c9198cc2f0cf",
    "version": "W/\"2026-02-10T04:33:17.867Z\""
  }
}
```

#### Step 2 — PATCH Request (replace displayName)

```http
PATCH http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/3a63d3fa-7c79-435d-b622-c9198cc2f0cf HTTP/1.1
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "value": {
        "displayName": "WUZPWMBDDCGI"
      }
    }
  ]
}
```

#### Actual Response (⚠️ non-compliant)

```
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
Content-Length: 0                                       ← ⚠️ EMPTY BODY
```

---

### Complete Flow — Test #22: "Patch Group - Add Member"

#### Setup: Create Group + Create User → 201 Created each

Group created: `83f42ecc-3851-430e-8a9b-e54de3fad833` (displayName: `"ZUCVNFFZIYJI"`)  
User created: `805d32c6-9e01-43b9-9735-4576cae634b5` (userName: `"member_viva.kunze@runolfsson.uk"`)

#### PATCH Request (add member)

```http
PATCH http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/83f42ecc-3851-430e-8a9b-e54de3fad833 HTTP/1.1
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "members",
      "value": [
        { "value": "805d32c6-9e01-43b9-9735-4576cae634b5" }
      ]
    }
  ]
}
```

#### Actual Response (⚠️ non-compliant)

```
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
Content-Length: 0                                       ← ⚠️ EMPTY BODY
```

---

### Complete Flow — Test #23: "Patch Group - Remove Member"

#### Setup: Create Group + Create 2 Users + PATCH add both members

Group: `1b2367d6-8dd3-4ae8-84e1-709d54be44b2` (displayName: `"CSTXDTRYYAIC"`)  
User 1: `ee90548a-11dd-4795-b3ac-9cfcd99232bc` (member_odessa@gulgowski.uk)  
User 2: `35ddd382-61d2-48ec-a366-11d37d83d765` (member_ciara@botsfordlittle.co.uk)

Setup responses: `["201 Created", "201 Created", "201 Created", "200 OK"]`

The setup PATCH added both users as members:
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "members",
      "value": [
        { "value": "ee90548a-11dd-4795-b3ac-9cfcd99232bc" },
        { "value": "35ddd382-61d2-48ec-a366-11d37d83d765" }
      ]
    }
  ]
}
```

#### PATCH Request (remove one member)

```http
PATCH http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/1b2367d6-8dd3-4ae8-84e1-709d54be44b2 HTTP/1.1
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "remove",
      "path": "members[value eq \"ee90548a-11dd-4795-b3ac-9cfcd99232bc\"]"
    }
  ]
}
```

#### Actual Response (⚠️ non-compliant)

```
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
Content-Length: 0                                       ← ⚠️ EMPTY BODY
```

---

### Complete Flow — Preview Test #5: "Patch Group - Multiple Operations on same attribute"

#### Setup: Create Group + Create User → 201 Created each

Group: `69fc935f-e0ec-469a-bac1-274431b29106` (displayName: `"VRICKKMEUGIJ"`)  
User: `761ac150-9d77-49b2-8f3f-8ec2eacf99da` (member_kenna.hammes@kuphalspinka.name)

#### PATCH Request (add then remove in one operation)

```http
PATCH http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Groups/69fc935f-e0ec-469a-bac1-274431b29106 HTTP/1.1
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        { "value": "761ac150-9d77-49b2-8f3f-8ec2eacf99da" }
      ]
    },
    {
      "op": "remove",
      "path": "members[value eq \"761ac150-9d77-49b2-8f3f-8ec2eacf99da\"]"
    }
  ]
}
```

#### Actual Response (⚠️ non-compliant)

```
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
Content-Length: 0                                       ← ⚠️ EMPTY BODY
```

---

### Summary — All 5 Affected Group PATCH Tests

| Test | Operation | Body present? | Content-Length | Validator |
|------|-----------|---------------|----------------|-----------|
| Patch Group - Replace Attributes | replace externalId | ❌ Empty | 0 | ✅ pass |
| Update Group displayName | replace displayName | ❌ Empty | 0 | ✅ pass |
| Patch Group - Add Member | replace members | ❌ Empty | 0 | ✅ pass |
| Patch Group - Remove Member | remove member filter | ❌ Empty | 0 | ✅ pass |
| Patch Group - Multiple Ops (preview) | add + remove member | ❌ Empty | 0 | ✅ pass |

---

## Suspected False Positive #3 — Remove Manager PATCH Leaves Empty String

**Affected tests:** 1 (Passed test #11)  
**Severity:** Low-Medium — Works with Entra ID but not strictly RFC-compliant  
**RFC Reference:** RFC 7644 §3.5.2.1 (Replace), RFC 7643 §7.1 (Enterprise User)

### The Problem

The validator test "Remove Manager" sends a `replace` operation with an empty `value` to clear the manager attribute. The response shows `"manager": {"value": ""}` — the attribute persists with an empty string rather than being removed or set to null.

---

### Complete Flow — Test #11: "Patch User - Remove Manager"

#### Step 1 — Setup: Create User with manager set (Initial request)

```http
POST http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users HTTP/1.1
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "userName": "jameson_damore@mante.co.uk",
  "active": true,
  "displayName": "UMVFMTPCSKRN",
  "title": "VUKPOKJXWZOZ",
  "emails": [
    { "type": "work", "value": "valerie_kuhic@carrollmacejkovic.us", "primary": true }
  ],
  "preferredLanguage": "jgo-CM",
  "name": {
    "givenName": "Esteban",
    "familyName": "Lauriane",
    "formatted": "Sage",
    "middleName": "Unique",
    "honorificPrefix": "Kiera",
    "honorificSuffix": "Leonie"
  },
  "addresses": [
    {
      "type": "work",
      "formatted": "TEQHUXUWIXFN",
      "streetAddress": "4942 Blanca Crossing",
      "locality": "DIEKZKOODJML",
      "region": "TRATHXSQJQKM",
      "postalCode": "dj6 6at",
      "primary": true,
      "country": "Madagascar"
    }
  ],
  "phoneNumbers": [
    { "type": "work", "value": "27-481-2844", "primary": true },
    { "type": "mobile", "value": "27-481-2844" },
    { "type": "fax", "value": "27-481-2844" }
  ],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "ARRGRUSJOOKU",
    "department": "YXAFVOIWZXSP",
    "costCenter": "SLIPSERTMHPP",
    "organization": "QERBOICTBLEN",
    "division": "MWLQXQUSPKTU",
    "manager": { "value": "IHZXFLMQGJKS" }
  },
  "roles": [
    { "primary": "True", "display": "ERQGDGIIKYBW", "value": "WNAWPFGHWQOH", "type": "QHKOMWAACYUM" }
  ],
  "userType": "RDRSPYVGMGRL",
  "nickName": "XCGHWOVMQASA",
  "locale": "URSTDNVZRLVY",
  "timezone": "Africa/Harare",
  "profileUrl": "ERRJINMQSCJI",
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ]
}
```

#### Step 1 — Response: 201 Created ✅ (manager is set)

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "b6df17e2-f55e-43f4-b67a-664e782dacda",
  "userName": "jameson_damore@mante.co.uk",
  "active": true,
  "displayName": "UMVFMTPCSKRN",
  "title": "VUKPOKJXWZOZ",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "ARRGRUSJOOKU",
    "department": "YXAFVOIWZXSP",
    "costCenter": "SLIPSERTMHPP",
    "organization": "QERBOICTBLEN",
    "division": "MWLQXQUSPKTU",
    "manager": { "value": "IHZXFLMQGJKS" }             // ← Manager IS set
  },
  "meta": {
    "resourceType": "User",
    "created": "2026-02-10T04:33:16.444Z",
    "lastModified": "2026-02-10T04:33:16.444Z",
    "location": "http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users/b6df17e2-f55e-43f4-b67a-664e782dacda",
    "version": "W/\"2026-02-10T04:33:16.444Z\""
  }
}
```

#### Step 2 — PATCH Request ("Remove" manager by replacing with empty value)

```http
PATCH http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users/b6df17e2-f55e-43f4-b67a-664e782dacda HTTP/1.1
Content-Type: application/scim+json; charset=utf-8
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager",
      "value": {
        "value": ""                                     // ← Entra sends empty string to "remove"
      }
    }
  ]
}
```

#### Step 2 — Actual Server Response (⚠️ attribute persists with empty string)

```
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
Content-Length: 1618
```

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "b6df17e2-f55e-43f4-b67a-664e782dacda",
  "userName": "jameson_damore@mante.co.uk",
  "active": true,
  "displayName": "UMVFMTPCSKRN",
  "title": "VUKPOKJXWZOZ",
  "emails": [
    { "type": "work", "value": "valerie_kuhic@carrollmacejkovic.us", "primary": true }
  ],
  "preferredLanguage": "jgo-CM",
  "name": {
    "givenName": "Esteban",
    "familyName": "Lauriane",
    "formatted": "Sage",
    "middleName": "Unique",
    "honorificPrefix": "Kiera",
    "honorificSuffix": "Leonie"
  },
  "addresses": [
    {
      "type": "work",
      "formatted": "TEQHUXUWIXFN",
      "streetAddress": "4942 Blanca Crossing",
      "locality": "DIEKZKOODJML",
      "region": "TRATHXSQJQKM",
      "postalCode": "dj6 6at",
      "primary": true,
      "country": "Madagascar"
    }
  ],
  "phoneNumbers": [
    { "type": "work", "value": "27-481-2844", "primary": true },
    { "type": "mobile", "value": "27-481-2844" },
    { "type": "fax", "value": "27-481-2844" }
  ],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "ARRGRUSJOOKU",
    "department": "YXAFVOIWZXSP",
    "costCenter": "SLIPSERTMHPP",
    "organization": "QERBOICTBLEN",
    "division": "MWLQXQUSPKTU",
    "manager": {
      "value": ""                                       // ⚠️ Still present with empty string
    }
  },
  "roles": [
    { "primary": true, "display": "ERQGDGIIKYBW", "value": "WNAWPFGHWQOH", "type": "QHKOMWAACYUM" }
  ],
  "userType": "RDRSPYVGMGRL",
  "nickName": "XCGHWOVMQASA",
  "locale": "URSTDNVZRLVY",
  "timezone": "Africa/Harare",
  "profileUrl": "ERRJINMQSCJI",
  "meta": {
    "resourceType": "User",
    "created": "2026-02-10T04:33:16.444Z",
    "lastModified": "2026-02-10T04:33:16.641Z",
    "location": "http://localhost:6000/scim/endpoints/cmlfuqaft0002i30tlv47pq1f/Users/b6df17e2-f55e-43f4-b67a-664e782dacda",
    "version": "W/\"2026-02-10T04:33:16.641Z\""
  }
}
```

#### ✅ RFC-Correct Response (manager removed or null)

The enterprise extension section should look like this:

```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "ARRGRUSJOOKU",
    "department": "YXAFVOIWZXSP",
    "costCenter": "SLIPSERTMHPP",
    "organization": "QERBOICTBLEN",
    "division": "MWLQXQUSPKTU"
    // manager field OMITTED (removed entirely)
  }
}
```

Or with explicit null:

```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "ARRGRUSJOOKU",
    "department": "YXAFVOIWZXSP",
    "costCenter": "SLIPSERTMHPP",
    "organization": "QERBOICTBLEN",
    "division": "MWLQXQUSPKTU",
    "manager": null
  }
}
```

### Context: Why this is borderline

Microsoft Entra ID uses `replace` with `{"value": ""}` as the canonical way to "remove" a manager reference. The validator test is named "Remove Manager" but uses `op: replace` (not `op: remove`). The validator accepts the response because Entra tolerates `"value": ""`. However, RFC 7644 §3.5.2.3 states:

> If the target location is a single-value attribute [...] the attribute and its associated value is removed.

Replacing with an empty value should semantically clear the attribute. Leaving `"value": ""` could cause downstream confusion (is there a manager with an empty ID, or no manager?).

---

## Confirmed Correct Behaviors

### DELETE Operations Work Correctly

The DELETE flow was confirmed by examining multi-step preview tests:

**"Delete the same User twice" (Preview test #4):**
```
InitialResponseStatuses: ["201 Created", "204 NoContent"]   ← DELETE returns 204 ✅
Final DELETE (2nd time): 404 NotFound                        ← Correct for already-deleted resource ✅
```

**"Delete the same Group twice" (Preview test #7):**
```
InitialResponseStatuses: ["201 Created", "204 NoContent"]   ← DELETE returns 204 ✅
Final DELETE (2nd time): 404 NotFound                        ← Correct for already-deleted resource ✅
```

### User PATCH Returns Full Resource Body

All 6 User PATCH tests correctly return `200 OK` with the complete updated User resource in the body (non-zero Content-Length, full JSON). This is the RFC-compliant behavior that Group PATCH should also follow.

### Correct Content-Type on Success Responses

All non-error responses use `Content-Type: application/scim+json; charset=utf-8` — the correct SCIM media type.

---

## Clean Tests — No Issues Detected (18 tests)

| # | Test | Key Validation |
|---|------|----------------|
| 1 | Create a new User | POST 201 Created → GET filter 200 OK, ListResponse with full User ✅ |
| 3 | Filter for an existing user | 200 OK, schemas + totalResults=1 + Resources[0] matches ✅ |
| 4 | Filter for a non-existing user | 200 OK, totalResults=0, Resources=[] ✅ |
| 5 | Filter with different case | Case-insensitive userName match ✅ |
| 6 | Patch User - Replace Attributes Verbose | 200 OK, 36 replace operations, full updated body ✅ |
| 7 | Update User userName | 200 OK, userName changed ✅ |
| 8 | Patch User - Disable User | 200 OK, active=false ✅ |
| 9 | Patch User - Add Manager | 200 OK, manager.value=target user ID ✅ |
| 10 | Patch User - Replace Manager | 200 OK, manager.value updated to new ID ✅ |
| 13 | Get group by id excluding members | 200 OK, ?excludedAttributes=members, no members ✅ |
| 14 | Filter group excluding members | 200 OK, totalResults=1, members excluded ✅ |
| 15 | Filter for an existing group | 200 OK, totalResults=1, members=[] included ✅ |
| 16 | Filter for a non-existing group | 200 OK, totalResults=0 ✅ |
| 17 | Filter group different case | Case-insensitive displayName match ✅ |
| 18 | Create a new Group | 201 Created, full Group with meta ✅ |
| P1 | Patch User - Multiple Ops different attrs | 200 OK, displayName + title updated ✅ |
| P4 | Delete same User twice | 1st DELETE → 204, 2nd → 404 ✅ |
| P7 | Delete same Group twice | 1st DELETE → 204, 2nd → 404 ✅ |

---

## Suspected False Positive #4 — Missing HTTP `Location` Header on 201 Created

**Affected tests:** POST /Users (#1 initial step), POST /Groups (#18), and all setup POST steps  
**Severity:** Medium — RFC MUST requirement  
**RFC Reference:** RFC 7644 §3.1 (Resource creation response)

### The Problem

When a new resource is created via POST, the server returns `201 Created` with the full resource in the body (including `meta.location`), but does **not** set the HTTP `Location` response header.

RFC 7644 §3.1 states:
> the server SHALL return a 201 Created response code along with the resource's representation... The server SHALL set the Location header.

### Evidence from Test #18 (POST /Groups → 201 Created)

Response headers:
```
X-Powered-By: Express
Vary: Origin
ETag: W/"1d7-6uMyyhSKkrz/PfPkf1P5EofOAWM"
Content-Type: application/scim+json; charset=utf-8
Content-Length: 471
← NO Location header!
```

The `meta.location` is present in the JSON body but absent as an HTTP header.

### Why the Validator Missed It

The Microsoft SCIM validator does **not** check for the HTTP `Location` header on POST/201 responses. It validates the response body content and status code only.

---

## Recommendations — ✅ ALL IMPLEMENTED

### ✅ Priority 1 — Fix Error Response Formatting (FP #1) — DONE

**Impact:** 8 responses across all error paths  
**Fix location:** New `ScimExceptionFilter` + `createScimError` status conversion

**Changes made:**
1. Created `api/src/modules/scim/filters/scim-exception.filter.ts` — Global NestJS exception filter that intercepts all `HttpException` errors and sets `Content-Type: application/scim+json; charset=utf-8` on the response
2. Updated `api/src/modules/scim/common/scim-errors.ts` — `createScimError` now emits `"status": String(status)` (string) instead of numeric
3. Registered filter as `APP_FILTER` in `api/src/modules/scim/scim.module.ts`
4. Created full test suite: `api/src/modules/scim/filters/scim-exception.filter.spec.ts`

### ✅ Priority 2 — Fix Group PATCH Empty Body (FP #2) — DONE

**Impact:** All Group PATCH operations (5 tests)  
**Fix location:** Group service + controller

**Changes made (Option A — return 200 OK with body):**
1. Updated `patchGroupForEndpoint` in `api/src/modules/scim/services/endpoint-scim-groups.service.ts` — Changed return type from `Promise<void>` to `Promise<ScimGroupResource>`, added `baseUrl` parameter, fetches and returns updated group after transaction
2. Updated `api/src/modules/scim/controllers/endpoint-scim-groups.controller.ts` — Passes `baseUrl` and `endpointId` to the service
3. Updated all 29 test calls in `api/src/modules/scim/services/endpoint-scim-groups.service.spec.ts` + controller spec
4. Added new test: "should return updated group resource with 200 OK (RFC 7644 §3.5.2)"

### ✅ Priority 3 — Fix Remove Manager Empty String (FP #3) — DONE

**Impact:** Remove Manager operation (1 test)  
**Fix location:** PATCH extension utilities

**Changes made:**
1. Updated `applyExtensionUpdate` in `api/src/modules/scim/utils/scim-patch-path.ts` — Now detects empty SCIM values (`null`, `""`, `{"value":""}`, `{"value":null}`) and removes the attribute instead of storing empty data
2. Added `isEmptyScimValue()` helper function with RFC 7644 §3.5.2.3 documentation
3. Added 6 new tests in `api/src/modules/scim/utils/scim-patch-path.spec.ts` covering all empty-value scenarios
4. Added integration test in `api/src/modules/scim/services/endpoint-scim-users.service.spec.ts`: "should remove manager when replace sends empty value"

### ✅ Priority 4 — Fix Missing Location Header on 201 Created (FP #4) — DONE

**Impact:** All POST (resource creation) responses  
**Fix location:** `ScimContentTypeInterceptor`

**Changes made:**
1. Updated `api/src/modules/scim/interceptors/scim-content-type.interceptor.ts` — Enhanced the existing interceptor to also set `Location` header from `meta.location` on 201 Created responses
2. Added 4 new tests in `api/src/modules/scim/interceptors/scim-content-type.interceptor.spec.ts` — Location header on User/Group creation, NOT on 200 OK, NOT when meta.location is absent

---

## RFC References

| Section | Topic | Relevance |
|---------|-------|-----------|
| RFC 7644 §3.1 | Resource Creation | 201 Created + Location header required |
| RFC 7644 §3.5.2 | Modifying with PATCH | Defines 200 (with body) vs 204 (without body) |
| RFC 7644 §3.5.2.1 | Replace operation | Semantics for replace with empty values |
| RFC 7644 §3.5.2.3 | Remove operation | Attribute removal semantics |
| RFC 7644 §3.6 | DELETE | Must return 204 No Content |
| RFC 7644 §3.12 | Error Handling | `application/scim+json`, `status` as string |
| RFC 7643 §7.1 | Enterprise User | Manager attribute schema definition |

---

## Appendix — Validator JSON Evidence Lines

All line references point to `scim-results-9.json` in the workspace root:

| Evidence | Lines |
|----------|-------|
| Create duplicate User (409 error) | 38–48 |
| Create duplicate Group (409 error) | 668–678 |
| Delete User verification (404) | 368–387 |
| Delete Group verification (404) | 788–807 |
| Patch Group - Replace Attributes (empty body) | 688–720 |
| Update Group displayName (empty body) | 720–748 |
| Patch Group - Add Member (empty body) | 748–780 |
| Patch Group - Remove Member (empty body) | 780–790 |
| Remove Manager (empty string) | 330–367 |
| Delete same User twice (confirms 204) | 882–930 |
| Delete same Group twice (confirms 204) | 960–990 |
| Preview: Delete non-existent User (404 format) | 930–950 |
| Preview: Delete non-existent Group (404 format) | 950–970 |
