# Changelog

All notable changes to SCIMServer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
