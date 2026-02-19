# SCIMServer Deployment Options

> Version baseline: v0.10.0 · Updated: February 18, 2026 · Scope: production + local deployment paths

This document covers all deployment methods for SCIMServer. For the quickest start, use the Azure deployment described in the main [README.md](./README.md). For the most comprehensive Azure guide with architecture diagrams, see [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md).

---

## Azure Container Apps (Recommended for Production)

### One-Liner Bootstrap

```powershell
iex (iwr https://raw.githubusercontent.com/pranems/SCIMServer/master/bootstrap.ps1).Content
```

Prompts for Resource Group, App Name, Region, and SCIM Secret. Provisions all Azure resources automatically (VNet, Blob Storage with private endpoint, Container Apps Environment, Container App, Log Analytics).

### Scripted Deploy

```powershell
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-rg" `
  -AppName "scimserver-prod" `
  -Location "eastus" `
  -ScimSecret "your-secure-secret"
```

Optional parameters: `-JwtSecret`, `-OauthClientSecret`, `-ImageTag`, `-BlobBackupAccount`, `-BlobBackupContainer`.

> The deployment script prints three secrets at the end (SCIM bearer, JWT signing, OAuth client). **Store each value securely** — they are not stored anywhere else.

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
| 2 | VNet + 3 subnets + Private DNS | `infra/networking.bicep` |
| 3 | Storage Account + Private Endpoint | `infra/blob-storage.bicep` |
| 4 | Container Apps Environment + Log Analytics | `infra/containerapp-env.bicep` |
| 5 | Container App (SCIMServer) | `infra/containerapp.bicep` |
| 6 | RBAC role assignment (Storage Blob Data Contributor) | `az role assignment create` |

### Benefits

- **HTTPS**: Automatic TLS certificate management
- **VNet Isolation**: All inter-service traffic stays within the virtual network
- **Private Storage**: Blob storage accessible only via private endpoint
- **Scale to Zero**: Minimal cost when idle
- **Managed Identity**: No storage keys — system-assigned identity with RBAC
- **Log Analytics**: Centralized logging with 30-day retention

> **Current baseline**: `deploy-azure.ps1` provisions an isolated virtual network, private DNS zone, and blob storage private endpoint so the snapshot container never requires public access.

---

## Docker Compose (Self-Hosted)

```yaml
version: '3.8'
services:
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
      - DATABASE_URL=file:/tmp/local-data/scim.db
    volumes:
      - scim-data:/app/data
volumes:
  scim-data:
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
  -e OAUTH_CLIENT_ID=scimserver-client `
  -e OAUTH_CLIENT_SECRET=your-oauth-client-secret `
  -v scim-data:/app/data `
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
cd SCIMServer
.\setup.ps1 -TestLocal
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
DATABASE_URL=file:./dev.db
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
| **Local Development** | 15 min | Free | Single | High | Development |

---

## Container Image

- **Registry**: GitHub Container Registry
- **Image**: `ghcr.io/pranems/scimserver`
- **Tags**: `latest`, version tags (e.g., `0.10.0`), test tags (`test-<branch>`)
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
  Update-SCIMServer -Version v0.10.0

# Or manual image update
az containerapp update -n scimserver-prod -g scimserver-rg --image ghcr.io/pranems/scimserver:0.10.0
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Container won't start | Check `az containerapp logs show -n <app> -g <rg>` for errors |
| SCIM connection fails | Verify URL ends with `/scim/v2` and secret token matches |
| UI not loading | Check CORS configuration and API base URL |
| Database errors | Container runs `prisma migrate deploy` on startup; check entrypoint logs |
| Blob backup failures | Verify managed identity has `Storage Blob Data Contributor` role |

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
3. **Set Secret Token** → SCIM secret from deployment output
4. **Test Connection** → expect success
5. **Turn Provisioning ON** → assign users/groups
6. **Monitor** → open app URL in browser for real-time dashboard

For the complete walkthrough with screenshots: [docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md)
