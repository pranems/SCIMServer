# SCIMServer � Complete REST API Reference

This document enumerates all REST API endpoints and resources exposed by the SCIMServer application, with HTTP methods, purpose, common query parameters, expected request and response shapes, authentication notes, and `curl` examples for each operation.

Base path
- The server mounts APIs under the global prefix `scim` by default. The runtime rewrites `/scim/v2/*` ? `/scim/*` for compatibility, so both `/scim/*` and `/scim/v2/*` work.
- Base URL (example): `https://<API_HOST>/scim/v2`.

Authentication
- Protected endpoints require `Authorization: Bearer <token>` header.
- Two accepted token modes:
  - OAuth 2.0 JWT issued by `POST /oauth/token` (client_credentials grant).
  - Shared secret (value in `SCIM_SHARED_SECRET`) for legacy deployments.
- Public endpoints are decorated with `@Public()` (static web UI and OAuth token endpoint).

Content type
- **Request:** Use `Content-Type: application/scim+json` or `application/json` for SCIM resource create/replace/patch operations.
- **Response:** All SCIM endpoints return `Content-Type: application/scim+json; charset=utf-8` as required by [RFC 7644 §3.1](https://datatracker.ietf.org/doc/html/rfc7644#section-3.1). Success responses are handled by the `ScimContentTypeInterceptor`; error responses are handled by the `ScimExceptionFilter`, which also ensures the `status` field is a string per RFC 7644 §3.12.

Common response codes
- 200 OK � successful retrieval or update (sometimes 204 for operations that return no content).
- 201 Created � resource created.
- 204 No Content � successful deletion or empty responses where specified.
- 400 Bad Request � validation or malformed payload.
- 401 Unauthorized � missing/invalid token.
- 404 Not Found � resource not found.
- 409 Conflict � uniqueness collision (SCIM uniqueness error).
- 500 Internal Server Error � unexpected failures.

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
- Admin endpoints (`/admin`)
  - `GET /admin/version` � version & deployment info
  - `GET /admin/logs` � list request logs (with filters)
  - `GET /admin/logs/:id` � get single log
  - `POST /admin/logs/clear` � clear logs (204)
  - `POST /admin/users/manual` � create manual user (admin convenience)
  - `POST /admin/groups/manual` � create manual group
  - `POST /admin/users/:id/delete` � delete user by identifier (204)
- Backup endpoints (guarded)
  - `GET /admin/backup/stats` � backup statistics
  - `POST /admin/backup/trigger` � manually trigger backup- Log Configuration endpoints (guarded)
  - `GET /admin/log-config` — get current log configuration
  - `PUT /admin/log-config` — update log configuration (partial)
  - `PUT /admin/log-config/level/:level` — quick global level change
  - `PUT /admin/log-config/category/:category/:level` — set category level
  - `PUT /admin/log-config/endpoint/:endpointId/:level` — set endpoint level override
  - `DELETE /admin/log-config/endpoint/:endpointId` — remove endpoint override
  - `GET /admin/log-config/recent` — query ring buffer (with filters)
  - `DELETE /admin/log-config/recent` — clear ring buffer- OAuth endpoints
  - `POST /oauth/token` � client credentials token issuance (public)
  - `GET /oauth/test` � simple test endpoint (public)
- Web UI assets (public)
  - `GET /` `GET /admin` � serve SPA
  - `GET /assets/*` � static assets

---

SCIM metadata endpoints

1) GET /ServiceProviderConfig
- Purpose: Return SCIM service provider capabilities (patch, filter, sort, auth schemes).
- Auth: Protected (guard) � requires bearer token unless decorated public.
- Example:
  curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/ServiceProviderConfig"

2) GET /ResourceTypes
- Purpose: Return list of resource types supported (`User`, `Group`).
- Example:
  curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/ResourceTypes"

3) GET /Schemas
- Purpose: Return SCIM `User` and `Group` schema descriptions.
- Example:
  curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/Schemas"

---

Users resource � operations and examples

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
- Response includes `ETag` header (weak ETag: `W/"<timestamp>"`). Use `If-None-Match` to get 304 Not Modified.
- Example:
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/Users/<USER_ID>"
```
- Example (conditional GET):
```
curl -H "Authorization: Bearer <TOKEN>" -H 'If-None-Match: W/"2026-02-11T22:42:00.940Z"' \
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
- Delete user by id.
- Example:
```
curl -X DELETE "https://<API_BASE>/scim/v2/Users/<USER_ID>" -H "Authorization: Bearer <TOKEN>"
```

Notes on errors
- Attempting to create a user with `userName` or `externalId` that already exists results in 409 Conflict (SCIM uniqueness error).

---

Groups resource � operations and examples

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
- Remove group.

---

Admin endpoints (non-SCIM but mounted under `/scim/admin`)

1) GET /admin/version
- Returns `VersionInfo` including `version`, `commit`, `buildTime`, `runtime`, and `deployment` metadata.
- Example:
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/admin/version"
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

Backup endpoints (guarded by shared secret / OAuth)

1) GET /admin/backup/stats
- Returns backup mode, counts, lastBackupTime, lastBackupSucceeded, restoredFromSnapshot, etc.
- Example curl:
```
curl -H "Authorization: Bearer <TOKEN>" "https://<API_BASE>/scim/v2/admin/backup/stats"
```

2) POST /admin/backup/trigger
- Manually trigger a backup (returns success + timestamp).

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

- `GET /` `GET /admin` serve `public/index.html` � the React SPA.
- `GET /assets/*` serve static assets.

---

Examples � error responses

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
- Prisma models of interest are in `api/prisma/schema.prisma` (`ScimUser`, `ScimGroup`, `GroupMember`, `RequestLog`).
- `rawPayload` column stores request JSON for auditing; `meta` stores SCIM meta JSON string.

---

Appendix � Useful curl snippets

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

Backup examples:

```sh
curl -s -H "Authorization: Bearer ${TOKEN}" "${API_BASE}/scim/v2/admin/backup/stats" | jq .
curl -i -X POST "${API_BASE}/scim/v2/admin/backup/trigger" -H "Authorization: Bearer ${TOKEN}"
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

I included a minimal Insomnia export under `docs/insomnia/SCIMServer_Insomnia_Export.json`. Import it into Insomnia (File ? Import ? From File) to get a workspace with ready-to-run requests. The export uses the following environment defaults:
- base_url = `http://localhost:3000`
- client_id = `scimserver-client`
- client_secret = `dev-secret-abc123`
- shared_secret = `S3cr3tSharedValue`

If you prefer an OpenAPI JSON instead, tell me and I will generate `docs/insomnia/SCIMServer_openapi.json`.
