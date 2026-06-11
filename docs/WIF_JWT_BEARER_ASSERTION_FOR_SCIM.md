# Workload Identity Federation (WIF) for SCIM - JWT Bearer Assertion Token Exchange

> **Premise:** Microsoft Entra is rolling out **Workload Identity Federation (WIF)** as the credential-free way for its Provisioning Service to authenticate to ISV SCIM endpoints. Instead of the admin copying a long-lived secret from the ISV into Entra, Entra presents a **signed JWT assertion** at the ISV's token endpoint; the ISV validates that assertion against Microsoft's public JWKS plus claims plus app-roles, and then issues its **own** short-lived access token, which Entra uses as a `Bearer` token on the SCIM calls. This document is the deep analysis of that flow and the design for adding it to SCIMServer as **Phase Q6**. It is analysis plus design only - no code has been implemented.

> **Status:** Analysis + design. Dated 2026-06-03. Closes the Pattern 8 gap tracked in [ISV_AUTH_PATTERNS_AND_SCIMSERVER_GAP_PLAN.md](ISV_AUTH_PATTERNS_AND_SCIMSERVER_GAP_PLAN.md).

## Source documents

| Source | Type | Status |
|---|---|---|
| Internal Entra design doc - "Workload Identity Federation between Entra Provisioning (SyncFabric) and SaaS ISVs" | Microsoft-internal (OneDrive) | ACCESSED (content provided directly; the sign-in wall blocked tool-fetch) |
| [AzureAD/SCIMReferenceCode](https://github.com/AzureAD/SCIMReferenceCode) | Public Microsoft reference | Public mirror of the same trust model |
| [Microsoft Learn - SCIM provisioning tutorial](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups) | Public | Authentication section |

> **Reconciliation note.** Where the internal doc and the public reference differ, the internal doc is treated as authoritative for **Entra's** behavior (issuer, audience format, role enforcement, deprecation timeline) and the public reference is treated as authoritative for the **wire format** an ISV must implement. They agree on the core: this is RFC 7523 client authentication, not RFC 7523 grant-type usage.

## Table of contents

- [0. TL;DR](#0-tldr)
- [1. What WIF is](#1-what-wif-is)
- [2. The wire format](#2-the-wire-format)
- [3. The three-step admin setup](#3-the-three-step-admin-setup)
- [4. The assertion: claims, validation, JWKS](#4-the-assertion-claims-validation-jwks)
- [5. Current SCIMServer state](#5-current-scimserver-state)
- [6. Gap analysis](#6-gap-analysis)
- [7. Phase Q6 recommendation](#7-phase-q6-recommendation)
- [8. Backend design](#8-backend-design)
- [9. UI design](#9-ui-design)
- [10. Security analysis](#10-security-analysis)
- [11. Quality gates and test matrix](#11-quality-gates-and-test-matrix)
- [12. Error responses and RFC 6749 conformance](#12-error-responses-and-rfc-6749-conformance)
- [13. Step-by-step implementation plan](#13-step-by-step-implementation-plan)
- [14. Effort estimates](#14-effort-estimates)
- [15. FAQ](#15-faq)
- [16. References](#16-references)

---

## 0. TL;DR

WIF lets Entra authenticate to an ISV SCIM endpoint **without any shared secret**. Entra signs a JWT with its own key; the ISV trusts Microsoft's published JWKS; the ISV swaps that assertion for its own short-lived token at the token endpoint.

**One-sentence gap:** SCIMServer's token endpoint only accepts a plain `client_credentials` grant with a JSON body and one global symmetric secret - it has no `client_assertion` path, no external-JWKS validation, and no per-endpoint federated-trust config, so it cannot be a WIF relying party today.

```mermaid
flowchart LR
    subgraph Today["SCIMServer today"]
        A1[Admin stores a secret] --> A2[Entra sends secret] --> A3[SCIMServer compares secret]
    end
    subgraph WIF["With WIF / Q6"]
        B1[Admin stores only PUBLIC trust values] --> B2[Entra signs + sends a JWT assertion] --> B3[SCIMServer validates via Microsoft JWKS + roles] --> B4[SCIMServer issues its OWN short-lived token]
    end
```

---

## 1. What WIF is

### 1.0 What is new from the internal doc

| Aspect | Public reference says | Internal doc adds |
|---|---|---|
| Codename | (n/a) | The Entra Provisioning Service is "SyncFabric" internally |
| Deprecation context | (n/a) | Username-password, long-lived bearer, and OAuth Auth Code Grant are being **deprecated**; Client Credentials is currently the **only** method offered to new ISVs; WIF is its credential-free replacement |
| ISV demand | (n/a) | Google, Zoom, and SAP have asked for credential-free onboarding |
| Audience format | `api://<appid>` | `api://{WorkloadIdentity_appid}/.default` |
| Authorization | "validate the token" | The ISV **must** enforce **app roles / permissions** carried in the assertion, not just signature |
| Scope | (optional) | The ISV **defines** the scope string it expects (e.g. `zoom-scim-access`) and returns a token scoped to it |

### 1.1 The problem WIF solves

Secret-based auth (Pattern 5 in the gap plan) means a long-lived `client_secret` lives in two places (Entra and the ISV), must be rotated on a schedule, and is a breach target. WIF removes the secret entirely: trust is established once by exchanging only **public** values, and the cryptographic proof on every token request is a freshly-signed, short-lived JWT.

### 1.2 The federated-trust model

```mermaid
flowchart TD
    subgraph MS["Microsoft / Entra"]
        K[Entra signing key] --> J[Published JWKS at login.microsoftonline.com]
    end
    subgraph ISV["ISV (SCIMServer in Q6)"]
        T[Per-endpoint WIF trust config:<br/>issuer, subject, audience, jwksUri, tenantId, requiredRoles, scope]
    end
    J -. trust anchor .-> T
    E[Entra Provisioning] -- signed assertion --> ISV
    ISV -- own short-lived token --> E
```

### 1.3 Token exchange vs direct JWT (the key distinction)

WIF is a **token exchange**, not direct JWT bearer usage on the resource.

```mermaid
flowchart TD
    subgraph Direct["Pattern 4 - direct external JWT"]
        D1[Entra puts its JWT on the SCIM call] --> D2[ISV verifies per request] --> D3[ISV issues nothing]
    end
    subgraph Exchange["Pattern 8 / WIF - token exchange"]
        X1[Entra presents JWT as client_assertion at TOKEN endpoint] --> X2[ISV validates assertion] --> X3[ISV mints its OWN scoped short-lived token] --> X4[Entra uses ISV token as Bearer on SCIM calls]
    end
```

The Microsoft-signed JWT is a **client-authentication assertion** (RFC 7523 section 2.2). It never rides the SCIM calls. The token that rides the SCIM calls is the ISV's own.

---

## 2. The wire format

```mermaid
sequenceDiagram
    participant E as Entra Provisioning (SyncFabric)
    participant T as ISV Token Endpoint
    participant J as Microsoft JWKS
    participant S as ISV SCIM Endpoint
    E->>E: Sign client_assertion JWT with Entra key
    E->>T: POST /oauth/token form-urlencoded<br/>grant_type=client_credentials<br/>client_id<br/>client_assertion=JWT<br/>client_assertion_type=jwt-bearer<br/>scope=zoom-scim-access
    T->>J: Fetch signing keys by kid, cached
    J-->>T: JWKS
    T->>T: Validate sig + iss/aud/sub/exp/nbf/tid + roles
    T-->>E: 200 access_token, token_type Bearer, expires_in 3600
    E->>S: GET/POST /scim/v2 Authorization Bearer ISV-token
    S-->>E: 200 SCIM payload
```

**Token request (note `application/x-www-form-urlencoded`, not JSON):**

```http
POST /endpoints/{id}/oauth/token HTTP/1.1
Host: isv.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=00000000-0000-0000-0000-000000000000
&client_assertion=eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9.eyJhdWQiOiJhcGk6...
&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer
&scope=scimserver-scim-access
```

**Token response:**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ "access_token": "<ISV-issued JWT>", "token_type": "Bearer", "expires_in": 3600 }
```

**Subsequent SCIM call:**

```http
GET /endpoints/{id}/scim/v2/Users HTTP/1.1
Authorization: Bearer <ISV-issued JWT>
```

> **Precision note.** Entra sends the assertion as form fields, URL-encoded. The `client_assertion_type` value is the literal `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`. An endpoint that reads only JSON bodies (SCIMServer today) will silently see empty fields.

---

## 3. The three-step admin setup

```mermaid
flowchart TD
    S1[Step 1: Admin reads PUBLIC values from Entra] --> S2[Step 2: Admin enters them in the ISV portal]
    S2 --> S3[Step 3: ISV returns Client ID, Token URL, SCIM URL]
    S3 --> Done[Entra provisioning job configured - no secret exchanged]
```

**Step 1 - values copied OUT of Entra (all public):**

| Value | Example |
|---|---|
| Issuer | `https://sts.windows.net/<TenantID>/` |
| Subject | `{WorkloadIdentity_object_id}` |
| Audience | `api://{WorkloadIdentity_appid}/.default` |
| JWKS URL | `https://login.microsoftonline.com/<TenantID>/discovery/v2.0/keys` |

**Step 2 - the ISV stores those four values as a per-endpoint trust record. No secret is created.**

**Step 3 - values returned BY the ISV:**

| Value | Example |
|---|---|
| Client ID | `00000000-0000-0000-0000-000000000000` |
| Token URL | `https://isv.example.com/endpoints/{id}/oauth/token` |
| SCIM URL | `https://isv.example.com/endpoints/{id}/scim/v2` |

---

## 4. The assertion: claims, validation, JWKS

| Claim | Meaning | ISV check |
|---|---|---|
| `aud` | `api://{appid}/.default` | Must equal the configured audience |
| `iss` | `https://sts.windows.net/<TenantID>/` | Must equal the configured issuer |
| `sub` | Workload identity object id | Must equal the configured subject |
| `tid` | Tenant id | Must equal the allowed tenant (isolation) |
| `oid` | Object id of the calling principal | Logged; used for audit |
| `appid` | App id of the caller | Cross-checked against `client_id` |
| `roles` | App roles granted to the workload identity | Must contain every required role |
| `iat` / `nbf` / `exp` | Validity window | Reject outside window (with small clock skew) |

**Example assertion payload (verbatim shape):**

```json
{
  "aud": "api://1f2e3d4c-5b6a-7980-1234-567890abcdef/.default",
  "iss": "https://sts.windows.net/9a8b7c6d-5e4f-3021-abcd-ef1234567890/",
  "sub": "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0",
  "tid": "9a8b7c6d-5e4f-3021-abcd-ef1234567890",
  "oid": "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0",
  "appid": "1f2e3d4c-5b6a-7980-1234-567890abcdef",
  "roles": ["Scim.Provision"],
  "iat": 1717372800,
  "nbf": 1717372800,
  "exp": 1717376400
}
```

**Five things the ISV must do:**

1. Resolve the signing key by `kid` from the configured JWKS URL (cache by `kid`).
2. Verify the RS256/ES256 signature - **never** accept `alg: none` or an HMAC alg.
3. Validate `iss`, `aud`, `sub`, `tid`, and the time window.
4. Enforce that `roles` contains every required role.
5. Issue its own short-lived token (1-6 h) scoped to the configured `scope`.

**JWKS rotation and outage rules:**

- Cache keys by `kid` with a bounded max-age; refetch on an unknown `kid`.
- On a JWKS fetch failure with no cached key, **fail closed** (reject the assertion). Never fall back to "no signature check".
- Use the tenant-scoped OIDC discovery (`/.well-known/openid-configuration` -> `jwks_uri`) rather than hard-coding the keys URL when possible.

**Validation lifecycle (every branch except the final issuance ends at `invalid_client`):**

```mermaid
stateDiagram-v2
    [*] --> Received: token request arrives
    Received --> ClassicPath: no client_assertion
    Received --> TrustLookup: client_assertion present
    TrustLookup --> Rejected: no wif trust for endpoint
    TrustLookup --> KeyResolve: trust found
    KeyResolve --> Rejected: kid unknown and JWKS unreachable
    KeyResolve --> SignatureCheck: key resolved
    SignatureCheck --> Rejected: bad signature or disallowed alg
    SignatureCheck --> ClaimCheck: signature valid
    ClaimCheck --> Rejected: iss aud sub tid or time invalid
    ClaimCheck --> RoleCheck: claims valid
    RoleCheck --> Rejected: required role missing
    RoleCheck --> Issued: all checks pass
    Issued --> [*]: return own short-lived token
    Rejected --> [*]: 401 invalid_client
```

---

## 5. Current SCIMServer state

| Layer | Today | WIF needs |
|---|---|---|
| Auth fallback | [shared-secret.guard.ts](../api/src/modules/auth/shared-secret.guard.ts): per-endpoint bcrypt bearer -> OAuth JWT -> legacy `SCIM_SHARED_SECRET` | A new branch that accepts an ISV-issued token minted by the WIF flow |
| OAuth issuer | [oauth.service.ts](../api/src/oauth/oauth.service.ts): HS256, one global client, process-lifetime random key, 1 h TTL | Per-endpoint issuance after assertion validation; configurable 1-6 h TTL |
| Token endpoint | [oauth.controller.ts](../api/src/oauth/oauth.controller.ts): rejects non-`client_credentials`; reads JSON body via `@Body()` | Accept `client_assertion` + `client_assertion_type`; parse `application/x-www-form-urlencoded` |
| Per-endpoint credential model | [schema.prisma](../api/prisma/schema.prisma) `EndpointCredential` has `credentialType` + `metadata` JSON | A new `wif` `credentialType` storing trust config; **no secret column populated** |
| Config flags | [endpoint-config.interface.ts](../api/src/modules/endpoint/endpoint-config.interface.ts): `boolean | string` only | A `'structured'` flag-type (Pre-Q.A) for the WIF trust object |

> **Verified greenfield note (2026-06-11 source check).** Every prerequisite below the WIF layer is genuinely unbuilt - none is partially present:
> - **No JWKS / `jose`.** [api/package.json](../api/package.json) declares no `jose`, `jwks-rsa`, or equivalent; there is no `createRemoteJWKSet` or JWKS code anywhere in `api/src`. Q2 starts from zero.
> - **No form-urlencoded parsing.** The [api/src/main.ts](../api/src/main.ts) bootstrap registers no `urlencoded`/`useBodyParser`, so the token endpoint cannot read the WIF form body today (Q6.1).
> - **No `client_assertion` path.** Zero matches for `client_assertion` in `api/src`.
> - **Issuer is HS256-only.** No RS256/ES256 anywhere, so Pre-Q.B is a from-scratch asymmetric-key change.
> - **`oauth_client` is reserved, not implemented.** [admin-credential.controller.ts](../api/src/modules/scim/controllers/admin-credential.controller.ts) accepts `oauth_client` in its allowlist, but the create path always mints a bcrypt **bearer** token and the DTO carries only `label`/`credentialType`/`expiresAt` (no trust/client config). Q1 is therefore real new work, not a flag flip.

---

## 6. Gap analysis

| # | Capability | Status | Closes in |
|---|---|---|---|
| 1 | Accept `client_assertion` at the token endpoint | MISSING | Q6 |
| 2 | Parse `application/x-www-form-urlencoded` token requests | MISSING | Q6 |
| 3 | Validate an external JWT against a remote JWKS | MISSING (Q2 builds the validator) | Q2 -> Q6 |
| 4 | Per-endpoint federated-trust config (no secret) | MISSING | Q6 (needs Pre-Q.A structured flag) |
| 5 | Enforce app `roles` from the assertion | MISSING | Q6 |
| 6 | Issue a per-endpoint short-lived token | PARTIAL (global issuer exists) | Q1 -> Q6 |
| 7 | Tenant isolation via `tid` | MISSING | Q6 |
| 8 | Reciprocal ISV-portal UI (enter 4 values, return 3) | MISSING | Q6 |

---

## 7. Phase Q6 recommendation

```mermaid
flowchart TD
    PreA[Pre-Q.A: structured config flag type] --> Q6
    PreB[Pre-Q.B: asymmetric, externalized signing key] --> Q6
    Q1[Q1: per-endpoint OAuth client/secret + per-endpoint issuer] --> Q6
    Q2[Q2: external JWKS validator -jose-] --> Q6
    Q6[Q6: WIF assertion acceptance + roles + reciprocal UI]
```

| Sub-step | Deliverable |
|---|---|
| Q6.1 | Token endpoint accepts `client_assertion` (form-urlencoded) and routes to the WIF validator |
| Q6.2 | `wif` `credentialType` + structured trust config persisted (no secret) |
| Q6.3 | `WifAssertionValidatorService` (reuses Q2 `jose` JWKS client): signature + claims + roles + tenant isolation |
| Q6.4 | Per-endpoint issuance of a 1-6 h token scoped to the configured `scope` |
| Q6.5 | Reciprocal CredentialsTab UI: "Federated Identity (WIF)" section + Test Connection |

---

## 8. Backend design

```mermaid
erDiagram
    EndpointCredential {
        string id
        string endpointId
        string credentialType "wif"
        json metadata "expectedIssuer, expectedSubject, expectedAudience, jwksUri, allowedTenantId, requiredRoles, scope, issuedTokenTtlSec"
    }
```

**Admin API - register WIF trust (no secret):**

```http
POST /api/endpoints/{id}/credentials
Content-Type: application/json

{
  "credentialType": "wif",
  "wif": {
    "expectedIssuer": "https://sts.windows.net/<TenantID>/",
    "expectedSubject": "{WorkloadIdentity_object_id}",
    "expectedAudience": "api://{WorkloadIdentity_appid}/.default",
    "jwksUri": "https://login.microsoftonline.com/<TenantID>/discovery/v2.0/keys",
    "allowedTenantId": "<TenantID>",
    "requiredRoles": ["Scim.Provision"],
    "scope": "scimserver-scim-access",
    "issuedTokenTtlSec": 3600
  }
}
```

**Token endpoint pseudocode:**

```text
if grant_type == "client_credentials" and client_assertion present:
    trust = loadWifTrust(endpointId)
    if not trust: 401 invalid_client
    assertion = verifyJwt(client_assertion, jwks(trust.jwksUri))   # fail closed on JWKS failure
    require assertion.iss == trust.expectedIssuer
    require assertion.aud == trust.expectedAudience
    require assertion.sub == trust.expectedSubject
    require assertion.tid == trust.allowedTenantId
    require trust.requiredRoles subset of assertion.roles
    return issueOwnToken(endpointId, ttl=trust.issuedTokenTtlSec, scope=trust.scope)
```

**Validation flow:**

```mermaid
flowchart TD
    A[Receive token request] --> B{client_assertion present?}
    B -- no --> C[Existing client_credentials path]
    B -- yes --> D[Load WIF trust for endpoint]
    D --> E{trust exists?}
    E -- no --> F[401 invalid_client]
    E -- yes --> G[Fetch JWKS by kid -cached-]
    G --> H{signature valid + alg allowed?}
    H -- no --> F
    H -- yes --> I{iss/aud/sub/tid/time ok?}
    I -- no --> F
    I -- yes --> J{required roles present?}
    J -- no --> F
    J -- yes --> K[Issue own 1-6h token scoped to scope]
```

> **Guard fall-through note.** The token issued here is the ISV's own JWT, so the existing OAuth-JWT branch in [shared-secret.guard.ts](../api/src/modules/auth/shared-secret.guard.ts) validates it on SCIM calls with no new code, provided the issuer/audience match what the guard expects per endpoint.

---

## 9. UI design

The CredentialsTab gains a "Federated Identity (WIF)" section, gated behind a config flag, that mirrors the three-step setup:

```mermaid
flowchart TD
    P1[Panel: enter the 4 Entra values] --> P2[Save -> creates wif credential]
    P2 --> P3[Display the 3 ISV return values: Client ID, Token URL, SCIM URL]
    P3 --> P4[Test Connection: dry-run the assertion path]
```

**R9 primitive mapping:**

| Field | Primitive |
|---|---|
| Issuer / Subject / Audience / JWKS URL (editable) | `EditableField` |
| Required roles / scope (editable) | `EditableField` |
| Client ID / Token URL / SCIM URL (read-only, copyable) | `CopyableField` |
| Full trust record (copy as JSON) | `CopyJsonButton` |

- **Gating flag:** a `WifCredentialsEnabled` boolean in the config registry (10-cell completeness per `endpointConfigFlagAudit`).
- **Test Connection UX:** posts a synthetic assertion (or asks the operator to trigger one) and reports each validation step's pass/fail with the specific failing claim.
- **Coverage:** Playwright spec under `web/e2e/` exercising the WIF panel end-to-end; vitest for the panel's rendered structure and primitive presence by `data-testid`.

---

## 10. Security analysis

| Threat | Mitigation |
|---|---|
| Algorithm confusion (`alg: none` / HMAC with public key) | Pin allowed algs to RS256/ES256; reject everything else |
| JWKS SSRF (attacker-controlled `jwksUri`) | Allowlist hosts (Microsoft login domains); validate URL scheme/host before fetch |
| JWKS cache poisoning | Cache by `kid` from a verified response only; bounded max-age; refetch on unknown `kid` |
| Replay of an assertion | Short `exp`; optional `jti` single-use cache; assertions are client-auth only, not resource tokens |
| Token leakage | Issued token is short-lived (1-6 h); never log the assertion or the issued token |
| Cross-tenant access | Enforce `tid` equals the configured `allowedTenantId` |
| Privilege escalation | Enforce `requiredRoles` subset of `roles`; missing role -> 401 |
| Secret leak via response | `wif` credential has no secret; contract test asserts no secret/hash key appears on the response |
| JWKS outage | Fail closed - never skip signature verification |

---

## 11. Quality gates and test matrix

| Layer | WIF additions |
|---|---|
| Pre-Q.A | Structured config flag-type tests (10-cell matrix) |
| Pre-Q.B | Asymmetric, externalized signing key tests |
| Unit (`.service.spec.ts` + `.controller.spec.ts`) | Validator: good assertion, bad sig, wrong iss/aud/sub/tid, expired, missing role, `alg:none` rejected, unknown `kid` refetch, JWKS-down fail-closed |
| E2E (`test/e2e/*.e2e-spec.ts`) | Register `wif` credential -> POST assertion -> receive own token -> use token on SCIM call |
| Live (`scripts/live-test.ps1`) | New section: form-urlencoded assertion exchange across local/Docker/Azure |
| Contract | `expect(ALLOWED_KEYS).toContain(key)` asserts no secret/hash key on the `wif` response |
| OAuth error conformance | RFC 6749 section 5.2: `invalid_client` on bad assertion; `invalid_request` on malformed form body |
| RFC audit | RFC 7521 + RFC 7523 section 2.2 + RFC 7519 + RFC 7517 + RFC 6749 section 5.2 |

---

## 12. Error responses and RFC 6749 conformance

Every WIF rejection maps to an RFC 6749 section 5.2 error object so Entra (SyncFabric) receives a standards-compliant `{ "error": ..., "error_description": ... }`. The validator MUST stay tight-lipped: the same generic `invalid_client` is returned for a bad signature, a wrong `iss`, or a missing role, while the specific failing claim is logged server-side only. This denies an attacker a claim-by-claim oracle.

| Condition | HTTP | `error` (RFC 6749 5.2) | `error_description` (client-facing, generic) | Server-side log (detailed) |
|---|---|---|---|---|
| Wrong `Content-Type`, missing or empty form fields | 400 | `invalid_request` | "Malformed token request" | which field was absent |
| `client_assertion_type` not the `jwt-bearer` URN | 400 | `invalid_request` | "Unsupported client_assertion_type" | the value received |
| `grant_type` not `client_credentials` | 400 | `unsupported_grant_type` | "Only client_credentials is supported" | the grant received |
| Requested `scope` not the configured WIF scope | 400 | `invalid_scope` | "Requested scope is not permitted" | requested vs configured |
| No `wif` trust configured for the endpoint | 401 | `invalid_client` | "Client authentication failed" | endpoint id, no wif trust |
| Signature invalid, disallowed alg, or `alg: none` | 401 | `invalid_client` | "Client authentication failed" | alg seen, kid, reason |
| `iss` / `aud` / `sub` / `tid` mismatch | 401 | `invalid_client` | "Client authentication failed" | which claim, expected vs got |
| Outside `iat` / `nbf` / `exp` window | 401 | `invalid_client` | "Client authentication failed" | now, nbf, exp, skew applied |
| Required role missing from `roles` | 401 | `invalid_client` | "Client authentication failed" | required set, granted set |
| JWKS fetch failed and no cached key (fail closed) | 401 | `invalid_client` | "Client authentication failed" | jwksUri, fetch error |

> **Why `invalid_client` for authorization failures too.** At the token endpoint the only principal is the client itself, so an unmet role is a client-authorization failure, not a resource-scope failure. RFC 6749 section 5.2 has no `forbidden` code for this hop, so `invalid_client` (401) is the conformant choice and the missing role is logged for the operator. The resource-level role checks (on the SCIM calls) are a separate concern handled by the guard.

---

## 13. Step-by-step implementation plan

> This plan is **TDD-first** (Stage 0 of the standing quality gates): write the failing test, make it green with the smallest change, refactor green. Each step names the files it touches, the **RED test** to write first, and the **gate** that must pass before the step is done. Nothing here is implemented yet; this is the ordered recipe.

### 13.1 Build order at a glance

```mermaid
gantt
    title Phase Q6 WIF build order (relative units, not calendar dates)
    dateFormat X
    axisFormat %s
    section Prerequisites
    Pre-Q.A structured flag type         :prea, 0, 2
    Pre-Q.B asymmetric externalized key  :preb, 0, 3
    section Q1 Q2 primitives
    Q1 per-endpoint OAuth client          :q1, after preb, 3
    Q2 external JWKS validator            :q2, after preb, 3
    section Q6 WIF
    Q6.1 form-urlencoded assertion intake :q61, after q1, 2
    Q6.2 wif credentialType persistence   :q62, after prea, 2
    Q6.3 WifAssertionValidatorService     :q63, after q2, 3
    Q6.4 own-token issuance scoped        :q64, after q63, 1
    Q6.5 reciprocal CredentialsTab UI     :q65, after q64, 3
```

### 13.2 Pre-Q.A - structured config flag type

The flag registry today is `boolean | string` only. WIF needs a flag whose value is a structured object (the trust record), so the registry must learn a `structured` flag-type with its own validator. Honor the 10-cell completeness matrix (`endpointConfigFlagAudit`): registry + default + validator + enforcement + unit test + E2E test + live test + doc + UI Switch + UI test.

| Step | Action | Files | RED test first | Gate |
|---|---|---|---|---|
| A1 | Add a `structured` value-kind to the flag-type union and metadata | [endpoint-config.interface.ts](../api/src/modules/endpoint/endpoint-config.interface.ts) | unit: a structured flag round-trips through `validateEndpointConfig` | 1.2 build, 2.1 unit |
| A2 | Add `validateStructuredFlag()` (shape check + reject unknown keys) | [endpoint-config.interface.ts](../api/src/modules/endpoint/endpoint-config.interface.ts) | unit: malformed structured value -> validation error | 2.1 unit |
| A3 | Document the new flag-type | [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) | n/a (doc) | 3c.2 docs audit |

### 13.3 Pre-Q.B - asymmetric, externalized signing key

Today [oauth.service.ts](../api/src/oauth/oauth.service.ts) signs with HS256 using a process-lifetime random secret. For the ISV to publish a JWKS that any client can verify, issuance must move to an **asymmetric** key (RS256/ES256) loaded from configuration, and the public half must be published.

| Step | Action | Files | RED test first | Gate |
|---|---|---|---|---|
| B1 | Load an RS256/ES256 private key + `kid` from config; fall back to a generated dev key | [oauth.service.ts](../api/src/oauth/oauth.service.ts) | unit: signed token header carries `alg: RS256` and a `kid` | 2.1 unit |
| B2 | Publish the public JWKS at a stable path | new `api/src/oauth/jwks.controller.ts` | E2E: fetching the JWKS returns the active `kid` | 2.2 E2E |
| B3 | Verify issued tokens with the public key in the guard's OAuth branch | [shared-secret.guard.ts](../api/src/modules/auth/shared-secret.guard.ts) | unit: a token signed by B1 validates; an HS256 token does not | 2.1 unit, 2.5 parity |

### 13.4 Q6.1 - form-urlencoded assertion intake

The token endpoint must parse `application/x-www-form-urlencoded` and accept the `client_assertion` + `client_assertion_type` fields. Today it reads JSON via `@Body()` and requires `client_secret`.

| Step | Action | Files | RED test first | Gate |
|---|---|---|---|---|
| C1 | Enable the urlencoded body parser | [api/src/main.ts](../api/src/main.ts) | E2E: a form-urlencoded POST reaches the controller with populated fields | 2.2 E2E |
| C2 | Extend `TokenRequest` with `client_assertion` + `client_assertion_type`; route assertion requests to the WIF path | [oauth.controller.ts](../api/src/oauth/oauth.controller.ts) | unit: a request with `client_assertion` is dispatched to the validator, not the secret path | 2.1 unit |
| C3 | Emit RFC 6749 5.2 errors per the section 12 catalog | [oauth.controller.ts](../api/src/oauth/oauth.controller.ts) | unit: malformed body -> `invalid_request`; unknown assertion type -> `invalid_request` | 2.1 unit, 3a.3 error-handling |

### 13.5 Q6.2 - `wif` credentialType persistence (no secret)

Reuse the existing `EndpointCredential.credentialType` + `metadata` JSON columns - no new column, no secret stored. Both the Prisma and InMemory backends must behave identically (`crossBackendParityAudit`).

| Step | Action | Files | RED test first | Gate |
|---|---|---|---|---|
| D1 | Accept `credentialType: 'wif'` with a validated trust `metadata` shape | endpoint-credential service + DTO | unit: a `wif` credential persists trust values, no secret/hash field | 2.1 unit |
| D2 | Mirror behavior in the InMemory repository | [api/src/infrastructure/repositories/inmemory](../api/src/infrastructure/repositories/inmemory) | unit: InMemory create matches Prisma create | 2.5 + 2.6 parity |
| D3 | Add the Prisma migration if any enum/constraint changes | [api/prisma](../api/prisma) | n/a | 1.9 prismaMigrationAudit |
| D4 | Contract test: the `wif` response carries no secret/hash key | E2E + live | E2E: `expect(ALLOWED_KEYS).toContain(key)` over the response | 3a.2 apiContractVerification |

### 13.6 Q6.3 - `WifAssertionValidatorService`

A new service that reuses the Q2 `jose` JWKS client to run the full validation lifecycle (the section 4 state diagram): signature + alg-pinning + `iss`/`aud`/`sub`/`tid` + time window + required roles, failing closed on JWKS outage.

| Step | Action | Files | RED test first | Gate |
|---|---|---|---|---|
| E1 | Validate signature against the configured JWKS; pin RS256/ES256 | new `api/src/oauth/wif-assertion-validator.service.ts` | unit: good sig passes; `alg: none` + HMAC rejected | 2.1 unit, 3b.4 security |
| E2 | Validate `iss`/`aud`/`sub`/`tid` + time window | same | unit: each wrong claim -> rejection | 2.1 unit |
| E3 | Enforce `requiredRoles` subset of `roles` | same | unit: missing role -> rejection | 2.1 unit |
| E4 | Cache JWKS by `kid`; refetch on unknown `kid`; fail closed on outage | same | unit: unknown `kid` triggers refetch; outage with no cache -> reject | 2.1 unit, 3b.4 security |

### 13.7 Q6.4 - own-token issuance scoped to the configured scope

On a valid assertion, mint the ISV's own short-lived (1-6 h) token scoped to the configured `scope`, using the Pre-Q.B asymmetric key.

| Step | Action | Files | RED test first | Gate |
|---|---|---|---|---|
| F1 | Issue a per-endpoint token with `issuedTokenTtlSec` + `scope` | [oauth.service.ts](../api/src/oauth/oauth.service.ts) | unit: issued token carries the configured scope + ttl | 2.1 unit |
| F2 | Wire validator -> issuer in the controller | [oauth.controller.ts](../api/src/oauth/oauth.controller.ts) | E2E: assertion in -> own token out -> token authorizes a SCIM call | 2.2 E2E, 4.x live |

### 13.8 Q6.5 - reciprocal CredentialsTab UI

A "Federated Identity (WIF)" section in the CredentialsTab, gated by a `WifCredentialsEnabled` flag, mirroring the three-step setup: enter the 4 Entra values, display the 3 ISV return values, run a Test Connection dry-run. All fields go through R9 primitives.

```mermaid
sequenceDiagram
    participant A as Admin (browser)
    participant U as CredentialsTab UI
    participant API as SCIMServer admin API
    A->>U: Enter issuer, subject, audience, jwksUri, roles, scope
    U->>API: POST credentials credentialType wif
    API-->>U: 201 with Client ID, Token URL, SCIM URL
    U-->>A: Show the 3 return values, copyable
    A->>U: Click Test Connection
    U->>API: Dry-run the assertion validation path
    API-->>U: Per-step pass or fail with the specific failing claim
    U-->>A: Render the step-by-step result
```

| Step | Action | Files | RED test first | Gate |
|---|---|---|---|---|
| G1 | Add the gated "Federated Identity (WIF)" section | [CredentialsTab.tsx](../web/src/pages/CredentialsTab.tsx) | vitest: section renders the 4 `EditableField`s + 3 `CopyableField`s by `data-testid` | 2.3 vitest |
| G2 | Wire Save -> `wif` credential create; show the 3 return values | [CredentialsTab.tsx](../web/src/pages/CredentialsTab.tsx) | vitest: save calls the API; return values render | 2.3 vitest |
| G3 | Test Connection dry-run with per-step result | [CredentialsTab.tsx](../web/src/pages/CredentialsTab.tsx) | Playwright: full panel flow end-to-end | 5.3 Playwright |
| G4 | Add the `WifCredentialsEnabled` flag (10-cell matrix) | flag registry + UI Switch | unit + vitest per the matrix | 3b.3 endpointConfigFlagAudit |

### 13.9 Migration and rollout (secret-based endpoint to WIF)

WIF can be adopted without downtime by running both auth modes during a cutover window, then removing the legacy secret.

```mermaid
flowchart TD
    M1[Endpoint runs on secret-based auth today] --> M2[Admin adds a wif credential alongside the existing secret]
    M2 --> M3[Both modes accepted during the cutover window]
    M3 --> M4[Entra reconfigured to WIF, proven by Test Connection]
    M4 --> M5[Admin removes the legacy secret credential]
    M5 --> M6[Endpoint is credential-free]
```

### 13.10 Definition of done

A WIF commit is complete only when the standing **Feature / Bug-Fix Commit Checklist** is satisfied for the steps it lands: unit + E2E + live tests, a Playwright spec for any `web/` change, the feature doc updated, [INDEX.md](INDEX.md) + [CHANGELOG.md](../CHANGELOG.md) + Session and context files updated, the version bumped, and the response-contract test proving no secret leaks on the `wif` credential.

---

## 14. Effort estimates

> **What this is.** A bottom-up effort estimate in **ideal engineering-days for one developer already fluent in this codebase**, working TDD-first and reusing the existing G11 / OAuth / dual-backend patterns. "Ideal day" = focused build + test time, excluding meetings, context-switching, and review latency. These are effort sizes, not calendar dates; see the calendar note below.

> **Basis (2026-06-11 source check).** The §5 verified-greenfield note governs this estimate: `jose`/JWKS, form-urlencoded parsing, `client_assertion`, asymmetric issuance, and a real per-endpoint OAuth client are all absent today, so Q6 must build its full prerequisite stack. Nothing below is discounted as "already done."

| Phase | Low (days) | High (days) | Primary effort driver |
|---|---|---|---|
| Pre-Q.A structured flag type | 1 | 2 | registry + validator + 10-cell flag matrix |
| Pre-Q.B asymmetric key + JWKS publish | 2 | 3 | key load, `kid`, new JWKS controller, guard verify |
| Q1 per-endpoint OAuth client | 3 | 4 | model + issuance + dual-backend parity |
| Q2 external JWKS validator (`jose`) | 3 | 4 | new dep, alg-pinning, cache, fail-closed, SSRF allowlist |
| Q6.1 form-urlencoded intake | 1 | 2 | body parser + routing + error catalog (section 12) |
| Q6.2 `wif` persistence (no secret) | 2 | 2 | DTO + parity + no-secret contract test |
| Q6.3 `WifAssertionValidatorService` | 3 | 4 | security core; heaviest test surface |
| Q6.4 own-token issuance | 1 | 1 | wiring validator -> issuer |
| Q6.5 reciprocal CredentialsTab UI | 3 | 4 | UI + vitest + Playwright + flag matrix |
| **Subtotal (build + unit/E2E)** | **19** | **29** | |
| Quality-gate overhead (~25%) | 5 | 9 | live-test.ps1 (local/Docker/Azure), Playwright-vs-dev, full pipeline, CHANGELOG/Session/docs, Stage X audits |
| **Total ideal dev-days** | **~24** | **~38** | roughly 5 to 8 ideal engineering-weeks |

**Critical path and parallelism:**

```mermaid
flowchart LR
    PreA[Pre-Q.A 1-2d] --> Q62[Q6.2 2d]
    PreB[Pre-Q.B 2-3d] --> Q1[Q1 3-4d]
    PreB --> Q2[Q2 3-4d]
    Q1 --> Q61[Q6.1 1-2d]
    Q2 --> Q63[Q6.3 3-4d]
    Q61 --> Q63
    Q62 --> Q63
    Q63 --> Q64[Q6.4 1d]
    Q64 --> Q65[Q6.5 3-4d]
```

- Pre-Q.A and Pre-Q.B have no dependency on each other; Q1 and Q2 can run in parallel once Pre-Q.B lands. With two developers the calendar compresses toward roughly 3 to 4 weeks while total effort is unchanged.
- **Q6.3 is the long pole by risk, not size.** Its code is modest, but the security tests (algorithm confusion, fail-closed on JWKS outage, tenant isolation, JWKS rotation by `kid`) are where estimates slip.

**Confidence and what moves the number:**

| Factor | Effect |
|---|---|
| Developer new to the repo | roughly doubles the total |
| Q4 (Auth-Code) or Q5 (mTLS/DPoP) pulled in | out of scope here; each is its own multi-day effort |
| Review cycles + CI queue + serialized shared `scimserver-dev` Azure target | extends **calendar** time beyond ideal-days; not sizable from the repo alone |
| Reusing `jose` defaults rather than hand-rolling JWKS caching | trims Q2 toward the low end |

> **Calendar caveat.** Ideal dev-days are not wall-clock days. The standing multi-stage gate suite (Stages 0-6 plus Stage X audits), the single shared dev Azure environment that must be serialized across concurrent work, and human review latency all stretch calendar delivery. Treat ~24-38 ideal dev-days as the **effort floor**, then apply your team's historical ideal-to-calendar ratio.

---

## 15. FAQ

**Is this RFC 7523 grant-type usage?** No. It is RFC 7523 **section 2.2** (JWT used for **client authentication**), with `grant_type=client_credentials`. The assertion authenticates the client; it is not the grant.

**Does Entra's JWT ride the SCIM calls?** No. It is presented once at the token endpoint. The ISV's own issued token rides the SCIM calls.

**Do we store any secret?** No. WIF stores only public trust values. The contract tests assert no secret leaks on the response.

**How is this different from Pattern 4 (direct external JWT)?** Pattern 4 verifies Entra's JWT on every SCIM request and issues nothing. WIF adds a token-exchange hop and mints the ISV's own token.

**What is the issued token's lifetime?** 1-6 hours per the Entra spec; configurable per endpoint via `issuedTokenTtlSec`.

---

## 16. References

### Primary (internal + reconciled)

- Internal Entra design doc - "Workload Identity Federation between Entra Provisioning (SyncFabric) and SaaS ISVs"

### Microsoft Learn

- [Tutorial: Develop and plan provisioning for a SCIM endpoint](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)
- [Tutorial: Develop a sample SCIM endpoint](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-build-users-and-groups-endpoints)
- [AzureAD/SCIMReferenceCode](https://github.com/AzureAD/SCIMReferenceCode)

### IETF

- **RFC 7521** - Assertion Framework for OAuth 2.0
- **RFC 7523** - JWT Profile for OAuth 2.0 Client Authentication and Authorization Grants (section 2.2 client authentication)
- **RFC 7519** - JSON Web Token (JWT)
- **RFC 7517** - JSON Web Key (JWK)
- **RFC 6749** - The OAuth 2.0 Authorization Framework (section 5.2 error responses)
- **RFC 7644** - SCIM Protocol (section 2 Authentication and Authorization)

### In-repo

- [ISV_AUTH_PATTERNS_AND_SCIMSERVER_GAP_PLAN.md](ISV_AUTH_PATTERNS_AND_SCIMSERVER_GAP_PLAN.md) - the Phase Q plan that schedules Q6
- [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md) - the per-endpoint-bearer architecture WIF extends
- [api/src/oauth/oauth.controller.ts](../api/src/oauth/oauth.controller.ts) - the token endpoint to extend
- [api/src/oauth/oauth.service.ts](../api/src/oauth/oauth.service.ts) - the issuer to make per-endpoint
- [api/src/modules/auth/shared-secret.guard.ts](../api/src/modules/auth/shared-secret.guard.ts) - the auth fallback chain
- [api/src/modules/endpoint/endpoint-config.interface.ts](../api/src/modules/endpoint/endpoint-config.interface.ts) - the flag registry (needs `structured` type)
- [web/src/pages/CredentialsTab.tsx](../web/src/pages/CredentialsTab.tsx) - the UI surface for the reciprocal portal

---

This document is analysis + design only; no code has been implemented.
