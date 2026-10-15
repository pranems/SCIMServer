$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$errors = @()
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $repoRoot 'scripts\pre-push-checks.ps1'), [ref]$null, [ref]$errors
)
if ($errors.Count) { throw "Pre-push script does not parse: $errors" }
$functions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in @('Invoke-Gate', 'Show-Summary')
}, $true)
$gate = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-Gate' -and
        @($node.CommandElements | Where-Object {
            $_ -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
            $_.Value -eq 'docs: mermaid diagrams render'
        }).Count -eq 1
}, $true)
if ($functions.Count -ne 2 -or $gate.Count -ne 1) { throw 'Required gate or runner is missing/ambiguous.' }
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('mermaid-push-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $scratch
$failures = 0
try {
    foreach ($case in @(
        @{ Name = 'missing tooling'; HasMermaid = $false; NodeExit = 23; Expected = 1 },
        @{ Name = 'renderer failure'; HasMermaid = $true; NodeExit = 23; Expected = 1 },
        @{ Name = 'successful render'; HasMermaid = $true; NodeExit = 0; Expected = 0 }
    )) {
        $caseRoot = Join-Path $scratch ($case.Name -replace ' ', '-')
        $null = New-Item -ItemType Directory -Path $caseRoot
        if ($case.HasMermaid) {
            $null = New-Item -ItemType Directory -Path (Join-Path $caseRoot 'node_modules\mermaid') -Force
        }
        # Execute the real runner and registered action; stub only the external renderer.
        $runner = @'
param($Root, $NodeExit)
$repoRoot = $Root
$Mode = 'Fast'
$FailFast = $true
$overallStart = Get-Date
$results = [System.Collections.Generic.List[object]]::new()
function node { Write-Host 'RENDER_INVOKED'; $global:LASTEXITCODE = [int]$NodeExit }
'@
        $runner += "`n" + (($functions | ForEach-Object { $_.Extent.Text }) -join "`n")
        $runner += "`n" + $gate[0].Extent.Text + "`nShow-Summary`n"
        $runner += 'if (@($results | Where-Object Status -eq FAIL).Count) { exit 1 }; exit 0'
        $path = Join-Path $caseRoot 'runner.ps1'
        Set-Content -LiteralPath $path -Value $runner
        $output = & pwsh -NoProfile -File $path -Root $caseRoot -NodeExit $case.NodeExit 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        $expectedStatus = if ($case.Expected -eq 0) { 'PASS' } else { 'FAIL' }
        if ($exitCode -eq $case.Expected -and
            $output -match "docs: mermaid diagrams render\s+$expectedStatus" -and
            $output -match 'RENDER_INVOKED' -and
            ($case.Expected -eq 0 -or $output -notmatch 'All gates GREEN')) {
            Write-Host "PASS: $($case.Name) exits $exitCode with $expectedStatus summary"
        } else {
            $failures++
            Write-Host "FAIL: $($case.Name) expected exit $($case.Expected), got $exitCode`n$output"
        }
    }
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force
}
if ($failures) { exit 1 }
exit 0
