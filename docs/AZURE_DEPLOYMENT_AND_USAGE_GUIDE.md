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
                                                                  │
                                                     ┌────────────▼─────────────┐
                                                     │   SQLite (ephemeral)     │
                                                     │   /tmp/local-data/scim.db│
                                                     └────────────┬─────────────┘
                                                                  │ periodic
                                                                  │ snapshots
                                                     ┌────────────▼─────────────┐
                                                     │   Azure Blob Storage     │
                                                     │   (Private Endpoint)     │
                                                     │   SQLite backups         │
                                                     └──────────────────────────┘
```

### Azure Resource Architecture

```
Resource Group (e.g. scimserver-rg)
├── Virtual Network (10.40.0.0/16)
│   ├── aca-infra subnet        (10.40.0.0/21)   ← Container Apps Environment
│   ├── aca-runtime subnet      (10.40.8.0/21)   ← Container workloads
│   └── private-endpoints subnet(10.40.16.0/24)  ← Blob Storage PE
│
├── Private DNS Zone (privatelink.blob.core.windows.net)
│   └── VNet Link → Virtual Network
│
├── Container Apps Environment
│   └── Container App (SCIMServer)
│       ├── Image: ghcr.io/pranems/scimserver:latest
│       ├── Secrets: SCIM token, JWT, OAuth
│       ├── System-Assigned Managed Identity
│       └── Ingress: HTTPS (auto TLS cert)
│
├── Storage Account (private, no public access)
│   ├── Private Endpoint → private-endpoints subnet
│   └── Blob Container: scimserver-backups
│       └── SQLite snapshots (timestamped)
│
└── Log Analytics Workspace
    └── Container App logs & metrics
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
| `-BlobBackupAccount` | No | `<appname>backup` | Storage account name |
| `-BlobBackupContainer` | No | `scimserver-backups` | Blob container name |

### What Happens During Deployment (6 Steps)

```
Step 1/6: Resource Group
  └── Creates or reuses the Azure Resource Group

Step 2/6: Network & Private DNS
  ├── Creates VNet (10.40.0.0/16) with 3 subnets
  ├── Creates Private DNS Zone (privatelink.blob.core.windows.net)
  └── Links DNS zone to VNet

Step 3/6: Blob Storage (Private Endpoint)
  ├── Creates Storage Account (public access disabled)
  ├── Creates blob container for SQLite snapshots
  └── Creates Private Endpoint in VNet

Step 4/6: Container App Environment
  ├── Creates Log Analytics Workspace (30-day retention)
  └── Creates Container Apps Environment (VNet-integrated)

Step 5/6: Container App
  ├── Pulls ghcr.io/pranems/scimserver:<tag>
  ├── Configures secrets (SCIM, JWT, OAuth)
  ├── Sets environment variables
  ├── Enables System-Assigned Managed Identity
  └── Configures HTTPS ingress (auto TLS)

Step 6/6: Finalize
  ├── Assigns "Storage Blob Data Contributor" role to managed identity
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
| **Private DNS Zone** | `Microsoft.Network/privateDnsZones` | Blob private endpoint DNS | ~$0.50/mo |
| **Storage Account** | `Microsoft.Storage/storageAccounts` | SQLite snapshot backups | ~$0.20-0.50/mo |
| **Private Endpoint** | `Microsoft.Network/privateEndpoints` | Secure blob access | ~$7.50/mo |
| **Log Analytics** | `Microsoft.OperationalInsights/workspaces` | Container logs | ~$0-5/mo |
| **Container Apps Env** | `Microsoft.App/managedEnvironments` | Hosting platform | Included |
| **Container App** | `Microsoft.App/containerApps` | SCIMServer application | ~$5-15/mo |

### Container Configuration

- **Image**: `ghcr.io/pranems/scimserver:latest`
- **CPU**: 0.5 cores | **Memory**: 1 GiB
- **Replicas**: 1 (fixed — SQLite requires single replica; increase after migrating to PostgreSQL)
- **Port**: 80 (internal) → HTTPS (external, auto TLS)
- **Health check**: HTTP GET `/health` every 60s

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

```powershell
Invoke-RestMethod -Uri "https://<your-app>/scim/admin/backup/trigger" `
  -Method POST `
  -Headers @{ Authorization = "Bearer <your-secret>" }
```

---

## 8. Troubleshooting

| Issue | Diagnosis | Solution |
|---|---|---|
| **Test Connection fails** | Wrong URL or secret | Ensure URL ends with `/scim/v2` (or `/scim/endpoints/<id>/`); verify secret matches |
| **No events appear** | Provisioning not started | Turn provisioning ON in Entra; assign users/groups; wait for sync cycle |
| **Deploy script exits early** | Not authenticated | Run `az login` first |
| **Container won't start** | Image pull or crash | Check `az containerapp logs show -n <app> -g <rg>` |
| **Database errors (P2021)** | Migration not applied | Container entrypoint runs `prisma migrate deploy` automatically; check logs for errors |
| **Blob backup failures** | Role not assigned | Verify managed identity has `Storage Blob Data Contributor` on the storage account |
| **409 Conflict on user creation** | Duplicate userName/externalId | User already exists; Entra will PATCH instead |
| **Slow first response** | Container cold start | First request after scale-to-zero takes ~5-10s; subsequent requests are fast |

---

## 9. Cost Estimate

| Resource | Monthly Cost |
|---|---|
| Container App (0.5 vCPU, 1 GiB) | ~$5–15 (scales to zero when idle) |
| Blob Storage (snapshots) | ~$0.20–0.50 |
| Private Endpoint | ~$7.50 |
| Log Analytics | ~$0–5 (depends on volume) |
| VNet / DNS | ~$0.50 |
| **Total** | **~$13–28/month** |

> Costs vary by region and usage. Scale-to-zero means minimal charges during idle periods.

---

## 10. Security Notes

- **HTTPS only**: Auto-managed TLS certificate via Azure Container Apps
- **No public blob access**: Storage account uses private endpoint only
- **VNet isolation**: All inter-service traffic stays within the virtual network
- **Managed Identity**: Container uses system-assigned identity for blob access (no storage keys)
- **Secrets management**: SCIM, JWT, and OAuth secrets stored as Container Apps secrets (encrypted at rest)
- **No hardcoded credentials**: All sensitive values are injected via environment variables

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
