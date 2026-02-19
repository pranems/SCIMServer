## SCIMServer – Condensed Session Memory

This file intentionally trimmed for clarity. Full historic log kept in git history.

### Recent Key Achievements (Chronological)
| Date | Achievement |
|------|-------------|
| 2026-02-19 | 🔐 **Deploy Secret Reuse on Rerun:** Enhanced `scripts/deploy-azure.ps1` to cache SCIM/JWT/OAuth secrets per `ResourceGroup + AppName` in `scripts/state/deploy-state-<rg>-<app>.json`, auto-reuse them on subsequent reruns when parameters are omitted, and persist cache immediately after prompt/validation so intermediate deployment failures do not lose initial secret inputs. |
| 2026-02-19 | 🧾 **Formatted Version Output in Deploy Summary:** Enhanced `scripts/deploy-azure.ps1` to print the verified `GET /scim/admin/version` response in a readable, formatted block at the end of deployment output (key runtime fields + full pretty JSON payload) alongside existing summary details. |
| 2026-02-19 | ✅ **Post-Deploy Runtime Verification Added:** `scripts/deploy-azure.ps1` now verifies the deployed instance by calling `GET /scim/admin/version` with bearer auth (`SCIM_SHARED_SECRET`) using retry/backoff before declaring success. Deployment now hard-fails if version endpoint never becomes ready. |
| 2026-02-19 | 🗂️ **Per-Run Deploy Logging Added:** `scripts/deploy-azure.ps1` now writes a unique local transcript log for every execution under `scripts/logs/deploy-azure-YYYYMMDD-HHMMSS.log`, capturing full console/runtime output. Failure path now also prints the log file path and closes transcript before exit. |
| 2026-02-19 | 🔁 **Wrapper Deploy Flow Aligned to Local Script:** Updated `deploy.ps1` to prefer local `scripts/deploy-azure.ps1` when running from repo, avoiding stale downloaded script behavior. This ensures current GHCR logic is used: anonymous-by-default for public image, prompt for GH credentials only when anonymous pull is unavailable (private image fallback). |
| 2026-02-19 | 🌐 **Anonymous Public GHCR Deploy Support:** Updated `scripts/deploy-azure.ps1` + `infra/containerapp.bicep` so public `ghcr.io/pranems/scimserver` images deploy without GH username/PAT prompts. GHCR auth is now strictly conditional (both username + password required), defaults to anonymous pull otherwise, and validated via deploy script run showing `GHCR Pull Mode: Anonymous (public image)` with no credential prompts. |
| 2026-02-19 | 🛡️ **Azure Deploy Failure Hardening + Root Cause Isolation:** Confirmed active subscription lacks `Microsoft.Resources/subscriptions/providers/read` (and related RG read) permissions, which blocks provider checks/deployment. Hardened `scripts/deploy-azure.ps1` to fail fast with explicit RBAC diagnostics and non-zero exit (`exit 1`) instead of silent `return` paths, and validated behavior with terminal run (now exits code 1 with actionable message). |
| 2026-02-18 | 🧠 **Repo/API Understanding Docs Update:** Performed code-verified pass over core runtime/auth/routing files (`api/src/main.ts`, OAuth/auth guard, Docker runtime + entrypoint), added a canonical implementation baseline doc (`docs/REPO_API_UNDERSTANDING_BASELINE.md`), updated docs index linkage, and corrected stale Docker guide port guidance from `:80` to current `:8080` runtime behavior. |
| 2026-02-18 | 🏷️ **Final Docs Metadata Normalization:** Completed standardized `Status / Last Updated / Baseline` header blocks for remaining weak-header docs (`docs/SCIM_VALIDATOR_FALSE_POSITIVES_REPORT.md`, `docs/STORAGE_AND_BACKUP.md`, `docs/TEST_ORGANIZATION_RECOMMENDATIONS.md`) and revalidated touched files with no markdown/editor errors. |
| 2026-02-18 | 🧭 **Diagrams + JSON Artifacts Refresh:** Repaired invalid docs JSON exports (`docs/postman/SCIM_v2_Postman_Collection.json`, `docs/openapi/SCIM_v2_openapi_full.json`), validated all `docs/**/*.json` artifacts parse cleanly, and refreshed sequence flow diagrams (`docs/create-user-sequence.mmd`, `docs/list-get-user-sequence.mmd`, `docs/USER_API_CALL_TRACE.md`) to current request-correlation and logging behavior. |
| 2026-02-18 | 📚 **Repository-Wide Docs Reorganization Pass:** Standardized core docs theme (metadata headers, onboarding-first flow, living-vs-historical labeling), corrected deployment/runtime facts (Node 24, Prisma 7 baseline, Docker port `8080`), fixed encoding artifacts in high-traffic docs, refreshed compliance/testing snapshots, and removed AI-conversational leftovers from reference documents. |
| 2026-02-18 | 📘 **README Best-Practice Reorganization:** Reworked README into a modern onboarding-first flow (why, quick start options, prerequisites, configuration, Entra setup, operations, quality status, docs index), corrected Docker run guidance to container port `8080`, and streamlined operational links for maintainability. |
| 2026-02-18 | 🧾 **README Image Removal + Text/JSON Replacement:** Removed all README image embeds (including badges) and replaced visual snapshot sections with formatted metadata table plus structured JSON samples for admin version and recent log outputs, while retaining links to captured raw JSON artifacts. |
| 2026-02-18 | 🧹 **Docs + JSON Current-State Sweep:** Normalized release-facing docs/examples to `v0.10.0`, removed remaining legacy repo naming references, refreshed OpenAPI description/version wording, and aligned long-form analysis docs to current baseline while preserving historical fix context. |
| 2026-02-18 | ✅ **Admin Version Rollout + Full Validation Pipeline:** Updated docs and API collections for expanded `GET /scim/admin/version` payload (`docs/COMPLETE_API_REFERENCE.md`, Postman/Insomnia JSON), aligned web `VersionInfo` typing, and validated end-to-end: clean builds (API + web), lint (0 errors / 74 warnings), unit (666/666), e2e (184/184), live local instance (280/280), fresh `scimserver:latest` Docker build + container live tests (280/280). |
| 2026-02-18 | 🧭 **Admin Version Endpoint Expanded:** `GET /scim/admin/version` now returns full running-instance metadata (service timing, runtime host/process/memory, auth configuration flags, storage details, deployment context) with sensitive values masked. Added e2e coverage in `api/test/e2e/admin-version.e2e-spec.ts` for auth requirement and response contract validation. |
| 2026-02-18 | 🔎 **Log Access UX Improvements:** Added easy log-access output to Azure deploy flow (`scripts/deploy-azure.ps1`) and bootstrap wrapper (`setup.ps1`) with copy/paste commands for recent, stream (SSE), and download endpoints. Added startup console hints in `api/src/main.ts` and updated deployment docs (`DEPLOYMENT.md`, `docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md`) to mirror the same quick commands. |
| 2026-02-18 | 🧪 **Test Coverage Expansion + Full Matrix Validation:** Added missing e2e coverage for `GET /scim/admin/log-config/download` and auth coverage for `GET /scim/admin/log-config/stream`; added live tests for log download formats/filters and SSE stream connectivity. Clean rebuild + full validation completed: 666 unit, 182 e2e, and 280 live tests passing on both local instance (`:6000`) and Docker latest (`:8080`). |
| 2026-02-18 | 🔧 **Remote Debugging & Diagnosis:** SSE live log tailing endpoint (`GET /stream`), log file download (`GET /download`), `scripts/remote-logs.ps1` (4-mode PowerShell script), comprehensive `docs/REMOTE_DEBUGGING_AND_DIAGNOSIS.md` (14 sections, Mermaid diagrams, curl/PS examples). 18 new unit tests (134 logging tests total). Postman v1.4 + Insomnia updated. |
| 2026-02-18 | 🚀 **v0.10.0 — Full Stack Upgrade:** Prisma 6→7 (driver adapter, prisma-client generator, prisma.config.ts), ESLint 8→10 (flat config), Jest 29→30, React 18→19, Vite 5→7. All 6 Dockerfiles updated node:22→24. 666 unit + 184 e2e + 280 live tests passing (local + Docker) |
| 2026-02-15 | 📖 **AZURE DEPLOYMENT GUIDE:** Created comprehensive `docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md` with architecture diagrams, step-by-step deployment, Entra ID setup, usage guide, troubleshooting, and cost estimates |
| 2026-02-15 | 📝 **README.md REWRITTEN:** Complete rewrite with architecture diagram, feature tables, Docker/Azure sections, documentation index, and project structure |
| 2026-02-15 | 📝 **DEPLOYMENT.md REWRITTEN:** Streamlined all deployment methods (Azure/Docker/Local) with comparison table, CI/CD pipeline info, and links to detailed guide |
| 2026-02-15 | 🔧 **VS CODE DEBUG CONFIGS:** Added `.vscode/launch.json` with 3 debug configurations (launch, launch+log, attach) and `start:debug:log` npm script |
| 2026-02-15 | ✅ **CI/CD VERIFIED:** GitHub Actions `build-test.yml` and `publish-ghcr.yml` confirmed pointing to `pranems/scimserver` |
| 2026-02-14 | 🧹 **ESLint Hardened:** `.eslintrc.cjs` updated for @typescript-eslint 8.x — 223→0 errors (8 source fixes + config overrides), 48 remaining warnings (intentional `any` + test scaffolding). `fast-xml-parser` CVE patched. |
| 2026-02-14 | 🚀 **Major Dependency Upgrade:** Node 22-alpine Docker, NestJS 10→11, Prisma 5→6, TypeScript 5.4→5.9, tsconfig targets es2022. 492 unit + 154 e2e + 212 live tests passing (local & Docker) |
| 2026-02-14 | 📝 **Docs Updated to Current State:** SCIM_COMPLIANCE (filtering 85→100%), RECOMMENDED_DESIGN_IMPROVEMENTS (§17.1 gap analysis + §18 roadmap refreshed), INDEX.md, TESTING-WORKFLOW.md |
| 2026-02-14 | 📦 **JSON Consolidation:** 32→19 JSON files (41% reduction) — merged PATCH examples, removed duplicates, fixed OpenAPI /Bulk + bulk.supported, fixed update-endpoint strictMode |
| 2026-02-11 | 📚 **Docs Consolidation:** 34→21 markdown files (~45% line reduction) — merged redundant guides, removed stale files |
| 2026-02-11 | 🔊 **Verbose Live Tests:** `live-test.ps1 -Verbose` cmdlet overrides transparently intercept all API calls; 183/183 tests at the time (later expanded to 212) |
| 2026-02-10 | ✅ **Phase 1 RFC Compliance Complete:** SCIM filter parser (10 operators + and/or/not + grouping), POST /.search, ETag/If-None-Match→304, attributes/excludedAttributes projection, centralized error handling, SCIM content-type on all responses |
| 2026-02-10 | 🧪 **492 unit tests + 183 live integration tests passing** (later expanded to 212) — all 25 Microsoft SCIM Validator tests pass (including 7 preview) |
| 2025-11-21 | 🎯 **PAGINATION FIX:** Backend-driven keepalive filtering (TDD implementation) - accurate counts, no empty pages when hideKeepalive enabled |
| 2025-11-21 | Extended executive/technical wiki created (`wiki.md`) for management evaluation |
| 2025-11-21 | Added beginner quickstart & Azure CLI prerequisites to wiki (`wiki.md`) |
| 2025-11-21 | Relocated prerequisites to top of wiki and renumbered sections for clarity |
| 2025-11-21 | Added legacy self-hosted lab reference + GitHub issues guidance to wiki (`wiki.md`) |
| 2025-11-21 | Added emoji heading refresh + optional Bicep CLI prerequisite & note to wiki (`wiki.md`) |
| 2025-10-28 | v0.8.13 tagged (direct update script envvars fix) |
| 2025-10-28 | v0.8.12 tagged (direct update script env fix) |
| 2025-10-27 | v0.8.11 tagged (direct update script auto-secrets + restart) |
| 2025-10-28 | Diagnosed prod SQLite corruption; initiated blob snapshot restore workflow |
| 2025-10-27 | v0.8.10 tagged (runtime secret enforcement + deployment script updates) |
| 2025-10-20 | OAuth module now requires JWT/OAuth secrets from environment; dev auto-generation logs warnings |
| 2025-10-20 | Azure deploy/setup scripts emit JWT & OAuth secrets and pass to Container Apps template |
| 2025-10-20 | Activity feed aggregates multiple pages when hiding keepalive checks, keeping page numbering intuitive |
| 2025-10-20 | v0.8.9 tagged (activity feed keepalive pagination fix) |
| 2025-10-20 | Activity feed pagination skips keepalive-only pages when hide toggle is on |
| 2025-10-20 | publish-ghcr workflow description updated; YAML lint passing with version 0.8.8 example |
| 2025-10-20 | v0.8.8 tagged (keepalive suppression across logs + activity metrics) |
| 2025-10-20 | Activity feed shares keepalive suppression toggle; summary metrics exclude Entra ping checks |
| 2025-10-20 | Raw log viewer can hide Entra keepalive GET pings (toggle + suppression banner) |
| 2025-10-05 | Git tag v0.8.7 created and pushed to origin (manual provisioning release) |
| 2025-10-05 | Web UI upgrade helper now strips leading 'v' from version parameter; GHCR image 0.8.7 published via workflow_dispatch |
| 2025-10-05 | Blob snapshot bootstrap added to Docker entrypoint (restores /tmp DB before migrations) |
| 2025-10-05 | Initiated SCIM duplicate handling refinement: schema uniqueness enforced & service helpers in progress |
| 2025-10-05 | Private storage endpoint rollout: VNet + DNS automation baked into deploy-azure.ps1 |
| 2025-10-05 | Deploy script now reuses existing ACA virtual network & DNS when already configured |
| 2025-10-05 | Setup auto-registers Microsoft.App & Microsoft.ContainerService providers before deployment |
| 2025-10-05 | Networking template no longer pre-delegates subnets (consumption environment compatibility) |
| 2025-10-05 | Deployment script can now reuse existing VNets/DNS by creating only missing sub-resources |
| 2025-10-05 | Interactive prompt now defaults to existing Container App name to avoid accidental redeploys |
| 2025-10-05 | Bootstrap setup script auto-detects existing app/env names per resource group |
| 2025-10-05 | Resource discovery now uses az resource list to avoid extension noise and ensure reuse |
| 2025-10-05 | Web footer fallback version synced with package.json (0.8.3) |
| 2025-10-05 | Manual provisioning console (UI + admin API) for SCIM collision testing |
| 2025-10-05 | Version bumped to v0.8.6 (blob restore bootstrap + duplicate guardrails prep) |
| 2025-10-05 | Version bumped to v0.8.5 across API + Web + docs |
| 2025-10-05 | Version bumped to v0.8.4 across web assets |
| 2025-10-04 | Backup service telemetry + blob snapshot compile fix |
| 2025-10-04 | Upgrade command now auto-fills RG/App and acknowledges blob backups |
| 2025-10-04 | Added manual GHCR publish workflow (publish-ghcr.yml) |
| 2025-10-03 | v0.8.4 released: structured membership change data (addedMembers/removedMembers) & UI rendering; case-insensitive PATCH ops. |
| 2025-10-02 | Unified image build (root Dockerfile ships API + Web) |
| 2025-10-02 | Token resilience: frontend clears bearer on 401 + modal guidance |
| 2025-10-01 | Runtime token enforcement (no build-time secrets) |
| 2025-09-30 | Hybrid storage architecture: local SQLite + timed Azure Files backups |
| 2025-09-30 | Environment / workload profile + timeout & PS5 compatibility fixes |
| 2025-09-30 | Backup route & persistence verification (v0.7.2) |
| 2025-09-28 | Favicon / activity badge system finalized |
| 2025-09-28 | PATCH Add operation fix (Entra compatibility) |
| 2025-09-27 | v0.3.0: Full SCIM 2.0 compliance baseline |

Current Version: v0.10.0 (Prisma 7 + ESLint 10 + Jest 30 + React 19 + Vite 7 + Node 24 Docker)

---

## Status
Production Ready (v0.10.0) — **Phase 1 RFC Compliance complete** (Feb 2026). Full SCIM filter parser (10 operators), POST /.search, ETag conditional requests, attribute projection, centralized error handling. 666 unit tests (19 suites), 184 e2e tests (14 suites), 280 live integration tests, all 24 Microsoft SCIM Validator tests passing + 7 preview. Full tech stack at latest: Prisma 7, ESLint 10, Jest 30, React 19, Vite 7, Node 24.

## Quick Commands
```powershell
# Publish latest image
pwsh ./scripts/publish-acr.ps1 -Registry scimserverpublic -ResourceGroup scimserver-rg -Latest

# Customer update to latest (example)
iex (irm 'https://raw.githubusercontent.com/pranems/SCIMServer/master/scripts/update-scimserver-direct.ps1'); Update-SCIMServerDirect -Version v0.10.0 -ResourceGroup <rg> -AppName <app> -NoPrompt

> NOTE: Direct upgrade one‑liner integrated into UI copy button; user has not yet tested the copied command end‑to‑end.
```

## Project Summary

**Purpose:** SCIM 2.0 server with Microsoft Entra provisioning integration + real-time logging UI

**Key Components:**
- ✅ NestJS SCIM 2.0 server (all operations working)
- ✅ OAuth 2.0 + Bearer token authentication
- ✅ React log viewer UI
- ✅ Dev tunnel integration for public HTTPS
- ✅ Microsoft Entra provisioning compatible

## Single Entry Point

**Main Script:** `setup.ps1`
- Test local: `.\setup.ps1 -TestLocal`
- Start tunnel: `.\setup.ps1 -StartTunnel`
- Clear instructions for Azure Portal setup

**Core Technologies:**
- Node.js 24 & TypeScript 5.9
- NestJS 11 service layer with Prisma 7 ORM (better-sqlite3 driver adapter)
- SQLite (file-backed) for low-volume persistence
- React 19 + Vite 7 frontend
- ESLint 10 (flat config) + Jest 30
- Docker (node:24-alpine) & Azure Container Apps (deployment target)

AI Assist Notes: Microsoft Docs MCP consulted for SCIM spec alignment when needed.

---

## 🔧 Technical Implementation Notes

### Pagination Fix (2025-11-21)
**Problem:** When `hideKeepalive` toggle was enabled, pagination showed incorrect counts and empty pages. Frontend filtered keepalive requests post-fetch, but backend counted all logs including keepalive, causing mismatch (e.g., "Total 1444 • Page 2 / 29" with empty visible results).

**Root Cause:** Backend `count()` included all logs; frontend filtered keepalive after pagination, resulting in:
- Inaccurate `pagination.total` and `pagination.pages`
- Empty pages when all fetched logs were keepalive requests
- Complex frontend workaround with multi-page aggregation (lines 185-230 in ActivityFeed.tsx)

**Solution (Backend-Driven Filtering):**
Implemented TDD approach with comprehensive test coverage:
1. ✅ **Tests First:** Created 9 test scenarios in `activity.controller.spec.ts`
2. ✅ **Backend Implementation:** Added `hideKeepalive` query param to:
   - `activity.controller.ts` - `/admin/activity` endpoint
   - `admin.controller.ts` - `/admin/logs` endpoint
   - `logging.service.ts` - Core logging service
3. ✅ **Prisma WHERE Clause:** Exclude keepalive using inverse logic:
   ```typescript
   OR: [
     { method: { not: 'GET' } },           // Not a GET request
     { identifier: { not: null } },        // Has an identifier
     { status: { gte: 400 } },             // Error status
     { NOT: { url: { contains: '?filter=' } } }  // No filter parameter
   ]
   ```
4. ✅ **Frontend Simplification:**
   - Removed multi-page aggregation workaround from `ActivityFeed.tsx`
   - Removed `visibleItems` useMemo filtering from `App.tsx`
   - Trust backend pagination metadata completely
   - Simplified code by ~50 lines

**Result:**
- ✅ Accurate pagination counts when `hideKeepalive=true`
- ✅ No empty pages - backend returns only non-keepalive logs
- ✅ Cleaner frontend code - trusts backend pagination
- ✅ All 9 tests passing with TDD green phase
- ✅ Works for both Activity Feed and Raw Logs views

---

## Current Focus
Phase 1 complete. Full repo migration from `kayasax` to `pranems` GitHub account done. Documentation overhauled: new Azure Deployment & Usage Guide, rewritten README.md and DEPLOYMENT.md. GitHub Actions CI/CD pipelines (`build-test.yml`, `publish-ghcr.yml`) verified for `pranems/SCIMServer`. VS Code debug configurations added. Next: Phase 2 planning (schema-driven validation), CI test gate improvements, port alignment (live-test defaults to 6000, docker-compose to 3000).

## Next Steps / Backlog
- [x] ✅ COMPLETED - Finalize docs metadata normalization for remaining weak-header files
- [x] ✅ COMPLETED - Migrate all repo references from kayasax to pranems
- [x] ✅ COMPLETED - Create comprehensive Azure Deployment & Usage Guide (docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md)
- [x] ✅ COMPLETED - Rewrite README.md for current project state
- [x] ✅ COMPLETED - Rewrite DEPLOYMENT.md with all deployment methods
- [x] ✅ COMPLETED - Add VS Code debug configurations (.vscode/launch.json)
- [x] ✅ COMPLETED - Verify GitHub Actions workflows point to pranems/scimserver
- [ ] Validate copied direct upgrade command in production environment
- [ ] Send guidance to existing customers on the v0.8.13 direct-update changes and the need to store generated JWT/OAuth secrets
- [ ] Add rollback command generation (capture previous image tag)
- [ ] Expose deployment metadata via API endpoint (optional runtime flexibility)
- [ ] CI checks: version/tag sync, BOM detection, lockfile sync
- [ ] Parameterize backup interval & retention (env + doc)
- [ ] Add release automation (GitHub Action) for drafts on tag push
- [ ] Provide migration helper to rebuild the Container Apps environment when moving to the private VNet baseline
- [ ] Add SCIM duplicate-handling regression tests (POST + PATCH scenarios)
- [ ] Obtain Azure RBAC on target subscription (`providers/read`, `providers/register/action`, `resourceGroups/*`) or switch to a subscription with deploy rights
## 🏗️ Architecture

**SCIM 2.0 Server:**
- NestJS controllers for `/Users`, `/Groups`, `/ServiceProviderConfig`, `/Schemas`
- Full CRUD operations: POST, GET, PUT, PATCH, DELETE
- Prisma + SQLite for data persistence and request logging
- Bearer token + OAuth 2.0 dual authentication

**Web UI:**
- React frontend with theme support (light/dark)
- Real-time log viewer with search, filtering, and detailed inspection
- Upgrade notifications with GitHub release integration
- Admin tools for log management and system monitoring

**Deployment:**
- Docker multi-stage build with proper permissions
- GitHub Container Registry (`ghcr.io/pranems/scimserver`, public, anonymous pull)
- Azure Container Apps for production hosting
- PowerShell automation for customer updates
- Comprehensive deployment guide: `docs/AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md`

## Architecture Snapshot
| Date | Achievement |
|------|-------------|
| 2025-09-27 | ✅ **v0.3.0 Released** - Full SCIM 2.0 compliance + enhanced UX |
| 2025-09-27 | ✅ **Production Deployed** - Azure Container Apps updated with CORS fixes |
| 2025-09-27 | ✅ **Customer Tools** - PowerShell update function tested and working |
| 2025-09-25 | ✅ README.md created with setup & API documentation |
| 2025-09-25 | 🧪 Initial e2e test (Users create/list/get) added |
| 2025-09-25 | ✅ Logs listing endpoint & e2e test added |
| 2025-09-25 | 🎨 Frontend (React + Vite) scaffolded with log viewer |
| 2025-09-25 | 🚀 Log detail modal (headers/bodies + copy) added |
| 2025-09-25 | 🔍 Full‑text search expanded to include headers/bodies |
| 2025-09-25 | 🏷️ Identifier derivation (user/email/group displayName) implemented (ephemeral) |
| 2025-09-25 | ⚙️ Performance optimization: removed large body columns from list query |
| 2025-09-25 | 🧪 Iterated on persisted identifier column (rolled back pending stable client generation) |
| 2025-09-25 | 📉 Reduced log list latency from ~10s to sub‑second in local tests |
| 2025-09-25 | 📚 Added external exposure (tunnel) deployment guidance drafting |
| 2025-09-26 | 🚀 Azure Container Apps deployment successful - SCIM server running in production |
| 2025-09-26 | 🔧 CORS configuration added to enable web client connection to deployed API |
| 2025-09-26 | ✅ Production web UI monitoring working - full end-to-end deployment complete |
| 2025-09-26 | 🎯 **CONTAINERIZED CLIENT IMPLEMENTED** - Single URL for SCIM + Web UI for teams |
| 2025-09-26 | 📦 Complete containerized solution: SCIM API + monitoring UI in one deployment |
| 2025-09-26 | 🔧 **STATIC ASSETS FIX** - Web UI fully functional with proper CSS/JS serving |
| 2025-09-26 | ✅ **FINAL VERIFICATION** - Web UI accessible without authentication, assets working |
| 2025-09-26 | 🔧 **API URL FIX** - Resolved double /scim prefix issue in web client API calls |
| 2025-09-26 | 🎉 **COMPLETE SUCCESS** - Containerized SCIMServer fully functional and ready for teams |
| 2025-09-26 | 🌿 `feature/acr-automation` branch created and pushed to start Azure Container Registry automation work |
| 2025-09-26 | 🆕 Added /scim/admin/version endpoint (backend version reporting) |
| 2025-09-26 | 🔔 Frontend upgrade banner + remote manifest polling (L1+L2) implemented |
| 2025-09-26 | 🧩 Added dynamic upgrade helper script (GitHub Releases based) |
| 2025-09-26 | 🎨 Microsoft-inspired theming completed (dark/light parity, refined filters, log modal polish) |
| 2025-09-26 | 🔍 Admin log noise hidden from UI; SCIM request list now focused on provisioning traffic |
| 2025-12-29 | 🔁 **GITHUB REGISTRY MIGRATION** - Migrated from ACR to ghcr.io/pranems/scimserver with automated builds |
| 2025-12-26 | 🛠️ **UNIFIED DOCKERFILE** - Multi-stage build (web+API) with fixed SQLite permissions |
| 2025-12-26 | 🚀 **CONTAINER DEPLOYMENT** - Production deployment working via public registry |
| 2025-12-26 | 🔧 **SQLITE PERMISSIONS FIX** - Resolved readonly database errors with proper user ownership |
| 2025-12-26 | 📋 **AUTOMATION SCRIPTS** - publish-acr.ps1, tag-and-release.ps1, update-scimserver.ps1 created |
| 2025-12-26 | 🎯 **UPGRADE BANNER COMPLETE** - Compact banner with modal, hosted PowerShell script integration |
| 2025-12-26 | 📖 **ADMIN DOCUMENTATION** - Complete release workflow and user update process documented |


---

## Priorities (Condensed)
Done: Activity parser, Database browser, Hybrid storage, Update automation.
Near-Term:
- WebSocket/live activity feed (optional)
- Identifier column stabilization
- Minimal health/diagnostics endpoint
Deferred:
- Advanced analytics + FTS
- Mobile polish

---

## Dev Quick Ref
Backend: `cd api && npm run start:dev`
Frontend: `cd web && npm run dev`
Unit Tests: `cd api && npm test` (648 tests, 19 suites)
Live Tests: `.\scripts\live-test.ps1` (212 assertions)
Live Tests (verbose): `.\scripts\live-test.ps1 -Verbose`

---

*This file serves as persistent project memory for enhanced AI assistant session continuity with MCP server integration.*
## Key Features (Snapshot)

**SCIM 2.0 Compliance (~95% RFC 7643/7644):**
- Complete CRUD operations (POST, GET, PUT, PATCH, DELETE)
- Microsoft Entra ID provisioning compatible (all 25 validator tests pass)
- ServiceProviderConfig, Schemas, ResourceTypes discovery endpoints
- Full SCIM filter parser: 10 operators (`eq`,`ne`,`co`,`sw`,`ew`,`gt`,`lt`,`ge`,`le`,`pr`) + `and`/`or`/`not` + grouping
- POST /.search for Users and Groups
- ETag / If-None-Match → 304 conditional requests
- `attributes` / `excludedAttributes` projection on all GET and .search endpoints
- PATCH: add/replace/remove, valuePath filter, extension URN, no-path merge, boolean coercion
- Centralized SCIM error handling (`scim-exception.filter.ts`)
- `application/scim+json` content-type on all responses including errors
- Proper filtering, pagination, and error handling

**Monitoring & Debugging:**
- Real-time request/response logging
- Searchable log viewer with detailed inspection
- Admin endpoint filtering (hide non-SCIM traffic)
- Performance optimized (<1s load times)

**User Experience:**
- Light/dark theme support
- Upgrade notifications with GitHub integration
- Footer with credits and version info
- Responsive design for mobile/desktop

**DevOps Ready:**
- Docker containerization with proper permissions
- GitHub Container Registry (`ghcr.io/pranems/scimserver`)
- GitHub Actions CI/CD (`build-test.yml`, `publish-ghcr.yml`)
- One-click customer updates via PowerShell
- Automated CI/CD with GitHub releases
- VS Code debug configurations (launch, attach, log-to-file)

**Performance Insights:**
- Expected request volume is low; focus on clarity of logs over throughput.
- Lightweight SQLite reduces operational overhead while supporting ad-hoc queries.
- Microsoft docs MCP confirmed Entra request patterns to optimize initial test coverage.
- Removing large text columns from primary list query yields major latency reduction.
- Persisting identifiers removes need to parse bodies repeatedly (final integration pending).
- Potential future improvements: FTS5 virtual table for deep search, cursor pagination, optional gzip.

**Known Constraints:**
- Must stay compliant with Microsoft Entra SCIM validator scenarios.
- Deployment must remain low-cost and easily reproducible for Microsoft engineers (Docker + optional ACA).
- Single-user admin workflow; no RBAC planned for MVP.
- Sensitive payload data retained in logs by design; rely on manual purge for case isolation.
- Rely on Microsoft docs MCP for authoritative SCIM updates; monitor for spec changes.
- Identifier persistence currently best-effort; older rows may lack derived names until backfilled.

---

## TODO (Lean)
[-] Investigate lighter framework (Fastify) for image size (deferred)
[ ] Health/diagnostics endpoint
[ ] Optional WebSocket live updates
[ ] Identifier persistence finalization/backfill
[ ] Consider distroless base image

---
*Condensed: older verbose narrative & future-dated/hallucinated entries removed for clarity.*