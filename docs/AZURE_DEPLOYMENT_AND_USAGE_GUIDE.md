# SCIMServer — Azure Deployment & Usage Guide

> **Version**: 0.10.0 | **Repository**: [github.com/pranems/SCIMServer](https://github.com/pranems/SCIMServer) | **Registry**: `ghcr.io/pranems/scimserver`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Deployment Step-by-Step](#3-deployment-step-by-step)
4. [What Gets Deployed](#4-what-gets-deployed)
5. [Post-Deployment Configuration](#5-post-deployment-configuration)
6. [Using the Application](#6-using-the-application)
7. [Updating & Maintenance](#7-updating--maintenance)
8. [Troubleshooting](#8-troubleshooting)
9. [Cost Estimate](#9-cost-estimate)
10. [Security Notes](#10-security-notes)

---

## 1. Architecture Overview

### High-Level Flow

```
┌─────────────────────┐       SCIM 2.0 HTTPS        ┌──────────────────────────┐
│                     │ ──────────────────────────▶  │                          │
│  Microsoft Entra ID │                              │   Azure Container Apps   │
│  (Provisioning)     │ ◀──────────────────────────  │   (SCIMServer)           │
│                     │       JSON Responses         │                          │
└─────────────────────┘                              └────────────┬─────────────┘
                                                                  │ :5432
                                                                  │ VNet private
                                                     ┌────────────▼─────────────┐
                                                     │   Azure PG Flexible      │
                                                     │   Server (B1ms)          │
                                                     │   PostgreSQL 17          │
                                                     │   Extensions:            │
                                                     │    citext, pgcrypto,     │
                                                     │    pg_trgm               │
                                                     │   scimdb database        │
                                                     │   sslmode=require        │
                                                     └──────────────────────────┘
```

> **Phase 3 Change:** The SQLite ephemeral database + Blob Storage snapshot backup
> architecture has been replaced by a managed Azure PG Flexible Server. Data is now
> durable, backed up automatically (7-day PITR), and supports multi-replica scaling.

### Azure Resource Architecture

```
Resource Group (e.g. scimserver-rg)
├── Virtual Network (10.40.0.0/16)
│   ├── aca-infra subnet        (10.40.0.0/21)   ← Container Apps Environment
│   ├── aca-runtime subnet      (10.40.8.0/21)   ← Container workloads
│   └── private-endpoints subnet(10.40.16.0/24)  ← PG Flexible Server
│
├── Private DNS Zone (privatelink.postgres.database.azure.com)
│   └── VNet Link → Virtual Network
│
├── Azure Database for PostgreSQL — Flexible Server
│   ├── SKU: Burstable B1ms (1 vCore, 2 GB RAM)
│   ├── Storage: 32 GB (auto-grow)
│   ├── Version: PostgreSQL 17
│   ├── Extensions: citext, pgcrypto, pg_trgm
│   ├── Database: scimdb
│   ├── VNet integration (private-endpoints subnet)
│   ├── SSL/TLS enforced (sslmode=require)
│   └── Automated backups (7-day retention, PITR)
│
├── Container Apps Environment
│   └── Container App (SCIMServer)
│       ├── Image: ghcr.io/pranems/scimserver:latest
│       ├── Secrets: SCIM token, JWT, OAuth, DATABASE_URL
│       ├── DATABASE_URL → PG Flexible Server (VNet private)
│       ├── PERSISTENCE_BACKEND: prisma
│       ├── Replicas: 1–3 (auto-scale)
│       └── Ingress: HTTPS (auto TLS cert)
│
└── Log Analytics Workspace
    └── Container App logs & PG metrics
```

### Data Flow Diagram

```
 ┌─────────────────┐        HTTPS          ┌────────────────────────────────┐
 │  Entra ID /     │ ════════════════════▶  │  Azure Container Apps          │
 │  SCIM Client    │                        │  ┌──────────────────────────┐  │
 │                 │ ◀════════════════════  │  │  SCIMServer Container    │  │
 └─────────────────┘   JSON Response        │  │                          │  │
                                            │  │  NestJS 11 + Prisma 7    │  │
                                            │  │  PrismaPg(pg.Pool)       │  │
                                            │  │                          │  │
                                            │  │  Entrypoint:             │  │
                                            │  │  1. prisma migrate deploy│  │
                                            │  │  2. node dist/main.js    │  │
                                            │  └──────────┬───────────────┘  │
                                            │             │ :5432            │
                                            └─────────────┼──────────────────┘
                                                          │ VNet private link
                                            ┌─────────────▼──────────────────┐
                                            │  PG Flexible Server             │
                                            │                                │
                                            │  scimdb                        │
                                            │  ├── ScimResource (CITEXT,     │
                                            │  │    JSONB, UUID, TIMESTAMPTZ)│
                                            │  ├── ResourceMember            │
                                            │  ├── Endpoint                  │
                                            │  └── _prisma_migrations        │
                                            │                                │
                                            │  Backup: automated daily       │
                                            │  Retention: 7 days (PITR)      │
                                            └────────────────────────────────┘
```

### Container Image Build Pipeline

```
GitHub Repository (pranems/SCIMServer)
│
├── Push to test/dev/feature/* branch
│   └── .github/workflows/build-test.yml
│       └── Builds & pushes: ghcr.io/pranems/scimserver:test-<branch>
│
└── Manual workflow_dispatch (version tag)
    └── .github/workflows/publish-ghcr.yml
        └── Builds & pushes: ghcr.io/pranems/scimserver:<version>
        └── Optionally tags: ghcr.io/pranems/scimserver:latest
```

---

## 2. Prerequisites

| Requirement | Details |
|---|---|
| **Azure CLI** | v2.50+ — Install: https://aka.ms/InstallAzureCLI |
| **Azure Subscription** | Active subscription with permission to create resources |
| **PowerShell** | Windows PowerShell 5.1+ or PowerShell 7+ (macOS/Linux) |
| **Resource Providers** | `Microsoft.App` and `Microsoft.ContainerService` (auto-registered by script) |

### Verify prerequisites

```powershell
# Check Azure CLI
az --version

# Login to Azure
az login

# Confirm subscription
az account show --query "{name:name, id:id}" --output table
```

---

## 3. Deployment Step-by-Step

### Option A: One-Liner Bootstrap (Recommended)

The simplest way — no git clone needed:

```powershell
iex (iwr https://raw.githubusercontent.com/pranems/SCIMServer/master/bootstrap.ps1).Content
```

This will:
1. Download `setup.ps1` from GitHub
2. Prompt for Resource Group, App Name, Region, and Secrets
3. Call `deploy-azure.ps1` internally
4. Print the deployment URL and all secrets

### Option B: Direct Script with Parameters

```powershell
# Clone the repo first
git clone https://github.com/pranems/SCIMServer.git
cd SCIMServer

# Deploy with explicit parameters
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-rg" `
  -AppName "scimserver-prod" `
  -Location "eastus" `
  -ScimSecret "MySecureToken123"
```

### Option C: Fully Automated (Non-Interactive)

```powershell
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-rg" `
  -AppName "scimserver-prod" `
  -Location "eastus" `
  -ScimSecret "MySecureToken123" `
  -JwtSecret "my-jwt-signing-key-64chars-long-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" `
  -OauthClientSecret "my-oauth-secret-64chars-long-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Deployment Parameters Reference

| Parameter | Required | Default | Description |
|---|---|---|---|
| `-ResourceGroup` | Yes (prompted) | — | Azure Resource Group name |
| `-AppName` | Yes (prompted) | — | Container App name (2-32 chars, lowercase, letters/numbers/hyphens) |
| `-Location` | No | `eastus` | Azure region |
| `-ScimSecret` | No (auto-gen) | `SCIM-<random>-<date>` | Bearer token for SCIM authentication |
| `-ImageTag` | No | `latest` | Docker image tag |
| `-JwtSecret` | No (auto-gen) | 64-char random | JWT signing secret |
| `-OauthClientSecret` | No (auto-gen) | 64-char random | OAuth client secret |
| `-PgAdminLogin` | No | `scimadmin` | PostgreSQL administrator login |
| `-PgAdminPassword` | No (auto-gen) | 32-char random | PostgreSQL administrator password |
| `-PgSkuName` | No | `Standard_B1ms` | PG Flexible Server SKU |
| `-PgStorageGB` | No | `32` | PG storage size in GB |

### What Happens During Deployment (6 Steps)

```
Step 1/6: Resource Group
  └── Creates or reuses the Azure Resource Group

Step 2/6: Network & Private DNS
  ├── Creates VNet (10.40.0.0/16) with 3 subnets
  ├── Creates Private DNS Zone (privatelink.postgres.database.azure.com)
  └── Links DNS zone to VNet

Step 3/6: PostgreSQL Flexible Server
  ├── Creates Azure PG Flexible Server (B1ms, PostgreSQL 17)
  ├── Enables extensions: citext, pgcrypto, pg_trgm
  ├── Creates database: scimdb
  ├── Configures VNet integration (private-endpoints subnet)
  └── Denies public network access

Step 4/6: Container App Environment
  ├── Creates Log Analytics Workspace (30-day retention)
  └── Creates Container Apps Environment (VNet-integrated)

Step 5/6: Container App
  ├── Pulls ghcr.io/pranems/scimserver:<tag>
  ├── Configures secret: database-url (PG connection string)
  ├── Configures secrets (SCIM, JWT, OAuth)
  ├── Sets environment: DATABASE_URL (from secret), PERSISTENCE_BACKEND=prisma
  ├── Sets maxReplicas: 3 (multi-replica scaling enabled)
  └── Configures HTTPS ingress (auto TLS)

Step 6/6: Finalize
  ├── Verifies PG connectivity from Container App
  ├── Confirms prisma migrate deploy ran successfully
  └── Prints deployment URL + all secrets
```

### Deployment Output

At the end of deployment, you'll see:

```
═══════════════════════════════════════════════════
🎉 Deployment Successful!
═══════════════════════════════════════════════════

📋 Deployment Summary:
   App URL: https://scimserver-prod.purplestone-xxxxx.eastus.azurecontainerapps.io
   SCIM Endpoint: https://scimserver-prod.purplestone-xxxxx.eastus.azurecontainerapps.io/scim/v2
   Resource Group: scimserver-rg
   SCIM Shared Secret: SCIM-12345-20260212
   JWT Secret: <64-char string>
   OAuth Client Secret: <64-char string>
```

> **IMPORTANT**: Copy and save all three secrets. They are not stored anywhere else.

### Quick Log Access from Deployment Output

The deploy script now prints copy/paste commands for these endpoints:

- `GET /scim/admin/log-config/recent?limit=25`
- `GET /scim/admin/log-config/stream?level=INFO`
- `GET /scim/admin/log-config/download?format=json`

Examples:

```powershell
curl "https://<your-app-url>/scim/admin/log-config/recent?limit=25" -H "Authorization: Bearer <your-secret>"
curl -N "https://<your-app-url>/scim/admin/log-config/stream?level=INFO" -H "Authorization: Bearer <your-secret>"
curl "https://<your-app-url>/scim/admin/log-config/download?format=json" -H "Authorization: Bearer <your-secret>" -o scim-logs.json
.\scripts\remote-logs.ps1 -Mode tail -BaseUrl https://<your-app-url>
```

---

## 4. What Gets Deployed

### Azure Resources Created

| Resource | Type | Purpose | Estimated Cost |
|---|---|---|---|
| **Resource Group** | `Microsoft.Resources/resourceGroups` | Container for all resources | Free |
| **Virtual Network** | `Microsoft.Network/virtualNetworks` | Network isolation | Free |
| **Private DNS Zone** | `Microsoft.Network/privateDnsZones` | PG Flexible Server private DNS | ~$0.50/mo |
| **PG Flexible Server** | `Microsoft.DBforPostgreSQL/flexibleServers` | Managed PostgreSQL 17 (B1ms) | ~$13–18/mo |
| **PG Private Endpoint** | VNet-integrated subnet | Secure PG access within VNet | Included |
| **Log Analytics** | `Microsoft.OperationalInsights/workspaces` | Container logs | ~$0–5/mo |
| **Container Apps Env** | `Microsoft.App/managedEnvironments` | Hosting platform | Included |
| **Container App** | `Microsoft.App/containerApps` | SCIMServer application | ~$5–15/mo |

### Container Configuration

- **Image**: `ghcr.io/pranems/scimserver:latest`
- **CPU**: 0.5 cores | **Memory**: 1 GiB
- **Replicas**: 1–3 (auto-scale — multi-replica enabled with PostgreSQL)
- **Port**: 80 (internal) → HTTPS (external, auto TLS)
- **Health check**: HTTP GET `/` every 30s
- **DATABASE_URL**: Injected from Container Apps secret (PG connection string)
- **Entrypoint**: `prisma migrate deploy` → `node dist/main.js`

### PostgreSQL Server Configuration

| Setting | Value |
|---|---|
| **SKU** | Burstable B1ms (1 vCore, 2 GB RAM) |
| **Storage** | 32 GB (auto-grow enabled) |
| **Version** | PostgreSQL 17 |
| **Extensions** | citext, pgcrypto, pg_trgm |
| **Database** | scimdb |
| **Backup** | Automated daily, 7-day retention, point-in-time restore |
| **Network** | VNet-integrated (private access only) |
| **TLS** | Enforced (sslmode=require) |

---

## 5. Post-Deployment Configuration

### Step 1: Verify SCIMServer is Running

Open the App URL in your browser. You should see the SCIMServer web dashboard:

```
https://<your-app>.purplestone-xxxxx.eastus.azurecontainerapps.io
```

### Step 2: Create an Endpoint

SCIMServer supports multiple isolated SCIM endpoints. Create one via the web UI or API:

```powershell
# Create an endpoint via API
$appUrl = "https://<your-app-url>"
$secret = "<your-scim-secret>"

Invoke-RestMethod -Uri "$appUrl/scim/admin/endpoints" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $secret"; "Content-Type" = "application/json" } `
  -Body '{"name": "entra-prod", "displayName": "Entra Production"}'
```

The response includes an `id` (e.g., `cmlfuqaft0002i30tlv47pq1f`) — this becomes part of your SCIM URL.

### Step 3: Configure Microsoft Entra ID

```
Entra Portal Flow:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Azure Portal → Microsoft Entra ID → Enterprise Applications
   └── + New Application → Create your own application
       └── "Integrate any other application" → Create

2. Your App → Provisioning → Get started
   └── Provisioning Mode: Automatic

3. Admin Credentials:
   ┌────────────────────────────────────────────────────────┐
   │ Tenant URL:    https://<your-app-url>/scim/v2          │
   │                                                        │
   │ Secret Token:  <your-scim-secret>                      │
   └────────────────────────────────────────────────────────┘

   If using multi-endpoint mode:
   ┌────────────────────────────────────────────────────────┐
   │ Tenant URL:    https://<your-app-url>/scim/endpoints/  │
   │                <endpoint-id>/                          │
   └────────────────────────────────────────────────────────┘

4. Click "Test Connection" → Expect ✅ success

5. Mappings: Configure user/group attribute mappings as needed

6. Settings:
   └── Provisioning Status: On
   └── Scope: Assign users/groups → Sync assigned only

7. Users and Groups → Assign users/groups to provision
```

### Step 4: Verify Provisioning

After turning provisioning ON:

1. **Assign a test user** to the Enterprise App
2. Wait for the provisioning cycle (~40 minutes for first full sync, or click "Provision on demand")
3. Open the SCIMServer web dashboard to see events in real-time
4. Check the Activity Feed for "User Created" events

---

## 6. Using the Application

### Web Dashboard

The web dashboard is available at your app URL (no `/scim` suffix):

```
https://<your-app-url>/
```

Features:
- **Activity Feed** — Real-time SCIM request/response log with human-readable translations
- **User Browser** — View all provisioned users and their attributes
- **Group Browser** — View groups and memberships
- **Database Stats** — User/group counts and database info
- **Endpoint Management** — Create/manage multiple SCIM endpoints
- **Backup Status** — View blob snapshot backup health
- **Log Configuration** — Adjust log levels dynamically
- **Dark/Light Theme** — Toggle via UI

### API Endpoints

#### Discovery (No Auth Required)

| Method | URL | Description |
|---|---|---|
| GET | `/scim/ServiceProviderConfig` | SCIM capabilities |
| GET | `/scim/ResourceTypes` | Supported resource types |
| GET | `/scim/Schemas` | SCIM schemas |

#### SCIM Operations (Bearer Auth)

| Method | URL | Description |
|---|---|---|
| POST | `/scim/endpoints/:id/Users` | Create user |
| GET | `/scim/endpoints/:id/Users` | List/filter users |
| GET | `/scim/endpoints/:id/Users/:id` | Get user by ID |
| PUT | `/scim/endpoints/:id/Users/:id` | Replace user |
| PATCH | `/scim/endpoints/:id/Users/:id` | Update user |
| DELETE | `/scim/endpoints/:id/Users/:id` | Delete user |
| POST | `/scim/endpoints/:id/Groups` | Create group |
| GET | `/scim/endpoints/:id/Groups` | List/filter groups |
| PATCH | `/scim/endpoints/:id/Groups/:id` | Update group |
| DELETE | `/scim/endpoints/:id/Groups/:id` | Delete group |

#### Admin API (Bearer Auth)

| Method | URL | Description |
|---|---|---|
| GET | `/scim/admin/endpoints` | List endpoints |
| POST | `/scim/admin/endpoints` | Create endpoint |
| GET | `/scim/admin/endpoints/:id` | Get endpoint |
| PATCH | `/scim/admin/endpoints/:id` | Update endpoint |
| DELETE | `/scim/admin/endpoints/:id` | Delete endpoint |
| GET | `/scim/admin/database/statistics` | DB stats |
| GET | `/scim/admin/database/users` | Browse users |
| GET | `/scim/admin/database/groups` | Browse groups |
| GET | `/scim/admin/logs` | View request logs |
| GET | `/scim/admin/backup/stats` | Backup status |
| POST | `/scim/admin/backup/trigger` | Trigger backup |
| GET | `/scim/admin/version` | App version info |

### Authentication

All SCIM and Admin requests require a Bearer token:

```
Authorization: Bearer <your-scim-secret>
```

Example:
```powershell
$headers = @{ Authorization = "Bearer SCIM-12345-20260212" }
Invoke-RestMethod -Uri "https://<your-app>/scim/admin/endpoints" -Headers $headers
```

### OAuth Token Endpoint

For OAuth2 client_credentials flow:

```powershell
$body = @{
  grant_type = "client_credentials"
  client_id = "scimserver"
  client_secret = "<your-oauth-client-secret>"
}
$token = Invoke-RestMethod -Uri "https://<your-app>/scim/oauth/token" -Method POST -Body $body
# Use $token.access_token for subsequent requests
```

---

## 7. Updating & Maintenance

### Update to New Version

When a new version notification appears in the web dashboard:

```powershell
# Auto-discovery (finds your RG and App automatically)
iex (irm 'https://raw.githubusercontent.com/pranems/SCIMServer/master/scripts/update-scimserver-func.ps1'); `
  Update-SCIMServer -Version v0.10.0

# Explicit (if multiple deployments)
Update-SCIMServer -Version v0.10.0 -ResourceGroup scimserver-rg -AppName scimserver-prod
```

### Manual Image Update

```powershell
az containerapp update `
  -n scimserver-prod `
  -g scimserver-rg `
  --image ghcr.io/pranems/scimserver:0.10.0
```

### View Logs

```powershell
# Stream live logs
az containerapp logs show -n scimserver-prod -g scimserver-rg --follow

# SCIMServer admin logs (recent ring buffer)
curl "https://<your-app>/scim/admin/log-config/recent?limit=25" -H "Authorization: Bearer <your-secret>"

# SCIMServer admin logs (live SSE stream)
curl -N "https://<your-app>/scim/admin/log-config/stream?level=INFO" -H "Authorization: Bearer <your-secret>"

# Query Log Analytics
az monitor log-analytics query `
  -w <workspace-id> `
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'scimserver-prod' | top 50 by TimeGenerated"
```

### Trigger Manual Backup

> **Phase 3 note:** With PostgreSQL Flexible Server, backups are automated by Azure
> (daily full + continuous WAL archiving, 7-day PITR). The legacy `backup/trigger`
> endpoint is still available but performs no useful action in PostgreSQL mode.
> Use Azure Portal → PG Flexible Server → Backups for restore operations.

---

## 8. Troubleshooting

| Issue | Diagnosis | Solution |
|---|---|---|
| **Test Connection fails** | Wrong URL or secret | Ensure URL ends with `/scim/v2` (or `/scim/endpoints/<id>/`); verify secret matches |
| **No events appear** | Provisioning not started | Turn provisioning ON in Entra; assign users/groups; wait for sync cycle |
| **Deploy script exits early** | Not authenticated | Run `az login` first |
| **Container won't start** | Image pull or crash | Check `az containerapp logs show -n <app> -g <rg>` |
| **Database errors (P2021)** | Migration not applied | Container entrypoint runs `prisma migrate deploy` automatically; check logs for errors |
| **PG connection refused** | VNet misconfiguration | Verify PG Flexible Server is in the same VNet/subnet; check private DNS zone link |
| **PG SSL error** | Missing sslmode | Ensure DATABASE_URL includes `?sslmode=require` |
| **PG extension error** | Extensions not enabled | Run: `az postgres flexible-server parameter set --name azure.extensions --value "citext,pgcrypto,pg_trgm"` |
| **PG out of storage** | Auto-grow may be off | Check storage usage in Azure Portal; enable storage auto-grow |
| **Slow queries** | Missing indexes | Check `ScimResource` table has CITEXT unique indexes on `userName` and `displayName` |
| **409 Conflict on user creation** | Duplicate userName/externalId | User already exists; Entra will PATCH instead |
| **Slow first response** | Container cold start | First request after scale-to-zero takes ~5-10s; subsequent requests are fast |
| **Multiple replicas out of sync** | Not a PG issue | All replicas share the same PG instance; data is always consistent |
| **PG backup/restore** | Need point-in-time restore | Azure Portal → PG Flexible Server → Backups → Restore to point in time |

---

## 9. Cost Estimate

| Resource | Monthly Cost |
|---|---|
| Container App (0.5 vCPU, 1 GiB) | ~$5–15 (scales to zero when idle) |
| PG Flexible Server (B1ms, 32 GB) | ~$13–18 |
| Log Analytics | ~$0–5 (depends on volume) |
| VNet / DNS | ~$0.50 |
| **Total** | **~$19–38/month** |

> **Phase 3 change:** Replaced Blob Storage (~$0.50) + Private Endpoint (~$7.50) with
> PG Flexible Server (~$13–18). Net increase ~$5–10/mo, offset by automated backups,
> multi-replica support, and zero data loss risk.

> Costs vary by region and usage. Container App scale-to-zero means minimal compute
> charges during idle periods. PG Flexible Server runs 24/7.

---

## 10. Security Notes

- **HTTPS only**: Auto-managed TLS certificate via Azure Container Apps
- **No public database access**: PG Flexible Server uses VNet integration — accessible only from within the VNet
- **VNet isolation**: All inter-service traffic (Container App ↔ PostgreSQL) stays within the virtual network
- **TLS enforced on database**: `sslmode=require` — all PG connections encrypted in transit
- **Secrets management**: DATABASE_URL, SCIM, JWT, and OAuth secrets stored as Container Apps secrets (encrypted at rest)
- **No hardcoded credentials**: All sensitive values are injected via environment variables from secrets
- **Automated backups**: PG Flexible Server provides daily automated backups with 7-day point-in-time restore
- **No storage keys**: Eliminated Blob Storage and Managed Identity role assignments — all persistence through PG connection string

---

## Quick Reference Card

```
┌──────────────────────────────────────────────────────────┐
│  SCIMServer Quick Reference                              │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Deploy:                                                 │
│  iex (iwr https://raw.githubusercontent.com/pranems/     │
│    SCIMServer/master/bootstrap.ps1).Content               │
│                                                          │
│  Web Dashboard:  https://<your-app-url>/                 │
│  SCIM Base:      https://<your-app-url>/scim/v2          │
│  Auth Header:    Authorization: Bearer <secret>          │
│                                                          │
│  Database:       Azure PG Flexible Server (B1ms)         │
│                  PostgreSQL 17 | VNet-private             │
│                  Extensions: citext, pgcrypto, pg_trgm   │
│                  Backup: automated daily, 7-day PITR     │
│                                                          │
│  Update:                                                 │
│  iex (irm '...update-scimserver-func.ps1');              │
│    Update-SCIMServer -Version v<new>                     │
│                                                          │
│  Logs:                                                   │
│  az containerapp logs show -n <app> -g <rg> --follow     │
│  curl .../scim/admin/log-config/recent?limit=25          │
│  curl -N .../scim/admin/log-config/stream?level=INFO     │
│                                                          │
│  GitHub:  https://github.com/pranems/SCIMServer          │
│  Image:   ghcr.io/pranems/scimserver:latest              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```
