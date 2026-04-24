# SCIMServer

> Production-ready, multi-tenant SCIM 2.0 server for Microsoft Entra ID provisioning and any RFC 7643/7644-compliant identity client.

[![Version](https://img.shields.io/badge/version-0.38.0-blue)]()
[![Node.js](https://img.shields.io/badge/Node.js-24-green)]()
[![NestJS](https://img.shields.io/badge/NestJS-11.1-red)]()
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-blue)]()
[![Tests](https://img.shields.io/badge/tests-5%2C274%20pass-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Deployment Options](#deployment-options)
- [SCIM 2.0 Compliance](#scim-20-compliance)
- [Authentication](#authentication)
- [Multi-Tenant Endpoints](#multi-tenant-endpoints)
- [Endpoint Profiles & Presets](#endpoint-profiles--presets)
- [Configuration Flags](#configuration-flags)
- [API Reference (Summary)](#api-reference-summary)
- [API Examples](#api-examples)
- [SCIM Filter Support](#scim-filter-support)
- [Attribute Projection](#attribute-projection)
- [Bulk Operations](#bulk-operations)
- [Observability & Logging](#observability--logging)
- [Web Admin UI](#web-admin-ui)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Documentation Index](#documentation-index)
- [Contributing](#contributing)

---

## Overview

SCIMServer is a fully RFC-compliant SCIM 2.0 server built with NestJS and PostgreSQL. It provides isolated, configurable multi-tenant endpoints - each with its own schema, resource types, authentication, and behavioral settings. Designed for Microsoft Entra ID provisioning but compatible with any SCIM client.

**Use cases:**
- Test and validate Entra ID SCIM provisioning configurations
- Develop and debug custom SCIM connectors
- Run compliance tests against a known-good SCIM implementation
- Provision users/groups from any SCIM-compliant identity provider

---

## Key Features

| Category | Capabilities |
|----------|-------------|
| **SCIM Protocol** | Full RFC 7643/7644 - Users, Groups, custom resource types, PATCH (add/replace/remove), PUT, Bulk, /Me, .search, filtering, sorting, pagination, ETag, attribute projection |
| **Multi-Tenant** | Isolated endpoints with independent schemas, resource types, config flags, credentials, and log streams |
| **Authentication** | 3-tier chain: per-endpoint bcrypt tokens - OAuth 2.0 JWT - global bearer secret |
| **Schema Engine** | 6 built-in presets, tighten-only customization, auto-expand from RFC baselines, strict validation |
| **Observability** | Structured JSON logging, SSE live stream, ring buffer, per-endpoint log isolation, file rotation, auto-prune |
| **Deployment** | Docker Compose (1 command), Azure Container Apps (1 script), local dev, pre-built GHCR image |
| **Web UI** | React + Vite admin dashboard - log viewer, database browser, activity feed, manual provisioning |
| **Testing** | 3,378 unit + 1,074 E2E + ~789 live + 112 ISV = ~5,274 total tests |

---

## Architecture

### System Overview

```
+-------------------------------------------------------------------------+
|                          SCIMServer (NestJS)                             |
|  +-------+  +------+  +---------+  +--------+  +-------+  +----------+ |
|  | Auth  |  | SCIM |  | Admin   |  | Logging|  | OAuth |  | Web UI   | |
|  | Guard |  | Core |  | Console |  | Engine |  | Token |  | (React)  | |
|  +---+---+  +--+---+  +----+----+  +---+----+  +---+---+  +----+-----+ |
|      |         |           |            |           |           |       |
|  +---+---------+-----------+------------+-----------+-----------+---+   |
|  |               Endpoint Service (Multi-Tenant Cache)              |   |
|  +------------------------------------------------------------------+  |
|      |                          |                                       |
|  +---+------+           +------+-------+                                |
|  | Prisma   |           | InMemory     |                                |
|  | (PG 17)  |           | (Dev/Test)   |                                |
|  +----------+           +--------------+                                |
+-------------------------------------------------------------------------+
```

### Data Model

```mermaid
erDiagram
    Endpoint ||--o{ ScimResource : "owns"
    Endpoint ||--o{ RequestLog : "logs"
    Endpoint ||--o{ EndpointCredential : "authenticates"
    ScimResource ||--o{ ResourceMember : "group has"
    ScimResource ||--o{ ResourceMember : "member of"

    Endpoint {
        uuid id PK
        string name UK
        string displayName
        string description
        jsonb profile
        boolean active
        datetime createdAt
        datetime updatedAt
    }

    ScimResource {
        uuid id PK
        string scimId
        uuid endpointId FK
        string resourceType
        citext userName
        citext displayName
        string externalId
        boolean active
        jsonb payload
        int version
        datetime deletedAt
        datetime createdAt
        datetime updatedAt
    }

    RequestLog {
        uuid id PK
        uuid endpointId FK
        string method
        string url
        int status
        int durationMs
        string requestHeaders
        string requestBody
        string responseHeaders
        string responseBody
        string identifier
        datetime createdAt
    }

    EndpointCredential {
        uuid id PK
        uuid endpointId FK
        string credentialType
        string label
        string tokenHash
        boolean active
        jsonb metadata
        datetime expiresAt
        datetime createdAt
        datetime updatedAt
    }

    ResourceMember {
        uuid id PK
        uuid groupId FK
        uuid memberId FK
    }
```

### Request Flow

```mermaid
sequenceDiagram
    participant C as SCIM Client
    participant G as Auth Guard
    participant M as Middleware
    participant Ctrl as Controller
    participant Svc as Service
    participant V as Schema Validator
    participant PE as Patch Engine
    participant R as Repository
    participant DB as PostgreSQL

    C->>G: POST /scim/endpoints/{id}/Users<br>Authorization: Bearer {token}
    G->>G: 1. Check Public decorator<br>2. Per-endpoint bcrypt<br>3. OAuth JWT<br>4. Shared secret
    G-->>C: 401 if all fail
    G->>M: Authenticated request
    M->>M: X-Request-Id (UUID)<br>Content-Type check<br>Endpoint context (ALS)
    M->>Ctrl: Validated request
    Ctrl->>Svc: createUser(body, endpointId)
    Svc->>Svc: Resolve endpoint profile<br>Check endpoint active
    Svc->>V: Validate against endpoint schema<br>(required, type, mutability, uniqueness)
    V-->>Svc: Validation result
    Svc->>Svc: Strip readOnly attributes<br>Boolean string coercion<br>Primary enforcement
    Svc->>R: create(endpointId, user)
    R->>DB: INSERT INTO ScimResource
    DB-->>R: Created row
    R-->>Svc: User model
    Svc->>Svc: Build response<br>(meta, location, schemas[], projection)
    Svc-->>Ctrl: SCIM User resource
    Ctrl-->>C: 201 Created<br>Content-Type: application/scim+json<br>Location: .../Users/{id}<br>ETag: W/"1"
```

---

## Quick Start

### Docker Compose (Recommended)

```bash
git clone https://github.com/your-org/SCIMServer.git
cd SCIMServer
docker compose up --build -d
```

The server starts at **http://localhost:8080** with PostgreSQL 17.

```bash
# Verify health
curl http://localhost:8080/health

# Create an endpoint
curl -X POST http://localhost:8080/scim/admin/endpoints \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-tenant", "profilePreset": "entra-id"}'

# Create a user on that endpoint
curl -X POST http://localhost:8080/scim/endpoints/{endpointId}/Users \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "jane.doe@example.com",
    "displayName": "Jane Doe",
    "active": true
  }'
```

### Local Development

```bash
cd api
npm ci
npx prisma generate
npx prisma migrate deploy     # requires PostgreSQL running on localhost:5432
npm run start:dev              # http://localhost:3000
```

### One-Click Azure Deployment

```powershell
irm https://raw.githubusercontent.com/your-org/SCIMServer/main/bootstrap.ps1 | iex
```

Or manually:

```powershell
.\deploy.ps1
```

---

## Deployment Options

| Method | Command | URL | Database |
|--------|---------|-----|----------|
| **Docker Compose** | `docker compose up --build -d` | http://localhost:8080 | PostgreSQL 17 (containerized) |
| **Local Dev** | `cd api && npm run start:dev` | http://localhost:3000 | PostgreSQL on localhost:5432 |
| **Azure Container Apps** | `.\deploy.ps1` or `irm .../bootstrap.ps1 \| iex` | https://{app}.azurecontainerapps.io | Azure Flexible Server |
| **Pre-built Image** | `docker pull ghcr.io/your-org/scimserver:latest` | http://localhost:8080 | Bring your own PG |

### Docker Compose Environment

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: scimdb
      POSTGRES_USER: scim
      POSTGRES_PASSWORD: scim
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scim -d scimdb"]

  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      PERSISTENCE_BACKEND: prisma
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
      SCIM_SHARED_SECRET: changeme-scim
      JWT_SECRET: changeme-jwt
      OAUTH_CLIENT_SECRET: changeme-oauth
    depends_on:
      postgres:
        condition: service_healthy
```

---

## SCIM 2.0 Compliance

Full compliance with RFC 7643 (Core Schema) and RFC 7644 (Protocol).

| RFC Feature | Section | Status | Notes |
|------------|---------|--------|-------|
| **User CRUD** | 7644 S3.1-3.6 | Full | POST/GET/PUT/PATCH/DELETE |
| **Group CRUD** | 7644 S3.1-3.6 | Full | Including member management |
| **Custom Resource Types** | 7643 S6 | Full | Register via endpoint profile |
| **PATCH Operations** | 7644 S3.5.2 | Full | add/replace/remove, multi-op, valuePath, dot-notation |
| **Bulk Operations** | 7644 S3.7 | Full | POST/PUT/PATCH/DELETE, bulkId cross-ref, failOnErrors |
| **Filtering** | 7644 S3.4.2.2 | Full | eq/ne/co/sw/ew/gt/ge/lt/le/pr, AND/OR/NOT, valuePath |
| **Sorting** | 7644 S3.4.2.3 | Full | sortBy/sortOrder on any attribute |
| **Pagination** | 7644 S3.4.2.4 | Full | startIndex (1-based), count, totalResults |
| **Attribute Projection** | 7644 S3.4.2.5 | Full | attributes, excludedAttributes query params |
| **POST .search** | 7644 S3.4.3 | Full | Server-side search via POST body |
| **Discovery** | 7644 S4 | Full | /Schemas, /ResourceTypes, /ServiceProviderConfig |
| **ETag / Conditional** | 7644 S3.14 | Full | If-Match, If-None-Match, W/ weak ETags |
| **/Me Endpoint** | 7644 S3.11 | Full | OAuth JWT sub claim resolution |
| **Content-Type** | 7644 S3.1 | Full | application/scim+json + application/json |
| **Error Format** | 7644 S3.12 | Full | SCIM error schema, scimType, detail, diagnostics |
| **Schema Validation** | 7643 S2 | Full | Required, type, mutability, uniqueness, returned, canonical |
| **Case Insensitivity** | 7643 S2.1 | Full | Attribute names, URNs, filter values (CITEXT) |
| **Multi-Valued Attrs** | 7643 S2.4 | Full | Primary enforcement (normalize/reject/passthrough) |

---

## Authentication

SCIMServer implements a 3-tier authentication chain. Each request is evaluated against all tiers in order until one succeeds.

```mermaid
flowchart TD
    A[Incoming Request] --> B{Public route?}
    B -->|Yes| Z[Allow]
    B -->|No| C{URL has /endpoints/uuid/?}
    C -->|Yes| D{PerEndpointCredentialsEnabled?}
    D -->|Yes| E[Compare Bearer token<br>against bcrypt hashes]
    E -->|Match| Z
    E -->|No match| F
    D -->|No| F
    C -->|No| F
    F{Token != shared secret?} -->|Yes| G[Validate as OAuth JWT]
    G -->|Valid| Z
    G -->|Invalid| H
    F -->|No| H
    H{Token == SCIM_SHARED_SECRET?} -->|Yes| Z
    H -->|No| I[401 Unauthorized<br>WWW-Authenticate: Bearer]
```

### Tier 1 - Per-Endpoint Credentials (Scoped)

```bash
# Create a credential for an endpoint
curl -X POST http://localhost:8080/scim/admin/endpoints/{id}/credentials \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"label": "entra-prod", "credentialType": "bearer"}'

# Response includes one-time plaintext token
# {"id":"...","token":"scim_ep_a1b2c3...","credentialType":"bearer",...}

# Use the scoped token for SCIM operations
curl http://localhost:8080/scim/endpoints/{id}/Users \
  -H "Authorization: Bearer scim_ep_a1b2c3..."
```

- Tokens are bcrypt-hashed at rest (plaintext returned only at creation)
- Requires `PerEndpointCredentialsEnabled: true` in endpoint settings
- Supports optional `expiresAt` for time-limited tokens

### Tier 2 - OAuth 2.0 Client Credentials

```bash
# Get an access token
curl -X POST http://localhost:8080/scim/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "scimserver-client",
    "client_secret": "changeme-oauth",
    "scope": "scim.read scim.write"
  }'

# Response
# {"access_token":"eyJhbGci...","token_type":"bearer","expires_in":3600,"scope":"scim.read scim.write"}

# Use the JWT
curl http://localhost:8080/scim/endpoints/{id}/Users \
  -H "Authorization: Bearer eyJhbGci..."
```

- JWT signed with `JWT_SECRET`, 1-hour expiry
- Scopes: `scim.read`, `scim.write`, `scim.manage`
- Required for `/Me` endpoint (resolves `sub` claim to userName)

### Tier 3 - Global Bearer Secret

```bash
curl http://localhost:8080/scim/endpoints/{id}/Users \
  -H "Authorization: Bearer changeme-scim"
```

- Set via `SCIM_SHARED_SECRET` env var
- Required in production (`NODE_ENV=production`), auto-generated in dev

### Public Routes (No Auth)

These routes require no authentication per RFC 7644 S4:

| Route | Purpose |
|-------|---------|
| `GET /health` | Health check |
| `GET /scim/Schemas` | Global schema discovery |
| `GET /scim/ResourceTypes` | Global resource type discovery |
| `GET /scim/ServiceProviderConfig` | Service provider config |
| `GET /scim/endpoints/{id}/Schemas` | Endpoint-scoped schema discovery |
| `GET /scim/endpoints/{id}/ResourceTypes` | Endpoint-scoped resource types |
| `GET /scim/endpoints/{id}/ServiceProviderConfig` | Endpoint-scoped SPC |
| `POST /scim/oauth/token` | OAuth token exchange |

---

## Multi-Tenant Endpoints

Every SCIM operation is scoped to an **endpoint** - an isolated tenant with its own users, groups, schema, config flags, credentials, and log stream.

```mermaid
flowchart LR
    subgraph Endpoint A: entra-prod
        UA[Users A]
        GA[Groups A]
        SA[Schema A]
        CA[Credentials A]
    end
    subgraph Endpoint B: entra-staging
        UB[Users B]
        GB[Groups B]
        SB[Schema B]
        CB[Credentials B]
    end
    subgraph Endpoint C: okta-test
        UC[Users C]
        GC[Groups C]
        SC[Schema C]
        CC[Credentials C]
    end
    Client1[Entra ID Prod] -->|SCIM| UA
    Client2[Entra ID Staging] -->|SCIM| UB
    Client3[Okta] -->|SCIM| UC
```

### Endpoint Lifecycle

```bash
# 1. Create endpoint with a preset
curl -X POST http://localhost:8080/scim/admin/endpoints \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-tenant",
    "displayName": "My Tenant",
    "description": "Production Entra ID provisioning target",
    "profilePreset": "entra-id"
  }'

# Response (201 Created)
{
  "id": "a1b2c3d4-...",
  "name": "my-tenant",
  "displayName": "My Tenant",
  "description": "Production Entra ID provisioning target",
  "active": true,
  "scimBasePath": "/scim/endpoints/a1b2c3d4-.../",
  "profile": { ... },
  "createdAt": "2026-04-24T10:00:00.000Z",
  "updatedAt": "2026-04-24T10:00:00.000Z"
}
```

```bash
# 2. List endpoints
curl http://localhost:8080/scim/admin/endpoints?view=summary \
  -H "Authorization: Bearer changeme-scim"

# 3. Update endpoint settings
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"profile": {"settings": {"RequireIfMatch": true}}}'

# 4. Deactivate endpoint (blocks SCIM operations, returns 403)
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"active": false}'

# 5. Get endpoint stats
curl http://localhost:8080/scim/admin/endpoints/{id}/stats \
  -H "Authorization: Bearer changeme-scim"

# Response
# {"users": 150, "groups": 12, "groupMembers": 340, "requestLogs": 4200}

# 6. Delete endpoint (cascades all resources, logs, credentials)
curl -X DELETE http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim"
```

---

## Endpoint Profiles & Presets

Each endpoint has a **profile** defining its SCIM schema, resource types, service provider capabilities, and behavioral settings. Profiles can be created from built-in presets or defined inline with shorthand syntax.

### Built-In Presets

| Preset | Default | Groups | Enterprise User | Extensions | Bulk | Sort | Description |
|--------|---------|--------|----------------|------------|------|------|-------------|
| `entra-id` | **Yes** | Yes | Yes | 4 Microsoft test extensions | No | No | Full Entra ID provisioning |
| `entra-id-minimal` | No | Yes | Yes | 4 Microsoft test extensions | No | No | Core identity fields only |
| `rfc-standard` | No | Yes | Yes | None | Yes (1000 ops) | Yes | Full RFC 7643/7644 compliance |
| `minimal` | No | Yes | No | None | No | No | Bare minimum for testing |
| `user-only` | No | No | Yes | None | No | Yes | User provisioning only |
| `user-only-with-custom-ext` | No | No | Yes | Custom extension (writeOnly attrs) | No | Yes | Custom extension demo |

### Discover Presets

```bash
# List all presets
curl http://localhost:8080/scim/admin/endpoints/presets \
  -H "Authorization: Bearer changeme-scim"

# Get preset details
curl http://localhost:8080/scim/admin/endpoints/presets/entra-id \
  -H "Authorization: Bearer changeme-scim"
```

### Profile Anatomy

A profile has 4 sections:

```json
{
  "schemas": [
    {
      "id": "urn:ietf:params:scim:schemas:core:2.0:User",
      "name": "User",
      "attributes": "all"
    }
  ],
  "resourceTypes": [
    {
      "id": "User",
      "name": "User",
      "endpoint": "/Users",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
      "schemaExtensions": [
        {
          "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
          "required": false
        }
      ]
    }
  ],
  "serviceProviderConfig": {
    "patch": { "supported": true },
    "bulk": { "supported": false },
    "filter": { "supported": true, "maxResults": 200 },
    "sort": { "supported": false },
    "etag": { "supported": true },
    "changePassword": { "supported": false }
  },
  "settings": {
    "StrictSchemaValidation": true,
    "AllowAndCoerceBooleanStrings": true,
    "PrimaryEnforcement": "normalize"
  }
}
```

### Auto-Expand Engine

When `"attributes": "all"` is used, the engine expands it to the full RFC 7643 attribute list for that schema. For known RFC schemas, partial attribute definitions are merged with the RFC baseline - your overrides win, missing fields are filled from the standard.

### Tighten-Only Validation

Attribute characteristic overrides are validated to only move in the "tighter" direction versus RFC baselines:

| Characteristic | Allowed Direction |
|----------------|-------------------|
| `required` | `false` - `true` only |
| `mutability` | readWrite - immutable - readOnly only |
| `uniqueness` | none - server - global only |
| `caseExact` | `false` - `true` only |
| `type` | Cannot be changed |
| `multiValued` | Cannot be changed |

---

## Configuration Flags

Each endpoint has behavioral settings configured via `profile.settings`:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `StrictSchemaValidation` | boolean | `true` | Require extension URNs in request `schemas[]` array |
| `AllowAndCoerceBooleanStrings` | boolean | `true` | Coerce `"True"`/`"False"` strings to booleans (Entra ID compat) |
| `UserSoftDeleteEnabled` | boolean | `true` | PATCH `{active:false}` deactivates instead of deleting |
| `UserHardDeleteEnabled` | boolean | `true` | DELETE permanently removes user |
| `GroupHardDeleteEnabled` | boolean | `true` | DELETE permanently removes group |
| `MultiMemberPatchOpForGroupEnabled` | boolean | `true` | Multi-member add/remove in single PATCH op |
| `PatchOpAllowRemoveAllMembers` | boolean | `false` | Allow `remove` with `path=members` (removes all) |
| `VerbosePatchSupported` | boolean | `false` | Enable dot-notation PATCH paths (e.g., `name.givenName`) |
| `SchemaDiscoveryEnabled` | boolean | `true` | Endpoint-scoped discovery endpoints respond (vs 404) |
| `RequireIfMatch` | boolean | `false` | Mandate ETag `If-Match` on PUT/PATCH/DELETE |
| `PerEndpointCredentialsEnabled` | boolean | `false` | Enable per-endpoint bcrypt bearer tokens |
| `IncludeWarningAboutIgnoredReadOnlyAttribute` | boolean | `false` | Emit warning when stripping readOnly attributes |
| `IgnoreReadOnlyAttributesInPatch` | boolean | `false` | Strip readOnly PATCH ops silently instead of 400 |
| `PrimaryEnforcement` | string | `passthrough` | Primary sub-attribute handling: `normalize`, `reject`, or `passthrough` |
| `logLevel` | string | (global) | Per-endpoint log level override: TRACE/DEBUG/INFO/WARN/ERROR/FATAL |
| `logFileEnabled` | boolean | `true` | Per-endpoint log file under `logs/endpoints/` |

### Update Flags at Runtime

```bash
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {
      "settings": {
        "RequireIfMatch": true,
        "VerbosePatchSupported": true,
        "PrimaryEnforcement": "reject"
      }
    }
  }'
```

---

## API Reference (Summary)

**83 routes** across 19 controllers. Full reference with request/response examples: [docs/COMPLETE_API_REFERENCE.md](docs/COMPLETE_API_REFERENCE.md)

### Health & Version

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | Public | Health check |
| GET | `/scim/admin/version` | Bearer | Server version, runtime info, deployment metadata |

### Admin - Endpoint Management (9 routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scim/admin/endpoints` | Create endpoint |
| GET | `/scim/admin/endpoints` | List endpoints (`?active=true&view=summary`) |
| GET | `/scim/admin/endpoints/:id` | Get endpoint by ID |
| GET | `/scim/admin/endpoints/by-name/:name` | Get endpoint by name |
| PATCH | `/scim/admin/endpoints/:id` | Update endpoint |
| DELETE | `/scim/admin/endpoints/:id` | Delete endpoint (cascade) |
| GET | `/scim/admin/endpoints/:id/stats` | Endpoint resource statistics |
| GET | `/scim/admin/endpoints/presets` | List available presets |
| GET | `/scim/admin/endpoints/presets/:name` | Get preset details |

### Admin - Credentials (3 routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scim/admin/endpoints/:id/credentials` | Create per-endpoint credential |
| GET | `/scim/admin/endpoints/:id/credentials` | List credentials |
| DELETE | `/scim/admin/endpoints/:id/credentials/:credId` | Revoke credential |

### Admin - Logs & Observability (21 routes)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scim/admin/logs` | Paginated audit trail |
| GET | `/scim/admin/logs/:id` | Single log entry |
| POST | `/scim/admin/logs/clear` | Clear all logs |
| POST | `/scim/admin/logs/prune` | Prune old logs |
| GET | `/scim/admin/log-config` | Get log configuration |
| PUT | `/scim/admin/log-config` | Update log configuration |
| PUT | `/scim/admin/log-config/level/:level` | Set global log level |
| PUT | `/scim/admin/log-config/category/:cat/:level` | Set category log level |
| PUT | `/scim/admin/log-config/endpoint/:id/:level` | Set endpoint log level |
| DELETE | `/scim/admin/log-config/endpoint/:id` | Reset endpoint log level |
| GET | `/scim/admin/log-config/recent` | Query ring buffer |
| GET | `/scim/admin/log-config/audit` | Audit log entries |
| DELETE | `/scim/admin/log-config/recent` | Clear ring buffer |
| GET | `/scim/admin/log-config/stream` | SSE live log stream |
| GET | `/scim/admin/log-config/download` | Download logs (NDJSON/JSON) |
| GET | `/scim/admin/log-config/prune` | Auto-prune config |
| PUT | `/scim/admin/log-config/prune` | Update auto-prune config |
| GET | `/scim/endpoints/:id/logs/recent` | Endpoint-scoped ring buffer |
| GET | `/scim/endpoints/:id/logs/stream` | Endpoint-scoped SSE stream |
| GET | `/scim/endpoints/:id/logs/download` | Endpoint-scoped log download |
| GET | `/scim/endpoints/:id/logs/history` | Endpoint-scoped persistent log history |

### Admin - Other (7 routes)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scim/admin/database/users` | Database user browser |
| GET | `/scim/admin/database/groups` | Database group browser |
| GET | `/scim/admin/database/users/:id` | User detail |
| GET | `/scim/admin/database/groups/:id` | Group detail |
| GET | `/scim/admin/database/statistics` | Database statistics |
| GET | `/scim/admin/activity` | Activity feed |
| GET | `/scim/admin/activity/summary` | Activity summary |

### Admin - Manual Provisioning (3 routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scim/admin/users/manual` | Create user via simplified form |
| POST | `/scim/admin/groups/manual` | Create group via simplified form |
| POST | `/scim/admin/users/:id/delete` | Delete user via admin API |

### SCIM Discovery (8 routes)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/scim/Schemas` | Public | Global schemas (RFC 7644 S4) |
| GET | `/scim/Schemas/:uri` | Public | Schema by URN |
| GET | `/scim/ResourceTypes` | Public | Global resource types |
| GET | `/scim/ResourceTypes/:id` | Public | Resource type by ID |
| GET | `/scim/ServiceProviderConfig` | Public | Global SPC |
| GET | `/scim/endpoints/:id/Schemas` | Public | Endpoint-scoped schemas |
| GET | `/scim/endpoints/:id/ResourceTypes` | Public | Endpoint-scoped resource types |
| GET | `/scim/endpoints/:id/ServiceProviderConfig` | Public | Endpoint-scoped SPC |

### SCIM Users (7 routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scim/endpoints/:id/Users` | Create user |
| GET | `/scim/endpoints/:id/Users` | List/filter users |
| GET | `/scim/endpoints/:id/Users/:uid` | Get user |
| PUT | `/scim/endpoints/:id/Users/:uid` | Replace user |
| PATCH | `/scim/endpoints/:id/Users/:uid` | Modify user |
| DELETE | `/scim/endpoints/:id/Users/:uid` | Delete user |
| POST | `/scim/endpoints/:id/Users/.search` | Search users (POST) |

### SCIM Groups (7 routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scim/endpoints/:id/Groups` | Create group |
| GET | `/scim/endpoints/:id/Groups` | List/filter groups |
| GET | `/scim/endpoints/:id/Groups/:gid` | Get group |
| PUT | `/scim/endpoints/:id/Groups/:gid` | Replace group |
| PATCH | `/scim/endpoints/:id/Groups/:gid` | Modify group |
| DELETE | `/scim/endpoints/:id/Groups/:gid` | Delete group |
| POST | `/scim/endpoints/:id/Groups/.search` | Search groups (POST) |

### SCIM Bulk (1 route)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scim/endpoints/:id/Bulk` | Bulk operations (RFC 7644 S3.7) |

### /Me Endpoint (4 routes)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/scim/endpoints/:id/Me` | OAuth | Get current user |
| PUT | `/scim/endpoints/:id/Me` | OAuth | Replace current user |
| PATCH | `/scim/endpoints/:id/Me` | OAuth | Modify current user |
| DELETE | `/scim/endpoints/:id/Me` | OAuth | Delete current user |

### Custom Resource Types (7 routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scim/endpoints/:id/:resourceType` | Create custom resource |
| GET | `/scim/endpoints/:id/:resourceType` | List custom resources |
| GET | `/scim/endpoints/:id/:resourceType/:rid` | Get custom resource |
| PUT | `/scim/endpoints/:id/:resourceType/:rid` | Replace custom resource |
| PATCH | `/scim/endpoints/:id/:resourceType/:rid` | Modify custom resource |
| DELETE | `/scim/endpoints/:id/:resourceType/:rid` | Delete custom resource |
| POST | `/scim/endpoints/:id/:resourceType/.search` | Search custom resources |

### OAuth (2 routes)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/scim/oauth/token` | Public | Exchange credentials for JWT |
| GET | `/scim/oauth/test` | Public | OAuth service health |

---

## API Examples

### Create User

```http
POST /scim/endpoints/{endpointId}/Users HTTP/1.1
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

```http
HTTP/1.1 201 Created
Content-Type: application/scim+json; charset=utf-8
Location: http://localhost:8080/scim/v2/endpoints/{endpointId}/Users/f47ac10b-...
ETag: W/"1"
X-Request-Id: 550e8400-...

{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
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
  "externalId": null,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering",
    "costCenter": "CC-1234"
  },
  "meta": {
    "resourceType": "User",
    "created": "2026-04-24T10:00:00.000Z",
    "lastModified": "2026-04-24T10:00:00.000Z",
    "location": "http://localhost:8080/scim/v2/endpoints/{endpointId}/Users/f47ac10b-...",
    "version": "W/\"1\""
  }
}
```

### PATCH User

```http
PATCH /scim/endpoints/{endpointId}/Users/{userId} HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json
If-Match: W/"1"

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "displayName",
      "value": "Jane D. Smith"
    },
    {
      "op": "add",
      "path": "emails[type eq \"home\"].value",
      "value": "jane.home@example.com"
    },
    {
      "op": "replace",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
      "value": "Product"
    },
    {
      "op": "remove",
      "path": "phoneNumbers[type eq \"fax\"]"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User", "..."],
  "id": "f47ac10b-...",
  "userName": "jane.doe@example.com",
  "displayName": "Jane D. Smith",
  "meta": {
    "resourceType": "User",
    "version": "W/\"2\"",
    "lastModified": "2026-04-24T10:05:00.000Z",
    "location": "..."
  }
}
```

### Create Group with Members

```http
POST /scim/endpoints/{endpointId}/Groups HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    { "value": "f47ac10b-..." },
    { "value": "a83bc20e-..." }
  ]
}
```

### List Users with Filter

```http
GET /scim/endpoints/{endpointId}/Users?filter=userName%20sw%20%22jane%22&startIndex=1&count=10&sortBy=userName&sortOrder=ascending&attributes=userName,displayName,emails HTTP/1.1
Host: localhost:8080
Authorization: Bearer changeme-scim
```

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
      "displayName": "Jane D. Smith",
      "emails": [
        { "value": "jane.doe@example.com", "type": "work", "primary": true }
      ],
      "meta": {
        "resourceType": "User",
        "created": "2026-04-24T10:00:00.000Z",
        "lastModified": "2026-04-24T10:05:00.000Z",
        "location": "...",
        "version": "W/\"2\""
      }
    }
  ]
}
```

### SCIM Error Response

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "User with userName 'jane.doe@example.com' already exists",
  "urn:scimserver:api:messages:2.0:Diagnostics": {
    "requestId": "550e8400-...",
    "endpointId": "a1b2c3d4-...",
    "logsUrl": "/scim/endpoints/a1b2c3d4-.../logs/recent?requestId=550e8400-...",
    "conflictingResourceId": "f47ac10b-...",
    "conflictingAttribute": "userName",
    "incomingValue": "jane.doe@example.com"
  }
}
```

---

## SCIM Filter Support

Full RFC 7644 S3.4.2.2 filter grammar with database push-down optimization.

### Supported Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `eq` | `userName eq "jane"` | Equal (case-insensitive for strings) |
| `ne` | `active ne true` | Not equal |
| `co` | `displayName co "Smith"` | Contains |
| `sw` | `userName sw "jane"` | Starts with |
| `ew` | `emails.value ew "@example.com"` | Ends with |
| `gt` | `meta.lastModified gt "2026-01-01"` | Greater than |
| `ge` | `meta.created ge "2026-01-01"` | Greater than or equal |
| `lt` | `meta.lastModified lt "2026-12-31"` | Less than |
| `le` | `meta.created le "2026-12-31"` | Less than or equal |
| `pr` | `externalId pr` | Present (not null/empty) |

### Logical Operators

```
filter=userName sw "jane" and active eq true
filter=displayName co "Smith" or displayName co "Jones"
filter=not (active eq false)
```

### Value Path Filters

```
filter=emails[type eq "work"].value co "@example.com"
```

---

## Attribute Projection

RFC 7644 S3.4.2.5 - control which attributes appear in responses.

### Query Parameters

| Parameter | Effect |
|-----------|--------|
| `attributes=userName,emails` | Return ONLY these attributes (plus always-returned: `schemas`, `id`, `meta`) |
| `excludedAttributes=phoneNumbers,addresses` | Return all DEFAULT attributes EXCEPT these |

### RFC 7643 S2.4 - `returned` Characteristic

| Value | Behavior |
|-------|----------|
| `always` | Always included (schemas, id, meta, userName for Users, displayName for Groups) |
| `default` | Included by default, removable via `excludedAttributes` |
| `request` | Only included when explicitly listed in `attributes` |
| `never` | Never returned in any response (e.g., password) |

---

## Bulk Operations

RFC 7644 S3.7 - process multiple operations in a single request.

```http
POST /scim/endpoints/{endpointId}/Bulk HTTP/1.1
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
        "userName": "bulk.user@example.com",
        "displayName": "Bulk User"
      }
    },
    {
      "method": "POST",
      "path": "/Groups",
      "bulkId": "group1",
      "data": {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "displayName": "Bulk Group",
        "members": [{ "value": "bulkId:user1" }]
      }
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"],
  "Operations": [
    {
      "method": "POST",
      "bulkId": "user1",
      "status": "201",
      "location": ".../Users/f47ac10b-...",
      "response": { "id": "f47ac10b-...", "userName": "bulk.user@example.com" }
    },
    {
      "method": "POST",
      "bulkId": "group1",
      "status": "201",
      "location": ".../Groups/b23cd40e-...",
      "response": { "id": "b23cd40e-...", "displayName": "Bulk Group" }
    }
  ]
}
```

**Limits:** Max 1,000 operations per request, 1 MB payload size. Requires `bulk.supported: true` in endpoint ServiceProviderConfig (enabled in `rfc-standard` preset).

---

## Observability & Logging

### Structured Logging Architecture

```mermaid
flowchart TB
    subgraph Sources
        R[Request Interceptor]
        S[Services]
        G[Guards]
    end
    subgraph ScimLogger
        RB[Ring Buffer<br>In-memory, 1000 entries]
        FW[File Writer<br>Rotating, per-endpoint]
        SSE[SSE Emitter<br>Live stream]
    end
    subgraph Persistence
        DB[(RequestLog Table)]
    end
    R --> RB
    R --> FW
    R --> SSE
    R --> DB
    S --> RB
    S --> FW
    S --> SSE
```

### Quick Reference

```bash
# Live log stream (SSE)
curl -N http://localhost:8080/scim/admin/log-config/stream \
  -H "Authorization: Bearer changeme-scim"

# Endpoint-scoped stream
curl -N http://localhost:8080/scim/endpoints/{id}/logs/stream \
  -H "Authorization: Bearer changeme-scim"

# Query ring buffer
curl "http://localhost:8080/scim/admin/log-config/recent?limit=50&level=ERROR" \
  -H "Authorization: Bearer changeme-scim"

# Download logs as NDJSON
curl http://localhost:8080/scim/admin/log-config/download?format=ndjson \
  -H "Authorization: Bearer changeme-scim" -o logs.ndjson

# Change global level at runtime
curl -X PUT http://localhost:8080/scim/admin/log-config/level/DEBUG \
  -H "Authorization: Bearer changeme-scim"

# Set endpoint-specific level
curl -X PUT http://localhost:8080/scim/admin/log-config/endpoint/{id}/TRACE \
  -H "Authorization: Bearer changeme-scim"

# Audit trail (persistent, paginated)
curl "http://localhost:8080/scim/admin/logs?page=1&pageSize=50&method=POST&status=201" \
  -H "Authorization: Bearer changeme-scim"
```

### Log Levels

`TRACE` < `DEBUG` < `INFO` < `WARN` < `ERROR` < `FATAL`

### Features

- **Ring buffer:** In-memory circular buffer (configurable size) for low-latency log queries
- **SSE live stream:** Real-time log events via Server-Sent Events, filterable by level/category/endpoint
- **Per-endpoint isolation:** Each endpoint gets its own log stream and optional log file
- **Rotating file writer:** Configurable max size and file count
- **Auto-prune:** Scheduled cleanup of old RequestLog entries (configurable retention days)
- **Request correlation:** Every request gets a `X-Request-Id` UUID, threaded through all log entries
- **Slow request detection:** Configurable threshold (`LOG_SLOW_REQUEST_MS`, default 2000ms)

---

## Web Admin UI

A React + Vite single-page application served at `/admin`:

| Screen | Description |
|--------|-------------|
| **Log Viewer** | Real-time log list with filters (method, status, search), detail panel with full request/response |
| **Database Browser** | Users and Groups tabs with pagination and search, Statistics tab |
| **Activity Feed** | Parsed provisioning activity timeline with severity and type filters |
| **Manual Provisioning** | Create users and groups via form UI |

Access at `http://localhost:8080/admin` (no separate build step needed - pre-built in Docker image).

---

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` (dev), `8080` (Docker) | HTTP listen port |
| `API_PREFIX` | `scim` | URL prefix for all routes |
| `PERSISTENCE_BACKEND` | `prisma` | Storage backend: `prisma` (PostgreSQL) or `inmemory` |
| `DATABASE_URL` | `postgresql://scim:scim@localhost:5432/scimdb` | PostgreSQL connection string |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `REQUEST_TIMEOUT_MS` | `120000` | Server request timeout in milliseconds |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `SCIM_SHARED_SECRET` | Auto-generated (dev) | Global bearer token. **Required** in production |
| `JWT_SECRET` | Auto-generated (dev) | JWT signing key. **Required** in production |
| `OAUTH_CLIENT_ID` | `scimserver-client` | OAuth client identifier |
| `OAUTH_CLIENT_SECRET` | Auto-generated (dev) | OAuth client secret. **Required** in production |
| `OAUTH_CLIENT_SCOPES` | `scim.read,scim.write,scim.manage` | Comma-separated allowed scopes |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` (prod) | Global log level: TRACE/DEBUG/INFO/WARN/ERROR/FATAL |
| `LOG_FORMAT` | `json` (prod) / `pretty` (dev) | Log output format |
| `LOG_INCLUDE_PAYLOADS` | `false` (prod) / `true` (dev) | Include request/response bodies in logs |
| `LOG_INCLUDE_STACKS` | `true` | Include stack traces in error logs |
| `LOG_MAX_PAYLOAD_SIZE` | `8192` | Max payload size in log entries (bytes) |
| `LOG_SLOW_REQUEST_MS` | `2000` | Slow request threshold (ms) |
| `LOG_CATEGORY_LEVELS` | (none) | Per-category level overrides |
| `LOG_RETENTION_DAYS` | `30` | Auto-prune retention period |
| `LOG_FILE` | (disabled) | Path to write log file |
| `LOG_FILE_MAX_SIZE` | `10485760` | Max log file size before rotation (10 MB) |
| `LOG_FILE_MAX_COUNT` | `3` | Max number of rotated log files |

### Build Metadata

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_VERSION` | from package.json | Application version |
| `GIT_COMMIT` | (none) | Git commit SHA |
| `BUILD_TIME` | (none) | Build timestamp |
| `TZ` | `UTC` | IANA timezone |

### Azure Deployment

| Variable | Default | Description |
|----------|---------|-------------|
| `SCIM_RG` | (none) | Azure resource group |
| `SCIM_APP` | (none) | Azure Container App name |
| `SCIM_REGISTRY` | (none) | Azure Container Registry name |
| `CONTAINER_APP_NAME` | (none) | Container App environment variable |

---

## Testing

### Test Pyramid

```
                    +-------------------+
                    |   112 ISV Tests   |  Lexmark SCIM Validator
                    +-------------------+
                 +-------------------------+
                 |   ~789 Live Tests       |  PowerShell, real HTTP
                 +-------------------------+
              +-------------------------------+
              |   1,074 E2E Tests (51 suites) |  Supertest, in-process
              +-------------------------------+
           +-------------------------------------+
           |   3,378 Unit Tests (84 suites)      |  Jest, mocked deps
           +-------------------------------------+
```

### Run Tests

```bash
cd api

# Unit tests
npx jest --no-coverage

# E2E tests
npx jest --config test/e2e/jest-e2e.config.ts --no-coverage --forceExit

# Live tests (local dev server must be running on port 6000)
cd ../scripts
pwsh ./live-test.ps1

# Live tests against Docker
pwsh ./live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "changeme-oauth"

# Live tests against Azure
pwsh ./live-test.ps1 -BaseUrl https://myapp.azurecontainerapps.io -ClientSecret "your-secret"

# Lexmark ISV validator
pwsh ./lexmark-live-test.ps1

# Full validation pipeline (unit + E2E + lint)
pwsh ./full-validation-pipeline.ps1
```

### Coverage Thresholds

| Metric | Threshold |
|--------|-----------|
| Branches | 75% |
| Functions | 90% |
| Lines | 80% |
| Statements | 80% |

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Runtime** | Node.js | 24 |
| **Framework** | NestJS | 11.1 |
| **Language** | TypeScript | 5.9 |
| **ORM** | Prisma | 7.4 |
| **Database** | PostgreSQL | 17 |
| **Extensions** | citext, pgcrypto, pg_trgm | - |
| **Testing** | Jest | 30.2 |
| **E2E Testing** | Supertest | 7.2 |
| **Frontend** | React + Vite | 19 / 7 |
| **Auth** | Passport JWT, bcrypt | - |
| **Linting** | ESLint 10, Prettier 3.8 | - |
| **Container** | Docker (node:24-alpine) | - |
| **Infrastructure** | Azure Bicep | - |

---

## Project Structure

```
SCIMServer/
+-- api/                          # NestJS backend
|   +-- src/
|   |   +-- main.ts               # Application bootstrap
|   |   +-- modules/
|   |   |   +-- app/              # Root module
|   |   |   +-- auth/             # SharedSecretGuard (3-tier auth)
|   |   |   +-- scim/             # SCIM protocol implementation
|   |   |   |   +-- controllers/  # 12 controllers (admin, SCIM, discovery)
|   |   |   |   +-- services/     # Users, Groups, Generic, Bulk services
|   |   |   |   +-- discovery/    # Schema registry, discovery service
|   |   |   |   +-- endpoint-profile/  # Profile engine (presets, expand, validate)
|   |   |   |   +-- filters/      # SCIM filter parser, exception filters
|   |   |   |   +-- interceptors/ # Content-Type, ETag interceptors
|   |   |   |   +-- middleware/   # Content-Type validation
|   |   |   |   +-- dto/          # Request/response DTOs
|   |   |   |   +-- utils/        # Attribute projection, sort, errors
|   |   |   +-- endpoint/         # Endpoint CRUD & config management
|   |   |   +-- database/         # Database browser controller
|   |   |   +-- logging/          # Structured logging engine
|   |   |   +-- health/           # Health check
|   |   |   +-- prisma/           # Prisma service
|   |   |   +-- web/              # Web UI serving
|   |   +-- domain/
|   |   |   +-- patch/            # Pure PATCH engines (User, Group, Generic)
|   |   |   +-- validation/       # Schema validator (10 validation types)
|   |   |   +-- models/           # Domain models
|   |   |   +-- repositories/     # Repository interfaces
|   |   |   +-- errors/           # Domain errors
|   |   +-- infrastructure/
|   |   |   +-- repositories/
|   |   |       +-- prisma/       # PostgreSQL repositories
|   |   |       +-- inmemory/     # In-memory repositories
|   |   +-- oauth/                # OAuth 2.0 token service
|   +-- prisma/
|   |   +-- schema.prisma         # Database schema (5 models)
|   |   +-- migrations/           # 10 migrations
|   +-- test/
|       +-- e2e/                  # 51 E2E spec files + helpers
+-- web/                          # React + Vite frontend
|   +-- src/
|   |   +-- components/           # Log viewer, DB browser, activity feed
|   +-- e2e/                      # Playwright E2E tests
+-- scripts/                      # DevOps tooling
|   +-- live-test.ps1             # ~8,700 lines, ~789 live tests
|   +-- lexmark-live-test.ps1     # ISV validator tests
|   +-- deploy-azure.ps1          # Azure deployment script
|   +-- full-validation-pipeline.ps1
+-- infra/                        # Azure Bicep templates
+-- docs/                         # 69+ documentation files
+-- Dockerfile                    # 4-stage production build
+-- docker-compose.yml            # PostgreSQL + API
+-- deploy.ps1                    # One-click Azure deployment
+-- setup.ps1                     # Non-interactive Azure setup
+-- bootstrap.ps1                 # Cache-busting bootstrap loader
```

---

## Documentation Index

Full documentation: [docs/INDEX.md](docs/INDEX.md)

### Key Documents

| Document | Description |
|----------|-------------|
| [COMPLETE_API_REFERENCE.md](docs/COMPLETE_API_REFERENCE.md) | All 83 endpoints, full request/response examples |
| [ENDPOINT_LIFECYCLE_AND_USAGE.md](docs/ENDPOINT_LIFECYCLE_AND_USAGE.md) | Quick start - endpoint lifecycle recipes |
| [ENDPOINT_PROFILE_ARCHITECTURE.md](docs/ENDPOINT_PROFILE_ARCHITECTURE.md) | Profile system - presets, expansion, validation |
| [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | All 16 configuration flags |
| [SCHEMA_CUSTOMIZATION_GUIDE.md](docs/SCHEMA_CUSTOMIZATION_GUIDE.md) | Custom schemas and extensions guide |
| [LOGGING_AND_OBSERVABILITY.md](docs/LOGGING_AND_OBSERVABILITY.md) | Structured logging deep dive |
| [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) | Azure Container Apps deployment |
| [DOCKER_GUIDE_AND_TEST_REPORT.md](docs/DOCKER_GUIDE_AND_TEST_REPORT.md) | Docker build, run, and test guide |
| [SCIM_COMPLIANCE.md](docs/SCIM_COMPLIANCE.md) | RFC compliance matrix |
| [G11_PER_ENDPOINT_CREDENTIALS.md](docs/G11_PER_ENDPOINT_CREDENTIALS.md) | Per-endpoint authentication |
| [TECHNICAL_DESIGN_DOCUMENT.md](docs/TECHNICAL_DESIGN_DOCUMENT.md) | Architecture deep dive |

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run the full test suite: `cd api && npx jest && npx jest --config test/e2e/jest-e2e.config.ts --forceExit`
4. Follow existing patterns and coding conventions
5. Submit a pull request

### Commit Conventions

- Always use `git add -A; git commit -m "<descriptive message>"`
- Never use `git commit --amend` unless explicitly requested
- Never rewrite history on pushed commits

---

## License

MIT
