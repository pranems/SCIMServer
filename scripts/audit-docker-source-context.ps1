<#
.SYNOPSIS
    Fails when a production source directory is shadowed by a broad
    .dockerignore artifact-directory rule without explicit exceptions.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$dockerIgnorePath = Join-Path $repoRoot '.dockerignore'
$rules = @(Get-Content -LiteralPath $dockerIgnorePath | ForEach-Object { $_.Trim() } | Where-Object {
    $_ -and -not $_.StartsWith('#')
})
$ruleSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($rule in $rules) {
    $null = $ruleSet.Add($rule.Replace('\', '/'))
}

$broadDirectoryNames = @($rules | ForEach-Object {
    if ($_ -match '^\*\*/(?<name>[^/*?]+)/*$') {
        $Matches.name
    }
} | Sort-Object -Unique)

$violations = [System.Collections.Generic.List[string]]::new()
foreach ($sourceRootRelative in @('api/src', 'web/src')) {
    $sourceRoot = Join-Path $repoRoot $sourceRootRelative
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
        continue
    }

    foreach ($directory in Get-ChildItem -LiteralPath $sourceRoot -Recurse -Directory) {
        if ($directory.Name -notin $broadDirectoryNames) {
            continue
        }
        if (-not (Get-ChildItem -LiteralPath $directory.FullName -Recurse -File | Select-Object -First 1)) {
            continue
        }

        $relative = [IO.Path]::GetRelativePath($repoRoot, $directory.FullName).Replace('\', '/')
        foreach ($requiredException in @("!$relative", "!$relative/**")) {
            if (-not $ruleSet.Contains($requiredException)) {
                $violations.Add("$relative is shadowed by **/$($directory.Name); missing '$requiredException'")
            }
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Error ("Docker source-context audit failed:`n  " + ($violations -join "`n  "))
    exit 1
}

Write-Host 'Docker source-context audit passed.' -ForegroundColor Green
exit 0