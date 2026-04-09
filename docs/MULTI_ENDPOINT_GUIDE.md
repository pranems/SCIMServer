# Multi-Endpoint SCIM Guide

> **Status**: Living architecture guide  
> **Last Updated**: March 1, 2026  
> **Baseline**: SCIMServer (current release)

> Consolidated reference for the multi-endpoint (multi-endpoint) SCIM architecture in SCIMServer.

---

## Overview

SCIMServer supports **multi-endpoint isolation** — each endpoint gets a dedicated SCIM base path with completely isolated Users, Groups, and configuration. This enables a single SCIMServer deployment to serve multiple Entra ID enterprise applications or endpoints simultaneously.

### Key Capabilities

- **Isolated SCIM endpoints** at `/scim/endpoints/{endpointId}`
- **Separate data** — Users and Groups per endpoint (composite unique constraints)
- **Per-endpoint configuration** — control behavior via config flags
- **Cascade deletion** — removing an endpoint deletes all associated data
- **Inactive endpoint blocking** — deactivated endpoints return 403 Forbidden

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        API Gateway / Clients                            │
│                    (Authorization: Bearer <token>)                      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │                                      │
  ┌─────────▼──────────┐              ┌───────────▼───────────┐
  │   Admin Routes      │              │    SCIM Routes        │
  │ /scim/admin/*       │              │ /scim/endpoints/*     │
  └─────────┬──────────┘              └───────────┬───────────┘
            │                                      │
            ▼                                      ▼
   EndpointController               EndpointScimUsersController
   EndpointService                  EndpointScimGroupsController
                                    EndpointScimDiscoveryController
                                             │
                                    ┌────────┴────────┐
                                    ▼                  ▼
                             EndpointScim       EndpointScim
                             UsersService       GroupsService
                                    │                  │
                                    ▼                  ▼
                              ┌──────────────────────────┐
                              │   PrismaService (ORM)    │
                              │   + EndpointContext       │
                              └──────────┬───────────────┘
                                         │
             ┌───────────────────────────┼───────────────────────────┐
             │                           │                           │
        ┌────▼────┐               ┌──────▼────┐              ┌──────▼──────┐
        │Endpoint │◄──────────────│ScimResource│
        │ Model   │  endpointId   │ (unified)  │
        └─────────┘               └────────────┘
              Composite Unique Constraints:
              ├─ @@unique([endpointId, scimId])
              ├─ @@unique([endpointId, userName])
              └─ @@unique([endpointId, externalId])
                            CASCADE DELETE
```

### Request Context Isolation

Each request flows through `EndpointContextStorage` (AsyncLocalStorage-based) which binds:
- `endpointId` — the endpoint being accessed
- `baseUrl` — the SCIM base for `meta.location` generation
- `profile` — endpoint profile with schemas, resource types, SPC, and settings (behavioral flags)

This ensures complete data isolation between concurrent requests to different endpoints.

---

## API Reference

### Endpoint Management (`/scim/admin/endpoints`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/scim/admin/endpoints` | Create endpoint |
| `GET` | `/scim/admin/endpoints` | List endpoints (optional `?active=true|false&view=summary|full`) |
| `GET` | `/scim/admin/endpoints/{id}` | Get endpoint by ID (`?view=full|summary`) |
| `GET` | `/scim/admin/endpoints/by-name/{name}` | Get endpoint by name (`?view=full|summary`) |
| `GET` | `/scim/admin/endpoints/presets` | List built-in profile presets |
| `GET` | `/scim/admin/endpoints/presets/{name}` | Get preset full profile |
| `PATCH` | `/scim/admin/endpoints/{id}` | Update endpoint (displayName, description, profile, active) |
| `DELETE` | `/scim/admin/endpoints/{id}` | Delete endpoint + cascade all data |
| `GET` | `/scim/admin/endpoints/{id}/stats` | Get user/group counts |

#### Create Endpoint

```bash
TOKEN=$(curl -s -X POST http://localhost:6000/scim/oauth/token \
  -d "client_id=scimserver-client&client_secret=changeme-oauth&grant_type=client_credentials" \
  | jq -r '.access_token')

curl -X POST http://localhost:6000/scim/admin/endpoints \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "acme-corp",
    "displayName": "ACME Corporation",
    "profile": {
      "settings": {
        "MultiOpPatchRequestAddMultipleMembersToGroup": "true",
        "MultiOpPatchRequestRemoveMultipleMembersFromGroup": "true",
        "VerbosePatchSupported": "true"
      }
    }
  }'
```

**Response (201):**
```json
{
  "id": "clx123abc456def",
  "name": "acme-corp",
  "displayName": "ACME Corporation",
  "scimEndpoint": "/scim/endpoints/clx123abc456def",
  "active": true,
  "profile": { "settings": { ... }, ... },
  "createdAt": "2026-02-11T...",
  "updatedAt": "2026-02-11T..."
}
```

### Endpoint-Specific SCIM (`/scim/endpoints/{endpointId}`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/Users` | Create user |
| `GET` | `/Users` | List/filter users |
| `GET` | `/Users/{id}` | Get user by ID |
| `POST` | `/Users/.search` | Search users (RFC 7644 §3.4.3) |
| `PUT` | `/Users/{id}` | Replace user |
| `PATCH` | `/Users/{id}` | Partial update user |
| `DELETE` | `/Users/{id}` | Delete user |
| `POST` | `/Groups` | Create group |
| `GET` | `/Groups` | List/filter groups |
| `GET` | `/Groups/{id}` | Get group by ID |
| `POST` | `/Groups/.search` | Search groups (RFC 7644 §3.4.3) |
| `PUT` | `/Groups/{id}` | Replace group |
| `PATCH` | `/Groups/{id}` | Partial update group |
| `DELETE` | `/Groups/{id}` | Delete group |
| `GET/PUT/PATCH/DELETE` | `/Me` | Current user operations (requires OAuth JWT) |
| `POST` | `/Bulk` | Bulk operations (requires `bulk.supported = true`) |
| `GET` | `/Schemas` | SCIM schema definitions |
| `GET` | `/ResourceTypes` | Resource type definitions |
| `GET` | `/ServiceProviderConfig` | Server capability advertisement |

---

## Configuration Flags

Per-endpoint config flags control SCIM behavior. Set via `profile.settings` on endpoint create/update (PATCH).

> **Default behavior:** When no settings are provided, the `entra-id` preset is used automatically. It sets `AllowAndCoerceBooleanStrings`, `VerbosePatchSupported`, `MultiMemberPatchOpForGroupEnabled`, `PatchOpAllowRemoveAllMembers`, and `StrictSchemaValidation` to `True`. Delete flags default to `true`.

| Flag | Default | When `true` | When `false` |
|------|---------|-------------|--------------|
| `UserSoftDeleteEnabled` | **`true`** | PATCH `{active:false}` deactivates user | PATCH `{active:false}` → error |
| `UserHardDeleteEnabled` | **`true`** | DELETE /Users/{id} permanently removes | DELETE → error |
| `GroupHardDeleteEnabled` | **`true`** | DELETE /Groups/{id} permanently removes | DELETE → error |
| `MultiMemberPatchOpForGroupEnabled` | **`true`** | Multi-member add/remove in single op | One member per op |
| `SchemaDiscoveryEnabled` | **`true`** | Discovery endpoints respond normally | Discovery endpoints → 404 |
| `StrictSchemaValidation` | **`true`** | Extension URNs required in `schemas[]` | Lenient mode |
| `AllowAndCoerceBooleanStrings` | **`true`** | `"True"`/`"False"` auto-converted to booleans | Strings pass through as-is |
| `PatchOpAllowRemoveAllMembers` | `false` | `path=members` removes all | Must specify member IDs |
| `VerbosePatchSupported` | `false` | Dot-notation PATCH paths resolved | Dot paths stored as literal keys |
| `RequireIfMatch` | `false` | `If-Match` required (428 if missing) | Optional (validated when present) |
| `PerEndpointCredentialsEnabled` | `false` | Per-endpoint bearer tokens | Global auth only |
| `IncludeWarningAboutIgnoredReadOnlyAttribute` | `false` | Warning header on readOnly stripping | Silent stripping |
| `IgnoreReadOnlyAttributesInPatch` | `false` | Strip readOnly PATCH ops when strict is on | 400 on readOnly PATCH ops |
| `logLevel` | *(unset)* | Per-endpoint log level override | Global `LOG_LEVEL` used |

**Enable for Microsoft Entra ID:** The `entra-id` preset (default) sets `MultiMemberPatchOpForGroupEnabled`, `VerbosePatchSupported`, `AllowAndCoerceBooleanStrings`, `PatchOpAllowRemoveAllMembers`, and `StrictSchemaValidation` to `True`.

For the full reference: [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md)

---

## Data Isolation

1. **Composite unique constraints** — the same `userName`, `externalId`, or `scimId` can exist in different endpoints without conflict.
2. **Query filtering** — all database queries include `WHERE endpointId = ?`.
3. **AsyncLocalStorage** — request context isolated per request; no data leakage between concurrent requests.
4. **Cascade delete** — deleting an endpoint removes all users, groups, memberships, and logs automatically via foreign key constraints.

---

## Example Workflow

```bash
# 1. Create endpoint
ENDPOINT_ID=$(curl -s -X POST http://localhost:6000/scim/admin/endpoints \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"contoso","displayName":"Contoso Ltd"}' | jq -r '.id')

# 2. Create a user in that endpoint
curl -X POST "http://localhost:6000/scim/endpoints/$ENDPOINT_ID/Users" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "john@contoso.com",
    "name": {"givenName": "John", "familyName": "Doe"},
    "active": true
  }'

# 3. Delete endpoint (cascades all data)
curl -X DELETE "http://localhost:6000/scim/admin/endpoints/$ENDPOINT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/modules/endpoint/controllers/endpoint.controller.ts` | Admin endpoint management APIs |
| `src/modules/endpoint/services/endpoint.service.ts` | Endpoint CRUD logic |
| `src/modules/endpoint/endpoint-context.storage.ts` | AsyncLocalStorage request context |
| `src/modules/endpoint/endpoint-config.interface.ts` | Config flag constants + helpers |
| `src/modules/scim/controllers/endpoint-scim-users.controller.ts` | Endpoint-scoped User SCIM routes |
| `src/modules/scim/controllers/endpoint-scim-groups.controller.ts` | Endpoint-scoped Group SCIM routes |
| `src/modules/scim/controllers/endpoint-scim-discovery.controller.ts` | Endpoint-scoped discovery routes |
| `src/modules/scim/services/endpoint-scim-users.service.ts` | User CRUD with endpoint isolation |
| `src/modules/scim/services/endpoint-scim-groups.service.ts` | Group CRUD with endpoint isolation |

---

## Database Schema

```prisma
model Endpoint {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String   @unique
  displayName String?
  description String?
  profile     Json?                     // JSONB profile (schemas, resourceTypes, SPC, settings)
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  resources   ScimResource[]
  logs        RequestLog[]
  credentials EndpointCredential[]
}

// ScimResource has:
//   endpointId    String (required FK)
//   resourceType  String ('User' / 'Group')
//   @@unique([endpointId, scimId])
//   @@unique([endpointId, userName])       (CITEXT, case-insensitive)
//   @@unique([endpointId, displayName])    (CITEXT, case-insensitive)
//   @@unique([endpointId, resourceType, externalId])
```

---

*Consolidated from: MULTI_ENDPOINT_SUMMARY, MULTI_ENDPOINT_ARCHITECTURE, MULTI_ENDPOINT_IMPLEMENTATION, MULTI_ENDPOINT_API_REFERENCE, MULTI_ENDPOINT_CHECKLIST, MULTI_ENDPOINT_QUICK_START, MULTI_ENDPOINT_VISUAL_GUIDE, MULTI_ENDPOINT_INDEX, MULTI_ENDPOINT_COMPLETION_REPORT*
