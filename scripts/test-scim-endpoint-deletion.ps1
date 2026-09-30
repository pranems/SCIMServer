[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][string]$Token
)

$ErrorActionPreference = 'Stop'
$results = [System.Collections.Generic.List[object]]::new()
$ownedIds = [System.Collections.Generic.List[string]]::new()
$userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User'
$groupSchema = 'urn:ietf:params:scim:schemas:core:2.0:Group'
$deviceSchema = 'urn:example:params:scim:schemas:custom:2.0:P8bDevice'

function Invoke-DeletionRequest {
    param([string]$Method, [string]$Path, $Body)
    $parameters = @{
        Uri = "$($BaseUrl.TrimEnd('/'))$Path"
        Method = $Method
        Headers = @{ Authorization = "Bearer $Token" }
        SkipHttpErrorCheck = $true
    }
    if ($null -ne $Body) {
        $parameters.Body = $Body | ConvertTo-Json -Depth 25
        $parameters.ContentType = 'application/scim+json'
    }
    $response = Invoke-WebRequest @parameters
    $text = if ($response.Content -is [byte[]]) {
        [Text.Encoding]::UTF8.GetString($response.Content)
    } else { [string]$response.Content }
    [pscustomobject]@{
        Status = [int]$response.StatusCode
        ContentType = [string]$response.Headers['Content-Type']
        Text = $text
        Body = if ($text) { $text | ConvertFrom-Json } else { $null }
    }
}

function New-OwnedRecord {
    param([string]$Path, $Body)
    $response = Invoke-DeletionRequest POST $Path $Body
    if ($response.Status -ne 201 -or -not $response.Body.id) {
        throw "Owned fixture creation failed at $Path with HTTP $($response.Status)."
    }
    $response.Body
}

function Add-DeletionCheck {
    param([bool]$Success, [string]$Message)
    $results.Add([pscustomobject]@{ Success = $Success; Message = $Message })
}

try {
    $name = "live-p8b-$([Guid]::NewGuid().ToString('N'))"
    $profile = @{
        schemas = @(
            @{ id = $userSchema; name = 'User'; attributes = 'all' }
            @{ id = $groupSchema; name = 'Group'; attributes = 'all' }
            @{
                id = $deviceSchema
                name = 'P8bDevice'
                attributes = @(@{ name = 'displayName'; type = 'string' })
            }
        )
        resourceTypes = @(
            @{ id = 'User'; name = 'User'; endpoint = '/Users'; schema = $userSchema; schemaExtensions = @() }
            @{ id = 'Group'; name = 'Group'; endpoint = '/Groups'; schema = $groupSchema; schemaExtensions = @() }
            @{ id = 'P8bDevice'; name = 'P8bDevice'; endpoint = '/Devices'; schema = $deviceSchema; schemaExtensions = @() }
        )
        settings = @{
            StrictSchemaValidation = $false
            SecretTokenBearerAuthEnabled = $true
            OAuthClientCredentialsAuthEnabled = $true
        }
    }
    $endpoint = New-OwnedRecord '/scim/admin/endpoints' @{ name = $name; profile = $profile }
    $ownedIds.Add($endpoint.id)
    $other = New-OwnedRecord '/scim/admin/endpoints' @{ name = "$name-other"; profilePreset = 'rfc-standard' }
    $ownedIds.Add($other.id)
    $base = "/scim/endpoints/$($endpoint.id)"
    $admin = "/scim/admin/endpoints/$($endpoint.id)"
    $user = New-OwnedRecord "$base/Users" @{ schemas = @($userSchema); userName = "$name-user" }
    $group = New-OwnedRecord "$base/Groups" @{
        schemas = @($groupSchema)
        displayName = "$name-group"
        members = @(@{ value = $user.id })
    }
    $null = New-OwnedRecord "$base/Devices" @{ schemas = @($deviceSchema); displayName = "$name-device" }
    $credential = New-OwnedRecord "$admin/credentials" @{ credentialType = 'bearer'; label = 'P8b active' }
    $revoked = New-OwnedRecord "$admin/credentials" @{ credentialType = 'oauth_client'; label = 'P8b revoked' }
    $revoke = Invoke-DeletionRequest DELETE "$admin/credentials/$($revoked.id)" $null
    if ($revoke.Status -ne 204) { throw "Credential revoke failed with HTTP $($revoke.Status)." }
    $survivor = New-OwnedRecord "/scim/endpoints/$($other.id)/Users" @{ schemas = @($userSchema); userName = "$name-survivor" }

    $stats = Invoke-DeletionRequest GET "$admin/stats" $null
    $inventory = Invoke-DeletionRequest GET "$admin/credentials" $null
    $activeRows = @($inventory.Body | Where-Object { $_.id -eq $credential.id -and $_.active })
    $revokedRows = @($inventory.Body | Where-Object { $_.id -eq $revoked.id -and -not $_.active })
    Add-DeletionCheck ($stats.Status -eq 200 -and $stats.Body.users.total -eq 1 -and $stats.Body.groups.total -eq 1 -and $inventory.Status -eq 200 -and @($inventory.Body).Count -eq 2 -and $activeRows.Count -eq 1 -and $revokedRows.Count -eq 1) 'Owned User, Group and active/revoked credentials exist before deletion'
    $members = Invoke-DeletionRequest GET "$base/Groups/$($group.id)" $null
    Add-DeletionCheck (@($members.Body.members).Count -eq 1 -and $members.Body.members[0].value -eq $user.id) 'Owned Group membership is real'
    $deleted = Invoke-DeletionRequest DELETE $admin $null
    Add-DeletionCheck ($deleted.Status -eq 204 -and $deleted.Text -eq '') 'Endpoint deletion returns an empty 204 response'
    if ($deleted.Status -ne 204) { throw 'Endpoint deletion failed.' }
    $null = $ownedIds.Remove([string]$endpoint.id)
    foreach ($path in @($admin, "$base/Users/$($user.id)", "$base/Devices", "$admin/credentials")) {
        $missing = Invoke-DeletionRequest GET $path $null
        Add-DeletionCheck ($missing.Status -eq 404) 'Deleted endpoint and owned routes are unavailable'
    }
    $lateCreates = @(
        @{ Kind = 'User'; Path = "$base/Users"; Body = @{ schemas = @($userSchema); userName = "$name-late" } }
        @{ Kind = 'Group'; Path = "$base/Groups"; Body = @{ schemas = @($groupSchema); displayName = "$name-late" } }
        @{ Kind = 'Device'; Path = "$base/Devices"; Body = @{ schemas = @($deviceSchema); displayName = "$name-late" } }
        @{ Kind = 'bearer'; Path = "$admin/credentials"; Body = @{ credentialType = 'bearer' } }
        @{ Kind = 'oauth_client'; Path = "$admin/credentials"; Body = @{ credentialType = 'oauth_client' } }
        @{
            Kind = 'wif'
            Path = "$admin/credentials"
            Body = @{
                credentialType = 'wif'
                wif = @{
                    expectedIssuer = 'https://issuer.example.test'
                    expectedSubject = 'late-subject'
                    expectedAudience = 'late-audience'
                    jwksUri = 'https://issuer.example.test/keys'
                    allowedTenantId = 'late-test-tenant'
                }
            }
        }
    )
    $allowedErrorKeys = @('schemas', 'status', 'detail', 'scimType', 'urn:scimserver:api:messages:2.0:Diagnostics')
    foreach ($late in $lateCreates) {
        $rejected = Invoke-DeletionRequest POST $late.Path $late.Body
        $extraKeys = @($rejected.Body.PSObject.Properties.Name | Where-Object { $_ -notin $allowedErrorKeys })
        $safe = $rejected.Status -eq 404 -and $rejected.Body.status -eq '404' -and
            $rejected.ContentType -match '^application/scim\+json' -and
            'urn:ietf:params:scim:api:messages:2.0:Error' -in @($rejected.Body.schemas) -and
            $rejected.Body.detail -is [string] -and $extraKeys.Count -eq 0 -and
            $rejected.Text -notmatch 'Prisma|P20\d\d|foreign.key|constraint|driverAdapter|stack'
        Add-DeletionCheck $safe "Late $($late.Kind) create returns a safe SCIM 404"
    }
    $untouched = Invoke-DeletionRequest GET "/scim/endpoints/$($other.id)/Users/$($survivor.id)" $null
    Add-DeletionCheck ($untouched.Status -eq 200 -and $untouched.Body.userName -eq "$name-survivor") 'Other endpoint resource remains unchanged'
    $replacement = New-OwnedRecord '/scim/admin/endpoints' @{ name = $name; profile = $profile }
    $ownedIds.Add($replacement.id)
    $empty = Invoke-DeletionRequest GET "/scim/endpoints/$($replacement.id)/Users" $null
    Add-DeletionCheck ($replacement.id -ne $endpoint.id -and $empty.Status -eq 200 -and $empty.Body.totalResults -eq 0) 'Reused endpoint name has a new identity and empty User collection'
    $emptyCredentials = Invoke-DeletionRequest GET "/scim/admin/endpoints/$($replacement.id)/credentials" $null
    Add-DeletionCheck ($emptyCredentials.Status -eq 200 -and @($emptyCredentials.Body).Count -eq 0) 'Reused endpoint name has no credentials'
} finally {
    foreach ($id in $ownedIds) {
        $cleanup = Invoke-DeletionRequest DELETE "/scim/admin/endpoints/$id" $null
        if ($cleanup.Status -ne 204) { throw "Owned endpoint cleanup failed with HTTP $($cleanup.Status)." }
    }
}

$results
if (@($results | Where-Object { -not $_.Success }).Count -gt 0) {
    throw 'Endpoint deletion smoke failed. See individual checks.'
}
