function Invoke-ScimProfileRevisionContract {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][hashtable]$Headers,
        [string]$ExistingEndpointId
    )

    $base = $BaseUrl.TrimEnd('/')
    $endpointId = $ExistingEndpointId
    $ownsEndpoint = [string]::IsNullOrWhiteSpace($endpointId)
    $resources = [System.Collections.Generic.List[string]]::new()
    $script:currentSection = '9z-DP: Profile Revision CRUD'
    try {
        $userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User'
        $groupSchema = 'urn:ietf:params:scim:schemas:core:2.0:Group'
        $deviceSchema = 'urn:example:profile-revision:Device'
        if ($ownsEndpoint) {
            $profile = @{
                schemas = @(
                    @{ id = $userSchema; name = 'User'; attributes = 'all' }
                    @{ id = $groupSchema; name = 'Group'; attributes = 'all' }
                    @{ id = $deviceSchema; name = 'Device'; attributes = @(@{ name = 'displayName'; type = 'string' }) }
                )
                resourceTypes = @(
                    @{ id = 'User'; name = 'User'; endpoint = '/Users'; schema = $userSchema; schemaExtensions = @() }
                    @{ id = 'Group'; name = 'Group'; endpoint = '/Groups'; schema = $groupSchema; schemaExtensions = @() }
                    @{ id = 'Device'; name = 'Device'; endpoint = '/Devices'; schema = $deviceSchema; schemaExtensions = @() }
                )
                settings = @{ StrictSchemaValidation = $true }
                serviceProviderConfig = @{ patch = @{ supported = $true }; etag = @{ supported = $false } }
            }
            $endpoint = Invoke-RestMethod -Uri "$base/scim/admin/endpoints" -Method Post -Headers $Headers `
                -ContentType 'application/json' -ErrorAction Stop `
                -Body (@{ name = "live-profile-revision-$([guid]::NewGuid().ToString('N'))"; profile = $profile } | ConvertTo-Json -Depth 20)
            $endpointId = $endpoint.id
            if ([string]::IsNullOrWhiteSpace($endpointId)) { throw 'Owned endpoint creation returned no id.' }
        }

        $before = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$endpointId" -Headers $Headers -ErrorAction Stop
        $profileBefore = $before.profile | ConvertTo-Json -Depth 40 -Compress
        $endpointKeys = @('id', 'name', 'displayName', 'description', 'active', 'scimBasePath', 'createdAt', 'updatedAt', 'profile', '_links')
        $unexpectedEndpointKeys = @($before.PSObject.Properties.Name | Where-Object { $_ -notin $endpointKeys })
        Test-Result -Success ($unexpectedEndpointKeys.Count -eq 0) `
            -Message "9z-DP: endpoint contract unexpected fields: [$($unexpectedEndpointKeys -join ', ')]"
        $discovery = Invoke-RestMethod -Uri "$base/scim/endpoints/$endpointId/Schemas" -Headers $Headers -ErrorAction Stop
        $routes = if ($ownsEndpoint) { @('Users', 'Groups', 'Devices') } else { @('Users', 'Groups') }
        foreach ($route in $routes) {
            $tag = [guid]::NewGuid().ToString('N')
            $field = if ($route -eq 'Users') { 'userName' } else { 'displayName' }
            $schema = if ($route -eq 'Users') { $userSchema } elseif ($route -eq 'Groups') { $groupSchema } else { $deviceSchema }
            $payload = @{ schemas = @($schema); $field = "profile-revision-$tag@example.invalid" }
            if ($route -eq 'Users') {
                $payload.emails = @(@{ type = 'work'; value = "profile-revision-$tag@example.invalid"; primary = $true })
                $payload.active = $true
            }
            $collection = "$base/scim/endpoints/$endpointId/$route"
            $created = Invoke-RestMethod -Uri $collection -Method Post -Headers $Headers `
                -ContentType 'application/scim+json' -ErrorAction Stop -Body ($payload | ConvertTo-Json -Depth 20)
            if ([string]::IsNullOrWhiteSpace($created.id)) { throw "$route create returned no id." }
            $item = "$collection/$($created.id)"
            $resources.Add($item)
            Test-Result -Success ($created.$field -eq $payload[$field]) -Message "9z-DP: $route POST returns the created value"

            $payload[$field] = "profile-revision-replaced-$tag@example.invalid"
            $writeHeaders = $Headers.Clone()
            if ($created.meta.version) { $writeHeaders['If-Match'] = $created.meta.version }
            $replaced = Invoke-RestMethod -Uri $item -Method Put -Headers $writeHeaders `
                -ContentType 'application/scim+json' -ErrorAction Stop -Body ($payload | ConvertTo-Json -Depth 20)
            Test-Result -Success ($replaced.$field -eq $payload[$field]) -Message "9z-DP: $route PUT persists the replacement"

            $value = "profile-revision-patched-$tag@example.invalid"
            $patch = @{
                schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
                Operations = @(@{ op = 'replace'; path = $field; value = $value })
            }
            if ($replaced.meta.version) { $writeHeaders['If-Match'] = $replaced.meta.version }
            $patched = Invoke-RestMethod -Uri $item -Method Patch -Headers $writeHeaders `
                -ContentType 'application/scim+json' -ErrorAction Stop -Body ($patch | ConvertTo-Json -Depth 20)
            Test-Result -Success ($patched.$field -eq $value) -Message "9z-DP: $route PATCH returns the edited value"
            $read = Invoke-RestMethod -Uri $item -Headers $Headers -ErrorAction Stop
            Test-Result -Success ($read.$field -eq $value) -Message "9z-DP: $route GET reads the persisted edit"
            $allowedKeys = @('id', 'schemas', 'meta') + @($created.schemas)
            $allowedKeys += @($discovery.Resources | Where-Object { $_.id -in $created.schemas } |
                ForEach-Object { $_.attributes | ForEach-Object name })
            $unexpected = @(@($created, $replaced, $patched, $read) | ForEach-Object {
                $_.PSObject.Properties.Name | Where-Object { $_ -notin $allowedKeys }
            })
            Test-Result -Success ($unexpected.Count -eq 0) -Message "9z-DP: $route responses contain only published attributes"
            if ($read.meta.version) { $writeHeaders['If-Match'] = $read.meta.version }
            $deleted = Invoke-WebRequest -Uri $item -Method Delete -Headers $writeHeaders -ErrorAction Stop
            Test-Result -Success ($deleted.StatusCode -eq 204) -Message "9z-DP: $route DELETE returns 204"
            $resources.Remove($item) | Out-Null
            $missing = Invoke-WebRequest -Uri $item -Headers $Headers -SkipHttpErrorCheck -ErrorAction Stop
            Test-Result -Success ($missing.StatusCode -eq 404) -Message "9z-DP: $route remains absent after deletion"
        }
        $after = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$endpointId" -Headers $Headers -ErrorAction Stop
        Test-Result -Success (($after.profile | ConvertTo-Json -Depth 40 -Compress) -eq $profileBefore) `
            -Message '9z-DP: resource CRUD did not rewrite the endpoint profile'
    } catch {
        Test-Result -Success $false -Message "9z-DP: profile revision contract failed: $($_.Exception.Message)"
    } finally {
        if ($ownsEndpoint -and $endpointId) {
            try {
                $null = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$endpointId" -Method Delete -Headers $Headers -ErrorAction Stop
                Test-Result -Success $true -Message '9z-DP: removed exact owned endpoint'
            } catch {
                Test-Result -Success $false -Message '9z-DP: failed to remove exact owned endpoint'
            }
        } elseif (-not $ownsEndpoint) {
            foreach ($item in $resources) {
                try {
                    $latest = Invoke-WebRequest -Uri $item -Headers $Headers -SkipHttpErrorCheck -ErrorAction Stop
                    if ($latest.StatusCode -eq 404) {
                        Test-Result -Success $true -Message '9z-DP: exact owned resource is already absent'
                        continue
                    }
                    if ($latest.StatusCode -ne 200) { throw "Owned resource read returned $($latest.StatusCode)." }
                    $cleanupHeaders = $Headers.Clone()
                    $latestResource = $latest.Content | ConvertFrom-Json -ErrorAction Stop
                    if ($latestResource.meta.version) { $cleanupHeaders['If-Match'] = $latestResource.meta.version }
                    $response = Invoke-WebRequest -Uri $item -Method Delete -Headers $cleanupHeaders -SkipHttpErrorCheck -ErrorAction Stop
                    Test-Result -Success ($response.StatusCode -in @(204, 404)) -Message '9z-DP: removed exact owned resource'
                } catch {
                    Test-Result -Success $false -Message '9z-DP: failed to remove exact owned resource'
                }
            }
        }
    }
}
