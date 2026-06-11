# run-all-gates.contract.ps1 - Stage X.1 D.1 closure contract test.
#
# Validates [scripts/run-all-gates.ps1](../run-all-gates.ps1) parses,
# exposes the documented parameters, registers all 7 stages with the
# gates each stage owns, declares the exit-code contract, and surfaces
# the auto-skip-no-op machinery.
#
# This is a script-syntax + registry contract test, NOT a functional
# test: actually running the orchestrator end-to-end takes 30-60 min
# (full test matrix + Docker build + dev deploy) and requires Azure
# credentials. The functional test path is "run scripts/run-all-gates.ps1
# yourself in CI / pre-push hook".
#
# Why this exists: the orchestrator is the standing entry point for
# the 7-stage gate strategy. Silent breakage (a typo'd switch, a
# missing stage entry, a regex that breaks the registry table) would
# undermine the entire gate strategy in one undetected commit. This
# contract test catches every such regression at the same scripts-test
# layer that catches the test-all-modes.ps1 contract regressions.
#
# Run from PowerShell:
#   .\scripts\test\run-all-gates.contract.ps1
#
# Exits 0 on pass, 1 on any contract violation.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$orchestrator = Join-Path $repoRoot 'scripts' 'run-all-gates.ps1'

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

Write-Host "Stage X.1 D.1 - run-all-gates.ps1 contract test"
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

# 3. Script declares all 4 documented switches / params.
$content = Get-Content $orchestrator -Raw
Invoke-Assert -Description 'declares [switch]$SkipPrompts' -Condition ($content -match '\[switch\]\$SkipPrompts')
Invoke-Assert -Description 'declares [int]$Stage'           -Condition ($content -match '\[(int|Nullable\[int\])\]\$Stage')
Invoke-Assert -Description 'declares [switch]$DryRun'       -Condition ($content -match '\[switch\]\$DryRun')
Invoke-Assert -Description 'declares [switch]$NoPrompt'     -Condition ($content -match '\[switch\]\$NoPrompt')

# 4. Script registers all 7 documented stage labels (Stage 0 -> 6;
#    Stage X is META and intentionally NOT walked by the orchestrator).
foreach ($stage in @(
    'Stage 0 - TDD',
    'Stage 1 - Local Static',
    'Stage 2 - Local Tests',
    'Stage 3a - Test-Completeness',
    'Stage 3b - Cross-Cutting',
    'Stage 3c - Code Hygiene',
    'Stage 4 - Pipeline + Deploy',
    'Stage 5 - UI-Specific',
    'Stage 6 - Commit Hygiene'
)) {
    Invoke-Assert -Description "registers '$stage'" -Condition ($content.Contains($stage))
}

# 5. Script registers the canonical shell-runnable gates from each
#    stage. These are the gates that have a deterministic command and
#    a deterministic pass/fail signal.
foreach ($gate in @(
    'tsc',
    'lint',
    'build',
    'size-limit',
    'vitest',
    'coverage',
    'jest',
    'test-all-modes',
    'full-validation-pipeline'
)) {
    Invoke-Assert -Description "registry references '$gate'" -Condition ($content.ToLower().Contains($gate.ToLower()))
}

# 6. Script registers the canonical AI prompt gates from
#    .github/prompts/ that the strategy says must run per commit.
foreach ($prompt in @(
    'lintAndStaticAnalysis',
    'bundleBudgetAudit',
    'prismaMigrationAudit',
    'crossBackendParityAudit',
    'addMissingTests',
    'apiContractVerification',
    'logging-verification',
    'auditAgainstRFC',
    'securityAudit',
    'codeReviewSelfAudit',
    'auditAndUpdateDocs',
    'playwrightSpecHygieneAudit'
)) {
    Invoke-Assert -Description "registry references prompt '$prompt'" -Condition ($content.Contains($prompt))
}

# 7. Script declares the documented exit-code contract.
Invoke-Assert -Description 'exits 0 when all gates pass'      -Condition ($content -match 'exit\s+0')
Invoke-Assert -Description 'exits 1 when any gate fails'      -Condition ($content -match 'exit\s+1')
Invoke-Assert -Description 'exits 2 on prerequisite failure'  -Condition ($content -match 'exit\s+2')

# 8. Script writes a structured Markdown report to test-results/.
Invoke-Assert -Description 'writes report to test-results/ folder' `
    -Condition ($content -match "test-results[\\/]")
Invoke-Assert -Description 'report filename includes run-all-gates + ISO date' `
    -Condition ($content -match 'run-all-gates-')

# 9. Script honors -DryRun (does not execute commands when set).
Invoke-Assert -Description 'DryRun branch declared' -Condition ($content -match '\$DryRun')

# 10. Script honors -Stage filter (runs only the named stage).
Invoke-Assert -Description 'Stage filter branch declared' -Condition ($content -match '\$Stage\b')

# 11. Script auto-skips prismaMigrationAudit when api/prisma/ untouched
#     (the documented no-op gate behavior).
Invoke-Assert -Description 'auto-skip-no-op for prismaMigrationAudit referenced' `
    -Condition ($content -match 'api[\\/]prisma' -and $content -match 'prismaMigrationAudit')

# 12. Script auto-skips crossBackendParityAudit when no
#     `isInMemoryBackend` branch was touched.
Invoke-Assert -Description 'auto-skip-no-op for crossBackendParityAudit referenced' `
    -Condition ($content -match 'isInMemoryBackend' -and $content -match 'crossBackendParityAudit')

# 13. Script pauses for explicit ack on prompt gates unless -NoPrompt
#     is set (Section D.1 "smoke-screen" mitigation).
Invoke-Assert -Description 'NoPrompt skips operator pause' `
    -Condition ($content -match '\$NoPrompt' -and ($content -match 'Read-Host' -or $content -match 'ReadKey'))

# 14. Script results section uses pass/fail/skipped/partial vocabulary.
foreach ($status in @('PASS', 'FAIL', 'SKIPPED', 'PARTIAL')) {
    Invoke-Assert -Description "result status '$status' declared" -Condition ($content.Contains($status))
}

# 15. Script references the strategy doc + standing-rules file so
#     anyone reading the script can find the authoritative reference.
Invoke-Assert -Description 'links to MANDATORY_QUALITY_GATES_STRATEGY' `
    -Condition ($content -match 'MANDATORY_QUALITY_GATES_STRATEGY')
Invoke-Assert -Description 'links to copilot-instructions.md' `
    -Condition ($content -match 'copilot-instructions\.md')

# 16. Script registers Stage 0 TDD as the FIRST stage (the standing
#     rule depends on its primacy).
Invoke-Assert -Description 'Stage 0 - TDD appears before Stage 1 - Local Static' `
    -Condition (($content.IndexOf('Stage 0 - TDD')) -lt ($content.IndexOf('Stage 1 - Local Static')))

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
