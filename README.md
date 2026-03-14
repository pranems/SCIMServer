# SCIMServer

Production-ready, multi-tenant SCIM 2.0 server purpose-built for Microsoft Entra ID provisioning — with a built-in observability UI, 100% RFC compliance, and three deployment options.

| | |
|---|---|
| **Version** | `0.28.0` |
| **Protocol** | SCIM 2.0 ([RFC 7643](https://datatracker.ietf.org/doc/html/rfc7643) / [RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644)) |
| **Target IdP** | [Microsoft Entra ID](https://entra.microsoft.com/) |
| **Runtime** | Node.js 24 &middot; NestJS 11 &middot; TypeScript 5.9 |
| **Persistence** | PostgreSQL 17 (Prisma 7) **or** in-memory |
| **Registry** | `ghcr.io/pranems/scimserver` (public, anonymous pull) |
| **License** | MIT |

---

## Table of Contents

- [Why SCIMServer](#why-scimserver)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [SCIM Compliance](#scim-compliance)
- [Authentication](#authentication)
- [Per-Endpoint Configuration](#per-endpoint-configuration)
- [Configuration Reference](#configuration-reference)
- [Microsoft Entra ID Setup](#microsoft-entra-id-setup)
- [Operations & Observability](#operations--observability)
- [Testing](#testing)
- [Repository Structure](#repository-structure)
- [Documentation Index](#documentation-index)
- [Technology Stack](#technology-stack)
- [CI/CD](#cicd)
- [Prerequisites](#prerequisites)
- [Contributing](#contributing)
- [License](#license)

---

## Why SCIMServer

| Capability | Detail |
|---|---|
| **Full SCIM surface** | Users, Groups, custom resource types, Schemas, ResourceTypes, ServiceProviderConfig, Bulk, /Me |
| **Entra-validated** | 25/25 Microsoft SCIM Validator tests + 7 preview pass with 0 false positives |
| **Multi-tenant isolation** | Each endpoint has its own resources, schemas, config flags, and optional dedicated credentials |
| **Endpoint profiles** | 5 built-in presets (`entra-id`, `entra-id-minimal`, `rfc-standard`, `minimal`, `user-only`) with tighten-only validation |
| **Schema-driven validation** | RFC 7643 §2 attribute characteristics enforcement — type, required, mutability, returned, uniqueness, caseExact, canonicalValues |
| **Built-in observability UI** | Real-time activity feed, searchable log viewer, endpoint management, runtime status dashboard |
| **3-tier auth** | Per-endpoint bcrypt credential → OAuth 2.0 JWT → global shared secret fallback chain |
| **Cloud-ready** | Azure Container Apps with scale-to-zero, Docker Compose, or local dev — all first-class |

---

## Quick Start

### Option A — Azure (recommended for production)

```powershell
iex (iwr https://raw.githubusercontent.com/pranems/SCIMServer/master/bootstrap.ps1).Content
```

Provisions all Azure resources, deploys the app, and prints the required secrets and URLs. Takes ~5 minutes.

### Option B — Docker Compose (self-hosted)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: scim
      POSTGRES_PASSWORD: scim
      POSTGRES_DB: scimdb
    volumes:
      - pgdata:/var/lib/postgresql/data

  scimserver:
    image: ghcr.io/pranems/scimserver:latest
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      SCIM_SHARED_SECRET: your-scim-secret
      JWT_SECRET: your-jwt-secret
      OAUTH_CLIENT_SECRET: your-oauth-secret
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
    depends_on:
      - postgres

volumes:
  pgdata:
```

```powershell
docker compose up -d
```

| Endpoint | URL |
|---|---|
| Web UI | `http://localhost:8080/` |
| SCIM base | `http://localhost:8080/scim/v2` |
| Health | `http://localhost:8080/health` |

### Option C — Local development

```powershell
git clone https://github.com/pranems/SCIMServer.git
cd SCIMServer

# API (terminal 1)
cd api
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev          # http://localhost:3000/scim

# Web UI (terminal 2)
cd web
npm install
npm run dev                # http://localhost:5173
```

### Option D — In-memory (no database required)

```powershell
cd api
npm install && npm run build
$env:PERSISTENCE_BACKEND = "inmemory"
$env:SCIM_SHARED_SECRET = "local-secret"
$env:JWT_SECRET = "local-jwt"
$env:OAUTH_CLIENT_SECRET = "local-oauth"
$env:PORT = "6000"
node dist/main.js          # http://localhost:6000/scim
```

All data lives in memory — ideal for demos, CI/CD pipelines, and integration testing.

---

## Architecture

```mermaid
flowchart TB
    subgraph Clients
        Entra[Microsoft Entra ID]
        Admin[Admin / API Consumer]
    end

    subgraph SCIMServer["SCIMServer (Node.js 24)"]
        Auth[3-Tier Auth Guard]
        SCIM[SCIM Controllers<br/>Users · Groups · Generic · Bulk · /Me]
        Discovery[Discovery<br/>Schemas · ResourceTypes · SPC]
        AdminAPI[Admin APIs<br/>Endpoints · Credentials · Logs · Profiles]
        UI[React SPA<br/>Activity · Logs · Status]
        Domain[Domain Layer<br/>SchemaValidator · PatchEngines · Helpers]
        Repo[Repository Layer<br/>Prisma + InMemory]
    end

    subgraph Storage
        PG[(PostgreSQL 17)]
        MEM[(In-Memory Maps)]
    end

    Entra -->|SCIM / HTTPS| Auth
    Admin -->|REST / Bearer| Auth
    Auth --> SCIM
    Auth --> AdminAPI
    SCIM --> Domain
    Domain --> Repo
    Repo -->|prisma| PG
    Repo -->|inmemory| MEM
    AdminAPI --> Repo
    UI -.->|static| SCIMServer
```

### Data Model (Prisma — 5 models)

| Model | Purpose |
|---|---|
| `Endpoint` | Tenant container — name, profile (JSONB: schemas, resourceTypes, SPC, settings), active flag |
| `ScimResource` | Polymorphic SCIM resource — `resourceType` discriminator (User / Group / custom), JSONB payload, CITEXT columns, version-based ETags |
| `ResourceMember` | Group membership join table with display and type |
| `RequestLog` | Per-request audit log (method, URL, status, headers, bodies, duration) |
| `EndpointCredential` | Per-endpoint bcrypt-hashed bearer tokens with optional expiry |

### Request Flow

```
Incoming HTTP
  → /scim/v2 → /scim rewrite middleware
  → Express JSON parser (5 MB, application/scim+json + application/json)
  → NestJS global prefix (/scim)
  → SharedSecretGuard (3-tier auth)
  → Controller (validation, projection params)
  → Service (business logic, schema validation, uniqueness, ETag)
  → Repository (Prisma SQL or InMemory Map)
  → Response (SCIM JSON + ETag header + application/scim+json)
```

---

## SCIM Compliance

**RFC 7643 / 7644 compliance: 100%**

| Feature | Status | RFC Reference |
|---|---|---|
| **CRUD** — POST, GET, PUT, PATCH, DELETE | ✅ | 7644 §3.2–§3.6 |
| **Filtering** — 10 operators + and/or/not + grouping | ✅ | 7644 §3.4.2.2 |
| **Pagination** — startIndex + count | ✅ | 7644 §3.4.2.4 |
| **Sorting** — sortBy + sortOrder | ✅ | 7644 §3.4.2.3 |
| **Attribute projection** — attributes / excludedAttributes | ✅ | 7644 §3.4.2.5, §3.9 |
| **POST /.search** — for Users, Groups, custom types | ✅ | 7644 §3.4.3 |
| **Bulk operations** — POST /Bulk with bulkId cross-referencing | ✅ | 7644 §3.7 |
| **/Me** — JWT sub → identity resolution | ✅ | 7644 §3.11 |
| **ETag & conditional requests** — W/"vN" + If-Match + If-None-Match | ✅ | 7644 §3.14 |
| **Discovery endpoints** — SPC, Schemas, ResourceTypes (public) | ✅ | 7643 §5–§7, 7644 §4 |
| **Schema validation** — type, required, mutability, returned, uniqueness, caseExact, canonicalValues | ✅ | 7643 §2 |
| **Attribute characteristics** — returned:always/default/request/never enforcement | ✅ | 7643 §2.4 |
| **ReadOnly stripping** — auto-strip on POST/PUT, silent strip or 400 on PATCH | ✅ | 7643 §2.2 |
| **Immutable enforcement** — reject value changes on PUT/PATCH | ✅ | 7643 §2.2 |
| **Custom resource types** — data-driven registration beyond User/Group | ✅ | 7643 §6 |
| **Enterprise User extension** — urn:ietf:params:scim:schemas:extension:enterprise:2.0:User | ✅ | 7643 §4.3 |
| **SCIM error format** — application/scim+json on all errors | ✅ | 7644 §3.12 |
| **Content-Type** — application/scim+json on all responses | ✅ | 7644 §3.1 |

---

## Authentication

SCIMServer uses a **3-tier authentication fallback chain**. Each incoming `Authorization: Bearer <token>` is evaluated in order:

| Tier | Method | Requirement | `req.authType` |
|---|---|---|---|
| 1 | Per-endpoint bcrypt credential | `PerEndpointCredentialsEnabled` flag + active credential via Admin API | `endpoint_credential` |
| 2 | OAuth 2.0 JWT | `JWT_SECRET` + `OAUTH_CLIENT_SECRET` env vars | `oauth` |
| 3 | Global shared secret | `SCIM_SHARED_SECRET` env var | `legacy` |

**Public routes** (discovery endpoints, `POST /oauth/token`, web UI) bypass all tiers via `@Public()` decorator.

### Per-Endpoint Credentials (optional)

```powershell
# Enable on an endpoint
Invoke-RestMethod -Method PATCH `
  -Uri "http://localhost:8080/scim/admin/endpoints/<id>" `
  -Headers @{ Authorization = "Bearer $secret" } `
  -ContentType "application/json" `
  -Body '{"config":{"PerEndpointCredentialsEnabled":"True"}}'

# Create credential (returns plaintext token ONCE)
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:8080/scim/admin/endpoints/<id>/credentials" `
  -Headers @{ Authorization = "Bearer $secret" }

# List / Revoke
GET  /scim/admin/endpoints/<id>/credentials
DELETE /scim/admin/endpoints/<id>/credentials/<credentialId>
```

---

## Per-Endpoint Configuration

Each endpoint has **12 persisted boolean settings + logLevel** stored in `profile.settings`, plus **2 capabilities derived from the profile structure** (v0.28.0).

### Persisted Settings (`profile.settings`)

| Flag | Default | Purpose |
|---|---|---|
| `SoftDeleteEnabled` | `false` | Soft delete (`active=false` + `deletedAt`) instead of physical deletion |
| `ReprovisionOnConflictForSoftDeletedResource` | `false` | Re-activate soft-deleted resource on POST conflict (requires SoftDeleteEnabled) |
| `StrictSchemaValidation` | `false` | Full RFC 7643 §2 attribute validation on all write paths |
| `AllowAndCoerceBooleanStrings` | `true` | Coerce `"True"`/`"False"` to native booleans (Entra compatibility) |
| `MultiOpPatchRequestAddMultipleMembersToGroup` | `false` | Allow multi-member add in single PATCH |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | `false` | Allow multi-member remove in single PATCH |
| `VerbosePatchSupported` | `false` | Dot-notation PATCH path resolution |
| `PatchOpAllowRemoveAllMembers` | `true` | Allow removing all group members via `path=members` |
| `RequireIfMatch` | `false` | Require `If-Match` header on mutating requests (428 if missing) |
| `PerEndpointCredentialsEnabled` | `false` | Enable per-endpoint bcrypt bearer token credentials |
| `IncludeWarningAboutIgnoredReadOnlyAttribute` | `false` | Warning URN extension when readOnly attrs stripped |
| `IgnoreReadOnlyAttributesInPatch` | `false` | Strip+warn instead of 400 on readOnly PATCH (requires StrictSchemaValidation) |

### Derived Capabilities (from profile structure)

| Capability | Derived From | Purpose |
|---|---|---|
| Custom resource types | `profile.resourceTypes` entries beyond User/Group | Enable custom resource type CRUD (D9) |
| Bulk operations | `profile.serviceProviderConfig.bulk.supported` | Enable `POST /Bulk` batch processing (D8) |

> The `EndpointConfig` interface in source still defines all 14 boolean flags + logLevel for backward compatibility. The two derived capabilities were previously standalone flags (`CustomResourceTypesEnabled`, `BulkOperationsEnabled`) and are now implied by the profile.

Full reference: [docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md](docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md)

### Endpoint Profiles (v0.28.0)

Endpoints are created with a **profile** — an RFC-native JSONB document containing schemas, resourceTypes, serviceProviderConfig, and settings.

5 built-in presets:

| Preset | Description |
|---|---|
| `entra-id` | Default — full User + Group + Enterprise extension, Entra-compatible flags |
| `entra-id-minimal` | Minimal Entra-compatible surface |
| `rfc-standard` | Strict RFC 7643/7644 defaults |
| `minimal` | Bare minimum User-only endpoint |
| `user-only` | User CRUD only, no Groups |

```powershell
# Create endpoint with preset
POST /scim/admin/endpoints
{ "name": "my-tenant", "profilePreset": "entra-id" }

# List available presets
GET /scim/admin/profile-presets
```

---

## Configuration Reference

### Required Environment Variables

| Variable | Purpose |
|---|---|
| `SCIM_SHARED_SECRET` | Global shared secret bearer token (auth tier 3) |
| `JWT_SECRET` | OAuth / JWT signing key (auth tier 2) |
| `OAUTH_CLIENT_SECRET` | OAuth client credential secret (auth tier 2) |

### Optional Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` (dev) / `8080` (container) | HTTP listen port |
| `DATABASE_URL` | `postgresql://scim:scim@localhost:5432/scimdb` | PostgreSQL connection string |
| `PERSISTENCE_BACKEND` | `prisma` | `prisma` for PostgreSQL, `inmemory` for Map-based storage |
| `OAUTH_CLIENT_ID` | `scimserver-client` | OAuth client identifier |
| `NODE_ENV` | `production` (container) | Runtime mode |
| `API_PREFIX` | `scim` | Global route prefix |

> **Security:** Treat all secrets as sensitive. Rotate immediately after sharing or log exposure.

---

## Microsoft Entra ID Setup

1. **Create an Enterprise Application** in [Azure Portal](https://portal.azure.com) → Entra ID → Enterprise Applications
2. **Configure provisioning:**
   - **Tenant URL:** `https://<your-app-url>/scim/v2`
   - **Secret Token:** value of `SCIM_SHARED_SECRET` or a per-endpoint credential token
3. **Test connection** — expect success
4. **Configure attribute mappings** (defaults work for User + Group)
5. **Assign users/groups** to the Enterprise App
6. **Turn provisioning ON**
7. **Monitor** — open your app URL in a browser for the real-time dashboard

> For per-endpoint credentials (recommended for multi-tenant isolation): enable `PerEndpointCredentialsEnabled`, create a credential via `POST /scim/admin/endpoints/:id/credentials`, and use the returned token as the Entra Secret Token.

Detailed guide: [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md)

---

## Operations & Observability

### Key Admin Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /scim/admin/version` | Runtime metadata (version, uptime, memory, auth config, storage) |
| `GET /scim/admin/log-config/recent?limit=25` | Recent ring-buffer logs |
| `GET /scim/admin/log-config/stream?level=INFO` | Live SSE log stream |
| `GET /scim/admin/log-config/download?format=json` | Download logs as JSON or NDJSON |
| `GET /scim/admin/endpoints` | List all endpoints |
| `POST /scim/admin/endpoints` | Create a new endpoint |
| `GET /scim/admin/profile-presets` | List available endpoint profile presets |
| `GET /health` | Health check |

### Remote Log Access

```powershell
# PowerShell helper script
.\scripts\remote-logs.ps1 -Mode recent -BaseUrl https://<app-url>
.\scripts\remote-logs.ps1 -Mode tail -BaseUrl https://<app-url>
.\scripts\remote-logs.ps1 -Mode download -BaseUrl https://<app-url> -Format json
```

```bash
# curl examples
curl "https://<app-url>/scim/admin/log-config/recent?limit=25" \
  -H "Authorization: Bearer <SCIM_SECRET>"

curl -N "https://<app-url>/scim/admin/log-config/stream?level=INFO" \
  -H "Authorization: Bearer <SCIM_SECRET>"
```

### Web UI

The built-in React SPA (served at `/`) provides:

- **Activity feed** — real-time provisioning event stream with identifier extraction
- **Log viewer** — searchable, filterable request/response inspection with detail modal
- **Endpoint management** — create, configure, and monitor endpoints
- **Runtime status** — version, uptime, memory, auth mode, storage info
- **Theme support** — light and dark modes

---

## Testing

### Test Suite Summary

| Level | Tests | Suites | Tool |
|---|---|---|---|
| **Unit** | 2,830 | 73 | Jest 30 + ts-jest |
| **E2E** | 613 + 6 skipped | 30 | Jest + Supertest |
| **Live integration** | 832 assertions | — | PowerShell (`live-test.ps1`) |
| **Microsoft Validator** | 25/25 + 7 preview | — | [SCIM Validator](https://scimvalidator.microsoft.com/) |

### Running Tests

```powershell
cd api

# Unit tests
npm test

# E2E tests (requires PostgreSQL)
npm run test:e2e

# Coverage reports
npm run test:cov          # Unit → coverage/
npm run test:e2e:cov      # E2E → coverage-e2e/
npm run test:cov:all      # Both

# Live integration tests (requires running server)
..\scripts\live-test.ps1                                                        # local on port 6000
..\scripts\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "secret"  # Docker
..\scripts\live-test.ps1 -Verbose                                               # full request/response tracing

# Full pipeline (unit + E2E + live)
npm run test:all
```

### Deployment Verification Matrix

All three deployment modes produce identical test results:

| Mode | Backend | Live Assertions |
|---|---|---|
| Local (port 6000) | In-Memory | 832 |
| Docker (port 8080) | PostgreSQL | 832 |
| Azure Container Apps | PostgreSQL | 832 |

---

## Repository Structure

```text
SCIMServer/
├── api/                          # NestJS SCIM API
│   ├── src/
│   │   ├── main.ts               # Bootstrap, middleware, global config
│   │   ├── auth/                  # SharedSecretGuard, ScimAuthGuard
│   │   ├── domain/               # Pure domain: models, patch engines, validation, repos
│   │   ├── infrastructure/       # Prisma repository implementations
│   │   ├── modules/
│   │   │   ├── scim/             # SCIM protocol layer
│   │   │   │   ├── controllers/  # Users, Groups, Generic, Bulk, /Me, Discovery, Admin
│   │   │   │   ├── services/     # Business logic (Users, Groups, Generic, Bulk)
│   │   │   │   ├── discovery/    # SchemaRegistry, DiscoveryService, schema constants
│   │   │   │   ├── endpoint-profile/ # Profile presets, auto-expand, tighten-only validation
│   │   │   │   ├── dto/          # Request/response DTOs with class-validator
│   │   │   │   ├── filters/      # SCIM filter parser + applicator
│   │   │   │   ├── interceptors/ # ETag, request logging, context storage
│   │   │   │   └── utils/        # PATCH path parser
│   │   │   ├── endpoint/         # Endpoint CRUD + admin API
│   │   │   ├── logging/          # Structured logging, SSE stream, download
│   │   │   ├── oauth/            # OAuth 2.0 token issuance
│   │   │   └── ...               # health, database, web, activity-parser
│   │   └── generated/            # Prisma client (auto-generated)
│   ├── prisma/
│   │   └── schema.prisma         # 5 models
│   └── test/e2e/                 # 30+ E2E spec files
├── web/                          # React 19 + Vite 7 frontend SPA
├── docs/                         # 80+ protocol, operations, and design docs
├── infra/                        # Bicep IaC templates (Container Apps, PostgreSQL, networking)
├── scripts/                      # Deploy, test, and operations automation (PowerShell)
├── Dockerfile                    # Unified production image (web + api)
├── docker-compose.yml            # Local dev stack (PostgreSQL + SCIMServer)
├── bootstrap.ps1                 # One-liner Azure bootstrap
├── setup.ps1                     # Local / deploy helper
└── deploy.ps1                    # Deployment entrypoint wrapper
```

---

## Documentation Index

Full index: [docs/INDEX.md](docs/INDEX.md)

### Core Guides

| Document | Description |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | All deployment methods with comparison table |
| [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) | End-to-end Azure deployment with architecture diagrams |
| [docs/COMPLETE_API_REFERENCE.md](docs/COMPLETE_API_REFERENCE.md) | Complete REST API reference with curl examples |
| [docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md](docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | 12 persisted settings + 2 derived capabilities + logLevel — examples and diagrams |
| [docs/SCHEMA_CUSTOMIZATION_GUIDE.md](docs/SCHEMA_CUSTOMIZATION_GUIDE.md) | Custom schema extensions and resource type registration |

### Protocol & Compliance

| Document | Description |
|---|---|
| [docs/SCIM_REFERENCE.md](docs/SCIM_REFERENCE.md) | SCIM v2 API reference with example payloads |
| [docs/SCIM_COMPLIANCE.md](docs/SCIM_COMPLIANCE.md) | RFC 7643/7644 compliance matrix + Entra compatibility |
| [docs/SCIM_RFC_COMPLIANCE_LAYER.md](docs/SCIM_RFC_COMPLIANCE_LAYER.md) | Technical implementation of RFC compliance |

### Operations

| Document | Description |
|---|---|
| [docs/LOGGING_AND_OBSERVABILITY.md](docs/LOGGING_AND_OBSERVABILITY.md) | Structured logging, ring buffer, SSE stream |
| [docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md](docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md) | Remote diagnosis playbooks and log collection |
| [docs/DOCKER_GUIDE_AND_TEST_REPORT.md](docs/DOCKER_GUIDE_AND_TEST_REPORT.md) | Docker build/run guide and test report |

### Design & Architecture

| Document | Description |
|---|---|
| [docs/TECHNICAL_DESIGN_DOCUMENT.md](docs/TECHNICAL_DESIGN_DOCUMENT.md) | Full as-built technical design |
| [docs/SCHEMA_TEMPLATES_DESIGN.md](docs/SCHEMA_TEMPLATES_DESIGN.md) | Endpoint profile system design (v0.28.0) |
| [docs/PROJECT_HEALTH_AND_STATS.md](docs/PROJECT_HEALTH_AND_STATS.md) | Codebase statistics, test counts, architecture metrics |

### API Collections

| Format | Location |
|---|---|
| OpenAPI v3 | [docs/openapi/](docs/openapi/) |
| Postman | [docs/postman/](docs/postman/) |
| Insomnia | [docs/insomnia/](docs/insomnia/) |

---

## Technology Stack

| Component | Technology | Version |
|---|---|---|
| Runtime | Node.js | 24 |
| Language | TypeScript | 5.9 |
| Framework | NestJS | 11 |
| ORM | Prisma | 7 |
| Database | PostgreSQL | 17 |
| Frontend | React + Vite | 19 + 7 |
| Test Runner | Jest + ts-jest | 30 |
| Linting | ESLint (flat config) | 10 |
| Container | Docker (`node:24-alpine`) | — |
| IaC | Bicep | — |
| CI/CD | GitHub Actions | — |
| Registry | GitHub Container Registry | — |

---

## CI/CD

| Workflow | Trigger | Purpose |
|---|---|---|
| `build-test.yml` | Push to `test/**`, `dev/**`, `feature/**` | Build + test + push `test-<branch>` image |
| `publish-ghcr.yml` | Manual dispatch | Build + push versioned + `latest` image |

Container image: `ghcr.io/pranems/scimserver` — `node:24-alpine` base, ~350 MB, port 8080.

### Updating a Deployment

```powershell
# Auto-discovery update
iex (irm 'https://raw.githubusercontent.com/pranems/SCIMServer/master/scripts/update-scimserver-func.ps1')
Update-SCIMServer -Version v0.28.0 -ResourceGroup <rg> -AppName <app>

# Or manual
az containerapp update -n <app> -g <rg> --image ghcr.io/pranems/scimserver:0.28.0
```

---

## Prerequisites

| Requirement | For |
|---|---|
| Node.js 24+ / npm 10+ | Local development |
| PostgreSQL 17 | Database (or use `PERSISTENCE_BACKEND=inmemory`) |
| Docker Desktop | Container workflow |
| Azure CLI + PowerShell 7 | Azure deployment scripts |

---

## Contributing

- Issues: [GitHub Issues](https://github.com/pranems/SCIMServer/issues)
- Discussions: [GitHub Discussions](https://github.com/pranems/SCIMServer/discussions)

---

## License

MIT — see [LICENSE](LICENSE).
