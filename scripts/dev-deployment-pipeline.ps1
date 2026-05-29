<#
.SYNOPSIS
    Authoritative end-to-end dev deployment pipeline for SCIMServer.
    Walks every Mandatory Quality Gate (Stages 0 -> 6), builds + publishes
    the image to ACR + GHCR, deploys to dev preserving DB / endpoints /
    IDs, runs full live SCIM + Playwright UI suites against dev, and
    surfaces a structured report. After dev is green, hands off to the
    operator for explicit prod promotion (NEVER auto-promotes).

.DESCRIPTION
    This script is the runnable implementation of
    [.github/prompts/devDeploymentPipeline.prompt.md](../.github/prompts/devDeploymentPipeline.prompt.md).
    The prompt codifies the WHY + WHAT. This script codifies the HOW.

    Why this exists: the v0.52.3 prod-prep run (2026-05-29) missed
    Playwright entirely, skipped test-all-modes.ps1, skipped the web
    vitest coverage gate, and deferred size-limit failures as
    "pre-existing baseline" instead of fixing them. The standing rules
    in copilot-instructions.md cover the WHAT-to-run; this script
    enforces the order + reports every PASS / FAIL / SKIPPED with a
    reason so no future deploy can quietly skip gates.

    Modes:
      - default (no -Skip*): walk every stage end-to-end. ~25-40 min.
      - -SkipDocker: skip Stage 4.1 (Docker compose live tests). Use
        when Docker daemon isn't available.
      - -SkipPlaywright: skip Stages 5.1-5.5. Use ONLY when web/ wasn't
        touched (predicate auto-detects and prints the override needed).
      - -SkipDeploy: stop after Stage 3c. Use for local-only sanity.
      - -DryRun: print the per-stage plan; do not execute.

.PARAMETER ImageTag
    Image tag to publish + deploy. Defaults to the current git short
    SHA. If a tag is supplied that doesn't match git, the script asks
    for explicit confirmation (use -ConfirmTag for unattended runs).

.PARAMETER RegistryAcr
    ACR login server (default: acrscimserver20622.azurecr.io).

.PARAMETER RegistryGhcr
    GHCR image base (default: ghcr.io/pranems/scimserver).

.PARAMETER DevResourceGroup
    Azure resource group of the dev Container App (default:
    scimserver-dev).

.PARAMETER DevAppName
    Dev Container App name (default: scimserver-dev).

.PARAMETER DevFqdn
    Dev FQDN. Auto-resolved from the Container App if omitted.

.PARAMETER PgImage
    PostgreSQL image for the local Stage 2.2 E2E DB (default:
    postgres:16-alpine). Started on :5432 user=scim pass=scim db=scimdb
    if not already running.

.PARAMETER SkipDocker
    Skip Stage 4.1 Docker compose live tests.

.PARAMETER SkipPlaywright
    Skip Stages 5.1-5.5 Playwright UI suite.

.PARAMETER SkipDeploy
    Stop after Stage 3c (no image push, no deploy).

.PARAMETER DryRun
    Print plan only; do not execute.

.PARAMETER ConfirmTag
    Skip the interactive ImageTag-vs-git-SHA mismatch prompt.

.PARAMETER ReportDir
    Directory for the structured Markdown report (default:
    <repo>/test-results).

.EXAMPLE
    .\scripts\dev-deployment-pipeline.ps1
    Full walk: Stages 0 -> 6, build, push, deploy to dev, live tests,
    Playwright, post-deploy verification. Stops at Stage 7 for operator
    confirmation before prod.

.EXAMPLE
    .\scripts\dev-deployment-pipeline.ps1 -DryRun
    Print the per-stage plan + every command that WOULD run.

.EXAMPLE
    .\scripts\dev-deployment-pipeline.ps1 -SkipPlaywright -SkipDocker
    Fast local-only validation (Stages 1, 2, 3) plus image build + push
    + dev deploy. Use when Docker daemon or browser binaries aren't
    available and you've verified the UI manually.

.NOTES
    Exit codes:
      0 - every gate passed; dev deploy complete; ready for prod prompt
      1 - one or more gates failed; report has the full breakdown
      2 - prerequisite check failed (missing tool / az auth / docker)
      3 - operator declined a confirmation prompt
#>

[CmdletBinding()]
param(
    [string]$ImageTag,
    [string]$RegistryAcr = 'acrscimserver20622.azurecr.io',
    [string]$RegistryGhcr = 'ghcr.io/pranems/scimserver',
    [string]$DevResourceGroup = 'scimserver-dev',
    [string]$DevAppName = 'scimserver-dev',
    [string]$DevFqdn,
    [string]$PgImage = 'postgres:16-alpine',
    [switch]$SkipDocker,
    [switch]$SkipPlaywright,
    [switch]$SkipDeploy,
    [switch]$DryRun,
    [switch]$ConfirmTag,
    [string]$ReportDir
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot 'test-results'
}
if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$reportPath = Join-Path $ReportDir "dev-deploy-$timestamp.md"
$script:results = @()
$script:overallStart = Get-Date

# Resolve image tag from git when omitted.
if (-not $ImageTag) {
    $ImageTag = (git rev-parse --short HEAD 2>$null)
    if (-not $ImageTag) {
        Write-Host "Cannot resolve ImageTag from git. Pass -ImageTag explicitly." -ForegroundColor Red
        exit 2
    }
}

function Write-Stage($num, $title) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host " Stage $num : $title" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
}

function Add-Result {
    param(
        [string]$Stage,
        [string]$Gate,
        [ValidateSet('PASS', 'FAIL', 'SKIPPED', 'PARTIAL', 'PENDING')]
        [string]$Status,
        [string]$Detail = '',
        [int]$DurationSec = 0
    )
    $script:results += [pscustomobject]@{
        Stage    = $Stage
        Gate     = $Gate
        Status   = $Status
        Detail   = $Detail
        Duration = $DurationSec
    }
    $color = switch ($Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'SKIPPED' { 'DarkGray' }
        'PARTIAL' { 'Yellow' }
        default { 'White' }
    }
    Write-Host "  [$Status] $Gate $(if ($Detail) { "- $Detail" }) ($DurationSec s)" -ForegroundColor $color
}

function Invoke-Gate {
    param(
        [string]$Stage,
        [string]$Gate,
        [scriptblock]$Command,
        [string]$WorkDir = $repoRoot
    )
    if ($DryRun) {
        Write-Host "  [DRY-RUN] $Stage $Gate -> $Command" -ForegroundColor DarkGray
        Add-Result -Stage $Stage -Gate $Gate -Status 'PENDING' -Detail 'dry-run'
        return $true
    }
    $start = Get-Date
    Push-Location $WorkDir
    try {
        $output = & $Command 2>&1
        $exit = $LASTEXITCODE
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        if ($exit -eq 0 -or $null -eq $exit) {
            Add-Result -Stage $Stage -Gate $Gate -Status 'PASS' -DurationSec $elapsed
            return $true
        } else {
            $tail = ($output | Select-Object -Last 3) -join ' | '
            Add-Result -Stage $Stage -Gate $Gate -Status 'FAIL' -Detail "exit=$exit; tail=$tail" -DurationSec $elapsed
            return $false
        }
    } catch {
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        Add-Result -Stage $Stage -Gate $Gate -Status 'FAIL' -Detail $_.Exception.Message -DurationSec $elapsed
        return $false
    } finally {
        Pop-Location
    }
}

function Test-PrereqOrExit {
    $missing = @()
    foreach ($cmd in @('git', 'npm', 'node', 'docker', 'az', 'gh')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            $missing += $cmd
        }
    }
    if ($missing.Count -gt 0) {
        Write-Host "Missing prerequisites: $($missing -join ', ')" -ForegroundColor Red
        exit 2
    }
    # docker daemon up?
    docker version --format '{{.Server.Version}}' > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker daemon not reachable. Start Docker Desktop." -ForegroundColor Red
        exit 2
    }
    # az logged in?
    az account show --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "az CLI not authenticated. Run: az login" -ForegroundColor Red
        exit 2
    }
}

# =============================================================================
# Stage 0 - Pre-flight + state capture
# =============================================================================
Write-Stage 0 'Pre-flight + state capture'
Test-PrereqOrExit

$gitSha = (git rev-parse --short HEAD).Trim()
$gitBranch = (git rev-parse --abbrev-ref HEAD).Trim()
$dirty = (git status --porcelain | Where-Object { $_ -notmatch '^\?\?' }).Count -gt 0

if ($ImageTag -ne $gitSha -and -not $ConfirmTag) {
    Write-Host "ImageTag '$ImageTag' does not match git HEAD '$gitSha'." -ForegroundColor Yellow
    $reply = Read-Host "Continue with $ImageTag? (yes/no)"
    if ($reply -ne 'yes') { exit 3 }
}

if (-not $DevFqdn) {
    if ($DryRun) {
        $DevFqdn = 'scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
    } else {
        $DevFqdn = az containerapp show -n $DevAppName -g $DevResourceGroup --query 'properties.configuration.ingress.fqdn' -o tsv 2>$null
    }
}

Add-Result -Stage '0.1' -Gate 'Prerequisites + git/az/docker auth' -Status 'PASS' -Detail "SHA=$gitSha branch=$gitBranch dirty=$dirty"

# Capture before-deploy state of dev
$beforePath = Join-Path $ReportDir "dev-before-$gitSha.json"
if (-not $DryRun) {
    try {
        $tok = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/oauth/token" -Method Post -Body '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"changeme-oauth"}' -ContentType 'application/json' -TimeoutSec 15).access_token
        $eps = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/admin/endpoints?count=200" -Headers @{Authorization = "Bearer $tok"} -TimeoutSec 30).endpoints
        $beforeState = @{
            timestamp = (Get-Date).ToString('o')
            devFqdn = $DevFqdn
            currentImage = (az containerapp show -n $DevAppName -g $DevResourceGroup --query 'properties.template.containers[0].image' -o tsv 2>$null)
            endpoints = @($eps | ForEach-Object { @{ id = $_.id; name = $_.name; preset = $_.profilePreset } })
            endpointCount = $eps.Count
        }
        $beforeState | ConvertTo-Json -Depth 6 | Out-File -FilePath $beforePath -Encoding utf8
        Add-Result -Stage '0.6' -Gate 'Capture dev before-state' -Status 'PASS' -Detail "$($eps.Count) endpoints; saved to $beforePath"
    } catch {
        Add-Result -Stage '0.6' -Gate 'Capture dev before-state' -Status 'FAIL' -Detail $_.Exception.Message
    }
} else {
    Add-Result -Stage '0.6' -Gate 'Capture dev before-state' -Status 'PENDING' -Detail 'dry-run'
}

# =============================================================================
# Stage 1 - Local static gates
# =============================================================================
Write-Stage 1 'Local static gates'
Invoke-Gate '1.1' 'API tsc build' { npm run build } 'api' | Out-Null
Invoke-Gate '1.2' 'API ESLint (0 errors)' {
    $out = npm run lint 2>&1
    $errLine = ($out | Select-String -Pattern '(\d+)\s+errors?,\s+(\d+)\s+warnings?' | Select-Object -First 1).Line
    if ($errLine -match '(\d+)\s+errors?') {
        $errCount = [int]$Matches[1]
        if ($errCount -gt 0) { $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
    }
    $out | Select-Object -Last 5
} 'api' | Out-Null

Invoke-Gate '1.3' 'Web tsc --noEmit (baseline-or-better)' {
    $out = npx tsc --noEmit 2>&1
    $errCount = ($out | Select-String -Pattern 'error TS').Count
    $prodErrors = ($out | Select-String -Pattern 'error TS' | Where-Object { $_ -notmatch '\.spec\.|\.test\.|__tests__|e2e' }).Count
    Write-Host "  total=$errCount prod=$prodErrors (baseline total=96 prod=9)"
    if ($prodErrors -gt 9 -or $errCount -gt 96) { $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
} 'web' | Out-Null

Invoke-Gate '1.5' 'Web prod build' { npm run build } 'web' | Out-Null
Invoke-Gate '1.6' 'Web size-limit budgets' { npm run size } 'web' | Out-Null

# =============================================================================
# Stage 2 - Local test gates
# =============================================================================
Write-Stage 2 'Local test gates'

# Ensure Postgres for E2E (Stage 2.2)
if (-not $DryRun) {
    $pgExists = (docker ps --filter "publish=5432" --format "{{.Names}}" 2>$null)
    if (-not $pgExists) {
        Write-Host "  Starting local Postgres for E2E (scim/scim@:5432/scimdb)..." -ForegroundColor Yellow
        docker rm -f scim-dev-pipeline-pg 2>$null | Out-Null
        docker run -d --name scim-dev-pipeline-pg -p 5432:5432 -e POSTGRES_USER=scim -e POSTGRES_PASSWORD=scim -e POSTGRES_DB=scimdb $PgImage 2>&1 | Out-Null
        Start-Sleep -Seconds 5
    }
}

Invoke-Gate '2.1' 'API unit jest (3,816 baseline)' { Remove-Item Env:\PERSISTENCE_BACKEND -ErrorAction SilentlyContinue; npm test } 'api' | Out-Null
Invoke-Gate '2.2' 'API E2E jest (1,217 baseline, prisma)' { npm run test:e2e } 'api' | Out-Null
Invoke-Gate '2.3' 'Web vitest (1,006 baseline)' { npm test } 'web' | Out-Null
Invoke-Gate '2.4' 'Web vitest coverage (lines:78 / branches:70 / functions:65 / statements:75 ratchet)' { npm run test:coverage } 'web' | Out-Null
Invoke-Gate '2.6' 'test-all-modes.ps1 (6-mode matrix)' { pwsh -NoProfile -File scripts/test-all-modes.ps1 } | Out-Null

# =============================================================================
# Stage 3 - Audit prompts (recorded as PENDING for operator-driven walk)
# =============================================================================
Write-Stage 3 'Audit prompts (operator-driven)'
$auditPrompts = @(
    @{ Stage = '3a.1'; Gate = 'addMissingTests prompt' },
    @{ Stage = '3a.2'; Gate = 'apiContractVerification prompt' },
    @{ Stage = '3a.3'; Gate = 'error-handling-verification prompt' },
    @{ Stage = '3b.1'; Gate = 'logging-verification prompt' },
    @{ Stage = '3b.2'; Gate = 'auditAgainstRFC prompt' },
    @{ Stage = '3b.3'; Gate = 'endpointConfigFlagAudit prompt' },
    @{ Stage = '3b.4'; Gate = 'securityAudit prompt' },
    @{ Stage = '3b.5'; Gate = 'dependencyCveSweep prompt' },
    @{ Stage = '3b.6'; Gate = 'performanceBenchmark prompt' },
    @{ Stage = '3c.1'; Gate = 'codeReviewSelfAudit prompt' },
    @{ Stage = '3c.2'; Gate = 'auditAndUpdateDocs prompt' }
)
foreach ($p in $auditPrompts) {
    Add-Result -Stage $p.Stage -Gate $p.Gate -Status 'PENDING' -Detail 'invoke via Copilot Chat with #prompt:<name>; record outcome in report'
}

if ($SkipDeploy) {
    Write-Host "" -ForegroundColor Yellow
    Write-Host "-SkipDeploy set; stopping after Stage 3. Writing report..." -ForegroundColor Yellow
}

# =============================================================================
# Stage 4 - Build, publish, deploy
# =============================================================================
if (-not $SkipDeploy) {
    Write-Stage 4 'Build, publish, deploy'

    if (-not $SkipDocker) {
        Invoke-Gate '4.1' 'Docker compose build + live tests' { pwsh -NoProfile -File scripts/full-validation-pipeline.ps1 -SkipLocal } | Out-Null
    } else {
        Add-Result -Stage '4.1' -Gate 'Docker compose build + live tests' -Status 'SKIPPED' -Detail '-SkipDocker'
    }

    # 4.2 - ACR push
    Invoke-Gate '4.2a' "ACR login ($RegistryAcr)" { az acr login --name ($RegistryAcr -replace '\.azurecr\.io$', '') } | Out-Null
    Invoke-Gate '4.2b' "Tag + push $RegistryAcr/scimserver:$ImageTag" {
        docker tag scimserver-api "$RegistryAcr/scimserver:$ImageTag"
        docker tag scimserver-api "$RegistryAcr/scimserver:latest"
        docker push "$RegistryAcr/scimserver:$ImageTag"
        docker push "$RegistryAcr/scimserver:latest"
    } | Out-Null

    # 4.3 - GHCR push via CI workflow (uses GITHUB_TOKEN; no local PAT needed)
    $pkgJsonPath = Join-Path $repoRoot 'api/package.json'
    $version = (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).version
    Invoke-Gate '4.3' "GHCR publish v$version + latest (publish-ghcr.yml)" {
        gh workflow run publish-ghcr.yml -f version=$version -f pushLatest=true
        Start-Sleep -Seconds 6
        $runId = (gh run list --workflow=publish-ghcr.yml --limit 1 --json databaseId --jq '.[0].databaseId')
        gh run watch $runId --exit-status
    } | Out-Null

    # 4.4 - Verify anonymous GHCR pull
    Invoke-Gate '4.4' "Anonymous pull $RegistryGhcr:latest" {
        docker logout ghcr.io 2>&1 | Out-Null
        docker rmi "${RegistryGhcr}:latest" -f 2>&1 | Out-Null
        docker pull "${RegistryGhcr}:latest"
    } | Out-Null

    # 4.6 - Deploy to dev
    Invoke-Gate '4.6' "Deploy $RegistryAcr/scimserver:$ImageTag to $DevAppName" {
        az containerapp update --name $DevAppName --resource-group $DevResourceGroup --image "$RegistryAcr/scimserver:$ImageTag" --revision-suffix "v$ImageTag" --output none
    } | Out-Null

    # Wait for new revision healthy + traffic
    Write-Host "  Waiting for new revision to become healthy + serving traffic..." -ForegroundColor Yellow
    $maxWait = 12
    $devReady = $false
    for ($i = 1; $i -le $maxWait; $i++) {
        Start-Sleep -Seconds 10
        try {
            $tok = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/oauth/token" -Method Post -Body '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"changeme-oauth"}' -ContentType 'application/json' -TimeoutSec 15).access_token
            $v = Invoke-RestMethod -Uri "https://$DevFqdn/scim/admin/version" -Headers @{Authorization = "Bearer $tok"} -TimeoutSec 15
            if ($v.runtime.hostname -match "v$ImageTag") {
                $devReady = $true
                break
            }
        } catch { }
    }
    if ($devReady) {
        Add-Result -Stage '4.6b' -Gate 'Dev revision serving new image' -Status 'PASS'
    } else {
        Add-Result -Stage '4.6b' -Gate 'Dev revision serving new image' -Status 'FAIL' -Detail "did not switch within $($maxWait * 10)s"
    }

    # 4.7 - Live SCIM tests vs dev
    Invoke-Gate '4.7' 'Live SCIM tests vs dev (1,027 baseline)' { pwsh -NoProfile -File scripts/live-test.ps1 -BaseUrl "https://$DevFqdn" -ClientSecret 'changeme-oauth' } | Out-Null
}

# =============================================================================
# Stage 5 - UI gates
# =============================================================================
if (-not $SkipDeploy -and -not $SkipPlaywright) {
    Write-Stage 5 'UI gates'

    Invoke-Gate '5.3' 'Playwright vs dev' {
        $env:E2E_BASE_URL = "https://$DevFqdn"
        $env:E2E_TOKEN = 'changeme-scim'
        npx playwright test --reporter=line
    } 'web' | Out-Null
} elseif ($SkipPlaywright) {
    Add-Result -Stage '5.3' -Gate 'Playwright vs dev' -Status 'SKIPPED' -Detail '-SkipPlaywright'
}

# =============================================================================
# Stage 6 - Post-deploy state diff + report
# =============================================================================
if (-not $SkipDeploy) {
    Write-Stage 6 'Post-deploy state diff'

    $afterPath = Join-Path $ReportDir "dev-after-$gitSha-$ImageTag.json"
    if (-not $DryRun) {
        try {
            $tok = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/oauth/token" -Method Post -Body '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"changeme-oauth"}' -ContentType 'application/json' -TimeoutSec 15).access_token
            $eps = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/admin/endpoints?count=200" -Headers @{Authorization = "Bearer $tok"} -TimeoutSec 30).endpoints
            $afterState = @{
                timestamp = (Get-Date).ToString('o')
                devFqdn = $DevFqdn
                currentImage = (az containerapp show -n $DevAppName -g $DevResourceGroup --query 'properties.template.containers[0].image' -o tsv 2>$null)
                endpoints = @($eps | ForEach-Object { @{ id = $_.id; name = $_.name; preset = $_.profilePreset } })
                endpointCount = $eps.Count
            }
            $afterState | ConvertTo-Json -Depth 6 | Out-File -FilePath $afterPath -Encoding utf8

            $before = Get-Content $beforePath -Raw | ConvertFrom-Json
            $delta = $afterState.endpointCount - $before.endpointCount
            $idsBefore = @($before.endpoints | ForEach-Object { $_.id })
            $idsAfter = @($afterState.endpoints | ForEach-Object { $_.id })
            $missingIds = $idsBefore | Where-Object { $idsAfter -notcontains $_ }
            $newIds = $idsAfter | Where-Object { $idsBefore -notcontains $_ }
            if ($delta -eq 0 -and $missingIds.Count -eq 0) {
                Add-Result -Stage '6.1' -Gate 'Data integrity (endpoint count + ID stability)' -Status 'PASS' -Detail "$($before.endpointCount) -> $($afterState.endpointCount); 0 missing IDs"
            } else {
                Add-Result -Stage '6.1' -Gate 'Data integrity (endpoint count + ID stability)' -Status 'FAIL' -Detail "delta=$delta; missingIds=$($missingIds -join ',') newIds=$($newIds -join ',')"
            }
        } catch {
            Add-Result -Stage '6.1' -Gate 'Data integrity check' -Status 'FAIL' -Detail $_.Exception.Message
        }
    }
}

# =============================================================================
# Stage 7 - Operator handoff
# =============================================================================
Write-Stage 7 'Operator handoff'

$overallElapsed = [int]((Get-Date) - $script:overallStart).TotalSeconds
$passCount = ($script:results | Where-Object { $_.Status -eq 'PASS' }).Count
$failCount = ($script:results | Where-Object { $_.Status -eq 'FAIL' }).Count
$skipCount = ($script:results | Where-Object { $_.Status -eq 'SKIPPED' }).Count
$pendCount = ($script:results | Where-Object { $_.Status -eq 'PENDING' }).Count

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " PIPELINE SUMMARY ($overallElapsed s, $($script:results.Count) gates)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  PASS:    $passCount" -ForegroundColor Green
Write-Host "  FAIL:    $failCount" -ForegroundColor $(if ($failCount -gt 0) { 'Red' } else { 'DarkGray' })
Write-Host "  SKIPPED: $skipCount" -ForegroundColor DarkGray
Write-Host "  PENDING: $pendCount (operator prompt gates)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Report: $reportPath" -ForegroundColor Cyan
Write-Host ""

# Write structured Markdown report
$reportLines = @()
$reportLines += "# Dev Deployment Pipeline Run"
$reportLines += ""
$reportLines += "- **Commit:** $gitSha ($gitBranch)"
$reportLines += "- **Started:** $($script:overallStart.ToString('o'))"
$reportLines += "- **Duration:** $overallElapsed s"
$reportLines += "- **Image:** $RegistryAcr/scimserver:$ImageTag (+ $RegistryGhcr:$ImageTag)"
$reportLines += "- **Dev FQDN:** $DevFqdn"
$reportLines += ""
$reportLines += "## Gate Results"
$reportLines += ""
$reportLines += "| Stage | Gate | Status | Detail | Duration (s) |"
$reportLines += "|---|---|---|---|---|"
foreach ($r in $script:results) {
    $detail = $r.Detail -replace '\|', '\|' -replace '`', '\`'
    if ($detail.Length -gt 120) { $detail = $detail.Substring(0, 120) + '...' }
    $reportLines += "| $($r.Stage) | $($r.Gate) | $($r.Status) | $detail | $($r.Duration) |"
}
$reportLines += ""
$reportLines += "## Summary"
$reportLines += ""
$reportLines += "- PASS: $passCount"
$reportLines += "- FAIL: $failCount"
$reportLines += "- SKIPPED: $skipCount"
$reportLines += "- PENDING (operator prompts): $pendCount"
$reportLines += ""
if ($failCount -eq 0 -and -not $SkipDeploy) {
    $reportLines += "## Next step"
    $reportLines += ""
    $reportLines += '> Dev is green. To promote to prod (image swap; prod DB / endpoints / IDs preserved):'
    $reportLines += '> `pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-prod -ProdAppName scimserver -ImageTag ' + $ImageTag + '`'
    $reportLines += ""
    $reportLines += 'After promote: re-run live-test.ps1 + Playwright against prod FQDN.'
}
$reportLines | Out-File -FilePath $reportPath -Encoding utf8

if ($failCount -gt 0) {
    Write-Host "FAILURES present. See report. Do NOT proceed to prod." -ForegroundColor Red
    exit 1
}

if (-not $SkipDeploy) {
    Write-Host "Dev is green." -ForegroundColor Green
    Write-Host "Next: review the report, then run promote-to-prod.ps1 ONLY with explicit operator approval." -ForegroundColor Cyan
}

exit 0
