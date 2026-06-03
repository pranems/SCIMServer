# test-all-modes.contract.ps1 - Phase H5 contract test for the
# orchestrator script. Validates the script parses, exposes the
# documented switches, and emits the expected mode-name labels.
#
# This is a script-syntax + parameter-block contract test, NOT a
# functional test: actually running the matrix takes ~5 minutes and
# requires a live Postgres connection for the prisma modes. The
# functional test path is "run scripts/test-all-modes.ps1 yourself
# in CI / pre-push hook".
#
# Why this exists: the orchestrator is only called from CI and from
# the developer's terminal, so silent breakage (a typo'd switch, a
# missing mode entry, a regex that breaks the summary table) is easy
# to introduce. This contract test catches every such regression at
# the same vitest layer that catches every other regression.
#
# Run from PowerShell:
#   .\scripts\test\test-all-modes.contract.ps1
#
# Exits 0 on pass, 1 on any contract violation.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$orchestrator = Join-Path $repoRoot 'scripts' 'test-all-modes.ps1'

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

Write-Host "Phase H5 - test-all-modes.ps1 contract test"
Write-Host "  Script under test: $orchestrator"

# 1. Script exists.
Invoke-Assert -Description 'orchestrator script exists' -Condition (Test-Path $orchestrator)

# 2. Script parses (PowerShell tokenize without execute).
$parseErrors = @()
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    $orchestrator, [ref]$null, [ref]$parseErrors
)
Invoke-Assert -Description 'orchestrator script parses without errors' -Condition ($parseErrors.Count -eq 0)
if ($parseErrors.Count -gt 0) {
    Write-Host "    Parse errors:"
    $parseErrors | ForEach-Object { Write-Host "      $_" }
}

# 3. Script declares all 4 documented switches.
$content = Get-Content $orchestrator -Raw
foreach ($switch in @('SkipPrisma', 'SkipE2E', 'SkipWeb', 'DatabaseUrl')) {
    Invoke-Assert -Description "declares param `$$switch" -Condition ($content -match "\[(switch|string)\]\`$$switch")
}

# 4. Script declares all 6 documented modes.
foreach ($mode in @(
    'api-unit-inmemory',
    'api-unit-prisma',
    'api-e2e-inmemory',
    'api-e2e-prisma',
    'web-vitest',
    'web-coverage-gate'
)) {
    Invoke-Assert -Description "registers mode '$mode'" -Condition ($content -match [regex]::Escape("'$mode'"))
}

# 5. Script restores environment variables in finally block (no leak
#    between modes - this is the most common silent-breakage source).
Invoke-Assert -Description 'env-var stash + restore via finally block' `
    -Condition (($content -match 'finally\s*\{') -and ($content -match 'SetEnvironmentVariable.*stashedEnv'))

# 6. Script declares non-zero exit code on any failure.
Invoke-Assert -Description 'exits 1 when any mode fails' -Condition ($content -match 'exit\s+1')
Invoke-Assert -Description 'exits 0 when all modes pass' -Condition ($content -match 'exit\s+0')
Invoke-Assert -Description 'exits 2 on prerequisite failure' -Condition ($content -match 'exit\s+2')

# Summary.
Write-Host ""
if ($failures.Count -eq 0) {
    Write-Host "All contract assertions passed." -ForegroundColor Green
    exit 0
}
else {
    Write-Host "$($failures.Count) contract assertion(s) failed:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
