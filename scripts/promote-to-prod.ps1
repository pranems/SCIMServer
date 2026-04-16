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

    This is a safe, zero-downtime operation — Azure Container Apps performs a rolling
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

.EXAMPLE
    # Promote whatever is running in dev to prod
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -DevResourceGroup "scimserver-rg-dev"

.EXAMPLE
    # Promote a specific version
    .\scripts\promote-to-prod.ps1 -ProdResourceGroup "scimserver-rg" -ImageTag "0.37.0"

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
    [switch]$SkipDevVerification,
    [switch]$SkipProdVerification,
    [string]$ProdScimSecret
)

$ErrorActionPreference = 'Stop'

Write-Host "" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  SCIMServer — Promote to Production" -ForegroundColor Cyan
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
        $devHealthUrl = "https://$devFqdn/health"
        try {
            $devHealth = Invoke-RestMethod -Uri $devHealthUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
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
        Write-Host "   ⚠️  Could not retrieve dev FQDN — skipping health check" -ForegroundColor Yellow
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

$desiredImage = "ghcr.io/pranems/scimserver:$ImageTag"

Write-Host "   Current prod image: $prodImage" -ForegroundColor Gray
Write-Host "   Desired prod image: $desiredImage" -ForegroundColor Yellow

if ($prodImage -eq $desiredImage) {
    Write-Host "   ✅ Production already running $ImageTag — nothing to do." -ForegroundColor Green
    exit 0
}

# --- Confirm ---
Write-Host ""
Write-Host "⚠️  This will update PRODUCTION:" -ForegroundColor Yellow
Write-Host "   $ProdAppName ($ProdResourceGroup)" -ForegroundColor White
Write-Host "   $prodImage → $desiredImage" -ForegroundColor White
Write-Host ""
$confirm = Read-Host "Type 'yes' to proceed"
if ($confirm -ne 'yes') {
    Write-Host "❌ Promotion cancelled." -ForegroundColor Red
    exit 1
}

# --- Update production image ---
Write-Host ""
Write-Host "🚀 Updating production Container App..." -ForegroundColor Cyan
$updateOutput = az containerapp update `
    --name $ProdAppName `
    --resource-group $ProdResourceGroup `
    --image $desiredImage `
    --output json 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to update production Container App" -ForegroundColor Red
    Write-Host $updateOutput -ForegroundColor Red
    exit 1
}

Write-Host "   ✅ Image updated to $desiredImage" -ForegroundColor Green

# --- Post-promotion: verify prod health ---
if (-not $SkipProdVerification) {
    Write-Host ""
    Write-Host "🔍 Step 3/3: Verifying production health..." -ForegroundColor Cyan

    $prodFqdn = az containerapp show --name $ProdAppName --resource-group $ProdResourceGroup `
        --query "properties.configuration.ingress.fqdn" --output tsv 2>$null

    if ($prodFqdn) {
        $prodHealthUrl = "https://$prodFqdn/health"
        $maxAttempts = 12
        $delaySeconds = 10
        $healthy = $false

        for ($i = 1; $i -le $maxAttempts; $i++) {
            Start-Sleep -Seconds $delaySeconds
            try {
                $healthResp = Invoke-RestMethod -Uri $prodHealthUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
                Write-Host "   ✅ Production healthy after update (attempt $i/$maxAttempts)" -ForegroundColor Green
                $healthy = $true
                break
            } catch {
                Write-Host "   ⏳ Waiting for production health... (attempt $i/$maxAttempts)" -ForegroundColor Gray
            }
        }

        if (-not $healthy) {
            Write-Host "   ⚠️  Production health check did not pass within $($maxAttempts * $delaySeconds)s" -ForegroundColor Yellow
            Write-Host "   Check logs: az containerapp logs show -n $ProdAppName -g $ProdResourceGroup --type console --tail 50" -ForegroundColor Gray
        }

        # Try version endpoint if we have the SCIM secret
        if ($healthy -and $ProdScimSecret) {
            try {
                $versionUrl = "https://$prodFqdn/scim/admin/version"
                $versionHeaders = @{ Authorization = "Bearer $ProdScimSecret" }
                $versionInfo = Invoke-RestMethod -Uri $versionUrl -Method Get -Headers $versionHeaders -TimeoutSec 15 -ErrorAction Stop
                if ($versionInfo.version) {
                    Write-Host "   ✅ Production version confirmed: $($versionInfo.version)" -ForegroundColor Green
                }
            } catch {
                Write-Host "   ⚠️  Could not verify version endpoint (auth may differ)" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "   ⚠️  Could not retrieve prod FQDN for health check" -ForegroundColor Yellow
    }
} else {
    Write-Host "⏭️  Step 3/3: Prod verification skipped" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  ✅ Promotion Complete" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   Production: $ProdAppName ($ProdResourceGroup)" -ForegroundColor White
Write-Host "   Image:      $desiredImage" -ForegroundColor White
Write-Host ""
Write-Host "📋 Post-promotion:" -ForegroundColor Cyan
Write-Host "   • Run live tests: .\scripts\live-test.ps1 -BaseUrl `"https://$prodFqdn`" -ClientSecret `"<prod-secret>`"" -ForegroundColor Gray
Write-Host "   • Stream logs:    az containerapp logs show -n $ProdAppName -g $ProdResourceGroup --type console --follow" -ForegroundColor Gray
Write-Host "   • Rollback:       az containerapp update -n $ProdAppName -g $ProdResourceGroup --image $prodImage" -ForegroundColor Gray
Write-Host ""
