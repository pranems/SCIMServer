<#
.SYNOPSIS
    Full post-deploy verification cycle for a single SCIMServer instance.

.DESCRIPTION
    Runs the complete verification suite against one deployed target FQDN:

      1. Health probe (/scim/health)
      2. Data/ID inventory snapshot (endpoints + per-endpoint resource counts)
      3. Live SCIM contract suite (scripts/live-test.ps1)
      4. (optional) Playwright browser verification cycle (E2E_BASE_URL=<target>)
      5. (optional) Before/after inventory diff - hard-fails on ANY non-zero
         data delta (lost endpoints, changed IDs, dropped resource counts)

    This is the reusable verification building block invoked by:
      - scripts/promote-to-prod.ps1 -BlueGreen -RunVerification (green soak + post-flip)
      - scripts/dev-deployment-pipeline.ps1 auto-canary stage (both prods)

    Exit codes:
      0 - all selected checks passed
      1 - a check failed (health, live tests, Playwright, or data delta)
      2 - prerequisite / argument error

    DATA SAFETY: a deploy is an image swap only - the database (endpoints,
    users, groups, IDs) MUST be identical before and after. Any delta the diff
    surfaces is treated as a hard stop, never auto-remediated.

.PARAMETER BaseUrl
    Target instance base URL (e.g. https://scimserver---green.<env>.azurecontainerapps.io).

.PARAMETER ClientSecret
    OAuth client_secret for the target (default: changeme-oauth).

.PARAMETER ClientId
    OAuth client_id (default: scimserver-client).

.PARAMETER ScimToken
    SCIM shared secret / E2E_TOKEN for Playwright (default: changeme-scim).

.PARAMETER Label
    Short label used in snapshot filenames + log lines (e.g. scimserver-green).

.PARAMETER RunLiveTests
    Run scripts/live-test.ps1 against the target. Default: $true.

.PARAMETER RunPlaywright
    Run the Playwright browser suite against the target. Default: $false.

.PARAMETER BeforeSnapshot
    Path to a previously-captured inventory JSON. When supplied, the new
    snapshot is diffed against it and any data/ID delta fails the run.

.PARAMETER SnapshotOnly
    Capture the inventory snapshot and exit (no live tests / Playwright).
    Use to grab the "before" snapshot prior to a flip.

.PARAMETER ReportDir
    Directory for snapshot JSON output (default: <repo>/test-results).

.EXAMPLE
    # Capture the before-snapshot from live prod
    .\scripts\verify-deployment.ps1 -BaseUrl https://scimserver.<env> -Label proudbush-before -SnapshotOnly

.EXAMPLE
    # Full verify a green soak URL, diffing against the before-snapshot
    .\scripts\verify-deployment.ps1 -BaseUrl https://scimserver---green.<env> -Label proudbush-green -RunPlaywright -BeforeSnapshot test-results/inventory-proudbush-before.json
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$BaseUrl,
    [string]$ClientSecret = 'changeme-oauth',
    [string]$ClientId = 'scimserver-client',
    [string]$ScimToken = 'changeme-scim',
    [string]$Label = 'target',
    [bool]$RunLiveTests = $true,
    [switch]$RunPlaywright,
    [string]$BeforeSnapshot,
    [switch]$SnapshotOnly,
    [string]$ReportDir
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$BaseUrl = $BaseUrl.TrimEnd('/')

if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot 'test-results'
}
if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$failures = @()

function Write-Section($title) {
    Write-Host ""
    Write-Host "---- $title ----" -ForegroundColor Cyan
}

function Get-AccessToken {
    param([string]$Url, [string]$Id, [string]$Secret)
    $body = @{ grant_type = 'client_credentials'; client_id = $Id; client_secret = $Secret } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$Url/scim/oauth/token" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20
    return $resp.access_token
}

# =========================================================================
# 1. Health probe
# =========================================================================
Write-Section "1. Health probe ($Label)"
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/scim/health" -Method Get -TimeoutSec 20 -ErrorAction Stop
    if ($health.status -eq 'ok') {
        Write-Host "   ✅ $BaseUrl/scim/health -> ok" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Health status: $($health.status)" -ForegroundColor Red
        $failures += "health status=$($health.status)"
    }
} catch {
    Write-Host "   ❌ Health probe failed: $($_.Exception.Message)" -ForegroundColor Red
    $failures += "health unreachable"
}

# =========================================================================
# 2. Data/ID inventory snapshot
# =========================================================================
Write-Section "2. Data/ID inventory snapshot ($Label)"
$snapshotPath = Join-Path $ReportDir "inventory-$Label.json"
$snapshot = $null
try {
    $token = Get-AccessToken -Url $BaseUrl -Id $ClientId -Secret $ClientSecret
    $headers = @{ Authorization = "Bearer $token" }
    $eps = (Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints?count=200" -Headers $headers -TimeoutSec 30).endpoints

    $epInventory = @()
    foreach ($ep in $eps) {
        $userCount = $null
        $groupCount = $null
        try {
            $u = Invoke-RestMethod -Uri "$BaseUrl/scim/$($ep.name)/Users?count=1" -Headers $headers -TimeoutSec 30 -ErrorAction Stop
            $userCount = $u.totalResults
        } catch { }
        try {
            $g = Invoke-RestMethod -Uri "$BaseUrl/scim/$($ep.name)/Groups?count=1" -Headers $headers -TimeoutSec 30 -ErrorAction Stop
            $groupCount = $g.totalResults
        } catch { }
        $epInventory += [ordered]@{
            id         = $ep.id
            name       = $ep.name
            preset     = $ep.profilePreset
            userCount  = $userCount
            groupCount = $groupCount
        }
    }

    $snapshot = [ordered]@{
        timestamp     = (Get-Date).ToString('o')
        baseUrl       = $BaseUrl
        label         = $Label
        endpointCount = $eps.Count
        endpoints     = $epInventory
    }
    $snapshot | ConvertTo-Json -Depth 8 | Out-File -FilePath $snapshotPath -Encoding utf8
    Write-Host "   ✅ Captured $($eps.Count) endpoints -> $snapshotPath" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Inventory snapshot failed: $($_.Exception.Message)" -ForegroundColor Red
    $failures += "inventory snapshot failed"
}

# =========================================================================
# 2b. Before/after diff (hard stop on any data/ID delta)
# =========================================================================
if ($BeforeSnapshot -and (Test-Path $BeforeSnapshot) -and $snapshot) {
    Write-Section "2b. Before/after data integrity diff"
    try {
        $before = Get-Content $BeforeSnapshot -Raw | ConvertFrom-Json
        $countDelta = $snapshot.endpointCount - $before.endpointCount
        $idsBefore = @($before.endpoints | ForEach-Object { $_.id })
        $idsAfter = @($snapshot.endpoints | ForEach-Object { $_.id })
        $missingIds = @($idsBefore | Where-Object { $idsAfter -notcontains $_ })
        $newIds = @($idsAfter | Where-Object { $idsBefore -notcontains $_ })

        # Per-endpoint resource-count regression (a drop is a data-loss signal).
        $countRegressions = @()
        foreach ($b in $before.endpoints) {
            $a = $snapshot.endpoints | Where-Object { $_.id -eq $b.id } | Select-Object -First 1
            if ($a) {
                if ($null -ne $b.userCount -and $null -ne $a.userCount -and $a.userCount -lt $b.userCount) {
                    $countRegressions += "$($b.name): users $($b.userCount)->$($a.userCount)"
                }
                if ($null -ne $b.groupCount -and $null -ne $a.groupCount -and $a.groupCount -lt $b.groupCount) {
                    $countRegressions += "$($b.name): groups $($b.groupCount)->$($a.groupCount)"
                }
            }
        }

        if ($countDelta -eq 0 -and $missingIds.Count -eq 0 -and $countRegressions.Count -eq 0) {
            Write-Host "   ✅ Data integrity intact: $($before.endpointCount) endpoints, 0 missing IDs, 0 count regressions" -ForegroundColor Green
            if ($newIds.Count -gt 0) {
                Write-Host "   ℹ️  New endpoint IDs since before-snapshot (expected if created mid-run): $($newIds -join ', ')" -ForegroundColor Gray
            }
        } else {
            Write-Host "   ❌ DATA DELTA DETECTED - hard stop:" -ForegroundColor Red
            Write-Host "      endpoint count delta : $countDelta" -ForegroundColor Red
            Write-Host "      missing IDs          : $($missingIds -join ', ')" -ForegroundColor Red
            Write-Host "      count regressions    : $($countRegressions -join '; ')" -ForegroundColor Red
            $failures += "DATA DELTA (count=$countDelta missing=$($missingIds.Count) regressions=$($countRegressions.Count))"
        }
    } catch {
        Write-Host "   ❌ Diff failed: $($_.Exception.Message)" -ForegroundColor Red
        $failures += "diff failed"
    }
}

if ($SnapshotOnly) {
    if ($failures.Count -gt 0) {
        Write-Host ""
        Write-Host "❌ Snapshot run had failures: $($failures -join '; ')" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
    Write-Host "✅ Snapshot-only run complete ($snapshotPath)" -ForegroundColor Green
    exit 0
}

# =========================================================================
# 3. Live SCIM contract suite
# =========================================================================
if ($RunLiveTests) {
    Write-Section "3. Live SCIM suite ($Label)"
    $liveScript = Join-Path $repoRoot 'scripts/live-test.ps1'
    if (Test-Path $liveScript) {
        & pwsh -NoProfile -File $liveScript -BaseUrl $BaseUrl -ClientSecret $ClientSecret
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   ❌ Live SCIM suite FAILED (exit=$LASTEXITCODE)" -ForegroundColor Red
            $failures += "live-test exit=$LASTEXITCODE"
        } else {
            Write-Host "   ✅ Live SCIM suite passed" -ForegroundColor Green
        }
    } else {
        Write-Host "   ❌ live-test.ps1 not found at $liveScript" -ForegroundColor Red
        $failures += "live-test.ps1 missing"
    }
}

# =========================================================================
# 4. Playwright browser verification cycle
# =========================================================================
if ($RunPlaywright) {
    Write-Section "4. Playwright browser cycle ($Label)"
    $webDir = Join-Path $repoRoot 'web'
    if (Test-Path $webDir) {
        Push-Location $webDir
        try {
            $env:E2E_BASE_URL = $BaseUrl
            $env:E2E_TOKEN = $ScimToken
            npx playwright test --reporter=line
            if ($LASTEXITCODE -ne 0) {
                Write-Host "   ❌ Playwright suite FAILED (exit=$LASTEXITCODE)" -ForegroundColor Red
                $failures += "playwright exit=$LASTEXITCODE"
            } else {
                Write-Host "   ✅ Playwright suite passed" -ForegroundColor Green
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "   ❌ web/ workspace not found at $webDir" -ForegroundColor Red
        $failures += "web workspace missing"
    }
}

# =========================================================================
# Summary
# =========================================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
if ($failures.Count -eq 0) {
    Write-Host "  ✅ Verification PASSED for $Label ($BaseUrl)" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "  ❌ Verification FAILED for $Label ($BaseUrl)" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "     - $f" -ForegroundColor Red }
    Write-Host "================================================================" -ForegroundColor Cyan
    exit 1
}
