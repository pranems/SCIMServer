---
name: deployAndPromote
description: End-to-end deployment pipeline - publish image, deploy to dev, run live tests. Prod promotion is separate and only on explicit user request.
argument-hint: "dev" (default - deploy to dev + live tests), "prod" (promote to prod - ONLY when user explicitly requests), or a specific version tag like "0.41.0".
---

Automate the full build-deploy-verify cycle. Replaces the current manual 3-step dance (publish-ghcr.yml -> az containerapp update -> live-test.ps1).

**IMPORTANT:** Prod promotion is NEVER automatic. Phase 4 (Promote to Prod) only runs when the user explicitly passes "prod" as argument or explicitly asks for promotion. Default behavior is dev-only.

---

## Environment Topology

| Environment | Resource Group | Container App | FQDN | PG Server |
|-------------|---------------|---------------|------|-----------|
| **Dev** | `scimserver-rg-dev` | `scimserver-dev` | `scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io` | `scimserver-dev-pg` |
| **Prod** | `scimserver-rg` | `scimserver2` | `scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io` | `scimserver2-pg` |

## Credentials (same for dev and prod)

| Secret | Value |
|--------|-------|
| SCIM_SHARED_SECRET | `changeme-scim` |
| JWT_SECRET | `changeme-jwt` |
| OAUTH_CLIENT_SECRET | `changeme-oauth` |
| OAUTH_CLIENT_ID | `scimserver-client` |
| PG admin password | `ScimP0stgres@2026` |

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
   az containerapp update --name scimserver-dev --resource-group scimserver-rg-dev `
     --image "ghcr.io/pranems/scimserver:<tag>" `
     --revision-suffix "v<tag-short>-$(Get-Date -Format 'HHmm')" --output none
   ```
2. Wait 90s for startup probe to pass
3. Health check:
   ```powershell
   Invoke-RestMethod -Uri "https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io/scim/health"
   ```
4. Run full live tests:
   ```powershell
   .\scripts\live-test.ps1 -BaseUrl "https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io" -ClientSecret "changeme-oauth"
   ```
5. **Gate**: If live tests have ANY failures, STOP. Do not proceed to prod.
6. Report: "Dev deployment validated: X/Y tests passed"

---

## Phase 4 - Promote to Prod (only if argument is "prod" or "full")

1. Run the promote script:
   ```powershell
   .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -DevResourceGroup "scimserver-rg-dev" -ProdAppName "scimserver2"
   ```
   - This resolves the immutable digest and pins it
   - Requires interactive "yes" confirmation
2. Wait for health check (the script does this automatically)
3. Run live tests against prod:
   ```powershell
   .\scripts\live-test.ps1 -BaseUrl "https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io" -ClientSecret "changeme-oauth"
   ```
4. Report: "Prod promotion validated: X/Y tests passed"
5. Print rollback command:
   ```
   az containerapp update -n scimserver2 -g scimserver-rg --image ghcr.io/pranems/scimserver:<previous-tag>
   ```

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
| Promote to prod | PASS/SKIP | Xs |
| Prod live tests | X/Y PASS/SKIP | Xs |

**Image:** ghcr.io/pranems/scimserver:<tag>
**Digest:** sha256:...
**Rollback:** az containerapp update -n scimserver2 -g scimserver-rg --image ghcr.io/pranems/scimserver:<previous>
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
