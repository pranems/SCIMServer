# SCIM Case-Insensitivity — Complete Reference

> **RFC References**: RFC 7643 §2.1, §2.4 (Core Schema); RFC 7644 §3.4.2.2, §3.5.2 (Protocol)  
> **Date**: February 2026  
> **Purpose**: Definitive guide to what MUST be case-insensitive in SCIM 2.0, with examples

---

## Table of Contents

1. [Summary Matrix](#1-summary-matrix)
2. [Attribute Names](#2-attribute-names)
3. [Schema URIs](#3-schema-uris)
4. [Filter Attribute Paths](#4-filter-attribute-paths)
5. [Filter Operators](#5-filter-operators)
6. [String Attribute Values — caseExact](#6-string-attribute-values--caseexact)
7. [PATCH Operation Paths](#7-patch-operation-paths)
8. [PATCH Operation `op` Values](#8-patch-operation-op-values)
9. [Sort Attribute Names](#9-sort-attribute-names)
10. [What is NOT Case-Insensitive](#10-what-is-not-case-insensitive)
11. [Microsoft Entra ID Specifics](#11-microsoft-entra-id-specifics)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Summary Matrix

| Element | Case-Insensitive? | RFC Section | Notes |
|---------|:-:|---|---|
| Attribute names | ✅ Yes | RFC 7643 §2.1 | `userName` ≡ `UserName` ≡ `USERNAME` |
| Schema URIs | ✅ Yes | RFC 7643 §2.1 | `urn:ietf:params:scim:schemas:core:2.0:User` |
| Filter attribute paths | ✅ Yes | RFC 7644 §3.4.2.2 | `filter=userName eq ...` ≡ `filter=UserName eq ...` |
| Filter operators | ✅ Yes | RFC 7644 §3.4.2.2 | `eq` ≡ `EQ` ≡ `Eq` |
| String values (`caseExact: false`) | ✅ Yes | RFC 7643 §2.4 | `userName` value comparison |
| String values (`caseExact: true`) | ❌ No | RFC 7643 §2.4 | `id`, `externalId`, `password` |
| PATCH `path` attribute refs | ✅ Yes | RFC 7644 §3.5.2 + §2.1 | Inherits from attribute name rule |
| PATCH `op` values | ⚠️ Should | RFC 7644 §3.5.2 | Spec uses lowercase; Entra sends PascalCase |
| `sortBy` attribute name | ✅ Yes | RFC 7644 §3.4.2.3 | Inherits from attribute name rule |
| URL path segments | ❌ No | HTTP/1.1 | `/Users` ≠ `/users` per HTTP spec |
| HTTP header names | ✅ Yes | HTTP/1.1 | Standard HTTP rule |
| HTTP header values | ❌ No | HTTP/1.1 | Bearer tokens are case-sensitive |
| `id` resource identifiers | ❌ No | RFC 7643 §3.1 | Opaque, case-sensitive |
| ETag values | ❌ No | RFC 7232 | Case-sensitive per HTTP spec |

---

## 2. Attribute Names

### Specification

**RFC 7643 §2.1 — Attribute Names**:

> *"Attribute names are case insensitive and are often 'camel-cased'
> (e.g., 'camelCase')."*

This applies **everywhere** an attribute name appears: request bodies, response bodies, filter expressions, PATCH paths, `sortBy` parameters, `attributes`/`excludedAttributes` query parameters.

### Examples

All of the following are **equivalent** and MUST resolve to the same attribute:

```
userName
UserName
USERNAME
username
uSeRnAmE
```

### Request Body — All Valid

```http
POST /scim/v2/Users HTTP/1.1
Host: example.com
Content-Type: application/scim+json
Authorization: Bearer eyJ...

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "USERNAME": "jdoe",
  "NAME": {
    "GIVENNAME": "John",
    "FAMILYNAME": "Doe"
  },
  "EMAILS": [
    { "VALUE": "jdoe@example.com", "TYPE": "work", "PRIMARY": true }
  ]
}
```

A compliant server MUST accept this exactly as if camelCase names were used.

### Response — Server Typically Returns Canonical Form

```http
HTTP/1.1 201 Created
Content-Type: application/scim+json
Location: https://example.com/scim/v2/Users/2819c223

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "userName": "jdoe",
  "name": {
    "givenName": "John",
    "familyName": "Doe"
  },
  "emails": [
    { "value": "jdoe@example.com", "type": "work", "primary": true }
  ],
  "meta": {
    "resourceType": "User",
    "created": "2026-02-09T10:00:00Z",
    "lastModified": "2026-02-09T10:00:00Z",
    "location": "https://example.com/scim/v2/Users/2819c223-7f76-453a-919d-413861904646",
    "version": "W/\"e180ee84f0671b1\""
  }
}
```

### `attributes` / `excludedAttributes` Query Parameters

```http
GET /scim/v2/Users?attributes=USERNAME,EMAILS HTTP/1.1
```

MUST return the same result as:

```http
GET /scim/v2/Users?attributes=userName,emails HTTP/1.1
```

---

## 3. Schema URIs

### Specification

**RFC 7643 §2.1**:

> *"Schema URIs used to indicate a resource type, as well as to
> define attribute extensions, are also case insensitive."*

### Examples

All of the following MUST be treated as equivalent:

```
urn:ietf:params:scim:schemas:core:2.0:User
URN:IETF:PARAMS:SCIM:SCHEMAS:CORE:2.0:USER
Urn:Ietf:Params:Scim:Schemas:Core:2.0:User
```

### Request Example — Mixed-Case Schema URIs

```http
POST /scim/v2/Users HTTP/1.1
Content-Type: application/scim+json

{
  "schemas": [
    "URN:IETF:PARAMS:SCIM:SCHEMAS:CORE:2.0:USER",
    "URN:IETF:PARAMS:SCIM:SCHEMAS:EXTENSION:ENTERPRISE:2.0:USER"
  ],
  "userName": "jdoe",
  "URN:IETF:PARAMS:SCIM:SCHEMAS:EXTENSION:ENTERPRISE:2.0:USER": {
    "employeeNumber": "12345",
    "department": "Engineering"
  }
}
```

A compliant server MUST accept this request and map the schemas correctly.

### Common Schema URIs

| Canonical URI | Purpose |
|---|---|
| `urn:ietf:params:scim:schemas:core:2.0:User` | User resource |
| `urn:ietf:params:scim:schemas:core:2.0:Group` | Group resource |
| `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` | Enterprise User extension |
| `urn:ietf:params:scim:api:messages:2.0:ListResponse` | List response envelope |
| `urn:ietf:params:scim:api:messages:2.0:PatchOp` | PATCH request envelope |
| `urn:ietf:params:scim:api:messages:2.0:BulkRequest` | Bulk request envelope |
| `urn:ietf:params:scim:api:messages:2.0:Error` | Error response |

---

## 4. Filter Attribute Paths

### Specification

**RFC 7644 §3.4.2.2 — Filtering**:

> *"Attribute names and attribute operators used in filters are case
> insensitive."*

### Examples — All Equivalent

```http
GET /scim/v2/Users?filter=userName eq "jdoe" HTTP/1.1
GET /scim/v2/Users?filter=UserName eq "jdoe" HTTP/1.1
GET /scim/v2/Users?filter=USERNAME eq "jdoe" HTTP/1.1
GET /scim/v2/Users?filter=username eq "jdoe" HTTP/1.1
```

### Sub-Attribute Paths — Also Case-Insensitive

```http
GET /scim/v2/Users?filter=NAME.FAMILYNAME eq "Doe" HTTP/1.1
GET /scim/v2/Users?filter=name.familyName eq "Doe" HTTP/1.1
```

### Value Path Filters (Bracketed) — Attribute Names Are Case-Insensitive

```http
GET /scim/v2/Users?filter=EMAILS[TYPE eq "work"].VALUE co "example" HTTP/1.1
GET /scim/v2/Users?filter=emails[type eq "work"].value co "example" HTTP/1.1
```

Both MUST return the same results.

### Extension URN Paths in Filters

```http
GET /scim/v2/Users?filter=urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "Engineering" HTTP/1.1
GET /scim/v2/Users?filter=URN:IETF:PARAMS:SCIM:SCHEMAS:EXTENSION:ENTERPRISE:2.0:USER:DEPARTMENT eq "Engineering" HTTP/1.1
```

### Expected Response (200 OK)

```http
HTTP/1.1 200 OK
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "2819c223-7f76-453a-919d-413861904646",
      "userName": "jdoe",
      "name": { "givenName": "John", "familyName": "Doe" }
    }
  ]
}
```

---

## 5. Filter Operators

### Specification

**RFC 7644 §3.4.2.2**:

> *"Attribute names and attribute operators used in filters are case insensitive.
> For example, the following two expressions will evaluate to the same
> logical value:*
>
> *`filter=userName Eq "john"`*
>
> *`filter=Username eq "john"`"*

### All Operator Variations — Must Be Accepted

| Operator | Lowercase | Uppercase | Mixed | Meaning |
|----------|-----------|-----------|-------|---------|
| Equal | `eq` | `EQ` | `Eq` | Exact match |
| Not Equal | `ne` | `NE` | `Ne` | Not equal |
| Contains | `co` | `CO` | `Co` | Substring match |
| Starts With | `sw` | `SW` | `Sw` | Prefix match |
| Ends With | `ew` | `EW` | `Ew` | Suffix match |
| Present | `pr` | `PR` | `Pr` | Has value |
| Greater Than | `gt` | `GT` | `Gt` | Greater than |
| Greater or Equal | `ge` | `GE` | `Ge` | Greater or equal |
| Less Than | `lt` | `LT` | `Lt` | Less than |
| Less or Equal | `le` | `LE` | `Le` | Less or equal |
| And | `and` | `AND` | `And` | Logical AND |
| Or | `or` | `OR` | `Or` | Logical OR |
| Not | `not` | `NOT` | `Not` | Logical NOT |

### Examples

```http
GET /scim/v2/Users?filter=userName EQ "jdoe" HTTP/1.1
GET /scim/v2/Users?filter=displayName CO "John" AND active EQ true HTTP/1.1
GET /scim/v2/Users?filter=emails[type EQ "work"].value SW "j" HTTP/1.1
GET /scim/v2/Users?filter=NOT(userName EQ "admin") HTTP/1.1
```

---

## 6. String Attribute Values — `caseExact`

### Specification

**RFC 7643 §2.4 — Returned Characteristics**:

> *"For attributes with type 'string', the 'caseExact' characteristic
> determines how string value comparisons are handled."*

When `caseExact` is `false` (the **default** for string attributes), comparisons for filtering, sorting, and uniqueness MUST be performed case-insensitively.

### User Resource Attributes — RFC 7643 §4.1

| Attribute | Type | `caseExact` | Comparison | Notes |
|-----------|------|:-----------:|------------|-------|
| `userName` | string | **false** | Case-insensitive | `"jdoe"` ≡ `"JDoe"` for uniqueness/filtering |
| `name.formatted` | string | **false** | Case-insensitive | |
| `name.familyName` | string | **false** | Case-insensitive | |
| `name.givenName` | string | **false** | Case-insensitive | |
| `name.middleName` | string | **false** | Case-insensitive | |
| `name.honorificPrefix` | string | **false** | Case-insensitive | |
| `name.honorificSuffix` | string | **false** | Case-insensitive | |
| `displayName` | string | **false** | Case-insensitive | |
| `nickName` | string | **false** | Case-insensitive | |
| `title` | string | **false** | Case-insensitive | |
| `userType` | string | **false** | Case-insensitive | |
| `preferredLanguage` | string | **false** | Case-insensitive | |
| `locale` | string | **false** | Case-insensitive | |
| `timezone` | string | **false** | Case-insensitive | |
| `profileUrl` | reference | **false** | Case-insensitive | |
| `emails[].value` | string | **false** | Case-insensitive | |
| `emails[].type` | string | **false** | Case-insensitive | |
| `emails[].display` | string | **false** | Case-insensitive | |
| `phoneNumbers[].value` | string | **false** | Case-insensitive | |
| `addresses[].formatted` | string | **false** | Case-insensitive | |
| `groups[].display` | string | **false** | Case-insensitive | Read-only |
| `id` | string | **true** | **Case-sensitive** ⚠️ | Server-generated, opaque |
| `externalId` | string | **true** | **Case-sensitive** ⚠️ | Client-generated identifier |
| `password` | string | **true** | **Case-sensitive** ⚠️ | Write-only, never returned |

### Group Resource Attributes — RFC 7643 §4.2

| Attribute | Type | `caseExact` | Comparison |
|-----------|------|:-----------:|------------|
| `displayName` | string | **false** | Case-insensitive |
| `members[].value` | string | **true** | **Case-sensitive** (references `id`) |
| `members[].display` | string | **false** | Case-insensitive |
| `members[].type` | string | **false** | Case-insensitive |
| `id` | string | **true** | **Case-sensitive** |

### Enterprise Extension Attributes — RFC 7643 §4.3

| Attribute | Type | `caseExact` | Comparison |
|-----------|------|:-----------:|------------|
| `employeeNumber` | string | **false** | Case-insensitive |
| `costCenter` | string | **false** | Case-insensitive |
| `organization` | string | **false** | Case-insensitive |
| `division` | string | **false** | Case-insensitive |
| `department` | string | **false** | Case-insensitive |
| `manager.value` | string | **true** | **Case-sensitive** (references `id`) |
| `manager.displayName` | string | **false** | Case-insensitive |

### Example — Filter Value Comparison (caseExact: false)

Since `userName` has `caseExact: false`, these filters MUST return the same user:

```http
GET /scim/v2/Users?filter=userName eq "jdoe" HTTP/1.1
GET /scim/v2/Users?filter=userName eq "JDOE" HTTP/1.1
GET /scim/v2/Users?filter=userName eq "JDoe" HTTP/1.1
```

### Example — Uniqueness (caseExact: false)

If user `"jdoe"` exists, creating `"JDOE"` MUST return a 409 Conflict:

```http
POST /scim/v2/Users HTTP/1.1
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "JDOE"
}
```

```http
HTTP/1.1 409 Conflict
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "User with userName 'JDOE' already exists (case-insensitive match)",
  "status": "409",
  "scimType": "uniqueness"
}
```

### Example — Filter Value Comparison (caseExact: true)

Since `externalId` has `caseExact: true`, these filters return **different** results:

```http
GET /scim/v2/Users?filter=externalId eq "ABC-123" HTTP/1.1
```

↑ Will NOT match a user whose `externalId` is `"abc-123"`.

---

## 7. PATCH Operation Paths

### Specification

**RFC 7644 §3.5.2 — Modifying with PATCH**:

PATCH `path` values reference attribute names. Since attribute names are case-insensitive (RFC 7643 §2.1), PATCH paths MUST be resolved case-insensitively.

### Examples — All Equivalent

**Simple attribute path:**

```http
PATCH /scim/v2/Users/2819c223 HTTP/1.1
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "USERNAME", "value": "newname" }
  ]
}
```

MUST behave identically to:

```json
{ "op": "replace", "path": "userName", "value": "newname" }
```

**Sub-attribute path:**

```json
{ "op": "replace", "path": "NAME.FAMILYNAME", "value": "Smith" }
```

Same as:

```json
{ "op": "replace", "path": "name.familyName", "value": "Smith" }
```

**Value path filter:**

```json
{ "op": "replace", "path": "EMAILS[TYPE eq \"work\"].VALUE", "value": "new@example.com" }
```

Same as:

```json
{ "op": "replace", "path": "emails[type eq \"work\"].value", "value": "new@example.com" }
```

**Extension URN path:**

```json
{
  "op": "replace",
  "path": "URN:IETF:PARAMS:SCIM:SCHEMAS:EXTENSION:ENTERPRISE:2.0:USER:DEPARTMENT",
  "value": "Sales"
}
```

Same as:

```json
{
  "op": "replace",
  "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
  "value": "Sales"
}
```

### Expected Response (200 OK)

```http
HTTP/1.1 200 OK
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "userName": "newname",
  "name": { "givenName": "John", "familyName": "Smith" },
  "meta": {
    "resourceType": "User",
    "lastModified": "2026-02-09T12:00:00Z",
    "location": "https://example.com/scim/v2/Users/2819c223-7f76-453a-919d-413861904646",
    "version": "W/\"a330bc54f0671b1\""
  }
}
```

---

## 8. PATCH Operation `op` Values

### Specification

**RFC 7644 §3.5.2** defines three operations:

> *"The body of each request MUST contain the "schemas" attribute with
> the URI value of "urn:ietf:params:scim:api:messages:2.0:PatchOp".*
>
> *The body of an HTTP PATCH request MUST contain the attribute
> "Operations", whose value is an array of one or more PATCH
> operations. Each PATCH operation object MUST have exactly one "op"
> member, whose value indicates the operation to perform..."*

The spec defines `"add"`, `"remove"`, `"replace"` in lowercase. It does NOT explicitly require `op` to be case-insensitive, but...

### ⚠️ Real-World Requirement

**Microsoft Entra ID** (Azure AD) sends PascalCase operations:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "Add", "path": "members", "value": [{ "value": "user-id-123" }] },
    { "op": "Replace", "path": "displayName", "value": "New Name" },
    { "op": "Remove", "path": "members[value eq \"user-id-456\"]" }
  ]
}
```

A server that only accepts lowercase `op` values will reject Entra ID requests.

### Recommended Handling

Accept all common casings:

| Spec Value | Entra ID | Also Accept |
|------------|----------|-------------|
| `"add"` | `"Add"` | `"ADD"` |
| `"remove"` | `"Remove"` | `"REMOVE"` |
| `"replace"` | `"Replace"` | `"REPLACE"` |

**Implementation**: Normalize `op` to lowercase before dispatching:

```typescript
const normalizedOp = operation.op.toLowerCase(); // "Add" → "add"
switch (normalizedOp) {
  case 'add':    return handleAdd(operation);
  case 'remove': return handleRemove(operation);
  case 'replace': return handleReplace(operation);
}
```

---

## 9. Sort Attribute Names

### Specification

**RFC 7644 §3.4.2.3 — Sorting**:

> *"Sort is OPTIONAL. 'sortBy' is a string that indicates the attribute
> whose value SHALL be used to order the returned responses."*

Since attribute names are case-insensitive, `sortBy` values MUST be resolved case-insensitively.

### Examples — All Equivalent

```http
GET /scim/v2/Users?sortBy=userName&sortOrder=ascending HTTP/1.1
GET /scim/v2/Users?sortBy=USERNAME&sortOrder=ascending HTTP/1.1
GET /scim/v2/Users?sortBy=UserName&sortOrder=ascending HTTP/1.1
```

### Sub-Attribute Sort

```http
GET /scim/v2/Users?sortBy=NAME.FAMILYNAME&sortOrder=descending HTTP/1.1
GET /scim/v2/Users?sortBy=name.familyName&sortOrder=descending HTTP/1.1
```

### Note on `sortOrder`

The spec defines `"ascending"` and `"descending"` as string values. The spec does not explicitly state whether these are case-insensitive, but servers SHOULD accept common casings for robustness.

---

## 10. What is NOT Case-Insensitive

### Resource Identifiers (`id`)

**RFC 7643 §3.1**:

> *"A unique identifier for a SCIM resource as defined by the service
> provider... Each representation of the resource MUST include a
> non-empty 'id' value. This identifier MUST be unique across the
> SCIM service provider's entire set of resources."*

`id` is marked `caseExact: true`. The values `"abc-123"` and `"ABC-123"` are **different** IDs.

```http
GET /scim/v2/Users/abc-123 HTTP/1.1
```
↑ Will NOT match a user whose `id` is `"ABC-123"`.

### External IDs (`externalId`)

`externalId` is marked `caseExact: true`:

```json
{ "externalId": "EMP-001" }
```

Filtering for `externalId eq "emp-001"` MUST NOT match this user.

### URL Path Segments

Per HTTP/1.1 (RFC 7230), URI paths are case-sensitive. The SCIM spec does not override this:

```
/scim/v2/Users    ← Standard
/scim/v2/users    ← Different path (NOT guaranteed to work)
/scim/v2/USERS    ← Different path (NOT guaranteed to work)
```

### Bearer Tokens

```http
Authorization: Bearer eyJhbGciOiJSUzI1...
```

Token values are always case-sensitive.

### ETag Values

```http
If-Match: W/"e180ee84f0671b1"
```

ETags are opaque and case-sensitive per RFC 7232.

### Passwords

`password` is `caseExact: true` — always case-sensitive (and write-only; never returned).

---

## 11. Microsoft Entra ID Specifics

When building a SCIM server for Microsoft Entra ID provisioning, these additional case-sensitivity behaviors are important:

### Entra ID Sends PascalCase `op` Values

```json
{ "op": "Add", "path": "members", "value": [{"value": "id"}] }
{ "op": "Replace", "path": "displayName", "value": "New" }
{ "op": "Remove", "path": "members[value eq \"id\"]" }
```

### Entra ID Sends Mixed-Case Attribute Names

Entra ID typically sends canonical camelCase, but extension paths use full URN notation:

```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering"
  }
}
```

### Entra ID PATCH with No `path` (Bulk Replace)

Entra sends PATCH operations without a `path` to replace multiple attributes at once:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "Replace",
      "value": {
        "displayName": "Updated Name",
        "name.givenName": "Updated",
        "active": true
      }
    }
  ]
}
```

The attribute names in the `value` object (when `path` is absent) are also case-insensitive.

### Entra ID Sends `filter` with `externalId`

```http
GET /scim/v2/Users?filter=externalId eq "EMP-001" HTTP/1.1
```

Since `externalId` is `caseExact: true`, the value comparison MUST be case-sensitive, but the attribute name `externalId` in the filter is still case-insensitive.

---

## 12. Implementation Checklist

> **Status**: Updated February 18, 2026 — Phase 5 SCIM Validator compliance complete + performance fixes in current v0.10.0 baseline

### Attribute Name Resolution

- [ ] Incoming request body attribute names are matched case-insensitively to the schema
- [x] Filter expressions resolve attribute names case-insensitively (`buildFilter()` uses `.toLowerCase()` switch)
- [x] PATCH `path` attribute names resolved case-insensitively (extension URN matching)
- [ ] `sortBy` parameter resolved case-insensitively (sort not supported — `ServiceProviderConfig.sort.supported: false`)
- [x] `attributes` / `excludedAttributes` query parameters resolved case-insensitively (`stripExcludedAttributes()` in groups controller)
- [x] Extension URN prefixes in attribute paths resolved case-insensitively (`scim-patch-path.ts`)

### Schema URI Matching

- [x] `schemas` array values compared case-insensitively (`ensureSchema()` uses `.toLowerCase()`)
- [ ] Extension URN keys in request bodies matched case-insensitively
- [x] PATCH schema validation (`urn:ietf:params:scim:api:messages:2.0:PatchOp`) case-insensitive

### Filter Processing

- [ ] Operator keywords (`eq`, `ne`, `co`, `sw`, `ew`, `pr`, `gt`, `ge`, `lt`, `le`) accepted in any case
- [ ] Logical operators (`and`, `or`, `not`) accepted in any case
- [x] Attribute paths in filters resolved case-insensitively
- [x] Value comparison respects `caseExact` characteristic per attribute (in-code `.toLowerCase()` for userName/displayName)

### PATCH Operations

- [ ] `op` values accepted in any case (`add`/`Add`/`ADD`)
- [x] `path` attribute references resolved case-insensitively (extension URN paths)
- [x] Value-path filter expressions in `path` handle case-insensitive attribute names (`matchesFilter()`)
- [x] No-path PATCH: attribute names in `value` object resolved via `resolveNoPathValue()` (dot-notation + URN keys)

### Value Comparison

- [x] `caseExact: false` attributes compared case-insensitively for filtering (in-code `.toLowerCase()` — SQLite compatible)
- [x] `caseExact: false` attributes compared case-insensitively for uniqueness (`userNameLower` unique constraint for Users, `assertUniqueDisplayName()` for Groups)
- [x] `caseExact: true` attributes (`id`, `externalId`, `password`) compared case-sensitively
- [x] `members[].value` compared case-sensitively (references `id`)

### Database Changes

- [x] Added `userNameLower` column to `ScimUser` model (Prisma schema)
- [x] Unique constraint moved from `[endpointId, userName]` to `[endpointId, userNameLower]`
- [x] Migration SQL: `20260209120000_add_username_lower_column` — ALTER TABLE, backfill, re-index
- [x] All write paths (create, replace, PATCH) set `userNameLower = userName.toLowerCase()`
- [x] Added `displayNameLower` column to `ScimGroup` model (Prisma schema) — introduced in v0.9.1, current in v0.10.0
- [x] Unique constraint `@@unique([endpointId, displayNameLower])` for Groups — introduced in v0.9.1, current in v0.10.0
- [x] Migration SQL: `20260213064256_add_display_name_lower` — ALTER TABLE, backfill `LOWER(displayName)`, re-index — introduced in v0.9.1, current in v0.10.0
- [x] All group write paths (create, PATCH, PUT) set `displayNameLower = displayName.toLowerCase()` — introduced in v0.9.1, current in v0.10.0
- [x] Group filter `displayName eq` now uses DB push-down via `displayNameLower` column (no longer in-memory scan) — introduced in v0.9.1, current in v0.10.0
- [x] `assertUniqueDisplayName` refactored from `findMany` O(N) to `findFirst` O(1) using `displayNameLower` index — introduced in v0.9.1, current in v0.10.0
- [x] ServiceProviderConfig: `sort.supported` set to `false`
- [x] In-code filtering for case-insensitive userName/displayName (SQLite doesn't support Prisma `mode: 'insensitive'`)

---

## Appendix A — Quick Reference Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    SCIM REQUEST ANATOMY                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GET /scim/v2/Users?filter=userName eq "John"&sortBy=familyName │
│      ─────────────  ──────── ── ──────  ────── ──────────────── │
│      URL path       attrName op  value  param   attrName        │
│      (sensitive)    (INSENS) (INSENS) (depends)  (INSENS)       │
│                                        on caseExact              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PATCH body:                                                     │
│  {                                                               │
│    "schemas": ["urn:...PatchOp"],    ← URI: case-INSENSITIVE    │
│    "Operations": [{                                              │
│      "op": "Replace",                ← op: should be INSENSITIVE│
│      "path": "name.familyName",      ← path: case-INSENSITIVE  │
│      "value": "Smith"                ← value: depends on attr   │
│    }]                                                            │
│  }                                                               │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LEGEND                                                          │
│  ───────                                                         │
│  INSENSITIVE = MUST accept any casing                            │
│  SENSITIVE   = Casing matters                                    │
│  depends     = Check caseExact characteristic of the attribute   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Appendix B — RFC Cross-Reference

| Requirement | RFC | Section | Key Quote |
|---|---|---|---|
| Attribute names case-insensitive | RFC 7643 | §2.1 | *"Attribute names are case insensitive"* |
| Schema URIs case-insensitive | RFC 7643 | §2.1 | *"schema URIs...are also case insensitive"* |
| `caseExact` controls value comparison | RFC 7643 | §2.4 | *"the 'caseExact' characteristic determines how string value comparisons are handled"* |
| Filter attribute names case-insensitive | RFC 7644 | §3.4.2.2 | *"Attribute names and attribute operators used in filters are case insensitive"* |
| Filter operators case-insensitive | RFC 7644 | §3.4.2.2 | (same as above) |
| PATCH operations | RFC 7644 | §3.5.2 | `op` member + `path` uses attribute references |
| `id` is `caseExact: true` | RFC 7643 | §3.1 | Defined in schema with `caseExact: true` |
| `externalId` is `caseExact: true` | RFC 7643 | §3.1 | Defined in schema with `caseExact: true` |

---

*This document is a reference companion to the [SCIM v2 Reference](SCIM_V2_REFERENCE.md) and [SCIM 2.0 Compliance Analysis](SCIM_2.0_COMPLIANCE_ANALYSIS.md).*
