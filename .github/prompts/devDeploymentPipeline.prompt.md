---
mode: agent
description: End-to-end dev deployment pipeline (every gate, every prompt, no skip). Builds Docker image from current sources, runs full validation across all form factors, publishes to GHCR + ACR, deploys to dev preserving DB + endpoints + IDs, runs full live SCIM + Playwright UI suites against dev, adds tests for any observation/new-change/new-functionality/new-fix, fixes issues, re-loops until all green. After dev is green, hands off to operator for explicit prod promotion.
tools: ['runCommands', 'edit', 'codebase', 'search', 'changes']
---

# Dev Deployment Pipeline - Authoritative End-to-End Gate Walk

This prompt is the **mandatory** orchestrator for every full dev deployment of SCIMServer. It walks **every stage and every gate** in [`.github/copilot-instructions.md`](../copilot-instructions.md) **Stages 0 → 6** in order, then runs the deploy + post-deploy live + UI verification suites, then offers prod promotion only on explicit operator approval.

## Non-negotiable invocation rule

When the operator asks to "deploy to dev", "prepare for prod", "run full validation", "test on the latest deployment", "do the full pipeline", or any equivalent phrase, the agent MUST:
1. Run `pwsh -NoProfile -File scripts/dev-deployment-pipeline.ps1` (full mode, no `-Skip*` flags), OR walk every numbered step in this prompt manually with a per-step PASS / FAIL / SKIPPED-with-reason row in a report file under `test-results/dev-deploy-<timestamp>.md`.
2. NEVER claim "validation complete" or "dev is green" without an explicit per-gate result. Aggregated phrases ("all tests passed") are insufficient.
3. NEVER promote the customer-facing prod (calmsand) without an explicit confirmation message from the operator (see Section 8 below). The same-tenant parallel prod (proudbush) MAY be auto-canaried via `-AutoCanary` (Stage 6.5) under guardrails; calmsand always stays behind the manual gate, and its ingress is flipped only after proudbush proves the flow.

## Standing rule: Playwright coverage for every observation, new change, new functionality, new fix

Whenever the agent observes a UI behavior - including a bug, a new feature, a fix, a regression, a workaround, a flow change, or any user-visible delta - it MUST add or update a Playwright spec under `web/e2e/` that exercises that behavior end-to-end through the browser **before** the work is considered complete. This rule applies to:

- New routes, pages, tabs, drawers, modals, dialogs
- New buttons, links, form fields, validation messages
- New error states, empty states, loading states, retry behaviors
- New keyboard shortcuts, command palette commands, accessibility flows
- Fixed bugs (spec must reproduce the bug as a regression test)
- Behavioral changes to existing flows (update existing spec)
- Combination flows (multi-step user journeys spanning ≥ 2 pages)

The spec MUST be runnable via `npx playwright test --reporter=line` against:
1. Local dev server (`http://localhost:4000`)
2. Local Docker compose (`http://localhost:8080`)
3. Azure dev (`E2E_BASE_URL=https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io`, `E2E_TOKEN=changeme-scim`)

A change that ships without its Playwright spec is incomplete. Stage 5.3 below fails the gate if any new behavior in the commit lacks Playwright coverage.

## Pipeline stages (ALL run; none optional except as marked)

### Stage 0 - Pre-flight + state capture (≤ 60 s)

0.1. Verify prerequisites: `git`, `npm`, `node`, `docker`, `az`, `gh` on PATH.
0.2. `git status` clean (working tree); no uncommitted changes (untracked files OK but reported).
0.3. `git log --oneline -1` - record current SHA in the report.
0.4. `docker version` - daemon up.
0.5. `az account show` - Azure auth valid.
0.6. Capture **before-deploy** state of dev:
   - Container App image + tag + digest
   - Endpoint count: `GET /scim/admin/endpoints?count=200` (record names + IDs)
   - User counts per endpoint
   - Group counts per endpoint
   - Write to `test-results/dev-before-<SHA>.json`

### Stage 1 - Local static gates

1.1. **API tsc build** (`cd api; npm run build`) - exit 0, zero errors.
1.2. **API ESLint** (`cd api; npm run lint`) - 0 errors. Warnings ≤ baseline (v0.52.x = 465); flag any increase.
1.3. **Web tsc --noEmit** (`cd web; npx tsc --noEmit`) - total errors ≤ baseline (96 = 87 test / 9 prod). Prod errors MUST NOT increase.
1.4. **Web ESLint** (`cd web; npx eslint src`) when `web/eslint.config.mjs` exists; otherwise SKIPPED-no-config.
1.5. **Web prod build** (`cd web; npm run build`) - exit 0.
1.6. **Web size-limit** (`cd web; npm run size`) - all budgets pass. **If any budget fails, the gate fails.** No "pre-existing baseline" excuse - fix the config or fix the bundle.
1.7. `bundleBudgetAudit` - every new lazy route under `web/src/routes/` has a `size-limit` entry in `web/package.json`.
1.8. `prismaMigrationAudit` - when `api/prisma/` is touched, schema + migrations + InMemory repos in lockstep.

### Stage 2 - Local test gates

2.1. **API unit jest** (`cd api; npm test`) - capture pass/fail counts. Default env (no `PERSISTENCE_BACKEND` override).
2.2. **API E2E jest** (`cd api; npm run test:e2e`) - needs PostgreSQL on `localhost:5432` (user=scim, pass=scim, db=scimdb). Orchestrator starts a `postgres:17` container if not already running.
2.3. **Web vitest** (`cd web; npm test`) - capture pass/fail counts.
2.4. **Web vitest coverage gate** (`cd web; npm run test:coverage`) - meets ratchet floors: lines:78 / branches:70 / functions:65 / statements:75. Floor never lowers; raise when feasible.
2.5. `crossBackendParityAudit` - for any changed file matching `isInMemoryBackend`, both backends behave identically.
2.6. **`scripts/test-all-modes.ps1`** - full 6-mode matrix (api-unit-prisma, api-unit-inmemory, api-e2e-prisma, api-e2e-inmemory, web vitest, web a11y). This is **the** orchestrator; running individual jest commands does NOT substitute for this gate.

### Stage 3 - Audit prompts (Stages 3a / 3b / 3c run in order)

#### 3a - Test-completeness

3a.1. `addMissingTests` - for **every** change in the diff (use `git diff origin/master..HEAD --name-only`), inventory: unit test exists? E2E test exists? Live `scripts/live-test.ps1` test section exists? **Playwright spec exists?** Add what's missing.
3a.2. `apiContractVerification` - every response key matches the documented allowlist; no internal `_`-prefixed fields leaked.
3a.3. `error-handling-verification` - every error path has HTTP status + SCIM `scimType` keyword + structured diagnostics envelope; smart-error-explainer surfaces them.

#### 3b - Cross-cutting

3b.1. `logging-verification` - correct level + category, PII redacted, requestId propagated, slow-request thresholds honored.
3b.2. `auditAgainstRFC` - RFC 7643 (Schema) + RFC 7644 (Protocol) compliance.
3b.3. `endpointConfigFlagAudit` - 10-cell completeness when flag changes (registry + default + validator + enforcement + tests-per-layer + doc + UI Switch + UI test).
3b.4. `securityAudit` - auth, secrets, input validation, output PII, OWASP Top 10 coverage.
3b.5. `dependencyCveSweep` - `npm audit` over `api/` + `web/`; Critical/High blocks; Moderate tracked. Runs on every commit and weekly.
3b.6. `performanceBenchmark` - p50/p95/p99 latency + DB query count per request + memory headroom; regression > 10% requires explicit justification.

#### 3c - Code hygiene + docs

3c.1. `codeReviewSelfAudit` - SOLID / DRY / readability of CHANGED files only.
3c.2. `auditAndUpdateDocs` - sweep `docs/INDEX.md` + `Session_starter.md` + `docs/CONTEXT_INSTRUCTIONS.md` + `CHANGELOG.md` + `README.md` + every feature doc that references test counts / version / commit SHA / behavior the change touches.

### Stage 4 - Build, publish, deploy

4.1. **Docker compose build + live tests** (`pwsh scripts/full-validation-pipeline.ps1 -SkipLocal`) - clean rebuild, compose up, `scripts/live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret <docker-oauth>`. Must be ≥ baseline (currently 1,027 passing).
4.2. **Tag + push to ACR** - `docker tag scimserver-api acrscimserver20622.azurecr.io/scimserver:<SHA>` and `:latest`; `az acr login --name acrscimserver20622`; `docker push <SHA>` and `docker push latest`.
4.3. **Tag + push to GHCR (public path)** - `gh workflow run publish-ghcr.yml -f version=<version-from-package-json> -f pushLatest=true`. Wait for green via `gh run watch`.
4.4. **Verify anonymous GHCR pull** - `docker logout ghcr.io && docker pull ghcr.io/pranems/scimserver:latest` (proves the public local-run path).
4.5. **Live test the public local-run path** - `docker run -d --name scim-public-verify -p 3000:8080 -e PERSISTENCE_BACKEND=inmemory ... ghcr.io/pranems/scimserver:latest` + `scripts/live-test.ps1 -BaseUrl http://localhost:3000 -ClientSecret <test-oauth>`. Cleanup after.
4.6. **Deploy to dev** - `az containerapp update -n scimserver-dev -g scimserver-dev --image <chosen-registry>/scimserver:<SHA> --revision-suffix v<SHA>`. Wait for new revision Healthy + 100% traffic + pod hostname reflects new revision.
4.7. **Live SCIM tests vs dev** - `scripts/live-test.ps1 -BaseUrl https://scimserver-dev... -ClientSecret changeme-oauth`. Must be ≥ Stage 4.1 baseline.

### Stage 5 - UI gates (mandatory; no "I'll do it next time")

5.1. `uiTestAndValidation` - full vitest + a11y + visual sanity pass.
5.2. `playwrightSpecHygieneAudit` - delete stale specs (specs targeting deleted Phase I components: `raw-logs`, `manual-provision`, `database-browser`, `app-shell`, `activity-feed`, `live-data-verification`, `new-ui`). Run BEFORE 5.3 so the signal is trustworthy.
5.3. **Playwright vs dev** - `cd web; $env:E2E_BASE_URL='https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'; $env:E2E_TOKEN='changeme-scim'; npx playwright test --reporter=line`. **All currently-shipped UI flows must pass.** Failures fall into:
   - **Stale spec** → delete it (cite as Stage 5.2 finding)
   - **Real UI regression** → fix code, re-loop entire pipeline
   - **Flaky test** → not allowed; either stabilize the test or delete it
5.4. **Playwright spec gap-fill** (per the standing "Always add Playwright for new" rule): for every change in the diff that touches `web/src/`, confirm a Playwright spec exercises the new/changed UI surface end-to-end through the browser. Add specs for any gap; re-run 5.3 until green.
5.5. **Browser binary sync** - `npx playwright install` when prompted by version drift.

### Stage 6 - Commit hygiene + post-deploy verification

6.1. **After-deploy state capture** - repeat the Stage 0.6 inventory and diff against `test-results/dev-before-<SHA>.json`. Report:
   - Endpoint count delta (should be 0; non-zero requires explicit justification)
   - Per-endpoint user count delta
   - Per-endpoint group count delta
   - ID-stability check: every endpoint/user/group ID present before is present after
6.2. **Version bump** if any `api/src/` or `web/src/` changed. Bump both `api/package.json` + `web/package.json`. Regenerate lockfiles in `node:24-alpine` for cross-platform reproducibility.
6.3. **`CHANGELOG.md` entry** - explicit before/after test counts per layer (API unit, API E2E, Web vitest, Web vitest coverage thresholds, Live SCIM, Playwright, PowerShell contract), version delta, files-changed summary, per-stage gate result, deploy SHA + image digest.
6.4. **`Session_starter.md` + `docs/CONTEXT_INSTRUCTIONS.md`** updates - latest test counts, version, achievement row.
6.5. **Atomic commits** - separate commits for: (a) test additions/fixes, (b) production code changes, (c) doc updates, (d) version bumps. Never combine in one commit. Always `git commit -m "..."` (never `--amend` on pushed commits, never `--no-verify`).

### Stage 6.5 - Auto-canary to parallel prod (proudbush, same tenant)

Runs ONLY when `dev-deployment-pipeline.ps1 -AutoCanary` is passed AND `-SkipDeploy` is not. This auto-promotes the dev-validated image to the **same-tenant parallel prod (proudbush)** as a true blue/green canary. The customer-facing prod (calmsand) is NEVER touched here.

6.5.1. **Guardrails (any one blocks the canary, falls back to the manual Stage 7 path):**
   - interim FAIL count > 0
   - interim SKIPPED count > 0 (a clean run is required)
   - change-freeze file `scripts/.deploy-freeze` present
   - kill switch env `SCIMSERVER_AUTOCANARY_DISABLE` set
6.5.2. **Before-snapshot** - capture proudbush live inventory via `verify-deployment.ps1 -SnapshotOnly -Label scimserver-before`.
6.5.3. **Blue/green promote + verify** - `promote-to-prod.ps1 -ProdResourceGroup scimserver-prod -ProdAppName scimserver -ImageTag <SHA> -BlueGreen -RunVerification -VerifyPlaywright` (fed `yes` non-interactively). This pins blue by name, creates green at 0%, soaks the `--green` label FQDN, runs `verify-deployment.ps1` (live SCIM + Playwright + data/ID before-after diff) on green, flips to green only on pass, re-verifies the public FQDN, and auto-rolls-back on any failure. Customers stay on blue throughout the soak.
6.5.4. **Result** - PASS on `promote-to-prod` exit 0; FAIL otherwise (green is already rolled back, blue untouched). A FAIL here does NOT auto-fix - surface it and stop before calmsand.

### Stage 7 - Operator handoff for prod (customer-facing calmsand)

**Canary-first invariant:** calmsand's ingress is flipped ONLY after the proudbush canary (Stage 6.5, or a manual proudbush blue/green) has been proven green with full verification. Never roll the ingress change to calmsand before it has been seen working on proudbush.

7.1. Surface a clear summary:
   - Image promoted to dev: `<registry>/scimserver:<SHA>` (digest `sha256:...`)
   - Dev live SCIM: `<pass>/<total>` in `<elapsed>s`
   - Dev Playwright: `<pass>/<total>` in `<elapsed>s` (across `<spec-count>` specs)
   - Dev data integrity: `<endpoints>` endpoints / `<users>` users / `<groups>` groups, **0 changes**, **0 ID changes**
   - Proudbush canary (if Stage 6.5 ran): blue/green flip + verification result
   - Gap list (every SKIPPED or FAIL gate with reason)
7.2. **Ask the operator** for explicit `promote to prod` confirmation for calmsand. NEVER auto-promote calmsand. (Proudbush MAY have been auto-canaried in Stage 6.5; calmsand always stays behind this manual gate.)
7.3. If proudbush was NOT already canaried (no `-AutoCanary`), promote it FIRST as the canary, then calmsand. Both use true blue/green (`-BlueGreen -RunVerification -VerifyPlaywright`), each in its own `az` tenant context:
   - **Parallel prod canary (proudbush, ProvIAM tenant) - FIRST:** `az account set --subscription ProvIAM_Subscription` then `pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-prod -ProdAppName scimserver -ImageTag <SHA> -BlueGreen -RunVerification -VerifyPlaywright`.
   - **Customer-facing prod (calmsand, separate AnandSa-Test-150 tenant) - ONLY after proudbush is green + operator go-ahead:** the image MUST be on GHCR first (calmsand pulls anonymously from GHCR, not the ProvIAM ACR). Re-auth: `az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950` then `az account set --subscription AnandSa-Test-150`, then `pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-rg-prod -ProdAppName scimserver-prod -ImageTag <SHA> -Subscription AnandSa-Test-150 -BlueGreen -RunVerification -VerifyPlaywright` (explicit `-ImageTag` is REQUIRED - the dev app is in the other tenant).
   - Image swap only; prod DB / endpoints / IDs preserved on both. `-BlueGreen` keeps customers on blue until green passes verification.
7.4. `promote-to-prod.ps1 -RunVerification` already runs live SCIM + Playwright + data diff on green and post-flip; no separate re-run needed. (Legacy auto-flip without `-BlueGreen` still requires a manual Stage 4.7 + 5.3 re-run.)
7.5. Blue/green rollback is instant (traffic flip back to blue, which stays warm). The script auto-rolls-back on verification failure and prints the exact `az containerapp ingress traffic set` command. Any non-zero data delta on prod is a P0 incident.

## Report structure (mandatory)

For every full pipeline run, write a structured report at `test-results/dev-deploy-<YYYY-MM-DD-HHmmss>.md`:

```markdown
# Dev Deployment Pipeline Run

- **Commit:** <SHA> (<branch>)
- **Started:** <ISO-8601>
- **Operator:** <git user.name>
- **Image target:** <registry>/scimserver:<tag>

## Stage results

| Stage | Gate | Status | Detail | Duration |
|---|---|---|---|---|
| 1.1 | API tsc build | PASS | 0 errors | 3.6s |
| 1.6 | Web size-limit | FAIL | entry chunk 380 kB / 200 kB | - |
| ... | ... | ... | ... | ... |

## Data integrity

- Before: <N> endpoints / <M> users / <K> groups
- After:  <N> endpoints / <M> users / <K> groups
- Delta:  +0 / +0 / +0
- ID changes: 0

## Playwright gap analysis

| Changed file | Existing spec | Added spec | Notes |
|---|---|---|---|

## Issues opened during run

(every fix, every new spec added, every doc updated)
```

## Anti-patterns this prompt prevents

- **"All tests passed"** without a per-gate row → REJECTED.
- **Skipping Stage 5.3** because Playwright is slow → REJECTED.
- **Skipping Stage 2.6** because individual jest commands "covered it" → REJECTED.
- **"Pre-existing baseline failure, deploy as is"** for Stage 1.6 → REJECTED; either fix config or fix bundle.
- **Auto-promote to prod** without explicit operator confirmation → REJECTED.
- **Single mega-commit** for code + tests + docs + version bump → REJECTED; atomic commits.
- **Shipping a UI change without a Playwright spec** → REJECTED (standing "always add Playwright" rule).

## See also

- [`.github/copilot-instructions.md`](../copilot-instructions.md) - Stage 0-6 authoritative gate strategy.
- [`scripts/dev-deployment-pipeline.ps1`](../../scripts/dev-deployment-pipeline.ps1) - the runnable orchestrator that implements this prompt.
- [`scripts/run-all-gates.ps1`](../../scripts/run-all-gates.ps1) - generic Stage 0-6 walker (used internally by dev-deployment-pipeline.ps1 for the gate phases).
- [`scripts/full-validation-pipeline.ps1`](../../scripts/full-validation-pipeline.ps1) - local + Docker compose validation (used internally for Stage 4.1).
- [`scripts/promote-to-prod.ps1`](../../scripts/promote-to-prod.ps1) - prod image swap (Stage 7.3).
- [`scripts/live-test.ps1`](../../scripts/live-test.ps1) - live SCIM contract suite (Stages 4.1, 4.5, 4.7, 7.4).
