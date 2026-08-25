<#
.SYNOPSIS
    Liveness probe for the live SCIMServer estates (register item N2).

.DESCRIPTION
    Customer-facing prod was once down and it was found by INSPECTION, not by
    an alert. Every scheduled workflow this repo owns is a static gate - they
    read the repository, never the running estates - so a dead estate between
    two deploys was invisible. `audit-deployment-doc.ps1 -Live` does notice,
    but only runs post-deploy, which is precisely when the estate is known to
    be alive anyway.

    TARGET RESOLUTION, AND WHY IT LOOKS LIKE THIS.
    scim-estates.json forbids storing an FQDN, for good reason: the Container
    Apps environment domain is assigned by Azure and changes at every tenant
    rollover, so a committed FQDN is a value guaranteed to become false. The
    authoritative resolution is an ARM lookup. But scheduled CI has no Azure
    credentials (verified: no workflow references azure/login), and granting
    CI standing access to two production subscriptions in order to run a
    health check would be a poor trade.

    So targets arrive as DERIVED input, in priority order:
      1. -Target             explicit, for local or ad-hoc use
      2. SCIM_ESTATE_URLS    env/CI, refreshed from ARM by the deploy pipeline
      3. the estate registry via ARM, when Azure auth is present

    None of those is committed to the repository, and every one of them is
    refreshed from Azure rather than hand-maintained.

    THE EXIT CODE THAT MATTERS IS 2.
    Resolving zero targets is reported as its own outcome, never as success.
    A probe that checked nothing and a probe that found everything healthy
    must not look the same - that equivalence is the whole reason the
    original outage went unnoticed.

.PARAMETER Target
    One or more base URLs to probe. Overrides every other source.

.PARAMETER TimeoutSec
    Per-estate HTTP timeout. Deliberately short: this asks "is it answering",
    not "is it fast".

.PARAMETER AsModule
    Dot-source the functions without running the probe. Used by the tests.

.EXAMPLE
    pwsh scripts/probe-estates.ps1
    pwsh scripts/probe-estates.ps1 -Target https://scimserver-dev.example.azurecontainerapps.io
#>
[CmdletBinding()]
param(
    [string[]]$Target,
    [int]$TimeoutSec = 20,
    [switch]$AsModule
)

Set-StrictMode -Version Latest

function Resolve-ProbeTarget {
    <#
        Splits a delimited list into clean, probe-able base URLs.
        Rejects anything that is not https: a liveness probe that silently
        accepts http could report an estate healthy over a downgraded
        transport, which is a worse answer than no answer.
    #>
    [CmdletBinding()]
    param([AllowNull()][string]$Raw)

    if ([string]::IsNullOrWhiteSpace($Raw)) { return @() }

    return @(
        $Raw -split '[,;\r\n]' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and $_ -match '^https://' }
    )
}

function Invoke-EstateProbe {
    <#
        Probes each target and returns one result object per target.
        A transport failure IS the signal, so it is captured as a result
        rather than thrown - throwing would abandon the remaining estates
        and turn "one estate is down" into "the probe crashed".
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Targets,
        [scriptblock]$Prober,
        [int]$TimeoutSec = 20
    )

    if (-not $Prober) {
        $Prober = {
            param($Url)
            Invoke-RestMethod -Uri "$Url/scim/health" -Method GET -TimeoutSec $TimeoutSec
        }
    }

    $results = foreach ($t in $Targets) {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $ok = $false
        $detail = ''
        try {
            $body = & $Prober $t
            # A 200 is not the contract; `status: ok` is. An ingress or a
            # stale revision can answer 200 with something else entirely.
            # Read the field without assuming the shape: Invoke-RestMethod
            # yields a PSCustomObject, a caller-supplied prober may yield a
            # hashtable, and StrictMode throws on a missing PSObject property.
            $status = $null
            if ($body -is [System.Collections.IDictionary]) {
                if ($body.Contains('status')) { $status = $body['status'] }
            }
            elseif ($null -ne $body) {
                $prop = $body.PSObject.Properties['status']
                if ($prop) { $status = $prop.Value }
            }
            if ($status -eq 'ok') { $ok = $true; $detail = 'status=ok' }
            else { $detail = "unexpected health body (status='$status')" }
        }
        catch {
            $detail = $_.Exception.Message
        }
        $sw.Stop()

        [pscustomobject]@{
            Url        = $t
            Ok         = $ok
            Detail     = $detail
            DurationMs = [int]$sw.ElapsedMilliseconds
        }
    }

    return @($results)
}

function Get-ProbeExitCode {
    <#
        0 = every target answered healthy
        1 = at least one target is down
        2 = nothing was probed  <- distinct on purpose; see the header
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Results)

    if (@($Results).Count -eq 0) { return 2 }
    if (@($Results | Where-Object { -not $_.Ok }).Count -gt 0) { return 1 }
    return 0
}

function Get-ProbeTargetsFromEnvironment {
    [CmdletBinding()] param()
    return Resolve-ProbeTarget -Raw $env:SCIM_ESTATE_URLS
}

function Get-ProbeTargetsFromRegistry {
    <#
        Authoritative but only available where Azure auth exists. Returns
        empty rather than throwing so the caller can report "nothing to
        probe" as exit 2 instead of dying with a stack trace.
    #>
    [CmdletBinding()] param()

    $helper = Join-Path $PSScriptRoot 'scim-estates.ps1'
    if (-not (Test-Path $helper)) { return @() }

    try {
        . $helper
        $urls = foreach ($purpose in @('dev', 'canary-prod', 'customer-prod')) {
            try { Get-ScimEstateBaseUrl -Purpose $purpose -ErrorAction Stop } catch { }
        }
        return Resolve-ProbeTarget -Raw ($urls -join ',')
    }
    catch { return @() }
}

if ($AsModule) { return }

$targets = @()
$source = ''
if ($Target) {
    $targets = Resolve-ProbeTarget -Raw ($Target -join ',')
    $source = '-Target'
}
if (-not $targets) {
    $targets = Get-ProbeTargetsFromEnvironment
    if ($targets) { $source = 'SCIM_ESTATE_URLS' }
}
if (-not $targets) {
    $targets = Get-ProbeTargetsFromRegistry
    if ($targets) { $source = 'estate registry (ARM)' }
}

Write-Host ''
Write-Host '=== SCIMServer estate liveness ===' -ForegroundColor Cyan

if (-not $targets) {
    Write-Host '  NO TARGETS RESOLVED - reporting exit 2, not success.' -ForegroundColor Red
    Write-Host '  A probe that checked nothing must never look like a probe that passed.' -ForegroundColor Red
    Write-Host '  Supply -Target, set SCIM_ESTATE_URLS, or run where Azure auth is available.' -ForegroundColor Yellow
    exit 2
}

Write-Host ("  {0} target(s) from {1}" -f $targets.Count, $source) -ForegroundColor Gray
$results = Invoke-EstateProbe -Targets $targets -TimeoutSec $TimeoutSec

foreach ($r in $results) {
    $tag = if ($r.Ok) { 'UP  ' } else { 'DOWN' }
    $colour = if ($r.Ok) { 'Green' } else { 'Red' }
    Write-Host ("  [{0}] {1}  ({2} ms)  {3}" -f $tag, $r.Url, $r.DurationMs, $r.Detail) -ForegroundColor $colour
}

$code = Get-ProbeExitCode -Results $results
Write-Host ''
switch ($code) {
    0 { Write-Host ("  All {0} estate(s) healthy." -f $results.Count) -ForegroundColor Green }
    1 { Write-Host ("  {0} of {1} estate(s) DOWN." -f (@($results | Where-Object { -not $_.Ok }).Count), $results.Count) -ForegroundColor Red }
}
exit $code
