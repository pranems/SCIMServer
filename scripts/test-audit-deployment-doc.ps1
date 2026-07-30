<#
.SYNOPSIS
  Self-test for scripts/audit-deployment-doc.ps1. Proves each static check
  actually fires on the condition it exists to catch.

.DESCRIPTION
  A gate that has never been observed to fail is not evidence of anything. This
  repo has been bitten twice by gates that reported PASS on input they were
  written to reject:

    - audit-base-images.ps1 v1: Get-Content returns a SCALAR STRING for a
      single-line file, so $lines[0] indexed the character 'F' rather than the
      line, and a node:25 Dockerfile sailed through.
    - audit-deployment-doc.ps1 C1 v1: compared the working tree against HEAD,
      which at pre-push time is always empty - the check could never fire on the
      path it was wired into.

  Both were found only by deliberately feeding the gate bad input. This script
  makes that a repeatable step instead of a one-off.

  REQUIRES A CLEAN WORKING TREE. It mutates and then reverts tracked files
  (Dockerfile, the doc), so uncommitted work would be destroyed - which is
  exactly what happened on 2026-07-29 when an earlier ad-hoc version of this
  harness reverted an in-progress edit with `git checkout --`.

.EXAMPLE
  pwsh scripts/test-audit-deployment-doc.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$doc   = 'docs/DEPLOYMENT_INFRASTRUCTURE_AND_FORM_FACTORS.md'
$gate  = Join-Path $PSScriptRoot 'audit-deployment-doc.ps1'
$probe = 'infra/zz-negative-control.bicep'

# ---- safety: refuse to run on a dirty tree -------------------------------
$dirty = @(git status --porcelain) | Where-Object { $_ }
if ($dirty.Count -gt 0) {
    Write-Host 'REFUSING TO RUN - working tree is not clean.' -ForegroundColor Red
    Write-Host 'This harness mutates and reverts tracked files; uncommitted work would be lost.' -ForegroundColor Yellow
    Write-Host 'Commit or stash first. Dirty paths:' -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    exit 2
}

function Invoke-Auditor {
    $out = pwsh -NoProfile -ExecutionPolicy Bypass -File $gate 2>&1 | Out-String
    return @{ Exit = $LASTEXITCODE; Out = $out }
}

$cases = @()

# ---- baseline ------------------------------------------------------------
$r = Invoke-Auditor
$cases += [pscustomobject]@{ Case = 'baseline (clean tree)'; Expect = 'PASS'; Exit = $r.Exit; Detail = ''; Ok = ($r.Exit -eq 0) }

# ---- C1: infra changed, doc not -----------------------------------------
Add-Content -LiteralPath 'Dockerfile' -Value '# negative control'
$r = Invoke-Auditor
$fired = $r.Out -match 'C1: infra files changed but'
git checkout -- Dockerfile
$cases += [pscustomobject]@{ Case = 'C1 infra changed, doc not'; Expect = 'FAIL'; Exit = $r.Exit; Detail = "C1 fired=$fired"; Ok = ($r.Exit -eq 1 -and $fired) }

# ---- C2: stale Last verified --------------------------------------------
$original = Get-Content -LiteralPath $doc -Raw
($original -replace '\*\*Last verified:\*\*\s*\d{4}-\d{2}-\d{2}', '**Last verified:** 2020-01-01') |
    Set-Content -LiteralPath $doc -NoNewline
$r = Invoke-Auditor
$fired = $r.Out -match 'C2: doc last verified'
Set-Content -LiteralPath $doc -Value $original -NoNewline
$cases += [pscustomobject]@{ Case = 'C2 stale Last verified'; Expect = 'FAIL'; Exit = $r.Exit; Detail = "C2 fired=$fired"; Ok = ($r.Exit -eq 1 -and $fired) }

# ---- C3: undocumented infra element -------------------------------------
'// negative control' | Set-Content -LiteralPath $probe
$r = Invoke-Auditor
$fired = $r.Out -match 'C3: infra element\(s\) exist but are never named'
Remove-Item -LiteralPath $probe -Force
$cases += [pscustomobject]@{ Case = 'C3 undocumented element'; Expect = 'FAIL'; Exit = $r.Exit; Detail = "C3 fired=$fired"; Ok = ($r.Exit -eq 1 -and $fired) }

# ---- restored ------------------------------------------------------------
$r = Invoke-Auditor
$cases += [pscustomobject]@{ Case = 'restored (clean tree)'; Expect = 'PASS'; Exit = $r.Exit; Detail = ''; Ok = ($r.Exit -eq 0) }

# ---- report --------------------------------------------------------------
Write-Host ''
foreach ($c in $cases) {
    $tag = if ($c.Ok) { 'OK  ' } else { 'BAD ' }
    $col = if ($c.Ok) { 'Green' } else { 'Red' }
    Write-Host ("{0} {1,-28} expect={2,-5} exit={3}  {4}" -f $tag, $c.Case, $c.Expect, $c.Exit, $c.Detail) -ForegroundColor $col
}

$leftover = @(git status --porcelain) | Where-Object { $_ }
if ($leftover.Count -gt 0) {
    Write-Host ''
    Write-Host 'FAIL - harness did not restore the tree:' -ForegroundColor Red
    $leftover | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}

if (@($cases | Where-Object { -not $_.Ok }).Count -gt 0) {
    Write-Host ''
    Write-Host 'FAIL - at least one check did not fire on its own condition.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'PASS - every check fires on the condition it exists to catch, and the tree is clean.' -ForegroundColor Green
exit 0
