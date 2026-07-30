<#
.SYNOPSIS
  Negative control for scripts/sync-rfcs.ps1. Proves each offline check can fail.

.DESCRIPTION
  Repo norm (see docs/rfcs/README.md, and the lesson recorded for the Mermaid
  HTML exporter in .github/copilot-instructions.md): "a new checking tool needs
  its own sanity check before its output is believed." A gate that has only ever
  been seen GREEN is indistinguishable from a gate that cannot go red - that is
  precisely how a bad assertion green-lights a real defect (rule R10: presence
  is not correctness).

  This deliberately breaks each offline check one at a time, asserts the gate
  exits non-zero AND names the right check, then restores. Every mutation is
  inside a try/finally so an interrupted run still leaves the tree clean, and
  the final case re-asserts the restored tree is green.

  Run it whenever sync-rfcs.ps1 changes.

.EXAMPLE
  pwsh -NoProfile -File scripts/test-sync-rfcs.ps1
#>
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gate = Join-Path $repoRoot 'scripts/sync-rfcs.ps1'
$manifest = Join-Path $repoRoot 'docs/rfcs/rfc-manifest.json'
$readme = Join-Path $repoRoot 'docs/rfcs/README.md'
$mirror = Join-Path $repoRoot 'docs/rfcs/rfc7642.txt'

$results = @()

function Test-GateFails {
    param([string]$Case, [string]$ExpectCheck, [string[]]$ExtraArgs = @())

    $out = & pwsh -NoProfile -ExecutionPolicy Bypass -File $gate @ExtraArgs 2>&1 | Out-String
    $code = $LASTEXITCODE
    $named = $out -match ("\[{0}\]" -f [regex]::Escape($ExpectCheck))

    $verdict = if ($code -ne 0 -and $named) { 'PASS' } elseif ($code -ne 0) { 'PARTIAL (failed, but did not name {0})' -f $ExpectCheck } else { 'FAIL (gate stayed green)' }
    $script:results += [pscustomobject]@{ Case = $Case; Expect = $ExpectCheck; ExitCode = $code; Verdict = $verdict }
}

Write-Host '=== baseline: gate must be GREEN before we start breaking things ==='
& pwsh -NoProfile -ExecutionPolicy Bypass -File $gate -Quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Baseline is already red; fix that before running the negative control.' }
$results += [pscustomobject]@{ Case = 'baseline (unmodified tree)'; Expect = 'green'; ExitCode = 0; Verdict = 'PASS' }

# ── C1: a stray mirror on disk that the manifest never declared ──────────────
$stray = Join-Path $repoRoot 'docs/rfcs/rfc0000.txt'
try {
    Set-Content -LiteralPath $stray -Value 'not a real RFC' -Encoding utf8
    Test-GateFails -Case 'C1  undeclared .txt on disk' -ExpectCheck 'C1'
} finally {
    if (Test-Path $stray) { Remove-Item -LiteralPath $stray -Force }
}

# ── C2: an edited "verbatim" mirror ─────────────────────────────────────────
$backupMirror = "$mirror.negctl.bak"
try {
    Copy-Item -LiteralPath $mirror -Destination $backupMirror -Force
    Add-Content -LiteralPath $mirror -Value 'tampered'
    Test-GateFails -Case 'C2  mirrored .txt edited' -ExpectCheck 'C2'
} finally {
    if (Test-Path $backupMirror) {
        Move-Item -LiteralPath $backupMirror -Destination $mirror -Force
    }
}

# ── C3: an updating RFC that is neither mirrored nor waived ─────────────────
$backupManifest = "$manifest.negctl.bak"
try {
    Copy-Item -LiteralPath $manifest -Destination $backupManifest -Force
    $m = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $m.waivers = @()   # drop every waiver: the 4 known updaters must now fail
    ($m | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $manifest -Encoding utf8
    Test-GateFails -Case 'C3  updating RFC neither mirrored nor waived' -ExpectCheck 'C3'
} finally {
    if (Test-Path $backupManifest) { Move-Item -LiteralPath $backupManifest -Destination $manifest -Force }
}

# ── C3 (second form): a mirror whose updater is unknown to the manifest ─────
try {
    Copy-Item -LiteralPath $manifest -Destination $backupManifest -Force
    $m = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $target = $m.mirrors | Where-Object { $_.rfc -eq '7643' }
    $target.updatedBy = @('9865', '9967', '99999')  # a fictional future updater
    ($m | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $manifest -Encoding utf8
    Test-GateFails -Case 'C3  newly published updater appears' -ExpectCheck 'C3'
} finally {
    if (Test-Path $backupManifest) { Move-Item -LiteralPath $backupManifest -Destination $manifest -Force }
}

# ── C4: stale manifest ──────────────────────────────────────────────────────
Test-GateFails -Case 'C4  manifest older than the limit' -ExpectCheck 'C4' -ExtraArgs @('-MaxAgeDays', '0')

# ── C5: a mirror the folder README does not mention ─────────────────────────
$backupReadme = "$readme.negctl.bak"
try {
    Copy-Item -LiteralPath $readme -Destination $backupReadme -Force
    (Get-Content -LiteralPath $readme -Raw) -replace 'rfc9967\.txt', 'REMOVED-FOR-NEGATIVE-CONTROL' |
        Set-Content -LiteralPath $readme -Encoding utf8 -NoNewline
    Test-GateFails -Case 'C5  mirror missing from folder README' -ExpectCheck 'C5'
} finally {
    if (Test-Path $backupReadme) { Move-Item -LiteralPath $backupReadme -Destination $readme -Force }
}

# ── restored baseline must be green again ───────────────────────────────────
& pwsh -NoProfile -ExecutionPolicy Bypass -File $gate -Quiet | Out-Null
$restoredCode = $LASTEXITCODE
$results += [pscustomobject]@{
    Case     = 'restored tree is green again'
    Expect   = 'green'
    ExitCode = $restoredCode
    Verdict  = if ($restoredCode -eq 0) { 'PASS' } else { 'FAIL (negative control left the tree dirty)' }
}

Write-Host ''
$results | Format-Table -AutoSize
$failed = @($results | Where-Object { $_.Verdict -notlike 'PASS*' })
if ($failed.Count -gt 0) {
    Write-Host ("NEGATIVE CONTROL FAILED for {0} case(s)." -f $failed.Count) -ForegroundColor Red
    exit 1
}
Write-Host 'NEGATIVE CONTROL PASSED - every check can go red, and the tree restores clean.' -ForegroundColor Green
exit 0
