# Endpoint Configuration Flags Reference

> **Version:** 0.54.0-alpha.7 - **Updated:** June 18, 2026  
> **Source of truth:** [endpoint-profile.types.ts](../api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts) (`ProfileSettings`)  
> 17 flags: 15 boolean + 1 log level + 1 tri-state string (`PrimaryEnforcement`).  
> 4 value-types: `boolean`, `logLevel`, `primaryEnforcement`, `structured` (the last added Pre-Q.A, reserved for the WIF trust object).

---

## Table of Contents

- [Overview](#overview)
- [Flag Value Types](#flag-value-types)
- [How to Set Flags](#how-to-set-flags)
- [Flag Reference](#flag-reference)
- [Preset Defaults](#preset-defaults)
- [Flag Details](#flag-details)
- [Deprecated Flags](#deprecated-flags)

---

## Overview

Every endpoint has a `profile.settings` object containing behavioral configuration flags. These flags control SCIM protocol behavior, validation strictness, authentication, logging, and compatibility features.

Settings are part of the endpoint profile and can be:
- Set at creation via `profilePreset` (inherits preset defaults)
- Set at creation via inline `profile.settings`
- Updated at runtime via PATCH

```mermaid
flowchart LR
    subgraph Profile
        S[schemas]
        RT[resourceTypes]
        SPC[serviceProviderConfig]
        SET[settings]
    end
    SET --> F1[StrictSchemaValidation]
    SET --> F2[AllowAndCoerceBooleanStrings]
    SET --> F3[PrimaryEnforcement]
    SET --> F4[RequireIfMatch]
    SET --> F5[UserSoftDeleteEnabled]
    SET --> F6[VerbosePatchSupported]
    SET --> F7[...13 more flags]
```

---

## Flag Value Types

Every flag declares a `type` in the registry ([endpoint-config.interface.ts](../api/src/modules/endpoint/endpoint-config.interface.ts) `ENDPOINT_CONFIG_FLAGS_DEFINITIONS`). The validator (`validateEndpointConfig`) dispatches on that type, so adding a flag is a one-line registry entry - validation, defaulting, and discovery wiring follow automatically.

| Type | Accepted values | Reader helper | Validator |
|---|---|---|---|
| `boolean` | `true`/`false`, or the strings `"True"`/`"False"`/`"1"`/`"0"` (case-insensitive) | `getConfigBoolean` | `validateBooleanFlag` |
| `logLevel` | `"TRACE"`..`"OFF"` (case-insensitive) or `0`-`6` | `getConfigString` | `validateLogLevelFlag` |
| `primaryEnforcement` | `"passthrough"` / `"normalize"` / `"reject"` | `getConfigString` | `validatePrimaryEnforcementFlag` |
| `structured` | a JSON object, optionally constrained by a `structuredSchema` | `getConfigStructured` | `validateStructuredFlag` |

### The `structured` value-type (Pre-Q.A)

The `structured` type lets a flag carry a nested object value rather than a scalar. It is the enabling machinery for the WIF trust object (Q6.2); no production flag uses it yet. A `structured` flag definition may declare a `structuredSchema`:

- `allowedKeys` - any top-level key not in this list is rejected (`Unknown key "..."`).
- `requiredKeys` - every entry must be present (`Missing required key "..."`).

A non-object value (string, number, boolean, array, or `null`) is rejected with `Invalid type`. When no `structuredSchema` is declared, any object shape is accepted. Read a structured value with `getConfigStructured(config, key)`, which returns the object or `undefined` for missing/non-object values.

---

## How to Set Flags

### At Endpoint Creation

```bash
curl -X POST http://localhost:8080/scim/admin/endpoints \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-endpoint",
    "profilePreset": "entra-id",
    "profile": {
      "settings": {
        "RequireIfMatch": true,
        "logLevel": "DEBUG"
      }
    }
  }'
```

### Update at Runtime

```bash
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {
      "settings": {
        "VerbosePatchSupported": true,
        "PrimaryEnforcement": "reject"
      }
    }
  }'
```

Settings are **deep-merged** - only specified flags are updated, others remain unchanged.

---

## Flag Reference

| # | Flag | Type | Default | Category |
|---|------|------|---------|----------|
| 1 | [`StrictSchemaValidation`](#strictschemavalidation) | boolean | `true` | Validation |
| 2 | [`AllowAndCoerceBooleanStrings`](#allowandcoercebooleanstrings) | boolean | `true` | Compatibility |
| 3 | [`PrimaryEnforcement`](#primaryenforcement) | string | `passthrough` | Validation |
| 4 | [`RequireIfMatch`](#requireifmatch) | boolean | `false` | Concurrency |
| 5 | [`UserSoftDeleteEnabled`](#usersoftdeleteenabled) | boolean | `true` | Delete Behavior |
| 6 | [`UserHardDeleteEnabled`](#userharddeleteenabled) | boolean | `true` | Delete Behavior |
| 7 | [`GroupHardDeleteEnabled`](#groupharddeleteenabled) | boolean | `true` | Delete Behavior |
| 8 | [`MultiMemberPatchOpForGroupEnabled`](#multimemberpatchopforgroupenabled) | boolean | `true` | PATCH Behavior |
| 9 | [`PatchOpAllowRemoveAllMembers`](#patchopallowremoveallmembers) | boolean | `false` | PATCH Behavior |
| 10 | [`VerbosePatchSupported`](#verbosepatchsupported) | boolean | `false` | PATCH Behavior |
| 11 | [`IgnoreReadOnlyAttributesInPatch`](#ignorereadonlyattributesinpatch) | boolean | `false` | PATCH Behavior |
| 12 | [`IncludeWarningAboutIgnoredReadOnlyAttribute`](#includewarningaboutignoredreadonlyattribute) | boolean | `false` | PATCH Behavior |
| 13 | [`SchemaDiscoveryEnabled`](#schemadiscoveryenabled) | boolean | `true` | Discovery |
| 14 | [`PerEndpointCredentialsEnabled`](#perendpointcredentialsenabled) | boolean | `false` | Authentication |
| 15 | [`logLevel`](#loglevel) | string | (global) | Logging |
| 16 | [`logFileEnabled`](#logfileenabled) | boolean | `true` | Logging |
| 17 | [`WifCredentialsEnabled`](#wifcredentialsenabled) | boolean | `false` | Authentication |
| 18 | [`EnforceResourceTypes`](#enforceresourcetypes) | boolean | `true` | Resource Types |
| 19 | [`RfcCompliantSubAttributes`](#rfccompliantsubattributes) | boolean | `false` | Validation |

### WifCredentialsEnabled

When `true`, enables Workload Identity Federation (WIF) for the endpoint: a `wif`
credential may be attached (via `POST /admin/endpoints/:id/credentials` with
`credentialType:"wif"`) and the WIF token-mint path is offered. When `false`
(default), WIF is off and existing endpoints are untouched. **Orthogonal** to
`PerEndpointCredentialsEnabled` (the bcrypt-bearer gate): a `wif` credential is
permitted when `WifCredentialsEnabled` is on, independent of the bearer gate,
and a `bearer` credential still requires `PerEndpointCredentialsEnabled`.
Added in A1 ([docs/auth/AUTHENTICATION_METHODS_ADMIN_API.md](auth/AUTHENTICATION_METHODS_ADMIN_API.md)).

### EnforceResourceTypes

When `true` (**default**), a LIST/query on a resource type the endpoint profile
does not declare returns `404 RESOURCE_TYPE_NOT_SUPPORTED` (the v0.53.3 Gap-1
enforcement). When `false`, a **LIST/query** on an un-served resource type
instead returns a `200` empty `ListResponse` (RFC 7644 §3.4.2) plus a non-fatal
warning on three channels: a server log (**W1**), a
`urn:scimserver:api:messages:2.0:Warning` body member (**W2**), and an
`X-SCIM-Warning` response header (**W3**). **Item-by-id reads and all writes
(`POST`/`PUT`/`PATCH`/`DELETE`) still reject with `404`** regardless of the flag -
only LIST/query is relaxed. Applies symmetrically to `/Users` and `/Groups`.

**Set `false` for Microsoft Entra provisioning of a user-only (no Group)
endpoint**: Entra's Test Connection probes both `/Users` and `/Groups` and treats
a `/Groups` 404 as `SystemForCrossDomainIdentityManagementServiceIncompatible`.
See [ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.1a](ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md#81a-enforceresourcetypes-flag---relax-listquery-to-200-empty-entra-test-connection).

### RfcCompliantSubAttributes

When `false` (**default**) the current behavior is preserved exactly, so no
existing endpoint changes when this flag ships. When `true`, sub-attribute
shapes are handled per RFC 7643 instead. The flag governs exactly two rules:

| Rule | RFC | Flag OFF (default) | Flag ON |
|---|---|---|---|
| **R1** complex sub-attribute | [RFC 7643 §2.3.8](rfcs/rfc7643.txt), erratum 8415 | a schema may declare one and a payload populating it is **accepted** | the payload is **rejected** `400 invalidValue` |
| **R2** multi-valued SIMPLE sub-attribute | [RFC 7643 §1.2](rfcs/rfc7643.txt), erratum 5607 | **rejected** (`must be a string, got object`) | **accepted**, each element type-checked with an `[index]` path |

RFC 7643 §2.3.8 states a complex attribute "MUST NOT contain sub-attributes that
have sub-attributes (i.e., that are complex)", and §1.2 defines a simple
attribute as "singular or multi-valued", which is why a multi-valued *simple*
sub-attribute is legal while a *complex* one is not. See
[SCIM_SUBATTRIBUTE_TYPE_RULES.md](rfcs/SCIM_SUBATTRIBUTE_TYPE_RULES.md) for the
full combination matrix and the ISV/IdP survey.

**It is standalone.** It is deliberately NOT gated on
[`StrictSchemaValidation`](#strictschemavalidation), because the two answer
different questions: strict asks *how carefully do I police this payload*, while
this flag asks *is this schema shape legal at all*. A lenient endpoint must
still be able to refuse a shape the RFC forbids. Concretely:

- turning this flag on does **not** enable strict validation (undeclared
  attributes stay tolerated when strict is off), and
- turning `StrictSchemaValidation` off does **not** lift an R1 rejection.

Because of that, an R1 rejection is always attributed to this flag in the
diagnostics envelope, whatever the strict setting:

```json
{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:Error"
  ],
  "status": "400",
  "scimType": "invalidValue",
  "detail": "Schema validation failed: address.geo: Sub-attribute 'geo' is complex, but RFC 7643 2.3.8 forbids a complex attribute from containing complex sub-attributes.",
  "urn:scimserver:api:messages:2.0:Diagnostics": {
    "errorCode": "VALIDATION_SCHEMA",
    "triggeredBy": "RfcCompliantSubAttributes",
    "attributePaths": [
      "address.geo"
    ],
    "activeConfig": {
      "StrictSchemaValidation": true,
      "RfcCompliantSubAttributes": true
    }
  }
}
```

**When to turn it on.** Only if you author custom schemas and want the server to
hold you to the RFC's shape rules, or if you need multi-valued simple
sub-attributes (R2). Leave it off otherwise - stock `User` and `Group` schemas
declare no complex sub-attributes, so the flag is a no-op for them.

Applies to `POST`, `PUT` and `PATCH`, to `/Users`, `/Groups` and custom resource
types alike. Full design: [RFC_COMPLIANT_SUBATTRIBUTES.md](RFC_COMPLIANT_SUBATTRIBUTES.md).

---

## Preset Defaults

How each preset overrides the central defaults:

| Flag | Central Default | entra-id | entra-id-minimal | rfc-standard | minimal | user-only | user-only-with-custom-ext |
|------|----------------|----------|-----------------|-------------|---------|-----------|---------------------------|
| StrictSchemaValidation | true | true | true | true | true | true | true |
| AllowAndCoerceBooleanStrings | true | **true** | **true** | true | true | true | true |
| PrimaryEnforcement | passthrough | **normalize** | **normalize** | **reject** | passthrough | passthrough | passthrough |
| RequireIfMatch | false | false | false | false | false | false | false |
| MultiMemberPatchOpForGroupEnabled | true | **true** | true | true | true | true | true |
| PatchOpAllowRemoveAllMembers | false | **true** | false | false | false | false | false |
| VerbosePatchSupported | false | **true** | false | false | false | false | false |

All other flags use central defaults across all presets.

---

## Flag Details

### StrictSchemaValidation

**Type:** boolean | **Default:** `true` | **Category:** Validation

When enabled, validates that extension URNs present in the request body are also listed in the `schemas[]` array. This enforces RFC 7643 S3.1 which states that `schemas` MUST contain the URIs of all schema classes present.

```mermaid
flowchart TD
    A[Incoming POST/PUT] --> B{StrictSchemaValidation?}
    B -->|true| C{Extension data in body?}
    C -->|Yes| D{URN in schemas[] array?}
    D -->|Yes| E[Allow]
    D -->|No| F[400 invalidValue<br>Extension URN missing from schemas]
    C -->|No| E
    B -->|false| E
```

**Example error:**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "400",
  "scimType": "invalidValue",
  "detail": "Extension URN 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User' found in body but not in schemas[] array"
}
```

---

### AllowAndCoerceBooleanStrings

**Type:** boolean | **Default:** `true` | **Category:** Compatibility

Coerces string representations of booleans (`"True"`, `"False"`, `"true"`, `"false"`) to native boolean values. Required for Entra ID compatibility, which sends `"True"` instead of `true`.

**Before coercion:** `{ "active": "True" }`
**After coercion:** `{ "active": true }`

Applies to all boolean fields in POST, PUT, and PATCH request bodies, including nested extension attributes.

---

### PrimaryEnforcement

**Type:** string (tri-state) | **Default:** `passthrough` | **Category:** Validation

Controls how the `primary: true` sub-attribute is handled on multi-valued attributes (emails, phoneNumbers, etc.) per RFC 7643 S2.4.

| Value | Behavior |
|-------|----------|
| `passthrough` | No enforcement. Multiple `primary: true` values allowed |
| `normalize` | Auto-normalize: if multiple `primary: true`, keep only the last one. Applied on POST, PUT, and PATCH post-merge |
| `reject` | Strict: return 400 if request contains multiple `primary: true` values for the same multi-valued attribute |

**Preset defaults:** entra-id/entra-id-minimal = `normalize`, rfc-standard = `reject`

```json
{
  "emails": [
    { "value": "work@example.com", "type": "work", "primary": true },
    { "value": "home@example.com", "type": "home", "primary": true }
  ]
}
```

| Mode | Result |
|------|--------|
| `passthrough` | Both stored as-is |
| `normalize` | Only `home@example.com` keeps `primary: true` |
| `reject` | 400 error: "Multiple primary values" |

---

### RequireIfMatch

**Type:** boolean | **Default:** `false` | **Category:** Concurrency

When enabled, mandates the `If-Match` header on all PUT, PATCH, and DELETE operations. Prevents concurrent modification without optimistic locking.

**When enabled and If-Match missing:**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "412",
  "detail": "If-Match header is required for this endpoint"
}
```

**When If-Match doesn't match:**

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "412",
  "scimType": "versionMismatch",
  "detail": "ETag mismatch: expected W/\"2\", got W/\"1\""
}
```

---

### UserSoftDeleteEnabled

**Type:** boolean | **Default:** `true` | **Category:** Delete Behavior

When enabled, a PATCH operation that sets `active: false` will mark the user as soft-deleted (sets `deletedAt` timestamp) rather than permanently removing it. The user remains in the database but is treated as inactive.

Soft-deleted users can be re-activated via PATCH `active: true`.

---

### UserHardDeleteEnabled

**Type:** boolean | **Default:** `true` | **Category:** Delete Behavior

When enabled, DELETE requests permanently remove the user from the database. When disabled, DELETE returns 400.

---

### GroupHardDeleteEnabled

**Type:** boolean | **Default:** `true` | **Category:** Delete Behavior

When enabled, DELETE requests permanently remove the group and all membership records.

---

### MultiMemberPatchOpForGroupEnabled

**Type:** boolean | **Default:** `true` | **Category:** PATCH Behavior

When enabled, allows adding or removing multiple members in a single PATCH operation:

```json
{
  "op": "add",
  "path": "members",
  "value": [
    { "value": "user-id-1" },
    { "value": "user-id-2" },
    { "value": "user-id-3" }
  ]
}
```

When disabled, only single-member operations are allowed per PATCH op.

---

### PatchOpAllowRemoveAllMembers

**Type:** boolean | **Default:** `false` | **Category:** PATCH Behavior

When enabled, allows removing all members from a group via:

```json
{ "op": "remove", "path": "members" }
```

When disabled (default), this operation returns 400 to prevent accidental mass removal.

---

### VerbosePatchSupported

**Type:** boolean | **Default:** `false` | **Category:** PATCH Behavior

When enabled, supports dot-notation PATCH paths:

```json
{ "op": "replace", "path": "name.givenName", "value": "Jane" }
```

Without this flag, only standard paths are supported (`"name"` with complex value, or valuePath syntax `"name[formatted eq \"old\"]"`).

---

### IgnoreReadOnlyAttributesInPatch

**Type:** boolean | **Default:** `false` | **Category:** PATCH Behavior

When enabled, PATCH operations targeting readOnly attributes (`id`, `meta`, `groups`) are silently stripped instead of returning 400. Useful for clients that send full resource representations in PATCH.

---

### IncludeWarningAboutIgnoredReadOnlyAttribute

**Type:** boolean | **Default:** `false` | **Category:** PATCH Behavior

When enabled and readOnly attributes are stripped from requests, includes a warning in the response detailing which attributes were ignored.

---

### SchemaDiscoveryEnabled

**Type:** boolean | **Default:** `true` | **Category:** Discovery

When enabled, endpoint-scoped discovery endpoints respond with the endpoint's schema configuration:
- `GET /scim/endpoints/{id}/Schemas`
- `GET /scim/endpoints/{id}/ResourceTypes`
- `GET /scim/endpoints/{id}/ServiceProviderConfig`

When disabled, these endpoints return 404.

---

### PerEndpointCredentialsEnabled

**Type:** boolean | **Default:** `false` | **Category:** Authentication

When enabled, activates the per-endpoint credential tier in the authentication chain. SCIM operations on this endpoint can be authenticated using endpoint-scoped bearer tokens created via the Admin Credential API.

Requires credential creation via `POST /scim/admin/endpoints/{id}/credentials`.

---

### logLevel

**Type:** string | **Default:** (global level) | **Category:** Logging

Overrides the global log level for this specific endpoint. Valid values: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`.

Useful for debugging a specific tenant without increasing log verbosity for all traffic.

---

### logFileEnabled

**Type:** boolean | **Default:** `true` | **Category:** Logging

When enabled, creates a dedicated log file for this endpoint under `logs/endpoints/{endpointId}/`.

---

## Deprecated Flags

These flags are recognized for backward compatibility but should not be used in new configurations:

| Deprecated Flag | Replacement |
|----------------|-------------|
| `SoftDeleteEnabled` | `UserSoftDeleteEnabled` |
| `MultiOpPatchRequestGroupAddMembersEnabled` | `MultiMemberPatchOpForGroupEnabled` |
| `MultiOpPatchRequestGroupRemoveMembersEnabled` | `MultiMemberPatchOpForGroupEnabled` |
| `ReprovisionOnConflictForSoftDeletedResource` | Removed (always re-provisions) |
