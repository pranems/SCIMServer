# Complete API Reference

> **Version:** 0.40.0 - **Updated:** April 28, 2026  
> **Base URL:** `http://localhost:{PORT}/scim` (configurable via `API_PREFIX` env var)  
> **83 routes** across 19 controllers

---

## Table of Contents

- [Authentication](#authentication)
- [Common Headers](#common-headers)
- [Health & Version](#health--version)
- [Admin - Endpoint Management](#admin---endpoint-management)
- [Admin - Per-Endpoint Credentials](#admin---per-endpoint-credentials)
- [Admin - Logs & Audit Trail](#admin---logs--audit-trail)
- [Admin - Log Configuration](#admin---log-configuration)
- [Admin - Database Browser](#admin---database-browser)
- [Admin - Activity Feed](#admin---activity-feed)
- [Admin - Manual Provisioning](#admin---manual-provisioning)
- [SCIM Discovery - Root Level](#scim-discovery---root-level)
- [SCIM Discovery - Endpoint Scoped](#scim-discovery---endpoint-scoped)
- [SCIM Users](#scim-users)
- [SCIM Groups](#scim-groups)
- [SCIM Bulk Operations](#scim-bulk-operations)
- [SCIM POST Search](#scim-post-search)
- [SCIM /Me Endpoint](#scim-me-endpoint)
- [SCIM Custom Resource Types](#scim-custom-resource-types)
- [OAuth Token Endpoint](#oauth-token-endpoint)
- [Error Responses](#error-responses)
- [Route Summary Table](#route-summary-table)

---

## Authentication

### 3-Tier Authentication Chain

All requests (except public routes) are evaluated against 3 tiers in order:

| Tier | Mechanism | Header | Details |
|------|-----------|--------|---------|
| 1 | Per-endpoint credential | `Authorization: Bearer scim_ep_...` | Bcrypt-hashed, scoped to endpoint. Requires `PerEndpointCredentialsEnabled: true` |
| 2 | OAuth 2.0 JWT | `Authorization: Bearer eyJhbGci...` | JWT from `/scim/oauth/token`. Required for `/Me` |
| 3 | Global shared secret | `Authorization: Bearer {SCIM_SHARED_SECRET}` | Set via env var. Required in production |

### Public Routes (No Authentication)

| Route | RFC |
|-------|-----|
| `GET /health` | - |
| `GET /scim/Schemas`, `GET /scim/Schemas/:uri` | RFC 7644 S4 |
| `GET /scim/ResourceTypes`, `GET /scim/ResourceTypes/:id` | RFC 7644 S4 |
| `GET /scim/ServiceProviderConfig` | RFC 7644 S4 |
| `GET /scim/endpoints/:id/Schemas` | RFC 7644 S4 |
| `GET /scim/endpoints/:id/ResourceTypes` | RFC 7644 S4 |
| `GET /scim/endpoints/:id/ServiceProviderConfig` | RFC 7644 S4 |
| `POST /scim/oauth/token` | - |
| `GET /scim/oauth/test` | - |

---

## Common Headers

### Request Headers

| Header | Required | Value | Notes |
|--------|----------|-------|-------|
| `Authorization` | Yes (non-public) | `Bearer {token}` | Any tier token |
| `Content-Type` | POST/PUT/PATCH | `application/scim+json` or `application/json` | RFC 7644 S3.1 |
| `If-Match` | Conditional | `W/"{version}"` or `*` | ETag for PUT/PATCH/DELETE. Required if `RequireIfMatch: true` |
| `If-None-Match` | Optional | `W/"{version}"` | Conditional GET - returns 304 if match |

### Response Headers

| Header | Value | Notes |
|--------|-------|-------|
| `Content-Type` | `application/scim+json; charset=utf-8` | All SCIM responses |
| `Location` | Full resource URL | On 201 Created |
| `ETag` | `W/"{version}"` | On resource responses |
| `X-Request-Id` | UUID | Correlation ID for all requests |
| `WWW-Authenticate` | `Bearer realm="SCIM"` | On 401 responses |

---

## Health & Version

### GET /health

Health check endpoint. No authentication required.

```http
GET /health HTTP/1.1
Host: localhost:8080
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-04-24T10:00:00.000Z"
}
```

---

### GET /scim/admin/version

Server version and deployment metadata.

```http
GET /scim/admin/version HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "version": "0.40.0",
  "commit": "a1b2c3d",
  "buildTime": "2026-04-28T08:00:00.000Z",
  "service": "SCIMServer",
  "runtime": {
    "node": "v24.0.0",
    "platform": "linux",
    "arch": "x64",
    "pid": 1,
    "uptime": 3600,
    "memory": { "rss": 67108864, "heapUsed": 33554432, "heapTotal": 50331648 }
  },
  "auth": {
    "sharedSecret": "configured",
    "jwtSecret": "configured",
    "oauthClient": "scimserver-client"
  },
  "storage": {
    "backend": "prisma",
    "databaseUrl": "postgresql://scim:***@postgres:5432/scimdb"
  },
  "container": {
    "hostname": "scimserver-abc123",
    "image": "ghcr.io/your-org/scimserver:0.40.0"
  },
  "deployment": {
    "resourceGroup": "rg-scim",
    "appName": "scimserver",
    "registry": "scimregistry"
  }
}
```

---

## Admin - Endpoint Management

### POST /scim/admin/endpoints

Create a new endpoint (multi-tenant SCIM configuration).

```http
POST /scim/admin/endpoints HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "name": "entra-prod",
  "displayName": "Entra ID Production",
  "description": "Production provisioning target",
  "profilePreset": "entra-id"
}
```

**Response (201 Created):**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "entra-prod",
  "displayName": "Entra ID Production",
  "description": "Production provisioning target",
  "active": true,
  "scimBasePath": "/scim/endpoints/a1b2c3d4-e5f6-7890-abcd-ef1234567890/",
  "profile": {
    "schemas": [ "..." ],
    "resourceTypes": [ "..." ],
    "serviceProviderConfig": { "..." },
    "settings": { "..." }
  },
  "createdAt": "2026-04-24T10:00:00.000Z",
  "updatedAt": "2026-04-24T10:00:00.000Z"
}
```

**Body options:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique endpoint name (lowercase, alphanumeric + hyphens) |
| `displayName` | string | No | Human-readable label |
| `description` | string | No | Description text |
| `profilePreset` | string | No | Built-in preset name (mutually exclusive with `profile`) |
| `profile` | object | No | Inline profile definition (shorthand syntax) |

---

### GET /scim/admin/endpoints

List all endpoints.

```http
GET /scim/admin/endpoints?active=true&view=summary HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `active` | boolean | (all) | Filter by active status |
| `view` | string | `full` | `summary` omits full profile for smaller responses |

```json
{
  "totalResults": 2,
  "endpoints": [
    {
      "id": "a1b2c3d4-...",
      "name": "entra-prod",
      "displayName": "Entra ID Production",
      "active": true,
      "scimBasePath": "/scim/endpoints/a1b2c3d4-.../",
      "createdAt": "2026-04-24T10:00:00.000Z"
    },
    {
      "id": "b2c3d4e5-...",
      "name": "test-env",
      "active": true,
      "scimBasePath": "/scim/endpoints/b2c3d4e5-.../",
      "createdAt": "2026-04-24T09:00:00.000Z"
    }
  ]
}
```

---

### GET /scim/admin/endpoints/:endpointId

Get endpoint by ID.

```http
GET /scim/admin/endpoints/a1b2c3d4-e5f6-7890-abcd-ef1234567890 HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

Returns full endpoint object (same shape as POST response).

---

### GET /scim/admin/endpoints/by-name/:name

Get endpoint by name.

```http
GET /scim/admin/endpoints/by-name/entra-prod HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

---

### PATCH /scim/admin/endpoints/:endpointId

Update endpoint properties. Settings are deep-merged; schemas/resourceTypes/SPC are replaced.

```http
PATCH /scim/admin/endpoints/a1b2c3d4-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "displayName": "Updated Name",
  "active": false,
  "profile": {
    "settings": {
      "RequireIfMatch": true,
      "logLevel": "DEBUG"
    }
  }
}
```

**Response (200 OK):** Updated endpoint object.

---

### DELETE /scim/admin/endpoints/:endpointId

Delete endpoint and all associated resources, logs, and credentials (cascade).

```http
DELETE /scim/admin/endpoints/a1b2c3d4-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

**Response:** 204 No Content

---

### GET /scim/admin/endpoints/:endpointId/stats

Get resource counts for an endpoint.

```http
GET /scim/admin/endpoints/a1b2c3d4-.../stats HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "users": 150,
  "groups": 12,
  "groupMembers": 340,
  "requestLogs": 4200
}
```

---

### GET /scim/admin/endpoints/presets

List all built-in presets.

```http
GET /scim/admin/endpoints/presets HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "totalResults": 6,
  "presets": [
    { "name": "entra-id", "description": "Entra ID provisioning...", "default": true },
    { "name": "entra-id-minimal", "description": "Entra ID minimal..." },
    { "name": "rfc-standard", "description": "Full RFC 7643..." },
    { "name": "minimal", "description": "Bare minimum..." },
    { "name": "user-only", "description": "User provisioning only..." },
    { "name": "user-only-with-custom-ext", "description": "User-only with custom extension..." }
  ]
}
```

---

### GET /scim/admin/endpoints/presets/:name

Get preset details including full profile.

```http
GET /scim/admin/endpoints/presets/entra-id HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "metadata": {
    "name": "entra-id",
    "description": "Entra ID provisioning. Full RFC attributes, msfttest extensions, EnterpriseUser, Entra-compatible PATCH flags.",
    "default": true
  },
  "profile": {
    "schemas": [ "..." ],
    "resourceTypes": [ "..." ],
    "serviceProviderConfig": { "..." },
    "settings": { "..." }
  }
}
```

---

## Admin - Per-Endpoint Credentials

Requires `PerEndpointCredentialsEnabled: true` in endpoint settings.

### POST /scim/admin/endpoints/:endpointId/credentials

Create a new per-endpoint credential. The plaintext token is returned **only once**.

```http
POST /scim/admin/endpoints/a1b2c3d4-.../credentials HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "label": "entra-connector",
  "credentialType": "bearer",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

**Response (201 Created):**

```json
{
  "id": "cred-uuid-...",
  "endpointId": "a1b2c3d4-...",
  "credentialType": "bearer",
  "label": "entra-connector",
  "active": true,
  "createdAt": "2026-04-24T10:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "token": "scim_ep_a1b2c3d4e5f6..."
}
```

---

### GET /scim/admin/endpoints/:endpointId/credentials

List credentials (without hashes or tokens).

```http
GET /scim/admin/endpoints/a1b2c3d4-.../credentials HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
[
  {
    "id": "cred-uuid-...",
    "endpointId": "a1b2c3d4-...",
    "credentialType": "bearer",
    "label": "entra-connector",
    "active": true,
    "createdAt": "2026-04-24T10:00:00.000Z",
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }
]
```

---

### DELETE /scim/admin/endpoints/:endpointId/credentials/:credentialId

Revoke a credential.

```http
DELETE /scim/admin/endpoints/a1b2c3d4-.../credentials/cred-uuid-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

**Response:** 204 No Content

---

## Admin - Logs & Audit Trail

### GET /scim/admin/logs

Paginated audit trail from persistent RequestLog table.

```http
GET /scim/admin/logs?page=1&pageSize=20&method=POST&status=201&since=2026-04-01 HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 50 | Results per page |
| `method` | string | (all) | HTTP method filter |
| `status` | number | (all) | Status code filter |
| `hasError` | boolean | (all) | Filter for error responses |
| `urlContains` | string | (all) | URL substring filter |
| `since` | string | (all) | ISO date - from |
| `until` | string | (all) | ISO date - to |
| `search` | string | (all) | Full-text search |
| `includeAdmin` | boolean | false | Include admin API requests |
| `hideKeepalive` | boolean | false | Hide keepalive/health requests |
| `minDurationMs` | number | (all) | Minimum request duration |

---

### GET /scim/admin/logs/:id

Get full log entry details including request/response headers and bodies.

---

### POST /scim/admin/logs/clear

Clear all request logs. Returns 204 No Content.

---

### POST /scim/admin/logs/prune

Prune logs older than retention period.

```http
POST /scim/admin/logs/prune?retentionDays=7 HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{ "pruned": 1250 }
```

---

## Admin - Log Configuration

### GET /scim/admin/log-config

Get current log configuration.

```http
GET /scim/admin/log-config HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "globalLevel": "INFO",
  "categoryLevels": {},
  "endpointLevels": {},
  "includePayloads": true,
  "includeStackTraces": true,
  "maxPayloadSizeBytes": 8192,
  "slowRequestThresholdMs": 2000,
  "format": "pretty"
}
```

---

### PUT /scim/admin/log-config

Update log configuration.

```http
PUT /scim/admin/log-config HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "globalLevel": "DEBUG",
  "includePayloads": true,
  "slowRequestThresholdMs": 1000
}
```

---

### PUT /scim/admin/log-config/level/:level

Set global log level.

```http
PUT /scim/admin/log-config/level/DEBUG HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{ "message": "Global log level set to DEBUG", "globalLevel": "DEBUG" }
```

---

### PUT /scim/admin/log-config/category/:category/:level

Set category-specific log level.

```http
PUT /scim/admin/log-config/category/auth/TRACE HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

---

### PUT /scim/admin/log-config/endpoint/:endpointId/:level

Set endpoint-specific log level.

```http
PUT /scim/admin/log-config/endpoint/a1b2c3d4-.../TRACE HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

---

### DELETE /scim/admin/log-config/endpoint/:endpointId

Reset endpoint log level to global default.

---

### GET /scim/admin/log-config/recent

Query in-memory ring buffer.

```http
GET /scim/admin/log-config/recent?limit=50&level=ERROR&category=auth&requestId=550e8400-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "count": 3,
  "entries": [
    {
      "timestamp": "2026-04-24T10:00:00.000Z",
      "level": "ERROR",
      "category": "auth",
      "message": "Invalid bearer token",
      "requestId": "550e8400-...",
      "endpointId": "a1b2c3d4-..."
    }
  ]
}
```

---

### GET /scim/admin/log-config/audit

Query audit log entries.

```http
GET /scim/admin/log-config/audit?limit=20 HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

---

### DELETE /scim/admin/log-config/recent

Clear ring buffer. Returns 204 No Content.

---

### GET /scim/admin/log-config/stream

Server-Sent Events live log stream.

```http
GET /scim/admin/log-config/stream?level=INFO&category=scim&endpointId=a1b2c3d4-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Accept: text/event-stream
```

```
data: {"timestamp":"2026-04-24T10:00:00.000Z","level":"INFO","message":"POST /Users 201 45ms"}

data: {"timestamp":"2026-04-24T10:00:01.000Z","level":"INFO","message":"GET /Users 200 12ms"}
```

---

### GET /scim/admin/log-config/download

Download logs as file.

```http
GET /scim/admin/log-config/download?format=ndjson&limit=1000 HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

**Query Parameters:**

| Param | Options | Default |
|-------|---------|---------|
| `format` | `ndjson`, `json` | `ndjson` |
| `limit` | number | 1000 |
| `level` | log level | (all) |
| `category` | string | (all) |
| `requestId` | UUID | (all) |
| `endpointId` | UUID | (all) |

---

### GET /scim/admin/log-config/prune

Get auto-prune configuration.

---

### PUT /scim/admin/log-config/prune

Update auto-prune configuration.

```http
PUT /scim/admin/log-config/prune HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "retentionDays": 7,
  "intervalMs": 3600000,
  "enabled": true
}
```

---

## Admin - Database Browser

### GET /scim/admin/database/users

Browse users in the database.

```http
GET /scim/admin/database/users?page=1&limit=20&search=jane&active=true HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

---

### GET /scim/admin/database/groups

Browse groups.

```http
GET /scim/admin/database/groups?page=1&limit=20&search=engineering HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

---

### GET /scim/admin/database/users/:id

Get user detail by database ID.

---

### GET /scim/admin/database/groups/:id

Get group detail by database ID.

---

### GET /scim/admin/database/statistics

Get database statistics.

```http
GET /scim/admin/database/statistics HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

---

## Admin - Activity Feed

### GET /scim/admin/activity

Parsed provisioning activity timeline.

```http
GET /scim/admin/activity?page=1&limit=20&type=user&severity=info&hideKeepalive=true HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "activities": [
    {
      "id": "...",
      "timestamp": "2026-04-24T10:00:00.000Z",
      "type": "user",
      "action": "create",
      "severity": "info",
      "summary": "Created user jane.doe@example.com",
      "endpointId": "a1b2c3d4-...",
      "resourceId": "f47ac10b-..."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 150 },
  "filters": { "type": "user", "severity": "info" }
}
```

---

### GET /scim/admin/activity/summary

Activity summary statistics.

```http
GET /scim/admin/activity/summary HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

```json
{
  "summary": {
    "last24Hours": { "creates": 10, "updates": 25, "deletes": 2 },
    "lastWeek": { "creates": 50, "updates": 200, "deletes": 15 },
    "operations": { "user": 180, "group": 85 }
  }
}
```

---

## Admin - Manual Provisioning

### POST /scim/admin/users/manual

Create a user via simplified form (bypasses SCIM schema requirements).

```http
POST /scim/admin/users/manual HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "userName": "manual.user@example.com",
  "displayName": "Manual User",
  "givenName": "Manual",
  "familyName": "User",
  "email": "manual.user@example.com",
  "department": "IT",
  "active": true
}
```

**Response (200):** SCIM User resource (Content-Type: application/scim+json)

---

### POST /scim/admin/groups/manual

Create a group via simplified form.

```http
POST /scim/admin/groups/manual HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "displayName": "Manual Group",
  "memberIds": ["f47ac10b-...", "a83bc20e-..."]
}
```

---

### POST /scim/admin/users/:id/delete

Delete a user via admin API. Returns 204 No Content.

---

## SCIM Discovery - Root Level

These endpoints serve global schema definitions (from the `rfc-standard` preset baseline). No authentication required (RFC 7644 S4).

### GET /scim/Schemas

```http
GET /scim/Schemas HTTP/1.1
Host: localhost:8080
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 3,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      "id": "urn:ietf:params:scim:schemas:core:2.0:User",
      "name": "User",
      "description": "User Account",
      "attributes": [ "..." ],
      "meta": {
        "resourceType": "Schema",
        "location": "/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User"
      }
    }
  ]
}
```

---

### GET /scim/Schemas/:uri

Get a schema by URN.

```http
GET /scim/Schemas/urn:ietf:params:scim:schemas:core:2.0:User HTTP/1.1
Host: localhost:8080
```

---

### GET /scim/ResourceTypes

```http
GET /scim/ResourceTypes HTTP/1.1
Host: localhost:8080
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 2,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      "id": "User",
      "name": "User",
      "endpoint": "/Users",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
      "schemaExtensions": [
        {
          "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
          "required": false
        }
      ],
      "meta": {
        "resourceType": "ResourceType",
        "location": "/scim/v2/ResourceTypes/User"
      }
    }
  ]
}
```

---

### GET /scim/ResourceTypes/:id

Get resource type by ID.

---

### GET /scim/ServiceProviderConfig

```http
GET /scim/ServiceProviderConfig HTTP/1.1
Host: localhost:8080
```

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "documentationUri": "https://github.com/your-org/SCIMServer",
  "patch": { "supported": true },
  "bulk": { "supported": true, "maxOperations": 1000, "maxPayloadSize": 1048576 },
  "filter": { "supported": true, "maxResults": 200 },
  "changePassword": { "supported": false },
  "sort": { "supported": true },
  "etag": { "supported": true },
  "authenticationSchemes": [
    {
      "type": "oauthbearertoken",
      "name": "OAuth 2.0 Bearer Token",
      "description": "Authentication using OAuth 2.0 bearer tokens",
      "specUri": "https://www.rfc-editor.org/rfc/rfc6750",
      "primary": true
    }
  ],
  "meta": {
    "resourceType": "ServiceProviderConfig",
    "location": "/scim/v2/ServiceProviderConfig"
  }
}
```

---

## SCIM Discovery - Endpoint Scoped

Endpoint-scoped discovery returns schemas/resource types/SPC from the specific endpoint's profile. Gated by `SchemaDiscoveryEnabled` flag (default: true). Returns 404 when disabled.

### GET /scim/endpoints/:endpointId/Schemas

```http
GET /scim/endpoints/a1b2c3d4-.../Schemas HTTP/1.1
Host: localhost:8080
```

Returns schemas from this endpoint's profile (may differ from root-level).

---

### GET /scim/endpoints/:endpointId/Schemas/:uri

Get endpoint-scoped schema by URN.

---

### GET /scim/endpoints/:endpointId/ResourceTypes

Get endpoint-scoped resource types.

---

### GET /scim/endpoints/:endpointId/ResourceTypes/:id

Get endpoint-scoped resource type by ID.

---

### GET /scim/endpoints/:endpointId/ServiceProviderConfig

Get endpoint-scoped service provider configuration.

---

## SCIM Users

All user operations are scoped to an endpoint. The endpoint must be active (returns 403 otherwise).

### POST /scim/endpoints/:endpointId/Users

Create a user.

```http
POST /scim/endpoints/a1b2c3d4-.../Users HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json

{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "userName": "jane.doe@example.com",
  "name": {
    "givenName": "Jane",
    "familyName": "Doe"
  },
  "displayName": "Jane Doe",
  "emails": [
    { "value": "jane.doe@example.com", "type": "work", "primary": true }
  ],
  "active": true,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering",
    "costCenter": "CC-1234"
  }
}
```

**Response (201 Created):**

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "userName": "jane.doe@example.com",
  "name": { "givenName": "Jane", "familyName": "Doe" },
  "displayName": "Jane Doe",
  "emails": [
    { "value": "jane.doe@example.com", "type": "work", "primary": true }
  ],
  "active": true,
  "externalId": null,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering",
    "costCenter": "CC-1234"
  },
  "meta": {
    "resourceType": "User",
    "created": "2026-04-24T10:00:00.000Z",
    "lastModified": "2026-04-24T10:00:00.000Z",
    "location": "http://localhost:8080/scim/v2/endpoints/a1b2c3d4-.../Users/f47ac10b-...",
    "version": "W/\"1\""
  }
}
```

**Validation enforced:**
- `userName` required, unique per endpoint (409 on conflict)
- `schemas[]` must include core User URN
- Extension URNs in `schemas[]` must match if `StrictSchemaValidation: true`
- ReadOnly attributes (`id`, `meta`, `groups`) stripped silently
- Boolean strings coerced if `AllowAndCoerceBooleanStrings: true`
- Primary sub-attribute normalized/rejected per `PrimaryEnforcement`
- Attribute types validated against endpoint schema

---

### GET /scim/endpoints/:endpointId/Users

List users with optional filtering, sorting, pagination, and projection.

```http
GET /scim/endpoints/a1b2c3d4-.../Users?filter=userName%20eq%20%22jane.doe%40example.com%22&startIndex=1&count=10&sortBy=userName&sortOrder=ascending&attributes=userName,displayName HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `filter` | string | (none) | SCIM filter expression (RFC 7644 S3.4.2.2) |
| `startIndex` | number | 1 | 1-based pagination index |
| `count` | number | 100 | Results per page (max 1000) |
| `sortBy` | string | (none) | Attribute to sort by |
| `sortOrder` | string | `ascending` | `ascending` or `descending` |
| `attributes` | string | (none) | Comma-separated attributes to include |
| `excludedAttributes` | string | (none) | Comma-separated attributes to exclude |

**Response (200 OK):**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "f47ac10b-...",
      "userName": "jane.doe@example.com",
      "displayName": "Jane Doe",
      "meta": { "..." }
    }
  ]
}
```

---

### GET /scim/endpoints/:endpointId/Users/:userId

Get a single user.

```http
GET /scim/endpoints/a1b2c3d4-.../Users/f47ac10b-...?attributes=userName,emails HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
If-None-Match: W/"2"
```

Returns 304 Not Modified if ETag matches, otherwise full user resource.

---

### PUT /scim/endpoints/:endpointId/Users/:userId

Replace a user (full resource replacement).

```http
PUT /scim/endpoints/a1b2c3d4-.../Users/f47ac10b-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json
If-Match: W/"1"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "jane.doe@example.com",
  "displayName": "Jane Doe-Smith",
  "active": true
}
```

**Response (200 OK):** Updated user resource with incremented version.

Returns 412 Precondition Failed if `If-Match` doesn't match current version. Returns 409 if `userName` conflicts with another user.

---

### PATCH /scim/endpoints/:endpointId/Users/:userId

Modify a user with PATCH operations (RFC 7644 S3.5.2).

```http
PATCH /scim/endpoints/a1b2c3d4-.../Users/f47ac10b-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json
If-Match: W/"1"

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "displayName", "value": "Jane Smith" },
    { "op": "add", "path": "emails[type eq \"home\"].value", "value": "jane@home.com" },
    { "op": "replace", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Product" },
    { "op": "remove", "path": "phoneNumbers[type eq \"fax\"]" }
  ]
}
```

**Supported PATCH operations:**

| Op | Path Styles | Description |
|----|-------------|-------------|
| `add` | Simple, valuePath, extension URN, no-path | Add attribute value |
| `replace` | Simple, valuePath, extension URN, dot-notation, no-path | Replace attribute value |
| `remove` | Simple, valuePath, extension URN | Remove attribute value |

**Soft Delete:** `PATCH { "op": "replace", "path": "active", "value": false }` deactivates the user (if `UserSoftDeleteEnabled: true`).

---

### DELETE /scim/endpoints/:endpointId/Users/:userId

Delete a user.

```http
DELETE /scim/endpoints/a1b2c3d4-.../Users/f47ac10b-... HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
If-Match: W/"2"
```

**Response:** 204 No Content

Behavior depends on `UserHardDeleteEnabled`:
- `true` (default): Permanently deletes
- `false`: Returns 400 (deletion disabled)

---

### POST /scim/endpoints/:endpointId/Users/.search

Search users via POST body (RFC 7644 S3.4.3).

```http
POST /scim/endpoints/a1b2c3d4-.../Users/.search HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "userName sw \"jane\"",
  "startIndex": 1,
  "count": 10,
  "sortBy": "userName",
  "sortOrder": "ascending",
  "attributes": ["userName", "displayName", "emails"]
}
```

Returns same ListResponse as GET with filter.

---

## SCIM Groups

### POST /scim/endpoints/:endpointId/Groups

Create a group.

```http
POST /scim/endpoints/a1b2c3d4-.../Groups HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering",
  "members": [
    { "value": "f47ac10b-..." },
    { "value": "a83bc20e-..." }
  ]
}
```

**Response (201 Created):**

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "g1234567-...",
  "displayName": "Engineering",
  "members": [
    { "value": "f47ac10b-...", "display": "jane.doe@example.com", "type": "User" },
    { "value": "a83bc20e-...", "display": "john.smith@example.com", "type": "User" }
  ],
  "meta": {
    "resourceType": "Group",
    "created": "2026-04-24T10:00:00.000Z",
    "lastModified": "2026-04-24T10:00:00.000Z",
    "location": "http://localhost:8080/scim/v2/endpoints/a1b2c3d4-.../Groups/g1234567-...",
    "version": "W/\"1\""
  }
}
```

- `displayName` required, unique per endpoint (409 on conflict)
- Member `value` must reference existing user IDs in the same endpoint

---

### GET /scim/endpoints/:endpointId/Groups

List groups. Same query parameters as Users (filter, pagination, sort, projection).

---

### GET /scim/endpoints/:endpointId/Groups/:groupId

Get a single group.

---

### PUT /scim/endpoints/:endpointId/Groups/:groupId

Replace a group. Supports `If-Match` for conditional update.

---

### PATCH /scim/endpoints/:endpointId/Groups/:groupId

Modify group. Common patterns:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        { "value": "new-user-id-1" },
        { "value": "new-user-id-2" }
      ]
    }
  ]
}
```

Multi-member add/remove requires `MultiMemberPatchOpForGroupEnabled: true` (default).
Remove all members requires `PatchOpAllowRemoveAllMembers: true` (default: false).

---

### DELETE /scim/endpoints/:endpointId/Groups/:groupId

Delete a group. Returns 204 No Content.

---

### POST /scim/endpoints/:endpointId/Groups/.search

Search groups via POST body.

---

## SCIM Bulk Operations

### POST /scim/endpoints/:endpointId/Bulk

Process multiple SCIM operations in a single request (RFC 7644 S3.7).

Requires `bulk.supported: true` in endpoint ServiceProviderConfig (enabled in `rfc-standard` preset).

```http
POST /scim/endpoints/a1b2c3d4-.../Bulk HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "failOnErrors": 2,
  "Operations": [
    {
      "method": "POST",
      "path": "/Users",
      "bulkId": "user1",
      "data": {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "userName": "bulk.user1@example.com",
        "displayName": "Bulk User 1"
      }
    },
    {
      "method": "PUT",
      "path": "/Users/f47ac10b-...",
      "version": "W/\"1\"",
      "data": {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "userName": "updated@example.com"
      }
    },
    {
      "method": "PATCH",
      "path": "/Groups/g1234567-...",
      "data": {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        "Operations": [
          { "op": "add", "path": "members", "value": [{ "value": "bulkId:user1" }] }
        ]
      }
    },
    {
      "method": "DELETE",
      "path": "/Users/old-user-id-..."
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"],
  "Operations": [
    { "method": "POST", "bulkId": "user1", "status": "201", "location": ".../Users/new-id-..." },
    { "method": "PUT", "status": "200", "location": ".../Users/f47ac10b-..." },
    { "method": "PATCH", "status": "200", "location": ".../Groups/g1234567-..." },
    { "method": "DELETE", "status": "204" }
  ]
}
```

**Features:**
- `bulkId` cross-referencing: Use `"value": "bulkId:user1"` to reference resources created earlier in the same batch
- `failOnErrors`: Stop after N errors (0 = process all)
- Max 1,000 operations per request
- Max 1 MB payload size

---

## SCIM POST Search

### POST /scim/endpoints/:endpointId/Users/.search
### POST /scim/endpoints/:endpointId/Groups/.search
### POST /scim/endpoints/:endpointId/:resourceType/.search

Server-side search via POST body (RFC 7644 S3.4.3). Useful when filter expressions exceed URL length limits.

```http
POST /scim/endpoints/a1b2c3d4-.../Users/.search HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "emails[type eq \"work\"].value co \"@example.com\" and active eq true",
  "startIndex": 1,
  "count": 25,
  "sortBy": "meta.lastModified",
  "sortOrder": "descending",
  "attributes": ["userName", "emails", "active"],
  "excludedAttributes": ["phoneNumbers"]
}
```

---

## SCIM /Me Endpoint

Self-service endpoint (RFC 7644 S3.11). Requires **OAuth 2.0 JWT** authentication. Resolves the `sub` claim from the JWT to find the matching User by `userName`.

### GET /scim/endpoints/:endpointId/Me

```http
GET /scim/endpoints/a1b2c3d4-.../Me HTTP/1.1
Host: localhost:8080
Authorization: Bearer eyJhbGci...
```

Returns the authenticated user's resource.

### PUT /scim/endpoints/:endpointId/Me

Replace current user.

### PATCH /scim/endpoints/:endpointId/Me

Modify current user.

### DELETE /scim/endpoints/:endpointId/Me

Delete current user. Returns 204 No Content.

**Note:** Returns 404 if authentication is via shared secret or per-endpoint credential (non-OAuth).

---

## SCIM Custom Resource Types

Register custom resource types in the endpoint profile, then perform CRUD operations. The generic controller matches `:resourceType` path segments that correspond to registered custom resource types (not Users or Groups).

### Example: Register a Device Resource Type

```http
POST /scim/admin/endpoints HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/json

{
  "name": "iot-devices",
  "profile": {
    "schemas": [
      {
        "id": "urn:example:schemas:2.0:Device",
        "name": "Device",
        "attributes": [
          { "name": "serialNumber", "type": "string", "required": true, "uniqueness": "server" },
          { "name": "model", "type": "string" },
          { "name": "firmware", "type": "string", "mutability": "readOnly" }
        ]
      }
    ],
    "resourceTypes": [
      {
        "id": "Device",
        "name": "Device",
        "endpoint": "/Devices",
        "schema": "urn:example:schemas:2.0:Device"
      }
    ]
  }
}
```

### CRUD Operations

```http
POST /scim/endpoints/{id}/Devices HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer changeme-scim

{
  "schemas": ["urn:example:schemas:2.0:Device"],
  "serialNumber": "DEV-001",
  "model": "Sensor-v3"
}
```

All 7 CRUD operations (POST, GET list, GET by ID, PUT, PATCH, DELETE, POST .search) are available with full schema validation, attribute projection, filtering, and ETag support.

---

## OAuth Token Endpoint

### POST /scim/oauth/token

Exchange client credentials for a JWT access token.

```http
POST /scim/oauth/token HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{
  "grant_type": "client_credentials",
  "client_id": "scimserver-client",
  "client_secret": "changeme-oauth",
  "scope": "scim.read scim.write"
}
```

**Response (200 OK):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "scope": "scim.read scim.write"
}
```

| Field | Value |
|-------|-------|
| `grant_type` | Must be `client_credentials` |
| `client_id` | Default: `scimserver-client` (set via `OAUTH_CLIENT_ID`) |
| `client_secret` | Set via `OAUTH_CLIENT_SECRET` env var |
| `scope` | Space-separated: `scim.read`, `scim.write`, `scim.manage` |

---

### GET /scim/oauth/test

OAuth service health check.

```http
GET /scim/oauth/test HTTP/1.1
Host: localhost:8080
```

```json
{
  "message": "OAuth endpoint is working",
  "timestamp": "2026-04-28T10:00:00.000Z",
  "version": "0.40.0"
}
```

---

## Error Responses

All SCIM error responses follow RFC 7644 S3.12.

### Error Format

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "User with userName 'jane.doe@example.com' already exists",
  "urn:scimserver:api:messages:2.0:Diagnostics": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "endpointId": "a1b2c3d4-...",
    "logsUrl": "/scim/endpoints/a1b2c3d4-.../logs/recent?requestId=550e8400-...",
    "conflictingResourceId": "f47ac10b-...",
    "conflictingAttribute": "userName",
    "incomingValue": "jane.doe@example.com"
  }
}
```

### SCIM Error Types (scimType)

| scimType | HTTP Status | Description |
|----------|-------------|-------------|
| `uniqueness` | 409 | Duplicate attribute value |
| `invalidFilter` | 400 | Malformed filter expression |
| `invalidSyntax` | 400 | Malformed request body |
| `invalidPath` | 400 | Invalid PATCH path |
| `noTarget` | 400 | PATCH target not found |
| `invalidValue` | 400 | Invalid attribute value |
| `mutability` | 400 | Attempt to modify readOnly/immutable attribute |
| `versionMismatch` | 412 | If-Match ETag mismatch |
| `tooMany` | 400 | Too many results (filter required) |
| `sensitive` | 403 | Sensitive operation blocked |
| `tooLarge` | 413 | Payload too large |

### Common HTTP Status Codes

| Status | Description |
|--------|-------------|
| 200 | Successful read/update |
| 201 | Resource created |
| 204 | Resource deleted / no content |
| 304 | Not Modified (ETag match) |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (no/invalid token) |
| 403 | Forbidden (inactive endpoint) |
| 404 | Resource not found |
| 409 | Conflict (uniqueness violation) |
| 412 | Precondition Failed (ETag mismatch) |
| 413 | Payload Too Large |
| 415 | Unsupported Media Type |
| 500 | Internal Server Error |

### Diagnostics Extension

The `urn:scimserver:api:messages:2.0:Diagnostics` extension is automatically added to error responses with contextual debugging information:

| Field | Description |
|-------|-------------|
| `requestId` | X-Request-Id correlation UUID |
| `endpointId` | Endpoint UUID (if applicable) |
| `logsUrl` | Direct link to filtered log entries for this request |
| `conflictingResourceId` | ID of conflicting resource (uniqueness errors) |
| `conflictingAttribute` | Attribute causing the conflict |
| `incomingValue` | The value that caused the conflict |
| `failedOperationIndex` | Index of failed PATCH operation |
| `failedPath` | PATCH path that failed |
| `failedOp` | PATCH op that failed |
| `currentETag` | Current resource ETag (version mismatch) |
| `parseError` | Filter parse error details |

---

## Route Summary Table

| # | Method | Path | Auth | Controller |
|---|--------|------|------|------------|
| 1 | GET | `/health` | Public | HealthController |
| 2 | GET | `/scim/admin/version` | Bearer | AdminController |
| 3 | POST | `/scim/admin/endpoints` | Bearer | EndpointController |
| 4 | GET | `/scim/admin/endpoints` | Bearer | EndpointController |
| 5 | GET | `/scim/admin/endpoints/presets` | Bearer | EndpointController |
| 6 | GET | `/scim/admin/endpoints/presets/:name` | Bearer | EndpointController |
| 7 | GET | `/scim/admin/endpoints/:id` | Bearer | EndpointController |
| 8 | GET | `/scim/admin/endpoints/by-name/:name` | Bearer | EndpointController |
| 9 | PATCH | `/scim/admin/endpoints/:id` | Bearer | EndpointController |
| 10 | DELETE | `/scim/admin/endpoints/:id` | Bearer | EndpointController |
| 11 | GET | `/scim/admin/endpoints/:id/stats` | Bearer | EndpointController |
| 12 | POST | `/scim/admin/endpoints/:id/credentials` | Bearer | AdminCredentialController |
| 13 | GET | `/scim/admin/endpoints/:id/credentials` | Bearer | AdminCredentialController |
| 14 | DELETE | `/scim/admin/endpoints/:id/credentials/:cid` | Bearer | AdminCredentialController |
| 15 | GET | `/scim/admin/logs` | Bearer | AdminController |
| 16 | GET | `/scim/admin/logs/:id` | Bearer | AdminController |
| 17 | POST | `/scim/admin/logs/clear` | Bearer | AdminController |
| 18 | POST | `/scim/admin/logs/prune` | Bearer | AdminController |
| 19 | POST | `/scim/admin/users/manual` | Bearer | AdminController |
| 20 | POST | `/scim/admin/groups/manual` | Bearer | AdminController |
| 21 | POST | `/scim/admin/users/:id/delete` | Bearer | AdminController |
| 22 | GET | `/scim/admin/log-config` | Bearer | LogConfigController |
| 23 | PUT | `/scim/admin/log-config` | Bearer | LogConfigController |
| 24 | PUT | `/scim/admin/log-config/level/:level` | Bearer | LogConfigController |
| 25 | PUT | `/scim/admin/log-config/category/:cat/:level` | Bearer | LogConfigController |
| 26 | PUT | `/scim/admin/log-config/endpoint/:id/:level` | Bearer | LogConfigController |
| 27 | DELETE | `/scim/admin/log-config/endpoint/:id` | Bearer | LogConfigController |
| 28 | GET | `/scim/admin/log-config/recent` | Bearer | LogConfigController |
| 29 | GET | `/scim/admin/log-config/audit` | Bearer | LogConfigController |
| 30 | DELETE | `/scim/admin/log-config/recent` | Bearer | LogConfigController |
| 31 | GET | `/scim/admin/log-config/stream` | Bearer | LogConfigController |
| 32 | GET | `/scim/admin/log-config/download` | Bearer | LogConfigController |
| 33 | GET | `/scim/admin/log-config/prune` | Bearer | LogConfigController |
| 34 | PUT | `/scim/admin/log-config/prune` | Bearer | LogConfigController |
| 35 | GET | `/scim/admin/database/users` | Bearer | DatabaseController |
| 36 | GET | `/scim/admin/database/groups` | Bearer | DatabaseController |
| 37 | GET | `/scim/admin/database/users/:id` | Bearer | DatabaseController |
| 38 | GET | `/scim/admin/database/groups/:id` | Bearer | DatabaseController |
| 39 | GET | `/scim/admin/database/statistics` | Bearer | DatabaseController |
| 40 | GET | `/scim/admin/activity` | Bearer | ActivityController |
| 41 | GET | `/scim/admin/activity/summary` | Bearer | ActivityController |
| 42 | GET | `/scim/Schemas` | Public | SchemasController |
| 43 | GET | `/scim/Schemas/:uri` | Public | SchemasController |
| 44 | GET | `/scim/ResourceTypes` | Public | ResourceTypesController |
| 45 | GET | `/scim/ResourceTypes/:id` | Public | ResourceTypesController |
| 46 | GET | `/scim/ServiceProviderConfig` | Public | ServiceProviderConfigController |
| 47 | GET | `/scim/endpoints/:id/Schemas` | Public | EndpointScimDiscoveryController |
| 48 | GET | `/scim/endpoints/:id/Schemas/:uri` | Public | EndpointScimDiscoveryController |
| 49 | GET | `/scim/endpoints/:id/ResourceTypes` | Public | EndpointScimDiscoveryController |
| 50 | GET | `/scim/endpoints/:id/ResourceTypes/:rid` | Public | EndpointScimDiscoveryController |
| 51 | GET | `/scim/endpoints/:id/ServiceProviderConfig` | Public | EndpointScimDiscoveryController |
| 52 | POST | `/scim/endpoints/:id/Users` | Bearer | EndpointScimUsersController |
| 53 | GET | `/scim/endpoints/:id/Users` | Bearer | EndpointScimUsersController |
| 54 | POST | `/scim/endpoints/:id/Users/.search` | Bearer | EndpointScimUsersController |
| 55 | GET | `/scim/endpoints/:id/Users/:uid` | Bearer | EndpointScimUsersController |
| 56 | PUT | `/scim/endpoints/:id/Users/:uid` | Bearer | EndpointScimUsersController |
| 57 | PATCH | `/scim/endpoints/:id/Users/:uid` | Bearer | EndpointScimUsersController |
| 58 | DELETE | `/scim/endpoints/:id/Users/:uid` | Bearer | EndpointScimUsersController |
| 59 | POST | `/scim/endpoints/:id/Groups` | Bearer | EndpointScimGroupsController |
| 60 | GET | `/scim/endpoints/:id/Groups` | Bearer | EndpointScimGroupsController |
| 61 | POST | `/scim/endpoints/:id/Groups/.search` | Bearer | EndpointScimGroupsController |
| 62 | GET | `/scim/endpoints/:id/Groups/:gid` | Bearer | EndpointScimGroupsController |
| 63 | PUT | `/scim/endpoints/:id/Groups/:gid` | Bearer | EndpointScimGroupsController |
| 64 | PATCH | `/scim/endpoints/:id/Groups/:gid` | Bearer | EndpointScimGroupsController |
| 65 | DELETE | `/scim/endpoints/:id/Groups/:gid` | Bearer | EndpointScimGroupsController |
| 66 | POST | `/scim/endpoints/:id/Bulk` | Bearer | EndpointScimBulkController |
| 67 | GET | `/scim/endpoints/:id/Me` | OAuth | ScimMeController |
| 68 | PUT | `/scim/endpoints/:id/Me` | OAuth | ScimMeController |
| 69 | PATCH | `/scim/endpoints/:id/Me` | OAuth | ScimMeController |
| 70 | DELETE | `/scim/endpoints/:id/Me` | OAuth | ScimMeController |
| 71 | POST | `/scim/endpoints/:id/:type` | Bearer | EndpointScimGenericController |
| 72 | GET | `/scim/endpoints/:id/:type` | Bearer | EndpointScimGenericController |
| 73 | POST | `/scim/endpoints/:id/:type/.search` | Bearer | EndpointScimGenericController |
| 74 | GET | `/scim/endpoints/:id/:type/:rid` | Bearer | EndpointScimGenericController |
| 75 | PUT | `/scim/endpoints/:id/:type/:rid` | Bearer | EndpointScimGenericController |
| 76 | PATCH | `/scim/endpoints/:id/:type/:rid` | Bearer | EndpointScimGenericController |
| 77 | DELETE | `/scim/endpoints/:id/:type/:rid` | Bearer | EndpointScimGenericController |
| 78 | GET | `/scim/endpoints/:id/logs/recent` | Bearer | EndpointLogController |
| 79 | GET | `/scim/endpoints/:id/logs/stream` | Bearer | EndpointLogController |
| 80 | GET | `/scim/endpoints/:id/logs/download` | Bearer | EndpointLogController |
| 81 | GET | `/scim/endpoints/:id/logs/history` | Bearer | EndpointLogController |
| 82 | POST | `/scim/oauth/token` | Public | OAuthController |
| 83 | GET | `/scim/oauth/test` | Public | OAuthController |
