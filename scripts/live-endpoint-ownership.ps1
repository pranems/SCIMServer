function ConvertTo-LiveEndpointUuid {
    param([string]$Id)
    $uuid = [guid]::Empty
    if (-not [guid]::TryParseExact($Id, 'D', [ref]$uuid) -or $uuid -eq [guid]::Empty) {
        throw 'Endpoint fixture identity must be a non-empty UUID.'
    }
    return $uuid.ToString('D')
}

function Initialize-LiveEndpointOwnership {
    if ($script:orphanGuardArmed -or $script:ownedEndpointHandles.Count -gt 0) {
        throw 'Cannot replace an armed original inventory or retained cleanup handles.'
    }
    $script:orphanGuardArmed = $false
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
    $script:preexistingEndpointIds = $ids
    $script:ownedEndpointHandles = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $script:endpointCleanupFailures = [System.Collections.Generic.List[string]]::new()
    $script:orphanGuardArmed = $true
}

function Get-LiveEndpointRequest {
    param([string]$Uri, [string]$Method)
    if ($Method -notin @('POST', 'PUT', 'PATCH', 'DELETE')) { return $null }
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
        if (-not $script:orphanGuardArmed) { throw 'Complete original endpoint inventory is required before creation.' }
        return [pscustomobject]@{ Create = $true; Delete = $false; Id = $null }
    }
    if ($path -match '^/scim/(?:admin/endpoints|endpoints)/([^/]+)(.*)$' -or
        $path -match '^/scim/admin/log-config/endpoint/([^/]+)(.*)$') {
        if ($script:endpointRejectionProbe -and -not $script:endpointRejectionProbe.Consumed -and
            $Method -eq 'POST' -and $path -match '^/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/(schemas|resource-types)$' -and
            $target.AbsoluteUri -ceq $script:endpointRejectionProbe.Uri) {
            $script:endpointRejectionProbe.Consumed = $true
            return [pscustomobject]@{ Create = $false; Delete = $false; RejectionProbe = $true; Id = [guid]::Empty.ToString() }
        }
        $id = ConvertTo-LiveEndpointUuid -Id ([uri]::UnescapeDataString($Matches[1]))
        $delete = $Method -eq 'DELETE' -and $path -match '^/scim/admin/endpoints/[^/]+$'
        if (-not $script:orphanGuardArmed -or $script:preexistingEndpointIds.Contains($id) -or
            -not $script:ownedEndpointHandles.ContainsKey($id)) {
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
    if ($Request.RejectionProbe -and $StatusCode -ge 200 -and $StatusCode -lt 300) {
        $script:endpointCleanupFailures.Add('unexpected rejection-probe success')
        throw 'The bounded nonexistent-endpoint probe unexpectedly succeeded.'
    }
    if ($Request.Create) {
        # Registration precedes returning the response to any seeding/teardown caller.
        if ($StatusCode -lt 200 -or $StatusCode -ge 300) { return }
        $id = ConvertTo-LiveEndpointUuid -Id $Response.id
        if ($script:preexistingEndpointIds.Contains($id) -or $script:ownedEndpointHandles.ContainsKey($id)) {
            throw 'Created endpoint response UUID is original or already registered; caller assignment is blocked.'
        }
        $script:ownedEndpointHandles.Add($id, [pscustomobject]@{ Id = $id; Deleted = $false })
    } elseif ($Request.Delete) {
        if ($StatusCode -lt 200 -or $StatusCode -ge 300) {
            throw 'Owned endpoint DELETE did not return a successful HTTP status.'
        }
        $readback = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$($Request.Id)" -Method GET -Headers $headers -SkipHttpErrorCheck -ErrorAction Stop
        if ([int]$readback.StatusCode -ne 404) {
            throw 'Owned endpoint DELETE lacks verified exact-ID absence (HTTP 404 required).'
        }
        $script:ownedEndpointHandles[$Request.Id].Deleted = $true
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
    $ownedId = ConvertTo-LiveEndpointUuid -Id $OwnedEndpointId
    if (-not $script:orphanGuardArmed -or -not $script:ownedEndpointHandles.ContainsKey($ownedId) -or
        $script:ownedEndpointHandles[$ownedId].Deleted -or $script:endpointRejectionProbe) {
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
    $script:endpointRejectionProbe = [pscustomobject]@{ Uri = ([uri]$parameters.Uri).AbsoluteUri; Consumed = $false }
    try {
        Invoke-RestMethod @parameters
    } finally {
        $script:endpointRejectionProbe = $null
    }
}

function Invoke-OrphanReconciliation {
    if (-not $script:orphanGuardArmed) { return }
    foreach ($handle in @($script:ownedEndpointHandles.Values)) {
        if ($handle.Deleted) { continue }
        try {
            Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($handle.Id)" -Method DELETE -Headers $headers -ErrorAction Stop | Out-Null
        } catch {
            # Continue exact owned cleanup, but never convert partial cleanup to success.
            $script:endpointCleanupFailures.Add($handle.Id)
        }
    }
    if ($script:endpointCleanupFailures.Count -gt 0) {
        throw "Endpoint cleanup failed; retained owned handles require investigation ($($script:endpointCleanupFailures.Count) failure(s))."
    }
}
