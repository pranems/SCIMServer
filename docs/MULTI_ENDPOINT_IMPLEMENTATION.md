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

### 2. New Tenant Management Module

#### Location
- `src/modules/endpoint/`

#### Components

##### EndpointService (`tenant.service.ts`)
**Methods:**
- `createTenant(dto)` - Create new tenant
- `getTenant(endpointId)` - Get tenant by ID
- `getTenantByName(name)` - Get tenant by unique name
- `listTenants(active?)` - List all or filtered tenants
- `updateTenant(endpointId, dto)` - Update endpoint configuration
- `deleteTenant(endpointId)` - Delete tenant and all associated data (cascading)
- `getTenantStats(endpointId)` - Get statistics about tenant's resources

##### EndpointController (`tenant.controller.ts`)
**Endpoints:**
```
POST   /admin/endpoints                      - Create tenant
GET    /admin/endpoints                      - List tenants
GET    /admin/endpoints/{endpointId}           - Get tenant details
GET    /admin/endpoints/by-name/{name}       - Get tenant by name
PATCH  /admin/endpoints/{endpointId}           - Update tenant
DELETE /admin/endpoints/{endpointId}           - Delete tenant
GET    /admin/endpoints/{endpointId}/stats     - Get tenant statistics
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

### 4. Service Layer Extensions

The SCIM services (`ScimUsersService`, `ScimGroupsService`) need to be extended with tenant-aware methods:

#### New Service Methods (to be added)

**ScimUsersService:**
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

**ScimGroupsService:**
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

async patchGroupForEndpoint(
  scimId: string,
  dto: PatchGroupDto,
  baseUrl: string,
  endpointId: string
): Promise<ScimGroupResource>

async deleteGroupForEndpoint(
  scimId: string,
  endpointId: string
): Promise<void>
```

## Implementation Steps

### Step 1: Database Migration
```bash
npx prisma migrate dev --name add_multi_tenant_support
```

### Step 2: Update Services
Add tenant-aware methods to `ScimUsersService` and `ScimGroupsService` that:
1. Filter queries by `endpointId`
2. Validate `endpointId` exists before operations
3. Ensure data isolation per endpoint

### Step 3: Test Tenant Operations
```bash
# Create a tenant
curl -X POST http://localhost:3000/scim/admin/endpoints \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tenant-alpha",
    "displayName": "Tenant Alpha",
    "description": "First test tenant"
  }'

# Response:
{
  "id": "clx...",
  "name": "tenant-alpha",
  "displayName": "Tenant Alpha",
  "scimEndpoint": "/scim/endpoints/clx...",
  "active": true,
  "createdAt": "2026-01-28T..."
}

# List tenants
curl http://localhost:3000/scim/admin/endpoints

# Create user in tenant
curl -X POST http://localhost:3000/scim/endpoints/clx.../Users \
  -H "Content-Type: application/json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "john.doe@example.com",
    "name": {"givenName": "John", "familyName": "Doe"}
  }'

# Delete tenant (cascade deletes all data)
curl -X DELETE http://localhost:3000/scim/admin/endpoints/clx...
```

## Data Isolation Guarantees

1. **Query Isolation:** All queries filter by `endpointId`
2. **Unique Constraints:** Identifiers (userName, externalId, scimId) are unique per endpoint, not globally
3. **Cascade Delete:** Deleting a tenant automatically deletes all associated:
   - Users
   - Groups
   - Group members
   - Logs
4. **Context Isolation:** AsyncLocalStorage ensures endpoint context is isolated per HTTP request

## API Response Format for Tenant Creation

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

## Next Steps

1. Run the migration to update the database schema
2. Implement tenant-aware methods in SCIM services
3. Update existing endpoints to maintain backward compatibility (optional)
4. Add tenant validation middleware
5. Add tests for tenant isolation
6. Update documentation with Multi-Endpoint examples

## Backward Compatibility

The default SCIM endpoints (`/scim/Users`, `/scim/Groups`, etc.) remain unchanged and can continue to serve a "default" or "global" tenant if needed. This allows for gradual migration to Multi-Endpoint architecture.

## Security Considerations

1. **Tenant Isolation:** Always filter by `endpointId` in queries
2. **API Authentication:** Implement authentication/authorization to restrict tenant access
3. **Audit Logging:** Log all tenant-level operations with audit trail
4. **Configuration Validation:** Validate endpoint configurations to prevent injection attacks


