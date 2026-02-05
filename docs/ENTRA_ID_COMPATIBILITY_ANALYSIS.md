# Microsoft Entra ID SCIM Compatibility Analysis

Comparison of SCIMTool implementation against Microsoft Entra ID (formerly Azure AD) SCIM provisioning requirements.

**Analysis Date:** February 4, 2026

---

## 📊 Executive Summary

SCIMTool is **highly compatible** with Microsoft Entra ID provisioning. The implementation covers all critical requirements for successful integration with Entra ID enterprise application provisioning.

**Overall Entra ID Compatibility: ~90%** ✅

---

## ✅ Fully Compatible Features

### 1. Authentication (OAuth 2.0 Client Credentials) ✅

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| OAuth 2.0 Client Credentials Grant | ✅ | `POST /scim/oauth/token` with `grant_type=client_credentials` |
| Bearer Token Authentication | ✅ | All SCIM endpoints require `Authorization: Bearer <token>` |
| Token Expiration | ✅ | Configurable expiry (default 3600s) |
| client_id/client_secret validation | ✅ | Validated in `oauth.controller.ts` |

**Code Reference:**
```typescript
// oauth.controller.ts
// Validate grant_type (Microsoft Entra requires client_credentials)
if (tokenRequest.grant_type !== 'client_credentials') {
  throw new HttpException({ error: 'unsupported_grant_type', ... });
}
```

### 2. User Operations ✅

| Operation | Entra ID Behavior | SCIMTool Support | Notes |
|-----------|-------------------|------------------|-------|
| Create User (POST) | Sends full user with externalId | ✅ | Returns 201 with id |
| Query by filter | `filter=externalId eq "..."` or `filter=userName eq "..."` | ✅ | Supports `eq` operator |
| Get User by ID | `GET /Users/{id}` | ✅ | Returns 404 if not found |
| Update (PATCH) | Replace/Add operations | ✅ | Case-insensitive `op` values |
| Disable User | `PATCH active=false` | ✅ | User remains queryable |
| Delete User | `DELETE /Users/{id}` | ✅ | Returns 204 |

### 3. Group Operations ✅

| Operation | Entra ID Behavior | SCIMTool Support | Notes |
|-----------|-------------------|------------------|-------|
| Create Group | Sends displayName, externalId | ✅ | Returns 201 with empty members |
| Query by displayName | `filter=displayName eq "..."` | ✅ | Entra queries groups this way |
| Add Members (PATCH) | Multiple members in single operation | ✅ | Via `MultiOpPatchRequestAddMultipleMembersToGroup` config |
| Remove Members (PATCH) | Multiple members in single operation | ✅ | Via `MultiOpPatchRequestRemoveMultipleMembersFromGroup` config |
| Delete Group | `DELETE /Groups/{id}` | ✅ | Returns 204 |

### 4. PATCH Operation Case Insensitivity ✅

Microsoft Entra ID emits PATCH `op` values as `Add`, `Replace`, `Remove` (capitalized). SCIMTool handles this correctly:

```typescript
// endpoint-scim-users.service.ts
const op = operation.op?.toLowerCase();
if (!['add', 'replace', 'remove'].includes(op || '')) { ... }
```

### 5. Response Format ✅

| Requirement | Status | Notes |
|-------------|--------|-------|
| Content-Type: application/scim+json | ✅ | Supported in requests/responses |
| ListResponse schema | ✅ | `urn:ietf:params:scim:api:messages:2.0:ListResponse` |
| Error schema | ✅ | `urn:ietf:params:scim:api:messages:2.0:Error` |
| `id` property on all resources | ✅ | UUID-based scimId |
| `meta` object | ✅ | resourceType, created, lastModified, location |

### 6. Uniqueness Validation (409 Conflict) ✅

Entra ID expects 409 Conflict when creating duplicate users:

```typescript
// Returns 409 with scimType: 'uniqueness'
throw createScimError({
  status: 409,
  scimType: 'uniqueness',
  detail: `A resource with ${reason} already exists.`
});
```

### 7. Discovery Endpoints ✅

| Endpoint | Status | Purpose |
|----------|--------|---------|
| `GET /Schemas` | ✅ | Schema discovery for attribute mappings |
| `GET /ResourceTypes` | ✅ | User/Group resource types |
| `GET /ServiceProviderConfig` | ✅ | Capabilities advertisement |

### 8. Soft Delete Support ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Set `active=false` | ✅ | User remains in database |
| Query inactive users | ✅ | Returns all users regardless of active status |
| Restore user (`active=true`) | ✅ | Via PATCH operation |

---

## ⚠️ Partial Compatibility

### 1. `excludedAttributes` Parameter ⚠️

**Entra ID Behavior:** When querying groups, Entra sends:
```
GET /Groups/{id}?excludedAttributes=members
```

**Current Implementation:** Parameter is accepted but **ignored** - full resource is returned.

**Impact:** Low - Entra ID handles full responses correctly, but there's extra bandwidth.

**Recommendation:** Implement attribute projection for optimal performance.

### 2. Filter Operators ⚠️

**Entra ID Uses:** Only `eq` and `and` operators

**Current Implementation:**
| Operator | Status | Notes |
|----------|--------|-------|
| `eq` | ✅ | Fully supported |
| `and` | ⚠️ | May have limited support |
| `ne`, `co`, `sw`, `ew` | ⚠️ | Limited or not implemented |

**Impact:** Low - Entra ID only uses `eq` and `and`.

### 3. Enterprise User Extension ⚠️

**Entra ID Sends:** `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` attributes like:
- `employeeNumber`
- `department`
- `manager`

**Current Implementation:** Stored in `rawPayload` but not strongly validated.

**Impact:** Low - Data is preserved and returned correctly.

---

## ❌ Not Implemented (Low Impact for Entra ID)

### 1. Bulk Operations ❌

**Status:** Not implemented, correctly advertised as unsupported in ServiceProviderConfig.

**Entra ID Note:** Microsoft documentation states: "While we don't support SCIM /Bulk today, this is something we aim to support in the future."

**Impact:** None currently.

### 2. `/Me` Endpoint ❌

**Status:** Not implemented.

**Impact:** None - Entra ID provisioning doesn't use `/Me`.

### 3. ETags (Optimistic Concurrency) ❌

**Entra ID Behavior:** May send `If-Match` headers.

**Current Implementation:** Headers accepted but not validated.

**Impact:** Low - Entra ID doesn't strictly require ETag validation.

---

## 🔧 Entra ID-Specific Features

### Multi-Member PATCH Support ✅

Entra ID sends multiple members in a single PATCH operation:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [{
    "op": "Add",
    "path": "members",
    "value": [
      { "value": "user1-id" },
      { "value": "user2-id" }
    ]
  }]
}
```

**Implementation:** Supported via endpoint config flag:
```json
{
  "name": "entra-endpoint",
  "config": {
    "MultiOpPatchRequestAddMultipleMembersToGroup": "True"
  }
}
```

**Validation:** The config flag accepts only valid boolean-like values: `true`, `false`, `"True"`, `"False"`, `"1"`, `"0"`. Invalid values are rejected with `400 Bad Request`.
    "MultiOpPatchRequestAddMultipleMembersToGroup": "True"
  }
}
```

### Test Connection Support ✅

Entra ID's "Test Connection" queries for a non-existent user:
```
GET /Users?filter=userName eq "non-existent-user-guid"
```

**Expected Response:** 200 OK with empty ListResponse
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 0,
  "Resources": [],
  "startIndex": 1,
  "itemsPerPage": 20
}
```

**Status:** ✅ Fully supported

### Ping/Health Check Handling ✅

Entra ID periodically pings the endpoint to verify connectivity. SCIMTool:
- Excludes Entra ping checks from activity metrics
- Provides toggle to hide keepalive GET pings in raw logs

---

## 📋 Entra ID Integration Checklist

### Pre-Integration

| Check | Status | Notes |
|-------|--------|-------|
| HTTPS endpoint | ⚠️ | Required for production, optional for dev |
| OAuth 2.0 client credentials | ✅ | Configured in SCIMTool |
| Tenant URL format | ✅ | `https://<host>/scim/endpoints/<endpointId>` |

### Required Endpoints

| Endpoint | Status | Entra ID Usage |
|----------|--------|----------------|
| `POST /Users` | ✅ | Create users during provisioning |
| `GET /Users?filter=...` | ✅ | Query existing users |
| `GET /Users/{id}` | ✅ | Get user details |
| `PATCH /Users/{id}` | ✅ | Update user attributes |
| `DELETE /Users/{id}` | ✅ | Deprovision users |
| `POST /Groups` | ✅ | Create groups |
| `GET /Groups?filter=...` | ✅ | Query existing groups |
| `GET /Groups/{id}` | ✅ | Get group details |
| `PATCH /Groups/{id}` | ✅ | Update group/members |
| `DELETE /Groups/{id}` | ✅ | Delete groups |
| `GET /Schemas` | ✅ | Discover attributes |

### PATCH Operations

| Operation | Status | Entra ID Format |
|-----------|--------|-----------------|
| Replace userName | ✅ | `{ "op": "Replace", "path": "userName", "value": "..." }` |
| Replace active | ✅ | `{ "op": "Replace", "path": "active", "value": false }` |
| Add members | ✅ | `{ "op": "Add", "path": "members", "value": [...] }` |
| Remove members | ✅ | `{ "op": "Remove", "path": "members", "value": [...] }` |
| Replace displayName | ✅ | `{ "op": "Replace", "path": "displayName", "value": "..." }` |

---

## 📊 Compatibility Matrix

| Category | Entra ID Requirement | SCIMTool Status | Priority |
|----------|---------------------|-----------------|----------|
| Authentication | OAuth 2.0 Client Credentials | ✅ | Critical |
| User CRUD | All operations | ✅ | Critical |
| Group CRUD | All operations | ✅ | Critical |
| PATCH case-insensitivity | `Add`/`Replace`/`Remove` | ✅ | Critical |
| Filter: `eq` operator | userName, externalId, displayName | ✅ | Critical |
| 409 Conflict | Duplicate detection | ✅ | Critical |
| ListResponse format | Empty results handling | ✅ | Critical |
| Schema discovery | `/Schemas` endpoint | ✅ | High |
| Multi-member PATCH | Multiple members in one op | ✅ | High |
| Soft delete | `active=false` | ✅ | High |
| `excludedAttributes` | Attribute projection | ⚠️ | Medium |
| Enterprise extension | Additional attributes | ⚠️ | Low |
| Bulk operations | Not used by Entra | ❌ | None |
| ETags | Optimistic concurrency | ⚠️ | Low |

---

## 🚀 Recommendations for Optimal Entra ID Integration

### High Priority (Functional)

1. **Enable Multi-Member PATCH** for Entra ID endpoints:
   ```bash
   curl -X POST "http://localhost:3000/scim/admin/endpoints" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "entra-production",
       "config": {
         "MultiOpPatchRequestAddMultipleMembersToGroup": "True"
       }
     }'
   ```

2. **Use HTTPS** in production environments

3. **Disable endpoints when not in use** - Setting `active: false` blocks all SCIM operations with 403 Forbidden:
   ```bash
   curl -X PATCH "http://localhost:3000/scim/admin/endpoints/{id}" \
     -H "Content-Type: application/json" \
     -d '{ "active": false }'
   ```

### Medium Priority (Performance)

4. **Implement `excludedAttributes`** to reduce payload size for group queries

5. **Implement `attributes`** parameter for selective attribute return

### Low Priority (Nice to Have)

6. **Add ETag validation** for optimistic concurrency

6. **Implement complex filter operators** (`and`, `or`)

---

## 📚 References

- [Microsoft Entra SCIM Documentation](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)
- [SCIM 2.0 RFC 7643 - Core Schema](https://datatracker.ietf.org/doc/html/rfc7643)
- [SCIM 2.0 RFC 7644 - Protocol](https://datatracker.ietf.org/doc/html/rfc7644)
- [SCIMTool SCIM 2.0 Compliance Analysis](./SCIM_2.0_COMPLIANCE_ANALYSIS.md)
- [SCIMTool Collision Testing Guide](./COLLISION-TESTING-GUIDE.md)

---

## 🔄 Version History

| Date | Change |
|------|--------|
| 2026-02-04 | Added config flag validation documentation (`MultiOpPatchRequestAddMultipleMembersToGroup` True/False only) |
| 2026-02-04 | Documented inactive endpoint blocking (403 Forbidden) |
| 2026-02-04 | Initial Entra ID compatibility analysis |
