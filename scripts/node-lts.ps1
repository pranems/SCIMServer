<#
.SYNOPSIS
  Single source of truth for which Node.js majors are supported (Active LTS or
  Maintenance LTS).

.DESCRIPTION
  Dot-sourced by scripts/audit-base-images.ps1 (gates the Dockerfile SOURCE) and
  scripts/audit-deployment-doc.ps1 (gates the DEPLOYED ARTIFACT). Both need the
  same answer to "is this Node major still supported?", so the table lives here
  rather than being duplicated - a second copy is exactly how the two halves
  drift apart.

  Dates from https://nodejs.org/en/about/previous-releases and
  https://endoflife.date/nodejs. Update when a line changes status.

  Node's guidance: "Production applications should only use Active LTS or
  Maintenance LTS releases."
#>

$script:NodeLtsMajors = @{
    '22' = @{ Name = 'Jod';     MaintenanceEnds = '2027-04-30' }
    '24' = @{ Name = 'Krypton'; MaintenanceEnds = '2028-04-30' }
}

function Get-NodeLtsMajors {
    return $script:NodeLtsMajors
}

<#
.SYNOPSIS
  Returns $null when the major is supported, or a human-readable reason string
  when it is not.
#>
function Get-NodeMajorSupportIssue {
    param(
        [Parameter(Mandatory)][string]$Major
    )

    $majors = $script:NodeLtsMajors

    if (-not $majors.ContainsKey($Major)) {
        return "node:$Major is not an Active/Maintenance LTS release. Supported: $(($majors.Keys | Sort-Object) -join ', ')."
    }

    $endsOn = [datetime]::ParseExact($majors[$Major].MaintenanceEnds, 'yyyy-MM-dd', $null)
    if ((Get-Date) -gt $endsOn) {
        return "node:$Major maintenance ended $($majors[$Major].MaintenanceEnds). Move to a supported LTS and update scripts/node-lts.ps1."
    }

    return $null
}
