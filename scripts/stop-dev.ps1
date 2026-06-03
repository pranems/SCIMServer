<#
.SYNOPSIS
    Stop the dev PostgreSQL Flexible Server to save costs.

.DESCRIPTION
    Convenience script to stop the dev PostgreSQL Flexible Server when not in use.
    While stopped, you only pay for storage (~$3-5/mo) instead of compute (~$15-25/mo).

    Use start-dev.ps1 to start it again before developing.

    Note: Azure auto-restarts stopped Flexible Servers after 7 days of inactivity.

.PARAMETER DevResourceGroup
    Dev resource group name (default: scimserver-rg-dev).

.PARAMETER PgServerName
    PostgreSQL server name. Auto-detected from the resource group if not specified.

.EXAMPLE
    .\scripts\stop-dev.ps1

.EXAMPLE
    .\scripts\stop-dev.ps1 -DevResourceGroup "myteam-scim-dev"
#>

param(
    [string]$DevResourceGroup = 'scimserver-rg-dev',
    [string]$PgServerName
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "🔴 Stopping Dev PostgreSQL Server" -ForegroundColor Yellow
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
        exit 1
    }

    $PgServerName = $servers[0]
    Write-Host "📦 Auto-detected PG server: $PgServerName" -ForegroundColor Green
}

# --- Check current state ---
$state = az postgres flexible-server show --resource-group $DevResourceGroup --name $PgServerName `
    --query "state" --output tsv 2>$null

Write-Host "   Current state: $state" -ForegroundColor Gray

if ($state -eq 'Stopped') {
    Write-Host "✅ Server is already stopped." -ForegroundColor Green
    exit 0
}

# --- Stop the server ---
Write-Host "⏹️  Stopping server (this may take 30-60 seconds)..." -ForegroundColor Cyan
az postgres flexible-server stop --resource-group $DevResourceGroup --name $PgServerName --output none 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to stop PostgreSQL server." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Dev PostgreSQL server '$PgServerName' stopped." -ForegroundColor Green
Write-Host "   💰 Only storage charges apply while stopped (~$3-5/mo)." -ForegroundColor Gray
Write-Host "   ⚠️  Azure will auto-restart it after 7 days if left stopped." -ForegroundColor Yellow
Write-Host ""
Write-Host "📋 To start it again:" -ForegroundColor Cyan
Write-Host "   .\scripts\start-dev.ps1" -ForegroundColor Gray
Write-Host ""
