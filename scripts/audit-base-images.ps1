<#
.SYNOPSIS
  Fails when any Dockerfile pins a Node base image that is not an Active LTS or
  Maintenance LTS release.

.DESCRIPTION
  Origin: 2026-07-29. The root Dockerfile (the one that actually ships) sat on
  node:25-alpine from 2026-05-01. Node 25 reached end-of-life on 2026-06-01, so
  the deployed image ran an unpatched runtime for ~2 months with no gate firing.
  Two things hid it:

    1. Every OTHER surface (CI workflows, api/package.json engines, api/Dockerfile)
       was already on 24, so spot-checks that looked at the wrong file concluded
       the repo was consistent. The 2026-05-17 security intake did exactly that
       and "resolved" the drift in the wrong direction.
    2. Trivy scans for CVEs in the image, not for the SUPPORT STATUS of the base
       image. An EOL runtime with no CVE filed yet is invisible to it.

  Node's own guidance (https://nodejs.org/en/about/previous-releases):
  "Production applications should only use Active LTS or Maintenance LTS releases."

  Update SUPPORTED_MAJORS below when a line changes status. Dates are from
  https://nodejs.org/en/about/previous-releases and https://endoflife.date/nodejs.
#>
[CmdletBinding()]
param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

# Node majors permitted as a base image, with the date maintenance support ends.
$SUPPORTED_MAJORS = @{
    '22' = @{ Name = 'Jod';     MaintenanceEnds = '2027-04-30' }
    '24' = @{ Name = 'Krypton'; MaintenanceEnds = '2028-04-30' }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$dockerfiles = Get-ChildItem -Path $repoRoot -Filter 'Dockerfile*' -Recurse -File |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\docs\\archive\\' }

$findings = @()
$checked = 0

foreach ($file in $dockerfiles) {
    $relative = $file.FullName.Substring($repoRoot.Length + 1)
    # @() is required: Get-Content returns a scalar string for a single-line
    # file, and indexing that yields characters instead of lines.
    $lines = @(Get-Content -LiteralPath $file.FullName)

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -notmatch '^\s*FROM\s+node:(?<major>\d+)') { continue }

        $checked++
        $major = $Matches['major']

        if (-not $SUPPORTED_MAJORS.ContainsKey($major)) {
            $findings += [pscustomobject]@{
                File    = $relative
                Line    = $i + 1
                Major   = $major
                Text    = $line.Trim()
                Message = "node:$major is not an Active/Maintenance LTS release. Allowed: $(($SUPPORTED_MAJORS.Keys | Sort-Object) -join ', ')."
            }
            continue
        }

        $endsOn = [datetime]::ParseExact($SUPPORTED_MAJORS[$major].MaintenanceEnds, 'yyyy-MM-dd', $null)
        if ((Get-Date) -gt $endsOn) {
            $findings += [pscustomobject]@{
                File    = $relative
                Line    = $i + 1
                Major   = $major
                Text    = $line.Trim()
                Message = "node:$major maintenance ended $($SUPPORTED_MAJORS[$major].MaintenanceEnds). Move to a supported LTS and update SUPPORTED_MAJORS."
            }
        }
    }
}

if (-not $Quiet) {
    Write-Host "Base-image audit: inspected $checked 'FROM node:' line(s) across $($dockerfiles.Count) Dockerfile(s)."
}

if ($findings.Count -gt 0) {
    Write-Host ''
    Write-Host 'FAIL - unsupported Node base image(s) found:' -ForegroundColor Red
    foreach ($f in $findings) {
        Write-Host ("  {0}:{1}  {2}" -f $f.File, $f.Line, $f.Text) -ForegroundColor Red
        Write-Host ("      {0}" -f $f.Message) -ForegroundColor Red
    }
    Write-Host ''
    Write-Host 'Reference: https://nodejs.org/en/about/previous-releases' -ForegroundColor Yellow
    exit 1
}

if (-not $Quiet) {
    Write-Host 'PASS - every Node base image is on an Active/Maintenance LTS line.' -ForegroundColor Green
}
exit 0
