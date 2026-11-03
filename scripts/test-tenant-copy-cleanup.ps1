[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'rotate-tenant-data.ps1') -Raw
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$start = $ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $_.Left.Extent.Text -eq '$jobCreated'
} | Select-Object -First 1
if (-not $start) { throw 'Copy lifecycle entry point is missing.' }
$lifecycle = [scriptblock]::Create("[CmdletBinding()]`nparam()`n" + $source.Substring($start.Extent.StartOffset))

function Test-Lifecycle {
    param([bool]$FailTransfer, [bool]$FailResume, [bool]$FailCleanup, [string]$Expected)
    $script:failTransfer = $FailTransfer
    $script:failResume = $FailResume
    $script:failCleanup = $FailCleanup
    $script:resumeCalls = 0
    $script:cleanupCalls = 0
    $yamlDirectory = Join-Path ([IO.Path]::GetTempPath()) ('scim-copy-cleanup-' + [guid]::NewGuid().ToString('N'))
    $yamlPath = Join-Path $yamlDirectory 'job.yaml'
    $yaml = 'synthetic fixture; no credentials'
    $DryRun = $false
    $KeepJob = $false
    $TargetAppName = 'fixture-app'
    $TargetAppResourceGroup = 'fixture-rg'
    $TargetResourceGroup = 'fixture-rg'
    $Subscription = 'fixture-sub'
    $JobName = 'fixture-job'
    $runId = 'fixture-run'
    function Say {}
    function Initialize-CopyPrivateDirectory { param($Path) $null = New-Item -ItemType Directory -Path $Path }
    function Get-CopyTargetRevisionState { [pscustomobject]@{ ActiveRevisions = @('fixture-revision') } }
    function Suspend-CopyTargetWriters {}
    function Resume-CopyTargetWriters {
        $script:resumeCalls++
        if ($script:failResume) { throw 'fixture resume failure' }
    }
    function Invoke-CopyAzAction {
        if ($script:failTransfer) { throw 'fixture primary transfer failure' }
    }
    function Invoke-CopyAzJson { [pscustomobject]@{ name = 'fixture-execution'; properties = @{ status = 'Succeeded' } } }
    function az { $global:LASTEXITCODE = 0 }
    function Remove-OwnedCopyJob {
        $script:cleanupCalls++
        if ($script:failCleanup) { throw 'fixture job cleanup failure' }
    }
    $observed = $null
    $warnings = @()
    try {
        try { & $lifecycle -WarningVariable warnings 6>$null }
        catch { $observed = $_ }
        if ($Expected) {
            if (-not $observed -or $observed.Exception.Message -cne $Expected) {
                throw "RED: expected primary '$Expected'; received '$($observed.Exception.Message)'."
            }
        } elseif ($observed) { throw $observed }
        if ($script:resumeCalls -ne [int](-not $FailTransfer)) { throw 'Failed transfer reactivated target writers.' }
        if ($script:cleanupCalls -ne 1) { throw 'Owned job cleanup did not run exactly once.' }
        if ((Test-Path -LiteralPath $yamlPath) -or (Test-Path -LiteralPath $yamlDirectory)) {
            throw 'Named secret scratch cleanup was skipped after an earlier failure.'
        }
        if ($FailCleanup -and ($FailTransfer -or $FailResume) -and
            ($warnings -join "`n") -notmatch 'fixture job cleanup failure') {
            throw 'Secondary cleanup failure was not reported explicitly.'
        }
        Write-Host "PASS: transfer=$FailTransfer resume=$FailResume cleanup=$FailCleanup retains the correct error and completes named cleanup"
    } finally {
        if (Test-Path -LiteralPath $yamlPath) { Remove-Item -LiteralPath $yamlPath }
        if (Test-Path -LiteralPath $yamlDirectory) { Remove-Item -LiteralPath $yamlDirectory }
    }
}

Test-Lifecycle -FailTransfer $false -FailResume $false -FailCleanup $false
Test-Lifecycle -FailTransfer $true -FailResume $false -FailCleanup $false -Expected 'fixture primary transfer failure'
Test-Lifecycle -FailTransfer $true -FailResume $false -FailCleanup $true -Expected 'fixture primary transfer failure'
Test-Lifecycle -FailTransfer $false -FailResume $true -FailCleanup $true -Expected 'fixture resume failure'
Test-Lifecycle -FailTransfer $false -FailResume $false -FailCleanup $true -Expected 'fixture job cleanup failure'
