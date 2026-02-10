# SCIMTool — Context Instructions for AI Assistants

> **Purpose**: This file provides complete project context for AI coding assistants (GitHub Copilot, etc.) to enable productive sessions without re-discovery of architecture, patterns, and decisions.  
> **Last Updated**: February 9, 2026

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Name** | SCIMTool (SCIMTool2022) |
| **Purpose** | SCIM 2.0 provisioning visibility and monitoring tool for Microsoft Entra ID |
| **Repository** | `C:\Users\v-prasrane\source\repos\SCIMTool2022` |
| **API Root** | `C:\Users\v-prasrane\source\repos\SCIMTool2022\api` |
| **Frontend Root** | `C:\Users\v-prasrane\source\repos\SCIMTool2022\web` |
| **Standards** | RFC 7643 (Core Schema), RFC 7644 (Protocol), RFC 7642 (Concepts) |

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 20.x (Alpine in Docker) |
| **Language** | TypeScript | 5.x |
| **Framework** | NestJS | 10.x |
| **ORM** | Prisma | 5.16.x |
| **Database** | SQLite | (via Prisma) |
| **Frontend** | React | 18.3.x |
| **Bundler** | Vite | 5.2.x |
| **Auth** | JWT + Bearer token | @nestjs/jwt |
| **Testing** | Jest | 29.x with ts-jest |
| **Deployment** | Azure Container Apps | via Bicep IaC |
| **Backup** | Azure Blob Storage | @azure/storage-blob |

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
  endpoint-scim-discovery.controller.ts                  # SCIM discovery (Schemas, ResourceTypes, ServiceProviderConfig)
api/src/modules/scim/services/
  endpoint-scim-users.service.ts    (585 lines)          # Users business logic
  endpoint-scim-groups.service.ts   (632 lines)          # Groups business logic
  scim-metadata.service.ts          (14 lines)           # buildLocation, timestamp
api/src/modules/scim/dto/
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
  endpoint-config.interface.ts                           # 10 config flags + helpers
  endpoint-context.storage.ts                            # AsyncLocalStorage for endpoint context
  base-url.util.ts                                       # buildBaseUrl() from request
api/src/modules/scim/interceptors/
  scim-content-type.interceptor.ts                       # Sets application/scim+json
api/src/modules/auth/
  shared-secret.guard.ts                                 # Global auth guard (JWT + legacy)
  public.decorator.ts                                    # @Public() route exemption
api/src/modules/logging/
  logging.service.ts                                     # RequestLog persistence
  request-logging.interceptor.ts                         # Global request/response logging
api/src/modules/endpoint/
  endpoint.controller.ts                                 # Admin CRUD for endpoints
  endpoint.service.ts                                    # Endpoint business logic
api/src/modules/backup/backup.service.ts                 # Azure Blob snapshot backup (290 lines)
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
api/prisma/schema.prisma                                 # 5 models: Endpoint, ScimUser, ScimGroup, GroupMember, RequestLog
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
infra/blob-storage.bicep                                 # Backup storage
infra/networking.bicep                                   # VNet, subnets, private endpoints
infra/storage.bicep                                      # Storage account
```

### 3.4 Legacy Files

> `endpoint-scim.controller.ts` was **deleted** (Feb 2026). It was a monolithic controller superseded by the split into Users, Groups, and Discovery controllers.

---

## 4. Development Commands

```powershell
# From api/ directory:
npm run start:dev           # NestJS with --watch (hot reload)
npm run build               # TypeScript compilation to dist/
npm run start:prod          # Production mode
npm test                    # Run all 317 tests (Jest)
npm test -- --watch         # Watch mode
npm test -- --verbose       # Verbose output
npx prisma migrate dev      # Run migrations
npx prisma generate         # Regenerate Prisma client
npx prisma studio           # Visual DB browser

# From web/ directory:
npm run dev                 # Vite HMR dev server on :5173
npm run build               # Production build → api/public/

# Docker:
docker build -t scimtool -f Dockerfile .
docker-compose up           # Full stack
```

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
| DB Models | `PascalCase` | `ScimUser`, `ScimGroup`, `GroupMember` |

### 5.3 Data Storage Pattern

The project uses a **"rawPayload + derived columns"** pattern:
- `rawPayload`: Stores the FULL SCIM resource as a JSON string
- Derived columns (`userName`, `userNameLower`, `active`, `externalId`, `displayName`): Extracted for queries and uniqueness
- On read: `rawPayload` is parsed and enriched with server-managed fields (`id`, `meta`)
- On write: Full JSON is stored in `rawPayload`, derived columns are also updated

### 5.4 Endpoint Isolation Pattern

All SCIM resources are scoped to an `endpointId`:
- Routes: `/scim/endpoints/{endpointId}/Users`
- DB queries: Always include `WHERE endpointId = ?`
- Uniqueness: Composite unique constraints include `endpointId`
- Context: `EndpointContextStorage` (AsyncLocalStorage) propagates endpoint context

### 5.5 Authentication Pattern

**Dual-strategy auth** via global `SharedSecretGuard`:
1. OAuth 2.0 JWT (preferred) — `OAuthService.validateAccessToken()`
2. Legacy bearer token — direct string comparison with `SCIM_SHARED_SECRET`
3. Public routes exempted via `@Public()` decorator

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

---

## 6. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **SQLite** (not PostgreSQL) | Single-file DB perfect for ephemeral container with blob backup; no DB server needed |
| **rawPayload as JSON** | SCIM resources have arbitrary attributes; structured columns can't capture all; rawPayload preserves fidelity |
| **Derived columns** | Needed for uniqueness constraints and efficient filtering in SQLite |
| **userNameLower** column | RFC 7643 §2.1 requires case-insensitive userName uniqueness; SQLite lacks `CITEXT` |
| **AsyncLocalStorage** | Endpoint context propagation without threading endpoint ID through every method signature |
| **Blob snapshot backup** | Azure Container Apps have ephemeral storage; blob snapshots preserve data across restarts |
| **Dual auth** | OAuth for production clients (Entra); legacy token for simple testing/debugging |
| **Global prefix `/scim`** | All routes under `/scim/`; URL rewrite middleware supports `/scim/v2` for spec compliance |
| **In-memory filtering** | Filters are applied post-fetch; enables full SCIM filter expression support without SQL translation |

---

## 7. Current Compliance Status

### 7.1 SCIM 2.0 Compliance: ~80%

| Feature | Status |
|---------|--------|
| ✅ Users CRUD (POST/GET/PUT/PATCH/DELETE) | Complete |
| ✅ Groups CRUD (POST/GET/PUT/PATCH/DELETE) | Complete |
| ✅ PATCH: add/replace/remove all path types | Complete |
| ✅ Case-insensitive attributes/URIs/filters | Complete (RFC 7643 §2.1) |
| ✅ Discovery endpoints | Complete |
| ✅ Pagination (startIndex, count) | Complete |
| ✅ Filtering (eq operator) | Complete |
| ⚠️ Filtering (co, sw, ne, ew, gt, ge, lt, le) | Partial |
| ❌ Attribute projection (attributes/excludedAttributes) | Not implemented |
| ❌ Sorting (sortBy, sortOrder) | Not implemented (advertised as unsupported) |
| ❌ Bulk operations | Not implemented |
| ❌ ETag / If-Match | Not implemented |
| ❌ /Me endpoint | Not implemented |

### 7.2 Microsoft Entra ID Compatibility: ~90%

All critical Entra provisioning flows work:
- User create, update (PUT + PATCH), soft-delete (active=false), hard-delete
- Group create, update, member add/remove
- Filter by externalId and userName
- OAuth 2.0 client_credentials authentication

---

## 8. Test Coverage

- **317 tests** across **11 suites**, all passing
- Test runner: `npm test` from `api/` directory
- Key test files in `api/test/`:
  - User CRUD, Group CRUD, PATCH operations
  - Case-insensitivity (23 tests)
  - Filtering, pagination
  - Multi-endpoint isolation
  - Authentication flows
  - Discovery endpoints
  - Error handling

---

## 9. Session History & Completed Work

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
- Added `userNameLower` column + migration
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
2. **rawPayload is a JSON string** — always `JSON.parse()` before use, `JSON.stringify()` before save
3. **SQLite limitations** — no native `ILIKE`, no concurrent writes, no `CITEXT` — hence the `userNameLower` approach
4. **In-memory filtering** — ALL users/groups for an endpoint are loaded, then filtered in JS. This works for the monitoring use case (low volume) but wouldn't scale
5. **Backup depends on Azure** — `BackupService` silently skips if `BLOB_BACKUP_ACCOUNT` isn't set (local dev)
6. **Auto-generated secrets** — In dev mode, `SCIM_SHARED_SECRET` and `OAUTH_CLIENT_SECRET` are auto-generated and logged to console. NEVER do this in production.
7. **ValidationPipe whitelist: false** — We do NOT strip unknown properties, because SCIM resources have arbitrary attributes in extensions
8. **The `/scim/v2` rewrite** — Express middleware in `main.ts` rewrites `/scim/v2/*` to `/scim/*` for spec compliance

---

## 11. Quick Reference — Creating New Features

### Adding a new SCIM attribute to Users:
1. No schema change needed (stored in `rawPayload`)
2. If needed for queries/uniqueness: add derived column in `schema.prisma`
3. Update `formatUserResponse()` if special handling needed
4. Update `matchesFilter()` if it should be filterable
5. Add tests

### Adding a new endpoint config flag:
1. Add to `ENDPOINT_CONFIG_FLAGS` in `endpoint-config.interface.ts`
2. Add to `EndpointConfig` interface
3. Read via `getConfigBoolean()` or `getConfigString()` in service
4. Update `validateEndpointConfig()` if needed
5. Add tests

### Adding a new admin API route:
1. Add method to appropriate controller (`AdminController`, `DatabaseController`, etc.)
2. Add service method
3. Route is auto-prefixed with `/scim/admin/`
4. Authentication applied automatically (global guard)
5. Add tests

---

*This document should be the FIRST thing read at the start of any AI-assisted coding session.*
