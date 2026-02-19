# SCIMServer — Logging, Traceability & Observability Guide

> **Version**: 1.2 · **Date**: February 2026 · **Applies to**: SCIMServer v0.10.0+

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Log Levels](#2-log-levels)
3. [Log Categories](#3-log-categories)
4. [Correlation & Traceability](#4-correlation--traceability)
5. [Configuration](#5-configuration)
6. [Admin Log-Config API](#6-admin-log-config-api)
7. [Structured Log Format](#7-structured-log-format)
8. [Flow Examples](#8-flow-examples)
9. [Ring Buffer & Recent Logs](#9-ring-buffer--recent-logs)
10. [Production vs Development](#10-production-vs-development)
11. [Troubleshooting Playbook](#11-troubleshooting-playbook)
12. [Integration with External Systems](#12-integration-with-external-systems)

---

## 1. Architecture Overview

The logging subsystem is built on four pillars:

| Component | File | Purpose |
|-----------|------|---------|
| **LogLevel / LogCategory** | `log-levels.ts` | Enum definitions, env-var parsing, config interface |
| **ScimLogger** | `scim-logger.service.ts` | Singleton structured logger with AsyncLocalStorage correlation, ring buffer, level filtering, secret redaction |
| **RequestLoggingInterceptor** | `request-logging.interceptor.ts` | NestJS global interceptor — generates/propagates `X-Request-Id`, wraps every request in a correlation context |
| **LogConfigController** | `log-config.controller.ts` | REST admin API for runtime log management (8 endpoints) |

### Architecture Diagram

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                   Incoming HTTP Request                      │
                    │  Headers: Authorization, Content-Type, X-Request-Id (opt.)  │
                    └──────────────────────────┬──────────────────────────────────┘
                                               │
                                               ▼
                    ┌──────────────────────────────────────────────────────────────┐
                    │              RequestLoggingInterceptor                        │
                    │                                                              │
                    │  1. Extract / generate X-Request-Id (UUID)                   │
                    │  2. Set X-Request-Id response header                         │
                    │  3. Create CorrelationContext {                               │
                    │       requestId, method, path, endpointId, startTime         │
                    │     }                                                        │
                    │  4. scimLogger.runWithContext(ctx, pipeline)                  │
                    │  5. INFO → "→ GET /scim/endpoints/{ep}/Users"               │
                    │  6. TRACE → request body (if present)                        │
                    └──────────────────────────┬──────────────────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────────────┐
                    │     AsyncLocalStorage     │      (per-request context)       │
                    │   ┌─────────────────┐     │                                  │
                    │   │ CorrelationCtx   │     │                                  │
                    │   │  requestId       │     │                                  │
                    │   │  method          │◄────┘                                  │
                    │   │  path            │                                        │
                    │   │  endpointId      │                                        │
                    │   │  startTime       │                                        │
                    │   └─────────────────┘                                        │
                    └──────────────────────────┬──────────────────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────────────┐
                    │          Guards → Controllers → Services                     │
                    │                                                              │
                    │  SharedSecretGuard    → scimLogger.debug(AUTH, ...)           │
                    │  ScimUsersService     → scimLogger.info(SCIM_USER, ...)       │
                    │  ScimGroupsService    → scimLogger.info(SCIM_GROUP, ...)      │
                    │  ScimExceptionFilter  → scimLogger.error(HTTP, ...)           │
                    │  OAuthService         → scimLogger.info(OAUTH, ...)           │
                    │  BackupService        → scimLogger.info(BACKUP, ...)          │
                    └──────────────────────────┬──────────────────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────────────┐
                    │               ScimLogger (Singleton)                         │
                    │                                                              │
                    │  ┌──────────────────────────────────────────────────────┐    │
                    │  │ isEnabled(level, category)?                           │    │
                    │  │   endpointLevels[epId] → categoryLevels[cat] → global│    │
                    │  └──────────────────────────────────────────────────────┘    │
                    │                     │                                        │
                    │           ┌─────────┴─────────┐                             │
                    │           ▼                     ▼                             │
                    │     Ring Buffer (500)      Console Output                    │
                    │     (admin /recent)      JSON│Pretty mode                   │
                    └─────────────────────────────────────────────────────────────┘
```

### Data Flow Diagram (Mermaid)

```mermaid
sequenceDiagram
    participant Client
    participant Interceptor as RequestLoggingInterceptor
    participant ALS as AsyncLocalStorage
    participant Guard as SharedSecretGuard
    participant Controller
    participant Service
    participant Logger as ScimLogger
    participant Buffer as Ring Buffer
    participant Console as stdout/stderr

    Client->>+Interceptor: HTTP Request (+ optional X-Request-Id)
    Interceptor->>ALS: runWithContext({requestId, method, path, endpointId, startTime})
    Interceptor->>Logger: info(HTTP, "→ GET /Users")
    Logger->>Logger: isEnabled(INFO, HTTP)?
    Logger->>Buffer: push(entry)
    Logger->>Console: emit(entry)
    Interceptor->>Guard: proceed
    Guard->>Logger: debug(AUTH, "Token validated")
    Guard->>Controller: proceed
    Controller->>Service: handle()
    Service->>Logger: info(SCIM_USER, "User created", {userId})
    Service-->>Controller: result
    Controller-->>Interceptor: response
    Interceptor->>Logger: info(HTTP, "← 201 POST /Users", {durationMs})
    Interceptor-->>-Client: HTTP Response + X-Request-Id header
```

---

## 2. Log Levels

Levels follow **RFC 5424 / OpenTelemetry severity** conventions, ordered by ascending severity:

| Level | Numeric | Console | Use Cases |
|-------|---------|---------|-----------|
| **TRACE** | 0 | `stdout` | Full request/response bodies, SQL queries, PATCH path resolution steps, filter parse trees |
| **DEBUG** | 1 | `stdout` | Operational detail: filter parsing, member resolution, config reads, auth token validation |
| **INFO** | 2 | `stdout` | Business events: user created, group patched, endpoint activated, backup completed |
| **WARN** | 3 | `stderr` | Recoverable anomalies: deprecated header, slow query (>2s), backup retry, unknown category |
| **ERROR** | 4 | `stderr` | Failed operations: auth failure, uniqueness violation, DB error, PATCH conflict |
| **FATAL** | 5 | `stderr` | Unrecoverable: DB connection lost, required secret not configured |
| **OFF** | 6 | — | Suppress all log output |

### Level Filtering — 3-Tier Cascade

When a log statement is emitted, `ScimLogger.isEnabled()` checks three tiers in order:

```
1. Endpoint override  →  config.endpointLevels[currentEndpointId]
2. Category override  →  config.categoryLevels[category]
3. Global level       →  config.globalLevel
```

The **first match wins**. If the message level ≥ the configured threshold, the log is emitted.

**Example**: Global = INFO, category `scim.patch` = TRACE, endpoint `ep-abc` = DEBUG
- A TRACE log for `scim.patch` on endpoint `ep-abc` → checks endpoint first → DEBUG → TRACE < DEBUG → **suppressed**
- A TRACE log for `scim.patch` on a *different* endpoint → checks category → TRACE → TRACE ≥ TRACE → **emitted**

---

## 3. Log Categories

Each log statement belongs to a functional category for targeted filtering:

| Category | Enum Value | Description |
|----------|------------|-------------|
| `http` | `LogCategory.HTTP` | HTTP request/response lifecycle, slow request warnings |
| `auth` | `LogCategory.AUTH` | Authentication & authorization (guard decisions) |
| `scim.user` | `LogCategory.SCIM_USER` | SCIM User CRUD operations |
| `scim.group` | `LogCategory.SCIM_GROUP` | SCIM Group CRUD operations |
| `scim.patch` | `LogCategory.SCIM_PATCH` | SCIM PATCH operation details (ops, paths, values) |
| `scim.filter` | `LogCategory.SCIM_FILTER` | SCIM filter parsing & evaluation |
| `scim.discovery` | `LogCategory.SCIM_DISCOVERY` | ServiceProviderConfig, ResourceTypes, Schemas |
| `endpoint` | `LogCategory.ENDPOINT` | Endpoint management (create, activate, deactivate) |
| `database` | `LogCategory.DATABASE` | Database / Prisma operations |
| `backup` | `LogCategory.BACKUP` | Backup & restore operations |
| `oauth` | `LogCategory.OAUTH` | OAuth token issuance and validation |
| `general` | `LogCategory.GENERAL` | Uncategorized / general-purpose |

---

## 4. Correlation & Traceability

### X-Request-Id Header

Every HTTP request is assigned a **correlation ID** that flows through every log entry, error response, and response header.

```
Request flow:
  Client  ────────────────────────►  SCIMServer  ───────────────────────►  Client
  X-Request-Id: (optional)           Generates UUID if missing              X-Request-Id: abc12345-...
```

| Behavior | Detail |
|----------|--------|
| **Propagation** | If the client sends `X-Request-Id`, the server reuses it. Otherwise, a UUID v4 is generated. |
| **Response header** | `X-Request-Id` is always set on the HTTP response. |
| **Log correlation** | Every `StructuredLogEntry` within that request includes `requestId`. |
| **Cross-service** | Forward `X-Request-Id` when calling downstream APIs for distributed tracing. |
| **Ring buffer query** | Filter recent logs by `?requestId=<value>` to see all entries for one request. |

### CorrelationContext Shape

```typescript
interface CorrelationContext {
  requestId: string;      // UUID — from X-Request-Id or auto-generated
  method?: string;        // e.g. "POST"
  path?: string;          // e.g. "/scim/endpoints/ep-123/Users"
  endpointId?: string;    // e.g. "ep-123" — extracted from URL
  authType?: string;      // "oauth" | "legacy" | "public"
  clientId?: string;      // OAuth client_id if authenticated
  startTime?: number;     // Date.now() at request start (for duration calc)
}
```

### How It Works (AsyncLocalStorage)

```typescript
// In RequestLoggingInterceptor.intercept():
const requestId = (request.headers['x-request-id'] as string) || randomUUID();
response.setHeader('X-Request-Id', requestId);

this.scimLogger.runWithContext(
  { requestId, method: request.method, path: request.originalUrl, endpointId, startTime: Date.now() },
  () => {
    // All code inside this closure — guards, controllers, services —
    // automatically inherit the correlation context.
    // scimLogger.info(...) will include requestId in every log entry.
  }
);
```

---

## 5. Configuration

### Environment Variables

| Variable | Default (dev) | Default (prod) | Description |
|----------|--------------|----------------|-------------|
| `LOG_LEVEL` | `DEBUG` | `INFO` | Global minimum log level |
| `LOG_FORMAT` | `pretty` | `json` | Output format: `pretty` (human-readable) or `json` (structured) |
| `LOG_INCLUDE_PAYLOADS` | `true` | `false` | Include request/response bodies at TRACE/DEBUG |
| `LOG_INCLUDE_STACKS` | `true` | `true` | Include stack traces in ERROR/FATAL output |
| `LOG_MAX_PAYLOAD_SIZE` | `8192` | `8192` | Max payload bytes to log (larger bodies are truncated) |
| `LOG_CATEGORY_LEVELS` | *(empty)* | *(empty)* | Per-category overrides, e.g. `scim.patch=TRACE,auth=WARN` |

### .env Example

```env
# Logging configuration
LOG_LEVEL=DEBUG
LOG_FORMAT=pretty
LOG_INCLUDE_PAYLOADS=true
LOG_INCLUDE_STACKS=true
LOG_MAX_PAYLOAD_SIZE=4096
LOG_CATEGORY_LEVELS=scim.patch=TRACE,oauth=WARN
```

### Runtime Configuration via API

All configuration can be changed at runtime without server restart — see [Admin Log-Config API](#6-admin-log-config-api).

---

## 6. Admin Log-Config API

**Base path**: `/scim/admin/log-config`

All endpoints require authentication (Bearer token).

### 6.1 GET /scim/admin/log-config — Get Current Configuration

**Request:**
```http
GET /scim/admin/log-config HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
```

**curl:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config | jq
```

**Response (200 OK):**
```json
{
  "globalLevel": "DEBUG",
  "categoryLevels": {
    "scim.patch": "TRACE",
    "oauth": "WARN"
  },
  "endpointLevels": {},
  "includePayloads": true,
  "includeStackTraces": true,
  "maxPayloadSizeBytes": 4096,
  "format": "pretty",
  "availableLevels": ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF"],
  "availableCategories": [
    "http", "auth", "scim.user", "scim.group", "scim.patch",
    "scim.filter", "scim.discovery", "endpoint", "database",
    "backup", "oauth", "general"
  ]
}
```

---

### 6.2 PUT /scim/admin/log-config — Update Configuration

Supports partial updates. Only include fields you want to change.

**Request:**
```http
PUT /scim/admin/log-config HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
Content-Type: application/json

{
  "globalLevel": "INFO",
  "includePayloads": false,
  "format": "json",
  "categoryLevels": {
    "scim.patch": "DEBUG",
    "auth": "WARN"
  }
}
```

**curl:**
```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"globalLevel":"INFO","includePayloads":false,"format":"json","categoryLevels":{"scim.patch":"DEBUG","auth":"WARN"}}' \
  http://localhost:6000/scim/admin/log-config | jq
```

**Response (200 OK):**
```json
{
  "message": "Log configuration updated",
  "config": {
    "globalLevel": "INFO",
    "categoryLevels": {
      "scim.patch": "DEBUG",
      "auth": "WARN"
    },
    "endpointLevels": {},
    "includePayloads": false,
    "includeStackTraces": true,
    "maxPayloadSizeBytes": 4096,
    "format": "json",
    "availableLevels": ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF"],
    "availableCategories": ["http", "auth", "scim.user", "scim.group", "scim.patch", "scim.filter", "scim.discovery", "endpoint", "database", "backup", "oauth", "general"]
  }
}
```

---

### 6.3 PUT /scim/admin/log-config/level/:level — Quick Global Level Change

**Request:**
```http
PUT /scim/admin/log-config/level/TRACE HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
```

**curl:**
```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/level/TRACE | jq
```

**Response (200 OK):**
```json
{
  "message": "Global log level set to TRACE",
  "globalLevel": "TRACE"
}
```

---

### 6.4 PUT /scim/admin/log-config/category/:category/:level — Set Category Level

**Request:**
```http
PUT /scim/admin/log-config/category/scim.patch/TRACE HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
```

**curl:**
```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/category/scim.patch/TRACE | jq
```

**Response (200 OK):**
```json
{
  "message": "Category 'scim.patch' log level set to TRACE"
}
```

**Error Response (unknown category):**
```json
{
  "error": "Unknown category 'invalid'",
  "availableCategories": [
    "http", "auth", "scim.user", "scim.group", "scim.patch",
    "scim.filter", "scim.discovery", "endpoint", "database",
    "backup", "oauth", "general"
  ]
}
```

---

### 6.5 PUT /scim/admin/log-config/endpoint/:endpointId/:level — Set Endpoint Level

**Request:**
```http
PUT /scim/admin/log-config/endpoint/ep-abc123/TRACE HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
```

**curl:**
```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/endpoint/ep-abc123/TRACE | jq
```

**Response (200 OK):**
```json
{
  "message": "Endpoint 'ep-abc123' log level set to TRACE"
}
```

---

### 6.6 DELETE /scim/admin/log-config/endpoint/:endpointId — Remove Endpoint Override

**Request:**
```http
DELETE /scim/admin/log-config/endpoint/ep-abc123 HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
```

**curl:**
```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/endpoint/ep-abc123
```

**Response: 204 No Content** (empty body)

---

### 6.7 Per-Endpoint Log Level via Endpoint Config (Alternative)

In addition to the dedicated log-config endpoints (6.5/6.6), you can set per-endpoint log levels directly in the endpoint's `config` object when creating or updating an endpoint via the admin CRUD API. This is often more convenient because the log level is stored alongside other endpoint behavior flags and persists across server restarts.

**Create endpoint with logLevel:**
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "debug-endpoint",
    "config": {
      "logLevel": "DEBUG",
      "VerbosePatchSupported": "True"
    }
  }' \
  http://localhost:6000/scim/admin/endpoints | jq
```

**Update endpoint logLevel:**
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config": {"logLevel": "TRACE"}}' \
  http://localhost:6000/scim/admin/endpoints/<endpointId> | jq
```

**Remove endpoint logLevel** (omit `logLevel` from config):
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config": {"strictMode": true}}' \
  http://localhost:6000/scim/admin/endpoints/<endpointId> | jq
```

**Behavior notes:**
- Valid values: `"TRACE"`, `"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"`, `"FATAL"`, `"OFF"` (case-insensitive), or numeric `0`-`6`.
- When `logLevel` is set in endpoint config, it is automatically synced to `ScimLogger.setEndpointLevel()`.
- When `logLevel` is removed from config (or config is replaced without it), the endpoint-level override is cleared.
- On server startup, all persisted endpoint log levels are automatically restored from the database.
- The dedicated log-config API (6.5/6.6) still works and takes effect immediately, but is not persisted across restarts. Endpoint config log levels are persisted.
- Both approaches write to the same `ScimLogger.endpointLevels` map — the last write wins.

---

### 6.8 GET /scim/admin/log-config/recent — Query Recent Logs

Retrieves entries from the in-memory ring buffer (last 500 entries).

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Max entries to return |
| `level` | string | — | Minimum severity filter (e.g. `WARN`) |
| `category` | string | — | Filter by category (e.g. `scim.patch`) |
| `requestId` | string | — | Filter by correlation ID |
| `endpointId` | string | — | Filter by SCIM endpoint |

**Request:**
```http
GET /scim/admin/log-config/recent?limit=10&level=WARN&category=http HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
```

**curl:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?limit=10&level=WARN" | jq
```

**Response (200 OK):**
```json
{
  "count": 2,
  "entries": [
    {
      "timestamp": "2026-02-14T10:23:45.123Z",
      "level": "WARN",
      "category": "http",
      "message": "Slow request: 2345ms",
      "requestId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "endpointId": "ep-abc123",
      "method": "GET",
      "path": "/scim/endpoints/ep-abc123/Users",
      "durationMs": 2345,
      "data": {
        "status": 200,
        "durationMs": 2345
      }
    },
    {
      "timestamp": "2026-02-14T10:24:12.456Z",
      "level": "ERROR",
      "category": "http",
      "message": "← 409 POST /scim/endpoints/ep-abc123/Users",
      "requestId": "f1e2d3c4-b5a6-9870-fedc-ba9876543210",
      "endpointId": "ep-abc123",
      "method": "POST",
      "path": "/scim/endpoints/ep-abc123/Users",
      "durationMs": 45,
      "error": {
        "message": "A resource with userName \"alice@example.com\" already exists.",
        "name": "HttpException"
      },
      "data": {
        "status": 409,
        "durationMs": 45
      }
    }
  ]
}
```

**Filter by Request ID:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?requestId=a1b2c3d4-e5f6-7890-abcd-1234567890ab" | jq
```

---

### 6.9 DELETE /scim/admin/log-config/recent — Clear Ring Buffer

**Request:**
```http
DELETE /scim/admin/log-config/recent HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
```

**curl:**
```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/recent
```

**Response: 204 No Content** (empty body)

---

### 6.10 GET /scim/admin/log-config/stream — Live Log Tailing (SSE)

> **New in v0.10.0** — Real-time Server-Sent Events log stream.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | string | Minimum log level: TRACE, DEBUG, INFO, WARN, ERROR, FATAL |
| `category` | string | Filter by category: http, auth, scim.user, scim.group, etc. |
| `endpointId` | string | Filter by SCIM endpoint ID |

**curl:**
```bash
# Tail all logs (requires -N to disable buffering)
curl -N http://localhost:6000/scim/admin/log-config/stream

# Tail only WARN+ logs
curl -N "http://localhost:6000/scim/admin/log-config/stream?level=WARN"

# Tail specific category
curl -N "http://localhost:6000/scim/admin/log-config/stream?category=scim.patch"

# Tail with authentication
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/stream?level=INFO"
```

**Response (SSE format):**
```
event: connected
data: {"message":"Log stream connected","filters":{"level":"ALL","category":"ALL","endpointId":"ALL"}}

data: {"timestamp":"2026-02-18T14:30:00.123Z","level":"INFO","category":"http","message":"→ POST /scim/v2/Users","requestId":"a1b2c3d4-..."}

: ping 2026-02-18T14:30:30.000Z
```

**Notes:**
- Server sends keep-alive `: ping` comments every 30 seconds
- `X-Accel-Buffering: no` header disables NGINX proxy buffering
- Browser EventSource API auto-reconnects on disconnect
- Maximum 50 concurrent SSE subscribers (configurable via EventEmitter maxListeners)

---

### 6.11 GET /scim/admin/log-config/download — Download Log File

> **New in v0.10.0** — Download ring buffer contents as a file.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | `ndjson` | Output format: `ndjson` or `json` |
| `limit` | number | all | Max entries (up to 500) |
| `level` | string | all | Minimum level filter |
| `category` | string | all | Category filter |
| `requestId` | string | — | Filter by X-Request-Id |
| `endpointId` | string | — | Filter by endpoint ID |

**curl:**
```bash
# Download as NDJSON (default)
curl -o scim-logs.ndjson http://localhost:6000/scim/admin/log-config/download

# Download as JSON array
curl -o scim-logs.json "http://localhost:6000/scim/admin/log-config/download?format=json"

# Download only ERROR+ entries
curl -o errors.ndjson "http://localhost:6000/scim/admin/log-config/download?level=ERROR"

# Download logs for a specific request
curl -o trace.ndjson \
  "http://localhost:6000/scim/admin/log-config/download?requestId=a1b2c3d4-..."
```

**Response Headers:**
```
Content-Type: application/x-ndjson
Content-Disposition: attachment; filename="scimserver-logs-2026-02-18T14-30-00.ndjson"
```

---

### API Summary Table

| Method | Endpoint | Status | Description |
|--------|----------|--------|-------------|
| `GET` | `/scim/admin/log-config` | 200 | Get current config + available levels/categories |
| `PUT` | `/scim/admin/log-config` | 200 | Partial update of config |
| `PUT` | `/scim/admin/log-config/level/:level` | 200 | Quick global level change |
| `PUT` | `/scim/admin/log-config/category/:category/:level` | 200 | Set category level override |
| `PUT` | `/scim/admin/log-config/endpoint/:endpointId/:level` | 200 | Set endpoint level override |
| `DELETE` | `/scim/admin/log-config/endpoint/:endpointId` | 204 | Remove endpoint override |
| `GET` | `/scim/admin/log-config/recent` | 200 | Query in-memory ring buffer |
| `DELETE` | `/scim/admin/log-config/recent` | 204 | Clear ring buffer |
| `GET` | `/scim/admin/log-config/stream` | SSE | **Live log tailing (Server-Sent Events)** |
| `GET` | `/scim/admin/log-config/download` | 200 | **Download logs as NDJSON or JSON file** |

> **Tip:** Per-endpoint log levels can also be set via the `logLevel` field in endpoint config
> (`POST/PATCH /scim/admin/endpoints/:id`). Config-based levels persist across restarts.
> See §6.7 for details.

> **See also:** [Remote Debugging & Diagnosis Guide](REMOTE_DEBUGGING_AND_DIAGNOSIS.md) for
> comprehensive troubleshooting workflows, Azure Container Apps access methods, and the
> `scripts/remote-logs.ps1` PowerShell script for remote log management.

---

## 7. Structured Log Format

### JSON Format (Production)

Each log entry is emitted as a single JSON line to `stdout` (TRACE–INFO) or `stderr` (WARN–FATAL):

```json
{
  "timestamp": "2026-02-14T10:23:45.123Z",
  "level": "INFO",
  "category": "scim.user",
  "message": "User created",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "endpointId": "ep-abc123",
  "method": "POST",
  "path": "/scim/endpoints/ep-abc123/Users",
  "durationMs": 23,
  "data": {
    "userId": "usr-789xyz",
    "userName": "alice@example.com"
  }
}
```

### Pretty Format (Development)

```
10:23:45.123 INFO  scim.user      [a1b2c3d4] ep:ep-abc1 POST /scim/endpoints/ep-abc123/Users +23ms User created | {"userId":"usr-789xyz","userName":"alice@example.com"}
```

Format breakdown:
```
HH:mm:ss.SSS LEVEL category       [reqId8ch] ep:epId8ch METHOD path +duration message | {compact data}
```

Color coding in TTY terminals:
- TRACE → gray
- DEBUG → cyan
- INFO → green
- WARN → yellow
- ERROR → red
- FATAL → magenta

### Error Entries

```json
{
  "timestamp": "2026-02-14T10:24:12.456Z",
  "level": "ERROR",
  "category": "http",
  "message": "← 409 POST /scim/endpoints/ep-abc123/Users",
  "requestId": "f1e2d3c4-b5a6-9870-fedc-ba9876543210",
  "endpointId": "ep-abc123",
  "method": "POST",
  "path": "/scim/endpoints/ep-abc123/Users",
  "durationMs": 45,
  "error": {
    "message": "A resource with userName \"alice@example.com\" already exists.",
    "name": "HttpException",
    "stack": "HttpException: ...\n    at ScimUsersService.create ..."
  },
  "data": {
    "status": 409,
    "durationMs": 45
  }
}
```

### Secret Redaction

Fields matching `/secret|password|token|authorization|bearer|jwt/i` are automatically replaced with `[REDACTED]`:

```json
{
  "level": "DEBUG",
  "category": "auth",
  "message": "Token validated",
  "data": {
    "clientId": "scimserver-client",
    "authorization": "[REDACTED]",
    "token": "[REDACTED]"
  }
}
```

### Payload Truncation

Bodies exceeding `maxPayloadSizeBytes` (default 8KB) are truncated:

```json
{
  "data": {
    "body": "{\"schemas\":[\"urn:ietf:params:scim:schemas...[truncated 12340B]"
  }
}
```

---

## 8. Flow Examples

### 8.1 Create User — Full Trace

**Request:**
```http
POST /scim/endpoints/ep-abc123/Users HTTP/1.1
Host: localhost:6000
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/scim+json
X-Request-Id: req-001-user-create

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "alice@example.com",
  "name": { "givenName": "Alice", "familyName": "Example" },
  "emails": [{ "value": "alice@example.com", "type": "work", "primary": true }],
  "active": true
}
```

**Log Output (pretty mode, LOG_LEVEL=TRACE):**
```
10:23:45.100 INFO  http           [req-001-] ep:ep-abc1 POST /scim/endpoints/ep-abc123/Users User request → POST /scim/endpoints/ep-abc123/Users
10:23:45.101 TRACE http           [req-001-]   Request body
  {
    "body": {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "userName": "alice@example.com",
      "name": { "givenName": "Alice", "familyName": "Example" },
      "emails": [{ "value": "alice@example.com", "type": "work", "primary": true }],
      "active": true
    }
  }
10:23:45.102 DEBUG auth           [req-001-] Token validated | {"clientId":"scimserver-client","authType":"oauth"}
10:23:45.115 INFO  scim.user      [req-001-] ep:ep-abc1 +15ms User created | {"userId":"usr-789xyz","userName":"alice@example.com"}
10:23:45.116 TRACE http           [req-001-]   Response body
  {
    "body": {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "usr-789xyz",
      "userName": "alice@example.com",
      ...
    }
  }
10:23:45.117 INFO  http           [req-001-] ep:ep-abc1 POST /scim/endpoints/ep-abc123/Users +17ms ← 201 POST /scim/endpoints/ep-abc123/Users
```

**Response:**
```http
HTTP/1.1 201 Created
Content-Type: application/scim+json; charset=utf-8
X-Request-Id: req-001-user-create
ETag: W/"1"
```

---

### 8.2 PATCH User — Complex Operation

**Request:**
```http
PATCH /scim/endpoints/ep-abc123/Users/usr-789xyz HTTP/1.1
Host: localhost:6000
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "emails[type eq \"work\"].value", "value": "newalice@example.com" },
    { "op": "add", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Engineering" }
  ]
}
```

**Log Output (pretty mode, scim.patch=TRACE):**
```
10:25:00.050 INFO  http           [auto-uuid] ep:ep-abc1 PATCH /scim/endpoints/ep-abc123/Users/usr-789xyz → PATCH
10:25:00.051 TRACE scim.patch     [auto-uuid] Processing PATCH operations
  {
    "operationCount": 2,
    "operations": [
      { "op": "replace", "path": "emails[type eq \"work\"].value" },
      { "op": "add", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department" }
    ]
  }
10:25:00.060 DEBUG scim.patch     [auto-uuid] Op 1: replace emails[type eq "work"].value → "newalice@example.com"
10:25:00.065 DEBUG scim.patch     [auto-uuid] Op 2: add enterprise:department → "Engineering"
10:25:00.075 INFO  scim.user      [auto-uuid] ep:ep-abc1 +25ms User patched | {"userId":"usr-789xyz","patchedFields":["emails","enterprise:department"]}
10:25:00.076 INFO  http           [auto-uuid] ep:ep-abc1 PATCH /scim/endpoints/ep-abc123/Users/usr-789xyz +26ms ← 200
```

---

### 8.3 Authentication Failure

**Request:**
```http
GET /scim/endpoints/ep-abc123/Users HTTP/1.1
Host: localhost:6000
Authorization: Bearer invalid-token-here
```

**Log Output:**
```
10:30:00.100 INFO  http           [auto-uuid] GET /scim/endpoints/ep-abc123/Users → GET
10:30:00.102 ERROR auth           [auto-uuid] Authentication failed | {"reason":"Invalid token"}
10:30:00.103 ERROR http           [auto-uuid] ← 401 GET /scim/endpoints/ep-abc123/Users +3ms
```

---

### 8.4 Group Membership — Add Members

**Request:**
```http
PATCH /scim/endpoints/ep-abc123/Groups/grp-456 HTTP/1.1
Host: localhost:6000
Authorization: Bearer <token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        { "value": "usr-001", "display": "Alice" },
        { "value": "usr-002", "display": "Bob" }
      ]
    }
  ]
}
```

**Log Output:**
```
10:35:00.100 INFO  http           [auto-uuid] ep:ep-abc1 PATCH /scim/endpoints/ep-abc123/Groups/grp-456 → PATCH
10:35:00.110 DEBUG scim.patch     [auto-uuid] Processing group membership PATCH | {"op":"add","path":"members","memberCount":2}
10:35:00.130 INFO  scim.group     [auto-uuid] ep:ep-abc1 +30ms Group members updated | {"groupId":"grp-456","addedMembers":2,"totalMembers":5}
10:35:00.131 INFO  http           [auto-uuid] ep:ep-abc1 ← 200 PATCH /scim/endpoints/ep-abc123/Groups/grp-456 +31ms
```

---

### 8.5 OAuth Token Issuance

**Request:**
```http
POST /scim/oauth/token HTTP/1.1
Host: localhost:6000
Content-Type: application/json

{
  "grant_type": "client_credentials",
  "client_id": "scimserver-client",
  "client_secret": "my-secret"
}
```

**Log Output:**
```
10:40:00.050 INFO  http           [auto-uuid] POST /scim/oauth/token → POST
10:40:00.060 INFO  oauth          [auto-uuid] Token issued | {"clientId":"scimserver-client","expiresIn":3600}
10:40:00.061 INFO  http           [auto-uuid] ← 201 POST /scim/oauth/token +11ms
```

---

### 8.6 Backup Operation

**Log Output (cron-triggered, no HTTP request):**
```
10:45:00.000 INFO  backup         Backup started | {"type":"scheduled","retention":20}
10:45:02.500 INFO  backup         Backup completed | {"sizeBytes":245760,"durationMs":2500,"destination":"azure-blob"}
```

---

### 8.7 Slow Request Warning

When any request exceeds 2 seconds:

```
10:50:00.000 INFO  http           [auto-uuid] GET /scim/endpoints/ep-big/Users → GET
10:50:03.200 WARN  http           [auto-uuid] Slow request: 3200ms | {"status":200,"durationMs":3200}
10:50:03.201 INFO  http           [auto-uuid] ← 200 GET /scim/endpoints/ep-big/Users +3201ms
```

---

## 9. Ring Buffer & Recent Logs

The ring buffer stores the most recent **500 log entries** in memory. This provides a lightweight debugging tool accessible via the admin API without requiring external log infrastructure.

### Characteristics

| Property | Value |
|----------|-------|
| Max entries | 500 (configurable in source) |
| Eviction | FIFO — oldest entry is removed when buffer is full |
| Persistence | In-memory only — cleared on server restart |
| Access | `GET /scim/admin/log-config/recent` |
| Clear | `DELETE /scim/admin/log-config/recent` |

### Common Query Patterns

```bash
# All recent errors
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?level=ERROR" | jq

# Trace a specific request
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?requestId=a1b2c3d4-e5f6-7890-abcd-1234567890ab" | jq

# SCIM PATCH debug entries for a specific endpoint
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?category=scim.patch&endpointId=ep-abc123" | jq

# Last 5 entries
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?limit=5" | jq
```

---

## 10. Production vs Development

### Development Configuration

```env
LOG_LEVEL=DEBUG
LOG_FORMAT=pretty
LOG_INCLUDE_PAYLOADS=true
LOG_INCLUDE_STACKS=true
LOG_MAX_PAYLOAD_SIZE=8192
```

- Colorized terminal output with human-readable timestamps
- Full request/response bodies at TRACE level
- Stack traces on errors
- Ring buffer accessible for quick debugging

### Production Configuration

```env
NODE_ENV=production
LOG_LEVEL=INFO
LOG_FORMAT=json
LOG_INCLUDE_PAYLOADS=false
LOG_INCLUDE_STACKS=true
LOG_MAX_PAYLOAD_SIZE=4096
```

- JSON structured output (one line per entry) for log aggregation
- No request/response bodies (security + performance)
- Errors include stack traces
- Compatible with: Azure Monitor, ELK Stack, Datadog, Splunk, CloudWatch

### Dynamic Level Escalation

In production, temporarily increase verbosity for debugging:

```bash
# Enable TRACE for a specific problematic endpoint
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  http://prod-server/scim/admin/log-config/endpoint/ep-problem/TRACE

# Debug for 5 minutes, then revert
sleep 300
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://prod-server/scim/admin/log-config/endpoint/ep-problem
```

---

## 11. Troubleshooting Playbook

### "Why is my PATCH failing?"

```bash
# 1. Enable TRACE for scim.patch
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/category/scim.patch/TRACE

# 2. Reproduce the failing PATCH
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"replace","path":"invalidPath","value":"test"}]}' \
  http://localhost:6000/scim/endpoints/ep-123/Users/usr-456

# 3. Query recent logs for that request
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?category=scim.patch&limit=20" | jq

# 4. Reset category level
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/category/scim.patch/INFO
```

### "Why is authentication failing?"

```bash
# Enable DEBUG for auth
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  http://localhost:6000/scim/admin/log-config/category/auth/DEBUG

# Query auth errors
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?category=auth&level=ERROR" | jq
```

### "Which requests are slow?"

```bash
# Query WARN-level HTTP logs (slow request warnings trigger at >2s)
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?category=http&level=WARN" | jq '.entries[] | {path, durationMs, timestamp}'
```

### "What happened for request X?"

```bash
# Get the X-Request-Id from the response header, then:
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:6000/scim/admin/log-config/recent?requestId=a1b2c3d4-e5f6-7890-abcd-1234567890ab" | jq
```

---

## 12. Integration with External Systems

### Azure Container Apps — Remote Log Access

When deployed to Azure Container Apps, all `stdout` / `stderr` output from the NestJS application is automatically captured by the platform. Logs are accessible remotely from any machine with `az login` authenticated.

#### Real-time Streaming

```powershell
# Live tail — application console output (like docker logs -f)
az containerapp logs show `
    --name scimserver-app `
    --resource-group scimserver-rg `
    --type console `
    --follow

# System logs — platform events (restarts, crashes, scaling, image pulls)
az containerapp logs show `
    --name scimserver-app `
    --resource-group scimserver-rg `
    --type system `
    --follow

# Recent 100 lines (without live follow)
az containerapp logs show `
    --name scimserver-app `
    --resource-group scimserver-rg `
    --type console `
    --tail 100
```

#### Log Analytics Queries (KQL — 30-day retention)

```powershell
# Get workspace ID
$wsId = az containerapp env show `
    --name scimserver-env `
    --resource-group scimserver-rg `
    --query "properties.appLogsConfiguration.logAnalyticsConfiguration.customerId" -o tsv

# Last hour of app logs
az monitor log-analytics query -w $wsId `
    --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(1h) | order by TimeGenerated desc | take 200" `
    -o table

# Errors only (last 24h)
az monitor log-analytics query -w $wsId `
    --analytics-query "ContainerAppConsoleLogs_CL | where Log_s contains 'ERROR' | where TimeGenerated > ago(24h) | order by TimeGenerated desc" `
    -o table

# System events — container restarts, image pulls, scaling
az monitor log-analytics query -w $wsId `
    --analytics-query "ContainerAppSystemLogs_CL | where TimeGenerated > ago(24h) | order by TimeGenerated desc | take 100" `
    -o table

# Count errors per hour (last 12h)
az monitor log-analytics query -w $wsId `
    --analytics-query "ContainerAppConsoleLogs_CL | where Log_s contains 'ERROR' | where TimeGenerated > ago(12h) | summarize count() by bin(TimeGenerated, 1h) | order by TimeGenerated desc" `
    -o table
```

#### Azure Portal (GUI)

| Section | Path |
|---------|------|
| **Log stream** | Container Apps → scimserver-app → Log stream (real-time) |
| **Logs** | Container Apps → scimserver-app → Logs (KQL query editor) |
| **Metrics** | Container Apps → scimserver-app → Metrics (CPU, memory, requests) |
| **Revisions** | Container Apps → scimserver-app → Revisions (health per deployment) |

#### Application-Level Logs via REST API

These endpoints are available from any HTTP client — no Azure CLI required:

```powershell
$url = "https://<fqdn>"
$h = @{ Authorization = "Bearer <secret>" }

# Paginated request logs (stored in SQLite)
Invoke-RestMethod "$url/scim/admin/logs?pageSize=50" -Headers $h

# In-memory ring buffer (last ~200 structured entries)
Invoke-RestMethod "$url/scim/admin/log-config/recent" -Headers $h

# Current log levels
Invoke-RestMethod "$url/scim/admin/log-config" -Headers $h

# Change global log level at runtime (no restart)
Invoke-RestMethod "$url/scim/admin/log-config/level/DEBUG" -Method PUT -Headers $h

# Set category-level override
Invoke-RestMethod "$url/scim/admin/log-config/category/scim/TRACE" -Method PUT -Headers $h
```

> **Tip**: Set `LOG_FORMAT=json` in the container env vars for structured JSON output that integrates best with Log Analytics queries and external log aggregators.

### Azure Monitor / Application Insights

With `LOG_FORMAT=json`, stdout/stderr output is JSON-structured and automatically ingested by Azure Container Apps logging:

```bash
# View logs via Azure CLI
az containerapp logs show --name scimserver --resource-group rg-scim \
  --type console --follow
```

### ELK Stack (Elasticsearch, Logstash, Kibana)

JSON log lines are directly compatible with Filebeat / Logstash ingestion. Useful Kibana queries:

```
# All errors for an endpoint
level: "ERROR" AND endpointId: "ep-abc123"

# Slow requests
category: "http" AND level: "WARN" AND message: "Slow request*"

# Trace a single request
requestId: "a1b2c3d4-e5f6-7890-abcd-1234567890ab"
```

### Docker Compose Logging

```yaml
services:
  scimserver:
    image: scimserver:latest
    environment:
      - LOG_FORMAT=json
      - LOG_LEVEL=INFO
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

---

## Appendix: StructuredLogEntry Schema

```typescript
interface StructuredLogEntry {
  timestamp: string;                    // ISO-8601
  level: string;                        // TRACE | DEBUG | INFO | WARN | ERROR | FATAL
  category: string;                     // LogCategory enum value
  message: string;                      // Human-readable message
  requestId?: string;                   // Correlation ID (UUID)
  endpointId?: string;                  // SCIM endpoint ID
  method?: string;                      // HTTP method
  path?: string;                        // Request URL path
  durationMs?: number;                  // Elapsed time since request start
  error?: {
    message: string;
    name?: string;
    stack?: string;                     // Included when includeStackTraces=true
  };
  data?: Record<string, unknown>;       // Additional structured data
}
```
