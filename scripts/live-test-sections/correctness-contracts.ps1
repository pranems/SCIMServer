function Invoke-ScimCorrectnessContractTests {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][hashtable]$Headers
    )

    $base = $BaseUrl.TrimEnd('/')
    $token = ([string]$Headers.Authorization) -replace '^Bearer\s+', ''
    . "$PSScriptRoot\search-contract.ps1"
    Invoke-ScimSearchContractTests -BaseUrl $base -Headers $Headers

    $script:currentSection = '9z-CP: Capability Boundary'
    try {
        $checks = @(& (Join-Path $PSScriptRoot '..\test-scim-capability-boundary.ps1') -BaseUrl $base -Token $token)
        foreach ($check in $checks) {
            Test-Result -Success $check.Success -Message "9z-CP: $($check.Message)"
        }
    } catch {
        Test-Result -Success $false -Message "9z-CP: capability boundary failed: $($_.Exception.Message)"
    }

    $script:currentSection = '9z-CQ: Typed PATCH Paths'
    $oldBase = $env:SCIM_LIVE_BASE_URL
    $oldToken = $env:SCIM_LIVE_TOKEN
    try {
        $env:SCIM_LIVE_BASE_URL = $base
        $env:SCIM_LIVE_TOKEN = $token
        $result = & node (Join-Path $PSScriptRoot 'typed-patch.cjs')
        if ($LASTEXITCODE -ne 0) { throw 'Typed PATCH contract process failed.' }
        $receipt = $result | ConvertFrom-Json -ErrorAction Stop
        Test-Result -Success ($receipt.assertions -eq 58) -Message '9z-CQ: 58 typed PATCH value, error, rollback and cleanup assertions'
    } catch {
        Test-Result -Success $false -Message "9z-CQ: typed PATCH contract failed: $($_.Exception.Message)"
    } finally {
        $env:SCIM_LIVE_BASE_URL = $oldBase
        $env:SCIM_LIVE_TOKEN = $oldToken
    }

    $script:currentSection = '9z-CR: Conditional Writes'
    $endpointId = $null
    try {
        $user = 'urn:ietf:params:scim:schemas:core:2.0:User'
        $group = 'urn:ietf:params:scim:schemas:core:2.0:Group'
        $device = 'urn:example:conditional:Device'
        $profile = @{
            schemas = @(
                @{ id = $user; name = 'User'; attributes = 'all' }
                @{ id = $group; name = 'Group'; attributes = 'all' }
                @{ id = $device; name = 'Device'; attributes = @(@{ name = 'displayName'; type = 'string' }) }
            )
            resourceTypes = @(
                @{ id = 'User'; name = 'User'; endpoint = '/Users'; schema = $user; schemaExtensions = @() }
                @{ id = 'Group'; name = 'Group'; endpoint = '/Groups'; schema = $group; schemaExtensions = @() }
                @{ id = 'Device'; name = 'Device'; endpoint = '/Devices'; schema = $device; schemaExtensions = @() }
            )
            settings = @{ StrictSchemaValidation = $true; logFileEnabled = $false }
            serviceProviderConfig = @{ patch = @{ supported = $true }; etag = @{ supported = $true } }
        }
        $created = Invoke-RestMethod -Uri "$base/scim/admin/endpoints" -Method Post -Headers $Headers `
            -ContentType 'application/json' -ErrorAction Stop `
            -Body (@{ name = "live-conditional-$([guid]::NewGuid().ToString('N'))"; profile = $profile } | ConvertTo-Json -Depth 20)
        $endpointId = $created.id
        if (-not $endpointId) { throw 'Conditional contract endpoint creation returned no id.' }
        . "$PSScriptRoot\conditional-writes.ps1"
        $count = Invoke-ScimConditionalWriteContract -EndpointUrl "$base/scim/endpoints/$endpointId" -Headers $Headers
        Test-Result -Success ($count -eq 33) -Message '9z-CR: 33 conditional write version, winner value and wildcard assertions'
    } catch {
        Test-Result -Success $false -Message "9z-CR: conditional write contract failed: $($_.Exception.Message)"
    } finally {
        if ($endpointId) {
            try {
                $null = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$endpointId" -Method Delete -Headers $Headers -ErrorAction Stop
                Test-Result -Success $true -Message '9z-CR: removed dedicated conditional endpoint'
            } catch {
                Test-Result -Success $false -Message '9z-CR: failed to remove dedicated conditional endpoint'
            }
        }

        $script:currentSection = '9z-CS: Endpoint Cache Freshness'
        try {
            & (Join-Path $PSScriptRoot '..\test-scim-endpoint-freshness.ps1') -BaseUrl $base -Token $token |
                ForEach-Object { Test-Result -Success $_.Success -Message "9z-CS: $($_.Message)" }
        } catch {
            Test-Result -Success $false -Message "9z-CS: endpoint freshness failed: $($_.Exception.Message)"
        }

        $script:currentSection = '9z-CT: Conditional Endpoint Writes'
        try {
            $conditionalChecks = & node (Join-Path $PSScriptRoot '..\live-endpoint-conditional.cjs') --base-url $base --token $token
            if ($LASTEXITCODE -ne 0) { throw 'Conditional endpoint live checks failed.' }
            $conditionalChecks | ConvertFrom-Json |
                ForEach-Object { Test-Result -Success $_.Success -Message "9z-CT: $($_.Message)" }
        } catch {
            Test-Result -Success $false -Message "9z-CT: $($_.Exception.Message)"
        }

        $script:currentSection = '9z-CU: Query Semantics'
        try {
            $queryChecks = @(& (Join-Path $PSScriptRoot '..\test-scim-query-semantics.ps1') -BaseUrl $base -Token $token)
            foreach ($check in $queryChecks) {
                Test-Result -Success $check.Success -Message "9z-CU: $($check.Message)"
            }
        } catch {
            Test-Result -Success $false -Message "9z-CU: query semantics failed: $($_.Exception.Message)"
        }

        $script:currentSection = '9z-CV: Profile Validation'
        $oldBase = $env:SCIM_LIVE_BASE_URL
        $oldToken = $env:SCIM_LIVE_TOKEN
        try {
            $env:SCIM_LIVE_BASE_URL = $base
            $env:SCIM_LIVE_TOKEN = $token
            $result = & node (Join-Path $PSScriptRoot 'profile-validation.cjs')
            if ($LASTEXITCODE -ne 0) { throw 'Profile validation contract process failed.' }
            $receipt = $result | ConvertFrom-Json -ErrorAction Stop
            Test-Result -Success ($receipt.assertions -eq 156) -Message '9z-CV: 156 declaration, scalar, POST/PUT, projection and cleanup assertions'
        } catch {
            Test-Result -Success $false -Message "9z-CV: profile validation failed: $($_.Exception.Message)"
        } finally {
            $env:SCIM_LIVE_BASE_URL = $oldBase
            $env:SCIM_LIVE_TOKEN = $oldToken
        }

        $script:currentSection = '9z-CW: Group Aggregate Transactions'
        $groupEndpointId = $null
        try {
            $profile = @{
                schemas = @(
                    @{ id = 'urn:ietf:params:scim:schemas:core:2.0:User'; name = 'User'; attributes = 'all' }
                    @{ id = 'urn:ietf:params:scim:schemas:core:2.0:Group'; name = 'Group'; attributes = 'all' }
                )
                resourceTypes = @('User', 'Group') | ForEach-Object {
                    @{ id = $_; name = $_; endpoint = "/$($_)s"; schema = "urn:ietf:params:scim:schemas:core:2.0:$_"; schemaExtensions = @() }
                }
                settings = @{ StrictSchemaValidation = $true; logFileEnabled = $false }
                serviceProviderConfig = @{ patch = @{ supported = $true }; etag = @{ supported = $true } }
            }
            $created = Invoke-RestMethod -Uri "$base/scim/admin/endpoints" -Method Post -Headers $Headers `
                -ContentType 'application/json' -ErrorAction Stop `
                -Body (@{ name = "live-aggregate-$([guid]::NewGuid().ToString('N'))"; profile = $profile } | ConvertTo-Json -Depth 20)
            $groupEndpointId = $created.id
            if (-not $groupEndpointId) { throw 'Group aggregate endpoint creation returned no id.' }
            . "$PSScriptRoot\group-aggregate.ps1"
            $count = Invoke-ScimGroupAggregateContract -EndpointUrl "$base/scim/v2/endpoints/$groupEndpointId" -Headers $Headers
            Test-Result -Success ($count -eq 69) -Message '9z-CW: 69 Group aggregate, version, error and cleanup assertions'
        } catch {
            Test-Result -Success $false -Message "9z-CW: Group aggregate contract failed: $($_.Exception.Message)"
        } finally {
            if ($groupEndpointId) {
                try {
                    $null = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$groupEndpointId" -Method Delete -Headers $Headers -ErrorAction Stop
                    Test-Result -Success $true -Message '9z-CW: removed dedicated Group aggregate endpoint'
                } catch {
                    Test-Result -Success $false -Message '9z-CW: failed to remove dedicated Group aggregate endpoint'
                }
            }
        }
    }
}
