# Authentication Methods Model (A0 - now PARTIALLY ACTIVE)

> Step **A0** of the authentication build ([AUTHENTICATION_ARCHITECTURE.md section 13](AUTHENTICATION_ARCHITECTURE.md#13-step-by-step-execution-plan--estimates--dependencies), tracked in [EXECUTION_LEDGER.md](EXECUTION_LEDGER.md)). Establishes the generalized `authenticationMethods[]` backbone (architecture sections 1.3 + 5.2 + 6.2).

> **Status correction, 2026-07-31 (v0.55.1).** This document previously described the model as
> **inert** - "stored and round-tripped, but not yet consulted by any auth resolver". That was true at
> A0 and is **no longer true**. The model is consulted at six runtime call sites, all of them through
> the helper `resolveEndpointAuthEnablement(config, endpoint.profile?.authentication?.methods)`, which
> resolves per-method enablement by preferring an explicit `methods[]` entry over the flat endpoint
> config flags:
>
> | Consumer | Location | What it decides |
> |---|---|---|
> | `EndpointCredentialAuthenticator` | [endpoint-credential.authenticator.ts:69](../../api/src/modules/auth/authenticators/endpoint-credential.authenticator.ts) | whether a per-endpoint bearer or oauth-client credential may authenticate a data-plane request |
> | `GlobalSharedSecretAuthenticator` | [global-shared-secret.authenticator.ts:93](../../api/src/modules/auth/authenticators/global-shared-secret.authenticator.ts) | whether the endpoint accepts the global shared secret (WI-11 reject-stop) |
> | `AdminCredentialController` | [admin-credential.controller.ts:456](../../api/src/modules/scim/controllers/admin-credential.controller.ts) | whether a credential of a given type may be **created** on the endpoint |
> | `EndpointOAuthController` | [endpoint-oauth.controller.ts:201](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts) | whether the endpoint token endpoint will mint for the requested method |
> | `authenticationSchemes` discovery | [discovery/authentication-schemes.ts:81](../../api/src/modules/scim/discovery/authentication-schemes.ts) | which schemes appear in `ServiceProviderConfig` |
> | `ConnectionInfoService` | [connection-info.service.ts:155](../../api/src/modules/scim/services/connection-info.service.ts) | which methods the Connect surface shows as enabled |
>
> **Why the stale wording survived so long.** Nothing in the codebase is named after this document.
> A search for a resolver whose identifier contains "authentication method" finds nothing, because the
> consulting helper is called `resolveEndpointAuthEnablement`. Verify by the **mechanism**
> (`profile?.authentication?.methods` reaching a decision), never by the **label**.
>
> **Still inert:** the `credentialRef` linkage and `defaultMethodId` are persisted and round-tripped but
> do not yet select a credential at mint time; and six of the ten registry `type` values have no runtime
> provider at all. Those remain genuine gaps.

## What changed

An endpoint can hold several authentication methods at once (legacy bearer, per-endpoint bearer, OAuth client, external JWT, WIF, ...). A0 adds the data model that represents those methods on the endpoint profile, so that later steps (A1 admin CRUD, A2 discovery, A3 routing, Q1/Q2/Q6 providers) become **config, not rework**.

The model rides the existing `Endpoint.profile` JSONB - **no new column or table** - as `profile.authentication`:

```jsonc
// Schematic shape. Placeholders in angle brackets are not literal JSON values.
"profile": {
  "schemas": [ /* ... */ ],
  "resourceTypes": [ /* ... */ ],
  "serviceProviderConfig": { /* ... */ },
  "settings": { /* ... */ },
  "authentication": {                 // A0 - NEW, inert
    "schemaVersion": 1,
    "methods": [
      {
        "id": "m-1",                   // stable instance handle
        "type": "wif-7523",            // registry key (the behavior/code path)
        "displayName": "WIF (JWT Bearer Assertion)",
        "plane": "token",
        "tokenEndpointAuthMethod": "private_key_jwt",
        "config": {                    // Class-A non-secret trust config
          "issuer": "https://login.microsoftonline.com/<tid>/v2.0",
          "audience": "<appid-guid>",
          "jwksUri": "https://login.microsoftonline.com/<tid>/discovery/v2.0/keys"
        },
        "credentialRef": "cred-1"      // reference to EndpointCredential (NOT the secret)
      }
    ],
    "defaultMethodId": "m-1"
  }
}
```

## Vocabulary (architecture section 1.1)

`provider` (code class) -> **`AuthenticationMethod`** (activated instance) -> holds a **`config`** (inner blob) -> backed by a **`credential`** (secret material, by reference) -> advertised as an **`authenticationScheme`** (RFC 7643 section 5 discovery).

## The no-secret invariant

Secret material (signing private keys, `client_secret` plaintext) is **never** stored in `profile.authentication`. It lives in `EndpointCredential` and is referenced by `credentialRef`. Two layers enforce this:

1. **No secret field exists** on `AuthenticationMethod` - the type has only relationship/trust fields.
2. **Expansion strips secrets** - [auto-expand.service.ts](../../api/src/modules/scim/endpoint-profile/auto-expand.service.ts) `expandAuthentication` projects each method to its known fields and removes any secret-looking config key (matched on `secret` / `password` / `passphrase` / `privatekey` / `credentialhash` after normalizing the key). So even a mistakenly-submitted `config.clientSecret` is dropped before persistence and never appears in any response.

This is asserted by unit, E2E, and live tests that submit a secret in `config` and prove it is absent from every response (the architecture section 2.3 "three data classes" contract).

## Components

| File | Role |
|---|---|
| [endpoint-profile.types.ts](../../api/src/modules/scim/endpoint-profile/endpoint-profile.types.ts) | `AuthenticationMethod`, `ProfileAuthentication`, plane/lifecycle unions; `authentication?` added to `EndpointProfile` + `ShorthandProfileInput`. |
| [auto-expand.service.ts](../../api/src/modules/scim/endpoint-profile/auto-expand.service.ts) | `expandAuthentication` (default schemaVersion, coerce methods, field-pick, secret-strip) threaded through `expandProfile`. `CURRENT_AUTH_SCHEMA_VERSION = 1`. |

Persistence + read + admin controllers needed **zero** changes: both backends store the profile JSONB opaquely, and `POST` / `GET /admin/endpoints/:id` (full view) already return the whole `profile`.

## Inert by design

A0 wires no resolver. The token-mint plane and the resource-plane guard do not read `profile.authentication` yet. An endpoint created without it is byte-for-byte unaffected (the field stays `undefined`). The block survives an unrelated `settings` PATCH (it rides `{...current}` in the profile merge).

## Test coverage

| Layer | Test | Covers |
|---|---|---|
| Unit | [auto-expand.service.spec.ts](../../api/src/modules/scim/endpoint-profile/auto-expand.service.spec.ts) "authentication model (A0)" | thread-through, schemaVersion default, methods coercion, field preservation, secret-strip, unexpected-key drop, defaultMethodId/policy |
| E2E | [endpoint-authentication-model.e2e-spec.ts](../../api/test/e2e/endpoint-authentication-model.e2e-spec.ts) | create + GET round-trip, no-secret contract, backward compat, PATCH preservation |
| Live | `scripts/live-test.ps1` section **9z-AN** | admin-API round-trip + secret-strip + GET, across all 3 form factors |
