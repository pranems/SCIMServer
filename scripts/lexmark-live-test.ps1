# Lexmark ISV Live Test Script
# Comprehensive live integration tests for Lexmark Cloud Print Management SCIM endpoint profile.
#
# Lexmark-specific profile:
#   - User-only (no Groups)
#   - Core User: userName, name (givenName/familyName), displayName, preferredLanguage, active
#   - EnterpriseUser extension (required): costCenter, department
#   - Custom extension (optional): badgeCode (writeOnly/never), pin (writeOnly/never)
#   - SPC: patch=true, bulk=false, filter=true(200), sort=true, etag=false, changePassword=false
#
# Usage:
#   .\lexmark-live-test.ps1                                                        # Local dev (defaults)
#   .\lexmark-live-test.ps1 -Verbose                                               # Verbose mode
#   .\lexmark-live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "docker-secret"  # Docker
#   .\lexmark-live-test.ps1 -BaseUrl https://myapp.azurecontainerapps.io -ClientSecret "my-secret"  # Azure
#
# Parameters:
#   -BaseUrl        Target server URL (default: http://localhost:6000)
#   -ClientId       OAuth client_id  (default: scimserver-client)
#   -ClientSecret   OAuth client_secret (default: changeme-oauth)
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

# ═══════════════════════════════════════════════════════════════════
# Utility Functions
# ═══════════════════════════════════════════════════════════════════

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
        if ($value -is [array]) { $normalized[$headerName] = ($value -join ', ') }
        else { $normalized[$headerName] = [string]$value }
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
        [datetime]$StartedAt, [string]$Method, [string]$Uri,
        [System.Collections.IDictionary]$RequestHeaders, $RequestBody,
        [int]$StatusCode, [System.Collections.IDictionary]$ResponseHeaders,
        $ResponseBody, [string]$ErrorMessage
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
        request     = [ordered]@{ method = $Method; url = $Uri; headers = Convert-FlowHeaders -Headers $RequestHeaders; body = Convert-FlowBody -Body $RequestBody }
        response    = if ($StatusCode -gt 0 -or $null -ne $ResponseHeaders -or $null -ne $ResponseBody) {
            [ordered]@{ status = $StatusCode; headers = Convert-FlowHeaders -Headers $ResponseHeaders; body = Convert-FlowBody -Body $ResponseBody }
        } else { $null }
        error       = if ($ErrorMessage) { [ordered]@{ message = $ErrorMessage } } else { $null }
    }
}

function Invoke-RestMethod {
    [CmdletBinding()]
    param([string]$Uri, [string]$Method, [System.Collections.IDictionary]$Headers, [object]$Body, [string]$ContentType)
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
    $restResponseHeaders = $null; $restStatusCode = 0
    try {
        $result = Microsoft.PowerShell.Utility\Invoke-RestMethod @PSBoundParameters -AllowInsecureRedirect -ResponseHeadersVariable restResponseHeaders -StatusCodeVariable restStatusCode
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $restStatusCode -ResponseHeaders $restResponseHeaders -ResponseBody $result
    } catch {
        $errorStatus = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { try { $errorStatus = [int]$_.Exception.Response.StatusCode } catch {} }
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $errorStatus -ResponseBody $_.ErrorDetails.Message -ErrorMessage $_.Exception.Message
        if ($script:VerboseMode) {
            Write-Host "    📋 ← Error: $($_.Exception.Message)" -ForegroundColor DarkYellow
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
    param([string]$Uri, [string]$Method, [System.Collections.IDictionary]$Headers, [object]$Body, [string]$ContentType, [switch]$SkipHttpErrorCheck)
    $requestStart = Get-Date
    $m = if ($Method) { $Method.ToUpperInvariant() } else { "GET" }
    if ($script:VerboseMode) { Write-Host "    📋 → $m $Uri" -ForegroundColor DarkGray }
    try {
        $result = Microsoft.PowerShell.Utility\Invoke-WebRequest @PSBoundParameters -AllowInsecureRedirect
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $result.StatusCode -ResponseHeaders $result.Headers -ResponseBody $result.Content
    } catch {
        $errorStatus = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { try { $errorStatus = [int]$_.Exception.Response.StatusCode } catch {} }
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $errorStatus -ResponseBody $_.ErrorDetails.Message -ErrorMessage $_.Exception.Message
        throw
    }
    return $result
}

function Test-Result {
    param([bool]$Success, [string]$Message)
    $status = if ($Success) { "passed" } else { "failed" }
    $newFlowStepIds = @($script:flowSteps | Where-Object { $_.stepId -gt $script:lastLinkedFlowStepId } | ForEach-Object { $_.stepId })
    if ($script:flowSteps.Count -gt 0) { $script:lastLinkedFlowStepId = $script:flowSteps[-1].stepId }
    $latestAction = if ($newFlowStepIds.Count -gt 0) {
        ($script:flowSteps | Where-Object { $_.stepId -eq $newFlowStepIds[-1] } | Select-Object -First 1).actionStep
    } else { $null }
    $script:testResults += [PSCustomObject]@{
        section = $script:currentSection; name = $Message; status = $status
        actionStep = $latestAction; actionStepIds = $newFlowStepIds
    }
    if ($Success) { Write-Host "PASS: $Message" -ForegroundColor Green; $script:testsPassed++ }
    else { Write-Host "FAIL: $Message" -ForegroundColor Red; $script:testsFailed++ }
}

# ═══════════════════════════════════════════════════════════════════
# START
# ═══════════════════════════════════════════════════════════════════

Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   LEXMARK ISV LIVE TEST SUITE                               ║" -ForegroundColor Magenta
Write-Host "║   Lexmark Cloud Print Management SCIM Endpoint Profile      ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host "Base URL: $baseUrl" -ForegroundColor Cyan

if ($VerboseMode) {
    Write-Host "🔍 VERBOSE MODE ENABLED" -ForegroundColor Magenta
}

$script:startTime = Get-Date

# ═══════════════════════════════════════════════════════════════════
# SECTION 1: AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "1: Authentication"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 1: AUTHENTICATION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$tokenBody = @{client_id=$ClientId;client_secret=$ClientSecret;grant_type='client_credentials'}
$tokenResponse = Invoke-RestMethod -Uri "$baseUrl/scim/oauth/token" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $tokenBody
$Token = $tokenResponse.access_token
Write-Host "✅ Token obtained: $($Token.Substring(0,30))..."
$headers = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'}

# ═══════════════════════════════════════════════════════════════════
# SECTION 2: ENDPOINT CREATION WITH LEXMARK PRESET
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "2: Endpoint Creation"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 2: ENDPOINT CREATION WITH LEXMARK PRESET" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$lexmarkEpBody = @{
    name = "lexmark-live-$(Get-Random)"
    displayName = "Lexmark Live Test Endpoint"
    description = "Created by lexmark-live-test.ps1"
    profilePreset = "lexmark"
} | ConvertTo-Json -Depth 4
$lexmarkEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $lexmarkEpBody
$LexmarkEndpointId = $lexmarkEp.id
$scimBase = "$baseUrl/scim/endpoints/$LexmarkEndpointId"
Test-Result -Success ($null -ne $LexmarkEndpointId) -Message "2.1: Created Lexmark endpoint with lexmark preset"
Test-Result -Success ($lexmarkEp.profile -ne $null) -Message "2.2: Endpoint has profile"
Test-Result -Success ($lexmarkEp.profile.schemas.Count -eq 3) -Message "2.3: Profile has 3 schemas (Core User, EnterpriseUser, CustomUser)"
Test-Result -Success ($lexmarkEp.profile.resourceTypes.Count -eq 1) -Message "2.4: Profile has 1 resource type (User only)"
Test-Result -Success ($lexmarkEp.profile.resourceTypes[0].name -eq "User") -Message "2.5: Resource type is User"

# Verify SPC
$spc = $lexmarkEp.profile.serviceProviderConfig
Test-Result -Success ($spc.patch.supported -eq $true) -Message "2.6: SPC patch=true"
Test-Result -Success ($spc.bulk.supported -eq $false) -Message "2.7: SPC bulk=false"
Test-Result -Success ($spc.filter.supported -eq $true) -Message "2.8: SPC filter=true"
Test-Result -Success ($spc.filter.maxResults -eq 200) -Message "2.9: SPC filter.maxResults=200"
Test-Result -Success ($spc.sort.supported -eq $true) -Message "2.10: SPC sort=true"
Test-Result -Success ($spc.etag.supported -eq $false) -Message "2.11: SPC etag=false"
Test-Result -Success ($spc.changePassword.supported -eq $false) -Message "2.12: SPC changePassword=false"

# ═══════════════════════════════════════════════════════════════════
# SECTION 3: DISCOVERY ENDPOINTS
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "3: Discovery"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 3: DISCOVERY ENDPOINTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- /Schemas ---
Write-Host "`n--- /Schemas ---" -ForegroundColor Cyan
$schemas = Invoke-RestMethod -Uri "$scimBase/Schemas" -Headers $headers
Test-Result -Success ($schemas.totalResults -eq 3) -Message "3.1: /Schemas returns 3 schemas"

$schemaIds = @($schemas.Resources | ForEach-Object { $_.id })
Test-Result -Success ($schemaIds -contains "urn:ietf:params:scim:schemas:core:2.0:User") -Message "3.2: Core User schema present"
Test-Result -Success ($schemaIds -contains "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User") -Message "3.3: EnterpriseUser schema present"
Test-Result -Success ($schemaIds -contains "urn:ietf:params:scim:schemas:extension:custom:2.0:User") -Message "3.4: CustomUser schema present"

# Core User attributes check
$coreSchema = $schemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:core:2.0:User" }
$coreAttrNames = @($coreSchema.attributes | ForEach-Object { $_.name })
Test-Result -Success ($coreAttrNames -contains "userName") -Message "3.5: Core schema has userName"
Test-Result -Success ($coreAttrNames -contains "name") -Message "3.6: Core schema has name"
Test-Result -Success ($coreAttrNames -contains "displayName") -Message "3.7: Core schema has displayName"
Test-Result -Success ($coreAttrNames -contains "preferredLanguage") -Message "3.8: Core schema has preferredLanguage"
Test-Result -Success ($coreAttrNames -contains "active") -Message "3.9: Core schema has active"

# EnterpriseUser attributes
$entSchema = $schemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" }
$entAttrNames = @($entSchema.attributes | ForEach-Object { $_.name })
Test-Result -Success ($entAttrNames -contains "costCenter") -Message "3.10: EnterpriseUser has costCenter"
Test-Result -Success ($entAttrNames -contains "department") -Message "3.11: EnterpriseUser has department"
Test-Result -Success ($entSchema.attributes.Count -eq 2) -Message "3.12: EnterpriseUser has exactly 2 attributes"

# CustomUser attributes + writeOnly/never characteristics
$customSchema = $schemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:extension:custom:2.0:User" }
$customAttrNames = @($customSchema.attributes | ForEach-Object { $_.name })
Test-Result -Success ($customAttrNames -contains "badgeCode") -Message "3.13: CustomUser has badgeCode"
Test-Result -Success ($customAttrNames -contains "pin") -Message "3.14: CustomUser has pin"
Test-Result -Success ($customSchema.attributes.Count -eq 2) -Message "3.15: CustomUser has exactly 2 attributes"

$badgeAttr = $customSchema.attributes | Where-Object { $_.name -eq "badgeCode" }
Test-Result -Success ($badgeAttr.mutability -eq "writeOnly") -Message "3.16: badgeCode mutability=writeOnly"
Test-Result -Success ($badgeAttr.returned -eq "never") -Message "3.17: badgeCode returned=never"
$pinAttr = $customSchema.attributes | Where-Object { $_.name -eq "pin" }
Test-Result -Success ($pinAttr.mutability -eq "writeOnly") -Message "3.18: pin mutability=writeOnly"
Test-Result -Success ($pinAttr.returned -eq "never") -Message "3.19: pin returned=never"

# --- /ResourceTypes ---
Write-Host "`n--- /ResourceTypes ---" -ForegroundColor Cyan
$rts = Invoke-RestMethod -Uri "$scimBase/ResourceTypes" -Headers $headers
Test-Result -Success ($rts.totalResults -eq 1) -Message "3.20: /ResourceTypes returns 1 resource type"
Test-Result -Success ($rts.Resources[0].name -eq "User") -Message "3.21: ResourceType is User"
Test-Result -Success ($rts.Resources[0].endpoint -eq "/Users") -Message "3.22: ResourceType endpoint is /Users"

$extensions = @($rts.Resources[0].schemaExtensions)
$entExt = $extensions | Where-Object { $_.schema -eq "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" }
$customExt = $extensions | Where-Object { $_.schema -eq "urn:ietf:params:scim:schemas:extension:custom:2.0:User" }
Test-Result -Success ($null -ne $entExt) -Message "3.23: EnterpriseUser extension listed"
Test-Result -Success ($entExt.required -eq $true) -Message "3.24: EnterpriseUser extension required=true"
Test-Result -Success ($null -ne $customExt) -Message "3.25: CustomUser extension listed"
Test-Result -Success ($customExt.required -eq $false) -Message "3.26: CustomUser extension required=false"

# No Group in ResourceTypes
$groupRT = $rts.Resources | Where-Object { $_.name -eq "Group" }
Test-Result -Success ($null -eq $groupRT) -Message "3.27: No Group in ResourceTypes (user-only)"

# --- /ServiceProviderConfig ---
Write-Host "`n--- /ServiceProviderConfig ---" -ForegroundColor Cyan
$spcDiscovery = Invoke-RestMethod -Uri "$scimBase/ServiceProviderConfig" -Headers $headers
Test-Result -Success ($spcDiscovery.patch.supported -eq $true) -Message "3.28: SPC discovery patch=true"
Test-Result -Success ($spcDiscovery.bulk.supported -eq $false) -Message "3.29: SPC discovery bulk=false"
Test-Result -Success ($spcDiscovery.filter.supported -eq $true) -Message "3.30: SPC discovery filter=true"
Test-Result -Success ($spcDiscovery.sort.supported -eq $true) -Message "3.31: SPC discovery sort=true"
Test-Result -Success ($spcDiscovery.etag.supported -eq $false) -Message "3.32: SPC discovery etag=false"

# ═══════════════════════════════════════════════════════════════════
# SECTION 4: USER CRUD LIFECYCLE
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "4: User CRUD"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 4: USER CRUD LIFECYCLE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Create User with Core + EnterpriseUser ---
Write-Host "`n--- Create User ---" -ForegroundColor Cyan
$userBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    )
    userName = "lexuser-$(Get-Random)@lexmark.com"
    name = @{ givenName = "Lex"; familyName = "Tester" }
    displayName = "Lex Tester"
    preferredLanguage = "en-US"
    active = $true
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        costCenter = "CC-100"
        department = "Engineering"
    }
} | ConvertTo-Json -Depth 4
$user = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $userBody -ContentType "application/scim+json"
$UserId = $user.id
$UserName = $user.userName
Test-Result -Success ($null -ne $UserId) -Message "4.1: User created with id"
Test-Result -Success ($user.userName -like "*@lexmark.com") -Message "4.2: userName is email"
Test-Result -Success ($user.displayName -eq "Lex Tester") -Message "4.3: displayName set"
Test-Result -Success ($user.name.givenName -eq "Lex") -Message "4.4: name.givenName set"
Test-Result -Success ($user.name.familyName -eq "Tester") -Message "4.5: name.familyName set"
Test-Result -Success ($user.preferredLanguage -eq "en-US") -Message "4.6: preferredLanguage set"
Test-Result -Success ($user.active -eq $true) -Message "4.7: active=true"
Test-Result -Success ($user."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".costCenter -eq "CC-100") -Message "4.8: EnterpriseUser costCenter set"
Test-Result -Success ($user."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Engineering") -Message "4.9: EnterpriseUser department set"
Test-Result -Success ($null -ne $user.meta) -Message "4.10: meta present"
Test-Result -Success ($user.meta.resourceType -eq "User") -Message "4.11: meta.resourceType=User"

# --- GET User ---
Write-Host "`n--- GET User ---" -ForegroundColor Cyan
$getUser = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Headers $headers
Test-Result -Success ($getUser.id -eq $UserId) -Message "4.12: GET user by id returns correct user"
Test-Result -Success ($getUser.displayName -eq "Lex Tester") -Message "4.13: GET displayName matches"
Test-Result -Success ($getUser."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".costCenter -eq "CC-100") -Message "4.14: GET enterprise costCenter matches"

# --- List Users ---
Write-Host "`n--- List Users ---" -ForegroundColor Cyan
$listUsers = Invoke-RestMethod -Uri "$scimBase/Users" -Headers $headers
Test-Result -Success ($listUsers.totalResults -ge 1) -Message "4.15: List users totalResults >= 1"
$foundUser = $listUsers.Resources | Where-Object { $_.id -eq $UserId }
Test-Result -Success ($null -ne $foundUser) -Message "4.16: Created user found in list"

# ═══════════════════════════════════════════════════════════════════
# SECTION 5: ENTERPRISE USER EXTENSION
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "5: Enterprise Extension"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 5: ENTERPRISE USER EXTENSION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# PATCH costCenter
Write-Host "`n--- PATCH costCenter ---" -ForegroundColor Cyan
$patchBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{ costCenter = "CC-999" } }
    })
} | ConvertTo-Json -Depth 6
$patchResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/scim+json"
Test-Result -Success ($patchResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".costCenter -eq "CC-999") -Message "5.1: PATCH costCenter updated"
Test-Result -Success ($patchResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Engineering") -Message "5.2: department preserved after costCenter PATCH"

# PATCH department via path
Write-Host "`n--- PATCH department via path ---" -ForegroundColor Cyan
$patchDeptBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department"
        value = "Marketing"
    })
} | ConvertTo-Json -Depth 6
$patchDeptResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchDeptBody -ContentType "application/scim+json"
Test-Result -Success ($patchDeptResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Marketing") -Message "5.3: PATCH department updated via path"

# ═══════════════════════════════════════════════════════════════════
# SECTION 6: CUSTOM EXTENSION (writeOnly / returned:never)
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "6: Custom Extension"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 6: CUSTOM EXTENSION (writeOnly/returned:never)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create user with all 3 schemas including custom extension
Write-Host "`n--- Create user with custom extension ---" -ForegroundColor Cyan
$customUserBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
        "urn:ietf:params:scim:schemas:extension:custom:2.0:User"
    )
    userName = "custom-$(Get-Random)@lexmark.com"
    displayName = "Custom Badge User"
    active = $true
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        costCenter = "CC-CUSTOM"
        department = "Security"
    }
    "urn:ietf:params:scim:schemas:extension:custom:2.0:User" = @{
        badgeCode = "BADGE-ABC123"
        pin = "4567"
    }
} | ConvertTo-Json -Depth 4
$customUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $customUserBody -ContentType "application/scim+json"
$CustomUserId = $customUser.id
Test-Result -Success ($null -ne $CustomUserId) -Message "6.1: User with custom extension created"

# Check returned:never on POST response
$customExtData = $customUser."urn:ietf:params:scim:schemas:extension:custom:2.0:User"
$hasBadgeInPost = ($null -ne $customExtData) -and ($null -ne $customExtData.badgeCode)
$hasPinInPost = ($null -ne $customExtData) -and ($null -ne $customExtData.pin)
Test-Result -Success (-not $hasBadgeInPost) -Message "6.2: badgeCode NOT in POST response (returned:never)"
Test-Result -Success (-not $hasPinInPost) -Message "6.3: pin NOT in POST response (returned:never)"

# Check returned:never on GET response
Write-Host "`n--- GET user — verify returned:never ---" -ForegroundColor Cyan
$getCustom = Invoke-RestMethod -Uri "$scimBase/Users/$CustomUserId" -Headers $headers
$getExtData = $getCustom."urn:ietf:params:scim:schemas:extension:custom:2.0:User"
$hasBadgeInGet = ($null -ne $getExtData) -and ($null -ne $getExtData.badgeCode)
$hasPinInGet = ($null -ne $getExtData) -and ($null -ne $getExtData.pin)
Test-Result -Success (-not $hasBadgeInGet) -Message "6.4: badgeCode NOT in GET response (returned:never)"
Test-Result -Success (-not $hasPinInGet) -Message "6.5: pin NOT in GET response (returned:never)"

# Check returned:never on list response
Write-Host "`n--- List users — verify returned:never ---" -ForegroundColor Cyan
$listAll = Invoke-RestMethod -Uri "$scimBase/Users" -Headers $headers
$listCustomUser = $listAll.Resources | Where-Object { $_.id -eq $CustomUserId }
$listExtData = $listCustomUser."urn:ietf:params:scim:schemas:extension:custom:2.0:User"
$hasBadgeInList = ($null -ne $listExtData) -and ($null -ne $listExtData.badgeCode)
Test-Result -Success (-not $hasBadgeInList) -Message "6.6: badgeCode NOT in list response (returned:never)"

# PATCH custom extension writeOnly attributes
Write-Host "`n--- PATCH custom extension writeOnly attrs ---" -ForegroundColor Cyan
$patchCustomBody = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        value = @{ "urn:ietf:params:scim:schemas:extension:custom:2.0:User" = @{ badgeCode = "BADGE-UPDATED"; pin = "9999" } }
    })
} | ConvertTo-Json -Depth 6
$patchCustomResult = Invoke-RestMethod -Uri "$scimBase/Users/$CustomUserId" -Method PATCH -Headers $headers -Body $patchCustomBody -ContentType "application/scim+json"
$patchExtData = $patchCustomResult."urn:ietf:params:scim:schemas:extension:custom:2.0:User"
$hasBadgeInPatch = ($null -ne $patchExtData) -and ($null -ne $patchExtData.badgeCode)
$hasPinInPatch = ($null -ne $patchExtData) -and ($null -ne $patchExtData.pin)
Test-Result -Success (-not $hasBadgeInPatch) -Message "6.7: badgeCode NOT in PATCH response (returned:never)"
Test-Result -Success (-not $hasPinInPatch) -Message "6.8: pin NOT in PATCH response (returned:never)"

# ═══════════════════════════════════════════════════════════════════
# SECTION 7: PATCH OPERATIONS (CORE)
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "7: PATCH Core"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 7: PATCH OPERATIONS (CORE ATTRIBUTES)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# PATCH displayName
Write-Host "`n--- PATCH displayName ---" -ForegroundColor Cyan
$patchDN = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "Updated Display Name" })
} | ConvertTo-Json -Depth 6
$patchDNResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchDN -ContentType "application/scim+json"
Test-Result -Success ($patchDNResult.displayName -eq "Updated Display Name") -Message "7.1: PATCH displayName updated"

# PATCH name.givenName via value-based replacement
Write-Host "`n--- PATCH name.givenName ---" -ForegroundColor Cyan
$patchGN = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; value = @{ name = @{ givenName = "NewGiven" } } })
} | ConvertTo-Json -Depth 6
$patchGNResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchGN -ContentType "application/scim+json"
Test-Result -Success ($patchGNResult.name.givenName -eq "NewGiven") -Message "7.2: PATCH name.givenName updated"

# PATCH active=false
Write-Host "`n--- PATCH active=false ---" -ForegroundColor Cyan
$patchActive = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $false })
} | ConvertTo-Json -Depth 6
$patchActiveResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchActive -ContentType "application/scim+json"
Test-Result -Success ($patchActiveResult.active -eq $false) -Message "7.3: PATCH active=false"

# PATCH active=true
$patchActivate = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $true })
} | ConvertTo-Json -Depth 6
$patchActivateResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchActivate -ContentType "application/scim+json"
Test-Result -Success ($patchActivateResult.active -eq $true) -Message "7.4: PATCH active=true"

# PATCH preferredLanguage
Write-Host "`n--- PATCH preferredLanguage ---" -ForegroundColor Cyan
$patchLang = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "preferredLanguage"; value = "de-DE" })
} | ConvertTo-Json -Depth 6
$patchLangResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchLang -ContentType "application/scim+json"
Test-Result -Success ($patchLangResult.preferredLanguage -eq "de-DE") -Message "7.5: PATCH preferredLanguage updated"

# PATCH multiple operations at once
Write-Host "`n--- PATCH multiple ops ---" -ForegroundColor Cyan
$patchMulti = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(
        @{ op = "replace"; path = "displayName"; value = "Multi-Patched" }
        @{ op = "replace"; value = @{ name = @{ familyName = "MultiFamily" } } }
        @{ op = "replace"; value = @{ "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{ department = "Finance" } } }
    )
} | ConvertTo-Json -Depth 6
$patchMultiResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchMulti -ContentType "application/scim+json"
Test-Result -Success ($patchMultiResult.displayName -eq "Multi-Patched") -Message "7.6: Multi-PATCH displayName"
Test-Result -Success ($patchMultiResult.name.familyName -eq "MultiFamily") -Message "7.7: Multi-PATCH name.familyName"
Test-Result -Success ($patchMultiResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Finance") -Message "7.8: Multi-PATCH enterprise department"

# ═══════════════════════════════════════════════════════════════════
# SECTION 8: PUT (REPLACE) OPERATIONS
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "8: PUT Replace"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 8: PUT (REPLACE) OPERATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

Write-Host "`n--- PUT replace user ---" -ForegroundColor Cyan
$putBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    )
    userName = $UserName
    name = @{ givenName = "PutGiven"; familyName = "PutFamily" }
    displayName = "Put Replaced User"
    preferredLanguage = "fr-FR"
    active = $true
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        costCenter = "CC-PUT"
        department = "Legal"
    }
} | ConvertTo-Json -Depth 4
$putResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PUT -Headers $headers -Body $putBody -ContentType "application/scim+json"
Test-Result -Success ($putResult.displayName -eq "Put Replaced User") -Message "8.1: PUT displayName updated"
Test-Result -Success ($putResult.name.givenName -eq "PutGiven") -Message "8.2: PUT name.givenName updated"
Test-Result -Success ($putResult.name.familyName -eq "PutFamily") -Message "8.3: PUT name.familyName updated"
Test-Result -Success ($putResult.preferredLanguage -eq "fr-FR") -Message "8.4: PUT preferredLanguage updated"
Test-Result -Success ($putResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".costCenter -eq "CC-PUT") -Message "8.5: PUT enterprise costCenter updated"
Test-Result -Success ($putResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Legal") -Message "8.6: PUT enterprise department updated"
Test-Result -Success ($putResult.id -eq $UserId) -Message "8.7: PUT preserves id"
Test-Result -Success ($null -ne $putResult.meta) -Message "8.8: PUT preserves meta"

# PUT with custom extension writeOnly data
Write-Host "`n--- PUT with custom extension writeOnly data ---" -ForegroundColor Cyan
$putCustomBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
        "urn:ietf:params:scim:schemas:extension:custom:2.0:User"
    )
    userName = $UserName
    displayName = "Put With Badge"
    active = $true
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{ costCenter = "CC-PUT"; department = "IT" }
    "urn:ietf:params:scim:schemas:extension:custom:2.0:User" = @{ badgeCode = "PUT-BADGE"; pin = "1234" }
} | ConvertTo-Json -Depth 4
$putCustomResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PUT -Headers $headers -Body $putCustomBody -ContentType "application/scim+json"
$putExtData = $putCustomResult."urn:ietf:params:scim:schemas:extension:custom:2.0:User"
$hasBadgeInPut = ($null -ne $putExtData) -and ($null -ne $putExtData.badgeCode)
Test-Result -Success (-not $hasBadgeInPut) -Message "8.9: PUT custom badgeCode NOT returned (returned:never)"

# ═══════════════════════════════════════════════════════════════════
# SECTION 9: FILTERING & LIST
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "9: Filtering"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 9: FILTERING & LIST OPERATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Filter by userName eq
Write-Host "`n--- Filter by userName eq ---" -ForegroundColor Cyan
$filterEq = Invoke-RestMethod -Uri "$scimBase/Users?filter=userName%20eq%20%22$UserName%22" -Headers $headers
Test-Result -Success ($filterEq.totalResults -eq 1) -Message "9.1: Filter userName eq returns 1 result"
Test-Result -Success ($filterEq.Resources[0].userName -eq $UserName) -Message "9.2: Filter userName eq matches"

# Filter by active eq true
Write-Host "`n--- Filter by active eq true ---" -ForegroundColor Cyan
$filterActive = Invoke-RestMethod -Uri "$scimBase/Users?filter=active%20eq%20true" -Headers $headers
Test-Result -Success ($filterActive.totalResults -ge 1) -Message "9.3: Filter active eq true returns results"

# Filter by displayName co
Write-Host "`n--- Filter by displayName co ---" -ForegroundColor Cyan
$filterCo = Invoke-RestMethod -Uri "$scimBase/Users?filter=displayName%20co%20%22Put%22" -Headers $headers
Test-Result -Success ($filterCo.totalResults -ge 1) -Message "9.4: Filter displayName co returns results"

# Pagination
Write-Host "`n--- Pagination ---" -ForegroundColor Cyan
$paginated = Invoke-RestMethod -Uri "$scimBase/Users?startIndex=1&count=1" -Headers $headers
Test-Result -Success ($paginated.Resources.Count -le 1) -Message "9.5: Pagination count=1 returns at most 1"
Test-Result -Success ($paginated.startIndex -eq 1) -Message "9.6: Pagination startIndex=1"

# Filter by displayName sw
Write-Host "`n--- Filter by displayName sw ---" -ForegroundColor Cyan
$filterSw = Invoke-RestMethod -Uri "$scimBase/Users?filter=displayName%20sw%20%22Put%22" -Headers $headers
Test-Result -Success ($filterSw.totalResults -ge 1) -Message "9.7: Filter displayName sw returns results"

# ═══════════════════════════════════════════════════════════════════
# SECTION 10: USER-ONLY ISOLATION (NO GROUPS)
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "10: User-Only Isolation"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 10: USER-ONLY ISOLATION (NO GROUPS)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Verify ResourceTypes does NOT list Group
Write-Host "`n--- ResourceTypes has no Group ---" -ForegroundColor Cyan
$rtsIsolation = Invoke-RestMethod -Uri "$scimBase/ResourceTypes" -Headers $headers
$groupRTCheck = $rtsIsolation.Resources | Where-Object { $_.name -eq "Group" }
Test-Result -Success ($null -eq $groupRTCheck) -Message "10.1: No Group in ResourceTypes (user-only profile)"

# Verify /Schemas does NOT list Group schema
Write-Host "`n--- /Schemas has no Group schema ---" -ForegroundColor Cyan
$schemasIsolation = Invoke-RestMethod -Uri "$scimBase/Schemas" -Headers $headers
$groupSchemaCheck = $schemasIsolation.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:core:2.0:Group" }
Test-Result -Success ($null -eq $groupSchemaCheck) -Message "10.2: No Group schema in /Schemas (user-only profile)"

# ═══════════════════════════════════════════════════════════════════
# SECTION 11: NEGATIVE / EDGE CASES
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "11: Edge Cases"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 11: NEGATIVE / EDGE CASES" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# GET non-existent user → 404
Write-Host "`n--- GET non-existent user ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/non-existent-id-12345" -Headers $headers
    Test-Result -Success $false -Message "11.1: GET non-existent user should 404"
} catch {
    Test-Result -Success $true -Message "11.1: GET non-existent user returns 404"
}

# Duplicate userName → 409
Write-Host "`n--- Duplicate userName ---" -ForegroundColor Cyan
$dupUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $UserName
    displayName = "Duplicate User"
    active = $true
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dupUserBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "11.2: Duplicate userName should fail"
} catch {
    $dupStatus = 0
    if ($_.Exception.Response) { try { $dupStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($dupStatus -eq 409) -Message "11.2: Duplicate userName returns 409 (status=$dupStatus)"
}

# POST without userName → 400
Write-Host "`n--- POST without userName ---" -ForegroundColor Cyan
$noUserNameBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    displayName = "No UserName"
    active = $true
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $noUserNameBody -ContentType "application/scim+json"
    Test-Result -Success $false -Message "11.3: POST without userName should fail"
} catch {
    $noUNStatus = 0
    if ($_.Exception.Response) { try { $noUNStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($noUNStatus -eq 400) -Message "11.3: POST without userName returns 400 (status=$noUNStatus)"
}

# DELETE non-existent user → 404
Write-Host "`n--- DELETE non-existent user ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/nonexistent-uuid" -Method DELETE -Headers $headers
    Test-Result -Success $false -Message "11.4: DELETE non-existent user should 404"
} catch {
    Test-Result -Success $true -Message "11.4: DELETE non-existent user returns error"
}

# Create user with only userName (minimal)
Write-Host "`n--- Create user with only userName ---" -ForegroundColor Cyan
$minUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "minuser-$(Get-Random)@lexmark.com"
} | ConvertTo-Json
$minUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $minUserBody -ContentType "application/scim+json"
$MinUserId = $minUser.id
Test-Result -Success ($null -ne $MinUserId) -Message "11.5: Minimal user (userName only) created"

# Create user with all 3 schemas
Write-Host "`n--- Create user with all 3 schemas ---" -ForegroundColor Cyan
$allSchemaBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
        "urn:ietf:params:scim:schemas:extension:custom:2.0:User"
    )
    userName = "allschema-$(Get-Random)@lexmark.com"
    displayName = "All Schema User"
    active = $true
    name = @{ givenName = "All"; familyName = "Schema" }
    preferredLanguage = "ja-JP"
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{ costCenter = "CC-ALL"; department = "Research" }
    "urn:ietf:params:scim:schemas:extension:custom:2.0:User" = @{ badgeCode = "ALL-BADGE"; pin = "0000" }
} | ConvertTo-Json -Depth 4
$allSchemaUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $allSchemaBody -ContentType "application/scim+json"
$AllSchemaUserId = $allSchemaUser.id
Test-Result -Success ($null -ne $AllSchemaUserId) -Message "11.6: User with all 3 schemas created"
Test-Result -Success ($allSchemaUser."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".costCenter -eq "CC-ALL") -Message "11.7: Enterprise costCenter present"
$allSchemaExtData = $allSchemaUser."urn:ietf:params:scim:schemas:extension:custom:2.0:User"
$allHasBadge = ($null -ne $allSchemaExtData) -and ($null -ne $allSchemaExtData.badgeCode)
Test-Result -Success (-not $allHasBadge) -Message "11.8: Custom badgeCode NOT returned (returned:never)"

# ═══════════════════════════════════════════════════════════════════
# SECTION 12: PROFILE SETTINGS PATCHING
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "12: Profile Settings"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 12: PROFILE SETTINGS PATCHING" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# PATCH add SoftDeleteEnabled
Write-Host "`n--- PATCH SoftDeleteEnabled setting ---" -ForegroundColor Cyan
$settingsPatch = @{ profile = @{ settings = @{ SoftDeleteEnabled = "True" } } } | ConvertTo-Json -Depth 4
$settingsResult = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$LexmarkEndpointId" -Method PATCH -Headers $headers -Body $settingsPatch
Test-Result -Success ($settingsResult.profile.settings.SoftDeleteEnabled -eq "True") -Message "12.1: SoftDeleteEnabled added via settings PATCH"

# Schemas should be unchanged
$schemasAfter = Invoke-RestMethod -Uri "$scimBase/Schemas" -Headers $headers
Test-Result -Success ($schemasAfter.totalResults -eq 3) -Message "12.2: Schemas unchanged after settings PATCH"

# SPC should be unchanged
$spcAfter = Invoke-RestMethod -Uri "$scimBase/ServiceProviderConfig" -Headers $headers
Test-Result -Success ($spcAfter.bulk.supported -eq $false) -Message "12.3: SPC bulk still false after settings PATCH"
Test-Result -Success ($spcAfter.sort.supported -eq $true) -Message "12.4: SPC sort still true after settings PATCH"

# ═══════════════════════════════════════════════════════════════════
# SECTION 13: DELETE OPERATIONS & CLEANUP
# ═══════════════════════════════════════════════════════════════════
$script:currentSection = "13: Cleanup"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 13: DELETE OPERATIONS & CLEANUP" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Delete main user
Write-Host "`n--- Delete main user ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method DELETE -Headers $headers | Out-Null
    # Verify deleted
    try {
        Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Headers $headers
        Test-Result -Success $false -Message "13.1: Deleted user should not be found"
    } catch {
        Test-Result -Success $true -Message "13.1: DELETE user works (user not found after)"
    }
} catch {
    Test-Result -Success $false -Message "13.1: DELETE user should succeed"
}

# Delete custom user
Write-Host "`n--- Delete custom extension user ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/$CustomUserId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "13.2: Custom extension user deleted"
} catch {
    Test-Result -Success $false -Message "13.2: DELETE custom user should succeed"
}

# Delete minimal user
if ($MinUserId) {
    try { Invoke-RestMethod -Uri "$scimBase/Users/$MinUserId" -Method DELETE -Headers $headers | Out-Null } catch {}
}
# Delete all-schema user
if ($AllSchemaUserId) {
    try { Invoke-RestMethod -Uri "$scimBase/Users/$AllSchemaUserId" -Method DELETE -Headers $headers | Out-Null } catch {}
}

# Delete Lexmark endpoint
Write-Host "`n--- Delete Lexmark endpoint ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$LexmarkEndpointId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "13.3: Lexmark endpoint deleted"
} catch {
    Test-Result -Success $false -Message "13.3: DELETE Lexmark endpoint should succeed"
}

# ═══════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════
$elapsed = (Get-Date) - $script:startTime
$finishedAt = Get-Date

Write-Host "`n`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   LEXMARK ISV LIVE TEST — FINAL SUMMARY                     ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host "Tests Passed: $testsPassed" -ForegroundColor Green
Write-Host "Tests Failed: $testsFailed" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Red" })
Write-Host "Total Tests:  $($testsPassed + $testsFailed)" -ForegroundColor Cyan
Write-Host "Duration:     $([math]::Round($elapsed.TotalSeconds, 1))s" -ForegroundColor Cyan

if ($testsFailed -eq 0) {
    Write-Host "`n🎉 ALL LEXMARK TESTS PASSED!" -ForegroundColor Green
} else {
    Write-Host "`n⚠️ Some tests failed. Review output above." -ForegroundColor Yellow
}

# ═══════════════════════════════════════════════════════════════════
# WRITE JSON RESULTS FILE
# ═══════════════════════════════════════════════════════════════════
$totalTests = $testsPassed + $testsFailed
$successRate = if ($totalTests -gt 0) { [math]::Round(($testsPassed / $totalTests) * 100, 1) } else { 0 }
$timestamp = $finishedAt.ToString("yyyy-MM-dd_HH-mm-ss")
$runId = "lexmark-live-$timestamp"

$target = if ($baseUrl -match 'localhost:8080|:8080') { "docker" }
           elseif ($baseUrl -match 'azurecontainerapps|azure') { "azure" }
           else { "local" }

$sectionGroups = $script:testResults | Group-Object -Property section
$sectionsArray = @()
foreach ($group in $sectionGroups) {
    $sectionPassed = ($group.Group | Where-Object { $_.status -eq 'passed' }).Count
    $sectionFailed = ($group.Group | Where-Object { $_.status -eq 'failed' }).Count
    $sectionsArray += [PSCustomObject]@{
        name = $group.Name; tests = $group.Count; passed = $sectionPassed
        failed = $sectionFailed; status = if ($sectionFailed -eq 0) { "passed" } else { "failed" }
    }
}

$resultsObj = [ordered]@{
    testRunner        = "Lexmark ISV Live Integration Tests (SCIMServer)"
    version           = (Get-Content (Join-Path $PSScriptRoot '..\api\package.json') -Raw | ConvertFrom-Json).version
    runId             = $runId
    target            = $target
    baseUrl           = $baseUrl
    isvProfile        = "lexmark"
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
        totalSections = $sectionGroups.Count; totalTests = $totalTests
        passed = $testsPassed; failed = $testsFailed
        totalFlowSteps = $script:flowSteps.Count
        successRate = "$successRate%"
    }
    sections          = $sectionsArray
    tests             = $script:testResults
    flowSteps         = $script:flowSteps
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $repoRoot "test-results"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$outFile = Join-Path $outDir "$runId.json"
$latestFile = Join-Path $outDir "lexmark-live-results-latest.json"

$jsonContent = $resultsObj | ConvertTo-Json -Depth 10
$jsonContent | Out-File -FilePath $outFile -Encoding utf8
$jsonContent | Out-File -FilePath $latestFile -Encoding utf8

Write-Host "`n📊 Lexmark live test results JSON written to: test-results/$runId.json" -ForegroundColor Cyan
Write-Host "`n========================================`n" -ForegroundColor Magenta
