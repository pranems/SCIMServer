<#
.SYNOPSIS
Runs the real-Entra WIF proof with a temporary, exactly cleaned application.

.DESCRIPTION
Resolves the current dev estate and tenant from scripts/scim-estates.ps1,
creates a uniquely named Entra application and service principal, keeps the
one-time application credential in process memory, runs wif-e2e-proof.ps1, and
deletes both directory objects by exact ID in finally.
#>
[CmdletBinding()]
param(
    [string]$AdminToken = 'changeme-scim',
    [int]$MintLatencyBudgetMs = 150
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'scim-estates.ps1')

$estate = Get-ScimEstate -Purpose 'dev'
if ($estate.Purpose -ne 'dev') {
    throw "Resolved estate purpose '$($estate.Purpose)' is not dev."
}
$baseUrl = Get-ScimEstateBaseUrl -Purpose 'dev'
$originalAzureConfigDir = $env:AZURE_CONFIG_DIR
$env:AZURE_CONFIG_DIR = [string]$estate.Tenant.UserConfigDirPath
$application = $null
$servicePrincipal = $null
$proofExitCode = 1
$cleanupFailed = $false
$preexistingEndpointIds = @()

function Invoke-Graph {
    param(
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PATCH', 'DELETE')]
        [string]$Method,
        [Parameter(Mandatory)] [string]$Path,
        [object]$Body
    )

    $parameters = @{
        Uri = "https://graph.microsoft.com/v1.0/$Path"
        Method = $Method
        Headers = $script:graphHeaders
        TimeoutSec = 90
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    Invoke-RestMethod @parameters
}

try {
    $tenantId = az account show --query tenantId -o tsv
    if ($LASTEXITCODE -ne 0 -or $tenantId -ne [string]$estate.Tenant.tenantId) {
        throw "Active Azure CLI tenant '$tenantId' does not match the registry dev tenant '$($estate.Tenant.tenantId)'."
    }
    $graphToken = az account get-access-token --resource-type ms-graph --query accessToken -o tsv
    if ($LASTEXITCODE -ne 0 -or -not $tenantId -or -not $graphToken) {
        throw 'The current dev-tenant profile cannot acquire a Microsoft Graph token.'
    }
    $script:graphHeaders = @{
        Authorization = 'Bearer ' + [string]$graphToken
    }
    $adminHeaders = @{
        Authorization = 'Bearer ' + $AdminToken
    }
    $preexistingEndpointResponse = Invoke-RestMethod -Method GET -Uri "$baseUrl/scim/admin/endpoints?count=500" -Headers $adminHeaders
    $preexistingEndpointIds = @($preexistingEndpointResponse.endpoints | ForEach-Object { [string]$_.id })

    $application = Invoke-Graph -Method POST -Path 'applications' -Body @{
        displayName = 'SCIMServer WIF E2E ' + [guid]::NewGuid().ToString('N').Substring(0, 8)
        signInAudience = 'AzureADMyOrg'
        api = @{
            requestedAccessTokenVersion = 2
        }
    }
    Invoke-Graph -Method PATCH -Path "applications/$($application.id)" -Body @{
        identifierUris = @("api://$($application.appId)")
    } | Out-Null
    $servicePrincipal = Invoke-Graph -Method POST -Path 'servicePrincipals' -Body @{
        appId = [string]$application.appId
        accountEnabled = $true
    }
    $credential = Invoke-Graph -Method POST -Path "applications/$($application.id)/addPassword" -Body @{
        passwordCredential = @{
            displayName = 'SCIMServer WIF E2E'
            endDateTime = [DateTimeOffset]::UtcNow.AddHours(2).ToString('o')
        }
    }

    Start-Sleep -Seconds 20
    $env:WIF_TEST_APPID = [string]$application.appId
    $env:WIF_TEST_TENANT = [string]$tenantId
    $env:WIF_TEST_SECRET = [string]$credential.secretText
    $env:WIF_PROOF_ADMIN_TOKEN = $AdminToken
    & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'wif-e2e-proof.ps1') `
        -BaseUrl $baseUrl `
        -MintLatencyBudgetMs $MintLatencyBudgetMs
    $proofExitCode = $LASTEXITCODE
}
finally {
    Remove-Item Env:\WIF_TEST_APPID, Env:\WIF_TEST_TENANT, Env:\WIF_TEST_SECRET, Env:\WIF_PROOF_ADMIN_TOKEN -ErrorAction SilentlyContinue
    if ($adminHeaders) {
        try {
            $remainingEndpointResponse = Invoke-RestMethod -Method GET -Uri "$baseUrl/scim/admin/endpoints?count=500" -Headers $adminHeaders
            $ownedRemaining = @(
                $remainingEndpointResponse.endpoints |
                    Where-Object {
                        [string]$_.id -notin $preexistingEndpointIds -and
                        [string]$_.name -like 'wif-proof-*'
                    }
            )
            if ($ownedRemaining.Count -gt 0) {
                $cleanupFailed = $true
                foreach ($endpoint in $ownedRemaining) {
                    Invoke-RestMethod -Method DELETE -Uri "$baseUrl/scim/admin/endpoints/$($endpoint.id)" -Headers $adminHeaders | Out-Null
                }
                $postCleanupResponse = Invoke-RestMethod -Method GET -Uri "$baseUrl/scim/admin/endpoints?count=500" -Headers $adminHeaders
                $postCleanupIds = @($postCleanupResponse.endpoints | ForEach-Object { [string]$_.id })
                $notRemoved = @($ownedRemaining | Where-Object { [string]$_.id -in $postCleanupIds })
                if ($notRemoved.Count -gt 0) {
                    throw "$($notRemoved.Count) owned endpoint(s) remained after exact-ID cleanup."
                }
                Write-Warning "The child proof left $($ownedRemaining.Count) owned endpoint(s); the wrapper deleted them by exact ID and will fail."
            }
        }
        catch {
            $cleanupFailed = $true
            Write-Warning "Temporary WIF endpoint cleanup verification failed: $($_.Exception.Message)"
        }
    }
    if ($servicePrincipal) {
        try {
            Invoke-Graph -Method DELETE -Path "servicePrincipals/$($servicePrincipal.id)" | Out-Null
            Write-Host 'Deleted temporary WIF service principal by exact ID.'
        }
        catch {
            $cleanupFailed = $true
            Write-Warning "Temporary WIF service-principal cleanup failed: $($_.Exception.Message)"
        }
    }
    if ($application) {
        try {
            Invoke-Graph -Method DELETE -Path "applications/$($application.id)" | Out-Null
            Write-Host 'Deleted temporary WIF application by exact ID.'
        }
        catch {
            $cleanupFailed = $true
            Write-Warning "Temporary WIF application cleanup failed: $($_.Exception.Message)"
        }
    }
    $env:AZURE_CONFIG_DIR = $originalAzureConfigDir
}

if ($proofExitCode -ne 0 -or $cleanupFailed) {
    exit 1
}
