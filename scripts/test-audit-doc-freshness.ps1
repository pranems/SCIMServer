<#
.SYNOPSIS
    Self-test for scripts/audit-doc-freshness.ps1.

.DESCRIPTION
    A gate is only trustworthy once you have seen it FAIL. This repo learned
    that the expensive way: scripts/live-test.ps1 had no exit statement in
    ~14,800 lines, so every caller gating on $LASTEXITCODE was reading a signal
    that could never be false, and the first attempt to negative-control it was
    itself a false positive.

    So each check here gets a NEGATIVE CONTROL: a scratch repo containing a
    document that violates exactly one rule, plus a positive control that must
    pass. If a check cannot be made to fail, this test fails.

.EXAMPLE
    pwsh scripts/test-audit-doc-freshness.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gate = Join-Path $repoRoot 'scripts/audit-doc-freshness.ps1'

$pass = 0
$fail = 0

function New-Scratch {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ("docfresh-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path (Join-Path $dir 'api') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $dir 'docs') | Out-Null
    '{ "version": "9.9.9" }' | Set-Content (Join-Path $dir 'api/package.json')
    return $dir
}

function Set-Doc($dir, $name, $content) {
    $p = Join-Path $dir "docs/$name"
    $content | Set-Content $p -Encoding UTF8
    return $p
}

function Set-Manifest($dir, $entries) {
    $m = @{ docs = $entries } | ConvertTo-Json -Depth 8
    $p = Join-Path $dir 'docs/.doc-manifest.json'
    $m | Set-Content $p -Encoding UTF8
    return $p
}

function Invoke-Gate($dir, $manifest, [switch]$SkipCoupling) {
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $gate,
        '-RepoRoot', $dir, '-ManifestPath', $manifest, '-Quiet')
    if ($SkipCoupling) { $args += '-SkipCoupling' }
    $out = & pwsh @args 2>&1 | Out-String
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out }
}

function Assert($name, $condition, $detail) {
    if ($condition) {
        Write-Host "  PASS  $name" -ForegroundColor Green
        $script:pass++
    }
    else {
        Write-Host "  FAIL  $name" -ForegroundColor Red
        if ($detail) { Write-Host "        $detail" -ForegroundColor DarkGray }
        $script:fail++
    }
}

$goodHeader = @"
# Some Guide

> **Status:** User-facing reference - **Last verified:** $((Get-Date).ToString('yyyy-MM-dd')) - **Product version:** ``9.9.9``

Body text.
"@

Write-Host "=== positive control: a clean doc must PASS ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'GOOD.md' $goodHeader | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/GOOD.md'; title = 'good'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'clean doc exits 0' ($r.ExitCode -eq 0) $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F1: a stale header version must FAIL ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F1.md' ($goodHeader -replace '9\.9\.9', '0.53.0') | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F1.md'; title = 'f1'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'stale version exits 1' ($r.ExitCode -eq 1) $r.Output
Assert 'stale version reports F1' ($r.Output -match '\[F1\]') $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F1: an RFC section number must NOT be mistaken for a version ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F1b.md' ($goodHeader -replace 'Body text\.', 'See RFC 7644 section 3.5.2 and Node v24.18.1.') | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F1b.md'; title = 'f1b'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'RFC section + node version do not trip F1' ($r.ExitCode -eq 0) $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F1: a stale 'source-verified against' claim must FAIL ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F1c.md' ($goodHeader + "`n> **Version:** 4.1 - **Source-verified against:** v0.53.0`n") | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F1c.md'; title = 'f1c'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'stale source-verified claim exits 1' ($r.ExitCode -eq 1) $r.Output
Assert 'stale source-verified claim reports F1' ($r.Output -match '\[F1\]') $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F1: a 2-part DOC version must NOT be read as a product version ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F1d.md' ($goodHeader + "`n> **Version:** 4.1 - the document's own revision`n") | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F1d.md'; title = 'f1d'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'doc revision 4.1 does not trip F1' ($r.ExitCode -eq 0) $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F2: a missing provenance stamp must FAIL ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F2.md' "# No Stamp`n`nBody only.`n" | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F2.md'; title = 'f2'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'missing stamp exits 1' ($r.ExitCode -eq 1) $r.Output
Assert 'missing stamp reports F2' ($r.Output -match '\[F2\]') $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F2: an EXPIRED stamp must WARN but not fail ===" -ForegroundColor Cyan
$d = New-Scratch
$old = (Get-Date).AddDays(-400).ToString('yyyy-MM-dd')
Set-Doc $d 'F2b.md' ($goodHeader -replace '\*\*Last verified:\*\* \d{4}-\d{2}-\d{2}', "**Last verified:** $old") | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F2b.md'; title = 'f2b'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'expired stamp warns' ($r.Output -match '\[F2\].*days ago') $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F3: a broken relative link must FAIL ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F3.md' ($goodHeader + "`n[gone](./NOPE_DOES_NOT_EXIST.md)`n") | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F3.md'; title = 'f3'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'broken link exits 1' ($r.ExitCode -eq 1) $r.Output
Assert 'broken link reports F3' ($r.Output -match '\[F3\]') $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F3: an http link must NOT be resolved from disk ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F3b.md' ($goodHeader + "`n[ietf](https://www.rfc-editor.org/rfc/rfc7644)`n") | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F3b.md'; title = 'f3b'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'external link ignored' ($r.ExitCode -eq 0) $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F0: a manifest entry with no file must FAIL ===" -ForegroundColor Cyan
$d = New-Scratch
$mf = Set-Manifest $d @(@{ path = 'docs/ABSENT.md'; title = 'absent'; sources = @(); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'absent doc exits 1' ($r.ExitCode -eq 1) $r.Output
Assert 'absent doc reports F0' ($r.Output -match '\[F0\]') $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n=== F4: coupled source changed without the doc must FAIL ===" -ForegroundColor Cyan
$d = New-Scratch
Push-Location $d
try {
    git init -q 2>$null
    git config user.email t@t.t; git config user.name t
    New-Item -ItemType Directory -Force -Path (Join-Path $d 'api/src') | Out-Null
    'v1' | Set-Content (Join-Path $d 'api/src/thing.ts')
    Set-Doc $d 'F4.md' $goodHeader | Out-Null
    $mf = Set-Manifest $d @(@{ path = 'docs/F4.md'; title = 'f4'; sources = @('api/src/'); maxAgeDays = 90 })
    git add -A 2>$null; git commit -qm base 2>$null
    # Change ONLY the source, not the doc.
    'v2' | Set-Content (Join-Path $d 'api/src/thing.ts')
    git add -A 2>$null
    $r = Invoke-Gate $d $mf
    Assert 'uncoupled source change exits 1' ($r.ExitCode -eq 1) $r.Output
    Assert 'uncoupled source change reports F4' ($r.Output -match '\[F4\]') $r.Output

    # Now also touch the doc: the coupling is satisfied.
    Add-Content (Join-Path $d 'docs/F4.md') "`nUpdated for the change."
    git add -A 2>$null
    $r2 = Invoke-Gate $d $mf
    Assert 'source + doc changed together exits 0' ($r2.ExitCode -eq 0) $r2.Output
}
finally { Pop-Location }
Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n=== F5: a manifest source path that does not exist must FAIL ===" -ForegroundColor Cyan
$d = New-Scratch
Set-Doc $d 'F5.md' $goodHeader | Out-Null
$mf = Set-Manifest $d @(@{ path = 'docs/F5.md'; title = 'f5'; sources = @('api/src/does-not-exist/'); maxAgeDays = 90 })
$r = Invoke-Gate $d $mf -SkipCoupling
Assert 'dead manifest source path exits 1' ($r.ExitCode -eq 1) $r.Output
Assert 'dead manifest source path reports F5' ($r.Output -match '\[F5\]') $r.Output
Remove-Item $d -Recurse -Force

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host " passed: $pass   failed: $fail" -ForegroundColor $(if ($fail -gt 0) { 'Red' } else { 'Green' })
if ($fail -gt 0) { exit 1 }
exit 0
