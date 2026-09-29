[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][string]$Token,
    [string]$ReaderBaseUrl,
    [string]$ReaderToken
)

$ErrorActionPreference = 'Stop'
$results = [System.Collections.Generic.List[object]]::new()
$endpointId = $null
if (-not $ReaderBaseUrl) { $ReaderBaseUrl = $BaseUrl }
if (-not $ReaderToken) { $ReaderToken = $Token }

function Invoke-FreshnessRequest {
    param([string]$Method, [string]$Path, $Body, [switch]$Reader)
    $base = if ($Reader) { $ReaderBaseUrl } else { $BaseUrl }
    $bearer = if ($Reader) { $ReaderToken } else { $Token }
    $arguments = @{
        Uri = "$($base.TrimEnd('/'))$Path"
        Method = $Method
        Headers = @{ Authorization = "Bearer $bearer" }
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

function Add-FreshnessCheck {
    param([bool]$Success, [string]$Message)
    $results.Add([pscustomobject]@{ Success = $Success; Message = $Message })
}

try {
    $name = "live-freshness-$([Guid]::NewGuid().ToString('N'))"
    $created = Invoke-FreshnessRequest POST '/scim/admin/endpoints' @{
        name = $name
        profilePreset = 'rfc-standard'
    }
    if ($created.Status -ne 201 -or -not $created.Body.id) {
        throw "Freshness endpoint creation failed with HTTP $($created.Status)."
    }
    $endpointId = $created.Body.id
    $admin = "/scim/admin/endpoints/$endpointId"
    $warm = Invoke-FreshnessRequest GET $admin $null -Reader
    if ($warm.Status -ne 200) { throw "Cannot warm reader endpoint: HTTP $($warm.Status)." }
    $changed = Invoke-FreshnessRequest PATCH $admin @{
        displayName = 'Freshly updated endpoint'
        profile = @{
            settings = @{ StrictSchemaValidation = $false }
            serviceProviderConfig = @{ patch = @{ supported = $false } }
        }
    }
    if ($changed.Status -ne 200) { throw "Cannot update endpoint: HTTP $($changed.Status)." }
    $read = Invoke-FreshnessRequest GET $admin $null -Reader
    Add-FreshnessCheck ($read.Status -eq 200 -and $read.Body.displayName -eq 'Freshly updated endpoint') 'Warmed reader observes changed metadata'
    Add-FreshnessCheck ($read.Status -eq 200 -and $read.Body.profile.settings.StrictSchemaValidation -eq $false) 'Warmed reader observes changed setting'
    $discovery = Invoke-FreshnessRequest GET "/scim/endpoints/$endpointId/ServiceProviderConfig" $null -Reader
    Add-FreshnessCheck ($discovery.Status -eq 200 -and $discovery.Body.patch.supported -eq $false) 'Discovery uses refreshed capability'
    $inactive = Invoke-FreshnessRequest PATCH $admin @{ active = $false }
    if ($inactive.Status -ne 200) { throw "Cannot deactivate endpoint: HTTP $($inactive.Status)." }
    $byName = Invoke-FreshnessRequest GET "/scim/admin/endpoints/by-name/$name" $null -Reader
    Add-FreshnessCheck ($byName.Status -eq 200 -and $byName.Body.active -eq $false) 'Name lookup observes active-state change'
    $list = Invoke-FreshnessRequest GET '/scim/admin/endpoints?active=true' $null -Reader
    Add-FreshnessCheck ($list.Status -eq 200 -and $endpointId -notin @($list.Body.endpoints.id)) 'Active list excludes deactivated endpoint'

    $durations = @(foreach ($sample in 1..30) {
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $sampleResponse = Invoke-FreshnessRequest GET $admin $null -Reader
        $clock.Stop()
        if ($sampleResponse.Status -ne 200 -or $sampleResponse.Body.id -ne $endpointId) {
            throw 'Endpoint read failed during timing samples.'
        }
        $clock.Elapsed.TotalMilliseconds
    }) | Sort-Object
    Write-Host ("Endpoint read timing (30 sequential requests): p50={0:N2}ms p95={1:N2}ms p99={2:N2}ms" -f $durations[14], $durations[28], $durations[29])

    $deleted = Invoke-FreshnessRequest DELETE $admin $null
    if ($deleted.Status -ne 204) { throw "Freshness cleanup failed: HTTP $($deleted.Status)." }
    $endpointId = $null
    $missing = Invoke-FreshnessRequest GET $admin $null -Reader
    Add-FreshnessCheck ($missing.Status -eq 404) 'Warmed reader no longer serves deleted endpoint'
    $stats = Invoke-FreshnessRequest GET "$admin/stats" $null -Reader
    Add-FreshnessCheck ($stats.Status -eq 404) 'Statistics no longer serves deleted endpoint'
} finally {
    if ($endpointId) {
        $cleanup = Invoke-FreshnessRequest DELETE "/scim/admin/endpoints/$endpointId" $null
        if ($cleanup.Status -ne 204) { throw "Freshness cleanup failed: HTTP $($cleanup.Status)." }
    }
}

$results
if (@($results | Where-Object { -not $_.Success }).Count -gt 0) {
    throw 'Endpoint freshness smoke failed. See the individual checks.'
}
