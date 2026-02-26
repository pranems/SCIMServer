# 🐳 SCIMServer Docker Guide — Build, Deploy & Live Test Report

> **Date:** February 11, 2026  
> **Image:** `scimserver:live-test` (496 MB, Alpine Linux)  
> **Test Result (historical run):** ✅ **212/212 tests passed** in 4.9s  
> **Current baseline:** ✅ **444/444 live integration tests passed** (local + Docker)  
> **Database:** PostgreSQL 17 (docker postgres:17-alpine)  
> **Base Image:** `node:24-alpine` (multi-stage build)
> **Runtime note:** Current production image exposes and serves on `8080` (not `80`). Unit tests: **2,357/2,357** (69 suites). E2E tests: **455/455** (22 suites).

---

## 📋 Table of Contents

**Part 1 — Docker Live Test Guide**
1. [Prerequisites](#1-prerequisites)
2. [Quick Start (5 Commands)](#2-quick-start-5-commands)
3. [Step-by-Step Walkthrough](#3-step-by-step-walkthrough)
4. [Troubleshooting](#4-troubleshooting)

**Part 2 — Docker Deployment Guide**
5. [Architecture Overview](#5-architecture-overview)
6. [Multi-Stage Build Explained](#6-multi-stage-build-explained)
7. [Container Entrypoint & Storage](#7-container-entrypoint--storage)
8. [Environment Variables Reference](#8-environment-variables-reference)
9. [Deployment Configurations](#9-deployment-configurations)
10. [Production Deployment](#10-production-deployment)

**Part 3 — Live Test Results Report**
11. [Test Summary Dashboard](#11-test-summary-dashboard)
12. [Detailed Test Results by Section](#12-detailed-test-results-by-section)
13. [RFC Compliance Coverage Matrix](#13-rfc-compliance-coverage-matrix)

---

# Part 1 — Docker Live Test Guide

## 1. Prerequisites

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Docker Desktop | 4.x+ | `docker --version` |
| PowerShell | 7.x+ | `$PSVersionTable.PSVersion` |
| Free port | 6000 | `Get-NetTCPConnection -LocalPort 6000` |

```
┌──────────────────────────────────────────────────────┐
│  Your Machine                                         │
│                                                       │
│  ✅ Docker Desktop running                            │
│  ✅ PowerShell 7+ installed                           │
│  ✅ Port 6000 available                               │
│  ✅ SCIMServer repo cloned                              │
└──────────────────────────────────────────────────────┘
```

---

## 2. Quick Start (5 Commands)

For those who want to get straight to it — run these from the project root:

```powershell
# 1. Fix line endings (one-time, Windows → Linux)
(Get-Content api/docker-entrypoint.sh -Raw) -replace "`r`n","`n" |
  Set-Content api/docker-entrypoint.sh -NoNewline -Encoding utf8NoBOM

# 2. Build the Docker image
docker build -t scimserver:live-test --build-arg IMAGE_TAG=live-test -f Dockerfile .

# 3. Run the container
docker run -d --name scimserver-live-test -p 6000:8080 `
  -e PORT=8080 `
  -e NODE_ENV=production `
  -e JWT_SECRET=live-test-secret-key-2026 `
  -e OAUTH_CLIENT_SECRET=changeme-oauth `
  -e SCIM_SHARED_SECRET=test-shared-secret `
  scimserver:live-test

# 4. Wait ~8s for startup, then run tests
Start-Sleep -Seconds 8
pwsh -File scripts/live-test.ps1 -BaseUrl "http://localhost:6000"

# 5. Cleanup
docker rm -f scimserver-live-test
```

---

## 3. Step-by-Step Walkthrough

### Step 1 — Fix Shell Script Line Endings

> **Why?** Windows stores files with `\r\n` (CRLF) line endings. The Alpine Linux container expects `\n` (LF). Without this fix, the entrypoint script fails with `exec: not found`.

```
  Windows file (CRLF)                 Linux file (LF)
  ┌──────────────────┐               ┌──────────────────┐
  │ #!/bin/sh\r\n    │  ──fix──▶     │ #!/bin/sh\n      │
  │ set -e\r\n       │               │ set -e\n         │
  │ exec node...\r\n │               │ exec node...\n   │
  └──────────────────┘               └──────────────────┘
  ❌ exec: not found                  ✅ Works correctly
```

**PowerShell command:**
```powershell
$content = Get-Content -Path "api/docker-entrypoint.sh" -Raw
$content = $content -replace "`r`n", "`n"
[System.IO.File]::WriteAllText(
  "api/docker-entrypoint.sh",
  $content,
  [System.Text.UTF8Encoding]::new($false)
)
```

> **Note:** This is a one-time fix. Once committed with LF endings, you won't need this again. Consider adding a `.gitattributes` file with `*.sh text eol=lf`.

---

### Step 2 — Build the Docker Image

```powershell
docker build -t scimserver:live-test --build-arg IMAGE_TAG=live-test -f Dockerfile .
```

**What happens during the build (3 stages):**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DOCKER BUILD PIPELINE                        │
│                                                                     │
│  Stage 1: web-build              Stage 2: api-build                 │
│  ┌───────────────────┐          ┌────────────────────────┐          │
│  │ FROM node:24-alpine│          │ FROM node:24-alpine     │         │
│  │                    │          │                          │         │
│  │ 1. npm ci (web)    │          │ 1. apk add openssl      │         │
│  │ 2. vite build      │─────────▶│ 2. npm ci (api)         │         │
│  │ 3. rm node_modules │  copy    │ 3. COPY web dist→public │         │
│  │                    │  dist/   │ 4. prisma generate      │         │
│  │ Output: dist/      │          │ 5. prisma db push       │         │
│  └───────────────────┘          │ 6. tsc -p tsconfig.build│         │
│                                  │ 7. npm prune --production│        │
│                                  │                          │         │
│                                  │ Output: dist/, modules/  │         │
│                                  └───────────┬──────────────┘        │
│                                              │                       │
│                          Stage 3: runtime    │                       │
│                          ┌───────────────────▼──────────────┐       │
│                          │ FROM node:24-alpine               │       │
│                          │                                    │       │
│                          │ 1. apk add openssl                │       │
│                          │ 2. Create user scim:nodejs         │       │
│                          │ 3. COPY node_modules, dist,        │       │
│                          │    public, prisma, package.json    │       │
│                          │ 4. COPY docker-entrypoint.sh       │       │
│                          │ 5. Remove *.md, *.map, test dirs   │       │
│                          │ 6. USER scim (non-root)            │       │
│                          │ 7. EXPOSE 8080 + HEALTHCHECK       │       │
│                          │                                    │       │
│                          │ Final image: ~496 MB               │       │
│                          └────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

**Expected output (key milestones):**

| Build Step | Log Indicator | Typical Time |
|------------|--------------|--------------|
| Web deps install | `added 68 packages` | ~5s |
| Vite build | `✓ built in 3.22s` | ~5s |
| API deps install | `added 619 packages` | ~25s |
| Prisma generate | `Generated Prisma Client` | ~2s |
| Prisma db push | `Your database is now in sync` | ~1s |
| TypeScript compile | (no explicit log) | ~5s |
| Runtime layer copy | `exporting layers` | ~8s |
| **Total** | | **~60s** |

---

### Step 3 — Run the Container

```powershell
docker run -d --name scimserver-live-test `
  -p 6000:8080 `
  -e PORT=8080 `
  -e NODE_ENV=production `
  -e JWT_SECRET=live-test-secret-key-2026 `
  -e OAUTH_CLIENT_SECRET=changeme-oauth `
  -e SCIM_SHARED_SECRET=test-shared-secret `
  scimserver:live-test
```

**Port mapping explained:**

```
  Host Machine                    Docker Container
  ┌───────────────┐              ┌───────────────────────┐
  │                │ -p 6000:8080 │                       │
  │  localhost:6000│─────────────▶│ NestJS listening :8080│
  │                │              │                       │
  │  Test script   │              │  ┌─────────────────┐  │
  │  hits :6000    │              │  │ Prisma + SQLite  │  │
  │                │              │  │ /tmp/local-data/ │  │
  └───────────────┘              │  └─────────────────┘  │
                                  └───────────────────────┘
```

**Wait for startup (~8 seconds):**
```powershell
# Option A: Watch logs
docker logs -f scimserver-live-test
# Look for: "🚀 SCIM Endpoint Server API is running on http://localhost:8080/scim"

# Option B: Script-based wait
$ready = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Seconds 3
    $logs = docker logs scimserver-live-test 2>&1
    if ($logs -match "running on http") { $ready = $true; break }
}
```

---

### Step 4 — Run the Live Tests

```powershell
# Standard mode (pass/fail only)
pwsh -File scripts/live-test.ps1 -BaseUrl "http://localhost:6000"

# Verbose mode (shows all HTTP requests/responses)
pwsh -File scripts/live-test.ps1 -BaseUrl "http://localhost:6000" -Verbose

# Save output to file
pwsh -File scripts/live-test.ps1 -BaseUrl "http://localhost:6000" |
  Tee-Object -FilePath "docs/docker-live-test-output.txt"
```

**What the test script does:**

```
  live-test.ps1 Execution Flow
  ┌──────────────────────────────────────────────────┐
  │                                                    │
  │  1. POST /scim/oauth/token                         │
  │     → Get Bearer JWT token                         │
  │     (client_id=scimserver-client,                    │
  │      client_secret=changeme-oauth)                 │
  │                                                    │
  │  2. SECTION 1-2: Endpoint CRUD + Config validation │
  │     → Create/Read/Update endpoints                 │
  │     → Validate config flags                        │
  │                                                    │
  │  3. SECTION 3: SCIM User CRUD                      │
  │     → POST/GET/PUT/PATCH/DELETE /Users             │
  │     → Case-insensitivity, advanced PATCH           │
  │     → Pagination, filtering                        │
  │                                                    │
  │  4. SECTION 4: SCIM Group CRUD                     │
  │     → POST/GET/PUT/PATCH/DELETE /Groups            │
  │     → Member add/remove                            │
  │                                                    │
  │  5. SECTION 5-6: Config flags + isolation          │
  │     → Multi-member PATCH flags                     │
  │     → Endpoint endpoint isolation                    │
  │                                                    │
  │  6. SECTION 7-9: Compliance + Edge Cases           │
  │     → Discovery endpoints                          │
  │     → Content-Type, ETag, POST /.search            │
  │     → Attribute projection, filter operators       │
  │     → Error handling, edge cases                   │
  │                                                    │
  │  7. SECTION 10: Cleanup                            │
  │     → DELETE all test endpoints (cascade)          │
  │                                                    │
  │  8. FINAL SUMMARY                                  │
  │     → Tests Passed: 212 / Tests Failed: 0          │
  └──────────────────────────────────────────────────┘
```

---

### Step 5 — Cleanup

```powershell
# Stop and remove the container
docker rm -f scimserver-live-test

# (Optional) Remove the image
docker rmi scimserver:live-test
```

---

## 4. Troubleshooting

### Problem: `exec: not found` on container start

```
/usr/local/bin/docker-entrypoint.sh: exec: line 11:
/app/docker-entrypoint.sh: not found
```

**Cause:** CRLF line endings in `docker-entrypoint.sh`  
**Fix:** See [Step 1](#step-1--fix-shell-script-line-endings) — convert to LF

---

### Problem: `JWT_SECRET is required in production`

```
Error: JWT_SECRET is required in production to sign OAuth tokens.
```

**Cause:** Missing required env var when `NODE_ENV=production`  
**Fix:** Add `-e JWT_SECRET=<any-secure-string>` to `docker run`

---

### Problem: `OAUTH_CLIENT_SECRET is required in production`

```
Error: OAUTH_CLIENT_SECRET is required in production to secure OAuth access.
```

**Cause:** Missing required env var when `NODE_ENV=production`  
**Fix:** Add `-e OAUTH_CLIENT_SECRET=changeme-oauth` (must match test script's `client_secret`)

---

### Problem: `SCIM shared secret not configured` (401)

```json
{"detail":"SCIM shared secret not configured.","status":"401"}
```

**Cause:** `SCIM_SHARED_SECRET` not set in production mode  
**Fix:** Add `-e SCIM_SHARED_SECRET=<any-string>` to `docker run`

---

### Problem: Port 6000 already in use

```
docker: Error response from daemon: ports are not available:
listen tcp 0.0.0.0:6000: bind: Only one usage of each socket address
```

**Fix:**
```powershell
# Find what's using port 6000
Get-NetTCPConnection -LocalPort 6000 | ForEach-Object {
    Get-Process -Id $_.OwningProcess
}

# Kill it (if it's a dev instance)
Stop-Process -Id <PID> -Force

# Or use a different port
docker run -p 7000:8080 ...
pwsh -File scripts/live-test.ps1 -BaseUrl "http://localhost:7000"
```

---

### Problem: Docker Desktop not running

```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```

**Fix:**
```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
# Wait ~30-60 seconds for the daemon
docker info  # Should succeed when ready
```

---

# Part 2 — Docker Deployment Guide

## 5. Architecture Overview

### Full System Architecture (Container)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Docker Container (Alpine Linux)                   │
│                        User: scim:nodejs (non-root)                      │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     docker-entrypoint.sh                         │    │
│  │  1. Restore DB from Azure Files backup (if exists)               │    │
│  │  2. Attempt blob snapshot restore (if configured)                │    │
│  │  3. Run prisma migrate deploy                                    │    │
│  │  4. Create initial backup (if new DB)                            │    │
│  │  5. exec node dist/main.js                                      │    │
│  └───────────────────────────┬─────────────────────────────────────┘    │
│                              │                                           │
│  ┌───────────────────────────▼─────────────────────────────────────┐    │
│  │                    NestJS Application (:8080)                    │    │
│  │                                                                   │    │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────────────────┐   │    │
│  │  │ OAuth      │  │ Admin API  │  │ SCIM API                  │   │    │
│  │  │ /oauth/    │  │ /admin/    │  │ /endpoints/{id}/Users     │   │    │
│  │  │ token      │  │ endpoints  │  │ /endpoints/{id}/Groups    │   │    │
│  │  └────────────┘  └────────────┘  │ /endpoints/{id}/.search   │   │    │
│  │                                   │ /ServiceProviderConfig    │   │    │
│  │                                   └──────────────────────────┘   │    │
│  │                                                                   │    │
│  │  ┌───────────────────────────────────────────────────────────┐   │    │
│  │  │ Prisma ORM + SQLite                                        │   │    │
│  │  │                                                             │   │    │
│  │  │ Primary:  /tmp/local-data/scim.db  (ephemeral, fast I/O)   │   │    │
│  │  │ Backup:   /app/data/scim.db        (Azure Files mount)     │   │    │
│  │  │ Interval: Every 5 minutes                                   │   │    │
│  │  └───────────────────────────────────────────────────────────┘   │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│ EXPOSE 8080 │  HEALTHCHECK /health  │  Max Heap: 384 MB                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Available Dockerfiles

| File | Purpose | Base Image | Use Case |
|------|---------|------------|----------|
| `Dockerfile` | **Production** (root, multi-stage) | `node:24-alpine` | Full build: web + api + runtime |
| `api/Dockerfile` | API-only build | `node:24-alpine` | Standalone API without web frontend |
| `api/Dockerfile.multi` | API multi-stage | `node:24-alpine` | API with optimized layers |
| `Dockerfile.optimized` | Size-optimized | `node:24-alpine` | Smaller image variant |
| `Dockerfile.ultra` | Ultra-minimal | `node:24-alpine` | Smallest possible image |
| `docker-compose.debug.yml` | **Development** | `node:24` | Hot-reload + debugger on `:9229` |

---

## 6. Multi-Stage Build Explained

### Stage 1: `web-build` — Frontend Compilation

```dockerfile
FROM node:24-alpine AS web-build
WORKDIR /web
COPY web/package*.json ./        # Leverage Docker cache for deps
RUN npm ci --no-audit --no-fund  # Deterministic install
COPY web/ ./                     # Copy source
RUN npm run build                # Vite → dist/ (HTML + JS + CSS)
RUN rm -rf node_modules          # Cleanup in same layer
```

**Output:** `dist/` directory with compiled React + Vite frontend  
**Size contribution:** ~270 KB (just static assets)

### Stage 2: `api-build` — Backend Compilation

```dockerfile
FROM node:24-alpine AS api-build
WORKDIR /app
RUN apk add --no-cache openssl            # Required by Prisma
COPY api/package*.json ./
RUN npm ci --no-audit --no-fund            # Install all deps (dev + prod)
COPY api/ ./
COPY --from=web-build /web/dist ./public   # ← Embed frontend
RUN npx prisma generate && \               # Generate Prisma client
    npx prisma db push && \                # Init empty SQLite DB
    npx tsc -p tsconfig.build.json         # Compile TypeScript → dist/
RUN npm prune --production                 # Remove dev dependencies
```

**Output:** `dist/`, `node_modules/` (production only), `prisma/`, `public/`

### Stage 3: `runtime` — Minimal Production Image

```dockerfile
FROM node:24-alpine AS runtime
WORKDIR /app

# Security: non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S scim -u 1001

# Copy only what's needed for production
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/dist ./dist
COPY --from=api-build /app/public ./public
COPY --from=api-build /app/prisma ./prisma
COPY --from=api-build /app/package.json ./package.json
COPY api/docker-entrypoint.sh /app/

USER scim        # Run as non-root
EXPOSE 8080
CMD ["/app/docker-entrypoint.sh"]
```

### Layer Size Breakdown

```
┌─────────────────────────────────────────────────┐
│  Final Image: ~496 MB                            │
│                                                   │
│  ┌──────────────────────────────┐  ≈174 MB       │
│  │ node:24-alpine base          │                 │
│  └──────────────────────────────┘                 │
│  ┌──────────────────────────────┐  ≈310 MB       │
│  │ node_modules (production)     │                 │
│  └──────────────────────────────┘                 │
│  ┌──────────────────────────────┐  ≈10 MB        │
│  │ dist/ (compiled JS)           │                 │
│  └──────────────────────────────┘                 │
│  ┌──────────────────────────────┐  ≈270 KB       │
│  │ public/ (web assets)          │                 │
│  └──────────────────────────────┘                 │
│  ┌──────────────────────────────┐  ≈50 KB        │
│  │ prisma/ (schema + migrations) │                 │
│  └──────────────────────────────┘                 │
└─────────────────────────────────────────────────┘
```

---

## 7. Container Entrypoint & Storage

### Entrypoint Flow (`docker-entrypoint.sh`)

```
  Container Start
       │
       ▼
  ┌──────────────────────────────┐
  │ 1. Create /tmp/local-data/   │  mkdir -p (ephemeral, fast I/O)
  └──────────────┬───────────────┘
                 │
       ┌─────────▼──────────┐
       │ Azure Files backup  │
       │ /app/data/scim.db   │
       │ exists?             │
       └──┬──────────┬──────┘
        YES          NO
       ┌──▼──────┐  ┌▼─────────────────────┐
       │ Restore  │  │ Blob backup account   │
       │ to /tmp/ │  │ configured?           │
       └──┬──────┘  └──┬──────────┬─────────┘
          │           YES          NO
          │        ┌───▼────────┐  │
          │        │ Attempt    │  │
          │        │ blob       │  │
          │        │ restore    │  │
          │        └───┬────────┘  │
          │            │           │
          ▼            ▼           ▼
  ┌────────────────────────────────────┐
  │ 2. prisma migrate deploy           │  Apply pending migrations
  └──────────────┬─────────────────────┘
                 │
  ┌──────────────▼─────────────────────┐
  │ 3. Create initial backup           │  If no Azure Files backup exists
  │    cp /tmp/scim.db → /app/data/    │
  └──────────────┬─────────────────────┘
                 │
  ┌──────────────▼─────────────────────┐
  │ 4. exec node dist/main.js          │  Start NestJS (PID 1)
  │    └─ BackupService runs every 5m  │
  └────────────────────────────────────┘
```

### Storage Architecture

```
  ┌────────────────────────────────────────────────────────┐
  │  Container filesystem                                   │
  │                                                         │
  │  /tmp/local-data/scim.db    ← PRIMARY (fast, ephemeral)│
  │    ├── Read/write by NestJS                             │
  │    ├── Lost on container restart                        │
  │    └── tmpfs performance                                │
  │                                                         │
  │  /app/data/scim.db          ← BACKUP (persistent)      │
  │    ├── Azure Files mount point                          │
  │    ├── Synced every 5 minutes                           │
  │    └── Survives container restarts                      │
  │                                                         │
  │  [Optional] Blob Storage    ← SNAPSHOT (offsite)        │
  │    ├── Configured via BLOB_BACKUP_ACCOUNT               │
  │    └── Used for disaster recovery                       │
  └────────────────────────────────────────────────────────┘
```

---

## 8. Environment Variables Reference

### Required in Production (`NODE_ENV=production`)

| Variable | Purpose | Example Value |
|----------|---------|---------------|
| `JWT_SECRET` | Signs OAuth 2.0 JWT tokens | `my-super-secret-jwt-key-123` |
| `OAUTH_CLIENT_SECRET` | Client credentials grant password | `changeme-oauth` |
| `SCIM_SHARED_SECRET` | Admin API bearer token authentication | `my-admin-secret` |

### Optional / Configurable

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `80` (container) / `3000` (dev) | HTTP listen port |
| `NODE_ENV` | `development` | `production` enables strict secret checks |
| `DATABASE_URL` | `file:./data.db` | Prisma database connection string |
| `API_PREFIX` | `scim` | URL prefix for all routes |
| `BLOB_BACKUP_ACCOUNT` | _(empty)_ | Azure Blob storage account for snapshots |
| `NODE_OPTIONS` | `--max_old_space_size=384` | Node.js heap limit |
| `IMAGE_TAG` | `unknown` | Build-time arg written to `/app/.image-tag` |

### Security Matrix

```
  ┌──────────────────────────────────────────────────────────┐
  │  ENV VAR                  │ Development │ Production     │
  │──────────────────────────│─────────────│────────────────│
  │  JWT_SECRET               │ Auto-gen    │ ⚠ REQUIRED     │
  │  OAUTH_CLIENT_SECRET      │ Auto-gen    │ ⚠ REQUIRED     │
  │  SCIM_SHARED_SECRET       │ Auto-gen    │ ⚠ REQUIRED     │
  │  NODE_ENV                 │ development │ production     │
  └──────────────────────────────────────────────────────────┘
  
  In development mode, all secrets are auto-generated and logged.
  In production mode, missing secrets cause immediate startup failure.
```

---

## 9. Deployment Configurations

### A. Local Development (Docker Compose)

```yaml
# docker-compose.debug.yml
version: '3.8'
services:
  api:
    image: node:24
    container_name: scimserver-api-dev
    working_dir: /usr/src/app
    volumes:
      - ./api:/usr/src/app:rw           # Live source mount
      - /usr/src/app/node_modules       # Isolated node_modules
    ports:
      - "3000:3000"    # SCIM API
      - "9229:9229"    # Node.js debugger
    environment:
      NODE_ENV: development
      PORT: 3000
      NODE_OPTIONS: "--inspect=0.0.0.0:9229"
    command: bash -lc "npm ci && npx prisma generate && npm run start:dev"
```

**Run:**
```powershell
docker compose -f docker-compose.debug.yml up
```

Features: Hot reload via `ts-node-dev`, VS Code debugger attachment on `:9229`

---

### B. Local Testing (Production Image)

```powershell
docker build -t scimserver:live-test -f Dockerfile .

docker run -d --name scimserver-test -p 6000:8080 `
  -e PORT=8080 `
  -e NODE_ENV=production `
  -e JWT_SECRET=test-jwt-secret `
  -e OAUTH_CLIENT_SECRET=changeme-oauth `
  -e SCIM_SHARED_SECRET=test-secret `
  scimserver:live-test
```

Features: Matches production behavior, ephemeral SQLite, no volume mounts

---

### C. Production with Persistent Storage

```powershell
docker run -d --name scimserver-prod -p 443:8080 `
  -e NODE_ENV=production `
  -e JWT_SECRET="$(openssl rand -base64 32)" `
  -e OAUTH_CLIENT_SECRET="$(openssl rand -base64 32)" `
  -e SCIM_SHARED_SECRET="$(openssl rand -base64 32)" `
  -v scimserver-data:/app/data `
  --restart unless-stopped `
  scimserver:latest
```

Features: Named volume for persistent backup, auto-restart, random secrets

---

## 10. Production Deployment

### Azure Container Apps

```powershell
# Tag and push to ACR
docker tag scimserver:live-test myregistry.azurecr.io/scimserver:v0.10.0
docker push myregistry.azurecr.io/scimserver:v0.10.0

# Deploy (see scripts/deploy-azure.ps1 for full automation)
az containerapp update --name scimserver --resource-group my-rg \
  --image myregistry.azurecr.io/scimserver:v0.10.0
```

### Health Check

The container includes a built-in health check:

```dockerfile
HEALTHCHECK --interval=60s --timeout=3s --start-period=10s --retries=2 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health', r => {
    process.exit(r.statusCode === 200 ? 0 : 1)
  }).on('error', () => process.exit(1))"
```

### Security Hardening Checklist

- [x] Non-root user (`scim:nodejs`, UID 1001)
- [x] Alpine Linux (minimal attack surface)
- [x] Production secrets required (no defaults)
- [x] `npm prune --production` (no dev deps in image)
- [x] Source code removed (only `dist/` in runtime stage)
- [x] Test files removed from `node_modules`
- [x] Source maps removed (`*.map`)
- [x] Heap size limited (`--max_old_space_size=384`)

---

# Part 3 — Live Test Results Report

## 11. Test Summary Dashboard

```
╔══════════════════════════════════════════════════════════════════╗
║                    DOCKER LIVE TEST REPORT                       ║
║                    February 11, 2026                             ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   Target:     Docker container (scimserver:live-test)              ║
║   Base URL:   http://localhost:6000                              ║
║   Image:      496 MB (node:24-alpine, multi-stage)               ║
║   Container:  scimserver-live-test (port 6000 → 80)               ║
║                                                                  ║
║   ┌─────────────────────────────────────────────────────────┐   ║
║   │                                                           │   ║
║   │   Tests Passed:  212  ████████████████████████████ 100%  │   ║
║   │   Tests Failed:    0  ░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  │   ║
║   │   Total Tests:   212                                      │   ║
║   │   Duration:      4.9s                                     │   ║
║   │                                                           │   ║
║   │   Status:  ✅ ALL TESTS PASSED                            │   ║
║   │                                                           │   ║
║   └─────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 12. Detailed Test Results by Section

### Section 1: Endpoint CRUD Operations (7 ✅)

| # | Test | Result |
|---|------|--------|
| 1 | Create endpoint returned valid ID | ✅ |
| 2 | New endpoint is active by default | ✅ |
| 3 | scimEndpoint URL is correct | ✅ |
| 4 | Get endpoint by ID returns correct data | ✅ |
| 5 | Get endpoint by name returns correct data | ✅ |
| 6 | List endpoints returns array with items | ✅ |
| 7 | Update endpoint displayName and description | ✅ |

### Section 2: Config Validation (13 ✅)

| # | Test | Result |
|---|------|--------|
| 8 | Invalid config 'Yes' rejected with 400 | ✅ |
| 9 | Invalid config 'enabled' rejected with 400 | ✅ |
| 10 | Valid config 'False' accepted | ✅ |
| 11 | Boolean true accepted as config value | ✅ |
| 12 | Invalid remove config 'Yes' rejected | ✅ |
| 13 | Invalid remove config 'enabled' rejected | ✅ |
| 14 | Valid remove config 'False' accepted | ✅ |
| 15 | Both add and remove config flags set together | ✅ |
| 16 | Invalid VerbosePatchSupported 'Yes' rejected | ✅ |
| 17 | VerbosePatchSupported boolean true accepted | ✅ |
| 18 | All three config flags set together | ✅ |
| 19 | Stats includes totalUsers | ✅ |
| 20 | Stats includes totalGroups | ✅ |

### Section 3: SCIM User Operations (14 ✅)

| # | Test | Result |
|---|------|--------|
| 21 | Create user returned valid UUID | ✅ |
| 22 | User userName is correct | ✅ |
| 23 | User meta.resourceType is 'User' | ✅ |
| 24 | User meta.location present and correct path | ✅ |
| 25 | User meta.created present | ✅ |
| 26 | User meta.lastModified present | ✅ |
| 27 | Get user by ID returns correct data | ✅ |
| 28 | List users returns at least 1 user | ✅ |
| 29 | List users has correct ListResponse schema | ✅ |
| 30 | Filter by userName returns exactly 1 user | ✅ |
| 31 | PATCH user displayName works | ✅ |
| 32 | PUT user (replace) works | ✅ |
| 33 | Deactivate user (active=false) works | ✅ |

### Section 3b: Case-Insensitivity — RFC 7643 (7 ✅)

| # | Test | Result |
|---|------|--------|
| 34 | UPPERCASE duplicate userName → 409 | ✅ |
| 35 | Mixed-case duplicate userName → 409 | ✅ |
| 36 | Filter with 'USERNAME' finds user | ✅ |
| 37 | Filter with 'UserName' finds user | ✅ |
| 38 | Filter with UPPERCASE value finds user | ✅ |
| 39 | PATCH with 'Replace' (PascalCase) works | ✅ |
| 40 | PATCH with 'Add' (PascalCase) works | ✅ |

### Section 3c: Advanced PATCH Operations (13 ✅)

| # | Test | Result |
|---|------|--------|
| 41 | No-path merge: displayName | ✅ |
| 42 | No-path merge: active | ✅ |
| 43 | No-path with PascalCase key 'DisplayName' | ✅ |
| 44 | ValuePath: emails[type eq "work"].value | ✅ |
| 45 | ValuePath doesn't affect other entries | ✅ |
| 46 | Extension URN path sets department | ✅ |
| 47 | Extension URN replace updates department | ✅ |
| 48 | Manager set via extension URN | ✅ |
| 49 | Manager removed on empty value (RFC 7644 §3.5.2.3) | ✅ |
| 50 | Multi-op PATCH: displayName | ✅ |
| 51 | Multi-op PATCH: active set to false | ✅ |
| 52 | Multi-op PATCH: title added | ✅ |

### Section 3d: Pagination & Advanced Filtering (10 ✅)

| # | Test | Result |
|---|------|--------|
| 53 | Pagination: itemsPerPage matches count=2 | ✅ |
| 54 | Pagination: totalResults >= 4 | ✅ |
| 55 | Pagination: Resources array has 2 items | ✅ |
| 56 | Pagination: startIndex=2 reflected | ✅ |
| 57 | Pagination: startIndex+count returns correct page | ✅ |
| 58 | Filter by externalId returns exactly 1 | ✅ |
| 59 | Filtered user has correct externalId | ✅ |
| 60 | Filter with 'EXTERNALID' (uppercase) finds user | ✅ |
| 61 | Duplicate externalId → 409 Conflict | ✅ |

### Section 4: SCIM Group Operations (14 ✅)

| # | Test | Result |
|---|------|--------|
| 62 | Create group returned valid UUID | ✅ |
| 63 | Group displayName correct | ✅ |
| 64 | Group meta.resourceType is 'Group' | ✅ |
| 65 | Group meta.location present and correct | ✅ |
| 66 | Group meta.created present | ✅ |
| 67 | Get group by ID returns correct data | ✅ |
| 68 | List groups returns at least 1 | ✅ |
| 69 | PATCH add member returns body | ✅ |
| 70 | PATCH add member works | ✅ |
| 71 | PATCH remove member returns body | ✅ |
| 72 | PATCH remove member works | ✅ |
| 73 | PUT group (replace) works | ✅ |
| 74 | Group with externalId created | ✅ |
| 75 | Filter groups by externalId works | ✅ |
| 76 | Duplicate group externalId → 409 | ✅ |

### Section 5: Multi-Member PATCH Config Flag (4 ✅)

| # | Test | Result |
|---|------|--------|
| 77 | Multi-member PATCH with flag=True accepted (3 members) | ✅ |
| 78 | Multi-member ADD without flag → 400 | ✅ |
| 79 | Multi-member REMOVE without flag → 400 | ✅ |
| 80 | Multi-member REMOVE with flag=True accepted | ✅ |

### Section 6: Endpoint Isolation (2 ✅)

| # | Test | Result |
|---|------|--------|
| 81 | Same userName in different endpoints (isolation) | ✅ |
| 82 | Endpoints have isolated user data | ✅ |

### Section 7: Inactive Endpoint Blocking (6 ✅)

| # | Test | Result |
|---|------|--------|
| 83 | Endpoint deactivated successfully | ✅ |
| 84 | GET User → 403 on inactive endpoint | ✅ |
| 85 | POST User → 403 on inactive endpoint | ✅ |
| 86 | GET Groups → 403 on inactive endpoint | ✅ |
| 87 | Inactive endpoint in active=false filter | ✅ |
| 88 | GET User works after reactivation | ✅ |

### Section 8: Discovery Endpoints (3 ✅)

| # | Test | Result |
|---|------|--------|
| 89 | ServiceProviderConfig has correct schema | ✅ |
| 90 | Schemas endpoint returns schemas | ✅ |
| 91 | ResourceTypes endpoint returns resource types | ✅ |

### Section 8b: Content-Type & Auth (6 ✅)

| # | Test | Result |
|---|------|--------|
| 92 | Response Content-Type is `application/scim+json` | ✅ |
| 93 | POST Content-Type is `application/scim+json` | ✅ |
| 94 | POST status code is 201 | ✅ |
| 95 | Missing Authorization → 401 | ✅ |
| 96 | Invalid Bearer token → 401 | ✅ |
| 97 | Token without 'Bearer ' prefix → 401 | ✅ |

### Section 9: Error Handling (4 ✅)

| # | Test | Result |
|---|------|--------|
| 98 | Non-existent user → 404 | ✅ |
| 99 | Non-existent group → 404 | ✅ |
| 100 | Non-existent endpoint → 404 | ✅ |
| 101 | Invalid endpoint name → 400 | ✅ |

### Section 9b: RFC 7644 Compliance (12 ✅)

| # | Test | Result |
|---|------|--------|
| 102 | POST /Users → 201 + Location header | ✅ |
| 103 | Location header matches meta.location | ✅ |
| 104 | POST /Groups → 201 + Location header | ✅ |
| 105 | Error returns 404 status code | ✅ |
| 106 | Error Content-Type is scim+json | ✅ |
| 107 | Error has SCIM Error schema | ✅ |
| 108 | Error status is string '404' | ✅ |
| 109 | Error includes detail message | ✅ |
| 110 | 409 Content-Type is scim+json | ✅ |
| 111 | 409 status is string '409' | ✅ |
| 112 | PATCH updates meta.lastModified | ✅ |
| 113 | GET does not change meta.lastModified | ✅ |

### Section 9c: POST /.search — RFC 7644 §3.4.3 (16 ✅)

| # | Test | Result |
|---|------|--------|
| 114 | POST /Users/.search returns ListResponse | ✅ |
| 115 | POST /.search finds user via filter | ✅ |
| 116 | POST /.search includes startIndex | ✅ |
| 117 | POST /.search includes itemsPerPage | ✅ |
| 118 | POST /.search returns HTTP 200 (not 201) | ✅ |
| 119 | POST /.search Content-Type is scim+json | ✅ |
| 120 | POST /.search with attributes includes userName | ✅ |
| 121 | POST /.search always returns id | ✅ |
| 122 | POST /.search always returns schemas | ✅ |
| 123 | POST /.search excludes non-requested attrs | ✅ |
| 124 | excludedAttributes keeps userName | ✅ |
| 125 | excludedAttributes removes emails | ✅ |
| 126 | POST /.search without filter lists users | ✅ |
| 127 | POST /.search respects count param | ✅ |
| 128 | POST /Groups/.search returns ListResponse | ✅ |
| 129 | POST /Groups/.search finds group via filter | ✅ |
| 130 | Groups /.search excludedAttributes removes members | ✅ |
| 131 | Groups /.search excludedAttributes keeps displayName | ✅ |

### Section 9d: Attribute Projection — RFC 7644 §3.4.2.5 (20 ✅)

| # | Test | Result |
|---|------|--------|
| 132 | GET /Users?attributes works | ✅ |
| 133 | attributes includes userName | ✅ |
| 134 | attributes always returns id | ✅ |
| 135 | attributes always returns schemas | ✅ |
| 136 | attributes excludes emails | ✅ |
| 137 | attributes excludes active | ✅ |
| 138 | GET User by ID with attributes includes userName | ✅ |
| 139 | GET User by ID with attributes always returns id | ✅ |
| 140 | GET User by ID with attributes always returns meta | ✅ |
| 141 | GET User by ID with attributes excludes displayName | ✅ |
| 142 | excludedAttributes keeps userName | ✅ |
| 143 | excludedAttributes always keeps id | ✅ |
| 144 | excludedAttributes removes emails | ✅ |
| 145 | excludedAttributes removes phoneNumbers | ✅ |
| 146 | excludedAttributes always keeps id (never excluded) | ✅ |
| 147 | excludedAttributes always keeps schemas (never excluded) | ✅ |
| 148 | GET /Groups attributes includes displayName | ✅ |
| 149 | GET /Groups attributes excludes members | ✅ |
| 150 | Precedence: attributes includes userName | ✅ |
| 151 | Precedence: attributes wins over excludedAttributes | ✅ |

### Section 9e: ETag & Conditional Requests — RFC 7644 §3.14 (12 ✅)

| # | Test | Result |
|---|------|--------|
| 152 | GET /Users/:id includes ETag header | ✅ |
| 153 | ETag is weak format `W/"..."` | ✅ |
| 154 | meta.version matches ETag header | ✅ |
| 155 | GET /Groups/:id includes ETag header | ✅ |
| 156 | Group ETag is weak format | ✅ |
| 157 | If-None-Match matching ETag → 304 | ✅ |
| 158 | If-None-Match stale ETag → 200 | ✅ |
| 159 | PATCH response includes ETag | ✅ |
| 160 | ETag changes after PATCH | ✅ |
| 161 | Old ETag after modification → 200 | ✅ |
| 162 | POST /Users includes ETag (201 + ETag) | ✅ |
| 163 | PUT /Users includes ETag | ✅ |
| 164 | ServiceProviderConfig etag.supported = true | ✅ |

### Section 9f: PatchOpAllowRemoveAllMembers (4 ✅)

| # | Test | Result |
|---|------|--------|
| 165 | Blanket remove blocked when flag=False | ✅ |
| 166 | Members intact after blocked remove | ✅ |
| 167 | Targeted remove with filter works (flag=False) | ✅ |
| 168 | Blanket remove allowed by default | ✅ |

### Section 9g: Filter Operators (10 ✅)

| # | Test | Result |
|---|------|--------|
| 169 | `co` (contains) finds users | ✅ |
| 170 | `co` is case-insensitive | ✅ |
| 171 | `sw` (startsWith) finds users | ✅ |
| 172 | `sw` returns 0 for non-matching prefix | ✅ |
| 173 | `pr` (presence) finds users with externalId | ✅ |
| 174 | `pr` on displayName finds users | ✅ |
| 175 | Compound `and` filter works | ✅ |
| 176 | Compound `and` returns 0 when condition fails | ✅ |
| 177 | Group displayName `co` filter works | ✅ |

### Section 9h: Edge Cases (9 ✅)

| # | Test | Result |
|---|------|--------|
| 178 | Empty Operations array → 400 | ✅ |
| 179 | Remove non-existent attribute succeeds silently | ✅ |
| 180 | PATCH 'add' no path merges displayName | ✅ |
| 181 | PATCH 'add' no path merges title | ✅ |
| 182 | Filter on non-existent attribute → 0 results | ✅ |
| 183 | ServiceProviderConfig includes all capabilities | ✅ |

### Section 9i: VerbosePatchSupported Dot-Notation (5 ✅)

| # | Test | Result |
|---|------|--------|
| 184 | Dot-notation `name.givenName` resolves to nested | ✅ |
| 185 | Dot-notation doesn't affect sibling (familyName) | ✅ |
| 186 | Dot-notation 'add' sets `name.middleName` | ✅ |
| 187 | Dot-notation 'remove' deletes `name.middleName` | ✅ |
| 188 | Standard SCIM paths work without flag | ✅ |

### Section 10: Delete & Cleanup (9 ✅)

| # | Test | Result |
|---|------|--------|
| 189 | DELETE user → 204, not found after | ✅ |
| 190 | DELETE group works | ✅ |
| 191–197 | All 7 test endpoints cascade deleted | ✅ |

---

## 13. RFC Compliance Coverage Matrix

| RFC Section | Feature | Tests | Status |
|-------------|---------|-------|--------|
| RFC 7644 §3.1 | Content-Type: `application/scim+json` | 3 | ✅ |
| RFC 7644 §3.1 | Location header on 201 Created | 4 | ✅ |
| RFC 7643 §2.1 | Case-insensitive attribute names | 7 | ✅ |
| RFC 7644 §3.4.2.2 | Filter: `eq`, `co`, `sw`, `pr`, `and` | 10 | ✅ |
| RFC 7644 §3.4.2.5 | Attribute projection (include/exclude) | 20 | ✅ |
| RFC 7644 §3.4.3 | POST /.search | 16 | ✅ |
| RFC 7644 §3.5.2 | PATCH: add, replace, remove | 13 | ✅ |
| RFC 7644 §3.5.2 | PATCH: valuePath, extension URN, no-path | 13 | ✅ |
| RFC 7644 §3.5.2.3 | Empty-value removal (manager) | 2 | ✅ |
| RFC 7644 §3.12 | Error response format (string status) | 12 | ✅ |
| RFC 7644 §3.14 | ETag + conditional requests (304/412) | 12 | ✅ |
| RFC 7644 §4 | Discovery: ServiceProviderConfig, Schemas, ResourceTypes | 3 | ✅ |
| — | Authentication (OAuth 2.0 bearer) | 4 | ✅ |
| — | Multi-endpoint endpoint isolation | 2 | ✅ |
| — | Inactive endpoint blocking (403) | 6 | ✅ |
| — | Config flag validation | 13 | ✅ |
| — | Pagination (startIndex, count) | 5 | ✅ |
| — | Uniqueness constraints (userName, externalId) | 4 | ✅ |
| — | Edge cases & error handling | 9 | ✅ |
| — | Dot-notation PATCH support | 5 | ✅ |
| **TOTAL** | | **212** | **✅ 100%** |

---

> **Generated:** February 11, 2026  
> **Environment:** Docker container `scimserver:live-test` (Alpine Linux, node:24-alpine)  
> **Raw output:** [docker-live-test-output-2026-02-11.txt](docker-live-test-output-2026-02-11.txt)
