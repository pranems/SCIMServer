# Connection info and Entra provisioning setup - design + examples

> **What this is.** A design proposal plus an exhaustive reference for surfacing the **connection properties** an identity provider (primarily Microsoft Entra ID) needs to connect its provisioning job to a specific SCIMServer endpoint. It covers every authentication combination SCIMServer supports today (shared-secret bearer, per-endpoint bearer, per-endpoint OAuth client-credentials, and Workload Identity Federation), with the literal URLs, JSON, HTTP headers, requests, responses, error shapes, UI mockups, and a proposed `connection-info` API that assembles all of it once, server-side.
>
> **Why it exists.** Today the properties are scattered: the SCIM base path is relative, the per-endpoint token URL is only assembled inside the WIF UI, the OAuth client secret is shown once as a bare token with no surrounding context, and the same SCIM URL is spelled three different ways across the codebase. This doc is the blueprint for collapsing that into one copy-ready "here is exactly what to paste into Entra, for your auth method" experience.
>
> **Status.** Analysis + design. The `connection-info` API and `ConnectionPanel` UI described in [Part 6](#6-proposed-connection-info-api-single-source-of-truth) and [Part 8](#8-ui-mockups) are PROPOSED, not yet implemented. The auth flows, routes, models, and URL behavior in [Part 2](#2-scimservers-actual-url-shapes-authoritative) through [Part 5](#5-the-authentication-combination-matrix) are CURRENT and verified against the sources cited inline.
>
> **Provenance.** RFC and industry-norm facts in [Part 1](#1-how-auth-token-endpoint-urls-work-in-rfcs--industry) are cited to [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749), and the [Microsoft Entra SCIM tutorial](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups). SCIMServer behavior is cited to the actual sources ([api/src/main.ts](../../api/src/main.ts), [endpoint-oauth.controller.ts](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts), [admin-credential.controller.ts](../../api/src/modules/scim/controllers/admin-credential.controller.ts), [authentication-schemes.ts](../../api/src/modules/scim/discovery/authentication-schemes.ts), [wif-assertion-validator.service.ts](../../api/src/oauth/wif-assertion-validator.service.ts)).

---

## Table of contents

1. [How auth token-endpoint URLs work in RFCs + industry](#1-how-auth-token-endpoint-urls-work-in-rfcs--industry)
2. [SCIMServer's actual URL shapes (authoritative)](#2-scimservers-actual-url-shapes-authoritative)
3. [The four authentication combinations at a glance](#3-the-four-authentication-combinations-at-a-glance)
3A. [Auth-method enablement flags (proposed flag-split family)](#3a-auth-method-enablement-flags-proposed-flag-split-family)
4. [The Entra provisioning fields (what we are filling)](#4-the-entra-provisioning-fields-what-we-are-filling)
5. [The authentication combination matrix](#5-the-authentication-combination-matrix)
5A. [WIF end-to-end wire contract (trust / mint / SCIM call)](#5a-wif-end-to-end-wire-contract-trust--mint--scim-call)
5B. [WIF trust field reference (examples, provenance, usage, validation)](#5b-wif-trust-field-reference-examples-provenance-usage-validation)
5C. [Simplifying WIF trust setup (discovery resolver + smart defaults)](#5c-simplifying-wif-trust-setup-discovery-resolver--smart-defaults)
5D. [JWKS host allowlist (prepopulated, persisted, hot-editable)](#5d-jwks-host-allowlist-prepopulated-persisted-hot-editable)
5E. [Multiple credentials and configurations per auth type](#5e-multiple-credentials-and-configurations-per-auth-type)
5F. [Multiple IdPs / WIF sources writing into one endpoint](#5f-multiple-idps--wif-sources-writing-into-one-endpoint)
6. [Proposed connection-info API (single source of truth)](#6-proposed-connection-info-api-single-source-of-truth)
6A. [Secret visibility (`CredentialSecretVisibility`) + envelope encryption (KEK)](#6a-secret-visibility-credentialsecretvisibility--envelope-encryption-kek)
7. [Where + when to surface the connection info](#7-where--when-to-surface-the-connection-info)
8. [UI mockups](#8-ui-mockups)
9. [Copy / export formats](#9-copy--export-formats)
10. [Flow diagrams](#10-flow-diagrams)
11. [Implementation + test plan](#11-implementation--test-plan)
11A. [Work items (delivery backlog)](#11a-work-items-delivery-backlog)
12. [References](#12-references)

---

## 1. How auth token-endpoint URLs work in RFCs + industry

This part answers the direct question: how are token-endpoint URLs shaped in the RFCs and across the industry, and where does SCIMServer's per-endpoint token URL sit relative to those norms.

### 1.1 The RFCs do not mandate a path - they mandate discovery

- **RFC 6749 (OAuth 2.0)** defines the *token endpoint* as a concept but deliberately does **not** prescribe a URL path. The authorization server picks its own location and the client is configured with, or discovers, it. There is no canonical `/token` path in the spec.
- **RFC 8414 (OAuth 2.0 Authorization Server Metadata)** is the discovery mechanism. The server publishes a JSON document at a well-known location and advertises the absolute token endpoint in the `token_endpoint` member:
  > `token_endpoint` - URL of the authorization server's token endpoint [RFC6749]. This is REQUIRED unless only the implicit grant type is supported. (RFC 8414 section 2)
- The metadata document itself lives at `/.well-known/oauth-authorization-server` (or the OIDC-flavored `/.well-known/openid-configuration`), formed by inserting the well-known suffix between the host and any path component of the issuer identifier (RFC 8414 section 3).
- **Multi-tenant is explicitly anticipated.** RFC 8414 section 3.1 states that using a **path component** in the issuer identifier "enables supporting multiple issuers per host ... required in some multi-tenant hosting configurations." That is precisely SCIMServer's per-endpoint model.

A non-normative RFC 8414 metadata response (from the spec) shows the token endpoint as an absolute URL, separate from any resource API:

```json
{
  "issuer": "https://server.example.com",
  "authorization_endpoint": "https://server.example.com/authorize",
  "token_endpoint": "https://server.example.com/token",
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "private_key_jwt"],
  "jwks_uri": "https://server.example.com/jwks.json"
}
```

**Takeaway:** the norm is "do not make the client guess the token URL - publish it, and let the resource (SCIM) base and the token endpoint be different URLs." SCIMServer already serves an RFC 8414 metadata document via [oauth-metadata.controller.ts](../../api/src/oauth/oauth-metadata.controller.ts); the connection-info work in [Part 6](#6-proposed-connection-info-api-single-source-of-truth) should align with it rather than invent a parallel truth.

### 1.2 Industry token-endpoint URLs - the tenant/realm-in-path pattern

Across major providers, two patterns dominate: a **versioned path segment** (`/v2.0/`, `/v1/`) and a **tenant or realm identifier in the path**. The resource API and the token endpoint are almost always different hosts or different path roots.

| Provider | Token endpoint URL shape | Tenant in path? | Versioned? |
|---|---|---|---|
| Microsoft Entra (v2) | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` | Yes (`{tenant}`) | Yes (`/v2.0/`) |
| Microsoft Entra (v1) | `https://login.microsoftonline.com/{tenant}/oauth2/token` | Yes | implicit |
| Okta (org server) | `https://{domain}/oauth2/v1/token` | host is the tenant | Yes (`/v1/`) |
| Okta (custom AS) | `https://{domain}/oauth2/{authServerId}/v1/token` | Yes (`{authServerId}`) | Yes |
| Auth0 | `https://{domain}/oauth/token` | host is the tenant | No |
| Google | `https://oauth2.googleapis.com/token` | No (dedicated host) | No |
| GitHub | `https://github.com/login/oauth/access_token` | No | No |
| Ping (PingFederate) | `https://{host}/as/token.oauth2` | No | No |
| ForgeRock AM | `https://{host}/openam/oauth2/realms/{realm}/access_token` | Yes (`{realm}`) | No |
| Keycloak | `https://{host}/realms/{realm}/protocol/openid-connect/token` | Yes (`{realm}`) | implicit |

**Observation:** putting the tenant identifier in the path (Entra `{tenant}`, Okta `{authServerId}`, ForgeRock/Keycloak `{realm}`) is mainstream. SCIMServer's `/scim/endpoints/{endpointId}/oauth/token` is the **same idea** - the endpoint id is the tenant discriminator, and the `oauth/token` suffix mirrors the `/oauth2/.../token` and `/access_token` conventions. SCIMServer is well-aligned with the dominant norm.

### 1.3 SCIM-specific: the protocol has no token endpoint of its own

- **RFC 7644 (SCIM Protocol)** does not define a token endpoint. SCIM defers authentication to existing standards and only *advertises* the supported schemes in `ServiceProviderConfig.authenticationSchemes` (RFC 7643 section 5). SCIMServer computes that list per endpoint in [authentication-schemes.ts](../../api/src/modules/scim/discovery/authentication-schemes.ts).
- **Microsoft Entra** is the practical authority for what an admin types. Its provisioning UI exposes two authentication methods relevant here:
  - **Long-lived bearer token** - the admin pastes a token into the **Secret Token** field; the **Tenant URL** is the SCIM base (the tutorial's example is `https://api.contoso.com/scim/`).
  - **OAuth2 client-credentials grant** - the admin fills **Tenant URL, Token Endpoint, Client Identifier, Client Secret** (this is exactly the four-field example in the user request).
- Two Entra requirements that directly validate SCIMServer's design:
  > Each customer must provide their own Client ID and Client Secret ... A single app wide client ID/Client Secret pair is not supported. ([Entra SCIM tutorial](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups))

  SCIMServer's per-endpoint `oauth_client` credential ([Q1](PER_ENDPOINT_OAUTH_CLIENT.md)) is precisely a per-customer client id/secret pair, so it satisfies the gallery mandate.
  > Test Connection queries the SCIM endpoint for a user that doesn't exist, using a random GUID ... The expected correct response is HTTP 200 OK with an empty SCIM ListResponse.

  This is why the connection panel should make the SCIM base URL copyable and correct - Entra's first action is a filtered GET against it.

**Net:** SCIMServer's token-endpoint URL design is idiomatic. The gap is not the URL shape - it is that the absolute URLs and the per-method property set are not assembled and presented in one place at the right moments. The rest of this doc fixes that.

---

## 2. SCIMServer's actual URL shapes (authoritative)

### 2.1 The `/scim/v2` rewrite (prefix only)

[api/src/main.ts](../../api/src/main.ts) rewrites the **prefix** `/scim/v2` to `/scim` so both spec-aligned (`/scim/v2/...`) and bare (`/scim/...`) forms work:

```ts
if (req.url.startsWith('/scim/v2')) {
  // Remove the /v2 segment
  req.url = req.url.replace('/scim/v2', '/scim');
}
```

This is a **leading-prefix** rewrite. Consequences:

- `https://host/scim/v2/endpoints/{id}/Users` is valid and resolves to `/scim/endpoints/{id}/Users`.
- `https://host/scim/endpoints/{id}/Users` is valid (bare form).
- `https://host/scim/endpoints/{id}/v2` is **NOT** the version form - here `v2` lands where a resource-type would be, so it does not mean "version 2 of the SCIM base." This is the bug referenced below.

### 2.2 Canonical absolute URLs for an endpoint

Using example host `https://scim.example.com` and endpoint id `7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34`:

| Property | Absolute URL | Source |
|---|---|---|
| SCIM base (Entra Tenant URL, spec form) | `https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34` | rewrite + [endpoint.service.ts](../../api/src/modules/endpoint/services/endpoint.service.ts) `scimBasePath` |
| SCIM base (bare form) | `https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34` | same |
| Per-endpoint token endpoint | `https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token` | [endpoint-oauth.controller.ts](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts) `@Controller('endpoints/:endpointId/oauth')` + `@Post('token')` |
| Global token endpoint (legacy) | `https://scim.example.com/scim/oauth/token` | [oauth-metadata.controller.ts](../../api/src/oauth/oauth-metadata.controller.ts) |
| ServiceProviderConfig | `https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/ServiceProviderConfig` | SCIM discovery |
| OAuth AS metadata | `https://scim.example.com/.well-known/oauth-authorization-server` | RFC 8414 |

The host is derived from the request at runtime (`X-Forwarded-Proto` / `X-Forwarded-Host`, falling back to the request host) in [oauth-metadata.controller.ts](../../api/src/oauth/oauth-metadata.controller.ts). The connection-info assembler in [Part 6](#6-proposed-connection-info-api-single-source-of-truth) reuses that exact host logic so every surface agrees.

### 2.3 The three-way URL inconsistency (a bug this design fixes)

The same SCIM base is currently spelled three different ways:

| Where | Spelling | Correct? |
|---|---|---|
| Admin API `scimBasePath` | `/scim/endpoints/{id}` | Yes (bare, relative) |
| WIF UI ([CredentialsTab.tsx](../../web/src/pages/CredentialsTab.tsx)) | `${origin}/scim/v2/endpoints/${id}` | Yes - **fixed in WI-1** (was `.../endpoints/{id}/v2`, where `/v2` after the id is a resource-type slot, not the version prefix) |
| Spec-aligned Entra form | `/scim/v2/endpoints/{id}` | Yes (version is a leading prefix) |

The fix is to assemble the URL **once** server-side (Part 6) and have every UI consume that, instead of hand-building it. The WIF return-values box should show `https://host/scim/v2/endpoints/{id}` (or the bare form), never `.../endpoints/{id}/v2`.

### 2.4 Per-endpoint OAuth AS metadata URL (options, norm, decision)

> **Status.** DESIGN. Today only the GLOBAL RFC 8414 metadata exists (at the deployment root, [oauth-metadata.controller.ts](../../api/src/oauth/oauth-metadata.controller.ts)), and it advertises only the global `/scim/oauth/token`. A **per-endpoint** metadata document is missing - this is [WI-12](#11a-work-items-delivery-backlog).

RFC 8414 gives two ways to place a metadata document when the issuer identifier has a path component (`https://host/scim/endpoints/{id}`):

| Option | URL | Basis |
|---|---|---|
| A - RFC 8414 section 3 strict (insert the well-known between host and path) | `https://host/.well-known/oauth-authorization-server/scim/endpoints/{id}` | RFC 8414 section 3 canonical; the multi-issuer-per-host form |
| **B - OIDC-style append (DECIDED)** | `https://host/scim/endpoints/{id}/.well-known/oauth-authorization-server` | RFC 8414 section 5 (OIDC Discovery transform); what [AUTHENTICATION_ARCHITECTURE.md section 7.4](AUTHENTICATION_ARCHITECTURE.md#74-d-discovery--key-publication) already proposed |
| C - query param `?endpoint={id}` | (non-conformant) | reject |

**Industry norm is overwhelmingly the append form (Option B):** Entra `login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration`, Okta `/oauth2/{authServerId}/.well-known/oauth-authorization-server`, Keycloak `/realms/{realm}/.well-known/openid-configuration`, AWS Cognito `/{poolId}/.well-known/openid-configuration`. **Decision: Option B**, because it matches those providers, co-locates discovery with the endpoint's other routes, and is already what the architecture doc specced. RFC 8414 section 5 blesses serving Option A **as well** during a transition, so a maximally-compatible server MAY publish both.

The per-endpoint metadata body (note: `jwks_uri` points at the SHARED global key set - there is one signing key today, so every endpoint's tokens are verified against the same JWKS):

```json
{
  "issuer": "https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "token_endpoint": "https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token",
  "jwks_uri": "https://scim.example.com/scim/oauth/jwks",
  "grant_types_supported": ["client_credentials", "urn:ietf:params:oauth:grant-type:token-exchange"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "private_key_jwt"]
}
```

**Two hard RFC 8414 rules the implementation must honor:** the returned `issuer` MUST exactly equal the identifier used to build the URL (mix-up-attack defense, RFC 8414 section 3.3), and the advertised `token_endpoint` must be the per-endpoint one. Entra's own provisioning client does **not** consume this document (the admin types the values by hand), so per-endpoint metadata is for standards-based OAuth clients and self-consistency, not for the Entra workflow itself.

---

## 3. The four authentication combinations at a glance

| # | Combination | SCIMServer feature | Secret lives where | Entra auth method |
|---|---|---|---|---|
| 1 | Global shared-secret bearer | `SCIM_SHARED_SECRET` env | server env (one global value) | Secret Token |
| 2 | Per-endpoint bearer | `bearer` credential ([G11](G11_PER_ENDPOINT_CREDENTIALS.md)) gated by `PerEndpointCredentialsEnabled` | bcrypt hash; plaintext shown once | Secret Token |
| 3 | Per-endpoint OAuth client-credentials | `oauth_client` credential ([Q1](PER_ENDPOINT_OAUTH_CLIENT.md)) gated by `PerEndpointCredentialsEnabled` | bcrypt hash of secret; `clientId` public | OAuth2 client-credentials |
| 4 | Workload Identity Federation (WIF) | `wif` trust ([Q6](WIF_Q6_VALIDATE_ISSUE_UI.md)) gated by `WifCredentialsEnabled` | no secret stored (public trust only) | OAuth2 client-credentials (assertion) |

Combinations 1 and 2 use Entra's Secret Token field. Combinations 3 and 4 use Entra's OAuth2 client-credentials flow (Tenant URL + Token Endpoint + Client Id + Client Secret), but combination 4 replaces the static client secret with a freshly-signed JWT assertion that SCIMServer validates and exchanges for its own token.

> **Flag note.** Today a single `PerEndpointCredentialsEnabled` flag gates BOTH combination 2 (bearer) and combination 3 (oauth_client), for creation AND the resource-plane validation path. A proposed split into clearer per-method flags is [3A](#3a-auth-method-enablement-flags-proposed-flag-split-family) ([WI-11](#11a-work-items-delivery-backlog)). The flag names in the combination tables below reflect the CURRENT shipped gate.

---

## 3A. Auth-method enablement flags (proposed flag-split family)

> **Status.** DESIGN, operator-confirmed 2026-07-06 (naming Option B). Not yet implemented - [WI-11](#11a-work-items-delivery-backlog).

### 3A.1 The problem with today's single flag

Verified against the shipped code: `PerEndpointCredentialsEnabled` is doing double duty and there is a gap.

- It gates **both** the `bearer` and the `oauth_client` credential type - at **creation** ([admin-credential.controller.ts](../../api/src/modules/scim/controllers/admin-credential.controller.ts)) AND on the **resource-plane validation path** ([shared-secret.guard.ts](../../api/src/modules/auth/shared-secret.guard.ts) `tryEndpointCredential`: if the flag is off, existing per-endpoint credentials are skipped entirely and go inert).
- There is **no per-endpoint way to refuse the global `SCIM_SHARED_SECRET`** - every endpoint always accepts it via the guard's Tier-3 legacy branch. That is a real gap for an operator who wants an endpoint to accept ONLY its own credentials.

### 3A.2 The proposed four-flag family

One flag per auth method, so each can be toggled independently (create + validate). All are per-endpoint `profile.settings` booleans, same mechanism as `WifCredentialsEnabled`.

| Flag | Gates (create + validate) | Entra method | Default (migration) |
|---|---|---|---|
| `SecretTokenBearerAuthEnabled` | per-endpoint `bearer` | Secret Token | = old `PerEndpointCredentialsEnabled` |
| `OAuthClientCredentialsAuthEnabled` | per-endpoint `oauth_client` | OAuth2 client-credentials | = old `PerEndpointCredentialsEnabled` |
| `WifCredentialsEnabled` (unchanged) | `wif` trust | OAuth2 client-credentials (assertion) | unchanged |
| `SharedSecretBearerAuthEnabled` (new) | whether this endpoint accepts the global `SCIM_SHARED_SECRET` | Secret Token (global) | `true` (back-compat) |

> **Naming note (operator decision).** The operator chose **Option B** - keep `Auth` in the name (`SecretTokenBearerAuthEnabled`). This is slightly inconsistent with the existing `WifCredentialsEnabled` / `PerEndpointCredentialsEnabled` (which have no `Auth`), and that mild inconsistency was accepted deliberately for the explicitness of `...BearerAuthEnabled`. `SecretTokenBearer` bridges both vocabularies: `Secret Token` is Entra's exact UI field label, `Bearer` is the RFC 6750 type, and pairing them disambiguates from the OAuth *client* secret (which is not a bearer - it is exchanged at the token endpoint).

### 3A.3 Value-preserving migration

For every existing endpoint: set `SecretTokenBearerAuthEnabled` = `OAuthClientCredentialsAuthEnabled` = the old `PerEndpointCredentialsEnabled` value, and `SharedSecretBearerAuthEnabled` = `true`. The guard reads the OLD flag as a fallback for ONE release, then it is retired. This keeps every current endpoint's behavior byte-for-byte identical. Each new flag lands with the full 10-cell config-flag matrix (`endpointConfigFlagAudit`): registry + default + validator + enforcement + unit/E2E/live tests + doc + UI Switch + UI test.

---

## 4. The Entra provisioning fields (what we are filling)

Two Entra "Admin Credentials" shapes, taken from the [Entra SCIM tutorial](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups):

**A. Secret Token (long-lived bearer):**

| Entra field | Value |
|---|---|
| Tenant URL | the SCIM base URL |
| Secret Token | the bearer token |

**B. OAuth2 Client Credentials Grant:**

| Entra field | Value |
|---|---|
| Tenant URL | the SCIM base URL |
| Token Endpoint | the OAuth token URL |
| Client Identifier | the client id |
| Client Secret | the client secret |

The connection panel's job is to render the right one of these two tables for the selected method, with each value pre-filled and copyable. That removes the user's mental translation between "what SCIMServer calls it" and "what the Entra field is called."

---

## 5. The authentication combination matrix

Each combination below gives: what it is, the endpoint config it requires, the admin API call to create the credential (request + response), the Entra field mapping, the on-the-wire token exchange (where applicable), and a sample authenticated SCIM call.

Canonical values used throughout:

- Host: `https://scim.example.com`
- Endpoint id: `7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34`
- Admin auth: `Authorization: Bearer <admin-scim-token>` (the `SCIM_SHARED_SECRET`, Entra's "E2E_TOKEN")

### 5.1 Combination 1 - global shared-secret bearer

The simplest. Every endpoint accepts the one global `SCIM_SHARED_SECRET`. No per-endpoint setup. Best for a single-tenant deployment or quick testing.

**Entra mapping (Secret Token):**

| Entra field | Value |
|---|---|
| Tenant URL | `https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34` |
| Secret Token | the value of `SCIM_SHARED_SECRET` (never echoed by the UI; shown as configured) |

**Authenticated SCIM call (Entra's Test Connection - a filtered GET that expects an empty list):**

```http
GET /scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/Users?filter=userName%20eq%20%22nonexistent-3f9a%22&startIndex=1&count=1 HTTP/1.1
Host: scim.example.com
Authorization: Bearer <SCIM_SHARED_SECRET>
Accept: application/scim+json
```

```http
HTTP/1.1 200 OK
Content-Type: application/scim+json
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 0,
  "startIndex": 1,
  "itemsPerPage": 0,
  "Resources": []
}
```

**Security note:** the UI must NEVER display the global secret value. The connection panel shows the field as present/configured with a "managed at the server level" hint, not the literal value.

### 5.2 Combination 2 - per-endpoint bearer

A per-endpoint bcrypt-hashed bearer token. Each endpoint gets its own token without sharing the global secret. Requires `PerEndpointCredentialsEnabled=True`.

**Endpoint config (in `endpoint.profile.settings`):**

```json
{
  "PerEndpointCredentialsEnabled": "True"
}
```

**Create the credential:**

```http
POST /scim/admin/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/credentials HTTP/1.1
Host: scim.example.com
Authorization: Bearer <admin-scim-token>
Content-Type: application/json
```

```json
{
  "credentialType": "bearer",
  "label": "Entra production"
}
```

**Response (the plaintext `token` is returned ONCE):**

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "endpointId": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "credentialType": "bearer",
  "label": "Entra production",
  "active": true,
  "createdAt": "2026-06-29T17:04:55.000Z",
  "expiresAt": null,
  "token": "k7Qm2P9xR4tV8wZ1aB3cD5eF7gH0jK2lM4nO6pQ8rS"
}
```

**Entra mapping (Secret Token):**

| Entra field | Value |
|---|---|
| Tenant URL | `https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34` |
| Secret Token | `k7Qm2P9xR4tV8wZ1aB3cD5eF7gH0jK2lM4nO6pQ8rS` (the one-time `token`) |

**Authenticated SCIM call:**

```http
GET /scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/Users?startIndex=1&count=10 HTTP/1.1
Host: scim.example.com
Authorization: Bearer k7Qm2P9xR4tV8wZ1aB3cD5eF7gH0jK2lM4nO6pQ8rS
Accept: application/scim+json
```

### 5.3 Combination 3 - per-endpoint OAuth client-credentials

A per-endpoint `client_id` + `client_secret` pair. Entra exchanges them at the per-endpoint token endpoint for a short-lived, endpoint-scoped access token, then uses that token as a bearer on SCIM calls. This is the Entra-gallery-required model and the exact four-field example from the request. Requires `PerEndpointCredentialsEnabled=True`.

> **Smart defaults ([WI-14](#11a-work-items-delivery-backlog)).** The create body below may OMIT the id/secret: the default `client_id` is the **endpointId** (public, predictable, no lookup needed) and the default `client_secret` is a server-generated value shown once. The caller MAY still provide either. See [5C.4](#5c4-oauth-client-smart-defaults). The example below shows the explicit form.

**Create the credential:**

```http
POST /scim/admin/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/credentials HTTP/1.1
Host: scim.example.com
Authorization: Bearer <admin-scim-token>
Content-Type: application/json
```

```json
{
  "credentialType": "oauth_client",
  "label": "Entra gallery prod"
}
```

**Response (both `clientId` and the one-time `clientSecret`):**

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "b2c3d4e5-6f70-4b81-9c2d-3e4f5a6b7c8d",
  "endpointId": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "credentialType": "oauth_client",
  "label": "Entra gallery prod",
  "active": true,
  "createdAt": "2026-06-29T17:06:12.000Z",
  "expiresAt": null,
  "clientId": "epc_3f9a1b7c4d2e8f60a1b2c3d4",
  "clientSecret": "s3T-base64url-secret-shown-once-Wx9Yz0Ab1Cd2Ef3"
}
```

**Entra mapping (OAuth2 client credentials):**

| Entra field | Value |
|---|---|
| Tenant URL | `https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34` |
| Token Endpoint | `https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token` |
| Client Identifier | `epc_3f9a1b7c4d2e8f60a1b2c3d4` |
| Client Secret | `s3T-base64url-secret-shown-once-Wx9Yz0Ab1Cd2Ef3` |

**Token exchange (what Entra does first):**

```http
POST /scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token HTTP/1.1
Host: scim.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=epc_3f9a1b7c4d2e8f60a1b2c3d4&client_secret=s3T-base64url-secret-shown-once-Wx9Yz0Ab1Cd2Ef3
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkhqZWcifQ.eyJlbmRwb2ludF9pZCI6IjdlM2Y5YzIxIn0.signature",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

The issued token is signed RS256 and carries an `endpoint_id` claim so it authorizes ONLY this endpoint's routes (verified this session: header `{"alg":"RS256","typ":"JWT","kid":"..."}`). A token minted for endpoint A cannot be replayed against endpoint B.

**Authenticated SCIM call (with the issued token):**

```http
GET /scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/Users?startIndex=1&count=10 HTTP/1.1
Host: scim.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVC...
Accept: application/scim+json
```

**Error - wrong secret (RFC 6749 token error shape):**

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
```

```json
{
  "error": "invalid_client",
  "error_description": "Client authentication failed."
}
```

### 5.4 Combination 4 - Workload Identity Federation (WIF)

No shared secret at all. The admin stores only **public** trust values; Entra presents a signed JWT assertion (RFC 7523 jwt-bearer) at the per-endpoint token endpoint; SCIMServer validates it against Microsoft's public JWKS plus the configured claims, then issues its own short-lived endpoint-scoped token. Requires `WifCredentialsEnabled=True`.

This combination is bidirectional: there is the trust the admin *configures* (what SCIMServer will accept) and the connection values handed *back* to Entra.

**Endpoint config:**

```json
{
  "WifCredentialsEnabled": "True"
}
```

**Create the WIF trust (all values are public; no secret):**

```http
POST /scim/admin/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/credentials HTTP/1.1
Host: scim.example.com
Authorization: Bearer <admin-scim-token>
Content-Type: application/json
```

```json
{
  "credentialType": "wif",
  "label": "Federated Identity (WIF)",
  "wif": {
    "assertionProfile": "jwt-bearer",
    "expectedIssuer": "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/v2.0",
    "expectedSubject": "11112222-3333-4444-5555-666677778888",
    "expectedAudience": "api://scim.example.com/7e3f9c21",
    "jwksUri": "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/discovery/v2.0/keys",
    "allowedTenantId": "aaaabbbb-0000-cccc-1111-dddd2222eeee",
    "requiredRoles": ["Scim.Provision"],
    "scope": "scim.read scim.write"
  }
}
```

**Trust-create response (no secret returned - there is none):**

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "c3d4e5f6-7081-4c92-9d3e-4f5a6b7c8d9e",
  "endpointId": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "credentialType": "wif",
  "label": "Federated Identity (WIF)",
  "active": true,
  "createdAt": "2026-06-29T17:09:31.000Z",
  "expiresAt": null
}
```

**Connection values handed back to the identity provider:**

| Property | Value |
|---|---|
| Token Endpoint | `https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token` |
| SCIM base URL | `https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34` |
| Expected audience | `api://scim.example.com/7e3f9c21` |

**Token exchange (assertion presented; RFC 7523):**

```http
POST /scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token HTTP/1.1
Host: scim.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer&client_assertion=eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9.eyJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vLi4uL3YyLjAifQ.signature
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkhqZWcifQ.eyJlbmRwb2ludF9pZCI6IjdlM2Y5YzIxIiwic2NvcGUiOiJzY2ltLnJlYWQgc2NpbS53cml0ZSJ9.signature",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "scim.read scim.write"
}
```

**Error - assertion fails validation (issuer/audience/tenant mismatch, bad signature, or alg not RS256/ES256):**

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
```

```json
{
  "error": "invalid_client",
  "error_description": "Assertion validation failed."
}
```

The validator is fail-closed: signature + alg-pin + time window first, then `iss` / `sub` / `aud` / `tid` exact match, then `requiredRoles` subset check ([wif-assertion-validator.service.ts](../../api/src/oauth/wif-assertion-validator.service.ts)). Any failure throws and maps to `invalid_client`.

---

## 5A. WIF end-to-end wire contract (trust / mint / SCIM call)

> **Status.** CURRENT and verified against the shipped Q6 code (commit 8fe8b9b) on 2026-07-06. Sources: [admin-credential.controller.ts](../../api/src/modules/scim/controllers/admin-credential.controller.ts) `createWifCredential`, [endpoint-oauth.controller.ts](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts) `handleAssertion`, [wif-assertion-token.provider.ts](../../api/src/modules/scim/controllers/wif-assertion-token.provider.ts) `mintFromAssertion`, [wif-assertion-validator.service.ts](../../api/src/oauth/wif-assertion-validator.service.ts), [oauth.service.ts](../../api/src/oauth/oauth.service.ts) `generateEndpointAccessToken`.

The complete request/response/headers for every step of a WIF connection. The single most important fact: the Microsoft-signed assertion is **client authentication only - it never rides the SCIM calls**. The token that authorizes SCIM calls is SCIMServer's OWN, minted fresh on every token request. That is why trust setup returns URLs + a subject (constants), not a bearer token: no durable token exists to hand out.

### 5A.1 Step 1 - trust establishment (admin, one-time)

The admin stores the PUBLIC Entra v2 trust values. No secret is created (`credentialHash` is stored empty).

```http
POST /scim/admin/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/credentials HTTP/1.1
Host: scim.example.com
Authorization: Bearer <admin-scim-token>
Content-Type: application/json
```

```json
{
  "credentialType": "wif",
  "label": "Entra SyncFabric WIF",
  "wif": {
    "assertionProfile": "jwt-bearer",
    "expectedIssuer": "https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/v2.0",
    "expectedSubject": "11112222-3333-4444-5555-666677778888",
    "expectedAudience": "b5ba7a93-4452-4522-aeb4-a2b5da870c16",
    "jwksUri": "https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/discovery/v2.0/keys",
    "allowedTenantId": "ce5f061f-abe6-4e40-9615-301f87bcb7f0",
    "requiredRoles": ["Scim.Provision"],
    "scope": "scim.read scim.write"
  }
}
```

The five REQUIRED trust fields (else 400): `expectedIssuer`, `expectedSubject`, `expectedAudience`, `jwksUri`, `allowedTenantId`. Note the **v2 shape**: issuer ends `/v2.0` and `expectedAudience` is the **bare appid GUID** (not the `api://...` v1 form).

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "c3d4e5f6-7081-4c92-9d3e-4f5a6b7c8d9e",
  "endpointId": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "credentialType": "wif",
  "label": "Entra SyncFabric WIF",
  "active": true,
  "createdAt": "2026-07-06T15:04:55.000Z",
  "expiresAt": null,
  "wif": {
    "expectedIssuer": "https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/v2.0",
    "expectedSubject": "11112222-3333-4444-5555-666677778888",
    "expectedAudience": "b5ba7a93-4452-4522-aeb4-a2b5da870c16",
    "jwksUri": "https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/discovery/v2.0/keys",
    "allowedTenantId": "ce5f061f-abe6-4e40-9615-301f87bcb7f0",
    "requiredRoles": ["Scim.Provision"],
    "scope": "scim.read scim.write",
    "assertionProfile": "jwt-bearer"
  }
}
```

The response contract carries NO `token` / `clientSecret` / `credentialHash` key - the trust is all public values.

### 5A.2 Step 2 - runtime token mint (Entra, every ~hour)

Entra presents the Microsoft-signed assertion; SCIMServer validates it and mints its OWN token. Body is `application/x-www-form-urlencoded` (RFC 6749 section 3.2), never JSON.

```http
POST /scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token HTTP/1.1
Host: scim.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer&client_assertion=eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9.eyJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vY2U1ZjA2MWYuLi4vdjIuMCJ9.SIG
```

Routing is self-describing (no prior binding): `grant_type=client_credentials` + a present `client_assertion` selects the WIF path; `client_assertion_type` MUST be `urn:ietf:params:oauth:client-assertion-type:jwt-bearer` (else 400 `invalid_request`); `client_assertion` + `client_secret` together is 400 `invalid_request` (mutually exclusive). The validator then does JWKS (host-allowlisted) + RS256/ES256 signature + time window, then exact-match `iss` / `sub` / `aud` / `tid`, then `requiredRoles` subset of the assertion `roles`.

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkhqZWcifQ.PAYLOAD.SIG",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "scim.read scim.write"
}
```

The `access_token` is an **RS256 JWT** (the Pre-Q.B externalized key, verifiable at `/scim/oauth/jwks`). Its decoded payload:

```json
{
  "sub": "11112222-3333-4444-5555-666677778888",
  "client_id": "11112222-3333-4444-5555-666677778888",
  "aud": "scimserver:7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "endpoint_id": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "scope": "scim.read scim.write",
  "token_type": "access_token"
}
```

From the code: `sub` / `client_id` = the assertion's `sub` (the Entra Workload Identity object id); `aud` = `<OAUTH_TOKEN_AUDIENCE>:<endpointId>`; the `endpoint_id` claim **scopes the token to this endpoint only** (a token minted for endpoint A is rejected on endpoint B); `scope` is the admin-configured WIF scope used verbatim (`trustedScope`); `expires_in` is clamped to the Entra 1-6h window (floor 3600, ceil 21600, default 3600). On any validation failure the response is `401 { "error": "invalid_client", "error_description": "Client authentication failed." }`.

### 5A.3 Step 3 - the SCIM resource call (every provisioning operation)

Entra presents the minted token as a normal bearer; the resource guard's Tier-2 OAuth-JWT branch accepts it. Media type is `application/scim+json` (RFC 7644 section 3.1).

```http
POST /scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/Users HTTP/1.1
Host: scim.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IkhqZWcifQ.PAYLOAD.SIG
Content-Type: application/scim+json
Accept: application/scim+json
```

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "bjensen@example.com",
  "active": true,
  "name": { "givenName": "Barbara", "familyName": "Jensen" },
  "emails": [{ "type": "work", "primary": true, "value": "bjensen@example.com" }]
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/scim+json
Location: https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/Users/8a3c9e21-0b44-4d17-9f2e-1c6a7b8d9e0f
ETag: W/"1"
```

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "8a3c9e21-0b44-4d17-9f2e-1c6a7b8d9e0f",
  "userName": "bjensen@example.com",
  "active": true,
  "name": { "givenName": "Barbara", "familyName": "Jensen" },
  "emails": [{ "type": "work", "primary": true, "value": "bjensen@example.com" }],
  "meta": {
    "resourceType": "User",
    "created": "2026-07-06T15:10:22.000Z",
    "lastModified": "2026-07-06T15:10:22.000Z",
    "version": "W/\"1\"",
    "location": "https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/Users/8a3c9e21-0b44-4d17-9f2e-1c6a7b8d9e0f"
  }
}
```

Entra's very first SCIM call is a **Test Connection** - a filtered GET expecting an empty list (`GET .../Users?filter=userName eq "<random>"` -> `200` with `totalResults: 0`). On a bad or expired token the guard returns `401` with `WWW-Authenticate: Bearer realm="SCIM", error="invalid_token", error_description="..."` and the SCIM error envelope (`scimType: "invalidToken"`).

### 5A.4 The whole loop

```mermaid
sequenceDiagram
    participant Admin
    participant API as SCIMServer
    participant Entra
    participant MS as Microsoft JWKS
    Note over Admin,API: Step 1 - trust (once)
    Admin->>API: POST /admin/endpoints/{id}/credentials (credentialType=wif, wif={...})
    API-->>Admin: 201 (wif trust echoed, no secret)
    Note over Entra,API: Step 2 - token mint (hourly)
    Entra->>API: POST /endpoints/{id}/oauth/token (grant_type=client_credentials, client_assertion=JWT)
    API->>MS: fetch JWKS (host-allowlisted)
    MS-->>API: public keys
    Note over API: verify sig + alg-pin + time, then iss/sub/aud/tid, then roles
    API-->>Entra: 200 (access_token RS256 with endpoint_id+scope, token_type Bearer, expires_in, scope)
    Note over Entra,API: Step 3 - SCIM call (per operation)
    Entra->>API: POST /scim/v2/endpoints/{id}/Users (Authorization Bearer minted-token)
    API-->>Entra: 201 (SCIM User + meta)
```

> **Fixed ([WI-1](#11a-work-items-delivery-backlog), 2026-07-06):** the admin UI's WIF return box now shows the SCIM URL as `/scim/v2/endpoints/{id}` (the correct form used in Step 3); it previously showed `.../endpoints/{id}/v2` (the `/scim/v2` rewrite is a leading prefix - see [2.3](#23-the-three-way-url-inconsistency-a-bug-this-design-fixes)).

---

## 5B. WIF trust field reference (examples, provenance, usage, validation)

> **Status.** CURRENT fields verified against [wif-assertion-validator.service.ts](../../api/src/oauth/wif-assertion-validator.service.ts) + [admin-credential.controller.ts](../../api/src/modules/scim/controllers/admin-credential.controller.ts). The claim-name INPUT aliases and the `allowedTenantId` -> `expectedTenantId` rename are [WI-13](#11a-work-items-delivery-backlog) (proposed). Naming decision (operator, 2026-07-06): KEEP the descriptive `expected*` names; ACCEPT the bare claim names as input aliases.

### 5B.1 Why not just name the fields `iss` / `sub` / `aud`?

The stored value is a **predicate** ("the value the incoming claim MUST equal"), not the claim itself - and SCIMServer both validates an assertion `aud` AND issues its own token with a different `aud`, so a bare `aud` would fuse two concepts. Microsoft's own `TokenValidationParameters` uses `ValidIssuer` / `ValidAudience`; Keycloak / Auth0 / Cognito / `jose` all spell the names out. So the contract keeps `expected*`, and (WI-13) also **accepts the claim name as an alias on input** (`iss` accepted for `expectedIssuer`, etc.) so a power user can paste a decoded token's keys directly.

### 5B.2 The master field table

Canonical example endpoint id `7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34`, tenant `ce5f061f-abe6-4e40-9615-301f87bcb7f0`.

| Field (input alias) | Example value | Where the admin finds it | How it is used at the token endpoint | Validated vs the assertion? |
|---|---|---|---|---|
| `expectedIssuer` (`iss`) | `https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/v2.0` | Derived from the tenant id, or read as `issuer` from the tenant's `.well-known/openid-configuration` | selects the trusted issuer | **Yes - exact string match to `iss`** |
| `jwksUri` | `https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/discovery/v2.0/keys` | Derived from the tenant id, or read as `jwks_uri` from discovery | fetched (host-allowlisted) to get the signing keys | Used to verify the signature (not string-matched) |
| `expectedSubject` (`sub`) | `11112222-3333-4444-5555-666677778888` | Entra admin center -> Enterprise applications -> the app -> **Object ID** (per-app); or the Microsoft-published SyncFabric object id (1P) | selects the trusted caller identity | **Yes - exact match to `sub`** |
| `expectedAudience` (`aud`) | `b5ba7a93-4452-4522-aeb4-a2b5da870c16` (or, by [WI-14](#11a-work-items-delivery-backlog) default, the endpointId) | The resource app's appid / Application ID URI in Entra; a handshake value the ISV proposes | confirms the token was minted FOR this endpoint | **Yes - match to `aud` (string or array)** |
| `allowedTenantId` -> `expectedTenantId` (`tid`) | `ce5f061f-abe6-4e40-9615-301f87bcb7f0` | **Entra admin center -> Overview -> Tenant ID** (the most readily-available value) | cross-tenant isolation | **Yes - exact match to `tid`** |
| `requiredRoles` (`roles`) | `["Scim.Provision"]` | App roles defined on the Entra app registration (forward-looking; Entra does not send `roles` yet) | authorization gate | **Yes - must be a SUBSET of `roles`** (only if set) |
| `scope` | `scim.read scim.write` | Chosen by the admin (what the minted token may do) | stamped verbatim on SCIMServer's OWN token | No - **output config** |
| `issuedTokenTtlSec` | `3600` | Chosen by the admin (clamped 1-6h) | TTL of the minted token | No - **output config** |
| `assertionProfile` | `jwt-bearer` | Fixed for RFC 7523 (default) | routes to the 7523 path | No - routing only |

**The five things actually checked against the incoming assertion:** signature + alg-pin + time window, then exact-match `iss` / `sub` / `aud` / `tid`, then the `requiredRoles` subset. `scope` / `issuedTokenTtlSec` / `assertionProfile` never touch the assertion - they shape the token SCIMServer hands back.

### 5B.3 Two kinds of field (why some are derivable and some are not)

- **Signing-trust fields** (`expectedIssuer`, `jwksUri`) answer "whose signature do I trust?" - mechanical properties of the IdP + cloud, identical for every customer on that IdP. These are **derivable** (see [5C](#5c-simplifying-wif-trust-setup-discovery-resolver--smart-defaults)).
- **Discriminator fields** (`expectedSubject`, `expectedAudience`, `expectedTenantId`) answer "which caller, for which resource, in which tenant?" - the per-relationship security anchors. These **must be supplied** (or generated by SCIMServer, in the case of the audience). Defaulting a discriminator to "accept anything" would delete a security check and is forbidden.

### 5B.4 Where to find each value, per IdP

| IdP | Tenant/realm id | Issuer | JWKS | Subject | Audience |
|---|---|---|---|---|---|
| **Entra (commercial)** | Overview -> Tenant ID | `login.microsoftonline.com/{tid}/v2.0` | `.../{tid}/discovery/v2.0/keys` | Enterprise app -> Object ID (per-app) or MS-published (1P) | resource app appid / App ID URI |
| **Entra (US Gov)** | same | `login.microsoftonline.us/{tid}/v2.0` | `login.microsoftonline.us/{tid}/discovery/v2.0/keys` | same | same |
| **Entra (China 21Vianet)** | same | `login.chinacloudapi.cn/{tid}/v2.0` | `login.chinacloudapi.cn/{tid}/discovery/v2.0/keys` | same | same |
| **Okta** | the org domain / custom AS id | `{domain}/oauth2/{asId}` (from discovery) | `{domain}/oauth2/{asId}/v1/keys` | the client / SP id | the resource the ISV registered |
| **Google (8693)** | n/a | `https://accounts.google.com` | `https://www.googleapis.com/oauth2/v3/certs` | the service account | the ISV's configured audience |
| **Generic OIDC** | n/a | `issuer` from the IdP's `.well-known/openid-configuration` | `jwks_uri` from the same doc | the calling principal | the ISV's configured audience |

---

## 5C. Simplifying WIF trust setup (discovery resolver + smart defaults)

> **Status.** DESIGN, operator-confirmed 2026-07-06. [WI-14](#11a-work-items-delivery-backlog). Nothing here changes the runtime validation path - it is all config-time ergonomics that fills the SAME stored `expected*` / `jwksUri` fields.

### 5C.1 "Accessible from any tenant id and any IdP" - how it works

A WIF trust is **per-endpoint**: when an assertion arrives at `/scim/endpoints/{id}/oauth/token`, the validator loads the `wif` trust for THAT endpoint and validates only against it. SCIMServer never globally trusts an issuer - each endpoint owner configures their own IdP for their own endpoint. So the server as a whole works with any tenant / any IdP because the trust is scoped to the endpoint, not the server. The genericity is delivered by the resolver below (not by weakening validation): it can produce the correct issuer + JWKS for ANY tenant or IdP, so each endpoint owner can self-configure in one or two inputs.

### 5C.2 The config-time discovery resolver (two modes)

A proposed admin action resolves the two signing-trust fields from the IdP's own OIDC discovery document, then stores them into `expectedIssuer` + `jwksUri`. The fetch happens ONCE at config time (operator-approved), is gated by the same `JWKS_HOST_ALLOWLIST` that guards the runtime JWKS fetch, and validates the returned `issuer` before storing it (RFC 8414 section 3.3 mix-up defense).

> This reads the **source IdP's** `.well-known/openid-configuration` (Entra/Okta/etc.). It is the OPPOSITE direction from [WI-12](#24-per-endpoint-oauth-as-metadata-url-options-norm-decision), where SCIMServer PUBLISHES its own `.well-known/oauth-authorization-server`. Two different well-known docs, opposite directions.

**Mode A - full discovery URL (works for any OIDC IdP):**

```http
POST /scim/admin/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/wif/resolve HTTP/1.1
Authorization: Bearer <admin-scim-token>
Content-Type: application/json
```

```json
{
  "discoveryUrl": "https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/v2.0/.well-known/openid-configuration"
}
```

**Mode B - preset + tenant id (selectable well-known IdP/cloud):**

```json
{
  "preset": "entra-commercial",
  "tenantId": "ce5f061f-abe6-4e40-9615-301f87bcb7f0"
}
```

**Resolve response (fills the signing-trust fields + the proposed audience default):**

```json
{
  "expectedIssuer": "https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/v2.0",
  "jwksUri": "https://login.microsoftonline.com/ce5f061f-abe6-4e40-9615-301f87bcb7f0/discovery/v2.0/keys",
  "expectedAudience": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34"
}
```

**Preset templates (the well-known URL each builds):**

| Preset | `.well-known/openid-configuration` URL |
|---|---|
| `entra-commercial` | `https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration` |
| `entra-usgov` | `https://login.microsoftonline.us/{tenantId}/v2.0/.well-known/openid-configuration` |
| `entra-china` | `https://login.chinacloudapi.cn/{tenantId}/v2.0/.well-known/openid-configuration` |
| `okta` | `https://{domain}/oauth2/{authServerId}/.well-known/openid-configuration` |
| `google` | `https://accounts.google.com/.well-known/openid-configuration` |
| `generic` | (use Mode A - paste the full URL) |

### 5C.3 Derived vs required vs generated (the defaults map)

| Field | Simplification | Result |
|---|---|---|
| `expectedIssuer` | **Derived** from discovery / preset | admin never types it |
| `jwksUri` | **Derived** from discovery / preset | admin never types it |
| `expectedAudience` | **Generated** default = the endpointId (v2-only) | admin sets their IdP resource app so `aud` carries this value; a per-endpoint audience also blocks cross-endpoint token replay |
| `expectedTenantId` | **Required** | the tenant-isolation anchor - can never be defaulted |
| `expectedSubject` | **Required** (per-app); constant (1P) | the caller identity anchor |
| `scope` / `issuedTokenTtlSec` / `requiredRoles` / `assertionProfile` | **Defaulted** already (`scim.read scim.write` / 3600 / `[]` / `jwt-bearer`) | optional |

**Audience = endpointId (operator decision).** SCIMServer defaults `expectedAudience` to the endpointId because v2 is the only supported token format and the endpointId is a stable, collision-free, per-endpoint value. It remains a **handshake**: the admin must configure their IdP so the assertion's `aud` carries this value (in Entra, set the resource app's Application ID URI accordingly). The happy path therefore collapses to **tenant id (+ subject for the per-app model)**.

### 5C.4 oauth-client smart defaults

For the per-endpoint `oauth_client` credential ([combination 3](#53-combination-3---per-endpoint-oauth-client-credentials)), if the caller omits the id/secret at create time:

```json
{
  "credentialType": "oauth_client",
  "label": "Entra gallery prod"
}
```

```json
{
  "credentialType": "oauth_client",
  "clientId": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "clientSecret": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

- **`client_id` default = the endpointId.** A client_id is public (never a secret), so using the endpointId is safe and means no lookup. Only the FIRST/default `oauth_client` credential uses the endpointId; any additional one on the same endpoint gets a generated id to avoid a collision.
- **`client_secret` default = a generated UUIDv4** (shown once, then bcrypt-hashed; retained only if `CredentialSecretVisibility=always`, see [6A](#6a-secret-visibility-credentialsecretvisibility--envelope-encryption-kek)). The caller MAY provide their own secret instead. Expert note: a UUIDv4 carries 122 bits of entropy (infeasible to guess); the current code uses a 256-bit random - both are strong, and the UUID form is the operator's choice for recognizability.

### 5C.5 The minimal-input happy path

Entra WIF, per-app model, one endpoint: **resolve from tenant id -> the resolver fills issuer + jwksUri + a proposed audience -> the admin adds only `expectedSubject` and confirms the audience -> save.** Five previously-required fields collapse to effectively two (tenant id + subject). The full manual form remains the advanced / non-OIDC escape hatch.

---

## 5D. JWKS host allowlist (prepopulated, persisted, hot-editable)

> **Status.** DESIGN, operator-requested 2026-07-06. [WI-15](#11a-work-items-delivery-backlog). The runtime SSRF enforcement point stays; this changes only how the allowlist is populated and edited.

### 5D.1 What it is and why it matters

`JWKS_HOST_ALLOWLIST` is the **anti-SSRF choke point**: before SCIMServer fetches an IdP's signing keys (JWKS) to validate a WIF assertion, [external-jwks-validator.service.ts](../../api/src/oauth/external-jwks-validator.service.ts) requires the `jwksUri` host to be `https` AND on the allowlist - a disallowed host is rejected **before any network call**. Without it, an operator-supplied `jwksUri` could point SCIMServer at an internal address.

**Today (verified):** it is env-only, a comma-separated list read **once at service construction** into a `Set`, empty by default (so every host is rejected and WIF fails closed until set), changed only by a restart. It is also currently absent from every deployment config, so the live allowlist is empty (harmless only because no live endpoint has WIF enabled yet). The companion `JWKS_CACHE_MAX_AGE_MS` (default `600000`) bounds the key cache.

### 5D.2 The three-layer effective allowlist

WI-15 makes the effective allowlist the **union of three layers**, so common IdPs work out of the box and new ones can be added without a redeploy:

| Layer | Source | Mutable at runtime? | Purpose |
|---|---|---|---|
| **Seed** | code constant (prepopulated well-known IdP hosts) | No (deploy to change) | zero-config for the common IdPs |
| **Env** | `JWKS_HOST_ALLOWLIST` | No (restart to change) | today's behavior, deployment-level additions |
| **Stored** | a persisted server-level list, admin-editable | **Yes (hot-reloaded)** | onboard a new customer IdP host with no redeploy |

$$\text{effective allowlist} = \text{seed} \cup \text{env} \cup \text{stored}$$

The **seed** (aligned with the [5C.2](#5c2-the-config-time-discovery-resolver-two-modes) presets):

```json
[
  "login.microsoftonline.com",
  "login.microsoftonline.us",
  "login.chinacloudapi.cn",
  "login.partner.microsoftonline.cn",
  "accounts.google.com",
  "www.googleapis.com"
]
```

Okta / Ping / generic-OIDC hosts are per-customer domains, so they cannot be seeded - the admin adds them to the stored layer.

### 5D.3 Admin API + server-level setting (hot-editable)

The stored layer rides the server security settings from [6A.7](#6a7-api-surface-proposed) and is edited via an admin API + a server-level Settings panel; the validator reads the effective list per fetch (or a cache invalidated on write) instead of building a `Set` once at boot.

```http
GET /scim/admin/settings/security HTTP/1.1
Authorization: Bearer <admin-scim-token>
```

```json
{
  "credentialSecretVisibility": "always",
  "jwksHostAllowlist": {
    "seed": ["login.microsoftonline.com", "login.microsoftonline.us", "login.chinacloudapi.cn", "login.partner.microsoftonline.cn", "accounts.google.com", "www.googleapis.com"],
    "env": [],
    "stored": ["idp.contoso-okta.com"],
    "effective": ["login.microsoftonline.com", "login.microsoftonline.us", "login.chinacloudapi.cn", "login.partner.microsoftonline.cn", "accounts.google.com", "www.googleapis.com", "idp.contoso-okta.com"]
  }
}
```

```http
POST /scim/admin/settings/security/jwks-hosts HTTP/1.1
Authorization: Bearer <admin-scim-token>
Content-Type: application/json
```

```json
{ "host": "idp.contoso-okta.com" }
```

`DELETE /scim/admin/settings/security/jwks-hosts/{host}` removes a host from the **stored** layer only - the seed and env layers are immutable at runtime. Every add/remove is admin-only and audit-logged (`LogCategory.AUTH`).

### 5D.4 Design choice: a simple runtime-editable allowlist

WI-15 deliberately keeps this to the simplest useful form: **a hostname allowlist an admin can edit at runtime**, prepopulated with the well-known IdP seed and persisted. There is **no IP-range deny-list and no lock flag** - this is a **convenience and runtime-flexibility choice** so that onboarding a new customer IdP host never needs a redeploy. The existing validation in [external-jwks-validator.service.ts](../../api/src/oauth/external-jwks-validator.service.ts) is retained unchanged: the scheme must be `https`, the host must exactly match an allowlist entry, and a non-matching host is rejected **before any network call**. Every add/remove is admin-only and audit-logged (`LogCategory.AUTH`).

**Accepted tradeoff (recorded).** Making the allowlist admin-editable means it is no longer gated behind a redeploy - that is the intended flexibility. The allowlist remains **server-global, never per-endpoint**, and it lands as the runtime-tunable `GlobalAuthPolicy.jwksHostAllowlist` row the architecture doc already anticipated ([section 6.2](AUTHENTICATION_ARCHITECTURE.md#62-what-the-design-adds-proposed-and-where)).

---

## 5E. Multiple credentials and configurations per auth type

> **Status.** CURRENT behavior, verified against [shared-secret.guard.ts](../../api/src/modules/auth/shared-secret.guard.ts), [endpoint-oauth.controller.ts](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts), and [wif-assertion-token.provider.ts](../../api/src/modules/scim/controllers/wif-assertion-token.provider.ts).

An endpoint stores its credentials as rows in the `EndpointCredential` table, so it can hold **many** credentials at once. Whether multiple of the SAME type are all usable at runtime depends on how each type is matched:

| Auth type | Multiple stored? | Distinguished at runtime by | Active simultaneously? |
|---|---|---|---|
| **Per-endpoint bearer** | Yes | the token value itself (each bcrypt-hashed) | **All** - the resource guard loops every active credential and bcrypt-compares the presented token |
| **Per-endpoint oauth_client** | Yes | `client_id` (`metadata.clientId`) | **All** - the token endpoint finds the credential whose `clientId` matches the request |
| **WIF trust** | Stored: yes; consulted: first only | (the provider uses the first `wif` row) | **One effective** - `find(c => c.credentialType === 'wif')` returns the first match |
| **Global shared secret** | One value (env) | - | One |

### 5E.1 Multiple bearer tokens (example: zero-downtime rotation)

Create a second bearer while the first is still live, so a token handover never has a gap:

```json
{ "credentialType": "bearer", "label": "bearer-2026-Q2" }
```

```json
{ "credentialType": "bearer", "label": "bearer-2026-Q3" }
```

Each `POST .../credentials` returns its own one-time `token`. **Both tokens authenticate** on `GET .../Users` at the same time (the guard loops every active credential), so the rotation flow is: issue the new token -> switch Entra's Secret Token field to it -> `DELETE` the old credential. No downtime.

### 5E.2 Multiple oauth_client pairs (example: prod + staging jobs)

Two independent OAuth client-credentials pairs on one endpoint - e.g. a production provisioning job and a staging one:

```json
{ "credentialType": "oauth_client", "label": "prod-job" }
```

```json
{ "credentialType": "oauth_client", "label": "staging-job" }
```

The first returns `clientId` `epc_aaaa...` + secret S1; the second `epc_bbbb...` + secret S2. Each job POSTs its OWN `client_id` + `client_secret` to `.../oauth/token`; the endpoint matches by `client_id` and mints an endpoint-scoped token for whichever pair authenticated. Both pairs are active at once (blue/green secret rotation works the same way: create the new pair, cut over, delete the old).

### 5E.3 WIF: one effective trust today (and how to trust several issuers)

Today the provider consults the **first** `wif` credential, so an endpoint effectively has **one active WIF trust**. To trust several issuers or token versions on one endpoint (Entra v1 + v2, or per-app + first-party 1P during a migration), the design path is the architecture doc's `trustProfiles[]` - a LIST of trust anchors INSIDE one WIF trust ([AUTHENTICATION_ARCHITECTURE.md section 3.1](AUTHENTICATION_ARCHITECTURE.md#31-axis-a-token-version-v1-vs-v2)) - not multiple `wif` rows. **Update (WI-16, 2026-07-06): the provider now iterates EVERY active `wif` row** ([5F.1](#5f1-config-level-wi-16---one-wif-row-per-idp)), so an endpoint can already hold several distinct-IdP `wif` trusts and any one of them can authenticate. Token-level issuer-first selection ([WI-17](#11a-work-items-delivery-backlog)) is the remaining optimization; the `trustProfiles[]`-within-one-row shape stays the path for multiple anchors of the SAME relationship (v1+v2). The **resource level is unchanged** (one common pool; isolation via a separate endpoint).

### 5E.4 Note - the oauth_client secret also works as a direct bearer

Because the resource guard's bearer loop compares the presented token against EVERY active credential's hash (not only `bearer`-type rows), an `oauth_client` credential's `client_secret` - whose stored hash is in that loop - will ALSO authenticate if presented directly as `Authorization: Bearer <client_secret>`, bypassing the token exchange. This is harmless (the same principal holds the secret), but the intended `oauth_client` flow is the token exchange in [5.3](#53-combination-3---per-endpoint-oauth-client-credentials); a future tightening could scope the bearer loop to `credentialType === 'bearer'`. WIF rows are unaffected - they store no secret, so they never match the loop.

---

## 5F. Multiple IdPs / WIF sources writing into one endpoint

> **Status.** DESIGN, operator-decided 2026-07-06. Config-level and token-level changes are ADOPTED as the design path ([WI-16](#11a-work-items-delivery-backlog), [WI-17](#11a-work-items-delivery-backlog)). **The resource level is UNCHANGED by design** - see the highlighted note below. Verified against [wif-assertion-token.provider.ts](../../api/src/modules/scim/controllers/wif-assertion-token.provider.ts) (today's first-only trust selection) and [external-jwks-validator.service.ts](../../api/src/oauth/external-jwks-validator.service.ts) (per-JWKS-URI caching).

[5E.3](#5e3-wif-one-effective-trust-today-and-how-to-trust-several-issuers) established that today an endpoint consults only the FIRST `wif` credential. This section is the decided design for letting **several IdPs / WIF sources provision the same endpoint at the same time** (for example a customer's Entra tenant plus an Okta org plus a Ping instance, all writing Users/Groups to one endpoint).

The problem splits into three levels, and the decision is different at each:

| Level | Question | Decision (2026-07-06) |
|---|---|---|
| **Config** | how do you DECLARE N trusted sources? | **Adopt** - one `wif` credential row per IdP; the provider iterates all of them (WI-16) |
| **Token** | how does the exchange PICK and VALIDATE the right source? | **Adopt** - decode `iss`/`tid` to SELECT the matching trust, then verify the signature against THAT trust's JWKS; stamp the minted token with its source (WI-17) |
| **Resource** | how do N sources SHARE the Users/Groups namespace? | **No change** - all resources land in one common pool; if isolation is needed, the admin creates a SEPARATE endpoint for that WIF. Nothing is built at the resource level. |

> **Resource level - unchanged by design (the load-bearing decision).** All resources from every trusted IdP flow into ONE common pool on the endpoint. SCIMServer does NOT tag, partition, or per-source-scope resources, and by this decision it will not. If a source needs an isolated population, the operator **creates another endpoint** and configures it for that specific WIF trust - the endpoint boundary IS the isolation boundary. This keeps the resource layer completely untouched: no provenance extension, no composite uniqueness key, no sub-tenant partition, no write-ownership rules. The entire multi-IdP feature is delivered at the **config + token levels only**.

### 5F.1 Config level (WI-16) - one `wif` row per IdP

Each IdP is its own `wif` `EndpointCredential`, created with the existing WIF create API ([5A](#5a-wif-end-to-end-wire-contract-trust--mint--scim-call)) - so adding, rotating, or revoking one IdP never touches the others, and the existing CredentialsTab list + SSE refresh work unchanged. **Implemented (WI-16, 2026-07-06):** [wif-assertion-token.provider.ts](../../api/src/modules/scim/controllers/wif-assertion-token.provider.ts) now iterates every active `wif` row (was `find`-first); a rejecting or misconfigured trust is treated as a non-match and the next is tried; if none accepts, the assertion fails closed (`invalid_client`). A single-trust endpoint behaves exactly as before. The CredentialsTab shows a multi-trust header when more than one trust is configured.

```jsonc
// Schematic shape - two wif trust rows on one endpoint (placeholders, not literal JSON).
// Each row is a separate POST /admin/endpoints/{id}/credentials call.
[
  {
    "credentialType": "wif",
    "label": "contoso-entra",
    "wif": {
      "expectedIssuer": "https://login.microsoftonline.com/<tid-A>/v2.0",
      "expectedSubject": "<app-A-object-id>",
      "expectedAudience": "<endpointId>",
      "jwksUri": "https://login.microsoftonline.com/<tid-A>/discovery/v2.0/keys",
      "allowedTenantId": "<tid-A>"
    }
  },
  {
    "credentialType": "wif",
    "label": "acme-okta",
    "wif": {
      "expectedIssuer": "https://acme.okta.com/oauth2/default",
      "expectedSubject": "<okta-client-id>",
      "expectedAudience": "<endpointId>",
      "jwksUri": "https://acme.okta.com/oauth2/default/v1/keys",
      "allowedTenantId": "<okta-tenant-or-org-id>"
    }
  }
]
```

A single-trust endpoint is unaffected: with one `wif` row the iteration selects that one row, identical to today.

### 5F.2 Token level (WI-17) - issuer-first selection, then verify

At `POST .../oauth/token`, when more than one `wif` trust exists:

1. Decode the assertion's `iss` (and `tid`) WITHOUT verifying, and use them ONLY to SELECT the matching trust anchor. An unknown `iss` is rejected (`invalid_client`), never allowed to fall through. This keeps selection O(1) - never N JWKS fetches.
2. Verify the signature + claims against THAT anchor's `jwksUri` / `expected*` (the existing [WifAssertionValidatorService](../../api/src/oauth/wif-assertion-validator.service.ts) path, unchanged per anchor). The decode-to-select is NOT a trust decision - the signature check against the selected JWKS is still the gate.
3. Mint the endpoint's own token exactly as today, additionally stamping the winning source (`src_iss` + the credential id) so telemetry can attribute which IdP drove the call.

Each anchor's `jwksUri` is cached independently (the validator keys its cache per URI), so N issuers means N cache entries, each honoring `JWKS_CACHE_MAX_AGE_MS`. Every anchor's `jwksUri` host must be in the [5D](#5d-jwks-host-allowlist-prepopulated-persisted-hot-editable) allowlist - multi-IdP is exactly why that allowlist naturally holds several hosts.

```mermaid
flowchart LR
    A["assertion @ /oauth/token"] --> B{"decode iss/tid<br/>(select only, unverified)"}
    B -->|"iss = contoso"| C1["trust: contoso-entra<br/>jwksUri A"]
    B -->|"iss = acme-okta"| C2["trust: acme-okta<br/>jwksUri B"]
    B -->|"no match"| X["reject invalid_client"]
    C1 --> V["verify signature vs selected JWKS<br/>+ expected sub / aud / tid / roles"]
    C2 --> V
    V -->|ok| M["mint endpoint token<br/>+ stamp src_iss + credential id"]
    V -->|fail| X
    M --> S["SCIM write into the endpoint's common pool"]
```

### 5F.3 Resource level - nothing to do (isolation = separate endpoint)

By the 2026-07-06 decision, the resource level ships NOTHING for multi-IdP. Restated for emphasis because it is the load-bearing simplification:

- **Common pool.** All Users/Groups from all trusted IdPs on an endpoint share one namespace, keyed the way they are today (`userName` / `externalId`). Sources are expected to own non-colliding populations.
- **Isolation is an endpoint, not a resource feature.** If two sources must NOT see or overwrite each other, the admin provisions a second endpoint and points that IdP at it. The endpoint is already a complete isolation boundary (its own credentials, its own SCIM base path, its own resource pool).
- **Consequences accepted.** No provenance/source attribute, no per-source uniqueness, no ownership/precedence rules, no partition query rewrites. If two sources DO write the same `externalId`/`userName` into one shared endpoint, last-writer-wins as today - that is the operator's signal to split them into separate endpoints.

### 5F.4 Industry norms (why this split is sound)

Grounding the decision against how the industry handles the same problem:

- **Isolation-first is the mainstream norm.** Most SCIM service providers (Slack, Zoom, GitHub, Atlassian, Snowflake) model provisioning as ONE connection = ONE IdP = ONE population; multi-source fan-in into a shared pool is pushed up into an IGA / identity-fabric layer, not solved inside the SCIM service provider. Choosing "separate endpoint for isolation" is squarely this norm.
- **Config/token multi-trust is a standardized, common pattern.** Selecting a trust anchor by issuer and then verifying against that anchor's keys is exactly what the cloud WIF systems and JWT gateways do: [GCP Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation) (one pool, many providers, selected by issuer), [Azure federated identity credentials](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) (many issuer/subject FICs per app), [AWS IAM OIDC identity providers](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html), and JWT issuer resolvers (Spring `JwtIssuerAuthenticationManagerResolver`, Kong, Apigee). WI-16 + WI-17 adopt this established pattern.
- **Provenance in SCIM is non-standard anyway.** SCIM defines `externalId` as the provisioning CLIENT's key ([RFC 7643 section 3.1](https://www.rfc-editor.org/rfc/rfc7643#section-3.1)); there is no standard "source" attribute, so a shared-pool-with-provenance model would be a custom extension. Declining to build it keeps the endpoint's SCIM contract standard.

---

## 6. Proposed connection-info API (single source of truth)

A new admin endpoint assembles every absolute URL and the per-method property set once, server-side, reusing the host logic already in [oauth-metadata.controller.ts](../../api/src/oauth/oauth-metadata.controller.ts). No UI hand-builds URLs after this lands. No secrets are returned (secrets remain one-time on credential create).

**Request:**

```http
GET /scim/admin/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/connection-info HTTP/1.1
Host: scim.example.com
Authorization: Bearer <admin-scim-token>
Accept: application/json
```

**Response (concrete example - parses as literal JSON):**

```json
{
  "endpointId": "7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "displayName": "Onboarding-ISV-Prov08",
  "urls": {
    "scimBaseUrl": "https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
    "scimBaseUrlBare": "https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
    "tokenEndpoint": "https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token",
    "serviceProviderConfig": "https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/ServiceProviderConfig",
    "oauthMetadata": "https://scim.example.com/.well-known/oauth-authorization-server"
  },
  "enabledMethods": [
    {
      "method": "oauth_client",
      "label": "OAuth2 client credentials",
      "entraAuthenticationMethod": "OAuth2 Client Credentials Grant",
      "entraFields": {
        "tenantUrl": "https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
        "tokenEndpoint": "https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token",
        "clientIdentifier": "epc_3f9a1b7c4d2e8f60a1b2c3d4",
        "clientSecret": null
      },
      "clientSecretState": "set-shown-once"
    },
    {
      "method": "wif",
      "label": "Workload Identity Federation",
      "entraAuthenticationMethod": "OAuth2 Client Credentials Grant",
      "entraFields": {
        "tenantUrl": "https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
        "tokenEndpoint": "https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token"
      },
      "expectedAudience": "api://scim.example.com/7e3f9c21"
    }
  ],
  "disabledMethods": [
    {
      "method": "bearer",
      "reason": "PerEndpointCredentialsEnabled is not set",
      "enableHint": "Set PerEndpointCredentialsEnabled=True in endpoint Settings"
    }
  ]
}
```

The `clientSecret` is `null` because it is never retrievable after creation; `clientSecretState` tells the UI whether to show a "shown once at creation" placeholder or a "create a credential" call to action. Schematic shape (placeholders) for reference:

```jsonc
{
  // Schematic shape - <...> are placeholders, not literal values
  "endpointId": "<uuid>",
  "urls": {
    "scimBaseUrl": "https://<host>/scim/v2/endpoints/<id>",
    "tokenEndpoint": "https://<host>/scim/endpoints/<id>/oauth/token"
  },
  "enabledMethods": [
    {
      "method": "bearer|oauth_client|wif",
      "entraAuthenticationMethod": "Secret Token|OAuth2 Client Credentials Grant",
      "entraFields": { /* only the fields that method needs */ },
      "clientSecretState": "set-shown-once|none|create-required"
    }
  ]
}
```

---

## 6A. Secret visibility (`CredentialSecretVisibility`) + envelope encryption (KEK)

> **Status.** DESIGN, locked with the operator 2026-07-06. Not yet implemented. This section is the authoritative spec for the re-viewable-secret feature and the KEK operator guide; when the feature ships, the operator-facing parts (the KEK env instructions) are transplanted verbatim into [DEPLOYMENT.md](../../DEPLOYMENT.md), `.env.example`, `docker-compose.yml`, and the README env table.

### 6A.1 Why this exists

Entra operators re-configure provisioning often and need to re-read the connection secret after the initial create moment. Today the secret is bcrypt-hashed and shown exactly once, so it is unrecoverable by design. This feature adds an OPTIONAL, operator-controlled ability to retain and re-display a credential secret, governed by a stored setting, with the secret encrypted at rest under a key hierarchy.

The non-secret recipe (Tenant URL, Token Endpoint, Client ID) is ALWAYS available regardless of any setting here - see [Part 6](#6-proposed-connection-info-api-single-source-of-truth). This section governs only the **secret** itself.

### 6A.2 The setting: `CredentialSecretVisibility`

A single named setting at two scopes (server + endpoint), an enum (noun-with-values so it can grow), stored explicitly - never unset.

| Value | Meaning |
|---|---|
| `always` (default) | The secret is retained (encrypted at rest) and can be re-viewed by an admin at any time. |
| `once` | The secret is shown once at creation, then hidden. No retained copy is kept; if a retained copy already existed it is purged when the setting flips to `once`. |

- **Scopes.** Server-level `CredentialSecretVisibility` and endpoint-level `CredentialSecretVisibility` (endpoint value lives in `profile.settings`, the same place as `WifCredentialsEnabled`).
- **Both are stored, editable settings** - toggleable at runtime via API + UI at each scope, no redeploy. This is not an env-only value.
- **Stored explicit default (no ambiguity).** A migration seeds the server setting to `always`. Endpoint creation writes the value explicitly into `profile.settings` (inheriting the server setting's current value at create time). Every endpoint therefore always has a concrete stored value.
- **`always` implies retention.** You cannot display what was not kept, so `always` is what turns on the encrypted retention described in 6A.4. Flipping to `once` purges any retained ciphertext for that scope.

### 6A.3 Precedence - server is the ceiling (most-restrictive-wins)

| Server setting | Endpoint setting | Effective for that endpoint |
|---|---|---|
| `always` | `always` | **always** (retain + reveal) |
| `always` | `once` | **once** (endpoint opted out) |
| `once` | `always` | **once** (server ceiling forces it; endpoint toggle shown disabled-with-explanation) |
| `once` | `once` | **once** |

`once` is more restrictive than `always`; the more restrictive of the two scopes wins. Setting the server to `once` is a single global kill-switch that no endpoint can override - the posture a security-conscious deployment picks.

### 6A.4 Encryption at rest - the two-level key hierarchy

Retained secrets are NEVER stored in plaintext. The design is standard envelope encryption (the same shape AWS/Azure KMS use), chosen so the operator's three requirements (persisted, recoverable, admin-viewable) are all met without co-locating the key and the ciphertext in a way that makes encryption cosmetic.

| Layer | Where it lives | Purpose |
|---|---|---|
| **KEK** (key-encryption-key) | **env var `CREDENTIAL_KEK`** (deployment config; NOT the app DB) | the security boundary - a DB dump alone cannot decrypt anything |
| **DEK** (data-encryption-key) | **in the DB, wrapped (encrypted) by the KEK** | persisted + recoverable - survives restart / redeploy / backup |
| Secret ciphertext | in the DB, AES-256-GCM encrypted by the DEK | the actual retained credential secret |

- The **auth hot path is unchanged**: token verification still compares against the **bcrypt hash**. The KEK/DEK are touched ONLY by the admin reveal path, never by request-time authentication.
- `CREDENTIAL_KEK` is a passphrase-style string run through a KDF (scrypt / HKDF) to derive the 32-byte AES key, so a human-friendly known string works as the input (same ergonomics as the shared secret).

### 6A.5 The KEK env var + known default (operator decision)

Per the operator decision, the KEK is supplied via env with a **known default**, exactly like the shared secrets (`changeme-oauth`, `changeme-scim`) - so the system works out of the box, is trivially redeployable, and never locks current users out.

```text
CREDENTIAL_KEK=changeme-credential-kek
```

- **Known default value: `changeme-credential-kek`.** Recorded durably in repo memory (`/memories/repo/credential-kek-and-secret-visibility.md`) and, when implemented, in `.env.example` + `docker-compose.yml` + [DEPLOYMENT.md](../../DEPLOYMENT.md) + the README env table - the same set of files that carry `changeme-oauth`.
- **Admin-viewable.** An admin-only, audit-logged settings endpoint surfaces the KEK status (`configured`, `isDefault`) and can reveal the configured value; every reveal writes a `LogCategory.AUTH` audit entry.

### 6A.6 CRITICAL operator guide - remembering + rotating the KEK

These are the rules that make the KEK safe to live with. They are the reason "remembering the KEK is crucial," but they also bound exactly how crucial.

1. **The KEK is NOT on the authentication critical path.** Endpoints authenticate against the bcrypt hash. **Losing or changing the KEK never prevents any endpoint from authenticating** - existing tokens keep working. It only affects the ability to re-view RETAINED secret copies. So the true blast radius of a forgotten KEK is "retained secrets become unreadable; rotate the credential to get a fresh viewable one," not "customers are locked out."
2. **The KEK MUST be identical across every instance and every redeploy** (dev, proudbush, calmsand). A DEK wrapped under KEK-A cannot be unwrapped under KEK-B. Because all users are on the shared prod today, the default guarantees consistency out of the box; if you ever set a custom KEK, set the SAME value on all instances.
3. **If you rotate the KEK, keep the OLD KEK available for decrypt** until every DEK has been re-wrapped under the new KEK (a one-time re-encryption pass), then retire the old value. Never hard-swap the KEK while retained ciphertext exists under the old one.
4. **The default KEK is cosmetic until rotated.** While `CREDENTIAL_KEK=changeme-credential-kek` (the public default), encryption-at-rest provides essentially no protection against an attacker who knows the default - identical to the `changeme-oauth` posture. Real at-rest protection begins only when the operator sets a private KEK in prod. This is called out in the deployment docs so the tradeoff is explicit.
5. **Pre-feature credentials cannot be retro-revealed.** Credentials created before this ships have only a bcrypt hash and no ciphertext; the UI labels them "secret not retained - rotate to get a viewable secret."

### 6A.7 API surface (proposed)

**Server setting:**

```http
GET /scim/admin/settings/security HTTP/1.1
Authorization: Bearer <admin-scim-token>
```

```json
{
  "credentialSecretVisibility": "always",
  "kek": {
    "configured": true,
    "isDefault": true
  }
}
```

```http
PUT /scim/admin/settings/security HTTP/1.1
Authorization: Bearer <admin-scim-token>
Content-Type: application/json
```

```json
{
  "credentialSecretVisibility": "once"
}
```

**Endpoint setting** rides the existing endpoint config-flag path (`profile.settings.CredentialSecretVisibility`), toggled via the endpoint update API + the SettingsTab Switch.

**Reveal a retained secret** (admin-only, audit-logged; only when the effective setting is `always`):

```http
POST /scim/admin/endpoints/{endpointId}/credentials/{credentialId}/reveal HTTP/1.1
Authorization: Bearer <admin-scim-token>
```

```json
{
  "id": "b2c3d4e5-6f70-4b81-9c2d-3e4f5a6b7c8d",
  "credentialType": "oauth_client",
  "clientId": "epc_3f9a1b7c4d2e8f60a1b2c3d4",
  "clientSecret": "s3T-base64url-secret-Wx9Yz0Ab1Cd2Ef3",
  "retained": true
}
```

When the effective setting is `once` (or the credential predates the feature), reveal returns a non-error "not retained" state:

```json
{
  "id": "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "credentialType": "oauth_client",
  "clientId": "epc_3f9a1b7c4d2e8f60a1b2c3d4",
  "retained": false,
  "reason": "CredentialSecretVisibility is 'once' for this endpoint - rotate the credential to obtain a viewable secret."
}
```

Schematic shape of the security-settings object (placeholders, not literal):

```jsonc
{
  // Schematic shape - <...> are placeholders
  "credentialSecretVisibility": "always|once",
  "kek": {
    "configured": true,
    "isDefault": true // true while CREDENTIAL_KEK is still the public default
  }
}
```

### 6A.8 Config-flag completeness (the 10-cell matrix)

`CredentialSecretVisibility` is an endpoint config setting, so per the repo's `endpointConfigFlagAudit` discipline it must be complete across: registry entry + stored default + validator (enum `always|once`) + enforcement (reveal gate + purge-on-`once`) + unit tests + E2E tests + live test + doc (this section) + UI Switch/segmented control + UI test. The server-scope setting adds its own settings-page cell + precedence-ceiling test.

---

## 7. Where + when to surface the connection info

Priority order. The single highest-leverage moment is credential creation, because that is the only time the secret exists.

| # | Surface | When | What it shows | Priority |
|---|---|---|---|---|
| 1 | Credential-create success dialog | the moment a secret is minted | the FULL connection block for that method (URLs + id + the one-time secret) | must-have |
| 2 | Connect tab (or "Credentials & Connection") | always available | Tenant URL (pre-credential) + per-method panel + Entra mapping | must-have |
| 3 | Overview tab connection card | endpoint overview | Tenant URL at a glance + "Set up provisioning" deep link | high |
| 4 | Onboarding wizard step 3 | first run | reuse the block so first-run users leave with the full set | high |
| 5 | WIF Save moment | after saving a trust | the unified block (fixes the `/v2` bug + the "Client ID = subject" confusion) | high |
| 6 | CreateEndpointWizard final step | after endpoint creation | Tenant URL + "create a credential to finish" | medium |
| 7 | Credentials empty-state | no credentials yet | Tenant URL already + next-step explanation | medium |
| 8 | Workbench prefill | testing | base URL + token prefilled so the operator can fire a call | medium |

---

## 8. UI mockups

These are layout sketches, not final visuals. All display values go through the existing R9 primitives (`CopyableField`, `CopyJsonButton`); inputs through `EditableField`.

### 8.1 ConnectionPanel - OAuth2 client-credentials (combination 3)

```text
+---------------------------------------------------------------------------+
|  Connect this endpoint to Entra ID                       [ Copy all JSON ] |
|  Method:  ( ) Secret token   (o) OAuth2 client credentials   ( ) WIF      |
+---------------------------------------------------------------------------+
|  Set these in Entra ID  ->  Provisioning  ->  Admin Credentials            |
|                                                                           |
|  Authentication Method   OAuth2 Client Credentials Grant                  |
|                                                                           |
|  Tenant URL        https://scim.example.com/scim/v2/endpoints/7e3f...  [C] |
|  Token Endpoint    https://scim.example.com/scim/endpoints/7e3f.../oa  [C] |
|  Client Identifier epc_3f9a1b7c4d2e8f60a1b2c3d4                        [C] |
|  Client Secret     (shown once at creation)               [ Rotate... ]   |
+---------------------------------------------------------------------------+
|  [ Copy as .env ]   [ Download .json ]      Test Connection expects 200 + |
|                                             empty ListResponse on a filter |
+---------------------------------------------------------------------------+
```

`[C]` is a copy button. After a fresh create, the Client Secret row instead shows the one-time value with its own copy button and a "copy it now - it will not be shown again" warning.

### 8.2 Credential-create success (the one-time secret moment - combination 3)

```text
+---------------------------------------------------------------------------+
|  Credential created                                              [ Done ] |
+---------------------------------------------------------------------------+
|  (!) Copy the client secret now. It will not be shown again.              |
|                                                                           |
|  Paste these 4 values into Entra ID  ->  OAuth2 Client Credentials Grant: |
|                                                                           |
|  Tenant URL        https://scim.example.com/scim/v2/endpoints/7e3f...  [C] |
|  Token Endpoint    https://scim.example.com/scim/endpoints/7e3f.../oa  [C] |
|  Client Identifier epc_3f9a1b7c4d2e8f60a1b2c3d4                        [C] |
|  Client Secret     s3T-base64url-secret-shown-once-Wx9Yz0Ab1Cd2Ef3     [C] |
|                                                                           |
|  [ Copy all 4 as JSON ]   [ Copy as .env ]                                |
+---------------------------------------------------------------------------+
```

### 8.3 Overview connection card

```text
+--------------------------------------------------+
|  Provisioning connection                         |
|  Tenant URL  https://scim.example.com/scim/v2/.. |
|              [ Copy ]                             |
|  Auth: OAuth2 client credentials (1 active)      |
|  [ Set up provisioning -> ]                       |
+--------------------------------------------------+
```

### 8.4 WIF panel (combination 4) - configure + return values

```text
+---------------------------------------------------------------------------+
|  Federated Identity (WIF)            no secret is stored; all values public|
+---------------------------------------------------------------------------+
|  Issuer (iss)      https://login.microsoftonline.com/<tenant>/v2.0     [e] |
|  Subject (sub)     <service principal object id>                       [e] |
|  Audience (aud)    api://scim.example.com/7e3f9c21                     [e] |
|  JWKS URI          https://login.microsoftonline.com/<tenant>/disc...  [e] |
|  Allowed tenant id <tenant guid>                                      [e] |
|  Required roles    Scim.Provision                                     [e] |
|  [ Save WIF trust ]   [ Test Connection ]   [ Copy trust as JSON ]        |
+---------------------------------------------------------------------------+
|  Hand these back to your identity provider:                               |
|  Token Endpoint    https://scim.example.com/scim/endpoints/7e3f.../oa  [C] |
|  SCIM base URL     https://scim.example.com/scim/v2/endpoints/7e3f...  [C] |
|  Expected audience api://scim.example.com/7e3f9c21                    [C] |
+---------------------------------------------------------------------------+
```

`[e]` is an `EditableField` (copy + undo + redo + reset); `[C]` is a read-only `CopyableField` copy button.

---

## 9. Copy / export formats

Every connection block supports four export affordances, all via existing primitives:

- **Copy field** - per value (`CopyableField`).
- **Copy as JSON** - the whole block (`CopyJsonButton`). Example payload for combination 3:

```json
{
  "tenantUrl": "https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34",
  "tokenEndpoint": "https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token",
  "clientIdentifier": "epc_3f9a1b7c4d2e8f60a1b2c3d4",
  "clientSecret": "s3T-base64url-secret-shown-once-Wx9Yz0Ab1Cd2Ef3"
}
```

- **Copy as `.env`** - for automation parity:

```text
SCIM_TENANT_URL=https://scim.example.com/scim/v2/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34
SCIM_TOKEN_ENDPOINT=https://scim.example.com/scim/endpoints/7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34/oauth/token
SCIM_CLIENT_ID=epc_3f9a1b7c4d2e8f60a1b2c3d4
SCIM_CLIENT_SECRET=s3T-base64url-secret-shown-once-Wx9Yz0Ab1Cd2Ef3
```

- **Download** - the `.json` block as a file (secret only included if downloaded in the one-time create moment).

---

## 10. Flow diagrams

### 10.1 Combination 3 - OAuth2 client credentials

```mermaid
sequenceDiagram
    participant Admin
    participant UI as SCIMServer UI
    participant API as SCIMServer API
    participant Entra as Entra Provisioning
    Admin->>UI: Create oauth_client credential
    UI->>API: POST /admin/endpoints/{id}/credentials
    API-->>UI: 201 { clientId, clientSecret (once) }
    UI-->>Admin: Connection block (Tenant URL, Token URL, id, secret)
    Admin->>Entra: Paste 4 fields
    Entra->>API: POST /endpoints/{id}/oauth/token (client_credentials)
    API-->>Entra: 200 { access_token (RS256, endpoint_id claim) }
    Entra->>API: GET /endpoints/{id}/Users (Bearer access_token)
    API-->>Entra: 200 ListResponse
```

### 10.2 Combination 4 - WIF (no secret)

```mermaid
sequenceDiagram
    participant Admin
    participant API as SCIMServer API
    participant Entra as Entra Provisioning
    participant MS as Microsoft JWKS
    Admin->>API: Save WIF trust (public values only)
    Note over API: stores iss/sub/aud/tid/jwks, no secret
    Entra->>API: POST /endpoints/{id}/oauth/token (client_assertion JWT)
    API->>MS: fetch JWKS (allowlisted host)
    MS-->>API: public keys
    Note over API: verify sig + alg-pin + time, then iss/sub/aud/tid, then roles
    API-->>Entra: 200 { access_token (own, short-lived) }
    Entra->>API: GET /endpoints/{id}/Users (Bearer access_token)
    API-->>Entra: 200 ListResponse
```

### 10.3 Where the connection block appears

```mermaid
flowchart TD
    A[Create endpoint] --> B[Overview connection card]
    B --> C[Connect tab]
    C --> D{Pick method}
    D -->|bearer / oauth_client| E[Create credential -> one-time secret block]
    D -->|wif| F[Save WIF trust -> return-values block]
    E --> G[Copy into Entra: Secret Token or OAuth2 fields]
    F --> G
    H[Onboarding wizard step 3] --> E
    I[Workbench prefill] -.test.-> G
```

---

## 11. Implementation + test plan

Per the repo's feature/bug-fix commit checklist and quality gates.

**API:**

- `ConnectionInfoService` that assembles absolute URLs (reusing the `X-Forwarded-*` host logic) + the per-method property set + the Entra-field mapping. No secrets.
- `GET /admin/endpoints/{id}/connection-info` controller returning the [Part 6](#6-proposed-connection-info-api-single-source-of-truth) shape.
- Add the assembled absolute URLs to the BFF overview (`useEndpointOverview`) so the UI stops hand-building URLs.
- Fix the WIF `scimUrl` in [CredentialsTab.tsx](../../web/src/pages/CredentialsTab.tsx) from `.../endpoints/{id}/v2` to the assembled value (decoupled small fix, can land first).

**Web:**

- One reusable `<ConnectionPanel endpointId method>` primitive consumed by all 8 surfaces.
- New Connect tab (or rename Credentials -> "Credentials & Connection") + Overview connection card.
- Wire into the credential-create dialog, onboarding step 3, WIF save, CreateEndpointWizard final step, Workbench prefill.

**Secret visibility + KEK (section 6A):**

- `CredentialSecretVisibility` setting at server scope (stored, migration-seeded to `always`, editable via `GET/PUT /admin/settings/security`) and endpoint scope (`profile.settings.CredentialSecretVisibility`, editable via the endpoint update API + SettingsTab). Server is the ceiling (most-restrictive-wins).
- Envelope-encryption storage: KEK from env `CREDENTIAL_KEK` (known default `changeme-credential-kek`, KDF -> AES-256-GCM) wraps a DB-persisted DEK; each retained secret is DEK-encrypted. The bcrypt auth path is untouched.
- `POST /admin/endpoints/{id}/credentials/{credentialId}/reveal` (admin-only, audit-logged) and `POST .../rotate` (mint-new-show-once, revoke-old).
- Admin-viewable KEK status/value via the audited security-settings endpoint.

**Tests (all layers, per norms):**

- Unit: `ConnectionInfoService` URL assembly across host-header permutations; per-method field selection; secret never present.
- API E2E: `connection-info` contract with a key-allowlist assertion (no `_`-prefixed internal fields, no secret keys ever).
- Live (`scripts/live-test.ps1` new section before SECTION 10): assert the assembled `tokenEndpoint` actually mints a token and the assembled `scimBaseUrl` actually serves a `ListResponse`, across local / Docker / dev Azure.
- Playwright (`web/e2e/`): Connect tab renders; copy buttons present by `data-testid`; the Entra-mapping table shows the right fields per method; the one-time secret block appears on create and the secret is gone on revisit.
- Response-contract test: the connection-info response contains ONLY documented keys.

**Docs:** this file, an INDEX.md entry, CHANGELOG entry with test counts, and a Session_starter note. When the secret-visibility feature ships, transplant the 6A.5/6A.6 KEK operator guide verbatim into [DEPLOYMENT.md](../../DEPLOYMENT.md), the README env table, and `docker-compose.yml` (the same files that carry `changeme-oauth`).

---

## 11A. Work items (delivery backlog)

One epic, sequenced into independently-shippable items. Sizes are relative (S/M/L); no time estimates. Each item ships with the full test matrix its layer requires (unit + E2E + live + Playwright where UI is touched) per the repo's feature/bug-fix commit checklist.

**Epic: Entra connection setup - connection info, secret visibility, and rotation.**

| WI | Title | Size | Depends on | Summary |
|---|---|---|---|---|
| WI-1 | Fix the WIF SCIM URL (`/endpoints/{id}/v2` bug) | S | none | **DONE (2026-07-06).** Corrected [CredentialsTab.tsx](../../web/src/pages/CredentialsTab.tsx) `scimUrl` to `/scim/v2/endpoints/{id}`; vitest regression + Playwright regression added. |
| WI-2 | `ConnectionInfoService` + `GET /admin/endpoints/{id}/connection-info` | M | none | Server-side URL + per-method assembler (Part 6 shape); no secrets; key-allowlist contract. |
| WI-3 | Surface connection info on the BFF overview | S | WI-2 | Assembled absolute URLs into `useEndpointOverview`; UI stops hand-building URLs. |
| WI-4 | `<ConnectionPanel>` primitive + Entra-field mapping table | M | WI-2, WI-3 | One reusable component; method selector; copy/CopyJson/.env/Download; R9 testids. |
| WI-5 | Connect surface + Overview card + wiring | M | WI-4 | Connect tab + card; wire into the 8 surfaces; new lazy route gets a size-limit budget. |
| WI-6 | Envelope-encryption storage (KEK -> DEK -> secret) | L | none | AES-256-GCM at rest; KEK env `CREDENTIAL_KEK` (default `changeme-credential-kek`); DB-persisted wrapped DEK; bcrypt auth path untouched; Prisma + InMemory parity. New credentials only. |
| WI-7 | `CredentialSecretVisibility` setting (server + endpoint) | M | WI-6 | Enum `always`/`once`; stored seeded default; server-as-ceiling precedence; API + UI toggles; the 10-cell config-flag matrix. |
| WI-8 | Reveal endpoint + audit log | M | WI-6, WI-7 | `POST .../reveal` admin-only, gated by effective setting, `LogCategory.AUTH` audit; old credentials return non-error "not retained". |
| WI-9 | One-click rotate | M | WI-2 (WI-6 optional) | `POST .../rotate` mints new secret (shown once, retained if allowed), revokes old; the lost-secret recovery path. |
| WI-10 | Docs / INDEX / CHANGELOG / session + KEK deployment docs | S | ships with each item | Fold KEK operator guide into DEPLOYMENT.md + README env table + docker-compose when WI-6 lands. |
| WI-11 | Split `PerEndpointCredentialsEnabled` into the per-method flag family | M | none | `SecretTokenBearerAuthEnabled` + `OAuthClientCredentialsAuthEnabled` + new `SharedSecretBearerAuthEnabled`; value-preserving migration; old flag read as a one-release fallback then retired; 10-cell matrix per flag. See [3A](#3a-auth-method-enablement-flags-proposed-flag-split-family). |
| WI-12 | Per-endpoint OAuth AS metadata (RFC 8414) | S | none | `GET /scim/endpoints/{id}/.well-known/oauth-authorization-server` (append form, Option B) advertising the per-endpoint `token_endpoint` + shared `jwks_uri`; `issuer` must equal the identifier used to build the URL. See [2.4](#24-per-endpoint-oauth-as-metadata-url-options-norm-decision). |
| WI-13 | WIF trust field claim-name aliases + per-field examples/hints | S | none | Accept `iss`/`sub`/`aud`/`tid`/`roles` as INPUT aliases for the `expected*` fields; add per-field UI hints + the [5B](#5b-wif-trust-field-reference-examples-provenance-usage-validation) provenance table; rename `allowedTenantId` -> `expectedTenantId` (keep `allowedTenantId` as an accepted alias - live contract). |
| WI-14 | WIF trust discovery resolver + smart defaults | M | none | Config-time `POST /admin/endpoints/{id}/wif/resolve` with full-`discoveryUrl` OR `preset`+`tenantId` modes (host-allowlist gated, config-time only); fills `expectedIssuer`+`jwksUri`; defaults `expectedAudience` to the endpointId; `oauth_client` defaults `client_id`=endpointId + generated `client_secret`. See [5C](#5c-simplifying-wif-trust-setup-discovery-resolver--smart-defaults). |
| WI-15 | JWKS host allowlist: prepopulate + persist + admin-editable at runtime | M | none | Three-layer effective allowlist (seed of well-known IdP hosts + env + persisted admin-editable layer, hot-reloaded); admin API + server-level Settings panel. A convenience/runtime-flexibility choice - no deny-list, no lock flag; the existing https + exact-host-match validation is retained. See [5D](#5d-jwks-host-allowlist-prepopulated-persisted-hot-editable). |
| WI-16 | Multi-trust WIF config (iterate all `wif` rows) | S | none | **DONE (2026-07-06).** Changed [wif-assertion-token.provider.ts](../../api/src/modules/scim/controllers/wif-assertion-token.provider.ts) from `find` (first-only) to iterate every active `wif` credential; a single-trust endpoint is unchanged. Enables N IdPs on one endpoint at the config level; CredentialsTab shows a multi-trust header. Resource level unchanged (common pool). See [5F.1](#5f1-config-level-wi-16---one-wif-row-per-idp). |
| WI-17 | Issuer-first trust selection + source-stamped mint | M | WI-16 | At the per-endpoint token endpoint, decode `iss`/`tid` to SELECT the matching trust (unknown `iss` = `invalid_client`), verify against THAT anchor's JWKS, and stamp the minted token with `src_iss` + credential id for telemetry. Resource level unchanged (common pool; isolation via a separate endpoint). See [5F.2](#5f2-token-level-wi-17---issuer-first-selection-then-verify). |

**Sequencing:**

```mermaid
flowchart LR
    WI1[WI-1 URL fix] --> ship1[ship]
    WI2[WI-2 connection-info API] --> WI3[WI-3 BFF] --> WI4[WI-4 ConnectionPanel] --> WI5[WI-5 surfaces]
    WI6[WI-6 encryption] --> WI7[WI-7 visibility setting] --> WI8[WI-8 reveal+audit]
    WI2 --> WI9[WI-9 rotate]
    WI5 --> WI8
    WI11[WI-11 flag split] --> ship11[ship]
    WI12[WI-12 per-endpoint metadata] --> ship12[ship]
    WI13[WI-13 trust field aliases] --> ship13[ship]
    WI14[WI-14 discovery resolver + defaults] --> ship14[ship]
    WI15[WI-15 JWKS allowlist prepopulate+persist+hot-edit] --> ship15[ship]
    WI16[WI-16 multi-trust WIF config] --> WI17[WI-17 issuer-first selection] --> ship17[ship]
```

- **Track A (recipe, non-secret, lower risk):** WI-1 -> WI-2 -> WI-3 -> WI-4 -> WI-5. Delivers "always know how to connect" with no threat-model change.
- **Track B (secret visibility, needs the KEK):** WI-6 -> WI-7 -> WI-8, plus WI-9. Where the re-viewable-secret feature lands.
- **Track C (auth-method hygiene, independent):** WI-11 (flag split) + WI-12 (per-endpoint metadata) + WI-13 (trust field aliases) + WI-14 (discovery resolver + smart defaults) + WI-15 (JWKS allowlist prepopulate/persist/hot-edit). Each ships standalone; none depends on Track A or B.
- **Track D (multi-IdP into one endpoint, config + token only):** WI-16 (iterate all `wif` rows) -> WI-17 (issuer-first selection + source-stamped mint). Resource level is unchanged by design (common pool; isolation via a separate endpoint), so there is no resource-layer work item. See [5F](#5f-multiple-idps--wif-sources-writing-into-one-endpoint).

**Locked decisions (operator, 2026-07-06):** setting name `CredentialSecretVisibility` (enum `always`/`once`, default `always`); KEK via env `CREDENTIAL_KEK` with known default `changeme-credential-kek`; server scope is the ceiling; auth-flag split naming **Option B** (`SecretTokenBearerAuthEnabled` + `OAuthClientCredentialsAuthEnabled` + `SharedSecretBearerAuthEnabled`, `WifCredentialsEnabled` unchanged); per-endpoint OAuth metadata URL **Option B** (append form); WIF trust naming keeps `expected*` + accepts claim-name aliases; WIF discovery resolver offers BOTH full-URL and preset modes (config-time, host-allowlist gated); `expectedAudience` defaults to the endpointId (v2-only); `oauth_client` defaults `client_id`=endpointId + generated `client_secret`; **JWKS host allowlist becomes a prepopulated + persisted + admin-editable-at-runtime three-layer union (seed + env + stored) - a convenience/runtime-flexibility choice with no deny-list or lock flag**; **multiple IdPs / WIF sources writing one endpoint is adopted at the config level (WI-16, iterate every `wif` trust row) and token level (WI-17, issuer-first selection then verify, source-stamped mint), while the RESOURCE level is UNCHANGED by design - all resources share one common pool and isolation is achieved by creating a separate endpoint per WIF, so nothing is built at the resource level**. Captured in sections 2.4, 3A, 5B, 5C, 5D, 5F, and 6A.

---

## 12. References

- [RFC 8414 - OAuth 2.0 Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414) (`token_endpoint`, well-known discovery, multi-tenant path components)
- [RFC 6749 - The OAuth 2.0 Authorization Framework](https://www.rfc-editor.org/rfc/rfc6749) (token endpoint concept; token + error response shapes)
- [RFC 7523 - JWT Profile for OAuth 2.0 Client Authentication](https://www.rfc-editor.org/rfc/rfc7523) (the WIF assertion profile)
- [Microsoft Entra SCIM provisioning tutorial](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups) (Tenant URL / Secret Token / OAuth2 fields; per-customer client id/secret mandate; Test Connection behavior)
- SCIMServer auth docs: [AUTHENTICATION_ARCHITECTURE.md](AUTHENTICATION_ARCHITECTURE.md), [PER_ENDPOINT_OAUTH_CLIENT.md](PER_ENDPOINT_OAUTH_CLIENT.md), [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md), [WIF_Q6_VALIDATE_ISSUE_UI.md](WIF_Q6_VALIDATE_ISSUE_UI.md), [WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md](WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md)
- SCIMServer sources: [main.ts](../../api/src/main.ts), [endpoint-oauth.controller.ts](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts), [admin-credential.controller.ts](../../api/src/modules/scim/controllers/admin-credential.controller.ts), [authentication-schemes.ts](../../api/src/modules/scim/discovery/authentication-schemes.ts), [wif-assertion-validator.service.ts](../../api/src/oauth/wif-assertion-validator.service.ts), [oauth-metadata.controller.ts](../../api/src/oauth/oauth-metadata.controller.ts)
