# ✨ SCIMServer

Production-ready SCIM 2.0 server with a built-in observability UI for Microsoft Entra ID provisioning.

| Key | Value |
|---|---|
| Version | [`v0.28.0`](https://github.com/pranems/SCIMServer/releases/latest) |
| Protocol | [SCIM 2.0](https://scim.cloud/) |
| Target Platform | [Microsoft Entra ID](https://entra.microsoft.com/) |
| Runtime | Node.js 24 |
| License | [MIT](LICENSE) |

SCIM endpoint: `/scim/v2`  
Admin & observability endpoint family: `/scim/admin/*`

---

## Why SCIMServer

- Full SCIM resource surface: Users, Groups, Schemas, ResourceTypes, ServiceProviderConfig
- Entra-focused behavior and validator alignment (25/25 + 7 preview scenarios)
- Built-in UI for activity feed, log inspection, endpoint management, and runtime status
- Production operations support: log streaming/download, health endpoint, version metadata
- Cloud-ready deployment with Azure Container Apps + PostgreSQL with auto-scale to zero

---

## Quick Start

### Option A — Azure (recommended)

```powershell
iex (iwr https://raw.githubusercontent.com/pranems/SCIMServer/master/bootstrap.ps1).Content
```

The bootstrap flow provisions resources, deploys the app, and prints required secrets/URLs.

### Option B — Docker (fast local smoke test)

```powershell
docker build -t scimserver:latest -f Dockerfile .
docker run --rm -p 8080:8080 `
  -e PORT=8080 `
  -e SCIM_SHARED_SECRET=local-scim-secret `
  -e JWT_SECRET=local-jwt-secret `
  -e OAUTH_CLIENT_ID=scimserver-client `
  -e OAUTH_CLIENT_SECRET=local-oauth-secret `
  scimserver:latest
```

- UI: `http://localhost:8080/`
- SCIM base: `http://localhost:8080/scim/v2`
- Health: `http://localhost:8080/health`

### Option C — Local dev (API + web)

```powershell
git clone https://github.com/pranems/SCIMServer.git
cd SCIMServer

# API terminal
cd api
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev

# Web terminal
cd ..\web
npm install
npm run dev
```

---

## Prerequisites

- Node.js 24+
- npm 10+
- Docker Desktop (optional, for container workflow)
- Azure CLI + PowerShell 7 (optional, for Azure deployment scripts)

---

## Configuration

### Required in production

| Variable | Purpose |
|---|---|
| `SCIM_SHARED_SECRET` | Global shared secret bearer token — legacy fallback (tier 3 of 3-tier auth) |
| `JWT_SECRET` | OAuth/JWT signing key (tier 2) |
| `OAUTH_CLIENT_SECRET` | OAuth client credential secret (tier 2) |

> **3-tier auth (v0.21.0):** Incoming `Bearer` tokens are evaluated as: (1) per-endpoint bcrypt credential → (2) OAuth JWT → (3) global `SCIM_SHARED_SECRET`. Enable per-endpoint credentials via the `PerEndpointCredentialsEnabled` flag and the Admin Credential API.

> **ReadOnly attribute stripping (v0.22.0):** POST/PUT payloads automatically strip `mutability:'readOnly'` attributes (`id`, `meta`, `groups`, custom readOnly) per RFC 7643 §2.2. PATCH ops targeting readOnly attrs are silently stripped (non-strict) or rejected (strict). Optional warning URN extension via `IncludeWarningAboutIgnoredReadOnlyAttribute` flag.

> **P2 Attribute Characteristic Enforcement (v0.24.0):** Schema-driven `returned:"always"` enforcement (userName, displayName, Group active), `writeOnly→returned:"never"` stripping (password), readOnly sub-attribute stripping on mutation requests, and `caseExact`-aware SCIM filtering — all derived from schema definitions, not hardcoded.

### Common optional variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | API/web runtime port |
| `OAUTH_CLIENT_ID` | `scimserver-client` | OAuth client identifier |
| `DATABASE_URL` | `postgresql://scim:scim@localhost:5432/scimdb` | PostgreSQL connection string |
| `NODE_ENV` | `production` (container) | Runtime mode |

Security note: treat all secrets as sensitive and rotate after sharing/output exposure.

---

## Configure Microsoft Entra Provisioning

Use these values in Enterprise Application provisioning:

- Tenant URL: `https://<your-app-url>/scim/v2`
- Secret Token: value of `SCIM_SHARED_SECRET` **or** a per-endpoint credential token (recommended for multi-tenant isolation)

To use a per-endpoint credential instead of the global secret:
1. Enable `PerEndpointCredentialsEnabled` on the endpoint (`PATCH /scim/admin/endpoints/:id`)
2. Create a credential via `POST /scim/admin/endpoints/:id/credentials`
3. Copy the returned plaintext token (shown once) into the Entra "Secret Token" field

Then test connection, configure mappings, assign users/groups, and enable provisioning.

References:

- [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md)
- [docs/SCIM_REFERENCE.md](docs/SCIM_REFERENCE.md)
- [docs/SCIM_COMPLIANCE.md](docs/SCIM_COMPLIANCE.md)

---

## Architecture

```mermaid
flowchart LR
    Entra[Microsoft Entra ID\nProvisioning] -->|SCIM / HTTPS| App[SCIMServer\nAzure Container Apps]
    App --> UI[Built-in Web UI\n/admin + logs + activity]
    App --> DB[(PostgreSQL 17)]
```

Request shape:

- SCIM API: `https://<host>/scim/v2`
- Admin APIs: `https://<host>/scim/admin/*`
- Web UI: `https://<host>/`

---

## Operations

Key admin endpoints:

- `GET /scim/admin/version`
- `GET /scim/admin/log-config/recent?limit=25`
- `GET /scim/admin/log-config/stream?level=INFO` (SSE)
- `GET /scim/admin/log-config/download?format=json`

Remote log helper:

```powershell
.\scripts\remote-logs.ps1 -Mode recent -BaseUrl https://<your-app-url>
.\scripts\remote-logs.ps1 -Mode tail -BaseUrl https://<your-app-url>
.\scripts\remote-logs.ps1 -Mode download -BaseUrl https://<your-app-url> -Format json
```

Live sample payloads:

- [docs/images/readme/version-latest.json](docs/images/readme/version-latest.json)
- [docs/images/readme/recent-logs-latest.json](docs/images/readme/recent-logs-latest.json)

Operational docs:

- [docs/LOGGING_AND_OBSERVABILITY.md](docs/LOGGING_AND_OBSERVABILITY.md)
- [docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md](docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md)

---

## Update / Upgrade

```powershell
iex (irm https://raw.githubusercontent.com/pranems/SCIMServer/master/scripts/update-scimserver-func.ps1)
Update-SCIMServer -Version v0.28.0 -ResourceGroup <rg> -AppName <app>
```

Admin/release references:

- [admin.md](admin.md)
- [CHANGELOG.md](CHANGELOG.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Quality Status

> 📊 See [PROJECT_HEALTH_AND_STATS.md](docs/PROJECT_HEALTH_AND_STATS.md#test-suite-summary) for current test counts.

- **All unit and E2E tests passing** (2,879 unit + 608 E2E). Live: 811 live assertions
- Microsoft SCIM Validator: **25/25 passed** (+ 7 preview scenarios)

### Per-Endpoint Config Flags

| Flag | Default | Description |
|------|---------|-------------|
| `SoftDeleteEnabled` | `false` | Soft delete (set `active=false` + `deletedAt`) instead of physical row deletion |
| `ReprovisionOnConflictForSoftDeletedResource` | `false` | Re-activate soft-deleted resource on POST conflict instead of 409 (requires SoftDeleteEnabled) |
| `StrictSchemaValidation` | `false` | Reject extension URNs not declared in `schemas[]` or not registered |
| `MultiOpPatchRequestAddMultipleMembersToGroup` | `false` | Allow multi-member add in single PATCH |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | `false` | Allow multi-member remove in single PATCH |
| `VerbosePatchSupported` | `false` | Dot-notation PATCH path resolution |
| `PatchOpAllowRemoveAllMembers` | `true` | Allow removing all members via `path=members` |
| `RequireIfMatch` | `false` | Require If-Match header on mutating requests (428 if missing) |
| `AllowAndCoerceBooleanStrings` | `true` | Coerce boolean string values ("True"/"False") to native booleans before schema validation |
| `CustomResourceTypesEnabled` | `false` | Enable custom resource type registration and generic SCIM CRUD beyond User/Group |
| `BulkOperationsEnabled` | `false` | Enable `POST /Bulk` batch processing (RFC 7644 §3.7) |
| `PerEndpointCredentialsEnabled` | `false` | Enable per-endpoint bcrypt bearer token credentials (3-tier auth) |
| `IncludeWarningAboutIgnoredReadOnlyAttribute` | `false` | Attach warning URN to responses when readOnly attrs stripped (RFC 7643 §2.2) |
| `IgnoreReadOnlyAttributesInPatch` | `false` | Override G8c strict PATCH rejection → strip+warn (requires StrictSchemaValidation ON) |

### Coverage scripts

```powershell
cd api
npm run test:cov          # Unit test coverage → coverage/
npm run test:e2e:cov      # E2E test coverage  → coverage-e2e/
npm run test:cov:all      # Both unit + E2E coverage
npm run test:all          # Unit + E2E + live smoke tests
```

Testing references:

- [docs/TESTING-WORKFLOW.md](docs/TESTING-WORKFLOW.md)
- [docs/SCIM_VALIDATION_GAP_ANALYSIS.md](docs/SCIM_VALIDATION_GAP_ANALYSIS.md)
- [docs/SCIM_GROUP_PERFORMANCE_ANALYSIS.md](docs/SCIM_GROUP_PERFORMANCE_ANALYSIS.md)
- [docs/PERSISTENCE_PERFORMANCE_ANALYSIS.md](docs/PERSISTENCE_PERFORMANCE_ANALYSIS.md)

---

## Documentation Index

Start here: [docs/INDEX.md](docs/INDEX.md)

High-value paths:

- Deploy and operate: [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md), [DEPLOYMENT.md](DEPLOYMENT.md)
- API and collections: [docs/COMPLETE_API_REFERENCE.md](docs/COMPLETE_API_REFERENCE.md), [docs/openapi/](docs/openapi/), [docs/postman/](docs/postman/), [docs/insomnia/](docs/insomnia/)
- SCIM protocol: [docs/SCIM_REFERENCE.md](docs/SCIM_REFERENCE.md), [docs/SCIM_RFC_COMPLIANCE_LAYER.md](docs/SCIM_RFC_COMPLIANCE_LAYER.md)
- Observability: [docs/LOGGING_AND_OBSERVABILITY.md](docs/LOGGING_AND_OBSERVABILITY.md), [docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md](docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md)
- Design context: [docs/TECHNICAL_DESIGN_DOCUMENT.md](docs/TECHNICAL_DESIGN_DOCUMENT.md), [docs/SQLITE_COMPROMISE_ANALYSIS.md](docs/SQLITE_COMPROMISE_ANALYSIS.md) (historical, pre-PostgreSQL)

---

## Repository Structure

```text
SCIMServer/
├── api/                  # NestJS SCIM API + admin APIs + Prisma
├── web/                  # React/Vite frontend
├── docs/                 # Protocol, operations, and product docs
├── infra/                # Bicep infrastructure templates
├── scripts/              # Deploy, test, and operations automation
├── Dockerfile            # Unified production image (web + api)
├── bootstrap.ps1         # One-liner bootstrap entrypoint
├── setup.ps1             # Local/deploy helper wrapper
└── deploy.ps1            # Deployment entrypoint wrapper
```

---

## Contributing

- Issues: [GitHub Issues](https://github.com/pranems/SCIMServer/issues)
- Discussions: [GitHub Discussions](https://github.com/pranems/SCIMServer/discussions)

---

## License

MIT — see [LICENSE](LICENSE).
