# Feature Documentation: Soft Delete, Strict Schema Validation & Custom Extension URNs

> **Cross-reference**: For strict schema validation internals and custom extension registration details, see [`SCHEMA_LIFECYCLE_AND_REGISTRY.md`](SCHEMA_LIFECYCLE_AND_REGISTRY.md) and [`SCHEMA_CUSTOMIZATION_GUIDE.md`](SCHEMA_CUSTOMIZATION_GUIDE.md). This document remains the canonical reference for the **UserSoftDeleteEnabled** feature.

> **Version**: 2.0  
> **Date**: 2026-04-09  
> **Status**: Updated for Settings v7  
> **Config flags**: `UserSoftDeleteEnabled`, `StrictSchemaValidation`  
> **Extension URNs**: 4 msfttest schemas registered globally

---

## Table of Contents

1. [Overview](#1-overview)
2. [Feature 1 - Soft / Hard Delete](#2-feature-1--soft--hard-delete)
3. [Feature 2 - Strict Schema Validation](#3-feature-2--strict-schema-validation)
4. [Feature 3 - Custom Extension URNs (msfttest)](#4-feature-3--custom-extension-urns-msfttest)
5. [Architecture & Flow Diagrams](#5-architecture--flow-diagrams)
6. [Configuration Reference](#6-configuration-reference)
7. [API Request / Response Examples](#7-api-request--response-examples)
8. [Database Impact](#8-database-impact)
9. [Test Coverage](#9-test-coverage)
10. [Files Modified](#10-files-modified)

---

## 1. Overview

Three features were implemented to bring the SCIM Server closer to production-ready compliance and Microsoft Entra ID test compatibility:

| Feature | Config Flag | Default | Purpose |
|---------|-------------|---------|---------|
| User Deactivation Gate | `UserSoftDeleteEnabled` | `true` | Controls whether PATCH active=false is allowed |
| Strict Schema Validation | `StrictSchemaValidation` | `false` | Enforce that extension URNs in request body are declared in `schemas[]` AND registered |
| Custom Extension URNs | *(built-in)* | Always registered | 4 msfttest extension schemas pre-registered for Microsoft Entra ID compliance testing |

> **Settings v7 change:** Soft-delete has been removed. DELETE always hard-deletes. `UserSoftDeleteEnabled` now controls whether PATCH active=false is allowed. `ReprovisionOnConflictForSoftDeletedResource` and `deletedAt` have been removed. `guardSoftDeleted()` no longer exists.

All features are **per-endpoint** - each SCIM endpoint can independently enable/disable these behaviors via its config object.

---

## 2. Feature 1 - User Deactivation Gate

### 2.1 Behavior

| Config Value | DELETE /Users/{id} | DELETE /Groups/{id} |
|--------------|-------------------|---------------------|
| Any value | Physical row deletion (hard-delete) | Physical row deletion (hard-delete) |

> DELETE always hard-deletes regardless of `UserSoftDeleteEnabled`. The flag only controls whether PATCH active=false is allowed.

| Config Value | PATCH active=false |
|--------------|-------------------|
| `UserSoftDeleteEnabled: true` (default) | Allowed - sets `active = false` |
| `UserSoftDeleteEnabled: false` | Rejected - 400 error |

### 2.2 Config Flag

```json
{
  "UserSoftDeleteEnabled": "True"
}
```

Accepted values: `true`, `false`, `"True"`, `"False"`, `"1"`, `"0"`.

### 2.3 Implementation Details

**DELETE** always performs a physical row deletion (hard-delete). There is no soft-delete path.

**PATCH active=false** is gated by the `UserSoftDeleteEnabled` flag. When the flag is disabled, attempts to set `active=false` via PATCH are rejected with a 400 error.

**Stats** uses `inactive` count (not `softDeleted`) to track deactivated resources.

### 2.5 Database Values

```
┌─────────┬──────────────┬────────────────┬─────────┐
│ id      │ scimId       │ userName       │ active  │
├─────────┼──────────────┼────────────────┼─────────┤
│ user-1  │ abc-def-123  │ user@test.com  │ true    │  ← active user
│ user-2  │ ghi-jkl-456  │ admin@test.com │ true    │  ← active user
│ user-3  │ mno-pqr-789  │ patch@test.com │ false   │  ← deactivated via PATCH active=false
└─────────┴──────────────┴────────────────┴─────────┘
```

> **Note:** The `deletedAt` column has been removed from the database. Deactivated users (`active = false`) remain accessible for all operations.

---

## 3. Feature 2 - Strict Schema Validation

### 3.1 Behavior

When `StrictSchemaValidation` is enabled, **POST** (create) and **PUT** (replace) requests must satisfy two conditions for every extension URN key found in the request body:

1. **Declared**: The URN must appear in the `schemas[]` array
2. **Registered**: The URN must be registered in the `ScimSchemaRegistry` for that endpoint

| Condition | Response |
|-----------|----------|
| URN in body but NOT in `schemas[]` | `400 invalidSyntax` |
| URN in `schemas[]` but NOT registered | `400 invalidValue` |
| URN in both `schemas[]` AND registered | ✅ Accepted |
| `StrictSchemaValidation: false` (default) | All extension URNs silently accepted |

### 3.2 Config Flag

```json
{
  "StrictSchemaValidation": "True"
}
```

### 3.3 RFC Reference

> **RFC 7643 §3.1**: "The 'schemas' attribute is a REQUIRED attribute and is an array of Strings containing URIs that are used to indicate the namespaces of the SCIM schemas."

### 3.4 Implementation

```typescript
private enforceStrictSchemaValidation(
  dto: Record<string, unknown>,
  endpointId: string,
  config?: EndpointConfig
): void {
  if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) return;

  const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
  const declaredLower = new Set(declaredSchemas.map(s => s.toLowerCase()));
  const registeredUrns = this.schemaRegistry.getExtensionUrns(endpointId);
  const registeredLower = new Set(registeredUrns.map(u => u.toLowerCase()));

  for (const key of Object.keys(dto)) {
    if (key.startsWith('urn:')) {
      const keyLower = key.toLowerCase();
      if (!declaredLower.has(keyLower)) {
        throw createScimError({ status: 400, scimType: 'invalidSyntax', ... });
      }
      if (!registeredLower.has(keyLower)) {
        throw createScimError({ status: 400, scimType: 'invalidValue', ... });
      }
    }
  }
}
```

### 3.5 Error Response Examples

**Missing from `schemas[]`**:
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Extension URN \"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User\" found in request body but not declared in schemas[]. When StrictSchemaValidation is enabled, all extension URNs must be listed in the schemas array.",
  "scimType": "invalidSyntax",
  "status": 400
}
```

**Not registered**:
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Extension URN \"urn:fake:extension:2.0:Custom\" is not a registered extension schema for this endpoint. Registered extensions: [urn:ietf:params:scim:schemas:extension:enterprise:2.0:User, urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User, urn:ietf:params:scim:schemas:extension:msfttest:User].",
  "scimType": "invalidValue",
  "status": 400
}
```

### 3.6 Validation Flow

```
                POST /Users + body
                       │
                       ▼
            ┌─────────────────────┐
            │ StrictSchemaValid.  │
            │ enabled?            │
            └─────────┬──────────┘
                 NO   │   YES
                 │    └──────┐
                 │           ▼
                 │  ┌─────────────────────────┐
                 │  │ For each key starting    │
                 │  │ with "urn:" in body:     │
                 │  └──────┬──────────────────┘
                 │         │
                 │    ┌────┴────┐
                 │    │ In      │
                 │    │schemas[]│
                 │    └──┬───┬──┘
                 │   NO  │   │ YES
                 │   │   │   │
                 │   ▼   │   ▼
                 │  400  │  ┌──────────┐
                 │  inv  │  │Registered│
                 │  Syn  │  │in schema │
                 │       │  │registry? │
                 │       │  └──┬───┬───┘
                 │       │ NO  │   │ YES
                 │       │  │  │   │
                 │       │  ▼  │   ▼
                 │       │ 400 │   ✅
                 │       │ inv │  Continue
                 │       │ Val │
                 │       │     │
                 ▼       ▼     ▼
             Continue to create/replace
```

---

## 4. Feature 3 - Custom Extension URNs (msfttest)

### 4.1 New URN Constants

Defined in `scim-constants.ts`:

| Constant | URN Value | Resource Type |
|----------|-----------|---------------|
| `MSFTTEST_CUSTOM_USER_SCHEMA` | `urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User` | User |
| `MSFTTEST_CUSTOM_GROUP_SCHEMA` | `urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group` | Group |
| `MSFTTEST_IETF_USER_SCHEMA` | `urn:ietf:params:scim:schemas:extension:msfttest:User` | User |
| `MSFTTEST_IETF_GROUP_SCHEMA` | `urn:ietf:params:scim:schemas:extension:msfttest:Group` | Group |

### 4.2 Registration in ScimSchemaRegistry

The 4 URNs are registered as built-in schemas in `loadBuiltInSchemas()`:

```typescript
// After Enterprise User registration:
const msftTestSchemas = [
  { urn: MSFTTEST_CUSTOM_USER_SCHEMA, name: 'MsftTestCustomUser', resourceType: 'User' },
  { urn: MSFTTEST_CUSTOM_GROUP_SCHEMA, name: 'MsftTestCustomGroup', resourceType: 'Group' },
  { urn: MSFTTEST_IETF_USER_SCHEMA, name: 'MsftTestIetfUser', resourceType: 'User' },
  { urn: MSFTTEST_IETF_GROUP_SCHEMA, name: 'MsftTestIetfGroup', resourceType: 'Group' },
];

for (const { urn, name, resourceType } of msftTestSchemas) {
  this.schemas.set(urn, { id: urn, name, attributes: [{ name: 'name', type: 'string', ... }], ... });
  // Added to user/group extension sets + resource type schemaExtensions
}
```

### 4.3 Impact on Schema Counts

| Metric | Before | After |
|--------|--------|-------|
| Total built-in schemas | 3 | 7 |
| User extension URNs | 1 (Enterprise) | 3 (Enterprise + 2 msfttest) |
| Group extension URNs | 0 | 2 (2 msfttest) |
| `/Schemas` endpoint totalResults | 3 | 7 |
| User ResourceType schemaExtensions | 1 | 3 |
| Group ResourceType schemaExtensions | 0 | 2 |

### 4.4 Dynamic `schemas[]` in Group Responses

**Before**: Group responses hardcoded `schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group']`.

**After**: `toScimGroupResource()` dynamically builds `schemas[]` by checking which registered extension URNs have data in `rawPayload`:

```typescript
const extensionUrns = this.schemaRegistry.getExtensionUrns(endpointId);
const schemas: [string, ...string[]] = [SCIM_CORE_GROUP_SCHEMA];
for (const urn of extensionUrns) {
  if (urn in rawPayload) {
    schemas.push(urn);
  }
}
```

This matches the existing User service behavior.

### 4.5 Example: Group with msfttest Extension Data

**Request**:
```http
POST /scim/endpoint-1/Groups
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:Group",
    "urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group"
  ],
  "displayName": "Engineering Team",
  "urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group": {
    "name": "eng-team-metadata"
  }
}
```

**Response** (`201 Created`):
```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:Group",
    "urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group"
  ],
  "id": "abc-def-123",
  "displayName": "Engineering Team",
  "urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group": {
    "name": "eng-team-metadata"
  },
  "members": [],
  "meta": {
    "resourceType": "Group",
    "created": "2026-02-23T12:00:00.000Z",
    "lastModified": "2026-02-23T12:00:00.000Z",
    "location": "http://localhost:8080/scim/endpoint-1/Groups/abc-def-123",
    "version": "W/\"2026-02-23T12:00:00.000Z\""
  }
}
```

---

## 5. Architecture & Flow Diagrams

### 5.1 Request Processing Pipeline

```
  ┌──────────┐                                          ┌─────────────────────────┐
  │  Client  │  POST/PUT/DELETE  ──────────────────────► │  Endpoint Controller    │
  └──────────┘                                          │  (Users / Groups)       │
                                                        └────────┬────────────────┘
                                                                 │
                                            extracts { baseUrl, config } from request context
                                                                 │
                                                                 ▼
                                                        ┌─────────────────────────┐
                                                        │  Service Layer          │
                                                        │  create/replace/delete  │
                                                        └────────┬────────────────┘
                                                                 │
                                        ┌────────────────────────┼────────────────────────┐
                                        │                        │                        │
                                   POST / PUT               DELETE                   Schema
                                        │                        │                   Registry
                                        ▼                        ▼                        │
                                ┌──────────────┐       ┌──────────────┐                   │
                                │ Strict Schema│       │ Soft Delete  │                   │
                                │ Validation   │       │ Check        │                   │
                                │ (if enabled) │       │ (if enabled) │                   │
                                └──────┬───────┘       └──────┬───────┘                   │
                                       │                      │                           │
                                  ✅ or 400               update or delete                │
                                       │                      │                           │
                                       ▼                      ▼                           │
                                ┌──────────────┐       ┌──────────────┐                   │
                                │  Repository  │       │  Repository  │                   │
                                │  create/     │       │  update/     │                   │
                                │  update      │       │  delete      │                   │
                                └──────────────┘       └──────────────┘                   │
                                       │                      │                           │
                                       ▼                      ▼                           │
                                ┌──────────────────────────────┐                          │
                                │        PostgreSQL DB         │◄─────────────────────────┘
                                └──────────────────────────────┘     (hydrate extensions)
```

### 5.2 Config Flag Resolution

```
  EndpointConfig (per-endpoint)
         │
         ▼
  getConfigBoolean(config, flagName)
         │
         ├── config undefined? → false
         ├── config[flag] is boolean? → return directly
         ├── config[flag] is "true"/"True"/"1"? → true
         └── config[flag] is "false"/"False"/"0"? → false
```

---

## 6. Configuration Reference

### 6.1 All Config Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `MultiOpPatchRequestAddMultipleMembersToGroup` | boolean | `false` | Allow multi-member add in single PATCH |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | boolean | `false` | Allow multi-member remove in single PATCH |
| `PatchOpAllowRemoveAllMembers` | boolean | `true` | Allow removing all members via `path=members` |
| `VerbosePatchSupported` | boolean | `false` | Dot-notation path resolution in PATCH |
| `logLevel` | string/number | *(unset)* | Per-endpoint log level override |
| **`SoftDeleteEnabled`** | boolean | **`false`** | ✨ **NEW** - Soft delete on DELETE |
| **`StrictSchemaValidation`** | boolean | **`false`** | ✨ **NEW** - Enforce extension schemas |
| `RequireIfMatch` | boolean | `false` | Require If-Match header on PUT/PATCH/DELETE |
| `AllowAndCoerceBooleanStrings` | boolean | `true` | Coerce boolean strings ("True"/"False") to native booleans before validation |

### 6.2 Setting Config via API

```http
PATCH /admin/endpoints/{id}
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "profile": {
    "settings": {
      "UserSoftDeleteEnabled": "True",
      "StrictSchemaValidation": "True"
    }
  }
}
```

---

## 7. API Request / Response Examples

### 7.1 Soft Delete - User

**Request**:
```http
DELETE /scim/endpoint-1/Users/abc-def-123
Authorization: Bearer <token>
```

**Response** (with `SoftDeleteEnabled: true`):
```
HTTP/1.1 204 No Content
```

**Database after**: The user record has `active = false` but is not physically deleted.

**Subsequent GET** (RFC 7644 §3.6 - all operations return 404):
```http
GET /scim/endpoint-1/Users/abc-def-123
Authorization: Bearer <token>
```
```json
HTTP/1.1 404 Not Found
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "User abc-def-123 not found",
  "scimType": "noTarget",
  "status": 404
}
```

**Double-DELETE** (also returns 404):
```http
DELETE /scim/endpoint-1/Users/abc-def-123
Authorization: Bearer <token>
```
```
HTTP/1.1 404 Not Found
```

**LIST after soft-delete** - soft-deleted resource is omitted from results.

**Response** (with `SoftDeleteEnabled: false` or default):
```
HTTP/1.1 204 No Content
```

**Database after**: The user record is physically removed.

### 7.2 Strict Schema Validation - Rejection

**Request** (with `StrictSchemaValidation: true`):
```http
POST /scim/endpoint-1/Users
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "test@example.com",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering"
  }
}
```

**Response** (`400 Bad Request`):
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Extension URN \"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User\" found in request body but not declared in schemas[]. When StrictSchemaValidation is enabled, all extension URNs must be listed in the schemas array.",
  "scimType": "invalidSyntax",
  "status": 400
}
```

### 7.3 Strict Schema Validation - Acceptance

**Request** (same endpoint with `StrictSchemaValidation: true`):
```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "userName": "test@example.com",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering"
  }
}
```

**Response** (`201 Created`):
```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "new-uuid-here",
  "userName": "test@example.com",
  "active": true,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering"
  },
  "meta": { "..." }
}
```

### 7.4 Discovery - Schemas Endpoint

**Request**:
```http
GET /scim/endpoint-1/Schemas
Authorization: Bearer <token>
```

**Response** (showing 7 schemas):
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 7,
  "startIndex": 1,
  "itemsPerPage": 7,
  "Resources": [
    { "id": "urn:ietf:params:scim:schemas:core:2.0:User", "name": "User" },
    { "id": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User", "name": "EnterpriseUser" },
    { "id": "urn:ietf:params:scim:schemas:core:2.0:Group", "name": "Group" },
    { "id": "urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User", "name": "MsftTestCustomUser" },
    { "id": "urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group", "name": "MsftTestCustomGroup" },
    { "id": "urn:ietf:params:scim:schemas:extension:msfttest:User", "name": "MsftTestIetfUser" },
    { "id": "urn:ietf:params:scim:schemas:extension:msfttest:Group", "name": "MsftTestIetfGroup" }
  ]
}
```

---

## 8. Database Impact

### 8.1 Schema Changes

> **Settings v7:** The `deletedAt` column has been removed from the `ScimResource` Prisma model. DELETE always performs a physical row deletion (hard-delete). The `active` column remains and is used to track deactivated resources via PATCH active=false.

### 8.2 Resource State

| Operation | `active` column | Row present |
|-----------|----------------|-------------|
| Normal user | `true` | Yes |
| Deactivated user (PATCH active=false) | `false` | Yes (accessible) |
| Deleted user (DELETE) | N/A | No (hard-deleted) |
| Normal group | `true` | Yes |
| Deleted group (DELETE) | N/A | No (hard-deleted) |

---

## 9. Test Coverage

### 9.1 New Unit Tests Added

| File | New Tests | Coverage Area |
|------|-----------|--------------|
| `endpoint-config.interface.spec.ts` | 33 | SoftDeleteEnabled validation (14), StrictSchemaValidation validation (14), combined flag tests (3), default config (2) |
| `endpoint-scim-users.service.spec.ts` | 13 | Soft delete (6): boolean/string/false/undefined, Strict schema (7): accept/reject declared/unregistered URNs |
| `endpoint-scim-groups.service.spec.ts` | 13 | Soft delete (6), Strict schema (5), Dynamic schemas[] (2) |
| `schemas.controller.spec.ts` | 0 (2 fixed) | Updated counts 3→7 |
| `scim-discovery.service.spec.ts` | 0 (4 fixed) | Schema counts, extension counts |
| `resource-types.controller.spec.ts` | 0 (2 fixed) | Extension counts |
| `endpoint-scim-discovery.controller.spec.ts` | 0 (2 fixed) | Schema counts |

**Total**: 73 new tests + 10 updated assertions = **1374 total tests across 52 suites** (all passing).

### 9.2 Test Categories

- **Config Validation**: Boolean parsing, string parsing, error messages, flag names, combined flags
- **Soft Delete**: Boolean `true` → update(active:false), string `"True"` → update, `false` → delete, `"False"` → delete, `undefined` → delete, empty config → delete
- **Strict Schema**: Accept registered+declared, reject undeclared, reject unregistered, accept when disabled, accept when config undefined
- **Dynamic Schemas**: Extension URNs present in rawPayload → included in `schemas[]`, absent → not included

---

## 10. Files Modified

### Production Code

| File | Changes |
|------|---------|
| `api/src/modules/scim/common/scim-constants.ts` | Added 4 msfttest URN constants, expanded `KNOWN_EXTENSION_URNS` |
| `api/src/modules/endpoint/endpoint-config.interface.ts` | Added `SOFT_DELETE_ENABLED`, `STRICT_SCHEMA_VALIDATION` flags, `validateBooleanFlag()` helper, refactored `validateEndpointConfig()` |
| `api/src/domain/models/group.model.ts` | Added `active?: boolean` to `GroupUpdateInput` |
| `api/src/modules/scim/services/endpoint-scim-users.service.ts` | Soft delete in `deleteUserForEndpoint`, strict validation in `create/replace`, new `enforceStrictSchemaValidation()` |
| `api/src/modules/scim/services/endpoint-scim-groups.service.ts` | Same soft delete + strict validation, `ScimSchemaRegistry` injection, dynamic `schemas[]` in `toScimGroupResource` |
| `api/src/modules/scim/controllers/endpoint-scim-users.controller.ts` | Pass config to create/replace/delete |
| `api/src/modules/scim/controllers/endpoint-scim-groups.controller.ts` | Pass config to create/replace/delete |
| `api/src/modules/scim/discovery/scim-schema-registry.ts` | Register 4 msfttest schemas in `loadBuiltInSchemas()` |

### Test Code

| File | Changes |
|------|---------|
| `endpoint-config.interface.spec.ts` | +33 new tests for new flags |
| `endpoint-scim-users.service.spec.ts` | +13 new tests (soft delete + strict schema) |
| `endpoint-scim-groups.service.spec.ts` | +13 new tests (soft delete + strict schema + dynamic schemas) |
| `endpoint-scim-users.controller.spec.ts` | Updated 3 assertions (config param) |
| `endpoint-scim-groups.controller.spec.ts` | Updated 5 assertions (config param) |
| `scim-schema-registry.spec.ts` | Updated ~26 count assertions (3→7 etc.) |
| `schemas.controller.spec.ts` | Updated 3 count assertions |
| `scim-discovery.service.spec.ts` | Updated 4 count + extension assertions |
| `resource-types.controller.spec.ts` | Updated 2 extension assertions |
| `endpoint-scim-discovery.controller.spec.ts` | Updated 2 count assertions |
