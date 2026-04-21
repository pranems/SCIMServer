# Complete API Reference

> **Version:** 0.37.3 · **Updated:** April 21, 2026  
> **Base URL:** `http://localhost:{PORT}/scim` (default port: 3000, Docker: 8080)  
> **Content-Type:** `application/scim+json` for SCIM operations, `application/json` for admin  
> **URL Rewriting:** `/scim/v2/*` is automatically rewritten to `/scim/*`  
> **Total Endpoints:** 82 across 19 controllers

---

## Table of Contents

- [Authentication](#authentication)
- [Health & Version](#health--version)
- [Admin API — Endpoint Management](#admin-api--endpoint-management)
- [Admin API — Per-Endpoint Credentials](#admin-api--per-endpoint-credentials)
- [Admin API — General (Logs, Manual Ops, Version)](#admin-api--general)
- [Admin API — Log Configuration](#admin-api--log-configuration)
- [Admin API — Database Browser](#admin-api--database-browser)
- [Admin API — Activity Feed](#admin-api--activity-feed)
- [SCIM — Discovery (Root-Level)](#scim--discovery-root-level)
- [SCIM — Discovery (Endpoint-Scoped)](#scim--discovery-endpoint-scoped)
- [SCIM — Users](#scim--users)
- [SCIM — Groups](#scim--groups)
- [SCIM — Bulk Operations](#scim--bulk-operations)
- [SCIM — POST Search](#scim--post-search)
- [SCIM — /Me Endpoint](#scim--me-endpoint)
- [SCIM — Custom Resource Types](#scim--custom-resource-types)
- [OAuth Token Endpoint](#oauth-token-endpoint)
- [Error Responses](#error-responses)
- [Common Headers](#common-headers)

---

## Authentication

The server supports a 3-tier authentication chain, evaluated in order:

1. **Public routes** — endpoints decorated `@Public()` skip auth entirely (health, discovery, OAuth)
2. **Per-endpoint credentials** — if the URL contains `/endpoints/{uuid}/`, checks bcrypt-hashed bearer tokens stored per-endpoint (requires `PerEndpointCredentialsEnabled` flag)
3. **OAuth 2.0 JWT** — validates token via `OAuthService.validateAccessToken()`; sets `authType = 'oauth'`
4. **Legacy bearer token** — compares against the `SCIM_SHARED_SECRET` environment variable; sets `authType = 'legacy'`

| Environment Variable | Purpose |
|---------------------|---------|
| `SCIM_SHARED_SECRET` | Global shared secret for legacy bearer auth |
| `OAUTH_CLIENT_ID` | OAuth client ID (default: `scimserver-client`) |
| `OAUTH_CLIENT_SECRET` | OAuth client secret for token generation |
| `OAUTH_CLIENT_SCOPES` | Comma-separated OAuth scopes (default: `scim.read,scim.write,scim.manage`) |
| `JWT_SECRET` | JWT signing secret |

---

## Health & Version

### GET /scim/health

No authentication required.

```http
GET /scim/health
```

**Response: 200 OK**

```json
{
  "status": "ok",
  "uptime": 3600.123,
  "timestamp": "2026-03-31T10:00:00.000Z"
}
```

---

## Admin API — Endpoint Management

> **Base path:** `/scim/admin/endpoints` · **Auth:** Bearer token required

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
    "schemas": [ { "id": "urn:ietf:params:scim:schemas:core:2.0:User", "name": "User", "attributes": ["..."] } ],
    "resourceTypes": [ { "id": "User", "name": "User", "endpoint": "/Users" } ],
    "serviceProviderConfig": { "patch": { "supported": true }, "bulk": { "supported": false } },
    "settings": { "AllowAndCoerceBooleanStrings": "True", "VerbosePatchSupported": "True" }
  },
  "createdAt": "2026-03-17T10:00:00.000Z",
  "updatedAt": "2026-03-17T10:00:00.000Z"
}
```

**Body fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (required) | Unique endpoint name |
| `displayName` | string | Human-readable label |
| `description` | string | Description |
| `profilePreset` | string | One of: `entra-id`, `entra-id-minimal`, `rfc-standard`, `minimal`, `user-only`, `user-only-with-custom-ext` |
| `profile` | object | Inline profile (schemas, resourceTypes, serviceProviderConfig, settings) — mutually exclusive with `profilePreset` |

### GET /scim/admin/endpoints

List all endpoints.

```http
GET /scim/admin/endpoints?active=true&view=summary
Authorization: Bearer <token>
```

| Query Param | Type | Description |
|------------|------|-------------|
| `active` | `true`/`false` | Filter by active status |
| `view` | `summary`/`full` | Response detail level (default: `summary`) |

**Response: 200 OK** — Array of endpoint objects.

### GET /scim/admin/endpoints/presets

List all built-in profile presets.

```http
GET /scim/admin/endpoints/presets
Authorization: Bearer <token>
```

**Response: 200 OK** — Array of preset names and descriptions.

### GET /scim/admin/endpoints/presets/:name

Get a specific preset's full profile definition.

```http
GET /scim/admin/endpoints/presets/entra-id
Authorization: Bearer <token>
```

**Response: 200 OK** — Full profile object (schemas, resourceTypes, SPC, settings).

### GET /scim/admin/endpoints/:endpointId

Get endpoint by ID.

```http
GET /scim/admin/endpoints/a1b2c3d4-...?view=full
Authorization: Bearer <token>
```

| Query Param | Type | Description |
|------------|------|-------------|
| `view` | `full`/`summary` | Response detail level (default: `full`) |

### GET /scim/admin/endpoints/by-name/:name

Get endpoint by name.

```http
GET /scim/admin/endpoints/by-name/my-tenant?view=full
Authorization: Bearer <token>
```

| Query Param | Type | Description |
|------------|------|-------------|
| `view` | `full`/`summary` | Response detail level (default: `full`) |

### PATCH /scim/admin/endpoints/:endpointId

Update endpoint — deep-merges profile settings.

```http
PATCH /scim/admin/endpoints/a1b2c3d4-...
Authorization: Bearer <token>
Content-Type: application/json

{
  "displayName": "Updated Name",
  "profile": {
    "settings": {
      "UserHardDeleteEnabled": "True",
      "RequireIfMatch": "True"
    }
  }
}
```

**Body fields:**

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | Updated display name |
| `description` | string | Updated description |
| `profile` | object | Profile changes (settings are deep-merged; schemas/RTs replaced if provided) |
| `active` | boolean | Enable/disable the endpoint |

**Merge semantics:**

| Profile Section | Strategy | Implication |
|----------------|----------|-------------|
| `schemas` | **Replace** | Full array replaces old — must include ALL schemas |
| `resourceTypes` | **Replace** | Full array replaces old — must reference schemas in the new set |
| `serviceProviderConfig` | Shallow merge | Unmentioned capabilities preserved |
| `settings` | Shallow merge (additive) | Unmentioned flags preserved |

> **Takes effect immediately** — the in-memory cache is updated synchronously. No restart required. The `_schemaCaches` is cleared and lazily rebuilt on the next request — discovery, validation, and characteristic enforcement all reflect the new profile instantly.

**Response: 200 OK** — Updated endpoint.

> **All per-endpoint config flags** (13 booleans + `logLevel`) are documented in [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md).

### DELETE /scim/admin/endpoints/:endpointId

Delete endpoint (**cascades** — deletes all users, groups, logs, credentials).

**Response: 204 No Content**

### GET /scim/admin/endpoints/:endpointId/stats

Get endpoint statistics (user/group counts, last activity).

```http
GET /scim/admin/endpoints/a1b2c3d4-.../stats
Authorization: Bearer <token>
```

**Response: 200 OK**

---

## Admin API — Per-Endpoint Credentials

> **Base path:** `/scim/admin/endpoints/:endpointId/credentials` · **Auth:** Bearer token required  
> **Prerequisite:** Endpoint must have `PerEndpointCredentialsEnabled` flag set to `True`

### POST /scim/admin/endpoints/:endpointId/credentials

Create a per-endpoint credential. **The server generates the token** — the plaintext is returned exactly once in the response; only the bcrypt hash is stored.

```http
POST /scim/admin/endpoints/a1b2c3d4-.../credentials
Authorization: Bearer <token>
Content-Type: application/json

{
  "label": "Entra provisioning",
  "credentialType": "bearer",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

**Response: 201 Created**

```json
{
  "id": "cred-uuid",
  "endpointId": "a1b2c3d4-...",
  "credentialType": "bearer",
  "label": "Entra provisioning",
  "active": true,
  "createdAt": "2026-03-17T10:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "token": "dGhpcyBpcyBhIHNlcnZlci1nZW5lcmF0ZWQgdG9rZW4..."
}
```

> **Important:** Save the `token` value immediately — it cannot be retrieved again.

**Body fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `label` | string | — | Optional human-readable label |
| `credentialType` | `bearer` / `oauth_client` | `bearer` | Credential type |
| `expiresAt` | ISO 8601 | — | Optional expiration (must be in the future) |

| Status | Condition |
|--------|-----------|
| 201 | Credential created |
| 400 | Invalid credential type or expiration date |
| 403 | `PerEndpointCredentialsEnabled` not enabled |

### GET /scim/admin/endpoints/:endpointId/credentials

List all credentials for an endpoint (tokens/hashes are never returned).

**Response: 200 OK** — Array of credential metadata objects.

### DELETE /scim/admin/endpoints/:endpointId/credentials/:credentialId

Revoke (deactivate) a credential.

**Response: 204 No Content**

| Status | Condition |
|--------|-----------|
| 204 | Credential deactivated |
| 404 | Credential not found |

---

## Admin API — General

> **Base path:** `/scim/admin` · **Auth:** Bearer token required

### GET /scim/admin/version

Server version, runtime diagnostics, auth status, storage, and deployment info.

```http
GET /scim/admin/version
Authorization: Bearer <token>
```

**Response: 200 OK**

```json
{
  "version": "0.37.3",
  "service": {
    "name": "scimserver-api",
    "environment": "production",
    "apiPrefix": "scim",
    "now": "2026-04-13T10:30:45.123Z",
    "startedAt": "2026-04-12T00:00:00.000Z",
    "uptimeSeconds": 124245,
    "timezone": "UTC"
  },
  "runtime": {
    "node": "v24.0.0",
    "platform": "linux",
    "arch": "x64",
    "cpus": 2,
    "containerized": true,
    "memory": {
      "rss": 98304000,
      "heapTotal": 52428800,
      "heapUsed": 41943040
    }
  },
  "auth": {
    "oauthClientId": "scimserver-client",
    "oauthClientSecretConfigured": true,
    "jwtSecretConfigured": true,
    "scimSharedSecretConfigured": true
  },
  "storage": {
    "databaseProvider": "postgresql",
    "persistenceBackend": "prisma"
  },
  "deployment": {
    "resourceGroup": "scimserver-rg",
    "containerApp": "scimserver2",
    "currentImage": "ghcr.io/pranems/scimserver:0.37.3"
  }
}
```

### GET /scim/admin/logs

List structured request/response logs with filtering.

```http
GET /scim/admin/logs?page=1&pageSize=50&method=POST&status=201&hideKeepalive=true
Authorization: Bearer <token>
```

| Query Param | Type | Description |
|------------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Results per page |
| `method` | string | Filter by HTTP method (GET, POST, etc.) |
| `status` | string | Filter by HTTP status code |
| `hasError` | boolean | Filter for error responses only |
| `urlContains` | string | Filter by URL substring |
| `since` | ISO 8601 | Logs after this timestamp |
| `until` | ISO 8601 | Logs before this timestamp |
| `search` | string | Full-text search |
| `includeAdmin` | boolean | Include admin API logs |
| `hideKeepalive` | boolean | Exclude health-check/keepalive requests |
| `minDurationMs` | number | Only requests taking >= N milliseconds |

**Response: 200 OK** — Paginated log entries.

### GET /scim/admin/logs/:id

Get a single log entry by ID.

**Response: 200 OK**

### POST /scim/admin/logs/clear

Clear all request logs.

**Response: 204 No Content**

### POST /scim/admin/logs/prune

Delete request logs older than a specified number of days.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `retentionDays` | int (query) | `LOG_RETENTION_DAYS` env or 30 | Days of logs to retain |

```http
POST /scim/admin/logs/prune?retentionDays=7 HTTP/1.1
Authorization: Bearer <token>
```

**Response: 200 OK**

```json
{
  "pruned": 142
}
```

### POST /scim/admin/users/manual

Create a user via simplified admin form (bypasses SCIM schema validation).

```http
POST /scim/admin/users/manual
Authorization: Bearer <token>
Content-Type: application/json

{
  "userName": "admin-user@example.com",
  "displayName": "Admin User",
  "givenName": "Admin",
  "familyName": "User",
  "email": "admin-user@example.com",
  "active": true
}
```

**Response: 201 Created** — SCIM User resource (`Content-Type: application/scim+json`).

**Body fields:**

| Field | Type | Description |
|-------|------|-------------|
| `userName` | string (required) | Unique username |
| `externalId` | string | External identifier |
| `displayName` | string | Display name |
| `givenName` | string | First name |
| `familyName` | string | Last name |
| `email` | string | Email address |
| `phoneNumber` | string | Phone number |
| `department` | string | Department |
| `active` | boolean | Active status |

### POST /scim/admin/groups/manual

Create a group via simplified admin form.

```http
POST /scim/admin/groups/manual
Authorization: Bearer <token>
Content-Type: application/json

{
  "displayName": "Admin Group",
  "memberIds": ["user-uuid-1", "user-uuid-2"]
}
```

**Response: 201 Created** — SCIM Group resource.

**Body fields:**

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string (required) | Group display name |
| `scimId` | string | Optional SCIM ID |
| `memberIds` | string[] | Array of user IDs to add as members |

### POST /scim/admin/users/:id/delete

Delete a user by primary key or SCIM ID.

**Response: 204 No Content**

---

## Admin API — Log Configuration

> **Base path:** `/scim/admin/log-config` · **Auth:** Bearer token required

### GET /scim/admin/log-config

Get current log configuration.

**Response: 200 OK**

```json
{
  "globalLevel": "info",
  "includePayloads": true,
  "includeStackTraces": false,
  "maxPayloadSizeBytes": 10240,
  "format": "json",
  "categoryLevels": {},
  "endpointLevels": {}
}
```

### PUT /scim/admin/log-config

Update log configuration.

```http
PUT /scim/admin/log-config
Authorization: Bearer <token>
Content-Type: application/json

{
  "globalLevel": "debug",
  "includePayloads": true,
  "includeStackTraces": true,
  "maxPayloadSizeBytes": 20480,
  "format": "json",
  "categoryLevels": { "auth": "DEBUG", "scim.patch": "TRACE" }
}
```

**Response: 200 OK** — Updated configuration.

### PUT /scim/admin/log-config/level/:level

Quick-set global log level.

```http
PUT /scim/admin/log-config/level/debug
Authorization: Bearer <token>
```

**Response: 200 OK**

### PUT /scim/admin/log-config/category/:category/:level

Set category-specific log level.

```http
PUT /scim/admin/log-config/category/auth/debug
Authorization: Bearer <token>
```

**Response: 200 OK**

### PUT /scim/admin/log-config/endpoint/:endpointId/:level

Set endpoint-specific log level override.

```http
PUT /scim/admin/log-config/endpoint/a1b2c3d4-.../debug
Authorization: Bearer <token>
```

**Response: 200 OK**

### DELETE /scim/admin/log-config/endpoint/:endpointId

Clear endpoint log level override (reverts to global level).

**Response: 204 No Content**

### GET /scim/admin/log-config/recent

Get recent in-memory log entries.

```http
GET /scim/admin/log-config/recent?limit=100&level=error&category=scim
Authorization: Bearer <token>
```

| Query Param | Type | Description |
|------------|------|-------------|
| `limit` | number | Maximum entries to return |
| `level` | string | Filter by minimum level |
| `category` | string | Filter by category |
| `requestId` | string | Filter by request ID |
| `endpointId` | string | Filter by endpoint ID |

**Response: 200 OK** — Array of structured log entries.

### DELETE /scim/admin/log-config/recent

Clear the in-memory log buffer.

**Response: 204 No Content**

### GET /scim/admin/log-config/stream

Real-time log stream via Server-Sent Events (SSE).

```http
GET /scim/admin/log-config/stream?level=info&endpointId=a1b2c3d4-...
Authorization: Bearer <token>
Accept: text/event-stream
```

| Query Param | Type | Description |
|------------|------|-------------|
| `level` | string | Minimum log level |
| `category` | string | Filter by category |
| `endpointId` | string | Filter by endpoint ID |

**Response:** SSE stream (`Content-Type: text/event-stream`).

### GET /scim/admin/log-config/download

Download logs as a file.

```http
GET /scim/admin/log-config/download?format=ndjson&limit=1000
Authorization: Bearer <token>
```

| Query Param | Type | Description |
|------------|------|-------------|
| `format` | `json` / `ndjson` | Output format |
| `limit` | number | Maximum entries |
| `level` | string | Minimum level filter |
| `category` | string | Category filter |
| `requestId` | string | Request ID filter |
| `endpointId` | string | Endpoint ID filter |

**Response:** File download (JSON or NDJSON).

---

## Admin API — Database Browser

> **Base path:** `/scim/admin/database` · **Auth:** Bearer token required

### GET /scim/admin/database/users

Browse users in the database.

```http
GET /scim/admin/database/users?page=1&limit=50&search=john&active=true
Authorization: Bearer <token>
```

| Query Param | Default | Description |
|------------|---------|-------------|
| `page` | 1 | Page number |
| `limit` | 50 | Results per page |
| `search` | — | Search by name/email |
| `active` | — | Filter by active status |

**Response: 200 OK** — Paginated user list.

### GET /scim/admin/database/users/:id

Get user detail view.

**Response: 200 OK**

### GET /scim/admin/database/groups

Browse groups in the database.

| Query Param | Default | Description |
|------------|---------|-------------|
| `page` | 1 | Page number |
| `limit` | 50 | Results per page |
| `search` | — | Search by display name |

**Response: 200 OK** — Paginated group list.

### GET /scim/admin/database/groups/:id

Get group detail view.

**Response: 200 OK**

### GET /scim/admin/database/statistics

Get aggregate database statistics.

**Response: 200 OK**

---

## Admin API — Activity Feed

> **Base path:** `/scim/admin/activity` · **Auth:** Bearer token required

### GET /scim/admin/activity

List parsed SCIM activity entries.

```http
GET /scim/admin/activity?page=1&limit=50&type=CREATE&severity=info&hideKeepalive=true
Authorization: Bearer <token>
```

| Query Param | Default | Description |
|------------|---------|-------------|
| `page` | 1 | Page number |
| `limit` | 50 | Results per page |
| `type` | — | Filter by activity type |
| `severity` | — | Filter by severity |
| `search` | — | Full-text search |
| `hideKeepalive` | — | Exclude keepalive entries |

**Response: 200 OK** — `{ activities[], pagination, filters }`

### GET /scim/admin/activity/summary

Get activity summary with 24h/7d counts and operation breakdown.

**Response: 200 OK**

---

## SCIM — Discovery (Root-Level)

> **No authentication required** (RFC 7644 §4)  
> These return global default schemas/resource types (not endpoint-specific).

### GET /scim/ServiceProviderConfig

```http
GET /scim/ServiceProviderConfig
```

**Response: 200 OK** · `Content-Type: application/scim+json`

### GET /scim/Schemas

```http
GET /scim/Schemas
```

**Response: 200 OK** — All global schema definitions.

### GET /scim/Schemas/:uri

```http
GET /scim/Schemas/urn:ietf:params:scim:schemas:core:2.0:User
```

**Response: 200 OK** — Single schema by URN.

### GET /scim/ResourceTypes

```http
GET /scim/ResourceTypes
```

**Response: 200 OK** — All global resource type definitions.

### GET /scim/ResourceTypes/:id

```http
GET /scim/ResourceTypes/User
```

**Response: 200 OK** — Single resource type by ID.

---

## SCIM — Discovery (Endpoint-Scoped)

> **No authentication required** (RFC 7644 §4)  
> These return endpoint-specific schemas, including custom extensions registered on the endpoint.

### GET /scim/endpoints/{endpointId}/ServiceProviderConfig

```http
GET /scim/endpoints/a1b2c3d4-.../ServiceProviderConfig
```

**Response: 200 OK** · `Content-Type: application/scim+json`

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

### GET /scim/endpoints/{endpointId}/Schemas

Returns all schemas defined in the endpoint profile (includes custom extensions).

### GET /scim/endpoints/{endpointId}/Schemas/:uri

Get a single endpoint-specific schema by URN.

### GET /scim/endpoints/{endpointId}/ResourceTypes

List all endpoint-specific resource types.

### GET /scim/endpoints/{endpointId}/ResourceTypes/:id

Get a single endpoint-specific resource type by ID.

---

## SCIM — Users

> **Base path:** `/scim/endpoints/{endpointId}/Users` · **Auth:** Bearer token required

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

**Query parameters** (on POST, GET, PUT, PATCH):

| Parameter | Description |
|-----------|-------------|
| `attributes` | Comma-separated list of attributes to include in response |
| `excludedAttributes` | Comma-separated list of attributes to exclude from response |

### GET — Read User

```http
GET /scim/endpoints/{endpointId}/Users/{userId}?attributes=userName,displayName
Authorization: Bearer <token>
Accept: application/scim+json
```

### GET — List/Filter Users

```http
GET /scim/endpoints/{endpointId}/Users?filter=userName eq "jdoe@example.com"&startIndex=1&count=10&sortBy=userName&sortOrder=ascending
Authorization: Bearer <token>
```

**Query parameters:**

| Parameter | Description |
|-----------|-------------|
| `filter` | SCIM filter expression |
| `startIndex` | 1-based index of first result (default: 1) |
| `count` | Maximum results per page |
| `sortBy` | Attribute to sort by |
| `sortOrder` | `ascending` or `descending` |
| `attributes` | Attributes to include |
| `excludedAttributes` | Attributes to exclude |

**Response: 200 OK**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [ { "id": "...", "userName": "jdoe@example.com" } ]
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
| 412 | ETag precondition failed (when `RequireIfMatch` is enabled) |
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

| Status | Condition |
|--------|-----------|
| 200 | User patched |
| 400 | Invalid operation or path |
| 404 | User not found |
| 412 | ETag precondition failed |

### DELETE — Delete User

```http
DELETE /scim/endpoints/{endpointId}/Users/{userId}
Authorization: Bearer <token>
If-Match: W/"1"
```

**Response: 204 No Content** (hard-delete by default; blocked with 400 if `UserHardDeleteEnabled` / `GroupHardDeleteEnabled` is off)

---

## SCIM — Groups

> **Base path:** `/scim/endpoints/{endpointId}/Groups` · **Auth:** Bearer token required  
> Same CRUD pattern as Users with identical query parameters support.

### POST — Create Group

```http
POST /scim/endpoints/{endpointId}/Groups
Authorization: Bearer <token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering",
  "members": [
    { "value": "b2c3d4e5-...", "display": "John Doe" }
  ]
}
```

**Response: 201 Created**

| Status | Condition |
|--------|-----------|
| 201 | Group created |
| 409 | `displayName` already exists (uniqueness violation) |

### GET — Read Group

```http
GET /scim/endpoints/{endpointId}/Groups/{groupId}
Authorization: Bearer <token>
```

### GET — List/Filter Groups

```http
GET /scim/endpoints/{endpointId}/Groups?filter=displayName eq "Engineering"&startIndex=1&count=10
Authorization: Bearer <token>
```

### PUT — Replace Group

```http
PUT /scim/endpoints/{endpointId}/Groups/{groupId}
Authorization: Bearer <token>
Content-Type: application/scim+json
If-Match: W/"1"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Updated",
  "members": [
    { "value": "user-uuid-1" }
  ]
}
```

### PATCH — Modify Group / Add/Remove Members

```http
PATCH /scim/endpoints/{endpointId}/Groups/{groupId}
Authorization: Bearer <token>
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

> **Note:** Multi-member add/remove requires `MultiMemberPatchOpForGroupEnabled` to be enabled in endpoint settings (default: enabled).

### DELETE — Delete Group

```http
DELETE /scim/endpoints/{endpointId}/Groups/{groupId}
Authorization: Bearer <token>
If-Match: W/"1"
```

**Response: 204 No Content**

---

## SCIM — Bulk Operations

> **Base path:** `/scim/endpoints/{endpointId}/Bulk` · **Auth:** Bearer token required  
> **Prerequisite:** `profile.serviceProviderConfig.bulk.supported = true` (e.g., `rfc-standard` preset)

### POST /scim/endpoints/{endpointId}/Bulk

```http
POST /scim/endpoints/{endpointId}/Bulk
Authorization: Bearer <token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "failOnErrors": 5,
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

| Field | Description |
|-------|-------------|
| `failOnErrors` | Optional — stop processing after this many errors |
| `Operations[].method` | `POST`, `PUT`, `PATCH`, or `DELETE` |
| `Operations[].path` | Resource path (e.g., `/Users`, `/Groups/{id}`) |
| `Operations[].bulkId` | Client-specified correlation ID (required for POST) |
| `Operations[].data` | Request body (for POST, PUT, PATCH) |

---

## SCIM — POST Search

> Available on all resource types: Users, Groups, and custom resources.

### POST /scim/endpoints/{endpointId}/Users/.search

```http
POST /scim/endpoints/{endpointId}/Users/.search
Authorization: Bearer <token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "displayName co \"John\"",
  "startIndex": 1,
  "count": 10,
  "sortBy": "userName",
  "sortOrder": "ascending",
  "attributes": ["userName", "displayName", "emails"],
  "excludedAttributes": []
}
```

**Response: 200 OK** — ListResponse (same format as GET list).

### POST /scim/endpoints/{endpointId}/Groups/.search

Same request/response format, scoped to Groups.

---

## SCIM — /Me Endpoint

> **Base path:** `/scim/endpoints/{endpointId}/Me` · **Auth:** OAuth 2.0 JWT required  
> Requires `authType === 'oauth'` with the JWT `sub` claim matching a User's `userName` in the endpoint. Legacy bearer tokens are **not** supported for /Me.

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| GET | `/scim/endpoints/{id}/Me` | 200 | Get current authenticated user |
| PUT | `/scim/endpoints/{id}/Me` | 200 | Replace current user |
| PATCH | `/scim/endpoints/{id}/Me` | 200 | Update current user |
| DELETE | `/scim/endpoints/{id}/Me` | 204 | Delete current user |

All methods support `attributes` and `excludedAttributes` query parameters (except DELETE).

**Example:**

```http
GET /scim/endpoints/a1b2c3d4-.../Me
Authorization: Bearer <oauth-jwt-with-sub-claim>
```

| Status | Condition |
|--------|-----------|
| 200 | Success |
| 401 | Not authenticated or not using OAuth |
| 404 | No user found matching JWT `sub` claim |

---

## SCIM — Custom Resource Types

> **Base path:** `/scim/endpoints/{endpointId}/{resourceType}` · **Auth:** Bearer token required  
> **Prerequisite:** Custom resource type must be registered in endpoint profile's `resourceTypes`

Supports full CRUD for any registered custom resource type (e.g., `Devices`, `Applications`).

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| POST | `/{resourceType}` | 201 | Create custom resource |
| GET | `/{resourceType}` | 200 | List/filter custom resources |
| POST | `/{resourceType}/.search` | 200 | POST-based search |
| GET | `/{resourceType}/{id}` | 200 | Get single resource |
| PUT | `/{resourceType}/{id}` | 200 | Replace resource |
| PATCH | `/{resourceType}/{id}` | 200 | Patch resource |
| DELETE | `/{resourceType}/{id}` | 204 | Delete resource |

All methods support `attributes`, `excludedAttributes`, and standard list query parameters. PUT/PATCH/DELETE read the `If-Match` header for conditional writes.

---

## OAuth Token Endpoint

> **Base path:** `/scim/oauth` · **No authentication required**

### GET /scim/oauth/test

Test endpoint to verify OAuth module is loaded.

**Response: 200 OK**

```json
{
  "message": "OAuth controller is working!",
  "timestamp": "2026-03-31T10:00:00.000Z",
  "version": "1.1"
}
```

### POST /scim/oauth/token

Generate an OAuth 2.0 access token using client credentials.

```http
POST /scim/oauth/token
Content-Type: application/json

{
  "grant_type": "client_credentials",
  "client_id": "scimserver-client",
  "client_secret": "<OAUTH_CLIENT_SECRET>",
  "scope": "scim.read scim.write scim.manage"
}
```

**Response: 200 OK**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "scim.read scim.write scim.manage"
}
```

| Status | Condition |
|--------|-----------|
| 200 | Token issued |
| 400 | Unsupported `grant_type` or missing required fields |
| 401 | Invalid `client_id` or `client_secret` |

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
| 403 | — | Feature not enabled (e.g., per-endpoint credentials disabled) |
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
| `Authorization` | Yes (except public routes) | `Bearer <token>` — shared secret, OAuth JWT, or per-endpoint credential |
| `Content-Type` | For POST/PUT/PATCH | `application/scim+json` or `application/json` |
| `Accept` | No | `application/scim+json` |
| `If-Match` | Conditional | ETag value for conditional writes (required if `RequireIfMatch` is on) |
| `If-None-Match` | No | For conditional GET |

### Response Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/scim+json;charset=utf-8` for SCIM; `application/json` for admin |
| `ETag` | Resource version (`W/"1"`, `W/"2"`, etc.) |
| `Location` | Full URL of created/returned resource |
| `Warning` | ReadOnly attribute stripping warnings (RFC 7234 format) |

---

## Endpoint Summary Table

| # | Category | Method | Path | Status | Auth |
|---|---------|--------|------|--------|------|
| 1 | Health | GET | `/scim/health` | 200 | Public |
| 2 | Web | GET | `/` | 200 | Public |
| 3 | OAuth | GET | `/scim/oauth/test` | 200 | Public |
| 4 | OAuth | POST | `/scim/oauth/token` | 201 | Public |
| 5 | Discovery | GET | `/scim/ServiceProviderConfig` | 200 | Public |
| 6 | Discovery | GET | `/scim/Schemas` | 200 | Public |
| 7 | Discovery | GET | `/scim/Schemas/:uri` | 200 | Public |
| 8 | Discovery | GET | `/scim/ResourceTypes` | 200 | Public |
| 9 | Discovery | GET | `/scim/ResourceTypes/:id` | 200 | Public |
| 10 | Discovery | GET | `/scim/endpoints/{eid}/ServiceProviderConfig` | 200 | Public |
| 11 | Discovery | GET | `/scim/endpoints/{eid}/Schemas` | 200 | Public |
| 12 | Discovery | GET | `/scim/endpoints/{eid}/Schemas/:uri` | 200 | Public |
| 13 | Discovery | GET | `/scim/endpoints/{eid}/ResourceTypes` | 200 | Public |
| 14 | Discovery | GET | `/scim/endpoints/{eid}/ResourceTypes/:id` | 200 | Public |
| 15–21 | Users | POST/GET/GET/POST/PUT/PATCH/DELETE | `/scim/endpoints/{eid}/Users[/...]` | 201/200/204 | Bearer |
| 22–28 | Groups | POST/GET/GET/POST/PUT/PATCH/DELETE | `/scim/endpoints/{eid}/Groups[/...]` | 201/200/204 | Bearer |
| 29–32 | /Me | GET/PUT/PATCH/DELETE | `/scim/endpoints/{eid}/Me` | 200/204 | OAuth |
| 33 | Bulk | POST | `/scim/endpoints/{eid}/Bulk` | 200 | Bearer |
| 34–40 | Custom | POST/GET/GET/POST/PUT/PATCH/DELETE | `/scim/endpoints/{eid}/{type}[/...]` | 201/200/204 | Bearer |
| 41 | Admin | POST | `/scim/admin/endpoints` | 201 | Bearer |
| 42 | Admin | GET | `/scim/admin/endpoints` | 200 | Bearer |
| 43 | Admin | GET | `/scim/admin/endpoints/presets` | 200 | Bearer |
| 44 | Admin | GET | `/scim/admin/endpoints/presets/:name` | 200 | Bearer |
| 45 | Admin | GET | `/scim/admin/endpoints/:id` | 200 | Bearer |
| 46 | Admin | GET | `/scim/admin/endpoints/by-name/:name` | 200 | Bearer |
| 47 | Admin | PATCH | `/scim/admin/endpoints/:id` | 200 | Bearer |
| 48 | Admin | DELETE | `/scim/admin/endpoints/:id` | 204 | Bearer |
| 49 | Admin | GET | `/scim/admin/endpoints/:id/stats` | 200 | Bearer |
| 50 | Creds | POST | `/scim/admin/endpoints/:id/credentials` | 201 | Bearer |
| 51 | Creds | GET | `/scim/admin/endpoints/:id/credentials` | 200 | Bearer |
| 52 | Creds | DELETE | `/scim/admin/endpoints/:id/credentials/:cid` | 204 | Bearer |
| 53 | Admin | GET | `/scim/admin/version` | 200 | Bearer |
| 54 | Admin | GET | `/scim/admin/logs` | 200 | Bearer |
| 55 | Admin | GET | `/scim/admin/logs/:id` | 200 | Bearer |
| 56 | Admin | POST | `/scim/admin/logs/clear` | 204 | Bearer |
| 57 | Admin | POST | `/scim/admin/logs/prune` | 200 | Bearer |
| 58 | Admin | POST | `/scim/admin/users/manual` | 201 | Bearer |
| 58 | Admin | POST | `/scim/admin/groups/manual` | 201 | Bearer |
| 59 | Admin | POST | `/scim/admin/users/:id/delete` | 204 | Bearer |
| 60 | LogCfg | GET | `/scim/admin/log-config` | 200 | Bearer |
| 61 | LogCfg | PUT | `/scim/admin/log-config` | 200 | Bearer |
| 62 | LogCfg | PUT | `/scim/admin/log-config/level/:level` | 200 | Bearer |
| 63 | LogCfg | PUT | `/scim/admin/log-config/category/:cat/:lvl` | 200 | Bearer |
| 64 | LogCfg | PUT | `/scim/admin/log-config/endpoint/:eid/:lvl` | 200 | Bearer |
| 65 | LogCfg | DELETE | `/scim/admin/log-config/endpoint/:eid` | 204 | Bearer |
| 66 | LogCfg | GET | `/scim/admin/log-config/recent` | 200 | Bearer |
| 67 | LogCfg | DELETE | `/scim/admin/log-config/recent` | 204 | Bearer |
| 68 | LogCfg | GET | `/scim/admin/log-config/stream` | SSE | Bearer |
| 69 | LogCfg | GET | `/scim/admin/log-config/download` | File | Bearer |
| 70 | LogCfg | GET | `/scim/admin/log-config/audit` | 200 | Bearer |
| 71 | EpLogs | GET | `/scim/endpoints/:eid/logs/recent` | 200 | Bearer |
| 72 | EpLogs | GET | `/scim/endpoints/:eid/logs/stream` | SSE | Bearer |
| 73 | EpLogs | GET | `/scim/endpoints/:eid/logs/download` | File | Bearer |
| 74 | EpLogs | GET | `/scim/endpoints/:eid/logs/history` | 200 | Bearer |
| 75 | DB | GET | `/scim/admin/database/users` | 200 | Bearer |
| 71 | DB | GET | `/scim/admin/database/users/:id` | 200 | Bearer |
| 72 | DB | GET | `/scim/admin/database/groups` | 200 | Bearer |
| 73 | DB | GET | `/scim/admin/database/groups/:id` | 200 | Bearer |
| 74 | DB | GET | `/scim/admin/database/statistics` | 200 | Bearer |
| 75 | Activity | GET | `/scim/admin/activity` | 200 | Bearer |
| 76 | Activity | GET | `/scim/admin/activity/summary` | 200 | Bearer |
