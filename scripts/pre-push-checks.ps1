<#
.SYNOPSIS
    Pre-push gate runner that mirrors every CI gate that runs before a PR
    can merge to master. Designed to be invoked by .git/hooks/pre-push but
    also runnable standalone.

.DESCRIPTION
    Three modes, from cheapest to most thorough:

      Fast (default for the hook)         ~1-2 min
        - api npm run build (TS compile)
        - api npm run lint
        - web npx tsc --noEmit
        - web npm run build

      Validate (mirrors CI .github/workflows/build-test.yml validate job)
                                          ~8-12 min
        - Everything in Fast, plus:
        - api npx prisma generate (required before lint + tests)
        - api migration linter (npx ts-node lint-migrations.ts)
        - api npm test (unit)
        - api npm run test:e2e (inmemory backend, maxWorkers=2, same
          excludes as CI)
        - web npm test (vitest)

      Full                                ~15-20 min
        - Everything in Validate, plus:
        - docker build (mirrors build-and-push.yml build step)
        - trivy image scan (mirrors HIGH+CRITICAL gating)

    CI gates NOT covered locally (intentionally):
      - CodeQL security-extended scan      (requires GitHub Advanced Security)
      - GHCR push                          (requires registry credentials)
      - Container app deploy + live test   (out of scope for pre-push)

    For those, rely on the GitHub Actions runs against the pushed branch
    and on scripts/run-all-gates.ps1 (full Stage 0-6 walker) before
    opening / promoting a PR.

.PARAMETER Mode
    Fast | Validate | Full. Defaults to Fast.

.PARAMETER FailFast
    Stop on first failed gate (default). Pass -FailFast:$false to run
    every gate even after a failure so the summary shows all problems.

.EXAMPLE
    .\scripts\pre-push-checks.ps1
    Default Fast mode. Returns exit 0 on green, non-zero on any failure.

.EXAMPLE
    .\scripts\pre-push-checks.ps1 -Mode Validate
    Mirror the CI validate job. Run this before opening / promoting a PR.

.EXAMPLE
    $env:PREPUSH_MODE = 'validate'; git push
    The hook honors $env:PREPUSH_MODE to escalate from Fast to Validate /
    Full without editing the hook file.

.NOTES
    Standing rules honored:
      - No em-dash anywhere (uses hyphen)
      - Returns non-zero on failure so git refuses to push
      - Bypass only via `git push --no-verify` (which is itself banned
        by the standing rule, but the mechanism stays for emergencies)
#>

[CmdletBinding()]
param(
    [ValidateSet('Fast', 'Validate', 'Full')]
    [string]$Mode = 'Fast',

    [switch]$FailFast = $true
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$results = [System.Collections.Generic.List[object]]::new()
$overallStart = Get-Date

function Invoke-Gate {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [scriptblock]$Action,
        [string]$WorkingDir = $repoRoot
    )

    Write-Host ""
    Write-Host ("=== [{0}] {1} ===" -f $Mode, $Name) -ForegroundColor Cyan
    $start = Get-Date
    $status = 'PASS'
    $exitCode = 0
    $err = $null

    try {
        Push-Location $WorkingDir
        & $Action
        $exitCode = $LASTEXITCODE
        if ($null -ne $exitCode -and $exitCode -ne 0) {
            $status = 'FAIL'
        }
    }
    catch {
        $status = 'FAIL'
        $err = $_.Exception.Message
        Write-Host $err -ForegroundColor Red
    }
    finally {
        Pop-Location
    }

    $duration = (Get-Date) - $start
    $results.Add([pscustomobject]@{
        Gate     = $Name
        Status   = $status
        Seconds  = [math]::Round($duration.TotalSeconds, 1)
        ExitCode = $exitCode
        Error    = $err
    })

    if ($status -eq 'FAIL') {
        Write-Host ("--> {0} FAILED in {1}s (exit {2})" -f $Name, [math]::Round($duration.TotalSeconds, 1), $exitCode) -ForegroundColor Red
        if ($FailFast) {
            Show-Summary
            exit 1
        }
    }
    else {
        Write-Host ("--> {0} OK in {1}s" -f $Name, [math]::Round($duration.TotalSeconds, 1)) -ForegroundColor Green
    }
}

function Show-Summary {
    $overallDuration = (Get-Date) - $overallStart
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host (" PRE-PUSH SUMMARY [Mode: {0}] - total {1}s" -f $Mode, [math]::Round($overallDuration.TotalSeconds, 1)) -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Yellow
    $results | Format-Table Gate, Status, Seconds, ExitCode -AutoSize | Out-String | Write-Host
    $failed = ($results | Where-Object Status -eq 'FAIL').Count
    if ($failed -gt 0) {
        Write-Host ("FAILED: {0} gate(s). Push blocked." -f $failed) -ForegroundColor Red
    }
    else {
        Write-Host "All gates GREEN. Push allowed." -ForegroundColor Green
    }
}

# -------------------------------------------------------------------------
# Fast gates (always run)
# -------------------------------------------------------------------------

Invoke-Gate -Name 'api: tsc build' -WorkingDir (Join-Path $repoRoot 'api') -Action {
    npm run build 2>&1 | Out-Host
}

Invoke-Gate -Name 'api: eslint' -WorkingDir (Join-Path $repoRoot 'api') -Action {
    npm run lint 2>&1 | Out-Host
}

Invoke-Gate -Name 'web: tsc --noEmit' -WorkingDir (Join-Path $repoRoot 'web') -Action {
    # Web tsc baseline tolerance: project has 96 known errors (87 test / 9 prod)
    # per .github/copilot-instructions.md Stage 1.4. Count must NOT regress upward.
    $tscOut = npx tsc --noEmit 2>&1
    $tscErrorCount = ($tscOut | Select-String -Pattern "error TS" | Measure-Object).Count
    Write-Host ("web tsc error count: {0} (baseline: 96, must not regress)" -f $tscErrorCount)
    if ($tscErrorCount -gt 96) {
        Write-Host ("REGRESSION: web tsc errors above 96 baseline. Output:") -ForegroundColor Red
        $tscOut | Out-Host
        $global:LASTEXITCODE = 1
    }
    else {
        $global:LASTEXITCODE = 0
    }
}

Invoke-Gate -Name 'web: vite production build' -WorkingDir (Join-Path $repoRoot 'web') -Action {
    npm run build 2>&1 | Out-Host
}

# -------------------------------------------------------------------------
# Validate gates (mirror CI validate job)
# -------------------------------------------------------------------------

if ($Mode -in @('Validate', 'Full')) {

    Invoke-Gate -Name 'api: prisma generate' -WorkingDir (Join-Path $repoRoot 'api') -Action {
        npx prisma generate 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'api: migration linter (additive-only)' -WorkingDir (Join-Path $repoRoot 'api') -Action {
        npx ts-node --transpile-only src/scripts/lint-migrations.ts 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'api: unit tests (jest)' -WorkingDir (Join-Path $repoRoot 'api') -Action {
        npm test 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'api: e2e tests (inmemory, maxWorkers=2)' -WorkingDir (Join-Path $repoRoot 'api') -Action {
        # Match CI exactly: same env vars, same excludes, same worker count.
        $env:PERSISTENCE_BACKEND = 'inmemory'
        $env:SCIM_SHARED_SECRET = 'ci-shared-secret-not-for-production'
        $env:JWT_SECRET = 'ci-jwt-secret-not-for-production'
        $env:OAUTH_CLIENT_SECRET = 'ci-oauth-secret-not-for-production'
        npm run test:e2e -- --maxWorkers=2 --testPathIgnorePatterns 'endpoint-scoped-logs.e2e-spec.ts' --testPathIgnorePatterns 'log-config.e2e-spec.ts' 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'web: vitest' -WorkingDir (Join-Path $repoRoot 'web') -Action {
        npm test 2>&1 | Out-Host
    }
}

# -------------------------------------------------------------------------
# Full gates (mirror build-and-push.yml docker steps)
# -------------------------------------------------------------------------

if ($Mode -eq 'Full') {

    Invoke-Gate -Name 'docker: build image (linux/amd64)' -Action {
        $tag = "scimserver:prepush-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $env:_PREPUSH_DOCKER_TAG = $tag
        docker build -t $tag -f Dockerfile . 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'trivy: HIGH+CRITICAL scan (matches CI)' -Action {
        $tag = $env:_PREPUSH_DOCKER_TAG
        if (-not $tag) {
            Write-Host "Skipped (no docker tag from previous gate)" -ForegroundColor Yellow
            $global:LASTEXITCODE = 0
            return
        }
        $trivyExe = Get-Command trivy -ErrorAction SilentlyContinue
        if (-not $trivyExe) {
            Write-Host "trivy not installed locally. Skipping (CI still enforces this gate)." -ForegroundColor Yellow
            $global:LASTEXITCODE = 0
            return
        }
        trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --vuln-type os,library --ignorefile .trivyignore $tag 2>&1 | Out-Host
    }
}

# -------------------------------------------------------------------------
# Summary + exit
# -------------------------------------------------------------------------

Show-Summary
$failedCount = ($results | Where-Object Status -eq 'FAIL').Count
if ($failedCount -gt 0) {
    exit 1
}
exit 0
