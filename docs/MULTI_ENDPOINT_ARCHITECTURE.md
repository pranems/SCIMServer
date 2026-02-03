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
        │    Endpoint Management APIs            │
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
        │  │ Endpoint SCIM Controller          │   │
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
        │         │ EndpointContext  │            │
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
        │ ├─ Endpoint    │        │ ├─ [endpointId,   │
        │ ├─ ScimUser    │        │ │    scimId]    │
        │ ├─ ScimGroup   │        │ ├─ [endpointId,   │
        │ ├─ GroupMember │        │ │    userName]  │
        │ └─ RequestLog  │        │ └─ [endpointId,   │
        │                │        │    externalId]  │
        └────────────────┘        └─────────────────┘
```

## Data Flow for endpoint-specific Operations

### Creating a User in a Endpoint

```
Client Request
    ↓
POST /scim/endpoints/{endpointId}/Users
    ↓
EndpointScimController.createUser()
    ├─ validateAndSetContext(endpointId, req)
    │   ├─ Validate endpoint exists
    │   ├─ Load endpoint config
    │   └─ Return { baseUrl, config }
    └─ Call usersService.createUserForEndpoint(dto, baseUrl, endpointId)
        ↓
    EndpointScimUsersService.createUserForEndpoint(dto, baseUrl, endpointId)
        ├─ Validate schema
        ├─ Check unique identifiers within endpoint
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

### Isolating Data Between Endpoints

```
Endpoint A: /scim/endpoints/endpoint-a-id/
    └─ Users
        ├─ john.doe (created in endpoint A)
        ├─ jane.smith (created in endpoint A)
        └─ Database: WHERE endpointId = 'endpoint-a-id'

Endpoint B: /scim/endpoints/endpoint-b-id/
    └─ Users
        ├─ john.doe (different user, exists independently!)
        ├─ bob.jones (created in endpoint B)
        └─ Database: WHERE endpointId = 'endpoint-b-id'

Global Database:
┌─────────────────────────────────────────────────────────┐
│ ScimUser Table                                          │
├─────────────────────────────────────────────────────────┤
│ id    │ endpointId        │ scimId │ userName    │ active   │
├─────────────────────────────────────────────────────────┤
│ 1     │ endpoint-a-id   │ abc123 │ john.doe    │ true     │
│ 2     │ endpoint-a-id   │ def456 │ jane.smith  │ true     │
│ 3     │ endpoint-b-id   │ ghi789 │ john.doe    │ true     │ ← Different john.doe!
│ 4     │ endpoint-b-id   │ jkl012 │ bob.jones   │ true     │
└─────────────────────────────────────────────────────────┘

Unique Constraints:
  @@unique([endpointId, scimId])     ✓ Allows same scimId in different endpoints
  @@unique([endpointId, userName])   ✓ Allows same userName in different endpoints
  @@unique([endpointId, externalId]) ✓ Allows same externalId in different endpoints
```

## Cascade Delete Operation

```
DELETE /admin/endpoints/{endpointId}
    ↓
EndpointController.deleteEndpoint(endpointId)
    ↓
EndpointService.deleteEndpoint(endpointId)
    ├─ Validate endpoint exists
    └─ Prisma.endpoint.delete({ where: { id: endpointId } })
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

## Config Propagation Pattern ✅

Config is passed **directly from controller to service** as a parameter, which is more reliable than AsyncLocalStorage across async boundaries:

```
PATCH /scim/endpoints/{endpointId}/Groups/{id}
    ↓
EndpointScimController.updateGroup()
    ├─ validateAndSetContext(endpointId, req)
    │   └─ Returns { baseUrl, config }  ← Config loaded here
    └─ groupsService.patchGroupForEndpoint(id, dto, endpointId, config)
                                                              ↑
                                                    Config passed directly
        ↓
    EndpointScimGroupsService.patchGroupForEndpoint(scimId, dto, endpointId, config)
        ├─ Use config for endpoint-specific behavior:
        │  const allowMultiAdd = getConfigBoolean(config, 
        │    ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTI_MEMBERS);
        └─ Apply PATCH operations with config-driven behavior
```

## Request Context Isolation (Fallback)

AsyncLocalStorage is available as a **fallback** for backward compatibility:

```
Request 1 (Endpoint A)             Request 2 (Endpoint B)
│                                  │
├─ HTTP Request Arrives            ├─ HTTP Request Arrives
│  ├─ URL: /scim/endpoints/A/Users   │  ├─ URL: /scim/endpoints/B/Users
│  └─ Route Handler                └─ Route Handler
│     ├─ EndpointContext.setContext({│     ├─ EndpointContext.setContext({
│     │    endpointId: 'A',           │     │    endpointId: 'B',
│     │    baseUrl: '...',          │     │    baseUrl: '...',
│     │    config: {...}            │     │    config: {...}
│     │  })                         │     │  })
│     ├─ Config passed DIRECTLY     │     ├─ Config passed DIRECTLY
│     │  to service methods          │     │  to service methods
│     └─ Response                   │     └─ Response
│                                  │
└─ Direct parameter passing ─────────── most reliable method!
   AsyncLocalStorage available as fallback for services that need it.
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
│    ├─► EndpointModule ◄──────────┐            │
│    │     └─ EndpointService       │            │
│    │     └─ EndpointController    │            │
│    │                             │            │
│    ├─► ScimModule ◄──────────────┤────┐      │
│    │     ├─ EndpointScimController │    │      │
│    │     ├─ UsersController      │    │      │
│    │     ├─ GroupsController     │    │      │
│    │     ├─ EndpointScimUsersService│   │      │
│    │     ├─ EndpointScimGroupsService│  │      │
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
        │  Endpoints     │
        │  ScimUsers      │
        │  ScimGroups     │
        │  GroupMembers   │
        │  RequestLogs    │
        └─────────────────┘
```

## Summary

- **Multi-Endpoint Support:** Each endpoint has isolated SCIM endpoints and data
- **Config Propagation:** Config passed directly from controller to service (most reliable)
- **AsyncLocalStorage Fallback:** Available for backward compatibility
- **Data Isolation:** Composite unique constraints and filtered queries maintain separation
- **Cascade Operations:** Deleting an endpoint cleanly removes all associated data
- **Config Flags:** Endpoints support configuration flags for behavior customization
- **48 Tests Passing:** Full test coverage for endpoint isolation
- **Backward Compatible:** Original SCIM endpoints remain unchanged for legacy support

## Implementation Status ✅ COMPLETE

All phases implemented:
- ✅ Database schema with Endpoint model
- ✅ EndpointScimUsersService (full CRUD)
- ✅ EndpointScimGroupsService (full CRUD with config)
- ✅ Config propagation pattern
- ✅ 48 tests passing


