<#
.SYNOPSIS
    R5 static gate: flag web tables that can horizontally blow out.

.DESCRIPTION
    Origin: 2026-07-08 Operations "no table" miss. The All-users table used
    `table-layout: auto` with an untruncated name cell, so a long userName
    ballooned column 1 to 67% of the table and pushed the other columns
    off-screen. A green Playwright suite missed it because the spec only
    asserted testid presence, not rendered column bounds (see R10 +
    R5.1/R5.2/R5.3 in .github/copilot-instructions.md).

    This gate greps every web/src/**/*.tsx that renders a `<table>` and
    reports its `table-layout` posture so the "auto + truncating cell"
    combination cannot silently ship again. It is intentionally simple
    (regex, no TS parse) so it can run in Stage 1 with zero deps.

    Exit codes:
      0 - no NEW offenders (all `<table>` files are either table-layout:fixed
          OR are on the known-lower-severity R5.3 allowlist)
      1 - a NEW offender: a file renders a <table> + imports a truncation
          primitive (CopyableField/TruncatedText) + has NO tableLayout:fixed
          and is NOT on the R5.3 allowlist. Fix it (fixed layout + % widths)
          or, if genuinely lower severity, add it to the allowlist WITH a
          dated justification.

.NOTES
    Keep the allowlist in lockstep with copilot-instructions.md R5.3.
#>
[CmdletBinding()]
param(
    [string]$WebSrc = (Join-Path $PSScriptRoot '..' 'web' 'src'),
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

# R5.3 known lower-severity `table-layout: auto` tables (2026-07-08 audit).
# Each renders a truncating/capped cell so it is not catastrophic like the
# Operations bug was, but each is still an R5 gap to migrate when next
# touched. Listed here so the gate flags only NEW offenders. Remove an entry
# when its table is migrated to table-layout:fixed + percentage widths.
$R53Allowlist = @(
    'pages/LogsPage.tsx',
    'pages/LogsTab.tsx',
    'pages/WorkbenchPage.tsx',
    'pages/DiscoveryExplorerPage.tsx'
)

if (-not (Test-Path $WebSrc)) {
    Write-Error "web/src not found at $WebSrc"
    exit 2
}

$tsxFiles = Get-ChildItem -Path $WebSrc -Recurse -Filter '*.tsx' |
    Where-Object { $_.Name -notmatch '\.(test|spec)\.tsx$' }

$newOffenders = [System.Collections.Generic.List[string]]::new()
$allowlistedHits = [System.Collections.Generic.List[string]]::new()

foreach ($f in $tsxFiles) {
    $text = Get-Content -Raw -Path $f.FullName
    if ($text -notmatch '<table') { continue }

    $importsTruncator = $text -match 'CopyableField|TruncatedText'
    $hasFixedLayout = $text -match "tableLayout:\s*'fixed'"

    if ($hasFixedLayout) { continue }              # correct
    if (-not $importsTruncator) { continue }       # no truncating cell -> not an R5 target

    # Offender: renders <table> + truncation primitive + no fixed layout.
    $rel = ($f.FullName -replace [regex]::Escape((Resolve-Path (Join-Path $WebSrc '..')).Path + [IO.Path]::DirectorySeparatorChar), '') `
        -replace '\\', '/' -replace '^web/src/', ''
    $relFromSrc = ($f.FullName -replace '\\', '/')
    $relKey = ($relFromSrc -replace '.*/web/src/', '')

    if ($R53Allowlist -contains $relKey) {
        $allowlistedHits.Add($relKey)
    } else {
        $newOffenders.Add($relKey)
    }
}

if (-not $Quiet) {
    Write-Host "=== R5 table-layout audit ==="
    Write-Host "Scanned $($tsxFiles.Count) .tsx files under $WebSrc"
    Write-Host "Known R5.3 lower-severity tables present: $($allowlistedHits.Count)/$($R53Allowlist.Count)"
    foreach ($a in $allowlistedHits) { Write-Host "  [R5.3 allowlisted] $a" }
}

if ($newOffenders.Count -gt 0) {
    Write-Host ''
    Write-Host "FAIL: new R5 offender(s) - <table> + truncation primitive + NO table-layout:fixed:" -ForegroundColor Red
    foreach ($o in $newOffenders) { Write-Host "  $o" -ForegroundColor Red }
    Write-Host ''
    Write-Host "Fix: set tableLayout:'fixed' + percentage column widths (R5.1), render name/URL cells through TruncatedText/CopyableField, and add an R5.2 bounded-column Playwright assertion. If genuinely lower severity, add to the R5.3 allowlist in this script AND copilot-instructions.md with a dated justification."
    exit 1
}

if (-not $Quiet) { Write-Host "PASS: no new R5 table-layout offenders." -ForegroundColor Green }
exit 0
