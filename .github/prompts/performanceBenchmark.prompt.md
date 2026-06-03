---
name: performanceBenchmark
description: Measure and validate API performance - p95 latency, DB query counts, memory usage, and bulk throughput.
argument-hint: Optional scope - "latency", "queries", "memory", "bulk", or "full" (default).
---

Benchmark SCIMServer performance across key dimensions. This prompt produces measurable baselines that can be compared across versions.

---

## Step 1 - Environment Setup

Determine target environment:
1. **Local** (default): `http://localhost:6000` - start with `npm run start:dev` in `api/`
2. **Docker**: `http://localhost:8080` - start with `docker compose up -d`
3. **Azure Dev**: `https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io`

Set credentials:
- OAuth secret: read from `scripts/state/deploy-state-*.json` or use `changeme-oauth` (current prod/dev)
- Get OAuth token first

---

## Step 2 - Latency Benchmarks

For each endpoint category, measure response time with PowerShell `Measure-Command`:

### 2a. CRUD Operations (single resource)

| Operation | Method | Path | Body | Target p95 |
|-----------|--------|------|------|------------|
| Create User | POST | `/Users` | Standard user JSON | < 50ms |
| Get User | GET | `/Users/{id}` | - | < 20ms |
| List Users | GET | `/Users?count=100` | - | < 100ms |
| List Users filtered | GET | `/Users?filter=userName eq "x"` | - | < 50ms |
| Replace User | PUT | `/Users/{id}` | Full user JSON | < 50ms |
| Patch User | PATCH | `/Users/{id}` | PatchOp JSON | < 50ms |
| Delete User | DELETE | `/Users/{id}` | - | < 20ms |
| Create Group | POST | `/Groups` | Group + 5 members | < 50ms |
| Get Group | GET | `/Groups/{id}` | - | < 20ms |

### 2b. Discovery Endpoints

| Operation | Method | Path | Target p95 |
|-----------|--------|------|------------|
| Health | GET | `/health` | < 5ms |
| Schemas | GET | `/Schemas` | < 20ms |
| ResourceTypes | GET | `/ResourceTypes` | < 10ms |
| ServiceProviderConfig | GET | `/ServiceProviderConfig` | < 10ms |

### 2c. Admin Endpoints

| Operation | Method | Path | Target p95 |
|-----------|--------|------|------------|
| List Endpoints | GET | `/admin/endpoints` | < 50ms |
| Get Endpoint (full) | GET | `/admin/endpoints/{id}?view=full` | < 30ms |
| Get Stats | GET | `/admin/endpoints/{id}/stats` | < 50ms |
| Version | GET | `/admin/version` | < 10ms |

**Measurement method**: Run each operation 20 times, discard first 2 (warmup), report p50/p95/p99 from remaining 18.

---

## Step 3 - DB Query Count Validation

For key operations, verify the number of Prisma queries executed:

| Operation | Max Queries | How to Measure |
|-----------|-------------|----------------|
| GET /Users/{id} | 2 (user + endpoint config) | Enable Prisma query logging, count |
| GET /Users?count=50 | 3 (count + list + config) | Prisma query log |
| POST /Users | 4 (uniqueness check + create + log + config) | Prisma query log |
| GET /admin/dashboard (future BFF) | 0 (should use cache) | Prisma query log |
| Activity feed with 50 logs | <= 2 (DataLoader batching) | Prisma query log |

**Method**: Set `LOG_LEVEL=DEBUG` and look for Prisma query entries in the ring buffer or console output.

---

## Step 4 - Bulk Operation Throughput

| Test | Operations | Target |
|------|-----------|--------|
| Bulk POST 50 users | 50 POSTs in single request | < 2s total |
| Bulk POST 100 users | 100 POSTs in single request | < 5s total |
| Bulk DELETE 50 users | 50 DELETEs in single request | < 1s total |
| Bulk mixed 20 ops | POST + PATCH + DELETE mix | < 1s total |

---

## Step 5 - Memory Baseline

If running locally:
```powershell
# Measure Node.js RSS memory
$before = (Get-Process -Name node | Where-Object { $_.CommandLine -like '*main*' }).WorkingSet64 / 1MB
# ... run operations ...
$after = (Get-Process -Name node | Where-Object { $_.CommandLine -like '*main*' }).WorkingSet64 / 1MB
Write-Host "Memory delta: $($after - $before) MB"
```

Target: < 384MB RSS under normal load (matches `NODE_OPTIONS=--max_old_space_size=384`).

---

## Step 6 - Output Report

```markdown
## Performance Benchmark Report - v{version} - {date}

| Category | p50 | p95 | p99 | Target | Status |
|----------|-----|-----|-----|--------|--------|
| POST /Users | Xms | Xms | Xms | <50ms | PASS/FAIL |
| GET /Users/{id} | Xms | Xms | Xms | <20ms | PASS/FAIL |
| ... | | | | | |

### DB Query Counts
| Operation | Queries | Target | Status |
|-----------|---------|--------|--------|

### Bulk Throughput
| Test | Duration | Ops/sec | Target | Status |

### Memory
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Baseline RSS | X MB | <384MB | PASS/FAIL |
```

---

## Self-Improvement

After each run, append baseline history for trend tracking:

<!-- Benchmark History -->
<!-- | Date | Version | Env | POST_p95 | GET_p95 | LIST_p95 | Bulk50_ms | RSS_MB | -->
<!-- (populated after first run) -->
