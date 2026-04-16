<#
.SYNOPSIS
    Deploy a dev instance of SCIMServer in a separate Azure resource group.

.DESCRIPTION
    Thin wrapper around deploy-azure.ps1 that provisions a fully isolated dev environment:
      - Separate resource group (default: <prod-rg>-dev)
      - Separate VNet, Container Apps Environment, PostgreSQL Flexible Server
      - Separate secrets (auto-generated if not provided)
      - Complete blast-radius isolation from the production deployment

    The dev instance is ideal for testing new features, running live tests, and validating
    database migrations without any risk to the production deployment.

    Cost: ~$15-25/month additional (mostly PostgreSQL Flexible Server B1ms).

.PARAMETER ProdResourceGroup
    The production resource group name. Used to derive the default dev resource group name.

.PARAMETER DevResourceGroup
    Explicit dev resource group name (default: <ProdResourceGroup>-dev).

.PARAMETER AppName
    Container App name for the dev instance (default: scimserver-dev).

.PARAMETER Location
    Azure region (default: eastus). Inherited from production if not specified.

.PARAMETER ImageTag
    Container image tag to deploy (default: auto-read from api/package.json).
    Tip: Use 'dev' or 'test-<branch>' tags from CI builds for pre-release testing.

.PARAMETER ScimSecret
    SCIM shared secret for the dev instance (auto-generated if not provided).

.PARAMETER JwtSecret
    JWT signing secret (auto-generated if not provided).

.PARAMETER OauthClientSecret
    OAuth client secret (auto-generated if not provided).

.PARAMETER PgLocation
    Optional: deploy PostgreSQL to a different region (some subscriptions restrict PG in certain regions).

.EXAMPLE
    # Deploy dev instance alongside production (separate resource group)
    .\scripts\deploy-dev.ps1 -ProdResourceGroup "scimserver-rg"

.EXAMPLE
    # Deploy with a specific dev image tag
    .\scripts\deploy-dev.ps1 -ProdResourceGroup "scimserver-rg" -ImageTag "dev"

.EXAMPLE
    # Deploy with explicit dev RG name and location
    .\scripts\deploy-dev.ps1 -DevResourceGroup "myteam-scim-dev" -AppName "scim-dev" -Location "westus2"

.EXAMPLE
    # Run live tests against the dev instance after deployment
    .\scripts\live-test.ps1 -BaseUrl "https://scimserver-dev.<fqdn>" -ClientSecret "<dev-secret>"
#>

param(
    [string]$ProdResourceGroup,
    [string]$DevResourceGroup,
    [string]$AppName = 'scimserver-dev',
    [string]$Location,
    [string]$ImageTag,
    [string]$ScimSecret,
    [string]$JwtSecret,
    [string]$OauthClientSecret,
    [string]$PgLocation
)

Write-Host "" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  SCIMServer Dev Environment Deployment" -ForegroundColor Green
Write-Host "  (Full isolation from production)" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""

# --- Derive dev resource group name ---
if (-not $DevResourceGroup) {
    if (-not $ProdResourceGroup) {
        $ProdResourceGroup = Read-Host "Enter the production Resource Group name (e.g. scimserver-rg)"
        if ([string]::IsNullOrWhiteSpace($ProdResourceGroup)) {
            Write-Host "❌ Resource Group name is required." -ForegroundColor Red
            exit 1
        }
    }
    $DevResourceGroup = "$ProdResourceGroup-dev"
}

Write-Host "📋 Dev Deployment Configuration:" -ForegroundColor Cyan
Write-Host "   Prod RG (reference): $ProdResourceGroup" -ForegroundColor Gray
Write-Host "   Dev RG (target):     $DevResourceGroup" -ForegroundColor Yellow
Write-Host "   App Name:            $AppName" -ForegroundColor Yellow
Write-Host ""

Write-Host "⚠️  This will create a SEPARATE resource group with its own:" -ForegroundColor Yellow
Write-Host "   • Virtual Network + subnets" -ForegroundColor White
Write-Host "   • Container Apps Environment + Log Analytics" -ForegroundColor White
Write-Host "   • PostgreSQL Flexible Server (~`$15-25/mo)" -ForegroundColor White
Write-Host "   • Container App (SCIMServer dev instance)" -ForegroundColor White
Write-Host ""
Write-Host "   Production resource group '$ProdResourceGroup' will NOT be touched." -ForegroundColor Green
Write-Host ""

# --- Build parameter splat for deploy-azure.ps1 ---
$deployParams = @{
    ResourceGroup    = $DevResourceGroup
    AppName          = $AppName
    ProvisionPostgres = $true
}

if ($Location)          { $deployParams.Location = $Location }
if ($ImageTag)          { $deployParams.ImageTag = $ImageTag }
if ($ScimSecret)        { $deployParams.ScimSecret = $ScimSecret }
if ($JwtSecret)         { $deployParams.JwtSecret = $JwtSecret }
if ($OauthClientSecret) { $deployParams.OauthClientSecret = $OauthClientSecret }
if ($PgLocation)        { $deployParams.PgLocation = $PgLocation }

# --- Invoke the core deployment script ---
$deployScript = Join-Path $PSScriptRoot 'deploy-azure.ps1'
if (-not (Test-Path $deployScript)) {
    Write-Host "❌ Cannot find deploy-azure.ps1 at: $deployScript" -ForegroundColor Red
    exit 1
}

Write-Host "🚀 Calling deploy-azure.ps1 with dev parameters..." -ForegroundColor Cyan
Write-Host "   $deployScript" -ForegroundColor Gray
Write-Host ""

& $deployScript @deployParams

$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Write-Host "" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  ✅ Dev Environment Deployed Successfully" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Run live tests against dev:" -ForegroundColor White
    Write-Host "      .\scripts\live-test.ps1 -BaseUrl `"https://<dev-fqdn>`" -ClientSecret `"<dev-secret>`"" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   2. When ready to promote to production:" -ForegroundColor White
    Write-Host "      .\scripts\promote-to-prod.ps1 -ProdResourceGroup `"$ProdResourceGroup`" -DevResourceGroup `"$DevResourceGroup`"" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   3. To tear down the dev environment when no longer needed:" -ForegroundColor White
    Write-Host "      az group delete --name $DevResourceGroup --yes --no-wait" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "❌ Dev environment deployment failed (exit code: $exitCode)" -ForegroundColor Red
    exit $exitCode
}
