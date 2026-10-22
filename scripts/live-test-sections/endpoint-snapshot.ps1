function Invoke-EndpointSnapshotContract {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][hashtable]$Headers,
        [Parameter(Mandatory)][string]$SharedSecret
    )
    $script:currentSection = '9z-DR: Endpoint Snapshot'
    $base = $BaseUrl.TrimEnd('/')
    $endpointId = $null
    $document = $null
    try {
        $created = Invoke-RestMethod "$base/scim/admin/endpoints" -Method Post -Headers $Headers `
            -ContentType 'application/json' -ErrorAction Stop `
            -Body (@{ name = "live-snapshot-$([guid]::NewGuid().ToString('N'))"; profilePreset = 'rfc-standard' } | ConvertTo-Json)
        $endpointId = $created.id
        if ([string]::IsNullOrWhiteSpace($endpointId)) { throw 'Endpoint creation returned no id.' }
        $url = "$base/scim/admin/endpoints/$endpointId"
        $null = Invoke-RestMethod $url -Headers $Headers -ErrorAction Stop
        $settings = @{
            SecretTokenBearerAuthEnabled = $false
            OAuthClientCredentialsAuthEnabled = $false
            SharedSecretBearerAuthEnabled = $true
        }
        $patched = Invoke-RestMethod $url -Method Patch -Headers $Headers -ErrorAction Stop `
            -ContentType 'application/json' -Body (@{ profile = @{ settings = $settings } } | ConvertTo-Json -Depth 5)
        $read = Invoke-WebRequest $url -Headers $Headers -ErrorAction Stop
        $content = if ($read.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($read.Content) } else { $read.Content }
        $document = [Text.Json.JsonDocument]::Parse([string]$content)
        $snapshot = $document.RootElement
        $createdAt = $snapshot.GetProperty('createdAt').GetString()
        $updatedAt = $snapshot.GetProperty('updatedAt').GetString()
        Test-Result -Success ($createdAt -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' -and
            ([datetimeoffset]$createdAt).UtcTicks -eq ([datetimeoffset]$created.createdAt).UtcTicks) `
            -Message '9z-DR.T1: endpoint snapshot preserves exact UTC creation timestamp'
        Test-Result -Success ($updatedAt -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' -and
            ([datetimeoffset]$updatedAt).UtcTicks -eq ([datetimeoffset]$patched.updatedAt).UtcTicks) `
            -Message '9z-DR.T2: warmed snapshot returns exact current UTC update timestamp'
        Test-Result -Success (-not $snapshot.GetProperty('profile').GetProperty('settings').GetProperty('SecretTokenBearerAuthEnabled').GetBoolean()) `
            -Message '9z-DR.T3: warmed snapshot observes changed credential enablement'
        $allowed = @('id', 'name', 'displayName', 'description', 'profile', 'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links')
        Test-Result -Success (@($snapshot.EnumerateObject() | Where-Object Name -CNotIn $allowed).Count -eq 0) `
            -Message '9z-DR.T4: endpoint response has no database fingerprint or internal fields'
        $correlation = [guid]::NewGuid().ToString()
        $probeHeaders = @{ Authorization = "Bearer $SharedSecret"; 'X-Request-Id' = $correlation }
        $groups = Invoke-RestMethod "$base/scim/endpoints/$endpointId/Groups" -Headers $probeHeaders -ErrorAction Stop
        Test-Result -Success ($groups.totalResults -eq 0 -and $groups.Resources -is [array] -and $groups.Resources.Count -eq 0 -and
            $groups.schemas -ccontains 'urn:ietf:params:scim:api:messages:2.0:ListResponse' -and
            @($groups.PSObject.Properties.Name | Where-Object { $_ -cnotin @('schemas', 'totalResults', 'startIndex', 'itemsPerPage', 'Resources') }).Count -eq 0) `
            -Message '9z-DR.T5: matching global secret returns the documented empty ListResponse'
        $decisions = Invoke-RestMethod "$url/auth-decisions?limit=100" -Headers $Headers -ErrorAction Stop
        $matches = @($decisions.records | Where-Object correlationId -CEQ $correlation)
        Test-Result -Success ($matches.Count -eq 1) -Message '9z-DR.T6: actual request has one correlated auth decision'
        $checks = @($matches | ForEach-Object checks | Where-Object id -CEQ 'endpoint_bearer')
        Test-Result -Success ($checks.Count -eq 1 -and $checks[0].status -ceq 'skipped' -and
            $checks[0].received -ceq 'token is the global shared secret (handled by the legacy acceptor)') `
            -Message '9z-DR.T7: credential skip explains token applicability before disabled-method policy'
    } catch {
        Test-Result -Success $false -Message "9z-DR: endpoint snapshot contract failed: $($_.Exception.Message)"
    } finally {
        if ($document) { $document.Dispose() }
        if ($endpointId) {
            try {
                $deleted = Invoke-WebRequest "$base/scim/admin/endpoints/$endpointId" -Method Delete -Headers $Headers -ErrorAction Stop
                $missing = Invoke-WebRequest "$base/scim/admin/endpoints/$endpointId" -Headers $Headers -SkipHttpErrorCheck -ErrorAction Stop
                Test-Result -Success ($deleted.StatusCode -eq 204 -and $missing.StatusCode -eq 404) `
                    -Message '9z-DR.T8: exact owned endpoint deletion and absence verified'
            } catch {
                Test-Result -Success $false -Message "9z-DR.cleanup: exact owned endpoint cleanup failed: $($_.Exception.Message)"
            }
        }
    }
}
