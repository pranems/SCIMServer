---
name: fullValidationPipeline
description: Build, test locally, then build and test a Docker container end-to-end.
argument-hint: Optional flags or test script paths to customize the validation run.
---

Perform a full end-to-end validation pipeline for the current project. Follow these steps sequentially, stopping if any step fails:

## Prerequisites

Before starting, ensure:
- Working directory is the **repo root**: `C:\Users\v-prasrane\source\repos\SCIMServer`
- API source is in `api/` subdirectory
- Docker Desktop is running (for Phase 2)

## Phase 1 — Local Build & Validation

### Step 1: Clean Build
```powershell
cd api
npm ci                          # Install exact dependencies from lockfile
# NOTE: If npm ci fails with permissions errors, use `npm install` as fallback
npx prisma generate             # Generate Prisma client (required before build)
npm run build                   # TypeScript build via tsc (outputs to dist/)
```
> **Note:** `npm run build` runs `tsc -p tsconfig.build.json`. The NestJS CLI (`@nestjs/cli`) is NOT installed as a dependency — do NOT use `npx nest build`.

### Step 2: Run Unit Tests
```powershell
cd api
npx jest --no-coverage --json --outputFile=pipeline-unit.json 2>$null
# Parse results:
node -e "const r=JSON.parse(require('fs').readFileSync('pipeline-unit.json','utf8'));console.log('suites:',r.numPassedTestSuites+'/'+r.numTotalTestSuites,'tests:',r.numPassedTests+'/'+r.numTotalTests,'failed:',r.numFailedTests)"
```
> **Baselines (v0.37.0):** 3,241 pass / 0 fail / 82 suites.
> *Source of truth: [PROJECT_HEALTH_AND_STATS.md](../../docs/PROJECT_HEALTH_AND_STATS.md#test-suite-summary)*

### Step 3: Run E2E Tests
```powershell
cd api
npx jest --config test/e2e/jest-e2e.config.ts --no-coverage --json --outputFile=pipeline-e2e.json 2>$null
# Parse results:
node -e "const r=JSON.parse(require('fs').readFileSync('pipeline-e2e.json','utf8'));console.log('suites:',r.numPassedTestSuites+'/'+r.numTotalTestSuites,'tests:',r.numPassedTests+'/'+r.numTotalTests,'failed:',r.numFailedTests)"
```
> **Baselines (v0.35.0):** 960 pass / 0 fail / 46 suites.
> *Source of truth: [PROJECT_HEALTH_AND_STATS.md](../../docs/PROJECT_HEALTH_AND_STATS.md#test-suite-summary)*
> **E2E config path:** `test/e2e/jest-e2e.config.ts`

### Step 4: Start Local Instance
The local server can run with inmemory backend or PostgreSQL. Required environment variables:
```powershell
cd api
$env:PORT = "6000"
$env:PERSISTENCE_BACKEND = "inmemory"   # or omit for Prisma/PostgreSQL
$env:SCIM_SHARED_SECRET = "local-secret"
$env:OAUTH_CLIENT_SECRET = "localoauthsecret123"
$env:JWT_SECRET = "localjwtsecret123"

# Start in background (recommended — keeps terminal free)
Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WindowStyle Hidden
Start-Sleep -Seconds 5  # Wait for bootstrap

# OR start in foreground (blocks terminal):
# node dist/main.js
```
> **Port:** 6000 (local default)
> **Health poll:** `Invoke-RestMethod -Uri "http://localhost:6000/scim/ServiceProviderConfig"` — discovery endpoints are **public** (no auth required per RFC 7644 §4).

### Step 5: Run Live/Integration Tests
```powershell
cd scripts
.\live-test.ps1 -BaseUrl "http://localhost:6000" -ClientSecret "localoauthsecret123" *> ..\local-live-pipeline.txt
```
> **Output capture:** Use `*>` (all PowerShell streams) not `>` (stdout only). The script writes to multiple output streams.
> **Baselines (v0.34.0):** ~739 assertions.
> *Source of truth: [PROJECT_HEALTH_AND_STATS.md](../../docs/PROJECT_HEALTH_AND_STATS.md#test-suite-summary)*

### Step 6: Stop Local Instance
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 6000 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

## Phase 2 — Docker Build & Validation

> **⚠️ CRITICAL — Docker terminal safety:**
> - **NEVER** run `docker compose up` without the `-d` (detached) flag. Without `-d` the command streams container logs forever, floods the terminal buffer, and freezes VS Code.
> - **ALWAYS** separate build and start: run `docker compose build` first, then `docker compose up -d`.
> - **Poll health** with `docker compose ps` or `docker ps`, NOT by watching log output.
> - If you need logs, use `docker compose logs --tail 30 <service>` (bounded).

### Step 7: Clean Up Existing Containers
```powershell
docker compose down --remove-orphans
```

### Step 8: Build Docker Image
```powershell
docker compose build              # Cached build (~30s)
# OR for clean slate:
docker compose build --no-cache   # Full rebuild (~3-5 min)
```
> **Dockerfile:** Root `Dockerfile` (not `Dockerfile.optimized` or `Dockerfile.ultra`).
> **Services:** `api` (scimserver-api, port 8080) + `postgres` (scimserver-postgres, port 5432).
> **Tip:** Use `--no-cache` only when Dockerfile or base image changed. Cached builds are fine for code-only changes.

### Step 9: Start Docker Containers (Detached)

> **⚠️ CRITICAL — ENV VAR ISOLATION:** Before running `docker compose up`, ensure the PowerShell session does NOT have local-server env vars (`$env:OAUTH_CLIENT_SECRET`, `$env:SCIM_SHARED_SECRET`, `$env:JWT_SECRET`) from Phase 1 Step 4. Docker Compose's `${VAR:-default}` syntax inherits PowerShell env vars, causing Docker containers to use **local credentials** instead of Docker defaults. This causes OAuth 401 failures.

```powershell
# Set Docker-specific credentials explicitly (overrides any leftover local env vars)
$env:OAUTH_CLIENT_SECRET = "devscimclientsecret"
$env:SCIM_SHARED_SECRET = "devscimsharedsecret"
$env:JWT_SECRET = "devjwtsecretkey123456"

docker compose up -d --force-recreate
```
> Use `--force-recreate` to pick up env var changes. Do NOT use `--build` here (already built in step 8).
> **Verify env vars inside container:** `docker exec scimserver-api env | Select-String "OAUTH|SCIM_SHARED|JWT"`

### Step 10: Health Check
```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
```
Wait until both containers show `(healthy)`. Typically ~15-30s. If a container fails to become healthy within 90s:
```powershell
docker compose logs --tail 30 api
docker compose logs --tail 30 postgres
```

### Step 11: Run Live/Integration Tests Against Docker
```powershell
cd scripts
.\live-test.ps1 -BaseUrl "http://localhost:8080" -ClientSecret "devscimclientsecret" *> ..\docker-live-pipeline.txt
```
> **Docker OAuth secret:** `devscimclientsecret` (default in docker-compose.yml)
> **Docker legacy shared secret:** `devscimsharedsecret`
> **Docker JWT secret:** `devjwtsecretkey123456`
> **Port:** 8080 (mapped from container)

### Step 12: Stop and Clean Up
```powershell
docker compose down --remove-orphans
```
> Skip this step if the user asked to keep containers running.

## Docker Credentials Reference

| Credential | Env Var | Docker Default | Local Default | Standalone Default |
|------------|---------|---------------|---------------|-------------------|
| OAuth Client Secret | `OAUTH_CLIENT_SECRET` | `devscimclientsecret` | `localoauthsecret123` | `standalonesecret123` |
| Legacy Shared Secret | `SCIM_SHARED_SECRET` | `devscimsharedsecret` | `local-secret` | `standalone-secret` |
| JWT Secret | `JWT_SECRET` | `devjwtsecretkey123456` | `localjwtsecret123` | `standalonejwt123` |
| DB URL | `DATABASE_URL` | `postgresql://scim:scim@postgres:5432/scimdb` | N/A (inmemory) | N/A (inmemory) |

## Phase 3 — Standalone Build & Validation

> **Purpose:** Validate the self-contained standalone package that runs without Docker or global Node.js.
> The standalone build is the portable distribution artifact — if it breaks, customers can't deploy.

### Step 13: Build Standalone Package
```powershell
cd $env:USERPROFILE\source\repos\SCIMServer

# CRITICAL: Kill any running standalone process first (node.exe locks prevent rebuild)
Get-Process -Id (Get-NetTCPConnection -LocalPort 9090 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Clean previous artifacts
Remove-Item -Recurse -Force standalone -ErrorAction SilentlyContinue
Remove-Item -Force SCIMServer-standalone.zip -ErrorAction SilentlyContinue

# Build with bundled Node.js + ZIP
pwsh -File scripts\build-standalone.ps1 -IncludeNode -Zip
```
> **Output:** `standalone/` folder + `SCIMServer-standalone.zip`
> **Duration:** ~2-5 min (downloads Node.js binary on first run, cached later)
> **Verify:** `Test-Path standalone\start.ps1` should be `True`
> **⚠️ Common failure:** `node.exe is denied` — the bundled Node.js binary is locked by a running standalone process from a previous run. Always kill port 9090 processes first.

### Step 14: Deploy Standalone to Fresh Folder
```powershell
# Create a clean deployment folder (simulates customer install)
$standaloneTestDir = "$env:TEMP\scimserver-standalone-test-$(Get-Random)"
New-Item -ItemType Directory -Path $standaloneTestDir | Out-Null

# Extract the ZIP (or copy the standalone folder)
if (Test-Path SCIMServer-standalone.zip) {
    Expand-Archive -Path SCIMServer-standalone.zip -DestinationPath $standaloneTestDir -Force
} else {
    Copy-Item -Recurse -Path standalone\* -Destination $standaloneTestDir
}
```

### Step 15: Start Standalone Instance
```powershell
Push-Location $standaloneTestDir
# Start in background — standalone uses inmemory backend by default
$env:PORT = "9090"
$env:PERSISTENCE_BACKEND = "inmemory"
$env:SCIM_SHARED_SECRET = "standalone-secret"
$env:OAUTH_CLIENT_SECRET = "standalonesecret123"
$env:JWT_SECRET = "standalonejwt123"

# Start the standalone server in background
Start-Process -FilePath "pwsh" -ArgumentList "-File", "start.ps1" -WindowStyle Hidden
# OR if Node.js is bundled:
# Start-Process -FilePath ".\node\node.exe" -ArgumentList "dist\main.js" -WindowStyle Hidden
```
> **Port:** 9090 (avoid conflict with local 6000 and Docker 8080)
> **Health poll:** `Invoke-RestMethod -Uri "http://localhost:9090/scim/ServiceProviderConfig"`
> Wait until health check returns 200 (typically 5-10s).

### Step 16: Run Live Tests Against Standalone
```powershell
cd $env:USERPROFILE\source\repos\SCIMServer\scripts
.\live-test.ps1 -BaseUrl "http://localhost:9090" -ClientSecret "standalonesecret123" *> ..\standalone-live-pipeline.txt
```
> Parse results from output file — same format as other live test runs.

### Step 17: Stop Standalone Instance & Clean Up
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 9090 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Pop-Location
# Clean up test directory
Remove-Item -Recurse -Force $standaloneTestDir -ErrorAction SilentlyContinue
```

## Phase 4 — Docker Image Publish & Azure Deployment

> **Purpose:** Push the Docker image to GitHub Container Registry (GHCR) and deploy to Azure Container Apps.
> This validates the full production deployment path.
> **Prerequisites:** `az` CLI logged in, Docker logged into GHCR, `scripts/deploy-azure.ps1` available.

### Step 18: Tag & Push Docker Image to GHCR
```powershell
cd $env:USERPROFILE\source\repos\SCIMServer

# Tag with version from package.json
$version = (Get-Content api/package.json | ConvertFrom-Json).version
$ghcrRepo = "ghcr.io/<owner>/scimserver"

docker tag scimserver-api:latest "$ghcrRepo`:$version"
docker tag scimserver-api:latest "$ghcrRepo`:latest"

# Push (requires `docker login ghcr.io` with PAT)
docker push "$ghcrRepo`:$version"
docker push "$ghcrRepo`:latest"
```
> Replace `<owner>` with the GitHub org/user name.
> **Duration:** ~1-3 min depending on image size and network.

### Step 19: Deploy to Azure Container Apps
```powershell
cd scripts
.\deploy-azure.ps1 `
    -ResourceGroup "scimserver-rg" `
    -AppName "scimserver" `
    -Location "eastus" `
    -ScimSecret "az-scim-secret-$(Get-Random)" `
    -JwtSecret "az-jwt-secret-$(Get-Random)" `
    -OauthClientSecret "az-oauth-secret-$(Get-Random)" `
    -ImageTag "$version" `
    -GhcrUsername "<github-username>" `
    -GhcrPassword "<github-pat>" `
    -ProvisionPostgres `
    -PgAdminPassword "PgAdmin$(Get-Random)!"
```
> **Duration:** ~5-15 min (Container App + PostgreSQL provisioning)
> The script outputs the app URL on completion. Save it for Step 20.
> **State persistence:** The script creates `scripts/logs/deploy-state.json` with idempotent state.

### Step 20: Run Live Tests Against Azure
```powershell
$azUrl = "<azure-container-app-url>"    # from Step 19 output
$azOauthSecret = "<oauth-secret>"        # from Step 19 -OauthClientSecret

cd scripts
.\live-test.ps1 -BaseUrl $azUrl -ClientSecret $azOauthSecret *> ..\azure-live-pipeline.txt
```
> **Note:** Azure uses HTTPS. Ensure `$azUrl` starts with `https://`.
> Existing endpoints and data from previous deployments are preserved (PostgreSQL is persistent).

### Step 21: Verify Existing Data Preserved
After deploying a new version, verify that endpoints and resources from previous deployments still exist:
```powershell
# List endpoints — should show previously created endpoints
$endpoints = Invoke-RestMethod -Uri "$azUrl/scim/admin/endpoints" -Headers @{ Authorization = "Bearer $azOauthSecret" }
Write-Host "Existing endpoints: $($endpoints.totalResults)"

# If endpoints exist, verify resources are still accessible
if ($endpoints.totalResults -gt 0) {
    $firstEp = $endpoints.endpoints[0]
    $users = Invoke-RestMethod -Uri "$azUrl/scim/endpoints/$($firstEp.id)/Users" -Headers @{ Authorization = "Bearer $azOauthSecret" }
    Write-Host "Users in first endpoint: $($users.totalResults)"
}
```

## Reporting
- After each phase, report a summary of test results (pass/fail counts).
- If any step fails, diagnose the issue, attempt a fix, and re-run from the failing step.
- At the end, provide a **final summary table** comparing ALL deployment targets:

| Target | Unit | E2E | Live | Data Preserved? | Notes |
|--------|------|-----|------|----------------|-------|
| Local (inmemory) | ✅/❌ | ✅/❌ | ✅/❌ | N/A (ephemeral) | Port 6000 |
| Docker (postgres) | N/A | N/A | ✅/❌ | N/A (fresh) | Port 8080 |
| Standalone (inmemory) | N/A | N/A | ✅/❌ | N/A (ephemeral) | Port 9090 |
| Azure (postgres) | N/A | N/A | ✅/❌ | ✅ verify | HTTPS |

- Include duration where available.
- Note any pre-existing failures explicitly so new regressions are clearly distinguishable.
- For Azure, explicitly verify existing endpoints/data survived the deployment.

## Known Pre-Existing Failures (v0.34.0)

**None.** All tests pass: **3,206 unit** (80 suites), **950 E2E** (45 suites), **739 live**.

## Entra ID Provisioning Configuration

After deploying to any target, provide the Entra ID provisioning input in this format:

```
CONFIGURE ENTRA ID
   In Entra ID provisioning config, set:
     Tenant URL:          http://<host>:<port>/scim/v2/endpoints/<endpoint-uuid>
     Token endpoint url:  http://<host>:<port>/scim/oauth/token
     Client ID:           scimserver-client
     Client Secret:       <OAUTH_CLIENT_SECRET for the target>
```

| Target | Host:Port | OAuth Client Secret |
|--------|-----------|--------------------|
| Local | `localhost:6000` | `localoauthsecret123` |
| Docker | `localhost:8080` | `devscimclientsecret` |
| Standalone | `localhost:9090` | `standalonesecret123` |
| Azure | `<app>.azurecontainerapps.io` (HTTPS) | Value from deploy script |

## Self-Improvement Check

After completing the full pipeline, critically evaluate **this prompt itself** for accuracy, completeness, and efficiency. Ask these questions and apply fixes directly to `.github/prompts/fullValidationPipeline.prompt.md`:

### Build & Dependency Self-Check
1. **Did the build command work?** Verified: `npm run build` (runs `tsc -p tsconfig.build.json`). NestJS CLI is NOT installed — do NOT use `npx nest build`.
2. **Were dependency install steps needed?** Yes: `npm ci` + `npx prisma generate` are required prerequisites.
3. **Did the clean build require cache clearing?** No — `npm run build` handles this. `rm -rf dist/` is only needed if switching branches.

### Test Runner Self-Check
4. **Did the Jest commands work as written?** Yes. Use `--testPathPatterns` (plural, Jest 30+). `--forceExit` is NOT needed for unit tests but may help for E2E if hanging.
5. **Did JSON output parsing work?** Yes with `--json --outputFile=file.json 2>$null`. NestJS bootstrap logs go to stderr and are suppressed. Parse with `node -e` (most reliable) or PowerShell `ConvertFrom-Json`.
6. **Did the E2E config path change?** Current: `test/e2e/jest-e2e.config.ts`. Update if moved.
7. **Were there new test levels?** No contract/snapshot/perf tests currently. Could add lint (`npx eslint .`) as optional.

### Local Instance Self-Check
8. **Did the start command work?** `node dist/main.js` with env vars. Requires `npm run build` first and PostgreSQL running on 5432.
9. **Did the health poll work?** `/scim/ServiceProviderConfig` is public (no auth needed). Works reliably.
10. **What port did it run on?** 6000 (set via `$env:PORT`).
11. **Did the stop command work?** `Get-NetTCPConnection -LocalPort 6000 | Stop-Process` works on Windows.

### Docker Self-Check
12. **Did the Dockerfile change?** Using root `Dockerfile`. `Dockerfile.optimized` and `Dockerfile.ultra` exist but are not the default.
13. **Did compose service names change?** `api` → `scimserver-api`, `postgres` → `scimserver-postgres`.
14. **Did the Docker health check work?** Yes, both containers have built-in healthchecks. **Important:** The API healthcheck URL must be `/scim/health` (not `/health`) since the app uses `/scim` as the global prefix.
15. **Did the Docker port mapping change?** 8080:8080 for API, 5432:5432 for PostgreSQL.
16. **Did Docker credentials change?** OAuth: `devscimclientsecret`, Legacy: `devscimsharedsecret`, JWT: `devjwtsecretkey123456`. NOT `docker-secret`.
17. **Did `--no-cache` take excessively long?** ~3-5 min. Cached build is ~30s. Made `--no-cache` optional.
18. **Did Docker inherit wrong env vars?** YES — critical learning. PowerShell `$env:*` set in Phase 1 leaks into Docker via `${VAR:-default}` syntax. Always explicitly set Docker credentials before `docker compose up`. Verify with `docker exec scimserver-api env | Select-String "OAUTH"`.
19. **Did `docker compose up -d` fail with stale container reference?** YES — after `docker compose down`, subsequent `up -d` can fail with "No such container" if orphaned references remain. Use `docker compose up -d --force-recreate` to fix.

### Live Test Self-Check
18. **Did the live test script path change?** `scripts/live-test.ps1` with `-BaseUrl` and `-ClientSecret` params.
19. **Did the live test require new parameters?** No new required params. Script auto-discovers endpoints.
20. **Did the test result format change?** Standard format. Results JSON written to `test-results/live-*.json`.

### Pipeline Flow Self-Check
21. **Was the step ordering optimal?** Yes. Unit → E2E → Live is correct (fast to slow).
22. **Were there missing phases?** Could add `npx eslint .` as optional lint step. Not blocking.
23. **Were there unnecessary steps?** No redundant steps found.
24. **Did the "stop on failure" strategy work?** Yes. Pre-existing failures are documented and don't block.

### Reporting Self-Check
25. **Was the report format sufficient?** Added duration, pre-existing failure documentation, and 4-target comparison table.
26. **Were there comparison gaps?** Local uses InMemory. Docker/Azure use PostgreSQL. Standalone uses InMemory. Results should be identical for SCIM operations. Azure additionally verifies data persistence across deploys.

### Standalone Self-Check
27. **Did `build-standalone.ps1` succeed?** Verify `standalone/start.ps1` exists and ZIP is created. **Common failure:** `node.exe access denied` if a previous standalone process is still running — kill port 9090 first.
28. **Did the standalone server start?** Verify health check at port 9090. Common issue: bundled Node.js binary may need `--experimental-*` flags.
29. **Did the standalone use the right persistence?** Default is InMemory. Verify with `GET /scim/admin/endpoints` returning empty initially.
30. **Did standalone live tests pass?** Same live-test.ps1 script, different port + secret.
31. **Was the standalone cleanup complete?** Temp directory removed, port freed. Always kill node.exe before attempting rebuild.

### Azure Deployment Self-Check
32. **Did GHCR push succeed?** Verify `docker push` completes without auth errors. Require `docker login ghcr.io`.
33. **Did Azure deploy script complete?** Check `scripts/logs/deploy-state.json` for completion state.
34. **Was the Azure app URL correct?** Script outputs the FQDN. Verify HTTPS.
35. **Did existing data survive?** Verify endpoint count matches pre-deploy state. Critical for upgrades.
36. **Did Azure live tests use HTTPS?** Ensure `-BaseUrl` starts with `https://`.
37. **Were Azure credentials rotated?** Each deploy uses `Get-Random` in secrets for security.
