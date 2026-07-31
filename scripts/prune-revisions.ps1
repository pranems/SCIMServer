<#
.SYNOPSIS
  Deactivates stale Azure Container Apps revisions, keeping only the newest N.

.DESCRIPTION
  Every deployment creates a new revision. In multiple-revision mode the old
  ones stay ACTIVE at 0% traffic, and an active revision still runs a replica -
  which for this app means it still holds a Prisma connection pool against
  PostgreSQL.

  Measured on the proudbush canary 2026-07-31: 13 active revisions, 12 of them
  serving no traffic at all, each holding a replica with a 5-connection pool
  against a server whose max_connections is 50. That is 65 connections of
  demand for 50 available - the database is the shared resource that runs out
  first, and nothing in the deploy path was reclaiming it.

  This is pure waste with a real failure mode, so pruning is now a standing
  step after every deployment rather than an occasional cleanup.

.PARAMETER Keep
  How many active revisions to retain, newest first. Default 2: the one
  serving traffic plus one previous revision to roll back to. Going below 2
  removes the rollback target, so 1 is allowed but warned about.

.NOTES
  SAFETY: a revision currently serving traffic is NEVER deactivated, even if
  it falls outside the newest N. The script aborts rather than leave an app
  with nothing serving.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string]$ResourceGroup,
    [Parameter(Mandatory)] [string]$AppName,
    [int]$Keep = 2,
    [string]$Subscription
)

$ErrorActionPreference = 'Stop'

if ($Keep -lt 1) { throw "-Keep must be at least 1 (got $Keep)." }
if ($Keep -eq 1) { Write-Warning "-Keep 1 leaves no previous revision to roll back to." }

if ($Subscription) { az account set --subscription $Subscription | Out-Null }

Write-Host ""
Write-Host "=== Revision hygiene: $AppName (rg: $ResourceGroup) ===" -ForegroundColor Cyan

$raw = az containerapp revision list -n $AppName -g $ResourceGroup -o json 2>$null
if (-not $raw) { throw "Could not list revisions for $AppName in $ResourceGroup." }

$active = @($raw | ConvertFrom-Json | Where-Object { $_.properties.active } |
    Select-Object @{n = 'name'; e = { $_.name } },
                  @{n = 'traffic'; e = { [int]$_.properties.trafficWeight } },
                  @{n = 'created'; e = { [datetime]$_.properties.createdTime } })

if ($active.Count -eq 0) { throw "$AppName has no active revisions - refusing to act." }

$serving = @($active | Where-Object { $_.traffic -gt 0 })
if ($serving.Count -eq 0) {
    throw "$AppName has no revision serving traffic - refusing to prune a broken app."
}

# Newest first. Anything serving traffic is retained regardless of age.
$ordered = @($active | Sort-Object created -Descending)
$keepNames = [System.Collections.Generic.HashSet[string]]::new()
foreach ($r in $serving) { [void]$keepNames.Add($r.name) }
foreach ($r in $ordered) {
    if ($keepNames.Count -ge $Keep) { break }
    [void]$keepNames.Add($r.name)
}

$toDeactivate = @($ordered | Where-Object { -not $keepNames.Contains($_.name) })

Write-Host ("  active: {0}   keeping: {1}   deactivating: {2}" -f `
        $active.Count, $keepNames.Count, $toDeactivate.Count)

foreach ($r in $ordered) {
    $mark = if ($keepNames.Contains($r.name)) { 'KEEP  ' } else { 'PRUNE ' }
    $note = if ($r.traffic -gt 0) { " <- serving $($r.traffic)%" } else { '' }
    $color = if ($keepNames.Contains($r.name)) { 'Green' } else { 'DarkYellow' }
    Write-Host ("  {0}{1,-30} {2:yyyy-MM-dd HH:mm}{3}" -f $mark, $r.name, $r.created, $note) -ForegroundColor $color
}

if ($toDeactivate.Count -eq 0) {
    Write-Host "  Nothing to prune." -ForegroundColor Green
    return
}

$failed = @()
foreach ($r in $toDeactivate) {
    if ($PSCmdlet.ShouldProcess($r.name, 'deactivate revision')) {
        $out = az containerapp revision deactivate -n $AppName -g $ResourceGroup --revision $r.name 2>&1
        if ($LASTEXITCODE -ne 0) {
            # Azure's revision list is eventually consistent, so a revision another
            # run just deactivated can still appear active here. Deactivating an
            # already-inactive revision is a no-op, not a failure - treat it as
            # such rather than aborting the whole prune. Seen on calmsand
            # 2026-07-31 when the promotion script's own prune had already run.
            if ("$out" -match 'already|not active|inactive|InvalidRevision') {
                Write-Host "  already inactive: $($r.name)" -ForegroundColor DarkGray
            } else {
                $failed += $r.name
            }
        } else {
            Write-Host "  deactivated $($r.name)" -ForegroundColor DarkGray
        }
    }
}

if ($failed.Count -gt 0) {
    throw "Failed to deactivate: $($failed -join ', ')"
}

# Verify the outcome rather than trusting the command's exit code.
$after = @(az containerapp revision list -n $AppName -g $ResourceGroup -o json | ConvertFrom-Json |
    Where-Object { $_.properties.active })
$stillServing = @($after | Where-Object { [int]$_.properties.trafficWeight -gt 0 })

Write-Host ("  RESULT: {0} active revisions remain, {1} serving traffic." -f $after.Count, $stillServing.Count) -ForegroundColor Cyan
if ($stillServing.Count -eq 0) { throw "POST-CHECK FAILED: nothing is serving traffic on $AppName." }
