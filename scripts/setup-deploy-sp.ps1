<#
.SYNOPSIS
    One-time bootstrap of a deployment service principal per Azure tenant, so the
    SCIMServer deploy/promote workflows never have to interactively log in again.

.DESCRIPTION
    Creates a least-privilege service principal (Contributor on only the SCIMServer
    resource groups) in each tenant, and stores its credential under
    ~/.scimserver-deploy/<tenant>.json with a hardened ACL. After this runs once,
    scripts/az-tenant.ps1 (Connect-ScimTenant) and scripts/promote-to-prod.ps1 sign
    in non-interactively via that credential - no browser prompt on every workflow.

    The credential file lives in your user profile, NOT in the repo, so it is never
    committed. (.gitignore also defensively excludes SP cred files just in case.)

    What gets created per tenant:
      proviam -> SP 'scimserver-deploy-proviam', Contributor on RGs
                 scimserver-dev + scimserver-prod  (ProvIAM_Subscription)
      anandsa -> SP 'scimserver-deploy-anandsa', Contributor on RG
                 scimserver-rg-prod                (AnandSa-Test-150)

.PARAMETER Name
    Which tenant(s) to bootstrap: proviam, anandsa, or all (default).

.PARAMETER Years
    Lifetime of the SP secret in years (default 1). Re-run with -Rotate before it
    expires to issue a fresh secret.

.PARAMETER Role
    RBAC role to grant on the scoped resource groups (default Contributor).

.PARAMETER Rotate
    Overwrite an existing credential file and reset/add a new SP secret. Without
    this, an existing cred file for a tenant is left untouched.

.PARAMETER DeviceCode
    Use the device-code login flow for the required interactive user sign-in
    (instead of the default browser popup).

.PARAMETER Force
    Skip the interactive "type CREATE to proceed" confirmation. Use in automation
    only when you are sure.

.NOTES
    Requires a user account with permission to create app registrations AND assign
    roles in the target tenant. Creating a service principal modifies shared tenant
    directory state, so this script confirms before acting unless -Force is set.

.EXAMPLE
    pwsh scripts/setup-deploy-sp.ps1 -Name proviam

.EXAMPLE
    pwsh scripts/setup-deploy-sp.ps1                 # both tenants

.EXAMPLE
    pwsh scripts/setup-deploy-sp.ps1 -Name anandsa -Rotate
#>
[CmdletBinding()]
param(
    [ValidateSet('proviam', 'anandsa', 'all')]
    [string]$Name = 'all',
    [int]$Years = 1,
    [string]$Role = 'Contributor',
    [switch]$Rotate,
    [switch]$DeviceCode,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'az-tenant.ps1')

# --- preflight: az CLI present ---
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Azure CLI ('az') not found on PATH." -ForegroundColor Red
    exit 1
}

function Protect-CredFile {
    param([string]$Path)
    # Restrict the secret file to the current user only (Windows ACL).
    try {
        if ($IsWindows -or $env:OS -eq 'Windows_NT') {
            icacls $Path /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null
        }
    } catch {
        Write-Host "WARN: could not harden ACL on $Path ($($_.Exception.Message))." -ForegroundColor Yellow
    }
}

function New-DeploySp {
    param([Parameter(Mandatory)] $Entry)

    Write-Host ""
    Write-Host "=== Bootstrapping deployment SP for $($Entry.Name) ===" -ForegroundColor Cyan

    if ((Test-Path $Entry.CredFile) -and -not $Rotate) {
        Write-Host "SKIP: credential already exists at $($Entry.CredFile)." -ForegroundColor Yellow
        Write-Host "      Re-run with -Rotate to issue a fresh secret." -ForegroundColor Yellow
        return
    }

    # Must sign in as a USER to create an app registration (an SP cannot by default).
    $acct = Connect-ScimUser -Entry $Entry -DeviceCode:$DeviceCode
    if (-not $acct) {
        Write-Host "ERROR: could not sign in to $($Entry.Name) as a user; skipping." -ForegroundColor Red
        return
    }
    if ($acct.user.type -ne 'user') {
        Write-Host "ERROR: active identity is '$($acct.user.type)', not a user. Creating an SP needs a user." -ForegroundColor Red
        return
    }

    $subId  = $acct.id
    $spName = "scimserver-deploy-$($Entry.Key)"
    $scopes = $Entry.Scopes | ForEach-Object { "/subscriptions/$subId/resourceGroups/$_" }

    Write-Host ""
    Write-Host "  tenant       : $($Entry.Tenant)"
    Write-Host "  subscription : $($Entry.Subscription) ($subId)"
    Write-Host "  SP name      : $spName"
    Write-Host "  role         : $Role"
    Write-Host "  scope (RGs)  : $($Entry.Scopes -join ', ')"
    Write-Host "  secret life  : $Years year(s)"
    Write-Host "  cred file    : $($Entry.CredFile)"
    Write-Host ""

    if (-not $Force) {
        $answer = Read-Host "Type CREATE to create/rotate this service principal (anything else cancels)"
        if ($answer -ne 'CREATE') {
            Write-Host "Cancelled $($Entry.Key)." -ForegroundColor Yellow
            return
        }
    }

    # Verify the scoped resource groups exist before creating the SP.
    foreach ($rg in $Entry.Scopes) {
        $exists = az group exists --name $rg 2>$null
        if ($exists -ne 'true') {
            Write-Host "ERROR: resource group '$rg' not found in $($Entry.Subscription)." -ForegroundColor Red
            Write-Host "       Fix the scope in Get-ScimTenantMap (az-tenant.ps1) or create the RG first." -ForegroundColor Yellow
            return
        }
    }

    Write-Host "Creating service principal..." -ForegroundColor Cyan
    $spJson = az ad sp create-for-rbac `
        --name $spName `
        --role $Role `
        --scopes @scopes `
        --years $Years `
        --output json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $spJson) {
        Write-Host "ERROR: 'az ad sp create-for-rbac' failed for $($Entry.Key)." -ForegroundColor Red
        Write-Host "       You likely lack app-registration or role-assignment rights in this tenant." -ForegroundColor Yellow
        return
    }

    $sp = $spJson | ConvertFrom-Json
    $credRoot = Split-Path -Parent $Entry.CredFile
    if (-not (Test-Path $credRoot)) { New-Item -ItemType Directory -Force -Path $credRoot | Out-Null }

    $record = [ordered]@{
        appId        = $sp.appId
        password     = $sp.password
        tenant       = $sp.tenant
        displayName  = $sp.displayName
        subscription = $Entry.Subscription
        subId        = $subId
        scopes       = $Entry.Scopes
        role         = $Role
        createdUtc   = (Get-Date).ToUniversalTime().ToString('o')
        expiresUtc   = (Get-Date).ToUniversalTime().AddYears($Years).ToString('o')
    }
    $record | ConvertTo-Json | Set-Content -Path $Entry.CredFile -Encoding utf8
    Protect-CredFile -Path $Entry.CredFile

    Write-Host "OK: service principal saved to $($Entry.CredFile)" -ForegroundColor Green
    Write-Host "    appId    = $($sp.appId)" -ForegroundColor Green
    Write-Host "    expires  = $($record.expiresUtc)" -ForegroundColor Green
}

# --- main ---
$map = Get-ScimTenantMap
$targets = if ($Name -eq 'all') { @($map.Keys) } else { @($Name) }

Write-Host ""
Write-Host "SCIMServer deployment service-principal bootstrap" -ForegroundColor Cyan
Write-Host "Targets: $($targets -join ', ')" -ForegroundColor Cyan

foreach ($k in $targets) {
    New-DeploySp -Entry $map[$k]
}

Write-Host ""
Write-Host "Done. Verify with:  . ./scripts/az-tenant.ps1 ; Show-ScimDeployStatus" -ForegroundColor Cyan
Write-Host "From now on, Connect-ScimTenant / promote-to-prod.ps1 sign in non-interactively." -ForegroundColor Cyan
