# SCIM RFC Reference Documents

> **Purpose**: Authoritative RFC source texts for compliance audits  
> **Fetched**: 2026-04-16 from https://www.rfc-editor.org/rfc/  
> **Used by**: [P5_RFC_SCHEMA_PRESET_COMPLIANCE_AUDIT.md](../P5_RFC_SCHEMA_PRESET_COMPLIANCE_AUDIT.md)

## Files

| File | RFC | Title | Pages | Size |
|---|---|---|---|---|
| [rfc7642.txt](rfc7642.txt) | RFC 7642 | SCIM: Definitions, Overview, Concepts, and Requirements | ~20 | 38 KB |
| [rfc7643.txt](rfc7643.txt) | RFC 7643 | SCIM: Core Schema | 104 | 176 KB |
| [rfc7644.txt](rfc7644.txt) | RFC 7644 | SCIM: Protocol | ~100 | 167 KB |
| [RFC7643_SCHEMA_EXTRACT.md](RFC7643_SCHEMA_EXTRACT.md) | - | Extracted canonical JSON from RFC 7643 §8.7.1 + §3.1 + §2.2–§2.4 | - | 25 KB |

## OAuth / WIF assertion RFCs (added 2026-06-15)

These back the Workload Identity Federation design ([../WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md](../WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md)). Each load-bearing RFC has a plain-language explainer alongside the verbatim text.

| File | RFC | Title | Role in WIF | Explainer |
|---|---|---|---|---|
| [rfc7521.txt](rfc7521.txt) | RFC 7521 | Assertion Framework for OAuth 2.0 Client Authentication and Authorization Grants | The umbrella framework RFC 7523 profiles | - |
| [rfc7523.txt](rfc7523.txt) | RFC 7523 | JWT Profile for OAuth 2.0 Client Authentication and Authorization Grants | The `jwt-bearer` profile (today's WIF; SuccessFactors) | [../RFC_7523_EXPLAINED.md](../RFC_7523_EXPLAINED.md) |
| [rfc8693.txt](rfc8693.txt) | RFC 8693 | OAuth 2.0 Token Exchange | The `token-exchange` profile (upcoming WIF; Google) | [../RFC_8693_EXPLAINED.md](../RFC_8693_EXPLAINED.md) |

These are verbatim RFC text - do not edit. All commentary lives in the `*_EXPLAINED.md` docs. Referenced but not mirrored (stable + widely available): RFC 7519 (JWT), RFC 7517 (JWK), RFC 6749 (OAuth 2.0), RFC 7662 (Token Introspection - `act`/`may_act`).

## Key Sections for Schema Audits

### RFC 7643 (Core Schema)
- **§2.2** (p.8) - Attribute characteristic defaults
- **§2.3.2** (p.9) - Booleans: "no case sensitivity or uniqueness"
- **§2.4** (p.11) - Multi-valued attribute default sub-attributes (value, display, type, primary, $ref)
- **§3.1** (p.16) - Common attributes (id, externalId, meta) - NOT part of schema attrs
- **§4.1** (p.19) - User Resource Schema
- **§4.2** (p.25) - Group Resource Schema
- **§4.3** (p.26) - Enterprise User Schema Extension
- **§5** (p.27) - ServiceProviderConfig Schema
- **§6** (p.29) - ResourceType Schema
- **§7** (p.30) - Schema Definition (the 11 characteristics)
- **§8.7.1** (p.47–73) - **Normative** Resource Schema JSON Representations (User, Group, EnterpriseUser)

### RFC 7644 (Protocol)
- **§3.4.2.2** - Filtering
- **§3.5.2** - Modifying with PATCH
- **§3.7** - Bulk Operations
- **§3.9** - Attribute Projection (attributes / excludedAttributes params)
- **§4** - Service Provider Discovery (SHALL NOT require authentication)

### RFC 7642 (Overview)
- Background, use cases, and requirements for SCIM

## Source

All files downloaded from the official IETF RFC Editor:
- https://www.rfc-editor.org/rfc/rfc7642.txt
- https://www.rfc-editor.org/rfc/rfc7643.txt
- https://www.rfc-editor.org/rfc/rfc7644.txt

These are **Standards Track** RFCs published September 2015. RFC 7643 was updated by RFC 9865.
