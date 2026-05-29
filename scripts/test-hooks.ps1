<#
.SYNOPSIS
    Self-test for .githooks/pre-commit. Asserts the hook is purely read-only
    with respect to the git index (does not stage, unstage, or rewrite files).

.DESCRIPTION
    Origin: docs/HOOKS_FALSE_ALARM_RCA_2026-05-19.md - converts the manual
    diagnosis ("the hook source contains no git add / git reset") into a
    checked fact that runs on demand.

    Three assertions:
      1. CLEAN  - staging a sandbox file with benign content, the hook exits 0
                  and the index snapshot is byte-identical before vs after.
      2. DIRTY  - staging a sandbox file containing U+2014 (em-dash), the hook
                  exits 1 and the index snapshot is still byte-identical before
                  vs after. The hook reports the violation; it must NOT mutate
                  the index to "fix" it.
      3. UNSTAGED - with a sandbox file modified but not staged, the hook
                  exits 0 and leaves the unstaged file untouched.

    Cleans up its sandbox files regardless of pass / fail.

    Bypass alternative: NONE. This script is the cheap fast-fail. Run it any
    time you suspect a hook is mutating the index.

.EXAMPLE
    pwsh scripts/test-hooks.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$hook = Join-Path $repoRoot '.githooks/pre-commit'
if (-not (Test-Path $hook)) {
    Write-Host "FATAL: $hook not found" -ForegroundColor Red
    exit 1
}

$sandboxDir = Join-Path $repoRoot '.test-hooks-sandbox'
# Sandbox files use .md because the hook's em-dash scan is intentionally
# scoped to source / config / prose extensions (.md/.ts/.json/.ps1/...).
# A .txt file would be silently skipped by the hook, defeating Test 2.
$cleanFile  = Join-Path $sandboxDir 'clean.md'
$dirtyFile  = Join-Path $sandboxDir 'dirty.md'
$emdash     = [char]0x2014

$failures = 0
$passes   = 0

function Get-IndexSnapshot {
    # git diff --cached --raw is stable across invocations and includes mode +
    # SHA + path - any staging-mutation would change at least one field.
    (git diff --cached --raw) -join "`n"
}

function Invoke-Hook {
    # Find a POSIX shell. sh is shipped with Git-for-Windows under usr/bin/.
    $sh = (Get-Command sh -ErrorAction SilentlyContinue)
    $gitUsrBin = $null
    if (-not $sh) {
        $gitDir = Split-Path -Parent (Get-Command git).Path
        $candidate = Join-Path $gitDir '..\usr\bin\sh.exe'
        if (Test-Path $candidate) {
            $sh = $candidate
            $gitUsrBin = (Resolve-Path (Join-Path $gitDir '..\usr\bin')).Path
        } else {
            throw "sh.exe not found (need Git for Windows or WSL on PATH)"
        }
    } else {
        # Even if sh.exe is on PATH, grep / sed may not be. Auto-prepend the
        # bundled MSYS2 usr/bin so the hook's defensive check passes when
        # invoked from this test (the real git-commit path already provides
        # this PATH).
        $gitDir = Split-Path -Parent (Get-Command git).Path
        $candidate = Join-Path $gitDir '..\usr\bin'
        if (Test-Path $candidate) {
            $gitUsrBin = (Resolve-Path $candidate).Path
        }
    }
    $shPath = if ($sh -is [System.Management.Automation.CommandInfo]) { $sh.Path } else { $sh }
    $savedPath = $env:PATH
    try {
        if ($gitUsrBin) { $env:PATH = "$gitUsrBin;$env:PATH" }
        & $shPath $hook 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $env:PATH = $savedPath
    }
}

function Cleanup {
    if (Test-Path $sandboxDir) {
        # Unstage anything still pointing at the sandbox, then remove.
        git reset HEAD -- $sandboxDir 2>$null | Out-Null
        Remove-Item $sandboxDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Assert-Eq([string]$label, $expected, $actual) {
    if ($expected -ceq $actual) {
        Write-Host "  PASS  $label" -ForegroundColor Green
        $script:passes++
    } else {
        Write-Host "  FAIL  $label" -ForegroundColor Red
        Write-Host "        expected: $expected" -ForegroundColor DarkRed
        Write-Host "        actual  : $actual"   -ForegroundColor DarkRed
        $script:failures++
    }
}

try {
    # The sandbox path is intentionally outside any tracked tree. If the hook
    # somehow `git add -A`-s, it would be captured by this snapshot.
    Cleanup
    New-Item -ItemType Directory -Path $sandboxDir | Out-Null

    # ---------------------------------------------------------------------
    # Test 1: CLEAN content, staged. Hook should exit 0; index unchanged.
    # ---------------------------------------------------------------------
    Write-Host "Test 1: clean content, staged" -ForegroundColor Cyan
    Set-Content -Path $cleanFile -Value 'No em dash here. No console.log. No secrets.' -NoNewline
    git add -- $cleanFile | Out-Null

    $snapBefore = Get-IndexSnapshot
    $exit       = Invoke-Hook
    $snapAfter  = Get-IndexSnapshot

    Assert-Eq 'exit code is 0'         0          $exit
    Assert-Eq 'index snapshot unchanged' $snapBefore $snapAfter

    git reset HEAD -- $cleanFile 2>$null | Out-Null

    # ---------------------------------------------------------------------
    # Test 2: DIRTY content (em-dash), staged. Hook should exit 1; index
    #         unchanged. The hook must REPORT, not REWRITE.
    # ---------------------------------------------------------------------
    Write-Host "Test 2: dirty content (em-dash), staged" -ForegroundColor Cyan
    Set-Content -Path $dirtyFile -Value ("This line has an em" + $emdash + "dash.") -NoNewline
    git add -- $dirtyFile | Out-Null

    $snapBefore = Get-IndexSnapshot
    $exit       = Invoke-Hook
    $snapAfter  = Get-IndexSnapshot

    Assert-Eq 'exit code is 1'           1          $exit
    Assert-Eq 'index snapshot unchanged' $snapBefore $snapAfter

    git reset HEAD -- $dirtyFile 2>$null | Out-Null

    # ---------------------------------------------------------------------
    # Test 3: UNSTAGED change. Hook should exit 0 and not touch the file.
    # ---------------------------------------------------------------------
    Write-Host "Test 3: unstaged sandbox file" -ForegroundColor Cyan
    # cleanFile already exists on disk (we never deleted it; just unstaged it).
    # Now it is untracked + unstaged. The pre-commit hook reads ONLY the
    # cached / staged set, so an untracked file must be invisible.
    $contentBefore = Get-Content $cleanFile -Raw
    $snapBefore    = Get-IndexSnapshot
    $exit          = Invoke-Hook
    $snapAfter     = Get-IndexSnapshot
    $contentAfter  = Get-Content $cleanFile -Raw

    Assert-Eq 'exit code is 0'             0              $exit
    Assert-Eq 'index snapshot unchanged'   $snapBefore    $snapAfter
    Assert-Eq 'untracked file untouched'   $contentBefore $contentAfter
}
finally {
    Cleanup
}

Write-Host ""
Write-Host ("Results: {0} pass / {1} fail" -f $passes, $failures) -ForegroundColor $(if ($failures -eq 0) {'Green'} else {'Red'})
exit $(if ($failures -eq 0) { 0 } else { 1 })
