# Live Test Script for All Endpoint Flows
# This script tests endpoint CRUD, SCIM operations, config validation, and isolation
#
# Usage:
#   .\live-test.ps1                                          # Local dev (defaults)
#   .\live-test.ps1 -Verbose                                 # Verbose mode (shows request/response)
#   .\live-test.ps1 -BaseUrl http://localhost:3000            # Custom local port
#   .\live-test.ps1 -BaseUrl https://myapp.azurecontainerapps.io -ClientSecret "my-secret"   # Azure
#   .\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "docker-secret"              # Docker
#
# Parameters:
#   -BaseUrl        Target server URL (default: http://localhost:6000)
#   -ClientId       OAuth client_id  (default: scimserver-client, matches OAUTH_CLIENT_ID env var)
#   -ClientSecret   OAuth client_secret (default: changeme-oauth, must match server's OAUTH_CLIENT_SECRET)
#   -Verbose        Show full HTTP request/response details

param(
    [string]$BaseUrl = "http://localhost:6000",
    [string]$ClientId = "scimserver-client",
    [string]$ClientSecret = "changeme-oauth",
    [switch]$Verbose
)

$ErrorActionPreference = "Continue"
$baseUrl = $BaseUrl
$testsPassed = 0
$testsFailed = 0
$VerboseMode = $Verbose.IsPresent
$script:testResults = @()
$script:flowSteps = @()
$script:flowStepCounter = 0
$script:lastLinkedFlowStepId = 0
$script:currentSection = "Setup"

function Write-VerboseLog {
    param([string]$Label, $Data)
    if (-not $script:VerboseMode) { return }
    if ($null -eq $Data) {
        Write-Host "    📋 $Label" -ForegroundColor DarkGray
    } elseif ($Data -is [string]) {
        Write-Host "    📋 ${Label}: $Data" -ForegroundColor DarkGray
    } else {
        $json = try { $Data | ConvertTo-Json -Depth 4 -Compress } catch { "$Data" }
        if ($json.Length -gt 300) { $json = $json.Substring(0, 297) + "..." }
        Write-Host "    📋 ${Label}: $json" -ForegroundColor DarkGray
    }
}

function Convert-FlowHeaders {
    param([System.Collections.IDictionary]$Headers)
    if ($null -eq $Headers) { return $null }
    $normalized = [ordered]@{}
    foreach ($key in $Headers.Keys) {
        $value = $Headers[$key]
        $headerName = [string]$key
        if ($headerName -ieq 'Authorization') {
            $normalized[$headerName] = 'Bearer ***'
            continue
        }
        if ($value -is [array]) {
            $normalized[$headerName] = ($value -join ', ')
        } else {
            $normalized[$headerName] = [string]$value
        }
    }
    return $normalized
}

function Convert-FlowBody {
    param($Body)
    if ($null -eq $Body) { return $null }
    if ($Body -is [string]) {
        if ($Body.Length -gt 6000) { return $Body.Substring(0, 6000) + '...' }
        return $Body
    }
    try {
        $json = $Body | ConvertTo-Json -Depth 10
        if ($json.Length -gt 6000) { return $json.Substring(0, 6000) + '...' }
        return $Body
    } catch {
        $str = [string]$Body
        if ($str.Length -gt 6000) { return $str.Substring(0, 6000) + '...' }
        return $str
    }
}

function Add-FlowStep {
    param(
        [datetime]$StartedAt,
        [string]$Method,
        [string]$Uri,
        [System.Collections.IDictionary]$RequestHeaders,
        $RequestBody,
        [int]$StatusCode,
        [System.Collections.IDictionary]$ResponseHeaders,
        $ResponseBody,
        [string]$ErrorMessage
    )

    $finishedAt = Get-Date
    $script:flowStepCounter++
    $script:flowSteps += [PSCustomObject]@{
        stepId      = $script:flowStepCounter
        section     = $script:currentSection
        actionStep  = "$Method $Uri"
        startedAt   = $StartedAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        finishedAt  = $finishedAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        durationMs  = [math]::Round(($finishedAt - $StartedAt).TotalMilliseconds)
        request     = [ordered]@{
            method  = $Method
            url     = $Uri
            headers = Convert-FlowHeaders -Headers $RequestHeaders
            body    = Convert-FlowBody -Body $RequestBody
        }
        response    = if ($StatusCode -gt 0 -or $null -ne $ResponseHeaders -or $null -ne $ResponseBody) {
            [ordered]@{
                status  = $StatusCode
                headers = Convert-FlowHeaders -Headers $ResponseHeaders
                body    = Convert-FlowBody -Body $ResponseBody
            }
        } else {
            $null
        }
        error       = if ($ErrorMessage) {
            [ordered]@{
                message = $ErrorMessage
            }
        } else {
            $null
        }
    }
}

# Override built-in cmdlets to inject verbose logging transparently.
# All 138+ existing Invoke-RestMethod/Invoke-WebRequest calls get verbose
# output automatically -- no changes needed at call sites.
# Originals are called via module-qualified names.

function Invoke-RestMethod {
    [CmdletBinding()]
    param(
        [string]$Uri,
        [string]$Method,
        [System.Collections.IDictionary]$Headers,
        [object]$Body,
        [string]$ContentType
    )
    $requestStart = Get-Date
    $m = if ($Method) { $Method.ToUpperInvariant() } else { "GET" }
    if ($script:VerboseMode) {
        Write-Host "    📋 → $m $Uri" -ForegroundColor DarkGray
        if ($Body) {
            $bs = if ($Body -is [string]) { $Body } else { try { $Body | ConvertTo-Json -Compress } catch { "$Body" } }
            if ($bs.Length -gt 200) { $bs = $bs.Substring(0, 197) + "..." }
            Write-Host "    📋   Body: $bs" -ForegroundColor DarkGray
        }
    }
    $restResponseHeaders = $null
    $restStatusCode = 0
    try {
        $result = Microsoft.PowerShell.Utility\Invoke-RestMethod @PSBoundParameters -AllowInsecureRedirect -ResponseHeadersVariable restResponseHeaders -StatusCodeVariable restStatusCode
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $restStatusCode -ResponseHeaders $restResponseHeaders -ResponseBody $result -ErrorMessage $null
    } catch {
        $errorStatus = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            try { $errorStatus = [int]$_.Exception.Response.StatusCode } catch { $errorStatus = 0 }
        }
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $errorStatus -ResponseHeaders $null -ResponseBody $_.ErrorDetails.Message -ErrorMessage $_.Exception.Message
        if ($script:VerboseMode) {
            Write-Host "    📋 ← Error: $($_.Exception.Message)" -ForegroundColor DarkYellow
            if ($_.ErrorDetails.Message) {
                $eb = $_.ErrorDetails.Message
                if ($eb.Length -gt 200) { $eb = $eb.Substring(0, 197) + "..." }
                Write-Host "    📋   Error Body: $eb" -ForegroundColor DarkYellow
            }
        }
        throw
    }
    if ($script:VerboseMode) {
        $json = try { $result | ConvertTo-Json -Depth 4 -Compress } catch { "$result" }
        if ($json -and $json.Length -gt 300) { $json = $json.Substring(0, 297) + "..." }
        Write-Host "    📋 ← Response: $json" -ForegroundColor DarkGray
    }
    return $result
}

function Invoke-WebRequest {
    [CmdletBinding()]
    param(
        [string]$Uri,
        [string]$Method,
        [System.Collections.IDictionary]$Headers,
        [object]$Body,
        [switch]$SkipHttpErrorCheck
    )
    $requestStart = Get-Date
    $m = if ($Method) { $Method.ToUpperInvariant() } else { "GET" }
    if ($script:VerboseMode) {
        Write-Host "    📋 → $m $Uri" -ForegroundColor DarkGray
        if ($Body) {
            $bs = if ($Body -is [string]) { $Body } else { try { $Body | ConvertTo-Json -Compress } catch { "$Body" } }
            if ($bs.Length -gt 200) { $bs = $bs.Substring(0, 197) + "..." }
            Write-Host "    📋   Body: $bs" -ForegroundColor DarkGray
        }
    }
    try {
        $result = Microsoft.PowerShell.Utility\Invoke-WebRequest @PSBoundParameters -AllowInsecureRedirect
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $result.StatusCode -ResponseHeaders $result.Headers -ResponseBody $result.Content -ErrorMessage $null
    } catch {
        $errorStatus = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            try { $errorStatus = [int]$_.Exception.Response.StatusCode } catch { $errorStatus = 0 }
        }
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $errorStatus -ResponseHeaders $null -ResponseBody $_.ErrorDetails.Message -ErrorMessage $_.Exception.Message
        if ($script:VerboseMode) {
            Write-Host "    📋 ← HTTP Error: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
        throw
    }
    if ($script:VerboseMode) {
        Write-Host "    📋 ← HTTP $($result.StatusCode)" -ForegroundColor DarkGray
        if ($result.Headers['ETag']) {
            $etag = if ($result.Headers['ETag'] -is [array]) { $result.Headers['ETag'][0] } else { $result.Headers['ETag'] }
            Write-Host "    📋   ETag: $etag" -ForegroundColor DarkGray
        }
        if ($result.Headers['Content-Type']) {
            $ct = if ($result.Headers['Content-Type'] -is [array]) { $result.Headers['Content-Type'][0] } else { $result.Headers['Content-Type'] }
            Write-Host "    📋   Content-Type: $ct" -ForegroundColor DarkGray
        }
    }
    return $result
}

function Test-Result {
    param([bool]$Success, [string]$Message)
    $status = if ($Success) { "passed" } else { "failed" }
    $newFlowStepIds = @($script:flowSteps | Where-Object { $_.stepId -gt $script:lastLinkedFlowStepId } | ForEach-Object { $_.stepId })
    if ($script:flowSteps.Count -gt 0) {
        $script:lastLinkedFlowStepId = $script:flowSteps[-1].stepId
    }
    $latestAction = if ($newFlowStepIds.Count -gt 0) {
        ($script:flowSteps | Where-Object { $_.stepId -eq $newFlowStepIds[-1] } | Select-Object -First 1).actionStep
    } else {
        $null
    }
    $script:testResults += [PSCustomObject]@{
        section       = $script:currentSection
        name          = $Message
        status        = $status
        actionStep    = $latestAction
        actionStepIds = $newFlowStepIds
    }
    if ($Success) {
        Write-Host "PASS: $Message" -ForegroundColor Green
        $script:testsPassed++
    } else {
        Write-Host "FAIL: $Message" -ForegroundColor Red
        $script:testsFailed++
    }
}

if ($VerboseMode) {
    Write-Host "🔍 VERBOSE MODE ENABLED -- request/response details will be shown" -ForegroundColor Magenta
    Write-Host ""
}

# Step 1: Get OAuth token
Write-Host "`n=== STEP 1: Get OAuth Token ===" -ForegroundColor Cyan
Write-VerboseLog "Token endpoint" "$baseUrl/scim/oauth/token"
Write-VerboseLog "Client ID" $ClientId
$tokenBody = @{client_id=$ClientId;client_secret=$ClientSecret;grant_type='client_credentials'}
$tokenResponse = Invoke-RestMethod -Uri "$baseUrl/scim/oauth/token" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $tokenBody
$Token = $tokenResponse.access_token
Write-Host "✅ Token obtained: $($Token.Substring(0,30))..."
Write-VerboseLog "Token expires_in" "$($tokenResponse.expires_in)s"

$headers = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'}
$script:startTime = Get-Date

# ============================================
# TEST SECTION 1: ENDPOINT CRUD OPERATIONS
# ============================================
$script:currentSection = "1: Endpoint CRUD"
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
$script:currentSection = "2: Config Validation"
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
Test-Result -Success ($boolResult.config.MultiOpPatchRequestAddMultipleMembersToGroup -eq $true) -Message "Boolean true accepted as config value"

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
Test-Result -Success ($validVerboseResult.config.VerbosePatchSupported -eq $true) -Message "VerbosePatchSupported boolean true accepted"

# Test: All three flags can be set together
Write-Host "`n--- Test: All Three Config Flags Set Together ---" -ForegroundColor Cyan
$allFlagsBody = '{"config":{"MultiOpPatchRequestAddMultipleMembersToGroup":"True","MultiOpPatchRequestRemoveMultipleMembersFromGroup":"True","VerbosePatchSupported":true}}'
$allResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $allFlagsBody
$allValid = ($allResult.config.MultiOpPatchRequestAddMultipleMembersToGroup -eq "True") -and ($allResult.config.MultiOpPatchRequestRemoveMultipleMembersFromGroup -eq "True") -and ($allResult.config.VerbosePatchSupported -eq $true)
Test-Result -Success $allValid -Message "All three config flags set together"

# ============================================
# TEST SECTION 3: SCIM USER OPERATIONS
# ============================================
$script:currentSection = "3: User Operations"
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
# TEST SECTION 3b: CASE-INSENSITIVITY (RFC 7643 S2.1)
$script:currentSection = "3b: Case-Insensitivity"
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
$script:currentSection = "3c: Advanced Patch"
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

# Test: Manager empty-value removal (RFC 7644 S3.5.2.3)
Write-Host "`n--- Test: Manager Empty-Value Removal (RFC 7644 S3.5.2.3) ---" -ForegroundColor Cyan
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
Test-Result -Success $managerGone -Message "Manager removed when value is empty string (RFC 7644 S3.5.2.3)"

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
$script:currentSection = "3d: Pagination & Filtering"
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
# TEST SECTION 3e: SCIM ID LEAK PREVENTION (Issue 16)
$script:currentSection = "3e: SCIM ID Leak Prevention"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 3e: SCIM ID LEAK PREVENTION (Issue 16)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: POST with client-supplied id -- server must ignore it
Write-Host "`n--- Test: POST with Client-Supplied id (Must Be Ignored) ---" -ForegroundColor Cyan
$clientSuppId = "a1b2c3d4-e5f6-7890-abcd-1234567890ab"
$idLeakBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    id = $clientSuppId
    userName = "idleak-test@test.com"
    displayName = "ID Leak Test User"
    active = $true
} | ConvertTo-Json -Depth 3
$idLeakUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $idLeakBody
$serverAssignedId = $idLeakUser.id
Test-Result -Success ($null -ne $serverAssignedId) -Message "Server assigned an id: $serverAssignedId"
Test-Result -Success ($serverAssignedId -ne $clientSuppId) -Message "Server-assigned id is NOT the client-supplied id"
Test-Result -Success ($idLeakUser.meta.location -like "*Users/$serverAssignedId") -Message "meta.location uses server-assigned id"
Test-Result -Success ($idLeakUser.meta.location -notlike "*Users/$clientSuppId") -Message "meta.location does NOT use client-supplied id"

# Test: GET by server-assigned id should succeed
Write-Host "`n--- Test: GET by Server-Assigned ID ---" -ForegroundColor Cyan
$fetchedIdLeakUser = Invoke-RestMethod -Uri "$scimBase/Users/$serverAssignedId" -Method GET -Headers $headers
Test-Result -Success ($fetchedIdLeakUser.id -eq $serverAssignedId) -Message "GET by server-assigned id returns correct user"

# Test: GET by client-supplied id should return 404
Write-Host "`n--- Test: GET by Client-Supplied ID (Must Return 404) ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/$clientSuppId" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "GET by client-supplied id should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "GET by client-supplied id returns 404 (server ignores client id)"
}

# Test: PATCH with id in no-path value -- must not override scimId
Write-Host "`n--- Test: PATCH with id in No-Path Value (Must Not Override) ---" -ForegroundColor Cyan
$patchIdBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{
            displayName = "Patched ID Leak"
            id = "attacker-id-in-patch"
        }
    })
} | ConvertTo-Json -Depth 4
$patchedIdUser = Invoke-RestMethod -Uri "$scimBase/Users/$serverAssignedId" -Method PATCH -Headers $headers -Body $patchIdBody
Test-Result -Success ($patchedIdUser.id -eq $serverAssignedId) -Message "PATCH id remains server-assigned (not attacker value)"
Test-Result -Success ($patchedIdUser.id -ne "attacker-id-in-patch") -Message "PATCH does not allow id override via no-path replace"
Test-Result -Success ($patchedIdUser.displayName -eq "Patched ID Leak") -Message "PATCH displayName applied despite id in value"
Test-Result -Success ($patchedIdUser.meta.location -like "*Users/$serverAssignedId") -Message "meta.location unchanged after PATCH with id injection"

# Test: PUT with client-supplied id -- must not override scimId
Write-Host "`n--- Test: PUT with Client-Supplied id (Must Be Ignored) ---" -ForegroundColor Cyan
$putIdBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    id = "put-override-attempt"
    userName = "idleak-test@test.com"
    displayName = "PUT ID Override Test"
    active = $true
} | ConvertTo-Json -Depth 3
$putIdUser = Invoke-RestMethod -Uri "$scimBase/Users/$serverAssignedId" -Method PUT -Headers $headers -Body $putIdBody
Test-Result -Success ($putIdUser.id -eq $serverAssignedId) -Message "PUT id remains server-assigned (not client value)"
Test-Result -Success ($putIdUser.id -ne "put-override-attempt") -Message "PUT does not allow id override"
Test-Result -Success ($putIdUser.displayName -eq "PUT ID Override Test") -Message "PUT body applied correctly despite client id"

# Cleanup: Delete the ID leak test user
Invoke-RestMethod -Uri "$scimBase/Users/$serverAssignedId" -Method DELETE -Headers $headers | Out-Null
Write-Host "  Cleaned up ID leak test user: $serverAssignedId" -ForegroundColor DarkGray

# ============================================
# TEST SECTION 4: SCIM GROUP OPERATIONS
# ============================================
$script:currentSection = "4: Group Operations"
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
# Group PATCH returns response body (v0.8.16 fix -- RFC 7644 S3.5.2)
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
# Group PATCH returns response body (v0.8.16 fix -- RFC 7644 S3.5.2)
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

# Test: Filter groups by externalId with DIFFERENT CASE — should NOT match (TEXT = case-sensitive, caseExact=true)
Write-Host "`n--- Test: Group externalId Case-Sensitive Filter (RFC 7643 §3.1 caseExact=true) ---" -ForegroundColor Cyan
$extIdFilterCIGroup = Invoke-RestMethod -Uri "$scimBase/Groups?filter=externalId eq `"EXT-GROUP-123`"" -Method GET -Headers $headers
Test-Result -Success ($extIdFilterCIGroup.totalResults -eq 0) -Message "Filter group with UPPERCASE externalId does NOT match (TEXT case-sensitive)"

# Test: Filter groups by externalId with mixed case — should NOT match
$extIdFilterMixed = Invoke-RestMethod -Uri "$scimBase/Groups?filter=externalId eq `"Ext-Group-123`"" -Method GET -Headers $headers
Test-Result -Success ($extIdFilterMixed.totalResults -eq 0) -Message "Filter group with MixedCase externalId does NOT match (TEXT case-sensitive)"

# Test: Filter groups by externalId with UPPERCASE attribute name
$extIdFilterAttrCI = Invoke-RestMethod -Uri "$scimBase/Groups?filter=EXTERNALID eq `"ext-group-123`"" -Method GET -Headers $headers
Test-Result -Success ($extIdFilterAttrCI.totalResults -eq 1) -Message "Filter with 'EXTERNALID' (uppercase attr) on Groups finds group"

# Test: Filter for non-existing group by externalId
$extIdFilterNone = Invoke-RestMethod -Uri "$scimBase/Groups?filter=externalId eq `"nonexistent-ext-id`"" -Method GET -Headers $headers
Test-Result -Success ($extIdFilterNone.totalResults -eq 0) -Message "Filter for non-existing group externalId returns 0"

# Test: PATCH group externalId update
Write-Host "`n--- Test: PATCH Group externalId Update ---" -ForegroundColor Cyan
$patchExtBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; value = @{ externalId = "updated-ext-789" } })
} | ConvertTo-Json -Depth 5
$patchExtResult = Invoke-RestMethod -Uri "$scimBase/Groups/$($extGroup.id)" -Method PATCH -Headers $headers -Body $patchExtBody
Test-Result -Success ($patchExtResult.externalId -eq "updated-ext-789") -Message "PATCH group externalId update works"

# Test: externalId is caseExact=true for Groups (case-variant value should be allowed)
Write-Host "`n--- Test: Group externalId Case-Exact Uniqueness ---" -ForegroundColor Cyan
$ciDupGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "CI Dup Group"
    externalId = "UPDATED-EXT-789"  # Same as updated-ext-789 just in UPPERCASE
} | ConvertTo-Json
try {
    $ciDupGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $ciDupGroupBody
    Test-Result -Success ($null -ne $ciDupGroup.id) -Message "Case-variant group externalId allowed (caseExact=true)"
} catch {
    Test-Result -Success $false -Message "Case-variant group externalId should be allowed (caseExact=true)"
}

# Test: Duplicate group externalId → 409
$dupExtGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Dup ExternalId Group"
    externalId = "updated-ext-789"
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $dupExtGroupBody | Out-Null
    Test-Result -Success $false -Message "Duplicate group externalId should return 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 409) -Message "Duplicate group externalId returns 409 Conflict"
}

# ============================================
# TEST SECTION 4b: SCIM VALIDATOR MULTI-OP PATCH
# ============================================
$script:currentSection = "4b: Validator Multi-Op PATCH"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 4b: SCIM VALIDATOR MULTI-OP PATCH" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Multiple Ops on different User attributes (add/replace/remove)
Write-Host "`n--- Test: Multi-Op PATCH User (different attributes) ---" -ForegroundColor Cyan
$multiOpUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "multiop-test@test.com"
    displayName = "OriginalDisplay"
    title = "OriginalTitle"
    active = $true
} | ConvertTo-Json
$multiOpUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $multiOpUserBody
$multiOpPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "add"; path = "displayName"; value = "NewDisplayName" },
        @{ op = "replace"; path = "title"; value = "NewTitle" },
        @{ op = "remove"; path = "preferredLanguage" }
    )
} | ConvertTo-Json -Depth 5
$multiOpResult = Invoke-RestMethod -Uri "$scimBase/Users/$($multiOpUser.id)" -Method PATCH -Headers $headers -Body $multiOpPatchBody
Test-Result -Success ($multiOpResult.displayName -eq "NewDisplayName") -Message "Multi-op PATCH: add displayName works"
Test-Result -Success ($multiOpResult.title -eq "NewTitle") -Message "Multi-op PATCH: replace title works"

# Test: Multiple Ops on same User attribute (remove→add→replace)
Write-Host "`n--- Test: Multi-Op PATCH User (same attribute) ---" -ForegroundColor Cyan
$sameAttrPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "remove"; path = "displayName" },
        @{ op = "add"; path = "displayName"; value = "IntermediateDisplay" },
        @{ op = "replace"; path = "displayName"; value = "FinalDisplay" }
    )
} | ConvertTo-Json -Depth 5
$sameAttrResult = Invoke-RestMethod -Uri "$scimBase/Users/$($multiOpUser.id)" -Method PATCH -Headers $headers -Body $sameAttrPatchBody
Test-Result -Success ($sameAttrResult.displayName -eq "FinalDisplay") -Message "Multi-op PATCH: sequential ops on same attr gives final value"

# Test: DELETE non-existent user → 404
Write-Host "`n--- Test: DELETE Non-Existent User (Preview Test) ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/00000000-0000-0000-0000-999999999999" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "DELETE non-existent user should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "DELETE non-existent user returns 404"
}

# Test: DELETE same user twice → 204 then 404
Write-Host "`n--- Test: DELETE Same User Twice (Preview Test) ---" -ForegroundColor Cyan
$delTwiceUserBody = @{ schemas = @("urn:ietf:params:scim:schemas:core:2.0:User"); userName = "deltwice@test.com"; active = $true } | ConvertTo-Json
$delTwiceUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $delTwiceUserBody
Invoke-RestMethod -Uri "$scimBase/Users/$($delTwiceUser.id)" -Method DELETE -Headers $headers | Out-Null
try {
    Invoke-RestMethod -Uri "$scimBase/Users/$($delTwiceUser.id)" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Second DELETE of same user should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Second DELETE of same user returns 404"
}

# Test: Multi-op PATCH on Group (add then remove member)
Write-Host "`n--- Test: Multi-Op PATCH Group (add+remove member) ---" -ForegroundColor Cyan
$moGroupUserBody = @{ schemas = @("urn:ietf:params:scim:schemas:core:2.0:User"); userName = "mogroup-member@test.com"; active = $true } | ConvertTo-Json
$moGroupUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $moGroupUserBody
$moGroupBody = @{ schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group"); displayName = "MultiOp Group" } | ConvertTo-Json
$moGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $moGroupBody
$moGroupPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "add"; path = "members"; value = @(@{ value = $moGroupUser.id }) },
        @{ op = "remove"; path = "members[value eq `"$($moGroupUser.id)`"]" }
    )
} | ConvertTo-Json -Depth 5
$moGroupResult = Invoke-RestMethod -Uri "$scimBase/Groups/$($moGroup.id)" -Method PATCH -Headers $headers -Body $moGroupPatchBody
$moMemberCount = if ($moGroupResult.members) { @($moGroupResult.members).Count } else { 0 }
Test-Result -Success ($moMemberCount -eq 0) -Message "Multi-op PATCH group: add+remove member results in 0 members"

# Test: DELETE non-existent group → 404
Write-Host "`n--- Test: DELETE Non-Existent Group (Preview Test) ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/00000000-0000-0000-0000-999999999999" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "DELETE non-existent group should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "DELETE non-existent group returns 404"
}

# Test: DELETE same group twice → 204 then 404
Write-Host "`n--- Test: DELETE Same Group Twice (Preview Test) ---" -ForegroundColor Cyan
$delTwiceGroupBody = @{ schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group"); displayName = "DelTwice Group" } | ConvertTo-Json
$delTwiceGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $delTwiceGroupBody
Invoke-RestMethod -Uri "$scimBase/Groups/$($delTwiceGroup.id)" -Method DELETE -Headers $headers | Out-Null
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/$($delTwiceGroup.id)" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Second DELETE of same group should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Second DELETE of same group returns 404"
}

# Test: User externalId case-sensitive filter (RFC 7643 §3.1 caseExact=true)
Write-Host "`n--- Test: User externalId Case-Sensitive Filter ---" -ForegroundColor Cyan
$ciExtUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "ci-ext-user@test.com"
    externalId = "ext-user-citest"
    active = $true
} | ConvertTo-Json
Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $ciExtUserBody | Out-Null
# Exact case match → should find 1
$ciExtUserFilter = Invoke-RestMethod -Uri "$scimBase/Users?filter=externalId eq `"ext-user-citest`"" -Method GET -Headers $headers
Test-Result -Success ($ciExtUserFilter.totalResults -eq 1) -Message "Filter user with exact-case externalId finds user (TEXT)"
# Different case → should find 0 (case-sensitive)
$ciExtUserFilterUpper = Invoke-RestMethod -Uri "$scimBase/Users?filter=externalId eq `"EXT-USER-CITEST`"" -Method GET -Headers $headers
Test-Result -Success ($ciExtUserFilterUpper.totalResults -eq 0) -Message "Filter user with UPPERCASE externalId does NOT match (TEXT case-sensitive)"

# ============================================
# TEST SECTION 5: MULTI-MEMBER PATCH CONFIG FLAG
# ============================================
$script:currentSection = "5: Multi-Member Patch"
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
    # Group PATCH returns response body (v0.8.16 fix -- RFC 7644 S3.5.2)
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
$script:currentSection = "5b: Multi-Member Remove"
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
$script:currentSection = "6: Endpoint Isolation"
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
$script:currentSection = "7: Inactive Endpoint"
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
$script:currentSection = "8: Discovery Endpoints"
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
$script:currentSection = "8b: Content-Type & Auth"
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
$script:currentSection = "9: Error Handling"
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
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/00000000-0000-0000-0000-000000012345" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Non-existent endpoint should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Non-existent endpoint returns 404"
}

# Test: PUT 404 for non-existent user
Write-Host "`n--- Test: PUT 404 for Non-Existent User ---" -ForegroundColor Cyan
$putNonExistUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="ghost@test.com";active=$true} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users/non-existent-id-12345" -Method PUT -Headers $headers -Body $putNonExistUserBody | Out-Null
    Test-Result -Success $false -Message "PUT non-existent user should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "PUT non-existent user returns 404"
}

# Test: PATCH 404 for non-existent user
Write-Host "`n--- Test: PATCH 404 for Non-Existent User ---" -ForegroundColor Cyan
$patchNonExistUserBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "Ghost" })
} | ConvertTo-Json -Depth 3
try {
    Invoke-RestMethod -Uri "$scimBase/Users/non-existent-id-12345" -Method PATCH -Headers $headers -Body $patchNonExistUserBody | Out-Null
    Test-Result -Success $false -Message "PATCH non-existent user should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "PATCH non-existent user returns 404"
}

# Test: DELETE 404 for non-existent user
Write-Host "`n--- Test: DELETE 404 for Non-Existent User ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/non-existent-id-12345" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "DELETE non-existent user should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "DELETE non-existent user returns 404"
}

# Test: PUT 404 for non-existent group
Write-Host "`n--- Test: PUT 404 for Non-Existent Group ---" -ForegroundColor Cyan
$putNonExistGroupBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="Ghost Group"} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/non-existent-id-12345" -Method PUT -Headers $headers -Body $putNonExistGroupBody | Out-Null
    Test-Result -Success $false -Message "PUT non-existent group should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "PUT non-existent group returns 404"
}

# Test: PATCH 404 for non-existent group
Write-Host "`n--- Test: PATCH 404 for Non-Existent Group ---" -ForegroundColor Cyan
$patchNonExistGroupBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "Ghost Group" })
} | ConvertTo-Json -Depth 3
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/non-existent-id-12345" -Method PATCH -Headers $headers -Body $patchNonExistGroupBody | Out-Null
    Test-Result -Success $false -Message "PATCH non-existent group should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "PATCH non-existent group returns 404"
}

# Test: DELETE 404 for non-existent group
Write-Host "`n--- Test: DELETE 404 for Non-Existent Group ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/non-existent-id-12345" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "DELETE non-existent group should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "DELETE non-existent group returns 404"
}

# Test: DELETE idempotent -- second delete returns 404
Write-Host "`n--- Test: DELETE Idempotent (Second Delete → 404) ---" -ForegroundColor Cyan
$idempDelGroupBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="Idempotent Delete Test"} | ConvertTo-Json
$idempDelGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $idempDelGroupBody
Invoke-RestMethod -Uri "$scimBase/Groups/$($idempDelGroup.id)" -Method DELETE -Headers $headers | Out-Null
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/$($idempDelGroup.id)" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Second DELETE should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "DELETE idempotent -- second delete returns 404"
}

# Test: Non-UUID ID returns 404 (not 500) -- UUID guard validation
Write-Host "`n--- Test: Non-UUID ID Returns 404 (UUID Guard) ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/not-a-uuid" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Non-UUID user ID should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Non-UUID user ID returns 404 (not 500)"
}
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/not-a-uuid" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "Non-UUID group ID should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "Non-UUID group ID returns 404 (not 500)"
}

# (Duplicate userName 409 already covered in Section 3b -- case-insensitive uniqueness)

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
$script:currentSection = "9b: RFC 7644 Compliance"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9b: RFC 7644 COMPLIANCE CHECKS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Location header on POST /Users (RFC 7644 S3.1)
Write-Host "`n--- Test: Location Header on POST /Users (RFC 7644 S3.1) ---" -ForegroundColor Cyan
$locUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="loc-header-test-$(Get-Random)@test.com";active=$true} | ConvertTo-Json
$locUserRaw = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $locUserBody
$locUserContent = if ($locUserRaw.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($locUserRaw.Content) } else { $locUserRaw.Content }
$locUserData = $locUserContent | ConvertFrom-Json
$locationHeader = $locUserRaw.Headers['Location']
$locationValue = if ($locationHeader -is [array]) { $locationHeader[0] } else { $locationHeader }
Test-Result -Success ($locUserRaw.StatusCode -eq 201) -Message "POST /Users returns 201 Created"
Test-Result -Success ($null -ne $locationValue -and $locationValue.Length -gt 0) -Message "POST /Users includes Location header"
Test-Result -Success ($locationValue -eq $locUserData.meta.location) -Message "Location header matches meta.location"

# Test: Location header on POST /Groups (RFC 7644 S3.1)
Write-Host "`n--- Test: Location Header on POST /Groups (RFC 7644 S3.1) ---" -ForegroundColor Cyan
$locGroupBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="Loc Header Test Group"} | ConvertTo-Json
$locGroupRaw = Invoke-WebRequest -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $locGroupBody
$locGroupContent = if ($locGroupRaw.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($locGroupRaw.Content) } else { $locGroupRaw.Content }
$locGroupData = $locGroupContent | ConvertFrom-Json
$groupLocationHeader = $locGroupRaw.Headers['Location']
$groupLocationValue = if ($groupLocationHeader -is [array]) { $groupLocationHeader[0] } else { $groupLocationHeader }
Test-Result -Success ($locGroupRaw.StatusCode -eq 201) -Message "POST /Groups returns 201 Created"
Test-Result -Success ($null -ne $groupLocationValue -and $groupLocationValue.Length -gt 0) -Message "POST /Groups includes Location header"
Test-Result -Success ($groupLocationValue -eq $locGroupData.meta.location) -Message "Location header matches meta.location"

# Test: Error response format (RFC 7644 S3.12)
Write-Host "`n--- Test: Error Response Format (RFC 7644 S3.12) ---" -ForegroundColor Cyan
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
# TEST SECTION 9c: POST /.search (RFC 7644 S3.4.3)
$script:currentSection = "9c: POST /.search"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9c: POST /.search (RFC 7644 S3.4.3)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: POST /Users/.search basic
Write-Host "`n--- Test: POST /Users/.search Basic ---" -ForegroundColor Cyan
$searchUserBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = 'userName eq "livetest-user@test.com"'
    startIndex = 1
    count = 10
} | ConvertTo-Json
$searchUserResult = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $searchUserBody
Test-Result -Success ($searchUserResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:ListResponse") -Message "POST /Users/.search returns ListResponse schema"
Test-Result -Success ($searchUserResult.totalResults -ge 1) -Message "POST /Users/.search finds user via filter"
Test-Result -Success ($null -ne $searchUserResult.startIndex) -Message "POST /Users/.search includes startIndex"
Test-Result -Success ($null -ne $searchUserResult.itemsPerPage) -Message "POST /Users/.search includes itemsPerPage"

# Test: POST /Users/.search returns 200 (not 201)
Write-Host "`n--- Test: POST /Users/.search Returns HTTP 200 ---" -ForegroundColor Cyan
$searchRaw = Invoke-WebRequest -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $searchUserBody
Test-Result -Success ($searchRaw.StatusCode -eq 200) -Message "POST /Users/.search returns HTTP 200 (not 201)"
$searchCt = $searchRaw.Headers['Content-Type']
$searchCtValue = if ($searchCt -is [array]) { $searchCt[0] } else { $searchCt }
Test-Result -Success ($searchCtValue -like "*scim+json*") -Message "POST /Users/.search Content-Type is application/scim+json"

# Test: POST /Users/.search with attributes projection
Write-Host "`n--- Test: POST /Users/.search with Attributes ---" -ForegroundColor Cyan
$searchAttrBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = 'userName eq "livetest-user@test.com"'
    startIndex = 1
    count = 10
    attributes = "userName,displayName"
} | ConvertTo-Json
$searchAttrResult = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $searchAttrBody
$firstResource = $searchAttrResult.Resources[0]
Test-Result -Success ($null -ne $firstResource.userName) -Message "POST /.search with attributes includes userName"
Test-Result -Success ($null -ne $firstResource.id) -Message "POST /.search always returns id (always-returned)"
Test-Result -Success ($null -ne $firstResource.schemas) -Message "POST /.search always returns schemas (always-returned)"
# emails should be excluded since we only asked for userName,displayName
Test-Result -Success ($null -eq $firstResource.emails) -Message "POST /.search with attributes excludes non-requested attrs (emails)"

# Test: POST /Users/.search with excludedAttributes
Write-Host "`n--- Test: POST /Users/.search with excludedAttributes ---" -ForegroundColor Cyan
$searchExclBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = 'userName eq "livetest-user@test.com"'
    excludedAttributes = "emails,phoneNumbers"
} | ConvertTo-Json
$searchExclResult = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $searchExclBody
$firstExclResource = $searchExclResult.Resources[0]
Test-Result -Success ($null -ne $firstExclResource.userName) -Message "POST /.search with excludedAttributes keeps userName"
Test-Result -Success ($null -eq $firstExclResource.emails) -Message "POST /.search with excludedAttributes removes emails"

# Test: POST /Users/.search without filter (list all)
Write-Host "`n--- Test: POST /Users/.search Without Filter ---" -ForegroundColor Cyan
$searchAllBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    startIndex = 1
    count = 5
} | ConvertTo-Json
$searchAllResult = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $searchAllBody
Test-Result -Success ($searchAllResult.totalResults -ge 1) -Message "POST /Users/.search without filter lists users"
Test-Result -Success ($searchAllResult.Resources.Count -le 5) -Message "POST /Users/.search respects count parameter"

# Test: POST /Groups/.search basic
Write-Host "`n--- Test: POST /Groups/.search Basic ---" -ForegroundColor Cyan
$searchGroupBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = 'displayName eq "Replaced Group Name"'
    startIndex = 1
    count = 10
} | ConvertTo-Json
$searchGroupResult = Invoke-RestMethod -Uri "$scimBase/Groups/.search" -Method POST -Headers $headers -Body $searchGroupBody
Test-Result -Success ($searchGroupResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:ListResponse") -Message "POST /Groups/.search returns ListResponse schema"
Test-Result -Success ($searchGroupResult.totalResults -ge 1) -Message "POST /Groups/.search finds group via filter"

# Test: POST /Groups/.search with excludedAttributes=members
Write-Host "`n--- Test: POST /Groups/.search with excludedAttributes ---" -ForegroundColor Cyan
$searchGroupExclBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    excludedAttributes = "members"
    startIndex = 1
    count = 50
} | ConvertTo-Json
$searchGroupExclResult = Invoke-RestMethod -Uri "$scimBase/Groups/.search" -Method POST -Headers $headers -Body $searchGroupExclBody
if ($searchGroupExclResult.Resources.Count -gt 0) {
    $firstGroupRes = $searchGroupExclResult.Resources[0]
    Test-Result -Success ($null -eq $firstGroupRes.members) -Message "POST /Groups/.search excludedAttributes removes members"
    Test-Result -Success ($null -ne $firstGroupRes.displayName) -Message "POST /Groups/.search excludedAttributes keeps displayName"
} else {
    Test-Result -Success $false -Message "POST /Groups/.search excludedAttributes returned empty list (groups were created -- this is a bug)"
}

# ============================================
# TEST SECTION 9d: ATTRIBUTE PROJECTION (RFC 7644 S3.4.2.5)
$script:currentSection = "9d: Attribute Projection"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9d: ATTRIBUTE PROJECTION (RFC 7644 S3.4.2.5)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: GET /Users?attributes=userName,displayName
Write-Host "`n--- Test: GET /Users with attributes Param ---" -ForegroundColor Cyan
$attrListResult = Invoke-RestMethod -Uri "$scimBase/Users?attributes=userName,displayName&count=5" -Method GET -Headers $headers
Test-Result -Success ($attrListResult.totalResults -ge 1) -Message "GET /Users?attributes works"
$firstAttrUser = $attrListResult.Resources[0]
Test-Result -Success ($null -ne $firstAttrUser.userName) -Message "attributes param includes userName"
Test-Result -Success ($null -ne $firstAttrUser.id) -Message "attributes param always returns id"
Test-Result -Success ($null -ne $firstAttrUser.schemas) -Message "attributes param always returns schemas"
Test-Result -Success ($null -eq $firstAttrUser.emails) -Message "attributes param excludes non-requested emails"
Test-Result -Success ($null -eq $firstAttrUser.active) -Message "attributes param excludes non-requested active"

# Test: GET /Users/:id?attributes=userName
Write-Host "`n--- Test: GET /Users/:id with attributes Param ---" -ForegroundColor Cyan
$attrGetResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId`?attributes=userName" -Method GET -Headers $headers
Test-Result -Success ($attrGetResult.userName -eq "livetest-user@test.com") -Message "GET User by ID with attributes includes userName"
Test-Result -Success ($null -ne $attrGetResult.id) -Message "GET User by ID with attributes always returns id"
Test-Result -Success ($null -ne $attrGetResult.meta) -Message "GET User by ID with attributes always returns meta"
Test-Result -Success ($null -eq $attrGetResult.displayName) -Message "GET User by ID with attributes excludes displayName"

# Test: GET /Users?excludedAttributes=emails,phoneNumbers
Write-Host "`n--- Test: GET /Users with excludedAttributes Param ---" -ForegroundColor Cyan
$exclListResult = Invoke-RestMethod -Uri "$scimBase/Users?excludedAttributes=emails,phoneNumbers&count=5" -Method GET -Headers $headers
$firstExclUser = $exclListResult.Resources[0]
Test-Result -Success ($null -ne $firstExclUser.userName) -Message "excludedAttributes keeps userName"
Test-Result -Success ($null -ne $firstExclUser.id) -Message "excludedAttributes always keeps id"
Test-Result -Success ($null -eq $firstExclUser.emails) -Message "excludedAttributes removes emails"
Test-Result -Success ($null -eq $firstExclUser.phoneNumbers) -Message "excludedAttributes removes phoneNumbers"

# Test: GET /Users/:id?excludedAttributes=name,emails
Write-Host "`n--- Test: GET /Users/:id with excludedAttributes ---" -ForegroundColor Cyan
$exclGetResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId`?excludedAttributes=name,emails" -Method GET -Headers $headers
Test-Result -Success ($null -ne $exclGetResult.userName) -Message "GET User excludedAttributes keeps userName"
Test-Result -Success ($null -eq $exclGetResult.name) -Message "GET User excludedAttributes removes name"
Test-Result -Success ($null -eq $exclGetResult.emails) -Message "GET User excludedAttributes removes emails"
Test-Result -Success ($null -ne $exclGetResult.id) -Message "GET User excludedAttributes always keeps id (never excluded)"
Test-Result -Success ($null -ne $exclGetResult.schemas) -Message "GET User excludedAttributes always keeps schemas (never excluded)"

# Test: GET /Groups?attributes=displayName
Write-Host "`n--- Test: GET /Groups with attributes Param ---" -ForegroundColor Cyan
$grpAttrResult = Invoke-RestMethod -Uri "$scimBase/Groups?attributes=displayName&count=5" -Method GET -Headers $headers
if ($grpAttrResult.Resources.Count -gt 0) {
    $firstAttrGroup = $grpAttrResult.Resources[0]
    Test-Result -Success ($null -ne $firstAttrGroup.displayName) -Message "GET /Groups attributes includes displayName"
    Test-Result -Success ($null -ne $firstAttrGroup.id) -Message "GET /Groups attributes always returns id"
    Test-Result -Success ($null -eq $firstAttrGroup.members) -Message "GET /Groups attributes excludes non-requested members"
} else {
    Test-Result -Success $false -Message "GET /Groups attributes returned empty list (groups were created -- this is a bug)"
}

# Test: GET /Groups/:id?excludedAttributes=members
Write-Host "`n--- Test: GET /Groups/:id with excludedAttributes ---" -ForegroundColor Cyan
$grpExclResult = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId`?excludedAttributes=members" -Method GET -Headers $headers
Test-Result -Success ($null -ne $grpExclResult.displayName) -Message "GET Group excludedAttributes keeps displayName"
Test-Result -Success ($null -eq $grpExclResult.members) -Message "GET Group excludedAttributes removes members"

# Test: Precedence -- attributes wins over excludedAttributes (RFC 7644 S3.4.2.5)
Write-Host "`n--- Test: attributes Precedence Over excludedAttributes ---" -ForegroundColor Cyan
$precedenceResult = Invoke-RestMethod -Uri "$scimBase/Users?attributes=userName,displayName&excludedAttributes=displayName&count=1" -Method GET -Headers $headers
$firstPrecedence = $precedenceResult.Resources[0]
Test-Result -Success ($null -ne $firstPrecedence.userName) -Message "Precedence test: attributes includes userName"
Test-Result -Success ($null -ne $firstPrecedence.displayName) -Message "Precedence test: attributes wins -- displayName included despite excludedAttributes"

# ============================================
# TEST SECTION 9e: ETag & CONDITIONAL REQUESTS (RFC 7644 S3.14)
$script:currentSection = "9e: ETag & Conditional"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9e: ETag & CONDITIONAL REQUESTS (RFC 7644 S3.14)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: ETag header present on GET /Users/:id
Write-Host "`n--- Test: ETag Header on GET /Users/:id ---" -ForegroundColor Cyan
$etagUserRaw = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method GET -Headers $headers
$etagHeader = $etagUserRaw.Headers['ETag']
$etagValue = if ($etagHeader -is [array]) { $etagHeader[0] } else { $etagHeader }
Test-Result -Success ($null -ne $etagValue -and $etagValue.Length -gt 0) -Message "GET /Users/:id includes ETag header"
Test-Result -Success ($etagValue -like 'W/"*"') -Message "ETag is a weak ETag (W/`"...`") format: $etagValue"

# Test: meta.version matches ETag header
$etagUserContent = if ($etagUserRaw.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($etagUserRaw.Content) } else { $etagUserRaw.Content }
$etagUserData = $etagUserContent | ConvertFrom-Json
Test-Result -Success ($etagUserData.meta.version -eq $etagValue) -Message "meta.version matches ETag header value"

# Test: ETag header present on GET /Groups/:id
Write-Host "`n--- Test: ETag Header on GET /Groups/:id ---" -ForegroundColor Cyan
$etagGroupRaw = Invoke-WebRequest -Uri "$scimBase/Groups/$GroupId" -Method GET -Headers $headers
$etagGroupHeader = $etagGroupRaw.Headers['ETag']
$etagGroupValue = if ($etagGroupHeader -is [array]) { $etagGroupHeader[0] } else { $etagGroupHeader }
Test-Result -Success ($null -ne $etagGroupValue -and $etagGroupValue.Length -gt 0) -Message "GET /Groups/:id includes ETag header"
Test-Result -Success ($etagGroupValue -like 'W/"*"') -Message "Group ETag is weak ETag format"

# Test: If-None-Match → 304 Not Modified (conditional GET)
Write-Host "`n--- Test: If-None-Match → 304 Not Modified ---" -ForegroundColor Cyan
$conditionalHeaders = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'; 'If-None-Match'=$etagValue}
$conditionalRaw = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method GET -Headers $conditionalHeaders -SkipHttpErrorCheck
Test-Result -Success ($conditionalRaw.StatusCode -eq 304) -Message "If-None-Match with matching ETag returns 304 Not Modified"

# Test: If-None-Match with stale ETag → 200 (full resource)
Write-Host "`n--- Test: If-None-Match with Stale ETag → 200 ---" -ForegroundColor Cyan
$staleHeaders = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'; 'If-None-Match'='W/"stale-timestamp"'}
$staleRaw = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method GET -Headers $staleHeaders
Test-Result -Success ($staleRaw.StatusCode -eq 200) -Message "If-None-Match with stale ETag returns 200 with full resource"

# Test: ETag changes after PATCH
Write-Host "`n--- Test: ETag Changes After PATCH ---" -ForegroundColor Cyan
$etagBeforePatch = $etagValue
Start-Sleep -Milliseconds 200
$etagPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "ETag Changed User" })
} | ConvertTo-Json -Depth 3
$etagPatchRaw = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $etagPatchBody
$etagAfterPatch = if ($etagPatchRaw.Headers['ETag'] -is [array]) { $etagPatchRaw.Headers['ETag'][0] } else { $etagPatchRaw.Headers['ETag'] }
Test-Result -Success ($null -ne $etagAfterPatch) -Message "PATCH response includes ETag header"
Test-Result -Success ($etagAfterPatch -ne $etagBeforePatch) -Message "ETag changed after PATCH (before: $etagBeforePatch, after: $etagAfterPatch)"

# Test: Previous If-None-Match with old ETag now returns 200
Write-Host "`n--- Test: Old ETag After Modification → 200 ---" -ForegroundColor Cyan
$oldEtagHeaders = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'; 'If-None-Match'=$etagBeforePatch}
$oldEtagRaw = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method GET -Headers $oldEtagHeaders
Test-Result -Success ($oldEtagRaw.StatusCode -eq 200) -Message "Old ETag after modification returns 200 (resource changed)"

# Test: POST /Users response includes ETag header
Write-Host "`n--- Test: POST /Users Includes ETag ---" -ForegroundColor Cyan
$etagCreateBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="etag-create-$(Get-Random)@test.com";active=$true} | ConvertTo-Json
$etagCreateRaw = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $etagCreateBody
$etagCreateValue = if ($etagCreateRaw.Headers['ETag'] -is [array]) { $etagCreateRaw.Headers['ETag'][0] } else { $etagCreateRaw.Headers['ETag'] }
Test-Result -Success ($null -ne $etagCreateValue) -Message "POST /Users response includes ETag header"
Test-Result -Success ($etagCreateRaw.StatusCode -eq 201) -Message "POST /Users returns 201 with ETag"

# Test: PUT /Users response includes ETag header
Write-Host "`n--- Test: PUT /Users Includes ETag ---" -ForegroundColor Cyan
$etagPutBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="livetest-user@test.com";displayName="Put ETag Test";active=$true} | ConvertTo-Json
$etagPutRaw = Invoke-WebRequest -Uri "$scimBase/Users/$UserId" -Method PUT -Headers $headers -Body $etagPutBody
$etagPutValue = if ($etagPutRaw.Headers['ETag'] -is [array]) { $etagPutRaw.Headers['ETag'][0] } else { $etagPutRaw.Headers['ETag'] }
Test-Result -Success ($null -ne $etagPutValue) -Message "PUT /Users response includes ETag header"

# Test: ServiceProviderConfig includes etag.supported=true
Write-Host "`n--- Test: ServiceProviderConfig etag.supported ---" -ForegroundColor Cyan
$spcEtag = Invoke-RestMethod -Uri "$scimBase/ServiceProviderConfig" -Method GET -Headers $headers
Test-Result -Success ($spcEtag.etag.supported -eq $true) -Message "ServiceProviderConfig etag.supported = true"

# ============================================
# TEST SECTION 9f: PatchOpAllowRemoveAllMembers FLAG
$script:currentSection = "9f: RemoveAllMembers"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9f: PatchOpAllowRemoveAllMembers FLAG" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create endpoint with PatchOpAllowRemoveAllMembers=False
Write-Host "`n--- Setup: Endpoint with PatchOpAllowRemoveAllMembers=False ---" -ForegroundColor Cyan
$noRemoveAllBody = @{
    name = "live-test-noremoveall-$(Get-Random)"
    displayName = "No Remove All Endpoint"
    config = @{ PatchOpAllowRemoveAllMembers = "False" }
} | ConvertTo-Json
$noRemoveAllEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $noRemoveAllBody
$NoRemoveAllEndpointId = $noRemoveAllEndpoint.id
$scimBaseNoRemoveAll = "$baseUrl/scim/endpoints/$NoRemoveAllEndpointId"

# Create users and group in the no-remove-all endpoint
$nraUser1 = Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Users" -Method POST -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="nra-user1@test.com";active=$true} | ConvertTo-Json)
$nraUser2 = Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Users" -Method POST -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="nra-user2@test.com";active=$true} | ConvertTo-Json)
$nraGroup = Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Groups" -Method POST -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="NRA Test Group"} | ConvertTo-Json)
$NRAGroupId = $nraGroup.id

# Add members individually
Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Groups/$NRAGroupId" -Method PATCH -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp");Operations=@(@{op="add";path="members";value=@(@{value=$nraUser1.id})})} | ConvertTo-Json -Depth 5) | Out-Null
Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Groups/$NRAGroupId" -Method PATCH -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp");Operations=@(@{op="add";path="members";value=@(@{value=$nraUser2.id})})} | ConvertTo-Json -Depth 5) | Out-Null

# Test: Blanket remove (path=members, no value) → 400 when flag=False
Write-Host "`n--- Test: Blanket Remove All Members Blocked (Flag=False) ---" -ForegroundColor Cyan
$blanketRemoveBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "members" })
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Groups/$NRAGroupId" -Method PATCH -Headers $headers -Body $blanketRemoveBody | Out-Null
    Test-Result -Success $false -Message "Blanket remove all members should fail when flag=False"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Blanket remove all members blocked with 400 when PatchOpAllowRemoveAllMembers=False"
}

# Verify members still intact
$nraGroupAfterBlock = Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Groups/$NRAGroupId" -Method GET -Headers $headers
$nraMembersAfterBlock = if ($nraGroupAfterBlock.members) { @($nraGroupAfterBlock.members).Count } else { 0 }
Test-Result -Success ($nraMembersAfterBlock -eq 2) -Message "Members still intact after blocked blanket remove ($nraMembersAfterBlock members)"

# Test: Targeted remove (members[value eq "..."]) still works when flag=False
Write-Host "`n--- Test: Targeted Remove Still Works (Flag=False) ---" -ForegroundColor Cyan
$targetedRemoveBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "members[value eq `"$($nraUser1.id)`"]" })
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Groups/$NRAGroupId" -Method PATCH -Headers $headers -Body $targetedRemoveBody | Out-Null
    $nraGroupAfterTargeted = Invoke-RestMethod -Uri "$scimBaseNoRemoveAll/Groups/$NRAGroupId" -Method GET -Headers $headers
    $nraMembersAfterTargeted = if ($nraGroupAfterTargeted.members) { @($nraGroupAfterTargeted.members).Count } else { 0 }
    Test-Result -Success ($nraMembersAfterTargeted -eq 1) -Message "Targeted remove with filter works when flag=False ($nraMembersAfterTargeted member left)"
} catch {
    Test-Result -Success $false -Message "Targeted remove should succeed even when PatchOpAllowRemoveAllMembers=False"
}

# Test: Default behavior (flag not set → allows blanket remove)
Write-Host "`n--- Test: Default Behavior (Flag Not Set → Allow Blanket Remove) ---" -ForegroundColor Cyan
# Use the main endpoint which does NOT have PatchOpAllowRemoveAllMembers set (defaults to true)
# Add members to main group first
$defUser1Body = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="def-remove-user1@test.com";active=$true} | ConvertTo-Json
$defUser1 = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $defUser1Body
$defGroupBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="Default Remove Test Group"} | ConvertTo-Json
$defGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $defGroupBody
$DefGroupId = $defGroup.id
Invoke-RestMethod -Uri "$scimBase/Groups/$DefGroupId" -Method PATCH -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp");Operations=@(@{op="add";path="members";value=@(@{value=$defUser1.id})})} | ConvertTo-Json -Depth 5) | Out-Null

# Blanket remove should succeed (default = allow)
$defBlanketBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "members" })
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/$DefGroupId" -Method PATCH -Headers $headers -Body $defBlanketBody | Out-Null
    $defGroupAfter = Invoke-RestMethod -Uri "$scimBase/Groups/$DefGroupId" -Method GET -Headers $headers
    $defMembersAfter = if ($defGroupAfter.members) { @($defGroupAfter.members).Count } else { 0 }
    Test-Result -Success ($defMembersAfter -eq 0) -Message "Blanket remove allowed by default (PatchOpAllowRemoveAllMembers defaults to true)"
} catch {
    Test-Result -Success $false -Message "Blanket remove should succeed when flag not set (defaults to true)"
}

# ============================================
# TEST SECTION 9g: FILTER OPERATORS (co, sw, pr, and)
$script:currentSection = "9g: Filter Operators"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9g: FILTER OPERATORS (co, sw, pr, and)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: contains (co) operator
Write-Host "`n--- Test: Filter 'co' (contains) Operator ---" -ForegroundColor Cyan
$coResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName co `"livetest`"" -Method GET -Headers $headers
Test-Result -Success ($coResult.totalResults -ge 1) -Message "Filter 'co' (contains) finds users with 'livetest' in userName (found $($coResult.totalResults))"

# Test: co is case-insensitive
$coCiResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName co `"LIVETEST`"" -Method GET -Headers $headers
Test-Result -Success ($coCiResult.totalResults -ge 1) -Message "Filter 'co' is case-insensitive (LIVETEST finds same users)"

# Test: startsWith (sw) operator
Write-Host "`n--- Test: Filter 'sw' (startsWith) Operator ---" -ForegroundColor Cyan
$swResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName sw `"pagination`"" -Method GET -Headers $headers
Test-Result -Success ($swResult.totalResults -ge 1) -Message "Filter 'sw' (startsWith) finds users starting with 'pagination' (found $($swResult.totalResults))"

# Test: sw with no match
$swNoMatch = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName sw `"zzz-nonexistent`"" -Method GET -Headers $headers
Test-Result -Success ($swNoMatch.totalResults -eq 0) -Message "Filter 'sw' returns 0 results for non-matching prefix"

# Test: presence (pr) operator
Write-Host "`n--- Test: Filter 'pr' (presence) Operator ---" -ForegroundColor Cyan
$prResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=externalId pr" -Method GET -Headers $headers
Test-Result -Success ($prResult.totalResults -ge 1) -Message "Filter 'pr' (presence) finds users with externalId present (found $($prResult.totalResults))"

# Test: pr on attribute that some users lack
$prDisplayResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=displayName pr" -Method GET -Headers $headers
Test-Result -Success ($prDisplayResult.totalResults -ge 1) -Message "Filter 'pr' on displayName finds users with displayName present"

# Test: compound 'and' filter
Write-Host "`n--- Test: Compound 'and' Filter ---" -ForegroundColor Cyan
$andResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName sw `"pagination`" and active eq true" -Method GET -Headers $headers
Test-Result -Success ($andResult.totalResults -ge 1) -Message "Compound 'and' filter works (userName sw + active eq true, found $($andResult.totalResults))"

# Test: compound 'and' filter with no matches
$andNoMatch = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName eq `"livetest-user@test.com`" and active eq false" -Method GET -Headers $headers
Test-Result -Success ($andNoMatch.totalResults -eq 0) -Message "Compound 'and' filter returns 0 when second condition fails (active=false)"

# Test: Group displayName filter with co
Write-Host "`n--- Test: Group displayName Filter with 'co' ---" -ForegroundColor Cyan
$groupCoResult = Invoke-RestMethod -Uri "$scimBase/Groups?filter=displayName co `"Test`"" -Method GET -Headers $headers
Test-Result -Success ($groupCoResult.totalResults -ge 1) -Message "Group displayName 'co' filter finds groups containing 'Test' (found $($groupCoResult.totalResults))"

# ============================================
# TEST SECTION 9h: EDGE CASES
$script:currentSection = "9h: Edge Cases"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9h: EDGE CASES" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Empty Operations array (should succeed as no-op)
Write-Host "`n--- Test: PATCH with Empty Operations Array ---" -ForegroundColor Cyan
$emptyOpsBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @()
} | ConvertTo-Json -Depth 3
try {
    $emptyOpsUser = Invoke-RestMethod -Uri "$scimBase/Users/$($defUser1.id)" -Method PATCH -Headers $headers -Body $emptyOpsBody
    Test-Result -Success ($null -ne $emptyOpsUser.id) -Message "PATCH with empty Operations array returns resource (no-op)"
} catch {
    # Some implementations reject empty ops -- either way, it shouldn't crash
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 400) -Message "PATCH with empty Operations array returns 400 (strict validation)"
}

# Test: Remove on non-existent attribute (should succeed silently)
Write-Host "`n--- Test: Remove Non-Existent Attribute (Silent Success) ---" -ForegroundColor Cyan
$removeNonExistBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "nickName" })
} | ConvertTo-Json -Depth 3
try {
    $removeNonExistResult = Invoke-RestMethod -Uri "$scimBase/Users/$($defUser1.id)" -Method PATCH -Headers $headers -Body $removeNonExistBody
    Test-Result -Success ($null -ne $removeNonExistResult.id) -Message "Remove non-existent attribute (nickName) succeeds silently"
} catch {
    Test-Result -Success $false -Message "Remove non-existent attribute should not error"
}

# Test: PATCH with 'add' op and no path (Entra-style merge)
Write-Host "`n--- Test: PATCH 'add' with No Path (Merge) ---" -ForegroundColor Cyan
$addNoPathBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        value = @{ displayName = "Add-No-Path Merged"; title = "Tester" }
    })
} | ConvertTo-Json -Depth 4
$addNoPathResult = Invoke-RestMethod -Uri "$scimBase/Users/$($defUser1.id)" -Method PATCH -Headers $headers -Body $addNoPathBody
Test-Result -Success ($addNoPathResult.displayName -eq "Add-No-Path Merged") -Message "PATCH 'add' with no path merges displayName"
Test-Result -Success ($addNoPathResult.title -eq "Tester") -Message "PATCH 'add' with no path merges title"

# Test: Filter on non-existent attribute returns empty
Write-Host "`n--- Test: Filter on Non-Existent Attribute ---" -ForegroundColor Cyan
$noAttrFilter = Invoke-RestMethod -Uri "$scimBase/Users?filter=nickName eq `"test`"" -Method GET -Headers $headers
Test-Result -Success ($noAttrFilter.totalResults -eq 0) -Message "Filter on non-existent attribute value returns 0 results"

# Test: ServiceProviderConfig detailed field validation
Write-Host "`n--- Test: ServiceProviderConfig Detail Validation ---" -ForegroundColor Cyan
$spcDetail = Invoke-RestMethod -Uri "$scimBase/ServiceProviderConfig" -Method GET -Headers $headers
Test-Result -Success ($null -ne $spcDetail.patch) -Message "ServiceProviderConfig includes patch capability"
Test-Result -Success ($spcDetail.patch.supported -eq $true) -Message "ServiceProviderConfig patch.supported = true"
Test-Result -Success ($null -ne $spcDetail.filter) -Message "ServiceProviderConfig includes filter capability"
Test-Result -Success ($spcDetail.filter.supported -eq $true) -Message "ServiceProviderConfig filter.supported = true"
Test-Result -Success ($null -ne $spcDetail.bulk) -Message "ServiceProviderConfig includes bulk capability"
Test-Result -Success ($null -ne $spcDetail.changePassword) -Message "ServiceProviderConfig includes changePassword capability"
Test-Result -Success ($null -ne $spcDetail.sort) -Message "ServiceProviderConfig includes sort capability"

# ============================================
# TEST SECTION 9i: VerbosePatchSupported DOT-NOTATION
$script:currentSection = "9i: Verbose Patch Dot-Notation"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9i: VerbosePatchSupported DOT-NOTATION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create endpoint with VerbosePatchSupported=True
Write-Host "`n--- Setup: Endpoint with VerbosePatchSupported=True ---" -ForegroundColor Cyan
$vpEndpointBody = @{
    name = "live-test-verbose-patch-$(Get-Random)"
    displayName = "Verbose Patch Endpoint"
    config = @{ VerbosePatchSupported = $true }
} | ConvertTo-Json
$vpEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $vpEndpointBody
$VPEndpointId = $vpEndpoint.id
$scimBaseVP = "$baseUrl/scim/endpoints/$VPEndpointId"

# Create user in verbose-patch endpoint
$vpUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "vp-user@test.com"
    displayName = "VP Test User"
    name = @{ givenName = "VPGiven"; familyName = "VPFamily" }
    active = $true
} | ConvertTo-Json -Depth 3
$vpUser = Invoke-RestMethod -Uri "$scimBaseVP/Users" -Method POST -Headers $headers -Body $vpUserBody
$VPUserId = $vpUser.id

# Test: PATCH with dot-notation path (name.givenName) resolves to nested object
Write-Host "`n--- Test: Dot-Notation PATCH (name.givenName) ---" -ForegroundColor Cyan
$dotPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "name.givenName"; value = "DotUpdated" })
} | ConvertTo-Json -Depth 4
$dotPatchResult = Invoke-RestMethod -Uri "$scimBaseVP/Users/$VPUserId" -Method PATCH -Headers $headers -Body $dotPatchBody
Test-Result -Success ($dotPatchResult.name.givenName -eq "DotUpdated") -Message "Dot-notation PATCH name.givenName resolves to nested object"

# Verify familyName unchanged
Test-Result -Success ($dotPatchResult.name.familyName -eq "VPFamily") -Message "Dot-notation PATCH does not affect sibling property (familyName unchanged)"

# Test: PATCH with dot-notation 'add' op
Write-Host "`n--- Test: Dot-Notation PATCH 'add' (name.middleName) ---" -ForegroundColor Cyan
$dotAddBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "add"; path = "name.middleName"; value = "DotMiddle" })
} | ConvertTo-Json -Depth 4
$dotAddResult = Invoke-RestMethod -Uri "$scimBaseVP/Users/$VPUserId" -Method PATCH -Headers $headers -Body $dotAddBody
Test-Result -Success ($dotAddResult.name.middleName -eq "DotMiddle") -Message "Dot-notation 'add' sets name.middleName in nested object"

# Test: PATCH with dot-notation 'remove' op
Write-Host "`n--- Test: Dot-Notation PATCH 'remove' (name.middleName) ---" -ForegroundColor Cyan
$dotRemoveBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "name.middleName" })
} | ConvertTo-Json -Depth 4
$dotRemoveResult = Invoke-RestMethod -Uri "$scimBaseVP/Users/$VPUserId" -Method PATCH -Headers $headers -Body $dotRemoveBody
$middleGone = ($null -eq $dotRemoveResult.name.middleName) -or ($dotRemoveResult.name.middleName -eq "")
Test-Result -Success $middleGone -Message "Dot-notation 'remove' deletes name.middleName from nested object"

# Test: Without VerbosePatchSupported, known SCIM complex attribute paths still resolve
Write-Host "`n--- Test: Known SCIM Complex Attribute Paths Work Without Flag ---" -ForegroundColor Cyan
# Use main endpoint (no VerbosePatchSupported flag)
# name.givenName is a standard SCIM complex attribute -- the server resolves it to nested
# regardless of VerbosePatchSupported (that flag is for non-standard custom dot-notation)
$flatDotBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "name.givenName"; value = "FlatValue" })
} | ConvertTo-Json -Depth 4
$flatDotResult = Invoke-RestMethod -Uri "$scimBase/Users/$($defUser1.id)" -Method PATCH -Headers $headers -Body $flatDotBody
Test-Result -Success ($flatDotResult.name.givenName -eq "FlatValue") -Message "Standard SCIM complex attribute paths (name.givenName) work without VerbosePatchSupported"

# ============================================
# TEST SECTION 9j: LOG CONFIGURATION API
$script:currentSection = "9j: Log Configuration"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9j: LOG CONFIGURATION API" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- GET /admin/log-config ---
Write-Host "`n--- Test: Get Log Configuration ---" -ForegroundColor Cyan
$logConfig = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
Test-Result -Success ($null -ne $logConfig.globalLevel) -Message "GET log-config returns globalLevel"
Test-Result -Success ($null -ne $logConfig.availableLevels) -Message "GET log-config returns availableLevels"
Test-Result -Success ($logConfig.availableLevels.Count -eq 7) -Message "availableLevels has 7 entries (TRACE..OFF)"
Test-Result -Success ($null -ne $logConfig.availableCategories) -Message "GET log-config returns availableCategories"
Test-Result -Success ($logConfig.availableCategories.Count -eq 12) -Message "availableCategories has 12 entries"
Test-Result -Success ($null -ne $logConfig.format) -Message "GET log-config returns format"
Test-Result -Success ($null -ne $logConfig.categoryLevels) -Message "GET log-config returns categoryLevels"
Test-Result -Success ($null -ne $logConfig.endpointLevels) -Message "GET log-config returns endpointLevels"

# Save original level for restoration
$originalLevel = $logConfig.globalLevel

# --- PUT /admin/log-config (partial update) ---
Write-Host "`n--- Test: Update Log Configuration ---" -ForegroundColor Cyan
$updateBody = @{ globalLevel = "WARN"; includePayloads = $false } | ConvertTo-Json
$updateResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method PUT -Headers $headers -Body $updateBody
Test-Result -Success ($updateResult.message -eq "Log configuration updated") -Message "PUT log-config returns success message"
Test-Result -Success ($updateResult.config.globalLevel -eq "WARN") -Message "PUT log-config updates globalLevel to WARN"
Test-Result -Success ($updateResult.config.includePayloads -eq $false) -Message "PUT log-config updates includePayloads to false"

# --- PUT /admin/log-config (multi-field update with categoryLevels) ---
Write-Host "`n--- Test: Update Multiple Config Fields ---" -ForegroundColor Cyan
$multiUpdateBody = @{
    globalLevel = "DEBUG"
    format = "json"
    categoryLevels = @{ "scim.patch" = "TRACE"; "auth" = "WARN" }
} | ConvertTo-Json -Depth 3
$multiResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method PUT -Headers $headers -Body $multiUpdateBody
Test-Result -Success ($multiResult.config.globalLevel -eq "DEBUG") -Message "Multi-update sets globalLevel to DEBUG"
Test-Result -Success ($multiResult.config.format -eq "json") -Message "Multi-update sets format to json"
Test-Result -Success ($multiResult.config.categoryLevels.'scim.patch' -eq "TRACE") -Message "Multi-update sets scim.patch category to TRACE"
Test-Result -Success ($multiResult.config.categoryLevels.'auth' -eq "WARN") -Message "Multi-update sets auth category to WARN"

# --- PUT /admin/log-config/level/:level (shortcut) ---
Write-Host "`n--- Test: Set Global Level Shortcut ---" -ForegroundColor Cyan
$levelResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/level/ERROR" -Method PUT -Headers $headers
Test-Result -Success ($levelResult.globalLevel -eq "ERROR") -Message "Level shortcut sets global level to ERROR"
Test-Result -Success ($levelResult.message -like "*ERROR*") -Message "Level shortcut returns confirmation message"

# Case-insensitive level names
$levelCaseResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/level/trace" -Method PUT -Headers $headers
Test-Result -Success ($levelCaseResult.globalLevel -eq "TRACE") -Message "Level shortcut accepts case-insensitive level names"

# --- PUT /admin/log-config/category/:category/:level ---
Write-Host "`n--- Test: Set Category Log Level ---" -ForegroundColor Cyan
$catResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/category/http/TRACE" -Method PUT -Headers $headers
Test-Result -Success ($catResult.message -like "*http*TRACE*") -Message "Category level set for 'http' to TRACE"

# Verify reflected in GET
$configAfterCat = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
Test-Result -Success ($configAfterCat.categoryLevels.'http' -eq "TRACE") -Message "Category override reflected in GET config"

# Unknown category
$badCatResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/category/nonexistent/DEBUG" -Method PUT -Headers $headers
Test-Result -Success ($badCatResult.error -like "*Unknown category*") -Message "Unknown category returns error message"
Test-Result -Success ($badCatResult.availableCategories.Count -eq 12) -Message "Unknown category response includes available categories"

# --- PUT/DELETE endpoint level overrides ---
Write-Host "`n--- Test: Endpoint Level Override ---" -ForegroundColor Cyan
$epOverrideResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/endpoint/$EndpointId/TRACE" -Method PUT -Headers $headers
Test-Result -Success ($epOverrideResult.message -like "*$EndpointId*TRACE*") -Message "Endpoint level override set"

# Verify reflected in GET
$configAfterEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
Test-Result -Success ($configAfterEp.endpointLevels.$EndpointId -eq "TRACE") -Message "Endpoint override reflected in GET config"

# DELETE endpoint override
$deleteEpResponse = Microsoft.PowerShell.Utility\Invoke-WebRequest -Uri "$baseUrl/scim/admin/log-config/endpoint/$EndpointId" -Method DELETE -Headers $headers
Test-Result -Success ($deleteEpResponse.StatusCode -eq 204) -Message "DELETE endpoint override returns 204"

# Verify removed
$configAfterDelete = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$epGone = ($null -eq $configAfterDelete.endpointLevels.$EndpointId)
Test-Result -Success $epGone -Message "Endpoint override removed after DELETE"

# --- Ring Buffer: GET /admin/log-config/recent ---
Write-Host "`n--- Test: Recent Logs (Ring Buffer) ---" -ForegroundColor Cyan
$recentResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent" -Method GET -Headers $headers
Test-Result -Success ($null -ne $recentResult.count) -Message "Recent logs returns count"
Test-Result -Success ($null -ne $recentResult.entries) -Message "Recent logs returns entries array"
Test-Result -Success ($recentResult.count -gt 0) -Message "Ring buffer has entries from previous test operations"

# Limit
$limitResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?limit=3" -Method GET -Headers $headers
Test-Result -Success ($limitResult.entries.Count -le 3) -Message "Recent logs respects limit=3"

# Filter by level
$levelFilter = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?level=ERROR" -Method GET -Headers $headers
$allError = $true
if ($null -eq $levelFilter.entries -or $levelFilter.entries.Count -eq 0) {
    # No ERROR+ entries -- still valid (no errors occurred), but note it's vacuous
    $allError = $true
    Write-Host "  [INFO] No ERROR-level entries in buffer -- level filter is vacuously true" -ForegroundColor Gray
} else {
    foreach ($entry in $levelFilter.entries) {
        if ($entry.level -notin @("ERROR", "FATAL")) { $allError = $false; break }
    }
}
Test-Result -Success $allError -Message "Recent logs level filter returns only ERROR+ entries (count: $($levelFilter.entries.Count))"

# Filter by category
$catFilter = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?category=http" -Method GET -Headers $headers
$allHttp = $true
$catCount = 0
if ($null -ne $catFilter.entries) { $catCount = $catFilter.entries.Count }
if ($catCount -eq 0) {
    $allHttp = $false  # Must find http entries -- previous requests generate them
} else {
    foreach ($entry in $catFilter.entries) {
        if ($entry.category -ne "http") { $allHttp = $false; break }
    }
}
Test-Result -Success $allHttp -Message "Recent logs category filter returns only 'http' entries (count: $catCount)"

# --- DELETE /admin/log-config/recent (clear ring buffer) ---
Write-Host "`n--- Test: Clear Ring Buffer ---" -ForegroundColor Cyan
$clearResponse = Microsoft.PowerShell.Utility\Invoke-WebRequest -Uri "$baseUrl/scim/admin/log-config/recent" -Method DELETE -Headers $headers
Test-Result -Success ($clearResponse.StatusCode -eq 204) -Message "DELETE recent logs returns 204"

$afterClear = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent" -Method GET -Headers $headers
Test-Result -Success ($afterClear.count -le 5) -Message "Ring buffer nearly empty after clear (only self-request entries)"

# --- X-Request-Id correlation ---
Write-Host "`n--- Test: X-Request-Id Correlation ---" -ForegroundColor Cyan
$customRequestId = "live-test-correlation-$(Get-Random)"
$correlationHeaders = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json'; 'X-Request-Id' = $customRequestId }
$correlationResponse = Microsoft.PowerShell.Utility\Invoke-WebRequest -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $correlationHeaders
$returnedRequestId = if ($correlationResponse.Headers['X-Request-Id'] -is [array]) { $correlationResponse.Headers['X-Request-Id'][0] } else { $correlationResponse.Headers['X-Request-Id'] }
Test-Result -Success ($returnedRequestId -eq $customRequestId) -Message "X-Request-Id echoed back in response: $customRequestId"

# Verify auto-generated when none provided
$noIdHeaders = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }
$autoIdResponse = Microsoft.PowerShell.Utility\Invoke-WebRequest -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $noIdHeaders
$autoRequestId = if ($autoIdResponse.Headers['X-Request-Id'] -is [array]) { $autoIdResponse.Headers['X-Request-Id'][0] } else { $autoIdResponse.Headers['X-Request-Id'] }
Test-Result -Success ($null -ne $autoRequestId -and $autoRequestId.Length -gt 10) -Message "X-Request-Id auto-generated when not provided: $autoRequestId"

# --- Filter recent logs by requestId ---
Write-Host "`n--- Test: Filter Recent Logs by Request ID ---" -ForegroundColor Cyan
$byRequestId = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?requestId=$customRequestId" -Method GET -Headers $headers
$allMatchRequestId = $true
$reqIdCount = 0
if ($null -ne $byRequestId.entries) { $reqIdCount = $byRequestId.entries.Count }
if ($reqIdCount -eq 0) {
    $allMatchRequestId = $false  # We just sent a request with this ID -- must find entries
} else {
    foreach ($entry in $byRequestId.entries) {
        if ($entry.requestId -ne $customRequestId) { $allMatchRequestId = $false; break }
    }
}
Test-Result -Success $allMatchRequestId -Message "Recent logs requestId filter returns matching entries (count: $reqIdCount)"

# --- Download logs: GET /admin/log-config/download ---
Write-Host "`n--- Test: Download Logs (NDJSON/JSON) ---" -ForegroundColor Cyan

$downloadNdjson = Microsoft.PowerShell.Utility\Invoke-WebRequest -Uri "$baseUrl/scim/admin/log-config/download?format=ndjson&limit=10" -Method GET -Headers $headers
$downloadNdjsonContentType = if ($downloadNdjson.Headers['Content-Type'] -is [array]) { $downloadNdjson.Headers['Content-Type'][0] } else { $downloadNdjson.Headers['Content-Type'] }
$downloadNdjsonDisposition = if ($downloadNdjson.Headers['Content-Disposition'] -is [array]) { $downloadNdjson.Headers['Content-Disposition'][0] } else { $downloadNdjson.Headers['Content-Disposition'] }
$downloadNdjsonContent = if ($downloadNdjson.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($downloadNdjson.Content) } else { [string]$downloadNdjson.Content }

Test-Result -Success ($downloadNdjsonContentType -like "*application/x-ndjson*") -Message "Download NDJSON returns application/x-ndjson content type"
Test-Result -Success ($downloadNdjsonDisposition -like "*scimserver-logs-*") -Message "Download NDJSON returns attachment filename header"

$ndjsonLines = @($downloadNdjsonContent -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
Test-Result -Success ($ndjsonLines.Count -gt 0) -Message "Download NDJSON returns at least one log line"

$isValidNdjson = $false
foreach ($line in $ndjsonLines) {
    try {
        $parsedNdjson = $line | ConvertFrom-Json
        if (($null -ne $parsedNdjson.timestamp) -and ($null -ne $parsedNdjson.level)) {
            $isValidNdjson = $true
            break
        }
    } catch {
        continue
    }
}
Test-Result -Success $isValidNdjson -Message "Download NDJSON contains valid JSON log entries"

$downloadJson = Microsoft.PowerShell.Utility\Invoke-WebRequest -Uri "$baseUrl/scim/admin/log-config/download?format=json&limit=10" -Method GET -Headers $headers
$downloadJsonContentType = if ($downloadJson.Headers['Content-Type'] -is [array]) { $downloadJson.Headers['Content-Type'][0] } else { $downloadJson.Headers['Content-Type'] }
Test-Result -Success ($downloadJsonContentType -like "*application/json*") -Message "Download JSON returns application/json content type"

try {
    $downloadJsonContent = if ($downloadJson.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($downloadJson.Content) } else { [string]$downloadJson.Content }
    $downloadJsonBody = $downloadJsonContent | ConvertFrom-Json
    $isJsonArray = $downloadJsonBody -is [System.Array]
} catch {
    $isJsonArray = $false
}
Test-Result -Success $isJsonArray -Message "Download JSON returns a JSON array"

$downloadByRequest = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/download?format=json&requestId=$customRequestId" -Method GET -Headers $headers
$downloadRequestMatches = $true
$dlReqCount = 0
if ($downloadByRequest -is [System.Array]) { $dlReqCount = $downloadByRequest.Count }
if ($dlReqCount -eq 0) {
    $downloadRequestMatches = $false  # We sent a request with this ID -- must find entries
} else {
    foreach ($entry in $downloadByRequest) {
        if ($entry.requestId -ne $customRequestId) { $downloadRequestMatches = $false; break }
    }
}
Test-Result -Success $downloadRequestMatches -Message "Download logs requestId filter returns matching entries (count: $dlReqCount)"

# --- Stream logs: GET /admin/log-config/stream (SSE) ---
Write-Host "`n--- Test: Stream Logs (SSE) ---" -ForegroundColor Cyan
$streamOutput = & curl.exe -s -N --max-time 4 -H "Authorization: Bearer $Token" "$baseUrl/scim/admin/log-config/stream?level=INFO" 2>$null
$hasConnectedEvent = ($streamOutput -match "event:\s*connected") -or ($streamOutput -match "Log stream connected")
Test-Result -Success $hasConnectedEvent -Message "SSE stream returns connected event"

# --- Requires authentication ---
Write-Host "`n--- Test: Log Config Requires Authentication ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET
    Test-Result -Success $false -Message "GET log-config should require auth"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 401) -Message "GET log-config returns 401 without auth"
}

# --- Restore original log level ---
Write-Host "`n--- Cleanup: Restore Original Log Level ---" -ForegroundColor Cyan
$restoreBody = @{ globalLevel = $originalLevel; format = "pretty"; includePayloads = $true; categoryLevels = @{} } | ConvertTo-Json -Depth 3
$restoreResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method PUT -Headers $headers -Body $restoreBody
Test-Result -Success ($restoreResult.config.globalLevel -eq $originalLevel) -Message "Restored globalLevel to $originalLevel"
Test-Result -Success ($restoreResult.config.format -eq "pretty") -Message "Restored format to pretty"

# ============================================
# TEST SECTION 9k: PER-ENDPOINT LOG LEVEL VIA ENDPOINT CONFIG
$script:currentSection = "9k: Per-Endpoint Log Level"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9k: PER-ENDPOINT LOG LEVEL VIA ENDPOINT CONFIG" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Create endpoint with logLevel in config ---
Write-Host "`n--- Create Endpoint with logLevel Config ---" -ForegroundColor Cyan
$logLevelEndpointBody = @{
    name = "log-level-test-ep"
    displayName = "Log Level Test Endpoint"
    description = "Endpoint to test per-endpoint logLevel via config"
    config = @{
        logLevel = "DEBUG"
    }
} | ConvertTo-Json -Depth 3

$logLevelEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $logLevelEndpointBody
$logLevelEndpointId = $logLevelEndpoint.id
Test-Result -Success ($logLevelEndpoint.config.logLevel -eq "DEBUG") -Message "Created endpoint with logLevel=DEBUG in config"
Test-Result -Success ($logLevelEndpointId -ne $null) -Message "Endpoint ID is present: $logLevelEndpointId"

# --- Verify log-config reflects the endpoint level ---
$logConfigAfterCreate = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$epLevelAfterCreate = $logConfigAfterCreate.endpointLevels.$logLevelEndpointId
Test-Result -Success ($epLevelAfterCreate -ne $null) -Message "Endpoint level appears in log-config after create"

# --- Get endpoint and verify config roundtrips ---
$getEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method GET -Headers $headers
Test-Result -Success ($getEndpoint.config.logLevel -eq "DEBUG") -Message "GET endpoint returns logLevel=DEBUG in config"

# --- Update endpoint to change logLevel ---
Write-Host "`n--- Update Endpoint logLevel Config ---" -ForegroundColor Cyan
$updateBody = @{
    config = @{
        logLevel = "TRACE"
    }
} | ConvertTo-Json -Depth 3

$updatedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method PATCH -Headers $headers -Body $updateBody
Test-Result -Success ($updatedEndpoint.config.logLevel -eq "TRACE") -Message "Updated endpoint logLevel to TRACE"

# --- Verify log-config reflects updated level ---
$logConfigAfterUpdate = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$epLevelAfterUpdate = $logConfigAfterUpdate.endpointLevels.$logLevelEndpointId
Test-Result -Success ($epLevelAfterUpdate -ne $null) -Message "Endpoint level updated in log-config after PATCH"

# --- Update endpoint config without logLevel (should clear endpoint level) ---
Write-Host "`n--- Remove logLevel from Endpoint Config ---" -ForegroundColor Cyan
$removeLogLevelBody = @{
    config = @{
        strictMode = $true
    }
} | ConvertTo-Json -Depth 3

$clearedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method PATCH -Headers $headers -Body $removeLogLevelBody
Test-Result -Success ($clearedEndpoint.config.logLevel -eq $null) -Message "Endpoint config no longer has logLevel"
Test-Result -Success ($clearedEndpoint.config.strictMode -eq $true) -Message "Other config flags preserved"

# --- Verify log-config no longer has endpoint level ---
$logConfigAfterClear = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$epLevelAfterClear = $logConfigAfterClear.endpointLevels.$logLevelEndpointId
Test-Result -Success ($epLevelAfterClear -eq $null) -Message "Endpoint level cleared from log-config"

# --- Create endpoint with logLevel alongside other config flags ---
Write-Host "`n--- Create Endpoint with Mixed Config ---" -ForegroundColor Cyan
$mixedConfigBody = @{
    name = "log-level-mixed-ep"
    displayName = "Mixed Config Endpoint"
    config = @{
        logLevel = "WARN"
        VerbosePatchSupported = "True"
        strictMode = $true
    }
} | ConvertTo-Json -Depth 3

$mixedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $mixedConfigBody
$mixedEndpointId = $mixedEndpoint.id
Test-Result -Success ($mixedEndpoint.config.logLevel -eq "WARN") -Message "Mixed config: logLevel=WARN"
Test-Result -Success ($mixedEndpoint.config.VerbosePatchSupported -eq "True") -Message "Mixed config: VerbosePatchSupported=True"
Test-Result -Success ($mixedEndpoint.config.strictMode -eq $true) -Message "Mixed config: strictMode=true"

# --- Validate log-config for mixed endpoint ---
$logConfigMixed = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$mixedEpLevel = $logConfigMixed.endpointLevels.$mixedEndpointId
Test-Result -Success ($mixedEpLevel -ne $null) -Message "Mixed endpoint level in log-config"

# --- Validation: reject invalid logLevel ---
Write-Host "`n--- Validation: Invalid logLevel Values ---" -ForegroundColor Cyan
try {
    $badBody = @{ name = "bad-log-ep"; config = @{ logLevel = "VERBOSE" } } | ConvertTo-Json -Depth 3
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $badBody
    Test-Result -Success $false -Message "Should reject invalid logLevel 'VERBOSE'"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Rejects invalid logLevel 'VERBOSE' with 400"
}

try {
    $badBody2 = @{ name = "bad-log-ep2"; config = @{ logLevel = "high" } } | ConvertTo-Json -Depth 3
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $badBody2
    Test-Result -Success $false -Message "Should reject invalid logLevel 'high'"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Rejects invalid logLevel 'high' with 400"
}

# --- Accept case-insensitive logLevel ---
$ciBody = @{
    name = "log-ci-ep"
    config = @{ logLevel = "debug" }
} | ConvertTo-Json -Depth 3
$ciEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $ciBody
$ciEndpointId = $ciEndpoint.id
Test-Result -Success ($ciEndpoint.config.logLevel -eq "debug") -Message "Accepts lowercase logLevel 'debug'"

# --- Cleanup: delete test endpoints ---
Write-Host "`n--- Cleanup: Delete Log Level Test Endpoints ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "Deleted log-level-test-ep"
} catch {
    Test-Result -Success $false -Message "Deleted log-level-test-ep"
}

try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$mixedEndpointId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "Deleted log-level-mixed-ep"
} catch {
    Test-Result -Success $false -Message "Deleted log-level-mixed-ep"
}

try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$ciEndpointId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "Deleted log-ci-ep"
} catch {
    Test-Result -Success $false -Message "Deleted log-ci-ep"
}

# Verify cleanup cleared log-config
$logConfigFinal = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$finalEp1 = $logConfigFinal.endpointLevels.$logLevelEndpointId
$finalEp2 = $logConfigFinal.endpointLevels.$mixedEndpointId
$finalEp3 = $logConfigFinal.endpointLevels.$ciEndpointId
Test-Result -Success ($finalEp1 -eq $null -and $finalEp2 -eq $null -and $finalEp3 -eq $null) -Message "All endpoint levels cleaned from log-config after delete"

# ============================================
# TEST SECTION 9f: AllowAndCoerceBooleanStrings
$script:currentSection = "9f: BooleanCoercion"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9f: AllowAndCoerceBooleanStrings" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create a dedicated endpoint with StrictSchemaValidation + coercion defaults
Write-Host "`n--- Setup: Create coercion test endpoint ---" -ForegroundColor Cyan
$boolCoerceEndpointBody = @{
    name = "bool-coerce-ep-$(Get-Random)"
    displayName = "Boolean Coercion Test Endpoint"
    description = "Endpoint for AllowAndCoerceBooleanStrings tests"
    config = @{
        StrictSchemaValidation = "True"
        # AllowAndCoerceBooleanStrings defaults to true
    }
} | ConvertTo-Json
$boolCoerceEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $boolCoerceEndpointBody
$boolCoerceEndpointId = $boolCoerceEndpoint.id
$boolCoerceScimBase = "$baseUrl/scim/endpoints/$boolCoerceEndpointId"
Test-Result -Success ($null -ne $boolCoerceEndpointId) -Message "Created bool-coerce endpoint: $boolCoerceEndpointId"

# Test 9f.1: POST user with roles[].primary = "True" — should coerce to boolean true
Write-Host "`n--- Test 9f.1: POST User with boolean string 'True' in roles[].primary ---" -ForegroundColor Cyan
$coerceUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "coerce-user-$(Get-Random)@test.com"
    active = $true
    roles = @(
        @{ value = "admin"; primary = "True" }
    )
} | ConvertTo-Json -Depth 5
try {
    $coerceUser = Invoke-RestMethod -Uri "$boolCoerceScimBase/Users" -Method POST -Headers $headers -Body $coerceUserBody
    $rolePrimary = $coerceUser.roles[0].primary
    Test-Result -Success ($rolePrimary -eq $true -and $rolePrimary.GetType().Name -eq 'Boolean') -Message "POST user: roles[].primary 'True' coerced to boolean true (got: $rolePrimary, type: $($rolePrimary.GetType().Name))"
    $coerceUserId = $coerceUser.id
} catch {
    Test-Result -Success $false -Message "POST user with boolean string should succeed: $_"
}

# Test 9f.2: POST user with emails[].primary = "False" — should coerce to boolean false
Write-Host "`n--- Test 9f.2: POST User with boolean string 'False' in emails[].primary ---" -ForegroundColor Cyan
$coerceUser2Body = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "coerce-user2-$(Get-Random)@test.com"
    active = $true
    emails = @(
        @{ value = "work@test.com"; type = "work"; primary = "True" },
        @{ value = "home@test.com"; type = "home"; primary = "False" }
    )
} | ConvertTo-Json -Depth 5
try {
    $coerceUser2 = Invoke-RestMethod -Uri "$boolCoerceScimBase/Users" -Method POST -Headers $headers -Body $coerceUser2Body
    $workPrimary = ($coerceUser2.emails | Where-Object { $_.type -eq 'work' }).primary
    $homePrimary = ($coerceUser2.emails | Where-Object { $_.type -eq 'home' }).primary
    Test-Result -Success ($workPrimary -eq $true) -Message "POST user: emails[work].primary 'True' → true"
    Test-Result -Success ($homePrimary -eq $false) -Message "POST user: emails[home].primary 'False' → false"
    $coerceUser2Id = $coerceUser2.id
} catch {
    Test-Result -Success $false -Message "POST user with False boolean string should succeed: $_"
}

# Test 9f.3: PUT user with boolean string — should coerce
Write-Host "`n--- Test 9f.3: PUT User with boolean string coercion ---" -ForegroundColor Cyan
if ($coerceUserId) {
    $putCoerceBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
        userName = $coerceUser.userName
        active = $true
        roles = @(
            @{ value = "editor"; primary = "True" }
        )
    } | ConvertTo-Json -Depth 5
    try {
        $putResult = Invoke-RestMethod -Uri "$boolCoerceScimBase/Users/$coerceUserId" -Method PUT -Headers $headers -Body $putCoerceBody
        $putPrimary = $putResult.roles[0].primary
        Test-Result -Success ($putPrimary -eq $true -and $putPrimary.GetType().Name -eq 'Boolean') -Message "PUT user: roles[].primary 'True' coerced to true"
    } catch {
        Test-Result -Success $false -Message "PUT user with boolean string should succeed: $_"
    }
}

# Test 9f.4: PATCH user with boolean string in value object — should coerce
Write-Host "`n--- Test 9f.4: PATCH User with boolean string coercion ---" -ForegroundColor Cyan
if ($coerceUserId) {
    $patchCoerceBody = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
        Operations = @(
            @{
                op = "replace"
                value = @{
                    roles = @(
                        @{ value = "superadmin"; primary = "True" }
                    )
                }
            }
        )
    } | ConvertTo-Json -Depth 6
    try {
        $patchResult = Invoke-RestMethod -Uri "$boolCoerceScimBase/Users/$coerceUserId" -Method PATCH -Headers $headers -Body $patchCoerceBody
        $patchPrimary = $patchResult.roles[0].primary
        Test-Result -Success ($patchPrimary -eq $true -and $patchPrimary.GetType().Name -eq 'Boolean') -Message "PATCH user: roles[].primary 'True' coerced to true"
    } catch {
        Test-Result -Success $false -Message "PATCH user with boolean string should succeed: $_"
    }
}

# Test 9f.5: Create endpoint with coercion OFF + StrictSchema ON — should reject boolean strings
Write-Host "`n--- Test 9f.5: Reject boolean string when flag is OFF ---" -ForegroundColor Cyan
$rejectEndpointBody = @{
    name = "bool-reject-ep-$(Get-Random)"
    displayName = "Boolean Reject Test Endpoint"
    config = @{
        StrictSchemaValidation = "True"
        AllowAndCoerceBooleanStrings = "False"
    }
} | ConvertTo-Json
$rejectEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $rejectEndpointBody
$rejectEndpointId = $rejectEndpoint.id
$rejectScimBase = "$baseUrl/scim/endpoints/$rejectEndpointId"

$rejectUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "reject-user-$(Get-Random)@test.com"
    active = $true
    roles = @(
        @{ value = "admin"; primary = "True" }
    )
} | ConvertTo-Json -Depth 5
try {
    Invoke-RestMethod -Uri "$rejectScimBase/Users" -Method POST -Headers $headers -Body $rejectUserBody -ErrorAction Stop | Out-Null
    Test-Result -Success $false -Message "POST with boolean string should be rejected when flag is OFF"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Boolean string rejected with 400 when AllowAndCoerceBooleanStrings=False (got: $statusCode)"
}

# Test 9f.6: Multiple boolean attrs across multiple multi-valued arrays
Write-Host "`n--- Test 9f.6: Multi-attribute boolean coercion ---" -ForegroundColor Cyan
$multiAttrBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "multi-bool-$(Get-Random)@test.com"
    active = $true
    emails = @(
        @{ value = "a@t.com"; type = "work"; primary = "True" },
        @{ value = "b@t.com"; type = "home"; primary = "False" }
    )
    phoneNumbers = @(
        @{ value = "+1234567890"; type = "work"; primary = "True" }
    )
    roles = @(
        @{ value = "admin"; primary = "True" },
        @{ value = "user"; primary = "False" }
    )
} | ConvertTo-Json -Depth 5
try {
    $multiResult = Invoke-RestMethod -Uri "$boolCoerceScimBase/Users" -Method POST -Headers $headers -Body $multiAttrBody
    $workEmailPrimary = ($multiResult.emails | Where-Object { $_.type -eq 'work' }).primary
    $homeEmailPrimary = ($multiResult.emails | Where-Object { $_.type -eq 'home' }).primary
    $phonePrimary = $multiResult.phoneNumbers[0].primary
    $adminPrimary = ($multiResult.roles | Where-Object { $_.value -eq 'admin' }).primary
    $userPrimary = ($multiResult.roles | Where-Object { $_.value -eq 'user' }).primary
    Test-Result -Success ($workEmailPrimary -eq $true) -Message "Multi-attr: emails[work].primary → true"
    Test-Result -Success ($homeEmailPrimary -eq $false) -Message "Multi-attr: emails[home].primary → false"
    Test-Result -Success ($phonePrimary -eq $true) -Message "Multi-attr: phoneNumbers[work].primary → true"
    Test-Result -Success ($adminPrimary -eq $true) -Message "Multi-attr: roles[admin].primary → true"
    Test-Result -Success ($userPrimary -eq $false) -Message "Multi-attr: roles[user].primary → false"
} catch {
    Test-Result -Success $false -Message "Multi-attr boolean coercion should succeed: $_"
}

# Test 9f.7: Non-boolean string attrs preserved (roles[].value = "true" should stay as string)
Write-Host "`n--- Test 9f.7: Non-boolean string attrs preserved ---" -ForegroundColor Cyan
$preserveBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "preserve-$(Get-Random)@test.com"
    active = $true
    roles = @(
        @{ value = "true"; primary = "True" }
    )
} | ConvertTo-Json -Depth 5
try {
    $preserveResult = Invoke-RestMethod -Uri "$boolCoerceScimBase/Users" -Method POST -Headers $headers -Body $preserveBody
    $roleValue = $preserveResult.roles[0].value
    $rolePrimary2 = $preserveResult.roles[0].primary
    Test-Result -Success ($roleValue -eq "true") -Message "Non-boolean string attr roles[].value preserved as 'true'"
    Test-Result -Success ($rolePrimary2 -eq $true -and $rolePrimary2.GetType().Name -eq 'Boolean') -Message "Boolean attr roles[].primary coerced to true"
} catch {
    Test-Result -Success $false -Message "Preserve non-boolean string test should succeed: $_"
}

# Test 9f.8: Group with core schema (no boolean attrs) - pipeline works without error
Write-Host "`n--- Test 9f.8: Group POST with coercion pipeline (core schema, no boolean attrs) ---" -ForegroundColor Cyan
$groupCoerceBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Bool-Test-Group-$(Get-Random)"
} | ConvertTo-Json -Depth 3
try {
    $groupResult = Invoke-RestMethod -Uri "$boolCoerceScimBase/Groups" -Method POST -Headers $headers -Body $groupCoerceBody
    Test-Result -Success ($null -ne $groupResult.id) -Message "Group POST with coercion pipeline succeeds (no boolean attrs in core Group schema)"
    $boolGroupId = $groupResult.id
} catch {
    Test-Result -Success $false -Message "Group POST should succeed with coercion enabled: $_"
}

# Cleanup: Delete test resources and endpoints
Write-Host "`n--- Cleanup: Boolean coercion test resources ---" -ForegroundColor Cyan
try {
    if ($coerceUserId) { Invoke-RestMethod -Uri "$boolCoerceScimBase/Users/$coerceUserId" -Method DELETE -Headers $headers | Out-Null }
    if ($coerceUser2Id) { Invoke-RestMethod -Uri "$boolCoerceScimBase/Users/$coerceUser2Id" -Method DELETE -Headers $headers | Out-Null }
    if ($boolGroupId) { Invoke-RestMethod -Uri "$boolCoerceScimBase/Groups/$boolGroupId" -Method DELETE -Headers $headers | Out-Null }
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$boolCoerceEndpointId" -Method DELETE -Headers $headers | Out-Null
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$rejectEndpointId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "Boolean coercion test endpoints cleaned up"
} catch {
    Test-Result -Success $false -Message "Boolean coercion cleanup: $_"
}

# ============================================
# TEST SECTION 9l: RETURNED CHARACTERISTIC FILTERING (G8e / RFC 7643 S2.4)
$script:currentSection = "9l: Returned Characteristic (G8e)"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9l: RETURNED CHARACTERISTIC FILTERING (G8e / RFC 7643 S2.4)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# RFC 7643 Section 2.4 defines the "returned" characteristic for attributes:
#   - "always"  : Always returned (id, schemas, meta)
#   - "default" : Returned unless excludedAttributes lists it
#   - "request" : Only returned when explicitly requested via ?attributes=
#   - "never"   : NEVER returned (e.g. password) — even if explicitly requested
#
# G8e ensures the server enforces returned:"never" for password across ALL operations.

# --- Setup: Create a user WITH password for returned-characteristic testing ---
Write-Host "`n--- Setup: Create User with Password for G8e Tests ---" -ForegroundColor Cyan
$g8eUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "g8e-returned-test-$(Get-Random)@test.com"
    displayName = "G8e Returned Test User"
    password = "SuperSecret123!"
    name = @{ givenName = "G8e"; familyName = "Test" }
    emails = @(@{ value = "g8e-returned@test.com"; type = "work"; primary = $true })
    active = $true
} | ConvertTo-Json -Depth 3

# Test 9l.1: POST /Users with password — response must NOT contain password
Write-Host "`n--- Test 9l.1: POST /Users with password — password stripped from response ---" -ForegroundColor Cyan
$g8eUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $g8eUserBody
$g8eUserId = $g8eUser.id
Test-Result -Success ($null -ne $g8eUserId) -Message "POST /Users with password returns ID: $g8eUserId"
Test-Result -Success ($null -eq $g8eUser.password) -Message "POST /Users response does NOT contain password (returned:never)"
Test-Result -Success ($null -ne $g8eUser.userName) -Message "POST /Users response still contains userName"
Test-Result -Success ($null -ne $g8eUser.displayName) -Message "POST /Users response still contains displayName"

# Test 9l.2: GET /Users/:id — password must NOT be present
Write-Host "`n--- Test 9l.2: GET /Users/:id — password stripped ---" -ForegroundColor Cyan
$g8eGetUser = Invoke-RestMethod -Uri "$scimBase/Users/$g8eUserId" -Method GET -Headers $headers
Test-Result -Success ($null -eq $g8eGetUser.password) -Message "GET /Users/:id does NOT return password"
Test-Result -Success ($g8eGetUser.userName -like "g8e-returned-test-*") -Message "GET /Users/:id returns userName correctly"

# Test 9l.3: GET /Users (list) — no resource should contain password
Write-Host "`n--- Test 9l.3: GET /Users list — password stripped from all resources ---" -ForegroundColor Cyan
$g8eListResult = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName sw `"g8e-returned-test-`"" -Method GET -Headers $headers
$g8eHasPassword = $false
foreach ($res in $g8eListResult.Resources) {
    if ($null -ne $res.password) { $g8eHasPassword = $true; break }
}
Test-Result -Success (-not $g8eHasPassword) -Message "GET /Users list — no resource contains password"
Test-Result -Success ($g8eListResult.totalResults -ge 1) -Message "GET /Users list found g8e test user"

# Test 9l.4: PUT /Users/:id with password — response must NOT contain password
Write-Host "`n--- Test 9l.4: PUT /Users with password — password stripped from response ---" -ForegroundColor Cyan
$g8ePutBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $g8eUser.userName
    displayName = "G8e Put Updated"
    password = "NewSecret456!"
    active = $true
} | ConvertTo-Json -Depth 3
$g8ePutResult = Invoke-RestMethod -Uri "$scimBase/Users/$g8eUserId" -Method PUT -Headers $headers -Body $g8ePutBody
Test-Result -Success ($null -eq $g8ePutResult.password) -Message "PUT /Users response does NOT contain password (returned:never)"
Test-Result -Success ($g8ePutResult.displayName -eq "G8e Put Updated") -Message "PUT /Users response shows updated displayName"

# Test 9l.5: PATCH /Users/:id — response must NOT contain password
Write-Host "`n--- Test 9l.5: PATCH /Users — password stripped from response ---" -ForegroundColor Cyan
$g8ePatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{
            displayName = "G8e Patch Updated"
            password = "PatchedSecret789!"
        }
    })
} | ConvertTo-Json -Depth 4
$g8ePatchResult = Invoke-RestMethod -Uri "$scimBase/Users/$g8eUserId" -Method PATCH -Headers $headers -Body $g8ePatchBody
Test-Result -Success ($null -eq $g8ePatchResult.password) -Message "PATCH /Users response does NOT contain password (returned:never)"
Test-Result -Success ($g8ePatchResult.displayName -eq "G8e Patch Updated") -Message "PATCH /Users response shows updated displayName"

# Test 9l.6: POST /Users/.search — password must NOT appear in search results
Write-Host "`n--- Test 9l.6: POST /Users/.search — password stripped from results ---" -ForegroundColor Cyan
$g8eSearchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = "userName eq `"$($g8eUser.userName)`""
    startIndex = 1
    count = 10
} | ConvertTo-Json
$g8eSearchResult = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $g8eSearchBody
$g8eSearchHasPwd = $false
foreach ($res in $g8eSearchResult.Resources) {
    if ($null -ne $res.password) { $g8eSearchHasPwd = $true; break }
}
Test-Result -Success (-not $g8eSearchHasPwd) -Message "POST /Users/.search — no resource contains password"
Test-Result -Success ($g8eSearchResult.totalResults -ge 1) -Message "POST /Users/.search found g8e test user"

# Test 9l.7: GET /Users?attributes=password — password still NOT returned (returned:never overrides explicit request)
Write-Host "`n--- Test 9l.7: GET /Users?attributes=password — returned:never overrides explicit request ---" -ForegroundColor Cyan
$g8eAttrPwd = Invoke-RestMethod -Uri "$scimBase/Users/$g8eUserId`?attributes=password" -Method GET -Headers $headers
Test-Result -Success ($null -eq $g8eAttrPwd.password) -Message "GET /Users/:id?attributes=password — password NOT returned (returned:never wins)"
Test-Result -Success ($null -ne $g8eAttrPwd.id) -Message "GET /Users/:id?attributes=password — id still returned (always-returned)"
Test-Result -Success ($null -ne $g8eAttrPwd.schemas) -Message "GET /Users/:id?attributes=password — schemas still returned (always-returned)"

# Test 9l.8: GET /Users?attributes=password,userName — password stripped, userName included
Write-Host "`n--- Test 9l.8: GET /Users?attributes=password,userName — mixed request ---" -ForegroundColor Cyan
$g8eMixedAttr = Invoke-RestMethod -Uri "$scimBase/Users/$g8eUserId`?attributes=password,userName" -Method GET -Headers $headers
Test-Result -Success ($null -eq $g8eMixedAttr.password) -Message "GET ?attributes=password,userName — password not returned"
Test-Result -Success ($null -ne $g8eMixedAttr.userName) -Message "GET ?attributes=password,userName — userName IS returned"

# Test 9l.9: GET /Schemas — verify password attribute has returned:never and mutability:writeOnly
Write-Host "`n--- Test 9l.9: GET /Schemas — password attribute metadata ---" -ForegroundColor Cyan
$g8eSchemas = Invoke-RestMethod -Uri "$scimBase/Schemas" -Method GET -Headers $headers
$userSchema = $g8eSchemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:core:2.0:User" }
Test-Result -Success ($null -ne $userSchema) -Message "Schemas endpoint returns User schema"
if ($userSchema) {
    $passwordAttr = $userSchema.attributes | Where-Object { $_.name -eq "password" }
    Test-Result -Success ($null -ne $passwordAttr) -Message "User schema contains password attribute definition"
    if ($passwordAttr) {
        Test-Result -Success ($passwordAttr.returned -eq "never") -Message "password attribute returned=never in schema"
        Test-Result -Success ($passwordAttr.mutability -eq "writeOnly") -Message "password attribute mutability=writeOnly in schema"
        Test-Result -Success ($passwordAttr.type -eq "string") -Message "password attribute type=string in schema"
    }
}

# Test 9l.10: POST /Users/.search with attributes=password — password NOT in results
Write-Host "`n--- Test 9l.10: POST /.search with attributes=password — returned:never wins ---" -ForegroundColor Cyan
$g8eSearchAttrBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = "userName eq `"$($g8eUser.userName)`""
    attributes = "password,userName"
    startIndex = 1
    count = 10
} | ConvertTo-Json
$g8eSearchAttrResult = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $g8eSearchAttrBody
$g8eSearchAttrHasPwd = $false
foreach ($res in $g8eSearchAttrResult.Resources) {
    if ($null -ne $res.password) { $g8eSearchAttrHasPwd = $true; break }
}
Test-Result -Success (-not $g8eSearchAttrHasPwd) -Message "POST /.search attributes=password — password NOT returned (never wins)"
if ($g8eSearchAttrResult.Resources.Count -gt 0) {
    Test-Result -Success ($null -ne $g8eSearchAttrResult.Resources[0].userName) -Message "POST /.search attributes=password,userName — userName IS returned"
}

# Cleanup: Delete G8e test user
Write-Host "`n--- Cleanup: G8e test user ---" -ForegroundColor Cyan
try {
    if ($g8eUserId) {
        Invoke-RestMethod -Uri "$scimBase/Users/$g8eUserId" -Method DELETE -Headers $headers | Out-Null
        Test-Result -Success $true -Message "G8e test user cleaned up"
    }
} catch {
    Test-Result -Success $false -Message "G8e test user cleanup: $_"
}

# ============================================
# TEST SECTION 9m: CUSTOM RESOURCE TYPE REGISTRATION (G8b)
$script:currentSection = "9m: Custom Resource Types (G8b)"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9m: CUSTOM RESOURCE TYPE REGISTRATION (G8b)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create a dedicated endpoint with CustomResourceTypesEnabled ---
Write-Host "`n--- G8b Setup: Creating dedicated endpoint with CustomResourceTypesEnabled ---" -ForegroundColor Cyan
$g8bEndpointBody = @{
    name = "live-test-g8b-$(Get-Random)"
    displayName = "G8b Custom Resource Types Endpoint"
    description = "Endpoint for G8b live integration tests"
    config = @{ CustomResourceTypesEnabled = "True" }
} | ConvertTo-Json
$g8bEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $g8bEndpointBody
$G8bEndpointId = $g8bEndpoint.id
$scimBaseG8b = "$baseUrl/scim/endpoints/$G8bEndpointId"
$adminBaseG8b = "$baseUrl/scim/admin/endpoints/$G8bEndpointId"
Test-Result -Success ($null -ne $G8bEndpointId) -Message "G8b endpoint created with CustomResourceTypesEnabled"

# --- Also create an endpoint WITHOUT the flag for gating tests ---
$g8bNoFlagBody = @{
    name = "live-test-g8b-noflag-$(Get-Random)"
    displayName = "G8b No Flag Endpoint"
    description = "Endpoint WITHOUT CustomResourceTypesEnabled for gating tests"
} | ConvertTo-Json
$g8bNoFlagEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $g8bNoFlagBody
$G8bNoFlagEndpointId = $g8bNoFlagEndpoint.id

# --- Test 9m.1: Config flag gating — should 403 when flag not enabled ---
Write-Host "`n--- Test 9m.1: Config flag gating (should 403 when disabled) ---" -ForegroundColor Cyan
$deviceSchema = @{
    name = "Device"
    schemaUri = "urn:ietf:params:scim:schemas:custom:Device"
    endpoint = "/Devices"
    description = "Custom Device resource type"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$G8bNoFlagEndpointId/resource-types" -Method POST -Headers $headers -Body $deviceSchema
    Test-Result -Success $false -Message "9m.1 Should have been rejected with 403"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 403) -Message "9m.1 Config flag gating rejects when disabled (HTTP $statusCode)"
}

# --- Test 9m.2: Register a custom resource type ---
Write-Host "`n--- Test 9m.2: Register Device resource type ---" -ForegroundColor Cyan
$deviceReg = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $deviceSchema
Test-Result -Success ($deviceReg.name -eq "Device" -and $deviceReg.endpoint -eq "/Devices") -Message "9m.2 Device resource type registered (name=$($deviceReg.name), endpoint=$($deviceReg.endpoint))"

# --- Test 9m.3: Reject reserved name "User" ---
Write-Host "`n--- Test 9m.3: Reject reserved name 'User' ---" -ForegroundColor Cyan
$reservedBody = @{
    name = "User"
    schemaUri = "urn:custom:User"
    endpoint = "/CustomUsers"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $reservedBody
    Test-Result -Success $false -Message "9m.3 Should have been rejected for reserved name"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m.3 Reserved name 'User' rejected (HTTP $statusCode)"
}

# --- Test 9m.4: Reject reserved endpoint path /Groups ---
Write-Host "`n--- Test 9m.4: Reject reserved endpoint path /Groups ---" -ForegroundColor Cyan
$reservedPathBody = @{
    name = "CustomGroup"
    schemaUri = "urn:custom:Group"
    endpoint = "/Groups"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $reservedPathBody
    Test-Result -Success $false -Message "9m.4 Should have been rejected for reserved path"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m.4 Reserved endpoint path '/Groups' rejected (HTTP $statusCode)"
}

# --- Test 9m.5: Reject duplicate resource type name ---
Write-Host "`n--- Test 9m.5: Reject duplicate resource type name ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $deviceSchema
    Test-Result -Success $false -Message "9m.5 Should have been rejected as duplicate"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 409) -Message "9m.5 Duplicate name 'Device' rejected (HTTP $statusCode)"
}

# --- Test 9m.6: List registered resource types ---
Write-Host "`n--- Test 9m.6: List registered resource types ---" -ForegroundColor Cyan
$listing = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method GET -Headers $headers
Test-Result -Success ($listing.totalResults -ge 1) -Message "9m.6 List resource types returns $($listing.totalResults) item(s)"

# --- Test 9m.7: Get specific resource type by name ---
Write-Host "`n--- Test 9m.7: Get resource type by name ---" -ForegroundColor Cyan
$deviceGet = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/Device" -Method GET -Headers $headers
Test-Result -Success ($deviceGet.name -eq "Device" -and $deviceGet.schemaUri -eq "urn:ietf:params:scim:schemas:custom:Device") -Message "9m.7 GET /resource-types/Device returns correct data"

# --- Test 9m.8: Create a custom Device resource ---
Write-Host "`n--- Test 9m.8: Create a custom Device resource via SCIM ---" -ForegroundColor Cyan
$deviceBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Device")
    displayName = "Test Laptop G8b"
    externalId = "device-ext-001"
} | ConvertTo-Json
$deviceRes = Invoke-RestMethod -Uri "$scimBaseG8b/Devices" -Method POST -Headers $headers -Body $deviceBody -ContentType "application/scim+json"
$g8bDeviceId = $deviceRes.id
Test-Result -Success ($null -ne $g8bDeviceId -and $deviceRes.meta.resourceType -eq "Device") -Message "9m.8 Device created (id=$g8bDeviceId, resourceType=$($deviceRes.meta.resourceType))"

# --- Test 9m.9: GET the created Device ---
Write-Host "`n--- Test 9m.9: GET the created Device ---" -ForegroundColor Cyan
$deviceFetched = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method GET -Headers $headers
Test-Result -Success ($deviceFetched.id -eq $g8bDeviceId -and $deviceFetched.displayName -eq "Test Laptop G8b") -Message "9m.9 GET Device returns correct resource"

# --- Test 9m.10: List Devices ---
Write-Host "`n--- Test 9m.10: List Devices ---" -ForegroundColor Cyan
$deviceList = Invoke-RestMethod -Uri "$scimBaseG8b/Devices" -Method GET -Headers $headers
Test-Result -Success ($deviceList.totalResults -ge 1 -and $deviceList.Resources.Count -ge 1) -Message "9m.10 GET /Devices list returns $($deviceList.totalResults) resource(s)"

# --- Test 9m.11: PUT replace the Device ---
Write-Host "`n--- Test 9m.11: PUT replace the Device ---" -ForegroundColor Cyan
$putBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Device")
    displayName = "Updated Laptop G8b"
    externalId = "device-ext-001-updated"
} | ConvertTo-Json
$devicePut = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method PUT -Headers $headers -Body $putBody -ContentType "application/scim+json"
Test-Result -Success ($devicePut.displayName -eq "Updated Laptop G8b") -Message "9m.11 PUT replace Device succeeds (displayName=$($devicePut.displayName))"

# --- Test 9m.12: PATCH the Device ---
Write-Host "`n--- Test 9m.12: PATCH the Device ---" -ForegroundColor Cyan
$patchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "displayName"; value = "Patched Laptop G8b" }
    )
} | ConvertTo-Json -Depth 3
$devicePatched = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/scim+json"
Test-Result -Success ($devicePatched.displayName -eq "Patched Laptop G8b") -Message "9m.12 PATCH Device succeeds (displayName=$($devicePatched.displayName))"

# --- Test 9m.13: DELETE the Device ---
Write-Host "`n--- Test 9m.13: DELETE the Device ---" -ForegroundColor Cyan
$null = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method DELETE -Headers $headers
try {
    $null = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m.13 Deleted Device should not be found"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m.13 DELETE Device works (resource returns 404 after)"
}

# --- Test 9m.14: 404 for non-existent Device ---
Write-Host "`n--- Test 9m.14: GET non-existent Device returns 404 ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/00000000-0000-0000-0000-000000000099" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m.14 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m.14 Non-existent Device returns 404 (HTTP $statusCode)"
}

# --- Test 9m.15: Register a second resource type (Application) ---
Write-Host "`n--- Test 9m.15: Register Application resource type on same endpoint ---" -ForegroundColor Cyan
$appSchema = @{
    name = "Application"
    schemaUri = "urn:ietf:params:scim:schemas:custom:Application"
    endpoint = "/Applications"
    description = "Custom Application resource type"
} | ConvertTo-Json
$appReg = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $appSchema
Test-Result -Success ($appReg.name -eq "Application") -Message "9m.15 Application resource type registered"

# --- Test 9m.16: Create an Application resource ---
Write-Host "`n--- Test 9m.16: Create an Application resource ---" -ForegroundColor Cyan
$appBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Application")
    displayName = "Test App G8b"
} | ConvertTo-Json
$appRes = Invoke-RestMethod -Uri "$scimBaseG8b/Applications" -Method POST -Headers $headers -Body $appBody -ContentType "application/scim+json"
Test-Result -Success ($null -ne $appRes.id -and $appRes.meta.resourceType -eq "Application") -Message "9m.16 Application created (id=$($appRes.id))"

# --- Test 9m.17: Endpoint isolation — other endpoints should NOT see Devices ---
Write-Host "`n--- Test 9m.17: Endpoint isolation ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Devices" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m.17 Main endpoint should NOT serve /Devices"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m.17 Endpoint isolation works — main endpoint returns 404 for /Devices (HTTP $statusCode)"
}

# --- Test 9m.18: Built-in routes still work ---
Write-Host "`n--- Test 9m.18: Built-in /Users still works on G8b endpoint ---" -ForegroundColor Cyan
$usersOnG8b = Invoke-RestMethod -Uri "$scimBaseG8b/Users" -Method GET -Headers $headers
Test-Result -Success ($null -ne $usersOnG8b.totalResults) -Message "9m.18 Built-in /Users works on G8b endpoint (totalResults=$($usersOnG8b.totalResults))"

# --- Test 9m.19: Delete a custom resource type ---
Write-Host "`n--- Test 9m.19: Delete Application resource type ---" -ForegroundColor Cyan
$null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/Application" -Method DELETE -Headers $headers
$listAfterDelete = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method GET -Headers $headers
$appStillExists = $listAfterDelete.resourceTypes | Where-Object { $_.name -eq "Application" }
Test-Result -Success ($null -eq $appStillExists) -Message "9m.19 Application resource type deleted (no longer in list)"

# --- Test 9m.20: Reject deletion of built-in type ---
Write-Host "`n--- Test 9m.20: Reject deletion of built-in type 'User' ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/User" -Method DELETE -Headers $headers
    Test-Result -Success $false -Message "9m.20 Should have been rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m.20 Deletion of built-in type 'User' rejected (HTTP $statusCode)"
}

Write-Host "`n--- G8b: Custom Resource Type Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9n: BULK OPERATIONS (Phase 9 / RFC 7644 §3.7)
$script:currentSection = "9n: Bulk Operations (Phase 9)"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9n: BULK OPERATIONS (Phase 9 / RFC 7644 S3.7)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create endpoint WITH BulkOperationsEnabled ---
Write-Host "`n--- Bulk Setup: Creating endpoint with BulkOperationsEnabled ---" -ForegroundColor Cyan
$bulkEndpointBody = @{
    name = "live-test-bulk-$(Get-Random)"
    displayName = "Bulk Operations Test Endpoint"
    description = "Endpoint for Phase 9 Bulk Operations live tests"
    config = @{ BulkOperationsEnabled = "True" }
} | ConvertTo-Json
$bulkEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $bulkEndpointBody
$BulkEndpointId = $bulkEndpoint.id
$scimBaseBulk = "$baseUrl/scim/endpoints/$BulkEndpointId"
Test-Result -Success ($null -ne $BulkEndpointId) -Message "Bulk endpoint created with BulkOperationsEnabled"

# --- Also create endpoint WITHOUT the flag ---
$bulkNoFlagBody = @{
    name = "live-test-bulk-noflag-$(Get-Random)"
    displayName = "Bulk No Flag Endpoint"
    description = "Endpoint WITHOUT BulkOperationsEnabled"
} | ConvertTo-Json
$bulkNoFlagEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $bulkNoFlagBody
$BulkNoFlagEndpointId = $bulkNoFlagEndpoint.id
$scimBaseBulkNoFlag = "$baseUrl/scim/endpoints/$BulkNoFlagEndpointId"

# --- Test 9n.1: Config flag gating — should 403 when disabled ---
Write-Host "`n--- Test 9n.1: Config flag gating (should 403 when disabled) ---" -ForegroundColor Cyan
$bulkBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{ method = "POST"; path = "/Users"; data = @{ schemas = @("urn:ietf:params:scim:schemas:core:2.0:User"); userName = "bulk-gating-test" } }
    )
} | ConvertTo-Json -Depth 5
try {
    $null = Invoke-RestMethod -Uri "$scimBaseBulkNoFlag/Bulk" -Method POST -Headers $headers -Body $bulkBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "9n.1 Should have been rejected with 403"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 403) -Message "9n.1 Config flag gating rejects when disabled (HTTP $statusCode)"
}

# --- Test 9n.2: Config flag — should succeed when enabled ---
Write-Host "`n--- Test 9n.2: Config flag gating (should succeed when enabled) ---" -ForegroundColor Cyan
try {
    $bulkResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkBody -ContentType "application/scim+json"
    Test-Result -Success ($bulkResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:BulkResponse") -Message "9n.2 Bulk request succeeds when enabled (schemas=$($bulkResult.schemas -join ','))"
    # Clean up the user created in this test
    $bulkCreatedUserId = $bulkResult.Operations[0].location -replace '.*/', ''
    if ($bulkCreatedUserId) {
        try { $null = Invoke-RestMethod -Uri "$scimBaseBulk/Users/$bulkCreatedUserId" -Method DELETE -Headers $headers } catch {}
    }
} catch {
    Test-Result -Success $false -Message "9n.2 Bulk request failed when enabled: $_"
}

# --- Test 9n.3: POST user via bulk ---
Write-Host "`n--- Test 9n.3: POST user via bulk ---" -ForegroundColor Cyan
$bulkPostBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{
            method = "POST"
            path = "/Users"
            bulkId = "user1"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                userName = "bulk-user-$(Get-Random)"
                displayName = "Bulk Test User"
                name = @{ givenName = "Bulk"; familyName = "User" }
                active = $true
            }
        }
    )
} | ConvertTo-Json -Depth 5
try {
    $bulkPostResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkPostBody -ContentType "application/scim+json"
    $op = $bulkPostResult.Operations[0]
    $bulkUserId = $op.location -replace '.*/', ''
    Test-Result -Success ($op.status -eq "201" -and $null -ne $bulkUserId) -Message "9n.3 POST user via bulk (status=$($op.status), id=$bulkUserId)"
} catch {
    Test-Result -Success $false -Message "9n.3 POST user via bulk failed: $_"
    $bulkUserId = $null
}

# --- Test 9n.4: PUT (replace) user via bulk ---
Write-Host "`n--- Test 9n.4: PUT user via bulk ---" -ForegroundColor Cyan
if ($bulkUserId) {
    $bulkPutBody = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
        Operations = @(
            @{
                method = "PUT"
                path = "/Users/$bulkUserId"
                data = @{
                    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                    userName = "bulk-user-replaced"
                    displayName = "Replaced Bulk User"
                    name = @{ givenName = "Replaced"; familyName = "BulkUser" }
                    active = $true
                }
            }
        )
    } | ConvertTo-Json -Depth 5
    try {
        $bulkPutResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkPutBody -ContentType "application/scim+json"
        $op = $bulkPutResult.Operations[0]
        Test-Result -Success ($op.status -eq "200") -Message "9n.4 PUT user via bulk (status=$($op.status))"
    } catch {
        Test-Result -Success $false -Message "9n.4 PUT user via bulk failed: $_"
    }
}

# --- Test 9n.5: PATCH user via bulk ---
Write-Host "`n--- Test 9n.5: PATCH user via bulk ---" -ForegroundColor Cyan
if ($bulkUserId) {
    $bulkPatchBody = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
        Operations = @(
            @{
                method = "PATCH"
                path = "/Users/$bulkUserId"
                data = @{
                    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
                    Operations = @(
                        @{ op = "replace"; path = "displayName"; value = "Patched Bulk User" }
                    )
                }
            }
        )
    } | ConvertTo-Json -Depth 6
    try {
        $bulkPatchResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkPatchBody -ContentType "application/scim+json"
        $op = $bulkPatchResult.Operations[0]
        Test-Result -Success ($op.status -eq "200") -Message "9n.5 PATCH user via bulk (status=$($op.status))"
    } catch {
        Test-Result -Success $false -Message "9n.5 PATCH user via bulk failed: $_"
    }
}

# --- Test 9n.6: DELETE user via bulk ---
Write-Host "`n--- Test 9n.6: DELETE user via bulk ---" -ForegroundColor Cyan
if ($bulkUserId) {
    $bulkDeleteBody = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
        Operations = @(
            @{
                method = "DELETE"
                path = "/Users/$bulkUserId"
            }
        )
    } | ConvertTo-Json -Depth 5
    try {
        $bulkDeleteResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkDeleteBody -ContentType "application/scim+json"
        $op = $bulkDeleteResult.Operations[0]
        Test-Result -Success ($op.status -eq "204") -Message "9n.6 DELETE user via bulk (status=$($op.status))"
        $bulkUserId = $null  # Cleaned up
    } catch {
        Test-Result -Success $false -Message "9n.6 DELETE user via bulk failed: $_"
    }
}

# --- Test 9n.7: POST group via bulk ---
Write-Host "`n--- Test 9n.7: POST group via bulk ---" -ForegroundColor Cyan
$bulkGroupBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{
            method = "POST"
            path = "/Groups"
            bulkId = "group1"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
                displayName = "Bulk Test Group $(Get-Random)"
            }
        }
    )
} | ConvertTo-Json -Depth 5
try {
    $bulkGroupResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkGroupBody -ContentType "application/scim+json"
    $op = $bulkGroupResult.Operations[0]
    $bulkGroupId = $op.location -replace '.*/', ''
    Test-Result -Success ($op.status -eq "201" -and $null -ne $bulkGroupId) -Message "9n.7 POST group via bulk (status=$($op.status), id=$bulkGroupId)"
} catch {
    Test-Result -Success $false -Message "9n.7 POST group via bulk failed: $_"
    $bulkGroupId = $null
}

# --- Test 9n.8: DELETE group via bulk ---
Write-Host "`n--- Test 9n.8: DELETE group via bulk ---" -ForegroundColor Cyan
if ($bulkGroupId) {
    $bulkGroupDeleteBody = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
        Operations = @(
            @{
                method = "DELETE"
                path = "/Groups/$bulkGroupId"
            }
        )
    } | ConvertTo-Json -Depth 5
    try {
        $bulkGroupDeleteResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkGroupDeleteBody -ContentType "application/scim+json"
        $op = $bulkGroupDeleteResult.Operations[0]
        Test-Result -Success ($op.status -eq "204") -Message "9n.8 DELETE group via bulk (status=$($op.status))"
        $bulkGroupId = $null
    } catch {
        Test-Result -Success $false -Message "9n.8 DELETE group via bulk failed: $_"
    }
}

# --- Test 9n.9: bulkId cross-referencing ---
Write-Host "`n--- Test 9n.9: bulkId cross-referencing (POST + PATCH) ---" -ForegroundColor Cyan
$bulkIdBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{
            method = "POST"
            path = "/Users"
            bulkId = "xref-user"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                userName = "bulk-xref-$(Get-Random)"
                displayName = "Cross-ref User"
            }
        },
        @{
            method = "PATCH"
            path = '/Users/bulkId:xref-user'
            data = @{
                schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
                Operations = @(
                    @{ op = "replace"; path = "displayName"; value = "Cross-ref Patched" }
                )
            }
        }
    )
} | ConvertTo-Json -Depth 6
try {
    $xrefResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $bulkIdBody -ContentType "application/scim+json"
    $postOp = $xrefResult.Operations[0]
    $patchOp = $xrefResult.Operations[1]
    $xrefUserId = $postOp.location -replace '.*/', ''
    Test-Result -Success ($postOp.status -eq "201" -and $patchOp.status -eq "200") -Message "9n.9 bulkId cross-ref: POST=$($postOp.status), PATCH=$($patchOp.status)"
    # Clean up
    if ($xrefUserId) {
        try { $null = Invoke-RestMethod -Uri "$scimBaseBulk/Users/$xrefUserId" -Method DELETE -Headers $headers } catch {}
    }
} catch {
    Test-Result -Success $false -Message "9n.9 bulkId cross-referencing failed: $_"
}

# --- Test 9n.10: failOnErrors — stop after threshold ---
Write-Host "`n--- Test 9n.10: failOnErrors threshold ---" -ForegroundColor Cyan
$failOnErrorsBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    failOnErrors = 1
    Operations = @(
        @{
            method = "DELETE"
            path = "/Users/nonexistent-id-001"
        },
        @{
            method = "DELETE"
            path = "/Users/nonexistent-id-002"
        },
        @{
            method = "DELETE"
            path = "/Users/nonexistent-id-003"
        }
    )
} | ConvertTo-Json -Depth 5
try {
    $foeResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $failOnErrorsBody -ContentType "application/scim+json"
    # With failOnErrors=1, only the first operation should be processed (and fail), rest skipped
    $processedCount = $foeResult.Operations.Count
    Test-Result -Success ($processedCount -le 2) -Message "9n.10 failOnErrors=1 stopped processing early (ops returned=$processedCount)"
} catch {
    Test-Result -Success $false -Message "9n.10 failOnErrors test failed: $_"
}

# --- Test 9n.11: Request validation — missing schema ---
Write-Host "`n--- Test 9n.11: Missing schema validation ---" -ForegroundColor Cyan
$noSchemaBody = @{
    schemas = @("urn:wrong:schema")
    Operations = @(
        @{ method = "POST"; path = "/Users"; data = @{ schemas = @("urn:ietf:params:scim:schemas:core:2.0:User"); userName = "no-schema-test" } }
    )
} | ConvertTo-Json -Depth 5
try {
    $null = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $noSchemaBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "9n.11 Should have been rejected with 400"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9n.11 Missing BulkRequest schema rejected (HTTP $statusCode)"
}

# --- Test 9n.12: Unsupported resource type ---
Write-Host "`n--- Test 9n.12: Unsupported resource type ---" -ForegroundColor Cyan
$unsupportedBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{ method = "POST"; path = "/FakeResource"; data = @{ schemas = @("urn:custom:Fake"); displayName = "fake" } }
    )
} | ConvertTo-Json -Depth 5
try {
    $unsupportedResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $unsupportedBody -ContentType "application/scim+json"
    $op = $unsupportedResult.Operations[0]
    Test-Result -Success ($op.status -eq "400") -Message "9n.12 Unsupported resource type returns 400 in-band (status=$($op.status))"
} catch {
    Test-Result -Success $false -Message "9n.12 Unsupported resource type test failed: $_"
}

# --- Test 9n.13: Mixed user + group operations ---
Write-Host "`n--- Test 9n.13: Mixed user + group operations ---" -ForegroundColor Cyan
$mixedBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{
            method = "POST"
            path = "/Users"
            bulkId = "mixed-user"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                userName = "bulk-mixed-user-$(Get-Random)"
                displayName = "Mixed Bulk User"
            }
        },
        @{
            method = "POST"
            path = "/Groups"
            bulkId = "mixed-group"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
                displayName = "Mixed Bulk Group $(Get-Random)"
            }
        }
    )
} | ConvertTo-Json -Depth 5
try {
    $mixedResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $mixedBody -ContentType "application/scim+json"
    $userOp = $mixedResult.Operations[0]
    $groupOp = $mixedResult.Operations[1]
    $mixedUserId = $userOp.location -replace '.*/', ''
    $mixedGroupId = $groupOp.location -replace '.*/', ''
    Test-Result -Success ($userOp.status -eq "201" -and $groupOp.status -eq "201") -Message "9n.13 Mixed ops: User=$($userOp.status), Group=$($groupOp.status)"
    # Clean up
    if ($mixedUserId) { try { $null = Invoke-RestMethod -Uri "$scimBaseBulk/Users/$mixedUserId" -Method DELETE -Headers $headers } catch {} }
    if ($mixedGroupId) { try { $null = Invoke-RestMethod -Uri "$scimBaseBulk/Groups/$mixedGroupId" -Method DELETE -Headers $headers } catch {} }
} catch {
    Test-Result -Success $false -Message "9n.13 Mixed operations failed: $_"
}

# --- Test 9n.14: ServiceProviderConfig advertises bulk.supported=true ---
Write-Host "`n--- Test 9n.14: SPC advertises bulk.supported=true ---" -ForegroundColor Cyan
try {
    $spc = Invoke-RestMethod -Uri "$scimBaseBulk/ServiceProviderConfig" -Method GET -Headers $headers
    Test-Result -Success ($spc.bulk.supported -eq $true -and $spc.bulk.maxOperations -eq 1000) -Message "9n.14 SPC bulk.supported=$($spc.bulk.supported), maxOperations=$($spc.bulk.maxOperations)"
} catch {
    Test-Result -Success $false -Message "9n.14 SPC check failed: $_"
}

# --- Test 9n.15: Response includes BulkResponse schema ---
Write-Host "`n--- Test 9n.15: Response includes BulkResponse schema ---" -ForegroundColor Cyan
$schemaCheckBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{
            method = "POST"
            path = "/Users"
            bulkId = "schema-check"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                userName = "bulk-schema-check-$(Get-Random)"
            }
        }
    )
} | ConvertTo-Json -Depth 5
try {
    $schemaResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $schemaCheckBody -ContentType "application/scim+json"
    $hasResponseSchema = $schemaResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:BulkResponse"
    $hasBulkId = $schemaResult.Operations[0].bulkId -eq "schema-check"
    Test-Result -Success ($hasResponseSchema -and $hasBulkId) -Message "9n.15 Response has BulkResponse schema=$hasResponseSchema, bulkId echo=$hasBulkId"
    # Clean up
    $scUserId = $schemaResult.Operations[0].location -replace '.*/', ''
    if ($scUserId) { try { $null = Invoke-RestMethod -Uri "$scimBaseBulk/Users/$scUserId" -Method DELETE -Headers $headers } catch {} }
} catch {
    Test-Result -Success $false -Message "9n.15 Schema check failed: $_"
}

# --- Test 9n.16: Duplicate userName collision via bulk ---
Write-Host "`n--- Test 9n.16: Uniqueness collision ---" -ForegroundColor Cyan
$dupeUserName = "bulk-dupe-$(Get-Random)"
$dupeBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
    Operations = @(
        @{
            method = "POST"
            path = "/Users"
            bulkId = "dupe1"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                userName = $dupeUserName
            }
        },
        @{
            method = "POST"
            path = "/Users"
            bulkId = "dupe2"
            data = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
                userName = $dupeUserName
            }
        }
    )
} | ConvertTo-Json -Depth 5
try {
    $dupeResult = Invoke-RestMethod -Uri "$scimBaseBulk/Bulk" -Method POST -Headers $headers -Body $dupeBody -ContentType "application/scim+json"
    $op1 = $dupeResult.Operations[0]
    $op2 = $dupeResult.Operations[1]
    Test-Result -Success ($op1.status -eq "201" -and $op2.status -eq "409") -Message "9n.16 Uniqueness: first=$($op1.status), duplicate=$($op2.status)"
    # Clean up the first user
    $dupeUserId = $op1.location -replace '.*/', ''
    if ($dupeUserId) { try { $null = Invoke-RestMethod -Uri "$scimBaseBulk/Users/$dupeUserId" -Method DELETE -Headers $headers } catch {} }
} catch {
    Test-Result -Success $false -Message "9n.16 Uniqueness collision test failed: $_"
}

# --- Cleanup: Delete bulk test endpoints ---
Write-Host "`n--- Bulk Cleanup: Deleting test endpoints ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$BulkEndpointId" -Method DELETE -Headers $headers
    Test-Result -Success $true -Message "Bulk enabled endpoint cleaned up"
} catch {
    Test-Result -Success $false -Message "Bulk endpoint cleanup: $_"
}
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$BulkNoFlagEndpointId" -Method DELETE -Headers $headers
    Test-Result -Success $true -Message "Bulk no-flag endpoint cleaned up"
} catch {
    Test-Result -Success $false -Message "Bulk no-flag endpoint cleanup: $_"
}

Write-Host "`n--- Phase 9: Bulk Operations Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9o: GROUP UNIQUENESS ON PUT/PATCH (G8f)
$script:currentSection = "9o: Group Uniqueness PUT/PATCH (G8f)"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9o: GROUP UNIQUENESS ON PUT/PATCH (G8f)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# RFC 7644 §3.5.1 (PUT) / §3.5.2 (PATCH): Unique displayName and externalId must be
# enforced on replace/modify operations, not just POST create.
# G8f ensures assertUniqueDisplayName/assertUniqueExternalId are called on PUT/PATCH.

# --- Setup: Create two groups for uniqueness collision testing ---
Write-Host "`n--- Setup: Create Groups for G8f Uniqueness Tests ---" -ForegroundColor Cyan
$g8fGroupABody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "G8f-GroupA-$(Get-Random)"
    externalId = "g8f-ext-a-$(Get-Random)"
} | ConvertTo-Json
$g8fGroupA = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $g8fGroupABody
$g8fGroupAId = $g8fGroupA.id
Test-Result -Success ($null -ne $g8fGroupAId) -Message "G8f setup: Created GroupA (id=$g8fGroupAId)"

$g8fGroupBBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "G8f-GroupB-$(Get-Random)"
    externalId = "g8f-ext-b-$(Get-Random)"
} | ConvertTo-Json
$g8fGroupB = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $g8fGroupBBody
$g8fGroupBId = $g8fGroupB.id
Test-Result -Success ($null -ne $g8fGroupBId) -Message "G8f setup: Created GroupB (id=$g8fGroupBId)"

# Test 9o.1: PUT — changing displayName to GroupA's name → 409
Write-Host "`n--- Test 9o.1: PUT GroupB with GroupA's displayName → 409 ---" -ForegroundColor Cyan
$g8fPutConflictBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = $g8fGroupA.displayName
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method PUT -Headers $headers -Body $g8fPutConflictBody
    Test-Result -Success $false -Message "PUT with conflicting displayName should return 409"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($status -eq 409) -Message "PUT with conflicting displayName returns 409 (got $status)"
}

# Test 9o.2: PUT — self-update keeping same displayName → 200
Write-Host "`n--- Test 9o.2: PUT GroupA keeping own displayName → 200 ---" -ForegroundColor Cyan
$g8fPutSelfBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = $g8fGroupA.displayName
    externalId = $g8fGroupA.externalId
} | ConvertTo-Json
try {
    $g8fPutSelf = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupAId" -Method PUT -Headers $headers -Body $g8fPutSelfBody
    Test-Result -Success ($g8fPutSelf.displayName -eq $g8fGroupA.displayName) -Message "PUT self-update with same displayName succeeds"
} catch {
    Test-Result -Success $false -Message "PUT self-update should succeed: $_"
}

# Test 9o.3: PUT — changing externalId to GroupA's externalId → 409
Write-Host "`n--- Test 9o.3: PUT GroupB with GroupA's externalId → 409 ---" -ForegroundColor Cyan
$g8fPutExtConflictBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = $g8fGroupB.displayName
    externalId = $g8fGroupA.externalId
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method PUT -Headers $headers -Body $g8fPutExtConflictBody
    Test-Result -Success $false -Message "PUT with conflicting externalId should return 409"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($status -eq 409) -Message "PUT with conflicting externalId returns 409 (got $status)"
}

# Test 9o.4: PATCH — changing displayName to GroupA's name → 409
Write-Host "`n--- Test 9o.4: PATCH GroupB with GroupA's displayName → 409 ---" -ForegroundColor Cyan
$g8fPatchConflictBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ displayName = $g8fGroupA.displayName }
    })
} | ConvertTo-Json -Depth 4
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method PATCH -Headers $headers -Body $g8fPatchConflictBody
    Test-Result -Success $false -Message "PATCH with conflicting displayName should return 409"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($status -eq 409) -Message "PATCH with conflicting displayName returns 409 (got $status)"
}

# Test 9o.5: PATCH — update to unique displayName → 200
Write-Host "`n--- Test 9o.5: PATCH GroupB with unique displayName → 200 ---" -ForegroundColor Cyan
$g8fNewName = "G8f-Unique-$(Get-Random)"
$g8fPatchUniqueBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ displayName = $g8fNewName }
    })
} | ConvertTo-Json -Depth 4
try {
    $g8fPatchUnique = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method PATCH -Headers $headers -Body $g8fPatchUniqueBody
    Test-Result -Success ($g8fPatchUnique.displayName -eq $g8fNewName) -Message "PATCH with unique displayName succeeds"
} catch {
    Test-Result -Success $false -Message "PATCH with unique displayName should succeed: $_"
}

# Test 9o.6: PATCH — changing externalId to GroupA's externalId → 409
Write-Host "`n--- Test 9o.6: PATCH GroupB with GroupA's externalId → 409 ---" -ForegroundColor Cyan
$g8fPatchExtConflictBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ externalId = $g8fGroupA.externalId }
    })
} | ConvertTo-Json -Depth 4
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method PATCH -Headers $headers -Body $g8fPatchExtConflictBody
    Test-Result -Success $false -Message "PATCH with conflicting externalId should return 409"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($status -eq 409) -Message "PATCH with conflicting externalId returns 409 (got $status)"
}

# --- G8f Cleanup ---
Write-Host "`n--- G8f Cleanup: Deleting test groups ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupAId" -Method DELETE -Headers $headers
    Test-Result -Success $true -Message "G8f GroupA cleaned up"
} catch {
    Test-Result -Success $false -Message "G8f GroupA cleanup: $_"
}
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method DELETE -Headers $headers
    Test-Result -Success $true -Message "G8f GroupB cleaned up"
} catch {
    Test-Result -Success $false -Message "G8f GroupB cleanup: $_"
}

Write-Host "`n--- G8f: Group Uniqueness on PUT/PATCH Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9p: WRITE-RESPONSE ATTRIBUTE PROJECTION (G8g)
$script:currentSection = "9p: Write-Response Projection (G8g)"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9p: WRITE-RESPONSE ATTRIBUTE PROJECTION (G8g)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# RFC 7644 §3.9: Clients MAY include attributes/excludedAttributes query params
# on POST, PUT, and PATCH operations to control which attributes are returned
# in the write-response body.

# --- Setup: Create a user for projection testing ---
Write-Host "`n--- Setup: Create User for G8g Projection Tests ---" -ForegroundColor Cyan
$g8gUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "g8g-proj-test-$(Get-Random)@test.com"
    displayName = "G8g Projection User"
    name = @{ givenName = "G8g"; familyName = "Proj" }
    emails = @(@{ value = "g8g-proj@test.com"; type = "work"; primary = $true })
    active = $true
} | ConvertTo-Json -Depth 3

# Test 9p.1: POST /Users?attributes=userName — only userName + always-returned in response
Write-Host "`n--- Test 9p.1: POST /Users?attributes=userName --- projection on create ---" -ForegroundColor Cyan
$g8gPostResult = Invoke-RestMethod -Uri "$scimBase/Users?attributes=userName" -Method POST -Headers $headers -Body $g8gUserBody
$g8gUserId = $g8gPostResult.id
Test-Result -Success ($null -ne $g8gUserId) -Message "POST with ?attributes=userName returns id (always-returned)"
Test-Result -Success ($null -ne $g8gPostResult.userName) -Message "POST with ?attributes=userName returns userName (requested)"
Test-Result -Success ($null -ne $g8gPostResult.schemas) -Message "POST with ?attributes=userName returns schemas (always-returned)"
Test-Result -Success ($null -eq $g8gPostResult.displayName) -Message "POST with ?attributes=userName omits displayName (not requested)"
Test-Result -Success ($null -eq $g8gPostResult.emails) -Message "POST with ?attributes=userName omits emails (not requested)"

# Test 9p.2: PUT /Users/:id?attributes=displayName — only displayName + always-returned
Write-Host "`n--- Test 9p.2: PUT /Users?attributes=displayName --- projection on replace ---" -ForegroundColor Cyan
$g8gPutBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $g8gPostResult.userName
    displayName = "G8g Put Updated"
    active = $true
} | ConvertTo-Json -Depth 3
$g8gPutResult = Invoke-RestMethod -Uri "$scimBase/Users/${g8gUserId}?attributes=displayName" -Method PUT -Headers $headers -Body $g8gPutBody
Test-Result -Success ($g8gPutResult.displayName -eq "G8g Put Updated") -Message "PUT ?attributes=displayName returns displayName (requested)"
Test-Result -Success ($null -ne $g8gPutResult.id) -Message "PUT ?attributes=displayName returns id (always-returned)"
Test-Result -Success ($null -eq $g8gPutResult.emails) -Message "PUT ?attributes=displayName omits emails (not requested)"

# Test 9p.3: PATCH /Users/:id?excludedAttributes=name,emails — omit specified
Write-Host "`n--- Test 9p.3: PATCH /Users?excludedAttributes=name,emails --- omit specified ---" -ForegroundColor Cyan
$g8gPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ displayName = "G8g Patch Updated" }
    })
} | ConvertTo-Json -Depth 4
$g8gPatchResult = Invoke-RestMethod -Uri "$scimBase/Users/${g8gUserId}?excludedAttributes=name,emails" -Method PATCH -Headers $headers -Body $g8gPatchBody
Test-Result -Success ($g8gPatchResult.displayName -eq "G8g Patch Updated") -Message "PATCH ?excludedAttributes=name,emails returns displayName (not excluded)"
Test-Result -Success ($null -ne $g8gPatchResult.userName) -Message "PATCH ?excludedAttributes=name,emails returns userName (not excluded)"
Test-Result -Success ($null -eq $g8gPatchResult.name) -Message "PATCH ?excludedAttributes=name,emails omits name (excluded)"
Test-Result -Success ($null -eq $g8gPatchResult.emails) -Message "PATCH ?excludedAttributes=name,emails omits emails (excluded)"

# Test 9p.4: POST /Groups?attributes=displayName — projection on group create
Write-Host "`n--- Test 9p.4: POST /Groups?attributes=displayName --- projection on group create ---" -ForegroundColor Cyan
$g8gGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "G8g-ProjGroup-$(Get-Random)"
} | ConvertTo-Json
$g8gGroupResult = Invoke-RestMethod -Uri "$scimBase/Groups?attributes=displayName" -Method POST -Headers $headers -Body $g8gGroupBody
$g8gGroupId = $g8gGroupResult.id
Test-Result -Success ($null -ne $g8gGroupId) -Message "POST Groups ?attributes=displayName returns id (always-returned)"
Test-Result -Success ($null -ne $g8gGroupResult.displayName) -Message "POST Groups ?attributes=displayName returns displayName (requested)"
Test-Result -Success ($null -eq $g8gGroupResult.members) -Message "POST Groups ?attributes=displayName omits members (not requested)"

# Test 9p.5: PUT /Groups/:id?excludedAttributes=members — omit members on replace
Write-Host "`n--- Test 9p.5: PUT /Groups?excludedAttributes=members --- omit members ---" -ForegroundColor Cyan
$g8gGroupPutBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "G8g-ProjGroup-Updated"
} | ConvertTo-Json
$g8gGroupPutResult = Invoke-RestMethod -Uri "$scimBase/Groups/${g8gGroupId}?excludedAttributes=members" -Method PUT -Headers $headers -Body $g8gGroupPutBody
Test-Result -Success ($g8gGroupPutResult.displayName -eq "G8g-ProjGroup-Updated") -Message "PUT Groups ?excludedAttributes=members returns displayName (not excluded)"
Test-Result -Success ($null -eq $g8gGroupPutResult.members) -Message "PUT Groups ?excludedAttributes=members omits members (excluded)"

# Test 9p.6: PATCH /Groups?attributes=displayName — only requested attrs
Write-Host "`n--- Test 9p.6: PATCH /Groups?attributes=displayName --- projection on group patch ---" -ForegroundColor Cyan
$g8gGroupPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ displayName = "G8g-ProjGroup-Patched" }
    })
} | ConvertTo-Json -Depth 4
$g8gGroupPatchResult = Invoke-RestMethod -Uri "$scimBase/Groups/${g8gGroupId}?attributes=displayName" -Method PATCH -Headers $headers -Body $g8gGroupPatchBody
Test-Result -Success ($g8gGroupPatchResult.displayName -eq "G8g-ProjGroup-Patched") -Message "PATCH Groups ?attributes=displayName returns displayName (requested)"
Test-Result -Success ($null -ne $g8gGroupPatchResult.id) -Message "PATCH Groups ?attributes=displayName returns id (always-returned)"
Test-Result -Success ($null -eq $g8gGroupPatchResult.members) -Message "PATCH Groups ?attributes=displayName omits members (not requested)"

# Test 9p.7: POST /Users with BOTH attributes AND excludedAttributes — attributes wins
Write-Host "`n--- Test 9p.7: POST /Users with BOTH params --- attributes takes precedence ---" -ForegroundColor Cyan
$g8gBothBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "g8g-both-test-$(Get-Random)@test.com"
    displayName = "G8g Both Test"
    name = @{ givenName = "Both"; familyName = "Test" }
    emails = @(@{ value = "g8g-both@test.com"; type = "work"; primary = $true })
    active = $true
} | ConvertTo-Json -Depth 3
$g8gBothResult = Invoke-RestMethod -Uri "$scimBase/Users?attributes=userName,displayName&excludedAttributes=displayName" -Method POST -Headers $headers -Body $g8gBothBody
$g8gBothUserId = $g8gBothResult.id
Test-Result -Success ($null -ne $g8gBothResult.userName) -Message "Both params: attributes wins — userName present (requested)"
Test-Result -Success ($null -ne $g8gBothResult.displayName) -Message "Both params: attributes wins — displayName present (in attributes list)"
Test-Result -Success ($null -ne $g8gBothResult.id) -Message "Both params: id present (always-returned)"
Test-Result -Success ($null -eq $g8gBothResult.emails) -Message "Both params: emails absent (not in attributes list)"

# Test 9p.8: POST /Users with excludedAttributes=id,schemas,meta — always-returned protection
Write-Host "`n--- Test 9p.8: excludedAttributes=id,schemas,meta --- always-returned protection ---" -ForegroundColor Cyan
$g8gAlwaysBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "g8g-always-test-$(Get-Random)@test.com"
    displayName = "G8g Always Test"
    active = $true
} | ConvertTo-Json -Depth 3
$g8gAlwaysResult = Invoke-RestMethod -Uri "$scimBase/Users?excludedAttributes=id,schemas,meta" -Method POST -Headers $headers -Body $g8gAlwaysBody
$g8gAlwaysUserId = $g8gAlwaysResult.id
Test-Result -Success ($null -ne $g8gAlwaysResult.id) -Message "Always-returned protection: id present (cannot be excluded)"
Test-Result -Success ($null -ne $g8gAlwaysResult.schemas) -Message "Always-returned protection: schemas present (cannot be excluded)"
Test-Result -Success ($null -ne $g8gAlwaysResult.meta) -Message "Always-returned protection: meta present (cannot be excluded)"
Test-Result -Success ($null -ne $g8gAlwaysResult.userName) -Message "Always-returned protection: userName present (always-returned for User)"

# Test 9p.9: PUT /Users?excludedAttributes=emails,name — omit specified on PUT
Write-Host "`n--- Test 9p.9: PUT /Users?excludedAttributes=emails,name --- omit specified on replace ---" -ForegroundColor Cyan
$g8gPutExclBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $g8gPostResult.userName
    displayName = "G8g Put Excl Updated"
    active = $true
} | ConvertTo-Json -Depth 3
$g8gPutExclResult = Invoke-RestMethod -Uri "$scimBase/Users/${g8gUserId}?excludedAttributes=emails,name" -Method PUT -Headers $headers -Body $g8gPutExclBody
Test-Result -Success ($g8gPutExclResult.displayName -eq "G8g Put Excl Updated") -Message "PUT ?excludedAttributes=emails,name returns displayName (not excluded)"
Test-Result -Success ($null -ne $g8gPutExclResult.userName) -Message "PUT ?excludedAttributes=emails,name returns userName (always-returned)"
Test-Result -Success ($null -eq $g8gPutExclResult.emails) -Message "PUT ?excludedAttributes=emails,name omits emails (excluded)"
Test-Result -Success ($null -eq $g8gPutExclResult.name) -Message "PUT ?excludedAttributes=emails,name omits name (excluded)"

# --- G8g Extended Cleanup ---
Write-Host "`n--- G8g Extended Cleanup: Deleting additional test resources ---" -ForegroundColor Cyan
try {
    if ($g8gBothUserId) { $null = Invoke-RestMethod -Uri "$scimBase/Users/$g8gBothUserId" -Method DELETE -Headers $headers }
    if ($g8gAlwaysUserId) { $null = Invoke-RestMethod -Uri "$scimBase/Users/$g8gAlwaysUserId" -Method DELETE -Headers $headers }
    Test-Result -Success $true -Message "G8g extended test users cleaned up"
} catch {
    Test-Result -Success $false -Message "G8g extended cleanup: $_"
}

# --- G8g Cleanup ---
Write-Host "`n--- G8g Cleanup: Deleting test resources ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Users/$g8gUserId" -Method DELETE -Headers $headers
    Test-Result -Success $true -Message "G8g test user cleaned up"
} catch {
    Test-Result -Success $false -Message "G8g user cleanup: $_"
}
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Groups/$g8gGroupId" -Method DELETE -Headers $headers
    Test-Result -Success $true -Message "G8g test group cleaned up"
} catch {
    Test-Result -Success $false -Message "G8g group cleanup: $_"
}

Write-Host "`n--- G8g: Write-Response Projection Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9q: SORTING (Phase 12 / RFC 7644 S3.4.2.3)
$script:currentSection = "9q: Sorting"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9q: SORTING (Phase 12 / RFC 7644 S3.4.2.3)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create users with distinct, sortable userNames ---
Write-Host "`n--- Setup: Create Users for Sorting Tests ---" -ForegroundColor Cyan
$sortUserIds = @()
$sortNames = @("alpha-sort@test.com", "charlie-sort@test.com", "bravo-sort@test.com")
foreach ($sn in $sortNames) {
    $sortBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
        userName = $sn
        displayName = "Sort User $sn"
        active = $true
    } | ConvertTo-Json
    $sortUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $sortBody
    $sortUserIds += $sortUser.id
    Write-Host "  Created sort test user: $sn ($($sortUser.id))"
}

# Test 9q.1: GET /Users?sortBy=userName&sortOrder=ascending
Write-Host "`n--- Test 9q.1: GET /Users?sortBy=userName&sortOrder=ascending ---" -ForegroundColor Cyan
$sortAsc = Invoke-RestMethod -Uri "$scimBase/Users?sortBy=userName&sortOrder=ascending&filter=userName co `"sort@test.com`"" -Method GET -Headers $headers
Test-Result -Success ($sortAsc.Resources.Count -ge 3) -Message "Sort ascending: returned >= 3 sort users"
$userNamesAsc = $sortAsc.Resources | ForEach-Object { $_.userName }
$isSorted = $true
for ($i = 0; $i -lt $userNamesAsc.Count - 1; $i++) {
    if ($userNamesAsc[$i] -gt $userNamesAsc[$i+1]) { $isSorted = $false; break }
}
Test-Result -Success $isSorted -Message "Sort ascending: userNames are in ascending order"

# Test 9q.2: GET /Users?sortBy=userName&sortOrder=descending
Write-Host "`n--- Test 9q.2: GET /Users?sortBy=userName&sortOrder=descending ---" -ForegroundColor Cyan
$sortDesc = Invoke-RestMethod -Uri "$scimBase/Users?sortBy=userName&sortOrder=descending&filter=userName co `"sort@test.com`"" -Method GET -Headers $headers
$userNamesDesc = $sortDesc.Resources | ForEach-Object { $_.userName }
$isSortedDesc = $true
for ($i = 0; $i -lt $userNamesDesc.Count - 1; $i++) {
    if ($userNamesDesc[$i] -lt $userNamesDesc[$i+1]) { $isSortedDesc = $false; break }
}
Test-Result -Success $isSortedDesc -Message "Sort descending: userNames are in descending order"

# Test 9q.3: Default sortOrder is ascending when only sortBy is specified
Write-Host "`n--- Test 9q.3: Default sortOrder is ascending ---" -ForegroundColor Cyan
$sortDefault = Invoke-RestMethod -Uri "$scimBase/Users?sortBy=userName&filter=userName co `"sort@test.com`"" -Method GET -Headers $headers
$userNamesDefault = $sortDefault.Resources | ForEach-Object { $_.userName }
$isSortedDefault = $true
for ($i = 0; $i -lt $userNamesDefault.Count - 1; $i++) {
    if ($userNamesDefault[$i] -gt $userNamesDefault[$i+1]) { $isSortedDefault = $false; break }
}
Test-Result -Success $isSortedDefault -Message "Default sortOrder: ascending when sortBy specified without sortOrder"

# Test 9q.4: POST /.search with sortBy/sortOrder in body
Write-Host "`n--- Test 9q.4: POST /.search with sorting ---" -ForegroundColor Cyan
$searchSortBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = "userName co `"sort@test.com`""
    sortBy = "userName"
    sortOrder = "descending"
} | ConvertTo-Json
$searchSortResult = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $searchSortBody
$searchNames = $searchSortResult.Resources | ForEach-Object { $_.userName }
$isSearchSorted = $true
for ($i = 0; $i -lt $searchNames.Count - 1; $i++) {
    if ($searchNames[$i] -lt $searchNames[$i+1]) { $isSearchSorted = $false; break }
}
Test-Result -Success $isSearchSorted -Message "POST /.search: sorting works in search body (descending)"

# Test 9q.5: Sorting with pagination (sortBy + count + startIndex)
Write-Host "`n--- Test 9q.5: Sorting with pagination ---" -ForegroundColor Cyan
$sortPag = Invoke-RestMethod -Uri "$scimBase/Users?sortBy=userName&sortOrder=ascending&filter=userName co `"sort@test.com`"&count=2&startIndex=1" -Method GET -Headers $headers
Test-Result -Success ($sortPag.Resources.Count -le 2) -Message "Sorting with pagination: respects count=2"
Test-Result -Success ($sortPag.totalResults -ge 3) -Message "Sorting with pagination: totalResults reflects all matching"

# Test 9q.6: Sort Groups by displayName
Write-Host "`n--- Test 9q.6: Sort Groups by displayName ---" -ForegroundColor Cyan
$sortGroupIds = @()
$sortGroupNames = @("Zebra-Sort-Group", "Alpha-Sort-Group", "Mango-Sort-Group")
foreach ($sgn in $sortGroupNames) {
    $sgBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
        displayName = $sgn
    } | ConvertTo-Json
    $sg = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $sgBody
    $sortGroupIds += $sg.id
    Write-Host "  Created sort test group: $sgn ($($sg.id))"
}
$sortGroups = Invoke-RestMethod -Uri "$scimBase/Groups?sortBy=displayName&sortOrder=ascending&filter=displayName co `"Sort-Group`"" -Method GET -Headers $headers
$groupNamesAsc = $sortGroups.Resources | ForEach-Object { $_.displayName }
$isGroupSorted = $true
for ($i = 0; $i -lt $groupNamesAsc.Count - 1; $i++) {
    if ($groupNamesAsc[$i] -gt $groupNamesAsc[$i+1]) { $isGroupSorted = $false; break }
}
Test-Result -Success $isGroupSorted -Message "Sort Groups by displayName ascending: correct order"

# Test 9q.7: SPC /ServiceProviderConfig reflects sort.supported=true
Write-Host "`n--- Test 9q.7: SPC sort.supported ---" -ForegroundColor Cyan
$spc = Invoke-RestMethod -Uri "$scimBase/ServiceProviderConfig" -Method GET -Headers $headers
Test-Result -Success ($spc.sort.supported -eq $true) -Message "ServiceProviderConfig: sort.supported is true"

# --- 9q Cleanup ---
Write-Host "`n--- 9q Cleanup: Deleting sort test resources ---" -ForegroundColor Cyan
foreach ($sid in $sortUserIds) {
    try { $null = Invoke-RestMethod -Uri "$scimBase/Users/$sid" -Method DELETE -Headers $headers } catch {}
}
foreach ($sgid in $sortGroupIds) {
    try { $null = Invoke-RestMethod -Uri "$scimBase/Groups/$sgid" -Method DELETE -Headers $headers } catch {}
}
Test-Result -Success $true -Message "Sort test resources cleaned up"

Write-Host "`n--- 9q: Sorting Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9r: /Me ENDPOINT (Phase 10 / RFC 7644 S3.11)
$script:currentSection = "9r: /Me Endpoint"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9r: /Me ENDPOINT (Phase 10 / RFC 7644 S3.11)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# The /Me endpoint resolves the currently authenticated subject (JWT sub claim)
# to a SCIM User whose userName matches. The live-test OAuth token has sub=$ClientId.

# --- Setup: Create a user whose userName matches the OAuth sub claim ---
Write-Host "`n--- Setup: Create User matching JWT sub claim ($ClientId) ---" -ForegroundColor Cyan
$meUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $ClientId
    displayName = "Me Test User"
    name = @{ givenName = "Me"; familyName = "Test" }
    emails = @(@{ value = "me-test@test.com"; type = "work"; primary = $true })
    active = $true
} | ConvertTo-Json -Depth 3
$meUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $meUserBody
$meUserId = $meUser.id
Write-Host "  Created /Me test user: $ClientId ($meUserId)"
Test-Result -Success ($null -ne $meUserId) -Message "/Me setup: user created with userName=$ClientId"

# Test 9r.1: GET /Me returns the authenticated user
Write-Host "`n--- Test 9r.1: GET /Me ---" -ForegroundColor Cyan
$meGet = Invoke-RestMethod -Uri "$scimBase/Me" -Method GET -Headers $headers
Test-Result -Success ($meGet.id -eq $meUserId) -Message "GET /Me: returns correct user id"
Test-Result -Success ($meGet.userName -eq $ClientId) -Message "GET /Me: userName matches JWT sub"
Test-Result -Success ($null -ne $meGet.meta) -Message "GET /Me: includes meta"

# Test 9r.2: GET /Me?attributes=userName — attribute projection
Write-Host "`n--- Test 9r.2: GET /Me?attributes=userName ---" -ForegroundColor Cyan
$meGetProj = Invoke-RestMethod -Uri "$scimBase/Me?attributes=userName" -Method GET -Headers $headers
Test-Result -Success ($null -ne $meGetProj.userName) -Message "GET /Me?attributes=userName: userName present"
Test-Result -Success ($null -eq $meGetProj.displayName) -Message "GET /Me?attributes=userName: displayName omitted"

# Test 9r.3: PATCH /Me — update displayName
Write-Host "`n--- Test 9r.3: PATCH /Me ---" -ForegroundColor Cyan
$mePatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ displayName = "Me Patched" }
    })
} | ConvertTo-Json -Depth 4
$mePatch = Invoke-RestMethod -Uri "$scimBase/Me" -Method PATCH -Headers $headers -Body $mePatchBody
Test-Result -Success ($mePatch.displayName -eq "Me Patched") -Message "PATCH /Me: displayName updated"
Test-Result -Success ($mePatch.id -eq $meUserId) -Message "PATCH /Me: same user id"

# Test 9r.4: Verify PATCH persisted via GET /Me
Write-Host "`n--- Test 9r.4: Verify PATCH /Me persisted ---" -ForegroundColor Cyan
$meGetAfterPatch = Invoke-RestMethod -Uri "$scimBase/Me" -Method GET -Headers $headers
Test-Result -Success ($meGetAfterPatch.displayName -eq "Me Patched") -Message "GET /Me after PATCH: displayName persisted"

# Test 9r.5: PUT /Me — full replace
Write-Host "`n--- Test 9r.5: PUT /Me ---" -ForegroundColor Cyan
$mePutBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $ClientId
    displayName = "Me Put Replaced"
    active = $true
} | ConvertTo-Json -Depth 3
$mePut = Invoke-RestMethod -Uri "$scimBase/Me" -Method PUT -Headers $headers -Body $mePutBody
Test-Result -Success ($mePut.displayName -eq "Me Put Replaced") -Message "PUT /Me: displayName replaced"
Test-Result -Success ($mePut.id -eq $meUserId) -Message "PUT /Me: same user id"

# Test 9r.6: Cross-validate GET /Me matches GET /Users/{id}
Write-Host "`n--- Test 9r.6: Cross-validate /Me vs /Users/{id} ---" -ForegroundColor Cyan
$meGetFinal = Invoke-RestMethod -Uri "$scimBase/Me" -Method GET -Headers $headers
$directGet = Invoke-RestMethod -Uri "$scimBase/Users/$meUserId" -Method GET -Headers $headers
Test-Result -Success ($meGetFinal.userName -eq $directGet.userName) -Message "Cross-validate: /Me and /Users/{id} return same userName"
Test-Result -Success ($meGetFinal.displayName -eq $directGet.displayName) -Message "Cross-validate: /Me and /Users/{id} return same displayName"

# Test 9r.7: DELETE /Me
Write-Host "`n--- Test 9r.7: DELETE /Me ---" -ForegroundColor Cyan
$null = Invoke-WebRequest -Uri "$scimBase/Me" -Method DELETE -Headers $headers
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Me" -Method GET -Headers $headers
    Test-Result -Success $false -Message "DELETE /Me: user should no longer exist"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "DELETE /Me: returns 404 after deletion"
}

# Test 9r.8: GET /Me when no matching user — 404
Write-Host "`n--- Test 9r.8: GET /Me with no matching user ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Me" -Method GET -Headers $headers
    Test-Result -Success $false -Message "/Me no matching user: should return 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 404) -Message "/Me no matching user: returns 404"
}

Write-Host "`n--- 9r: /Me Endpoint Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 10: DELETE OPERATIONS
$script:currentSection = "10: Cleanup"
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
if ($NoRemoveAllEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$NoRemoveAllEndpointId" -Name "No Remove All Endpoint" }
if ($VPEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$VPEndpointId" -Name "Verbose Patch Endpoint" }
if ($G8bEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$G8bEndpointId" -Name "G8b Custom Resource Types Endpoint" }
if ($G8bNoFlagEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$G8bNoFlagEndpointId" -Name "G8b No Flag Endpoint" }

# ============================================
# FINAL SUMMARY
# ============================================
$elapsed = (Get-Date) - $script:startTime
$finishedAt = Get-Date

Write-Host "`n`n========================================" -ForegroundColor Magenta
Write-Host "FINAL TEST SUMMARY" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "Tests Passed: $testsPassed" -ForegroundColor Green
Write-Host "Tests Failed: $testsFailed" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Red" })
Write-Host "Total Tests:  $($testsPassed + $testsFailed)" -ForegroundColor Cyan
Write-Host "Duration:     $([math]::Round($elapsed.TotalSeconds, 1))s" -ForegroundColor Cyan
Write-VerboseLog "Base URL" $baseUrl

if ($testsFailed -eq 0) {
    Write-Host "`n🎉 ALL TESTS PASSED!" -ForegroundColor Green
} else {
    Write-Host "`n⚠️ Some tests failed. Review output above." -ForegroundColor Yellow
}

# ============================================
# WRITE JSON RESULTS FILE
# ============================================
$totalTests = $testsPassed + $testsFailed
$successRate = if ($totalTests -gt 0) { [math]::Round(($testsPassed / $totalTests) * 100, 1) } else { 0 }
$timestamp = $finishedAt.ToString("yyyy-MM-dd_HH-mm-ss")
$runId = "live-$timestamp"

# Determine target (local vs docker vs azure)
$target = if ($baseUrl -match 'localhost:8080|:8080') { "docker" }
           elseif ($baseUrl -match 'azurecontainerapps|azure') { "azure" }
           else { "local" }

# Group tests by section for the sections array
$sectionGroups = $script:testResults | Group-Object -Property section
$sectionsArray = @()
foreach ($group in $sectionGroups) {
    $sectionPassed = ($group.Group | Where-Object { $_.status -eq 'passed' }).Count
    $sectionFailed = ($group.Group | Where-Object { $_.status -eq 'failed' }).Count
    $sectionsArray += [PSCustomObject]@{
        name   = $group.Name
        tests  = $group.Count
        passed = $sectionPassed
        failed = $sectionFailed
        status = if ($sectionFailed -eq 0) { "passed" } else { "failed" }
    }
}

# Build the full results object
$resultsObj = [ordered]@{
    testRunner        = "Live Integration Tests (SCIMServer)"
    version           = "0.11.0"
    runId             = $runId
    target            = $target
    baseUrl           = $baseUrl
    startedAt         = $script:startTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    finishedAt        = $finishedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    durationMs        = [math]::Round($elapsed.TotalMilliseconds)
    durationFormatted = "$([math]::Round($elapsed.TotalSeconds, 1))s"
    environment       = [ordered]@{
        hostname = $env:COMPUTERNAME
        platform = if ($IsLinux) { "linux" } elseif ($IsMacOS) { "darwin" } else { "win32" }
        powershellVersion = $PSVersionTable.PSVersion.ToString()
    }
    summary           = [ordered]@{
        totalSections = $sectionGroups.Count
        totalTests    = $totalTests
        passed        = $testsPassed
        failed        = $testsFailed
        totalFlowSteps = $script:flowSteps.Count
        successRate   = "$successRate%"
    }
    sections          = $sectionsArray
    tests             = $script:testResults
    flowSteps         = $script:flowSteps
}

# Write to test-results directory
$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $repoRoot "test-results"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$outFile = Join-Path $outDir "$runId.json"
$latestFile = Join-Path $outDir "live-results-latest.json"

$jsonContent = $resultsObj | ConvertTo-Json -Depth 10

$jsonContent | Out-File -FilePath $outFile -Encoding utf8
$jsonContent | Out-File -FilePath $latestFile -Encoding utf8

Write-Host "`n📊 Live test results JSON written to: test-results/$runId.json" -ForegroundColor Cyan

Write-Host "`n========================================`n" -ForegroundColor Magenta
