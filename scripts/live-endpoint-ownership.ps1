function ConvertTo-LiveEndpointUuid {
    param([string]$Id)
    $uuid = [guid]::Empty
    if (-not [guid]::TryParseExact($Id, 'D', [ref]$uuid) -or $uuid -eq [guid]::Empty) {
        throw 'Endpoint fixture identity must be a non-empty UUID.'
    }
    return $uuid.ToString('D')
}

function Initialize-LiveEndpointOwnership {
    $ownership = $global:__ScimServerLiveEndpointOwnership
    if ($ownership.orphanGuardArmed -or $ownership.ownedEndpointHandles.Count -gt 0) {
        throw 'Cannot replace an armed original inventory or retained cleanup handles.'
    }
    $ownership.orphanGuardArmed = $false
    $inventory = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Headers $headers -ErrorAction Stop
    if ($null -eq $inventory -or $null -eq $inventory.endpoints -or
        $inventory.endpoints -isnot [array] -or
        ($inventory.totalResults -isnot [int] -and $inventory.totalResults -isnot [long]) -or
        $inventory.totalResults -lt 0 -or $inventory.totalResults -gt [int]::MaxValue -or
        $inventory.totalResults -ne $inventory.endpoints.Count) {
        throw 'Original endpoint inventory is malformed or incomplete; fixture creation is blocked.'
    }
    $ids = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($endpoint in $inventory.endpoints) {
        $id = ConvertTo-LiveEndpointUuid -Id $endpoint.id
        if (-not $ids.Add($id)) { throw 'Original endpoint inventory contains duplicate UUIDs.' }
    }
    $ownership.preexistingEndpointIds = $ids
    $ownership.ownedEndpointHandles = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $ownership.endpointCleanupFailures = [System.Collections.Generic.List[string]]::new()
    $ownership.orphanGuardArmed = $true
}

function Get-LiveEndpointRequest {
    param([string]$Uri, [string]$Method)
    if ($Method -notin @('POST', 'PUT', 'PATCH', 'DELETE')) { return $null }
    $ownership = $global:__ScimServerLiveEndpointOwnership
    $target = [uri]$Uri
    $root = [uri]$baseUrl
    if ($target.Authority -ine $root.Authority -or $target.Scheme -ine $root.Scheme) {
        throw 'Fixture mutation must use the configured target.'
    }
    $prefix = $root.AbsolutePath.TrimEnd('/')
    if (-not $target.AbsolutePath.StartsWith("$prefix/", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Fixture mutation must use the configured base path.'
    }
    $path = $target.AbsolutePath.Substring($prefix.Length).TrimEnd('/')
    if ($path -ieq '/scim/admin/endpoints' -and $Method -eq 'POST') {
        if (-not $ownership.orphanGuardArmed) { throw 'Complete original endpoint inventory is required before creation.' }
        return [pscustomobject]@{ Create = $true; Delete = $false; Id = $null }
    }
    if ($path -match '^/scim/(?:admin/endpoints|endpoints)/([^/]+)(.*)$' -or
        $path -match '^/scim/admin/log-config/endpoint/([^/]+)(.*)$') {
        if ($ownership.endpointRejectionProbe -and -not $ownership.endpointRejectionProbe.Consumed -and
            $Method -eq 'POST' -and $path -match '^/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/(schemas|resource-types)$' -and
            $target.AbsoluteUri -ceq $ownership.endpointRejectionProbe.Uri) {
            $ownership.endpointRejectionProbe.Consumed = $true
            return [pscustomobject]@{ Create = $false; Delete = $false; RejectionProbe = $true; Id = [guid]::Empty.ToString() }
        }
        $id = ConvertTo-LiveEndpointUuid -Id ([uri]::UnescapeDataString($Matches[1]))
        $delete = $Method -eq 'DELETE' -and $path -match '^/scim/admin/endpoints/[^/]+$'
        if (-not $ownership.orphanGuardArmed -or $ownership.preexistingEndpointIds.Contains($id) -or
            -not $ownership.ownedEndpointHandles.ContainsKey($id)) {
            throw 'Endpoint fixture mutation requires a registered owned response UUID.'
        }
        return [pscustomobject]@{
            Create = $false
            Delete = $delete
            Id = $id
        }
    }
    return $null
}

function Complete-LiveEndpointRequest {
    param($Request, [int]$StatusCode, $Response)
    if ($null -eq $Request) { return }
    $ownership = $global:__ScimServerLiveEndpointOwnership
    if ($Request.RejectionProbe -and $StatusCode -ge 200 -and $StatusCode -lt 300) {
        $ownership.endpointCleanupFailures.Add('unexpected rejection-probe success')
        throw 'The bounded nonexistent-endpoint probe unexpectedly succeeded.'
    }
    if ($Request.Create) {
        # Registration precedes returning the response to any seeding/teardown caller.
        if ($StatusCode -lt 200 -or $StatusCode -ge 300) { return }
        $id = ConvertTo-LiveEndpointUuid -Id $Response.id
        if ($ownership.preexistingEndpointIds.Contains($id) -or $ownership.ownedEndpointHandles.ContainsKey($id)) {
            throw 'Created endpoint response UUID is original or already registered; caller assignment is blocked.'
        }
        $ownership.ownedEndpointHandles.Add($id, [pscustomobject]@{ Id = $id; Deleted = $false })
    } elseif ($Request.Delete) {
        if ($StatusCode -lt 200 -or $StatusCode -ge 300) {
            throw 'Owned endpoint DELETE did not return a successful HTTP status.'
        }
        $readback = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$($Request.Id)" -Method GET -Headers $headers -SkipHttpErrorCheck -ErrorAction Stop
        if ([int]$readback.StatusCode -ne 404) {
            throw 'Owned endpoint DELETE lacks verified exact-ID absence (HTTP 404 required).'
        }
        $ownership.ownedEndpointHandles[$Request.Id].Deleted = $true
    }
}

function Invoke-LiveEndpointRejectionProbe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('schemas', 'resource-types')][string]$Route,
        [Parameter(Mandatory)][string]$OwnedEndpointId,
        [System.Collections.IDictionary]$Headers,
        [object]$Body,
        [string]$ContentType
    )
    $ownership = $global:__ScimServerLiveEndpointOwnership
    $ownedId = ConvertTo-LiveEndpointUuid -Id $OwnedEndpointId
    if (-not $ownership.orphanGuardArmed -or -not $ownership.ownedEndpointHandles.ContainsKey($ownedId) -or
        $ownership.ownedEndpointHandles[$ownedId].Deleted -or $ownership.endpointRejectionProbe) {
        throw 'A bounded rejection probe requires a retained active owned handle and no active probe.'
    }
    $endpoint = "$baseUrl/scim/admin/endpoints/$([guid]::Empty.ToString())"
    $absence = Invoke-WebRequest -Uri $endpoint -Method GET -Headers $Headers -SkipHttpErrorCheck -ErrorAction Stop
    if ([int]$absence.StatusCode -ne 404) { throw 'The nonexistent-endpoint sentinel must return HTTP 404 before probing.' }
    $parameters = @{}
    foreach ($key in $PSBoundParameters.Keys) {
        if ($key -notin @('Route', 'OwnedEndpointId')) { $parameters[$key] = $PSBoundParameters[$key] }
    }
    $parameters.Uri = "$endpoint/$Route"
    $parameters.Method = 'POST'
    # One checked sentinel request, not general permission to mutate unknown IDs.
    $ownership.endpointRejectionProbe = [pscustomobject]@{ Uri = ([uri]$parameters.Uri).AbsoluteUri; Consumed = $false }
    try {
        Invoke-RestMethod @parameters
    } finally {
        $ownership.endpointRejectionProbe = $null
    }
}

function Invoke-OrphanReconciliation {
    $ownership = $global:__ScimServerLiveEndpointOwnership
    if (-not $ownership.orphanGuardArmed) { return }
    foreach ($handle in @($ownership.ownedEndpointHandles.Values)) {
        if ($handle.Deleted) { continue }
        try {
            Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($handle.Id)" -Method DELETE -Headers $headers -ErrorAction Stop | Out-Null
        } catch {
            # Continue exact owned cleanup, but never convert partial cleanup to success.
            $ownership.endpointCleanupFailures.Add($handle.Id)
        }
    }
    if ($ownership.endpointCleanupFailures.Count -gt 0) {
        throw "Endpoint cleanup failed; retained owned handles require investigation ($($ownership.endpointCleanupFailures.Count) failure(s))."
    }
}
