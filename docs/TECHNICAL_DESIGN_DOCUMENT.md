# Technical Design Document

> **Version:** 0.38.0 - **Updated:** April 24, 2026  
> As-built architecture documentation derived from source code

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Module Structure](#module-structure)
- [Domain Layer](#domain-layer)
- [Infrastructure Layer](#infrastructure-layer)
- [Request Lifecycle](#request-lifecycle)
- [Data Model](#data-model)
- [Multi-Tenant Isolation](#multi-tenant-isolation)
- [Profile Engine](#profile-engine)
- [Schema Validation Engine](#schema-validation-engine)
- [PATCH Engine Architecture](#patch-engine-architecture)
- [Filter & Sort Engine](#filter--sort-engine)
- [Authentication Architecture](#authentication-architecture)
- [Logging Architecture](#logging-architecture)
- [Error Handling Architecture](#error-handling-architecture)
- [Technology Stack](#technology-stack)

---

## System Architecture

```mermaid
flowchart TB
    subgraph Client Layer
        C1[Entra ID]
        C2[SCIM Client]
        C3[Admin UI]
    end

    subgraph NestJS Application
        subgraph Middleware
            MW1[X-Request-Id]
            MW2[Content-Type Validation]
            MW3[AsyncLocalStorage Context]
        end

        subgraph Guards
            G1[SharedSecretGuard<br>3-tier auth chain]
        end

        subgraph Interceptors
            I1[ScimContentType]
            I2[ScimEtag]
            I3[RequestLogging]
        end

        subgraph Controllers [19 Controllers - 83 Routes]
            Admin[Admin + Endpoint + Credential]
            SCIM[Users + Groups + Bulk + Me + Generic]
            Disc[Discovery - Schemas, RT, SPC]
            Log[LogConfig + EndpointLog]
            Other[Database + Activity + Health + OAuth + Web]
        end

        subgraph Services
            ES[EndpointService<br>Cache by id+name]
            US[UsersService]
            GS[GroupsService]
            GenS[GenericService]
            BS[BulkProcessorService]
            DS[DiscoveryService]
        end

        subgraph Domain
            PE[Patch Engines<br>User, Group, Generic]
            SV[SchemaValidator<br>10 validation types]
            AP[AttributeProjection]
            FP[FilterParser + Evaluator]
        end
    end

    subgraph Infrastructure
        subgraph Repositories
            PR[Prisma Repositories]
            IR[InMemory Repositories]
        end
        DB[(PostgreSQL 17<br>5 tables)]
    end

    C1 & C2 --> MW1
    C3 --> MW1
    MW1 --> MW2 --> MW3 --> G1
    G1 --> I1 --> I2 --> I3
    I3 --> Controllers
    Controllers --> Services
    Services --> Domain
    Services --> ES
    Services --> Repositories
    PR --> DB
```

---

## Module Structure

The NestJS application is composed of 11 modules:

```mermaid
flowchart TD
    App[AppModule] --> Config[ConfigModule<br>isGlobal: true]
    App --> Schedule[ScheduleModule<br>Cron jobs]
    App --> Auth[AuthModule<br>SharedSecretGuard]
    App --> Prisma[PrismaModule<br>DB connection]
    App --> Endpoint[EndpointModule<br>CRUD + cache]
    App --> SCIM[ScimModule<br>12 controllers, 7 services]
    App --> Logging[LoggingModule<br>Ring buffer, SSE, files]
    App --> Database[DatabaseModule<br>DB browser]
    App --> Activity[ActivityParserModule]
    App --> OAuth[OAuthModule<br>JWT token service]
    App --> Web[WebModule<br>SPA serving]

    Auth --> OAuth
    Auth --> Endpoint
    SCIM --> Prisma
    SCIM --> Logging
    SCIM --> Endpoint
```

### ScimModule Internals

The largest module registers:

- **12 controllers** (EndpointScimGenericController registered LAST to avoid path shadowing)
- **7 services** (Users, Groups, Generic, Bulk, Discovery, Metadata, SchemaRegistry)
- **2 global filters** (GlobalExceptionFilter, ScimExceptionFilter)
- **2 global interceptors** (ScimContentTypeInterceptor, ScimEtagInterceptor)
- **2 middleware** (EndpointContextStorage on all routes, ContentTypeValidation on endpoint routes)

---

## Domain Layer

Pure business logic with zero NestJS/Prisma dependencies:

```
api/src/domain/
+-- patch/
|   +-- user-patch-engine.ts       # User PATCH logic (454 lines)
|   +-- group-patch-engine.ts      # Group PATCH logic (372 lines)
|   +-- generic-patch-engine.ts    # Custom resource PATCH (shares user engine)
|   +-- patch-types.ts             # PatchOperation, PatchConfig, PatchResult
|   +-- patch-error.ts             # Typed PATCH errors
+-- validation/
|   +-- schema-validator.ts        # 10 validation types (1,664 lines)
|   +-- validation-types.ts        # Validation options and results
+-- models/
|   +-- user.model.ts              # User domain model
|   +-- group.model.ts             # Group domain model
|   +-- generic-resource.model.ts  # Custom resource model
|   +-- endpoint-credential.model.ts
|   +-- endpoint-resource-type.model.ts
+-- repositories/
|   +-- user.repository.interface.ts
|   +-- group.repository.interface.ts
|   +-- generic-resource.repository.interface.ts
|   +-- endpoint-credential.repository.interface.ts
|   +-- repository.tokens.ts       # DI tokens
+-- errors/
    +-- repository-error.ts        # Domain error types
```

### Design Principles

- **Domain isolation**: Patch engines and schema validator have zero framework dependencies
- **Repository pattern**: Interfaces in domain, implementations in infrastructure
- **DI tokens**: NestJS injection tokens defined in `repository.tokens.ts`

---

## Infrastructure Layer

```
api/src/infrastructure/repositories/
+-- repository.module.ts           # Dynamic registration (prisma vs inmemory)
+-- prisma/
|   +-- prisma-user.repository.ts
|   +-- prisma-group.repository.ts
|   +-- prisma-generic-resource.repository.ts
|   +-- prisma-endpoint-credential.repository.ts
|   +-- prisma-error.util.ts       # Prisma error mapping
|   +-- uuid-guard.ts              # UUID format validation
+-- inmemory/
    +-- inmemory-user.repository.ts
    +-- inmemory-group.repository.ts
    +-- inmemory-generic-resource.repository.ts
    +-- prisma-filter-evaluator.ts  # In-memory filter evaluation
```

### Repository Selection

Controlled by `PERSISTENCE_BACKEND` env var:

| Value | Backend | Use Case |
|-------|---------|----------|
| `prisma` | PostgreSQL via Prisma ORM | Production, Docker |
| `inmemory` | In-memory Maps | Unit tests, E2E tests |

---

## Request Lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant MW as Middleware Stack
    participant G as SharedSecretGuard
    participant IC as Interceptors
    participant Ctrl as Controller
    participant Svc as Service
    participant Dom as Domain
    participant Repo as Repository
    participant DB as PostgreSQL

    C->>MW: HTTP Request
    Note over MW: 1. X-Request-Id (UUID)<br>2. /scim/v2/* rewrite<br>3. AsyncLocalStorage context<br>4. Content-Type validation
    MW->>G: Authenticated request
    Note over G: 3-tier auth chain:<br>1. Per-endpoint bcrypt<br>2. OAuth JWT<br>3. Shared secret
    G->>IC: Authorized request
    Note over IC: 1. ScimContentType (response headers)<br>2. ScimEtag (conditional caching)<br>3. RequestLogging (audit trail)
    IC->>Ctrl: Routed request
    Ctrl->>Svc: Business operation
    Note over Svc: 1. Resolve endpoint profile<br>2. Check endpoint active<br>3. Enforce config flags
    Svc->>Dom: Schema validation + PATCH
    Note over Dom: SchemaValidator (10 checks)<br>PatchEngine (pure logic)<br>AttributeProjection
    Svc->>Repo: Data access
    Repo->>DB: SQL via Prisma
    DB-->>Repo: Result
    Repo-->>Svc: Domain model
    Note over Svc: Build response:<br>meta, location, schemas[],<br>projection, never-returned strip
    Svc-->>Ctrl: SCIM resource
    Ctrl-->>C: HTTP Response
```

---

## Data Model

5 tables in PostgreSQL 17 with 3 extensions (`citext`, `pgcrypto`, `pg_trgm`):

```mermaid
erDiagram
    Endpoint ||--o{ ScimResource : "owns"
    Endpoint ||--o{ RequestLog : "logs"
    Endpoint ||--o{ EndpointCredential : "authenticates"
    ScimResource ||--o{ ResourceMember : "group has members"
    ScimResource ||--o{ ResourceMember : "user is member of"

    Endpoint {
        uuid id PK
        string name UK
        string displayName
        string description
        jsonb profile
        boolean active
        timestamp createdAt
        timestamp updatedAt
    }

    ScimResource {
        uuid id PK
        string scimId
        uuid endpointId FK
        string resourceType "User/Group/custom"
        citext userName
        citext displayName
        string externalId
        boolean active
        jsonb payload "Full SCIM resource"
        int version "Auto-increment ETag"
        timestamp deletedAt "Soft delete"
        timestamp createdAt
        timestamp updatedAt
    }

    RequestLog {
        uuid id PK
        uuid endpointId FK
        string method
        string url
        int status
        int durationMs
        text requestHeaders
        text requestBody
        text responseHeaders
        text responseBody
        string identifier
        timestamp createdAt
    }

    EndpointCredential {
        uuid id PK
        uuid endpointId FK
        string credentialType "bearer/oauth_client"
        string label
        string tokenHash "bcrypt"
        boolean active
        jsonb metadata
        timestamp expiresAt
        timestamp createdAt
        timestamp updatedAt
    }

    ResourceMember {
        uuid id PK
        uuid groupId FK "cascade delete"
        uuid memberId FK "set null"
    }
```

### Key Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| ScimResource unique | `[endpointId, scimId]` | SCIM ID uniqueness per endpoint |
| ScimResource unique | `[endpointId, userName]` | userName uniqueness per endpoint |
| RequestLog composite | `[endpointId, createdAt]` | Endpoint-scoped log queries |
| RequestLog composite | `[endpointId, identifier, createdAt]` | Activity feed queries |
| RequestLog composite | `[status, createdAt]` | Error log filtering |

### Polymorphic Storage

`ScimResource` uses a polymorphic pattern with `resourceType` discriminator:

| resourceType | First-Class Columns Used |
|-------------|-------------------------|
| `User` | userName, displayName, externalId, active |
| `Group` | displayName, externalId, active |
| Custom types | displayName, externalId (userName used for custom uniqueness) |

The `payload` JSONB column stores the full SCIM resource representation. First-class columns are extracted for indexing, filtering, and uniqueness enforcement.

---

## Multi-Tenant Isolation

```mermaid
flowchart TD
    subgraph Request Processing
        R[Incoming Request<br>/scim/endpoints/UUID/Users]
        ALS[AsyncLocalStorage<br>EndpointContextStorage]
        EP[EndpointService<br>Cache lookup by UUID]
    end

    R --> ALS
    ALS --> EP
    EP --> |Profile + Config| S[Service Layer]
    S --> |WHERE endpointId = UUID| DB[(Database)]
```

### Isolation Mechanisms

1. **URL-based scoping**: All SCIM operations include `:endpointId` in the URL path
2. **AsyncLocalStorage**: Per-request endpoint context stored in Node.js ALS (zero-overhead thread-local)
3. **Database WHERE clause**: Every repository query includes `endpointId` filter
4. **Composite unique indexes**: userName uniqueness is per-endpoint, not global
5. **Cascade delete**: Deleting an endpoint cascades to all its resources, logs, and credentials
6. **In-memory cache**: EndpointService maintains a Map by ID and by name for fast lookups

---

## Profile Engine

```mermaid
flowchart LR
    subgraph Input
        P1[Preset Name<br>e.g., entra-id]
        P2[Inline Profile<br>shorthand JSON]
    end

    subgraph Processing
        L[Preset Loader<br>6 built-in presets]
        E[Auto-Expand<br>attrs: all -> RFC list]
        T[Tighten-Only<br>Validator]
        C[Schema Cache<br>Builder]
    end

    subgraph Output
        EP[EndpointProfile<br>schemas + RTs + SPC + settings]
    end

    P1 --> L --> E
    P2 --> E
    E --> T --> C --> EP
```

### Components

| Component | File | Responsibility |
|-----------|------|---------------|
| Built-in presets | `built-in-presets.ts` + `presets/*.json` | 6 compiled preset definitions |
| Auto-expand service | `auto-expand.service.ts` | Expand "all", merge partial attrs with RFC baseline |
| Tighten-only validator | `tighten-only-validator.ts` | Reject loosening of attribute characteristics |
| RFC baseline | `rfc-baseline.ts` | Canonical RFC 7643 attribute definitions |
| Endpoint profile service | `endpoint-profile.service.ts` | Orchestrate expansion + validation |

---

## Schema Validation Engine

The `SchemaValidator` (1,664 lines) performs 10 validation types:

```mermaid
flowchart TD
    P[Payload] --> V1[V1: Required Attrs]
    V1 --> V2[V2: Type Checking]
    V2 --> V3[V3: Mutability]
    V3 --> V4[V4: Unknown Attrs]
    V4 --> V5[V5: Multi/Single-Value]
    V5 --> V6[V6: Sub-Attributes]
    V6 --> V7[V7: Canonical Values]
    V7 --> V8[V8: Required Sub-Attrs]
    V8 --> V9[V9: DateTime Format]
    V9 --> V10[V10: schemas array]
    V10 --> R{Valid?}
    R -->|Yes| OK[Process]
    R -->|No| ERR[400 Error]
```

### Validation Contexts

| Context | Required Check | ReadOnly Check | Unknown Attr Check |
|---------|---------------|----------------|-------------------|
| `create` | Yes | Strip | Yes (strict mode) |
| `replace` | Yes | Strip | Yes (strict mode) |
| `patch` (per-op) | No | Reject or strip | No |
| `patch` (post-merge) | Yes | N/A | Yes (strict mode) |

---

## PATCH Engine Architecture

Three pure-domain PATCH engines with shared infrastructure:

```mermaid
flowchart TD
    subgraph Shared
        PP[scim-patch-path.ts<br>Path parsing + operations]
        PT[patch-types.ts<br>Type definitions]
        PE[patch-error.ts<br>Error types]
    end

    subgraph Engines
        UPE[UserPatchEngine<br>454 lines]
        GPE[GroupPatchEngine<br>372 lines]
        GenPE[GenericPatchEngine<br>Uses UserPatchEngine]
    end

    PP --> UPE & GPE & GenPE
    PT --> UPE & GPE & GenPE
    PE --> UPE & GPE & GenPE
```

### Path Types Supported

| Type | Example | Parser |
|------|---------|--------|
| Simple | `displayName` | Direct key lookup |
| ValuePath | `emails[type eq "work"].value` | `parseValuePath()` regex |
| Extension URN | `urn:...:enterprise:2.0:User:dept` | `parseExtensionPath()` |
| Dot-notation | `name.givenName` | Requires `VerbosePatchSupported` flag |
| No-path | `{"op":"replace","value":{...}}` | `resolveNoPathValue()` |

---

## Filter & Sort Engine

### Filter Parser

The `scim-filter-parser.ts` (608 lines) implements a recursive-descent parser for the SCIM filter grammar (RFC 7644 S3.4.2.2):

```
filter     = attrPath SP compareOp SP value
           / attrPath SP "pr"
           / filter SP ("and" / "or") SP filter
           / "not" SP "(" filter ")"
           / "(" filter ")"
           / attrPath "[" valFilter "]"
```

### Filter Evaluation Strategy

```mermaid
flowchart TD
    F[SCIM Filter String] --> P[Parser -> AST]
    P --> E{Pushable to DB?}
    E -->|Yes| PD[Prisma WHERE clause<br>eq, ne, co, sw, ew, gt, ge, lt, le, pr, and, or]
    E -->|No| IM[In-memory evaluation<br>not, valuePath, unmapped attrs]
    PD --> DB[(PostgreSQL)]
    DB --> R[Results]
    IM --> R
```

### Sort Resolution

| SCIM sortBy | User DB Column | Group DB Column |
|-------------|---------------|-----------------|
| `id` | `scimId` | `scimId` |
| `userName` | `userName` | N/A |
| `displayName` | `displayName` | `displayName` |
| `externalId` | `externalId` | `externalId` |
| `active` | `active` | N/A |
| `meta.created` | `createdAt` | `createdAt` |
| `meta.lastModified` | `updatedAt` | `updatedAt` |

Default: `createdAt ascending`

---

## Authentication Architecture

```mermaid
flowchart TD
    R[Request] --> PUB{Public decorator?}
    PUB -->|Yes| ALLOW[Allow]
    PUB -->|No| EP{Endpoint URL?}
    EP -->|Yes| CRED{PerEndpointCredentials?}
    CRED -->|Enabled| BC[bcrypt compare<br>against stored hashes]
    BC -->|Match| ALLOW
    BC -->|No match| JWT
    CRED -->|Disabled| JWT
    EP -->|No| JWT
    JWT{OAuth JWT?} -->|Valid signature + expiry| ALLOW
    JWT -->|Invalid| SS
    SS{Shared Secret?} -->|Match| ALLOW
    SS -->|No match| DENY[401 Unauthorized]
```

### Auth Types Set on Request

| Auth Method | `req.authType` | `/Me` Support |
|-------------|---------------|---------------|
| Per-endpoint credential | `'endpoint'` | No (404) |
| OAuth JWT | `'oauth'` | Yes (sub claim) |
| Shared secret | `'legacy'` | No (404) |

---

## Logging Architecture

### Components

| Component | File | Responsibility |
|-----------|------|---------------|
| ScimLogger | `scim-logger.service.ts` | Central structured logger |
| Ring Buffer | Built into ScimLogger | In-memory circular buffer |
| SSE Emitter | Built into ScimLogger | Live stream via Server-Sent Events |
| File Writer | `rotating-file-writer.ts` | Rotating log file output |
| Request Interceptor | `request-logging.interceptor.ts` | HTTP audit trail to RequestLog table |
| Log Query Service | `log-query.service.ts` | Query ring buffer and DB logs |

### Log Levels

`TRACE` (0) < `DEBUG` (1) < `INFO` (2) < `WARN` (3) < `ERROR` (4) < `FATAL` (5)

### Per-Endpoint Log Isolation

Each endpoint can have:
- Independent log level override via `logLevel` setting
- Dedicated log file under `logs/endpoints/{endpointId}/`
- Filtered SSE stream at `/scim/endpoints/{id}/logs/stream`
- Filtered ring buffer at `/scim/endpoints/{id}/logs/recent`

---

## Error Handling Architecture

Two-layer exception filter chain (NestJS processes in reverse registration order):

```mermaid
flowchart TD
    E[Exception Thrown] --> SF{HttpException?}
    SF -->|Yes| SCIM[ScimExceptionFilter]
    SF -->|No| GF[GlobalExceptionFilter]

    SCIM --> IS{SCIM route?}
    IS -->|Yes| SE[SCIM Error Response<br>schemas, status, scimType, detail]
    IS -->|No| HE[Standard HTTP error]

    GF --> IS2{SCIM route?}
    IS2 -->|Yes| SE2[SCIM 500 Error<br>with Diagnostics extension]
    IS2 -->|No| HE2[NestJS 500 error]
```

### Diagnostics Extension

All SCIM errors are enriched with `urn:scimserver:api:messages:2.0:Diagnostics`:

```json
{
  "requestId": "X-Request-Id correlation UUID",
  "endpointId": "endpoint UUID",
  "logsUrl": "/scim/endpoints/{id}/logs/recent?requestId={rid}"
}
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 24 | JavaScript runtime |
| Framework | NestJS | 11.1 | DI, modules, HTTP, guards |
| Language | TypeScript | 5.9 | Type safety |
| ORM | Prisma | 7.4 | Type-safe database access |
| Database | PostgreSQL | 17 | Primary data store |
| PG Extensions | citext, pgcrypto, pg_trgm | - | Case-insensitive, crypto, trigram |
| Auth | @nestjs/jwt, bcrypt | - | JWT signing, password hashing |
| Validation | class-validator, class-transformer | - | DTO validation |
| Testing | Jest | 30.2 | Unit + E2E testing |
| E2E HTTP | Supertest | 7.2 | HTTP testing |
| Frontend | React, Vite | 19, 7 | Admin UI |
| Container | Docker (node:24-alpine) | - | Production deployment |
| Infrastructure | Azure Bicep | - | Azure Container Apps |
