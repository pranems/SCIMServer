<#
.SYNOPSIS
  Adds the profile-driven forms reference schemas and ResourceType to the named
  dev authentication endpoint.

.DESCRIPTION
  Resolves the active dev estate from scripts/scim-estates.json, acquires an
  admin OAuth token, reads PRTest-Auth-Methods-ISV-1 by name, and performs one
  ETag-protected profile PATCH that:

  - adds a Device custom ResourceType and schema;
  - binds an additive provisioning extension to User;
  - binds an additive provisioning extension to Group.

  The operation is idempotent. Definitions owned by this script are replaced
  by id; every unrelated schema, ResourceType, extension binding, setting,
  authentication method, and ServiceProviderConfig value is preserved.

.EXAMPLE
  pwsh scripts/configure-profile-resource-forms-dev-fixture.ps1 -WhatIf

.EXAMPLE
  pwsh scripts/configure-profile-resource-forms-dev-fixture.ps1

.EXAMPLE
    pwsh scripts/configure-profile-resource-forms-dev-fixture.ps1 -SelfTest
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$EndpointName = 'PRTest-Auth-Methods-ISV-1',
    [string]$ExpectedEndpointId = 'e8edd907-0dfb-415d-b834-abf0d20eb0e0',
    [string]$ClientId = 'scimserver-client',
    [string]$ClientSecret = 'changeme-oauth',
    [string]$BaseUrl,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. "$PSScriptRoot/scim-estates.ps1"

$deviceSchemaUrn = 'urn:scimserver:schemas:core:2.0:Device'
$userExtensionUrn = 'urn:scimserver:schemas:extension:provisioning:2.0:User'
$groupExtensionUrn = 'urn:scimserver:schemas:extension:provisioning:2.0:Group'

function Convert-ResponseContent {
    param([Parameter(Mandatory)]$Response)

    if ($Response.Content -is [byte[]]) {
        return [Text.Encoding]::UTF8.GetString($Response.Content)
    }
    return [string]$Response.Content
}

function Merge-OwnedDefinitions {
    param(
        [Parameter(Mandatory)][object[]]$Existing,
        [Parameter(Mandatory)][object[]]$Owned
    )

    $ownedIds = @($Owned | ForEach-Object { $_.id })
    return @($Existing | Where-Object { $ownedIds -notcontains $_.id }) + @($Owned)
}

function Assert-OwnedResourceTypeIdentity {
    param(
        [Parameter(Mandatory)][object[]]$Existing,
        [Parameter(Mandatory)]$Owned
    )

    $nameConflict = $Existing | Where-Object {
        $_.name -eq $Owned.name -and $_.id -ne $Owned.id
    } | Select-Object -First 1
    if ($nameConflict) {
        throw "ResourceType name '$($Owned.name)' is already claimed by id '$($nameConflict.id)'; refusing to replace a non-owned definition."
    }

    $idConflict = $Existing | Where-Object {
        $_.id -eq $Owned.id -and $_.name -ne $Owned.name
    } | Select-Object -First 1
    if ($idConflict) {
        throw "ResourceType id '$($Owned.id)' is already named '$($idConflict.name)'; refusing an ambiguous owned replacement."
    }
}

function Merge-SchemaBinding {
    param(
        [AllowNull()][object[]]$Existing,
        [Parameter(Mandatory)][string]$Schema
    )

    return @($Existing | Where-Object { $_.schema -ne $Schema }) + @(
        [ordered]@{ schema = $Schema; required = $false }
    )
}

function Test-Condition {
    param([bool]$Success, [string]$Message)

    if (-not $Success) { throw "Verification failed: $Message" }
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function Write-CanonicalJsonElement {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Element,
        [Parameter(Mandatory)][System.Text.Json.Utf8JsonWriter]$Writer
    )

    switch ($Element.ValueKind) {
        ([System.Text.Json.JsonValueKind]::Object) {
            $Writer.WriteStartObject()
            $propertyNames = [Collections.Generic.List[string]]::new()
            foreach ($property in $Element.EnumerateObject()) {
                $propertyNames.Add($property.Name)
            }
            $propertyNames.Sort([StringComparer]::Ordinal)
            foreach ($propertyName in $propertyNames) {
                $Writer.WritePropertyName($propertyName)
                Write-CanonicalJsonElement -Element $Element.GetProperty($propertyName) -Writer $Writer
            }
            $Writer.WriteEndObject()
            break
        }
        ([System.Text.Json.JsonValueKind]::Array) {
            $Writer.WriteStartArray()
            foreach ($item in $Element.EnumerateArray()) {
                Write-CanonicalJsonElement -Element $item -Writer $Writer
            }
            $Writer.WriteEndArray()
            break
        }
        default {
            $Element.WriteTo($Writer)
        }
    }
}

function Get-ValueHash {
    param([AllowNull()]$Value)

    $json = ConvertTo-Json -InputObject $Value -Depth 100 -Compress
    if ([string]::IsNullOrEmpty($json)) { $json = 'null' }
    $document = [System.Text.Json.JsonDocument]::Parse($json)
    $stream = [IO.MemoryStream]::new()
    $writer = [System.Text.Json.Utf8JsonWriter]::new($stream)
    try {
        Write-CanonicalJsonElement -Element $document.RootElement -Writer $writer
        $writer.Flush()
        $bytes = $stream.ToArray()
    } finally {
        $writer.Dispose()
        $stream.Dispose()
        $document.Dispose()
    }
    return ([BitConverter]::ToString(
        [Security.Cryptography.SHA256]::HashData($bytes)
    )).Replace('-', '').ToLowerInvariant()
}

function Copy-WithoutProperty {
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string[]]$Property
    )

    $copy = [ordered]@{}
    foreach ($item in $Value.PSObject.Properties) {
        if ($Property -notcontains $item.Name) { $copy[$item.Name] = $item.Value }
    }
    return $copy
}

if ($SelfTest) {
    Write-Host "`n=== Profile resource forms fixture self-test ===" -ForegroundColor Cyan
    $canonical = [ordered]@{ id = 'Device'; name = 'Device'; endpoint = '/Devices' }
    $unrelated = [ordered]@{ id = 'Printer'; name = 'Printer'; endpoint = '/Printers' }
    $priorCanonical = [ordered]@{ id = 'Device'; name = 'Device'; endpoint = '/OldDevices' }

    Assert-OwnedResourceTypeIdentity -Existing @($unrelated, $priorCanonical) -Owned $canonical
    $merged = @(Merge-OwnedDefinitions -Existing @($unrelated, $priorCanonical) -Owned @($canonical))
    Test-Condition ($merged.Count -eq 2) 'canonical rerun replaces rather than duplicates Device'
    Test-Condition (($merged | Where-Object id -eq 'Printer').endpoint -eq '/Printers') 'canonical rerun preserves unrelated ResourceTypes'
    Test-Condition (($merged | Where-Object id -eq 'Device').endpoint -eq '/Devices') 'canonical rerun converges Device to the declared definition'

    $conflictRejected = $false
    try {
        Assert-OwnedResourceTypeIdentity `
            -Existing @([ordered]@{ id = 'LegacyDevice'; name = 'Device'; endpoint = '/LegacyDevices' }) `
            -Owned $canonical
    } catch {
        $conflictRejected = $_.Exception.Message -like "*name 'Device'*id 'LegacyDevice'*"
    }
    Test-Condition $conflictRejected 'same-name Device with a different id is rejected before mutation'

    $reverseConflictRejected = $false
    try {
        Assert-OwnedResourceTypeIdentity `
            -Existing @([ordered]@{ id = 'Device'; name = 'LegacyDevice'; endpoint = '/LegacyDevices' }) `
            -Owned $canonical
    } catch {
        $reverseConflictRejected = $_.Exception.Message -like "*id 'Device'*named 'LegacyDevice'*"
    }
    Test-Condition $reverseConflictRejected 'Device id with a different name is rejected before mutation'

    $orderedOne = [ordered]@{
        id         = 'Device'
        enabled    = $true
        count      = 7
        ratio      = 1.25
        optional   = $null
        attributes = @(
            [ordered]@{ name = 'serialNumber'; required = $true }
            [ordered]@{ name = 'riskScore'; required = $false }
        )
    }
    $orderedTwo = [ordered]@{
        attributes = @(
            [ordered]@{ required = $true; name = 'serialNumber' }
            [ordered]@{ required = $false; name = 'riskScore' }
        )
        optional = $null
        ratio    = 1.25
        count    = 7
        enabled  = $true
        id       = 'Device'
    }
    Test-Condition ((Get-ValueHash $orderedOne) -eq (Get-ValueHash $orderedTwo)) 'semantic hashes ignore object property order'

    $reorderedArray = [ordered]@{
        id         = 'Device'
        enabled    = $true
        count      = 7
        ratio      = 1.25
        optional   = $null
        attributes = @(
            [ordered]@{ name = 'riskScore'; required = $false }
            [ordered]@{ name = 'serialNumber'; required = $true }
        )
    }
    Test-Condition ((Get-ValueHash $orderedOne) -ne (Get-ValueHash $reorderedArray)) 'semantic hashes preserve array order'

    $changedScalar = [ordered]@{
        id         = 'Device'
        enabled    = $false
        count      = 7
        ratio      = 1.25
        optional   = $null
        attributes = $orderedOne.attributes
    }
    Test-Condition ((Get-ValueHash $orderedOne) -ne (Get-ValueHash $changedScalar)) 'semantic hashes preserve scalar values'
    Write-Host 'Fixture self-test complete.' -ForegroundColor Green
    return
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = Get-ScimEstateBaseUrl -Purpose dev
}
$BaseUrl = $BaseUrl.TrimEnd('/')
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    throw 'The active dev estate did not resolve to a base URL.'
}

$tokenResponse = Invoke-RestMethod `
    -Uri "$BaseUrl/scim/oauth/token" `
    -Method Post `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{
        grant_type    = 'client_credentials'
        client_id     = $ClientId
        client_secret = $ClientSecret
    } `
    -TimeoutSec 60
if ([string]::IsNullOrWhiteSpace($tokenResponse.access_token)) {
    throw 'OAuth token response did not include access_token.'
}

$headers = @{
    Authorization = "Bearer $($tokenResponse.access_token)"
    Accept        = 'application/json'
}
$encodedName = [Uri]::EscapeDataString($EndpointName)
$byNameResponse = Invoke-WebRequest `
    -Uri "$BaseUrl/scim/admin/endpoints/by-name/$encodedName`?view=full" `
    -Method Get `
    -Headers $headers `
    -TimeoutSec 60
$resolvedEndpoint = (Convert-ResponseContent $byNameResponse) | ConvertFrom-Json -Depth 100
if ($resolvedEndpoint.name -ne $EndpointName) {
    throw "Endpoint lookup returned '$($resolvedEndpoint.name)', expected '$EndpointName'."
}
if ($ExpectedEndpointId -and $resolvedEndpoint.id -ne $ExpectedEndpointId) {
    throw "Endpoint '$EndpointName' resolved to '$($resolvedEndpoint.id)', expected '$ExpectedEndpointId'."
}
$endpointResponse = Invoke-WebRequest `
    -Uri "$BaseUrl/scim/admin/endpoints/$($resolvedEndpoint.id)?view=full" `
    -Method Get `
    -Headers $headers `
    -TimeoutSec 60
$endpoint = (Convert-ResponseContent $endpointResponse) | ConvertFrom-Json -Depth 100
$expectedResolvedId = [string]$resolvedEndpoint.id
if ($endpoint.id -ne $expectedResolvedId) {
    throw "Endpoint GET by id returned '$($endpoint.id)', expected '$expectedResolvedId'."
}
$etag = [string]$endpointResponse.Headers.ETag
if ([string]::IsNullOrWhiteSpace($etag)) {
    throw "Endpoint GET by id returned no ETag; refusing an unconditional profile-array replacement."
}

$ownedSchemas = @(
    [ordered]@{
        id          = $deviceSchemaUrn
        name        = 'Device'
        description = 'Device resources used by profile-driven form and Workbench examples.'
        attributes  = @(
            [ordered]@{ name = 'serialNumber'; type = 'string'; required = $true; multiValued = $false; caseExact = $true; mutability = 'readWrite'; returned = 'default'; uniqueness = 'server' },
            [ordered]@{ name = 'displayName'; type = 'string'; required = $false; multiValued = $false; caseExact = $false; mutability = 'readWrite'; returned = 'default'; uniqueness = 'none' },
            [ordered]@{ name = 'compliant'; type = 'boolean'; required = $false; multiValued = $false; mutability = 'readWrite'; returned = 'default' },
            [ordered]@{ name = 'platform'; type = 'string'; required = $false; multiValued = $false; mutability = 'readWrite'; returned = 'default'; canonicalValues = @('Windows', 'macOS', 'Linux', 'iOS', 'Android') },
            [ordered]@{ name = 'riskScore'; type = 'decimal'; required = $false; multiValued = $false; mutability = 'readWrite'; returned = 'default' }
        )
    },
    [ordered]@{
        id          = $userExtensionUrn
        name        = 'ProvisioningUser'
        description = 'Additive User attributes used by profile-driven forms examples.'
        attributes  = @(
            [ordered]@{ name = 'employeeNumber'; type = 'string'; required = $false; multiValued = $false; caseExact = $true; mutability = 'readWrite'; returned = 'default'; uniqueness = 'none' },
            [ordered]@{ name = 'department'; type = 'string'; required = $false; multiValued = $false; caseExact = $false; mutability = 'readWrite'; returned = 'default'; uniqueness = 'none' },
            [ordered]@{ name = 'costCenter'; type = 'string'; required = $false; multiValued = $false; caseExact = $true; mutability = 'readWrite'; returned = 'default'; uniqueness = 'none' }
        )
    },
    [ordered]@{
        id          = $groupExtensionUrn
        name        = 'ProvisioningGroup'
        description = 'Additive Group attributes used by profile-driven forms examples.'
        attributes  = @(
            [ordered]@{ name = 'owner'; type = 'string'; required = $false; multiValued = $false; caseExact = $true; mutability = 'readWrite'; returned = 'default'; uniqueness = 'none' },
            [ordered]@{ name = 'costCenter'; type = 'string'; required = $false; multiValued = $false; caseExact = $true; mutability = 'readWrite'; returned = 'default'; uniqueness = 'none' },
            [ordered]@{ name = 'lifecycleState'; type = 'string'; required = $false; multiValued = $false; caseExact = $false; mutability = 'readWrite'; returned = 'default'; canonicalValues = @('Active', 'Archived') }
        )
    }
)

$existingResourceTypes = @($endpoint.profile.resourceTypes)
$userType = $existingResourceTypes | Where-Object { $_.name -eq 'User' } | Select-Object -First 1
$groupType = $existingResourceTypes | Where-Object { $_.name -eq 'Group' } | Select-Object -First 1
if (-not $userType -or -not $groupType) {
    throw "Endpoint '$EndpointName' must declare both User and Group ResourceTypes."
}
$ownedSchemaIds = @($deviceSchemaUrn, $userExtensionUrn, $groupExtensionUrn)
$preservedBefore = [ordered]@{
    settings                 = Get-ValueHash $endpoint.profile.settings
    authentication           = Get-ValueHash $endpoint.profile.authentication
    serviceProviderConfig    = Get-ValueHash $endpoint.profile.serviceProviderConfig
    nonOwnedSchemas          = Get-ValueHash @($endpoint.profile.schemas | Where-Object { $ownedSchemaIds -notcontains $_.id })
    nonOwnedResourceTypes    = Get-ValueHash @($existingResourceTypes | Where-Object { $_.name -notin @('User', 'Group', 'Device') })
    userDefinition           = Get-ValueHash (Copy-WithoutProperty $userType @('schemaExtensions'))
    groupDefinition          = Get-ValueHash (Copy-WithoutProperty $groupType @('schemaExtensions'))
    userExtensionBindings    = Get-ValueHash @($userType.schemaExtensions | Where-Object { $_.schema -ne $userExtensionUrn })
    groupExtensionBindings   = Get-ValueHash @($groupType.schemaExtensions | Where-Object { $_.schema -ne $groupExtensionUrn })
}
$userType.schemaExtensions = @(Merge-SchemaBinding -Existing @($userType.schemaExtensions) -Schema $userExtensionUrn)
$groupType.schemaExtensions = @(Merge-SchemaBinding -Existing @($groupType.schemaExtensions) -Schema $groupExtensionUrn)

$deviceResourceType = [ordered]@{
    id               = 'Device'
    name             = 'Device'
    endpoint         = '/Devices'
    description      = 'Device resources used by profile-driven Workbench examples.'
    schema           = $deviceSchemaUrn
    schemaExtensions = @()
}
Assert-OwnedResourceTypeIdentity -Existing $existingResourceTypes -Owned $deviceResourceType
$mergedSchemas = Merge-OwnedDefinitions -Existing @($endpoint.profile.schemas) -Owned $ownedSchemas
$mergedResourceTypes = Merge-OwnedDefinitions -Existing $existingResourceTypes -Owned @($deviceResourceType)
$patch = [ordered]@{
    profile = [ordered]@{
        schemas       = $mergedSchemas
        resourceTypes = $mergedResourceTypes
    }
}

Write-Host "`n=== Profile resource forms dev fixture ===" -ForegroundColor Cyan
Write-Host "  estate   : $BaseUrl"
Write-Host "  endpoint : $EndpointName ($($endpoint.id))"
Write-Host "  schemas  : $(@($endpoint.profile.schemas).Count) -> $($mergedSchemas.Count)"
Write-Host "  types    : $($existingResourceTypes.Count) -> $($mergedResourceTypes.Count)"

if (-not $PSCmdlet.ShouldProcess(
    "$BaseUrl/scim/admin/endpoints/$($endpoint.id)",
    'Add Device ResourceType and User/Group provisioning extensions'
)) {
    Write-Host 'No mutation performed.' -ForegroundColor Yellow
    return
}

$writeHeaders = @{
    Authorization  = $headers.Authorization
    Accept         = 'application/json'
    'Content-Type' = 'application/json'
}
$writeHeaders['If-Match'] = $etag
Invoke-RestMethod `
    -Uri "$BaseUrl/scim/admin/endpoints/$($endpoint.id)" `
    -Method Patch `
    -Headers $writeHeaders `
    -Body ($patch | ConvertTo-Json -Depth 100) `
    -TimeoutSec 60 | Out-Null

$verified = Invoke-RestMethod `
    -Uri "$BaseUrl/scim/admin/endpoints/$($endpoint.id)?view=full" `
    -Method Get `
    -Headers $headers `
    -TimeoutSec 60
$publicSchemas = Invoke-RestMethod `
    -Uri "$BaseUrl/scim/endpoints/$($endpoint.id)/Schemas" `
    -Method Get `
    -Headers $headers `
    -TimeoutSec 60
$publicTypes = Invoke-RestMethod `
    -Uri "$BaseUrl/scim/endpoints/$($endpoint.id)/ResourceTypes" `
    -Method Get `
    -Headers $headers `
    -TimeoutSec 60

$verifiedUser = $verified.profile.resourceTypes | Where-Object name -eq 'User'
$verifiedGroup = $verified.profile.resourceTypes | Where-Object name -eq 'Group'
$preservedAfter = [ordered]@{
    settings                 = Get-ValueHash $verified.profile.settings
    authentication           = Get-ValueHash $verified.profile.authentication
    serviceProviderConfig    = Get-ValueHash $verified.profile.serviceProviderConfig
    nonOwnedSchemas          = Get-ValueHash @($verified.profile.schemas | Where-Object { $ownedSchemaIds -notcontains $_.id })
    nonOwnedResourceTypes    = Get-ValueHash @($verified.profile.resourceTypes | Where-Object { $_.name -notin @('User', 'Group') -and $_.id -ne $deviceResourceType.id })
    userDefinition           = Get-ValueHash (Copy-WithoutProperty $verifiedUser @('schemaExtensions'))
    groupDefinition          = Get-ValueHash (Copy-WithoutProperty $verifiedGroup @('schemaExtensions'))
    userExtensionBindings    = Get-ValueHash @($verifiedUser.schemaExtensions | Where-Object { $_.schema -ne $userExtensionUrn })
    groupExtensionBindings   = Get-ValueHash @($verifiedGroup.schemaExtensions | Where-Object { $_.schema -ne $groupExtensionUrn })
}
$ownedAfter = [ordered]@{
    schemas      = Get-ValueHash @($verified.profile.schemas | Where-Object { $ownedSchemaIds -contains $_.id })
    resourceType = Get-ValueHash ($verified.profile.resourceTypes | Where-Object id -eq $deviceResourceType.id)
}
$ownedExpected = [ordered]@{
    schemas      = Get-ValueHash $ownedSchemas
    resourceType = Get-ValueHash $deviceResourceType
}
Test-Condition (($publicSchemas.Resources.id -contains $deviceSchemaUrn)) 'Device schema is published'
Test-Condition (($publicSchemas.Resources.id -contains $userExtensionUrn)) 'User extension schema is published'
Test-Condition (($publicSchemas.Resources.id -contains $groupExtensionUrn)) 'Group extension schema is published'
Test-Condition (($publicTypes.Resources.id -contains $deviceResourceType.id)) 'Device ResourceType is published'
Test-Condition (($verifiedUser.schemaExtensions.schema -contains $userExtensionUrn)) 'User binds the provisioning extension'
Test-Condition (($verifiedGroup.schemaExtensions.schema -contains $groupExtensionUrn)) 'Group binds the provisioning extension'
foreach ($key in $preservedBefore.Keys) {
    Test-Condition ($preservedBefore[$key] -eq $preservedAfter[$key]) "$key remained byte-canonically unchanged"
}
foreach ($key in $ownedExpected.Keys) {
    Test-Condition ($ownedExpected[$key] -eq $ownedAfter[$key]) "owned $key converged to the exact declared definition"
}
Write-Host 'Fixture configuration complete.' -ForegroundColor Green