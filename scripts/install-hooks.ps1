<#
.SYNOPSIS
    One-shot installer for the versioned git hooks under .githooks/.

.DESCRIPTION
    Git does NOT auto-install hooks on `git clone`. The repository ships
    its mandatory hooks under .githooks/ (version-controlled). This script
    points the local clone at that directory by setting:

        git config core.hooksPath .githooks

    It also strips any stale hook in .git/hooks/ that would otherwise be
    silently shadowed by the same-named file in .githooks/.

    Run once per clone. Idempotent - safe to re-run.

    Hooks installed:
      pre-commit  - fast staged-file scan: em-dash ban, console.log ban,
                    hardcoded-secret regex. <5 s on a normal commit.
      pre-push    - mirrors CI validate gates: api build + lint + web tsc
                    + web prod build (Fast mode, ~2.5 min). Escalate per
                    push via:
                      $env:PREPUSH_MODE = 'Validate'  # +unit +e2e +vitest
                      $env:PREPUSH_MODE = 'Full'      # +docker +trivy

    Bypass (banned by standing rule, mechanism kept for emergencies):
      git commit --no-verify -m "..."
      git push   --no-verify

.PARAMETER Force
    Re-install even if core.hooksPath is already set to .githooks.

.EXAMPLE
    .\scripts\install-hooks.ps1
    Standard install (idempotent).

.EXAMPLE
    .\scripts\install-hooks.ps1 -Force
    Re-install + re-clean .git/hooks/ shadows.
#>

[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "=== SCIMServer git hooks installer ===" -ForegroundColor Cyan
Write-Host "Repo root: $repoRoot"
Write-Host ""

if (-not (Test-Path .githooks)) {
    Write-Host "FATAL: .githooks/ directory not found. Run from a fresh clone." -ForegroundColor Red
    exit 1
}

$hooks = Get-ChildItem .githooks -File | Where-Object { $_.Name -notmatch '\.(md|txt)$' }
Write-Host ("Hooks to install: {0}" -f ($hooks.Name -join ', '))
Write-Host ""

# Step 1: set core.hooksPath
$currentPath = git config --get core.hooksPath 2>$null
if ($currentPath -eq '.githooks' -and -not $Force) {
    Write-Host "core.hooksPath already set to .githooks - skipping (use -Force to reinstall)" -ForegroundColor Yellow
}
else {
    git config core.hooksPath .githooks
    Write-Host "Set: core.hooksPath = .githooks" -ForegroundColor Green
}

# Step 2: clean any stale hooks in .git/hooks/ that would shadow ours
$shadowed = @()
foreach ($h in $hooks) {
    $stale = Join-Path '.git/hooks' $h.Name
    if (Test-Path $stale) {
        $shadowed += $h.Name
        Remove-Item $stale -Force
    }
}
if ($shadowed.Count -gt 0) {
    Write-Host ("Removed stale hooks in .git/hooks/: {0}" -f ($shadowed -join ', ')) -ForegroundColor Yellow
}
else {
    Write-Host "No stale hooks to clean." -ForegroundColor Green
}

# Step 3: verify executable bit on POSIX systems (no-op on Windows NTFS)
if ($IsLinux -or $IsMacOS) {
    foreach ($h in $hooks) {
        chmod +x $h.FullName 2>$null
    }
    Write-Host "Marked hooks executable (chmod +x)" -ForegroundColor Green
}

# Step 4: sanity-check prerequisites
Write-Host ""
Write-Host "=== Prerequisite check ===" -ForegroundColor Cyan
$pwshOk = (Get-Command pwsh -ErrorAction SilentlyContinue) -ne $null
$nodeOk = (Get-Command node -ErrorAction SilentlyContinue) -ne $null
$npxOk  = (Get-Command npx  -ErrorAction SilentlyContinue) -ne $null

Write-Host ("  pwsh : {0}" -f $(if ($pwshOk) {'OK'} else {'MISSING (pre-push hook needs PowerShell 7+)'})) -ForegroundColor $(if ($pwshOk) {'Green'} else {'Red'})
Write-Host ("  node : {0}" -f $(if ($nodeOk) {'OK'} else {'MISSING (pre-push hook needs Node 24+)'}))  -ForegroundColor $(if ($nodeOk) {'Green'} else {'Red'})
Write-Host ("  npx  : {0}" -f $(if ($npxOk)  {'OK'} else {'MISSING (pre-push hook needs npx)'}))       -ForegroundColor $(if ($npxOk)  {'Green'} else {'Red'})

if (-not ($pwshOk -and $nodeOk -and $npxOk)) {
    Write-Host ""
    Write-Host "WARNING: pre-push gates will fail until missing tools are installed." -ForegroundColor Yellow
}

# Step 5: report
Write-Host ""
Write-Host "=== Installed ===" -ForegroundColor Cyan
$activePath = git config --get core.hooksPath
Write-Host ("Active hooksPath: {0}" -f $activePath)
Get-ChildItem .githooks -File | Format-Table Name, Length, LastWriteTime -AutoSize

Write-Host "Done. Hooks are active for this clone." -ForegroundColor Green
Write-Host ""
Write-Host "Usage cheatsheet:" -ForegroundColor Cyan
Write-Host "  git commit -m '...'                              # pre-commit fires (<5s)"
Write-Host "  git push origin feat/ui                          # pre-push Fast fires (~2.5 min)"
Write-Host "  `$env:PREPUSH_MODE='Validate'; git push ...        # mirror CI validate (~8-12 min)"
Write-Host "  `$env:PREPUSH_MODE='Full';     git push ...        # + docker + trivy (~15-20 min)"
