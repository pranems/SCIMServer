# Complete Test Inventory — SCIMServer

> **Generated**: Auto-generated test inventory  
> **Project**: `c:\Users\v-prasrane\source\repos\SCIMServer\api`  
> **Test Framework**: Jest (unit + E2E), PowerShell (live integration)

---

## Summary

| Category | File Count | Approx Test Cases |
|---|---|---|
| Unit Tests (`.spec.ts`) | 73 | ~1,650+ |
| E2E Tests (`.e2e-spec.ts`) | 27 | ~550+ |
| Live Test Sections (`live-test.ps1`) | 38 | ~200+ |
| **Total** | **101 files** | **~2,400+** |

---

## 1. Unit Test Files (73 files)

### 1.1 `src/auth/scim-auth.guard.spec.ts`
- **ScimAuthGuard**
  - `it` should be defined
  - **missing auth header**: should throw UnauthorizedException when no authorization header
  - **invalid auth type**: should reject non-Bearer auth type; should reject missing token after Bearer
  - **OAuth token validation**: should authenticate with valid OAuth token; should call validateAccessToken with the token
  - **legacy bearer token**: should authenticate with legacy bearer token; should not call OAuth validation for legacy token
  - **failed authentication**: should throw UnauthorizedException when OAuth validation fails

### 1.2 `src/domain/patch/extension-and-flags.spec.ts`
- **PatchConfig flag combinations (UserPatchEngine)**
  - **verbosePatch=false, extensionUrns=undefined (defaults)**: resolve enterprise URN path, resolve MSFT custom user URN, resolve MSFT IETF user URN, NOT resolve unknown custom URN, treat dot-notation as literal key
  - **verbosePatch=false, extensionUrns=[] (empty array)**: NOT resolve enterprise URN, NOT resolve unregistered custom URN
  - **verbosePatch=true, extensionUrns=undefined**: resolve dot-notation to nested object, still resolve extension URN, handle dot-notation + extension URN in sequence
  - **verbosePatch=true, extensionUrns=[custom URNs]**: resolve custom URN A/B paths, handle both custom URNs in single PATCH, handle dot-notation alongside custom extension URNs, remove custom extension attribute, handle enterprise + custom + dot-notation + core all in one request
- **No-path merge with extension URN keys (UserPatchEngine)**: resolve enterprise URN key, resolve custom URN key, resolve multiple extension URN keys, resolve extension URN keys + dot-notation
- **Enterprise URN — add operation (UserPatchEngine)**: add enterprise extension attribute, add to existing extension block, overwrite enterprise attribute
- **MSFT test extension URNs (UserPatchEngine)**: replace/add/remove via MSFT custom/IETF URN, handle all three URNs in one request
- **GroupMemberPatchConfig flag matrix**: allowMultiMemberAdd (accept/reject/single), allowMultiMemberRemove (accept/reject/single), allowRemoveAllMembers (clear/reject), mixed flag combinations
- **GroupPatchEngine — MSFT extension URNs**: replace/add/remove via MSFT custom group URN, handle MSFT extension + member ops, no-path with MSFT extension URN key
- **Empty value removal in extension attributes**: remove when null, remove when empty string
- **Complex extension attribute values**: store complex object, store array, replace existing, handle boolean and number values
- **GroupPatchEngine — extension + flag combination flows**: add extension + single member, fail on multi-member add but succeed on extension op, replace extension + displayName + remove member
- **Inactive user + extension attribute operations**: add/remove extension on inactive user, reactivate + add extension + dot-notation
- **Multiple extension blocks in rawPayload** (User + Group): independently update two extension blocks, add to one ext and remove from another

### 1.3 `src/domain/patch/generic-patch-engine.spec.ts`
- **GenericPatchEngine**: deep clone input payload
  - **replace**: replace top-level, nested (dot-notation), entire sub-object, array, without path (merge into root), throw if non-object value
  - **add**: add new top-level, nested (creates intermediates), merge arrays, merge into root, throw if non-object value
  - **remove**: remove top-level, nested (dot-notation), no-op for non-existent path, throw when no path
  - **extension URN paths (DOT separator)**: set/replace/remove field inside extension URN
  - **extension URN paths (COLON separator with extensionUrns)**: add/replace/remove using colon separator, create extension object, prioritize colon over dot, still support dot for non-extension
  - **error handling**: throw for missing op, unsupported op, case-insensitive op names
  - **multiple operations**: apply sequence correctly

### 1.4 `src/domain/patch/group-patch-engine.spec.ts`
- **GroupPatchEngine**
  - **replace operations**: replace displayName (via path, case-insensitively, via no-path string, via no-path object), replace externalId, set externalId null, replace members array, deduplicate, store extra attrs, throw on invalid inputs
  - **add operations**: add single/multiple members, deduplicate, wrap non-array, throw on unsupported path/missing value
  - **remove operations**: remove by value array, by path filter, remove all, reject remove-all when not allowed, multi-member remove accept/reject
  - **multiple operations**: apply mixed sequentially, replace displayName + externalId then add member
  - **error handling**: PatchError for unsupported op, member without value
  - **toMemberDto**: extract value/display/type, throw on null/missing value
  - **ensureUniqueMembers**: keep last duplicate
  - **SCIM Validator multi-op scenarios**: add→remove, replace displayName/externalId via no-path, replace members via path, remove member via value filter, combined replace
  - **extension URN support**: replace/add/remove via URN-prefixed path, resolve extension URN keys in no-path

### 1.5 `src/domain/patch/patch-engine-v19-v20.spec.ts`
- **V19 — prototype pollution guard (UserPatchEngine)**: reject \_\_proto\_\_ in dot-notation, constructor in path, prototype in path, \_\_proto\_\_ as simple path, strip \_\_proto\_\_ from no-path merge objects, allow normal dot-notation
- **V19 — prototype pollution guard (GroupPatchEngine)**: strip \_\_proto\_\_/constructor/prototype from no-path replace objects
- **V19 — deep dot-notation prototype pollution**: reject deeply nested \_\_proto\_\_, constructor in second segment, accept safe multi-segment
- **V20 — reserved attribute stripping (UserPatchEngine)**: strip meta/schemas/id from rawPayload via add/replace ops, allow non-reserved
- **V20 — reserved attribute stripping — additional edge cases**: strip multiple reserved in single no-path, meta via replace with path, schemas via add with path
- **V20 — reserved attribute stripping (GroupPatchEngine)**: strip meta/schemas from no-path replace, pass id through in groups, allow non-reserved

### 1.6 `src/domain/patch/patch-error.spec.ts`
- **PatchError**: extends Error, set name, capture status/detail/scimType, stack trace, different HTTP status codes

### 1.7 `src/domain/patch/user-patch-engine.spec.ts`
- **UserPatchEngine**
  - **replace operations**: active (boolean true, "True", "False", nested), userName, displayName (incl null), externalId, case-insensitive path, arbitrary payload attribute
  - **add operations**: new attribute, active field, no-path add (merge), normalize keys (case-insensitive)
  - **remove operations**: active → false, attribute from rawPayload, throw no path
  - **valuePath handling**: update email via valuePath (replace/add/remove)
  - **extension URN paths**: update/remove extension attribute
  - **dot-notation paths (verbose patch)**: update nested, create nested, ignore when disabled, remove nested
  - **multiple operations**: apply sequentially
  - **reserved attribute stripping**: strip id, userName, externalId, active from payload
  - **error handling**: unsupported op, non-string userName, non-boolean active, correct status/scimType
  - **normalizeObjectKeys**: map known SCIM attrs, preserve unknown keys
  - **stripReservedAttributes**: remove server-managed keys
  - **PATCH on inactive state**: replace displayName, re-activate, valuePath/extension on inactive, multiple ops with reactivation
  - **additional valuePath patterns**: phoneNumbers, replace specific, remove specific, create array
  - **dot-notation + valuePath combinations**: handle both in sequence, extension URN + dot-notation
  - **custom extension URN support**: replace/add/remove custom extension, resolve in no-path, NOT resolve without config

### 1.8 `src/domain/validation/extension-flags-validation.spec.ts`
- **Extension schema — canonical values (V10)**: accept valid, reject non-canonical (strict), accept case-insensitively, reject via PATCH pre-validation, reject invalid employeeType
- **Extension block validation — non-object shapes**: skip array/string/number, accept empty object
- **Immutable extension attributes — checkImmutable**: reject change, accept unchanged, accept absent, accept first-time set
- **Extension validation across strictMode × mode matrix**: valid ext, missing required, unknown ext
- **Multi-extension schemas — flag matrix interactions**: both required, one missing, patch mode permissive, partial, reject/accept unknown URN
- **validatePatchOperationValue — extension complex types**: validate/reject complex, validate/reject integer, validate/reject no-path extension
- **Group schema with custom extension**: validate/reject group extension, accept/reject unknown attrs, validate patch mode
- **Extension attributes — all SCIM types**: accept/reject each type, complex sub-attributes, multi-valued
- **Extension mutability flags across modes**: readOnly/writeOnly/immutable/readWrite on create/replace/patch
- **Error accumulation — core + multiple extensions**: accumulate errors across core + extensions

### 1.9 `src/domain/validation/schema-validator-comprehensive.spec.ts`
- **flag combination matrix**: required attribute enforcement per mode, unknown attribute enforcement per strictMode, valid payload passes all 6 combinations, readOnly attribute rejected on create/replace but not patch
- **exhaustive type validation**: string/boolean/integer/decimal/reference/binary/dateTime (accept/reject each), complex type variations
- **dateTime format edge cases**: extensive date format tests
- **mutability — immutable/writeOnly/readOnly**: allow/reject per operation mode
- **multi-valued arrays — all types**: accept/reject string/integer/decimal/boolean/reference/dateTime/binary arrays, multiple errors
- **core Group schema validation**: valid Group, require displayName, reject non-array members, unknown attributes, empty members
- **extension schema — deep validation**: required extension attrs (create/replace/patch), type validation, readOnly extension, complex sub-attributes, unknown extension attrs, case-insensitive matching
- **custom extension schemas**: validate/reject custom extension
- **multiple extension schemas simultaneously**: two/three extensions, catch errors
- **deeply nested complex sub-attributes**: full name, phoneNumbers, addresses validation
- **error accumulation across core + extension**: collect mixed errors, report paths correctly
- **empty and null extension blocks**: empty/null/array/string blocks
- **realistic SCIM User schema payload**: full real-world payload, minimal payload, type errors, readOnly manager.displayName
- **attribute characteristics**: caseExact, uniqueness, returned, referenceTypes
- **readOnly sub-attributes in multi-valued complex**: members display sub-attr
- **Group schema with extension**: validate/reject Group with custom extension
- **additional edge cases**: undefined values, 0, negative integer, empty string, false, MAX_SAFE_INTEGER, NaN, Infinity, deeply nested unknown, large number of attributes, large multi-valued array, unregistered extension URN, only extension block, scimType in errors
- **multi-valued complex — mixed valid and invalid**: report errors per element
- **patch mode — permissive required checking**: skip required on patch, still enforce type/strict
- **validation error structure**: include path/message/scimType, array index, extension URN prefix

### 1.10 `src/domain/validation/schema-validator-v16-v32.spec.ts`
- **SchemaValidator.collectBooleanAttributeNames (V16)**: collect top-level/sub-attribute booleans, NOT string, from extensions, lowercase, empty set, deduplicate, empty list, not collect complex/integer
- **SchemaValidator.validateFilterAttributePaths (V32)**: accept known core/dotted/reserved/meta paths, reject unknown top-level/sub-attribute/meta, accept extension URN, reject unknown extension, handle mix, empty list, validate against Group, reject User-only against Group
- **SchemaValidator.collectReturnedCharacteristics (G8e)**: collect returned:never/request, from multiple schemas, from sub-attributes, lowercase, ignore always/default, empty list, without returned property, case-insensitive, from real User schema

### 1.11 `src/domain/validation/schema-validator-v2-v10-v25-v31.spec.ts`
- **V2 — validatePatchOperationValue**: pass/reject simple string, complex sub-attribute, no-path object, skip remove, value-filter paths, extension attribute, unknown paths
- **V9 — required sub-attribute enforcement**: reject missing required on create, pass when present, skip on patch
- **V10 — canonical value enforcement**: pass/reject canonical values, sub-attribute
- **V25 — schemas array validation**: reject non-string, unknown URN (strict), pass valid, reject non-array
- **V31 — strict xsd:dateTime format validation**: accept valid ISO 8601 (Z, offset, fractional), reject date-only/no-timezone/non-string/garbage
- **V2 — additional cases**: add operation, no-path add with extension, multi-valued attribute array, canonical via PATCH
- **V9 — required sub-attributes in multi-valued and extension**: reject multi-valued complex missing required, extension complex missing required
- **V25 — schemas in non-strict mode**: accept unknown URN, accept empty schemas
- **V31 — dateTime additional edge cases**: negative offset, fractional + positive offset, out-of-range month, space separator
- **G8c — readOnly attribute rejection in PATCH**: path-based (replace/add/remove readOnly, allow readWrite, sub-attr, extension, value-filter), no-path (reject/allow readOnly core/extension, skip reserved keys), case-insensitive, remove operations

### 1.12 `src/domain/validation/schema-validator.spec.ts`
- **SchemaValidator**: valid payloads (minimal, all required, optional omitted, null optional, skip reserved)
  - **required attributes**: missing on create/replace, NOT on patch, multiple missing, case-insensitive
  - **type checking**: each type (string/boolean/integer/decimal/reference/binary/dateTime/complex) accept/reject, unknown type
  - **mutability constraints**: readOnly rejected on create/replace, allow readWrite/writeOnly/immutable
  - **multi-valued enforcement**: reject/accept non-array/array/empty, reject array for single-valued, validate each element
  - **strict mode — unknown attributes**: ignore/reject unknown, multiple unknown, not flag reserved
  - **sub-attribute validation**: validate/reject sub-attrs, unknown sub-attrs strict/non-strict
  - **extension schema validation**: validate under URN key, wrong type, missing required, absent block, unknown extension attrs
  - **case-insensitive attribute matching**: attribute names, sub-attribute names
  - **multi-valued complex elements**: validate each, reject invalid sub-attr
  - **edge cases**: empty schemas, only reserved keys, multiple schemas, no matching schema, collect all errors
  - **checkImmutable**: no immutable attrs, first write, unchanged, changed, omitted, null, extension, multi-valued complex, multiple violations, case-insensitive, same complex, changed complex
  - **collectReturnedCharacteristics — R-MUT-1 writeOnly**: writeOnly → never, explicitly never, not readWrite/readOnly
  - **collectReturnedCharacteristics — R-RET-3 alwaysSubs**: sub-attrs with returned:always, no always sub-attrs
  - **collectCaseExactAttributes — R-CASE-1**: top-level, sub-attr dotted path, both parent and sub, empty set
  - **collectReadOnlyAttributes — R-MUT-2 sub-attrs**: readOnly sub-attrs within readWrite parents (core/extension), NOT sub-attrs of readOnly parents

### 1.13 `src/infrastructure/repositories/inmemory/inmemory-endpoint-resource-type.repository.spec.ts`
- **InMemoryEndpointResourceTypeRepository**: create (generated UUID, reject duplicate name, reject duplicate path), findByEndpointId (return all, empty for unknown), findAll (all records), findByEndpointAndName (find/return null), deleteByEndpointAndName (delete/return false), deleteByEndpointId (delete all/return 0)

### 1.14 `src/infrastructure/repositories/inmemory/inmemory-endpoint-schema.repository.spec.ts`
- **InMemoryEndpointSchemaRepository**: create (generated id, unique constraint, allow same URN different endpoints, default nulls), findByEndpointId (return matching, empty, sorted), findAll (all/empty), findByEndpointAndUrn (find/null), deleteByEndpointAndUrn (delete/false), deleteByEndpointId (delete all/0)

### 1.15 `src/infrastructure/repositories/inmemory/inmemory-generic-resource.repository.spec.ts`
- **InMemoryGenericResourceRepository**: create (auto-generated fields), findByScimId (find, null for wrong resourceType/endpointId), findAll (all records, not cross-resourceType, apply dbFilter), update (update + increment version, throw non-existent), delete (delete, no-op non-existent), findByExternalId (find, null wrong endpoint), findByDisplayName (find, null non-matching)

### 1.16 `src/infrastructure/repositories/inmemory/inmemory-group.repository.spec.ts`
- **InMemoryGroupRepository**: create (complete record, unique ids, detached copy), findByScimId (found, null, isolate by endpointId), findWithMembers (empty/include members, null, detached), findAllWithMembers (only endpoint groups, correct member counts, sort asc/desc, apply filter, empty), update (update + bump updatedAt, throw non-existent), delete (remove, cascade-delete members, idempotent), findByDisplayName (conflict/null/exclude/cross-endpoint), findByExternalId (match/null/exclude/cross-endpoint), addMembers (add, unique ids, createdAt, preserve fields, empty), updateGroupWithMembers (update + replace members, clear members, not affect others), clear (remove all)

### 1.17 `src/infrastructure/repositories/inmemory/inmemory-user.repository.spec.ts`
- **InMemoryUserRepository**: create (complete record, unique ids, detached copy), findByScimId (found, null, isolate, detached), findAll (only endpoint, empty, sort asc/desc, filter, empty filter, detached), update (update + bump, throw, detached), delete (remove, idempotent), findConflict (userName case-insensitive, externalId, null, exclude, cross-endpoint, prioritize userName, missing externalId), findByScimIds (resolve matching, empty input, skip not found, isolate), clear (remove all)

### 1.18 `src/infrastructure/repositories/inmemory/prisma-filter-evaluator.spec.ts`
- **matchesPrismaFilter**: simple equality (string, case-sensitive, boolean, multiple, empty), equals (CITEXT mode case-insensitive/sensitive), not operator (differs, equals, case-insensitive, case-sensitive, {not:null}), contains (case-insensitive/sensitive, absent, non-string), startsWith (match/non-match), endsWith (match/non-match), ordered comparisons (gt/gte/lt/lte with numbers/strings), AND compound (all match, any fails, nested operators), OR compound (any match, none match), nested compound (AND containing OR)

### 1.19 `src/infrastructure/repositories/prisma/prisma-endpoint-schema.repository.spec.ts`
- **PrismaEndpointSchemaRepository**: create (correct data, map record, default nulls, default required), findByEndpointId (query matching, mapped records, empty), findAll (no where, map all, empty), findByEndpointAndUrn (composite key, mapped/null), deleteByEndpointAndUrn (delete/false), deleteByEndpointId (deleteMany/0), record mapping (preserve JSONB, empty attributes)

### 1.20 `src/infrastructure/repositories/prisma/prisma-group.repository.spec.ts`
- **PrismaGroupRepository (Phase 2 — unified table)**: create (insert with resourceType "Group", map row), findByScimId (with resourceType, null non-UUID, null not found), findWithMembers (null non-UUID, include membersAsGroup, map ResourceMember, handle null memberResourceId), findAllWithMembers (include resourceType + membersAsGroup, merge dbFilter, map all), update (by id), delete (by id), findByDisplayName (scope to Group, exclude scimId), findByExternalId (scope to Group, mapped), addMembers (insert into resourceMember, skip empty), updateGroupWithMembers (transaction, no members when empty)

### 1.21 `src/infrastructure/repositories/prisma/prisma-user.repository.spec.ts`
- **PrismaUserRepository (Phase 2 — unified table)**: create (insert with resourceType "User", map row), findByScimId (with resourceType filter, null non-UUID, null not found, mapped), findAll (include resourceType, merge dbFilter, custom orderBy, map all), update (by id), delete (by id), findConflict (scope to User, check userName/externalId, exclude scimId, mapped/null), findByScimIds (empty input, with resourceType, filter non-UUID, empty when all non-UUID)

### 1.22 `src/infrastructure/repositories/prisma/uuid-guard.spec.ts`
- **isValidUuid**: accept v4 (lowercase/uppercase/mixed), v1, v7, nil-equivalent; reject empty, plain text, slug, without hyphens, extra chars, wrong segment, invalid hex, numeric, spaces

### 1.23 `src/infrastructure/repositories/repository.module.spec.ts`
- **RepositoryModule**: inmemory backend (provide InMemory repos), INMEMORY case-insensitive, prisma backend (provide Prisma repos), unset default (Prisma), register() module shape (global:true, PrismaModule import presence)

### 1.24 `src/modules/activity-parser/activity.controller.spec.ts`
- **ActivityController**
  - **hideKeepalive=true**: exclude keepalive, correct pagination, no empty pages, all logs are keepalive
  - **hideKeepalive=false or undefined**: include all, default behavior
  - **keepalive detection logic**: filter using Prisma WHERE conditions
  - **integration with search**: apply hideKeepalive with search query
  - **Prisma WHERE clause structure**: construct proper nested AND/OR conditions

### 1.25 `src/modules/auth/shared-secret.guard.spec.ts`
- **SharedSecretGuard**: defined; public routes (allow without/with auth); missing auth (reject without header, non-Bearer); legacy bearer (authenticate, not call OAuth); OAuth validation (authenticate, try OAuth first, reject both fail); auto-generated secret in dev mode; per-endpoint credentials (skip when disabled, authenticate valid, fall back to legacy/OAuth, handle errors, work without repo)

### 1.26 `src/modules/database/database.controller.spec.ts`
- **DatabaseController**: defined; getUsers (default pagination, custom page/limit, search, parse active boolean); getGroups (default, custom, search); getUserDetails (by id, return); getGroupDetails (by id, return); getStatistics (return, call service)

### 1.27 `src/modules/database/database.service.spec.ts`
- **DatabaseService**: getUsers (query User, calculate skip, add search filter, filter active, select relations, return metadata, parse JSONB); getGroups (query Group, search filter, count, map memberCount); getUserDetails (query by id, throw not found, include relations); getGroupDetails (query by id, throw, include relations); getStatistics (count users/active/groups, structure)

### 1.28 `src/modules/endpoint/controllers/endpoint.controller.spec.ts`
- **EndpointController**: createEndpoint (create, propagate BadRequestException for invalid name/duplicate); listEndpoints (all/active/inactive, empty); getEndpoint (by ID, NotFoundException); getEndpointByName (by name, NotFoundException); updateEndpoint (displayName/config/active, NotFoundException, BadRequestException); deleteEndpoint (delete, NotFoundException); getEndpointStats (stats, zero counts, NotFoundException)

### 1.29 `src/modules/endpoint/endpoint-config.interface.spec.ts`
- **ENDPOINT_CONFIG_FLAGS**: all expected keys
- **getConfigBoolean**: undefined/non-existent/boolean true/false/strings "true"/"True"/"TRUE"/"false"/"False"/"1"/"0"/other/number/object, MultiOpPatch flag
- **getConfigString**: undefined/non-existent/string/boolean/number/object/custom flags
- **validateEndpointConfig**: undefined/empty config; validation for each of 14+ flags (MultiOpPatchAdd/Remove, PatchOpAllowRemoveAllMembers, VerbosePatchSupported, logLevel, UserSoftDeleteEnabled, StrictSchemaValidation, AllowAndCoerceBooleanStrings, RequireIfMatch, ReprovisionOnConflict, CustomResourceTypesEnabled, BulkOperationsEnabled, PerEndpointCredentialsEnabled, IncludeWarningAboutIgnoredReadOnlyAttribute, IgnoreReadOnlyAttributesInPatch) — each with boolean/string/invalid/error message tests
- **DEFAULT_ENDPOINT_CONFIG**: expected defaults, logLevel undefined
- **getConfigBooleanWithDefault**: undefined/missing/actual/parse strings/default for AllowAndCoerceBooleanStrings

### 1.30 `src/modules/endpoint/endpoint-context.storage.spec.ts`
- **EndpointContextStorage**: setContext/getContext (set/retrieve, undefined, overwrite); getEndpointId (return, undefined); getBaseUrl (return, undefined); getConfig (return, undefined config/no config); addWarnings/getWarnings (empty, accumulate, empty input, no store); createMiddleware (wrap next, mutate store, propagate warnings, preserve across setContext); run (scope to callback, support warnings)

### 1.31 `src/modules/endpoint/services/endpoint.service.spec.ts`
- **EndpointService**:
  - **createEndpoint config validation**: accept "True"/"False"/boolean/lowercase/"1"/"0", reject "Yes"/"No"/"enabled"/number/object, helpful error message
  - **updateEndpoint config validation**: accept on update, reject invalid, allow without config
  - **name validation**: reject spaces/special/empty, accept hyphens/underscores, reject duplicate
  - **getEndpoint**: by ID, NotFoundException, parse config, handle null config
  - **getEndpointByName**: by name, NotFoundException
  - **listEndpoints**: all/active/inactive/empty
  - **deleteEndpoint**: delete existing, NotFoundException
  - **getEndpointStats**: stats, zero counts, NotFoundException
  - **logLevel syncing**: createEndpoint with/without logLevel, reject invalid, accept numeric; updateEndpoint with/without logLevel; deleteEndpoint cleanup; onModuleInit restore (restore, skip without/null config, empty list, DB errors, malformed config)

### 1.32 `src/modules/logging/log-config.controller.spec.ts`
- **LogConfigController**: getConfig (current config, string level names, all levels, all categories, category overrides, endpoint overrides); updateConfig (global level, includePayloads/includeStackTraces/maxPayloadSizeBytes/format, category levels, ignore invalid categories, empty body, non-boolean); setGlobalLevel (set, case-insensitive); setCategoryLevel (set, unknown category, all valid); setEndpointLevel (set, update underlying); clearEndpointLevel (remove, no-op); getRecentLogs (entries, limit, filter by level/category/requestId/endpointId, empty); clearRecentLogs (clear ring buffer); streamLogs (SSE headers, initial event, stream real-time, filter by level/category/endpointId, unsubscribe); downloadLogs (NDJSON default, JSON format, valid NDJSON, filter, include timestamp, respect limit)

### 1.33 `src/modules/logging/log-levels.spec.ts`
- **parseLogLevel**: undefined/empty → INFO, parse TRACE/DEBUG/INFO/WARN/ERROR/FATAL/OFF (case-insensitive), whitespace, numeric strings, out-of-range, unknown
- **logLevelName**: string name for each level, UNKNOWN for invalid
- **LogCategory**: 14 categories, all expected values
- **buildDefaultLogConfig**: default INFO, respect LOG_LEVEL, json in production, LOG_FORMAT, payloads in prod/dev, stacks, max payload size, category levels, invalid/malformed category levels

### 1.34 `src/modules/logging/request-logging.interceptor.spec.ts`
- **RequestLoggingInterceptor**: defined, set X-Request-Id, propagate existing x-request-id, log incoming request, log response with status, record request, log errors and re-throw, run within correlation context, extract endpoint ID from URL, handle URLs without endpoint ID, pass through response body

### 1.35 `src/modules/logging/scim-logger.service.spec.ts`
- **ScimLogger**: construction (instantiable, default config from env); configuration (getConfig, updateConfig, setGlobalLevel string/enum, setCategoryLevel, setEndpointLevel, clearEndpointLevel, setConfig); correlation context (getContext outside, runWithContext, no leak, enrichContext, no-op outside, return callback result); isEnabled (global level, category override, endpoint override, OFF, TRACE); logging methods (trace/debug/info/warn/error/fatal, not emit when suppressed, include correlation context, non-Error/null error, additional data); sanitization (redact sensitive, truncate large strings/objects, pass through small); stack traces (include/strip); ring buffer (store, limit, filter by level/category/requestId/endpointId, clear, evict oldest, combine filters); pretty output (info/debug/warn/error); json output (valid JSON stdout/stderr, ISO-8601 timestamp); subscribe (notify, stop after unsubscribe, multiple subscribers, only enabled levels)

### 1.36 `src/modules/prisma/prisma.service.spec.ts`
- **PrismaService**: constructor (fallback URL, DATABASE_URL, empty string, PrismaPg adapter, max 5 connections); onModuleInit (skip connect inmemory/INMEMORY, connect prisma, connect unset); onModuleDestroy (skip disconnect inmemory, both disconnect + pool.end for prisma, always pool.end)

### 1.37 `src/modules/scim/common/base-url.util.spec.ts`
- **buildBaseUrl**: from request protocol+host, https, x-forwarded-proto, x-forwarded-host, both x-forwarded, custom API_PREFIX, default scim prefix

### 1.38 `src/modules/scim/common/scim-attribute-projection.spec.ts`
- **applyAttributeProjection**: return as-is when neither param; as-is when both undefined
  - **attributes parameter**: include only specified + always-returned, always include schemas/id/meta/userName for users, never exclude userName, include displayName for groups, dotted sub-attribute paths, case-insensitive, non-existent attr, full + sub attribute
  - **excludedAttributes parameter**: exclude specified, never exclude always-returned (user/group), dotted sub-paths, case-insensitive
  - **precedence**: attributes over excludedAttributes per RFC 7644
  - **applyAttributeProjectionToList**: as-is when no params, apply projection/exclusion to all, strip request-only attrs
  - **with requestOnlyAttrs (G8e)**: strip/include request-only attrs, case-insensitive, extension URN objects
  - **P2 R-RET-1: schema-driven always-returned**: keep schema-declared always attrs, not exclude, merge with base
  - **P2 R-RET-2: Group active always-returned**: not exclude via excludedAttributes, always include with attributes param
  - **P2 R-RET-3: sub-attr returned:always**: include always sub-attrs with requested sub-attrs, all with entire attr, single-valued complex
  - **stripReturnedNever (G8e)**: strip top-level, inside extension URN, case-insensitive, return as-is when empty/null/undefined, strip multiple, not strip non-matching, mutate in-place

### 1.39 `src/modules/scim/common/scim-errors.spec.ts`
- **createScimError**: return HttpException, set status code, include SCIM error schema/detail/scimType, omit scimType when not provided, convert status to string, handle various status codes

### 1.40 `src/modules/scim/common/scim-service-helpers.spec.ts`
- **parseJson**: parse valid, return {} for null/undefined/empty/invalid, parse arrays
- **ensureSchema**: pass when present, case-insensitive, throw 400 when missing/undefined/empty
- **enforceIfMatch**: pass match, throw 412 mismatch, pass wildcard, pass not provided not required, throw 428 RequireIfMatch, not throw RequireIfMatch=false
- **sanitizeBooleanStrings**: convert "True"/"False", case-insensitive, not convert non-boolean keys, nested objects, arrays, non-string values, empty booleanKeys
- **ScimSchemaHelpers**: enforceStrictSchemaValidation (nothing when off, pass valid, throw undeclared, throw unregistered); buildSchemaDefinitions (core + extension, empty); getExtensionUrns; getSchemaDefinitions; getBooleanKeys; getReturnedCharacteristics (never/request); getRequestOnlyAttributes; coerceBooleanStringsIfEnabled (coerce default, skip when false); validatePayloadSchema; checkImmutableAttributes
- **SCIM_WARNING_URN**: expected string
- **stripReadOnlyAttributes**: strip core readOnly (id, meta, groups), not strip readWrite, strip extension readOnly, empty when none, case-insensitive; R-MUT-2 readOnly sub-attrs (manager.displayName, emails[].display, not strip readWrite sub-attrs, extension URN complex)
- **stripReadOnlyPatchOps**: strip path-based readOnly, NEVER strip id, strip readOnly from no-path, keep id in no-path, strip entire no-path if all readOnly, pass through readWrite, pass array values; R-MUT-2 sub-attrs in PATCH (strip path-based readOnly sub-attr, strip from no-path complex, pass through readWrite)

### 1.41 `src/modules/scim/common/scim-sort.util.spec.ts`
- **resolveUserSortParams**: default createdAt asc, default asc, map userName/id/externalId/displayName/meta.created/meta.lastModified, descending/ascending, fall back unknown, map active
- **resolveGroupSortParams**: default createdAt asc, map displayName/id/meta.created, descending, fall back, case-insensitive

### 1.42 `src/modules/scim/controllers/admin-credential.controller.spec.ts`
- **AdminCredentialController**: createCredential (create + return plaintext, reject when disabled/empty config, reject invalid type/expiresAt format/past date, accept future date/oauth_client, NotFoundException for non-existent endpoint); listCredentials (list without hashes, empty array); revokeCredential (deactivate, NotFoundException for non-existent/different endpoint)

### 1.43 `src/modules/scim/controllers/admin-resource-type.controller.spec.ts`
- **AdminResourceTypeController**: POST (register + return, hydrate registry, NotFoundException unknown endpoint, ForbiddenException flag disabled, BadRequestException reserved User/Group/paths, ConflictException duplicate, allow without extensions/description); GET list (list all, empty, NotFoundException); GET by name (return specific, NotFoundException); DELETE (remove + 204, remove from registry, BadRequestException reserved, NotFoundException)

### 1.44 `src/modules/scim/controllers/admin-schema.controller.spec.ts`
- **AdminSchemaController**: POST (register + return, hydrate registry, NotFoundException, ConflictException duplicate); GET list (list all, empty, NotFoundException); GET by URN (return specific, NotFoundException); DELETE (remove + 204, remove from registry, NotFoundException)

### 1.45 `src/modules/scim/controllers/admin.controller.spec.ts`
- **AdminController**: defined; clearLogs, listLogs (parsed query params, undefined query), getLog (return by id, NotFoundException), deleteUser (by id/scimId, NotFoundException), createManualUser (minimal, optional fields), createManualGroup (displayName, with memberIds), getVersion (structure, service metadata, runtime metadata, auth config, mask DATABASE_URL, APP_VERSION env)

### 1.46 `src/modules/scim/controllers/endpoint-scim-bulk.controller.spec.ts`
- **EndpointScimBulkController**: BulkOperationsEnabled flag gate (403 not set/"False"/false, proceed "True"/true/"1"); endpoint validation (403 inactive); schema validation (400 missing); payload size guard (413 exceeds max); successful processing (delegate to BulkProcessorService, failOnErrors=0 default)

### 1.47 `src/modules/scim/controllers/endpoint-scim-discovery.controller.spec.ts`
- **EndpointScimDiscoveryController**: GET Schemas (return definitions, validate endpoint); GET ResourceTypes (return types); GET ServiceProviderConfig (return config, bulk.supported false/true); GET Schemas/:uri (return single, 404); GET ResourceTypes/:id (return single, 404); Endpoint Validation (reject inactive, include name in error, throw non-existent); Multi-Tenant Discovery (pass endpointId to schemas/resourceTypes/schemaByUrn/resourceTypeById, pass config to SPC, different configs → different SPCs, set endpoint context)

### 1.48 `src/modules/scim/controllers/endpoint-scim-groups.controller.spec.ts`
- **EndpointScimGroupsController**: POST Groups (create in endpoint); GET Groups/:id (get, attribute projection, excludedAttributes); GET Groups (list, attribute projection); POST Groups/.search (search, excludedAttributes); PATCH Groups/:id (patch); PUT Groups/:id (replace); DELETE Groups/:id (delete); Endpoint Validation (exists, reject inactive, include name, allow active); G8e returned:request (POST strip, GET list/single pass requestOnlyAttrs, PUT strip); G8g write-response projection (POST/PUT/PATCH with attributes/excludedAttributes, without query params, both attributes+excludedAttributes, returned:request included when requested/stripped, always-returned protection)

### 1.49 `src/modules/scim/controllers/endpoint-scim-users.controller.spec.ts`
- **EndpointScimUsersController**: POST Users (create); GET Users/:id (get, attribute/excludedAttributes projection); GET Users (list, projection); POST Users/.search (search, projection); PATCH Users/:id (patch); PUT Users/:id (replace); DELETE Users/:id (delete); Endpoint Validation (exists, reject inactive, include name, allow active); G8e returned:request (POST strip, GET list/single passRequestOnlyAttrs, PUT strip); G8g write-response projection (POST/PUT/PATCH with attributes/excludedAttributes, without params, both params, returned:request included/stripped, always-returned, dotted sub-attribute path)

### 1.50 `src/modules/scim/controllers/resource-types.controller.spec.ts`
- **ResourceTypesController**: defined; getResourceTypes (ListResponse schema, 2 resource types, User type, Enterprise User extension, Group type with msfttest extensions, pagination, schemas[] on each D5); getResourceTypeById (User, Group, 404 SCIM error, schemas[] D5, schema extensions)

### 1.51 `src/modules/scim/controllers/schemas.controller.spec.ts`
- **SchemasController**: defined; getSchemas (ListResponse schema, 7 definitions, User/EnterpriseUser/Group schema ids, userName/displayName/active/emails/Group displayName attributes, pagination, schemas[] D4); getSchemaByUri (User, EnterpriseUser, Group, 404, schemas[] D4)

### 1.52 `src/modules/scim/controllers/scim-me.controller.spec.ts`
- **ScimMeController**: GET /Me (return authenticated user, attributes query param); PUT /Me (replace, pass If-Match); PATCH /Me (patch); DELETE /Me (delete); identity resolution errors (404 legacy auth, undefined oauth, missing sub, no matching User, ForbiddenException inactive)

### 1.53 `src/modules/scim/controllers/service-provider-config.controller.spec.ts`
- **ServiceProviderConfigController**: defined; getConfig (correct schema, patch/bulk/filter/changePassword/sort/etag support, OAuth auth scheme, primary:true D6, meta with resourceType, documentationUri, bulk maxOperations/maxPayloadSize)

### 1.54 `src/modules/scim/discovery/scim-discovery.service.spec.ts`
- **ScimDiscoveryService**: getSchemas (ListResponse, 7 definitions, Core User/EnterpriseUser/Group schemas, meta.resourceType, startIndex/itemsPerPage, User attrs with name subAttributes, caseExact on name/addresses sub-attrs, uniqueness on externalId/userName, id/meta common attrs, $ref on Group members, Group displayName uniqueness, Group externalId uniqueness); getSchemaByUrn (User/EnterpriseUser/Group, 404, schemas[] D4); getResourceTypes (ListResponse with 2 types, User with Enterprise extension, Group with msfttest extensions, meta.resourceType); getResourceTypeById (User, Group, 404, schemas[] D5, schema extensions on User); getServiceProviderConfig (correct schema, patch/filter/etag/bulk support, meta.resourceType, documentationUri, OAuth auth, primary:true D6, new object each call, bulk.supported per config flags); buildResourceSchemas (only core, include enterprise extension, undefined/empty payload, multiple URNs, no duplicate core, Group, only keys in payload); Multi-Tenant Discovery (endpointId passthrough for schemas/resourceTypes/schemaByUrn/resourceTypeById/SPC)

### 1.55 `src/modules/scim/discovery/scim-schema-registry.spec.ts`
- **ScimSchemaRegistry**: built-in schemas (7 schemas, 2 resource types, Enterprise User extension, msfttest extensions, extension URN, core schemas); registerExtension (register, getSchema, auto-populate meta, preserve custom meta, attach to resource type, respect required, include in URNs, no duplicate, multiple extensions, registration on Group, throw missing id/overwrite core/non-existent resource type, without attaching to RT); unregisterExtension (remove schema/extension/URN, false for non-existent, throw for core); query methods (unknown URN/id, hasSchema, extension URNs for resource type, SPC returns copy); per-endpoint extensions (register scoped, not affect others, merge global+endpoint schemas/URNs/RTs, endpoint-specific getSchema, unregister without affecting global, false non-existent, clear all, list endpoint IDs, throw non-existent RT/empty id/overwrite core, different endpoints different extensions); onModuleInit DB hydration (hydrate from DB, attach to correct RT, multiple across endpoints, skip without repo, empty DB, DB errors, null fields, non-array attributes); registerResourceType (register, visible in getAllResourceTypes, retrievable via getResourceType, NOT leak to other endpoints/global, require endpointId/id/name); unregisterResourceType (remove, no-op non-existent); getCustomResourceTypes (only custom, empty for no custom); findResourceTypeByEndpointPath (find custom, NOT find built-in, undefined for unknown path)

### 1.56 `src/modules/scim/dto/create-endpoint-resource-type.dto.spec.ts`
- **CreateEndpointResourceTypeDto**: pass complete valid, required fields only, empty/without optional fields; fail missing/empty/spaces/number-start/special-chars name; pass alphanumeric name; fail missing/no-leading-slash/just-slash/special endpoint; fail missing/empty schemaUri; pass long description, fail exceeding max

### 1.57 `src/modules/scim/dto/create-endpoint-schema.dto.spec.ts`
- **CreateEndpointSchemaDto**: pass complete valid, required fields only, empty attributes; schemaUrn (fail missing/empty/long/non-string); name (fail missing/empty/long); description (pass omitted, fail non-string); resourceTypeId (pass omitted, fail long); required (pass omitted/true, fail non-boolean); attributes (fail missing/non-array); SchemaAttributeDto (pass valid/all optional, fail missing name/type, non-boolean multiValued/required, accept nested subAttributes)

### 1.58 `src/modules/scim/dto/dto-hardening.spec.ts`
- **V15 — PatchOperationDto.op @IsIn**: accept add/Replace, reject delete/patch
- **V14 — PatchUserDto/PatchGroupDto.Operations @ArrayMaxSize**: accept 1/1000, reject >1000
- **V28 — CreateUserDto.userName @IsNotEmpty**: accept non-empty, reject empty/whitespace
- **V7 — GroupMemberDto.value @IsNotEmpty**: accept non-empty, reject empty
- **V5 — SearchRequestDto**: accept valid, reject invalid sortOrder/startIndex/count, accept empty; @MaxLength (attributes/excludedAttributes/filter/sortBy)
- **CreateGroupDto — displayName @IsNotEmpty**: reject empty, accept non-empty
- **V15 additional**: accept remove/Remove/Add, reject empty string/numeric op
- **CreateUserDto additional**: reject empty schemas, non-boolean active, accept boolean, reject non-string/accept string externalId
- **CreateGroupDto schemas @ArrayNotEmpty**: reject empty, accept non-empty
- **GroupMemberDto field type**: reject non-string display/type, accept valid member

### 1.59 `src/modules/scim/filters/apply-scim-filter.spec.ts`
- **apply-scim-filter**
  - **buildUserFilter**: empty filter for no/undefined filter, push eq on userName/externalId/id/displayName, case-insensitive attribute, preserve value case, push co/sw/ew/ne/gt/ge/lt/le/pr, push active eq true/false, push AND/OR compound, push AND with co+eq, fall back to in-memory for non-indexed, fall back AND/OR un-pushable, throw invalid filter, in-memory match
  - **buildGroupFilter**: empty for no filter, push eq displayName/externalId/id, case-insensitive, preserve value case, push co/sw/ne/pr on displayName/externalId, fall back for userName, throw invalid, in-memory evaluate, externalId case-sensitive (preserve value, push mixed case, uppercase attribute, co/sw case-sensitive)
  - **User externalId case-sensitive**: push eq uppercase, push UPPERCASE attribute, push co/sw case-sensitive

### 1.60 `src/modules/scim/filters/scim-exception.filter.spec.ts`
- **ScimExceptionFilter**: defined; SCIM error responses (Content-Type, status as string, preserve body, 409 conflict, 500 ISE); Non-SCIM HttpExceptions (wrap generic, handle object-based, fallback to error field)

### 1.61 `src/modules/scim/filters/scim-filter-parser.spec.ts`
- **ScimFilterParser**: parseScimFilter — simple comparisons (eq/ne/co/sw/ew/gt/ge/lt/le/pr, boolean/false/null/numeric, dotted path, case-insensitive operators); logical expressions (AND, OR, precedence, chained AND); NOT and grouping (NOT, grouped, complex grouping); value paths (basic, compound filter); URN paths (URN-prefixed attribute); error handling (empty/unterminated/missing value/unexpected token)
  - **evaluateFilter**: eq (case-insensitive, different value, boolean, null missing), ne (differ/equal), co (substring, case-insensitive), sw (prefix/non-prefix), ew (suffix), gt/ge/lt/le (dates, le), pr (present/missing/non-empty/empty array), AND (both/one side), OR (either/neither), NOT (negate both), dotted paths (nested/meta), value paths (match/no match/compound/partial fail), URN paths (extension/nested), complex real-world filters (Entra ID, compound OR+pr, deeply nested); R-CASE-1 (case-sensitive eq/co/sw for caseExact, case-insensitive for non-caseExact, propagate through AND/OR/NOT); resolveAttrPath (top-level/dotted/undefined/URN/case-insensitive); depth guard V12 (moderate nesting, exceed MAX_FILTER_DEPTH, deeply nested parens, exactly 50 levels); extractFilterPaths (single/multiple/deduplicate/valuePath/NOT/pr/dotted/URN)

### 1.62 `src/modules/scim/interceptors/scim-content-type.interceptor.spec.ts`
- **ScimContentTypeInterceptor**: defined; intercept (set Content-Type, not set if already sent, pass through data, list responses, error responses, set Location header on 201 User/Group, NOT set Location on 200/201 without meta.location, NOT for non-SCIM routes, NOT for root route)

### 1.63 `src/modules/scim/interceptors/scim-etag.interceptor.spec.ts`
- **ScimEtagInterceptor**: defined; ETag header (set from meta.version, not set when absent, pass through non-object); If-None-Match (304 when match, return data when no match, not trigger 304 for non-GET); assertIfMatch (no throw when no header/no version/match/wildcard, throw 412 mismatch)

### 1.64 `src/modules/scim/services/bulk-processor.service.spec.ts`
- **parseBulkPath**: collection/resource paths for Users/Groups, without leading slash, resource ID with slashes
- **BulkProcessorService**: POST Users (create/fail no data/reject with ID); PUT Users (replace/reject without ID/data); PATCH Users (patch); DELETE Users (delete/reject without ID); Group operations (POST/PUT/PATCH/DELETE); Unsupported resource type; bulkId cross-referencing (resolve in path, in data, error on unresolved); failOnErrors (stop after threshold, process all when 0); error handling (HttpException details, generic Error, unknown error types); version pass-through (PUT If-Match, DELETE If-Match); response schema (BulkResponse schema URN); mixed operations (multiple across Users and Groups)

### 1.65 `src/modules/scim/services/endpoint-scim-generic.service.spec.ts`
- **EndpointScimGenericService**: createResource (create + return, throw 400 missing schema); getResource (return by scimId, throw 404); listResources (return ListResponse, empty list, apply pagination); replaceResource (replace + return, throw 404, allow duplicate externalId); patchResource (apply + return, throw 400 missing PatchOp schema, throw 404, return 400 invalid PATCH, allow duplicate displayName); deleteResource (hard-delete, throw 404)

### 1.66 `src/modules/scim/services/endpoint-scim-groups.service.spec.ts`
- **EndpointScimGroupsService**: ~170+ tests covering:
  - **createGroupForEndpoint**: create, create with members
  - **getGroupForEndpoint**: retrieve by scimId, throw 404
  - **listGroupsForEndpoint**: list, filter by displayName
  - **patchGroupForEndpoint**: update displayName, return 200 OK, add/remove members; MultiOpPatch flags (reject/allow multi-member add/remove, always allow single, multiple separate ops, PatchOpAllowRemoveAllMembers); no-path replace (displayName object, externalId, combined, path replace, string value, members array, invalid type, unsupported path); 404 not found, unsupported patch op
  - **replaceGroupForEndpoint**: replace
  - **deleteGroupForEndpoint**: delete, 404; hard delete (gated by GroupHardDeleteEnabled)
  - **endpoint isolation**: cross-endpoint access, same displayName cross-endpoint, members from same endpoint
  - **case-insensitivity (RFC 7643)**: filter attribute names (mixed case, all caps), externalId filter, case-sensitive externalId; case-insensitive schema URI
  - **externalId column support**: store on create, return in response, omit when null, reject duplicate, update via PATCH replace/no-path
  - **strict schema validation**: create (reject undeclared extension strict, allow when OFF/undefined); replace (reject undeclared); schema attribute type validation (reject wrong type/unknown/non-array, accept valid, error detail, NOT reject when OFF); replace wrong type; dynamic schemas[] in response (include/not include extension URNs)
  - **DELETE + GET/LIST interactions (Groups)**: hard-delete GET 404, double-delete 404, exclude from LIST, active attribute, PATCH/PUT on deleted 404
  - **config flag combinations**: StrictSchema, hard-delete despite other flags, reject unknown extension
  - **ETag & Conditional Requests**: patchGroup (match/mismatch/428 no header/wildcard), replaceGroup (match/mismatch/428), deleteGroup (match/mismatch/428), ETag format W/"v{N}"
  - **AllowAndCoerceBooleanStrings**: create (coerce "True"/"False", reject when disabled, coerce complex sub-attrs, not coerce non-boolean, pass through without extension); replace (coerce/reject); patch (coerce in replace value/post-PATCH/add); flag interaction matrix (StrictSchema×Coerce combinations)
  - **G8e — returned characteristic filtering**: strip returned:never, getRequestOnlyAttributes
  - **G8f — uniqueness enforcement on PUT/PATCH**: replace (reject displayName/externalId conflict, allow self-update, pass excludeScimId, skip null externalId); patch (reject displayName/externalId conflict, allow self, pass excludeScimId, skip null externalId)

### 1.67 `src/modules/scim/services/endpoint-scim-users.service.spec.ts`
- **EndpointScimUsersService**: ~150+ tests covering:
  - **createUserForEndpoint**: create, enforce unique userName; Schema-driven uniqueness for custom extensions
  - **getUserForEndpoint**: retrieve, 404
  - **listUsersForEndpoint**: list, filter by userName, pagination
  - **patchUserForEndpoint**: update active, update userName (uniqueness, no-path replace, externalId+active via no-path), valuePath emails, enterprise extension URN (add/remove/replace), remove manager empty value, remove valuePath entry, throw no path/unsupported op/404, multiple operations, add non-reserved, update externalId via path, remove simple attribute, strip reserved from rawPayload; dot-notation (name.givenName verbose/disabled, create nested, not clobber siblings, remove, all name sub-attrs)
  - **replaceUserForEndpoint**: replace
  - **deleteUserForEndpoint**: delete, 404; deactivation via PATCH active=false (gated by UserSoftDeleteEnabled), hard-delete via DELETE
  - **endpoint isolation**: cross-endpoint, same userName cross-endpoint
  - **case-insensitivity (RFC 7643)**: filter attribute names (mixed case, all caps, EXTERNALID), case-insensitive userName filter value, case-insensitive userName uniqueness (reject case diff, query case-insensitive), case-insensitive schema URI, no-path key normalization (mixed case, DISPLAYNAME)
  - **SCIM ID leak prevention**: create (not leak client-supplied id, strip from rawPayload), toScimUserResource (use scimId, include in meta.location), PATCH strip id from no-path replace
  - **strict schema validation**: create (allow declared+registered, reject undeclared, reject unregistered, allow when OFF/undefined); replace (reject undeclared, allow valid); schema attribute type validation (reject boolean/name/unknown core attrs, error detail, NOT reject when OFF, reject on replace, accept valid with all core types, reject wrong sub-attr email/non-array email, validate enterprise extension)
  - **deactivation + GET/LIST/filter interactions**: 404 for inactive user, return when off, exclude/include in LIST, filter active eq false/true, re-activate via PATCH, PATCH displayName on inactive, deactivate then GET 404, GET without config, double-delete 404, PATCH/PUT on inactive 404, hard-delete 404, compound filter active+userName
  - **config flag combinations**: UserSoftDeleteEnabled + StrictSchema both true, enforce strict PATCH with deactivation, reject unknown extension, allow valid extension with all flags
  - **ETag & Conditional Requests**: patchUser (match/mismatch/428/RequireIfMatch=false/wildcard), replaceUser (match/mismatch/428), deleteUser (match/mismatch/428), ETag format W/"v{N}", W/"v1" for new resources
  - **AllowAndCoerceBooleanStrings**: create (coerce "True"/"False", reject when disabled, not coerce non-boolean); replace (coerce/reject); flag interaction matrix (StrictSchema×Coerce combinations)
  - **G8e — returned characteristic filtering**: strip password from response/create, preserve non-password, getRequestOnlyAttributes

### 1.68 `src/modules/scim/services/sanitize-boolean-strings.spec.ts`
- **sanitizeBooleanStrings — schema-aware (V16/V17)**: convert "true"/"false" for boolean keys, case-insensitively, NOT convert non-boolean keys, recurse nested, handle already-boolean/null/undefined/numeric/non-true-false, deeply nested, not touch non-boolean keys, empty booleanKeys, empty object, mixed array items

### 1.69 `src/modules/scim/services/scim-metadata.service.spec.ts`
- **ScimMetadataService**: buildLocation (build URL, strip trailing slash, without trailing slash, different resource types, UUIDs); currentIsoTimestamp (valid ISO 8601, close to now)

### 1.70 `src/modules/scim/utils/scim-patch-path.spec.ts`
- **scim-patch-path utilities**: isValuePath (brackets true/false, extension URN false); parseValuePath (emails/addresses, without sub-attribute, null for simple/empty/malformed/missing bracket, co/sw/ne operators, case-insensitive); isExtensionPath (enterprise true, URN itself false, simple false, valuePath false, case-insensitive, mixed casing); parseExtensionPath (manager/department, null URN itself/unrecognised, mixed-case, all-lowercase); matchesFilter (eq case-insensitive, different values, missing attribute, coerce non-string, unsupported operator fallback, null, case-mismatched attribute, uppercase, case-mismatched different value, boolean true/false against string, unsupported operator boolean); applyValuePathUpdate (update matching, no modify when missing/no match, replace entire element, update addresses, skip non-object, only first matching); removeValuePathEntry (remove sub-attr, remove entire element, no-op no match/no array); applyExtensionUpdate (add to existing, create if not exist, replace, handle string, remove for empty value/""/null/{value:null}, NOT remove non-empty); removeExtensionAttribute (remove, no-op when absent, leave empty); addValuePathEntry (create array, add new element, update existing, replace entire, create criteria, handle phoneNumbers); applyExtensionUpdate — manager string wrapping (wrap string, NOT wrap non-manager, pass through object); resolveNoPathValue (dot-notation to nested, create nested, resolve extension URN, flat keys, mixed types, not clobber siblings, wrap manager URN, custom extension URN keys, NOT resolve without extensionUrns)

### 1.71 `src/modules/web/web.controller.spec.ts`
- **WebController**: defined; serveWebApp (call res.sendFile with index.html)

### 1.72 `src/oauth/oauth.controller.spec.ts`
- **OAuthController**: testEndpoint (health check); getToken (return token, call with correct params, reject unsupported grant_type/missing client_id/client_secret, 401 when throws, pass scope/undefined scope)

### 1.73 `src/oauth/oauth.service.spec.ts`
- **OAuthService**: constructor (configured client, default scopes, parse comma-separated scopes, auto-generate secret non-prod, throw in prod); generateAccessToken (valid token, sign JWT correct payload, reject invalid client_id/secret, grant all/filter scopes, grant all for unrecognized scopes); validateAccessToken (valid decode, invalid token, expired token); hasScope (true has, false lacks, false empty/undefined)

---

## 2. E2E Test Files (27 files)

### 2.1 `test/e2e/admin-schema.e2e-spec.ts`
- **Admin Schema Extensions API (E2E)**: Authentication (POST/GET/DELETE require auth); POST schemas (register 201, reject duplicate 409, 404 non-existent endpoint, allow same URN different endpoints, without optional fields); GET list (empty, list registered, not show other endpoints, 404); GET by URN (return specific, 404); DELETE (delete 204, 404 non-existent); Discovery integration (show in /Schemas, remove after DELETE, not show in other endpoint)

### 2.2 `test/e2e/admin-version.e2e-spec.ts`
- **Admin Version API (E2E)**: require authentication; return full running instance metadata

### 2.3 `test/e2e/advanced-patch.e2e-spec.ts`
- **Advanced PATCH Operations (E2E)**: no path (merge replace/add, case-insensitive keys); valuePath (update emails[type eq "work"].value); extension URN path (add/replace enterprise extension); Manager empty-value removal; Multiple operations (apply atomically); Case-insensitive filter attribute names (UPPERCASE, PascalCase, case-insensitive values)

### 2.4 `test/e2e/attribute-projection.e2e-spec.ts`
- **Attribute Projection (E2E)**: GET Users/Users/:id/Groups/Groups/:id with attributes/excludedAttributes params; Precedence rules
- **G8g — Write-response projection**: POST/PUT/PATCH Users/Groups with attributes/excludedAttributes, both params (attributes takes precedence), always-returned protection, dotted sub-attribute path

### 2.5 `test/e2e/authentication.e2e-spec.ts`
- **Authentication (E2E)**: POST /oauth/token (issue token, reject invalid secret/unsupported grant_type/missing client_id); Auth Guard (reject without auth/malformed, accept OAuth/legacy); Public routes (allow /oauth/token and /oauth/test without auth)

### 2.6 `test/e2e/bulk-operations.e2e-spec.ts`
- **Bulk Operations (Phase 9) E2E**: Config flag gating (403 not set/False, succeed True); User CRUD via Bulk (POST/PUT/PATCH/DELETE); Group CRUD via Bulk (POST/DELETE); bulkId cross-referencing (resolve in path/data, error unresolved); failOnErrors (stop after threshold, process all 0); Request validation (reject POST with ID, DELETE without ID, unsupported resource); Mixed operations; ServiceProviderConfig (bulk.supported=true); Response format (BulkResponse schema, bulkId echo, version ETag, SCIM error details); Uniqueness collision (409 duplicate userName)

### 2.7 `test/e2e/config-flags.e2e-spec.ts`
- **Config Flags (E2E)**: MultiOpPatchAdd (accept/reject multi-member); MultiOpPatchRemove (accept/reject multi-member); PatchOpAllowRemoveAllMembers (block/allow blanket remove, allow targeted); VerbosePatchSupported dot-notation (name.givenName/middleName add/remove, standard paths); Flag Combinations (StrictSchema+BooleanStrings, StrictSchema+BooleanStrings OFF, MultiOp both, RequireIfMatch+VerbosePatch, UserSoftDeleteEnabled+deactivation, invalid config rejection)

### 2.8 `test/e2e/custom-resource-types.e2e-spec.ts`
- **Custom Resource Types (G8b) E2E**: Config flag gating; Admin API (register 201, reject reserved User/Group/paths, reject duplicate, reject invalid name/endpoint format, 404 non-existent endpoint, require auth); Admin list/get (list all, get by name, 404); Admin delete (delete 204, reject built-in, 404); Generic SCIM CRUD (POST/GET/list/PUT/PATCH/DELETE, 404, reject wrong schemas); Endpoint isolation; Built-in routes protection (Users/Groups still work); Multiple custom resource types on one endpoint

### 2.9 `test/e2e/discovery-endpoints.e2e-spec.ts`
- **Discovery Endpoints (E2E)**: GET ServiceProviderConfig (valid config, all capability fields, meta with resourceType); GET Schemas (definitions, totalResults including core+extension, caseExact on name/addresses sub-attrs, uniqueness on User/Group externalId, $ref on Group members, Group displayName uniqueness); GET ResourceTypes (User+Group, endpoint+schema, Enterprise User extension); Unauthenticated (ServiceProviderConfig/Schemas/ResourceTypes root+endpoint-scoped); GET Schemas/:uri D2 (root+endpoint-scoped, 404); GET ResourceTypes/:id D3 (User/Group root+endpoint-scoped, 404); schemas[] on discovery resources D4+D5; primary flag on authenticationSchemes D6; Endpoint-Specific Discovery (SPC reflects config, two endpoints different configs, Schemas/ResourceTypes endpoint-scoped, individual lookups, unauthenticated)

### 2.10 `test/e2e/edge-cases.e2e-spec.ts`
- **Edge Cases (E2E)**: Malformed input (missing schemas, empty body, no userName/displayName); Boundary values (count=0, large startIndex); Special characters (unicode userName/displayName, special chars); Idempotency (204 first delete, 404 second); Inactive endpoint; Uniqueness (duplicate externalId, case-insensitive userName); Large payloads (many emails); Empty/no-op PATCH (empty Operations, remove non-existent, merge add no path); Filter edge cases (non-existent value); PascalCase PATCH op values (Replace, Add)

### 2.11 `test/e2e/endpoint-isolation.e2e-spec.ts`
- **Endpoint Isolation (E2E)**: not share users/groups between endpoints, allow same userName/displayName on different endpoints, not return user from A when querying B

### 2.12 `test/e2e/etag-conditional.e2e-spec.ts`
- **ETag & Conditional Requests (E2E)**: ETag header presence (GET Users/:id,Groups/:id, meta.version match); If-None-Match (304 match, 200 no match); ETag changes after modification (different after PATCH, 200 with old ETag); ETag on write operations (POST/PUT/PATCH); Version-based ETag format (W/"v{N}", start at v1, increment after PATCH/PUT, increment groups); If-Match enforcement (allow match, 412 mismatch on PATCH/PUT/DELETE, wildcard, concurrent modification, Groups); RequireIfMatch flag (428 no If-Match on PATCH/PUT/DELETE, succeed when provided, allow POST without If-Match)

### 2.13 `test/e2e/filter-operators.e2e-spec.ts`
- **Filter Operators (E2E)**: co (contains substring, case-insensitive); sw (matching/non-matching prefix); pr (externalId/displayName present); Compound and (both conditions, second fails); Group filters (displayName co, externalId eq)

### 2.14 `test/e2e/group-lifecycle.e2e-spec.ts`
- **Group Lifecycle (E2E)**: POST (create 201, with members, 409 duplicate displayName); GET by id (retrieve, 404); GET list (list response, filter displayName eq); PUT (replace preserving id, 404, 409 displayName conflict, allow self-update, allow duplicate externalId uniqueness:none); PATCH membership (add/remove member, replace displayName, 404, 409 displayName conflict, allow duplicate externalId uniqueness:none, allow unique displayName); DELETE (delete 204, 404, idempotent 404)

### 2.15 `test/e2e/log-config.e2e-spec.ts`
- **Log Configuration API (E2E)**: GET log-config (200, string levels, 7 available levels, 12 categories, require auth); PUT log-config (update global/multiple fields, persist changes); PUT level/:level (set, case-insensitive); PUT category/:category/:level (set, unknown category error, reflect in GET); PUT endpoint/:endpointId/:level (set, reflect in config); DELETE endpoint/:endpointId (remove 204); GET recent (entries, limit, filter by level/category); DELETE recent (clear 204); GET download (NDJSON default, JSON format, requestId filter, require auth); GET stream (require auth); X-Request-Id correlation (echo back, generate when none)

### 2.16 `test/e2e/me-endpoint.e2e-spec.ts`
- **/Me Endpoint (RFC 7644 §3.11) E2E**: GET /Me (return user matching sub claim, attributes param, 404 no match, 404 legacy auth); PATCH /Me (update authenticated user, verify changes persist); PUT /Me (replace); DELETE /Me (delete, 404 subsequent GET); cross-validation with Users endpoint (same resource as GET /Users/{id})

### 2.17 `test/e2e/p2-attribute-characteristics.e2e-spec.ts`
- **P2 Attribute Characteristics (E2E)**: R-RET-2 Group active always returned (GET/:id, GET list, GET with attributes=); R-RET-1 Schema-driven returned:always (GET Groups attributes=externalId still includes displayName, excludedAttributes does NOT exclude always); R-RET-3 Sub-attr returned:always (emails.type→emails.value, members.display→members.value); R-MUT-1 writeOnly=returned:never (POST with password never returns, GET attributes=password); R-MUT-2 readOnly sub-attr stripping (POST manager.displayName stripped, PATCH manager.displayName stripped); R-CASE-1 caseExact-aware filter (externalId exact case, userName case-insensitive); Write-response projection (POST/PUT/PATCH with attributes/excludedAttributes); Projection edge cases (password never, id/schemas always, empty attributes=, mixed case attributes=)

### 2.18 `test/e2e/per-endpoint-credentials.e2e-spec.ts`
- **Per-Endpoint Credentials (E2E)**: Admin CRUD (create + plaintext token, list without hashes, revoke/deactivate, reject when disabled, reject invalid type, 404 non-existent endpoint); Per-Endpoint Authentication (authenticate with credential, still allow OAuth/legacy, reject invalid/revoked, CRUD operations with credential); Fallback when disabled (allow OAuth/legacy); Credential Expiry (create with future expiry, reject past expiry)

### 2.19 `test/e2e/readonly-stripping.e2e-spec.ts`
- **ReadOnly Attribute Stripping (RFC 7643 §2.2)**: POST Users (strip id/meta/groups, preserve readWrite); PUT Users (strip id+meta); PATCH Users (strip readOnly path-based, strip from no-path, return 400 targeting id); POST Groups (assign server UUID); Warning URN (include when enabled+stripped, NOT when disabled/no attrs/PUT+stripped/PATCH+stripped); PATCH readOnly behavior matrix (strict ON + IgnorePatchRO OFF → 400, strict ON + IgnorePatchRO ON → strip, strict OFF → strip silently)

### 2.20 `test/e2e/returned-characteristic.e2e-spec.ts`
- **Returned Attribute Characteristic (G8e E2E)**: returned:never — password stripped from all responses (POST/GET/:id/GET list/PUT/PATCH/POST .search, GET ?attributes=password); password in schema discovery (returned:never in /Schemas)

### 2.21 `test/e2e/rfc-compliance.e2e-spec.ts`
- **RFC Compliance (E2E)**: RFC 7644 §3.1 (201 Created, meta.location, Location header for Users/Groups); §3.4.2 (ListResponse schema, totalResults/startIndex/itemsPerPage, 1-based startIndex); §3.5.2 (PatchOp schema required, add/replace operations); §3.6 (204 No Content); §3.12 (Error schema, status as string, detail); §2.4 meta attribute (resourceType/created/lastModified/location, Group meta); §2.1 case-insensitive attributes (filter userName, reject duplicate); Content-Type (GET/POST/error responses, 409); §3.12 409 error format; meta.lastModified (update on PATCH, not on GET); HTTP error status coverage (404 unknown path, 401 no auth POST/GET, 404 non-existent user/group, 400 missing userName/displayName); Content-Type Acceptance (application/json, application/scim+json); SCIM status always string (409, 404, 400)

### 2.22 `test/e2e/schema-validation.e2e-spec.ts`
- **Schema Validation (E2E)**: Complex attribute type (reject name as string/number/array, accept valid); Multi-valued enforcement (reject emails/phoneNumbers/members as non-array, accept valid); Unknown attribute rejection (reject/accept strict/lenient, multiple unknown, Group unknown); Sub-attribute type (reject wrong name.givenName/emails[].value/non-boolean primary, accept correct); Enterprise extension type (accept valid, reject wrong type/unknown/manager as string, accept valid manager, reject employeeNumber number); Group schema (accept/members valid); PUT validation (reject unknown/name as string, accept valid, reject Group unknown); Error response format (SCIM error, descriptive detail, scimType); Strict on/off comparison (user/group unknown attr/wrong type); Extension URN edge cases (reject without declaring, accept declaring without body, reject multiple unknown, accept known Enterprise); Complex realistic payloads (fully populated valid/wrong-type/unknown core); Cross-resource isolation (Users/Groups independently, accept after reject); DTO implicit conversion (active truthy string, userName number, group displayName number); Reserved keys (client-supplied id/meta accepted → server overrides); G8c readOnly PATCH (reject replace/add/remove/no-path readOnly with 400, allow readWrite, accept when strict off)

### 2.23 `test/e2e/scim-validator-compliance.e2e-spec.ts`
- **SCIM Validator Compliance (E2E)**: Required User CRUD (create 201, 409 duplicate, delete + 404 re-GET); Required User Filter (filter eq, non-existing, different case); Required User PATCH (replace multiple verbose, update userName no-path, disable active, add attrs verbose, add/replace/remove manager via extension URN); Required Group CRUD (create 201, 409 duplicate, get excluding members, delete + 404); Required Group Filter (filter externalId excluding/full members, non-existing, exact case, NOT match different case user/group); Required Group PATCH (replace displayName/externalId, add/remove member); Preview User PATCH multi-op (add+replace+remove one, remove→add→replace on same attr); Preview DELETE non-existent (User/Group 404); Preview DELETE same twice (User/Group 204+404); Preview Group PATCH multi-op (add+remove member); Case-sensitive externalId uniqueness (allow same in different case for Users/Groups)

### 2.24 `test/e2e/search-endpoint.e2e-spec.ts`
- **POST /.search (E2E)**: POST Users/.search (ListResponse schema, HTTP 200, application/scim+json, attributes projection, excludedAttributes, list all, respect count); POST Groups/.search (ListResponse, excludedAttributes=members)

### 2.25 `test/e2e/soft-delete-flags.e2e-spec.ts`
- **Delete Lifecycle, Flag Combinations & PATCH Paths (E2E)**: Hard Delete — Users (hard-delete 204+404, double-delete 404, exclude from LIST, filter active eq false/true, 404 PATCH re-activate); Hard Delete — Groups (hard-delete, double-delete, exclude from LIST, active attribute); PATCH on hard-deleted users (404 displayName/valuePath/extension URN/dot-notation); Config flag combinations (UserSoftDeleteEnabled+StrictSchema, UserSoftDeleteEnabled+MultiOpPatch, UserSoftDeleteEnabled=False+StrictSchema=True, UserSoftDeleteEnabled+VerbosePatch+RemoveAll=False, all flags enabled); StrictSchemaValidation (reject/allow unknown extension); PATCH path patterns (valuePath phoneNumber replace/add, valuePath address remove, chain valuePath+extension+no-path); AllowAndCoerceBooleanStrings (accept "True"/"False", reject when OFF+Strict, coerce on PUT/PATCH, PATCH filter roles, StrictSchema×Coerce matrix, preserve non-boolean, Groups extension boolean strings); Settings v7 — POST collision always 409 (no reprovision) (Users/Groups)

### 2.26 `test/e2e/sorting.e2e-spec.ts`
- **Sorting (RFC 7644 §3.4.2.3) E2E**: ServiceProviderConfig (sort supported); GET Users with sortBy (userName asc default/desc, displayName asc, fall back unknown, case-insensitive, combine with pagination/filter); POST Users/.search (sortBy asc/desc); GET Groups with sortBy (displayName asc/desc); POST Groups/.search (asc/desc)

### 2.27 `test/e2e/user-lifecycle.e2e-spec.ts`
- **User Lifecycle (E2E)**: POST (create 201, 409 duplicate, 400 missing schemas, store externalId, ignore client-supplied id, GET by server-assigned id); GET by id (retrieve, 404); GET list (totalResults, paginate, filter userName eq, empty list); PUT (replace preserving id, update lastModified, 404, ignore client id in PUT body); PATCH (replace attribute, deactivate active, 404, not allow id override via no-path); DELETE (delete 204, 404, idempotent 404)

---

## 3. Live Test Sections (38 sections in `scripts/live-test.ps1`)

| # | Line | Section Name |
|---|---|---|
| 1 | 281 | TEST SECTION 1: ENDPOINT CRUD OPERATIONS |
| 2 | 331 | TEST SECTION 2: CONFIG VALIDATION |
| 3 | 431 | TEST SECTION 3: SCIM USER OPERATIONS |
| 4 | 513 | TEST SECTION 3b: CASE-INSENSITIVITY (RFC 7643 S2.1) |
| 5 | 579 | TEST SECTION 3c: ADVANCED PATCH OPERATIONS |
| 6 | 722 | TEST SECTION 3d: PAGINATION & ADVANCED FILTERING |
| 7 | 785 | TEST SECTION 3e: SCIM ID LEAK PREVENTION (Issue 16) |
| 8 | 861 | TEST SECTION 4: SCIM GROUP OPERATIONS |
| 9 | 995 | TEST SECTION 4b: SCIM VALIDATOR MULTI-OP PATCH |
| 10 | 1117 | TEST SECTION 5: MULTI-MEMBER PATCH CONFIG FLAG |
| 11 | 1217 | TEST SECTION 5b: MULTI-MEMBER REMOVE CONFIG FLAG |
| 12 | 1315 | TEST SECTION 6: ENDPOINT ISOLATION |
| 13 | 1354 | TEST SECTION 7: INACTIVE ENDPOINT BLOCKING |
| 14 | 1433 | TEST SECTION 8: SCIM DISCOVERY ENDPOINTS |
| 15 | 1453 | TEST SECTION 8b: CONTENT-TYPE & AUTH VERIFICATION |
| 16 | 1510 | TEST SECTION 9: ERROR HANDLING |
| 17 | 1661 | TEST SECTION 9b: RFC 7644 COMPLIANCE CHECKS |
| 18 | 1736 | TEST SECTION 9c: POST /.search (RFC 7644 S3.4.3) |
| 19 | 1835 | TEST SECTION 9d: ATTRIBUTE PROJECTION (RFC 7644 S3.4.2.5) |
| 20 | 1905 | TEST SECTION 9e: ETag & CONDITIONAL REQUESTS (RFC 7644 S3.14) |
| 21 | 1985 | TEST SECTION 9f: PatchOpAllowRemoveAllMembers FLAG |
| 22 | 2073 | TEST SECTION 9g: FILTER OPERATORS (co, sw, pr, and) |
| 23 | 2122 | TEST SECTION 9h: EDGE CASES |
| 24 | 2187 | TEST SECTION 9i: VerbosePatchSupported DOT-NOTATION |
| 25 | 2260 | TEST SECTION 9j: LOG CONFIGURATION API |
| 26 | 2499 | TEST SECTION 9k: PER-ENDPOINT LOG LEVEL VIA ENDPOINT CONFIG |
| 27 | 2647 | TEST SECTION 9f: AllowAndCoerceBooleanStrings |
| 28 | 2868 | TEST SECTION 9l: RETURNED CHARACTERISTIC FILTERING (G8e / RFC 7643 S2.4) |
| 29 | 4151 | TEST SECTION 9n: BULK OPERATIONS (Phase 9 / RFC 7644 §3.7) |
| 30 | 4600 | TEST SECTION 9o: GROUP UNIQUENESS ON PUT/PATCH (G8f) |
| 31 | 4743 | TEST SECTION 9p: WRITE-RESPONSE ATTRIBUTE PROJECTION (G8g) |
| 32 | 4913 | TEST SECTION 9q: SORTING (Phase 12 / RFC 7644 S3.4.2.3) |
| 33 | 5028 | TEST SECTION 9r: /Me ENDPOINT (Phase 10 / RFC 7644 S3.11) |
| 34 | 5127 | TEST SECTION 9s: PER-ENDPOINT CREDENTIALS (Phase 11 / G11) |
| 35 | 5269 | TEST SECTION 9t: READONLY ATTRIBUTE STRIPPING (RFC 7643 §2.2) |
| 36 | 5478 | TEST SECTION 9u: SCHEMA ATTRIBUTE CHARACTERISTICS (P1 / RFC 7643 §2) |
| 37 | 5542 | TEST SECTION 9v: P2 ATTRIBUTE CHARACTERISTICS (RFC 7643 §2) |
| 38 | 5707 | TEST SECTION 10: DELETE OPERATIONS |

---

## File Index (alphabetical)

### Unit Test Files
| # | File Path |
|---|---|
| 1 | `src/auth/scim-auth.guard.spec.ts` |
| 2 | `src/domain/patch/extension-and-flags.spec.ts` |
| 3 | `src/domain/patch/generic-patch-engine.spec.ts` |
| 4 | `src/domain/patch/group-patch-engine.spec.ts` |
| 5 | `src/domain/patch/patch-engine-v19-v20.spec.ts` |
| 6 | `src/domain/patch/patch-error.spec.ts` |
| 7 | `src/domain/patch/user-patch-engine.spec.ts` |
| 8 | `src/domain/validation/extension-flags-validation.spec.ts` |
| 9 | `src/domain/validation/schema-validator-comprehensive.spec.ts` |
| 10 | `src/domain/validation/schema-validator-v16-v32.spec.ts` |
| 11 | `src/domain/validation/schema-validator-v2-v10-v25-v31.spec.ts` |
| 12 | `src/domain/validation/schema-validator.spec.ts` |
| 13 | `src/infrastructure/repositories/inmemory/inmemory-endpoint-resource-type.repository.spec.ts` |
| 14 | `src/infrastructure/repositories/inmemory/inmemory-endpoint-schema.repository.spec.ts` |
| 15 | `src/infrastructure/repositories/inmemory/inmemory-generic-resource.repository.spec.ts` |
| 16 | `src/infrastructure/repositories/inmemory/inmemory-group.repository.spec.ts` |
| 17 | `src/infrastructure/repositories/inmemory/inmemory-user.repository.spec.ts` |
| 18 | `src/infrastructure/repositories/inmemory/prisma-filter-evaluator.spec.ts` |
| 19 | `src/infrastructure/repositories/prisma/prisma-endpoint-schema.repository.spec.ts` |
| 20 | `src/infrastructure/repositories/prisma/prisma-group.repository.spec.ts` |
| 21 | `src/infrastructure/repositories/prisma/prisma-user.repository.spec.ts` |
| 22 | `src/infrastructure/repositories/prisma/uuid-guard.spec.ts` |
| 23 | `src/infrastructure/repositories/repository.module.spec.ts` |
| 24 | `src/modules/activity-parser/activity.controller.spec.ts` |
| 25 | `src/modules/auth/shared-secret.guard.spec.ts` |
| 26 | `src/modules/database/database.controller.spec.ts` |
| 27 | `src/modules/database/database.service.spec.ts` |
| 28 | `src/modules/endpoint/controllers/endpoint.controller.spec.ts` |
| 29 | `src/modules/endpoint/endpoint-config.interface.spec.ts` |
| 30 | `src/modules/endpoint/endpoint-context.storage.spec.ts` |
| 31 | `src/modules/endpoint/services/endpoint.service.spec.ts` |
| 32 | `src/modules/logging/log-config.controller.spec.ts` |
| 33 | `src/modules/logging/log-levels.spec.ts` |
| 34 | `src/modules/logging/request-logging.interceptor.spec.ts` |
| 35 | `src/modules/logging/scim-logger.service.spec.ts` |
| 36 | `src/modules/prisma/prisma.service.spec.ts` |
| 37 | `src/modules/scim/common/base-url.util.spec.ts` |
| 38 | `src/modules/scim/common/scim-attribute-projection.spec.ts` |
| 39 | `src/modules/scim/common/scim-errors.spec.ts` |
| 40 | `src/modules/scim/common/scim-service-helpers.spec.ts` |
| 41 | `src/modules/scim/common/scim-sort.util.spec.ts` |
| 42 | `src/modules/scim/controllers/admin-credential.controller.spec.ts` |
| 43 | `src/modules/scim/controllers/admin-resource-type.controller.spec.ts` |
| 44 | `src/modules/scim/controllers/admin-schema.controller.spec.ts` |
| 45 | `src/modules/scim/controllers/admin.controller.spec.ts` |
| 46 | `src/modules/scim/controllers/endpoint-scim-bulk.controller.spec.ts` |
| 47 | `src/modules/scim/controllers/endpoint-scim-discovery.controller.spec.ts` |
| 48 | `src/modules/scim/controllers/endpoint-scim-groups.controller.spec.ts` |
| 49 | `src/modules/scim/controllers/endpoint-scim-users.controller.spec.ts` |
| 50 | `src/modules/scim/controllers/resource-types.controller.spec.ts` |
| 51 | `src/modules/scim/controllers/schemas.controller.spec.ts` |
| 52 | `src/modules/scim/controllers/scim-me.controller.spec.ts` |
| 53 | `src/modules/scim/controllers/service-provider-config.controller.spec.ts` |
| 54 | `src/modules/scim/discovery/scim-discovery.service.spec.ts` |
| 55 | `src/modules/scim/discovery/scim-schema-registry.spec.ts` |
| 56 | `src/modules/scim/dto/create-endpoint-resource-type.dto.spec.ts` |
| 57 | `src/modules/scim/dto/create-endpoint-schema.dto.spec.ts` |
| 58 | `src/modules/scim/dto/dto-hardening.spec.ts` |
| 59 | `src/modules/scim/filters/apply-scim-filter.spec.ts` |
| 60 | `src/modules/scim/filters/scim-exception.filter.spec.ts` |
| 61 | `src/modules/scim/filters/scim-filter-parser.spec.ts` |
| 62 | `src/modules/scim/interceptors/scim-content-type.interceptor.spec.ts` |
| 63 | `src/modules/scim/interceptors/scim-etag.interceptor.spec.ts` |
| 64 | `src/modules/scim/services/bulk-processor.service.spec.ts` |
| 65 | `src/modules/scim/services/endpoint-scim-generic.service.spec.ts` |
| 66 | `src/modules/scim/services/endpoint-scim-groups.service.spec.ts` |
| 67 | `src/modules/scim/services/endpoint-scim-users.service.spec.ts` |
| 68 | `src/modules/scim/services/sanitize-boolean-strings.spec.ts` |
| 69 | `src/modules/scim/services/scim-metadata.service.spec.ts` |
| 70 | `src/modules/scim/utils/scim-patch-path.spec.ts` |
| 71 | `src/modules/web/web.controller.spec.ts` |
| 72 | `src/oauth/oauth.controller.spec.ts` |
| 73 | `src/oauth/oauth.service.spec.ts` |

### E2E Test Files
| # | File Path |
|---|---|
| 1 | `test/e2e/admin-schema.e2e-spec.ts` |
| 2 | `test/e2e/admin-version.e2e-spec.ts` |
| 3 | `test/e2e/advanced-patch.e2e-spec.ts` |
| 4 | `test/e2e/attribute-projection.e2e-spec.ts` |
| 5 | `test/e2e/authentication.e2e-spec.ts` |
| 6 | `test/e2e/bulk-operations.e2e-spec.ts` |
| 7 | `test/e2e/config-flags.e2e-spec.ts` |
| 8 | `test/e2e/custom-resource-types.e2e-spec.ts` |
| 9 | `test/e2e/discovery-endpoints.e2e-spec.ts` |
| 10 | `test/e2e/edge-cases.e2e-spec.ts` |
| 11 | `test/e2e/endpoint-isolation.e2e-spec.ts` |
| 12 | `test/e2e/etag-conditional.e2e-spec.ts` |
| 13 | `test/e2e/filter-operators.e2e-spec.ts` |
| 14 | `test/e2e/group-lifecycle.e2e-spec.ts` |
| 15 | `test/e2e/log-config.e2e-spec.ts` |
| 16 | `test/e2e/me-endpoint.e2e-spec.ts` |
| 17 | `test/e2e/p2-attribute-characteristics.e2e-spec.ts` |
| 18 | `test/e2e/per-endpoint-credentials.e2e-spec.ts` |
| 19 | `test/e2e/readonly-stripping.e2e-spec.ts` |
| 20 | `test/e2e/returned-characteristic.e2e-spec.ts` |
| 21 | `test/e2e/rfc-compliance.e2e-spec.ts` |
| 22 | `test/e2e/schema-validation.e2e-spec.ts` |
| 23 | `test/e2e/scim-validator-compliance.e2e-spec.ts` |
| 24 | `test/e2e/search-endpoint.e2e-spec.ts` |
| 25 | `test/e2e/soft-delete-flags.e2e-spec.ts` |
| 26 | `test/e2e/sorting.e2e-spec.ts` |
| 27 | `test/e2e/user-lifecycle.e2e-spec.ts` |

### Live Test Script
| File Path |
|---|
| `scripts/live-test.ps1` (38 sections, ~5,700+ lines) |
