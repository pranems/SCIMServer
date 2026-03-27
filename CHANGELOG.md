# Changelog

All notable changes to SCIMServer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.30.0] - 2026-03-26

### Added — Admin Endpoint API Improvements

- **Envelope response**: `GET /admin/endpoints` returns `{ totalResults, endpoints[] }` instead of bare array
- **`?view=summary|full` query param**: summary (default for list) shows `profileSummary` digest; full (default for single-get) returns complete `profile`
- **`ProfileSummary` digest**: includes `schemaCount`, `schemas[]` (id, name, attributeCount), `resourceTypeCount`, `resourceTypes[]` (name, schema, extensions, extensionCount), `serviceProviderConfig` (boolean flags), `activeSettings` (non-default settings only)
- **`_links` (HATEOAS)**: every endpoint response includes `self`, `stats`, `credentials`, `scim` navigation links
- **`GET /admin/endpoints/presets`**: list all built-in presets with profile summaries
- **`GET /admin/endpoints/presets/:name`**: get full expanded preset profile (404 for unknown)
- **Nested stats format**: `users: { total, active, softDeleted }`, `groups: { total, active, softDeleted }`, `groupMembers: { total }`, `requestLogs: { total }` — replaces flat `totalUsers`/`totalGroups`/`totalGroupMembers`/`requestLogCount`
- **ISO 8601 string timestamps**: `createdAt`/`updatedAt` now explicit ISO 8601 strings (not Date objects)
- **`scimBasePath`**: renamed from `scimEndpoint` for clarity
- **Internal `CachedEndpoint` type**: separates internal cache (Date objects) from API response (ISO strings)
- **Static `buildProfileSummary()`**: reusable across endpoint & preset responses

### Added — Schema Cache Optimization + caseExact + Generic Filter Parity

- **Pre-flattened returned characteristic Sets** (`neverReturnedFlat`, `alwaysReturnedFlat`, `requestReturnedFlat`): Built once at cache time. Eliminates 9 redundant `flattenParentChildMap()` calls + Set allocations per request
- **Sub-attribute collision maps** (`neverReturnedSubs`, `requestReturnedSubs`): Parent-context-aware maps for sub-attrs with `returned:never`/`returned:request`. Prevents false positives when same-named sub-attrs across different parents have different returned values
- **caseExact-aware in-memory sorting** (GAP-CASEEXACT-1): `SortParams.caseExact` flag threaded through sort resolve functions, repo interfaces, and all 3 in-memory repo sort comparators. Case-insensitive sort when `caseExact=false`, ordinal when `true`
- **caseExact-aware PATCH value filter** (GAP-CASEEXACT-2): `matchesFilter()` accepts `caseExact` param. `UserPatchEngine` resolves caseExact from `PatchConfig.caseExactPaths` for value filter matching
- **Generic resource full filter operators** (G6): Replaced regex `eq`-only `parseSimpleFilter()` with `buildGenericFilter()` using full AST-based parser. All 10 SCIM operators (eq/ne/co/sw/ew/gt/ge/lt/le/pr) + AND/OR compounds. DB push-down for `displayName`/`externalId`/`id`; in-memory fallback for custom attributes
- **Generic service readOnly cache wiring** (C2): `stripReadOnlyAttributes`/`stripReadOnlyPatchOps` pass `preCollected` from cache. Eliminates per-request `collectReadOnlyAttributes()` tree walk
- **Generic service extensionUrns fix** (C1): `getSchemaCacheForRT()` passes `resourceType.schemaExtensions` to `buildCharacteristicsCache()`
- **Consolidated `getExtensionUrns()`** (M1): Removed redundant `getEndpointExtensionUrns()`. `enforceStrictSchemaValidation` now uses cache-first `getExtensionUrns()`

### Removed

- **`getBooleanKeys()`** — deprecated flat boolean collector on `ScimSchemaHelpers` (superseded by `getBooleansByParent()`)
- **`coerceBooleanStringsIfEnabled()`** — deprecated flat coercer on `ScimSchemaHelpers` (superseded by `coerceBooleansByParentIfEnabled()`)
- **`sanitizeBooleanStrings()`** — flat exported function (superseded by `sanitizeBooleanStringsByParent()`)
- **`collectBooleanAttributeNames()`** — static method on `SchemaValidator` (superseded by `booleansByParent` cache field)
- **`parseSimpleFilter()`** — regex-based eq-only filter parser on generic service (replaced by `buildGenericFilter()`)

### Changed

- **`SchemaCharacteristicsCache`**: 14 → 19 fields. Added 5 new: `neverReturnedSubs`, `requestReturnedSubs`, `neverReturnedFlat`, `alwaysReturnedFlat`, `requestReturnedFlat`
- **`PatchConfig`**: New `caseExactPaths?: Set<string>` field for caseExact value filter matching
- **`SortParams`**: New `caseExact: boolean` field for schema-driven sort comparison
- **Repository interfaces**: `orderBy` parameter gains `caseExact?: boolean`
- **In-memory generic repo**: Uses `matchesPrismaFilter()` instead of manual key-value loop
- **Generic `listResources`**: Converts all records to SCIM resources before in-memory filter, supporting full attribute-path evaluation
- **`getReturnedCharacteristics()`**: Returns pre-built flat Sets from cache + `neverSubs`/`requestSubs` maps

### Test Results

- **Unit tests**: 3,061 passed (74 suites)
- **E2E tests**: 817 (37 suites)
- **Live tests**: ~951 assertions (main) + 112 Lexmark
- **Total**: ~4,941 tests

## [0.29.0] - 2026-03-17

### Added — Precomputed Schema Characteristics Cache (2026-03-20)

- **`SchemaCharacteristicsCache` interface** (`validation-types.ts`): 10 Parent→Children `Map<string, Set<string>>` maps for zero per-request schema tree recomputation
- **`SchemaValidator.buildCharacteristicsCache()`**: Single tree walk produces all 10 maps (~25 µs). Eliminates 2–9 redundant tree walks per request (40–180 µs saved per request)
- **`sanitizeBooleanStringsByParent()`**: Parent-context-aware boolean string coercion. Prevents name-collision false positives (e.g., core `active` boolean vs extension `active` string)
- **`ScimSchemaHelpers` cache accessors**: `getBooleansByParent()`, `getNeverReturnedByParent()`, `getReadOnlyByParent()`, `getUniqueAttributesCached()`, `coerceBooleansByParentIfEnabled()`
- **Lazy cache builder**: `getSchemaCache()` builds from schema definitions on first access per endpoint, attaches to profile for subsequent O(1) reads
- **25 cache builder unit tests** (`schema-validator-cache.spec.ts`): Name-collision disambiguation, extension URN handling, all 10 map types, empty schemas
- **11 parent-aware sanitizer tests** (`scim-service-helpers.spec.ts`): Parent-key coercion, extension URN isolation, array recursion
- **Analysis document**: [SCHEMA_AND_RESOURCETYPE_DATA_STRUCTURE_ANALYSIS.md](docs/SCHEMA_AND_RESOURCETYPE_DATA_STRUCTURE_ANALYSIS.md) — 6 data structure options, benchmarks, industry norms, recommendation
- **12 production files changed** (+527/−57 lines): validation-types.ts, schema-validator.ts, index.ts, endpoint.service.ts, scim-service-helpers.ts, endpoint-profile.service.ts, endpoint-profile.types.ts, endpoint-scim-users.service.ts, endpoint-scim-groups.service.ts, endpoint-scim-generic.service.ts
- **Test results**: 2,923 unit (73 suites) / 763 E2E (35 suites) / 602 live + 112 Lexmark — all passing

### Added — Lexmark ISV Endpoint Profile

- **Lexmark preset** (`lexmark.json`): User-only provisioning with EnterpriseUser (required, costCenter/department) and CustomUser (optional, badgeCode/pin — writeOnly/returned:never)
- **Lexmark E2E tests** (`lexmark-isv.e2e-spec.ts`): 46 tests covering endpoint creation, discovery, CRUD, extensions, writeOnly filtering, PATCH, PUT, filtering, user-only isolation, edge cases
- **Lexmark live tests** (`scripts/lexmark-live-test.ps1`): 112 tests across 13 sections — standalone ISV-specific live test script
- **Built-in presets**: 5 → 6 (added `lexmark`)
- **Unit test updates**: built-in-presets.spec.ts updated with 9 new Lexmark tests, preset count/matrix assertions

### Documentation — Full Refresh

- **README.md**: Complete rewrite with architecture diagrams (Mermaid ER + sequence), compliance matrix, quick start (4 options), environment variables, testing section, repo structure
- **COMPLETE_API_REFERENCE.md**: Recreated with every endpoint, request/response examples, error codes, query parameters, headers
- **INDEX.md**: Updated with accurate test counts (72 unit/2,884, 34 E2E/743, live/621, Lexmark/112)
- **PROJECT_HEALTH_AND_STATS.md**: Fresh LoC metrics (58,891 source, 12,711 test), architecture diagram, full preset table
- **Example JSONs**: Recreated `user.json`, `group.json`, `serviceproviderconfig.json`, `patch-operations.json`, `search-request.json`; added `bulk-request.json`, `error-responses.json`, `endpoint/create-endpoint.json`

### Fixed — 19 Test Failures (URN dot-split, profile-aware schema, Content-Type 415 middleware)

Resolved all remaining test failures from the v0.28.0 profile migration:

- **URN dot-split fix**: Schema URN parsing now correctly handles dot-notation attribute paths within URN-scoped PATCH operations
- **Profile-aware schema validation**: `SchemaValidator` and discovery controllers serve per-endpoint schema definitions from the cached `EndpointProfile` (not stale registry overlays)
- **Content-Type 415 middleware**: Added global middleware that rejects unsupported `Content-Type` headers with proper SCIM 415 error responses

### Fixed — RFC 7643 §4.1 Schema Completeness

- Added 4 missing attributes to `USER_SCHEMA_ATTRIBUTES`: `ims`, `photos`, `entitlements`, `x509Certificates` (20→24, now 100% RFC §4.1)
- Added 6 missing attributes to entra-id User schema: `nickName`, `profileUrl`, `userType`, `ims`, `photos`, `entitlements`
- Microsoft SCIM Validator now passes 25/25 required + 7/7 preview with `StrictSchemaValidation=True`

### Removed — Legacy `endpoint.config` Admin API Field

- The `config` field on endpoint create/update API payloads has been **permanently removed**
- `profile: { settings: { ... } }` is the sole input for per-endpoint boolean flags

### Added — JSON File-Backed Presets with Hot-Reload

- 5 preset JSON files in `api/presets/` with fully expanded RFC attribute definitions (no abbreviations)
- `POST /admin/profile-presets/reload` endpoint for hot-reloading presets without server restart
- Deep validation of JSON presets at load/reload (20+ checks per preset)
- Hardcoded fallback when JSON files are missing or invalid
- `PRESETS_DIR` env var override for custom preset locations
- Custom preset auto-discovery (drop `*.json` in presets folder)

### Added — Entra-ID Preset Default Settings

- entra-id preset now includes 5 Entra-compatible settings: `AllowAndCoerceBooleanStrings`, `MultiOpPatchRequestAddMultipleMembersToGroup/RemoveMultipleMembersFromGroup`, `PatchOpAllowRemoveAllMembers`, `VerbosePatchSupported`
- `StrictSchemaValidation` and `SoftDeleteEnabled` are opt-in per-endpoint (not default)

### Added — Comprehensive Preset Tests

- 36 unit tests for `validatePreset()`, `loadPresetsFromDisk()`, `reloadPresetsFromDisk()`, `getPresetsDir()`, JSON completeness
- 11 E2E tests for preset list, detail, 404, reload, and endpoint creation after reload
- 15 live tests (section 9z-B) for preset reload API

### Changed — Documentation Rewrite

- Reorganized docs: 51 active docs + 35 archived to `docs/archive/`
- Moved 22 stale test JSON artifacts to `api/test-artifacts/`
- Rewrote `docs/INDEX.md` with categorized sections
- Version sweep: 0.28.0→0.29.0 across all docs and prompts
- Dockerfile now includes `presets/` directory in production image
- GHCR image: `ghcr.io/pranems/scimserver:0.29.0`

### Test Coverage
- **Unit tests**: 2,887 passed (72 suites)
- **E2E tests**: 763 passed (35 suites)
- **Live tests**: 621 assertions
- **Deployment verification**: Local (15.5s) + Docker (18.6s) + Azure (38s) — all 621/621

---

## [0.28.0] - 2026-03-12

### Added — Phase 13: Endpoint Profile Configuration

Replaces the fragmented `Endpoint.config` + `EndpointSchema` + `EndpointResourceType` model with a unified `Endpoint.profile` JSONB column containing RFC-native SCIM discovery format (schemas, resourceTypes, serviceProviderConfig) plus project-specific settings.

#### New Module: `src/modules/scim/endpoint-profile/`
- **endpoint-profile.types.ts**: `EndpointProfile`, `ProfileSettings`, `ServiceProviderConfig`, `ShorthandProfileInput`, `BuiltInPreset` interfaces (7 types)
- **rfc-baseline.ts**: RFC 7643 §4.1/§4.2/§4.3 attribute re-exports, O(1) lookup maps, required attribute lists, project auto-inject constants
- **built-in-presets.ts**: 5 frozen presets (`entra-id` default, `entra-id-minimal`, `rfc-standard`, `minimal`, `user-only`), `getBuiltInPreset()`, `getAllPresetMetadata()`
- **auto-expand.service.ts**: `expandProfile()` — shorthand → full RFC expansion with `"attributes": "all"` support
- **tighten-only-validator.ts**: `validateAttributeTightenOnly()` — rejects loosening of `required`, `mutability`, `uniqueness`, `type`, `multiValued`
- **endpoint-profile.service.ts**: `validateAndExpandProfile()` — 6-step pipeline: auto-expand → auto-inject → tighten-only → SPC truthfulness → structural → result
- **preset.controller.ts**: `GET /admin/profile-presets` (list), `GET /admin/profile-presets/:name` (detail) — read-only

#### New API: Preset API
- `GET /admin/profile-presets` — list all 5 built-in presets (name + description + default flag)
- `GET /admin/profile-presets/:name` — full expanded EndpointProfile for a preset

#### Endpoint Creation Changes
- `POST /admin/endpoints` now accepts `profilePreset` (e.g., `"entra-id"`) or inline `profile` (mutually exclusive)
- Default: `entra-id` preset when neither is provided (decision D5)
- Backward compat: old `config` field maps to `profile.settings` with `validateEndpointConfig()` validation

#### Prisma Schema Migration
- `20260313_add_endpoint_profile`: DROP `config` column, ADD `profile` JSONB, DROP `EndpointSchema` + `EndpointResourceType` tables
- Models: 7 → 5 (Endpoint, RequestLog, ScimResource, ResourceMember, EndpointCredential)

### Removed
- **AdminSchemaController**: `POST/GET/DELETE /admin/endpoints/:id/schemas` (3 routes) — schemas now inline in `profile.schemas[]`
- **AdminResourceTypeController**: `POST/GET/DELETE /admin/endpoints/:id/resource-types` (3 routes) — resource types now inline in `profile.resourceTypes[]`
- **EndpointSchema** Prisma model + DB table
- **EndpointResourceType** Prisma model + DB table
- **Repository layer**: `IEndpointSchemaRepository`, `IEndpointResourceTypeRepository` + 4 implementations (Prisma + InMemory) + specs
- **DTOs**: `CreateEndpointSchemaDto`, `CreateEndpointResourceTypeDto` + specs
- **Domain model**: `EndpointSchemaRecord`
- **Repository tokens**: `ENDPOINT_SCHEMA_REPOSITORY`, `ENDPOINT_RESOURCE_TYPE_REPOSITORY`
- **E2E tests**: `admin-schema.e2e-spec.ts`, `custom-resource-types.e2e-spec.ts`, `immutable-enforcement.e2e-spec.ts`, `returned-request.e2e-spec.ts`, `generic-parity-fixes.e2e-spec.ts` (tested removed APIs)

### Changed
- **ScimSchemaRegistry**: Profile hydration via `bootHydrate()` + `hydrateFromProfile()` — per-endpoint overlay with `isFullProfile` flag; query methods (`getAllSchemas`, `getAllResourceTypes`, `getSchema`, `getServiceProviderConfig`) return profile data directly for hydrated endpoints; no infrastructure dependencies (PrismaService-free)
- **ScimModule**: `onModuleInit` performs boot hydration via `EndpointService.listEndpoints()` → `SchemaRegistry.bootHydrate()` and wires runtime change listener for endpoint CRUD
- **EndpointService**: `setProfileChangeListener()` + `ProfileChangeListener` callback type; all create/update/delete operations notify listener for registry rehydration
- **ScimDiscoveryService**: `getServiceProviderConfig()` now accepts optional `endpointId` for profile-based SPC lookup
- **EndpointScimDiscoveryController**: passes `endpointId` to `getServiceProviderConfig()` for profile-aware SPC responses
- **repository.module.ts**: Removed EndpointSchema + EndpointResourceType providers/exports
- **scim.module.ts**: Removed old admin controllers, added `PresetController`, added `EndpointService` + `ScimSchemaRegistry` injection for boot hydration
- **E2E helpers**: `global-teardown.ts`, `db.helper.ts` — removed `endpointSchema.deleteMany()`

### Test Coverage
- **Unit tests**: 2,830 passed (73 suites)
- **E2E tests**: 613 passed + 6 skipped (30 suites) — +5 new gap-audit tests (bulk+strict combo, user-only blocks Groups, cache invalidation)
- **Live tests**: 832 assertions — +21 new (Section 9z: Endpoint Profiles & Preset Discovery)

### Phase 14 — Profile-as-Cached-Runtime-Context
- **ScimSchemaRegistry**: Gutted from 857→143 lines. Removed overlays, boot hydration, registration methods, global layer. Kept: root-level default preset expansion + type exports.
- **EndpointService**: Unified `cacheById` + `cacheByName` Maps replace per-request DB queries. Cache warm on boot, write-through on CRUD.
- **Discovery**: Endpoint-scoped controllers serve from `profile` directly (not registry overlays). Profile-based `getSchemasFromProfile`/`getResourceTypesFromProfile`/`getSpcFromProfile`.
- **Derived flags**: `CustomResourceTypesEnabled` derived from `profile.resourceTypes` (D9). `BulkOperationsEnabled` derived from `profile.serviceProviderConfig.bulk.supported` (D8).
- **ScimModule**: Removed `OnModuleInit` boot hydration + listener wiring — cache replaces this.
- **Impact**: Zero DB calls per SCIM request, 3 caches → 1, ~500 net lines removed.

### Design Document
- `docs/SCHEMA_TEMPLATES_DESIGN.md` updated — §18 Phase 14 roadmap, registry simplification noted

## [0.27.0] - 2026-03-03

### Fixed — Generic Service Parity (3 P0 Gaps Resolved)

Closed the top 3 remaining P0 gaps from the P3 re-audit delta, bringing Generic custom-resource service behavior in line with Users/Groups.

- **Fix #1 — RequireIfMatch 428 parity**: Generic PUT/PATCH/DELETE now call `enforceIfMatch()` instead of `assertIfMatch()`, honoring the `RequireIfMatch` config flag to return 428 when the `If-Match` header is missing. Previously only Users/Groups enforced this.
- **Fix #2 — Filter attribute path validation wired**: `SchemaValidator.validateFilterAttributePaths()` is now integrated into runtime filter paths for Users (`listUsersForEndpoint`), Groups (`listGroupsForEndpoint`), and Generic (`listResources`). Unknown filter attribute paths now return 400 `invalidFilter` instead of silently passing.
- **Fix #3 — Generic filter 400 on unsupported expressions**: `parseSimpleFilter()` now throws 400 `invalidFilter` for unsupported filter operators/attributes instead of silently returning `undefined` (which caused unfiltered results to be returned).

### Fixed — InMemory Backend Compatibility (4 Bugs)

Discovered and fixed during live testing with `PERSISTENCE_BACKEND=inmemory`:

- **Bug #1 — AdminSchemaController inmemory incompatibility**: Controller used `PrismaService.endpoint.findUnique()` directly, which returns null for inmemory. Fixed by switching to `EndpointService.getEndpoint()` with `requireEndpoint()` helper.
- **Bug #2 — Custom resource types missing core schema definition**: Registering a custom resource type created no schema definition for the core schema URN. Fixed by auto-generating a stub core schema (id/externalId/displayName/active) in `ScimSchemaRegistry.registerResourceType()`.
- **Bug #3 — SchemaValidator hardcoded core schema prefix**: `SchemaValidator` used `schema.id.startsWith('urn:ietf:params:scim:schemas:core:')` to classify core vs extension schemas. Custom resource types with non-standard URNs were misclassified as extensions, causing `displayName` at top level to be rejected. Fixed by adding `isCoreSchema?: boolean` flag to `SchemaDefinition` and a module-level `isCoreSchema()` helper function. 5 locations in `schema-validator.ts` updated.
- **Bug #4 — RepositoryModule duplicate inmemory instances**: `RepositoryModule.register()` called from both `AuthModule` and `ScimModule` created separate `InMemoryEndpointCredentialRepository` instances with separate `Map` stores. Admin writes to one, guard reads from another. Fixed by adding static module caching with backend-aware cache invalidation.

### Fixed — Live Test Script
- **excludedAttributes type**: Test 9x.15 sent `excludedAttributes` as an array instead of a string, causing 400 error and script crash.

### Test Coverage
- **Unit tests**: 2,741 passed (73 suites) — +24 new (3 RequireIfMatch 428, 2 filter error, 6 validateFilterPaths, 9 generic service, 1 users service, 1 groups service, 2 scim-service-helpers[strict])
- **E2E tests**: 651 passed (32 suites) — +15 new (10 generic-parity-fixes + 5 generic-parity-fixes[Groups filter, RequireIfMatch 428, DELETE If-Match])
- **Live tests**: 659 total (647 passed, 12 failed) — +11 new in section 9y. 12 pre-existing feature gaps: content-type negotiation (415), collection methods (404/405), immutable enforcement, uniqueness collision (409), required field enforcement.
- **Live test parity**: All 3 deployment types (local inmemory, Docker Prisma, Azure Prisma) produce identical results: 647/12/659.

## [0.26.0] - 2026-03-03

### Added — Attribute Characteristics E2E Gap Closure (19 new E2E + 16 new live)

Comprehensive gap audit of all 31 E2E test files against RFC 7643 §2 attribute characteristics matrix. Identified and filled 6 specific coverage gaps across uniqueness, required, and returned characteristics.

- **user-uniqueness-required.e2e-spec.ts** (10 tests): User `uniqueness:server` 409 on PUT (userName + externalId conflict + self-update allowed + case-insensitive collision), User `uniqueness:server` 409 on PATCH (userName + externalId + mutable field allowed), `required:true` on PUT (missing userName → 400, all required present → 200).
- **returned-request.e2e-spec.ts** (+9 tests, 18 total): `returned:request` on PATCH response (stripped by default, included with `?attributes=`), returned characteristics on `.search` (returned:request stripped, returned:default present, returned:always present, attributes= includes returned:request, excludedAttributes cannot remove returned:always, excludedAttributes strips returned:default, excludedAttributes=id cannot remove id).
- **Section 9x live tests** (16 tests): User PUT/PATCH uniqueness 409, required:true on PUT 400, returned:never on PATCH response, returned characteristics on `.search` (never/always/excludedAttributes protection).

### Test Coverage
- **Unit tests**: 2,717 passed (73 suites) — unchanged
- **E2E tests**: 636 passed (33 suites) — +19 new (10 user-uniqueness-required + 9 returned-request)
- **Live tests**: 570 passed — +16 new in section 9x

## [0.25.0] - 2026-03-03

### Bug Fixes — P3 Implementation & Projection

- **findConflict soft-delete bug**: Fixed `findConflict()` in `endpoint-scim-generic.service.ts` — previously filtered out soft-deleted records with `!conflict.deletedAt`, making the reprovision code path unreachable. Fix: removed the filter from `findConflict()` (returns ALL conflicts), added `&& !conflict.deletedAt` guards to PUT/PATCH callers only. CREATE caller already handled both cases correctly.
- **excludeAttrs URN handling**: Fixed `excludeAttrs()` in `scim-attribute-projection.ts` — lacked URN-prefixed attribute path handling (unlike `includeOnly()` which already had it). `excludedAttributes=urn:ext:2.0:department` broke on the dot in "2.0". Now correctly resolves URN resource keys as prefixes for sub-attribute exclusion, matching RFC 7644 §3.10.
- **excludeAttrs always-returned sub-attrs**: Added `alwaysReturned.has(subAttr)` check in URN exclusion path to prevent stripping `returned:always` attributes from extension objects via `excludedAttributes`.

### Added — P3 E2E Tests (32 new)

Three new E2E test files covering previously-untested RFC compliance gaps:

- **http-error-codes.e2e-spec.ts** (13 tests): HTTP 415 Unsupported Media Type (text/xml, text/plain, text/html, application/xml rejected; application/json and application/scim+json accepted), HTTP 405 Method Not Allowed (POST/PUT/PATCH/DELETE on collections or specific IDs where not allowed), SCIM error response format compliance.
- **returned-request.e2e-spec.ts** (9 tests): `returned:request` attributes stripped from GET/LIST/POST/PUT default responses, included when explicitly requested via `?attributes=`. `returned:default` attributes excludable via `?excludedAttributes=` with URN prefix. `returned:always` attributes persist through `excludedAttributes`.
- **immutable-enforcement.e2e-spec.ts** (10 tests): Immutable attribute enforcement on User extension (POST accepts, PUT rejects change, PUT allows same value, PATCH rejects change, PATCH allows mutable, GET verifies). Group `members.$ref` schema immutability. Custom resource type Device with immutable `serialNumber` (POST/PUT).

### Added — P3 Live Tests (19 new)

- **Section 9w**: HTTP 415 (4 tests), HTTP 405 (4 tests), Immutable enforcement via enterprise extension employeeNumber (6 tests), returned:never/always/default behavioral verification (5 tests).

### Added — P3 Unit Tests (2 new)

- **scim-attribute-projection.spec.ts**: URN-prefixed sub-attribute exclusion test, entire URN extension exclusion test.

### Test Coverage
- **Unit tests**: 2,717 passed (73 suites) — +2 new projection URN tests
- **E2E tests**: 617 passed (30 suites) — +32 new (13 http-error-codes + 9 returned-request + 10 immutable-enforcement)
- **Live tests**: 554 passed — +19 new in section 9w (HTTP 415/405, immutable enforcement, returned characteristics)

## [0.24.0] - 2026-03-01

### Added — P2 Attribute Characteristics (RFC 7643 §2)

Six P2 behavioral gap fixes from the RFC 7643 §2 attribute characteristics audit:

- **R-RET-1**: Schema-driven `returned:'always'` at projection level — attributes marked `returned:'always'` in schema definitions are now always included in responses, immune to `attributes=` filtering and `excludedAttributes=` exclusion.
- **R-RET-2**: Group `active` always returned — the Group schema's `active` attribute (returned:'always') is now preserved in all Group responses regardless of projection parameters.
- **R-RET-3**: Sub-attribute `returned:'always'` enforcement — sub-attributes like `emails.value` and `members.value` with returned:'always' are now included even when only sibling sub-attributes are requested (e.g., `?attributes=emails.type` now includes `emails.value`).
- **R-MUT-1**: `writeOnly` mutability → `returned:never` defense-in-depth — attributes with `mutability:'writeOnly'` are now also added to the `never` set in `collectReturnedCharacteristics()`, ensuring they never appear in responses even if `returned` is not explicitly `'never'`.
- **R-MUT-2**: readOnly sub-attribute stripping — `stripReadOnlyAttributes()` and `stripReadOnlyPatchOps()` now strip readOnly sub-attributes within readWrite parents (e.g., `manager.displayName`) on POST/PUT/PATCH, per RFC 7643 §2.2. Covers core and extension schemas, single-valued and multi-valued complex attributes.
- **R-CASE-1**: caseExact-aware in-memory filter evaluation — `evaluateFilter()` now accepts an optional `caseExactAttrs` set and performs case-sensitive comparisons for attributes with `caseExact:true` (e.g., `id`, `externalId`, `meta.location`). Non-caseExact attributes remain case-insensitive per SCIM default.

### Bug Fixes — Live Test Script
- **URL prefix fix**: 4 test base URLs in section 9t (tests 9t.5–9t.9) used `$baseUrl/endpoints/$id` instead of `$baseUrl/scim/endpoints/$id`, causing a 404 crash that silently skipped all subsequent tests. Fixed by adding the `/scim/` prefix.
- **PowerShell escaping fix**: Nested `[Uri]::EscapeDataString()` inside double-quoted strings in section 9v (tests 9v.12–9v.13) caused parser errors. Refactored to use intermediate variables.
- **Live test count**: Corrected from 498 → **535** (37 tests were always in the script but never ran due to the 9t.5 crash).

### Test Coverage
- **Unit tests**: 2,682 passed (73 suites) — +34 new P2 tests, +108 test gap audit
- **E2E tests**: 585 passed (27 suites) — +13 new P2 E2E tests, +27 test gap audit
- **Live tests**: 535 passed — Section 9v added with 13 tests covering all 6 P2 items; 37 previously-skipped tests in 9t/9u/9v now executing after URL prefix fix

### Files Modified
- `schema-validator.ts` — R-MUT-1 (writeOnly→never), R-MUT-2 (collectReadOnlyAttributes sub-attrs), R-RET-3 (alwaysSubs), R-CASE-1 (collectCaseExactAttributes)
- `scim-attribute-projection.ts` — R-RET-1 (schema always), R-RET-2 (Group active), R-RET-3 (sub-attr always in projection including multi-valued)
- `scim-service-helpers.ts` — R-RET-1/R-RET-3 (expose always sets/maps), R-MUT-2 (strip readOnly sub-attrs on POST/PUT/PATCH), R-CASE-1 (getCaseExactAttributes)
- `scim-filter-parser.ts` — R-CASE-1 (caseExact param in compareValues + evaluateFilter)
- `apply-scim-filter.ts` — R-CASE-1 (caseExactAttrs pass-through)
- All 3 controllers + 2 services — R-RET-1/R-RET-3 (pass always sets + alwaysSubs), R-CASE-1 (pass caseExactAttrs to filter)

## [0.23.0] - 2026-03-01

### Removed — Blob/BackupService Dead Code Elimination
- **`BackupModule` + `BackupService` deleted** — `api/src/modules/backup/` directory removed entirely. The SQLite-era blob snapshot backup/restore system is no longer needed now that the persistence layer is PostgreSQL 17 (Azure Managed Disks + Azure-managed PITR backup).
- **`blob-restore.ts` deleted** — `api/src/bootstrap/blob-restore.ts` startup restore hook removed (was a no-op since PostgreSQL migration).
- **`@azure/identity` uninstalled** — Azure SDK identity package removed from `api/package.json` (was only used by `BackupService`).
- **`@azure/storage-blob` uninstalled** — Azure SDK blob storage package removed from `api/package.json`.
- **`infra/blob-storage.bicep` deleted** — Azure Blob Storage + private endpoint Bicep module removed.
- **`infra/networking.bicep`** — Removed blob storage DNS private zone and VNet link.
- **`infra/containerapp.bicep`** — Removed `BLOB_BACKUP_ACCOUNT`, `BLOB_BACKUP_CONTAINER`, `BLOB_BACKUP_INTERVAL_MIN` environment variable injections.
- **`docker-compose.yml`** — Removed all `BLOB_BACKUP_*` env vars from local dev compose file.
- **`LogCategory.BACKUP` enum value deleted** — `api/src/modules/logging/log-levels.ts` no longer exports `BACKUP` log category; corresponding unit assertion removed.
- **`AppModule`** — `BackupModule` import removed.

### Changed
- **`scripts/deploy-azure.ps1`** — Removed `-BlobBackupAccount`, `-BlobBackupContainer`, `-BlobBackupIntervalMin` parameters; removed step 4 (blob RBAC assignment); deployment now a clean 5-step flow: Resource Group → PostgreSQL → ACR → Container App Environment → Container App.
- **`DATABASE_URL` env var default** — Changed from `file:./dev.db` to `*(required)*` in all docs/references; PostgreSQL connection string is now mandatory.
- TypeScript compile: Exit 0, no type errors introduced by removal.

### Documentation — Comprehensive Stale Reference Sweep
All "living" reference docs updated to remove blob/backup content. Historical docs left intact (they are archives by design).

- **`README.md`** — Removed "backup stats" from feature list; removed "optional blob snapshot backup mode"; removed `App --> Blob` Mermaid node; removed backup API link.
- **`DEPLOYMENT.md`** — Removed `-BlobBackupAccount`/`-BlobBackupContainer` optional params; updated "What Gets Deployed" table (steps 1-5, no blob row); removed "Private Storage" bullet; updated troubleshooting table.
- **`docs/CONTEXT_INSTRUCTIONS.md`** — Removed `Backup` row from tech table; removed `backup.service.ts` from file listings; replaced `infra/blob-storage.bicep` with `infra/postgres.bicep`; added blob-removed gotcha note at line 364.
- **`docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md`** — Removed Backup Status UI item; removed backup admin API rows; removed "Trigger Manual Backup" section; updated cost note.
- **`docs/COMPLETE_API_REFERENCE.md`** — Removed backup endpoints from ToC; removed backup endpoints section; removed backup curl examples.
- **`docs/PROJECT_HEALTH_AND_STATS.md`** — Removed `BackupModule`/`BackupService` from module and service lists; removed azure SDK packages; replaced `blob-storage.bicep` with `postgres.bicep` in infra table; removed BackupService tech debt item.
- **`docs/LOGGING_AND_OBSERVABILITY.md`** — Removed `BackupService` from architecture diagram; removed `backup` category from log categories table; removed `"backup"` from all 4 `availableCategories` JSON examples; removed section "8.6 Backup Operation".
- **`docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md`** — Removed Backup log category row; removed `"backup"` from both `availableCategories` JSON responses; removed backup workflow step.
- **`docs/TECHNICAL_DESIGN_DOCUMENT.md`** — Version 1.1→1.2; removed backup from architecture diagram and module graph; removed BackupModule from module responsibilities table; removed section "5.5 BackupService" (renumbered 5.6→5.5, 5.7→5.6, 5.8→5.7); removed backup env vars; updated Azure Resource Architecture to replace blob storage with PostgreSQL Flexible Server; updated tech stack SQLite→PostgreSQL 17.
- **`docs/TECHNICAL_REQUIREMENTS_DOCUMENT.md`** — Replaced FR-600–FR-607 (SQLite + blob snapshot requirements) with new FR-600–FR-604 (PostgreSQL persistence requirements); removed FR-707 (blob storage private endpoint); updated NFR-010 and NFR-012 backup descriptions.
- **`docs/DOCKER_GUIDE_AND_TEST_REPORT.md`** — Added "⚠️ PARTIAL HISTORICAL CONTENT" banner noting blob/backup/SQLite-era sections are historical.

### Intentionally Untouched (Historical Archives)
- `docs/STORAGE_AND_BACKUP.md` — Already marked `⚠️ HISTORICAL`, correct as-is.
- `docs/SQLITE_COMPROMISE_ANALYSIS.md` — SQLite-era analysis document, historical context correct.
- `docs/MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md` — Migration plan document, historical.
- `docs/PERSISTENCE_PERFORMANCE_ANALYSIS.md` — Historical performance analysis.

## [0.22.0] - 2026-02-28

### Added — ReadOnly Attribute Stripping & Warnings (RFC 7643 §2.2)
- **ReadOnly attribute stripping** — POST/PUT payloads automatically strip `mutability: 'readOnly'` attributes (`id`, `meta`, `groups`, and any extension readOnly attrs) before processing. RFC 7643 §2.2: "the service provider SHALL ignore that attribute".
- **PATCH readOnly op filtering** — PATCH operations targeting readOnly attributes are silently stripped (behavior matrix: strict OFF → strip; strict ON + `IgnoreReadOnlyAttributesInPatch` → strip; strict ON without flag → G8c 400).
- **Warning URN extension** — When `IncludeWarningAboutIgnoredReadOnlyAttribute` is enabled, write responses include `urn:scimserver:api:messages:2.0:Warning` in `schemas[]` with a `warnings` array listing each stripped attribute.
- **`IncludeWarningAboutIgnoredReadOnlyAttribute` config flag** — 14th boolean flag (default: false). Enables warning annotation in responses.
- **`IgnoreReadOnlyAttributesInPatch` config flag** — 15th boolean flag (default: false). When true + strict schema ON, strips readOnly PATCH ops instead of G8c 400 error.
- **`SchemaValidator.collectReadOnlyAttributes()`** — Static method collecting readOnly attribute names from schema definitions (core + per-extension-URN Sets).
- **`stripReadOnlyAttributes()` helper** — Strips readOnly top-level attributes from POST/PUT payloads with case-insensitive matching and extension URN block support.
- **`stripReadOnlyPatchOps()` helper** — Filters PATCH operations, never stripping `id` (kept for G8c hard-reject), handles path-based, no-path, and extension URN ops.
- **`SCIM_WARNING_URN` constant** — `urn:scimserver:api:messages:2.0:Warning` exported from `scim-service-helpers.ts`.
- **Controller `attachWarnings()` method** — Private helper on Users/Groups/Generic controllers to annotate write responses with warning extension.
- **Generic service readOnly stripping** — `EndpointScimGenericService` now uses dynamic schema-driven readOnly stripping with `getSchemaDefinitions()` and the PATCH behavior matrix, covering custom resource types registered via Admin API.
- **AsyncLocalStorage middleware** — `EndpointContextStorage.createMiddleware()` wraps each request in `storage.run()` to ensure warning accumulation works correctly across NestJS interceptors/guards/handlers. Registered in `ScimModule.configure()`.
- **17 E2E tests** — New `readonly-stripping.e2e-spec.ts` covering POST/PUT/PATCH stripping, warning URN presence/absence, PATCH behavior matrix (strict ON/OFF, IgnorePatchRO ON/OFF).
- **10 live test cases** — Section 9t in `live-test.ps1` covering readOnly stripping scenarios for local, Docker, and Azure deployments.
- **10 new unit tests** — `EndpointContextStorage` addWarnings/getWarnings, createMiddleware, run() scope tests.

### Fixed
- **BF-1: Groups `id` client-controlled** — POST /Groups previously accepted `dto.id` from the client payload. Now always server-generates via `randomUUID()` per RFC 7643 §2.2 (id is readOnly, server-assigned).
- **AsyncLocalStorage context loss** — `enterWith()` didn't propagate through NestJS's interceptor pipeline. Fixed by introducing an Express middleware that creates the store via `storage.run()`, with `setContext()` mutating the existing store in-place.

### Changed
- Total unit tests: 2508 → **2532** (13 strip helper + 10 context storage + others).
- Total E2E tests: 522 → **539** (17 new readonly-stripping).
- Config flags: 13 → **15** (2 new readOnly-related flags).
- `EndpointContextStorage` — Added `addWarnings()`/`getWarnings()` API, `createMiddleware()`, mutating `setContext()` for request-scoped warning accumulation.
- `ScimSchemaHelpers` — Added `stripReadOnlyAttributesFromPayload()` and `stripReadOnlyFromPatchOps()` convenience methods.

### Documentation
- New: `docs/READONLY_ATTRIBUTE_STRIPPING_AND_WARNINGS.md` — Comprehensive feature doc with architecture diagrams, PATCH behavior matrix, config flag reference, Mermaid flow diagrams, test coverage tables.

## [0.21.0] - 2026-02-27

### Added — Phase 11: Per-Endpoint Credentials (G11)
- **`EndpointCredential` Prisma model** — `endpoint_credential` table with bcrypt-hashed credential storage, optional expiry, active/inactive state, cascade delete on endpoint.
- **`PerEndpointCredentialsEnabled` config flag** — Per-endpoint boolean flag (default: `false`). 12th boolean flag in endpoint configuration.
- **`AdminCredentialController`** — Admin API at `/admin/endpoints/{id}/credentials` for credential CRUD:
  - `POST` — Generate 32-byte base64url token, bcrypt hash (12 rounds), return plaintext once.
  - `GET` — List all credentials (hash never returned).
  - `DELETE` — Revoke (deactivate) credential.
- **3-tier auth fallback chain** — `SharedSecretGuard` extended: per-endpoint bcrypt credentials → OAuth 2.0 JWT → global `SCIM_SHARED_SECRET`. Graceful fallback on any per-endpoint error.
- **Lazy bcrypt loading** — Dynamic import of native `bcrypt` module; cached after first use.
- **Credential repository** — `IEndpointCredentialRepository` interface with Prisma and InMemory implementations. Filters active + non-expired credentials.
- **33 unit tests** — 14 admin controller tests + 19 guard tests (7 new per-endpoint scenarios).
- **16 E2E tests** — Admin CRUD, per-endpoint auth, fallback scenarios, credential expiry.
- **22 live integration tests** (section 9s) — Full lifecycle: create, list, auth, CRUD with per-endpoint token, OAuth fallback, reject invalid/revoked, flag-disabled rejection, expiry.

### Changed
- Compliance score: ~99% → **100%** — All 27 migration gaps (G1–G20) now fully resolved.
- Open gaps reduced from 1 (G11) → **0**.
- Auth architecture: Single-secret → 3-tier fallback chain.

### Dependencies
- Added `bcrypt` + `@types/bcrypt` for credential hashing.

### Fixed
- **SchemaValidator `id` required+readOnly catch-22 (59 failures):** `id` attribute was `required: true` + `mutability: 'readOnly'` — omitting `id` failed required check, including `id` failed readOnly check. Fixed by skipping readOnly attributes in required-attribute validation (RFC 7643 §2.2: server-assigned attributes). Applied to both core and extension attribute checks.
- **G8f PUT uniqueness test mock drift (1 failure):** `replaceGroupForEndpoint` called twice in test but `findWithMembers` mocked only once — second call got `undefined` → 404 instead of 409. Added re-mock before second call.

### Verified
- **73 suites / 2,508 tests** — Unit: 73 suites, 2,508 tests — **all passing (0 failures)**.
- **25 E2E suites / 522 tests** — E2E: 25 suites, 522 tests — **all passing (0 failures)**.
- **485 live integration tests** — previously 480 pass / 5 pre-existing (boolean coercion schema validation) — expected all 485 pass after fix.
- Docker build + run: both containers healthy, all per-endpoint credential tests pass.

## [0.20.0] - 2026-02-27

### Added — Phase 10: /Me Endpoint (RFC 7644 §3.11)
- **`ScimMeController`** — New `/Me` URI alias for the authenticated User resource. Resolves JWT `sub` claim → `userName` lookup → delegates to Users service for GET, PUT, PATCH, DELETE.
- **Identity Resolution** — Extracts `sub` from OAuth JWT, queries Users by `filter=userName eq "{sub}"`, returns SCIM 404 for legacy auth or missing user.
- **Attribute Projection** — Supports `?attributes=` and `?excludedAttributes=` query params on all /Me operations.
- **11 unit tests** (`scim-me.controller.spec.ts`) — GET/PUT/PATCH/DELETE /Me + identity resolution errors.
- **10 E2E tests** (`me-endpoint.e2e-spec.ts`) — Full lifecycle including cross-validation with GET /Users/{id}.
- **15 live integration tests** (section 9r) — GET /Me, PATCH, PUT, DELETE, attribute projection, cross-validation, 404 after deletion.

### Added — Phase 12: Sorting (RFC 7644 §3.4.2.3)
- **`scim-sort.util.ts`** — Sort attribute mapping utility for `sortBy`/`sortOrder` parameters.
- **Controller wiring** — Users, Groups, and Generic controllers accept `sortBy` and `sortOrder` query params on GET and POST /.search.
- **Service wiring** — Sort params threaded through services to repositories.
- **`sort.supported: true`** — ServiceProviderConfig updated from `false` to `true`.
- **20 unit tests** (`scim-sort.util.spec.ts`) — Attribute mapping, order handling, edge cases.
- **14 E2E tests** (`sorting.e2e-spec.ts`) — Ascending/descending, default order, .search body sorting, pagination with sorting, group sorting.
- **11 live integration tests** (section 9q) — Sort ascending/descending, default order, POST /.search sorting, pagination, group sorting, SPC verification.

### Added — G17: Service Deduplication
- **`scim-service-helpers.ts`** — Extracted 13+ duplicate private methods from Users and Groups services into pure functions (`parseJson`, `ensureSchema`, `enforceIfMatch`, `sanitizeBooleanStrings`, `guardSoftDeleted`) + `ScimSchemaHelpers` class (parameterized by `schemaRegistry` + `coreSchemaUrn`).
- **Users service** — Refactored from ~904 to ~640 lines (−29%), all duplicate methods removed.
- **Groups service** — Refactored from ~1005 to ~726 lines (−28%), all duplicate methods removed.
- **43 unit tests** (`scim-service-helpers.spec.ts`) — Full coverage of all extracted functions and class methods.

### Changed
- Compliance score: ~98% → **~99%** — Sorting and /Me now implemented.
- ServiceProviderConfig: `sort.supported: false` → `true`.
- Open gaps reduced from 4 (G10, G11, G12, G17) → **1 (G11 per-endpoint credentials)**.

### Verified
- **75 suites / 2,548 tests** — Unit: 75 suites (73 pass, 2 pre-existing), 2,548 tests (2,524 pass, 24 pre-existing).
- **24 E2E suites / 506 tests** — E2E: 24 suites (22 pass, 2 pre-existing), 506 tests (465 pass, 41 pre-existing).
- **463 live integration tests** — 458 pass, 5 pre-existing failures (boolean coercion schema validation).
- Docker build + run: both containers healthy, all tests pass.

## [0.19.3] - 2026-02-26

### Fixed
- **D1 — Discovery Auth Bypass (RFC 7644 §4)** — All 4 discovery controllers (`ServiceProviderConfigController`, `ResourceTypesController`, `SchemasController`, `EndpointScimDiscoveryController`) now have `@Public()` decorator at class level, allowing unauthenticated access per RFC 7644 §4 "SHALL NOT require authentication".
- **D4 — Schema resources missing `schemas` array** — Each Schema definition resource now includes `schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"]` per RFC 7643 §7.
- **D5 — ResourceType resources missing `schemas` array** — Each ResourceType resource now includes `schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"]` per RFC 7643 §6.
- **D6 — `authenticationSchemes` missing `primary` flag** — Added `primary: true` to the OAuth Bearer Token authentication scheme in SPC per RFC 7643 §5.

### Added
- **D2 — `GET /Schemas/{uri}` individual lookup** — New route on `SchemasController` and `EndpointScimDiscoveryController` for retrieving a single schema by URN. Returns SCIM 404 error for unknown URNs.
- **D3 — `GET /ResourceTypes/{id}` individual lookup** — New route on `ResourceTypesController` and `EndpointScimDiscoveryController` for retrieving a single resource type by id. Returns SCIM 404 error for unknown ids.
- **`getSchemaByUrn()` and `getResourceTypeById()`** — New methods on `ScimDiscoveryService` delegating to registry with proper SCIM 404 error handling.
- **`SCIM_SCHEMA_SCHEMA` and `SCIM_RESOURCE_TYPE_SCHEMA`** — New URN constants in `scim-constants.ts`.
- **26 new unit tests** — Individual lookup (found/not-found), `schemas[]` arrays, `primary:true` flag across 5 spec files.
- **16 new E2E tests** — Unauthenticated discovery access (6), individual Schema lookup (4), individual ResourceType lookup (5), schemas[] validation (2), primary flag (1).

### Changed
- Discovery endpoints compliance score: 85% → **100%** in SCIM_COMPLIANCE.md.
- `ScimSchemaDefinition` and `ScimResourceType` interfaces now include optional `schemas` property.
- All dynamic registration paths (DB-hydrated, msfttest, `registerExtension()`, `registerResourceType()`) populate `schemas` with fallback defaults.

### Verified
- **124/124 discovery unit tests passing** (5 suites) — up from 110 (+14 multi-tenant)
- **35/35 discovery E2E tests passing** (1 suite) — up from 26 (+9 multi-tenant)

### Multi-Tenant Discovery Enhancement

#### Added
- **Two-tier discovery architecture documented** — Root-level routes (`/scim/v2/...`) serve global defaults for admin tooling; endpoint-scoped routes (`/scim/endpoints/{id}/...`) are the **primary** interface for multi-tenant consumers, returning per-tenant schemas, resource types, and config.
- **14 new unit tests** — `endpoint-scim-discovery.controller.spec.ts` (7): endpointId passthrough to all service methods, SPC with endpoint config, different configs → different SPCs, context with correct endpointId/baseUrl. `scim-discovery.service.spec.ts` (7): spy-verified endpointId passthrough to all registry methods, SPC config adjustment.
- **9 new E2E tests** — `discovery-endpoints.e2e-spec.ts`: SPC reflects per-endpoint `BulkOperationsEnabled` (on/off), root-level unaffected by endpoint config, two endpoints with different configs produce different SPCs, core schemas present at endpoint scope, RT with extensions, individual schema/RT lookup at endpoint scope, all 5 endpoint-scoped routes accessible without auth.

#### Changed
- All 4 discovery controllers updated with JSDoc clarifying multi-tenant roles (root-level = global defaults, endpoint-scoped = primary for multi-tenant).
- `DISCOVERY_ENDPOINTS_RFC_AUDIT.md` — Added §3.5 Multi-Tenant Discovery Architecture section with two-tier routing table and Mermaid diagrams. Updated architecture diagram, test coverage tables, and cross-references.
- `COMPLETE_API_REFERENCE.md` — Restructured SCIM metadata section with Multi-Tenant Note table and separate Root-Level / Endpoint-Scoped subsections (10 routes total).
- `CONTEXT_INSTRUCTIONS.md` — Updated discovery feature status with multi-tenant details.

## [0.19.2] - 2026-02-26

### Fixed
- **G8g — Write-Response Attribute Projection (RFC 7644 §3.9)** — `attributes` and `excludedAttributes` query parameters were ignored on POST (create), PUT (replace), and PATCH (modify) write operations. Clients could not request partial resource representations on write responses. All 6 write controller methods (3 Users + 3 Groups) now accept these query parameters and delegate to `applyAttributeProjection()` — the same function already used by read operations — ensuring consistent RFC-compliant attribute projection across all SCIM operations.

### Added
- **27 new unit tests** — `endpoint-scim-users.controller.spec.ts` (12) + `endpoint-scim-groups.controller.spec.ts` (11) for G8g write-response projection + `prisma-filter-evaluator.spec.ts` (4) for CITEXT/TEXT filter fix: POST/PUT/PATCH with `attributes`, `excludedAttributes`, both params (precedence), `returned:'request'` interaction, always-returned protection, dotted sub-attribute paths, and without params.
- **14 new E2E tests** — `attribute-projection.e2e-spec.ts`: POST/PUT/PATCH × Users/Groups with `attributes` and `excludedAttributes` projection, precedence rules, always-returned protection, dotted sub-attributes.
- **33 new live integration tests** — `scripts/live-test.ps1` TEST SECTION 9p: POST/PUT/PATCH × Users/Groups write-response projection with `attributes`, `excludedAttributes`, both params (precedence), always-returned protection, setup + cleanup.
- **Feature doc** — `docs/G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md` — Architecture, projection flow, implementation details, test coverage tables.

### Changed
- Removed unused `stripReturnedNever` import from both controllers (replaced by `applyAttributeProjection` calls).

### Verified
- **2,357/2,357 unit tests passing** (69 suites) — up from 2,330 (+27 new: 23 G8g + 4 CITEXT filter)
- **455/455 E2E tests passing** (22 suites) — up from 441 (+14 new)
- **444/444 live integration tests passing** — up from 411 (+33 new)

## [0.19.1] - 2026-02-26

### Fixed
- **G8f — Group Uniqueness Enforcement on PUT/PATCH** — `assertUniqueDisplayName()` and `assertUniqueExternalId()` were defined but never called on PUT (replace) and PATCH (modify) operations. Groups could silently end up with duplicate `displayName` or `externalId` values within the same endpoint. Both methods are now called with proper self-exclusion (`excludeScimId`) on both PUT and PATCH paths.

### Added
- **10 new unit tests** — `endpoint-scim-groups.service.spec.ts`: PUT/PATCH uniqueness enforcement (displayName conflict, externalId conflict, self-exclusion, excludeScimId verification, null externalId skip).
- **6 new E2E tests** — `group-lifecycle.e2e-spec.ts`: PUT/PATCH 409 on displayName/externalId collisions, self-update success.
- **10 new live integration tests** — `scripts/live-test.ps1` TEST SECTION 9o: PUT/PATCH uniqueness (displayName/externalId conflicts, self-update, unique update success), setup + cleanup.
- **Feature doc** — `docs/G8F_GROUP_UNIQUENESS_PUT_PATCH.md` — Architecture, self-exclusion pattern, test coverage tables.

### Verified
- **2,330/2,330 unit tests passing** (69 suites) — up from 2,320 (+10 new)
- **441/441 E2E tests passing** (22 suites) — up from 435 (+6 new)
- **411/411 live integration tests passing** — up from 401 (+10 new)

## [0.19.0] - 2026-02-26

### Added
- **Phase 9 — Bulk Operations (RFC 7644 §3.7)** — Process multiple SCIM operations in a single HTTP request. Per-endpoint, gated behind `BulkOperationsEnabled` config flag (default: false).
  - **BulkController**: `POST /endpoints/:endpointId/Bulk` with config flag gate, schema URN validation, and payload size guard (1MB max).
  - **BulkProcessorService**: Sequential operation processing with `bulkId` cross-referencing (`Map<string, string>`), `failOnErrors` threshold, and per-operation error isolation.
  - **BulkRequest/Response DTOs**: `BulkOperationDto`, `BulkRequestDto`, `BulkOperationResult`, `BulkResponse` with RFC-compliant schema URNs.
  - **ServiceProviderConfig**: Updated to advertise `bulk.supported = true`, `maxOperations = 1000`, `maxPayloadSize = 1048576`.
  - **New error type**: `TOO_LARGE: 'tooLarge'` added to `SCIM_ERROR_TYPE` for 413 responses.
- **`BulkOperationsEnabled` config flag** — New per-endpoint boolean flag in `endpoint-config.interface.ts`. When disabled (default), bulk endpoint returns 403.
- **43 new unit tests** — `bulk-processor.service.spec.ts` (32), `endpoint-scim-bulk.controller.spec.ts` (11).
- **24 new E2E tests** — `bulk-operations.e2e-spec.ts`: Config flag gating, User/Group CRUD via bulk, bulkId cross-referencing, failOnErrors, request validation, mixed operations, response format, uniqueness collision.
- **18 new live integration tests** — `scripts/live-test.ps1` TEST SECTION 9n: Flag gating, User/Group CRUD, bulkId cross-ref, failOnErrors, schema validation, unsupported types, mixed ops, SPC, response format, uniqueness collision.
- **Feature doc** — `docs/PHASE_09_BULK_OPERATIONS.md` — Architecture, API reference, Mermaid diagrams, test coverage tables.

### Verified
- **2,320/2,320 unit tests passing** (69 suites) — up from 2,277 (+43 new, +2 suites)
- **435/435 E2E tests passing** (22 suites) — up from 411 (+24 new, +1 suite)
- **401/401 live integration tests passing** — up from 381 (+18 new, section 9n + 2 cleanup)
- Docker build + container live tests: all passing

## [0.18.0] - 2026-02-26

### Added
- **G8b — Custom Resource Type Registration** — Data-driven extensibility beyond built-in User/Group. Per-endpoint, gated behind `CustomResourceTypesEnabled` config flag (default: false).
  - **Admin API**: `POST/GET/GET(:name)/DELETE(:name)` at `/admin/endpoints/:endpointId/resource-types` for registering, listing, retrieving, and removing custom resource types.
  - **Generic SCIM CRUD**: Full SCIM lifecycle (POST create, GET single, GET list, PUT replace, PATCH, DELETE) via wildcard `:resourceType` controller. Supports `displayName eq` and `externalId eq` filter predicates.
  - **GenericPatchEngine**: JSONB-based PATCH engine with `add`/`replace`/`remove` operations, dot-notation path resolution, and URN-aware extension attribute paths (handles version dots like `2.0`).
  - **Database**: New `EndpointResourceType` table with cascade-delete, unique constraints on `[endpointId, name]` and `[endpointId, endpoint]`.
  - **ScimSchemaRegistry**: Enhanced with per-endpoint resource type overlay, DB-hydrated on startup, supports runtime registration/unregistration.
  - **Validation**: Reserved name protection (User, Group), reserved path protection (/Users, /Groups, /Schemas, /ResourceTypes, /ServiceProviderConfig, /Bulk, /Me), regex-validated name/endpoint formats, duplicate detection.
- **`CustomResourceTypesEnabled` config flag** — New per-endpoint boolean flag in `endpoint-config.interface.ts`. When disabled (default), Admin API returns 403 and generic SCIM routes return 404.
- **121 new unit tests** — `generic-patch-engine.spec.ts` (23), `admin-resource-type.controller.spec.ts` (20), `create-endpoint-resource-type.dto.spec.ts` (18), `endpoint-scim-generic.service.spec.ts` (19), `scim-schema-registry.spec.ts` (14 new), `inmemory-endpoint-resource-type.repository.spec.ts` (12), `inmemory-generic-resource.repository.spec.ts` (15).
- **29 new E2E tests** — `custom-resource-types.e2e-spec.ts`: Config flag gating, Admin API CRUD, generic SCIM CRUD, endpoint isolation, built-in routes protection, multiple resource types.
- **20 new live integration tests** — `scripts/live-test.ps1` TEST SECTION 9m: Flag gating, registration, reserved names/paths, duplicate rejection, list/get, full SCIM CRUD lifecycle, endpoint isolation, built-in route preservation, delete resource type, built-in type delete rejection.
- **Feature doc** — `docs/G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md` — Architecture, API reference, Mermaid diagrams, test coverage tables.

### Verified
- **2,277/2,277 unit tests passing** (67 suites) — up from 2,156 (+121 new, +6 suites)
- **411/411 E2E tests passing** (21 suites) — up from 382 (+29 new, +1 suite)
- **Live integration tests**: 20 new tests in section 9m

## [0.17.4] - 2026-02-25

### Added
- **G8e — Response `returned` Characteristic Filtering** — RFC 7643 §2.4 compliance. Two-layer architecture:
  - **Service layer**: `toScimUserResource()` / `toScimGroupResource()` strip `returned:'never'` attributes (e.g. `password`) from ALL responses (POST, PUT, PATCH, GET, LIST).
  - **Controller layer**: Enhanced `applyAttributeProjection()` strips `returned:'request'` attributes from GET/LIST/SEARCH responses unless explicitly requested via `attributes` query parameter. Write operation responses also strip request-only attributes.
- **`password` attribute added to User schema constants** — RFC 7643 §4.1 compliance: `USER_SCHEMA_ATTRIBUTES` now includes `password` with `returned: 'never'`, `mutability: 'writeOnly'`, `type: 'string'`. Previously missing entirely from `/Schemas` output.
- **`SchemaValidator.collectReturnedCharacteristics()`** — New static method that collects `returned: 'never'` and `returned: 'request'` attribute names from schema definitions, supporting sub-attributes and extension schemas.
- **`stripReturnedNever()` export** — New utility in `scim-attribute-projection.ts` for service-layer use. Handles both top-level and extension URN nested attributes.
- **`getRequestOnlyAttributes()` public method** — Added to both `EndpointScimUsersService` and `EndpointScimGroupsService` for controllers to access `returned: 'request'` attribute sets.
- **Deep-freeze schema constants** — All exported schema constant arrays/objects in `scim-schemas.constants.ts` are now recursively frozen at module load via `deepFreeze()`. Prevents a pre-existing runtime mutation bug where shared schema arrays (e.g. `USER_SCHEMA_ATTRIBUTES`) were silently modified during request processing, corrupting `/Schemas` discovery output and breaking G8e characteristic lookups. TypeScript `as const` provides compile-time safety only; `Object.freeze` provides the runtime guarantee.
- **10 new live integration tests** — `scripts/live-test.ps1` TEST SECTION 9l: POST/GET/LIST/PUT/PATCH/SEARCH password stripping, `?attributes=password` override rejection, mixed attribute requests, `/Schemas` metadata validation, POST `/.search` with attributes override.
- **40 new unit tests** — `scim-attribute-projection.spec.ts` (16 new: requestOnlyAttrs filtering, stripReturnedNever, extension URN handling, case-insensitivity), `schema-validator-v16-v32.spec.ts` (10 new: collectReturnedCharacteristics with never/request/always/default/sub-attributes/multiple schemas/empty/case-insensitive), `endpoint-scim-users.service.spec.ts` (4 new: password stripping, request-only attributes), `endpoint-scim-groups.service.spec.ts` (2 new: never-returned stripping, request-only attributes), `endpoint-scim-users.controller.spec.ts` (4 new: G8e request-only attribute filtering across CRUD ops), `endpoint-scim-groups.controller.spec.ts` (4 new: G8e request-only attribute filtering across CRUD ops).
- **8 new E2E tests** — `returned-characteristic.e2e-spec.ts`: POST/GET/PUT/PATCH/LIST/SEARCH password stripping, explicit `attributes=password` rejection, `/Schemas` discovery validation.
- **Feature doc** — `docs/G8E_RETURNED_CHARACTERISTIC_FILTERING.md` — RFC references, two-layer architecture, implementation details, Mermaid diagrams, test coverage.

### Fixed
- **Schema constant runtime mutation bug** — Pre-existing bug where `USER_SCHEMA_ATTRIBUTES` (and potentially other schema constant arrays) were silently mutated during request processing, removing attributes like `password` (writeOnly) and `groups` (readOnly). This caused `/Schemas` endpoint to return only 16 of 18 attributes after the first request cycle. Root cause: `ScimSchemaRegistry.loadBuiltInSchemas()` stored direct references to the constant arrays; some downstream code path then mutated these shared references. Fixed by applying recursive `Object.freeze()` to all schema constants at module load. The freeze causes any mutation attempt to silently fail (in non-strict mode) or throw (in strict mode), protecting the shared state.

### Verified
- **2,156/2,156 unit tests passing** (61 suites) — up from 2,116 (+40 new)
- **382/382 E2E tests passing** (20 suites) — up from 374 (+8 new)
- **361/361 live tests passing** — up from 334 (+27 new), tested on both local (inmemory) and Docker (PostgreSQL)
- Clean build (`tsc -p tsconfig.build.json` — 0 errors)

## [0.17.3] - 2026-02-25

### Added
- **G8c — PATCH readOnly Pre-Validation** — `SchemaValidator.validatePatchOperationValue()` now enforces `mutability: 'readOnly'` on PATCH operations. Rejects `add`, `replace`, and `remove` operations targeting readOnly attributes (e.g., `groups`) with HTTP 400. Includes `resolveRootAttribute()` helper for value-filter paths (e.g., `groups[value eq "x"].display` → checks parent `groups` is readOnly). No-path operations also check each object key and extension attribute. Gated behind `StrictSchemaValidation` flag for Entra compatibility.
- **`groups` attribute added to User schema constants** — RFC 7643 §4.1 compliance: `USER_SCHEMA_ATTRIBUTES` now includes `groups` with `mutability: 'readOnly'`, `type: 'complex'`, `multiValued: true`, and sub-attributes (`value`, `$ref`, `display`, `type`). Previously missing entirely from `/Schemas` output.
- **25 new unit tests** — `schema-validator-v2-v10-v25-v31.spec.ts`: path-based readOnly ops, no-path readOnly ops, value-filter paths, remove on readOnly, reserved keys, case-insensitive matching, extension attributes.
- **7 new E2E tests** — `schema-validation.e2e-spec.ts` §15: PATCH replace/add/remove on readOnly `groups` → 400, no-path with readOnly → 400, readWrite allowed, lenient mode acceptance.
- **Feature doc** — `docs/G8C_PATCH_READONLY_PREVALIDATION.md` — RFC references, architecture flow, implementation details, error response format, test coverage.

### Verified
- **2116/2116 unit tests passing** (61 suites) — up from 2096 (+20 new)
- **374/374 E2E tests passing** (19 suites) — up from 368 (+6 net new)
- Clean build (`tsc -p tsconfig.build.json` — 0 errors)

## [0.17.2] - 2026-02-25

### Added
- **`AllowAndCoerceBooleanStrings` config flag** (default `true`) — Coerces boolean-typed string values (`"True"`, `"False"`) to native booleans (`true`, `false`) before schema validation. Fixes Microsoft SCIM Validator failures caused by `roles[].primary = "True"` (string) being rejected by `SchemaValidator`. Applied on all write paths: POST body, PUT body, PATCH operation values, PATCH filter literals, and post-PATCH result payloads. Boolean attribute names are now **schema-aware** — only attributes whose schema type is `"boolean"` are coerced (V16/V17 fix).
- **`ReprovisionOnConflictForSoftDeletedResource` config flag** (default `false`) — When enabled alongside `SoftDeleteEnabled`, POST operations that collide with a soft-deleted resource (same `userName`/`externalId` for Users, same `displayName`/`externalId` for Groups) **re-activate the existing resource** with the new payload instead of returning 409 Conflict. Clears `deletedAt`, sets `active=true`, and replaces the resource payload. For Groups, member references are re-resolved. This is the **10th boolean config flag** (11 total including `logLevel`).
- **Soft-delete `deletedAt` timestamp tracking** — Soft-deleted resources now set both `active=false` AND `deletedAt=<timestamp>` on DELETE. The `guardSoftDeleted()` check uses `deletedAt != null` (not `active === false`) to distinguish soft-deleted resources from PATCH-disabled resources (`active=false` via PATCH is a normal state, not soft-deletion). New `deletedAt DateTime? @db.Timestamptz` column added to Prisma `ScimResource` model, and `deletedAt: Date | null` added to `UserRecord`, `GroupRecord`, `UserUpdateInput`, `GroupUpdateInput`, and `UserConflictResult` domain models.
- **Group `active` field** — `GroupRecord` and `GroupCreateInput` now include `active: boolean`. Groups are created with `active: true`. Group SCIM responses include `active` in the output. The `active` boolean attribute is now defined in scim-schemas constants for Groups.
- **`getConfigBooleanWithDefault()` helper** — New config helper for flags that default to `true` (unlike `getConfigBoolean` which defaults to `false`). Used by `AllowAndCoerceBooleanStrings` and available for future flags.
- **PATCH filter boolean matching** — `matchesFilter()` in `scim-patch-path.ts` now correctly handles boolean-to-string comparisons (e.g., `roles[primary eq "True"]` matches `primary: true`).
- **`SchemaValidator.collectBooleanAttributeNames()`** — New static method that extracts all boolean-typed attribute names from schema definitions, used for schema-aware boolean string coercion (V16/V17).
- **`SchemaValidator.validateFilterAttributePaths()`** — New V32 validation method that validates filter attribute paths against registered schema definitions.
- **`scim-filter-parser.ts`** — New module for extracting attribute path strings from parsed SCIM filter AST for validation purposes.
- **Startup warning for StrictSchemaValidation** — `main.ts` now logs a `Logger.warn()` when `StrictSchemaValidation` is OFF by default, alerting operators that schema validation is lenient.
- **101 new unit tests** — `endpoint-config.interface.spec.ts` (flag validation, `getConfigBooleanWithDefault`, `ReprovisionOnConflictForSoftDeletedResource` combo tests), `endpoint-scim-users.service.spec.ts` (create/replace/PATCH coercion, reprovision, guardSoftDeleted with deletedAt), `endpoint-scim-groups.service.spec.ts` (reprovision, Group active, guardSoftDeleted), `schema-validator-v16-v32.spec.ts` (292 lines — collectBooleanAttributeNames, validateFilterAttributePaths), `sanitize-boolean-strings.spec.ts` (154 lines — schema-aware sanitization), `scim-filter-parser.spec.ts` (96 lines — filter AST extraction), `scim-patch-path.spec.ts` (boolean filter matching)
- **16 new E2E tests** — `soft-delete-flags.e2e-spec.ts` (POST/PUT/PATCH coercion, reprovision flows, deletedAt tracking, flag on/off, filter paths, StrictSchema combinations)
- **14+ new live integration tests** — Section 9f: AllowAndCoerceBooleanStrings live tests (boolean string coercion on create/replace/patch, flag interaction with StrictSchemaValidation)
- **Comprehensive Flag Reference** — `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md` — All 10 boolean flags + logLevel documented with applicability, precedence, examples, flag interaction matrix, Mermaid diagrams, JSON request/response examples for all combinations
- **In-memory persistence for EndpointService & LoggingService** — Both services now detect `PERSISTENCE_BACKEND=inmemory` and use in-memory stores (`Map`-based endpoint CRUD, array-based log buffer with filtering/pagination) instead of Prisma. Enables fully Prisma-free operation when running with inmemory repository persistence.
- **Resource-type-aware attribute projection** — `applyAttributeProjection()` now detects resource type from `schemas[]`. Per RFC 7643: User `displayName` has `returned: 'default'` (excludable), Group `displayName` has `returned: 'always'` (never excluded). Fixes incorrect User `displayName` behavior where it was always returned even when excluded via `?excludedAttributes=displayName`.
- **Live test RFC alignment (externalId caseExact)** — Updated live test expectation for case-variant group `externalId` from 409 (conflict) to 201 (allowed). Per RFC 7643 §2.4, `externalId` has `caseExact: true`, so `"ABC"` and `"abc"` are distinct values, not duplicates.
- **externalId CITEXT → TEXT (RFC 7643 §3.1 caseExact compliance)** — Changed `externalId` column from `@db.Citext` to `@db.Text` in Prisma schema. Migration `20260225181836_externalid_citext_to_text` applies `ALTER TABLE "ScimResource" ALTER COLUMN "externalId" SET DATA TYPE TEXT`. Added `'text'` column type to filter engine — `co`/`sw`/`ew` operators on `text` columns are now case-sensitive (no `mode: 'insensitive'`). Updated 5 E2E tests, 5 unit tests, 4 live tests. Previously-failing live test `"Case-variant group externalId should be allowed (caseExact=true)"` now passes. See `docs/EXTERNALID_CITEXT_TO_TEXT_RFC_COMPLIANCE.md`.

### Fixed
- **Microsoft SCIM Validator Results #26** — All 17 failures (13 mandatory + 4 preview) resolved. Root cause: `roles[].primary = "True"` (string) rejected by `SchemaValidator`. Score: 10/23 → **23/23 mandatory**, 3/7 → **7/7 preview**. See `docs/SCIM_VALIDATOR_RESULTS_26_ANALYSIS.md`.
- **User `displayName` incorrectly always-returned** — `displayName` was in the global `ALWAYS_RETURNED` set for attribute projection, but per RFC 7643 User schema `displayName` has `returned: 'default'`, not `returned: 'always'`. Only Group `displayName` is `returned: 'always'`. Fixed by making `ALWAYS_RETURNED` resource-type-aware.
- **PATCH filter boolean-to-string matching** — `matchesFilter()` now handles `roles[primary eq "True"]` correctly when `primary` is stored as boolean `true`.
- **Soft-delete guard improved** — `guardSoftDeleted()` now checks `deletedAt != null` instead of `active === false`, correctly distinguishing soft-deleted resources from PATCH-disabled resources (where a client sets `active=false` via PATCH — a normal state, not soft-deletion).
- **Schema-aware boolean sanitization (V16/V17)** — `sanitizeBooleanStrings()` now only converts attributes whose schema type is `"boolean"` (via `SchemaValidator.collectBooleanAttributeNames()`), preventing over-zealous coercion of string fields that happen to contain "True"/"False" values.

### Verified
- **2096/2096 unit tests passing** (61 suites) — up from 1962 (+134 new)
- **368/368 E2E tests passing** (19 suites) — up from 342 (+26 new)
- **334/334 live integration tests passing** — on both local and Docker in-memory instances
- Clean build (`tsc -p tsconfig.build.json` — 0 errors)

## [0.17.1] - 2026-02-24

### Added
- **Immutable Attribute Enforcement (H-2)** — `SchemaValidator.checkImmutable()` pure domain method for RFC 7643 §2.2 immutable attribute enforcement. Compares existing vs incoming SCIM payloads attribute-by-attribute, supporting complex sub-attributes, multi-valued arrays (matched by `value` sub-attr), case-insensitive attribute names, and extension schemas. Applied on both PUT and PATCH flows in user and group services.
- **Post-PATCH Schema Validation (H-1)** — `SchemaValidator.validate()` now invoked after PATCH operations with `mode: 'patch'` in both user and group services. Reconstructs the PATCH result payload (first-class fields + rawPayload + extension URNs) before validation.
- **Adversarial Client Validation Gap Analysis** — Comprehensive security/validation audit assuming adversarial SCIM clients. Identified **33 validation gaps** (V1-V33): 8 HIGH, 12 MEDIUM, 13 LOW. Root causes: validation opt-in by default, PATCH bypasses schema checks, no input size limits, DTO gaps.
- **RFC Attribute Characteristics Gap Analysis** — All 11 RFC 7643/7644 attribute characteristics analyzed. Identified **15 gaps (G1-G15)** with severity ratings, remediation code, sub-phases 8.1-8.5 defined.
- **SchemaValidator growth** — 383 → 594 lines (added `checkImmutable()`, `checkImmutableAttribute()`, `checkImmutableMultiValuedComplex()`, `getValueIgnoreCase()`, `deepEqual()`)
- **Service helpers** — `buildSchemaDefinitions()`, `buildExistingPayload()`, `checkImmutableAttributes()` in both user and group services. `validatePayloadSchema()` now supports `'patch'` mode.
- **215 new unit tests** in `schema-validator.spec.ts` (14 checkImmutable tests) + patch engine tests + attribute projection hardening
- **69 new unit tests** in user/group patch engine specs and attribute projection spec

### Documentation
- **`docs/H1_H2_ARCHITECTURE_AND_IMPLEMENTATION.md`** (NEW) — Architecture analysis, design deliberation (4 approaches evaluated), implementation plan
- **`docs/ATTRIBUTE_CHARACTERISTICS_GAPS.md`** (NEW) — Master gap/bug tracking for RFC 7643 §2 attribute characteristics
- **`docs/RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md`** (NEW) — 10-section gap analysis with Mermaid diagrams
- **`docs/PHASE_08_REMAINING_ANALYSIS.md`** (NEW) — Phase 8 remaining work: adversarial gaps, Part 2 scope, effort estimates
- Updated `docs/MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md` — New gaps G8c-G8i, Phase 8 completion status
- Updated `docs/INDEX.md` — Migration & Roadmap section expanded

### Verified
- **1711/1711 unit tests passing** (54 suites) — up from 1685 (+26 new)
- **342/342 E2E tests passing** (19 suites) — unchanged
- **318/318 live integration tests passing**

## [0.17.1-fix1] - 2026-02-24

### Added
- **Adversarial Validation Gap Closure (V2-V31)** — Closed 30 of 33 adversarial gaps with schema + patch + DTO hardening:
  - **SchemaValidator enhancements** (594 → 816 lines): `canonicalValues` enforcement, `maxPayloadSize` limit (1MB default), `maxStringLength` enforcement (65535), `maxArrayElements` enforcement (1000), null value handling, recursive depth protection, `uniqueness: 'server'` enforcement, integer range validation, boolean strict typing, decimal precision
  - **DTO hardening**: `SearchRequestDto` — `@Max(1000)` on count, `@MaxLength(5000)` on filter, `@IsIn` on sortOrder; `CreateUserDto`/`PatchUserDto` — `@IsString()` + `@MinLength(1)` on userName; `CreateGroupDto`/`PatchGroupDto` — `@IsString()` on displayName; `PatchOperationDto` — `@ArrayMaxSize(100)` on operations
  - **Patch engine hardening**: `maxPatchOps` (100) and `maxPatchValueSize` (100KB) limits in user and group patch engines; `meta`/`schemas` added to `stripReservedAttributes()`; schema URN format validation; duplicate schema URN rejection
  - **Service-layer integration**: `sanitizeBooleanStrings()` restricted to declared Boolean attributes only; schemas[] URN format and duplicate validation in both user and group services
- **5 new test files** (2853 lines):
  - `extension-and-flags.spec.ts` (985 lines) — Extension URN handling, strict schema validation, sanitize boolean, flag combinations
  - `schema-validator-v2-v10-v25-v31.spec.ts` (599 lines) — canonicalValues, payload size, string length, array elements, null handling, depth protection, uniqueness, integer range, boolean strict, decimal precision
  - `patch-engine-v19-v20.spec.ts` (368 lines) — maxPatchOps, maxPatchValueSize, reserved attribute stripping, schema URN validation
  - `dto-hardening.spec.ts` (443 lines) — SearchRequestDto validators, CreateUser/PatchUser username, CreateGroup/PatchGroup displayName, PatchOp ArrayMaxSize
  - `extension-flags-validation.spec.ts` (857 lines) — Comprehensive extension URN/flags integration tests

### Verified
- **1962/1962 unit tests passing** (59 suites) — up from 1711 (+251 new)
- **342/342 E2E tests passing** (19 suites) — unchanged
- Build clean, zero compilation errors

## [0.17.0] - 2026-02-24

### Added
- **Phase 8: Schema Validation Engine — Comprehensive Test Coverage**
  - **`SchemaValidator` domain class** (816 lines, grew from 383 in v0.17.0 through v0.17.1-fix1) — Pure RFC 7643 payload validator: type checking (string/boolean/integer/decimal/dateTime/binary/reference/complex), mutability enforcement (readOnly rejection on create/replace, immutable/writeOnly acceptance), required attribute enforcement (create/replace only, skipped on patch), unknown attribute detection (strict mode), sub-attribute recursive validation, multi-valued array element validation, extension schema validation with case-insensitive attribute matching, immutable attribute enforcement (old-vs-new comparison), canonicalValues enforcement, size limits (payload/string/array), uniqueness checking
  - **`validation-types.ts`** (70 lines) — `SchemaValidationContext`, `SchemaValidationError`, `SchemaAttributeDefinition`, `SchemaDefinition` interfaces
  - **179 new unit tests** — `schema-validator-comprehensive.spec.ts` (20 describe blocks): scalar type validation (string/boolean/integer/decimal/dateTime/binary/reference with valid/invalid values), complex attribute type checking, mutability enforcement (readOnly/immutable/writeOnly), multi-valued array validation, Group schema validation, extension schema validation (required/type/readOnly/complex sub-attrs/unknown attrs/case-insensitivity), custom extension validation, multiple simultaneous extensions, real-world User schema payloads, complex attribute sub-attributes (name/phoneNumbers/addresses), cross-schema error accumulation, edge cases (null/empty/NaN/Infinity/large payloads), error reporting format, schema metadata attributes (caseExact/uniqueness/returned/referenceTypes)
  - **19 new service-level tests** — 11 in `endpoint-scim-users.service.spec.ts` + 8 in `endpoint-scim-groups.service.spec.ts`: schema attribute type validation through service layer (wrong type rejection, valid types acceptance, complex attribute validation, strict mode unknown attributes, multi-valued enforcement, readOnly rejection)
  - **49 new E2E tests** — `schema-validation.e2e-spec.ts` (14 describe blocks): complex attribute type validation, multi-valued enforcement, unknown attribute rejection, sub-attribute type errors, enterprise extension validation, Group schema validation, PUT replace validation, error response format (RFC 7644 §3.12), flag on/off comparison, extension URN edge cases, complex realistic payloads, cross-resource schema isolation, DTO implicit conversion documentation, reserved keys behaviour
  - **Phase 8 discovery: NestJS `ValidationPipe` implicit conversion** — Documented that `transform: true` + `enableImplicitConversion: true` causes class-transformer to coerce DTO-declared properties (e.g., `active: 'yes'` → `true`, `userName: 12345` → `'12345'`) before schema validation runs. Non-DTO properties (`name`, `emails`, `phoneNumbers`) via `[key: string]: unknown` pass through uncoerced and ARE validated by `SchemaValidator`

### Documentation
- **`docs/RFC_ATTRIBUTE_CHARACTERISTICS_ANALYSIS.md`** (NEW) — Comprehensive RFC 7643/7644 attribute characteristics gap analysis: all 11 characteristics mapped against current implementation, 15 gaps identified (G1-G15) with severity/effort/remediation, sub-phases 8.1-8.5 defined (~22-30 hrs remaining work), Mermaid diagrams, HTTP request/response examples, DB value representations
- **`docs/phases/PHASE_08_SCHEMA_VALIDATION.md`** (NEW) — Phase 8 implementation documentation with architecture diagrams, issue analysis, and test coverage breakdown
- **`docs/MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md`** — Updated: Phase 8 marked ✅ DONE, new gaps G8c-G8f added for mutability/returned/caseExact enforcement, sub-phases 8.1-8.4 in timeline/overview
- **`docs/INDEX.md`** — Added Migration & Roadmap section and Phase Documentation section with all phase docs

### Changed
- **`api/package.json`** — Version bump from `0.15.0` to `0.17.0`

### Verified
- **1685/1685 unit tests passing** (54 suites) — up from 1429 (+256 new: 179 comprehensive + 60 base + 19 service-level, some from prior Phase 8 implementation)
- **342/342 E2E tests passing** (19 suites) — up from 293 (+49 new)
- **318/318 live integration tests passing** — Docker container rebuilt and verified
- Build clean (TypeScript), zero compilation errors
- Docker containers healthy (postgres:17-alpine + node:24-alpine)

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
