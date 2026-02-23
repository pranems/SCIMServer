<#
.SYNOPSIS
    Full end-to-end validation pipeline: local build + test, then Docker build + test.
.DESCRIPTION
    Phase 1: Clean local build, unit tests, E2E tests, start local instance, run live tests.
    Phase 2: Docker compose build (no-cache), start containers, health check, run live tests.
    Keeps the Docker container running at the end (user requested).
.PARAMETER SkipLocal
    Skip Phase 1 (local build & test) and go straight to Docker.
.PARAMETER SkipDocker
    Skip Phase 2 (Docker build & test).
.PARAMETER Verbose
    Pass -Verbose to live-test.ps1 for full HTTP request/response output.
#>

param(
    [switch]$SkipLocal,
    [switch]$SkipDocker,
    [switch]$VerboseTests
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$apiDir = Join-Path $repoRoot "api"
$liveTestScript = Join-Path $scriptDir "live-test.ps1"

$localPort = 6000
$dockerPort = 8080
$localBaseUrl = "http://localhost:$localPort"
$dockerBaseUrl = "http://localhost:$dockerPort"
$dockerSecret = "devscimsharedsecret"
$dockerOAuthSecret = "devscimclientsecret"

# Tracking
$phase1Result = $null
$phase2Result = $null

function Write-Phase($phase, $step, $message) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " Phase $phase — Step $step : $message" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-Result($label, $success) {
    if ($success) {
        Write-Host "  ✅ $label" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $label" -ForegroundColor Red
    }
}

function Wait-ForEndpoint($url, $timeoutSeconds = 60, $label = "endpoint") {
    Write-Host "  Waiting for $label at $url ..." -ForegroundColor Yellow
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($resp.StatusCode -eq 200) {
                Write-Host "  $label is ready (HTTP 200)" -ForegroundColor Green
                return $true
            }
        } catch { }
        Start-Sleep -Seconds 2
    }
    Write-Host "  ⏰ Timed out waiting for $label after ${timeoutSeconds}s" -ForegroundColor Red
    return $false
}

# ══════════════════════════════════════════════════════════════
# PHASE 1 — Local Build & Validation
# ══════════════════════════════════════════════════════════════
if (-not $SkipLocal) {
    Write-Host "`n╔══════════════════════════════════════════╗" -ForegroundColor White
    Write-Host   "║     PHASE 1 — LOCAL BUILD & VALIDATION   ║" -ForegroundColor White
    Write-Host   "╚══════════════════════════════════════════╝" -ForegroundColor White

    # Step 1: Clean build
    Write-Phase 1 1 "Clean Build"
    Push-Location $apiDir
    try {
        if (Test-Path dist) { Remove-Item -Recurse -Force dist }
        Write-Host "  Removed dist/. Running tsc..." -ForegroundColor Yellow
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Build failed" }
        Write-Result "Clean build succeeded" $true
    } catch {
        Write-Result "Clean build FAILED: $_" $false
        Pop-Location
        exit 1
    }

    # Step 2: Unit tests
    Write-Phase 1 2 "Unit Tests"
    try {
        npx jest --no-coverage 2>&1 | Tee-Object -Variable unitOutput
        $unitLine = ($unitOutput | Select-String "Tests:.*passed").Line
        if ($LASTEXITCODE -ne 0) { throw "Unit tests failed" }
        Write-Result "Unit tests passed — $unitLine" $true
    } catch {
        Write-Result "Unit tests FAILED: $_" $false
        Pop-Location
        exit 1
    }

    # Step 3: E2E tests
    Write-Phase 1 3 "E2E Tests"
    try {
        npm run test:e2e 2>&1 | Tee-Object -Variable e2eOutput
        $e2eLine = ($e2eOutput | Select-String "Tests:.*passed").Line
        if ($LASTEXITCODE -ne 0) { throw "E2E tests failed" }
        Write-Result "E2E tests passed — $e2eLine" $true
    } catch {
        Write-Result "E2E tests FAILED: $_" $false
        Pop-Location
        exit 1
    }

    # Step 4: Start local instance
    Write-Phase 1 4 "Start Local Instance (port $localPort)"
    try {
        # Start dev server in background
        $env:PORT = $localPort
        $localProc = Start-Process -FilePath "npx" -ArgumentList "ts-node-dev --respawn --transpile-only src/main.ts" `
            -WorkingDirectory $apiDir -PassThru -WindowStyle Hidden -RedirectStandardOutput "$apiDir\local-server.log" -RedirectStandardError "$apiDir\local-server-err.log"
        Write-Host "  Local server PID: $($localProc.Id)" -ForegroundColor Yellow

        $ready = Wait-ForEndpoint $localBaseUrl 60 "local instance"
        if (-not $ready) { throw "Local instance did not start" }
        Write-Result "Local instance running on port $localPort" $true
    } catch {
        Write-Result "Local instance start FAILED: $_" $false
        if ($localProc -and -not $localProc.HasExited) { Stop-Process -Id $localProc.Id -Force }
        Pop-Location
        exit 1
    }

    # Step 5: Live tests against local
    Write-Phase 1 5 "Live Tests (local)"
    try {
        $liveArgs = @("-BaseUrl", $localBaseUrl)
        if ($VerboseTests) { $liveArgs += "-Verbose" }
        & $liveTestScript @liveArgs 2>&1 | Tee-Object -Variable liveOutput
        $liveLine = ($liveOutput | Select-String "passed").Line | Select-Object -Last 1
        Write-Result "Live tests (local) — $liveLine" $true
        $phase1Result = $liveLine
    } catch {
        Write-Result "Live tests (local) FAILED: $_" $false
        $phase1Result = "FAILED"
    } finally {
        # Step 6: Stop local instance
        Write-Host "  Stopping local instance (PID $($localProc.Id))..." -ForegroundColor Yellow
        if ($localProc -and -not $localProc.HasExited) { Stop-Process -Id $localProc.Id -Force -ErrorAction SilentlyContinue }
        Remove-Item -Force "$apiDir\local-server.log", "$apiDir\local-server-err.log" -ErrorAction SilentlyContinue
        Write-Result "Local instance stopped" $true
    }

    Pop-Location

    Write-Host "`n────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host " Phase 1 Summary:" -ForegroundColor Cyan
    Write-Host "   Unit tests: $unitLine" -ForegroundColor White
    Write-Host "   E2E tests:  $e2eLine" -ForegroundColor White
    Write-Host "   Live tests: $phase1Result" -ForegroundColor White
    Write-Host "────────────────────────────────────────" -ForegroundColor Cyan
}

# ══════════════════════════════════════════════════════════════
# PHASE 2 — Docker Build & Validation
# ══════════════════════════════════════════════════════════════
if (-not $SkipDocker) {
    Write-Host "`n╔══════════════════════════════════════════╗" -ForegroundColor White
    Write-Host   "║    PHASE 2 — DOCKER BUILD & VALIDATION   ║" -ForegroundColor White
    Write-Host   "╚══════════════════════════════════════════╝" -ForegroundColor White

    Push-Location $repoRoot

    # Step 6: Stop any existing containers
    Write-Phase 2 1 "Clean Up Existing Containers"
    docker compose down --remove-orphans 2>&1 | Out-Null
    Write-Result "Existing containers removed" $true

    # Step 7: Build Docker image (no-cache)
    Write-Phase 2 2 "Build Docker Image (no-cache)"
    try {
        $buildStart = Get-Date
        docker compose build --no-cache 2>&1 | Tee-Object -Variable buildOutput
        if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }
        $buildDuration = [math]::Round(((Get-Date) - $buildStart).TotalSeconds)
        Write-Result "Docker image built in ${buildDuration}s" $true
    } catch {
        Write-Result "Docker build FAILED: $_" $false
        Pop-Location
        exit 1
    }

    # Step 8: Start Docker containers
    Write-Phase 2 3 "Start Docker Containers"
    try {
        $env:SCIM_SHARED_SECRET = $dockerSecret
        $env:OAUTH_CLIENT_SECRET = $dockerOAuthSecret
        docker compose up -d 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Docker compose up failed" }
        Write-Host "  Containers starting..." -ForegroundColor Yellow
    } catch {
        Write-Result "Docker start FAILED: $_" $false
        Pop-Location
        exit 1
    }

    # Step 9: Health check
    Write-Phase 2 4 "Health Check"
    $ready = Wait-ForEndpoint $dockerBaseUrl 90 "Docker container"
    if (-not $ready) {
        Write-Host "  Docker logs:" -ForegroundColor Red
        docker compose logs --tail 30 api
        Write-Result "Docker health check FAILED" $false
        Pop-Location
        exit 1
    }

    # Also verify version endpoint
    try {
        $headers = @{ Authorization = "Bearer $dockerSecret" }
        $versionResp = Invoke-RestMethod -Uri "$dockerBaseUrl/scim/admin/version" -Headers $headers -TimeoutSec 5
        Write-Host "  Version: $($versionResp.version), Node: $($versionResp.runtime.node)" -ForegroundColor Green
        Write-Result "Docker container healthy" $true
    } catch {
        Write-Host "  Version check warning: $_" -ForegroundColor Yellow
    }

    # Step 10: Live tests against Docker
    Write-Phase 2 5 "Live Tests (Docker)"
    try {
        $liveArgs = @(
            "-BaseUrl", $dockerBaseUrl,
            "-ClientSecret", $dockerOAuthSecret
        )
        if ($VerboseTests) { $liveArgs += "-Verbose" }
        & $liveTestScript @liveArgs 2>&1 | Tee-Object -Variable dockerLiveOutput
        $dockerLiveLine = ($dockerLiveOutput | Select-String "passed").Line | Select-Object -Last 1
        Write-Result "Live tests (Docker) — $dockerLiveLine" $true
        $phase2Result = $dockerLiveLine
    } catch {
        Write-Result "Live tests (Docker) FAILED: $_" $false
        $phase2Result = "FAILED"
    }

    Pop-Location

    Write-Host "`n────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host " Phase 2 Summary:" -ForegroundColor Cyan
    Write-Host "   Docker build: ${buildDuration}s" -ForegroundColor White
    Write-Host "   Live tests:   $phase2Result" -ForegroundColor White
    Write-Host "────────────────────────────────────────" -ForegroundColor Cyan

    # NOTE: Docker containers intentionally left running per user request
    Write-Host "`n  📦 Docker containers are still running:" -ForegroundColor Yellow
    docker compose ps 2>&1
}

# ══════════════════════════════════════════════════════════════
# Final Summary
# ══════════════════════════════════════════════════════════════
Write-Host "`n╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host   "║          VALIDATION PIPELINE REPORT       ║" -ForegroundColor Green
Write-Host   "╚══════════════════════════════════════════╝" -ForegroundColor Green

if ($phase1Result) {
    Write-Host "  Phase 1 (Local):"  -ForegroundColor White
    Write-Host "    Unit:  $unitLine" -ForegroundColor White
    Write-Host "    E2E:   $e2eLine" -ForegroundColor White
    Write-Host "    Live:  $phase1Result" -ForegroundColor White
}
if ($phase2Result) {
    Write-Host "  Phase 2 (Docker):" -ForegroundColor White
    Write-Host "    Build: ${buildDuration}s" -ForegroundColor White
    Write-Host "    Live:  $phase2Result" -ForegroundColor White
}

Write-Host "`nPipeline complete." -ForegroundColor Green
