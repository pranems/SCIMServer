# SCIMServer - Technical Design Document (TDD)

> **Version**: 1.2  
> **Date**: March 1, 2026  
> **Status**: Current as-built architecture  
> **Tech Stack**: NestJS 11 · TypeScript 5 · Prisma 7 · PostgreSQL 17 · React 19 · Vite 7 · Azure Container Apps

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                       Azure Container Apps                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                      Docker Container                     │ │
│  │                                                           │ │
│  │  ┌─────────────┐  ┌─────────────────────────────────────┐ │ │
│  │  │   React SPA  │  │          NestJS Server (port 3000) │ │ │
│  │  │ (pre-built   │  │  ┌──────────────────────────────┐  │ │ │
│  │  │  static in   │  │  │     Express HTTP Layer        │  │ │ │
│  │  │  /public)    │  │  │  CORS · JSON · ValidationPipe │  │ │ │
│  │  │              │  │  ├──────────────────────────────┤  │ │ │
│  │  │   Served via │  │  │     Global Guards             │  │ │ │
│  │  │   Static     │  │  │   SharedSecretGuard (auth)    │  │ │ │
│  │  │   Assets     │  │  ├──────────────────────────────┤  │ │ │
│  │  │              │  │  │     Global Interceptors       │  │ │ │
│  │  │              │  │  │  ScimContentType              │  │ │ │
│  │  │              │  │  │  RequestLogging               │  │ │ │
│  │  │              │  │  ├──────────────────────────────┤  │ │ │
│  │  │              │  │  │        Controllers            │  │ │ │
│  │  │              │  │  │   SCIM · Admin · OAuth · Web  │  │ │ │
│  │  │              │  │  ├──────────────────────────────┤  │ │ │
│  │  │              │  │  │         Services              │  │ │ │
│  │  │              │  │  │  Users · Groups · Endpoint ·  │  │ │ │
│  │  │              │  │  │  Auth · Logging · DB │  │ │ │
│  │  │              │  │  ├──────────────────────────────┤  │ │ │
│  │  │              │  │  │     Prisma ORM + PostgreSQL     │  │ │ │
│  │  └─────────────┘  │  └──────────────────────────────┘  │ │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                          │                                      │
│  ┌───────────────────────▼─────────────────────────────────────┐│

```

### 1.2 Project Directory Structure

```
api/
├── prisma/
│   ├── schema.prisma            # Database schema definition (5 models)
│   └── migrations/              # Prisma migration history
├── public/                      # Pre-built React SPA assets
│   ├── index.html
│   └── assets/
├── src/
│   ├── main.ts                  # Application bootstrap (NestFactory)
│   ├── modules/
│   │   ├── app/
│   │   │   └── app.module.ts    # Root module - imports all feature modules
│   │   ├── scim/
│   │   │   ├── scim.module.ts
│   │   │   ├── controllers/     # SCIM endpoint controllers
│   │   │   ├── services/        # SCIM business logic
│   │   │   ├── dto/             # Request/response DTOs
│   │   │   ├── interceptors/    # ScimContentTypeInterceptor
│   │   │   └── common/          # Constants, types, errors, utilities
│   │   ├── endpoint/            # Endpoint management (admin CRUD)
│   │   ├── auth/                # SharedSecretGuard, @Public decorator
│   │   ├── logging/             # ScimLogger, LogConfigController, RequestLoggingInterceptor, log-levels

│   │   ├── database/            # Dashboard data queries (users/groups/stats)
│   │   ├── activity-parser/     # SCIM log → human-readable activity
│   │   ├── prisma/              # PrismaService (global)
│   │   ├── web/                 # SPA serving controller
│   │   └── admin/               # Admin panel API routes
│   └── oauth/                   # OAuth 2.0 client_credentials module
└── test/                        # Jest suites (unit + e2e coverage; see current matrix)

web/                             # React SPA source (Vite dev server)
├── src/
│   ├── App.tsx
│   └── components/
├── vite.config.ts
└── package.json

infra/                           # Azure IaC (Bicep templates)
scripts/                         # PowerShell deployment scripts
docs/                            # Documentation
```

---

## 2. Module Architecture

### 2.1 NestJS Module Dependency Graph

```
AppModule
├── ConfigModule.forRoot({ isGlobal: true })
├── ScheduleModule.forRoot()
├── PrismaModule (@Global)
│   └── PrismaService → OnModuleInit/OnModuleDestroy, $connect/$disconnect
├── AuthModule
│   └── SharedSecretGuard (APP_GUARD - global)
├── OAuthModule
│   ├── OAuthController → POST /oauth/token, GET /oauth/.well-known
│   └── OAuthService → JWT generation/validation
├── LoggingModule (@Global)
│   ├── RequestLoggingInterceptor (APP_INTERCEPTOR - global, correlation IDs)
│   ├── ScimLogger → Structured leveled logger (AsyncLocalStorage correlation)
│   ├── LogConfigController → /admin/log-config (11 REST endpoints)
│   ├── LogQueryService → Shared query/stream/download logic
│   ├── LoggingService → RequestLog persistence (buffered DB writes)
│   ├── FileLogTransport → Main + per-endpoint log files
│   └── RotatingFileWriter → Size-based file rotation
├── ScimModule
│   ├── EndpointScimUsersController
│   ├── EndpointScimGroupsController
│   ├── ServiceProviderConfigController
│   ├── ResourceTypesController
│   ├── SchemasController
│   ├── EndpointScimUsersService
│   ├── EndpointScimGroupsService
│   ├── ScimMetadataService
│   ├── EndpointContextStorage
│   ├── ScimContentTypeInterceptor (APP_INTERCEPTOR)
│   └── ScimExceptionFilter (APP_FILTER)
├── EndpointModule
│   ├── EndpointController
│   └── EndpointService
├── DatabaseModule
│   └── DatabaseController + DatabaseService
├── ActivityParserModule
│   └── ActivityParserService
└── WebModule
    └── WebController → serves SPA
```

### 2.2 Module Responsibilities

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| **PrismaModule** | Global database access | `PrismaService` - Extended Prisma client with lifecycle |
| **AuthModule** | Authentication | `SharedSecretGuard` (global), `@Public` decorator |
| **OAuthModule** | OAuth 2.0 flows | `OAuthController`, `OAuthService` |
| **ScimModule** | Core SCIM protocol | Controllers, services, interceptors, utilities |
| **EndpointModule** | Multi-endpoint management | `EndpointController`, `EndpointService` |
| **LoggingModule** | Structured logging, traceability, admin config | `ScimLogger` (global), `RequestLoggingInterceptor`, `LogConfigController`, `LogQueryService`, `LoggingService`, `FileLogTransport` |
| **DatabaseModule** | Dashboard data | `DatabaseController`, `DatabaseService` |
| **ActivityParserModule** | Activity feed | `ActivityParserService` (898 lines of parsing) |
| **WebModule** | SPA serving | `WebController` - serves pre-built React app |

---

## 3. Request Lifecycle

### 3.1 Full Request Pipeline

```
Client (Entra ID / Postman / SCIM Client)
  │
  ▼
Express Middleware (main.ts)
  │  ├── Double-slash normalization: // → /
  │  ├── /scim/v2 → /scim rewrite
  │  ├── CORS headers
  │  ├── JSON body parser (5MB, scim+json & json)
  │  └── ValidationPipe (whitelist: false, transform: true)
  │
  ▼
SharedSecretGuard (global APP_GUARD)
  │  ├── Check @Public decorator → bypass if public
  │  ├── Extract Bearer token
  │  ├── Try 1: Per-endpoint bcrypt credential (if PerEndpointCredentialsEnabled)
  │  │   ├── extractEndpointId() from URL regex
  │  │   ├── Load active, non-expired credentials from EndpointCredentialRepository
  │  │   ├── bcrypt.compare(token, hash) for each credential
  │  │   └── Match → set req.authType = 'endpoint_credential', req.authCredentialId
  │  ├── Try 2: OAuthService.validateAccessToken(jwt) → set req.oauth, req.authType = 'oauth'
  │  ├── Try 3: Compare token === SCIM_SHARED_SECRET → set req.authType = 'legacy'
  │  └── Reject: 401 with WWW-Authenticate: Bearer realm="SCIM"
  │
  ▼
RequestLoggingInterceptor (global APP_INTERCEPTOR)
  │  ├── Record start time
  │  ├── Pass to handler
  │  └── Log request+response to RequestLog table (async, fire-and-forget)
  │
  ▼
ScimContentTypeInterceptor (global APP_INTERCEPTOR)
  │  └── After handler: set Content-Type: application/scim+json; charset=utf-8
  │
  ▼
ScimExceptionFilter (global APP_FILTER)
  │  └── On error: set Content-Type: application/scim+json, ensure string "status"
  │
  ▼
Controller Method (route-matched)
  │  ├── @Param('endpointId') extraction
  │  ├── validateEndpoint() → verify endpoint exists & active
  │  ├── EndpointContextStorage.setContext() → AsyncLocalStorage
  │  └── Delegate to service method
  │
  ▼
Service Method
  │  ├── Business logic (SCIM operations)
  │  ├── Prisma queries/mutations
  │  ├── SCIM error creation (createScimError)
  │  └── Return SCIM-formatted response
  │
  ▼
Response (JSON with application/scim+json Content-Type)
```

### 3.2 Endpoint Context Propagation

The `EndpointContextStorage` uses Node.js `AsyncLocalStorage` to propagate per-request endpoint context through the call stack without explicit parameter passing:

```typescript
// Middleware sets context via AsyncLocalStorage
this.endpointContextStorage.setContext({
  endpointId: endpoint.id,
  baseUrl: buildBaseUrl(request),
  profile: endpoint.profile
});

// Any downstream service can read it
const ctx = this.endpointContextStorage.getContext();
const endpointId = ctx?.endpointId;
const config = ctx?.config;
```

---

## 4. API Layer - Route Map

### 4.1 SCIM Protocol Routes

| Method | Route | Controller | Description |
|--------|-------|------------|-------------|
| `POST` | `/scim/endpoints/{endpointId}/Users` | `EndpointScimUsersController` | Create User |
| `GET` | `/scim/endpoints/{endpointId}/Users` | `EndpointScimUsersController` | List/Filter Users |
| `GET` | `/scim/endpoints/{endpointId}/Users/{id}` | `EndpointScimUsersController` | Get User by ID |
| `PUT` | `/scim/endpoints/{endpointId}/Users/{id}` | `EndpointScimUsersController` | Replace User |
| `PATCH` | `/scim/endpoints/{endpointId}/Users/{id}` | `EndpointScimUsersController` | Partial Update User |
| `DELETE` | `/scim/endpoints/{endpointId}/Users/{id}` | `EndpointScimUsersController` | Delete User |
| `POST` | `/scim/endpoints/{endpointId}/Groups` | `EndpointScimGroupsController` | Create Group |
| `GET` | `/scim/endpoints/{endpointId}/Groups` | `EndpointScimGroupsController` | List/Filter Groups |
| `GET` | `/scim/endpoints/{endpointId}/Groups/{id}` | `EndpointScimGroupsController` | Get Group by ID |
| `PUT` | `/scim/endpoints/{endpointId}/Groups/{id}` | `EndpointScimGroupsController` | Replace Group |
| `PATCH` | `/scim/endpoints/{endpointId}/Groups/{id}` | `EndpointScimGroupsController` | Partial Update Group |
| `DELETE` | `/scim/endpoints/{endpointId}/Groups/{id}` | `EndpointScimGroupsController` | Delete Group |

### 4.2 SCIM Discovery Routes

| Method | Route | Controller | Description |
|--------|-------|------------|-------------|
| `GET` | `/scim/endpoints/{endpointId}/Schemas` | `EndpointScimDiscoveryController` | List Schemas |
| `GET` | `/scim/endpoints/{endpointId}/ResourceTypes` | `EndpointScimDiscoveryController` | List Resource Types |
| `GET` | `/scim/endpoints/{endpointId}/ServiceProviderConfig` | `EndpointScimDiscoveryController` | Server Capabilities |
| `GET` | `/scim/ServiceProviderConfig` | `ServiceProviderConfigController` | Global SP Config |
| `GET` | `/scim/ResourceTypes` | `ResourceTypesController` | Global Resource Types |
| `GET` | `/scim/Schemas` | `SchemasController` | Global Schemas |

### 4.3 Admin Routes

| Method | Route | Controller | Description |
|--------|-------|------------|-------------|
| `POST` | `/scim/admin/endpoints` | `EndpointController` | Create endpoint |
| `GET` | `/scim/admin/endpoints` | `EndpointController` | List endpoints |
| `GET` | `/scim/admin/endpoints/{id}` | `EndpointController` | Get endpoint |
| `PATCH` | `/scim/admin/endpoints/{id}` | `EndpointController` | Update endpoint |
| `DELETE` | `/scim/admin/endpoints/{id}` | `EndpointController` | Delete endpoint |
| `GET` | `/scim/admin/endpoints/{id}/stats` | `EndpointController` | Endpoint statistics |
| `GET` | `/scim/admin/logs` | `AdminController` | List request logs |
| `GET` | `/scim/admin/logs/{id}` | `AdminController` | Log detail |
| `POST` | `/scim/admin/logs/clear` | `AdminController` | Clear logs |
| `GET` | `/scim/admin/activity` | `ActivityController` | Activity feed |
| `GET` | `/scim/admin/database/users` | `DatabaseController` | Browse users |
| `GET` | `/scim/admin/database/groups` | `DatabaseController` | Browse groups |
| `GET` | `/scim/admin/database/users/{id}` | `DatabaseController` | User detail |
| `GET` | `/scim/admin/database/groups/{id}` | `DatabaseController` | Group detail |
| `GET` | `/scim/admin/database/statistics` | `DatabaseController` | Dashboard stats |
| `GET` | `/scim/admin/info` | `AdminController` | App info |

### 4.4 OAuth Routes

| Method | Route | Controller | Description |
|--------|-------|------------|-------------|
| `POST` | `/scim/oauth/token` | `OAuthController` | Token endpoint |
| `GET` | `/scim/oauth/.well-known/openid-configuration` | `OAuthController` | Discovery |

### 4.5 SPA Routes

| Method | Route | Controller | Description |
|--------|-------|------------|-------------|
| `GET` | `/` | `WebController` | Serve SPA |
| `GET` | `/admin` | `WebController` | Serve SPA |
| `GET` | `/admin/*` | `WebController` | Serve SPA (client-side routing) |

---

## 5. Service Layer - Detailed Design

### 5.1 EndpointScimUsersService (585 lines)

**Responsibilities**: Full SCIM User lifecycle with RFC 7643/7644 compliance.

**Public Methods**:

| Method | Input | Output | Key Logic |
|--------|-------|--------|-----------|
| `createUser(endpointId, dto, baseUrl)` | CreateUserDto | ScimUserResource | Generate UUID scimId, validate userName uniqueness (case-insensitive via CITEXT column), persist payload as JSONB, create meta |
| `listUsers(endpointId, baseUrl, filter?, startIndex?, count?)` | Query params | ScimListResponse | Parse filter string, case-insensitive attribute matching (`eq` operator), 1-based pagination, MAX_COUNT=200 |
| `getUser(endpointId, id, baseUrl)` | scimId | ScimUserResource | Lookup by `endpointId + scimId`, parse payload, build meta.location |
| `updateUser(endpointId, id, dto, baseUrl)` | Full resource | ScimUserResource | Full PUT replace: re-validate userName uniqueness, update payload + derived columns |
| `patchUser(endpointId, id, patchDto, baseUrl)` | PatchOp[] | ScimUserResource | Process each op sequentially: `add`, `replace`, `remove` with support for no-path, simple path, valuePath, extension URN path |
| `deleteUser(endpointId, id)` | scimId | void | Delete ScimResource + cascade ResourceMember cleanup |

**Private Helpers**:
- `validateCreatePayload()` - SCIM schema validation, required field checks
- `matchesFilter()` - Case-insensitive property lookup for filter evaluation
- `formatUserResponse()` - Parse payload JSONB → ScimUserResource with meta
- `normalizeObjectKeys()` - Lowercase all keys for case-insensitive no-path PATCH merge
- `isExtensionPath()` / `applyExtensionPatchOp()` - URN-based extension attribute handling

### 5.2 EndpointScimGroupsService (632 lines)

**Responsibilities**: Full SCIM Group lifecycle with configurable member-management behavior.

**Public Methods**: Same CRUD pattern as Users plus per-endpoint config flag handling.

**Config-Driven Behavior**:
- `MultiOpPatchRequestAddMultipleMembersToGroup` - Whether to accept array of members in a single add operation
- `MultiOpPatchRequestRemoveMultipleMembersFromGroup` - Whether to accept array of member removes
- `PatchOpAllowRemoveAllMembers` - Whether `remove` with no filter removes all group members
- `VerbosePatchSupported` - Enables dot-notation path resolution in PATCH operations (e.g., `name.givenName` navigates into nested `name` object)

**Member Management**:
- `GroupMember` records linked by `groupId` + `userId` (nullable for unresolved references)
- Member `value` field = ScimResource.scimId (resolved) or external reference
- Member `display` derived from user's displayName or userName
- Cascade delete on group deletion

### 5.3 ScimMetadataService (14 lines)

Minimal service providing:
- `buildLocation(baseUrl, resourceType, id)` → full SCIM location URI
- `currentIsoTimestamp()` → ISO 8601 timestamp

### 5.4 EndpointService (~175 lines)

CRUD for Endpoint management:
- Validates endpoint name uniqueness
- Validates config JSON structure via `validateEndpointConfig()`
- Cascade delete removes all associated Users, Groups, Logs (via Prisma relations)

### 5.5 RequestLogService / LoggingService (481 lines)

- Records every HTTP request/response in `RequestLog` table
- Auto-derives `identifier` field from SCIM request paths/bodies (userName, displayName, externalId)
- Async fire-and-forget (does not block response)

### 5.6 ActivityParserService (898 lines)

Transforms raw `RequestLog` entries into human-readable activity feed items:
- Parses SCIM JSON payloads to extract meaningful descriptions
- Detects keepalive/probe requests and marks them
- Groups related operations (create → patch → delete sequences)

### 5.7 OAuthService (138 lines)

OAuth 2.0 `client_credentials` grant:
- Reads `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` from environment
- Auto-generates secret in dev mode
- Issues JWT with 1-hour expiry
- Validates JWT tokens via NestJS `JwtService`
- Scope checking: `scim.read`, `scim.write`, `scim.manage`

---

## 6. Data Model

### 6.1 Entity Relationship Diagram

```
┌──────────────────┐
│     Endpoint     │
│──────────────────│
│ id        (PK)   │
│ name      (UQ)   │
│ displayName      │
│ description      │
│ config    (JSON)  │
│ active           │
│ createdAt        │
│ updatedAt        │
├──────────────────┤
│ has many →       │
│  ScimResource    │──────┐
│  RequestLog      │  │   │
│  EndpointSchema  │  │   │
│  EndpointResType │  │   │
│  EndpointCred    │  │   │
└──────────────────┘  │   │
                      │   │
┌─────────────────────┤   │
│                     │   │
│  ┌──────────────────▼───▼──────────────────┐
│  │       ScimResource (unified table)       │
│  │──────────────────────────────────────────│
│  │ id              (PK, UUID)               │
│  │ endpointId      (FK → Endpoint)          │
│  │ resourceType    (VARCHAR: 'User'/'Group')│
│  │ scimId          (UUID)                   │
│  │ externalId      (TEXT, caseExact)        │
│  │ userName        (CITEXT, case-insensitive) │
│  │ displayName     (CITEXT, case-insensitive) │
│  │ active          (Boolean, default true)  │
│  │ payload         (JSONB - full SCIM JSON) │
│  │ version         (Int, monotonic ETag)    │
│  │ meta            (text)                   │
│  │ createdAt / updatedAt                    │
│  │──────────────────────────────────────────│
│  │ UQ: (endpointId, scimId)                 │
│  │ UQ: (endpointId, userName) - CITEXT      │
│  │ UQ: (endpointId, displayName) - CITEXT   │
│  │ UQ: (endpointId, resourceType, externalId)│
│  │ IDX: (endpointId, resourceType)          │
│  └──────────────────────┬───────────────────┘
│                         │ has many
│                         ▼
│  ┌──────────────────────────────────────────┐
│  │         ResourceMember                    │
│  │──────────────────────────────────────────│
│  │ id               (PK, UUID)              │
│  │ groupResourceId  (FK → ScimResource)     │
│  │ memberResourceId (FK → ScimResource, nullable) │
│  │ value            (SCIM member reference) │
│  │ type             ("User" / "Group")      │
│  │ display          (derived displayName)   │
│  │ createdAt                                │
│  └──────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│            RequestLog                         │
│──────────────────────────────────────────────│
│ id              (PK)                          │
│ endpointId      (FK → Endpoint, SET NULL)     │
│ method          (HTTP method)                 │
│ url             (full URL)                    │
│ status          (HTTP status code)            │
│ durationMs      (response time)               │
│ requestHeaders  (JSON text)                   │
│ requestBody     (JSON text)                   │
│ responseHeaders (JSON text)                   │
│ responseBody    (JSON text)                   │
│ errorMessage                                  │
│ errorStack                                    │
│ identifier      (auto-derived: userName etc)  │
│ createdAt                                     │
│──────────────────────────────────────────────│
│ IDX: createdAt, method, status, endpointId    │
└──────────────────────────────────────────────┘
```

### 6.2 Data Storage Strategy

| Aspect | Current Design |
|--------|---------------|
| **SCIM Attributes** | Stored as `payload` (JSONB) - full SCIM resource JSON (native PostgreSQL JSON type) |
| **Derived Columns** | `userName` (CITEXT), `active`, `externalId` (TEXT), `displayName` (CITEXT) extracted for queries |
| **Meta** | Stored as separate `meta` column (text) |
| **Group Members** | Normalized into `ResourceMember` junction table |
| **Config** | Endpoint `config` column as JSON string |
| **Request Logs** | Headers and bodies stored as JSON strings |

### 6.3 Uniqueness Constraints

| Scope | Constraint | Columns |
|-------|-----------|---------|
| Per-endpoint | ScimResource SCIM ID | `(endpointId, scimId)` |
| Per-endpoint | ScimResource userName (case-insensitive) | `(endpointId, userName)` CITEXT |
| Per-endpoint | ScimResource externalId | `(endpointId, resourceType, externalId)` |
| Per-endpoint | ScimResource displayName | `(endpointId, displayName)` CITEXT |
| Per-endpoint | ScimResource SCIM ID | `(endpointId, scimId)` |
| Global | Endpoint name | `(name)` |

---

## 7. Authentication Flow

### 7.1 3-Tier Authentication (v0.21.0)

The `SharedSecretGuard` (registered as global `APP_GUARD`) implements a 3-tier fallback chain. Each tier is tried in order; the first successful match authenticates the request.

```
Incoming Request
  │
  ├── Check @Public decorator → Skip auth (discovery endpoints, OAuth token, web UI)
  │
  ├── Extract: Authorization: Bearer <token>
  │
  ├── Tier 1: Per-Endpoint Bcrypt Credentials (v0.21.0)
  │   ├── extractEndpointId() from URL regex: /\/endpoints\/([0-9a-f-]{36})\//i
  │   ├── Check PerEndpointCredentialsEnabled flag for endpoint
  │   ├── Load active, non-expired credentials via IEndpointCredentialRepository
  │   ├── Lazy-load bcrypt (dynamic import, cached after first use)
  │   ├── bcrypt.compare(token, credentialHash) for each credential
  │   ├── Match → set req.authType = 'endpoint_credential', req.authCredentialId
  │   └── No match / error → fall through to Tier 2
  │
  ├── Tier 2: OAuth 2.0 JWT
  │   ├── Decode JWT via JwtService
  │   ├── Verify signature, expiry, client_id
  │   ├── Set req.oauth = payload, req.authType = 'oauth'
  │   └── ✓ Authenticated
  │
  └── Tier 3: Legacy Shared Secret
      ├── Compare token === env.SCIM_SHARED_SECRET
      ├── Set req.authType = 'legacy'
      └── ✓ Authenticated

  All tiers fail → 401 Unauthorized + WWW-Authenticate: Bearer realm="SCIM"
```

**Key design properties:**
- **Graceful fallback**: Per-endpoint check errors (missing repo, bcrypt failure, etc.) silently fall through to OAuth/legacy. Valid tokens are never blocked.
- **Lazy bcrypt loading**: The native `bcrypt` module is loaded via dynamic `import()` only on first use, then cached. Endpoints not using per-endpoint credentials incur zero bcrypt overhead.
- **Optional injection**: `@Optional() @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)` and `@Optional() @Inject(EndpointService)` - guard works correctly even when credential repo is unavailable.
- **Request decoration**: `req.authType` is set to `'endpoint_credential'`, `'oauth'`, or `'legacy'` so downstream controllers can distinguish auth method. `req.authCredentialId` is set for per-endpoint credentials.

### 7.2 OAuth 2.0 Token Flow

```
Client                                  SCIMServer
  │                                        │
  │  POST /scim/oauth/token                │
  │  grant_type=client_credentials         │
  │  client_id=xxx                         │
  │  client_secret=yyy                     │
  │  scope=scim.read scim.write            │
  │ ─────────────────────────────────────► │
  │                                        │  Validate credentials
  │                                        │  Generate JWT (1hr expiry)
  │  { access_token: "eyJ...",             │
  │    token_type: "Bearer",               │
  │    expires_in: 3600 }                  │
  │ ◄───────────────────────────────────── │
  │                                        │
  │  GET /scim/endpoints/{id}/Users        │
  │  Authorization: Bearer eyJ...          │
  │ ─────────────────────────────────────► │
  │                                        │  Validate JWT
  │  { Resources: [...] }                  │
  │ ◄───────────────────────────────────── │
```

### 7.3 Public Routes

Routes bypassing authentication via `@Public()` decorator:
- `POST /scim/oauth/token` - Token endpoint
- `GET /scim/oauth/.well-known/openid-configuration` - Discovery
- `GET /` - SPA serving
- Static assets (`/assets/*`)

---

## 8. SCIM Protocol Implementation Details

### 8.1 PATCH Operation Processing

```
PATCH /scim/endpoints/{eid}/Users/{id}
Body: { schemas: ["...PatchOp"], Operations: [...] }

For each Operation:
  ├── Normalize op name: lowercase comparison
  │
  ├── No path (op on whole resource):
  │   ├── normalizeObjectKeys(value) → lowercase all keys
  │   └── Merge value into parsed rawPayload
  │
  ├── Simple path (e.g., "active", "displayName"):
  │   └── Direct property set/replace/remove on parsed payload
  │
  ├── valuePath (e.g., "emails[type eq \"work\"].value"):
  │   ├── parseValuePath() → { attribute, filter, subAttribute }
  │   ├── Find matching element in multi-valued attribute
  │   └── Apply add/replace/remove to matching element
  │
  └── Extension URN path (e.g., "urn:...:enterprise:2.0:User:department"):
      ├── parseExtensionPath() → { urn, attribute }
      ├── Resolve case-insensitive URN match in schemas array
      └── Apply op to extension attribute in payload
```

### 8.2 Filter Processing

```
GET /scim/endpoints/{eid}/Users?filter=userName eq "john@example.com"

1. Parse filter: tokenize into (attribute, operator, value)
2. Case-insensitive attribute resolution:
   - "username" matches "userName", "USERNAME", etc.
3. Retrieve all users for endpoint from DB
4. In-memory filter: matchesFilter(parsedPayload, filterTokens)
   - Property lookup via case-insensitive key matching
   - String comparison per caseExact rules
5. Apply pagination (startIndex, count)
6. Return ListResponse
```

### 8.3 Resource Format (rawPayload Strategy)

```
Database Row:                          SCIM Response:
┌─────────────────────┐               ┌─────────────────────────────┐
│ scimId: "abc123"    │               │ {                           │
│ userName: "john"    │   format()    │   "schemas": ["...User"],   │
│ active: true        │ ──────────►  │   "id": "abc123",           │
│ payload: {...}      │               │   "userName": "john",       │
│ meta: "{...}"       │               │   "emails": [...],          │
└─────────────────────┘               │   "name": {...},            │
                                      │   "meta": { ... }           │
                                      │ }                           │
                                      └─────────────────────────────┘
```

---

## 9. Frontend Architecture

### 9.1 React SPA Structure

```
web/src/
├── App.tsx                    # Root component with routing
├── components/
│   ├── Header.tsx             # Navigation bar
│   ├── RequestLogList.tsx     # Log table with filtering
│   ├── RequestLogDetail.tsx   # Single log drill-down
│   ├── LogFilters.tsx         # Filter controls
│   ├── ActivityFeed.tsx       # Human-readable activity
│   ├── ManualProvisioning.tsx # Manual user/group creation form
│   └── DatabaseExplorer.tsx   # User/group data browser
└── styles/                    # CSS modules
```

### 9.2 Frontend-Backend Communication

- **Development**: Vite dev server on port 5173, proxied to NestJS on port 3000
- **Production**: React app pre-built into `api/public/` as static assets, served by NestJS

### 9.3 Build Pipeline

```bash
# Development (web/)
npm run dev          # Vite HMR on :5173

# Production build (web/)
npm run build        # Output to api/public/

# API server (api/)
npm run start:dev    # NestJS with --watch
npm run build        # tsc → dist/
npm run start:prod   # node dist/main.js
```

---

## 10. Infrastructure & Deployment

### 10.1 Azure Resource Architecture

```
Azure Resource Group
├── Container Apps Environment (containerapp-env.bicep)
│   └── Container App (containerapp.bicep)
│       ├── Image: ghcr.io/pranems/scimserver:<tag>
│       ├── Min replicas: 0 (scale-to-zero)
│       ├── Max replicas: 1
│       ├── CPU: 0.5, Memory: 1Gi
│       └── Env vars: DATABASE_URL, SCIM_SHARED_SECRET, JWT_SECRET, OAUTH_CLIENT_SECRET
├── Azure Container Registry (acr.bicep)
├── Azure PostgreSQL Flexible Server (postgres.bicep)
│   ├── Sku: Standard_B1ms (Burstable)
│   └── Built-in WAL backup (7-day PITR)
├── Virtual Network (networking.bicep)
│   ├── aca-infra-subnet → Container Apps Environment
│   ├── aca-runtime-subnet → Container App workloads
│   └── private-endpoints-subnet → future private endpoints
└── Log Analytics Workspace
```

### 10.2 Docker Configuration

```dockerfile
# Multi-stage build (Dockerfile)
FROM node:24-alpine AS builder
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ .
RUN npx prisma generate
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### 10.3 Deployment Scripts

| Script | Purpose |
|--------|---------|
| `bootstrap.ps1` | No-clone one-liner - downloads `setup.ps1` from GitHub, provisions full Azure stack |
| `setup.ps1` | Interactive Azure deploy - prompts for config, downloads Bicep templates, calls `deploy-azure.ps1 -ProvisionPostgres` |
| `deploy.ps1` | Alternative one-liner - prompts for config, downloads repo ZIP or uses local scripts, calls `deploy-azure.ps1 -ProvisionPostgres` |
| `scripts/deploy-azure.ps1` | Core 5-step Azure provisioning (RG → Network → PG → Environment → Container App) |

---

## 11. Testing Architecture

### 11.1 Test Framework

- **Framework**: Jest 30 with `ts-jest` transform
- **Test Location**: `api/test/` directory
- **Test Pattern**: `*.spec.ts` and `*.test.ts`
- **Current matrix**: See [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md#test-suite-summary) for current test counts - all passing

### 11.2 Test Categories

| Suite | Tests | Covers |
|-------|-------|--------|
| SCIM Users CRUD | ~60 | Create, Get, List, Update, Delete users |
| SCIM Groups CRUD | ~50 | Create, Get, List, Update, Delete groups |
| PATCH Operations | ~45 | Add/Replace/Remove for all path types |
| Case-Insensitivity | ~23 | RFC 7643 §2.1 case-insensitive behavior |
| Filtering | ~30 | Filter parsing, matching, operators |
| Multi-Endpoint | ~20 | Isolation, cross-endpoint prevention |
| Authentication | ~15 | OAuth + legacy auth flows |
| Discovery | ~12 | ServiceProviderConfig, ResourceTypes, Schemas |
| Error Handling | ~20 | SCIM error format, status codes |
| Group Members | ~25 | Member add/remove/replace, multi-member PATCH |
| Activity Parser | ~17 | Log → activity translation |

### 11.3 Test Configuration

```typescript
// jest.config.ts
{
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node'
}
```

---

## 12. Configuration Management

### 12.1 Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP server port |
| `API_PREFIX` | `scim` | Global route prefix |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `SCIM_SHARED_SECRET` | Auto-generated | Legacy bearer auth token |
| `OAUTH_CLIENT_ID` | Auto-generated | OAuth client identifier |
| `OAUTH_CLIENT_SECRET` | Auto-generated | OAuth client secret |
| `OAUTH_CLIENT_SCOPES` | `scim.read,scim.write,scim.manage` | Allowed OAuth scopes |
| `NODE_ENV` | `development` | Environment mode |

### 12.2 Per-Endpoint Configuration Flags

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `MultiOpPatchRequestAddMultipleMembersToGroup` | boolean | false | Allow multi-member add in single PATCH |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | boolean | false | Allow multi-member remove in single PATCH |
| `PatchOpAllowRemoveAllMembers` | boolean | false | Allow remove-all-members operation |
| `VerbosePatchSupported` | boolean | false | Enable dot-notation path resolution in PATCH (e.g., `name.givenName`) |
| `excludeMeta` | boolean | false | Omit meta from responses |
| `excludeSchemas` | boolean | false | Omit schemas from responses |
| `customSchemaUrn` | string | - | Custom schema URN to advertise |
| `includeEnterpriseSchema` | boolean | false | Include Enterprise User extension |
| `strictMode` | boolean | false | Enforce strict SCIM validation |
| `legacyMode` | boolean | false | Enable legacy behavior |
| `customHeaders` | object | - | Custom response headers |

---

> **Historical Note:** This design originally used 28 documented SQLite-specific compromises
> (single-writer lock, derived lowercase columns, buffered logging, ephemeral storage, etc.).
> These were all resolved by the Phase 3 PostgreSQL migration (v0.11.0). For the historical audit, see
> [SQLITE_COMPROMISE_ANALYSIS.md](SQLITE_COMPROMISE_ANALYSIS.md).

*This document describes the as-built architecture of SCIMServer as of March 2026.*
