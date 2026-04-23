param(
    [string]$ResourceGroup,
    [string]$AppName,
    [string]$Location,
    [string]$ScimSecret,
    [string]$ImageTag,
    [string]$JwtSecret,
    [string]$OauthClientSecret,
    [string]$GhcrUsername,
    [string]$GhcrPassword,
    # PostgreSQL: provide an existing connection string OR let the script provision a new Flexible Server
    [string]$DatabaseUrl,
    [switch]$ProvisionPostgres,
    [string]$PgAdminPassword,
    # Optional: deploy PostgreSQL to a different region (some subscriptions restrict PG in eastus)
    [string]$PgLocation
)

if (-not $Location -or $Location -eq '') { $Location = 'eastus' }
# PgLocation defaults to same as Location but can be overridden per-region quota restrictions
if (-not $PgLocation -or $PgLocation -eq '') { $PgLocation = $Location }
$requiredProviders = @('Microsoft.App','Microsoft.ContainerService')
$script:DeploymentTranscriptStarted = $false
$script:DeploymentLogFile = $null
$script:DeploymentStatePath = $null
$script:DeploymentState = $null

function Start-DeploymentLogging {
    try {
        $logDir = Join-Path $PSScriptRoot 'logs'
        if (-not (Test-Path $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $script:DeploymentLogFile = Join-Path $logDir "deploy-azure-$timestamp.log"
        Start-Transcript -Path $script:DeploymentLogFile -IncludeInvocationHeader -Force | Out-Null
        $script:DeploymentTranscriptStarted = $true
        Write-Host "📝 Deployment run log: $script:DeploymentLogFile" -ForegroundColor DarkGray
    } catch {
        Write-Host "⚠️ Could not start transcript logging: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Stop-DeploymentLogging {
    if ($script:DeploymentTranscriptStarted) {
        try {
            Stop-Transcript | Out-Null
        } catch {
            # Best effort only
        }
        $script:DeploymentTranscriptStarted = $false
    }
}

function Stop-Deployment {
    param(
        [string]$Message,
        [string]$Hint
    )

    Write-Host "❌ $Message" -ForegroundColor Red
    if ($Hint) {
        Write-Host "   $Hint" -ForegroundColor Yellow
    }
    if ($script:DeploymentLogFile) {
        Write-Host "   Log file: $script:DeploymentLogFile" -ForegroundColor DarkGray
    }
    Stop-DeploymentLogging
    exit 1
}

function Ensure-AzProvider {
    param([string]$Namespace)

    $state = az provider show --namespace $Namespace --query "registrationState" -o tsv --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ❌ Unable to read provider state for $Namespace" -ForegroundColor Red
        Write-Host "      Azure CLI: $state" -ForegroundColor DarkGray
        Write-Host "      Missing permission likely: Microsoft.Resources/subscriptions/providers/read" -ForegroundColor Yellow
        return $false
    }

    if ($state -ne 'Registered') {
        Write-Host "🔁 Registering resource provider $Namespace..." -ForegroundColor Yellow
        $registerResult = az provider register --namespace $Namespace --wait -o none --only-show-errors 2>&1
        if ($LASTEXITCODE -ne 0) {
            $stateAfterFailure = az provider show --namespace $Namespace --query "registrationState" -o tsv --only-show-errors 2>$null
            if ($LASTEXITCODE -eq 0 -and $stateAfterFailure -eq 'Registered') {
                Write-Host "   ⚠️ Register call failed but provider is already registered. Continuing..." -ForegroundColor Yellow
                return $true
            }

            Write-Host "   ❌ Failed to register $Namespace" -ForegroundColor Red
            Write-Host "      Azure CLI: $registerResult" -ForegroundColor DarkGray
            Write-Host "      Missing permission likely: Microsoft.Resources/subscriptions/providers/register/action" -ForegroundColor Yellow
            return $false
        }
        Write-Host "   ✅ $Namespace registered" -ForegroundColor Green
    }
    return $true
}

# Auto-read version from api/package.json when -ImageTag is omitted
if (-not $ImageTag -or $ImageTag -eq '') {
    $pkgJsonPath = Join-Path $PSScriptRoot '..' 'api' 'package.json'
    if (Test-Path $pkgJsonPath) {
        $ImageTag = (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).version
        Write-Host "📦 ImageTag auto-read from api/package.json: $ImageTag" -ForegroundColor Cyan
    } else {
        $ImageTag = 'latest'
        Write-Host "⚠️  api/package.json not found - defaulting to ImageTag='latest'" -ForegroundColor Yellow
    }
}

# --- Interactive Fallback ----------------------------------------------------
# Allow zero‑parameter one‑liner usage via: iex (irm <raw-url>/deploy-azure.ps1)
# Any missing required values are prompted for here. This replaces relying on
# [Parameter(Mandatory)] which blocks interactive prompting when invoked via
# the raw GitHub one-liner.

function New-RandomScimSecret { "SCIM-$(Get-Random -Minimum 10000 -Maximum 99999)-$(Get-Date -Format 'yyyyMMdd')" }

function New-RandomSecret {
    param([int]$length = 64)

    $builder = ''
    while ($builder.Length -lt $length) {
        $builder += [Guid]::NewGuid().ToString('N')
    }
    return $builder.Substring(0, $length)
}

function Get-DeploymentStatePath {
    param(
        [string]$RgName,
        [string]$ContainerAppName
    )

    $stateDir = Join-Path $PSScriptRoot 'state'
    if (-not (Test-Path $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }

    $safeRg = if ([string]::IsNullOrWhiteSpace($RgName)) { 'unknown-rg' } else { ($RgName.ToLower() -replace '[^a-z0-9-]', '-') }
    $safeApp = if ([string]::IsNullOrWhiteSpace($ContainerAppName)) { 'unknown-app' } else { ($ContainerAppName.ToLower() -replace '[^a-z0-9-]', '-') }
    return Join-Path $stateDir "deploy-state-$safeRg-$safeApp.json"
}

function Load-DeploymentState {
    param([string]$StatePath)

    if ([string]::IsNullOrWhiteSpace($StatePath) -or -not (Test-Path $StatePath)) {
        return $null
    }

    try {
        return Get-Content -Path $StatePath -Raw | ConvertFrom-Json
    } catch {
        Write-Host "⚠️ Could not read deployment state file '$StatePath': $($_.Exception.Message)" -ForegroundColor Yellow
        return $null
    }
}

function Save-DeploymentState {
    param(
        [string]$StatePath,
        [string]$ScimSharedSecret,
        [string]$JwtSigningSecret,
        [string]$OAuthSecret,
        [string]$DbUrl
    )

    if ([string]::IsNullOrWhiteSpace($StatePath)) {
        return
    }

    try {
        $payload = [ordered]@{
            updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
            scimSecret = $ScimSharedSecret
            jwtSecret = $JwtSigningSecret
            oauthClientSecret = $OAuthSecret
            databaseUrl = $DbUrl
        }
        $payload | ConvertTo-Json -Depth 4 | Set-Content -Path $StatePath -Encoding utf8
    } catch {
        Write-Host "⚠️ Could not write deployment state file '$StatePath': $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Test-GhcrAnonymousPullSupported {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Repository
    )

    try {
        $tokenUrl = "https://ghcr.io/token?service=ghcr.io&scope=repository:$Repository`:pull"
        $response = Invoke-RestMethod -Uri $tokenUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
        return -not [string]::IsNullOrWhiteSpace($response.token)
    } catch {
        return $false
    }
}

Start-DeploymentLogging

if (-not $ResourceGroup) {
    $ResourceGroup = Read-Host "Enter Resource Group name (will be created if missing)"
    if (-not $ResourceGroup) { Stop-Deployment -Message "Resource Group is required." }
}

function Get-ExistingContainerApps {
    param([string]$RgName)

    if (-not $RgName) { return @() }
    $candidates = @()

    $appsJson = az resource list --resource-group $RgName --resource-type "Microsoft.App/containerApps" --query "[].name" --output json --only-show-errors 2>$null
    if ($LASTEXITCODE -eq 0 -and $appsJson) {
        try { $candidates += ($appsJson | ConvertFrom-Json) } catch {}
    }

    if ($candidates.Count -eq 0) {
        $envJson = az resource list --resource-group $RgName --resource-type "Microsoft.App/managedEnvironments" --query "[].name" --output json --only-show-errors 2>$null
        if ($LASTEXITCODE -eq 0 -and $envJson) {
            try {
                $envs = $envJson | ConvertFrom-Json
                foreach ($envName in $envs) {
                    if ([string]::IsNullOrWhiteSpace($envName)) { continue }
                    if ($envName.EndsWith('-env')) {
                        $candidates += $envName.Substring(0, $envName.Length - 4)
                    } else {
                        $candidates += $envName
                    }
                }
            } catch {}
        }
    }

    $filtered = $candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if (-not $filtered) { return @() }
    return @($filtered | Sort-Object -Unique)
}

if (-not $AppName) {
    $existingApps = @(Get-ExistingContainerApps -RgName $ResourceGroup)
    $defaultAppName = $null

    if ($existingApps.Count -gt 0) {
        Write-Host "Existing container apps in '$ResourceGroup':" -ForegroundColor Gray
        $existingApps | ForEach-Object { Write-Host "   • $_" -ForegroundColor Gray }
        if ($existingApps.Count -eq 1) {
            $defaultAppName = $existingApps[0]
        } elseif ($AppName -like 'scimserver-app-*') {
            $defaultAppName = $existingApps[0]
        }
    }

    $prompt = "Enter Container App name"
    if ($defaultAppName) { $prompt += " [$defaultAppName]" }

    $inputName = Read-Host $prompt
    if ([string]::IsNullOrWhiteSpace($inputName)) {
        if ($defaultAppName) {
            $AppName = $defaultAppName
            Write-Host "Using existing container app '$AppName'" -ForegroundColor Yellow
        } else {
            Stop-Deployment -Message "App Name is required."
        }
    } else {
        $AppName = $inputName
    }
}

$script:DeploymentStatePath = Get-DeploymentStatePath -RgName $ResourceGroup -ContainerAppName $AppName
$script:DeploymentState = Load-DeploymentState -StatePath $script:DeploymentStatePath
if ($script:DeploymentState) {
    Write-Host "🔁 Loaded previous deployment secrets cache for '$ResourceGroup/$AppName'" -ForegroundColor DarkGray
}

if (-not $ScimSecret -and $env:SCIM_SHARED_SECRET) { $ScimSecret = $env:SCIM_SHARED_SECRET }
if (-not $ScimSecret -and $script:DeploymentState -and $script:DeploymentState.scimSecret) {
    $ScimSecret = $script:DeploymentState.scimSecret
    Write-Host "Using cached SCIM shared secret from prior run" -ForegroundColor DarkGray
}

if (-not $ScimSecret) {
    $inputSecret = Read-Host "Enter SCIM shared secret (press Enter to auto-generate)"
    if ([string]::IsNullOrWhiteSpace($inputSecret)) {
        $ScimSecret = New-RandomScimSecret
        Write-Host "Generated secret: $ScimSecret" -ForegroundColor Yellow
    } else {
        $ScimSecret = $inputSecret
    }
}

if (-not $JwtSecret -and $env:JWT_SECRET) { $JwtSecret = $env:JWT_SECRET }
if (-not $OauthClientSecret -and $env:OAUTH_CLIENT_SECRET) { $OauthClientSecret = $env:OAUTH_CLIENT_SECRET }
if (-not $JwtSecret -and $script:DeploymentState -and $script:DeploymentState.jwtSecret) {
    $JwtSecret = $script:DeploymentState.jwtSecret
    Write-Host "Using cached JWT secret from prior run" -ForegroundColor DarkGray
}
if (-not $OauthClientSecret -and $script:DeploymentState -and $script:DeploymentState.oauthClientSecret) {
    $OauthClientSecret = $script:DeploymentState.oauthClientSecret
    Write-Host "Using cached OAuth client secret from prior run" -ForegroundColor DarkGray
}
if (-not $DatabaseUrl -and $script:DeploymentState -and $script:DeploymentState.databaseUrl) {
    $DatabaseUrl = $script:DeploymentState.databaseUrl
    Write-Host "Using cached DATABASE_URL from prior run" -ForegroundColor DarkGray
}

if (-not $JwtSecret) {
    $jwtInput = Read-Host "Enter JWT signing secret (press Enter to auto-generate secure value)"
    if ([string]::IsNullOrWhiteSpace($jwtInput)) {
        $JwtSecret = New-RandomSecret 64
        Write-Host "Generated JWT secret (store securely): $JwtSecret" -ForegroundColor Yellow
    } else {
        $JwtSecret = $jwtInput
    }
}

if (-not $OauthClientSecret) {
    $oauthInput = Read-Host "Enter OAuth client secret (press Enter to auto-generate secure value)"
    if ([string]::IsNullOrWhiteSpace($oauthInput)) {
        $OauthClientSecret = New-RandomSecret 64
        Write-Host "Generated OAuth client secret (store securely): $OauthClientSecret" -ForegroundColor Yellow
    } else {
        $OauthClientSecret = $oauthInput
    }
}

if ([string]::IsNullOrWhiteSpace($JwtSecret) -or [string]::IsNullOrWhiteSpace($OauthClientSecret)) {
    Stop-Deployment -Message "JWT and OAuth client secrets are required."
}

# --- PostgreSQL DATABASE_URL -------------------------------------------
# Phase 3 requires a PostgreSQL connection string. Three paths:
#   1. -DatabaseUrl "postgresql://..."  passed explicitly (BYO database)
#   2. -ProvisionPostgres               deploy infra/postgres.bicep (new Flexible Server)
#   3. No flag → interactive prompt (choose BYO or provision)

if (-not $DatabaseUrl -and $env:DATABASE_URL -and $env:DATABASE_URL.StartsWith('postgresql')) {
    $DatabaseUrl = $env:DATABASE_URL
    Write-Host "Using DATABASE_URL from environment" -ForegroundColor DarkGray
}

if (-not $DatabaseUrl -and -not $ProvisionPostgres) {
    Write-Host ""
    Write-Host "PostgreSQL database required (Phase 3)." -ForegroundColor Cyan
    Write-Host "  [1] I have an existing PostgreSQL connection string (BYO database)" -ForegroundColor White
    Write-Host "  [2] Provision a new Azure Database for PostgreSQL Flexible Server" -ForegroundColor White
    $dbChoice = Read-Host "Choose [1/2]"
    if ($dbChoice -eq '2') {
        $ProvisionPostgres = $true
    } else {
        $dbInput = Read-Host "Enter PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db?sslmode=require)"
        if ([string]::IsNullOrWhiteSpace($dbInput)) {
            Stop-Deployment -Message "DATABASE_URL is required." -Hint "Provide -DatabaseUrl or -ProvisionPostgres."
        }
        $DatabaseUrl = $dbInput.Trim()
    }
}

if ($ProvisionPostgres -and -not $DatabaseUrl) {
    if (-not $PgAdminPassword) {
        $pgPwInput = Read-Host "Enter PostgreSQL admin password (leave blank to auto-generate)"
        if ([string]::IsNullOrWhiteSpace($pgPwInput)) {
            $PgAdminPassword = New-RandomSecret 24
            Write-Host "Generated PG admin password: $PgAdminPassword" -ForegroundColor Yellow
        } else {
            $PgAdminPassword = $pgPwInput
        }
    }
    # Will provision PG in Step 3/5. DatabaseUrl will be set from output.
}

Save-DeploymentState -StatePath $script:DeploymentStatePath -ScimSharedSecret $ScimSecret -JwtSigningSecret $JwtSecret -OAuthSecret $OauthClientSecret -DbUrl $DatabaseUrl
if ($script:DeploymentStatePath) {
    Write-Host "🗂️ Deployment secrets cache updated: $script:DeploymentStatePath" -ForegroundColor DarkGray
}

# GHCR credentials are optional by default.
# Only prompt for credentials when anonymous pull is not available (private package scenario).
$imageRepository = 'pranems/scimserver'
$anonymousPullSupported = $true

if ([string]::IsNullOrWhiteSpace($GhcrUsername) -and [string]::IsNullOrWhiteSpace($GhcrPassword)) {
    $anonymousPullSupported = Test-GhcrAnonymousPullSupported -Repository $imageRepository
    if (-not $anonymousPullSupported) {
        Write-Host "Anonymous GHCR pull is unavailable for '$($imageRepository):$ImageTag'." -ForegroundColor Yellow
        $ghcrInput = Read-Host "Enter GitHub username for GHCR pull (required for private image)"
        if (-not [string]::IsNullOrWhiteSpace($ghcrInput)) {
            $GhcrUsername = $ghcrInput
            $ghcrPat = Read-Host "Enter GitHub PAT for GHCR pull (needs read:packages scope)"
            if (-not [string]::IsNullOrWhiteSpace($ghcrPat)) {
                $GhcrPassword = $ghcrPat
            }
        }
    }
}

if ($GhcrUsername -and -not $GhcrPassword) {
    Stop-Deployment -Message "GHCR username provided without PAT." -Hint "Provide both -GhcrUsername and -GhcrPassword for private images."
}
if ($GhcrPassword -and -not $GhcrUsername) {
    Stop-Deployment -Message "GHCR PAT provided without username." -Hint "Provide both -GhcrUsername and -GhcrPassword for private images."
}

# ImageTag already resolved above from package.json or parameter; final safety net
if (-not $ImageTag) { $ImageTag = "latest" }

Write-Host ""; Write-Host "Configuration Summary:" -ForegroundColor Cyan
Write-Host "  Resource Group : $ResourceGroup" -ForegroundColor White
Write-Host "  App Name       : $AppName" -ForegroundColor White
Write-Host "  Location       : $Location" -ForegroundColor White
Write-Host "  Image Tag      : $ImageTag" -ForegroundColor White
Write-Host "  GHCR Pull Mode : $([string]::IsNullOrWhiteSpace($GhcrUsername) ? 'Anonymous (public image)' : 'Authenticated (private image)')" -ForegroundColor White
Write-Host "  Database       : $($ProvisionPostgres ? 'Provision new Flexible Server' : '(BYO - see DATABASE_URL)')" -ForegroundColor White
if ($ProvisionPostgres -and $PgLocation -ne $Location) {
    Write-Host "  PG Location    : $PgLocation (overrides main location)" -ForegroundColor Yellow
}
Write-Host "  SCIM Secret    : $ScimSecret" -ForegroundColor Yellow
Write-Host "  JWT Secret     : (set)" -ForegroundColor Yellow
Write-Host "  OAuth Secret   : (set)" -ForegroundColor Yellow
Write-Host ""
Start-Sleep -Milliseconds 300

$ErrorActionPreference = "Stop"

Write-Host "SCIMServer Full Deployment to Azure Container Apps (deploy-azure.ps1 v1.1)" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""

# Check Azure CLI
try {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) { throw "Not authenticated" }
    Write-Host "Azure CLI authenticated as: $($account.user.name)" -ForegroundColor Green
    Write-Host "   Subscription: $($account.name)" -ForegroundColor Gray
} catch {
    Stop-Deployment -Message "Azure CLI not authenticated" -Hint "Run: az login"
}

# Ensure required resource providers are registered
foreach ($ns in $requiredProviders) {
    if (-not (Ensure-AzProvider -Namespace $ns)) {
        Stop-Deployment -Message "Provider readiness check failed for '$ns'." -Hint "Ask subscription admin for Reader + provider read/register permissions, then retry."
    }
}

# Generate resource names
$vnetName = "$AppName-vnet"

$envName = "$AppName-env"
$lawName = "$AppName-logs"

Write-Host ""
Write-Host "Deployment Configuration:" -ForegroundColor Cyan
Write-Host "   Resource Group: $ResourceGroup" -ForegroundColor White
Write-Host "   Location: $Location" -ForegroundColor White
Write-Host "   Container App: $AppName" -ForegroundColor White
Write-Host "   Environment: $envName" -ForegroundColor White
Write-Host "   Virtual Network: $vnetName" -ForegroundColor White
Write-Host "   Log Analytics: $lawName" -ForegroundColor White
Write-Host "   Image: ghcr.io/pranems/scimserver:$ImageTag" -ForegroundColor White
Write-Host "   Database: $($ProvisionPostgres ? 'Azure PostgreSQL Flexible Server (will provision)' : 'External PostgreSQL (BYO)')" -ForegroundColor White
if ($ProvisionPostgres -and $PgLocation -ne $Location) {
    Write-Host "   PG Location: $PgLocation (overriding main location - quota restriction)" -ForegroundColor Yellow
}
Write-Host ""

# Step 1: Create or verify resource group
Write-Host "📦 Step 1/5: Resource Group" -ForegroundColor Cyan
$ErrorActionPreference = 'SilentlyContinue'
$rgJson = az group show --name $ResourceGroup --output json 2>$null
$rgExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Continue'

if ($rgExitCode -ne 0 -or -not $rgJson) {
    Write-Host "   Creating resource group '$ResourceGroup'..." -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
    Stop-Deployment -Message "Failed to create resource group '$ResourceGroup'." -Hint "Ensure you have Microsoft.Resources/subscriptions/resourceGroups/write on this subscription."
    }
    Write-Host "   ✅ Resource group created" -ForegroundColor Green
} else {
    Write-Host "   ✅ Resource group exists" -ForegroundColor Green
}
Write-Host ""


# Step 2: Private network + DNS linkage for Container Apps
Write-Host "🌐 Step 2/5: Network" -ForegroundColor Cyan

function GetOrCreate-VnetSubnetId {
    param(
        [string]$ResourceGroupName,
        [string]$VirtualNetworkName,
        [string]$SubnetName,
        [string]$AddressPrefix,
        [bool]$DisablePrivateEndpointPolicies = $true,
        [bool]$DisablePrivateLinkServicePolicies = $true
    )

    $subnetJson = az network vnet subnet show `
        --resource-group $ResourceGroupName `
        --vnet-name $VirtualNetworkName `
        --name $SubnetName `
        --output json 2>$null

    if ($LASTEXITCODE -eq 0 -and $subnetJson) {
        $subnet = $subnetJson | ConvertFrom-Json
        return $subnet.id
    }

    Write-Host "   ➕ Creating subnet '$SubnetName' on existing VNet..." -ForegroundColor Yellow
    $subnetArgs = @(
        'network','vnet','subnet','create',
        '--resource-group',$ResourceGroupName,
        '--vnet-name',$VirtualNetworkName,
        '--name',$SubnetName,
        '--address-prefixes',$AddressPrefix,
        '--output','json'
    )
    if ($DisablePrivateEndpointPolicies) {
        $subnetArgs += @('--disable-private-endpoint-network-policies','true')
    }
    if ($DisablePrivateLinkServicePolicies) {
        $subnetArgs += @('--disable-private-link-service-network-policies','true')
    }

    $createJson = az @subnetArgs 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $createJson) {
        Write-Host "   ❌ Failed to create subnet $SubnetName" -ForegroundColor Red
        return $null
    }

    $createdSubnet = $createJson | ConvertFrom-Json
    return $createdSubnet.id
}

$expectedInfraSubnetName = 'aca-infra'
$expectedPeSubnetName = 'private-endpoints'
$infraPrefix = '10.40.0.0/21'
$runtimeSubnetName = 'aca-runtime'
$runtimePrefix = '10.40.8.0/21'
$privateEndpointPrefix = '10.40.16.0/24'

$existingVnetJson = az network vnet show --resource-group $ResourceGroup --name $vnetName --output json 2>$null
$networkHealthy = $false
$infrastructureSubnetId = $null
$privateEndpointSubnetId = $null
$workloadSubnetId = $null

if ($LASTEXITCODE -eq 0 -and $existingVnetJson) {
    $existingVnet = $existingVnetJson | ConvertFrom-Json
    Write-Host "   🔁 Reusing existing virtual network '$vnetName'" -ForegroundColor Green

    $infrastructureSubnetId = GetOrCreate-VnetSubnetId -ResourceGroupName $ResourceGroup -VirtualNetworkName $vnetName -SubnetName $expectedInfraSubnetName -AddressPrefix $infraPrefix
    $workloadSubnetId = GetOrCreate-VnetSubnetId -ResourceGroupName $ResourceGroup -VirtualNetworkName $vnetName -SubnetName $runtimeSubnetName -AddressPrefix $runtimePrefix
    $privateEndpointSubnetId = GetOrCreate-VnetSubnetId -ResourceGroupName $ResourceGroup -VirtualNetworkName $vnetName -SubnetName $expectedPeSubnetName -AddressPrefix $privateEndpointPrefix

    if (-not $infrastructureSubnetId -or -not $privateEndpointSubnetId) {
        Stop-Deployment -Message "Unable to ensure required subnets exist."
    }

    Write-Host "      Infrastructure subnet: $infrastructureSubnetId" -ForegroundColor Gray
    if ($workloadSubnetId) {
        Write-Host "      Runtime subnet: $workloadSubnetId" -ForegroundColor Gray
    } else {
        Write-Host "      Runtime subnet: (not configured)" -ForegroundColor Gray
    }
    Write-Host "      Private endpoint subnet: $privateEndpointSubnetId" -ForegroundColor Gray
    $networkHealthy = $true
}

if (-not $networkHealthy) {
    $networkDeploymentName = "network-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Write-Host "   Deploying virtual network '$vnetName'..." -ForegroundColor Yellow

    $networkDeployOutput = az deployment group create `
        --resource-group $ResourceGroup `
        --name $networkDeploymentName `
        --template-file "$PSScriptRoot/../infra/networking.bicep" `
        --parameters vnetName=$vnetName location=$Location `
        --query properties.outputs `
        --output json

    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ❌ Failed to provision network" -ForegroundColor Red
        Write-Host $networkDeployOutput -ForegroundColor Red
        Stop-Deployment -Message "Network deployment failed."
    }

    $networkOutputs = $networkDeployOutput | ConvertFrom-Json
    $infrastructureSubnetId = $networkOutputs.infrastructureSubnetId.value
    $privateEndpointSubnetId = $networkOutputs.privateEndpointSubnetId.value

    Write-Host "   ✅ Network deployed" -ForegroundColor Green
    Write-Host "      Infrastructure subnet: $infrastructureSubnetId" -ForegroundColor Gray
    Write-Host "      Private endpoint subnet: $privateEndpointSubnetId" -ForegroundColor Gray
}
Write-Host ""

# Step 3/5: PostgreSQL Flexible Server (optional, if -ProvisionPostgres)
if ($ProvisionPostgres -and -not $DatabaseUrl) {
    Write-Host "🐘 Step 3/5: PostgreSQL Flexible Server" -ForegroundColor Cyan
    $pgServerName = "$($AppName.ToLower() -replace '[^a-z0-9-]','-')-pg"
    if ($pgServerName.Length -gt 63) { $pgServerName = $pgServerName.Substring(0,63) }
    Write-Host "   Server name: $pgServerName" -ForegroundColor Gray

    $pgDeployName = "postgres-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $pgDeployOutput = az deployment group create `
        --resource-group $ResourceGroup `
        --name $pgDeployName `
        --template-file "$PSScriptRoot/../infra/postgres.bicep" `
        --parameters serverName=$pgServerName adminPassword=$PgAdminPassword location=$PgLocation `
        --query properties.outputs `
        --output json 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ❌ PostgreSQL provisioning failed" -ForegroundColor Red
        Write-Host $pgDeployOutput -ForegroundColor Red
        Stop-Deployment -Message "PostgreSQL Flexible Server deployment failed."
    }

    $pgOutputs = $pgDeployOutput | ConvertFrom-Json
    $DatabaseUrl = $pgOutputs.databaseUrl.value
    Write-Host "   ✅ PostgreSQL Flexible Server provisioned: $pgServerName" -ForegroundColor Green
    Write-Host "      FQDN: $($pgOutputs.serverFqdn.value)" -ForegroundColor Gray
    # Persist to state cache so re-runs don't need to re-enter
    Save-DeploymentState -StatePath $script:DeploymentStatePath -ScimSharedSecret $ScimSecret -JwtSigningSecret $JwtSecret -OAuthSecret $OauthClientSecret -DbUrl $DatabaseUrl
    Write-Host ""
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    Stop-Deployment -Message "DATABASE_URL is required but was not set." -Hint "Pass -DatabaseUrl or -ProvisionPostgres."
}

# Step 4: Deploy Container App Environment
Write-Host "🌐 Step 4/5: Container App Environment" -ForegroundColor Cyan

# Check if environment exists
$skipEnvDeployment = $false
$envCheck = az containerapp env show --name $envName --resource-group $ResourceGroup --query "name" --output tsv 2>$null
$envExists = $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrEmpty($envCheck)

if ($envExists) {
    Write-Host "   ✅ Environment already exists" -ForegroundColor Green
    $existingEnv = az containerapp env show --name $envName --resource-group $ResourceGroup --output json | ConvertFrom-Json
    $currentSubnet = $existingEnv.properties.vnetConfiguration.infrastructureSubnetId
    if ([string]::IsNullOrWhiteSpace($currentSubnet)) {
        Write-Host "   ⚠️  Existing environment isn't VNet-integrated. Delete or recreate the environment to enable private endpoints." -ForegroundColor Yellow
    } elseif ($currentSubnet -ne $infrastructureSubnetId) {
        Write-Host "   ⚠️  Environment bound to different subnet:`n      $currentSubnet" -ForegroundColor Yellow
        Write-Host "      Desired subnet:`n      $infrastructureSubnetId" -ForegroundColor Yellow
    }
    $skipEnvDeployment = $true
}

if (-not $skipEnvDeployment) {
    Write-Host "   Deploying environment with Log Analytics (this may take 1-2 minutes)..." -ForegroundColor Yellow
    $envDeploymentName = "containerapp-env-$(Get-Date -Format 'yyyyMMddHHmmss')"

    $envDeployOutput = az deployment group create `
        --resource-group $ResourceGroup `
        --name $envDeploymentName `
        --template-file "$PSScriptRoot/../infra/containerapp-env.bicep" `
        --parameters caeName=$envName `
                     lawName=$lawName `
                     location=$Location `
                     infrastructureSubnetId=$infrastructureSubnetId `
        --no-wait `
        --output json 2>&1

    if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Failed to start environment deployment" -ForegroundColor Red
    Write-Host $envDeployOutput -ForegroundColor Red
    Stop-Deployment -Message "Container App Environment deployment start failed."
    }

    # Poll environment deployment
    $maxWaitSeconds = 900
    $elapsed = 0
    $checkInterval = 10
    $deploymentSucceeded = $false

    while ($elapsed -lt $maxWaitSeconds) {
        Start-Sleep -Seconds $checkInterval
        $elapsed += $checkInterval

        $status = az deployment group show `
            --resource-group $ResourceGroup `
            --name $envDeploymentName `
            --query "properties.provisioningState" `
            --output tsv 2>$null

        if ($status -eq "Succeeded") {
            Write-Host "   ✅ Environment deployed successfully" -ForegroundColor Green
            $deploymentSucceeded = $true
            break
        } elseif ($status -eq "Failed") {
            Write-Host "   ❌ Environment deployment failed" -ForegroundColor Red
            $errorDetails = az deployment group show `
                --resource-group $ResourceGroup `
                --name $envDeploymentName `
                --query "properties.error" `
                --output json 2>$null
            Write-Host "   Error details: $errorDetails" -ForegroundColor Red
            Stop-Deployment -Message "Container App Environment deployment failed."
        } elseif ($status -in @("Running", "Accepted", "")) {
            Write-Host "   ⏳ Still deploying... ($elapsed seconds elapsed)" -ForegroundColor Gray
        }
    }

    if (-not $deploymentSucceeded) {
        Write-Host "   ⚠️  Environment deployment timeout" -ForegroundColor Yellow
        Write-Host "   Check Azure Portal for status: $ResourceGroup" -ForegroundColor Yellow
        Stop-Deployment -Message "Container App Environment deployment timed out."
    }

    # Deployment succeeded, but managed environment may still provision in background.
    $envProvisionState = az containerapp env show --name $envName --resource-group $ResourceGroup --query "properties.provisioningState" -o tsv 2>$null
    $envWaitSeconds = 0
    $envMaxWaitSeconds = 600

    while ($envProvisionState -in @('Waiting', 'Provisioning', 'InProgress', 'Updating', '')) {
        Write-Host "   ⏳ Environment status: $envProvisionState (waiting for completion)..." -ForegroundColor Gray
        Start-Sleep -Seconds $checkInterval
        $envWaitSeconds += $checkInterval
        if ($envWaitSeconds -ge $envMaxWaitSeconds) { break }
        $envProvisionState = az containerapp env show --name $envName --resource-group $ResourceGroup --query "properties.provisioningState" -o tsv 2>$null
    }

    if ($envProvisionState -eq 'Succeeded') {
        Write-Host "   ✅ Managed environment is fully ready" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Managed environment provisioning still '$envProvisionState'. Monitor in Azure Portal." -ForegroundColor Yellow
    }
}
Write-Host ""

# Step 5: Deploy Container App
Write-Host "🐳 Step 5/5: Container App" -ForegroundColor Cyan

# Check if container app already exists
$appCheck = az containerapp show --name $AppName --resource-group $ResourceGroup --query "name" --output tsv 2>$null
$appExists = $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrEmpty($appCheck)

$skipAppDeployment = $false

if ($appExists) {
    Write-Host "   ✅ Container App already exists" -ForegroundColor Green

    # Check current image version
    $currentImage = az containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.template.containers[0].image" --output tsv 2>$null
    $desiredImage = "ghcr.io/pranems/scimserver:$ImageTag"

    Write-Host "      Current image: $currentImage" -ForegroundColor Gray
    Write-Host "      Desired image: $desiredImage" -ForegroundColor Gray

    if ($currentImage -eq $desiredImage) {
        Write-Host "   ✅ Already configured with the same image tag - skipping deployment" -ForegroundColor Green
        $skipAppDeployment = $true
    } else {
        Write-Host "   🔄 Updating to new version..." -ForegroundColor Yellow
    }
} else {
    Write-Host "   Deploying SCIMServer container..." -ForegroundColor Yellow
}

if (-not $skipAppDeployment) {
    $containerParams = @{
        appName = $AppName
        environmentName = $envName
        location = $Location
        acrLoginServer = "ghcr.io"
        image = "pranems/scimserver:$ImageTag"
        scimSharedSecret = $ScimSecret
        jwtSecret = $JwtSecret
        oauthClientSecret = $OauthClientSecret
        databaseUrl = $DatabaseUrl
    }

    # Pass GHCR credentials if provided (for private packages)
    if ($GhcrUsername) { $containerParams.ghcrUsername = $GhcrUsername }
    if ($GhcrPassword) { $containerParams.ghcrPassword = $GhcrPassword }

    # Create a temporary parameters file to avoid escaping issues with special characters
    $paramsFile = Join-Path ([System.IO.Path]::GetTempPath()) "scimserver-params-$(Get-Date -Format 'yyyyMMddHHmmss').json"
    $paramsJson = @{
        '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
        contentVersion = '1.0.0.0'
        parameters = @{}
    }

    foreach ($key in $containerParams.Keys) {
        $paramsJson.parameters[$key] = @{ value = $containerParams[$key] }
    }

    $paramsJson | ConvertTo-Json -Depth 10 | Out-File -FilePath $paramsFile -Encoding utf8
    Write-Host "   Created parameter file: $paramsFile" -ForegroundColor Gray

    Write-Host "   Deploying container (this may take 2-3 minutes)..." -ForegroundColor Gray
    $deploymentName = "containerapp-$(Get-Date -Format 'yyyyMMddHHmmss')"

    # Use --no-wait and then poll with timeout to avoid hanging
    Write-Host "   Starting deployment: $deploymentName" -ForegroundColor Gray
    Write-Host "   (This runs asynchronously - polling for completion...)" -ForegroundColor Gray

    $deployOutput = az deployment group create `
        --resource-group $ResourceGroup `
        --name $deploymentName `
        --template-file "$PSScriptRoot/../infra/containerapp.bicep" `
        --parameters $paramsFile `
        --no-wait `
        --output json

    # Clean up temp file
    Remove-Item $paramsFile -ErrorAction SilentlyContinue

    if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Failed to start container app deployment" -ForegroundColor Red
    Write-Host "   Error output:" -ForegroundColor Red
    Write-Host $deployOutput -ForegroundColor Red
    Stop-Deployment -Message "Container app deployment start failed."
    }

    # Poll deployment status with timeout
    Write-Host "   Waiting for deployment to complete (timeout: 5 minutes)..." -ForegroundColor Gray
    $maxWaitSeconds = 300
    $elapsed = 0
    $checkInterval = 10

    while ($elapsed -lt $maxWaitSeconds) {
        Start-Sleep -Seconds $checkInterval
        $elapsed += $checkInterval

        $status = az deployment group show `
            --resource-group $ResourceGroup `
            --name $deploymentName `
            --query "properties.provisioningState" `
            --output tsv 2>$null

        if ($status -eq "Succeeded") {
            Write-Host "   ✅ Container App deployed successfully" -ForegroundColor Green
            break
        } elseif ($status -eq "Failed") {
            Write-Host "   ❌ Container App deployment failed" -ForegroundColor Red
            Write-Host "   Getting error details..." -ForegroundColor Yellow
            $errorDetails = az deployment group show `
                --resource-group $ResourceGroup `
                --name $deploymentName `
                --query "properties.error" `
                --output json
            Write-Host "   Error details:" -ForegroundColor Red
            Write-Host $errorDetails -ForegroundColor Red
            Stop-Deployment -Message "Container app deployment failed."
        } elseif ($status -in @("Running", "Accepted", "")) {
            Write-Host "   ⏳ Still deploying... ($elapsed seconds elapsed)" -ForegroundColor Gray
        } else {
            Write-Host "   ⚠️  Unknown status: $status" -ForegroundColor Yellow
        }
    }

    if ($elapsed -ge $maxWaitSeconds) {
    Write-Host "   ⚠️  Deployment timeout after $maxWaitSeconds seconds" -ForegroundColor Yellow
    Write-Host "   The deployment may still be running. Check Azure Portal:" -ForegroundColor Yellow
    Write-Host "   https://portal.azure.com/#@/resource/subscriptions/$((az account show --query id -o tsv))/resourceGroups/$ResourceGroup/deployments" -ForegroundColor Cyan
    Stop-Deployment -Message "Container app deployment timed out."
    }
}
Write-Host ""

# Finalize deployment
Write-Host "📊 Finalizing" -ForegroundColor Cyan
Write-Host "   Retrieving deployment details..." -ForegroundColor Yellow

$appDetails = az containerapp show --name $AppName --resource-group $ResourceGroup --output json | ConvertFrom-Json

if ($appDetails -and $appDetails.properties.configuration.ingress.fqdn) {
    $url = "https://$($appDetails.properties.configuration.ingress.fqdn)"
    Write-Host "   ✅ Deployment complete!" -ForegroundColor Green
} else {
    Stop-Deployment -Message "Could not retrieve app URL for verification."
}

Write-Host "🔍 Verifying deployed instance (GET /scim/admin/version)..." -ForegroundColor Cyan
$versionEndpoint = "$url/scim/admin/version"
$verifyHeaders = @{ Authorization = "Bearer $ScimSecret" }
$verifyMaxAttempts = 18
$verifyDelaySeconds = 10
$verified = $false
$versionInfo = $null

for ($attempt = 1; $attempt -le $verifyMaxAttempts; $attempt++) {
    try {
        $versionInfo = Invoke-RestMethod -Uri $versionEndpoint -Method Get -Headers $verifyHeaders -TimeoutSec 20 -ErrorAction Stop
        if ($versionInfo -and $versionInfo.version) {
            Write-Host "   ✅ Verification successful (version=$($versionInfo.version))" -ForegroundColor Green
            $verified = $true
            break
        }
        Write-Host "   ⚠️ Verification response missing version field (attempt $attempt/$verifyMaxAttempts)" -ForegroundColor Yellow
    } catch {
        $errMsg = $_.Exception.Message
        Write-Host "   ⏳ Verification attempt $attempt/$verifyMaxAttempts failed: $errMsg" -ForegroundColor Gray
    }

    if ($attempt -lt $verifyMaxAttempts) {
        Start-Sleep -Seconds $verifyDelaySeconds
    }
}

if (-not $verified) {
    Stop-Deployment -Message "Deployment verification failed: $versionEndpoint did not become ready in time." -Hint "Check app logs and ingress settings, then retry."
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🎉 Deployment Successful!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Deployment Summary:" -ForegroundColor Cyan
Write-Host "   App URL: $url" -ForegroundColor Yellow
Write-Host "   SCIM Endpoint: $url/scim/v2" -ForegroundColor Yellow
Write-Host "   Resource Group: $ResourceGroup" -ForegroundColor White
$secretEcho = $ScimSecret
if (-not $secretEcho -and $env:SCIM_SHARED_SECRET) { $secretEcho = $env:SCIM_SHARED_SECRET }
if ($secretEcho) { Write-Host "   SCIM Shared Secret: $secretEcho" -ForegroundColor Yellow }
Write-Host "   JWT Secret: $JwtSecret" -ForegroundColor Yellow
Write-Host "   OAuth Client Secret: $OauthClientSecret" -ForegroundColor Yellow
Write-Host "   Persistence: PostgreSQL (managed or BYO)" -ForegroundColor Green
Write-Host ""

Write-Host "✅ Verified Runtime (/scim/admin/version):" -ForegroundColor Cyan
if ($versionInfo) {
    try {
        Write-Host "   version: $($versionInfo.version)" -ForegroundColor White
        if ($versionInfo.service) {
            Write-Host "   service.environment: $($versionInfo.service.environment)" -ForegroundColor White
            Write-Host "   service.uptimeSeconds: $($versionInfo.service.uptimeSeconds)" -ForegroundColor White
        }
        if ($versionInfo.runtime) {
            Write-Host "   runtime.node: $($versionInfo.runtime.node)" -ForegroundColor White
            Write-Host "   runtime.platform: $($versionInfo.runtime.platform)" -ForegroundColor White
        }

        Write-Host "   full response:" -ForegroundColor Gray
        $versionPretty = $versionInfo | ConvertTo-Json -Depth 10
        foreach ($line in ($versionPretty -split "`r?`n")) {
            Write-Host "     $line" -ForegroundColor Gray
        }
    } catch {
        Write-Host "   (Could not format version response: $($_.Exception.Message))" -ForegroundColor Yellow
    }
} else {
    Write-Host "   (No version response captured)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "💾 Persistence:" -ForegroundColor Cyan
Write-Host "   Database: PostgreSQL (persistence managed by Azure Database / external PG)" -ForegroundColor White
Write-Host "   Backup: Azure-managed daily backup with 7-day point-in-time restore (PG Flexible Server)" -ForegroundColor White
Write-Host ""

Write-Host "📝 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Configure Microsoft Entra ID provisioning:" -ForegroundColor White
Write-Host "   • Tenant URL: $url/scim/v2" -ForegroundColor Yellow
Write-Host "   • Secret Token: [your configured secret]" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Test the SCIM endpoint:" -ForegroundColor White
Write-Host "   curl -H 'Authorization: Bearer YOUR_SECRET' $url/scim/v2/ServiceProviderConfig" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Monitor your deployment:" -ForegroundColor White
Write-Host "   • Azure Portal: https://portal.azure.com" -ForegroundColor Gray
Write-Host "   • Resource: $ResourceGroup > $AppName" -ForegroundColor Gray
Write-Host "   • Logs: $ResourceGroup > $lawName" -ForegroundColor Gray
Write-Host ""

Write-Host "🔎 Quick Log Access (copy & paste):" -ForegroundColor Cyan
Write-Host "   Real-time streaming:" -ForegroundColor White
Write-Host "   az containerapp logs show -n $AppName -g $ResourceGroup --type console --follow" -ForegroundColor Gray
Write-Host "" 
Write-Host "   Recent logs (last 50):" -ForegroundColor White
Write-Host "   az containerapp logs show -n $AppName -g $ResourceGroup --type console --tail 50" -ForegroundColor Gray
Write-Host ""
Write-Host "   System logs:" -ForegroundColor White
Write-Host "   az containerapp logs show -n $AppName -g $ResourceGroup --type system --tail 30" -ForegroundColor Gray
Write-Host ""
Write-Host "   Admin API (recent):" -ForegroundColor White
Write-Host "   curl `"$url/scim/admin/log-config/recent?limit=25`" -H `"Authorization: Bearer <SECRET>`"" -ForegroundColor Gray
Write-Host ""
Write-Host "   Admin API (download JSON):" -ForegroundColor White
Write-Host "   curl `"$url/scim/admin/log-config/download?format=json`" -H `"Authorization: Bearer <SECRET>`" -o scim-logs.json" -ForegroundColor Gray
Write-Host ""
Write-Host "   Admin API (live stream via SSE):" -ForegroundColor White
Write-Host "   curl -N `"$url/scim/admin/log-config/stream?level=INFO`" -H `"Authorization: Bearer <SECRET>`"" -ForegroundColor Gray
Write-Host ""
Write-Host "   Helper script examples (from repo root):" -ForegroundColor White
Write-Host "   .\scripts\remote-logs.ps1 -Mode recent -BaseUrl $url" -ForegroundColor Gray
Write-Host "   .\scripts\remote-logs.ps1 -Mode tail -BaseUrl $url" -ForegroundColor Gray
Write-Host "   .\scripts\remote-logs.ps1 -Mode download -BaseUrl $url -Format json" -ForegroundColor Gray
Write-Host ""

Write-Host "💰 Estimated Monthly Cost:" -ForegroundColor Cyan
Write-Host '   Container App: ~$5-15 (scales to zero when idle)' -ForegroundColor White
Write-Host '   Log Analytics: ~$0-5 (depends on log volume)' -ForegroundColor White
Write-Host '   PostgreSQL Flexible Server (B1ms): ~$15-25/mo (if provisioned via -ProvisionPostgres)' -ForegroundColor White
Write-Host '   BYO PostgreSQL: depends on your provider / existing tier' -ForegroundColor White
Write-Host '   Total (with managed PG): ~$20-45/month' -ForegroundColor Yellow
Write-Host ""

Write-Host "🏁 Deployment complete!" -ForegroundColor Green
if ($script:DeploymentLogFile) {
    Write-Host "📝 Deployment run log saved to: $script:DeploymentLogFile" -ForegroundColor Green
}
Stop-DeploymentLogging
