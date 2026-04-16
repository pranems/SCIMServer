# Post-v0.34.0 Changes — Root Cause Analysis & Necessity Assessment

> **Date:** April 15, 2026  
> **Base Commit:** `1fbe17f9` — *fix(G7): wire caseExactPaths from schema cache into GroupsService* (April 13, 12:34)  
> **HEAD Commit:** `e1e9bc1a` — *docs: freshness sweep v0.36.0* (April 15, 21:53)  
> **Scope:** 26 commits over 2 days, 95 files changed, +11,602/−4,782 lines  
> **Last Successful Azure Live Test:** April 13, 2026 — v0.35.0, 743/743 pass, 100%  
> **Environment:** Windows, NestJS + Prisma + PostgreSQL 17, Docker Compose, Azure Container Apps

---

## Table of Contents

| § | Section | Purpose |
|---|---------|---------|
| 1 | [Executive Summary](#1-executive-summary) | Key findings at a glance |
| 2 | [Timeline of All Changes](#2-timeline-of-all-changes) | All 26 commits chronologically |
| 3 | [Baseline Context](#3-baseline-context) | State at v0.34.0 and last Azure deployment |
| 4 | [Phase 1: Documentation & logFileEnabled (19 commits)](#4-phase-1-documentation--logfileenabled-19-commits) | Apr 13 work — deployed to Azure as v0.35.0 |
| 5 | [Phase 2: v0.36.0 Web UI Overhaul (1 commit)](#5-phase-2-v036-web-ui-overhaul-1-commit) | Apr 15 Web UI fixes + test infra |
| 6 | [Phase 3: Performance Hardening (6 commits)](#6-phase-3-performance-hardening-6-commits) | Apr 15 post-v0.36.0 perf + reliability |
| 7 | [Issue #1: Web UI Infinite Re-Render Loop](#7-issue-1-web-ui-infinite-re-render-loop) | Root cause, fix, necessity |
| 8 | [Issue #2: StatisticsTab Hardcoded "SQLite"](#8-issue-2-statisticstab-hardcoded-sqlite) | Root cause, fix, necessity |
| 9 | [Issue #3: Dead BackupService Code in Header](#9-issue-3-dead-backupservice-code-in-header) | Root cause, fix, necessity |
| 10 | [Issue #4: Activity Summary N+1 Performance](#10-issue-4-activity-summary-n1-performance) | Root cause, fix, necessity |
| 11 | [Issue #5: Activity Summary — Incomplete count() Migration](#11-issue-5-activity-summary--incomplete-count-migration) | Root cause, fix, necessity |
| 12 | [Issue #6: Server Timeout Configuration](#12-issue-6-server-timeout-configuration) | Root cause, fix, necessity |
| 13 | [Issue #7: RequestLog Missing Performance Indexes](#13-issue-7-requestlog-missing-performance-indexes) | Root cause, fix, necessity |
| 14 | [Issue #8: Log Table Unbounded Growth](#14-issue-8-log-table-unbounded-growth) | Root cause, fix, necessity |
| 15 | [Issue #9: Dangerous Prisma Migration (deletedAt + Index)](#15-issue-9-dangerous-prisma-migration-deletedat--index) | Root cause, risk, necessity |
| 16 | [Issue #10: Docker Prisma Connection Timeout](#16-issue-10-docker-prisma-connection-timeout) | Root cause, fix, necessity |
| 17 | [Issue #11: logFileEnabled Default Inverted](#17-issue-11-logfileenabled-default-inverted) | Root cause, fix, necessity |
| 18 | [Issue #12: Local Server Startup Failures](#18-issue-12-local-server-startup-failures) | Root cause from terminal context |
| 19 | [Change-by-Change Necessity Verdict](#19-change-by-change-necessity-verdict) | Needed vs. not needed — all 26 commits |
| 20 | [Recommendations](#20-recommendations) | Immediate actions, deployment, documentation |

---

## 1. Executive Summary

Between commit `1fbe17f9` (April 13, 12:34) and HEAD (`e1e9bc1a`, April 15, 21:53), **26 commits** were made across **95 files** over 2 days. The work falls into three distinct phases:

1. **Phase 1 (Apr 13):** 19 commits — documentation rewrites, `logFileEnabled` default change, E2E tests. **Successfully deployed to Azure as v0.35.0 (743/743 pass).**
2. **Phase 2 (Apr 15):** 1 commit — v0.36.0 Web UI overhaul fixing 4 real bugs (infinite re-render, hardcoded SQLite, dead backup code, stale version fallback) + test infrastructure (152 Vitest + 86 Playwright tests).
3. **Phase 3 (Apr 15):** 6 commits — performance hardening (activity summary N+1 fix, server timeout, auto-prune, indexes) + unit tests + doc freshness sweep.

**Key findings:**
- **Phase 1 is fully validated** — Azure deployment succeeded, all 743 live tests pass.
- **Phase 2 fixes 4 real bugs** — all needed, well-tested.
- **Phase 3 has 1 dangerous migration** — `20260416025138` bundles stale schema drift (`DROP COLUMN deletedAt`, `DROP INDEX displayName_key`) with legitimate new indexes. These DROP operations target objects already handled by prior migrations and will fail on any database that already ran them.
- **The `deletedAt` column** was removed from `schema.prisma` in commit `4ecda76` (April 9) but **no migration was created at that time**. Prisma's `migrate dev` picked up the drift when the index migration was generated, producing a migration that is only safe on a specific database state.
- **No Azure deployment failures occurred since the base commit** — the last deploy was successful on April 13, v0.35.0. The `azure-live-pipeline.txt` shows an interrupted test run (10 lines), not a failure.
- **Server startup failures** visible in the terminal context were caused by running `node dist/main.js` from the wrong working directory (root instead of `api/`), not by code bugs.

---

## 2. Timeline of All Changes

```mermaid
gantt
    title All 26 Commits (April 13-15, 2026)
    dateFormat YYYY-MM-DD HH:mm
    axisFormat %m/%d %H:%M

    section Phase 1 (Docs + logFileEnabled)
    12 one-click examples          :done, c01, 2026-04-13 12:51, 5min
    Schema Customization Guide v3  :done, c02, 2026-04-13 13:56, 5min
    6 logging docs rewrite         :done, c03, 2026-04-13 15:04, 5min
    PATCH extension docs           :done, c04, 2026-04-13 15:11, 5min
    logFileEnabled default=true    :done, c05, 2026-04-13 15:17, 5min
    13 stale refs fix              :done, c06, 2026-04-13 15:53, 5min
    Troubleshooting sections       :done, c07, 2026-04-13 15:19, 5min
    Quick Start + Section 0        :done, c08, 2026-04-13 16:17, 5min
    CHANGELOG + norms              :done, c09, 2026-04-13 16:23, 5min
    Quick start rewrite            :done, c10, 2026-04-13 16:43, 5min
    7 doc gaps (1-8)               :done, c11, 2026-04-13 17:21, 20min
    Fix 9 remaining gaps           :done, c12, 2026-04-13 17:38, 5min
    11 E2E tests                   :done, c13, 2026-04-13 17:56, 5min
    Freshness sweep                :done, c14, 2026-04-13 17:59, 5min
    Bump v0.35.0                   :done, c15, 2026-04-13 18:11, 5min

    section Phase 2 (Web UI v0.36.0)
    v0.36.0 Web UI overhaul        :done, c16, 2026-04-15 19:21, 10min

    section Phase 3 (Perf Hardening)
    Groups N+1 fix                 :done, c17, 2026-04-15 19:46, 5min
    Full count() migration         :done, c18, 2026-04-15 20:46, 5min
    P1-P3 hardening                :done, c19, 2026-04-15 20:59, 5min
    Timeout 30s→120s fix           :done, c20, 2026-04-15 21:12, 5min
    Auto-prune tests               :done, c21, 2026-04-15 21:48, 5min
    Doc freshness sweep            :done, c22, 2026-04-15 21:53, 5min
```

### Commit Log

| # | Hash | Time | Message | Category |
|---|------|------|---------|----------|
| 1 | `ed907f3` | Apr 13 12:51 | docs: 12 one-click endpoint+extension examples | Docs |
| 2 | `f52e1f5` | Apr 13 13:56 | docs: SCHEMA_CUSTOMIZATION_GUIDE v3 | Docs |
| 3 | `f644dae` | Apr 13 15:04 | docs: rewrite 6 logging/observability docs | Docs |
| 4 | `0a66f0a` | Apr 13 15:11 | docs: PATCH extension details to 5 docs | Docs |
| 5 | `afddae4` | Apr 13 15:17 | feat: logFileEnabled default=true | **Feature** |
| 6 | `d98e0d5` | Apr 13 15:19 | docs: troubleshooting & RCA sections | Docs |
| 7 | `5192d71` | Apr 13 15:53 | docs: fix 13 stale references | Docs |
| 8 | `6b7e2a1` | Apr 13 16:17 | docs: Observability Quick Start | Docs |
| 9 | `7dff3e8` | Apr 13 16:23 | docs: CHANGELOG, Session_starter, INDEX | Docs |
| 10 | `e3f3222` | Apr 13 16:43 | docs: rewrite quick start sections | Docs |
| 11-14 | `d2ab09e..bbc3fb5` | Apr 13 17:21-25 | docs: 7 doc gaps (route fix, prune, activity, etc.) | Docs |
| 15 | `95c8af1` | Apr 13 17:38 | docs: fix 9 remaining gaps (9-17) | Docs |
| 16 | `3f0dccc` | Apr 13 17:25 | docs: log buffering + test files (Gaps 6-8) | Docs |
| 17 | `27d95d7` | Apr 13 17:56 | test(e2e): +11 logging E2E tests | Tests |
| 18 | `a1d840e` | Apr 13 17:59 | docs: freshness sweep E2E 939→950 | Docs |
| 19 | `e4bd0fc` | Apr 13 18:11 | chore: bump version 0.34.0 → 0.35.0 | Release |
| 20 | `0a02f55` | Apr 15 19:21 | feat: v0.36.0 Web UI overhaul | **Feature** |
| 21 | `851eabb` | Apr 15 19:46 | perf: Groups count N+1 fix | **Perf** |
| 22 | `77e1b96` | Apr 15 20:46 | perf: all fields count() + keepalive SQL | **Perf** |
| 23 | `f9c6d3c` | Apr 15 20:59 | feat: P1-P3 hardening (timeout+indexes+prune) | **Feature** |
| 24 | `ce17f89` | Apr 15 21:12 | fix: timeout 30s→120s | **Fix** |
| 25 | `18fba72` | Apr 15 21:48 | test: +25 auto-prune unit tests | Tests |
| 26 | `e1e9bc1` | Apr 15 21:53 | docs: freshness sweep 80→82 suites | Docs |

---

## 3. Baseline Context

### State at `1fbe17f9` (April 13, 12:34)

| Metric | Value |
|--------|-------|
| Version | v0.34.0 |
| Unit tests | 3,206 (80 suites) |
| E2E tests | 939 (45 suites) |
| Live tests | 739 (all pass) |
| Last Azure deployment | v0.34.0 (April 13, 10:49 — 739/739 pass) |

### Last Successful Azure Deployment

| Metric | Value |
|--------|-------|
| Test result file | `live-2026-04-13_18-50-27.json` |
| Version | **v0.35.0** |
| Base URL | `https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io` |
| Results | **743/743 pass, 0 fail, 100%** |
| Duration | 61 seconds |
| Commit | `e4bd0fc` (chore: bump version 0.34.0 → 0.35.0) |

**The Azure deployment is healthy at v0.35.0.** The file `azure-live-pipeline.txt` (10 lines, April 15) shows an interrupted test run attempt, not a deployment failure.

---

## 4. Phase 1: Documentation & logFileEnabled (19 commits)

**Status: ✅ DEPLOYED TO AZURE, ALL TESTS PASS**

This phase consists of 18 documentation commits and 1 feature commit:

### Production Source Changes

Only **2 source files** changed in Phase 1:

1. **`endpoint.service.ts`** — `syncEndpointFileLogging()` logic inverted: default changed from `false` → `true`. Previously, `logFileEnabled` had to be explicitly set to `true` to enable file logging. Now, it defaults to enabled; only explicit `false`/`"false"`/`"False"`/`"0"` disables it.

2. **`endpoint-config.interface.ts`** — Added `LOG_FILE_ENABLED` constant and definition to the config flags registry.

### Verdict

| Change | Needed? | Rationale |
|--------|---------|-----------|
| `logFileEnabled` default=true | ✅ Yes | Correct for dev/local — endpoints should have log files by default. Docker/Azure can override. |
| 18 documentation commits | ✅ Yes | Comprehensive doc rewrites, gap closures, freshness audits. Source-verified. |
| +11 E2E tests | ✅ Yes | Test coverage for logging endpoints (audit trail, prune, per-endpoint history). |

---

## 5. Phase 2: v0.36.0 Web UI Overhaul (1 commit)

**Status: ✅ TESTED LOCAL + DOCKER (743/743), NOT YET DEPLOYED TO AZURE**

Commit `0a02f55` is a large single commit containing:

### Production Bug Fixes (4 real bugs)

| Bug | Root Cause | Fix | Files |
|-----|-----------|-----|-------|
| **Infinite re-render loop** in Raw Logs tab | `setFilters(q)` called on every `load()` → new ref → useEffect dependency change → re-fires `load()` → infinite loop | Added `useRef` for stable references; only call `setFilters` when filters actually changed (override or page reset) | `App.tsx` |
| **StatisticsTab hardcoded "SQLite"** | `StatisticsTab.tsx` rendered `<span>SQLite</span>` regardless of backend | Backend now returns `database: { type, persistenceBackend }` in `/statistics` response; UI reads dynamically | `StatisticsTab.tsx`, `DatabaseBrowser.tsx`, `database.service.ts` |
| **Dead `fetchBackupStats()` spamming 404s** | `Header.tsx` called `fetchBackupStats()` every 30s — endpoint was deleted in v0.23.0 when BackupService was removed | Removed entire `BackupStats` interface, `fetchBackupStats()`, and Header backup indicator UI | `Header.tsx`, `client.ts` |
| **Hardcoded `v0.9.1` version fallback** | Footer showed `v0.9.1` even on v0.36.0 because fallback was never updated | Changed to show nothing until API responds with actual version | `App.tsx` |

### New Test Infrastructure

| Layer | Files | Tests |
|-------|-------|-------|
| Vitest (component) | 16 files | 152 tests |
| Playwright (E2E) | 6 files | 86 tests |

### Verdict

All 4 bug fixes are **genuinely needed**:
- The infinite re-render loop caused visible UI flickering (input boxes in Raw Logs tab).
- The 404 spam from dead `fetchBackupStats` polluted browser console every 30 seconds.
- "SQLite" was factually wrong — the database has been PostgreSQL since v0.11.0.
- `v0.9.1` was misleading — predates the entire codebase by months.

---

## 6. Phase 3: Performance Hardening (6 commits)

**Status: ⚠️ TESTED LOCAL + DOCKER, CONTAINS DANGEROUS MIGRATION**

| Commit | Hash | Summary |
|--------|------|---------|
| 21 | `851eabb` | Groups `findMany()` → `count()` |
| 22 | `77e1b96` | All 4 fields count() + SQL keepalive exclusion |
| 23 | `f9c6d3c` | Timeout + indexes + auto-prune + Prisma timeouts |
| 24 | `ce17f89` | Timeout 30s→120s correction |
| 25 | `18fba72` | Auto-prune unit tests (+25) |
| 26 | `e1e9bc1` | Doc freshness sweep |

Detailed analysis of each issue follows in sections 10–18.

---

## 7. Issue #1: Web UI Infinite Re-Render Loop

### Commits
`0a02f55` (v0.36.0)

### Symptoms
Raw Logs tab input boxes flickered constantly. The tab was unusable — typing in filter inputs caused immediate refresh cycles.

### Root Cause
In `App.tsx`, the `load()` function was called from a `useEffect` with `[filters]` as a dependency. Inside `load()`, `setFilters(q)` was called unconditionally at the end. This created an infinite loop:

```
useEffect fires → load() runs → setFilters(q) creates new object ref →
React sees filters changed → useEffect fires again → infinite loop
```

```typescript
// BEFORE (broken):
const load = useCallback(async (override?: LogQuery, applyPageReset?: boolean) => {
  // ... fetch logs ...
  setFilters(q); // ← ALWAYS creates new ref, even if nothing changed
}, [filters, token, hideKeepalive]);

// Auto-refresh effect:
useEffect(() => {
  const h = setInterval(() => { if (!loading && !selected) load(); }, 10000);
  return () => clearInterval(h);
}, [auto, loading, selected, load, token]); // load in deps → re-creates interval
```

### Fix Applied
1. Only call `setFilters(q)` when filters actually changed (via override or page reset):
   ```typescript
   if (override || applyPageReset) {
     setFilters(q);
   }
   ```
2. Use `useRef` for stable references to `load`, `loading`, and `selected` so useEffect dependencies don't trigger re-renders:
   ```typescript
   const loadRef = useRef(load);
   loadRef.current = load;
   ```
3. Auto-refresh interval deps reduced to `[auto, token]` only.

### Necessity: ✅ NEEDED — Real UI bug causing visible flickering.

---

## 8. Issue #2: StatisticsTab Hardcoded "SQLite"

### Commits
`0a02f55` (v0.36.0)

### Root Cause
`StatisticsTab.tsx` was a holdover from the original upstream project which used SQLite. After the PostgreSQL migration (v0.11.0, February 2026), the UI was never updated. The code literally read:
```tsx
<span className={styles.statNumber}>SQLite</span>
```

Additionally, it always showed "Data is ephemeral in container environment" — which is false for PostgreSQL with persistent storage.

### Fix Applied
1. Backend `DatabaseService.getStatistics()` now returns `database: { type: 'PostgreSQL', persistenceBackend: 'prisma' }` (or `'In-Memory'`/`'inmemory'`).
2. UI reads `statistics.database?.type` dynamically.
3. "Ephemeral" warning only shown when `persistenceBackend === 'inmemory'`.

### Necessity: ✅ NEEDED — Factually incorrect display.

---

## 9. Issue #3: Dead BackupService Code in Header

### Commits
`0a02f55` (v0.36.0)

### Root Cause
`Header.tsx` contained ~80 lines of backup status indicator code including:
- `fetchBackupStats()` API call every 30 seconds
- `BackupStats` interface
- `formatLastBackup()` utility

The `/admin/backup/stats` endpoint was **deleted in v0.23.0** (March 1, 2026) when the entire BackupService was removed. Since then, `Header.tsx` had been silently generating 404 errors every 30 seconds in the browser console.

### Fix Applied
Removed all backup-related code from `Header.tsx` and the `BackupStats` interface + `fetchBackupStats()` from `client.ts`.

### Necessity: ✅ NEEDED — Dead code causing continuous console 404 spam.

---

## 10. Issue #4: Activity Summary N+1 Performance

### Commit
`851eabb` — *perf: fix activity summary N+1 — use count() for Groups instead of findMany()*

### Root Cause
In `activity.controller.ts`, the `getActivitySummary()` method used a mix of strategies:
- `findMany()` for day/week/user logs (fetching all rows, then filtering in JS)
- `count()` for group and system operations

The Groups count specifically used `count()` but the system operations count was counting by exclusion (all non-User, non-Group URLs). Users and time-based counts used `findMany()` pulling all rows into memory.

### Fix Applied
Changed Groups from an already-correct `count()` to a cleaner `count()` with explicit `url contains /Groups` filter. Also removed the `system` operations key from the response entirely.

### Necessity: ✅ NEEDED — First step toward eliminating N+1.

### Side Effect
⚠️ **Breaking API change:** Removed `operations.system` from the response. Any client depending on this field will break. Should have been documented in CHANGELOG.

---

## 11. Issue #5: Activity Summary — Incomplete count() Migration

### Commit
`77e1b96` — *perf: activity summary — all fields use count() with SQL-level keepalive exclusion*

### Root Cause
After commit 21 fixed Groups, the remaining three fields (last24Hours, lastWeek, userOperations) still used `findMany()` with JavaScript-level keepalive filtering via `removeKeepalive()`.

### Fix Applied
Translated the keepalive detection logic into a Prisma `NOT { AND: [...] }` clause so all four counts use `count()` with SQL-level filtering.

```typescript
const notKeepalive = {
  NOT: {
    AND: [
      { method: 'GET' },
      { url: { contains: '/Users' } },
      { identifier: null },
      { OR: [{ status: null }, { status: { lt: 400 } }] },
      { url: { contains: '?filter=' } },
    ],
  },
};
```

### Necessity: ✅ NEEDED — Completes the N+1 fix. Eliminates all `findMany()` + JS filtering.

---

## 12. Issue #6: Server Timeout Configuration

### Commits
`f9c6d3c` (set to 30s) → `ce17f89` (corrected to 120s)

### Root Cause
Commit 23 (`f9c6d3c`) added explicit HTTP server timeout configuration:

```typescript
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000; // Set to 30s
httpServer.setTimeout(requestTimeoutMs);
httpServer.keepAliveTimeout = requestTimeoutMs;
```

**This was a regression** — Node.js's default `http.Server.setTimeout` is **120 seconds**. By explicitly setting it to 30s, requests that previously succeeded (e.g., Azure cold-start Prisma connections taking 10-30s) would now timeout.

Commit 24 (`ce17f89`) corrected this:
```typescript
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 120_000; // Restored to 120s
```

### Necessity Assessment

| Part | Verdict | Rationale |
|------|---------|-----------|
| `REQUEST_TIMEOUT_MS` env var | ✅ Useful | Makes timeout configurable for operators |
| `httpServer.setTimeout(120s)` | ⚠️ Neutral | Just restores Node.js default explicitly |
| `httpServer.keepAliveTimeout = 120s` | ✅ Useful | Node.js default is 5s — too low for Azure load balancer. Prevents premature connection drops. |
| Setting timeout to 30s (commit 23) | ❌ Regression | Self-inflicted bug requiring immediate follow-up fix |

### Code Comment Bug
The comment says `Default: 30 seconds` — this is **incorrect**. Node.js default is 120 seconds.

---

## 13. Issue #7: RequestLog Missing Performance Indexes

### Commit
`f9c6d3c`

### Change
Added two new indexes to `schema.prisma`:
```prisma
@@index([identifier])                    // For keepalive detection
@@index([createdAt, method, url])        // Composite for summary counts
```

### Root Cause
The activity summary queries filter by `createdAt`, `method`, `url`, and `identifier IS NULL`. Without indexes on these columns, PostgreSQL does sequential scans as the `RequestLog` table grows.

### Necessity: ✅ NEEDED — Supports the count() queries from commits 21-22.

---

## 14. Issue #8: Log Table Unbounded Growth

### Commit
`f9c6d3c`

### Change
Added auto-prune functionality to `LoggingService`:

| Feature | Details |
|---------|---------|
| Timer | Runs on configurable interval (default: 1h) |
| Retention | `LOG_RETENTION_DAYS` env (default: **1 day**) |
| Enable/disable | `LOG_AUTO_PRUNE` env (default: **true**) |
| Runtime config | `GET/PUT /admin/log-config/prune` |
| Lifecycle | `OnModuleInit` starts timer, `OnModuleDestroy` clears |

### Root Cause
`RequestLog` table has no automatic cleanup mechanism. Production databases accumulate logs indefinitely.

### Necessity: ⚠️ USEFUL BUT DEFAULTS ARE RISKY

| Concern | Issue |
|---------|-------|
| **1-day default retention** | Production logs deleted after 24h. Debugging incidents requires >1 day lookback. |
| **Enabled by default** | Auto-prune silently deletes data without operator opt-in. |
| **Constructor injection** | Adding `LoggingService` to `LogConfigController` constructor is a breaking change for tests. |

**Recommendation:** Change defaults to `LOG_AUTO_PRUNE=false` (opt-in) or `LOG_RETENTION_DAYS=7`.

---

## 15. Issue #9: Dangerous Prisma Migration (deletedAt + Index)

### Commit
`f9c6d3c`

### Migration File
`api/prisma/migrations/20260416025138_add_requestlog_perf_indexes/migration.sql`

### Content
```sql
/* Warnings: dropping column deletedAt */
DROP INDEX "ScimResource_endpointId_displayName_key";   -- ⚠️ Already dropped
ALTER TABLE "ScimResource" DROP COLUMN "deletedAt";      -- ⚠️ Already removed conceptually
CREATE INDEX "RequestLog_identifier_idx" ON "RequestLog"("identifier");         -- ✅ Needed
CREATE INDEX "RequestLog_createdAt_method_url_idx" ON ...;                       -- ✅ Needed
```

### Root Cause: Prisma Schema Drift

```mermaid
graph TD
    A["Feb 25: Migration adds deletedAt column"] -->|"20260225123401"| B["Schema has deletedAt ✅"]
    B --> C["Apr 9: commit 4ecda76 removes deletedAt FROM SCHEMA<br/>but NO migration created"]
    C -->|"Schema drift begins"| D["Schema says no deletedAt<br/>DB still has deletedAt column"]
    E["Apr 9: Migration drops displayName unique constraint"] -->|"20260409235323"| F["displayName_key dropped ✅"]
    D --> G["Apr 16: prisma migrate dev runs"]
    F --> G
    G -->|"Detects all drift"| H["Generates migration bundling:<br/>1. DROP INDEX displayName_key (already done)<br/>2. DROP COLUMN deletedAt (no prior migration)<br/>3. CREATE INDEX identifier (new)<br/>4. CREATE INDEX composite (new)"]
    
    style C fill:#ff9999,stroke:#cc0000,stroke-width:2px
    style H fill:#ff9999,stroke:#cc0000,stroke-width:2px
```

**The real bug** was in commit `4ecda76` (April 9) which removed `deletedAt` from `schema.prisma` without creating a corresponding migration. When `prisma migrate dev` was run on April 16 to create the index migration, it detected the drift and bundled all pending schema changes into one migration.

### What Happens When This Migration Runs

| Scenario | Outcome |
|----------|---------|
| **Azure database** (ran all prior migrations, has `deletedAt`, displayName_key already dropped via ALTER TABLE) | ⚠️ `DROP INDEX` may fail (constraint was dropped, not index), `DROP COLUMN` succeeds |
| **Fresh database** (e.g., new Docker `prisma migrate deploy`) | ✅ Works — all ops applied in order |
| **Database that manually removed deletedAt** | ❌ `DROP COLUMN` fails — column doesn't exist |

### Necessity: ❌ DANGEROUS — The `CREATE INDEX` statements are needed. The `DROP INDEX` and `DROP COLUMN` are schema drift artifacts.

**Fix required:** Either:
1. Edit migration SQL to keep only the `CREATE INDEX` statements, or
2. Add `IF EXISTS` guards: `DROP INDEX IF EXISTS`, `ALTER TABLE ... DROP COLUMN IF EXISTS`

---

## 16. Issue #10: Docker Prisma Connection Timeout

### Commit
`f9c6d3c`

### Change
```yaml
# BEFORE:
DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
# AFTER:
DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb?connect_timeout=10&pool_timeout=10
```

### Necessity: ⚠️ MARGINALLY USEFUL
Docker Compose `depends_on: service_healthy` already ensures PostgreSQL is ready. The `docker-entrypoint.sh` runs `prisma migrate deploy` before `node dist/main.js`. These timeouts help with edge cases (PostgreSQL restarts, network hiccups) but are not strictly required.

---

## 17. Issue #11: logFileEnabled Default Inverted

### Commit
`afddae4`

### Root Cause
The `syncEndpointFileLogging()` method in `endpoint.service.ts` had inverted logic:

```typescript
// BEFORE (default: disabled):
if (enabled === true || enabled === 'True' || enabled === 'true') {
  this.scimLogger.enableEndpointFileLogging(endpointId, endpointName);
} else {
  this.scimLogger.disableEndpointFileLogging(endpointId);
}

// AFTER (default: enabled):
if (enabled === false || enabled === 'false' || enabled === 'False' || enabled === '0') {
  this.scimLogger.disableEndpointFileLogging(endpointId);
} else {
  this.scimLogger.enableEndpointFileLogging(endpointId, endpointName);
}
```

### Necessity: ✅ NEEDED
Endpoints should have per-endpoint log files by default for local/dev use. Operators in Docker/Azure can set `logFileEnabled: false`. The flag was documented but the default did not match the intent.

---

## 18. Issue #12: Local Server Startup Failures

### Symptoms (from terminal context)
Multiple terminals show `Exit Code: 1` after running `node dist/main.js` or `node api/dist/main.js` from the repository root.

### Root Cause
The server was launched from `C:\Users\v-prasrane\source\repos\SCIMServer` (root) rather than `C:\Users\v-prasrane\source\repos\SCIMServer\api`. NestJS requires being executed from the project directory where `dist/main.js` and `node_modules` exist.

```powershell
# FAILED (wrong cwd):
cd c:\Users\v-prasrane\source\repos\SCIMServer
node dist/main.js       # dist/ doesn't exist at root level
node api/dist/main.js   # Finds JS but node_modules resolution fails

# CORRECT:
cd c:\Users\v-prasrane\source\repos\SCIMServer\api
node dist/main.js       # Works — correct cwd
```

### Necessity: N/A — This is an operator error, not a code bug.

---

## 19. Change-by-Change Necessity Verdict

### Phase 1 (Apr 13) — Deployed as v0.35.0

| # | Commit | Type | Verdict | Rationale |
|---|--------|------|---------|-----------|
| 1-4 | `ed907f3..0a66f0a` | Docs | ✅ | Schema guide, examples, logging docs |
| 5 | `afddae4` | Feature | ✅ | `logFileEnabled` default fix — correct behavior |
| 6-10 | `d98e0d5..e3f3222` | Docs | ✅ | Stale references, quick start, norms |
| 11-16 | `d2ab09e..3f0dccc` | Docs | ✅ | 17 doc gaps closed (routes, prune, activity) |
| 17 | `27d95d7` | Tests | ✅ | +11 E2E for logging/error handling |
| 18 | `a1d840e` | Docs | ✅ | Freshness sweep |
| 19 | `e4bd0fc` | Release | ✅ | Version bump to v0.35.0 |

### Phase 2 (Apr 15) — v0.36.0

| # | Commit | Type | Verdict | Rationale |
|---|--------|------|---------|-----------|
| 20 | `0a02f55` | Feature | ✅ | 4 real UI bug fixes + 238 new tests (Vitest + Playwright) |

### Phase 3 (Apr 15) — Post-v0.36.0

| # | Commit | Type | Verdict | Rationale |
|---|--------|------|---------|-----------|
| 21 | `851eabb` | Perf | ✅ | Groups N+1 fix — real performance bug |
| 22 | `77e1b96` | Perf | ✅ | Complete count() migration — eliminates all findMany() |
| 23 | `f9c6d3c` | Feature | ⚠️ Mixed | Contains needed (indexes, auto-prune) + dangerous (migration drift) + regression (30s timeout) |
| 24 | `ce17f89` | Fix | ⚠️ | Fixes self-inflicted regression from commit 23 |
| 25 | `18fba72` | Tests | ✅ | +25 auto-prune unit tests |
| 26 | `e1e9bc1` | Docs | ✅ | Doc freshness sweep |

### Summary

```mermaid
pie title Change Necessity Distribution (26 commits)
    "✅ Needed" : 22
    "⚠️ Partially Risky" : 3
    "❌ Not Needed / Dangerous" : 1
```

| Category | Count | Items |
|----------|-------|-------|
| ✅ Needed | 22 | All Phase 1 (19), v0.36.0 (1), N+1 fixes (2) |
| ⚠️ Mixed/Risky | 3 | P1-P3 hardening (migration drift + 30s timeout), timeout fix (reverts own regression), auto-prune (risky defaults) |
| ❌ Dangerous | 1 | Migration `20260416025138` — DROP COLUMN + DROP INDEX for already-handled schema changes |

---

## 20. Recommendations

### Immediate Actions (Before Next Deployment)

1. **Fix the migration** `20260416025138_add_requestlog_perf_indexes/migration.sql`:
   - Remove or guard `DROP INDEX "ScimResource_endpointId_displayName_key"`
   - Remove or guard `ALTER TABLE "ScimResource" DROP COLUMN "deletedAt"`
   - Keep both `CREATE INDEX` statements
   - Safest approach: replace the dangerous lines with `IF EXISTS` variants

2. **Fix the code comment** in [main.ts](../api/src/main.ts#L93): `Default: 30 seconds` → `Default: 120 seconds (Node.js default)`

3. **Change auto-prune defaults**: Either `LOG_AUTO_PRUNE=false` (opt-in) or `LOG_RETENTION_DAYS=7` (reasonable default)

### Before Azure Redeployment

4. **Verify Azure database state**: Check if `deletedAt` column exists and whether the unique constraint vs index distinction matters:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'ScimResource' AND column_name = 'deletedAt';

   SELECT indexname FROM pg_indexes
   WHERE indexname = 'ScimResource_endpointId_displayName_key';
   ```

5. **Test the migration** against a clone of the Azure database before deploying

### Documentation

6. Update CHANGELOG with `operations.system` removal (breaking API change)
7. Document `LOG_AUTO_PRUNE`, `LOG_RETENTION_DAYS`, `LOG_PRUNE_INTERVAL_MS`, `REQUEST_TIMEOUT_MS` env vars in DEPLOYMENT.md

---

## Appendix A: Production Source Files Changed

| File | Phase | Lines | Nature |
|------|-------|-------|--------|
| `endpoint.service.ts` | 1 | +4/−3 | `logFileEnabled` default inversion |
| `endpoint-config.interface.ts` | 1 | +20/0 | LOG_FILE_ENABLED constant |
| `App.tsx` | 2 | +32/−8 | Re-render fix, footer fix |
| `Header.tsx` | 2 | +0/−82 | Remove dead backup code |
| `client.ts` | 2 | +0/−21 | Remove `BackupStats`, `fetchBackupStats()` |
| `StatisticsTab.tsx` | 2 | +8/−6 | Dynamic database type |
| `DatabaseBrowser.tsx` | 2 | +4/0 | `database` type in Statistics interface |
| `database.service.ts` | 2 | +8/0 | Return `database` in statistics response |
| `activity.controller.ts` | 3 | +62/−54 | N+1 → count(), SQL keepalive |
| `main.ts` | 3 | +10/0 | Server timeout configuration |
| `logging.service.ts` | 3 | +72/−1 | Auto-prune timer + config |
| `log-config.controller.ts` | 3 | +40/−1 | Auto-prune API endpoints |
| `schema.prisma` | 3 | +2/0 | Two new indexes |
| `migration.sql` | 3 | +17/0 | ⚠️ Contains dangerous DROP ops |
| `docker-compose.yml` | 3 | +1/−1 | Connection timeout params |

## Appendix B: Test Files Added/Changed

| File | Phase | Tests | Nature |
|------|-------|-------|--------|
| `endpoint.service.spec.ts` | 1 | +99 | logFileEnabled syncing tests |
| 5 E2E specs | 1-2 | +516 | Endpoint profile, log config, endpoint-scoped logs, test gaps |
| `activity.controller.spec.ts` | 3 | +62 | count() migration tests |
| `log-config.controller.spec.ts` | 3 | +53 | Auto-prune API tests |
| `logging-auto-prune.spec.ts` | 3 | +163 | New: auto-prune unit tests |
| `request-timeout.spec.ts` | 3 | +27 | New: timeout config tests |
| 16 web Vitest files | 2 | +152 | Component tests (React) |
| 6 web Playwright files | 2 | +86 | Browser E2E tests |
