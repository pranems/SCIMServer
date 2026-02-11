# Live Test Script for All Endpoint Flows
# This script tests endpoint CRUD, SCIM operations, config validation, and isolation

$ErrorActionPreference = "Continue"
$baseUrl = "http://localhost:6000"
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

# Test: Invalid REMOVE config value rejected on create
Write-Host "`n--- Test: Invalid Remove Config Value Rejected on Create ---" -ForegroundColor Cyan
$invalidRemoveConfigBody = '{"name":"invalid-remove-config-test","config":{"MultiOpPatchRequestRemoveMultipleMembersFromGroup":"Yes"}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $invalidRemoveConfigBody
    Test-Result -Success $false -Message "Invalid remove config 'Yes' should be rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid remove config 'Yes' rejected with 400 Bad Request"
}

# Test: Invalid REMOVE config value rejected on update
Write-Host "`n--- Test: Invalid Remove Config Value Rejected on Update ---" -ForegroundColor Cyan
$invalidRemoveUpdateBody = '{"config":{"MultiOpPatchRequestRemoveMultipleMembersFromGroup":"enabled"}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $invalidRemoveUpdateBody
    Test-Result -Success $false -Message "Invalid remove config 'enabled' should be rejected on update"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid remove config 'enabled' rejected with 400 Bad Request"
}

# Test: Valid REMOVE config values accepted
Write-Host "`n--- Test: Valid Remove Config Values Accepted ---" -ForegroundColor Cyan
$validRemoveConfigBody = '{"config":{"MultiOpPatchRequestRemoveMultipleMembersFromGroup":"False"}}'
$validRemoveResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $validRemoveConfigBody
Test-Result -Success ($validRemoveResult.config.MultiOpPatchRequestRemoveMultipleMembersFromGroup -eq "False") -Message "Valid remove config 'False' accepted"

# Test: Both flags can be set together
Write-Host "`n--- Test: Both Config Flags Set Together ---" -ForegroundColor Cyan
$bothFlagsBody = '{"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"True","MultiOpPatchRequestRemoveMultipleMembersFromGroup":"True"}}'
$bothResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $bothFlagsBody
$bothValid = ($bothResult.config.MultiOpPatchRequestAddMultipleMembersToGroup -eq "True") -and ($bothResult.config.MultiOpPatchRequestRemoveMultipleMembersFromGroup -eq "True")
Test-Result -Success $bothValid -Message "Both add and remove config flags set together"

# Test: Invalid VerbosePatchSupported config value rejected
Write-Host "`n--- Test: Invalid VerbosePatchSupported Config Value Rejected ---" -ForegroundColor Cyan
$invalidVerboseBody = '{"config":{"VerbosePatchSupported":"Yes"}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $invalidVerboseBody
    Test-Result -Success $false -Message "Invalid VerbosePatchSupported 'Yes' should be rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid VerbosePatchSupported 'Yes' rejected with 400 Bad Request"
}

# Test: Valid VerbosePatchSupported config value accepted
Write-Host "`n--- Test: Valid VerbosePatchSupported Config Value Accepted ---" -ForegroundColor Cyan
$validVerboseBody = '{"config":{"VerbosePatchSupported":true}}'
$validVerboseResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $validVerboseBody
Test-Result -Success ($true) -Message "VerbosePatchSupported boolean true accepted"

# Test: All three flags can be set together
Write-Host "`n--- Test: All Three Config Flags Set Together ---" -ForegroundColor Cyan
$allFlagsBody = '{"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"True","MultiOpPatchRequestRemoveMultipleMembersFromGroup":"True","VerbosePatchSupported":true}}'
$allResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $allFlagsBody
$allValid = ($allResult.config.MultiOpPatchRequestAddMultipleMembersToGroup -eq "True") -and ($allResult.config.MultiOpPatchRequestRemoveMultipleMembersFromGroup -eq "True") -and ($allResult.config.VerbosePatchSupported -eq $true)
Test-Result -Success $allValid -Message "All three config flags set together"

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
Test-Result -Success ($null -ne $user.meta.location) -Message "User meta.location is present"
Test-Result -Success ($user.meta.location -like "*Users/$UserId") -Message "User meta.location contains correct path"
Test-Result -Success ($null -ne $user.meta.created) -Message "User meta.created is present"
Test-Result -Success ($null -ne $user.meta.lastModified) -Message "User meta.lastModified is present"

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
# TEST SECTION 3b: CASE-INSENSITIVITY (RFC 7643 §2.1)
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 3b: CASE-INSENSITIVITY (RFC 7643)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Case-insensitive userName uniqueness
Write-Host "`n--- Test: Case-Insensitive userName Uniqueness ---" -ForegroundColor Cyan
$ciDupUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "LIVETEST-USER@TEST.COM"  # Same as existing but UPPERCASE
    active = $true
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $ciDupUserBody | Out-Null
    Test-Result -Success $false -Message "UPPERCASE duplicate userName should return 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 409) -Message "UPPERCASE duplicate userName returns 409 (case-insensitive uniqueness)"
}

# Test: Mixed-case duplicate
$ciMixedBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "LiveTest-User@Test.Com"
    active = $true
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $ciMixedBody | Out-Null
    Test-Result -Success $false -Message "Mixed-case duplicate userName should return 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 409) -Message "Mixed-case duplicate userName returns 409"
}

# Test: Case-insensitive filter attribute names
Write-Host "`n--- Test: Case-Insensitive Filter Attribute Names ---" -ForegroundColor Cyan
$ciFilterResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=USERNAME eq `"livetest-user@test.com`"" -Method GET -Headers $headers
Test-Result -Success ($ciFilterResult.totalResults -eq 1) -Message "Filter with 'USERNAME' (uppercase) finds user"

$ciFilterResult2 = Invoke-RestMethod -Uri "$scimBase/Users?filter=UserName eq `"livetest-user@test.com`"" -Method GET -Headers $headers
Test-Result -Success ($ciFilterResult2.totalResults -eq 1) -Message "Filter with 'UserName' (PascalCase) finds user"

# Test: Case-insensitive filter value for userName
Write-Host "`n--- Test: Case-Insensitive Filter Value (userName) ---" -ForegroundColor Cyan
$ciFilterValue = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName eq `"LIVETEST-USER@TEST.COM`"" -Method GET -Headers $headers
Test-Result -Success ($ciFilterValue.totalResults -eq 1) -Message "Filter with UPPERCASE value finds user (case-insensitive)"

# Test: PascalCase PATCH op values (Entra compatibility)
Write-Host "`n--- Test: PascalCase PATCH op Values ---" -ForegroundColor Cyan
$pascalPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "Replace"; path = "displayName"; value = "PascalCase Patched" })
} | ConvertTo-Json -Depth 3
$pascalPatched = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $pascalPatchBody
Test-Result -Success ($pascalPatched.displayName -eq "PascalCase Patched") -Message "PATCH with 'Replace' (PascalCase op) works"

$addOpBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "Add"; path = "displayName"; value = "Add Op Patched" })
} | ConvertTo-Json -Depth 3
$addOpPatched = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $addOpBody
Test-Result -Success ($addOpPatched.displayName -eq "Add Op Patched") -Message "PATCH with 'Add' (PascalCase op) works"

# ============================================
# TEST SECTION 3c: ADVANCED PATCH OPERATIONS
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 3c: ADVANCED PATCH OPERATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: PATCH with no path (merge value object into resource)
Write-Host "`n--- Test: PATCH with No Path (Merge) ---" -ForegroundColor Cyan
$noPathBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ displayName = "No-Path Merged"; active = $true }
    })
} | ConvertTo-Json -Depth 4
$noPathResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $noPathBody
Test-Result -Success ($noPathResult.displayName -eq "No-Path Merged") -Message "PATCH with no path merges displayName"
Test-Result -Success ($noPathResult.active -eq $true) -Message "PATCH with no path merges active"

# Test: No-path PATCH with case-insensitive keys
Write-Host "`n--- Test: No-Path PATCH with Case-Insensitive Keys ---" -ForegroundColor Cyan
$ciNoPathBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ DisplayName = "CI-Keys Merged"; Active = $true }
    })
} | ConvertTo-Json -Depth 4
$ciNoPathResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $ciNoPathBody
Test-Result -Success ($ciNoPathResult.displayName -eq "CI-Keys Merged") -Message "No-path PATCH with 'DisplayName' (PascalCase key) works"

# Test: PATCH with valuePath (emails[type eq \"work\"].value)
Write-Host "`n--- Test: PATCH with valuePath ---" -ForegroundColor Cyan
# First ensure user has emails
$setupEmailBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{
            emails = @(
                @{ value = "work@test.com"; type = "work"; primary = $true },
                @{ value = "home@test.com"; type = "home" }
            )
        }
    })
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $setupEmailBody | Out-Null

$valuePathBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        path = 'emails[type eq "work"].value'
        value = "updated-work@test.com"
    })
} | ConvertTo-Json -Depth 4
$valuePathResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $valuePathBody
$workEmail = $valuePathResult.emails | Where-Object { $_.type -eq "work" } | Select-Object -First 1
Test-Result -Success ($workEmail.value -eq "updated-work@test.com") -Message "PATCH with valuePath updates emails[type eq work].value"

# Verify home email unchanged
$homeEmail = $valuePathResult.emails | Where-Object { $_.type -eq "home" } | Select-Object -First 1
Test-Result -Success ($homeEmail.value -eq "home@test.com") -Message "valuePath PATCH does not affect other email entries"

# Test: PATCH with extension URN path
Write-Host "`n--- Test: PATCH with Extension URN Path ---" -ForegroundColor Cyan
$extUrnBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department"
        value = "Engineering"
    })
} | ConvertTo-Json -Depth 4
$extUrnResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $extUrnBody
$enterpriseExt = $extUrnResult.'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
Test-Result -Success ($enterpriseExt.department -eq "Engineering") -Message "PATCH with extension URN path sets department"

# Test: PATCH extension URN with replace
$extReplaceBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department"
        value = "Product"
    })
} | ConvertTo-Json -Depth 4
$extReplaceResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $extReplaceBody
$enterpriseExt2 = $extReplaceResult.'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
Test-Result -Success ($enterpriseExt2.department -eq "Product") -Message "PATCH with extension URN replace updates department"

# Test: Manager empty-value removal (RFC 7644 §3.5.2.3)
Write-Host "`n--- Test: Manager Empty-Value Removal (RFC 7644 §3.5.2.3) ---" -ForegroundColor Cyan
$setManagerBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager"
        value = @{ value = "manager-id-123" }
    })
} | ConvertTo-Json -Depth 4
$managerSetResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $setManagerBody
$managerExt = $managerSetResult.'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
Test-Result -Success ($managerExt.manager.value -eq "manager-id-123") -Message "Manager set successfully via extension URN"

# Remove manager with empty value object {"value":""}
$removeManagerBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager"
        value = @{ value = "" }
    })
} | ConvertTo-Json -Depth 4
$managerRemovedResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $removeManagerBody
$managerExtAfter = $managerRemovedResult.'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
$managerGone = ($null -eq $managerExtAfter) -or ($null -eq $managerExtAfter.manager)
Test-Result -Success $managerGone -Message "Manager removed when value is empty string (RFC 7644 §3.5.2.3)"

# Test: Multiple operations in single PATCH request
Write-Host "`n--- Test: Multiple Operations in Single PATCH ---" -ForegroundColor Cyan
$multiOpBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "displayName"; value = "Multi-Op User" },
        @{ op = "replace"; path = "active"; value = $false },
        @{ op = "add"; path = "title"; value = "Engineer" }
    )
} | ConvertTo-Json -Depth 4
$multiOpResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $multiOpBody
Test-Result -Success ($multiOpResult.displayName -eq "Multi-Op User") -Message "Multi-op PATCH: displayName updated"
Test-Result -Success ($multiOpResult.active -eq $false) -Message "Multi-op PATCH: active set to false"
Test-Result -Success ($multiOpResult.title -eq "Engineer") -Message "Multi-op PATCH: title added"

# Reactivate user for remaining tests
$reactivateBody2 = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $true })
} | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $reactivateBody2 | Out-Null

# ============================================
# TEST SECTION 3d: PAGINATION & ADVANCED FILTERING
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 3d: PAGINATION & ADVANCED FILTERING" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create users with externalId for pagination and filtering tests
Write-Host "`n--- Setup: Create Users for Pagination ---" -ForegroundColor Cyan
$paginationUserIds = @($UserId)
for ($i = 1; $i -le 3; $i++) {
    $pagUserBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
        userName = "pagination-user$i@test.com"
        externalId = "ext-pag-$i"
        displayName = "Pagination User $i"
        active = $true
    } | ConvertTo-Json
    $pagUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $pagUserBody
    $paginationUserIds += $pagUser.id
    Write-Host "  Created pagination user $i : $($pagUser.id)"
}

# Test: Pagination with count
Write-Host "`n--- Test: Pagination with count ---" -ForegroundColor Cyan
$pagResult = Invoke-RestMethod -Uri "$scimBase/Users?count=2" -Method GET -Headers $headers
Test-Result -Success ($pagResult.itemsPerPage -eq 2) -Message "Pagination: itemsPerPage matches count=2"
Test-Result -Success ($pagResult.totalResults -ge 4) -Message "Pagination: totalResults >= 4 (all users)"
Test-Result -Success ($pagResult.Resources.Count -eq 2) -Message "Pagination: Resources array has 2 items"

# Test: Pagination with startIndex
Write-Host "`n--- Test: Pagination with startIndex ---" -ForegroundColor Cyan
$pagResult2 = Invoke-RestMethod -Uri "$scimBase/Users?startIndex=2&count=2" -Method GET -Headers $headers
Test-Result -Success ($pagResult2.startIndex -eq 2) -Message "Pagination: startIndex=2 reflected in response"
Test-Result -Success ($pagResult2.Resources.Count -le 2) -Message "Pagination: startIndex+count returns correct page size"

# Test: Filter by externalId
Write-Host "`n--- Test: Filter by externalId ---" -ForegroundColor Cyan
$extIdFilter = Invoke-RestMethod -Uri "$scimBase/Users?filter=externalId eq `"ext-pag-1`"" -Method GET -Headers $headers
Test-Result -Success ($extIdFilter.totalResults -eq 1) -Message "Filter by externalId returns exactly 1 user"
Test-Result -Success ($extIdFilter.Resources[0].externalId -eq "ext-pag-1") -Message "Filtered user has correct externalId"

# Test: Filter by externalId (case-insensitive attribute name)
$extIdFilterCI = Invoke-RestMethod -Uri "$scimBase/Users?filter=EXTERNALID eq `"ext-pag-2`"" -Method GET -Headers $headers
Test-Result -Success ($extIdFilterCI.totalResults -eq 1) -Message "Filter with 'EXTERNALID' (uppercase attr) finds user"

# Test: externalId uniqueness (same externalId → 409)
Write-Host "`n--- Test: externalId Uniqueness ---" -ForegroundColor Cyan
$dupExtBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "dup-ext-test@test.com"
    externalId = "ext-pag-1"  # Already exists
    active = $true
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dupExtBody | Out-Null
    Test-Result -Success $false -Message "Duplicate externalId should return 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 409) -Message "Duplicate externalId returns 409 Conflict"
}

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
Test-Result -Success ($group.meta.resourceType -eq "Group") -Message "Group meta.resourceType is 'Group'"
Test-Result -Success ($null -ne $group.meta.location) -Message "Group meta.location is present"
Test-Result -Success ($group.meta.location -like "*Groups/$GroupId") -Message "Group meta.location contains correct path"
Test-Result -Success ($null -ne $group.meta.created) -Message "Group meta.created is present"

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
# Group PATCH returns response body (v0.8.16 fix — RFC 7644 §3.5.2)
$groupPatchResult = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $addMemberBody
Test-Result -Success ($null -ne $groupPatchResult.id) -Message "Group PATCH returns response body (not 204)"
$memberCount = if ($groupPatchResult.members) { @($groupPatchResult.members).Count } else { 0 }
Test-Result -Success ($memberCount -ge 1) -Message "PATCH add member works"

# Test: PATCH group (remove member)
Write-Host "`n--- Test: PATCH Group (Remove Member) ---" -ForegroundColor Cyan
$removeMemberBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "members[value eq `"$UserId`"]" })
} | ConvertTo-Json -Depth 5
# Group PATCH returns response body (v0.8.16 fix — RFC 7644 §3.5.2)
$groupRemoveResult = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $removeMemberBody
Test-Result -Success ($null -ne $groupRemoveResult.id) -Message "Group PATCH remove returns response body"
$memberCountAfterRemove = if ($groupRemoveResult.members) { @($groupRemoveResult.members).Count } else { 0 }
Test-Result -Success ($memberCountAfterRemove -eq 0) -Message "PATCH remove member works"

# Test: PUT group (replace)
Write-Host "`n--- Test: PUT Group (Replace) ---" -ForegroundColor Cyan
$putGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Replaced Group Name"
} | ConvertTo-Json
$replacedGroup = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PUT -Headers $headers -Body $putGroupBody
Test-Result -Success ($replacedGroup.displayName -eq "Replaced Group Name") -Message "PUT group (replace) works"

# Test: Create group with externalId
Write-Host "`n--- Test: Group externalId Support ---" -ForegroundColor Cyan
$extGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Group With ExternalId"
    externalId = "ext-group-123"
} | ConvertTo-Json
$extGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $extGroupBody
Test-Result -Success ($extGroup.externalId -eq "ext-group-123") -Message "Group created with externalId"

# Test: Filter groups by externalId
$filteredGroups = Invoke-RestMethod -Uri "$scimBase/Groups?filter=externalId eq `"ext-group-123`"" -Method GET -Headers $headers
Test-Result -Success ($filteredGroups.totalResults -eq 1) -Message "Filter groups by externalId returns exactly 1 group"

# Test: Duplicate group externalId → 409
$dupExtGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Dup ExternalId Group"
    externalId = "ext-group-123"
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $dupExtGroupBody | Out-Null
    Test-Result -Success $false -Message "Duplicate group externalId should return 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 409) -Message "Duplicate group externalId returns 409 Conflict"
}

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
    # Group PATCH returns response body (v0.8.16 fix — RFC 7644 §3.5.2)
    $multiGroupResult = Invoke-RestMethod -Uri "$scimBase/Groups/$MultiGroupId" -Method PATCH -Headers $headers -Body $multiMemberPatch
    $multiMemberCount = if ($multiGroupResult.members) { @($multiGroupResult.members).Count } else { 0 }
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

# Test: Multi-member ADD PATCH should fail without flag
Write-Host "`n--- Test: Multi-Member ADD PATCH without Flag (Should Fail) ---" -ForegroundColor Cyan
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
    Test-Result -Success $false -Message "Multi-member ADD should fail without flag"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Multi-member ADD without flag rejected with 400 Bad Request"
}

# ============================================
# TEST SECTION 5b: MULTI-MEMBER REMOVE CONFIG FLAG
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 5b: MULTI-MEMBER REMOVE CONFIG FLAG" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# First, add members individually to the group in the flag-enabled endpoint (main endpoint with add flag)
Write-Host "`n--- Setup: Add Members Individually for Remove Test ---" -ForegroundColor Cyan
foreach ($uid in $multiUserIds) {
    $addSingleMember = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
        Operations = @(@{ op = "add"; path = "members"; value = @(@{value=$uid}) })
    } | ConvertTo-Json -Depth 5
    Invoke-RestMethod -Uri "$scimBase/Groups/$MultiGroupId" -Method PATCH -Headers $headers -Body $addSingleMember | Out-Null
}
# Verify members were added
$groupBeforeRemove = Invoke-RestMethod -Uri "$scimBase/Groups/$MultiGroupId" -Method GET -Headers $headers
Write-Host "Group has $(@($groupBeforeRemove.members).Count) members before remove test"

# Test: Multi-member REMOVE via value array without flag should fail
Write-Host "`n--- Test: Multi-Member REMOVE without Flag (Should Fail) ---" -ForegroundColor Cyan

try {
    # Use no-flag endpoint which has both flags disabled
    # First add members to no-flag group
    foreach ($uid in $noFlagUserIds) {
        $addSingle = @{
            schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
            Operations = @(@{ op = "add"; path = "members"; value = @(@{value=$uid}) })
        } | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Uri "$scimBase2/Groups/$NoFlagGroupId" -Method PATCH -Headers $headers -Body $addSingle | Out-Null
    }
    
    # Build value array with multiple members to remove
    $removeMultipleMembersPatch = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
        Operations = @(@{ 
            op = "remove"
            path = "members"
            value = @(@{value=$noFlagUserIds[0]}, @{value=$noFlagUserIds[1]})
        })
    } | ConvertTo-Json -Depth 5
    
    # Now try to remove multiple members via value array
    Invoke-RestMethod -Uri "$scimBase2/Groups/$NoFlagGroupId" -Method PATCH -Headers $headers -Body $removeMultipleMembersPatch
    Test-Result -Success $false -Message "Multi-member REMOVE should fail without flag"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Multi-member REMOVE without flag rejected with 400 Bad Request"
}

# Create endpoint WITH remove flag enabled
Write-Host "`n--- Test: Multi-Member REMOVE with Flag=True ---" -ForegroundColor Cyan
$removeEnabledBody = @{
    name = "live-test-remove-flag-$(Get-Random)"
    displayName = "Remove Flag Endpoint"
    config = @{ MultiOpPatchRequestRemoveMultipleMembersFromGroup = "True" }
} | ConvertTo-Json
$removeEnabledEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $removeEnabledBody
$RemoveFlagEndpointId = $removeEnabledEndpoint.id
$scimBase3 = "$baseUrl/scim/endpoints/$RemoveFlagEndpointId"

# Create users and group in remove-flag endpoint
$rfUser1 = Invoke-RestMethod -Uri "$scimBase3/Users" -Method POST -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="rfuser1@test.com";active=$true} | ConvertTo-Json)
$rfUser2 = Invoke-RestMethod -Uri "$scimBase3/Users" -Method POST -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="rfuser2@test.com";active=$true} | ConvertTo-Json)
$rfGroup = Invoke-RestMethod -Uri "$scimBase3/Groups" -Method POST -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="Remove Flag Group"} | ConvertTo-Json)
$RemoveFlagGroupId = $rfGroup.id

# Add members individually
Invoke-RestMethod -Uri "$scimBase3/Groups/$RemoveFlagGroupId" -Method PATCH -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp");Operations=@(@{op="add";path="members";value=@(@{value=$rfUser1.id})})} | ConvertTo-Json -Depth 5) | Out-Null
Invoke-RestMethod -Uri "$scimBase3/Groups/$RemoveFlagGroupId" -Method PATCH -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp");Operations=@(@{op="add";path="members";value=@(@{value=$rfUser2.id})})} | ConvertTo-Json -Depth 5) | Out-Null

# Verify members added
$rfGroupBefore = Invoke-RestMethod -Uri "$scimBase3/Groups/$RemoveFlagGroupId" -Method GET -Headers $headers
$rfMembersBefore = if ($rfGroupBefore.members) { @($rfGroupBefore.members).Count } else { 0 }

# Build value array with multiple members to remove
$removeMultiplePatch = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ 
        op = "remove"
        path = "members"
        value = @(@{value=$rfUser1.id}, @{value=$rfUser2.id})
    })
} | ConvertTo-Json -Depth 5

# Now try to remove multiple members via value array with flag enabled
try {
    Invoke-RestMethod -Uri "$scimBase3/Groups/$RemoveFlagGroupId" -Method PATCH -Headers $headers -Body $removeMultiplePatch | Out-Null
    $rfGroupAfter = Invoke-RestMethod -Uri "$scimBase3/Groups/$RemoveFlagGroupId" -Method GET -Headers $headers
    $rfMembersAfter = if ($rfGroupAfter.members) { @($rfGroupAfter.members).Count } else { 0 }
    Test-Result -Success ($rfMembersAfter -eq 0) -Message "Multi-member REMOVE with flag=True accepted (removed $rfMembersBefore members)"
} catch {
    Test-Result -Success $false -Message "Multi-member REMOVE should succeed with flag=True"
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
# TEST SECTION 8b: CONTENT-TYPE & AUTH VERIFICATION
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 8b: CONTENT-TYPE & AUTH VERIFICATION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Response Content-Type is application/scim+json
Write-Host "`n--- Test: Response Content-Type Header ---" -ForegroundColor Cyan
$rawResponse = Invoke-WebRequest -Uri "$scimBase/Users" -Method GET -Headers $headers
$contentType = $rawResponse.Headers['Content-Type']
# Handle both single string and array (PowerShell version differences)
$ctValue = if ($contentType -is [array]) { $contentType[0] } else { $contentType }
Test-Result -Success ($ctValue -like "*scim+json*") -Message "Response Content-Type is application/scim+json ($ctValue)"

# Test: POST response also has scim+json content type
$postRawResponse = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="ct-test-$(Get-Random)@test.com";active=$true} | ConvertTo-Json)
$postCt = $postRawResponse.Headers['Content-Type']
$postCtValue = if ($postCt -is [array]) { $postCt[0] } else { $postCt }
Test-Result -Success ($postCtValue -like "*scim+json*") -Message "POST response Content-Type is application/scim+json"
# Verify POST status code is 201
Test-Result -Success ($postRawResponse.StatusCode -eq 201) -Message "POST response status code is 201 Created"

# Test: Missing Authorization header → 401
Write-Host "`n--- Test: Missing Auth Token → 401 ---" -ForegroundColor Cyan
try {
    $noAuthHeaders = @{'Content-Type'='application/json'}
    Invoke-RestMethod -Uri "$scimBase/Users" -Method GET -Headers $noAuthHeaders | Out-Null
    Test-Result -Success $false -Message "Missing auth should return 401"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 401) -Message "Missing Authorization header returns 401"
}

# Test: Invalid token → 401
Write-Host "`n--- Test: Invalid Auth Token → 401 ---" -ForegroundColor Cyan
try {
    $badAuthHeaders = @{Authorization="Bearer totally-invalid-token-xyz"; 'Content-Type'='application/json'}
    Invoke-RestMethod -Uri "$scimBase/Users" -Method GET -Headers $badAuthHeaders | Out-Null
    Test-Result -Success $false -Message "Invalid token should return 401"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 401) -Message "Invalid Bearer token returns 401"
}

# Test: No Bearer prefix → 401
Write-Host "`n--- Test: Token Without Bearer Prefix → 401 ---" -ForegroundColor Cyan
try {
    $noBearerHeaders = @{Authorization="$Token"; 'Content-Type'='application/json'}
    Invoke-RestMethod -Uri "$scimBase/Users" -Method GET -Headers $noBearerHeaders | Out-Null
    Test-Result -Success $false -Message "Token without Bearer prefix should return 401"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 401) -Message "Token without 'Bearer ' prefix returns 401"
}

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
# TEST SECTION 9b: RFC 7644 COMPLIANCE CHECKS
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9b: RFC 7644 COMPLIANCE CHECKS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Location header on POST /Users (RFC 7644 §3.1)
Write-Host "`n--- Test: Location Header on POST /Users (RFC 7644 §3.1) ---" -ForegroundColor Cyan
$locUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="loc-header-test-$(Get-Random)@test.com";active=$true} | ConvertTo-Json
$locUserRaw = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $locUserBody
$locUserContent = if ($locUserRaw.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($locUserRaw.Content) } else { $locUserRaw.Content }
$locUserData = $locUserContent | ConvertFrom-Json
$locationHeader = $locUserRaw.Headers['Location']
$locationValue = if ($locationHeader -is [array]) { $locationHeader[0] } else { $locationHeader }
Test-Result -Success ($locUserRaw.StatusCode -eq 201) -Message "POST /Users returns 201 Created"
Test-Result -Success ($null -ne $locationValue -and $locationValue.Length -gt 0) -Message "POST /Users includes Location header"
Test-Result -Success ($locationValue -eq $locUserData.meta.location) -Message "Location header matches meta.location"

# Test: Location header on POST /Groups (RFC 7644 §3.1)
Write-Host "`n--- Test: Location Header on POST /Groups (RFC 7644 §3.1) ---" -ForegroundColor Cyan
$locGroupBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="Loc Header Test Group"} | ConvertTo-Json
$locGroupRaw = Invoke-WebRequest -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $locGroupBody
$locGroupContent = if ($locGroupRaw.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($locGroupRaw.Content) } else { $locGroupRaw.Content }
$locGroupData = $locGroupContent | ConvertFrom-Json
$groupLocationHeader = $locGroupRaw.Headers['Location']
$groupLocationValue = if ($groupLocationHeader -is [array]) { $groupLocationHeader[0] } else { $groupLocationHeader }
Test-Result -Success ($locGroupRaw.StatusCode -eq 201) -Message "POST /Groups returns 201 Created"
Test-Result -Success ($null -ne $groupLocationValue -and $groupLocationValue.Length -gt 0) -Message "POST /Groups includes Location header"
Test-Result -Success ($groupLocationValue -eq $locGroupData.meta.location) -Message "Location header matches meta.location"

# Test: Error response format (RFC 7644 §3.12)
Write-Host "`n--- Test: Error Response Format (RFC 7644 §3.12) ---" -ForegroundColor Cyan
$errorRaw = Invoke-WebRequest -Uri "$scimBase/Users/non-existent-error-format-test" -Method GET -Headers $headers -SkipHttpErrorCheck
$errorContent = if ($errorRaw.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($errorRaw.Content) } else { $errorRaw.Content }
$errorBody = $errorContent | ConvertFrom-Json
$errorCt = $errorRaw.Headers['Content-Type']
$errorCtValue = if ($errorCt -is [array]) { $errorCt[0] } else { $errorCt }
Test-Result -Success ($errorRaw.StatusCode -eq 404) -Message "Error returns 404 status code"
Test-Result -Success ($errorCtValue -like "*scim+json*") -Message "Error Content-Type is application/scim+json"
Test-Result -Success ($errorBody.schemas -contains "urn:ietf:params:scim:api:messages:2.0:Error") -Message "Error has SCIM Error schema"
Test-Result -Success ($errorBody.status -is [string]) -Message "Error status is string type: '$($errorBody.status)'"
Test-Result -Success ($errorBody.status -eq "404") -Message "Error status value is '404'"
Test-Result -Success ($null -ne $errorBody.detail) -Message "Error includes detail message"

# Test: 409 error also has correct SCIM format
Write-Host "`n--- Test: 409 Error Response Format ---" -ForegroundColor Cyan
$dup409Body = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="livetest-user@test.com";active=$true} | ConvertTo-Json
$error409Raw = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dup409Body -SkipHttpErrorCheck
$error409Content = if ($error409Raw.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($error409Raw.Content) } else { $error409Raw.Content }
$error409Body = $error409Content | ConvertFrom-Json
$error409Ct = $error409Raw.Headers['Content-Type']
$error409CtValue = if ($error409Ct -is [array]) { $error409Ct[0] } else { $error409Ct }
Test-Result -Success ($error409Raw.StatusCode -eq 409) -Message "Duplicate returns 409"
Test-Result -Success ($error409CtValue -like "*scim+json*") -Message "409 error Content-Type is application/scim+json"
Test-Result -Success ($error409Body.status -eq "409") -Message "409 error status is string '409'"

# Test: PATCH updates meta.lastModified timestamp
Write-Host "`n--- Test: PATCH Updates meta.lastModified ---" -ForegroundColor Cyan
$tsUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="timestamp-test-$(Get-Random)@test.com";active=$true} | ConvertTo-Json
$timestampUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $tsUserBody
$originalLastModified = $timestampUser.meta.lastModified
Start-Sleep -Milliseconds 200
$patchTsBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "Timestamp Updated" })
} | ConvertTo-Json -Depth 3
$patchedTimestamp = Invoke-RestMethod -Uri "$scimBase/Users/$($timestampUser.id)" -Method PATCH -Headers $headers -Body $patchTsBody
Test-Result -Success ($patchedTimestamp.meta.lastModified -ne $originalLastModified) -Message "PATCH updates meta.lastModified timestamp"

# Test: GET does not change lastModified
$getTsUser = Invoke-RestMethod -Uri "$scimBase/Users/$($timestampUser.id)" -Method GET -Headers $headers
Test-Result -Success ($getTsUser.meta.lastModified -eq $patchedTimestamp.meta.lastModified) -Message "GET does not change meta.lastModified"

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
if ($RemoveFlagEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$RemoveFlagEndpointId" -Name "Remove Flag Endpoint" }
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
