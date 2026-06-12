<#
.SYNOPSIS
    Audits docs/screenshots/ hygiene and (optionally) UI_GUIDE.md route coverage.

.DESCRIPTION
    Implements the audit gate referenced by the "Scratch Image Handling" and
    "UI Guide Refresh Process" rules in .github/copilot-instructions.md.

    Core check (always runs): every TRACKED PNG under docs/screenshots/ MUST be
      (a) named prod-*  AND
      (b) referenced by at least one live .md file.
    Any tracked PNG that fails either condition is an orphan and FAILS the gate.
    This is the structural enforcement of the deny-by-default .gitignore allowlist.

    Route-coverage check (-CheckRouteCoverage): every top-level route under
    web/src/routes/ MUST be either referenced by docs/UI_GUIDE.md or listed in
    the $intentionallyUndocumented allowlist below. Mirrors the "every new lazy
    route needs a size-limit entry" discipline.

.PARAMETER CheckRouteCoverage
    Also verify UI_GUIDE.md covers every top-level route.

.EXAMPLE
    pwsh scripts/audit-screenshots.ps1

.EXAMPLE
    pwsh scripts/audit-screenshots.ps1 -CheckRouteCoverage
#>
[CmdletBinding()]
param(
    [switch]$CheckRouteCoverage
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $failures = @()

    # ---- Core check: no orphaned / mis-named tracked screenshots ----
    Write-Host "=== screenshot orphan audit ===" -ForegroundColor Cyan
    $tracked = @(git ls-files 'docs/screenshots/*.png')
    if ($tracked.Count -eq 0) {
        Write-Host "No tracked PNGs under docs/screenshots/."
    }

    # Gather all live-doc text once for reference scanning.
    $docFiles = Get-ChildItem -Recurse -File -Filter '*.md' |
        Where-Object { $_.FullName -notmatch '\\node_modules\\' }
    $docText = ($docFiles | ForEach-Object { Get-Content -Raw $_.FullName }) -join "`n"

    foreach ($png in $tracked) {
        $name = Split-Path $png -Leaf
        if ($name -notlike 'prod-*') {
            $failures += "NON-PROD tracked screenshot: $png (only prod-* may be committed)"
            continue
        }
        # Referenced if the filename appears in any live .md (path or basename).
        if ($docText -notmatch [regex]::Escape($name)) {
            $failures += "ORPHAN: $png is tracked but referenced by no live .md"
        }
        else {
            Write-Host "OK  $name"
        }
    }

    # ---- Optional: UI_GUIDE.md route coverage ----
    if ($CheckRouteCoverage) {
        Write-Host "`n=== UI_GUIDE.md route coverage ===" -ForegroundColor Cyan
        $uiGuide = Join-Path $repoRoot 'docs/UI_GUIDE.md'
        if (-not (Test-Path $uiGuide)) {
            $failures += "docs/UI_GUIDE.md not found (route-coverage check)"
        }
        else {
            $guideText = Get-Content -Raw $uiGuide

            # Routes intentionally NOT documented in UI_GUIDE.md (with reason).
            $intentionallyUndocumented = @{
                '/'                 = 'covered as Dashboard + Token gate'
            }

            # Top-level routes = web/src/routes/<name>.tsx with no extra dot
            # segment (excludes nested endpoints.$endpointId.* and *.test.ts).
            $routeFiles = Get-ChildItem 'web/src/routes' -Filter '*.tsx' |
                Where-Object { $_.Name -notmatch '\.test\.' }
            foreach ($rf in $routeFiles) {
                $base = $rf.BaseName  # e.g. 'index', 'endpoints', 'endpoints.$endpointId.users'
                if ($base -match '\.') { continue }  # skip nested routes
                if ($base -like '__*') { continue }  # skip framework layout routes (__root etc.)
                $route = if ($base -eq 'index') { '/' } else { "/$base" }
                if ($intentionallyUndocumented.ContainsKey($route)) {
                    Write-Host "SKIP $route (intentionally undocumented: $($intentionallyUndocumented[$route]))"
                    continue
                }
                if ($guideText -match [regex]::Escape($route)) {
                    Write-Host "OK   $route"
                }
                else {
                    $failures += "ROUTE NOT IN UI_GUIDE: $route (web/src/routes/$($rf.Name)) - document it or add to the allowlist"
                }
            }
        }
    }

    Write-Host ""
    if ($failures.Count -gt 0) {
        Write-Host "AUDIT FAILED ($($failures.Count)):" -ForegroundColor Red
        $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        exit 1
    }
    Write-Host "AUDIT PASSED" -ForegroundColor Green
}
finally {
    Pop-Location
}
