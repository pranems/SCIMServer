[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'az-tenant.ps1')
$registryPath = Join-Path $PSScriptRoot 'scim-estates.json'
$registry = Get-Content $registryPath -Raw | ConvertFrom-Json
$temporary = [IO.Path]::GetTempFileName()
$count = 0
function Assert-Resolution([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:count++
    Write-Host "PASS: $Message"
}
try {
    $map = Get-ScimTenantMap
    foreach ($tenant in $registry.tenants) {
        $entry = $map[$tenant.key]
        Assert-Resolution ($entry.Tenant -eq $tenant.tenantId) "$($tenant.key) tenant ID matches registry"
        Assert-Resolution ($entry.SubscriptionId -eq $tenant.subscriptionId) "$($tenant.key) subscription ID matches registry"
        Assert-Resolution ($entry.Status -eq $tenant.role) "$($tenant.key) role matches registry"
    }
    foreach ($selector in @(
        @{ file = 'setup-deploy-sp.ps1'; parameter = 'Name' },
        @{ file = 'setup-auth-proof-apps.ps1'; parameter = 'Tenant' },
        @{ file = 'grant-deploy-sp-directory-access.ps1'; parameter = 'Tenant' }
    )) {
        $command = Get-Command (Join-Path $PSScriptRoot $selector.file)
        $values = @($command.Parameters[$selector.parameter].Attributes |
            Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] } |
            ForEach-Object ValidValues)
        Assert-Resolution ($values -contains 'proviam10') "$($selector.file) accepts the target tenant key"
    }
    $setupSource = Get-Content (Join-Path $PSScriptRoot 'setup-deploy-sp.ps1') -Raw
    Assert-Resolution ($setupSource -match 'az account set --subscription \$Entry\.SubscriptionId\b') 'deployment bootstrap selects the exact subscription ID'
    $future = [pscustomobject]@{
        key = 'resolution-test'
        role = 'next'
        tenantName = 'Synthetic registry tenant'
        tenantDomain = 'resolution-test.onmicrosoft.com'
        tenantId = '11111111-1111-4111-8111-111111111111'
        subscriptionName = 'Synthetic subscription'
        subscriptionId = '22222222-2222-4222-8222-222222222222'
        deploySpName = 'synthetic-deploy'
        deploySpAppId = ''
        configDir = '~/.azure-resolution-test'
        userConfigDir = '~/.azure-resolution-test-user'
        credFile = '~/.scimserver-deploy/resolution-test.json'
    }
    $registry.tenants += $future
    $registry.estates += [pscustomobject]@{
        id = 'resolution-next'
        purpose = 'dev'
        tenantKey = $future.key
        appName = 'synthetic-app'
        resourceGroup = 'synthetic-dev'
        environmentResourceGroup = 'synthetic-shared'
        revisionKeep = 2
    }
    $registry | ConvertTo-Json -Depth 30 | Set-Content $temporary
    $entry = (Get-ScimTenantMap -Path $temporary)[$future.key]
    Assert-Resolution ($null -ne $entry) 'new registry tenant resolves without editing the helper'
    Assert-Resolution ($entry.Tenant -eq $future.tenantId) 'new tenant identity is not substituted'
    Assert-Resolution ($entry.ConfigDir -eq (Join-Path $HOME '.azure-resolution-test')) 'isolated automation path expands'
    Assert-Resolution ($entry.UserConfigDir -eq (Join-Path $HOME '.azure-resolution-test-user')) 'isolated user path expands'
    Assert-Resolution ($entry.Scopes -contains 'synthetic-dev') 'app resource group is included in deployment scope'
    Assert-Resolution ($entry.Scopes -contains 'synthetic-shared') 'shared environment resource group is included in deployment scope'
    Assert-Resolution ($entry.Estates['synthetic-app'] -eq 'synthetic-dev') 'app mapping preserves its resource group'
    $bad = $temporary + '.missing'
    $rejected = $false
    try { $null = Get-ScimTenantMap -Path $bad }
    catch [System.Management.Automation.RuntimeException] { $rejected = $true }
    Assert-Resolution $rejected 'missing registry fails explicitly instead of using a stale hardcoded map'
    Write-Host "PASS: $count tenant registry resolution assertions"
}
finally { Remove-Item -LiteralPath $temporary }
