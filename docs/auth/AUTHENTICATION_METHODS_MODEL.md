# Authentication Methods Model (A0 - inert backbone)

> Step **A0** of the authentication build ([AUTHENTICATION_ARCHITECTURE.md section 13](AUTHENTICATION_ARCHITECTURE.md#13-step-by-step-execution-plan--estimates--dependencies), tracked in [EXECUTION_LEDGER.md](EXECUTION_LEDGER.md)). Establishes the generalized `authenticationMethods[]` backbone (architecture sections 1.3 + 5.2 + 6.2) as an **inert** model: stored and round-tripped, but not yet consulted by any auth resolver.

## What changed

An endpoint can hold several authentication methods at once (legacy bearer, per-endpoint bearer, OAuth client, external JWT, WIF, ...). A0 adds the data model that represents those methods on the endpoint profile, so that later steps (A1 admin CRUD, A2 discovery, A3 routing, Q1/Q2/Q6 providers) become **config, not rework**.

The model rides the existing `Endpoint.profile` JSONB - **no new column or table** - as `profile.authentication`:

```jsonc
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
