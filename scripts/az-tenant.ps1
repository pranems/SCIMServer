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

      proviam09 -> ProvIAM_Subscription  (dev + canary prod 'scimserver')  ACTIVE
      proviam   -> ProvIAM_Subscription  (retiring ephemeral tenant 08, kept intact)
      anandsa   -> AnandSa-Test-150      (customer-facing prod 'scimserver-prod' / calmsand)

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
        Use-ProvIAM09          # dev + canary prod context (tenant 09, ACTIVE)
        Use-ProvIAM            # tenant 08 context (retiring, read-only)
        Use-AnandSa            # calmsand customer-facing prod context
        Show-AzTenant          # show which profile + account is active
        Show-ScimDeployStatus  # show login + service-principal status for all tenants

    Running it as a child process (pwsh scripts\az-tenant.ps1) does NOT persist the
    env var back into your shell - dot-source it instead.
#>

function Get-ScimTenantMap {
    <#
        Single source of truth for every tenant.

        Every entry carries BOTH the human-readable NAME and the machine ID for
        the tenant and the subscription, plus the deployment service principal's
        name and appId, so nothing has to be looked up elsewhere:

          TenantName     display name of the Entra tenant
          TenantDomain   initial *.onmicrosoft.com domain
          Tenant         tenant (directory) GUID
          Subscription   subscription display name
          SubscriptionId subscription GUID   <- the resolution key
          SpName         deployment service principal display name
          SpAppId        deployment service principal application (client) ID
          Estates        the container apps this tenant hosts, app -> resource group

        Scopes are the resource groups the deployment service principal needs
        Contributor on.

        SubscriptionId is the resolution key because two entries (proviam and
        proviam09) share the subscription NAME 'ProvIAM_Subscription'. Resolving
        by name is ambiguous and would silently route a deploy at the wrong
        tenant, so always resolve and select by ID.
    #>
    $credRoot = Join-Path $HOME '.scimserver-deploy'
    [ordered]@{
        proviam09 = @{
            Key            = 'proviam09'
            Name           = 'ProvIAM 09 (ACTIVE - dev + canary prod)'
            TenantName     = 'Provisioning IAM Team 09'
            TenantDomain   = 'proviamtest09.onmicrosoft.com'
            Tenant         = '9751e42f-78f3-42f4-8b8a-6e73845aceae'
            Subscription   = 'ProvIAM_Subscription'
            SubscriptionId = '8cb58fd6-cf6f-4334-9fe0-3b12f93a6596'
            ConfigDir      = Join-Path $HOME '.azure-proviam09'
            UserConfigDir  = Join-Path $HOME '.azure-proviam09-user'
            CredFile       = Join-Path $credRoot 'proviam09.json'
            SpName         = 'scimserver-deploy-proviam09'
            SpAppId        = 'd36c0c84-09b8-4700-b07a-0a2b7605c292'
            Scopes         = @('scimserver-dev', 'scimserver-prod')
            Estates        = [ordered]@{ 'scimserver-dev' = 'scimserver-dev'; 'scimserver' = 'scimserver-prod' }
            Status         = 'active'
        }
        proviam = @{
            Key            = 'proviam'
            Name           = 'ProvIAM 08 (RETIRING - kept intact, read-only)'
            TenantName     = 'Provisioning IAM Team 08'
            TenantDomain   = 'proviamtest08.onmicrosoft.com'
            Tenant         = 'f08e6aff-ca0f-4f11-81fa-1ffd43323373'
            Subscription   = 'ProvIAM_Subscription'
            SubscriptionId = '5738ea6a-533b-4c0d-a18a-d322f2094475'
            ConfigDir      = Join-Path $HOME '.azure-proviam'
            UserConfigDir  = Join-Path $HOME '.azure-proviam-user'
            CredFile       = Join-Path $credRoot 'proviam.json'
            SpName         = 'scimserver-deploy-proviam'
            SpAppId        = 'ef8921f1-653d-4cc8-af08-b695746e8a3f'
            Scopes         = @('scimserver-dev', 'scimserver-prod')
            Estates        = [ordered]@{ 'scimserver-dev' = 'scimserver-dev'; 'scimserver' = 'scimserver-prod' }
            Status         = 'retiring'
        }
        anandsa = @{
            Key            = 'anandsa'
            Name           = 'AnandSa (customer-facing prod / calmsand - DO NOT DISTURB)'
            TenantName     = 'AnandSa-Test-150 directory'
            TenantDomain   = '(not captured - deployment SP has no directory read)'
            Tenant         = '9de357c6-4488-4a8d-bd2f-14696f1af950'
            Subscription   = 'AnandSa-Test-150'
            SubscriptionId = 'e299a87a-9e41-4f3e-b17f-64cd123758a0'
            ConfigDir      = Join-Path $HOME '.azure-anandsa'
            UserConfigDir  = Join-Path $HOME '.azure-anandsa-user'
            CredFile       = Join-Path $credRoot 'anandsa.json'
            SpName         = 'scimserver-deploy-anandsa'
            SpAppId        = 'b5bb52e6-f16b-4fc0-9c9f-c752e7174467'
            Scopes         = @('scimserver-rg-prod')
            Estates        = [ordered]@{ 'scimserver-prod' = 'scimserver-rg-prod' }
            Status         = 'permanent'
        }
    }
}

function Get-ScimPortalUrl {
    <#
        Azure portal deep link for a tenant, pinned to the right DIRECTORY.

        The '#@<domain>' fragment is what makes the portal open in the correct
        tenant. Without it the portal lands in whichever directory the browser
        used last, which for this project is usually the wrong one and is the
        single most common source of "I cannot see my resources".

        -Blade selects what to open:
          subscription (default) | resourceGroups | containerApps | postgres | acr | all
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [ValidateSet('subscription', 'resourceGroups', 'containerApps', 'postgres', 'acr')]
        [string]$Blade = 'subscription'
    )
    $e = (Get-ScimTenantMap)[$Name]
    if (-not $e) { Write-Host "ERROR: unknown tenant '$Name'." -ForegroundColor Red; return $null }

    # Prefer the verified domain; fall back to the tenant GUID when the domain is unknown.
    $dir = if ($e.TenantDomain -and $e.TenantDomain -notmatch '^\(') { $e.TenantDomain } else { $e.Tenant }
    $root = "https://portal.azure.com/#@$dir"

    switch ($Blade) {
        'subscription'   { "$root/resource/subscriptions/$($e.SubscriptionId)/overview" }
        'resourceGroups' { "$root/blade/HubsExtension/BrowseResourceGroups" }
        'containerApps'  { "$root/blade/HubsExtension/BrowseResource/resourceType/Microsoft.App%2FcontainerApps" }
        'postgres'       { "$root/blade/HubsExtension/BrowseResource/resourceType/Microsoft.DBforPostgreSQL%2FflexibleServers" }
        'acr'            { "$root/blade/HubsExtension/BrowseResource/resourceType/Microsoft.ContainerRegistry%2Fregistries" }
    }
}

function Open-ScimPortal {
    <#
        Open the Azure portal in the correct directory for a tenant.

        Portal access is a BROWSER session tied to your USER account. It is
        completely independent of the deployment service principals this module
        uses, so automation never affects what you can see in the portal, and
        signing into the portal never disturbs the CLI profiles.

            Open-ScimPortal proviam09                     # the active dev + canary prod tenant
            Open-ScimPortal proviam09 -Blade containerApps
            Open-ScimPortal proviam                       # the retiring tenant 08, still fully browsable
            Open-ScimPortal anandsa                       # customer-facing prod
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)][ValidateSet('proviam09', 'proviam', 'anandsa')][string]$Name,
        [ValidateSet('subscription', 'resourceGroups', 'containerApps', 'postgres', 'acr')]
        [string]$Blade = 'resourceGroups'
    )
    $url = Get-ScimPortalUrl -Name $Name -Blade $Blade
    if (-not $url) { return }
    $e = (Get-ScimTenantMap)[$Name]
    Write-Host ("Opening portal for {0}" -f $e.TenantName) -ForegroundColor Cyan
    Write-Host ("  directory : {0}  [{1}]" -f $e.TenantDomain, $e.Tenant)
    Write-Host ("  url       : {0}" -f $url)
    Start-Process $url
}

function Show-ScimTenants {
    <#
        One table with the NAME and the ID of every tenant, subscription and
        deployment service principal. Read-only, no Azure calls.
    #>
    [CmdletBinding()] param()
    foreach ($e in (Get-ScimTenantMap).Values) {
        Write-Host ""
        Write-Host ("== {0}  [{1}] ==" -f $e.Name, $e.Status) -ForegroundColor Cyan
        Write-Host ("  tenant       : {0}" -f $e.TenantName)
        Write-Host ("  tenant domain: {0}" -f $e.TenantDomain)
        Write-Host ("  tenant id    : {0}" -f $e.Tenant)
        Write-Host ("  subscription : {0}" -f $e.Subscription)
        Write-Host ("  sub id       : {0}" -f $e.SubscriptionId)
        Write-Host ("  deploy SP    : {0}" -f $e.SpName)
        Write-Host ("  deploy SP id : {0}" -f $e.SpAppId)
        Write-Host ("  profile dir  : {0}   (automation / service principal)" -f $e.ConfigDir)
        Write-Host ("  user profile : {0}   (interactive 'az' as yourself)" -f $e.UserConfigDir)
        Write-Host ("  portal       : {0}" -f (Get-ScimPortalUrl -Name $e.Key -Blade 'resourceGroups'))
        foreach ($app in $e.Estates.Keys) {
            Write-Host ("  estate       : app '{0}' in resource group '{1}'" -f $app, $e.Estates[$app])
        }
    }
    Write-Host ""
}

function Set-ScimAzExtensionDir {
    <#
        Point AZURE_EXTENSION_DIR at the ONE shared extension directory.

        This must be called every time AZURE_CONFIG_DIR changes. `az` stores its
        installed extensions under `$AZURE_CONFIG_DIR/cliextensions`, so giving
        each tenant its own profile directory - which is the whole point of this
        module - also gives each tenant its own EMPTY extension set. The default
        `~/.azure` profile has `containerapp`, `account`, `log-analytics`; a fresh
        tenant profile has nothing.

        The failure this prevents is nasty because the error does not mention
        extensions at all. With the extension missing, `az containerapp
        environment show` reports:

            ERROR: 'environment' is misspelled or not recognized by the system.

        which reads like a typo in the command, or like the resource is gone. It
        cost a full misdiagnosis pass during the tenant-09 migration: every ARM
        read came back empty while both apps were provably serving traffic, and
        the obvious (wrong) conclusions were an expired token or a missing estate.

        Sharing the directory is safe: extensions are tenant-agnostic code, not
        credentials. Only the auth state under the profile directory must stay
        isolated, and that is unaffected.

        DO NOT call this for an INTERACTIVE (user) profile. `az login` loads the
        FULL command table and reads every extension's metadata, which on this
        machine fails with `[WinError 5] Access is denied` on azure-devops.
        Lazily-loaded commands such as `containerapp` never read it, so the
        shared directory helps the automation profile and breaks the user one.
        Measured 2026-08-13.
    #>
    [CmdletBinding()] param()
    $shared = Join-Path $HOME '.azure\cliextensions'
    if (-not (Test-Path $shared)) { New-Item -ItemType Directory -Force -Path $shared | Out-Null }
    $env:AZURE_EXTENSION_DIR = $shared
}

function Resolve-ScimTenantEntry {
    [CmdletBinding()]
    param([string]$Name, [string]$Subscription)
    $map = Get-ScimTenantMap
    if ($Name) { return $map[$Name] }
    if ($Subscription) {
        # Prefer an exact SubscriptionId match. Two tenants share the subscription
        # NAME 'ProvIAM_Subscription', so a name match is only safe when it is unique.
        foreach ($e in $map.Values) { if ($e.SubscriptionId -eq $Subscription) { return $e } }
        $byName = @($map.Values | Where-Object { $_.Subscription -eq $Subscription })
        if ($byName.Count -eq 1) { return $byName[0] }
        if ($byName.Count -gt 1) {
            Write-Host "ERROR: subscription name '$Subscription' is ambiguous across $($byName.Count) tenants ($(($byName | ForEach-Object { $_.Key }) -join ', ')). Pass -Name <key> or the subscription ID instead." -ForegroundColor Red
            return $null
        }
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
    Set-ScimAzExtensionDir
    if (-not (Test-Path $entry.ConfigDir)) {
        New-Item -ItemType Directory -Force -Path $entry.ConfigDir | Out-Null
    }

    # 1. Reuse a still-valid cached token in this isolated profile.
    $acct = az account show -o json 2>$null | ConvertFrom-Json
    if ($acct -and $acct.tenantId -eq $entry.Tenant) {
        az account set --subscription $entry.SubscriptionId 2>$null | Out-Null
        return (az account show -o json 2>$null | ConvertFrom-Json)
    }

    # 2. Service principal (fully non-interactive) once setup-deploy-sp.ps1 has run.
    if (Test-Path $entry.CredFile) {
        try {
            $sp = Get-Content $entry.CredFile -Raw | ConvertFrom-Json
            az login --service-principal -u $sp.appId -p $sp.password --tenant $sp.tenant --output none 2>$null
            if ($LASTEXITCODE -eq 0) {
                az account set --subscription $entry.SubscriptionId 2>$null | Out-Null
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
    az account set --subscription $entry.SubscriptionId 2>$null | Out-Null
    return (az account show -o json 2>$null | ConvertFrom-Json)
}

function Connect-ScimUser {
    <#
        Like Connect-ScimTenant but always lands a real USER (never a service
        principal). Required by setup-deploy-sp.ps1, because creating an app
        registration needs a user (or an SP with directory write rights), and an
        SP cannot create another SP by default.

        Uses the tenant's SEPARATE UserConfigDir so a user login and the
        automation service-principal login coexist. Without this, signing in as
        yourself evicts the SP token from the shared profile (and vice versa),
        which is the churn this whole module exists to eliminate.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Entry, [switch]$DeviceCode)

    $dir = if ($Entry.UserConfigDir) { $Entry.UserConfigDir } else { $Entry.ConfigDir }
    $env:AZURE_CONFIG_DIR = $dir
    # Deliberately do NOT share the extension directory here - see
    # Set-ScimAzExtensionDir. `az login` loads the FULL command table, which
    # reads every installed extension's metadata, and on this machine that
    # fails with `[WinError 5] Access is denied` on the azure-devops extension's
    # dist-info. Lazily-loaded commands like `containerapp` never touch it, so
    # the shared directory is safe for the automation profile and unsafe here.
    # Nothing this profile does needs an extension: `az login` and `az ad` are
    # both core commands.
    $env:AZURE_EXTENSION_DIR = $null
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    $acct = az account show -o json 2>$null | ConvertFrom-Json
    if ($acct -and $acct.tenantId -eq $Entry.Tenant -and $acct.user.type -eq 'user') {
        az account set --subscription $Entry.SubscriptionId 2>$null | Out-Null
        return (az account show -o json 2>$null | ConvertFrom-Json)
    }

    Write-Host "Signing into $($Entry.Name) as a user (tenant $($Entry.Tenant))..." -ForegroundColor Cyan
    if ($DeviceCode) {
        # WARNING: device-code sign-in is BLOCKED by Conditional Access in the
        # Microsoft corporate tenants this project uses. It fails with
        # AADSTS530035 even for a Global Administrator on a Compliant device,
        # because the policy blocks the FLOW, not the user - device code is a
        # well-known phishing vector. Measured 2026-08-13. Prefer the default
        # browser flow, which satisfies device-based CA precisely because the
        # machine is compliant. Keep this switch only for a genuinely headless
        # host, where it will need a CA exclusion to work at all.
        az login --tenant $Entry.Tenant --use-device-code --output none
    } else {
        az login --tenant $Entry.Tenant --output none
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: interactive login failed for $($Entry.Name)." -ForegroundColor Red
        return $null
    }
    az account set --subscription $Entry.SubscriptionId 2>$null | Out-Null
    return (az account show -o json 2>$null | ConvertFrom-Json)
}

function Use-ProvIAM09 {
    <# ACTIVE dev + canary prod context (ephemeral tenant 09). #>
    [CmdletBinding()] param([switch]$DeviceCode)
    Connect-ScimTenant -Name 'proviam09' -DeviceCode:$DeviceCode | Out-Null
    Show-AzTenant
}

function Use-ProvIAM {
    <# Retiring ephemeral tenant 08. Kept intact and read-only. #>
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
            Write-Host "  tenant       : $($entry.TenantName)  [$($entry.Tenant)]"
            Write-Host "  tenant domain: $($entry.TenantDomain)"
            Write-Host "  subscription : $($entry.Subscription)  [$($entry.SubscriptionId)]"
            Write-Host "  profile dir  : $($entry.ConfigDir)"

            $env:AZURE_CONFIG_DIR = $entry.ConfigDir
            Set-ScimAzExtensionDir
            $acct = az account show -o json 2>$null | ConvertFrom-Json
            if ($acct) {
                Write-Host "  logged in    : yes ($($acct.user.name), type=$($acct.user.type))" -ForegroundColor Green
            } else {
                $fn = switch ($entry.Key) { 'proviam09' { 'Use-ProvIAM09' } 'proviam' { 'Use-ProvIAM' } default { 'Use-AnandSa' } }
                Write-Host "  logged in    : no (run $fn)" -ForegroundColor Yellow
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
