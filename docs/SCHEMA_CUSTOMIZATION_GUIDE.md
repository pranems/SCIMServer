# Schema Customization Guide — Operator Reference

## Overview

**Document Type**: Operator Usability Guide  
**Audience**: Operators, DevOps engineers, and anyone configuring SCIM schema extensions or custom resource types  
**Status**: ✅ Complete  
**Date**: March 2, 2026  
**Version**: 0.24.0

### Purpose

This guide provides step-by-step instructions for:

1. Registering custom schema extensions on endpoints
2. Creating custom resource types (beyond User/Group)
3. Configuring schema validation behavior
4. Understanding what you can and cannot customize
5. Do's, Don'ts, and common pitfalls

> **Cross-references:**
> - RFC rules → [RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md](RFC_SCHEMA_AND_EXTENSIONS_REFERENCE.md)
> - Architecture internals → [SCHEMA_LIFECYCLE_AND_REGISTRY.md](SCHEMA_LIFECYCLE_AND_REGISTRY.md)
> - Behavior matrices → [SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md](SCHEMA_EXTENSION_FLOWS_AND_COMBINATIONS.md)
> - Config flags → [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md)

---

## 1. Prerequisites

Before customizing schemas:

1. **An endpoint must exist** — Create one via the Admin API first
2. **The server must be running** — Schema changes are runtime operations via the Admin API
3. **Admin access** — Schema operations use the `/admin/` prefix (requires auth token)
4. **Understand the persistence backend** — InMemory mode loses customizations on restart; Prisma mode persists them

```bash
# Verify server is running and endpoint exists
curl -s http://localhost:6000/admin/endpoints \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].id'
```

---

## 2. Registering a Custom Schema Extension

### 2.1 What is a Schema Extension?

A schema extension adds new attributes to an existing resource type (User or Group). For example, adding a `department` and `floor` attribute to all Users.

### 2.2 Step-by-Step: Register an Extension

**Step 1**: Define your extension schema

```json
{
  "schemaUrn": "urn:example:scim:schemas:extension:acme:2.0:User",
  "name": "AcmeUserExtension",
  "description": "Custom attributes for Acme Corp users",
  "resourceTypeId": "User",
  "required": false,
  "attributes": [
    {
      "name": "department",
      "type": "string",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "User's department"
    },
    {
      "name": "floor",
      "type": "integer",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Building floor number"
    },
    {
      "name": "badges",
      "type": "complex",
      "multiValued": true,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Security badges",
      "subAttributes": [
        {
          "name": "badgeId",
          "type": "string",
          "multiValued": false,
          "required": true,
          "mutability": "readWrite",
          "returned": "default",
          "caseExact": true,
          "uniqueness": "none"
        },
        {
          "name": "level",
          "type": "string",
          "multiValued": false,
          "required": false,
          "mutability": "readWrite",
          "returned": "default",
          "caseExact": false,
          "uniqueness": "none",
          "canonicalValues": ["basic", "elevated", "admin"]
        }
      ]
    }
  ]
}
```

**Step 2**: Register it via the Admin API

```bash
ENDPOINT_ID="your-endpoint-id"

curl -X POST "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}/schemas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @acme-extension.json
```

**Expected response**: `201 Created` with the persisted record.

**Step 3**: Verify via discovery

```bash
# Check /Schemas — your extension should appear
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Schemas" \
  -H "Authorization: Bearer $TOKEN" | jq '.Resources[] | select(.id | contains("acme"))'

# Check /ResourceTypes — User's schemaExtensions should include your URN
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/ResourceTypes/User" \
  -H "Authorization: Bearer $TOKEN" | jq '.schemaExtensions'
```

**Step 4**: Use the extension in SCIM operations

```bash
# Create a user with the custom extension
curl -X POST "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": [
      "urn:ietf:params:scim:schemas:core:2.0:User",
      "urn:example:scim:schemas:extension:acme:2.0:User"
    ],
    "userName": "jane@acme.com",
    "active": true,
    "urn:example:scim:schemas:extension:acme:2.0:User": {
      "department": "Engineering",
      "floor": 3,
      "badges": [
        { "badgeId": "ENG-001", "level": "elevated" }
      ]
    }
  }'
```

### 2.3 Extension Attribute Types

| Type | JSON Type | Example Value | Notes |
|------|-----------|---------------|-------|
| `string` | String | `"Engineering"` | Default type |
| `boolean` | Boolean | `true` | True/false only |
| `integer` | Number | `42` | Whole numbers |
| `decimal` | Number | `3.14` | Floating point |
| `dateTime` | String | `"2026-03-01T10:00:00Z"` | ISO 8601 / xsd:dateTime format |
| `reference` | String | `"https://example.com/Users/abc"` | URI reference |
| `binary` | String | `"dGVzdA=="` | Base64-encoded binary |
| `complex` | Object | `{"value": "x", "type": "work"}` | Must define `subAttributes` |

### 2.4 Extension Attribute Characteristics

| Characteristic | Required | Values | Default |
|----------------|----------|--------|---------|
| `name` | Yes | Any string | — |
| `type` | Yes | See table above | — |
| `multiValued` | Yes | `true` / `false` | — |
| `required` | Yes | `true` / `false` | — |
| `mutability` | Yes | `readOnly`, `readWrite`, `immutable`, `writeOnly` | — |
| `returned` | Yes | `always`, `never`, `default`, `request` | — |
| `caseExact` | Yes | `true` / `false` | — |
| `uniqueness` | Yes | `none`, `server`, `global` | — |
| `description` | No | Any string | — |
| `referenceTypes` | No | Array of strings | — |
| `subAttributes` | Only for `complex` | Array of attribute definitions | — |
| `canonicalValues` | No | Array of strings | — |

### 2.5 List Extensions for an Endpoint

```bash
curl -s "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}/schemas" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

### 2.6 Remove an Extension

```bash
curl -X DELETE "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}/schemas/urn:example:scim:schemas:extension:acme:2.0:User" \
  -H "Authorization: Bearer $TOKEN"
```

> **⚠️ Warning**: Removing an extension does NOT remove the extension data from existing resources. The data remains in the JSONB payload but will no longer be validated or appear in discovery. See [Do's and Don'ts](#7-dos-and-donts) for guidance.

---

## 3. Creating Custom Resource Types

### 3.1 What is a Custom Resource Type?

A custom resource type lets you manage resources beyond the built-in User and Group. For example, `Device`, `Application`, `License`, or `AccessRequest`.

### 3.2 Prerequisites

The `CustomResourceTypesEnabled` flag must be enabled for the endpoint:

```bash
# Enable custom resource types for an endpoint
curl -X PATCH "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "CustomResourceTypesEnabled": true
    }
  }'
```

### 3.3 Step-by-Step: Register a Custom Resource Type

**Step 1**: Create the core schema for your resource type

```bash
# First, register the schema that defines your resource type's attributes
curl -X POST "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}/schemas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaUrn": "urn:example:scim:schemas:core:2.0:Device",
    "name": "Device",
    "description": "Network device resource",
    "attributes": [
      {
        "name": "deviceName",
        "type": "string",
        "multiValued": false,
        "required": true,
        "mutability": "readWrite",
        "returned": "default",
        "caseExact": false,
        "uniqueness": "server"
      },
      {
        "name": "deviceType",
        "type": "string",
        "multiValued": false,
        "required": true,
        "mutability": "readWrite",
        "returned": "default",
        "caseExact": false,
        "uniqueness": "none",
        "canonicalValues": ["laptop", "desktop", "mobile", "server"]
      },
      {
        "name": "serialNumber",
        "type": "string",
        "multiValued": false,
        "required": false,
        "mutability": "immutable",
        "returned": "default",
        "caseExact": true,
        "uniqueness": "server"
      },
      {
        "name": "assignedTo",
        "type": "reference",
        "multiValued": false,
        "required": false,
        "mutability": "readWrite",
        "returned": "default",
        "caseExact": false,
        "uniqueness": "none",
        "referenceTypes": ["User"]
      },
      {
        "name": "metadata",
        "type": "complex",
        "multiValued": false,
        "required": false,
        "mutability": "readWrite",
        "returned": "default",
        "caseExact": false,
        "uniqueness": "none",
        "subAttributes": [
          {
            "name": "os",
            "type": "string",
            "multiValued": false,
            "required": false,
            "mutability": "readWrite",
            "returned": "default",
            "caseExact": false,
            "uniqueness": "none"
          },
          {
            "name": "lastSeen",
            "type": "dateTime",
            "multiValued": false,
            "required": false,
            "mutability": "readWrite",
            "returned": "default",
            "caseExact": false,
            "uniqueness": "none"
          }
        ]
      }
    ]
  }'
```

**Step 2**: Register the resource type

```bash
curl -X POST "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}/resource-types" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Device",
    "schemaUri": "urn:example:scim:schemas:core:2.0:Device",
    "endpoint": "/Devices",
    "description": "Network device resource type",
    "schemaExtensions": []
  }'
```

**Expected response**: `201 Created`

**Step 3**: Verify via discovery

```bash
# Check /ResourceTypes
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/ResourceTypes" \
  -H "Authorization: Bearer $TOKEN" | jq '.Resources[] | select(.name == "Device")'
```

**Step 4**: Use SCIM CRUD on your custom resource type

```bash
# CREATE a device
curl -X POST "http://localhost:6000/endpoints/${ENDPOINT_ID}/Devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:example:scim:schemas:core:2.0:Device"],
    "deviceName": "MacBook Pro - Jane",
    "deviceType": "laptop",
    "serialNumber": "C02X123456",
    "metadata": {
      "os": "macOS 15.3",
      "lastSeen": "2026-03-01T09:30:00Z"
    }
  }'

# LIST devices
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Devices" \
  -H "Authorization: Bearer $TOKEN" | jq '.Resources'

# GET a specific device
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Devices/${DEVICE_ID}" \
  -H "Authorization: Bearer $TOKEN"

# PATCH a device
curl -X PATCH "http://localhost:6000/endpoints/${ENDPOINT_ID}/Devices/${DEVICE_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {
        "op": "replace",
        "path": "metadata.os",
        "value": "macOS 15.4"
      }
    ]
  }'

# REPLACE a device (PUT)
curl -X PUT "http://localhost:6000/endpoints/${ENDPOINT_ID}/Devices/${DEVICE_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:example:scim:schemas:core:2.0:Device"],
    "deviceName": "MacBook Pro - Jane (Updated)",
    "deviceType": "laptop",
    "serialNumber": "C02X123456",
    "metadata": {
      "os": "macOS 15.4",
      "lastSeen": "2026-03-02T11:00:00Z"
    }
  }'

# DELETE a device
curl -X DELETE "http://localhost:6000/endpoints/${ENDPOINT_ID}/Devices/${DEVICE_ID}" \
  -H "Authorization: Bearer $TOKEN"
```

### 3.4 Reserved Names and Paths

You **cannot** use these names or paths for custom resource types:

**Reserved Names** (case-sensitive):

| Name | Reason |
|------|--------|
| `User` | Built-in resource type |
| `Group` | Built-in resource type |

**Reserved Paths** (case-sensitive):

| Path | Reason |
|------|--------|
| `/Users` | Built-in User CRUD |
| `/Groups` | Built-in Group CRUD |
| `/Schemas` | RFC discovery endpoint |
| `/ResourceTypes` | RFC discovery endpoint |
| `/ServiceProviderConfig` | RFC discovery endpoint |
| `/Bulk` | RFC bulk operations |
| `/Me` | RFC delegated identity |

### 3.5 Adding Extensions to Custom Resource Types

Custom resource types can also have schema extensions:

```bash
# Register an extension for the Device resource type
curl -X POST "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}/schemas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaUrn": "urn:example:scim:schemas:extension:warranty:2.0:Device",
    "name": "DeviceWarranty",
    "description": "Warranty information for devices",
    "resourceTypeId": "Device",
    "required": false,
    "attributes": [
      {
        "name": "warrantyExpiry",
        "type": "dateTime",
        "multiValued": false,
        "required": false,
        "mutability": "readWrite",
        "returned": "default",
        "caseExact": false,
        "uniqueness": "none"
      },
      {
        "name": "warrantyType",
        "type": "string",
        "multiValued": false,
        "required": false,
        "mutability": "readWrite",
        "returned": "default",
        "caseExact": false,
        "uniqueness": "none",
        "canonicalValues": ["standard", "extended", "premium"]
      }
    ]
  }'
```

---

## 4. Configuring Schema Validation

### 4.1 StrictSchemaValidation

Controls whether the server validates inbound payloads against registered schema definitions.

| Value | Behavior |
|-------|----------|
| `false` (default) | No schema validation — unknown attributes and extension URNs are accepted and stored as-is in JSONB |
| `true` | Full validation — checks required attributes, types, mutability, unknown attributes, schemas[] array, immutable enforcement |

```bash
# Enable strict validation
curl -X PATCH "http://localhost:6000/admin/endpoints/${ENDPOINT_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "StrictSchemaValidation": true
    }
  }'
```

**When strict mode is ON, these will be rejected:**

```bash
# ❌ Rejected: Unknown extension URN
curl -X POST "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:unknown:ext"],
    "userName": "test@example.com",
    "urn:unknown:ext": { "foo": "bar" }
  }'
# → 400 Bad Request: "Unregistered schema URN: urn:unknown:ext"

# ❌ Rejected: Missing schemas[] array
curl -X POST "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{ "userName": "test@example.com" }'
# → 400 Bad Request: "Missing required attribute: schemas"

# ❌ Rejected: readOnly attribute provided
curl -X POST "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "test@example.com",
    "id": "manually-set-id"
  }'
# → 400 Bad Request: "Attribute 'id' is readOnly and cannot be set by client"
```

### 4.2 AllowAndCoerceBooleanStrings

Controls boolean string coercion (e.g., `"True"` → `true`):

| Value | Behavior |
|-------|----------|
| `true` (default) | `"True"`, `"true"`, `"False"`, `"false"` strings are converted to booleans for schema-declared boolean attributes |
| `false` | No coercion — `"True"` stays as string `"True"` |

This is particularly important for Entra ID compatibility, which sometimes sends boolean values as strings.

### 4.3 IgnoreReadOnlyAttributesInPatch

Controls how readOnly attributes in PATCH operations are handled when strict mode is on:

| Value | Behavior |
|-------|----------|
| `false` (default) | PATCH ops targeting readOnly attributes are **rejected** with 400 |
| `true` | PATCH ops targeting readOnly attributes are **silently stripped** (removed from the operation list) |

### 4.4 IncludeWarningAboutIgnoredReadOnlyAttribute

Controls whether a warning is included when readOnly attributes are stripped:

| Value | Behavior |
|-------|----------|
| `false` (default) | No warning |
| `true` | Adds `urn:scimserver:api:messages:2.0:Warning` to the `schemas[]` array of write responses when readOnly attributes were stripped |

### 4.5 Recommended Configuration Profiles

#### Profile: Entra ID Compatible (Permissive)

```json
{
  "config": {
    "StrictSchemaValidation": false,
    "AllowAndCoerceBooleanStrings": true,
    "CustomResourceTypesEnabled": false,
    "IgnoreReadOnlyAttributesInPatch": false,
    "IncludeWarningAboutIgnoredReadOnlyAttribute": false
  }
}
```

#### Profile: Strict RFC Compliant

```json
{
  "config": {
    "StrictSchemaValidation": true,
    "AllowAndCoerceBooleanStrings": false,
    "CustomResourceTypesEnabled": false,
    "IgnoreReadOnlyAttributesInPatch": false,
    "IncludeWarningAboutIgnoredReadOnlyAttribute": true
  }
}
```

#### Profile: Full-Featured (Extensions + Custom Types + Strict)

```json
{
  "config": {
    "StrictSchemaValidation": true,
    "AllowAndCoerceBooleanStrings": true,
    "CustomResourceTypesEnabled": true,
    "IgnoreReadOnlyAttributesInPatch": true,
    "IncludeWarningAboutIgnoredReadOnlyAttribute": true
  }
}
```

---

## 5. PATCH Operations on Extension Attributes

### 5.1 Path-Based PATCH

Use URN-prefixed paths to target extension attributes:

```bash
# Replace an extension attribute
curl -X PATCH "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {
        "op": "replace",
        "path": "urn:example:scim:schemas:extension:acme:2.0:User:department",
        "value": "Marketing"
      }
    ]
  }'
```

### 5.2 No-Path Merge PATCH

Merge an entire extension block without specifying paths:

```bash
curl -X PATCH "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {
        "op": "add",
        "value": {
          "urn:example:scim:schemas:extension:acme:2.0:User": {
            "department": "Marketing",
            "floor": 5
          }
        }
      }
    ]
  }'
```

### 5.3 Multi-Valued Extension Attribute PATCH

```bash
# Add a badge to the multi-valued badges array
curl -X PATCH "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {
        "op": "add",
        "path": "urn:example:scim:schemas:extension:acme:2.0:User:badges",
        "value": [
          { "badgeId": "SEC-002", "level": "admin" }
        ]
      }
    ]
  }'
```

### 5.4 Remove Extension Data

```bash
# Remove the entire extension block
curl -X PATCH "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      {
        "op": "remove",
        "path": "urn:example:scim:schemas:extension:acme:2.0:User"
      }
    ]
  }'
```

---

## 6. Discovery Verification Checklist

After making schema changes, verify the following:

### 6.1 Extension Registration Verification

```bash
# ✅ 1. Extension appears in /Schemas
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Schemas" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.Resources[].id]'
# Should include your extension URN

# ✅ 2. Extension details are correct
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Schemas/urn:example:scim:schemas:extension:acme:2.0:User" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{name, attributes: [.attributes[].name]}'

# ✅ 3. ResourceType shows extension in schemaExtensions[]
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/ResourceTypes/User" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.schemaExtensions'
# Should include {"schema": "urn:...acme:2.0:User", "required": false}

# ✅ 4. Resources with extension data include URN in schemas[]
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.schemas'
# Should include your extension URN if extension data is present
```

### 6.2 Custom Resource Type Verification

```bash
# ✅ 1. ResourceType appears in /ResourceTypes
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/ResourceTypes" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.Resources[] | select(.name == "Device")'

# ✅ 2. CRUD works on the custom endpoint
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Devices" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.totalResults'

# ✅ 3. Schema appears in /Schemas
curl -s "http://localhost:6000/endpoints/${ENDPOINT_ID}/Schemas/urn:example:scim:schemas:core:2.0:Device" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.name'
```

---

## 7. Do's and Don'ts

### ✅ DO

| Practice | Reason |
|----------|--------|
| **DO use unique URN identifiers** | URN collisions cause unpredictable behavior. Use your organization's domain: `urn:acme:scim:schemas:extension:...` |
| **DO register the extension schema BEFORE creating resources** | Ensures correct validation and discovery from the start |
| **DO include all attribute characteristics** | Every attribute needs `type`, `mutability`, `returned`, `required`, `multiValued`, `caseExact`, `uniqueness` |
| **DO verify discovery after registration** | Confirm `/Schemas` and `/ResourceTypes` reflect your changes |
| **DO use `StrictSchemaValidation: true` in production** | Catches malformed payloads early; prevents data quality issues |
| **DO version extension URNs** | When changing extension structure, create a new version: `acme:3.0:User` |
| **DO test PATCH operations with extension paths** | URN-prefixed paths have specific syntax that must be tested |
| **DO define `subAttributes` for complex types** | Required for the validator to check nested objects |
| **DO persist schema customizations** | Use Prisma (PostgreSQL) backend; InMemory mode loses changes on restart |
| **DO register the core schema first when creating custom resource types** | The resource type needs a `schemaUri` that points to an existing schema |

### ❌ DON'T

| Anti-Pattern | Consequence |
|--------------|-------------|
| **DON'T try to override core schemas** | `urn:...core:2.0:User` and `urn:...core:2.0:Group` are protected — registration will fail |
| **DON'T remove extensions with live data** | Extension data remains in resources but becomes invisible to discovery and validation |
| **DON'T change extension attribute characteristics after deployment** | Changing `type`, `mutability`, or `returned` breaks existing clients. Version the URN instead |
| **DON'T use reserved names for custom resource types** | `User`, `Group` will be rejected |
| **DON'T use reserved endpoint paths** | `/Users`, `/Groups`, `/Schemas`, etc. will be rejected |
| **DON'T rely on schemas[] auto-building with strict mode** | With `StrictSchemaValidation: true`, missing `schemas[]` is a 400 error |
| **DON'T mix InMemory and Prisma for schema registration** | InMemory loses registrations on restart; Prisma persists them |
| **DON'T create extensions with empty attributes arrays** | While technically allowed, an extension with no attributes adds no value |
| **DON'T set `required: true` on extensions unless needed** | Required extensions must be present on ALL resources of that type — this is strict |
| **DON'T forget to enable `CustomResourceTypesEnabled` before registering custom types** | Registration will fail with 400 |

---

## 8. Troubleshooting

### 8.1 Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `400: Cannot overwrite core schema` | Tried to register with a core schema URN | Use a custom URN, not `urn:...core:2.0:User` |
| `400: Schema already registered` | Duplicate URN for this endpoint | Delete the existing schema first, or use a different URN |
| `400: Custom resource types are not enabled` | `CustomResourceTypesEnabled` is `false` | Enable the flag on the endpoint config |
| `400: Reserved resource type name` | Used `User` or `Group` as custom RT name | Choose a different name |
| `400: Reserved endpoint path` | Used `/Users`, `/Groups`, etc. as custom RT path | Choose a different path (e.g., `/Devices`) |
| `404: Endpoint not found` | Invalid `endpointId` | Check endpoint exists via `GET /admin/endpoints` |
| `400: Unregistered schema URN` (strict mode) | Extension URN in body not registered | Register the extension first, or disable `StrictSchemaValidation` |
| `400: Missing required attribute: schemas` (strict mode) | No `schemas[]` in POST/PUT body | Include the `schemas` array with correct URNs |

### 8.2 Extension Data Orphaned After Removal

If you remove an extension and then GET a resource that has extension data:

- **With `StrictSchemaValidation: false`**: The extension data is still in the JSONB payload and will be returned (extension URN will NOT appear in `schemas[]`)
- **With `StrictSchemaValidation: true`**: The extension data is still stored but the URN won't be in `schemas[]`; subsequent PUTs with the unknown URN will be rejected

**Resolution**: If you need to clean up orphaned data, write a migration script to remove the extension keys from affected resources.

### 8.3 InMemory Mode and Persistence

Schema registrations in InMemory mode are **volatile**:

- ✅ `onModuleInit()` re-hydrates from DB (but InMemory DB is also empty on startup)
- ❌ Registrations are lost on server restart
- ✅ Built-in schemas (User, Group, Enterprise, msfttest) are always available

**Recommendation**: Use Prisma (PostgreSQL) backend for any environment where schema customizations matter.

---

## 9. Advanced: Extension Schema Template

Here is a complete, production-ready extension template you can customize:

```json
{
  "schemaUrn": "urn:YOUR_ORG:scim:schemas:extension:YOUR_EXT:2.0:User",
  "name": "YourExtensionName",
  "description": "Description of what this extension adds",
  "resourceTypeId": "User",
  "required": false,
  "attributes": [
    {
      "name": "simpleString",
      "type": "string",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "A simple string attribute"
    },
    {
      "name": "requiredField",
      "type": "string",
      "multiValued": false,
      "required": true,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "This field must be provided on create"
    },
    {
      "name": "immutableId",
      "type": "string",
      "multiValued": false,
      "required": false,
      "mutability": "immutable",
      "returned": "default",
      "caseExact": true,
      "uniqueness": "server",
      "description": "Set once on create, cannot be changed"
    },
    {
      "name": "writeOnlySecret",
      "type": "string",
      "multiValued": false,
      "required": false,
      "mutability": "writeOnly",
      "returned": "never",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Write-only field — never returned in responses"
    },
    {
      "name": "serverManaged",
      "type": "dateTime",
      "multiValued": false,
      "required": false,
      "mutability": "readOnly",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Server-managed field — client values ignored"
    },
    {
      "name": "requestOnly",
      "type": "string",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "request",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Only returned when explicitly requested via ?attributes="
    },
    {
      "name": "tags",
      "type": "string",
      "multiValued": true,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Array of string tags"
    },
    {
      "name": "address",
      "type": "complex",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Complex single-valued attribute",
      "subAttributes": [
        {
          "name": "street",
          "type": "string",
          "multiValued": false,
          "required": false,
          "mutability": "readWrite",
          "returned": "default",
          "caseExact": false,
          "uniqueness": "none"
        },
        {
          "name": "city",
          "type": "string",
          "multiValued": false,
          "required": true,
          "mutability": "readWrite",
          "returned": "default",
          "caseExact": false,
          "uniqueness": "none"
        }
      ]
    },
    {
      "name": "contacts",
      "type": "complex",
      "multiValued": true,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "caseExact": false,
      "uniqueness": "none",
      "description": "Multi-valued complex attribute",
      "subAttributes": [
        {
          "name": "value",
          "type": "string",
          "multiValued": false,
          "required": true,
          "mutability": "readWrite",
          "returned": "default",
          "caseExact": false,
          "uniqueness": "none"
        },
        {
          "name": "type",
          "type": "string",
          "multiValued": false,
          "required": false,
          "mutability": "readWrite",
          "returned": "default",
          "caseExact": false,
          "uniqueness": "none",
          "canonicalValues": ["work", "home", "other"]
        },
        {
          "name": "primary",
          "type": "boolean",
          "multiValued": false,
          "required": false,
          "mutability": "readWrite",
          "returned": "default",
          "caseExact": false,
          "uniqueness": "none"
        }
      ]
    }
  ]
}
```

This template demonstrates every attribute type, mutability, returned characteristic, and complex/multi-valued combination.

---

## 10. Quick Reference Card

### Admin API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/endpoints/:id/schemas` | Register extension schema |
| `GET` | `/admin/endpoints/:id/schemas` | List all extension schemas |
| `GET` | `/admin/endpoints/:id/schemas/:urn` | Get specific extension schema |
| `DELETE` | `/admin/endpoints/:id/schemas/:urn` | Remove extension schema |
| `POST` | `/admin/endpoints/:id/resource-types` | Register custom resource type |
| `GET` | `/admin/endpoints/:id/resource-types` | List custom resource types |
| `GET` | `/admin/endpoints/:id/resource-types/:name` | Get specific custom resource type |
| `DELETE` | `/admin/endpoints/:id/resource-types/:name` | Remove custom resource type |

### Discovery Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/endpoints/:id/Schemas` | List all available schemas (no auth) |
| `GET` | `/endpoints/:id/Schemas/:urn` | Get specific schema (no auth) |
| `GET` | `/endpoints/:id/ResourceTypes` | List all resource types (no auth) |
| `GET` | `/endpoints/:id/ResourceTypes/:id` | Get specific resource type (no auth) |
| `GET` | `/endpoints/:id/ServiceProviderConfig` | Server capabilities (no auth) |

### Config Flags Quick Reference

| Flag | Default | Key Effect |
|------|---------|-----|
| `StrictSchemaValidation` | `false` | Full schema validation on writes |
| `CustomResourceTypesEnabled` | `false` | Enables custom resource type registration |
| `AllowAndCoerceBooleanStrings` | `true` | Boolean string coercion |
| `IgnoreReadOnlyAttributesInPatch` | `false` | Strip vs reject readOnly in PATCH |
| `IncludeWarningAboutIgnoredReadOnlyAttribute` | `false` | Warning URN in responses |

---

*Last updated: March 2, 2026*
