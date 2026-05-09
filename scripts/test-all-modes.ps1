# scripts/test-all-modes.ps1 - Phase H5 test orchestrator.
#
# Runs the full SCIMServer test matrix across persistence backends and
# theme modes, producing a single PASS/FAIL summary per mode. Designed
# to catch regressions that only manifest in one configuration (the
# classic "passes locally, fails in prod" trap when the API or UI
# silently couples to one backend / theme).
#
# Matrix:
#   - API unit:     PERSISTENCE_BACKEND in [inmemory, prisma]
#   - API E2E:      PERSISTENCE_BACKEND in [inmemory, prisma]
#   - Web vitest:   theme-agnostic at unit level (each test mounts its
#                   own FluentProvider) - run once
#   - Web a11y:     covered by the vitest pass (the a11y tests render
#                   primitives in both light and dark internally via
#                   per-test FluentProvider instances)
#
# Why backend matters: the API has two repository implementations
# (`InMemoryRepositoryModule` and `PrismaRepositoryModule`) with
# different consistency guarantees, transaction semantics, and filter
# evaluation paths. A passing in-memory run does not prove the prisma
# path works - and vice versa. Phase D4 found a real bug here:
# `LoggingService.listLogs` had 9 filter dimensions implemented in the
# prisma branch but missing in the in-memory branch. Without a matrix
# orchestrator, that bug was only caught by E2E tests that ran in the
# prisma mode. This script makes the matrix the standard local + CI
# entry point so any future divergence fails loudly.
#
# Why theme is a single-pass at unit level: every Fluent UI test mounts
# its own `FluentProvider theme={webLightTheme}` (or via the helper
# `withFluent()`). Running the suite twice with a global theme env var
# would not change anything. Real theme regressions are caught by
# Phase H3's Playwright visual-regression spec which runs both light
# and dark.
#
# Usage:
#   .\scripts\test-all-modes.ps1                          # all modes
#   .\scripts\test-all-modes.ps1 -SkipPrisma             # skip the
#                                                          prisma mode
#                                                          (no DATABASE_URL)
#   .\scripts\test-all-modes.ps1 -SkipE2E                # unit only
#   .\scripts\test-all-modes.ps1 -SkipWeb                # API only
#   .\scripts\test-all-modes.ps1 -Verbose                # echo all
#                                                          subprocess output
#
# Exit codes:
#   0 - all modes passed
#   1 - one or more modes failed (summary printed)
#   2 - prerequisite check failed (npm / docker / DATABASE_URL missing)

[CmdletBinding()]
param(
    # Skip the prisma backend mode (use when a Postgres DATABASE_URL is
    # not available - a dev box without docker, etc).
    [switch]$SkipPrisma,
    # Skip the API E2E suite (faster local iteration; ~30s vs ~3min).
    [switch]$SkipE2E,
    # Skip the web vitest suite (when only validating an API change).
    [switch]$SkipWeb,
    # Override the DATABASE_URL used for the prisma mode. Defaults to
    # the env var of the same name. Required when -SkipPrisma is not
    # set and the env var is not present.
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Per-mode result tracking. Each entry is a hashtable with Mode + Passed.
$results = @()

function Invoke-TestMode {
    param(
        [Parameter(Mandatory)] [string]$Mode,
        [Parameter(Mandatory)] [string]$WorkDir,
        [Parameter(Mandatory)] [string]$Command,
        [hashtable]$EnvVars = @{}
    )

    Write-Host ""
    Write-Host "============================================================"
    Write-Host "  $Mode"
    Write-Host "============================================================"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    # Stash + restore env so a per-mode override does not leak to the
    # next mode (e.g. PERSISTENCE_BACKEND=prisma must not bleed into
    # the in-memory run).
    $stashedEnv = @{}
    foreach ($key in $EnvVars.Keys) {
        $stashedEnv[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
        [System.Environment]::SetEnvironmentVariable($key, $EnvVars[$key], 'Process')
    }

    Push-Location $WorkDir
    try {
        if ($VerbosePreference -eq 'Continue') {
            # Verbose mode: stream output to console + capture exit code.
            Invoke-Expression $Command
            $exit = $LASTEXITCODE
        }
        else {
            # Quiet mode: capture output to a per-mode log under
            # test-results/ for postmortem if the mode failed.
            $logFile = Join-Path $repoRoot 'test-results' "test-all-modes-$($Mode -replace '[^a-zA-Z0-9]', '_').log"
            New-Item -ItemType Directory -Path (Split-Path $logFile) -Force | Out-Null
            Invoke-Expression "$Command 2>&1" | Out-File -FilePath $logFile
            $exit = $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
        foreach ($key in $stashedEnv.Keys) {
            if ($null -eq $stashedEnv[$key]) {
                [System.Environment]::SetEnvironmentVariable($key, $null, 'Process')
            }
            else {
                [System.Environment]::SetEnvironmentVariable($key, $stashedEnv[$key], 'Process')
            }
        }
    }

    $sw.Stop()
    $passed = ($exit -eq 0)
    $script:results += [pscustomobject]@{
        Mode = $Mode
        Passed = $passed
        DurationSec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    }

    $statusColor = if ($passed) { 'Green' } else { 'Red' }
    $statusText = if ($passed) { 'PASS' } else { 'FAIL' }
    Write-Host ("  [{0}] {1} in {2}s" -f $statusText, $Mode, [math]::Round($sw.Elapsed.TotalSeconds, 1)) -ForegroundColor $statusColor
}

# Prerequisite checks.
Write-Host "Phase H5 - test-all-modes orchestrator"
Write-Host "  Repo root: $repoRoot"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm not found on PATH. Install Node.js + npm before running."
    exit 2
}

# Auto-install api + web deps if node_modules is missing. This handles
# the common "fresh clone / lockfile regen" case where the dev runs
# the orchestrator before the per-package install. Skipping silently
# is worse than a 60-second wait because the failure mode (jest /
# vitest not on PATH) is opaque.
$apiNodeModules = Join-Path $repoRoot 'api' 'node_modules'
$webNodeModules = Join-Path $repoRoot 'web' 'node_modules'

if (-not (Test-Path $apiNodeModules) -and -not $SkipAll) {
    Write-Host "  api/node_modules missing - running npm install..." -ForegroundColor Yellow
    Push-Location (Join-Path $repoRoot 'api')
    try { npm install --silent }
    finally { Pop-Location }
}

if (-not (Test-Path $webNodeModules) -and -not $SkipWeb) {
    Write-Host "  web/node_modules missing - running npm install..." -ForegroundColor Yellow
    Push-Location (Join-Path $repoRoot 'web')
    try { npm install --silent }
    finally { Pop-Location }
}

if (-not $SkipPrisma -and [string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    Write-Warning "DATABASE_URL not set and -SkipPrisma not specified. Skipping prisma mode."
    $SkipPrisma = $true
}

# ─── Mode 1: API unit tests, in-memory backend ───────────────────────
Invoke-TestMode `
    -Mode 'api-unit-inmemory' `
    -WorkDir (Join-Path $repoRoot 'api') `
    -Command 'npm test -- --run' `
    -EnvVars @{ PERSISTENCE_BACKEND = 'inmemory' }

# ─── Mode 2: API unit tests, prisma backend ──────────────────────────
if (-not $SkipPrisma) {
    Invoke-TestMode `
        -Mode 'api-unit-prisma' `
        -WorkDir (Join-Path $repoRoot 'api') `
        -Command 'npm test -- --run' `
        -EnvVars @{ PERSISTENCE_BACKEND = 'prisma'; DATABASE_URL = $DatabaseUrl }
}

# ─── Mode 3: API E2E tests, in-memory backend ────────────────────────
if (-not $SkipE2E) {
    Invoke-TestMode `
        -Mode 'api-e2e-inmemory' `
        -WorkDir (Join-Path $repoRoot 'api') `
        -Command 'npm run test:e2e' `
        -EnvVars @{ PERSISTENCE_BACKEND = 'inmemory' }
}

# ─── Mode 4: API E2E tests, prisma backend ───────────────────────────
if (-not $SkipE2E -and -not $SkipPrisma) {
    Invoke-TestMode `
        -Mode 'api-e2e-prisma' `
        -WorkDir (Join-Path $repoRoot 'api') `
        -Command 'npm run test:e2e' `
        -EnvVars @{ PERSISTENCE_BACKEND = 'prisma'; DATABASE_URL = $DatabaseUrl }
}

# ─── Mode 5: Web vitest (theme-agnostic at unit level) ──────────────
if (-not $SkipWeb) {
    Invoke-TestMode `
        -Mode 'web-vitest' `
        -WorkDir (Join-Path $repoRoot 'web') `
        -Command 'npm test -- --run'
}

# ─── Mode 6: Web vitest with coverage gate (Phase H4) ───────────────
if (-not $SkipWeb) {
    Invoke-TestMode `
        -Mode 'web-coverage-gate' `
        -WorkDir (Join-Path $repoRoot 'web') `
        -Command 'npm run test:coverage'
}

# ─── Final summary ──────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================"
Write-Host "  Phase H5 test-all-modes summary"
Write-Host "============================================================"
$results | Format-Table -Property Mode, Passed, DurationSec -AutoSize | Out-Host
$failed = ($results | Where-Object { -not $_.Passed }).Count
$total = $results.Count
if ($failed -eq 0) {
    Write-Host "  All $total modes passed." -ForegroundColor Green
    exit 0
}
else {
    Write-Host "  $failed / $total modes FAILED." -ForegroundColor Red
    Write-Host "  Per-mode logs: $repoRoot\test-results\test-all-modes-*.log"
    exit 1
}
