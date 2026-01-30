# Multi-Endpoint SCIM Implementation Checklist

## Phase 1: Infrastructure ✅ COMPLETED

- [x] Update Prisma schema with Tenant model
- [x] Add endpointId foreign keys to ScimUser, ScimGroup, RequestLog
- [x] Create composite unique constraints per endpoint
- [x] Add cascade delete relationships
- [x] Create TenantModule with EndpointService
- [x] Create EndpointController with admin endpoints
- [x] Create EndpointContextStorage for request-scoped context
- [x] Create EndpointScimController for endpoint-specific SCIM endpoints
- [x] Update ScimModule to include new components
- [x] Update AppModule to import TenantModule
- [x] Create DTOs (CreateTenantDto, UpdateTenantDto)
- [x] Create documentation (MULTI_ENDPOINT_IMPLEMENTATION.md, MULTI_ENDPOINT_QUICK_START.md, MULTI_ENDPOINT_ARCHITECTURE.md)

## Phase 2: Service Layer Extensions ⏳ PENDING

### ScimUsersService - Add Tenant-Aware Methods

- [ ] `createUserForEndpoint(dto, baseUrl, endpointId)` 
  - Create new method that accepts endpointId
  - Add endpointId to Prisma create input
  - Filter unique constraint checks by endpointId
  - Return user with correct baseUrl

- [ ] `getUserForEndpoint(scimId, baseUrl, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Return user or throw 404

- [ ] `listUsersForEndpoint(params, baseUrl, endpointId)`
  - Query: `WHERE endpointId = ?` + filters
  - Apply filter, startIndex, count params
  - Return ScimListResponse with tenant users

- [ ] `replaceUserForEndpoint(scimId, dto, baseUrl, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Replace entire user resource
  - Update meta lastModified timestamp

- [ ] `patchUserForEndpoint(scimId, dto, baseUrl, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Apply SCIM patch operations (add, remove, replace)
  - Update meta lastModified timestamp

- [ ] `deleteUserForEndpoint(scimId, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Delete user (cascade removes from groups)

- [ ] `assertUniqueIdentifiersForEndpoint(userName, externalId, endpointId)`
  - Check userName: `WHERE userName = ? AND endpointId = ?`
  - Check externalId: `WHERE externalId = ? AND endpointId = ?`
  - Throw error if not unique within tenant

### ScimGroupsService - Add Tenant-Aware Methods

- [ ] `createGroupForEndpoint(dto, baseUrl, endpointId)`
  - Create new method that accepts endpointId
  - Add endpointId to Prisma create input
  - Validate members exist in tenant
  - Return group with correct baseUrl

- [ ] `getGroupForEndpoint(scimId, baseUrl, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Include members in response
  - Return group or throw 404

- [ ] `listGroupsForEndpoint(params, baseUrl, endpointId)`
  - Query: `WHERE endpointId = ?` + filters
  - Apply filter, startIndex, count params
  - Return ScimListResponse with tenant groups

- [ ] `replaceGroupForEndpoint(scimId, dto, baseUrl, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Replace entire group resource
  - Update members (validate all members exist in tenant)
  - Update meta lastModified timestamp

- [ ] `patchGroupForEndpoint(scimId, dto, baseUrl, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Apply SCIM patch operations on group members
  - Validate member endpointId before adding
  - Update meta lastModified timestamp

- [ ] `deleteGroupForEndpoint(scimId, endpointId)`
  - Query: `WHERE scimId = ? AND endpointId = ?`
  - Delete group (cascade removes members)

### ScimMetadataService - Review for Multi-Endpoint Compatibility

- [ ] Review `getSchemas()` method
  - Should return same schemas for all tenants (no changes needed)

- [ ] Review `getResourceTypes()` method
  - Should return same resource types for all tenants (no changes needed)

- [ ] Review `getServiceProviderConfig()` method
  - Consider if endpointId-specific config is needed
  - May need to read tenant config from EndpointContextStorage

## Phase 3: Database Migration ⏳ PENDING

- [ ] Run Prisma migration
  ```bash
  npx prisma migrate dev --name add_multi_tenant_support
  ```

- [ ] Verify schema changes
  ```bash
  npx prisma db push
  ```

- [ ] Test Prisma client generation
  ```bash
  npx prisma generate
  ```

## Phase 4: Testing ⏳ PENDING

### Unit Tests

- [ ] EndpointService tests
  - [ ] createTenant() - valid input
  - [ ] createTenant() - duplicate name error
  - [ ] createTenant() - invalid name characters error
  - [ ] getTenant() - found
  - [ ] getTenant() - not found error
  - [ ] getTenantByName() - found
  - [ ] getTenantByName() - not found error
  - [ ] listTenants() - all
  - [ ] listTenants() - filtered by active
  - [ ] updateTenant() - successful
  - [ ] updateTenant() - not found error
  - [ ] deleteTenant() - successful with cascade
  - [ ] deleteTenant() - not found error
  - [ ] getTenantStats() - returns counts

- [ ] EndpointScimController tests
  - [ ] Validates tenant exists before operations
  - [ ] Sets TenantContext correctly
  - [ ] Routes to correct service methods
  - [ ] Returns 404 for non-existent tenant

- [ ] ScimUsersService tenant-aware tests
  - [ ] createUserForEndpoint() with correct endpointId
  - [ ] getUserForEndpoint() isolates by endpointId
  - [ ] listUsersForEndpoint() returns only tenant users
  - [ ] replaceUserForEndpoint() updates correct tenant user
  - [ ] patchUserForEndpoint() patches correct tenant user
  - [ ] deleteUserForEndpoint() deletes correct tenant user
  - [ ] assertUniqueIdentifiersForEndpoint() allows same userName across tenants

- [ ] ScimGroupsService tenant-aware tests
  - [ ] createGroupForEndpoint() with correct endpointId
  - [ ] getGroupForEndpoint() isolates by endpointId
  - [ ] listGroupsForEndpoint() returns only tenant groups
  - [ ] replaceGroupForEndpoint() updates correct tenant group
  - [ ] patchGroupForEndpoint() patches correct tenant group
  - [ ] deleteGroupForEndpoint() deletes correct tenant group
  - [ ] Group member operations validate endpointId

### Integration Tests

- [ ] Full tenant lifecycle
  - [ ] Create tenant
  - [ ] Create user in tenant
  - [ ] Create group in tenant
  - [ ] Add user to group
  - [ ] Update user in tenant
  - [ ] Update group in tenant
  - [ ] Delete user from group
  - [ ] Delete group
  - [ ] Delete user
  - [ ] Delete tenant

- [ ] Multi-Endpoint isolation
  - [ ] Create two tenants with same userNames
  - [ ] Create same user in both tenants
  - [ ] Verify data isolation in queries
  - [ ] Update user in tenant A
  - [ ] Verify user in tenant B unchanged
  - [ ] Delete user from tenant A
  - [ ] Verify user in tenant B still exists

- [ ] Cascade delete
  - [ ] Create tenant with users, groups, memberships
  - [ ] Delete tenant
  - [ ] Verify all users deleted
  - [ ] Verify all groups deleted
  - [ ] Verify all group members deleted
  - [ ] Verify all logs deleted

### E2E Tests

- [ ] Create tenant via API
- [ ] Get tenant by ID
- [ ] Get tenant by name
- [ ] List tenants
- [ ] Update endpoint configuration
- [ ] Create user in tenant
- [ ] Get user from tenant
- [ ] List users in tenant
- [ ] Update user in tenant
- [ ] Delete user from tenant
- [ ] Create group in tenant
- [ ] Add user to group
- [ ] Get group from tenant
- [ ] Update group in tenant
- [ ] Remove user from group
- [ ] Delete group from tenant
- [ ] Delete tenant and verify cascade
- [ ] Get schemas for tenant
- [ ] Get resource types for tenant
- [ ] Get service provider config for tenant

## Phase 5: Validation & Security ⏳ PENDING

- [ ] Tenant name validation
  - [ ] Only alphanumeric, hyphens, underscores allowed
  - [ ] No SQL injection possible
  - [ ] No path traversal possible

- [ ] endpointId validation
  - [ ] Format is valid CUID
  - [ ] Tenant exists before operations
  - [ ] 404 for non-existent tenants

- [ ] Data isolation verification
  - [ ] No leakage between tenants
  - [ ] Composite unique constraints work
  - [ ] Cascade deletes don't affect other tenants

- [ ] Request context isolation
  - [ ] AsyncLocalStorage not shared between requests
  - [ ] Context properly set for each request
  - [ ] Context properly cleared after request

- [ ] Authentication/Authorization
  - [ ] Consider if API key per endpoint needed
  - [ ] Consider if Multi-Endpoint token validation needed
  - [ ] Document security model

## Phase 6: Documentation Updates ⏳ PENDING

- [ ] Update README.md with Multi-Endpoint example
- [ ] Update API_REFERENCE.md with new endpoints
- [ ] Update DEPLOYMENT.md if needed
- [ ] Create MULTI_TENANT_SETUP.md for operators
- [ ] Create MULTI_TENANT_MIGRATION.md for existing users
- [ ] Add comments to code for clarity
- [ ] Generate API documentation

## Phase 7: Performance & Optimization ⏳ PENDING

- [ ] Add database indexes
  - [ ] Index on ScimUser.endpointId
  - [ ] Index on ScimGroup.endpointId
  - [ ] Index on RequestLog.endpointId
  - [ ] Composite indexes on (endpointId, scimId)

- [ ] Performance testing
  - [ ] Load test with multiple tenants
  - [ ] Verify query performance with indexes
  - [ ] Monitor memory usage

- [ ] Connection pooling
  - [ ] Verify SQLite connection pool settings
  - [ ] Consider migration to PostgreSQL for production

## Phase 8: Deployment & Release ⏳ PENDING

- [ ] Update package version
- [ ] Create migration guide for existing users
- [ ] Test in staging environment
- [ ] Update Docker build/deployment scripts
- [ ] Create release notes
- [ ] Tag release in Git
- [ ] Deploy to production

## Estimated Timeline

| Phase | Estimated Days | Status |
|-------|-----------------|--------|
| Infrastructure | 1 | ✅ Complete |
| Service Layer | 3-4 | ⏳ Pending |
| Migration | 0.5 | ⏳ Pending |
| Testing | 3-4 | ⏳ Pending |
| Validation | 1-2 | ⏳ Pending |
| Documentation | 1 | ⏳ Pending |
| Performance | 2 | ⏳ Pending |
| Deployment | 0.5-1 | ⏳ Pending |
| **Total** | **12-15 days** | |

## Next Immediate Action Items

1. **Review tenant-aware service methods** above
2. **Implement Phase 2 methods** in ScimUsersService and ScimGroupsService
3. **Run database migration** (`prisma migrate dev`)
4. **Write and run unit tests** for new methods
5. **Write and run integration tests** for Multi-Endpoint scenarios
6. **Validate data isolation** in real scenarios
7. **Update documentation** with examples

## Notes

- All infrastructure files are ready for Phase 2 implementation
- Services need to add `ForEndpoint` variants of existing methods
- Database schema is designed for performance with proper indexes
- Request context isolation prevents data leakage in concurrent scenarios
- Cascade delete ensures clean tenant removal


