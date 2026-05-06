# SCIM Profile Importer: Architecture, Modes, and Fidelity

**Status:** Proposed (2026-05-06)

---

## 1. Overview

The SCIM Profile Importer enables operators to create a new SCIMServer endpoint by ingesting the discovery surface and (optionally) behavioral characteristics of an external SCIM service, given only its base URL and credentials. This document details the architecture, supported modes, technical constraints, and fidelity guarantees of the importer.

---

## 2. Problem Statement

Operators frequently need to replicate the contract and behavior of an external SCIM endpoint for migration, testing, or integration. Manual profile authoring is error-prone and slow. The goal: automate endpoint creation by probing the remote service, while surfacing the limits of what can be discovered.

---

## 3. Modes of Operation

| Mode | Description | Fidelity | Risk | Consent Required |
|------|-------------|----------|------|-----------------|
| **A** | Discovery-only (SPC, Schemas, ResourceTypes) | ~30% | Low | No |
| **B** | + Passive probes (read-only requests, header sniffing) | ~50% | Low | No |
| **C** | + Active probes (sandboxed writes, destructive) | ~75% | High | Yes (sandbox/test only) |
| **D** | + Data import (Users/Groups, PII) | ~95% (data), ~75% (behavior) | Very High | Yes (explicit PII ack) |

---

## 4. Architecture

```mermaid
flowchart TB
    subgraph Operator
        OP[Admin POST /admin/endpoints/import-from-url]
    end
    subgraph SCIMServer[SCIMServer (clone target)]
        IMP[ScimImportController]
        REM[RemoteScimClient]
        DISCO[DiscoveryFetcher]
        PASS[PassiveProbe]
        ACT[ActiveProbe]
        TRANS[ProfileTranslator]
        ES[(EndpointService)]
        DATA[DataImporter]
    end
    subgraph SourceSCIM[Source SCIM service (remote)]
        SRC[(/scim/v2)]
    end
    OP --> IMP
    IMP --> REM
    REM <-->|auth| SRC
    REM --> DISCO
    REM --> PASS
    REM --> ACT
    DISCO --> TRANS
    PASS --> TRANS
    ACT --> TRANS
    TRANS -->|ShorthandProfileInput| ES
    ES --> DATA
    DATA <-->|paginated GET| REM
    style ACT fill:#fdd,stroke:#c00
    style DATA fill:#fdd,stroke:#c00
```

---

## 5. What Can and Cannot Be Discovered

| Setting/Behavior | Discovery | Passive Probe | Active Probe | Notes |
|------------------|:---------:|:------------:|:-----------:|-------|
| Schemas, ResourceTypes, SPC | ✔ | n/a | n/a | RFC 7643/7644 |
| StrictSchemaValidation | ✗ | Partial | ✔ | Needs write test |
| AllowAndCoerceBooleanStrings | ✗ | ✗ | ✔ | POST with string boolean |
| PrimaryEnforcement | ✗ | Partial | ✔ | Needs write test |
| RequireIfMatch | ✗ | Partial | ✔ | PUT w/o If-Match |
| Soft/Hard Delete | ✗ | ✗ | ✔ | PATCH/DELETE test |
| MultiMemberPatchOp | ✗ | ✗ | ✔ | PATCH test |
| PatchOpAllowRemoveAllMembers | ✗ | ✗ | ✔ | PATCH test |
| VerbosePatchSupported | ✗ | ✗ | ✔ | PATCH path test |
| IgnoreReadOnlyAttributesInPatch | ✗ | ✗ | ✔ | PATCH test |
| IncludeWarningAboutIgnoredReadOnlyAttribute | ✗ | Partial | ✔ | Response extension |
| SchemaDiscoveryEnabled | ✔ | n/a | n/a | 404 on /Schemas |
| PerEndpointCredentialsEnabled | ✗ | ✗ | ✗ | Internal only |
| logLevel, logFileEnabled | ✗ | ✗ | ✗ | Internal only |
| ETag scheme | Partial | ✔ | n/a | Header sniff |
| Filter operator support | ✗ | ✔ | n/a | Try each operator |
| Pagination contract | Partial | ✔ | n/a | Header sniff |
| Sort attribute support | Partial | ✔ | n/a | Header sniff |
| Returned characteristics on writes | ✗ | ✗ | ✔ | Needs write test |
| Immutable enforcement | Partial | ✗ | ✔ | Needs write test |
| Auth scheme | ✔ | n/a | n/a | SPC.authenticationSchemes |

---

## 6. API Contract

```typescript
// POST /scim/admin/endpoints/import-from-url
interface ImportFromUrlRequest {
  name: string;
  sourceUrl: string;
  credentials?: { type: 'bearer' | 'basic' | 'oauth2-client-credentials'; bearer?: string; basic?: { username: string; password: string }; oauth2?: { tokenUrl: string; clientId: string; clientSecret: string; scope?: string }; };
  mode: 'discovery-only' | 'discovery+passive' | 'discovery+active' | 'discovery+active+data';
  activeProbe?: { sandboxResourceType: string; cleanupOnExit: boolean; maxProbeOps: number; consent: 'I_AUTHORIZE_WRITES_ON_SOURCE'; };
  dataImport?: { resourceTypes: string[]; pageSize: number; maxResources?: number; piiAcknowledged: 'I_ACKNOWLEDGE_PII_REPLICATION'; };
}
interface ImportFromUrlResponse {
  endpointId: string;
  profile: EndpointProfile;
  fidelityReport: {
    discoveredCapabilities: string[];
    inferredSettings: Record<string, { value: unknown; confidence: 'observed' | 'inferred' | 'default'; evidence: string; }>;
    unverifiedSettings: string[];
    schemaCoverage: { source: number; cloned: number; missing: string[] };
    knownDeviations: string[];
  };
}
```

---

## 7. Risks and Mitigations

- **SSRF / Outbound call risk:** Only allow public URLs by default; block RFC1918/loopback unless explicitly enabled. Redact credentials from logs. Never persist secrets.
- **Destructive probe risk:** Modes C/D require explicit consent strings and are off by default. All probe artifacts are cleaned up.
- **PII/data residency:** Data import (Mode D) is off by default and requires explicit operator acknowledgment.
- **Partial fidelity:** Always emit a `fidelityReport` listing observed/inferred/defaulted/unverified settings. Never claim "replica" status.
- **Credential leakage:** All credentials are handled in-memory only and redacted from logs and error messages.

---

## 8. Worked Example

**Scenario:** Operator wants to clone a remote Entra ID SCIM endpoint for test migration.

1. Operator POSTs to `/admin/endpoints/import-from-url` with `sourceUrl`, `bearer` token, `mode: 'discovery+passive'`, `name: 'entra-test-clone'`.
2. Importer fetches `/ServiceProviderConfig`, `/Schemas`, `/ResourceTypes`, and samples `/Users` for ETag/filter support.
3. Translator builds a `ShorthandProfileInput` and inferred settings with confidence levels.
4. Endpoint is created; `fidelityReport` is attached.
5. Operator reviews `fidelityReport` for unverified settings and tunes as needed.

---

## 9. Changelog

- 2026-05-06: Initial version. Covers architecture, mode matrix, probe limits, API contract, risks, and worked example.
