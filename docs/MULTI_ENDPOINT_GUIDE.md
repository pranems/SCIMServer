# Multi-Endpoint SCIM Guide

> **Status**: Living architecture guide  
> **Last Updated**: February 18, 2026  
> **Baseline**: SCIMServer v0.10.0

> Consolidated reference for the multi-endpoint (multi-tenant) SCIM architecture in SCIMServer.

---

## Overview

SCIMServer supports **multi-endpoint isolation** — each endpoint gets a dedicated SCIM base path with completely isolated Users, Groups, and configuration. This enables a single SCIMServer deployment to serve multiple Entra ID enterprise applications or tenants simultaneously.

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
        │Endpoint │◄──────────────│ ScimUser  │              │ ScimGroup   │
        │ Model   │  endpointId   │ Model     │              │ Model       │
        └─────────┘               └───────────┘              └─────────────┘
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
- `config` — endpoint-specific configuration flags

This ensures complete data isolation between concurrent requests to different endpoints.

---

## API Reference

### Endpoint Management (`/scim/admin/endpoints`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/scim/admin/endpoints` | Create endpoint |
| `GET` | `/scim/admin/endpoints` | List endpoints (optional `?active=true\|false`) |
| `GET` | `/scim/admin/endpoints/{id}` | Get endpoint by ID |
| `GET` | `/scim/admin/endpoints/by-name/{name}` | Get endpoint by name |
| `PATCH` | `/scim/admin/endpoints/{id}` | Update endpoint (displayName, description, config, active) |
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
    "config": {
      "MultiOpPatchRequestAddMultipleMembersToGroup": "true",
      "MultiOpPatchRequestRemoveMultipleMembersFromGroup": "true",
      "VerbosePatchSupported": "true"
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
  "config": { ... },
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
| `GET` | `/Schemas` | SCIM schema definitions |
| `GET` | `/ResourceTypes` | Resource type definitions |
| `GET` | `/ServiceProviderConfig` | Server capability advertisement |

---

## Configuration Flags

Per-endpoint config flags control PATCH behavior. Set via the `config` JSON object on endpoint create/update.

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `MultiOpPatchRequestAddMultipleMembersToGroup` | `"true"` / `"false"` | `"false"` | Allow adding multiple group members in a single PATCH operation |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | `"true"` / `"false"` | `"false"` | Allow removing multiple group members in a single PATCH operation |
| `VerbosePatchSupported` | `"true"` / `"false"` | `"false"` | Enable dot-notation PATCH path resolution (e.g., `name.givenName`) |

**Enable for Microsoft Entra ID:** Set both multi-member flags to `"true"` since Entra sends multi-member PATCH operations.

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
  id          String   @id @default(cuid())
  name        String   @unique
  displayName String?
  description String?
  config      String?                   // JSON config flags
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  users       ScimUser[]
  groups      ScimGroup[]
  logs        RequestLog[]
}

// ScimUser and ScimGroup have:
//   endpointId  String (required FK)
//   @@unique([endpointId, scimId])
//   @@unique([endpointId, userName])     (Users only)
//   @@unique([endpointId, externalId])   (Users only)
```

---

*Consolidated from: MULTI_ENDPOINT_SUMMARY, MULTI_ENDPOINT_ARCHITECTURE, MULTI_ENDPOINT_IMPLEMENTATION, MULTI_ENDPOINT_API_REFERENCE, MULTI_ENDPOINT_CHECKLIST, MULTI_ENDPOINT_QUICK_START, MULTI_ENDPOINT_VISUAL_GUIDE, MULTI_ENDPOINT_INDEX, MULTI_ENDPOINT_COMPLETION_REPORT*
