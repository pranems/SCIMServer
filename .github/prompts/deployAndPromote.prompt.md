---
name: deployAndPromote
description: End-to-end deployment pipeline - publish image, deploy to dev, run live tests. Prod promotion is separate and only on explicit user request.
argument-hint: "dev" (default - deploy to dev + live tests), "prod" (promote to prod - ONLY when user explicitly requests), or a specific version tag like "0.41.0".
---

Automate the full build-deploy-verify cycle. Replaces the current manual 3-step dance (publish-ghcr.yml -> az containerapp update -> live-test.ps1).

**IMPORTANT:** Customer-facing prod (calmsand) promotion is NEVER automatic. Phase 4b only runs when the user explicitly passes "prod" / asks for promotion AND has given a go-ahead after the proudbush canary is green. Default behavior is dev-only.

**AUTO-CANARY EXCEPTION:** The parallel prod (proudbush, SAME tenant as dev) MAY be promoted automatically as a blue/green canary by `dev-deployment-pipeline.ps1 -AutoCanary` (Stage 6.5), guarded by zero-FAIL / zero-SKIPPED / no change-freeze / kill-switch checks. This is the canary the operator does not worry about traffic on. calmsand always stays behind an explicit manual gate.

---

## Environment Topology

> Authoritative source is the **Deployment Topology** section of [`.github/copilot-instructions.md`](../copilot-instructions.md). Keep this table in lockstep with it.

There are TWO live prod instances (kept in lockstep, same image per promotion) + one dev.

| Environment | Subscription / Tenant | Resource Group | Container App | FQDN | Registry |
|-------------|----------------------|---------------|---------------|------|----------|
| **Dev** | `ProvIAM_Subscription` (tenant `f08e6aff-...`) | `scimserver-dev` | `scimserver-dev` | `scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io` | ACR `acrscimserver20622.azurecr.io` + GHCR |
| **Prod (parallel, proudbush)** | `ProvIAM_Subscription` (tenant `f08e6aff-...`) | `scimserver-prod` | `scimserver` | `scimserver.proudbush-ae90986e.eastus.azurecontainerapps.io` | ACR + GHCR |
| **Prod (CUSTOMER-FACING, calmsand)** | `AnandSa-Test-150` (**separate tenant**) | `scimserver-rg-prod` | `scimserver-prod` | `scimserver-prod.calmsand-7f4fc5dc.centralus.azurecontainerapps.io` | GHCR `ghcr.io/pranems/scimserver` (anonymous pull) |

**CROSS-TENANT WARNING:** The customer-facing prod (calmsand) is in a DIFFERENT Azure AD tenant than dev + parallel prod. You cannot promote both in one `az` session - re-auth between them. Calmsand cannot pull from the ProvIAM-tenant ACR, which is why it uses anonymous GHCR; the image MUST be on GHCR (`publish-ghcr.yml`) before a calmsand promotion.

## Credentials (same for dev and both prods)

| Secret | Value |
|--------|-------|
| SCIM_SHARED_SECRET (E2E_TOKEN) | `changeme-scim` |
| JWT_SECRET | `changeme-jwt` |
| OAUTH_CLIENT_SECRET | `changeme-oauth` |
| OAUTH_CLIENT_ID | `scimserver-client` |

---

## Phase 1 - Pre-Flight Checks

1. Verify Azure CLI is logged in: `az account show`
2. Verify `gh` CLI is authenticated: `gh auth status`
3. Read current version from `api/package.json`
4. Check git status - warn if uncommitted changes exist
5. Verify unit tests pass: `npx jest --silent` (3,538+ expected)

---

## Phase 2 - Publish Image

1. Determine image tag:
   - If user provided a version, use it
   - Otherwise, read from `api/package.json` and append a patch bump
2. Trigger the publish workflow:
   ```powershell
   gh workflow run "publish-ghcr.yml" -f version="<tag>" -f pushLatest="true"
   ```
3. Wait for workflow completion (poll every 15s):
   ```powershell
   gh run list --workflow="publish-ghcr.yml" --limit 1
   ```
4. Verify the image exists:
   ```powershell
   docker pull ghcr.io/pranems/scimserver:<tag>
   docker run --rm ghcr.io/pranems/scimserver:<tag> ls /app/dist/main.js
   ```

---

## Phase 3 - Deploy to Dev

1. Update dev Container App image:
   ```powershell
   az containerapp update --name scimserver-dev --resource-group scimserver-dev `
     --image "ghcr.io/pranems/scimserver:<tag>" `
     --revision-suffix "v<tag-short>-$(Get-Date -Format 'HHmm')" --output none
   ```
2. Wait 90s for startup probe to pass
3. Health check:
   ```powershell
   Invoke-RestMethod -Uri "https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io/scim/health"
   ```
4. Run full live tests:
   ```powershell
   .\scripts\live-test.ps1 -BaseUrl "https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io" -ClientSecret "changeme-oauth"
   ```
5. **Gate**: If live tests have ANY failures, STOP. Do not proceed to prod.
6. Report: "Dev deployment validated: X/Y tests passed"

---

## Phase 4 - Promote to Prod (only if argument is "prod" or "full")

**CANARY-FIRST ORDERING (mandatory):** Always promote the parallel prod (proudbush, same tenant as dev) FIRST as a canary, prove it green with full verification, and ONLY THEN promote the customer-facing prod (calmsand). Never flip calmsand's ingress before the same flow has been proven on proudbush. The two prods are in DIFFERENT tenants, so each gets its own `az` context.

### True blue/green (default for prod promotes)

Use `-BlueGreen` on `promote-to-prod.ps1`. It: (1) pins 100% traffic to the current revision by NAME (switches off `latestRevision` auto-routing), (2) creates the new revision (green) at 0% weight, (3) soaks the green `--green` label FQDN health, (4) runs `verify-deployment.ps1` against green (live SCIM + Playwright + data/ID before-after diff), (5) flips traffic green=100/blue=0 only after green passes, (6) re-verifies the public FQDN, and auto-rolls-back to blue on ANY failure. Customers stay on blue the entire soak.

### 4a - Parallel prod canary (proudbush, ProvIAM tenant) - ALWAYS FIRST

1. Ensure ProvIAM context: `az account set --subscription ProvIAM_Subscription`
2. (Optional rehearsal) dry-run the plan with zero changes: add `-DryRun`.
3. Run the blue/green promote with full verification:
   ```powershell
   .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-prod" -ProdAppName "scimserver" -ImageTag "<tag>" -BlueGreen -RunVerification -VerifyPlaywright
   ```
   - Resolves the immutable digest and pins it; requires interactive "yes".
   - `-RunVerification -VerifyPlaywright` runs `verify-deployment.ps1` (live + browser + data diff) on green before the flip.
4. **Gate:** If proudbush blue/green did not reach a green flip, STOP. Do NOT touch calmsand.

### 4b - Customer-facing prod (calmsand, separate AnandSa-Test-150 tenant) - ONLY after 4a is green + explicit operator go-ahead

1. **Re-auth into the AnandSa tenant** (different tenant - cannot reuse the ProvIAM session):
   ```powershell
   az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950
   az account set --subscription AnandSa-Test-150
   ```
2. Confirm the image is on GHCR (calmsand pulls anonymously from GHCR, not ACR). If only ACR has it, run `publish-ghcr.yml` first.
3. Run the blue/green promote (explicit `-ImageTag` is REQUIRED - the dev app is in the other tenant):
   ```powershell
   .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg-prod" -ProdAppName "scimserver-prod" -ImageTag "<tag>" -Subscription "AnandSa-Test-150" -BlueGreen -RunVerification -VerifyPlaywright
   ```

### 4c - Report + rollback

4. Report: \"Prod promotion validated: proudbush X/Y, calmsand X/Y tests passed\"\n5. Blue/green rollback is instant (traffic flip back to blue; blue revision stays warm):
   ```\n   az containerapp ingress traffic set -n scimserver -g scimserver-prod --revision-weight <blue-revision>=100 <green-revision>=0\n   az containerapp ingress traffic set -n scimserver-prod -g scimserver-rg-prod --revision-weight <blue-revision>=100 <green-revision>=0\n   ```\n   (`promote-to-prod.ps1 -BlueGreen` auto-rolls-back on any verification failure and prints the exact revision names.)

---

## Phase 5 - Summary

Output a deployment report:

```
## Deployment Report - <date>

| Step | Status | Duration |
|------|--------|----------|
| Publish <tag> | PASS | Xs |
| Deploy to dev | PASS | Xs |
| Dev live tests | X/Y PASS | Xs |
| Promote proudbush prod | PASS/SKIP | Xs |
| Promote calmsand prod | PASS/SKIP | Xs |
| Prod live tests (both) | X/Y PASS/SKIP | Xs |

**Image:** ghcr.io/pranems/scimserver:<tag>
**Digest:** sha256:...
**Rollback (proudbush):** az containerapp update -n scimserver -g scimserver-prod --image ghcr.io/pranems/scimserver:<previous>
**Rollback (calmsand):** az containerapp update -n scimserver-prod -g scimserver-rg-prod --image ghcr.io/pranems/scimserver:<previous>
```

---

## Self-Improvement

After each deployment, append:
- Deployment duration per phase
- Any issues encountered (health probe delays, credential mismatches, etc.)
- Topology changes (new FQDNs, renamed apps, etc.)

<!-- Deployment History -->
<!-- | Date | Version | Dev Tests | Prod Tests | Duration | Issues | -->
<!-- (populated after first run) -->
