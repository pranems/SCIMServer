# Repo + API Understanding Baseline (Code-Verified)

> **Status**: Living implementation baseline  
> **Last Updated**: February 18, 2026  
> **Baseline**: SCIMServer v0.10.0

This document captures the current implementation reality after reading core repo and API sources. It is intended to prevent documentation drift.

---

## 1) Repository Structure (Practical)

- `api/`: NestJS backend, SCIM + admin APIs, Prisma + SQLite, OAuth/JWT auth.
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

## 3) Authentication Model

- Shared bearer token (`SCIM_SHARED_SECRET`) is enforced by global guard on non-public routes.
- OAuth token flow is available at `/scim/oauth/token` (`grant_type=client_credentials`).
- In production:
  - `SCIM_SHARED_SECRET` missing => auth hard-fail for protected endpoints.
  - `JWT_SECRET` missing => startup error in OAuth module.
  - `OAUTH_CLIENT_SECRET` missing => startup error in OAuth service.
- In non-production, missing secrets are auto-generated with warnings.

---

## 4) Routing Surface (Current)

- Admin APIs are under `/scim/admin/*`.
- Endpoint management APIs: `/scim/admin/endpoints/*`.
- Endpoint-scoped SCIM resources: `/scim/endpoints/{endpointId}/Users|Groups|Schemas|ResourceTypes|ServiceProviderConfig`.
- Compatibility path usage in docs/examples should prefer `/scim/v2/*` for client-facing SCIM examples and `/scim/admin/*` for admin APIs.

---

## 5) Operational Reality

- Container startup runs `docker-entrypoint.sh`, restores SQLite backup if present, runs `prisma migrate deploy`, then starts app.
- Primary runtime DB in container is `/tmp/local-data/scim.db` (ephemeral fast path), with backup copy at `/app/data/scim.db`.
- Backup module supports blob backup configuration via env.

---

## 6) Documentation Cleanup Guidance

When updating docs, keep these rules:

- Prefer code-verified facts over historical narrative.
- Clearly label historical or exploratory docs.
- Avoid mixing local-dev (`:3000`) and container (`:8080`) examples without context.
- Avoid repo-root startup commands for API runtime instructions.

