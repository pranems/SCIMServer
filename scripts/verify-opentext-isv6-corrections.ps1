<#
.SYNOPSIS
  Verifies the applied OpenText ISV-6 discovery corrections without mutating it.

.DESCRIPTION
  Resolves the estate through scripts/scim-estates.ps1, reads the endpoint's
  full admin profile plus public Schemas and ServiceProviderConfig, and fails if
  any corrected characteristic or protected profile section has drifted.

  The protected-section hashes are the values captured immediately after the
  2026-09-15 schema-only PATCH. They prove later edits did not silently change
  resourceTypes, authentication, or settings while correcting schemas.

.EXAMPLE
  pwsh scripts/verify-opentext-isv6-corrections.ps1

.EXAMPLE
  pwsh scripts/verify-opentext-isv6-corrections.ps1 -Purpose customer-prod -Token changeme-scim
#>
[CmdletBinding()]
param(
    [string]$Purpose = 'customer-prod',
    [string]$EndpointId = '10d6845a-a1fd-4151-aab0-3d7b0c5f0e01',
    [string]$Token = 'changeme-scim',
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/scim-estates.ps1"

$expectedHashes = [ordered]@{
    schemas        = '56fb6d0aa6cacec16dea046b55b14c721dbaa8dd8246f2510d584664c19894cc'
    resourceTypes  = 'c2b80e82d9bc5b52fef87014217fb997479f55ff761547faf4825a49f15609d5'
    authentication = '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b'
    settings       = 'e1dd96cccc3ee2cae4bc74a2a0d57de14597599dc2977676e943c17a4a4eee2e'
}

function Get-ValueHash {
    param([AllowNull()]$Value)

    $json = $Value | ConvertTo-Json -Depth 100 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($bytes))).Replace('-', '').ToLowerInvariant()
}

function Test-Invariant {
    param(
        [bool]$Success,
        [string]$Name,
        [string]$Detail
    )

    $script:checks[$Name] = [ordered]@{ passed = $Success; detail = $Detail }
    if (-not $Quiet) {
        $color = if ($Success) { 'Green' } else { 'Red' }
        $status = if ($Success) { 'PASS' } else { 'FAIL' }
        Write-Host "  $status  $Name - $Detail" -ForegroundColor $color
    }
}

$baseUrl = Get-ScimEstateBaseUrl -Purpose $Purpose
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    throw "Estate purpose '$Purpose' did not resolve to a base URL."
}

$headers = @{ Authorization = "Bearer $Token"; Accept = 'application/json' }
$checks = [ordered]@{}

if (-not $Quiet) {
    Write-Host "`n=== OpenText ISV-6 correction verification ===" -ForegroundColor Cyan
    Write-Host "  estate   : $Purpose"
    Write-Host "  endpoint : $EndpointId"
}

$adminResponse = Invoke-WebRequest `
    -Uri "$baseUrl/scim/admin/endpoints/$EndpointId`?view=full" `
    -Headers $headers `
    -Method Get `
    -TimeoutSec 60
$adminText = if ($adminResponse.Content -is [byte[]]) {
    [Text.Encoding]::UTF8.GetString($adminResponse.Content)
} else {
    [string]$adminResponse.Content
}
$endpoint = $adminText | ConvertFrom-Json -Depth 100

$schemas = Invoke-RestMethod `
    -Uri "$baseUrl/scim/endpoints/$EndpointId/Schemas" `
    -Headers $headers `
    -Method Get `
    -TimeoutSec 60
$serviceProviderConfig = Invoke-RestMethod `
    -Uri "$baseUrl/scim/endpoints/$EndpointId/ServiceProviderConfig" `
    -Headers $headers `
    -Method Get `
    -TimeoutSec 60

$group = $schemas.Resources | Where-Object id -eq 'urn:ietf:params:scim:schemas:core:2.0:Group'
$members = $group.attributes | Where-Object name -eq 'members'
$memberType = $members.subAttributes | Where-Object name -eq 'type'
$memberRef = $members.subAttributes | Where-Object name -eq '$ref'
$user = $schemas.Resources | Where-Object id -eq 'urn:ietf:params:scim:schemas:core:2.0:User'
$userName = $user.attributes | Where-Object name -eq 'name'
$givenName = $userName.subAttributes | Where-Object name -eq 'givenName'
$familyName = $userName.subAttributes | Where-Object name -eq 'familyName'

$mailboxes = @(
    $schemas.Resources |
        Where-Object { $_.id -match '^urn:opentext:scim:schemas:extension:mailbox:2\.0:(User|Group)$' } |
        ForEach-Object {
            $proxy = $_.attributes | Where-Object name -eq 'proxyAddresses'
            [pscustomobject]@{
                id          = $_.id
                type        = $proxy.type
                multiValued = $proxy.multiValued
                caseExact   = $proxy.caseExact
                required    = $proxy.required
                mutability  = $proxy.mutability
                returned    = $proxy.returned
            }
        }
)

$actualHashes = [ordered]@{
    schemas        = Get-ValueHash $endpoint.profile.schemas
    resourceTypes  = Get-ValueHash $endpoint.profile.resourceTypes
    authentication = Get-ValueHash $endpoint.profile.authentication
    settings       = Get-ValueHash $endpoint.profile.settings
}

Test-Invariant ($endpoint.id -eq $EndpointId) `
    'endpoint identity' `
    "admin response id is $($endpoint.id)"
Test-Invariant (@($schemas.Resources).Count -eq 5) `
    'schema topology' `
    "public discovery has $(@($schemas.Resources).Count) schemas (expected 5)"
Test-Invariant ($serviceProviderConfig.etag.supported -eq $false) `
    'ETag policy' `
    "etag.supported is $($serviceProviderConfig.etag.supported) (expected false)"
Test-Invariant (
    $memberType.type -eq 'string' -and
    (@($memberType.canonicalValues) -join ',') -eq 'User,Group'
) 'Group.members.type' `
    "type=$($memberType.type), canonicalValues=$(@($memberType.canonicalValues) -join ',')"
Test-Invariant (
    (@($memberRef.referenceTypes) -join ',') -eq 'User,Group'
) 'Group.members.$ref' `
    "referenceTypes=$(@($memberRef.referenceTypes) -join ',')"
Test-Invariant (
    $userName.type -eq 'complex' -and
    $userName.multiValued -eq $false -and
    $userName.required -eq $false -and
    $userName.mutability -eq 'readWrite' -and
    $userName.returned -eq 'default'
) 'User.name requiredness' `
    "type=$($userName.type), multiValued=$($userName.multiValued), required=$($userName.required), mutability=$($userName.mutability), returned=$($userName.returned)"
Test-Invariant (
    $givenName.type -eq 'string' -and
    $givenName.required -eq $false -and
    $familyName.type -eq 'string' -and
    $familyName.required -eq $false
) 'User givenName/familyName requiredness' `
    "givenName.required=$($givenName.required), familyName.required=$($familyName.required)"
Test-Invariant ($mailboxes.Count -eq 2) `
    'mailbox topology' `
    "found $($mailboxes.Count) vendor-owned mailbox schemas (expected 2)"

foreach ($mailbox in $mailboxes) {
    $valid =
        $mailbox.type -eq 'string' -and
        $mailbox.multiValued -eq $true -and
        $mailbox.caseExact -eq $true -and
        $mailbox.required -eq $false -and
        $mailbox.mutability -eq 'readWrite' -and
        $mailbox.returned -eq 'default'
    Test-Invariant $valid `
        "proxyAddresses characteristics: $($mailbox.id)" `
        "type=$($mailbox.type), multiValued=$($mailbox.multiValued), caseExact=$($mailbox.caseExact), required=$($mailbox.required), mutability=$($mailbox.mutability), returned=$($mailbox.returned)"
}

foreach ($section in $expectedHashes.Keys) {
    Test-Invariant ($actualHashes[$section] -eq $expectedHashes[$section]) `
        "protected profile section: $section" `
        "sha256=$($actualHashes[$section])"
}

$failures = @($checks.GetEnumerator() | Where-Object { -not $_.Value.passed })
$result = [ordered]@{
    estate           = $Purpose
    baseUrl          = $baseUrl
    endpointId       = $endpoint.id
    endpointName     = $endpoint.name
    adminETag        = [string]$adminResponse.Headers.ETag
    schemaCount      = @($schemas.Resources).Count
    validationPassed = $failures.Count -eq 0
    checks           = $checks
}

$result | ConvertTo-Json -Depth 12
if ($failures.Count -gt 0) { exit 1 }
