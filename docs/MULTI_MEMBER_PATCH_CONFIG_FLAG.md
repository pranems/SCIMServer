# Multi-Member PATCH Config Flags

> **Document Purpose**: Complete API operation guide for the multi-member PATCH endpoint configuration flags.
> 
> **Created**: February 3, 2026  
> **Last Updated**: February 5, 2026 (v3 - Added Remove flag)

## Overview

These config flags control whether a single PATCH operation can add or remove multiple members from a group at once. Some SCIM clients (like Azure AD / Microsoft Entra) send multiple members in a single operation, while others expect each member to be processed separately.

### Available Flags

| Flag Name | Purpose |
|-----------|----------|
| `MultiOpPatchRequestAddMultipleMembersToGroup` | Controls multi-member **add** operations |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | Controls multi-member **remove** operations |
| `VerbosePatchSupported` | Enables dot-notation path resolution in PATCH (e.g., `name.givenName`) |

### Flag Values

| Flag Value | Behavior |
|------------|----------|
| `"True"` or `true` | Allow operation with multiple members |
| `"False"`, `false`, or not set | Reject multi-member operation with 400 error |

---

## Complete API Operation Flow

### Step 1: Obtain OAuth Token

```http
POST /scim/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id=scimserver-client&client_secret=changeme-oauth&grant_type=client_credentials
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "scim.read scim.write scim.manage"
}
```

---

### Step 2: Create Endpoint with Config

```http
POST /scim/admin/endpoints
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "azure-ad-integration",
  "displayName": "Azure AD Integration",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "True"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "cml73w21n0005tcragsxs6ejq",
  "name": "azure-ad-integration",
  "displayName": "Azure AD Integration",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "True"
  },
  "active": true,
  "scimEndpoint": "/scim/endpoints/cml73w21n0005tcragsxs6ejq",
  "createdAt": "2026-02-03T21:23:56.891Z",
  "updatedAt": "2026-02-03T21:23:56.891Z"
}
```

---

### Step 3: Create Test Users

```http
POST /scim/endpoints/cml73w21n0005tcragsxs6ejq/Users
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user1@test.com",
  "displayName": "User One",
  "active": true
}
```

**Response (201 Created):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "3663e3a0-6c3f-4b08-8bfc-7cf336df4fe9",
  "userName": "user1@test.com",
  "displayName": "User One",
  "active": true,
  "meta": {
    "resourceType": "User",
    "created": "2026-02-03T21:24:00.000Z",
    "lastModified": "2026-02-03T21:24:00.000Z",
    "location": "http://localhost:3000/scim/endpoints/cml73w21n0005tcragsxs6ejq/Users/3663e3a0-6c3f-4b08-8bfc-7cf336df4fe9"
  }
}
```

Repeat for additional users (user2@test.com, user3@test.com).

---

### Step 4: Create a Group

```http
POST /scim/endpoints/cml73w21n0005tcragsxs6ejq/Groups
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team"
}
```

**Response (201 Created):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "d40a1eaa-0402-4758-a81e-c3fbf6e663ec",
  "displayName": "Engineering Team",
  "members": [],
  "meta": {
    "resourceType": "Group",
    "created": "2026-02-03T21:25:00.000Z",
    "lastModified": "2026-02-03T21:25:00.000Z",
    "location": "http://localhost:3000/scim/endpoints/cml73w21n0005tcragsxs6ejq/Groups/d40a1eaa-0402-4758-a81e-c3fbf6e663ec"
  }
}
```

---

### Step 5: PATCH Group - Add Multiple Members (Flag = True ✅)

**With `MultiOpPatchRequestAddMultipleMembersToGroup: "True"`:**

```http
PATCH /scim/endpoints/cml73w21n0005tcragsxs6ejq/Groups/d40a1eaa-0402-4758-a81e-c3fbf6e663ec
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        { "value": "3663e3a0-6c3f-4b08-8bfc-7cf336df4fe9" },
        { "value": "c10906d0-2066-48cb-9fc3-19ad7109c7d0" },
        { "value": "9a1dd4c6-8406-406e-811f-1942644ee0af" }
      ]
    }
  ]
}
```

**Response (204 No Content):** ✅ Success - all 3 members added in one operation

---

### Step 5b: PATCH Group - Remove Multiple Members (Flag = True ✅)

**With `MultiOpPatchRequestRemoveMultipleMembersFromGroup: "True"`:**

```http
PATCH /scim/endpoints/cml73w21n0005tcragsxs6ejq/Groups/d40a1eaa-0402-4758-a81e-c3fbf6e663ec
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "remove",
      "path": "members",
      "value": [
        { "value": "3663e3a0-6c3f-4b08-8bfc-7cf336df4fe9" },
        { "value": "c10906d0-2066-48cb-9fc3-19ad7109c7d0" }
      ]
    }
  ]
}
```

**Response (204 No Content):** ✅ Success - 2 specified members removed in one operation

> **Note**: The remove flag controls removing multiple members via a value array. Single-member removes (value array with 1 item) and targeted removes (e.g., `path=members[value eq "user-id"]`) are always allowed. Using `path=members` without a value array is not supported - you must specify which members to remove.

---

### Step 6: Verify Group Members

```http
GET /scim/endpoints/cml73w21n0005tcragsxs6ejq/Groups/d40a1eaa-0402-4758-a81e-c3fbf6e663ec
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "d40a1eaa-0402-4758-a81e-c3fbf6e663ec",
  "displayName": "Engineering Team",
  "members": [
    { "value": "3663e3a0-6c3f-4b08-8bfc-7cf336df4fe9", "display": "User One", "$ref": "..." },
    { "value": "c10906d0-2066-48cb-9fc3-19ad7109c7d0", "display": "User Two", "$ref": "..." },
    { "value": "9a1dd4c6-8406-406e-811f-1942644ee0af", "display": "User Three", "$ref": "..." }
  ],
  "meta": { ... }
}
```

---

## Negative Case: PATCH Without Flag (Flag = False ❌)

**Without flag (default behavior):**

```http
PATCH /scim/endpoints/cml74arfh000xm6caqud2hej4/Groups/a8396cfa-c7ca-42fb-b640-964978e7ae91
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        { "value": "user-001" },
        { "value": "user-002" }
      ]
    }
  ]
}
```

**Response (400 Bad Request):**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Adding multiple members in a single operation is not allowed. Each member must be added in a separate PATCH operation. To enable multi-member add, set endpoint config flag \"MultiOpPatchRequestAddMultipleMembersToGroup\" to \"True\".",
  "scimType": "invalidValue",
  "status": 400
}
```

---

## Workaround - Multiple Operations (Always Works)

When the flag is `false`, use separate operations:

```http
PATCH /scim/endpoints/clx9876543210/Groups/grp-xyz789
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [{ "value": "user-001" }]
    },
    {
      "op": "add",
      "path": "members",
      "value": [{ "value": "user-002" }]
    },
    {
      "op": "add",
      "path": "members",
      "value": [{ "value": "user-003" }]
    }
  ]
}
```

**Response (204 No Content):** ✅ Success - each operation adds one member

---

## Code Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PATCH /Groups/:id Request                            │
│                    Authorization: Bearer <token>                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EndpointScimGroupsController.updateGroup(endpointId, id, dto, req)         │
│  ├─ validateAndSetContext(endpointId, req)                                  │
│  │   ├─ Load endpoint from DB: endpointService.getEndpoint(endpointId)      │
│  │   ├─ Extract config: endpoint.config || {}                               │
│  │   ├─ Build baseUrl from request                                          │
│  │   └─ Return { baseUrl, config }  ← Config passed directly!               │
│  └─ Call groupsService.patchGroupForEndpoint(id, dto, endpointId, config)   │
│                                                          ▲                  │
│                                                          │                  │
│                               Config passed as parameter ─┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EndpointScimGroupsService.patchGroupForEndpoint(scimId, dto, endpointId,   │
│                                                  config?: EndpointConfig)   │
│  ├─ Validate PATCH schema                                                   │
│  ├─ Find group by scimId + endpointId                                       │
│  ├─ Use passed config (or fallback to context):                             │
│  │   const endpointConfig = config ?? this.endpointContext.getConfig();     │
│  │   const allowMultiMemberAdd = getConfigBoolean(endpointConfig,           │
│  │       ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP)│
│  └─ Process Operations[]                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  handleAdd(operation, memberDtos, allowMultiMemberAdd) - For "add" ops      │
│  ├─ Parse members from operation.value                                      │
│  ├─ Check: value.length > 1 && !allowMultiMemberAdd?                        │
│  │   ├─ YES → throw 400 "Adding multiple members not allowed"               │
│  │   └─ NO  → Continue processing                                           │
│  └─ Merge new members with existing (deduplicate by value)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Persist Changes (Prisma Transaction)                                       │
│  ├─ Update group metadata (lastModified)                                    │
│  ├─ Delete existing members: tx.groupMember.deleteMany()                    │
│  └─ Create new members: tx.groupMember.createMany()                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         204 No Content Response                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Files Involved

| File | Purpose |
|------|---------|
| [endpoint-config.interface.ts](../api/src/modules/endpoint/endpoint-config.interface.ts) | `ENDPOINT_CONFIG_FLAGS` constant, `EndpointConfig` type, `getConfigBoolean()` helper |
| [endpoint-context.storage.ts](../api/src/modules/endpoint/endpoint-context.storage.ts) | Stores config per request via `AsyncLocalStorage` (fallback) |
| [endpoint-scim-groups.controller.ts](../api/src/modules/scim/controllers/endpoint-scim-groups.controller.ts) | Loads config and **passes directly** to service |
| [endpoint-scim-groups.service.ts](../api/src/modules/scim/services/endpoint-scim-groups.service.ts) | `patchGroupForEndpoint(id, dto, endpointId, config)` & `handleAdd()` enforce the flag |

---

## Implementation Note

> **Why is config passed directly instead of using AsyncLocalStorage?**
> 
> `AsyncLocalStorage.enterWith()` doesn't reliably propagate context across all async boundaries in NestJS.
> To ensure the config is always available, it's passed as an explicit parameter from the controller to the service.
> The service still supports fallback to `EndpointContextStorage` for backward compatibility.

---

## Configuration Interface

The flags are defined in `endpoint-config.interface.ts`:

```typescript
export const ENDPOINT_CONFIG_FLAGS = {
  MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP: 'MultiOpPatchRequestAddMultipleMembersToGroup',
  MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP: 'MultiOpPatchRequestRemoveMultipleMembersFromGroup',
} as const;

export interface EndpointConfig {
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP]?: boolean | string;
  [key: string]: unknown;  // Allow additional config flags
}

export const DEFAULT_ENDPOINT_CONFIG: EndpointConfig = {
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP]: false,
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP]: false,
};
```

---

## Helper Functions

```typescript
import { 
  getConfigBoolean, 
  ENDPOINT_CONFIG_FLAGS, 
  type EndpointConfig 
} from '../../endpoint/endpoint-config.interface';

// In Controller - pass config to service
@Patch('Groups/:id')
async updateGroup(
  @Param('endpointId') endpointId: string,
  @Param('id') id: string,
  @Body() dto: PatchGroupDto,
  @Req() req: Request
) {
  const { config } = await this.validateAndSetContext(endpointId, req);
  return this.groupsService.patchGroupForEndpoint(id, dto, endpointId, config);
}

// In Service - use config parameter
async patchGroupForEndpoint(
  scimId: string, 
  dto: PatchGroupDto, 
  endpointId: string, 
  config?: EndpointConfig
): Promise<void> {
  // Use passed config or fallback to context storage
  const endpointConfig = config ?? this.endpointContext.getConfig();
  const allowMultiMemberAdd = getConfigBoolean(
    endpointConfig, 
    ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP
  );
  // ... rest of implementation
}
```

The `getConfigBoolean()` function handles both string and boolean values:
- `"True"`, `"true"`, `"1"` → `true`
- `true` → `true`
- Everything else → `false`

---

## Live Test Script

A comprehensive test script is available at `scripts/live-test.ps1`:

```powershell
# Run the live test
& c:\path\to\SCIMServer\scripts\live-test.ps1
```

This script demonstrates:
1. Getting OAuth token
2. Creating endpoint with flag enabled
3. Creating test users
4. Creating a group
5. PATCH with multiple members (succeeds with flag)
6. Creating endpoint without flag
7. PATCH with multiple members (fails without flag)

---

## Test Coverage

Tests are located in `endpoint-scim-groups.service.spec.ts`:

### Add Flag Tests

| Test | Description |
|------|-------------|
| `should reject adding multiple members when flag is false (default)` | Verifies 400 error when adding 2+ members without flag |
| `should allow adding multiple members when flag is true` | Verifies success with string `"True"` |
| `should allow adding multiple members when flag is boolean true` | Verifies success with boolean `true` |
| `should always allow adding single member regardless of flag` | Single-member add always works |
| `should allow multiple separate add operations with single members each` | Workaround always works |

### Remove Flag Tests

| Test | Description |
|------|-------------|
| `should reject removing multiple members via value array when flag is false` | Verifies 400 error when removing 2+ members via value array without flag |
| `should allow removing multiple members via value array when flag is "True"` | Verifies success with string `"True"` |
| `should allow removing multiple members via value array when flag is boolean true` | Verifies success with boolean `true` |
| `should always allow removing single member via value array regardless of flag` | Single-member value array always works |
| `should always allow removing single member via path filter regardless of flag` | Targeted removes (path filter) always work |
| `should allow multiple separate remove operations with single members each` | Workaround always works |
| `should reject removing via path=members without value array` | path=members without value array is not supported |

All 55 endpoint-scim tests pass ✅

---

## Related Documentation

- [ENDPOINT-BEHAVIOR-STRATEGIES.md](./ENDPOINT-BEHAVIOR-STRATEGIES.md) - Strategy patterns for config-driven behavior
- [MULTI_ENDPOINT_ARCHITECTURE.md](./MULTI_ENDPOINT_ARCHITECTURE.md) - Multi-endpoint architecture overview
