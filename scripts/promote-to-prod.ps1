<#
.SYNOPSIS
    Promote a tested dev image to the production SCIMServer deployment.

.DESCRIPTION
    After validating a new version in the dev environment (separate resource group),
    this script updates the production Container App to use the same (tested) image tag.

    Workflow:
      1. Reads the currently running image tag from the dev Container App
      2. Optionally runs live tests against dev to confirm readiness
      3. Updates the production Container App image to the dev-validated tag
      4. Verifies the production deployment is healthy

    This is a safe, zero-downtime operation - Azure Container Apps performs a rolling
    update with health probes ensuring the new revision is ready before routing traffic.

.PARAMETER ProdResourceGroup
    Resource group containing the production Container App.

.PARAMETER ProdAppName
    Production Container App name (default: auto-detected from the resource group).

.PARAMETER DevResourceGroup
    Resource group containing the dev Container App.

.PARAMETER DevAppName
    Dev Container App name (default: scimserver-dev).

.PARAMETER ImageTag
    Explicit image tag to promote. If omitted, reads from the dev Container App.

.PARAMETER SkipDevVerification
    Skip the pre-promotion health check on the dev instance.

.PARAMETER SkipProdVerification
    Skip the post-promotion health check on the production instance.

.PARAMETER ProdScimSecret
    SCIM shared secret for the production instance (for health verification).
    Falls back to deployment state cache if available.

.PARAMETER Subscription
    Azure subscription to switch to before promoting. REQUIRED when promoting the
    customer-facing (calmsand) prod, which lives in the separate `AnandSa-Test-150`
    tenant. When scripts/az-tenant.ps1 is present, the matching isolated CLI profile
    is selected automatically and (if scripts/setup-deploy-sp.ps1 has been run) login
    is non-interactive via a deployment service principal - no `az login` per promote.

.PARAMETER AzureConfigDir
    Explicit AZURE_CONFIG_DIR (isolated az CLI profile) to use for this run. Normally
    you do not need this - it is derived from -Subscription via scripts/az-tenant.ps1.

.PARAMETER DeviceCode
    Use the device-code login flow if an interactive sign-in is needed (default is
    the normal browser popup).

.PARAMETER BlueGreen
    Perform a TRUE blue/green deploy: pin the current (blue) revision at 100%
    traffic, bring up the new (green) revision at 0%, smoke-test + fully verify
    green on its private label FQDN while customers stay on blue, then flip
    100% traffic to green only if verification passes. On any failure the green
    revision is deactivated and blue is never moved (zero customer impact).

    Without this switch the script falls back to the legacy auto-flip behavior
    (Container Apps latestRevision routing shifts traffic to the new revision as
    soon as it is healthy - there is no 0% soak).

.PARAMETER RunVerification
    After the green revision is healthy (and before the traffic flip when
    -BlueGreen is set), run the full verification cycle via
    scripts/verify-deployment.ps1: live SCIM suite + data/ID before-and-after
    inventory diff (+ Playwright when -VerifyPlaywright is set) against the
    target FQDN. A non-zero data delta or a failed suite ABORTS the flip.

.PARAMETER VerifyPlaywright
    Include the Playwright browser verification cycle in -RunVerification.
    Requires the web/ workspace and `npx playwright` to be available.

.PARAMETER DryRun
    Print the blue/green plan (ingress mode switch, green revision, traffic
    weights, flip) without mutating the Container App. Use to rehearse the
    flow before touching a live instance.

.EXAMPLE
    # Promote whatever is running in dev to prod
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -DevResourceGroup "scimserver-rg-dev"

.EXAMPLE
    # Promote a specific version
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -ImageTag "0.37.0"

.EXAMPLE
    # Parallel prod (proudbush, ProvIAM tenant) - TRUE blue/green with full verification
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-prod" -ProdAppName "scimserver" -ImageTag "0.52.3" -BlueGreen -RunVerification -VerifyPlaywright

.EXAMPLE
    # Rehearse the blue/green flow against proudbush without mutating it
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-prod" -ProdAppName "scimserver" -ImageTag "0.52.3" -BlueGreen -DryRun

.EXAMPLE
    # Parallel prod (proudbush, ProvIAM tenant) - legacy auto-flip
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-prod" -ProdAppName "scimserver" -ImageTag "0.52.3"

.EXAMPLE
    # Customer-facing prod (calmsand, separate AnandSa-Test-150 tenant)
    # Run `az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950` first.
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg-prod" -ProdAppName "scimserver-prod" -ImageTag "0.52.3" -Subscription "AnandSa-Test-150"

.EXAMPLE
    # Quick promotion (skip all verification)
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -ImageTag "0.37.0" -SkipDevVerification -SkipProdVerification
#>

param(
    [Parameter(Mandatory)]
    [string]$ProdResourceGroup,
    [string]$ProdAppName,
    [string]$DevResourceGroup,
    [string]$DevAppName = 'scimserver-dev',
    [string]$ImageTag,
    [string]$Subscription,
    [string]$AzureConfigDir,
    [switch]$DeviceCode,
    [switch]$BlueGreen,
    [switch]$RunVerification,
    [switch]$VerifyPlaywright,
    [switch]$DryRun,
    [switch]$SkipDevVerification,
    [switch]$SkipProdVerification,
    [string]$ProdScimSecret,
    [string]$ProdClientSecret = 'changeme-oauth'
)

$ErrorActionPreference = 'Stop'

Write-Host "" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  SCIMServer - Promote to Production" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# --- Cross-tenant authentication ---
# The two prod instances live in DIFFERENT Azure AD tenants:
#   - Dev + parallel prod (proudbush, app 'scimserver') -> ProvIAM_Subscription
#   - Customer-facing prod (calmsand, app 'scimserver-prod') -> AnandSa-Test-150 (separate tenant)
# You cannot hold both in one ~/.azure cache, so scripts/az-tenant.ps1 keeps each
# tenant in its own isolated profile (AZURE_CONFIG_DIR) and signs in non-interactively
# via a deployment service principal once scripts/setup-deploy-sp.ps1 has been run.
# The helper is optional - if it is absent we fall back to the legacy az-account check.
$azHelper = Join-Path $PSScriptRoot 'az-tenant.ps1'
if (Test-Path $azHelper) { . $azHelper }

if ($AzureConfigDir) { $env:AZURE_CONFIG_DIR = $AzureConfigDir }

if (Get-Command Connect-ScimTenant -ErrorAction SilentlyContinue) {
    # Default to ProvIAM (dev + proudbush) when no -Subscription is given; calmsand
    # promotion always passes -Subscription AnandSa-Test-150.
    $targetSub = if ($Subscription) { $Subscription } else { 'ProvIAM_Subscription' }
    $account = Connect-ScimTenant -Subscription $targetSub -DeviceCode:$DeviceCode
    if (-not $account) {
        Write-Host "❌ Could not authenticate to '$targetSub'." -ForegroundColor Red
        Write-Host "   Run '. ./scripts/az-tenant.ps1; Show-ScimDeployStatus' to inspect, or" -ForegroundColor Yellow
        Write-Host "   'pwsh scripts/setup-deploy-sp.ps1' to bootstrap non-interactive login." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "✅ Azure CLI: $($account.user.name) ($($account.name), tenant $($account.tenantId))" -ForegroundColor Green
} else {
    # --- Legacy path (helper not present) ---
    try {
        $account = az account show --output json 2>$null | ConvertFrom-Json
        if (-not $account) { throw "not logged in" }
        Write-Host "✅ Azure CLI: $($account.user.name) ($($account.name))" -ForegroundColor Green
    } catch {
        Write-Host "❌ Azure CLI not authenticated. Run: az login" -ForegroundColor Red
        exit 1
    }
    if ($Subscription) {
        Write-Host "🔁 Setting active subscription to '$Subscription'..." -ForegroundColor Cyan
        az account set --subscription $Subscription 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Could not switch to subscription '$Subscription'." -ForegroundColor Red
            Write-Host "   If this is the customer-facing (calmsand / AnandSa-Test-150) prod in a separate tenant," -ForegroundColor Yellow
            Write-Host "   run 'az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950' first, then re-run this script." -ForegroundColor Yellow
            exit 1
        }
        $account = az account show --output json 2>$null | ConvertFrom-Json
        Write-Host "   ✅ Active subscription: $($account.name) (tenant $($account.tenantId))" -ForegroundColor Green
    }
}

# When promoting the customer-facing (calmsand) prod, the dev app lives in a DIFFERENT
# tenant and is unreachable from this az context - so an explicit -ImageTag is required.
if ($ProdAppName -eq 'scimserver-prod' -and -not $ImageTag) {
    Write-Host "❌ Promoting the customer-facing (calmsand) prod requires an explicit -ImageTag." -ForegroundColor Red
    Write-Host "   The dev app is in the ProvIAM tenant and cannot be read from the AnandSa context." -ForegroundColor Yellow
    Write-Host "   Example: -ImageTag 0.52.3 -Subscription AnandSa-Test-150" -ForegroundColor Yellow
    exit 1
}

# --- Auto-detect prod Container App if not specified ---
if (-not $ProdAppName) {
    $prodApps = az resource list --resource-group $ProdResourceGroup `
        --resource-type "Microsoft.App/containerApps" `
        --query "[].name" --output json --only-show-errors 2>$null | ConvertFrom-Json

    if (-not $prodApps -or $prodApps.Count -eq 0) {
        Write-Host "❌ No Container Apps found in '$ProdResourceGroup'" -ForegroundColor Red
        exit 1
    }

    if ($prodApps.Count -eq 1) {
        $ProdAppName = $prodApps[0]
        Write-Host "📦 Auto-detected prod app: $ProdAppName" -ForegroundColor Green
    } else {
        Write-Host "Multiple Container Apps found in '$ProdResourceGroup':" -ForegroundColor Yellow
        $prodApps | ForEach-Object { Write-Host "   • $_" -ForegroundColor White }
        $ProdAppName = Read-Host "Enter the production Container App name"
        if ([string]::IsNullOrWhiteSpace($ProdAppName)) {
            Write-Host "❌ App name is required." -ForegroundColor Red
            exit 1
        }
    }
}

# --- Determine image tag to promote ---
if (-not $ImageTag) {
    if (-not $DevResourceGroup) {
        $DevResourceGroup = "$ProdResourceGroup-dev"
        Write-Host "📋 Using default dev RG: $DevResourceGroup" -ForegroundColor Gray
    }

    Write-Host "🔍 Reading current image from dev app '$DevAppName' in '$DevResourceGroup'..." -ForegroundColor Cyan
    $devImage = az containerapp show --name $DevAppName --resource-group $DevResourceGroup `
        --query "properties.template.containers[0].image" --output tsv 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($devImage)) {
        Write-Host "❌ Could not read dev container image. Is '$DevAppName' deployed in '$DevResourceGroup'?" -ForegroundColor Red
        exit 1
    }

    # Extract tag from full image path (e.g. ghcr.io/pranems/scimserver:0.37.0 → 0.37.0)
    if ($devImage -match ':([^:]+)$') {
        $ImageTag = $Matches[1]
    } else {
        $ImageTag = 'latest'
    }

    Write-Host "   Dev image: $devImage" -ForegroundColor Gray
    Write-Host "   Promoting tag: $ImageTag" -ForegroundColor Yellow
}

# --- Pre-promotion: verify dev instance is healthy ---
if (-not $SkipDevVerification -and $DevResourceGroup) {
    Write-Host ""
    Write-Host "🔍 Step 1/3: Verifying dev instance health..." -ForegroundColor Cyan

    $devFqdn = az containerapp show --name $DevAppName --resource-group $DevResourceGroup `
        --query "properties.configuration.ingress.fqdn" --output tsv 2>$null

    if ($devFqdn) {
        $devHealthUrl = "https://$devFqdn/scim/health"
        try {
            $null = Invoke-RestMethod -Uri $devHealthUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
            Write-Host "   ✅ Dev instance healthy: $devHealthUrl" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️  Dev instance health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "   Continue anyway? (y/N)" -ForegroundColor Yellow
            $continue = Read-Host
            if ($continue -ne 'y' -and $continue -ne 'Y') {
                Write-Host "❌ Promotion cancelled." -ForegroundColor Red
                exit 1
            }
        }
    } else {
        Write-Host "   ⚠️  Could not retrieve dev FQDN - skipping health check" -ForegroundColor Yellow
    }
} else {
    Write-Host "⏭️  Step 1/3: Dev verification skipped" -ForegroundColor Gray
}

# --- Read current prod state ---
Write-Host ""
Write-Host "🔍 Step 2/3: Updating production image..." -ForegroundColor Cyan

$prodImage = az containerapp show --name $ProdAppName --resource-group $ProdResourceGroup `
    --query "properties.template.containers[0].image" --output tsv 2>$null

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($prodImage)) {
    Write-Host "❌ Could not read production container image. Is '$ProdAppName' deployed in '$ProdResourceGroup'?" -ForegroundColor Red
    exit 1
}

# OPS-2: Resolve immutable SHA-256 digest BEFORE the swap, so prod is pinned
# to the exact bytes that were verified in dev. A re-pushed tag cannot silently
# change prod after this point. Without this, a `:tag` pin lets the registry
# replace the image content under our feet.
$tagRef = "ghcr.io/pranems/scimserver:$ImageTag"
Write-Host "🔍 Resolving immutable digest for $tagRef ..." -ForegroundColor Cyan
$digestOutput = docker buildx imagetools inspect $tagRef 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to resolve digest from registry." -ForegroundColor Red
    Write-Host $digestOutput -ForegroundColor Red
    Write-Host "   Hint: docker login ghcr.io may be required for private images." -ForegroundColor Yellow
    exit 1
}
# Output line looks like: "Digest:    sha256:abc123..."
$devDigest = $null
foreach ($line in $digestOutput) {
    if ($line -match '^Digest:\s+(sha256:[0-9a-f]+)') {
        $devDigest = $Matches[1]
        break
    }
}
if ([string]::IsNullOrWhiteSpace($devDigest)) {
    Write-Host "❌ Could not parse digest from buildx output. Refusing to promote with mutable tag." -ForegroundColor Red
    Write-Host $digestOutput -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Resolved digest: $devDigest" -ForegroundColor Green

$desiredImage = "ghcr.io/pranems/scimserver@$devDigest"

Write-Host "   Current prod image: $prodImage" -ForegroundColor Gray
Write-Host "   Desired prod image: $desiredImage" -ForegroundColor Yellow
Write-Host "   Pinned via immutable digest: $devDigest" -ForegroundColor Gray

# Determine the image actually being SERVED (the highest-traffic active revision),
# not just the app template image. After a blue/green ABORT the app template can be
# the desired image (it was set when the green revision was created) while traffic
# is still pinned to the old blue revision and the green revision was deactivated.
# A template-only check would wrongly short-circuit and never complete the flip.
$servingRevName = $null
$servingImage = $null
try {
    $trafficJson = az containerapp ingress traffic show --name $ProdAppName --resource-group $ProdResourceGroup -o json 2>$null | ConvertFrom-Json
    $topRev = $trafficJson | Sort-Object -Property weight -Descending | Select-Object -First 1
    if ($topRev -and $topRev.revisionName) {
        $servingRevName = $topRev.revisionName
        $servingImage = az containerapp revision show --name $ProdAppName --resource-group $ProdResourceGroup `
            --revision $servingRevName --query "properties.template.containers[0].image" -o tsv 2>$null
    }
} catch { }
# Fallback to the template image when traffic is in latestRevision mode (no explicit
# revisionName) - there the template IS the served image, preserving original behavior.
if ([string]::IsNullOrWhiteSpace($servingImage)) { $servingImage = $prodImage }
if ($servingRevName) {
    Write-Host "   Currently serving:  $servingImage (revision $servingRevName)" -ForegroundColor Gray
}

if ($servingImage -eq $desiredImage) {
    Write-Host "   ✅ Production already SERVING $ImageTag at $devDigest - nothing to do." -ForegroundColor Green
    exit 0
}

# --- Resolve prod FQDN (needed by both paths) ---
$prodFqdn = az containerapp show --name $ProdAppName --resource-group $ProdResourceGroup `
    --query "properties.configuration.ingress.fqdn" --output tsv 2>$null
if ([string]::IsNullOrWhiteSpace($prodFqdn)) {
    Write-Host "❌ Could not resolve prod FQDN for '$ProdAppName'." -ForegroundColor Red
    exit 1
}

# --- Confirm ---
Write-Host ""
if ($BlueGreen) {
    Write-Host "⚠️  This will TRUE blue/green deploy to PRODUCTION:" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  This will update PRODUCTION (legacy auto-flip):" -ForegroundColor Yellow
}
Write-Host "   $ProdAppName ($ProdResourceGroup)" -ForegroundColor White
Write-Host "   $prodImage -> $desiredImage" -ForegroundColor White
Write-Host ""

if ($DryRun) {
    Write-Host "🧪 DRY-RUN - planned actions (no mutations):" -ForegroundColor Cyan
    if ($BlueGreen) {
        Write-Host "   1. Switch '$ProdAppName' to multiple-revision mode" -ForegroundColor Gray
        Write-Host "   2. Pin 100% traffic to current (blue) revision by name" -ForegroundColor Gray
        Write-Host "   3. Create green revision with $desiredImage at 0% traffic" -ForegroundColor Gray
        Write-Host "   4. Add 'green' label -> https://$($ProdAppName)---green.$($prodFqdn -replace "^$([regex]::Escape($ProdAppName))\.", '')/scim/health" -ForegroundColor Gray
        Write-Host "   5. Health + (if -RunVerification) full verify green while blue serves 100%" -ForegroundColor Gray
        Write-Host "   6. Flip 100% traffic to green ONLY if verification passes" -ForegroundColor Gray
        Write-Host "   7. On any failure: deactivate green, blue stays 100% (zero customer impact)" -ForegroundColor Gray
    } else {
        Write-Host "   1. az containerapp update --image $desiredImage --revision-suffix green-<ts>" -ForegroundColor Gray
        Write-Host "   2. latestRevision routing auto-shifts traffic when healthy" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "✅ DRY-RUN complete - nothing was changed." -ForegroundColor Green
    exit 0
}

$confirm = Read-Host "Type 'yes' to proceed"
if ($confirm -ne 'yes') {
    Write-Host "❌ Promotion cancelled." -ForegroundColor Red
    exit 1
}

$greenSuffix = "green-$(Get-Date -Format 'MMdd-HHmm')"
$greenRevision = "$ProdAppName--$greenSuffix"
$repoRoot = Split-Path -Parent $PSScriptRoot
$verifyScript = Join-Path $repoRoot 'scripts/verify-deployment.ps1'

if (-not $BlueGreen) {
    # =====================================================================
    # LEGACY auto-flip path (no 0% soak; latestRevision routing).
    # =====================================================================
    Write-Host ""
    Write-Host "🚀 Step 3: Auto-flip deployment to production..." -ForegroundColor Cyan
    $updateOutput = az containerapp update `
        --name $ProdAppName `
        --resource-group $ProdResourceGroup `
        --image $desiredImage `
        --revision-suffix $greenSuffix `
        --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to create new revision" -ForegroundColor Red
        Write-Host $updateOutput -ForegroundColor Red
        exit 1
    }
    Write-Host "   ✅ Revision created: $greenRevision" -ForegroundColor Green

    Write-Host ""
    Write-Host "🔍 Step 4: Verifying new revision health..." -ForegroundColor Cyan
    $maxAttempts = 12
    $delaySeconds = 10
    $newHealthy = $false
    $prodHealthUrl = "https://$prodFqdn/scim/health"
    for ($i = 1; $i -le $maxAttempts; $i++) {
        Start-Sleep -Seconds $delaySeconds
        try {
            $healthResp = Invoke-RestMethod -Uri $prodHealthUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
            if ($healthResp.status -eq 'ok') {
                Write-Host "   ✅ New revision healthy (attempt $i/$maxAttempts)" -ForegroundColor Green
                $newHealthy = $true
                break
            }
        } catch {
            Write-Host "   Waiting for new revision... (attempt $i/$maxAttempts)" -ForegroundColor Gray
        }
    }
    if (-not $newHealthy -and -not $SkipProdVerification) {
        Write-Host "   ⚠️  New revision health check did not pass within $($maxAttempts * $delaySeconds)s" -ForegroundColor Yellow
        Write-Host "   Logs: az containerapp logs show -n $ProdAppName -g $ProdResourceGroup --type console --revision $greenRevision --tail 50" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  ✅ Promotion Complete (auto-flip)" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "   Production: $ProdAppName ($ProdResourceGroup)" -ForegroundColor White
    Write-Host "   Image:      $desiredImage" -ForegroundColor White
    Write-Host "   Revision:   $greenRevision" -ForegroundColor White
    Write-Host ""
    Write-Host "   - Rollback (instant): az containerapp update -n $ProdAppName -g $ProdResourceGroup --image $prodImage" -ForegroundColor Gray
    Write-Host ""
    exit 0
}

# =========================================================================
# TRUE BLUE/GREEN path - 0% green soak, verify, then explicit flip.
# =========================================================================
Write-Host "🚀 Step 3: TRUE blue/green deployment..." -ForegroundColor Cyan

# 3a. Identify the current (blue) revision serving traffic.
$blueRevision = az containerapp show --name $ProdAppName --resource-group $ProdResourceGroup `
    --query "properties.latestReadyRevisionName" --output tsv 2>$null
if ([string]::IsNullOrWhiteSpace($blueRevision)) {
    Write-Host "❌ Could not resolve current (blue) revision name." -ForegroundColor Red
    exit 1
}
Write-Host "   Blue (current) revision: $blueRevision" -ForegroundColor Gray

# 3b. Switch to multiple-revision mode so traffic can be controlled by name.
Write-Host "   Switching to multiple-revision mode..." -ForegroundColor Gray
az containerapp revision set-mode --name $ProdAppName --resource-group $ProdResourceGroup --mode multiple --output none 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to set multiple-revision mode." -ForegroundColor Red
    exit 1
}

# 3c. Pin 100% traffic to blue BEFORE creating green, so green comes up at 0%.
Write-Host "   Pinning 100% traffic to blue ($blueRevision)..." -ForegroundColor Gray
az containerapp ingress traffic set --name $ProdAppName --resource-group $ProdResourceGroup `
    --revision-weight "$blueRevision=100" --output none 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to pin traffic to blue. Aborting before green creation (no change to live traffic)." -ForegroundColor Red
    exit 1
}

# 3d. Create the green revision (inherits 0% traffic - blue holds 100%).
Write-Host "   Creating green revision $greenRevision at 0% traffic..." -ForegroundColor Gray
$updateOutput = az containerapp update `
    --name $ProdAppName `
    --resource-group $ProdResourceGroup `
    --image $desiredImage `
    --revision-suffix $greenSuffix `
    --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to create green revision. Blue still serving 100%." -ForegroundColor Red
    Write-Host $updateOutput -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Green revision created: $greenRevision (0% traffic)" -ForegroundColor Green

# 3e. Re-assert blue=100 / green=0 (a fresh revision can otherwise pick up weight).
az containerapp ingress traffic set --name $ProdAppName --resource-group $ProdResourceGroup `
    --revision-weight "$blueRevision=100" "$greenRevision=0" --output none 2>&1 | Out-Null

# 3f. Label green so it gets a stable private soak URL.
az containerapp revision label add --name $ProdAppName --resource-group $ProdResourceGroup `
    --revision $greenRevision --label green --yes --output none 2>&1 | Out-Null
$envSuffix = $prodFqdn -replace "^$([regex]::Escape($ProdAppName))\.", ''
$greenFqdn = "$ProdAppName---green.$envSuffix"
Write-Host "   Green soak URL: https://$greenFqdn" -ForegroundColor Gray

# --- Step 4: Soak-test green while blue still serves 100% ---
Write-Host ""
Write-Host "🔍 Step 4: Health-soaking green (blue still serves customers)..." -ForegroundColor Cyan
$maxAttempts = 18
$delaySeconds = 10
$greenHealthy = $false
$greenHealthUrl = "https://$greenFqdn/scim/health"
for ($i = 1; $i -le $maxAttempts; $i++) {
    Start-Sleep -Seconds $delaySeconds
    try {
        $healthResp = Invoke-RestMethod -Uri $greenHealthUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
        if ($healthResp.status -eq 'ok') {
            Write-Host "   ✅ Green healthy on soak URL (attempt $i/$maxAttempts)" -ForegroundColor Green
            $greenHealthy = $true
            break
        }
    } catch {
        Write-Host "   Waiting for green soak URL... (attempt $i/$maxAttempts)" -ForegroundColor Gray
    }
}

function Invoke-GreenRollback {
    param([string]$Reason)
    Write-Host ""
    Write-Host "🛑 ABORTING blue/green: $Reason" -ForegroundColor Red
    Write-Host "   Keeping blue ($blueRevision) at 100% and deactivating green ($greenRevision)..." -ForegroundColor Yellow
    az containerapp ingress traffic set --name $ProdAppName --resource-group $ProdResourceGroup `
        --revision-weight "$blueRevision=100" "$greenRevision=0" --output none 2>&1 | Out-Null
    az containerapp revision deactivate --name $ProdAppName --resource-group $ProdResourceGroup `
        --revision $greenRevision --output none 2>&1 | Out-Null
    Write-Host "   ✅ Customers never left blue. Zero impact." -ForegroundColor Green
}

if (-not $greenHealthy) {
    Invoke-GreenRollback -Reason "green did not become healthy within $($maxAttempts * $delaySeconds)s"
    exit 1
}

# --- Step 5: Full verification cycle against green soak URL ---
if ($RunVerification) {
    Write-Host ""
    Write-Host "🔬 Step 5: Full verification cycle vs green (live + data/ID + Playwright)..." -ForegroundColor Cyan
    if (-not (Test-Path $verifyScript)) {
        Invoke-GreenRollback -Reason "verify-deployment.ps1 not found at $verifyScript"
        exit 1
    }
    $verifyArgs = @(
        '-NoProfile', '-File', $verifyScript,
        '-BaseUrl', "https://$greenFqdn",
        '-ClientSecret', $ProdClientSecret,
        '-Label', "$ProdAppName-green"
    )
    if ($VerifyPlaywright) { $verifyArgs += '-RunPlaywright' }
    & pwsh @verifyArgs
    if ($LASTEXITCODE -ne 0) {
        Invoke-GreenRollback -Reason "verification suite FAILED (exit=$LASTEXITCODE) - includes any non-zero data/ID delta"
        exit 1
    }
    Write-Host "   ✅ Full verification passed on green." -ForegroundColor Green
}

# --- Step 6: Flip 100% traffic to green ---
Write-Host ""
Write-Host "🔀 Step 6: Flipping 100% traffic blue -> green..." -ForegroundColor Cyan
az containerapp ingress traffic set --name $ProdAppName --resource-group $ProdResourceGroup `
    --revision-weight "$greenRevision=100" "$blueRevision=0" --output none 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Invoke-GreenRollback -Reason "traffic flip command failed"
    exit 1
}
Write-Host "   ✅ Green now serving 100% traffic." -ForegroundColor Green

# --- Step 7: Post-flip verification on the public FQDN ---
if ($RunVerification -and (Test-Path $verifyScript)) {
    Write-Host ""
    Write-Host "🔬 Step 7: Post-flip verification vs public FQDN..." -ForegroundColor Cyan
    $postArgs = @(
        '-NoProfile', '-File', $verifyScript,
        '-BaseUrl', "https://$prodFqdn",
        '-ClientSecret', $ProdClientSecret,
        '-Label', "$ProdAppName-postflip"
    )
    if ($VerifyPlaywright) { $postArgs += '-RunPlaywright' }
    & pwsh @postArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ⚠️  Post-flip verification FAILED. Rolling back to blue ($blueRevision)..." -ForegroundColor Red
        az containerapp ingress traffic set --name $ProdAppName --resource-group $ProdResourceGroup `
            --revision-weight "$blueRevision=100" "$greenRevision=0" --output none 2>&1 | Out-Null
        Write-Host "   ✅ Rolled back to blue. Investigate before retrying." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "   ✅ Post-flip verification passed." -ForegroundColor Green
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  ✅ Promotion Complete (TRUE blue/green)" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "   Production: $ProdAppName ($ProdResourceGroup)" -ForegroundColor White
Write-Host "   Image:      $desiredImage" -ForegroundColor White
Write-Host "   Green rev:  $greenRevision (100% traffic)" -ForegroundColor White
Write-Host "   Blue rev:   $blueRevision (0% - retained for instant rollback)" -ForegroundColor White
Write-Host ""
Write-Host "📋 Post-promotion:" -ForegroundColor Cyan
Write-Host "   - Instant rollback: az containerapp ingress traffic set -n $ProdAppName -g $ProdResourceGroup --revision-weight $blueRevision=100 $greenRevision=0" -ForegroundColor Gray
Write-Host "   - Stream logs:      az containerapp logs show -n $ProdAppName -g $ProdResourceGroup --type console --follow" -ForegroundColor Gray
Write-Host ""
