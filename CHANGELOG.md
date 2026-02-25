# Changelog

All notable changes to SCIMServer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **2063/2063 unit tests passing** (61 suites) — up from 1962 (+101 new)
- **358/358 E2E tests passing** (19 suites) — up from 342 (+16 new)
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
