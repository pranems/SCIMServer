$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$helperPath = Join-Path $repoRoot 'scripts/github-workflow-run.ps1'
$pipelinePath = Join-Path $repoRoot 'scripts/dev-deployment-pipeline.ps1'
$prePushPath = Join-Path $repoRoot 'scripts/pre-push-checks.ps1'
if (-not (Test-Path $helperPath)) {
    throw "Missing workflow-run selector: $helperPath"
}

. $helperPath

$ansiJson = "`e[?25l`n[{`"databaseId`":35041241622,`"headSha`":`"43386dbedacc4364cc78d06a20ac0039dd6ac7dc`",`"createdAt`":`"2026-09-16T00:44:20Z`"}]`e[?25h"
$parsedAnsiJson = @(ConvertFrom-GithubCliJson -InputObject $ansiJson)
if ($parsedAnsiJson.Count -ne 1 -or $parsedAnsiJson[0].databaseId -ne 35041241622) {
    throw 'ANSI-prefixed GitHub CLI JSON must parse to the original run object.'
}

$expectedSha = '43386dbedacc4364cc78d06a20ac0039dd6ac7dc'
$dispatchTime = [DateTimeOffset]'2026-09-16T00:44:15Z'
$runs = @(
    [pscustomobject]@{
        databaseId = 33923234848
        headSha = '81883690048bd12d22bbadd01bec95850f3b5aaf'
        createdAt = '2026-08-29T00:00:00Z'
        status = 'completed'
    },
    [pscustomobject]@{
        databaseId = 35041241622
        headSha = $expectedSha
        createdAt = '2026-09-16T00:44:20Z'
        status = 'in_progress'
    }
)

$selected = Select-GithubWorkflowRun -Runs $runs -ExpectedHeadSha $expectedSha -DispatchedAfter $dispatchTime
if ($selected.databaseId -ne 35041241622) {
    throw "Expected exact-SHA run 35041241622, got $($selected.databaseId)"
}

$staleSameSha = @(
    [pscustomobject]@{
        databaseId = 111
        headSha = $expectedSha
        createdAt = '2026-09-15T20:00:00Z'
        status = 'completed'
    }
)

$none = Select-GithubWorkflowRun -Runs $staleSameSha -ExpectedHeadSha $expectedSha -DispatchedAfter $dispatchTime
if ($null -ne $none) {
    throw 'A pre-dispatch run with the same SHA must not be selected.'
}

$pipeline = Get-Content $pipelinePath -Raw
foreach ($required in @(
    'github-workflow-run.ps1',
    'Select-GithubWorkflowRun',
    '-ExpectedHeadSha',
    'Version/latest image mismatch'
)) {
    if (-not $pipeline.Contains($required)) {
        throw "Deployment pipeline is missing required workflow-run guard: $required"
    }
}
if ($pipeline.Contains("--limit 1 --json databaseId --jq '.[0].databaseId'")) {
    throw 'Deployment pipeline still selects the newest run without matching the expected SHA.'
}

$prePush = Get-Content $prePushPath -Raw
if (-not $prePush.Contains('select-github-workflow-run.contract.ps1')) {
    throw 'The default pre-push gate does not execute the workflow-run selector contract.'
}

Write-Output 'select-github-workflow-run contract: 10/10 passed'
