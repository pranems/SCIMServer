$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pipeline = Join-Path $repoRoot 'scripts\dev-deployment-pipeline.ps1'
$failures = @()

function Invoke-Assert {
    param(
        [Parameter(Mandatory)] [string]$Description,
        [Parameter(Mandatory)] [bool]$Condition
    )

    if ($Condition) {
        Write-Host "  PASS: $Description" -ForegroundColor Green
    }
    else {
        Write-Host "  FAIL: $Description" -ForegroundColor Red
        $script:failures += $Description
    }
}

Write-Host 'Dev deployment pipeline evidence contract'
Write-Host "  Script under test: $pipeline"

Invoke-Assert -Description 'pipeline script exists' -Condition (Test-Path -LiteralPath $pipeline)

$parseErrors = @()
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    $pipeline, [ref]$null, [ref]$parseErrors
)
Invoke-Assert -Description 'pipeline script parses without errors' -Condition ($parseErrors.Count -eq 0)

$content = Get-Content -LiteralPath $pipeline -Raw
Invoke-Assert -Description 'Playwright keeps the readable line reporter' `
    -Condition ($content -match 'playwright\s+test\s+--reporter=line,json')
$writesJsonReport = ($content -match 'PLAYWRIGHT_JSON_OUTPUT_FILE\s*=\s*Join-Path\s+\$ReportDir') -and ($content -match 'playwright-dev-\$timestamp\.json')
Invoke-Assert -Description 'Playwright writes machine-readable results under the deployment report directory' `
    -Condition $writesJsonReport
$restoresJsonReporter = ($content -match 'previousPlaywrightJsonOutput') -and ($content -match "(?s)SetEnvironmentVariable\(\s*'PLAYWRIGHT_JSON_OUTPUT_FILE'")
Invoke-Assert -Description 'Playwright reporter environment is restored after the gate' `
    -Condition $restoresJsonReporter

Write-Host ''
if ($failures.Count -eq 0) {
    Write-Host 'All deployment evidence assertions passed.' -ForegroundColor Green
    exit 0
}

Write-Host "$($failures.Count) deployment evidence assertion(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
exit 1
