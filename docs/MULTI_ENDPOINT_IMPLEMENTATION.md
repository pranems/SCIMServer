# Multi-Endpoint SCIM Implementation Guide

## Overview

This implementation adds multi-endpoint support to the SCIMTool application. Each endpoint gets:
- A unique endpoint ID
- A dedicated SCIM endpoint root path: `/scim/endpoints/{endpointId}`
- Isolated user, group, and configuration data
- Complete data deletion when the endpoint is removed

## Architecture

### 1. Database Schema Changes

The Prisma schema has been updated to support multi-tenancy:

#### New `Endpoint` Model
```prisma
model Endpoint {
  id          String   @id @default(cuid())
  name        String   @unique          // Unique endpoint identifier
  displayName String?                   // Human-readable name
  description String?                   // Optional description
  config      String?                   // JSON configuration for endpoint settings
  active      Boolean  @default(true)   // Can be deactivated
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations with cascade delete
  users   ScimUser[]
  groups  ScimGroup[]
  logs    RequestLog[]
}
```

#### Updated `ScimUser` Model
- Added `endpointId` foreign key (required)
- Changed unique constraints to composite constraints per endpoint:
  - `@@unique([endpointId, scimId])`
  - `@@unique([endpointId, userName])`
  - `@@unique([endpointId, externalId])`

#### Updated `ScimGroup` Model
- Added `endpointId` foreign key (required)
- Changed unique constraints to composite constraints per endpoint:
  - `@@unique([endpointId, scimId])`

#### Updated `RequestLog` Model
- Added optional `endpointId` field for logging (allows system-wide and endpoint-specific logs)

### 2. New Endpoint Management Module

#### Location
- `src/modules/endpoint/`

#### Components

##### EndpointService (`endpoint.service.ts`)
**Methods:**
- `createEndpoint(dto)` - Create new endpoint
- `getEndpoint(endpointId)` - Get endpoint by ID
- `getEndpointByName(name)` - Get endpoint by unique name
- `listEndpoints(active?)` - List all or filtered endpoints
- `updateEndpoint(endpointId, dto)` - Update endpoint configuration
- `deleteEndpoint(endpointId)` - Delete endpoint and all associated data (cascading)
- `getEndpointStats(endpointId)` - Get statistics about endpoint's resources

**Active Flag Behavior:**
- Endpoints are created with `active: true` by default
- Setting `active: false` via PATCH disables the endpoint
- **Inactive endpoints reject all SCIM operations with 403 Forbidden**
- Data is preserved; the endpoint can be re-activated at any time

##### EndpointController (`endpoint.controller.ts`)
**Endpoints:**
```
POST   /scim/admin/endpoints                   - Create endpoint
GET    /scim/admin/endpoints                   - List endpoints
GET    /scim/admin/endpoints/{endpointId}      - Get endpoint details
GET    /scim/admin/endpoints/by-name/{name}    - Get endpoint by name
PATCH  /scim/admin/endpoints/{endpointId}      - Update endpoint
DELETE /scim/admin/endpoints/{endpointId}      - Delete endpoint
GET    /scim/admin/endpoints/{endpointId}/stats - Get endpoint statistics
```

##### EndpointContextStorage (`endpoint-context.storage.ts`)
- Uses AsyncLocalStorage for request-scoped endpoint context
- Tracks endpointId and baseUrl for current request
- Ensures endpoint context is isolated per request

### 3. endpoint-specific SCIM endpoints

#### New Controller: EndpointScimController
**Location:** `src/modules/scim/controllers/endpoint-scim.controller.ts`

**Endpoint Structure:**
```
/scim/endpoints/{endpointId}/
├── Users                    - User management
│   ├── POST /               - Create user (endpoint-scoped)
│   ├── GET /                - List users (endpoint-scoped, with filters)
│   ├── GET /{id}            - Get user (endpoint-scoped)
│   ├── PUT /{id}            - Replace user (endpoint-scoped)
│   ├── PATCH /{id}          - Update user (endpoint-scoped)
│   └── DELETE /{id}         - Delete user (endpoint-scoped)
├── Groups                   - Group management
│   ├── POST /               - Create group (endpoint-scoped)
│   ├── GET /                - List groups (endpoint-scoped, with filters)
│   ├── GET /{id}            - Get group (endpoint-scoped)
│   ├── PUT /{id}            - Replace group (endpoint-scoped)
│   ├── PATCH /{id}          - Update group (endpoint-scoped)
│   └── DELETE /{id}         - Delete group (endpoint-scoped)
├── Schemas                  - SCIM metadata
├── ResourceTypes            - SCIM metadata
└── ServiceProviderConfig    - SCIM metadata
```

### 4. Service Layer Extensions ✅ IMPLEMENTED

The SCIM services are implemented as **dedicated endpoint-aware services**:
- `EndpointScimUsersService` - User CRUD with endpoint isolation
- `EndpointScimGroupsService` - Group CRUD with endpoint isolation and config support

#### EndpointScimUsersService Methods

**Location:** `src/modules/scim/services/endpoint-scim-users.service.ts`

```typescript
async createUserForEndpoint(
  dto: CreateUserDto,
  baseUrl: string,
  endpointId: string
): Promise<ScimUserResource>

async getUserForEndpoint(
  scimId: string,
  baseUrl: string,
  endpointId: string
): Promise<ScimUserResource>

async listUsersForEndpoint(
  params: ListUsersParams,
  baseUrl: string,
  endpointId: string
): Promise<ScimListResponse>

async replaceUserForEndpoint(
  scimId: string,
  dto: CreateUserDto,
  baseUrl: string,
  endpointId: string
): Promise<ScimUserResource>

async patchUserForEndpoint(
  scimId: string,
  dto: PatchUserDto,
  baseUrl: string,
  endpointId: string
): Promise<ScimUserResource>

async deleteUserForEndpoint(
  scimId: string,
  endpointId: string
): Promise<void>
```

#### EndpointScimGroupsService Methods

**Location:** `src/modules/scim/services/endpoint-scim-groups.service.ts`

```typescript
async createGroupForEndpoint(
  dto: CreateGroupDto,
  baseUrl: string,
  endpointId: string
): Promise<ScimGroupResource>

async getGroupForEndpoint(
  scimId: string,
  baseUrl: string,
  endpointId: string
): Promise<ScimGroupResource>

async listGroupsForEndpoint(
  params: ListGroupsParams,
  baseUrl: string,
  endpointId: string
): Promise<ScimListResponse>

async replaceGroupForEndpoint(
  scimId: string,
  dto: CreateGroupDto,
  baseUrl: string,
  endpointId: string
): Promise<ScimGroupResource>

// Note: config parameter added for endpoint-specific behavior
async patchGroupForEndpoint(
  scimId: string,
  dto: PatchGroupDto,
  endpointId: string,
  config?: EndpointConfig  // Config passed directly from controller
): Promise<void>

async deleteGroupForEndpoint(
  scimId: string,
  endpointId: string
): Promise<void>
```

### 5. Config Propagation Pattern ✅ IMPLEMENTED

**Important:** Config is passed **directly from controller to service** as a parameter, not via AsyncLocalStorage alone.

```typescript
// In endpoint-scim.controller.ts
@Patch('Groups/:id')
async updateGroup(@Param('endpointId') endpointId: string, ...) {
  const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
  // Config passed directly to service
  await this.groupsService.patchGroupForEndpoint(id, dto, endpointId, config);
}
```

This pattern is more reliable than AsyncLocalStorage across async boundaries in NestJS.

### 6. Endpoint Config Flags ✅ IMPLEMENTED

**Location:** `src/modules/endpoint/endpoint-config.interface.ts`

```typescript
// Centralized config flag constants
export const ENDPOINT_CONFIG_FLAGS = {
  MULTI_OP_PATCH_ADD_MULTI_MEMBERS: 'MultiOpPatchRequestAddMultipleMembersToGroup',
} as const;

// Type-safe interface
export interface EndpointConfig {
  MultiOpPatchRequestAddMultipleMembersToGroup?: string | boolean;
  [key: string]: unknown;
}

// Helper functions
export function getConfigBoolean(config: EndpointConfig | null | undefined, key: string): boolean;
export function getConfigString(config: EndpointConfig | null | undefined, key: string): string | undefined;
```

## Implementation Status ✅ COMPLETE

### All Phases Complete
- ✅ Database schema with Endpoint model
- ✅ EndpointScimUsersService with full CRUD
- ✅ EndpointScimGroupsService with full CRUD and config support
- ✅ Config propagation (direct parameter passing)
- ✅ 48 tests passing

### Testing
```bash
# Run endpoint-scim tests
cd api && npm test -- --testPathPattern="endpoint-scim"
# Result: 48 tests passing
```

### Test Endpoint Operations
```bash
# Get OAuth token
TOKEN=$(curl -s -X POST http://localhost:3000/scim/oauth/token \
  -d "client_id=scimtool-client&client_secret=changeme-oauth&grant_type=client_credentials" \
  | jq -r '.access_token')

# Create a endpoint with config flag
curl -X POST http://localhost:3000/scim/admin/endpoints \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "endpoint-alpha",
    "displayName": "Endpoint Alpha",
    "description": "First test endpoint",
    "config": {
      "MultiOpPatchRequestAddMultipleMembersToGroup": "true"
    }
  }'

# Response:
{
  "id": "clx...",
  "name": "endpoint-alpha",
  "displayName": "Endpoint Alpha",
  "scimEndpoint": "/scim/endpoints/clx...",
  "active": true,
  "createdAt": "2026-01-28T..."
}

# List endpoints
curl http://localhost:3000/scim/admin/endpoints \
  -H "Authorization: Bearer $TOKEN"

# Create user in endpoint
curl -X POST http://localhost:3000/scim/endpoints/clx.../Users \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "john.doe@example.com",
    "name": {"givenName": "John", "familyName": "Doe"}
  }'

# Delete endpoint (cascade deletes all data)
curl -X DELETE http://localhost:3000/scim/admin/endpoints/clx... \
  -H "Authorization: Bearer $TOKEN"
```

## Data Isolation Guarantees

1. **Query Isolation:** All queries filter by `endpointId`
2. **Unique Constraints:** Identifiers (userName, externalId, scimId) are unique per endpoint, not globally
3. **Cascade Delete:** Deleting an endpoint automatically deletes all associated:
   - Users
   - Groups
   - Group members
   - Logs
4. **Config Isolation:** Each endpoint can have its own configuration flags
5. **Context Handling:** Config passed directly from controller to service for reliability

## API Response Format for Endpoint Creation

```json
{
  "id": "unique-endpoint-id",
  "name": "endpoint-identifier",
  "displayName": "Human Readable Name",
  "description": "Optional description",
  "config": {
    "customSetting": "value"
  },
  "active": true,
  "scimEndpoint": "/scim/endpoints/unique-endpoint-id",
  "createdAt": "2026-01-28T10:00:00Z",
  "updatedAt": "2026-01-28T10:00:00Z"
}
```

## Implementation Complete

All phases are complete and tested:
- ✅ Database schema updated
- ✅ Service layer implemented
- ✅ Config propagation working
- ✅ 48 tests passing
- ✅ Documentation complete

See also:
- [MULTI_MEMBER_PATCH_CONFIG_FLAG.md](MULTI_MEMBER_PATCH_CONFIG_FLAG.md) - Config flag documentation
- [MULTI_ENDPOINT_CHECKLIST.md](MULTI_ENDPOINT_CHECKLIST.md) - Implementation checklist

## Backward Compatibility

The default SCIM endpoints (`/scim/Users`, `/scim/Groups`, etc.) remain unchanged and can continue to serve a "default" or "global" endpoint if needed. This allows for gradual migration to Multi-Endpoint architecture.

## Security Considerations

1. **Endpoint Isolation:** Always filter by `endpointId` in queries
2. **API Authentication:** Implement authentication/authorization to restrict endpoint access
3. **Audit Logging:** Log all endpoint-level operations with audit trail
4. **Configuration Validation:** Validate endpoint configurations to prevent injection attacks


