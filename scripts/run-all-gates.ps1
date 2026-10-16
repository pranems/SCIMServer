<#
.SYNOPSIS
    Stage X.1 D.1 closure - orchestrator for the 7-stage Mandatory Quality Gates strategy.

.DESCRIPTION
    Walks Stage 0 -> Stage 6 in order (Stage X is meta and is NOT walked
    per-commit) and surfaces every gate the strategy requires. For
    shell-runnable gates the orchestrator executes them and captures
    PASS / FAIL / SKIPPED / PARTIAL. For AI skill gates (.github/skills/)
    the orchestrator prints the skill file path + suggested invocation
    and (unless -NoSkillAcknowledgement) pauses for the operator to acknowledge
    pass / fail / skip.

    Authoritative gate strategy:
      - docs/MANDATORY_QUALITY_GATES_STRATEGY.md (deliberation + Mermaid diagrams)
      - .github/copilot-instructions.md           (Mandatory Quality Gates section)

    Why this script exists: the first Stage X.1 self-audit
    (docs/strategy/SELF_AUDIT_2026-05-16.md Section D.1) found a ~25 %
    gate-invocation rate on the first feature commit under the new
    strategy. A one-command walker is the leverage that drops that gap
    to near zero. Mitigation against the "smoke-screen" risk: the
    orchestrator pauses on every finding and requires explicit
    acknowledgment (unless -NoSkillAcknowledgement). Operator discipline is still
    required; this script is the scaffold, not the substitute.

    Architecture:
      - Stage registry table (`$STAGES`): one entry per stage with the
        gates it owns. Each gate is either a `Shell` (deterministic
        command + pass/fail signal) or a `Skill` (operator-driven AI
        skill; printed for invocation; ack required).
      - Auto-skip-no-op: certain gates declare a `When` predicate that
        consults `git diff --name-only` against HEAD. If the predicate
        returns $false the gate is recorded SKIPPED with reason.
      - Report: a structured Markdown file written to
        test-results/run-all-gates-<YYYY-MM-DD-HHmmss>.md with one
        section per stage, one table row per gate, status + duration +
        notes column.

.PARAMETER SkipSkills
    Run only shell-runnable gates. AI skill gates are recorded as
    SKIPPED with status note "skipped by -SkipSkills". Use this for
    a fast pre-push sanity check (~20 min); use the full walk before
    feature / release commits. The legacy -SkipPrompts name remains
    available as a compatibility alias.

.PARAMETER Stage
    Run only the named stage (0..6). All other stages are skipped.
    Useful for iterating on a single stage's failure without re-running
    the full chain. Pass 0 for Stage 0 - TDD, 1 for Stage 1 - Local
    Static, etc. (Stages 3a/3b/3c are addressed by passing 3, which
    runs all three sub-stages in order.)

.PARAMETER DryRun
    Print every gate the orchestrator would run + its predicate result,
    but do not execute any command and do not pause for skill acknowledgements.
    Useful for previewing the per-stage plan before a large run.

.PARAMETER NoSkillAcknowledgement
    Do not pause for operator acknowledgment on skill gates. Each
    skill gate is recorded with status SKILL_NOT_ACKNOWLEDGED so the
    report makes the gap visible. Use only for CI / unattended runs.
    The legacy -NoPrompt name remains available as a compatibility alias.

.PARAMETER ReportDir
    Override the directory the structured report is written to.
    Defaults to <repo>/test-results.

.EXAMPLE
    .\scripts\run-all-gates.ps1
    Full walk of Stage 0 -> Stage 6 with operator pause on skill gates.

.EXAMPLE
    .\scripts\run-all-gates.ps1 -SkipSkills -Stage 1
    Run only Stage 1 - Local Static, only shell-runnable gates.

.EXAMPLE
    .\scripts\run-all-gates.ps1 -DryRun
    Print the per-stage plan for the current working tree without
    running anything (use to preview what a full run would do).

.EXAMPLE
    .\scripts\run-all-gates.ps1 -NoSkillAcknowledgement -SkipSkills
    Unattended shell-only mode for CI; skill gates surface as
    SKILL_NOT_ACKNOWLEDGED in the report.

.NOTES
    Exit codes:
        0 - all walked gates passed (or were legitimately skipped)
        1 - one or more walked gates failed
        2 - prerequisite check failed (missing npm / docker / etc)
#>

[CmdletBinding()]
param(
    [Alias('SkipPrompts')]
    [switch]$SkipSkills,
    [int]$Stage = -1,
    [switch]$DryRun,
    [Alias('NoPrompt')]
    [switch]$NoSkillAcknowledgement,
    [string]$ReportDir = ''
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $DryRun) {
    try {
        & (Join-Path $PSScriptRoot 'assert-dependency-ownership.ps1') -RepositoryRoot $repoRoot
    } catch {
        Write-Error $_ -ErrorAction Continue
        exit 2
    }
}
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot 'test-results'
}
if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

# ---------------------------------------------------------------
# Prerequisite check - npm + git must be on PATH. docker is checked
# lazily (Stage 4 Docker live tests print a clear FAIL if missing
# rather than blocking the whole walk).
# ---------------------------------------------------------------

function Test-Prerequisite {
    $missing = @()
    foreach ($cmd in @('git', 'npm', 'node')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            $missing += $cmd
        }
    }
    if (-not (Test-Path (Join-Path $repoRoot 'api'))) { $missing += 'api/ folder' }
    if (-not (Test-Path (Join-Path $repoRoot 'web'))) { $missing += 'web/ folder' }
    if ($missing.Count -gt 0) {
        Write-Host "Prerequisite check failed - missing: $($missing -join ', ')" -ForegroundColor Red
        exit 2
    }
}
Test-Prerequisite

# ---------------------------------------------------------------
# Working-tree change detection - used by auto-skip-no-op predicates.
# ---------------------------------------------------------------

function Get-ChangedFiles {
    # Files changed in the current commit OR in the working tree.
    # Includes staged + unstaged + last-commit so the predicate is
    # safe both as a pre-push and pre-commit hook.
    try {
        $staged = git diff --name-only --cached 2>$null
        $unstaged = git diff --name-only 2>$null
        $lastCommit = git diff --name-only HEAD~1..HEAD 2>$null
        $combined = @($staged) + @($unstaged) + @($lastCommit) | Where-Object { $_ } | Select-Object -Unique
        return $combined
    }
    catch {
        # Outside a git repo or initial commit - assume all gates apply.
        return @()
    }
}

$script:changedFiles = Get-ChangedFiles

function Test-PathTouched {
    param([string]$Pattern)
    return ($script:changedFiles | Where-Object { $_ -match $Pattern }).Count -gt 0
}

# ---------------------------------------------------------------
# Stage + gate registry. Each gate has:
#   Name        - human-readable label (printed + report row)
#   Kind        - 'Shell' (orchestrator runs Command) or 'Skill'
#                 (orchestrator prints SkillPath and waits for ack)
#   Command     - PowerShell expression to run (Shell only)
#   SkillPath   - path under .github/skills/ (Skill only)
#   WorkDir     - cwd to use (Shell only; defaults to repo root)
#   When        - optional scriptblock returning $true if the gate
#                 applies; if $false the gate is SKIPPED auto-no-op
#   Reason      - skip-reason text printed when When returns $false
# ---------------------------------------------------------------

$STAGES = [ordered]@{
    'Stage 0 - TDD' = @(
        @{
            Name = 'TDD discipline (RED -> GREEN -> REFACTOR sequence verified)'
            Kind = 'Skill'
            SkillPath = '.github/skills/selfimprovingtask/SKILL.md'
        }
    )

    'Stage 1 - Local Static' = @(
        @{
            Name = 'lintAndStaticAnalysis skill (orchestrator for Stage 1)'
            Kind = 'Skill'
            SkillPath = '.github/skills/lintandstaticanalysis/SKILL.md'
        }
        @{
            Name = 'API tsc build (cd api; npm run build)'
            Kind = 'Shell'
            Command = 'npm run build'
            WorkDir = 'api'
        }
        @{
            Name = 'API ESLint (cd api; npm run lint)'
            Kind = 'Shell'
            Command = 'npm run lint'
            WorkDir = 'api'
        }
        @{
            Name = 'Web tsc check (cd web; npx tsc --noEmit)'
            Kind = 'Shell'
            Command = 'npx tsc --noEmit'
            WorkDir = 'web'
        }
        @{
            Name = 'Web ESLint (cd web; npx eslint src) - N/A until config lands'
            Kind = 'Shell'
            Command = 'if (Test-Path eslint.config.mjs) { npx eslint src } else { Write-Host "no eslint config - SKIPPED" }'
            WorkDir = 'web'
        }
        @{
            Name = 'Web production build (cd web; npm run build)'
            Kind = 'Shell'
            Command = 'npm run build'
            WorkDir = 'web'
        }
        @{
            Name = 'Web size-limit budgets (cd web; npm run size)'
            Kind = 'Shell'
            Command = 'npm run size'
            WorkDir = 'web'
        }
        @{
            Name = 'bundleBudgetAudit skill (new lazy routes have size-limit entries)'
            Kind = 'Skill'
            SkillPath = '.github/skills/bundlebudgetaudit/SKILL.md'
            When = { Test-PathTouched 'web[\\/]src[\\/]routes[\\/]' }
            Reason = 'no web/src/routes/ files touched'
        }
        @{
            Name = 'prismaMigrationAudit skill (schema + migrations + repos in lockstep)'
            Kind = 'Skill'
            SkillPath = '.github/skills/prismamigrationaudit/SKILL.md'
            When = { Test-PathTouched 'api[\\/]prisma[\\/]' }
            Reason = 'no api/prisma/ files touched'
        }
    )

    'Stage 2 - Local Tests' = @(
        @{
            Name = 'API unit jest (cd api; npm test)'
            Kind = 'Shell'
            Command = 'npm test'
            WorkDir = 'api'
        }
        @{
            Name = 'API E2E jest (cd api; npm run test:e2e)'
            Kind = 'Shell'
            Command = 'npm run test:e2e'
            WorkDir = 'api'
        }
        @{
            Name = 'Web vitest (cd web; npm test)'
            Kind = 'Shell'
            Command = 'npm test'
            WorkDir = 'web'
        }
        @{
            Name = 'Web vitest coverage gate (cd web; npm run test:coverage)'
            Kind = 'Shell'
            Command = 'npm run test:coverage'
            WorkDir = 'web'
        }
        @{
            Name = 'crossBackendParityAudit skill (isInMemoryBackend parity)'
            Kind = 'Skill'
            SkillPath = '.github/skills/crossbackendparityaudit/SKILL.md'
            When = {
                # Cheap proxy: if any api/src file changed AND that file
                # contains an isInMemoryBackend branch, the audit applies.
                $apiFiles = $script:changedFiles | Where-Object { $_ -match 'api[\\/]src[\\/]' }
                foreach ($f in $apiFiles) {
                    $full = Join-Path $repoRoot $f
                    if ((Test-Path $full) -and ((Get-Content $full -Raw -ErrorAction SilentlyContinue) -match 'isInMemoryBackend')) {
                        return $true
                    }
                }
                return $false
            }
            Reason = 'no changed api/src/ file references isInMemoryBackend'
        }
        @{
            Name = 'test-all-modes.ps1 (API + Web across 6 persistence modes)'
            Kind = 'Shell'
            Command = 'pwsh -NoProfile -File scripts/test-all-modes.ps1'
        }
    )

    'Stage 3a - Test-Completeness' = @(
        @{
            Name = 'addMissingTests skill (unit + E2E + live gap-fill)'
            Kind = 'Skill'
            SkillPath = '.github/skills/addmissingtests/SKILL.md'
        }
        @{
            Name = 'apiContractVerification skill (key-allowlist + no leaked _ fields)'
            Kind = 'Skill'
            SkillPath = '.github/skills/apicontractverification/SKILL.md'
        }
        @{
            Name = 'error-handling-verification skill (HTTP + scimType + smart-error envelope)'
            Kind = 'Skill'
            SkillPath = '.github/skills/error-handling-verification/SKILL.md'
        }
    )

    'Stage 3b - Cross-Cutting' = @(
        @{
            Name = 'logging-verification skill (level + category + PII redaction + requestId)'
            Kind = 'Skill'
            SkillPath = '.github/skills/logging-verification/SKILL.md'
        }
        @{
            Name = 'auditAgainstRFC skill (RFC 7643 + RFC 7644 compliance)'
            Kind = 'Skill'
            SkillPath = '.github/skills/auditagainstrfc/SKILL.md'
        }
        @{
            Name = 'endpointConfigFlagAudit skill (10-cell completeness for flag changes)'
            Kind = 'Skill'
            SkillPath = '.github/skills/endpointconfigflagaudit/SKILL.md'
        }
        @{
            Name = 'securityAudit skill (auth + secrets + input validation + OWASP Top 10)'
            Kind = 'Skill'
            SkillPath = '.github/skills/securityaudit/SKILL.md'
        }
        @{
            Name = 'dependencyCveSweep skill (Critical/High blocks; Moderate tracked)'
            Kind = 'Skill'
            SkillPath = '.github/skills/dependencycvesweep/SKILL.md'
            When = {
                (Test-PathTouched 'package\.json$') -or (Test-PathTouched 'package-lock\.json$')
            }
            Reason = 'no package.json or package-lock.json changes'
        }
        @{
            Name = 'performanceBenchmark skill (p50/p95/p99 + N+1 detection)'
            Kind = 'Skill'
            SkillPath = '.github/skills/performancebenchmark/SKILL.md'
        }
    )

    'Stage 3c - Code Hygiene' = @(
        @{
            Name = 'codeReviewSelfAudit skill (SOLID / DRY / readability on CHANGED files)'
            Kind = 'Skill'
            SkillPath = '.github/skills/codereviewselfaudit/SKILL.md'
        }
        @{
            Name = 'auditAndUpdateDocs skill (INDEX + Session_starter + CONTEXT + CHANGELOG + README sweep)'
            Kind = 'Skill'
            SkillPath = '.github/skills/auditandupdatedocs/SKILL.md'
        }
    )

    'Stage 4 - Pipeline + Deploy' = @(
        @{
            Name = 'fullValidationPipeline skill (end-to-end local + Docker)'
            Kind = 'Skill'
            SkillPath = '.github/skills/fullvalidationpipeline/SKILL.md'
        }
        @{
            Name = 'full-validation-pipeline.ps1 (local build + Docker compose smoke)'
            Kind = 'Shell'
            Command = 'pwsh -NoProfile -File scripts/full-validation-pipeline.ps1'
        }
        @{
            Name = 'Local node live tests (inmemory; port 6000)'
            Kind = 'Shell'
            Command = "pwsh -NoProfile -File scripts/live-test.ps1"
        }
        @{
            Name = 'Docker compose live tests (port 8080)'
            Kind = 'Shell'
            Command = "pwsh -NoProfile -File scripts/live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret 'changeme-oauth'"
        }
        @{
            Name = 'Dev Azure live tests (current commit SHA; scimserver-dev)'
            Kind = 'Shell'
            Command = "pwsh -NoProfile -File scripts/live-test.ps1 -BaseUrl https://scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io -ClientSecret 'changeme-oauth'"
        }
    )

    'Stage 5 - UI-Specific' = @(
        @{
            Name = 'uiTestAndValidation skill (React/vitest + a11y + visual sanity)'
            Kind = 'Skill'
            SkillPath = '.github/skills/uitestandvalidation/SKILL.md'
            When = { Test-PathTouched 'web[\\/]' }
            Reason = 'no web/ files touched'
        }
        @{
            Name = 'playwrightSpecHygieneAudit skill (delete stale legacy specs)'
            Kind = 'Skill'
            SkillPath = '.github/skills/playwrightspechygieneaudit/SKILL.md'
            When = { Test-PathTouched 'web[\\/]e2e[\\/]' -or Test-PathTouched 'web[\\/]src[\\/]' }
            Reason = 'no web/e2e/ or web/src/ files touched'
        }
        @{
            Name = 'Playwright vs dev (cd web; npx playwright test)'
            Kind = 'Shell'
            Command = '$env:E2E_BASE_URL = "https://scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io"; $env:E2E_TOKEN = "changeme-scim"; npx playwright test --reporter=line'
            WorkDir = 'web'
            When = { Test-PathTouched 'web[\\/]' }
            Reason = 'no web/ files touched'
        }
    )

    'Stage 6 - Commit Hygiene' = @(
        @{
            Name = 'Version bump in api + web (lockfiles regenerated in CI, never on a corp device)'
            Kind = 'Skill'
            SkillPath = '.github/skills/generatecommitmessage/SKILL.md'
            When = { Test-PathTouched 'package\.json$' }
            Reason = 'no package.json changes (no version bump expected)'
        }
        @{
            Name = 'CHANGELOG.md entry with explicit before/after test counts per layer'
            Kind = 'Skill'
            SkillPath = '.github/skills/auditandupdatedocs/SKILL.md'
        }
        @{
            Name = 'Session_starter.md + docs/CONTEXT_INSTRUCTIONS.md updates'
            Kind = 'Skill'
            SkillPath = '.github/skills/auditandupdatedocs/SKILL.md'
        }
        @{
            Name = 'generateCommitMessage skill (per-sub-phase gate naming)'
            Kind = 'Skill'
            SkillPath = '.github/skills/generatecommitmessage/SKILL.md'
        }
    )
}

# ---------------------------------------------------------------
# Execution + result capture.
# ---------------------------------------------------------------

$results = @()
$stageStartTimes = @{}

function Add-Result {
    param(
        [string]$Stage,
        [string]$GateName,
        [string]$Kind,
        [string]$Status,
        [string]$Note = '',
        [TimeSpan]$Duration = [TimeSpan]::Zero
    )
    $script:results += [pscustomobject]@{
        Stage = $Stage
        Gate = $GateName
        Kind = $Kind
        Status = $Status
        Note = $Note
        Duration = $Duration
    }
}

function Invoke-ShellGate {
    param([hashtable]$Gate, [string]$StageName)
    $work = if ($Gate.WorkDir) { Join-Path $repoRoot $Gate.WorkDir } else { $repoRoot }
    Write-Host ""
    Write-Host "  >>> $($Gate.Name)" -ForegroundColor Cyan
    Write-Host "      cwd: $work" -ForegroundColor DarkGray
    Write-Host "      cmd: $($Gate.Command)" -ForegroundColor DarkGray

    if ($DryRun) {
        Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Shell' -Status 'SKIPPED' -Note 'DryRun'
        return
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $work
    try {
        Invoke-Expression $Gate.Command
        $exit = $LASTEXITCODE
        $sw.Stop()
        if ($exit -eq 0 -or $null -eq $exit) {
            Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Shell' -Status 'PASS' -Duration $sw.Elapsed
            Write-Host "      PASS (exit 0, $($sw.Elapsed.TotalSeconds)s)" -ForegroundColor Green
        }
        else {
            Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Shell' -Status 'FAIL' -Note "exit $exit" -Duration $sw.Elapsed
            Write-Host "      FAIL (exit $exit, $($sw.Elapsed.TotalSeconds)s)" -ForegroundColor Red
        }
    }
    catch {
        $sw.Stop()
        Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Shell' -Status 'FAIL' -Note $_.Exception.Message -Duration $sw.Elapsed
        Write-Host "      FAIL (exception: $($_.Exception.Message))" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }
}

function Invoke-SkillGate {
    param([hashtable]$Gate, [string]$StageName)
    $skillPath = Join-Path $repoRoot $Gate.SkillPath
    $skillName = Split-Path -Leaf (Split-Path -Parent $Gate.SkillPath)
    Write-Host ""
    Write-Host "  >>> $($Gate.Name)" -ForegroundColor Magenta
    Write-Host "      skill: $($Gate.SkillPath)" -ForegroundColor DarkGray
    Write-Host "      invoke: /$skillName" -ForegroundColor DarkGray

    if (-not (Test-Path $skillPath)) {
        Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'FAIL' -Note "missing skill file $($Gate.SkillPath)"
        Write-Host "      FAIL - skill file missing" -ForegroundColor Red
        return
    }

    if ($SkipSkills) {
        Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'SKIPPED' -Note 'skipped by -SkipSkills'
        Write-Host "      SKIPPED (-SkipSkills)" -ForegroundColor Yellow
        return
    }

    if ($DryRun) {
        Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'SKIPPED' -Note 'DryRun'
        return
    }

    if ($NoSkillAcknowledgement) {
        # Unattended - surface the gap; do not block.
        Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'PARTIAL' -Note 'SKILL_NOT_ACKNOWLEDGED (-NoSkillAcknowledgement)'
        Write-Host "      PARTIAL (SKILL_NOT_ACKNOWLEDGED)" -ForegroundColor Yellow
        return
    }

    # Interactive: pause for ack.
    Write-Host "      Invoke this skill in Copilot Chat now, then enter result:" -ForegroundColor Yellow
    Write-Host "        p = PASS   f = FAIL   s = SKIPPED   n = note + PARTIAL" -ForegroundColor Yellow
    $resp = Read-Host -Prompt "      result"
    switch ($resp.ToLower()) {
        'p' { Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'PASS'; Write-Host "      PASS" -ForegroundColor Green }
        'f' {
            $note = Read-Host -Prompt "      finding (one-line)"
            Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'FAIL' -Note $note
            Write-Host "      FAIL" -ForegroundColor Red
        }
        's' {
            $note = Read-Host -Prompt "      skip reason"
            Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'SKIPPED' -Note $note
            Write-Host "      SKIPPED" -ForegroundColor Yellow
        }
        'n' {
            $note = Read-Host -Prompt "      partial-finding note"
            Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'PARTIAL' -Note $note
            Write-Host "      PARTIAL" -ForegroundColor Yellow
        }
        default {
            Add-Result -Stage $StageName -GateName $Gate.Name -Kind 'Skill' -Status 'PARTIAL' -Note "unrecognized response '$resp'"
            Write-Host "      PARTIAL (unrecognized response)" -ForegroundColor Yellow
        }
    }
}

function Invoke-Gate {
    param([hashtable]$Gate, [string]$StageName)
    # Auto-skip-no-op predicate.
    if ($Gate.When) {
        $applies = & $Gate.When
        if (-not $applies) {
            $reason = if ($Gate.Reason) { $Gate.Reason } else { 'no-op predicate returned false' }
            Add-Result -Stage $StageName -GateName $Gate.Name -Kind $Gate.Kind -Status 'SKIPPED' -Note "auto-skip: $reason"
            Write-Host ""
            Write-Host "  >>> $($Gate.Name)" -ForegroundColor DarkGray
            Write-Host "      SKIPPED (auto-no-op: $reason)" -ForegroundColor DarkGray
            return
        }
    }
    if ($Gate.Kind -eq 'Shell') {
        Invoke-ShellGate -Gate $Gate -StageName $StageName
    }
    else {
        Invoke-SkillGate -Gate $Gate -StageName $StageName
    }
}

# ---------------------------------------------------------------
# Stage-name -> filter mapping. -Stage <N> matches all sub-stages
# of N (so -Stage 3 walks 3a + 3b + 3c).
# ---------------------------------------------------------------

function Test-StageMatch {
    param([string]$StageName, [int]$Filter)
    if ($Filter -lt 0) { return $true }
    return $StageName -match "Stage $Filter[a-c]? -"
}

# ---------------------------------------------------------------
# Header + walk.
# ---------------------------------------------------------------

$startTimestamp = Get-Date
$header = @"

============================================================
  run-all-gates.ps1 - 7-stage Mandatory Quality Gates walker
  Stage X.1 D.1 closure
  See:
    docs/MANDATORY_QUALITY_GATES_STRATEGY.md
    .github/copilot-instructions.md (Mandatory Quality Gates)
  Run:        $(($startTimestamp).ToString('yyyy-MM-dd HH:mm:ss'))
  Changed files (current scope): $($script:changedFiles.Count)
  Mode:       SkipSkills=$SkipSkills  Stage=$Stage  DryRun=$DryRun  NoSkillAcknowledgement=$NoSkillAcknowledgement
============================================================
"@
Write-Host $header -ForegroundColor White

foreach ($stageName in $STAGES.Keys) {
    if (-not (Test-StageMatch -StageName $stageName -Filter $Stage)) { continue }
    Write-Host ""
    Write-Host "------------------------------------------------------------" -ForegroundColor White
    Write-Host "  $stageName" -ForegroundColor White
    Write-Host "------------------------------------------------------------" -ForegroundColor White
    foreach ($gate in $STAGES[$stageName]) {
        Invoke-Gate -Gate $gate -StageName $stageName
    }
}

# ---------------------------------------------------------------
# Summary + structured Markdown report.
# ---------------------------------------------------------------

$pass = ($results | Where-Object { $_.Status -eq 'PASS' }).Count
$fail = ($results | Where-Object { $_.Status -eq 'FAIL' }).Count
$skipped = ($results | Where-Object { $_.Status -eq 'SKIPPED' }).Count
$partial = ($results | Where-Object { $_.Status -eq 'PARTIAL' }).Count

Write-Host ""
Write-Host "============================================================" -ForegroundColor White
Write-Host "  Summary" -ForegroundColor White
Write-Host "    PASS:    $pass" -ForegroundColor Green
Write-Host "    FAIL:    $fail" -ForegroundColor Red
Write-Host "    SKIPPED: $skipped" -ForegroundColor Yellow
Write-Host "    PARTIAL: $partial" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor White

$reportFile = Join-Path $ReportDir ("run-all-gates-{0}.md" -f $startTimestamp.ToString('yyyy-MM-dd-HHmmss'))
$report = @()
$report += "# run-all-gates report - $($startTimestamp.ToString('yyyy-MM-dd HH:mm:ss'))"
$report += ""
$report += "**Mode:** SkipSkills=$SkipSkills | Stage=$Stage | DryRun=$DryRun | NoSkillAcknowledgement=$NoSkillAcknowledgement"
$report += "**Changed files in scope:** $($script:changedFiles.Count)"
$report += ""
$report += "## Summary"
$report += ""
$report += "| Status | Count |"
$report += "|---|---|"
$report += "| PASS | $pass |"
$report += "| FAIL | $fail |"
$report += "| SKIPPED | $skipped |"
$report += "| PARTIAL | $partial |"
$report += ""
$report += "## Per-stage results"
$report += ""

foreach ($stageName in ($results | Select-Object -ExpandProperty Stage -Unique)) {
    $report += "### $stageName"
    $report += ""
    $report += "| Gate | Kind | Status | Duration | Note |"
    $report += "|---|---|---|---|---|"
    foreach ($r in ($results | Where-Object { $_.Stage -eq $stageName })) {
        $dur = if ($r.Duration -gt [TimeSpan]::Zero) { "{0:N1}s" -f $r.Duration.TotalSeconds } else { '-' }
        $note = ($r.Note -replace '\|', '\|')
        $report += "| $($r.Gate) | $($r.Kind) | **$($r.Status)** | $dur | $note |"
    }
    $report += ""
}

$report | Set-Content -Path $reportFile -Encoding UTF8
Write-Host ""
Write-Host "  Report: $reportFile" -ForegroundColor White

# Exit codes.
if ($fail -gt 0) { exit 1 }
exit 0
