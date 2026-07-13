# Auth - Execution Issues and RCA Ledger

Per the repo standing rule "Execution Issue RCA Ledger", this records issues hit
during auth-related work with symptom / root-cause / fix / why-the-fix-works /
prevention + a detection-stage escape analysis.

## Issue 1 - Token endpoint accepted client credentials only in the body (`client_secret_post`), not the `Authorization: Basic` header (`client_secret_basic`)

| Field | Value |
|---|---|
| **Type** | Framework/spec surprise (partial RFC implementation) |
| **Severity** | High (blocked live provisioning on a customer-facing prod endpoint) |
| **Detected by** | Operator (Entra connection test on the calmsand prod endpoint) |
| **Earliest gate that could have caught it** | Stage 2.2 API E2E (a per-credential-location test) - none existed |
| **Escape delta** | 3 stages (escaped Stage 1, 2, and 4 to a live operator report) |

### Symptom
Entra's "OAuth2 client credentials grant (Active)" provisioning connection test
failed with `CredentialValidationUnavailable` and the detail *"Supported
CredentialLocationInRequest is required. This parameter determines whether client
credentials are included in the request header or body during token
acquisition."*

### Root-cause analysis
Both token endpoints - the global `POST /scim/oauth/token`
([oauth.controller.ts](../../api/src/oauth/oauth.controller.ts)) and the
per-endpoint `POST /scim/endpoints/{id}/oauth/token`
([endpoint-oauth.controller.ts](../../api/src/modules/scim/controllers/endpoint-oauth.controller.ts))
- read `client_id`/`client_secret` ONLY from the request body
(`client_secret_post`). RFC 6749 section 2.3.1 defines two valid credential
locations and names `client_secret_basic` (the `Authorization: Basic` header) as
the RECOMMENDED one. That branch was never implemented (`git log -S 'Basic'`
returns no history in either controller). It was a latent gap from the first
commit, not a regression.

The gap stayed dormant because earlier Entra SCIM configurations used the
long-lived **bearer/secret token** auth method, where Entra attaches a
pre-shared token to the SCIM calls and never calls the OAuth token endpoint.
The moment the app was switched to the newer **OAuth2 client credentials grant**
experience (which sends credentials in the Basic header and pre-validates the
supported credential location via metadata), the newly-exercised code path met
the pre-existing partial implementation and failed.

### Fix
New helper [client-credential-location.ts](../../api/src/oauth/client-credential-location.ts)
parses `Authorization: Basic` (RFC 6749 section 2.3.1, form-urlencoded halves,
split on the first colon) and resolves the effective credentials with body
values winning over header values. Both token controllers now call
`resolveClientCredentials(body, authorization)` before validating. The RFC 8414
metadata ([oauth-metadata.controller.ts](../../api/src/oauth/oauth-metadata.controller.ts))
now advertises `["client_secret_basic", "client_secret_post"]`.

### Why the fix works
The token endpoint now accepts credentials from BOTH RFC-6749 locations, so an
IdP that places them in the Basic header (Entra's new experience, Okta, Ping)
authenticates identically to one that places them in the body. Body precedence
preserves the existing `client_secret_post` behavior exactly - no existing
client changes shape - while the header path is purely additive.

### Prevention
- **Unit**: [client-credential-location.spec.ts](../../api/src/oauth/client-credential-location.spec.ts)
  (8 cases: parse, case-insensitivity, url-decode, first-colon split, malformed,
  body precedence, header fallback).
- **E2E**: `endpoint-oauth-client.e2e-spec.ts` mints a per-endpoint token via the
  Basic header; `oauth-discovery.e2e-spec.ts` binds metadata to behavior -
  asserts the endpoint accepts every auth method it advertises
  (advertise == enforce), the durable guard against the "advertise != enforce"
  drift class.
- **Live**: `live-test.ps1` section 9z-AP T10-T12 mint a token via Basic on a
  live node and assert the metadata advertises `client_secret_basic`.
- **Convention (generalizable)**: when implementing an RFC that permits several
  valid input forms, add a test per allowed form, and bind advertised
  capabilities (metadata) to actually-accepted behavior. Promoted as the
  "spec-completeness + advertise==enforce" pattern.
