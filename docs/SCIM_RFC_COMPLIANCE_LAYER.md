# 🏗️ SCIM 2.0 RFC Compliance Layer — Comprehensive Technical Reference

> **Version:** 2.1  
> **Date:** February 13, 2026  
> **Applies to:** SCIMServer API  
> **RFC References:** [RFC 7643](https://datatracker.ietf.org/doc/html/rfc7643) (Core Schema), [RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644) (Protocol), [RFC 7642](https://datatracker.ietf.org/doc/html/rfc7642) (Concepts)

---

## 📋 Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [AST Filter Parser (RFC 7644 §3.4.2.2)](#2-ast-filter-parser-rfc-7644-3422)
3. [Filter Application & DB Push-Down](#3-filter-application--db-push-down)
4. [Attribute Projection (RFC 7644 §3.4.2.5)](#4-attribute-projection-rfc-7644-3425)
5. [ETag & Conditional Requests (RFC 7644 §3.14)](#5-etag--conditional-requests-rfc-7644-314)
6. [POST /.search (RFC 7644 §3.4.3)](#6-post-search-rfc-7644-343)
7. [Content-Type & Response Headers (RFC 7644 §3.1)](#7-content-type--response-headers-rfc-7644-31)
8. [SCIM Error Responses (RFC 7644 §3.12)](#8-scim-error-responses-rfc-7644-312)
9. [PATCH Operations (RFC 7644 §3.5.2)](#9-patch-operations-rfc-7644-352)
10. [Case-Insensitivity (RFC 7643 §2.1)](#10-case-insensitivity-rfc-7643-21)
11. [Discovery Endpoints (RFC 7644 §4)](#11-discovery-endpoints-rfc-7644-4)
12. [Module Wiring & Interceptor Pipeline](#12-module-wiring--interceptor-pipeline)
13. [Legacy Code Cleanup Summary](#13-legacy-code-cleanup-summary)
14. [Complete Request/Response Examples](#14-complete-requestresponse-examples)

---

## 1. Architecture Overview

### 1.1 High-Level Request Flow

```
┌────────────┐    ┌──────────────────────────────────────────────────────────────────┐
│  HTTP      │    │  NestJS Pipeline                                                 │
│  Client    │    │                                                                   │
│ (Entra ID, │───▶│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  Okta,     │    │  │ ScimException│  │ ScimContentType  │  │ ScimEtag         │   │
│  curl)     │◀───│  │ Filter       │  │ Interceptor      │  │ Interceptor      │   │
│            │    │  │ (errors)     │  │ (Content-Type +  │  │ (ETag + 304)     │   │
└────────────┘    │  │              │  │  Location header) │  │                  │   │
                  │  └──────┬───────┘  └────────┬─────────┘  └────────┬─────────┘   │
                  │         │                   │                      │              │
                  │         ▼                   ▼                      ▼              │
                  │  ┌──────────────────────────────────────────────────────────┐     │
                  │  │                    Controller Layer                       │     │
                  │  │  EndpointScimUsersController / EndpointScimGroupsController│    │
                  │  │  • validateAndSetContext(endpointId)                      │     │
                  │  │  • Attribute Projection (applyAttributeProjection)        │     │
                  │  │  • POST /.search handler                                 │     │
                  │  └────────────────────────┬─────────────────────────────────┘     │
                  │                           │                                       │
                  │                           ▼                                       │
                  │  ┌──────────────────────────────────────────────────────────┐     │
                  │  │                    Service Layer                          │     │
                  │  │  EndpointScimUsersService / EndpointScimGroupsService     │     │
                  │  │  • AST Filter Parsing → DB Push-Down / In-Memory Eval    │     │
                  │  │  • PATCH path resolution (valuePath, extension URN)       │     │
                  │  │  • CRUD operations on Prisma models                      │     │
                  │  └────────────────────────┬─────────────────────────────────┘     │
                  │                           │                                       │
                  │                           ▼                                       │
                  │  ┌──────────────────────────────────────────────────────────┐     │
                  │  │                  Data Layer (Prisma + SQLite)             │     │
                  │  │  ScimUser / ScimGroup tables                             │     │
                  │  │  • userNameLower column for case-insensitive lookups      │     │
                  │  │  • rawPayload JSON for flexible schema storage           │     │
                  │  └──────────────────────────────────────────────────────────┘     │
                  └──────────────────────────────────────────────────────────────────┘
```

### 1.2 File Structure

```
api/src/modules/scim/
├── scim.module.ts                          # Module wiring — registers all providers + interceptors
├── common/
│   ├── scim-constants.ts                   # URN schemas, default counts, error types
│   ├── scim-types.ts                       # TypeScript interfaces (ScimUserResource, etc.)
│   ├── scim-errors.ts                      # createScimError() — RFC 7644 §3.12
│   └── scim-attribute-projection.ts        # RFC 7644 §3.4.2.5 — attributes/excludedAttributes
├── controllers/
│   ├── endpoint-scim-users.controller.ts   # POST, GET, PUT, PATCH, DELETE /Users + POST /.search
│   ├── endpoint-scim-groups.controller.ts  # POST, GET, PUT, PATCH, DELETE /Groups + POST /.search
│   ├── service-provider-config.controller.ts # /ServiceProviderConfig
│   ├── resource-types.controller.ts        # /ResourceTypes
│   ├── schemas.controller.ts               # /Schemas
│   └── endpoint-scim-discovery.controller.ts
├── dto/
│   ├── create-user.dto.ts
│   ├── patch-user.dto.ts
│   ├── create-group.dto.ts
│   ├── patch-group.dto.ts
│   └── search-request.dto.ts              # SearchRequestDto for POST /.search
├── filters/
│   ├── scim-filter-parser.ts              # Full AST parser (tokenizer + recursive descent)
│   ├── scim-filter-parser.spec.ts         # Unit tests for AST parser
│   ├── apply-scim-filter.ts              # Bridge: AST → Prisma where / in-memory eval
│   ├── scim-exception.filter.ts          # Global SCIM error formatter
│   └── scim-exception.filter.spec.ts
├── interceptors/
│   ├── scim-content-type.interceptor.ts  # Sets Content-Type + Location header
│   ├── scim-etag.interceptor.ts          # ETag header + If-None-Match → 304
│   └── *.spec.ts
├── services/
│   ├── endpoint-scim-users.service.ts    # User CRUD + PATCH + filter integration
│   ├── endpoint-scim-groups.service.ts   # Group CRUD + membership management
│   └── scim-metadata.service.ts          # Location URL builder + timestamps
└── utils/
    ├── scim-patch-path.ts                # valuePath, extension URN, no-path resolution
    └── scim-patch-path.spec.ts
```

---

## 2. AST Filter Parser (RFC 7644 §3.4.2.2)

### 2.1 Overview

The filter parser implements the **complete SCIM filter grammar** from [RFC 7644 §3.4.2.2](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2) using a classic **tokenizer → recursive descent parser → AST** architecture. It replaces a legacy regex-based approach that could only handle simple `attr eq "value"` expressions.

### 2.2 ABNF Grammar (RFC 7644)

```abnf
FILTER    = attrExp / logExp / valuePath / *1"not" "(" FILTER ")"
logExp    = FILTER SP ("and" / "or") SP FILTER
attrExp   = attrPath SP compareOp SP compValue
attrExp   =/ attrPath SP "pr"
valuePath = attrPath "[" valFilter "]"
compValue = false / null / true / number / string
compareOp = "eq" / "ne" / "co" / "sw" / "ew" / "gt" / "ge" / "lt" / "le"
```

### 2.3 Three-Phase Pipeline

```
                        ┌───────────────────────────┐
  Filter String         │      1. TOKENIZER          │
  ─────────────────────▶│  Lexical analysis          │
  userName eq "john"    │  → Token[]                 │
                        └─────────────┬─────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │  2. RECURSIVE DESCENT       │
                        │     PARSER                  │
                        │  Precedence: OR < AND       │
                        │  → FilterNode (AST)         │
                        └─────────────┬─────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │  3. AST EVALUATOR           │
                        │  evaluateFilter(ast, obj)   │
                        │  → boolean                  │
                        └─────────────────────────────┘
```

### 2.4 AST Node Types

The parser produces a discriminated union of four node types:

```typescript
/** Comparison: attrPath op compValue  |  attrPath pr */
interface CompareNode {
  type: 'compare';
  attrPath: string;       // e.g., "userName", "name.givenName"
  op: ScimCompareOp;      // "eq" | "ne" | "co" | "sw" | "ew" | "gt" | "ge" | "lt" | "le" | "pr"
  value?: string | number | boolean | null;
}

/** Logical: left AND/OR right */
interface LogicalNode {
  type: 'logical';
  op: 'and' | 'or';
  left: FilterNode;
  right: FilterNode;
}

/** NOT: not (filter) */
interface NotNode {
  type: 'not';
  filter: FilterNode;
}

/** Value path: attrPath[valFilter] — e.g., emails[type eq "work"] */
interface ValuePathNode {
  type: 'valuePath';
  attrPath: string;
  filter: FilterNode;
}

type FilterNode = CompareNode | LogicalNode | NotNode | ValuePathNode;
```

### 2.5 Tokenizer Details

The tokenizer converts raw filter strings into a flat list of typed tokens:

| Token Type | Examples | Notes |
|------------|----------|-------|
| `ATTR` | `userName`, `name.givenName`, `urn:...:User:dept` | URN paths with colons supported |
| `OP` | `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `ge`, `lt`, `le` | Case-insensitive |
| `PR` | `pr` | Presence operator |
| `AND` / `OR` / `NOT` | `and`, `or`, `not` | Logical keywords (case-insensitive) |
| `STRING` | `"john"` | Supports escape sequences `\"` |
| `NUMBER` | `42`, `-3.14` | Integer and decimal |
| `BOOLEAN` | `true`, `false` | |
| `NULL` | `null` | |
| `LPAREN` / `RPAREN` | `(`, `)` | Grouping |
| `LBRACKET` / `RBRACKET` | `[`, `]` | Value path filters |

### 2.6 Parser Precedence Rules

The recursive descent parser enforces correct operator precedence:

```
Lowest precedence:   OR   (evaluated last)
                     AND  (evaluated before OR)
Highest precedence:  NOT, parentheses, atoms  (evaluated first)
```

**Grammar rules:**
```
filter     → orExpr
orExpr     → andExpr ("or" andExpr)*
andExpr    → primary ("and" primary)*
primary    → "not" "(" filter ")"
           | "(" filter ")"
           | attrExpr
attrExpr   → attrPath "[" filter "]"       // value path
           | attrPath "pr"                  // presence
           | attrPath compareOp compValue   // comparison
```

### 2.7 AST Examples

#### Simple Equality

```
Input:  userName eq "john"

AST:
  ┌──────────────┐
  │ CompareNode   │
  │ attrPath: "userName"
  │ op: "eq"     │
  │ value: "john"│
  └──────────────┘
```

#### Compound AND/OR

```
Input:  name.familyName co "doe" and active eq true or userName sw "admin"

AST:
              ┌───────────┐
              │ LogicalNode│
              │ op: "or"   │
              └──┬──────┬──┘
                 │      │
    ┌────────────▼┐  ┌──▼───────────┐
    │ LogicalNode  │  │ CompareNode   │
    │ op: "and"    │  │ userName sw   │
    └──┬────────┬──┘  │ "admin"       │
       │        │     └───────────────┘
  ┌────▼─────┐ ┌▼────────────┐
  │ Compare   │ │ CompareNode  │
  │ name.     │ │ active eq    │
  │ familyName│ │ true         │
  │ co "doe"  │ └──────────────┘
  └──────────┘
```

#### Value Path

```
Input:  emails[type eq "work" and value co "@example.com"]

AST:
  ┌───────────────────┐
  │ ValuePathNode       │
  │ attrPath: "emails"  │
  │ filter:             │
  │  ┌───────────┐     │
  │  │LogicalNode│     │
  │  │ op: "and" │     │
  │  └─┬──────┬──┘     │
  │    │      │        │
  │  ┌─▼──┐ ┌▼───────┐│
  │  │type │ │value co ││
  │  │eq   │ │@example ││
  │  │work │ │.com     ││
  │  └─────┘ └─────────┘│
  └───────────────────────┘
```

#### NOT Expression

```
Input:  not (active eq false)

AST:
  ┌──────────┐
  │ NotNode   │
  │ filter:   │
  │ ┌────────┤
  │ │Compare │
  │ │active  │
  │ │eq false│
  │ └────────┘
  └──────────┘
```

### 2.8 Evaluator Semantics

| Operator | Description | String Comparison | Example |
|----------|-------------|-------------------|---------|
| `eq` | Equal | Case-insensitive | `userName eq "John"` matches `"john"` |
| `ne` | Not equal | Case-insensitive | `active ne true` |
| `co` | Contains | Case-insensitive | `userName co "test"` matches `"livetest"` |
| `sw` | Starts with | Case-insensitive | `userName sw "admin"` |
| `ew` | Ends with | Case-insensitive | `email ew "@test.com"` |
| `gt` | Greater than | Lexicographic / numeric | `meta.created gt "2024-01-01"` |
| `ge` | Greater or equal | Lexicographic / numeric | |
| `lt` | Less than | Lexicographic / numeric | |
| `le` | Less or equal | Lexicographic / numeric | |
| `pr` | Present | N/A | `emails pr` — true if attribute is non-null/non-empty |

**Multi-valued attribute handling:** For arrays (e.g., `emails`), the evaluator returns `true` if **any** element matches — per [RFC 7644 §3.4.2.2](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2).

**Attribute path resolution:**
- Simple: `userName` → `resource.userName`
- Dotted: `name.givenName` → `resource.name.givenName`
- URN: `urn:...:User:department` → `resource["urn:...:User"].department`
- All lookups are **case-insensitive** per RFC 7643 §2.1

---

## 3. Filter Application & DB Push-Down

### 3.1 Hybrid Strategy

The filter application layer (`apply-scim-filter.ts`) implements a hybrid DB + in-memory strategy:

```
                     ┌───────────────────────┐
  filter string ────▶│  parseScimFilter()     │
                     │  → AST (FilterNode)    │
                     └───────────┬────────────┘
                                 │
                     ┌───────────▼────────────┐
                     │  tryPushToDb()          │
                     │  Simple eq on indexed   │
                     │  columns?               │
                     └───┬─────────────┬──────┘
                    YES  │             │  NO
                     ┌───▼────┐   ┌───▼──────────────┐
                     │ Prisma  │   │ Fetch ALL records │
                     │ WHERE   │   │ from endpoint     │
                     │ clause  │   │ → evaluateFilter()│
                     └─────────┘   │   for each record │
                                   └──────────────────┘
```

### 3.2 DB Push-Down Column Mapping

**Users:**

| SCIM Attribute | Prisma Column | Notes |
|----------------|---------------|-------|
| `userName` | `userNameLower` | Lowercase for case-insensitive `eq` |
| `externalId` | `externalId` | Direct match |
| `id` | `scimId` | SCIM resource ID |

**Groups:**

| SCIM Attribute | Prisma Column | Notes |
|----------------|---------------|-------|
| `externalId` | `externalId` | Direct match |
| `id` | `scimId` | SCIM resource ID |

> **Why `displayName` is NOT pushed down:** SQLite performs case-sensitive comparisons by default. Since SCIM requires case-insensitive attribute matching (RFC 7643 §2.1), `displayName` filtering is handled in-memory where the evaluator normalizes strings.

### 3.3 Example: Push-Down vs. In-Memory

**Push-down (fast path):**
```http
GET /scim/endpoints/{id}/Users?filter=userName eq "john@example.com"
```
→ Prisma query: `WHERE userNameLower = 'john@example.com' AND endpointId = '...'`

**In-memory (complex filter):**
```http
GET /scim/endpoints/{id}/Users?filter=displayName co "test" and active eq true
```
→ Prisma query: `WHERE endpointId = '...'` (fetch all)  
→ Then: `evaluateFilter(ast, resource)` for each user

---

## 4. Attribute Projection (RFC 7644 §3.4.2.5)

### 4.1 Overview

[RFC 7644 §3.4.2.5](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.5) defines two query parameters to control which attributes appear in responses:

| Parameter | Effect | Usage |
|-----------|--------|-------|
| `attributes` | **Include only** these attributes (whitelist) | `?attributes=userName,displayName` |
| `excludedAttributes` | **Exclude** these attributes (blacklist) | `?excludedAttributes=emails,phoneNumbers` |

### 4.2 Always-Returned Attributes

Per [RFC 7643 §7](https://datatracker.ietf.org/doc/html/rfc7643#section-7), these attributes have `returned: "always"` and **cannot** be excluded:

- **`id`** — The resource identifier
- **`schemas`** — The schema URN list
- **`meta`** — Resource metadata (resourceType, created, lastModified, location, version)

### 4.3 Precedence Rule

> **If both `attributes` and `excludedAttributes` are specified, `attributes` takes precedence.**

```http
GET /Users?attributes=userName,displayName&excludedAttributes=displayName
```
→ Result: `userName` and `displayName` are **both** included (attributes wins).

### 4.4 Processing Flow

```
  ┌────────────────┐
  │ Full Resource   │
  │ {               │
  │   id, schemas,  │
  │   meta,         │
  │   userName,     │
  │   displayName,  │     attributes=userName
  │   emails: [...],│  ─────────────────────────▶  { id, schemas, meta, userName }
  │   active,       │
  │   name: {...}   │
  │ }               │
  └────────────────┘
                        excludedAttributes=
                          emails,phoneNumbers
                     ─────────────────────────▶  { id, schemas, meta, userName,
                                                   displayName, active, name }
```

### 4.5 Dotted Sub-Attribute Support

The projection engine supports dotted paths for targeting nested attributes:

```http
GET /Users?attributes=name.givenName
```

**Result:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "abc-123",
  "meta": { "resourceType": "User", "..." : "..." },
  "name": {
    "givenName": "John"
  }
}
```
Note: `name.familyName` is **excluded** — only the requested sub-attribute appears within the `name` object.

### 4.6 Application Points

Projection is applied in **two locations**:

| Location | Method | When |
|----------|--------|------|
| **Controller** (GET list/single) | `applyAttributeProjection()` / `applyAttributeProjectionToList()` | Query params `attributes` / `excludedAttributes` |
| **Controller** (POST /.search) | `applyAttributeProjectionToList()` | Body fields `attributes` / `excludedAttributes` |

### 4.7 Complete Request/Response Example

**Request:**
```http
GET /scim/endpoints/ep123/Users?attributes=userName,displayName&count=2 HTTP/1.1
Host: localhost:6000
Authorization: Bearer eyJhbG...
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 9,
  "startIndex": 1,
  "itemsPerPage": 2,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "86c5eed8-b6e3-4988-865f-a637f702595d",
      "meta": {
        "resourceType": "User",
        "created": "2026-02-11T23:53:25.234Z",
        "lastModified": "2026-02-11T23:53:25.726Z",
        "location": "http://localhost:6000/scim/endpoints/ep123/Users/86c5eed8-..."
      },
      "userName": "john@example.com",
      "displayName": "John Doe"
    }
  ]
}
```
Note: `emails`, `active`, `name`, `phoneNumbers` are all **omitted** — only the requested attributes plus always-returned ones appear.

---

## 5. ETag & Conditional Requests (RFC 7644 §3.14)

### 5.1 Overview

[RFC 7644 §3.14](https://datatracker.ietf.org/doc/html/rfc7644#section-3.14) requires SCIM servers to support resource versioning via ETags for optimistic concurrency and conditional retrieval.

### 5.2 ETag Format

The server uses **weak ETags** derived from the resource's `meta.lastModified` timestamp:

```
ETag: W/"2026-02-11T23:53:25.726Z"
```

This value is also stored in `meta.version` on every resource response.

### 5.3 ETag Flow Diagram

```
┌─────────┐                          ┌──────────────┐
│  Client  │  GET /Users/abc-123     │    Server     │
│          │────────────────────────▶│              │
│          │                         │ 1. Fetch user │
│          │  200 OK                 │ 2. Build body │
│          │  ETag: W/"2026-02-11T.."│ 3. Set ETag   │
│          │◀────────────────────────│    header     │
│          │                         │              │
│          │  GET /Users/abc-123     │              │
│          │  If-None-Match:         │              │
│          │    W/"2026-02-11T.."    │              │
│          │────────────────────────▶│ 4. Compare    │
│          │                         │    ETags      │
│          │  304 Not Modified       │ 5. Match →    │
│          │  (no body)              │    return 304 │
│          │◀────────────────────────│              │
│          │                         │              │
│          │  PATCH /Users/abc-123   │              │
│          │  (update displayName)   │              │
│          │────────────────────────▶│ 6. Apply PATCH│
│          │                         │ 7. New        │
│          │  200 OK                 │    lastModified│
│          │  ETag: W/"2026-02-11T.."│ 8. New ETag   │
│          │  (new value)            │              │
│          │◀────────────────────────│              │
│          │                         │              │
│          │  GET /Users/abc-123     │              │
│          │  If-None-Match:         │              │
│          │    W/"old-etag-value"   │              │
│          │────────────────────────▶│ 9. Mismatch → │
│          │                         │    return 200 │
│          │  200 OK                 │    with body  │
│          │  ETag: W/"new-value"    │              │
│          │◀────────────────────────│              │
└─────────┘                          └──────────────┘
```

### 5.4 Interceptor Implementation

The `ScimEtagInterceptor` is registered globally via `APP_INTERCEPTOR` and handles:

| Scenario | Request Header | Server Behavior |
|----------|---------------|-----------------|
| **GET** with matching ETag | `If-None-Match: W/"..."` | → `304 Not Modified` (no body) |
| **GET** with stale ETag | `If-None-Match: W/"old"` | → `200 OK` (full body) |
| **GET** without ETag | (none) | → `200 OK` + `ETag` header set |
| **POST** (create) | N/A | → `201 Created` + `ETag` header |
| **PUT** (replace) | N/A | → `200 OK` + new `ETag` header |
| **PATCH** (update) | N/A | → `200 OK` + new `ETag` header |

### 5.5 Pre-Mutation Validation

For strict optimistic concurrency, the `assertIfMatch()` function can be called from service methods:

```typescript
assertIfMatch(currentVersion, req.headers['if-match']);
// Throws 412 Precondition Failed if:
//   - If-Match header is present AND
//   - It doesn't match the current meta.version AND
//   - It's not the wildcard "*"
```

**Error Response:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "ETag mismatch. Expected: W/\"old\", current: W/\"new\". The resource has been modified.",
  "scimType": "versionMismatch",
  "status": "412"
}
```

### 5.6 ServiceProviderConfig Declaration

```json
{
  "etag": { "supported": true }
}
```

### 5.7 Complete Request/Response Example

**Request — Conditional GET:**
```http
GET /scim/endpoints/ep123/Users/86c5eed8-... HTTP/1.1
Host: localhost:6000
Authorization: Bearer eyJhbG...
If-None-Match: W/"2026-02-11T23:53:25.726Z"
```

**Response — Not Modified:**
```http
HTTP/1.1 304 Not Modified
ETag: W/"2026-02-11T23:53:25.726Z"
```

**Response — Modified (stale ETag):**
```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
ETag: W/"2026-02-11T23:55:16.913Z"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "86c5eed8-b6e3-4988-865f-a637f702595d",
  "userName": "john@example.com",
  "meta": {
    "resourceType": "User",
    "created": "2026-02-11T23:53:25.234Z",
    "lastModified": "2026-02-11T23:55:16.913Z",
    "location": "http://localhost:6000/scim/endpoints/ep123/Users/86c5eed8-...",
    "version": "W/\"2026-02-11T23:55:16.913Z\""
  }
}
```

---

## 6. POST /.search (RFC 7644 §3.4.3)

### 6.1 Overview

[RFC 7644 §3.4.3](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.3) defines POST /.search as an alternative to GET for query operations. This is critical when:

- Filter expressions are too long for URL query parameters
- Clients need to send complex structured queries
- URL length limits would be exceeded

### 6.2 Endpoints

| Route | HTTP Method | Status Code |
|-------|-------------|-------------|
| `/scim/endpoints/{id}/Users/.search` | `POST` | **200 OK** (not 201) |
| `/scim/endpoints/{id}/Groups/.search` | `POST` | **200 OK** (not 201) |

> **Critical:** POST /.search returns `200 OK`, NOT `201 Created`. The `@HttpCode(200)` decorator overrides NestJS's default POST behavior.

### 6.3 Request Body Schema

```typescript
class SearchRequestDto {
  schemas?: string[];           // ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"]
  filter?: string;              // SCIM filter expression
  attributes?: string;          // Comma-separated attribute names to include
  excludedAttributes?: string;  // Comma-separated attribute names to exclude
  sortBy?: string;              // Attribute to sort by (not yet implemented)
  sortOrder?: 'ascending' | 'descending';
  startIndex?: number;          // 1-based pagination start
  count?: number;               // Page size (max 200)
}
```

### 6.4 Processing Flow

```
  POST /.search                    ┌─────────────────────────────────┐
  {                                │  Controller                      │
    "filter": "...",               │  1. Validate endpoint (active)   │
    "attributes": "userName",      │  2. Call listUsersForEndpoint()  │
    "count": 10,       ──────────▶│     with filter, startIndex,     │
    "startIndex": 1                │     count from DTO               │
  }                                │  3. Apply attribute projection   │
                                   │     from DTO attributes /        │
                                   │     excludedAttributes           │
                                   │  4. Return 200 (not 201)         │
                                   └─────────────────────────────────┘
```

### 6.5 Complete Request/Response Examples

#### Basic Search with Filter

**Request:**
```http
POST /scim/endpoints/ep123/Users/.search HTTP/1.1
Host: localhost:6000
Authorization: Bearer eyJhbG...
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "userName eq \"john@example.com\"",
  "startIndex": 1,
  "count": 10
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "86c5eed8-b6e3-4988-865f-a637f702595d",
      "userName": "john@example.com",
      "active": true,
      "displayName": "John Doe",
      "meta": {
        "resourceType": "User",
        "created": "2026-02-11T23:53:25.234Z",
        "lastModified": "2026-02-11T23:53:25.726Z",
        "location": "http://localhost:6000/scim/endpoints/ep123/Users/86c5eed8-..."
      }
    }
  ]
}
```

#### Search with Attribute Projection

**Request:**
```http
POST /scim/endpoints/ep123/Users/.search HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "filter": "userName eq \"john@example.com\"",
  "attributes": "userName,displayName",
  "startIndex": 1,
  "count": 10
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "86c5eed8-b6e3-4988-865f-a637f702595d",
      "meta": { "resourceType": "User", "..." : "..." },
      "userName": "john@example.com",
      "displayName": "John Doe"
    }
  ]
}
```
Note: `emails`, `active`, `name` etc. are all **excluded** because `attributes` was specified.

#### Search with excludedAttributes

**Request:**
```http
POST /scim/endpoints/ep123/Groups/.search HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "excludedAttributes": "members",
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "count": 50,
  "startIndex": 1
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 4,
  "startIndex": 1,
  "itemsPerPage": 4,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      "id": "f810e9f6-1e01-448c-acd2-365ffed5968f",
      "displayName": "Engineering",
      "meta": { "resourceType": "Group", "..." : "..." }
    }
  ]
}
```
Note: `members` array is **excluded** from all group resources.

#### Search without Filter (List All)

**Request:**
```http
POST /scim/endpoints/ep123/Users/.search HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
  "startIndex": 1,
  "count": 5
}
```

**Response:**
```http
HTTP/1.1 200 OK

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 9,
  "startIndex": 1,
  "itemsPerPage": 5,
  "Resources": [ ... first 5 users ... ]
}
```

### 6.6 GET vs. POST /.search — Comparison

| Feature | GET /Users | POST /Users/.search |
|---------|-----------|---------------------|
| Filter | `?filter=userName eq "x"` (query param) | `{"filter": "userName eq \"x\""}` (body) |
| Attributes | `?attributes=userName` | `{"attributes": "userName"}` |
| Excluded | `?excludedAttributes=emails` | `{"excludedAttributes": "emails"}` |
| Pagination | `?startIndex=1&count=10` | `{"startIndex": 1, "count": 10}` |
| HTTP status | 200 | **200** (not 201) |
| Response body | Identical `ListResponse` | Identical `ListResponse` |
| Use case | Simple queries | Complex/long filters |

---

## 7. Content-Type & Response Headers (RFC 7644 §3.1)

### 7.1 Content-Type

Per [RFC 7644 §3.1](https://datatracker.ietf.org/doc/html/rfc7644#section-3.1), all SCIM responses MUST use:

```
Content-Type: application/scim+json; charset=utf-8
```

The `ScimContentTypeInterceptor` sets this header globally on every response.

### 7.2 Location Header

For `201 Created` responses (POST /Users, POST /Groups), the server **SHALL** include:

```
Location: http://localhost:6000/scim/endpoints/ep123/Users/86c5eed8-...
```

This matches `meta.location` in the response body.

### 7.3 Headers Summary

| Header | When Set | Value |
|--------|----------|-------|
| `Content-Type` | All responses | `application/scim+json; charset=utf-8` |
| `Location` | POST → 201 Created | `meta.location` URL |
| `ETag` | GET/POST/PUT/PATCH single resource | `W/"<lastModified>"` |

---

## 8. SCIM Error Responses (RFC 7644 §3.12)

### 8.1 Error Format

Per [RFC 7644 §3.12](https://datatracker.ietf.org/doc/html/rfc7644#section-3.12), all error responses MUST conform to:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Human-readable error description",
  "scimType": "errorKeyword",
  "status": "400"
}
```

> **Critical:** `status` MUST be a **string**, not a number.

### 8.2 Standard Error Types

| scimType | HTTP Status | Description | Example Trigger |
|----------|-------------|-------------|-----------------|
| `uniqueness` | 409 | Duplicate value | Creating user with existing userName |
| `noTarget` | 404 | Resource not found | GET /Users/non-existent-id |
| `invalidFilter` | 400 | Bad filter syntax | `?filter=broken!!!` |
| `invalidSyntax` | 400 | Malformed request body | Missing required fields |
| `invalidPath` | 400 | Bad PATCH path | `path: "nonExistentAttr[bad"` |
| `invalidValue` | 400 | Invalid attribute value | Boolean where string expected |
| `versionMismatch` | 412 | ETag mismatch | If-Match header conflict |
| `mutability` | 501 | Read-only attribute | Trying to change `id` |
| `invalidToken` | 401 | Auth failure | Missing/invalid Bearer token |

### 8.3 Error Response Examples

**404 Not Found:**
```http
HTTP/1.1 404 Not Found
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Resource non-existent-id-12345 not found.",
  "scimType": "noTarget",
  "status": "404"
}
```

**409 Conflict (Uniqueness):**
```http
HTTP/1.1 409 Conflict
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "A resource with userName 'john@example.com' already exists.",
  "scimType": "uniqueness",
  "status": "409"
}
```

**401 Unauthorized:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Missing bearer token.",
  "scimType": "invalidToken",
  "status": "401"
}
```

**403 Forbidden (Inactive Endpoint):**
```http
HTTP/1.1 403 Forbidden
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Endpoint \"my-endpoint\" is inactive. SCIM operations are not allowed.",
  "status": "403"
}
```

### 8.4 Exception Pipeline

```
  Service / Controller                 ScimExceptionFilter
  throws HttpException   ──────────▶  (global @Catch)
                                       │
                                       ├─ Already SCIM-formatted? → pass through
                                       │
                                       └─ NestJS built-in exception? → wrap in SCIM envelope
                                          {
                                            schemas: [Error schema],
                                            detail: exception.message,
                                            status: String(httpStatus)
                                          }
                                          + Content-Type: application/scim+json
```

---

## 9. PATCH Operations (RFC 7644 §3.5.2)

### 9.1 Supported PATCH Paths

The PATCH engine supports all path types defined in [RFC 7644 §3.5.2](https://datatracker.ietf.org/doc/html/rfc7644#section-3.5.2):

```
┌──────────────────────────────────────────────────────────────────────┐
│                        PATCH Path Types                              │
│                                                                      │
│  1. Simple:       "displayName"                                      │
│  2. No-path:      { "op": "replace", "value": {"displayName": "X"}} │
│  3. ValuePath:    "emails[type eq \"work\"].value"                   │
│  4. Extension URN: "urn:...:enterprise:2.0:User:department"          │
│  5. Dotted:       "name.givenName" (via no-path resolution)          │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 PATCH Operations (add / replace / remove)

| Operation | With Path | Without Path (no-path merge) |
|-----------|-----------|------------------------------|
| **add** | Set attribute if absent, append to arrays | Merge all key-value pairs into resource |
| **replace** | Overwrite existing value | Overwrite matched keys |
| **remove** | Delete attribute or array element | N/A |

### 9.3 ValuePath Parsing

```
Input:  emails[type eq "work"].value

Parsed:
  ┌──────────────────────────────────────┐
  │  attribute: "emails"                  │
  │  filterAttribute: "type"              │
  │  filterOperator: "eq"                 │
  │  filterValue: "work"                  │
  │  subAttribute: "value"                │
  └──────────────────────────────────────┘

Effect:
  Find the element in emails[] where type == "work"
  Then update its .value sub-attribute
```

### 9.4 Extension URN Path Parsing

```
Input:  urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department

Parsed:
  ┌──────────────────────────────────────────────────────────────────┐
  │  schemaUrn: "urn:ietf:params:scim:schemas:extension:enterprise:  │
  │              2.0:User"                                            │
  │  attributePath: "department"                                      │
  └──────────────────────────────────────────────────────────────────┘

Effect:
  resource["urn:...:User"].department = value
```

### 9.5 Empty-Value Removal (RFC 7644 §3.5.2.3)

When a PATCH replace operation sets a value to an "empty" value, the attribute is **removed** from the resource:

```json
{
  "op": "replace",
  "path": "urn:...:enterprise:2.0:User:manager",
  "value": { "value": "" }
}
```
→ Removes `manager` entirely from the enterprise extension.

**Empty values include:** `null`, `undefined`, `""`, `{ "value": "" }`, `{ "value": null }`

### 9.6 No-Path Merge (Microsoft Entra ID Pattern)

Microsoft Entra ID sends PATCH operations **without a path**, using the value object as a merge:

```json
{
  "op": "replace",
  "value": {
    "DisplayName": "New Name",
    "name.givenName": "John",
    "urn:...:User:employeeNumber": "12345"
  }
}
```

The `resolveNoPathValue()` function handles three sub-cases:
1. **Simple key** (`displayName`) → case-insensitive direct update
2. **Dotted key** (`name.givenName`) → resolve into nested object
3. **Extension URN key** (`urn:...:User:...`) → delegate to `applyExtensionUpdate()`

### 9.7 PATCH Request/Response Examples

#### Replace with Simple Path

**Request:**
```http
PATCH /scim/endpoints/ep123/Users/abc-123 HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "displayName", "value": "Jane Doe" }
  ]
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
ETag: W/"2026-02-11T23:55:14.640Z"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "abc-123",
  "userName": "jane@example.com",
  "displayName": "Jane Doe",
  "meta": {
    "resourceType": "User",
    "lastModified": "2026-02-11T23:55:14.640Z",
    "version": "W/\"2026-02-11T23:55:14.640Z\""
  }
}
```

#### ValuePath Update

**Request:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "emails[type eq \"work\"].value",
      "value": "new-work@example.com"
    }
  ]
}
```

#### Multi-Operation PATCH

**Request:**
```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "displayName", "value": "Updated Name" },
    { "op": "replace", "path": "active", "value": false },
    { "op": "add", "path": "title", "value": "Engineer" }
  ]
}
```
All operations are applied atomically in a single database transaction.

---

## 10. Case-Insensitivity (RFC 7643 §2.1)

### 10.1 Requirements

[RFC 7643 §2.1](https://datatracker.ietf.org/doc/html/rfc7643#section-2.1) mandates:
- Attribute names are **case-insensitive** (`userName` == `USERNAME` == `UserName`)
- String attribute comparisons default to **case-insensitive** (`caseExact: false`)

### 10.2 Where Case-Insensitivity is Enforced

| Layer | Mechanism |
|-------|-----------|
| **Filter tokenizer** | All keywords lowercased (`AND` → `and`, `EQ` → `eq`) |
| **Filter evaluator** | String comparisons via `.toLowerCase()` |
| **DB push-down** | `userNameLower` column stores lowercase userName |
| **Uniqueness checks** | `userName.toLowerCase()` dedup |
| **PATCH operations** | Case-insensitive op names (`Replace` → `replace`) |
| **No-path merge** | Case-insensitive key lookup (`DisplayName` → `displayName`) |
| **Attribute projection** | Case-insensitive attribute name matching |
| **Attribute path resolution** | `Object.keys(obj).find(k => k.toLowerCase() === part.toLowerCase())` |

### 10.3 Example

```http
GET /Users?filter=USERNAME eq "JOHN@EXAMPLE.COM"
```
Correctly matches user with `userName: "john@example.com"`.

---

## 11. Discovery Endpoints (RFC 7644 §4)

### 11.1 ServiceProviderConfig

```
GET /scim/endpoints/{id}/ServiceProviderConfig
```

**Response:**
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "patch":            { "supported": true },
  "bulk":             { "supported": false },
  "filter":           { "supported": true, "maxResults": 200 },
  "changePassword":   { "supported": false },
  "sort":             { "supported": false },
  "etag":             { "supported": true },
  "authenticationSchemes": [
    {
      "type": "oauthbearertoken",
      "name": "OAuth Bearer Token",
      "description": "Authentication scheme using the OAuth Bearer Token Standard",
      "specificationUrl": "https://www.rfc-editor.org/info/rfc6750"
    }
  ]
}
```

### 11.2 ResourceTypes

```
GET /scim/endpoints/{id}/ResourceTypes
```

**Response:**
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

### 11.3 Schemas

```
GET /scim/endpoints/{id}/Schemas
```

Returns the full User and Group schema definitions with all attribute metadata.

---

## 12. Module Wiring & Interceptor Pipeline

### 12.1 ScimModule Registration

```typescript
@Module({
  imports: [PrismaModule, LoggingModule, EndpointModule],
  controllers: [
    ServiceProviderConfigController,      // /ServiceProviderConfig
    ResourceTypesController,              // /ResourceTypes
    SchemasController,                    // /Schemas
    AdminController,                      // /admin/endpoints
    EndpointScimUsersController,          // /endpoints/{id}/Users
    EndpointScimGroupsController,         // /endpoints/{id}/Groups
    EndpointScimDiscoveryController       // /endpoints/{id}/ServiceProviderConfig, etc.
  ],
  providers: [
    ScimMetadataService,
    EndpointScimUsersService,
    EndpointScimGroupsService,
    EndpointContextStorage,
    { provide: APP_FILTER,       useClass: ScimExceptionFilter },        // 1st: catch errors
    { provide: APP_INTERCEPTOR,  useClass: ScimContentTypeInterceptor }, // 2nd: set Content-Type
    { provide: APP_INTERCEPTOR,  useClass: ScimEtagInterceptor },        // 3rd: set ETag + 304
  ]
})
export class ScimModule {}
```

### 12.2 Request Processing Pipeline

```
  Incoming Request
       │
       ▼
  ┌─────────────────────┐
  │  Auth Guard          │   Check Bearer token (OAuth)
  └──────────┬──────────┘
             │
  ┌──────────▼──────────┐
  │  Controller          │   validateAndSetContext()
  │                      │   Route to service method
  │                      │   Apply attribute projection
  └──────────┬──────────┘
             │
  ┌──────────▼──────────┐
  │  Service             │   AST filter parsing
  │                      │   PATCH path resolution
  │                      │   Prisma DB operations
  └──────────┬──────────┘
             │
  ┌──────────▼──────────────┐
  │  ScimContentType         │   Set Content-Type: application/scim+json
  │  Interceptor             │   Set Location header on 201
  └──────────┬──────────────┘
             │
  ┌──────────▼──────────────┐
  │  ScimEtag                │   Set ETag header from meta.version
  │  Interceptor             │   Handle If-None-Match → 304
  └──────────┬──────────────┘
             │
  ┌──────────▼──────────────┐
  │  ScimException Filter    │   Catch any HttpException
  │  (on error only)         │   Format as SCIM error response
  └──────────┬──────────────┘
             │
             ▼
  Outgoing Response
```

---

## 13. Legacy Code Cleanup Summary

### 13.1 What Was Replaced

| Legacy Component | Problem | Replacement |
|-----------------|---------|-------------|
| **Regex-based filter parser** | Only handled `attr eq "value"`; broke on compound filters, value paths, NOT expressions | Full AST parser with recursive descent |
| **Inline filter evaluation** | Scattered `if/else` chains in service methods; no support for `co`, `sw`, `ew`, `gt`, etc. | Centralized `evaluateFilter()` with all 10 operators |
| **Manual Content-Type setting** | Each controller method set its own headers; easy to miss | Global `ScimContentTypeInterceptor` |
| **No ETag support** | No conditional GET, no version tracking | `ScimEtagInterceptor` + `meta.version` |
| **No POST /.search** | Only GET with query params; URL length limits | `POST /.search` endpoints with body-based queries |
| **No attribute projection** | All attributes always returned; bandwidth waste | `applyAttributeProjection()` for include/exclude |
| **Hardcoded error formats** | Some errors returned plain JSON without SCIM schema | `ScimExceptionFilter` catches all exceptions |
| **Case-sensitive filter matching** | `userName eq "JOHN"` would not match `"john"` | Case-insensitive throughout: tokenizer, evaluator, DB |
| **No Location header** | POST /Users returned 201 without Location | `ScimContentTypeInterceptor` auto-sets Location |
| **String status codes** | Some errors had numeric `status` field | `createScimError()` always uses `String(status)` |
| **Scattered PATCH logic** | No support for valuePath, extension URN, no-path merge | Centralized `scim-patch-path.ts` with all path types |

### 13.2 Architectural Improvements

1. **Separation of Concerns:** Filter parsing (AST) is fully decoupled from filter application (DB/memory) and from the service layer.
2. **Testability:** Each component has dedicated `.spec.ts` files; the AST parser alone has extensive unit tests covering all operator combinations.
3. **Extensibility:** New filter operators can be added to the evaluator without touching the parser. New DB-pushable columns can be added to the column maps.
4. **Interceptor Pattern:** Cross-cutting concerns (Content-Type, ETag, error formatting) are handled in NestJS interceptors/filters rather than polluting controller code.

---

## 14. Complete Request/Response Examples

### 14.1 Full User CRUD Lifecycle

#### Create User

```http
POST /scim/endpoints/ep123/Users HTTP/1.1
Host: localhost:6000
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "john@example.com",
  "active": true,
  "displayName": "John Doe",
  "name": {
    "givenName": "John",
    "familyName": "Doe"
  },
  "emails": [
    { "value": "john@example.com", "type": "work", "primary": true }
  ]
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/scim+json; charset=utf-8
Location: http://localhost:6000/scim/endpoints/ep123/Users/86c5eed8-...
ETag: W/"2026-02-11T23:53:25.234Z"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "86c5eed8-b6e3-4988-865f-a637f702595d",
  "userName": "john@example.com",
  "active": true,
  "displayName": "John Doe",
  "name": { "givenName": "John", "familyName": "Doe" },
  "emails": [{ "value": "john@example.com", "type": "work", "primary": true }],
  "meta": {
    "resourceType": "User",
    "created": "2026-02-11T23:53:25.234Z",
    "lastModified": "2026-02-11T23:53:25.234Z",
    "location": "http://localhost:6000/scim/endpoints/ep123/Users/86c5eed8-...",
    "version": "W/\"2026-02-11T23:53:25.234Z\""
  }
}
```

#### Get User with Attribute Projection

```http
GET /scim/endpoints/ep123/Users/86c5eed8-...?attributes=userName HTTP/1.1
Authorization: Bearer eyJhbG...
```

```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8
ETag: W/"2026-02-11T23:53:25.234Z"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "86c5eed8-...",
  "meta": { "resourceType": "User", "..." : "..." },
  "userName": "john@example.com"
}
```

#### List Users with Filter + Pagination

```http
GET /scim/endpoints/ep123/Users?filter=active eq true&startIndex=1&count=2 HTTP/1.1
Authorization: Bearer eyJhbG...
```

```http
HTTP/1.1 200 OK
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 9,
  "startIndex": 1,
  "itemsPerPage": 2,
  "Resources": [
    { "id": "86c5eed8-...", "userName": "john@example.com", "..." : "..." },
    { "id": "ec95ae20-...", "userName": "jane@example.com", "..." : "..." }
  ]
}
```

#### PATCH User (Extension URN)

```http
PATCH /scim/endpoints/ep123/Users/86c5eed8-... HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
      "value": "Engineering"
    }
  ]
}
```

```http
HTTP/1.1 200 OK
ETag: W/"2026-02-11T23:55:14.640Z"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "86c5eed8-...",
  "userName": "john@example.com",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "department": "Engineering"
  },
  "meta": { "lastModified": "2026-02-11T23:55:14.640Z", "..." : "..." }
}
```

#### PUT User (Full Replace)

```http
PUT /scim/endpoints/ep123/Users/86c5eed8-... HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "john@example.com",
  "active": true,
  "displayName": "John D. Doe"
}
```

```http
HTTP/1.1 200 OK
ETag: W/"2026-02-11T23:55:16.968Z"

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "86c5eed8-...",
  "userName": "john@example.com",
  "active": true,
  "displayName": "John D. Doe",
  "meta": { "lastModified": "2026-02-11T23:55:16.968Z", "..." : "..." }
}
```

#### Delete User

```http
DELETE /scim/endpoints/ep123/Users/86c5eed8-... HTTP/1.1
Authorization: Bearer eyJhbG...
```

```http
HTTP/1.1 204 No Content
```

#### Verify Deletion

```http
GET /scim/endpoints/ep123/Users/86c5eed8-... HTTP/1.1
Authorization: Bearer eyJhbG...
```

```http
HTTP/1.1 404 Not Found
Content-Type: application/scim+json; charset=utf-8

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "Resource 86c5eed8-... not found.",
  "scimType": "noTarget",
  "status": "404"
}
```

### 14.2 Group with Members

#### Create Group + Add Members

```http
POST /scim/endpoints/ep123/Groups HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team"
}
```

```http
HTTP/1.1 201 Created
Location: http://localhost:6000/scim/endpoints/ep123/Groups/f810e9f6-...

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "f810e9f6-...",
  "displayName": "Engineering Team",
  "members": [],
  "meta": { "resourceType": "Group", "..." : "..." }
}
```

#### Add Member via PATCH

```http
PATCH /scim/endpoints/ep123/Groups/f810e9f6-... HTTP/1.1
Content-Type: application/scim+json
Authorization: Bearer eyJhbG...

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [{ "value": "86c5eed8-..." }]
    }
  ]
}
```

```http
HTTP/1.1 200 OK

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "f810e9f6-...",
  "displayName": "Engineering Team",
  "members": [{ "value": "86c5eed8-..." }],
  "meta": { "..." : "..." }
}
```

#### Remove Member via PATCH

```http
PATCH /scim/endpoints/ep123/Groups/f810e9f6-... HTTP/1.1
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "remove",
      "path": "members[value eq \"86c5eed8-...\"]"
    }
  ]
}
```

```http
HTTP/1.1 200 OK

{
  "id": "f810e9f6-...",
  "displayName": "Engineering Team",
  "members": []
}
```

---

## 📚 RFC Reference Links

| RFC | Title | Key Sections |
|-----|-------|-------------|
| [RFC 7643](https://datatracker.ietf.org/doc/html/rfc7643) | SCIM Core Schema | §2.1 (attributes), §7 (returned values) |
| [RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644) | SCIM Protocol | §3.1 (Content-Type), §3.4.2.2 (filtering), §3.4.2.5 (projection), §3.4.3 (POST /.search), §3.5.2 (PATCH), §3.12 (errors), §3.14 (ETags), §4 (discovery) |
| [RFC 7642](https://datatracker.ietf.org/doc/html/rfc7642) | SCIM Definitions | Concepts & requirements |
| [RFC 6750](https://www.rfc-editor.org/info/rfc6750) | OAuth 2.0 Bearer Token | Authentication scheme |

---

> **Last verified:** March 2026 — 535/535 live tests passing, 558/558 e2e tests, 2,573/2,573 unit tests against `localhost:6000`
