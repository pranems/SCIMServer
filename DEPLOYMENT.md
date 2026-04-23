# SCIMServer Deployment Options

> Updated: April 13, 2026 · v0.35.0 · Scope: production + local deployment paths

This document covers all deployment methods for SCIMServer. For the quickest start, use the Azure deployment described in the main [README.md](./README.md). For the most comprehensive Azure guide with architecture diagrams, see [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md).

---

## Azure Container Apps (Recommended for Production)

### Deployment Entry Points

SCIMServer provides 3 ways to deploy to Azure - all ultimately call `scripts/deploy-azure.ps1`:

| Entry Point | Usage | What It Does |
|-------------|-------|-------------|
| **`bootstrap.ps1`** → `setup.ps1` | `iex (iwr .../bootstrap.ps1).Content` | Downloads `setup.ps1`, prompts for all config, auto-provisions PostgreSQL |
| **`deploy.ps1`** | `iex (irm .../deploy.ps1)` | One-click wrapper - prompts for config, downloads repo ZIP (or uses local), auto-provisions PostgreSQL |
| **`scripts/deploy-azure.ps1`** | `.\scripts\deploy-azure.ps1 -ProvisionPostgres` | Core engine - full parameter control, supports BYO PostgreSQL via `-DatabaseUrl` |

All three auto-generate secrets (SCIM, JWT, OAuth) if not provided, and deploy a VNet-isolated Container App with PostgreSQL Flexible Server.

### One-Liner Bootstrap (No Git Clone Needed)

```powershell
iex (iwr https://raw.githubusercontent.com/pranems/SCIMServer/master/bootstrap.ps1).Content
```

Prompts for Resource Group, App Name, Region, and SCIM Secret. Provisions all Azure resources automatically (VNet, Container Apps Environment, Container App, Log Analytics, PostgreSQL Flexible Server).

> **How it works:** `bootstrap.ps1` downloads `setup.ps1` from GitHub → `setup.ps1` downloads `deploy-azure.ps1` + Bicep templates → calls `deploy-azure.ps1 -ProvisionPostgres`. No local repo clone needed - no credentials beyond your Azure subscription required. The container image (`ghcr.io/pranems/scimserver:latest`) is public and pulls anonymously.

> **Sovereign/gov cloud users:** The one-liners download scripts from `raw.githubusercontent.com` which may be blocked in BLEU, Azure China, or air-gapped environments. Clone the repo from a machine with internet access, then run `scripts/deploy-azure.ps1` directly. See [docs/SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md](docs/SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md).

### Alternative One-Liner

```powershell
iex (irm 'https://raw.githubusercontent.com/pranems/SCIMServer/master/deploy.ps1')
```

Same result - interactive prompts for all configuration. If run from within a cloned repo, it uses the local `scripts/deploy-azure.ps1` instead of downloading.

### Scripted Deploy (From Cloned Repo)

```powershell
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-rg" `
  -AppName "scimserver-prod" `
  -Location "eastus" `
  -ScimSecret "your-secure-secret"
```

Optional parameters: `-JwtSecret`, `-OauthClientSecret`, `-ImageTag`, `-DatabaseUrl` (BYO PostgreSQL connection string), `-ProvisionPostgres` (auto-provision Azure PostgreSQL Flexible Server).

> **PostgreSQL required (Phase 3):** SCIMServer uses PostgreSQL as its persistence backend. Provide either `-DatabaseUrl "postgresql://..."` (existing server) or `-ProvisionPostgres` (the script will deploy an Azure Database for PostgreSQL Flexible Server via `infra/postgres.bicep`, ~$15-25/mo additional).

> The deployment script prints three secrets at the end (SCIM bearer, JWT signing, OAuth client). **Store each value securely** - they are not stored anywhere else.

### Quick Log Access (after deploy)

The deployment output now prints copy/paste commands for log access. Core endpoints are:

- `GET /scim/admin/log-config/recent?limit=25` (recent ring-buffer logs)
- `GET /scim/admin/log-config/stream?level=INFO` (live SSE stream)
- `GET /scim/admin/log-config/download?format=json` (download logs)

Examples:

```powershell
# Recent logs from deployed app
curl "https://<app-url>/scim/admin/log-config/recent?limit=25" -H "Authorization: Bearer <SCIM_SECRET>"

# Live stream (SSE)
curl -N "https://<app-url>/scim/admin/log-config/stream?level=INFO" -H "Authorization: Bearer <SCIM_SECRET>"

# Download JSON logs
curl "https://<app-url>/scim/admin/log-config/download?format=json" -H "Authorization: Bearer <SCIM_SECRET>" -o scim-logs.json

# Convenience script (from repo root)
.\scripts\remote-logs.ps1 -Mode tail -BaseUrl https://<app-url>
```

### What Gets Deployed

| Step | Resource | Bicep Template |
|------|----------|----------------|
| 1 | Resource Group | `az group create` |
| 2 | VNet + 3 subnets | `infra/networking.bicep` |
| 3 | *(Optional)* Azure PostgreSQL Flexible Server | `infra/postgres.bicep` |
| 4 | Container Apps Environment + Log Analytics | `infra/containerapp-env.bicep` |
| 5 | Container App (SCIMServer) | `infra/containerapp.bicep` |

### Benefits

- **HTTPS**: Automatic TLS certificate management
- **VNet Isolation**: All inter-service traffic stays within the virtual network
- **Scale to Zero**: Minimal cost when idle
- **Managed Identity**: No credentials in environment - system-assigned identity
- **Log Analytics**: Centralized logging with 30-day retention
- **PostgreSQL WAL backup**: Azure-native automated backup (7-day retention via `backupRetentionDays`)

---

## Dev / Prod Separation (Recommended)

When the production instance has active users, deploy a **separate dev resource group** for development. This gives full blast-radius isolation - the production deployment is never touched during development.

### Architecture

```
scimserver-rg           ← PROD (users) - do not touch
├── VNet, subnets
├── Container Apps Env + Log Analytics
├── PostgreSQL Flexible Server (scimdb)
└── Container App: scimserver2 (ghcr.io/pranems/scimserver:0.37.0)

scimserver-rg-dev       ← DEV (your iteration) - fully isolated
├── VNet, subnets
├── Container Apps Env + Log Analytics
├── PostgreSQL Flexible Server (scimdb)
└── Container App: scimserver-dev (ghcr.io/pranems/scimserver:dev)
```

### Deploy Dev Environment

```powershell
# One-time: provision the full dev environment (~5 min, ~$15-25/mo)
.\scripts\deploy-dev.ps1 -ProdResourceGroup "scimserver-rg"

# Optional: deploy a specific image tag
.\scripts\deploy-dev.ps1 -ProdResourceGroup "scimserver-rg" -ImageTag "dev"
```

### Daily Dev Workflow

```powershell
# Start dev PG server (if stopped to save costs)
.\scripts\start-dev.ps1

# ... develop, test, iterate ...
.\scripts\live-test.ps1 -BaseUrl "https://scimserver-dev.<fqdn>" -ClientSecret "<dev-secret>"

# Stop dev PG server when done (saves ~$12-20/mo)
.\scripts\stop-dev.ps1
```

### Promote to Production

```powershell
# Promote the tested dev image tag to prod (rolling update, zero downtime)
.\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -DevResourceGroup "scimserver-rg-dev"

# Or promote a specific version directly
.\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -ImageTag "0.38.0"
```

### Tear Down Dev (Optional)

```powershell
# Delete the entire dev resource group when no longer needed
az group delete --name scimserver-rg-dev --yes --no-wait
```

### Dev/Prod Scripts Summary

| Script | Purpose |
|--------|---------|
| `scripts/deploy-dev.ps1` | Provision isolated dev environment (separate RG, VNet, PG, Container App) |
| `scripts/start-dev.ps1` | Start stopped dev PostgreSQL server |
| `scripts/stop-dev.ps1` | Stop dev PostgreSQL server to save costs |
| `scripts/promote-to-prod.ps1` | Update prod Container App image to a tested version |

---

## Docker Compose (Self-Hosted)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=scim
      - POSTGRES_PASSWORD=scim
      - POSTGRES_DB=scimdb
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  scimserver:
    image: ghcr.io/pranems/scimserver:latest
    ports:
      - "3000:8080"
    environment:
      - PORT=8080
      - SCIM_SHARED_SECRET=your-secret-here
      - JWT_SECRET=your-jwt-secret
      - OAUTH_CLIENT_ID=scimserver-client
      - OAUTH_CLIENT_SECRET=your-oauth-client-secret
      - DATABASE_URL=postgresql://scim:scim@postgres:5432/scimdb
    depends_on:
      - postgres
volumes:
  pgdata:
```

```powershell
docker-compose up -d
```

## Standalone Docker

```powershell
docker run -d -p 3000:8080 `
  -e PORT=8080 `
  -e SCIM_SHARED_SECRET=your-secret `
  -e JWT_SECRET=your-jwt-secret `
  -e OAUTH_CLIENT_SECRET=your-oauth-client-secret `
  -e DATABASE_URL=postgresql://user:pass@your-pg-host:5432/scimdb `
  -e PERSISTENCE_BACKEND=prisma `
  ghcr.io/pranems/scimserver:latest
```

---

## Local Development

### Prerequisites

- Node.js 24+ and npm
- Git
- PowerShell (Windows) or bash (macOS/Linux)

### Quick Start

```powershell
git clone https://github.com/pranems/SCIMServer.git
cd SCIMServer/api
npm install
# In-memory mode (no database required):
PERSISTENCE_BACKEND=inmemory JWT_SECRET=dev SCIM_SHARED_SECRET=dev OAUTH_CLIENT_SECRET=dev npm run start:dev
```

### Manual Setup

```powershell
# Backend API (terminal 1)
cd api
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev

# Frontend Web UI (terminal 2)
cd web
npm install
npm run dev
```

### Environment Configuration

**api/.env**:
```env
SCIM_SHARED_SECRET=changeme
JWT_SECRET=changeme-jwt
OAUTH_CLIENT_SECRET=changeme-oauth
PORT=3000
DATABASE_URL=postgresql://scim:scim@localhost:5432/scimdb
CORS_ORIGINS=http://localhost:5173
```

**web/.env**:
```env
VITE_API_BASE=http://localhost:3000
VITE_SCIM_TOKEN=changeme
```

### Development URLs

- **SCIM API**: http://localhost:3000/scim
- **Web UI**: http://localhost:5173

### Authentication (3-Tier Fallback - v0.21.0)

SCIMServer uses a **3-tier authentication fallback chain** via `SharedSecretGuard` (global `APP_GUARD`). Each incoming `Authorization: Bearer <token>` is evaluated in order:

| Tier | Method | Env / Config Requirement | `req.authType` |
|------|--------|--------------------------|----------------|
| 1 | **Per-endpoint bcrypt credential** | `PerEndpointCredentialsEnabled` = `true` on endpoint + active credential created via Admin API | `endpoint_credential` |
| 2 | **OAuth 2.0 JWT** | `JWT_SECRET`, `OAUTH_CLIENT_SECRET`, `OAUTH_CLIENT_ID` | `oauth` |
| 3 | **Global shared secret** | `SCIM_SHARED_SECRET` | `legacy` |

- **Public routes** (discovery, OAuth token, web UI) bypass all tiers via `@Public()` decorator.
- **Rejection**: All tiers fail → `401 Unauthorized` with `WWW-Authenticate: Bearer realm="SCIM"`.

#### Per-Endpoint Credential Management (optional)

Enable the `PerEndpointCredentialsEnabled` flag on an endpoint to allow credential CRUD:

```powershell
# Create credential (returns plaintext token ONCE - store it securely)
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/scim/admin/endpoints/<endpointId>/credentials" `
  -Headers @{ Authorization = "Bearer changeme" } `
  -ContentType "application/json"

# List credentials (hash never returned)
Invoke-RestMethod -Uri "http://localhost:3000/scim/admin/endpoints/<endpointId>/credentials" `
  -Headers @{ Authorization = "Bearer changeme" }

# Revoke credential
Invoke-RestMethod -Method DELETE -Uri "http://localhost:3000/scim/admin/endpoints/<endpointId>/credentials/<credentialId>" `
  -Headers @{ Authorization = "Bearer changeme" }
```

Use the returned plaintext token as a `Bearer` token for SCIM calls to that specific endpoint.

### Per-Endpoint Configuration Flags

Each endpoint has 13 boolean config flags (+ `logLevel`) that control SCIM behavior. Set via `profile.settings` on endpoint create or PATCH. See [docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md](docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md) for the complete reference.

### Debug with Log File

```powershell
cd api
npm run start:debug 2>&1 | Tee-Object -FilePath scimserver.log
# Then attach VS Code debugger via "Attach to Running API" (port 9229)
```

---

## Deployment Comparison

| Method | Setup Time | Monthly Cost | Scalability | Maintenance | Best For |
|--------|------------|--------------|-------------|-------------|----------|
| **Azure Container Apps** | 5 min | ~$13-28 | Auto | Minimal | Production |
| **Docker Compose** | 10 min | Infra cost | Manual | Medium | Self-hosted |
| **Standalone Docker** | 5 min | Infra cost | Manual | Medium | Quick test |
| **In-Memory** | 2 min | Free | Single | None | Demos, CI/CD, integration testing |
| **Local Development** | 15 min | Free | Single | High | Development |

---

## In-Memory Mode (No Database)

```powershell
cd api
npm install && npm run build
$env:PERSISTENCE_BACKEND = "inmemory"
$env:SCIM_SHARED_SECRET = "local-secret"
$env:JWT_SECRET = "local-jwt"
$env:OAUTH_CLIENT_SECRET = "local-oauth"
$env:PORT = "6000"
node dist/main.js
```

All data lives in `Map`-based in-memory stores. No PostgreSQL required. Data is lost on restart. Ideal for demos, CI/CD pipelines, and integration testing. Produces identical live test results to the PostgreSQL-backed deployments.

---

## Container Image

- **Registry**: GitHub Container Registry
- **Image**: `ghcr.io/pranems/scimserver`
- **Tags**: `latest`, version tags (e.g., `0.31.0`), test tags (`test-<branch>`)
- **Base**: `node:24-alpine`
- **Size**: ~350 MB
- **Port**: 8080 (internal)

### CI/CD Pipelines

| Workflow | Trigger | Image Tag |
|----------|---------|-----------|
| `publish-ghcr.yml` | Manual dispatch (version input) | `<version>`, optionally `latest` |
| `build-test.yml` | Push to `test/**`, `dev/**`, `feature/**` | `test-<branch>` |

---

## Updating an Existing Deployment

```powershell
# Auto-discovery update
iex (irm 'https://raw.githubusercontent.com/pranems/SCIMServer/master/scripts/update-scimserver-func.ps1'); `
  Update-SCIMServer -Version v0.31.0

# Or manual image update
az containerapp update -n scimserver-prod -g scimserver-rg --image ghcr.io/pranems/scimserver:latest
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Container won't start | Check `az containerapp logs show -n <app> -g <rg>` for errors |
| SCIM connection fails | Verify URL ends with `/scim/v2` and secret token matches |
| UI not loading | Check CORS configuration and API base URL |
| Database errors | Container runs `prisma migrate deploy` on startup; check entrypoint logs |

### Useful Commands

```powershell
# Stream container logs
az containerapp logs show -n <app-name> -g <resource-group> --follow

# Recent SCIMServer logs via admin API
curl "https://<app-url>/scim/admin/log-config/recent?limit=25" -H "Authorization: Bearer <SCIM_SECRET>"

# Live SCIMServer log stream (SSE)
curl -N "https://<app-url>/scim/admin/log-config/stream?level=INFO" -H "Authorization: Bearer <SCIM_SECRET>"

# Test SCIM endpoint
curl -H "Authorization: Bearer your-secret" https://your-url/scim/v2/ServiceProviderConfig

# Check container app status
az containerapp show -n <app-name> -g <resource-group> --query "properties.runningStatus"
```

---

## Next Steps

After deployment, configure Microsoft Entra provisioning:

1. **Create Enterprise App** → Azure Portal → Entra ID → Enterprise Applications
2. **Set Tenant URL** → `https://<your-app-url>/scim/v2`
3. **Set Secret Token** → Use `SCIM_SHARED_SECRET` (legacy) **or** a per-endpoint credential token (preferred for multi-tenant isolation)
4. **Test Connection** → expect success
5. **Turn Provisioning ON** → assign users/groups
6. **Monitor** → open app URL in browser for real-time dashboard

For the complete walkthrough: [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md)

### Additional Guides

| Guide | Description |
|-------|-------------|
| [docs/ENDPOINT_LIFECYCLE_AND_USAGE.md](docs/ENDPOINT_LIFECYCLE_AND_USAGE.md) | Hands-on endpoint lifecycle, API recipes, common operations |
| [docs/SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md](docs/SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md) | Azure Government, BLEU (France), China - sovereign cloud deployment |
| [docs/COMPLETE_API_REFERENCE.md](docs/COMPLETE_API_REFERENCE.md) | Full REST API reference with curl/PowerShell examples |
