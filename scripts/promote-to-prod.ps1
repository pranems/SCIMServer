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
    tenant. You must `az login` into that tenant first, then this switches context.

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

# --- Check Azure CLI auth ---
try {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) { throw "not logged in" }
    Write-Host "✅ Azure CLI: $($account.user.name) ($($account.name))" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI not authenticated. Run: az login" -ForegroundColor Red
    exit 1
}

# --- Cross-tenant guard ---
# The two prod instances live in DIFFERENT Azure AD tenants:
#   - Dev + parallel prod (proudbush, app 'scimserver') -> ProvIAM_Subscription
#   - Customer-facing prod (calmsand, app 'scimserver-prod') -> AnandSa-Test-150 (separate tenant)
# You cannot promote both in one az session. If -Subscription is provided, switch to it
# and confirm the active context matches before touching prod.
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

# 3a. Identify the current (blue) revision ACTUALLY SERVING traffic.
# CRITICAL: blue MUST be the active revision with the most traffic, NOT
# `latestReadyRevisionName`. After a prior aborted blue/green attempt the
# latest-created revision can be a deactivated green - selecting it as blue
# and pinning 100% traffic to a deactivated revision leaves the ingress with
# nowhere to route and 404s the public FQDN. (Root-caused 2026-06-24: a second
# same-day attempt picked a deactivated v0.53.4 revision as "blue", pinned
# traffic to it, and briefly 404'd proudbush until traffic was restored to the
# real serving revision.) We pick the highest-weight ACTIVE revision from the
# live traffic table; only if none has weight (fresh single-revision app) do we
# fall back to latestReadyRevisionName.
# Resilience (added 2026-06-24 after a calmsand promote aborted on a transient
# empty `az` result even though the traffic table was perfectly valid): every
# `az` query below is retried up to 4 times. We also handle the
# `latestRevision:true` traffic-row shape (calmsand auto-routes to newest, so its
# weighted row may carry no explicit revisionName) by resolving the highest-weight
# ACTIVE revision directly from the revision list.
$blueRevision = $null
for ($blueAttempt = 1; $blueAttempt -le 4 -and [string]::IsNullOrWhiteSpace($blueRevision); $blueAttempt++) {
    if ($blueAttempt -gt 1) {
        Write-Host "   (blue-resolution retry $blueAttempt/4 after transient empty az result)" -ForegroundColor DarkYellow
        Start-Sleep -Seconds 5
    }
    try {
        $trafficRows = az containerapp ingress traffic show --name $ProdAppName --resource-group $ProdResourceGroup -o json 2>$null | ConvertFrom-Json
        $activeRevNames = az containerapp revision list --name $ProdAppName --resource-group $ProdResourceGroup --query "[?properties.active].name" -o json 2>$null | ConvertFrom-Json
        # Case 1: explicit-named weighted row that is also active (labeled/proudbush shape).
        $topServing = $trafficRows |
            Where-Object { $_.weight -gt 0 -and $_.revisionName -and ($activeRevNames -contains $_.revisionName) } |
            Sort-Object -Property weight -Descending |
            Select-Object -First 1
        if ($topServing -and $topServing.revisionName) {
            $blueRevision = $topServing.revisionName
            Write-Host "   Blue = highest-traffic ACTIVE named revision: $blueRevision ($($topServing.weight)%)" -ForegroundColor Gray
        }
        # Case 2: weighted `latestRevision:true` row with no explicit revisionName
        # (calmsand auto-route shape). Resolve the highest-weight ACTIVE revision directly.
        if ([string]::IsNullOrWhiteSpace($blueRevision)) {
            $latestRow = $trafficRows | Where-Object { $_.latestRevision -eq $true -and $_.weight -gt 0 } | Select-Object -First 1
            if ($latestRow) {
                $topActive = az containerapp revision list --name $ProdAppName --resource-group $ProdResourceGroup `
                    --query "[?properties.active] | sort_by(@, &properties.trafficWeight)[-1].name" -o tsv 2>$null
                if (-not [string]::IsNullOrWhiteSpace($topActive)) {
                    $blueRevision = $topActive.Trim()
                    Write-Host "   Blue = highest-weight ACTIVE revision (latestRevision auto-route shape): $blueRevision" -ForegroundColor Gray
                }
            }
        }
    } catch {
        Write-Host "   (blue-resolution attempt $blueAttempt threw: $($_.Exception.Message))" -ForegroundColor DarkYellow
    }
    # Fallback within the retry loop: latestReadyRevisionName (also transient-prone).
    if ([string]::IsNullOrWhiteSpace($blueRevision)) {
        $latestReady = az containerapp show --name $ProdAppName --resource-group $ProdResourceGroup `
            --query "properties.latestReadyRevisionName" --output tsv 2>$null
        if (-not [string]::IsNullOrWhiteSpace($latestReady)) {
            $blueRevision = $latestReady.Trim()
            Write-Host "   Blue = latestReadyRevisionName fallback: $blueRevision" -ForegroundColor Gray
        }
    }
}
if ([string]::IsNullOrWhiteSpace($blueRevision)) {
    Write-Host "❌ Could not resolve current (blue) revision name after 4 attempts." -ForegroundColor Red
    Write-Host "   Inspect: az containerapp ingress traffic show -n $ProdAppName -g $ProdResourceGroup -o json" -ForegroundColor Yellow
    Write-Host "   And:     az containerapp revision list -n $ProdAppName -g $ProdResourceGroup -o table" -ForegroundColor Yellow
    exit 1
}
# Safety: confirm the chosen blue is ACTIVE before we pin traffic to it.
$blueActive = az containerapp revision show --name $ProdAppName --resource-group $ProdResourceGroup `
    --revision $blueRevision --query "properties.active" -o tsv 2>$null
if ($blueActive -ne 'true') {
    Write-Host "❌ Selected blue revision '$blueRevision' is not active (active=$blueActive). Refusing to pin traffic to a dead revision." -ForegroundColor Red
    Write-Host "   Inspect: az containerapp revision list -n $ProdAppName -g $ProdResourceGroup -o table" -ForegroundColor Yellow
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
if ($LASTEXITCODE -ne 0) {
    # Non-fatal here (Step 4b re-asserts routing authoritatively), but surface it:
    # a silently-failed label move is exactly what lets verification hit the
    # PRIOR revision through a stale 'green' label.
    Write-Host "   ⚠️  'green' label add returned non-zero; Step 4b will verify routing." -ForegroundColor Yellow
}
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

# --- Step 4b: Confirm the green soak URL actually routes to the NEW green
# revision, not a stale 'green' label still pointing at the PRIOR revision.
# The /scim/health probe in Step 4 passes for ANY healthy revision, so without
# this assertion a lagging or failed label move would run the entire Step 5
# verification against the OLD image. That produces a confusing failure (a
# version-specific Playwright/contract assertion fails) or, worse, a false
# PASS that promotes nothing new. We assert the served runtime.hostname carries
# this promotion's green revision suffix, retrying to absorb label-propagation
# delay. (Root-caused 2026-06-24: a same-day second blue/green left the prior
# green-labelled revision in place; verification ran against v0.53.3 while green
# was v0.53.4 and the new UI spec correctly flagged the mismatch.)
Write-Host ""
Write-Host "🔎 Step 4b: Confirming green URL routes to the new revision ($greenRevision)..." -ForegroundColor Cyan
$greenTokenBody = '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"' + $ProdClientSecret + '"}'
$routedToGreen = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $gTok = (Invoke-RestMethod -Uri "https://$greenFqdn/scim/oauth/token" -Method Post -Body $greenTokenBody -ContentType 'application/json' -TimeoutSec 15).access_token
        $gVer = Invoke-RestMethod -Uri "https://$greenFqdn/scim/admin/version" -Headers @{ Authorization = "Bearer $gTok" } -TimeoutSec 15
        if ($gVer.runtime.hostname -match [regex]::Escape($greenSuffix)) {
            Write-Host "   ✅ Green URL routes to $($gVer.runtime.hostname) (v$($gVer.version))" -ForegroundColor Green
            $routedToGreen = $true
            break
        }
        Write-Host "   Waiting for 'green' label to route to $greenSuffix (currently $($gVer.runtime.hostname))... ($i/30)" -ForegroundColor Gray
    } catch {
        Write-Host "   Waiting for green version endpoint... ($i/30)" -ForegroundColor Gray
    }
    Start-Sleep -Seconds 10
}
if (-not $routedToGreen) {
    Invoke-GreenRollback -Reason "green soak URL never routed to the new revision $greenRevision (stale/lagging 'green' label). Verification was NOT run against the new image; refusing to promote."
    exit 1
}

# --- Step 4c: Assert the green-served VERSION matches the promoted tag.
# Routing to the right revision is necessary but not sufficient: the image
# behind that revision can still be the wrong build. (Root-caused 2026-06-24:
# the GHCR publish workflow builds from the REMOTE branch ref, but the ACR
# image is built+pushed from the LOCAL working tree. When a version-bump commit
# was not pushed before the GHCR build ran, the GHCR ':0.53.4' tag actually
# contained v0.53.3 code - dev (ACR) was correct while both prods (GHCR) were
# stale. The revision routed correctly but served the wrong version.) When the
# promoted -ImageTag is a semver, we require the served version to equal it.
if ($ImageTag -match '^\d+\.\d+\.\d+') {
    $servedVersion = $null
    try {
        $gTok2 = (Invoke-RestMethod -Uri "https://$greenFqdn/scim/oauth/token" -Method Post -Body $greenTokenBody -ContentType 'application/json' -TimeoutSec 15).access_token
        $servedVersion = (Invoke-RestMethod -Uri "https://$greenFqdn/scim/admin/version" -Headers @{ Authorization = "Bearer $gTok2" } -TimeoutSec 15).version
    } catch { }
    if ($servedVersion -ne $ImageTag) {
        Invoke-GreenRollback -Reason "green serves version '$servedVersion' but promoted tag is '$ImageTag'. The image behind the green revision is the WRONG build (likely a registry tag built from a stale ref). Refusing to promote a mislabeled image."
        exit 1
    }
    Write-Host "   ✅ Green serves the expected version v$servedVersion (matches -ImageTag $ImageTag)" -ForegroundColor Green
} else {
    Write-Host "   (ImageTag '$ImageTag' is not a semver; skipping version-match assertion)" -ForegroundColor DarkGray
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
