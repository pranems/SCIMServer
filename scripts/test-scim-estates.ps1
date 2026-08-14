<#
.SYNOPSIS
    Self-test for the estate registry validator.

.DESCRIPTION
    Feeds Test-ScimEstateRegistry deliberately broken registries and asserts
    each check FIRES. This exists because this repository has twice shipped a
    gate that reported PASS on input it was written to reject:
    audit-base-images.ps1 v1 indexed characters instead of lines, and the C1
    change-coverage check compared the working tree against HEAD, which is
    always empty at pre-push. Neither was caught by writing the gate carefully;
    both were caught by watching them fail.

    Also carries a POSITIVE control - the real registry must PASS - so a
    validator that rejects everything is caught too.
#>
[CmdletBinding()] param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scim-estates.ps1')

$real = Join-Path $PSScriptRoot 'scim-estates.json'
$pass = 0
$fail = 0

function Assert-Case {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Mutate,
        [Parameter(Mandatory)][bool]$ExpectValid
    )
    $reg = Get-Content $script:realPath -Raw | ConvertFrom-Json
    & $Mutate $reg
    $tmp = [IO.Path]::GetTempFileName()
    ($reg | ConvertTo-Json -Depth 10) | Set-Content -Path $tmp -Encoding utf8
    try {
        $got = Test-ScimEstateRegistry -Path $tmp -Quiet
        if ($got -eq $ExpectValid) {
            Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green
            $script:passCount++
        }
        else {
            Write-Host ("  FAIL  {0} - expected valid={1}, got {2}" -f $Name, $ExpectValid, $got) -ForegroundColor Red
            $script:failCount++
        }
    }
    finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
}

$script:realPath = $real
$script:passCount = 0
$script:failCount = 0

Write-Host ""
Write-Host "=== estate registry validator self-test ===" -ForegroundColor Cyan

# POSITIVE control - the shipped registry must pass, or every negative below is meaningless.
Assert-Case -Name 'positive control: the real registry is VALID' -ExpectValid $true -Mutate { param($r) }

# R1 - dangling tenant reference
Assert-Case -Name 'R1 fires: estate points at a tenant that does not exist' -ExpectValid $false -Mutate {
    param($r) ($r.estates | Where-Object { $_.id -eq 'dev' }).tenantKey = 'no-such-tenant'
}

# R2 - two tenants sharing a subscription id. This is the real hazard: two
# tenants already share the subscription NAME 'ProvIAM_Subscription'.
Assert-Case -Name 'R2 fires: duplicate subscriptionId across tenants' -ExpectValid $false -Mutate {
    param($r)
    $a = $r.tenants | Where-Object { $_.key -eq 'proviam' }
    $b = $r.tenants | Where-Object { $_.key -eq 'proviam09' }
    $a.subscriptionId = $b.subscriptionId
}

# R3 - duplicate tenant id. This is EXACTLY what the 2026-08-12 bulk find-and-
# replace did to az-tenant.ps1: it rewrote the retiring tenant's ids to the new
# tenant's. No gate caught it then; this one would.
Assert-Case -Name 'R3 fires: duplicate tenantId (the 2026-08-12 bulk-edit defect)' -ExpectValid $false -Mutate {
    param($r)
    $a = $r.tenants | Where-Object { $_.key -eq 'proviam' }
    $b = $r.tenants | Where-Object { $_.key -eq 'proviam09' }
    $a.tenantId = $b.tenantId
}

# R4 - role outside the finite vocabulary
Assert-Case -Name 'R4 fires: unknown role keyword' -ExpectValid $false -Mutate {
    param($r) ($r.tenants | Where-Object { $_.key -eq 'proviam09' }).role = 'sort-of-active'
}

# R5a - no active dev estate (what a half-finished cutover looks like)
Assert-Case -Name 'R5 fires: ZERO active estates for a purpose' -ExpectValid $false -Mutate {
    param($r) ($r.tenants | Where-Object { $_.key -eq 'proviam09' }).role = 'next'
}

# R5b - two active dev estates (what a forgotten cutover looks like)
Assert-Case -Name 'R5 fires: TWO active estates for a purpose' -ExpectValid $false -Mutate {
    param($r) ($r.tenants | Where-Object { $_.key -eq 'proviam' }).role = 'active'
}

# R6 - customer prod must never ride an ephemeral tenant
Assert-Case -Name 'R6 fires: customer-prod on a non-permanent tenant' -ExpectValid $false -Mutate {
    param($r) ($r.tenants | Where-Object { $_.key -eq 'anandsa' }).role = 'active'
}

# R7 - a stored FQDN is the defect the registry exists to remove
Assert-Case -Name 'R7 fires: an FQDN stored in the registry' -ExpectValid $false -Mutate {
    param($r) ($r.estates | Where-Object { $_.id -eq 'dev' }) | Add-Member -NotePropertyName fqdn -NotePropertyValue 'scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io' -Force
}

# ─── R8 - revision retention ──────────────────────────────────────────
# Dropping below 2 deletes an estate's rollback target. That is a legitimate
# trade for a cost-constrained estate but a silent disaster as a typo, so the
# validator insists the exception be declared, justified, and confined to the
# one estate that is never auto-promoted.

Assert-Case -Name 'R8 fires: estate does not declare revisionKeep at all' -ExpectValid $false -Mutate {
    param($r) ($r.estates | Where-Object { $_.id -eq 'dev' }).PSObject.Properties.Remove('revisionKeep')
}

Assert-Case -Name 'R8 fires: revisionKeep below 1 (would prune the serving revision)' -ExpectValid $false -Mutate {
    param($r) ($r.estates | Where-Object { $_.id -eq 'dev' }).revisionKeep = 0
}

Assert-Case -Name 'R8 fires: revisionKeep is not an integer' -ExpectValid $false -Mutate {
    param($r) ($r.estates | Where-Object { $_.id -eq 'dev' }).revisionKeep = 'two'
}

# The typo case: 1 on an estate that IS auto-promoted, where losing the
# rollback target is not a trade anyone chose.
Assert-Case -Name 'R8 fires: keep=1 on a NON customer-prod estate' -ExpectValid $false -Mutate {
    param($r)
    $e = $r.estates | Where-Object { $_.id -eq 'canary-prod' }
    $e.revisionKeep = 1
    $e | Add-Member -NotePropertyName revisionKeepRationale -NotePropertyValue 'cost' -Force
}

# The undocumented case: right estate, no stated reason. An unexplained 1 is
# indistinguishable from a mistake six months later.
Assert-Case -Name 'R8 fires: keep=1 on customer-prod with NO rationale' -ExpectValid $false -Mutate {
    param($r) ($r.estates | Where-Object { $_.id -eq 'customer-prod' }).PSObject.Properties.Remove('revisionKeepRationale')
}

# Positive control for R8: raising customer-prod back to the default must be
# valid WITHOUT a rationale - the rule constrains the exception, not the norm.
# Without this, a validator that simply rejected every customer-prod edit would
# still pass every negative above.
Assert-Case -Name 'R8 positive: customer-prod back at the default 2 needs no rationale' -ExpectValid $true -Mutate {
    param($r)
    $e = $r.estates | Where-Object { $_.id -eq 'customer-prod' }
    $e.revisionKeep = 2
    $e.PSObject.Properties.Remove('revisionKeepRationale')
}

Write-Host ""
Write-Host ("passed {0}, failed {1}" -f $script:passCount, $script:failCount) -ForegroundColor $(if ($script:failCount) { 'Red' } else { 'Green' })
if ($script:failCount -gt 0) { exit 1 }
Write-Host "estate registry validator self-test PASSED" -ForegroundColor Green
