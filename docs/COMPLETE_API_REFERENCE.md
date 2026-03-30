# Complete API Reference

> **Version:** 0.30.0 · **Updated:** March 26, 2026  
> **Base URL:** `http://localhost:{PORT}/scim` (default port: 3000, Docker: 8080)  
> **Content-Type:** `application/scim+json` for SCIM operations, `application/json` for admin

---

## Table of Contents

- [Authentication](#authentication)
- [Admin API — Endpoints](#admin-api--endpoints)
- [Admin API — Credentials](#admin-api--credentials)
- [SCIM — Users](#scim--users)
- [SCIM — Groups](#scim--groups)
- [SCIM — Bulk Operations](#scim--bulk-operations)
- [SCIM — Search](#scim--search)
- [SCIM — /Me Endpoint](#scim--me-endpoint)
- [SCIM — Discovery](#scim--discovery)
- [Logging & Observability](#logging--observability)
- [Health Check](#health-check)
- [Error Responses](#error-responses)
- [Common Headers](#common-headers)

---

## Authentication

### POST /scim/oauth/token

Get an OAuth 2.0 access token.

```http
POST /scim/oauth/token
Content-Type: application/json

{
  "grant_type": "client_credentials",
  "client_id": "scimserver-client",
  "client_secret": "<OAUTH_CLIENT_SECRET>"
}
```

**Response: 201 Created**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

| Status | Condition |
|--------|-----------|
| 201 | Token issued |
| 401 | Invalid client credentials |

---

## Admin API — Endpoints

### POST /scim/admin/endpoints

Create a new SCIM endpoint (tenant).

```http
POST /scim/admin/endpoints
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "my-tenant",
  "displayName": "My Tenant",
  "description": "Production Entra provisioning",
  "profilePreset": "entra-id"
}
```

**Response: 201 Created**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "my-tenant",
  "displayName": "My Tenant",
  "description": "Production Entra provisioning",
  "active": true,
  "profile": {
    "schemas": [ { "id": "urn:ietf:params:scim:schemas:core:2.0:User", "name": "User", "attributes": [...] }, "..." ],
    "resourceTypes": [ { "id": "User", "name": "User", "endpoint": "/Users", "..." } ],
    "serviceProviderConfig": { "patch": { "supported": true }, "bulk": { "supported": false }, "..." },
    "settings": { "AllowAndCoerceBooleanStrings": "True", "VerbosePatchSupported": "True", "..." }
  },
  "createdAt": "2026-03-17T10:00:00.000Z",
  "updatedAt": "2026-03-17T10:00:00.000Z"
}
```

**Body options (mutually exclusive):**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (required) | Unique endpoint name |
| `displayName` | string | Human-readable label |
| `description` | string | Description |
| `profilePreset` | string | One of: `entra-id`, `entra-id-minimal`, `rfc-standard`, `minimal`, `user-only`, `lexmark` |
| `profile` | object | Inline profile (schemas, resourceTypes, serviceProviderConfig, settings) |

### GET /scim/admin/endpoints

List all endpoints.

```http
GET /scim/admin/endpoints
Authorization: Bearer <token>
```

**Response: 200 OK** — Array of endpoint objects.

### GET /scim/admin/endpoints/:id

Get endpoint by ID.

### PATCH /scim/admin/endpoints/:id

Update endpoint — deep-merges profile settings.

```http
PATCH /scim/admin/endpoints/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "displayName": "Updated Name",
  "profile": {
    "settings": {
      "SoftDeleteEnabled": "True",
      "RequireIfMatch": "True"
    }
  }
}
```

Settings are **deep-merged**: existing settings are preserved, only specified keys are added/overwritten. Schemas and SPC are replaced if provided.

### DELETE /scim/admin/endpoints/:id

Delete endpoint (**cascades** — deletes all users, groups, logs, credentials).

**Response: 204 No Content**

---

## Admin API — Credentials

### POST /scim/admin/endpoints/:id/credentials

Create a per-endpoint credential.

```http
POST /scim/admin/endpoints/:id/credentials
Authorization: Bearer <token>
Content-Type: application/json

{
  "credentialType": "bearer",
  "token": "my-secret-token",
  "label": "Entra provisioning"
}
```

**Response: 201 Created**

```json
{
  "id": "cred-uuid",
  "credentialType": "bearer",
  "label": "Entra provisioning",
  "active": true,
  "createdAt": "2026-03-17T10:00:00.000Z"
}
```

### GET /scim/admin/endpoints/:id/credentials

List all credentials for an endpoint (hashes never returned).

### DELETE /scim/admin/endpoints/:id/credentials/:credId

Deactivate a credential.

---

## SCIM — Users

> **Base path:** `/scim/endpoints/{endpointId}/Users`

### POST — Create User

```http
POST /scim/endpoints/{endpointId}/Users
Authorization: Bearer <token>
Content-Type: application/scim+json

{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "userName": "jdoe@example.com",
  "externalId": "ext-001",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    { "value": "jdoe@example.com", "type": "work", "primary": true }
  ],
  "active": true,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering",
    "costCenter": "CC-100",
    "employeeNumber": "E-001"
  }
}
```

**Response: 201 Created**

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "externalId": "ext-001",
  "userName": "jdoe@example.com",
  "name": { "givenName": "John", "familyName": "Doe", "formatted": "John Doe" },
  "displayName": "John Doe",
  "emails": [ { "value": "jdoe@example.com", "type": "work", "primary": true } ],
  "active": true,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering",
    "costCenter": "CC-100",
    "employeeNumber": "E-001"
  },
  "meta": {
    "resourceType": "User",
    "created": "2026-03-17T10:00:00.000Z",
    "lastModified": "2026-03-17T10:00:00.000Z",
    "location": "/scim/endpoints/a1b2.../Users/b2c3...",
    "version": "W/\"1\""
  }
}
```

| Status | Condition |
|--------|-----------|
| 201 | User created |
| 400 | Missing required attribute (e.g., `userName`) |
| 409 | `userName` already exists (uniqueness violation) |

### GET — Read User

```http
GET /scim/endpoints/{endpointId}/Users/{userId}
Authorization: Bearer <token>
Accept: application/scim+json
```

**Query parameters:**

| Parameter | Description |
|-----------|-------------|
| `attributes` | Comma-separated list of attributes to return |
| `excludedAttributes` | Comma-separated list of attributes to exclude |

### GET — List Users

```http
GET /scim/endpoints/{endpointId}/Users?filter=userName eq "jdoe@example.com"&startIndex=1&count=10&sortBy=userName&sortOrder=ascending
Authorization: Bearer <token>
```

**Response: 200 OK**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [ { "id": "...", "userName": "jdoe@example.com", "..." } ]
}
```

**Supported filter operators:** `eq`, `ne`, `co`, `sw`, `ew`, `pr`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`

### PUT — Replace User

```http
PUT /scim/endpoints/{endpointId}/Users/{userId}
Authorization: Bearer <token>
Content-Type: application/scim+json
If-Match: W/"1"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "jdoe@example.com",
  "displayName": "John Updated",
  "active": true
}
```

| Status | Condition |
|--------|-----------|
| 200 | User replaced |
| 404 | User not found |
| 409 | `userName` uniqueness violation |
| 412 | ETag precondition failed (if `RequireIfMatch` is enabled) |
| 428 | `If-Match` required but not provided |

### PATCH — Modify User

```http
PATCH /scim/endpoints/{endpointId}/Users/{userId}
Authorization: Bearer <token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "displayName", "value": "Jane Doe" },
    { "op": "replace", "path": "active", "value": false },
    { "op": "add", "value": { "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { "department": "Sales" } } },
    { "op": "remove", "path": "nickName" }
  ]
}
```

### DELETE — Delete User

```http
DELETE /scim/endpoints/{endpointId}/Users/{userId}
Authorization: Bearer <token>
```

**Response: 204 No Content** (or soft-delete if `SoftDeleteEnabled` is on)

---

## SCIM — Groups

> **Base path:** `/scim/endpoints/{endpointId}/Groups`

Same CRUD pattern as Users. Key differences:

### POST — Create Group

```http
POST /scim/endpoints/{endpointId}/Groups
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering",
  "members": [
    { "value": "b2c3d4e5-...", "display": "John Doe" }
  ]
}
```

### PATCH — Add/Remove Members

```http
PATCH /scim/endpoints/{endpointId}/Groups/{groupId}
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [{ "value": "user-uuid-1" }, { "value": "user-uuid-2" }]
    }
  ]
}
```

> **Note:** Multi-member add/remove requires `MultiOpPatchRequestAddMultipleMembersToGroup` / `MultiOpPatchRequestRemoveMultipleMembersFromGroup` to be enabled.

---

## SCIM — Bulk Operations

> **Requires** `profile.serviceProviderConfig.bulk.supported = true` (e.g., `rfc-standard` preset)

```http
POST /scim/endpoints/{endpointId}/Bulk
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "Operations": [
    {
      "method": "POST",
      "path": "/Users",
      "bulkId": "user1",
      "data": {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "userName": "bulk1@example.com",
        "displayName": "Bulk User 1"
      }
    },
    {
      "method": "DELETE",
      "path": "/Users/some-user-id"
    }
  ]
}
```

**Response: 200 OK**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"],
  "Operations": [
    { "method": "POST", "bulkId": "user1", "status": "201", "location": "/Users/new-uuid", "response": { "..." } },
    { "method": "DELETE", "status": "204" }
  ]
}
```

---

## SCIM — Search

### POST /.search

```http
POST /scim/endpoints/{endpointId}/Users/.search
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "displayName co \"John\"",
  "startIndex": 1,
  "count": 10,
  "sortBy": "userName",
  "sortOrder": "ascending",
  "attributes": ["userName", "displayName", "emails"]
}
```

---

## SCIM — /Me Endpoint

Proxies to the current user's resource. Requires the `Authorization` token to map to a specific user (via endpoint credentials).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scim/endpoints/{id}/Me` | Get current authenticated user |
| PATCH | `/scim/endpoints/{id}/Me` | Update current user |
| PUT | `/scim/endpoints/{id}/Me` | Replace current user |
| DELETE | `/scim/endpoints/{id}/Me` | Delete current user |

---

## SCIM — Discovery

### GET /Schemas

```http
GET /scim/endpoints/{endpointId}/Schemas
```

Returns all schemas defined in the endpoint profile.

### GET /Schemas/{schemaId}

```http
GET /scim/endpoints/{endpointId}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User
```

### GET /ResourceTypes

```http
GET /scim/endpoints/{endpointId}/ResourceTypes
```

### GET /ServiceProviderConfig

```http
GET /scim/endpoints/{endpointId}/ServiceProviderConfig
```

**Response:**

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "patch": { "supported": true },
  "bulk": { "supported": false, "maxOperations": 0, "maxPayloadSize": 0 },
  "filter": { "supported": true, "maxResults": 200 },
  "changePassword": { "supported": false },
  "sort": { "supported": true },
  "etag": { "supported": true },
  "authenticationSchemes": [
    { "type": "oauthbearertoken", "name": "OAuth Bearer Token", "description": "Authentication via OAuth 2.0 bearer token" }
  ]
}
```

---

## Logging & Observability

### GET /scim/admin/endpoints/:id/logs

```http
GET /scim/admin/endpoints/:id/logs?limit=50&method=POST&status=201
```

Returns structured request/response logs.

### GET /scim/admin/log-config

Get current global and per-endpoint log levels.

### PATCH /scim/admin/log-config

Update log configuration.

```json
{ "level": "debug" }
```

---

## Health Check

### GET /scim/health

```json
{ "status": "ok" }
```

### GET /scim/admin/version

```json
{
  "version": "0.29.0",
  "node": "v24.x.x",
  "uptime": 3600,
  "persistence": "inmemory"
}
```

---

## Error Responses

All errors follow the SCIM error format (RFC 7644 §3.12):

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "A user with userName 'jdoe@example.com' already exists in this endpoint."
}
```

| Status | scimType | Common Cause |
|--------|----------|--------------|
| 400 | `invalidSyntax` | Missing required attribute, malformed body |
| 400 | `invalidValue` | Invalid attribute type or value |
| 400 | `invalidFilter` | Malformed SCIM filter expression |
| 400 | `invalidPath` | Invalid PATCH path |
| 400 | `mutability` | Attempt to write readOnly/immutable attribute |
| 401 | — | Missing or invalid authentication |
| 404 | — | Resource not found |
| 409 | `uniqueness` | Duplicate `userName` or `displayName` |
| 412 | — | ETag precondition failed |
| 413 | `tooLarge` | Bulk payload exceeds `maxPayloadSize` |
| 415 | — | Unsupported Content-Type (not `application/scim+json` or `application/json`) |
| 428 | — | `If-Match` required but missing (when `RequireIfMatch` is on) |
| 500 | — | Internal server error |

---

## Common Headers

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <token>` |
| `Content-Type` | For POST/PUT/PATCH | `application/scim+json` or `application/json` |
| `Accept` | No | `application/scim+json` |
| `If-Match` | Conditional | ETag value for conditional writes (required if `RequireIfMatch` is on) |
| `If-None-Match` | No | For conditional GET |

### Response Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/scim+json;charset=utf-8` |
| `ETag` | Resource version (`W/"1"`, `W/"2"`, etc.) |
| `Location` | Full URL of created/returned resource |
| `Warning` | ReadOnly attribute stripping warnings (RFC 7234 format) |
