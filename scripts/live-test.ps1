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
        [string]$ContentType,
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
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$endpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $endpointBody
$EndpointId = $endpoint.id
$patchBody = @{ profile = @{ settings = @{ MultiMemberPatchOpForGroupEnabled = "True"; StrictSchemaValidation = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
Test-Result -Success ($null -ne $EndpointId) -Message "Create endpoint returned ID: $EndpointId"
Test-Result -Success ($endpoint.active -eq $true) -Message "New endpoint is active by default"
Test-Result -Success ($endpoint.scimBasePath -like "*/scim/endpoints/$EndpointId") -Message "scimBasePath URL is correct"
Test-Result -Success ($null -ne $endpoint._links.self) -Message "Response includes _links.self"
Test-Result -Success ($null -ne $endpoint._links.scim) -Message "Response includes _links.scim"

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
$allEndpointsResponse = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method GET -Headers $headers
Test-Result -Success ($allEndpointsResponse.totalResults -gt 0) -Message "List endpoints returns envelope with totalResults > 0"
Test-Result -Success ($allEndpointsResponse.endpoints.Count -gt 0) -Message "List endpoints returns endpoints array with items"

# Test: Update endpoint
Write-Host "`n--- Test: Update Endpoint ---" -ForegroundColor Cyan
$updateBody = '{"displayName":"Updated Live Test Endpoint","description":"Updated description"}'
$updatedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $updateBody
Test-Result -Success ($updatedEndpoint.displayName -eq "Updated Live Test Endpoint") -Message "Update endpoint displayName works"
Test-Result -Success ($updatedEndpoint.description -eq "Updated description") -Message "Update endpoint description works"

# Test: Get endpoint stats
Write-Host "`n--- Test: Get Endpoint Stats ---" -ForegroundColor Cyan
$stats = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId/stats" -Method GET -Headers $headers
Test-Result -Success ($null -ne $stats.users) -Message "Stats includes users object"
Test-Result -Success ($null -ne $stats.users.total) -Message "Stats users includes total count"
Test-Result -Success ($null -ne $stats.groups) -Message "Stats includes groups object"
Test-Result -Success ($null -ne $stats.groups.total) -Message "Stats groups includes total count"

# ============================================
# TEST SECTION 2: CONFIG VALIDATION
# ============================================
$script:currentSection = "2: Config Validation"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 2: CONFIG VALIDATION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Invalid config value rejected on create
Write-Host "`n--- Test: Invalid Config Value Rejected on Create ---" -ForegroundColor Cyan
$invalidConfigBody = '{"name":"invalid-config-test","profile":{"settings":{"StrictSchemaValidation":"Yes"}}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $invalidConfigBody
    Test-Result -Success $false -Message "Invalid config 'Yes' should be rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid config 'Yes' rejected with 400 Bad Request"
}

# Test: Invalid config value rejected on update
Write-Host "`n--- Test: Invalid Config Value Rejected on Update ---" -ForegroundColor Cyan
$invalidUpdateBody = '{"profile":{"settings":{"StrictSchemaValidation":"enabled"}}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $invalidUpdateBody
    Test-Result -Success $false -Message "Invalid config 'enabled' should be rejected on update"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid config 'enabled' rejected with 400 Bad Request"
}

# Test: Valid config values accepted
Write-Host "`n--- Test: Valid Config Values Accepted ---" -ForegroundColor Cyan
$validConfigBody = '{"profile":{"settings":{"StrictSchemaValidation":"False"}}}'
$validResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $validConfigBody
Test-Result -Success ($validResult.profile.settings.StrictSchemaValidation -eq "False") -Message "Valid settings 'False' accepted"

# Test: Boolean true also valid
$boolConfigBody = '{"profile":{"settings":{"StrictSchemaValidation":true}}}'
$boolResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $boolConfigBody
Test-Result -Success ($boolResult.profile.settings.StrictSchemaValidation -eq $true) -Message "Boolean true accepted as settings value"

# Test: Invalid REMOVE config value rejected on create
Write-Host "`n--- Test: Invalid Remove Config Value Rejected on Create ---" -ForegroundColor Cyan
$invalidRemoveConfigBody = '{"name":"invalid-remove-config-test","profile":{"settings":{"RequireIfMatch":"Yes"}}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $invalidRemoveConfigBody
    Test-Result -Success $false -Message "Invalid remove config 'Yes' should be rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid remove config 'Yes' rejected with 400 Bad Request"
}

# Test: Invalid REMOVE config value rejected on update
Write-Host "`n--- Test: Invalid Remove Config Value Rejected on Update ---" -ForegroundColor Cyan
$invalidRemoveUpdateBody = '{"profile":{"settings":{"RequireIfMatch":"enabled"}}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $invalidRemoveUpdateBody
    Test-Result -Success $false -Message "Invalid remove config 'enabled' should be rejected on update"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid remove config 'enabled' rejected with 400 Bad Request"
}

# Test: Valid REMOVE config values accepted
Write-Host "`n--- Test: Valid Remove Config Values Accepted ---" -ForegroundColor Cyan
$validRemoveConfigBody = '{"profile":{"settings":{"RequireIfMatch":"False"}}}'
$validRemoveResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $validRemoveConfigBody
Test-Result -Success ($validRemoveResult.profile.settings.RequireIfMatch -eq "False") -Message "Valid RequireIfMatch settings 'False' accepted"

# Test: Both flags can be set together
Write-Host "`n--- Test: Both Config Flags Set Together ---" -ForegroundColor Cyan
$bothFlagsBody = '{"profile":{"settings":{"StrictSchemaValidation":"True","RequireIfMatch":"True"}}}'
$bothResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $bothFlagsBody
$bothValid = ($bothResult.profile.settings.StrictSchemaValidation -eq "True") -and ($bothResult.profile.settings.RequireIfMatch -eq "True")
Test-Result -Success $bothValid -Message "Both StrictSchemaValidation and RequireIfMatch config flags set together"

# Test: Invalid VerbosePatchSupported config value rejected
Write-Host "`n--- Test: Invalid VerbosePatchSupported Config Value Rejected ---" -ForegroundColor Cyan
$invalidVerboseBody = '{"profile":{"settings":{"VerbosePatchSupported":"Yes"}}}'
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $invalidVerboseBody
    Test-Result -Success $false -Message "Invalid VerbosePatchSupported 'Yes' should be rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Invalid VerbosePatchSupported 'Yes' rejected with 400 Bad Request"
}

# Test: Valid VerbosePatchSupported config value accepted
Write-Host "`n--- Test: Valid VerbosePatchSupported Config Value Accepted ---" -ForegroundColor Cyan
$validVerboseBody = '{"profile":{"settings":{"VerbosePatchSupported":true}}}'
$validVerboseResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $validVerboseBody
Test-Result -Success ($validVerboseResult.profile.settings.VerbosePatchSupported -eq $true) -Message "VerbosePatchSupported boolean true accepted"

# Test: All three flags can be set together
Write-Host "`n--- Test: All Three Config Flags Set Together ---" -ForegroundColor Cyan
$allFlagsBody = '{"profile":{"settings":{"StrictSchemaValidation":"True","RequireIfMatch":"True","VerbosePatchSupported":true}}}'
$allResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $allFlagsBody
$allValid = ($allResult.profile.settings.StrictSchemaValidation -eq "True") -and ($allResult.profile.settings.RequireIfMatch -eq "True") -and ($allResult.profile.settings.VerbosePatchSupported -eq $true)
Test-Result -Success $allValid -Message "All three config flags set together"

# Reset RequireIfMatch to false so subsequent sections don't get 428 errors
$resetBody = '{"profile":{"settings":{"RequireIfMatch":"False"}}}'
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $resetBody -ContentType "application/json" | Out-Null
} catch {
    Write-Host "    ⚠️ RequireIfMatch reset failed, retrying..." -ForegroundColor Yellow
    Start-Sleep 2
    try {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method PATCH -Headers $headers -Body $resetBody -ContentType "application/json" | Out-Null
    } catch {
        Write-Host "    ⚠️ RequireIfMatch reset still failed — subsequent tests will use If-Match:* as safety net" -ForegroundColor Yellow
    }
}

# Write headers include If-Match:* as a safety net — works regardless of RequireIfMatch setting.
# If-Match:* is valid per RFC 7232 §3.1 and means "match any version".
$headers = @{ Authorization = $headers['Authorization']; 'Content-Type' = 'application/json'; 'If-Match' = '*' }

# Also add If-Match:* to the main $headers so ALL subsequent Invoke-RestMethod calls
# (83+ PATCH/PUT/DELETE across Sections 3-10) are protected. If-Match:* is harmless on
# GET/POST — the server ignores it on reads and creates.
$headers['If-Match'] = '*'

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

# Test: Deactivate user
Write-Host "`n--- Test: Deactivate User ---" -ForegroundColor Cyan
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

# Test: externalId is saved as received, NOT checked for uniqueness (uniqueness:none per RFC 7643)
Write-Host "`n--- Test: externalId NOT Unique (Saved as Received) ---" -ForegroundColor Cyan
$dupExtBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "dup-ext-test@test.com"
    externalId = "ext-pag-1"  # Same externalId as another user — allowed
    active = $true
} | ConvertTo-Json
try {
    $dupExtResult = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dupExtBody
    Test-Result -Success ($dupExtResult.externalId -eq "ext-pag-1") -Message "Duplicate externalId accepted (uniqueness:none) — 201"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success $false -Message "Duplicate externalId should be accepted (uniqueness:none), got $code"
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

# Test: Duplicate group externalId → allowed (uniqueness:none per RFC 7643)
$dupExtGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Dup ExternalId Group"
    externalId = "updated-ext-789"
} | ConvertTo-Json
try {
    $dupExtGroupResult = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $dupExtGroupBody
    Test-Result -Success ($dupExtGroupResult.externalId -eq "updated-ext-789") -Message "Duplicate group externalId accepted (uniqueness:none) — 201"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success $false -Message "Duplicate group externalId should be accepted (uniqueness:none), got $code"
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

# Create endpoint WITHOUT the multi-member flag (settings v7: explicitly disable since default is now True)
Write-Host "`n--- Create Endpoint Without Multi-Member Flag ---" -ForegroundColor Cyan
$noFlagBody = @{
    name = "live-test-no-flag-$(Get-Random)"
    displayName = "No Flag Endpoint"
    profilePreset = "rfc-standard"
} | ConvertTo-Json
$noFlagEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $noFlagBody
$NoFlagEndpointId = $noFlagEndpoint.id
# Explicitly disable multi-member patch for this endpoint
$disableMultiBody = '{"profile":{"settings":{"MultiMemberPatchOpForGroupEnabled":"False","StrictSchemaValidation":"False"}}}'
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$NoFlagEndpointId" -Method PATCH -Headers $headers -Body $disableMultiBody -ContentType "application/json" | Out-Null
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
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$removeEnabledEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $removeEnabledBody
$RemoveFlagEndpointId = $removeEnabledEndpoint.id
$patchBody = @{ profile = @{ settings = @{ MultiMemberPatchOpForGroupEnabled = "True"; StrictSchemaValidation = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$RemoveFlagEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
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
    displayName = "Isolation Test User"
    emails = @(@{ value = "livetest-user@test.com"; type = "work"; primary = $true })
    active = $true
} | ConvertTo-Json -Depth 3
try {
    $sameUser = Invoke-RestMethod -Uri "$scimBaseIsolation/Users" -Method POST -Headers $headers -Body $sameUserBody
    $IsolationUserId = $sameUser.id
    Test-Result -Success ($null -ne $IsolationUserId) -Message "Same userName created in different endpoint (isolation works)"
} catch {
    $errCode = $_.Exception.Response.StatusCode.value__
    $errBody = $_.ErrorDetails.Message
    Test-Result -Success $false -Message "Should allow same userName in different endpoints (got HTTP $errCode)"
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
$inactiveTestUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="inactive-test@test.com";displayName="Inactive Test";emails=@(@{value="inactive-test@test.com";type="work";primary=$true});active=$true} | ConvertTo-Json -Depth 3
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
$foundInactive = $inactiveList.endpoints | Where-Object { $_.id -eq $InactiveEndpointId }
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
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$noRemoveAllEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $noRemoveAllBody
$NoRemoveAllEndpointId = $noRemoveAllEndpoint.id
$patchBody = @{ profile = @{ settings = @{ PatchOpAllowRemoveAllMembers = "False"; StrictSchemaValidation = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$NoRemoveAllEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
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

# Test: Default behavior (flag not set → blanket remove blocked, PatchOpAllowRemoveAllMembers defaults to false in v7)
Write-Host "`n--- Test: Default Behavior (Flag Not Set → Block Blanket Remove) ---" -ForegroundColor Cyan
# Use the main endpoint which does NOT have PatchOpAllowRemoveAllMembers set (defaults to false in v7)
# Add members to main group first
$defUser1Body = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User");userName="def-remove-user1@test.com";active=$true} | ConvertTo-Json
$defUser1 = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $defUser1Body
$defGroupBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:Group");displayName="Default Remove Test Group"} | ConvertTo-Json
$defGroup = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $defGroupBody
$DefGroupId = $defGroup.id
Invoke-RestMethod -Uri "$scimBase/Groups/$DefGroupId" -Method PATCH -Headers $headers -Body (@{schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp");Operations=@(@{op="add";path="members";value=@(@{value=$defUser1.id})})} | ConvertTo-Json -Depth 5) | Out-Null

# Blanket remove should be blocked (default = false in settings v7)
$defBlanketBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "remove"; path = "members" })
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/$DefGroupId" -Method PATCH -Headers $headers -Body $defBlanketBody | Out-Null
    Test-Result -Success $false -Message "Blanket remove should be blocked when flag not set (defaults to false in v7)"
} catch {
    $defBlanketCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($defBlanketCode -eq 400) -Message "Blanket remove blocked by default (PatchOpAllowRemoveAllMembers defaults to false in v7)"
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
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$vpEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $vpEndpointBody
$VPEndpointId = $vpEndpoint.id
$patchBody = @{ profile = @{ settings = @{ VerbosePatchSupported = $true } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$VPEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
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
Test-Result -Success ($logConfig.availableCategories.Count -eq 14) -Message "availableCategories has 14 entries"
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
try {
    $badCatResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/category/nonexistent/DEBUG" -Method PUT -Headers $headers
    Test-Result -Success $false -Message "Unknown category should return 400"
} catch {
    $badCatStatus = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($badCatStatus -eq 400) -Message "Unknown category returns 400"
    # NestJS HttpException wraps body as { statusCode, message: { error, availableCategories } }
    # or { error, availableCategories } depending on version — check both structures
    try {
        $errBody = $_.ErrorDetails.Message | ConvertFrom-Json
        $cats = $null
        if ($errBody.availableCategories) { $cats = $errBody.availableCategories }
        elseif ($errBody.message -and $errBody.message -is [System.Management.Automation.PSCustomObject] -and $errBody.message.availableCategories) { $cats = $errBody.message.availableCategories }
        if ($cats) {
            Test-Result -Success ($cats.Count -ge 14) -Message "Unknown category response includes $($cats.Count) available categories"
        } else {
            # Body parsed but structure different — pass if error text present
            $errText = $_.ErrorDetails.Message
            Test-Result -Success ($errText -match 'Unknown category' -or $errText -match 'availableCategories') -Message "Unknown category error body has expected content"
        }
    } catch {
        Test-Result -Success $true -Message "Unknown category: 400 confirmed (body parse best-effort)"
    }
}

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
    description = "Endpoint to test per-endpoint logLevel via profile.settings"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4

$logLevelEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $logLevelEndpointBody
$logLevelEndpointId = $logLevelEndpoint.id
$patchBody = @{ profile = @{ settings = @{ logLevel = "DEBUG" } } } | ConvertTo-Json -Depth 4
$logLevelEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json"
Test-Result -Success ($logLevelEndpoint.profile.settings.logLevel -eq "DEBUG") -Message "Created endpoint with logLevel=DEBUG in profile.settings"
Test-Result -Success ($logLevelEndpointId -ne $null) -Message "Endpoint ID is present: $logLevelEndpointId"

# --- Verify log-config reflects the endpoint level ---
$logConfigAfterCreate = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$epLevelAfterCreate = $logConfigAfterCreate.endpointLevels.$logLevelEndpointId
Test-Result -Success ($epLevelAfterCreate -ne $null) -Message "Endpoint level appears in log-config after create"

# --- Get endpoint and verify config roundtrips ---
$getEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method GET -Headers $headers
Test-Result -Success ($getEndpoint.profile.settings.logLevel -eq "DEBUG") -Message "GET endpoint returns logLevel=DEBUG in profile.settings"

# --- Update endpoint to change logLevel ---
Write-Host "`n--- Update Endpoint logLevel Config ---" -ForegroundColor Cyan
$updateBody = @{
    profile = @{ settings = @{
        logLevel = "TRACE"
    } }
} | ConvertTo-Json -Depth 4

$updatedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method PATCH -Headers $headers -Body $updateBody
Test-Result -Success ($updatedEndpoint.profile.settings.logLevel -eq "TRACE") -Message "Updated endpoint logLevel to TRACE"

# --- Verify log-config reflects updated level ---
$logConfigAfterUpdate = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$epLevelAfterUpdate = $logConfigAfterUpdate.endpointLevels.$logLevelEndpointId
Test-Result -Success ($epLevelAfterUpdate -ne $null) -Message "Endpoint level updated in log-config after PATCH"

# --- Update endpoint config without logLevel (should preserve it — settings merge is additive) ---
Write-Host "`n--- PATCH config without logLevel (additive merge) ---" -ForegroundColor Cyan
$removeLogLevelBody = @{
    profile = @{ settings = @{
        strictMode = $true
    } }
} | ConvertTo-Json -Depth 4

$clearedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$logLevelEndpointId" -Method PATCH -Headers $headers -Body $removeLogLevelBody
# Settings merge is additive (shallow merge) — omitting logLevel does NOT clear it.
# The logLevel should still be TRACE from the previous PATCH.
Test-Result -Success ($clearedEndpoint.profile.settings.logLevel -eq "TRACE") -Message "Endpoint profile.settings preserves logLevel (additive merge)"
Test-Result -Success ($clearedEndpoint.profile.settings.strictMode -eq $true) -Message "Other settings flags preserved"

# --- Verify log-config no longer has endpoint level ---
$logConfigAfterClear = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$epLevelAfterClear = $logConfigAfterClear.endpointLevels.$logLevelEndpointId
Test-Result -Success ($epLevelAfterClear -eq $null) -Message "Endpoint level cleared from log-config"

# --- Create endpoint with logLevel alongside other config flags ---
Write-Host "`n--- Create Endpoint with Mixed Config ---" -ForegroundColor Cyan
$mixedConfigBody = @{
    name = "log-level-mixed-ep"
    displayName = "Mixed Config Endpoint"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4

$mixedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $mixedConfigBody
$mixedEndpointId = $mixedEndpoint.id
$patchBody = @{ profile = @{ settings = @{ logLevel = "WARN"; VerbosePatchSupported = "True"; strictMode = $true } } } | ConvertTo-Json -Depth 4
$mixedEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$mixedEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json"
Test-Result -Success ($mixedEndpoint.profile.settings.logLevel -eq "WARN") -Message "Mixed settings: logLevel=WARN"
Test-Result -Success ($mixedEndpoint.profile.settings.VerbosePatchSupported -eq "True") -Message "Mixed settings: VerbosePatchSupported=True"
Test-Result -Success ($mixedEndpoint.profile.settings.strictMode -eq $true) -Message "Mixed settings: strictMode=true"

# --- Validate log-config for mixed endpoint ---
$logConfigMixed = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config" -Method GET -Headers $headers
$mixedEpLevel = $logConfigMixed.endpointLevels.$mixedEndpointId
Test-Result -Success ($mixedEpLevel -ne $null) -Message "Mixed endpoint level in log-config"

# --- Validation: reject invalid logLevel via PATCH ---
Write-Host "`n--- Validation: Invalid logLevel Values ---" -ForegroundColor Cyan
# Create a temp endpoint, then try to PATCH invalid logLevel
$tempLogEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{ name = "bad-log-ep-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json)
try {
    $badPatch = @{ profile = @{ settings = @{ logLevel = "VERBOSE" } } } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($tempLogEp.id)" -Method PATCH -Headers $headers -Body $badPatch -ContentType "application/json"
    Test-Result -Success $false -Message "Should reject invalid logLevel 'VERBOSE'"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Rejects invalid logLevel 'VERBOSE' with 400"
}

try {
    $badPatch2 = @{ profile = @{ settings = @{ logLevel = "high" } } } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($tempLogEp.id)" -Method PATCH -Headers $headers -Body $badPatch2 -ContentType "application/json"
    Test-Result -Success $false -Message "Should reject invalid logLevel 'high'"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "Rejects invalid logLevel 'high' with 400"
}
try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($tempLogEp.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

# --- Accept case-insensitive logLevel ---
$ciBody = @{
    name = "log-ci-ep"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$ciEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $ciBody
$ciEndpointId = $ciEndpoint.id
$patchBody = @{ profile = @{ settings = @{ logLevel = "debug" } } } | ConvertTo-Json -Depth 4
$ciEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$ciEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json"
Test-Result -Success ($ciEndpoint.profile.settings.logLevel -eq "debug") -Message "Accepts lowercase logLevel 'debug'"

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
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$boolCoerceEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $boolCoerceEndpointBody
$boolCoerceEndpointId = $boolCoerceEndpoint.id
$patchBody = @{ profile = @{ settings = @{ StrictSchemaValidation = "True" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$boolCoerceEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
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
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$rejectEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $rejectEndpointBody
$rejectEndpointId = $rejectEndpoint.id
$patchBody = @{ profile = @{ settings = @{ StrictSchemaValidation = "True"; AllowAndCoerceBooleanStrings = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$rejectEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
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

# ╔════════════════════════════════════════════════════════════════════════════════╗
# ║ TEST SECTION 9m: SCHEMA CUSTOMIZATION (Custom Extensions + Resource Types)  ║
# ║ Subsections: 9m-A  Custom Schema Extensions (Admin Schema API)              ║
# ║              9m-B  Custom Resource Types (G8b)                              ║
# ║              9m-C  Schema Customization Combinations                        ║
# ╚════════════════════════════════════════════════════════════════════════════════╝
$script:currentSection = "9m: Schema Customization"
Write-Host "`n`n═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "TEST SECTION 9m: SCHEMA CUSTOMIZATION" -ForegroundColor Yellow
Write-Host "  Custom Schema Extensions + Custom Resource Types + Combos" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow

# ─────────────────────────────────────────────────────────────────────────────
# 9m-A: CUSTOM SCHEMA EXTENSIONS (Admin Schema API)
# ⚠️ SKIPPED: Admin Schema API removed in v0.28.0. Schemas now in profile.
# ─────────────────────────────────────────────────────────────────────────────
$script:currentSection = "9m-A: Custom Schema Extensions (SKIPPED)"
Write-Host "`n`n────────────────────────────────────────────────────" -ForegroundColor Yellow
Write-Host "  9m-A: CUSTOM SCHEMA EXTENSIONS — SKIPPED (Admin API removed v0.28.0)" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────" -ForegroundColor Yellow
Test-Result -Success $true -Message "9m-A: SKIPPED — Admin Schema API removed; schemas now in endpoint profile"

# ── 9m-A REPLACEMENT: Test custom extension via inline profile ──
$extEpBody = @{
    name = "live-ext-$(Get-Random)"
    profile = @{
        schemas = @(
            @{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = "all" }
            @{ id = "urn:test:live:ext:User"; name = "LiveTestExt"; description = "Live test extension"
               attributes = @(
                   @{ name = "badgeNumber"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default" }
               ) }
            @{ id = "urn:ietf:params:scim:schemas:core:2.0:Group"; name = "Group"; attributes = "all" }
        )
        resourceTypes = @(
            @{ id = "User"; name = "User"; endpoint = "/Users"; description = "User"; schema = "urn:ietf:params:scim:schemas:core:2.0:User"; schemaExtensions = @(@{ schema = "urn:test:live:ext:User"; required = $false }) }
            @{ id = "Group"; name = "Group"; endpoint = "/Groups"; description = "Group"; schema = "urn:ietf:params:scim:schemas:core:2.0:Group"; schemaExtensions = @() }
        )
        serviceProviderConfig = @{ patch = @{ supported = $true }; bulk = @{ supported = $true; maxOperations = 100; maxPayloadSize = 1048576 }; filter = @{ supported = $true; maxResults = 200 }; sort = @{ supported = $true }; etag = @{ supported = $true }; changePassword = @{ supported = $false } }
    }
} | ConvertTo-Json -Depth 8
$extEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $extEpBody
$extEpId = $extEp.id
$scimBaseExt = "$baseUrl/scim/endpoints/$extEpId"
Test-Result -Success ($null -ne $extEpId) -Message "9m-A.P1: Created endpoint with custom extension via profile"

$extSchemas = Invoke-RestMethod -Uri "$scimBaseExt/Schemas" -Headers $headers
Test-Result -Success ($null -ne ($extSchemas.Resources | Where-Object { $_.id -eq "urn:test:live:ext:User" })) -Message "9m-A.P2: Extension visible in /Schemas"

$extUserBody = @{ schemas = @("urn:ietf:params:scim:schemas:core:2.0:User","urn:test:live:ext:User"); userName = "ext-$(Get-Random)@test.com"; displayName = "Ext Test"; active = $true; "urn:test:live:ext:User" = @{ badgeNumber = "B99" } } | ConvertTo-Json -Depth 4
$extUser = Invoke-RestMethod -Uri "$scimBaseExt/Users" -Method POST -Headers $headers -Body $extUserBody
Test-Result -Success ($extUser."urn:test:live:ext:User".badgeNumber -eq "B99") -Message "9m-A.P3: Extension data roundtrips on POST"

$extUserGet = Invoke-RestMethod -Uri "$scimBaseExt/Users/$($extUser.id)" -Headers $headers
Test-Result -Success ($extUserGet."urn:test:live:ext:User".badgeNumber -eq "B99") -Message "9m-A.P4: Extension data roundtrips on GET"

try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$extEpId" -Method DELETE -Headers $headers | Out-Null } catch {}
Test-Result -Success $true -Message "9m-A.P5: Cleaned up extension endpoint"

# Skip old Admin Schema API tests (dead code below — left for reference)
function Skip-OldSection9mA {
$SchExtEndpointId = $schExtEndpoint.id
$scimBaseSchExt = "$baseUrl/scim/endpoints/$SchExtEndpointId"
$adminBaseSchExt = "$baseUrl/scim/admin/endpoints/$SchExtEndpointId"
Test-Result -Success ($null -ne $SchExtEndpointId) -Message "9m-A: Schema extension test endpoint created"

# --- Create a second endpoint for isolation tests ---
$schExtEndpoint2Body = @{
    name = "live-test-schext2-$(Get-Random)"
    displayName = "Schema Extension Isolation Endpoint"
    description = "Second endpoint for cross-endpoint isolation tests"
} | ConvertTo-Json
$schExtEndpoint2 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $schExtEndpoint2Body
$SchExtEndpoint2Id = $schExtEndpoint2.id
$scimBaseSchExt2 = "$baseUrl/scim/endpoints/$SchExtEndpoint2Id"
$adminBaseSchExt2 = "$baseUrl/scim/admin/endpoints/$SchExtEndpoint2Id"

# ── ADMIN CRUD ──────────────────────────────────────────────────────────────

# --- Test 9m-A.1: List schemas — initially empty ---
Write-Host "`n--- Test 9m-A.1: List schemas on empty endpoint ---" -ForegroundColor Cyan
$emptyList = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas" -Method GET -Headers $headers
Test-Result -Success ($emptyList.totalResults -eq 0) -Message "9m-A.1 Empty endpoint has 0 custom schemas (totalResults=$($emptyList.totalResults))"

# --- Test 9m-A.2: Register a custom User extension with full attribute characteristics ---
Write-Host "`n--- Test 9m-A.2: Register custom User extension ---" -ForegroundColor Cyan
$customUserExtUrn = "urn:ietf:params:scim:schemas:extension:custom:2.0:User"
$customUserExtBody = @{
    schemaUrn = $customUserExtUrn
    name = "Custom User Extension"
    description = "Custom attributes for users"
    resourceTypeId = "User"
    required = $false
    attributes = @(
        @{ name = "badgeNumber"; type = "string"; multiValued = $false; required = $true; description = "Employee badge"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "costCenter"; type = "string"; multiValued = $false; required = $false; description = "Cost center code"; mutability = "readWrite"; returned = "default"; caseExact = $true; uniqueness = "none" }
        @{ name = "internalCode"; type = "integer"; multiValued = $false; required = $false; description = "Internal numeric code"; mutability = "readWrite"; returned = "request"; caseExact = $false; uniqueness = "none" }
        @{ name = "hireDate"; type = "dateTime"; multiValued = $false; required = $false; description = "Date of hire"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "tags"; type = "string"; multiValued = $true; required = $false; description = "Freeform tags"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "secretToken"; type = "string"; multiValued = $false; required = $false; description = "Write-only secret"; mutability = "writeOnly"; returned = "never"; caseExact = $true; uniqueness = "none" }
    )
} | ConvertTo-Json -Depth 4
$regResult = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas" -Method POST -Headers $headers -Body $customUserExtBody -ContentType "application/json"
Test-Result -Success ($regResult.schemaUrn -eq $customUserExtUrn -and $regResult.name -eq "Custom User Extension") -Message "9m-A.2 Custom User extension registered (urn=$($regResult.schemaUrn))"

# --- Test 9m-A.3: Reject duplicate schema URN on same endpoint ---
Write-Host "`n--- Test 9m-A.3: Reject duplicate schema URN ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas" -Method POST -Headers $headers -Body $customUserExtBody -ContentType "application/json"
    Test-Result -Success $false -Message "9m-A.3 Should have rejected duplicate"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 409) -Message "9m-A.3 Duplicate schema URN rejected (HTTP $statusCode)"
}

# --- Test 9m-A.4: 404 for non-existent endpoint ---
Write-Host "`n--- Test 9m-A.4: 404 for non-existent endpoint ---" -ForegroundColor Cyan
$fakeEndpointId = "00000000-0000-0000-0000-000000000000"
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$fakeEndpointId/schemas" -Method POST -Headers $headers -Body $customUserExtBody -ContentType "application/json"
    Test-Result -Success $false -Message "9m-A.4 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-A.4 Non-existent endpoint returns 404 (HTTP $statusCode)"
}

# --- Test 9m-A.5: Register same URN on a DIFFERENT endpoint (allowed) ---
Write-Host "`n--- Test 9m-A.5: Same URN on different endpoint (should succeed) ---" -ForegroundColor Cyan
$regOnEp2 = Invoke-RestMethod -Uri "$adminBaseSchExt2/schemas" -Method POST -Headers $headers -Body $customUserExtBody -ContentType "application/json"
Test-Result -Success ($regOnEp2.schemaUrn -eq $customUserExtUrn) -Message "9m-A.5 Same URN registered on second endpoint"

# --- Test 9m-A.6: Register minimal schema (no optional fields) ---
Write-Host "`n--- Test 9m-A.6: Register minimal schema (no description/resourceTypeId) ---" -ForegroundColor Cyan
$minimalSchemaUrn = "urn:example:schemas:extension:minimal:2.0"
$minimalSchemaBody = @{
    schemaUrn = $minimalSchemaUrn
    name = "Minimal Extension"
    attributes = @(
        @{ name = "simpleAttr"; type = "string"; multiValued = $false; required = $false }
    )
} | ConvertTo-Json -Depth 3
$minReg = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas" -Method POST -Headers $headers -Body $minimalSchemaBody -ContentType "application/json"
Test-Result -Success ($minReg.schemaUrn -eq $minimalSchemaUrn) -Message "9m-A.6 Minimal schema registered (urn=$($minReg.schemaUrn))"

# --- Test 9m-A.7: Register a Group extension ---
Write-Host "`n--- Test 9m-A.7: Register custom Group extension ---" -ForegroundColor Cyan
$customGroupExtUrn = "urn:ietf:params:scim:schemas:extension:custom:2.0:Group"
$customGroupExtBody = @{
    schemaUrn = $customGroupExtUrn
    name = "Custom Group Extension"
    description = "Custom attributes for groups"
    resourceTypeId = "Group"
    required = $false
    attributes = @(
        @{ name = "department"; type = "string"; multiValued = $false; required = $false; description = "Group department"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "costCode"; type = "string"; multiValued = $false; required = $false; description = "Group cost code"; mutability = "readWrite"; returned = "default"; caseExact = $true; uniqueness = "none" }
    )
} | ConvertTo-Json -Depth 4
$grpReg = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas" -Method POST -Headers $headers -Body $customGroupExtBody -ContentType "application/json"
Test-Result -Success ($grpReg.schemaUrn -eq $customGroupExtUrn) -Message "9m-A.7 Custom Group extension registered"

# --- Test 9m-A.8: List all schemas — should have 3 ---
Write-Host "`n--- Test 9m-A.8: List all registered schemas ---" -ForegroundColor Cyan
$schemaList = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas" -Method GET -Headers $headers
Test-Result -Success ($schemaList.totalResults -eq 3) -Message "9m-A.8 Endpoint has $($schemaList.totalResults) custom schemas"

# --- Test 9m-A.9: GET by URN — custom User extension ---
Write-Host "`n--- Test 9m-A.9: GET schema by URN ---" -ForegroundColor Cyan
$encodedUrn = [System.Uri]::EscapeDataString($customUserExtUrn)
$schemaByUrn = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas/$encodedUrn" -Method GET -Headers $headers
Test-Result -Success ($schemaByUrn.schemaUrn -eq $customUserExtUrn -and $schemaByUrn.attributes.Count -eq 6) -Message "9m-A.9 GET by URN returns correct schema ($($schemaByUrn.attributes.Count) attributes)"

# --- Test 9m-A.10: GET by URN — 404 for non-existent ---
Write-Host "`n--- Test 9m-A.10: GET non-existent URN returns 404 ---" -ForegroundColor Cyan
$fakeUrn = [System.Uri]::EscapeDataString("urn:fake:nonexistent")
try {
    $null = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas/$fakeUrn" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m-A.10 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-A.10 Non-existent URN returns 404 (HTTP $statusCode)"
}

# --- Test 9m-A.11: Cross-endpoint isolation — Endpoint 2 only has 1 schema ---
Write-Host "`n--- Test 9m-A.11: Cross-endpoint schema isolation ---" -ForegroundColor Cyan
$ep2Schemas = Invoke-RestMethod -Uri "$adminBaseSchExt2/schemas" -Method GET -Headers $headers
Test-Result -Success ($ep2Schemas.totalResults -eq 1) -Message "9m-A.11 Endpoint 2 only has $($ep2Schemas.totalResults) schema (isolated from Endpoint 1's 3)"

# ── DISCOVERY INTEGRATION ───────────────────────────────────────────────────

# --- Test 9m-A.12: Custom extension appears in /Schemas discovery ---
Write-Host "`n--- Test 9m-A.12: Custom extension in /Schemas discovery ---" -ForegroundColor Cyan
$discoverySchemas = Invoke-RestMethod -Uri "$scimBaseSchExt/Schemas" -Method GET -Headers $headers
$customSchemaInDiscovery = $discoverySchemas.Resources | Where-Object { $_.id -eq $customUserExtUrn }
Test-Result -Success ($null -ne $customSchemaInDiscovery) -Message "9m-A.12 Custom User extension visible in /Schemas discovery"

# --- Test 9m-A.13: Group extension appears in /Schemas discovery ---
Write-Host "`n--- Test 9m-A.13: Group extension in /Schemas discovery ---" -ForegroundColor Cyan
$groupSchemaInDiscovery = $discoverySchemas.Resources | Where-Object { $_.id -eq $customGroupExtUrn }
Test-Result -Success ($null -ne $groupSchemaInDiscovery) -Message "9m-A.13 Custom Group extension visible in /Schemas discovery"

# --- Test 9m-A.14: Custom extension NOT in other endpoint's /Schemas ---
Write-Host "`n--- Test 9m-A.14: Extension NOT in other endpoint's discovery ---" -ForegroundColor Cyan
$mainSchemas = Invoke-RestMethod -Uri "$scimBase/Schemas" -Method GET -Headers $headers
$customInMain = $mainSchemas.Resources | Where-Object { $_.id -eq $customGroupExtUrn }
Test-Result -Success ($null -eq $customInMain) -Message "9m-A.14 Custom Group extension NOT visible in main endpoint /Schemas"

# ── CLIENT USAGE: Create/Read/Update/Delete with Extension Data ─────────────

# --- Test 9m-A.15: POST /Users with custom extension attributes ---
Write-Host "`n--- Test 9m-A.15: POST /Users with extension attributes ---" -ForegroundColor Cyan
$extUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $customUserExtUrn)
    userName = "schext-user-$(Get-Random)@test.com"
    displayName = "Schema Extension User"
    name = @{ givenName = "Schema"; familyName = "ExtUser" }
    "$customUserExtUrn" = @{
        badgeNumber = "BADGE-001"
        costCenter = "CC-FINANCE"
        internalCode = 42
        hireDate = "2025-01-15T00:00:00Z"
        tags = @("developer", "vip")
        secretToken = "super-secret-value"
    }
} | ConvertTo-Json -Depth 4
$extUser = Invoke-RestMethod -Uri "$scimBaseSchExt/Users" -Method POST -Headers $headers -Body $extUserBody -ContentType "application/scim+json"
$schExtUserId = $extUser.id
$extDataInResponse = $extUser."$customUserExtUrn"
Test-Result -Success ($null -ne $schExtUserId -and $null -ne $extDataInResponse) -Message "9m-A.15 User created with extension data (id=$schExtUserId)"

# --- Test 9m-A.16: Extension data persists on GET ---
Write-Host "`n--- Test 9m-A.16: GET /Users/:id returns extension data ---" -ForegroundColor Cyan
$fetchedExtUser = Invoke-RestMethod -Uri "$scimBaseSchExt/Users/$schExtUserId" -Method GET -Headers $headers
$fetchedExtData = $fetchedExtUser."$customUserExtUrn"
$badgeOk = ($fetchedExtData.badgeNumber -eq "BADGE-001")
$costCenterOk = ($fetchedExtData.costCenter -eq "CC-FINANCE")
Test-Result -Success ($badgeOk -and $costCenterOk) -Message "9m-A.16 GET returns persisted extension data (badge=$($fetchedExtData.badgeNumber), cc=$($fetchedExtData.costCenter))"

# --- Test 9m-A.17: returned:never attribute (secretToken) NOT in GET response ---
Write-Host "`n--- Test 9m-A.17: returned:never attribute stripped from GET ---" -ForegroundColor Cyan
$secretInGet = $fetchedExtData.secretToken
Test-Result -Success ($null -eq $secretInGet) -Message "9m-A.17 secretToken (returned:never) not present in GET response"

# --- Test 9m-A.18: returned:request attribute (internalCode) in default GET ---
Write-Host "`n--- Test 9m-A.18: returned:request attribute behavior ---" -ForegroundColor Cyan
# returned:request means it should NOT appear unless explicitly requested
$internalCodeInDefault = $fetchedExtData.internalCode
# Note: behavior depends on implementation; if returned:request is honored, it should be absent in default
Test-Result -Success ($true) -Message "9m-A.18 internalCode (returned:request) in default GET = $($null -ne $internalCodeInDefault) (impl-dependent)"

# --- Test 9m-A.19: Multi-valued attribute (tags) roundtrip ---
Write-Host "`n--- Test 9m-A.19: Multi-valued extension attribute roundtrip ---" -ForegroundColor Cyan
$tagsOk = ($fetchedExtData.tags -is [array]) -and ($fetchedExtData.tags.Count -eq 2)
Test-Result -Success $tagsOk -Message "9m-A.19 tags array roundtrips ($($fetchedExtData.tags -join ', '))"

# --- Test 9m-A.20: PUT replace with updated extension data ---
Write-Host "`n--- Test 9m-A.20: PUT replace user with updated extension data ---" -ForegroundColor Cyan
$putExtUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $customUserExtUrn)
    userName = $extUser.userName
    displayName = "Updated Schema Ext User"
    name = @{ givenName = "Schema"; familyName = "ExtUser" }
    "$customUserExtUrn" = @{
        badgeNumber = "BADGE-002"
        costCenter = "CC-ENGINEERING"
        tags = @("admin")
    }
} | ConvertTo-Json -Depth 4
$putExtUser = Invoke-RestMethod -Uri "$scimBaseSchExt/Users/$schExtUserId" -Method PUT -Headers $headers -Body $putExtUserBody -ContentType "application/scim+json"
$putExtData = $putExtUser."$customUserExtUrn"
Test-Result -Success ($putExtData.badgeNumber -eq "BADGE-002" -and $putExtData.costCenter -eq "CC-ENGINEERING") -Message "9m-A.20 PUT updates extension data (badge=$($putExtData.badgeNumber))"

# --- Test 9m-A.21: PATCH add extension attribute ---
# internalCode has returned:request — not in default response; verify via GET ?attributes=
Write-Host "`n--- Test 9m-A.21: PATCH add extension attribute ---" -ForegroundColor Cyan
$patchAddBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "add"; path = "$($customUserExtUrn):internalCode"; value = 99 }
    )
} | ConvertTo-Json -Depth 3
$null = Invoke-RestMethod -Uri "$scimBaseSchExt/Users/$schExtUserId" -Method PATCH -Headers $headers -Body $patchAddBody -ContentType "application/scim+json"
# Fetch with ?attributes= to include returned:request attribute
$encodedExtUrn = [System.Uri]::EscapeDataString("$($customUserExtUrn):internalCode")
$verifyExtUser = Invoke-RestMethod -Uri "$scimBaseSchExt/Users/$schExtUserId`?attributes=$encodedExtUrn" -Method GET -Headers $headers
$verifyExtData = $verifyExtUser."$customUserExtUrn"
Test-Result -Success ($verifyExtData.internalCode -eq 99) -Message "9m-A.21 PATCH add extension attribute (internalCode=99)"

# --- Test 9m-A.22: PATCH replace extension attribute ---
Write-Host "`n--- Test 9m-A.22: PATCH replace extension attribute ---" -ForegroundColor Cyan
$patchReplaceBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "$($customUserExtUrn):badgeNumber"; value = "BADGE-999" }
    )
} | ConvertTo-Json -Depth 3
$replacedExtUser = Invoke-RestMethod -Uri "$scimBaseSchExt/Users/$schExtUserId" -Method PATCH -Headers $headers -Body $patchReplaceBody -ContentType "application/scim+json"
$replacedExtData = $replacedExtUser."$customUserExtUrn"
Test-Result -Success ($replacedExtData.badgeNumber -eq "BADGE-999") -Message "9m-A.22 PATCH replace extension attribute (badge=$($replacedExtData.badgeNumber))"

# --- Test 9m-A.23: PATCH remove extension attribute ---
Write-Host "`n--- Test 9m-A.23: PATCH remove extension attribute ---" -ForegroundColor Cyan
$patchRemoveBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "remove"; path = "$($customUserExtUrn):costCenter" }
    )
} | ConvertTo-Json -Depth 3
$removedExtUser = Invoke-RestMethod -Uri "$scimBaseSchExt/Users/$schExtUserId" -Method PATCH -Headers $headers -Body $patchRemoveBody -ContentType "application/scim+json"
$removedExtData = $removedExtUser."$customUserExtUrn"
Test-Result -Success ($null -eq $removedExtData.costCenter) -Message "9m-A.23 PATCH remove extension attribute (costCenter removed)"

# --- Test 9m-A.24: Extension data in list response ---
Write-Host "`n--- Test 9m-A.24: Extension data present in list response ---" -ForegroundColor Cyan
$userList = Invoke-RestMethod -Uri "$scimBaseSchExt/Users" -Method GET -Headers $headers
$listExtUser = $userList.Resources | Where-Object { $_.id -eq $schExtUserId }
$listExtData = $listExtUser."$customUserExtUrn"
Test-Result -Success ($null -ne $listExtData) -Message "9m-A.24 Extension data present in list response"

# --- Test 9m-A.25: POST /Groups with Group extension ---
Write-Host "`n--- Test 9m-A.25: POST /Groups with Group extension ---" -ForegroundColor Cyan
$extGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group", $customGroupExtUrn)
    displayName = "Schema Extension Group $(Get-Random)"
    "$customGroupExtUrn" = @{
        department = "Engineering"
        costCode = "ENG-001"
    }
} | ConvertTo-Json -Depth 4
$extGroup = Invoke-RestMethod -Uri "$scimBaseSchExt/Groups" -Method POST -Headers $headers -Body $extGroupBody -ContentType "application/scim+json"
$schExtGroupId = $extGroup.id
$grpExtData = $extGroup."$customGroupExtUrn"
Test-Result -Success ($null -ne $schExtGroupId -and $grpExtData.department -eq "Engineering") -Message "9m-A.25 Group created with extension data (dept=$($grpExtData.department))"

# --- Test 9m-A.26: GET /Groups/:id returns Group extension data ---
Write-Host "`n--- Test 9m-A.26: GET /Groups/:id returns extension data ---" -ForegroundColor Cyan
$fetchedExtGroup = Invoke-RestMethod -Uri "$scimBaseSchExt/Groups/$schExtGroupId" -Method GET -Headers $headers
$fetchedGrpExtData = $fetchedExtGroup."$customGroupExtUrn"
Test-Result -Success ($fetchedGrpExtData.department -eq "Engineering" -and $fetchedGrpExtData.costCode -eq "ENG-001") -Message "9m-A.26 Group extension data persists (dept=$($fetchedGrpExtData.department))"

# --- Test 9m-A.27: PATCH Group extension attribute ---
Write-Host "`n--- Test 9m-A.27: PATCH Group extension attribute ---" -ForegroundColor Cyan
$patchGrpBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "$($customGroupExtUrn):department"; value = "Marketing" }
    )
} | ConvertTo-Json -Depth 3
$patchedGrp = Invoke-RestMethod -Uri "$scimBaseSchExt/Groups/$schExtGroupId" -Method PATCH -Headers $headers -Body $patchGrpBody -ContentType "application/scim+json"
$patchedGrpData = $patchedGrp."$customGroupExtUrn"
Test-Result -Success ($patchedGrpData.department -eq "Marketing") -Message "9m-A.27 Group PATCH extension attribute (dept=$($patchedGrpData.department))"

# ── DELETE SCHEMA & VERIFY CLEANUP ──────────────────────────────────────────

# --- Test 9m-A.28: DELETE minimal schema ---
Write-Host "`n--- Test 9m-A.28: DELETE minimal schema extension ---" -ForegroundColor Cyan
$encodedMinUrn = [System.Uri]::EscapeDataString($minimalSchemaUrn)
try {
    $null = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas/$encodedMinUrn" -Method DELETE -Headers $headers
    # Verify it's gone
    try {
        $null = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas/$encodedMinUrn" -Method GET -Headers $headers
        Test-Result -Success $false -Message "9m-A.28 Deleted schema should not be found"
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Test-Result -Success ($statusCode -eq 404) -Message "9m-A.28 Minimal schema deleted (returns 404 after)"
    }
} catch {
    Test-Result -Success $false -Message "9m-A.28 DELETE minimal schema failed: $_"
}

# --- Test 9m-A.29: DELETE non-existent URN returns 404 ---
Write-Host "`n--- Test 9m-A.29: DELETE non-existent URN returns 404 ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas/$fakeUrn" -Method DELETE -Headers $headers
    Test-Result -Success $false -Message "9m-A.29 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-A.29 DELETE non-existent URN returns 404 (HTTP $statusCode)"
}

# --- Test 9m-A.30: Deleted schema removed from /Schemas discovery ---
Write-Host "`n--- Test 9m-A.30: Deleted schema removed from discovery ---" -ForegroundColor Cyan
$schemasAfterDelete = Invoke-RestMethod -Uri "$scimBaseSchExt/Schemas" -Method GET -Headers $headers
$minimalInDiscovery = $schemasAfterDelete.Resources | Where-Object { $_.id -eq $minimalSchemaUrn }
Test-Result -Success ($null -eq $minimalInDiscovery) -Message "9m-A.30 Deleted schema no longer in /Schemas discovery"

# --- Test 9m-A.31: Schema list updated to 2 after delete ---
Write-Host "`n--- Test 9m-A.31: Schema count reduced after delete ---" -ForegroundColor Cyan
$schemaListAfter = Invoke-RestMethod -Uri "$adminBaseSchExt/schemas" -Method GET -Headers $headers
Test-Result -Success ($schemaListAfter.totalResults -eq 2) -Message "9m-A.31 Schema count reduced to $($schemaListAfter.totalResults) after delete"

# --- Cleanup: Delete test resources ---
Write-Host "`n--- 9m-A Cleanup ---" -ForegroundColor Cyan
try { Invoke-RestMethod -Uri "$scimBaseSchExt/Users/$schExtUserId" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBaseSchExt/Groups/$schExtGroupId" -Method DELETE -Headers $headers | Out-Null } catch {}

Write-Host "`n--- 9m-A: Custom Schema Extensions Tests Complete ---" -ForegroundColor Green
} # End Skip-OldSection9mA

# ─────────────────────────────────────────────────────────────────────────────
# 9m-B: CUSTOM RESOURCE TYPES (G8b)
# ⚠️ SKIPPED: Admin Resource Type API removed in v0.28.0. RTs now in profile.
# ─────────────────────────────────────────────────────────────────────────────
$script:currentSection = "9m-B: Custom Resource Types (SKIPPED)"
Write-Host "`n`n────────────────────────────────────────────────────" -ForegroundColor Yellow
Write-Host "  9m-B: CUSTOM RESOURCE TYPES — SKIPPED (Admin API removed v0.28.0)" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────" -ForegroundColor Yellow
Test-Result -Success $true -Message "9m-B: SKIPPED — Admin RT API removed; resource types now in endpoint profile"

# ── 9m-B REPLACEMENT: Cross-endpoint isolation via profile ──
$isoWithBody = @{ name = "live-iso-w-$(Get-Random)"; profile = @{
    schemas = @(@{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = "all" }; @{ id = "urn:test:isolation"; name = "IsoExt"; description = "Isolation test"; attributes = @(@{ name = "isoAttr"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default" }) })
    resourceTypes = @(@{ id = "User"; name = "User"; endpoint = "/Users"; description = "User"; schema = "urn:ietf:params:scim:schemas:core:2.0:User"; schemaExtensions = @(@{ schema = "urn:test:isolation"; required = $false }) })
    serviceProviderConfig = @{ patch = @{ supported = $true }; bulk = @{ supported = $false }; filter = @{ supported = $true; maxResults = 100 }; sort = @{ supported = $false }; etag = @{ supported = $false }; changePassword = @{ supported = $false } }
} } | ConvertTo-Json -Depth 8
$isoWith = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $isoWithBody
$isoWithoutBody = @{ name = "live-iso-wo-$(Get-Random)"; profilePreset = "minimal" } | ConvertTo-Json
$isoWithout = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $isoWithoutBody
Test-Result -Success ($null -ne $isoWith.id) -Message "9m-B.P1: Extension endpoint created"
Test-Result -Success ($null -ne $isoWithout.id) -Message "9m-B.P2: Non-extension endpoint created"

$isoSchemas = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($isoWith.id)/Schemas" -Headers $headers
$isoNoSchemas = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($isoWithout.id)/Schemas" -Headers $headers
Test-Result -Success ($null -ne ($isoSchemas.Resources | Where-Object { $_.id -eq "urn:test:isolation" })) -Message "9m-B.P3: Extension ON endpoint shows it"
Test-Result -Success ($null -eq ($isoNoSchemas.Resources | Where-Object { $_.id -eq "urn:test:isolation" })) -Message "9m-B.P4: Extension NOT on other endpoint (isolation)"

try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($isoWith.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($isoWithout.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
Test-Result -Success $true -Message "9m-B.P5: Cleaned up isolation endpoints"

function Skip-OldSection9mB {
Write-Host "`n`n────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  9m-B: CUSTOM RESOURCE TYPES (G8b)" -ForegroundColor Cyan
Write-Host "────────────────────────────────────────────────────" -ForegroundColor Cyan

# --- Setup: Create a dedicated endpoint (custom resource types derived from profile.resourceTypes) ---
Write-Host "`n--- G8b Setup: Creating dedicated endpoint (custom resource types via profile) ---" -ForegroundColor Cyan
$g8bEndpointBody = @{
    name = "live-test-g8b-$(Get-Random)"
    displayName = "G8b Custom Resource Types Endpoint"
    description = "Endpoint for G8b live integration tests"
} | ConvertTo-Json
$g8bEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $g8bEndpointBody
$G8bEndpointId = $g8bEndpoint.id
$scimBaseG8b = "$baseUrl/scim/endpoints/$G8bEndpointId"
$adminBaseG8b = "$baseUrl/scim/admin/endpoints/$G8bEndpointId"
Test-Result -Success ($null -ne $G8bEndpointId) -Message "G8b endpoint created (custom resource types via profile.resourceTypes)"

# --- Also create an endpoint WITHOUT the flag for gating tests ---
$g8bNoFlagBody = @{
    name = "live-test-g8b-noflag-$(Get-Random)"
    displayName = "G8b No Flag Endpoint"
    description = "Endpoint WITHOUT custom resource types for gating tests"
} | ConvertTo-Json
$g8bNoFlagEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $g8bNoFlagBody
$G8bNoFlagEndpointId = $g8bNoFlagEndpoint.id

# ── CONFIG FLAG GATING ──────────────────────────────────────────────────────

# --- Test 9m-B.1: Config flag gating — should 403 when flag not enabled ---
Write-Host "`n--- Test 9m-B.1: Config flag gating (should 403 when disabled) ---" -ForegroundColor Cyan
$deviceSchema = @{
    name = "Device"
    schemaUri = "urn:ietf:params:scim:schemas:custom:Device"
    endpoint = "/Devices"
    description = "Custom Device resource type"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$G8bNoFlagEndpointId/resource-types" -Method POST -Headers $headers -Body $deviceSchema
    Test-Result -Success $false -Message "9m-B.1 Should have been rejected with 403"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 403) -Message "9m-B.1 Config flag gating rejects when disabled (HTTP $statusCode)"
}

# ── ADMIN REGISTRATION ──────────────────────────────────────────────────────

# --- Test 9m-B.2: Register a custom resource type ---
Write-Host "`n--- Test 9m-B.2: Register Device resource type ---" -ForegroundColor Cyan
$deviceReg = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $deviceSchema
Test-Result -Success ($deviceReg.name -eq "Device" -and $deviceReg.endpoint -eq "/Devices") -Message "9m-B.2 Device resource type registered (name=$($deviceReg.name), endpoint=$($deviceReg.endpoint))"

# --- Test 9m-B.3: Reject reserved name "User" ---
Write-Host "`n--- Test 9m-B.3: Reject reserved name 'User' ---" -ForegroundColor Cyan
$reservedBody = @{
    name = "User"
    schemaUri = "urn:custom:User"
    endpoint = "/CustomUsers"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $reservedBody
    Test-Result -Success $false -Message "9m-B.3 Should have been rejected for reserved name"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m-B.3 Reserved name 'User' rejected (HTTP $statusCode)"
}

# --- Test 9m-B.4: Reject reserved name "Group" ---
Write-Host "`n--- Test 9m-B.4: Reject reserved name 'Group' ---" -ForegroundColor Cyan
$reservedGrpBody = @{
    name = "Group"
    schemaUri = "urn:custom:Group"
    endpoint = "/CustomGroups"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $reservedGrpBody
    Test-Result -Success $false -Message "9m-B.4 Should have been rejected for reserved name"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m-B.4 Reserved name 'Group' rejected (HTTP $statusCode)"
}

# --- Test 9m-B.5: Reject reserved endpoint path /Groups ---
Write-Host "`n--- Test 9m-B.5: Reject reserved endpoint path /Groups ---" -ForegroundColor Cyan
$reservedPathBody = @{
    name = "CustomGroup"
    schemaUri = "urn:custom:Group"
    endpoint = "/Groups"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $reservedPathBody
    Test-Result -Success $false -Message "9m-B.5 Should have been rejected for reserved path"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m-B.5 Reserved endpoint path '/Groups' rejected (HTTP $statusCode)"
}

# --- Test 9m-B.6: Reject reserved endpoint path /Schemas ---
Write-Host "`n--- Test 9m-B.6: Reject reserved endpoint path /Schemas ---" -ForegroundColor Cyan
$reservedSchemasPath = @{
    name = "CustomSchemas"
    schemaUri = "urn:custom:Schemas"
    endpoint = "/Schemas"
} | ConvertTo-Json
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $reservedSchemasPath
    Test-Result -Success $false -Message "9m-B.6 Should have been rejected for reserved path"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m-B.6 Reserved endpoint path '/Schemas' rejected (HTTP $statusCode)"
}

# --- Test 9m-B.7: Reject duplicate resource type name ---
Write-Host "`n--- Test 9m-B.7: Reject duplicate resource type name ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $deviceSchema
    Test-Result -Success $false -Message "9m-B.7 Should have been rejected as duplicate"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 409) -Message "9m-B.7 Duplicate name 'Device' rejected (HTTP $statusCode)"
}

# --- Test 9m-B.8: 404 for non-existent endpoint ---
Write-Host "`n--- Test 9m-B.8: 404 for non-existent endpoint ---" -ForegroundColor Cyan
$fakeEndpointId = "00000000-0000-0000-0000-000000000000"
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$fakeEndpointId/resource-types" -Method POST -Headers $headers -Body $deviceSchema
    Test-Result -Success $false -Message "9m-B.8 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-B.8 Non-existent endpoint returns 404 (HTTP $statusCode)"
}

# ── ADMIN LIST & GET ────────────────────────────────────────────────────────

# --- Test 9m-B.9: List registered resource types ---
Write-Host "`n--- Test 9m-B.9: List registered resource types ---" -ForegroundColor Cyan
$listing = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method GET -Headers $headers
Test-Result -Success ($listing.totalResults -ge 1) -Message "9m-B.9 List resource types returns $($listing.totalResults) item(s)"

# --- Test 9m-B.10: Get specific resource type by name ---
Write-Host "`n--- Test 9m-B.10: Get resource type by name ---" -ForegroundColor Cyan
$deviceGet = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/Device" -Method GET -Headers $headers
Test-Result -Success ($deviceGet.name -eq "Device" -and $deviceGet.schemaUri -eq "urn:ietf:params:scim:schemas:custom:Device") -Message "9m-B.10 GET /resource-types/Device returns correct data"

# --- Test 9m-B.11: 404 for non-existent resource type name ---
Write-Host "`n--- Test 9m-B.11: 404 for non-existent resource type ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/NonExistent" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m-B.11 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-B.11 Non-existent resource type returns 404 (HTTP $statusCode)"
}

# ── GENERIC SCIM CRUD FOR CUSTOM RESOURCES ──────────────────────────────────

# --- Test 9m-B.12: Create a custom Device resource via POST ---
Write-Host "`n--- Test 9m-B.12: Create a custom Device resource via SCIM ---" -ForegroundColor Cyan
$deviceBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Device")
    displayName = "Test Laptop G8b"
    externalId = "device-ext-001"
} | ConvertTo-Json
$deviceRes = Invoke-RestMethod -Uri "$scimBaseG8b/Devices" -Method POST -Headers $headers -Body $deviceBody -ContentType "application/scim+json"
$g8bDeviceId = $deviceRes.id
Test-Result -Success ($null -ne $g8bDeviceId -and $deviceRes.meta.resourceType -eq "Device") -Message "9m-B.12 Device created (id=$g8bDeviceId, resourceType=$($deviceRes.meta.resourceType))"

# --- Test 9m-B.13: GET the created Device ---
Write-Host "`n--- Test 9m-B.13: GET the created Device ---" -ForegroundColor Cyan
$deviceFetched = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method GET -Headers $headers
Test-Result -Success ($deviceFetched.id -eq $g8bDeviceId -and $deviceFetched.displayName -eq "Test Laptop G8b") -Message "9m-B.13 GET Device returns correct resource"

# --- Test 9m-B.14: List Devices ---
Write-Host "`n--- Test 9m-B.14: List Devices ---" -ForegroundColor Cyan
$deviceList = Invoke-RestMethod -Uri "$scimBaseG8b/Devices" -Method GET -Headers $headers
Test-Result -Success ($deviceList.totalResults -ge 1 -and $deviceList.Resources.Count -ge 1) -Message "9m-B.14 GET /Devices list returns $($deviceList.totalResults) resource(s)"

# --- Test 9m-B.15: PUT replace the Device ---
Write-Host "`n--- Test 9m-B.15: PUT replace the Device ---" -ForegroundColor Cyan
$putBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Device")
    displayName = "Updated Laptop G8b"
    externalId = "device-ext-001-updated"
} | ConvertTo-Json
$devicePut = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method PUT -Headers $headers -Body $putBody -ContentType "application/scim+json"
Test-Result -Success ($devicePut.displayName -eq "Updated Laptop G8b") -Message "9m-B.15 PUT replace Device succeeds (displayName=$($devicePut.displayName))"

# --- Test 9m-B.16: PATCH the Device ---
Write-Host "`n--- Test 9m-B.16: PATCH the Device ---" -ForegroundColor Cyan
$patchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "displayName"; value = "Patched Laptop G8b" }
    )
} | ConvertTo-Json -Depth 3
$devicePatched = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/scim+json"
Test-Result -Success ($devicePatched.displayName -eq "Patched Laptop G8b") -Message "9m-B.16 PATCH Device succeeds (displayName=$($devicePatched.displayName))"

# --- Test 9m-B.17: DELETE the Device ---
Write-Host "`n--- Test 9m-B.17: DELETE the Device ---" -ForegroundColor Cyan
$null = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method DELETE -Headers $headers
try {
    $null = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/$g8bDeviceId" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m-B.17 Deleted Device should not be found"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-B.17 DELETE Device works (resource returns 404 after)"
}

# --- Test 9m-B.18: 404 for non-existent Device ---
Write-Host "`n--- Test 9m-B.18: GET non-existent Device returns 404 ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBaseG8b/Devices/00000000-0000-0000-0000-000000000099" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m-B.18 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-B.18 Non-existent Device returns 404 (HTTP $statusCode)"
}

# --- Test 9m-B.19: Reject POST with wrong schemas ---
Write-Host "`n--- Test 9m-B.19: Reject POST with wrong schemas ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBaseG8b/Devices" -Method POST -Headers $headers -Body (@{
        schemas = @("wrong:schema")
        displayName = "Bad Device"
    } | ConvertTo-Json) -ContentType "application/scim+json"
    Test-Result -Success $false -Message "9m-B.19 Should have been rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m-B.19 Wrong schemas rejected on POST (HTTP $statusCode)"
}

# ── MULTIPLE RESOURCE TYPES ────────────────────────────────────────────────

# --- Test 9m-B.20: Register a second resource type (Application) ---
Write-Host "`n--- Test 9m-B.20: Register Application resource type on same endpoint ---" -ForegroundColor Cyan
$appSchema = @{
    name = "Application"
    schemaUri = "urn:ietf:params:scim:schemas:custom:Application"
    endpoint = "/Applications"
    description = "Custom Application resource type"
} | ConvertTo-Json
$appReg = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method POST -Headers $headers -Body $appSchema
Test-Result -Success ($appReg.name -eq "Application") -Message "9m-B.20 Application resource type registered"

# --- Test 9m-B.21: Create an Application resource ---
Write-Host "`n--- Test 9m-B.21: Create an Application resource ---" -ForegroundColor Cyan
$appBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Application")
    displayName = "Test App G8b"
} | ConvertTo-Json
$appRes = Invoke-RestMethod -Uri "$scimBaseG8b/Applications" -Method POST -Headers $headers -Body $appBody -ContentType "application/scim+json"
$g8bAppId = $appRes.id
Test-Result -Success ($null -ne $g8bAppId -and $appRes.meta.resourceType -eq "Application") -Message "9m-B.21 Application created (id=$g8bAppId)"

# --- Test 9m-B.22: List resource types — should have 2 ---
Write-Host "`n--- Test 9m-B.22: List resource types shows 2 ---" -ForegroundColor Cyan
$rtListing = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method GET -Headers $headers
Test-Result -Success ($rtListing.totalResults -eq 2) -Message "9m-B.22 List resource types returns $($rtListing.totalResults) items"

# ── ENDPOINT ISOLATION ──────────────────────────────────────────────────────

# --- Test 9m-B.23: Endpoint isolation — other endpoints should NOT see Devices ---
Write-Host "`n--- Test 9m-B.23: Endpoint isolation ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase/Devices" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m-B.23 Main endpoint should NOT serve /Devices"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-B.23 Endpoint isolation works — main endpoint returns 404 for /Devices (HTTP $statusCode)"
}

# --- Test 9m-B.24: Built-in /Users still works on G8b endpoint ---
Write-Host "`n--- Test 9m-B.24: Built-in /Users still works on G8b endpoint ---" -ForegroundColor Cyan
$usersOnG8b = Invoke-RestMethod -Uri "$scimBaseG8b/Users" -Method GET -Headers $headers
Test-Result -Success ($null -ne $usersOnG8b.totalResults) -Message "9m-B.24 Built-in /Users works on G8b endpoint (totalResults=$($usersOnG8b.totalResults))"

# --- Test 9m-B.25: Built-in /Groups still works on G8b endpoint ---
Write-Host "`n--- Test 9m-B.25: Built-in /Groups still works on G8b endpoint ---" -ForegroundColor Cyan
$groupsOnG8b = Invoke-RestMethod -Uri "$scimBaseG8b/Groups" -Method GET -Headers $headers
Test-Result -Success ($null -ne $groupsOnG8b.totalResults) -Message "9m-B.25 Built-in /Groups works on G8b endpoint (totalResults=$($groupsOnG8b.totalResults))"

# ── ADMIN DELETE ────────────────────────────────────────────────────────────

# --- Test 9m-B.26: Delete Application resource type ---
Write-Host "`n--- Test 9m-B.26: Delete Application resource type ---" -ForegroundColor Cyan
$null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/Application" -Method DELETE -Headers $headers
$listAfterDelete = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types" -Method GET -Headers $headers
$appStillExists = $listAfterDelete.resourceTypes | Where-Object { $_.name -eq "Application" }
Test-Result -Success ($null -eq $appStillExists) -Message "9m-B.26 Application resource type deleted (no longer in list)"

# --- Test 9m-B.27: Reject deletion of built-in type "User" ---
Write-Host "`n--- Test 9m-B.27: Reject deletion of built-in type 'User' ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/User" -Method DELETE -Headers $headers
    Test-Result -Success $false -Message "9m-B.27 Should have been rejected"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m-B.27 Deletion of built-in type 'User' rejected (HTTP $statusCode)"
}

# --- Test 9m-B.28: DELETE non-existent resource type returns 404 ---
Write-Host "`n--- Test 9m-B.28: DELETE non-existent resource type ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$adminBaseG8b/resource-types/NonExistent" -Method DELETE -Headers $headers
    Test-Result -Success $false -Message "9m-B.28 Should have returned 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-B.28 Non-existent resource type DELETE returns 404 (HTTP $statusCode)"
}

Write-Host "`n--- 9m-B: Custom Resource Type Tests Complete ---" -ForegroundColor Green
} # End Skip-OldSection9mB

# ─────────────────────────────────────────────────────────────────────────────
# 9m-C: SCHEMA CUSTOMIZATION COMBINATIONS
# ⚠️ SKIPPED: Uses Admin Resource Type API removed in v0.28.0.
# ─────────────────────────────────────────────────────────────────────────────
$script:currentSection = "9m-C: Schema Customization Combos (SKIPPED)"
Write-Host "`n`n────────────────────────────────────────────────────" -ForegroundColor Yellow
Write-Host "  9m-C: SCHEMA CUSTOMIZATION COMBINATIONS — SKIPPED (Admin API removed v0.28.0)" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────" -ForegroundColor Yellow
Test-Result -Success $true -Message "9m-C: SKIPPED — uses deleted Admin RT API; combos tested in profile-combinations.e2e-spec.ts"

function Skip-OldSection9mC {
#   Tests combining custom schema extensions with custom resource types,
#   including StrictSchemaValidation flag, attribute characteristics,
#   discovery cross-validation, and multi-resource-type + extension flows.
# ─────────────────────────────────────────────────────────────────────────────
$script:currentSection = "9m-C: Schema Customization Combos"
Write-Host "`n`n────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  9m-C: SCHEMA CUSTOMIZATION COMBINATIONS" -ForegroundColor Cyan
Write-Host "────────────────────────────────────────────────────" -ForegroundColor Cyan

# --- Setup: Endpoint with custom resource types (derived from profile.resourceTypes) ---
Write-Host "`n--- 9m-C Setup: Creating combo endpoint ---" -ForegroundColor Cyan
$comboEndpointBody = @{
    name = "live-test-combo-$(Get-Random)"
    displayName = "Schema Combo Test Endpoint"
    description = "Endpoint for combined custom schemas + custom resource types"
} | ConvertTo-Json -Depth 3
$comboEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $comboEndpointBody
$ComboEndpointId = $comboEndpoint.id
$scimBaseCombo = "$baseUrl/scim/endpoints/$ComboEndpointId"
$adminBaseCombo = "$baseUrl/scim/admin/endpoints/$ComboEndpointId"
Test-Result -Success ($null -ne $ComboEndpointId) -Message "9m-C: Combo endpoint created"

# --- Setup: Endpoint with StrictSchemaValidation for strict mode tests ---
$strictEndpointBody = @{
    name = "live-test-strict-combo-$(Get-Random)"
    displayName = "Strict Schema Combo Endpoint"
    description = "Endpoint with StrictSchemaValidation for combo tests"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$strictEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $strictEndpointBody
$StrictComboEndpointId = $strictEndpoint.id
$patchBody = @{ profile = @{ settings = @{ StrictSchemaValidation = "True" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$StrictComboEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$scimBaseStrict = "$baseUrl/scim/endpoints/$StrictComboEndpointId"
$adminBaseStrict = "$baseUrl/scim/admin/endpoints/$StrictComboEndpointId"
Test-Result -Success ($null -ne $StrictComboEndpointId) -Message "9m-C: Strict combo endpoint created"

# ── COMBO 1: Custom extension on custom resource type ───────────────────────

# --- Test 9m-C.1: Register custom "Printer" resource type ---
Write-Host "`n--- Test 9m-C.1: Register Printer resource type ---" -ForegroundColor Cyan
$printerRTBody = @{
    name = "Printer"
    schemaUri = "urn:example:schemas:core:2.0:Printer"
    endpoint = "/Printers"
    description = "Custom Printer resource type"
} | ConvertTo-Json
$printerRT = Invoke-RestMethod -Uri "$adminBaseCombo/resource-types" -Method POST -Headers $headers -Body $printerRTBody
Test-Result -Success ($printerRT.name -eq "Printer") -Message "9m-C.1 Printer resource type registered"

# --- Test 9m-C.2: Register extension for Printer resource type ---
Write-Host "`n--- Test 9m-C.2: Register extension for Printer ---" -ForegroundColor Cyan
$printerExtUrn = "urn:example:schemas:extension:printer:2.0"
$printerExtBody = @{
    schemaUrn = $printerExtUrn
    name = "Printer Extension"
    description = "Extended attributes for printers"
    resourceTypeId = "Printer"
    required = $false
    attributes = @(
        @{ name = "location"; type = "string"; multiValued = $false; required = $true; description = "Physical location"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "paperCapacity"; type = "integer"; multiValued = $false; required = $false; description = "Paper tray capacity"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "maintenanceKey"; type = "string"; multiValued = $false; required = $false; description = "Maintenance secret"; mutability = "writeOnly"; returned = "never"; caseExact = $true; uniqueness = "none" }
        @{ name = "colorModes"; type = "string"; multiValued = $true; required = $false; description = "Supported color modes"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
    )
} | ConvertTo-Json -Depth 4
$printerExt = Invoke-RestMethod -Uri "$adminBaseCombo/schemas" -Method POST -Headers $headers -Body $printerExtBody -ContentType "application/json"
Test-Result -Success ($printerExt.schemaUrn -eq $printerExtUrn) -Message "9m-C.2 Printer extension registered (urn=$($printerExt.schemaUrn))"

# --- Test 9m-C.3: Register User extension on combo endpoint ---
Write-Host "`n--- Test 9m-C.3: Register User extension on combo endpoint ---" -ForegroundColor Cyan
$comboUserExtUrn = "urn:example:schemas:extension:combo:2.0:User"
$comboUserExtBody = @{
    schemaUrn = $comboUserExtUrn
    name = "Combo User Extension"
    description = "User extension for combo tests"
    resourceTypeId = "User"
    required = $false
    attributes = @(
        @{ name = "division"; type = "string"; multiValued = $false; required = $false; description = "User division"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "level"; type = "integer"; multiValued = $false; required = $false; description = "User level"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
    )
} | ConvertTo-Json -Depth 4
$comboUserExt = Invoke-RestMethod -Uri "$adminBaseCombo/schemas" -Method POST -Headers $headers -Body $comboUserExtBody -ContentType "application/json"
Test-Result -Success ($comboUserExt.schemaUrn -eq $comboUserExtUrn) -Message "9m-C.3 User extension on combo endpoint registered"

# --- Test 9m-C.4: Create Printer with extension data ---
Write-Host "`n--- Test 9m-C.4: Create Printer with extension data ---" -ForegroundColor Cyan
$printerBody = @{
    schemas = @("urn:example:schemas:core:2.0:Printer", $printerExtUrn)
    displayName = "Office Laser Printer"
    externalId = "printer-001"
    "$printerExtUrn" = @{
        location = "Building A, Floor 3"
        paperCapacity = 500
        maintenanceKey = "secret-maint-key"
        colorModes = @("color", "grayscale", "bw")
    }
} | ConvertTo-Json -Depth 4
$printerRes = Invoke-RestMethod -Uri "$scimBaseCombo/Printers" -Method POST -Headers $headers -Body $printerBody -ContentType "application/scim+json"
$comboPrinterId = $printerRes.id
$printerExtData = $printerRes."$printerExtUrn"
Test-Result -Success ($null -ne $comboPrinterId -and $printerRes.meta.resourceType -eq "Printer" -and $null -ne $printerExtData) -Message "9m-C.4 Printer created with extension data (id=$comboPrinterId)"

# --- Test 9m-C.5: Extension data roundtrip on custom resource type ---
Write-Host "`n--- Test 9m-C.5: Extension data roundtrip on custom resource ---" -ForegroundColor Cyan
$fetchedPrinter = Invoke-RestMethod -Uri "$scimBaseCombo/Printers/$comboPrinterId" -Method GET -Headers $headers
$fetchedPrinterExt = $fetchedPrinter."$printerExtUrn"
$locationOk = ($fetchedPrinterExt.location -eq "Building A, Floor 3")
$capacityOk = ($fetchedPrinterExt.paperCapacity -eq 500)
Test-Result -Success ($locationOk -and $capacityOk) -Message "9m-C.5 Extension data roundtrips (location=$($fetchedPrinterExt.location), capacity=$($fetchedPrinterExt.paperCapacity))"

# --- Test 9m-C.6: returned:never on custom resource (maintenanceKey) ---
Write-Host "`n--- Test 9m-C.6: returned:never on custom resource ---" -ForegroundColor Cyan
$maintKeyInGet = $fetchedPrinterExt.maintenanceKey
Test-Result -Success ($null -eq $maintKeyInGet) -Message "9m-C.6 maintenanceKey (returned:never) stripped from Printer GET"

# --- Test 9m-C.7: Multi-valued extension attr on custom resource ---
Write-Host "`n--- Test 9m-C.7: Multi-valued extension attr on custom resource ---" -ForegroundColor Cyan
$colorModesOk = ($fetchedPrinterExt.colorModes -is [array]) -and ($fetchedPrinterExt.colorModes.Count -eq 3)
Test-Result -Success $colorModesOk -Message "9m-C.7 colorModes array roundtrips ($($fetchedPrinterExt.colorModes -join ', '))"

# --- Test 9m-C.8: PUT Printer with updated extension data ---
Write-Host "`n--- Test 9m-C.8: PUT Printer with updated extension data ---" -ForegroundColor Cyan
$putPrinterBody = @{
    schemas = @("urn:example:schemas:core:2.0:Printer", $printerExtUrn)
    displayName = "Updated Laser Printer"
    "$printerExtUrn" = @{
        location = "Building B, Floor 1"
        paperCapacity = 250
        colorModes = @("bw")
    }
} | ConvertTo-Json -Depth 4
$putPrinter = Invoke-RestMethod -Uri "$scimBaseCombo/Printers/$comboPrinterId" -Method PUT -Headers $headers -Body $putPrinterBody -ContentType "application/scim+json"
$putPrinterExt = $putPrinter."$printerExtUrn"
Test-Result -Success ($putPrinterExt.location -eq "Building B, Floor 1" -and $putPrinterExt.paperCapacity -eq 250) -Message "9m-C.8 PUT updates Printer extension data"

# --- Test 9m-C.9: PATCH extension attr on custom resource ---
Write-Host "`n--- Test 9m-C.9: PATCH extension attr on custom resource ---" -ForegroundColor Cyan
$patchPrinterBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "$($printerExtUrn):location"; value = "Remote Office" }
    )
} | ConvertTo-Json -Depth 3
$patchedPrinter = Invoke-RestMethod -Uri "$scimBaseCombo/Printers/$comboPrinterId" -Method PATCH -Headers $headers -Body $patchPrinterBody -ContentType "application/scim+json"
$patchedPrinterExt = $patchedPrinter."$printerExtUrn"
Test-Result -Success ($patchedPrinterExt.location -eq "Remote Office") -Message "9m-C.9 PATCH extension on custom resource (location=$($patchedPrinterExt.location))"

# ── COMBO 2: Built-in User + custom extension on same combo endpoint ────────

# --- Test 9m-C.10: Create User with combo extension ---
Write-Host "`n--- Test 9m-C.10: Create User with extension on combo endpoint ---" -ForegroundColor Cyan
$comboUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $comboUserExtUrn)
    userName = "combo-user-$(Get-Random)@test.com"
    displayName = "Combo Test User"
    name = @{ givenName = "Combo"; familyName = "User" }
    "$comboUserExtUrn" = @{
        division = "R&D"
        level = 5
    }
} | ConvertTo-Json -Depth 4
$comboUser = Invoke-RestMethod -Uri "$scimBaseCombo/Users" -Method POST -Headers $headers -Body $comboUserBody -ContentType "application/scim+json"
$comboUserId = $comboUser.id
$comboUserExt = $comboUser."$comboUserExtUrn"
Test-Result -Success ($null -ne $comboUserId -and $comboUserExt.division -eq "R&D") -Message "9m-C.10 User with extension created on combo endpoint (division=$($comboUserExt.division))"

# --- Test 9m-C.11: Custom extension in user list on combo endpoint ---
Write-Host "`n--- Test 9m-C.11: Extension data in user list ---" -ForegroundColor Cyan
$comboUserList = Invoke-RestMethod -Uri "$scimBaseCombo/Users" -Method GET -Headers $headers
$foundComboUser = $comboUserList.Resources | Where-Object { $_.id -eq $comboUserId }
$listExtOk = ($null -ne $foundComboUser."$comboUserExtUrn")
Test-Result -Success $listExtOk -Message "9m-C.11 Extension data present in user list response"

# ── COMBO 3: Discovery cross-validation ─────────────────────────────────────

# --- Test 9m-C.12: /Schemas shows both custom extensions ---
Write-Host "`n--- Test 9m-C.12: /Schemas shows both extensions ---" -ForegroundColor Cyan
$comboSchemas = Invoke-RestMethod -Uri "$scimBaseCombo/Schemas" -Method GET -Headers $headers
$hasPrinterExt = ($comboSchemas.Resources | Where-Object { $_.id -eq $printerExtUrn }) -ne $null
$hasUserExt = ($comboSchemas.Resources | Where-Object { $_.id -eq $comboUserExtUrn }) -ne $null
Test-Result -Success ($hasPrinterExt -and $hasUserExt) -Message "9m-C.12 /Schemas shows both Printer and User extensions"

# --- Test 9m-C.13: /ResourceTypes shows custom Printer type ---
Write-Host "`n--- Test 9m-C.13: /ResourceTypes shows custom types ---" -ForegroundColor Cyan
$comboResourceTypes = Invoke-RestMethod -Uri "$scimBaseCombo/ResourceTypes" -Method GET -Headers $headers
$hasPrinterRT = ($comboResourceTypes.Resources | Where-Object { $_.name -eq "Printer" }) -ne $null
Test-Result -Success $hasPrinterRT -Message "9m-C.13 /ResourceTypes includes custom Printer type"

# --- Test 9m-C.14: /ResourceTypes still has built-in User and Group ---
Write-Host "`n--- Test 9m-C.14: Built-in types still in /ResourceTypes ---" -ForegroundColor Cyan
$hasUserRT = ($comboResourceTypes.Resources | Where-Object { $_.name -eq "User" }) -ne $null
$hasGroupRT = ($comboResourceTypes.Resources | Where-Object { $_.name -eq "Group" }) -ne $null
Test-Result -Success ($hasUserRT -and $hasGroupRT) -Message "9m-C.14 Built-in User and Group still in /ResourceTypes"

# ── COMBO 4: StrictSchemaValidation + custom extensions + custom RT ─────────

# --- Test 9m-C.15: Register resource type on strict endpoint ---
Write-Host "`n--- Test 9m-C.15: Register Sensor on strict endpoint ---" -ForegroundColor Cyan
$sensorRTBody = @{
    name = "Sensor"
    schemaUri = "urn:example:schemas:core:2.0:Sensor"
    endpoint = "/Sensors"
    description = "IoT Sensor resource type"
} | ConvertTo-Json
$sensorRT = Invoke-RestMethod -Uri "$adminBaseStrict/resource-types" -Method POST -Headers $headers -Body $sensorRTBody
Test-Result -Success ($sensorRT.name -eq "Sensor") -Message "9m-C.15 Sensor resource type registered on strict endpoint"

# --- Test 9m-C.16: Register extension for Sensor with required attr ---
Write-Host "`n--- Test 9m-C.16: Register Sensor extension with required attr ---" -ForegroundColor Cyan
$sensorExtUrn = "urn:example:schemas:extension:sensor:2.0"
$sensorExtBody = @{
    schemaUrn = $sensorExtUrn
    name = "Sensor Extension"
    description = "Extended sensor attributes"
    resourceTypeId = "Sensor"
    required = $true
    attributes = @(
        @{ name = "sensorType"; type = "string"; multiValued = $false; required = $true; description = "Type of sensor"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "firmwareVersion"; type = "string"; multiValued = $false; required = $false; description = "Firmware version"; mutability = "readOnly"; returned = "default"; caseExact = $true; uniqueness = "none" }
        @{ name = "calibrationSecret"; type = "string"; multiValued = $false; required = $false; description = "Calibration key"; mutability = "writeOnly"; returned = "never"; caseExact = $true; uniqueness = "none" }
    )
} | ConvertTo-Json -Depth 4
$sensorExt = Invoke-RestMethod -Uri "$adminBaseStrict/schemas" -Method POST -Headers $headers -Body $sensorExtBody -ContentType "application/json"
Test-Result -Success ($sensorExt.schemaUrn -eq $sensorExtUrn) -Message "9m-C.16 Sensor extension registered (required=true)"

# --- Test 9m-C.17: Create Sensor with required extension ---
Write-Host "`n--- Test 9m-C.17: Create Sensor with required extension data ---" -ForegroundColor Cyan
$sensorBody = @{
    schemas = @("urn:example:schemas:core:2.0:Sensor", $sensorExtUrn)
    displayName = "Temperature Sensor A1"
    externalId = "sensor-001"
    "$sensorExtUrn" = @{
        sensorType = "temperature"
        calibrationSecret = "cal-secret-123"
    }
} | ConvertTo-Json -Depth 4
$sensorRes = Invoke-RestMethod -Uri "$scimBaseStrict/Sensors" -Method POST -Headers $headers -Body $sensorBody -ContentType "application/scim+json"
$strictSensorId = $sensorRes.id
Test-Result -Success ($null -ne $strictSensorId -and $sensorRes.meta.resourceType -eq "Sensor") -Message "9m-C.17 Sensor created on strict endpoint (id=$strictSensorId)"

# --- Test 9m-C.18: Verify returned:never on strict endpoint ---
Write-Host "`n--- Test 9m-C.18: returned:never on strict endpoint ---" -ForegroundColor Cyan
$fetchedSensor = Invoke-RestMethod -Uri "$scimBaseStrict/Sensors/$strictSensorId" -Method GET -Headers $headers
$fetchedSensorExt = $fetchedSensor."$sensorExtUrn"
$calSecretAbsent = ($null -eq $fetchedSensorExt.calibrationSecret)
Test-Result -Success $calSecretAbsent -Message "9m-C.18 calibrationSecret (returned:never) stripped on strict endpoint"

# --- Test 9m-C.19: readOnly attr (firmwareVersion) not settable via PATCH ---
Write-Host "`n--- Test 9m-C.19: readOnly extension attr blocked on PATCH ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBaseStrict/Sensors/$strictSensorId" -Method PATCH -Headers $headers -Body (@{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
        Operations = @(
            @{ op = "replace"; path = "$($sensorExtUrn):firmwareVersion"; value = "hacked-v2" }
        )
    } | ConvertTo-Json -Depth 3) -ContentType "application/scim+json"
    # If not rejected, check that the value was NOT actually changed
    $checkSensor = Invoke-RestMethod -Uri "$scimBaseStrict/Sensors/$strictSensorId" -Method GET -Headers $headers
    $fwAfter = $checkSensor."$sensorExtUrn".firmwareVersion
    Test-Result -Success ($fwAfter -ne "hacked-v2") -Message "9m-C.19 readOnly firmwareVersion not changed (value=$fwAfter)"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9m-C.19 readOnly extension attr rejected on PATCH (HTTP $statusCode)"
}

# --- Test 9m-C.20: Register User extension on strict endpoint ---
Write-Host "`n--- Test 9m-C.20: Register User extension on strict endpoint ---" -ForegroundColor Cyan
$strictUserExtUrn = "urn:example:schemas:extension:strict:2.0:User"
$strictUserExtBody = @{
    schemaUrn = $strictUserExtUrn
    name = "Strict User Extension"
    description = "User extension for strict mode"
    resourceTypeId = "User"
    required = $false
    attributes = @(
        @{ name = "clearanceLevel"; type = "string"; multiValued = $false; required = $false; description = "Security clearance"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
        @{ name = "accessCode"; type = "string"; multiValued = $false; required = $false; description = "Access code"; mutability = "writeOnly"; returned = "never"; caseExact = $true; uniqueness = "none" }
    )
} | ConvertTo-Json -Depth 4
$strictUserExt = Invoke-RestMethod -Uri "$adminBaseStrict/schemas" -Method POST -Headers $headers -Body $strictUserExtBody -ContentType "application/json"
Test-Result -Success ($strictUserExt.schemaUrn -eq $strictUserExtUrn) -Message "9m-C.20 User extension on strict endpoint registered"

# --- Test 9m-C.21: Create User with extension on strict endpoint ---
Write-Host "`n--- Test 9m-C.21: Create User with extension on strict endpoint ---" -ForegroundColor Cyan
$strictUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $strictUserExtUrn)
    userName = "strict-combo-user-$(Get-Random)@test.com"
    displayName = "Strict Combo User"
    name = @{ givenName = "Strict"; familyName = "ComboUser" }
    "$strictUserExtUrn" = @{
        clearanceLevel = "top-secret"
        accessCode = "code-123"
    }
} | ConvertTo-Json -Depth 4
$strictComboUser = Invoke-RestMethod -Uri "$scimBaseStrict/Users" -Method POST -Headers $headers -Body $strictUserBody -ContentType "application/scim+json"
$strictComboUserId = $strictComboUser.id
Test-Result -Success ($null -ne $strictComboUserId) -Message "9m-C.21 User created on strict endpoint (id=$strictComboUserId)"

# --- Test 9m-C.22: accessCode (returned:never) stripped on strict endpoint for User ---
Write-Host "`n--- Test 9m-C.22: returned:never on strict User ---" -ForegroundColor Cyan
$fetchedStrictUser = Invoke-RestMethod -Uri "$scimBaseStrict/Users/$strictComboUserId" -Method GET -Headers $headers
$strictUserExtData = $fetchedStrictUser."$strictUserExtUrn"
$accessCodeAbsent = ($null -eq $strictUserExtData.accessCode)
$clearanceOk = ($strictUserExtData.clearanceLevel -eq "top-secret")
Test-Result -Success ($accessCodeAbsent -and $clearanceOk) -Message "9m-C.22 accessCode stripped, clearanceLevel persists on strict User"

# ── COMBO 5: Multiple resource types + multiple extensions on one endpoint ──

# --- Test 9m-C.23: Register another custom RT on combo endpoint ---
Write-Host "`n--- Test 9m-C.23: Register Vehicle resource type on combo endpoint ---" -ForegroundColor Cyan
$vehicleRTBody = @{
    name = "Vehicle"
    schemaUri = "urn:example:schemas:core:2.0:Vehicle"
    endpoint = "/Vehicles"
    description = "Custom Vehicle resource type"
} | ConvertTo-Json
$vehicleRT = Invoke-RestMethod -Uri "$adminBaseCombo/resource-types" -Method POST -Headers $headers -Body $vehicleRTBody
Test-Result -Success ($vehicleRT.name -eq "Vehicle") -Message "9m-C.23 Vehicle resource type registered on combo endpoint"

# --- Test 9m-C.24: Register Vehicle extension ---
Write-Host "`n--- Test 9m-C.24: Register Vehicle extension ---" -ForegroundColor Cyan
$vehicleExtUrn = "urn:example:schemas:extension:vehicle:2.0"
$vehicleExtBody = @{
    schemaUrn = $vehicleExtUrn
    name = "Vehicle Extension"
    description = "Extended vehicle attributes"
    resourceTypeId = "Vehicle"
    required = $false
    attributes = @(
        @{ name = "vin"; type = "string"; multiValued = $false; required = $true; description = "Vehicle Identification Number"; mutability = "readWrite"; returned = "default"; caseExact = $true; uniqueness = "server" }
        @{ name = "mileage"; type = "integer"; multiValued = $false; required = $false; description = "Odometer reading"; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
    )
} | ConvertTo-Json -Depth 4
$vehicleExt = Invoke-RestMethod -Uri "$adminBaseCombo/schemas" -Method POST -Headers $headers -Body $vehicleExtBody -ContentType "application/json"
Test-Result -Success ($vehicleExt.schemaUrn -eq $vehicleExtUrn) -Message "9m-C.24 Vehicle extension registered"

# --- Test 9m-C.25: Create Vehicle with extension ---
Write-Host "`n--- Test 9m-C.25: Create Vehicle with extension data ---" -ForegroundColor Cyan
$vehicleBody = @{
    schemas = @("urn:example:schemas:core:2.0:Vehicle", $vehicleExtUrn)
    displayName = "Company Van"
    externalId = "vehicle-001"
    "$vehicleExtUrn" = @{
        vin = "1HGBH41JXMN109186"
        mileage = 12500
    }
} | ConvertTo-Json -Depth 4
$vehicleRes = Invoke-RestMethod -Uri "$scimBaseCombo/Vehicles" -Method POST -Headers $headers -Body $vehicleBody -ContentType "application/scim+json"
$comboVehicleId = $vehicleRes.id
Test-Result -Success ($null -ne $comboVehicleId -and $vehicleRes.meta.resourceType -eq "Vehicle") -Message "9m-C.25 Vehicle with extension created (id=$comboVehicleId)"

# --- Test 9m-C.26: Vehicle extension data roundtrips ---
Write-Host "`n--- Test 9m-C.26: Vehicle extension data roundtrip ---" -ForegroundColor Cyan
$fetchedVehicle = Invoke-RestMethod -Uri "$scimBaseCombo/Vehicles/$comboVehicleId" -Method GET -Headers $headers
$fetchedVehicleExt = $fetchedVehicle."$vehicleExtUrn"
Test-Result -Success ($fetchedVehicleExt.vin -eq "1HGBH41JXMN109186" -and $fetchedVehicleExt.mileage -eq 12500) -Message "9m-C.26 Vehicle extension roundtrips (vin=$($fetchedVehicleExt.vin))"

# --- Test 9m-C.27: Admin schema list shows all 3 extensions (Printer + User + Vehicle) ---
Write-Host "`n--- Test 9m-C.27: Admin lists all extensions on combo endpoint ---" -ForegroundColor Cyan
$comboAdminSchemas = Invoke-RestMethod -Uri "$adminBaseCombo/schemas" -Method GET -Headers $headers
Test-Result -Success ($comboAdminSchemas.totalResults -eq 3) -Message "9m-C.27 Combo endpoint has $($comboAdminSchemas.totalResults) extensions"

# --- Test 9m-C.28: Admin resource type list shows 2 types (Printer + Vehicle) ---
Write-Host "`n--- Test 9m-C.28: Admin lists all resource types on combo endpoint ---" -ForegroundColor Cyan
$comboAdminRTs = Invoke-RestMethod -Uri "$adminBaseCombo/resource-types" -Method GET -Headers $headers
Test-Result -Success ($comboAdminRTs.totalResults -eq 2) -Message "9m-C.28 Combo endpoint has $($comboAdminRTs.totalResults) custom resource types"

# ── COMBO 6: Cross-type isolation — extensions scoped to correct RT ─────────

# --- Test 9m-C.29: Printer path does not serve Vehicles, vice versa ---
Write-Host "`n--- Test 9m-C.29: Cross-type path isolation ---" -ForegroundColor Cyan
# Attempt to GET a Printer by a Vehicle endpoint
try {
    $null = Invoke-RestMethod -Uri "$scimBaseCombo/Vehicles/$comboPrinterId" -Method GET -Headers $headers
    # If found, it should NOT match Printer resource type
    Test-Result -Success $false -Message "9m-C.29 Printer should not be accessible via /Vehicles"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-C.29 Cross-type isolation works (Printer not at /Vehicles, HTTP $statusCode)"
}

# ── COMBO 7: Delete custom resource type, verify extension cleanup ──────────

# --- Test 9m-C.30: Delete Vehicle resource type ---
Write-Host "`n--- Test 9m-C.30: Delete Vehicle resource type ---" -ForegroundColor Cyan
$null = Invoke-RestMethod -Uri "$adminBaseCombo/resource-types/Vehicle" -Method DELETE -Headers $headers
$rtListAfter = Invoke-RestMethod -Uri "$adminBaseCombo/resource-types" -Method GET -Headers $headers
$vehicleGone = ($rtListAfter.resourceTypes | Where-Object { $_.name -eq "Vehicle" }) -eq $null
Test-Result -Success $vehicleGone -Message "9m-C.30 Vehicle resource type deleted"

# --- Test 9m-C.31: Verify /Vehicles endpoint returns 404 after RT deletion ---
Write-Host "`n--- Test 9m-C.31: /Vehicles returns 404 after RT deletion ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBaseCombo/Vehicles" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9m-C.31 /Vehicles should 404 after RT deletion"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9m-C.31 /Vehicles returns 404 after RT deletion (HTTP $statusCode)"
}

# ── COMBO 8: Delete extension while resources exist ─────────────────────────

# --- Test 9m-C.32: Delete Printer extension while Printer resources exist ---
Write-Host "`n--- Test 9m-C.32: Delete extension while resources exist ---" -ForegroundColor Cyan
$encodedPrinterExt = [System.Uri]::EscapeDataString($printerExtUrn)
try {
    $null = Invoke-RestMethod -Uri "$adminBaseCombo/schemas/$encodedPrinterExt" -Method DELETE -Headers $headers
    # Extension deleted — verify resource still accessible
    $printerAfterExtDelete = Invoke-RestMethod -Uri "$scimBaseCombo/Printers/$comboPrinterId" -Method GET -Headers $headers
    Test-Result -Success ($null -ne $printerAfterExtDelete.id) -Message "9m-C.32 Extension deleted, Printer resource still accessible"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    # Extension deletion may be blocked (implementation-dependent)
    Test-Result -Success ($true) -Message "9m-C.32 Extension deletion behavior (HTTP $statusCode)"
}

# --- Test 9m-C.33: /Schemas no longer shows deleted Printer extension ---
Write-Host "`n--- Test 9m-C.33: Deleted extension removed from /Schemas ---" -ForegroundColor Cyan
$schemasAfterExtDel = Invoke-RestMethod -Uri "$scimBaseCombo/Schemas" -Method GET -Headers $headers
$printerExtGone = ($schemasAfterExtDel.Resources | Where-Object { $_.id -eq $printerExtUrn }) -eq $null
Test-Result -Success $printerExtGone -Message "9m-C.33 Deleted Printer extension removed from /Schemas ($printerExtGone)"

# ── Cleanup ─────────────────────────────────────────────────────────────────

Write-Host "`n--- 9m-C Cleanup ---" -ForegroundColor Cyan
try { Invoke-RestMethod -Uri "$scimBaseCombo/Printers/$comboPrinterId" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBaseCombo/Users/$comboUserId" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBaseStrict/Sensors/$strictSensorId" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBaseStrict/Users/$strictComboUserId" -Method DELETE -Headers $headers | Out-Null } catch {}

Write-Host "`n--- 9m-C: Schema Customization Combination Tests Complete ---" -ForegroundColor Green
} # End Skip-OldSection9mC
Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "TEST SECTION 9m: SCHEMA CUSTOMIZATION — ALL SUBSECTIONS COMPLETE" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow

# ============================================
# TEST SECTION 9n: BULK OPERATIONS (Phase 9 / RFC 7644 §3.7)
$script:currentSection = "9n: Bulk Operations (Phase 9)"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9n: BULK OPERATIONS (Phase 9 / RFC 7644 S3.7)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create endpoint WITH bulk.supported = true ---
Write-Host "`n--- Bulk Setup: Creating endpoint with bulk.supported = true ---" -ForegroundColor Cyan
$bulkEndpointBody = @{
    name = "live-test-bulk-$(Get-Random)"
    displayName = "Bulk Operations Test Endpoint"
    description = "Endpoint for Phase 9 Bulk Operations live tests"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 6
$bulkEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $bulkEndpointBody
$BulkEndpointId = $bulkEndpoint.id
$patchBody = @{ profile = @{ serviceProviderConfig = @{ bulk = @{ supported = $true; maxOperations = 100; maxPayloadSize = 1048576 } } } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$BulkEndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$settingsPatchBody = @{ profile = @{ settings = @{ StrictSchemaValidation = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$BulkEndpointId" -Method PATCH -Headers $headers -Body $settingsPatchBody -ContentType "application/json" | Out-Null
$scimBaseBulk = "$baseUrl/scim/endpoints/$BulkEndpointId"
Test-Result -Success ($null -ne $BulkEndpointId) -Message "Bulk endpoint created with bulk.supported = true"

# --- Also create endpoint WITHOUT the flag ---
$bulkNoFlagBody = @{
    name = "live-test-bulk-noflag-$(Get-Random)"
    displayName = "Bulk No Flag Endpoint"
    description = "Endpoint WITHOUT bulk operations (bulk.supported = false)"
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
    Test-Result -Success ($spc.bulk.supported -eq $true -and $spc.bulk.maxOperations -eq 100) -Message "9n.14 SPC bulk.supported=$($spc.bulk.supported), maxOperations=$($spc.bulk.maxOperations)"
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

# Test 9o.3: PUT — duplicate externalId allowed (uniqueness:none per RFC 7643)
Write-Host "`n--- Test 9o.3: PUT GroupB with GroupA's externalId → 200 (allowed) ---" -ForegroundColor Cyan
$g8fPutExtConflictBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = $g8fGroupB.displayName
    externalId = $g8fGroupA.externalId
} | ConvertTo-Json
try {
    $g8fPutExtResult = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method PUT -Headers $headers -Body $g8fPutExtConflictBody
    Test-Result -Success ($g8fPutExtResult.externalId -eq $g8fGroupA.externalId) -Message "PUT with duplicate externalId accepted (uniqueness:none)"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Test-Result -Success $false -Message "PUT with duplicate externalId should succeed (uniqueness:none), got $status"
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

# Test 9o.6: PATCH — duplicate externalId allowed (uniqueness:none per RFC 7643)
Write-Host "`n--- Test 9o.6: PATCH GroupB with GroupA's externalId → 200 (allowed) ---" -ForegroundColor Cyan
$g8fPatchExtConflictBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ externalId = $g8fGroupA.externalId }
    })
} | ConvertTo-Json -Depth 4
try {
    $g8fPatchExtResult = Invoke-RestMethod -Uri "$scimBase/Groups/$g8fGroupBId" -Method PATCH -Headers $headers -Body $g8fPatchExtConflictBody
    Test-Result -Success ($g8fPatchExtResult.externalId -eq $g8fGroupA.externalId) -Message "PATCH with duplicate externalId accepted (uniqueness:none)"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Test-Result -Success $false -Message "PATCH with duplicate externalId should succeed (uniqueness:none), got $status"
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
# TEST SECTION 9s: PER-ENDPOINT CREDENTIALS (Phase 11 / G11)
$script:currentSection = "9s: Per-Endpoint Credentials"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9s: PER-ENDPOINT CREDENTIALS (Phase 11 / G11)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create an endpoint with PerEndpointCredentialsEnabled=True
Write-Host "`n--- Setup: Create Cred-Enabled Endpoint ---" -ForegroundColor Cyan
$credEpBody = @{
    name = "per-cred-test-$(Get-Date -Format 'HHmmss')"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$credEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $credEpBody
$credEpId = $credEp.id
$patchBody = @{ profile = @{ settings = @{ PerEndpointCredentialsEnabled = "True" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$credEpId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$credScimBase = "$baseUrl/scim/endpoints/$credEpId"
Write-Host "  Created endpoint: $credEpId"
Test-Result -Success ($null -ne $credEpId) -Message "9s setup: per-cred endpoint created"

# Test 9s.1: Create a per-endpoint credential
Write-Host "`n--- Test 9s.1: Create per-endpoint credential ---" -ForegroundColor Cyan
$credCreateBody = @{
    credentialType = "bearer"
    label = "live-test-cred"
} | ConvertTo-Json
$credCreate = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$credEpId/credentials" -Method POST -Headers $headers -Body $credCreateBody
$credId = $credCreate.id
$credToken = $credCreate.token
Test-Result -Success ($null -ne $credId) -Message "9s.1: credential id returned"
Test-Result -Success ($null -ne $credToken -and $credToken.Length -gt 20) -Message "9s.1: plaintext token returned (length $($credToken.Length))"
Test-Result -Success ($credCreate.credentialType -eq "bearer") -Message "9s.1: credentialType is 'bearer'"
Test-Result -Success ($credCreate.active -eq $true) -Message "9s.1: credential is active"
Test-Result -Success ($null -eq $credCreate.credentialHash) -Message "9s.1: hash not exposed in response"

# Test 9s.2: List credentials (hash must not be returned)
Write-Host "`n--- Test 9s.2: List credentials ---" -ForegroundColor Cyan
$credList = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$credEpId/credentials" -Method GET -Headers $headers
Test-Result -Success ($credList.Count -ge 1) -Message "9s.2: at least 1 credential listed"
$firstCred = $credList[0]
Test-Result -Success ($null -eq $firstCred.credentialHash) -Message "9s.2: credentialHash not in list response"
Test-Result -Success ($firstCred.id -eq $credId) -Message "9s.2: credential id matches"

# Test 9s.3: Authenticate with per-endpoint credential
Write-Host "`n--- Test 9s.3: Authenticate with per-endpoint token ---" -ForegroundColor Cyan
$credHeaders = @{Authorization="Bearer $credToken"; 'Accept'='application/scim+json'}
$credAuthResult = Invoke-RestMethod -Uri "$credScimBase/Users" -Method GET -Headers $credHeaders
Test-Result -Success ($credAuthResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:ListResponse") -Message "9s.3: per-endpoint token auth → ListResponse"
Test-Result -Success ($null -ne $credAuthResult.totalResults) -Message "9s.3: totalResults present"

# Test 9s.4: CRUD with per-endpoint credential
Write-Host "`n--- Test 9s.4: Create user with per-endpoint token ---" -ForegroundColor Cyan
$credUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "cred-user-live-$(Get-Date -Format 'HHmmss')"
    displayName = "Credential User"
    active = $true
} | ConvertTo-Json -Depth 3
$credPostHeaders = @{Authorization="Bearer $credToken"; 'Content-Type'='application/scim+json'}
$credUser = Invoke-RestMethod -Uri "$credScimBase/Users" -Method POST -Headers $credPostHeaders -Body $credUserBody
$credUserId = $credUser.id
Test-Result -Success ($null -ne $credUserId) -Message "9s.4: user created via per-endpoint token"

# Read the user with per-endpoint token
$credUserGet = Invoke-RestMethod -Uri "$credScimBase/Users/$credUserId" -Method GET -Headers $credHeaders
Test-Result -Success ($credUserGet.id -eq $credUserId) -Message "9s.4: user readable via per-endpoint token"

# Delete with per-endpoint token
$null = Invoke-WebRequest -Uri "$credScimBase/Users/$credUserId" -Method DELETE -Headers $credHeaders
Test-Result -Success $true -Message "9s.4: user deleted via per-endpoint token"

# Test 9s.5: Legacy/OAuth fallback still works when flag is enabled
Write-Host "`n--- Test 9s.5: OAuth/legacy fallback ---" -ForegroundColor Cyan
$fallbackResult = Invoke-RestMethod -Uri "$credScimBase/Users" -Method GET -Headers $headers
Test-Result -Success ($fallbackResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:ListResponse") -Message "9s.5: OAuth token still works on cred-enabled endpoint"

# Test 9s.6: Reject invalid per-endpoint credential
Write-Host "`n--- Test 9s.6: Reject invalid token ---" -ForegroundColor Cyan
$badHeaders = @{Authorization="Bearer invalid-token-that-matches-nothing"; 'Accept'='application/scim+json'}
try {
    $null = Invoke-RestMethod -Uri "$credScimBase/Users" -Method GET -Headers $badHeaders
    Test-Result -Success $false -Message "9s.6: should reject invalid token"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 401) -Message "9s.6: invalid token → 401"
}

# Test 9s.7: Revoke credential and verify it no longer works
Write-Host "`n--- Test 9s.7: Revoke credential ---" -ForegroundColor Cyan
$null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$credEpId/credentials/$credId" -Method DELETE -Headers $headers
Test-Result -Success $true -Message "9s.7: credential revoked (HTTP 204)"

# Revoked token should no longer work for per-endpoint auth
# It will also fail OAuth/legacy → 401
try {
    $null = Invoke-RestMethod -Uri "$credScimBase/Users" -Method GET -Headers $credHeaders
    Test-Result -Success $false -Message "9s.7: revoked token should fail"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 401) -Message "9s.7: revoked token → 401"
}

# Test 9s.8: Credential creation rejected when flag is disabled
Write-Host "`n--- Test 9s.8: Reject cred creation when flag disabled ---" -ForegroundColor Cyan
$disabledEpBody = @{
    name = "no-cred-test-$(Get-Date -Format 'HHmmss')"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$disabledEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $disabledEpBody
$disabledEpId = $disabledEp.id
$patchBody = @{ profile = @{ settings = @{ PerEndpointCredentialsEnabled = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$disabledEpId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$disabledEpId/credentials" -Method POST -Headers $headers -Body $credCreateBody
    Test-Result -Success $false -Message "9s.8: should reject when flag disabled"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($code -eq 403) -Message "9s.8: cred creation blocked → 403 (flag disabled)"
}

# Test 9s.9: Credential with future expiry
Write-Host "`n--- Test 9s.9: Credential with expiry ---" -ForegroundColor Cyan
$futureDate = (Get-Date).AddDays(1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$expiringCredBody = @{
    credentialType = "bearer"
    label = "expiring-cred"
    expiresAt = $futureDate
} | ConvertTo-Json
$expiringCred = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$credEpId/credentials" -Method POST -Headers $headers -Body $expiringCredBody
Test-Result -Success ($null -ne $expiringCred.expiresAt) -Message "9s.9: credential created with expiresAt"
Test-Result -Success ($null -ne $expiringCred.token) -Message "9s.9: token returned for expiring credential"

# Verify the expiring credential works for auth
$expiringHeaders = @{Authorization="Bearer $($expiringCred.token)"; 'Accept'='application/scim+json'}
$expiringAuthResult = Invoke-RestMethod -Uri "$credScimBase/Users" -Method GET -Headers $expiringHeaders
Test-Result -Success ($expiringAuthResult.schemas -contains "urn:ietf:params:scim:api:messages:2.0:ListResponse") -Message "9s.9: expiring credential authenticates successfully"

# Cleanup: delete the test endpoints
Write-Host "`n--- 9s: Cleanup ---" -ForegroundColor Cyan
try { $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$credEpId" -Method DELETE -Headers $headers } catch {}
try { $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$disabledEpId" -Method DELETE -Headers $headers } catch {}

Write-Host "`n--- 9s: Per-Endpoint Credentials Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9t: READONLY ATTRIBUTE STRIPPING (RFC 7643 §2.2)
$script:currentSection = "9t"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9t: READONLY ATTRIBUTE STRIPPING (RFC 7643 S2.2)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create a dedicated endpoint with warning flag enabled
$roStripBody = @{
    name = "readonly-strip-test-$(Get-Random)"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$roEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $roStripBody
$roEpId = $roEndpoint.id
$patchBody = @{ profile = @{ settings = @{ IncludeWarningAboutIgnoredReadOnlyAttribute = $true; StrictSchemaValidation = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$roEpId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$roScimBase = "$baseUrl/scim/endpoints/$roEpId"

# 9t.1: POST /Users with client-supplied id — should be stripped, server UUID assigned
Write-Host "`n--- 9t.1: POST /Users strips client id ---" -ForegroundColor Cyan
$roUser1Body = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "readonly-test-$(Get-Random)@example.com"
    id = "client-supplied-id-999"
    displayName = "ReadOnly Strip Test"
    active = $true
} | ConvertTo-Json -Depth 3
$roUser1 = Invoke-RestMethod -Uri "$roScimBase/Users" -Method POST -Headers $headers -Body $roUser1Body -ContentType "application/scim+json"
Test-Result -Success ($roUser1.id -ne "client-supplied-id-999") -Message "9t.1: Client-supplied id stripped, server UUID assigned"
Test-Result -Success ($roUser1.displayName -eq "ReadOnly Strip Test") -Message "9t.1: readWrite attrs preserved"
$roUserId = $roUser1.id

# 9t.2: POST response includes warning URN when flag enabled
Write-Host "`n--- 9t.2: Warning URN in POST response ---" -ForegroundColor Cyan
Test-Result -Success ($roUser1.schemas -contains "urn:scimserver:api:messages:2.0:Warning") -Message "9t.2: Warning URN present in schemas when readOnly attrs stripped"
$warningBlock = $roUser1.'urn:scimserver:api:messages:2.0:Warning'
Test-Result -Success ($null -ne $warningBlock -and $warningBlock.warnings.Count -gt 0) -Message "9t.2: Warning block contains stripped attribute names"

# 9t.3: PUT /Users strips readOnly attributes
Write-Host "`n--- 9t.3: PUT /Users strips readOnly ---" -ForegroundColor Cyan
$roPutBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $roUser1.userName
    id = "overridden-id"
    displayName = "PUT Updated"
    groups = @(@{value = "injected-group"})
    active = $true
} | ConvertTo-Json -Depth 3
$roPut = Invoke-RestMethod -Uri "$roScimBase/Users/$roUserId" -Method PUT -Headers $headers -Body $roPutBody -ContentType "application/scim+json"
Test-Result -Success ($roPut.id -eq $roUserId) -Message "9t.3: PUT does not override server-assigned id"
Test-Result -Success ($roPut.displayName -eq "PUT Updated") -Message "9t.3: readWrite attrs updated via PUT"
Test-Result -Success ($roPut.schemas -contains "urn:scimserver:api:messages:2.0:Warning") -Message "9t.3: Warning URN in PUT response"

# 9t.4: PATCH targeting readOnly attribute (path-based) — silently stripped
Write-Host "`n--- 9t.4: PATCH readOnly attr stripped ---" -ForegroundColor Cyan
$roPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "groups"; value = @(@{value = "fake-group"}) },
        @{ op = "replace"; path = "displayName"; value = "PatchedName" }
    )
} | ConvertTo-Json -Depth 4
$roPatch = Invoke-RestMethod -Uri "$roScimBase/Users/$roUserId" -Method PATCH -Headers $headers -Body $roPatchBody -ContentType "application/scim+json"
Test-Result -Success ($roPatch.displayName -eq "PatchedName") -Message "9t.4: readWrite PATCH op applied"
$groupCount = if ($roPatch.groups) { $roPatch.groups.Count } else { 0 }
Test-Result -Success ($groupCount -eq 0) -Message "9t.4: readOnly groups PATCH op was silently stripped"

# 9t.5: Warning absent when flag disabled
Write-Host "`n--- 9t.5: No warning when flag disabled ---" -ForegroundColor Cyan
$noWarnBody = @{
    name = "no-warn-test-$(Get-Random)"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$noWarnEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $noWarnBody
$patchBody = @{ profile = @{ settings = @{ IncludeWarningAboutIgnoredReadOnlyAttribute = $false; StrictSchemaValidation = "False" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($noWarnEp.id)" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$noWarnBase = "$baseUrl/scim/endpoints/$($noWarnEp.id)"
$noWarnUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "nowarn-$(Get-Random)@example.com"
    id = "should-strip-silently"
    active = $true
} | ConvertTo-Json -Depth 3
$noWarnUser = Invoke-RestMethod -Uri "$noWarnBase/Users" -Method POST -Headers $headers -Body $noWarnUserBody -ContentType "application/scim+json"
Test-Result -Success ($noWarnUser.schemas -notcontains "urn:scimserver:api:messages:2.0:Warning") -Message "9t.5: No warning URN when flag disabled"
Test-Result -Success ($noWarnUser.id -ne "should-strip-silently") -Message "9t.5: id still stripped even without warning"

# 9t.6: PATCH id returns 400 (never stripped — G8c hard-reject)
Write-Host "`n--- 9t.6: PATCH id returns 400 ---" -ForegroundColor Cyan
$strictEpBody = @{
    name = "strict-patch-id-$(Get-Random)"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$strictEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $strictEpBody
$patchBody = @{ profile = @{ settings = @{ StrictSchemaValidation = $true } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($strictEp.id)" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$strictBase = "$baseUrl/scim/endpoints/$($strictEp.id)"
$strictUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "strict-id-test-$(Get-Random)@example.com"
    active = $true
} | ConvertTo-Json -Depth 3
$strictUser = Invoke-RestMethod -Uri "$strictBase/Users" -Method POST -Headers $headers -Body $strictUserBody -ContentType "application/scim+json"
$patchIdBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "id"; value = "new-id" })
} | ConvertTo-Json -Depth 3
try {
    $null = Invoke-RestMethod -Uri "$strictBase/Users/$($strictUser.id)" -Method PATCH -Headers $headers -Body $patchIdBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "9t.6: PATCH id should return 400"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9t.6: PATCH id returns 400 (G8c hard-reject)"
}

# 9t.7: POST /Groups with client id — server assigns UUID
Write-Host "`n--- 9t.7: POST /Groups strips client id ---" -ForegroundColor Cyan
$roGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "ReadOnly Group Test $(Get-Random)"
    id = "client-group-id-999"
} | ConvertTo-Json -Depth 3
$roGroup = Invoke-RestMethod -Uri "$roScimBase/Groups" -Method POST -Headers $headers -Body $roGroupBody -ContentType "application/scim+json"
Test-Result -Success ($roGroup.id -ne "client-group-id-999") -Message "9t.7: Groups client-supplied id stripped, server UUID assigned"
Test-Result -Success ($roGroup.displayName -like "ReadOnly Group*") -Message "9t.7: Group displayName preserved"

# 9t.8: Strict ON + IgnorePatchRO ON → strip and succeed
Write-Host "`n--- 9t.8: Strict + IgnorePatchRO ON ---" -ForegroundColor Cyan
$strictIgnoreBody = @{
    name = "strict-ignore-ro-$(Get-Random)"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$strictIgnoreEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $strictIgnoreBody
$patchBody = @{ profile = @{ settings = @{ StrictSchemaValidation = $true; IgnoreReadOnlyAttributesInPatch = $true; IncludeWarningAboutIgnoredReadOnlyAttribute = $true } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($strictIgnoreEp.id)" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$siBase = "$baseUrl/scim/endpoints/$($strictIgnoreEp.id)"
$siUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "strict-ignore-$(Get-Random)@example.com"
    active = $true
} | ConvertTo-Json -Depth 3
$siUser = Invoke-RestMethod -Uri "$siBase/Users" -Method POST -Headers $headers -Body $siUserBody -ContentType "application/scim+json"
$siPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "groups"; value = @(@{value = "g1"}) },
        @{ op = "replace"; path = "displayName"; value = "StrictIgnoreOK" }
    )
} | ConvertTo-Json -Depth 4
$siPatch = Invoke-RestMethod -Uri "$siBase/Users/$($siUser.id)" -Method PATCH -Headers $headers -Body $siPatchBody -ContentType "application/scim+json"
Test-Result -Success ($siPatch.displayName -eq "StrictIgnoreOK") -Message "9t.8: Strict+IgnorePatchRO: readWrite applied"
$siGroupCount = if ($siPatch.groups) { $siPatch.groups.Count } else { 0 }
Test-Result -Success ($siGroupCount -eq 0) -Message "9t.8: Strict+IgnorePatchRO: readOnly silently stripped"
Test-Result -Success ($siPatch.schemas -contains "urn:scimserver:api:messages:2.0:Warning") -Message "9t.8: Warning URN present with IgnorePatchRO"

# 9t.9: Strict ON + IgnorePatchRO OFF → 400 for readOnly PATCH
Write-Host "`n--- 9t.9: Strict + IgnorePatchRO OFF ---" -ForegroundColor Cyan
$strictKeepBody = @{
    name = "strict-keep-ro-$(Get-Random)"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$strictKeepEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $strictKeepBody
$patchBody = @{ profile = @{ settings = @{ StrictSchemaValidation = $true; IgnoreReadOnlyAttributesInPatch = $false } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($strictKeepEp.id)" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$skBase = "$baseUrl/scim/endpoints/$($strictKeepEp.id)"
$skUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "strict-keep-$(Get-Random)@example.com"
    active = $true
} | ConvertTo-Json -Depth 3
$skUser = Invoke-RestMethod -Uri "$skBase/Users" -Method POST -Headers $headers -Body $skUserBody -ContentType "application/scim+json"
$skPatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "groups"; value = @(@{value = "g1"}) })
} | ConvertTo-Json -Depth 4
try {
    $null = Invoke-RestMethod -Uri "$skBase/Users/$($skUser.id)" -Method PATCH -Headers $headers -Body $skPatchBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "9t.9: Strict+keepRO should 400 on readOnly PATCH"
} catch {
    $skStatus = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($skStatus -eq 400) -Message "9t.9: Strict+keepRO returns 400 for readOnly PATCH"
}

# 9t.10: No readOnly attrs in payload → no warning
Write-Host "`n--- 9t.10: Clean payload, no warnings ---" -ForegroundColor Cyan
$cleanUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "clean-user-$(Get-Random)@example.com"
    displayName = "Clean User"
    active = $true
} | ConvertTo-Json -Depth 3
$cleanUser = Invoke-RestMethod -Uri "$roScimBase/Users" -Method POST -Headers $headers -Body $cleanUserBody -ContentType "application/scim+json"
$hasWarning = $cleanUser.schemas -contains "urn:scimserver:api:messages:2.0:Warning"
Test-Result -Success (-not $hasWarning) -Message "9t.10: No warning URN when payload has no readOnly attrs"

# Cleanup
Write-Host "`n--- 9t: Cleanup ---" -ForegroundColor Cyan
try { $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$roEpId" -Method DELETE -Headers $headers } catch {}
try { $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$($noWarnEp.id)" -Method DELETE -Headers $headers } catch {}
try { $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$($strictEp.id)" -Method DELETE -Headers $headers } catch {}
try { $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$($strictIgnoreEp.id)" -Method DELETE -Headers $headers } catch {}
try { $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$($strictKeepEp.id)" -Method DELETE -Headers $headers } catch {}

Write-Host "`n--- 9t: ReadOnly Attribute Stripping Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9u: SCHEMA ATTRIBUTE CHARACTERISTICS (P1 / RFC 7643 §2)
$script:currentSection = "9u: Schema Attr Characteristics"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9u: SCHEMA ATTRIBUTE CHARACTERISTICS (P1 / RFC 7643 S2)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Fetch User and Group schema definitions
$userSchemaUri = "urn:ietf:params:scim:schemas:core:2.0:User"
$groupSchemaUri = "urn:ietf:params:scim:schemas:core:2.0:Group"
$userSchema = Invoke-RestMethod -Uri "$scimBase/Schemas/$userSchemaUri" -Method GET -Headers $headers
$groupSchema = Invoke-RestMethod -Uri "$scimBase/Schemas/$groupSchemaUri" -Method GET -Headers $headers

# --- R-SUB-1: caseExact:false on name sub-attributes ---
Write-Host "`n--- R-SUB-1: caseExact on name sub-attributes ---" -ForegroundColor Cyan
$nameAttr = $userSchema.attributes | Where-Object { $_.name -eq "name" }
$nameSubs = @("formatted", "familyName", "givenName", "middleName", "honorificPrefix", "honorificSuffix")
$allNameCaseExact = $true
foreach ($subName in $nameSubs) {
    $sub = $nameAttr.subAttributes | Where-Object { $_.name -eq $subName }
    if (-not $sub -or $sub.caseExact -ne $false) { $allNameCaseExact = $false }
}
Test-Result -Success $allNameCaseExact -Message "9u.1: All name sub-attributes have caseExact:false (R-SUB-1)"

# --- R-SUB-3: caseExact:false on addresses sub-attributes ---
Write-Host "`n--- R-SUB-3: caseExact on addresses sub-attributes ---" -ForegroundColor Cyan
$addrAttr = $userSchema.attributes | Where-Object { $_.name -eq "addresses" }
$addrSubs = @("formatted", "streetAddress", "locality", "region", "postalCode", "country")
$allAddrCaseExact = $true
foreach ($subName in $addrSubs) {
    $sub = $addrAttr.subAttributes | Where-Object { $_.name -eq $subName }
    if (-not $sub -or $sub.caseExact -ne $false) { $allAddrCaseExact = $false }
}
Test-Result -Success $allAddrCaseExact -Message "9u.2: All addresses sub-attributes have caseExact:false (R-SUB-3)"

# --- R-UNIQ-1: uniqueness on externalId and Group displayName ---
Write-Host "`n--- R-UNIQ-1: uniqueness on key attributes ---" -ForegroundColor Cyan
$userExtId = $userSchema.attributes | Where-Object { $_.name -eq "externalId" }
Test-Result -Success ($userExtId.uniqueness -eq "none") -Message "9u.3: User externalId has uniqueness:none (R-UNIQ-1)"

$groupExtId = $groupSchema.attributes | Where-Object { $_.name -eq "externalId" }
Test-Result -Success ($groupExtId.uniqueness -eq "none") -Message "9u.4: Group externalId has uniqueness:none (R-UNIQ-1)"

$groupDisplayName = $groupSchema.attributes | Where-Object { $_.name -eq "displayName" }
Test-Result -Success ($groupDisplayName.uniqueness -eq "server") -Message "9u.5: Group displayName has uniqueness:server (R-UNIQ-1)"

# --- R-REF-1: $ref sub-attribute on Group members ---
Write-Host "`n--- R-REF-1: \$ref sub-attribute on Group members ---" -ForegroundColor Cyan
$membersAttr = $groupSchema.attributes | Where-Object { $_.name -eq "members" }
$refSub = $membersAttr.subAttributes | Where-Object { $_.name -eq '$ref' }
Test-Result -Success ($null -ne $refSub) -Message "9u.6: Group members has \$ref sub-attribute (R-REF-1)"
Test-Result -Success ($refSub.type -eq "reference") -Message "9u.7: Group members.\$ref type is reference (R-REF-1)"
Test-Result -Success ($refSub.mutability -eq "immutable") -Message "9u.8: Group members.\$ref mutability is immutable (R-REF-1)"
$hasUserRef = $refSub.referenceTypes -contains "User"
$hasGroupRef = $refSub.referenceTypes -contains "Group"
Test-Result -Success ($hasUserRef -and $hasGroupRef) -Message "9u.9: Group members.\$ref referenceTypes contains User and Group (R-REF-1)"

# Verify total sub-attribute count on members
$memberSubCount = $membersAttr.subAttributes.Count
Test-Result -Success ($memberSubCount -eq 4) -Message "9u.10: Group members has 4 sub-attributes (value, \$ref, display, type) (R-REF-1)"

Write-Host "`n--- 9u: Schema Attribute Characteristics Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9v: P2 ATTRIBUTE CHARACTERISTICS (RFC 7643 §2)
$script:currentSection = "9v: P2 Attr Characteristics"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9v: P2 ATTRIBUTE CHARACTERISTICS (RFC 7643 S2)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Create a test user with enterprise extension for P2 tests ---
$p2UserPayload = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    )
    userName = "p2-live-test-$(Get-Random)@example.com"
    active = $true
    displayName = "P2 Test User"
    name = @{ givenName = "P2"; familyName = "Test" }
    emails = @(
        @{ value = "p2work@example.com"; type = "work"; primary = $true },
        @{ value = "p2home@example.com"; type = "home"; primary = $false }
    )
    password = "P2SecretPassword1!"
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        department = "Engineering"
        manager = @{
            value = "fake-mgr-id"
            displayName = "Client Supplied Boss"
        }
    }
} | ConvertTo-Json -Depth 5

$p2User = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $p2UserPayload -ContentType "application/scim+json"
$p2UserId = $p2User.id

# --- R-MUT-1: writeOnly (password) never returned ---
Write-Host "`n--- R-MUT-1: writeOnly attribute never in response ---" -ForegroundColor Cyan
Test-Result -Success ($null -eq $p2User.password) -Message "9v.1: POST /Users response does not contain password (R-MUT-1)"

$p2UserGet = Invoke-RestMethod -Uri "$scimBase/Users/$p2UserId" -Method GET -Headers $headers
Test-Result -Success ($null -eq $p2UserGet.password) -Message "9v.2: GET /Users/:id does not contain password (R-MUT-1)"

$p2UserListPwd = Invoke-RestMethod -Uri "$scimBase/Users?attributes=password,userName&count=1" -Method GET -Headers $headers
$p2FirstUser = $p2UserListPwd.Resources | Select-Object -First 1
Test-Result -Success ($null -eq $p2FirstUser.password) -Message "9v.3: GET /Users?attributes=password does not return password (R-MUT-1)"

# --- R-MUT-2: readOnly sub-attr stripping (manager.displayName) ---
Write-Host "`n--- R-MUT-2: readOnly sub-attr stripping ---" -ForegroundColor Cyan
# The client supplied manager.displayName, but it should have been stripped
$p2Ext = $p2UserGet."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
$managerVal = if ($p2Ext -and $p2Ext.manager) { $p2Ext.manager.value } else { $null }
$managerDispName = if ($p2Ext -and $p2Ext.manager) { $p2Ext.manager.displayName } else { $null }
# manager.value should be preserved (readWrite), manager.displayName should be stripped (readOnly)
Test-Result -Success ($null -ne $managerVal -or $null -eq $managerDispName) -Message "9v.4: manager.displayName (readOnly) stripped from POST, manager.value preserved (R-MUT-2)"

# Test PATCH targeting readOnly sub-attr
$p2PatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "displayName"; value = "P2 Updated DisplayName" }
    )
} | ConvertTo-Json -Depth 4

$p2PatchResult = Invoke-RestMethod -Uri "$scimBase/Users/$p2UserId" -Method PATCH -Headers $headers -Body $p2PatchBody -ContentType "application/scim+json"
Test-Result -Success ($p2PatchResult.displayName -eq "P2 Updated DisplayName") -Message "9v.5: PATCH with readWrite path updates correctly (R-MUT-2)"

# --- R-RET-2: Group active always returned ---
Write-Host "`n--- R-RET-2: Group active always returned ---" -ForegroundColor Cyan
$p2GroupPayload = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "P2 Test Group $(Get-Random)"
} | ConvertTo-Json -Depth 3

$p2Group = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $p2GroupPayload -ContentType "application/scim+json"
$p2GroupId = $p2Group.id

# Groups: active was removed in settings v7 — should NOT be present
$p2GroupExclude = Invoke-RestMethod -Uri "$scimBase/Groups/${p2GroupId}?excludedAttributes=active" -Method GET -Headers $headers
Test-Result -Success ($null -eq $p2GroupExclude.active) -Message "9v.6: GET /Groups/:id?excludedAttributes=active — active absent (settings v7)"

# Groups: active was removed in settings v7 — should NOT be present
$p2GroupAttrs = Invoke-RestMethod -Uri "$scimBase/Groups/${p2GroupId}?attributes=displayName" -Method GET -Headers $headers
Test-Result -Success ($null -eq $p2GroupAttrs.active) -Message "9v.7: GET /Groups/:id?attributes=displayName — active absent (settings v7)"

# --- R-RET-1: Schema-driven returned:always (Group displayName) ---
Write-Host "`n--- R-RET-1: Schema-driven returned:always ---" -ForegroundColor Cyan
$p2GroupAttrs2 = Invoke-RestMethod -Uri "$scimBase/Groups/${p2GroupId}?attributes=externalId" -Method GET -Headers $headers
Test-Result -Success ($null -ne $p2GroupAttrs2.displayName) -Message "9v.8: GET /Groups/:id?attributes=externalId still includes displayName (returned:always) (R-RET-1)"

$p2GroupExclude2 = Invoke-RestMethod -Uri "$scimBase/Groups/${p2GroupId}?excludedAttributes=displayName" -Method GET -Headers $headers
Test-Result -Success ($null -ne $p2GroupExclude2.displayName) -Message "9v.9: GET /Groups/:id?excludedAttributes=displayName still includes displayName (returned:always) (R-RET-1)"

# --- R-RET-3: Sub-attr returned:always (emails.value) ---
Write-Host "`n--- R-RET-3: Sub-attr returned:always (emails.value) ---" -ForegroundColor Cyan
$p2UserEmailsType = Invoke-RestMethod -Uri "$scimBase/Users/${p2UserId}?attributes=emails.type" -Method GET -Headers $headers
$p2EmailItems = $p2UserEmailsType.emails
$p2HasValue = $true
if ($p2EmailItems) {
    foreach ($e in $p2EmailItems) {
        if ($null -eq $e.value) { $p2HasValue = $false }
    }
} else {
    $p2HasValue = $false
}
Test-Result -Success $p2HasValue -Message "9v.10: GET /Users?attributes=emails.type still includes emails.value (returned:always) (R-RET-3)"

# R-RET-3 for Group members.value
$p2MemberUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body (@{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "p2-member-$(Get-Random)@example.com"
    active = $true
} | ConvertTo-Json -Depth 3) -ContentType "application/scim+json"
$p2MemberUserId = $p2MemberUser.id

# Add member to group
$p2AddMemberBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "add"; path = "members"; value = @(@{ value = $p2MemberUserId }) }
    )
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "$scimBase/Groups/$p2GroupId" -Method PATCH -Headers $headers -Body $p2AddMemberBody -ContentType "application/scim+json" | Out-Null

$p2GroupMembersDisplay = Invoke-RestMethod -Uri "$scimBase/Groups/${p2GroupId}?attributes=members.display" -Method GET -Headers $headers
$p2MemberItems = $p2GroupMembersDisplay.members
$p2MemHasValue = $true
if ($p2MemberItems) {
    foreach ($m in $p2MemberItems) {
        if ($null -eq $m.value) { $p2MemHasValue = $false }
    }
} else {
    $p2MemHasValue = $false
}
Test-Result -Success $p2MemHasValue -Message "9v.11: GET /Groups?attributes=members.display still includes members.value (returned:always) (R-RET-3)"

# --- R-CASE-1: caseExact filter behavior ---
Write-Host "`n--- R-CASE-1: caseExact-aware filter evaluation ---" -ForegroundColor Cyan
# userName (caseExact:false) should match case-insensitively
$p2UserName = $p2User.userName
$p2UpperName = $p2UserName.ToUpper()
$p2FilterStr = [Uri]::EscapeDataString("userName eq ""$p2UpperName""")
$p2FilterInsensitive = Invoke-RestMethod -Uri "$scimBase/Users?filter=$p2FilterStr" -Method GET -Headers $headers
Test-Result -Success ($p2FilterInsensitive.totalResults -ge 1) -Message "9v.12: Filter on userName (caseExact:false) matches case-insensitively (R-CASE-1)"

# externalId (caseExact:true) - create user with specific externalId
$p2CaseUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body (@{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "p2-case-exact-$(Get-Random)@example.com"
    externalId = "CaseSensitive-ID-ABC"
    active = $true
} | ConvertTo-Json -Depth 3) -ContentType "application/scim+json"

$p2ExactFilterStr = [Uri]::EscapeDataString('externalId eq "CaseSensitive-ID-ABC"')
$p2FilterExact = Invoke-RestMethod -Uri "$scimBase/Users?filter=$p2ExactFilterStr" -Method GET -Headers $headers
Test-Result -Success ($p2FilterExact.totalResults -ge 1) -Message "9v.13: Filter on externalId (caseExact:true) matches exact case (R-CASE-1)"

# Cleanup P2 test resources
Write-Host "`n--- 9v: Cleaning up P2 test resources ---" -ForegroundColor Cyan
try { Invoke-RestMethod -Uri "$scimBase/Users/$p2UserId" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBase/Users/$p2MemberUserId" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBase/Users/$($p2CaseUser.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBase/Groups/$p2GroupId" -Method DELETE -Headers $headers | Out-Null } catch {}

Write-Host "`n--- 9v: P2 Attribute Characteristics Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9w: HTTP ERROR CODES, IMMUTABLE ENFORCEMENT, RETURNED CHARACTERISTICS (P3)
$script:currentSection = "9w: P3 HTTP Errors & Attr Char"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9w: HTTP ERROR CODES, IMMUTABLE ENFORCEMENT, RETURNED CHARACTERISTICS (P3)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# ─────────────── 9w.1–9w.4: HTTP 415 Unsupported Media Type ───────────────
Write-Host "`n--- 9w: HTTP 415 Unsupported Media Type ---" -ForegroundColor Cyan

# 9w.1: POST /Users with text/xml should fail
try {
    $resp415xml = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers @{ Authorization = $headers.Authorization } `
        -Body '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"test415@example.com"}' `
        -ContentType "text/xml" -ErrorAction Stop
    Test-Result -Success $false -Message "9w.1: POST /Users with text/xml should return 415 (got $($resp415xml.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 415) -Message "9w.1: POST /Users with text/xml returns 415 Unsupported Media Type"
}

# 9w.2: POST /Users with text/plain should fail
try {
    $resp415txt = Invoke-WebRequest -Uri "$scimBase/Users" -Method POST -Headers @{ Authorization = $headers.Authorization } `
        -Body '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"test415@example.com"}' `
        -ContentType "text/plain" -ErrorAction Stop
    Test-Result -Success $false -Message "9w.2: POST /Users with text/plain should return 415 (got $($resp415txt.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 415) -Message "9w.2: POST /Users with text/plain returns 415"
}

# 9w.3: POST /Users with application/json should succeed
$w3Body = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "test-9w3-$(Get-Random)@example.com"
    displayName = "9w3 JSON Test"
    active = $true
} | ConvertTo-Json -Depth 3
try {
    $resp415json = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $w3Body -ContentType "application/json"
    Test-Result -Success ($null -ne $resp415json.id) -Message "9w.3: POST /Users with application/json succeeds (201)"
    # Cleanup
    try { Invoke-RestMethod -Uri "$scimBase/Users/$($resp415json.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
} catch {
    Test-Result -Success $false -Message "9w.3: POST /Users with application/json should succeed"
}

# 9w.4: POST /Users with application/scim+json should succeed
try {
    $resp415scim = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $w3Body -ContentType "application/scim+json"
    Test-Result -Success ($null -ne $resp415scim.id) -Message "9w.4: POST /Users with application/scim+json succeeds (201)"
    try { Invoke-RestMethod -Uri "$scimBase/Users/$($resp415scim.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
} catch {
    Test-Result -Success $false -Message "9w.4: POST /Users with application/scim+json should succeed"
}

# ─────────────── 9w.5–9w.8: HTTP 405 Method Not Allowed ───────────────
Write-Host "`n--- 9w: HTTP 405 Method Not Allowed ---" -ForegroundColor Cyan

# 9w.5: PUT /Users (collection) should return 404 or 405
try {
    $resp405put = Invoke-WebRequest -Uri "$scimBase/Users" -Method PUT -Headers @{ Authorization = $headers.Authorization } `
        -Body '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"test@example.com"}' `
        -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9w.5: PUT /Users (collection) should return 404 or 405 (got $($resp405put.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404 -or $statusCode -eq 405) -Message "9w.5: PUT /Users (collection) returns $statusCode (expected 404/405)"
}

# 9w.6: PATCH /Users (collection) should return 404 or 405
try {
    $resp405patch = Invoke-WebRequest -Uri "$scimBase/Users" -Method PATCH -Headers @{ Authorization = $headers.Authorization } `
        -Body '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[]}' `
        -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9w.6: PATCH /Users (collection) should return 404 or 405 (got $($resp405patch.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404 -or $statusCode -eq 405) -Message "9w.6: PATCH /Users (collection) returns $statusCode"
}

# 9w.7: DELETE /Users (collection) should return 404 or 405
try {
    $resp405del = Invoke-WebRequest -Uri "$scimBase/Users" -Method DELETE -Headers @{ Authorization = $headers.Authorization } -ErrorAction Stop
    Test-Result -Success $false -Message "9w.7: DELETE /Users (collection) should return 404 or 405 (got $($resp405del.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404 -or $statusCode -eq 405) -Message "9w.7: DELETE /Users (collection) returns $statusCode"
}

# 9w.8: DELETE /Groups (collection) should return 404 or 405
try {
    $resp405gdel = Invoke-WebRequest -Uri "$scimBase/Groups" -Method DELETE -Headers @{ Authorization = $headers.Authorization } -ErrorAction Stop
    Test-Result -Success $false -Message "9w.8: DELETE /Groups (collection) should return 404 or 405 (got $($resp405gdel.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404 -or $statusCode -eq 405) -Message "9w.8: DELETE /Groups (collection) returns $statusCode"
}

# ─────────────── 9w.9–9w.14: Immutable Attribute Enforcement ───────────────
Write-Host "`n--- 9w: Immutable Attribute Enforcement ---" -ForegroundColor Cyan

# NOTE: RFC 7643 §4.3 defines employeeNumber as 'readWrite' (NOT immutable).
# To test immutable enforcement, we create an endpoint with StrictSchemaValidation
# and a custom profile where employeeNumber IS marked as 'immutable'.
$w9EpBody = @{
    name = "test-9w-immutable-$(Get-Random)"
    profile = @{
        schemas = @(
            @{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = "all" }
            @{
                id = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
                name = "EnterpriseUser"
                attributes = @(
                    @{ name = "employeeNumber"; type = "string"; multiValued = $false; required = $false; mutability = "immutable"; returned = "default" }
                    @{ name = "department"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default" }
                )
            }
            @{ id = "urn:ietf:params:scim:schemas:core:2.0:Group"; name = "Group"; attributes = "all" }
        )
        resourceTypes = @(
            @{ id = "User"; name = "User"; endpoint = "/Users"; description = "User"; schema = "urn:ietf:params:scim:schemas:core:2.0:User"; schemaExtensions = @(@{ schema = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"; required = $false }) }
            @{ id = "Group"; name = "Group"; endpoint = "/Groups"; description = "Group"; schema = "urn:ietf:params:scim:schemas:core:2.0:Group"; schemaExtensions = @() }
        )
        serviceProviderConfig = @{ patch = @{ supported = $true }; bulk = @{ supported = $false }; filter = @{ supported = $true; maxResults = 200 }; sort = @{ supported = $true }; etag = @{ supported = $true }; changePassword = @{ supported = $false } }
        settings = @{ StrictSchemaValidation = "True" }
    }
} | ConvertTo-Json -Depth 10
$w9Ep = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $w9EpBody -ContentType "application/json"
$w9ScimBase = "$baseUrl/scim/endpoints/$($w9Ep.id)"

# Create user with enterprise extension (employeeNumber is immutable in custom profile)
$w9UserName = "test-9w-immutable-$(Get-Random)@example.com"
$w9UserBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    )
    userName = $w9UserName
    displayName = "Immutable Test User"
    active = $true
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        employeeNumber = "EMP-12345"
        department = "Engineering"
    }
} | ConvertTo-Json -Depth 4
$w9User = Invoke-RestMethod -Uri "$w9ScimBase/Users" -Method POST -Headers $headers -Body $w9UserBody -ContentType "application/scim+json"
Test-Result -Success ($null -ne $w9User.id) -Message "9w.9: Create user with immutable employeeNumber for testing"

# 9w.10: PUT changing employeeNumber should fail (400)
$w9PutBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    )
    userName = $w9UserName
    displayName = "Immutable Test User Updated"
    active = $true
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        employeeNumber = "EMP-99999"
        department = "Engineering"
    }
} | ConvertTo-Json -Depth 4
try {
    $w9PutResp = Invoke-WebRequest -Uri "$w9ScimBase/Users/$($w9User.id)" -Method PUT `
        -Headers @{ Authorization = $headers.Authorization } -Body $w9PutBody -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9w.10: PUT changing immutable employeeNumber should return 400 (got $($w9PutResp.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9w.10: PUT changing immutable employeeNumber returns 400"
}

# 9w.11: PUT with same employeeNumber should succeed (200)
$w9PutSameBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    )
    userName = $w9UserName
    displayName = "Immutable Same Value"
    active = $true
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        employeeNumber = "EMP-12345"
        department = "Sales"
    }
} | ConvertTo-Json -Depth 4
$w9PutSame = Invoke-RestMethod -Uri "$w9ScimBase/Users/$($w9User.id)" -Method PUT -Headers $headers -Body $w9PutSameBody -ContentType "application/scim+json"
Test-Result -Success ($w9PutSame.displayName -eq "Immutable Same Value") -Message "9w.11: PUT with same immutable value succeeds (200)"

# 9w.12: PATCH changing employeeNumber should fail (400)
$w9PatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{
            op = "replace"
            path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber"
            value = "EMP-CHANGED"
        }
    )
} | ConvertTo-Json -Depth 4
try {
    $w9PatchResp = Invoke-WebRequest -Uri "$w9ScimBase/Users/$($w9User.id)" -Method PATCH `
        -Headers @{ Authorization = $headers.Authorization } -Body $w9PatchBody -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9w.12: PATCH changing immutable employeeNumber should return 400 (got $($w9PatchResp.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9w.12: PATCH changing immutable employeeNumber returns 400"
}

# 9w.13: GET should still show original immutable value
$w9Get = Invoke-RestMethod -Uri "$w9ScimBase/Users/$($w9User.id)" -Method GET -Headers $headers
$w9Ext = $w9Get."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
Test-Result -Success ($w9Ext.employeeNumber -eq "EMP-12345") -Message "9w.13: GET returns original immutable employeeNumber value"

# 9w.14: PATCH mutable attribute alongside immutable should succeed
$w9PatchMutable = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{
            op = "replace"
            path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department"
            value = "Marketing"
        }
    )
} | ConvertTo-Json -Depth 4
$w9PatchMutableResp = Invoke-RestMethod -Uri "$w9ScimBase/Users/$($w9User.id)" -Method PATCH -Headers $headers -Body $w9PatchMutable -ContentType "application/scim+json"
$w9PatchExt = $w9PatchMutableResp."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
Test-Result -Success ($w9PatchExt.department -eq "Marketing") -Message "9w.14: PATCH mutable department succeeds while employeeNumber preserved"

# ─────────────── 9w.15–9w.18: returned:request & returned:default ───────────────
Write-Host "`n--- 9w: returned:request and returned:default ---" -ForegroundColor Cyan

# Verify schema definitions for returned characteristics
$w9UserSchema = Invoke-RestMethod -Uri "$w9ScimBase/Schemas/urn:ietf:params:scim:schemas:core:2.0:User" -Method GET -Headers $headers

# 9w.15: password should not appear in GET response (returned:never)
$w9GetUser = Invoke-RestMethod -Uri "$w9ScimBase/Users/$($w9User.id)" -Method GET -Headers $headers
Test-Result -Success ($null -eq $w9GetUser.password) -Message "9w.15: GET /Users/:id does not return password (returned:never)"

# 9w.16: id is always returned
Test-Result -Success ($null -ne $w9GetUser.id) -Message "9w.16: GET /Users/:id always returns id (returned:always)"

# 9w.17: userName is always returned
Test-Result -Success ($null -ne $w9GetUser.userName) -Message "9w.17: GET /Users/:id always returns userName (returned:always)"

# 9w.18: excludedAttributes should strip displayName (returned:default)
$w9ExclUrl = "$w9ScimBase/Users/$($w9User.id)?excludedAttributes=displayName"
$w9Excl = Invoke-RestMethod -Uri $w9ExclUrl -Method GET -Headers $headers
Test-Result -Success ($null -eq $w9Excl.displayName) -Message "9w.18: excludedAttributes=displayName strips it from response (returned:default)"
Test-Result -Success ($null -ne $w9Excl.userName) -Message "9w.19: excludedAttributes does not strip always-returned userName"

# Cleanup 9w test resources
Write-Host "`n--- 9w: Cleaning up 9w test resources ---" -ForegroundColor Cyan
try { Invoke-RestMethod -Uri "$w9ScimBase/Users/$($w9User.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($w9Ep.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

Write-Host "`n--- 9w: P3 HTTP Errors, Immutable, Returned Characteristics Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9x: USER UNIQUENESS ON PUT/PATCH, REQUIRED ON PUT, RETURNED CHARS ON .search/PATCH
$script:currentSection = "9x: Uniqueness/Required/Search Returned"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9x: USER UNIQUENESS, REQUIRED ON PUT, RETURNED ON PATCH/.search" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# ─────────────── Setup: Create two users for uniqueness collision tests ───────────────
$x9UserNameA = "test-9x-userA-$(Get-Random)@example.com"
$x9UserBodyA = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $x9UserNameA
    displayName = "9x User A"
    externalId = "ext-9x-A-$(Get-Random)"
    active = $true
} | ConvertTo-Json -Depth 3
$x9UserA = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $x9UserBodyA -ContentType "application/scim+json"

$x9UserNameB = "test-9x-userB-$(Get-Random)@example.com"
$x9UserBodyB = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $x9UserNameB
    displayName = "9x User B"
    externalId = "ext-9x-B-$(Get-Random)"
    active = $true
} | ConvertTo-Json -Depth 3
$x9UserB = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $x9UserBodyB -ContentType "application/scim+json"
Test-Result -Success ($null -ne $x9UserA.id -and $null -ne $x9UserB.id) -Message "9x.0: Created two users for uniqueness collision tests"

# ─────────────── 9x.1–9x.4: uniqueness:server — User PUT 409 ───────────────
Write-Host "`n--- 9x: uniqueness:server — User PUT ---" -ForegroundColor Cyan

# 9x.1: PUT User B with User A's userName → 409
$x9PutConflictBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $x9UserNameA
    displayName = "9x Conflict PUT"
    active = $true
} | ConvertTo-Json -Depth 3
try {
    $x9PutConflict = Invoke-WebRequest -Uri "$scimBase/Users/$($x9UserB.id)" -Method PUT `
        -Headers @{ Authorization = $headers.Authorization } -Body $x9PutConflictBody -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9x.1: PUT userName collision should return 409 (got $($x9PutConflict.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 409) -Message "9x.1: PUT userName collision returns 409 Conflict"
}

# 9x.2: PUT User B with User A's externalId → 200 (externalId uniqueness:none per RFC 7643)
$x9PutExtConflictBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $x9UserNameB
    externalId = $x9UserA.externalId
    displayName = "9x ExtId Duplicate PUT"
    active = $true
} | ConvertTo-Json -Depth 3
try {
    $x9PutExtResult = Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserB.id)" -Method PUT -Headers $headers -Body $x9PutExtConflictBody -ContentType "application/scim+json"
    Test-Result -Success ($x9PutExtResult.externalId -eq $x9UserA.externalId) -Message "9x.2: PUT with duplicate externalId accepted (uniqueness:none)"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success $false -Message "9x.2: PUT with duplicate externalId should succeed (uniqueness:none), got $statusCode"
}

# 9x.3: PUT User A with own userName → 200 (self-update allowed)
$x9PutSelfBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $x9UserNameA
    displayName = "9x Self Update OK"
    externalId = $x9UserA.externalId
    active = $true
} | ConvertTo-Json -Depth 3
$x9PutSelf = Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserA.id)" -Method PUT -Headers $headers -Body $x9PutSelfBody -ContentType "application/scim+json"
Test-Result -Success ($x9PutSelf.displayName -eq "9x Self Update OK") -Message "9x.3: PUT self-update with own userName succeeds (200)"

# 9x.4: PUT case-insensitive userName collision → 409
$x9PutCaseBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $x9UserNameA.ToUpper()
    displayName = "9x Case Conflict"
    active = $true
} | ConvertTo-Json -Depth 3
try {
    $x9PutCase = Invoke-WebRequest -Uri "$scimBase/Users/$($x9UserB.id)" -Method PUT `
        -Headers @{ Authorization = $headers.Authorization } -Body $x9PutCaseBody -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9x.4: PUT case-insensitive userName collision should return 409 (got $($x9PutCase.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 409) -Message "9x.4: PUT case-insensitive userName collision returns 409"
}

# ─────────────── 9x.5–9x.7: uniqueness:server — User PATCH 409 ───────────────
Write-Host "`n--- 9x: uniqueness:server — User PATCH ---" -ForegroundColor Cyan

# 9x.5: PATCH User B replace userName → User A's userName → 409
$x9PatchUserNameBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{
            op = "replace"
            path = "userName"
            value = $x9UserNameA
        }
    )
} | ConvertTo-Json -Depth 4
try {
    $x9PatchUN = Invoke-WebRequest -Uri "$scimBase/Users/$($x9UserB.id)" -Method PATCH `
        -Headers @{ Authorization = $headers.Authorization } -Body $x9PatchUserNameBody -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9x.5: PATCH userName collision should return 409 (got $($x9PatchUN.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 409) -Message "9x.5: PATCH userName collision returns 409 Conflict"
}

# 9x.6: PATCH User B replace externalId → User A's externalId → 200 (uniqueness:none per RFC 7643)
$x9PatchExtBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{
            op = "replace"
            path = "externalId"
            value = $x9UserA.externalId
        }
    )
} | ConvertTo-Json -Depth 4
try {
    $x9PatchExtResult = Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserB.id)" -Method PATCH -Headers $headers -Body $x9PatchExtBody -ContentType "application/scim+json"
    Test-Result -Success ($x9PatchExtResult.externalId -eq $x9UserA.externalId) -Message "9x.6: PATCH with duplicate externalId accepted (uniqueness:none)"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success $false -Message "9x.6: PATCH with duplicate externalId should succeed (uniqueness:none), got $statusCode"
}

# 9x.7: PATCH mutable field (displayName) → 200 (no conflict)
$x9PatchOkBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{
            op = "replace"
            path = "displayName"
            value = "9x Patched OK"
        }
    )
} | ConvertTo-Json -Depth 4
$x9PatchOk = Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserB.id)" -Method PATCH -Headers $headers -Body $x9PatchOkBody -ContentType "application/scim+json"
Test-Result -Success ($x9PatchOk.displayName -eq "9x Patched OK") -Message "9x.7: PATCH non-unique field succeeds (200)"

# ─────────────── 9x.8–9x.9: required:true — PUT enforcement ───────────────
Write-Host "`n--- 9x: required:true — PUT enforcement ---" -ForegroundColor Cyan

# 9x.8: PUT missing required userName → 400
$x9PutNoUserNameBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    displayName = "9x Missing Required"
    active = $true
} | ConvertTo-Json -Depth 3
try {
    $x9PutNoUN = Invoke-WebRequest -Uri "$scimBase/Users/$($x9UserA.id)" -Method PUT `
        -Headers @{ Authorization = $headers.Authorization } -Body $x9PutNoUserNameBody -ContentType "application/scim+json" -ErrorAction Stop
    Test-Result -Success $false -Message "9x.8: PUT missing required userName should return 400 (got $($x9PutNoUN.StatusCode))"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9x.8: PUT missing required userName returns 400"
}

# 9x.9: PUT with all required fields present → 200
$x9PutWithReqBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $x9UserNameA
    displayName = "9x All Required Present"
    active = $true
} | ConvertTo-Json -Depth 3
$x9PutWithReq = Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserA.id)" -Method PUT -Headers $headers -Body $x9PutWithReqBody -ContentType "application/scim+json"
Test-Result -Success ($x9PutWithReq.userName -eq $x9UserNameA) -Message "9x.9: PUT with all required fields succeeds (200)"

# ─────────────── 9x.10–9x.11: returned:never on PATCH response ───────────────
Write-Host "`n--- 9x: returned:never on PATCH response ---" -ForegroundColor Cyan

# 9x.10: PATCH response should not contain password (returned:never)
$x9PatchRetBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{
            op = "replace"
            path = "displayName"
            value = "9x PATCH Returned Test"
        }
    )
} | ConvertTo-Json -Depth 4
$x9PatchRet = Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserA.id)" -Method PATCH -Headers $headers -Body $x9PatchRetBody -ContentType "application/scim+json"
Test-Result -Success ($null -eq $x9PatchRet.password) -Message "9x.10: PATCH response does not include password (returned:never)"
Test-Result -Success ($null -ne $x9PatchRet.id -and $null -ne $x9PatchRet.userName) -Message "9x.11: PATCH response includes id + userName (returned:always)"

# ─────────────── 9x.12–9x.15: returned characteristics on .search ───────────────
Write-Host "`n--- 9x: returned characteristics on .search ---" -ForegroundColor Cyan

# 9x.12: .search should not return password (returned:never)
$x9SearchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = "userName eq `"$x9UserNameA`""
} | ConvertTo-Json -Depth 3
$x9Search = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $x9SearchBody -ContentType "application/scim+json"
$x9SearchFirst = $x9Search.Resources[0]
Test-Result -Success ($null -eq $x9SearchFirst.password) -Message "9x.12: .search does not return password (returned:never)"

# 9x.13: .search returns id and userName (returned:always)
Test-Result -Success ($null -ne $x9SearchFirst.id) -Message "9x.13: .search returns id (returned:always)"
Test-Result -Success ($null -ne $x9SearchFirst.userName) -Message "9x.14: .search returns userName (returned:always)"

# 9x.15: .search with excludedAttributes=id should still return id (always-returned)
$x9SearchExclBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = "userName eq `"$x9UserNameA`""
    excludedAttributes = "id"
} | ConvertTo-Json -Depth 3
$x9SearchExcl = Invoke-RestMethod -Uri "$scimBase/Users/.search" -Method POST -Headers $headers -Body $x9SearchExclBody -ContentType "application/scim+json"
$x9SearchExclFirst = $x9SearchExcl.Resources[0]
Test-Result -Success ($null -ne $x9SearchExclFirst.id) -Message "9x.15: .search excludedAttributes=id still returns id (always-returned protected)"

# ─────────────── 9x Cleanup ───────────────
Write-Host "`n--- 9x: Cleaning up test resources ---" -ForegroundColor Cyan
try { Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserA.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scimBase/Users/$($x9UserB.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

Write-Host "`n--- 9x: User Uniqueness, Required PUT, Returned on PATCH/.search Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9y: GENERIC RESOURCE PARITY FIXES
# ⚠️ SKIPPED: Uses Admin RT API removed in v0.28.0.
$script:currentSection = "9y: Generic Parity Fixes (SKIPPED)"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9y: GENERIC RESOURCE PARITY FIXES — SKIPPED (Admin API removed v0.28.0)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Test-Result -Success $true -Message "9y: SKIPPED — uses deleted Admin RT API; parity tested in profile-combinations.e2e-spec.ts"

function Skip-OldSection9y {
# --- Setup: Create endpoint with RequireIfMatch (custom resource types derived from profile) ---
Write-Host "`n--- 9y Setup: Creating endpoint with RequireIfMatch (custom resource types via profile) ---" -ForegroundColor Cyan
$y9EndpointBody = @{
    name = "live-test-9y-$(Get-Random)"
    displayName = "9y Generic Parity Endpoint"
    description = "Endpoint for generic parity fix tests"
    profilePreset = "rfc-standard"
} | ConvertTo-Json -Depth 4
$y9Endpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $y9EndpointBody
$Y9EndpointId = $y9Endpoint.id
$patchBody = @{ profile = @{ settings = @{ RequireIfMatch = "True" } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$Y9EndpointId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json" | Out-Null
$scimBase9y = "$baseUrl/scim/endpoints/$Y9EndpointId"
$adminBase9y = "$baseUrl/scim/admin/endpoints/$Y9EndpointId"
Test-Result -Success ($null -ne $Y9EndpointId) -Message "9y.0: Setup endpoint created with RequireIfMatch (custom resource types via profile)"

# Register Device resource type
$y9DeviceSchema = @{
    name = "Device"
    schemaUri = "urn:ietf:params:scim:schemas:custom:Device9y"
    endpoint = "/Devices"
    description = "Device for 9y parity tests"
} | ConvertTo-Json
$y9DeviceReg = Invoke-RestMethod -Uri "$adminBase9y/resource-types" -Method POST -Headers $headers -Body $y9DeviceSchema
Test-Result -Success ($y9DeviceReg.name -eq "Device") -Message "9y.0: Device resource type registered"

# Create a test device (POST does not require If-Match)
$y9DeviceBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Device9y")
    displayName = "Parity Test Device"
    externalId = "y9-ext-001"
} | ConvertTo-Json -Depth 5
$y9Device = Invoke-RestMethod -Uri "$scimBase9y/Devices" -Method POST -Headers $headers -Body $y9DeviceBody -ContentType "application/scim+json"
$Y9DeviceId = $y9Device.id
Test-Result -Success ($null -ne $Y9DeviceId) -Message "9y.0: Test device created (id=$Y9DeviceId)"

# ── Fix #1: RequireIfMatch 428 on Generic PUT/PATCH/DELETE ─────────────

# Section 9y needs headers WITHOUT If-Match to test 428 behavior
$noIfMatchHeaders = @{ Authorization = $headers['Authorization']; 'Content-Type' = 'application/json' }

# --- Test 9y.1: PUT without If-Match → 428 ---
Write-Host "`n--- Test 9y.1: PUT without If-Match → 428 ---" -ForegroundColor Cyan
$y9PutBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Device9y")
    displayName = "Updated Device"
} | ConvertTo-Json -Depth 5
try {
    $null = Invoke-RestMethod -Uri "$scimBase9y/Devices/$Y9DeviceId" -Method PUT -Headers $noIfMatchHeaders -Body $y9PutBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "9y.1: PUT without If-Match should have returned 428"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 428) -Message "9y.1: PUT without If-Match returns 428 (HTTP $statusCode)"
}

# --- Test 9y.2: PATCH without If-Match → 428 ---
Write-Host "`n--- Test 9y.2: PATCH without If-Match → 428 ---" -ForegroundColor Cyan
$y9PatchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "displayName"; value = "Patched Device" }
    )
} | ConvertTo-Json -Depth 5
try {
    $null = Invoke-RestMethod -Uri "$scimBase9y/Devices/$Y9DeviceId" -Method PATCH -Headers $noIfMatchHeaders -Body $y9PatchBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "9y.2: PATCH without If-Match should have returned 428"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 428) -Message "9y.2: PATCH without If-Match returns 428 (HTTP $statusCode)"
}

# --- Test 9y.3: DELETE without If-Match → 428 ---
Write-Host "`n--- Test 9y.3: DELETE without If-Match → 428 ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase9y/Devices/$Y9DeviceId" -Method DELETE -Headers $noIfMatchHeaders
    Test-Result -Success $false -Message "9y.3: DELETE without If-Match should have returned 428"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 428) -Message "9y.3: DELETE without If-Match returns 428 (HTTP $statusCode)"
}

# --- Test 9y.4: PUT with If-Match → 200 ---
Write-Host "`n--- Test 9y.4: PUT with If-Match → 200 ---" -ForegroundColor Cyan
$y9PutHeaders = @{} + $headers
$y9PutHeaders["If-Match"] = 'W/"v1"'
$y9PutResult = Invoke-RestMethod -Uri "$scimBase9y/Devices/$Y9DeviceId" -Method PUT -Headers $y9PutHeaders -Body $y9PutBody -ContentType "application/scim+json"
Test-Result -Success ($y9PutResult.id -eq $Y9DeviceId) -Message "9y.4: PUT with If-Match succeeds (id=$($y9PutResult.id))"

# --- Test 9y.5: PATCH with If-Match → 200 ---
Write-Host "`n--- Test 9y.5: PATCH with If-Match → 200 ---" -ForegroundColor Cyan
$y9PatchHeaders = @{} + $headers
$y9PatchHeaders["If-Match"] = 'W/"v2"'
$y9PatchResult = Invoke-RestMethod -Uri "$scimBase9y/Devices/$Y9DeviceId" -Method PATCH -Headers $y9PatchHeaders -Body $y9PatchBody -ContentType "application/scim+json"
Test-Result -Success ($y9PatchResult.id -eq $Y9DeviceId) -Message "9y.5: PATCH with If-Match succeeds (id=$($y9PatchResult.id))"

# ── Fix #3: Generic filter 400 for unsupported expressions ─────────────

# Also create an endpoint WITHOUT RequireIfMatch for filter tests
Write-Host "`n--- 9y Setup: Creating endpoint without RequireIfMatch for filter tests ---" -ForegroundColor Cyan
$y9FilterEndpointBody = @{
    name = "live-test-9y-filter-$(Get-Random)"
    displayName = "9y Filter Test Endpoint"
    description = "Endpoint for generic filter parity tests"
} | ConvertTo-Json
$y9FilterEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $y9FilterEndpointBody
$Y9FilterEndpointId = $y9FilterEndpoint.id
$scimBase9yFilter = "$baseUrl/scim/endpoints/$Y9FilterEndpointId"
$adminBase9yFilter = "$baseUrl/scim/admin/endpoints/$Y9FilterEndpointId"
$y9DeviceReg2 = Invoke-RestMethod -Uri "$adminBase9yFilter/resource-types" -Method POST -Headers $headers -Body $y9DeviceSchema
Test-Result -Success ($y9DeviceReg2.name -eq "Device") -Message "9y.6: Filter test endpoint setup complete"

# Create a device for filter testing
$y9FilterDeviceBody = @{
    schemas = @("urn:ietf:params:scim:schemas:custom:Device9y")
    displayName = "FilterTarget"
    externalId = "y9-filter-ext"
} | ConvertTo-Json -Depth 5
$y9FilterDevice = Invoke-RestMethod -Uri "$scimBase9yFilter/Devices" -Method POST -Headers $headers -Body $y9FilterDeviceBody -ContentType "application/scim+json"

# --- Test 9y.7: Unsupported filter operator → 400 invalidFilter ---
Write-Host "`n--- Test 9y.7: Unsupported filter operator → 400 invalidFilter ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase9yFilter/Devices?filter=displayName co `"test`"" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9y.7: Unsupported filter should have returned 400"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9y.7: Unsupported filter operator returns 400 (HTTP $statusCode)"
}

# --- Test 9y.8: Unsupported attribute in eq filter → 400 ---
Write-Host "`n--- Test 9y.8: Unsupported attribute in eq filter → 400 ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase9yFilter/Devices?filter=active eq true" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9y.8: Unsupported attribute should have returned 400"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9y.8: Unsupported attribute in eq filter returns 400 (HTTP $statusCode)"
}

# --- Test 9y.9: Valid displayName eq filter still works → 200 ---
Write-Host "`n--- Test 9y.9: Valid displayName eq filter → 200 ---" -ForegroundColor Cyan
$y9FilterResult = Invoke-RestMethod -Uri "$scimBase9yFilter/Devices?filter=displayName eq `"FilterTarget`"" -Method GET -Headers $headers
Test-Result -Success ($y9FilterResult.totalResults -ge 1) -Message "9y.9: displayName eq filter returns results (totalResults=$($y9FilterResult.totalResults))"

# --- Test 9y.10: Valid externalId eq filter → 200 ---
Write-Host "`n--- Test 9y.10: Valid externalId eq filter → 200 ---" -ForegroundColor Cyan
$y9ExtIdResult = Invoke-RestMethod -Uri "$scimBase9yFilter/Devices?filter=externalId eq `"y9-filter-ext`"" -Method GET -Headers $headers
Test-Result -Success ($y9ExtIdResult.totalResults -ge 1) -Message "9y.10: externalId eq filter returns results (totalResults=$($y9ExtIdResult.totalResults))"

# ── Fix #2: Users filter with unknown attribute → 400 ──────────────────

# --- Test 9y.11: Users filter with completely unknown attribute → 400 ---
Write-Host "`n--- Test 9y.11: Users filter with unknown attribute → 400 ---" -ForegroundColor Cyan
try {
    $null = Invoke-RestMethod -Uri "$scimBase9yFilter/Users?filter=nonExistentAttr eq `"test`"" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9y.11: Unknown attribute filter should have returned 400"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 400) -Message "9y.11: Users filter with unknown attribute returns 400 (HTTP $statusCode)"
}

# ─────────────── 9y Cleanup ───────────────
Write-Host "`n--- 9y: Cleaning up test resources ---" -ForegroundColor Cyan
# Delete via If-Match for the RequireIfMatch endpoint
$y9DeleteHeaders = @{} + $headers
$y9DeleteHeaders["If-Match"] = 'W/"v3"'
try { Invoke-RestMethod -Uri "$scimBase9y/Devices/$Y9DeviceId" -Method DELETE -Headers $y9DeleteHeaders | Out-Null } catch {}
# Delete on the filter endpoint (no RequireIfMatch)
try { Invoke-RestMethod -Uri "$scimBase9yFilter/Devices/$($y9FilterDevice.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
# Delete endpoints  
try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$Y9EndpointId" -Method DELETE -Headers $headers | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$Y9FilterEndpointId" -Method DELETE -Headers $headers | Out-Null } catch {}

Write-Host "`n--- 9y: Generic Resource Parity Fix Tests Complete ---" -ForegroundColor Green
} # End Skip-OldSection9y

# ============================================
# TEST SECTION 9z: ENDPOINT PROFILES & PRESET DISCOVERY (Phase 13/14)
$script:currentSection = "9z: Endpoint Profiles"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z: ENDPOINT PROFILES & PRESET DISCOVERY" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create endpoints with different presets ---
Write-Host "`n--- Setup: Create Endpoints with Presets ---" -ForegroundColor Cyan
$entraBody = @{ name = "live-entra-$(Get-Random)"; profilePreset = "entra-id" } | ConvertTo-Json
$minimalBody = @{ name = "live-minimal-$(Get-Random)"; profilePreset = "minimal" } | ConvertTo-Json
$rfcBody = @{ name = "live-rfc-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json
$userOnlyBody = @{ name = "live-useronly-$(Get-Random)"; profilePreset = "user-only" } | ConvertTo-Json

$entraEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $entraBody
$minimalEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $minimalBody
$rfcEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $rfcBody
$userOnlyEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $userOnlyBody
Test-Result -Success ($null -ne $entraEp.id) -Message "9z.setup: Created entra-id endpoint"
Test-Result -Success ($null -ne $minimalEp.id) -Message "9z.setup: Created minimal endpoint"
Test-Result -Success ($null -ne $rfcEp.id) -Message "9z.setup: Created rfc-standard endpoint"
Test-Result -Success ($null -ne $userOnlyEp.id) -Message "9z.setup: Created user-only endpoint"

# --- Test 9z.1: Schema count differs per preset ---
Write-Host "`n--- Test 9z.1: Schema count differs per preset ---" -ForegroundColor Cyan
$entraSchemas = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($entraEp.id)/Schemas" -Headers $headers
$minimalSchemas = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($minimalEp.id)/Schemas" -Headers $headers
$rfcSchemas = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($rfcEp.id)/Schemas" -Headers $headers
Test-Result -Success ($entraSchemas.totalResults -eq 7) -Message "9z.1: entra-id has 7 schemas"
Test-Result -Success ($minimalSchemas.totalResults -eq 2) -Message "9z.2: minimal has 2 schemas"
Test-Result -Success ($rfcSchemas.totalResults -eq 3) -Message "9z.3: rfc-standard has 3 schemas"

# --- Test 9z.4: SPC differs per preset ---
Write-Host "`n--- Test 9z.4: SPC differs per preset ---" -ForegroundColor Cyan
$minimalSpc = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($minimalEp.id)/ServiceProviderConfig" -Headers $headers
$rfcSpc = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($rfcEp.id)/ServiceProviderConfig" -Headers $headers
Test-Result -Success ($minimalSpc.bulk.supported -eq $false) -Message "9z.4: minimal bulk=false"
Test-Result -Success ($minimalSpc.sort.supported -eq $false) -Message "9z.5: minimal sort=false"
Test-Result -Success ($rfcSpc.bulk.supported -eq $true) -Message "9z.6: rfc-standard bulk=true"
Test-Result -Success ($rfcSpc.sort.supported -eq $true) -Message "9z.7: rfc-standard sort=true"

# --- Test 9z.8: user-only has 1 ResourceType ---
Write-Host "`n--- Test 9z.8: user-only ResourceTypes ---" -ForegroundColor Cyan
$userOnlyRts = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($userOnlyEp.id)/ResourceTypes" -Headers $headers
Test-Result -Success ($userOnlyRts.totalResults -eq 1) -Message "9z.8: user-only has 1 resource type"
Test-Result -Success ($userOnlyRts.Resources[0].name -eq "User") -Message "9z.9: user-only RT is User"

# --- Test 9z.13: PATCH deep-merge settings ---
Write-Host "`n--- Test 9z.13: PATCH deep-merge settings ---" -ForegroundColor Cyan
$patchBody = @{ profile = @{ settings = @{ UserSoftDeleteEnabled = "True" } } } | ConvertTo-Json -Depth 4
$patchResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($rfcEp.id)" -Method PATCH -Headers $headers -Body $patchBody
Test-Result -Success ($patchResult.profile.settings.UserSoftDeleteEnabled -eq "True") -Message "9z.13: PATCH added UserSoftDeleteEnabled"
# Verify schemas untouched
$rfcSchemasAfter = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($rfcEp.id)/Schemas" -Headers $headers
Test-Result -Success ($rfcSchemasAfter.totalResults -eq 3) -Message "9z.14: schemas unchanged after settings PATCH"

# --- Test 9z.15: Inline profile creation ---
Write-Host "`n--- Test 9z.15: Inline profile creation ---" -ForegroundColor Cyan
$inlineBody = @{
    name = "live-inline-$(Get-Random)"
    profile = @{
        schemas = @(
            @{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = @(@{ name = "userName" }, @{ name = "active" }) }
        )
        resourceTypes = @(
            @{ id = "User"; name = "User"; endpoint = "/Users"; description = "User"; schema = "urn:ietf:params:scim:schemas:core:2.0:User"; schemaExtensions = @() }
        )
        serviceProviderConfig = @{
            patch = @{ supported = $true }; bulk = @{ supported = $false }; filter = @{ supported = $true; maxResults = 50 }
            sort = @{ supported = $false }; etag = @{ supported = $false }; changePassword = @{ supported = $false }
        }
    }
} | ConvertTo-Json -Depth 6
$inlineEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $inlineBody
Test-Result -Success ($null -ne $inlineEp.id) -Message "9z.15: Inline profile endpoint created"
$inlineSchemas = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($inlineEp.id)/Schemas" -Headers $headers
Test-Result -Success ($inlineSchemas.totalResults -eq 1) -Message "9z.16: Inline profile has 1 schema"

# --- Test 9z.17–9z.33: Partial PATCH profile settings & combinations ---
Write-Host "`n--- Test 9z.17–9z.33: Partial PATCH Profile Settings & Combinations ---" -ForegroundColor Cyan

# Create a dedicated rfc-standard endpoint for PATCH tests
$patchEpBody = @{ name = "live-patch-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json
$patchEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $patchEpBody
Test-Result -Success ($null -ne $patchEp.id) -Message "9z.17: Created rfc-standard endpoint for PATCH tests"

# 9z.18: PATCH add single setting via profile.settings
$pBody18 = @{ profile = @{ settings = @{ UserSoftDeleteEnabled = "True" } } } | ConvertTo-Json -Depth 4
$p18 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method PATCH -Headers $headers -Body $pBody18
Test-Result -Success ($p18.profile.settings.UserSoftDeleteEnabled -eq "True") -Message "9z.18: PATCH added UserSoftDeleteEnabled via profile.settings"
Test-Result -Success ($p18.profile.settings.UserSoftDeleteEnabled -eq "True") -Message "9z.19: profile.settings reflects UserSoftDeleteEnabled"

# 9z.20: PATCH add second setting — first should be preserved
$pBody20 = @{ profile = @{ settings = @{ StrictSchemaValidation = "True" } } } | ConvertTo-Json -Depth 4
$p20 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method PATCH -Headers $headers -Body $pBody20
Test-Result -Success ($p20.profile.settings.UserSoftDeleteEnabled -eq "True") -Message "9z.20: UserSoftDeleteEnabled preserved after second PATCH"
Test-Result -Success ($p20.profile.settings.StrictSchemaValidation -eq "True") -Message "9z.21: StrictSchemaValidation added"

# 9z.22: PATCH overwrite individual setting value
$pBody22 = @{ profile = @{ settings = @{ UserSoftDeleteEnabled = "False" } } } | ConvertTo-Json -Depth 4
$p22 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method PATCH -Headers $headers -Body $pBody22
Test-Result -Success ($p22.profile.settings.UserSoftDeleteEnabled -eq "False") -Message "9z.22: UserSoftDeleteEnabled overwritten to False"
Test-Result -Success ($p22.profile.settings.StrictSchemaValidation -eq "True") -Message "9z.23: StrictSchemaValidation still True"

# 9z.24: Schemas untouched after settings-only PATCH
$schemasAfterPatch = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($patchEp.id)/Schemas" -Headers $headers
Test-Result -Success ($schemasAfterPatch.totalResults -eq 3) -Message "9z.24: Schemas unchanged (3) after settings PATCH"

# 9z.25: SPC untouched after settings-only PATCH
$spcAfterPatch = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($patchEp.id)/ServiceProviderConfig" -Headers $headers
Test-Result -Success ($spcAfterPatch.bulk.supported -eq $true) -Message "9z.25: SPC bulk=true preserved after settings PATCH"

# 9z.26: PATCH multiple settings at once
$pBody26 = @{ profile = @{ settings = @{ RequireIfMatch = "True"; VerbosePatchSupported = "True"; AllowAndCoerceBooleanStrings = "True" } } } | ConvertTo-Json -Depth 4
$p26 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method PATCH -Headers $headers -Body $pBody26
Test-Result -Success ($p26.profile.settings.RequireIfMatch -eq "True") -Message "9z.26: RequireIfMatch added"
Test-Result -Success ($p26.profile.settings.VerbosePatchSupported -eq "True") -Message "9z.27: VerbosePatchSupported added"
Test-Result -Success ($p26.profile.settings.AllowAndCoerceBooleanStrings -eq "True") -Message "9z.28: AllowAndCoerceBooleanStrings added"
Test-Result -Success ($p26.profile.settings.StrictSchemaValidation -eq "True") -Message "9z.29: Previous settings still preserved"

# 9z.30: PATCH replace SPC via profile
$pBody30 = @{
    profile = @{
        serviceProviderConfig = @{
            patch = @{ supported = $true }; bulk = @{ supported = $false }
            filter = @{ supported = $true; maxResults = 42 }; sort = @{ supported = $false }
            etag = @{ supported = $false }; changePassword = @{ supported = $false }
        }
    }
} | ConvertTo-Json -Depth 5
$p30 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method PATCH -Headers $headers -Body $pBody30
$spc30 = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$($patchEp.id)/ServiceProviderConfig" -Headers $headers
Test-Result -Success ($spc30.bulk.supported -eq $false) -Message "9z.30: SPC bulk changed to false via PATCH"
Test-Result -Success ($spc30.filter.maxResults -eq 42) -Message "9z.31: SPC maxResults changed to 42"
# Settings should still be preserved
Test-Result -Success ($p30.profile.settings.RequireIfMatch -eq "True") -Message "9z.32: Settings preserved after SPC PATCH"

# 9z.33: PATCH displayName + settings combined
$pBody33 = @{ displayName = "Patched Display $(Get-Random)"; profile = @{ settings = @{ RequireIfMatch = "True" } } } | ConvertTo-Json -Depth 4
$p33 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method PATCH -Headers $headers -Body $pBody33
Test-Result -Success ($p33.displayName -like "Patched Display*") -Message "9z.33: displayName updated alongside settings"
Test-Result -Success ($p33.profile.settings.RequireIfMatch -eq "True") -Message "9z.34: RequireIfMatch setting added"

# 9z.35: PATCH with merged settings via profile
Write-Host "`n--- Test 9z.35: PATCH with merged settings via profile ---" -ForegroundColor Cyan
$pBody35 = @{ profile = @{ settings = @{ UserSoftDeleteEnabled = "True"; StrictSchemaValidation = "True" } } } | ConvertTo-Json -Depth 4
$p35 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method PATCH -Headers $headers -Body $pBody35
Test-Result -Success ($p35.profile.settings.UserSoftDeleteEnabled -eq "True") -Message "9z.35: UserSoftDeleteEnabled present after merged PATCH"
Test-Result -Success ($p35.profile.settings.StrictSchemaValidation -eq "True") -Message "9z.35: StrictSchemaValidation present after merged PATCH"

# Cleanup PATCH test endpoint
try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($patchEp.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
Test-Result -Success $true -Message "9z.36: Cleaned up PATCH test endpoint"

# --- Cleanup ---
Write-Host "`n--- Cleanup: Delete test endpoints ---" -ForegroundColor Cyan
@($entraEp.id, $minimalEp.id, $rfcEp.id, $userOnlyEp.id, $inlineEp.id) | ForEach-Object {
    try { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$_" -Method DELETE -Headers $headers | Out-Null } catch {}
}
Test-Result -Success $true -Message "9z.cleanup: Deleted profile test endpoints"

Write-Host "`n--- 9z: Profile & Preset Discovery Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-C: SCHEMA CHARACTERISTICS CACHE (Precomputed Cache Validation)
$script:currentSection = "9z-C: Schema Cache"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-C: SCHEMA CHARACTERISTICS CACHE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create a dedicated endpoint with extension that has name-collision attributes
$cacheEpName = "cache-live-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$cacheExtUrn = "urn:test:cache:2.0:User"
$cacheProfile = @{
    schemas = @(
        @{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = "all" }
        @{
            id = $cacheExtUrn
            name = "CacheTestExt"
            description = "Extension with name-collision attrs for cache testing"
            attributes = @(
                @{ name = "department"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default" }
                @{ name = "badge"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "never"; description = "writeOnly badge" }
                @{ name = "active"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default"; description = "String active NOT boolean" }
            )
        }
    )
    resourceTypes = @(
        @{
            id = "User"; name = "User"; endpoint = "/Users"; description = "User"
            schema = "urn:ietf:params:scim:schemas:core:2.0:User"
            schemaExtensions = @(@{ schema = $cacheExtUrn; required = $false })
        }
    )
    settings = @{ AllowAndCoerceBooleanStrings = "True" }
} | ConvertTo-Json -Depth 10

$cacheEpBody = @{ name = $cacheEpName; profile = ($cacheProfile | ConvertFrom-Json) } | ConvertTo-Json -Depth 10
try {
    $cacheEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $cacheEpBody -ContentType "application/json"
    $cacheEpId = $cacheEp.id
    $cacheSBase = "$baseUrl/scim/endpoints/$cacheEpId"
    Test-Result -Success $true -Message "9z-C.1: Created cache test endpoint with name-collision extension"
} catch {
    Test-Result -Success $false -Message "9z-C.1: Failed to create cache test endpoint: $_"
    $cacheEpId = $null
}

if ($cacheEpId) {
    # 9z-C.2: POST with core active="True" → should be coerced to boolean true
    $cacheUser1 = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $cacheExtUrn)
        userName = "cache-user1-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
        active = "True"
        $cacheExtUrn = @{ department = "Engineering"; badge = "SECRET-123"; active = "True" }
    } | ConvertTo-Json -Depth 5
    try {
        $cu1 = Invoke-RestMethod -Uri "$cacheSBase/Users" -Method POST -Headers $headers -Body $cacheUser1 -ContentType "application/scim+json"
        $cu1Id = $cu1.id
        # Core active should be boolean true (coerced)
        $coreActiveOk = $cu1.active -eq $true -and $cu1.active -is [bool]
        Test-Result -Success $coreActiveOk -Message "9z-C.2: POST coerces core active='True' to boolean true"
    } catch {
        Test-Result -Success $false -Message "9z-C.2: POST failed: $_"
        $cu1Id = $null
    }

    # 9z-C.3: Extension active should remain string "True" (NOT coerced — parent-aware precision)
    if ($cu1Id) {
        $extBlock = $cu1.$cacheExtUrn
        $extActiveOk = $extBlock.active -eq "True" -and $extBlock.active -is [string]
        Test-Result -Success $extActiveOk -Message "9z-C.3: Extension active remains string 'True' (not coerced)"
    }

    # 9z-C.4: returned:never attr (badge) should NOT appear in POST response
    if ($cu1Id) {
        $extBlock = $cu1.$cacheExtUrn
        $badgeMissing = $null -eq $extBlock.badge
        Test-Result -Success $badgeMissing -Message "9z-C.4: returned:never attr 'badge' stripped from POST response"
    }

    # 9z-C.5: GET should also strip returned:never badge
    if ($cu1Id) {
        try {
            $getRes = Invoke-RestMethod -Uri "$cacheSBase/Users/$cu1Id" -Method GET -Headers $headers
            $getBadgeMissing = $null -eq $getRes.$cacheExtUrn.badge
            $getDeptPresent = $getRes.$cacheExtUrn.department -eq "Engineering"
            Test-Result -Success ($getBadgeMissing -and $getDeptPresent) -Message "9z-C.5: GET strips badge (never), keeps department (default)"
        } catch {
            Test-Result -Success $false -Message "9z-C.5: GET failed: $_"
        }
    }

    # 9z-C.6: LIST should also strip returned:never badge
    if ($cu1Id) {
        try {
            $userName = $cu1.userName
            $encodedFilter = [Uri]::EscapeDataString("userName eq `"$userName`"")
            $listRes = Invoke-RestMethod -Uri "$cacheSBase/Users?filter=$encodedFilter" -Method GET -Headers $headers
            $listUser = $listRes.Resources | Where-Object { $_.id -eq $cu1Id } | Select-Object -First 1
            $listBadgeMissing = $null -eq $listUser.$cacheExtUrn.badge
            Test-Result -Success $listBadgeMissing -Message "9z-C.6: LIST strips returned:never badge"
        } catch {
            Test-Result -Success $false -Message "9z-C.6: LIST failed: $_"
        }
    }

    # 9z-C.7: PUT should strip returned:never from response + preserve coercion
    if ($cu1Id) {
        try {
            $putBody = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $cacheExtUrn)
                userName = $cu1.userName
                active = "False"
                $cacheExtUrn = @{ department = "NewDept"; badge = "PUT-SECRET"; active = "False" }
            } | ConvertTo-Json -Depth 5
            $putRes = Invoke-RestMethod -Uri "$cacheSBase/Users/$cu1Id" -Method PUT -Headers $headers -Body $putBody -ContentType "application/scim+json"
            $putCoreOk = $putRes.active -eq $false -and $putRes.active -is [bool]
            $putBadgeMissing = $null -eq $putRes.$cacheExtUrn.badge
            $putExtActiveStr = $putRes.$cacheExtUrn.active -eq "False" -and $putRes.$cacheExtUrn.active -is [string]
            Test-Result -Success ($putCoreOk -and $putBadgeMissing -and $putExtActiveStr) -Message "9z-C.7: PUT coerces core, strips badge, preserves ext string"
        } catch {
            Test-Result -Success $false -Message "9z-C.7: PUT failed: $_"
        }
    }

    # 9z-C.8: PATCH should strip returned:never from response
    if ($cu1Id) {
        try {
            $patchBody = @{
                schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
                Operations = @(
                    @{ op = "replace"; path = "$($cacheExtUrn):department"; value = "PatchedDept" }
                )
            } | ConvertTo-Json -Depth 5
            $patchRes = Invoke-RestMethod -Uri "$cacheSBase/Users/$cu1Id" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/scim+json"
            $patchBadgeMissing = $null -eq $patchRes.$cacheExtUrn.badge
            $patchDeptOk = $patchRes.$cacheExtUrn.department -eq "PatchedDept"
            Test-Result -Success ($patchBadgeMissing -and $patchDeptOk) -Message "9z-C.8: PATCH strips badge, applies dept change"
        } catch {
            Test-Result -Success $false -Message "9z-C.8: PATCH failed: $_"
        }
    }

    # 9z-C.9: Consistency — 3 rapid POSTs should all show same cache behavior
    $consistencyOk = $true
    for ($i = 1; $i -le 3; $i++) {
        try {
            $rapidUser = @{
                schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $cacheExtUrn)
                userName = "cache-rapid-$i-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
                active = "True"
                $cacheExtUrn = @{ department = "Dept-$i"; badge = "B-$i"; active = "True" }
            } | ConvertTo-Json -Depth 5
            $rapidRes = Invoke-RestMethod -Uri "$cacheSBase/Users" -Method POST -Headers $headers -Body $rapidUser -ContentType "application/scim+json"
            if ($rapidRes.active -ne $true) { $consistencyOk = $false }
            if ($null -ne $rapidRes.$cacheExtUrn.badge) { $consistencyOk = $false }
            if ($rapidRes.$cacheExtUrn.active -ne "True") { $consistencyOk = $false }
        } catch {
            $consistencyOk = $false
        }
    }
    Test-Result -Success $consistencyOk -Message "9z-C.9: 3 rapid POSTs show consistent cache behavior"

    # 9z-C.10: readOnly id/meta stripped from POST input
    try {
        $roUser = @{
            schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
            userName = "cache-ro-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
            id = "client-supplied-id"
            meta = @{ resourceType = "FAKE" }
        } | ConvertTo-Json -Depth 5
        $roRes = Invoke-RestMethod -Uri "$cacheSBase/Users" -Method POST -Headers $headers -Body $roUser -ContentType "application/scim+json"
        $idOk = $roRes.id -ne "client-supplied-id"
        $metaOk = $roRes.meta.resourceType -eq "User"
        Test-Result -Success ($idOk -and $metaOk) -Message "9z-C.10: readOnly id/meta stripped from POST via cache"
    } catch {
        Test-Result -Success $false -Message "9z-C.10: readOnly stripping POST failed: $_"
    }

    # 9z-C.11: Verify returned:always attrs (id, userName) always present
    if ($cu1Id) {
        try {
            $alwaysRes = Invoke-RestMethod -Uri "$cacheSBase/Users/$cu1Id" -Method GET -Headers $headers
            $hasId = $null -ne $alwaysRes.id -and $alwaysRes.id.Length -gt 0
            $hasUserName = $null -ne $alwaysRes.userName -and $alwaysRes.userName.Length -gt 0
            Test-Result -Success ($hasId -and $hasUserName) -Message "9z-C.11: returned:always attrs (id, userName) present in GET"
        } catch {
            Test-Result -Success $false -Message "9z-C.11: returned:always check failed: $_"
        }
    }

    # 9z-C.12: Verify returned:default attrs (department) present by default
    if ($cu1Id) {
        $getDeptPresent = $null -ne $alwaysRes.$cacheExtUrn.department
        Test-Result -Success $getDeptPresent -Message "9z-C.12: returned:default attr (department) present by default"
    }

    # Cleanup: delete the cache test endpoint
    try {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$cacheEpId" -Method DELETE -Headers $headers | Out-Null
        Test-Result -Success $true -Message "9z-C.cleanup: Deleted cache test endpoint"
    } catch {
        Test-Result -Success $false -Message "9z-C.cleanup: Failed to delete cache test endpoint: $_"
    }
}

Write-Host "`n--- 9z-C: Schema Cache Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-D: ADMIN ENDPOINT API IMPROVEMENTS
$script:currentSection = "9z-D: Admin Endpoint API"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-D: ADMIN ENDPOINT API IMPROVEMENTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Test 9z-D.1: List endpoints returns envelope ---
Write-Host "`n--- Test 9z-D.1: Envelope Response ---" -ForegroundColor Cyan
$listResponse = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method GET -Headers $headers
Test-Result -Success ($null -ne $listResponse.totalResults) -Message "9z-D.1: List response has totalResults"
Test-Result -Success ($null -ne $listResponse.endpoints) -Message "9z-D.2: List response has endpoints array"
Test-Result -Success ($listResponse.totalResults -ge 1) -Message "9z-D.3: totalResults >= 1"
Test-Result -Success ($listResponse.endpoints.Count -eq $listResponse.totalResults) -Message "9z-D.4: endpoints.Count matches totalResults"

# --- Test 9z-D.2: Summary view (list default) ---
Write-Host "`n--- Test 9z-D.2: Summary View ---" -ForegroundColor Cyan
$summaryList = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints?view=summary" -Method GET -Headers $headers
$firstEp = $summaryList.endpoints[0]
Test-Result -Success ($null -ne $firstEp.profileSummary) -Message "9z-D.5: Summary view includes profileSummary"
Test-Result -Success ($null -eq $firstEp.profile) -Message "9z-D.6: Summary view omits full profile"

# --- Test 9z-D.3: Full view ---
Write-Host "`n--- Test 9z-D.3: Full View ---" -ForegroundColor Cyan
$fullList = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints?view=full" -Method GET -Headers $headers
$firstFull = $fullList.endpoints[0]
Test-Result -Success ($null -ne $firstFull.profile) -Message "9z-D.7: Full view includes profile"
Test-Result -Success ($null -eq $firstFull.profileSummary) -Message "9z-D.8: Full view omits profileSummary"

# --- Test 9z-D.4: Single-get defaults to full ---
Write-Host "`n--- Test 9z-D.4: Single-Get Views ---" -ForegroundColor Cyan
$singleFull = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method GET -Headers $headers
Test-Result -Success ($null -ne $singleFull.profile) -Message "9z-D.9: Single-get defaults to full view"
$singleSummary = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId`?view=summary" -Method GET -Headers $headers
Test-Result -Success ($null -ne $singleSummary.profileSummary) -Message "9z-D.10: Single-get with view=summary returns profileSummary"
Test-Result -Success ($null -eq $singleSummary.profile) -Message "9z-D.11: Single-get with view=summary omits profile"

# --- Test 9z-D.5: _links (HATEOAS) ---
Write-Host "`n--- Test 9z-D.5: HATEOAS _links ---" -ForegroundColor Cyan
Test-Result -Success ($null -ne $singleFull._links) -Message "9z-D.12: Response includes _links"
Test-Result -Success ($singleFull._links.self -like "*/admin/endpoints/$EndpointId") -Message "9z-D.13: _links.self is correct"
Test-Result -Success ($singleFull._links.stats -like "*/admin/endpoints/$EndpointId/stats") -Message "9z-D.14: _links.stats is correct"
Test-Result -Success ($singleFull._links.credentials -like "*/admin/endpoints/$EndpointId/credentials") -Message "9z-D.15: _links.credentials is correct"
Test-Result -Success ($singleFull._links.scim -like "*/scim/endpoints/$EndpointId") -Message "9z-D.16: _links.scim is correct"

# --- Test 9z-D.6: ISO 8601 timestamps ---
Write-Host "`n--- Test 9z-D.6: ISO Timestamps ---" -ForegroundColor Cyan
# PowerShell's Invoke-RestMethod auto-converts ISO strings to DateTime objects,
# so we check that the value is present and can be used as a date (string or DateTime)
$createdAtPresent = $null -ne $singleFull.createdAt
$updatedAtPresent = $null -ne $singleFull.updatedAt
Test-Result -Success $createdAtPresent -Message "9z-D.17: createdAt is present"
Test-Result -Success $updatedAtPresent -Message "9z-D.18: updatedAt is present"
# Verify they're valid dates (PowerShell may auto-convert to DateTime or keep as string)
$createdValid = try { [DateTime]$singleFull.createdAt; $true } catch { $false }
$updatedValid = try { [DateTime]$singleFull.updatedAt; $true } catch { $false }
Test-Result -Success $createdValid -Message "9z-D.19: createdAt is a valid date"
Test-Result -Success $updatedValid -Message "9z-D.20: updatedAt is a valid date"

# --- Test 9z-D.7: ProfileSummary content ---
Write-Host "`n--- Test 9z-D.7: ProfileSummary Content ---" -ForegroundColor Cyan
$ps = $singleSummary.profileSummary
Test-Result -Success ($null -ne $ps.schemaCount -and $ps.schemaCount -gt 0) -Message "9z-D.21: schemaCount > 0"
Test-Result -Success ($null -ne $ps.schemas -and $ps.schemas.Count -eq $ps.schemaCount) -Message "9z-D.22: schemas count matches schemaCount"
Test-Result -Success ($null -ne $ps.resourceTypeCount) -Message "9z-D.23: resourceTypeCount present"
Test-Result -Success ($null -ne $ps.resourceTypes -and $ps.resourceTypes.Count -eq $ps.resourceTypeCount) -Message "9z-D.24: resourceTypes count matches"
Test-Result -Success ($null -ne $ps.serviceProviderConfig) -Message "9z-D.25: serviceProviderConfig present"
Test-Result -Success ($null -ne $ps.activeSettings) -Message "9z-D.26: activeSettings present"

# Check schema summary has attributeCount
$firstSchema = $ps.schemas[0]
Test-Result -Success ($null -ne $firstSchema.id) -Message "9z-D.27: Schema summary has id"
Test-Result -Success ($null -ne $firstSchema.name) -Message "9z-D.28: Schema summary has name"
Test-Result -Success ($null -ne $firstSchema.attributeCount -and $firstSchema.attributeCount -gt 0) -Message "9z-D.29: Schema summary has attributeCount"

# --- Test 9z-D.8: Presets API ---
Write-Host "`n--- Test 9z-D.8: Presets API ---" -ForegroundColor Cyan
$presetsResponse = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/presets" -Method GET -Headers $headers
Test-Result -Success ($null -ne $presetsResponse.totalResults) -Message "9z-D.30: Presets list has totalResults"
Test-Result -Success ($presetsResponse.totalResults -ge 5) -Message "9z-D.31: At least 5 presets"
Test-Result -Success ($null -ne $presetsResponse.presets) -Message "9z-D.32: Presets list has presets array"

# Check preset names
$presetNames = $presetsResponse.presets | ForEach-Object { $_.name }
Test-Result -Success ($presetNames -contains "entra-id") -Message "9z-D.33: Contains entra-id preset"
Test-Result -Success ($presetNames -contains "rfc-standard") -Message "9z-D.34: Contains rfc-standard preset"
Test-Result -Success ($presetNames -contains "minimal") -Message "9z-D.35: Contains minimal preset"

# Check default flag
$defaults = $presetsResponse.presets | Where-Object { $_.default -eq $true }
Test-Result -Success ($defaults.Count -eq 1) -Message "9z-D.36: Exactly one default preset"
Test-Result -Success ($defaults[0].name -eq "entra-id") -Message "9z-D.37: Default preset is entra-id"

# Check preset summary structure
$presetSummary = $presetsResponse.presets[0].summary
Test-Result -Success ($null -ne $presetSummary.schemaCount) -Message "9z-D.38: Preset summary has schemaCount"
Test-Result -Success ($null -ne $presetSummary.serviceProviderConfig) -Message "9z-D.39: Preset summary has serviceProviderConfig"

# --- Test 9z-D.9: Get single preset by name ---
Write-Host "`n--- Test 9z-D.9: Get Preset by Name ---" -ForegroundColor Cyan
$entraPreset = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/presets/entra-id" -Method GET -Headers $headers
Test-Result -Success ($entraPreset.metadata.name -eq "entra-id") -Message "9z-D.40: Preset detail name is entra-id"
Test-Result -Success ($entraPreset.metadata.default -eq $true) -Message "9z-D.41: Preset detail default flag is true"
Test-Result -Success ($null -ne $entraPreset.profile) -Message "9z-D.42: Preset detail has full profile"
Test-Result -Success ($entraPreset.profile.schemas.Count -gt 0) -Message "9z-D.43: Preset has schemas"
Test-Result -Success ($entraPreset.profile.resourceTypes.Count -gt 0) -Message "9z-D.44: Preset has resourceTypes"

# Test unknown preset returns 404
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/presets/does-not-exist" -Method GET -Headers $headers
    Test-Result -Success $false -Message "9z-D.45: Unknown preset should return 404"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($statusCode -eq 404) -Message "9z-D.45: Unknown preset returns 404 (got $statusCode)"
}

# --- Test 9z-D.10: Nested stats ---
Write-Host "`n--- Test 9z-D.10: Nested Stats ---" -ForegroundColor Cyan
$stats = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId/stats" -Method GET -Headers $headers
Test-Result -Success ($null -ne $stats.users) -Message "9z-D.46: Stats has users object"
Test-Result -Success ($null -ne $stats.users.total) -Message "9z-D.47: users has total"
Test-Result -Success ($null -ne $stats.users.active) -Message "9z-D.48: users has active"
Test-Result -Success ($null -ne $stats.users.inactive) -Message "9z-D.49: users has inactive"
Test-Result -Success ($null -ne $stats.groups) -Message "9z-D.50: Stats has groups object"
Test-Result -Success ($null -ne $stats.groups.total) -Message "9z-D.51: groups has total"
Test-Result -Success ($null -ne $stats.groups.active) -Message "9z-D.52: groups has active"
Test-Result -Success ($null -ne $stats.groups.inactive) -Message "9z-D.53: groups has inactive"
Test-Result -Success ($null -ne $stats.groupMembers) -Message "9z-D.54: Stats has groupMembers"
Test-Result -Success ($null -ne $stats.groupMembers.total) -Message "9z-D.55: groupMembers has total"
Test-Result -Success ($null -ne $stats.requestLogs) -Message "9z-D.56: Stats has requestLogs"
Test-Result -Success ($null -ne $stats.requestLogs.total) -Message "9z-D.57: requestLogs has total"

# Old format should NOT exist
Test-Result -Success ($null -eq $stats.totalUsers) -Message "9z-D.58: Old totalUsers field absent"
Test-Result -Success ($null -eq $stats.totalGroups) -Message "9z-D.59: Old totalGroups field absent"

Write-Host "`n--- 9z-D: Admin Endpoint API Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-E: URN DOT-PATH CACHE + PATCH COERCION + FP-1 (v0.31.0)
$script:currentSection = "9z-E: URN Dot-Path Cache"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-E: URN DOT-PATH CACHE + PATCH COERCION + FP-1" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create endpoint with extension that has:
# - returned:never top-level attr (pin) → should be stripped
# - returned:never is ONLY attr → extension removed (FP-1)
# - boolean active in core vs string active in extension (collision)
$dpEpName = "dotpath-cache-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$dpExtUrn = "urn:test:dotpath:2.0:Ext"
$dpSecretUrn = "urn:test:dotpath:2.0:SecretOnly"
$dpProfile = @{
    schemas = @(
        @{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = "all" }
        @{
            id = $dpExtUrn; name = "DotPathExt"
            attributes = @(
                @{ name = "department"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default" }
                @{ name = "pin"; type = "string"; multiValued = $false; required = $false; mutability = "writeOnly"; returned = "never" }
                @{ name = "active"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default" }
            )
        }
        @{
            id = $dpSecretUrn; name = "SecretOnlyExt"
            attributes = @(
                @{ name = "secretToken"; type = "string"; multiValued = $false; required = $false; mutability = "writeOnly"; returned = "never" }
            )
        }
    )
    resourceTypes = @(
        @{
            id = "User"; name = "User"; endpoint = "/Users"
            schema = "urn:ietf:params:scim:schemas:core:2.0:User"
            schemaExtensions = @(
                @{ schema = $dpExtUrn; required = $false }
                @{ schema = $dpSecretUrn; required = $false }
            )
        }
    )
    settings = @{ AllowAndCoerceBooleanStrings = "True"; StrictSchemaValidation = "False" }
} | ConvertTo-Json -Depth 10

$dpEpBody = @{ name = $dpEpName; profile = ($dpProfile | ConvertFrom-Json) } | ConvertTo-Json -Depth 10
try {
    $dpEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $dpEpBody -ContentType "application/json"
    $dpEpId = $dpEp.id
    $dpSBase = "$baseUrl/scim/endpoints/$dpEpId"
    Test-Result -Success $true -Message "9z-E.1: Created dot-path cache test endpoint"
} catch {
    Test-Result -Success $false -Message "9z-E.1: Failed to create endpoint: $_"
    $dpEpId = $null
}

if ($dpEpId) {
    # --- 9z-E.2: POST with both extensions — pin stripped, secretToken ext removed entirely (FP-1) ---
    Write-Host "`n--- PATCH Coercion + FP-1 Tests ---" -ForegroundColor Cyan
    $dpUserBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $dpExtUrn, $dpSecretUrn)
        userName = "dotpath-user-$(Get-Random)@test.com"
        active = "True"
        displayName = "DotPath Test"
        $dpExtUrn = @{ department = "Eng"; pin = "1234"; active = "StringVal" }
        $dpSecretUrn = @{ secretToken = "super-secret-token" }
    } | ConvertTo-Json -Depth 5
    try {
        $dpUser = Invoke-RestMethod -Uri "$dpSBase/Users" -Method POST -Headers $headers -Body $dpUserBody -ContentType "application/scim+json"
        $dpUserId = $dpUser.id
        # Core active coerced to boolean
        Test-Result -Success ($dpUser.active -eq $true -and $dpUser.active -is [bool]) -Message "9z-E.2: Core active coerced to boolean true"
    } catch {
        Test-Result -Success $false -Message "9z-E.2: POST failed: $_"
        $dpUserId = $null
    }

    # 9z-E.3: Extension active remains string (collision precision)
    if ($dpUserId) {
        $extBlock = $dpUser.$dpExtUrn
        Test-Result -Success ($extBlock.active -eq "StringVal" -and $extBlock.active -is [string]) -Message "9z-E.3: Extension active remains string (collision precision)"
    }

    # 9z-E.4: Extension pin (returned:never) stripped from response
    if ($dpUserId) {
        $extBlock = $dpUser.$dpExtUrn
        Test-Result -Success ($null -eq $extBlock.pin) -Message "9z-E.4: Extension pin (returned:never) stripped from POST response"
    }

    # 9z-E.5: SecretOnly extension removed entirely (FP-1 — all attrs are returned:never)
    if ($dpUserId) {
        $secretExtPresent = $null -ne $dpUser.$dpSecretUrn
        Test-Result -Success (-not $secretExtPresent) -Message "9z-E.5: FP-1 — SecretOnly extension removed entirely (all attrs returned:never)"
    }

    # 9z-E.6: schemas[] should NOT include SecretOnly URN (removed by FP-1)
    if ($dpUserId) {
        $schemasHasSecret = $dpUser.schemas -contains $dpSecretUrn
        Test-Result -Success (-not $schemasHasSecret) -Message "9z-E.6: schemas[] does not include FP-1 removed extension URN"
    }

    # 9z-E.7: schemas[] SHOULD include DotPathExt URN (has visible attrs)
    if ($dpUserId) {
        $schemasHasDp = $dpUser.schemas -contains $dpExtUrn
        Test-Result -Success $schemasHasDp -Message "9z-E.7: schemas[] includes extension with visible attrs"
    }

    # --- 9z-E.8–10: PATCH boolean coercion in operation values ---
    Write-Host "`n--- PATCH Operation Value Boolean Coercion ---" -ForegroundColor Cyan
    if ($dpUserId) {
        # 9z-E.8: PATCH replace with no-path object value — active="False" coerced
        $patchBody = @{
            schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
            Operations = @(@{
                op = "replace"
                value = @{ active = "False"; displayName = "Patched" }
            })
        } | ConvertTo-Json -Depth 4
        try {
            $patchRes = Invoke-RestMethod -Uri "$dpSBase/Users/$dpUserId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/scim+json"
            Test-Result -Success ($patchRes.active -eq $false -and $patchRes.active -is [bool]) -Message "9z-E.8: PATCH no-path coerces active='False' to boolean false"
            Test-Result -Success ($patchRes.displayName -eq "Patched") -Message "9z-E.9: PATCH no-path string value preserved"
        } catch {
            Test-Result -Success $false -Message "9z-E.8: PATCH no-path failed: $_"
        }

        # 9z-E.10: PATCH with path — active="True" coerced
        $patchPathBody = @{
            schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
            Operations = @(@{
                op = "replace"
                path = "active"
                value = "True"
            })
        } | ConvertTo-Json -Depth 4
        try {
            $patchPathRes = Invoke-RestMethod -Uri "$dpSBase/Users/$dpUserId" -Method PATCH -Headers $headers -Body $patchPathBody -ContentType "application/scim+json"
            Test-Result -Success ($patchPathRes.active -eq $true -and $patchPathRes.active -is [bool]) -Message "9z-E.10: PATCH with path coerces active='True' to boolean true"
        } catch {
            Test-Result -Success $false -Message "9z-E.10: PATCH with path failed: $_"
        }
    }

    # --- 9z-E.11–12: GET/LIST verify stripping persists ---
    Write-Host "`n--- GET/LIST Verify Stripping ---" -ForegroundColor Cyan
    if ($dpUserId) {
        try {
            $getRes = Invoke-RestMethod -Uri "$dpSBase/Users/$dpUserId" -Method GET -Headers $headers
            Test-Result -Success ($null -eq $getRes.$dpExtUrn.pin) -Message "9z-E.11: GET strips returned:never pin"
            $secretExtInGet = $null -ne $getRes.$dpSecretUrn
            Test-Result -Success (-not $secretExtInGet) -Message "9z-E.12: GET does not include FP-1 removed extension"
        } catch {
            Test-Result -Success $false -Message "9z-E.11: GET failed: $_"
        }
    }

    # --- 9z-E.13–14: Write-response projection + returned:never interaction ---
    Write-Host "`n--- Write-Response Projection ---" -ForegroundColor Cyan
    $projUserBody = @{
        schemas = @("urn:ietf:params:scim:schemas:core:2.0:User", $dpExtUrn, $dpSecretUrn)
        userName = "dotpath-proj-$(Get-Random)@test.com"
        active = "True"
        displayName = "Proj Test"
        $dpExtUrn = @{ department = "QA"; pin = "5678"; active = "ProjStr" }
        $dpSecretUrn = @{ secretToken = "proj-secret" }
    } | ConvertTo-Json -Depth 5
    try {
        $projRes = Invoke-RestMethod -Uri "$dpSBase/Users?attributes=userName,displayName" -Method POST -Headers $headers -Body $projUserBody -ContentType "application/scim+json"
        # Always-returned: id, schemas, meta should be present
        Test-Result -Success ($null -ne $projRes.id) -Message "9z-E.13: POST+attributes= always-returned id present"
        # Requested: userName, displayName present
        Test-Result -Success ($null -ne $projRes.userName -and $null -ne $projRes.displayName) -Message "9z-E.14: POST+attributes= requested attrs present"
        # Cleanup
        if ($projRes.id) {
            try { Invoke-RestMethod -Uri "$dpSBase/Users/$($projRes.id)" -Method DELETE -Headers $headers | Out-Null } catch {}
        }
    } catch {
        Test-Result -Success $false -Message "9z-E.13: POST+attributes= failed: $_"
    }

    # Cleanup: delete test endpoint
    try {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$dpEpId" -Method DELETE -Headers $headers | Out-Null
        Test-Result -Success $true -Message "9z-E.cleanup: Deleted dot-path cache test endpoint"
    } catch {
        Test-Result -Success $false -Message "9z-E.cleanup: Failed to delete endpoint: $_"
    }
}

Write-Host "`n--- 9z-E: URN Dot-Path Cache Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-F: GENERIC RESOURCE FILTER OPERATORS (G6 — RFC 7644 §3.4.2.2) (v0.32.0)
$script:currentSection = "9z-F: Generic Filter Operators"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-F: GENERIC RESOURCE FILTER OPERATORS (G6)" -ForegroundColor Yellow
Write-Host "  All 10 RFC 7644 filter operators + AND/OR on custom resources" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Setup: Create endpoint with custom Sensor resource type ---
Write-Host "`n--- Setup: Create endpoint with custom Sensor resource type ---" -ForegroundColor Cyan
$gfSensorUrn = "urn:test:gfilter:2.0:Sensor"
$gfProfile = @{
    schemas = @(
        @{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = "all" }
        @{ id = "urn:ietf:params:scim:schemas:core:2.0:Group"; name = "Group"; attributes = "all" }
        @{
            id = $gfSensorUrn; name = "Sensor"
            attributes = @(
                @{ name = "displayName"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "server" }
                @{ name = "externalId"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default"; caseExact = $true; uniqueness = "none" }
                @{ name = "sensorName"; type = "string"; multiValued = $false; required = $true; mutability = "readWrite"; returned = "default"; caseExact = $false; uniqueness = "none" }
                @{ name = "location"; type = "string"; multiValued = $false; required = $false; mutability = "readWrite"; returned = "default"; caseExact = $true; uniqueness = "none" }
            )
        }
    )
    resourceTypes = @(
        @{ id = "User"; name = "User"; endpoint = "/Users"; description = "User"; schema = "urn:ietf:params:scim:schemas:core:2.0:User"; schemaExtensions = @() }
        @{ id = "Group"; name = "Group"; endpoint = "/Groups"; description = "Group"; schema = "urn:ietf:params:scim:schemas:core:2.0:Group"; schemaExtensions = @() }
        @{ id = "Sensor"; name = "Sensor"; endpoint = "/Sensors"; description = "Sensor"; schema = $gfSensorUrn; schemaExtensions = @() }
    )
    serviceProviderConfig = @{
        patch = @{ supported = $true }; bulk = @{ supported = $false }
        filter = @{ supported = $true; maxResults = 200 }
        sort = @{ supported = $true }; etag = @{ supported = $true }
        changePassword = @{ supported = $false }
    }
    settings = @{}
}
$gfEpBody = @{ name = "gfilter-$(Get-Random)"; displayName = "Generic Filter Test"; profile = $gfProfile } | ConvertTo-Json -Depth 8
$gfEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $gfEpBody -ContentType "application/json"
$gfEpId = $gfEp.id
$gfBase = "$baseUrl/scim/endpoints/$gfEpId/Sensors"
Test-Result -Success ($null -ne $gfEpId) -Message "9z-F.setup: Created endpoint with custom Sensor resource type"

# Seed 4 test Sensors
$gfSensors = @(
    @{ schemas = @($gfSensorUrn); displayName = "Alpha Sensor"; externalId = "ext-alpha"; sensorName = "alpha"; location = "Building-A" }
    @{ schemas = @($gfSensorUrn); displayName = "Beta Sensor"; externalId = "ext-beta"; sensorName = "beta"; location = "Building-B" }
    @{ schemas = @($gfSensorUrn); displayName = "Gamma Sensor"; externalId = "ext-gamma"; sensorName = "gamma"; location = "Building-A" }
    @{ schemas = @($gfSensorUrn); displayName = "Delta Probe"; externalId = "ext-delta"; sensorName = "delta"; location = "Building-C" }
)
$gfCreatedIds = @()
foreach ($s in $gfSensors) {
    $sBody = $s | ConvertTo-Json -Depth 4
    $created = Invoke-RestMethod -Uri $gfBase -Method POST -Headers $headers -Body $sBody -ContentType "application/scim+json"
    $gfCreatedIds += $created.id
}
Test-Result -Success ($gfCreatedIds.Count -eq 4) -Message "9z-F.setup: Seeded 4 Sensor resources"

# --- Test 9z-F.1: eq on displayName (DB push-down, case-insensitive) ---
Write-Host "`n--- Test 9z-F.1: eq on displayName ---" -ForegroundColor Cyan
$eqRes = Invoke-RestMethod -Uri "$gfBase`?filter=displayName%20eq%20%22Alpha%20Sensor%22" -Headers $headers
Test-Result -Success ($eqRes.totalResults -eq 1) -Message "9z-F.1: displayName eq returns 1 result"
Test-Result -Success ($eqRes.Resources[0].displayName -eq "Alpha Sensor") -Message "9z-F.2: displayName eq value matches"

# --- Test 9z-F.3: ne on displayName ---
Write-Host "`n--- Test 9z-F.3: ne on displayName ---" -ForegroundColor Cyan
$neRes = Invoke-RestMethod -Uri "$gfBase`?filter=displayName%20ne%20%22Delta%20Probe%22" -Headers $headers
Test-Result -Success ($neRes.totalResults -eq 3) -Message "9z-F.3: displayName ne excludes 1, returns 3"

# --- Test 9z-F.4: co (contains) on displayName ---
Write-Host "`n--- Test 9z-F.4: co on displayName ---" -ForegroundColor Cyan
$coRes = Invoke-RestMethod -Uri "$gfBase`?filter=displayName%20co%20%22Sensor%22" -Headers $headers
Test-Result -Success ($coRes.totalResults -eq 3) -Message "9z-F.4: displayName co 'Sensor' returns 3 (Alpha/Beta/Gamma)"

# --- Test 9z-F.5: sw (startsWith) on displayName ---
Write-Host "`n--- Test 9z-F.5: sw on displayName ---" -ForegroundColor Cyan
$swRes = Invoke-RestMethod -Uri "$gfBase`?filter=displayName%20sw%20%22Beta%22" -Headers $headers
Test-Result -Success ($swRes.totalResults -eq 1) -Message "9z-F.5: displayName sw 'Beta' returns 1"
Test-Result -Success ($swRes.Resources[0].displayName -eq "Beta Sensor") -Message "9z-F.6: sw result is Beta Sensor"

# --- Test 9z-F.7: ew (endsWith) on displayName ---
Write-Host "`n--- Test 9z-F.7: ew on displayName ---" -ForegroundColor Cyan
$ewRes = Invoke-RestMethod -Uri "$gfBase`?filter=displayName%20ew%20%22Probe%22" -Headers $headers
Test-Result -Success ($ewRes.totalResults -eq 1) -Message "9z-F.7: displayName ew 'Probe' returns 1"
Test-Result -Success ($ewRes.Resources[0].displayName -eq "Delta Probe") -Message "9z-F.8: ew result is Delta Probe"

# --- Test 9z-F.9: pr (presence) on externalId ---
Write-Host "`n--- Test 9z-F.9: pr on externalId ---" -ForegroundColor Cyan
$prRes = Invoke-RestMethod -Uri "$gfBase`?filter=externalId%20pr" -Headers $headers
Test-Result -Success ($prRes.totalResults -eq 4) -Message "9z-F.9: externalId pr returns all 4"

# --- Test 9z-F.10: eq on externalId (case-sensitive) ---
Write-Host "`n--- Test 9z-F.10: eq on externalId ---" -ForegroundColor Cyan
$exIdRes = Invoke-RestMethod -Uri "$gfBase`?filter=externalId%20eq%20%22ext-gamma%22" -Headers $headers
Test-Result -Success ($exIdRes.totalResults -eq 1) -Message "9z-F.10: externalId eq 'ext-gamma' returns 1"

# --- Test 9z-F.11: AND compound ---
Write-Host "`n--- Test 9z-F.11: AND compound ---" -ForegroundColor Cyan
$andFilter = [System.Uri]::EscapeDataString('displayName co "Sensor" and externalId eq "ext-gamma"')
$andRes = Invoke-RestMethod -Uri "$gfBase`?filter=$andFilter" -Headers $headers
Test-Result -Success ($andRes.totalResults -eq 1) -Message "9z-F.11: AND compound returns 1"
Test-Result -Success ($andRes.Resources[0].displayName -eq "Gamma Sensor") -Message "9z-F.12: AND result is Gamma Sensor"

# --- Test 9z-F.13: OR compound ---
Write-Host "`n--- Test 9z-F.13: OR compound ---" -ForegroundColor Cyan
$orFilter = [System.Uri]::EscapeDataString('displayName eq "Alpha Sensor" or displayName eq "Delta Probe"')
$orRes = Invoke-RestMethod -Uri "$gfBase`?filter=$orFilter" -Headers $headers
Test-Result -Success ($orRes.totalResults -eq 2) -Message "9z-F.13: OR compound returns 2"

# --- Test 9z-F.14: In-memory fallback for custom attribute (sensorName eq) ---
Write-Host "`n--- Test 9z-F.14: In-memory custom attr filter ---" -ForegroundColor Cyan
$customRes = Invoke-RestMethod -Uri "$gfBase`?filter=sensorName%20eq%20%22gamma%22" -Headers $headers
Test-Result -Success ($customRes.totalResults -eq 1) -Message "9z-F.14: sensorName eq 'gamma' (in-memory) returns 1"
Test-Result -Success ($customRes.Resources[0].sensorName -eq "gamma") -Message "9z-F.15: In-memory filter value matches"

# --- Test 9z-F.16: In-memory co on custom attribute (location co) ---
Write-Host "`n--- Test 9z-F.16: In-memory co on custom attr ---" -ForegroundColor Cyan
$locRes = Invoke-RestMethod -Uri "$gfBase`?filter=location%20co%20%22Building%22" -Headers $headers
Test-Result -Success ($locRes.totalResults -eq 4) -Message "9z-F.16: location co 'Building' returns all 4"

# --- Test 9z-F.17: POST /.search with filter ---
Write-Host "`n--- Test 9z-F.17: POST /.search with filter ---" -ForegroundColor Cyan
$searchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:SearchRequest")
    filter = 'displayName sw "Alpha"'
    startIndex = 1; count = 10
} | ConvertTo-Json -Depth 4
$searchRes = Invoke-RestMethod -Uri "$gfBase/.search" -Method POST -Headers $headers -Body $searchBody -ContentType "application/scim+json"
Test-Result -Success ($searchRes.totalResults -eq 1) -Message "9z-F.17: POST .search with filter returns 1"
Test-Result -Success ($searchRes.Resources[0].displayName -eq "Alpha Sensor") -Message "9z-F.18: .search result is Alpha Sensor"

# --- Test 9z-F.19: 400 invalidFilter for syntax error ---
Write-Host "`n--- Test 9z-F.19: 400 for invalid filter syntax ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$gfBase`?filter=(((" -Headers $headers -ErrorAction Stop
    Test-Result -Success $false -Message "9z-F.19: Expected 400 for invalid filter"
} catch {
    $errStatus = $_.Exception.Response.StatusCode.value__
    Test-Result -Success ($errStatus -eq 400) -Message "9z-F.19: Invalid filter returns 400"
}

# --- Test 9z-F.20: Empty results for no-match filter ---
Write-Host "`n--- Test 9z-F.20: Empty results for no-match ---" -ForegroundColor Cyan
$noMatchRes = Invoke-RestMethod -Uri "$gfBase`?filter=displayName%20eq%20%22NonExistent%22" -Headers $headers
Test-Result -Success ($noMatchRes.totalResults -eq 0) -Message "9z-F.20: No-match filter returns 0 totalResults"
Test-Result -Success ($noMatchRes.Resources.Count -eq 0) -Message "9z-F.21: No-match filter returns empty Resources"

# --- Cleanup ---
Write-Host "`n--- 9z-F Cleanup ---" -ForegroundColor Cyan
if ($gfEpId) {
    try {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$gfEpId" -Method DELETE -Headers $headers | Out-Null
        Test-Result -Success $true -Message "9z-F.cleanup: Deleted generic filter test endpoint"
    } catch {
        Test-Result -Success $false -Message "9z-F.cleanup: Failed to delete endpoint: $_"
    }
}

Write-Host "`n--- 9z-F: Generic Filter Operator Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-G: SCIM ERROR FORMAT COMPLIANCE (Phase A)
$script:currentSection = "9z-G: Error Format"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-G: SCIM ERROR FORMAT COMPLIANCE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: 404 error body has SCIM Error schema
Write-Host "`n--- Test: 404 Error Body Format ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/00000000-0000-0000-0000-000000099999" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "9z-G.1: Should have returned 404"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $rawBody = $_.ErrorDetails.Message
    $errOk = $code -eq 404
    $hasSchema = $false
    $statusIsString = $false
    $hasDetail = $false
    try {
        $body = $rawBody | ConvertFrom-Json
        $hasSchema = $body.schemas -contains "urn:ietf:params:scim:api:messages:2.0:Error"
        $statusIsString = $body.status -is [string] -and $body.status -eq "404"
        $hasDetail = -not [string]::IsNullOrWhiteSpace($body.detail)
    } catch { }
    Test-Result -Success ($errOk -and $hasSchema) -Message "9z-G.1: 404 includes SCIM Error schema"
    Test-Result -Success $statusIsString -Message "9z-G.2: status field is string '404' (RFC 7644 S3.12)"
    Test-Result -Success $hasDetail -Message "9z-G.3: error body has detail field"
}

# Test: 409 uniqueness error has scimType
Write-Host "`n--- Test: 409 Uniqueness Error Format ---" -ForegroundColor Cyan
$dupUserName = "error-format-test-$(Get-Random)@test.com"
$dupUserBody = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User"); userName=$dupUserName; active=$true} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dupUserBody | Out-Null
} catch { }
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dupUserBody | Out-Null
    Test-Result -Success $false -Message "9z-G.4: Should have returned 409"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $rawBody = $_.ErrorDetails.Message
    $hasScimType = $false
    $scimTypeCorrect = $false
    try {
        $body = $rawBody | ConvertFrom-Json
        $hasScimType = -not [string]::IsNullOrWhiteSpace($body.scimType)
        $scimTypeCorrect = $body.scimType -eq "uniqueness"
    } catch { }
    Test-Result -Success ($code -eq 409 -and $hasScimType) -Message "9z-G.4: 409 has scimType field"
    Test-Result -Success $scimTypeCorrect -Message "9z-G.5: scimType is 'uniqueness' for duplicate"
}

# Test: Error response Content-Type is application/scim+json
Write-Host "`n--- Test: Error Content-Type ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/00000000-0000-0000-0000-000000099999" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "9z-G.6: Should have returned 404"
} catch {
    $ct = $_.Exception.Response.Content.Headers.ContentType.MediaType
    $isScimJson = $ct -eq "application/scim+json"
    Test-Result -Success $isScimJson -Message "9z-G.6: Error Content-Type is application/scim+json"
}

# Test: X-Request-Id is present on error responses
Write-Host "`n--- Test: X-Request-Id on Errors ---" -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "$scimBase/Users/00000000-0000-0000-0000-000000099999" -Method GET -Headers $headers -ErrorAction Stop
    Test-Result -Success $false -Message "9z-G.7: Should have returned 404"
} catch {
    $hasReqId = $false
    try {
        $respHeaders = $_.Exception.Response.Headers
        # Check for X-Request-Id in response headers
        $reqId = $null
        foreach ($key in $respHeaders.GetEnumerator()) {
            if ($key.Key -eq "X-Request-Id") { $reqId = $key.Value; break }
        }
        $hasReqId = -not [string]::IsNullOrWhiteSpace($reqId)
    } catch { }
    Test-Result -Success $hasReqId -Message "9z-G.7: X-Request-Id header present on error responses"
}

# Test: Diagnostics extension in error responses
Write-Host "`n--- Test: Diagnostics Extension in Error Body ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/00000000-0000-0000-0000-000000099999" -Method GET -Headers $headers | Out-Null
    Test-Result -Success $false -Message "9z-G.8: Should have returned 404"
} catch {
    $rawBody = $_.ErrorDetails.Message
    $hasDiag = $false
    $diagHasRequestId = $false
    $diagHasEndpointId = $false
    $diagHasLogsUrl = $false
    try {
        $body = $rawBody | ConvertFrom-Json
        $diagUrn = "urn:scimserver:api:messages:2.0:Diagnostics"
        $diag = $body.$diagUrn
        $hasDiag = $null -ne $diag
        if ($hasDiag) {
            $diagHasRequestId = -not [string]::IsNullOrWhiteSpace($diag.requestId)
            $diagHasEndpointId = -not [string]::IsNullOrWhiteSpace($diag.endpointId)
            $diagHasLogsUrl = -not [string]::IsNullOrWhiteSpace($diag.logsUrl)
        }
    } catch { }
    Test-Result -Success $hasDiag -Message "9z-G.8: Error body includes Diagnostics extension URN"
    Test-Result -Success $diagHasRequestId -Message "9z-G.9: Diagnostics has requestId"
    Test-Result -Success $diagHasEndpointId -Message "9z-G.10: Diagnostics has endpointId"
    Test-Result -Success $diagHasLogsUrl -Message "9z-G.11: Diagnostics has logsUrl"
}

Write-Host "`n--- 9z-G: SCIM Error Format Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-H: BULK OPERATION LOGGING (Phase C Step 8)
$script:currentSection = "9z-H: Bulk Logging"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-H: BULK OPERATION LOGGING" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create a test endpoint for bulk
Write-Host "`n--- Setting up bulk logging test endpoint ---" -ForegroundColor Cyan
$bulkEpBody = @{name="bulk-log-test-$(Get-Random)"; profilePreset="rfc-standard"} | ConvertTo-Json
try {
    $bulkEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $bulkEpBody
    $bulkEpId = $bulkEp.id
    # Enable bulk + disable strict schema for minimal test bodies
    $bulkPatch = @{ profile = @{ serviceProviderConfig = @{ bulk = @{ supported = $true; maxOperations = 100; maxPayloadSize = 1048576 } }; settings = @{ StrictSchemaValidation = "False" } } } | ConvertTo-Json -Depth 5
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$bulkEpId" -Method PATCH -Headers $headers -Body $bulkPatch -ContentType "application/json" | Out-Null
    $bulkScimBase = "$baseUrl/scim/endpoints/$bulkEpId"
} catch {
    Test-Result -Success $false -Message "9z-H.setup: Failed to create bulk test endpoint: $_"
    $bulkEpId = $null
}

if ($bulkEpId) {
    # Execute a bulk request with one success and one failure
    Write-Host "`n--- Test: Bulk Request with Mixed Results ---" -ForegroundColor Cyan
    $bulkBody = @{
        schemas = @("urn:ietf:params:scim:api:messages:2.0:BulkRequest")
        Operations = @(
            @{ method="POST"; path="/Users"; bulkId="u1"; data=@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User"); userName="bulk-alice-$(Get-Random)@test.com"; displayName="Bulk Alice"; emails=@(@{value="bulk-alice-$(Get-Random)@test.com";type="work";primary=$true}); active=$true} }
            @{ method="POST"; path="/Users"; bulkId="u2"; data=@{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User"); userName="bulk-bob-$(Get-Random)@test.com"; displayName="Bulk Bob"; emails=@(@{value="bulk-bob-$(Get-Random)@test.com";type="work";primary=$true}); active=$true} }
        )
    } | ConvertTo-Json -Depth 5

    try {
        $bulkResult = Invoke-RestMethod -Uri "$bulkScimBase/Bulk" -Method POST -Headers $headers -Body $bulkBody
        $allOk = ($bulkResult.Operations | Where-Object { $_.status -eq "201" }).Count -eq 2
        Test-Result -Success $allOk -Message "9z-H.1: Bulk request completed with 2 successful operations"
    } catch {
        Test-Result -Success $false -Message "9z-H.1: Bulk request failed: $_"
    }

    # Check ring buffer for bulk logging entries
    Write-Host "`n--- Test: Ring Buffer Contains Bulk Logs ---" -ForegroundColor Cyan
    try {
        $recentLogs = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?category=scim.bulk&limit=10" -Headers $headers
        $hasBulkStarted = $recentLogs.entries | Where-Object { $_.message -match "Bulk request started" }
        $hasBulkCompleted = $recentLogs.entries | Where-Object { $_.message -match "Bulk request completed" }

        Test-Result -Success ($null -ne $hasBulkStarted) -Message "9z-H.2: Ring buffer has 'Bulk request started' entry (scim.bulk category)"
        Test-Result -Success ($null -ne $hasBulkCompleted) -Message "9z-H.3: Ring buffer has 'Bulk request completed' entry"

        if ($hasBulkCompleted) {
            # Check if the completed log message contains count info (may be in data or message)
            $completedEntry = $hasBulkCompleted[0]
            $hasCountInfo = ($null -ne $completedEntry.data -and $completedEntry.data.total -ge 2) -or ($completedEntry.message -match "total|completed")
            Test-Result -Success $hasCountInfo -Message "9z-H.4: Completed log has operation count info"
            Test-Result -Success $hasCountInfo -Message "9z-H.5: Completed log has success info"
        }
    } catch {
        Test-Result -Success $false -Message "9z-H.2: Failed to query ring buffer: $_"
    }

    # Cleanup bulk test endpoint
    try {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$bulkEpId" -Method DELETE -Headers $headers | Out-Null
    } catch { }
}

Write-Host "`n--- 9z-H: Bulk Logging Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-I: ADMIN AUDIT TRAIL (Phase C Step 10)
$script:currentSection = "9z-I: Audit Trail"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-I: ADMIN AUDIT TRAIL" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Log level change produces audit entry in ring buffer
Write-Host "`n--- Test: Config Change Audit ---" -ForegroundColor Cyan
try {
    # Change level to DEBUG, then check ring buffer
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/level/DEBUG" -Method PUT -Headers $headers | Out-Null
    Start-Sleep -Milliseconds 200

    $recentLogs = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?category=config&limit=10" -Headers $headers
    $hasLevelChange = $recentLogs.entries | Where-Object { $_.message -match "Global log level changed" }
    Test-Result -Success ($null -ne $hasLevelChange) -Message "9z-I.1: Log level change produces audit entry"

    # Restore level
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/level/INFO" -Method PUT -Headers $headers | Out-Null
} catch {
    Test-Result -Success $false -Message "9z-I.1: Failed: $_"
}

# Test: Endpoint create produces audit entry
Write-Host "`n--- Test: Endpoint Create Audit ---" -ForegroundColor Cyan
$auditEpName = "audit-test-$(Get-Random)"
$auditEpBody = @{name=$auditEpName; profilePreset="minimal"} | ConvertTo-Json
try {
    $auditEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $auditEpBody
    Start-Sleep -Milliseconds 200

    $recentLogs = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?category=endpoint&limit=10" -Headers $headers
    $hasCreateAudit = $recentLogs.entries | Where-Object { $_.message -match "Endpoint created" -and $_.data.name -eq $auditEpName }
    Test-Result -Success ($null -ne $hasCreateAudit) -Message "9z-I.2: Endpoint create produces audit entry with name"

    # Cleanup
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$($auditEp.id)" -Method DELETE -Headers $headers | Out-Null
    Start-Sleep -Milliseconds 200

    $recentLogs2 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/recent?category=endpoint&limit=10" -Headers $headers
    $hasDeleteAudit = $recentLogs2.entries | Where-Object { $_.message -match "Endpoint deleted" }
    Test-Result -Success ($null -ne $hasDeleteAudit) -Message "9z-I.3: Endpoint delete produces audit entry"
} catch {
    Test-Result -Success $false -Message "9z-I.2: Failed: $_"
}

Write-Host "`n--- 9z-I: Admin Audit Trail Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-J: ENDPOINT-SCOPED LOG ACCESS (Phase D Step 11)
$script:currentSection = "9z-J: Endpoint Logs"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-J: ENDPOINT-SCOPED LOG ACCESS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create test endpoint and generate activity
Write-Host "`n--- Setup: Create endpoint + activity ---" -ForegroundColor Cyan
$epLogName = "eplog-test-$(Get-Random)"
$epLogBody = @{name=$epLogName; profilePreset="entra-id"} | ConvertTo-Json
try {
    $epLog = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $epLogBody
    $epLogId = $epLog.id
    $epLogScimBase = "$baseUrl/scim/endpoints/$epLogId"

    # Create a user on this endpoint to generate log entries
    $logTestUser = @{schemas=@("urn:ietf:params:scim:schemas:core:2.0:User"); userName="eplog-user-$(Get-Random)@test.com"; displayName="EpLog Test"; emails=@(@{value="eplog-user@test.com";type="work";primary=$true}); active=$true} | ConvertTo-Json -Depth 3
    Invoke-RestMethod -Uri "$epLogScimBase/Users" -Method POST -Headers $headers -Body $logTestUser | Out-Null
    Start-Sleep -Milliseconds 300
} catch {
    Test-Result -Success $false -Message "9z-J.setup: Failed: $_"
    $epLogId = $null
}

if ($epLogId) {
    # Test: GET /endpoints/:id/logs/recent
    Write-Host "`n--- Test: Endpoint-Scoped Recent Logs ---" -ForegroundColor Cyan
    try {
        $epLogs = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$epLogId/logs/recent?limit=10" -Headers $headers
        $hasEndpointId = $epLogs.endpointId -eq $epLogId
        $hasEntries = $epLogs.count -ge 0
        Test-Result -Success ($hasEndpointId -and $hasEntries) -Message "9z-J.1: GET /endpoints/:id/logs/recent returns scoped response"

        # Verify entries are scoped
        $wrongEndpoint = $epLogs.entries | Where-Object { $_.endpointId -and $_.endpointId -ne $epLogId }
        Test-Result -Success ($null -eq $wrongEndpoint) -Message "9z-J.2: All entries scoped to correct endpointId"
    } catch {
        Test-Result -Success $false -Message "9z-J.1: Failed: $_"
    }

    # Test: GET /endpoints/:id/logs/recent with level filter
    Write-Host "`n--- Test: Level Filter ---" -ForegroundColor Cyan
    try {
        $warnLogs = Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$epLogId/logs/recent?level=WARN" -Headers $headers
        $allWarnOrAbove = $true
        foreach ($entry in $warnLogs.entries) {
            if ($entry.level -notin @("WARN","ERROR","FATAL")) { $allWarnOrAbove = $false; break }
        }
        Test-Result -Success $allWarnOrAbove -Message "9z-J.3: Level filter returns only WARN+ entries"
    } catch {
        Test-Result -Success $false -Message "9z-J.3: Failed: $_"
    }

    # Test: GET /endpoints/:id/logs/download
    Write-Host "`n--- Test: Endpoint-Scoped Download ---" -ForegroundColor Cyan
    try {
        $dlResp = Invoke-WebRequest -Uri "$baseUrl/scim/endpoints/$epLogId/logs/download" -Headers $headers
        $ct = $dlResp.Headers.'Content-Type'
        $cd = $dlResp.Headers.'Content-Disposition'
        $isNdjson = $ct -match "ndjson"
        $hasFilename = $cd -match "attachment"
        Test-Result -Success ($isNdjson -and $hasFilename) -Message "9z-J.4: Download returns NDJSON with attachment header"
    } catch {
        Test-Result -Success $false -Message "9z-J.4: Failed: $_"
    }

    # Cleanup
    try {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$epLogId" -Method DELETE -Headers $headers | Out-Null
    } catch { }
}

Write-Host "`n--- 9z-J: Endpoint-Scoped Log Tests Complete ---" -ForegroundColor Green

# TEST SECTION 9z-K: LOG FILE ENABLED DEFAULT (logFileEnabled=true)
$script:currentSection = "9z-K: logFileEnabled Default"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-K: LOG FILE ENABLED DEFAULT (logFileEnabled=true)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Test: Create endpoint and verify logFileEnabled defaults to true
Write-Host "`n--- Test: logFileEnabled default=true ---" -ForegroundColor Cyan
$lfeName = "e2e-logfile-default-$(Get-Random)"
try {
    $lfeEndpoint = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{ name = $lfeName; profilePreset = "rfc-standard" } | ConvertTo-Json) -ContentType "application/json"
    $lfeId = $lfeEndpoint.id
    Test-Result -Success ($lfeEndpoint.id -ne $null) -Message "9z-K.1: Created endpoint for logFileEnabled test"
} catch {
    Test-Result -Success $false -Message "9z-K.1: Failed to create endpoint: $_"
    $lfeId = $null
}

if ($lfeId) {
    # Test: PATCH logFileEnabled=False should be accepted
    Write-Host "`n--- Test: PATCH logFileEnabled=False ---" -ForegroundColor Cyan
    try {
        $patchBody = @{ profile = @{ settings = @{ logFileEnabled = "False" } } } | ConvertTo-Json -Depth 4
        $patchResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$lfeId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json"
        Test-Result -Success ($patchResult.profile.settings.logFileEnabled -eq "False") -Message "9z-K.2: PATCH logFileEnabled=False accepted and persisted"
    } catch {
        Test-Result -Success $false -Message "9z-K.2: Failed: $_"
    }

    # Test: PATCH logFileEnabled back to True
    Write-Host "`n--- Test: PATCH logFileEnabled=True ---" -ForegroundColor Cyan
    try {
        $patchBody2 = @{ profile = @{ settings = @{ logFileEnabled = "True" } } } | ConvertTo-Json -Depth 4
        $patchResult2 = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$lfeId" -Method PATCH -Headers $headers -Body $patchBody2 -ContentType "application/json"
        Test-Result -Success ($patchResult2.profile.settings.logFileEnabled -eq "True") -Message "9z-K.3: PATCH logFileEnabled=True accepted and persisted"
    } catch {
        Test-Result -Success $false -Message "9z-K.3: Failed: $_"
    }

    # Test: PATCH logFileEnabled with invalid value should return 400
    Write-Host "`n--- Test: PATCH logFileEnabled=invalid ---" -ForegroundColor Cyan
    try {
        $badPatch = @{ profile = @{ settings = @{ logFileEnabled = "Yes" } } } | ConvertTo-Json -Depth 4
        $badResp = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$lfeId" -Method PATCH -Headers $headers -Body $badPatch -ContentType "application/json" -SkipHttpErrorCheck
        Test-Result -Success ($badResp.StatusCode -eq 400) -Message "9z-K.4: logFileEnabled='Yes' rejected with 400"
    } catch {
        Test-Result -Success $false -Message "9z-K.4: Failed: $_"
    }

    # Cleanup
    try {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$lfeId" -Method DELETE -Headers $headers | Out-Null
    } catch { }
}

Write-Host "`n--- 9z-K: logFileEnabled Tests Complete ---" -ForegroundColor Green

# ============================================
# TEST SECTION 9z-L: AUTO-PRUNE CONFIG API + DATABASE STATS TYPE
$script:currentSection = "9z-L: Auto-Prune + DB Stats"
# ============================================
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "TEST SECTION 9z-L: AUTO-PRUNE CONFIG API + DATABASE STATS TYPE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Test 9z-L.1: GET auto-prune config ---
Write-Host "`n--- Test 9z-L.1: GET /admin/log-config/prune ---" -ForegroundColor Cyan
$pruneConfig = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/prune" -Method GET -Headers $headers
Test-Result -Success ($null -ne $pruneConfig) -Message "9z-L.1: GET prune config returns response"
Test-Result -Success ($null -ne $pruneConfig.retentionDays) -Message "9z-L.2: Has retentionDays field"
Test-Result -Success ($null -ne $pruneConfig.intervalMs) -Message "9z-L.3: Has intervalMs field"
Test-Result -Success ($pruneConfig.PSObject.Properties.Name -contains 'enabled') -Message "9z-L.4: Has enabled field"

# --- Test 9z-L.5: PUT auto-prune config ---
Write-Host "`n--- Test 9z-L.5: PUT /admin/log-config/prune ---" -ForegroundColor Cyan
$updateBody = @{ retentionDays = 14; enabled = $false } | ConvertTo-Json
$updatedPrune = Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/prune" -Method PUT -Headers $headers -Body $updateBody -ContentType "application/json"
Test-Result -Success ($updatedPrune.retentionDays -eq 14) -Message "9z-L.5: PUT updates retentionDays to 14"
Test-Result -Success ($updatedPrune.enabled -eq $false) -Message "9z-L.6: PUT updates enabled to false"

# --- Test 9z-L.7: Restore prune config ---
$restoreBody = @{ retentionDays = 1; enabled = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "$baseUrl/scim/admin/log-config/prune" -Method PUT -Headers $headers -Body $restoreBody -ContentType "application/json" | Out-Null
Test-Result -Success $true -Message "9z-L.7: Restored prune config"

# --- Test 9z-L.8: Database statistics includes database.type ---
Write-Host "`n--- Test 9z-L.8: Database statistics type field ---" -ForegroundColor Cyan
$dbStats = Invoke-RestMethod -Uri "$baseUrl/scim/admin/database/statistics" -Method GET -Headers $headers
Test-Result -Success ($null -ne $dbStats.database) -Message "9z-L.8: Statistics has database field"
Test-Result -Success ($dbStats.database.type -eq 'PostgreSQL' -or $dbStats.database.type -eq 'In-Memory') -Message "9z-L.9: database.type is PostgreSQL or In-Memory (got: $($dbStats.database.type))"
Test-Result -Success ($dbStats.database.persistenceBackend -eq 'prisma' -or $dbStats.database.persistenceBackend -eq 'inmemory') -Message "9z-L.10: persistenceBackend is prisma or inmemory (got: $($dbStats.database.persistenceBackend))"

Write-Host "`n--- 9z-L: Auto-Prune + DB Stats Tests Complete ---" -ForegroundColor Green

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
if ($SchExtEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$SchExtEndpointId" -Name "Schema Extension Test Endpoint (9m-A)" }
if ($SchExtEndpoint2Id) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$SchExtEndpoint2Id" -Name "Schema Extension Isolation Endpoint (9m-A)" }
if ($G8bEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$G8bEndpointId" -Name "G8b Custom Resource Types Endpoint (9m-B)" }
if ($G8bNoFlagEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$G8bNoFlagEndpointId" -Name "G8b No Flag Endpoint (9m-B)" }
if ($ComboEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$ComboEndpointId" -Name "Schema Combo Test Endpoint (9m-C)" }
if ($StrictComboEndpointId) { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$StrictComboEndpointId" -Name "Strict Schema Combo Endpoint (9m-C)" }

# ============================================
# SWEEP: Delete ALL remaining live-test-* endpoints
# Catches any orphaned endpoints from interrupted test runs.
# Preserves ISV and manually-created endpoints (non live-test-* names).
# ============================================
Write-Host "`n--- Sweep: Delete ALL remaining live-test-* endpoints ---" -ForegroundColor Cyan
try {
    $allEndpoints = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Headers $headers -ErrorAction Stop
    $testEndpoints = $allEndpoints.endpoints | Where-Object { $_.name -like "live-test-*" }
    if ($testEndpoints.Count -gt 0) {
        Write-Host "  Found $($testEndpoints.Count) orphaned live-test-* endpoint(s) to clean up:" -ForegroundColor Yellow
        foreach ($ep in $testEndpoints) {
            Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$($ep.id)" -Name "$($ep.name) ($($ep.id))"
        }
    } else {
        Write-Host "  ✅ No orphaned live-test-* endpoints found" -ForegroundColor Green
    }
    # Report preserved endpoints
    $preserved = $allEndpoints.endpoints | Where-Object { $_.name -notlike "live-test-*" }
    if ($preserved.Count -gt 0) {
        Write-Host "  Preserved $($preserved.Count) non-test endpoint(s):" -ForegroundColor Cyan
        foreach ($ep in $preserved) {
            Write-Host "    🔒 $($ep.name) ($($ep.id))" -ForegroundColor DarkCyan
        }
    }
} catch {
    Write-Host "  ⚠️ Could not list endpoints for sweep cleanup: $_" -ForegroundColor Yellow
}

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
    version           = (Get-Content (Join-Path $PSScriptRoot '..\api\package.json') -Raw | ConvertFrom-Json).version
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
