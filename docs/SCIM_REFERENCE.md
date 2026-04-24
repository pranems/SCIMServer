# SCIM 2.0 Protocol Reference

> **Version:** 0.38.0 - **Updated:** April 24, 2026  
> Quick reference for SCIM operations with SCIMServer-specific examples

---

## Table of Contents

- [URL Structure](#url-structure)
- [Resource Operations](#resource-operations)
- [User Resource](#user-resource)
- [Group Resource](#group-resource)
- [PATCH Operations](#patch-operations)
- [Filtering](#filtering)
- [Sorting & Pagination](#sorting--pagination)
- [Attribute Projection](#attribute-projection)
- [Bulk Operations](#bulk-operations)
- [Discovery Endpoints](#discovery-endpoints)
- [Error Handling](#error-handling)
- [Schema URNs](#schema-urns)

---

## URL Structure

All SCIM operations are scoped to an endpoint:

```
{base}/scim/endpoints/{endpointId}/{ResourceType}
{base}/scim/endpoints/{endpointId}/{ResourceType}/{resourceId}
```

**Examples:**
```
http://localhost:8080/scim/endpoints/a1b2c3d4-.../Users
http://localhost:8080/scim/endpoints/a1b2c3d4-.../Users/f47ac10b-...
http://localhost:8080/scim/endpoints/a1b2c3d4-.../Groups
http://localhost:8080/scim/endpoints/a1b2c3d4-.../Groups/g1234567-...
http://localhost:8080/scim/endpoints/a1b2c3d4-.../Bulk
http://localhost:8080/scim/endpoints/a1b2c3d4-.../Me
http://localhost:8080/scim/endpoints/a1b2c3d4-.../Users/.search
```

**Entra ID URL rewrite:** `/scim/v2/*` is auto-rewritten to `/scim/*` for Entra ID compatibility.

---

## Resource Operations

| Operation | HTTP Method | URL | Status | Description |
|-----------|------------|-----|--------|-------------|
| Create | POST | `/{type}` | 201 | Create resource, returns Location + ETag |
| Read | GET | `/{type}/{id}` | 200 | Get single resource. Supports If-None-Match (304) |
| List | GET | `/{type}` | 200 | List with filter, sort, pagination, projection |
| Replace | PUT | `/{type}/{id}` | 200 | Full replacement. Supports If-Match |
| Modify | PATCH | `/{type}/{id}` | 200 | Partial update via operations. Supports If-Match |
| Delete | DELETE | `/{type}/{id}` | 204 | Remove resource. Supports If-Match |
| Search | POST | `/{type}/.search` | 200 | Server-side search via POST body |

### Delete Behavior

| Config Flag | Default | DELETE Behavior |
|------------|---------|-----------------|
| `UserHardDeleteEnabled` | `true` | Permanently removes user row |
| `GroupHardDeleteEnabled` | `true` | Permanently removes group + memberships |
| When disabled | - | Returns 400 (deletion not permitted) |

**Soft delete** is separate: PATCH `active: false` deactivates the user (sets `deletedAt` timestamp). Controlled by `UserSoftDeleteEnabled` flag.

---

## User Resource

### Minimal User (POST)

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "jane@example.com"
}
```

### Full User (POST)

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "userName": "jane@example.com",
  "externalId": "ext-001",
  "name": {
    "formatted": "Ms. Jane M. Doe",
    "familyName": "Doe",
    "givenName": "Jane",
    "middleName": "Marie",
    "honorificPrefix": "Ms.",
    "honorificSuffix": "III"
  },
  "displayName": "Jane Doe",
  "nickName": "jdoe",
  "profileUrl": "https://example.com/jane",
  "title": "Senior Engineer",
  "userType": "Employee",
  "preferredLanguage": "en-US",
  "locale": "en-US",
  "timezone": "America/New_York",
  "active": true,
  "password": "secret123",
  "emails": [
    { "value": "jane@example.com", "type": "work", "primary": true },
    { "value": "jane.home@example.com", "type": "home" }
  ],
  "phoneNumbers": [
    { "value": "+1-555-0100", "type": "work" },
    { "value": "+1-555-0101", "type": "mobile" }
  ],
  "addresses": [
    {
      "streetAddress": "100 Main St",
      "locality": "Springfield",
      "region": "IL",
      "postalCode": "62701",
      "country": "US",
      "type": "work",
      "primary": true
    }
  ],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "EMP-001",
    "costCenter": "CC-1234",
    "organization": "Engineering",
    "division": "Product",
    "department": "Backend",
    "manager": {
      "value": "manager-scim-id",
      "displayName": "Bob Manager"
    }
  }
}
```

### User Response

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "f47ac10b-...",
  "userName": "jane@example.com",
  "displayName": "Jane Doe",
  "active": true,
  "externalId": null,
  "meta": {
    "resourceType": "User",
    "created": "2026-04-24T10:00:00.000Z",
    "lastModified": "2026-04-24T10:00:00.000Z",
    "location": "http://localhost:8080/scim/v2/endpoints/{epId}/Users/f47ac10b-...",
    "version": "W/\"1\""
  }
}
```

**Note:** `password` is never returned (`returned: never`). `id` and `meta` are server-assigned (`mutability: readOnly`).

---

## Group Resource

### Group (POST)

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    { "value": "user-scim-id-1" },
    { "value": "user-scim-id-2" }
  ]
}
```

### Group Response

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "g1234567-...",
  "displayName": "Engineering Team",
  "members": [
    { "value": "user-scim-id-1", "display": "jane@example.com", "type": "User" },
    { "value": "user-scim-id-2", "display": "john@example.com", "type": "User" }
  ],
  "meta": {
    "resourceType": "Group",
    "created": "2026-04-24T10:00:00.000Z",
    "lastModified": "2026-04-24T10:00:00.000Z",
    "location": "http://localhost:8080/scim/v2/endpoints/{epId}/Groups/g1234567-...",
    "version": "W/\"1\""
  }
}
```

**Uniqueness:** `displayName` is unique per endpoint (409 on conflict).

---

## PATCH Operations

### Request Format

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "add|replace|remove", "path": "...", "value": "..." }
  ]
}
```

### Path Styles

| Style | Example | Notes |
|-------|---------|-------|
| Simple | `"displayName"` | Direct top-level attribute |
| Dot-notation | `"name.givenName"` | Requires `VerbosePatchSupported` |
| ValuePath | `"emails[type eq \"work\"].value"` | Filter-based targeting |
| Extension URN | `"urn:...:enterprise:2.0:User:department"` | Extension namespace |
| No-path | omit `path` | Merge `value` as partial resource |

### Common Patterns

```json
// Replace simple attribute
{ "op": "replace", "path": "displayName", "value": "New Name" }

// Add email
{ "op": "add", "path": "emails", "value": [{ "value": "new@example.com", "type": "home" }] }

// Replace specific email value
{ "op": "replace", "path": "emails[type eq \"work\"].value", "value": "updated@example.com" }

// Remove phone number
{ "op": "remove", "path": "phoneNumbers[type eq \"fax\"]" }

// Update extension attribute
{ "op": "replace", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Product" }

// Deactivate user (soft-delete)
{ "op": "replace", "path": "active", "value": false }

// Add members to group
{ "op": "add", "path": "members", "value": [{ "value": "user-id-1" }, { "value": "user-id-2" }] }

// Remove specific member
{ "op": "remove", "path": "members[value eq \"user-id-to-remove\"]" }

// No-path merge
{ "op": "replace", "value": { "displayName": "New", "title": "Lead" } }
```

---

## Filtering

### Syntax

```
GET /Users?filter={expression}
```

### Operators

| Operator | Syntax | Example |
|----------|--------|---------|
| Equal | `eq` | `userName eq "jane"` |
| Not equal | `ne` | `active ne false` |
| Contains | `co` | `displayName co "Smith"` |
| Starts with | `sw` | `userName sw "j"` |
| Ends with | `ew` | `emails.value ew "@example.com"` |
| Greater than | `gt` | `meta.created gt "2026-01-01"` |
| Greater or equal | `ge` | `meta.lastModified ge "2026-01-01"` |
| Less than | `lt` | `meta.created lt "2026-12-31"` |
| Less or equal | `le` | `meta.lastModified le "2026-12-31"` |
| Present | `pr` | `externalId pr` |

### Logical Operators

```
userName sw "j" and active eq true
displayName co "Smith" or displayName co "Jones"
not (active eq false)
```

### ValuePath Filter

```
emails[type eq "work"].value co "@example.com"
```

---

## Sorting & Pagination

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sortBy` | `meta.created` | Attribute to sort by |
| `sortOrder` | `ascending` | `ascending` or `descending` |
| `startIndex` | `1` | 1-based pagination offset |
| `count` | `100` | Results per page (max 1000) |

### List Response Format

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 42,
  "startIndex": 1,
  "itemsPerPage": 10,
  "Resources": [ ... ]
}
```

---

## Attribute Projection

| Parameter | Effect |
|-----------|--------|
| `?attributes=userName,emails` | Return ONLY these + always-returned (schemas, id, meta) |
| `?excludedAttributes=phoneNumbers` | Return all defaults EXCEPT these |

### `returned` Characteristic

| Value | Always in response? | Excludable? | Needs explicit `?attributes=`? |
|-------|---------------------|-------------|-------------------------------|
| `always` | Yes | No | No |
| `default` | Yes | Yes | No |
| `request` | No | N/A | Yes |
| `never` | Never | N/A | N/A |

---

## Bulk Operations

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "failOnErrors": 2,
  "Operations": [
    { "method": "POST", "path": "/Users", "bulkId": "u1", "data": { ... } },
    { "method": "POST", "path": "/Groups", "bulkId": "g1", "data": { "members": [{ "value": "bulkId:u1" }] } },
    { "method": "PUT", "path": "/Users/{id}", "version": "W/\"1\"", "data": { ... } },
    { "method": "PATCH", "path": "/Groups/{id}", "data": { ... } },
    { "method": "DELETE", "path": "/Users/{id}" }
  ]
}
```

Limits: 1,000 operations, 1 MB payload. Requires `bulk.supported: true` in SPC.

---

## Discovery Endpoints

No authentication required (RFC 7644 S4):

| Endpoint | Description |
|----------|-------------|
| `GET /scim/Schemas` | All schema definitions |
| `GET /scim/Schemas/{urn}` | Single schema by URN |
| `GET /scim/ResourceTypes` | All resource types |
| `GET /scim/ResourceTypes/{id}` | Single resource type |
| `GET /scim/ServiceProviderConfig` | Server capabilities |

Per-endpoint discovery (returns endpoint-specific schema/RTs/SPC):

| Endpoint | Description |
|----------|-------------|
| `GET /scim/endpoints/{id}/Schemas` | Endpoint schemas |
| `GET /scim/endpoints/{id}/ResourceTypes` | Endpoint resource types |
| `GET /scim/endpoints/{id}/ServiceProviderConfig` | Endpoint SPC |

---

## Error Handling

### SCIM Error Format

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "User with userName 'jane@example.com' already exists",
  "urn:scimserver:api:messages:2.0:Diagnostics": {
    "requestId": "550e8400-...",
    "endpointId": "a1b2c3d4-...",
    "logsUrl": "/scim/endpoints/a1b2c3d4-.../logs/recent?requestId=550e8400-..."
  }
}
```

### Error Types

| scimType | Status | Cause |
|----------|--------|-------|
| `uniqueness` | 409 | Duplicate userName or displayName |
| `invalidFilter` | 400 | Malformed filter expression |
| `invalidSyntax` | 400 | Malformed request body |
| `invalidPath` | 400 | Invalid PATCH path |
| `noTarget` | 400 | PATCH target not found |
| `invalidValue` | 400 | Value fails validation |
| `mutability` | 400 | readOnly/immutable modification attempt |
| `versionMismatch` | 412 | If-Match ETag mismatch |
| `tooMany` | 400 | Too many results |
| `sensitive` | 403 | Blocked operation |
| `tooLarge` | 413 | Payload too large |

---

## Schema URNs

| URN | Purpose |
|-----|---------|
| `urn:ietf:params:scim:schemas:core:2.0:User` | Core User |
| `urn:ietf:params:scim:schemas:core:2.0:Group` | Core Group |
| `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` | Enterprise User |
| `urn:ietf:params:scim:api:messages:2.0:ListResponse` | List response |
| `urn:ietf:params:scim:api:messages:2.0:PatchOp` | PATCH request |
| `urn:ietf:params:scim:api:messages:2.0:BulkRequest` | Bulk request |
| `urn:ietf:params:scim:api:messages:2.0:BulkResponse` | Bulk response |
| `urn:ietf:params:scim:api:messages:2.0:SearchRequest` | POST .search |
| `urn:ietf:params:scim:api:messages:2.0:Error` | Error response |
| `urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig` | SPC |
| `urn:ietf:params:scim:schemas:core:2.0:Schema` | Schema definition |
| `urn:ietf:params:scim:schemas:core:2.0:ResourceType` | Resource type |
| `urn:scimserver:api:messages:2.0:Diagnostics` | Diagnostics extension |
