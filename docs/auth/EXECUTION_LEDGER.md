# Authentication Build - Execution Ledger

> **Cross-session source of truth** for the auth build that executes [AUTHENTICATION_ARCHITECTURE.md section 13](AUTHENTICATION_ARCHITECTURE.md#13-step-by-step-execution-plan--estimates--dependencies). Companion detail: [WIF section 13](WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md#13-step-by-step-implementation-plan), [ISV section 5](ISV_AUTH_PATTERNS_AND_SCIMSERVER_GAP_PLAN.md#5-phased-implementation-plan-phase-q). Numbering map: [README.md](README.md#numbering-reconciliation).

**Branch:** `feat/wif`
**Status legend:** NOT-STARTED | IN-PROGRESS | DONE | BLOCKED | DEFERRED

## Step status

| # | Step | Status | Commit SHA | Notes |
|---|------|--------|-----------|-------|
| 1 | **Pre-Q.A** structured config flag-type + validator (10-cell matrix) | DONE | _pending_ | structured flag-type + validateStructuredFlag + getConfigStructured + injectable definitions; 22 unit tests (RED->GREEN); doc updated. Build/lint/unit/E2E(inmemory) green. UI/live N/A (no flag registered yet) |
| 2 | **Pre-Q.B** RS256/ES256 externalized signing key + published JWKS + guard verify | NOT-STARTED | - | RED: issued token header carries alg:RS256 + kid; HS256 token rejected |
| 3 | **A0** profile.authentication.methods[] + schemaVersion, INERT | NOT-STARTED | - | RED: method persists + round-trips; endpoint GET carries no secret |
| 4 | **Q0** enrich WWW-Authenticate + aud claim + RFC 8414 metadata + 3-tier chain doc | NOT-STARTED | - | RED: 401 carries RFC 6750 params; metadata doc resolves |
| 5 | **Q1** per-endpoint oauth-client credential + per-endpoint issuer + endpoint_id/aud claims | NOT-STARTED | - | RED: per-endpoint token authorizes ONLY its own endpoint |
| 6 | **Q2** jose external JWKS validator: alg-pin, cache by kid, fail-closed, SSRF allowlist | NOT-STARTED | - | RED: good sig passes; alg:none + HMAC-with-public-key rejected; outage fails closed |
| 7 | **A1** admin /authentication/methods CRUD; secret-once; orthogonal create gate | NOT-STARTED | - | RED: create returns secret once; GET masks it |
| 8 | **A2** computed authenticationSchemes + RFC 8414 metadata + JWKS publication | NOT-STARTED | - | RED: enabled endpoint advertises N schemes with primary on defaultMethodId; disabled baseline only |
| 9 | **A3** token-endpoint form-urlencoded intake + self-describing routing cascade + 3-outcome acceptor | NOT-STARTED | - | RED: client_assertion -> validator not secret path; both assertion+secret -> invalid_request |
| 10 | **Q6** wif-7523 provider (+ wif-8693 seam) + reciprocal CredentialsTab WIF UI | NOT-STARTED | - | RED: valid assertion -> own token -> authorizes SCIM; wrong iss/aud/sub/tid/expired/missing-role -> invalid_client; no secret on wif response |
| 11 | **A4** identityModel / roleScopeMap / grantedScopes seams (enforcement OFF) + shadow telemetry | NOT-STARTED | - | RED: shadow counter computes the gate without enforcing it |
| - | **Q3** probe-direction OAuth client | DEFERRED | - | SKIP unless operator explicitly asks |
| - | **Q4** auth-code + refresh + PKCE | DEFERRED | - | SKIP unless operator explicitly asks |
| - | **Q5** mTLS + DPoP | DEFERRED | - | SKIP unless operator explicitly asks |

## Critical path
`Pre-Q.B -> {Q1 || Q2} -> A3 -> Q6 -> A4`, with `Pre-Q.A -> A0 -> {A1 || A2}` feeding in. Q3/Q4/Q5 are independent and do NOT gate WIF.

## Run log
| Date | Event |
|------|-------|
| 2026-06-18 | Ledger created. Branch feat/wif at 640418c (docs-only baseline). No auth code implemented yet. Starting Pre-Q.A. |
| 2026-06-18 | Pre-Q.A DONE. Added `structured` flag-type machinery (validateStructuredFlag + getConfigStructured + injectable definitions param) to endpoint-config.interface.ts. 22 new unit tests. API unit 3825->3847, build 0 err, lint baseline. Version 0.53.2 -> 0.54.0-alpha.1. |
