# Logging & Error Handling — Quality Audit

> **Version**: 1.2 · **Date**: April 7, 2026 · **Scope**: Full codebase audit across all flows, configs, deployment modes  
> **Applies to**: SCIMServer v0.32.0 · NestJS + Prisma 7 + PostgreSQL 17  
> **Status**: 22 of 29 gaps resolved (Steps 1-12 + Step A). 7 deferred (P2/P3).  
> **Companion**: [LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md](LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md) — the redesign proposal  
> **See also**: [LOGGING_AND_OBSERVABILITY.md](LOGGING_AND_OBSERVABILITY.md) — current operator-facing documentation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Component-by-Component Analysis](#3-component-by-component-analysis)
4. [Error Handling Patterns](#4-error-handling-patterns)
5. [Console Output & Deployment Access](#5-console-output--deployment-access)
6. [Feature Flag Interaction Matrix](#6-feature-flag-interaction-matrix)
7. [Deployment Mode Divergences](#7-deployment-mode-divergences)
8. [Schema & Profile Impact](#8-schema--profile-impact)
9. [Log Level Usage Audit](#9-log-level-usage-audit)
10. [Error Path Coverage Audit](#10-error-path-coverage-audit)
11. [Layers Without Logging](#11-layers-without-logging)
12. [RCA Scenario Assessment](#12-rca-scenario-assessment)
13. [Consistency Audit](#13-consistency-audit)
14. [Gap Register](#14-gap-register)
15. [Best Practices Comparison](#15-best-practices-comparison)
16. [Ratings Summary](#16-ratings-summary)

---

## 1. Executive Summary

The SCIMServer logging and error handling subsystem has **genuine production-grade strengths** — `AsyncLocalStorage` correlation IDs, runtime-configurable 3-tier log levels, structured JSON output, an in-memory ring buffer, SSE live tailing, and a full 10-endpoint admin API. These enable effective incident response without redeployment.

Systematic analysis across all flows, 13 config flag combinations, 6 schema presets, 2 persistence backends, and 3 deployment modes reveals **20 cross-cutting gaps** rooted in **three fundamental design problems**:

1. **Log entries and error responses share no context** — connecting them requires `X-Request-Id` which the response body doesn't contain
2. **Context is scattered across layers** instead of accumulated — each layer logs its own slice, no layer has the full picture
3. **Error creation is fire-and-forget** — rich context at the throw site is lost by the time the exception filter catches it

### Scorecard

| Perspective | Rating | Key Finding |
|---|---|---|
| Architecture & Design | **8.5/10** | Correlation IDs + 3-tier cascade + admin API = production-grade core |
| RFC 7644 §3.12 Compliance | **9/10** | Error format fully compliant; `scimType` codes used correctly |
| Feature Flag Interaction Safety | **6/10** | Error messages rarely identify the responsible config flag |
| Deployment Mode Parity | **5/10** | InMemory backend produces different error types than Prisma |
| Schema/Profile Awareness | **4/10** | No error or log mentions the active preset or profile |
| Error Log Completeness | **4/10** | Only 6 explicit `logger.error()` calls; most 5xx paths have no service-level error log |
| Quick RCA Ease | **7/10** | Excellent for simple CRUD; poor for bulk, DB errors, flag combos |
| Cross-Cutting Consistency | **6/10** | Two logger systems, inconsistent categories, inconsistent error wrapping |

---

## 2. Architecture Overview

### Logging Subsystem — 4 Pillars

| Component | File | Purpose |
|---|---|---|
| **LogLevel / LogCategory** | `log-levels.ts` | 7 levels (TRACE→OFF, RFC 5424-aligned), 14 categories, env-var parsing |
| **ScimLogger** | `scim-logger.service.ts` | Singleton: `AsyncLocalStorage` correlation, ring buffer (500), level filtering, secret redaction, SSE |
| **RequestLoggingInterceptor** | `request-logging.interceptor.ts` | Global interceptor: `X-Request-Id` propagation, HTTP bookend logs, body capture at TRACE |
| **LogConfigController** | `log-config.controller.ts` | REST admin API: 10 endpoints for runtime log management |

### Error Handling Subsystem — 3 Pillars

| Component | File | Purpose |
|---|---|---|
| **createScimError** | `scim-errors.ts` | Factory → `HttpException` with RFC 7644 §3.12 body |
| **ScimExceptionFilter** | `scim-exception.filter.ts` | Global `@Catch(HttpException)`: SCIM error format, 5xx→ERROR / 4xx→WARN |
| **PatchError** | `patch-error.ts` | Domain exception, converted to `createScimError` by service catch blocks |

### Data Flow

```
Middleware (content-type)          ← ZERO logging
    ↓
RequestLoggingInterceptor          ← Sets AsyncLocalStorage context
    ↓                                 Logs HTTP bookends (INFO)
SharedSecretGuard                  ← Logs auth decisions (TRACE→FATAL)
    ↓
Controller                         ← ZERO logging (10 controllers, 0 log statements)
    ↓
Service                            ← Logs business events (INFO/WARN/ERROR)
    ↓
Repository                         ← ZERO logging (4+ implementations, 0 log statements)
    ↓
ScimExceptionFilter               ← Logs errors (5xx→ERROR, 4xx→WARN)
    ↓
LoggingService                    ← DB persistence (fire-and-forget batch)
```

### Level Filtering — 3-Tier Cascade

```
1. Endpoint override  →  config.endpointLevels[endpointId]
2. Category override  →  config.categoryLevels[category]
3. Global level       →  config.globalLevel
```

---

## 3. Component-by-Component Analysis

### 3.1 ScimLogger

**Strengths**: Correlation context, ring buffer (500 FIFO), SSE streaming, secret redaction (`/secret|password|token|authorization|bearer|jwt/i`), payload truncation (8KB), dual format (JSON/pretty with ANSI colors).

**stdout/stderr split**: TRACE/DEBUG/INFO → stdout; WARN/ERROR/FATAL → stderr (JSON mode uses `process.stdout/stderr.write()`; pretty mode uses `console.*`).

**Gap**: Ring buffer size (500) is hardcoded. Slow request threshold (2000ms) is hardcoded.

### 3.2 RequestLoggingInterceptor

**Logs**: INFO→ request in/out, TRACE → bodies, WARN → slow requests, ERROR → on exception.

**DB persistence**: `void this.loggingService.recordRequest(...)` — fire-and-forget.

**Gap**: `loggingService.recordRequest` failure silently dropped.

### 3.3 ScimExceptionFilter

**Catches**: `@Catch(HttpException)` only — **does NOT catch raw `Error`, `TypeError`, `PrismaClientKnownRequestError`**.

**5xx** → `logger.error(HTTP, ...)` with exception + status. **4xx** → `logger.warn(HTTP, ...)` with detail.

### 3.4 LoggingService (DB Persistence)

**Logger**: NestJS `Logger` (NOT ScimLogger) — entries invisible to ring buffer, SSE, admin API.

**Batching**: 3s / 50 entries → `createMany`. Flush failure → `logger.error(...)` but batch permanently lost.

**InMemory**: `inMemoryLogRows[]` — unbounded, no eviction. Memory leak under load.

### 3.5 SharedSecretGuard

**Best-logged component**: Every auth decision has a log (TRACE→FATAL) with `LogCategory.AUTH`. Per-endpoint credential, OAuth JWT, legacy token — each step logged with context.

### 3.6 EndpointScimUsersService

**Logs**: `ScimLogger` with `SCIM_USER`/`SCIM_PATCH`. INFO for CRUD start/complete, WARN for readOnly stripping.

**Gap**: **Zero database error wrapping** — `userRepo.create/update/delete` have no try/catch. Raw errors propagate as unstructured 500s.

### 3.7 EndpointScimGroupsService

**Same as Users** plus: `groupRepo.updateGroupWithMembers()` wrapped in try/catch → `logger.error(SCIM_PATCH/SCIM_GROUP)` → `createScimError(500)`.

**Gap**: `groupRepo.create()` is NOT wrapped — inconsistent.

### 3.8 EndpointScimGenericService

**Logs**: `ScimLogger` with `LogCategory.GENERAL` for everything — no dedicated category. Dead code: `logger2 = new Logger(...)` unused. 5+ silent `JSON.parse` catches defaulting to `{}`.

### 3.9 BulkProcessorService

**ZERO logging.** No logger injected. No log statements. No per-operation correlation.

### 3.10 Other Components Using NestJS Logger (not ScimLogger)

| Component | Logger | Impact |
|---|---|---|
| `EndpointService` | `new Logger(EndpointService.name)` | Cache warm/fail invisible to admin API |
| `PrismaService` | `new Logger(PrismaService.name)` | DB connection status invisible to admin API |
| `AdminCredentialController` | `new Logger(...)` | Credential create/revoke invisible to admin API |
| `ScimSchemaRegistry` | `new Logger(...)` | Preset expansion failures invisible to admin API |

---

## 4. Error Handling Patterns

### 4.1 Error Creation Inventory

| Pattern | Count | SCIM Response? | Example Location |
|---|---|---|---|
| `createScimError()` → `HttpException` | ~50+ | **Yes** | All SCIM services + helpers |
| `new HttpException(manualBody)` | 1 | Yes (manual) | Content-type middleware |
| `new UnauthorizedException(scimBody)` | 1 | Yes | SharedSecretGuard.reject() |
| `new BadRequestException(msg)` | ~8 | **Partial** (NestJS format) | EndpointService CRUD |
| `new NotFoundException(msg)` | ~6 | **Partial** (NestJS format) | EndpointService admin |
| `throw new Error(msg)` | 3 | **No** — non-SCIM 500 | InMemory repos (update miss) |
| Re-throw raw (non-PatchError) | 3 | **No** — untyped 500 | Users/Groups/Generic PATCH |
| `throw new Error()` at startup | 2 | N/A (process crash) | OAuthModule, OAuthService |

### 4.2 Silent Catch Inventory (9 sites)

| Location | What's Caught | Consequence |
|---|---|---|
| `scim-service-helpers.ts` → `parseJson()` | JSON syntax error | Returns `{}` silently |
| `endpoint-scim-generic.service.ts` → `toScimResponse()` ×2 | `JSON.parse` | Returns `{}` silently |
| `endpoint-scim-generic.service.ts` → `validateFilterAttributePaths()` | Filter parse | Returns early silently |
| `scim-service-helpers.ts` → `validateFilterPaths()` | Filter parse | Returns early silently |
| `logging.service.ts` → identifier backfill | Raw SQL | Lost silently |
| `logging.service.ts` → `resolveUserDisplayName()` ×2 | DB query | Returns `null` |
| `logging.service.ts` → `normalizeObject()` | `JSON.parse` | Returns `undefined` |

### 4.3 Error Detail Quality

| Error Source | Detail Quality | Mentions Config Flag? | Mentions Preset? |
|---|---|---|---|
| `enforceStrictSchemaValidation()` | Lists registered extensions | **Partially** ("When StrictSchemaValidation is enabled") | No |
| `validatePayloadSchema()` | Attribute path + type | **No** | No |
| `checkImmutableAttributes()` | Old/new values | **No** | No |
| `enforceIfMatch()` | Expected vs current ETag | **No** | No |
| `guardSoftDeleted()` | "not found" (intentionally vague per RFC) | N/A | No |
| `assertSchemaUniqueness()` | Attribute path + value | No | No |
| Bulk `buildErrorResult()` | Passes through inner error | No | No |

---

## 5. Console Output & Deployment Access

### Three Output Channels (Interleaved)

| Channel | Mechanism | Format | When |
|---|---|---|---|
| NestJS bootstrap | `Logger.log/warn()` in `main.ts` + NestJS internals | `[Nest] PID - timestamp LOG [Context] message` | Startup |
| NestJS Logger instances | `new Logger(Class).log()` in 5 infrastructure files | Same NestJS format | Startup + runtime |
| ScimLogger | `process.stdout/stderr.write` (JSON) or `console.*` (pretty) | Structured JSON or colorized | Runtime requests |
| Raw `console.warn` | `console.warn()` in PrismaService constructor, OAuthModule | Unstructured plain text | Pre-DI startup |

**Problem**: Mixed formats at startup — JSON log parsers choke on NestJS-formatted lines.

### Access by Deployment

| Method | Local Dev | Docker | Azure | InMemory |
|---|---|---|---|---|
| Terminal stdout | Direct | `docker logs -f` | `az containerapp logs --follow` | Same |
| Ring buffer API | `curl localhost:6000` | `curl localhost:8080` | `curl https://fqdn` + auth | Same (500 entries) |
| SSE stream | `curl -N localhost` | Same | Same | Same |
| Download API | `curl -o file` | Same | Same | Same |
| DB request logs | Requires PostgreSQL | Via PostgreSQL | Via PostgreSQL | In-memory (unbounded) |
| Docker log files | N/A | `/var/lib/docker/...` | N/A | Same |
| Azure Log Analytics | N/A | N/A | KQL (30-day, 5-min delay) | Same |
| **Log file on disk** | **Not available** | **Not available** | **Not available** | — |

**No log rotation in docker-compose.yml** — default `json-file` driver grows unbounded.

---

## 6. Feature Flag Interaction Matrix

### StrictSchemaValidation × Other Flags

| StrictSchema | + Flag | Behavior | Logged? | Flag in Error? |
|---|---|---|---|---|
| OFF | any | No validation — malformed data stored | No | N/A |
| ON | body has unregistered URN | 400/invalidSyntax | No service log | **Partially** |
| ON | type mismatch | 400/invalidValue | No service log | **No** |
| ON | + `AllowAndCoerceBooleanStrings=True` | Coerced silently | **No log** | No |
| ON | + `AllowAndCoerceBooleanStrings=False` | 400/invalidValue | No service log | **No** |
| ON | PATCH readOnly attr | 400 hard reject | No service log | **No** |
| ON | + `IgnoreReadOnlyAttributesInPatch=True` | Strip + WARN | WARN | No |
| ON | immutability violation | 400/mutability | No service log | **No** |

### SoftDeleteEnabled × ReprovisionOnConflict

| SoftDelete | Reprovision | POST Duplicate | Log |
|---|---|---|---|
| OFF | any | 409/uniqueness | WARN (filter) |
| ON | OFF | 409 (even soft-deleted) | WARN |
| ON | ON + soft-deleted | 201 re-provision | **INFO** |
| ON | ON + active | 409 | WARN |

**guardSoftDeleted()** logs at **DEBUG only** → invisible in production (default INFO).

### RequireIfMatch × ETag

| RequireIfMatch | If-Match | Result | Any Log? |
|---|---|---|---|
| OFF | absent | Proceeds | **No** |
| ON | absent | 428 | **No service log** |
| ON | mismatch | 412/versionMismatch | **No service log** |

---

## 7. Deployment Mode Divergences

### Prisma vs InMemory Backend

| Aspect | Prisma | InMemory | RCA Impact |
|---|---|---|---|
| `repo.update()` miss | `PrismaClientKnownRequestError` (P2025) | `throw new Error()` — not `HttpException` | Non-SCIM 500 in InMemory |
| `repo.delete()` miss | Prisma throws P2025 | **Silently no-ops** | Divergent behavior |
| Unique constraints | PostgreSQL enforced | **Not enforced** at DB level | Race conditions in InMemory |
| Transactions | `$transaction` for groups | **None** | Partial updates in InMemory |
| Log persistence | `RequestLog` table (batched) | `inMemoryLogRows[]` — **unbounded** | Memory leak |

### Development vs Production

| Aspect | Development | Production |
|---|---|---|
| Log format | `pretty` (colorized) | `json` (structured) |
| Default level | DEBUG | INFO |
| `guardSoftDeleted()` | Visible (DEBUG) | **Invisible** (below INFO) |
| Auth secret | Auto-generated + WARN | FATAL if not configured |

---

## 8. Schema & Profile Impact

| Preset | Extensions | Error Surface Impact |
|---|---|---|
| `entra-id` | Enterprise User + Entra custom | Full extension validation when strict=ON |
| `minimal` | None | No extension validation possible |
| `user-only` | Enterprise User | No Groups — group ops error |
| `lexmark` | Lexmark custom | Custom attribute paths |

**Gap**: Error messages from `validatePayloadSchema` include attribute paths but do **not mention the active preset name**. Operator must separately `GET /admin/endpoints/:id`.

Generic resource types use `LogCategory.GENERAL` — invisible to `SCIM_USER`/`SCIM_GROUP` filters.

---

## 9. Log Level Usage Audit

### Current Level Distribution

| Level | Call Sites | Production Visible? | Problems |
|---|---|---|---|
| TRACE | 8 | No | Used only for payload dumps + 1 misclassified decision |
| DEBUG | 25 | No | Mixes normal operations and negative lookups |
| INFO | 50+ | **Yes** | **Too noisy** — 4 entries per request (HTTP in → creating → created → HTTP out) |
| WARN | 24 | **Yes** | Conflates routine 4xx client errors with operational concerns |
| ERROR | 6 | **Yes** | **Severely underused** — most 5xx paths have no service-level ERROR log |
| FATAL | 1 | **Yes** | Only secret not configured; DB failures, OOM not covered |

### INFO Noise Problem

One POST /Users produces **4 INFO entries** at production level:
```
INFO  http       → POST /Users                    ← interceptor
INFO  scim.user  Creating user                    ← service (intent)
INFO  scim.user  User created                     ← service (result)
INFO  http       ← 201 POST /Users +23ms          ← interceptor
```

At 100 req/s → 400 INFO lines/s. HTTP bookends and intent logs are redundant.

### Missing Event Types Not Logged at Any Level

| Event Type | Current Coverage | Impact |
|---|---|---|
| **Audit** (who changed what) | No combined auth+action entries | Can't answer "who deleted user X" |
| **Config changes** | Log level, endpoint CRUD, credential CRUD — **none logged** | No ops audit trail |
| **Validation success** | Only failures logged | Can't confirm "validation ran and passed" |
| **Performance/timing** | Only slow >2s | No DB query timing, PATCH engine timing |
| **Connectivity/health** | None | DB reconnection, pool exhaustion invisible |
| **Data integrity** | Silent catches | Corrupt payloads invisible |

---

## 10. Error Path Coverage Audit

### Every Error Path — Does It Produce an ERROR Log?

| Error Source | Service ERROR Log? | Interceptor ERROR? | SCIM Body? | Correct Status? |
|---|---|---|---|---|
| `createScimError(4xx)` | **No** | No (WARN) | Yes | Yes |
| `createScimError(5xx)` | **Only in Groups** | Yes (filter) | Yes | Yes |
| Prisma connection timeout | **No** | Yes (raw) | **No** | 500 generic |
| Prisma P2025 (not found) | **No** | Yes (raw) | **No** | 500 (should be 404) |
| Prisma P2002 (unique) | **No** | Yes (raw) | **No** | 500 (should be 409) |
| InMemory `new Error()` | **No** | Yes (raw) | **No** | 500 (wrong) |
| PatchEngine TypeError | **No** | Yes (raw) | **No** | 500 generic |
| `BadRequestException` | **No** | Yes (filter) | Partial | 400 |
| OOM/segfault | **No** | **No** | **No** | Process dies |

**Only 6 explicit `logger.error()` calls exist in production code** (2 in Groups service, 1 in exception filter, 1 in interceptor, 2 in LoggingService). Every other 5xx relies on the exception filter's generic catch.

### The `@Catch(HttpException)` Gap

`ScimExceptionFilter` only catches `HttpException`. All other error types (`Error`, `TypeError`, `PrismaClientKnownRequestError`) fall to NestJS's built-in handler which produces:
```json
{ "statusCode": 500, "message": "Internal Server Error" }
```
— NOT SCIM-compliant (no `schemas`, no `scimType`, `status` as number, wrong Content-Type).

---

## 11. Layers Without Logging

| Layer | Files | Log Statements |
|---|---|---|
| **All SCIM Controllers** | 10 files | **0** |
| **All Repositories** | 4+ files (prisma + inmemory) | **0** |
| **All Domain Logic** | PatchEngines, SchemaValidator | **0** |
| **All Middleware** | Content-type validation | **0** |
| **BulkProcessor** | 1 file | **0** |
| **Log Config Controller** | 1 file (config changes not logged!) | **0** |
| **Validation Helpers** | 6+ methods in scim-service-helpers | **0** |

---

## 12. RCA Scenario Assessment

| Scenario | Rating | Key Obstacle |
|---|---|---|
| POST /Users fails with 409 | **9/10** | Correlation ID + detail = fast |
| PATCH silently stores flat keys | **6/10** | Must separately check VerbosePatchSupported flag |
| DB connection timeout on POST | **4/10** | No service ERROR log, raw Prisma error |
| Bulk request with 30 ops, #17 fails | **3/10** | Zero bulk logging, no per-op index |
| Auth failure for specific endpoint | **9/10** | Best-logged flow — every step logged |
| Soft-delete 404 vs real 404 | **5/10** | `guardSoftDeleted` at DEBUG — invisible in production |
| Schema validation error — which preset? | **5/10** | No preset name in error or log |
| Who changed log level to TRACE? | **0/10** | Config changes not logged at all |

---

## 13. Consistency Audit

### 13.1 Logger System Split

| Component | Logger | Ring Buffer? | SSE? | Categories? |
|---|---|---|---|---|
| Services, Guard, Interceptor | `ScimLogger` | Yes | Yes | Yes |
| LoggingService, EndpointService, PrismaService, AdminCredential, SchemaRegistry | **NestJS Logger** | **No** | **No** | **No** |

### 13.2 WARN Data Shapes

| Service | readOnly Strip Context | Keys |
|---|---|---|
| Users | `{ method, path, stripped, endpointId }` | 4 keys |
| Groups | `{ attributes: strippedAttrs }` | 1 key — different shape |

### 13.3 Operation Completion Logging

| Operation | Users | Groups | Consistent? |
|---|---|---|---|
| POST | Intent + completion | Intent + completion | ✓ |
| PATCH | Intent + completion | Intent + completion | ✓ |
| PUT | Intent only — **no completion** | Intent only — **no completion** | ✓ (consistently missing) |
| DELETE | Intent + completion | Intent + completion | ✓ |

### 13.4 DB Error Wrapping

| Service | `repo.create` | `repo.update` | Transaction |
|---|---|---|---|
| Users | **No** | **No** | N/A |
| Groups | **No** | **No** | **Yes** (PATCH/PUT only) |
| Generic | **No** | **No** | **No** |

---

## 14. Gap Register

| # | Gap | Severity | Status | Resolution |
|---|---|---|---|---|
| **G1** | InMemory repos throw raw `Error` → non-SCIM 500 | **Critical** | ✅ Resolved | Step 2: RepositoryError domain boundary |
| **G2** | InMemory `delete()` silently no-ops | **High** | ✅ Resolved | Step 2: RepositoryError with NOT_FOUND on delete |
| **G3** | BulkProcessor zero logging | **High** | ✅ Resolved | Step 8: SCIM_BULK category + start/complete/error logs |
| **G4** | Generic service uses `GENERAL` category | **High** | ✅ Resolved | Step 8: Replaced with SCIM_RESOURCE |
| **G5** | `guardSoftDeleted` invisible in production | **High** | ✅ Resolved | Step 6: Enriched context carries activeFlags |
| **G6** | Users service no DB error wrapping | **High** | ✅ Resolved | Step 3: handleRepositoryError in all services |
| **G7** | `ScimExceptionFilter` only catches `HttpException` | **High** | ✅ Resolved | Step 1: GlobalExceptionFilter @Catch() |
| **G8** | Only 6 `logger.error()` calls | **High** | ✅ Resolved | Step 3: ERROR before every 5xx throw |
| **G9** | Config changes not logged | **High** | ✅ Resolved | Step 10: Admin audit trail (8 INFO entries) |
| **G10** | LoggingService flush drops data | **Medium** | ⏳ Deferred | P2: Needs retry/circuit breaker design |
| **G11** | Two logger systems | **Medium** | ✅ Resolved | Step 5: All NestJS Logger → ScimLogger |
| **G12** | Error details don't mention config flag | **Medium** | ✅ Resolved | Step 4: diagnostics.triggeredBy |
| **G13** | No endpoint context in errors | **Medium** | ✅ Resolved | Step 4: diagnostics.endpointId + logsUrl |
| **G14** | Silent JSON.parse catches | **Medium** | ✅ Resolved | Step 7: WARN/DEBUG at 5+ catch sites |
| **G15** | InMemory log store unbounded | **Medium** | ⏳ Deferred | P2: Dev/test only; needs eviction policy |
| **G16** | InMemory no transaction parity | **Medium** | ✅ Resolved | Step 2: RepositoryError consistent errors |
| **G17** | HTTP bookends too noisy at INFO | **Medium** | ✅ Resolved | Step 9: Demoted to DEBUG |
| **G18** | PUT no completion log | **Low** | ✅ Resolved | Step 9: Added 'User/Group replaced' INFO |
| **G19** | Invalid category returns 200 | **Low** | ✅ Resolved | Step 12: Returns 400 HttpException |
| **G20** | Content-type middleware manual HttpException | **Low** | ✅ Resolved | Step 12: Uses createScimError() |
| **G21** | 4xx conflated with WARN | **Low** | ✅ Resolved | Step 9: 404→DEBUG, 400/409→INFO, 401/403→WARN |
| **G22** | Ring buffer/slow threshold hardcoded | **Low** | ✅ Resolved | Step 12: LOG_RING_BUFFER_SIZE, LOG_SLOW_REQUEST_MS |
| **G23** | No log file on disk | **Low** | ⏳ Deferred | P3: stdout-only correct per 12-factor |
| **G24** | Docker no log rotation | **Low** | ✅ Resolved | Step 12: max-size 10m, max-file 3 |
| **G25** | PII in TRACE payloads | **Medium** | ⏳ Deferred | P2: TRACE off in prod; needs GDPR analysis |
| **G26** | No metrics/counters | **Medium** | ⏳ Deferred | P2: Separate Prometheus/OTEL workstream |
| **G27** | No health check depth | **Medium** | ⏳ Deferred | P2: Needs DB/memory/pool probes |
| **G28** | Multi-instance ring buffer | **Medium** | ⏳ Deferred | P3: Single-instance today |
| **G29** | Per-endpoint creds access all logs | **High** | ✅ Resolved | Step 11: Endpoint-scoped log endpoints |

---

## 15. Best Practices Comparison

| Practice | Status | Notes |
|---|---|---|
| Structured logging (JSON) | ✅ | JSON-per-line, all major aggregators |
| Correlation IDs | ✅ | `AsyncLocalStorage`, `X-Request-Id` |
| Secret redaction | ✅ | Regex-based field matching |
| Runtime log level changes | ✅ | REST API, no restart |
| Per-endpoint log level | ✅ | 3-tier cascade |
| Real-time tailing | ✅ | SSE with keepalive |
| Log download/export | ✅ | NDJSON/JSON file endpoint |
| Slow request detection | ✅ | >2s WARN (hardcoded) |
| Error catch-all filter | ❌ | Only `HttpException` caught |
| Service-level ERROR logs | ❌ | Only 6 calls; most 5xx unlogged |
| Admin audit trail | ❌ | Config changes not logged |
| Metrics / counters | ❌ | No request rates, error rates, latency |
| Health check depth | ❌ | Shallow `{"status":"ok"}` only |
| PII handling policy | ❌ | TRACE bodies contain PII |
| Distributed tracing (OTEL) | ❌ | No spans, no trace propagation |
| Log sampling / rate limiting | ❌ | No sampling at volume |
| Alerting thresholds | ❌ | No proactive detection |

---

## 16. Ratings Summary

| Perspective | Rating | Rationale |
|---|---|---|
| Architecture & Design | **8.5/10** | Strong core — correlation, cascade, admin API |
| RFC 7644 Compliance | **9/10** | Error bodies fully compliant when `createScimError` is used |
| Error Log Completeness | **4/10** | Only 6 `logger.error()` calls; no catch-all filter; most 5xx unlogged |
| Feature Flag Interactions | **6/10** | Errors rarely name the responsible flag |
| Deployment Mode Parity | **5/10** | InMemory produces different errors, no transactions |
| Schema/Profile Awareness | **4/10** | No preset name in errors or logs |
| Quick RCA Ease | **7/10** | Excellent for CRUD; poor for bulk, DB, config changes |
| Cross-Cutting Consistency | **6/10** | Two loggers, inconsistent categories, shapes, wrapping |

### Top 5 Strengths

1. **Correlation IDs** — single ID traces entire request across all layers
2. **Runtime log level control** — per-endpoint, per-category, no restart
3. **Ring buffer + SSE + download** — immediate access without external infrastructure
4. **Auth flow logging** — every decision point logged with context
5. **Secret redaction** — safe to share logs without credential leaks

### Top 5 Weaknesses

1. **Error log completeness** — most 5xx paths have no service-level ERROR log; no catch-all filter
2. **BulkProcessor black hole** — zero logging, zero correlation
3. **Two logger systems** — infrastructure errors invisible to admin API
4. **No admin audit trail** — config changes, CRUD, credentials not logged
5. **Info noise** — 4 entries per request; HTTP bookends should be DEBUG

---

*Generated from full source analysis of SCIMServer v0.31.0 — April 6, 2026*
