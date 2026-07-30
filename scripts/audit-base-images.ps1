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

# Shared with scripts/audit-deployment-doc.ps1, which applies the same rule to the
# DEPLOYED artifact. Keep the LTS table in one place.
. "$PSScriptRoot/node-lts.ps1"

$repoRoot = Split-Path -Parent $PSScriptRoot

# Enumerate via git rather than Get-ChildItem -Recurse. A naive recurse walks
# node_modules: measured 22.7s vs 0.08s, and it surfaces 4 vendored Dockerfiles
# that are not ours. git also respects .gitignore for free. --others picks up a
# brand-new Dockerfile that has not been committed yet.
Push-Location $repoRoot
try {
    $dockerfiles = @(git ls-files --cached --others --exclude-standard) |
        Where-Object { $_ -match '(^|/)Dockerfile[^/]*$' -and $_ -notmatch '(^|/)docs/archive/' } |
        Sort-Object -Unique
} finally {
    Pop-Location
}

$findings = @()
$checked = 0

foreach ($relative in $dockerfiles) {
    # @() is required: Get-Content returns a scalar string for a single-line
    # file, and indexing that yields characters instead of lines.
    $lines = @(Get-Content -LiteralPath (Join-Path $repoRoot $relative))

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -notmatch '^\s*FROM\s+node:(?<major>\d+)') { continue }

        $checked++
        $major = $Matches['major']

        $issue = Get-NodeMajorSupportIssue -Major $major
        if ($issue) {
            $findings += [pscustomobject]@{
                File    = $relative
                Line    = $i + 1
                Major   = $major
                Text    = $line.Trim()
                Message = $issue
            }
        }
    }
}

if (-not $Quiet) {
    Write-Host "Base-image audit: inspected $checked 'FROM node:' line(s) across $(@($dockerfiles).Count) Dockerfile(s)."
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
