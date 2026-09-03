<#
.SYNOPSIS
    Chooses which Azure Container Apps revisions to retain when pruning.

.DESCRIPTION
    Shared by prune-revisions.ps1 and its self-test so the two cannot disagree,
    the same reason node-lts.ps1 is shared by the base-image gate and the doctor.

    D3 (2026-09-03): retention used to mean "the newest N by creation time".
    That is only equivalent to "serving + a rollback target" while those
    revisions run DIFFERENT images. On the v0.55.18 canary promote an
    interrupted first attempt left an orphan revision carrying the SAME image
    as the one being deployed, so the two newest were both the new version. The
    prune deactivated the only previous-version revision, and the estate was
    left with no way back while every check reported success - the policy
    satisfied to the letter and defeated in purpose.
#>

function Select-RevisionsToKeep {
    <#
    .PARAMETER Revisions
        Objects with: name, traffic (int), created (datetime), image (string).

    .PARAMETER Keep
        The retention budget from the estate registry.

    .OUTPUTS
        The names to retain. Everything else is a prune candidate.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][array]$Revisions,
        [Parameter(Mandatory)][int]$Keep
    )

    $keepNames = [System.Collections.Generic.List[string]]::new()
    if ($Revisions.Count -eq 0) { return @() }

    # Anything serving traffic is retained regardless of age or budget. A prune
    # that can take an app offline is worse than one that overspends.
    $serving = @($Revisions | Where-Object { [int]$_.traffic -gt 0 })
    foreach ($r in $serving) { $keepNames.Add($r.name) }

    # NOTE: when Keep is 1 the budget is already spent here, so every branch
    # below is skipped and behaviour is byte-identical to the pre-D3 selector.
    # That is what keeps customer-prod's declared keep=1 cost policy intact:
    # the fix cannot add an always-on replica to an estate that asked for one.
    $servingImages = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@($serving | ForEach-Object { $_.image } | Where-Object { $_ }),
        [StringComparer]::OrdinalIgnoreCase)

    $candidates = @($Revisions |
        Where-Object { -not $keepNames.Contains($_.name) } |
        Sort-Object created -Descending)

    # Pass 1: prefer a revision running a DIFFERENT image - that is what a
    # rollback target actually is. A same-image spare rolls back to nothing.
    foreach ($r in $candidates) {
        if ($keepNames.Count -ge $Keep) { break }
        if (-not $r.image -or -not $servingImages.Contains($r.image)) {
            $keepNames.Add($r.name)
        }
    }

    # Pass 2: backfill any remaining budget with same-image revisions. Keeping a
    # duplicate spare is not useful, but it is what the estate asked to pay for.
    foreach ($r in $candidates) {
        if ($keepNames.Count -ge $Keep) { break }
        if (-not $keepNames.Contains($r.name)) { $keepNames.Add($r.name) }
    }

    return $keepNames.ToArray()
}
