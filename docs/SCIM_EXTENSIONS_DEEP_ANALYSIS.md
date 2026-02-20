# SCIM Extensions Deep Analysis — Top 3 Recommendations

> **⚠️ SUPERSEDED** — This v2 document (Feb 17) has been superseded by the v3 architecture docs (Feb 20, 2026). The three recommendations here (fix discovery, extension registry, filter push-down) are now covered in the 12-phase Migration Plan. **Retained for**: Three-Pillar RFC framework, per-endpoint isolation 4-layer audit (§2A), ServiceProviderConfig RFC compliance gaps (§2B), dead config flag inventory (§2C — 7 of 12 flags are dead code), and `schemas[]` array bug finding (§2.5).
> **See**: [`IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md`](IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md) · [`MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md`](MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md)

> **Date**: February 17, 2026 (v2)  
> **Scope**: Holistic RFC-grounded analysis of enterprise & custom extension support, per-endpoint isolation, and discovery compliance  
> **Stack**: NestJS 11 · TypeScript 5 · Prisma 7 · Node.js ≥ 24  
> **Method**: Full codebase audit against RFC 7642/7643/7644 with architectural recommendations  
> **Design Philosophy**: Three-Pillar RFC framework (see §1A)

---

## Table of Contents

1A. [Design Philosophy — The Three RFC Pillars](#1a-design-philosophy--the-three-rfc-pillars)  
1B. [Executive Summary](#1b-executive-summary)  
2. [Current Architecture — What We Found](#2-current-architecture--what-we-found)  
2A. [Per-Endpoint Isolation Audit](#2a-per-endpoint-isolation-audit)  
2B. [ServiceProviderConfig Audit](#2b-serviceproviderconfig-audit)  
2C. [Endpoint Config Flags — Live vs Dead](#2c-endpoint-config-flags--live-vs-dead)  
3. [Recommendation #1 — Fix the `schemas` Array & All Discovery Endpoints](#3-recommendation-1--fix-the-schemas-array--all-discovery-endpoints)  
4. [Recommendation #2 — Build a Pluggable Extension Registry](#4-recommendation-2--build-a-pluggable-extension-registry)  
5. [Recommendation #3 — Enterprise Extension Filter Push-Down](#5-recommendation-3--enterprise-extension-filter-push-down)  
6. [Implementation Priority Matrix](#6-implementation-priority-matrix)  
7. [References](#7-references)

---

## 1A. Design Philosophy — The Three RFC Pillars

Every recommendation in this document is grounded in these three RFCs and the design principles they imply.

### The Three Pillars

| RFC | Title | What It Tells Us |
|-----|-------|------------------|
| **RFC 7642** | Definitions, Overview, Concepts, Requirements | Multi-tenancy use cases, actor model (CSP, ECS, CSU), push/pull flows, lifecycle scenarios |
| **RFC 7643** | Core Schema | Resource types, attribute characteristics (mutability, returned, uniqueness, caseExact), schema URIs, extension model, canonical type definitions |
| **RFC 7644** | Protocol | HTTP verbs, filtering, sorting, pagination, PATCH semantics, bulk ops, ETags, error codes, discovery endpoints, content-type rules |

### Seven Core Design Principles (Derived from RFCs)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DESIGN PRINCIPLES vs CURRENT CODEBASE                                      │
├───┬──────────────────────────────────────────────────┬─────────┬───────────┤
│ # │ Principle                                        │ RFC     │ Current   │
├───┼──────────────────────────────────────────────────┼─────────┼───────────┤
│ 1 │ Schema is the Source of Truth — behavior          │ §7      │ ⚠️ PARTIAL│
│   │ (mutability, returnability, filtering, case       │ RFC7643 │ Hardcoded │
│   │ sensitivity) derived from schema definitions,     │         │ per-attr  │
│   │ not hardcoded per-attribute.                      │         │           │
├───┼──────────────────────────────────────────────────┼─────────┼───────────┤
│ 2 │ Resource Types are Pluggable — server should      │ §3.2    │ ❌ NO     │
│   │ not be "User + Group only"; resource types        │ RFC7643 │ Hardcoded │
│   │ should be registrations that can be added,        │         │ User+Group│
│   │ removed, or customized per tenant.                │         │           │
├───┼──────────────────────────────────────────────────┼─────────┼───────────┤
│ 3 │ Discovery Drives the Contract — /SPC,             │ §4      │ ❌ NO     │
│   │ /Schemas, /ResourceTypes must be per-tenant,      │ RFC7644 │ Static    │
│   │ truthful, and generated from actual server        │         │ hardcoded │
│   │ capabilities — never hardcoded.                   │         │ identical │
├───┼──────────────────────────────────────────────────┼─────────┼───────────┤
│ 4 │ Multi-Tenancy is URL-Based — URL prefix           │ §6      │ ✅ YES    │
│   │ (/{tenantId}/Users) is the most standard and      │ RFC7644 │ endpoints/│
│   │ discoverable approach.                            │         │ :endpointId│
├───┼──────────────────────────────────────────────────┼─────────┼───────────┤
│ 5 │ Attribute Characteristics are Not Optional —       │ §2.2    │ ⚠️ PARTIAL│
│   │ mutability, returned, uniqueness, caseExact,      │ RFC7643 │ Some attrs│
│   │ required from RFC 7643 must govern CRUD behavior. │         │ honored   │
├───┼──────────────────────────────────────────────────┼─────────┼───────────┤
│ 6 │ Errors are Structured — RFC 7644 §3.12 mandates   │ §3.12   │ ✅ YES    │
│   │ JSON error responses with schemas, status,        │ RFC7644 │ ScimError │
│   │ scimType, and detail.                             │         │ class     │
├───┼──────────────────────────────────────────────────┼─────────┼───────────┤
│ 7 │ Simplicity Through Generalization — generic        │ all     │ ❌ NO     │
│   │ engine that processes any resource type through    │         │ Separate  │
│   │ schema-driven rules is simpler than per-resource  │         │ User/Group│
│   │ hardcoded logic.                                  │         │ services  │
└───┴──────────────────────────────────────────────────┴─────────┴───────────┘
```

### How Each Recommendation Maps to Principles

```
  Principle 1  ──►  Rec #2 (Extension Registry — schema as source of truth)
  Principle 2  ──►  Rec #2 (Pluggable resource types via registry)
  Principle 3  ──►  Rec #1 (Fix all 3 discovery endpoints + SPC)
  Principle 4  ──►  §2A audit (per-endpoint isolation — already strong)
  Principle 5  ──►  Rec #2 (attribute characteristics in registry defs)
  Principle 6  ──►  Already implemented (ScimError class)
  Principle 7  ──►  Rec #2 (generic extension engine, future ResourceType engine)
```

---

## 1B. Executive Summary

After auditing every layer of the SCIMServer codebase against all three SCIM RFCs (7642/7643/7644) and testing against the seven design principles above, we identified **three high-impact gaps** that affect RFC compliance, client interoperability, and extensibility.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TOP 3 RECOMMENDATIONS                             │
├──────┬──────────────────────────────────────┬───────────┬───────────┤
│  #   │  Recommendation                      │ RFC Impact│ Effort    │
├──────┼──────────────────────────────────────┼───────────┼───────────┤
│  1   │  Fix schemas[] array & /Schemas &    │ CRITICAL  │ Medium    │
│      │  /ResourceTypes discovery endpoints  │ §3.1 §4   │ (~2 days) │
├──────┼──────────────────────────────────────┼───────────┼───────────┤
│  2   │  Build pluggable Extension Registry  │ HIGH      │ Medium    │
│      │  to replace hardcoded KNOWN_URNS     │ §3.3 §8.7 │ (~3 days) │
├──────┼──────────────────────────────────────┼───────────┼───────────┤
│  3   │  Enterprise extension filter         │ MODERATE  │ Small     │
│      │  push-down for department, manager   │ §3.4.2    │ (~1 day)  │
└──────┴──────────────────────────────────────┴───────────┴───────────┘
```

**The good news**: The rawPayload JSON-blob storage pattern already preserves and returns extension data correctly. The PATCH path utilities already handle `urn:`-prefixed paths for add/replace/remove. Per-endpoint isolation at the DB layer (composite unique constraints, FK cascades) and routing layer (`AsyncLocalStorage` context) is solid. These are strong foundations to build on.

**The problem**: The metadata layer is disconnected from the config layer — discovery endpoints (including ServiceProviderConfig) are hardcoded and identical across all endpoints, schemas arrays never include extension URNs, and 7 of 12 endpoint config flags are dead code. The server tells clients one story while behaving differently.

> **Design Principle #3 violated**: "Discovery Drives the Contract" — /ServiceProviderConfig, /Schemas, /ResourceTypes must be per-tenant, truthful, and generated from actual server capabilities — never hardcoded.

---

## 2. Current Architecture — What We Found

### 2.1 Data Flow — How Extensions Traverse the System Today

```
                        ┌─────────────────────────────────────────────────────┐
                        │                 CLIENT REQUEST                       │
                        │  POST /scim/endpoint-1/Users                        │
                        │  {                                                  │
                        │    "schemas": ["...core:User", "...enterprise:User"]│
                        │    "userName": "bjensen",                           │
                        │    "urn:...:enterprise:2.0:User": {                 │
                        │      "department": "Engineering"                    │
                        │    }                                                │
                        │  }                                                  │
                        └──────────────────┬──────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EndpointScimUsersController                                                │
│  POST /:endpointId/Users                                                    │
│                                                                             │
│  DTO: CreateScimUserDto { userName, externalId, active, [key: string]: any }│
│  Validated via class-validator, then passed to service                       │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EndpointScimUsersService.create()                                          │
│                                                                             │
│  1. extractAdditionalAttributes(dto)                                        │
│     Strips: schemas, userName, externalId, active, id, meta                 │
│     Keeps: name, emails, urn:...:enterprise:2.0:User, everything else       │
│     Result → sanitizedPayload                                               │
│                                                                             │
│  2. Prisma create:                                                          │
│     ┌────────────────────────────────────────────────────────────┐          │
│     │  ScimUser table                                            │          │
│     │  ┌──────────────┬─────────────────────────────────────┐    │          │
│     │  │ userName     │ "bjensen"                           │    │          │
│     │  │ active       │ true                                │    │          │
│     │  │ rawPayload   │ '{"name":{...},                     │    │          │
│     │  │              │   "urn:..enterprise:2.0:User":{     │    │          │
│     │  │              │     "department":"Engineering"       │    │          │
│     │  │              │   }}'                                │    │          │
│     │  │ meta         │ '{"resourceType":"User",...}'        │    │          │
│     │  └──────────────┴─────────────────────────────────────┘    │          │
│     └────────────────────────────────────────────────────────────┘          │
│                                                                             │
│  3. toScimUserResource(user, baseUrl)                                       │
│     return {                                                                │
│       schemas: [SCIM_CORE_USER_SCHEMA],  ← ⚠️ ALWAYS just core schema     │
│       id, userName, externalId, active,                                     │
│       ...rawPayload,                      ← ✅ extension data IS included  │
│       meta                                                                  │
│     }                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  RESPONSE (what the client actually receives)                               │
│                                                                             │
│  {                                                                          │
│    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],              │
│                 ▲                                                           │
│                 │ ❌ MISSING: "urn:...:enterprise:2.0:User"                │
│                                                                             │
│    "userName": "bjensen",                                                   │
│    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {         │
│      "department": "Engineering"    ← ✅ data IS present                   │
│    },                                                                       │
│    "meta": { ... }                                                          │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Current Discovery Endpoints — What Clients See

```
Client                              SCIMServer
  │                                     │
  │  GET /scim/Schemas                  │
  │────────────────────────────────────►│
  │                                     │
  │  200 OK                             │
  │  { Resources: [                     │
  │      { id: "...core:2.0:User",      │
  │        attributes: [userName,       │
  │        displayName, active, emails] │ ← ❌ Only 4 attrs
  │      },                             │     Missing: name, title,
  │      { id: "...core:2.0:Group" }    │     phoneNumbers, etc.
  │  ] }                                │
  │◄────────────────────────────────────│
  │                                     │ ← ❌ No Enterprise User
  │                                     │     schema definition at all
  │  GET /scim/ResourceTypes            │
  │────────────────────────────────────►│
  │                                     │
  │  200 OK                             │
  │  { Resources: [                     │
  │      { id: "User",                  │
  │        schemaExtensions: [] },      │ ← ❌ Empty array
  │      { id: "Group",                 │     Should declare enterprise
  │        schemaExtensions: [] }       │
  │  ] }                                │
  │◄────────────────────────────────────│
```

### 2.3 Current PATCH Path Handling

```
┌───────────────────────────────────────────────────────────────┐
│  scim-patch-path.ts — Extension Path Resolution               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  KNOWN_EXTENSION_URNS = [                                     │
│    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User│
│  ]                                                            │
│  ▲                                                            │
│  │ ❌ Hardcoded array — cannot add custom extensions          │
│  │    without code change                                     │
│                                                               │
│  isExtensionPath("urn:...:enterprise:2.0:User:department")    │
│    → true  ✅                                                 │
│                                                               │
│  isExtensionPath("urn:myorg:custom:2.0:User:buildingCode")   │
│    → false ❌ (not in KNOWN_EXTENSION_URNS)                   │
│                                                               │
│  parseExtensionPath("urn:...:enterprise:2.0:User:department") │
│    → { schemaUrn: "urn:...", attributePath: "department" } ✅ │
│                                                               │
│  applyExtensionUpdate(rawPayload, parsed, "Marketing")        │
│    → rawPayload["urn:..."]["department"] = "Marketing" ✅     │
│                                                               │
│  Special cases handled:                                       │
│    • Empty/null values → attribute removed (RFC 7644 §3.5.2.3)│
│    • manager as string → auto-wrapped to { value: string }    │
└───────────────────────────────────────────────────────────────┘
```

### 2.4 Current Filter Handling

```
┌───────────────────────────────────────────────────────────────┐
│  apply-scim-filter.ts — DB Push-Down vs In-Memory             │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  DB Push-Down (fast, indexed):                                │
│  ┌──────────────────────────────────────────────┐             │
│  │  Users:  userName (eq), externalId (eq), id  │             │
│  │  Groups: displayName (eq), externalId (eq), id│            │
│  └──────────────────────────────────────────────┘             │
│                                                               │
│  In-Memory Fallback (full table scan + JSON parse):           │
│  ┌──────────────────────────────────────────────┐             │
│  │  ALL other attributes including:              │             │
│  │  • name.givenName, name.familyName            │             │
│  │  • emails[type eq "work"].value               │             │
│  │  • urn:..enterprise:2.0:User:department   ⚠️ │             │
│  │  • urn:..enterprise:2.0:User:manager.value ⚠️│             │
│  │  • Any co, sw, gt, lt operators              │             │
│  └──────────────────────────────────────────────┘             │
│                                                               │
│  Impact: Filtering by department or employeeNumber            │
│  requires loading ALL users for the endpoint,                 │
│  parsing every rawPayload JSON, then filtering in JS.         │
│  At scale (>1000 users), this becomes a bottleneck.           │
└───────────────────────────────────────────────────────────────┘
```

### 2.5 Dead Code — The `INCLUDE_ENTERPRISE_SCHEMA` Flag

```
┌─────────────────────────────────────────────────────────────────┐
│  endpoint-config.interface.ts                                    │
│                                                                  │
│  ENDPOINT_CONFIG_FLAGS = {                                       │
│    ...                                                           │
│    INCLUDE_ENTERPRISE_SCHEMA: 'includeEnterpriseSchema',  ← L47│
│    ...                                                           │
│  }                                                               │
│                                                                  │
│  DEFAULT_ENDPOINT_CONFIG = {                                     │
│    ...                                                           │
│    [INCLUDE_ENTERPRISE_SCHEMA]: false,                    ← L204│
│    ...                                                           │
│  }                                                               │
│                                                                  │
│  ⚠️ This flag is DEFINED but NEVER CONSUMED:                    │
│    • toScimUserResource() — ignores it                           │
│    • schemas.controller.ts — ignores it                          │
│    • resource-types.controller.ts — ignores it                   │
│    • endpoint-scim-discovery.controller.ts — ignores it          │
│                                                                  │
│  This was clearly INTENDED to control enterprise extension       │
│  behavior per-endpoint, but the implementation was never wired.  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2A. Per-Endpoint Isolation Audit

> **Design Principle #4**: "Multi-Tenancy is URL-Based — RFC 7644 §6 gives three patterns: URL prefix, subdomain, HTTP header. For a multi-endpoint testing server, URL prefix (/{tenantId}/Users) is the most standard and discoverable approach."

### What Works Well (Endpoint Isolation Foundations)

The server's per-endpoint isolation is **architecturally sound** across the DB, routing, and runtime context layers:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  PER-ENDPOINT ISOLATION — WHAT THE SERVER DOES RIGHT                          │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─── LAYER 1: Database Isolation ─────────────────────────────────────────┐ │
│  │                                                                         │ │
│  │  Prisma schema.prisma:                                                  │ │
│  │  model ScimUser {                                                       │ │
│  │    endpointId  String                                                   │ │
│  │    endpoint    Endpoint @relation(fields: [endpointId],                 │ │
│  │                                   references: [id],                     │ │
│  │                                   onDelete: Cascade)  ← cascade delete  │ │
│  │    @@unique([endpointId, scimId])         ← per-endpoint uniqueness     │ │
│  │    @@unique([endpointId, userNameLower])  ← per-endpoint uniqueness     │ │
│  │  }                                                                      │ │
│  │                                                                         │ │
│  │  Result: Endpoint A's user "bjensen" and Endpoint B's user "bjensen"    │ │
│  │  are completely independent rows. Deleting an endpoint cascades to      │ │
│  │  all its users, groups, members, and logs.                              │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─── LAYER 2: URL-Based Routing (RFC 7644 §6 compliant) ─────────────────┐ │
│  │                                                                         │ │
│  │  @Controller('endpoints/:endpointId')                                   │ │
│  │  ├── GET /endpoints/:endpointId/Users          (Users controller)       │ │
│  │  ├── GET /endpoints/:endpointId/Groups         (Groups controller)      │ │
│  │  ├── GET /endpoints/:endpointId/Schemas        (Discovery controller)   │ │
│  │  ├── GET /endpoints/:endpointId/ResourceTypes  (Discovery controller)   │ │
│  │  └── GET /endpoints/:endpointId/ServiceProviderConfig (Discovery ctrl)  │ │
│  │                                                                         │ │
│  │  Each endpoint ID maps to a separate "tenant" with its own             │ │
│  │  users, groups, and configuration.                                      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─── LAYER 3: Request-Scoped Config (AsyncLocalStorage) ──────────────────┐ │
│  │                                                                         │ │
│  │  EndpointContextStorage (Node.js AsyncLocalStorage):                    │ │
│  │  ┌────────────────────────────────────────────────────────────────┐     │ │
│  │  │  Controller.validateAndSetContext(endpointId, req):            │     │ │
│  │  │    1. endpoint = await EndpointService.getEndpoint(endpointId)│     │ │
│  │  │    2. if (!endpoint.active) throw ForbiddenException           │     │ │
│  │  │    3. config = JSON.parse(endpoint.config ?? '{}')            │     │ │
│  │  │    4. EndpointContextStorage.setContext({ endpoint, config })  │     │ │
│  │  └────────────────────────────────────────────────────────────────┘     │ │
│  │                                                                         │ │
│  │  Any service in the call chain can read the current endpoint's          │ │
│  │  config via EndpointContextStorage.getConfig() — no parameter drilling. │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─── LAYER 4: Config Stored Per-Endpoint ─────────────────────────────────┐ │
│  │                                                                         │ │
│  │  model Endpoint {                                                       │ │
│  │    config  String?   // JSON config blob, unique per endpoint           │ │
│  │  }                                                                      │ │
│  │                                                                         │ │
│  │  Endpoint A config: { "VerbosePatchSupported": true,                    │ │
│  │                       "includeEnterpriseSchema": true }                 │ │
│  │  Endpoint B config: { "VerbosePatchSupported": false }                  │ │
│  │  Endpoint C config: (null → uses defaults)                              │ │
│  │                                                                         │ │
│  │  Each endpoint can behave differently. Config flags are validated       │ │
│  │  on create/update via validateEndpointConfig().                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Where Isolation Breaks Down

Despite the strong foundations, **the discovery layer ignores per-endpoint config entirely**:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  THE DISCONNECT: Config Exists But Discovery Doesn't Use It                   │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  Endpoint A (id: "acme-corp")                                                │
│  Config: { "includeEnterpriseSchema": true, "VerbosePatchSupported": true }  │
│                                                                               │
│  Endpoint B (id: "contoso")                                                  │
│  Config: { "includeEnterpriseSchema": false }                                │
│                                                                               │
│     GET /endpoints/acme-corp/ServiceProviderConfig                           │
│     GET /endpoints/contoso/ServiceProviderConfig                             │
│                                                                               │
│     EXPECTED: Different responses reflecting each endpoint's capabilities     │
│     ACTUAL:   Identical hardcoded JSON for both endpoints                     │
│                                                                               │
│     ┌───────────────────────────┬───────────────────────────┐                │
│     │  acme-corp response       │  contoso response         │                │
│     ├───────────────────────────┼───────────────────────────┤                │
│     │  patch: { supported: true │  patch: { supported: true │                │
│     │  }                        │  }                        │                │
│     │  filter: { supported:     │  filter: { supported:     │                │
│     │    true, maxResults: 200  │    true, maxResults: 200  │                │
│     │  }                        │  }                        │                │
│     │  sort: { supported: false │  sort: { supported: false │                │
│     │  }                        │  }                        │                │
│     └───────────────────────────┴───────────────────────────┘                │
│                     ▲ IDENTICAL ▲                                             │
│                                                                               │
│  Same problem for /Schemas and /ResourceTypes:                               │
│  • acme-corp has enterprise schema enabled → /Schemas doesn't show it        │
│  • contoso doesn't have it → /Schemas still shows the same base set          │
│                                                                               │
│  The TODO comment in endpoint-scim-discovery.controller.ts L99 acknowledges: │
│  // ===== Private helpers (static JSON – TODO: migrate to ScimMetadataService)│
└───────────────────────────────────────────────────────────────────────────────┘
```

### Per-Endpoint Discovery — RFC 7644 §4 Requirement

RFC 7644 §4 states that discovery endpoints allow clients to understand the server's capabilities. In a multi-tenant system, this means each tenant's discovery responses **must reflect that tenant's actual configuration**.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  WHAT RFC-COMPLIANT PER-ENDPOINT DISCOVERY LOOKS LIKE                         │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  GET /endpoints/acme-corp/ServiceProviderConfig                              │
│  → { patch: { supported: true },                                             │
│      filter: { supported: true, maxResults: 200 },                           │
│      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },       │
│      sort: { supported: false },                                             │
│      etag: { supported: true },                                              │
│      meta: { location: "/endpoints/acme-corp/ServiceProviderConfig",         │
│              resourceType: "ServiceProviderConfig" } }                        │
│                                                                               │
│  GET /endpoints/acme-corp/Schemas                                            │
│  → { Resources: [core:User, enterprise:User, core:Group] }                   │
│    ▲ includes enterprise because config.includeEnterpriseSchema = true        │
│                                                                               │
│  GET /endpoints/acme-corp/ResourceTypes                                      │
│  → { Resources: [                                                            │
│      { id: "User", schemaExtensions: [{                                      │
│          schema: "...enterprise:2.0:User", required: false                   │
│      }] },                                                                   │
│      { id: "Group", schemaExtensions: [] }                                   │
│    ] }                                                                        │
│                                                                               │
│  GET /endpoints/contoso/Schemas                                              │
│  → { Resources: [core:User, core:Group] }                                    │
│    ▲ NO enterprise schema because config.includeEnterpriseSchema = false     │
│                                                                               │
│  Each endpoint tells the truth about its OWN capabilities.                   │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2B. ServiceProviderConfig Audit

> **Design Principle #3**: "Discovery Drives the Contract — /ServiceProviderConfig, /Schemas, /ResourceTypes must be per-tenant, truthful, and generated from actual server capabilities — never hardcoded."

### Current State

The ServiceProviderConfig (SPC) endpoint exists in two places:

| Version | File | Route | Behavior |
|---------|------|-------|----------|
| Global | `service-provider-config.controller.ts` | `GET /ServiceProviderConfig` | 100% hardcoded static JSON |
| Per-endpoint | `endpoint-scim-discovery.controller.ts` L87-96 | `GET /endpoints/:endpointId/ServiceProviderConfig` | 100% hardcoded, **identical** to global |

### What It Currently Returns

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "patch": { "supported": true },
  "bulk": { "supported": false },
  "filter": { "supported": true, "maxResults": 200 },
  "changePassword": { "supported": false },
  "sort": { "supported": false },
  "etag": { "supported": true },
  "authenticationSchemes": [{
    "type": "oauthbearertoken",
    "name": "OAuth Bearer Token",
    "description": "Authentication scheme using the OAuth Bearer Token Standard",
    "specificationUrl": "https://www.rfc-editor.org/info/rfc6750"
  }]
}
```

### RFC 7644 §4 Analysis — What ServiceProviderConfig MUST Contain

RFC 7644 §4 Table 1 defines the required SPC attributes:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ServiceProviderConfig — RFC 7644 §4 Compliance Check                    │
├──────────────────────┬──────────┬──────────────┬────────────────────────┤
│  Attribute           │ Required │ Current      │ Assessment             │
├──────────────────────┼──────────┼──────────────┼────────────────────────┤
│  schemas             │ Yes      │ ✅ present   │ Correct                │
│  documentationUri    │ No       │ ❌ missing   │ Should point to docs   │
│  patch.supported     │ Yes      │ ✅ true      │ Correct — server does  │
│                      │          │              │ support PATCH          │
│  bulk.supported      │ Yes      │ ✅ false     │ Correct — no bulk      │
│  bulk.maxOperations  │ Required │ ❌ missing   │ Required when bulk     │
│                      │ if bulk  │              │ object is present      │
│  bulk.maxPayloadSize │ Required │ ❌ missing   │ Required when bulk     │
│                      │ if bulk  │              │ object is present      │
│  filter.supported    │ Yes      │ ✅ true      │ Correct                │
│  filter.maxResults   │ Required │ ✅ 200       │ Correct                │
│                      │ if filter│              │                        │
│  changePassword      │ Yes      │ ✅ false     │ Correct — not a SCIM   │
│  .supported          │          │              │ password endpoint      │
│  sort.supported      │ Yes      │ ✅ false     │ Correct                │
│  etag.supported      │ Yes      │ ✅ true      │ ⚠️ Claims true but    │
│                      │          │              │ needs verification     │
│  authenticationSchemes│ Yes     │ ✅ present   │ Has OAuth Bearer Token │
│  meta                │ No       │ ❌ missing   │ Should have location   │
│                      │          │              │ and resourceType       │
├──────────────────────┴──────────┴──────────────┴────────────────────────┤
│                                                                          │
│  CRITICAL ISSUES:                                                        │
│                                                                          │
│  1. bulk object missing maxOperations and maxPayloadSize                 │
│     RFC 7644 §4 says: "A bulk configuration option whose content         │
│     itself is a complex type defining supported and maxOperations."       │
│                                                                          │
│  2. SPC is identical for all endpoints — violates Principle #3           │
│     (Discovery Drives the Contract). If endpoint A has enterprise        │
│     schema enabled and endpoint B doesn't, the SPC should reflect        │
│     the difference.                                                      │
│                                                                          │
│  3. No meta object — RFC 7643 §3.1 says all resources SHOULD have       │
│     meta with location and resourceType.                                 │
│                                                                          │
│  4. No documentationUri — RFC 7644 §4 defines this optional field        │
│     pointing to human-readable help.                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### What a Correct Per-Endpoint SPC Looks Like

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "documentationUri": "https://scimserver.example.com/docs",
  "patch": {
    "supported": true
  },
  "bulk": {
    "supported": false,
    "maxOperations": 0,
    "maxPayloadSize": 0
  },
  "filter": {
    "supported": true,
    "maxResults": 200
  },
  "changePassword": {
    "supported": false
  },
  "sort": {
    "supported": false
  },
  "etag": {
    "supported": true
  },
  "authenticationSchemes": [
    {
      "type": "oauthbearertoken",
      "name": "OAuth Bearer Token",
      "description": "Authentication scheme using the OAuth Bearer Token Standard",
      "specUri": "https://www.rfc-editor.org/info/rfc6750",
      "documentationUri": "https://scimserver.example.com/docs/auth"
    }
  ],
  "meta": {
    "location": "/endpoints/acme-corp/ServiceProviderConfig",
    "resourceType": "ServiceProviderConfig",
    "created": "2026-01-01T00:00:00Z",
    "lastModified": "2026-02-17T00:00:00Z"
  }
}
```

### SPC-Aware Config Flags (New — to Wire Up)

The per-endpoint SPC response should be **dynamically built from the endpoint's config**. This captures capabilities that differ per endpoint:

```
┌────────────────────────────────────────────────────────────────────────┐
│  PROPOSED: ServiceProviderConfig Driven by Endpoint Config             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  EndpointConfig flag             → SPC field affected                  │
│  ────────────────────             ──────────────────                   │
│  (always true for now)           → patch.supported = true             │
│  (always false for now)          → bulk.supported = false             │
│  (always true for now)           → filter.supported = true            │
│  (always false for now)          → sort.supported = false             │
│  (always true for now)           → etag.supported = true              │
│  filterMaxResults (new flag)     → filter.maxResults = N              │
│                                                                        │
│  Currently these are all hardcoded as identical for every endpoint.    │
│  If a future endpoint needs bulk support or higher filter limits,      │
│  the SPC must reflect that truthfully.                                 │
│                                                                        │
│  Implementation approach:                                              │
│  ┌──────────────────────────────────────────────────────────┐         │
│  │  getServiceProviderConfigJSON(config: EndpointConfig) {  │         │
│  │    return {                                              │         │
│  │      schemas: [SCIM_SP_CONFIG_SCHEMA],                   │         │
│  │      documentationUri: config.documentationUri ?? null,  │         │
│  │      patch: { supported: true },                         │         │
│  │      bulk: {                                             │         │
│  │        supported: false,                                 │         │
│  │        maxOperations: 0,                                 │         │
│  │        maxPayloadSize: 0                                 │         │
│  │      },                                                  │         │
│  │      filter: {                                           │         │
│  │        supported: true,                                  │         │
│  │        maxResults: config.filterMaxResults ?? 200        │         │
│  │      },                                                  │         │
│  │      changePassword: { supported: false },               │         │
│  │      sort: { supported: false },                         │         │
│  │      etag: { supported: true },                          │         │
│  │      authenticationSchemes: [...],                       │         │
│  │      meta: {                                             │         │
│  │        location: `/${endpointId}/ServiceProviderConfig`, │         │
│  │        resourceType: 'ServiceProviderConfig'             │         │
│  │      }                                                   │         │
│  │    };                                                    │         │
│  │  }                                                       │         │
│  └──────────────────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2C. Endpoint Config Flags — Live vs Dead

> **Design Principle #1**: "Schema is the Source of Truth" — If a config flag exists, it should govern behavior. Dead flags violate this principle because they promise configurability that doesn't exist.

### Complete Config Flag Inventory

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ENDPOINT CONFIG FLAGS — FULL AUDIT (endpoint-config.interface.ts, 338 lines) │
├──────────────────────────────────────────────────────────┬──────────┬──────────┤
│  Flag                                                    │ Default  │ Status   │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  MultiOpPatchRequestAddMultipleMembersToGroup            │ false    │ ✅ LIVE  │
│  → Used in endpoint-scim-groups.service.ts L189          │          │ Controls │
│  → Controls multi-member PATCH add behavior              │          │ PATCH    │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  MultiOpPatchRequestRemoveMultipleMembersFromGroup       │ false    │ ✅ LIVE  │
│  → Used in endpoint-scim-groups.service.ts L190          │          │ Controls │
│  → Controls multi-member PATCH remove behavior           │          │ PATCH    │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  PatchOpAllowRemoveAllMembers                            │ true     │ ✅ LIVE  │
│  → Used in endpoint-scim-groups.service.ts L192          │          │ Controls │
│  → Controls whether "remove path=members" clears all     │          │ PATCH    │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  VerbosePatchSupported                                   │ false    │ ✅ LIVE  │
│  → Used in endpoint-scim-users.service.ts L323           │          │ Controls │
│  → Controls dot-notation path resolution in PATCH        │          │ PATCH    │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  logLevel                                                │ (none)   │ ✅ LIVE  │
│  → Used in endpoint.service.ts L48                       │          │ Controls │
│  → Per-endpoint log level override via ScimLogger        │          │ Logging  │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  excludeMeta                                             │ false    │ 💀 DEAD  │
│  → Defined + in defaults + in tests                      │          │ Never    │
│  → NEVER consumed in any service or controller           │          │ read     │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  excludeSchemas                                          │ false    │ 💀 DEAD  │
│  → Defined + in defaults + in tests                      │          │ Never    │
│  → NEVER consumed in any service or controller           │          │ read     │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  customSchemaUrn                                         │ (none)   │ 💀 DEAD  │
│  → Defined + in tests                                    │          │ Never    │
│  → NEVER consumed in any service or controller           │          │ read     │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  includeEnterpriseSchema                                 │ false    │ 💀 DEAD  │
│  → Defined + in defaults + in tests                      │          │ Never    │
│  → NEVER consumed by toScimUserResource, /Schemas,       │          │ read     │
│    /ResourceTypes, or /ServiceProviderConfig              │          │          │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  strictMode                                              │ false    │ 💀 DEAD  │
│  → Only used in endpoint.service.spec.ts fixtures        │          │ Never    │
│  → NEVER consumed in runtime code                        │          │ read     │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  legacyMode                                              │ false    │ 💀 DEAD  │
│  → Defined + in defaults + in tests                      │          │ Never    │
│  → NEVER consumed in any service or controller           │          │ read     │
├──────────────────────────────────────────────────────────┼──────────┼──────────┤
│  customHeaders                                           │ (none)   │ 💀 DEAD  │
│  → Defined + in tests                                    │          │ Never    │
│  → NEVER consumed in any middleware or interceptor       │          │ read     │
├──────────────────────────────────────────────────────────┴──────────┴──────────┤
│                                                                                │
│  SUMMARY: 5 of 12 flags are live (42%). 7 flags are dead code (58%).          │
│  validateEndpointConfig() validates only the 5 live flags.                    │
│  The 7 dead flags can be set but have no effect.                              │
│                                                                                │
│  The [key: string]: unknown index signature on EndpointConfig means           │
│  arbitrary config keys are accepted but silently ignored.                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Flags That Should Govern Discovery (But Don't)

```
  Config Flag                    Should Affect
  ─────────────                  ──────────────
  includeEnterpriseSchema   →    schemas[] array in User responses
                                 /Schemas → include enterprise User schema def
                                 /ResourceTypes → include in schemaExtensions[]
                                 /ServiceProviderConfig → (indirect, capabilities)

  excludeMeta               →    Omit "meta" from resource responses
                                 (testing IdP behavior with missing meta)

  excludeSchemas            →    Omit "schemas" from resource responses
                                 (testing IdP behavior with missing schemas)

  customSchemaUrn           →    Replace urn:ietf prefix with custom prefix
                                 /Schemas → return custom-prefixed schemas

  customHeaders             →    Add headers to every response for this endpoint
                                 (e.g., custom CORS, rate-limit hints)
```

These flags represent **per-endpoint configurability as a first-class feature** — the architecture was designed for this. Wiring them up completes the original design intent.

---

## 2D. Current Architecture Coupling — What Must Change

Before presenting recommendations, here is a structural map of what's tightly coupled today and what the principles demand:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  CURRENT ARCHITECTURE — TIGHT COUPLING MAP                                    │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│                    ┌─────────────────────┐                                    │
│                    │  NestJS Controllers  │                                    │
│                    │  (User, Group)       │ ← Hardcoded resource types         │
│                    └────────┬────────────┘                                    │
│                             │                                                 │
│                    ┌────────▼────────────┐                                    │
│                    │  Service Layer       │                                    │
│                    │  UsersService (657L) │ ← Hardcoded attribute names        │
│                    │  GroupsService (765L)│ ← Hardcoded PATCH paths            │
│                    │                     │ ← Hardcoded schemas[]              │
│                    │  normalizeObjectKeys │ ← Full RFC 7643 User attr map     │
│                    │  stripReservedAttrs  │ ← Hardcoded reserved set          │
│                    └────────┬────────────┘                                    │
│                             │                                                 │
│                    ┌────────▼────────────┐                                    │
│                    │  Prisma ORM          │ ← Direct this.prisma.* calls      │
│                    │                     │ ← Prisma types in signatures       │
│                    │  rawPayload (JSON    │ ← All attrs in one TEXT column    │
│                    │   string blob)       │ ← No queryable attr storage       │
│                    └────────┬────────────┘                                    │
│                             │                                                 │
│                    ┌────────▼────────────┐                                    │
│                    │  SQLite              │ ← No JSONB, no CITEXT             │
│                    │                     │ ← userNameLower workarounds        │
│                    └─────────────────────┘                                    │
│                                                                               │
│  KEY COUPLING VIOLATIONS:                                                     │
│                                                                               │
│  Principle #1 (Schema as Source of Truth):                                    │
│    • normalizeObjectKeys has hardcoded map of 20+ attribute names             │
│    • PATCH path matching uses lowercase string comparison, not schema lookup  │
│    • No mutability/returned/caseExact enforcement from schema definitions     │
│                                                                               │
│  Principle #2 (Resource Types Pluggable):                                     │
│    • Separate UsersService (657L) + GroupsService (765L) with 60% overlap     │
│    • Adding a new resource type requires writing a new service + controller   │
│    • PATCH logic duplicated between User and Group services                   │
│                                                                               │
│  Principle #7 (Simplicity Through Generalization):                            │
│    • extractAdditionalAttributes: User strips 3 fields, Group strips 3 fields │
│    • toScimUserResource / toScimGroupResource: same pattern, different fields │
│    • Both services: buildMeta, parseJson, sanitizeBooleanStrings (duplicated) │
│                                                                               │
│  Persistence Lock-in:                                                         │
│    • 14+ direct this.prisma.scimUser.* calls in UsersService                  │
│    • Prisma types (ScimUserCreateInput, Prisma.TransactionClient) in sigs    │
│    • GroupsService uses Prisma $transaction directly                          │
│    • Switching DB requires rewriting both 700-line services entirely          │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Target Architecture Vision

> **Unconstrained by current persistence, DB schema, or layer implementations.**
> **Every recommendation below can incrementally replace current code.**

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        TARGET ARCHITECTURE                                    │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─ HTTP Layer ────────────────────────────────────────────────────────────┐ │
│  │                                                                         │ │
│  │  GenericScimController                                                  │ │
│  │  @Controller('endpoints/:endpointId/:resourceType')                     │ │
│  │  ├── GET    / → list()     ← single controller handles ALL             │ │
│  │  ├── GET    /:id → get()      resource types (User, Group,             │ │
│  │  ├── POST   / → create()      CustomResource, anything)                │ │
│  │  ├── PUT    /:id → replace()                                           │ │
│  │  ├── PATCH  /:id → patch()                                             │ │
│  │  ├── DELETE /:id → delete()                                            │ │
│  │  └── POST   /.search → search()                                       │ │
│  │                                                                         │ │
│  │  DiscoveryController (per-endpoint, config-driven)                      │ │
│  │  ├── GET /Schemas              ← generated from SchemaRegistry         │ │
│  │  ├── GET /ResourceTypes        ← generated from ResourceTypeRegistry   │ │
│  │  └── GET /ServiceProviderConfig ← generated from capabilities          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                             │                                                │
│                             ▼                                                │
│  ┌─ Schema-Driven Engine ──────────────────────────────────────────────────┐ │
│  │                                                                         │ │
│  │  SchemaRegistry                                                         │ │
│  │  ├── Loads schema definitions from DB (per-endpoint)                    │ │
│  │  ├── Falls back to bundled JSON defaults                                │ │
│  │  ├── Resolves attribute characteristics at runtime                      │ │
│  │  └── Drives ALL behavior: validation, filtering, response shaping      │ │
│  │                                                                         │ │
│  │  ScimResourceEngine                                                     │ │
│  │  ├── create(endpointId, resourceType, body)                             │ │
│  │  │   → validate required attrs from schema                             │ │
│  │  │   → strip readOnly attrs (mutability: "readOnly")                   │ │
│  │  │   → validate uniqueness per schema (uniqueness: "server")           │ │
│  │  │   → persist via repository                                          │ │
│  │  │   → shape response per returned rules                               │ │
│  │  │                                                                      │ │
│  │  ├── get(endpointId, resourceType, id)                                  │ │
│  │  │   → fetch via repository                                            │ │
│  │  │   → apply returned rules ("never" excluded, "always" included)      │ │
│  │  │   → apply attributes/excludedAttributes projection                  │ │
│  │  │                                                                      │ │
│  │  ├── list(endpointId, resourceType, filter, sort, pagination)           │ │
│  │  │   → parse filter, resolve caseExact from schema                     │ │
│  │  │   → delegate to repository (push-down what it can)                  │ │
│  │  │   → in-memory for complex expressions                               │ │
│  │  │   → shape + paginate                                                │ │
│  │  │                                                                      │ │
│  │  ├── replace(endpointId, resourceType, id, body)                        │ │
│  │  │   → strip readOnly attrs (schema says ignore on PUT)                │ │
│  │  │   → validate required, validate uniqueness                          │ │
│  │  │   → persist, shape response                                         │ │
│  │  │                                                                      │ │
│  │  ├── patch(endpointId, resourceType, id, operations)                    │ │
│  │  │   → validate paths against schema (does attr exist? mutable?)       │ │
│  │  │   → apply ops on in-memory resource                                 │ │
│  │  │   → persist, shape response                                         │ │
│  │  │                                                                      │ │
│  │  └── delete(endpointId, resourceType, id)                               │ │
│  │      → repository.delete()                                             │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                             │                                                │
│                             ▼                                                │
│  ┌─ Repository Abstraction ────────────────────────────────────────────────┐ │
│  │                                                                         │ │
│  │  interface ScimResourceRepository {                                      │ │
│  │    create(endpointId, resourceType, resource): Promise<StoredResource>   │ │
│  │    findById(endpointId, resourceType, id): Promise<StoredResource|null>  │ │
│  │    findAll(endpointId, resourceType, opts): Promise<PagedResult>         │ │
│  │    update(endpointId, resourceType, id, resource): Promise<StoredRes>    │ │
│  │    delete(endpointId, resourceType, id): Promise<void>                  │ │
│  │    count(endpointId, resourceType, filter?): Promise<number>            │ │
│  │    checkUniqueness(endpointId, resourceType, attr, value, excludeId?)   │ │
│  │  }                                                                      │ │
│  │                                                                         │ │
│  │  Implementations:                                                       │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │ │
│  │  │ PrismaRepository │  │ PostgresRepository│  │ InMemoryRepository│     │ │
│  │  │ (current SQLite)  │  │ (future)         │  │ (testing)         │     │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                             │                                                │
│                             ▼                                                │
│  ┌─ Storage Layer ─────────────────────────────────────────────────────────┐ │
│  │  SQLite / PostgreSQL / MongoDB / CosmosDB / In-Memory                   │ │
│  │  (swappable via DI — never referenced above repository interface)       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Shifts

| Current | Target | Principle |
|---------|--------|-----------|
| Separate UsersService (657L) + GroupsService (765L) | Single `ScimResourceEngine` (~400L) | #7 Simplicity |
| Hardcoded attribute names in normalizeObjectKeys | Schema-driven attribute resolution | #1 Schema is Truth |
| `this.prisma.scimUser.findMany()` in service | `repository.findAll(endpointId, 'User', opts)` | Persistence abstraction |
| `schemas: [SCIM_CORE_USER_SCHEMA]` hardcoded | `schemas: schemaRegistry.buildSchemasArray(resource)` | #3 Discovery |
| User + Group only | Any registered resource type | #2 Pluggable |
| rawPayload JSON blob, no queryable attrs | Document-per-resource or normalized attrs | DB flexibility |
| Schema JSON hardcoded in controller methods | Schema definitions stored per-endpoint in DB | #1 + #3 |

---

## 4. Recommendation #1 — Schema-Driven Resource Engine

> **Principles**: #1 (Schema is Source of Truth), #5 (Attribute Characteristics Not Optional), #7 (Simplicity Through Generalization)

### 4.1 The Problem — Hardcoded Attribute Behavior

Today, every attribute behavior is hardcoded:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  CURRENT: Attribute Behavior Hardcoded Per-Service                        │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  endpoint-scim-users.service.ts:                                          │
│                                                                           │
│  normalizeObjectKeys (L470-498):                                          │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ const keyMap = {                                                   │   │
│  │   'username': 'userName',       // ← case mapping hardcoded       │   │
│  │   'externalid': 'externalId',   // ← case mapping hardcoded       │   │
│  │   'displayname': 'displayName', // ← case mapping hardcoded       │   │
│  │   'nickname': 'nickName',       //    ... 20+ entries              │   │
│  │   'phonenumbers': 'phoneNumbers',                                 │   │
│  │   'x509certificates': 'x509Certificates',                        │   │
│  │ };                                                                 │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  extractAdditionalAttributes (L623-635):                                  │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ delete additional.userName;     // ← DB column list hardcoded     │   │
│  │ delete additional.externalId;   // ← knows which are "first-class"│   │
│  │ delete additional.active;       // ← must update if schema changes│   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  applyPatchOperationsForEndpoint (L300-460):                              │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ if (pathLower === 'active')     → updateData.active = ...         │   │
│  │ if (pathLower === 'username')   → updateData.userName = ...       │   │
│  │ if (pathLower === 'externalid') → updateData.externalId = ...     │   │
│  │ // ← Each new attribute needs a new if-branch                     │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  RFC 7643 §7 says the schema definition tells you:                       │
│  • name, type, multiValued, required, caseExact                          │
│  • mutability (readOnly/readWrite/immutable/writeOnly)                   │
│  • returned (always/never/default/request)                               │
│  • uniqueness (none/server/global)                                       │
│                                                                           │
│  NONE of these are read from schema definitions today.                   │
│  ALL are hardcoded in service code.                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.2 The Design — Schema-Driven Attribute Resolution

```
┌───────────────────────────────────────────────────────────────────────────┐
│  RFC 7643 §7 SCHEMA DEFINITION FORMAT (source of truth)                   │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  {                                                                        │
│    "id": "urn:ietf:params:scim:schemas:core:2.0:User",                   │
│    "name": "User",                                                        │
│    "attributes": [                                                        │
│      {                                                                    │
│        "name": "userName",                                                │
│        "type": "string",                                                  │
│        "multiValued": false,                                              │
│        "required": true,          ← CREATE must validate                 │
│        "caseExact": false,        ← filter eq is case-insensitive        │
│        "mutability": "readWrite", ← allowed in PUT/PATCH/POST            │
│        "returned": "always",      ← always in response, can't exclude    │
│        "uniqueness": "server"     ← enforce unique per endpoint          │
│      },                                                                   │
│      {                                                                    │
│        "name": "id",                                                      │
│        "type": "string",                                                  │
│        "mutability": "readOnly",  ← ignored on POST/PUT/PATCH            │
│        "returned": "always",      ← always in response                   │
│        "uniqueness": "server"                                             │
│      },                                                                   │
│      {                                                                    │
│        "name": "password",                                                │
│        "type": "string",                                                  │
│        "mutability": "writeOnly", ← accepted on POST, never returned     │
│        "returned": "never"        ← NEVER in any response                │
│      }                                                                    │
│    ]                                                                      │
│  }                                                                        │
│                                                                           │
│  Every CRUD operation consults these characteristics.                     │
│  No hardcoded attribute lists needed.                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.3 SchemaRegistry — Per-Endpoint Schema Storage

```typescript
/**
 * SchemaRegistry: stores and resolves schema definitions per-endpoint.
 *
 * Schema definitions are loaded from:
 *   1. Endpoint-specific overrides (stored in DB)
 *   2. Bundled defaults (JSON files shipped with the server)
 *
 * This is NOT hardcoded in controller methods.
 */
export interface SchemaDefinition {
  /** RFC 7643 §7: Full schema definition */
  id: string;                          // "urn:ietf:params:scim:schemas:core:2.0:User"
  name: string;                        // "User"
  description: string;
  attributes: AttributeDefinition[];
  meta?: { resourceType: 'Schema'; location: string };
}

export interface AttributeDefinition {
  name: string;
  type: 'string' | 'boolean' | 'decimal' | 'integer' | 'dateTime'
       | 'reference' | 'complex' | 'binary';
  multiValued: boolean;
  description?: string;
  required: boolean;
  caseExact: boolean;
  mutability: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  returned: 'always' | 'never' | 'default' | 'request';
  uniqueness: 'none' | 'server' | 'global';
  referenceTypes?: string[];
  canonicalValues?: string[];
  subAttributes?: AttributeDefinition[];
}

@Injectable()
export class SchemaRegistry {
  /**
   * Get all schema definitions for an endpoint.
   * Per-endpoint overrides take precedence over bundled defaults.
   */
  async getSchemasForEndpoint(
    endpointId: string,
  ): Promise<SchemaDefinition[]> { ... }

  /**
   * Get a specific schema by URI for an endpoint.
   */
  async getSchema(
    endpointId: string,
    schemaUri: string,
  ): Promise<SchemaDefinition | null> { ... }

  /**
   * Resolve an attribute by its path (e.g., "userName", "name.givenName",
   * "urn:...:enterprise:2.0:User:department").
   * Returns the AttributeDefinition with all characteristics.
   */
  resolveAttribute(
    schema: SchemaDefinition,
    path: string,
  ): AttributeDefinition | null { ... }

  /**
   * Get all attributes with uniqueness: "server" or "global".
   * Used by the engine to enforce uniqueness constraints on CREATE/PUT.
   */
  getUniqueAttributes(
    schema: SchemaDefinition,
  ): AttributeDefinition[] { ... }

  /**
   * Get all required attributes.
   * Used by the engine to validate on CREATE.
   */
  getRequiredAttributes(
    schema: SchemaDefinition,
  ): AttributeDefinition[] { ... }

  /**
   * Store a schema override for an endpoint.
   * Allows per-endpoint schema customization.
   */
  async setSchemaOverride(
    endpointId: string,
    schema: SchemaDefinition,
  ): Promise<void> { ... }
}
```

### 4.4 Bundled Default Schemas (JSON Files)

Instead of hardcoding schemas in controller methods, ship them as JSON:

```
api/src/schemas/
├── core-user.schema.json          ← RFC 7643 §4.1 (complete User schema)
├── core-group.schema.json         ← RFC 7643 §4.2 (complete Group schema)
├── enterprise-user.schema.json    ← RFC 7643 §4.3 (Enterprise User extension)
└── service-provider-config.schema.json  ← RFC 7643 §5
```

On first endpoint creation (or migration), these are copied into the endpoint's schema storage. The endpoint admin can then customize them.

**Example**: `core-user.schema.json` (abbreviated):

```json
{
  "id": "urn:ietf:params:scim:schemas:core:2.0:User",
  "name": "User",
  "description": "User Account",
  "attributes": [
    {
      "name": "userName",
      "type": "string",
      "multiValued": false,
      "required": true,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "always",
      "uniqueness": "server"
    },
    {
      "name": "name",
      "type": "complex",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none",
      "subAttributes": [
        { "name": "formatted", "type": "string", "multiValued": false,
          "required": false, "mutability": "readWrite", "returned": "default",
          "uniqueness": "none", "caseExact": false },
        { "name": "familyName", "type": "string", "multiValued": false,
          "required": false, "mutability": "readWrite", "returned": "default",
          "uniqueness": "none", "caseExact": false },
        { "name": "givenName", "type": "string", "multiValued": false,
          "required": false, "mutability": "readWrite", "returned": "default",
          "uniqueness": "none", "caseExact": false }
      ]
    },
    {
      "name": "password",
      "type": "string",
      "multiValued": false,
      "required": false,
      "caseExact": false,
      "mutability": "writeOnly",
      "returned": "never",
      "uniqueness": "none"
    }
  ]
}
```

### 4.5 ScimResourceEngine — Generic CRUD

```typescript
/**
 * ScimResourceEngine: schema-driven CRUD for ANY resource type.
 * Replaces both EndpointScimUsersService (657L) and
 * EndpointScimGroupsService (765L) with a single ~400L service.
 */
@Injectable()
export class ScimResourceEngine {
  constructor(
    private readonly schemaRegistry: SchemaRegistry,
    private readonly repository: ScimResourceRepository,
    private readonly resourceTypeRegistry: ResourceTypeRegistry,
  ) {}

  async create(
    endpointId: string,
    resourceTypeName: string,
    body: Record<string, unknown>,
    baseUrl: string,
  ): Promise<Record<string, unknown>> {
    // 1. Resolve resource type → get core schema + extensions
    const resourceType = await this.resourceTypeRegistry
      .getResourceType(endpointId, resourceTypeName);
    const coreSchema = await this.schemaRegistry
      .getSchema(endpointId, resourceType.schema);

    // 2. Validate required attributes (from schema, not hardcoded)
    for (const attr of this.schemaRegistry.getRequiredAttributes(coreSchema)) {
      if (body[attr.name] === undefined) {
        throw createScimError(400, 'invalidValue',
          `Required attribute "${attr.name}" is missing`);
      }
    }

    // 3. Strip readOnly attributes (schema says ignore on POST)
    const mutableBody = this.stripByMutability(body, coreSchema, ['readOnly']);

    // 4. Validate uniqueness constraints (from schema, not hardcoded)
    for (const attr of this.schemaRegistry.getUniqueAttributes(coreSchema)) {
      if (mutableBody[attr.name] !== undefined) {
        const value = attr.caseExact
          ? String(mutableBody[attr.name])
          : String(mutableBody[attr.name]).toLowerCase();
        await this.repository.checkUniqueness(
          endpointId, resourceTypeName, attr.name, value,
        );
      }
    }

    // 5. Generate id and meta (always server-assigned)
    const scimId = crypto.randomUUID();
    const now = new Date().toISOString();
    const meta = {
      resourceType: resourceTypeName,
      created: now,
      lastModified: now,
      location: `${baseUrl}/${resourceTypeName}s/${scimId}`,
      version: `W/"${this.computeEtag(mutableBody)}"`,
    };

    // 6. Build schemas array (dynamic, from body + extensions present)
    const schemas = this.buildSchemasArray(body, coreSchema, resourceType);

    // 7. Persist
    const stored = await this.repository.create(endpointId, resourceTypeName, {
      scimId,
      schemas,
      ...mutableBody,
      meta,
    });

    // 8. Shape response per returned rules
    return this.shapeResponse(stored, coreSchema, baseUrl);
  }

  async get(
    endpointId: string,
    resourceTypeName: string,
    scimId: string,
    baseUrl: string,
    attributes?: string[],
    excludedAttributes?: string[],
  ): Promise<Record<string, unknown>> {
    const stored = await this.repository.findById(
      endpointId, resourceTypeName, scimId,
    );
    if (!stored) throw createScimError(404, 'noTarget', 'Resource not found');

    const coreSchema = await this.schemaRegistry
      .getSchema(endpointId, stored.schemas?.[0]);

    // Shape per returned rules + attribute projection
    return this.shapeResponse(
      stored, coreSchema, baseUrl, attributes, excludedAttributes,
    );
  }

  async replace(
    endpointId: string,
    resourceTypeName: string,
    scimId: string,
    body: Record<string, unknown>,
    baseUrl: string,
  ): Promise<Record<string, unknown>> {
    const existing = await this.repository.findById(
      endpointId, resourceTypeName, scimId,
    );
    if (!existing) throw createScimError(404, 'noTarget', 'Resource not found');

    const coreSchema = await this.schemaRegistry
      .getSchema(endpointId, existing.schemas?.[0]);

    // RFC 7644 §3.5.1: readOnly attributes are ignored on PUT
    const mutableBody = this.stripByMutability(body, coreSchema, ['readOnly']);

    // Preserve immutable attributes from existing resource
    const immutableAttrs = this.getByMutability(existing, coreSchema, ['immutable']);

    const merged = { ...mutableBody, ...immutableAttrs };

    // Validate required + uniqueness
    // ... (same as create, against merged)

    const stored = await this.repository.update(
      endpointId, resourceTypeName, scimId, merged,
    );
    return this.shapeResponse(stored, coreSchema, baseUrl);
  }

  /**
   * Shape a stored resource into a SCIM response.
   * Applies returned rules from schema:
   *   "always"  → always included, cannot be excluded
   *   "never"   → never included (e.g., password)
   *   "default" → included unless in excludedAttributes
   *   "request" → only included if in attributes parameter
   */
  private shapeResponse(
    resource: StoredResource,
    schema: SchemaDefinition,
    baseUrl: string,
    attributes?: string[],
    excludedAttributes?: string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(resource)) {
      const attrDef = this.schemaRegistry.resolveAttribute(schema, key);
      if (!attrDef) {
        // Unknown attribute or extension — pass through
        result[key] = value;
        continue;
      }

      switch (attrDef.returned) {
        case 'never':
          // RFC 7643 §2.2: "never" returned attributes NEVER appear
          continue;
        case 'always':
          // RFC 7643 §2.2: "always" returned, cannot be excluded
          result[key] = value;
          continue;
        case 'request':
          // Only if explicitly requested
          if (attributes?.includes(key)) result[key] = value;
          continue;
        case 'default':
          // Included unless explicitly excluded
          if (!excludedAttributes?.includes(key)) result[key] = value;
          continue;
      }
    }

    // "always" returned attributes must be present even if not in stored data
    // id, schemas, meta are always returned
    result.schemas = resource.schemas;
    result.id = resource.scimId;
    result.meta = resource.meta;

    return result;
  }

  /**
   * Strip attributes by mutability.
   * Used to ignore readOnly attrs on POST/PUT, writeOnly on responses.
   */
  private stripByMutability(
    body: Record<string, unknown>,
    schema: SchemaDefinition,
    mutabilities: string[],
  ): Record<string, unknown> {
    const result = { ...body };
    for (const [key] of Object.entries(result)) {
      const attrDef = this.schemaRegistry.resolveAttribute(schema, key);
      if (attrDef && mutabilities.includes(attrDef.mutability)) {
        delete result[key];
      }
    }
    return result;
  }
}
```

### 4.6 How PATCH Becomes Schema-Driven

```
┌───────────────────────────────────────────────────────────────────────────┐
│  PATCH — CURRENT vs SCHEMA-DRIVEN                                         │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  CURRENT (hardcoded path matching):                                       │
│  ┌────────────────────────────────────────────────────────────────┐       │
│  │ if (pathLower === 'active')     → special boolean handling     │       │
│  │ if (pathLower === 'username')   → special string handling      │       │
│  │ if (pathLower === 'externalid') → special nullable handling    │       │
│  │ if (isExtensionPath(path))      → extension handling           │       │
│  │ else                            → store as literal key         │       │
│  │                                                                │       │
│  │ 160 lines of if-else chains in PATCH alone                    │       │
│  └────────────────────────────────────────────────────────────────┘       │
│                                                                           │
│  TARGET (schema-driven):                                                  │
│  ┌────────────────────────────────────────────────────────────────┐       │
│  │ for (const op of operations) {                                 │       │
│  │   const attrDef = schema.resolveAttribute(op.path);            │       │
│  │                                                                │       │
│  │   // Schema tells us everything:                               │       │
│  │   if (!attrDef) throw 'noTarget';  // unknown attribute        │       │
│  │   if (attrDef.mutability === 'readOnly') throw 'mutability';   │       │
│  │                                                                │       │
│  │   // Generic type-safe update:                                 │       │
│  │   switch (op.op) {                                             │       │
│  │     case 'replace':                                            │       │
│  │       resource[attrDef.name] = coerce(op.value, attrDef);     │       │
│  │       break;                                                   │       │
│  │     case 'add':                                                │       │
│  │       if (attrDef.multiValued)                                 │       │
│  │         resource[attrDef.name] = [                             │       │
│  │           ...(resource[attrDef.name] ?? []), ...op.value];     │       │
│  │       else                                                     │       │
│  │         resource[attrDef.name] = coerce(op.value, attrDef);   │       │
│  │       break;                                                   │       │
│  │     case 'remove':                                             │       │
│  │       delete resource[attrDef.name];                           │       │
│  │       break;                                                   │       │
│  │   }                                                            │       │
│  │ }                                                              │       │
│  │                                                                │       │
│  │ ~30 lines. Generic for ANY resource type.                     │       │
│  └────────────────────────────────────────────────────────────────┘       │
│                                                                           │
│  coerce(value, attrDef) uses schema type info:                           │
│  • type: "boolean" → Boolean(value)                                      │
│  • type: "integer" → parseInt(value)                                     │
│  • type: "string" + caseExact: false → value.toLowerCase() for matching  │
│  • type: "complex" → validate subAttributes recursively                  │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.7 ResourceTypeRegistry — Pluggable Resource Types

```typescript
/**
 * RFC 7643 §3.2: "SCIM may be extended to define new classes of resources
 * by defining a resource type."
 *
 * Resource types are registrations, not hardcoded User + Group.
 */
export interface ResourceTypeDef {
  /** RFC 7643 §6: Resource Type identifier */
  id: string;                    // "User", "Group", "Device", ...
  name: string;
  description: string;
  endpoint: string;              // "/Users", "/Groups", "/Devices", ...
  schema: string;                // Core schema URI
  schemaExtensions: Array<{
    schema: string;              // Extension schema URI
    required: boolean;
  }>;
}

@Injectable()
export class ResourceTypeRegistry {
  /**
   * Get all resource types for an endpoint.
   * Defaults: User + Group. Endpoint can add custom types.
   */
  async getResourceTypes(endpointId: string): Promise<ResourceTypeDef[]> { ... }

  /**
   * Register a custom resource type for an endpoint.
   * This enables custom resource types per-tenant.
   */
  async registerResourceType(
    endpointId: string,
    resourceType: ResourceTypeDef,
  ): Promise<void> { ... }

  /**
   * Resolve a URL path segment to a resource type.
   * "/Users" → ResourceTypeDef for User
   * "/Devices" → ResourceTypeDef for custom Device type (if registered)
   */
  async resolveFromPath(
    endpointId: string,
    pathSegment: string,
  ): Promise<ResourceTypeDef | null> { ... }
}
```

### 4.8 Per-Endpoint Schema Customization Flow

```
┌───────────────────────────────────────────────────────────────────────────┐
│  PER-ENDPOINT SCHEMA CUSTOMIZATION                                        │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. Endpoint created → default schemas copied from bundled JSON files     │
│                                                                           │
│  2. Admin customizes via API:                                             │
│     PUT /admin/endpoints/acme-corp/schemas/urn:...:core:2.0:User         │
│     Body: { ...modified schema with extra attributes... }                 │
│                                                                           │
│  3. Or adds new extension:                                                │
│     POST /admin/endpoints/acme-corp/schemas                               │
│     Body: {                                                               │
│       "id": "urn:myorg:scim:schemas:extension:location:2.0:User",        │
│       "name": "LocationExtension",                                        │
│       "attributes": [                                                     │
│         { "name": "buildingCode", "type": "string",                       │
│           "mutability": "readWrite", "returned": "default", ... },        │
│         { "name": "floorNumber", "type": "integer",                       │
│           "mutability": "readWrite", "returned": "default", ... }         │
│       ]                                                                   │
│     }                                                                     │
│                                                                           │
│  4. Or adds new resource type:                                            │
│     POST /admin/endpoints/acme-corp/resourcetypes                         │
│     Body: {                                                               │
│       "id": "Device",                                                     │
│       "name": "Device",                                                   │
│       "endpoint": "/Devices",                                             │
│       "schema": "urn:myorg:scim:schemas:core:2.0:Device",                │
│       "schemaExtensions": []                                              │
│     }                                                                     │
│                                                                           │
│  5. Immediately, for that endpoint:                                       │
│     • GET /endpoints/acme-corp/Schemas → includes new schema              │
│     • GET /endpoints/acme-corp/ResourceTypes → includes Device            │
│     • POST/GET/PATCH /endpoints/acme-corp/Devices → fully functional     │
│     • All CRUD behavior driven by the schema definitions                  │
│                                                                           │
│  6. Other endpoints are UNAFFECTED.                                       │
│     acme-corp sees: User, Group, Device                                   │
│     contoso sees:   User, Group                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Recommendation #2 — Persistence Abstraction Layer

> **Principles**: #7 (Simplicity), Separation of Concerns, Testability

### 5.1 The Problem — Tight Prisma Coupling

```
┌───────────────────────────────────────────────────────────────────────────┐
│  CURRENT: Direct Prisma Calls in Service Layer                            │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  endpoint-scim-users.service.ts:                                          │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ import type { Prisma, ScimUser } from '@prisma/client';           │   │
│  │                                                                    │   │
│  │ // 14+ direct Prisma calls:                                        │   │
│  │ this.prisma.scimUser.findFirst(...)     // L89                     │   │
│  │ this.prisma.scimUser.findMany(...)      // L119                    │   │
│  │ this.prisma.scimUser.create(...)        // L72                     │   │
│  │ this.prisma.scimUser.update(...)        // L182, L223              │   │
│  │ this.prisma.scimUser.delete(...)        // L240                    │   │
│  │ this.prisma.scimUser.count(...)         // L270                    │   │
│  │                                                                    │   │
│  │ // Prisma types in method signatures:                              │   │
│  │ Prisma.ScimUserCreateInput                                         │   │
│  │ Prisma.ScimUserUpdateInput                                         │   │
│  │ Prisma.ScimUserWhereInput                                          │   │
│  │ Prisma.TransactionClient                                           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  endpoint-scim-groups.service.ts:                                         │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ // Same pattern, plus transaction coupling:                        │   │
│  │ await this.prisma.$transaction(async (tx) => {                     │   │
│  │   await tx.scimGroup.update(...);                                  │   │
│  │   await tx.groupMember.deleteMany(...);  // delete ALL members     │   │
│  │   await tx.groupMember.createMany(...);  // recreate ALL members   │   │
│  │ }, { maxWait: 10000, timeout: 30000 });                            │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  CONSEQUENCES:                                                            │
│  • Cannot switch to PostgreSQL without rewriting 1400+ lines              │
│  • Cannot unit test without mocking Prisma internals                      │
│  • rawPayload JSON blob means ALL attributes are un-indexed               │
│  • Members delete-all-recreate is O(n) for every PATCH                    │
│  • GroupMember join table is a Prisma-specific design choice              │
└───────────────────────────────────────────────────────────────────────────┘
```

### 5.2 The Design — Repository Interface

```typescript
/**
 * ScimResourceRepository: persistence abstraction for SCIM resources.
 *
 * The engine calls this interface. Implementations handle storage.
 * The engine NEVER imports Prisma types, SQL, or any storage-specific code.
 */
export interface ScimResourceRepository {
  /**
   * Store a new SCIM resource.
   * The resource is a bag of attributes (Record<string, unknown>)
   * with mandatory id, schemas, meta.
   */
  create(
    endpointId: string,
    resourceType: string,
    resource: StoredResource,
  ): Promise<StoredResource>;

  /**
   * Find a single resource by its SCIM id.
   */
  findById(
    endpointId: string,
    resourceType: string,
    scimId: string,
  ): Promise<StoredResource | null>;

  /**
   * Find all resources matching a filter, with pagination.
   * Returns the total count (for ListResponse.totalResults) and the page.
   *
   * The filter is a parsed AST (FilterNode) — the implementation
   * decides how much to push to the DB vs evaluate in-memory.
   */
  findAll(
    endpointId: string,
    resourceType: string,
    options: {
      filter?: FilterNode;
      sortBy?: string;
      sortOrder?: 'ascending' | 'descending';
      startIndex?: number;
      count?: number;
    },
  ): Promise<{ resources: StoredResource[]; totalResults: number }>;

  /**
   * Replace a resource entirely (PUT semantics).
   */
  update(
    endpointId: string,
    resourceType: string,
    scimId: string,
    resource: StoredResource,
  ): Promise<StoredResource>;

  /**
   * Delete a resource.
   */
  delete(
    endpointId: string,
    resourceType: string,
    scimId: string,
  ): Promise<void>;

  /**
   * Check if a value is unique for an attribute within an endpoint.
   * Used by the engine to enforce uniqueness: "server".
   * Throws ScimError(409, 'uniqueness') if not unique.
   */
  checkUniqueness(
    endpointId: string,
    resourceType: string,
    attributeName: string,
    value: string,
    excludeScimId?: string,
  ): Promise<void>;
}

/**
 * StoredResource: the universal shape of a persisted SCIM resource.
 * NOT tied to any ORM or DB schema.
 */
export interface StoredResource {
  scimId: string;
  schemas: string[];
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
    location: string;
    version?: string;
  };
  [key: string]: unknown;     // all SCIM attributes (flat or nested)
}
```

### 5.3 Repository Implementations — Comparison

```
┌───────────────────────────────────────────────────────────────────────────┐
│  REPOSITORY IMPLEMENTATIONS — TRADE-OFFS                                  │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─── PrismaDocumentRepository (current DB, improved) ─────────────────┐ │
│  │                                                                      │ │
│  │  DB Schema:                                                          │ │
│  │  model ScimResource {                                                │ │
│  │    id          String   @id @default(cuid())                        │ │
│  │    endpointId  String                                                │ │
│  │    resourceType String  // "User", "Group", "Device", ...           │ │
│  │    scimId      String                                                │ │
│  │    document    String   // full SCIM resource as JSON                │ │
│  │    meta        String   // meta as JSON                              │ │
│  │                                                                      │ │
│  │    // Indexed hot attributes (extracted from document)               │ │
│  │    attr_userName     String?                                         │ │
│  │    attr_externalId   String?                                         │ │
│  │    attr_displayName  String?                                         │ │
│  │    attr_active       Boolean?                                        │ │
│  │                                                                      │ │
│  │    @@unique([endpointId, resourceType, scimId])                     │ │
│  │    @@index([endpointId, resourceType])                              │ │
│  │    @@index([endpointId, resourceType, attr_userName])               │ │
│  │  }                                                                   │ │
│  │                                                                      │ │
│  │  Pros: Incremental migration from current schema                     │ │
│  │  Cons: Still SQLite constraints (no JSONB querying)                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─── PostgresJsonRepository (recommended for production) ──────────────┐ │
│  │                                                                      │ │
│  │  DB Schema:                                                          │ │
│  │  CREATE TABLE scim_resources (                                       │ │
│  │    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),         │ │
│  │    endpoint_id   TEXT NOT NULL,                                      │ │
│  │    resource_type TEXT NOT NULL,                                      │ │
│  │    scim_id       TEXT NOT NULL,                                      │ │
│  │    document      JSONB NOT NULL,     ← native JSON querying          │ │
│  │    created_at    TIMESTAMPTZ,                                        │ │
│  │    updated_at    TIMESTAMPTZ,                                        │ │
│  │    UNIQUE (endpoint_id, resource_type, scim_id)                     │ │
│  │  );                                                                  │ │
│  │                                                                      │ │
│  │  -- GIN index for ANY JSON attribute queries:                        │ │
│  │  CREATE INDEX idx_doc ON scim_resources                              │ │
│  │    USING GIN (document jsonb_path_ops);                              │ │
│  │                                                                      │ │
│  │  -- B-tree indexes for hot paths:                                    │ │
│  │  CREATE INDEX idx_username ON scim_resources                         │ │
│  │    ((document->>'userName')) WHERE resource_type = 'User';           │ │
│  │                                                                      │ │
│  │  Pros: JSONB native querying, GIN indexes, CITEXT, full SQL         │ │
│  │  Cons: Requires PostgreSQL instance                                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─── InMemoryRepository (testing) ─────────────────────────────────────┐ │
│  │                                                                      │ │
│  │  Storage: Map<string, Map<string, StoredResource>>                   │ │
│  │  Key: `${endpointId}:${resourceType}:${scimId}`                     │ │
│  │                                                                      │ │
│  │  Pros: Zero setup, instant tests, no DB mocking                     │ │
│  │  Cons: No persistence across restarts                                │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─── MongoRepository (document-native option) ─────────────────────────┐ │
│  │                                                                      │ │
│  │  Collection: scim_resources                                          │ │
│  │  Document: StoredResource directly (no serialization overhead)       │ │
│  │  Indexes: compound on endpointId + resourceType + scimId            │ │
│  │                                                                      │ │
│  │  Pros: Natural fit for SCIM's document model, schema-less           │ │
│  │  Cons: Additional infrastructure                                     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  Selection via NestJS DI:                                                 │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  // app.module.ts                                                  │   │
│  │  {                                                                 │   │
│  │    provide: 'ScimResourceRepository',                              │   │
│  │    useClass: process.env.DB_PROVIDER === 'postgres'                │   │
│  │      ? PostgresJsonRepository                                      │   │
│  │      : PrismaDocumentRepository,                                   │   │
│  │  }                                                                 │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Schema Storage Repository

Schemas themselves need a repository to support per-endpoint customization:

```typescript
/**
 * SchemaStorageRepository: persistence for schema definitions.
 * Separate from resource storage because:
 *   1. Schemas are read on every request (cache-friendly)
 *   2. Schemas change rarely (different write pattern)
 *   3. Schemas drive behavior — they are configuration, not data
 */
export interface SchemaStorageRepository {
  /** Get all schemas for an endpoint. */
  findAll(endpointId: string): Promise<SchemaDefinition[]>;

  /** Get a specific schema by URI. */
  findByUri(endpointId: string, uri: string): Promise<SchemaDefinition | null>;

  /** Store or replace a schema for an endpoint. */
  upsert(endpointId: string, schema: SchemaDefinition): Promise<void>;

  /** Remove a schema from an endpoint. */
  delete(endpointId: string, uri: string): Promise<void>;

  /** Get all resource types for an endpoint. */
  findResourceTypes(endpointId: string): Promise<ResourceTypeDef[]>;

  /** Store or replace a resource type for an endpoint. */
  upsertResourceType(endpointId: string, rt: ResourceTypeDef): Promise<void>;
}
```

### 5.5 Unified DB Schema (Recommended for New Implementations)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  RECOMMENDED DB SCHEMA (PostgreSQL example)                               │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  endpoints                          endpoint_schemas                      │
│  ┌──────────────────────┐          ┌──────────────────────────┐          │
│  │ id (PK)              │ 1──┐     │ id (PK)                  │          │
│  │ name (unique)        │    │     │ endpoint_id (FK)         │          │
│  │ display_name         │    ├────►│ schema_uri               │          │
│  │ config (JSONB)       │    │     │ definition (JSONB)       │          │
│  │ active               │    │     │ @@unique([endpoint_id,   │          │
│  │ created_at           │    │     │          schema_uri])     │          │
│  │ updated_at           │    │     └──────────────────────────┘          │
│  └──────────────────────┘    │                                           │
│                               │     endpoint_resource_types              │
│                               │     ┌──────────────────────────┐         │
│                               │     │ id (PK)                  │         │
│                               ├────►│ endpoint_id (FK)         │         │
│                               │     │ name                     │         │
│                               │     │ endpoint_path            │         │
│                               │     │ schema_uri               │         │
│                               │     │ extensions (JSONB)       │         │
│                               │     │ @@unique([endpoint_id,   │         │
│                               │     │          name])          │         │
│                               │     └──────────────────────────┘         │
│                               │                                          │
│                               │     scim_resources                       │
│                               │     ┌──────────────────────────┐         │
│                               │     │ id (PK, UUID)            │         │
│                               ├────►│ endpoint_id (FK)         │         │
│                                     │ resource_type            │         │
│                                     │ scim_id (UUID)           │         │
│                                     │ document (JSONB)         │         │
│                                     │ created_at               │         │
│                                     │ updated_at               │         │
│                                     │ version (int)            │         │
│                                     │                          │         │
│                                     │ -- Queryable projections │         │
│                                     │ -- (auto-extracted from  │         │
│                                     │ --  document on write)   │         │
│                                     │ idx_attr_1 TEXT          │         │
│                                     │ idx_attr_2 TEXT          │         │
│                                     │ idx_attr_3 TEXT          │         │
│                                     │                          │         │
│                                     │ @@unique([endpoint_id,   │         │
│                                     │   resource_type, scim_id])│        │
│                                     │ @@index(document GIN)    │         │
│                                     └──────────────────────────┘         │
│                                                                          │
│  KEY DESIGN DECISIONS:                                                   │
│                                                                          │
│  1. Single scim_resources table for ALL resource types                   │
│     (User, Group, Device, anything). No per-type tables.                │
│     SELECT * WHERE endpoint_id = ? AND resource_type = 'User'           │
│                                                                          │
│  2. document (JSONB) stores the full SCIM resource.                      │
│     No rawPayload splitting. One complete document.                      │
│     Members stored INSIDE the group document.                            │
│                                                                          │
│  3. endpoint_schemas stores schema definitions per-endpoint.             │
│     On create, populated from bundled defaults.                          │
│     Admin can override per endpoint.                                     │
│                                                                          │
│  4. endpoint_resource_types stores registered resource types.            │
│     Default: User + Group. Custom types added per-endpoint.              │
│                                                                          │
│  5. No separate GroupMember join table.                                   │
│     Members are part of the Group document:                              │
│     { "members": [{ "value": "...", "display": "..." }] }              │
│     Eliminates the delete-all-recreate PATCH pattern.                    │
│     Trade-off: "list all groups containing user X" requires              │
│     document query instead of FK join (acceptable for test server).      │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Recommendation #3 — Config-Driven Discovery Layer

> **Principles**: #3 (Discovery Drives the Contract), #4 (Multi-Tenancy is URL-Based)

### 6.1 The Problem — Static Discovery

All discovery endpoints return identical hardcoded JSON regardless of endpoint configuration. See §2A, §2B, §2C for the detailed audit. The core issue: discovery doesn't reflect reality.

### 6.2 The Design — Discovery Generated from Registry

```
┌───────────────────────────────────────────────────────────────────────────┐
│  DISCOVERY: Generated from Live State, Per Endpoint                       │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  GET /endpoints/acme-corp/Schemas                                        │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ handler(endpointId):                                               │   │
│  │   schemas = await schemaRegistry.getSchemasForEndpoint(endpointId) │   │
│  │   return { schemas: [LIST_RESPONSE_SCHEMA],                        │   │
│  │     totalResults: schemas.length,                                  │   │
│  │     Resources: schemas }                                           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│  → Response varies per endpoint. acme-corp sees enterprise schema.       │
│  → contoso sees only core schemas. truthful.                             │
│                                                                           │
│  GET /endpoints/acme-corp/ResourceTypes                                  │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ handler(endpointId):                                               │   │
│  │   types = await resourceTypeRegistry.getResourceTypes(endpointId)  │   │
│  │   return { schemas: [LIST_RESPONSE_SCHEMA],                        │   │
│  │     totalResults: types.length,                                    │   │
│  │     Resources: types.map(toResourceTypeJson) }                     │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│  → acme-corp shows User + Group + Device. contoso shows User + Group.    │
│                                                                           │
│  GET /endpoints/acme-corp/ServiceProviderConfig                          │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ handler(endpointId, config):                                       │   │
│  │   return {                                                         │   │
│  │     schemas: [SP_CONFIG_SCHEMA],                                   │   │
│  │     documentationUri: config.documentationUri,                     │   │
│  │     patch: { supported: true },                                    │   │
│  │     bulk: { supported: false,                                      │   │
│  │       maxOperations: 0, maxPayloadSize: 0 },                      │   │
│  │     filter: { supported: true,                                     │   │
│  │       maxResults: config.filterMaxResults ?? 200 },                │   │
│  │     changePassword: { supported: false },                          │   │
│  │     sort: { supported: false },                                    │   │
│  │     etag: { supported: true },                                     │   │
│  │     authenticationSchemes: [...],                                  │   │
│  │     meta: {                                                        │   │
│  │       location: `/endpoints/${endpointId}/ServiceProviderConfig`,  │   │
│  │       resourceType: 'ServiceProviderConfig',                       │   │
│  │     },                                                             │   │
│  │   }                                                                │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│  → Correct per RFC 7644 §4. Meta present. Bulk fields complete.          │
│  → Config-driven filter.maxResults, documentationUri.                    │
└───────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Complete Client Discovery Flow

```http
# Step 1: Client discovers capabilities
GET /endpoints/acme-corp/ServiceProviderConfig HTTP/1.1
Host: scimserver.example.com
```

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "documentationUri": "https://scimserver.example.com/docs",
  "patch": { "supported": true },
  "bulk": { "supported": false, "maxOperations": 0, "maxPayloadSize": 0 },
  "filter": { "supported": true, "maxResults": 200 },
  "changePassword": { "supported": false },
  "sort": { "supported": false },
  "etag": { "supported": true },
  "authenticationSchemes": [{
    "type": "oauthbearertoken",
    "name": "OAuth Bearer Token",
    "description": "Authentication using OAuth Bearer Token Standard",
    "specUri": "https://www.rfc-editor.org/info/rfc6750"
  }],
  "meta": {
    "location": "/endpoints/acme-corp/ServiceProviderConfig",
    "resourceType": "ServiceProviderConfig"
  }
}
```

```http
# Step 2: Client discovers resource types
GET /endpoints/acme-corp/ResourceTypes HTTP/1.1
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 3,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      "id": "User",
      "name": "User",
      "description": "User Account",
      "endpoint": "/Users",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
      "schemaExtensions": [
        { "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
          "required": false }
      ],
      "meta": {
        "location": "/endpoints/acme-corp/ResourceTypes/User",
        "resourceType": "ResourceType"
      }
    },
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      "id": "Group",
      "name": "Group",
      "endpoint": "/Groups",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:Group",
      "schemaExtensions": [],
      "meta": {
        "location": "/endpoints/acme-corp/ResourceTypes/Group",
        "resourceType": "ResourceType"
      }
    },
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      "id": "Device",
      "name": "Device",
      "endpoint": "/Devices",
      "schema": "urn:myorg:scim:schemas:core:2.0:Device",
      "schemaExtensions": [],
      "meta": {
        "location": "/endpoints/acme-corp/ResourceTypes/Device",
        "resourceType": "ResourceType"
      }
    }
  ]
}
```

```http
# Step 3: Client discovers schemas (gets full attribute definitions)
GET /endpoints/acme-corp/Schemas/urn:ietf:params:scim:schemas:core:2.0:User HTTP/1.1
```

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
  "id": "urn:ietf:params:scim:schemas:core:2.0:User",
  "name": "User",
  "description": "User Account",
  "attributes": [
    {
      "name": "userName",
      "type": "string",
      "multiValued": false,
      "required": true,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "always",
      "uniqueness": "server"
    },
    {
      "name": "password",
      "type": "string",
      "multiValued": false,
      "required": false,
      "mutability": "writeOnly",
      "returned": "never",
      "uniqueness": "none"
    }
  ],
  "meta": {
    "location": "/endpoints/acme-corp/Schemas/urn:ietf:params:scim:schemas:core:2.0:User",
    "resourceType": "Schema"
  }
}
```

```http
# Step 4: Client creates a user — engine uses schema to validate
POST /endpoints/acme-corp/Users HTTP/1.1
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User",
              "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
  "userName": "bjensen@example.com",
  "id": "should-be-ignored",
  "password": "s3cr3t",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering"
  }
}
```

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "userName": "bjensen@example.com",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering"
  },
  "meta": {
    "resourceType": "User",
    "created": "2026-02-17T12:00:00Z",
    "lastModified": "2026-02-17T12:00:00Z",
    "location": "/endpoints/acme-corp/Users/2819c223-7f76-453a-919d-413861904646",
    "version": "W/\"a330bc54f0671c9\""
  }
}
```

Notice:
- `"id": "should-be-ignored"` was stripped (mutability: readOnly — schema says ignore on POST)
- `"password"` was stored but **not returned** (returned: "never")
- `schemas[]` array includes enterprise URN (engine detected extension data)
- `meta` was server-generated (mutability: readOnly)

### 6.4 Wire Dead Config Flags to Discovery

```
┌────────────────────────────────────────────────────────────────────────┐
│  Dead Flags → Wired to Discovery + Engine                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  includeEnterpriseSchema (currently dead):                             │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  When true:                                                      │ │
│  │  → SchemaRegistry includes enterprise schema for this endpoint   │ │
│  │  → ResourceTypeRegistry adds enterprise to schemaExtensions[]    │ │
│  │  → Engine adds enterprise URN to schemas[] when data present     │ │
│  │  When false:                                                     │ │
│  │  → Enterprise schema not in /Schemas response                    │ │
│  │  → Not in /ResourceTypes schemaExtensions                        │ │
│  │  → Enterprise data still STORED (rawPayload) but URN not in      │ │
│  │    schemas[] and enterprise schema not in discovery               │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  excludeMeta (currently dead):                                         │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  When true → Engine omits "meta" from all responses              │ │
│  │  (Useful for testing IdP behavior with missing meta)             │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  excludeSchemas (currently dead):                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  When true → Engine omits "schemas" from all responses           │ │
│  │  (Useful for testing IdP behavior with missing schemas)          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  customSchemaUrn (currently dead):                                     │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  When set → SchemaRegistry replaces "urn:ietf:params:scim"      │ │
│  │  prefix with custom URN                                          │ │
│  │  (Useful for testing non-standard IdP implementations)           │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  customHeaders (currently dead):                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  When set → Interceptor adds headers to every response           │ │
│  │  for this endpoint (e.g., X-Rate-Limit, custom CORS)            │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Implementation Priority Matrix

### 7.1 Phased Migration — From Current to Target

```
┌───────────────────────────────────────────────────────────────────────────┐
│                  PHASED MIGRATION PLAN                                     │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Phase 0: Foundation (non-breaking)               Effort: ~2 days        │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  • Create interface files: ScimResourceRepository,                  │ │
│  │    SchemaDefinition, AttributeDefinition, ResourceTypeDef           │ │
│  │  • Ship bundled schema JSON files (core-user, core-group,           │ │
│  │    enterprise-user, service-provider-config)                        │ │
│  │  • Add SCIM_ENTERPRISE_USER_SCHEMA constant                         │ │
│  │  • NO behavioral changes yet — just adding new code alongside old   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                      │                                                    │
│                      ▼                                                    │
│  Phase 1: Repository Abstraction                  Effort: ~3 days        │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  • Implement PrismaDocumentRepository (wraps current Prisma)        │ │
│  │  • Implement InMemoryRepository (for testing)                       │ │
│  │  • Wire via NestJS DI injection token                               │ │
│  │  • Migrate UsersService to use repository interface                 │ │
│  │  • Migrate GroupsService to use repository interface                │ │
│  │  • Remove direct Prisma imports from services                       │ │
│  │  • All existing tests must still pass                               │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                      │                                                    │
│                      ▼                                                    │
│  Phase 2: Schema Registry + Discovery             Effort: ~3 days        │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  • Implement SchemaRegistry (loads from DB with bundled fallbacks)   │ │
│  │  • Implement SchemaStorageRepository                                │ │
│  │  • Add endpoint_schemas + endpoint_resource_types tables            │ │
│  │  • Rewrite discovery controllers to read from registries            │ │
│  │  • Fix ServiceProviderConfig (add missing RFC fields)               │ │
│  │  • Wire includeEnterpriseSchema flag → registry                     │ │
│  │  • Wire schemas[] array → built from registry                       │ │
│  │  • Add admin API for per-endpoint schema management                 │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                      │                                                    │
│                      ▼                                                    │
│  Phase 3: Schema-Driven Engine                    Effort: ~5 days        │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  • Implement ScimResourceEngine (generic CRUD)                      │ │
│  │  • Schema-driven validation (required, mutability, uniqueness)      │ │
│  │  • Schema-driven response shaping (returned rules)                  │ │
│  │  • Schema-driven PATCH (path validation, type coercion)             │ │
│  │  • Schema-driven filtering (caseExact governs comparison)           │ │
│  │  • Replace UsersService + GroupsService with single engine          │ │
│  │  • Implement GenericScimController (single controller, all types)   │ │
│  │  • Wire dead config flags (excludeMeta, excludeSchemas, etc.)       │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                      │                                                    │
│                      ▼                                                    │
│  Phase 4: Advanced Features (optional)            Effort: ~3 days        │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  • Custom resource type registration per endpoint                   │ │
│  │  • PostgreSQL repository implementation                             │ │
│  │  • JSONB filter push-down for all attributes                        │ │
│  │  • Bulk operations (RFC 7644 §3.7)                                  │ │
│  │  • Sort support (RFC 7644 §3.4.2.3)                                 │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  Total estimated effort: ~16 days                                        │
│  (Phase 0-2 can be done incrementally with zero breaking changes)        │
└───────────────────────────────────────────────────────────────────────────┘
```

### 7.2 File Changes Per Phase

| Phase | New Files | Modified Files | Deleted Files |
|-------|-----------|---------------|---------------|
| **0** | `interfaces/repository.ts`, `interfaces/schema.ts`, `interfaces/resource-type.ts`, `schemas/*.json` (4 files) | `scim-constants.ts` (+1 constant) | — |
| **1** | `repositories/prisma-document.repository.ts`, `repositories/in-memory.repository.ts` | `endpoint-scim-users.service.ts`, `endpoint-scim-groups.service.ts`, `scim.module.ts` | — |
| **2** | `registries/schema.registry.ts`, `registries/resource-type.registry.ts`, `repositories/schema-storage.repository.ts` | `endpoint-scim-discovery.controller.ts`, `schemas.controller.ts`, `resource-types.controller.ts`, `service-provider-config.controller.ts`, `schema.prisma` (+2 tables) | — |
| **3** | `engine/scim-resource.engine.ts`, `controllers/generic-scim.controller.ts` | `scim.module.ts` | (Optional) `endpoint-scim-users.service.ts`, `endpoint-scim-groups.service.ts` replaced by engine |
| **4** | `repositories/postgres-json.repository.ts` | `scim.module.ts` | — |

### 7.3 File Structure (Target)

```
api/src/modules/scim/
├── engine/
│   └── scim-resource.engine.ts          ← Generic CRUD (~400 lines)
├── registries/
│   ├── schema.registry.ts               ← Per-endpoint schema resolution
│   └── resource-type.registry.ts        ← Per-endpoint resource type registration
├── repositories/
│   ├── scim-resource.repository.ts      ← Interface definition
│   ├── schema-storage.repository.ts     ← Interface for schema persistence
│   ├── prisma-document.repository.ts    ← SQLite/Prisma implementation
│   ├── postgres-json.repository.ts      ← PostgreSQL/JSONB implementation
│   └── in-memory.repository.ts          ← Testing implementation
├── schemas/
│   ├── core-user.schema.json            ← RFC 7643 §4.1 (bundled default)
│   ├── core-group.schema.json           ← RFC 7643 §4.2 (bundled default)
│   ├── enterprise-user.schema.json      ← RFC 7643 §4.3 (bundled default)
│   └── service-provider-config.schema.json
├── interfaces/
│   ├── schema.interface.ts              ← SchemaDefinition, AttributeDefinition
│   ├── resource-type.interface.ts       ← ResourceTypeDef
│   └── stored-resource.interface.ts     ← StoredResource
├── controllers/
│   ├── generic-scim.controller.ts       ← Single controller for ALL resource types
│   ├── discovery.controller.ts          ← Per-endpoint /Schemas, /ResourceTypes, /SPC
│   └── admin.controller.ts              ← Schema/ResourceType management
├── filters/
│   ├── scim-filter-parser.ts            ← (kept — already good)
│   └── scim-exception.filter.ts         ← (kept — already good)
├── common/
│   ├── scim-constants.ts
│   ├── scim-types.ts
│   └── scim-errors.ts
└── scim.module.ts
```

### 7.4 Verification Checklist

```
┌────────────────────────────────────────────────────────────────────────┐
│  ARCHITECTURE VERIFICATION                                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Principle #1 — Schema is Source of Truth:                             │
│  ☐ Attribute validation reads from SchemaDefinition, not hardcoded    │
│  ☐ PATCH mutability check reads from attrDef.mutability               │
│  ☐ Response shaping reads from attrDef.returned                       │
│  ☐ Filter comparison reads from attrDef.caseExact                     │
│  ☐ Required check reads from attrDef.required                         │
│  ☐ Uniqueness check reads from attrDef.uniqueness                     │
│  ☐ normalizeObjectKeys map is ELIMINATED                              │
│                                                                        │
│  Principle #2 — Resource Types Pluggable:                              │
│  ☐ POST /admin/endpoints/:id/resourcetypes adds new type              │
│  ☐ CRUD immediately works for new type via GenericScimController      │
│  ☐ /ResourceTypes reflects new type                                    │
│  ☐ Other endpoints UNAFFECTED                                          │
│                                                                        │
│  Principle #3 — Discovery Drives Contract:                             │
│  ☐ /Schemas generated from SchemaRegistry per endpoint                │
│  ☐ /ResourceTypes generated from ResourceTypeRegistry per endpoint    │
│  ☐ /ServiceProviderConfig has all RFC fields, config-aware            │
│  ☐ Different endpoints → different discovery responses                 │
│                                                                        │
│  Principle #4 — Multi-Tenancy URL-Based:                               │
│  ☐ All CRUD at /endpoints/:endpointId/:resourceType                   │
│  ☐ Data isolated per endpoint (existing — already works)              │
│  ☐ Schemas isolated per endpoint (NEW)                                 │
│  ☐ Resource types isolated per endpoint (NEW)                          │
│                                                                        │
│  Principle #7 — Simplicity Through Generalization:                     │
│  ☐ Single ScimResourceEngine replaces 2 services (~1400L → ~400L)     │
│  ☐ Single GenericScimController replaces 2 controllers                │
│  ☐ ZERO hardcoded attribute names in engine                            │
│  ☐ Adding a resource type = data operation, not code change            │
│                                                                        │
│  Persistence Abstraction:                                              │
│  ☐ Engine imports ZERO Prisma types                                    │
│  ☐ Switching DB = new repository class + DI binding                    │
│  ☐ InMemoryRepository passes all unit tests                            │
│  ☐ PostgresJsonRepository passes all integration tests                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 8. References

| Document | Link |
| -------- | ---- |
| RFC 7642 — SCIM Definitions, Overview, Concepts | https://datatracker.ietf.org/doc/html/rfc7642 |
| RFC 7643 — SCIM Core Schema | https://datatracker.ietf.org/doc/html/rfc7643 |
| RFC 7643 §2.2 — Attribute Characteristics | https://datatracker.ietf.org/doc/html/rfc7643#section-2.2 |
| RFC 7643 §3.1 — schemas attribute | https://datatracker.ietf.org/doc/html/rfc7643#section-3.1 |
| RFC 7643 §3.2 — Resource Types | https://datatracker.ietf.org/doc/html/rfc7643#section-3.2 |
| RFC 7643 §3.3 — Schema Extensions | https://datatracker.ietf.org/doc/html/rfc7643#section-3.3 |
| RFC 7643 §4.3 — Enterprise User | https://datatracker.ietf.org/doc/html/rfc7643#section-4.3 |
| RFC 7643 §7 — Schema Definition | https://datatracker.ietf.org/doc/html/rfc7643#section-7 |
| RFC 7643 §8.7 — ResourceType | https://datatracker.ietf.org/doc/html/rfc7643#section-8.7 |
| RFC 7644 — SCIM Protocol | https://datatracker.ietf.org/doc/html/rfc7644 |
| RFC 7644 §3.4.2 — Filtering | https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2 |
| RFC 7644 §3.5.1 — PUT (Replace) | https://datatracker.ietf.org/doc/html/rfc7644#section-3.5.1 |
| RFC 7644 §3.5.2 — PATCH | https://datatracker.ietf.org/doc/html/rfc7644#section-3.5.2 |
| RFC 7644 §3.7 — Bulk Operations | https://datatracker.ietf.org/doc/html/rfc7644#section-3.7 |
| RFC 7644 §3.12 — Error Responses | https://datatracker.ietf.org/doc/html/rfc7644#section-3.12 |
| RFC 7644 §4 — Discovery Endpoints | https://datatracker.ietf.org/doc/html/rfc7644#section-4 |
| RFC 7644 §6 — Multi-Tenancy | https://datatracker.ietf.org/doc/html/rfc7644#section-6 |
| SQLite json_extract | https://www.sqlite.org/json1.html#jex |
| PostgreSQL JSONB | https://www.postgresql.org/docs/current/functions-json.html |
| Repository Pattern | https://martinfowler.com/eaaCatalog/repository.html |
| Microsoft Entra SCIM | https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups |

---

### Key Source Files Referenced (Current)

| File | Purpose | Lines |
| ---- | ------- | ----- |
| `api/src/modules/scim/services/endpoint-scim-users.service.ts` | User CRUD, hardcoded attr handling | 657 |
| `api/src/modules/scim/services/endpoint-scim-groups.service.ts` | Group CRUD, member management | 765 |
| `api/src/modules/scim/utils/scim-patch-path.ts` | `KNOWN_EXTENSION_URNS`, extension path parsing | 418 |
| `api/src/modules/scim/common/scim-constants.ts` | Schema URI constants | 41 |
| `api/src/modules/scim/common/scim-types.ts` | `ScimUserResource` interface | 53 |
| `api/src/modules/scim/controllers/schemas.controller.ts` | Hardcoded `/Schemas` | 130 |
| `api/src/modules/scim/controllers/resource-types.controller.ts` | Hardcoded `/ResourceTypes` | 35 |
| `api/src/modules/scim/controllers/service-provider-config.controller.ts` | Hardcoded `/ServiceProviderConfig` | 31 |
| `api/src/modules/scim/controllers/endpoint-scim-discovery.controller.ts` | Per-endpoint hardcoded discovery | 284 |
| `api/src/modules/scim/filters/apply-scim-filter.ts` | Filter DB push-down | 200 |
| `api/src/modules/scim/filters/scim-filter-parser.ts` | RFC 7644 filter ABNF parser | 544 |
| `api/src/modules/endpoint/endpoint-config.interface.ts` | All 12 config flags (5 live, 7 dead) | 338 |
| `api/src/modules/endpoint/endpoint-context.storage.ts` | AsyncLocalStorage per-request context | 57 |
| `api/prisma/schema.prisma` | DB models (5 tables) | 114 |

---

> *Generated from full codebase audit on February 17, 2026 (v3 — unconstrained architecture).*
> *All findings verified against actual source code with exact line numbers.*
> *Analysis grounded in Three-Pillar RFC framework: RFC 7642 + RFC 7643 + RFC 7644.*
> *Architecture designed per seven core principles derived from RFCs.*
