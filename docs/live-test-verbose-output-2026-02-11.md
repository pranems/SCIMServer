# 🧪 SCIM Server — Verbose Live Test Report

> **Date:** February 11, 2026  
> **Target:** `http://localhost:6000`  
> **Mode:** Verbose (request/response details shown)  
> **Result:** ✅ **183/183 PASSED** | ❌ **0 FAILED** | ⏱️ **3s**

---

## 📋 Table of Contents

1. [OAuth Token Acquisition](#step-1-get-oauth-token)
2. [Section 1: Endpoint CRUD Operations](#test-section-1-endpoint-crud-operations)
3. [Section 2: Config Validation](#test-section-2-config-validation)
4. [Section 3: SCIM User Operations](#test-section-3-scim-user-operations)
5. [Section 3b: Case-Insensitivity (RFC 7643)](#test-section-3b-case-insensitivity-rfc-7643)
6. [Section 3c: Advanced PATCH Operations](#test-section-3c-advanced-patch-operations)
7. [Section 3d: Pagination & Advanced Filtering](#test-section-3d-pagination--advanced-filtering)
8. [Section 4: SCIM Group Operations](#test-section-4-scim-group-operations)
9. [Section 5: Multi-Member PATCH Config Flag](#test-section-5-multi-member-patch-config-flag)
10. [Section 5b: Multi-Member Remove Config Flag](#test-section-5b-multi-member-remove-config-flag)
11. [Section 6: Endpoint Isolation](#test-section-6-endpoint-isolation)
12. [Section 7: Inactive Endpoint Blocking](#test-section-7-inactive-endpoint-blocking)
13. [Section 8: SCIM Discovery Endpoints](#test-section-8-scim-discovery-endpoints)
14. [Section 8b: Content-Type & Auth Verification](#test-section-8b-content-type--auth-verification)
15. [Section 9: Error Handling](#test-section-9-error-handling)
16. [Section 9b: RFC 7644 Compliance Checks](#test-section-9b-rfc-7644-compliance-checks)
17. [Section 9c: POST /.search (RFC 7644 §3.4.3)](#test-section-9c-post-search-rfc-7644-343)
18. [Section 9d: Attribute Projection (RFC 7644 §3.4.2.5)](#test-section-9d-attribute-projection-rfc-7644-3425)
19. [Section 9e: ETag & Conditional Requests (RFC 7644 §3.14)](#test-section-9e-etag--conditional-requests-rfc-7644-314)
20. [Section 10: Delete Operations](#test-section-10-delete-operations)
21. [Cleanup](#cleanup-removing-test-endpoints)
22. [Final Summary](#final-test-summary)

---

## Step 1: Get OAuth Token

> 🔍 **VERBOSE MODE ENABLED** — request/response details will be shown

```
📋 Token endpoint: http://localhost:6000/scim/oauth/token
```

**Request:**
```http
POST http://localhost:6000/scim/oauth/token
Body: {"grant_type":"client_credentials","client_secret":"changeme-oauth","client_id":"scimserver-client"}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

| # | Test | Result |
|---|------|--------|
| 1 | Token obtained | ✅ |
| 2 | Token expires_in: 3600s | ✅ |

---

## Test Section 1: Endpoint CRUD Operations

### Test: Create Endpoint

**Request:**
```http
POST http://localhost:6000/scim/admin/endpoints
Content-Type: application/json

{
  "name": "live-test-endpoint-321768979",
  "displayName": "Live Test Endpoint",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "True"
  },
  "description": "Created by live-test.ps1"
}
```

**Response:**
```json
{
  "id": "cmliotfgz019d128vwurivo17",
  "name": "live-test-endpoint-321768979",
  "displayName": "Live Test Endpoint",
  "description": "Created by live-test.ps1",
  "config": { "MultiOpPatchRequestAddMultipleMembersToGroup": "True" },
  "active": true,
  "scimEndpoint": "/scim/endpoints/cmliotfgz019d128vwurivo17"
}
```

| # | Test | Result |
|---|------|--------|
| 1 | Create endpoint returned ID | ✅ |
| 2 | New endpoint is active by default | ✅ |
| 3 | scimEndpoint URL is correct | ✅ |

### Test: Get Endpoint by ID

```http
GET http://localhost:6000/scim/admin/endpoints/cmliotfgz019d128vwurivo17
```

| # | Test | Result |
|---|------|--------|
| 4 | Get endpoint by ID returns correct data | ✅ |

### Test: Get Endpoint by Name

```http
GET http://localhost:6000/scim/admin/endpoints/by-name/live-test-endpoint-321768979
```

| # | Test | Result |
|---|------|--------|
| 5 | Get endpoint by name returns correct data | ✅ |

### Test: List Endpoints

```http
GET http://localhost:6000/scim/admin/endpoints
```

| # | Test | Result |
|---|------|--------|
| 6 | List endpoints returns array with items | ✅ |

### Test: Update Endpoint

```http
PATCH http://localhost:6000/scim/admin/endpoints/cmliotfgz019d128vwurivo17
Body: {"displayName":"Updated Live Test Endpoint","description":"Updated description"}
```

| # | Test | Result |
|---|------|--------|
| 7 | Update endpoint displayName works | ✅ |
| 8 | Update endpoint description works | ✅ |

### Test: Get Endpoint Stats

```http
GET http://localhost:6000/scim/admin/endpoints/cmliotfgz019d128vwurivo17/stats
← {"totalUsers":0,"totalGroups":0,"totalGroupMembers":0,"requestLogCount":0}
```

| # | Test | Result |
|---|------|--------|
| 9 | Stats includes totalUsers | ✅ |
| 10 | Stats includes totalGroups | ✅ |

---

## Test Section 2: Config Validation

### Test: Invalid Config Value Rejected on Create

```http
POST http://localhost:6000/scim/admin/endpoints
Body: {"name":"invalid-config-test","config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"Yes"}}
← 400 Bad Request: Invalid value "Yes" ... Allowed values: "True", "False", true, false, "1", "0"
```

| # | Test | Result |
|---|------|--------|
| 1 | Invalid config 'Yes' rejected with 400 Bad Request | ✅ |

### Test: Invalid Config Value Rejected on Update

```http
PATCH http://localhost:6000/scim/admin/endpoints/cmliotfgz019d128vwurivo17
Body: {"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"enabled"}}
← 400 Bad Request
```

| # | Test | Result |
|---|------|--------|
| 2 | Invalid config 'enabled' rejected with 400 Bad Request | ✅ |

### Test: Valid Config Values Accepted

```http
PATCH ...  Body: {"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"False"}}  ← 200 OK
PATCH ...  Body: {"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":true}}     ← 200 OK
```

| # | Test | Result |
|---|------|--------|
| 3 | Valid config 'False' accepted | ✅ |
| 4 | Boolean true accepted as config value | ✅ |

### Test: Invalid Remove Config Value Rejected on Create

```http
POST ... Body: {"name":"invalid-remove-config-test","config":{"MultiOpPatchRequestRemoveMultipleMembersFromGroup":"Yes"}}
← 400 Bad Request
```

| # | Test | Result |
|---|------|--------|
| 5 | Invalid remove config 'Yes' rejected with 400 Bad Request | ✅ |

### Test: Invalid Remove Config Value Rejected on Update

| # | Test | Result |
|---|------|--------|
| 6 | Invalid remove config 'enabled' rejected with 400 Bad Request | ✅ |

### Test: Valid Remove Config Values Accepted

| # | Test | Result |
|---|------|--------|
| 7 | Valid remove config 'False' accepted | ✅ |

### Test: Both Config Flags Set Together

| # | Test | Result |
|---|------|--------|
| 8 | Both add and remove config flags set together | ✅ |

### Test: Invalid VerbosePatchSupported Config Value Rejected

| # | Test | Result |
|---|------|--------|
| 9 | Invalid VerbosePatchSupported 'Yes' rejected with 400 Bad Request | ✅ |

### Test: Valid VerbosePatchSupported Config Value Accepted

| # | Test | Result |
|---|------|--------|
| 10 | VerbosePatchSupported boolean true accepted | ✅ |

### Test: All Three Config Flags Set Together

| # | Test | Result |
|---|------|--------|
| 11 | All three config flags set together | ✅ |

---

## Test Section 3: SCIM User Operations

### Test: Create User

**Request:**
```http
POST http://localhost:6000/scim/endpoints/cmliotfgz019d128vwurivo17/Users
Content-Type: application/json

{
  "active": true,
  "displayName": "Live Test User",
  "emails": [{ "type": "work", "value": "livetest-user@test.com", "primary": true }],
  "name": { "familyName": "Test", "givenName": "Live" },
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "livetest-user@test.com"
}
```

**Response:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "1a7a769a-3af5-433f-bd64-4d5421ae803f",
  "userName": "livetest-user@test.com",
  "active": true,
  "displayName": "Live Test User",
  "meta": {
    "resourceType": "User",
    "created": "2026-02-11T23:55:14.383Z",
    "lastModified": "2026-02-11T23:55:14.383Z",
    "location": "http://localhost:6000/scim/endpoints/.../Users/1a7a769a-..."
  }
}
```

| # | Test | Result |
|---|------|--------|
| 1 | Create user returned ID | ✅ |
| 2 | User userName is correct | ✅ |
| 3 | User meta.resourceType is 'User' | ✅ |
| 4 | User meta.location is present | ✅ |
| 5 | User meta.location contains correct path | ✅ |
| 6 | User meta.created is present | ✅ |
| 7 | User meta.lastModified is present | ✅ |

### Test: Get User by ID

```http
GET http://localhost:6000/scim/endpoints/.../Users/1a7a769a-3af5-433f-bd64-4d5421ae803f
```

| # | Test | Result |
|---|------|--------|
| 8 | Get user by ID returns correct data | ✅ |

### Test: List Users

```http
GET http://localhost:6000/scim/endpoints/.../Users
← ListResponse with totalResults: 1
```

| # | Test | Result |
|---|------|--------|
| 9 | List users returns at least 1 user | ✅ |
| 10 | List users has correct schema | ✅ |

### Test: Filter Users by userName

```http
GET .../Users?filter=userName eq "livetest-user@test.com"
← totalResults: 1
```

| # | Test | Result |
|---|------|--------|
| 11 | Filter by userName returns exactly 1 user | ✅ |

### Test: PATCH User

```http
PATCH .../Users/1a7a769a-...
Body: { "Operations": [{ "op": "replace", "path": "displayName", "value": "Updated Display Name" }] }
```

| # | Test | Result |
|---|------|--------|
| 12 | PATCH user displayName works | ✅ |

### Test: PUT User (Replace)

```http
PUT .../Users/1a7a769a-...
Body: { "userName": "livetest-user@test.com", "displayName": "Replaced Display Name", "active": true }
```

| # | Test | Result |
|---|------|--------|
| 13 | PUT user (replace) works | ✅ |

### Test: Deactivate User (Soft Delete)

```http
PATCH .../Users/1a7a769a-...
Body: { "Operations": [{ "op": "replace", "path": "active", "value": false }] }
← active: false

PATCH (re-activate)
Body: { "Operations": [{ "op": "replace", "path": "active", "value": true }] }
← active: true
```

| # | Test | Result |
|---|------|--------|
| 14 | Deactivate user (active=false) works | ✅ |

---

## Test Section 3b: Case-Insensitivity (RFC 7643)

### Test: Case-Insensitive userName Uniqueness

```http
POST .../Users  Body: { "userName": "LIVETEST-USER@TEST.COM" }   ← 409 Conflict
POST .../Users  Body: { "userName": "LiveTest-User@Test.Com" }   ← 409 Conflict
```

| # | Test | Result |
|---|------|--------|
| 1 | UPPERCASE duplicate userName returns 409 (case-insensitive uniqueness) | ✅ |
| 2 | Mixed-case duplicate userName returns 409 | ✅ |

### Test: Case-Insensitive Filter Attribute Names

```http
GET .../Users?filter=USERNAME eq "livetest-user@test.com"   ← totalResults: 1
GET .../Users?filter=UserName eq "livetest-user@test.com"   ← totalResults: 1
```

| # | Test | Result |
|---|------|--------|
| 3 | Filter with 'USERNAME' (uppercase) finds user | ✅ |
| 4 | Filter with 'UserName' (PascalCase) finds user | ✅ |

### Test: Case-Insensitive Filter Value (userName)

```http
GET .../Users?filter=userName eq "LIVETEST-USER@TEST.COM"   ← totalResults: 1
```

| # | Test | Result |
|---|------|--------|
| 5 | Filter with UPPERCASE value finds user (case-insensitive) | ✅ |

### Test: PascalCase PATCH op Values

```http
PATCH ... { "op": "Replace", "path": "displayName", "value": "PascalCase Patched" }  ← 200 OK
PATCH ... { "op": "Add", "path": "displayName", "value": "Add Op Patched" }           ← 200 OK
```

| # | Test | Result |
|---|------|--------|
| 6 | PATCH with 'Replace' (PascalCase op) works | ✅ |
| 7 | PATCH with 'Add' (PascalCase op) works | ✅ |

---

## Test Section 3c: Advanced PATCH Operations

### Test: PATCH with No Path (Merge)

```http
PATCH .../Users/...
{ "op": "replace", "value": { "displayName": "No-Path Merged", "active": true } }
```

| # | Test | Result |
|---|------|--------|
| 1 | PATCH with no path merges displayName | ✅ |
| 2 | PATCH with no path merges active | ✅ |

### Test: No-Path PATCH with Case-Insensitive Keys

```http
PATCH ... { "op": "replace", "value": { "DisplayName": "CI-Keys Merged", "Active": true } }
```

| # | Test | Result |
|---|------|--------|
| 3 | No-path PATCH with 'DisplayName' (PascalCase key) works | ✅ |

### Test: PATCH with valuePath

```http
PATCH ... { "op": "replace", "path": "emails[type eq \"work\"].value", "value": "updated-work@test.com" }
```

| # | Test | Result |
|---|------|--------|
| 4 | PATCH with valuePath updates emails[type eq work].value | ✅ |
| 5 | valuePath PATCH does not affect other email entries | ✅ |

### Test: PATCH with Extension URN Path

```http
PATCH ... { "op": "add",     "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Engineering" }
PATCH ... { "op": "replace", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Product" }
```

| # | Test | Result |
|---|------|--------|
| 6 | PATCH with extension URN path sets department | ✅ |
| 7 | PATCH with extension URN replace updates department | ✅ |

### Test: Manager Empty-Value Removal (RFC 7644 §3.5.2.3)

```http
PATCH ... { "op": "add", "path": "...enterprise:2.0:User:manager", "value": { "value": "manager-id-123" } }
← manager set

PATCH ... { "op": "replace", "path": "...enterprise:2.0:User:manager", "value": { "value": "" } }
← manager removed
```

| # | Test | Result |
|---|------|--------|
| 8 | Manager set successfully via extension URN | ✅ |
| 9 | Manager removed when value is empty string (RFC 7644 §3.5.2.3) | ✅ |

### Test: Multiple Operations in Single PATCH

```http
PATCH ... {
  "Operations": [
    { "op": "replace", "path": "displayName", "value": "Multi-Op User" },
    { "op": "replace", "path": "active", "value": false },
    { "op": "add", "path": "title", "value": "Engineer" }
  ]
}
```

| # | Test | Result |
|---|------|--------|
| 10 | Multi-op PATCH: displayName updated | ✅ |
| 11 | Multi-op PATCH: active set to false | ✅ |
| 12 | Multi-op PATCH: title added | ✅ |

---

## Test Section 3d: Pagination & Advanced Filtering

### Setup: Create Users for Pagination

Created 3 pagination users (`pagination-user1@test.com` through `pagination-user3@test.com`) with externalIds `ext-pag-1` through `ext-pag-3`.

### Test: Pagination with count

```http
GET .../Users?count=2
← { "totalResults": 4, "startIndex": 1, "itemsPerPage": 2, "Resources": [...] }
```

| # | Test | Result |
|---|------|--------|
| 1 | Pagination: itemsPerPage matches count=2 | ✅ |
| 2 | Pagination: totalResults >= 4 (all users) | ✅ |
| 3 | Pagination: Resources array has 2 items | ✅ |

### Test: Pagination with startIndex

```http
GET .../Users?startIndex=2&count=2
← { "startIndex": 2, "itemsPerPage": 2 }
```

| # | Test | Result |
|---|------|--------|
| 4 | Pagination: startIndex=2 reflected in response | ✅ |
| 5 | Pagination: startIndex+count returns correct page size | ✅ |

### Test: Filter by externalId

```http
GET .../Users?filter=externalId eq "ext-pag-1"       ← totalResults: 1
GET .../Users?filter=EXTERNALID eq "ext-pag-2"       ← totalResults: 1
```

| # | Test | Result |
|---|------|--------|
| 6 | Filter by externalId returns exactly 1 user | ✅ |
| 7 | Filtered user has correct externalId | ✅ |
| 8 | Filter with 'EXTERNALID' (uppercase attr) finds user | ✅ |

### Test: externalId Uniqueness

```http
POST .../Users  Body: { "userName": "dup-ext-test@test.com", "externalId": "ext-pag-1" }
← 409 Conflict: "A resource with externalId 'ext-pag-1' already exists."
```

| # | Test | Result |
|---|------|--------|
| 9 | Duplicate externalId returns 409 Conflict | ✅ |

---

## Test Section 4: SCIM Group Operations

### Test: Create Group

**Request:**
```http
POST .../Groups
Body: { "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"], "displayName": "Live Test Group" }
```

**Response:**
```json
{
  "id": "f810e9f6-1e01-448c-acd2-365ffed5968f",
  "displayName": "Live Test Group",
  "members": [],
  "meta": { "resourceType": "Group", "created": "2026-02-11T23:55:15.019Z" }
}
```

| # | Test | Result |
|---|------|--------|
| 1 | Create group returned ID | ✅ |
| 2 | Group displayName is correct | ✅ |
| 3 | Group meta.resourceType is 'Group' | ✅ |
| 4 | Group meta.location is present | ✅ |
| 5 | Group meta.location contains correct path | ✅ |
| 6 | Group meta.created is present | ✅ |

### Test: Get Group by ID

| # | Test | Result |
|---|------|--------|
| 7 | Get group by ID returns correct data | ✅ |

### Test: List Groups

| # | Test | Result |
|---|------|--------|
| 8 | List groups returns at least 1 group | ✅ |

### Test: PATCH Group (Add Member)

```http
PATCH .../Groups/f810e9f6-...
{ "Operations": [{ "op": "add", "path": "members", "value": [{ "value": "1a7a769a-..." }] }] }
← members: [{ "value": "1a7a769a-..." }]
```

| # | Test | Result |
|---|------|--------|
| 9 | Group PATCH returns response body (not 204) | ✅ |
| 10 | PATCH add member works | ✅ |

### Test: PATCH Group (Remove Member)

```http
PATCH ... { "op": "remove", "path": "members[value eq \"1a7a769a-...\"]" }
← members: []
```

| # | Test | Result |
|---|------|--------|
| 11 | Group PATCH remove returns response body | ✅ |
| 12 | PATCH remove member works | ✅ |

### Test: PUT Group (Replace)

```http
PUT .../Groups/f810e9f6-...
Body: { "displayName": "Replaced Group Name" }
```

| # | Test | Result |
|---|------|--------|
| 13 | PUT group (replace) works | ✅ |

### Test: Group externalId Support

```http
POST .../Groups  Body: { "displayName": "Group With ExternalId", "externalId": "ext-group-123" }  ← 201
GET  .../Groups?filter=externalId eq "ext-group-123"                                               ← totalResults: 1
POST .../Groups  Body: { "displayName": "Dup ExternalId Group", "externalId": "ext-group-123" }   ← 409
```

| # | Test | Result |
|---|------|--------|
| 14 | Group created with externalId | ✅ |
| 15 | Filter groups by externalId returns exactly 1 group | ✅ |
| 16 | Duplicate group externalId returns 409 Conflict | ✅ |

---

## Test Section 5: Multi-Member PATCH Config Flag

### Setup

Created 2 additional users and a `Multi-Member Test Group` on the main endpoint (flag=True).

### Test: Multi-Member PATCH with Flag=True

```http
PATCH .../Groups/b0fb1c57-...
{ "Operations": [{ "op": "add", "path": "members", "value": [
  { "value": "user1-id" }, { "value": "user2-id" }, { "value": "user3-id" }
] }] }
← 200 OK — 3 members added in single operation
```

| # | Test | Result |
|---|------|--------|
| 1 | Multi-member PATCH with flag=True accepted (3 members added) | ✅ |

### Test: Multi-Member ADD PATCH without Flag (Should Fail)

Created a **No Flag Endpoint** (no `MultiOpPatchRequestAddMultipleMembersToGroup` config).

```http
PATCH .../Groups/0fad9055-...  (on no-flag endpoint)
{ "Operations": [{ "op": "add", "path": "members", "value": [{ "value": "..." }, { "value": "..." }] }] }
← 400 Bad Request: "Adding multiple members in a single operation is not allowed..."
```

| # | Test | Result |
|---|------|--------|
| 2 | Multi-member ADD without flag rejected with 400 Bad Request | ✅ |

---

## Test Section 5b: Multi-Member Remove Config Flag

### Test: Multi-Member REMOVE without Flag (Should Fail)

```http
PATCH .../Groups/... (on no-flag endpoint, 2 members added individually)
{ "Operations": [{ "op": "remove", "path": "members", "value": [{ "value": "..." }, { "value": "..." }] }] }
← 400 Bad Request: "Removing multiple members in a single operation is not allowed..."
```

| # | Test | Result |
|---|------|--------|
| 1 | Multi-member REMOVE without flag rejected with 400 Bad Request | ✅ |

### Test: Multi-Member REMOVE with Flag=True

Created a **Remove Flag Endpoint** with `MultiOpPatchRequestRemoveMultipleMembersFromGroup: "True"`.  
Added 2 members individually, then removed both in a single PATCH operation.

```http
PATCH .../Groups/0f5a57ef-...
{ "Operations": [{ "op": "remove", "path": "members", "value": [
  { "value": "user1-id" }, { "value": "user2-id" }
] }] }
← 200 OK — members: []
```

| # | Test | Result |
|---|------|--------|
| 2 | Multi-member REMOVE with flag=True accepted (removed 2 members) | ✅ |

---

## Test Section 6: Endpoint Isolation

### Test: Same userName in Different Endpoints

```http
POST http://localhost:6000/scim/endpoints/{isolation-endpoint}/Users
Body: { "userName": "livetest-user@test.com" }
← 201 Created (same userName allowed in different endpoint)
```

| # | Test | Result |
|---|------|--------|
| 1 | Same userName created in different endpoint (isolation works) | ✅ |

### Test: Endpoint Data Isolation

```http
GET .../endpoints/{main}/Users       ← totalResults: 6
GET .../endpoints/{isolation}/Users  ← totalResults: 1
```

| # | Test | Result |
|---|------|--------|
| 2 | Endpoints have isolated user data | ✅ |

---

## Test Section 7: Inactive Endpoint Blocking

### Setup & Deactivation

Created endpoint, added a test user, then deactivated endpoint via `PATCH {"active": false}`.

| # | Test | Result |
|---|------|--------|
| 1 | Endpoint deactivated successfully | ✅ |

### Test: SCIM Operations Return 403 on Inactive Endpoint

```http
GET  .../Users/983db44b-...  ← 403 Forbidden: "Endpoint is inactive. SCIM operations are not allowed."
POST .../Users               ← 403 Forbidden
GET  .../Groups              ← 403 Forbidden
```

| # | Test | Result |
|---|------|--------|
| 2 | GET User returns 403 on inactive endpoint | ✅ |
| 3 | POST User returns 403 on inactive endpoint | ✅ |
| 4 | GET Groups returns 403 on inactive endpoint | ✅ |
| 5 | Inactive endpoint appears in active=false filter | ✅ |

### Test: Reactivate Endpoint

```http
PATCH .../admin/endpoints/...  Body: {"active": true}    ← 200 OK
GET   .../Users/983db44b-...                              ← 200 OK (user accessible again)
```

| # | Test | Result |
|---|------|--------|
| 6 | Endpoint reactivated successfully | ✅ |
| 7 | GET User works after reactivation | ✅ |

---

## Test Section 8: SCIM Discovery Endpoints

### Test: ServiceProviderConfig

```http
GET .../ServiceProviderConfig
← {
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    "patch": { "supported": true },
    "bulk": { "supported": false },
    "filter": { "supported": true, "maxResults": 200 },
    "changePassword": { "supported": false },
    "sort": { "supported": false },
    "etag": { "supported": true }
  }
```

| # | Test | Result |
|---|------|--------|
| 1 | ServiceProviderConfig has correct schema | ✅ |

### Test: Schemas

| # | Test | Result |
|---|------|--------|
| 2 | Schemas endpoint returns schemas | ✅ |

### Test: ResourceTypes

| # | Test | Result |
|---|------|--------|
| 3 | ResourceTypes endpoint returns resource types | ✅ |

---

## Test Section 8b: Content-Type & Auth Verification

### Test: Response Content-Type Header

```http
GET  .../Users   ← Content-Type: application/scim+json; charset=utf-8
POST .../Users   ← Content-Type: application/scim+json; charset=utf-8, Status: 201
```

| # | Test | Result |
|---|------|--------|
| 1 | Response Content-Type is application/scim+json | ✅ |
| 2 | POST response Content-Type is application/scim+json | ✅ |
| 3 | POST response status code is 201 Created | ✅ |

### Test: Missing Auth Token → 401

```http
GET .../Users  (no Authorization header)
← 401 Unauthorized: "Missing bearer token."
```

| # | Test | Result |
|---|------|--------|
| 4 | Missing Authorization header returns 401 | ✅ |

### Test: Invalid Auth Token → 401

```http
GET .../Users  (Authorization: Bearer invalid-token)
← 401 Unauthorized: "Invalid bearer token."
```

| # | Test | Result |
|---|------|--------|
| 5 | Invalid Bearer token returns 401 | ✅ |

### Test: Token Without Bearer Prefix → 401

| # | Test | Result |
|---|------|--------|
| 6 | Token without 'Bearer ' prefix returns 401 | ✅ |

---

## Test Section 9: Error Handling

### Test: 404 for Non-Existent Resources

```http
GET .../Users/non-existent-id-12345    ← 404: "Resource non-existent-id-12345 not found."
GET .../Groups/non-existent-id-12345   ← 404: "Resource non-existent-id-12345 not found."
GET .../admin/endpoints/non-existent-id-12345  ← 404: "Endpoint with ID ... not found"
```

| # | Test | Result |
|---|------|--------|
| 1 | Non-existent user returns 404 | ✅ |
| 2 | Non-existent group returns 404 | ✅ |
| 3 | Non-existent endpoint returns 404 | ✅ |

### Test: 409 for Duplicate userName

```http
POST .../Users  Body: { "userName": "livetest-user@test.com" }
← 409 Conflict: "A resource with userName 'livetest-user@test.com' already exists."
```

| # | Test | Result |
|---|------|--------|
| 4 | Duplicate userName returns 409 Conflict | ✅ |

### Test: 400 for Invalid Endpoint Name

```http
POST .../admin/endpoints  Body: {"name":"invalid name with spaces"}
← 400: "Endpoint name must contain only alphanumeric characters, hyphens, and underscores"
```

| # | Test | Result |
|---|------|--------|
| 5 | Invalid endpoint name returns 400 Bad Request | ✅ |

---

## Test Section 9b: RFC 7644 Compliance Checks

### Test: Location Header on POST /Users (RFC 7644 §3.1)

```http
POST .../Users  ← 201 Created
  Location: http://localhost:6000/scim/endpoints/.../Users/...
  ETag: W/"2026-02-11T23:55:16.190Z"
```

| # | Test | Result |
|---|------|--------|
| 1 | POST /Users returns 201 Created | ✅ |
| 2 | POST /Users includes Location header | ✅ |
| 3 | Location header matches meta.location | ✅ |

### Test: Location Header on POST /Groups (RFC 7644 §3.1)

| # | Test | Result |
|---|------|--------|
| 4 | POST /Groups returns 201 Created | ✅ |
| 5 | POST /Groups includes Location header | ✅ |
| 6 | Location header matches meta.location | ✅ |

### Test: Error Response Format (RFC 7644 §3.12)

```http
GET .../Users/non-existent-error-format-test
← 404, Content-Type: application/scim+json
  { "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "status": "404", "detail": "..." }
```

| # | Test | Result |
|---|------|--------|
| 7 | Error returns 404 status code | ✅ |
| 8 | Error Content-Type is application/scim+json | ✅ |
| 9 | Error has SCIM Error schema | ✅ |
| 10 | Error status is string type: '404' | ✅ |
| 11 | Error status value is '404' | ✅ |
| 12 | Error includes detail message | ✅ |

### Test: 409 Error Response Format

| # | Test | Result |
|---|------|--------|
| 13 | Duplicate returns 409 | ✅ |
| 14 | 409 error Content-Type is application/scim+json | ✅ |
| 15 | 409 error status is string '409' | ✅ |

### Test: PATCH Updates meta.lastModified

```http
POST .../Users  ← created: "2026-02-11T23:55:16.241Z", lastModified: "2026-02-11T23:55:16.241Z"
PATCH .../Users/...  { "op": "replace", "path": "displayName", "value": "Timestamp Updated" }
← lastModified changed
GET .../Users/...  ← lastModified unchanged (read doesn't modify)
```

| # | Test | Result |
|---|------|--------|
| 16 | PATCH updates meta.lastModified timestamp | ✅ |
| 17 | GET does not change meta.lastModified | ✅ |

---

## Test Section 9c: POST /.search (RFC 7644 §3.4.3)

### Test: POST /Users/.search Basic

```http
POST .../Users/.search
Body: {
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "userName eq \"livetest-user@test.com\"",
  "startIndex": 1, "count": 10
}
← ListResponse with totalResults: 1
```

| # | Test | Result |
|---|------|--------|
| 1 | POST /Users/.search returns ListResponse schema | ✅ |
| 2 | POST /Users/.search finds user via filter | ✅ |
| 3 | POST /Users/.search includes startIndex | ✅ |
| 4 | POST /Users/.search includes itemsPerPage | ✅ |

### Test: POST /Users/.search Returns HTTP 200

```http
POST .../Users/.search  ← HTTP 200 (not 201)
  Content-Type: application/scim+json; charset=utf-8
  ETag: W/"323-jY93yzy5Hc9RyPlseApVWkeelpM"
```

| # | Test | Result |
|---|------|--------|
| 5 | POST /Users/.search returns HTTP 200 (not 201) | ✅ |
| 6 | POST /Users/.search Content-Type is application/scim+json | ✅ |

### Test: POST /Users/.search with Attributes

```http
POST .../Users/.search  Body: { ..., "attributes": "userName" }
```

| # | Test | Result |
|---|------|--------|
| 7 | POST /.search with attributes includes userName | ✅ |
| 8 | POST /.search always returns id (always-returned) | ✅ |
| 9 | POST /.search always returns schemas (always-returned) | ✅ |
| 10 | POST /.search with attributes excludes non-requested attrs (emails) | ✅ |

### Test: POST /Users/.search with excludedAttributes

```http
POST .../Users/.search  Body: { ..., "excludedAttributes": "emails,phoneNumbers" }
```

| # | Test | Result |
|---|------|--------|
| 11 | POST /.search with excludedAttributes keeps userName | ✅ |
| 12 | POST /.search with excludedAttributes removes emails | ✅ |

### Test: POST /Users/.search Without Filter

```http
POST .../Users/.search  Body: { "count": 5, "startIndex": 1 }
← totalResults: 9, itemsPerPage: 5
```

| # | Test | Result |
|---|------|--------|
| 13 | POST /Users/.search without filter lists users | ✅ |
| 14 | POST /Users/.search respects count parameter | ✅ |

### Test: POST /Groups/.search Basic

| # | Test | Result |
|---|------|--------|
| 15 | POST /Groups/.search returns ListResponse schema | ✅ |
| 16 | POST /Groups/.search finds group via filter | ✅ |

### Test: POST /Groups/.search with excludedAttributes

| # | Test | Result |
|---|------|--------|
| 17 | POST /Groups/.search excludedAttributes removes members | ✅ |
| 18 | POST /Groups/.search excludedAttributes keeps displayName | ✅ |

---

## Test Section 9d: Attribute Projection (RFC 7644 §3.4.2.5)

### Test: GET /Users with attributes Param

```http
GET .../Users?attributes=userName,displayName&count=5
```

| # | Test | Result |
|---|------|--------|
| 1 | GET /Users?attributes works | ✅ |
| 2 | attributes param includes userName | ✅ |
| 3 | attributes param always returns id | ✅ |
| 4 | attributes param always returns schemas | ✅ |
| 5 | attributes param excludes non-requested emails | ✅ |
| 6 | attributes param excludes non-requested active | ✅ |

### Test: GET /Users/:id with attributes Param

```http
GET .../Users/1a7a769a-...?attributes=userName
```

| # | Test | Result |
|---|------|--------|
| 7 | GET User by ID with attributes includes userName | ✅ |
| 8 | GET User by ID with attributes always returns id | ✅ |
| 9 | GET User by ID with attributes always returns meta | ✅ |
| 10 | GET User by ID with attributes excludes displayName | ✅ |

### Test: GET /Users with excludedAttributes Param

```http
GET .../Users?excludedAttributes=emails,phoneNumbers&count=5
```

| # | Test | Result |
|---|------|--------|
| 11 | excludedAttributes keeps userName | ✅ |
| 12 | excludedAttributes always keeps id | ✅ |
| 13 | excludedAttributes removes emails | ✅ |
| 14 | excludedAttributes removes phoneNumbers | ✅ |

### Test: GET /Users/:id with excludedAttributes

```http
GET .../Users/1a7a769a-...?excludedAttributes=name,emails
```

| # | Test | Result |
|---|------|--------|
| 15 | GET User excludedAttributes keeps userName | ✅ |
| 16 | GET User excludedAttributes removes name | ✅ |
| 17 | GET User excludedAttributes removes emails | ✅ |
| 18 | GET User excludedAttributes always keeps id (never excluded) | ✅ |
| 19 | GET User excludedAttributes always keeps schemas (never excluded) | ✅ |

### Test: GET /Groups with attributes Param

```http
GET .../Groups?attributes=displayName&count=5
```

| # | Test | Result |
|---|------|--------|
| 20 | GET /Groups attributes includes displayName | ✅ |
| 21 | GET /Groups attributes always returns id | ✅ |
| 22 | GET /Groups attributes excludes non-requested members | ✅ |

### Test: GET /Groups/:id with excludedAttributes

```http
GET .../Groups/f810e9f6-...?excludedAttributes=members
```

| # | Test | Result |
|---|------|--------|
| 23 | GET Group excludedAttributes keeps displayName | ✅ |
| 24 | GET Group excludedAttributes removes members | ✅ |

### Test: attributes Precedence Over excludedAttributes

```http
GET .../Users?attributes=userName,displayName&excludedAttributes=displayName&count=1
```

| # | Test | Result |
|---|------|--------|
| 25 | Precedence test: attributes includes userName | ✅ |
| 26 | Precedence test: attributes wins — displayName included despite excludedAttributes | ✅ |

---

## Test Section 9e: ETag & Conditional Requests (RFC 7644 §3.14)

### Test: ETag Header on GET /Users/:id

```http
GET .../Users/1a7a769a-...
← HTTP 200
  ETag: W/"2026-02-11T23:55:14.887Z"
  Content-Type: application/scim+json; charset=utf-8
```

| # | Test | Result |
|---|------|--------|
| 1 | GET /Users/:id includes ETag header | ✅ |
| 2 | ETag is a weak ETag (W/"...") format | ✅ |
| 3 | meta.version matches ETag header value | ✅ |

### Test: ETag Header on GET /Groups/:id

| # | Test | Result |
|---|------|--------|
| 4 | GET /Groups/:id includes ETag header | ✅ |
| 5 | Group ETag is weak ETag format | ✅ |

### Test: If-None-Match → 304 Not Modified

```http
GET .../Users/1a7a769a-...
  If-None-Match: W/"2026-02-11T23:55:14.887Z"
← HTTP 304
```

| # | Test | Result |
|---|------|--------|
| 6 | If-None-Match with matching ETag returns 304 Not Modified | ✅ |

### Test: If-None-Match with Stale ETag → 200

```http
GET .../Users/1a7a769a-...
  If-None-Match: W/"stale-etag-value"
← HTTP 200 (full resource returned)
```

| # | Test | Result |
|---|------|--------|
| 7 | If-None-Match with stale ETag returns 200 with full resource | ✅ |

### Test: ETag Changes After PATCH

```http
PATCH .../Users/1a7a769a-...  { "op": "replace", "path": "displayName", "value": "ETag Changed User" }
← ETag: W/"2026-02-11T23:55:16.913Z"  (changed from W/"2026-02-11T23:55:14.887Z")
```

| # | Test | Result |
|---|------|--------|
| 8 | PATCH response includes ETag header | ✅ |
| 9 | ETag changed after PATCH | ✅ |

### Test: Old ETag After Modification → 200

| # | Test | Result |
|---|------|--------|
| 10 | Old ETag after modification returns 200 (resource changed) | ✅ |

### Test: POST /Users Includes ETag

```http
POST .../Users  ← 201 Created, ETag: W/"2026-02-11T23:55:16.946Z"
```

| # | Test | Result |
|---|------|--------|
| 11 | POST /Users response includes ETag header | ✅ |
| 12 | POST /Users returns 201 with ETag | ✅ |

### Test: PUT /Users Includes ETag

```http
PUT .../Users/1a7a769a-...  ← 200 OK, ETag: W/"2026-02-11T23:55:16.968Z"
```

| # | Test | Result |
|---|------|--------|
| 13 | PUT /Users response includes ETag header | ✅ |

### Test: ServiceProviderConfig etag.supported

| # | Test | Result |
|---|------|--------|
| 14 | ServiceProviderConfig etag.supported = true | ✅ |

---

## Test Section 10: Delete Operations

### Test: Delete User

```http
DELETE .../Users/1a7a769a-...  ← 204 No Content
GET    .../Users/1a7a769a-...  ← 404 Not Found
```

| # | Test | Result |
|---|------|--------|
| 1 | DELETE user works (returns 204, user not found after) | ✅ |

### Test: Delete Group

```http
DELETE .../Groups/f810e9f6-...  ← 204 No Content
```

| # | Test | Result |
|---|------|--------|
| 2 | DELETE group works | ✅ |

---

## Cleanup: Removing Test Endpoints

All test endpoints deleted via cascade delete:

| Endpoint | Status |
|----------|--------|
| Main Test Endpoint (`cmliotfgz019d128vwurivo17`) | ✅ Deleted |
| No Flag Endpoint (`cmliotgcl01bm128v331k664y`) | ✅ Deleted |
| Remove Flag Endpoint (`cmliotgkj01cj128vkjq1rd0x`) | ✅ Deleted |
| Isolation Endpoint (`cmliotgps01d2128vjyx2nfaf`) | ✅ Deleted |
| Inactive Endpoint (`cmliotgrl01d8128vn4wjb111`) | ✅ Deleted |

---

## Final Test Summary

```
========================================
FINAL TEST SUMMARY
========================================
Tests Passed: 183
Tests Failed: 0
Total Tests:  183
Duration:     3s
Base URL:     http://localhost:6000

🎉 ALL TESTS PASSED!
========================================
```

| Metric | Value |
|--------|-------|
| ✅ Tests Passed | **183** |
| ❌ Tests Failed | **0** |
| 📊 Total Tests | **183** |
| ⏱️ Duration | **3s** |
| 🌐 Base URL | `http://localhost:6000` |
