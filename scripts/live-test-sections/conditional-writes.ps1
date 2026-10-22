function Invoke-ScimConditionalWriteContract {
param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [Parameter(Mandatory)][hashtable]$Headers
)
$ErrorActionPreference = 'Stop'
$patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
$checks = [System.Collections.Generic.List[string]]::new()
function Check($actual, $expected, [string]$claim) {
    if ($actual -cne $expected) { throw "${claim}: expected $expected, received $actual" }
    $checks.Add($claim)
}
function Send([string]$method, [string]$url, $body, [string]$etag) {
    $h = $headers.Clone()
    $h.Remove('If-Match')
    if ($etag) { $h['If-Match'] = $etag }
    Check ($h.ContainsKey('If-Match')) ([bool]$etag) "$method explicitly selected If-Match presence"
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
    [pscustomobject]@{ StatusCode = $response.StatusCode; Content = $text; Headers = $response.Headers }
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
    $memberValue = [Guid]::NewGuid().ToString()
    if ($route -eq 'Groups') { $body['members'] = @(@{ value = $memberValue }) }
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
        if ($route -eq 'Groups') {
            $updatedGroup = $updated.Content | ConvertFrom-Json
            Check @($updatedGroup.members).Count 1 'Group committed membership count'
            Check $updatedGroup.members[0].value $memberValue 'Group committed membership value'
        }
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
        $unconditional = Send PATCH $url $patch ''
        Check ([int]$unconditional.StatusCode) 200 "$route no-header PATCH"
        $unconditionalBody = $unconditional.Content | ConvertFrom-Json
        Check $unconditionalBody.meta.version 'W/"v4"' "$route no-header version"
        Check ([string]@($unconditional.Headers['ETag'])[0]) 'W/"v4"' "$route response ETag matches committed body"
        Check $unconditionalBody.$key "$name-changed" "$route no-header scalar"
        $allowedKeys = @('schemas', 'id', 'externalId', 'userName', 'displayName', 'active', 'members', 'meta')
        $unexpectedKeys = @($unconditionalBody.PSObject.Properties.Name | Where-Object { $_ -notin $allowedKeys })
        Check $unexpectedKeys.Count 0 "$route response has only documented fields"
        if ($route -eq 'Groups') {
            $replacement = @{
                schemas = @($patchUrn)
                Operations = @(@{ op = 'replace'; path = 'members'; value = @(@{ value = $memberValue }) })
            }
            $replaced = Send PATCH $url $replacement 'W/"v4"'
            Check ([int]$replaced.StatusCode) 200 'Group same-member replacement'
            $committed = $replaced.Content | ConvertFrom-Json
            Check $committed.meta.version 'W/"v5"' 'Group replacement version'
            Check @($committed.members).Count 1 'Group replacement membership count'
            Check $committed.members[0].value $memberValue 'Group replacement membership value'
            Check ([string]@($replaced.Headers['ETag'])[0]) 'W/"v5"' 'Group replacement ETag matches committed body'
            $unexpectedKeys = @($committed.PSObject.Properties.Name | Where-Object { $_ -notin $allowedKeys })
            Check $unexpectedKeys.Count 0 'Group replacement response has only documented fields'
        }
        Check ([int](Send DELETE $url $null '*').StatusCode) 204 "$route wildcard DELETE"
    } finally {
        $null = Send DELETE $url $null ''
    }
}
return $checks.Count
}
