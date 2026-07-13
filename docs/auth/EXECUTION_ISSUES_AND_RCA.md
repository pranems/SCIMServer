# Auth - Execution Issues and RCA Ledger

Per the repo standing rule "Execution Issue RCA Ledger", this records issues hit
during auth-related work with symptom / root-cause / fix / why-the-fix-works /
prevention + a detection-stage escape analysis.

## Issue 2 - Per-endpoint token endpoint rejected `application/x-www-form-urlencoded` with 415 (Entra recurrence)

| Field | Value |
|---|---|
| **Type** | Middleware scope surprise (SCIM rule caught an OAuth endpoint) |
| **Severity** | High (blocked live provisioning on customer-facing prod, AFTER Issue 1 was believed fixed) |
| **Detected by** | Operator (Entra provisioning error on calmsand) + reproduced via direct probe |
| **Earliest gate that could have caught it** | Stage 2.2 API E2E (a form-urlencoded per-endpoint token test) - none existed |
| **Escape delta** | Escaped Issue 1's fix verification because that verification exercised the GLOBAL token endpoint (exempt), not the per-endpoint one Entra actually uses |

### Symptom
After 0.54.0-alpha.9 (the `client_secret_basic` fix) was live, the operator still
saw `SystemForCrossDomainIdentityManagementCredentialValidationFailure` /
"Supported CredentialLocationInRequest is required". Direct probe of the
per-endpoint token URL returned `415 Unsupported Media Type` with
`CONTENT_TYPE_UNSUPPORTED` for an `application/x-www-form-urlencoded` body.

### Root-cause analysis
Entra's tenant URL is the PER-endpoint one
(`/scim/endpoints/{id}/oauth/token`), which lives under `endpoints/*`. The SCIM
content-type middleware ([scim-content-type-validation.middleware.ts](../../api/src/modules/scim/middleware/scim-content-type-validation.middleware.ts))
enforces RFC 7644 §3.1 (`application/scim+json` | `application/json`) on
`endpoints/*` routes and 415s anything else BEFORE the controller runs. Entra's
client-credentials grant sends the token request as
`application/x-www-form-urlencoded` (RFC 6749 §3.2), so it was rejected before
the credentials (Basic header OR body) were ever read. The GLOBAL
`/scim/oauth/token` sits outside `endpoints/*` and was already exempt - which is
exactly why Issue 1's fix verified green on the global path and the per-endpoint
gap was masked.

### Fix
The middleware now exempts ANY `*/oauth/token` path (regex
`/\/oauth\/token\/?$/`) from the SCIM media-type rule - a token endpoint is an
OAuth endpoint, not a SCIM resource endpoint. Identical to the `A3` exemption
already present on the feat/wif branch (kept in lockstep).

### Why the fix works
The exemption lets the form-urlencoded body reach the token controller, where the
Issue 1 credential resolver (Basic header + body) then authenticates it. The two
fixes compose: Issue 1 made the endpoint read credentials from either location;
Issue 2 lets the request's media type through so the credentials are read at all.

### Prevention
- **E2E**: `endpoint-oauth-client.e2e-spec.ts` +2 - a form-urlencoded body, and
  form-urlencoded + `Authorization: Basic` (the exact Entra flow) - both mint a
  token (not 415).
- **Live**: `live-test.ps1` 9z-AP T13-T14 (per-endpoint form-urlencoded mint, + Basic).
- **Convention (generalizable)**: when a fix is verified against a live surface,
  verify the EXACT surface the failing client uses (per-endpoint URL), not a
  sibling surface (global URL) that shares the code but differs in middleware
  scope. Issue 1's verification hit the global endpoint and missed this. Also:
  middleware scoped by URL prefix (`endpoints/*`) MUST explicitly exempt
  sub-paths that are semantically different (OAuth token endpoints under a SCIM
  resource prefix).

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
