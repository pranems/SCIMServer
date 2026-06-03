# Project Health & Stats

> **Version:** 0.40.0 - **Updated:** April 28, 2026 - **Status:** Production-ready

---

## Codebase Metrics

| Metric | Value |
|--------|-------|
| **Source files** (`api/src/**/*.ts`) | 127 |
| **Source LoC** | 29,837 |
| **Unit test files** (`api/src/**/*.spec.ts`) | 84 |
| **Unit test LoC** | 32,776 |
| **E2E test files** (`api/test/e2e/**/*.e2e-spec.ts`) | 54 |
| **E2E test LoC** | ~14,300 |
| **Documentation files** (`docs/**/*.md`) | ~125 (69 active + 56 archived) |
| **Scripts** (`scripts/*.ps1`) | 18 |
| **Total project files** | ~400+ |

## Test Health

| Layer | Suites | Tests | Skip | Status |
|-------|--------|-------|------|--------|
| **Unit** | 84 | 3,429 | 0 | ✅ All pass |
| **E2E** | 54 | 1,149 | 0 | ✅ All pass |
| **Live (main)** | 60 sections | ~817 | 0 | All pass |
| **Live (Lexmark ISV)** | 13 sections | 112 | 0 | All pass |
| **Total** | **~211** | **~5,507** | 0 | All pass |

### Unit Test Suites (84)

**Domain layer (11):** patch engines (6), schema validators (5)  
**Infrastructure (8):** repositories (inmemory 3, prisma 4, module 1)  
**Auth/OAuth (3):** auth guard, OAuth controller, OAuth service  
**Modules (60):** controllers, services, DTOs, filters, interceptors, endpoint-profile, discovery, logging, database, activity-parser, web

### E2E Test Suites (54)

`admin-api-coverage`, `admin-endpoint-api`, `admin-version`, `advanced-patch`, `api-response-contracts`, `api-response-contracts-2`, `attribute-projection`, `authentication`, `bulk-operations`, `config-flags`, `custom-resource-types`, `diagnostics-enrichment`, `discovery-endpoints`, `edge-cases`, `endpoint-isolation`, `endpoint-profile`, `endpoint-scoped-logs`, `error-handling`, `etag-conditional`, `filter-operators`, `generic-filter-operators`, `group-lifecycle`, `group-parity-gaps`, `http-error-codes`, `lexmark-isv`, `log-config`, `manager-patch-string-coercion`, `me-endpoint`, `multi-endpoint-isolation`, `p2-attribute-characteristics`, `p4-attribute-fixes`, `per-endpoint-credentials`, `primary-enforcement`, `profile-combinations`, `profile-flag-combos`, `rca-diagnostics`, `readonly-stripping`, `returned-characteristic`, `rfc-compliance`, `schema-cache-integration`, `schema-driven-uniqueness`, `schema-validation`, `scim-validator-compliance`, `search-endpoint`, `soft-delete-flags`, `sorting`, `test-gaps-audit`, `test-gaps-audit-2`, `test-gaps-audit-3`, `test-gaps-audit-4`, `test-gaps-audit-5`, `test-gaps-audit-6`, `user-lifecycle`, `user-uniqueness-required`

## Architecture Overview

```
NestJS Application (11 modules)
├── AppModule (root)
├── AuthModule - SharedSecret guard, 3-tier auth chain
├── OAuthModule - client_credentials grant, JWT issuance
├── EndpointModule - CRUD, profile management
├── ScimModule (★ main)
│   ├── Controllers (12): Users, Groups, Bulk, Discovery, Me, Admin, Credentials, Generic, Schemas, ResourceTypes, SPC
│   ├── Services (6): Users, Groups, Generic, Bulk, Metadata, Discovery
│   ├── Endpoint Profile (7): built-in-presets, types, service, auto-expand, rfc-baseline, tighten-only-validator
│   ├── Filters (3): filter parser, evaluator, exception filter
│   ├── Interceptors (2): ETag, Content-Type
│   └── DTOs (12): create/update/patch/search for Users, Groups, Bulk, ResourceTypes
├── LoggingModule - structured logging, per-endpoint levels
├── PrismaModule - Prisma 7 service
├── DatabaseModule - DB health, management
├── WebModule - React observability UI
├── ActivityParserModule - log parsing
└── HealthModule - /health endpoint
```

## Persistence Layer

| Model | Fields | Purpose |
|-------|--------|---------|
| **Endpoint** | 8 | Multi-tenant endpoint with JSONB profile |
| **ScimResource** | 14 | Polymorphic User/Group with JSONB payload |
| **ResourceMember** | 7 | Group membership junction table |
| **EndpointCredential** | 9 | Per-endpoint auth credentials |
| **RequestLog** | 13 | Structured HTTP request/response logs |

**Database:** PostgreSQL 17 with extensions: `citext`, `pgcrypto`, `pg_trgm`  
**Alternative:** In-memory storage for dev/test (`PERSISTENCE_BACKEND=inmemory`)

## Built-in Endpoint Presets (6)

| Preset | Schemas | RTs | Bulk | Sort | ETag | Target |
|--------|---------|-----|------|------|------|--------|
| `entra-id` ★ | 7 | 2 | ❌ | ❌ | ✅ | Microsoft Entra ID |
| `entra-id-minimal` | 7 | 2 | ❌ | ❌ | ✅ | Entra (minimal attrs) |
| `rfc-standard` | 3 | 2 | ✅ | ✅ | ✅ | Pure RFC testing |
| `minimal` | 2 | 2 | ❌ | ❌ | ❌ | Bare minimum |
| `user-only` | 2 | 1 | ❌ | ✅ | ✅ | User-only |
| `lexmark` / `user-only-with-custom-ext` | 3 | 1 | ❌ | ✅ | ❌ | Lexmark Cloud Print |

## Technology Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 24 | Runtime |
| NestJS | 11.1 | Framework |
| TypeScript | 5.9 | Language |
| Prisma | 7.4 | ORM |
| PostgreSQL | 17 | Database |
| Jest | 30.2 | Test runner |
| Supertest | 7.2 | HTTP testing |
| Docker | node:24-alpine | Container |
| React + Vite | - | Observability UI |
| Azure Container Apps | - | Cloud deployment |

## SCIM Compliance

| Feature | Status |
|---------|--------|
| User CRUD (POST/GET/PUT/PATCH/DELETE) | ✅ |
| Group CRUD + membership management | ✅ |
| SCIM filter operators (12 operators) | ✅ |
| Attribute projection (attributes/excludedAttributes) | ✅ |
| POST /.search (RFC 7644 §3.4.3) | ✅ |
| Bulk operations (RFC 7644 §3.7) | ✅ |
| /Me endpoint (RFC 7644 §3.11) | ✅ |
| ETag + If-Match/If-None-Match (RFC 7644 §3.14) | ✅ |
| Discovery: /Schemas, /ResourceTypes, /ServiceProviderConfig | ✅ |
| SCIM error format (RFC 7644 §3.12) | ✅ |
| Attribute characteristics (type, required, mutability, returned, uniqueness, caseExact) | ✅ |
| Extension schemas (EnterpriseUser, custom) | ✅ |
| Microsoft SCIM Validator (25/25 + 7 preview) | ✅ |
