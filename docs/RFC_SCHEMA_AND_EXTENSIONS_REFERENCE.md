# RFC Schema & Extensions Reference

## Overview

**Document Type**: RFC Research Reference  
**Audience**: All contributors, operators, and anyone implementing or consuming SCIM schema extensions  
**RFCs Covered**: RFC 7643 (Schema), RFC 7644 (Protocol), RFC 7642 (Concepts)  
**Status**: ✅ Complete  
**Date**: March 2, 2026

### Purpose

This document is the canonical RFC reference for all schema-related questions in the SCIMServer project. It distills RFC 7643, RFC 7644, and RFC 7642 into actionable rules covering:

1. What can and cannot be changed about SCIM schemas
2. How extensions work and what the RFCs require
3. What the RFCs explicitly allow, prohibit, and are silent on
4. How industry implementations interpret the gaps

> **Cross-references:**
> - Implementation internals → [SCHEMA_LIFECYCLE_AND_REGISTRY.md](SCHEMA_LIFECYCLE_AND_REGISTRY.md)
> - Operator how-to guide → [SCHEMA_CUSTOMIZATION_GUIDE.md](SCHEMA_CUSTOMIZATION_GUIDE.md)
> - Behavior matrices → [SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md](SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md)
> - Feature doc → [G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md](G8B_CUSTOM_RESOURCE_TYPE_REGISTRATION.md)
> - Feature doc → [FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md](FEATURE_SOFT_DELETE_STRICT_SCHEMA_CUSTOM_EXTENSIONS.md) (deactivation gate, strict schema, custom extensions)

---

## 1. Core Schema Immutability

### 1.1 The Normative Rule (RFC 7643 §2, §3, §7)

SCIM core schemas define attributes with specific **characteristics** that are normative and immutable:

| Characteristic | RFC Section | Description |
|----------------|-------------|-------------|
| `type` | §2.3 | Data type (String, Boolean, Integer, Decimal, DateTime, Reference, Complex, Binary) |
| `mutability` | §2.2 | Lifecycle constraint (readOnly, readWrite, immutable, writeOnly) |
| `returned` | §2.4 | Response inclusion (always, never, default, request) |
| `required` | §2.6 | Whether attribute must be present |
| `caseExact` | §2.5 | Case sensitivity for string comparisons |
| `uniqueness` | §2.7 | Uniqueness scope (none, server, global) |
| `multiValued` | §2.4 | Whether attribute holds an array |
| `subAttributes` | §2.4 | Nested attribute definitions for Complex types |

**Key principle**: These characteristics are defined by the schema itself and are **not configurable by the service provider or the client**. A service provider cannot, for example, change `userName` from `required:true` to `required:false`, or change `id` from `mutability:readOnly` to `mutability:readWrite`.

> **RFC 7643 §7**: "Each attribute definition includes the attribute's name, its data type, whether it is singular or multi-valued, its mutability, and other characteristics."

### 1.2 What Service Providers MUST NOT Change

| Attribute | Characteristic | Value | RFC Basis |
|-----------|---------------|-------|-----------|
| `id` | mutability | readOnly | RFC 7643 §3.1 |
| `id` | returned | always | RFC 7643 §3.1 |
| `meta` | mutability | readOnly | RFC 7643 §3.1 |
| `meta.resourceType` | mutability | readOnly | RFC 7643 §3.1 |
| `meta.created` | mutability | readOnly | RFC 7643 §3.1 |
| `meta.lastModified` | mutability | readOnly | RFC 7643 §3.1 |
| `meta.location` | mutability | readOnly | RFC 7643 §3.1 |
| `meta.version` | mutability | readOnly | RFC 7643 §3.1 |
| `userName` | required | true | RFC 7643 §4.1 |
| `userName` | uniqueness | server | RFC 7643 §4.1 |
| `password` | mutability | writeOnly | RFC 7643 §4.1 |
| `password` | returned | never | RFC 7643 §4.1 |
| `groups` (on User) | mutability | readOnly | RFC 7643 §4.1 |
| `displayName` (on Group) | required | true | RFC 7643 §4.2 |
| `members.value` | mutability | immutable | RFC 7643 §4.2 |

### 1.3 What Service Providers MAY Decide

The RFCs allow some behavioral choices at the **implementation level** (not per-request):

| Decision | RFC Basis | Notes |
|----------|-----------|-------|
| Which optional attributes to support | RFC 7643 §2.6 | `required:false` attributes can be accepted or ignored |
| Whether to enforce canonical values | RFC 7643 §2.3.1 | E.g., `emails.type` = "work", "home", etc. - enforcement is optional |
| Maximum `totalResults` for filters | RFC 7644 §3.4.2 | Server can limit result set sizes |
| Whether to support `sort` | RFC 7644 §3.4.2.3 | Feature is optional per SPC |
| Whether to support `bulk` | RFC 7644 §3.7 | Feature is optional per SPC |
| Whether to return `meta.version` (ETag) | RFC 7643 §3.1 | Version support is optional |
| Default `returned` for non-declared attributes | RFC 7643 §2.4 | Default is "default" (always return unless excluded) |

---

## 2. Schema Extensions (RFC 7643 §3.3)

### 2.1 The Extension Mechanism

SCIM extends resources through **schema extensions** - namespaced blocks of additional attributes attached to an existing resource type. This is the **primary and only** extensibility mechanism defined by the RFCs.

> **RFC 7643 §3.3**: "SCIM allows for extension of its fixed core schemas using an 'extension' model. Extensions are defined using the same format as a schema definition, identified by a unique URI."

### 2.2 Extension Rules

| Rule | RFC Source | Description |
|------|-----------|-------------|
| **Extensions are additive** | §3.3 | Extensions add new attributes; they cannot modify or remove core attributes |
| **Extension URN must be unique** | §3.3 | Each extension is identified by a globally unique URN (e.g., `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`) |
| **Extension URN appears in `schemas[]`** | §3.1 | When an extension is present on a resource, its URN must appear in the resource's `schemas` array |
| **Extension attributes live under the URN key** | §3.3 | Extension attributes are namespaced: `{"urn:...:enterprise:2.0:User": {"employeeNumber": "42"}}` |
| **Extensions can be required or optional** | §6 | The ResourceType `schemaExtensions[].required` field declares whether an extension is mandatory |
| **Extensions have full attribute definitions** | §7 | Extension schemas use the same `attributes[]` format as core schemas, with all characteristics |
| **Extension discovery via `/Schemas`** | §7 | Extension schemas are returned by the `/Schemas` discovery endpoint alongside core schemas |
| **Extension linkage via `/ResourceTypes`** | §6 | The ResourceType definition declares which extensions apply (`schemaExtensions[]`) |

### 2.3 Extension URN Naming Convention

The RFC establishes a URN namespace pattern:

```
urn:ietf:params:scim:schemas:extension:{name}:{version}:{ResourceType}
```

Examples from the RFC and industry:

| URN | Source |
|-----|--------|
| `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` | RFC 7643 §4.3 |
| `urn:ietf:params:scim:schemas:extension:custom:2.0:User` | Common vendor pattern |
| `urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User` | Microsoft SCIM Validator |

> **Important**: The URN format is a convention, not a strict requirement. Any URI that is unique can serve as an extension identifier. However, the `urn:ietf:params:scim:schemas:extension:` prefix is strongly recommended for interoperability.

### 2.4 `schemas[]` Array Semantics

RFC 7643 §3.1 defines the `schemas` attribute:

> "The 'schemas' attribute is a REQUIRED attribute and is an array of Strings containing URIs that are used to indicate the namespaces of the SCIM schemas that define the attributes present in the current structure."

**Implications:**

| Scenario | Expected `schemas[]` | RFC Basis |
|----------|-----------------------|-----------|
| User with no extensions | `["urn:...core:2.0:User"]` | §3.1 |
| User with enterprise extension | `["urn:...core:2.0:User", "urn:...enterprise:2.0:User"]` | §3.1, §3.3 |
| User with custom extension | `["urn:...core:2.0:User", "urn:...custom:2.0:User"]` | §3.1, §3.3 |
| User with enterprise + custom | `["urn:...core:2.0:User", "urn:...enterprise:2.0:User", "urn:...custom:2.0:User"]` | §3.1, §3.3 |

**Strict vs. permissive enforcement**: The RFC says `schemas[]` should reflect which extensions are present, but does not mandate that the server reject payloads where `schemas[]` does not perfectly match the body. Our `StrictSchemaValidation` flag controls this.

### 2.5 Extension Attribute Characteristics

Extension attributes have the **same characteristics** as core attributes (type, mutability, returned, required, etc.). The same immutability rules apply - once defined, an extension's attribute characteristics cannot be changed.

---

## 3. Custom Resource Types (RFC 7643 §6)

### 3.1 What the RFC Says

> **RFC 7643 §6**: "Each SCIM resource is a JSON object that has the following common attributes: [...] A Resource Type defines a set of schemas and the corresponding endpoint."

The RFC explicitly defines ResourceType as a discovery mechanism:

```json
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
      "required": true
    }
  ]
}
```

### 3.2 Custom Resource Type Rules

| Rule | RFC Source | Description |
|------|-----------|-------------|
| **Resource types are enumerable** | §6 | `/ResourceTypes` endpoint lists all available types |
| **Each type has a core schema** | §6 | `schema` field references the primary schema URN |
| **Each type has an endpoint** | §6 | `endpoint` field is the URL path (e.g., `/Users`, `/Devices`) |
| **Extensions are per-type** | §6 | `schemaExtensions[]` declares which extensions apply to this type |
| **Custom types are allowed** | §6 | The spec explicitly says "implementations MAY define additional resource types" |
| **Custom types use the same CRUD** | RFC 7644 §3 | Custom types support the same HTTP verbs (GET, POST, PUT, PATCH, DELETE) |

### 3.3 What Custom Types Cannot Do

| Restriction | Reason |
|-------------|--------|
| Cannot reuse `/Users` or `/Groups` endpoints | Would conflict with built-in types |
| Cannot redefine core schemas | Extension mechanism is the only way to add attributes |
| Cannot have the same `name` as built-in types | Name is used as the unique identifier in `/ResourceTypes` |
| Cannot override SCIM reserved endpoints | `/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig`, `/Bulk`, `/Me` |

---

## 4. Discovery Endpoints (RFC 7644 §4, RFC 7643 §5–§7)

### 4.1 Three Required Discovery Endpoints

| Endpoint | RFC Section | Authentication | Content |
|----------|-------------|----------------|---------|
| `/ServiceProviderConfig` | RFC 7644 §4 | None required | Server capabilities (patch, bulk, filter, sort, etag, changePassword, authenticationSchemes) |
| `/Schemas` | RFC 7643 §7, RFC 7644 §4 | None required | All schema definitions with full attribute metadata |
| `/ResourceTypes` | RFC 7643 §6, RFC 7644 §4 | None required | All resource types with schema + extension mappings |

### 4.2 Discovery Accuracy Requirements

> **RFC 7644 §4**: "An HTTP client MAY use these endpoints to discover the types of resources available on a SCIM service provider and the schema of those resources."

**Key accuracy rules:**

1. **`/Schemas` must return ALL schemas** - core + extensions + custom resource type schemas
2. **`/ResourceTypes` must list ALL resource types** - built-in + custom, with accurate `schemaExtensions[]`
3. **`/ServiceProviderConfig` must reflect actual capabilities** - not aspirational; if `bulk.supported: true`, Bulk MUST work
4. **Discovery endpoints do not require authentication** - RFC 7644 §4 explicitly says these "do not require authentication"
5. **Schema definitions must include all attribute characteristics** - type, mutability, returned, required, caseExact, uniqueness, subAttributes

### 4.3 Extension Visibility in Discovery

When extensions are registered, they must appear in:

| Discovery Response | What Changes |
|-------------------|--------------|
| `GET /Schemas` | New schema definition added to the list |
| `GET /Schemas/{urn}` | Extension schema retrievable by URN |
| `GET /ResourceTypes` | Parent resource type's `schemaExtensions[]` updated |
| `GET /ResourceTypes/{id}` | Specific resource type shows new extension |

---

## 5. What the RFCs Are Silent On

The following topics are **not addressed** by RFC 7642, 7643, or 7644. These are implementation decisions where the server has discretion.

### 5.1 Runtime Schema Changes

| Topic | RFC Position | Industry Consensus |
|-------|-------------|-------------------|
| **Can extensions be added at runtime?** | Silent | Yes - most implementations support dynamic extension registration |
| **Can extensions be removed at runtime?** | Silent | Dangerous - removing extensions can break existing clients; additive-only is safer |
| **Can attribute definitions within extensions change?** | Silent | Avoid - attribute characteristics should be stable once published; changing `mutability` or `type` breaks clients |
| **Can new resource types be registered at runtime?** | Silent | Yes - some implementations support dynamic resource type creation |
| **Deploy-time vs. runtime configuration?** | Silent | Industry favors deploy-time for core config, runtime for extensions |

### 5.2 Extension Lifecycle Management

| Topic | RFC Position | Our Decision |
|-------|-------------|--------------|
| Extension versioning | Silent | New URN for new version (e.g., `custom:3.0:User`) |
| Extension deprecation | Silent | Not implemented; remove via Admin API |
| Extension migration | Silent | Not implemented; manual data migration |
| Schema validation strictness | Silent | Configurable via `StrictSchemaValidation` flag |
| Extension ordering in `schemas[]` | Silent | Core URN first, then extensions in registration order |

### 5.3 Multi-Tenant Schema Isolation

| Topic | RFC Position | Our Decision |
|-------|-------------|--------------|
| Per-tenant schemas | Silent | Per-endpoint schema overlays (endpoints are our tenant isolation boundary) |
| Schema inheritance between tenants | Silent | No inheritance; each endpoint has independent overlays |
| Global vs. per-tenant extensions | Silent | Built-in extensions (Enterprise, msfttest) are global; registered extensions are per-endpoint |

---

## 6. `schemas[]` Enforcement Matrix

The following matrix shows how `schemas[]` should be validated based on the RFC vs. actual behavior:

### 6.1 On Inbound Requests (POST / PUT)

| Scenario | RFC Expectation | `StrictSchemaValidation: false` | `StrictSchemaValidation: true` |
|----------|----------------|--------------------------------|-------------------------------|
| `schemas[]` missing entirely | Should be rejected per §3.1 | Accepted (schemas[] auto-built) | Rejected - 400 |
| `schemas[]` has core URN only, extension data present | Should include extension URNs | Accepted | Rejected - 400 (undeclared extension data) |
| `schemas[]` has extension URN, no matching extension data | Permissive per §3.1 | Accepted | Accepted (URN declared but no data - harmless) |
| `schemas[]` has unknown URN | Not addressed | Accepted (unknown URN ignored) | Rejected - 400 (unregistered schema) |
| `schemas[]` has correct core + correct extensions | Correct per §3.1 | Accepted | Accepted |

### 6.2 On Outbound Responses (GET / LIST)

| Behavior | RFC Expectation | Our Implementation |
|----------|----------------|-------------------|
| `schemas[]` reflects present extensions | YES - §3.1 requires it | ✅ Built dynamically by `buildResourceSchemas()` |
| Extension URN in `schemas[]` only if extension data exists | YES - §3.1 | ✅ Checks for URN key in payload |
| Core URN always present | YES - §3.1 | ✅ Always included first |

---

## 7. Attribute Characteristics Deep Dive

### 7.1 `mutability` (RFC 7643 §2.2)

| Value | Meaning | Create (POST) | Replace (PUT) | Modify (PATCH) | Read (GET) |
|-------|---------|---------------|---------------|----------------|------------|
| `readOnly` | Server-managed, client-provided values ignored or rejected | Reject/strip | Reject/strip | Reject/strip | Returned |
| `readWrite` | Client and server can both modify | Accepted | Accepted | Accepted | Returned |
| `immutable` | Can be set once on create, never changed | Accepted | Must match existing | Must match existing | Returned |
| `writeOnly` | Client can set, server never returns | Accepted | Accepted | Accepted | **Never returned** |

> **Important nuance**: RFC 7643 §2.2 says readOnly attributes sent by clients "SHALL be ignored by the service provider." Our implementation provides both behaviors: strip (default) or reject (strict mode), controlled by the `IgnoreReadOnlyAttributesInPatch` flag.

### 7.2 `returned` (RFC 7643 §2.4)

| Value | Meaning | Behavior |
|-------|---------|----------|
| `always` | Always included in responses | Returned in GET, LIST, POST, PUT, PATCH |
| `never` | Never included in responses | Stripped from ALL responses (e.g., `password`) |
| `default` | Returned unless excluded by `excludedAttributes` | Returned unless explicitly excluded |
| `request` | Only returned when requested via `attributes` parameter | NOT returned by default; only when in `?attributes=` |

> **Cross-reference**: Our implementation → [G8E_RETURNED_CHARACTERISTIC_FILTERING.md](G8E_RETURNED_CHARACTERISTIC_FILTERING.md)

### 7.3 `uniqueness` (RFC 7643 §2.7)

| Value | Meaning |
|-------|---------|
| `none` | No uniqueness constraint |
| `server` | Unique within the service provider (e.g., `userName`) |
| `global` | Globally unique (rarely used in practice) |

### 7.4 `caseExact` (RFC 7643 §2.5)

| Value | Meaning | Impact on Filtering |
|-------|---------|---------------------|
| `true` | Case-sensitive comparison | `userName eq "John"` ≠ `userName eq "john"` |
| `false` | Case-insensitive comparison (default) | `userName eq "John"` = `userName eq "john"` |

> **Cross-reference**: Our implementation → [SCIM_CASE_INSENSITIVITY_REFERENCE.md](SCIM_CASE_INSENSITIVITY_REFERENCE.md), [P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md](P2_ATTRIBUTE_CHARACTERISTIC_ENFORCEMENT.md) (R-CASE-1)

---

## 8. Enterprise User Extension (RFC 7643 §4.3)

The only extension defined by the SCIM RFCs themselves:

### 8.1 Schema URN

```
urn:ietf:params:scim:schemas:extension:enterprise:2.0:User
```

### 8.2 Attributes

| Attribute | Type | Required | Mutability | Description |
|-----------|------|----------|------------|-------------|
| `employeeNumber` | String | false | readWrite | Unique employee identifier |
| `costCenter` | String | false | readWrite | Cost center identifier |
| `organization` | String | false | readWrite | Organization name |
| `division` | String | false | readWrite | Division name |
| `department` | String | false | readWrite | Department name |
| `manager` | Complex | false | readWrite | Manager reference |
| `manager.value` | String | false | readWrite | Manager user `id` |
| `manager.$ref` | Reference | false | readWrite | Manager URI reference |
| `manager.displayName` | String | false | readOnly | Manager display name (server-populated) |

### 8.3 ResourceType Declaration

```json
{
  "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  "required": true
}
```

> The RFC declares `required: true` for EnterpriseUser on the User resource type, meaning compliant servers SHOULD support it on all User resources.

---

## 9. PATCH Operations and Extensions (RFC 7644 §3.5.2)

### 9.1 Extension-Aware PATCH Paths

PATCH operations can target extension attributes using fully-qualified URN paths:

```json
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

### 9.2 PATCH Path Resolution

| Path Format | Example | Resolution |
|-------------|---------|------------|
| Simple attribute | `displayName` | Core schema attribute |
| Dotted sub-attribute | `name.familyName` | Core schema complex sub-attribute |
| Extension attribute | `urn:...enterprise:2.0:User:department` | Extension schema attribute |
| Extension sub-attribute | `urn:...enterprise:2.0:User:manager.displayName` | Extension complex sub-attribute |
| Filtered attribute | `emails[type eq "work"]` | Multi-valued attribute filter |
| Filtered sub-attribute | `emails[type eq "work"].value` | Multi-valued attribute filter + sub-attribute |

### 9.3 PATCH Without Path (Bulk Merge)

When no `path` is specified, the `value` object is merged into the resource root:

```json
{
  "op": "add",
  "value": {
    "displayName": "New Name",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      "department": "New Dept"
    }
  }
}
```

> This replaces the entire extension block if the extension URN key exists in the value.

---

## 10. Industry Implementation Patterns

### 10.1 Vendor Comparison

| Feature | Entra ID | Okta | PingIdentity | AWS IAM Identity Center | SCIMServer |
|---------|----------|------|-------------|------------------------|------------|
| Custom extensions | Yes (app-specific) | Yes (universal directory) | Yes | Limited | Yes (per-endpoint) |
| Runtime extension registration | Via app manifest | API-driven | Config file | No | Admin API |
| Custom resource types | No | No | Limited | No | Yes (v0.17.3+) |
| Strict schema validation | Always on | Always on | Configurable | Always on | Configurable per-endpoint |
| Extension URN format | `urn:ietf:...:custom:2.0:User` | Custom URN | Custom URN | N/A | Any valid URN |
| `schemas[]` enforcement | Permissive | Permissive | Strict | Strict | Configurable |

### 10.2 Industry Norms for Extension Lifecycle

1. **Additive-only is the safest pattern** - Extensions should only be added, never removed or redefined
2. **Version via new URN** - Instead of changing an extension, create a new version: `custom:3.0:User`
3. **Extension discovery is critical** - Clients rely on `/Schemas` and `/ResourceTypes` to detect available extensions
4. **Unknown extensions should be ignored** - Permissive implementations store and echo back unknown extension blocks
5. **`schemas[]` mismatch is usually tolerated** - Most implementations auto-build `schemas[]` on responses rather than rejecting mismatched inbound `schemas[]`

---

## 11. RFC Compliance Summary Table

| Topic | RFC Rule | SCIMServer Status | Notes |
|-------|---------|-------------------|-------|
| Core schema immutability | MUST NOT change characteristics | ✅ Compliant | Deep-frozen schema constants |
| Extension additive-only | SHOULD only add attributes | ✅ Compliant | Cannot modify core via extensions |
| Extension URN in `schemas[]` | MUST include when data present | ✅ Compliant | `buildResourceSchemas()` |
| Extension discovery in `/Schemas` | MUST return all schemas | ✅ Compliant | Registry-driven, includes per-endpoint |
| Extension linkage in `/ResourceTypes` | MUST declare `schemaExtensions[]` | ✅ Compliant | Merged global + per-endpoint |
| Custom resource types | MAY define additional types | ✅ Supported | Admin API + generic SCIM CRUD |
| Discovery without auth | SHOULD NOT require authentication | ✅ Compliant | `@Public()` decorator |
| `returned:'never'` enforcement | MUST NOT return | ✅ Compliant | Service-layer stripping (G8e) |
| `returned:'request'` enforcement | SHOULD only return when requested | ✅ Compliant | Controller-layer filtering (G8e) |
| `mutability:'readOnly'` enforcement | SHALL ignore/reject client values | ✅ Compliant | Strip or reject (configurable) |
| `mutability:'immutable'` enforcement | MUST NOT change after create | ✅ Compliant | `checkImmutable()` (H-2) |
| `mutability:'writeOnly'` enforcement | MUST NOT return | ✅ Compliant | Maps to `returned:'never'` (R-MUT-1) |
| PATCH extension attribute paths | MUST support URN-prefixed paths | ✅ Compliant | URN regex resolution |
| `schemas[]` validation | SHOULD match body content | ✅ Configurable | `StrictSchemaValidation` flag |
| Runtime schema changes | Silent | ✅ Supported | Admin API for extensions + resource types |
| Extension removal at runtime | Silent | ⚠️ Supported but risky | Admin DELETE available; data orphaned |

---

## Appendix A: RFC Section Cross-Reference

| RFC 7643 Section | Topic | Relevance |
|-----------------|-------|-----------|
| §2 | Definitions and data types | Attribute type system |
| §2.1 | Attribute names | Case-insensitivity rules |
| §2.2 | Attribute mutability | readOnly, readWrite, immutable, writeOnly |
| §2.3 | Data types | String, Boolean, Integer, Decimal, DateTime, Reference, Complex, Binary |
| §2.4 | Attribute returned | always, never, default, request |
| §2.5 | Attribute caseExact | Case sensitivity for comparisons |
| §2.6 | Attribute required | Required/optional enforcement |
| §2.7 | Attribute uniqueness | none, server, global |
| §3 | SCIM Schema | Top-level schema structure |
| §3.1 | Common attributes | `schemas`, `id`, `externalId`, `meta` |
| §3.3 | Schema extension model | Extension URN, namespaced attributes |
| §4.1 | User schema | Core User attributes |
| §4.2 | Group schema | Core Group attributes |
| §4.3 | Enterprise User extension | The only RFC-defined extension |
| §5 | ServiceProviderConfig schema | SPC attribute definitions |
| §6 | ResourceType schema | Resource type discovery + `schemaExtensions[]` |
| §7 | Schema definition schema | Schema-of-schemas (meta) |

| RFC 7644 Section | Topic | Relevance |
|-----------------|-------|-----------|
| §3 | SCIM Protocol | CRUD operations |
| §3.4.2 | Filtering | `filter` parameter and attribute paths |
| §3.5.2 | PATCH (Modifying) | PATCH operations with extension paths |
| §3.7 | Bulk operations | Multi-operation requests |
| §3.9 | Attribute projection | `attributes`/`excludedAttributes` parameters |
| §4 | Service Provider Config | Discovery endpoints (no auth required) |

| RFC 7642 Section | Topic | Relevance |
|-----------------|-------|-----------|
| §1 | Introduction | SCIM concepts and goals |
| §3 | SCIM use cases | Provisioning, de-provisioning scenarios |
| §5 | Attribute characteristics | Overview of the attribute metadata system |

---

## Appendix B: Key SCIM URN Constants

| URN | Purpose |
|-----|---------|
| `urn:ietf:params:scim:schemas:core:2.0:User` | Core User schema |
| `urn:ietf:params:scim:schemas:core:2.0:Group` | Core Group schema |
| `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` | Enterprise User extension |
| `urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig` | SPC schema |
| `urn:ietf:params:scim:schemas:core:2.0:Schema` | Schema-of-schemas |
| `urn:ietf:params:scim:schemas:core:2.0:ResourceType` | ResourceType schema |
| `urn:ietf:params:scim:api:messages:2.0:PatchOp` | PATCH request schema |
| `urn:ietf:params:scim:api:messages:2.0:ListResponse` | List response schema |
| `urn:ietf:params:scim:api:messages:2.0:Error` | Error response schema |
| `urn:ietf:params:scim:api:messages:2.0:SearchRequest` | POST-based search schema |
| `urn:ietf:params:scim:api:messages:2.0:BulkRequest` | Bulk request schema |
| `urn:ietf:params:scim:api:messages:2.0:BulkResponse` | Bulk response schema |

---

*Last updated: March 2, 2026*
