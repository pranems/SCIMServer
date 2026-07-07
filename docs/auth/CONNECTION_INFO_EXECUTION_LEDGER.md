# Connection-info + auth-ergonomics epic - Execution Ledger

> **Cross-session source of truth** for the delivery of the connection-info / secret-visibility / auth-method-hygiene / multi-IdP epic designed in [CONNECTION_INFO_AND_ENTRA_SETUP.md section 11A](CONNECTION_INFO_AND_ENTRA_SETUP.md#11a-work-items-delivery-backlog). This ledger records *what shipped, per work item*. The companion [EXECUTION_ISSUES_AND_RCA.md](EXECUTION_ISSUES_AND_RCA.md) records *what went wrong on the way and what was learned*; new issues from THIS epic are appended there.
>
> **Design authority:** every WI here is fully specified in [CONNECTION_INFO_AND_ENTRA_SETUP.md](CONNECTION_INFO_AND_ENTRA_SETUP.md). This ledger does not restate the design; it tracks execution status, commit SHAs, test deltas, and per-form-factor validation.

**Branch:** `feat/wif`
**Design commit:** `ec8620f` (WI-1..WI-17 backlog + 5E + 5F, design-only)
**Status legend:** NOT-STARTED | IN-PROGRESS | DONE | BLOCKED | DEFERRED

## Work-item status

| WI | Title | Track | Size | Status | Commit | Notes |
|---|---|---|---|---|---|---|
| WI-1 | Fix WIF SCIM URL (`/endpoints/{id}/v2` bug) | A (pre) | S | DONE (local) | _pending_ | Client-side string fix in [CredentialsTab.tsx](../../web/src/pages/CredentialsTab.tsx); live prod bug. vitest RED->GREEN (18/18) + full web vitest 1094/1094 + Playwright regression (4 tests list). tsc baseline 0-new; build+size pass. dev-Azure Playwright batched to pre-track checkpoint. |
| WI-16 | Multi-trust WIF config (iterate all `wif` rows) | D | S | DONE (local) | _pending_ | Provider `find` -> iterate; actions the 5F decision. 7 provider unit + 2 E2E (multi-trust mint + all-reject) + 1 vitest (multi-trust header) + Playwright multi-trust UI + live 9z-AT2 (5 asserts). CredentialsTab multi-trust header UI. API build clean. |
| WI-17 | Issuer-first trust selection + source-stamped mint | D | M | DONE (local) | _pending_ | Decode `iss` unverified -> try matching trust first (O(1)); verify sig vs chosen JWKS; stamp `src_iss` on mint; undecodable/no-match -> try-all fallback. No distinct UI (token-internal; multi-IdP UI is WI-16). 3 provider unit + 2 oauth.service unit + 1 E2E. API unit 4018. dev-Azure batched to Track-D checkpoint. |
| WI-13 | WIF trust claim-name aliases + `expectedTenantId` | C | S | DONE (local) | _pending_ | `normalizeWifTrustAliases` maps iss/sub/aud/tid/roles/expectedTenantId -> canonical BEFORE validation; canonical wins; aliases never persisted. UI: alias hint + tenant field relabel. 3 unit + 1 E2E + 1 vitest + 1 Playwright + live 9z-AT3. Version alpha.16. dev-Azure batched to Track-C checkpoint. |
| WI-12 | Per-endpoint OAuth AS metadata (RFC 8414) | C | S | DONE (local) | _pending_ | New EndpointOAuthMetadataController: `GET /scim/endpoints/{id}/.well-known/oauth-authorization-server` (append form); issuer=bare id, token_endpoint per-endpoint self-consistent, jwks shared; public. UI: return-box metadata URL row. 5 unit + 2 E2E + 1 vitest + 1 Playwright + live 9z-AT4. API unit 4026. Version alpha.17. dev-Azure batched to Track-C checkpoint. |
| WI-11 | Split `PerEndpointCredentialsEnabled` flag family | C | M | NOT-STARTED | - | 3 new flags; value-preserving migration; 10-cell matrix each. |
| WI-14 | WIF trust discovery resolver + smart defaults | C | M | NOT-STARTED | - | Config-time OIDC discovery; audience defaults to endpointId. |
| WI-15 | JWKS host allowlist prepopulate/persist/hot-edit | C | M | NOT-STARTED | - | 3-layer union; runtime-editable; no deny-list/lock. |
| WI-2 | `ConnectionInfoService` + connection-info API | A | M | NOT-STARTED | - | Server-side URL + per-method assembler; no secrets. |
| WI-3 | Surface connection info on BFF overview | A | S | NOT-STARTED | - | Depends WI-2. |
| WI-4 | `<ConnectionPanel>` primitive + Entra field mapping | A | M | NOT-STARTED | - | Depends WI-2, WI-3. |
| WI-5 | Connect surface + Overview card + wiring | A | M | NOT-STARTED | - | Depends WI-4; new lazy route gets a size budget. |
| WI-6 | Envelope encryption (KEK -> DEK -> secret) | B | L | NOT-STARTED | - | AES-256-GCM at rest; bcrypt auth path untouched. |
| WI-7 | `CredentialSecretVisibility` setting | B | M | NOT-STARTED | - | Depends WI-6; enum `always`/`once`; server-as-ceiling. |
| WI-8 | Reveal endpoint + audit log | B | M | NOT-STARTED | - | Depends WI-6, WI-7. |
| WI-9 | One-click rotate | B | M | NOT-STARTED | - | Depends WI-2 (WI-6 optional). |
| WI-10 | Docs / INDEX / CHANGELOG / KEK deployment docs | B | S | NOT-STARTED | - | Ships with each item. |

## Implementation sequence (decided)

Ordered by risk + dependency, not by WI number:

1. **WI-1** - standalone client-side fix of a live bug; warm-up through the full gate stack.
2. **WI-16 -> WI-17** - Track D (multi-IdP), actions the just-locked 5F decision; small, high test leverage, no UI-surface risk.
3. **WI-13 -> WI-12 -> WI-11 -> WI-14 -> WI-15** - Track C hygiene; each ships standalone.
4. **WI-2 -> WI-3 -> WI-4 -> WI-5** - Track A connection recipe; where the new UI surface + BFF land.
5. **WI-6 -> WI-7 -> WI-8 -> WI-9** - Track B secret visibility; the KEK-dependent, highest-threat-model-change work last.
6. **WI-10** folds into each item's commit (docs/INDEX/CHANGELOG), not a separate step.

## Per-item gate walk (every WI, per the standing Quality Gates)

Each WI runs the full ladder before it is called DONE:

- **Stage 0 (TDD):** RED test first (unit/E2E/live/Playwright as the layer requires), GREEN minimal, REFACTOR safe.
- **Stage 1 (static):** api build + api eslint + web `tsc --noEmit` + web eslint + web build + web size-limit (no baseline regression).
- **Stage 2 (tests):** api unit + api E2E + web vitest + coverage; cross-backend parity when an `isInMemoryBackend` branch is touched.
- **Stage 3 (audits):** addMissingTests, apiContractVerification, error-handling, logging, auditAgainstRFC, securityAudit as applicable to the change surface.
- **Stage 4 (deploy):** Docker compose live-test (Prisma) + local-node live-test (inmemory) + dev-Azure deploy + live-test on the exact SHA.
- **Stage 5 (UI):** web vitest + Playwright vs dev when `web/` is touched.
- **Stage 6 (commit):** version bump + CHANGELOG + Session_starter + this ledger's run log + descriptive commit.

**Validation cadence:** per-WI Stage 0-2 + local-node live; Docker + dev-Azure live batched to a per-track checkpoint (mirrors the auth build's cadence decision - the shared dev Azure is not redeployed per micro-item, but every track ends on a green 3-form-factor checkpoint). UI items always run Playwright vs dev before DONE.

## Run log

| Date | Event |
|------|-------|
| 2026-07-06 | Ledger created. Branch `feat/wif` at `ec8620f` (design-only). Sequence decided: WI-1 -> Track D -> Track C -> Track A -> Track B. Starting WI-1. |
| 2026-07-06 | WI-1 DONE (local gates). Fixed `scimUrl` in CredentialsTab.tsx `.../endpoints/{id}/v2` -> `/scim/v2/endpoints/{id}`. TDD: vitest RED (received `/scim/endpoints/ep-1/v2`) -> GREEN 18/18. Static: web tsc 96 baseline / 0 new, web eslint N/A (no config), web build exit 0, size-limit exit 0. Full web vitest 1094/1094 (93 files). Playwright regression authored (route-mocked create POST, no server mutation) - 4 tests list clean. Version 0.54.0-alpha.12 -> alpha.13. dev-Azure Playwright batched to the pre-track checkpoint (same cadence as the auth build). Commit next. |
| 2026-07-06 | WI-1 committed `3482329`. |
| 2026-07-07 | WI-16 DONE (local gates). Multi-trust WIF: provider `find` -> `filter`+iterate every active `wif` row; fail-closed if none accepts; single-trust unchanged. TDD: 2 provider unit RED (validate called once, expected twice) -> GREEN 7/7. E2E: 2 new (mint-against-second-trust; all-reject -> invalid_client) GREEN 10/10. UI: "Configured federated trusts (N)" header + guidance; 1 vitest (19/19) + 1 Playwright (route-mocked two-trust overview). Live: section 9z-AT2 (two trusts both list active), parse OK. Gates: API build clean; API unit 4013/4013 (114 suites); web tsc 96 baseline / 0 new. Version alpha.13 -> alpha.14. dev-Azure live+Playwright batched to the Track-D checkpoint. Commit next. |
| 2026-07-07 | WI-16 committed `6157e0a` (version -> alpha.14). |
| 2026-07-07 | WI-17 DONE (local gates). Issuer-first selection: decode assertion `iss` unverified -> try matching trust FIRST (O(1)); sig still verified vs chosen JWKS; undecodable/no-match -> try-all (WI-16) fallback. Source-stamp: `generateEndpointAccessToken` gained optional `sourceIssuer` -> `src_iss` claim on the minted token (omitted for plain oauth_client). TDD: 3 provider unit + 2 oauth.service unit RED -> GREEN (both suites 38/38). E2E: minted token carries `src_iss` (10/10). No distinct UI (token-internal; multi-IdP UI shipped in WI-16). Gates: API build clean; full API unit 4013 -> 4018 (114 suites). Version alpha.14 -> alpha.15. dev-Azure live+Playwright batched to the Track-D checkpoint. Commit next. |
| 2026-07-07 | WI-17 committed `b892699` (version -> alpha.15). Track D (multi-IdP) complete. |
| 2026-07-07 | WI-13 DONE (local gates). WIF trust claim-name aliases: `normalizeWifTrustAliases` maps iss/sub/aud/tid/roles + expectedTenantId onto canonical keys BEFORE the required-field check; explicit canonical wins; alias keys dropped (never persisted). UI: claim-name alias hint caption + tenant field relabeled `(tid / expectedTenantId)`. TDD: 3 controller unit RED (missing expectedIssuer before normalize) -> GREEN 28/28. E2E: alias-shaped create mints + echoes canonical keys. vitest 20/20 (alias hint). Playwright: alias-hint-visible test. Live: 9z-AT3 (4 asserts), parse OK. Gates: API build clean; web tsc 96 baseline / 0 new. Version alpha.15 -> alpha.16. dev-Azure batched to the Track-C checkpoint. Commit next. |
| 2026-07-07 | WI-13 committed `8feca6f` (version -> alpha.16). |
| 2026-07-07 | WI-12 DONE (local gates). Per-endpoint RFC 8414 metadata: new EndpointOAuthMetadataController serves `GET /scim/endpoints/{id}/.well-known/oauth-authorization-server` (append form); issuer=bare per-endpoint id, token_endpoint appended (self-consistent), jwks_uri shared global; public; x-forwarded aware. ISSUE (self-inflicted, caught by pre-existing E2E): my first scim.module edit REPLACED EndpointScimUsersController with the new controller in the registration array, 404-ing `/Users` - restored Users + placed the metadata controller just before the generic wildcard controller. TDD: 2 E2E RED (401 no-route) -> GREEN 13/13; 5 controller unit. UI: return-box "OAuth metadata URL (RFC 8414)" row + 1 vitest (20/20) + 1 Playwright. Live: 9z-AT4 (6 asserts incl. no-shadowing /Users check), parse OK. Gates: API build clean; full API unit 4018 -> 4026 (115 suites); web tsc 96 baseline / 0 new. Version alpha.16 -> alpha.17. dev-Azure batched to the Track-C checkpoint. Commit next. |
