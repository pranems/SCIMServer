<#
.SYNOPSIS
    Stop re-authenticating into the two SCIMServer Azure tenants on every workflow.

.DESCRIPTION
    The two prods live in different Azure AD tenants and a single ~/.azure token
    cache cannot hold both at once - logging into one churns the other and forces a
    re-login when you switch back. This helper gives each tenant its OWN isolated CLI
    profile directory (AZURE_CONFIG_DIR) so both stay logged in simultaneously, and
    layers an optional service-principal login on top so deployment scripts never
    prompt at all.

      proviam  -> ProvIAM_Subscription  (dev + parallel prod 'scimserver' / proudbush)
      anandsa  -> AnandSa-Test-150       (customer-facing prod 'scimserver-prod' / calmsand)

    Login resolution order for each tenant (first that works wins, no re-login if
    a cached token is still valid):
      1. Reuse the cached token in that tenant's isolated profile dir.
      2. Service-principal login from ~/.scimserver-deploy/<tenant>.json (non-interactive)
         once you have run scripts/setup-deploy-sp.ps1.
      3. Interactive `az login --tenant <id>` (normal browser popup). Pass -DeviceCode
         only if you want the device-code flow instead.

.NOTES
    DOT-SOURCE this file so the AZURE_CONFIG_DIR change sticks in your shell:

        . .\scripts\az-tenant.ps1
        Use-ProvIAM            # dev + proudbush prod context
        Use-AnandSa            # calmsand customer-facing prod context
        Show-AzTenant          # show which profile + account is active
        Show-ScimDeployStatus  # show login + service-principal status for both

    Running it as a child process (pwsh scripts\az-tenant.ps1) does NOT persist the
    env var back into your shell - dot-source it instead.
#>

function Get-ScimTenantMap {
    <#
        Single source of truth for both tenants. Subscription IDs are resolved at
        runtime (so the AnandSa sub id never has to be hardcoded). Scopes are the
        resource groups a deployment service principal needs Contributor on.
    #>
    $credRoot = Join-Path $HOME '.scimserver-deploy'
    [ordered]@{
        proviam = @{
            Key          = 'proviam'
            Name         = 'ProvIAM (dev + proudbush prod)'
            Tenant       = 'f08e6aff-ca0f-4f11-81fa-1ffd43323373'
            Subscription = 'ProvIAM_Subscription'
            ConfigDir    = Join-Path $HOME '.azure-proviam'
            CredFile     = Join-Path $credRoot 'proviam.json'
            Scopes       = @('scimserver-dev', 'scimserver-prod')
        }
        anandsa = @{
            Key          = 'anandsa'
            Name         = 'AnandSa (calmsand customer-facing prod)'
            Tenant       = '9de357c6-4488-4a8d-bd2f-14696f1af950'
            Subscription = 'AnandSa-Test-150'
            ConfigDir    = Join-Path $HOME '.azure-anandsa'
            CredFile     = Join-Path $credRoot 'anandsa.json'
            Scopes       = @('scimserver-rg-prod')
        }
    }
}

function Resolve-ScimTenantEntry {
    [CmdletBinding()]
    param([string]$Name, [string]$Subscription)
    $map = Get-ScimTenantMap
    if ($Name) { return $map[$Name] }
    if ($Subscription) {
        foreach ($e in $map.Values) { if ($e.Subscription -eq $Subscription) { return $e } }
    }
    return $null
}

function Connect-ScimTenant {
    <#
        Make the given tenant the active az context using its isolated profile.
        Reuses a cached token, else logs in via service principal, else interactively.
        Returns the resulting account object, or $null on failure.
    #>
    [CmdletBinding()]
    param(
        [string]$Name,
        [string]$Subscription,
        [switch]$DeviceCode,
        [switch]$NoInteractive
    )

    $entry = Resolve-ScimTenantEntry -Name $Name -Subscription $Subscription
    if (-not $entry) {
        Write-Host "ERROR: unknown SCIM tenant '$Name$Subscription'." -ForegroundColor Red
        return $null
    }

    $env:AZURE_CONFIG_DIR = $entry.ConfigDir
    if (-not (Test-Path $entry.ConfigDir)) {
        New-Item -ItemType Directory -Force -Path $entry.ConfigDir | Out-Null
    }

    # 1. Reuse a still-valid cached token in this isolated profile.
    $acct = az account show -o json 2>$null | ConvertFrom-Json
    if ($acct -and $acct.tenantId -eq $entry.Tenant) {
        az account set --subscription $entry.Subscription 2>$null | Out-Null
        return (az account show -o json 2>$null | ConvertFrom-Json)
    }

    # 2. Service principal (fully non-interactive) once setup-deploy-sp.ps1 has run.
    if (Test-Path $entry.CredFile) {
        try {
            $sp = Get-Content $entry.CredFile -Raw | ConvertFrom-Json
            az login --service-principal -u $sp.appId -p $sp.password --tenant $sp.tenant --output none 2>$null
            if ($LASTEXITCODE -eq 0) {
                az account set --subscription $entry.Subscription 2>$null | Out-Null
                Write-Host "OK: signed into $($entry.Name) via service principal." -ForegroundColor Green
                return (az account show -o json 2>$null | ConvertFrom-Json)
            }
            Write-Host "WARN: service-principal login failed for $($entry.Key); falling back to interactive." -ForegroundColor Yellow
        } catch {
            Write-Host "WARN: could not use SP cred file ($($_.Exception.Message)); falling back to interactive." -ForegroundColor Yellow
        }
    }

    # 3. Interactive user login (normal browser popup; -DeviceCode for the code flow).
    if ($NoInteractive) {
        Write-Host "ERROR: $($entry.Name) is not authenticated and -NoInteractive was set." -ForegroundColor Red
        return $null
    }
    Write-Host "Signing into $($entry.Name) (tenant $($entry.Tenant))..." -ForegroundColor Cyan
    if ($DeviceCode) {
        az login --tenant $entry.Tenant --use-device-code --output none
    } else {
        az login --tenant $entry.Tenant --output none
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: interactive login failed for $($entry.Name)." -ForegroundColor Red
        return $null
    }
    az account set --subscription $entry.Subscription 2>$null | Out-Null
    return (az account show -o json 2>$null | ConvertFrom-Json)
}

function Connect-ScimUser {
    <#
        Like Connect-ScimTenant but always lands a real USER (never a service
        principal). Required by setup-deploy-sp.ps1, because creating an app
        registration needs a user (or an SP with directory write rights), and an
        SP cannot create another SP by default.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Entry, [switch]$DeviceCode)

    $env:AZURE_CONFIG_DIR = $Entry.ConfigDir
    if (-not (Test-Path $Entry.ConfigDir)) {
        New-Item -ItemType Directory -Force -Path $Entry.ConfigDir | Out-Null
    }

    $acct = az account show -o json 2>$null | ConvertFrom-Json
    if ($acct -and $acct.tenantId -eq $Entry.Tenant -and $acct.user.type -eq 'user') {
        az account set --subscription $Entry.Subscription 2>$null | Out-Null
        return (az account show -o json 2>$null | ConvertFrom-Json)
    }

    Write-Host "Signing into $($Entry.Name) as a user (tenant $($Entry.Tenant))..." -ForegroundColor Cyan
    if ($DeviceCode) {
        az login --tenant $Entry.Tenant --use-device-code --output none
    } else {
        az login --tenant $Entry.Tenant --output none
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: interactive login failed for $($Entry.Name)." -ForegroundColor Red
        return $null
    }
    az account set --subscription $Entry.Subscription 2>$null | Out-Null
    return (az account show -o json 2>$null | ConvertFrom-Json)
}

function Use-ProvIAM {
    [CmdletBinding()] param([switch]$DeviceCode)
    Connect-ScimTenant -Name 'proviam' -DeviceCode:$DeviceCode | Out-Null
    Show-AzTenant
}

function Use-AnandSa {
    [CmdletBinding()] param([switch]$DeviceCode)
    Connect-ScimTenant -Name 'anandsa' -DeviceCode:$DeviceCode | Out-Null
    Show-AzTenant
}

function Show-AzTenant {
    [CmdletBinding()] param()
    $cfg = $env:AZURE_CONFIG_DIR
    if (-not $cfg) { $cfg = "(default $HOME/.azure)" }
    Write-Host "AZURE_CONFIG_DIR = $cfg" -ForegroundColor Cyan
    az account show --query "{subscription:name, tenant:tenantId, user:user.name, type:user.type}" -o jsonc
}

function Show-ScimDeployStatus {
    <#
        One-glance view of login + service-principal status for both tenants, so you
        can tell what (if anything) still needs a one-time login or SP bootstrap.
    #>
    [CmdletBinding()] param()
    $saved = $env:AZURE_CONFIG_DIR
    try {
        foreach ($entry in (Get-ScimTenantMap).Values) {
            Write-Host ""
            Write-Host "== $($entry.Name) ==" -ForegroundColor Cyan
            Write-Host "  subscription : $($entry.Subscription)"
            Write-Host "  profile dir  : $($entry.ConfigDir)"

            $env:AZURE_CONFIG_DIR = $entry.ConfigDir
            $acct = az account show -o json 2>$null | ConvertFrom-Json
            if ($acct) {
                Write-Host "  logged in    : yes ($($acct.user.name), type=$($acct.user.type))" -ForegroundColor Green
            } else {
                Write-Host "  logged in    : no (run Use-$( if($entry.Key -eq 'proviam'){'ProvIAM'}else{'AnandSa'} ))" -ForegroundColor Yellow
            }

            if (Test-Path $entry.CredFile) {
                try {
                    $sp = Get-Content $entry.CredFile -Raw | ConvertFrom-Json
                    $age = if ($sp.createdUtc) { " (created $($sp.createdUtc))" } else { '' }
                    Write-Host "  service prin.: yes [$($sp.appId)]$age" -ForegroundColor Green
                } catch {
                    Write-Host "  service prin.: cred file present but unreadable" -ForegroundColor Yellow
                }
            } else {
                Write-Host "  service prin.: none (run scripts/setup-deploy-sp.ps1 -Name $($entry.Key))" -ForegroundColor Yellow
            }
        }
        Write-Host ""
    } finally {
        $env:AZURE_CONFIG_DIR = $saved
    }
}
