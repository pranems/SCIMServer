# SCIMServer — Complete REST API Reference

> Updated: March 1, 2026 · Scope: SCIM + admin + OAuth + web routes

This document enumerates all REST API endpoints and resources exposed by the SCIMServer application, with HTTP methods, purpose, common query parameters, expected request and response shapes, authentication notes, and `curl` examples for each operation.

Base path
- The server mounts APIs under the global prefix `scim` by default. Runtime compatibility rewrites allow both `/scim/*` and `/scim/v2/*`.
- Base URL (example): `https://<API_HOST>/scim/v2`.

Authentication
- Protected endpoints require `Authorization: Bearer <token>` header.
- **Three accepted token modes** (evaluated in order — first match wins):
  1. **Per-endpoint credentials** (v0.21.0) — bcrypt-hashed tokens created via the Admin Credential API. Active only when `PerEndpointCredentialsEnabled` is `True` for the endpoint. Token is verified against stored bcrypt hashes for active, non-expired credentials. Sets `req.authType = 'endpoint_credential'`.
  2. **OAuth 2.0 JWT** issued by `POST /oauth/token` (client_credentials grant). Verified via JWT signature + expiry. Sets `req.authType = 'oauth'`.
  3. **Legacy shared secret** (value in `SCIM_SHARED_SECRET`) — direct string comparison. Sets `req.authType = 'legacy'`.
- If all three tiers fail, the server responds with `401 Unauthorized` and `WWW-Authenticate: Bearer realm="SCIM"` header.
- Public endpoints are decorated with `@Public()` — discovery endpoints (RFC 7644 §4), OAuth token endpoint, and static web UI.

Content type
- **Request:** Use `Content-Type: application/scim+json` or `application/json` for SCIM resource create/replace/patch operations.
- **Response:** All SCIM endpoints return `Content-Type: application/scim+json; charset=utf-8` as required by [RFC 7644 §3.1](https://datatracker.ietf.org/doc/html/rfc7644#section-3.1). Success responses are handled by the `ScimContentTypeInterceptor`; error responses are handled by the `ScimExceptionFilter`, which also ensures the `status` field is a string per RFC 7644 §3.12.

Common response codes
- 200 OK — successful retrieval or update (sometimes 204 for operations that return no content).
- 201 Created — resource created.
- 204 No Content — successful deletion or empty responses where specified.
- 400 Bad Request — validation or malformed payload.
- 401 Unauthorized — missing/invalid token.
- 404 Not Found — resource not found.
- 409 Conflict — uniqueness collision (SCIM uniqueness error).
- 500 Internal Server Error — unexpected failures.

Contents
- SCIM metadata endpoints
  - `GET /ServiceProviderConfig`
  - `GET /ResourceTypes`
  - `GET /Schemas`
- Users resource
  - `POST /Users` — create
  - `GET /Users` — list / filter / projection
  - `GET /Users/:id` — get by id (with ETag)
  - `POST /Users/.search` — search via POST body (RFC 7644 §3.4.3)
  - `PUT /Users/:id` — replace
  - `PATCH /Users/:id` — patch
  - `DELETE /Users/:id` — delete
- Groups resource
  - `POST /Groups` — create
  - `GET /Groups` — list / filter / projection
  - `GET /Groups/:id` — get by id (with ETag)
  - `POST /Groups/.search` — search via POST body (RFC 7644 §3.4.3)
  - `PUT /Groups/:id` — replace
  - `PATCH /Groups/:id` — patch (returns 200 OK with updated group resource)
  - `DELETE /Groups/:id` — delete
- Bulk Operations (RFC 7644 §3.7)
  - `POST /Bulk` — batch processing (requires `BulkOperationsEnabled` config flag)
- Custom Resource Types (requires `CustomResourceTypesEnabled` config flag)
  - `POST /admin/endpoints/:endpointId/resource-types` — register custom resource type
  - `GET /admin/endpoints/:endpointId/resource-types` — list registered types
  - `GET /admin/endpoints/:endpointId/resource-types/:name` — get by name
  - `DELETE /admin/endpoints/:endpointId/resource-types/:name` — delete by name
  - Generic SCIM CRUD: `POST/GET/PUT/PATCH/DELETE /:resourceType` for registered types
- Per-endpoint credentials (requires `PerEndpointCredentialsEnabled` config flag)
  - `POST /admin/endpoints/:endpointId/credentials` — generate credential (returns token once)
  - `GET /admin/endpoints/:endpointId/credentials` — list credentials (hash masked)
  - `DELETE /admin/endpoints/:endpointId/credentials/:credentialId` — revoke credential
- ReadOnly attribute stripping (RFC 7643 §2.2 — automatic)
  - POST/PUT payloads auto-strip `mutability:'readOnly'` attributes (`id`, `meta`, `groups`, custom readOnly)
  - PATCH ops targeting readOnly attrs silently stripped (non-strict mode) or rejected (strict mode)
  - Optional warning URN (`urn:scimserver:api:messages:2.0:Warning`) when `IncludeWarningAboutIgnoredReadOnlyAttribute` enabled
  - `IgnoreReadOnlyAttributesInPatch` flag overrides strict PATCH rejection → strip+warn
- Admin endpoints (`/admin`)
  - `GET /admin/version` — version & deployment info
  - `GET /admin/logs` — list request logs (with filters)
  - `GET /admin/logs/:id` — get single log
  - `POST /admin/logs/clear` — clear logs (204)
  - `POST /admin/users/manual` — create manual user (admin convenience)
  - `POST /admin/groups/manual` — create manual group
  - `POST /admin/users/:id/delete` — delete user by identifier (204)
- Log Configuration endpoints (guarded)
  - `GET /admin/log-config` — get current log configuration
  - `PUT /admin/log-config` — update log configuration (partial)
  - `PUT /admin/log-config/level/:level` — quick global level change
  - `PUT /admin/log-config/category/:category/:level` — set category level
  - `PUT /admin/log-config/endpoint/:endpointId/:level` — set endpoint level override
  - `DELETE /admin/log-config/endpoint/:endpointId` — remove endpoint override
  - `GET /admin/log-config/recent` — query ring buffer (with filters)
  - `DELETE /admin/log-config/recent` — clear ring buffer
- OAuth endpoints
  - `POST /oauth/token` — client credentials token issuance (public)
  - `GET /oauth/test` — simple test endpoint (public)
- Web UI assets (public)
  - `GET /` `GET /admin` — serve SPA
  - `GET /assets/*` — static assets

---

SCIM metadata endpoints (RFC 7644 §4 — SHALL NOT require authentication)

> **Multi-Tenant Note:** SCIMServer is a multi-tenant/multi-endpoint server. Each SCIM endpoint
> can have its own configuration flags and custom schema extensions. Discovery routes exist at
> **two levels**:
>
> | Level | Path prefix | Behavior |
> |---|---|---|
> | **Root-level** (global defaults) | `/scim/v2/` | Returns global defaults without endpoint context |
> | **Endpoint-scoped** (**primary**) | `/scim/endpoints/{endpointId}/` | Returns tenant-specific discovery merging global + per-endpoint overlays |
>
> **Clients provisioning a specific endpoint should always use endpoint-scoped routes** to see
> accurate capabilities (e.g. `bulk.supported` reflecting `BulkOperationsEnabled` flag),
> endpoint-specific schema extensions, and custom resource types.

### Root-Level Discovery (global defaults)

1) GET /ServiceProviderConfig
- Purpose: Return SCIM service provider capabilities (patch, filter, sort, auth schemes) — global defaults.
- Auth: Public — no authentication required per RFC 7644 §4.
- Note: Returns default capabilities. For per-endpoint capabilities, use the endpoint-scoped route.
- Example:
  curl "https://<API_BASE>/scim/v2/ServiceProviderConfig"

2) GET /ResourceTypes
- Purpose: Return list of resource types supported (`User`, `Group`) — global defaults.
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/v2/ResourceTypes"

3) GET /ResourceTypes/{id}
- Purpose: Return a single resource type by id (e.g., `User`, `Group`).
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/v2/ResourceTypes/User"
- Error: 404 with SCIM error body if `{id}` is unknown.

4) GET /Schemas
- Purpose: Return all registered SCIM schema descriptions (7 built-in: User, EnterpriseUser, Group + 4 msfttest extensions) — global defaults.
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/v2/Schemas"

5) GET /Schemas/{uri}
- Purpose: Return a single schema definition by its URN.
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User"
- Error: 404 with SCIM error body if `{uri}` is unknown.

### Endpoint-Scoped Discovery (primary — multi-tenant)

6) GET /endpoints/{endpointId}/ServiceProviderConfig
- Purpose: Return SCIM service provider capabilities for a specific endpoint.
- Auth: Public.
- Behavior: Dynamically adjusts capabilities based on endpoint config flags (e.g. `BulkOperationsEnabled`).
- Example:
  curl "https://<API_BASE>/scim/endpoints/{endpointId}/ServiceProviderConfig"

7) GET /endpoints/{endpointId}/Schemas
- Purpose: Return all schemas visible to this endpoint (global + endpoint-specific extensions).
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/endpoints/{endpointId}/Schemas"

8) GET /endpoints/{endpointId}/Schemas/{uri}
- Purpose: Return a single schema by URN for this endpoint.
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/endpoints/{endpointId}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User"
- Error: 404 with SCIM error body if `{uri}` is unknown.

9) GET /endpoints/{endpointId}/ResourceTypes
- Purpose: Return resource types for this endpoint (global + per-endpoint custom types with merged extensions).
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/endpoints/{endpointId}/ResourceTypes"

10) GET /endpoints/{endpointId}/ResourceTypes/{id}
- Purpose: Return a single resource type by id for this endpoint.
- Auth: Public.
- Example:
  curl "https://<API_BASE>/scim/endpoints/{endpointId}/ResourceTypes/User"
- Error: 404 with SCIM error body if `{id}` is unknown.

---

Users resource — operations and examples

1) POST /Users
- Create SCIM User.
- Request Content-Type: `application/scim+json`.
- Body (minimum example):
```
{
  "schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName":"alice@example.com",
  "displayName":"Alice Example",
  "externalId":"external-123",
  "name": { "givenName":"Alice","familyName":"Example" },
  "emails":[{"value":"alice@example.com","type":"work","primary":true}]
}
```
- Success: 201 Created with full SCIM user resource (includes `id`, `meta`).
- curl example:
```
curl -X POST "https://<API_BASE>/scim/v2/Users" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/scim+json" \
  -d '{...payload...}'
```

2) GET /Users
- List users with SCIM paging, filtering & attribute projection.
- Query params supported: `filter`, `startIndex`, `count`, `attributes`, `excludedAttributes`.
  - `attributes` — comma-separated list of attributes to include (e.g., `?attributes=userName,displayName`). Always-returned: `id`, `schemas`, `meta`.
  - `excludedAttributes` — comma-separated list of attributes to exclude (e.g., `?excludedAttributes=emails,phoneNumbers`). Cannot exclude `id`, `schemas`, `meta`.
  - When both are specified, `attributes` takes precedence per RFC 7644 §3.4.2.5.
- Example (list first 50):
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/Users?startIndex=1&count=50"
```
- Example (filter by userName):
```
curl -G -H "Authorization: Bearer <TOKEN>" \
  --data-urlencode "filter=userName eq \"alice@example.com\"" \
  "https://<API_BASE>/scim/v2/Users"
```
- Example (attribute projection):
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/Users?attributes=userName,displayName&count=10"
```

3) GET /Users/:id
- Retrieve single user by SCIM `id`.
- Supports `?attributes=` and `?excludedAttributes=` for attribute projection.
- Response includes `ETag` header (weak ETag: `W/"v{N}"` — version-based, monotonic). Use `If-None-Match` to get 304 Not Modified. Use `If-Match` on PUT/PATCH/DELETE for pre-write concurrency control (412 Precondition Failed on mismatch).
- Example:
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/Users/<USER_ID>"
```
- Example (conditional GET):
```
curl -H "Authorization: Bearer <TOKEN>" -H 'If-None-Match: W/"v3"' \
  "https://<API_BASE>/scim/v2/Users/<USER_ID>"
# Returns 304 if unchanged, 200 with full resource if changed
```

3b) POST /Users/.search (RFC 7644 §3.4.3)
- Search users via POST body with SearchRequest schema. Returns 200 OK with ListResponse.
- Body params: `filter`, `startIndex`, `count`, `attributes`, `excludedAttributes`.
- Example:
```
curl -X POST "https://<API_BASE>/scim/v2/Users/.search" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],"filter":"userName eq \"alice@example.com\"","startIndex":1,"count":10,"attributes":"userName,displayName"}'
```

4) PUT /Users/:id
- Replace user resource (full replace semantics). Body should contain full SCIM user resource for the id.
- Example:
```
curl -X PUT "https://<API_BASE>/scim/v2/Users/<USER_ID>" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/scim+json" \
  -d '{...full resource body...}'
```

5) PATCH /Users/:id
- SCIM Patch (partial updates). Use SCIM PatchOp schema in body.
- Body example:
```
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations":[
    {"op":"replace","path":"displayName","value":"Alice New"}
  ]
}
```
- Example curl:
```
curl -X PATCH "https://<API_BASE>/scim/v2/Users/<USER_ID>" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/scim+json" \
  -d '{...patch body...}'
```

6) DELETE /Users/:id
- Delete user by id. When `SoftDeleteEnabled` is `true` on the endpoint config, the user is soft-deleted (set `active=false`) instead of physically removed; returns `204 No Content` in both cases.
- Example:
```
curl -X DELETE "https://<API_BASE>/scim/v2/Users/<USER_ID>" -H "Authorization: Bearer <TOKEN>"
```

Notes on errors
- Attempting to create a user with `userName` or `externalId` that already exists results in 409 Conflict (SCIM uniqueness error).

---

Groups resource — operations and examples

1) POST /Groups
- Create group. Body example:
```
{
  "schemas":["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName":"Engineering",
  "members":[{"value":"<USER_ID>","display":"Alice Example"}]
}
```
- curl example:
```
curl -X POST "https://<API_BASE>/scim/v2/Groups" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/scim+json" \
  -d '{...payload...}'
```

2) GET /Groups
- List groups, supports pagination & filtering similar to users.
- Example:
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/Groups?startIndex=1&count=50"
```

3) GET /Groups/:id
- Retrieve group by id. Supports `?attributes=` and `?excludedAttributes=` for projection.
- Response includes `ETag` header.

3b) POST /Groups/.search (RFC 7644 §3.4.3)
- Search groups via POST body. Same semantics as POST /Users/.search.
- Example:
```
curl -X POST "https://<API_BASE>/scim/v2/Groups/.search" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],"filter":"displayName eq \"Engineering\"","count":10}'
```

4) PUT /Groups/:id
- Replace group resource.

5) PATCH /Groups/:id
- SCIM Patch semantics for group membership; returns 200 OK with the updated Group resource body.

6) DELETE /Groups/:id
- Remove group. When `SoftDeleteEnabled` is `true` on the endpoint config, the group is soft-deleted (set `active=false`) instead of physically removed; returns `204 No Content` in both cases.

---

Bulk Operations (RFC 7644 §3.7)

1) POST /Bulk
- Purpose: Process multiple SCIM operations in a single HTTP request.
- Requires `BulkOperationsEnabled` config flag to be `true` on the endpoint (default: `false`; returns 403 when disabled).
- Request Content-Type: `application/scim+json`.
- Body:
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "Operations": [
    { "method": "POST", "path": "/Users", "bulkId": "user1", "data": { "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"], "userName": "bulk-user@example.com" } },
    { "method": "PATCH", "path": "/Users/bulkId:user1", "data": { "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], "Operations": [{ "op": "replace", "path": "displayName", "value": "Updated" }] } }
  ],
  "failOnErrors": 5
}
```
- Response: `200 OK` with `BulkResponse` body containing per-operation results.
- `bulkId` cross-referencing: Use `bulkId:reference` in subsequent operation paths to reference resources created earlier in the same batch.
- `failOnErrors`: Stop processing after this many operation failures.
- Max payload size: 1MB. Max operations: 1000.
- Example:
  curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/scim+json" -d @bulk-request.json "https://<API_BASE>/scim/v2/endpoints/<endpointId>/Bulk"

---

Admin endpoints (non-SCIM but mounted under `/scim/admin`)

1) GET /admin/version
- Returns `VersionInfo` including:
  - `version`, `commit`, `buildTime`
  - `service` (environment, API prefix/base path, uptime, timezone, utcOffset)
  - `runtime` (node/platform/arch, pid/hostname/cpu, memory usage, containerized flag)
  - `auth` (configuration status booleans only; no secrets)
  - `storage` (database URL with credentials masked, provider, persistence backend, connection pool)
  - `container` (present only when containerized — app id/name/image/runtime/platform; database host/port/name/provider)
  - `deployment` metadata
- Example:
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/admin/version"
```

- Sample response (trimmed):
```
{
  "version": "0.24.0",
  "service": {
    "environment": "production",
    "scimBasePath": "/scim/v2",
    "uptimeSeconds": 1234.567,
    "timezone": "UTC",
    "utcOffset": "+00:00"
  },
  "runtime": {
    "node": "v24.x",
    "platform": "linux",
    "arch": "x64",
    "containerized": true,
    "memory": {
      "rss": 123456789,
      "heapUsed": 34567890
    }
  },
  "auth": {
    "oauthClientSecretConfigured": true,
    "jwtSecretConfigured": true,
    "scimSharedSecretConfigured": true
  },
  "storage": {
    "databaseUrl": "postgresql://***:***@postgres:5432/scimdb?schema=public",
    "databaseProvider": "postgresql",
    "persistenceBackend": "prisma",
    "connectionPool": { "maxConnections": 5 }
  },
  "container": {
    "app": {
      "id": "7d32d069b1af",
      "name": "7d32d069b1af",
      "runtime": "Node.js v24.13.1",
      "platform": "linux/x64"
    },
    "database": {
      "host": "postgres",
      "port": 5432,
      "name": "scimdb",
      "provider": "PostgreSQL 17-alpine"
    }
  },
  "deployment": {
    "migratePhase": "Phase 3 — PostgreSQL Migration"
  }
}
```

2) GET /admin/logs
- List captured request logs; query params:
  - `page`, `pageSize`, `method`, `status`, `hasError`, `urlContains`, `since`, `until`, `search`, `includeAdmin`, `hideKeepalive`.
- Example:
```
curl -H "Authorization: Bearer <TOKEN>" \
  "https://<API_BASE>/scim/v2/admin/logs?page=1&pageSize=20&hideKeepalive=true"
```

3) GET /admin/logs/:id
- Get detailed log (request/response bodies) by log id.

4) POST /admin/logs/clear
- Clear captured logs. Returns 204 on success.
- Example:
```
curl -X POST "https://<API_BASE>/scim/v2/admin/logs/clear" -H "Authorization: Bearer <TOKEN>"
```

5) POST /admin/users/manual
- Convenience admin route to create a user using a simplified DTO (admin UI uses this). Example body:
```
{
  "userName":"seed.user@example.com",
  "externalId":"obj-0001",
  "displayName":"Seed User",
  "givenName":"Seed",
  "familyName":"User",
  "email":"seed.user@example.com"
}
```
- Example curl:
```
curl -X POST "https://<API_BASE>/scim/v2/admin/users/manual" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/scim+json" \
  -d '{...payload...}'
```

6) POST /admin/groups/manual
- Convenience admin route to create groups.

7) POST /admin/users/:id/delete
- Admin convenience to delete by identifier; returns 204 or 404.

---

Per-Endpoint Credential Management (v0.21.0)

> **Prerequisite:** The endpoint must have `PerEndpointCredentialsEnabled` set to `True` in its config. If disabled, credential routes return `403 Forbidden`.

1) POST /admin/endpoints/:endpointId/credentials
- Generate a new per-endpoint bearer token.
- Auth: Required (OAuth JWT or global shared secret — admin access).
- Request body:
```json
{
  "credentialType": "bearer",         // "bearer" (default) | "oauth_client"
  "label": "Production API Key",      // Optional human-readable label
  "expiresAt": "2026-12-31T23:59:59Z" // Optional ISO 8601 expiry
}
```
- Response (201 Created):
```json
{
  "id": "a1b2c3d4-...",
  "endpointId": "e5f6g7h8-...",
  "credentialType": "bearer",
  "label": "Production API Key",
  "active": true,
  "createdAt": "2026-02-27T01:00:00.000Z",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "token": "Kx7mN2pQ..."
}
```
- **⚠️ The `token` field is returned ONCE only.** The server stores only the bcrypt hash (12 rounds). Save this value securely.
- Example curl:
```
curl -X POST "https://<API_BASE>/scim/admin/endpoints/<EID>/credentials" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"credentialType":"bearer","label":"My Key"}'
```

2) GET /admin/endpoints/:endpointId/credentials
- List all credentials for this endpoint. The `credentialHash` is **never** returned.
- Auth: Required.
- Response (200 OK): Array of credential objects (without `token` or `credentialHash`).
- Example curl:
```
curl -H "Authorization: Bearer <TOKEN>" \
  "https://<API_BASE>/scim/admin/endpoints/<EID>/credentials"
```

3) DELETE /admin/endpoints/:endpointId/credentials/:credentialId
- Revoke (deactivate) a credential. The credential is soft-deactivated (`active: false`), not hard-deleted.
- Auth: Required.
- Response: 204 No Content.
- Example curl:
```
curl -X DELETE "https://<API_BASE>/scim/admin/endpoints/<EID>/credentials/<CID>" \
  -H "Authorization: Bearer <TOKEN>"
```

**Using a per-endpoint token:**
Once created, use the token as a Bearer token for any SCIM operation on that endpoint:
```
curl -H "Authorization: Bearer <per-endpoint-token>" \
  "https://<API_BASE>/scim/endpoints/<EID>/Users"
```
The guard extracts the `endpointId` from the URL, loads active non-expired credentials, and bcrypt-verifies the token. On mismatch, it falls through to OAuth and legacy auth.

---

---

OAuth endpoints

1) POST /oauth/token (public)
- Exchange `client_id` + `client_secret` for an access token using `grant_type=client_credentials`.
- Request body (JSON):
```
{
  "grant_type":"client_credentials",
  "client_id":"<id>",
  "client_secret":"<secret>",
  "scope":"scim.read scim.write scim.manage"
}
```
- Response:
```
{
  "access_token":"<JWT>",
  "token_type":"Bearer",
  "expires_in":3600,
  "scope":"scim.read scim.write"
}
```
- Example curl:
```
curl -X POST "https://<API_BASE>/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"<SECRET>","scope":"scim.manage"}'
```

2) GET /oauth/test (public)
- Returns a small JSON to verify OAuth controller is reachable.

---

Web UI (public)

- `GET /` `GET /admin` serve `public/index.html` — the React SPA.
- `GET /assets/*` serve static assets.

---

Examples — error responses

1) 401 Unauthorized (invalid token)
- Response header: `WWW-Authenticate: Bearer realm="SCIM"`.
- Body: SCIM error schema similar to:
```
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail":"Invalid bearer token.",
  "status":"401"
}
```

2) 409 Conflict (uniqueness)
- Example body:
```
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail":"User with userName already exists",
  "status":"409",
  "scimType":"uniqueness"
}
```

---

Persistence & models
- Prisma models of interest are in `api/prisma/schema.prisma` (`ScimResource`, `ResourceMember`, `RequestLog`, `Endpoint`, `EndpointSchema`, `EndpointResourceType`, `EndpointCredential`).
- `payload` JSONB column stores the full SCIM resource; `meta` stores SCIM meta JSON string.

---

Appendix — Useful curl snippets

- Get token and create user (combined):
```
TOKEN=$(curl -s -X POST "https://<API_BASE>/oauth/token" -H "Content-Type: application/json" -d '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"<SECRET>","scope":"scim.manage"}' | jq -r .access_token)
curl -X POST "https://<API_BASE>/scim/v2/Users" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/scim+json" -d '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"alice@example.com"}'
```

- List logs, hide keepalive:
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/admin/logs?hideKeepalive=true"
```

---

This document should be kept in `docs/COMPLETE_API_REFERENCE.md` and updated when endpoints or parameters change.

---

Executable examples (fully populated)

These examples are ready to run against a local development server running at `http://localhost:3000`.
Adjust values if your server runs elsewhere.

Environment variables used in the examples
- API_BASE=http://localhost:3000
- OAUTH client_id=scimserver-client
- OAUTH client_secret=dev-secret-abc123
- Shared secret (SCIM_SHARED_SECRET)=S3cr3tSharedValue

Obtain an OAuth token (client_credentials) and use it to create a user:

```sh
# Request a JWT access token using client credentials
API_BASE="http://localhost:3000"
CLIENT_ID="scimserver-client"
CLIENT_SECRET="dev-secret-abc123"

TOKEN=$(curl -s -X POST "${API_BASE}/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"dev-secret-abc123","scope":"scim.manage scim.read scim.write"}' \
  | jq -r .access_token)

echo "Access token: ${TOKEN}"

# Create a SCIM user using the issued token
curl -i -X POST "${API_BASE}/scim/v2/Users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName":"alice@example.com",
    "externalId":"ext-0001",
    "displayName":"Alice Example",
    "name": { "givenName":"Alice", "familyName":"Example" },
    "emails": [{ "value":"alice@example.com", "type":"work", "primary":true }]
  }'
```

Create a user using the shared secret instead of OAuth (legacy flow):

```sh
curl -i -X POST "http://localhost:3000/scim/v2/Users" \
  -H "Authorization: Bearer S3cr3tSharedValue" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName":"bob@example.com",
    "displayName":"Bob Example"
  }'
```

List users (first page, 50 items):

```sh
curl -s -H "Authorization: Bearer ${TOKEN}" "${API_BASE}/scim/v2/Users?startIndex=1&count=50" | jq .
```

Get user by id:

```sh
# Replace <USER_ID> with id returned from create response
curl -s -H "Authorization: Bearer ${TOKEN}" "${API_BASE}/scim/v2/Users/<USER_ID>" | jq .
```

Replace (PUT) user:

```sh
curl -i -X PUT "${API_BASE}/scim/v2/Users/<USER_ID>" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"alice@example.com","displayName":"Alice Renamed","active":true}'
```

Patch user (PATCH):

```sh
curl -i -X PATCH "${API_BASE}/scim/v2/Users/<USER_ID>" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"replace","path":"displayName","value":"Alice Patched"}]}'
```

Delete user:

```sh
curl -i -X DELETE "${API_BASE}/scim/v2/Users/<USER_ID>" -H "Authorization: Bearer ${TOKEN}"
```

Create a group:

```sh
curl -i -X POST "${API_BASE}/scim/v2/Groups" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:Group"],"displayName":"Engineering","members":[{"value":"<USER_ID>","display":"Alice Example"}]}'
```

Admin examples:

```sh
# Version info
curl -s -H "Authorization: Bearer ${TOKEN}" "${API_BASE}/scim/v2/admin/version" | jq .

# List logs
curl -s -H "Authorization: Bearer ${TOKEN}" "${API_BASE}/scim/v2/admin/logs?page=1&pageSize=20&hideKeepalive=true" | jq .

# Clear logs
curl -i -X POST "${API_BASE}/scim/v2/admin/logs/clear" -H "Authorization: Bearer ${TOKEN}"

# Create manual user (admin)
curl -i -X POST "${API_BASE}/scim/v2/admin/users/manual" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{"userName":"seed.user@example.com","externalId":"seed-001","displayName":"Seed User","givenName":"Seed","familyName":"User","email":"seed.user@example.com"}'
```

Log Configuration endpoints (runtime log management):

```sh
# Get current log configuration
curl -s -H "Authorization: Bearer ${TOKEN}" "${API_BASE}/scim/admin/log-config" | jq .

# Update configuration (partial)
curl -s -X PUT -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"globalLevel":"INFO","includePayloads":false,"format":"json","categoryLevels":{"scim.patch":"DEBUG","auth":"WARN"}}' \
  "${API_BASE}/scim/admin/log-config" | jq .

# Quick global level change
curl -s -X PUT -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/scim/admin/log-config/level/TRACE" | jq .

# Set category level
curl -s -X PUT -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/scim/admin/log-config/category/scim.patch/TRACE" | jq .

# Set endpoint-specific level override
curl -s -X PUT -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/scim/admin/log-config/endpoint/ep-abc123/DEBUG" | jq .

# Remove endpoint override
curl -s -X DELETE -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/scim/admin/log-config/endpoint/ep-abc123"

# Query recent logs (ring buffer)
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/scim/admin/log-config/recent?limit=20&level=WARN" | jq .

# Query logs by request correlation ID
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/scim/admin/log-config/recent?requestId=<UUID>" | jq .

# Clear ring buffer
curl -s -X DELETE -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/scim/admin/log-config/recent"
```

> See [LOGGING_AND_OBSERVABILITY.md](LOGGING_AND_OBSERVABILITY.md) for full documentation on structured logging, correlation IDs, flow examples, and production configuration.

OAuth token (inspect full response):

```sh
curl -s -X POST "${API_BASE}/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"dev-secret-abc123","scope":"scim.manage scim.read scim.write"}' | jq .
```

Use shared secret for an admin endpoint (legacy):

```sh
curl -s -H "Authorization: Bearer S3cr3tSharedValue" "${API_BASE}/scim/v2/admin/version" | jq .
```

---

Insomnia / OpenAPI

I included a minimal Insomnia export under `docs/insomnia/SCIMServer_Insomnia_Export.json`. Import it into Insomnia (`File > Import > From File`) to get a workspace with ready-to-run requests. The export uses the following environment defaults:
- base_url = `http://localhost:3000`
- client_id = `scimserver-client`
- client_secret = `dev-secret-abc123`
- shared_secret = `S3cr3tSharedValue`
