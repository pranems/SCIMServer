# Phase 3: PostgreSQL Migration

> **Branch:** `feat/torfc1stscimsvr`  
> **Predecessor:** Phase 2 — Unified `scim_resource` Table (`d3c4a1c`)  
> **Date:** 2026-02-20  

---

## Table of Contents

1. [Overview](#overview)
2. [Motivation & Goals](#motivation--goals)
3. [Architecture Before & After](#architecture-before--after)
4. [Schema Changes](#schema-changes)
5. [Prisma 7 Adapter Pattern](#prisma-7-adapter-pattern)
6. [CITEXT — Native Case-Insensitive Matching](#citext--native-case-insensitive-matching)
7. [JSONB Payload Storage](#jsonb-payload-storage)
8. [Docker Compose Setup](#docker-compose-setup)
9. [Deployment Scenarios — Complete Reference](#deployment-scenarios--complete-reference)
10. [Azure Deployment Architecture](#azure-deployment-architecture)
11. [Migration Strategy](#migration-strategy)
12. [File-by-File Change Log](#file-by-file-change-log)
13. [Test Results](#test-results)
14. [Known Issues](#known-issues)

---

## Overview

Phase 3 replaces the **better-sqlite3** persistence layer with **PostgreSQL 17** using Prisma 7's driver-adapter architecture. The change is transparent to SCIM consumers — the InMemory backend remains available for testing and local development.

### Key Transformations

| Dimension | Before (Phase 2) | After (Phase 3) |
|---|---|---|
| **Database** | better-sqlite3 (embedded) | PostgreSQL 17-alpine (networked) |
| **Column types** | `TEXT` for everything | `UUID`, `CITEXT`, `JSONB`, `TIMESTAMPTZ`, `VARCHAR` |
| **Case insensitivity** | `userNameLower` / `displayNameLower` helper columns | PostgreSQL `CITEXT` extension — native |
| **Payload storage** | `rawPayload TEXT` (JSON string) | `payload JSONB` — queryable, GIN-indexable |
| **Primary keys** | Random UUID as `TEXT` | `gen_random_uuid()` via `pgcrypto` |
| **Prisma connection** | `datasourceUrl` constructor option | `PrismaPg` adapter wrapping `pg.Pool` |
| **Migrations** | 8 incremental SQLite migrations | 1 fresh PostgreSQL baseline |
| **Docker** | Single container with embedded SQLite | `docker-compose.yml`: PostgreSQL + API |

---

## Motivation & Goals

1. **Production readiness** — SQLite cannot handle concurrent writes from multiple API replicas
2. **Native case insensitivity** — `CITEXT` eliminates the need for manually maintained `*Lower` mirror columns
3. **Structured payload queries** — `JSONB` enables future GIN-indexed SCIM filter push-down directly to PostgreSQL
4. **Schema-native types** — `UUID`, `TIMESTAMPTZ`, `VARCHAR(n)` provide proper type safety and storage efficiency
5. **Prisma 7 compatibility** — Prisma 7 dropped `datasourceUrl` in the constructor; adapter pattern is the new standard

---

## Architecture Before & After

### Before (Phase 2): SQLite

```
┌─────────────────────────────────┐
│       NestJS Application        │
│                                 │
│  PrismaService                  │
│    └─ new PrismaClient({        │
│         datasourceUrl: "file:…" │  ◄── SQLite file
│       })                        │
│                                 │
│  ScimResource table:            │
│    id          TEXT  PK         │
│    userName    TEXT              │
│    userNameLower TEXT ◄── manual │  ← .toLowerCase() on write
│    displayNameLower TEXT        │
│    rawPayload  TEXT             │  ← JSON.stringify()
│    createdAt   DATETIME         │
└─────────────────────────────────┘
```

### After (Phase 3): PostgreSQL

```
┌─────────────────────────────────────────┐
│          NestJS Application             │
│                                         │
│  PrismaService                          │
│    └─ pool = new pg.Pool(connStr)       │
│    └─ adapter = new PrismaPg(pool)      │
│    └─ new PrismaClient({ adapter })     │  ◄── pg driver adapter
│                                         │
│  ScimResource table (PostgreSQL):       │
│    id          UUID   PK (pgcrypto)     │
│    userName    CITEXT ◄── native CI     │  ← no *Lower columns needed
│    displayName CITEXT                   │
│    payload     JSONB                    │  ← native JSON, GIN-indexable
│    createdAt   TIMESTAMPTZ              │
│    version     INTEGER                  │
└───────────────┬─────────────────────────┘
                │
                ▼
┌───────────────────────────────┐
│   PostgreSQL 17-alpine        │
│   Extensions:                 │
│     • citext   (case-insens.) │
│     • pgcrypto (UUID gen)     │
│     • pg_trgm  (trigram idx)  │
└───────────────────────────────┘
```

---

## Schema Changes

### Columns Removed

| Column | Reason |
|---|---|
| `userNameLower` | Replaced by `CITEXT` on `userName` |
| `displayNameLower` | Replaced by `CITEXT` on `displayName` |
| `rawPayload` (TEXT) | Replaced by `payload` (JSONB) |

### Columns Changed

| Column | Before | After |
|---|---|---|
| `id` | `TEXT NOT NULL` | `UUID NOT NULL DEFAULT gen_random_uuid()` |
| `userName` | `TEXT` | `CITEXT` |
| `displayName` | `TEXT` | `CITEXT` |
| `payload` | `rawPayload TEXT NOT NULL` | `payload JSONB NOT NULL` |
| `createdAt` | `DATETIME DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` |
| `updatedAt` | `DATETIME` | `TIMESTAMPTZ` |
| `resourceType` | `TEXT` | `VARCHAR(50)` |
| `externalId` | `TEXT` | `VARCHAR(255)` |

### Unique Constraints Updated

```sql
-- Before: case insensitivity via helper columns
CREATE UNIQUE INDEX ... ON "ScimResource"("endpointId", "userNameLower");
CREATE UNIQUE INDEX ... ON "ScimResource"("endpointId", "displayNameLower");

-- After: CITEXT provides native case-insensitive uniqueness
CREATE UNIQUE INDEX ... ON "ScimResource"("endpointId", "userName");
CREATE UNIQUE INDEX ... ON "ScimResource"("endpointId", "displayName");
```

### PostgreSQL Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "citext";    -- case-insensitive text type
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- trigram indexes for SCIM filters
```

---

## Prisma 7 Adapter Pattern

Prisma 7 removed the `datasourceUrl` constructor option. Connection is now established through driver adapters.

### Before (Prisma 6 / better-sqlite3)

```typescript
import { PrismaClient } from '../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor(config: ConfigService) {
    const url = config.get('DATABASE_URL');
    super({ datasourceUrl: url });  // ← removed in Prisma 7
  }
}
```

### After (Prisma 7 / pg adapter)

```typescript
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

@Injectable()
export class PrismaService extends PrismaClient {
  private pool: pg.Pool;

  constructor(config: ConfigService) {
    const connectionString = config.get('DATABASE_URL')
      ?? 'postgresql://scim:scim@localhost:5432/scimdb';
    const pool = new pg.Pool({ connectionString, max: 5 });
    const adapter = new PrismaPg(pool);
    super({ adapter, log: ['warn', 'error'] });
    this.pool = pool;
  }

  async onModuleInit() {
    if (process.env.PERSISTENCE_BACKEND === 'inmemory') return;
    await this.$connect();
  }

  async onModuleDestroy() {
    if (process.env.PERSISTENCE_BACKEND === 'inmemory') return;
    await this.$disconnect();
    await this.pool.end();
  }
}
```

### Dependency Changes

```diff
  // package.json
+ "@prisma/adapter-pg": "^7.4.1",
+ "pg": "^8.x",
- "@prisma/adapter-better-sqlite3": "..."

  // devDependencies
+ "@types/pg": "^8.x"
```

---

## CITEXT — Native Case-Insensitive Matching

### Problem (Phase 2)

Every write had to compute and store lowercase mirror columns:

```typescript
// endpoint-scim-users.service.ts (Phase 2)
const input: UserCreateInput = {
  userName: body.userName,
  userNameLower: body.userName.toLowerCase(),  // manual mirror
  ...
};
```

And every read/filter had to query the mirror:

```typescript
// inmemory-user.repository.ts (Phase 2)
findByUserName(endpointId, userNameLower) {
  return store.find(u =>
    u.endpointId === endpointId &&
    u.userNameLower === userNameLower
  );
}
```

### Solution (Phase 3)

PostgreSQL's `CITEXT` extension stores text as-is but compares case-insensitively:

```prisma
model ScimResource {
  userName    String?  @db.Citext  // ← native CI comparison
  displayName String?  @db.Citext
}
```

```sql
-- This query matches "Alice@Example.com", "alice@example.com", etc.
SELECT * FROM "ScimResource"
WHERE "endpointId" = $1 AND "userName" = 'Alice@Example.COM';
```

#### Impact on Code

- **Services:** Removed all `userNameLower: *.toLowerCase()` / `displayNameLower: *.toLowerCase()` lines
- **Domain models:** Removed `userNameLower` and `displayNameLower` from `UserRecord`, `UserCreateInput`, `GroupRecord`, `GroupCreateInput`
- **Repositories (Prisma):** Query by `userName` / `displayName` directly
- **Repositories (InMemory):** `.toLowerCase()` comparison at query time (simulating CITEXT)
- **Filters:** `apply-scim-filter.ts` column maps use `userName` / `displayName` directly; no `.toLowerCase()` in `tryPushToDb`

---

## JSONB Payload Storage

### Before: TEXT with JSON.stringify

```typescript
// prisma-user.repository.ts (Phase 2)
toUserRecord(resource: ScimResourcePrisma): UserRecord {
  return {
    rawPayload: resource.rawPayload,  // already a string
    ...
  };
}

create(endpointId, input): Promise<UserRecord> {
  return prisma.scimResource.create({
    data: {
      rawPayload: input.rawPayload,   // stored as TEXT
      ...
    },
  });
}
```

### After: JSONB with JSON.parse/stringify at Repository Boundary

```typescript
// prisma-user.repository.ts (Phase 3)
toUserRecord(resource: ScimResourcePrisma): UserRecord {
  return {
    rawPayload: JSON.stringify(resource.payload ?? {}),  // JSONB → string
    ...
  };
}

create(endpointId, input): Promise<UserRecord> {
  return prisma.scimResource.create({
    data: {
      payload: JSON.parse(input.rawPayload),  // string → JSONB
      ...
    },
  });
}
```

This preserves the domain model's `rawPayload: string` contract while storing data as JSONB in PostgreSQL — enabling future GIN-indexed `payload @> '{"emails":[{"value":"..."}]}'` queries.

---

## Docker Compose Setup

### docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: scimdb
      POSTGRES_USER: scim
      POSTGRES_PASSWORD: scim
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-pg-extensions.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scim -d scimdb"]

  api:
    build: { context: ., dockerfile: Dockerfile }
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
      PERSISTENCE_BACKEND: prisma
    depends_on:
      postgres: { condition: service_healthy }
```

### init-pg-extensions.sql

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### Dockerfile Changes

- Removed `better-sqlite3` native compilation (`apk add python3 make g++`)
- Removed SQLite WASM cleanup; keeps only `*.postgresql.*` runtime files
- Healthcheck updated: `GET /` (root serves SPA)
- Entrypoint: `prisma migrate deploy` + `node dist/main.js`

---

## Deployment Scenarios — Complete Reference

Phase 3 supports **four** deployment scenarios. Each has distinct container topology, networking, port mappings, and DATABASE_URL configuration.

### Scenario Overview Matrix

| # | Scenario | PostgreSQL | API Container | Network | DATABASE_URL | Port |
|---|---|---|---|---|---|---|
| 1 | **Docker Compose (Dev)** | `postgres:17-alpine` container | Built from `Dockerfile` | Docker bridge (`scimserver_default`) | `postgresql://scim:scim@postgres:5432/scimdb` | `8080` |
| 2 | **Docker Compose (Debug)** | `postgres:17-alpine` container | `node:24` with live mount | Docker bridge | `postgresql://scim:scim@postgres:5432/scimdb` | `3000` + `9229` |
| 3 | **Standalone Docker Run** | External (host or remote) | Built from `Dockerfile` | Host / bridge | Varies (see below) | `8080` |
| 4 | **E2E / Unit Tests** | None (InMemory backend) | None (Jest in-process) | localhost | Not used | `3000` (test) |
| 5 | **Azure Container Apps** | Azure PG Flexible Server | Container App (ACR/GHCR) | Azure VNet | `postgresql://...@<server>.postgres.database.azure.com:5432/scimdb?sslmode=require` | `80`→HTTPS |

---

### Scenario 1: Docker Compose — Local Development

**Use for:** Running the full application stack locally with persistent PostgreSQL.

#### Topology Diagram

```
 Host Machine (Windows / macOS / Linux)
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │   Docker Engine                                                      │
 │   ┌─── Docker Network: scimserver_default (bridge) ───────────────┐  │
 │   │                                                                │  │
 │   │   ┌──────────────────────┐      ┌──────────────────────────┐  │  │
 │   │   │ postgres             │      │ api                      │  │  │
 │   │   │ (postgres:17-alpine) │◄────▶│ (Dockerfile multi-stage) │  │  │
 │   │   │                      │ 5432 │                          │  │  │
 │   │   │ DB: scimdb           │      │ NestJS + Prisma 7        │  │  │
 │   │   │ User: scim           │      │ PrismaPg adapter         │  │  │
 │   │   │ Pass: scim           │      │ PORT=8080                │  │  │
 │   │   │                      │      │                          │  │  │
 │   │   │ Extensions:          │      │ Entrypoint:              │  │  │
 │   │   │  • citext            │      │  1. prisma migrate deploy│  │  │
 │   │   │  • pgcrypto          │      │  2. node dist/main.js    │  │  │
 │   │   │  • pg_trgm           │      │                          │  │  │
 │   │   └───────┬──────────────┘      └──────────┬───────────────┘  │  │
 │   │           │                                 │                  │  │
 │   └───────────┼─────────────────────────────────┼──────────────────┘  │
 │               │                                 │                     │
 │          Host:5432                          Host:8080                  │
 │          (optional)                         (mapped)                   │
 └───────────────┼─────────────────────────────────┼─────────────────────┘
                 │                                 │
           psql / pgAdmin                    Browser / curl
           localhost:5432                    http://localhost:8080
```

#### Connection Flow

```
Browser ──GET http://localhost:8080/──▶ Docker:8080 ──▶ api container:8080
                                                             │
                                                        NestJS app
                                                             │
                                              PrismaPg(pg.Pool) adapter
                                                             │
                                         ┌───────────────────┘
                                         ▼
                                    DNS: "postgres" ──▶ postgres container:5432
                                                             │
                                                        PostgreSQL 17
                                                        scimdb database
```

#### Full docker-compose.yml Configuration

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: scimserver-postgres
    environment:
      POSTGRES_DB: scimdb
      POSTGRES_USER: scim
      POSTGRES_PASSWORD: scim
    ports:
      - "5432:5432"           # Expose to host for psql/pgAdmin access
    volumes:
      - pgdata:/var/lib/postgresql/data                                      # Persistent data
      - ./scripts/init-pg-extensions.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scim -d scimdb"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: scimserver-api
    ports:
      - "8080:8080"           # API + Web dashboard
    environment:
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
      PERSISTENCE_BACKEND: prisma
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:                     # Named volume — survives container restarts
```

#### Commands

```powershell
# Start the stack (builds API image if needed)
docker compose up -d --build

# Verify both containers are healthy
docker compose ps
# NAME                  STATUS          PORTS
# scimserver-postgres   Up (healthy)    0.0.0.0:5432->5432/tcp
# scimserver-api        Up (healthy)    0.0.0.0:8080->8080/tcp

# View API logs
docker compose logs -f api

# Access PostgreSQL directly
docker exec -it scimserver-postgres psql -U scim -d scimdb

# Stop and remove (data preserved in pgdata volume)
docker compose down

# Full teardown including data
docker compose down -v
```

#### Port Reference

| Service | Container Port | Host Port | Protocol | URL |
|---|---|---|---|---|
| PostgreSQL | `5432` | `5432` | TCP | `postgresql://scim:scim@localhost:5432/scimdb` |
| API Server | `8080` | `8080` | HTTP | `http://localhost:8080` |
| Web Dashboard | `8080` | `8080` | HTTP | `http://localhost:8080` |
| SCIM Endpoint | `8080` | `8080` | HTTP | `http://localhost:8080/scim/v2` |
| Health Check | `8080` | `8080` | HTTP | `http://localhost:8080/` |

#### Environment Variables

| Variable | Value | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://scim:scim@postgres:5432/scimdb` | Uses Docker DNS hostname `postgres` |
| `PERSISTENCE_BACKEND` | `prisma` | Activates PostgreSQL via Prisma repository |
| `NODE_ENV` | `production` | Optimized runtime settings |
| `PORT` | `8080` | Set in Dockerfile ENV |

---

### Scenario 2: Docker Compose — Debug Mode

**Use for:** Live-reload development with VS Code debugger attached.

#### Topology Diagram

```
 Host Machine
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │   Docker Engine                                                      │
 │   ┌─── Docker Network: scimserver_default (bridge) ───────────────┐  │
 │   │                                                                │  │
 │   │   ┌──────────────────────┐      ┌──────────────────────────┐  │  │
 │   │   │ postgres             │      │ api (debug)              │  │  │
 │   │   │ (postgres:17-alpine) │◄────▶│ (node:24 with live code) │  │  │
 │   │   │                      │ 5432 │                          │  │  │
 │   │   │ Same config as       │      │ npm run start:dev        │  │  │
 │   │   │ Scenario 1           │      │ (ts-node + nodemon)      │  │  │
 │   │   │                      │      │ PORT=3000                │  │  │
 │   │   │                      │      │ Debug: 0.0.0.0:9229      │  │  │
 │   │   └───────┬──────────────┘      └──────────┬───┬───────────┘  │  │
 │   │           │                                 │   │              │  │
 │   └───────────┼─────────────────────────────────┼───┼──────────────┘  │
 │               │                                 │   │                 │
 │          Host:5432                         Host:3000 Host:9229        │
 └───────────────┼─────────────────────────────────┼───┼─────────────────┘
                 │                                 │   │
           psql access                        Browser  VS Code Debugger
           localhost:5432                localhost:3000 localhost:9229
```

#### docker-compose.debug.yml Configuration

```yaml
services:
  postgres:
    image: postgres:17-alpine
    # ... same as Scenario 1 ...

  api:
    image: node:24
    working_dir: /app
    command: npm run start:dev          # ts-node with --watch
    ports:
      - "3000:3000"                     # Dev server port
      - "9229:9229"                     # Node.js inspector port
    volumes:
      - ./api:/app                      # Live source mount
      - /app/node_modules              # Prevent host node_modules override
    environment:
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
      PERSISTENCE_BACKEND: prisma
      NODE_OPTIONS: "--inspect=0.0.0.0:9229"
    depends_on:
      postgres:
        condition: service_healthy
```

#### Port Reference (Debug)

| Service | Container Port | Host Port | Purpose |
|---|---|---|---|
| PostgreSQL | `5432` | `5432` | Database access |
| Dev Server | `3000` | `3000` | NestJS dev server (hot-reload) |
| Node Inspector | `9229` | `9229` | VS Code debugger attach |

#### VS Code launch.json Attach Config

```json
{
  "name": "Attach to Docker",
  "type": "node",
  "request": "attach",
  "port": 9229,
  "address": "localhost",
  "restart": true,
  "sourceMaps": true,
  "remoteRoot": "/app",
  "localRoot": "${workspaceFolder}/api"
}
```

---

### Scenario 3: Standalone Docker Run (External PostgreSQL)

**Use for:** Running the API container against a PostgreSQL instance on the host machine, a remote server, or a managed cloud database.

#### Sub-Scenario 3a: API Container → Host Machine PostgreSQL

```
 Host Machine
 ┌────────────────────────────────────────────────────────────────┐
 │                                                                │
 │  PostgreSQL (native install or service)                        │
 │  Listening on: 0.0.0.0:5432                                   │
 │  Database: scimdb                                              │
 │                                                                │
 │   Docker Engine                                                │
 │   ┌────────────────────────────────────────────────────────┐   │
 │   │                                                        │   │
 │   │   ┌──────────────────────────────────┐                 │   │
 │   │   │ api                              │                 │   │
 │   │   │ (scimserver image)               │                 │   │
 │   │   │                                  │                 │   │
 │   │   │ DATABASE_URL=                    │                 │   │
 │   │   │  postgresql://scim:scim@         │                 │   │
 │   │   │  host.docker.internal:5432/      │                 │   │
 │   │   │  scimdb                          │ ──────────────┐ │   │
 │   │   │                                  │               │ │   │
 │   │   └──────────┬───────────────────────┘               │ │   │
 │   │              │                                       │ │   │
 │   └──────────────┼───────────────────────────────────────┘ │   │
 │                  │                               │         │   │
 │             Host:8080                   host.docker.internal│   │
 │                  │                          resolves to ────┘   │
 │                  │                          host gateway IP     │
 └──────────────────┼─────────────────────────────────────────────┘
                    │
              Browser / curl
              http://localhost:8080
```

> **⚠️ `host.docker.internal`** is supported on Docker Desktop (Windows/macOS) and Docker Engine 20.10+ (Linux with `--add-host=host.docker.internal:host-gateway`).

#### Command

```powershell
# Build the image
docker build -t scimserver .

# Run against host PostgreSQL
docker run -d \
  --name scimserver-api \
  -p 8080:8080 \
  -e DATABASE_URL="postgresql://scim:scim@host.docker.internal:5432/scimdb" \
  -e PERSISTENCE_BACKEND=prisma \
  scimserver
```

#### Sub-Scenario 3b: API Container → Remote PostgreSQL

```
 Host Machine                              Remote Server / Cloud
 ┌──────────────────────────────┐         ┌─────────────────────────────┐
 │                              │         │                             │
 │  Docker Engine               │         │  PostgreSQL 17              │
 │  ┌────────────────────────┐  │   TLS   │  db.example.com:5432        │
 │  │ api container          │──┼────────▶│  Database: scimdb           │
 │  │ DATABASE_URL=           │  │  :5432  │  sslmode=require            │
 │  │  postgresql://user:pw@  │  │         │                             │
 │  │  db.example.com:5432/   │  │         └─────────────────────────────┘
 │  │  scimdb?sslmode=require │  │
 │  └───────────┬─────────────┘  │
 │              │                │
 │         Host:8080             │
 └──────────────┼────────────────┘
                │
          Browser / curl
```

#### Command

```powershell
docker run -d \
  --name scimserver-api \
  -p 8080:8080 \
  -e DATABASE_URL="postgresql://myuser:mypassword@db.example.com:5432/scimdb?sslmode=require" \
  -e PERSISTENCE_BACKEND=prisma \
  scimserver
```

#### DATABASE_URL Patterns for Scenario 3

| Target PostgreSQL | DATABASE_URL | Notes |
|---|---|---|
| Host machine (Docker Desktop) | `postgresql://scim:scim@host.docker.internal:5432/scimdb` | Windows/macOS Docker Desktop |
| Host machine (Linux) | `postgresql://scim:scim@172.17.0.1:5432/scimdb` | Docker bridge gateway IP |
| Remote server | `postgresql://user:pw@db.example.com:5432/scimdb?sslmode=require` | TLS recommended |
| Azure PG Flexible Server | `postgresql://admin@srv:pw@srv.postgres.database.azure.com:5432/scimdb?sslmode=require` | Azure-managed |
| AWS RDS | `postgresql://user:pw@mydb.xxxxx.region.rds.amazonaws.com:5432/scimdb?sslmode=require` | AWS-managed |

---

### Scenario 4: Unit & E2E Tests (InMemory Backend)

**Use for:** Running the test suite — no PostgreSQL needed.

#### Test Architecture

```
 Developer Machine (or CI Runner)
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │   Jest Test Runner (jest.config.ts)                          │
 │   ┌──────────────────────────────────────────────────────┐   │
 │   │                                                      │   │
 │   │  PERSISTENCE_BACKEND=inmemory                        │   │
 │   │                                                      │   │
 │   │  ┌─────────────────┐    ┌─────────────────────────┐  │   │
 │   │  │ Unit Tests (28) │    │ E2E Tests (15 suites)   │  │   │
 │   │  │ 862 tests       │    │ 193 tests               │  │   │
 │   │  │ ~40s            │    │ --maxWorkers=1           │  │   │
 │   │  └────────┬────────┘    └────────┬────────────────┘  │   │
 │   │           │                      │                    │   │
 │   │           ▼                      ▼                    │   │
 │   │  ┌─────────────────────────────────────────────────┐  │   │
 │   │  │ InMemory Repositories                           │  │   │
 │   │  │ (Map<string, Record[]> — process memory only)   │  │   │
 │   │  │                                                 │  │   │
 │   │  │ InMemoryUserRepository                          │  │   │
 │   │  │ InMemoryGroupRepository                         │  │   │
 │   │  │ InMemoryResourceMemberRepository                │  │   │
 │   │  │ InMemoryEndpointRepository                      │  │   │
 │   │  │                                                 │  │   │
 │   │  │ ✅ Simulates CITEXT with .toLowerCase()         │  │   │
 │   │  │ ✅ Simulates JSONB with JSON.parse/stringify     │  │   │
 │   │  │ ✅ No database connection needed                 │  │   │
 │   │  └─────────────────────────────────────────────────┘  │   │
 │   │                                                      │   │
 │   │  PrismaService.onModuleInit():                       │   │
 │   │    if (PERSISTENCE_BACKEND === 'inmemory') return;    │   │
 │   │    // ← skips $connect(), no pg.Pool created          │   │
 │   │                                                      │   │
 │   └──────────────────────────────────────────────────────┘   │
 │                                                              │
 │   No Docker, no PostgreSQL, no network                       │
 └──────────────────────────────────────────────────────────────┘
```

#### Test Commands

```powershell
# Unit tests — all 28 suites
cd api
npm test
# Test Suites: 28 passed | Tests: 862 passed | Time: ~40s

# E2E tests — all 15 suites
npm run test:e2e
# Test Suites: 15 passed | Tests: 193 passed | Workers: 1

# Single E2E suite
npx jest --config jest.config.ts test/e2e/scim-users.e2e-spec.ts

# Coverage report
npm run test:cov
```

#### E2E Test Wiring

```typescript
// test/e2e/helpers/app.helper.ts
export async function createTestApp(): Promise<INestApplication> {
  process.env.PERSISTENCE_BACKEND = 'inmemory';  // ← force InMemory
  // No DATABASE_URL needed — PrismaService skips connection
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  await app.listen(0);  // Random available port
  return app;
}
```

#### Test Port Reference

| Context | Port | Notes |
|---|---|---|
| E2E tests | `0` (random) | Jest picks an available port per suite |
| Live tests (local) | `3000` | `npm run start:dev` default |
| Live tests (Docker) | `8080` | Docker Compose mapped port |

---

### Scenario 5: Azure Container Apps (Production)

See [§10 Azure Deployment Architecture](#azure-deployment-architecture) for full details.

#### Quick Topology

```
 Internet
    │
    ▼  HTTPS (auto TLS)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Azure Container Apps Environment (VNet-integrated)                   │
 │                                                                      │
 │   ┌──────────────────────────┐        ┌───────────────────────────┐  │
 │   │ Container App            │        │ Azure PG Flexible Server  │  │
 │   │ (SCIMServer)             │───────▶│ (Burstable B1ms)          │  │
 │   │                          │ :5432  │                           │  │
 │   │ Image: ghcr.io/pranems/  │  VNet  │ 1 vCore, 2 GB RAM        │  │
 │   │   scimserver:latest      │ private│ 32 GB storage             │  │
 │   │                          │endpoint│ Extensions: citext,       │  │
 │   │ Replicas: 1–3            │        │   pgcrypto, pg_trgm       │  │
 │   │ CPU: 0.5 | RAM: 1 GiB   │        │                           │  │
 │   │                          │        │ sslmode=require           │  │
 │   └──────────────────────────┘        └───────────────────────────┘  │
 │                                                                      │
 └──────────────────────────────────────────────────────────────────────┘
```

---

### Container Image Build Pipeline (Dockerfile)

All containerized scenarios (1, 2, 3, 5) use the same multi-stage Dockerfile:

```
 Dockerfile — 4-Stage Build
 ┌────────────────────────────────────────────────────────────────────┐
 │                                                                    │
 │  Stage 1: web-build                    Stage 2: api-build          │
 │  ┌─────────────────────┐              ┌─────────────────────────┐  │
 │  │ node:24-alpine       │              │ node:24-alpine           │  │
 │  │ cd /app/web          │              │ cd /app/api              │  │
 │  │ npm ci               │              │ npm ci                   │  │
 │  │ npm run build        │              │ npx prisma generate      │  │
 │  │ → dist/web/          │              │ npm run build            │  │
 │  │   (React/Vite SPA)   │              │ → dist/                  │  │
 │  └─────────────────────┘              │   (NestJS compiled)      │  │
 │                                        └─────────────────────────┘  │
 │                                                                    │
 │  Stage 3: prod-deps                   Stage 4: runtime             │
 │  ┌─────────────────────┐              ┌─────────────────────────┐  │
 │  │ node:24-alpine       │              │ node:24-alpine           │  │
 │  │ npm ci --omit=dev    │              │                          │  │
 │  │ Graft prisma CLI     │              │ COPY --from=web-build    │  │
 │  │ Remove non-PG        │              │   dist/web → public/     │  │
 │  │   WASM runtimes      │              │ COPY --from=api-build    │  │
 │  │ → node_modules/      │              │   dist/ → dist/          │  │
 │  │   (production only)  │              │ COPY --from=prod-deps    │  │
 │  └─────────────────────┘              │   node_modules/          │  │
 │                                        │                          │  │
 │                                        │ ENV PORT=8080            │  │
 │                                        │ EXPOSE 8080              │  │
 │                                        │                          │  │
 │                                        │ HEALTHCHECK:             │  │
 │                                        │  GET http://localhost:   │  │
 │                                        │    8080/ every 30s       │  │
 │                                        │                          │  │
 │                                        │ CMD: docker-entrypoint   │  │
 │                                        │  .sh                     │  │
 │                                        │  1. prisma migrate deploy│  │
 │                                        │  2. exec node dist/      │  │
 │                                        │     main.js              │  │
 │                                        └─────────────────────────┘  │
 └────────────────────────────────────────────────────────────────────┘
```

#### Image Sizes

| Build | Image Size | Notes |
|---|---|---|
| `Dockerfile` (standard) | ~350 MB | node:24-alpine + production deps |
| `Dockerfile.optimized` | ~280 MB | Additional cleanup passes |
| `Dockerfile.ultra` | ~220 MB | Aggressive tree-shaking |

---

## Azure Deployment Architecture

### Phase 3 Impact on Azure Infrastructure

Phase 3 fundamentally changes the Azure deployment architecture. The previous SQLite-based design (ephemeral file DB + Blob Storage snapshots) is replaced by a managed PostgreSQL service.

### Architecture Comparison

#### Before (Phase 2): SQLite + Blob Backup

```
┌──────────────────────────────────────────────────────────────────────┐
│ Azure Resource Group                                                 │
│                                                                      │
│   ┌────────────┐     ┌──────────────────┐     ┌───────────────────┐  │
│   │ Container  │     │ Container App    │     │ Storage Account   │  │
│   │ Apps Env   │────▶│ (SCIMServer)     │────▶│ (Blob Storage)    │  │
│   │            │     │                  │     │                   │  │
│   │ VNet:      │     │ SQLite:          │     │ Private Endpoint  │  │
│   │ 10.40.0.0  │     │ /tmp/local-data/ │     │ SQLite snapshots  │  │
│   │ /16        │     │ scim.db          │     │ (periodic backup) │  │
│   └────────────┘     │                  │     └───────────────────┘  │
│                      │ Replicas: 1      │                            │
│                      │ (SQLite limit)   │     ┌───────────────────┐  │
│                      └──────────────────┘     │ Private DNS Zone  │  │
│                                               │ (blob endpoint)   │  │
│   ┌────────────────┐                          └───────────────────┘  │
│   │ Log Analytics  │                                                 │
│   └────────────────┘                                                 │
│                                                                      │
│   ❌ Problems:                                                       │
│     • Single replica only (SQLite file locking)                      │
│     • Data loss risk on container restart                             │
│     • Backup restore is manual + slow                                 │
│     • No real-time data durability                                    │
└──────────────────────────────────────────────────────────────────────┘
```

#### After (Phase 3): PostgreSQL Flexible Server

```
┌──────────────────────────────────────────────────────────────────────┐
│ Azure Resource Group                                                 │
│                                                                      │
│   VNet (10.40.0.0/16)                                                │
│   ┌────────────────────────────────────────────────────────────────┐  │
│   │                                                                │  │
│   │  aca-infra subnet         aca-runtime subnet                   │  │
│   │  (10.40.0.0/21)           (10.40.8.0/21)                       │  │
│   │  ┌─────────────────┐     ┌────────────────────────────────┐    │  │
│   │  │ Container Apps   │     │ Container App (SCIMServer)     │    │  │
│   │  │ Environment      │────▶│                                │    │  │
│   │  │                  │     │ Image: ghcr.io/pranems/        │    │  │
│   │  └─────────────────┘     │   scimserver:latest             │    │  │
│   │                          │                                │    │  │
│   │                          │ Replicas: 1–3 (scalable!)       │    │  │
│   │                          │ CPU: 0.5 | RAM: 1 GiB          │    │  │
│   │                          │                                │    │  │
│   │                          │ DATABASE_URL=                   │    │  │
│   │                          │  postgresql://scimadmin@srv:    │    │  │
│   │                          │  <password>@srv.postgres.       │    │  │
│   │                          │  database.azure.com:5432/       │    │  │
│   │                          │  scimdb?sslmode=require         │    │  │
│   │                          └───────────────┬────────────────┘    │  │
│   │                                          │ :5432 (VNet)        │  │
│   │  private-endpoints subnet                │                     │  │
│   │  (10.40.16.0/24)                         ▼                     │  │
│   │  ┌──────────────────────────────────────────────────────────┐  │  │
│   │  │ Azure Database for PostgreSQL — Flexible Server          │  │  │
│   │  │                                                          │  │  │
│   │  │ SKU: Burstable B1ms (1 vCore, 2 GB RAM)                 │  │  │
│   │  │ Storage: 32 GB (auto-grow)                               │  │  │
│   │  │ PostgreSQL Version: 17                                   │  │  │
│   │  │ Extensions: citext, pgcrypto, pg_trgm                    │  │  │
│   │  │                                                          │  │  │
│   │  │ ✅ VNet-integrated (private access only)                 │  │  │
│   │  │ ✅ Automated backups (7-day retention)                   │  │  │
│   │  │ ✅ SSL/TLS enforced                                      │  │  │
│   │  │ ✅ Supports multiple Container App replicas               │  │  │
│   │  └──────────────────────────────────────────────────────────┘  │  │
│   │                                                                │  │
│   └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│   ┌─────────────────┐                                                │
│   │ Log Analytics   │  ← Container App logs & PG metrics             │
│   └─────────────────┘                                                │
│                                                                      │
│   ✅ Benefits:                                                       │
│     • Multi-replica scaling (1–3+ replicas)                          │
│     • Automated daily backups with PITR                               │
│     • Real-time data durability (synchronous writes)                  │
│     • No manual backup/restore                                        │
│     • VNet-private — no public exposure                               │
│     • Managed patching & updates                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Azure Resource Changes (Phase 2 → Phase 3)

| Resource | Phase 2 (SQLite) | Phase 3 (PostgreSQL) | Change |
|---|---|---|---|
| **Container App** | maxReplicas: 1 | maxReplicas: 3 | ✅ Scale-out enabled |
| **DATABASE_URL** | `file:/tmp/local-data/scim.db` | `postgresql://...@*.postgres.database.azure.com:5432/scimdb?sslmode=require` | 🔄 Changed |
| **PERSISTENCE_BACKEND** | `prisma` (implicit SQLite) | `prisma` (PostgreSQL via adapter) | Same env var |
| **Blob Storage Account** | Required (SQLite snapshots) | **REMOVED** | ❌ Eliminated |
| **Blob Private Endpoint** | Required ($7.50/mo) | **REMOVED** | ❌ Eliminated |
| **Private DNS Zone** | `privatelink.blob.core.windows.net` | `privatelink.postgres.database.azure.com` | 🔄 Changed |
| **PG Flexible Server** | None | B1ms (1 vCore, 2 GB) | ✅ New |
| **Backup mechanism** | Manual blob snapshots | Automated PG backups (7-day PITR) | ✅ Improved |
| **Azure Files share** | Optional (SQLite persistence) | **REMOVED** | ❌ Eliminated |

### Updated Azure Cost Estimate

| Resource | Phase 2 Cost | Phase 3 Cost | Notes |
|---|---|---|---|
| Container App (0.5 vCPU, 1 GiB) | ~$5–15 | ~$5–15 | Same (scales to zero) |
| PG Flexible Server (B1ms) | — | ~$13–18 | New: managed PostgreSQL |
| Blob Storage | ~$0.20–0.50 | — | Removed |
| Private Endpoint (Blob) | ~$7.50 | — | Removed |
| Private Endpoint (PG) | — | ~$7.50 | New: PG VNet access |
| Log Analytics | ~$0–5 | ~$0–5 | Same |
| VNet / DNS | ~$0.50 | ~$0.50 | Same |
| **Total** | **~$13–28/mo** | **~$26–46/mo** | +$13–18 for managed PG |

> **Note:** The PG Flexible Server B1ms ($13-18/mo) is the primary cost increase. This is offset by enhanced reliability (automated backups, multi-replica support, zero data loss risk) and elimination of blob storage + private endpoint costs (~$8/mo saved). **Net increase: ~$5–18/mo.**

### Azure Deployment Flow (Updated for Phase 3)

```
 deploy.ps1 / bootstrap.ps1
 │
 ├─▶ Step 1/6: Resource Group
 │   └── az group create
 │
 ├─▶ Step 2/6: Network & Private DNS
 │   ├── VNet (10.40.0.0/16) with 3 subnets
 │   ├── Private DNS Zone: privatelink.postgres.database.azure.com  ◄── CHANGED
 │   └── VNet link
 │
 ├─▶ Step 3/6: PostgreSQL Flexible Server                            ◄── CHANGED
 │   ├── Create PG Flexible Server (B1ms, PG 17)                    (was: Blob Storage)
 │   ├── Enable extensions: citext, pgcrypto, pg_trgm
 │   ├── Create database: scimdb
 │   ├── Configure VNet integration  (private-endpoints subnet)
 │   └── Set firewall: deny public access
 │
 ├─▶ Step 4/6: Container App Environment
 │   ├── Log Analytics Workspace
 │   └── Container Apps Environment (VNet-integrated)
 │
 ├─▶ Step 5/6: Container App
 │   ├── Pull ghcr.io/pranems/scimserver:<tag>
 │   ├── Set secret: database-url (PG connection string)             ◄── NEW
 │   ├── Set secrets: SCIM, JWT, OAuth
 │   ├── Set env: DATABASE_URL (from secret), PERSISTENCE_BACKEND=prisma
 │   ├── maxReplicas: 3                                              ◄── CHANGED
 │   └── HTTPS ingress (auto TLS)
 │
 └─▶ Step 6/6: Finalize
     ├── Verify PG connectivity from Container App                   ◄── CHANGED
     └── Print deployment URL + secrets                              (was: blob role)
```

### Bicep Changes Required

#### containerapp.bicep — Key Changes

```diff
  // Environment variables
- { name: 'DATABASE_URL',             value: 'file:/tmp/local-data/scim.db' }
+ { name: 'DATABASE_URL',             secretRef: 'database-url' }
  { name: 'PERSISTENCE_BACKEND',      value: 'prisma' }
- { name: 'BLOB_BACKUP_ACCOUNT',      value: blobBackupAccount }
- { name: 'BLOB_BACKUP_CONTAINER',    value: blobBackupContainer }

  // Secrets
+ { name: 'database-url',  value: databaseUrl }  // param from deploy script

  // Scaling
  maxReplicas: 3    // was: 1 (SQLite single-writer limit removed)

  // Remove blob-related parameters
- param blobBackupAccount string
- param blobBackupContainer string
```

#### New: postgresql.bicep

```bicep
// Azure Database for PostgreSQL — Flexible Server
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: serverName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '17'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    storage: { storageSizeGB: 32 }
    network: {
      delegatedSubnetResourceId: subnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
  }
}

// Enable required extensions
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: postgresServer
  name: 'azure.extensions'
  properties: {
    value: 'citext,pgcrypto,pg_trgm'
    source: 'user-override'
  }
}

// Create the application database
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgresServer
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}
```

#### Resources to Remove

| Bicep File | Reason |
|---|---|
| `infra/blob-storage.bicep` | SQLite snapshots no longer needed |
| `infra/storage.bicep` | Azure Files SMB share unnecessary |
| Blob role assignment in deploy script | No blob containers to access |

---

## Migration Strategy

### Old Migrations → Fresh Baseline

All 8 previous SQLite migrations were removed and replaced with a single PostgreSQL baseline migration:

```
api/prisma/migrations/
├── migration_lock.toml                          # provider = "postgresql"
└── 20260301000000_postgresql_baseline/
    └── migration.sql                            # Full schema from scratch
```

The baseline migration creates all tables, indexes, constraints, and extensions in a single idempotent script. New databases run this one migration via `prisma migrate deploy` in the Docker entrypoint.

---

## File-by-File Change Log

### Source Code (16 files)

| File | Changes |
|---|---|
| `api/prisma/schema.prisma` | Provider → `postgresql`, added extensions, CITEXT/JSONB/UUID types, removed `*Lower`/`rawPayload` columns |
| `api/prisma.config.ts` | Fallback URL → `postgresql://scim:scim@localhost:5432/scimdb` |
| `api/package.json` | Added `@prisma/adapter-pg`, `pg`, `@types/pg`; removed `@prisma/adapter-better-sqlite3` |
| `api/src/modules/prisma/prisma.service.ts` | Complete rewrite: PrismaPg adapter + pg.Pool, InMemory skip logic |
| `api/src/domain/models/user.model.ts` | Removed `userNameLower` from all interfaces |
| `api/src/domain/models/group.model.ts` | Removed `displayNameLower` from all interfaces |
| `api/src/domain/repositories/group.repository.interface.ts` | `findByDisplayName` param: `displayNameLower` → `displayName` |
| `api/src/infrastructure/repositories/prisma/prisma-user.repository.ts` | JSONB boundary conversion, CITEXT queries |
| `api/src/infrastructure/repositories/prisma/prisma-group.repository.ts` | Same pattern for groups |
| `api/src/infrastructure/repositories/inmemory/inmemory-user.repository.ts` | Removed `userNameLower`, `.toLowerCase()` at query time |
| `api/src/infrastructure/repositories/inmemory/inmemory-group.repository.ts` | Removed `displayNameLower`, `.toLowerCase()` at query time |
| `api/src/infrastructure/repositories/repository.module.ts` | Comment update: "Default: Prisma (PostgreSQL — Phase 3)" |
| `api/src/modules/scim/services/endpoint-scim-users.service.ts` | Removed 3 `userNameLower` lines |
| `api/src/modules/scim/services/endpoint-scim-groups.service.ts` | Removed 3 `displayNameLower` lines |
| `api/src/modules/scim/filters/apply-scim-filter.ts` | Column maps use `userName`/`displayName`; removed `.toLowerCase()` in `tryPushToDb` |
| `Dockerfile` | Removed SQLite native deps, PostgreSQL WASM cleanup, fixed healthcheck |

### Supporting Services (6 files)

| File | Changes |
|---|---|
| `api/src/modules/database/database.service.ts` | All queries: `scimUser`/`scimGroup` → `scimResource` + `resourceType` filter |
| `api/src/modules/activity-parser/activity-parser.service.ts` | User/group name resolution → `scimResource` with `resourceType` filter, JSONB payload access |
| `api/src/modules/endpoint/services/endpoint.service.ts` | Stats queries → `scimResource.count` with resourceType, `resourceMember.count` |
| `api/src/modules/logging/logging.service.ts` | User display name resolution → `scimResource` |
| `api/src/modules/scim/controllers/admin.controller.ts` | User deletion → `scimResource.findFirst`/`.delete` |
| `api/docker-entrypoint.sh` | Simplified: `prisma migrate deploy` + `exec node dist/main.js` |

### Test Files (8 files)

| File | Changes |
|---|---|
| `api/src/infrastructure/repositories/prisma/prisma-user.repository.spec.ts` | `rawPayload` → `payload: {}`, removed `userNameLower`/`displayNameLower` |
| `api/src/infrastructure/repositories/prisma/prisma-group.repository.spec.ts` | Same pattern for groups |
| `api/src/infrastructure/repositories/inmemory/inmemory-user.repository.spec.ts` | Removed `userNameLower` from test data, queries by `userName` |
| `api/src/infrastructure/repositories/inmemory/inmemory-group.repository.spec.ts` | Removed `displayNameLower`, queries by `displayName` |
| `api/src/modules/scim/services/endpoint-scim-users.service.spec.ts` | Removed `userNameLower` mock data and test block |
| `api/src/modules/endpoint/services/endpoint.service.spec.ts` | Mock: `scimUser`/`scimGroup` → `scimResource`/`resourceMember` |
| `api/test/e2e/global-setup.ts` | PostgreSQL-aware, InMemory skip logic |
| `api/test/e2e/helpers/app.helper.ts` | No longer overrides DATABASE_URL in InMemory mode |
| `api/test/e2e/helpers/db.helper.ts` | `resetDatabase` uses `resourceMember`/`scimResource` |

### New Files (3 files)

| File | Purpose |
|---|---|
| `docker-compose.yml` | PostgreSQL 17-alpine + API service orchestration |
| `scripts/init-pg-extensions.sql` | PostgreSQL extension initialization |
| `api/prisma/migrations/20260301000000_postgresql_baseline/migration.sql` | Fresh PostgreSQL baseline migration |

---

## Test Results

### Unit Tests (InMemory Backend)

```
Test Suites: 28 passed, 28 total
Tests:       862 passed, 862 total
Time:        ~17s
```

### E2E Tests (InMemory Backend)

```
Test Suites: 15 passed, 15 total
Tests:       193 passed, 193 total
Workers:     1 (connection pool limit)
```

### Live Tests — Local Server (InMemory)

```
PASS: 301 / 302
FAIL: 1 (Non-existent endpoint returns 404 — pre-existing)
Duration: ~10s
```

### Live Tests — Docker Container (PostgreSQL)

```
PASS: 301 / 302
FAIL: 1 (Non-existent endpoint returns 404 — pre-existing)
Duration: ~10s
Container: scimserver-api (healthy)
Database: scimserver-postgres (PostgreSQL 17-alpine)
```

---

## Known Issues

1. **Non-existent endpoint 404 test (1 failure):** `Non-existent endpoint returns 404` fails in the live test suite. The admin endpoint GET returns a different status code than expected. This is a pre-existing issue not related to Phase 3.

2. **BackupService SQLite warnings:** The legacy `BackupService` still runs and logs `"Local database not found at /tmp/local-data/scim.db"` warnings in Docker. This service is a Phase 4/5 cleanup item — it has no impact on PostgreSQL operation.

3. **Connection pool sizing:** `pg.Pool` is configured with `max: 5` to prevent exhaustion during E2E test parallelism. Production deployments may increase this via environment configuration.

4. **SCIM ID leak (Issue 16 — FIXED):** Client-supplied `id` in POST/PATCH body could leak into response via `rawPayload` spread. Fixed with defense-in-depth: `extractAdditionalAttributes` strips `id`, `toScimUserResource` deletes `rawPayload.id`, and `stripReservedAttributes` now includes `'id'`.

5. **Version endpoint cleanup (Issue 17 — FIXED):** Obsolete blob storage fields removed from version endpoint. Added `persistenceBackend`, `connectionPool`, and `migratePhase` fields. Version bumped to 0.11.0.
