function Invoke-MinimalGroupMembersContract {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][hashtable]$Headers
    )
    $script:currentSection = '9z-DQ: Minimal Group Members'
    $endpointId = $null
    $base = $BaseUrl.TrimEnd('/')
    $userUrn = 'urn:ietf:params:scim:schemas:core:2.0:User'
    $groupUrn = 'urn:ietf:params:scim:schemas:core:2.0:Group'
    function Test-MemberStateUnchanged([object]$Before, [object]$After) {
        return ($Before | ConvertTo-Json -Depth 20 -Compress) -ceq ($After | ConvertTo-Json -Depth 20 -Compress)
    }
    function Assert-MemberStateOracle {
        $before = @{ displayName = 'Group'; members = @(@{ value = 'user-1'; '$ref' = 'https://scim.example.test/Users/ABC' }) }
        $after = $before | ConvertTo-Json -Depth 20 | ConvertFrom-Json -ErrorAction Stop
        Test-Result -Success (Test-MemberStateUnchanged $before $after) -Message '9z-DQ: state oracle identical serialization'
        $after.members[0].'$ref' = 'https://scim.example.test/Users/abc'
        Test-Result -Success (-not (Test-MemberStateUnchanged $before $after)) -Message '9z-DQ: state oracle rejects case-only reference mutation'
    }
    function Test-MemberErrorContract([object]$Response, [string]$ScimType, [hashtable]$Diagnostics) {
        $content = if ($Response.Content -is [byte[]]) {
            [System.Text.Encoding]::UTF8.GetString($Response.Content)
        } else { $Response.Content }
        $body = ConvertFrom-Json -InputObject $content -AsHashtable -ErrorAction Stop
        $diagnosticUrn = 'urn:scimserver:api:messages:2.0:Diagnostics'
        $allowed = @('schemas', 'status', 'detail', 'scimType', $diagnosticUrn)
        if ($body -isnot [System.Collections.IDictionary] -or
            $Response.StatusCode -ne 400 -or
            ($Response.Headers['Content-Type'] -join ';') -notmatch '^application/scim\+json(?:;|$)' -or
            $body.schemas -isnot [array] -or
            $body.schemas -cnotcontains 'urn:ietf:params:scim:api:messages:2.0:Error' -or
            $body.status -isnot [string] -or $body.status -cne '400' -or
            $body.detail -isnot [string] -or [string]::IsNullOrWhiteSpace($body.detail) -or
            $body.scimType -cne $ScimType -or
            @($body.Keys | Where-Object { $_ -cnotin $allowed }).Count -ne 0 -or
            $body[$diagnosticUrn] -isnot [System.Collections.IDictionary]) {
            return $false
        }
        foreach ($key in $Diagnostics.Keys) {
            if (-not $body[$diagnosticUrn].Contains($key)) { return $false }
            $actual = ConvertTo-Json -InputObject $body[$diagnosticUrn][$key] -Depth 10 -Compress
            $expected = ConvertTo-Json -InputObject $Diagnostics[$key] -Depth 10 -Compress
            if ($actual -cne $expected) { return $false }
        }
        return $true
    }
    function Assert-MemberErrorOracle {
        $diagnosticUrn = 'urn:scimserver:api:messages:2.0:Diagnostics'
        $diagnostics = @{
            errorCode = 'VALIDATION_SCHEMA'; triggeredBy = 'StrictSchemaValidation'
            attributePath = 'members[0].display'; attributePaths = @('members[0].display')
            activeConfig = @{ StrictSchemaValidation = $true }
        }
        $baseline = @{
            schemas = @('urn:ietf:params:scim:api:messages:2.0:Error')
            status = '400'; detail = 'Unknown member attribute'; scimType = 'invalidSyntax'
            $diagnosticUrn = $diagnostics
        }
        $mutations = [ordered]@{
            'valid contract' = { param($body, $response) }
            'valid UTF-8 byte response' = { param($body, $response) }
            'HTTP status' = { param($body, $response) $response.StatusCode = 503 }
            'media type' = { param($body, $response) $response.Headers['Content-Type'] = 'application/json' }
            'schemas' = { param($body, $response) $body.schemas = @() }
            'body status' = { param($body, $response) $body.status = 400 }
            'detail' = { param($body, $response) $body.detail = $null }
            'extra response key' = { param($body, $response) $body._rawPayload = @{} }
            'scimType' = { param($body, $response) $body.scimType = 'invalidValue' }
            'errorCode' = { param($body, $response) $body[$diagnosticUrn].errorCode = 'incorrect' }
            'triggeredBy' = { param($body, $response) $body[$diagnosticUrn].triggeredBy = 'incorrect' }
            'attributePath' = { param($body, $response) $body[$diagnosticUrn].attributePath = 'incorrect' }
            'attributePaths' = { param($body, $response) $body[$diagnosticUrn].attributePaths = @('incorrect') }
            'activeConfig' = { param($body, $response) $body[$diagnosticUrn].activeConfig.StrictSchemaValidation = $false }
        }
        foreach ($mutation in $mutations.GetEnumerator()) {
            $body = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable -ErrorAction Stop
            $response = [pscustomobject]@{
                StatusCode = 400; Headers = @{ 'Content-Type' = 'application/scim+json; charset=utf-8' }; Content = ''
            }
            & $mutation.Value $body $response
            $response.Content = ConvertTo-Json -InputObject $body -Depth 10
            if ($mutation.Key -eq 'valid UTF-8 byte response') {
                $response.Content = [System.Text.Encoding]::UTF8.GetBytes($response.Content)
            }
            try {
                $accepted = Test-MemberErrorContract $response 'invalidSyntax' $diagnostics
            } catch [System.Management.Automation.ParameterBindingException] {
                Test-Result -Success $false -Message "9z-DQ: error oracle $($mutation.Key) could not bind HTTP response content"
                continue
            }
            Test-Result -Success ($accepted -eq ($mutation.Key -in @('valid contract', 'valid UTF-8 byte response'))) `
                -Message "9z-DQ: error oracle $($mutation.Key)"
        }
    }
    function Send-MemberRequest([string]$Uri, [string]$Method, [object]$Body) {
        Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -ErrorAction Stop `
            -ContentType 'application/scim+json' -Body ($Body | ConvertTo-Json -Depth 20)
    }
    function Assert-MemberReadback([string]$Uri, [string[]]$Values, [string]$Label) {
        $read = Invoke-RestMethod -Uri $Uri -Headers $Headers -ErrorAction Stop
        $actual = @($read.members | ForEach-Object value | Sort-Object)
        $expected = @($Values | Sort-Object)
        Test-Result -Success (($actual -join '|') -eq ($expected -join '|')) -Message "9z-DQ: $Label exact persisted member values"
        $unexpected = @($read.PSObject.Properties.Name | Where-Object { $_ -notin @('schemas', 'id', 'meta', 'displayName', 'externalId', 'members') })
        $unexpected += @($read.members | ForEach-Object { $_.PSObject.Properties.Name | Where-Object { $_ -notin @('value', '$ref') } })
        Test-Result -Success ($unexpected.Count -eq 0) -Message "9z-DQ: $Label response key allowlists"
        return $read
    }
    function Assert-ReferenceReadback([string]$Uri, [object[]]$Members, [string]$Label) {
        $read = Assert-MemberReadback $Uri @($Members | ForEach-Object value) $Label
        $matches = $read.members.Count -eq $Members.Count
        foreach ($member in $Members) {
            $stored = @($read.members | Where-Object value -eq $member.value)
            $matches = $matches -and $stored.Count -eq 1 -and $stored[0].'$ref' -ceq $member.'$ref'
        }
        Test-Result -Success $matches -Message "9z-DQ: $Label exact persisted member references"
    }
    try {
        Assert-MemberStateOracle
        Assert-MemberErrorOracle
        $profile = @{
            schemas = @(
                @{ id = $userUrn; name = 'User'; attributes = @(@{ name = 'userName'; type = 'string'; required = $true }) }
                @{ id = $groupUrn; name = 'Group'; attributes = @(
                    @{ name = 'displayName'; type = 'string'; required = $true }
                    @{ name = 'members'; type = 'complex'; multiValued = $true; subAttributes = @(
                        @{ name = 'value'; type = 'string'; mutability = 'immutable' }
                        @{ name = '$ref'; type = 'reference'; referenceTypes = @('User', 'Group'); mutability = 'immutable' }
                    ) }
                ) }
            )
            resourceTypes = @(
                @{ id = 'User'; name = 'User'; endpoint = '/Users'; schema = $userUrn; schemaExtensions = @() }
                @{ id = 'Group'; name = 'Group'; endpoint = '/Groups'; schema = $groupUrn; schemaExtensions = @() }
            )
            settings = @{ StrictSchemaValidation = $true; MultiMemberPatchOpForGroupEnabled = $true; PatchOpAllowRemoveAllMembers = $true }
        }
        $createdEndpoint = Send-MemberRequest "$base/scim/admin/endpoints" 'POST' @{
            name = "live-minimal-members-$([guid]::NewGuid().ToString('N'))"; profile = $profile
        }
        $endpointId = $createdEndpoint.id
        if ([string]::IsNullOrWhiteSpace($endpointId)) { throw 'Owned minimal endpoint creation returned no id.' }
        $collection = "$base/scim/endpoints/$endpointId"
        $users = @()
        foreach ($i in 1..2) {
            $user = Send-MemberRequest "$collection/Users" 'POST' @{
                schemas = @($userUrn); userName = "minimal-$([guid]::NewGuid().ToString('N'))@example.test"
            }
            if ([string]::IsNullOrWhiteSpace($user.id)) { throw 'Owned member creation returned no id.' }
            $users += $user.id
        }
        foreach ($populated in @($false, $true)) {
            $members = @(if ($populated) { @{ value = $users[0] } })
            $group = Send-MemberRequest "$collection/Groups" 'POST' @{
                schemas = @($groupUrn); displayName = "minimal-$([guid]::NewGuid().ToString('N'))"; members = $members
            }
            if ([string]::IsNullOrWhiteSpace($group.id)) { throw 'Owned Group creation returned no id.' }
            $uri = "$collection/Groups/$($group.id)"
            $null = Assert-MemberReadback $uri $(if ($populated) { @($users[0]) } else { @() }) "POST populated=$populated"
            $null = Send-MemberRequest $uri 'PUT' @{
                schemas = @($groupUrn); displayName = $group.displayName; members = @(@{ value = $users[0] })
            }
            $null = Assert-MemberReadback $uri @($users[0]) 'PUT'
            $null = Send-MemberRequest $uri 'PATCH' @{
                schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
                Operations = @(@{ op = 'add'; path = 'members'; value = @(@{ value = $users[0] }, @{ value = $users[1] }) })
            }
            $null = Assert-MemberReadback $uri $users 'PATCH duplicate add'
            $before = Invoke-RestMethod -Uri $uri -Headers $Headers -ErrorAction Stop
            foreach ($field in @('display', 'type', 'unknown')) {
                $invalid = @{
                    schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
                    Operations = @(
                        @{ op = 'replace'; path = 'displayName'; value = 'must-rollback' }
                        @{ op = 'add'; path = 'members'; value = @(@{ value = $users[0]; $field = 'undeclared' }) }
                    )
                }
                $rejected = Invoke-WebRequest -Uri $uri -Method Patch -Headers $Headers -ContentType 'application/scim+json' `
                    -Body ($invalid | ConvertTo-Json -Depth 20) -SkipHttpErrorCheck -ErrorAction Stop
                $attributePath = "members[2].$field"
                $diagnostics = @{
                    errorCode = 'VALIDATION_SCHEMA'; triggeredBy = 'StrictSchemaValidation'
                    attributePath = $attributePath; attributePaths = @($attributePath)
                    activeConfig = @{ StrictSchemaValidation = $true }
                }
                Test-Result -Success (Test-MemberErrorContract $rejected 'invalidSyntax' $diagnostics) `
                    -Message "9z-DQ: genuine undeclared $field exact Error/media-type/diagnostic contract"
                $after = Invoke-RestMethod -Uri $uri -Headers $Headers -ErrorAction Stop
                Test-Result -Success (Test-MemberStateUnchanged $before $after) `
                    -Message "9z-DQ: rejected $field operation leaves complete state unchanged"
            }
            $null = Send-MemberRequest $uri 'PATCH' @{
                schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
                Operations = @(@{ op = 'replace'; path = 'members'; value = @(@{ value = $users[1] }) })
            }
            $null = Assert-MemberReadback $uri @($users[1]) 'PATCH replace'
            $null = Send-MemberRequest $uri 'PATCH' @{
                schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
                Operations = @(@{ op = 'remove'; path = "members[value eq `"$($users[1])`"]" })
            }
            $null = Assert-MemberReadback $uri @() 'PATCH filtered remove'
        }
        $first = @{ value = $users[0]; '$ref' = "https://scim.example.test/Users/$($users[0])" }
        $second = @{ value = $users[1]; '$ref' = "https://scim.example.test/Users/$($users[1])?source=import" }
        $group = Send-MemberRequest "$collection/Groups" 'POST' @{
            schemas = @($groupUrn); displayName = "references-$([guid]::NewGuid().ToString('N'))"; members = @($first)
        }
        if ([string]::IsNullOrWhiteSpace($group.id)) { throw 'Owned reference Group creation returned no id.' }
        $uri = "$collection/Groups/$($group.id)"
        Assert-ReferenceReadback $uri @($first) 'reference POST'
        $null = Send-MemberRequest $uri 'PUT' @{
            schemas = @($groupUrn); displayName = $group.displayName; members = @($second)
        }
        Assert-ReferenceReadback $uri @($second) 'reference PUT'
        $null = Send-MemberRequest $uri 'PATCH' @{
            schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
            Operations = @(@{ op = 'add'; path = 'members'; value = @($first) })
        }
        Assert-ReferenceReadback $uri @($second, $first) 'reference PATCH add'
        $before = Invoke-RestMethod -Uri $uri -Headers $Headers -ErrorAction Stop
        $invalid = @{
            schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
            Operations = @(
                @{ op = 'replace'; path = 'displayName'; value = 'must-rollback' }
                @{ op = 'replace'; path = "members[value eq `"$($users[0])`"].`$ref"; value = 'https://scim.example.test/Users/changed' }
            )
        }
        $rejected = Invoke-WebRequest -Uri $uri -Method Patch -Headers $Headers -ContentType 'application/scim+json' `
            -Body ($invalid | ConvertTo-Json -Depth 20) -SkipHttpErrorCheck -ErrorAction Stop
        $diagnostics = @{
            errorCode = 'VALIDATION_PATCH'; triggeredBy = 'PatchEngine'; failedOperationIndex = 1
            failedOp = 'replace'; failedPath = "members[value eq `"$($users[0])`"].`$ref"
        }
        Test-Result -Success (Test-MemberErrorContract $rejected 'mutability' $diagnostics) `
            -Message '9z-DQ: immutable reference exact Error/media-type/diagnostic contract'
        $after = Invoke-RestMethod -Uri $uri -Headers $Headers -ErrorAction Stop
        Test-Result -Success (Test-MemberStateUnchanged $before $after) `
            -Message '9z-DQ: rejected reference change preserves complete state'
        $null = Send-MemberRequest $uri 'PATCH' @{
            schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
            Operations = @(@{ op = 'remove'; path = "members[value eq `"$($users[1])`"]" })
        }
        Assert-ReferenceReadback $uri @($first) 'reference PATCH remove'
        $null = Send-MemberRequest $uri 'PATCH' @{
            schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
            Operations = @(@{ op = 'replace'; path = 'members'; value = @($second) })
        }
        Assert-ReferenceReadback $uri @($second) 'reference PATCH replace'
    } catch {
        Test-Result -Success $false -Message "9z-DQ: minimal imported Group membership failed: $($_.Exception.Message)"
    } finally {
        if ($endpointId) {
            try {
                $null = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$endpointId" -Method Delete -Headers $Headers -ErrorAction Stop
                Test-Result -Success $true -Message '9z-DQ: removed exact owned minimal-schema endpoint'
            } catch {
                Test-Result -Success $false -Message "9z-DQ: owned endpoint cleanup failed: $($_.Exception.Message)"
            }
        }
    }
}
