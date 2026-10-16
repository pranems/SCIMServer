$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$guard = Join-Path $repoRoot 'scripts' 'assert-dependency-ownership.ps1'
$failures = [System.Collections.Generic.List[string]]::new()
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('scim-dependency-ownership-' + [guid]::NewGuid().ToString('N'))
$links = [System.Collections.Generic.List[string]]::new()
$savedPath = $env:PATH
$savedMarker = $env:OWNERSHIP_FORBIDDEN_MARKER
$pwsh = (Get-Command pwsh).Source

function Assert-Contract([string]$Description, [bool]$Condition) {
    if ($Condition) { Write-Host "PASS: $Description" }
    else { Write-Host "FAIL: $Description"; $failures.Add($Description) }
}

function Test-Ownership([string]$Root, [bool]$ExpectedAccepted, [string]$Description) {
    $accepted = $false
    $diagnostic = ''
    try {
        $diagnostic = (& $guard -RepositoryRoot $Root 6>&1 | Out-String)
        $accepted = $true
    } catch {
        $diagnostic = $_.Exception.Message
    }
    Assert-Contract $Description ($accepted -eq $ExpectedAccepted -and ($ExpectedAccepted -or $diagnostic -match 'Dependency ownership'))
    return $diagnostic
}

function New-PhysicalFixture([string]$Name) {
    $root = Join-Path $temporaryRoot $Name
    foreach ($relative in @('node_modules', 'api', 'web')) {
        $null = New-Item -ItemType Directory -Path (Join-Path $root $relative) -Force
    }
    foreach ($project in @('api', 'web')) {
        $null = New-Item -ItemType Directory -Path (Join-Path $root $project 'node_modules')
    }
    return $root
}

try {
    $physical = New-PhysicalFixture 'physical'
    $null = Test-Ownership $physical $true 'physical root/API/web dependency directories are accepted'
    $missing = Join-Path $temporaryRoot 'missing'
    $null = New-Item -ItemType Directory -Path $missing
    $missingOutput = Test-Ownership $missing $true 'absent dependencies are not installed or fabricated by the ownership guard'
    Assert-Contract 'absent dependencies are explicitly reported, not claimed as physically verified' ($missingOutput -match 'ABSENT')
    $null = Test-Ownership (Join-Path $temporaryRoot 'nonexistent-root') $false 'a nonexistent repository root is refused rather than reporting successful absence'

    $foreign = New-PhysicalFixture 'foreign'
    foreach ($relative in @('node_modules', (Join-Path 'api' 'node_modules'), (Join-Path 'web' 'node_modules'), 'api', 'web')) {
        $fixture = New-PhysicalFixture ('linked-' + [guid]::NewGuid().ToString('N'))
        $link = Join-Path $fixture $relative
        Remove-Item -LiteralPath $link -Recurse -Force
        $target = if ($relative -in @('api', 'web')) { Join-Path $foreign $relative } else { Join-Path $foreign 'node_modules' }
        $targetMarker = Join-Path $target 'ownership-marker.txt'
        Set-Content -LiteralPath $targetMarker -Value 'foreign content must remain unchanged'
        $kind = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
        $null = New-Item -ItemType $kind -Path $link -Target $target
        $links.Add($link)
        $null = Test-Ownership $fixture $false "linked $relative is refused before dependency mutation"
        Assert-Contract "linked $relative target content is not removed or rewritten" (
            (Test-Path -LiteralPath $targetMarker) -and
            (Get-Content -LiteralPath $targetMarker -Raw).Trim() -eq 'foreign content must remain unchanged'
        )
    }

    $invalid = New-PhysicalFixture 'file-instead-of-directory'
    $invalidModules = Join-Path $invalid 'node_modules'
    Remove-Item -LiteralPath $invalidModules -Force
    Set-Content -LiteralPath $invalidModules -Value 'not a directory'
    $null = Test-Ownership $invalid $false 'a dependency path that is a file is refused'

    $dangling = New-PhysicalFixture 'dangling-link'
    $danglingTarget = Join-Path $temporaryRoot 'dangling-target'
    $null = New-Item -ItemType Directory -Path $danglingTarget
    $danglingLink = Join-Path $dangling 'node_modules'
    Remove-Item -LiteralPath $danglingLink -Force
    $kind = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
    $null = New-Item -ItemType $kind -Path $danglingLink -Target $danglingTarget
    $links.Add($danglingLink)
    Remove-Item -LiteralPath $danglingTarget -Force
    $null = Test-Ownership $dangling $false 'a dangling dependency link is refused rather than treated as missing dependencies'

    $bin = Join-Path $temporaryRoot 'bin'
    $null = New-Item -ItemType Directory -Path $bin
    $env:OWNERSHIP_FORBIDDEN_MARKER = Join-Path $temporaryRoot 'forbidden-command.txt'
    foreach ($command in @('npm', 'npx', 'node', 'docker', 'az', 'git')) {
        if ($IsWindows) {
            @('@echo off', 'echo attempted>"%OWNERSHIP_FORBIDDEN_MARKER%"', 'exit /b 77') |
                Set-Content -LiteralPath (Join-Path $bin "$command.cmd") -Encoding ascii
        } else {
            $shim = Join-Path $bin $command
            @('#!/bin/sh', 'printf "%s\n" attempted > "$OWNERSHIP_FORBIDDEN_MARKER"', 'exit 77') |
                Set-Content -LiteralPath $shim -Encoding ascii
            & chmod +x $shim
            if ($LASTEXITCODE -ne 0) { throw 'Could not prepare isolated command shim.' }
        }
    }
    $env:PATH = $bin + [IO.Path]::PathSeparator + $savedPath
    foreach ($runner in @('pre-push-checks.ps1', 'test-all-modes.ps1', 'dev-deployment-pipeline.ps1', 'full-validation-pipeline.ps1', 'run-all-gates.ps1')) {
        $file = Join-Path $repoRoot 'scripts' $runner
        $errors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$errors)
        $commands = @($ast.FindAll({
            param($node)
            $node -is [Management.Automation.Language.CommandAst] -and
            $node.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Ampersand -and
            $node.Extent.Text -match "'assert-dependency-ownership\.ps1'"
        }, $true))
        $source = Get-Content -LiteralPath $file -Raw
        $firstMutationBoundary = if ($runner -eq 'full-validation-pipeline.ps1') { $source.IndexOf('$apiDir =') }
            elseif ($runner -in @('dev-deployment-pipeline.ps1', 'run-all-gates.ps1')) { $source.IndexOf('if ([string]::IsNullOrWhiteSpace($ReportDir))') }
            else { $source.IndexOf('$results =') }
        $wired = (
            $errors.Count -eq 0 -and $commands.Count -eq 1 -and
            $commands[0].Extent.StartOffset -lt $firstMutationBoundary
        )
        Assert-Contract "$runner parses and checks ownership before runner work" $wired
        if ($wired -and (Test-Path -LiteralPath $guard)) {
            $fixture = New-PhysicalFixture ('runner-' + [guid]::NewGuid().ToString('N'))
            $link = Join-Path $fixture 'node_modules'
            Remove-Item -LiteralPath $link -Force
            $kind = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
            $null = New-Item -ItemType $kind -Path $link -Target (Join-Path $foreign 'node_modules')
            $links.Add($link)
            $scripts = Join-Path $fixture 'scripts'
            $null = New-Item -ItemType Directory -Path $scripts
            Copy-Item -LiteralPath $file, $guard -Destination $scripts
            $output = (& $pwsh -NoProfile -File (Join-Path $scripts $runner) 2>&1 | Out-String)
            $code = $LASTEXITCODE
            Assert-Contract "$runner exits nonzero with the ownership diagnostic on linked dependencies" (
                $code -ne 0 -and $output -match 'Dependency ownership.*linked directory'
            )
            Assert-Contract "$runner starts no npm/node/Docker/Azure/Git command before refusal" (
                -not (Test-Path -LiteralPath $env:OWNERSHIP_FORBIDDEN_MARKER)
            )
        }
    }
} finally {
    $env:PATH = $savedPath
    $env:OWNERSHIP_FORBIDDEN_MARKER = $savedMarker
    foreach ($link in $links) {
        if (Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue) { Remove-Item -LiteralPath $link -Force }
    }
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

if ($failures.Count) { throw "$($failures.Count) dependency ownership contract assertions failed." }
Write-Host 'All dependency ownership contract assertions passed.'
exit 0
