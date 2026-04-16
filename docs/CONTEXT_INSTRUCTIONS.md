# SCIMServer — Context Instructions for AI Assistants

> **Purpose**: This file provides complete project context for AI coding assistants (GitHub Copilot, etc.) to enable productive sessions without re-discovery of architecture, patterns, and decisions.  
> **Version**: 0.37.1  
> **Last Updated**: April 16, 2026

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Name** | SCIMServer |
| **Purpose** | SCIM 2.0 provisioning visibility and monitoring tool for Microsoft Entra ID |
| **Repository** | `C:\Users\v-prasrane\source\repos\SCIMServer` |
| **API Root** | `C:\Users\v-prasrane\source\repos\SCIMServer\api` |
| **Frontend Root** | `C:\Users\v-prasrane\source\repos\SCIMServer\web` |
| **Standards** | RFC 7643 (Core Schema), RFC 7644 (Protocol), RFC 7642 (Concepts) |

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 24.x (Alpine in Docker) |
| **Language** | TypeScript | 5.x |
| **Framework** | NestJS | 11.x |
| **ORM** | Prisma | 7.x |
| **Database** | PostgreSQL 17 | (via Prisma, docker postgres:17-alpine) |
| **Frontend** | React | 19.x |
| **Bundler** | Vite | 7.x |
| **Auth** | JWT + Bearer token | @nestjs/jwt |
| **Testing** | Jest | 30.x with ts-jest |
| **Deployment** | Azure Container Apps | via Bicep IaC |

---

## 3. Key File Locations

### 3.1 API (NestJS Backend)

```
api/src/main.ts                                          # Bootstrap: NestFactory, CORS, prefix, pipes
api/src/modules/app/app.module.ts                        # Root module — all imports
api/src/modules/scim/scim.module.ts                      # SCIM feature module
api/src/modules/scim/controllers/
  endpoint-scim-users.controller.ts                      # Users CRUD controller
  endpoint-scim-groups.controller.ts                     # Groups CRUD controller
  endpoint-scim-bulk.controller.ts                       # Bulk Operations controller (RFC 7644 §3.7)
  endpoint-scim-discovery.controller.ts                  # SCIM discovery — PRIMARY endpoint-scoped (multi-tenant)
api/src/modules/scim/services/
  endpoint-scim-users.service.ts    (528 lines)          # Users business logic (G17 dedup: −29%)
  endpoint-scim-groups.service.ts   (627 lines)          # Groups business logic (G17 dedup: −28%)
  bulk-processor.service.ts         (395 lines)          # Bulk operation processor with bulkId resolution
  scim-metadata.service.ts                               # buildLocation, timestamp
api/src/modules/scim/common/
  scim-service-helpers.ts           (353 lines)          # G17: parseJson, ensureSchema, enforceIfMatch, sanitizeBooleanStrings, ScimSchemaHelpers
api/src/modules/scim/dto/
  bulk-request.dto.ts                                    # BulkRequest/Response DTOs (RFC 7644 §3.7)
  create-user.dto.ts                                     # User creation DTO
  patch-user.dto.ts                                      # PATCH operations DTO
  create-group.dto.ts                                    # Group creation DTO
  patch-group.dto.ts                                     # Group PATCH DTO
  list-query.dto.ts                                      # Pagination/filter DTO
api/src/modules/scim/common/
  scim-constants.ts                                      # Schema URNs, pagination limits
  scim-types.ts                                          # ScimUserResource, ScimGroupResource, ScimListResponse
  scim-errors.ts                                         # createScimError()
api/src/modules/scim/utils/
  scim-patch-path.ts                                     # 9 exported patch path utilities
  base-url.util.ts                                       # buildBaseUrl() from request
api/src/modules/scim/controllers/
  scim-me.controller.ts                                  # /Me endpoint (RFC 7644 §3.11, v0.20.0)
  admin-credential.controller.ts                         # Per-endpoint credential CRUD (v0.21.0)
api/src/modules/scim/common/
  scim-sort.util.ts                                      # sortBy/sortOrder mapping utility (v0.20.0)
api/src/modules/endpoint/
  endpoint-config.interface.ts                           # 13 boolean flags + logLevel (settings v7) + helpers
  endpoint-context.storage.ts                            # AsyncLocalStorage for endpoint context
api/src/modules/scim/filters/
  scim-filter-parser.ts                                  # Filter AST attribute path extraction
api/src/modules/scim/interceptors/
  scim-content-type.interceptor.ts                       # Sets application/scim+json
api/src/modules/auth/
  shared-secret.guard.ts                                 # Global auth guard (JWT + legacy)
  public.decorator.ts                                    # @Public() route exemption
api/src/modules/logging/
  scim-logger.service.ts                                 # Central structured logger (AsyncLocalStorage, ring buffer, SSE, file transport)
  log-levels.ts                                          # 7 log levels (TRACE→OFF), 14 categories, LogConfig interface
  logging.service.ts                                     # RequestLog persistence (buffered DB writes, supports in-memory)
  log-config.controller.ts                               # Admin API: GET/PUT config, recent, audit, stream, download
  log-query.service.ts                                   # Shared query/stream/download logic
  request-logging.interceptor.ts                         # X-Request-Id, correlation context, duration, tiered log levels
  file-log-transport.ts                                  # Main + per-endpoint log files
  rotating-file-writer.ts                                # Size-based file rotation (pure Node.js fs)
  logging.module.ts                                      # @Global() module registration
api/src/modules/endpoint/
  endpoint.controller.ts                                 # Admin CRUD for endpoints
  endpoint.service.ts                                    # Endpoint business logic (supports in-memory mode)
api/src/modules/database/
  database.controller.ts                                 # Dashboard data APIs
  database.service.ts                                    # User/group/stats queries
api/src/modules/activity-parser/
  activity-parser.service.ts       (898 lines)           # Log → human-readable activity
api/src/oauth/
  oauth.controller.ts                                    # Token + discovery endpoints
  oauth.service.ts                 (138 lines)           # JWT generation/validation
api/src/modules/prisma/prisma.service.ts                 # Extended PrismaClient
api/src/modules/web/web.controller.ts                    # SPA serving
api/prisma/schema.prisma                                 # 5 models: Endpoint, RequestLog, ScimResource, ResourceMember, EndpointCredential
```

### 3.2 Frontend (React SPA)

```
web/src/App.tsx                                          # Root component with routing
web/src/components/
  Header.tsx, RequestLogList.tsx, RequestLogDetail.tsx
  LogFilters.tsx, ActivityFeed.tsx, ManualProvisioning.tsx
  DatabaseExplorer.tsx
web/vite.config.ts                                       # Dev proxy to :3000
```

### 3.3 Infrastructure

```
infra/containerapp.bicep                                 # Container App definition
infra/containerapp-env.bicep                             # Environment (VNet-integrated)
infra/acr.bicep                                          # Azure Container Registry
infra/networking.bicep                                   # VNet, subnets (aca-infra, aca-runtime, private-endpoints)
infra/postgres.bicep                                     # Azure PostgreSQL Flexible Server
```

### 3.4 Legacy Files

> `endpoint-scim.controller.ts` was **deleted** (Feb 2026). It was a monolithic controller superseded by the split into Users, Groups, and Discovery controllers.

---

## 4. Development Commands

```powershell
# From api/ directory:
npm run start:dev           # NestJS with --watch (hot reload)
npm run build               # TypeScript compilation to dist/
npm run start               # Production mode (runs prisma migrate deploy first)
npm test                    # Run unit tests (Jest)
npm run test:cov            # Unit tests with coverage → coverage/
npm run test:e2e            # Run E2E suite
npm run test:e2e:cov        # E2E tests with coverage → coverage-e2e/
npm run test:cov:all        # Unit + E2E coverage combined
npm run test:all            # Unit + E2E + live smoke (full pipeline)
npm run test:ci             # Unit + E2E CI sequence
npm run test:smoke          # Live integration tests (PowerShell)
npm test -- --watch         # Watch mode
npm test -- --verbose       # Verbose output
npx prisma migrate dev      # Run migrations
npx prisma migrate deploy   # Apply migrations in production-compatible mode
npx prisma generate         # Regenerate Prisma client
npx prisma studio           # Visual DB browser

# From web/ directory:
npm run dev                 # Vite HMR dev server on :5173
npm run build               # Production build → api/public/

# Docker:
docker build -t scimserver -f Dockerfile .
docker-compose up           # Full stack
```

### 4.1 Runtime Reality Notes (Source-of-truth from code)

- **Do not use repo-root `npm start`** for API startup. Run from `api/` (`npm run start` or `npm run start:dev`).
- **Local API default port**: `3000` when `PORT` is not set (`api/src/main.ts`).
- **Docker runtime port**: `8080` (image `ENV PORT=8080`, `EXPOSE 8080`, healthcheck on `:8080`).
- **SCIM path compatibility**: requests to `/scim/v2/*` are rewritten to `/scim/*` at runtime middleware.
- **Production auth secrets required**: `SCIM_SHARED_SECRET`, `JWT_SECRET`, and `OAUTH_CLIENT_SECRET`.

---

## 5. Architecture Patterns & Conventions

### 5.1 Code Style

- **Modules**: One module per feature domain (NestJS convention)
- **Controllers**: Thin — validate endpoint, set context, delegate to service
- **Services**: Fat — all business logic, SCIM protocol handling, DB access
- **DTOs**: class-validator decorators for request validation
- **Errors**: Always use `createScimError()` for SCIM-formatted errors
- **Constants**: Centralized in `scim-constants.ts` — never hardcode schema URNs
- **Types**: Shared interfaces in `scim-types.ts`

### 5.2 Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Controllers | `PascalCase` + `Controller` | `EndpointScimUsersController` |
| Services | `PascalCase` + `Service` | `EndpointScimUsersService` |
| DTOs | `PascalCase` + `Dto` | `CreateUserDto` |
| Interfaces | `PascalCase` | `EndpointConfig`, `ScimUserResource` |
| Files | `kebab-case` | `endpoint-scim-users.controller.ts` |
| Routes | SCIM convention: `/Users`, `/Groups` (PascalCase resource names) |
| DB Models | `PascalCase` | `ScimResource`, `ResourceMember`, `Endpoint` |

### 5.3 Data Storage Pattern

The project uses a **"payload (JSONB) + derived columns"** pattern:
- `payload`: Stores the FULL SCIM resource as JSONB (PostgreSQL native JSON type)
- Derived columns (`userName`, `active`, `externalId`, `displayName`): Extracted via CITEXT/VARCHAR for queries and uniqueness
- On read: `payload` is merged with server-managed fields (`id`, `meta`)
- On write: Full JSON is stored in `payload`, derived columns are also updated

### 5.4 Endpoint Isolation Pattern

All SCIM resources are scoped to an `endpointId`:
- Routes: `/scim/endpoints/{endpointId}/Users`
- DB queries: Always include `WHERE endpointId = ?`
- Uniqueness: Composite unique constraints include `endpointId`
- Context: `EndpointContextStorage` (AsyncLocalStorage) propagates endpoint context

### 5.5 Authentication Pattern

**3-tier fallback auth** via global `SharedSecretGuard` (v0.21.0, G11):
1. **Per-endpoint bcrypt credentials** (if `PerEndpointCredentialsEnabled` + endpoint has active credentials) — `IEndpointCredentialRepository.findActive()` + bcrypt verify → `req.authType = 'endpoint_credential'`
2. **OAuth 2.0 JWT** — `OAuthService.validateAccessToken()` (Bearer JWT) → `req.authType = 'oauth'`
3. **Global shared secret** — direct string comparison with `SCIM_SHARED_SECRET` → `req.authType = 'legacy'`
4. Public routes exempted via `@Public()` decorator

**Credential Admin API** (requires `PerEndpointCredentialsEnabled` flag):
- `POST /scim/admin/endpoints/:id/credentials` — Generate 32-byte base64url token, store bcrypt hash (12 rounds), return plaintext once
- `GET /scim/admin/endpoints/:id/credentials` — List credentials (hash never returned)
- `DELETE /scim/admin/endpoints/:id/credentials/:credentialId` — Revoke (deactivate)

**Source files:**
- Guard: `api/src/modules/auth/shared-secret.guard.ts`
- Credential controller: `api/src/modules/scim/controllers/admin-credential.controller.ts`
- Credential repository: `api/src/modules/scim/repositories/endpoint-credential/`

### 5.6 Error Handling Pattern

```typescript
// Always use createScimError() — never throw raw HttpException for SCIM routes
throw createScimError({
  status: 409,
  detail: `User with userName "${userName}" already exists`,
  scimType: 'uniqueness'
});
```

### 5.7 PATCH Path Handling

Four categories of PATCH paths, handled in order:
1. **No path**: Merge value object into resource (normalize keys first)
2. **Simple path**: Direct property set (`active`, `displayName`)
3. **valuePath**: Bracket filter expression (`emails[type eq "work"].value`)
4. **Extension URN**: Full URN prefix (`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department`)

### 5.8 ReadOnly Attribute Stripping (v0.22.0)

POST/PUT payloads auto-strip `mutability:'readOnly'` attrs (`id`, `meta`, `groups`, custom readOnly) before business logic. PATCH ops targeting readOnly attrs are silently stripped when `StrictSchemaValidation` is OFF or `IgnoreReadOnlyAttributesInPatch` is ON. Warning URN (`urn:scimserver:api:messages:2.0:Warning`) attached when `IncludeWarningAboutIgnoredReadOnlyAttribute` enabled. Covers Users, Groups, AND Generic (custom) resource types.

**Source files:**
- Strip helpers: `api/src/modules/scim/common/scim-service-helpers.ts` (`stripReadOnlyAttributes()`, `stripReadOnlyPatchOps()`)
- Warning accumulation: `api/src/modules/endpoint/endpoint-context.storage.ts` (`addWarnings()`, `getWarnings()`)
- Middleware: `EndpointContextStorage.createMiddleware()` + `ScimModule.configure()` (Express middleware with `storage.run()`)
- Feature doc: `docs/READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md`

### 5.9 P2 Attribute Characteristic Enforcement (v0.24.0)

Six behavioral fixes from the RFC 7643 §2 attribute characteristics audit:

| Item | Description | Key Files |
|------|-------------|----------|
| R-RET-1 | Schema-driven `returned:'always'` at projection level — immune to `attributes=`/`excludedAttributes=` | `scim-attribute-projection.ts` |
| R-RET-2 | Group `active` always returned | `scim-attribute-projection.ts` |
| R-RET-3 | Sub-attribute `returned:'always'` enforcement (e.g., `emails.value`, `members.value`) | `scim-attribute-projection.ts`, `schema-validator.ts` |
| R-MUT-1 | `writeOnly` mutability → `returned:never` defense-in-depth | `schema-validator.ts` |
| R-MUT-2 | readOnly sub-attr stripping within readWrite parents (core+ext, single+multi-valued) | `scim-service-helpers.ts` |
| R-CASE-1 | caseExact-aware in-memory filter evaluation (`caseExactAttrs` set) | `scim-filter-parser.ts`, `apply-scim-filter.ts` |

**Source files:**
- Projection: `api/src/modules/scim/common/scim-attribute-projection.ts` (`applyAttributeProjection()` with 6 params, `includeOnly()` with 4 params)
- Collector: `api/src/domain/validation/schema-validator.ts` (`collectReturnedCharacteristics()` returns `alwaysSubs` map, `collectCaseExactAttributes()`, `collectReadOnlyAttributes()` returns `coreSubAttrs`/`extensionSubAttrs`)
- Strip helpers: `api/src/modules/scim/common/scim-service-helpers.ts` (`getAlwaysReturnedAttributes()`, `getAlwaysReturnedSubAttrs()`, `getCaseExactAttributes()`)
- Filter: `api/src/modules/scim/filters/scim-filter-parser.ts` (`compareValues()` with 4th param `caseExact`, `evaluateFilter()` with 3rd param `caseExactAttrs`)
- Feature doc: `docs/P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md`

---

## 6. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **PostgreSQL 17** (migrated from SQLite in Phase 3) | Production-grade RDBMS with CITEXT for case-insensitive columns, JSONB for schema-free SCIM attributes, GIN indexes for filter push-down |
| **payload as JSONB** | SCIM resources have arbitrary attributes; structured columns can't capture all; JSONB preserves fidelity with native query support |
| **Derived columns** | Indexed VARCHAR/CITEXT columns for uniqueness constraints and efficient filtering |
| **CITEXT columns** | RFC 7643 §2.1 requires case-insensitive userName uniqueness; PostgreSQL CITEXT handles this natively |
| **AsyncLocalStorage** | Endpoint context propagation without threading endpoint ID through every method signature. Uses `storage.run()` via Express middleware (not `enterWith()`) to ensure context survives NestJS interceptor pipeline boundaries. |
| **Repository Pattern** | `IUserRepository`/`IGroupRepository` interfaces with `PERSISTENCE_BACKEND` env toggle (prisma/inmemory) |
| **Dual auth** | OAuth for production clients (Entra); legacy token for simple testing/debugging |
| **Global prefix `/scim`** | All routes under `/scim/`; URL rewrite middleware supports `/scim/v2` for spec compliance |
| **Filter push-down** | All 10 SCIM operators pushed to PostgreSQL WHERE clauses; compound AND/OR supported; no in-memory filtering |

---

## 7. Current Compliance Status

### 7.1 SCIM 2.0 Compliance

| Feature | Status |
|---------|--------|
| ✅ Users CRUD (POST/GET/PUT/PATCH/DELETE) | Complete |
| ✅ Groups CRUD (POST/GET/PUT/PATCH/DELETE) | Complete |
| ✅ PATCH (add/replace/remove, valuePath, extension URNs, no-path merge) | Complete |
| ✅ Case-insensitive behavior (RFC 7643 §2.1) | Complete |
| ✅ Discovery endpoints | 100% — All 6 gaps (D1–D6) resolved. Two-tier multi-tenant architecture: root-level (global defaults) + endpoint-scoped (primary, per-tenant overlays). See [DISCOVERY_ENDPOINTS_RFC_AUDIT.md](../docs/DISCOVERY_ENDPOINTS_RFC_AUDIT.md) |
| ✅ Pagination (startIndex, count) | Complete |
| ✅ Filtering operators (`eq`, `ne`, `co`, `sw`, `ew`, `gt`, `ge`, `lt`, `le`, `pr`) | Complete |
| ✅ Attribute projection (`attributes`, `excludedAttributes`) | Complete |
| ✅ ETag / If-None-Match conditional GET behavior | Complete |
| ✅ Sorting (`sortBy`, `sortOrder`) | Complete (v0.20.0, `sort.supported=true`) |
| ✅ Bulk operations (`/Bulk`) | Complete (v0.19.0, RFC 7644 §3.7, `BulkOperationsEnabled` flag) |
| ✅ `/Me` endpoint | Complete (v0.20.0, JWT sub → userName identity resolution) |
| ✅ Per-endpoint credentials | Complete (v0.21.0, `PerEndpointCredentialsEnabled` flag, bcrypt tokens, 3-tier fallback) |
| ✅ ReadOnly attribute stripping | Complete (v0.22.0, RFC 7643 §2.2, `IncludeWarningAboutIgnoredReadOnlyAttribute` + `IgnoreReadOnlyAttributesInPatch` flags, warning URN extension) |
| ✅ P2 attribute characteristic enforcement | Complete (v0.24.0, 6 behavioral fixes: R-RET-1 schema-driven always-returned, R-RET-2 Group active always, R-RET-3 sub-attr always, R-MUT-1 writeOnly→never, R-MUT-2 readOnly sub-attr stripping, R-CASE-1 caseExact filter) |

### 7.2 Microsoft Entra ID Compatibility

- ✅ Critical provisioning flows validated
- ✅ Microsoft SCIM Validator: 25/25 pass (+ 7 preview)
- ✅ OAuth client credentials + bearer token flows operational

---

## 8. Test Coverage

> 📊 See [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md#test-suite-summary) for current test counts.

- **Unit** and **E2E** — all passing (0 failures). **Unit**: 3,265 (83 suites). **E2E**: 969 (46 suites). **Live integration** — ~753 assertions
- **SCIM Validator**: 10/12 mandatory (2 FP on Lexmark returned:never), 25/25 on standard profile + 7/7 preview
- Test runners: `npm test`, `npm run test:e2e`, `npm run test:smoke`
- Coverage runners: `npm run test:cov`, `npm run test:e2e:cov`, `npm run test:cov:all`
- Full pipeline: `npm run test:all` (unit + E2E + live smoke)
- Coverage includes SCIM CRUD, PATCH path variants, case-insensitivity, filtering, projection, ETag behavior, endpoint isolation, auth, logging config, admin operations, and SCIM validator compliance scenarios.

---

## 9. Session History & Completed Work

### Phase 13: Endpoint Profile Configuration (v0.28.0) → Phase 14: Legacy Removal (v0.29.0)
- Unified `Endpoint.profile` JSONB replaces fragmented `config` + `EndpointSchema` + `EndpointResourceType`
- 6 named presets (entra-id default, entra-id-minimal, rfc-standard, minimal, user-only, user-only-with-custom-ext)
- RFC-native SCIM discovery format as configuration input with auto-expand + tighten-only validation
- New API: `GET /admin/profile-presets` (read-only, 5 presets)
- Prisma schema: 5 models (Endpoint, RequestLog, ScimResource, ResourceMember, EndpointCredential)
- 28 files deleted (~4,800 lines removed), 13 new files created
- Design doc: `SCHEMA_TEMPLATES_DESIGN.md` (2,349 lines, 47 code blocks, 19 Mermaid diagrams)

### Phase 1: PATCH Compliance Fixes
- Fixed `op` case-insensitivity (lowercase comparison)
- Added extension URN path support for PATCH
- Added valuePath filter support for PATCH
- Added no-path PATCH merge
- Added 29 new tests (290 → 294)

### Phase 2: Code Cleanup & Refactoring  
- Fixed 12 Prisma TypeScript errors
- Removed 4 legacy SCIM files
- Refactored `endpoint-scim.controller.ts` (deleted) into:
  - `endpoint-scim-users.controller.ts`
  - `endpoint-scim-groups.controller.ts`
  - `endpoint-scim-discovery.controller.ts`

### Phase 3: Case-Insensitivity (RFC 7643 §2.1)
- Added CITEXT columns for userName, externalId (case-insensitive uniqueness)
- Case-insensitive userName uniqueness enforcement
- Case-insensitive filter attribute names
- Case-insensitive schema URI validation
- Case-insensitive extension URN matching
- `normalizeObjectKeys()` for no-path PATCH
- Case-insensitive property lookup in `matchesFilter()`
- `sort.supported: false` across all configs
- 23 new tests (294 → 317)

### Phase 4: Documentation (Current)
- Technical Requirements Document
- Technical Design Document
- Context Instructions (this file)
- Design Improvement Recommendations

---

## 10. Important Gotchas & Warnings

1. **`endpoint-scim.controller.ts` was deleted** — superseded by Users, Groups, and Discovery controllers
2. **payload is JSONB** — native JSON type in PostgreSQL; use Prisma's JSON operations for queries
3. **PostgreSQL CITEXT** — userName and externalId use CITEXT for case-insensitive uniqueness; no derived `*Lower` columns needed
4. **Filter push-down** — ALL 10 SCIM operators are pushed to PostgreSQL WHERE clauses; compound AND/OR supported. No in-memory post-fetch filtering.
5. **Blob backup removed (v0.23.0)** — `BackupService`, `BackupModule`, `blob-restore.ts`, and `infra/blob-storage.bicep` were deleted. PostgreSQL uses Azure-native WAL backup (configured via `backupRetentionDays` in `postgres.bicep`). `@azure/identity` and `@azure/storage-blob` npm packages also removed.
6. **Auto-generated secrets** — In dev mode, `SCIM_SHARED_SECRET` and `OAUTH_CLIENT_SECRET` are auto-generated and logged to console. NEVER do this in production.
7. **ValidationPipe whitelist: false** — We do NOT strip unknown properties, because SCIM resources have arbitrary attributes in extensions
8. **The `/scim/v2` rewrite** — Express middleware in `main.ts` rewrites `/scim/v2/*` to `/scim/*` for spec compliance
9. **SchemaValidator** — 950-line pure domain class for RFC 7643 payload validation. Gated behind `StrictSchemaValidation` config flag. Validates type, mutability (readOnly + immutable), required attrs, unknown attrs, sub-attributes, canonicalValues, size limits. New: `collectBooleanAttributeNames()` for schema-aware boolean coercion, `collectReadOnlyAttributes()` for readOnly stripping, `validateFilterAttributePaths()` for filter validation (V32).
10. **Repository Pattern** — `IUserRepository`/`IGroupRepository` interfaces injected via tokens. `PERSISTENCE_BACKEND` env var toggles between `prisma` and `inmemory` implementations.
11. **G2 is DONE + G17 RESOLVED (v0.20.0)** — Database uses a single unified `ScimResource` table. G17 service code deduplication completed: 13+ duplicate private methods extracted into `scim-service-helpers.ts` (`parseJson`, `ensureSchema`, `enforceIfMatch`, `sanitizeBooleanStrings`, `ScimSchemaHelpers`). All 27 migration gaps (G1–G20) are now closed.
12. **3-tier auth guard** — `SharedSecretGuard` now implements 3-tier fallback: per-endpoint bcrypt credentials → OAuth JWT → global `SCIM_SHARED_SECRET`. Per-endpoint credentials use lazy-loaded native bcrypt (12 rounds, cached after first use). Active + non-expired credentials only.
13. **CORS wildcard** — `main.ts` sets `origin: true` (accept all origins). Should be restricted for production deployments.

---

## 11. Quick Reference — Creating New Features

### Adding a new SCIM attribute to Users:
1. No schema change needed (stored in `payload` JSONB)
2. If needed for queries/uniqueness: add derived column in `schema.prisma`
3. Update `formatUserResponse()` if special handling needed
4. Update `matchesFilter()` if it should be filterable
5. Add tests

### Adding a new endpoint config flag:
1. Add to `ENDPOINT_CONFIG_FLAGS` in `endpoint-config.interface.ts`
2. Add to `EndpointConfig` interface
3. Read via `getConfigBoolean()` (defaults absent → `false`) or `getConfigBooleanWithDefault()` (custom default — used for `AllowAndCoerceBooleanStrings` which defaults to `true`)
4. Update `validateEndpointConfig()` if needed
5. Add tests
6. Update [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) — flag summary table (§2), defaults matrix (§2.1), and true/false behavior (§2.2)

> **Flag defaults quick ref:** `AllowAndCoerceBooleanStrings` and `PatchOpAllowRemoveAllMembers` default to `true`. All other boolean flags default to `false`. When no profile/preset is specified on endpoint creation, the `entra-id` preset is applied (sets 5 flags to `True`).

### Adding a new admin API route:
1. Add method to appropriate controller (`AdminController`, `DatabaseController`, etc.)
2. Add service method
3. Route is auto-prefixed with `/scim/admin/`
4. Authentication applied automatically (global guard)
5. Add tests

---

*This document should be the FIRST thing read at the start of any AI-assisted coding session.*
