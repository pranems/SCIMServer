# Multi-Endpoint SCIM Architecture

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           API Gateway / Clients                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                ┌──────────┴──────────┐
                │                     │
        ┌───────▼────────┐    ┌──────▼─────────┐
        │  Admin Routes  │    │ SCIM Endpoints │
        │  /admin/*      │    │  /scim/*       │
        └───────┬────────┘    └──────┬─────────┘
                │                     │
        ┌───────▼─────────────────────▼─────────┐
        │                                        │
        │    Tenant Management APIs              │
        │  ┌─────────────────────────────────┐  │
        │  │ POST   /admin/endpoints           │  │
        │  │ GET    /admin/endpoints           │  │
        │  │ GET    /admin/endpoints/{id}      │  │
        │  │ PATCH  /admin/endpoints/{id}      │  │
        │  │ DELETE /admin/endpoints/{id}      │  │
        │  │ GET    /admin/endpoints/{id}/stats│  │
        │  └─────────────────────────────────┘  │
        │         ↓                               │
        │    EndpointController                    │
        │         ↓                               │
        │    EndpointService                       │
        │                                        │
        └───────┬─────────────────────────────┘
                │
        ┌───────▼──────────────────────────────────┐
        │                                          │
        │   endpoint-scoped SCIM Endpoints           │
        │   /scim/endpoints/{endpointId}/              │
        │  ┌──────────────────────────────────┐   │
        │  │ Tenant SCIM Controller            │   │
        │  │ ├─ Users   (CRUD)                 │   │
        │  │ ├─ Groups  (CRUD)                 │   │
        │  │ ├─ Schemas (Read)                 │   │
        │  │ ├─ ResourceTypes (Read)           │   │
        │  │ └─ ServiceProviderConfig (Read)   │   │
        │  └──────────────────────────────────┘   │
        │         ↓          ↓        ↓            │
        │         │          │        │            │
        │  ┌──────▼─┐  ┌────▼──┐  ┌─▼────────┐   │
        │  │ ScimUsers│  │ScimGroups
   │  │MetadataService│   │
        │  │Service │  │Service  │  │          │   │
        │  └──────┬─┘  └────┬──┘  └─┬────────┘   │
        │         │         │       │             │
        │         └─────────┼───────┘             │
        │                   │                     │
        │         ┌─────────▼────────┐            │
        │         │  TenantContext   │            │
        │         │ Storage (Request)│            │
        │         │ - endpointId       │            │
        │         │ - baseUrl        │            │
        │         └──────────────────┘            │
        │                                        │
        └──────────────────┬─────────────────────┘
                           │
                ┌──────────▼──────────┐
                │                     │
        ┌───────▼───────┐    ┌────────▼────────┐
        │  PrismaService│    │ PrismaClient     │
        │  (ORM Layer)  │    │                  │
        └───────┬───────┘    └────────┬─────────┘
                │                     │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────────┐
                │                         │
        ┌───────▼────────┐        ┌──────▼──────────┐
        │   Database     │        │  Relationships  │
        │   (SQLite)     │        │  & Constraints  │
        │                │        │                 │
        │ Models:        │        │ Composite Keys: │
        │ ├─ Tenant      │        │ ├─ [endpointId,   │
        │ ├─ ScimUser    │        │ │    scimId]    │
        │ ├─ ScimGroup   │        │ ├─ [endpointId,   │
        │ ├─ GroupMember │        │ │    userName]  │
        │ └─ RequestLog  │        │ └─ [endpointId,   │
        │                │        │    externalId]  │
        └────────────────┘        └─────────────────┘
```

## Data Flow for endpoint-specific Operations

### Creating a User in a Tenant

```
Client Request
    ↓
POST /scim/endpoints/{endpointId}/Users
    ↓
EndpointScimController.createUser()
    ├─ Validate tenant exists
    ├─ Set TenantContext: { endpointId, baseUrl }
    └─ Call UsersService.createUserForEndpoint()
        ↓
    ScimUsersService.createUserForEndpoint(dto, baseUrl, endpointId)
        ├─ Validate schema
        ├─ Check unique identifiers within tenant
        │  (Query: WHERE endpointId = ? AND userName = ?)
        ├─ Create user record with endpointId
        │  (INSERT INTO ScimUser (endpointId, scimId, userName, ...))
        └─ Return ScimUserResource with endpoint-specific links
            ↓
        Response to Client
            {
              "id": "scimId",
              "userName": "john.doe",
              "meta": {
                "location": "http://localhost:3000/scim/endpoints/{endpointId}/Users/scimId"
              }
            }
```

### Isolating Data Between Tenants

```
Tenant A: /scim/endpoints/tenant-a-id/
    └─ Users
        ├─ john.doe (created in tenant A)
        ├─ jane.smith (created in tenant A)
        └─ Database: WHERE endpointId = 'tenant-a-id'

Tenant B: /scim/endpoints/tenant-b-id/
    └─ Users
        ├─ john.doe (different user, exists independently!)
        ├─ bob.jones (created in tenant B)
        └─ Database: WHERE endpointId = 'tenant-b-id'

Global Database:
┌─────────────────────────────────────────────────────────┐
│ ScimUser Table                                          │
├─────────────────────────────────────────────────────────┤
│ id    │ endpointId      │ scimId │ userName    │ active   │
├─────────────────────────────────────────────────────────┤
│ 1     │ tenant-a-id   │ abc123 │ john.doe    │ true     │
│ 2     │ tenant-a-id   │ def456 │ jane.smith  │ true     │
│ 3     │ tenant-b-id   │ ghi789 │ john.doe    │ true     │ ← Different john.doe!
│ 4     │ tenant-b-id   │ jkl012 │ bob.jones   │ true     │
└─────────────────────────────────────────────────────────┘

Unique Constraints:
  @@unique([endpointId, scimId])     ✓ Allows same scimId in different tenants
  @@unique([endpointId, userName])   ✓ Allows same userName in different tenants
  @@unique([endpointId, externalId]) ✓ Allows same externalId in different tenants
```

## Cascade Delete Operation

```
DELETE /admin/endpoints/{endpointId}
    ↓
EndpointController.deleteTenant(endpointId)
    ↓
EndpointService.deleteTenant(endpointId)
    ├─ Validate tenant exists
    └─ Prisma.tenant.delete({ where: { id: endpointId } })
        ↓
    Database CASCADE Operations (Prisma handles):
    ├─ DELETE FROM RequestLog WHERE endpointId = ?
    ├─ DELETE FROM GroupMember WHERE groupId IN (
    │      SELECT id FROM ScimGroup WHERE endpointId = ?
    │  )
    ├─ DELETE FROM ScimGroup WHERE endpointId = ?
    └─ DELETE FROM ScimUser WHERE endpointId = ?
        ↓
    Response: 204 No Content
```

## Request Context Isolation with AsyncLocalStorage

```
Request 1 (Tenant A)               Request 2 (Tenant B)
│                                  │
├─ HTTP Request Arrives            ├─ HTTP Request Arrives
│  ├─ URL: /scim/endpoints/A/Users   │  ├─ URL: /scim/endpoints/B/Users
│  └─ Route Handler                └─ Route Handler
│     ├─ TenantContext.setContext({ │     ├─ TenantContext.setContext({
│     │    endpointId: 'A',           │     │    endpointId: 'B',
│     │    baseUrl: '...'           │     │    baseUrl: '...'
│     │  })                         │     │  })
│     ├─ Call Service with 'A'     │     ├─ Call Service with 'B'
│     ├─ Async operations use      │     ├─ Async operations use
│     │  local context             │     │  local context
│     └─ Response                   │     └─ Response
│                                  │
└─ AsyncLocalStorage ensures ─────────── isolated storage per request
   Context never bleeds between concurrent requests!
```

## Module Dependencies

```
┌──────────────────────────────────────────────┐
│           AppModule (Root)                   │
│  imports: [                                  │
│    ConfigModule,                             │
│    ScheduleModule,                           │
│    ActivityParserModule,                     │
│    AuthModule,                               │
│    BackupModule,                             │
│    DatabaseModule,                           │
│    PrismaModule,                             │
│    LoggingModule,                            │
│    ├─► TenantModule ◄──────────┐            │
│    │     └─ EndpointService       │            │
│    │     └─ EndpointController    │            │
│    │                             │            │
│    ├─► ScimModule ◄──────────────┤────┐      │
│    │     ├─ EndpointScimController │    │      │
│    │     ├─ UsersController      │    │      │
│    │     ├─ GroupsController     │    │      │
│    │     ├─ ScimUsersService     │    │      │
│    │     ├─ ScimGroupsService    │    │      │
│    │     └─ EndpointContextStorage │    │      │
│    │                              │    │      │
│    └─► WebModule                 │    │      │
│    └─► OAuthModule               │    │      │
│  ]                               │    │      │
└────────────────────────────────────┼─┬──────┘
                                     │ │
                ┌────────────────────┘ │
                │                      │
        ┌───────▼───────┐      ┌──────▼─────────┐
        │ PrismaModule  │      │ LoggingModule  │
        │               │      │                │
        │ PrismaService │      │ LoggingService │
        │ PrismaClient  │      │                │
        └───────┬───────┘      └────────────────┘
                │
        ┌───────▼─────────┐
        │   SQLite DB     │
        │                 │
        │  Tenants        │
        │  ScimUsers      │
        │  ScimGroups     │
        │  GroupMembers   │
        │  RequestLogs    │
        └─────────────────┘
```

## Summary

- **Multi-Endpoint Support:** Each tenant has isolated SCIM endpoints and data
- **Request-Scoped Context:** EndpointContextStorage ensures no data leakage between concurrent requests
- **Data Isolation:** Composite unique constraints and filtered queries maintain separation
- **Cascade Operations:** Deleting a tenant cleanly removes all associated data
- **Backward Compatible:** Original SCIM endpoints remain unchanged for legacy support


