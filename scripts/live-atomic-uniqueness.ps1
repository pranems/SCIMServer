param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [string]$Token = $env:E2E_TOKEN
)
$ErrorActionPreference = 'Stop'
$target = [Uri]$EndpointUrl
if (-not $target.IsLoopback -or $target.Scheme -ne 'http' -or -not $Token) {
    throw 'This smoke requires a task-owned loopback endpoint and explicit token.'
}
$headers = @{ Authorization = "Bearer $Token" }
$ext = 'urn:example:atomic:core:extension'
$count = 0
function Check($actual, $expected, [string]$claim) {
    if ($actual -cne $expected) { throw "${claim}: expected $expected, received $actual" }
    $script:count++
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
Write-Output "atomic uniqueness live contract: $count assertions passed"
