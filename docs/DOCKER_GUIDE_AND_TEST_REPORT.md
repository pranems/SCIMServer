# Docker Guide

> **Version:** 0.40.0 - **Updated:** April 28, 2026  
> **Source of truth:** [Dockerfile](../Dockerfile), [docker-compose.yml](../docker-compose.yml)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Docker Compose](#docker-compose)
- [Dockerfile (Production)](#dockerfile-production)
- [Docker Compose Debug](#docker-compose-debug)
- [Environment Variables](#environment-variables)
- [Health Check](#health-check)
- [Docker Entrypoint](#docker-entrypoint)
- [Running Tests Against Docker](#running-tests-against-docker)
- [Building the Image Manually](#building-the-image-manually)
- [Pre-Built Image](#pre-built-image)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Clone and start
git clone https://github.com/your-org/SCIMServer.git
cd SCIMServer
docker compose up --build -d

# Verify
curl http://localhost:8080/health
# {"status":"ok","uptime":5,"timestamp":"2026-04-24T10:00:00.000Z"}

# Create an endpoint and start using SCIM
curl -X POST http://localhost:8080/scim/admin/endpoints \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","profilePreset":"entra-id"}'
```

---

## Architecture

```mermaid
flowchart LR
    subgraph Docker Compose
        subgraph api [API Container - node:24-alpine]
            NestJS[NestJS App<br>Port 8080]
            Prisma[Prisma Client]
            React[React UI<br>/admin]
        end
        subgraph pg [PostgreSQL Container - postgres:17-alpine]
            DB[(scimdb)]
        end
    end
    Client[SCIM Client] -->|:8080| NestJS
    NestJS --> Prisma
    Prisma --> DB
```

---

## Docker Compose

### docker-compose.yml

```yaml
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
      interval: 3s
      timeout: 3s
      retries: 10

  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      PERSISTENCE_BACKEND: prisma
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
      SCIM_SHARED_SECRET: changeme-scim
      JWT_SECRET: changeme-jwt
      OAUTH_CLIENT_SECRET: changeme-oauth
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

### Commands

```bash
# Start (build if needed)
docker compose up --build -d

# View logs
docker compose logs -f api

# Stop
docker compose down

# Stop and remove volumes (fresh start)
docker compose down -v

# Rebuild after code changes
docker compose up --build -d --force-recreate
```

---

## Dockerfile (Production)

4-stage multi-stage build optimized for minimal image size:

```mermaid
flowchart TD
    S1[Stage 1: web-build<br>node:24-alpine] -->|dist/| S4
    S2[Stage 2: api-build<br>node:24-alpine] -->|dist/ + prisma/| S4
    S3[Stage 3: prod-deps<br>node:24-alpine] -->|node_modules/| S4
    S4[Stage 4: runtime<br>node:24-alpine<br>Non-root user 'scim'<br>Port 8080]
```

| Stage | Purpose | Key Operations |
|-------|---------|---------------|
| `web-build` | Frontend | `cd web && npm ci && npm run build` |
| `api-build` | Backend | `cd api && npm ci && npx prisma generate && npm run build` |
| `prod-deps` | Dependencies | `npm ci --omit=dev` + aggressive cleanup (removes non-PG WASM, TypeScript, `*.map`, `@types`) |
| `runtime` | Final image | Copies dist, node_modules, prisma, public assets. Non-root `scim` user. 384MB heap limit |

### Runtime Configuration

| Setting | Value |
|---------|-------|
| Base image | `node:24-alpine` |
| User | `scim` (non-root, UID 1001) |
| Port | 8080 |
| Heap limit | 384 MB (`--max-old-space-size=384`) |
| Entrypoint | `docker-entrypoint.sh` |
| Health check | `GET /scim/health` every 30s |

---

## Docker Compose Debug

For development with live reload and Node.js inspector:

```yaml
# docker-compose.debug.yml
services:
  api:
    image: node:24
    volumes:
      - ./api:/app
    working_dir: /app
    ports:
      - "3000:3000"    # API
      - "9229:9229"    # Node inspector
    command: sh -c "npm ci && npx prisma generate && npm run start:dev"
    environment:
      PERSISTENCE_BACKEND: prisma
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
```

```bash
docker compose -f docker-compose.debug.yml up -d
```

Attach VS Code debugger to `localhost:9229`.

---

## Environment Variables

Set in `docker-compose.yml` under `api.environment`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PERSISTENCE_BACKEND` | No | `prisma` | `prisma` or `inmemory` |
| `DATABASE_URL` | Yes (prisma) | - | PostgreSQL connection string |
| `SCIM_SHARED_SECRET` | Yes (prod) | - | Global bearer token |
| `JWT_SECRET` | Yes (prod) | - | JWT signing key |
| `OAUTH_CLIENT_SECRET` | Yes (prod) | - | OAuth client secret |
| `OAUTH_CLIENT_ID` | No | `scimserver-client` | OAuth client identifier |
| `PORT` | No | `8080` | HTTP port |
| `NODE_ENV` | No | `production` | Environment mode |
| `LOG_LEVEL` | No | `INFO` | Log level |

---

## Health Check

The Dockerfile includes a health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/scim/health || exit 1
```

Check health status:

```bash
docker inspect --format='{{.State.Health.Status}}' scimserver-api-1
# healthy
```

---

## Docker Entrypoint

The `docker-entrypoint.sh` script runs at container startup:

1. Prints `DATABASE_URL` (or "(not set)")
2. If `PERSISTENCE_BACKEND=inmemory`, skips migrations
3. Otherwise runs `npx prisma migrate deploy` (applies pending migrations)
4. Starts app with `exec node dist/main.js`

---

## Running Tests Against Docker

```bash
# Start Docker Compose
docker compose up --build -d

# Wait for healthy
docker compose ps  # check STATUS = healthy

# Run live tests
cd scripts
pwsh ./live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "changeme-oauth"

# Run Lexmark ISV tests
pwsh ./lexmark-live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "changeme-oauth"
```

---

## Building the Image Manually

```bash
# Build with tag
docker build -t scimserver:latest .

# Build with image tag arg
docker build --build-arg IMAGE_TAG=0.40.0 -t scimserver:0.40.0 .

# Run standalone (requires external PostgreSQL)
docker run -d \
  -p 8080:8080 \
  -e DATABASE_URL=postgresql://scim:scim@host.docker.internal:5432/scimdb \
  -e SCIM_SHARED_SECRET=my-secret \
  -e JWT_SECRET=my-jwt-secret \
  -e OAUTH_CLIENT_SECRET=my-oauth-secret \
  scimserver:latest
```

---

## Pre-Built Image

```bash
# Pull latest
docker pull ghcr.io/your-org/scimserver:latest

# Pull specific version
docker pull ghcr.io/your-org/scimserver:0.40.0

# Run
docker run -d -p 8080:8080 \
  -e DATABASE_URL=postgresql://... \
  -e SCIM_SHARED_SECRET=... \
  ghcr.io/your-org/scimserver:latest
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs api

# Common issues:
# - PostgreSQL not ready: check postgres healthcheck
# - DATABASE_URL wrong: verify connection string
# - Port conflict: change host port mapping
```

### Migration errors

```bash
# Reset database (WARNING: destroys data)
docker compose down -v
docker compose up --build -d

# Or manually run migrations
docker compose exec api npx prisma migrate deploy
```

### Permission errors

The runtime container uses non-root user `scim` (UID 1001). If mounting volumes, ensure write permissions:

```bash
docker compose exec api id
# uid=1001(scim) gid=1001(scim)
```

### Memory issues

The container is configured with 384MB heap. For large datasets, increase:

```yaml
api:
  environment:
    NODE_OPTIONS: "--max-old-space-size=768"
```

### Checking database

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U scim -d scimdb

# Check tables
\dt

# Count resources
SELECT "resourceType", COUNT(*) FROM "ScimResource" GROUP BY "resourceType";
```
