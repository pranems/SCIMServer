<#
.SYNOPSIS
    Negative + positive controls for the estate liveness probe (N2).

.DESCRIPTION
    The probe's whole purpose is to notice a dead estate BETWEEN deploys.
    That makes one failure mode worse than all the others: resolving zero
    targets and reporting success. A probe that cannot fire is
    indistinguishable from a probe that passed, which is exactly the class
    of defect that let customer prod sit unreachable and be found by
    inspection rather than by alert.

    So the controls below are weighted toward "can this thing be green
    without having actually checked anything?" - not toward HTTP mechanics.
#>
[CmdletBinding()] param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'probe-estates.ps1') -AsModule

$passCount = 0
$failCount = 0

function Assert-Equal {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)]$Expected,
        [Parameter(Mandatory)]$Actual
    )
    if ($Expected -eq $Actual) {
        Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green
        $script:passCount++
    }
    else {
        Write-Host ("  FAIL  {0} - expected '{1}', got '{2}'" -f $Name, $Expected, $Actual) -ForegroundColor Red
        $script:failCount++
    }
}

Write-Host "`n=== Target resolution ===" -ForegroundColor Cyan

Assert-Equal 'T1 comma-separated list resolves to 3 targets' 3 `
    (@(Resolve-ProbeTarget -Raw 'https://a/,https://b/,https://c/')).Count

Assert-Equal 'T2 newline-separated list resolves to 2 targets' 2 `
    (@(Resolve-ProbeTarget -Raw "https://a/`nhttps://b/")).Count

Assert-Equal 'T3 blank entries are discarded, not counted' 1 `
    (@(Resolve-ProbeTarget -Raw 'https://a/,, ,')).Count

Assert-Equal 'T4 surrounding whitespace is trimmed' 'https://a/' `
    (@(Resolve-ProbeTarget -Raw '   https://a/   '))[0]

Assert-Equal 'T5 an entirely blank input resolves to ZERO targets' 0 `
    (@(Resolve-ProbeTarget -Raw '   ,  , ')).Count

Assert-Equal 'T6 a null input resolves to ZERO targets' 0 `
    (@(Resolve-ProbeTarget -Raw $null)).Count

Assert-Equal 'T7 a non-https target is rejected (probe must not be downgraded)' 0 `
    (@(Resolve-ProbeTarget -Raw 'http://insecure/')).Count

Write-Host "`n=== Exit-code contract (the part that matters) ===" -ForegroundColor Cyan

# THE control. Zero targets must NOT be success. If this ever returns 0 the
# probe can be green having checked nothing, which is the defect N2 exists
# to remove.
Assert-Equal 'T8 NEGATIVE CONTROL: zero targets exits 2, never 0' 2 `
    (Get-ProbeExitCode -Results @())

Assert-Equal 'T9 all healthy exits 0' 0 `
    (Get-ProbeExitCode -Results @(
        [pscustomobject]@{ Url = 'https://a/'; Ok = $true },
        [pscustomobject]@{ Url = 'https://b/'; Ok = $true }))

Assert-Equal 'T10 one unhealthy among healthy exits 1' 1 `
    (Get-ProbeExitCode -Results @(
        [pscustomobject]@{ Url = 'https://a/'; Ok = $true },
        [pscustomobject]@{ Url = 'https://b/'; Ok = $false }))

Assert-Equal 'T11 all unhealthy exits 1' 1 `
    (Get-ProbeExitCode -Results @(
        [pscustomobject]@{ Url = 'https://a/'; Ok = $false }))

Write-Host "`n=== Probe behaviour ===" -ForegroundColor Cyan

# A transport failure is the exact condition the probe exists to catch, so
# it must be RECORDED as down - never allowed to escape as an exception that
# aborts the run before the other estates are checked.
$thrower = { param($u) throw "connection refused" }
$res = @(Invoke-EstateProbe -Targets @('https://a/', 'https://b/') -Prober $thrower)
Assert-Equal 'T12 a throwing target is recorded as down, not fatal' 2 $res.Count
Assert-Equal 'T13 both throwing targets report Ok=false' 0 (@($res | Where-Object Ok).Count)
Assert-Equal 'T14 the failure reason is captured for the alert' $true `
    ([bool]($res[0].Detail -match 'connection refused'))

$mixed = { param($u) if ($u -like '*good*') { return @{ status = 'ok' } } else { throw 'down' } }
$res2 = @(Invoke-EstateProbe -Targets @('https://good/', 'https://bad/') -Prober $mixed)
Assert-Equal 'T15 POSITIVE CONTROL: a healthy target reports Ok=true' 1 (@($res2 | Where-Object Ok).Count)
Assert-Equal 'T16 every target is probed even after one fails' 2 $res2.Count

# A 200 that is not actually the health contract must not count as alive.
$wrongBody = { param($u) return @{ unexpected = 'shape' } }
$res3 = @(Invoke-EstateProbe -Targets @('https://a/') -Prober $wrongBody)
Assert-Equal 'T17 a 200 without status=ok is NOT counted as healthy' $false $res3[0].Ok

Write-Host ""
Write-Host ("  {0} passed, {1} failed" -f $passCount, $failCount) -ForegroundColor $(if ($failCount) { 'Red' } else { 'Green' })
if ($failCount) { exit 1 }
exit 0
