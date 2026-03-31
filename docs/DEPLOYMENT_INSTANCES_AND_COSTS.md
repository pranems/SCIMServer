# Deployment Instances, Costs & Load Analysis

> **Last Updated:** 2026-03-31 | **Version:** 0.31.0 | **Branch:** `feat/torfc1stscimsvr`  
> **Status:** Living Document — Updated after each validation pipeline run

### Related Docs (avoid duplication — this doc is the canonical source for costs & load)
- **Setup procedures:** [DEPLOYMENT.md](../DEPLOYMENT.md) (all deployment methods), [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) (Azure step-by-step)
- **Docker details:** [DOCKER_GUIDE_AND_TEST_REPORT.md](DOCKER_GUIDE_AND_TEST_REPORT.md) (Dockerfile, entrypoint, build stages)
- **Azure troubleshooting:** [AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md](AZURE_DEPLOYMENT_ISSUES_AND_FIXES.md) (historical issue resolutions)
- **Project stats:** [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md) (codebase stats, architecture, test methodology)

---

## Latest Validation Pipeline Results

| Phase | Scope | Passed | Failed | Total | Duration |
|-------|-------|--------|--------|-------|----------|
| Unit Tests | 73 suites | 2,906 | 0 | 2,906 | ~58s |
| E2E Tests | 33 suites | 698 | 0 | 698 | ~38s |
| Local Live | port 6000 | 621 | 0 | 621 | ~15s |
| Docker Live | port 8080 | 621 | 0 | 621 | ~19s |
| Azure Live | Azure Container App | 621 | 0 | 621 | ~54s |

**Total: ~4,225 tests (3,604 unit+E2E passed + 621 live assertions per instance, triplicated across 3 deployment types).**

> All live test failures from v0.28.0 have been resolved in v0.29.0 (19 test fixes: URN dot-split, profile-aware schema, Content-Type 415 middleware).

---

## Running Instances

### 1. Local Instance (port 6000)

| Property | Value |
|----------|-------|
| Base URL | `http://localhost:6000/scim` |
| Health | `http://localhost:6000/scim/health` |
| Discovery | `http://localhost:6000/scim/ServiceProviderConfig` (public, no auth) |
| Persistence | InMemory (`PERSISTENCE_BACKEND=inmemory`) |
| OAuth Secret | `localoauthsecret123` |
| Shared Secret | `local-secret` |
| JWT Secret | `localjwtsecret123` |
| Cost | **$0** (local machine) |

**Auth token:**
```powershell
$token = (Invoke-RestMethod -Method POST -Uri "http://localhost:6000/scim/auth/token" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "client_id=scimclient&client_secret=localoauthsecret123&grant_type=client_credentials").access_token
$headers = @{ Authorization = "Bearer $token" }
```

### 2. Docker Instance (port 8080)

| Property | Value |
|----------|-------|
| Base URL | `http://localhost:8080/scim` |
| Health | `http://localhost:8080/scim/health` |
| Discovery | `http://localhost:8080/scim/ServiceProviderConfig` (public, no auth) |
| Containers | `scimserver-api` (healthy) + `scimserver-postgres` (healthy) |
| Persistence | PostgreSQL via Prisma (containerized) |
| OAuth Secret | `devscimclientsecret` |
| Shared Secret | `devscimsharedsecret` |
| JWT Secret | `devjwtsecretkey123456` |
| Cost | **$0** (local Docker Desktop) |

**Manage:**
```powershell
docker compose ps                        # Status
docker compose logs --tail 30 api        # Logs
docker compose down                      # Stop
docker compose up -d                     # Start
```

### 3. Azure Instance

| Property | Value |
|----------|-------|
| Base URL | `https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io/scim` |
| Health | `https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io/scim/health` |
| Discovery | `https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io/scim/ServiceProviderConfig` |
| Image | `ghcr.io/pranems/scimserver:0.29.0` |
| Resource | `scimserver2` in `scimserver-rg` (East US) |
| Persistence | Azure PostgreSQL (`scimserver2-pg.postgres.database.azure.com`) |
| OAuth Secret | `changeme-oauth` |
| Shared Secret | `changeme-scim` |
| JWT Secret | `changeme-jwt` |

**Manage:**
```powershell
az containerapp show -n scimserver2 -g scimserver-rg -o table
az containerapp logs show -n scimserver2 -g scimserver-rg --tail 30
```

---

## Credentials Reference

| Credential | Local | Docker | Azure |
|------------|-------|--------|-------|
| OAuth Client Secret | `localoauthsecret123` | `devscimclientsecret` | `changeme-oauth` |
| Shared Secret | `local-secret` | `devscimsharedsecret` | `changeme-scim` |
| JWT Secret | `localjwtsecret123` | `devjwtsecretkey123456` | `changeme-jwt` |
| Port | 6000 | 8080 | 443 (HTTPS) |

---

## Quick Live Test Commands

```powershell
# Local
.\scripts\live-test.ps1 -BaseUrl "http://localhost:6000" -ClientSecret "changeme-oauth"

# Docker
.\scripts\live-test.ps1 -BaseUrl "http://localhost:8080" -ClientSecret "devscimclientsecret"

# Azure
.\scripts\live-test.ps1 -BaseUrl "https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io" -ClientSecret "changeme-oauth"
```

---

## Azure Cost Breakdown — Current (Idle/Light Use)

### Provisioned Resources

| Resource | Type | SKU/Tier | Specs | Est. $/Month | Est. $/Day |
|----------|------|----------|-------|--------------|------------|
| scimserver2 | Container App | Consumption | 0.5 vCPU, 1 GiB, 1 replica always-on | ~$14–18 | ~$0.50 |
| scimserver2-pg | PostgreSQL Flex | Burstable B1ms | 1 vCore, 2 GiB RAM, 128 GiB storage | ~$40 | ~$1.35 |
| scimserver2-env | Container Apps Env | Consumption | Shared infra | $0 | $0 |
| scimserver2-logs | Log Analytics | Pay-per-GB | Minimal ingestion | ~$1–3 | ~$0.05 |
| **TOTAL (idle)** | | | | **~$55–61/mo** | **~$1.90/day** |

### Cost Control Commands

```powershell
# PAUSE (stop ~95% of billing):
az containerapp update -n scimserver2 -g scimserver-rg --min-replicas 0 --max-replicas 0
az postgres flexible-server stop -n scimserver2-pg -g scimserver-rg

# RESUME:
az containerapp update -n scimserver2 -g scimserver-rg --min-replicas 1 --max-replicas 1
az postgres flexible-server start -n scimserver2-pg -g scimserver-rg

# DELETE everything (stop all costs):
az group delete -n scimserver-rg --yes --no-wait
```

---

## Load Scenario Definitions

| Scenario | Endpoints | Users/EP | Groups/EP | Members/Group | Total Users | Total Groups | Total Memberships | Total Resources |
|----------|-----------|----------|-----------|---------------|-------------|--------------|-------------------|-----------------|
| **Small** | 10 | 100 | 10 | 10 | 1,000 | 100 | 1,000 | 1,100 |
| **Medium** | 100 | 1,000 | 100 | 100 | 100,000 | 10,000 | 1,000,000 | 110,000 |
| **Large** | 100 | 10,000 | 1,000 | 500 | 1,000,000 | 100,000 | 50,000,000 | 1,100,000 |

**Data size estimates per resource:**
- User record: ~3 KB (JSON attrs + metadata + indexes)
- Group record: ~1.5 KB base
- Membership row: ~150 bytes (FK pair + metadata)
- Endpoint config: ~8 KB

---

## Load Scenario Performance — By Deployment Type

### SMALL: 10 EP × 100 Users × 10 Groups × 10 Members/Group

> 1,100 resources, ~1,000 memberships, ~5 MB DB

| Metric | Local (6000) | Docker (8080) | Azure (Container App) |
|--------|-------------|---------------|----------------------|
| Can handle? | YES | YES | YES |
| Provision time | ~30–45s | ~30–45s | ~90–120s |
| API latency (avg) | 2–5ms | 3–8ms | 20–60ms |
| Throughput | ~200 req/s | ~150 req/s | ~50 req/s |
| DB size | ~5 MB | ~5 MB | ~5 MB |
| Memory footprint | ~150 MB | ~150 MB | ~150 MB |
| Required SKU | N/A | N/A | Current (B1ms + 0.5 vCPU) |
| Bottleneck | None | None | Network latency |
| Live test duration | ~20s | ~16s | ~40s |

### MEDIUM: 100 EP × 1,000 Users × 100 Groups × 100 Members/Group

> 110,000 resources, 1M memberships, ~500 MB–1 GB DB

| Metric | Local (6000) | Docker (8080) | Azure (Container App) |
|--------|-------------|---------------|----------------------|
| Can handle? | YES | YES | NEEDS SCALING |
| Provision time | ~30–45 min | ~30–45 min | ~2–4 hrs |
| API latency (avg) | 5–15ms | 8–20ms | 30–100ms |
| Throughput | ~100 req/s | ~80 req/s | ~30 req/s |
| DB size | ~500 MB–1 GB | ~500 MB–1 GB | ~500 MB–1 GB |
| Memory footprint | ~400–600 MB | ~400–600 MB | ~600 MB–1 GB |
| Required SKU | N/A | N/A | B2ms (2 vCore) + 1 vCPU container |
| Bottleneck | DB writes (bulk PATCH) | DB writes | DB (B1ms 1 vCore saturated) |
| Live test duration | ~30 min | ~35 min | ~2 hrs |

### LARGE: 100 EP × 10K Users × 1K Groups × 500 Members/Group

> 1.1M resources, 50M memberships, ~15–50 GB DB

| Metric | Local (6000) | Docker (8080) | Azure (Container App) |
|--------|-------------|---------------|----------------------|
| Can handle? | STRAINED | STRAINED | NEEDS MAJOR SCALING |
| Provision time | ~6–12 hrs | ~6–12 hrs | ~24–48 hrs |
| API latency (avg) | 20–80ms | 25–100ms | 50–200ms |
| Throughput | ~50 req/s | ~40 req/s | ~20 req/s |
| DB size | ~15–50 GB | ~15–50 GB | ~15–50 GB |
| Memory footprint | ~1–2 GB | ~1–2 GB | ~2–4 GB |
| Required SKU | N/A | N/A | GP D4s (4 vCore) + 2 vCPU / 4 GiB container |
| Bottleneck | DB indexes, FK constraints, PATCH ops | Same + container limits | DB + container CPU/memory |
| Live test duration | ~8 hrs | ~10 hrs | ~24+ hrs |

---

## Azure Cost Projections by Load Scenario

### Steady-State Monthly Costs (data at rest + always-on)

| Component | Small | Medium | Large |
|-----------|-------|--------|-------|
| **Container App** | | | |
| SKU needed | 0.5 vCPU / 1 GiB | 1 vCPU / 2 GiB | 2 vCPU / 4 GiB |
| Compute $/mo | ~$18 | ~$36 | ~$72 |
| **PostgreSQL** | | | |
| SKU needed | B1ms (1 vCore) | B2ms (2 vCore) | GP D4s_v3 (4 vCore) |
| Compute $/mo | ~$26 | ~$51 | ~$250 |
| Storage $/mo | ~$15 (128 GB) | ~$15 (128 GB) | ~$58 (512 GB) |
| **Log Analytics** | ~$2 | ~$5 | ~$15 |
| **Network egress** | ~$0 | ~$1 | ~$5 |
| **TOTAL $/month** | **~$61** | **~$108** | **~$400** |
| **TOTAL $/day** | **~$2.00** | **~$3.60** | **~$13.30** |

### Cost of Running Load/Provisioning Tests (one-time)

| Cost Component | Small | Medium | Large |
|----------------|-------|--------|-------|
| Duration | ~2 min | ~2–4 hrs | ~24–48 hrs |
| Extra vCPU-seconds consumed | ~60s | ~14,000s | ~170,000s |
| Container App burst cost | ~$0.002 | ~$0.50 | ~$6.00 |
| DB IOPS (burst) | included | included | ~$0 (burst credits) |
| Network (API calls) | ~$0 | ~$0.01 | ~$0.10 |
| **Total test run cost** | **~$0.01** | **~$0.60** | **~$7.00** |

### Cost of Running Live Test Suite (621 tests) at Each Data Scale

> The live-test.ps1 suite (621 tests) creates/reads/updates/deletes resources.
> At higher data volumes, each test takes longer due to larger list responses and slower DB queries.

| Metric | Small (loaded) | Medium (loaded) | Large (loaded) |
|--------|---------------|-----------------|----------------|
| Live test duration (Azure) | ~45s | ~5 min | ~30 min |
| API calls during test | ~2,500 | ~2,500 | ~2,500 |
| Azure compute cost per run | ~$0.001 | ~$0.01 | ~$0.05 |
| DB load per run | Negligible | Low | Moderate |
| **Cost per live test run** | **<$0.01** | **~$0.01** | **~$0.05** |

---

## Scaling Recommendations

| Scenario | PostgreSQL | Container App | Estimated Total $/mo |
|----------|-----------|---------------|----------------------|
| Small (≤1K resources) | B1ms — keep current | 0.5 vCPU / 1 GiB — keep current | ~$61 |
| Medium (≤100K resources) | Upgrade to B2ms (2 vCore) | Scale to 1 vCPU / 2 GiB | ~$108 |
| Large (≤1M resources) | Upgrade to GP D4s_v3 (4 vCore) | Scale to 2 vCPU / 4 GiB, 2 replicas | ~$400 |
| Enterprise (>1M) | GP D8s_v3+ or Hyperscale Citus | 4 vCPU / 8 GiB, 3+ replicas, autoscale | $800+ |

### Key Bottleneck Progression

```
Small      → Network latency (Azure round-trips)
Medium     → DB single-core saturation (B1ms limit: ~600 TPS)
Large      → DB IOPS + memory (need GP tier for connection pooling + work_mem)
Enterprise → Connection limits + write amplification (need pgBouncer + read replicas)
```

### Local/Docker Notes

- Local and Docker have **no cost** but share your machine's resources
- For Medium+, ensure PostgreSQL has ≥4 GB `shared_buffers` and `work_mem=64MB`
- Docker default memory limit is 2 GB — increase via Docker Desktop settings for Large
- Local can handle Large if your machine has ≥16 GB RAM and SSD storage

---

## Update Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-02 | v0.24.0 | Initial creation. All 4,337 tests passing. Azure running on B1ms + 0.5 vCPU Consumption tier. |
| 2026-03-03 | v0.27.0 | Live tests: 659 (647 pass, 12 pre-existing gaps). 4 inmemory bugs fixed. GHCR image updated (sha256:7787e05bbd4fdb). All 3 instances verified identical results. |
