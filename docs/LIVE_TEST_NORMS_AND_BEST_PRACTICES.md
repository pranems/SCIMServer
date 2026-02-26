# Live Integration Test — Norms, Best Practices & Industry Recommendations

> **Last Updated**: February 26, 2026  
> **Applies to**: SCIMServer v0.19.2+  
> **Persistence**: PostgreSQL 17 (Prisma ORM)  
> **Script**: `scripts/live-test.ps1` (3,176 lines, 444+ tests, 10+ sections)  
> **Targets**: Local (`:6000`), Docker Compose (`:8080`), Azure Container Apps

---

## Table of Contents

1. [Overview & Purpose](#1-overview--purpose)
2. [Deployment Targets & Persistence Modes](#2-deployment-targets--persistence-modes)
3. [Core Principles](#3-core-principles)
4. [PostgreSQL-Specific Norms](#4-postgresql-specific-norms)
5. [Script Conventions & Patterns](#5-script-conventions--patterns)
6. [Test Lifecycle & Data Management](#6-test-lifecycle--data-management)
7. [Docker Container Testing](#7-docker-container-testing)
8. [Azure Container Apps Testing](#8-azure-container-apps-testing)
9. [Local Development Testing](#9-local-development-testing)
10. [Test Pyramid Positioning](#10-test-pyramid-positioning)
11. [Authoring New Test Sections](#11-authoring-new-test-sections)
12. [Anti-Patterns to Avoid](#12-anti-patterns-to-avoid)
13. [Checklist for New Live Test Sections](#13-checklist-for-new-live-test-sections)

---

## 1. Overview & Purpose

Live integration tests exercise the **full HTTP stack** against a running SCIMServer instance — the only test layer that covers real PostgreSQL queries, OAuth token flow, network serialization, Docker entrypoint/migration flow, and production secret validation.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Live Test Run                                │
│                                                                       │
│  PowerShell ──HTTP──▶ Running NestJS ──Prisma──▶ PostgreSQL 17       │
│                        (port 6000/8080)              (pgdata)         │
│                                                                       │
│  Coverage:                                                            │
│  ✅ Real HTTP request/response cycle                                  │
│  ✅ OAuth 2.0 client_credentials flow                                 │
│  ✅ Prisma → PostgreSQL wire protocol                                 │
│  ✅ Migration execution (docker-entrypoint.sh)                        │
│  ✅ Production NODE_ENV=production secret validation                  │
│  ✅ Container health checks & startup sequencing                      │
│  ✅ SCIM protocol compliance (RFC 7643/7644)                          │
└──────────────────────────────────────────────────────────────────────┘
```

### Invocation

```powershell
# Local (in-memory backend, default port 6000)
.\scripts\live-test.ps1

# Local with verbose HTTP tracing
.\scripts\live-test.ps1 -Verbose

# Docker Compose (PostgreSQL backend, port 8080)
.\scripts\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "devscimclientsecret"

# Azure Container Apps
.\scripts\live-test.ps1 -BaseUrl https://myapp.azurecontainerapps.io -ClientSecret "prod-secret"
```

---

## 2. Deployment Targets & Persistence Modes

| Target | BaseUrl | Persistence Backend | Database | Data Lifetime | Startup |
|--------|---------|-------------------|----------|---------------|---------|
| **Local dev** | `http://localhost:6000` | `inmemory` (Maps) | None | Wiped on process restart | `node dist/main.js` |
| **Local dev + PG** | `http://localhost:6000` | `prisma` (default) | Local PostgreSQL | Persistent until DB reset | `npm run start:dev` |
| **Docker Compose** | `http://localhost:8080` | `prisma` | `postgres:17-alpine` container | Persistent via `pgdata` volume | `docker compose up` |
| **Azure Container Apps** | `https://<app>.azurecontainerapps.io` | `prisma` | Azure PG Flexible Server | Persistent | Azure platform |

### Persistence Architecture (Docker Compose)

```
┌─────────────────────────────────────────────────────────────┐
│  docker-compose.yml                                          │
│                                                               │
│  ┌──────────────────────┐    ┌────────────────────────────┐  │
│  │  postgres             │    │  api                        │  │
│  │  (postgres:17-alpine) │◄───│  (scimserver:latest)        │  │
│  │  Port: 5432           │    │  Port: 8080                 │  │
│  │  DB: scimdb           │    │  PERSISTENCE_BACKEND=prisma │  │
│  │  User: scim           │    │  DATABASE_URL=postgresql://  │  │
│  │  Healthcheck:         │    │    scim:scim@postgres:5432/  │  │
│  │    pg_isready          │    │    scimdb                   │  │
│  └──────────┬───────────┘    └────────────────────────────┘  │
│             │                                                 │
│          pgdata (named volume)                                │
│          ↳ Survives container restarts                        │
│          ↳ Removed only by: docker compose down -v            │
└─────────────────────────────────────────────────────────────┘
```

### Key Implication

Unlike `inmemory` (wiped on restart), **PostgreSQL persists data across container restarts and rebuilds** if the `pgdata` volume survives. Test data accumulates unless explicitly cleaned up.

---

## 3. Core Principles

### 3.1 Self-Contained & Idempotent

Every test run must be fully self-contained:

- **CREATE** all needed resources (endpoints, users, groups) — never assume pre-existing data.
- **USE** randomized names to avoid collisions with parallel runs or leftover data.
- **CLEAN UP** every resource created — cascade endpoint delete removes all child resources.

```powershell
# ✅ Good: Randomized, self-contained
$endpointBody = @{
    name = "live-test-myfeature-$(Get-Random)"
    displayName = "My Feature Test"
} | ConvertTo-Json

# ❌ Bad: Assumes endpoint exists, collides on re-run
$endpointId = "hardcoded-endpoint-id"
```

### 3.2 Cleanup Is Mandatory

With PostgreSQL persistence, abandoned test data causes:
- `409 Conflict` on re-runs (unique constraint violations on `userName`/`externalId`)
- Database bloat over time
- False negatives from stale state

**Every section MUST** either:
1. Clean up resources at the end of the section, OR
2. Register resource IDs for deletion in Section 10 (final cleanup)

### 3.3 Sequential Execution, Independent Sections

SCIM operations are stateful (create → read → patch → delete). Within a section, operations are ordered. Between sections:

- Sections should be **independently re-runnable** when possible.
- Shared state (e.g., `$scimBase`, `$headers`, `$EndpointId`) is established in early sections.
- New sections go **before** Section 10 (DELETE OPERATIONS / Cleanup).

### 3.4 Backend-Agnostic Assertions

Tests MUST pass against both `inmemory` and `prisma` backends:

- Don't assert on database-specific behavior (connection pools, transaction isolation).
- Don't assert on internal IDs (UUIDs differ between backends).
- Assert on RFC-specified behavior (HTTP status codes, response shapes, SCIM protocol semantics).

### 3.5 Target-Agnostic Design

The same script runs against local, Docker, and Azure:

- **Never hardcode** ports, hostnames, or secrets.
- Use the `-BaseUrl` and `-ClientSecret` parameters.
- Don't assume filesystem access (Azure containers don't expose file systems).
- Handle network latency gracefully (Azure round-trips are 50-200ms vs <5ms local).

---

## 4. PostgreSQL-Specific Norms

### 4.1 Migrations

| Concern | Norm |
|---------|------|
| **Schema changes** | If tests depend on new columns/tables, rebuild the Docker image (migrations run in `docker-entrypoint.sh` via `prisma migrate deploy`). |
| **Migration ordering** | Prisma applies migrations alphabetically by folder name (timestamp prefix). Never rename existing migration folders. |
| **Fresh database** | Use `docker compose down -v && docker compose up -d` for a clean slate. |
| **Migration failures** | Check `docker logs scimserver-api` — migration failure blocks startup. |

### 4.2 Case Sensitivity

PostgreSQL text comparison rules affect live test assertions:

| Column | Type | Behavior | Test Implication |
|--------|------|----------|------------------|
| `userName` | `CITEXT` | Case-insensitive uniqueness | `Alice` and `alice` are the same user (409 on duplicate) |
| `displayName` | `VARCHAR` | Case-sensitive | `Eng Team` ≠ `eng team` for filter `eq` |
| `externalId` | `TEXT` | Case-sensitive (`caseExact: true` per RFC 7643 §3.1) | `EXT-001` ≠ `ext-001` — both can coexist |
| `payload` (JSONB) | JSONB | Keys: case-sensitive. Values: depends on operator | Extension attribute keys are case-sensitive |

```powershell
# ✅ Test case-insensitive userName uniqueness
$user1 = @{ schemas = @("..."); userName = "alice@test.com" } | ConvertTo-Json
$user2 = @{ schemas = @("..."); userName = "Alice@test.com" } | ConvertTo-Json  # Should 409
```

### 4.3 Uniqueness Constraints

PostgreSQL enforces uniqueness at the DB level:

| Constraint | Scope | Behavior |
|-----------|-------|----------|
| `userName` per `endpointId` | Composite unique | 409 Conflict on duplicate |
| `externalId` per `endpointId` | Composite unique (case-sensitive) | 409 Conflict on duplicate |
| Resource `id` | Globally unique (server-assigned UUID) | Never client-assignable |

### 4.4 Transaction Isolation

PostgreSQL defaults to **Read Committed** isolation:

- Rapid concurrent writes may see different snapshots.
- ETag/version checks use optimistic concurrency (`enforceIfMatch()`).
- Don't depend on serializable ordering in tests — add explicit waits or sequential execution.

### 4.5 Connection Limits

| Setting | Default | Note |
|---------|---------|------|
| PG max connections | 100 | `postgres:17-alpine` default |
| Prisma connection pool | 10 | Default pool size |
| Recommendation | Don't exceed pool size in parallel test requests | Sequential test execution avoids pool exhaustion |

### 4.6 JSONB Payload Considerations

- Extension attributes live in the `payload` JSONB column.
- JSONB preserves type fidelity: numbers stay numbers, booleans stay booleans.
- JSONB keys are case-sensitive — `Department` ≠ `department`.
- GIN indexes enable JSONB filter push-down for `eq`, `co`, `sw`, etc.

---

## 5. Script Conventions & Patterns

### 5.1 Section Numbering

```
Section 1:       Endpoint CRUD
Section 2:       Config Validation
Section 3:       User Operations
Section 4:       Group Operations
Section 5:       Multi-Member PATCH Config Flag
Section 6:       Endpoint Isolation
Section 7:       Inactive Endpoint Blocking
Section 8:       SCIM Discovery Endpoints
Section 9:       Error Handling
Section 9b-9l:   Feature-specific (RFC compliance, filters, ETag, etc.)
Section 10:      DELETE / Cleanup (always last)
```

**New sections**: Use `9m`, `9n`, `9o`, etc. — always **before** Section 10.

### 5.2 Section Template

```powershell
# ============================================
# TEST SECTION 9m: MY NEW FEATURE (RFC reference)
$script:currentSection = "9m: My Feature Name"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9m: MY NEW FEATURE (RFC reference)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create dedicated test resources ---
Write-Host "`n--- Setup: Create Test Endpoint for 9m ---" -ForegroundColor Cyan
$myFeatureEndpointBody = @{
    name = "live-test-myfeature-$(Get-Random)"
    displayName = "My Feature Test Endpoint"
    config = @{
        SoftDeleteEnabled = "True"
        StrictSchemaValidation = "True"
    }
} | ConvertTo-Json
$myFeatureEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $myFeatureEndpointBody
$MyFeatureEndpointId = $myFeatureEndpoint.id
$myFeatureBase = "$baseUrl/scim/endpoints/$MyFeatureEndpointId"

# Test 9m.1: Description of first test
Write-Host "`n--- Test 9m.1: Description ---" -ForegroundColor Cyan
# ... test logic ...
Test-Result -Success ($result.someField -eq "expected") -Message "Feature works correctly"

# Test 9m.2: Description of second test
Write-Host "`n--- Test 9m.2: Description ---" -ForegroundColor Cyan
# ... test logic ...
Test-Result -Success $true -Message "Edge case handled"

# --- Cleanup ---
Write-Host "`n--- Cleanup: Section 9m ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$MyFeatureEndpointId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "Section 9m test endpoint cleaned up"
} catch {
    Test-Result -Success $false -Message "Section 9m cleanup: $_"
}
```

### 5.3 Assertion Pattern

```powershell
# Always use Test-Result for assertions — it tracks pass/fail counts
Test-Result -Success ($response.statusCode -eq 200) -Message "GET /Users returns 200"

# For error-path testing, use try/catch
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $invalidBody
    Test-Result -Success $false -Message "Should have rejected invalid payload"
} catch {
    $status = [int]$_.Exception.Response.StatusCode
    Test-Result -Success ($status -eq 400) -Message "Invalid payload returns 400 Bad Request"
}
```

### 5.4 Verbose Logging

The script overrides `Invoke-RestMethod` and `Invoke-WebRequest` globally — all HTTP calls automatically log request/response details when `-Verbose` is used. No per-call changes needed.

### 5.5 Flow Step Tracking

Every HTTP call is automatically tracked via `Add-FlowStep`. The JSON results file includes:
- `flowSteps[]` — every HTTP request/response with timing
- `tests[]` — every assertion with linked flow step IDs
- `sections[]` — pass/fail summary per section

---

## 6. Test Lifecycle & Data Management

### 6.1 Standard Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Live Test Lifecycle                        │
│                                                               │
│  1. Get OAuth token (client_credentials)                      │
│     └─ POST /scim/oauth/token                                │
│                                                               │
│  2. Create test endpoint with randomized name                 │
│     └─ POST /scim/admin/endpoints                            │
│     └─ Extract $EndpointId, build $scimBase                  │
│                                                               │
│  3. Execute CRUD operations                                   │
│     └─ Create users/groups (POST)                            │
│     └─ Read / list / filter (GET)                            │
│     └─ Update (PUT / PATCH)                                   │
│     └─ Assert behavior                                        │
│                                                               │
│  4. Test feature-specific behavior                             │
│     └─ Config flag combinations                               │
│     └─ Error handling (4xx codes)                            │
│     └─ Edge cases                                             │
│                                                               │
│  5. Clean up ALL created resources                             │
│     └─ DELETE test endpoints (cascades to Users/Groups)       │
│     └─ Verify cleanup                                         │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Resource Cleanup Design

Endpoint deletion cascades to all child resources (users, groups, members):

```powershell
# This single call removes the endpoint AND all its users/groups
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method DELETE -Headers $headers

# For dedicated test endpoints within a section, clean up at section end
# For shared test endpoints, clean up in Section 10
```

### 6.3 Interrupted Run Recovery

If a test run is interrupted before cleanup:
- **inmemory**: No issue — data vanishes on restart.
- **PostgreSQL**: Orphaned data remains. Next run succeeds because of randomized names, but garbage accumulates.
- **Recovery**: Either run Section 10 manually, or `docker compose down -v` for a fresh DB.

### 6.4 JSON Results File

Every run produces `test-results/live-<timestamp>.json` + `test-results/live-results-latest.json`:

```json
{
  "testRunner": "Live Integration Tests (SCIMServer)",
  "version": "0.17.4",
  "target": "local | docker | azure",
  "summary": { "totalTests": 361, "passed": 361, "failed": 0 },
  "sections": [...],
  "tests": [...],
  "flowSteps": [...]
}
```

---

## 7. Docker Container Testing

### 7.1 Build & Run

```powershell
# From repo root
docker compose build                    # Build api image + use postgres:17-alpine
docker compose up -d                    # Start both containers
docker compose logs -f api              # Watch API startup (migrations + boot)

# Wait for health
do {
    Start-Sleep 2
    $health = docker inspect --format='{{.State.Health.Status}}' scimserver-api 2>$null
} while ($health -ne 'healthy')

# Run tests
.\scripts\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "devscimclientsecret"
```

### 7.2 Fresh Database (Wipe Volume)

```powershell
docker compose down -v                  # -v removes pgdata volume
docker compose up -d                    # Fresh PG database
```

### 7.3 Direct PostgreSQL Inspection

```powershell
# Connect to running Postgres container
docker exec -it scimserver-postgres psql -U scim -d scimdb

# Useful queries
SELECT COUNT(*) FROM "ScimResource";                    -- Total resources
SELECT "endpointId", COUNT(*) FROM "ScimResource" GROUP BY "endpointId";  -- Per-endpoint
SELECT * FROM "_prisma_migrations" ORDER BY "finished_at" DESC LIMIT 5;    -- Migration history
```

### 7.4 Docker-Specific Norms

| Norm | Detail |
|------|--------|
| **Port mapping** | Container runs on `8080` internally, mapped to host port in `docker-compose.yml` or `-p` flag |
| **Healthcheck dependency** | API container waits for `pg_isready` healthcheck before starting |
| **Entrypoint** | `docker-entrypoint.sh` runs `prisma migrate deploy` before `node dist/main.js` |
| **Secret defaults** | Docker Compose uses env vars with defaults: `JWT_SECRET:-devjwtsecretkey123456`, etc. |
| **Non-root user** | Container runs as `scim:nodejs` — no root access |
| **Log inspection** | `docker logs scimserver-api` for app logs, `docker logs scimserver-postgres` for PG logs |
| **Resource limits** | Set `NODE_OPTIONS=--max_old_space_size=384` for memory-constrained containers |

### 7.5 Docker Compose Configuration Reference

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: scimdb
      POSTGRES_USER: scim
      POSTGRES_PASSWORD: scim
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scim -d scimdb"]
      interval: 5s
      timeout: 3s
      retries: 5
  api:
    environment:
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
      PERSISTENCE_BACKEND: prisma
      PORT: 8080
    depends_on:
      postgres:
        condition: service_healthy
```

---

## 8. Azure Container Apps Testing

### 8.1 Key Differences from Local/Docker

| Aspect | Local/Docker | Azure Container Apps |
|--------|-------------|---------------------|
| **Latency** | <5ms per request | 50-200ms per request |
| **Cold starts** | None | Up to 30s if scaled to zero |
| **Database** | Local PG or inmemory | Azure PG Flexible Server (shared) |
| **Secrets** | Env vars or defaults | Azure Key Vault / Container App secrets |
| **Filesystem** | Read/write | Ephemeral (no persistent local storage) |
| **Networking** | localhost | Public endpoint or VNet + private endpoint |
| **Scale** | Single instance | 0-N replicas (auto-scale) |

### 8.2 Azure-Specific Norms

| Norm | Detail |
|------|--------|
| **Startup readiness** | Poll `/scim/admin/version` before running tests — cold starts may take 10-30s |
| **Shared database** | Azure PG may be shared across environments — always scope tests to unique endpoint names |
| **Secrets management** | Use `-ClientSecret` parameter matching the server's `OAUTH_CLIENT_SECRET` — never hardcode production secrets |
| **Rate limiting** | Azure Front Door or App Gateway may enforce rate limits — space rapid requests or handle 429s |
| **Timeout** | Consider adding `-TimeoutSec 30` to HTTP calls for Azure targets |
| **Network** | Azure may require TLS (HTTPS) — the live-test script uses `Invoke-RestMethod` which handles this natively |

### 8.3 Azure Pre-Flight Check

```powershell
# Verify Azure instance is reachable before running tests
$azureBase = "https://myapp.azurecontainerapps.io"
$maxRetries = 10
for ($i = 1; $i -le $maxRetries; $i++) {
    try {
        $v = Invoke-RestMethod -Uri "$azureBase/scim/admin/version" -TimeoutSec 10
        Write-Host "Azure instance ready: v$($v.version)"
        break
    } catch {
        Write-Host "Attempt $i/$maxRetries — waiting for Azure cold start..."
        Start-Sleep 5
    }
}
```

---

## 9. Local Development Testing

### 9.1 In-Memory Backend (Fastest)

```powershell
cd api
npm run build
$env:PORT = "6000"
$env:SCIM_SHARED_SECRET = "changeme"
$env:OAUTH_CLIENT_SECRET = "changeme-oauth"
$env:JWT_SECRET = "changeme-jwt"
$env:PERSISTENCE_BACKEND = "inmemory"
node dist/main.js

# In another terminal:
.\scripts\live-test.ps1 -BaseUrl http://localhost:6000 -ClientSecret "changeme-oauth"
```

**Trade-offs**: No PostgreSQL required, instant startup, but no persistence between restarts and no real SQL execution.

### 9.2 Local PostgreSQL Backend

```powershell
cd api
npm run build
$env:PORT = "6000"
$env:DATABASE_URL = "postgresql://scim:scim@localhost:5432/scimdb"
$env:PERSISTENCE_BACKEND = "prisma"
$env:SCIM_SHARED_SECRET = "changeme"
$env:OAUTH_CLIENT_SECRET = "changeme-oauth"
$env:JWT_SECRET = "changeme-jwt"
npx prisma migrate deploy    # Apply migrations first
node dist/main.js

# In another terminal:
.\scripts\live-test.ps1 -BaseUrl http://localhost:6000 -ClientSecret "changeme-oauth"
```

**Trade-offs**: Exercises real PostgreSQL queries, but requires local PG instance running.

### 9.3 Development Mode (`start:dev`)

```powershell
cd api
npm run start:dev            # Auto-reload on file changes, port 3000

# In another terminal:
.\scripts\live-test.ps1 -BaseUrl http://localhost:3000 -ClientSecret "changeme-oauth"
```

**Trade-offs**: Hot reload for rapid iteration, but slower startup and noisier console output.

---

## 10. Test Pyramid Positioning

```
                    ┌─────────────────────────┐
                    │     Live Tests           │  361+ tests
                    │  (Real HTTP + Real PG)   │  scripts/live-test.ps1
                    │                           │  Target: running server
                    │  Uniquely covers:         │
                    │   • OAuth token flow      │
                    │   • PG wire protocol      │
                    │   • Docker migrations     │
                    │   • Production secrets    │
                    │   • Container startup     │
                    ├───────────────────────────┤
                    │     E2E Tests             │  382 tests, 20 suites
                    │  (NestJS in-process HTTP) │  npx jest --config e2e
                    │                           │  Target: NestJS TestingModule
                    │  Uniquely covers:         │
                    │   • Controller routing    │
                    │   • DTO validation        │
                    │   • Interceptor behavior  │
                    │   • Guard enforcement     │
                    ├───────────────────────────┤
                    │     Unit Tests            │  2,357 tests, 69 suites
                    │  (Pure domain, no I/O)    │  npx jest
                    │                           │  Target: functions/classes
                    │  Uniquely covers:         │
                    │   • PATCH engine logic    │
                    │   • Schema validation     │
                    │   • Filter parsing        │
                    │   • Edge cases at scale   │
                    └───────────────────────────┘
```

### What Live Tests Add Beyond E2E

| Capability | E2E (Jest) | Live Test (HTTP) |
|-----------|------------|------------------|
| Real PostgreSQL queries | ❌ inmemory only | ✅ Prisma → PG wire |
| OAuth token negotiation | ❌ direct JWT injection | ✅ Full client_credentials flow |
| Docker entrypoint + migrations | ❌ not applicable | ✅ `docker-entrypoint.sh` |
| Network serialization/deserialization | ⚠️ in-process HTTP | ✅ True TCP/HTTP |
| Production secret enforcement | ❌ test config | ✅ `NODE_ENV=production` |
| Container health checks | ❌ not applicable | ✅ Startup sequencing |
| Azure-specific behavior | ❌ not applicable | ✅ Cold starts, TLS, latency |
| Cross-process isolation | ❌ same process | ✅ Client ↔ Server separation |

---

## 11. Authoring New Test Sections

### 11.1 When to Add Live Tests

Add live test sections when:
- A feature involves **persistence behavior** that differs between inmemory and PostgreSQL.
- A feature involves **new config flags** that affect runtime behavior.
- A feature requires **end-to-end protocol compliance** verification (RFC conformance).
- A feature changes **response shapes** (new attributes, removed attributes, filtering).
- A feature involves **multi-resource flows** (create user → add to group → patch group → verify membership).

### 11.2 Section Naming Convention

```
9m: <Feature Name>          # e.g., "9m: Schema Validation"
9n: <Feature Name>          # e.g., "9n: Custom Extensions"
```

- Use lowercase letter suffix after `9` for sub-sections.
- Keep the `$script:currentSection` label concise (≤30 chars recommended for JSON output readability).

### 11.3 Resource Isolation

**Always create a dedicated test endpoint** for each section that tests config-flag behavior. This ensures:
- No interference with other sections' endpoint config.
- Clean cascade delete at section end.
- Independent re-runnability.

```powershell
# ✅ Section-specific endpoint with specific config
$myEndpointBody = @{
    name = "live-test-myfeature-$(Get-Random)"
    config = @{ StrictSchemaValidation = "True"; SoftDeleteEnabled = "True" }
} | ConvertTo-Json
$myEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $myEndpointBody
$myBase = "$baseUrl/scim/endpoints/$($myEndpoint.id)"
```

For sections that test **against the shared main endpoint** (e.g., standard CRUD), use `$scimBase` and create resources with randomized names.

### 11.4 Config Flag Testing Pattern

When testing config flag behavior, create multiple endpoints with different flag combinations:

```powershell
# Endpoint with flag enabled
$enabledBody = @{ name = "live-test-enabled-$(Get-Random)"; config = @{ MyFlag = "True" } } | ConvertTo-Json
$enabledEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $enabledBody

# Endpoint with flag disabled
$disabledBody = @{ name = "live-test-disabled-$(Get-Random)"; config = @{ MyFlag = "False" } } | ConvertTo-Json
$disabledEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $disabledBody

# Test behavior difference
# ... create same user on both endpoints, verify different behavior ...

# Cleanup both
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($enabledEndpoint.id)" -Method DELETE -Headers $headers
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($disabledEndpoint.id)" -Method DELETE -Headers $headers
```

### 11.5 Error Path Testing

Always test both success and failure paths:

```powershell
# Success path
$user = Invoke-RestMethod -Uri "$myBase/Users" -Method POST -Headers $headers -Body $validBody
Test-Result -Success ($null -ne $user.id) -Message "POST valid user succeeds"

# Error path — test expected rejection
try {
    Invoke-RestMethod -Uri "$myBase/Users" -Method POST -Headers $headers -Body $invalidBody
    Test-Result -Success $false -Message "Should have rejected invalid payload"
} catch {
    $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    $status = [int]$_.Exception.Response.StatusCode
    Test-Result -Success ($status -eq 400) -Message "Invalid payload returns 400"
    Test-Result -Success ($errorBody.detail -match "expected pattern") -Message "Error detail is descriptive"
}
```

---

## 12. Anti-Patterns to Avoid

### ❌ Hardcoded Resource References

```powershell
# Bad — assumes endpoint "abc123" exists
$scimBase = "$baseUrl/scim/endpoints/abc123"
```

### ❌ Shared Mutable State Between Sections

```powershell
# Bad — Section 9n modifies Section 3's user, breaking Section 3 on re-run
$UserId = "id-from-section-3"
Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method DELETE -Headers $headers
```

### ❌ Missing Cleanup

```powershell
# Bad — creates resources but never deletes them
$ep = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $body
# ... tests ...
# (no cleanup — endpoint and users/groups leak into PG)
```

### ❌ Timing-Dependent Assertions

```powershell
# Bad — relies on exact timing
Start-Sleep 1
$result = Invoke-RestMethod -Uri "$scimBase/Users" -Method GET -Headers $headers
Test-Result -Success ($result.totalResults -eq 5) -Message "Exactly 5 users exist"
# (May fail on Azure due to latency or in concurrent test runs)
```

### ❌ Environment-Specific Assumptions

```powershell
# Bad — fails on Docker/Azure
Test-Result -Success (Test-Path "C:\Users\dev\data.db") -Message "DB file exists"
```

### ❌ Sensitive Data in Output

```powershell
# Bad — logs secrets
Write-Host "Token: $Token"
Write-Host "Secret: $ClientSecret"
# The verbose logging wrapper already masks Authorization headers
```

### ❌ Parallel HTTP Calls

```powershell
# Bad — exceeds Prisma connection pool
1..20 | ForEach-Object -Parallel {
    Invoke-RestMethod -Uri "$using:scimBase/Users" -Method POST ...
}
# Sequential execution is the norm; pool size is 10
```

---

## 13. Checklist for New Live Test Sections

Use this checklist when adding a new section to `scripts/live-test.ps1`:

### Planning

- [ ] Feature or behavior requires live HTTP validation (not covered by unit/E2E)
- [ ] Section number assigned (`9m`, `9n`, etc.) — before Section 10
- [ ] `$script:currentSection` set for JSON result tracking
- [ ] RFC reference cited in section header comment (if applicable)

### Resource Management

- [ ] Dedicated test endpoint created with randomized name (`"live-test-<feature>-$(Get-Random)"`)
- [ ] Config flags set on test endpoint as needed
- [ ] Test-specific users/groups created (not reused from other sections)
- [ ] All resource IDs captured in variables for cleanup

### Test Coverage

- [ ] Success path tested (expected 2xx responses)
- [ ] Error path tested (expected 4xx responses via try/catch)
- [ ] Edge cases tested (empty values, boundary conditions)
- [ ] Config flag behavior tested (enabled vs. disabled)
- [ ] Response shape validated (required fields present, forbidden fields absent)

### Assertions

- [ ] `Test-Result -Success <bool> -Message <string>` used for every assertion
- [ ] Messages are descriptive and unique (searchable in JSON output)
- [ ] No assertions on internal/database-specific behavior

### Cleanup

- [ ] All test endpoints deleted (cascade removes users/groups)
- [ ] Cleanup in try/catch with `Test-Result` for cleanup success
- [ ] Works on re-run (randomized names prevent collision)

### Compatibility

- [ ] Works against `inmemory` backend (local)
- [ ] Works against `prisma` + PostgreSQL backend (Docker)
- [ ] Works against Azure Container Apps (HTTPS, latency)
- [ ] No hardcoded ports, hostnames, or secrets
- [ ] No filesystem access assumptions
- [ ] No timing-dependent assertions

### Documentation

- [ ] Section purpose described in header comment
- [ ] Individual tests labeled with `Test 9m.1:`, `Test 9m.2:`, etc.
- [ ] Feature doc created in `docs/` (if significant feature — per commit checklist)

---

*This document should be referenced when writing new live test sections or reviewing live test pull requests.*
