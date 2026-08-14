<#
.SYNOPSIS
    Resolve SCIMServer estates by ROLE and PURPOSE instead of by hardcoded name,
    and derive their FQDNs from Azure at run time.

.DESCRIPTION
    Dot-source this file:

        . ./scripts/scim-estates.ps1

    Then address estates by what they ARE, not where they happen to live today:

        Get-ScimEstate -Purpose dev                    # the ACTIVE dev estate
        Get-ScimEstate -Purpose canary-prod
        Get-ScimEstate -Purpose customer-prod
        Get-ScimEstateFqdn -Purpose dev                # derived from ARM, never stored
        Get-ScimEstateBaseUrl -Purpose dev             # https://<fqdn>
        Show-ScimEstates                               # everything, with names AND ids

    The registry is scripts/scim-estates.json. See its $comment block for why
    FQDNs are never stored and why the role vocabulary is deliberately finite.

.NOTES
    This module is READ-MOSTLY and makes no Azure calls unless you ask for an
    FQDN. Test-ScimEstateRegistry is pure and runs offline, which is what makes
    it usable as a fast gate.
#>

$script:ScimEstateRegistryPath = Join-Path $PSScriptRoot 'scim-estates.json'
$script:ScimFqdnCache = @{}

function Expand-ScimPath {
    <# ~ is not expanded by .NET path APIs; do it explicitly and consistently. #>
    param([string]$Path)
    if (-not $Path) { return $Path }
    if ($Path.StartsWith('~')) { return (Join-Path $HOME $Path.Substring(1).TrimStart('/', '\')) }
    return $Path
}

function Get-ScimEstateRegistry {
    <#
        Read and shape the registry. Tenant fields are merged onto each estate so
        callers never have to join the two lists by hand and cannot accidentally
        pair an estate with the wrong tenant.
    #>
    [CmdletBinding()] param([string]$Path)

    $p = if ($Path) { $Path } else { $script:ScimEstateRegistryPath }
    if (-not (Test-Path $p)) { throw "Estate registry not found at $p" }

    $raw = Get-Content $p -Raw | ConvertFrom-Json

    $tenantsByKey = @{}
    foreach ($t in $raw.tenants) {
        $t | Add-Member -NotePropertyName ConfigDirPath -NotePropertyValue (Expand-ScimPath $t.configDir) -Force
        $t | Add-Member -NotePropertyName UserConfigDirPath -NotePropertyValue (Expand-ScimPath $t.userConfigDir) -Force
        $t | Add-Member -NotePropertyName CredFilePath -NotePropertyValue (Expand-ScimPath $t.credFile) -Force
        $tenantsByKey[$t.key] = $t
    }

    foreach ($e in $raw.estates) {
        $t = $tenantsByKey[$e.tenantKey]
        $e | Add-Member -NotePropertyName Tenant -NotePropertyValue $t -Force
        # An estate inherits its tenant's role. There is no such thing as an
        # "active estate on a retiring tenant" - the tenant is what expires.
        $e | Add-Member -NotePropertyName Role -NotePropertyValue $(if ($t) { $t.role } else { $null }) -Force
    }

    return $raw
}

function Test-ScimEstateRegistry {
    <#
        Validate the registry's OWN integrity. A registry that is internally
        inconsistent is worse than none, because every consumer trusts it.

        Checks, each of which corresponds to a defect that has actually occurred
        or is one bulk-edit away:
          R1 every estate references a tenant that exists
          R2 subscription IDs are unique across tenants (two tenants share the
             NAME 'ProvIAM_Subscription', so a name match would silently target
             the wrong one - resolution keys on ID for exactly this reason)
          R3 tenant IDs are unique
          R4 every role is in the finite vocabulary
          R5 exactly ONE active estate per purpose (dev / canary-prod), so
             'the dev estate' is never ambiguous
          R6 customer-prod is on a 'permanent' tenant and is never 'active'
          R7 NO estate stores an FQDN or a bare environment domain - the whole
             point of the file
    #>
    [CmdletBinding()] param([string]$Path, [switch]$Quiet)

    $reg = Get-ScimEstateRegistry -Path $Path
    $failures = @()
    $validRoles = @('active', 'next', 'retiring', 'permanent', 'trial')

    $tenantKeys = @($reg.tenants | ForEach-Object { $_.key })
    foreach ($e in $reg.estates) {
        if ($tenantKeys -notcontains $e.tenantKey) {
            $failures += "R1 estate '$($e.id)' references unknown tenant '$($e.tenantKey)'"
        }
    }

    $dupSub = $reg.tenants | Group-Object subscriptionId | Where-Object { $_.Count -gt 1 }
    foreach ($d in $dupSub) { $failures += "R2 subscriptionId $($d.Name) is shared by $($d.Count) tenants ($(($d.Group | ForEach-Object { $_.key }) -join ', '))" }

    $dupTen = $reg.tenants | Group-Object tenantId | Where-Object { $_.Count -gt 1 }
    foreach ($d in $dupTen) { $failures += "R3 tenantId $($d.Name) is shared by $($d.Count) tenants" }

    foreach ($t in $reg.tenants) {
        if ($validRoles -notcontains $t.role) { $failures += "R4 tenant '$($t.key)' has role '$($t.role)', not one of: $($validRoles -join ', ')" }
    }

    foreach ($purpose in @('dev', 'canary-prod')) {
        $act = @($reg.estates | Where-Object { $_.purpose -eq $purpose -and $_.Role -eq 'active' })
        if ($act.Count -ne 1) {
            $failures += "R5 purpose '$purpose' has $($act.Count) ACTIVE estate(s); exactly 1 is required"
        }
    }

    foreach ($e in ($reg.estates | Where-Object { $_.purpose -eq 'customer-prod' })) {
        if ($e.Role -ne 'permanent') { $failures += "R6 customer-prod estate '$($e.id)' is on a '$($e.Role)' tenant; it must be 'permanent'" }
    }

    # R7 - a stored FQDN is the defect this whole file exists to remove.
    $rawText = Get-Content $(if ($Path) { $Path } else { $script:ScimEstateRegistryPath }) -Raw
    foreach ($m in [regex]::Matches($rawText, '[a-z0-9-]+\.azurecontainerapps\.io')) {
        # Allowed only inside the $comment block, where the whole point is to
        # explain the rule using real examples.
        $failures += "R7 registry contains an FQDN '$($m.Value)'. FQDNs are DERIVED from ARM, never stored."
    }

    if ($failures.Count -gt 0) {
        if (-not $Quiet) {
            Write-Host ""
            Write-Host "ESTATE REGISTRY INVALID" -ForegroundColor Red
            $failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        }
        return $false
    }

    if (-not $Quiet) {
        Write-Host "estate registry OK - $($reg.tenants.Count) tenants, $($reg.estates.Count) estates" -ForegroundColor Green
    }
    return $true
}

function Get-ScimEstate {
    <#
        Resolve ONE estate.

        -Purpose dev|canary-prod|customer-prod  returns the estate for that
            purpose whose tenant role is 'active' (or 'permanent' for
            customer-prod). This is the form every script should use.

        -Id <id>  returns a specific estate by id, including retiring ones.
    #>
    [CmdletBinding(DefaultParameterSetName = 'ByPurpose')]
    param(
        [Parameter(ParameterSetName = 'ByPurpose', Mandatory)]
        [ValidateSet('dev', 'canary-prod', 'customer-prod')]
        [string]$Purpose,

        [Parameter(ParameterSetName = 'ById', Mandatory)]
        [string]$Id,

        [Parameter(ParameterSetName = 'ByPurpose')]
        [ValidateSet('active', 'next', 'retiring', 'permanent', 'trial')]
        [string]$Role,

        [string]$Path
    )

    $reg = Get-ScimEstateRegistry -Path $Path

    if ($PSCmdlet.ParameterSetName -eq 'ById') {
        $hit = @($reg.estates | Where-Object { $_.id -eq $Id })
        if ($hit.Count -ne 1) { throw "Estate id '$Id' matched $($hit.Count) entries." }
        return $hit[0]
    }

    $wantRole = if ($Role) { $Role } elseif ($Purpose -eq 'customer-prod') { 'permanent' } else { 'active' }
    $hit = @($reg.estates | Where-Object { $_.purpose -eq $Purpose -and $_.Role -eq $wantRole })
    if ($hit.Count -ne 1) {
        throw "Purpose '$Purpose' with role '$wantRole' matched $($hit.Count) estates. Fix scripts/scim-estates.json."
    }
    return $hit[0]
}

function Get-ScimEstateFqdn {
    <#
        DERIVE the ingress FQDN from Azure. Never stored, because Azure assigns
        the environment domain at creation time and it differs on every rebuild.

        Cached per process so a script that asks repeatedly does not pay for it
        repeatedly. Pass -Refresh to force a re-read.
    #>
    [CmdletBinding()]
    param(
        [ValidateSet('dev', 'canary-prod', 'customer-prod')] [string]$Purpose,
        [string]$Id,
        [switch]$Refresh,
        [string]$Path
    )

    $estate = if ($Id) { Get-ScimEstate -Id $Id -Path $Path } else { Get-ScimEstate -Purpose $Purpose -Path $Path }
    $cacheKey = "$($estate.id)"
    if (-not $Refresh -and $script:ScimFqdnCache.ContainsKey($cacheKey)) { return $script:ScimFqdnCache[$cacheKey] }

    $savedCfg = $env:AZURE_CONFIG_DIR
    $savedExt = $env:AZURE_EXTENSION_DIR
    try {
        $env:AZURE_CONFIG_DIR = $estate.Tenant.ConfigDirPath
        # containerapp is an EXTENSION and lives under AZURE_CONFIG_DIR, so an
        # isolated per-tenant profile starts with none. Point at the shared set.
        $shared = Join-Path $HOME '.azure/cliextensions'
        if (Test-Path $shared) { $env:AZURE_EXTENSION_DIR = $shared }

        $fqdn = az containerapp show -n $estate.appName -g $estate.resourceGroup `
            --subscription $estate.Tenant.subscriptionId `
            --query 'properties.configuration.ingress.fqdn' -o tsv 2>$null

        if ($LASTEXITCODE -ne 0 -or -not $fqdn) {
            throw "Could not resolve the FQDN for estate '$($estate.id)' (app $($estate.appName) in $($estate.resourceGroup)). If its tenant role is 'retiring', ARM may have expired - the app can still be serving while being unmanageable."
        }
        $script:ScimFqdnCache[$cacheKey] = $fqdn.Trim()
        return $script:ScimFqdnCache[$cacheKey]
    }
    finally {
        $env:AZURE_CONFIG_DIR = $savedCfg
        $env:AZURE_EXTENSION_DIR = $savedExt
    }
}

function Get-ScimEstateBaseUrl {
    [CmdletBinding()]
    param(
        [ValidateSet('dev', 'canary-prod', 'customer-prod')] [string]$Purpose,
        [string]$Id,
        [switch]$Refresh,
        [string]$Path
    )
    $fqdn = if ($Id) { Get-ScimEstateFqdn -Id $Id -Refresh:$Refresh -Path $Path } else { Get-ScimEstateFqdn -Purpose $Purpose -Refresh:$Refresh -Path $Path }
    return "https://$fqdn"
}

function Show-ScimEstates {
    <# Every tenant and estate, with NAMES as well as IDS. No Azure calls. #>
    [CmdletBinding()] param([string]$Path)
    $reg = Get-ScimEstateRegistry -Path $Path

    foreach ($t in $reg.tenants) {
        Write-Host ""
        Write-Host ("== {0}  [role: {1}] ==" -f $t.tenantName, $t.role) -ForegroundColor Cyan
        Write-Host ("  tenant domain  : {0}" -f $t.tenantDomain)
        Write-Host ("  tenant id      : {0}" -f $t.tenantId)
        Write-Host ("  subscription   : {0}  [{1}]" -f $t.subscriptionName, $t.subscriptionId)
        Write-Host ("  deploy SP      : {0}  [{1}]" -f $t.deploySpName, $t.deploySpAppId)
        Write-Host ("  secret expires : {0}" -f $t.deploySpSecretExpiresUtc)
        Write-Host ("  directory acc. : {0}" -f $(if ($t.directoryAccessGranted) { 'granted - app registrations need no sign-in' } else { 'NOT granted - directory work needs an interactive sign-in' }))
        Write-Host ("  profile dirs   : {0}  (automation) / {1}  (interactive)" -f $t.configDir, $t.userConfigDir)

        foreach ($e in ($reg.estates | Where-Object { $_.tenantKey -eq $t.key })) {
            Write-Host ("  estate '{0}' [{1}]: app '{2}' in rg '{3}', pg '{4}'" -f $e.id, $e.purpose, $e.appName, $e.resourceGroup, $e.pgServerName)
        }
    }
    Write-Host ""
    Write-Host "FQDNs are intentionally absent: they are derived from ARM via Get-ScimEstateFqdn." -ForegroundColor Yellow
    Write-Host ""
}

function Set-ScimEstateRole {
    <#
        Reassign a tenant's role. This is what a cutover IS - one edit here
        instead of a repo-wide find-and-replace.

        Refuses to leave the registry invalid: the change is applied to an
        in-memory copy, validated, and only then written.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$TenantKey,
        [Parameter(Mandatory)][ValidateSet('active', 'next', 'retiring', 'permanent', 'trial')][string]$Role,
        [string]$Path
    )

    $p = if ($Path) { $Path } else { $script:ScimEstateRegistryPath }
    $reg = Get-Content $p -Raw | ConvertFrom-Json
    $t = $reg.tenants | Where-Object { $_.key -eq $TenantKey }
    if (-not $t) { throw "Unknown tenant key '$TenantKey'." }

    $old = $t.role
    if ($old -eq 'permanent' -and $Role -ne 'permanent') {
        throw "Refusing to move '$TenantKey' out of 'permanent'. That role marks customer-facing production."
    }

    if ($PSCmdlet.ShouldProcess($TenantKey, "role $old -> $Role")) {
        $t.role = $Role
        $tmp = [IO.Path]::GetTempFileName()
        ($reg | ConvertTo-Json -Depth 10) | Set-Content -Path $tmp -Encoding utf8
        if (-not (Test-ScimEstateRegistry -Path $tmp -Quiet)) {
            Remove-Item $tmp -ErrorAction SilentlyContinue
            throw "That role change would make the registry invalid (most likely 0 or 2 active estates for a purpose). Nothing was written."
        }
        Move-Item -Force $tmp $p
        Write-Host "tenant '$TenantKey' role: $old -> $Role" -ForegroundColor Green
    }
}
