<#
.SYNOPSIS
    Full post-deploy verification cycle for a single SCIMServer instance.

.DESCRIPTION
    Runs the complete verification suite against one deployed target FQDN:

      1. Health probe (/scim/health)
      2. Complete endpoint ID inventory + per-endpoint stored resource counts
      3. Live SCIM contract suite (scripts/live-test.ps1)
      4. (optional) Playwright browser verification cycle (E2E_BASE_URL=<target>)
      5. (optional) Before/after inventory diff - hard-fails on ANY non-zero
         measured delta (endpoint ID set or stored User/Group counts)

    This is the reusable verification building block invoked by:
      - scripts/promote-to-prod.ps1 -BlueGreen -RunVerification (green soak + post-flip)
      - scripts/dev-deployment-pipeline.ps1 auto-canary stage (both prods)

    Exit codes:
      0 - all selected checks passed
      1 - a check failed (health, live tests, Playwright, or data delta)
      2 - prerequisite / argument error

    DATA SAFETY: this finite proof measures endpoint IDs and admin stored
    User/Group totals, not resource IDs, content or all database rows.
    Any measured delta is a hard stop, never auto-remediated.

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
    snapshot is diffed against it and any measured ID/count delta fails the run.
    Missing or invalid requested baselines are prerequisite errors (exit 2).

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
    [switch]$IncludeVisualBaselines,
    [string]$BeforeSnapshot,
    [switch]$SnapshotOnly,
    [string]$ReportDir
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$BaseUrl = $BaseUrl.TrimEnd('/')
$countBasis = 'stored-user-group-v1'

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

function Assert-InventoryCount($Value, [string]$Context) {
    if (($Value -isnot [int] -and $Value -isnot [long]) -or $Value -lt 0) {
        throw "$Context must be a nonnegative JSON integer."
    }
}

function Assert-EndpointInventory($Endpoints, $Total, [switch]$WithResourceCounts) {
    Assert-InventoryCount $Total 'endpointCount/totalResults'
    if ($Endpoints -isnot [array] -or $Endpoints.Count -ne $Total) {
        throw 'Incomplete endpoint inventory: endpoints must be an array matching endpointCount/totalResults.'
    }
    $ids = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($endpoint in $Endpoints) {
        $parsedId = [guid]::Empty
        if ($endpoint.id -isnot [string] -or
            -not [guid]::TryParseExact($endpoint.id, 'D', [ref]$parsedId) -or
            -not $ids.Add($endpoint.id)) {
            throw 'Endpoint inventory requires valid, unique UUID IDs.'
        }
        if ($WithResourceCounts) {
            Assert-InventoryCount $endpoint.userCount "Endpoint $($endpoint.id) userCount"
            Assert-InventoryCount $endpoint.groupCount "Endpoint $($endpoint.id) groupCount"
        }
    }
}

$before = $null
if ($PSBoundParameters.ContainsKey('BeforeSnapshot')) {
    try {
        if ([string]::IsNullOrWhiteSpace($BeforeSnapshot) -or
            -not (Test-Path -LiteralPath $BeforeSnapshot -PathType Leaf)) {
            throw 'Requested baseline file does not exist.'
        }
        $before = Get-Content -LiteralPath $BeforeSnapshot -Raw -ErrorAction Stop |
            ConvertFrom-Json -NoEnumerate -ErrorAction Stop
        if ($before -isnot [pscustomobject]) {
            throw 'Requested baseline must be a JSON object.'
        }
        if ($before.countBasis -cne $countBasis) {
            throw "Requested baseline countBasis must be $countBasis; legacy visible counts cannot be reinterpreted as stored totals."
        }
        Assert-EndpointInventory $before.endpoints $before.endpointCount -WithResourceCounts
    } catch {
        Write-Host "Invalid BeforeSnapshot: $($_.Exception.Message)" -ForegroundColor Red
        exit 2
    }
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
$measurement = 'OAuth token request'
try {
    $token = Get-AccessToken -Url $BaseUrl -Id $ClientId -Secret $ClientSecret
    $headers = @{ Authorization = "Bearer $token" }
    $measurement = 'endpoint inventory request'
    $inventory = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Headers $headers -TimeoutSec 30 -ErrorAction Stop
    Assert-EndpointInventory $inventory.endpoints $inventory.totalResults
    $eps = $inventory.endpoints

    $epInventory = @()
    foreach ($ep in $eps) {
        $measurement = "$($ep.id) stored User/Group statistics"
        $stats = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($ep.id)/stats" -Headers $headers -TimeoutSec 30 -ErrorAction Stop
        if ($stats -isnot [pscustomobject] -or $stats.users -isnot [pscustomobject] -or $stats.groups -isnot [pscustomobject]) {
            throw 'Stored statistics must contain users and groups objects.'
        }
        Assert-InventoryCount $stats.users.total "Endpoint $($ep.id) stored User total"
        Assert-InventoryCount $stats.groups.total "Endpoint $($ep.id) stored Group total"
        $epInventory += [ordered]@{
            id         = $ep.id
            name       = $ep.name
            preset     = $ep.profilePreset
            userCount  = $stats.users.total
            groupCount = $stats.groups.total
        }
    }

    $snapshot = [ordered]@{
        countBasis    = $countBasis
        timestamp     = (Get-Date).ToString('o')
        baseUrl       = $BaseUrl
        label         = $Label
        endpointCount = $eps.Count
        endpoints     = $epInventory
    }
    $measurement = 'snapshot file write'
    $snapshot | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $snapshotPath -Encoding utf8 -ErrorAction Stop
    Write-Host "   ✅ Captured $($eps.Count) endpoints -> $snapshotPath" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Inventory snapshot failed ($measurement): $($_.Exception.Message)" -ForegroundColor Red
    $failures += "inventory snapshot failed"
}

# =========================================================================
# 2b. Before/after diff (hard stop on any data/ID delta)
# =========================================================================
if ($before -and $snapshot) {
    Write-Section "2b. Before/after data integrity diff"
    try {
        $countDelta = $snapshot.endpointCount - $before.endpointCount
        $idsBefore = @($before.endpoints | ForEach-Object { $_.id })
        $idsAfter = @($snapshot.endpoints | ForEach-Object { $_.id })
        $missingIds = @($idsBefore | Where-Object { $idsAfter -notcontains $_ })
        $newIds = @($idsAfter | Where-Object { $idsBefore -notcontains $_ })

        # Exact equality is required; growth can hide replacement just as loss can.
        $countChanges = @()
        foreach ($b in $before.endpoints) {
            $a = $snapshot.endpoints | Where-Object { $_.id -eq $b.id } | Select-Object -First 1
            if ($a) {
                if ($a.userCount -ne $b.userCount) {
                    $countChanges += "$($b.id): users $($b.userCount)->$($a.userCount)"
                }
                if ($a.groupCount -ne $b.groupCount) {
                    $countChanges += "$($b.id): groups $($b.groupCount)->$($a.groupCount)"
                }
            }
        }

        if ($countDelta -eq 0 -and $missingIds.Count -eq 0 -and $newIds.Count -eq 0 -and $countChanges.Count -eq 0) {
            Write-Host "   ✅ Measured preservation: $($before.endpointCount) endpoint IDs unchanged; STORED User/Group counts equal. SCIM visibility and resource IDs/content not measured." -ForegroundColor Green
        } else {
            Write-Host "   ❌ DATA DELTA DETECTED - hard stop:" -ForegroundColor Red
            Write-Host "      endpoint count delta : $countDelta" -ForegroundColor Red
            Write-Host "      missing IDs          : $($missingIds -join ', ')" -ForegroundColor Red
            Write-Host "      new IDs              : $($newIds -join ', ')" -ForegroundColor Red
            Write-Host "      count changes        : $($countChanges -join '; ')" -ForegroundColor Red
            $failures += "DATA DELTA (count=$countDelta missing=$($missingIds.Count) new=$($newIds.Count) changes=$($countChanges.Count))"
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
        $previousE2EAllowMutations = [Environment]::GetEnvironmentVariable(
            'E2E_ALLOW_MUTATIONS',
            'Process'
        )
        $previousE2EShapeCoverage = [Environment]::GetEnvironmentVariable(
            'E2E_SHAPE_COVERAGE',
            'Process'
        )
        Push-Location $webDir
        try {
            $env:E2E_BASE_URL = $BaseUrl
            $env:E2E_TOKEN = $ScimToken
            # Promotion verification is read-only. Never inherit dev-only mutation
            # or seeded-fixture flags from the shell that launched the pipeline.
            [Environment]::SetEnvironmentVariable('E2E_ALLOW_MUTATIONS', $null, 'Process')
            [Environment]::SetEnvironmentVariable('E2E_SHAPE_COVERAGE', $null, 'Process')
            # Pixel-baseline specs (visual-regression.spec.ts / visual-snapshots.spec.ts)
            # are captured against a FIXED fixture and are data-coupled: the rendered
            # content (e.g. an endpoint's Schemas card height) depends on the SCIM data in
            # the target environment. Running them against a live env whose data differs
            # from the baseline-capture env guarantees a false toHaveScreenshot() mismatch,
            # which would trip the blue/green abort on a perfectly healthy image. They are
            # validated separately in Stage 5.3 against the dev FQDN where baselines live.
            # The promote gate runs only the FUNCTIONAL specs. Opt back in with
            # -IncludeVisualBaselines if the target shares the baseline fixture data.
            $pwArgs = @('playwright', 'test', '--reporter=line')
            if (-not $IncludeVisualBaselines) {
                $grepVisual = 'Visual regression|Visual Snapshots'
                $pwArgs += @('--grep-invert', $grepVisual)

                # An EXCLUDED test is invisible: it appears in no pass/skip/fail
                # count, so "196 passed" silently omitted a whole coverage class.
                # Count what the filter removes and prove it removed only pixel
                # specs, so an over-broad pattern cannot quietly drop real coverage.
                function Get-PwTestCount([string[]]$ExtraArgs) {
                    $out = npx playwright test --list --reporter=line @ExtraArgs 2>&1 | Out-String
                    $m = [regex]::Match($out, 'Total:\s+(\d+)\s+test')
                    if ($m.Success) { return [int]$m.Groups[1].Value }
                    return -1
                }
                $countAll      = Get-PwTestCount @()
                $countVisual   = Get-PwTestCount @('--grep', $grepVisual)
                $countFiltered = Get-PwTestCount @('--grep-invert', $grepVisual)

                Write-Host "   Playwright selection: $countAll collected, $countVisual excluded (pixel baselines), $countFiltered will run" -ForegroundColor DarkGray

                if ($countFiltered -le 0) {
                    Write-Host "   ❌ the exclusion filter left NO tests to run" -ForegroundColor Red
                    $failures += "playwright selection empty (grep-invert removed everything)"
                } elseif ($countAll -ge 0 -and $countVisual -ge 0 -and ($countVisual + $countFiltered) -ne $countAll) {
                    Write-Host "   ❌ selection accounting does not balance: $countVisual + $countFiltered != $countAll" -ForegroundColor Red
                    $failures += "playwright selection accounting mismatch"
                }
            }
            npx @pwArgs
            if ($LASTEXITCODE -ne 0) {
                Write-Host "   ❌ Playwright suite FAILED (exit=$LASTEXITCODE)" -ForegroundColor Red
                $failures += "playwright exit=$LASTEXITCODE"
            } else {
                Write-Host "   ✅ Playwright suite passed" -ForegroundColor Green
            }
        } finally {
            [Environment]::SetEnvironmentVariable(
                'E2E_ALLOW_MUTATIONS',
                $previousE2EAllowMutations,
                'Process'
            )
            [Environment]::SetEnvironmentVariable(
                'E2E_SHAPE_COVERAGE',
                $previousE2EShapeCoverage,
                'Process'
            )
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
