# SCIM v2 Reference & Examples

> **Status**: Living reference  
> **Last Updated**: February 18, 2026  
> **Baseline**: SCIMServer v0.10.0

> Implementation-agnostic SCIM 2.0 API reference with runnable example payloads.

---

## Basics

| Item | Value |
|------|-------|
| Specification | RFC 7643 (Schema), RFC 7644 (Protocol) |
| Media Type | `application/scim+json` (also accepts `application/json`) |
| Auth | `Authorization: Bearer <token>` (OAuth 2.0 bearer) |
| Error Format | `{"schemas":["urn:...:Error"], "status":"404", "scimType":"...", "detail":"..."}` |

---

## Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ServiceProviderConfig` | Server capabilities |
| `GET` | `/Schemas` | Schema definitions |
| `GET` | `/ResourceTypes` | User/Group resource types |
| `POST` | `/Users` | Create user (201 + Location) |
| `GET` | `/Users` | List users (filter, pagination, projection) |
| `GET` | `/Users/{id}` | Get user by ID |
| `POST` | `/Users/.search` | Search users via POST body |
| `PUT` | `/Users/{id}` | Replace user |
| `PATCH` | `/Users/{id}` | Partial update user |
| `DELETE` | `/Users/{id}` | Delete user (204) |
| `POST` | `/Groups` | Create group (201 + Location) |
| `GET` | `/Groups` | List groups |
| `GET` | `/Groups/{id}` | Get group by ID |
| `POST` | `/Groups/.search` | Search groups via POST body |
| `PUT` | `/Groups/{id}` | Replace group |
| `PATCH` | `/Groups/{id}` | Partial update group |
| `DELETE` | `/Groups/{id}` | Delete group (204) |

---

## Example Payloads

### Full User Resource (Core + Enterprise Extension)

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "externalId": "701984",
  "userName": "bjensen@example.com",
  "name": {
    "formatted": "Ms. Barbara J Jensen, III",
    "familyName": "Jensen",
    "givenName": "Barbara"
  },
  "displayName": "Babs Jensen",
  "active": true,
  "emails": [
    { "value": "bjensen@example.com", "type": "work", "primary": true },
    { "value": "babs@jensen.org", "type": "home" }
  ],
  "phoneNumbers": [
    { "value": "+1-555-555-8377", "type": "work" }
  ],
  "addresses": [
    { "streetAddress": "100 Universal City Plaza", "locality": "Hollywood", "region": "CA", "postalCode": "91608", "country": "US", "type": "work" }
  ],
  "roles": [
    { "value": "Manager", "type": "work", "primary": true }
  ],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "701984",
    "costCenter": "4130",
    "organization": "Universal Studios",
    "department": "Tour Operations",
    "manager": { "value": "26118915-6090-4610-87e4-49d8ca9f808d", "displayName": "John Smith" }
  },
  "meta": {
    "resourceType": "User",
    "created": "2026-01-23T04:56:22Z",
    "lastModified": "2026-02-11T05:30:00Z",
    "location": "https://example.com/scim/v2/Users/2819c223-7f76-453a-919d-413861904646",
    "version": "W/\"2026-02-11T05:30:00.000Z\""
  }
}
```

### Full Group Resource

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "e9e30dba-f08f-4109-8486-d5c6a331660a",
  "displayName": "Engineering",
  "externalId": "group-eng-001",
  "members": [
    { "value": "2819c223-7f76-453a-919d-413861904646", "display": "Babs Jensen", "type": "User" }
  ],
  "meta": {
    "resourceType": "Group",
    "created": "2026-01-23T04:56:22Z",
    "lastModified": "2026-02-11T05:30:00Z",
    "location": "https://example.com/scim/v2/Groups/e9e30dba-f08f-4109-8486-d5c6a331660a",
    "version": "W/\"2026-02-11T05:30:00.000Z\""
  }
}
```

### ListResponse

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [ { "...": "..." } ]
}
```

---

## Filtering (RFC 7644 §3.4.2.2)

### Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `filter` | Filter expression | `filter=userName eq "bjensen@example.com"` |
| `startIndex` | 1-based pagination start | `startIndex=1` |
| `count` | Page size | `count=25` |
| `attributes` | Return only these attributes | `attributes=userName,displayName` |
| `excludedAttributes` | Exclude these attributes | `excludedAttributes=emails,members` |

### Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equal | `userName eq "bjensen"` |
| `ne` | Not equal | `active ne false` |
| `co` | Contains | `userName co "jensen"` |
| `sw` | Starts with | `userName sw "bjen"` |
| `ew` | Ends with | `userName ew "sen"` |
| `pr` | Present (has value) | `externalId pr` |
| `and` / `or` / `not` | Logical operators | `userName eq "a" and active eq true` |

> **SCIMServer note:** `eq` is fully implemented with case-insensitive matching. Other operators have limited support.

---

## POST /.search (RFC 7644 §3.4.3)

Search via POST body instead of query parameters:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "userName eq \"bjensen@example.com\"",
  "startIndex": 1,
  "count": 10,
  "attributes": "userName,displayName",
  "excludedAttributes": "emails"
}
```

Returns `200 OK` with a ListResponse (not 201).

---

## PATCH Operations (RFC 7644 §3.5.2)

### Replace displayName

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "displayName", "value": "New Name" }
  ]
}
```

### Add Member to Group

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "add", "path": "members", "value": [{ "value": "user-uuid-here" }] }
  ]
}
```

### Remove Member by Filter

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "remove", "path": "members[value eq \"user-uuid-here\"]" }
  ]
}
```

### No-Path Replace (Object Merge)

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "value": { "displayName": "Updated Name", "active": false } }
  ]
}
```

### Update Email by ValuePath Filter

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "emails[type eq \"work\"].value", "value": "newemail@example.com" }
  ]
}
```

---

## ETag / Conditional Requests (RFC 7644 §3.14)

| Header | Direction | Behavior |
|--------|-----------|----------|
| `ETag` | Response | Weak ETag (`W/"<timestamp>"`) on GET/POST/PUT/PATCH |
| `If-None-Match` | Request | Send ETag value; returns 304 Not Modified if resource unchanged |
| `If-Match` | Request | Optimistic concurrency; returns 412 Precondition Failed if stale |

```bash
# Get resource with ETag
curl -i GET /Users/123
# → ETag: W/"2026-02-11T22:42:00.940Z"

# Conditional GET (returns 304 if unchanged)
curl -H 'If-None-Match: W/"2026-02-11T22:42:00.940Z"' GET /Users/123
# → 304 Not Modified
```

---

## Error Response Format (RFC 7644 §3.12)

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "User with userName 'bjensen@example.com' already exists"
}
```

Common status codes: `400` (Bad Request), `401` (Unauthorized), `403` (Forbidden), `404` (Not Found), `409` (Conflict), `500` (Internal Server Error).

---

## Quick Reference: curl Examples

```bash
# Get OAuth token
TOKEN=$(curl -s -X POST http://localhost:6000/scim/oauth/token \
  -d "client_id=scimserver-client&client_secret=changeme-oauth&grant_type=client_credentials" \
  | jq -r '.access_token')

# Create user
curl -X POST http://localhost:6000/scim/endpoints/$EID/Users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"jane@example.com","active":true}'

# List users with filter & projection
curl "http://localhost:6000/scim/endpoints/$EID/Users?filter=userName%20eq%20%22jane%40example.com%22&attributes=userName,displayName" \
  -H "Authorization: Bearer $TOKEN"

# Search users via POST
curl -X POST "http://localhost:6000/scim/endpoints/$EID/Users/.search" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],"filter":"active eq true","count":10}'

# PATCH user
curl -X PATCH http://localhost:6000/scim/endpoints/$EID/Users/$UID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"replace","path":"displayName","value":"Updated"}]}'

# Delete user
curl -X DELETE http://localhost:6000/scim/endpoints/$EID/Users/$UID \
  -H "Authorization: Bearer $TOKEN"
```

---

*Consolidated from: SCIM_V2_REFERENCE, SCIM_FULL_EXAMPLES*
