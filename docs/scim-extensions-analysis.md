# SCIM Extensions Analysis — Enterprise & Custom Extensions

> **⚠️ SUPERSEDED** — This v1 document (Feb 16) has been superseded by the v3 architecture docs (Feb 20, 2026). The code-driven `IScimExtension` pattern described here was replaced by a data-driven `tenant_schema` + `tenant_resource_type` model. **Retained for**: concrete extension implementation examples, `IScimExtension` interface reference, hybrid storage analysis, and the new-extension checklist.
> **See**: [`IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md`](IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md) · [`MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md`](MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md)

> **Date**: February 16, 2026
> **Scope**: Full analysis of SCIM extension support per RFCs and current SCIMServer project
> **Stack**: NestJS · TypeScript · Prisma 7 · Node.js ≥ 24
> **Status**: Reference Architecture & Gap Analysis (Superseded)

---

## Table of Contents

- [1. RFC Specification Summary](#1-rfc-specification-summary)
- [2. Enterprise Extension (RFC 7643 §4.3)](#2-enterprise-extension-rfc-7643-43)
- [3. Custom Extension Pattern](#3-custom-extension-pattern)
- [4. Schema & ResourceType Discovery](#4-schema--resourcetype-discovery)
- [5. PATCH Operations on Extensions](#5-patch-operations-on-extensions)
- [6. Filtering on Extension Attributes](#6-filtering-on-extension-attributes)
- [7. Current Project Gap Analysis](#7-current-project-gap-analysis)
- [8. Pluggable Extension Framework Design](#8-pluggable-extension-framework-design)
- [9. Implementation Reference Code](#9-implementation-reference-code)
- [10. API Interaction Examples](#10-api-interaction-examples)
- [11. Adding a New Custom Extension Checklist](#11-adding-a-new-custom-extension-checklist)
- [12. References](#12-references)

---

## 1. RFC Specification Summary

Based on **RFC 7643** (Core Schema) and **RFC 7644** (Protocol):

### 1.1 Key Rules

| Rule                   | Detail                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| **URN format**         | Extensions SHOULD use URN notation (e.g., `urn:ietf:params:scim:schemas:extension:...`)       |
| **Namespace isolation**| Extension attributes live under their schema URI key — they do NOT pollute the core namespace  |
| **Schema discovery**   | Extensions MUST be discoverable via the `/Schemas` endpoint (RFC 7644 §4)                     |
| **`required` flag**    | Each extension can declare whether it is required or optional via `/ResourceTypes`             |
| **No collisions**      | Attributes are scoped under the URI — no conflict with core attributes or other extensions     |
| **CRUD operations**    | Extensions participate fully in CRUD — filter, sort, patch, etc.                              |
| **PATCH support**      | Path syntax uses the schema URI prefix: `urn:...:enterprise:2.0:User:department`              |

### 1.2 Extension Identification (RFC 7643 §3.3)

- Any SCIM resource can be extended with one or more schema extensions.
- Extensions are identified by their **schema URI**.
- The extension URI is added to the resource's `schemas` array to indicate the extension is present.
- Extension attributes are **namespaced under the extension URI** as a JSON object within the resource.

Example:

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "userName": "bjensen",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "12345",
    "department": "Engineering"
  }
}
```

### 1.3 Client Compatibility

The RFCs explicitly state that a server **MUST NOT** require a client to understand an extension to interact with core resources. If an extension is marked `"required": false`, a client can ignore it entirely and still function.

### 1.4 RFC 7643 §8.7 — ResourceType Representation

The `/ResourceTypes` endpoint declares which extensions apply to a resource and whether they're required:

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
  "id": "User",
  "name": "User",
  "endpoint": "/Users",
  "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
  "schemaExtensions": [
    {
      "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
      "required": false
    }
  ]
}
```

### 1.5 Best Practices from the RFCs

1. **Use a unique URN** for your organization — e.g., `urn:ietf:params:scim:schemas:extension:myorg:2.0:CustomUser`
2. **Register the schema** via the `/Schemas` endpoint so clients can discover it
3. **Declare the extension** in `/ResourceTypes` with the appropriate `required` flag
4. **Keep extensions modular** — prefer multiple small extensions over one monolithic one
5. **Extension attributes follow the same type system** as core (String, Boolean, Complex, Multi-valued, etc.)

---

## 2. Enterprise Extension (RFC 7643 §4.3)

### 2.1 Schema URI

```
urn:ietf:params:scim:schemas:extension:enterprise:2.0:User
```

### 2.2 Attribute Map

```
┌─────────────────────────────────────────────────────────┐
│           EnterpriseUser Extension                       │
│  Schema URI: urn:ietf:params:scim:schemas:extension:    │
│              enterprise:2.0:User                        │
├─────────────────────────────────────────────────────────┤
│  Attribute        │ Type       │ Required │ Mutability  │
│───────────────────┼────────────┼──────────┼─────────────│
│  employeeNumber   │ String     │ No       │ readWrite   │
│  costCenter       │ String     │ No       │ readWrite   │
│  organization     │ String     │ No       │ readWrite   │
│  division         │ String     │ No       │ readWrite   │
│  department       │ String     │ No       │ readWrite   │
│  manager          │ Complex    │ No       │ readWrite   │
│   ├─ value        │ String     │ No       │ readWrite   │
│   ├─ $ref         │ Reference  │ No       │ readWrite   │
│   └─ displayName  │ String     │ No       │ readOnly    │
└─────────────────────────────────────────────────────────┘
```

### 2.3 Full User JSON with Enterprise Extension

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "externalId": "bjensen",
  "meta": {
    "resourceType": "User",
    "created": "2026-02-16T08:00:00Z",
    "lastModified": "2026-02-16T08:00:00Z",
    "location": "https://scimserver.example.com/scim/Users/2819c223-7f76-453a-919d-413861904646",
    "version": "W/\"a330bc54f0671c9\""
  },
  "userName": "bjensen@example.com",
  "name": {
    "formatted": "Ms. Barbara J Jensen III",
    "familyName": "Jensen",
    "givenName": "Barbara",
    "middleName": "Jane"
  },
  "displayName": "Babs Jensen",
  "emails": [
    {
      "value": "bjensen@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "701984",
    "costCenter": "4130",
    "organization": "Universal Studios",
    "division": "Theme Park",
    "department": "Tour Operations",
    "manager": {
      "value": "26118915-6090-4610-87e4-49d8ca9f808d",
      "$ref": "../Users/26118915-6090-4610-87e4-49d8ca9f808d",
      "displayName": "John Smith"
    }
  }
}
```

---

## 3. Custom Extension Pattern

### 3.1 Extension Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Custom Extension Architecture                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: Define the Extension Class                         │
│  ┌──────────────────────────────────────────┐               │
│  │  Implements IScimExtension               │               │
│  │  - schemaUri                             │               │
│  │  - getSchemaAttributes()                 │               │
│  │  - extractFromRequest()                  │               │
│  │  - serializeForResponse()                │               │
│  │  - toPrismaData()                        │               │
│  │  - fromPrismaData()                      │               │
│  │  - applyPatchOp()                        │               │
│  │  - validate()                            │               │
│  └──────────────────────────────────────────┘               │
│                                                             │
│  Step 2: Self-Register via OnModuleInit                     │
│  ┌──────────────────────────────────────────┐               │
│  │  constructor(registry: ExtensionRegistry)│               │
│  │  onModuleInit() → registry.register(this)│               │
│  └──────────────────────────────────────────┘               │
│                                                             │
│  Step 3: Add to ExtensionsModule providers[]                │
│  ┌──────────────────────────────────────────┐               │
│  │  providers: [                            │               │
│  │    ExtensionRegistryService,             │               │
│  │    EnterpriseUserExtension,              │               │
│  │    MyCustomExtension,  // ← add here     │               │
│  │  ]                                       │               │
│  └──────────────────────────────────────────┘               │
│                                                             │
│  Step 4: Automatically discovered by:                       │
│  ┌──────────────────────────────────────────┐               │
│  │  - /Schemas endpoint                     │               │
│  │  - /ResourceTypes endpoint               │               │
│  │  - User/Group CRUD operations            │               │
│  │  - PATCH path routing                    │               │
│  │  - Filter attribute resolution           │               │
│  └──────────────────────────────────────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Example: Department Metadata Extension

**Schema URI**: `urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User`

| Attribute      | Type     | Description                          |
| -------------- | -------- | ------------------------------------ |
| buildingCode   | string   | Building identifier where user works |
| floorNumber    | string   | Floor number in the building         |
| businessUnit   | string   | Business unit classification         |
| onboardingDate | dateTime | Date the user was onboarded          |

**Resulting JSON:**

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
    "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User"
  ],
  "userName": "bjensen@example.com",
  "displayName": "Babs Jensen",
  "active": true,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "701984",
    "department": "Tour Operations",
    "manager": {
      "value": "26118915-6090-4610-87e4-49d8ca9f808d",
      "displayName": "John Smith"
    }
  },
  "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User": {
    "buildingCode": "B42",
    "floorNumber": "3",
    "businessUnit": "Entertainment",
    "onboardingDate": "2025-06-15T00:00:00Z"
  }
}
```

---

## 4. Schema & ResourceType Discovery

### 4.1 Schema Discovery Flow

```
 Client                         SCIMServer
   │                                │
   │  GET /Schemas                  │
   │───────────────────────────────►│
   │                                │
   │  200 OK                        │
   │  {                             │
   │    "schemas": [...],           │
   │    "Resources": [              │
   │      { Core User Schema },     │
   │      { Enterprise Extension }, │
   │      { Group Schema },         │
   │      { Custom Extensions }     │
   │    ]                           │
   │  }                             │
   │◄───────────────────────────────│
   │                                │
   │  GET /ResourceTypes            │
   │───────────────────────────────►│
   │                                │
   │  200 OK                        │
   │  {                             │
   │    "Resources": [{             │
   │      "name": "User",          │
   │      "schema": "...core:...", │
   │      "schemaExtensions": [{   │
   │        "schema": "..enter..", │
   │        "required": false      │
   │      }]                       │
   │    }]                         │
   │  }                             │
   │◄───────────────────────────────│
```

### 4.2 ResourceTypes JSON Response

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      "id": "User",
      "name": "User",
      "description": "User Account",
      "endpoint": "/Users",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
      "schemaExtensions": [
        {
          "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
          "required": false
        },
        {
          "schema": "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User",
          "required": false
        }
      ],
      "meta": {
        "location": "https://scimserver.example.com/scim/ResourceTypes/User",
        "resourceType": "ResourceType"
      }
    },
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      "id": "Group",
      "name": "Group",
      "description": "Group",
      "endpoint": "/Groups",
      "schema": "urn:ietf:params:scim:schemas:core:2.0:Group",
      "meta": {
        "location": "https://scimserver.example.com/scim/ResourceTypes/Group",
        "resourceType": "ResourceType"
      }
    }
  ]
}
```

### 4.3 Enterprise Extension Schema Response

```json
{
  "id": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  "name": "EnterpriseUser",
  "description": "Enterprise User Extension",
  "attributes": [
    {
      "name": "employeeNumber",
      "type": "string",
      "multiValued": false,
      "description": "Numeric or alphanumeric identifier assigned to a person",
      "required": false,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "department",
      "type": "string",
      "multiValued": false,
      "description": "Identifies the name of a department",
      "required": false,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "manager",
      "type": "complex",
      "multiValued": false,
      "description": "The user's manager",
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "subAttributes": [
        {
          "name": "value",
          "type": "string",
          "multiValued": false,
          "description": "The id of the SCIM resource representing the user's manager",
          "required": false,
          "mutability": "readWrite",
          "returned": "default"
        },
        {
          "name": "$ref",
          "type": "reference",
          "multiValued": false,
          "description": "The URI of the SCIM resource representing the user's manager",
          "required": false,
          "mutability": "readWrite",
          "returned": "default",
          "referenceTypes": ["User"]
        },
        {
          "name": "displayName",
          "type": "string",
          "multiValued": false,
          "description": "The displayName of the user's manager",
          "required": false,
          "mutability": "readOnly",
          "returned": "default"
        }
      ]
    }
  ]
}
```

---

## 5. PATCH Operations on Extensions

### 5.1 PATCH Enterprise Extension Request

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
      "value": "Marketing"
    },
    {
      "op": "add",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager",
      "value": {
        "value": "bulkId:manager123",
        "displayName": "Jane Doe"
      }
    },
    {
      "op": "remove",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:costCenter"
    }
  ]
}
```

### 5.2 PATCH Flow Diagram

```
Client                              SCIMServer
  │                                     │
  │  PATCH /Users/{id}                  │
  │  PatchOp with extension path        │
  │────────────────────────────────────►│
  │                                     │
  │                          ┌──────────┴──────────┐
  │                          │ Parse PatchOp        │
  │                          │                      │
  │                          │ Is path prefixed     │
  │                          │ with extension URN?  │
  │                          │                      │
  │                          │ YES → resolveExtPath │
  │                          │   Identify extension │
  │                          │   Extract attr name  │
  │                          │   Call applyPatchOp  │
  │                          │                      │
  │                          │ NO → Route to core   │
  │                          │   attribute handler  │
  │                          └──────────┬──────────┘
  │                                     │
  │                          ┌──────────┴──────────┐
  │                          │ Apply operation:     │
  │                          │ add / replace /      │
  │                          │ remove               │
  │                          │                      │
  │                          │ Update schemas[]     │
  │                          │ array if extension   │
  │                          │ added/removed        │
  │                          └──────────┬──────────┘
  │                                     │
  │  200 OK (updated resource)          │
  │◄────────────────────────────────────│
```

---

## 6. Filtering on Extension Attributes

### 6.1 Filter Examples

```http
GET /Users?filter=urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "Engineering"

GET /Users?filter=urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User:businessUnit eq "Entertainment"
```

### 6.2 Filter Parsing Flow

```
┌─────────────────────────────────────────────────┐
│            Filter Parsing Flow                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  Input: urn:...:enterprise:2.0:User:department   │
│         eq "Engineering"                         │
│         ↓                                        │
│  Detect if attribute path contains URN prefix    │
│         ↓                                        │
│  ┌─── YES (extension attribute) ───┐             │
│  │ Call resolveExtensionPath()     │             │
│  │ Extract:                        │             │
│  │   schema = "urn:...enterprise"  │             │
│  │   attr   = "department"         │             │
│  │   value  = "Engineering"        │             │
│  │                                 │             │
│  │ For enterprise: query column    │             │
│  │ For custom: query JSON field    │             │
│  └─────────────────────────────────┘             │
│                                                  │
│  ┌─── NO (core attribute) ─────────┐             │
│  │ Query directly on User model    │             │
│  └─────────────────────────────────┘             │
└─────────────────────────────────────────────────┘
```

---

## 7. Current Project Gap Analysis

### 7.1 Feature Status Matrix

| Feature                        | Status | Notes                                                      |
| ------------------------------ | ------ | ---------------------------------------------------------- |
| Enterprise Extension Model     | ✅/⚠️  | Model exists; verify full CRUD and serialization           |
| Schema Discovery (`/Schemas`)  | ⚠️     | `/Schemas` should return enterprise extension schema       |
| ResourceType Declaration       | ⚠️     | `schemaExtensions[]` should list enterprise extension      |
| PATCH on extensions            | ⚠️     | Path parsing with URN prefix needs verification            |
| Filter on extensions           | ⚠️     | Filter parser must handle fully-qualified attribute paths  |
| Custom Extension Framework     | ❌     | No custom extension framework or pluggable extension system|
| Dynamic Extension Registration | ❌     | Extensions are compile-time; no runtime registration       |
| `schemas[]` array management   | ⚠️     | Must dynamically include only schemas with non-null data   |

### 7.2 Database Layer Consideration

The project uses **Prisma** with likely one of these storage patterns:

| Strategy                 | Pros                                     | Cons                                       |
| ------------------------ | ---------------------------------------- | ------------------------------------------ |
| **Inline columns**       | Fast queries, type safety                | Migration per new attribute                |
| **JSON column**          | No migration for custom extensions       | Harder to query/index                      |
| **Related table**        | Clean separation, normalized             | Extra JOINs                                |
| **Hybrid** (recommended) | Best of both: columns for well-known, JSON for custom | Slight complexity          |

### 7.3 Recommended Approach: Hybrid Storage

```
┌────────────────────────────────────────────────────────┐
│                    User Table                           │
├──────────────────────────┬─────────────────────────────┤
│  Core Attributes         │  Enterprise Extension       │
│  ─────────────────       │  ────────────────────       │
│  id                      │  employeeNumber             │
│  userName                │  costCenter                 │
│  displayName             │  organization               │
│  active                  │  division                   │
│  givenName               │  department                 │
│  familyName              │  managerId                  │
│  emails (Json)           │  managerRef                 │
│  phoneNumbers (Json)     │  managerDisplayName         │
│                          │                             │
│  ───────────── Custom Extensions ──────────────────    │
│  customExtensions (Json) ← stores all custom ext data  │
│  { "urn:myorg:...": { "buildingCode": "B42", ... } }  │
└────────────────────────────────────────────────────────┘
```

---

## 8. Pluggable Extension Framework Design

### 8.1 Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                 Extension Framework Architecture                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    ExtensionsModule (@Global)                │ │
│  │                                                              │ │
│  │  ┌───────────────────────────────────────────────────────┐  │ │
│  │  │            ExtensionRegistryService                    │  │ │
│  │  │                                                        │  │ │
│  │  │  - register(ext: IScimExtension)                      │  │ │
│  │  │  - getExtensionsForResource(type)                     │  │ │
│  │  │  - getExtension(schemaUri)                            │  │ │
│  │  │  - resolveExtensionPath(fullPath)                     │  │ │
│  │  │  - buildSchemasArray(coreUri, type, body)             │  │ │
│  │  │  - getSchemaDefinitions()                             │  │ │
│  │  │  - getResourceTypeExtensions(type)                    │  │ │
│  │  └───────────────────────────────────────────────────────┘  │ │
│  │                                                              │ │
│  │  ┌─────────────────────┐  ┌─────────────────────────────┐  │ │
│  │  │ EnterpriseUser      │  │ DepartmentMetadata          │  │ │
│  │  │ Extension           │  │ Extension (custom)          │  │ │
│  │  │                     │  │                             │  │ │
│  │  │ implements          │  │ implements                  │  │ │
│  │  │ IScimExtension      │  │ IScimExtension              │  │ │
│  │  │ OnModuleInit        │  │ OnModuleInit                │  │ │
│  │  │                     │  │                             │  │ │
│  │  │ → self-registers    │  │ → self-registers            │  │ │
│  │  └─────────────────────┘  └─────────────────────────────┘  │ │
│  │                                                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Consumers:                                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐   │
│  │ UsersService  │ │ Schemas      │ │ ResourceTypes          │   │
│  │              │ │ Controller   │ │ Controller             │   │
│  │ Calls:       │ │              │ │                        │   │
│  │ extract()    │ │ Calls:       │ │ Calls:                 │   │
│  │ validate()   │ │ getSchemaDef │ │ getResourceTypeExt     │   │
│  │ toPrisma()   │ │              │ │                        │   │
│  │ fromPrisma() │ │              │ │                        │   │
│  │ patchOp()    │ │              │ │                        │   │
│  └──────────────┘ └──────────────┘ └────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 IScimExtension Interface

```typescript
export interface IScimExtension {
  /** Full URN schema identifier */
  readonly schemaUri: string;
  /** Human-readable name for /Schemas endpoint */
  readonly name: string;
  /** Description for /Schemas endpoint */
  readonly description: string;
  /** Whether this extension is required on the resource */
  readonly required: boolean;
  /** Which resource type this extension applies to */
  readonly resourceType: 'User' | 'Group';

  /** Returns attribute definitions for /Schemas */
  getSchemaAttributes(): ScimSchemaAttribute[];
  /** Extracts extension data from incoming SCIM request */
  extractFromRequest(body: Record<string, any>): Record<string, any> | null;
  /** Serializes extension data for SCIM response */
  serializeForResponse(dbData: Record<string, any>): Record<string, any> | null;
  /** Converts extension data for database persistence */
  toPrismaData(extensionData: Record<string, any>): Record<string, any>;
  /** Converts from database representation to extension data */
  fromPrismaData(dbRecord: Record<string, any>): Record<string, any> | null;
  /** Handles a PATCH operation on this extension */
  applyPatchOp(
    currentData: Record<string, any> | null,
    op: 'add' | 'replace' | 'remove',
    path: string,
    value?: any,
  ): Record<string, any> | null;
  /** Validates extension data, returns error messages or empty array */
  validate(data: Record<string, any>): string[];
}

export interface ScimSchemaAttribute {
  name: string;
  type: 'string' | 'boolean' | 'decimal' | 'integer' | 'dateTime'
       | 'reference' | 'complex' | 'binary';
  multiValued: boolean;
  description: string;
  required: boolean;
  caseExact?: boolean;
  mutability: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  returned: 'always' | 'never' | 'default' | 'request';
  uniqueness: 'none' | 'server' | 'global';
  canonicalValues?: string[];
  referenceTypes?: string[];
  subAttributes?: ScimSchemaAttribute[];
}
```

### 8.3 Extension Lifecycle

```
App Startup
    │
    ▼
NestJS Module Init
    │
    ├──► ExtensionRegistryService created (empty map)
    │
    ├──► EnterpriseUserExtension.onModuleInit()
    │       └──► registry.register(this)  →  Map["urn:..enterprise"] = ext
    │
    ├──► DepartmentMetadataExtension.onModuleInit()
    │       └──► registry.register(this)  →  Map["urn:..deptmeta"] = ext
    │
    └──► Server ready — all extensions registered and discoverable
```

---

## 9. Implementation Reference Code

### 9.1 File Structure

```
api/src/scim/extensions/
├── extension.interface.ts                     ← IScimExtension + ScimSchemaAttribute
├── extension-registry.service.ts              ← Central registry (singleton)
├── extensions.module.ts                       ← NestJS module (global)
├── enterprise-user.extension.ts               ← RFC 7643 §4.3 Enterprise Extension
└── custom-department-metadata.extension.ts    ← Example custom extension
```

### 9.2 ExtensionRegistryService

```typescript
@Injectable()
export class ExtensionRegistryService {
  private readonly logger = new Logger(ExtensionRegistryService.name);
  private readonly extensions = new Map<string, IScimExtension>();

  register(extension: IScimExtension): void {
    if (this.extensions.has(extension.schemaUri)) {
      this.logger.warn(`Extension already registered: ${extension.schemaUri}`);
      return;
    }
    this.extensions.set(extension.schemaUri, extension);
    this.logger.log(`Registered SCIM extension: ${extension.schemaUri}`);
  }

  getExtensionsForResource(type: 'User' | 'Group'): IScimExtension[] {
    return Array.from(this.extensions.values())
      .filter((ext) => ext.resourceType === type);
  }

  getExtension(schemaUri: string): IScimExtension | undefined {
    return this.extensions.get(schemaUri);
  }

  getAllExtensions(): IScimExtension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Find which extension owns a given attribute path.
   * Used in PATCH/filter parsing when path starts with "urn:".
   *
   * @param fullPath e.g. "urn:...:enterprise:2.0:User:department"
   * @returns { extension, attributePath } or null
   */
  resolveExtensionPath(fullPath: string):
    { extension: IScimExtension; attributePath: string } | null {
    for (const [uri, ext] of this.extensions) {
      if (fullPath.startsWith(uri + ':')) {
        return { extension: ext, attributePath: fullPath.substring(uri.length + 1) };
      }
    }
    return null;
  }

  /**
   * Build schemas[] array including only extensions that have data.
   */
  buildSchemasArray(
    coreSchemaUri: string,
    resourceType: 'User' | 'Group',
    responseBody: Record<string, any>,
  ): string[] {
    const schemas = [coreSchemaUri];
    for (const ext of this.getExtensionsForResource(resourceType)) {
      if (responseBody[ext.schemaUri] &&
          Object.keys(responseBody[ext.schemaUri]).length > 0) {
        schemas.push(ext.schemaUri);
      }
    }
    return schemas;
  }

  getSchemaDefinitions(): Array<{
    id: string; name: string; description: string;
    attributes: ScimSchemaAttribute[];
  }> {
    return this.getAllExtensions().map((ext) => ({
      id: ext.schemaUri,
      name: ext.name,
      description: ext.description,
      attributes: ext.getSchemaAttributes(),
    }));
  }

  getResourceTypeExtensions(resourceType: 'User' | 'Group'):
    Array<{ schema: string; required: boolean }> {
    return this.getExtensionsForResource(resourceType).map((ext) => ({
      schema: ext.schemaUri,
      required: ext.required,
    }));
  }
}
```

### 9.3 EnterpriseUserExtension

```typescript
export const ENTERPRISE_USER_SCHEMA_URI =
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

@Injectable()
export class EnterpriseUserExtension implements IScimExtension, OnModuleInit {
  readonly schemaUri = ENTERPRISE_USER_SCHEMA_URI;
  readonly name = 'EnterpriseUser';
  readonly description = 'Enterprise User Extension (RFC 7643 §4.3)';
  readonly required = false;
  readonly resourceType = 'User' as const;

  constructor(private readonly registry: ExtensionRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getSchemaAttributes(): ScimSchemaAttribute[] {
    return [
      { name: 'employeeNumber', type: 'string', multiValued: false,
        description: 'A numeric or alphanumeric identifier',
        required: false, caseExact: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'costCenter', type: 'string', multiValued: false,
        description: 'Cost center name', required: false, caseExact: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'organization', type: 'string', multiValued: false,
        description: 'Organization name', required: false, caseExact: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'division', type: 'string', multiValued: false,
        description: 'Division name', required: false, caseExact: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'department', type: 'string', multiValued: false,
        description: 'Department name', required: false, caseExact: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'manager', type: 'complex', multiValued: false,
        description: "The user's manager", required: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none',
        subAttributes: [
          { name: 'value', type: 'string', multiValued: false,
            description: 'Manager id', required: false, caseExact: false,
            mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
          { name: '$ref', type: 'reference', multiValued: false,
            description: 'Manager URI', required: false,
            mutability: 'readWrite', returned: 'default', uniqueness: 'none',
            referenceTypes: ['User'] },
          { name: 'displayName', type: 'string', multiValued: false,
            description: 'Manager display name', required: false, caseExact: false,
            mutability: 'readOnly', returned: 'default', uniqueness: 'none' },
        ],
      },
    ];
  }

  extractFromRequest(body: Record<string, any>): Record<string, any> | null {
    const data = body[this.schemaUri];
    if (!data || typeof data !== 'object') return null;
    return {
      employeeNumber: data.employeeNumber ?? null,
      costCenter: data.costCenter ?? null,
      organization: data.organization ?? null,
      division: data.division ?? null,
      department: data.department ?? null,
      manager: data.manager ?? null,
    };
  }

  serializeForResponse(dbData: Record<string, any>): Record<string, any> | null {
    const result: Record<string, any> = {};
    let hasData = false;
    for (const field of ['employeeNumber','costCenter','organization','division','department']) {
      if (dbData[field] != null) { result[field] = dbData[field]; hasData = true; }
    }
    if (dbData.managerId || dbData.manager) {
      result.manager = {
        value: dbData.managerId ?? dbData.manager?.value,
        $ref: dbData.managerRef ?? dbData.manager?.$ref,
        displayName: dbData.managerDisplayName ?? dbData.manager?.displayName,
      };
      hasData = true;
    }
    return hasData ? result : null;
  }

  toPrismaData(extensionData: Record<string, any>): Record<string, any> {
    return {
      employeeNumber: extensionData.employeeNumber ?? null,
      costCenter: extensionData.costCenter ?? null,
      organization: extensionData.organization ?? null,
      division: extensionData.division ?? null,
      department: extensionData.department ?? null,
      managerId: extensionData.manager?.value ?? null,
      managerRef: extensionData.manager?.$ref ?? null,
      managerDisplayName: extensionData.manager?.displayName ?? null,
    };
  }

  fromPrismaData(dbRecord: Record<string, any>): Record<string, any> | null {
    return this.serializeForResponse(dbRecord);
  }

  applyPatchOp(
    currentData: Record<string, any> | null,
    op: 'add' | 'replace' | 'remove',
    path: string,
    value?: any,
  ): Record<string, any> | null {
    const data = { ...(currentData ?? {}) };
    switch (op) {
      case 'add':
      case 'replace':
        if (path.includes('.')) {
          const [parent, child] = path.split('.');
          data[parent] = { ...(data[parent] ?? {}), [child]: value };
        } else {
          data[path] = value;
        }
        break;
      case 'remove':
        if (path.includes('.')) {
          const [parent, child] = path.split('.');
          if (data[parent]) delete data[parent][child];
        } else {
          delete data[path];
        }
        break;
    }
    const hasData = Object.values(data).some(
      (v) => v != null && (typeof v !== 'object' || Object.keys(v).length > 0),
    );
    return hasData ? data : null;
  }

  validate(data: Record<string, any>): string[] {
    const errors: string[] = [];
    const validFields = new Set([
      'employeeNumber','costCenter','organization','division','department','manager',
    ]);
    for (const key of Object.keys(data)) {
      if (!validFields.has(key))
        errors.push(`Unknown enterprise extension attribute: "${key}"`);
    }
    if (data.manager && typeof data.manager !== 'object')
      errors.push('manager must be a complex attribute');
    return errors;
  }
}
```

### 9.4 Custom DepartmentMetadata Extension

```typescript
export const DEPT_METADATA_SCHEMA_URI =
  'urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User';

@Injectable()
export class DepartmentMetadataExtension implements IScimExtension, OnModuleInit {
  readonly schemaUri = DEPT_METADATA_SCHEMA_URI;
  readonly name = 'DepartmentMetadata';
  readonly description = 'Custom extension for department-level metadata';
  readonly required = false;
  readonly resourceType = 'User' as const;

  constructor(private readonly registry: ExtensionRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getSchemaAttributes(): ScimSchemaAttribute[] {
    return [
      { name: 'buildingCode', type: 'string', multiValued: false,
        description: 'Building identifier', required: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'floorNumber', type: 'string', multiValued: false,
        description: 'Floor number', required: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'businessUnit', type: 'string', multiValued: false,
        description: 'Business unit', required: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'onboardingDate', type: 'dateTime', multiValued: false,
        description: 'Onboarding date', required: false,
        mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    ];
  }

  extractFromRequest(body: Record<string, any>): Record<string, any> | null {
    const data = body[this.schemaUri];
    if (!data || typeof data !== 'object') return null;
    return {
      buildingCode: data.buildingCode ?? null,
      floorNumber: data.floorNumber ?? null,
      businessUnit: data.businessUnit ?? null,
      onboardingDate: data.onboardingDate ?? null,
    };
  }

  serializeForResponse(dbData: Record<string, any>): Record<string, any> | null {
    const result: Record<string, any> = {};
    let hasData = false;
    for (const f of ['buildingCode','floorNumber','businessUnit','onboardingDate']) {
      if (dbData[f] != null) { result[f] = dbData[f]; hasData = true; }
    }
    return hasData ? result : null;
  }

  toPrismaData(extensionData: Record<string, any>): Record<string, any> {
    return { [this.schemaUri]: extensionData };
  }

  fromPrismaData(dbRecord: Record<string, any>): Record<string, any> | null {
    const data = dbRecord.customExtensions?.[this.schemaUri] ?? dbRecord[this.schemaUri];
    return data ? this.serializeForResponse(data) : null;
  }

  applyPatchOp(
    currentData: Record<string, any> | null,
    op: 'add' | 'replace' | 'remove',
    path: string,
    value?: any,
  ): Record<string, any> | null {
    const data = { ...(currentData ?? {}) };
    switch (op) {
      case 'add': case 'replace': data[path] = value; break;
      case 'remove': delete data[path]; break;
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  validate(data: Record<string, any>): string[] {
    const errors: string[] = [];
    const valid = new Set(['buildingCode','floorNumber','businessUnit','onboardingDate']);
    for (const key of Object.keys(data))
      if (!valid.has(key)) errors.push(`Unknown dept metadata attribute: "${key}"`);
    if (data.onboardingDate && isNaN(Date.parse(data.onboardingDate)))
      errors.push('onboardingDate must be a valid ISO 8601 dateTime');
    return errors;
  }
}
```

### 9.5 ExtensionsModule

```typescript
@Global()
@Module({
  providers: [
    ExtensionRegistryService,
    // Standard Extensions
    EnterpriseUserExtension,
    // Custom Extensions — add new extensions here
    DepartmentMetadataExtension,
  ],
  exports: [ExtensionRegistryService],
})
export class ExtensionsModule {}
```

### 9.6 Prisma Schema Addition

```prisma
model User {
  // ...existing core fields...

  // Enterprise Extension (well-known, separate columns)
  employeeNumber      String?
  costCenter          String?
  organization        String?
  division            String?
  department          String?
  managerId           String?
  managerRef          String?
  managerDisplayName  String?

  // Custom Extensions (generic JSON blob — no migration needed)
  customExtensions    Json?     @default("{}")
}
```

### 9.7 UsersService Integration (Extension-Aware)

```typescript
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly extensionRegistry: ExtensionRegistryService,
  ) {}

  async create(body: Record<string, any>): Promise<Record<string, any>> {
    const extensions = this.extensionRegistry.getExtensionsForResource('User');
    const extensionDataMap = new Map<string, Record<string, any>>();

    // Extract & validate extensions
    for (const ext of extensions) {
      const data = ext.extractFromRequest(body);
      if (data) {
        const errors = ext.validate(data);
        if (errors.length > 0)
          throw new Error(`Validation failed for ${ext.schemaUri}: ${errors.join(', ')}`);
        extensionDataMap.set(ext.schemaUri, data);
      }
    }

    // Build Prisma data
    const prismaData: Record<string, any> = {
      userName: body.userName,
      displayName: body.displayName,
      active: body.active ?? true,
      // ...other core fields...
    };

    // Enterprise extension → separate columns
    const enterpriseUri = ENTERPRISE_USER_SCHEMA_URI;
    if (extensionDataMap.has(enterpriseUri)) {
      const ext = this.extensionRegistry.getExtension(enterpriseUri)!;
      Object.assign(prismaData, ext.toPrismaData(extensionDataMap.get(enterpriseUri)!));
    }

    // Custom extensions → JSON blob
    const customExtensions: Record<string, any> = {};
    for (const [uri, data] of extensionDataMap) {
      if (uri !== enterpriseUri) {
        const ext = this.extensionRegistry.getExtension(uri)!;
        Object.assign(customExtensions, ext.toPrismaData(data));
      }
    }
    if (Object.keys(customExtensions).length > 0)
      prismaData.customExtensions = customExtensions;

    const user = await this.prisma.user.create({ data: prismaData as any });
    return this.toScimResponse(user);
  }

  async patch(id: string, operations: any[]): Promise<Record<string, any>> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const updateData: Record<string, any> = {};
    let customExtensions = (user as any).customExtensions ?? {};

    for (const operation of operations) {
      const { op, path, value } = operation;
      const resolved = this.extensionRegistry.resolveExtensionPath(path);

      if (resolved) {
        const { extension, attributePath } = resolved;
        const enterpriseUri = ENTERPRISE_USER_SCHEMA_URI;

        if (extension.schemaUri === enterpriseUri) {
          // Enterprise extension: update specific columns
          const currentData = extension.fromPrismaData(user as any);
          const updatedData = extension.applyPatchOp(currentData, op, attributePath, value);
          if (updatedData) Object.assign(updateData, extension.toPrismaData(updatedData));
        } else {
          // Custom extension: update JSON blob
          const currentData = customExtensions[extension.schemaUri] ?? {};
          const updatedData = extension.applyPatchOp(currentData, op, attributePath, value);
          if (updatedData) customExtensions[extension.schemaUri] = updatedData;
          else delete customExtensions[extension.schemaUri];
          updateData.customExtensions = customExtensions;
        }
      } else {
        // Core attribute
        updateData[path] = op === 'remove' ? null : value;
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData as any,
    });
    return this.toScimResponse(updated);
  }

  private toScimResponse(dbUser: Record<string, any>): Record<string, any> {
    const coreUri = 'urn:ietf:params:scim:schemas:core:2.0:User';
    const response: Record<string, any> = {
      id: dbUser.id,
      externalId: dbUser.externalId,
      userName: dbUser.userName,
      displayName: dbUser.displayName,
      active: dbUser.active,
      name: {
        givenName: dbUser.givenName,
        familyName: dbUser.familyName,
        middleName: dbUser.middleName,
        formatted: dbUser.formatted,
      },
      meta: {
        resourceType: 'User',
        created: dbUser.createdAt?.toISOString(),
        lastModified: dbUser.updatedAt?.toISOString(),
        location: `/scim/Users/${dbUser.id}`,
      },
    };

    // Dynamically add extensions that have data
    for (const ext of this.extensionRegistry.getExtensionsForResource('User')) {
      const data = ext.fromPrismaData(dbUser);
      if (data) response[ext.schemaUri] = data;
    }

    response.schemas = this.extensionRegistry.buildSchemasArray(coreUri, 'User', response);
    return response;
  }
}
```

### 9.8 SchemasController Integration

```typescript
@Controller('scim/Schemas')
export class SchemasController {
  constructor(private readonly extensionRegistry: ExtensionRegistryService) {}

  @Get()
  getSchemas() {
    const coreSchemas = this.getCoreSchemas();
    const extensionSchemas = this.extensionRegistry.getSchemaDefinitions().map((ext) => ({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
      id: ext.id,
      name: ext.name,
      description: ext.description,
      attributes: ext.attributes,
      meta: {
        resourceType: 'Schema',
        location: `/scim/Schemas/${encodeURIComponent(ext.id)}`,
      },
    }));

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: coreSchemas.length + extensionSchemas.length,
      Resources: [...coreSchemas, ...extensionSchemas],
    };
  }

  private getCoreSchemas() { /* ...existing core schema definitions... */ }
}
```

### 9.9 ResourceTypesController Integration

```typescript
@Controller('scim/ResourceTypes')
export class ResourceTypesController {
  constructor(private readonly extensionRegistry: ExtensionRegistryService) {}

  @Get()
  getResourceTypes() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          description: 'User Account',
          endpoint: '/Users',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
          schemaExtensions: this.extensionRegistry.getResourceTypeExtensions('User'),
          meta: { location: '/scim/ResourceTypes/User', resourceType: 'ResourceType' },
        },
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'Group',
          name: 'Group',
          description: 'Group',
          endpoint: '/Groups',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
          schemaExtensions: this.extensionRegistry.getResourceTypeExtensions('Group'),
          meta: { location: '/scim/ResourceTypes/Group', resourceType: 'ResourceType' },
        },
      ],
    };
  }
}
```

---

## 10. API Interaction Examples

### 10.1 Create User with Both Extensions

```http
POST /scim/Users HTTP/1.1
Content-Type: application/scim+json

{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
    "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User"
  ],
  "userName": "bjensen@example.com",
  "name": {
    "givenName": "Barbara",
    "familyName": "Jensen"
  },
  "displayName": "Babs Jensen",
  "active": true,
  "emails": [
    { "value": "bjensen@example.com", "type": "work", "primary": true }
  ],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "701984",
    "department": "Tour Operations",
    "manager": {
      "value": "26118915-6090-4610-87e4-49d8ca9f808d",
      "displayName": "John Smith"
    }
  },
  "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User": {
    "buildingCode": "B42",
    "floorNumber": "3",
    "businessUnit": "Entertainment",
    "onboardingDate": "2025-06-15T00:00:00Z"
  }
}
```

### 10.2 PATCH Extension Attribute

```http
PATCH /scim/Users/2819c223-7f76-453a-919d-413861904646 HTTP/1.1
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
      "value": "Marketing"
    },
    {
      "op": "add",
      "path": "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User:businessUnit",
      "value": "Media"
    }
  ]
}
```

### 10.3 Filter on Extension Attributes

```http
GET /scim/Users?filter=urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "Marketing" HTTP/1.1
```

### 10.4 GET User Response (Extensions Included Dynamically)

```http
GET /scim/Users/2819c223-7f76-453a-919d-413861904646 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/scim+json

{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
    "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User"
  ],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "userName": "bjensen@example.com",
  "displayName": "Babs Jensen",
  "active": true,
  "meta": {
    "resourceType": "User",
    "created": "2026-02-16T08:00:00Z",
    "lastModified": "2026-02-16T10:30:00Z",
    "location": "/scim/Users/2819c223-7f76-453a-919d-413861904646"
  },
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "701984",
    "department": "Marketing"
  },
  "urn:myorg:scim:schemas:extension:departmentmetadata:2.0:User": {
    "buildingCode": "B42",
    "floorNumber": "3",
    "businessUnit": "Media",
    "onboardingDate": "2025-06-15T00:00:00Z"
  }
}
```

### 10.5 Full CRUD Flow Diagram with Extensions

```
┌──────────┐                ┌──────────────┐          ┌───────────────┐
│  Client  │                │  Controller  │          │   Extension   │
│          │                │              │          │   Registry    │
└────┬─────┘                └──────┬───────┘          └──────┬────────┘
     │                              │                         │
     │  POST /scim/Users            │                         │
     │  {                           │                         │
     │   schemas: [core, enter]     │                         │
     │   userName: "bjensen"        │                         │
     │   urn:..enterprise: {        │                         │
     │     department: "Eng"        │                         │
     │   }                          │                         │
     │   urn:..deptmeta: {          │                         │
     │     buildingCode: "B42"      │                         │
     │   }                          │                         │
     │  }                           │                         │
     │─────────────────────────────►│                         │
     │                              │                         │
     │                              │  getExtensionsForResource("User")
     │                              │────────────────────────►│
     │                              │                         │
     │                              │  [EnterpriseExt, DeptMetaExt]
     │                              │◄────────────────────────│
     │                              │                         │
     │                    ┌─────────┴─────────┐               │
     │                    │ For each extension:│               │
     │                    │  1. extractFromReq │               │
     │                    │  2. validate()     │               │
     │                    │  3. toPrismaData() │               │
     │                    └─────────┬─────────┘               │
     │                              │                         │
     │                    ┌─────────┴─────────┐               │
     │                    │ Prisma create:     │               │
     │                    │  - core fields     │               │
     │                    │  - enterprise cols │               │
     │                    │  - customExtensions│               │
     │                    │    JSON blob       │               │
     │                    └─────────┬─────────┘               │
     │                              │                         │
     │                    ┌─────────┴─────────┐               │
     │                    │ Build response:    │               │
     │                    │  For each ext:     │               │
     │                    │    fromPrismaData  │               │
     │                    │    serialize       │               │
     │                    │  buildSchemasArray │               │
     │                    └─────────┬─────────┘               │
     │                              │                         │
     │  201 Created                 │                         │
     │  {                           │                         │
     │   schemas: [core,enter,dept] │                         │
     │   id: "abc-123"             │                         │
     │   userName: "bjensen"        │                         │
     │   urn:..enterprise: {...}    │                         │
     │   urn:..deptmeta: {...}      │                         │
     │  }                           │                         │
     │◄─────────────────────────────│                         │
```

---

## 11. Adding a New Custom Extension Checklist

```
☐ 1. Create extension file implementing IScimExtension
      api/src/scim/extensions/my-custom.extension.ts

☐ 2. Define schema URN
      "urn:myorg:scim:schemas:extension:mycustom:2.0:User"

☐ 3. Implement all interface methods:
      ├── getSchemaAttributes()  → for /Schemas discovery
      ├── extractFromRequest()   → parse incoming request
      ├── serializeForResponse() → build SCIM response
      ├── toPrismaData()         → database persistence
      ├── fromPrismaData()       → database retrieval
      ├── applyPatchOp()         → PATCH support
      └── validate()             → input validation

☐ 4. Add @Injectable() and OnModuleInit for self-registration

☐ 5. Register in ExtensionsModule providers array

☐ 6. NO database migration needed (uses customExtensions JSON)

☐ 7. Write unit tests for the extension

✅ Extension is automatically:
   • Discoverable via /Schemas
   • Listed in /ResourceTypes schemaExtensions
   • Included in responses when data present
   • Patchable via PATCH operations
   • Filterable (with filter parser support)
```

---

## 12. References

- [RFC 7643 — SCIM Core Schema](https://datatracker.ietf.org/doc/html/rfc7643)
- [RFC 7644 — SCIM Protocol](https://datatracker.ietf.org/doc/html/rfc7644)
- [RFC 7643 §3.3 — Schema Extensions](https://datatracker.ietf.org/doc/html/rfc7643#section-3.3)
- [RFC 7643 §4.3 — Enterprise User Extension](https://datatracker.ietf.org/doc/html/rfc7643#section-4.3)
- [RFC 7643 §8.7 — ResourceType Representation](https://datatracker.ietf.org/doc/html/rfc7643#section-8.7)
- [RFC 7644 §3.4.2 — Filtering](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2)
- [RFC 7644 §3.5.2 — Modifying with PATCH](https://datatracker.ietf.org/doc/html/rfc7644#section-3.5.2)

---

> *This document was added as part of the SCIM Extensions analysis on February 16, 2026.*
> *It serves as both a reference guide and an implementation blueprint for the SCIMServer project.*
