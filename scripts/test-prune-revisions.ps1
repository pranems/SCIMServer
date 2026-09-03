<#
.SYNOPSIS
    Self-test for the revision retention selector.

.DESCRIPTION
    D3 (2026-09-03): the prune kept the newest N revisions by creation time,
    which only means "serving + rollback target" while those revisions run
    DIFFERENT images. An interrupted promote left an orphan revision carrying
    the SAME image as the one being deployed, so the two newest were both the
    new version - the prune then deactivated the only previous-version revision
    and the estate was left with no way back, with every check reporting green.
    The policy was satisfied to the letter and defeated in purpose.

    These cases feed the selector hand-built revision sets and assert what it
    retains. PR-T2 is the D3 regression itself; PR-T3 is the cost guard that
    proves customer-prod's declared keep=1 is untouched by the fix.
#>
[CmdletBinding()] param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'revision-selection.ps1')

$script:passCount = 0
$script:failCount = 0

function New-Rev {
    param([string]$Name, [int]$Traffic, [string]$Created, [string]$Image)
    [pscustomobject]@{ name = $Name; traffic = $Traffic; created = [datetime]$Created; image = $Image }
}

function Assert-Keeps {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][array]$Revisions,
        [Parameter(Mandatory)][int]$Keep,
        [Parameter(Mandatory)][string[]]$Expected
    )
    $got = @(Select-RevisionsToKeep -Revisions $Revisions -Keep $Keep) | Sort-Object
    $want = @($Expected) | Sort-Object
    if (($got -join ',') -eq ($want -join ',')) {
        Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green
        $script:passCount++
    } else {
        Write-Host ("  FAIL  {0}`n        expected: {1}`n        got     : {2}" -f $Name, ($want -join ', '), ($got -join ', ')) -ForegroundColor Red
        $script:failCount++
    }
}

Write-Host "`n=== Revision retention selector self-test ===" -ForegroundColor Cyan

# Baseline: distinct images, newest-first behaviour is unchanged.
Assert-Keeps -Name 'PR-T1: keep=2 with distinct images retains serving + newest other' -Keep 2 -Expected @('r3', 'r2') -Revisions @(
    (New-Rev -Name 'r3' -Traffic 100 -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 0   -Created '2026-09-02T21:36' -Image 'img:B')
    (New-Rev -Name 'r1' -Traffic 0   -Created '2026-08-27T21:32' -Image 'img:A')
)

# THE D3 REGRESSION. r2 is an orphan from an interrupted promote and carries the
# SAME image as the serving revision, so keeping it spends the rollback slot on a
# duplicate. The genuine rollback target is the older r1.
Assert-Keeps -Name 'PR-T2: keep=2 skips a same-image orphan and retains a real rollback target' -Keep 2 -Expected @('r3', 'r1') -Revisions @(
    (New-Rev -Name 'r3' -Traffic 100 -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 0   -Created '2026-09-03T03:15' -Image 'img:C')
    (New-Rev -Name 'r1' -Traffic 0   -Created '2026-09-02T21:36' -Image 'img:B')
)

# THE COST GUARD. customer-prod declares keep=1 for cost (MSDN spending limit).
# The budget is full once the serving revision is retained, so the image-aware
# fill must never run and must never add a second always-on replica.
Assert-Keeps -Name 'PR-T3: keep=1 retains ONLY the serving revision (customer-prod cost policy)' -Keep 1 -Expected @('r3') -Revisions @(
    (New-Rev -Name 'r3' -Traffic 100 -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 0   -Created '2026-09-03T03:15' -Image 'img:C')
    (New-Rev -Name 'r1' -Traffic 0   -Created '2026-09-02T21:36' -Image 'img:B')
)

# Serving is retained regardless of age - the pre-existing safety property.
Assert-Keeps -Name 'PR-T4: an OLD serving revision is never pruned' -Keep 2 -Expected @('r1', 'r3') -Revisions @(
    (New-Rev -Name 'r3' -Traffic 0   -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 0   -Created '2026-09-03T03:15' -Image 'img:C')
    (New-Rev -Name 'r1' -Traffic 100 -Created '2026-09-02T21:36' -Image 'img:B')
)

# When nothing differs, still fill the budget - keeping a same-image spare is
# better than dropping to one revision on an estate that asked for two.
Assert-Keeps -Name 'PR-T5: with no different-image candidate, the budget is still filled' -Keep 2 -Expected @('r3', 'r2') -Revisions @(
    (New-Rev -Name 'r3' -Traffic 100 -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 0   -Created '2026-09-03T03:15' -Image 'img:C')
    (New-Rev -Name 'r1' -Traffic 0   -Created '2026-09-03T03:10' -Image 'img:C')
)

# A weighted split during a flip means more than one revision serves traffic.
Assert-Keeps -Name 'PR-T6: every revision serving traffic is retained, even past the budget' -Keep 1 -Expected @('r3', 'r2') -Revisions @(
    (New-Rev -Name 'r3' -Traffic 50 -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 50 -Created '2026-09-03T03:15' -Image 'img:B')
    (New-Rev -Name 'r1' -Traffic 0  -Created '2026-09-02T21:36' -Image 'img:A')
)

# A larger budget spends every slot on a DISTINCT image before any duplicate:
# two real rollback targets beat one target plus a same-image spare.
Assert-Keeps -Name 'PR-T7: a larger budget fills with distinct images before any duplicate' -Keep 3 -Expected @('r4', 'r2', 'r1') -Revisions @(
    (New-Rev -Name 'r4' -Traffic 100 -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r3' -Traffic 0   -Created '2026-09-03T03:15' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 0   -Created '2026-09-02T21:36' -Image 'img:B')
    (New-Rev -Name 'r1' -Traffic 0   -Created '2026-08-27T21:32' -Image 'img:A')
)

# A revision with no image reported must not be mistaken for a match.
Assert-Keeps -Name 'PR-T8: a missing image is not treated as equal to the serving image' -Keep 2 -Expected @('r3', 'r2') -Revisions @(
    (New-Rev -Name 'r3' -Traffic 100 -Created '2026-09-03T03:20' -Image 'img:C')
    (New-Rev -Name 'r2' -Traffic 0   -Created '2026-09-03T03:15' -Image $null)
    (New-Rev -Name 'r1' -Traffic 0   -Created '2026-09-02T21:36' -Image 'img:C')
)

Write-Host ""
Write-Host ("  {0} passed, {1} failed" -f $script:passCount, $script:failCount) -ForegroundColor $(if ($script:failCount) { 'Red' } else { 'Green' })
if ($script:failCount -gt 0) { exit 1 }
Write-Host "  REVISION SELECTOR SELF-TEST PASSED" -ForegroundColor Green
