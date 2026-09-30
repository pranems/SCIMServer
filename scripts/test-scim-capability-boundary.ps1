[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][string]$Token
)

$ErrorActionPreference = 'Stop'
$results = [System.Collections.Generic.List[object]]::new()
$endpointId = $null
$base = $BaseUrl.TrimEnd('/')
$headers = @{ Authorization = "Bearer $Token" }
$patchSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
$userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User'
$customSchema = 'urn:live:schemas:CapabilityWidget'

function Invoke-CapabilityRequest {
    param([string]$Method, [string]$Path, $Body)
    $arguments = @{
        Uri = "$base$Path"
        Method = $Method
        Headers = $headers
        SkipHttpErrorCheck = $true
    }
    if ($null -ne $Body) {
        $arguments.Body = $Body | ConvertTo-Json -Depth 20
        $arguments.ContentType = 'application/scim+json'
    }
    $response = Invoke-WebRequest @arguments
    $text = if ($response.Content -is [byte[]]) {
        [Text.Encoding]::UTF8.GetString($response.Content)
    } else {
        [string]$response.Content
    }
    [pscustomobject]@{
        Status = [int]$response.StatusCode
        Body = if ($text) { $text | ConvertFrom-Json } else { $null }
    }
}

function Add-CapabilityCheck {
    param([bool]$Success, [string]$Message)
    $results.Add([pscustomobject]@{ Success = $Success; Message = $Message })
}

try {
    $created = Invoke-CapabilityRequest POST '/scim/admin/endpoints' @{
        name = "live-capability-$([Guid]::NewGuid().ToString('N'))"
        profile = @{
            schemas = @(
                @{ id = $userSchema; name = 'User'; attributes = @(@{ name = 'userName' }, @{ name = 'active' }) }
                @{ id = $customSchema; name = 'CapabilityWidget'; attributes = @(@{ name = 'displayName'; type = 'string' }) }
            )
            resourceTypes = @(
                @{ id = 'User'; name = 'User'; endpoint = '/Users'; schema = $userSchema; schemaExtensions = @() }
                @{ id = 'CapabilityWidget'; name = 'CapabilityWidget'; endpoint = '/CapabilityWidgets'; schema = $customSchema; schemaExtensions = @() }
            )
            serviceProviderConfig = @{
                patch = @{ supported = $true }
                bulk = @{ supported = $true; maxOperations = 100; maxPayloadSize = 1048576 }
                filter = @{ supported = $true; maxResults = 100 }
                sort = @{ supported = $true }
                etag = @{ supported = $true }
            }
        }
    }
    if ($created.Status -ne 201 -or -not $created.Body.id) {
        throw "Capability smoke endpoint creation failed with HTTP $($created.Status)."
    }
    $endpointId = $created.Body.id
    $scim = "/scim/endpoints/$endpointId"
    $user = Invoke-CapabilityRequest POST "$scim/Users" @{
        schemas = @($userSchema)
        userName = 'capability-before'
    }
    $widget = Invoke-CapabilityRequest POST "$scim/CapabilityWidgets" @{
        schemas = @($customSchema)
        displayName = 'capability-before'
    }
    if ($user.Status -ne 201 -or $widget.Status -ne 201) {
        throw "Capability smoke resource creation failed: User=$($user.Status), custom=$($widget.Status)."
    }
    $updatedSettings = Invoke-CapabilityRequest PATCH "/scim/admin/endpoints/$endpointId" @{
        profile = @{ serviceProviderConfig = @{
            patch = @{ supported = $false }
            filter = @{ supported = $false }
            sort = @{ supported = $false }
        } }
    }
    if ($updatedSettings.Status -ne 200) { throw 'Could not set capability fixture.' }

    $userPatch = @{ schemas = @($patchSchema); Operations = @(
        @{ op = 'replace'; path = 'userName'; value = 'forbidden-change' }
    ) }
    $bulk = Invoke-CapabilityRequest POST "$scim/Bulk" @{
        schemas = @('urn:ietf:params:scim:api:messages:2.0:BulkRequest')
        Operations = @(@{ method = 'PATCH'; path = "/Users/$($user.Body.id)"; data = $userPatch })
    }
    Add-CapabilityCheck ($bulk.Status -eq 200 -and @($bulk.Body.Operations).Count -eq 1 -and $bulk.Body.Operations[0].status -eq '501') 'Bulk cannot bypass disabled PATCH'

    $customPatch = Invoke-CapabilityRequest PATCH "$scim/CapabilityWidgets/$($widget.Body.id)" @{
        schemas = @($patchSchema)
        Operations = @(@{ op = 'replace'; path = 'displayName'; value = 'forbidden-change' })
    }
    Add-CapabilityCheck ($customPatch.Status -eq 501) 'Custom PATCH honors disabled capability'
    $filter = [Uri]::EscapeDataString('displayName eq "capability-before"')
    $filtered = Invoke-CapabilityRequest GET "$scim/CapabilityWidgets?filter=$filter" $null
    Add-CapabilityCheck ($filtered.Status -eq 403) 'Custom GET filtering honors disabled capability'
    $searched = Invoke-CapabilityRequest POST "$scim/CapabilityWidgets/.search" @{
        schemas = @('urn:ietf:params:scim:api:messages:2.0:SearchRequest')
        filter = 'displayName eq "capability-before"'
    }
    Add-CapabilityCheck ($searched.Status -eq 403) 'Custom POST search filtering honors disabled capability'
    $sorted = Invoke-CapabilityRequest GET "$scim/CapabilityWidgets?sortBy=displayName" $null
    Add-CapabilityCheck ($sorted.Status -eq 403) 'Custom sorting honors disabled capability'

    $readUser = Invoke-CapabilityRequest GET "$scim/Users/$($user.Body.id)" $null
    $readWidget = Invoke-CapabilityRequest GET "$scim/CapabilityWidgets/$($widget.Body.id)" $null
    Add-CapabilityCheck ($readUser.Status -eq 200 -and $readUser.Body.userName -eq 'capability-before' -and $readUser.Body.meta.version -eq $user.Body.meta.version) 'Rejected Bulk PATCH preserves User value and version'
    Add-CapabilityCheck ($readWidget.Status -eq 200 -and $readWidget.Body.displayName -eq 'capability-before' -and $readWidget.Body.meta.version -eq $widget.Body.meta.version) 'Rejected custom PATCH preserves value and version'
} finally {
    if ($endpointId) {
        $deleted = Invoke-CapabilityRequest DELETE "/scim/admin/endpoints/$endpointId" $null
        if ($deleted.Status -ne 204) { throw "Capability smoke cleanup failed with HTTP $($deleted.Status)." }
    }
}

$results
if (@($results | Where-Object { -not $_.Success }).Count -gt 0) {
    throw 'Capability boundary smoke failed. See the individual checks.'
}
