# Repo + API Understanding Baseline (Code-Verified)

> **Status**: Living implementation baseline  
> **Last Updated**: April 28, 2026  
> **Baseline**: SCIMServer v0.40.0

This document captures the current implementation reality after reading core repo and API sources. It is intended to prevent documentation drift.

---

## 1) Repository Structure (Practical)

- `api/`: NestJS backend, SCIM + admin APIs, Prisma + PostgreSQL 17, OAuth/JWT auth.
- `web/`: React/Vite observability and operations UI, built into `api/public` for container runtime.
- `docs/`: operational guides, protocol references, architecture analyses, and historical notes.
- `scripts/`: deployment, live tests, maintenance helpers.
- `infra/`: Bicep templates for Azure resources.

---

## 2) API Runtime Facts (From Source)

- Global API prefix is `/scim` (`api/src/main.ts`).
- Middleware rewrites `/scim/v2/*` → `/scim/*` for compatibility.
- Local runtime default port is `3000` if `PORT` is unset.
- Production image defaults to `PORT=8080`, exposes `8080`, and health-checks `:8080/health`.
- CORS is enabled with broad origin allowance (`origin: true`) for current deployment model.

---

## 3) Authentication Model (3-Tier Fallback - v0.21.0)

All non-public routes are protected by `SharedSecretGuard` (global `APP_GUARD`) with a 3-tier fallback chain:

1. **Tier 1 - Per-endpoint bcrypt credentials**: If `PerEndpointCredentialsEnabled` is `true` on the endpoint and the endpoint has active, non-expired credentials, the bearer token is verified via `bcrypt.compare()`. Admin CRUD at `/scim/admin/endpoints/:id/credentials`.
2. **Tier 2 - OAuth 2.0 JWT**: Token is decoded/verified via `OAuthService.validateAccessToken()`. OAuth token endpoint: `POST /scim/oauth/token` (`grant_type=client_credentials`).
3. **Tier 3 - Global shared secret**: Direct comparison with `SCIM_SHARED_SECRET` env var.

- All tiers fail → `401 Unauthorized`, `WWW-Authenticate: Bearer realm="SCIM"`.
- In production:
  - `SCIM_SHARED_SECRET` missing ⇒ auth hard-fail for protected endpoints.
  - `JWT_SECRET` missing ⇒ startup error in OAuth module.
  - `OAUTH_CLIENT_SECRET` missing ⇒ startup error in OAuth service.
- In non-production, missing secrets are auto-generated with warnings.

---

## 4) Routing Surface (Current)

- Admin APIs are under `/scim/admin/*`.
- Endpoint management APIs: `/scim/admin/endpoints/*`.
- Endpoint-scoped SCIM resources: `/scim/endpoints/{endpointId}/Users|Groups|Schemas|ResourceTypes|ServiceProviderConfig`.
- Compatibility path usage in docs/examples should prefer `/scim/v2/*` for client-facing SCIM examples and `/scim/admin/*` for admin APIs.

---

## 5) Operational Reality

- Container startup runs `docker-entrypoint.sh`, runs `prisma migrate deploy` against PostgreSQL, then starts app.
- Database is PostgreSQL 17 running in a separate container (`postgres:17-alpine`) via docker-compose.
- Database backup is handled by Azure-managed PostgreSQL PITR (no application-level backup module).

---

## 6) Documentation Cleanup Guidance

When updating docs, keep these rules:

- Prefer code-verified facts over historical narrative.
- Clearly label historical or exploratory docs.
- Avoid mixing local-dev (`:3000`) and container (`:8080`) examples without context.
- Avoid repo-root startup commands for API runtime instructions.

