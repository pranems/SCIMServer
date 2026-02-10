# Multi-Endpoint SCIM Architecture

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        API Gateway / Clients                             │
│                    (Authorization: Bearer <token>)                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                      │
    ┌─────────▼──────────┐              ┌───────────▼───────────┐
    │   Admin Routes     │              │    SCIM Routes        │
    │ /scim/admin/*      │              │ /scim/endpoints/*     │
    └─────────┬──────────┘              └───────────┬───────────┘
              │                                      │
┌─────────────▼────────────────────┐   ┌────────────▼─────────────────────┐
│                                  │   │                                   │
│  Endpoint Management APIs        │   │  Endpoint-Scoped SCIM APIs        │
│  /scim/admin/endpoints           │   │  /scim/endpoints/{endpointId}     │
│  ┌────────────────────────────┐  │   │  ┌─────────────────────────────┐  │
│  │ POST   /admin/endpoints    │  │   │  │ Users                       │  │
│  │ GET    /admin/endpoints    │  │   │  │ ├─ POST   /Users            │  │
│  │ GET    /admin/endpoints/{id}│  │   │  │ ├─ GET    /Users           │  │
│  │ GET    /admin/endpoints/   │  │   │  │ ├─ GET    /Users/{id}       │  │
│  │        by-name/{name}      │  │   │  │ ├─ PUT    /Users/{id}       │  │
│  │ PATCH  /admin/endpoints/{id}│  │   │  │ ├─ PATCH  /Users/{id}      │  │
│  │ DELETE /admin/endpoints/{id}│  │   │  │ └─ DELETE /Users/{id}      │  │
│  │ GET    /admin/endpoints/   │  │   │  │                             │  │
│  │        {id}/stats          │  │   │  │ Groups                      │  │
│  └────────────────────────────┘  │   │  │ ├─ POST   /Groups           │  │
│              ↓                   │   │  │ ├─ GET    /Groups           │  │
│       EndpointController         │   │  │ ├─ GET    /Groups/{id}      │  │
│              ↓                   │   │  │ ├─ PUT    /Groups/{id}      │  │
│       EndpointService            │   │  │ ├─ PATCH  /Groups/{id}      │  │
│                                  │   │  │ └─ DELETE /Groups/{id}      │  │
└──────────────┬───────────────────┘   │  │                             │  │
               │                       │  │ Metadata                    │  │
               │                       │  │ ├─ GET /Schemas             │  │
               │                       │  │ ├─ GET /ResourceTypes       │  │
               │                       │  │ └─ GET /ServiceProviderConfig│ │
               │                       │  └─────────────────────────────┘  │
               │                       │              ↓                    │
               │                       │    EndpointScimUsersController /  │
               │                       │    EndpointScimGroupsController /  │
               │                       │    EndpointScimDiscoveryController │
               │                       │              ↓                    │
               │                       │  ┌───────────┴───────────┐        │
               │                       │  │                       │        │
               │                       │  ▼                       ▼        │
               │                       │ EndpointScim      EndpointScim    │
               │                       │ UsersService      GroupsService   │
               │                       │                                   │
               │                       └───────────────┬───────────────────┘
               │                                       │
               └───────────────────┬───────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │     EndpointContext         │
                    │     Storage (Request)       │
                    │  - endpointId               │
                    │  - baseUrl                  │
                    │  - config (JSON)            │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       PrismaService         │
                    │       (ORM Layer)           │
                    └──────────────┬──────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
    ┌────▼────┐              ┌─────▼─────┐            ┌──────▼──────┐
    │ Endpoint │              │ ScimUser  │            │ ScimGroup   │
    │ Model    │◄─────────────│ Model     │            │ Model       │
    │          │  endpointId  │           │            │             │
    └──────────┘              └───────────┘            └─────────────┘
         │                         │                         │
         │    Composite Unique Constraints:                  │
         │    ├─ @@unique([endpointId, scimId])              │
         │    ├─ @@unique([endpointId, userName])            │
         │    └─ @@unique([endpointId, externalId])          │
         │                                                   │
         └──────────────── CASCADE DELETE ───────────────────┘
```

## Complete API Hierarchy

```
/scim
├── /oauth
│   └── POST /token                              → Get OAuth Bearer token
│
├── /admin/endpoints                             → Endpoint Management
│   ├── POST   /                                 → Create endpoint
│   │   Body: { name, displayName?, description?, config? }
│   │   Response: EndpointResponse (201)
│   │
│   ├── GET    /                                 → List endpoints
│   │   Query: ?active=true|false
│   │   Response: EndpointResponse[] (200)
│   │
│   ├── GET    /{endpointId}                     → Get endpoint by ID
│   │   Response: EndpointResponse (200)
│   │
│   ├── GET    /by-name/{name}                   → Get endpoint by name
│   │   Response: EndpointResponse (200)
│   │
│   ├── PATCH  /{endpointId}                     → Update endpoint
│   │   Body: { displayName?, description?, config?, active? }
│   │   Response: EndpointResponse (200)
│   │   Note: Set active=false to disable SCIM operations
│   │
│   ├── DELETE /{endpointId}                     → Delete endpoint + all data
│   │   Response: 204 No Content
│   │
│   └── GET    /{endpointId}/stats               → Get statistics
│       Response: { totalUsers, totalGroups, totalGroupMembers, requestLogCount }
│
└── /endpoints/{endpointId}                      → Endpoint-Scoped SCIM
    │
    │   ⚠️ All operations return 403 Forbidden if endpoint.active=false
    │
    ├── /Users
    │   ├── POST   /                             → Create user
    │   │   Content-Type: application/scim+json
    │   │   Body: { schemas, userName, externalId?, active?, name?, ... }
    │   │   Response: ScimUserResource (201)
    │   │
    │   ├── GET    /                             → List users
    │   │   Query: ?filter=...&startIndex=1&count=100
    │   │   Response: ScimListResponse (200)
    │   │
    │   ├── GET    /{id}                         → Get user
    │   │   Response: ScimUserResource (200)
    │   │
    │   ├── PUT    /{id}                         → Replace user
    │   │   Body: Full ScimUserResource
    │   │   Response: ScimUserResource (200)
    │   │
    │   ├── PATCH  /{id}                         → Update user (SCIM PATCH)
    │   │   Body: { schemas, Operations: [{op, path?, value?}] }
    │   │   Response: ScimUserResource (200)
    │   │
    │   └── DELETE /{id}                         → Delete user
    │       Response: 204 No Content
    │
    ├── /Groups
    │   ├── POST   /                             → Create group
    │   │   Body: { schemas, displayName, members?: [{value, display?}] }
    │   │   Response: ScimGroupResource (201)
    │   │
    │   ├── GET    /                             → List groups
    │   │   Query: ?filter=...&startIndex=1&count=100
    │   │   Response: ScimListResponse (200)
    │   │
    │   ├── GET    /{id}                         → Get group
    │   │   Response: ScimGroupResource (200)
    │   │
    │   ├── PUT    /{id}                         → Replace group
    │   │   Body: Full ScimGroupResource
    │   │   Response: ScimGroupResource (200)
    │   │
    │   ├── PATCH  /{id}                         → Update group (config-aware)
    │   │   Body: { schemas, Operations: [{op, path?, value?}] }
    │   │   Note: MultiOpPatchRequestAddMultipleMembersToGroup flag affects behavior
    │   │   Response: 200 OK or 204 No Content
    │   │
    │   └── DELETE /{id}                         → Delete group
    │       Response: 204 No Content
    │
    ├── /Schemas                                 → Get SCIM schemas
    │   Response: ListResponse with User/Group schemas
    │
    ├── /ResourceTypes                           → Get resource types
    │   Response: ListResponse with User/Group types
    │
    └── /ServiceProviderConfig                   → Get service config
        Response: ServiceProviderConfig resource
```

## Data Flow for Endpoint-Specific Operations

### Complete Request Flow: Creating a User

```
Client
  │
  │  POST /scim/endpoints/{endpointId}/Users
  │  Headers:
  │    Authorization: Bearer <token>
  │    Content-Type: application/scim+json
  │  Body:
  │    {
  │      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  │      "userName": "john.doe@example.com",
  │      "name": { "givenName": "John", "familyName": "Doe" }
  │    }
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ NestJS Router                                                    │
│ Route: @Controller('endpoints/:endpointId') → EndpointScimUsers/Groups/DiscoveryController              │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ EndpointScimUsersController.createUser()                        │
│                                                                  │
│ @Post('Users')                                                   │
│ async createUser(                                                │
│   @Param('endpointId') endpointId: string,                      │
│   @Body() dto: CreateUserDto,                                   │
│   @Req() req: Request                                           │
│ ) {                                                             │
│   // Step 1: Validate endpoint & get config                     │
│   const { baseUrl, config } = await this.validateAndSetContext( │
│     endpointId, req                                             │
│   );                                                            │
│                                                                  │
│   // Step 2: Call service with endpoint context                 │
│   return this.usersService.createUserForEndpoint(               │
│     dto, baseUrl, endpointId                                    │
│   );                                                            │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ validateAndSetContext(endpointId, req)                          │
│                                                                  │
│ 1. Get endpoint from database:                                  │
│    const endpoint = await endpointService.getEndpoint(endpointId)│
│                                                                  │
│ 2. Extract config (JSON):                                       │
│    const config: EndpointConfig = endpoint.config || {};        │
│                                                                  │
│ 3. Build baseUrl:                                               │
│    const baseUrl = `${protocol}://${host}/scim/endpoints/${id}` │
│                                                                  │
│ 4. Set context (AsyncLocalStorage fallback):                    │
│    this.endpointContext.setContext({ endpointId, baseUrl, config })│
│                                                                  │
│ 5. Return { baseUrl, config }                                   │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ EndpointScimUsersService.createUserForEndpoint(dto, baseUrl, id)│
│                                                                  │
│ 1. Validate SCIM schema                                         │
│ 2. Check unique constraints within endpoint:                    │
│    WHERE userName = ? AND endpointId = ?                        │
│ 3. Generate scimId (UUID)                                       │
│ 4. Create user in database:                                     │
│    prisma.scimUser.create({                                     │
│      data: { endpointId, scimId, userName, ... }                │
│    })                                                           │
│ 5. Return ScimUserResource with endpoint-specific location      │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
Response (201 Created)
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "generated-uuid",
  "userName": "john.doe@example.com",
  "name": { "givenName": "John", "familyName": "Doe" },
  "meta": {
    "resourceType": "User",
    "created": "2026-02-03T10:00:00.000Z",
    "lastModified": "2026-02-03T10:00:00.000Z",
    "location": "http://localhost:3000/scim/endpoints/{endpointId}/Users/generated-uuid"
  }
}
```

### Config-Aware PATCH Operation Flow (Groups)

```
Client
  │
  │  PATCH /scim/endpoints/{endpointId}/Groups/{groupId}
  │  Body: { "Operations": [{ "op": "add", "path": "members", "value": [...] }] }
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ EndpointScimGroupsController.updateGroup()                      │
│                                                                  │
│ @Patch('Groups/:id')                                            │
│ async updateGroup(...) {                                        │
│   // Config is loaded and passed DIRECTLY to service            │
│   const { config } = await this.validateAndSetContext(id, req); │
│   return this.groupsService.patchGroupForEndpoint(              │
│     id, dto, endpointId, config  // ← Config passed as param    │
│   );                                                            │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ EndpointScimGroupsService.patchGroupForEndpoint(                │
│   scimId, dto, endpointId, config?: EndpointConfig              │
│ )                                                               │
│                                                                  │
│ // Use config for endpoint-specific behavior                    │
│ const allowMultiAdd = getConfigBoolean(                         │
│   config,                                                       │
│   ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP │
│ );                                                              │
│                                                                  │
│ // If adding multiple members and flag is false → throw error   │
│ // If flag is true → allow multiple members in single operation │
└─────────────────────────────────────────────────────────────────┘
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
DELETE /scim/admin/endpoints/{endpointId}
Authorization: Bearer <token>
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ EndpointController.deleteEndpoint(endpointId)                   │
│   → EndpointService.deleteEndpoint(endpointId)                  │
│       │                                                         │
│       ├─ Validate endpoint exists                               │
│       │                                                         │
│       └─ Prisma.endpoint.delete({ where: { id: endpointId } })  │
│           │                                                     │
│           ▼                                                     │
│       Database CASCADE Operations (Prisma/SQLite):              │
│       ┌─────────────────────────────────────────────────────┐   │
│       │ DELETE FROM RequestLog WHERE endpointId = ?          │   │
│       │ DELETE FROM GroupMember WHERE groupId IN (           │   │
│       │     SELECT id FROM ScimGroup WHERE endpointId = ?    │   │
│       │ )                                                    │   │
│       │ DELETE FROM ScimGroup WHERE endpointId = ?           │   │
│       │ DELETE FROM ScimUser WHERE endpointId = ?            │   │
│       │ DELETE FROM Endpoint WHERE id = ?                    │   │
│       └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
Response: 204 No Content
```

## Config Propagation Pattern ✅

Config is passed **directly from controller to service** as a parameter, which is more reliable than AsyncLocalStorage across async boundaries:

```
PATCH /scim/endpoints/{endpointId}/Groups/{id}
    ↓
EndpointScimGroupsController.updateGroup()
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
┌────────────────────────────────────────────────────────────────────────┐
│                         AppModule (Root)                               │
│  imports: [                                                            │
│    ConfigModule, ScheduleModule, PrismaModule, LoggingModule           │
│  ]                                                                     │
└────────────────────────────────────────────────────────────────────────┘
               │                                        
    ┌──────────┼──────────────────────┬────────────────────┐
    ▼          ▼                      ▼                    ▼
┌───────────┐ ┌───────────────────┐ ┌────────────────┐ ┌────────────────┐
│ AuthModule│ │   EndpointModule  │ │   ScimModule   │ │   OAuthModule  │
│           │ │                   │ │                │ │                │
│ JwtGuard  │ │ EndpointController│ │ Controllers:   │ │ OAuthController│
│ AuthGuard │ │   @Controller(    │ │ EndpointScim   │ │   /scim/oauth/ │
│           │ │  'admin/endpoints')│ │   Controller   │ │                │
│           │ │                   │ │   @Controller  │ │ POST /token    │
│           │ │ EndpointService   │ │   ('endpoints  │ │                │
│           │ │   CRUD operations │ │    /:id')      │ │                │
│           │ │                   │ │                │ │                │
└───────────┘ └───────────────────┘ │ UsersController│ └────────────────┘
                                    │ GroupsController│
                                    │                │
                                    │ Services:      │
                                    │ EndpointScim   │
                                    │   UsersService │
                                    │ EndpointScim   │
                                    │   GroupsService│
                                    │ ScimUsers      │
                                    │   Service      │
                                    │ ScimGroups     │
                                    │   Service      │
                                    │ Endpoint       │
                                    │   Context      │
                                    │   Storage      │
                                    └────────────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                     ┌────────────┐  ┌─────────────┐  ┌──────────────┐
                     │ PrismaModule│  │LoggingModule│  │DatabaseModule│
                     │            │  │             │  │              │
                     │PrismaService│  │LoggingService│  │ SQLite DB   │
                     │PrismaClient│  │             │  │              │
                     └────────────┘  └─────────────┘  └──────────────┘
                              │
                              ▼
                     ┌───────────────────────────────────┐
                     │          SQLite Database          │
                     │                                   │
                     │  ┌─────────────┐  ┌─────────────┐ │
                     │  │  Endpoint   │←─│ RequestLog  │ │
                     │  │   (config)  │  │             │ │
                     │  └──────┬──────┘  └─────────────┘ │
                     │         │                         │
                     │    ┌────┴─────┐                   │
                     │    ▼          ▼                   │
                     │ ┌────────┐ ┌──────────┐           │
                     │ │ScimUser│ │ScimGroup │           │
                     │ │        │ │          │           │
                     │ └────────┘ └────┬─────┘           │
                     │                 │                 │
                     │                 ▼                 │
                     │          ┌────────────┐           │
                     │          │GroupMember │           │
                     │          └────────────┘           │
                     └───────────────────────────────────┘
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


