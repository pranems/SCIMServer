<#
.SYNOPSIS
    Gates the CURRENCY of the user-facing documentation set.

.DESCRIPTION
    Every gate this repo owns checks whether the CODE is correct. None of them
    checks whether the DOCUMENTATION still describes that code. That gap is how
    12 user-facing documents kept advertising v0.53.0 while the product shipped
    0.55.1, with every test green the whole time.

    This is the general form of scripts/audit-deployment-doc.ps1, which applies
    the same idea to a single document. The contract lives in
    docs/.doc-manifest.json.

    Checks:

      F1  Version currency   - a doc's header must not advertise a version other
                               than the one in api/package.json.
      F2  Provenance stamp   - a doc must carry '**Last verified:** YYYY-MM-DD',
                               and that date must be within its maxAgeDays.
      F3  Link integrity     - every relative link and image must resolve.
      F4  Source coupling    - if a source path a doc is bound to changed in this
                               push, the doc must have changed too. This is
                               Google's 'Update Docs with Code' rule, mechanized.

    F4 is the self-extending one: binding a doc to a source prefix means future
    changes under that prefix automatically demand a documentation review, with
    no edit to this script.

.PARAMETER BaseRef
    Compare against this git ref for F4. At pre-push pass the upstream ref, so
    the COMMITS BEING PUSHED are what gets checked (the working tree is clean at
    that point, so a HEAD-only comparison could never fire).

.PARAMETER Fix
    Rewrite stale version headers and refresh the '**Last verified:**' stamp on
    docs that changed in this comparison. Never edits prose.

.PARAMETER SkipCoupling
    Run F1-F3 only. Useful when auditing currency outside a push.

.PARAMETER Quiet
    Only emit failures and the summary.

.EXAMPLE
    pwsh scripts/audit-doc-freshness.ps1
.EXAMPLE
    pwsh scripts/audit-doc-freshness.ps1 -BaseRef origin/master
.EXAMPLE
    pwsh scripts/audit-doc-freshness.ps1 -Fix
#>
[CmdletBinding()]
param(
    [string]$BaseRef,
    [switch]$Fix,
    [switch]$SkipCoupling,
    [switch]$Quiet,
    [string]$RepoRoot,
    [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
if (-not $ManifestPath) { $ManifestPath = Join-Path $RepoRoot 'docs/.doc-manifest.json' }

$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
$fixed = New-Object System.Collections.Generic.List[string]

function Say($msg, $color = 'Gray') { if (-not $Quiet) { Write-Host $msg -ForegroundColor $color } }

if (-not (Test-Path $ManifestPath)) {
    Write-Host "FAIL  manifest not found: $ManifestPath" -ForegroundColor Red
    exit 1
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$pkgPath = Join-Path $RepoRoot 'api/package.json'
$version = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
$today = Get-Date

Say "=== doc freshness audit ===" Cyan
Say "version  : $version"
Say "manifest : $($manifest.docs.Count) user-facing docs"

# --- changed-file set for F4 -------------------------------------------------
$changed = @()
if (-not $SkipCoupling) {
    Push-Location $RepoRoot
    try {
        if ($BaseRef) {
            $changed = @(git diff --name-only "$BaseRef...HEAD" 2>$null)
            if ($LASTEXITCODE -ne 0) { $changed = @(git diff --name-only $BaseRef 2>$null) }
        }
        else {
            $changed = @(git diff --name-only HEAD 2>$null) + @(git diff --name-only --cached 2>$null)
        }
    }
    finally { Pop-Location }
    $changed = $changed | Where-Object { $_ } | Sort-Object -Unique
    Say "changed  : $($changed.Count) file(s)$(if ($BaseRef) { " vs $BaseRef" })"
}

Say ""

foreach ($entry in $manifest.docs) {
    $rel = $entry.path
    $full = Join-Path $RepoRoot $rel
    $label = $rel

    if (-not (Test-Path $full)) {
        $msg = "[F0] $label - listed in the manifest but does not exist"
        $failures.Add($msg)
        Write-Host "FAIL  $label" -ForegroundColor Red
        Write-Host "        $msg" -ForegroundColor Red
        continue
    }

    $raw = Get-Content $full -Raw
    $lines = Get-Content $full
    $issues = @()

    # --- F1 version currency ------------------------------------------------
    # Only the header is checked. Historical version references deeper in a doc
    # (changelog-style prose, 'shipped in v0.50.0') are legitimate.
    #
    # A bare dotted triple is NOT enough to call something a product version:
    # 'RFC 7644 section 3.5.2' and 'Node v24.18.1' both look like one. So a
    # token only counts when it is explicitly labelled as the PRODUCT version,
    # and anything qualified by another product name is excluded.
    $headerLineCount = [Math]::Min(15, $lines.Count)
    $header = ($lines[0..($headerLineCount - 1)]) -join "`n"

    # Two classes of version token, because -Fix must treat them OPPOSITELY.
    #
    #   MARKER - "this doc documents product version X". Restamping is correct.
    #   CLAIM  - "this doc was verified against X", usually next to a date. A
    #            stale one is a real finding, but REWRITING the number launders
    #            it: it asserts a verification that never happened. Report only.
    $markerPatterns = @(
        # A 3-part number after a Version label is a product version; a 2-part
        # one ('**Version:** 3.1') is the DOC's own revision and is excluded
        # automatically because it cannot match a 3-part group.
        '\*\*Version:?\*\*[^\d\n]{0,12}v?(\d+\.\d+\.\d+)'
        '(?im)^#[^\n]*?\bv(\d+\.\d+\.\d+)'
        '\bSCIMServer\s+v?(\d+\.\d+\.\d+)'
        '\bProduct version:?\*{0,2}[^\d\n]{0,8}`?v?(\d+\.\d+\.\d+)'
    )
    $claimPatterns = @(
        # 'Source-verified against: v0.53.0' is a product-version claim too, and
        # missing it was a real false negative: four guides kept asserting they
        # matched 0.53.0 long after 0.55.1 shipped.
        '(?i)source-verified against:?\**\s*v?(\d+\.\d+\.\d+)'
        '(?i)verified against:?\**\s*v(\d+\.\d+\.\d+)'
        # Dated capture provenance, e.g. UI_GUIDE's screenshot attribution.
        '(?i)captured on[^\n]{0,120}?\bv(\d+\.\d+\.\d+)'
    )

    # Collect matches WITH their offsets so a fix can be applied surgically
    # instead of string-replacing the token across the whole header.
    $hits = New-Object System.Collections.Generic.List[object]
    foreach ($set in @(
            @{ Patterns = $markerPatterns; Kind = 'marker' },
            @{ Patterns = $claimPatterns;  Kind = 'claim'  })) {
        foreach ($vp in $set.Patterns) {
            foreach ($m in [regex]::Matches($header, $vp)) {
                $g = $m.Groups[1]
                # Exclude a triple qualified by another product (Node, Postgres, ...).
                $ctxStart = [Math]::Max(0, $g.Index - 16)
                $ctx = $header.Substring($ctxStart, $g.Index - $ctxStart)
                if ($ctx -match '(?i)(node|postgres|prisma|playwright|mermaid|react|nest)\s*v?$') { continue }
                $hits.Add([pscustomobject]@{
                        Kind  = $set.Kind
                        Token = $g.Value
                        Index = $g.Index
                        Len   = $g.Length
                    })
            }
        }
    }

    $staleHits = @($hits | Where-Object { $_.Token -ne $version })
    $staleMarkers = @($staleHits | Where-Object { $_.Kind -eq 'marker' })
    $staleClaims = @($staleHits | Where-Object { $_.Kind -eq 'claim' })

    if ($Fix -and $staleMarkers.Count -gt 0) {
        $newHeader = $header
        # Descending offset so earlier replacements cannot shift later indices.
        foreach ($h in ($staleMarkers | Sort-Object Index -Descending)) {
            $newHeader = $newHeader.Remove($h.Index, $h.Len).Insert($h.Index, $version)
        }
        $rest = if ($lines.Count -gt $headerLineCount) { ($lines[$headerLineCount..($lines.Count - 1)]) -join "`n" } else { '' }
        Set-Content -Path $full -Value ($newHeader + "`n" + $rest) -NoNewline:$false -Encoding UTF8
        $fixed.Add("[F1] $label - header version $(($staleMarkers.Token | Sort-Object -Unique) -join ', ') -> $version")
        $raw = Get-Content $full -Raw
        $lines = Get-Content $full
    }
    elseif ($staleMarkers.Count -gt 0) {
        $issues += "[F1] header advertises $(($staleMarkers.Token | Sort-Object -Unique) -join ', ') but the product is $version"
    }

    # Never auto-fixed, at any switch: a human has to re-verify and restamp.
    #
    # And only a MINOR-level gap is a finding. "Verified against v0.55.6" is a
    # true statement about the past; shipping 0.55.7 does not falsify it, and
    # failing on it would make every patch bump a blocker - which would get the
    # rule deleted rather than obeyed. A claim trailing by a whole minor is the
    # case the rule was written for (four guides asserting 0.53.0 after 0.55.1).
    $curMinor = ($version -split '\.')[0, 1] -join '.'
    $farClaims = @($staleClaims | Where-Object { (($_.Token -split '\.')[0, 1] -join '.') -ne $curMinor })
    if ($farClaims.Count -gt 0) {
        $issues += "[F1] header CLAIMS verification against $(($farClaims.Token | Sort-Object -Unique) -join ', ') but the product is $version - re-verify the doc and update the claim by hand (-Fix will not rewrite a dated verification claim, because that would assert a check nobody performed)"
    }

    # --- F2 provenance stamp -------------------------------------------------
    $maxAge = if ($entry.maxAgeDays) { [int]$entry.maxAgeDays } else { 120 }
    if ($raw -match '(?im)^\s*>?\s*.*\*\*Last verified:?\*\*[:\s]*(\d{4}-\d{2}-\d{2})') {
        $verified = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null)
        $age = ($today - $verified).Days
        if ($age -gt $maxAge) {
            $warnings.Add("[F2] $label - last verified $($Matches[1]) ($age days ago, budget $maxAge)")
        }
    }
    else {
        if ($Fix) {
            # Insert the stamp immediately after the H1 title.
            $idx = 0
            for ($i = 0; $i -lt [Math]::Min(5, $lines.Count); $i++) {
                if ($lines[$i] -match '^#\s') { $idx = $i; break }
            }
            $stamp = "", "> **Status:** User-facing reference - **Last verified:** $($today.ToString('yyyy-MM-dd')) - **Product version:** ``$version``"
            $new = @()
            $new += $lines[0..$idx]
            $new += $stamp
            if ($lines.Count -gt ($idx + 1)) { $new += $lines[($idx + 1)..($lines.Count - 1)] }
            Set-Content -Path $full -Value ($new -join "`n") -Encoding UTF8
            $fixed.Add("[F2] $label - added provenance stamp")
            $raw = Get-Content $full -Raw
        }
        else {
            $issues += "[F2] no '**Last verified:** YYYY-MM-DD' stamp"
        }
    }

    # --- F3 link integrity ---------------------------------------------------
    $docDir = Split-Path -Parent $full
    $linkMatches = [regex]::Matches($raw, '(?<!\!)\[[^\]]*\]\(([^)\s]+)\)') +
                   [regex]::Matches($raw, '!\[[^\]]*\]\(([^)\s]+)\)')
    $badLinks = @()
    foreach ($m in $linkMatches) {
        $target = $m.Groups[1].Value
        if ($target -match '^(https?:|mailto:|#)') { continue }
        $target = ($target -split '#')[0]
        if (-not $target) { continue }
        $resolved = Join-Path $docDir $target
        if (-not (Test-Path $resolved)) { $badLinks += $target }
    }
    $badLinks = $badLinks | Sort-Object -Unique
    if ($badLinks.Count -gt 0) {
        $show = if ($badLinks.Count -gt 4) { ($badLinks[0..3] -join ', ') + ", +$($badLinks.Count - 4) more" } else { $badLinks -join ', ' }
        $issues += "[F3] $($badLinks.Count) unresolved link(s): $show"
    }

    # --- F4 source coupling --------------------------------------------------
    if (-not $SkipCoupling -and $changed.Count -gt 0 -and $entry.sources) {
        $normalizedChanged = $changed | ForEach-Object { $_ -replace '\\', '/' }
        $touchedSources = @()
        foreach ($src in $entry.sources) {
            $s = $src -replace '\\', '/'
            $touchedSources += $normalizedChanged | Where-Object { $_ -like "$s*" }
        }
        $touchedSources = $touchedSources | Sort-Object -Unique
        $docChanged = $normalizedChanged -contains ($rel -replace '\\', '/')
        if ($touchedSources.Count -gt 0 -and -not $docChanged) {
            $show = if ($touchedSources.Count -gt 3) { ($touchedSources[0..2] -join ', ') + ", +$($touchedSources.Count - 3) more" } else { $touchedSources -join ', ' }
            $issues += "[F4] coupled source changed but this doc did not: $show"
        }
    }

    # --- F5 manifest integrity ----------------------------------------------
    # A source prefix that does not exist matches nothing, so F4 for that doc is
    # silently dead. That is the same failure shape as a gate with no exit code:
    # green because it can never fire. Four manifest paths were wrong on the
    # first draft of this file, which is why this check exists.
    if ($entry.sources) {
        $deadPrefixes = @()
        foreach ($src in $entry.sources) {
            $probe = Join-Path $RepoRoot ($src -replace '/$', '')
            if (-not (Test-Path $probe)) { $deadPrefixes += $src }
        }
        if ($deadPrefixes.Count -gt 0) {
            $issues += "[F5] manifest source path does not exist (coupling is dead): $($deadPrefixes -join ', ')"
        }
    }

    if ($issues.Count -gt 0) {
        foreach ($i in $issues) { $failures.Add("$i  <- $label") }
        # Failures print even under -Quiet: a gate that hides WHY it failed is
        # only marginally better than one that cannot fail at all.
        Write-Host ("FAIL  {0}" -f $label) -ForegroundColor Red
        foreach ($i in $issues) { Write-Host ("        $i") -ForegroundColor Red }
    }
    else {
        Say ("ok    {0}" -f $label) DarkGray
    }
}

Say ""
if ($fixed.Count -gt 0) {
    Write-Host "=== fixed ($($fixed.Count)) ===" -ForegroundColor Green
    $fixed | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
    Write-Host ""
}
if ($warnings.Count -gt 0) {
    Write-Host "=== warnings ($($warnings.Count)) ===" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ""
}

if ($failures.Count -gt 0) {
    Write-Host "=== failures ($($failures.Count)) ===" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "DOC FRESHNESS AUDIT FAILED - $($failures.Count) issue(s)" -ForegroundColor Red
    Write-Host "Re-run with -Fix to stamp versions and provenance dates automatically." -ForegroundColor Yellow
    exit 1
}

Write-Host "DOC FRESHNESS AUDIT PASSED ($($manifest.docs.Count) docs)" -ForegroundColor Green
exit 0
