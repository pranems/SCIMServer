[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][string]$Token
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$headers = @{ Authorization = "Bearer $Token" }
$results = [System.Collections.Generic.List[object]]::new()
$endpointId = $null
$roleEndpointId = $null
$extension = 'urn:live:query:Extension'
$search = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest'
$fixtures = @(
    @{ name = 'User'; route = 'Users'; schema = 'urn:ietf:params:scim:schemas:core:2.0:User' }
    @{ name = 'Group'; route = 'Groups'; schema = 'urn:ietf:params:scim:schemas:core:2.0:Group' }
    @{ name = 'QueryWidget'; route = 'QueryWidgets'; schema = 'urn:live:query:Widget' }
)

function Invoke-QueryRequest {
    param([string]$Method, [string]$Path, $Body)
    $arguments = @{ Uri = "$base$Path"; Method = $Method; Headers = $headers; SkipHttpErrorCheck = $true }
    if ($null -ne $Body) {
        $arguments.Body = $Body | ConvertTo-Json -Depth 25
        $arguments.ContentType = 'application/scim+json'
    }
    $response = Invoke-WebRequest @arguments
    $text = if ($response.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($response.Content) } else { [string]$response.Content }
    [pscustomobject]@{
        Status = [int]$response.StatusCode
        Body = if ($text) { $text | ConvertFrom-Json } else { $null }
    }
}

function Add-QueryCheck {
    param([bool]$Success, [string]$Message)
    $results.Add([pscustomobject]@{ Success = $Success; Message = $Message })
}

try {
    $attributes = @(
        @{ name = 'displayName'; type = 'string' }
        @{ name = 'rank'; type = 'integer' }
        @{ name = 'hidden'; type = 'string'; returned = 'never' }
        @{ name = 'requested'; type = 'string'; returned = 'request' }
        @{ name = 'secret'; type = 'string'; mutability = 'writeOnly' }
        @{ name = 'entries'; type = 'complex'; multiValued = $true; subAttributes = @(
            @{ name = 'value'; type = 'integer' }
            @{ name = 'code'; type = 'string'; caseExact = $true }
            @{ name = 'primary'; type = 'boolean' }
        ) }
    )
    $schemas = @($fixtures | ForEach-Object {
        $extra = if ($_.name -eq 'User') { @(@{ name = 'userName' }, @{ name = 'active' }) }
            elseif ($_.name -eq 'Group') { @(@{ name = 'members' }) } else { @() }
        @{ id = $_.schema; name = $_.name; attributes = @($extra) + $attributes }
    }) + @(@{ id = $extension; name = 'QueryExtension'; attributes = $attributes })
    $created = Invoke-QueryRequest POST '/scim/admin/endpoints' @{
        name = "live-query-$([Guid]::NewGuid().ToString('N'))"
        profile = @{
            schemas = $schemas
            resourceTypes = @($fixtures | ForEach-Object {
                @{ id = $_.name; name = $_.name; endpoint = "/$($_.route)"; schema = $_.schema; schemaExtensions = @(@{ schema = $extension; required = $false }) }
            })
            serviceProviderConfig = @{
                filter = @{ supported = $true; maxResults = 1 }
                sort = @{ supported = $true }; patch = @{ supported = $true }; etag = @{ supported = $true }
            }
            settings = @{ StrictSchemaValidation = $true; logFileEnabled = $false }
        }
    }
    if ($created.Status -ne 201 -or -not $created.Body.id) { throw "Query fixture creation failed: HTTP $($created.Status)" }
    $endpointId = $created.Body.id
    $scim = "/scim/endpoints/$endpointId"
    foreach ($fixture in $fixtures) {
        $ids = @()
        foreach ($rank in @(10, 2)) {
            $body = @{
                schemas = @($fixture.schema, $extension); displayName = "query-$rank"; rank = $rank
                hidden = 'match'; requested = 'on-demand'; secret = 'synthetic-private'
                $extension = @{ hidden = 'match'; entries = @(@{ value = $rank; primary = $true; code = 'AbC' }) }
            }
            if ($fixture.name -eq 'User') { $body.userName = "query-$rank" }
            $resource = Invoke-QueryRequest POST "$scim/$($fixture.route)" $body
            if ($resource.Status -ne 201) { throw "Resource fixture failed: $($fixture.route) HTTP $($resource.Status)" }
            $ids += $resource.Body.id
        }
        foreach ($method in @('GET', 'POST')) {
            $params = @{
                filter = 'hidden eq "match"'; sortBy = 'rank'; count = 50
                attributes = "id,rank,hidden,secret,requested,$extension"
            }
            $response = if ($method -eq 'GET') {
                $query = ($params.GetEnumerator() | ForEach-Object { "$($_.Key)=$([Uri]::EscapeDataString([string]$_.Value))" }) -join '&'
                Invoke-QueryRequest GET "$scim/$($fixture.route)?$query" $null
            } else {
                Invoke-QueryRequest POST "$scim/$($fixture.route)/.search" (@{ schemas = @($search) } + $params)
            }
            Add-QueryCheck ($response.Status -eq 200 -and $response.Body.totalResults -eq 2 -and $response.Body.itemsPerPage -eq 1 -and $response.Body.Resources[0].id -eq $ids[1]) "$($fixture.route) $method filters before numeric sort/count/profile page cap"
            $json = $response.Body | ConvertTo-Json -Depth 25
            Add-QueryCheck ($json -notmatch '"(?:hidden|secret|_[^"]*)"\s*:' -and $response.Body.Resources[0].requested -eq 'on-demand') "$($fixture.route) $method explicit projection cannot expose never/writeOnly/internal fields"
            $keys = @($response.Body.PSObject.Properties.Name | Where-Object { $_ -notin @('schemas', 'totalResults', 'itemsPerPage', 'startIndex', 'Resources') })
            Add-QueryCheck ($keys.Count -eq 0) "$($fixture.route) $method ListResponse key allowlist"
        }
        $filter = [Uri]::EscapeDataString("${extension}:entries[primary eq true and value ge 2 and code eq `"AbC`"]")
        $typed = Invoke-QueryRequest GET "$scim/$($fixture.route)?filter=$filter" $null
        Add-QueryCheck ($typed.Status -eq 200 -and $typed.Body.totalResults -eq 2) "$($fixture.route) extension valuePath resolves typed children"
        $filter = [Uri]::EscapeDataString("${extension}:entries[code eq `"abc`"]")
        $exact = Invoke-QueryRequest GET "$scim/$($fixture.route)?filter=$filter" $null
        Add-QueryCheck ($exact.Status -eq 200 -and $exact.Body.totalResults -eq 0) "$($fixture.route) extension valuePath respects caseExact"
        $zero = Invoke-QueryRequest GET "$scim/$($fixture.route)?count=0" $null
        Add-QueryCheck ($zero.Status -eq 200 -and $zero.Body.totalResults -eq 2 -and $zero.Body.itemsPerPage -eq 0) "$($fixture.route) count zero preserves total"
        $denied = Invoke-QueryRequest GET "$scim/$($fixture.route)?filter=secret%20pr" $null
        Add-QueryCheck ($denied.Status -eq 400 -and $denied.Body.scimType -eq 'invalidFilter' -and $denied.Body.detail -is [string]) "$($fixture.route) denies writeOnly filtering"
    }
    $settings = Invoke-QueryRequest PATCH "/scim/admin/endpoints/$endpointId" @{
        profile = @{ settings = @{ RequireIfMatch = $true }; serviceProviderConfig = @{ etag = @{ supported = $false } } }
    }
    if ($settings.Status -ne 200) { throw 'Could not set ETag fixture' }
    $patched = Invoke-QueryRequest PATCH "$scim/QueryWidgets/$($ids[0])" @{
        schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
        Operations = @(@{ op = 'replace'; path = 'displayName'; value = 'etag-disabled-write' })
    }
    Add-QueryCheck ($patched.Status -eq 200 -and $patched.Body.displayName -eq 'etag-disabled-write') 'Custom ETag-disabled profile does not require If-Match'

    $shapes = Invoke-QueryRequest PATCH "/scim/admin/endpoints/$endpointId" @{
        profile = @{ schemas = @($schemas | ForEach-Object {
            if ($_.id -eq $fixtures[2].schema) {
                @{ id = $_.id; name = $_.name; attributes = @(
                    @{ name = 'displayName'; type = 'integer' }
                    @{ name = 'externalId'; type = 'string' }
                ) }
            } elseif ($_.id -eq $extension) {
                @{ id = $_.id; name = $_.name; attributes = @(
                    @{ name = 'externalId'; type = 'string'; multiValued = $true; caseExact = $false }
                ) }
            } else { $_ }
        }) }
    }
    if ($shapes.Status -ne 200) { throw 'Could not set custom query representation fixture' }
    $typedResource = Invoke-QueryRequest POST "$scim/QueryWidgets" @{
        schemas = @($fixtures[2].schema, $extension); displayName = 2; externalId = 'Z'
        $extension = @{ externalId = @('other', 'needle') }
    }
    if ($typedResource.Status -ne 201) { throw "Custom representation fixture failed: HTTP $($typedResource.Status)" }
    $secondResource = Invoke-QueryRequest POST "$scim/QueryWidgets" @{
        schemas = @($fixtures[2].schema); displayName = 10; externalId = 'a'
    }
    if ($secondResource.Status -ne 201) { throw "Common externalId sort fixture failed: HTTP $($secondResource.Status)" }
    foreach ($filter in @('displayName eq 2', "${extension}:externalId eq `"needle`"", "displayName pr and ${extension}:externalId pr", "${extension}:externalId co `"eed`"")) {
        foreach ($method in @('GET', 'POST')) {
            $response = if ($method -eq 'GET') {
                Invoke-QueryRequest GET "$scim/QueryWidgets?filter=$([Uri]::EscapeDataString($filter))" $null
            } else {
                Invoke-QueryRequest POST "$scim/QueryWidgets/.search" @{ schemas = @($search); filter = $filter }
            }
            Add-QueryCheck ($response.Status -eq 200 -and $response.Body.totalResults -eq 1 -and $response.Body.Resources[0].id -eq $typedResource.Body.id -and $response.Body.Resources[0].displayName -eq 2 -and $response.Body.Resources[0].externalId -ceq 'Z' -and @($response.Body.Resources[0].$extension.externalId).Count -eq 2) "Custom $method representation-aware filter: $filter"
        }
    }
    foreach ($method in @('GET', 'POST')) {
        foreach ($value in @('Z', 'z')) {
            $filter = "externalId eq `"$value`""
            $response = if ($method -eq 'GET') {
                Invoke-QueryRequest GET "$scim/QueryWidgets?filter=$([Uri]::EscapeDataString($filter))" $null
            } else {
                Invoke-QueryRequest POST "$scim/QueryWidgets/.search" @{ schemas = @($search); filter = $filter }
            }
            $expected = if ($value -ceq 'Z') { 1 } else { 0 }
            Add-QueryCheck ($response.Status -eq 200 -and $response.Body.totalResults -eq $expected) "Common externalId $method caseExact match: $value"
        }
        $ordered = if ($method -eq 'GET') {
            Invoke-QueryRequest GET "$scim/QueryWidgets?sortBy=externalId" $null
        } else {
            Invoke-QueryRequest POST "$scim/QueryWidgets/.search" @{ schemas = @($search); sortBy = 'externalId' }
        }
        Add-QueryCheck ($ordered.Status -eq 200 -and $ordered.Body.Resources[0].id -eq $typedResource.Body.id) "Common externalId $method caseExact sort precedes lowercase and missing values"
    }
    $roleCore = 'urn:live:query-binding:Host'
    $roleExtension = 'urn:ietf:params:scim:schemas:core:2.0:User'
    $roleEndpoint = Invoke-QueryRequest POST '/scim/admin/endpoints' @{
        name = "live-query-binding-$([Guid]::NewGuid().ToString('N'))"
        profile = @{
            schemas = @(
                @{ id = $roleCore; name = 'Host'; attributes = @(@{ name = 'label'; type = 'string' }) }
                @{ id = $roleExtension; name = 'UserShapeExtension'; attributes = @(
                    @{ name = 'userName'; type = 'string' }
                    @{ name = 'externalId'; type = 'integer'; multiValued = $true }
                ) }
            )
            resourceTypes = @(@{
                id = 'Host'; name = 'Host'; endpoint = '/Hosts'; schema = $roleCore
                schemaExtensions = @(@{ schema = $roleExtension; required = $false })
            })
            serviceProviderConfig = @{ filter = @{ supported = $true; maxResults = 100 }; sort = @{ supported = $true } }
            settings = @{ StrictSchemaValidation = $true; logFileEnabled = $false }
        }
    }
    if ($roleEndpoint.Status -ne 201 -or -not $roleEndpoint.Body.id) { throw 'Could not create query binding fixture' }
    $roleEndpointId = $roleEndpoint.Body.id
    $roleBase = "/scim/endpoints/$roleEndpointId/Hosts"
    $high = Invoke-QueryRequest POST $roleBase @{
        schemas = @($roleCore, $roleExtension); label = 'high'; externalId = 'Core-A'
        $roleExtension = @{ userName = 'extension-high'; externalId = @(7, 11) }
    }
    $low = Invoke-QueryRequest POST $roleBase @{
        schemas = @($roleCore, $roleExtension); label = 'low'; externalId = 'Core-B'
        $roleExtension = @{ userName = 'extension-low'; externalId = @(2) }
    }
    if ($high.Status -ne 201 -or $low.Status -ne 201) { throw 'Could not seed query binding fixture' }
    Add-QueryCheck (@($high.Body.$roleExtension.externalId).Count -eq 2 -and $high.Body.$roleExtension.externalId[1] -eq 11 -and $low.Body.$roleExtension.externalId[0] -eq 2) 'Explicit extension binding preserves numeric/MV values under an RFC core URI'
    $roleFilter = "${roleExtension}:externalId eq 11"
    foreach ($method in @('GET', 'POST')) {
        $response = if ($method -eq 'GET') {
            Invoke-QueryRequest GET "${roleBase}?filter=$([Uri]::EscapeDataString($roleFilter))" $null
        } else {
            Invoke-QueryRequest POST "$roleBase/.search" @{ schemas = @($search); filter = $roleFilter }
        }
        Add-QueryCheck ($response.Status -eq 200 -and $response.Body.totalResults -eq 1 -and $response.Body.Resources[0].id -eq $high.Body.id) "Explicit extension binding $method filter uses the namespaced value"
    }
    $roleSort = Invoke-QueryRequest GET "${roleBase}?sortBy=$([Uri]::EscapeDataString("${roleExtension}:externalId"))&sortOrder=ascending&count=1" $null
    Add-QueryCheck ($roleSort.Status -eq 200 -and $roleSort.Body.totalResults -eq 2 -and $roleSort.Body.Resources[0].id -eq $low.Body.id) 'Explicit extension binding sorts numerically before pagination'
    $commonExact = Invoke-QueryRequest GET "${roleBase}?filter=$([Uri]::EscapeDataString('externalId eq "core-a"'))" $null
    Add-QueryCheck ($commonExact.Status -eq 200 -and $commonExact.Body.totalResults -eq 0) 'Core common externalId remains exact beside the independent extension'
} finally {
    try {
        if ($roleEndpointId) {
            $deleted = Invoke-QueryRequest DELETE "/scim/admin/endpoints/$roleEndpointId" $null
            if ($deleted.Status -ne 204) { throw "Query binding cleanup failed: HTTP $($deleted.Status)" }
            $gone = Invoke-QueryRequest GET "/scim/admin/endpoints/$roleEndpointId" $null
            Add-QueryCheck ($gone.Status -eq 404) 'Exact owned query binding endpoint removed and absence verified'
        }
    } finally {
        if ($endpointId) {
            $deleted = Invoke-QueryRequest DELETE "/scim/admin/endpoints/$endpointId" $null
            if ($deleted.Status -ne 204) { throw "Query smoke cleanup failed: HTTP $($deleted.Status)" }
            $gone = Invoke-QueryRequest GET "/scim/admin/endpoints/$endpointId" $null
            Add-QueryCheck ($gone.Status -eq 404) 'Exact owned query endpoint removed and absence verified'
        }
    }
}

$results
if (@($results | Where-Object { -not $_.Success }).Count) { throw 'Query semantics smoke failed. See individual checks.' }
