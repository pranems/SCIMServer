# Storage & Backup Architecture

> **Status**: Active operational guide  
> **Last Updated**: February 18, 2026  
> **Baseline**: SCIMServer v0.10.0

> How SCIMServer persists data across container restarts using hybrid local + Azure Files storage.

---

## Architecture Overview

SCIMServer uses a **hybrid storage model** to combine SQLite performance with Azure Files persistence:

```
┌─────────────────────────────────────────────────────┐
│  Container Instance                                  │
│                                                      │
│  ┌──────────────────────────────┐                   │
│  │  SQLite Database (FAST)      │                   │
│  │  /tmp/local-data/scim.db     │                   │
│  │  ⚡ Ephemeral local storage   │                   │
│  └──────────┬───────────────────┘                   │
│             │ Every 5 minutes                        │
│             ▼                                        │
│  ┌──────────────────────────────┐                   │
│  │  Azure Files Backup          │                   │
│  │  /app/data/scim.db           │                   │
│  │  ☁️ Persistent across restarts│                   │
│  └──────────────────────────────┘                   │
│             │ Optional                               │
│             ▼                                        │
│  ┌──────────────────────────────┐                   │
│  │  Blob Snapshot (optional)    │                   │
│  │  Azure Blob Storage          │                   │
│  └──────────────────────────────┘                   │
└─────────────────────────────────────────────────────┘
```

### Why Not SQLite Directly on Azure Files?

Azure Files is **network storage** (SMB). Running SQLite directly on it causes:
- 100–1000× slower reads/writes vs local disk
- Broken SQLite lock files (`.db-journal`, `.db-shm`, `.db-wal`)
- Request timeouts and database corruption under concurrent access

The hybrid approach uses local disk for runtime (fast) and Azure Files only for backup (persistent).

---

## How It Works

### Container Startup

1. **`docker-entrypoint.sh`** runs before the app:
   - Checks for backup at `/app/data/scim.db` (Azure Files)
   - If found, copies to `/tmp/local-data/scim.db` (local)
   - Cleans stale lock files from Azure Files
   - Runs `npx prisma migrate deploy`
2. **App starts** using `DATABASE_URL=file:/tmp/local-data/scim.db` (fast local I/O)

### Runtime

- All SCIM requests hit the **local SQLite** database (microsecond latency)
- **BackupService** copies local → Azure Files every 5 minutes via cron
- Optional blob snapshots provide an additional backup tier

### Container Restart / Scale-to-Zero

1. Container stops → local storage is deleted
2. On next start, `docker-entrypoint.sh` restores from Azure Files backup
3. **Maximum data loss: 5 minutes** (time since last backup)

---

## Performance Comparison

| Metric | Azure Files (direct) | Hybrid (local + backup) |
|--------|---------------------|------------------------|
| Read Latency | 10–50 ms | 0.01–0.1 ms |
| Write Latency | 20–100 ms | 0.1–1 ms |
| Lock File Support | ❌ Unreliable | ✅ Native |
| Concurrent Access | ⚠️ Corruption risk | ✅ Safe |
| Data Persistence | ✅ Always | ✅ Via 5-min backup |

---

## Deployment

### With Persistent Storage (Default & Recommended)

```powershell
.\scripts\deploy-azure.ps1 `
    -ResourceGroup "scim-rg" `
    -AppName "scimserver" `
    -Location "eastus" `
    -ScimSecret "your-secure-secret"
```

This automatically provisions:
- Storage Account (Standard_LRS)
- SMB File Share (5 GiB)
- Volume mount to `/app/data`

### Add Storage to Existing Deployment

```powershell
.\scripts\add-persistent-storage.ps1 `
    -ResourceGroup "RG-FR-SCIMSERVER" `
    -AppName "scimserver-ms"
```

### Cost

| Component | Monthly Cost |
|-----------|-------------|
| Storage Account | ~$0.05 |
| File Share (5 GiB) | ~$0.30 |
| Transactions | ~$0.01 |
| **Total** | **~$0.36** |

---

## Multi-Environment Deployments

Azure Storage Account names must be **globally unique**. The deploy script generates unique names by combining the app name with the resource group name:

```
scimserverms + rgfrscimserver + stor → scimservermsrgfrscimserverstor
```

Truncated to 24 characters per Azure naming rules (lowercase, no hyphens).

---

## Important Considerations

| Aspect | Detail |
|--------|--------|
| **RPO** | Maximum 5 minutes of data loss if container crashes between backups |
| **Scaling** | Keep `maxReplicas: 1` — SQLite is single-writer only |
| **Backup failures** | Non-blocking — app continues running; logged as errors |
| **Zero data loss** | Requires migration to PostgreSQL/MySQL — see [SQLITE_COMPROMISE_ANALYSIS.md](SQLITE_COMPROMISE_ANALYSIS.md) for full roadmap |

---

## Key Source Files

| File | Purpose |
|------|---------|
| `api/docker-entrypoint.sh` | Startup script: restore → migrate → launch |
| `api/src/modules/backup/backup.service.ts` | Cron-based local → Azure Files backup |
| `infra/storage.bicep` | Azure Storage Account + File Share |
| `infra/containerapp.bicep` | Volume mount configuration |
| `scripts/deploy-azure.ps1` | Full deployment with storage provisioning |
| `scripts/add-persistent-storage.ps1` | Add storage to existing deployment |

---

> **Note**: The entire hybrid storage architecture is a SQLite compromise. A PostgreSQL
> migration eliminates the backup service, entrypoint restore logic, and Azure Storage
> infrastructure entirely. See [SQLITE_COMPROMISE_ANALYSIS.md](SQLITE_COMPROMISE_ANALYSIS.md)
> §3.3 and §3.6 for details.

*Consolidated from: persistent-storage-analysis, persistent-storage-implementation, HYBRID-STORAGE-FIX, PERSISTENCE-VERIFICATION, MIGRATION-GUIDE, MULTI-ENVIRONMENT-FIX*
