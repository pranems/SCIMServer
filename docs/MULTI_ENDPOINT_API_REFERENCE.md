# Multi-Endpoint SCIM API Reference

Complete API reference for multi-endpoint SCIM operations. All endpoints require OAuth Bearer token authentication unless specified.

## Base URLs

```
Endpoint Management:  /scim/admin/endpoints
Endpoint-Specific:    /scim/endpoints/{endpointId}
```

## Authentication

All requests require:
```
Authorization: Bearer <token>
```

Get token via OAuth client credentials:
```bash
curl -X POST http://localhost:3000/scim/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=scimtool-client&client_secret=changeme-oauth&grant_type=client_credentials"
```

---

## Endpoint Management APIs

Base path: `/scim/admin/endpoints`

### POST /admin/endpoints - Create Endpoint

Create a new isolated endpoint with optional configuration flags.

**Request:**
```http
POST /scim/admin/endpoints
Content-Type: application/json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "name": "my-endpoint",
  "displayName": "My Endpoint Display Name",
  "description": "Optional description",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "true"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique identifier (alphanumeric, hyphens, underscores) |
| `displayName` | string | ❌ | Human-readable name |
| `description` | string | ❌ | Optional description |
| `config` | object | ❌ | Configuration flags (see Config Flags section) |

**Response (201 Created):**
```json
{
  "id": "clx123abc456def",
  "name": "my-endpoint",
  "displayName": "My Endpoint Display Name",
  "description": "Optional description",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "true"
  },
  "active": true,
  "scimEndpoint": "/scim/endpoints/clx123abc456def",
  "createdAt": "2026-02-03T10:00:00.000Z",
  "updatedAt": "2026-02-03T10:00:00.000Z"
}
```

**curl Example:**
```bash
curl -X POST http://localhost:3000/scim/admin/endpoints \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "acme-corp",
    "displayName": "ACME Corporation",
    "config": {
      "MultiOpPatchRequestAddMultipleMembersToGroup": "true"
    }
  }'
```

---

### GET /admin/endpoints - List Endpoints

List all endpoints, optionally filtered by active status.

**Request:**
```http
GET /scim/admin/endpoints?active=true
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `active` | boolean | Filter by active status (`true`/`false`) |

**Response (200 OK):**
```json
[
  {
    "id": "clx123abc456def",
    "name": "acme-corp",
    "displayName": "ACME Corporation",
    "active": true,
    "scimEndpoint": "/scim/endpoints/clx123abc456def",
    "createdAt": "2026-02-03T10:00:00.000Z",
    "updatedAt": "2026-02-03T10:00:00.000Z"
  },
  {
    "id": "clx789xyz123abc",
    "name": "beta-inc",
    "displayName": "Beta Inc",
    "active": true,
    "scimEndpoint": "/scim/endpoints/clx789xyz123abc",
    "createdAt": "2026-02-03T11:00:00.000Z",
    "updatedAt": "2026-02-03T11:00:00.000Z"
  }
]
```

**curl Example:**
```bash
# List all endpoints
curl http://localhost:3000/scim/admin/endpoints \
  -H "Authorization: Bearer $TOKEN"

# List only active endpoints
curl "http://localhost:3000/scim/admin/endpoints?active=true" \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /admin/endpoints/{endpointId} - Get Endpoint by ID

Retrieve a specific endpoint by its ID.

**Request:**
```http
GET /scim/admin/endpoints/{endpointId}
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "id": "clx123abc456def",
  "name": "acme-corp",
  "displayName": "ACME Corporation",
  "description": "Production endpoint",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "true"
  },
  "active": true,
  "scimEndpoint": "/scim/endpoints/clx123abc456def",
  "createdAt": "2026-02-03T10:00:00.000Z",
  "updatedAt": "2026-02-03T10:00:00.000Z"
}
```

**curl Example:**
```bash
curl http://localhost:3000/scim/admin/endpoints/clx123abc456def \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /admin/endpoints/by-name/{name} - Get Endpoint by Name

Retrieve a specific endpoint by its unique name.

**Request:**
```http
GET /scim/admin/endpoints/by-name/{name}
Authorization: Bearer <token>
```

**Response (200 OK):** Same as Get by ID

**curl Example:**
```bash
curl http://localhost:3000/scim/admin/endpoints/by-name/acme-corp \
  -H "Authorization: Bearer $TOKEN"
```

---

### PATCH /admin/endpoints/{endpointId} - Update Endpoint

Update endpoint configuration.

**Request:**
```http
PATCH /scim/admin/endpoints/{endpointId}
Content-Type: application/json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "displayName": "Updated Display Name",
  "description": "Updated description",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "false"
  },
  "active": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `displayName` | string | ❌ | Update display name |
| `description` | string | ❌ | Update description |
| `config` | object | ❌ | Update configuration flags |
| `active` | boolean | ❌ | Enable/disable endpoint (inactive endpoints reject all SCIM operations with 403 Forbidden) |

**Response (200 OK):** Updated endpoint object

**⚠️ Inactive Endpoint Behavior:**
When `active` is set to `false`, the endpoint will:
- Return **403 Forbidden** for all SCIM operations (Users, Groups)
- Still be visible in admin endpoint listing
- Retain all data (users, groups, logs)
- Be re-activatable by setting `active: true`

**curl Example:**
```bash
curl -X PATCH http://localhost:3000/scim/admin/endpoints/clx123abc456def \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "config": {
      "MultiOpPatchRequestAddMultipleMembersToGroup": "true"
    }
  }'
```

---

### DELETE /admin/endpoints/{endpointId} - Delete Endpoint

Delete endpoint and ALL associated data (users, groups, logs). **This is a destructive operation!**

**Request:**
```http
DELETE /scim/admin/endpoints/{endpointId}
Authorization: Bearer <token>
```

**Response (204 No Content)**

**Cascade Deletes:**
- All ScimUsers in the endpoint
- All ScimGroups in the endpoint
- All GroupMembers in endpoint groups
- All RequestLogs for the endpoint

**curl Example:**
```bash
curl -X DELETE http://localhost:3000/scim/admin/endpoints/clx123abc456def \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /admin/endpoints/{endpointId}/stats - Get Endpoint Statistics

Get resource counts for an endpoint.

**Request:**
```http
GET /scim/admin/endpoints/{endpointId}/stats
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "totalUsers": 150,
  "totalGroups": 25,
  "totalGroupMembers": 450,
  "requestLogCount": 12500
}
```

**curl Example:**
```bash
curl http://localhost:3000/scim/admin/endpoints/clx123abc456def/stats \
  -H "Authorization: Bearer $TOKEN"
```

---

## Endpoint-Specific SCIM APIs

Base path: `/scim/endpoints/{endpointId}`

All operations below are scoped to the specified endpoint.

---

### Users Endpoints

#### POST /endpoints/{endpointId}/Users - Create User

Create a user within the endpoint.

**Request:**
```http
POST /scim/endpoints/{endpointId}/Users
Content-Type: application/scim+json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "john.doe@example.com",
  "externalId": "emp-12345",
  "active": true,
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "john.doe@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "phoneNumbers": [
    {
      "value": "+1-555-123-4567",
      "type": "work"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemas` | string[] | ✅ | Must include `urn:ietf:params:scim:schemas:core:2.0:User` |
| `userName` | string | ✅ | Unique within endpoint |
| `externalId` | string | ❌ | External system identifier |
| `active` | boolean | ❌ | Default: `true` |
| `name` | object | ❌ | Name components |
| `displayName` | string | ❌ | Display name |
| `emails` | array | ❌ | Email addresses |
| `phoneNumbers` | array | ❌ | Phone numbers |

**Response (201 Created):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "user-uuid-12345",
  "userName": "john.doe@example.com",
  "externalId": "emp-12345",
  "active": true,
  "name": {
    "givenName": "John",
    "familyName": "Doe"
  },
  "meta": {
    "resourceType": "User",
    "created": "2026-02-03T10:00:00.000Z",
    "lastModified": "2026-02-03T10:00:00.000Z",
    "location": "http://localhost:3000/scim/endpoints/clx123abc456def/Users/user-uuid-12345"
  }
}
```

**curl Example:**
```bash
curl -X POST http://localhost:3000/scim/endpoints/clx123abc456def/Users \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "john.doe@example.com",
    "name": {"givenName": "John", "familyName": "Doe"},
    "active": true
  }'
```

---

#### GET /endpoints/{endpointId}/Users - List Users

List users in the endpoint with optional filtering and pagination.

**Request:**
```http
GET /scim/endpoints/{endpointId}/Users?filter=userName eq "john.doe"&startIndex=1&count=100
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | string | SCIM filter expression |
| `startIndex` | integer | 1-based starting index |
| `count` | integer | Maximum results to return |

**Response (200 OK):**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 150,
  "startIndex": 1,
  "itemsPerPage": 100,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "user-uuid-12345",
      "userName": "john.doe@example.com",
      "active": true,
      "meta": {
        "resourceType": "User",
        "location": "http://localhost:3000/scim/endpoints/clx123abc456def/Users/user-uuid-12345"
      }
    }
  ]
}
```

**curl Examples:**
```bash
# List all users
curl "http://localhost:3000/scim/endpoints/clx123abc456def/Users" \
  -H "Authorization: Bearer $TOKEN"

# Filter by userName
curl -G "http://localhost:3000/scim/endpoints/clx123abc456def/Users" \
  --data-urlencode 'filter=userName eq "john.doe@example.com"' \
  -H "Authorization: Bearer $TOKEN"

# Paginated list
curl "http://localhost:3000/scim/endpoints/clx123abc456def/Users?startIndex=1&count=50" \
  -H "Authorization: Bearer $TOKEN"
```

---

#### GET /endpoints/{endpointId}/Users/{id} - Get User

Get a specific user by SCIM ID.

**Request:**
```http
GET /scim/endpoints/{endpointId}/Users/{id}
Authorization: Bearer <token>
```

**Response (200 OK):** Full user resource

**curl Example:**
```bash
curl http://localhost:3000/scim/endpoints/clx123abc456def/Users/user-uuid-12345 \
  -H "Authorization: Bearer $TOKEN"
```

---

#### PUT /endpoints/{endpointId}/Users/{id} - Replace User

Full replacement of user resource.

**Request:**
```http
PUT /scim/endpoints/{endpointId}/Users/{id}
Content-Type: application/scim+json
Authorization: Bearer <token>
```

**Request Body:** Same as Create User

**Response (200 OK):** Updated user resource

**curl Example:**
```bash
curl -X PUT http://localhost:3000/scim/endpoints/clx123abc456def/Users/user-uuid-12345 \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "john.doe@example.com",
    "name": {"givenName": "John", "familyName": "Smith"},
    "active": true
  }'
```

---

#### PATCH /endpoints/{endpointId}/Users/{id} - Update User

Partial update using SCIM PATCH operations.

**Request:**
```http
PATCH /scim/endpoints/{endpointId}/Users/{id}
Content-Type: application/scim+json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "active",
      "value": false
    },
    {
      "op": "replace",
      "path": "name.familyName",
      "value": "Smith"
    }
  ]
}
```

| Operation | Description |
|-----------|-------------|
| `add` | Add attribute value |
| `remove` | Remove attribute value |
| `replace` | Replace attribute value |

**Response (200 OK):** Updated user resource

**curl Example:**
```bash
curl -X PATCH http://localhost:3000/scim/endpoints/clx123abc456def/Users/user-uuid-12345 \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {"op": "replace", "path": "active", "value": false}
    ]
  }'
```

---

#### DELETE /endpoints/{endpointId}/Users/{id} - Delete User

Delete a user from the endpoint.

**Request:**
```http
DELETE /scim/endpoints/{endpointId}/Users/{id}
Authorization: Bearer <token>
```

**Response (204 No Content)**

**curl Example:**
```bash
curl -X DELETE http://localhost:3000/scim/endpoints/clx123abc456def/Users/user-uuid-12345 \
  -H "Authorization: Bearer $TOKEN"
```

---

### Groups Endpoints

#### POST /endpoints/{endpointId}/Groups - Create Group

Create a group within the endpoint.

**Request:**
```http
POST /scim/endpoints/{endpointId}/Groups
Content-Type: application/scim+json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-uuid-12345",
      "display": "John Doe"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemas` | string[] | ✅ | Must include `urn:ietf:params:scim:schemas:core:2.0:Group` |
| `displayName` | string | ✅ | Group name |
| `members` | array | ❌ | Initial members |

**Response (201 Created):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "group-uuid-67890",
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-uuid-12345",
      "display": "John Doe",
      "type": "User"
    }
  ],
  "meta": {
    "resourceType": "Group",
    "created": "2026-02-03T10:00:00.000Z",
    "lastModified": "2026-02-03T10:00:00.000Z",
    "location": "http://localhost:3000/scim/endpoints/clx123abc456def/Groups/group-uuid-67890"
  }
}
```

**curl Example:**
```bash
curl -X POST http://localhost:3000/scim/endpoints/clx123abc456def/Groups \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName": "Engineering Team"
  }'
```

---

#### GET /endpoints/{endpointId}/Groups - List Groups

List groups in the endpoint.

**Request:**
```http
GET /scim/endpoints/{endpointId}/Groups?filter=displayName co "Engineering"&startIndex=1&count=50
Authorization: Bearer <token>
```

**Query Parameters:** Same as List Users

**Response (200 OK):** ListResponse with group resources

**curl Example:**
```bash
curl "http://localhost:3000/scim/endpoints/clx123abc456def/Groups" \
  -H "Authorization: Bearer $TOKEN"
```

---

#### GET /endpoints/{endpointId}/Groups/{id} - Get Group

Get a specific group by SCIM ID.

**Response (200 OK):** Full group resource with members

**curl Example:**
```bash
curl http://localhost:3000/scim/endpoints/clx123abc456def/Groups/group-uuid-67890 \
  -H "Authorization: Bearer $TOKEN"
```

---

#### PUT /endpoints/{endpointId}/Groups/{id} - Replace Group

Full replacement of group resource.

**curl Example:**
```bash
curl -X PUT http://localhost:3000/scim/endpoints/clx123abc456def/Groups/group-uuid-67890 \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName": "Engineering Team - Updated",
    "members": [
      {"value": "user-uuid-12345"},
      {"value": "user-uuid-67890"}
    ]
  }'
```

---

#### PATCH /endpoints/{endpointId}/Groups/{id} - Update Group

Partial update using SCIM PATCH operations.

**Request Body - Add Single Member:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        {"value": "user-uuid-new-member"}
      ]
    }
  ]
}
```

**Request Body - Add Multiple Members (requires config flag):**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [
        {"value": "user-uuid-1"},
        {"value": "user-uuid-2"},
        {"value": "user-uuid-3"}
      ]
    }
  ]
}
```

> **Note:** Adding multiple members in a single operation requires `MultiOpPatchRequestAddMultipleMembersToGroup: "true"` in endpoint config.

**Request Body - Remove Member:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "remove",
      "path": "members[value eq \"user-uuid-to-remove\"]"
    }
  ]
}
```

**Request Body - Replace displayName:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "displayName",
      "value": "New Group Name"
    }
  ]
}
```

**Response (200 OK or 204 No Content)**

**curl Example - Add Member:**
```bash
curl -X PATCH http://localhost:3000/scim/endpoints/clx123abc456def/Groups/group-uuid-67890 \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {"op": "add", "path": "members", "value": [{"value": "user-uuid-new"}]}
    ]
  }'
```

---

#### DELETE /endpoints/{endpointId}/Groups/{id} - Delete Group

Delete a group from the endpoint.

**Response (204 No Content)**

**curl Example:**
```bash
curl -X DELETE http://localhost:3000/scim/endpoints/clx123abc456def/Groups/group-uuid-67890 \
  -H "Authorization: Bearer $TOKEN"
```

---

### Metadata Endpoints

#### GET /endpoints/{endpointId}/Schemas

Get SCIM schemas.

**Response (200 OK):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ListResponse"],
  "totalResults": 2,
  "Resources": [
    {
      "id": "urn:ietf:params:scim:schemas:core:2.0:User",
      "name": "User",
      "description": "User Account",
      "attributes": [...]
    },
    {
      "id": "urn:ietf:params:scim:schemas:core:2.0:Group",
      "name": "Group",
      "description": "Group",
      "attributes": [...]
    }
  ]
}
```

---

#### GET /endpoints/{endpointId}/ResourceTypes

Get supported resource types.

**Response (200 OK):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ListResponse"],
  "totalResults": 2,
  "Resources": [
    {
      "id": "User",
      "name": "User",
      "endpoint": "/Users",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:User"
    },
    {
      "id": "Group",
      "name": "Group",
      "endpoint": "/Groups",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:Group"
    }
  ]
}
```

---

#### GET /endpoints/{endpointId}/ServiceProviderConfig

Get service provider configuration.

**Response (200 OK):**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "patch": {"supported": true},
  "bulk": {"supported": false},
  "filter": {"supported": true, "maxResults": 200},
  "changePassword": {"supported": false},
  "sort": {"supported": true},
  "etag": {"supported": true},
  "authenticationSchemes": [
    {
      "type": "oauthbearertoken",
      "name": "OAuth Bearer Token",
      "description": "Authentication using OAuth Bearer Token"
    }
  ]
}
```

---

## Endpoint Configuration Flags

Configuration flags control endpoint-specific behavior.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `MultiOpPatchRequestAddMultipleMembersToGroup` | string/boolean | `false` | Allow adding multiple members in single PATCH operation |
| `excludeMeta` | boolean | `false` | Exclude `meta` attribute from responses |
| `excludeSchemas` | boolean | `false` | Exclude `schemas` attribute from responses |
| `customSchemaUrn` | string | - | Custom schema URN prefix |
| `includeEnterpriseSchema` | boolean | `false` | Include Enterprise User extension |
| `strictMode` | boolean | `false` | Enable strict validation |
| `legacyMode` | boolean | `false` | Enable SCIM 1.1 compatibility |

**Example - Creating Endpoint with Config Flags:**
```bash
curl -X POST http://localhost:3000/scim/admin/endpoints \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "azure-ad-compatible",
    "displayName": "Azure AD Compatible Endpoint",
    "config": {
      "MultiOpPatchRequestAddMultipleMembersToGroup": "false",
      "strictMode": true
    }
  }'
```

---

## Error Responses

### 400 Bad Request
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "400",
  "detail": "Validation failed: userName is required"
}
```

### 401 Unauthorized
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "401",
  "detail": "Invalid or missing authorization token"
}
```

### 404 Not Found
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "404",
  "detail": "Resource not found"
}
```

### 409 Conflict
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "userName already exists in this endpoint"
}
```

---

## Complete Workflow Example

```bash
# 1. Get OAuth token
TOKEN=$(curl -s -X POST http://localhost:3000/scim/oauth/token \
  -d "client_id=scimtool-client&client_secret=changeme-oauth&grant_type=client_credentials" \
  | jq -r '.access_token')

# 2. Create endpoint
ENDPOINT=$(curl -s -X POST http://localhost:3000/scim/admin/endpoints \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "demo-endpoint", "displayName": "Demo Endpoint"}')

ENDPOINT_ID=$(echo $ENDPOINT | jq -r '.id')
echo "Created endpoint: $ENDPOINT_ID"

# 3. Create user in endpoint
USER=$(curl -s -X POST "http://localhost:3000/scim/endpoints/$ENDPOINT_ID/Users" \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "john.doe@demo.com",
    "name": {"givenName": "John", "familyName": "Doe"}
  }')

USER_ID=$(echo $USER | jq -r '.id')
echo "Created user: $USER_ID"

# 4. Create group with user
curl -s -X POST "http://localhost:3000/scim/endpoints/$ENDPOINT_ID/Groups" \
  -H "Content-Type: application/scim+json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"schemas\": [\"urn:ietf:params:scim:schemas:core:2.0:Group\"],
    \"displayName\": \"Demo Group\",
    \"members\": [{\"value\": \"$USER_ID\"}]
  }"

# 5. List users in endpoint
curl -s "http://localhost:3000/scim/endpoints/$ENDPOINT_ID/Users" \
  -H "Authorization: Bearer $TOKEN" | jq

# 6. Get endpoint stats
curl -s "http://localhost:3000/scim/admin/endpoints/$ENDPOINT_ID/stats" \
  -H "Authorization: Bearer $TOKEN" | jq

# 7. Clean up - delete endpoint (cascades to all data)
curl -X DELETE "http://localhost:3000/scim/admin/endpoints/$ENDPOINT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## API Summary Table

### Endpoint Management (`/scim/admin/endpoints`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/endpoints` | Create endpoint |
| GET | `/admin/endpoints` | List endpoints |
| GET | `/admin/endpoints/{id}` | Get endpoint by ID |
| GET | `/admin/endpoints/by-name/{name}` | Get endpoint by name |
| PATCH | `/admin/endpoints/{id}` | Update endpoint |
| DELETE | `/admin/endpoints/{id}` | Delete endpoint + all data |
| GET | `/admin/endpoints/{id}/stats` | Get statistics |

### Endpoint SCIM (`/scim/endpoints/{endpointId}`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/endpoints/{id}/Users` | Create user |
| GET | `/endpoints/{id}/Users` | List users |
| GET | `/endpoints/{id}/Users/{userId}` | Get user |
| PUT | `/endpoints/{id}/Users/{userId}` | Replace user |
| PATCH | `/endpoints/{id}/Users/{userId}` | Update user |
| DELETE | `/endpoints/{id}/Users/{userId}` | Delete user |
| POST | `/endpoints/{id}/Groups` | Create group |
| GET | `/endpoints/{id}/Groups` | List groups |
| GET | `/endpoints/{id}/Groups/{groupId}` | Get group |
| PUT | `/endpoints/{id}/Groups/{groupId}` | Replace group |
| PATCH | `/endpoints/{id}/Groups/{groupId}` | Update group |
| DELETE | `/endpoints/{id}/Groups/{groupId}` | Delete group |
| GET | `/endpoints/{id}/Schemas` | Get schemas |
| GET | `/endpoints/{id}/ResourceTypes` | Get resource types |
| GET | `/endpoints/{id}/ServiceProviderConfig` | Get config |
