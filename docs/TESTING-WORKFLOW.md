# 🧪 Testing Pre-Release Changes

> **Status**: Living workflow guide  
> **Last Updated**: February 18, 2026  
> **Baseline**: SCIMServer v0.10.0

This guide explains how to test new features before releasing them to production users.

---

## 🎯 Goals

- ✅ Test changes in real Azure Container App environment
- ✅ Push to GitHub Container Registry without affecting other users
- ✅ No update notifications triggered for production users
- ✅ Easy rollback if issues found

---

## 📋 Workflow Overview

```
1. Create feature branch
   ↓
2. Make changes, commit, push
   ↓
3. GitHub Actions builds test image (test-branch-name tag)
   ↓
4. Deploy test image to YOUR Container App
   ↓
5. Test & verify
   ↓
6. If good → merge to master → create release tag → production build
   If bad → fix, push again (rebuilds test image)
```

---

## 🚀 Quick Start

### Step 1: Push to Test Branch

Create a branch with specific prefix to trigger test build:

```powershell
git checkout -b test/collision-ui-improvements
# OR
git checkout -b dev/pagination-fix
# OR
git checkout -b feature/diff-view
```

Make your changes, then:

```powershell
git add .
git commit -m "feat: add collision testing guide"
git push origin test/collision-ui-improvements
```

**GitHub Actions automatically builds** and pushes image as:
- `ghcr.io/pranems/scimserver:test-collision-ui-improvements`
- `ghcr.io/pranems/scimserver:sha-abc123def`

### Step 2: Deploy Test Image to Your Environment

**Option A - Auto-discover (easiest):**
```powershell
.\scripts\test-update.ps1
```

**Option B - Specify app:**
```powershell
.\scripts\test-update.ps1 -ResourceGroup "scimserver-rg" -AppName "scimserver-app-1234"
```

**Option C - Test specific tag:**
```powershell
.\scripts\test-update.ps1 -TestTag "test-collision-ui-improvements"
```

### Step 3: Test & Verify

1. Open your app URL: `https://your-app.azurecontainerapps.io`
2. Test the new features
3. Check Activity Feed, Manual Provision, etc.
4. Monitor logs:
   ```powershell
   az containerapp logs show -n scimserver-app-1234 -g scimserver-rg --tail 50 --follow
   ```

### Step 4: Iterate or Release

**If issues found:**
```powershell
# Fix the code
git add .
git commit -m "fix: handle edge case"
git push origin test/collision-ui-improvements
# Wait for GitHub Actions to rebuild
.\scripts\test-update.ps1  # Deploy again
```

**If all good:**
```powershell
# Merge to master
git checkout master
git merge test/collision-ui-improvements
git push origin master

# Bump version
# Edit api/package.json and web/package.json: "version": "0.10.0"
git add api/package.json web/package.json
git commit -m "chore: bump version to 0.10.0"
git push

# Create release tag (triggers production build with 'latest' tag)
git tag -a v0.10.0 -m "v0.10.0 - Runtime + logging + docs refresh"
git push origin v0.10.0

# Create GitHub Release (triggers update notifications)
# Go to: https://github.com/pranems/SCIMServer/releases/new
```

---

## 🔧 Advanced Usage

### Manual Workflow Trigger

Instead of pushing a branch, trigger build manually:

1. Go to: https://github.com/pranems/SCIMServer/actions/workflows/build-test.yml
2. Click "Run workflow"
3. Enter test tag suffix (e.g., "manual-test")
4. Builds as: `ghcr.io/pranems/scimserver:test-manual-test`

### Create Test Revision (A/B Testing)

Deploy test version alongside production without replacing it:

```powershell
.\scripts\test-update.ps1 -TestTag "test-diff-view" -CreateRevision
```

This creates a new revision with 0% traffic. To test:
- Traffic splitting: Route X% to test revision
- Direct revision URL: Get specific revision URL from Azure Portal

To rollback:
```powershell
az containerapp revision deactivate -n scimserver-app -g scimserver-rg --revision <test-revision-name>
```

### Rollback to Production

```powershell
.\scripts\test-update.ps1 -TestTag "latest"
```

Or specific version:
```powershell
.\.scripts\test-update.ps1 -TestTag "0.10.0"
```

---

## 📊 GitHub Actions Workflows

### `build-test.yml` (Test Images)
**Trigger:** Push to `test/**`, `dev/**`, `feature/**` branches or manual
**Tags:** `test-<branch-name>`, `sha-<commit-hash>`
**Purpose:** Testing before release
**Does NOT tag:** `latest` (no update notifications)

### `build-and-push.yml` (Production Release)
**Trigger:** Push tag matching `v*` (e.g., `v0.10.0`)
**Tags:** `0.10.0`, `0.10`, `latest`
**Purpose:** Official releases
**Does tag:** `latest` (triggers update notifications)

### `publish-ghcr.yml` (Manual Build)
**Trigger:** Manual workflow dispatch
**Tags:** Specified version + `sha-<commit>`
**Purpose:** Emergency builds, hotfixes
**Optional:** Can tag as `latest`

---

## 🎓 Best Practices

### Branch Naming
✅ **Good:**
- `test/collision-guide`
- `dev/pagination-fix`
- `feature/diff-view`

❌ **Avoid:**
- `main`, `master` (reserved for production)
- Random names without prefix (won't trigger test build)

### Testing Checklist
- [ ] Lint passes (`cd api && npm run lint`) — 0 errors expected (48 warnings OK)
- [ ] Backend compiles (`cd api && npm run build`)
- [ ] Frontend compiles (`cd web && npm run build`)
- [ ] Unit tests pass (`cd api && npm test`) — 648 unit tests (19 suites)
- [ ] Live integration tests pass (`.\scripts\live-test.ps1`) — 212 assertions
- [ ] Live tests pass in verbose mode (`.\scripts\live-test.ps1 -Verbose`) — intercepted API output
- [ ] Local testing done (if possible)
- [ ] Test image deployed to Azure
- [ ] Manual testing in real environment
- [ ] Logs checked for errors
- [ ] Database operations verified

---

## 🧪 Live Test Script — Multi-Environment Usage

The live test script (`scripts/live-test.ps1`) runs 212+ integration assertions against a running SCIMServer instance. It supports any deployment target via CLI parameters.

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-BaseUrl` | `http://localhost:6000` | Full URL of the running SCIMServer (no trailing slash) |
| `-ClientId` | `scimserver-client` | OAuth `client_id` — must match the server's `OAUTH_CLIENT_ID` env var |
| `-ClientSecret` | `changeme-oauth` | OAuth `client_secret` — must match the server's `OAUTH_CLIENT_SECRET` env var |
| `-Verbose` | off | Print full HTTP request/response bodies for debugging |

### Scenario 1: Local Development (ts-node-dev)

Start the server from the `api/` directory, then run tests. In dev mode, if `OAUTH_CLIENT_SECRET` is not set, a random secret is auto-generated and printed to the console — copy it into `-ClientSecret`.

```powershell
# Terminal 1 — start server
cd api
$env:PORT = 6000
npx ts-node-dev --respawn --transpile-only src/main.ts

# Terminal 2 — run tests (use the auto-generated secret from server output)
.\scripts\live-test.ps1
# Or with a known secret:
$env:OAUTH_CLIENT_SECRET = "changeme-oauth"   # set on server side
.\scripts\live-test.ps1 -ClientSecret "changeme-oauth"
```

### Scenario 2: Local Docker Container

```powershell
# Run container with a known OAuth secret
docker run -d -p 8080:8080 -e OAUTH_CLIENT_SECRET=mysecret ghcr.io/pranems/scimserver:latest

# Run tests against Docker
.\scripts\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "mysecret"
```

### Scenario 3: Azure Container App

The secret must match `OAUTH_CLIENT_SECRET` configured in the Container App environment variables (set during deployment via Bicep or `az containerapp update`).

```powershell
# If deployed with OAUTH_CLIENT_SECRET=changeme-oauth (default for testing):
.\scripts\live-test.ps1 `
    -BaseUrl "https://scimserver-app.prouddune-131ec58e.eastus.azurecontainerapps.io" `
    -ClientSecret "changeme-oauth"

# If deployed with a custom secret:
.\scripts\live-test.ps1 `
    -BaseUrl "https://myapp.eastus.azurecontainerapps.io" `
    -ClientSecret "my-production-secret-here"
```

To update the secret on an existing Azure deployment:
```powershell
az containerapp update --name scimserver-app --resource-group scimserver-rg `
    --set-env-vars "OAUTH_CLIENT_SECRET=changeme-oauth"
```

### Scenario 4: Remote / CI Pipeline

```powershell
# Use environment variables instead of inline secrets
$env:LIVE_TEST_URL = "https://staging.example.com"
$env:LIVE_TEST_SECRET = "ci-secret-from-keyvault"

.\scripts\live-test.ps1 `
    -BaseUrl $env:LIVE_TEST_URL `
    -ClientSecret $env:LIVE_TEST_SECRET `
    -Verbose
```

### Scenario 5: Custom OAuth Client ID

If the server has `OAUTH_CLIENT_ID` set to something other than the default:

```powershell
.\scripts\live-test.ps1 `
    -BaseUrl http://localhost:6000 `
    -ClientId "my-custom-client" `
    -ClientSecret "my-custom-secret"
```

### Server-Side Environment Variables (Reference)

These env vars on the **server** determine what credentials the live test script needs:

| Server Env Var | Default | Maps to Script Param |
|----------------|---------|---------------------|
| `OAUTH_CLIENT_ID` | `scimserver-client` | `-ClientId` |
| `OAUTH_CLIENT_SECRET` | auto-generated (dev) / required (prod) | `-ClientSecret` |
| `PORT` | `3000` | Affects `-BaseUrl` port |
| `API_PREFIX` | `scim` | Hardcoded in test URLs as `/scim/` |

---

### Version Bumping
- **Patch** (0.10.0 → 0.10.1): Bug fixes, small improvements
- **Minor** (0.10.0 → 0.11.0): New features, non-breaking changes
- **Major** (0.10.0 → 1.0.0): Breaking changes, major redesign

---

## 🔍 Troubleshooting

### Test image not built
**Check:**
1. Branch name has correct prefix (`test/`, `dev/`, `feature/`)
2. GitHub Actions tab: https://github.com/pranems/SCIMServer/actions
3. Workflow run completed successfully

### Update fails with "image not found"
**Fix:**
1. Verify image exists: https://github.com/pranems/SCIMServer/pkgs/container/scimserver
2. Check image is public (or configure GHCR credentials)
3. Wait for GitHub Actions to finish building

### App doesn't start after update
**Debug:**
```powershell
# Check logs
az containerapp logs show -n <app-name> -g <rg> --tail 100

# Check revision status
az containerapp revision list -n <app-name> -g <rg> -o table

# Rollback
.\scripts\test-update.ps1 -TestTag "latest"
```

### Changes not visible after update
1. Hard refresh browser (Ctrl+Shift+R)
2. Check deployed image tag matches expected:
   ```powershell
   az containerapp show -n <app-name> -g <rg> --query "properties.template.containers[0].image"
   ```
3. Verify revision is running:
   ```powershell
   az containerapp revision list -n <app-name> -g <rg>
   ```

---

## 📚 Related Documentation

- [admin.md](../admin.md) - Full release workflow
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Azure deployment details
- [GitHub Actions Docs](https://docs.github.com/en/actions)

---

**Last Updated:** February 2026 | **Version:** 0.10.0
