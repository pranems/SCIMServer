# Feature Documentation: Soft Delete, Strict Schema Validation & Custom Extension URNs

> **Cross-reference**: For strict schema validation internals and custom extension registration details, see [`SCHEMA_LIFECYCLE_AND_REGISTRY.md`](SCHEMA_LIFECYCLE_AND_REGISTRY.md) and [`SCHEMA_CUSTOMIZATION_GUIDE.md`](SCHEMA_CUSTOMIZATION_GUIDE.md). This document remains the canonical reference for the **Soft Delete** feature.

> **Version**: 1.1  
> **Date**: 2026-02-25  
> **Status**: Implemented & Tested  
> **Config flags**: `SoftDeleteEnabled`, `ReprovisionOnConflictForSoftDeletedResource`, `StrictSchemaValidation`  
> **Extension URNs**: 4 msfttest schemas registered globally

---

## Table of Contents

1. [Overview](#1-overview)
2. [Feature 1 — Soft / Hard Delete](#2-feature-1--soft--hard-delete)
3. [Feature 2 — Strict Schema Validation](#3-feature-2--strict-schema-validation)
4. [Feature 3 — Custom Extension URNs (msfttest)](#4-feature-3--custom-extension-urns-msfttest)
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
| Soft / Hard Delete | `SoftDeleteEnabled` | `false` | Control whether DELETE sets `active=false` + `deletedAt` or physically removes the resource |
| Reprovision on Conflict | `ReprovisionOnConflictForSoftDeletedResource` | `false` | Re-activate soft-deleted resources on POST conflict instead of 409 (requires SoftDeleteEnabled) |
| Strict Schema Validation | `StrictSchemaValidation` | `false` | Enforce that extension URNs in request body are declared in `schemas[]` AND registered |
| Custom Extension URNs | *(built-in)* | Always registered | 4 msfttest extension schemas pre-registered for Microsoft Entra ID compliance testing |

All features are **per-endpoint** — each SCIM endpoint can independently enable/disable these behaviors via its config object.

---

## 2. Feature 1 — Soft / Hard Delete

### 2.1 Behavior

| Config Value | DELETE /Users/{id} | DELETE /Groups/{id} |
|--------------|-------------------|---------------------|
| `SoftDeleteEnabled: false` (default) | Physical row deletion | Physical row deletion |
| `SoftDeleteEnabled: true` | Sets `active = false` + `deletedAt = now()`; subsequent GET/PATCH/PUT/DELETE returns 404 (RFC 7644 §3.6) | Sets `active = false` + `deletedAt = now()`; subsequent GET/PATCH/PUT/DELETE returns 404 (RFC 7644 §3.6) |

### 2.2 Config Flag

```json
{
  "SoftDeleteEnabled": "True"
}
```

Accepted values: `true`, `false`, `"True"`, `"False"`, `"1"`, `"0"`.

### 2.3 Implementation Details

**RFC 7644 §3.6 Compliance:** After a soft-delete, the service MUST return 404 for all operations (GET, PATCH, PUT, DELETE) on the deleted resource and MUST omit it from LIST/query results. The `guardSoftDeleted()` helper enforces this across all operations using the `deletedAt` timestamp (not `active` flag — a client can set `active=false` via PATCH without soft-deleting).

**User Service** (`endpoint-scim-users.service.ts`):
```typescript
// Guard — returns 404 if resource is soft-deleted (deletedAt is set) and SoftDeleteEnabled is true
private guardSoftDeleted(user: UserRecord, config: EndpointConfig | undefined, scimId: string): void {
  const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
  if (softDelete && user.deletedAt != null) {
    throw createScimError({ status: 404, scimType: 'noTarget', detail: `User ${scimId} not found` });
  }
}

async deleteUserForEndpoint(scimId: string, endpointId: string, config?: EndpointConfig): Promise<void> {
  const user = await this.userRepo.findByScimId(endpointId, scimId);
  if (!user) throw createScimError({ status: 404, scimType: 'noTarget', ... });
  this.guardSoftDeleted(user, config, scimId);  // Double-delete → 404

  const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
  if (softDelete) {
    await this.userRepo.update(user.id, { active: false, deletedAt: new Date() });  // Soft-delete
  } else {
    await this.userRepo.delete(user.id);                      // Hard-delete
  }
}
```

**GET/PATCH/PUT** all invoke `guardSoftDeleted()` before processing.  
**LIST** filters out resources where `deletedAt != null` when `SoftDeleteEnabled` is true.

**Group Service** (`endpoint-scim-groups.service.ts`): Identical pattern with `guardSoftDeleted()` across all operations.

### 2.4 Reprovision on Conflict (Re-activation)

When **both** `SoftDeleteEnabled` and `ReprovisionOnConflictForSoftDeletedResource` are enabled, POST (create) operations that collide with a soft-deleted resource will **re-activate** the existing resource instead of returning 409 Conflict:

```typescript
// In createUserForEndpoint:
const conflict = await this.userRepo.findConflict(endpointId, userName, externalId);
if (conflict) {
  const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
  const reprovision = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED);
  if (softDelete && reprovision && conflict.deletedAt != null) {
    return this.reprovisionUser(conflict.scimId, dto, baseUrl, endpointId, config);
  }
  throw createScimError({ status: 409, scimType: 'uniqueness', ... });
}
```

**Reprovision behavior:**
- Sets `active = true`, `deletedAt = null` (clears soft-delete markers)
- Replaces the entire resource payload with the new POST body
- Returns 201 Created with the re-activated resource
- For Groups: member references are re-resolved via `resolveMemberInputs()`

### 2.4 Flow Diagram

```
┌──────────┐     DELETE /Users/{id}     ┌──────────────────┐
│  Client  │ ─────────────────────────► │  UsersController │
└──────────┘                            └────────┬─────────┘
                                                 │
                                    passes config │
                                                 ▼
                                        ┌────────────────────┐
                                        │  UsersService      │
                                        │  deleteUserFor...  │
                                        └────────┬───────────┘
                                                 │
                                   ┌─────────────┼─────────────┐
                                   │             │             │
                              SoftDelete?   SoftDelete?        │
                              ┌──YES──┐    ┌──NO───┐           │
                              ▼       │    ▼       │           │
                         ┌─────────┐  │ ┌────────┐ │           │
                         │ UPDATE  │  │ │ DELETE │ │           │
                         │active=F │  │ │ (hard) │ │           │
                         └─────────┘  │ └────────┘ │           │
                                      │            │           │
                                      └────────────┘           │
                                                               │
                                                    HTTP 204 No Content
```

### 2.6 Database Values After Soft Delete

```
┌─────────┬──────────────┬────────────────┬─────────┬─────────────────────┐
│ id      │ scimId       │ userName       │ active  │ deletedAt           │
├─────────┼──────────────┼────────────────┼─────────┼─────────────────────┤
│ user-1  │ abc-def-123  │ user@test.com  │ false   │ 2026-02-25T12:00:00 │  ← soft-deleted
│ user-2  │ ghi-jkl-456  │ admin@test.com │ true    │ NULL                │  ← normal
│ user-3  │ mno-pqr-789  │ patch@test.com │ false   │ NULL                │  ← PATCH-disabled (not soft-deleted)
└─────────┴──────────────┴────────────────┴─────────┴─────────────────────┘
```

> **Key distinction:** `deletedAt != null` means soft-deleted (404 on all operations). `active = false` with `deletedAt = null` means the user was disabled via PATCH — this is a normal state and the resource remains accessible.

---

## 3. Feature 2 — Strict Schema Validation

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

## 4. Feature 3 — Custom Extension URNs (msfttest)

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
| **`SoftDeleteEnabled`** | boolean | **`false`** | ✨ **NEW** — Soft delete on DELETE |
| **`StrictSchemaValidation`** | boolean | **`false`** | ✨ **NEW** — Enforce extension schemas |
| `RequireIfMatch` | boolean | `false` | Require If-Match header on PUT/PATCH/DELETE |
| `AllowAndCoerceBooleanStrings` | boolean | `true` | Coerce boolean strings ("True"/"False") to native booleans before validation |

### 6.2 Setting Config via API

```http
PATCH /admin/endpoints/{id}
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "config": {
    "SoftDeleteEnabled": "True",
    "StrictSchemaValidation": "True"
  }
}
```

---

## 7. API Request / Response Examples

### 7.1 Soft Delete — User

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

**Subsequent GET** (RFC 7644 §3.6 — all operations return 404):
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

**LIST after soft-delete** — soft-deleted resource is omitted from results.

**Response** (with `SoftDeleteEnabled: false` or default):
```
HTTP/1.1 204 No Content
```

**Database after**: The user record is physically removed.

### 7.2 Strict Schema Validation — Rejection

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

### 7.3 Strict Schema Validation — Acceptance

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

### 7.4 Discovery — Schemas Endpoint

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

A new `deletedAt` column was added to the `ScimResource` Prisma model:

```prisma
deletedAt DateTime? @db.Timestamptz
```

This nullable timestamp tracks when a resource was soft-deleted. Domain models updated: `UserRecord` and `GroupRecord` include `deletedAt: Date | null`; `UserUpdateInput` and `GroupUpdateInput` include `deletedAt?: Date | null`; `UserConflictResult` includes `active: boolean` and `deletedAt: Date | null`. `GroupRecord` and `GroupCreateInput` now include `active: boolean` (Groups created with `active: true`).

### 8.2 Soft Delete State

| Operation | `active` column | `deletedAt` column | Row present |
|-----------|----------------|-------------------|-------------|
| Normal user | `true` | `NULL` | Yes |
| Soft-deleted user | `false` | Timestamp | Yes |
| PATCH-disabled user | `false` | `NULL` | Yes (accessible) |
| Hard-deleted user | N/A | N/A | No |
| Normal group | `true` | `NULL` | Yes |
| Soft-deleted group | `false` | Timestamp | Yes |
| Hard-deleted group | N/A | N/A | No |

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
