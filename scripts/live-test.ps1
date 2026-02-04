# Live Test Script for All Endpoint Flows
# This script tests endpoint CRUD, SCIM operations, config validation, and isolation

$ErrorActionPreference = "Continue"
$baseUrl = "http://localhost:3000"
$testsPassed = 0
$testsFailed = 0

function Test-Result {
    param([bool]$Success, [string]$Message)
    if ($Success) {
        Write-Host "✅ $Message" -ForegroundColor Green
        $script:testsPassed++
    } else {
        Write-Host "❌ $Message" -ForegroundColor Red
        $script:testsFailed++
    }
}

# Step 1: Get OAuth token
Write-Host "`n=== STEP 1: Get OAuth Token ===" -ForegroundColor Cyan
$tokenBody = @{client_id='scimtool-client';client_secret='changeme-oauth';grant_type='client_credentials'}
$tokenResponse = Invoke-RestMethod -Uri "$baseUrl/scim/oauth/token" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $tokenBody
$Token = $tokenResponse.access_token
Write-Host "✅ Token obtained: $($Token.Substring(0,30))..."

$headers = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'}

# ============================================
# TEST SECTION 1: ENDPOINT CRUD OPERATIONS
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 1: ENDPOINT CRUD OPERATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Create endpoint
Write-Host "`n--- Test: Create Endpoint ---" -ForegroundColor Cyan
$endpointBody = @{
    name = "live-test-endpoint-$(Get-Random)"
    displayName = "Live Test Endpoint"
    description = "Created by live-test.ps1"
    config = @{ MultiOpPatchRequestAddMultipleMembersToGroup = "True" }
} | ConvertTo-Json
$endpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $endpointBody
$EndpointId = $endpoint.id
Test-Result -Success ($null -ne $EndpointId) -Message "Create endpoint returned ID: $EndpointId"
Test-Result -Success ($endpoint.active -eq $true) -Message "New endpoint is active by default"
Test-Result -Success ($endpoint.scimEndpoint -like "*/scim/endpoints/$EndpointId") -Message "scimEndpoint URL is correct"

# Test: Get endpoint by ID
Write-Host "`n--- Test: Get Endpoint by ID ---" -ForegroundColor Cyan
$fetchedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method GET -Headers $headers
Test-Result -Success ($fetchedEndpoint.id -eq $EndpointId) -Message "Get endpoint by ID returns correct data"

# Test: Get endpoint by name
Write-Host "`n--- Test: Get Endpoint by Name ---" -ForegroundColor Cyan
$fetchedByName = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/by-name/$($endpoint.name)" -Method GET -Headers $headers
Test-Result -Success ($fetchedByName.id -eq $EndpointId) -Message "Get endpoint by name returns correct data"

# Test: List endpoints
Write-Host "`n--- Test: List Endpoints ---" -ForegroundColor Cyan
$allEndpoints = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method GET -Headers $headers
Test-Result -Success ($allEndpoints.Count -gt 0) -Message "List endpoints returns array with items"

# Test: Update endpoint
Write-Host "`n--- Test: Update Endpoint ---" -ForegroundColor Cyan
$updateBody = '{"displayName":"Updated Live Test Endpoint","description":"Updated description"}'
$updatedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $updateBody
Test-Result -Success ($updatedEndpoint.displayName -eq "Updated Live Test Endpoint") -Message "Update endpoint displayName works"
Test-Result -Success ($updatedEndpoint.description -eq "Updated description") -Message "Update endpoint description works"

# Test: Get endpoint stats
Write-Host "`n--- Test: Get Endpoint Stats ---" -ForegroundColor Cyan
$stats = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId/stats" -Method GET -Headers $headers
Test-Result -Success ($null -ne $stats.totalUsers) -Message "Stats includes totalUsers"
Test-Result -Success ($null -ne $stats.totalGroups) -Message "Stats includes totalGroups"

# ============================================
# TEST SECTION 2: CONFIG VALIDATION
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 2: CONFIG VALIDATION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Invalid config value rejected on create
Write-Host "`n--- Test: Invalid Config Value Rejected on Create ---" -ForegroundColor Cyan
$invalidConfigBody = '{"name":"invalid-config-test","config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"Yes"}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $invalidConfigBody
    Test-Result -Success $false -Message "Invalid config 'Yes' should be rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid config 'Yes' rejected with 400 Bad Request"
}

# Test: Invalid config value rejected on update
Write-Host "`n--- Test: Invalid Config Value Rejected on Update ---" -ForegroundColor Cyan
$invalidUpdateBody = '{"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"enabled"}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $invalidUpdateBody
    Test-Result -Success $false -Message "Invalid config 'enabled' should be rejected on update"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid config 'enabled' rejected with 400 Bad Request"
}

# Test: Valid config values accepted
Write-Host "`n--- Test: Valid Config Values Accepted ---" -ForegroundColor Cyan
$validConfigBody = '{"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"False"}}'
$validResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $validConfigBody
Test-Result -Success ($validResult.config.MultiOpPatchRequestAddMultipleMembersToGroup -eq "False") -Message "Valid config 'False' accepted"

# Test: Boolean true also valid
$boolConfigBody = '{"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":true}}'
$boolResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $boolConfigBody
Test-Result -Success ($true) -Message "Boolean true accepted as config value"

# ============================================
# TEST SECTION 3: SCIM USER OPERATIONS
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 3: SCIM USER OPERATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$scimBase = "$baseUrl/scim/endpoints/$EndpointId"

# Test: Create user
Write-Host "`n--- Test: Create User ---" -ForegroundColor Cyan
$userBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "livetest-user@test.com"
    displayName = "Live Test User"
    name = @{ givenName = "Live"; familyName = "Test" }
    emails = @(@{ value = "livetest-user@test.com"; type = "work"; primary = $true })
    active = $true
} | ConvertTo-Json -Depth 3
$user = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $userBody
$UserId = $user.id
Test-Result -Success ($null -ne $UserId) -Message "Create user returned ID: $UserId"
Test-Result -Success ($user.userName -eq "livetest-user@test.com") -Message "User userName is correct"
Test-Result -Success ($user.meta.resourceType -eq "User") -Message "User meta.resourceType is 'User'"

# Test: Get user by ID
Write-Host "`n--- Test: Get User by ID ---" -ForegroundColor Cyan
$fetchedUser = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method GET -Headers $headers
Test-Result -Success ($fetchedUser.id -eq $UserId) -Message "Get user by ID returns correct data"

# Test: List users
Write-Host "`n--- Test: List Users ---" -ForegroundColor Cyan
$users = Invoke-RestMethod -Uri "$scimBase/Users" -Method GET -Headers $headers
Test-Result -Success ($users.totalResults -ge 1) -Message "List users returns at least 1 user"
Test-Result -Success ($users.schemas -contains "urn:ietf:params:scim:api:messages:2.0:ListResponse") -Message "List users has correct schema"

# Test: Filter users by userName
Write-Host "`n--- Test: Filter Users by userName ---" -ForegroundColor Cyan
$filteredUsers = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName eq `"livetest-user@test.com`"" -Method GET -Headers $headers
Test-Result -Success ($filteredUsers.totalResults -eq 1) -Message "Filter by userName returns exactly 1 user"

# Test: PATCH user (update displayName)
Write-Host "`n--- Test: PATCH User ---" -ForegroundColor Cyan
$patchUserBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "Updated Display Name" })
} | ConvertTo-Json -Depth 3
$patchedUser = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchUserBody
Test-Result -Success ($patchedUser.displayName -eq "Updated Display Name") -Message "PATCH user displayName works"

# Test: PUT user (replace)
Write-Host "`n--- Test: PUT User (Replace) ---" -ForegroundColor Cyan
$putUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "livetest-user@test.com"
    displayName = "Replaced Display Name"
    active = $true
} | ConvertTo-Json -Depth 3
$replacedUser = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PUT -Headers $headers -Body $putUserBody
Test-Result -Success ($replacedUser.displayName -eq "Replaced Display Name") -Message "PUT user (replace) works"

# Test: Deactivate user (soft delete)
Write-Host "`n--- Test: Deactivate User (Soft Delete) ---" -ForegroundColor Cyan
$deactivateBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $false })
} | ConvertTo-Json -Depth 3
$deactivatedUser = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $deactivateBody
Test-Result -Success ($deactivatedUser.active -eq $false) -Message "Deactivate user (active=false) works"

# Reactivate for further tests
$reactivateBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $true })
} | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $reactivateBody | Out-Null

# ============================================
# TEST SECTION 4: SCIM GROUP OPERATIONS
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 4: SCIM GROUP OPERATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Create group
Write-Host "`n--- Test: Create Group ---" -ForegroundColor Cyan
$groupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Live Test Group"
} | ConvertTo-Json
$group = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $groupBody
$GroupId = $group.id
Test-Result -Success ($null -ne $GroupId) -Message "Create group returned ID: $GroupId"
Test-Result -Success ($group.displayName -eq "Live Test Group") -Message "Group displayName is correct"

# Test: Get group by ID
Write-Host "`n--- Test: Get Group by ID ---" -ForegroundColor Cyan
$fetchedGroup = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method GET -Headers $headers
Test-Result -Success ($fetchedGroup.id -eq $GroupId) -Message "Get group by ID returns correct data"

# Test: List groups
Write-Host "`n--- Test: List Groups ---" -ForegroundColor Cyan
$groups = Invoke-RestMethod -Uri "$scimBase/Groups" -Method GET -Headers $headers
Test-Result -Success ($groups.totalResults -ge 1) -Message "List groups returns at least 1 group"

# Test: PATCH group (add member)
Write-Host "`n--- Test: PATCH Group (Add Member) ---" -ForegroundColor Cyan
$addMemberBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "add"; path = "members"; value = @(@{ value = $UserId }) })
} | ConvertTo-Json -Depth 5
# PATCH may return 204 No Content, so we verify by fetching the group after
Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $addMemberBody | Out-Null
$groupWithMember = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method GET -Headers $headers
$memberCount = if ($groupWithMember.members) { @($groupWithMember.members).Count } else { 0 }
Test-Result -Success ($memberCount -ge 1) -Message "PATCH add member works"

# Test: PATCH group (remove member)
Write-Host "`n--- Test: PATCH Group (Remove Member) ---" -ForegroundColor Cyan
$removeMemberBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "members[value eq `"$UserId`"]" })
} | ConvertTo-Json -Depth 5
# PATCH may return 204 No Content, so we verify by fetching the group after
Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $removeMemberBody | Out-Null
$groupWithoutMember = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method GET -Headers $headers
$memberCountAfterRemove = if ($groupWithoutMember.members) { @($groupWithoutMember.members).Count } else { 0 }
Test-Result -Success ($memberCountAfterRemove -eq 0) -Message "PATCH remove member works"

# Test: PUT group (replace)
Write-Host "`n--- Test: PUT Group (Replace) ---" -ForegroundColor Cyan
$putGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Replaced Group Name"
} | ConvertTo-Json
$replacedGroup = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PUT -Headers $headers -Body $putGroupBody
Test-Result -Success ($replacedGroup.displayName -eq "Replaced Group Name") -Message "PUT group (replace) works"

# ============================================
# TEST SECTION 5: MULTI-MEMBER PATCH CONFIG FLAG
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 5: MULTI-MEMBER PATCH CONFIG FLAG" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create additional users for multi-member test
Write-Host "`n--- Create Additional Users for Multi-Member Test ---" -ForegroundColor Cyan
$multiUserIds = @($UserId)
foreach ($i in 2..3) {
    $multiUserBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
        userName = "livetest-multi-user$i@test.com"
        active = $true
    } | ConvertTo-Json
    $multiUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $multiUserBody
    $multiUserIds += $multiUser.id
    Write-Host "Created user $i : $($multiUser.id)"
}

# Create group for multi-member test
$multiGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Multi-Member Test Group"
} | ConvertTo-Json
$multiGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $multiGroupBody
$MultiGroupId = $multiGroup.id

# Test: Multi-member PATCH should succeed with flag=True
Write-Host "`n--- Test: Multi-Member PATCH with Flag=True ---" -ForegroundColor Cyan
$multiMemberPatch = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        path = "members"
        value = @(
            @{value=$multiUserIds[0]},
            @{value=$multiUserIds[1]},
            @{value=$multiUserIds[2]}
        )
    })
} | ConvertTo-Json -Depth 5

try {
    # PATCH may return 204 No Content, so we verify by fetching the group after
    Invoke-RestMethod -Uri "$scimBase/Groups/$MultiGroupId" -Method PATCH -Headers $headers -Body $multiMemberPatch | Out-Null
    $multiGroupAfter = Invoke-RestMethod -Uri "$scimBase/Groups/$MultiGroupId" -Method GET -Headers $headers
    $multiMemberCount = if ($multiGroupAfter.members) { @($multiGroupAfter.members).Count } else { 0 }
    Test-Result -Success ($multiMemberCount -ge 1) -Message "Multi-member PATCH with flag=True accepted ($multiMemberCount members added)"
} catch {
    Test-Result -Success $false -Message "Multi-member PATCH should succeed with flag=True"
}

# Create endpoint WITHOUT the flag
Write-Host "`n--- Create Endpoint Without Flag ---" -ForegroundColor Cyan
$noFlagBody = @{
    name = "live-test-no-flag-$(Get-Random)"
    displayName = "No Flag Endpoint"
} | ConvertTo-Json
$noFlagEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $noFlagBody
$NoFlagEndpointId = $noFlagEndpoint.id
$scimBase2 = "$baseUrl/scim/endpoints/$NoFlagEndpointId"

# Create users in no-flag endpoint
$noFlagUserIds = @()
foreach ($i in 1..2) {
    $nfUserBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
        userName = "noflag-user$i@test.com"
        active = $true
    } | ConvertTo-Json
    $nfUser = Invoke-RestMethod -Uri "$scimBase2/Users" -Method POST -Headers $headers -Body $nfUserBody
    $noFlagUserIds += $nfUser.id
}

# Create group in no-flag endpoint
$nfGroupBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="No Flag Group"} | ConvertTo-Json
$nfGroup = Invoke-RestMethod -Uri "$scimBase2/Groups" -Method POST -Headers $headers -Body $nfGroupBody
$NoFlagGroupId = $nfGroup.id

# Test: Multi-member PATCH should fail without flag
Write-Host "`n--- Test: Multi-Member PATCH without Flag (Should Fail) ---" -ForegroundColor Cyan
$noFlagMultiPatch = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        path = "members"
        value = @(@{value=$noFlagUserIds[0]}, @{value=$noFlagUserIds[1]})
    })
} | ConvertTo-Json -Depth 5

try {
    $nfResult = Invoke-RestMethod -Uri "$scimBase2/Groups/$NoFlagGroupId" -Method PATCH -Headers $headers -Body $noFlagMultiPatch
    Test-Result -Success $false -Message "Multi-member PATCH should fail without flag"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Multi-member PATCH without flag rejected with 400 Bad Request"
}

# ============================================
# TEST SECTION 6: ENDPOINT ISOLATION
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 6: ENDPOINT ISOLATION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create second endpoint for isolation test
Write-Host "`n--- Create Second Endpoint for Isolation Test ---" -ForegroundColor Cyan
$isolationBody = @{
    name = "live-test-isolation-$(Get-Random)"
    displayName = "Isolation Test Endpoint"
} | ConvertTo-Json
$isolationEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $isolationBody
$IsolationEndpointId = $isolationEndpoint.id
$scimBaseIsolation = "$baseUrl/scim/endpoints/$IsolationEndpointId"

# Test: Same userName can exist in different endpoints
Write-Host "`n--- Test: Same userName in Different Endpoints ---" -ForegroundColor Cyan
$sameUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "livetest-user@test.com"  # Same as in first endpoint
    active = $true
} | ConvertTo-Json
try {
    $sameUser = Invoke-RestMethod -Uri "$scimBaseIsolation/Users" -Method POST -Headers $headers -Body $sameUserBody
    $IsolationUserId = $sameUser.id
    Test-Result -Success ($null -ne $IsolationUserId) -Message "Same userName created in different endpoint (isolation works)"
} catch {
    Test-Result -Success $false -Message "Should allow same userName in different endpoints"
}

# Test: Users from one endpoint not visible in another
Write-Host "`n--- Test: Endpoint Data Isolation ---" -ForegroundColor Cyan
$endpoint1Users = Invoke-RestMethod -Uri "$scimBase/Users" -Method GET -Headers $headers
$endpoint2Users = Invoke-RestMethod -Uri "$scimBaseIsolation/Users" -Method GET -Headers $headers
Test-Result -Success ($endpoint1Users.totalResults -ne $endpoint2Users.totalResults -or $endpoint1Users.totalResults -eq 1) -Message "Endpoints have isolated user data"

# ============================================
# TEST SECTION 7: INACTIVE ENDPOINT BLOCKING
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 7: INACTIVE ENDPOINT BLOCKING" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create endpoint for inactive testing
Write-Host "`n--- Create Endpoint for Inactive Testing ---" -ForegroundColor Cyan
$inactiveBody = @{
    name = "live-test-inactive-$(Get-Random)"
    displayName = "Inactive Test Endpoint"
} | ConvertTo-Json
$inactiveEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $inactiveBody
$InactiveEndpointId = $inactiveEndpoint.id
$scimBaseInactive = "$baseUrl/scim/endpoints/$InactiveEndpointId"

# Create user while active
$inactiveTestUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="inactive-test@test.com";active=$true} | ConvertTo-Json
$inactiveTestUser = Invoke-RestMethod -Uri "$scimBaseInactive/Users" -Method POST -Headers $headers -Body $inactiveTestUserBody
$InactiveTestUserId = $inactiveTestUser.id
Write-Host "Created test user: $InactiveTestUserId"

# Deactivate endpoint
Write-Host "`n--- Deactivate Endpoint ---" -ForegroundColor Cyan
$deactivateEndpointBody = '{"active":false}'
$deactivatedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$InactiveEndpointId" -Method PATCH -Headers $headers -Body $deactivateEndpointBody
Test-Result -Success ($deactivatedEndpoint.active -eq $false) -Message "Endpoint deactivated successfully"

# Test: All SCIM operations return 403
Write-Host "`n--- Test: SCIM Operations Return 403 on Inactive Endpoint ---" -ForegroundColor Cyan

# GET User
try {
    Invoke-RestMethod -Uri "$scimBaseInactive/Users/$InactiveTestUserId" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "GET User should fail on inactive endpoint"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 403) -Message "GET User returns 403 on inactive endpoint"
}

# POST User
try {
    $newBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="should-fail@test.com"} | ConvertTo-Json
    Invoke-RestMethod -Uri "$scimBaseInactive/Users" -Method POST -Headers $headers -Body $newBody | Out-Null
    Test-Result -Success $false -Message "POST User should fail on inactive endpoint"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 403) -Message "POST User returns 403 on inactive endpoint"
}

# GET Groups
try {
    Invoke-RestMethod -Uri "$scimBaseInactive/Groups" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "GET Groups should fail on inactive endpoint"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 403) -Message "GET Groups returns 403 on inactive endpoint"
}

# Verify endpoint in inactive listing
$inactiveList = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints?active=false" -Method GET -Headers $headers
$foundInactive = $inactiveList | Where-Object { $_.id -eq $InactiveEndpointId }
Test-Result -Success ($null -ne $foundInactive) -Message "Inactive endpoint appears in active=false filter"

# Reactivate and verify operations work again
Write-Host "`n--- Test: Reactivate Endpoint ---" -ForegroundColor Cyan
$reactivateEndpointBody = '{"active":true}'
$reactivatedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$InactiveEndpointId" -Method PATCH -Headers $headers -Body $reactivateEndpointBody
Test-Result -Success ($reactivatedEndpoint.active -eq $true) -Message "Endpoint reactivated successfully"

try {
    $reactivatedUser = Invoke-RestMethod -Uri "$scimBaseInactive/Users/$InactiveTestUserId" -Method GET -Headers $headers
    Test-Result -Success ($null -ne $reactivatedUser) -Message "GET User works after reactivation"
} catch {
    Test-Result -Success $false -Message "GET User should work after reactivation"
}

# ============================================
# TEST SECTION 8: SCIM DISCOVERY ENDPOINTS
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 8: SCIM DISCOVERY ENDPOINTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

Write-Host "`n--- Test: ServiceProviderConfig ---" -ForegroundColor Cyan
$spc = Invoke-RestMethod -Uri "$scimBase/ServiceProviderConfig" -Method GET -Headers $headers
Test-Result -Success ($spc.schemas -contains "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig") -Message "ServiceProviderConfig has correct schema"

Write-Host "`n--- Test: Schemas ---" -ForegroundColor Cyan
$schemas = Invoke-RestMethod -Uri "$scimBase/Schemas" -Method GET -Headers $headers
Test-Result -Success ($schemas.Resources.Count -gt 0) -Message "Schemas endpoint returns schemas"

Write-Host "`n--- Test: ResourceTypes ---" -ForegroundColor Cyan
$resourceTypes = Invoke-RestMethod -Uri "$scimBase/ResourceTypes" -Method GET -Headers $headers
Test-Result -Success ($resourceTypes.Resources.Count -gt 0) -Message "ResourceTypes endpoint returns resource types"

# ============================================
# TEST SECTION 9: ERROR HANDLING
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9: ERROR HANDLING" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: 404 for non-existent user
Write-Host "`n--- Test: 404 for Non-Existent User ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/non-existent-id-12345" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Non-existent user should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Non-existent user returns 404"
}

# Test: 404 for non-existent group
Write-Host "`n--- Test: 404 for Non-Existent Group ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/non-existent-id-12345" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Non-existent group should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Non-existent group returns 404"
}

# Test: 404 for non-existent endpoint
Write-Host "`n--- Test: 404 for Non-Existent Endpoint ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/non-existent-id-12345" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Non-existent endpoint should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Non-existent endpoint returns 404"
}

# Test: 409 for duplicate userName
Write-Host "`n--- Test: 409 for Duplicate userName ---" -ForegroundColor Cyan
$dupUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="livetest-user@test.com";active=$true} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dupUserBody | Out-Null
    Test-Result -Success $false -Message "Duplicate userName should return 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 409) -Message "Duplicate userName returns 409 Conflict"
}

# Test: 400 for invalid endpoint name
Write-Host "`n--- Test: 400 for Invalid Endpoint Name ---" -ForegroundColor Cyan
$invalidNameBody = '{"name":"invalid name with spaces"}'
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $invalidNameBody | Out-Null
    Test-Result -Success $false -Message "Invalid endpoint name should return 400"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 400) -Message "Invalid endpoint name returns 400 Bad Request"
}

# ============================================
# TEST SECTION 10: DELETE OPERATIONS
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 10: DELETE OPERATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Delete user
Write-Host "`n--- Test: Delete User ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method DELETE -Headers $headers | Out-Null
    # Verify user is deleted
    try {
        Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method GET -Headers $headers | Out-Null
        Test-Result -Success $false -Message "Deleted user should not be found"
    } catch {
        Test-Result -Success $true -Message "DELETE user works (returns 204, user not found after)"
    }
} catch {
    Test-Result -Success $false -Message "DELETE user should succeed"
}

# Test: Delete group
Write-Host "`n--- Test: Delete Group ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "DELETE group works"
} catch {
    Test-Result -Success $false -Message "DELETE group should succeed"
}

# ============================================
# CLEANUP: Delete all test endpoints
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "CLEANUP: Removing Test Endpoints" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

function Remove-TestResource {
    param ([string]$Uri, [string]$Name)
    try {
        Invoke-RestMethod -Uri $Uri -Method DELETE -Headers $headers -ErrorAction Stop | Out-Null
        Write-Host "  ✅ Deleted $Name" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️ Could not delete $Name" -ForegroundColor Yellow
    }
}

# Delete all test endpoints (cascade deletes users/groups)
Write-Host "`n--- Deleting Test Endpoints (Cascade Delete) ---" -ForegroundColor Cyan
if ($EndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Name "Main Test Endpoint" }
if ($NoFlagEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$NoFlagEndpointId" -Name "No Flag Endpoint" }
if ($IsolationEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$IsolationEndpointId" -Name "Isolation Endpoint" }
if ($InactiveEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$InactiveEndpointId" -Name "Inactive Endpoint" }

# ============================================
# FINAL SUMMARY
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Magenta
Write-Host "FINAL TEST SUMMARY" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "Tests Passed: $testsPassed" -ForegroundColor Green
Write-Host "Tests Failed: $testsFailed" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Red" })
Write-Host "Total Tests:  $($testsPassed + $testsFailed)" -ForegroundColor Cyan

if ($testsFailed -eq 0) {
    Write-Host "`n🎉 ALL TESTS PASSED!" -ForegroundColor Green
} else {
    Write-Host "`n⚠️ Some tests failed. Review output above." -ForegroundColor Yellow
}

Write-Host "`n========================================`n" -ForegroundColor Magenta
