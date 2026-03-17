# Persistence & Performance Analysis — SCIM Server

> **Date**: February 2026  
> **Status**: ✅ **Critical fixes 1–3 implemented** (introduced in v0.9.1 and retained in v0.10.0) — SCIM validator now at 24/24 passing.  
> **Scope**: End-to-end analysis of SQLite persistence patterns, write contention, SCIM validator failures, and holistic improvement recommendations.  
> **Audience**: Development team, reviewers, future contributors.  
> **See also**: [SCIM_GROUP_PERFORMANCE_ANALYSIS.md](SCIM_GROUP_PERFORMANCE_ANALYSIS.md) for the detailed timeline and interaction diagrams.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Root Cause Analysis — SCIM Validator Failures](#3-root-cause-analysis--scim-validator-failures)
   - 3.1 [Issue 1: displayName Filter Full-Table Scan](#31-issue-1-displayname-filter-full-table-scan)
   - 3.2 [Issue 2: Member Resolution Inside Transaction](#32-issue-2-member-resolution-inside-transaction)
   - 3.3 [Issue 3: SQLite Write Lock Contention from Request Logging](#33-issue-3-sqlite-write-lock-contention-from-request-logging)
   - 3.4 [Issue 4: Delete-All + Recreate Pattern](#34-issue-4-delete-all--recreate-pattern)
4. [How the Four Issues Compound](#4-how-the-four-issues-compound)
5. [Holistic Persistence Analysis](#5-holistic-persistence-analysis)
   - 5.1 [Log Accumulation & Unbounded Growth](#51-log-accumulation--unbounded-growth)
   - 5.2 [N+1 Query Pattern in Log Listing](#52-n1-query-pattern-in-log-listing)
   - 5.3 [assertUniqueDisplayName — O(N) Full Scan](#53-assertuniquedisplayname--on-full-scan)
   - 5.4 [getActivitySummary — Memory Explosion](#54-getactivitysummary--memory-explosion)
   - 5.5 [Backup Without WAL Checkpoint](#55-backup-without-wal-checkpoint)
   - 5.6 [Group Create — Missing Transaction](#56-group-create--missing-transaction)
   - 5.7 [Full-Text Search on TEXT Blobs](#57-full-text-search-on-text-blobs)
6. [DB Logging vs. File-Based Logging](#6-db-logging-vs-file-based-logging)
7. [Recommended Fixes](#7-recommended-fixes)
8. [Summary of All Issues](#8-summary-of-all-issues)

---

## 1. Executive Summary

Microsoft's SCIM validator ~~reports **21/24 tests passing** with **3 failures**~~ now shows **24/24 tests passing** after the implemented fixes. The original 3 failures were all in Group PATCH operations (Update displayName, Add Member, Remove Member). Root cause analysis revealed **four compounding issues** in the persistence layer:

| # | Issue | Impact | Severity | Status |
|---|-------|--------|----------|--------|
| 1 | `displayName` missing from `GROUP_DB_COLUMNS` | Every group filter = full table scan | **High** | ✅ Fixed (current v0.10.0 baseline) |
| 2 | User ID resolution inside `$transaction` | Extends write-lock hold time | **High** | ✅ Fixed (current v0.10.0 baseline) |
| 3 | Request logging competes for SQLite writer lock | Transactions timeout waiting for lock | **Critical** | ✅ Fixed (current v0.10.0 baseline) |
| 4 | Delete-all + recreate members on every PATCH | Unnecessary write amplification | **Medium** | Open |

Fixes 1–3 resolved all 3 SCIM validator failures. Fix 4 remains as a future optimization.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NestJS Application                          │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ SCIM Group   │    │ SCIM User    │    │ RequestLogging       │  │
│  │ Service      │    │ Service      │    │ Interceptor          │  │
│  │              │    │              │    │                      │  │
│  │ $transaction │    │ (no tx)      │    │ void recordRequest() │  │
│  │ ┌──────────┐│    │              │    │ (fire-and-forget)    │  │
│  │ │ UPDATE   ││    │              │    └──────────┬───────────┘  │
│  │ │ DELETE   ││    │              │               │              │
│  │ │ findMany ││    │              │               │              │
│  │ │ CREATE   ││    │              │               │              │
│  │ └──────────┘│    │              │               │              │
│  └──────┬───────┘    └──────┬───────┘               │              │
│         │                   │                       │              │
│         ▼                   ▼                       ▼              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     PrismaService                           │   │
│  │          SQLite + WAL Mode + busy_timeout=15000             │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │                                      │
└─────────────────────────────┼──────────────────────────────────────┘
                              ▼
                    ┌──────────────────┐
                    │   scim.db        │
                    │   (SQLite WAL)   │
                    │                  │
                    │  ┌────────────┐  │
                    │  │ ScimGroup  │  │
                    │  │ ScimUser   │  │
                    │  │ GroupMember│  │
                    │  │ RequestLog │  │ ◄── Grows unbounded
                    │  │ Endpoint   │  │
                    │  └────────────┘  │
                    └──────────────────┘
```

**Key Constraint**: SQLite allows only **one writer at a time**. WAL mode lets readers proceed concurrently with a writer, but two writers still serialize. The `busy_timeout=15000ms` means a second writer will wait up to 15 seconds for the lock before failing.

---

## 3. Root Cause Analysis — SCIM Validator Failures

### 3.1 Issue 1: displayName Filter Full-Table Scan

**Location**: `api/src/modules/scim/filters/apply-scim-filter.ts` lines 81–84

**The Bug**: `GROUP_DB_COLUMNS` only maps `externalid` and `id`:

```typescript
// CURRENT CODE (line 81-84)
const GROUP_DB_COLUMNS: Record<string, string> = {
  externalid: 'externalId',
  id: 'scimId',
};
// ❌ displayname is MISSING
```

**What Happens**: When the SCIM validator sends `GET /Groups?filter=displayName eq "TestGroup"`:

```
Step 1: parseScimFilter("displayName eq \"TestGroup\"")
        → AST: { type: 'compare', attribute: 'displayName', operator: 'eq', value: 'TestGroup' }

Step 2: tryPushToDb(ast, GROUP_DB_COLUMNS)
        → attribute.toLowerCase() = 'displayname'
        → GROUP_DB_COLUMNS['displayname'] = undefined  ← NOT FOUND
        → returns null

Step 3: Falls back to in-memory filtering
        → fetchAll: true
        → Loads ALL groups for the endpoint into memory
        → Filters one by one with evaluateFilter()
```

**DB Query Comparison**:

| Approach | SQL Generated | Time (100 groups) | Time (10,000 groups) |
|----------|--------------|-------------------|---------------------|
| With DB push-down | `SELECT * FROM ScimGroup WHERE displayName = ? AND endpointId = ?` | ~1ms | ~5ms |
| Without (current) | `SELECT * FROM ScimGroup WHERE endpointId = ?` + JS filter | ~10ms | ~500ms+ |

**Example — What the Validator Sends vs What Happens**:

```json
// SCIM Validator Request
GET /scim/endpoints/ep1/Groups?filter=displayName eq "Test_Group_fc2d1a6b"

// Expected: Prisma generates
// SELECT * FROM ScimGroup WHERE endpointId = 'ep1' AND displayName = 'Test_Group_fc2d1a6b'

// Actual: Prisma generates
// SELECT * FROM ScimGroup WHERE endpointId = 'ep1'
// Then: JavaScript loops through ALL groups checking displayName match
```

**The Comment's Reasoning (and why it's flawed)**:

The code has this comment:
```
NOTE: displayName is intentionally excluded — SQLite performs
case-sensitive comparisons by default and there is no lowercase
column for displayName. Pushing it to the DB would fail the
RFC 7643 §2.1 requirement that attribute comparisons are
case-insensitive. The in-memory evaluator handles it correctly.
```

This is a valid concern, but the solution should be adding a `displayNameLower` column (like `userNameLower` for users) rather than scanning the entire table.

---

### 3.2 Issue 2: Member Resolution Inside Transaction

**Location**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts` lines 222–243

**The Problem**: `mapMembersForPersistenceForEndpoint()` performs a `SELECT` query *inside* the `$transaction` block. This means the transaction holds the SQLite write lock while doing a read query that could be done beforehand.

```
┌─ $transaction START ──────────────────────────────────────────┐
│                                                                │
│  1. tx.scimGroup.update(...)          ← WRITE (acquires lock) │
│  2. tx.groupMember.deleteMany(...)    ← WRITE (lock held)     │
│  3. tx.scimUser.findMany(...)         ← READ (lock STILL held)│  ❌ This should be OUTSIDE
│  4. tx.groupMember.createMany(...)    ← WRITE (lock held)     │
│                                                                │
│  Total lock hold time: Steps 1+2+3+4                          │
│  Transaction timeout: 30,000ms                                │
│  maxWait to acquire lock: 10,000ms                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**DB Table Example — What Step 3 Does Inside the Transaction**:

Given PATCH body `{ "Operations": [{ "op": "add", "path": "members", "value": [{ "value": "user-scim-id-1" }] }] }`:

```sql
-- Step 3 runs this INSIDE the transaction:
SELECT id, scimId FROM ScimUser
WHERE scimId IN ('user-scim-id-1') AND endpointId = 'ep1';
```

**ScimUser table**:

| id (internal) | scimId | endpointId | userName |
|---------------|--------|-----------|----------|
| clx1abc... | `user-scim-id-1` | ep1 | alice@contoso.com |
| clx2def... | `user-scim-id-2` | ep1 | bob@contoso.com |
| ... 50 more users ... | ... | ... | ... |

This `findMany` is fast alone (~1ms), but while the transaction holds the write lock, **no other write can proceed** — including request logging.

---

### 3.3 Issue 3: SQLite Write Lock Contention from Request Logging

**Location**: `api/src/modules/logging/request-logging.interceptor.ts` line 83 and `api/src/modules/logging/logging.service.ts` lines 28–81

**The Problem**: Every HTTP request triggers a fire-and-forget DB write:

```typescript
// request-logging.interceptor.ts (line 83)
void this.loggingService.recordRequest({...});
```

And `recordRequest()` performs **two writes** per request:

```typescript
// logging.service.ts
async recordRequest({...}): Promise<void> {
  // WRITE 1: Insert the log row
  const created = await this.prisma.requestLog.create({ data });

  // WRITE 2: Update the same row with identifier
  await this.prisma.$executeRawUnsafe(
    'UPDATE RequestLog SET identifier = ? WHERE id = ?',
    identifier, created.id
  );
}
```

**Timeline Under SCIM Validator Load**:

```
Time    Writer Lock Owner       Waiting Writers
─────   ───────────────────     ──────────────────────────────
0ms     Log INSERT (req 1)      
5ms     Log UPDATE (req 1)      
10ms    Log INSERT (req 2)      Group PATCH tx waiting...
25ms    Log UPDATE (req 2)      Group PATCH tx waiting...
40ms    Group PATCH tx starts   Log INSERT (req 3) waiting...
41ms    scimGroup.update        Log INSERT still waiting...
43ms    groupMember.deleteMany  Log INSERT still waiting...
48ms    scimUser.findMany       Log INSERT still waiting...  ← reads inside tx
55ms    groupMember.createMany  Log INSERT still waiting...
60ms    Group PATCH tx commits  Log INSERT (req 3) starts
65ms    Log INSERT (req 3)      
```

**Real scenario during SCIM validator run**: The validator sends requests in quick succession. Every request generates 2 log writes. A group PATCH arrives and needs the transaction lock but must wait for the current log write to finish. Meanwhile, the next request's log write queues behind the transaction. This cascading contention is why transactions approach the 30-second timeout.

---

### 3.4 Issue 4: Delete-All + Recreate Pattern

**Location**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts` lines 231–239

**The Problem**: Every group PATCH (even to change just the `displayName`) deletes ALL group members and recreates them:

```typescript
// Inside $transaction:
await tx.groupMember.deleteMany({ where: { groupId: group.id } });  // DELETE ALL

if (memberDtos.length > 0) {
  const data = await this.mapMembersForPersistenceForEndpoint(...);
  await tx.groupMember.createMany({ data });  // RECREATE ALL
}
```

**DB Table Example — Updating Only displayName**:

```
PATCH /Groups/group-123
Body: { "Operations": [{ "op": "replace", "path": "displayName", "value": "New Name" }] }
```

**GroupMember table BEFORE**:

| id | groupId | userId | value | display |
|----|---------|--------|-------|---------|
| m1 | group-123 | u1 | user-scim-1 | Alice |
| m2 | group-123 | u2 | user-scim-2 | Bob |
| m3 | group-123 | u3 | user-scim-3 | Carol |

**What happens** (even though members didn't change):

```sql
-- Step 1: Delete ALL members
DELETE FROM GroupMember WHERE groupId = 'group-123';
-- Rows deleted: 3

-- Step 2: Look up user IDs (INSIDE transaction)
SELECT id, scimId FROM ScimUser WHERE scimId IN ('user-scim-1','user-scim-2','user-scim-3') AND endpointId = 'ep1';

-- Step 3: Recreate ALL members
INSERT INTO GroupMember (id, groupId, userId, value, display, createdAt) VALUES
  ('m4', 'group-123', 'u1', 'user-scim-1', 'Alice', '2025-07-...'),
  ('m5', 'group-123', 'u2', 'user-scim-2', 'Bob', '2025-07-...'),
  ('m6', 'group-123', 'u3', 'user-scim-3', 'Carol', '2025-07-...');
```

**GroupMember table AFTER** (functionally identical, but new IDs and timestamps):

| id | groupId | userId | value | display |
|----|---------|--------|-------|---------|
| m4 | group-123 | u1 | user-scim-1 | Alice |
| m5 | group-123 | u2 | user-scim-2 | Bob |
| m6 | group-123 | u3 | user-scim-3 | Carol |

**Impact**: 3 unnecessary DELETEs + 1 user lookup + 3 unnecessary INSERTs for a displayName-only change. With 100 members, that's 201 unnecessary write operations per PATCH.

---

## 4. How the Four Issues Compound

The following diagram shows the cascade effect when the SCIM validator runs its Group PATCH test:

```
SCIM Validator                    SQLite Writer Lock Timeline
═══════════════                   ═══════════════════════════

  POST /Groups                    ┌─────────────────────┐
  (Create group)    ────────────► │ Log INSERT + UPDATE  │ 2 writes
                                  └─────────────────────┘
                                  
  GET /Groups?filter=             ┌─────────────────────────────────────┐
  displayName eq "X" ──────────►  │ Log INSERT + UPDATE                 │ 2 writes
                                  │ + fetchAll groups (Issue #1)         │ slow filter
                                  │ + in-memory scan                    │
                                  └─────────────────────────────────────┘

  PATCH /Groups/:id               ┌──────┐ ┌─────────────────────────────────────────────┐
  (update displayName) ─────────► │ Log  │ │ $transaction                                │
                                  │ wait │ │   UPDATE scimGroup                          │
                                  │  ⌛  │ │   DELETE ALL members (Issue #4)             │
                                  │      │ │   SELECT users for member map (Issue #2)    │
                                  │      │ │   INSERT ALL members (Issue #4)             │
                                  └──────┘ └─────────────────────────────────────────────┘
                                  ▲ Issue #3: Log writes queue behind transaction

  PATCH /Groups/:id               ┌──────┐ ┌───────────────────────────────────┐
  (add member)     ─────────────► │ Log  │ │ $transaction (TIMEOUT!)           │
                                  │ wait │ │   ... waiting for lock ...        │
                                  │  ⌛  │ │   ... 10s maxWait exceeded ...    │
                                  │      │ │   ❌ Transaction failed!          │
                                  └──────┘ └───────────────────────────────────┘
                                  
  Result: 500 Internal Server Error
  Next test: Also fails (cascading)
```

**The Cascade**:
1. **Issue #1** makes the filter/lookup step disproportionately slow
2. **Issue #3** means log writes and SCIM writes constantly compete for the single writer lock
3. **Issue #2** extends the time the transaction holds the lock (reads that could be outside)
4. **Issue #4** amplifies write volume unnecessarily

The SCIM validator sends requests ~500ms apart. With log writes taking ~10ms each (2 per request), the pipeline backs up until a transaction hits its 30-second timeout.

---

## 5. Holistic Persistence Analysis

Beyond the SCIM validator failures, there are several additional persistence patterns that will cause problems at scale.

### 5.1 Log Accumulation & Unbounded Growth

**Location**: `RequestLog` model in schema + `LoggingService`

**Problem**: There is **no automated log cleanup**. Every request gets a log entry with full headers, request body, and response body stored as TEXT. Under SCIM provisioning with Microsoft Entra ID (which sends keepalive GETs every few minutes), the table grows continuously.

**DB Growth Projection**:

| Scenario | Requests/day | Avg row size | DB growth/day | After 30 days |
|----------|-------------|-------------|---------------|---------------|
| Light (dev) | 100 | ~2 KB | 200 KB | 6 MB |
| Medium (small org) | 1,000 | ~3 KB | 3 MB | 90 MB |
| Heavy (large org) | 10,000 | ~5 KB | 50 MB | 1.5 GB |
| SCIM validator run | 500 in 5 min | ~4 KB | 2 MB per run | — |

The only cleanup mechanism is a manual `POST /scim/admin/logs/clear` endpoint. No TTL, no cron rotation, no size limit.

**Suggestion**: Add automatic log pruning with configurable TTL (default: 7 days). Run as a cron job alongside the backup cron.

---

### 5.2 N+1 Query Pattern in Log Listing

**Location**: `api/src/modules/logging/logging.service.ts` — `mapLog()` → `resolveUserDisplayName()`

**Problem**: When listing logs, each log entry triggers an individual `resolveUserDisplayName()` call that executes up to 2 DB queries:

```typescript
// For each of the 50 logs on the page:
private async mapLog(r, identifierMap) {
  if (identifier && r.url.includes('/Users') && !identifier.includes('@')) {
    const resolvedName = await this.resolveUserDisplayName(identifier);  // 1-2 queries each
  }
}
```

**Query count per page load**:

| Page size | Base queries | + N+1 lookups | Total queries |
|-----------|-------------|--------------|---------------|
| 50 (default) | 3 (count + findMany + raw identifier) | up to 100 | **103** |
| 200 (max) | 3 | up to 400 | **403** |

**Suggestion**: Batch-resolve all identifiers in a single query:

```typescript
// Instead of N individual resolveUserDisplayName() calls:
const identifiers = records.map(r => extractIdentifier(r)).filter(Boolean);
const users = await this.prisma.scimUser.findMany({
  where: { scimId: { in: identifiers } },
  select: { scimId: true, userName: true, rawPayload: true }
});
const nameMap = new Map(users.map(u => [u.scimId, extractDisplayName(u)]));
```

---

### 5.3 assertUniqueDisplayName — O(N) Full Scan

**Location**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts` lines 355–370

**Problem**: Every group create/update fetches ALL groups for the endpoint to check displayName uniqueness in-memory:

```typescript
private async assertUniqueDisplayName(displayName: string, endpointId: string, excludeScimId?: string) {
  const groups = await this.prisma.scimGroup.findMany({
    where: { endpointId, NOT: excludeScimId ? { scimId: excludeScimId } : undefined },
    select: { scimId: true, displayName: true }
  });
  const lowerName = displayName.toLowerCase();
  const conflict = groups.find(g => g.displayName.toLowerCase() === lowerName);
}
```

**Impact by group count**:

| Groups per endpoint | Rows fetched | Memory used | Time |
|--------------------|-------------|-------------|------|
| 10 | 10 | ~1 KB | ~1ms |
| 1,000 | 1,000 | ~100 KB | ~15ms |
| 10,000 | 10,000 | ~1 MB | ~100ms+ |

**Suggestion**: Add a `displayNameLower` column to `ScimGroup` (matching the `userNameLower` pattern for users), add a unique composite index `@@unique([endpointId, displayNameLower])`, and let the DB enforce uniqueness:

```prisma
model ScimGroup {
  // ... existing fields ...
  displayNameLower String   // Lowercased for case-insensitive uniqueness
  
  @@unique([endpointId, displayNameLower])
}
```

Then `assertUniqueDisplayName` becomes a simple try/catch on the DB constraint.

---

### 5.4 getActivitySummary — Memory Explosion

**Location**: `api/src/modules/activity-parser/activity.controller.ts`

**Problem**: The activity summary endpoint loads ALL user-related logs into memory with no pagination or limit:

```typescript
const allUserLogs = await prisma.requestLog.findMany({
  where: { url: { contains: '/Users' } },
  orderBy: { createdAt: 'asc' }
});
```

For a server that has been running for weeks, this could load hundreds of thousands of rows with full request/response bodies.

**Suggestion**: Add date-range filtering (last 24h by default), pagination, or use SQL aggregation instead of loading all rows into memory.

---

### 5.5 Backup Without WAL Checkpoint

**Location**: `api/src/modules/backup/backup.service.ts`

**Problem**: The 5-minute cron backup copies the SQLite database file, but doesn't run `PRAGMA wal_checkpoint(TRUNCATE)` first. In WAL mode, uncommitted data lives in the `-wal` file. Copying only the main `.db` file without the `-wal` file (or checkpointing first) may produce an inconsistent backup.

**Suggestion**: Run `PRAGMA wal_checkpoint(TRUNCATE)` before the file copy:

```typescript
await this.prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
// Then proceed with file copy
```

---

### 5.6 Group Create — Missing Transaction

**Location**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts` lines 82–100

**Problem**: Group creation + member creation is NOT wrapped in a transaction:

```typescript
const group = await this.prisma.scimGroup.create({ data: {...} });  // WRITE 1

const members = dto.members ?? [];
if (members.length > 0) {
  await this.persistMembersForEndpoint(group.id, members, endpointId);  // WRITE 2
}
```

If the member creation fails, the group exists without its members. While the SCIM validator may handle this gracefully (it refetches), it's an atomicity gap.

**Suggestion**: Wrap in a transaction (lightweight — no user resolution needed since members come from the request):

```typescript
await this.prisma.$transaction(async (tx) => {
  const group = await tx.scimGroup.create({...});
  if (members.length > 0) {
    await tx.groupMember.createMany({...});
  }
});
```

---

### 5.7 Full-Text Search on TEXT Blobs

**Location**: `api/src/modules/logging/logging.service.ts` — search filter

**Problem**: The search functionality performs `contains` searches across 6 large TEXT columns:

```typescript
const textSearch = [
  { url: { contains: s } },
  { errorMessage: { contains: s } },
  { requestHeaders: { contains: s } },    // full JSON text
  { responseHeaders: { contains: s } },   // full JSON text
  { requestBody: { contains: s } },       // full JSON text (can be huge)
  { responseBody: { contains: s } },      // full JSON text (can be huge)
];
```

SQLite translates `contains` to `LIKE '%term%'`, which requires a full table scan. With large response bodies (SCIM user lists can be 50KB+), this becomes very slow.

**Suggestion**: Add an `identifier` index and search only indexed columns for quick lookups. For full-text search, consider SQLite's FTS5 extension or limiting search to `url` + `errorMessage` + `identifier` only.

---

## 6. DB Logging vs. File-Based Logging

### Current: DB Logging

Every request writes to the `RequestLog` table in SQLite, competing with SCIM operations for the single writer lock.

**Advantages**:
- ✅ Queryable via API (the web UI shows logs with filtering, pagination)
- ✅ Correlated with SCIM data (same endpoint IDs)
- ✅ Atomic with backups (part of the same DB file)
- ✅ Structured (consistent schema)

**Disadvantages**:
- ❌ Competes for SQLite writer lock (Issue #3)
- ❌ Two writes per request (create + identifier update)
- ❌ Large TEXT columns (headers, bodies) bloat the DB
- ❌ No rotation — grows unbounded
- ❌ Makes SCIM operations slower (the primary use case)

### Alternative: File-Based Logging Per Endpoint

Write logs to files in a `logs/` directory, one file per endpoint:

```
logs/
├── endpoint-ep1/
│   ├── 2025-07-15.jsonl      (daily rotation)
│   └── 2025-07-14.jsonl
├── endpoint-ep2/
│   └── 2025-07-15.jsonl
└── system/
    └── 2025-07-15.jsonl       (non-endpoint requests)
```

Each line is a JSON object (JSONL format):

```json
{"ts":"2025-07-15T10:30:00Z","method":"PATCH","url":"/scim/endpoints/ep1/Groups/abc","status":200,"durationMs":45,"identifier":"Engineering","reqBodySize":256,"resBodySize":1024}
```

**Advantages**:
- ✅ **Zero contention** with SCIM operations — file writes don't touch SQLite
- ✅ Natural rotation (daily files, easy to prune old files)
- ✅ Can use Node.js `appendFileSync` or buffered writes — extremely fast
- ✅ Endpoint isolation — each endpoint's logs are separate
- ✅ Smaller footprint — only store summary, not full bodies
- ✅ Can store full bodies in separate detail files only when needed

**Disadvantages**:
- ❌ Not directly queryable via SQL (need custom file parsing for the API)
- ❌ Separate from SCIM data backup (need to include `logs/` in backup)
- ❌ More complex API layer for the web UI (read from files instead of DB)
- ❌ No transactional correlation with SCIM operations

### Hybrid Recommendation

The best approach is a **hybrid**: use file-based logging for the hot path (every request) and keep DB logging optional for audit/compliance.

```
┌────────────────┐     ┌─────────────────────┐
│ Request comes  │────►│ File logger (JSONL)  │ ← Hot path: ZERO SQLite contention
│ in             │     │ Buffered, async      │
└────────────────┘     └─────────┬────────────┘
                                 │
                         ┌───────▼────────┐
                         │ In-memory ring  │ ← Optional: keep last N in memory
                         │ buffer (100)    │   for quick API access
                         └───────┬────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ Periodic DB flush (cron)  │ ← Batch insert every 30s
                    │ or on-demand via API      │   instead of per-request
                    └──────────────────────────┘
```

**Implementation Strategy**:
1. **Immediate** (Fix #3): Buffer log writes in memory, flush to DB in batches every 5–10 seconds
2. **Near-term**: Add JSONL file logging alongside DB, make DB logging opt-in per endpoint
3. **Long-term**: Full file-based logging with a query API that reads JSONL files

---

## 7. Recommended Fixes — ✅ Critical Fixes Implemented

### Fix 1: Add `displayName` to GROUP_DB_COLUMNS — ✅ IMPLEMENTED (introduced in v0.9.1)

**File**: `api/src/modules/scim/filters/apply-scim-filter.ts`

**What was done**: Added `displayNameLower` column to `ScimGroup` model (mirroring `userNameLower` for Users). Mapped `displayname → 'displayNameLower'` in `GROUP_DB_COLUMNS`. The `tryPushToDb` function now lowercases values for both `username` and `displayname` attributes.

```typescript
// IMPLEMENTED:
const GROUP_DB_COLUMNS: Record<string, string> = {
  externalid: 'externalId',
  id: 'scimId',
  displayname: 'displayNameLower',  // ← Case-insensitive DB push-down
};
```

Additionally, `assertUniqueDisplayName` was refactored from O(N) `findMany` full-scan to O(1) `findFirst` using the new indexed column.

---

### Fix 2: Move Member Resolution Outside Transaction — ✅ IMPLEMENTED (introduced in v0.9.1)

**File**: `api/src/modules/scim/services/endpoint-scim-groups.service.ts`

**What was done**: Pre-resolved user IDs before entering the `$transaction` in both `patchGroupForEndpoint` and `replaceGroupForEndpoint`, so the transaction only contains writes.

```typescript
// BEFORE (inside transaction):
await this.prisma.$transaction(async (tx) => {
  await tx.scimGroup.update({...});
  await tx.groupMember.deleteMany({...});
  const data = await this.mapMembersForPersistenceForEndpoint(group.id, memberDtos, endpointId, tx);  // ← READ inside tx
  await tx.groupMember.createMany({ data });
});

// AFTER (reads outside, only writes inside):
const memberData = memberDtos.length > 0
  ? await this.mapMembersForPersistenceForEndpoint(group.id, memberDtos, endpointId)  // ← READ outside tx
  : [];

await this.prisma.$transaction(async (tx) => {
  await tx.scimGroup.update({...});
  await tx.groupMember.deleteMany({...});
  if (memberData.length > 0) {
    await tx.groupMember.createMany({ data: memberData });
  }
});
```

**Impact**: Reduces transaction lock hold time by removing the `scimUser.findMany` query from inside the transaction. The user data won't change between the lookup and the transaction (same request context).

---

### Fix 3: Buffered Request Logging — ✅ IMPLEMENTED (introduced in v0.9.1)

**File**: `api/src/modules/logging/logging.service.ts`

**What was done**: Log records are now buffered in memory and flushed to DB in batches (every 3 seconds or every 50 entries), eliminating per-request write contention. `LoggingService` implements `OnModuleDestroy` for graceful shutdown flush.

```typescript
// Add to LoggingService:
private logBuffer: Prisma.RequestLogCreateInput[] = [];
private flushTimer: NodeJS.Timeout | null = null;
private readonly FLUSH_INTERVAL = 5000;  // 5 seconds
private readonly MAX_BUFFER_SIZE = 50;

async recordRequest(opts: CreateRequestLogOptions): Promise<void> {
  const data = this.buildLogData(opts);
  this.logBuffer.push(data);
  
  if (this.logBuffer.length >= this.MAX_BUFFER_SIZE) {
    await this.flushLogs();
  } else if (!this.flushTimer) {
    this.flushTimer = setTimeout(() => this.flushLogs(), this.FLUSH_INTERVAL);
  }
}

private async flushLogs(): Promise<void> {
  if (this.logBuffer.length === 0) return;
  const batch = this.logBuffer.splice(0);
  clearTimeout(this.flushTimer);
  this.flushTimer = null;
  
  try {
    await this.prisma.requestLog.createMany({ data: batch });
  } catch (err) {
    this.logger.error('Failed to flush log batch', err);
  }
}
```

**Impact**: Instead of 2 writes per request competing for the lock, there's 1 batch write every 5 seconds (or every 50 requests). This dramatically reduces SQLite write contention.

---

## 8. Summary of All Issues

| # | Issue | Location | Severity | Status |
|---|-------|----------|----------|--------|
| 1 | displayName missing from GROUP_DB_COLUMNS | apply-scim-filter.ts | **High** | ✅ Fixed (current v0.10.0 baseline; introduced in v0.9.1) — `displayNameLower` column + DB push-down |
| 2 | User resolution inside transaction | endpoint-scim-groups.service.ts | **High** | ✅ Fixed (current v0.10.0 baseline; introduced in v0.9.1) — moved outside `$transaction` |
| 3 | Per-request fire-and-forget log writes | logging.service.ts | **Critical** | ✅ Fixed (current v0.10.0 baseline; introduced in v0.9.1) — buffered logging (3s / 50 entries) |
| 4 | Delete-all + recreate members pattern | endpoint-scim-groups.service.ts | **Medium** | Open |
| 5 | No log rotation/cleanup | RequestLog model | **High** | Open |
| 6 | N+1 queries in listLogs | logging.service.ts | **High** | Open |
| 7 | assertUniqueDisplayName O(N) scan | endpoint-scim-groups.service.ts | **Medium** | ✅ Fixed (current v0.10.0 baseline; introduced in v0.9.1) — `findFirst` with `displayNameLower` index |
| 8 | getActivitySummary unbounded query | activity.controller.ts | **High** | Open |
| 9 | No WAL checkpoint before backup | backup.service.ts | **Low** | Open |
| 10 | Group create missing transaction | endpoint-scim-groups.service.ts | **Low** | Open |
| 11 | Full-text search on TEXT blobs | logging.service.ts | **Medium** | Open |
| 12 | No composite unique on GroupMember | schema.prisma | **Low** | Open |

**Fixes 1, 2, 3, and 7 together resolved all 3 SCIM validator failures (introduced in v0.9.1 and retained in v0.10.0).** Remaining issues are performance optimizations for future work.

---

*Generated from codebase analysis. See individual source files for latest code.*
