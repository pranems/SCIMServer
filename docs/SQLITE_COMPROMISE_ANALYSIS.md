# SQLite Compromise Analysis & Migration Roadmap

> **Version**: 1.0  
> **Date**: 2026-02-13  
> **Scope**: Full audit of SQLite-specific compromises in SCIMServer v0.10.0 (including fixes introduced in v0.9.1)  
> **Audience**: Engineering team, architects, and decision-makers evaluating a PostgreSQL migration

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Context](#2-architecture-context)
3. [Compromise Inventory](#3-compromise-inventory)
   - [3.1 Schema & Data Model](#31-schema--data-model)
   - [3.2 Concurrency & Locking](#32-concurrency--locking)
   - [3.3 Infrastructure & Deployment](#33-infrastructure--deployment)
   - [3.4 Query & Performance](#34-query--performance)
   - [3.5 Feature Limitations](#35-feature-limitations)
   - [3.6 Storage & Backup](#36-storage--backup)
4. [Impact Flow Diagrams](#4-impact-flow-diagrams)
5. [Request Examples — What Changes with PostgreSQL](#5-request-examples--what-changes-with-postgresql)
6. [Summary Matrix](#6-summary-matrix)
7. [Migration Recommendations](#7-migration-recommendations)
8. [Migration Effort Estimate](#8-migration-effort-estimate)
9. [Decision Framework](#9-decision-framework)

---

## 1. Executive Summary

SCIMServer uses **SQLite** as its embedded database, chosen for zero-dependency local development, single-binary deployment, and simplicity. However, this choice introduces **28 documented compromises** across six categories. Four are rated **CRITICAL**, meaning they directly limit the system's production viability:

| # | Critical Compromise | Impact |
|---|---------------------|--------|
| 1 | **Single-writer lock** | Only one write operation at a time across the entire database |
| 2 | **Buffered request logging** | Up to 3 seconds of log data lost on crash |
| 3 | **Single replica constraint** | No horizontal scaling, no high availability |
| 4 | **Ephemeral storage** | All data lost on container restart without backup restoration |

The recommended migration target is **Azure Database for PostgreSQL – Flexible Server**, which eliminates all 28 compromises and enables production-grade operation.

---

## 2. Architecture Context

### Current Architecture (SQLite)

```
┌─────────────────────────────────────────────────────────┐
│  Azure Container Apps  (maxReplicas: 1)                 │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Container Replica (single)                       │  │
│  │                                                   │  │
│  │  ┌─────────────┐    ┌────────────────────────┐   │  │
│  │  │  NestJS App  │───▶│  SQLite (WAL mode)     │   │  │
│  │  │  + Prisma    │    │  /tmp/local-data/scim.db│  │  │
│  │  └──────┬──────┘    └────────────────────────┘   │  │
│  │         │                      │                  │  │
│  │         │              ┌───────▼──────────┐       │  │
│  │         │              │ Backup Service   │       │  │
│  │         │              │ (every 5 min)    │       │  │
│  │         │              └───────┬──────────┘       │  │
│  │         │                      │                  │  │
│  └─────────┼──────────────────────┼──────────────────┘  │
│            │                      │                     │
└────────────┼──────────────────────┼─────────────────────┘
             │                      │
             ▼                      ▼
  ┌─────────────────┐    ┌──────────────────────┐
  │  SCIM Clients   │    │  Azure Blob Storage  │
  │  (Entra ID)     │    │  (snapshots every 5m)│
  └─────────────────┘    └──────────────────────┘
```

### Target Architecture (PostgreSQL)

```
┌─────────────────────────────────────────────────────────┐
│  Azure Container Apps  (maxReplicas: N, auto-scale)     │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Replica 1   │  │  Replica 2   │  │  Replica N   │  │
│  │  NestJS      │  │  NestJS      │  │  NestJS      │  │
│  │  + Prisma    │  │  + Prisma    │  │  + Prisma    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
└─────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │
          └────────┬────────┘                 │
                   │ ┌────────────────────────┘
                   ▼ ▼
     ┌──────────────────────────────────────┐
     │  Azure Database for PostgreSQL       │
     │  Flexible Server (HA, auto-backup)   │
     │  ┌────────┐  ┌──────────┐           │
     │  │  MVCC  │  │  JSONB   │           │
     │  │  Locks │  │  + GIN   │           │
     │  └────────┘  │  indexes │           │
     │              └──────────┘           │
     └──────────────────────────────────────┘
```

**Key differences**: No file management, no backup service, no entrypoint restore dance, multi-replica scaling, MVCC concurrent writes, native JSON queries, managed backups.

---

## 3. Compromise Inventory

### 3.1 Schema & Data Model

#### 3.1.1 `userNameLower` Derived Column — Case-Insensitive Uniqueness Workaround

**Severity**: HIGH  
**Files**: `api/prisma/schema.prisma`, `api/src/modules/scim/filters/apply-scim-filter.ts`

**Problem**: SQLite lacks the `CITEXT` data type and the `ILIKE` operator. SCIM RFC 7643 §2.1 requires `userName` uniqueness to be case-insensitive. A parallel lowercase column must be kept in sync on every write path (POST create, PATCH, PUT replace).

**Current schema**:
```prisma
model ScimUser {
  userName      String   // Original casing preserved for display
  userNameLower String   // Lowercased for case-insensitive uniqueness & filtering
  @@unique([endpointId, userNameLower])
}
```

**Current write path** (every create/update must include):
```typescript
data: {
  userName: payload.userName,
  userNameLower: payload.userName.toLowerCase(),  // ⚠ Manual sync required
}
```

**PostgreSQL solution** — use `CITEXT` extension and remove the derived column:
```prisma
model ScimUser {
  userName String @db.Citext  // Native case-insensitive type
  @@unique([endpointId, userName])  // Direct constraint, no derived column
}
```

**Risk if not migrated**: Every new code path that writes `userName` MUST remember to set `userNameLower`. A missed sync causes silent uniqueness violations.

---

#### 3.1.2 `displayNameLower` Derived Column — Same Pattern for Groups

**Severity**: HIGH  
**Files**: `api/prisma/schema.prisma`, `api/src/modules/scim/filters/apply-scim-filter.ts`

Identical to `userNameLower`. Introduced in v0.9.1 (and part of current v0.10.0 baseline) to pass the SCIM validator's "Filter for existing group with different case" test.

```prisma
model ScimGroup {
  displayName      String
  displayNameLower String   // Lowercased for case-insensitive filtering & uniqueness
  @@unique([endpointId, displayNameLower])
}
```

**PostgreSQL solution**: `@db.Citext` on `displayName`, remove `displayNameLower` entirely.

---

#### 3.1.3 `rawPayload` as TEXT — No Native JSON Column

**Severity**: MEDIUM  
**Files**: `api/prisma/schema.prisma` (ScimUser.rawPayload, ScimGroup.rawPayload, Endpoint.config)

```prisma
rawPayload    String   // Full SCIM resource stored as JSON string in TEXT column
meta          String?  // SCIM metadata serialized as JSON string
config        String?  // Endpoint config serialized as JSON string
```

**What this means**: No database-level JSON validation, no JSON path queries, no JSON indexes. All complex SCIM filter operations must deserialize every record in application memory.

**Example — current in-memory filter flow**:

```
SCIM Client Request:
  GET /scim/endpoints/{id}/Users?filter=emails[type eq "work"].value eq "john@example.com"

Current (SQLite):
  1. SELECT * FROM ScimUser WHERE endpointId = ?   ← full table scan
  2. for each row:
       payload = JSON.parse(row.rawPayload)        ← deserialize in app
       if evaluateFilter(ast, payload): keep        ← evaluate in memory
  3. Return matching rows

With PostgreSQL JSONB + GIN index:
  1. SELECT * FROM "ScimUser"
     WHERE "endpointId" = $1
       AND "rawPayload"->>'emails' @> '[{"type":"work","value":"john@example.com"}]'
     ← single indexed query, no app-level deserialization
```

**Performance impact**: For 10,000 users, a complex filter must deserialize 10,000 JSON blobs in Node.js vs. a single indexed query in PostgreSQL.

---

#### 3.1.4 No `@db.*` Column Type Annotations

**Severity**: LOW  
**Files**: `api/prisma/schema.prisma`

SQLite has only four storage classes: `TEXT`, `INTEGER`, `REAL`, `BLOB`. No `VARCHAR(255)`, `TIMESTAMP`, `UUID`. Column-level size constraints are not enforced by the database. In PostgreSQL, Prisma's `@db.VarChar(255)`, `@db.Uuid`, `@db.Timestamptz` enable proper database-level validation.

---

#### 3.1.5 Migration Table-Rebuild Pattern

**Severity**: MEDIUM  
**Files**: `api/prisma/migrations/20260213064256_add_display_name_lower/migration.sql`

Adding a required column in SQLite requires this pattern:

```sql
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ScimGroup" (
  -- all columns including new one --
  "displayNameLower" TEXT NOT NULL DEFAULT ''
);

INSERT INTO "new_ScimGroup" (...) SELECT ... FROM "ScimGroup";
DROP TABLE "ScimGroup";
ALTER TABLE "new_ScimGroup" RENAME TO "ScimGroup";

PRAGMA foreign_keys=ON;
```

**Why this is a problem**: On a table with 100K rows, this copies the entire table. Foreign key constraints must be temporarily disabled. The operation is not crash-safe without WAL. In PostgreSQL, `ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT ...` is a metadata-only operation (near-instant regardless of table size).

---

#### 3.1.6 Prisma Provider Lock-In

**Severity**: MEDIUM  
**Files**: `api/prisma/schema.prisma`, `api/prisma/migrations/migration_lock.toml`

```prisma
datasource db {
  provider = "sqlite"          // ← locked to SQLite
  url      = env("DATABASE_URL")
}
```

```toml
# api/prisma/migrations/migration_lock.toml
provider = "sqlite"
```

Switching providers requires either a full migration reset or `prisma migrate resolve` workarounds.

---

### 3.2 Concurrency & Locking

#### 3.2.1 WAL Mode + busy_timeout — Single Writer Lock Mitigation

**Severity**: CRITICAL  
**File**: `api/src/modules/prisma/prisma.service.ts`

```typescript
// Enable WAL journal mode and set busy timeout for better concurrent write handling.
// SQLite default journal mode (DELETE) serialises writes aggressively; WAL allows
// readers and a single writer to proceed concurrently.
const walResult = await this.$queryRawUnsafe<...>('PRAGMA journal_mode = WAL;');
const busyResult = await this.$queryRawUnsafe<...>('PRAGMA busy_timeout = 15000;');
```

**How SQLite serialization works**:

```
 Request A (POST /Users)              Request B (PATCH /Groups)
 ─────────────────────                ──────────────────────────
 t=0  BEGIN TRANSACTION               t=0  BEGIN TRANSACTION
 t=1  INSERT INTO ScimUser ← WRITE LOCK ACQUIRED
 t=2  INSERT INTO GroupMember         t=1  UPDATE ScimGroup ← BLOCKED (busy_timeout=15s)
 t=3  COMMIT ← WRITE LOCK RELEASED
                                      t=4  UPDATE ScimGroup ← NOW PROCEEDS
                                      t=5  COMMIT

 With 15s busy_timeout, Request B waits. Without it, SQLITE_BUSY error immediately.
```

**PostgreSQL MVCC model**:

```
 Request A (POST /Users)              Request B (PATCH /Groups)
 ─────────────────────                ──────────────────────────
 t=0  BEGIN                           t=0  BEGIN
 t=1  INSERT INTO ScimUser            t=1  UPDATE ScimGroup  ← Both proceed concurrently
 t=2  INSERT INTO GroupMember         t=2  UPDATE GroupMember (row-level lock only)
 t=3  COMMIT                          t=3  COMMIT

 No global lock. Row-level MVCC allows true parallel writes.
```

---

#### 3.2.2 Buffered Request Logging — Write Lock Contention Avoidance

**Severity**: CRITICAL  
**File**: `api/src/modules/logging/logging.service.ts`

```typescript
// ── Buffered logging to reduce SQLite write contention ──
// Instead of writing per-request (2 writes each), we accumulate in memory
// and flush in a single batch INSERT periodically or when the buffer is full.
private static readonly FLUSH_INTERVAL_MS = 3_000;  // flush every 3 seconds
private static readonly MAX_BUFFER_SIZE = 50;        // or when 50 entries accumulate
```

**Timeline — what happens on crash**:

```
t=0.0s  Request 1 → logged to buffer (not in DB)
t=0.5s  Request 2 → logged to buffer
t=1.0s  Request 3 → logged to buffer
t=2.0s  Request 4 → logged to buffer
t=2.5s  ★ CONTAINER CRASH ★
        └─ 4 log entries LOST (never flushed to DB)
t=3.0s  (would have been flush time)
```

**PostgreSQL eliminates this**: Each log entry can be an independent `INSERT` without blocking SCIM transactions — no buffering needed, no data loss window.

---

#### 3.2.3 Pre-Transaction Member Resolution

**Severity**: HIGH  
**File**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts`

```typescript
// Pre-resolve member user IDs OUTSIDE the transaction to minimise lock hold time.
// The user data is stable within this request context so the lookup is safe here.
const memberData = memberDtos.length > 0
  ? await this.mapMembersForPersistenceForEndpoint(group.id, memberDtos, endpointId)
  : [];

// Only THEN start the transaction (holds write lock for shortest time possible)
await this.prisma.$transaction(async (tx) => {
  await tx.scimGroup.update({ ... });
  await tx.groupMember.deleteMany({ where: { groupId: group.id } });
  if (memberData.length > 0) {
    await tx.groupMember.createMany({ data: memberData });
  }
}, { maxWait: 10000, timeout: 30000 });
```

**Why this pattern exists**: Every millisecond inside `$transaction` holds the SQLite global write lock. Moving SELECTs outside reduces lock hold time. With PostgreSQL's row-level locking, this optimization is unnecessary — the SELECTs inside a transaction don't block other writers.

---

#### 3.2.4 Generous Transaction Timeouts

**Severity**: MEDIUM  
**File**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts`

```typescript
{ maxWait: 10000, timeout: 30000 }  // 10s wait for lock, 30s execution
```

These timeouts exist because a concurrent Group PATCH may be waiting for the single writer lock. PostgreSQL would use `{ maxWait: 2000, timeout: 5000 }` or less.

---

#### 3.2.5 Sequential E2E Tests

**Severity**: LOW  
**File**: `api/test/e2e/jest-e2e.config.ts`

```typescript
// Run sequentially — E2E tests share a single SQLite DB file
maxWorkers: 1,
```

With PostgreSQL, tests can run in parallel using isolated schemas (`CREATE SCHEMA test_worker_1`), reducing E2E runtime by ~60%.

---

### 3.3 Infrastructure & Deployment

#### 3.3.1 Single Replica Constraint — No Horizontal Scaling

**Severity**: CRITICAL  
**File**: `infra/containerapp.bicep`

```bicep
@description('Max replicas – keep at 1 while using SQLite (file-based DB cannot be shared across replicas)')
param maxReplicas int = 1
```

**Split-brain problem with multiple replicas**:

```
                          Load Balancer
                         ┌─────┴─────┐
                    Replica A     Replica B
                    ┌────────┐   ┌────────┐
                    │ SQLite │   │ SQLite │
                    │  scim.db│   │  scim.db│   ← Separate files!
                    └────────┘   └────────┘

POST /Users (→ Replica A)          GET /Users/123 (→ Replica B)
  ① INSERT user 123                  ② SELECT * WHERE scimId = '123'
  ③ Return 201 Created                 → 404 Not Found ✗
     Location: /Users/123              (user only exists in A's DB)
```

**Impact**: Zero horizontal scalability. Zero high availability. Single point of failure.

**PostgreSQL eliminates this entirely** — all replicas connect to the same shared database.

---

#### 3.3.2 Ephemeral Storage — Data Loss on Container Restart

**Severity**: CRITICAL  
**File**: `infra/containerapp.bicep`, `api/docker-entrypoint.sh`

```bicep
{ name: 'DATABASE_URL', value: 'file:/tmp/local-data/scim.db' }
```

The database lives at `/tmp/local-data/scim.db` — ephemeral container storage. When the container restarts (deployment, scaling event, crash, Azure infrastructure maintenance), the file system is wiped.

**Data loss timeline**:

```
t=0m  App starts, restores last backup from Blob Storage (if exists)
t=1m  Client creates 100 users
t=4m  Client creates 50 groups, adds members
t=4m  ★ Container restart (deployment/crash) ★
      └─ Last backup was at t=0m → 4 minutes of data LOST
t=5m  App restarts, restores from t=0m backup
      └─ 100 users + 50 groups → GONE
```

**PostgreSQL**: Data is in a managed database service with point-in-time recovery. Container restarts have zero data impact.

---

#### 3.3.3 Azure Files Not Usable — Hybrid Storage Architecture

**Severity**: HIGH  
**Files**: `docs/STORAGE_AND_BACKUP.md`, `api/src/modules/backup/backup.service.ts`

SQLite cannot run directly on network-mounted storage (Azure Files / SMB) because:

| Issue | Detail |
|-------|--------|
| **I/O Latency** | Network round-trip adds 1-5ms per I/O op → 100-1000× slower than local SSD |
| **Lock Files** | SQLite uses `.db-journal`, `.db-shm`, `.db-wal` in same directory — lock semantics break on SMB |
| **Corruption** | Concurrent access from multiple SMB sessions can corrupt the database |

This forced the **hybrid storage architecture** — the most complex piece of the infrastructure:

```
┌─────────────────────────────────────────────────────────────┐
│  Container Startup (docker-entrypoint.sh)                   │
│                                                             │
│  ① Check Azure Files backup (/app/data/scim.db)            │
│     ├─ Found → cp backup → /tmp/local-data/scim.db         │
│     └─ Not found → Check Blob Storage                      │
│        ├─ Found → Download latest snapshot → /tmp/...       │
│        └─ Not found → Start fresh (empty DB)               │
│                                                             │
│  ② Run prisma migrate deploy                               │
│  ③ Start NestJS app                                        │
│                                                             │
│  Runtime:                                                   │
│  ④ Every 5 minutes:                                         │
│     └─ Copy /tmp/local-data/scim.db → Azure Blob Storage   │
│        (raw binary snapshot)                                │
│     └─ Prune old backups (keep last 20)                     │
│                                                             │
│  Container Shutdown:                                        │
│  ⑤ Flush log buffer → final backup attempt                  │
└─────────────────────────────────────────────────────────────┘
```

**PostgreSQL eliminates all of this**. `DATABASE_URL=postgresql://...` — done.

---

#### 3.3.4 5-Minute RPO (Recovery Point Objective)

**Severity**: HIGH  
**File**: `api/src/modules/backup/backup.service.ts`

```typescript
@Cron('*/5 * * * *', { name: 'database-backup' })
async handleBackupCron() {
  await this.performBackup();
}
```

Maximum data loss on unplanned restart: **5 minutes**. This is the inherent limitation of a file-copy backup strategy.

**PostgreSQL**: Azure Database for PostgreSQL provides continuous WAL archiving with configurable retention (up to 35 days). Point-in-time recovery down to **seconds**.

---

#### 3.3.5 Docker Entrypoint Restore Dance

**Severity**: MEDIUM  
**File**: `api/docker-entrypoint.sh`

95 lines of shell script solely dedicated to checking multiple backup sources, copying, restoring, and preparing the SQLite file before the application can start. This adds **10-30 seconds** to cold-start time.

**PostgreSQL**: Replace the entire entrypoint with:
```bash
npx prisma migrate deploy
exec node dist/main.js
```

---

#### 3.3.6 Lock File Cleanup in Tests

**Severity**: LOW  
**File**: `api/test/e2e/global-teardown.ts`

```typescript
for (const file of [testDbPath, `${testDbPath}-journal`, `${testDbPath}-wal`]) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // File still locked by Prisma — global-setup will recreate it
  }
}
```

SQLite's WAL and journal files must be cleaned up explicitly. PostgreSQL databases are cleaned simply with `DROP SCHEMA`.

---

### 3.4 Query & Performance

#### 3.4.1 In-Memory Filter Evaluation for Complex SCIM Filters

**Severity**: HIGH  
**File**: `api/src/modules/scim/filters/apply-scim-filter.ts`

```typescript
// Complex filter → in-memory evaluation
return {
  dbWhere: {},
  fetchAll: true,  // ← loads ALL records from DB
  inMemoryFilter: (resource) => evaluateFilter(ast, resource),
};
```

**Filter operators and their pushdown status**:

| SCIM Operator | Example | SQLite | PostgreSQL |
|---------------|---------|--------|------------|
| `eq` (indexed col) | `userName eq "john"` | ✅ DB pushdown via `userNameLower` | ✅ Native `CITEXT =` |
| `eq` (JSON attr) | `emails.value eq "j@x.com"` | ❌ In-memory | ✅ `JSONB @>` with GIN |
| `co` (contains) | `displayName co "Smith"` | ❌ In-memory | ✅ `ILIKE '%Smith%'` + `pg_trgm` |
| `sw` (starts with) | `userName sw "jo"` | ❌ In-memory | ✅ `ILIKE 'jo%'` + B-tree |
| `and` / `or` | composed filters | ❌ In-memory | ✅ SQL `AND` / `OR` |
| `gt` / `lt` | `meta.lastModified gt "..."` | ❌ In-memory | ✅ `>` / `<` on indexed columns |
| Bracket filter | `emails[type eq "work"]` | ❌ In-memory | ✅ `JSONB` path expression |

---

#### 3.4.2 `createMany` Does Not Return IDs

**Severity**: MEDIUM  
**File**: `api/src/modules/logging/logging.service.ts`

```typescript
// Single batch insert (1 write instead of N*2 writes)
await this.prisma.requestLog.createMany({ data: createData });

// Since createMany doesn't return IDs in SQLite, we update the most recent N rows
const recentRows = await this.prisma.$queryRawUnsafe(
  `SELECT id FROM RequestLog ORDER BY rowid DESC LIMIT ${batch.length}`
);
```

Prisma's SQLite connector doesn't support `RETURNING` in `createMany`. A follow-up query is needed to correlate inserted rows. PostgreSQL's `INSERT ... RETURNING id` makes this a single atomic operation.

---

#### 3.4.3 Only `eq` Operator Pushed to Database

**Severity**: MEDIUM  
**File**: `api/src/modules/scim/filters/apply-scim-filter.ts`

```typescript
function tryPushToDb(ast: FilterNode, columnMap: Record<string, string>) {
  if (ast.type !== 'compare') return null;
  const node = ast as CompareNode;
  if (node.op !== 'eq') return null;  // ← only eq is supported for DB pushdown
  // ...
}
```

All other operators fall back to `fetchAll: true` → full table scan + in-memory evaluation. With PostgreSQL, the `tryPushToDb` function could handle `co`, `sw`, `ew`, `gt`, `lt`, `ge`, `le` operators natively.

---

### 3.5 Feature Limitations

#### 3.5.1 No CITEXT / ILIKE — Application-Level Case Insensitivity

**Severity**: HIGH

Every string comparison that should be case-insensitive (per RFC 7643 §2.1, `caseExact: false` is the default for SCIM string attributes) requires explicit `.toLowerCase()` in application code.

**Example — create user flow**:

```
SCIM Request:
POST /scim/endpoints/{eid}/Users
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "John.Smith@Example.COM"
}

Application must:
  1. Store: userName = "John.Smith@Example.COM"     (original casing)
  2. Store: userNameLower = "john.smith@example.com" (derived)
  3. Check uniqueness against: userNameLower

Later, filter request:
GET /scim/endpoints/{eid}/Users?filter=userName eq "JOHN.SMITH@EXAMPLE.COM"

Application must:
  1. Parse filter → userName eq "JOHN.SMITH@EXAMPLE.COM"
  2. Convert to DB query → WHERE userNameLower = "john.smith@example.com"
  3. Return match (case-insensitive comparison succeeded)
```

With PostgreSQL `CITEXT`:
```sql
-- No derived columns needed
WHERE "userName" = 'JOHN.SMITH@EXAMPLE.COM'   -- native case-insensitive
```

---

#### 3.5.2 Raw PRAGMA Queries Bypass Type Safety

**Severity**: LOW  
**File**: `api/src/modules/prisma/prisma.service.ts`

```typescript
await this.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode = WAL;');
await this.$queryRawUnsafe<Array<{ busy_timeout: number }>>('PRAGMA busy_timeout = 15000;');
```

SQLite PRAGMAs are executed via `$queryRawUnsafe` — bypassing Prisma's type safety. PostgreSQL configuration is done via connection parameters or `ALTER SYSTEM`, not in-band SQL.

---

### 3.6 Storage & Backup

#### 3.6.1 No WAL Checkpoint Before Backup (Potential Inconsistency)

**Severity**: HIGH  
**File**: `api/src/modules/backup/backup.service.ts`

```typescript
private async performBackup() {
  // ⚠ Missing: PRAGMA wal_checkpoint(TRUNCATE)
  // WAL mode stores recent writes in .db-wal file, NOT the main .db file.
  // Copying only .db without checkpoint may produce an incomplete backup.
  await copyFile(this.localDbPath, this.azureFilesBackupPath);
}
```

**Should be**:
```typescript
// Flush WAL to main database file before copying
await this.prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
await copyFile(this.localDbPath, this.azureFilesBackupPath);
```

**PostgreSQL**: Backups are handled by Azure's managed backup service — no application-level backup code needed at all.

---

#### 3.6.2 Binary File Copy Instead of Logical Dump

**Severity**: MEDIUM  
**File**: `api/src/modules/backup/backup.service.ts`

Backups are raw binary copies of the `.db` file. This means:
- No point-in-time recovery
- No WAL streaming
- No incremental backups
- Cannot restore individual tables
- Cross-version compatibility not guaranteed

**PostgreSQL** provides `pg_dump` (logical), `pg_basebackup` (physical), WAL archiving (continuous), and Azure's built-in PITR.

---

#### 3.6.3 Azure Storage Infrastructure for File-Based DB

**Severity**: LOW  
**Files**: `infra/blob-storage.bicep`, `infra/storage.bicep`

Entire Azure infrastructure modules exist solely to support SQLite persistence:
- Storage Account (~$0.36/month)
- Blob Container for snapshots
- Private endpoint for secure access
- Managed Identity role assignment for blob access

With PostgreSQL, these templates are replaced by a single Azure Database for PostgreSQL – Flexible Server resource.

---

## 4. Impact Flow Diagrams

### 4.1 Write Contention Under Load

```
                          ┌─ SCIM Validator (rapid-fire)
                          │
         ┌────────────────┼────────────────┐
         │                ▼                │
         │  ┌──────── NestJS ──────────┐  │
         │  │                          │  │
         │  │  [POST User A]           │  │
         │  │  [PATCH Group B]         │  │
         │  │  [POST User C]           │  │  3 concurrent writes
         │  │  [Log Request 1]         │  │  arrive simultaneously
         │  │  [Log Request 2]         │  │
         │  │  [Log Request 3]         │  │
         │  │                          │  │
         │  └──────────┬───────────────┘  │
         │             │                  │
         │       ┌─────▼─────┐            │
         │       │  SQLite   │            │
         │       │  Writer   │            │
         │       │  Queue    │            │
         │       └─────┬─────┘            │
         │             │                  │
         │     ┌───────▼────────┐         │
         │     │ Single Writer  │         │
         │     │    Lock        │         │
         │     │ (one at a time)│         │
         │     └───────┬────────┘         │
         │             │                  │
         │  t=0ms  POST User A writes    │
         │  t=15ms PATCH Group B WAITS   │ ← busy_timeout countdown
         │  t=20ms Logs buffered (3s)    │ ← not written yet
         │  t=30ms POST User A commits  │
         │  t=31ms PATCH Group B writes  │ ← now proceeds
         │  t=45ms POST User C writes   │
         │  t=3000ms Flush 3 log entries │ ← finally written
         └────────────────────────────────┘

With PostgreSQL: All 6 operations execute concurrently (~15ms total)
```

### 4.2 Container Lifecycle with Ephemeral Storage

```
 Time ──────────────────────────────────────────────────────────────▶

 Container A (dies at t=14m)
 ├─ t=0m   Start → Restore from blob (empty) → migrate
 ├─ t=1m   Client creates 200 users
 ├─ t=5m   ★ Backup #1 → blob (200 users saved)
 ├─ t=6m   Client creates 100 more users (300 total)
 ├─ t=10m  ★ Backup #2 → blob (300 users saved)
 ├─ t=11m  Client creates 50 groups + assigns members
 ├─ t=14m  ★ CRASH ★ (50 groups LOST — next backup was at t=15m)
 │
 Container B (restarts)
 ├─ t=15m  Start → Restore from blob (300 users, 0 groups)
 ├─ t=15m  Client: "Where are my 50 groups??" → 404
 │
 ▲ Data loss window: minutes 10-14 (4 minutes of changes)

 With PostgreSQL: Container B reads same database. Zero data loss.
```

---

## 5. Request Examples — What Changes with PostgreSQL

### 5.1 Complex SCIM Filter Query

**Request**:
```http
GET /scim/endpoints/ep-001/Users?filter=emails[type eq "work"].value co "example.com" and active eq true
Host: scimserver-app.eastus.azurecontainerapps.io
Authorization: Bearer eyJhbGciOiJI...
Accept: application/scim+json
```

**Current (SQLite)** — Application executes:
```sql
-- Step 1: Full table scan (cannot push "co" or bracket filter to SQLite)
SELECT * FROM ScimUser WHERE endpointId = 'ep-001'
-- Returns ALL users for endpoint (could be 10,000+)
```
```typescript
// Step 2: In-memory filter (Node.js)
results = allUsers.filter(user => {
  const payload = JSON.parse(user.rawPayload);
  return evaluateFilter(ast, payload);  // 10,000 JSON.parse() + filter evaluations
});
```

**With PostgreSQL JSONB**:
```sql
-- Single query, fully pushed to database
SELECT * FROM "ScimUser"
WHERE "endpointId" = 'ep-001'
  AND "active" = true
  AND "rawPayload"->'emails' @> '[{"type": "work"}]'
  AND "rawPayload"->'emails'->0->>'value' ILIKE '%example.com%'
```

### 5.2 POST Create User — Header Comparison

**Request**:
```http
POST /scim/endpoints/ep-001/Users HTTP/1.1
Host: scimserver-app.eastus.azurecontainerapps.io
Content-Type: application/scim+json
Authorization: Bearer eyJhbGciOiJI...

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "John.S@Example.COM",
  "active": true,
  "name": { "givenName": "John", "familyName": "Smith" },
  "emails": [{ "value": "john.s@example.com", "type": "work", "primary": true }]
}
```

**Response** (same in both cases):
```http
HTTP/1.1 201 Created
Content-Type: application/scim+json
Location: https://scimserver-app.eastus.azurecontainerapps.io/scim/endpoints/ep-001/Users/cm5abc123

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "cm5abc123",
  "userName": "John.S@Example.COM",
  "meta": {
    "resourceType": "User",
    "created": "2026-02-13T10:30:00.000Z",
    "lastModified": "2026-02-13T10:30:00.000Z",
    "location": "https://scimserver-app.../scim/endpoints/ep-001/Users/cm5abc123"
  }
}
```

**Difference is in the INSERT**:

| Aspect | SQLite (Current) | PostgreSQL (Target) |
|--------|-------------------|---------------------|
| SQL | `INSERT INTO ScimUser (userName, userNameLower, rawPayload, ...) VALUES (?, ?, ?, ...)` | `INSERT INTO "ScimUser" ("userName", "rawPayload", ...) VALUES ($1, $2::jsonb, ...)` |
| Columns | 2 columns for userName (original + lowercase) | 1 column (`CITEXT`) |
| JSON storage | `JSON.stringify()` → TEXT | Direct JSONB insertion with validation |
| Uniqueness check | `UNIQUE(endpointId, userNameLower)` | `UNIQUE(endpointId, userName)` — CITEXT handles casing |
| Concurrent safety | Global write lock held | Row-level lock only |

### 5.3 Backup Configuration — ENV Variables

**Current (SQLite)**:
```env
DATABASE_URL=file:/tmp/local-data/scim.db
BLOB_BACKUP_ACCOUNT=scimserverstorage
BLOB_BACKUP_CONTAINER=scimserver-backups
BLOB_BACKUP_INTERVAL_MIN=5
```

**PostgreSQL**:
```env
DATABASE_URL=postgresql://scimadmin:***@scimserver-pg.postgres.database.azure.com:5432/scimdb?sslmode=require
# No backup env vars needed — Azure manages backups automatically
```

---

## 6. Summary Matrix

| # | Compromise | Category | Severity | Eliminated by PostgreSQL? | Effort to Migrate |
|---|-----------|----------|----------|--------------------------|-------------------|
| 3.1.1 | `userNameLower` derived column | Schema | HIGH | ✅ `CITEXT` | Medium |
| 3.1.2 | `displayNameLower` derived column | Schema | HIGH | ✅ `CITEXT` | Medium |
| 3.1.3 | `rawPayload` as TEXT | Schema | MEDIUM | ✅ `JSONB` | Low |
| 3.1.4 | No `@db.*` annotations | Schema | LOW | ✅ | Low |
| 3.1.5 | Table-rebuild migrations | Schema | MEDIUM | ✅ `ALTER TABLE` | None (automatic) |
| 3.1.6 | Provider lock-in | Schema | MEDIUM | Migration needed | Medium |
| 3.2.1 | WAL + busy_timeout | Concurrency | **CRITICAL** | ✅ MVCC | Low (remove PRAGMAs) |
| 3.2.2 | Buffered logging | Concurrency | **CRITICAL** | ✅ Concurrent writes | Medium (simplify) |
| 3.2.3 | Pre-transaction resolution | Concurrency | HIGH | ✅ Row-level locks | Low (optional cleanup) |
| 3.2.4 | Generous timeouts | Concurrency | MEDIUM | ✅ | Low |
| 3.2.5 | Sequential E2E tests | Concurrency | LOW | ✅ Parallel schemas | Low |
| 3.3.1 | Single replica | Infrastructure | **CRITICAL** | ✅ Shared DB | Low (change Bicep param) |
| 3.3.2 | Ephemeral storage | Infrastructure | **CRITICAL** | ✅ Persistent DB | Low (remove backup code) |
| 3.3.3 | Azure Files incompatibility | Infrastructure | HIGH | ✅ No file I/O | Low (remove storage infra) |
| 3.3.4 | 5-minute RPO | Infrastructure | HIGH | ✅ PITR (seconds) | None (managed) |
| 3.3.5 | Entrypoint restore dance | Infrastructure | MEDIUM | ✅ Connection string | Low (simplify script) |
| 3.3.6 | Lock file cleanup | Infrastructure | LOW | ✅ | Low |
| 3.4.1 | In-memory filters | Query | HIGH | ✅ JSONB + GIN | Medium |
| 3.4.2 | `createMany` no RETURNING | Query | MEDIUM | ✅ `RETURNING` | Low |
| 3.4.3 | Only `eq` pushed to DB | Query | MEDIUM | ✅ Full SQL | Medium |
| 3.5.1 | No CITEXT/ILIKE | Feature | HIGH | ✅ Native | Low (remove toLowerCase) |
| 3.5.2 | Raw PRAGMA queries | Feature | LOW | ✅ Not needed | Low (delete code) |
| 3.6.1 | No WAL checkpoint | Backup | HIGH | ✅ Managed backup | None |
| 3.6.2 | Binary file copy backup | Backup | MEDIUM | ✅ `pg_dump` / PITR | None |
| 3.6.3 | Storage infra for file-based DB | Backup | LOW | ✅ Not needed | Low (remove Bicep) |

**Totals**: 4 CRITICAL, 8 HIGH, 11 MEDIUM, 5 LOW — **28 compromises total**

---

## 7. Migration Recommendations

### 7.1 Recommended Target: Azure Database for PostgreSQL – Flexible Server

| Property | Recommendation |
|----------|---------------|
| **Service** | Azure Database for PostgreSQL – Flexible Server |
| **SKU** | Burstable B1ms (1 vCore, 2 GB RAM) — sufficient for SCIM workloads |
| **Storage** | 32 GB Premium SSD (auto-grow enabled) |
| **HA** | Zone-redundant (optional, enables 99.99% SLA) |
| **Backup** | 7-day retention with PITR (configurable up to 35 days) |
| **Networking** | Private endpoint in same VNet as Container Apps |
| **Cost** | ~$13/month (Burstable B1ms) vs. current ~$0.36/month (Storage Account only) |

### 7.2 Migration Steps (Phased)

#### Phase 1: Dual-Provider Schema (1-2 days)

1. Create a new Prisma schema for PostgreSQL:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. Remove `userNameLower` and `displayNameLower` columns
3. Add `@db.Citext` to `userName` and `displayName`
4. Change `rawPayload` to `@db.JsonB`
5. Generate fresh migration baseline

#### Phase 2: Application Code Cleanup (2-3 days)

1. Remove `PRAGMA` statements from `PrismaService.onModuleInit()`
2. Simplify `LoggingService` — remove buffering, use direct `create()` per request
3. Remove pre-transaction member resolution pattern (optional — still valid but unnecessary)
4. Reduce transaction timeouts to `{ maxWait: 2000, timeout: 5000 }`
5. Expand `tryPushToDb()` to support `co`, `sw`, `ew`, `gt`, `lt` operators
6. Simplify `createMany` identifier backfill using `RETURNING`
7. Remove WAL-specific comments that no longer apply

#### Phase 3: Infrastructure Cleanup (1 day)

1. Add PostgreSQL Flexible Server Bicep template
2. Update `containerapp.bicep`:
   - Change `maxReplicas` default to 3+
   - Remove `BLOB_BACKUP_ACCOUNT` and `BLOB_BACKUP_CONTAINER` env vars
   - Replace `DATABASE_URL` with PostgreSQL connection string (from Key Vault)
3. Simplify `docker-entrypoint.sh` to just run migrations and start
4. Remove `blob-storage.bicep`, `storage.bicep` if no longer needed
5. Remove `BackupService` module entirely

#### Phase 4: Test Updates (1 day)

1. Update `jest-e2e.config.ts` — set `maxWorkers: 4` for parallel execution
2. Remove `global-teardown.ts` file cleanup logic
3. Update `global-setup.ts` to create isolated PostgreSQL test schemas
4. Remove `-journal` and `-wal` file references

### 7.3 Interim Mitigations (While Staying on SQLite)

If PostgreSQL migration is not immediately feasible, these should be implemented:

| # | Mitigation | Priority | Effort |
|---|-----------|----------|--------|
| 1 | **Add WAL checkpoint before backup** | P0 | 30 min |
| 2 | **Reduce backup interval to 1 minute** | P1 | 5 min |
| 3 | **Add `-wal` file to blob backup** | P1 | 1 hour |
| 4 | **Add connection pooling via Prisma** `connection_limit` | P2 | 15 min |
| 5 | **Add DB size monitoring endpoint** | P2 | 1 hour |

**Highest priority**: Fix 3.6.1 (WAL checkpoint before backup) — without this, backups may be inconsistent.

---

## 8. Migration Effort Estimate

| Phase | Scope | Effort | Risk |
|-------|-------|--------|------|
| Phase 1: Schema | New Prisma schema, remove derived columns | 1-2 days | Low |
| Phase 2: Application | Simplify services, expand filter pushdown | 2-3 days | Medium |
| Phase 3: Infrastructure | Bicep templates, entrypoint, deploy scripts | 1 day | Low |
| Phase 4: Tests | E2E parallelization, cleanup | 1 day | Low |
| **Total** | **Full migration** | **5-7 days** | **Medium** |

**Data migration**: Use `prisma db seed` or a custom ETL script to transfer SQLite data to PostgreSQL. For small datasets (<100K records), a simple `pg_dump`-compatible SQL export is sufficient.

---

## 9. Decision Framework

```
                         ┌─────────────────────┐
                         │  Is this a permanent │
                         │  production service? │
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                    Yes  │                     │  No
                    ┌────┘                     └────┐
                    │                               │
          ┌─────────▼────────┐            ┌─────────▼────────┐
          │ Migrate to       │            │ Stay on SQLite   │
          │ PostgreSQL       │            │ + Apply interim  │
          │ (Phases 1-4)     │            │   mitigations    │
          │                  │            │   (Section 7.3)  │
          │ Benefits:        │            │                  │
          │ • HA + scaling   │            │ Acceptable for:  │
          │ • Zero data loss │            │ • Dev/test envs  │
          │ • Full SCIM      │            │ • PoC / demos    │
          │   compliance     │            │ • < 1K users     │
          │ • Simpler infra  │            │ • Single-tenant  │
          └──────────────────┘            └──────────────────┘
```

**Bottom line**: SQLite is an excellent choice for development, testing, and single-user scenarios. For a production SCIM server handling enterprise identity provisioning (Entra ID, Okta, etc.), PostgreSQL removes 28 architectural compromises and enables the system to operate as a proper enterprise service.

---

*Document generated from codebase audit on 2026-02-13. All file references are relative to the repository root.*
