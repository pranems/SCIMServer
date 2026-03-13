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
> **Baselines (v0.28.0):** 2,830 pass / 0 fail / 73 suites.
> *Source of truth: [PROJECT_HEALTH_AND_STATS.md](../../docs/PROJECT_HEALTH_AND_STATS.md#test-suite-summary)*

### Step 3: Run E2E Tests
```powershell
cd api
npx jest --config test/e2e/jest-e2e.config.ts --no-coverage --json --outputFile=pipeline-e2e.json 2>$null
# Parse results:
node -e "const r=JSON.parse(require('fs').readFileSync('pipeline-e2e.json','utf8'));console.log('suites:',r.numPassedTestSuites+'/'+r.numTotalTestSuites,'tests:',r.numPassedTests+'/'+r.numTotalTests,'failed:',r.numFailedTests)"
```
> **Baselines (v0.28.0):** 613 pass / 0 fail / 30 suites.
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
node dist/main.js                 # Start in background terminal
```
> **Port:** 6000 (local default)
> **Health poll:** `Invoke-RestMethod -Uri "http://localhost:6000/scim/ServiceProviderConfig"` — discovery endpoints are **public** (no auth required per RFC 7644 §4).

### Step 5: Run Live/Integration Tests
```powershell
cd scripts
.\live-test.ps1 -BaseUrl "http://localhost:6000" -ClientSecret "localoauthsecret123" *> ..\local-live-pipeline.txt
```
> **Output capture:** Use `*>` (all PowerShell streams) not `>` (stdout only). The script writes to multiple output streams.
> **Baselines (v0.28.0):** 832 assertions.
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
```powershell
docker compose up -d
```
> Do NOT use `--build` here (already built in step 8).

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

| Credential | Env Var | Docker Default | Local Default |
|------------|---------|---------------|---------------|
| OAuth Client Secret | `OAUTH_CLIENT_SECRET` | `devscimclientsecret` | `localoauthsecret123` |
| Legacy Shared Secret | `SCIM_SHARED_SECRET` | `devscimsharedsecret` | `local-secret` |
| JWT Secret | `JWT_SECRET` | `devjwtsecretkey123456` | `localjwtsecret123` |
| DB URL | `DATABASE_URL` | `postgresql://scim:scim@postgres:5432/scimdb` | N/A (inmemory) |

## Reporting
- After each phase, report a summary of test results (pass/fail counts).
- If any step fails, diagnose the issue, attempt a fix, and re-run from the failing step.
- At the end, provide a final summary comparing local vs. Docker test results.
- Include duration where available.
- Note any pre-existing failures explicitly so new regressions are clearly distinguishable.

## Known Pre-Existing Failures (v0.24.0)

**None.** All pre-existing failures from v0.21.0 (24 unit, 41 E2E, 5 live — boolean coercion schema validation) have been fixed as of v0.24.0.

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
25. **Was the report format sufficient?** Added duration and pre-existing failure documentation.
26. **Were there comparison gaps?** Local uses InMemory or Prisma with localhost DB. Docker always uses Prisma with containerized PostgreSQL. Results should be identical for SCIM operations.
