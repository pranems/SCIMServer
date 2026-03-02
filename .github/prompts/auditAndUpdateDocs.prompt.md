---
name: auditAndUpdateDocs
description: Audit all project docs, JSONs, and artifacts for staleness and update them to match current repo state with full norms.
argument-hint: Optional scope like a feature name (e.g. "G8g"), doc file path, or "all" for full audit.
---

Perform a comprehensive documentation freshness audit across the entire project. For every doc, JSON artifact, and explanatory resource, verify it reflects the **current** codebase state and update anything stale. This is a **generic, project-wide** prompt — not scoped to a single feature.

---

## Step 1 — Gather Current State

1. **Read project context**: Read `Session_starter.md`, `docs/CONTEXT_INSTRUCTIONS.md`, `docs/INDEX.md`, `docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md`, `CHANGELOG.md`, and `package.json` to capture the current version, feature set, test counts, and flag inventory.
2. **Scan implementation**: List all source files in `api/src/modules/` to identify controllers, services, DTOs, guards, interceptors, repositories, and utilities that may have changed since docs were last written.
3. **Scan tests**: Enumerate `*.spec.ts`, `*.e2e-spec.ts`, and `scripts/live-test.ps1` sections for current test counts and coverage scope.
4. **Scan artifacts**: Check `docs/openapi/`, `docs/postman/`, `docs/insomnia/`, `docs/examples/` for API artifacts that may reference outdated routes, payloads, or schemas.
5. **Read Prisma schema**: `api/prisma/schema.prisma` for current data model, models, and relationships.

---

## Step 2 — Audit Each Document Category

For every document listed in `docs/INDEX.md`, check:

### A. Feature & Phase Docs
(e.g., `G8B_*.md`, `G8C_*.md`, `G8E_*.md`, `G8F_*.md`, `G8G_*.md`, `G11_*.md`, `P2_*.md`, `READONLY_*.md`, `PHASE_09_*.md`, `PHASE_10_*.md`, `PHASE_12_*.md`, `phases/*.md`)

| Check | What to verify |
|-------|----------------|
| **Version tag** | Does the `Version:` in the header match `package.json`? |
| **Test counts** | Do Unit/E2E/Live test count tables match actual spec files? |
| **Files Changed** | Does the "Files Changed" table list the correct current file paths? |
| **Code snippets** | Do embedded code snippets match the actual implementation? |
| **Architecture diagrams** | Do Mermaid/ASCII diagrams reflect the current flow? |
| **API examples** | Do request/response JSON samples match actual server behavior? |
| **Related docs links** | Are cross-references still valid (no renamed/deleted targets)? |

### B. Reference & Config Docs
(e.g., `ENDPOINT_CONFIG_FLAGS_REFERENCE.md`, `COMPLETE_API_REFERENCE.md`, `SCIM_COMPLIANCE.md`)

| Check | What to verify |
|-------|----------------|
| **Flag list completeness** | Are all flags from `endpoint-config.interface.ts` listed? |
| **Default values** | Do documented defaults match code? |
| **Applicability matrix** | Does each flag's scope (POST/PUT/PATCH/DELETE/GET) match implementation? |
| **Flag interaction table** | Are all known flag combinations documented? |
| **Request/response examples** | Headers, URLs, bodies, status codes accurate? |
| **Entra ID recommended config** | Still valid for latest features? |

### C. Architecture & Design Docs
(e.g., `TECHNICAL_DESIGN_DOCUMENT.md`, `USER_API_CALL_TRACE.md`, `MULTI_ENDPOINT_GUIDE.md`)

| Check | What to verify |
|-------|----------------|
| **Layer diagrams** | Do they reflect current Transport → API → Service → Domain → Persistence layers? |
| **Module inventory** | Are all NestJS modules listed? |
| **Prisma model names** | Match current `schema.prisma`? |
| **Dependency versions** | Node, NestJS, Prisma, TypeScript, Jest, PostgreSQL versions current? |

### D. Testing & Validation Docs
(e.g., `LIVE_TEST_NORMS_AND_BEST_PRACTICES.md`, `TESTING-WORKFLOW.md`, `COLLISION-TESTING-GUIDE.md`)

| Check | What to verify |
|-------|----------------|
| **Test counts** | Match actual `unit-results.json`, `e2e-results.json`, and live-test assertion count? |
| **Test file lists** | Are all spec files mentioned? Any missing new ones? |
| **Live-test section list** | Does it match actual sections in `scripts/live-test.ps1`? |
| **Example commands** | Are npm scripts, docker commands, and PowerShell invocations still correct? |

### E. API Artifacts
(e.g., `docs/openapi/*.yaml`, `docs/postman/*.json`, `docs/insomnia/*.json`, `docs/examples/*.json`)

| Check | What to verify |
|-------|----------------|
| **Routes** | All current endpoints listed? Any new routes from Bulk, Custom Resource Types, Admin API missing? |
| **Schema definitions** | Do JSON schemas match current DTOs and response shapes? |
| **Headers** | `Content-Type: application/scim+json`, auth patterns, `If-Match`/`If-None-Match` documented? |
| **Example payloads** | Do sample request/response bodies match current server output? |

### F. Session & Context Files
(e.g., `Session_starter.md`, `docs/CONTEXT_INSTRUCTIONS.md`, `docs/PROJECT_HEALTH_AND_STATS.md`)

| Check | What to verify |
|-------|----------------|
| **Version** | Matches `package.json` |
| **Test counts** | Match latest run results |
| **Feature list** | All implemented features/phases listed |
| **Open gaps** | Remaining gaps list is current |
| **Stack versions** | Node, NestJS, Prisma, TS, Jest versions current |

### G. Deployment & Infra Docs
(e.g., `DEPLOYMENT.md`, `DOCKER_GUIDE_AND_TEST_REPORT.md`, `AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md`)

| Check | What to verify |
|-------|----------------|
| **Dockerfile references** | Do they match actual Dockerfile, Dockerfile.optimized, Dockerfile.ultra? |
| **Environment variables** | All required env vars documented? |
| **Bicep templates** | Match `infra/*.bicep` files? |
| **Port numbers** | Correct for local (6000), Docker (8080), Azure? |

---

## Step 3 — Documentation Norms (Mandatory for All Updates)

Every updated or new doc section **MUST** include the following where applicable:

### Diagrams & Flows
- **Mermaid diagrams** for architecture, data flows, decision trees, and sequence flows
- **ASCII art** for inline flow summaries in code-adjacent contexts
- **Decision flow diagrams** for flag resolution, error handling, and branching logic

### Request/Response Examples
- **Full HTTP request**: method, URL (with query params), headers (`Content-Type`, `Authorization`, `If-Match`), body (JSON with `schemas` array)
- **Full HTTP response**: status code, headers (`ETag`, `Location`), body (JSON with `id`, `meta`, `schemas`)
- **Error responses**: SCIM error format with `status`, `scimType`, `detail`
- **Multiple examples** per feature: success case, error case, edge case

### JSON Examples
```json
// Example: Request body for POST /Users
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "jdoe@example.com",
  "displayName": "John Doe",
  "active": true,
  "emails": [{ "value": "jdoe@example.com", "type": "work", "primary": true }]
}
```

```json
// Example: SCIM Error Response (409 Conflict)
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "409",
  "scimType": "uniqueness",
  "detail": "A user with userName 'jdoe@example.com' already exists."
}
```

### Tables
- **Test coverage tables** with `#`, `Test`, `Validates` columns (unit, E2E, live)
- **Flag applicability matrices** with operations as columns
- **Files Changed** tables with `File` and `Change` columns
- **Before/After** comparison tables for behavioral changes

### Cross-References
- Link to related docs, source files, and RFC sections
- Use relative paths from `docs/` directory
- Link to test files for verification

---

## Step 4 — Apply Updates

For each stale item found:

1. **Update in-place**: Edit the existing document — do NOT create new files unless a genuinely new topic needs its own doc.
2. **Preserve structure**: Keep the existing document layout; add/update sections as needed.
3. **Update `docs/INDEX.md`**: If any new docs were created or descriptions changed, update the index.
4. **Update version/date headers**: Bump `Last Updated` and `Version` fields in doc headers.
5. **Update `CHANGELOG.md`**: Note documentation updates in the current version entry.
6. **Update `Session_starter.md`**: Reflect documentation freshness status.

---

## Step 5 — Verify Cross-Consistency

After all updates, perform a final cross-check:

1. **Version consistency**: `package.json` version matches all doc headers, `CHANGELOG.md`, `Session_starter.md`, and `CONTEXT_INSTRUCTIONS.md`.
2. **Test count consistency**: Unit, E2E, and live counts match across all documents that reference them.
3. **Flag count consistency**: All docs that reference "14 boolean flags" or list flag names are in sync with `endpoint-config.interface.ts` (currently 14 boolean + logLevel = 15 total config flags).
4. **Link validation**: All `[text](path)` links in docs resolve to existing files.
5. **Index completeness**: Every doc in `docs/` has an entry in `docs/INDEX.md`.

---

## Step 6 — Self-Update This Prompt

After completing the audit, review **this prompt itself** for freshness:

1. **New document categories**: If new types of docs (e.g., performance benchmarks, security audit docs) were added to the project, add a new sub-section under Step 2.
2. **New artifact directories**: If new artifact folders beyond `openapi/`, `postman/`, `insomnia/`, `examples/` were created, add them to Section E.
3. **New config flags**: If the flag count changed from 14 boolean + logLevel (15 total), update all references in this prompt.
4. **New documentation norms**: If the team adopted new standards (e.g., ADR format, PlantUML, Swagger UI), add them to Step 3.
5. **Retired docs**: If any docs listed in this prompt were deleted or merged, remove references.
6. **New context files**: If new session/context files were introduced, add them to Section F.
7. **Port/URL changes**: If default ports or deployment URLs changed, update Section G.

Apply updates directly to this file (`.github/prompts/auditAndUpdateDocs.prompt.md`) so future runs remain accurate.

---

## Standing Rules

- Follow the project's Feature/Bug-Fix Commit Checklist from `.github/copilot-instructions.md`.
- Do NOT create new documentation files unless a genuinely new topic requires one.
- Prefer updating existing docs over creating new ones.
- All Mermaid diagrams must be valid syntax (test with a renderer if possible).
- JSON examples must be valid JSON (no trailing commas, proper quoting).
- Every numeric claim (test counts, flag counts, LoC) must be freshly measured — never copy from stale docs.
- Use the `updateProjectHealth` prompt for full stats refresh if `PROJECT_HEALTH_AND_STATS.md` is significantly stale.
