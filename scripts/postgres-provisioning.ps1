. (Join-Path $PSScriptRoot 'tenant-copy-safety.ps1')

function Assert-ScimPostgresTargetAbsent {
    param(
        [Parameter(Mandatory)][string]$ServerName,
        [Parameter(Mandatory)][string]$ResourceGroup,
        [Parameter(Mandatory)][string]$SubscriptionId
    )
    $result = & az postgres flexible-server show --resource-group $ResourceGroup --name $ServerName `
        --subscription $SubscriptionId --output json --only-show-errors 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        throw 'Target PostgreSQL exists or its read returned no explicit absence; refusing replacement or password reset.'
    }
    if (($result -join "`n") -notmatch '\(ResourceNotFound\)') {
        throw "Target PostgreSQL absence could not be established: $($result -join "`n")"
    }
}

function Invoke-ScimPostgresProvisioning {
    param(
        [Parameter(Mandatory)][string]$ServerName,
        [Parameter(Mandatory)][string]$ResourceGroup,
        [Parameter(Mandatory)][string]$Location,
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$TenantId,
        [Parameter(Mandatory)][string]$Password,
        [Parameter(Mandatory)][string]$TemplatePath,
        [string]$AdminLogin = 'scimadmin',
        [string]$DatabaseName = 'scimdb',
        [string]$AvailabilityZone,
        [string]$SkuName = 'Standard_B1ms',
        [string]$SkuTier = 'Burstable',
        [string]$RecoveryRoot = (Join-Path $HOME '.scimserver-deploy')
    )
    $ErrorActionPreference = 'Stop'
    $account = Invoke-CopyAzJson -Arguments @('account', 'show')
    if ($account.id -ne $SubscriptionId -or $account.tenantId -ne $TenantId) {
        throw 'PostgreSQL provisioning identity does not match the expected tenant/subscription.'
    }
    Assert-ScimPostgresTargetAbsent -ServerName $ServerName -ResourceGroup $ResourceGroup -SubscriptionId $SubscriptionId
    $directory = Join-Path ([IO.Path]::GetTempPath()) ('scim-pg-parameters-' + [guid]::NewGuid().ToString('N'))
    $path = Join-Path $directory 'parameters.json'
    $provisionFailure = $null
    $cleanupFailures = [System.Collections.Generic.List[System.Management.Automation.ErrorRecord]]::new()
    try {
        Initialize-CopyPrivateDirectory -Path $directory
        $recoveryDirectory = Join-Path $RecoveryRoot ('postgres-' + [guid]::NewGuid().ToString('N'))
        Initialize-CopyPrivateDirectory -Path $recoveryDirectory
        $recoveryPath = Join-Path $recoveryDirectory 'credential.json'
        $recovery = @{
            tenantId = $TenantId; subscriptionId = $SubscriptionId
            resourceGroup = $ResourceGroup; serverName = $ServerName
            databaseName = $DatabaseName; adminLogin = $AdminLogin; password = $Password
        }
        $recovery | ConvertTo-Json | Set-Content -LiteralPath $recoveryPath -Encoding utf8
        $saved = Get-Content -LiteralPath $recoveryPath -Raw | ConvertFrom-Json
        foreach ($key in $recovery.Keys) {
            if ($saved.$key -cne $recovery[$key]) { throw 'Private PostgreSQL credential recovery verification failed before allocation.' }
        }
        $parameters = @{
            '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
            contentVersion = '1.0.0.0'
            parameters = @{
                serverName = @{ value = $ServerName }
                adminLogin = @{ value = $AdminLogin }
                adminPassword = @{ value = $Password }
                databaseName = @{ value = $DatabaseName }
                location = @{ value = $Location }
                skuName = @{ value = $SkuName }
                skuTier = @{ value = $SkuTier }
            }
        }
        if ($AvailabilityZone) { $parameters.parameters.availabilityZone = @{ value = $AvailabilityZone } }
        $parameters | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding utf8
        $deployment = Invoke-CopyAzJson -Arguments @(
            'deployment', 'group', 'create', '--resource-group', $ResourceGroup,
            '--subscription', $SubscriptionId, '--name', ('postgres-' + [guid]::NewGuid().ToString('N')),
            '--template-file', $TemplatePath, '--parameters', ('@' + $path)
        )
        $outputs = $deployment.properties.outputs
        $fqdn = [string]$outputs.serverFqdn.value
        if ($outputs.serverName.value -ne $ServerName -or $outputs.databaseName.value -ne $DatabaseName -or
            [Uri]::CheckHostName($fqdn) -ne [UriHostNameType]::Dns) {
            throw 'PostgreSQL deployment outputs are incomplete or do not match the expected server/database.'
        }
        $databaseUrl = 'postgresql://{0}:{1}@{2}:5432/{3}?sslmode=require' -f
            [Uri]::EscapeDataString($AdminLogin), [Uri]::EscapeDataString($Password), $fqdn,
            [Uri]::EscapeDataString($DatabaseName)
        $connectionPath = Join-Path $recoveryDirectory 'connection.json'
        @{ databaseUrl = $databaseUrl } | ConvertTo-Json | Set-Content -LiteralPath $connectionPath -Encoding utf8
        if ((Get-Content -LiteralPath $connectionPath -Raw | ConvertFrom-Json).databaseUrl -cne $databaseUrl) {
            throw 'Private PostgreSQL connection recovery verification failed.'
        }
        $result = [pscustomobject]@{ ServerFqdn = $fqdn; DatabaseUrl = $databaseUrl; RecoveryPath = $recoveryPath }
    } catch {
        $provisionFailure = $_
    } finally {
        foreach ($cleanupPath in @($path, $directory)) {
            try {
                if (Test-Path -LiteralPath $cleanupPath) { Remove-Item -LiteralPath $cleanupPath -Force }
            } catch { $cleanupFailures.Add($_) }
        }
    }
    foreach ($failure in $cleanupFailures) { Write-Warning "PostgreSQL parameter cleanup failed: $($failure.Exception.Message)" }
    if ($provisionFailure) { throw $provisionFailure }
    if ($cleanupFailures.Count) { throw $cleanupFailures[0] }
    return $result
}
