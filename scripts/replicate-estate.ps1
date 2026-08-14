<#
.SYNOPSIS
    Replicate a SCIMServer estate into another tenant, end to end, addressing
    both sides by ROLE rather than by hardcoded name.

.DESCRIPTION
    This is the generic form of the 2026-08-12 tenant-09 cutover. That run was
    performed with a sequence of one-off commands; this script encodes the same
    sequence so the next rollover - due roughly every 80 days - is repeatable and
    reviewable instead of improvised.

    PHASES
      1 preflight   both tenants reachable, target provisioned, extensions
                    correct, source connection string captured
      2 carry       database-level copy via rotate-tenant-data.ps1
      3 verify      counts, per-endpoint surfaces, server-level state, live SCIM
      4 cutover     reassign roles in scripts/scim-estates.json (opt-in)

    WHY DATABASE-LEVEL AND NOT THE SCIM API.
    The 2026-05-19 migration replayed the SCIM API (migrate-old-prod.ps1: GET
    from the old estate, POST to the new one). That works, but it is a
    RE-CREATION, not a copy: the target mints new primary keys, so every
    resource id changes and every configured SCIM client breaks. It also cannot
    carry anything the API does not expose - credential secretEnvelopes, data
    encryption keys, the JWKS host allow-list, server settings. The 2026-08-12
    run used pg_dump into psql precisely to preserve ids, and even then a
    server-level allow-list was silently lost because the mirror script
    enumerated resource models only.

    So: carry the DATABASE, and verify SERVER-LEVEL state explicitly, because
    resource counts cannot see it.

.PARAMETER SourceId
    Estate id to copy FROM (see scripts/scim-estates.json).

.PARAMETER TargetId
    Estate id to copy INTO.

.PARAMETER SourceConnectionString
    PostgreSQL URI for the source. Required when the source tenant's ARM has
    expired, because the connection string can no longer be read from Azure.
    CAPTURE THIS BEFORE A TENANT EXPIRES - subscription expiry kills the ARM
    control plane but NOT the PostgreSQL data plane, and that asymmetry is what
    made the 2026-08-12 recovery possible at all.

.PARAMETER TargetConnectionString
    PostgreSQL URI for the target.

.PARAMETER Phase
    preflight | carry | verify | cutover | all. Default preflight, because the
    destructive phase should never be the default.

.PARAMETER Confirm
    Required for 'carry' and 'all'. The carry TRUNCATES and reloads the target.

.EXAMPLE
    # Look before leaping - this is the default and makes no changes.
    pwsh -File scripts/replicate-estate.ps1 -SourceId dev-retiring -TargetId dev `
         -SourceConnectionString $src -TargetConnectionString $dst

.EXAMPLE
    # Prove the whole flow against a THROWAWAY estate before trusting it with dev.
    pwsh -File scripts/replicate-estate.ps1 -SourceId dev -TargetId trial `
         -SourceConnectionString $src -TargetConnectionString $dst -Phase all -Confirm
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceId,
    [Parameter(Mandatory)][string]$TargetId,
    [string]$SourceConnectionString,
    [string]$TargetConnectionString,
    [ValidateSet('preflight', 'carry', 'verify', 'cutover', 'all')]
    [string]$Phase = 'preflight',
    [switch]$Confirm,
    [string]$ScimSecret = 'changeme-scim',
    [string]$OauthSecret = 'changeme-oauth'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scim-estates.ps1')

$script:results = @()
function Add-Result {
    param([string]$Check, [string]$Status, [string]$Detail)
    $script:results += [pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }
    $colour = switch ($Status) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Yellow' } }
    Write-Host ("  [{0}] {1}{2}" -f $Status, $Check, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor $colour
}

Write-Host ""
Write-Host "=== estate replication ===" -ForegroundColor Cyan

if (-not (Test-ScimEstateRegistry -Quiet)) { throw "scripts/scim-estates.json is invalid. Run scripts/test-scim-estates.ps1." }

$src = Get-ScimEstate -Id $SourceId
$dst = Get-ScimEstate -Id $TargetId

Write-Host ("  source : {0}  [{1}]  app {2} / rg {3}  tenant {4} ({5})" -f $src.id, $src.Role, $src.appName, $src.resourceGroup, $src.Tenant.key, $src.Tenant.tenantName)
Write-Host ("  target : {0}  [{1}]  app {2} / rg {3}  tenant {4} ({5})" -f $dst.id, $dst.Role, $dst.appName, $dst.resourceGroup, $dst.Tenant.key, $dst.Tenant.tenantName)
Write-Host ("  phase  : {0}" -f $Phase)

# A copy INTO customer production is never something this script should do.
if ($dst.purpose -eq 'customer-prod') {
    Write-Host ""
    Write-Host "REFUSING: the target is customer-facing production." -ForegroundColor Red
    Write-Host "Replicating INTO it would overwrite live customer data. If you are trying to"
    Write-Host "take a COPY OF it for analysis, make the copy the TARGET and customer-prod the"
    Write-Host "SOURCE, into a trial estate."
    exit 3
}

$doPre = $Phase -in @('preflight', 'all')
$doCarry = $Phase -in @('carry', 'all')
$doVerify = $Phase -in @('verify', 'all')
$doCutover = $Phase -in @('cutover', 'all')

# ---------------------------------------------------------------- phase 1
if ($doPre) {
    Write-Host ""
    Write-Host "-- phase 1: preflight" -ForegroundColor Cyan

    # The target must be reachable over ARM. The source may legitimately not be:
    # a retiring tenant's control plane expires while its data plane keeps serving.
    try {
        $dstFqdn = Get-ScimEstateFqdn -Id $TargetId -Refresh
        Add-Result 'target reachable over ARM' 'PASS' $dstFqdn
    }
    catch {
        Add-Result 'target reachable over ARM' 'FAIL' $_.Exception.Message
    }

    try {
        $srcFqdn = Get-ScimEstateFqdn -Id $SourceId -Refresh
        Add-Result 'source reachable over ARM' 'PASS' $srcFqdn
    }
    catch {
        Add-Result 'source reachable over ARM' 'WARN' "ARM unavailable (expected for a retiring tenant). The data plane may still be fine."
    }

    if (-not $SourceConnectionString) {
        Add-Result 'source connection string supplied' 'FAIL' 'Required. Capture it BEFORE the source tenant expires - ARM dies, PostgreSQL does not.'
    }
    else { Add-Result 'source connection string supplied' 'PASS' '' }

    if (-not $TargetConnectionString) { Add-Result 'target connection string supplied' 'FAIL' 'Required.' }
    else { Add-Result 'target connection string supplied' 'PASS' '' }

    # The extension allow-list is a static server parameter and a restore fails
    # without it. pg_dump of a source that HAS uuid-ossp emits CREATE EXTENSION
    # "uuid-ossp", which Azure rejects against a target that does not allow-list
    # it. This exact drift broke the 2026-08-12 canary-prod carry while the dev
    # carry succeeded, which made a DATA-specific fault look ENVIRONMENT-specific.
    $required = @('CITEXT', 'PG_TRGM', 'PGCRYPTO', 'UUID-OSSP')
    try {
        $savedCfg = $env:AZURE_CONFIG_DIR; $savedExt = $env:AZURE_EXTENSION_DIR
        $env:AZURE_CONFIG_DIR = $dst.Tenant.ConfigDirPath
        $shared = Join-Path $HOME '.azure/cliextensions'
        if (Test-Path $shared) { $env:AZURE_EXTENSION_DIR = $shared }

        $ext = az postgres flexible-server parameter show -g $dst.pgResourceGroup -s $dst.pgServerName `
            --subscription $dst.Tenant.subscriptionId --name azure.extensions --query value -o tsv 2>$null
        $env:AZURE_CONFIG_DIR = $savedCfg; $env:AZURE_EXTENSION_DIR = $savedExt

        if ($ext) {
            $have = @($ext -split ',' | ForEach-Object { $_.Trim().ToUpper() })
            $missing = @($required | Where-Object { $have -notcontains $_ })
            if ($missing.Count -eq 0) { Add-Result 'target azure.extensions superset' 'PASS' $ext }
            else { Add-Result 'target azure.extensions superset' 'FAIL' "missing: $($missing -join ', '). A restore emitting CREATE EXTENSION for these will be rejected." }
        }
        else { Add-Result 'target azure.extensions superset' 'WARN' 'could not read the parameter' }
    }
    catch { Add-Result 'target azure.extensions superset' 'WARN' $_.Exception.Message }
}

# ---------------------------------------------------------------- phase 2
if ($doCarry) {
    Write-Host ""
    Write-Host "-- phase 2: carry" -ForegroundColor Cyan
    if (-not $Confirm) {
        Add-Result 'carry' 'FAIL' 'refused without -Confirm; this TRUNCATES and reloads the target database'
    }
    elseif (-not $SourceConnectionString -or -not $TargetConnectionString) {
        Add-Result 'carry' 'FAIL' 'both connection strings are required'
    }
    else {
        $rotate = Join-Path $PSScriptRoot 'rotate-tenant-data.ps1'
        Write-Host "   delegating to rotate-tenant-data.ps1 (runs pg_dump | psql INSIDE Azure)"
        & $rotate `
            -SourceConnectionString $SourceConnectionString `
            -TargetConnectionString $TargetConnectionString `
            -TargetResourceGroup $dst.environmentResourceGroup `
            -EnvironmentName $dst.environmentName `
            -Subscription $dst.Tenant.subscriptionId `
            -AzureConfigDir $dst.Tenant.ConfigDirPath `
            -JobName "scim-replicate-$($dst.id)" `
            -TargetAppName $dst.appName `
            -TargetAppResourceGroup $dst.resourceGroup
        if ($LASTEXITCODE -eq 0) { Add-Result 'carry' 'PASS' 'rotate-tenant-data.ps1 completed' }
        else { Add-Result 'carry' 'FAIL' "rotate-tenant-data.ps1 exit $LASTEXITCODE" }
    }
}

# ---------------------------------------------------------------- phase 3
if ($doVerify) {
    Write-Host ""
    Write-Host "-- phase 3: verify" -ForegroundColor Cyan

    $base = Get-ScimEstateBaseUrl -Id $TargetId -Refresh
    $hdr = @{ Authorization = "Bearer $ScimSecret" }

    try {
        $v = Invoke-RestMethod "$base/scim/admin/version" -Headers $hdr -TimeoutSec 40
        Add-Result 'target serves' 'PASS' "v$($v.version) node=$($v.runtime.node)"
    }
    catch { Add-Result 'target serves' 'FAIL' $_.Exception.Message }

    try {
        $eps = (Invoke-RestMethod "$base/scim/admin/endpoints?count=500" -Headers $hdr -TimeoutSec 90).endpoints
        Add-Result 'endpoints present' $(if (@($eps).Count -gt 0) { 'PASS' } else { 'FAIL' }) "$(@($eps).Count) endpoint(s)"
    }
    catch { Add-Result 'endpoints present' 'FAIL' $_.Exception.Message }

    # SERVER-LEVEL state. This is the check the 2026-08-12 run did not have.
    # Every verification that day was resource-shaped - count endpoints, count
    # users, walk each endpoint's surfaces - and all of it passed while the JWKS
    # host allow-list had silently reverted to its seeded default. Counts cannot
    # see a singleton.
    #
    # Compare against the SOURCE whenever the source is reachable. Comparing the
    # target's effective list against its own seed is a weak proxy that stops
    # discriminating the moment the seed catches up: after the v0.55.6 release
    # added login.windows.net to the seed, a fully-carried estate and a fully-
    # reverted one both report effective == seed. Only the source knows what
    # was supposed to arrive.
    $srcHosts = $null
    try {
        $srcBase = Get-ScimEstateBaseUrl -Id $SourceId -Refresh
        $srcHosts = @((Invoke-RestMethod "$srcBase/scim/admin/settings/jwks-hosts" -Headers $hdr -TimeoutSec 40).effective)
    }
    catch {
        # A retiring tenant has no ARM, so the FQDN cannot be derived. The data
        # plane may still serve, but we have no way to address it from here.
        $srcHosts = $null
    }

    try {
        $j = Invoke-RestMethod "$base/scim/admin/settings/jwks-hosts" -Headers $hdr -TimeoutSec 40
        $eff = @($j.effective)
        $seed = @($j.seed)

        if ($srcHosts) {
            $lost = @($srcHosts | Where-Object { $eff -notcontains $_ })
            if ($lost.Count -eq 0) {
                Add-Result 'server-level: JWKS allow-list vs SOURCE' 'PASS' "all $($srcHosts.Count) source host(s) present on the target"
            }
            else {
                Add-Result 'server-level: JWKS allow-list vs SOURCE' 'FAIL' "LOST from the source: $($lost -join ', ')"
            }
        }
        else {
            $extra = @($eff | Where-Object { $seed -notcontains $_ })
            if ($extra.Count -gt 0) {
                Add-Result 'server-level: JWKS allow-list' 'PASS' "effective=$($eff.Count), operator-added beyond the seed: $($extra -join ', ')"
            }
            else {
                Add-Result 'server-level: JWKS allow-list' 'WARN' "effective=$($eff.Count) equals the seed and the SOURCE IS UNREACHABLE, so carried and reverted are indistinguishable. Verify by hand before accepting."
            }
        }
    }
    catch { Add-Result 'server-level: JWKS allow-list' 'FAIL' $_.Exception.Message }

    Write-Host ""
    Write-Host "   run the full live SCIM contract suite against the target:" -ForegroundColor Yellow
    Write-Host "     pwsh -File scripts/live-test.ps1 -BaseUrl $base -ClientSecret $OauthSecret"
}

# ---------------------------------------------------------------- phase 4
if ($doCutover) {
    Write-Host ""
    Write-Host "-- phase 4: cutover" -ForegroundColor Cyan
    if ($script:results | Where-Object { $_.Status -eq 'FAIL' }) {
        Add-Result 'cutover' 'FAIL' 'refused: an earlier phase reported FAIL'
    }
    else {
        Write-Host "   a cutover is a ROLE REASSIGNMENT, not a find-and-replace:" -ForegroundColor Yellow
        Write-Host "     Set-ScimEstateRole -TenantKey $($dst.Tenant.key) -Role active"
        Write-Host "     Set-ScimEstateRole -TenantKey $($src.Tenant.key) -Role retiring"
        Write-Host "   Both are validated before they are written, so the registry cannot be left"
        Write-Host "   with zero or two active estates for a purpose."
        Add-Result 'cutover' 'INFO' 'commands printed; run them deliberately'
    }
}

Write-Host ""
Write-Host "=== summary ===" -ForegroundColor Cyan
$script:results | Format-Table -AutoSize
$failed = @($script:results | Where-Object { $_.Status -eq 'FAIL' })
if ($failed.Count -gt 0) {
    Write-Host ("{0} check(s) FAILED" -f $failed.Count) -ForegroundColor Red
    exit 1
}
Write-Host "no failures" -ForegroundColor Green
