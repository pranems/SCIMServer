function Invoke-ScimGroupAggregateContract {
param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [Parameter(Mandatory)][hashtable]$Headers
)
$ErrorActionPreference = 'Stop'
$EndpointUrl = $EndpointUrl.TrimEnd('/')
$groupUrn = 'urn:ietf:params:scim:schemas:core:2.0:Group'
$patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
$aggregateChecks = [System.Collections.Generic.List[string]]::new()
$createdUrls = [System.Collections.Generic.List[string]]::new()
function Check($actual, $expected, [string]$claim) {
    if ($actual -cne $expected) { throw "${claim}: expected $expected, received $actual" }
    $aggregateChecks.Add($claim)
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
    $text = if ($response.Content -is [byte[]]) {
        [System.Text.Encoding]::UTF8.GetString($response.Content)
    } else { [string]$response.Content }
    [pscustomobject]@{ Status = [int]$response.StatusCode; Body = if ($text) { $text | ConvertFrom-Json } else { $null } }
}
try {
    foreach ($size in @(0, 1, 2)) {
        $values = @(1..2 | ForEach-Object { [Guid]::NewGuid().ToString() })
        $members = @($values | Select-Object -First $size | ForEach-Object { @{ value = $_ } })
        $payload = @{
            schemas = @($groupUrn)
            displayName = "aggregate-live-$([Guid]::NewGuid().ToString('N'))"
            externalId = 'original'
            members = $members
        }
        $created = Send POST "$EndpointUrl/Groups" $payload ''
        Check $created.Status 201 "POST with $size members"
        if (-not $created.Body.id) { throw 'Create did not return a resource id.' }
        $url = "$EndpointUrl/Groups/$($created.Body.id)"
        $createdUrls.Add($url)
        Check $created.Body.meta.version 'W/"v1"' 'Initial aggregate version'
        Check $created.Body.displayName $payload.displayName 'Initial scalar'
        Check @($created.Body.members).Count $size 'Initial member count'
        foreach ($key in $created.Body.PSObject.Properties.Name) {
            Check ($key -cin @('schemas', 'id', 'displayName', 'externalId', 'members', 'meta')) $true "Allowed response key $key"
        }
        Check ((@($created.Body.members.value) | Sort-Object) -join ',') (($members.value | Sort-Object) -join ',') 'Initial member values'
        $patch = @{
            schemas = @($patchUrn)
            Operations = @(
                @{ op = 'replace'; path = 'displayName'; value = "$($payload.displayName)-updated" }
                @{ op = 'replace'; path = 'members'; value = @(@{ value = $values[0] }) }
            )
        }
        $updated = Send PATCH $url $patch 'W/"v1"'
        Check $updated.Status 200 'Matching aggregate PATCH'
        Check $updated.Body.meta.version 'W/"v2"' 'Single version increment'
        Check $updated.Body.displayName "$($payload.displayName)-updated" 'Updated scalar'
        Check @($updated.Body.members).Count 1 'Updated member count'
        Check $updated.Body.members[0].value $values[0] 'Updated member value'
        foreach ($verb in @('PUT', 'PATCH')) {
            $candidate = if ($verb -eq 'PUT') { $payload } else { $patch }
            $failed = Send $verb $url $candidate 'W/"v1"'
            Check $failed.Status 412 "Stale aggregate $verb"
            Check ($failed.Body.detail -is [string]) $true 'SCIM string error detail'
        }
        $read = Send GET $url $null ''
        Check $read.Status 200 'Aggregate remains readable'
        Check ($read.Body | ConvertTo-Json -Depth 12 -Compress) ($updated.Body | ConvertTo-Json -Depth 12 -Compress) 'No scalar, member or version changes after failure'
        $deleted = Send DELETE $url $null 'W/"v2"'
        Check $deleted.Status 204 'Owned Group cleanup'
        $createdUrls.Remove($url) | Out-Null
    }
} finally {
    foreach ($url in $createdUrls) {
        $cleanup = Send DELETE $url $null ''
        if ($cleanup.Status -notin @(204, 404)) { throw "Owned Group cleanup failed: $($cleanup.Status)" }
    }
}
return $aggregateChecks.Count
}
