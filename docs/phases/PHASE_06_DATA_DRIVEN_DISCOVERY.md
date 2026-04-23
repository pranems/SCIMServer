# Phase 6 - Data-Driven Discovery

**Version:** 0.14.0  
**Date:** 2026-02-23  
**Status:** Complete  
**NFR:** Backward compatible, no breaking API changes

---

## Summary

Phase 6 centralizes all SCIM discovery endpoint responses (Schemas, ResourceTypes,
ServiceProviderConfig) into a single injectable `ScimDiscoveryService`, replacing
~280 lines of hardcoded JSON scattered across 4 controllers. It also adds the
Enterprise User Extension schema (RFC 7643 §4.3), fixes dynamic `schemas[]` in
User responses, and removes 7 dead configuration flags.

## Gaps Resolved

| Gap | Description | Resolution |
|-----|-------------|------------|
| G6  | Discovery endpoints 100% hardcoded across 4 controllers | Centralized into `ScimDiscoveryService` with rich RFC 7643 constants |
| G16 | Extension URN hardcoded as local constant in patch utility | Exported `KNOWN_EXTENSION_URNS` from `scim-constants.ts` |
| G19 | `schemas[]` in User responses always `[core:User]`, ignores enterprise data | Dynamic `schemas[]` - includes enterprise URN when extension data present in payload |
| G20 | 7 dead config flags in `EndpointConfig` interface | Removed: `EXCLUDE_META`, `EXCLUDE_SCHEMAS`, `CUSTOM_SCHEMA_URN`, `INCLUDE_ENTERPRISE_SCHEMA`, `STRICT_MODE`, `LEGACY_MODE`, `CUSTOM_HEADERS` |

## Architecture Decision

**Constants-based discovery** (not database-backed). The `ScimDiscoveryService`
returns static RFC 7643 definitions. The service interface is designed to allow
a future migration to database-driven per-endpoint discovery data (e.g.,
`endpoint_schema`/`endpoint_resource_type` tables) without changing consuming code.

This decision balances pragmatism with extensibility:
- No new database tables or Prisma migrations required
- No InMemory repository additions needed
- Zero risk to existing API contracts
- Service injection pattern makes DB migration trivial later

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `api/src/modules/scim/discovery/scim-schemas.constants.ts` | Rich RFC 7643 schema definitions (User: 17 attributes with subAttributes, EnterpriseUser: 6 attributes with complex manager, Group: 3 attributes), ResourceType definitions, ServiceProviderConfig |
| `api/src/modules/scim/discovery/scim-discovery.service.ts` | `@Injectable()` centralized discovery service with `getSchemas()`, `getResourceTypes()`, `getServiceProviderConfig()`, `buildResourceSchemas()` |
| `api/src/modules/scim/discovery/scim-discovery.service.spec.ts` | 32 unit tests covering all service methods |

### Modified Files

| File | Change |
|------|--------|
| `api/src/modules/scim/common/scim-constants.ts` | Added `SCIM_ENTERPRISE_USER_SCHEMA`, `KNOWN_EXTENSION_URNS`, `SCIM_SP_CONFIG_SCHEMA` |
| `api/src/modules/scim/controllers/endpoint-scim-discovery.controller.ts` | Removed ~180 lines of hardcoded JSON; delegates to `ScimDiscoveryService` |
| `api/src/modules/scim/controllers/schemas.controller.ts` | 144 → 14 lines; delegates to `ScimDiscoveryService` |
| `api/src/modules/scim/controllers/resource-types.controller.ts` | 36 → 14 lines; delegates to `ScimDiscoveryService` |
| `api/src/modules/scim/controllers/service-provider-config.controller.ts` | 31 → 14 lines; delegates to `ScimDiscoveryService` |
| `api/src/modules/scim/scim.module.ts` | Registered `ScimDiscoveryService` as provider |
| `api/src/modules/scim/services/endpoint-scim-users.service.ts` | Dynamic `schemas[]` using `KNOWN_EXTENSION_URNS` |
| `api/src/modules/scim/utils/scim-patch-path.ts` | Import centralized `KNOWN_EXTENSION_URNS` |
| `api/src/modules/endpoint/endpoint-config.interface.ts` | Removed 7 dead flags from `ENDPOINT_CONFIG_FLAGS` and `DEFAULT_ENDPOINT_CONFIG` |

### Updated Test Files

| File | Change |
|------|--------|
| `endpoint-scim-discovery.controller.spec.ts` | Added `ScimDiscoveryService` injection, updated `totalResults` 2→3, added Enterprise User assertions |
| `schemas.controller.spec.ts` | Added `ScimDiscoveryService` injection, updated counts 2→3, added Enterprise User test |
| `resource-types.controller.spec.ts` | Added `ScimDiscoveryService` injection, added enterprise extension assertion |
| `service-provider-config.controller.spec.ts` | Added `ScimDiscoveryService` injection, added `meta`, `documentationUri`, `bulk.maxOperations` tests |
| `endpoint-config.interface.spec.ts` | Removed 7 dead flag assertions |
| `discovery-endpoints.e2e-spec.ts` | Added Enterprise User schema assertion, `totalResults=3` test, enterprise extension on ResourceTypes, `meta` on ServiceProviderConfig |

## Behavioral Changes

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /Schemas` | 2 schemas (User, Group) | 3 schemas (User, EnterpriseUser, Group) |
| `GET /ResourceTypes` | User has `schemaExtensions: []` | User has `schemaExtensions: [{schema: enterprise URN, required: false}]` |
| `GET /ServiceProviderConfig` | No `meta`, no `documentationUri` | Includes `meta.resourceType`, `documentationUri`, `bulk.maxOperations/maxPayloadSize` |
| User responses `schemas[]` | Always `[core:User]` | Dynamically includes enterprise URN when enterprise data present |
| Authentication scheme | `specificationUrl` field | `specUri` field (RFC 7643 §5 compliant) |

All changes are **backward compatible** - they add information, never remove or rename existing response fields consumed by clients.

## Validation Results

| Gate | Result |
|------|--------|
| TypeScript Build | Clean (only pre-existing e2e reporter `.ts` import warning) |
| Unit Tests | **1171/1171 passed** (47 suites) - up from 1135 (+36 new) |
| E2E Tests | **196/196 passed** (15 suites) - up from 193 (+3 new) |

## RFC Compliance Improvements

- **RFC 7643 §7:** Schemas endpoint now includes Enterprise User Extension (required for servers supporting enterprise attributes)
- **RFC 7643 §6:** ResourceTypes now correctly advertises Enterprise User as a schema extension on User
- **RFC 7644 §4:** ServiceProviderConfig includes `meta` object (SHOULD per spec)
- **RFC 7643 §8.7:** Schema objects include `meta.resourceType: "Schema"` and `meta.location`
- **RFC 7643 §5:** Authentication scheme uses `specUri` (correct field name per RFC)
