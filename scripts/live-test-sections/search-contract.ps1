function Invoke-ScimSearchContractTests {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][hashtable]$Headers
    )

    $script:currentSection = '9z-CO: JSON search contract'
    $endpointId = $null
    $schema = 'urn:example:params:scim:schemas:custom:2.0:SearchSensor'
    $searchSchema = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest'
    $userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User'
    $groupSchema = 'urn:ietf:params:scim:schemas:core:2.0:Group'
    try {
        $endpoint = @{
            name = "live-search-$([guid]::NewGuid().ToString('N'))"
            profile = @{
                schemas = @(
                    @{ id = $userSchema; name = 'User'; attributes = 'all' }
                    @{ id = $groupSchema; name = 'Group'; attributes = 'all' }
                    @{
                        id = $schema; name = 'SearchSensor'
                        attributes = @(
                            @{ name = 'displayName'; type = 'string' }
                            @{ name = 'location'; type = 'string' }
                        )
                    }
                )
                resourceTypes = @(
                    @{ id = 'User'; name = 'User'; endpoint = '/Users'; schema = $userSchema; schemaExtensions = @() }
                    @{ id = 'Group'; name = 'Group'; endpoint = '/Groups'; schema = $groupSchema; schemaExtensions = @() }
                    @{ id = 'SearchSensor'; name = 'SearchSensor'; endpoint = '/SearchSensors'; schema = $schema; schemaExtensions = @() }
                )
            }
        }
        $created = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method Post -Headers $Headers `
            -ContentType 'application/json' -Body ($endpoint | ConvertTo-Json -Depth 20) -ErrorAction Stop
        $endpointId = $created.id
        $root = "$BaseUrl/scim/endpoints/$endpointId"
        $user = Invoke-RestMethod -Uri "$root/Users" -Method Post -Headers $Headers -ContentType 'application/scim+json' `
            -Body (@{ schemas = @($userSchema); userName = 'search@example.test'; displayName = 'Search contract'; name = @{ givenName = 'Search' } } | ConvertTo-Json -Depth 10) -ErrorAction Stop
        $group = Invoke-RestMethod -Uri "$root/Groups" -Method Post -Headers $Headers -ContentType 'application/scim+json' `
            -Body (@{ schemas = @($groupSchema); displayName = 'Search contract'; members = @(@{ value = $user.id }) } | ConvertTo-Json -Depth 10) -ErrorAction Stop
        $sensor = Invoke-RestMethod -Uri "$root/SearchSensors" -Method Post -Headers $Headers -ContentType 'application/scim+json' `
            -Body (@{ schemas = @($schema); displayName = 'Search contract'; location = 'Room A' } | ConvertTo-Json -Depth 10) -ErrorAction Stop
        $fixtures = @(
            @{ family = 'Users'; resource = $user; extra = 'name'; keys = @('id', 'schemas', 'meta', 'userName', 'displayName') }
            @{ family = 'Groups'; resource = $group; extra = 'members'; keys = @('id', 'schemas', 'meta', 'displayName') }
            @{ family = 'SearchSensors'; resource = $sensor; extra = 'location'; keys = @('id', 'schemas', 'meta', 'displayName') }
        )
        foreach ($fixture in $fixtures) {
            $path = "$root/$($fixture.family)"
            foreach ($form in @('array', 'string', 'GET')) {
                if ($form -eq 'GET') {
                    $result = Invoke-RestMethod -Uri "${path}?attributes=displayName" -Headers $Headers -ErrorAction Stop
                } else {
                    $selection = if ($form -eq 'array') { ,@('displayName') } else { 'displayName' }
                    $body = @{ schemas = @($searchSchema); attributes = $selection } | ConvertTo-Json -Depth 10
                    $result = Invoke-RestMethod -Uri "$path/.search" -Method Post -Headers $Headers -ContentType 'application/scim+json' -Body $body -ErrorAction Stop
                }
                $item = @($result.Resources)[0]
                Test-Result -Success ($result.totalResults -eq 1 -and $result.itemsPerPage -eq 1 -and $result.startIndex -eq 1 -and @($result.Resources).Count -eq 1) -Message "9z-CO $($fixture.family) $form list counts"
                Test-Result -Success ($item.id -eq $fixture.resource.id -and $item.displayName -eq 'Search contract') -Message "9z-CO $($fixture.family) $form projected values"
                $unexpected = @($item.PSObject.Properties.Name | Where-Object { $_ -notin $fixture.keys })
                Test-Result -Success ($unexpected.Count -eq 0) -Message "9z-CO $($fixture.family) $form resource key allowlist"
                $listKeys = @($result.PSObject.Properties.Name | Where-Object { $_ -notin @('schemas', 'Resources', 'totalResults', 'startIndex', 'itemsPerPage') })
                Test-Result -Success ($listKeys.Count -eq 0 -and $result.schemas -contains 'urn:ietf:params:scim:api:messages:2.0:ListResponse') -Message "9z-CO $($fixture.family) $form list envelope"
            }
            $body = @{ excludedAttributes = @($fixture.extra) } | ConvertTo-Json -Depth 10
            $result = Invoke-RestMethod -Uri "$path/.search" -Method Post -Headers $Headers -ContentType 'application/scim+json' -Body $body -ErrorAction Stop
            Test-Result -Success ($null -ne $fixture.resource.($fixture.extra) -and @($result.Resources)[0].PSObject.Properties.Name -notcontains $fixture.extra -and @($result.Resources)[0].id -eq $fixture.resource.id) -Message "9z-CO $($fixture.family) excludes populated attribute"
            foreach ($invalid in @(
                @{ attributes = @('id', 12) }
                @{ excludedAttributes = @{ name = 'id' } }
                @{ count = -1; startIndex = 0; sortOrder = 'sideways' }
            )) {
                $wire = Invoke-WebRequest -Uri "$path/.search" -Method Post -Headers $Headers -ContentType 'application/scim+json' `
                    -Body ($invalid | ConvertTo-Json -Depth 10) -SkipHttpErrorCheck -ErrorAction Stop
                $text = if ($wire.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($wire.Content) } else { [string]$wire.Content }
                $errorBody = $text | ConvertFrom-Json
                Test-Result -Success ([int]$wire.StatusCode -eq 400 -and $errorBody.status -ceq '400' -and $errorBody.detail -is [string]) -Message "9z-CO $($fixture.family) invalid input scalar detail"
                $errorKeys = @($errorBody.PSObject.Properties.Name | Where-Object { $_ -notin @('schemas', 'status', 'detail', 'scimType', 'urn:scimserver:api:messages:2.0:Diagnostics') })
                Test-Result -Success ($errorKeys.Count -eq 0 -and $errorBody.schemas -contains 'urn:ietf:params:scim:api:messages:2.0:Error') -Message "9z-CO $($fixture.family) error key allowlist"
                if ($invalid.ContainsKey('count')) {
                    Test-Result -Success ($errorBody.detail -match 'count' -and $errorBody.detail -match 'startIndex' -and $errorBody.detail -match 'sortOrder') -Message "9z-CO $($fixture.family) all DTO errors preserved"
                }
            }
        }
    } catch {
        Test-Result -Success $false -Message "9z-CO search contract failed: $($_.Exception.Message)"
    } finally {
        if ($endpointId) {
            try {
                $null = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$endpointId" -Method Delete -Headers $Headers -ErrorAction Stop
                Test-Result -Success $true -Message '9z-CO cleanup: removed only dedicated endpoint'
            } catch {
                Test-Result -Success $false -Message "9z-CO cleanup failed: $($_.Exception.Message)"
            }
        }
    }
}
