# SCIMTool — Technical Requirements Document (TRD)

> **Version**: 1.0  
> **Date**: February 9, 2026  
> **Status**: Living Document  
> **Standards**: RFC 7643 (Core Schema), RFC 7644 (Protocol), RFC 7642 (Concepts)

---

## 1. Purpose & Scope

SCIMTool is a **SCIM 2.0 provisioning visibility and monitoring tool** for Microsoft Entra ID (Azure AD). It provides a fully compliant SCIM 2.0 server that captures, stores, and visualizes provisioning events in real-time. The tool enables identity engineers to debug, test, and validate SCIM provisioning flows without a production target system.

### 1.1 Target Users

| User Type | Use Case |
|-----------|----------|
| Identity Engineers | Debug Entra provisioning configurations |
| IT Administrators | Validate SCIM attribute mappings and group memberships |
| Developers | Build and test SCIM client integrations |
| QA Teams | Reproduce and investigate provisioning issues |

### 1.2 System Boundaries

```
┌────────────────────┐     SCIM 2.0      ┌────────────────────┐
│ Microsoft Entra ID │ ────────────────── │     SCIMTool       │
│ (or any SCIM       │  POST/GET/PATCH/   │  ┌──────────────┐  │
│  client)           │  PUT/DELETE        │  │ SCIM Server  │  │
└────────────────────┘                    │  │ (NestJS API) │  │
                                          │  └──────┬───────┘  │
                                          │  ┌──────▼───────┐  │
                                          │  │ Web UI       │  │
                                          │  │ (React SPA)  │  │
                                          │  └──────────────┘  │
                                          └────────────────────┘
```

---

## 2. Functional Requirements

### 2.1 SCIM 2.0 Protocol Compliance (RFC 7644)

#### FR-2.1.1 Core HTTP Operations

| ID | Requirement | RFC Section | Priority |
|----|------------|-------------|----------|
| FR-001 | **POST** — Create a new User resource | §3.3 | **P0** |
| FR-002 | **POST** — Create a new Group resource | §3.3 | **P0** |
| FR-003 | **GET** — Retrieve a single User by `id` | §3.4.1 | **P0** |
| FR-004 | **GET** — Retrieve a single Group by `id` | §3.4.1 | **P0** |
| FR-005 | **GET** — List Users with pagination and filtering | §3.4.2 | **P0** |
| FR-006 | **GET** — List Groups with pagination and filtering | §3.4.2 | **P0** |
| FR-007 | **PUT** — Full replace of a User resource | §3.5.1 | **P0** |
| FR-008 | **PUT** — Full replace of a Group resource | §3.5.1 | **P0** |
| FR-009 | **PATCH** — Partial update of a User resource | §3.5.2 | **P0** |
| FR-010 | **PATCH** — Partial update of a Group resource | §3.5.2 | **P0** |
| FR-011 | **DELETE** — Remove a User resource | §3.6 | **P0** |
| FR-012 | **DELETE** — Remove a Group resource | §3.6 | **P0** |

#### FR-2.1.2 PATCH Operations (RFC 7644 §3.5.2)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-020 | Support `add` operation for all attribute types | **P0** |
| FR-021 | Support `replace` operation for all attribute types | **P0** |
| FR-022 | Support `remove` operation for all attribute types | **P0** |
| FR-023 | PATCH `op` values accepted case-insensitively (`Add`/`add`/`ADD`) | **P0** |
| FR-024 | PATCH with no `path` — value object merged into resource | **P0** |
| FR-025 | PATCH with simple path (`active`, `userName`, `displayName`) | **P0** |
| FR-026 | PATCH with valuePath filter (`emails[type eq "work"].value`) | **P0** |
| FR-027 | PATCH with extension URN path (`urn:...:enterprise:2.0:User:manager`) | **P0** |
| FR-028 | Multiple operations in a single PATCH request | **P0** |
| FR-029 | Return `200 OK` with full updated resource after PATCH | **P0** |
| FR-030 | Return `409 Conflict` for uniqueness violations during PATCH | **P0** |

#### FR-2.1.3 Filtering (RFC 7644 §3.4.2.2)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-040 | `eq` (equal) operator for string attributes | **P0** |
| FR-041 | Filter by `userName`, `externalId`, `id` for Users | **P0** |
| FR-042 | Filter by `displayName` for Groups | **P0** |
| FR-043 | Attribute names in filters are case-insensitive | **P0** |
| FR-044 | `co` (contains) operator | **P1** |
| FR-045 | `sw` (starts-with) operator | **P1** |
| FR-046 | `ne` (not-equal) operator | **P2** |
| FR-047 | `ew` (ends-with) operator | **P2** |
| FR-048 | `gt`, `ge`, `lt`, `le` comparison operators | **P2** |
| FR-049 | `and`, `or`, `not` logical operators (complex filters) | **P2** |
| FR-050 | `pr` (present/has value) operator | **P2** |

#### FR-2.1.4 Pagination (RFC 7644 §3.4.2.4)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-060 | `startIndex` parameter (1-based) | **P0** |
| FR-061 | `count` parameter with configurable max (200) | **P0** |
| FR-062 | Response includes `totalResults`, `startIndex`, `itemsPerPage` | **P0** |
| FR-063 | `Resources` array contains matching resources | **P0** |

#### FR-2.1.5 Attribute Projection (RFC 7644 §3.4.2.5)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-070 | `attributes` query parameter — return only specified attributes | **P1** |
| FR-071 | `excludedAttributes` query parameter — exclude specified attributes | **P1** |
| FR-072 | Default return: all attributes except those with `returned: never` | **P1** |

#### FR-2.1.6 Sorting (RFC 7644 §3.4.2.3)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-080 | `sortBy` parameter support | **P2** |
| FR-081 | `sortOrder` parameter (`ascending`/`descending`) | **P2** |
| FR-082 | ServiceProviderConfig advertises sorting capability accurately | **P0** |

#### FR-2.1.7 Bulk Operations (RFC 7644 §3.7) — Optional

| ID | Requirement | Priority |
|----|------------|----------|
| FR-090 | `POST /Bulk` endpoint for batch operations | **P3** |
| FR-091 | `failOnErrors` support | **P3** |

#### FR-2.1.8 ETag / Optimistic Concurrency (RFC 7644 §3.14)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-100 | `meta.version` populated with ETag on all resources | **P1** |
| FR-101 | `If-Match` header honored on PUT/PATCH/DELETE | **P1** |
| FR-102 | `If-None-Match` header honored on GET | **P2** |

### 2.2 SCIM 2.0 Schema Compliance (RFC 7643)

#### FR-2.2.1 User Resource (RFC 7643 §4.1)

| ID | Attribute | Type | Required | Mutability | caseExact | Priority |
|----|-----------|------|----------|------------|-----------|----------|
| FR-110 | `id` | String | Server-assigned | readOnly | true | **P0** |
| FR-111 | `externalId` | String | Optional | readWrite | true | **P0** |
| FR-112 | `userName` | String | Required | readWrite | false | **P0** |
| FR-113 | `name` | Complex | Optional | readWrite | — | **P0** |
| FR-114 | `displayName` | String | Optional | readWrite | false | **P0** |
| FR-115 | `emails` | Multi-valued | Optional | readWrite | — | **P0** |
| FR-116 | `active` | Boolean | Optional | readWrite | — | **P0** |
| FR-117 | `phoneNumbers` | Multi-valued | Optional | readWrite | — | **P1** |
| FR-118 | `addresses` | Multi-valued | Optional | readWrite | — | **P1** |
| FR-119 | `photos` | Multi-valued | Optional | readWrite | — | **P2** |
| FR-120 | `roles` | Multi-valued | Optional | readWrite | — | **P2** |
| FR-121 | `title`, `nickName`, `profileUrl`, `userType`, `preferredLanguage`, `locale`, `timezone` | String | Optional | readWrite | varies | **P1** |
| FR-122 | `meta` | Complex | Server-managed | readOnly | — | **P0** |

#### FR-2.2.2 Group Resource (RFC 7643 §4.2)

| ID | Attribute | Type | Required | Mutability | Priority |
|----|-----------|------|----------|------------|----------|
| FR-130 | `id` | String | Server-assigned | readOnly | **P0** |
| FR-131 | `displayName` | String | Required | readWrite | **P0** |
| FR-132 | `members` | Multi-valued | Optional | readWrite | **P0** |
| FR-133 | `members[].value` | String | Required per member | — | **P0** |
| FR-134 | `members[].display` | String | Optional | — | **P0** |
| FR-135 | `members[].$ref` | URI | Optional (recommended) | — | **P1** |
| FR-136 | `members[].type` | String | Optional (`User`/`Group`) | — | **P1** |
| FR-137 | `externalId` | String | Optional | readWrite | **P0** |
| FR-138 | `meta` | Complex | Server-managed | readOnly | **P0** |

#### FR-2.2.3 Enterprise User Extension (RFC 7643 §4.3)

| ID | Attribute | Type | Priority |
|----|-----------|------|----------|
| FR-140 | `employeeNumber` | String | **P1** |
| FR-141 | `costCenter` | String | **P1** |
| FR-142 | `organization` | String | **P1** |
| FR-143 | `division` | String | **P1** |
| FR-144 | `department` | String | **P1** |
| FR-145 | `manager` | Complex (`value`, `$ref`, `displayName`) | **P1** |

#### FR-2.2.4 Case-Insensitivity (RFC 7643 §2.1)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-150 | Attribute names are case-insensitive | **P0** |
| FR-151 | Schema URIs are case-insensitive | **P0** |
| FR-152 | `caseExact: false` values compared case-insensitively for uniqueness | **P0** |
| FR-153 | `caseExact: false` values compared case-insensitively for filtering | **P0** |
| FR-154 | Filter operators are case-insensitive (`eq` ≡ `EQ`) | **P0** |
| FR-155 | Extension URN paths resolved case-insensitively | **P0** |

### 2.3 Discovery Endpoints (RFC 7644 §4)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-160 | `GET /ServiceProviderConfig` — Advertise capabilities | **P0** |
| FR-161 | `GET /ResourceTypes` — List supported resource types | **P0** |
| FR-162 | `GET /Schemas` — Return full schema definitions | **P0** |

### 2.4 Error Handling (RFC 7644 §3.12)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-170 | Error responses use schema `urn:ietf:params:scim:api:messages:2.0:Error` | **P0** |
| FR-171 | Include `status`, `detail` in all error responses | **P0** |
| FR-172 | Include `scimType` where applicable (`uniqueness`, `noTarget`, `invalidFilter`, etc.) | **P0** |
| FR-173 | Return `400` for malformed requests | **P0** |
| FR-174 | Return `401` for unauthenticated requests | **P0** |
| FR-175 | Return `404` for non-existent resources | **P0** |
| FR-176 | Return `409` for uniqueness conflicts | **P0** |

### 2.5 Media Type (RFC 7644 §3.1)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-180 | Accept `application/scim+json` and `application/json` in requests | **P0** |
| FR-181 | Return `Content-Type: application/scim+json; charset=utf-8` in responses | **P0** |

---

## 3. Multi-Endpoint Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-200 | Support multiple isolated SCIM endpoints per deployment | **P0** |
| FR-201 | Each endpoint has a unique `name` and `id` | **P0** |
| FR-202 | SCIM resources (Users, Groups) scoped to their endpoint | **P0** |
| FR-203 | `userName` + `externalId` uniqueness enforced per-endpoint | **P0** |
| FR-204 | Cross-endpoint resource access prevented | **P0** |
| FR-205 | Per-endpoint configuration flags (multi-member PATCH behavior, etc.) | **P0** |
| FR-206 | Endpoint CRUD management API | **P0** |
| FR-207 | Cascade delete: endpoint deletion removes all associated Users, Groups, Logs | **P0** |

---

## 4. Microsoft Entra ID Compatibility Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-300 | OAuth 2.0 `client_credentials` grant for authentication | **P0** |
| FR-301 | Legacy bearer token authentication (shared secret) | **P0** |
| FR-302 | Handle PascalCase PATCH `op` values (`Add`, `Replace`, `Remove`) | **P0** |
| FR-303 | Support multi-member add in a single PATCH operation | **P0** |
| FR-304 | Support multi-member remove in a single PATCH operation | **P0** |
| FR-305 | Handle Entra's `filter=externalId eq "..."` query pattern | **P0** |
| FR-306 | Handle Entra's keepalive `GET /Users?filter=...&startIndex=1&count=1` probes | **P0** |
| FR-307 | Configurable behavior flags per endpoint for Entra-specific quirks | **P1** |

---

## 5. Monitoring & Observability Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-400 | Log all incoming SCIM requests (method, URL, headers, body) | **P0** |
| FR-401 | Log all SCIM responses (status, headers, body, duration) | **P0** |
| FR-402 | Human-readable activity feed — translate SCIM JSON into natural language | **P0** |
| FR-403 | Searchable/filterable log viewer | **P0** |
| FR-404 | Request/response detail drill-down | **P0** |
| FR-405 | Visual change alerts (favicon badge, tab notification) | **P1** |
| FR-406 | User browser — list users with derived identifiers and group memberships | **P1** |
| FR-407 | Group browser — list groups with member details | **P1** |
| FR-408 | Dashboard statistics (totals, 24h activity, active users) | **P1** |
| FR-409 | Keepalive request filtering (hide Entra probes from activity feed) | **P1** |

---

## 6. Authentication & Authorization Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-500 | OAuth 2.0 `client_credentials` token endpoint (`POST /oauth/token`) | **P0** |
| FR-501 | JWT token generation with configurable expiry | **P0** |
| FR-502 | Bearer token validation on all SCIM endpoints | **P0** |
| FR-503 | Legacy shared secret bearer token fallback | **P0** |
| FR-504 | Public routes exemption (OAuth token endpoint, static assets) | **P0** |
| FR-505 | `401` response with `WWW-Authenticate: Bearer realm="SCIM"` header | **P0** |

---

## 7. Data Persistence & Backup Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-600 | SQLite database for all SCIM resources and logs | **P0** |
| FR-601 | Automatic database migrations on startup | **P0** |
| FR-602 | Azure Blob Storage backup (periodic snapshots every 5 minutes) | **P0** |
| FR-603 | Blob snapshot restore on container startup | **P0** |
| FR-604 | Snapshot retention (keep last 20) | **P1** |
| FR-605 | Legacy Azure Files mount support | **P2** |
| FR-606 | Backup status API (`GET /admin/backup/status`) | **P1** |
| FR-607 | Manual backup trigger (`POST /admin/backup/trigger`) | **P1** |

---

## 8. Deployment & Infrastructure Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-700 | Docker containerized deployment | **P0** |
| FR-701 | Azure Container Apps hosting | **P0** |
| FR-702 | One-command deployment via PowerShell bootstrap script | **P0** |
| FR-703 | Zero-downtime updates via container image swap | **P1** |
| FR-704 | Scale-to-zero for cost optimization | **P1** |
| FR-705 | Environment variable configuration (no hardcoded secrets) | **P0** |
| FR-706 | Azure VNet integration for secure networking | **P2** |
| FR-707 | Private endpoint for Blob Storage access | **P2** |

---

## 9. Web Frontend Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-800 | React SPA served from same origin as API | **P0** |
| FR-801 | Dark/light theme toggle | **P1** |
| FR-802 | Real-time activity feed with auto-refresh | **P0** |
| FR-803 | Request log list with filtering and pagination | **P0** |
| FR-804 | Request detail view with formatted JSON | **P0** |
| FR-805 | Manual user/group provisioning form | **P1** |
| FR-806 | Database explorer (user/group browser) | **P1** |

---

## 10. Non-Functional Requirements

### 10.1 Performance

| ID | Requirement | Target |
|----|------------|--------|
| NFR-001 | SCIM API response time | < 200ms (P95) for single-resource operations |
| NFR-002 | List operations response time | < 500ms (P95) for up to 200 results |
| NFR-003 | Concurrent request handling | ≥ 50 simultaneous requests |

### 10.2 Reliability

| ID | Requirement | Target |
|----|------------|--------|
| NFR-010 | Data durability | Blob backup every 5 minutes |
| NFR-011 | Crash recovery | Auto-restore from latest snapshot on restart |
| NFR-012 | Container restart tolerance | Stateless API, ephemeral DB with blob-backed restore |

### 10.3 Security

| ID | Requirement | Target |
|----|------------|--------|
| NFR-020 | All SCIM endpoints require authentication | Bearer token or JWT |
| NFR-021 | No secrets in source code | Environment variables only |
| NFR-022 | CORS configured for cross-origin access | Configurable origin list |
| NFR-023 | Request body size limit | 5MB max |

### 10.4 Compatibility

| ID | Requirement | Target |
|----|------------|--------|
| NFR-030 | Microsoft Entra ID provisioning | Full compatibility |
| NFR-031 | Okta SCIM provisioning | Compatible |
| NFR-032 | OneLogin SCIM provisioning | Compatible |
| NFR-033 | Generic SCIM 2.0 clients | RFC 7643/7644 compliant |

---

## Appendix A — SCIM Error Codes Reference

| HTTP Status | scimType | When |
|-------------|----------|------|
| 400 | `invalidFilter` | Malformed filter expression |
| 400 | `invalidValue` | Invalid attribute value |
| 400 | `invalidPath` | Unsupported PATCH path |
| 400 | `invalidSyntax` | Malformed request body |
| 401 | — | Missing or invalid authentication |
| 404 | `noTarget` | Resource not found |
| 409 | `uniqueness` | Duplicate userName or externalId |
| 413 | `tooLarge` | Request exceeds size limit |
| 500 | — | Internal server error |

## Appendix B — Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0** | Must-have. Core SCIM functionality and Entra compatibility |
| **P1** | Should-have. Enhances compliance and usability |
| **P2** | Nice-to-have. Advanced SCIM features, less commonly used |
| **P3** | Future. Optional per spec or low demand |

---

*This document is the source of truth for all functional and non-functional requirements of SCIMTool.*
