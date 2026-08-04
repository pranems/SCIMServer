# Authentication Methods Model

> **Status: LIVE and enforced.** Originally shipped as step **A0** of the authentication build ([AUTHENTICATION_ARCHITECTURE.md section 13](AUTHENTICATION_ARCHITECTURE.md#13-step-by-step-execution-plan--estimates--dependencies), tracked in [EXECUTION_LEDGER.md](EXECUTION_LEDGER.md)) as an *inert* backbone. **It is no longer inert.** Since A1/A3, `profile.authentication.methods[]` is consulted on the authentication hot path and decides whether a method is accepted. Verified against `origin/master` `21ca0a95` (v0.55.2) on 2026-08-04 - see [Enforcement](#enforcement-this-model-is-not-inert).
>
> This correction matters for security review: a reader who believed the "inert" framing would conclude that disabling a method here has no effect. The opposite is true - it is one of the controls that determines whether a credential is accepted.

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

## Enforcement - this model is not inert

The original A0 step deliberately wired no resolver, and this document described that state for several releases after it stopped being true. Current runtime (`origin/master` `21ca0a95`, verified 2026-08-04) consults the model through a single helper, [`resolveEndpointAuthEnablement`](../../api/src/modules/endpoint/endpoint-config.interface.ts) (defined at line 930), at **five** call sites:

| # | Call site | What the decision controls |
|---|---|---|
| 1 | [endpoint-credential.authenticator.ts:69](../../api/src/modules/auth/authenticators/endpoint-credential.authenticator.ts) | whether a per-endpoint credential is accepted on the resource plane |
| 2 | [global-shared-secret.authenticator.ts:93](../../api/src/modules/auth/authenticators/global-shared-secret.authenticator.ts) | whether the global shared-secret bearer is accepted |
| 3 | [admin-credential.controller.ts:456](../../api/src/modules/scim/controllers/admin-credential.controller.ts) | what the admin credential API reports as effective |
| 4 | [endpoint-oauth.controller.ts:199](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts) | whether the token endpoint honours a method |
| 5 | [connection-info.service.ts:155](../../api/src/modules/scim/services/connection-info.service.ts) | what connection information advertises |

Two further consumers read the block directly rather than through the helper: [admin-authentication-method.controller.ts](../../api/src/modules/scim/controllers/admin-authentication-method.controller.ts) (A1 CRUD, lines 147-158) and [authentication-schemes.ts](../../api/src/modules/scim/discovery/authentication-schemes.ts) (line 84 derives `hasWifMethod` from the enabled set for RFC 7643 discovery).

**Resolution order.** An explicit `profile.authentication.methods[]` entry wins; otherwise the flat per-endpoint config flags apply. The helper is *value-preserving*: it never auto-seeds `methods[]`, so an endpoint that has never used the admin methods API behaves exactly as it did before the model existed. That backward-compatibility property is what made the stale "inert" wording survive review for so long - the model is invisible until someone uses it, and then it is authoritative.

## Lifecycle in a profile PATCH

`authentication` is **replaced wholesale** when a partial profile PATCH includes it ([endpoint.service.ts:811-813](../../api/src/modules/endpoint/services/endpoint.service.ts)), because the admin authentication-methods API computes and submits the complete block. It is preserved untouched when the partial omits it (it rides `{...current}`). This is deliberately different from `settings` and `serviceProviderConfig`, which are **per-key merged**. A caller that PATCHes a partial `authentication` block therefore **deletes every method it does not resend** - use the admin methods API rather than hand-rolling a profile PATCH.

## Test coverage

| Layer | Test | Covers |
|---|---|---|
| Unit | [auto-expand.service.spec.ts](../../api/src/modules/scim/endpoint-profile/auto-expand.service.spec.ts) "authentication model (A0)" | thread-through, schemaVersion default, methods coercion, field preservation, secret-strip, unexpected-key drop, defaultMethodId/policy |
| E2E | [endpoint-authentication-model.e2e-spec.ts](../../api/test/e2e/endpoint-authentication-model.e2e-spec.ts) | create + GET round-trip, no-secret contract, backward compat, PATCH preservation |
| Live | `scripts/live-test.ps1` section **9z-AN** | admin-API round-trip + secret-strip + GET, across all 3 form factors |
