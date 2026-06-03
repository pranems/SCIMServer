<#
.SYNOPSIS
    Mirror SCIMServer prod data into the dev environment, then layer on synthetic
    "shape coverage" fixtures.

.DESCRIPTION
    Two-stage operation:

      Stage 1 (mirror):   src/scripts/mirror-prod-to-dev.ts
                          Copies Endpoints, ScimResource, ResourceMember,
                          EndpointCredential, and the most recent RequestLog
                          rows from PROD_DATABASE_URL to DEV_DATABASE_URL,
                          preserving primary keys exactly.

      Stage 2 (shapes):   src/scripts/seed-shape-coverage.ts
                          Adds ~6 small synthetic endpoints whose combinations
                          of preset / settings / extensions / custom resource
                          types exercise every interesting code path. Also
                          seeds 3 users + 2 groups per endpoint and a sample
                          per-endpoint bearer credential.

    The script can resolve PROD_DATABASE_URL and DEV_DATABASE_URL automatically
    from the Container App secrets, or accept them via env vars / parameters.

    Firewall: when -OpenFirewall is supplied the script adds a temporary
    PostgreSQL Flexible Server firewall rule for the operator's current public
    IP (resolved via api.ipify.org). The rule is removed in the cleanup block
    even if the data copy fails.

.PARAMETER ProdResourceGroup
    Production resource group (default: scimserver-rg).
.PARAMETER ProdAppName
    Production Container App name (default: scimserver2).
.PARAMETER DevResourceGroup
    Dev resource group (default: scimserver-rg-dev).
.PARAMETER DevAppName
    Dev Container App name (default: scimserver-dev).
.PARAMETER ProdDatabaseUrl
    Override the auto-resolved prod connection string.
.PARAMETER DevDatabaseUrl
    Override the auto-resolved dev connection string.
.PARAMETER LogDays
    How many days of RequestLog to copy (default 7). 0 disables log copy.
.PARAMETER LogLimit
    Cap on number of RequestLog rows copied (default 50000).
.PARAMETER SkipMirror
    Skip stage 1 (mirror) - run only the shape-coverage seed.
.PARAMETER SkipShapes
    Skip stage 2 (shape coverage) - run only the prod mirror.
.PARAMETER OpenFirewall
    Temporarily add a PG firewall rule for the operator's public IP on both
    prod and dev PostgreSQL Flexible Servers. Removed on exit.
.PARAMETER DryRun
    Read but do not write. Both stages honour this flag.
.PARAMETER LogFile
    Optional path to write a full transcript of the run (relative paths are
    resolved against the repo root before any directory change). When set, the
    script wraps execution in Start-Transcript / Stop-Transcript so the log is
    written even when intermediate Push-Location calls would otherwise relocate
    the working directory under the orchestrator.
.PARAMETER RestartDevApp
    After both stages complete successfully, restart the active revision of the
    dev Container App. Required to make new endpoints visible via the live API
    because the EndpointService caches the endpoint table in memory at
    onModuleInit() and only refreshes through its own write paths - direct DB
    writes from the mirror are invisible until the cache is rehydrated.

.EXAMPLE
    # Full run, defaults, opens firewall for current IP, removes on exit.
    .\scripts\mirror-prod-to-dev.ps1 -OpenFirewall

.EXAMPLE
    # Full run + auto-restart so the dev API immediately sees mirrored data.
    .\scripts\mirror-prod-to-dev.ps1 -OpenFirewall -RestartDevApp

.EXAMPLE
    # Capture a transcript to logs/ at the repo root (path is auto-resolved).
    .\scripts\mirror-prod-to-dev.ps1 -OpenFirewall -LogFile 'logs/mirror.log'

.EXAMPLE
    # Dry run, see counts only.
    .\scripts\mirror-prod-to-dev.ps1 -OpenFirewall -DryRun

.EXAMPLE
    # Re-seed shapes only (after a manual psql clean-up of synthetic data).
    .\scripts\mirror-prod-to-dev.ps1 -SkipMirror -DevDatabaseUrl $env:DEV_DATABASE_URL

.EXAMPLE
    # Pass connection strings in directly (no Azure auth needed).
    $env:PROD_DATABASE_URL = "postgresql://..."
    $env:DEV_DATABASE_URL  = "postgresql://..."
    .\scripts\mirror-prod-to-dev.ps1
#>
param(
    [string]$ProdResourceGroup = 'scimserver-rg',
    [string]$ProdAppName       = 'scimserver2',
    [string]$DevResourceGroup  = 'scimserver-rg-dev',
    [string]$DevAppName        = 'scimserver-dev',
    [string]$ProdDatabaseUrl,
    [string]$DevDatabaseUrl,
    [int]$LogDays = 7,
    [int]$LogLimit = 50000,
    [switch]$SkipMirror,
    [switch]$SkipShapes,
    [switch]$OpenFirewall,
    [switch]$DryRun,
    [string]$LogFile,
    [switch]$RestartDevApp
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$apiDir   = Join-Path $repoRoot 'api'

# Resolve -LogFile to an ABSOLUTE path BEFORE we Push-Location into $apiDir,
# otherwise a relative path would land under api\ and the Tee/Transcript would
# fail with "Could not find a part of the path" once Push-Location takes effect.
if (-not [string]::IsNullOrWhiteSpace($LogFile)) {
    if (-not [System.IO.Path]::IsPathRooted($LogFile)) {
        $LogFile = Join-Path $repoRoot $LogFile
    }
    $logDir = Split-Path -Parent $LogFile
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Start-Transcript -Path $LogFile -Force | Out-Null
    Write-Host "Transcript -> $LogFile" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Cyan
Write-Host '  SCIMServer prod -> dev mirror + shape-coverage seeder'  -ForegroundColor Cyan
Write-Host '=========================================================' -ForegroundColor Cyan
Write-Host ''

# --- Helpers ---------------------------------------------------------------

function Resolve-DatabaseUrl {
    param(
        [Parameter(Mandatory=$true)] [string]$EnvVar,
        [Parameter(Mandatory=$true)] [string]$ResourceGroup,
        [Parameter(Mandatory=$true)] [string]$AppName,
        [Parameter(Mandatory=$true)] [string]$Label,
        [string]$Override
    )
    if (-not [string]::IsNullOrWhiteSpace($Override)) {
        Write-Host "[$Label] using parameter override" -ForegroundColor DarkGray
        return $Override
    }
    $envValue = [Environment]::GetEnvironmentVariable($EnvVar)
    if (-not [string]::IsNullOrWhiteSpace($envValue)) {
        Write-Host "[$Label] using $EnvVar from environment" -ForegroundColor DarkGray
        return $envValue
    }
    Write-Host "[$Label] resolving DATABASE_URL from Container App '$AppName' in '$ResourceGroup'" -ForegroundColor DarkGray
    # Try the secret first (dev pattern), then fall back to a plain env var on
    # the container template (prod pattern).
    $raw = az containerapp secret show `
        --name $AppName `
        --resource-group $ResourceGroup `
        --secret-name 'database-url' `
        --query 'value' -o tsv 2>$null
    if (-not $raw) {
        $raw = az containerapp show `
            --name $AppName `
            --resource-group $ResourceGroup `
            --query "properties.template.containers[0].env[?name=='DATABASE_URL'].value | [0]" `
            -o tsv 2>$null
        if ($raw) {
            Write-Host "[$Label] using DATABASE_URL from container env (no secret found)" -ForegroundColor DarkGray
        }
    }
    if (-not $raw) {
        throw "[$Label] Could not resolve DATABASE_URL. Pass -${Label}DatabaseUrl, set $EnvVar, or sign into Azure with 'az login'."
    }
    # Some prod templates have the query string URL-encoded twice (e.g. %26 instead
    # of &). libpq does not like %26, so normalize once.
    $normalized = $raw.Trim() -replace '%26', '&'
    return $normalized
}

function Get-PgServerName {
    param([Parameter(Mandatory=$true)] [string]$ConnectionString)
    if ($ConnectionString -match '@([^:]+):') {
        $fqdn = $Matches[1]
        # FQDN format: <serverName>.postgres.database.azure.com
        return ($fqdn -split '\.')[0]
    }
    throw "Could not parse server name from connection string"
}

function Add-PgFirewallRule {
    param(
        [Parameter(Mandatory=$true)] [string]$ResourceGroup,
        [Parameter(Mandatory=$true)] [string]$ServerName,
        [Parameter(Mandatory=$true)] [string]$RuleName,
        [Parameter(Mandatory=$true)] [string]$Ip
    )
    Write-Host "  + adding firewall rule '$RuleName' for $Ip on $ServerName" -ForegroundColor DarkGray
    az postgres flexible-server firewall-rule create `
        --resource-group $ResourceGroup `
        --name $ServerName `
        --rule-name $RuleName `
        --start-ip-address $Ip `
        --end-ip-address $Ip `
        --output none 2>$null | Out-Null
}

function Remove-PgFirewallRule {
    param(
        [Parameter(Mandatory=$true)] [string]$ResourceGroup,
        [Parameter(Mandatory=$true)] [string]$ServerName,
        [Parameter(Mandatory=$true)] [string]$RuleName
    )
    Write-Host "  - removing firewall rule '$RuleName' on $ServerName" -ForegroundColor DarkGray
    az postgres flexible-server firewall-rule delete `
        --resource-group $ResourceGroup `
        --name $ServerName `
        --rule-name $RuleName `
        --yes `
        --output none 2>$null | Out-Null
}

function Get-PublicIp {
    try {
        $ip = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 5).ip
        if ($ip -match '^\d+\.\d+\.\d+\.\d+$') { return $ip }
    } catch { }
    throw "Could not determine current public IP via api.ipify.org. Pass -OpenFirewall:$false and add the rule manually."
}

# --- Resolve connection strings -------------------------------------------

if (-not $SkipMirror) {
    $ProdDatabaseUrl = Resolve-DatabaseUrl `
        -EnvVar 'PROD_DATABASE_URL' `
        -ResourceGroup $ProdResourceGroup `
        -AppName $ProdAppName `
        -Label 'prod' `
        -Override $ProdDatabaseUrl
}
$DevDatabaseUrl = Resolve-DatabaseUrl `
    -EnvVar 'DEV_DATABASE_URL' `
    -ResourceGroup $DevResourceGroup `
    -AppName $DevAppName `
    -Label 'dev' `
    -Override $DevDatabaseUrl

# --- Firewall (optional) ---------------------------------------------------

$rulesAdded = New-Object System.Collections.ArrayList
$ruleName = "mirror-tmp-$([guid]::NewGuid().ToString().Substring(0,8))"

if ($OpenFirewall) {
    $myIp = Get-PublicIp
    Write-Host "Opening PostgreSQL firewall for current public IP $myIp ..." -ForegroundColor Yellow
    if (-not $SkipMirror) {
        $prodServer = Get-PgServerName -ConnectionString $ProdDatabaseUrl
        Add-PgFirewallRule -ResourceGroup $ProdResourceGroup -ServerName $prodServer -RuleName $ruleName -Ip $myIp
        [void]$rulesAdded.Add(@{ Rg = $ProdResourceGroup; Server = $prodServer; Rule = $ruleName })
    }
    $devServer = Get-PgServerName -ConnectionString $DevDatabaseUrl
    Add-PgFirewallRule -ResourceGroup $DevResourceGroup -ServerName $devServer -RuleName $ruleName -Ip $myIp
    [void]$rulesAdded.Add(@{ Rg = $DevResourceGroup; Server = $devServer; Rule = $ruleName })
}

# --- Run TS scripts --------------------------------------------------------

try {
    Push-Location $apiDir
    try {
        if (-not $SkipMirror) {
            Write-Host ''
            Write-Host '----- Stage 1: mirror prod -> dev -----' -ForegroundColor Cyan
            $env:PROD_DATABASE_URL = $ProdDatabaseUrl
            $env:DEV_DATABASE_URL  = $DevDatabaseUrl
            $env:LOG_DAYS  = "$LogDays"
            $env:LOG_LIMIT = "$LogLimit"
            $env:DRY_RUN   = if ($DryRun) { '1' } else { '0' }
            npx ts-node --transpile-only src/scripts/mirror-prod-to-dev.ts
            if ($LASTEXITCODE -ne 0) { throw "Mirror script exited with code $LASTEXITCODE" }
        } else {
            Write-Host 'Stage 1 (mirror): SKIPPED' -ForegroundColor Yellow
        }

        if (-not $SkipShapes) {
            Write-Host ''
            Write-Host '----- Stage 2: shape-coverage seed -----' -ForegroundColor Cyan
            $env:DEV_DATABASE_URL = $DevDatabaseUrl
            $env:DRY_RUN = if ($DryRun) { '1' } else { '0' }
            npx ts-node --transpile-only src/scripts/seed-shape-coverage.ts
            if ($LASTEXITCODE -ne 0) { throw "Seed script exited with code $LASTEXITCODE" }
        } else {
            Write-Host 'Stage 2 (shapes): SKIPPED' -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }

    # ----- Optional: restart dev container app to rehydrate cache -----
    if ($RestartDevApp -and -not $DryRun) {
        Write-Host ''
        Write-Host '----- Stage 3: restart dev container app -----' -ForegroundColor Cyan
        Write-Host 'EndpointService caches the endpoint table at onModuleInit() and only refreshes' -ForegroundColor DarkGray
        Write-Host 'through its own write paths. Direct DB writes from the mirror are invisible to' -ForegroundColor DarkGray
        Write-Host 'the live API until the active revision is restarted.' -ForegroundColor DarkGray
        $activeRevision = az containerapp revision list `
            -n $DevAppName -g $DevResourceGroup `
            --query "[?properties.active].name | [0]" -o tsv 2>$null
        if (-not $activeRevision) {
            Write-Warning "Could not find an active revision for '$DevAppName' in '$DevResourceGroup'; skipping restart."
        } else {
            Write-Host "  restarting revision $activeRevision ..." -ForegroundColor DarkGray
            az containerapp revision restart `
                -n $DevAppName -g $DevResourceGroup `
                --revision $activeRevision -o none 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Restart returned exit code $LASTEXITCODE; the app may still be cycling."
            } else {
                Write-Host "  restart issued (cache will rehydrate from PostgreSQL on next boot)." -ForegroundColor DarkGray
            }
        }
    }

    Write-Host ''
    Write-Host 'DONE.' -ForegroundColor Green
    if (-not $RestartDevApp -and -not $SkipMirror -and -not $DryRun) {
        Write-Host ''
        Write-Host 'NOTE: the dev API will not see new endpoints until the container app is restarted.' -ForegroundColor Yellow
        Write-Host '      Re-run with -RestartDevApp, or run:' -ForegroundColor Yellow
        Write-Host "      az containerapp revision restart -n $DevAppName -g $DevResourceGroup --revision <active>" -ForegroundColor Yellow
    }
}
finally {
    foreach ($r in $rulesAdded) {
        try { Remove-PgFirewallRule -ResourceGroup $r.Rg -ServerName $r.Server -RuleName $r.Rule } catch { Write-Warning $_.Exception.Message }
    }
    # Scrub env vars so secrets don't leak into the parent shell
    $env:PROD_DATABASE_URL = $null
    $env:DEV_DATABASE_URL  = $null
    if (-not [string]::IsNullOrWhiteSpace($LogFile)) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}
