param(
    [string]$ResourceGroup,
    [string]$AppName,
    [string]$Location,
    [string]$ScimSecret,
    [string]$ImageTag,
    [string]$BlobBackupAccount,
    [string]$BlobBackupContainer,
    [string]$JwtSecret,
    [string]$OauthClientSecret,
    [string]$GhcrUsername,
    [string]$GhcrPassword,
    [switch]$EnablePersistentStorage
)

if (-not $Location -or $Location -eq '') { $Location = 'eastus' }
$requiredProviders = @('Microsoft.App','Microsoft.ContainerService')

function Ensure-AzProvider {
    param([string]$Namespace)

    $state = az provider show --namespace $Namespace --query "registrationState" -o tsv 2>$null
    if ($LASTEXITCODE -ne 0) { $state = '' }

    if ($state -ne 'Registered') {
        Write-Host "🔁 Registering resource provider $Namespace..." -ForegroundColor Yellow
        az provider register --namespace $Namespace --wait -o none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   ❌ Failed to register $Namespace" -ForegroundColor Red
            return $false
        }
        Write-Host "   ✅ $Namespace registered" -ForegroundColor Green
    }
    return $true
}

if (-not $ImageTag -or $ImageTag -eq '') { $ImageTag = 'latest' }
if (-not $BlobBackupAccount) { $BlobBackupAccount = "$($AppName.ToLower())backup" }
# Sanitize blob backup storage account name (must be 3-24 chars, lowercase/numbers only)
$BlobBackupAccount = ($BlobBackupAccount -replace '[^a-z0-9]', '')
if ($BlobBackupAccount.Length -lt 3) { $BlobBackupAccount = ("scim" + (Get-Random -Minimum 100 -Maximum 999)) }
if ($BlobBackupAccount.Length -gt 24) { $BlobBackupAccount = $BlobBackupAccount.Substring(0,24) }
if ($BlobBackupAccount -notmatch '^[a-z0-9]{3,24}$') {
    Write-Host "   WARNING: Generated invalid storage account name; generating fallback" -ForegroundColor Yellow
    $BlobBackupAccount = "scim" + (Get-Random -Minimum 100000 -Maximum 999999)
}
if (-not $BlobBackupContainer) { $BlobBackupContainer = 'scimserver-backups' }

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

if (-not $ResourceGroup) {
    $ResourceGroup = Read-Host "Enter Resource Group name (will be created if missing)"
    if (-not $ResourceGroup) { Write-Host "Resource Group is required." -ForegroundColor Red; return }
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
            Write-Host "App Name is required." -ForegroundColor Red
            return
        }
    } else {
        $AppName = $inputName
    }
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
    Write-Host "JWT and OAuth client secrets are required." -ForegroundColor Red
    return
}

# GHCR credentials (required if package is private)
if (-not $GhcrUsername) {
    $ghcrInput = Read-Host "Enter GitHub username for GHCR pull (press Enter to skip for public packages)"
    if (-not [string]::IsNullOrWhiteSpace($ghcrInput)) { $GhcrUsername = $ghcrInput }
}
if ($GhcrUsername -and -not $GhcrPassword) {
    $ghcrPat = Read-Host "Enter GitHub PAT for GHCR pull (needs read:packages scope)"
    if (-not [string]::IsNullOrWhiteSpace($ghcrPat)) { $GhcrPassword = $ghcrPat }
}

if (-not $ImageTag) { $ImageTag = "latest" }

Write-Host ""; Write-Host "Configuration Summary:" -ForegroundColor Cyan
Write-Host "  Resource Group : $ResourceGroup" -ForegroundColor White
Write-Host "  App Name       : $AppName" -ForegroundColor White
Write-Host "  Location       : $Location" -ForegroundColor White
Write-Host "  Image Tag      : $ImageTag" -ForegroundColor White
Write-Host "  Blob Backup Acct : $BlobBackupAccount" -ForegroundColor White
Write-Host "  Blob Container   : $BlobBackupContainer" -ForegroundColor White
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
    Write-Host "Azure CLI not authenticated" -ForegroundColor Red
    Write-Host "   Run: az login" -ForegroundColor Yellow
    return
}

# Ensure required resource providers are registered
foreach ($ns in $requiredProviders) {
    if (-not (Ensure-AzProvider -Namespace $ns)) { return }
}

# Generate resource names
# Storage account names must be globally unique (3-24 chars, lowercase alphanumeric)
# Include resource group name to ensure uniqueness across deployments
$rgSuffix = $ResourceGroup.Replace("-", "").Replace("_", "").ToLower()
$appPrefix = $AppName.Replace("-", "").Replace("_", "").ToLower()
$storageName = $appPrefix + $rgSuffix + "stor"
# Truncate to 24 characters if too long
if ($storageName.Length -gt 24) {
    # Keep app prefix + truncated RG suffix + "stor"
    $maxRgLength = 24 - $appPrefix.Length - 4  # 4 for "stor"
    if ($maxRgLength -gt 0) {
        $rgSuffix = $rgSuffix.Substring(0, [Math]::Min($rgSuffix.Length, $maxRgLength))
        $storageName = $appPrefix + $rgSuffix + "stor"
    } else {
        # If app name alone is too long, just truncate everything
        $storageName = $storageName.Substring(0, 24)
    }
}

# Final validation
if ($storageName.Length -gt 24) {
    Write-Host "   WARNING: Storage name too long after truncation: $storageName ($($storageName.Length) chars)" -ForegroundColor Yellow
    $storageName = $storageName.Substring(0, 24)
    Write-Host "   Truncated to: $storageName" -ForegroundColor Green
}

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
Write-Host "   Storage Account: $storageName" -ForegroundColor White
Write-Host "   Log Analytics: $lawName" -ForegroundColor White
Write-Host "   Image: ghcr.io/pranems/scimserver:$ImageTag" -ForegroundColor White
Write-Host "   Persistence: Blob snapshots (Account=$BlobBackupAccount Container=$BlobBackupContainer)" -ForegroundColor Green
Write-Host ""

# Step 1: Create or verify resource group
Write-Host "📦 Step 1/6: Resource Group" -ForegroundColor Cyan
$ErrorActionPreference = 'SilentlyContinue'
$rgJson = az group show --name $ResourceGroup --output json 2>$null
$rgExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Continue'

if ($rgExitCode -ne 0 -or -not $rgJson) {
    Write-Host "   Creating resource group '$ResourceGroup'..." -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Failed to create resource group" -ForegroundColor Red
    return
    }
    Write-Host "   ✅ Resource group created" -ForegroundColor Green
} else {
    Write-Host "   ✅ Resource group exists" -ForegroundColor Green
}
Write-Host ""


# Step 2: Private network + DNS linkage for Container Apps
Write-Host "🌐 Step 2/6: Network & Private DNS" -ForegroundColor Cyan

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
$expectedDnsZoneName = 'privatelink.blob.core.windows.net'
$dnsLinkName = "$vnetName-link"
$infraPrefix = '10.40.0.0/21'
$runtimeSubnetName = 'aca-runtime'
$runtimePrefix = '10.40.8.0/21'
$privateEndpointPrefix = '10.40.16.0/24'

$existingVnetJson = az network vnet show --resource-group $ResourceGroup --name $vnetName --output json 2>$null
$networkHealthy = $false
$infrastructureSubnetId = $null
$privateEndpointSubnetId = $null
$workloadSubnetId = $null
$privateDnsZoneName = $expectedDnsZoneName

if ($LASTEXITCODE -eq 0 -and $existingVnetJson) {
    $existingVnet = $existingVnetJson | ConvertFrom-Json
    Write-Host "   🔁 Reusing existing virtual network '$vnetName'" -ForegroundColor Green

    $infrastructureSubnetId = GetOrCreate-VnetSubnetId -ResourceGroupName $ResourceGroup -VirtualNetworkName $vnetName -SubnetName $expectedInfraSubnetName -AddressPrefix $infraPrefix
    $workloadSubnetId = GetOrCreate-VnetSubnetId -ResourceGroupName $ResourceGroup -VirtualNetworkName $vnetName -SubnetName $runtimeSubnetName -AddressPrefix $runtimePrefix
    $privateEndpointSubnetId = GetOrCreate-VnetSubnetId -ResourceGroupName $ResourceGroup -VirtualNetworkName $vnetName -SubnetName $expectedPeSubnetName -AddressPrefix $privateEndpointPrefix

    if (-not $infrastructureSubnetId -or -not $privateEndpointSubnetId) {
        Write-Host "   ❌ Unable to ensure required subnets exist" -ForegroundColor Red
        return
    }

    $privateDnsZoneJson = az network private-dns zone show --resource-group $ResourceGroup --name $expectedDnsZoneName --output json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $privateDnsZoneJson) {
        Write-Host "   ➕ Creating private DNS zone '$expectedDnsZoneName'" -ForegroundColor Yellow
        $privateDnsZoneJson = az network private-dns zone create `
            --resource-group $ResourceGroup `
            --name $expectedDnsZoneName `
            --output json 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $privateDnsZoneJson) {
            Write-Host "   ❌ Failed to create private DNS zone" -ForegroundColor Red
            return
        }
    }

    $privateDnsZone = $privateDnsZoneJson | ConvertFrom-Json
    $privateDnsZoneName = $privateDnsZone.name

    $dnsLinkJson = az network private-dns link vnet show --resource-group $ResourceGroup --zone-name $privateDnsZoneName --name $dnsLinkName --output json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $dnsLinkJson) {
        Write-Host "   🔗 Creating DNS link '$dnsLinkName'" -ForegroundColor Yellow
        $dnsLinkJson = az network private-dns link vnet create `
            --resource-group $ResourceGroup `
            --zone-name $privateDnsZoneName `
            --name $dnsLinkName `
            --virtual-network $existingVnet.id `
            --registration-enabled false `
            --output json 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $dnsLinkJson) {
            Write-Host "   ❌ Failed to create DNS link" -ForegroundColor Red
            return
        }
    }

    Write-Host "      Infrastructure subnet: $infrastructureSubnetId" -ForegroundColor Gray
    if ($workloadSubnetId) {
        Write-Host "      Runtime subnet: $workloadSubnetId" -ForegroundColor Gray
    } else {
        Write-Host "      Runtime subnet: (not configured)" -ForegroundColor Gray
    }
    Write-Host "      Private endpoint subnet: $privateEndpointSubnetId" -ForegroundColor Gray
    Write-Host "      Private DNS zone: $privateDnsZoneName" -ForegroundColor Gray
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
        return
    }

    $networkOutputs = $networkDeployOutput | ConvertFrom-Json
    $infrastructureSubnetId = $networkOutputs.infrastructureSubnetId.value
    $privateEndpointSubnetId = $networkOutputs.privateEndpointSubnetId.value
    $privateDnsZoneName = $networkOutputs.privateDnsZoneName.value

    Write-Host "   ✅ Network deployed" -ForegroundColor Green
    Write-Host "      Infrastructure subnet: $infrastructureSubnetId" -ForegroundColor Gray
    Write-Host "      Private endpoint subnet: $privateEndpointSubnetId" -ForegroundColor Gray
    Write-Host "      Private DNS zone: $privateDnsZoneName" -ForegroundColor Gray
}
Write-Host ""

# Step 3: Blob Storage (private endpoint snapshots)
Write-Host "💾 Step 3/6: Blob Storage (private endpoint)" -ForegroundColor Cyan

$storageDeploymentName = "blob-$(Get-Date -Format 'yyyyMMddHHmmss')"
$storageDeployOutput = az deployment group create `
    --resource-group $ResourceGroup `
    --name $storageDeploymentName `
    --template-file "$PSScriptRoot/../infra/blob-storage.bicep" `
    --parameters storageAccountName=$BlobBackupAccount containerName=$BlobBackupContainer privateEndpointSubnetId=$privateEndpointSubnetId location=$Location `
    --query properties.outputs `
    --output json

if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Failed to deploy blob storage" -ForegroundColor Red
    Write-Host $storageDeployOutput -ForegroundColor Red
    return
}

$storageOutputs = $storageDeployOutput | ConvertFrom-Json
$storageAccountId = $storageOutputs.storageAccountId.value
$blobEndpoint = "https://$($storageOutputs.storageAccountName.value).blob.core.windows.net/"

Write-Host "   ✅ Storage account locked behind private endpoint" -ForegroundColor Green
Write-Host "      Storage account ID: $storageAccountId" -ForegroundColor Gray
Write-Host "      Blob endpoint (private): $blobEndpoint" -ForegroundColor Gray
Write-Host ""

# Step 4: Deploy Container App Environment
Write-Host "🌐 Step 4/6: Container App Environment" -ForegroundColor Cyan

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
    return
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
            return
        } elseif ($status -in @("Running", "Accepted", "")) {
            Write-Host "   ⏳ Still deploying... ($elapsed seconds elapsed)" -ForegroundColor Gray
        }
    }

    if (-not $deploymentSucceeded) {
        Write-Host "   ⚠️  Environment deployment timeout" -ForegroundColor Yellow
        Write-Host "   Check Azure Portal for status: $ResourceGroup" -ForegroundColor Yellow
        return
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

# Step 4: Deploy Container App
Write-Host "🐳 Step 5/6: Container App" -ForegroundColor Cyan

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
    }

    # Pass blob backup parameters
    $containerParams.blobBackupAccountName = $BlobBackupAccount
    $containerParams.blobBackupContainerName = $BlobBackupContainer

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
    return
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
            return
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
    return
    }
}
Write-Host ""

# Step 5: Get deployment details
Write-Host "📊 Step 6/6: Finalizing" -ForegroundColor Cyan
Write-Host "   Retrieving deployment details..." -ForegroundColor Yellow

$appDetails = az containerapp show --name $AppName --resource-group $ResourceGroup --output json | ConvertFrom-Json

if ($appDetails -and $appDetails.properties.configuration.ingress.fqdn) {
    $url = "https://$($appDetails.properties.configuration.ingress.fqdn)"
    Write-Host "   ✅ Deployment complete!" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Could not retrieve app URL" -ForegroundColor Yellow
    $url = "Unable to retrieve URL"
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
Write-Host "   Persistence: Blob snapshot backups (enabled)" -ForegroundColor Green
Write-Host ""

Write-Host "💾 Blob Backup Strategy:" -ForegroundColor Cyan
Write-Host "   Account: $BlobBackupAccount" -ForegroundColor White
Write-Host "   Container: $BlobBackupContainer" -ForegroundColor White
Write-Host "   Runtime DB: /tmp/local-data/scim.db (ephemeral)" -ForegroundColor White
Write-Host "   Snapshots: timestamped SQLite copies in blob storage" -ForegroundColor Gray
Write-Host ""

# Assign role to container app system identity (after app exists)
Write-Host "🔐 Assigning Storage Blob Data Contributor role" -ForegroundColor Cyan
$principalId = az containerapp show -n $AppName -g $ResourceGroup --query identity.principalId -o tsv 2>$null
if ($principalId) {
    $scope = "/subscriptions/$((az account show --query id -o tsv))/resourceGroups/$ResourceGroup/providers/Microsoft.Storage/storageAccounts/$BlobBackupAccount"
    $existingRole = az role assignment list --assignee $principalId --scope $scope --query "[?roleDefinitionName=='Storage Blob Data Contributor'].id" -o tsv 2>$null
    if (-not $existingRole) {
        az role assignment create --assignee $principalId --role "Storage Blob Data Contributor" --scope $scope -o none 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Host "   ✅ Role assigned" -ForegroundColor Green } else { Write-Host "   ⚠️  Failed to assign role (manual intervention may be required)" -ForegroundColor Yellow }
    } else { Write-Host "   ✅ Role already assigned" -ForegroundColor Green }
} else {
    Write-Host "   ⚠️  Could not fetch principalId for container app (role assignment skipped)" -ForegroundColor Yellow
}
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

Write-Host "� Log Viewing Commands (copy & paste):" -ForegroundColor Cyan
Write-Host "   Real-time streaming:" -ForegroundColor White
Write-Host "   az containerapp logs show -n $AppName -g $ResourceGroup --type console --follow" -ForegroundColor Gray
Write-Host "" 
Write-Host "   Recent logs (last 50):" -ForegroundColor White
Write-Host "   az containerapp logs show -n $AppName -g $ResourceGroup --type console --tail 50" -ForegroundColor Gray
Write-Host ""
Write-Host "   System logs:" -ForegroundColor White
Write-Host "   az containerapp logs show -n $AppName -g $ResourceGroup --type system --tail 30" -ForegroundColor Gray
Write-Host ""
Write-Host "   Admin REST endpoints (from any machine):" -ForegroundColor White
Write-Host "   curl $url/scim/admin/logs -H 'Authorization: Bearer <SECRET>'" -ForegroundColor Gray
Write-Host "   curl $url/scim/admin/log-config/recent -H 'Authorization: Bearer <SECRET>'" -ForegroundColor Gray
Write-Host ""

Write-Host "�💰 Estimated Monthly Cost:" -ForegroundColor Cyan
Write-Host '   Container App: ~$5-15 (scales to zero when idle)' -ForegroundColor White
Write-Host '   Blob Storage (snapshots): ~$0.20-0.50 (light DB snapshots)' -ForegroundColor White
Write-Host '   Log Analytics: ~$0-5 (depends on log volume)' -ForegroundColor White
Write-Host '   Total: ~$5.20-20/month' -ForegroundColor Yellow
Write-Host ""

Write-Host "🏁 Deployment complete!" -ForegroundColor Green
