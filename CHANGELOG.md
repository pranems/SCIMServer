# Changelog

All notable changes to SCIMServer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.16.0] - 2026-02-24

### Added
- **Phase 7: ETag & Conditional Requests** — Version-based ETag concurrency control with pre-write If-Match enforcement (resolves G7 HIGH + G13 MEDIUM)
  - **Version-based ETags** — Changed ETag format from timestamp-based `W/"<ISO-8601>"` to monotonic `W/"v{N}"` using Prisma `version Int @default(1)` column; deterministic, collision-free
  - **Pre-write If-Match enforcement** — New `enforceIfMatch()` in both user and group services; checks *before* write (not post-write in interceptor); returns 412 `versionMismatch` on ETag mismatch
  - **RequireIfMatch config flag** — New per-endpoint boolean config `RequireIfMatch` (default `false`); when `true`, PATCH/PUT/DELETE without `If-Match` header returns 428 Precondition Required
  - **Atomic version increment** — Prisma repositories use `version: { increment: 1 }` for atomic DB-level version bumps; InMemory repositories use `(existing.version ?? 1) + 1`
  - **Simplified ETag interceptor** — Removed dead post-write If-Match block (was never enforcing); interceptor now only sets ETag header + handles If-None-Match→304 for conditional GET
- **24 new unit tests** — 13 user service (5 PATCH + 3 PUT + 3 DELETE + 2 ETag format), 11 group service (4 PATCH + 3 PUT + 3 DELETE + 1 ETag format)
- **17 new E2E tests** — Version-based ETag format (5), If-Match pre-write enforcement (7), RequireIfMatch config flag (5)
- **Phase 7 Documentation:** `docs/phases/PHASE_07_ETAG_CONDITIONAL_REQUESTS.md`

### Changed
- **Domain models** — Added `version: number` to `UserRecord` and `GroupRecord` interfaces
- **Prisma repositories** — `toUserRecord()`/`toGroupRecord()` now map `version`; `update()` and `updateGroupWithMembers()` include `version: { increment: 1 }`
- **InMemory repositories** — `create()` sets `version: 1`; `update()` increments version
- **User/Group services** — `buildMeta()` uses `W/"v${version}"` instead of `W/"${updatedAt.toISOString()}"`; PATCH/PUT/DELETE methods accept `ifMatch?: string` parameter
- **User/Group controllers** — Extract `req.headers['if-match']` and pass to service methods
- **ETag interceptor** — Simplified to read-side only (set ETag header + If-None-Match→304); JSDoc updated to note Phase 7 moved write-side enforcement to services
- **Endpoint config** — Added `REQUIRE_IF_MATCH` to `ENDPOINT_CONFIG_FLAGS`, interface, defaults, and validation

### Verified
- **1429/1429 unit tests passing** (52 suites) — up from 1405 (+24 new)
- **293/293 E2E tests passing** (18 suites) — up from 276 (+17 new)
- Build clean (TypeScript), zero compilation errors

## [0.15.0] - 2026-02-23

### Added
- **Soft / Hard Delete** — New `SoftDeleteEnabled` per-endpoint config flag (default `false`). When enabled, `DELETE /Users/{id}` and `DELETE /Groups/{id}` set `active=false` (soft-delete) instead of physical row removal
- **Strict Schema Validation** — New `StrictSchemaValidation` per-endpoint config flag (default `false`). When enabled, POST/PUT reject request bodies containing extension URN keys not declared in `schemas[]` or not registered in `ScimSchemaRegistry` (returns 400 `invalidSyntax` / `invalidValue`)
- **4 Microsoft Test Extension URNs** — Pre-registered globally in `ScimSchemaRegistry` for Microsoft Entra ID / SCIM Validator compatibility:
  - `urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User`
  - `urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group`
  - `urn:ietf:params:scim:schemas:extension:msfttest:User`
  - `urn:ietf:params:scim:schemas:extension:msfttest:Group`
- **Dynamic `schemas[]` in Group responses** — `toScimGroupResource()` now dynamically includes extension URNs present in `rawPayload`, matching User service behavior
- **107 new unit tests** — 33 config validation, 25 user service (soft delete + strict schema + GET/LIST/filter interactions + config flag combos), 21 group service (soft delete + strict schema + dynamic schemas + config flag combos), 14 user-patch-engine (soft-deleted state, valuePath patterns, dot-notation combos), 14 assertion updates across discovery specs
- **25 new E2E tests** — `soft-delete-flags.e2e-spec.ts`: SoftDeleteEnabled Users (6), Groups (3), PATCH on soft-deleted users (4), config flag combinations (5), StrictSchemaValidation (3), PATCH path patterns (4)
- **Feature documentation**: `docs/FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md`
- **Issues & root cause analysis**: `docs/ISSUES_BUGS_ROOT_CAUSE_ANALYSIS.md`

### Changed
- **Controllers pass config to services** — `createUser/Group`, `replaceUser/Group`, `deleteUser/Group` now receive `EndpointConfig` from controller
- **`GroupUpdateInput`** — Added `active?: boolean` field for soft-delete support
- **Schema counts** — Built-in schemas: 3→7 | User extensions: 1→3 | Group extensions: 0→2
- **`validateEndpointConfig()`** — Refactored to use `validateBooleanFlag()` helper for all 6 boolean flags
- **`ScimSchemaRegistry`** — Injects `ScimSchemaRegistry` into `EndpointScimGroupsService` for dynamic schema resolution

### Fixed
- **Live test Unicode parse errors** — Replaced em-dash (U+2014) and section sign (U+00A7) characters with ASCII equivalents; saved with UTF-8 BOM for PowerShell compatibility
- **Live test externalId logic bug** — Duplicate group `externalId` test used stale value after PATCH update; corrected to use current externalId
- **Prisma migration ordering** — Fixed P3018/P3009 by renaming migration directory timestamp and clearing failed migration state
- **Discovery E2E schema count assertions** — Updated `discovery-endpoints.e2e-spec.ts` from hardcoded 3/1 to `>=3`/`>=1` and find-by-schema lookup; fixes pre-existing failures caused by 4 custom extension URNs
- **`package.json` version stale in Docker** — Bumped from `0.13.0` to `0.15.0` in `api/package.json`; Docker image was reporting old version via `/admin/version`
- **Live test parameter name mismatch** — Script uses `-ClientSecret` not `-OAuthSecret`; previous invocations silently ignored wrong param name, causing OAuth to use default secret against Docker's different credential

### Verified
- **1405/1405 unit tests passing** (52 suites) — up from 1316 (+89 new)
- **276/276 E2E tests passing** (18 suites) — up from 251 (+25 new)
- **318/318 live integration tests passing** — up from 302
- Build clean (TypeScript), zero compilation errors
- Docker containers healthy (postgres:17-alpine + node:24-alpine)

## [0.14.0] - 2026-02-23

### Added
- **Data-Driven Discovery (Phase 6):** Centralized all SCIM discovery endpoints into injectable `ScimDiscoveryService`, replacing ~280 lines of hardcoded JSON across 4 controllers
  - `ScimDiscoveryService` — injectable service with `getSchemas()`, `getResourceTypes()`, `getServiceProviderConfig()`, `buildResourceSchemas()`
  - Rich RFC 7643 schema constants: User (17 attributes with subAttributes), Enterprise User Extension (6 attributes with complex manager), Group (3 attributes)
  - Enterprise User Extension schema added to `/Schemas` response (3 schemas, was 2)
  - Enterprise User schema extension declared on User ResourceType (`schemaExtensions`)
  - `meta` object added to ServiceProviderConfig response (RFC 7644 §4 SHOULD)
  - Centralized `KNOWN_EXTENSION_URNS` export in `scim-constants.ts`
- **36 new unit tests** for ScimDiscoveryService and updated controller specs
- **3 new E2E tests** for Enterprise User schema, extension on ResourceTypes, meta on ServiceProviderConfig
- **Phase 6 Documentation:** `docs/phases/PHASE_06_DATA_DRIVEN_DISCOVERY.md`

### Changed
- **Discovery controllers now thin delegates:** `SchemasController` (144→14 lines), `ResourceTypesController` (36→14), `ServiceProviderConfigController` (31→14), `EndpointScimDiscoveryController` (284→99)
- **Dynamic `schemas[]` in User responses:** Enterprise User extension URN included when enterprise data present in payload (G19 fix)
- **`scim-patch-path.ts`:** Uses centralized `KNOWN_EXTENSION_URNS` export instead of local constant (G16 fix)

### Removed
- **7 dead config flags** from `EndpointConfig`: `EXCLUDE_META`, `EXCLUDE_SCHEMAS`, `CUSTOM_SCHEMA_URN`, `INCLUDE_ENTERPRISE_SCHEMA`, `STRICT_MODE`, `LEGACY_MODE`, `CUSTOM_HEADERS` (G20 fix)

### Verified
- **1171/1171 unit tests passing** (47 suites) — up from 1135 (+36 new)
- **196/196 E2E tests passing** (15 suites) — up from 193 (+3 new)
- Build clean (TypeScript), zero compilation errors

## [0.13.0] - 2026-02-21

### Added
- **Domain-Layer PATCH Engine (Phase 5):** Extracted inline SCIM PATCH logic from NestJS services into standalone, pure-domain engine classes with zero framework dependencies
  - `UserPatchEngine` — static `apply()` handling all SCIM path types: simple attributes, valuePath expressions (`emails[type eq "work"].value`), extension URN paths, dot-notation, no-path bulk merge
  - `GroupPatchEngine` — static `apply()` handling replace/add/remove operations on members with config flag enforcement (`allowMultiMemberAdd`, `allowMultiMemberRemove`, `allowRemoveAllMembers`)
  - `PatchError` — domain-layer error class with `status` + `scimType` (no NestJS dependency); services catch and convert to `createScimError()`
  - `PatchConfig` / `GroupMemberPatchConfig` — typed interfaces for config flag passing from services to engines
  - Domain barrel export: `api/src/domain/patch/index.ts`
- **73 new unit tests:** 36 UserPatchEngine tests + 37 GroupPatchEngine tests covering all path types, operations, config flags, error handling, and utility methods
- **Phase 5 Documentation:** `docs/phases/PHASE_05_PATCH_ENGINE.md`

### Changed
- **`endpoint-scim-users.service.ts`:** Replaced ~200-line inline PATCH method + 6 helper methods with ~35-line `UserPatchEngine.apply()` delegation (~626 → ~415 lines, 34% reduction)
- **`endpoint-scim-groups.service.ts`:** Replaced inline operation loop + 5 helper methods (`handleReplace/Add/Remove`, `toMemberDto`, `ensureUniqueMembers`) with `GroupPatchEngine.apply()` delegation (~677 → ~465 lines, 31% reduction)
- **Services as thin orchestrators:** Load DB record → build state → delegate to engine → catch `PatchError` → save result

### Verified
- **984/984 unit tests passing** (29 suites) — up from 911 (+73 new PatchEngine tests)
- **193/193 E2E tests passing** (15 suites)
- Build clean (TypeScript), zero compilation errors
- Docker image built and tested (`scimserver:latest` v0.13.0)

---

## [0.12.0] - 2026-02-21

### Added
- **Filter Push-Down Expansion (Phase 4):** Full SCIM operator push-down to PostgreSQL for all 10 comparison operators on mapped columns
  - `co` (contains) → Prisma `contains` with `mode: 'insensitive'` — backed by `pg_trgm` GIN indexes
  - `sw` (starts with) → Prisma `startsWith` with `mode: 'insensitive'` — backed by `pg_trgm` GIN indexes
  - `ew` (ends with) → Prisma `endsWith` with `mode: 'insensitive'` — backed by `pg_trgm` GIN indexes
  - `ne` (not equal) → Prisma `{ not: value }`
  - `gt`/`ge`/`lt`/`le` → Prisma `{ gt/gte/lt/lte: value }`
  - `pr` (presence) → Prisma `{ not: null }` (IS NOT NULL)
- **Compound Filter Push-Down:** AND/OR logical expressions recursively pushed to DB via Prisma `AND`/`OR` arrays
- **Expanded Column Maps:** Added `displayName` (citext) and `active` (boolean) to User column map; added `active` to Group column map
- **Column Type Annotations:** Column maps now include type info (`citext`/`varchar`/`boolean`/`uuid`) for operator validation
- **Prisma Filter Evaluator:** New `prisma-filter-evaluator.ts` utility for InMemory repositories to evaluate Prisma-style WHERE clauses
- **Phase 4 Documentation:** `docs/phases/PHASE_04_FILTER_PUSH_DOWN.md`

### Changed
- **`apply-scim-filter.ts`:** Refactored from simple eq-only push-down to full operator + compound expression support
- **InMemory repositories:** Replaced manual equality loops with shared `matchesPrismaFilter()` evaluator for backend parity
- **Filter tests:** Updated to verify DB push-down for operators that previously fell back to in-memory
- **User `displayName` column population:** `displayName` now written as a first-class DB column on create, replace, and patch (fixes `displayName pr` filter returning 0 results)

### Verified
- **911/911 unit tests passing** (29 test suites)
- **193/193 E2E tests passing** (15 suites)
- **302/302 live tests passing** (Docker container against PostgreSQL 17)
- Build clean (TypeScript), Lint clean
- Docker image built and tested (`scimserver:latest` v0.12.0)

---

## [0.11.0] - 2026-02-20

### Added
- **PostgreSQL Migration (Phase 3):** Replaced SQLite (better-sqlite3) with PostgreSQL 17 as the persistence backend
  - `CITEXT` columns for native case-insensitive `userName`/`displayName` — eliminated `*Lower` mirror columns
  - `JSONB` payload storage — enables future GIN-indexed SCIM filter push-down
  - `UUID` primary keys via `pgcrypto` `gen_random_uuid()`
  - `TIMESTAMPTZ` for proper timezone-aware timestamps
  - PostgreSQL extensions: `citext`, `pgcrypto`, `pg_trgm`
- **Prisma 7 Driver Adapter:** `PrismaPg` adapter wrapping `pg.Pool` (replaces removed `datasourceUrl` constructor option)
- **Docker Compose:** Full local development stack — `postgres:17-alpine` + API container with healthchecks
- **InMemory Backend:** Standalone `PERSISTENCE_BACKEND=inmemory` for testing without any database
- **UUID Guard:** `isValidUuid()` validation preventing PostgreSQL P2007 errors on non-UUID lookups
- **SCIM ID Safety:** Triple-layer defense against client-supplied `id` leaking into responses (extractAdditionalAttributes, toScimUserResource, stripReservedAttributes)
- **False Positive Test Audit:** Comprehensive audit and fix of 29 false positive tests across all test levels
  - **8 E2E fixes:** tautological assertion, empty-loop skips, conditional guards, missing negative assertion, overly permissive assertion
  - **10 unit fixes:** weak `toBeDefined()` assertions strengthened to verify config values, no-assertion test fixed
  - **11 live fixes:** hardcoded `$true`, unguarded deletes, vacuously-true collection assertions, fallback `$true` branches
- **Fresh PostgreSQL Baseline Migration:** Single idempotent migration replacing 8 incremental SQLite migrations

### Changed
- **Version Endpoint Updated:** `GET /scim/admin/version` now reports `persistenceBackend`, `connectionPool`, `migratePhase`; removed blob backup fields
- **`package.json` dependencies:** Added `@prisma/adapter-pg`, `pg`, `@types/pg`; removed `@prisma/adapter-better-sqlite3`
- **Dockerfile:** Removed SQLite native build deps (`python3`, `make`, `g++`); keeps only `*.postgresql.*` WASM runtimes
- **All repositories:** Query unified `ScimResource` table with `resourceType` filter instead of separate `ScimUser`/`ScimGroup` tables
- **Services:** Removed all `userNameLower`/`displayNameLower` computation; CITEXT handles case-insensitivity natively
- **Version** bumped to 0.11.0

### Removed
- `better-sqlite3` and `@prisma/adapter-better-sqlite3` dependencies
- `userNameLower`, `displayNameLower` columns and all related code
- `rawPayload` TEXT column (replaced by `payload` JSONB)
- 8 incremental SQLite migrations (replaced by 1 PostgreSQL baseline)

### Verified
- **862/862 unit tests passing** (28 test suites)
- **193/193 e2e tests passing** (15 suites)
- **302/302 live tests passing** (local instance and Docker instance)
- Build clean (TypeScript), Lint clean
- Docker image built and tested against PostgreSQL 17-alpine container
- **False positive test audit:** 29 false positives identified and fixed (8 E2E, 10 unit, 11 live)
- **2026-02-21 re-validation:** Clean API rebuild, full E2E run, local live run, and fresh `scimserver:latest` Docker live run all green

---

## [0.10.0] - 2026-02-18

### Added
- **SSE Live Log Tailing** (`GET /scim/admin/log-config/stream`) — Real-time Server-Sent Events endpoint for remote log streaming with query filters (level, category, endpointId), 30s keep-alive pings, and auto-reconnect support
- **Log File Download** (`GET /scim/admin/log-config/download`) — Download ring buffer logs as NDJSON or JSON file with filters (level, category, requestId, endpointId, limit) and timestamped Content-Disposition filename
- **EventEmitter pub/sub in ScimLogger** — `subscribe()` method for real-time log entry streaming to SSE and other subscribers (max 50 concurrent)
- **Remote Log Script** (`scripts/remote-logs.ps1`) — PowerShell script with 4 modes: `tail` (colored SSE stream), `recent` (ring buffer query), `download` (save as file), `config` (view/update runtime config with quick level shortcuts)
- **Remote Debugging & Diagnosis Guide** (`docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md`) — Comprehensive guide with 14 sections covering all admin log endpoints, SSE protocol, Azure Container Apps access methods (5 methods), diagnosis workflows with Mermaid diagrams, log samples at every level, X-Request-Id correlation tracing, Postman/curl reference, and troubleshooting playbook
- **18 new unit tests** for SSE streaming (6 tests) and log download (7 tests) in LogConfigController, and EventEmitter subscribe (4 tests) in ScimLogger — total 134 passing in logging module

### Changed
- **Major Dependency Upgrade — Round 2:** Second comprehensive upgrade of the entire dependency stack
  - **Prisma** 6.19.2 → 7.4.0 (major ORM upgrade)
    - Migrated to `prisma-client` generator with output to `src/generated/prisma/`
    - Added `prisma.config.ts` with `defineConfig` for CLI configuration
    - Switched to `@prisma/adapter-better-sqlite3` driver adapter (Rust-free, faster)
    - Updated all import paths from `@prisma/client` to relative `generated/prisma/client`
  - **ESLint** 8.x → 10.0.0 (major linter upgrade)
    - Migrated from `.eslintrc.cjs` legacy config to `eslint.config.mjs` flat config
    - Fixed 9 new errors across 4 logging files (unused imports, redundant types, unsafe enum comparisons, unnecessary async)
  - **Jest** 29.x → 30.2.0 (major test framework upgrade)
  - **React** 18.3.1 → 19.2.4 (major frontend framework upgrade)
  - **Vite** 5.2.0 → 7.3.1 (major build tool upgrade)
  - **@vitejs/plugin-react** 4.2.1 → 5.1.4
  - **@types/react** 18.2.22 → 19.2.14, **@types/react-dom** 18.2.7 → 19.2.3
  - **typescript-eslint** 8.55.0 → 8.56.0
  - **NestJS** 11.1.13 → 11.1.14 (patch)
  - **dotenv** 17.2.4 → 17.3.1 (patch)
- **Docker:** All 6 Dockerfiles updated from `node:22-alpine` to `node:24-alpine`
  - Fixed Prisma 7 compatibility across all Dockerfile variants (prisma.config.ts preservation, generated client paths, driver adapter)
  - Fixed `Dockerfile.optimized`, `Dockerfile.ultra`, `api/Dockerfile.multi` which were broken for Prisma 7
  - Unified container port to 8080 across all variants
  - `docker-compose.debug.yml` updated to `node:24`
  - Added `effect/` preservation in node_modules cleanup (Prisma 7 internal dependency)
  - Removed `npm prune --production` from Dockerfiles needing prisma at runtime for `migrate deploy`
- **Node.js engine requirement** bumped from `>=22.0.0` to `>=24.0.0`
- **Version** bumped to 0.10.0 across api and web packages

### Verified
- **648/648 unit tests passing** (19 test suites)
- **177/177 e2e tests passing** (14 suites)
- **272/272 live integration tests passing** (local + Docker container)
- Build clean (TypeScript), Lint clean (ESLint 10, 0 errors)
- Docker image built and live-tested on `node:24-alpine`

---

## [0.9.1] - 2026-02-13

### Fixed
- **SCIM Validator 24/24:** Resolved the last remaining failure — "Filter for existing group with different case" — by adding a `displayNameLower` column to `ScimGroup` (mirrors existing `userNameLower` pattern on `ScimUser`)
- **Group PATCH transaction timeouts:** Moved member resolution (`scimUser.findMany`) outside `$transaction` in both PATCH and PUT group operations, reducing write-lock hold time
- **SQLite write-lock contention:** Buffered request logging (flush every 3s or 50 entries) eliminates per-request fire-and-forget writes competing for the single SQLite writer lock
- **`assertUniqueDisplayName` performance:** Refactored from O(N) `findMany` full-table scan to O(1) `findFirst` using the new `displayNameLower` indexed column
- **Live test script bug (Section 9k):** Fixed 7 occurrences in `scripts/live-test.ps1` where Per-Endpoint Log Level tests accessed `$response.config.endpointLevels` instead of `$response.endpointLevels` (GET `/scim/admin/log-config` returns properties at top level, not nested under `.config`)

### Added
- `displayNameLower` column on `ScimGroup` model with `@@unique([endpointId, displayNameLower])` composite constraint
- Migration `20260213064256_add_display_name_lower` with data backfill (`LOWER(displayName)` for existing rows)
- `displayname` mapped to `displayNameLower` in `GROUP_DB_COLUMNS` for DB-level push-down filtering (case-insensitive)
- `LoggingService` now implements `OnModuleDestroy` for graceful shutdown flush of buffered logs

### Changed
- Group filter `displayName eq "..."` now uses DB push-down instead of in-memory full-table scan (~10,000ms → ~250ms)
- `tryPushToDb` lowercases values for both `username` and `displayname` filter attributes
- All group write paths (create, PATCH, PUT) set `displayNameLower` on persistence

### Verified
- **648/648 unit tests passing** (19 test suites)
- 177/177 e2e tests passing (14 suites)
- 272/272 live integration tests passing
- **24/24 Microsoft SCIM Validator tests passing** (all non-preview) + 7 preview tests passing

---

## [0.9.0] - 2026-02-14

### Changed
- **Major Dependency Upgrade:** Comprehensive upgrade of the entire dependency stack
  - **NestJS** 10.4.22 → 11.1.13 (major framework upgrade)
  - **Prisma** 5.16.0 → 6.19.2 (ORM major version upgrade)
  - **TypeScript** 5.4.5 → 5.9.3 (compiler upgrade)
  - **Docker** all 5 Dockerfiles updated from node:18-alpine/node:20-alpine → node:22-alpine
  - **TypeScript targets** updated: API es2019→es2022, Web ES2020→ES2022
  - **@typescript-eslint** 7.8.0 → 8.55.0
  - **@types/node** → 25.2.3, **@types/jest** → 30.0.0, **@types/express** → 5.0.6
  - **supertest** → 7.2.2, **dotenv** → 17.2.4, **rxjs** → 7.8.2
  - **prettier** → 3.8.1, **ts-jest** → 29.4.6, **class-validator** → 0.14.3

### Fixed
- **NestJS 11 route breaking change:** Updated wildcard routes in `web.controller.ts` from `@Get('/assets/*')` to `@Get('/assets/*path')` with named parameters (path-to-regexp v8)
- **Docker Prisma 6 build fix:** Preserved `effect` package's internal testing directory during Docker cleanup step (required by Prisma 6 CLI)
- **Docker pruning fix:** Removed `npm prune --production` from Dockerfile since Prisma 6 CLI needs full dependency tree at runtime for `npx prisma migrate deploy`
- **ESLint config hardened for @typescript-eslint 8.x:** Updated `.eslintrc.cjs` with `no-unsafe-argument: off`, test-file overrides (`no-explicit-any`, `unbound-method`, `require-await` relaxed in `*.spec.ts`), and unused-var patterns (`_` prefix, `e` catch vars). Fixed 8 source-level lint errors: removed unused imports (`HttpStatus`, `UseGuards`, `Public`), fixed `setTimeout` misused-promise with void IIFE, removed unnecessary `async`, prefixed unused destructured vars. Result: **0 errors, 48 warnings** (all warnings are intentional `any` in SCIM payload handlers and test scaffolding vars).
- **fast-xml-parser vulnerability patched** via `npm audit fix` (transitive dep from Azure SDK)

### Verified
- 492/492 unit tests passing
- 154/154 e2e tests passing (13 suites)
- 212/212 live integration tests passing (23 sections, local + Docker)
- ESLint: 0 errors, 48 warnings (all non-blocking)

## [0.8.15] - 2025-11-22

### Changed
- Simplified `docs/COLLISION-TESTING-GUIDE.md` with a quick-start workflow for forcing Microsoft Entra to issue a SCIM `POST` and surface 409 collisions.
- Documented the Graph restart command and temporary matching precedence tweak needed to reproduce duplicate-user errors reliably.

## [0.8.14] - 2025-11-21

### Fixed
- **Critical Pagination Bug:** Fixed incorrect pagination counts and empty pages when "Hide Keepalive Requests" toggle is enabled
  - Backend now handles keepalive filtering before counting, ensuring accurate pagination metadata
  - Eliminated empty pages that occurred when all fetched logs were keepalive requests
  - Improved performance by replacing multi-page aggregation workaround with single backend query

### Changed
- Activity Feed (`/admin/activity`) now accepts optional `hideKeepalive` query parameter for backend-driven filtering
- Raw Logs endpoint (`/admin/logs`) now accepts optional `hideKeepalive` query parameter
- Simplified frontend code by removing ~50 lines of workaround logic in ActivityFeed.tsx and App.tsx
- Frontend now trusts backend pagination metadata completely

### Added
- Comprehensive test suite with 9 TDD test scenarios for keepalive filtering (activity.controller.spec.ts)
- Release notes documentation (RELEASE-NOTES-0.8.14.md)

### Technical Details
- Implemented Prisma WHERE clause with inverse keepalive logic for accurate filtering
- Backend filters: method != 'GET' OR identifier != null OR status >= 400 OR no filter parameter
- All tests passing - verified pagination accuracy across multiple scenarios

## [0.8.13] - 2025-10-28

### Fixed
- Direct update script environment variable handling
- Container restart automation when environment variables are updated

### Changed
- Improved direct update script to auto-provision JWT/OAuth secrets
- Enhanced deployment script to pass secrets to Container Apps via `--set-env-vars`

## [0.8.12] - 2025-10-28

### Fixed
- Direct update script environment configuration

## [0.8.11] - 2025-10-27

### Added
- Direct update script with auto-secrets provisioning and container restart

## [0.8.10] - 2025-10-27

### Security
- Runtime JWT/OAuth secret enforcement (no build-time secrets)

### Changed
- Azure deployment scripts now emit JWT & OAuth secrets and pass to Container Apps
- Development mode auto-generates secrets with warning logs

## [0.8.9] - 2025-10-20

### Fixed
- Activity feed pagination now aggregates multiple pages when hiding keepalive checks
- Page numbering remains intuitive even with keepalive filtering enabled

## [0.8.8] - 2025-10-20

### Added
- Keepalive suppression toggle in Activity Feed
- Activity summary metrics now exclude Entra ping checks

### Changed
- Raw log viewer can hide Entra keepalive GET pings with toggle and suppression banner

## [0.8.7] - 2025-10-05

### Added
- Manual provisioning UI for SCIM users and groups
- Blob snapshot bootstrap in Docker entrypoint (restores /tmp DB before migrations)

### Fixed
- Web UI upgrade helper now strips leading 'v' from version parameter

### Changed
- Deploy script now reuses existing VNet & DNS when already configured
- Setup script auto-registers Microsoft.App & Microsoft.ContainerService providers
- Networking template no longer pre-delegates subnets (consumption environment compatibility)
- Interactive prompt defaults to existing Container App name
- Bootstrap setup script auto-detects existing app/env names per resource group

## [0.8.6] - 2025-10-05

### Added
- Private storage endpoint rollout with VNet + DNS automation

## [0.8.5] - 2025-10-05

### Changed
- Version bump across API + Web + docs

## [0.8.4] - 2025-10-03

### Added
- Structured membership change data (addedMembers/removedMembers) in activity feed
- UI rendering for group membership changes

### Fixed
- PATCH operations now case-insensitive for better Entra compatibility

## [0.8.3] - 2025-10-02

### Added
- Unified image build (root Dockerfile ships API + Web)
- Token resilience: frontend clears bearer on 401 with modal guidance

## [0.8.2] - 2025-10-01

### Security
- Runtime token enforcement (no build-time secrets)

## [0.8.1] - 2025-09-30

### Added
- Hybrid storage architecture: local SQLite + timed Azure Files backups
- Backup route & persistence verification

### Fixed
- Environment / workload profile compatibility
- Timeout & PowerShell 5 compatibility issues

## [0.8.0] - 2025-09-28

### Added
- Favicon / activity badge system for new activity notifications

### Fixed
- PATCH Add operation for Entra compatibility

## [0.3.0] - 2025-09-27

### Added
- Full SCIM 2.0 compliance baseline
- Complete CRUD operations for Users and Groups
- ServiceProviderConfig and Schemas endpoints
- Real-time logging UI with search and filtering
- Bearer token + OAuth 2.0 authentication
- Dev tunnel integration for public HTTPS
- Microsoft Entra provisioning compatibility

---

## Version Format

SCIMServer follows semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR:** Incompatible API changes
- **MINOR:** Backward-compatible functionality additions
- **PATCH:** Backward-compatible bug fixes

## Links

- [Latest Release](https://github.com/pranems/SCIMServer/releases/latest)
- [All Releases](https://github.com/pranems/SCIMServer/releases)
- [Documentation](https://github.com/pranems/SCIMServer/blob/master/README.md)
