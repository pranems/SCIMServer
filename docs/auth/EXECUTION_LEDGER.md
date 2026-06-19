# Authentication Build - Execution Ledger

> **Cross-session source of truth** for the auth build that executes [AUTHENTICATION_ARCHITECTURE.md section 13](AUTHENTICATION_ARCHITECTURE.md#13-step-by-step-execution-plan--estimates--dependencies). Companion detail: [WIF section 13](WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md#13-step-by-step-implementation-plan), [ISV section 5](ISV_AUTH_PATTERNS_AND_SCIMSERVER_GAP_PLAN.md#5-phased-implementation-plan-phase-q). Numbering map: [README.md](README.md#numbering-reconciliation).

**Branch:** `feat/wif`
**Status legend:** NOT-STARTED | IN-PROGRESS | DONE | BLOCKED | DEFERRED

## Step status

| # | Step | Status | Commit SHA | Notes |
|---|------|--------|-----------|-------|
| 1 | **Pre-Q.A** structured config flag-type + validator (10-cell matrix) | DONE | ee2ba5c | structured flag-type + validateStructuredFlag + getConfigStructured + injectable definitions; 22 unit tests (RED->GREEN); doc updated. Build/lint/unit/E2E(inmemory) green. UI/live N/A (no flag registered yet) |
| 2 | **Pre-Q.B** RS256/ES256 externalized signing key + published JWKS + guard verify | DONE | _pending_ | OAuthSigningKeyService + buildJwtModuleOptions (alg-pin) + JwksController (GET /scim/oauth/jwks) + OAuthSigningModule. 9 unit + 4 E2E + 7 live (9z-AM). HS256 alg-confusion rejected. Local node live 1041/0. Docker/dev-Azure live -> next checkpoint |
| 3 | **A0** profile.authentication.methods[] + schemaVersion, INERT | DONE | 4ef4b76 | AuthenticationMethod + ProfileAuthentication types; expandAuthentication threaded through expandProfile (schemaVersion default + secret-strip + field-pick). 12 unit + 5 E2E + 8 live (9z-AN). No-secret invariant enforced. Backend-agnostic (profile JSONB opaque). Local live 1049/0. Docker/dev-Azure -> next checkpoint |
| 4 | **Q0** enrich WWW-Authenticate + aud claim + RFC 8414 metadata + 3-tier chain doc | DONE | b549d8d | WWW-Authenticate error/error_description (RFC 6750 s3) on invalid-token 401; aud claim on issued tokens; GET /.well-known/oauth-authorization-server (RFC 8414, root path); OAUTH_ISSUER constant. 2 unit + 5 E2E + 9 live (9z-AO). Local live 1058/0. Docker/dev-Azure -> THIS is the foundational-cluster checkpoint |
| 5 | **Q1** per-endpoint oauth-client credential + per-endpoint issuer + endpoint_id/aud claims | DONE | _pending_ | oauth_client credential (clientId+clientSecret, secret-once) + POST /endpoints/:id/oauth/token issuer + generateEndpointAccessToken (endpoint_id + per-endpoint aud) + guard scoping (mine-but-invalid-stop, no legacy fall-through). 11 unit + 7 E2E + 9 live (9z-AP). Local live 1067/0. Docker/dev-Azure -> next critical-path checkpoint |
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

## Validation cadence (decision, 2026-06-18)
Per-step: Stage 1 static + Stage 2 tests (unit + E2E inmemory) + local-node live-test (form factor 1). **Docker live-test + dev-Azure deploy/live-test are batched to integration checkpoints** (after foundational clusters and after each WIF-critical milestone), NOT per micro-step. Rationale: deploying all 11 steps to the shared dev Azure is disproportionate; steps are backend-agnostic or unit/E2E-covered; Docker/Azure run identical code. Each row notes its validation tier.

## Run log
| Date | Event |
|------|-------|
| 2026-06-18 | Ledger created. Branch feat/wif at 640418c (docs-only baseline). No auth code implemented yet. Starting Pre-Q.A. |
| 2026-06-18 | Pre-Q.A DONE. Added `structured` flag-type machinery (validateStructuredFlag + getConfigStructured + injectable definitions param) to endpoint-config.interface.ts. 22 new unit tests. API unit 3825->3847, build 0 err, lint baseline. Version 0.53.2 -> 0.54.0-alpha.1. Committed ee2ba5c (rebased onto remote hono CVE bump 58ca63b), pushed to feat/wif. |
| 2026-06-18 | Pre-Q.B DONE. Asymmetric RS256/ES256 signing + published JWKS (GET /scim/oauth/jwks) + algorithm-confusion pinning. New OAuthSigningKeyService/Module, JwksController, buildJwtModuleOptions factory. 9 unit + 4 E2E + 7 live (9z-AM). API unit 3847->3856; E2E inmemory 1223; local live 1041/0. Version -> 0.54.0-alpha.2. Committed 7baa330, pushed to feat/wif. |
| 2026-06-18 | A0 DONE. profile.authentication model (AuthenticationMethod + ProfileAuthentication) threaded through expandProfile with no-secret strip. 12 unit + 5 E2E + 8 live (9z-AN). API unit 3856->3866; endpoint/profile E2E 87; local live 1049/0. Version -> 0.54.0-alpha.3. Committed 4ef4b76, pushed. |
| 2026-06-18 | Q0 DONE. WWW-Authenticate enrichment (RFC 6750 s3) + aud claim + RFC 8414 metadata (/.well-known/oauth-authorization-server) + 3-tier chain doc. 2 unit + 5 E2E + 9 live (9z-AO). API unit 3866->3868; full E2E inmemory 1233; local live 1058/0. Version -> 0.54.0-alpha.4. Committed b549d8d, pushed. |
| 2026-06-18 | **INTEGRATION CHECKPOINT (foundational cluster Pre-Q.A -> Q0) PASSED on all 3 form factors.** Docker compose (Prisma backend) live-test 1058/0; dev Azure (deployed SHA b549d8d to scimserver-dev via ACR acrscimserver20622, revision vb549d8d) live-test 1058/0. Cross-backend parity (inmemory == Prisma) confirmed: all 24 new auth assertions (9z-AM/AN/AO) green on inmemory + Prisma + Azure. Q3/Q4/Q5 remain DEFERRED. Next: Q1. |
| 2026-06-18 | Q1 DONE. Per-endpoint oauth_client credential + per-endpoint token issuer (POST /endpoints/:id/oauth/token) + endpoint_id/aud claims + guard scoping (mine-but-invalid-stop). 11 unit + 7 E2E + 9 live (9z-AP). API unit 3868->3878; full E2E inmemory 1240; local live 1067/0. Version -> 0.54.0-alpha.5. |
