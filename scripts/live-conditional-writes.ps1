param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [string]$Token = $env:E2E_TOKEN
)
$ErrorActionPreference = 'Stop'
$target = [Uri]$EndpointUrl
if (-not $target.IsLoopback -or $target.Scheme -ne 'http' -or -not $Token) {
    throw 'This owned-runtime smoke requires an explicit loopback HTTP endpoint and token.'
}
$headers = @{ Authorization = "Bearer $Token" }
$patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
$count = 0
function Check($actual, $expected, [string]$claim) {
    if ($actual -cne $expected) { throw "${claim}: expected $expected, received $actual" }
    $script:count++
}
function Send([string]$method, [string]$url, $body, [string]$etag) {
    $h = $headers.Clone()
    if ($etag) { $h['If-Match'] = $etag }
    $args = @{
        Method = $method
        Uri = $url
        Headers = $h
        ContentType = 'application/scim+json'
        SkipHttpErrorCheck = $true
    }
    if ($null -ne $body) { $args.Body = $body | ConvertTo-Json -Depth 12 }
    $response = Invoke-WebRequest @args
    # PowerShell treats application/scim+json as binary on some versions.
    $text = if ($response.Content -is [byte[]]) {
        [System.Text.Encoding]::UTF8.GetString($response.Content)
    } else { [string]$response.Content }
    [pscustomobject]@{ StatusCode = $response.StatusCode; Content = $text }
}
foreach ($route in @('Users', 'Groups', 'Devices')) {
    $key = if ($route -eq 'Users') { 'userName' } else { 'displayName' }
    $schema = switch ($route) {
        'Users' { 'urn:ietf:params:scim:schemas:core:2.0:User' }
        'Groups' { 'urn:ietf:params:scim:schemas:core:2.0:Group' }
        'Devices' { 'urn:example:conditional:Device' }
    }
    $name = "live-$([Guid]::NewGuid().ToString('N'))"
    $body = @{ schemas = @($schema); $key = $name }
    $created = Send POST "$EndpointUrl/$route" $body ''
    Check ([int]$created.StatusCode) 201 "$route create"
    $id = ($created.Content | ConvertFrom-Json).id
    if (-not $id) { throw "Missing created resource id: $($created.Content)" }
    $url = "$EndpointUrl/$route/$id"
    $patch = @{
        schemas = @($patchUrn)
        Operations = @(@{ op = 'replace'; path = $key; value = "$name-changed" })
    }
    try {
        $updated = Send PATCH $url $patch 'W/"v1"'
        if ([int]$updated.StatusCode -ne 200) { throw "PATCH $url failed: $($updated.Content)" }
        Check ([int]$updated.StatusCode) 200 "$route matching PATCH"
        Check (($updated.Content | ConvertFrom-Json).meta.version) 'W/"v2"' "$route version"
        foreach ($verb in @('PUT', 'PATCH', 'DELETE')) {
            $payload = if ($verb -eq 'PUT') { $body } elseif ($verb -eq 'PATCH') { $patch } else { $null }
            $failed = Send $verb $url $payload 'W/"v1"'
            Check ([int]$failed.StatusCode) 412 "$route stale $verb"
        }
        $read = (Send GET $url $null '').Content | ConvertFrom-Json
        Check $read.meta.version 'W/"v2"' "$route failed writes did not advance version"
        Check $read.$key "$name-changed" "$route failed writes did not mutate scalar"
        $wildcard = Send PATCH $url $patch '*'
        Check ([int]$wildcard.StatusCode) 200 "$route wildcard PATCH"
        Check (($wildcard.Content | ConvertFrom-Json).meta.version) 'W/"v3"' "$route wildcard version"
        Check ([int](Send DELETE $url $null '*').StatusCode) 204 "$route wildcard DELETE"
    } finally {
        $null = Send DELETE $url $null ''
    }
}
Write-Output "conditional live contract: $count assertions passed"
