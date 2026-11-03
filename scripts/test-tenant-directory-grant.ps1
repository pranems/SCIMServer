[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'az-tenant.ps1')
$global:grantTestEntry = (Get-ScimTenantMap)['proviam10']
$global:grantTestCalls = [System.Collections.Generic.List[string]]::new()
$global:grantTestFailConsent = $false
$global:grantTestAssigned = $false
$global:grantTestRequestCount = 0
function az {
    $command = $args -join ' '
    $global:grantTestCalls.Add($command)
    $global:LASTEXITCODE = 0
    if ($command -like 'account show*') {
        return ([pscustomobject]@{ id=$global:grantTestEntry.SubscriptionId; tenantId=$global:grantTestEntry.Tenant; user=@{type='user';name='synthetic-admin'} } | ConvertTo-Json)
    }
    if ($command -like 'ad sp show*00000003-0000-0000-c000-000000000000*') {
        return '{"id":"graph-sp","appRoles":[{"id":"owned-role","value":"Application.ReadWrite.OwnedBy","isEnabled":true,"allowedMemberTypes":["Application"]}]}'
    }
    if ($command -like 'ad sp show*') { return '{"id":"deploy-sp"}' }
    if ($command -like 'ad app permission list*') {
        if ($global:grantTestRequestCount -eq 0) { return '[]' }
        $access = @(1..$global:grantTestRequestCount | ForEach-Object { @{id='owned-role';type='Role'} })
        return (ConvertTo-Json -InputObject @(@{resourceAppId='00000003-0000-0000-c000-000000000000';resourceAccess=$access}) -Depth 6)
    }
    if ($command -like 'ad app permission add*') { $global:grantTestRequestCount++; return }
    if ($command -like 'ad app update*--required-resource-accesses*') {
        $index = [Array]::IndexOf($args, '--required-resource-accesses')
        $path = $args[$index + 1].TrimStart('@')
        $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $global:grantTestRequestCount = @($manifest.resourceAccess | Where-Object id -eq 'owned-role').Count
        return
    }
    if ($command -like 'ad app permission admin-consent*') {
        if ($global:grantTestFailConsent) { $global:LASTEXITCODE=1 }
        return
    }
    if ($command -like 'rest*--method post*') {
        if ($global:grantTestFailConsent) { $global:LASTEXITCODE=1; return }
        $global:grantTestAssigned = $true
        return
    }
    if ($command -like 'rest*') {
        if ($global:grantTestAssigned) { return '{"value":[{"resourceId":"graph-sp","appRoleId":"owned-role"}]}' }
        return '{"value":[]}'
    }
    throw "Unexpected mock command: $command"
}
& (Join-Path $PSScriptRoot 'grant-deploy-sp-directory-access.ps1') -Tenant proviam10 -Permission Application.ReadWrite.OwnedBy
if (@($global:grantTestCalls | Where-Object { $_ -like '*permission add*owned-role=Role*' }).Count -ne 1) {
    throw 'Grant does not use the role resolved by its application permission name.'
}
if (@($global:grantTestCalls | Where-Object { $_ -like 'rest*--method post*appRoleAssignments*' }).Count -ne 1 -or
    @($global:grantTestCalls | Where-Object { $_ -like 'rest*--method get*appRoleAssignments*' }).Count -lt 2) {
    throw 'Effective role assignment was not verified independently of requested permissions.'
}
Write-Host 'PASS: owned-app role is resolved by name, requested, consented and verified'
$global:grantTestFailConsent = $true
$global:grantTestAssigned = $false
$rejected = $false
try {
    & (Join-Path $PSScriptRoot 'grant-deploy-sp-directory-access.ps1') -Tenant proviam10 -Permission Application.ReadWrite.OwnedBy
} catch [System.Management.Automation.RuntimeException] {
    if ($_.Exception.Message -notmatch 'consent') { throw }
    $rejected = $true
}
if (-not $rejected) { throw 'Admin-consent failure was reported as success.' }
Write-Host 'PASS: failed admin consent blocks success'
$global:grantTestFailConsent = $false
$global:grantTestAssigned = $true
$global:grantTestRequestCount = 2
$addsBefore = @($global:grantTestCalls | Where-Object { $_ -like 'ad app permission add*' }).Count
& (Join-Path $PSScriptRoot 'grant-deploy-sp-directory-access.ps1') -Tenant proviam10 -Permission Application.ReadWrite.OwnedBy
if ($global:grantTestRequestCount -ne 1) { throw 'Duplicate role requests were not reconciled.' }
& (Join-Path $PSScriptRoot 'grant-deploy-sp-directory-access.ps1') -Tenant proviam10 -Permission Application.ReadWrite.OwnedBy
if ($global:grantTestRequestCount -ne 1 -or @($global:grantTestCalls | Where-Object { $_ -like 'ad app permission add*' }).Count -ne $addsBefore) {
    throw 'Repeated consent bootstrap is not idempotent.'
}
Write-Host 'PASS: duplicate requests reconcile to one and repeated bootstrap adds nothing'
