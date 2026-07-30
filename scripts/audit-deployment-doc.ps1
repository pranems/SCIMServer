<#
.SYNOPSIS
  Keeps docs/DEPLOYMENT_INFRASTRUCTURE_AND_FORM_FACTORS.md true. Fails when the
  infrastructure changed but the canonical infra doc did not, when the doc has
  gone stale, when an infra element exists that the doc never mentions, or
  (with -Live) when a running estate contradicts what the doc claims.

.DESCRIPTION
  Origin: 2026-07-29. The doc is the single canonical answer to "what do we run,
  where, and how". A reference doc that is not mechanically tied to the thing it
  describes rots silently - and a confidently wrong infra doc is worse than none,
  because it terminates investigations in the wrong place (exactly how the
  2026-05-17 audit "resolved" the Node drift against the wrong Dockerfile).

  Four checks:

    C1  Change coverage  - infra files changed => the doc must change too.
    C2  Freshness        - the doc's "Last verified" date must be within -MaxAgeDays.
    C3  Element coverage - every Dockerfile*, docker-compose*.yml and infra/*.bicep
                           must be named in the doc (or listed in the doc's own
                           archived/dead register).
    C4  Live truth       - (-Live) every reachable estate must run a supported
                           Node LTS, and its reported version is compared against
                           the doc's recorded table.

  C4 closes the deployed-artifact half of the Node-LTS rule: audit-base-images.ps1
  gates the SOURCE Dockerfile, this gates what is ACTUALLY RUNNING. The 2026-07-29
  escape was invisible to CVE scanning precisely because it was a support-status
  problem, and it survived in production because nothing checked the live runtime.

.EXAMPLE
  pwsh scripts/audit-deployment-doc.ps1
  pwsh scripts/audit-deployment-doc.ps1 -Live
  pwsh scripts/audit-deployment-doc.ps1 -BaseRef origin/master
#>
[CmdletBinding()]
param(
    [string]$BaseRef = 'HEAD',
    [switch]$Live,
    [int]$MaxAgeDays = 90,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/node-lts.ps1"

$repoRoot = Split-Path -Parent $PSScriptRoot
$docRel   = 'docs/DEPLOYMENT_INFRASTRUCTURE_AND_FORM_FACTORS.md'
$docPath  = Join-Path $repoRoot $docRel

$failures = @()
$notes    = @()

function Write-Section([string]$text) {
    if (-not $Quiet) { Write-Host "`n$text" -ForegroundColor Cyan }
}

if (-not (Test-Path $docPath)) {
    Write-Host "FAIL - canonical infra doc missing: $docRel" -ForegroundColor Red
    exit 1
}

$docText = Get-Content -LiteralPath $docPath -Raw

# Paths whose change implies the infra doc must be revisited.
$infraPatterns = @(
    '^Dockerfile',
    '^docker-compose.*\.ya?ml$',
    '^dev-containerapp\.ya?ml$',
    '^prod-app-template\.json$',
    '^infra/',
    '^\.github/workflows/',
    '^api/docker-entrypoint\.sh$',
    '^scripts/(deploy-azure|promote-to-prod|dev-deployment-pipeline|verify-deployment|build-standalone|audit-base-images)\.ps1$'
)

# ---------------------------------------------------------------- C1
Write-Section '[C1] infra change coverage'
Push-Location $repoRoot
try {
    # Uncommitted work (staged + unstaged + untracked). This is what a manual or
    # pre-commit run sees.
    $changed = @(git diff --name-only HEAD 2>$null) +
               @(git ls-files --others --exclude-standard 2>$null)

    # Committed work. At pre-push time the tree is clean, so comparing against
    # HEAD alone would make C1 structurally incapable of ever firing - pass the
    # upstream ref (or any base) to compare the commits actually being shipped.
    if ($BaseRef -and $BaseRef -ne 'HEAD') {
        $changed += @(git diff --name-only "$BaseRef...HEAD" 2>$null)
    }

    $changed = $changed | Where-Object { $_ } | Sort-Object -Unique
} finally {
    Pop-Location
}

$infraChanged = $changed | Where-Object {
    $f = $_
    $infraPatterns | Where-Object { $f -match $_ }
}
$docChanged = $changed -contains $docRel

if (-not $Quiet) {
    Write-Host ("  changed files: {0}   infra-relevant: {1}   doc updated: {2}" -f $changed.Count, @($infraChanged).Count, $docChanged)
}

if (@($infraChanged).Count -gt 0 -and -not $docChanged) {
    $failures += "C1: infra files changed but $docRel was not updated:`n" +
                 (($infraChanged | ForEach-Object { "        $_" }) -join "`n")
} elseif (@($infraChanged).Count -gt 0) {
    $notes += "C1: $(@($infraChanged).Count) infra file(s) changed and the doc was updated alongside."
}

# ---------------------------------------------------------------- C2
Write-Section '[C2] doc freshness'
if ($docText -match '\*\*Last verified:\*\*\s*(\d{4}-\d{2}-\d{2})') {
    $lastVerified = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null)
    $age = [int][math]::Floor(((Get-Date).Date - $lastVerified).TotalDays)
    if (-not $Quiet) { Write-Host "  last verified $($Matches[1]) ($age day(s) ago, budget $MaxAgeDays)" }
    if ($age -gt $MaxAgeDays) {
        $failures += "C2: doc last verified $($Matches[1]) - $age days old, budget is $MaxAgeDays. Re-run the Section 12 capture recipes and refresh the measured tables."
    }
} else {
    $failures += "C2: doc header has no machine-readable '**Last verified:** YYYY-MM-DD' field."
}

# ---------------------------------------------------------------- C3
Write-Section '[C3] infra element coverage'
# git-based enumeration: a Get-ChildItem -Recurse over the repo root walks
# node_modules (22.7s vs 0.08s) and surfaces vendored Dockerfiles that are not
# ours. --others catches a brand-new element before it is committed.
Push-Location $repoRoot
try {
    $elements = @(git ls-files --cached --others --exclude-standard) |
        Where-Object {
            $_ -notmatch '(^|/)docs/archive/' -and (
                $_ -match '(^|/)Dockerfile[^/]*$' -or
                $_ -match '(^|/)docker-compose[^/]*\.ya?ml$' -or
                $_ -match '^infra/.*\.bicep$'
            )
        } | Sort-Object -Unique
} finally {
    Pop-Location
}

$missing = @()
foreach ($e in $elements) {
    $name = Split-Path $e -Leaf
    if ($docText -notmatch [regex]::Escape($name)) { $missing += $name }
}
if (-not $Quiet) { Write-Host "  infra elements on disk: $(@($elements).Count)   undocumented: $($missing.Count)" }
if ($missing.Count -gt 0) {
    $failures += "C3: infra element(s) exist but are never named in the doc:`n" +
                 (($missing | Sort-Object -Unique | ForEach-Object { "        $_" }) -join "`n")
}

# ---------------------------------------------------------------- C4
if ($Live) {
    Write-Section '[C4] live estate truth'
    $estates = @(
        @{ Name = 'dev';            Url = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io' }
        @{ Name = 'prod (canary)';  Url = 'https://scimserver.proudbush-ae90986e.eastus.azurecontainerapps.io' }
        @{ Name = 'prod (customer)';Url = 'https://scimserver-prod.calmsand-7f4fc5dc.centralus.azurecontainerapps.io' }
    )
    $token = if ($env:E2E_TOKEN) { $env:E2E_TOKEN } else { 'changeme-scim' }

    foreach ($e in $estates) {
        try {
            $r = Invoke-RestMethod -Uri "$($e.Url)/scim/admin/version" `
                                   -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 20
            $nodeRaw = [string]$r.runtime.node
            $major   = ($nodeRaw -replace '^v', '') -split '\.' | Select-Object -First 1
            $issue   = Get-NodeMajorSupportIssue -Major $major

            if (-not $Quiet) {
                Write-Host ("  {0,-16} version={1,-16} node={2}" -f $e.Name, $r.version, $nodeRaw)
            }
            if ($issue) {
                $failures += "C4: estate '$($e.Name)' is running $nodeRaw - $issue"
            }
            if ($docText -notmatch [regex]::Escape([string]$r.version)) {
                $notes += "C4: estate '$($e.Name)' reports version $($r.version), which the doc does not mention - refresh Section 4."
            }
        } catch {
            $notes += "C4: estate '$($e.Name)' not reachable ($($_.Exception.Message.Split([Environment]::NewLine)[0])) - skipped, not failed."
        }
    }
}

# ---------------------------------------------------------------- report
Write-Host ''
foreach ($n in $notes) { Write-Host "NOTE  $n" -ForegroundColor Yellow }

if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host 'FAIL - deployment doc audit' -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  $f" -ForegroundColor Red }
    Write-Host ''
    Write-Host "Fix: update $docRel (measured facts, Section 10 drift register, Section 15 change log)" -ForegroundColor Yellow
    Write-Host "     and bump its '**Last verified:**' date." -ForegroundColor Yellow
    exit 1
}

if (-not $Quiet) {
    Write-Host ''
    Write-Host 'PASS - deployment infra doc is current and complete.' -ForegroundColor Green
}
exit 0
