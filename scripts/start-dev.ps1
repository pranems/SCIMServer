<#
.SYNOPSIS
    Start the dev PostgreSQL Flexible Server (saves cost when not in use).

.DESCRIPTION
    Convenience script to start the stopped dev PostgreSQL Flexible Server.
    Use stop-dev.ps1 to stop it when done developing (~$3-5/mo storage-only vs ~$15-25/mo running).

    Note: Azure auto-restarts stopped Flexible Servers after 7 days of inactivity.

.PARAMETER DevResourceGroup
    Dev resource group name (default: scimserver-rg-dev).

.PARAMETER PgServerName
    PostgreSQL server name. Auto-detected from the resource group if not specified.

.EXAMPLE
    .\scripts\start-dev.ps1

.EXAMPLE
    .\scripts\start-dev.ps1 -DevResourceGroup "myteam-scim-dev"
#>

param(
    [string]$DevResourceGroup = 'scimserver-rg-dev',
    [string]$PgServerName
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "🟢 Starting Dev PostgreSQL Server" -ForegroundColor Green
Write-Host ""

# --- Check Azure CLI auth ---
try {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) { throw "not logged in" }
    Write-Host "✅ Azure CLI: $($account.user.name)" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI not authenticated. Run: az login" -ForegroundColor Red
    exit 1
}

# --- Auto-detect PG server name ---
if (-not $PgServerName) {
    $servers = az postgres flexible-server list --resource-group $DevResourceGroup `
        --query "[].name" --output json 2>$null | ConvertFrom-Json

    if (-not $servers -or $servers.Count -eq 0) {
        Write-Host "❌ No PostgreSQL Flexible Servers found in '$DevResourceGroup'" -ForegroundColor Red
        Write-Host "   Deploy dev first: .\scripts\deploy-dev.ps1" -ForegroundColor Gray
        exit 1
    }

    $PgServerName = $servers[0]
    Write-Host "📦 Auto-detected PG server: $PgServerName" -ForegroundColor Green
}

# --- Check current state ---
$state = az postgres flexible-server show --resource-group $DevResourceGroup --name $PgServerName `
    --query "state" --output tsv 2>$null

Write-Host "   Current state: $state" -ForegroundColor Gray

if ($state -eq 'Ready') {
    Write-Host "✅ Server is already running." -ForegroundColor Green
    exit 0
}

# --- Start the server ---
Write-Host "🚀 Starting server (this may take 30-60 seconds)..." -ForegroundColor Cyan
az postgres flexible-server start --resource-group $DevResourceGroup --name $PgServerName --output none 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to start PostgreSQL server." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Dev PostgreSQL server '$PgServerName' is running." -ForegroundColor Green
Write-Host ""
Write-Host "📋 When done developing, stop it to save costs:" -ForegroundColor Cyan
Write-Host "   .\scripts\stop-dev.ps1" -ForegroundColor Gray
Write-Host ""
