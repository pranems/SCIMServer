# SCIM — RFC-First Design Recommendations for a Multi-Endpoint Server

> ⚠️ **FUTURE VISION — NOT YET IMPLEMENTED.** This document describes an aspirational schema-driven architecture. The current codebase uses a different (simpler) approach. See `MULTI_ENDPOINT_GUIDE.md` for the as-built architecture.

> **Version**: 2.0 — Complete rewrite with RFC-first thinking  
> **Date**: Feb 2026  
> **Perspective**: Designed purely from SCIM RFCs (7642, 7643, 7644) for extensibility, simplicity, and discoverability  
> **Guiding Principle**: What would the ideal multi-endpoint SCIM 2.0 server look like if we started from the RFCs alone?

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Tenant & URL Architecture](#2-tenant--url-architecture)
3. [Resource Type System](#3-resource-type-system)
4. [Schema-Driven Data Model](#4-schema-driven-data-model)
5. [Attribute Characteristics Engine](#5-attribute-characteristics-engine)
6. [PATCH Operation Engine](#6-patch-operation-engine)
7. [Filter & Query Engine](#7-filter--query-engine)
8. [Discovery & ServiceProviderConfig](#8-discovery--serviceproviderconfig)
9. [Bulk Operations](#9-bulk-operations)
10. [ETag & Conditional Operations](#10-etag--conditional-operations)
11. [Error Model](#11-error-model)
12. [Extension Model](#12-extension-model)
13. [Security Architecture](#13-security-architecture)
14. [Persistence Layer (Database-Agnostic)](#14-persistence-layer-database-agnostic)
15. [The /Me Endpoint](#15-the-me-endpoint)
16. [Sorting & Pagination](#16-sorting--pagination)
17. [Current Implementation Gap Analysis](#17-current-implementation-gap-analysis)
18. [Implementation Roadmap](#18-implementation-roadmap)

---

## 1. Design Philosophy

### 1.1 The Three RFC Pillars

| RFC | Title | What It Tells Us |
|-----|-------|------------------|
| **RFC 7642** | Definitions, Overview, Concepts, Requirements | Multi-tenancy use cases, actor model (CSP, ECS, CSU), push/pull flows, lifecycle scenarios |
| **RFC 7643** | Core Schema | Resource types, attribute characteristics (mutability, returned, uniqueness, caseExact), schema URIs, extension model, canonical type definitions |
| **RFC 7644** | Protocol | HTTP verbs, filtering, sorting, pagination, PATCH semantics, bulk ops, ETags, error codes, discovery endpoints, content-type rules |

### 1.2 Core Design Principles (Derived from RFCs)

1. **Schema is the Source of Truth** — Every behavior (mutability, returnability, filtering, case sensitivity) should be derived from schema definitions, not hardcoded per-attribute. RFC 7643 §7 defines the schema definition format; the server should load it and act on it.

2. **Resource Types are Pluggable** — RFC 7643 §3.2 says _"SCIM may be extended to define new classes of resources by defining a resource type."_ The server should not be "User + Group only" — it should treat resource types as registrations that can be added, removed, or customized per tenant.

3. **Discovery Drives the Contract** — RFC 7644 §4 defines `/ServiceProviderConfig`, `/Schemas`, `/ResourceTypes` as the client's way to understand the server. These must be per-tenant, truthful, and generated from actual server capabilities — never hardcoded.

4. **Multi-Tenancy is URL-Based** — RFC 7644 §6 gives three patterns: URL prefix, subdomain, HTTP header. For a multi-endpoint testing server, URL prefix (`/{tenantId}/Users`) is the most standard and discoverable approach.

5. **Attribute Characteristics are Not Optional** — `mutability`, `returned`, `uniqueness`, `caseExact`, `required` from RFC 7643 §2.2 must govern CRUD behavior. Read-only attributes are ignored on PUT. "never" returned attributes don't appear in responses. "always" returned attributes can't be excluded.

6. **Errors are Structured** — RFC 7644 §3.12 mandates JSON error responses with `schemas`, `status`, `scimType`, and `detail`. Every error path must comply.

7. **Simplicity Through Generalization** — A generic engine that processes _any_ resource type through schema-driven rules is simpler and more reliable than per-resource-type hardcoded logic.

---

## 2. Tenant & URL Architecture

### 2.1 What the RFCs Say

> **RFC 7644 §6**: "The SCIM protocol does not define a scheme for multi-tenancy" but suggests:
> - **URL prefix**: `https://example.com/Tenants/{tenant_id}/v2/Users`  
> - **Sub-domain**: `https://{tenant_id}.example.com/v2/Groups`  
> - **HTTP header**: A custom header carrying the tenant_id

> **RFC 7644 §3.13**: "The Base URL MAY be appended with a version identifier... the character 'v' followed by the desired SCIM version number"

### 2.2 Recommended URL Design

```
Base URL per tenant:  https://host/scim/v2/{tenantId}

Derived endpoints:
  {baseUrl}/Users                      → CRUD for Users
  {baseUrl}/Users/{id}                 → Single User
  {baseUrl}/Groups                     → CRUD for Groups
  {baseUrl}/Groups/{id}                → Single Group
  {baseUrl}/{CustomResource}           → Any registered resource type
  {baseUrl}/Schemas                    → Discovery (all schemas)
  {baseUrl}/Schemas/{schemaUri}        → Discovery (single schema)
  {baseUrl}/ResourceTypes              → Discovery (all resource types)
  {baseUrl}/ResourceTypes/{name}       → Discovery (single resource type)
  {baseUrl}/ServiceProviderConfig      → Discovery (capabilities)
  {baseUrl}/Bulk                       → Bulk operations
  {baseUrl}/.search                    → Root-level cross-resource search
  {baseUrl}/Me                         → Authenticated subject alias

Admin (non-SCIM):
  https://host/admin/tenants           → Tenant CRUD
  https://host/admin/tenants/{id}      → Tenant detail + config
  https://host/admin/tenants/{id}/schemas   → Per-tenant schema management
```

### 2.3 Why This Matters

Identity providers (Entra ID, Okta, OneLogin, Ping) configure a single **"Tenant URL"** and append standard SCIM paths. If the server uses `/scim/endpoints/{id}/Users`, the tenant URL becomes `https://host/scim/endpoints/{id}` — this leaks the implementation term "endpoints" and is non-standard. Using `/scim/v2/{tenantId}` makes the base URL opaque and version-aware per RFC 7644 §3.13.

### 2.4 Tenant Isolation Model

Per RFC 7644 §6.2:
- **SCIM `id`s** need not be globally unique — they must be unique within a tenant
- **`externalId`** must be unique within the resources of the same type in a tenant
- `meta.location` must include the full tenant-scoped URL

Each tenant is a complete, isolated SCIM service provider. Tenants SHOULD have independent:
- Schema registrations (which extensions are active)
- ServiceProviderConfig (which features are enabled)
- Resource type registrations (which resource types are supported)
- Auth configuration (bearer token, client credentials)
- Behavior flags (how to handle edge cases)

---

## 3. Resource Type System

### 3.1 What the RFC Says

> **RFC 7643 §6**: A ResourceType defines: `id`, `name`, `description`, `endpoint`, `schema` (base schema URI), `schemaExtensions` (list of extension URIs + required flag)

> **RFC 7643 §3.2**: "SCIM may be extended to define new classes of resources by defining a resource type."

### 3.2 Recommended Design: Resource Type Registry

Instead of hardcoding `User` and `Group` as special cases, model them as **resource type registrations**:

```typescript
interface ResourceTypeDefinition {
  id: string;                  // "User", "Group", "Device", etc.
  name: string;                // Human-readable
  description?: string;
  endpoint: string;            // "/Users", "/Groups", "/Devices"
  schema: string;              // Base schema URI  
  schemaExtensions?: Array<{
    schema: string;            // Extension schema URI
    required: boolean;         // Whether extension data is required
  }>;
}
```

**The router registers CRUD routes dynamically** based on registered resource types:

```
                  Resource Type Registry
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
    ┌─────────┐     ┌─────────┐     ┌──────────┐
    │  User   │     │  Group  │     │  Device  │
    │ /Users  │     │ /Groups │     │ /Devices │
    └────┬────┘     └────┬────┘     └────┬─────┘
         │               │               │
         └───────────────┼───────────────┘
                         ▼
              Generic CRUD Controller
              (create/read/update/
               delete/list/search)
```

Adding a new resource type (e.g., `Device`, `Application`, `Role`) should require:
1. Define its schema (attributes + characteristics)
2. Register the resource type with a tenant
3. Routes and CRUD handlers are generated automatically — **no new controller code**

### 3.3 Per-Tenant Resource Type Configuration

Each tenant can have a different set of active resource types and extensions:

```typescript
interface TenantResourceConfig {
  tenantId: string;
  resourceTypes: ResourceTypeDefinition[];
  enabledExtensions: string[];  // Extension schema URIs active for this tenant
}
```

This enables scenarios like:
- **Tenant A**: `User` + `Group` + Enterprise Extension (standard Entra ID provisioning)
- **Tenant B**: `User` + `Group` + Custom extension (Okta with custom fields)
- **Tenant C**: `User` only (simple user sync)
- **Tenant D**: `User` + `Group` + `Device` + `Role` (complex enterprise)

### 3.4 The "Common" Resource Attributes

Per RFC 7643 §3.1, ALL resource types share a common set of attributes:

| Attribute | Type | Mutability | Returned | Description |
|-----------|------|-----------|----------|-------------|
| `id` | String | readOnly | always | Server-assigned unique identifier |
| `externalId` | String | readWrite | default | Client-assigned identifier |
| `meta` | Complex | readOnly | default | Resource metadata |
| `meta.resourceType` | String | readOnly | default | e.g., "User", "Group" |
| `meta.created` | DateTime | readOnly | default | Creation timestamp |
| `meta.lastModified` | DateTime | readOnly | default | Last modification timestamp |
| `meta.location` | URI | readOnly | default | Full URL to this resource |
| `meta.version` | String | readOnly | default | ETag value |

The generic resource handler should automatically inject and manage these for ALL resource types.

---

## 4. Schema-Driven Data Model

### 4.1 What the RFC Says

> **RFC 7643 §7**: Schema definitions include `id` (URI), `name`, `description`, and `attributes` — each with `name`, `type`, `multiValued`, `description`, `required`, `canonicalValues`, `caseExact`, `mutability`, `returned`, `uniqueness`, `subAttributes`, `referenceTypes`.

> **RFC 7643 §2.1**: "A resource is a collection of attributes identified by one or more schemas."

### 4.2 Recommended Design: Schema as Runtime Configuration

Rather than mapping individual SCIM attributes to database columns, treat the **schema definition itself as the data model driver**:

```
┌──────────────────────────────────────────────────────────────────┐
│                      Schema Registry                              │
│                                                                    │
│  SchemaDefinition                                                  │
│  ├── id: "urn:ietf:params:scim:schemas:core:2.0:User"             │
│  ├── name: "User"                                                  │
│  └── attributes[]                                                  │
│       ├── { name: "userName", type: "string",                      │
│       │     required: true, uniqueness: "server",                  │
│       │     caseExact: false, mutability: "readWrite",             │
│       │     returned: "default" }                                  │
│       ├── { name: "name", type: "complex",                         │
│       │     subAttributes: [                                       │
│       │       { name: "formatted", type: "string", ... },          │
│       │       { name: "familyName", type: "string", ... },         │
│       │       { name: "givenName", type: "string", ... },          │
│       │       { name: "middleName", type: "string", ... },         │
│       │       { name: "honorificPrefix", type: "string", ... },    │
│       │       { name: "honorificSuffix", type: "string", ... }     │
│       │     ] }                                                    │
│       ├── { name: "emails", type: "complex",                       │
│       │     multiValued: true,                                     │
│       │     subAttributes: [                                       │
│       │       { name: "value", type: "string" },                   │
│       │       { name: "display", type: "string" },                 │
│       │       { name: "type", type: "string",                      │
│       │         canonicalValues: ["work","home","other"] },         │
│       │       { name: "primary", type: "boolean" }                 │
│       │     ] }                                                    │
│       ├── { name: "password", type: "string",                      │
│       │     mutability: "writeOnly", returned: "never" }           │
│       └── ...                                                      │
└────────────────────────────────────────────────────────────────────┘
```

### 4.3 Generic Resource Storage

Store all SCIM resources in a unified way that doesn't require schema-per-column migrations:

```
┌───────────────────────────────────────────────────────────────────┐
│  Table: ScimResource                                               │
│                                                                     │
│  id            UUID PK           (internal database ID)             │
│  tenantId      UUID FK → Tenant  (isolation boundary)               │
│  resourceType  String            ("User", "Group", ...)             │
│  scimId        String            (SCIM-visible ID, UUID format)     │
│  externalId    String?           (client-assigned identifier)       │
│  version       String            (ETag value, e.g., W/"abc123")     │
│  data          JSONB             (the full resource attributes)     │
│  createdAt     DateTime          (meta.created)                     │
│  lastModified  DateTime          (meta.lastModified)                │
│                                                                     │
│  @@unique([tenantId, resourceType, scimId])                         │
│  @@unique([tenantId, resourceType, externalId])                     │
│  @@index([tenantId, resourceType])                                  │
│  @@index([tenantId, resourceType, data->'userName'])  -- GIN index  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Table: ScimResourceMembership (for Group members, etc.)             │
│                                                                       │
│  id            UUID PK                                                │
│  tenantId      UUID FK → Tenant                                       │
│  groupId       UUID FK → ScimResource (where resourceType = Group)    │
│  memberId      UUID FK → ScimResource (any resource type)             │
│  memberScimId  String   (denormalized for efficient SCIM $ref)        │
│  memberType    String   ("User", "Group" — for nested groups)         │
│  display       String?  (denormalized for display field)              │
│                                                                       │
│  @@unique([groupId, memberId])                                        │
│  @@index([tenantId, groupId])                                         │
│  @@index([memberId])  -- for reverse lookups (which groups am I in?)  │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  Table: Tenant                                                         │
│                                                                         │
│  id            UUID PK                                                  │
│  name          String @unique        (URL-safe slug for path param)     │
│  displayName   String?               (human-readable name)              │
│  description   String?                                                  │
│  config        JSONB                 (tenant-specific behavior flags)    │
│  active        Boolean @default(true)                                   │
│  createdAt     DateTime                                                 │
│  updatedAt     DateTime                                                 │
│                                                                         │
│  Relationships:                                                         │
│  ├── resources      ScimResource[]                                      │
│  ├── resourceTypes  TenantResourceType[]  (which types are active)      │
│  └── schemas        TenantSchema[]        (which schemas are active)    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Why JSONB/Document Over Columnar

| Factor | Columnar (one column per attr) | JSONB/Document |
|--------|---------------------------------|----------------|
| **New attribute** | Requires DB migration | No schema change needed |
| **Custom extensions** | rawPayload workaround | Native in the document |
| **Multi-valued attributes** | Separate table or serialized string | Native JSON arrays |
| **Complex attributes** | Flattened columns or serialized | Native nested objects |
| **Filter on any attribute** | Only indexed columns | GIN/path index on JSONB |
| **Resource type agnostic** | One table per type | One table for all types |
| **Schema validation** | Per-column application code | Schema-driven generic validation |
| **New resource types** | New table + new migration | Zero database changes |

### 4.5 Uniqueness Enforcement

Per RFC 7643 §7 attribute definition, `uniqueness` can be:
- `"none"` — no constraint
- `"server"` — unique across the server (within the tenant, per resource type)
- `"global"` — unique globally across all tenants

The schema engine should read the `uniqueness` characteristic and enforce it:

```typescript
async function enforceUniqueness(
  tenantId: string,
  resourceType: string,
  schema: SchemaDefinition,
  data: Record<string, unknown>,
  existingId?: string  // exclude self on update
): Promise<void> {
  for (const attr of schema.attributes) {
    if (attr.uniqueness === 'none') continue;
    
    const value = data[attr.name];
    if (value === undefined || value === null) continue;

    const normalizedValue = attr.caseExact ? value : String(value).toLowerCase();
    
    const scope = attr.uniqueness === 'global' 
      ? { resourceType }                           // all tenants
      : { tenantId, resourceType };                 // this tenant only
    
    const existing = await store.findByAttribute(scope, attr.name, normalizedValue);
    if (existing && existing.scimId !== existingId) {
      throw new ScimError(409, 'uniqueness', `Attribute '${attr.name}' value already exists`);
    }
  }
}
```

---

## 5. Attribute Characteristics Engine

### 5.1 What the RFC Says

> **RFC 7643 §2.2**: Attributes have characteristics: `required`, `canonicalValues`, `caseExact`, `mutability`, `returned`, `uniqueness`, `referenceTypes`

> **RFC 7644 §3.5.1** (PUT): "readWrite, writeOnly — values SHALL replace. readOnly — values SHALL be ignored. immutable — if no existing values, new values SHALL be applied."

> **RFC 7644 §3.9**: `attributes` and `excludedAttributes` query parameters control which attributes appear in responses.

### 5.2 Recommended Design: Characteristic-Driven Processing

Build a **single attribute processor** that handles all CRUD operations based on schema characteristics:

```typescript
class AttributeProcessor {
  constructor(
    private schemaRegistry: SchemaRegistry,
    private resourceType: string
  ) {}

  /** Strip readOnly attributes from client input on POST/PUT */
  filterMutableInput(input: Resource): Resource {
    return this.walkAttributes(input, (attr, value) => {
      if (attr.mutability === 'readOnly') return undefined; // silently drop
      return value;
    });
  }

  /** Apply mutability rules for PUT (RFC 7644 §3.5.1) */
  applyPutMutability(existing: Resource, input: Resource): Resource {
    return this.walkAttributes(input, (attr, newValue, existingValue) => {
      switch (attr.mutability) {
        case 'readWrite':
        case 'writeOnly':
          return newValue;  // Replace with new value
        case 'readOnly':
          return existingValue;  // Preserve existing (ignore input)
        case 'immutable':
          return existingValue !== undefined ? existingValue : newValue;
      }
    });
  }

  /** Apply "returned" rules to outgoing responses (RFC 7644 §3.9) */
  applyReturnedFilter(
    resource: Resource,
    requestedAttrs?: string[],
    excludedAttrs?: string[]
  ): Resource {
    return this.walkAttributes(resource, (attr, value) => {
      switch (attr.returned) {
        case 'always':  return value;         // Always include (id, meta)
        case 'never':   return undefined;     // Never include (password)
        case 'default':
          if (excludedAttrs?.includes(attr.name)) return undefined;
          return value;
        case 'request':
          if (requestedAttrs?.includes(attr.name)) return value;
          return undefined;
      }
    });
  }

  /** Enforce "required" on POST/PUT */
  validateRequired(input: Resource): void {
    const schema = this.schemaRegistry.getSchema(this.resourceType);
    for (const attr of schema.attributes) {
      if (attr.required && (input[attr.name] === undefined || input[attr.name] === null)) {
        throw new ScimError(400, 'invalidValue', `Required attribute '${attr.name}' is missing`);
      }
    }
  }

  /** Normalize values based on caseExact for comparison and storage */
  normalizeForComparison(attrName: string, value: string): string {
    const attr = this.schemaRegistry.findAttribute(this.resourceType, attrName);
    return attr?.caseExact ? value : value.toLowerCase();
  }
}
```

### 5.3 The `returned` Characteristic Matrix

| Characteristic | GET (default) | GET + `attributes` param | GET + `excludedAttributes` | POST/PUT response |
|---------------|--------------|--------------------------|----------------------------|-------------------|
| `always` | ✅ Included | ✅ Included (overrides) | ✅ Included (overrides) | ✅ Included |
| `default` | ✅ Included | Only if named | ❌ If named in excluded | ✅ Included |
| `request` | ❌ Excluded | ✅ If named | ❌ Excluded | ❌ Excluded |
| `never` | ❌ Excluded | ❌ Excluded | ❌ Excluded | ❌ Excluded |

> **Key insight**: `attributes` and `excludedAttributes` are mutually exclusive per RFC 7644 §3.9. If both are specified, return 400.

### 5.4 The `mutability` Processing Matrix

| Characteristic | POST (Create) | PUT (Replace) | PATCH (Modify) |
|---------------|--------------|--------------|----------------|
| `readWrite` | ✅ Accept | ✅ Replace value | ✅ Modify |
| `writeOnly` | ✅ Accept | ✅ Replace value | ✅ Modify |
| `readOnly` | ⚠️ Ignore silently | ⚠️ Ignore silently | ❌ Return 400 `mutability` |
| `immutable` | ✅ Accept (initial set) | ⚠️ Ignore if value exists | ❌ Return 400 `mutability` |

### 5.5 Data Type Validation

Per RFC 7643 §2.3, the schema engine should validate incoming values against their declared type:

| SCIM Type | JSON Representation | Validation |
|-----------|--------------------|----|
| `string` | String | Max length, pattern (if canonicalValues) |
| `boolean` | Boolean (true/false) | Must be actual boolean, not string |
| `decimal` | Number | Finite, numeric |
| `integer` | Number (integer) | No decimal point |
| `dateTime` | String (ISO 8601) | `xsd:dateTime` format |
| `binary` | String (base64) | Valid base64 encoding |
| `reference` | String (URI) | Valid URI, referenceTypes check |
| `complex` | Object | Recurse into subAttributes |

---

## 6. PATCH Operation Engine

### 6.1 What the RFC Says

> **RFC 7644 §3.5.2**: PATCH operations use `urn:ietf:params:scim:api:messages:2.0:PatchOp` schema. Operations array with `op` (add/remove/replace), optional `path`, and `value`.

> Path syntax per ABNF in Figure 1 (RFC 7644 §3.5.2):
> - Simple: `userName`
> - Sub-attribute: `name.givenName`
> - Value filter: `emails[type eq "work"].value`
> - Schema-qualified: `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber`

### 6.2 Recommended Design: Path-Based Operation Router

```
┌──────────────────────────────────────────────────────────────┐
│                     PATCH Engine                              │
│                                                                │
│  Input: PatchOp { op, path?, value }                           │
│                                                                │
│  Step 1: Parse path → ParsedPath {                             │
│            schemaUri?  — extension namespace                   │
│            attrName    — top-level attribute                   │
│            subAttr?    — sub-attribute after "."               │
│            valueFilter? — [type eq "work"] predicate           │
│          }                                                     │
│                                                                │
│  Step 2: Resolve target attribute in schema registry           │
│          → AttributeDefinition { type, mutability, ... }       │
│                                                                │
│  Step 3: Check mutability                                      │
│          → readOnly: return 400 "mutability"                   │
│          → immutable + has value: return 400 "mutability"      │
│                                                                │
│  Step 4: Apply operation semantics                             │
│  ┌────────┬──────────────────────────────────────────────────┐ │
│  │ add    │ • No path: merge value object into resource       │ │
│  │        │ • Singular attr: set if unassigned                │ │
│  │        │ • Multi-valued attr: append to array              │ │
│  │        │ • Sub-attr of complex: set within complex obj     │ │
│  │        │ • Value filter + sub-attr: add to matching elems  │ │
│  ├────────┼──────────────────────────────────────────────────┤ │
│  │replace │ • No path: replace all attrs present in value     │ │
│  │        │ • Singular attr: overwrite value                  │ │
│  │        │ • Multi-valued attr: replace entire array         │ │
│  │        │ • Sub-attr of complex: overwrite within complex   │ │
│  │        │ • Value filter + sub-attr: overwrite in matches   │ │
│  ├────────┼──────────────────────────────────────────────────┤ │
│  │remove  │ • No path: return 400 "noTarget"                  │ │
│  │        │ • Singular attr: unset the attribute              │ │
│  │        │ • Multi-valued (no filter): clear entire array    │ │
│  │        │ • Multi-valued + filter: remove matching elements │ │
│  │        │ • Sub-attr of complex: unset within complex       │ │
│  └────────┴──────────────────────────────────────────────────┘ │
│                                                                │
│  Step 5: Validate result against schema (required attrs)       │
│  Step 6: Update version (ETag) and lastModified                │
│  Step 7: Return full updated resource (200) or 204 if no-op   │
└────────────────────────────────────────────────────────────────┘
```

### 6.3 Path Parser (Per RFC 7644 Figure 1 ABNF)

The path parser should handle ALL valid SCIM paths:

```
PATH              = attrPath / valuePath [.subAttr]
attrPath          = [URI ":"] ATTRNAME *1("." ATTRNAME)
valuePath         = attrPath "[" valFilter "]"
valFilter         = attrExp *1("and" / "or" attrExp)
attrExp           = attrPath SP compareOp SP compValue
compareOp         = "eq" / "ne" / "co" / "sw" / "ew" / 
                    "gt" / "lt" / "ge" / "le" / "pr"
```

**Key design principle**: The path parser and the filter parser share the same ABNF grammar. They should be a single parser implementation, not two separate ones.

### 6.4 Extension Schema Path Resolution

> **RFC 7644 §3.5.2**: "Clients MAY implicitly modify the 'schemas' attribute by adding an attribute with its fully qualified name, including schema URN."

When a PATCH path is `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber`:
1. Parse the URI prefix as the extension schema URN
2. Resolve `employeeNumber` within that extension's namespace
3. **Automatically add** the extension URN to the resource's `schemas` array if not already present
4. Conversely, when a `remove` operation removes the last extension attribute, **remove** the extension URN from `schemas`

### 6.5 PATCH Atomicity

Per RFC 7644 §3.5.2:
> "Each PATCH operation represents a single change to be applied to the same SCIM resource... all operations MUST be applied or nothing."

All operations within a single PATCH request must be **atomic** — if any operation fails, the entire PATCH is rolled back and the resource is unchanged.

---

## 7. Filter & Query Engine

### 7.1 What the RFC Says

> **RFC 7644 §3.4.2.2**: Filtering supports `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `lt`, `ge`, `le`, `pr` operators. Logical operators: `and`, `or`, `not`. Grouping with `()`. Attribute names and operators are case-insensitive. String comparison respects `caseExact`.

> **RFC 7644 §3.4.2.3**: Sorting is OPTIONAL but discoverable via ServiceProviderConfig.

> **RFC 7644 §3.4.2.4**: Pagination via `startIndex` (1-based) and `count`. Response includes `totalResults`, `startIndex`, `itemsPerPage`.

### 7.2 Recommended Design: Full Filter Parser

Build a proper parser for the SCIM filter ABNF (Figure 1 of RFC 7644):

```typescript
// Abstract Syntax Tree node types
type FilterNode =
  | { type: 'compare'; attrPath: AttrPath; op: CompareOp; value: CompValue }
  | { type: 'present'; attrPath: AttrPath }
  | { type: 'and'; left: FilterNode; right: FilterNode }
  | { type: 'or'; left: FilterNode; right: FilterNode }
  | { type: 'not'; operand: FilterNode }
  | { type: 'valuePath'; attrPath: AttrPath; filter: FilterNode };

type CompareOp = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'lt' | 'ge' | 'le';

interface AttrPath {
  schemaUri?: string;     // Extension URN prefix, if any
  attrName: string;       // Top-level attribute
  subAttr?: string;       // Sub-attribute after "."
}

// Parser entry point
function parseFilter(input: string): FilterNode { ... }
```

### 7.3 Filter Operators — Complete Semantics

| Operator | Name | Behavior | caseExact=false |
|----------|------|----------|-----------------|
| `eq` | Equal | Exact match | Case-insensitive comparison |
| `ne` | Not Equal | Negation of eq | Case-insensitive comparison |
| `co` | Contains | Substring match | Case-insensitive substring |
| `sw` | Starts With | Prefix match | Case-insensitive prefix |
| `ew` | Ends With | Suffix match | Case-insensitive suffix |
| `gt` | Greater Than | Lexicographic/numeric > | Case-insensitive comparison |
| `lt` | Less Than | Lexicographic/numeric < | Case-insensitive comparison |
| `ge` | Greater or Equal | >= | Case-insensitive comparison |
| `le` | Less or Equal | <= | Case-insensitive comparison |
| `pr` | Present | Attribute has a non-null value | N/A |

**Multi-valued attribute filtering**: When the filter targets a multi-valued attribute (e.g., `emails.value eq "user@example.com"`), the filter matches if **any** element in the array satisfies the condition.

### 7.4 Filter Evaluation Strategy

Two approaches depending on the persistence layer:

**Approach A — Database-side (recommended for production)**:
```
FilterNode → SQL/Query builder AST → Database query
```

For JSONB storage (PostgreSQL example):
```sql
-- eq filter on userName (caseExact=false)
WHERE tenant_id = $1
  AND resource_type = 'User'
  AND LOWER(data->>'userName') = LOWER($2)

-- co filter on emails.value (multi-valued complex attribute)
WHERE tenant_id = $1
  AND resource_type = 'User'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(data->'emails') elem
    WHERE LOWER(elem->>'value') LIKE '%' || LOWER($2) || '%'
  )

-- Compound: userName sw "J" and active eq true
WHERE tenant_id = $1
  AND resource_type = 'User'
  AND LOWER(data->>'userName') LIKE LOWER($2) || '%'
  AND (data->>'active')::boolean = true
```

**Approach B — Application-side (acceptable for test/dev server)**:
```
Fetch all resources for tenant → Evaluate FilterNode in-memory → Return matches
```

The in-memory evaluator is useful for development and for databases that don't support JSONB natively (like SQLite). A well-designed filter engine can support **both** strategies transparently.

### 7.5 POST-based Search (/.search)

> **RFC 7644 §3.4.3**: Clients may POST to `/.search` with a `SearchRequest` body containing `filter`, `sortBy`, `sortOrder`, `startIndex`, `count`, `attributes`, `excludedAttributes`.

```typescript
interface SearchRequest {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'];
  filter?: string;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
  startIndex?: number;
  count?: number;
  attributes?: string[];
  excludedAttributes?: string[];
}
```

Two levels of POST search:
- `POST {baseUrl}/.search` — searches across all resource types (RFC 7644 §3.4.3)
- `POST {baseUrl}/Users/.search` — searches within a resource type

This is required for queries that are too complex or sensitive for URL query strings (RFC 7644 §7.5.2: "Sensitive information SHALL NOT be transmitted over request URIs").

---

## 8. Discovery & ServiceProviderConfig

### 8.1 What the RFC Says

> **RFC 7644 §4**: Three discovery endpoints that MUST exist:
> - `/ServiceProviderConfig` — what the server can do
> - `/Schemas` — what schemas exist
> - `/ResourceTypes` — what resource types exist

> Filter/sort/pagination on discovery endpoints SHALL be ignored. If a filter is provided on ServiceProviderConfig, respond with 403 Forbidden.

> **RFC 7643 §5**: ServiceProviderConfig schema includes: `patch.supported`, `bulk.supported/maxOperations/maxPayloadSize`, `filter.supported/maxResults`, `changePassword.supported`, `sort.supported`, `etag.supported`, `authenticationSchemes[]`.

### 8.2 Recommended Design: Per-Tenant Dynamic Discovery

Each tenant should have **its own ServiceProviderConfig** reflecting its actual, truthful capabilities:

```typescript
function buildServiceProviderConfig(tenant: Tenant): ServiceProviderConfig {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: `https://scimtool.dev/docs/${tenant.name}`,
    patch: {
      supported: tenant.config.patchEnabled ?? true
    },
    bulk: {
      supported: tenant.config.bulkEnabled ?? false,
      maxOperations: tenant.config.bulkMaxOperations ?? 1000,
      maxPayloadSize: tenant.config.bulkMaxPayloadSize ?? 1048576
    },
    filter: {
      supported: true,
      maxResults: tenant.config.filterMaxResults ?? 200
    },
    changePassword: {
      supported: false
    },
    sort: {
      supported: tenant.config.sortEnabled ?? true
    },
    etag: {
      supported: true
    },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using the OAuth Bearer Token Standard',
        specUri: 'https://www.rfc-editor.org/info/rfc6750',
        documentationUri: 'https://scimtool.dev/docs/auth',
        primary: true
      }
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: `${tenant.baseUrl}/ServiceProviderConfig`
    }
  };
}
```

### 8.3 /Schemas — Generated from Schema Registry

The `/Schemas` endpoint should return schemas **dynamically generated from the schema registry**, not from hardcoded JSON. This ensures:
- Custom extensions appear in `/Schemas`
- Per-tenant schema customizations are reflected
- The schema definition matches actual server behavior

```
GET /scim/v2/{tenantId}/Schemas
→ ListResponse of all schemas active for this tenant
   (core:User, core:Group, extension:enterprise:2.0:User, any custom)

GET /scim/v2/{tenantId}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User
→ Single schema definition with full attribute metadata
```

### 8.4 /ResourceTypes — Generated from Resource Type Registry

```
GET /scim/v2/{tenantId}/ResourceTypes
→ ListResponse of all resource types active for this tenant

GET /scim/v2/{tenantId}/ResourceTypes/User
→ Single resource type definition:
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
  "id": "User",
  "name": "User",
  "endpoint": "/Users",
  "description": "User Account",
  "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
  "schemaExtensions": [
    {
      "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
      "required": false
    }
  ],
  "meta": {
    "location": "https://host/scim/v2/{tenantId}/ResourceTypes/User",
    "resourceType": "ResourceType"
  }
}
```

### 8.5 The Discovery-Behavior Contract

**Critical principle**: What discovery says **MUST** match what the server actually does. If `/ServiceProviderConfig` says `bulk.supported: false`, then `POST /Bulk` should return `501 Not Implemented`. If `filter.supported: true`, then all RFC-defined filter operators must work. The discovery endpoints are a **contract**, not a suggestion.

---

## 9. Bulk Operations

### 9.1 What the RFC Says

> **RFC 7644 §3.7**: POST to `/Bulk` with `BulkRequest` schema. Body contains `Operations[]` each with `method`, `path`, `bulkId`, `data`, `version`. Supports cross-referencing via `bulkId:` URI scheme. `failOnErrors` controls error behavior.

### 9.2 Recommended Design

```typescript
interface BulkOperation {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;            // e.g., "/Users" or "/Users/{id}"
  bulkId?: string;         // For cross-referencing in POST operations
  version?: string;        // ETag for conditional operations
  data?: unknown;          // Request body for POST/PUT/PATCH
}

interface BulkRequest {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'];
  failOnErrors?: number;   // Stop after N errors (0 = don't stop)
  Operations: BulkOperation[];
}

interface BulkResponse {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'];
  Operations: Array<{
    method: string;
    bulkId?: string;
    version?: string;
    location?: string;      // URI of created/modified resource
    status: string;         // HTTP status code as string
    response?: unknown;     // Error body or created resource
  }>;
}
```

### 9.3 Key Implementation Requirements

1. **bulkId Resolution**: When `data` contains `"bulkId:abc123"` as a value (e.g., in a Group member's `value` field), resolve it to the actual resource `id` from a prior POST in the same batch.

2. **Ordering**: Operations MUST be processed in order. Create User before adding them to a Group.

3. **failOnErrors**: If specified, the server tracks error count. When `failOnErrors` is reached, remaining operations are skipped and their status shows as not attempted.

4. **Circular References**: Per RFC 7644 §3.7.1, the server should attempt to resolve circular references (e.g., User references Group which references User). If impossible, return 409 conflict.

5. **Size Limits**: `maxOperations` and `maxPayloadSize` from ServiceProviderConfig are enforced. If exceeded, return 413 Payload Too Large.

6. **Transaction Semantics**: Ideally, the entire bulk operation is wrapped in a database transaction for atomicity. If the database doesn't support this, operations are best-effort.

---

## 10. ETag & Conditional Operations

### 10.1 What the RFC Says

> **RFC 7644 §3.14**: Service providers MAY support weak ETags. ETags MUST be returned as HTTP headers AND in `meta.version`. Clients use `If-Match` for PUT/PATCH/DELETE (optimistic concurrency), `If-None-Match` for conditional GET (caching).

### 10.2 Recommended Design

Every resource mutation (create, update, patch) generates a new ETag:

```typescript
function generateETag(resource: ScimResource): string {
  // Content-hash approach — deterministic and verifiable
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(resource.data) + resource.lastModified.toISOString())
    .digest('hex')
    .substring(0, 16);
  return `W/"${hash}"`;
}
```

### 10.3 Conditional Operation Matrix

| Header | Method | Behavior | Error |
|--------|--------|----------|-------|
| `If-Match: W/"abc"` | PUT | Proceed only if current ETag matches | 412 Precondition Failed |
| `If-Match: W/"abc"` | PATCH | Proceed only if current ETag matches | 412 Precondition Failed |
| `If-Match: W/"abc"` | DELETE | Proceed only if current ETag matches | 412 Precondition Failed |
| `If-None-Match: W/"abc"` | GET | Return 304 Not Modified if ETag matches | (not an error) |
| `If-None-Match: *` | POST | Prevent duplicate creation | 409 Conflict |
| No header | Any | Unconditional — always proceed | — |

### 10.4 ETag Storage

The `version` column in ScimResource stores the current ETag. On every write:
1. Compute new ETag from updated content
2. Store in `version` column
3. Return as `ETag` HTTP header
4. Include in `meta.version` in response body

---

## 11. Error Model

### 11.1 What the RFC Says

> **RFC 7644 §3.12**: All errors MUST use `urn:ietf:params:scim:api:messages:2.0:Error` schema. Required fields: `status` (string!), `scimType` (optional, from Table 9), `detail` (human-readable).

### 11.2 Recommended Design: Centralized Error Factory

```typescript
class ScimError extends Error {
  constructor(
    public readonly status: number,
    public readonly scimType?: ScimErrorType,
    public readonly detail?: string
  ) {
    super(detail || scimType || `HTTP ${status}`);
  }

  toResponse(): object {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: String(this.status),  // RFC requires string, not number!
      ...(this.scimType && { scimType: this.scimType }),
      ...(this.detail && { detail: this.detail })
    };
  }
}
```

### 11.3 RFC 7644 Table 9 — scimType Values

| scimType | Status | Meaning |
|----------|--------|---------|
| `invalidFilter` | 400 | Bad filter syntax or unsupported filter |
| `tooMany` | 400 | Too many results to return |
| `uniqueness` | 409 | Uniqueness constraint violation |
| `mutability` | 400 | Attempted to modify readOnly/immutable attribute |
| `invalidSyntax` | 400 | Request body is not valid JSON or violates schema |
| `invalidPath` | 400 | PATCH path is invalid or doesn't exist in schema |
| `noTarget` | 400 | PATCH target (via filter) matched nothing, or remove without path |
| `invalidValue` | 400 | Attribute value is invalid (wrong type, out of range) |
| `invalidVers` | 400 | Invalid version in bulk operation |
| `sensitive` | 400 | Sensitive data in URI (use POST search instead) |

### 11.4 HTTP Status Code Usage (Per RFC 7644 Table 8)

| Status | When | Response Content |
|--------|------|------------------|
| 200 | Successful GET, PUT, PATCH, Bulk, Search | Resource or ListResponse body |
| 201 | Successful POST (create) | `Location` header + created resource body |
| 204 | Successful DELETE | No body |
| 304 | Conditional GET — ETag matches | No body |
| 400 | Bad request (with scimType detail) | Error body |
| 401 | Missing or invalid authentication | `WWW-Authenticate` header + Error body |
| 403 | Forbidden (inactive tenant, filter on /ServiceProviderConfig) | Error body |
| 404 | Resource not found | Error body |
| 409 | Conflict (uniqueness violation, bulk circular reference) | Error body |
| 412 | ETag precondition failed | Error body |
| 413 | Bulk payload too large | Error body |
| 500 | Internal server error | Error body |
| 501 | Feature not implemented (unsupported operation) | Error body |

---

## 12. Extension Model

### 12.1 What the RFC Says

> **RFC 7643 §3.3**: "SCIM allows resource types to have extensions in addition to their core schema." Extensions are identified by schema URIs and appear as namespaced attributes.

> **RFC 7643 §4.3**: Enterprise User extension is the canonical example: `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`

> Extensions appear as top-level keys in the resource JSON, keyed by their schema URI:
> ```json
> {
>   "schemas": ["urn:...User", "urn:...enterprise:2.0:User"],
>   "userName": "bjensen",
>   "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
>     "employeeNumber": "701984",
>     "costCenter": "4130"
>   }
> }
> ```

### 12.2 Recommended Design: Extension Registry

Extensions are first-class citizens with their own schema definitions:

```typescript
interface SchemaExtension {
  id: string;                      // Full schema URI
  name: string;                    // Human-readable name
  description: string;
  attributes: AttributeDefinition[];  // Same structure as core attributes
}

// Built-in extension: Enterprise User
schemaRegistry.registerExtension({
  id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  name: 'Enterprise User',
  description: 'Enterprise User Extension per RFC 7643 §4.3',
  attributes: [
    { name: 'employeeNumber', type: 'string', mutability: 'readWrite', returned: 'default' },
    { name: 'costCenter', type: 'string', mutability: 'readWrite', returned: 'default' },
    { name: 'organization', type: 'string', mutability: 'readWrite', returned: 'default' },
    { name: 'division', type: 'string', mutability: 'readWrite', returned: 'default' },
    { name: 'department', type: 'string', mutability: 'readWrite', returned: 'default' },
    { name: 'manager', type: 'complex', mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'value', type: 'string', mutability: 'readWrite' },
        { name: '$ref', type: 'reference', referenceTypes: ['User'], mutability: 'readWrite' },
        { name: 'displayName', type: 'string', mutability: 'readOnly', returned: 'default' }
      ]
    }
  ]
});
```

### 12.3 Custom Extension Support

The server should support **custom extensions** registered per-tenant at runtime:

```json
POST /admin/tenants/{id}/extensions
{
  "id": "urn:example:scim:schemas:custom:1.0:Employee",
  "name": "Custom Employee Fields",
  "description": "Organization-specific employee attributes",
  "attributes": [
    { "name": "badgeNumber", "type": "string", "required": false, "mutability": "readWrite", "returned": "default" },
    { "name": "building", "type": "string", "required": false, "mutability": "readWrite", "returned": "default" },
    { "name": "floorNumber", "type": "integer", "required": false, "mutability": "readWrite", "returned": "default" }
  ]
}
```

Once registered:
- `/Schemas` includes the new extension schema
- `/ResourceTypes` shows the extension in `schemaExtensions`
- POST/PUT/PATCH operations accept the namespaced attributes
- Responses include extension data under the schema URI key
- Filter expressions can target extension attributes (e.g., `urn:example:...:Employee:badgeNumber eq "12345"`)

### 12.4 Extension Lifecycle Rules

1. **Schema URI is the primary key** — each extension is identified by its full URI
2. **`schemas` array is auto-managed** — adding extension data adds the URI; removing all extension data removes the URI
3. **Validation uses extension schema** — attribute characteristics (type, required, mutability, returned) apply to extension attributes just like core attributes
4. **Extensions are per-resource-type** — an extension can be linked to one or more resource types via `schemaExtensions` in the ResourceType definition

---

## 13. Security Architecture

### 13.1 What the RFCs Say

> **RFC 7644 §2**: OAuth 2.0 bearer tokens RECOMMENDED. HTTP Basic over TLS acceptable. Service providers MUST support TLS.

> **RFC 7644 §7.5.2**: "Sensitive information SHALL NOT be transmitted over request URIs." This is why POST-based search exists.

> **RFC 7643 §9.3**: Privacy — "Information should be shared on an as-needed basis." Per-tenant identifier isolation is recommended.

> **RFC 7644 §7**: Full security considerations section covering TLS, token validation, bearer token risks, cross-tenant isolation.

### 13.2 Recommended Auth Design

```
┌──────────────────────────────────────────────────┐
│              Authentication Flow                  │
│                                                    │
│  1. Request arrives                                │
│  2. Extract Authorization header                   │
│     → "Bearer {token}" or "Basic {base64}"         │
│  3. Validate token:                                │
│     a. JWT: verify signature, issuer, expiry       │
│     b. Opaque: introspect with auth server         │
│     c. Shared secret: compare with tenant config   │
│  4. Extract tenant claim from token                │
│     → Must match {tenantId} in URL path            │
│  5. Verify tenant is active                        │
│  6. Set tenant context for request                 │
│  7. Apply authorization scopes                     │
│                                                    │
│  Per-Tenant Auth Modes:                            │
│  ┌──────────────────────────────────────────┐      │
│  │ Mode          │ Use Case                 │      │
│  ├───────────────┼──────────────────────────┤      │
│  │ Bearer Token  │ Production IdP           │      │
│  │ Client Creds  │ Service-to-service       │      │
│  │ Shared Secret │ Testing/development      │      │
│  │ None          │ Open testing endpoint    │      │
│  └──────────────────────────────────────────┘      │
└────────────────────────────────────────────────────┘
```

### 13.3 Per-Tenant Auth Isolation

| Security Property | Requirement |
|-------------------|-------------|
| **Token binding** | Token is bound to a specific tenant; cannot access other tenants' data |
| **Credential isolation** | Each tenant has unique credentials (client_id/secret, shared token, etc.) |
| **Password handling** | `password` attribute has `returned: "never"` and `mutability: "writeOnly"` |
| **Audit logging** | All operations logged with tenant_id, actor, timestamp, resource, operation |
| **Rate limiting** | Per-tenant rate limits to prevent abuse and ensure fair usage |
| **TLS required** | All connections must use HTTPS in production (RFC 7644 §7.1) |
| **Cross-tenant isolation** | No API call can read or modify another tenant's resources |

---

## 14. Persistence Layer (Database-Agnostic)

### 14.1 Design for Swappable Storage

The SCIM server should define a **storage interface** and allow different implementations. This separates protocol logic from persistence concerns:

```typescript
interface ScimResourceStore {
  // === CRUD ===
  create(tenantId: string, resourceType: string, data: Resource): Promise<StoredResource>;
  get(tenantId: string, resourceType: string, scimId: string): Promise<StoredResource | null>;
  replace(tenantId: string, resourceType: string, scimId: string, data: Resource, ifMatch?: string): Promise<StoredResource>;
  patch(tenantId: string, resourceType: string, scimId: string, ops: PatchOp[], ifMatch?: string): Promise<StoredResource>;
  delete(tenantId: string, resourceType: string, scimId: string, ifMatch?: string): Promise<void>;

  // === Query ===
  list(tenantId: string, resourceType: string, options: ListOptions): Promise<ListResult>;
  search(tenantId: string, filter: FilterNode, options: ListOptions): Promise<ListResult>;

  // === Membership (Group members) ===
  addMembers(tenantId: string, groupScimId: string, members: MemberRef[]): Promise<void>;
  removeMembers(tenantId: string, groupScimId: string, memberScimIds: string[]): Promise<void>;
  replaceMembers(tenantId: string, groupScimId: string, members: MemberRef[]): Promise<void>;
  getMembers(tenantId: string, groupScimId: string): Promise<MemberRef[]>;

  // === Bulk ===
  bulk(tenantId: string, operations: BulkOperation[]): Promise<BulkResult>;
}

interface ListOptions {
  filter?: FilterNode;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
  startIndex?: number;       // 1-based
  count?: number;
  attributes?: string[];
  excludedAttributes?: string[];
}

interface ListResult {
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  resources: StoredResource[];
}

interface StoredResource {
  scimId: string;
  externalId?: string;
  version: string;           // ETag
  data: Record<string, unknown>;
  createdAt: Date;
  lastModified: Date;
}

interface MemberRef {
  value: string;             // Member's scimId
  $ref: string;              // Full URI to member resource
  type: string;              // "User" or "Group"
  display?: string;          // Display name (denormalized)
}
```

### 14.2 Store Implementations

| Store | Use Case | Filter Support | Notes |
|-------|----------|---------------|-------|
| `InMemoryStore` | Unit testing | Full (in-memory eval) | Fast, disposable, no setup |
| `SqliteStore` | Development, demos | Limited (app-side eval) | Single-file DB, zero config |
| `PostgresStore` | Production | Full (JSONB + GIN) | Recommended for production |
| `CosmosDbStore` | Azure cloud | Full (SQL API queries) | Global distribution, auto-scale |
| `MongoStore` | MongoDB stack | Full (native doc queries) | Natural document model |

### 14.3 The Storage Interface Enables Testing

By programming against the interface, you can:
- Run 100% of protocol tests against `InMemoryStore` (fast, CI-friendly)
- Run integration tests against `SqliteStore` (catch SQL edge cases)
- Run production tests against `PostgresStore` (validate GIN index behavior)
- Swap storage in deployment without changing protocol code

---

## 15. The /Me Endpoint

### 15.1 What the RFC Says

> **RFC 7644 §3.11**: "A SCIM service provider MAY provide a /Me alias for the authenticated subject." The /Me endpoint supports GET, PUT, PATCH, DELETE. GET returns the current user. PATCH/PUT modify the current user. DELETE deactivates/removes the current user.

### 15.2 Recommended Design

The `/Me` endpoint resolves the authenticated user's identity and delegates to the standard resource endpoint:

```typescript
// GET /scim/v2/{tenantId}/Me → resolve to GET /scim/v2/{tenantId}/Users/{authenticatedUserId}
async handleMeGet(authContext: AuthContext): Promise<Resource> {
  const userId = await resolveAuthenticatedUser(authContext);
  return this.usersService.get(authContext.tenantId, userId);
}
```

Resolution strategies:
1. **JWT `sub` claim** → look up user by externalId or userName
2. **Token introspection** → extract user identity from token metadata
3. **Mapped claim** → tenant-configurable claim-to-attribute mapping

---

## 16. Sorting & Pagination

### 16.1 What the RFC Says

> **RFC 7644 §3.4.2.3**: `sortBy` specifies the attribute to sort by. `sortOrder` is "ascending" (default) or "descending". Sorting is OPTIONAL.

> **RFC 7644 §3.4.2.4**: `startIndex` (1-based, default 1) and `count` (server-chosen default). Response includes `totalResults`, `startIndex`, `itemsPerPage`.

### 16.2 Recommended Design

```typescript
interface PaginatedResponse<T> {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;     // Total matching resources (not page size)
  startIndex: number;       // 1-based index of first result in this page
  itemsPerPage: number;     // Number of resources in this page
  Resources: T[];           // The actual resources
}
```

**Pagination rules per RFC**:
- `startIndex` defaults to 1 (not 0!)
- `count` of 0 means "return zero resources but still return totalResults"
- If `count` > total remaining, return whatever is left
- Response `itemsPerPage` reflects the actual count of resources returned

**Sorting rules**:
- `sortBy` is a single SCIM attribute path (e.g., `userName`, `name.familyName`, `meta.lastModified`)
- `sortOrder` defaults to "ascending"
- If `sortBy` is not supported, return 400 `invalidFilter`
- `caseExact` from the attribute's schema definition governs sort collation

---

## 17. Current Implementation Gap Analysis

### 17.1 RFC Compliance Gaps

> **Phase 1 (Foundation — RFC Compliance Core) was completed Feb 2026.** Items marked ✅ below are now implemented and covered by 492 unit tests + 212 live integration tests.

| RFC Requirement | RFC Section | Current State | Status |
|----------------|-------------|---------------|--------|
| **Filter operators** beyond `eq` | 7644 §3.4.2.2 | `eq` fully implemented (case-insensitive); `co`, `sw`, `ew`, `gt`, `lt`, `ge`, `le`, `ne` supported via ABNF parser | ✅ Implemented |
| **Schema-driven validation** | 7643 §7 | Hardcoded per-attribute logic | 🔴 **Phase 2** |
| **POST /.search** | 7644 §3.4.3 | ✅ Implemented for Users and Groups with filter, pagination, attributes, excludedAttributes | ✅ Implemented |
| **Bulk operations** | 7644 §3.7 | Not implemented (correctly advertised as `bulk.supported: false`) | 🟡 Optional |
| **Sorting** | 7644 §3.4.2.3 | Not implemented (correctly advertised as `sort.supported: false`) | 🟡 Optional |
| **ETag conditional enforcement** | 7644 §3.14 | ✅ Weak ETags on all responses; `If-None-Match` → 304 Not Modified | ✅ Implemented |
| **`attributes`/`excludedAttributes` params** | 7644 §3.9 | ✅ Implemented on all GET and POST /.search endpoints (Users + Groups) | ✅ Implemented |
| **`returned` characteristic** | 7643 §2.2 | Not enforced — all attributes always returned | 🟡 Phase 2 |
| **`mutability` on PUT** | 7644 §3.5.1 | Not enforced — readOnly attributes accepted | 🟡 Phase 2 |
| **Dynamic ServiceProviderConfig** | 7644 §4 | Hardcoded JSON; same for all tenants | 🟡 Phase 2 |
| **Dynamic /Schemas** | 7644 §4 | Hardcoded JSON | 🟡 Phase 2 |
| **Dynamic /ResourceTypes** | 7644 §4 | Hardcoded JSON | 🟡 Phase 2 |
| **PATCH path: full ABNF** | 7644 Figure 1 | ✅ valuePath filter, extension URN, no-path merge, dot-notation (via VerbosePatchSupported flag) | ✅ Implemented |
| **PATCH: implicit schemas update** | 7644 §3.5.2 | Not implemented | 🟢 Low |
| **`caseExact` on filtering** | 7643 §2.2 | All attributes treated as case-insensitive (correct for userName, emails; per RFC) | 🟢 Low |
| **`/Me` endpoint** | 7644 §3.11 | Not implemented | 🟢 Optional |
| **Multi-tenancy URL pattern** | 7644 §6 | `/scim/endpoints/{id}` leaks implementation term | 🟢 Low (cosmetic) |
| **`$ref` in Group members** | 7643 §4.2 | Not returned in member references | 🟢 Low |
| **`changePassword` support** | 7644 §3.5.2 | Not implemented | 🟢 Optional |

### 17.2 Architecture Gaps

| Area | Current State | Ideal (RFC-First) State |
|------|--------------|-------------------------|
| **Data model** | Column-per-attribute + `rawPayload` JSON blob | Single `data` JSONB document per resource |
| **Schema registry** | Hardcoded schema JSON in controllers | Programmatic registry with per-tenant customization |
| **Resource type system** | Hardcoded User + Group with separate services | Pluggable resource type registry with generic handler |
| **Attribute processing** | Per-attribute hardcoded logic in each service | Schema-characteristic-driven `AttributeProcessor` |
| **Filter engine** | In-memory `eq`-only comparison | Parsed AST with database-side evaluation for all operators |
| **Storage interface** | Direct Prisma calls scattered across services | Abstract `ScimResourceStore` with multiple implementations |
| **Discovery endpoints** | Duplicated hardcoded JSON in 3+ controllers | Auto-generated from schema and resource type registries |
| **Config system** | 11 flags stored as JSON string, parsed per request | Typed per-tenant configuration with validation |
| **Error handling** | Mix of NestJS exceptions and SCIM error objects | Unified `ScimError` class through NestJS exception filter |
| **PATCH engine** | Split across service and utils with partial path support | Centralized engine with full ABNF parser |
| **Auth system** | Hardcoded legacy token + partial OAuth | Per-tenant configurable auth with JWT validation |
| **Test architecture** | Mock-heavy unit tests | Contract tests against RFC-defined examples + store interface tests |

### 17.3 Code Hygiene Issues

| Issue | Impact | Remediation |
|-------|--------|-------------|
| Duplicate mega-controller (498 lines) exists but is unused | Maintenance hazard, confusion | Delete the file |
| Legacy services (1000+ lines) retained but unwired | Dead code | Delete or archive |
| Schema JSON duplicated in 3+ files | Inconsistency risk | Single source of truth via schema registry |
| `AsyncLocalStorage.enterWith()` in context storage | Context leak across requests | Switch to `run()` with callback |
| Hardcoded legacy credential in auth guard | Security vulnerability | Remove; use per-tenant config only |
| `whitelist: true` in ValidationPipe | Accepts malformed properties silently | Switch to strict DTO validation |
| In-memory filtering fetches ALL records | Won't scale beyond thousands | Database-side query evaluation |
| Config stored as JSON string blob | Parsed on every request, no type safety | Typed configuration interface with caching |

---

## 18. Implementation Roadmap

### Phase 1: Foundation — RFC Compliance Core ✅ COMPLETED (Feb 2026)

**Goal**: Make the existing server truthfully RFC-compliant for the features it already supports.

> **All 7 tasks completed.** 492 unit tests, 212 live integration tests, all 25 Microsoft SCIM Validator tests passing.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Build full SCIM filter parser (ABNF-based, 10 operators, `and`/`or`/`not`, grouping, value paths) | ✅ Done | `scim-filter-parser.ts` + `apply-scim-filter.ts` |
| 1.2 | Implement `attributes` / `excludedAttributes` on all endpoints (Users + Groups, GET + POST /.search) | ✅ Done | `scim-attribute-projection.ts` |
| 1.3 | ETag / `If-None-Match` → 304 Not Modified | ✅ Done | `scim-etag.interceptor.ts` |
| 1.4 | POST `/.search` endpoint (Users + Groups) | ✅ Done | `search-request.dto.ts` |
| 1.5 | Centralize error handling — `ScimError` class + NestJS exception filter | ✅ Done | `scim-exception.filter.ts` |
| 1.6 | Clean up dead code | ✅ Done | Mega-controller, legacy services removed |
| 1.7 | `Content-Type: application/scim+json` on all responses (including errors) | ✅ Done | `scim-content-type.interceptor.ts` |

### Phase 2: Schema Engine — The Core Abstraction

**Goal**: Move from hardcoded-per-attribute logic to a schema-driven engine.

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 2.1 | Build schema registry (load core schemas from JSON definitions at startup) | 🔴 Critical | Large |
| 2.2 | Build `AttributeProcessor` (mutability, returned, caseExact, uniqueness enforcement) | 🔴 Critical | Large |
| 2.3 | Generate `/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig` dynamically from registry | 🟡 Medium | Medium |
| 2.4 | Schema-validate all incoming resources on POST/PUT using registry definitions | 🟡 Medium | Medium |
| 2.5 | Move PATCH path parsing to shared parser with filter engine | 🟡 Medium | Medium |

### Phase 3: Storage Abstraction — Decouple Persistence

**Goal**: Separate SCIM protocol logic from database implementation.

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 3.1 | Define `ScimResourceStore` interface (CRUD, query, membership, bulk) | 🔴 Critical | Medium |
| 3.2 | Implement `InMemoryStore` for testing | 🟡 Medium | Medium |
| 3.3 | Implement `SqliteStore` (preserves backward compatibility) | 🟡 Medium | Large |
| 3.4 | Refactor services to use store interface instead of direct Prisma calls | 🟡 Medium | Large |
| 3.5 | Migrate data model: columnar → document-based (with migration tool) | 🟡 Medium | Large |

### Phase 4: Multi-Tenant Excellence

**Goal**: Make each tenant a fully independent, configurable SCIM service.

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 4.1 | Rename "endpoint" to "tenant" in URL paths and admin API | 🟢 Low | Medium |
| 4.2 | Per-tenant ServiceProviderConfig (truthfully reflects tenant capabilities) | 🟡 Medium | Small |
| 4.3 | Per-tenant schema extensions and resource type registrations | 🟡 Medium | Medium |
| 4.4 | Per-tenant auth configuration (bearer, client creds, shared secret, none) | 🟡 Medium | Large |
| 4.5 | Per-tenant behavior flags with typed configuration | 🟡 Medium | Medium |

### Phase 5: Advanced Features — Full RFC Coverage

**Goal**: Implement the remaining optional RFC features.

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 5.1 | Bulk operations engine (bulkId resolution, failOnErrors, atomicity) | 🟡 Medium | Large |
| 5.2 | Sorting support (sortBy, sortOrder, caseExact-aware) | 🟡 Medium | Medium |
| 5.3 | Resource type plugin system (register custom types with auto-routing) | 🟡 Medium | Large |
| 5.4 | Custom extension registration API (per-tenant runtime extensions) | 🟡 Medium | Large |
| 5.5 | `/Me` authenticated subject alias | 🟢 Low | Small |
| 5.6 | `$ref` in Group member responses | 🟢 Low | Small |
| 5.7 | PostgreSQL JSONB store implementation (production-grade) | 🟡 Medium | Large |

---

## Summary: The North Star Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     SCIM Multi-Tenant Server                             │
│                                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────────────────┐ │
│  │   Routing     │  │   Auth Guard  │  │   Tenant Context               │ │
│  │   Layer       │  │   (per-tenant │  │   (AsyncLocalStorage.run()     │ │
│  │   (dynamic    │  │    config)    │  │    scoped to request)          │ │
│  │    routes per │  │               │  │                                │ │
│  │    resource   │  │               │  │                                │ │
│  │    type)      │  │               │  │                                │ │
│  └──────┬────────┘  └──────┬────────┘  └────────────┬───────────────────┘ │
│         │                  │                         │                    │
│  ┌──────▼──────────────────▼─────────────────────────▼─────────────────┐  │
│  │                     SCIM Protocol Engine                             │  │
│  │                                                                      │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐   │  │
│  │  │ Schema Registry  │  │ Filter Parser   │  │ PATCH Engine       │   │  │
│  │  │ (definitions,   │  │ (full ABNF,     │  │ (shared path       │   │  │
│  │  │  extensions,    │  │  all operators,  │  │  parser, op        │   │  │
│  │  │  characteristics│  │  AST → SQL/mem) │  │  router,           │   │  │
│  │  │  per tenant)    │  │                  │  │  mutability check) │   │  │
│  │  └───────┬─────────┘  └────────┬─────────┘  └────────┬───────────┘   │  │
│  │          │                     │                      │              │  │
│  │  ┌───────▼─────────────────────▼──────────────────────▼───────────┐  │  │
│  │  │                Attribute Processor                              │  │  │
│  │  │  (mutability, returned, caseExact, uniqueness, required,       │  │  │
│  │  │   type validation — ALL driven by schema definitions)          │  │  │
│  │  └──────────────────────────┬─────────────────────────────────────┘  │  │
│  │                             │                                        │  │
│  │  ┌──────────────────────────▼─────────────────────────────────────┐  │  │
│  │  │              Generic Resource Handler                           │  │  │
│  │  │  (one handler for ALL resource types — create, read, replace,  │  │  │
│  │  │   patch, delete, list, search, bulk — no per-type hardcoding)  │  │  │
│  │  └──────────────────────────┬─────────────────────────────────────┘  │  │
│  └─────────────────────────────┼────────────────────────────────────────┘  │
│                                │                                          │
│  ┌─────────────────────────────▼────────────────────────────────────────┐  │
│  │                     Storage Interface                                │  │
│  │                     (ScimResourceStore)                               │  │
│  │                                                                      │  │
│  │  ┌───────────┐  ┌────────────┐  ┌───────────┐  ┌─────────────────┐  │  │
│  │  │ InMemory  │  │  SQLite    │  │ Postgres  │  │ CosmosDB /      │  │  │
│  │  │ Store     │  │  Store     │  │ Store     │  │ Mongo Store     │  │  │
│  │  │ (tests)   │  │  (dev)     │  │ (prod)    │  │ (cloud)         │  │  │
│  │  └───────────┘  └────────────┘  └───────────┘  └─────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Discovery (Auto-Generated)                       │  │
│  │                                                                      │  │
│  │  /ServiceProviderConfig  ← truthfully built from tenant config       │  │
│  │  /Schemas                ← dynamically from schema registry          │  │
│  │  /ResourceTypes          ← dynamically from resource type registry   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### The Three Key Shifts

| From (Current) | To (RFC-First) |
|----------------|----------------|
| **Hardcoded per-resource logic** — separate UserService, GroupService with duplicated CRUD | **Generic resource handler** — one handler processes any resource type through schema-driven rules |
| **Column-per-attribute persistence** — schema migrations for every attribute change | **Document-based storage** — JSONB stores any resource shape; schema changes need zero DB migrations |
| **Static discovery responses** — same hardcoded JSON for all tenants | **Dynamic discovery** — per-tenant, truthful, auto-generated from registries |

### Design Philosophy Summarized

> **This architecture treats SCIM schemas as runtime data, not compile-time code.**
>
> Adding a new resource type, extension, or attribute characteristic requires **zero code changes** — only configuration. The server is a generic SCIM protocol engine that any organization can configure for their identity management needs.
>
> The SCIM RFCs designed the protocol to be this way. The schema definition format (RFC 7643 §7), the resource type system (RFC 7643 §6), and the discovery endpoints (RFC 7644 §4) all point to a server that is **self-describing, extensible, and discoverable by design**.

---

> _"Make it fast, cheap, and easy to move users in to, out of, and around the cloud."_  
> — RFC 7642 §2.1, summarizing the motivation behind SCIM
