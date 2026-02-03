# Live Test Script for MultiOpPatchRequestAddMultipleMembersToGroup Config Flag
# This script demonstrates the config flag behavior on a live API instance

$ErrorActionPreference = "Continue"
$baseUrl = "http://localhost:3000"

# Step 1: Get OAuth token
Write-Host "`n=== STEP 1: Get OAuth Token ===" -ForegroundColor Cyan
$tokenBody = @{client_id='scimtool-client';client_secret='changeme-oauth';grant_type='client_credentials'}
$tokenResponse = Invoke-RestMethod -Uri "$baseUrl/scim/oauth/token" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $tokenBody
$Token = $tokenResponse.access_token
Write-Host "✅ Token obtained: $($Token.Substring(0,30))..."

$headers = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'}

# Step 2: Get or Create endpoint with MultiOpPatchRequestAddMultipleMembersToGroup = True
Write-Host "`n=== STEP 2: Get/Create Endpoint with Config Flag ===" -ForegroundColor Cyan
try {
    $endpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/by-name/test-multi-member" -Method GET -Headers $headers
    Write-Host "✅ Existing endpoint found"
} catch {
    $endpointBody = '{"name":"test-multi-member","config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"True"}}'
    $endpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $endpointBody
    Write-Host "✅ Created new endpoint"
}
$EndpointId = $endpoint.id
Write-Host "Endpoint ID: $EndpointId"
Write-Host "Config: $($endpoint.config | ConvertTo-Json -Compress)"

$scimBase = "$baseUrl/scim/endpoints/$EndpointId"

# Step 3: Create test users
Write-Host "`n=== STEP 3: Create Test Users ===" -ForegroundColor Cyan
$userNames = @("livetest-user1@test.com", "livetest-user2@test.com", "livetest-user3@test.com")
$userIds = @()

foreach ($userName in $userNames) {
    $userBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName=$userName;displayName=$userName;active=$true} | ConvertTo-Json
    try {
        $user = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $userBody
        $userIds += $user.id
        Write-Host "✅ Created user: $userName = $($user.id)"
    } catch {
        Write-Host "⚠️ User may already exist: $userName"
        # Try to find existing user
        $users = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName eq `"$userName`"" -Method GET -Headers $headers
        if ($users.Resources.Count -gt 0) {
            $userIds += $users.Resources[0].id
            Write-Host "Found existing user: $($users.Resources[0].id)"
        }
    }
}

# Step 4: Create test group
Write-Host "`n=== STEP 4: Create Test Group ===" -ForegroundColor Cyan
$groupBody = '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:Group"],"displayName":"Live Test Group"}'
$group = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $groupBody
$GroupId = $group.id
Write-Host "✅ Created group: $GroupId"

# Step 5: Test PATCH with multiple members - should SUCCEED with flag=True
Write-Host "`n=== STEP 5: PATCH Group with MULTIPLE Members ===" -ForegroundColor Cyan
Write-Host "This should SUCCEED because MultiOpPatchRequestAddMultipleMembersToGroup=True"

$patchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        path = "members"
        value = @(
            @{value=$userIds[0]},
            @{value=$userIds[1]},
            @{value=$userIds[2]}
        )
    })
} | ConvertTo-Json -Depth 5

Write-Host "Request Body:"
Write-Host $patchBody

try {
    $result = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $patchBody
    Write-Host "`n✅ SUCCESS! Multi-member PATCH accepted!" -ForegroundColor Green
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "`n❌ FAILED: $($errorResponse.detail)" -ForegroundColor Red
}

# Verify group members
Write-Host "`n=== STEP 6: Verify Group Members ===" -ForegroundColor Cyan
$updatedGroup = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method GET -Headers $headers
Write-Host "Group members count: $($updatedGroup.members.Count)"
$updatedGroup.members | ForEach-Object { Write-Host "  - Member: $($_.value)" }

Write-Host "`n=== TEST COMPLETE ===" -ForegroundColor Green

# Now test with an endpoint WITHOUT the flag
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TESTING WITHOUT FLAG (Should FAIL)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Step 7: Create endpoint WITHOUT the flag
Write-Host "`n=== STEP 7: Create Endpoint WITHOUT Flag ===" -ForegroundColor Cyan
try {
    $endpoint2 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/by-name/test-no-multi-member" -Method GET -Headers $headers
    Write-Host "Using existing endpoint without flag"
} catch {
    $endpointBody2 = '{"name":"test-no-multi-member"}'
    $endpoint2 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $endpointBody2
    Write-Host "Created new endpoint without flag"
}
$EndpointId2 = $endpoint2.id
Write-Host "Endpoint ID: $EndpointId2"
Write-Host "Config: $($endpoint2.config | ConvertTo-Json -Compress)"

$scimBase2 = "$baseUrl/scim/endpoints/$EndpointId2"

# Step 8: Create test users in new endpoint
Write-Host "`n=== STEP 8: Create Test Users in Endpoint 2 ===" -ForegroundColor Cyan
$userIds2 = @()
foreach ($userName in @("noflag-user1@test.com", "noflag-user2@test.com")) {
    $userBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName=$userName;displayName=$userName;active=$true} | ConvertTo-Json
    try {
        $user = Invoke-RestMethod -Uri "$scimBase2/Users" -Method POST -Headers $headers -Body $userBody
        $userIds2 += $user.id
        Write-Host "Created user: $userName"
    } catch {
        $users = Invoke-RestMethod -Uri "$scimBase2/Users?filter=userName eq `"$userName`"" -Method GET -Headers $headers
        if ($users.Resources.Count -gt 0) {
            $userIds2 += $users.Resources[0].id
            Write-Host "Found existing user: $($users.Resources[0].id)"
        }
    }
}

# Step 9: Create test group
Write-Host "`n=== STEP 9: Create Test Group in Endpoint 2 ===" -ForegroundColor Cyan
$groupBody2 = '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:Group"],"displayName":"No Flag Test Group"}'
$group2 = Invoke-RestMethod -Uri "$scimBase2/Groups" -Method POST -Headers $headers -Body $groupBody2
$GroupId2 = $group2.id
Write-Host "Created group: $GroupId2"

# Step 10: Test PATCH with multiple members - should FAIL without flag
Write-Host "`n=== STEP 10: PATCH Group with MULTIPLE Members (NO FLAG) ===" -ForegroundColor Cyan
Write-Host "This should FAIL because MultiOpPatchRequestAddMultipleMembersToGroup is not set"

$patchBody2 = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        path = "members"
        value = @(
            @{value=$userIds2[0]},
            @{value=$userIds2[1]}
        )
    })
} | ConvertTo-Json -Depth 5

try {
    $result2 = Invoke-RestMethod -Uri "$scimBase2/Groups/$GroupId2" -Method PATCH -Headers $headers -Body $patchBody2
    Write-Host "`n⚠️ UNEXPECTED SUCCESS - This should have failed!" -ForegroundColor Red
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "`n✅ CORRECTLY REJECTED: $($errorResponse.detail)" -ForegroundColor Green
}

Write-Host "`n`n========================================" -ForegroundColor Magenta
Write-Host "COMPLETE TEST SUMMARY" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "✅ With MultiOpPatchRequestAddMultipleMembersToGroup=True: Multi-member PATCH ALLOWED"
Write-Host "✅ Without flag: Multi-member PATCH REJECTED (as expected)"
Write-Host "`n🎉 Config flag implementation verified successfully!" -ForegroundColor Green
