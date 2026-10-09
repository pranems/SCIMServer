<#
.SYNOPSIS
    Authoritative end-to-end dev deployment pipeline for SCIMServer.
    Walks every Mandatory Quality Gate (Stages 0 -> 6), builds + publishes
    the image to ACR + GHCR, deploys to dev preserving DB / endpoints /
    IDs, runs full live SCIM + Playwright UI suites against dev, and
    surfaces a structured report. After dev is green, hands off to the
    operator for explicit prod promotion (NEVER auto-promotes).

.DESCRIPTION
    This script is the runnable implementation of
    [.github/prompts/devDeploymentPipeline.prompt.md](../.github/prompts/devDeploymentPipeline.prompt.md).
    The prompt codifies the WHY + WHAT. This script codifies the HOW.

    Why this exists: the v0.52.3 prod-prep run (2026-05-29) missed
    Playwright entirely, skipped test-all-modes.ps1, skipped the web
    vitest coverage gate, and deferred size-limit failures as
    "pre-existing baseline" instead of fixing them. The standing rules
    in copilot-instructions.md cover the WHAT-to-run; this script
    enforces the order + reports every PASS / FAIL / SKIPPED with a
    reason so no future deploy can quietly skip gates.

    Modes:
      - default (no -Skip*): walk every stage end-to-end. ~25-40 min.
      - -SkipDocker: skip Stage 4.1 (Docker compose live tests). Use
        when Docker daemon isn't available.
      - -SkipPlaywright: skip Stages 5.1-5.5. Use ONLY when web/ wasn't
        touched (predicate auto-detects and prints the override needed).
      - -SkipDeploy: stop after Stage 3c. Use for local-only sanity.
      - -DryRun: print the per-stage plan; do not execute.

.PARAMETER ImageTag
    Image tag to publish + deploy. Defaults to the current git short
    SHA. If a tag is supplied that doesn't match git, the script asks
    for explicit confirmation (use -ConfirmTag for unattended runs).

.PARAMETER RegistryAcr
    ACR login server (default: acrscimsrv09.azurecr.io).

.PARAMETER RegistryGhcr
    GHCR image base (default: ghcr.io/pranems/scimserver).

.PARAMETER DevResourceGroup
    Azure resource group of the dev Container App (default:
    scimserver-dev).

.PARAMETER DevAppName
    Dev Container App name (default: scimserver-dev).

.PARAMETER DevFqdn
    Dev FQDN. Auto-resolved from the Container App if omitted.

.PARAMETER PgImage
    PostgreSQL image for the local Stage 2.2 E2E DB (default:
    postgres:17). Started on :5432 user=scim pass=scim db=scimdb
    if not already running.

.PARAMETER SkipDocker
    Skip Stage 4.1 Docker compose live tests.

.PARAMETER SkipPlaywright
    Skip Stages 5.1-5.5 Playwright UI suite.

.PARAMETER SkipDeploy
    Stop after Stage 3c (no image push, no deploy).

.PARAMETER AutoCanary
    After dev is green, AUTO-promote the same digest to the parallel prod
    (proudbush, app 'scimserver', ProvIAM tenant - same tenant as dev) using a
    TRUE blue/green deploy with full verification (live + Playwright + data/ID
    before-and-after diff). No operator go-ahead is required for THIS canary
    because it is same-tenant and not the customer-facing instance. Guardrails:
    every dev gate must be PASS, ZERO gates SKIPPED, no change-freeze file
    (scripts/.deploy-freeze), and the kill switch env var
    SCIMSERVER_AUTOCANARY_DISABLE must be unset. The customer-facing prod
    (calmsand, separate AnandSa tenant) is NEVER auto-promoted - it always
    needs an explicit operator go-ahead after the canary is green.

.PARAMETER CanaryResourceGroup
    Resource group of the auto-canary prod (default: scimserver-prod / purplecliff).

.PARAMETER CanaryAppName
    Container App name of the auto-canary prod (default: scimserver / purplecliff).

.PARAMETER DryRun
    Print plan only; do not execute.

.PARAMETER ConfirmTag
    Skip the interactive ImageTag-vs-git-SHA mismatch prompt.

.PARAMETER ReportDir
    Directory for the structured Markdown report (default:
    <repo>/test-results).

.EXAMPLE
    .\scripts\dev-deployment-pipeline.ps1
    Full walk: Stages 0 -> 6, build, push, deploy to dev, live tests,
    Playwright, post-deploy verification. Stops at Stage 7 for operator
    confirmation before prod.

.EXAMPLE
    .\scripts\dev-deployment-pipeline.ps1 -DryRun
    Print the per-stage plan + every command that WOULD run.

.EXAMPLE
    .\scripts\dev-deployment-pipeline.ps1 -SkipPlaywright -SkipDocker
    Fast local-only validation (Stages 1, 2, 3) plus image build + push
    + dev deploy. Use when Docker daemon or browser binaries aren't
    available and you've verified the UI manually.

.NOTES
    Exit codes:
      0 - every gate passed; dev deploy complete; ready for prod prompt
      1 - one or more gates failed; report has the full breakdown
      2 - prerequisite check failed (missing tool / az auth / docker)
      3 - operator declined a confirmation prompt
#>

[CmdletBinding()]
param(
    [string]$ImageTag,
    [string]$RegistryAcr = 'acrscimsrv09.azurecr.io',
    [string]$RegistryGhcr = 'ghcr.io/pranems/scimserver',
    [string]$DevResourceGroup = 'scimserver-dev',
    [string]$DevAppName = 'scimserver-dev',
    [string]$DevFqdn,
    [string]$PgImage = 'postgres:17',
    [switch]$SkipDocker,
    [switch]$SkipPlaywright,
    [switch]$SkipDeploy,
    [switch]$AutoCanary,
    [string]$CanaryResourceGroup = 'scimserver-prod',
    [string]$CanaryAppName = 'scimserver',
    [switch]$DryRun,
    [switch]$ConfirmTag,
    [string]$ReportDir
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
. (Join-Path $PSScriptRoot 'github-workflow-run.ps1')
. (Join-Path $PSScriptRoot 'scim-estates.ps1')

if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $repoRoot 'test-results'
}
if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$reportPath = Join-Path $ReportDir "dev-deploy-$timestamp.md"
$script:results = @()
$script:overallStart = Get-Date

# Resolve image tag from git when omitted.
if (-not $ImageTag) {
    $ImageTag = (git rev-parse --short HEAD 2>$null)
    if (-not $ImageTag) {
        Write-Host "Cannot resolve ImageTag from git. Pass -ImageTag explicitly." -ForegroundColor Red
        exit 2
    }
}

function Write-Stage($num, $title) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host " Stage $num : $title" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
}

function Add-Result {
    param(
        [string]$Stage,
        [string]$Gate,
        [ValidateSet('PASS', 'FAIL', 'SKIPPED', 'PARTIAL', 'PENDING')]
        [string]$Status,
        [string]$Detail = '',
        [int]$DurationSec = 0
    )
    $script:results += [pscustomobject]@{
        Stage    = $Stage
        Gate     = $Gate
        Status   = $Status
        Detail   = $Detail
        Duration = $DurationSec
    }
    $color = switch ($Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'SKIPPED' { 'DarkGray' }
        'PARTIAL' { 'Yellow' }
        default { 'White' }
    }
    Write-Host "  [$Status] $Gate $(if ($Detail) { "- $Detail" }) ($DurationSec s)" -ForegroundColor $color
}

function Invoke-Gate {
    param(
        [string]$Stage,
        [string]$Gate,
        [scriptblock]$Command,
        [string]$WorkDir = $repoRoot
    )
    if ($DryRun) {
        Write-Host "  [DRY-RUN] $Stage $Gate -> $Command" -ForegroundColor DarkGray
        Add-Result -Stage $Stage -Gate $Gate -Status 'PENDING' -Detail 'dry-run'
        return $true
    }
    $start = Get-Date
    Push-Location $WorkDir
    try {
        $output = & $Command 2>&1
        $exit = $LASTEXITCODE
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        if ($exit -eq 0 -or $null -eq $exit) {
            Add-Result -Stage $Stage -Gate $Gate -Status 'PASS' -DurationSec $elapsed
            return $true
        } else {
            $tail = ($output | Select-Object -Last 3) -join ' | '
            Add-Result -Stage $Stage -Gate $Gate -Status 'FAIL' -Detail "exit=$exit; tail=$tail" -DurationSec $elapsed
            return $false
        }
    } catch {
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        Add-Result -Stage $Stage -Gate $Gate -Status 'FAIL' -Detail $_.Exception.Message -DurationSec $elapsed
        return $false
    } finally {
        Pop-Location
    }
}

function Test-PrereqOrExit {
    $missing = @()
    foreach ($cmd in @('git', 'npm', 'node', 'docker', 'az', 'gh')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            $missing += $cmd
        }
    }
    if ($missing.Count -gt 0) {
        Write-Host "Missing prerequisites: $($missing -join ', ')" -ForegroundColor Red
        exit 2
    }
    # docker daemon up?
    docker version --format '{{.Server.Version}}' > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker daemon not reachable. Start Docker Desktop." -ForegroundColor Red
        exit 2
    }
    # az logged in?
    az account show --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "az CLI not authenticated. Run: az login" -ForegroundColor Red
        exit 2
    }
}

function Assert-OwnedPostgresContainer {
    param(
        [Parameter(Mandatory)] [string]$ContainerId,
        [Parameter(Mandatory)] [string]$RunId
    )

    $owner = (docker inspect --format '{{ index .Config.Labels "scimserver.owner" }}' $ContainerId 2>$null)
    if ($LASTEXITCODE -ne 0 -or $owner -ne 'dev-deployment-pipeline') {
        throw "PostgreSQL container '$ContainerId' is not owned by dev-deployment-pipeline."
    }

    $actualRunId = (docker inspect --format '{{ index .Config.Labels "scimserver.run" }}' $ContainerId 2>$null)
    if ($LASTEXITCODE -ne 0 -or $actualRunId -ne $RunId) {
        throw "PostgreSQL container '$ContainerId' does not belong to run '$RunId'."
    }
}

function Get-RemoteImageDigest {
    param([Parameter(Mandatory)] [string]$Reference)

    $inspection = docker buildx imagetools inspect $Reference 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $match = [regex]::Match(($inspection -join "`n"), '(?m)^Digest:\s+(sha256:[0-9a-f]{64})$')
    if (-not $match.Success) { return $null }
    return $match.Groups[1].Value
}

# =============================================================================
# Stage 0 - Pre-flight + state capture
# =============================================================================
Write-Stage 0 'Pre-flight + state capture'
Test-PrereqOrExit

$gitSha = (git rev-parse --short HEAD).Trim()
$gitBranch = (git rev-parse --abbrev-ref HEAD).Trim()
$dirty = (git status --porcelain | Where-Object { $_ -notmatch '^\?\?' }).Count -gt 0

if ($ImageTag -ne $gitSha -and -not $ConfirmTag) {
    Write-Host "ImageTag '$ImageTag' does not match git HEAD '$gitSha'." -ForegroundColor Yellow
    $reply = Read-Host "Continue with $ImageTag? (yes/no)"
    if ($reply -ne 'yes') { exit 3 }
}

if (-not $DevFqdn) {
    if ($DryRun) {
        $DevFqdn = 'scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io'
    } else {
        $DevFqdn = az containerapp show -n $DevAppName -g $DevResourceGroup --query 'properties.configuration.ingress.fqdn' -o tsv 2>$null
    }
}

# An EXPIRED tenant does not error - ARM just returns nothing, and the run then
# builds "https:///scim/..." and fails somewhere unrelated. Fail here instead,
# naming the actual cause.
if (-not $DryRun -and -not $DevFqdn) {
    $activeTenant = (az account show --query tenantId -o tsv 2>$null)
    throw "Could not resolve the dev FQDN for $DevAppName/$DevResourceGroup. " +
          "The az session reports tenant '$activeTenant'. If that is not the CURRENT ephemeral tenant, " +
          "the subscription has expired and every ARM lookup returns empty. " +
          "Run: . ./scripts/az-tenant.ps1; Use-ProvIAM09"
}

Add-Result -Stage '0.1' -Gate 'Prerequisites + git/az/docker auth' -Status 'PASS' -Detail "SHA=$gitSha branch=$gitBranch dirty=$dirty"

# Capture before-deploy state of dev
$beforePath = Join-Path $ReportDir "dev-before-$gitSha.json"
if (-not $DryRun) {
    try {
        $tok = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/oauth/token" -Method Post -Body '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"changeme-oauth"}' -ContentType 'application/json' -TimeoutSec 15).access_token
        $eps = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/admin/endpoints?count=200" -Headers @{Authorization = "Bearer $tok"} -TimeoutSec 30).endpoints
        $beforeState = @{
            timestamp = (Get-Date).ToString('o')
            devFqdn = $DevFqdn
            currentImage = (az containerapp show -n $DevAppName -g $DevResourceGroup --query 'properties.template.containers[0].image' -o tsv 2>$null)
            endpoints = @($eps | ForEach-Object { @{ id = $_.id; name = $_.name; preset = $_.profilePreset } })
            endpointCount = $eps.Count
        }
        $beforeState | ConvertTo-Json -Depth 6 | Out-File -FilePath $beforePath -Encoding utf8
        Add-Result -Stage '0.6' -Gate 'Capture dev before-state' -Status 'PASS' -Detail "$($eps.Count) endpoints; saved to $beforePath"
    } catch {
        Add-Result -Stage '0.6' -Gate 'Capture dev before-state' -Status 'FAIL' -Detail $_.Exception.Message
    }
} else {
    Add-Result -Stage '0.6' -Gate 'Capture dev before-state' -Status 'PENDING' -Detail 'dry-run'
}

# =============================================================================
# Stage 1 - Local static gates
# =============================================================================
Write-Stage 1 'Local static gates'
Invoke-Gate '1.1' 'API tsc build' { npm run build } 'api' | Out-Null
Invoke-Gate '1.2' 'API ESLint (0 errors)' {
    $out = npm run lint 2>&1
    $errLine = ($out | Select-String -Pattern '(\d+)\s+errors?,\s+(\d+)\s+warnings?' | Select-Object -First 1).Line
    if ($errLine -match '(\d+)\s+errors?') {
        $errCount = [int]$Matches[1]
        if ($errCount -gt 0) { $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
    }
    $out | Select-Object -Last 5
} 'api' | Out-Null

Invoke-Gate '1.3' 'Web tsc --noEmit (baseline-or-better)' {
    $out = npx tsc --noEmit 2>&1
    $errCount = ($out | Select-String -Pattern 'error TS').Count
    $prodErrors = ($out | Select-String -Pattern 'error TS' | Where-Object { $_ -notmatch '\.spec\.|\.test\.|__tests__|e2e' }).Count
    Write-Host "  total=$errCount prod=$prodErrors (baseline total=96 prod=9)"
    if ($prodErrors -gt 9 -or $errCount -gt 96) { $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
} 'web' | Out-Null

Invoke-Gate '1.5' 'Web prod build' { npm run build } 'web' | Out-Null
Invoke-Gate '1.6' 'Web size-limit budgets' { npm run size } 'web' | Out-Null

# 1.9 - the schema and its migrations must move together. A schema.prisma edit
# with no accompanying migration deploys code that expects columns the database
# does not have, and the failure surfaces at container start, not here.
Invoke-Gate '1.9' 'prismaMigrationAudit (schema/migration lockstep)' {
    $base = (git rev-parse --abbrev-ref '@{upstream}' 2>$null)
    if (-not $base) { $base = 'origin/master' }
    $schemaChanged = @(git diff --name-only "$base..HEAD" -- api/prisma/schema.prisma).Count -gt 0
    $migrationsChanged = @(git diff --name-only "$base..HEAD" -- api/prisma/migrations/).Count -gt 0
    Write-Host "    schema changed=$schemaChanged  migrations changed=$migrationsChanged (vs $base)" -ForegroundColor DarkGray
    if ($schemaChanged -and -not $migrationsChanged) {
        throw 'schema.prisma changed with no migration added - generate one before deploying'
    }
} | Out-Null

# 1.10 - a base image can be free of known CVEs and still be unsupported. Trivy
# scans for vulnerabilities, never for end-of-life status.
Invoke-Gate '1.10' 'Base images on an Active/Maintenance LTS line' {
    pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'audit-base-images.ps1')
} | Out-Null

# 1.11 - the canonical infrastructure record must still match the infrastructure.
Invoke-Gate '1.11' 'Deployment infra doc current' {
    pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'audit-deployment-doc.ps1')
} | Out-Null

# 1.12 - the user-facing documentation must still describe what we are about to
# deploy. Runs in currency-only mode here (no diff to couple against at deploy
# time); the coupling half (F4) is enforced at pre-push and on pull requests.
Invoke-Gate '1.12' 'Docs freshness (user-facing set)' {
    pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'audit-doc-freshness.ps1') -SkipCoupling -Quiet
} | Out-Null

# 1.13 - the docs must not merely be fresh, they must be TRUE. Counts, settings,
# routes and reason codes are compared against the source they describe.
Invoke-Gate '1.13' 'Docs content matches source' {
    node (Join-Path $PSScriptRoot 'audit-doc-content.mjs')
} | Out-Null

# =============================================================================
# Stage 2 - Local test gates
# =============================================================================
Write-Stage 2 'Local test gates'

$savedDatabaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
$postgresRunId = [guid]::NewGuid().ToString('N')
$postgresContainerName = "scim-dev-pipeline-pg-$($postgresRunId.Substring(0, 12))"
$postgresContainerId = $null
$postgresReady = $DryRun

if (-not $DryRun) {
    try {
        $postgresContainerId = (
            docker run -d `
                --name $postgresContainerName `
                --label 'scimserver.owner=dev-deployment-pipeline' `
                --label "scimserver.run=$postgresRunId" `
                --publish 127.0.0.1::5432 `
                --mount type=tmpfs,destination=/var/lib/postgresql/data `
                --env POSTGRES_USER=scim `
                --env POSTGRES_PASSWORD=scim `
                --env POSTGRES_DB=scimdb `
                $PgImage
        ).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresContainerId)) {
            throw 'Could not start the task-owned PostgreSQL container.'
        }

        Assert-OwnedPostgresContainer -ContainerId $postgresContainerId -RunId $postgresRunId
        $publishedPort = (docker port $postgresContainerId 5432/tcp 2>$null)
        if ($LASTEXITCODE -ne 0 -or $publishedPort -notmatch '^127\.0\.0\.1:(\d+)$') {
            throw "Could not resolve the loopback PostgreSQL port for '$postgresContainerId'."
        }

        $postgresPort = [int]$Matches[1]
        $env:DATABASE_URL = '{0}://{1}:{2}@{3}:{4}/{5}?schema=public' -f `
            'postgresql', 'scim', 'scim', '127.0.0.1', $postgresPort, 'scimdb'

        $postgresReady = $false
        for ($attempt = 1; $attempt -le 30; $attempt++) {
            docker exec $postgresContainerId pg_isready -U scim -d scimdb > $null 2>&1
            if ($LASTEXITCODE -eq 0) {
                $postgresReady = $true
                break
            }
            Start-Sleep -Seconds 1
        }
        if (-not $postgresReady) {
            throw "Task-owned PostgreSQL container '$postgresContainerId' did not become ready."
        }

        Add-Result -Stage '2.0' -Gate 'Task-owned PostgreSQL prerequisite' -Status 'PASS' `
            -Detail "container=$($postgresContainerId.Substring(0, 12)) port=$postgresPort tmpfs=true"
    }
    catch {
        Add-Result -Stage '2.0' -Gate 'Task-owned PostgreSQL prerequisite' -Status 'FAIL' `
            -Detail $_.Exception.Message
    }
}

try {
    if ($postgresReady) {
        Invoke-Gate '2.1' 'API unit jest (3,816 baseline)' { Remove-Item Env:\PERSISTENCE_BACKEND -ErrorAction SilentlyContinue; npm test } 'api' | Out-Null
        Invoke-Gate '2.2' 'API E2E jest (1,217 baseline, prisma)' { npm run test:e2e } 'api' | Out-Null
        Invoke-Gate '2.3' 'Web vitest (1,006 baseline)' { npm test } 'web' | Out-Null
        Invoke-Gate '2.4' 'Web vitest coverage (lines:78 / branches:70 / functions:65 / statements:75 ratchet)' { npm run test:coverage } 'web' | Out-Null
        Invoke-Gate '2.6' 'test-all-modes.ps1 (6-mode matrix)' { pwsh -NoProfile -File scripts/test-all-modes.ps1 } | Out-Null
    }
    else {
        foreach ($gate in @(
            @{ Stage = '2.1'; Name = 'API unit jest (3,816 baseline)' },
            @{ Stage = '2.2'; Name = 'API E2E jest (1,217 baseline, prisma)' },
            @{ Stage = '2.3'; Name = 'Web vitest (1,006 baseline)' },
            @{ Stage = '2.4'; Name = 'Web vitest coverage (lines:78 / branches:70 / functions:65 / statements:75 ratchet)' },
            @{ Stage = '2.6'; Name = 'test-all-modes.ps1 (6-mode matrix)' }
        )) {
            Add-Result -Stage $gate.Stage -Gate $gate.Name -Status 'SKIPPED' `
                -Detail 'task-owned PostgreSQL prerequisite failed'
        }
    }
}
finally {
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $savedDatabaseUrl, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($postgresContainerId)) {
        try {
            Assert-OwnedPostgresContainer -ContainerId $postgresContainerId -RunId $postgresRunId
            docker rm -f $postgresContainerId > $null 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "Could not remove task-owned PostgreSQL container '$postgresContainerId'."
            }

            docker inspect $postgresContainerId > $null 2>&1
            if ($LASTEXITCODE -eq 0) {
                throw "The exact owned PostgreSQL container was not removed: '$postgresContainerId'."
            }
            Add-Result -Stage '2.7' -Gate 'Task-owned PostgreSQL exact cleanup' -Status 'PASS' `
                -Detail "removed=$($postgresContainerId.Substring(0, 12))"
        }
        catch {
            Add-Result -Stage '2.7' -Gate 'Task-owned PostgreSQL exact cleanup' -Status 'FAIL' `
                -Detail $_.Exception.Message
        }
    }
}

# =============================================================================
# Stage 3 - Audits. The mechanically-checkable ones RUN here; only the ones
# that genuinely need an LLM reviewer stay PENDING. Recording an executable
# check as PENDING is indistinguishable from having no check at all.
# =============================================================================
Write-Stage 3 'Audits (executable gates run; reviewer prompts recorded)'

Invoke-Gate '3b.3' 'endpointConfigFlagAudit (registry vs Settings UI, both directions)' {
    # Two gates, deliberately separate. Conformance asks "does the UI offer a key
    # the server does not know?"; ui-coverage asks the reverse, "is every
    # registered flag reachable by an operator?". Eleven flags had drifted into
    # the second state - enforced by the server, invisible in the UI - because
    # only the first direction was ever checked.
    npx jest --silent --testPathPatterns 'endpoint-config-(conformance|ui-coverage)'
} 'api' | Out-Null

Invoke-Gate '3b.5' 'dependencyCveSweep (production deps + .trivyignore freshness)' {
    Push-Location (Join-Path $PSScriptRoot '..' 'api')
    try {
        $audit = npm audit --omit=dev --json 2>$null | ConvertFrom-Json
        $crit = [int]$audit.metadata.vulnerabilities.critical
        $high = [int]$audit.metadata.vulnerabilities.high
        Write-Host "    api production deps: critical=$crit high=$high" -ForegroundColor DarkGray
        if ($crit -gt 0) { throw "$crit CRITICAL vulnerability(ies) in production dependencies" }
        # HIGH findings are permitted ONLY while an audited .trivyignore entry
        # covers them; the staleness checker is what keeps that honest.
        npx ts-node src/scripts/check-trivyignore.ts | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'stale or malformed .trivyignore entry' }
    } finally { Pop-Location }
} | Out-Null

$auditPrompts = @(
    @{ Stage = '3a.1'; Gate = 'addMissingTests prompt' },
    @{ Stage = '3a.2'; Gate = 'apiContractVerification prompt' },
    @{ Stage = '3a.3'; Gate = 'error-handling-verification prompt' },
    @{ Stage = '3b.1'; Gate = 'logging-verification prompt' },
    @{ Stage = '3b.2'; Gate = 'auditAgainstRFC prompt' },
    @{ Stage = '3b.4'; Gate = 'securityAudit prompt' },
    @{ Stage = '3b.6'; Gate = 'performanceBenchmark prompt' },
    @{ Stage = '3c.1'; Gate = 'codeReviewSelfAudit prompt' },
    @{ Stage = '3c.2'; Gate = 'auditAndUpdateDocs prompt (narrative half; the mechanical half is 1.11-1.13)' }
)
foreach ($p in $auditPrompts) {
    Add-Result -Stage $p.Stage -Gate $p.Gate -Status 'PENDING' -Detail 'reviewer-judgement gate; invoke via Copilot Chat with #prompt:<name> and record the outcome here'
}

if ($SkipDeploy) {
    Write-Host "" -ForegroundColor Yellow
    Write-Host "-SkipDeploy set; stopping after Stage 3. Writing report..." -ForegroundColor Yellow
}

# =============================================================================
# Stage 4 - Build, publish, deploy
# =============================================================================
if (-not $SkipDeploy) {
    Write-Stage 4 'Build, publish, deploy'

    if (-not $SkipDocker) {
        Invoke-Gate '4.1' 'Docker compose build + live tests' { pwsh -NoProfile -File scripts/full-validation-pipeline.ps1 -SkipLocal } | Out-Null
    } else {
        Add-Result -Stage '4.1' -Gate 'Docker compose build + live tests' -Status 'SKIPPED' -Detail '-SkipDocker'
    }

    # 4.2 - Mirror the LOCAL image into ACR.
    #
    # This is now an OPTIONAL convenience mirror, not the deploy path. Since
    # 2026-07-29 the deployable artifact is imported from GHCR (gate 4.5), so a
    # local Docker failure must not fail the run or - worse - leave the deploy
    # pointing at a tag that was never pushed. If the local build did not produce
    # an image, skip with a reason rather than reporting a FAIL for a step that
    # no longer gates anything.
    $composeImageId = docker compose images -q api 2>$null | Select-Object -First 1
    $localImagePresent = $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($composeImageId)
    $localImageId = if ($localImagePresent) {
        (docker image inspect $composeImageId --format '{{.Id}}' 2>$null).Trim()
    } else { $null     }
    $localImagePresent = $localImagePresent -and $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($localImageId)
    if ($localImagePresent) {
        Invoke-Gate '4.2a' "ACR login ($RegistryAcr)" { az acr login --name ($RegistryAcr -replace '\.azurecr\.io$', '') } | Out-Null
        $localMirrorTag = "local-$ImageTag"
        Invoke-Gate '4.2b' "Mirror local image -> $RegistryAcr/scimserver:$localMirrorTag" {
            $target = "$RegistryAcr/scimserver:$localMirrorTag"
            docker tag $localImageId $target
            if ($LASTEXITCODE -ne 0) { throw "docker tag failed for image $localImageId -> $target" }
            $taggedImageId = (docker image inspect $target --format '{{.Id}}' 2>$null).Trim()
            if ($LASTEXITCODE -ne 0 -or $taggedImageId -ne $localImageId) {
                throw "Local mirror tag identity mismatch for $target (expected $localImageId, got $taggedImageId)"
            }
            docker push $target
            if ($LASTEXITCODE -ne 0) { throw "docker push failed for $target" }
        } | Out-Null
    } else {
        Add-Result -Stage '4.2a' -Gate "ACR login ($RegistryAcr)"                          -Status 'SKIPPED' -Detail 'no local image (Docker build did not run or failed); deploy uses the GHCR import path'
        Add-Result -Stage '4.2b' -Gate "Mirror local image -> $RegistryAcr/scimserver:local-tag"  -Status 'SKIPPED' -Detail 'no local image; not on the deploy critical path since 2026-07-29'
    }

    # 4.3 - GHCR push via CI workflow (uses GITHUB_TOKEN; no local PAT needed)
    $pkgJsonPath = Join-Path $repoRoot 'api/package.json'
    $version = (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).version

    # A SHIPPING TAG IS ALWAYS BUILT FROM MASTER (operator rule, 2026-08-25).
    # Merge first, build second: an image built from an unmerged ref can ship
    # code that is not on master, and `:latest` would then point at it.
    # The 2026-05-29 lesson was the mirror image of this - the workflow defaulted
    # to master while the work sat on a feature branch, shipping a STALE image.
    # Both failures are the same root cause: the built ref and the shipped ref
    # disagreed. Asserting HEAD is contained in master removes the disagreement
    # instead of trading one direction of it for the other.
    $publishRef = 'master'
    $shippingRefReady = Invoke-Gate '4.3a' 'HEAD is merged into origin/master (shipping ref check)' {
        git fetch origin master --quiet
        $head = (git rev-parse HEAD).Trim()
        git merge-base --is-ancestor $head origin/master
        if ($LASTEXITCODE -ne 0) {
            throw "HEAD ($($head.Substring(0,8))) is NOT contained in origin/master. Merge before publishing - a shipping image must be built from master."
        }
        Write-Host "    HEAD $($head.Substring(0,8)) is contained in origin/master" -ForegroundColor DarkGray
    }

    $firstParent = (git rev-parse 'HEAD^1').Trim()
    $previousPackage = (git show "${firstParent}:api/package.json" | ConvertFrom-Json)
    $previousVersion = [string]$previousPackage.version
    $runtimeInputPaths = @(
        'Dockerfile',
        'api/package.json',
        'api/package-lock.json',
        'api/src',
        'api/prisma',
        'api/docker-entrypoint.sh',
        'web/package.json',
        'web/package-lock.json',
        'web/src',
        'web/public',
        'web/vite.config.ts',
        'web/index.html'
    )
    $runtimeInputsChanged = @(git diff --name-only "${firstParent}..HEAD" -- $runtimeInputPaths).Count -gt 0
    $runtimeSourceCommit = (git log --first-parent -1 --format=%H -- $runtimeInputPaths).Trim()
    $releaseSourceValid = Invoke-Gate '4.3b' 'Runtime image inputs require a version bump' {
        if ($runtimeInputsChanged -and $version -eq $previousVersion) {
            throw "Runtime image inputs changed without a version bump (still $version)."
        }
        Write-Host "    version $previousVersion -> $version; runtimeInputsChanged=$runtimeInputsChanged" -ForegroundColor DarkGray
    }

    $existingVersionDigest = Get-RemoteImageDigest -Reference "${RegistryGhcr}:$version"

    $releaseArtifactReady = $shippingRefReady -and $releaseSourceValid
    if (-not $releaseArtifactReady) {
        Add-Result -Stage '4.3' -Gate "GHCR publish v$version + latest" -Status 'SKIPPED' `
            -Detail 'shipping ref or version/runtime-source contract failed'
    } elseif ($existingVersionDigest) {
        Add-Result -Stage '4.3' -Gate "GHCR publish v$version + latest" -Status 'PASS' `
            -Detail "semantic version tag already exists; reusing immutable artifact $existingVersionDigest"
    } else {
        $releaseArtifactReady = Invoke-Gate '4.3' "GHCR publish v$version + latest (publish-ghcr.yml @ $publishRef)" {
            $expectedHeadSha = (git rev-parse $publishRef).Trim()
            $dispatchedAfter = [DateTimeOffset]::UtcNow.AddSeconds(-5)
            gh workflow run publish-ghcr.yml --ref $publishRef -f version=$version -f pushLatest=true
            if ($LASTEXITCODE -ne 0) {
                throw 'Failed to dispatch publish-ghcr.yml.'
            }

            $selectedRun = $null
            for ($attempt = 1; $attempt -le 15 -and $null -eq $selectedRun; $attempt++) {
                $runJson = gh run list --workflow=publish-ghcr.yml --branch $publishRef --event workflow_dispatch --limit 20 --json databaseId,headSha,createdAt,status,conclusion
                if ($LASTEXITCODE -eq 0) {
                    $runs = @(ConvertFrom-GithubCliJson -InputObject $runJson)
                    $selectedRun = Select-GithubWorkflowRun -Runs $runs -ExpectedHeadSha $expectedHeadSha -DispatchedAfter $dispatchedAfter
                }
                if ($null -eq $selectedRun) {
                    Start-Sleep -Seconds 2
                }
            }
            if ($null -eq $selectedRun) {
                throw "Could not find the dispatched publish run for master SHA $expectedHeadSha."
            }
            Write-Host "    Watching workflow run $($selectedRun.databaseId) for $($expectedHeadSha.Substring(0,8))" -ForegroundColor DarkGray
            gh run watch $selectedRun.databaseId --exit-status
        }
    }

    $sourceShaDigest = Get-RemoteImageDigest -Reference "${RegistryGhcr}:sha-$runtimeSourceCommit"
    $existingVersionDigest = Get-RemoteImageDigest -Reference "${RegistryGhcr}:$version"
    $script:verifiedGhcrDigest = $null
    if ($releaseArtifactReady) {
        $releaseArtifactReady = Invoke-Gate '4.3c' 'Semantic tag matches runtime source SHA digest' {
            if (-not $sourceShaDigest) {
                throw "Missing source SHA tag ${RegistryGhcr}:sha-$runtimeSourceCommit."
            }
            if (-not $existingVersionDigest) {
                throw "Missing semantic tag ${RegistryGhcr}:$version."
            }
            if ($existingVersionDigest -ne $sourceShaDigest) {
                throw "Semantic tag digest $existingVersionDigest does not match runtime source SHA digest $sourceShaDigest."
            }
            $script:verifiedGhcrDigest = $sourceShaDigest
            Write-Host "    runtime source $($runtimeSourceCommit.Substring(0,8)) -> $sourceShaDigest" -ForegroundColor DarkGray
        }
    } else {
        Add-Result -Stage '4.3c' -Gate 'Semantic tag matches runtime source SHA digest' -Status 'SKIPPED' `
            -Detail 'release artifact is not ready'
    }
    $verifiedGhcrDigest = $script:verifiedGhcrDigest

    # 4.4 - Verify anonymous GHCR pull
    if ($releaseArtifactReady) {
      $releaseArtifactReady = Invoke-Gate '4.4' "Anonymous pull $RegistryGhcr:latest" {
        docker logout ghcr.io 2>&1 | Out-Null
        docker rmi "${RegistryGhcr}:$version" -f 2>&1 | Out-Null
        docker rmi "${RegistryGhcr}:latest" -f 2>&1 | Out-Null
        docker pull "${RegistryGhcr}:$version"
        if ($LASTEXITCODE -ne 0) { throw "Could not pull ${RegistryGhcr}:$version" }
        docker pull "${RegistryGhcr}:latest"
        if ($LASTEXITCODE -ne 0) { throw "Could not pull ${RegistryGhcr}:latest" }
        docker pull "${RegistryGhcr}:sha-$runtimeSourceCommit"
        if ($LASTEXITCODE -ne 0) { throw "Could not pull ${RegistryGhcr}:sha-$runtimeSourceCommit" }
        $versionDigest = ((docker image inspect "${RegistryGhcr}:$version" --format '{{index .RepoDigests 0}}').Trim() -split '@')[-1]
        $latestDigest = ((docker image inspect "${RegistryGhcr}:latest" --format '{{index .RepoDigests 0}}').Trim() -split '@')[-1]
        $sourceDigest = ((docker image inspect "${RegistryGhcr}:sha-$runtimeSourceCommit" --format '{{index .RepoDigests 0}}').Trim() -split '@')[-1]
        if (
            $versionDigest -ne $verifiedGhcrDigest -or
            $latestDigest -ne $verifiedGhcrDigest -or
            $sourceDigest -ne $verifiedGhcrDigest
        ) {
            throw "GHCR digest mismatch: verified=$verifiedGhcrDigest version=$versionDigest latest=$latestDigest source=$sourceDigest"
        }
        Write-Host "    version/latest/source tags match $verifiedGhcrDigest" -ForegroundColor DarkGray
      }
    } else {
        Add-Result -Stage '4.4' -Gate "Anonymous pull $RegistryGhcr:latest" -Status 'SKIPPED' `
            -Detail 'release artifact is not ready'
    }

    # 4.5 - Import the CI-BUILT image from GHCR into ACR.
    #
    # Deploying a LOCALLY built image is fragile. On 2026-07-29 the local Docker
    # build failed (`npm error Exit handler never called!` inside `npm ci`) while
    # GitHub Actions built the SAME commit perfectly. The push then failed, and
    # the deploy still ran - pointing dev at a tag that had never been pushed and
    # leaving a Failed revision behind. Importing the artifact CI already
    # published is both more robust AND more correct: dev runs exactly the bits
    # GHCR serves, so local Docker is no longer on the deployment critical path.
    $acrName = $RegistryAcr.Split('.')[0]
    if ($releaseArtifactReady) {
        $releaseArtifactReady = Invoke-Gate '4.5' "Import ${RegistryGhcr}:$version -> ACR version + latest" {
            az acr import --name $acrName --source "${RegistryGhcr}@${verifiedGhcrDigest}" --image "scimserver:${version}" --force
            if ($LASTEXITCODE -ne 0) { throw "Could not import ACR version tag from ${RegistryGhcr}@${verifiedGhcrDigest}." }
            az acr import --name $acrName --source "${RegistryGhcr}@${verifiedGhcrDigest}" --image 'scimserver:latest' --force
            if ($LASTEXITCODE -ne 0) { throw "Could not import ACR latest tag from ${RegistryGhcr}@${verifiedGhcrDigest}." }
        }
    } else {
        Add-Result -Stage '4.5' -Gate "Import ${RegistryGhcr}:$version -> ACR version + latest" -Status 'SKIPPED' `
            -Detail 'release artifact is not ready'
    }

    # 4.5b - Both ACR shipping tags must exist, and both must identify the exact
    # GHCR artifact. A mutable tag that points at a local rebuild is not the same
    # artifact even when package versions and compiled output happen to match.
    $acrTags = @(az acr repository show-tags --name $acrName --repository scimserver -o tsv 2>$null)
    $tagPresent = $releaseArtifactReady -and ($acrTags -contains $version) -and ($acrTags -contains 'latest')
    if ($tagPresent) {
        Add-Result -Stage '4.5b' -Gate 'Deployable image tags exist in ACR' -Status 'PASS' -Detail "scimserver:$version, scimserver:latest"
    } else {
        Add-Result -Stage '4.5b' -Gate 'Deployable image tags exist in ACR' -Status 'FAIL' -Detail "version or latest missing in ACR - refusing to deploy"
    }

    $script:digestParity = $false
    if ($tagPresent) {
        Invoke-Gate '4.5c' 'GHCR and ACR version/latest digest parity' {
            $ghcrDigest = $verifiedGhcrDigest
            $acrVersionDigest = (az acr manifest show-metadata --registry $acrName --name "scimserver:$version" --query digest -o tsv 2>$null).Trim()
            $acrLatestDigest = (az acr manifest show-metadata --registry $acrName --name 'scimserver:latest' --query digest -o tsv 2>$null).Trim()
            if ($ghcrDigest -ne $acrVersionDigest -or $ghcrDigest -ne $acrLatestDigest) {
                throw "Registry digest mismatch: GHCR=$ghcrDigest ACR-version=$acrVersionDigest ACR-latest=$acrLatestDigest"
            }
            $script:digestParity = $true
            Write-Host "    all shipping tags resolve to $ghcrDigest" -ForegroundColor DarkGray
        } | Out-Null
    }

    if (-not $tagPresent -or -not $script:digestParity) {
        # Abort the deploy chain rather than breaking a working dev instance.
        Add-Result -Stage '4.6'  -Gate "Deploy to $DevAppName"           -Status 'SKIPPED' -Detail 'ACR tag presence or digest parity failed'
        Add-Result -Stage '4.6b' -Gate 'Dev revision serving new image'  -Status 'SKIPPED' -Detail 'deploy skipped'
        Add-Result -Stage '4.7'  -Gate 'Live SCIM tests vs dev'          -Status 'SKIPPED' -Detail 'deploy skipped - running these would validate the OLD image'
    }
    else {
        # 4.6 - Deploy to dev. Revision suffix carries the COMMIT so the running
        # revision traces back to source; the image carries the VERSION.
        # Azure rejects a revision suffix containing '.', so a dotted semver has
        # to be dashed. Anything else non-alphanumeric is dashed too, and
        # repeated dashes collapse because '--' is also rejected.
        $revisionSuffix = 'v' + (($ImageTag -replace '[^a-zA-Z0-9]', '-') -replace '-+', '-').Trim('-').ToLower()

        # Deploy the GHCR image, not the ACR mirror. The dev app carries NO
        # registry credentials (`properties.configuration.registries` is empty)
        # and pulls GHCR anonymously; pointing it at ACR fails the pull with
        # UNAUTHORIZED. ACR stays a mirror, not the deploy path.
        $deployImage = "$RegistryGhcr@$verifiedGhcrDigest"
        Invoke-Gate '4.6' "Deploy $deployImage to $DevAppName" {
            az containerapp update --name $DevAppName --resource-group $DevResourceGroup --image $deployImage --revision-suffix $revisionSuffix --output none
        } | Out-Null

        # 4.6b - Confirm the exact intended revision is ready and serving.
        #
        # Version alone is not an identity. A same-version redeploy can answer
        # from the old revision while ingress is switching. If OAuth uses an
        # ephemeral key, a token minted on old then presented to new fails its
        # signature even though both report the same semantic version.
        $expectedRevision = "$DevAppName--$revisionSuffix"
        Write-Host "  Waiting for exact dev revision $expectedRevision at 100%..." -ForegroundColor Yellow
        $maxWait = 36
        $devReady = $false
        $reported = '(no response)'
        $consecutiveReadyChecks = 0
        for ($i = 1; $i -le $maxWait; $i++) {
            Start-Sleep -Seconds 5
            try {
                $appStateJson = az containerapp show -n $DevAppName -g $DevResourceGroup `
                    --query 'properties.{latestRevisionName:latestRevisionName,latestReadyRevisionName:latestReadyRevisionName}' -o json 2>$null
                $revisionStateJson = az containerapp revision list -n $DevAppName -g $DevResourceGroup `
                    --query "[?name=='$expectedRevision'] | [0].{healthState:properties.healthState,replicas:properties.replicas,trafficWeight:properties.trafficWeight}" -o json 2>$null
                $appState = $appStateJson | ConvertFrom-Json
                $revisionState = $revisionStateJson | ConvertFrom-Json
                $controlPlaneReady = (
                    $appState.latestRevisionName -eq $expectedRevision -and
                    $appState.latestReadyRevisionName -eq $expectedRevision -and
                    $revisionState.healthState -eq 'Healthy' -and
                    [int]$revisionState.replicas -ge 1 -and
                    [int]$revisionState.trafficWeight -eq 100
                )
                if (-not $controlPlaneReady) {
                    $consecutiveReadyChecks = 0
                    continue
                }

                $tok = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/oauth/token" -Method Post -Body '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"changeme-oauth"}' -ContentType 'application/json' -TimeoutSec 15).access_token
                $v = Invoke-RestMethod -Uri "https://$DevFqdn/scim/admin/version" -Headers @{Authorization = "Bearer $tok"} -TimeoutSec 15
                $reported = $v.version
                if ($reported -eq $version) {
                    $consecutiveReadyChecks++
                    if ($consecutiveReadyChecks -ge 2) {
                        $devReady = $true
                        break
                    }
                }
                else {
                    $consecutiveReadyChecks = 0
                }
            } catch {
                $consecutiveReadyChecks = 0
            }
        }
        if ($devReady) {
            Add-Result -Stage '4.6b' -Gate 'Dev revision serving new image' -Status 'PASS' `
                -Detail "$expectedRevision healthy at 100%; two authenticated probes report $version"
        } else {
            Add-Result -Stage '4.6b' -Gate 'Dev revision serving new image' -Status 'FAIL' `
                -Detail "expected $expectedRevision at 100% with version $version; last report=$reported after $($maxWait * 5)s"
        }

        # 4.7 - Live SCIM tests vs dev.
        #
        # GATED ON 4.6b. Previously this ran unconditionally, so when the deploy
        # silently failed the suite exercised the PREVIOUS image and reported
        # PASS - a false green that made a broken deploy look validated. A gate
        # that validates the wrong artifact is worse than no gate, so if dev is
        # not provably serving the new build we SKIP with a reason instead.
        if ($devReady) {
            Invoke-Gate '4.7' 'Live SCIM tests vs dev' { pwsh -NoProfile -File scripts/live-test.ps1 -BaseUrl "https://$DevFqdn" -ClientSecret 'changeme-oauth' } | Out-Null
        } else {
            Add-Result -Stage '4.7' -Gate 'Live SCIM tests vs dev' -Status 'SKIPPED' -Detail "dev is NOT serving $version - running these would validate the old image and report a false PASS"
        }
    }
}

# =============================================================================
# Stage 5 - UI gates
# =============================================================================
if (-not $SkipDeploy -and -not $SkipPlaywright) {
    Write-Stage 5 'UI gates'

    Invoke-Gate '5.3' 'Playwright vs dev' {
        $env:E2E_BASE_URL = "https://$DevFqdn"
        $env:E2E_TOKEN = 'changeme-scim'
        # The create/delete wizard specs are gated behind this so they never run
        # against a customer-facing estate. Dev is ours and every spec cleans up
        # after itself, so enable them here - otherwise the primary
        # endpoint-creation flow has no browser coverage at all.
        $env:E2E_ALLOW_MUTATIONS = '1'
        $previousPlaywrightJsonOutput = [Environment]::GetEnvironmentVariable(
            'PLAYWRIGHT_JSON_OUTPUT_FILE',
            'Process'
        )
        try {
            $env:PLAYWRIGHT_JSON_OUTPUT_FILE = Join-Path $ReportDir "playwright-dev-$timestamp.json"
            npx playwright test --reporter=line,json
        }
        finally {
            [Environment]::SetEnvironmentVariable(
                'PLAYWRIGHT_JSON_OUTPUT_FILE',
                $previousPlaywrightJsonOutput,
                'Process'
            )
        }
    } 'web' | Out-Null
} elseif ($SkipPlaywright) {
    Add-Result -Stage '5.3' -Gate 'Playwright vs dev' -Status 'SKIPPED' -Detail '-SkipPlaywright'
}

# =============================================================================
# Stage 6 - Post-deploy state diff + report
# =============================================================================
if (-not $SkipDeploy) {
    Write-Stage 6 'Post-deploy state diff'

    $afterPath = Join-Path $ReportDir "dev-after-$gitSha-$ImageTag.json"
    if (-not $DryRun) {
        try {
            $tok = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/oauth/token" -Method Post -Body '{"grant_type":"client_credentials","client_id":"scimserver-client","client_secret":"changeme-oauth"}' -ContentType 'application/json' -TimeoutSec 15).access_token
            $eps = (Invoke-RestMethod -Uri "https://$DevFqdn/scim/admin/endpoints?count=200" -Headers @{Authorization = "Bearer $tok"} -TimeoutSec 30).endpoints
            $afterState = @{
                timestamp = (Get-Date).ToString('o')
                devFqdn = $DevFqdn
                currentImage = (az containerapp show -n $DevAppName -g $DevResourceGroup --query 'properties.template.containers[0].image' -o tsv 2>$null)
                endpoints = @($eps | ForEach-Object { @{ id = $_.id; name = $_.name; preset = $_.profilePreset } })
                endpointCount = $eps.Count
            }
            $afterState | ConvertTo-Json -Depth 6 | Out-File -FilePath $afterPath -Encoding utf8

            $before = Get-Content $beforePath -Raw | ConvertFrom-Json
            $delta = $afterState.endpointCount - $before.endpointCount
            $idsBefore = @($before.endpoints | ForEach-Object { $_.id })
            $idsAfter = @($afterState.endpoints | ForEach-Object { $_.id })
            $missingIds = $idsBefore | Where-Object { $idsAfter -notcontains $_ }
            $newIds = $idsAfter | Where-Object { $idsBefore -notcontains $_ }
            if ($delta -eq 0 -and $missingIds.Count -eq 0) {
                Add-Result -Stage '6.1' -Gate 'Data integrity (endpoint count + ID stability)' -Status 'PASS' -Detail "$($before.endpointCount) -> $($afterState.endpointCount); 0 missing IDs"
            } else {
                Add-Result -Stage '6.1' -Gate 'Data integrity (endpoint count + ID stability)' -Status 'FAIL' -Detail "delta=$delta; missingIds=$($missingIds -join ',') newIds=$($newIds -join ',')"
            }
        } catch {
            Add-Result -Stage '6.1' -Gate 'Data integrity check' -Status 'FAIL' -Detail $_.Exception.Message
        }
    }

    # ─── Stage 6.2 - Revision hygiene (standing norm since 2026-07-31) ───
    # Old revisions stay ACTIVE at 0% traffic and each still runs a replica
    # holding a Prisma connection pool. Measured on proudbush 2026-07-31: 13
    # active revisions, 12 idle, 65 connections of demand against a
    # max_connections of 50. Reclaim it on every deploy rather than waiting
    # for the database to be the thing that notices.
    #
    # Retention comes from scripts/scim-estates.json per estate, not from a
    # literal here, so this stage cannot drift away from promote-to-prod.ps1.
    if (-not $DryRun) {
        try {
            $devKeep = Get-ScimEstateRevisionKeep -AppName $DevAppName -ResourceGroup $DevResourceGroup
            & (Join-Path $PSScriptRoot 'prune-revisions.ps1') -ResourceGroup $DevResourceGroup -AppName $DevAppName -Keep $devKeep
            Add-Result -Stage '6.2' -Gate "Revision hygiene (keep newest $devKeep active)" -Status 'PASS' -Detail 'stale revisions deactivated'
        } catch {
            Add-Result -Stage '6.2' -Gate 'Revision hygiene' -Status 'FAIL' -Detail $_.Exception.Message
        }
    }
}

# =============================================================================
# Stage 6.5 - Auto-canary to parallel prod (proudbush, same tenant)
# =============================================================================
# Guarded auto-promotion to the same-tenant parallel prod (proudbush). The
# customer-facing prod (calmsand, separate AnandSa tenant) is NEVER touched
# here - it requires an explicit operator go-ahead after this canary is green.
if ($AutoCanary -and -not $SkipDeploy) {
    Write-Stage '6.5' 'Auto-canary to parallel prod (proudbush)'

    # Interim gate tally (PENDING operator-prompt gates do not block the canary).
    $interimFail = ($script:results | Where-Object { $_.Status -eq 'FAIL' }).Count
    $interimSkip = ($script:results | Where-Object { $_.Status -eq 'SKIPPED' }).Count
    $freezeFile = Join-Path $repoRoot 'scripts/.deploy-freeze'

    $blocked = $false
    if ($interimFail -gt 0) {
        Add-Result -Stage '6.5' -Gate 'Auto-canary precondition: zero FAIL' -Status 'SKIPPED' -Detail "$interimFail failing gate(s) - canary blocked"
        $blocked = $true
    }
    if ($interimSkip -gt 0) {
        Add-Result -Stage '6.5' -Gate 'Auto-canary precondition: zero SKIPPED' -Status 'SKIPPED' -Detail "$interimSkip skipped gate(s) - canary requires a full clean run"
        $blocked = $true
    }
    if (Test-Path $freezeFile) {
        Add-Result -Stage '6.5' -Gate 'Auto-canary precondition: no change-freeze' -Status 'SKIPPED' -Detail "change-freeze file present ($freezeFile)"
        $blocked = $true
    }
    if ($env:SCIMSERVER_AUTOCANARY_DISABLE) {
        Add-Result -Stage '6.5' -Gate 'Auto-canary precondition: kill switch off' -Status 'SKIPPED' -Detail 'SCIMSERVER_AUTOCANARY_DISABLE is set'
        $blocked = $true
    }

    if ($blocked) {
        Write-Host "  Auto-canary BLOCKED by a precondition - falling back to manual prompt." -ForegroundColor Yellow
    } elseif ($DryRun) {
        Add-Result -Stage '6.5' -Gate 'Auto-canary blue/green to proudbush' -Status 'PENDING' -Detail 'dry-run'
    } else {
        # Resolve canary FQDN + capture the BEFORE inventory from live blue.
        $canaryFqdn = az containerapp show -n $CanaryAppName -g $CanaryResourceGroup --query 'properties.configuration.ingress.fqdn' -o tsv 2>$null
        $verifyScript = Join-Path $repoRoot 'scripts/verify-deployment.ps1'
        $beforeSnap = Join-Path $ReportDir "inventory-$CanaryAppName-before.json"

        if ($canaryFqdn -and (Test-Path $verifyScript)) {
            Write-Host "  Capturing proudbush before-snapshot from live blue..." -ForegroundColor Yellow
            & pwsh -NoProfile -File $verifyScript -BaseUrl "https://$canaryFqdn" -ClientSecret 'changeme-oauth' -Label "$CanaryAppName-before" -SnapshotOnly
        }

        # TRUE blue/green promote with full verification (live + Playwright +
        # data/ID before-after diff). promote-to-prod.ps1 handles the 0% green
        # soak, the verify-on-green, the flip, and auto-rollback on any failure.
        $promoteScript = Join-Path $repoRoot 'scripts/promote-to-prod.ps1'
        $canaryEstate = Get-ScimEstate -Purpose 'canary-prod'
        Write-Host "  Auto blue/green promote proudbush ($CanaryAppName/$CanaryResourceGroup) @ $version..." -ForegroundColor Yellow

        # promote-to-prod.ps1 prompts for 'yes'; feed it non-interactively.
        $promoteOut = 'yes' | & pwsh -NoProfile -File $promoteScript `
            -ProdResourceGroup $CanaryResourceGroup `
            -ProdAppName $CanaryAppName `
            -ImageTag $version `
            -Subscription $canaryEstate.Tenant.subscriptionId `
            -BlueGreen -RunVerification -VerifyPlaywright 2>&1
        $promoteExit = $LASTEXITCODE
        $promoteOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

        if ($promoteExit -eq 0) {
            Add-Result -Stage '6.5' -Gate 'Auto-canary blue/green to proudbush (verified)' -Status 'PASS' -Detail "$CanaryAppName @ $version flipped + verified"
        } else {
            Add-Result -Stage '6.5' -Gate 'Auto-canary blue/green to proudbush' -Status 'FAIL' -Detail "promote-to-prod exit=$promoteExit (green rolled back; customers stayed on blue)"
        }
    }
} elseif (-not $AutoCanary) {
    Add-Result -Stage '6.5' -Gate 'Auto-canary to parallel prod' -Status 'SKIPPED' -Detail '-AutoCanary not set (manual prod promotion path)'
}

# =============================================================================
# Stage 7 - Operator handoff
# =============================================================================
Write-Stage 7 'Operator handoff'

$overallElapsed = [int]((Get-Date) - $script:overallStart).TotalSeconds
$passCount = ($script:results | Where-Object { $_.Status -eq 'PASS' }).Count
$failCount = ($script:results | Where-Object { $_.Status -eq 'FAIL' }).Count
$skipCount = ($script:results | Where-Object { $_.Status -eq 'SKIPPED' }).Count
$pendCount = ($script:results | Where-Object { $_.Status -eq 'PENDING' }).Count

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " PIPELINE SUMMARY ($overallElapsed s, $($script:results.Count) gates)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  PASS:    $passCount" -ForegroundColor Green
Write-Host "  FAIL:    $failCount" -ForegroundColor $(if ($failCount -gt 0) { 'Red' } else { 'DarkGray' })
Write-Host "  SKIPPED: $skipCount" -ForegroundColor DarkGray
Write-Host "  PENDING: $pendCount (operator prompt gates)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Report: $reportPath" -ForegroundColor Cyan
Write-Host ""

# Write structured Markdown report
$reportLines = @()
$reportLines += "# Dev Deployment Pipeline Run"
$reportLines += ""
$reportLines += "- **Commit:** $gitSha ($gitBranch)"
$reportLines += "- **Started:** $($script:overallStart.ToString('o'))"
$reportLines += "- **Duration:** $overallElapsed s"
$reportLines += "- **Image:** ${RegistryAcr}/scimserver:${ImageTag} (+ ${RegistryGhcr}:${ImageTag})"
$reportLines += "- **Dev FQDN:** $DevFqdn"
$reportLines += ""
$reportLines += "## Gate Results"
$reportLines += ""
$reportLines += "| Stage | Gate | Status | Detail | Duration (s) |"
$reportLines += "|---|---|---|---|---|"
foreach ($r in $script:results) {
    $detail = $r.Detail -replace '\|', '\|' -replace '`', '\`'
    if ($detail.Length -gt 120) { $detail = $detail.Substring(0, 120) + '...' }
    $reportLines += "| $($r.Stage) | $($r.Gate) | $($r.Status) | $detail | $($r.Duration) |"
}
$reportLines += ""
$reportLines += "## Summary"
$reportLines += ""
$reportLines += "- PASS: $passCount"
$reportLines += "- FAIL: $failCount"
$reportLines += "- SKIPPED: $skipCount"
$reportLines += "- PENDING (operator prompts): $pendCount"
$reportLines += ""
if ($failCount -eq 0 -and -not $SkipDeploy) {
    $reportLines += "## Next step"
    $reportLines += ""
    $canaryDone = ($script:results | Where-Object { $_.Stage -eq '6.5' -and $_.Status -eq 'PASS' }).Count -gt 0
    if ($canaryDone) {
        $reportLines += '> Dev green + parallel prod (proudbush) auto-canary blue/green verified.'
        $reportLines += '> The customer-facing prod (calmsand, separate AnandSa tenant) is NOT promoted automatically.'
        $reportLines += '> To promote calmsand, get explicit operator go-ahead, then:'
        $reportLines += '> ```'
        $reportLines += '> az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950'
        $reportLines += '> az account set --subscription AnandSa-Test-150'
        $reportLines += '> pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-rg-prod -ProdAppName scimserver-prod -ImageTag ' + $version + ' -Subscription AnandSa-Test-150 -BlueGreen -RunVerification -VerifyPlaywright'
        $reportLines += '> ```'
    } else {
        $reportLines += '> Dev is green. Parallel prod (proudbush) blue/green promote (image swap; prod DB / endpoints / IDs preserved):'
        $reportLines += '> `pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-prod -ProdAppName scimserver -ImageTag ' + $version + ' -BlueGreen -RunVerification -VerifyPlaywright`'
        $reportLines += ''
        $reportLines += '> Then, with explicit operator go-ahead, promote calmsand (separate AnandSa tenant):'
        $reportLines += '> `az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950; az account set --subscription AnandSa-Test-150`'
        $reportLines += '> `pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-rg-prod -ProdAppName scimserver-prod -ImageTag ' + $version + ' -Subscription AnandSa-Test-150 -BlueGreen -RunVerification -VerifyPlaywright`'
    }
    $reportLines += ""
    $reportLines += 'After every promote: verify-deployment.ps1 runs live + Playwright + data/ID diff automatically.'
}
$reportLines | Out-File -FilePath $reportPath -Encoding utf8

if ($failCount -gt 0) {
    Write-Host "FAILURES present. See report. Do NOT proceed to prod." -ForegroundColor Red
    exit 1
}

if (-not $SkipDeploy) {
    Write-Host "Dev is green." -ForegroundColor Green
    Write-Host "Next: review the report, then run promote-to-prod.ps1 ONLY with explicit operator approval." -ForegroundColor Cyan
}

exit 0
