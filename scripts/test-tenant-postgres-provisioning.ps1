[CmdletBinding()]
param([Parameter(Mandatory)][string]$BicepPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$compiled = Join-Path ([IO.Path]::GetTempPath()) ("scim-pg-template-" + [guid]::NewGuid().ToString('N') + '.json')
$recoveryRoot = Join-Path ([IO.Path]::GetTempPath()) ('scim-pg-recovery-test-' + [guid]::NewGuid().ToString('N'))
try {
    & $BicepPath build (Join-Path $root 'infra\postgres.bicep') --outfile $compiled
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL template compilation failed.' }
    $template = Get-Content -LiteralPath $compiled -Raw | ConvertFrom-Json
    if (($template.outputs | ConvertTo-Json -Depth 10).Contains("parameters('adminPassword')")) {
        throw 'RED: PostgreSQL ARM outputs disclose the administrator password.'
    }
    . (Join-Path $PSScriptRoot 'postgres-provisioning.ps1')
    $global:pgProvisionTest = @{ Secret = 'Synthetic%40:password!'; ParameterPath = $null; Mode = 'success' }
    function global:az {
        $global:LASTEXITCODE = 0
        if ($args[0] -eq 'account') {
            return '{"id":"test-subscription","tenantId":"test-tenant"}'
        }
        if ($args[0] -eq 'postgres') {
            $global:LASTEXITCODE = 1
            return '(ResourceNotFound) Synthetic PostgreSQL server is absent.'
        }
        if (($args -join ' ').Contains($global:pgProvisionTest.Secret)) {
            throw 'Secret entered native command-line arguments.'
        }
        $index = [array]::IndexOf($args, '--parameters')
        $path = ([string]$args[$index + 1]).TrimStart('@')
        $global:pgProvisionTest.ParameterPath = $path
        $parameters = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($parameters.parameters.adminPassword.value -ne $global:pgProvisionTest.Secret) {
            throw 'Private parameter file does not carry the exact password.'
        }
        if ($global:pgProvisionTest.Mode -eq 'zone-success' -and $parameters.parameters.availabilityZone.value -ne '1') {
            throw 'Explicit availability-zone placement was not transmitted.'
        }
        if ($global:pgProvisionTest.Mode -eq 'sku-success' -and $parameters.parameters.skuName.value -ne 'Standard_B2s') {
            throw 'The deliberately selected SKU was not transmitted.'
        }
        if ($IsWindows) {
            $acl = Get-Acl -LiteralPath (Split-Path $path)
            if (-not $acl.AreAccessRulesProtected -or $acl.Access.Count -ne 1) { throw 'Parameter directory is not private.' }
        }
        if ($global:pgProvisionTest.Mode -eq 'failure') { $global:LASTEXITCODE = 1; return }
        if ($global:pgProvisionTest.Mode -eq 'missing-output') { return '{"properties":{"outputs":{}}}' }
        return '{"properties":{"outputs":{"serverName":{"value":"fixture-pg"},"serverFqdn":{"value":"fixture-pg.postgres.database.azure.com"},"databaseName":{"value":"scimdb"}}}}'
    }
    foreach ($mode in @('success', 'zone-success', 'sku-success', 'failure', 'missing-output')) {
        $global:pgProvisionTest.Mode = $mode
        $rejected = $false
        try {
            $zone = if ($mode -eq 'zone-success') { '1' } else { '' }
            $skuArguments = if ($mode -eq 'sku-success') { @{ SkuName = 'Standard_B2s' } } else { @{} }
            $result = Invoke-ScimPostgresProvisioning -ServerName fixture-pg -ResourceGroup fixture-rg -Location eastus2 `
                -SubscriptionId test-subscription -TenantId test-tenant -Password $global:pgProvisionTest.Secret `
                -TemplatePath (Join-Path $root 'infra\postgres.bicep') -AvailabilityZone $zone `
                -RecoveryRoot $recoveryRoot @skuArguments
            if ($mode -like '*success' -and $result.DatabaseUrl -notlike '*Synthetic%2540%3Apassword%21*') {
                throw 'Password URI encoding changed its value.'
            }
            if ($mode -like '*success') {
                $saved = Get-Content -LiteralPath (Join-Path (Split-Path $result.RecoveryPath) 'connection.json') -Raw | ConvertFrom-Json
                if ($saved.databaseUrl -cne $result.DatabaseUrl) { throw 'Connection recovery was not saved before returning.' }
                $credential = Get-Content -LiteralPath $result.RecoveryPath -Raw | ConvertFrom-Json
                if ($credential.password -cne $global:pgProvisionTest.Secret) { throw 'Immutable credential recovery changed.' }
            }
        } catch {
            if ($_.Exception.Message -notmatch 'Azure deployment group failed|PostgreSQL deployment outputs are incomplete') { throw }
            $rejected = $true
        }
        if (($mode -like '*success') -eq $rejected) { throw "Incorrect $mode outcome." }
        if (Test-Path -LiteralPath (Split-Path $global:pgProvisionTest.ParameterPath)) {
            throw 'Private secret parameter directory survives provisioning.'
        }
        Write-Host "PASS: $mode outcome verified with private parameters, no secret argument and complete cleanup"
    }
} finally {
    if (Test-Path -LiteralPath $compiled) { Remove-Item -LiteralPath $compiled }
    if (Test-Path -LiteralPath $recoveryRoot) { Remove-Item -LiteralPath $recoveryRoot -Recurse -Force }
    Remove-Item Function:\az -ErrorAction SilentlyContinue
    Remove-Variable pgProvisionTest -Scope Global -ErrorAction SilentlyContinue
}
