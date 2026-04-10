# SCIMServer — Sovereign & Government Cloud Deployment Guide

> **Version:** 0.34.0 · **Updated:** April 10, 2026  
> Covers: Azure Government (US), Azure China (21Vianet), Azure BLEU (France), Azure Germany, and custom sovereign environments

---

## Table of Contents

1. [Overview](#1-overview)
2. [Supported Sovereign Clouds](#2-supported-sovereign-clouds)
3. [Prerequisites](#3-prerequisites)
4. [Cloud Selection & Authentication](#4-cloud-selection--authentication)
5. [Deploying to Azure Government (US)](#5-deploying-to-azure-government-us)
6. [Deploying to Azure BLEU (France)](#6-deploying-to-azure-bleu-france)
7. [Deploying to Azure China (21Vianet)](#7-deploying-to-azure-china-21vianet)
8. [Deploying to Any Custom Cloud](#8-deploying-to-any-custom-cloud)
9. [Persistence Options (No PostgreSQL?)](#9-persistence-options-no-postgresql)
10. [Container Registry Considerations](#10-container-registry-considerations)
11. [Entra ID Provisioning in Sovereign Clouds](#11-entra-id-provisioning-in-sovereign-clouds)
12. [Network & Compliance](#12-network--compliance)
13. [Troubleshooting](#13-troubleshooting)
14. [Region Reference Tables](#14-region-reference-tables)
15. [Quick Reference Card](#15-quick-reference-card)

---

## 1. Overview

SCIMServer is a standard Docker container running on Azure Container Apps with PostgreSQL. Because it uses no proprietary Azure-only services (beyond Container Apps + PG Flexible Server), it deploys to **any Azure cloud environment** — including sovereign and government clouds — with only two adjustments:

1. **Set the correct Azure cloud** (`az cloud set`)
2. **Choose an available region** within that cloud
3. **(Optional)** Mirror the container image to a registry accessible from that cloud

Everything else — the Bicep templates, deploy script, VNet isolation, and PostgreSQL configuration — works identically.

---

## 2. Supported Sovereign Clouds

| Cloud | Azure CLI Name | Portal URL | Entra ID | Key Regions |
|-------|----------------|------------|----------|-------------|
| **Azure Public** | `AzureCloud` | portal.azure.com | login.microsoftonline.com | eastus, westeurope, etc. |
| **Azure Government (US)** | `AzureUSGovernment` | portal.azure.us | login.microsoftonline.us | usgovvirginia, usgovarizona, usgovtexas |
| **Azure China (21Vianet)** | `AzureChinaCloud` | portal.azure.cn | login.chinacloudapi.cn | chinanorth3, chinaeast3 |
| **Azure Germany** | `AzureGermanCloud` | — (migrated) | — | germanywestcentral (now on AzureCloud) |
| **Azure BLEU (France)** | See [Section 6](#6-deploying-to-azure-bleu-france) | bleu.azure.com | Separate tenant | francesouth, francecentral |

> **Note:** Azure Germany (legacy) has been mostly migrated to standard `AzureCloud` regions (`germanywestcentral`, `germanynorth`). New deployments should use `AzureCloud` with a German region.

---

## 3. Prerequisites

Same as the standard deployment, plus:

| Requirement | Details |
|---|---|
| **Azure CLI** | v2.50+ with sovereign cloud support |
| **Cloud-specific subscription** | Active subscription in the target sovereign cloud |
| **Appropriate clearance** | Gov/BLEU clouds require organizational approval |
| **Container image** | `ghcr.io/pranems/scimserver` (or mirrored to an accessible registry) |
| **Repo clone** | Clone SCIMServer from a machine with GitHub access (see below) |

### Why One-Liners Don't Work in Sovereign Clouds

The standard deployment one-liners (`bootstrap.ps1`, `deploy.ps1`) download scripts from `raw.githubusercontent.com` at runtime. In sovereign/gov clouds, this domain is typically **blocked or unreachable**:

| Cloud | `raw.githubusercontent.com` | `ghcr.io` | One-liners work? |
|-------|---------------------------|-----------|------------------|
| Azure Public | ✅ | ✅ | ✅ Yes |
| Azure Government | Usually ✅ | Usually ✅ | Likely yes |
| Azure China (21Vianet) | ❌ Blocked | ❌ Blocked | ❌ No |
| Azure BLEU (France) | ❌ Likely blocked | ❌ Likely blocked | ❌ No |
| Air-gapped | ❌ No internet | ❌ No internet | ❌ No |

### Recommended: Clone + Direct Deploy

```powershell
# From a machine with GitHub access:
git clone https://github.com/pranems/SCIMServer.git

# Transfer the cloned folder to your sovereign cloud machine, then:
cd SCIMServer
az cloud set --name AzureUSGovernment   # or AzureChinaCloud, etc.
az login

.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-rg" `
  -AppName "scimserver" `
  -Location "usgovvirginia" `
  -ProvisionPostgres
```

> No `pranems` credentials or GitHub access tokens are needed. The repo is public (MIT licensed). The deploy script auto-reads the image tag from `api/package.json` and pulls from `ghcr.io`. If `ghcr.io` is blocked, mirror the image to ACR first (see [Section 10](#10-container-registry-considerations)).

### Verify Azure CLI Cloud Support

```powershell
# List all registered clouds
az cloud list --query "[].name" --output table

# Current active cloud
az cloud show --query name --output tsv
```

---

## 4. Cloud Selection & Authentication

### Step 1: Set the Target Cloud

```powershell
# Azure Government (US)
az cloud set --name AzureUSGovernment

# Azure China (21Vianet)
az cloud set --name AzureChinaCloud

# Azure Public (default — to switch back)
az cloud set --name AzureCloud
```

### Step 2: Login to the Sovereign Cloud

```powershell
# Interactive browser login
az login

# Device code login (for headless environments)
az login --use-device-code

# Service principal login (CI/CD)
az login --service-principal -u <app-id> -p <secret> --tenant <tenant-id>
```

### Step 3: Select Subscription

```powershell
az account list --output table
az account set --subscription "<subscription-name-or-id>"
```

> After `az cloud set`, all subsequent `az` commands target that cloud's endpoints automatically.

---

## 5. Deploying to Azure Government (US)

Azure Government (`AzureUSGovernment`) is the most mature sovereign cloud with full Container Apps and PostgreSQL Flexible Server support.

### Available Regions

| Region | CLI Name | Container Apps | PG Flexible Server |
|--------|----------|----------------|---------------------|
| US Gov Virginia | `usgovvirginia` | ✅ | ✅ |
| US Gov Arizona | `usgovarizona` | ✅ | ✅ |
| US Gov Texas | `usgovtexas` | ✅ | ✅ |

### Deployment Steps

```powershell
# 1. Set cloud
az cloud set --name AzureUSGovernment
az login

# 2. Deploy (same script, different region)
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-gov-rg" `
  -AppName "scimserver-gov" `
  -Location "usgovvirginia" `
  -ProvisionPostgres `
  -ScimSecret "MySecureGovToken"
```

### Key Differences from Public Azure

| Aspect | Public Azure | Azure Government |
|--------|-------------|------------------|
| **Portal** | portal.azure.com | portal.azure.us |
| **Container image** | ghcr.io accessible | May need ACR mirror (see [Section 9](#9-container-registry-considerations)) |
| **Entra ID** | login.microsoftonline.com | login.microsoftonline.us |
| **DNS suffix** | `.azurecontainerapps.io` | `.azurecontainerapps.us` |
| **PG DNS** | `.postgres.database.azure.com` | `.postgres.database.usgovcloudapi.net` |

### Endpoint URL Format

```
https://scimserver-gov.<env-hash>.usgovvirginia.azurecontainerapps.us
```

---

## 6. Deploying to Azure BLEU (France)

Azure BLEU is a sovereign cloud operated by Bleu (a joint venture of Capgemini and Orange) for French government and critical infrastructure. It provides data sovereignty guarantees within French borders.

### Important Considerations

- BLEU uses a **separate Azure environment** with its own portal (`bleu.azure.com`)
- Access requires **French government entity status** or contractor approval
- It has its own **identity provider** (not standard Entra ID)
- Service availability may differ from public Azure

### Pre-Deployment Checklist

1. **Obtain BLEU subscription** through your organization's procurement
2. **Verify service availability**: Container Apps and PostgreSQL Flexible Server support in BLEU
3. **Container image**: ghcr.io is likely not accessible — mirror to BLEU's ACR (see [Section 9](#9-container-registry-considerations))
4. **Network requirements**: BLEU may have stricter network isolation requirements

### Deployment Steps

```powershell
# 1. Register the BLEU cloud (if not already in az cloud list)
az cloud register --name AzureBLEU `
  --endpoint-active-directory "https://login.bleu.azure.com" `
  --endpoint-resource-manager "https://management.bleu.azure.com" `
  --endpoint-gallery "https://gallery.bleu.azure.com" `
  --suffix-storage-endpoint "core.bleu.azure.com" `
  --suffix-keyvault-dns "vault.bleu.azure.com"

# 2. Set and login
az cloud set --name AzureBLEU
az login

# 3. Create ACR and import image (ghcr.io likely blocked)
az acr create -n scimserverbleu -g scimserver-bleu-rg --sku Basic -l francecentral
# Import from a machine with internet access, or push from local Docker
docker pull ghcr.io/pranems/scimserver:latest
docker tag ghcr.io/pranems/scimserver:latest scimserverbleu.azurecr.io/scimserver:latest
az acr login -n scimserverbleu
docker push scimserverbleu.azurecr.io/scimserver:latest

# 4. Deploy with BYO database (or provision PG if available)
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-bleu-rg" `
  -AppName "scimserver-bleu" `
  -Location "francecentral" `
  -ProvisionPostgres `
  -ScimSecret "MySecureBLEUToken"
```

### Alternative: BYO PostgreSQL for BLEU

If PostgreSQL Flexible Server is not available in BLEU, you can use a self-managed PostgreSQL instance:

```powershell
# Deploy with an existing PostgreSQL connection string
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-bleu-rg" `
  -AppName "scimserver-bleu" `
  -Location "francecentral" `
  -DatabaseUrl "postgresql://scimadmin:password@my-pg-host:5432/scimdb?sslmode=require"
```

### Alternative: In-Memory Mode for BLEU (No Database)

For evaluation or when no PostgreSQL is available at all:

```powershell
docker run -d -p 8080:8080 \
  -e PERSISTENCE_BACKEND=inmemory \
  -e JWT_SECRET=changeme \
  -e SCIM_SHARED_SECRET=changeme \
  -e OAUTH_CLIENT_SECRET=changeme \
  ghcr.io/pranems/scimserver:latest
```

> Data lives in memory only. See [Section 9](#9-persistence-options-no-postgresql) for all persistence options.

### BLEU-Specific Data Sovereignty Notes

- All data (SCIM resources, logs, credentials) stays within the BLEU boundary
- PostgreSQL data is stored in French data centers only
- VNet isolation ensures no data leaves the BLEU network perimeter
- Audit logs available via BLEU's Log Analytics equivalent

---

## 7. Deploying to Azure China (21Vianet)

Azure China is operated by 21Vianet and is a physically separate cloud.

### Available Regions

| Region | CLI Name | Container Apps | PG Flexible |
|--------|----------|----------------|-------------|
| China North 3 | `chinanorth3` | ✅ | ✅ |
| China East 3 | `chinaeast3` | ✅ | ✅ |

### Deployment Steps

```powershell
# 1. Set cloud
az cloud set --name AzureChinaCloud
az login

# 2. Mirror image to China ACR (ghcr.io is blocked in China)
az acr create -n scimservercn -g scimserver-cn-rg --sku Basic -l chinanorth3
# From a machine with internet access:
docker pull ghcr.io/pranems/scimserver:latest
docker tag ghcr.io/pranems/scimserver:latest scimservercn.azurecr.cn/scimserver:latest
az acr login -n scimservercn
docker push scimservercn.azurecr.cn/scimserver:latest

# 3. Deploy
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-cn-rg" `
  -AppName "scimserver-cn" `
  -Location "chinanorth3" `
  -ProvisionPostgres
```

### Key Differences

| Aspect | Public Azure | Azure China |
|--------|-------------|-------------|
| **Portal** | portal.azure.com | portal.azure.cn |
| **ACR suffix** | `.azurecr.io` | `.azurecr.cn` |
| **ghcr.io** | Accessible | **Blocked** — must mirror to ACR |
| **Entra ID** | login.microsoftonline.com | login.chinacloudapi.cn |

---

## 8. Deploying to Any Custom Cloud

For custom or private Azure Stack Hub / Azure Stack HCI environments:

```powershell
# Register custom cloud
az cloud register --name MyPrivateCloud `
  --endpoint-active-directory "https://login.mycloud.example.com" `
  --endpoint-resource-manager "https://management.mycloud.example.com"

# Set and deploy
az cloud set --name MyPrivateCloud
az login

.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-private-rg" `
  -AppName "scimserver" `
  -Location "myregion1" `
  -DatabaseUrl "postgresql://user:pass@my-pg:5432/scimdb?sslmode=require"
```

For environments where Container Apps is not available, you can run SCIMServer as a standard Docker container:

```powershell
# Any Docker host / Kubernetes cluster
docker run -d -p 8080:8080 \
  -e PERSISTENCE_BACKEND=inmemory \
  -e JWT_SECRET=changeme \
  -e SCIM_SHARED_SECRET=changeme \
  -e OAUTH_CLIENT_SECRET=changeme \
  ghcr.io/pranems/scimserver:latest
```

Or with PostgreSQL:

```powershell
docker run -d -p 8080:8080 \
  -e DATABASE_URL="postgresql://user:pass@pg-host:5432/scimdb?sslmode=require" \
  -e PERSISTENCE_BACKEND=prisma \
  -e JWT_SECRET=changeme \
  -e SCIM_SHARED_SECRET=changeme \
  -e OAUTH_CLIENT_SECRET=changeme \
  ghcr.io/pranems/scimserver:latest
```

---

## 9. Persistence Options (No PostgreSQL?)

SCIMServer supports **three persistence modes**. If your sovereign cloud doesn't have Azure PostgreSQL Flexible Server available — or you simply want to get running quickly before setting up a database — you have options.

### Option A: In-Memory Mode (Fastest Start — No Database Required)

Set `PERSISTENCE_BACKEND=inmemory` and SCIMServer runs entirely without a database. All data lives in memory and is lost when the container restarts. This is ideal for:

- **Initial evaluation & demos** in a new cloud environment
- **CI/CD pipelines** and integration testing
- **Quick proof-of-concept** before provisioning database infrastructure
- **Air-gapped or restricted environments** where managed databases aren't available yet

#### Azure Container Apps (in-memory)

```powershell
# Deploy without -ProvisionPostgres and without -DatabaseUrl
# The deploy script will prompt — choose option [1] and provide a dummy DATABASE_URL
# Then override via Container App env var:

az containerapp update -n scimserver-gov -g scimserver-gov-rg \
  --set-env-vars "PERSISTENCE_BACKEND=inmemory"
```

Or run directly via Docker:

```powershell
docker run -d -p 8080:8080 \
  -e PERSISTENCE_BACKEND=inmemory \
  -e JWT_SECRET=changeme \
  -e SCIM_SHARED_SECRET=changeme \
  -e OAUTH_CLIENT_SECRET=changeme \
  ghcr.io/pranems/scimserver:latest
```

> **Important:** In-memory mode produces identical API behavior and passes all ~4,970 tests. The only difference is data does not survive container restarts.

### Option B: Docker Compose with Self-Managed PostgreSQL

If the sovereign cloud supports containers but not managed PostgreSQL, run PostgreSQL as a sidecar container:

```yaml
# docker-compose.yml
version: '3.8'
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
      interval: 5s
      timeout: 3s
      retries: 5

  scimserver:
    image: ghcr.io/pranems/scimserver:latest  # or your mirrored ACR image
    ports:
      - "8080:8080"
    environment:
      PORT: 8080
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
      PERSISTENCE_BACKEND: prisma
      JWT_SECRET: changeme
      SCIM_SHARED_SECRET: changeme
      OAUTH_CLIENT_SECRET: changeme
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

```powershell
docker compose up -d
```

> This gives you full PostgreSQL persistence without any managed database service. Works on any Docker host or Kubernetes cluster.

### Option C: Provision Azure PostgreSQL Flexible Server (Recommended for Production)

If the sovereign cloud supports Azure Database for PostgreSQL Flexible Server, the deploy script handles everything:

```powershell
.\ scripts\deploy-azure.ps1 \
  -ResourceGroup "scimserver-rg" \
  -AppName "scimserver" \
  -Location "usgovvirginia" \
  -ProvisionPostgres              # Auto-provisions PG Flexible Server
```

This creates a B1ms instance (~$15-25/mo) with automated daily backups, 7-day PITR, VNet integration, and SSL enforcement.

### Option D: BYO PostgreSQL (Any External Database)

Connect to any PostgreSQL 14+ instance — cloud-managed, self-hosted, or on-premises:

```powershell
.\ scripts\deploy-azure.ps1 \
  -ResourceGroup "scimserver-rg" \
  -AppName "scimserver" \
  -Location "usgovvirginia" \
  -DatabaseUrl "postgresql://user:pass@my-pg-host:5432/scimdb?sslmode=require"
```

### Comparison

| Mode | Setup Time | Data Persistence | Cost | Best For |
|------|-----------|-----------------|------|----------|
| **In-memory** | Instant | None (lost on restart) | $0 | Evaluation, demos, CI/CD |
| **Docker Compose PG** | 5 min | Volume-backed | Infra cost | Self-hosted, air-gapped |
| **Azure PG Flex** | 10 min | Azure-managed backup | ~$15-25/mo | Production |
| **BYO PostgreSQL** | 5 min | Your responsibility | Varies | Existing DB infrastructure |

---

## 10. Container Registry Considerations

### Problem

`ghcr.io/pranems/scimserver` is hosted on GitHub Container Registry. In sovereign/gov clouds, ghcr.io may be:
- **Accessible** (Azure Government typically allows it)
- **Blocked or unreliable** (Azure China, BLEU, air-gapped environments)

### Solution: Mirror to Azure Container Registry (ACR)

```powershell
# Step 1: Pull on a machine with internet access
docker pull ghcr.io/pranems/scimserver:latest

# Step 2: Create ACR in your sovereign cloud
az acr create -n scimserveracr -g scimserver-rg --sku Basic -l <region>

# Step 3: Tag and push
docker tag ghcr.io/pranems/scimserver:latest scimserveracr.azurecr.io/scimserver:latest
az acr login -n scimserveracr
docker push scimserveracr.azurecr.io/scimserver:latest
```

### ACR Import (Faster Alternative)

If the sovereign cloud allows outbound internet to ghcr.io:

```powershell
az acr import \
  --name scimserveracr \
  --source ghcr.io/pranems/scimserver:latest \
  --image scimserver:latest
```

### Using ACR with the Deploy Script

The deploy script defaults to `ghcr.io`. For sovereign clouds using ACR, modify the Bicep parameter:

```powershell
# The deploy script passes acrLoginServer=ghcr.io by default.
# For ACR, update the containerapp deployment manually:

az deployment group create `
  --resource-group scimserver-gov-rg `
  --template-file infra/containerapp.bicep `
  --parameters `
    appName=scimserver-gov `
    environmentName=scimserver-gov-env `
    acrLoginServer=scimserveracr.azurecr.io `
    image=scimserver:latest `
    scimSharedSecret=<secret> `
    jwtSecret=<jwt> `
    oauthClientSecret=<oauth> `
    databaseUrl=<pg-url>
```

---

## 11. Entra ID Provisioning in Sovereign Clouds

### Azure Government

Entra ID in Azure Government uses different endpoints:

| Setting | Value |
|---------|-------|
| **Entra Portal** | entra.microsoft.us |
| **Token Endpoint** | login.microsoftonline.us/{tenant}/oauth2/v2.0/token |
| **SCIM Tenant URL** | `https://scimserver-gov.<hash>.usgovvirginia.azurecontainerapps.us/scim/v2` |

The Entra provisioning configuration is otherwise identical:

1. Enterprise Applications → New Application → "Integrate any other application"
2. Provisioning → Mode: Automatic
3. Tenant URL: your SCIMServer URL (with `/scim/v2` suffix)
4. Secret Token: your SCIM shared secret
5. Test Connection → Start Provisioning

### Azure China

- China uses Azure AD operated by 21Vianet (not Microsoft Entra ID)
- Provisioning configuration flow is similar but through the China portal
- Some provisioning features may have different availability timelines

### Azure BLEU

- BLEU has its own identity system
- Provisioning integration depends on the BLEU Entra equivalent
- Consult BLEU documentation for enterprise app provisioning setup

---

## 12. Network & Compliance

### Data Residency

SCIMServer stores data in two locations:
1. **PostgreSQL** — All SCIM resources (users, groups, memberships, credentials, logs)
2. **Container memory** — Transient request processing only (no persistent state in memory besides in-memory mode)

When deployed to a sovereign cloud:
- PostgreSQL data resides **only** in the selected region
- Container App runs **only** in the selected region
- VNet ensures all traffic stays within the cloud boundary
- No data is transmitted outside the sovereign cloud perimeter

### Compliance Key Points

| Requirement | How SCIMServer Meets It |
|---|---|
| **Data residency** | PG + Container in same region; VNet private link |
| **Encryption at rest** | Azure PG Flexible Server uses AES-256 (default) |
| **Encryption in transit** | TLS 1.2+ enforced (Container Apps auto-TLS + PG sslmode=require) |
| **No external calls** | SCIMServer makes zero outbound calls (no telemetry, no phoning home) |
| **Audit trail** | All SCIM operations logged to RequestLog table + Log Analytics |
| **Secret management** | Secrets stored as Container Apps secrets (encrypted at rest) |

### Air-Gapped Deployments

For fully air-gapped environments:

1. Mirror the container image to an internal registry
2. Use BYO PostgreSQL (self-managed)
3. Run via Docker or Kubernetes instead of Container Apps

```powershell
# Minimal air-gapped deployment (no cloud dependency)
docker run -d -p 8080:8080 \
  -e PERSISTENCE_BACKEND=inmemory \
  -e JWT_SECRET=changeme \
  -e SCIM_SHARED_SECRET=changeme \
  -e OAUTH_CLIENT_SECRET=changeme \
  internal-registry.example.com/scimserver:latest
```

---

## 13. Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `az cloud set` fails | Cloud not registered | Run `az cloud register` with correct endpoints |
| Image pull fails | ghcr.io blocked in sovereign cloud | Mirror image to ACR in the same cloud (Section 9) |
| PG not available in region | Not all regions support PG Flex | Use `-PgLocation` parameter to deploy PG in a different region within the same cloud |
| DNS resolution fails | Private DNS zone not linked | Ensure DNS zone is linked to the VNet |
| Authentication loop | Wrong Entra endpoint | Verify `az cloud show` returns correct AD endpoint |
| Resource provider not available | Container Apps not GA in region | Check `az provider list` and try a different region |
| Bicep template error | API version not available in cloud | Check resource API version availability for the sovereign cloud |

### PG in a Different Region (Quota Workaround)

If PostgreSQL Flexible Server is not available in your preferred region:

```powershell
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-gov-rg" `
  -AppName "scimserver-gov" `
  -Location "usgovvirginia" `
  -ProvisionPostgres `
  -PgLocation "usgovarizona"
```

---

## 14. Region Reference Tables

### Azure Government Regions

| Region | Location | Container Apps | PG Flex | Recommended |
|--------|----------|----------------|---------|-------------|
| US Gov Virginia | usgovvirginia | ✅ | ✅ | ✅ Primary |
| US Gov Arizona | usgovarizona | ✅ | ✅ | Backup |
| US Gov Texas | usgovtexas | ✅ | ✅ | Backup |
| US DoD Central | usdodcentral | Check | Check | IL5/IL6 only |
| US DoD East | usdodeast | Check | Check | IL5/IL6 only |

### Azure China Regions

| Region | Location | Container Apps | PG Flex |
|--------|----------|----------------|---------|
| China North 3 | chinanorth3 | ✅ | ✅ |
| China East 3 | chinaeast3 | ✅ | ✅ |
| China North 2 | chinanorth2 | Check | ✅ |
| China East 2 | chinaeast2 | Check | ✅ |

### France Regions (Public Cloud)

For French organizations that don't require BLEU but need French data residency:

| Region | Location | Container Apps | PG Flex |
|--------|----------|----------------|---------|
| France Central | francecentral | ✅ | ✅ |
| France South | francesouth | Check | Check |

```powershell
# Deploy to France Central on public Azure (not BLEU)
az cloud set --name AzureCloud
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "scimserver-fr-rg" `
  -AppName "scimserver-fr" `
  -Location "francecentral" `
  -ProvisionPostgres
```

---

## 15. Quick Reference Card

```
┌──────────────────────────────────────────────────────────────┐
│  SCIMServer Sovereign Cloud Quick Reference                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Set cloud:                                               │
│     az cloud set --name AzureUSGovernment                    │
│     az cloud set --name AzureChinaCloud                      │
│     az cloud set --name AzureCloud  # (back to public)       │
│                                                              │
│  2. Login:                                                   │
│     az login                                                 │
│                                                              │
│  3. Deploy:                                                  │
│     .\scripts\deploy-azure.ps1 `                             │
│       -Location "usgovvirginia" `                            │
│       -ResourceGroup "rg-name" `                             │
│       -AppName "app-name" `                                  │
│       -ProvisionPostgres                                     │
│                                                              │
│  Mirror image (if ghcr.io blocked):                          │
│     docker pull ghcr.io/pranems/scimserver:latest            │
│     docker tag ... <acr>.azurecr.io/scimserver:latest        │
│     docker push <acr>.azurecr.io/scimserver:latest           │
│                                                              │
│  Air-gapped (no cloud):                                      │
│     docker run -p 8080:8080 -e PERSISTENCE_BACKEND=inmemory  │
│       -e JWT_SECRET=... -e SCIM_SHARED_SECRET=...            │
│       -e OAUTH_CLIENT_SECRET=... scimserver:latest           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## See Also

- [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) — Standard Azure deployment guide
- [DEPLOYMENT.md](../DEPLOYMENT.md) — All deployment options comparison
- [DOCKER_GUIDE_AND_TEST_REPORT.md](DOCKER_GUIDE_AND_TEST_REPORT.md) — Docker deployment details
- [README.md](../README.md) — Quick start and overview
