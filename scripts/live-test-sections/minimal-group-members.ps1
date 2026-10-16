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
    try {
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
                Test-Result -Success ($rejected.StatusCode -eq 400) -Message "9z-DQ: genuine undeclared $field rejected"
                $after = Invoke-RestMethod -Uri $uri -Headers $Headers -ErrorAction Stop
                Test-Result -Success (($before | ConvertTo-Json -Depth 20 -Compress) -eq ($after | ConvertTo-Json -Depth 20 -Compress)) `
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
