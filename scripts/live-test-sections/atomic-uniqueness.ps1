function Invoke-ScimAtomicUniquenessContract {
param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [Parameter(Mandatory)][hashtable]$Headers
)
$ErrorActionPreference = 'Stop'
$ext = 'urn:example:atomic:core:extension'
$checks = [System.Collections.Generic.List[string]]::new()
function Check($actual, $expected, [string]$claim) {
    if ($actual -cne $expected) { throw "${claim}: expected $expected, received $actual" }
    $checks.Add($claim)
}
function Send([string]$method, [string]$url, $body) {
    $args = @{
        Method = $method
        Uri = $url
        Headers = $headers
        ContentType = 'application/scim+json'
        SkipHttpErrorCheck = $true
    }
    if ($null -ne $body) { $args.Body = $body | ConvertTo-Json -Depth 12 }
    $response = Invoke-WebRequest @args
    $text = if ($response.Content -is [byte[]]) {
        [System.Text.Encoding]::UTF8.GetString($response.Content)
    } else { [string]$response.Content }
    [pscustomobject]@{ Status = [int]$response.StatusCode; Body = if ($text) { $text | ConvertFrom-Json } else { $null } }
}
foreach ($route in @('Users', 'Groups', 'Devices')) {
    $key = if ($route -eq 'Users') { 'userName' } else { 'displayName' }
    $schema = switch ($route) {
        'Users' { 'urn:ietf:params:scim:schemas:core:2.0:User' }
        'Groups' { 'urn:ietf:params:scim:schemas:core:2.0:Group' }
        'Devices' { 'urn:example:atomic:Device' }
    }
    $value = [Guid]::NewGuid().ToString('N')
    $ids = [System.Collections.Generic.List[string]]::new()
    try {
        $first = Send POST "$EndpointUrl/$route" @{ schemas = @($schema, $ext); $key = "first-$value"; $ext = @{ aliases = @($value) } }
        Check $first.Status 201 "$route first create"
        $ids.Add([string]$first.Body.id)
        $second = Send POST "$EndpointUrl/$route" @{ schemas = @($schema, $ext); $key = "second-$value"; $ext = @{ aliases = @($value.ToUpperInvariant()) } }
        Check $second.Status 409 "$route duplicate MV rejection"
        Check $second.Body.scimType 'uniqueness' "$route SCIM error"
        foreach ($field in $second.Body.PSObject.Properties.Name) {
            if ($field -notin @('schemas', 'status', 'detail', 'scimType', 'urn:scimserver:api:messages:2.0:Diagnostics')) {
                throw "Unexpected SCIM error field: $field"
            }
        }
        $other = Send POST "$EndpointUrl/$route" @{ schemas = @($schema, $ext); $key = "other-$value"; $ext = @{} }
        Check $other.Status 201 "$route other resource"
        $ids.Add([string]$other.Body.id)
        $patch = @{
            schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
            Operations = @(@{ op = 'add'; path = "${ext}:aliases"; value = @($value) })
        }
        $conflict = Send PATCH "$EndpointUrl/$route/$($other.Body.id)" $patch
        Check $conflict.Status 409 "$route duplicate update"
        $read = Send GET "$EndpointUrl/$route/$($other.Body.id)" $null
        Check $read.Body.meta.version 'W/"v1"' "$route losing version unchanged"
        Check ($null -eq $read.Body.$ext.aliases) $true "$route losing value absent"
    } finally {
        foreach ($id in $ids) { $null = Send DELETE "$EndpointUrl/$route/$id" $null }
    }
}
return $checks.Count
}

function Invoke-ScimAtomicUniquenessTests {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][hashtable]$Headers
    )
    $script:currentSection = '9z-DB: Atomic Uniqueness'
    $endpointId = $null
    $base = $BaseUrl.TrimEnd('/')
    try {
        $user = 'urn:ietf:params:scim:schemas:core:2.0:User'
        $group = 'urn:ietf:params:scim:schemas:core:2.0:Group'
        $device = 'urn:example:atomic:Device'
        $extension = 'urn:example:atomic:core:extension'
        $profile = @{
            schemas = @(
                @{ id = $user; name = 'User'; attributes = 'all' }
                @{ id = $group; name = 'Group'; attributes = 'all' }
                @{ id = $device; name = 'Device'; attributes = @(@{ name = 'displayName'; type = 'string' }) }
                @{ id = $extension; name = 'UniqueValues'; attributes = @(@{
                    name = 'aliases'; type = 'string'; multiValued = $true; uniqueness = 'server'
                }) }
            )
            resourceTypes = @(
                @{ id = 'User'; name = 'User'; endpoint = '/Users'; schema = $user; schemaExtensions = @(@{ schema = $extension; required = $false }) }
                @{ id = 'Group'; name = 'Group'; endpoint = '/Groups'; schema = $group; schemaExtensions = @(@{ schema = $extension; required = $false }) }
                @{ id = 'Device'; name = 'Device'; endpoint = '/Devices'; schema = $device; schemaExtensions = @(@{ schema = $extension; required = $false }) }
            )
            settings = @{ StrictSchemaValidation = $true; logFileEnabled = $false }
            serviceProviderConfig = @{ patch = @{ supported = $true }; etag = @{ supported = $true } }
        }
        $created = Invoke-RestMethod -Uri "$base/scim/admin/endpoints" -Method Post -Headers $Headers `
            -ContentType 'application/json' -ErrorAction Stop `
            -Body (@{ name = "live-atomic-$([guid]::NewGuid().ToString('N'))"; profile = $profile } | ConvertTo-Json -Depth 20)
        $endpointId = $created.id
        if (-not $endpointId) { throw 'Atomic uniqueness endpoint creation returned no id.' }
        $count = Invoke-ScimAtomicUniquenessContract -EndpointUrl "$base/scim/endpoints/$endpointId" -Headers $Headers
        Test-Result -Success ($count -eq 21) -Message '9z-DB: 21 string multivalue uniqueness, conflict and no-write assertions'
    } catch {
        Test-Result -Success $false -Message "9z-DB: atomic uniqueness contract failed: $($_.Exception.Message)"
    } finally {
        if ($endpointId) {
            try {
                $null = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$endpointId" -Method Delete -Headers $Headers -ErrorAction Stop
                Test-Result -Success $true -Message '9z-DB: removed dedicated uniqueness endpoint'
            } catch {
                Test-Result -Success $false -Message '9z-DB: failed to remove dedicated uniqueness endpoint'
            }
        }
    }
}
