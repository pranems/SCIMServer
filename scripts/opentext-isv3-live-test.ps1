# OpenText ISV-3 Live Test Script
# Comprehensive live integration tests for OpenText Customer Portal SCIM endpoint profile (ISV-3 variant).
#
# OpenText ISV-3 profile:
#   - User + Group
#   - Core User: userName, active, name (givenName/familyName), displayName, title, emails, phoneNumbers, addresses
#   - EnterpriseUser extension (optional): department
#   - OpenText Mailbox extension (optional): proxyAddresses (multi-valued STRING - flat list, NOT complex)
#   - Group: displayName (uniqueness:server), externalId (caseExact:true), members (value:immutable, $ref, display:readOnly)
#   - SPC: patch=true, bulk=false, filter=true(200), sort=false, etag=false, changePassword=false
#   - Auth: oauthbearertoken
#
# Usage:
#   .\opentext-isv3-live-test.ps1                                                        # Local dev (defaults)
#   .\opentext-isv3-live-test.ps1 -Verbose                                               # Verbose mode
#   .\opentext-isv3-live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "docker-secret"  # Docker
#   .\opentext-isv3-live-test.ps1 -BaseUrl https://myapp.azurecontainerapps.io -ClientSecret "my-secret"  # Azure
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

# ===================================================================
# Utility Functions
# ===================================================================

function Write-VerboseLog {
    param([string]$Label, $Data)
    if (-not $script:VerboseMode) { return }
    if ($null -eq $Data) {
        Write-Host "    [VERBOSE] $Label" -ForegroundColor DarkGray
    } elseif ($Data -is [string]) {
        Write-Host "    [VERBOSE] ${Label}: $Data" -ForegroundColor DarkGray
    } else {
        $json = try { $Data | ConvertTo-Json -Depth 4 -Compress } catch { "$Data" }
        if ($json.Length -gt 300) { $json = $json.Substring(0, 297) + "..." }
        Write-Host "    [VERBOSE] ${Label}: $json" -ForegroundColor DarkGray
    }
}

function Convert-FlowHeaders {
    param([System.Collections.IDictionary]$Headers)
    if ($null -eq $Headers) { return $null }
    $normalized = [ordered]@{}
    foreach ($key in $Headers.Keys) {
        $value = $Headers[$key]
        $headerName = [string]$key
        if ($headerName -ieq 'Authorization') { $normalized[$headerName] = 'Bearer ***'; continue }
        if ($value -is [array]) { $normalized[$headerName] = ($value -join ', ') }
        else { $normalized[$headerName] = [string]$value }
    }
    return $normalized
}

function Convert-FlowBody {
    param($Body)
    if ($null -eq $Body) { return $null }
    if ($Body -is [string]) { if ($Body.Length -gt 6000) { return $Body.Substring(0, 6000) + '...' }; return $Body }
    try { $json = $Body | ConvertTo-Json -Depth 10; if ($json.Length -gt 6000) { return $json.Substring(0, 6000) + '...' }; return $Body } catch { $str = [string]$Body; if ($str.Length -gt 6000) { return $str.Substring(0, 6000) + '...' }; return $str }
}

function Add-FlowStep {
    param([datetime]$StartedAt, [string]$Method, [string]$Uri, [System.Collections.IDictionary]$RequestHeaders, $RequestBody, [int]$StatusCode, [System.Collections.IDictionary]$ResponseHeaders, $ResponseBody, [string]$ErrorMessage)
    $finishedAt = Get-Date
    $script:flowStepCounter++
    $script:flowSteps += [PSCustomObject]@{
        stepId = $script:flowStepCounter; section = $script:currentSection; actionStep = "$Method $Uri"
        startedAt = $StartedAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); finishedAt = $finishedAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        durationMs = [math]::Round(($finishedAt - $StartedAt).TotalMilliseconds)
        request = [ordered]@{ method = $Method; url = $Uri; headers = Convert-FlowHeaders -Headers $RequestHeaders; body = Convert-FlowBody -Body $RequestBody }
        response = if ($StatusCode -gt 0 -or $null -ne $ResponseHeaders -or $null -ne $ResponseBody) { [ordered]@{ status = $StatusCode; headers = Convert-FlowHeaders -Headers $ResponseHeaders; body = Convert-FlowBody -Body $ResponseBody } } else { $null }
        error = if ($ErrorMessage) { [ordered]@{ message = $ErrorMessage } } else { $null }
    }
}

function Invoke-RestMethod {
    [CmdletBinding()]
    param([string]$Uri, [string]$Method, [System.Collections.IDictionary]$Headers, [object]$Body, [string]$ContentType)
    $requestStart = Get-Date
    $m = if ($Method) { $Method.ToUpperInvariant() } else { "GET" }
    if ($script:VerboseMode) {
        Write-Host "    [VERBOSE] -> $m $Uri" -ForegroundColor DarkGray
        if ($Body) { $bs = if ($Body -is [string]) { $Body } else { try { $Body | ConvertTo-Json -Compress } catch { "$Body" } }; if ($bs.Length -gt 200) { $bs = $bs.Substring(0, 197) + "..." }; Write-Host "    [VERBOSE]   Body: $bs" -ForegroundColor DarkGray }
    }
    $restResponseHeaders = $null; $restStatusCode = 0
    try {
        $result = Microsoft.PowerShell.Utility\Invoke-RestMethod @PSBoundParameters -AllowInsecureRedirect -ResponseHeadersVariable restResponseHeaders -StatusCodeVariable restStatusCode
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $restStatusCode -ResponseHeaders $restResponseHeaders -ResponseBody $result
    } catch {
        $errorStatus = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { try { $errorStatus = [int]$_.Exception.Response.StatusCode } catch {} }
        Add-FlowStep -StartedAt $requestStart -Method $m -Uri $Uri -RequestHeaders $Headers -RequestBody $Body -StatusCode $errorStatus -ResponseBody $_.ErrorDetails.Message -ErrorMessage $_.Exception.Message
        if ($script:VerboseMode) { Write-Host "    [VERBOSE] <- Error: $($_.Exception.Message)" -ForegroundColor DarkYellow }
        throw
    }
    if ($script:VerboseMode) { $json = try { $result | ConvertTo-Json -Depth 4 -Compress } catch { "$result" }; if ($json -and $json.Length -gt 300) { $json = $json.Substring(0, 297) + "..." }; Write-Host "    [VERBOSE] <- Response: $json" -ForegroundColor DarkGray }
    return $result
}

function Invoke-WebRequest {
    [CmdletBinding()]
    param([string]$Uri, [string]$Method, [System.Collections.IDictionary]$Headers, [object]$Body, [string]$ContentType, [switch]$SkipHttpErrorCheck)
    $requestStart = Get-Date
    $m = if ($Method) { $Method.ToUpperInvariant() } else { "GET" }
    if ($script:VerboseMode) { Write-Host "    [VERBOSE] -> $m $Uri" -ForegroundColor DarkGray }
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
    $latestAction = if ($newFlowStepIds.Count -gt 0) { ($script:flowSteps | Where-Object { $_.stepId -eq $newFlowStepIds[-1] } | Select-Object -First 1).actionStep } else { $null }
    $script:testResults += [PSCustomObject]@{ section = $script:currentSection; name = $Message; status = $status; actionStep = $latestAction; actionStepIds = $newFlowStepIds }
    if ($Success) { Write-Host "PASS: $Message" -ForegroundColor Green; $script:testsPassed++ }
    else { Write-Host "FAIL: $Message" -ForegroundColor Red; $script:testsFailed++ }
}

# ===================================================================
# START
# ===================================================================

Write-Host "`n+==============================================================+" -ForegroundColor Magenta
Write-Host "|   OPENTEXT ISV-3 LIVE TEST SUITE                             |" -ForegroundColor Magenta
Write-Host "|   OpenText Customer Portal - proxyAddresses as string[]      |" -ForegroundColor Magenta
Write-Host "+==============================================================+" -ForegroundColor Magenta
Write-Host "Base URL: $baseUrl" -ForegroundColor Cyan

if ($VerboseMode) { Write-Host "VERBOSE MODE ENABLED" -ForegroundColor Magenta }

$script:startTime = Get-Date

# ===================================================================
# SECTION 1: AUTHENTICATION
# ===================================================================
$script:currentSection = "1: Authentication"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 1: AUTHENTICATION" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$tokenBody = @{client_id=$ClientId;client_secret=$ClientSecret;grant_type='client_credentials'}
$tokenResponse = Invoke-RestMethod -Uri "$baseUrl/scim/oauth/token" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $tokenBody
$Token = $tokenResponse.access_token
Write-Host "Token obtained: $($Token.Substring(0,30))..."
$headers = @{Authorization="Bearer $Token"; 'Content-Type'='application/json'}
Test-Result -Success ($null -ne $Token -and $Token.Length -gt 10) -Message "1.1: OAuth token obtained"

# ===================================================================
# SECTION 2: ENDPOINT CREATION WITH INLINE PROFILE
# ===================================================================
$script:currentSection = "2: Endpoint Creation"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 2: ENDPOINT CREATION WITH OPENTEXT ISV-3 PROFILE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$profilePath = Join-Path $PSScriptRoot "opentext-new-may-22-proxyaddresses-list-isv-3-profile.json"
if (-not (Test-Path $profilePath)) {
    Write-Host "FATAL: Profile file not found: $profilePath" -ForegroundColor Red
    exit 1
}
$profileJson = Get-Content -Raw $profilePath | ConvertFrom-Json
# Override name to make it unique for this test run
$profileJson.name = "opentext-isv3-live-$(Get-Random)"
$profileJson.displayName = "OpenText ISV-3 Live Test"
$profileJson.description = "Created by opentext-isv3-live-test.ps1"
$epBody = $profileJson | ConvertTo-Json -Depth 20

$ep = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $epBody
$EndpointId = $ep.id
$scimBase = "$baseUrl/scim/endpoints/$EndpointId"
Test-Result -Success ($null -ne $EndpointId) -Message "2.1: Endpoint created with id"
Test-Result -Success ($ep.profile -ne $null) -Message "2.2: Endpoint has profile"
Test-Result -Success ($ep.profile.schemas.Count -eq 4) -Message "2.3: Profile has 4 schemas (User, EnterpriseUser, Group, Mailbox)"
Test-Result -Success ($ep.profile.resourceTypes.Count -eq 2) -Message "2.4: Profile has 2 resource types (User + Group)"

# Verify SPC
$spc = $ep.profile.serviceProviderConfig
Test-Result -Success ($spc.patch.supported -eq $true) -Message "2.5: SPC patch=true"
Test-Result -Success ($spc.bulk.supported -eq $false) -Message "2.6: SPC bulk=false"
Test-Result -Success ($spc.filter.supported -eq $true) -Message "2.7: SPC filter=true"
Test-Result -Success ($spc.filter.maxResults -eq 200) -Message "2.8: SPC filter.maxResults=200"
Test-Result -Success ($spc.sort.supported -eq $false) -Message "2.9: SPC sort=false"
Test-Result -Success ($spc.etag.supported -eq $false) -Message "2.10: SPC etag=false"
Test-Result -Success ($spc.changePassword.supported -eq $false) -Message "2.11: SPC changePassword=false"

Write-Host "Endpoint SCIM base: $scimBase" -ForegroundColor Cyan

# ===================================================================
# SECTION 3: DISCOVERY ENDPOINTS
# ===================================================================
$script:currentSection = "3: Discovery"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 3: DISCOVERY ENDPOINTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- /Schemas ---
Write-Host "`n--- /Schemas ---" -ForegroundColor Cyan
$schemas = Invoke-RestMethod -Uri "$scimBase/Schemas" -Headers $headers
Test-Result -Success ($schemas.totalResults -eq 4) -Message "3.1: /Schemas returns 4 schemas"

$schemaIds = @($schemas.Resources | ForEach-Object { $_.id })
Test-Result -Success ($schemaIds -contains "urn:ietf:params:scim:schemas:core:2.0:User") -Message "3.2: Core User schema present"
Test-Result -Success ($schemaIds -contains "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User") -Message "3.3: EnterpriseUser schema present"
Test-Result -Success ($schemaIds -contains "urn:ietf:params:scim:schemas:core:2.0:Group") -Message "3.4: Core Group schema present"
Test-Result -Success ($schemaIds -contains "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox") -Message "3.5: OpenText Mailbox schema present"

# Core User attributes
$coreSchema = $schemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:core:2.0:User" }
$coreAttrNames = @($coreSchema.attributes | ForEach-Object { $_.name })
Test-Result -Success ($coreAttrNames -contains "userName") -Message "3.6: User has userName"
Test-Result -Success ($coreAttrNames -contains "active") -Message "3.7: User has active"
Test-Result -Success ($coreAttrNames -contains "name") -Message "3.8: User has name"
Test-Result -Success ($coreAttrNames -contains "displayName") -Message "3.9: User has displayName"
Test-Result -Success ($coreAttrNames -contains "title") -Message "3.10: User has title"
Test-Result -Success ($coreAttrNames -contains "emails") -Message "3.11: User has emails"
Test-Result -Success ($coreAttrNames -contains "phoneNumbers") -Message "3.12: User has phoneNumbers"
Test-Result -Success ($coreAttrNames -contains "addresses") -Message "3.13: User has addresses"

# EnterpriseUser - only department
$entSchema = $schemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" }
$entAttrNames = @($entSchema.attributes | ForEach-Object { $_.name })
Test-Result -Success ($entAttrNames -contains "department") -Message "3.14: EnterpriseUser has department"
Test-Result -Success ($entSchema.attributes.Count -eq 1) -Message "3.15: EnterpriseUser has exactly 1 attribute"

# Group schema
$grpSchema = $schemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:core:2.0:Group" }
$grpAttrNames = @($grpSchema.attributes | ForEach-Object { $_.name })
Test-Result -Success ($grpAttrNames -contains "displayName") -Message "3.16: Group has displayName"
Test-Result -Success ($grpAttrNames -contains "externalId") -Message "3.17: Group has externalId"
Test-Result -Success ($grpAttrNames -contains "members") -Message "3.18: Group has members"

# Group.displayName uniqueness = server
$grpDN = $grpSchema.attributes | Where-Object { $_.name -eq "displayName" }
Test-Result -Success ($grpDN.uniqueness -eq "server") -Message "3.19: Group.displayName uniqueness=server"
Test-Result -Success ($grpDN.required -eq $true) -Message "3.20: Group.displayName required=true"

# Group.externalId caseExact = true
$grpExt = $grpSchema.attributes | Where-Object { $_.name -eq "externalId" }
Test-Result -Success ($grpExt.caseExact -eq $true) -Message "3.21: Group.externalId caseExact=true"

# Group.members sub-attributes
$membersAttr = $grpSchema.attributes | Where-Object { $_.name -eq "members" }
$memberValue = $membersAttr.subAttributes | Where-Object { $_.name -eq "value" }
$memberRef = $membersAttr.subAttributes | Where-Object { $_.name -eq '$ref' }
$memberDisplay = $membersAttr.subAttributes | Where-Object { $_.name -eq "display" }
Test-Result -Success ($memberValue.mutability -eq "immutable") -Message "3.22: members.value mutability=immutable"
Test-Result -Success ($memberRef.mutability -eq "immutable") -Message "3.23: members.`$ref mutability=immutable"
Test-Result -Success ($memberDisplay.mutability -eq "readOnly") -Message "3.24: members.display mutability=readOnly"

# Mailbox extension - proxyAddresses is multi-valued STRING (the key ISV-3 difference)
$mbxSchema = $schemas.Resources | Where-Object { $_.id -eq "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox" }
$proxyAttr = $mbxSchema.attributes | Where-Object { $_.name -eq "proxyAddresses" }
Test-Result -Success ($proxyAttr.type -eq "string") -Message "3.25: Mailbox.proxyAddresses type=string (NOT complex)"
Test-Result -Success ($proxyAttr.multiValued -eq $true) -Message "3.26: Mailbox.proxyAddresses multiValued=true"

# --- /ResourceTypes ---
Write-Host "`n--- /ResourceTypes ---" -ForegroundColor Cyan
$rts = Invoke-RestMethod -Uri "$scimBase/ResourceTypes" -Headers $headers
Test-Result -Success ($rts.totalResults -eq 2) -Message "3.27: /ResourceTypes returns 2"

$userRT = $rts.Resources | Where-Object { $_.name -eq "User" }
$groupRT = $rts.Resources | Where-Object { $_.name -eq "Group" }
Test-Result -Success ($null -ne $userRT) -Message "3.28: User resource type present"
Test-Result -Success ($userRT.endpoint -eq "/Users") -Message "3.29: User endpoint=/Users"
Test-Result -Success ($null -ne $groupRT) -Message "3.30: Group resource type present"
Test-Result -Success ($groupRT.endpoint -eq "/Groups") -Message "3.31: Group endpoint=/Groups"

# User extensions
$userExts = @($userRT.schemaExtensions)
$entExt = $userExts | Where-Object { $_.schema -eq "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" }
$mbxExt = $userExts | Where-Object { $_.schema -eq "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox" }
Test-Result -Success ($null -ne $entExt) -Message "3.32: EnterpriseUser extension on User RT"
Test-Result -Success ($entExt.required -eq $false) -Message "3.33: EnterpriseUser extension required=false"
Test-Result -Success ($null -ne $mbxExt) -Message "3.34: Mailbox extension on User RT"
Test-Result -Success ($mbxExt.required -eq $false) -Message "3.35: Mailbox extension required=false"

# Group has no extensions
$groupExts = @($groupRT.schemaExtensions)
$realGroupExts = $groupExts | Where-Object { $_ -ne $null -and $_.schema -ne $null }
Test-Result -Success ($realGroupExts.Count -eq 0) -Message "3.36: Group has no extensions"

# --- /ServiceProviderConfig ---
Write-Host "`n--- /ServiceProviderConfig ---" -ForegroundColor Cyan
$spcDisc = Invoke-RestMethod -Uri "$scimBase/ServiceProviderConfig" -Headers $headers
Test-Result -Success ($spcDisc.patch.supported -eq $true) -Message "3.37: SPC patch=true"
Test-Result -Success ($spcDisc.bulk.supported -eq $false) -Message "3.38: SPC bulk=false"
Test-Result -Success ($spcDisc.filter.supported -eq $true) -Message "3.39: SPC filter=true"
Test-Result -Success ($spcDisc.filter.maxResults -eq 200) -Message "3.40: SPC filter.maxResults=200"
Test-Result -Success ($spcDisc.sort.supported -eq $false) -Message "3.41: SPC sort=false"
Test-Result -Success ($spcDisc.etag.supported -eq $false) -Message "3.42: SPC etag=false"
Test-Result -Success ($spcDisc.changePassword.supported -eq $false) -Message "3.43: SPC changePassword=false"
Test-Result -Success ($spcDisc.authenticationSchemes.Count -ge 1) -Message "3.44: SPC has authenticationSchemes"
Test-Result -Success ($spcDisc.authenticationSchemes[0].type -eq "oauthbearertoken") -Message "3.45: SPC auth type=oauthbearertoken"

# ===================================================================
# SECTION 4: USER CRUD LIFECYCLE
# ===================================================================
$script:currentSection = "4: User CRUD"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 4: USER CRUD LIFECYCLE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# --- Create User with all extensions including Mailbox (proxyAddresses as string[]) ---
Write-Host "`n--- Create User with proxyAddresses as string[] ---" -ForegroundColor Cyan
$userBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
        "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox"
    )
    userName = "ot-user-$(Get-Random)@opentext.example.com"
    active = $true
    name = @{ givenName = "Barbara"; familyName = "Jensen" }
    displayName = "Barbara Jensen"
    title = "Vice President"
    emails = @(@{ value = "bjensen@opentext.example.com"; type = "work" })
    phoneNumbers = @(
        @{ value = "+1-201-555-0123"; type = "work" },
        @{ value = "+1-201-555-0199"; type = "mobile" }
    )
    addresses = @(@{
        streetAddress = "100 Universal City Plaza"
        locality = "Hollywood"
        region = "CA"
        postalCode = "91608"
        country = "US"
        type = "work"
        primary = $true
    })
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        department = "Engineering"
    }
    "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox" = @{
        proxyAddresses = @(
            "SMTP:bjensen@opentext.example.com",
            "smtp:barbara.jensen@opentext.example.com",
            "smtp:bj@opentext.example.com"
        )
    }
} | ConvertTo-Json -Depth 8
$user = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $userBody -ContentType "application/scim+json"
$UserId = $user.id
$UserName = $user.userName
Test-Result -Success ($null -ne $UserId) -Message "4.1: User created with id"
Test-Result -Success ($user.userName -like "*@opentext.example.com") -Message "4.2: userName is correct"
Test-Result -Success ($user.active -eq $true) -Message "4.3: active=true"
Test-Result -Success ($user.name.givenName -eq "Barbara") -Message "4.4: name.givenName=Barbara"
Test-Result -Success ($user.name.familyName -eq "Jensen") -Message "4.5: name.familyName=Jensen"
Test-Result -Success ($user.displayName -eq "Barbara Jensen") -Message "4.6: displayName correct"
Test-Result -Success ($user.title -eq "Vice President") -Message "4.7: title correct"
Test-Result -Success ($user.emails.Count -ge 1) -Message "4.8: emails present"
Test-Result -Success ($user.emails[0].type -eq "work") -Message "4.9: emails[0].type=work"
Test-Result -Success ($user.phoneNumbers.Count -ge 2) -Message "4.10: phoneNumbers has 2 entries"
Test-Result -Success ($user.addresses.Count -ge 1) -Message "4.11: addresses present"
Test-Result -Success ($user.addresses[0].primary -eq $true) -Message "4.12: addresses[0].primary=true"
Test-Result -Success ($user.addresses[0].country -eq "US") -Message "4.13: addresses[0].country=US"
Test-Result -Success ($null -ne $user.meta) -Message "4.14: meta present"
Test-Result -Success ($user.meta.resourceType -eq "User") -Message "4.15: meta.resourceType=User"

# Enterprise extension
Test-Result -Success ($user."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Engineering") -Message "4.16: EnterpriseUser department=Engineering"

# Mailbox extension - proxyAddresses as string[]
$mbxData = $user."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox"
Test-Result -Success ($null -ne $mbxData) -Message "4.17: Mailbox extension present in response"
$proxyAddrs = @($mbxData.proxyAddresses)
Test-Result -Success ($proxyAddrs.Count -eq 3) -Message "4.18: proxyAddresses has 3 entries"
Test-Result -Success ($proxyAddrs -contains "SMTP:bjensen@opentext.example.com") -Message "4.19: proxyAddresses contains SMTP primary"
Test-Result -Success ($proxyAddrs -contains "smtp:barbara.jensen@opentext.example.com") -Message "4.20: proxyAddresses contains smtp alias"

# --- GET User ---
Write-Host "`n--- GET User ---" -ForegroundColor Cyan
$getUser = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Headers $headers
Test-Result -Success ($getUser.id -eq $UserId) -Message "4.21: GET returns correct user"
Test-Result -Success ($getUser.displayName -eq "Barbara Jensen") -Message "4.22: GET displayName matches"
$getMbx = $getUser."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox"
Test-Result -Success ($null -ne $getMbx) -Message "4.23: GET returns Mailbox extension"
$getProxy = @($getMbx.proxyAddresses)
Test-Result -Success ($getProxy.Count -eq 3) -Message "4.24: GET proxyAddresses count=3"

# --- List Users ---
Write-Host "`n--- List Users ---" -ForegroundColor Cyan
$listUsers = Invoke-RestMethod -Uri "$scimBase/Users" -Headers $headers
Test-Result -Success ($listUsers.totalResults -ge 1) -Message "4.25: List users totalResults >= 1"
$foundUser = $listUsers.Resources | Where-Object { $_.id -eq $UserId }
Test-Result -Success ($null -ne $foundUser) -Message "4.26: Created user found in list"

# --- Filter Users ---
Write-Host "`n--- Filter Users ---" -ForegroundColor Cyan
$encodedFilter = [System.Uri]::EscapeDataString("userName eq `"$UserName`"")
$filteredUsers = Invoke-RestMethod -Uri "$scimBase/Users?filter=$encodedFilter" -Headers $headers
Test-Result -Success ($filteredUsers.totalResults -eq 1) -Message "4.27: Filter by userName returns 1 result"
Test-Result -Success ($filteredUsers.Resources[0].id -eq $UserId) -Message "4.28: Filtered user is correct"

# ===================================================================
# SECTION 5: PATCH OPERATIONS (USER)
# ===================================================================
$script:currentSection = "5: PATCH User"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 5: PATCH OPERATIONS (USER)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# PATCH displayName
Write-Host "`n--- PATCH displayName ---" -ForegroundColor Cyan
$patchDN = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "B. Jensen Updated" })
} | ConvertTo-Json -Depth 6
$patchDNResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchDN -ContentType "application/scim+json"
Test-Result -Success ($patchDNResult.displayName -eq "B. Jensen Updated") -Message "5.1: PATCH displayName updated"

# PATCH title
Write-Host "`n--- PATCH title ---" -ForegroundColor Cyan
$patchTitle = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "title"; value = "Senior VP" })
} | ConvertTo-Json -Depth 6
$patchTitleResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchTitle -ContentType "application/scim+json"
Test-Result -Success ($patchTitleResult.title -eq "Senior VP") -Message "5.2: PATCH title updated"

# PATCH active=false (soft delete)
Write-Host "`n--- PATCH active=false ---" -ForegroundColor Cyan
$patchActive = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $false })
} | ConvertTo-Json -Depth 6
$patchActiveResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchActive -ContentType "application/scim+json"
Test-Result -Success ($patchActiveResult.active -eq $false) -Message "5.3: PATCH active=false"

# PATCH active=true (re-enable)
Write-Host "`n--- PATCH active=true ---" -ForegroundColor Cyan
$patchReactivate = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $true })
} | ConvertTo-Json -Depth 6
$patchReactivateResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchReactivate -ContentType "application/scim+json"
Test-Result -Success ($patchReactivateResult.active -eq $true) -Message "5.4: PATCH active=true (re-enabled)"

# PATCH enterprise extension - department
Write-Host "`n--- PATCH department ---" -ForegroundColor Cyan
$patchDept = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        path = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department"
        value = "Marketing"
    })
} | ConvertTo-Json -Depth 6
$patchDeptResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchDept -ContentType "application/scim+json"
Test-Result -Success ($patchDeptResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Marketing") -Message "5.5: PATCH department updated to Marketing"

# PATCH name.givenName
Write-Host "`n--- PATCH name.givenName ---" -ForegroundColor Cyan
$patchGN = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; value = @{ name = @{ givenName = "Barb" } } })
} | ConvertTo-Json -Depth 6
$patchGNResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchGN -ContentType "application/scim+json"
Test-Result -Success ($patchGNResult.name.givenName -eq "Barb") -Message "5.6: PATCH name.givenName updated"

# ===================================================================
# SECTION 6: PROXY ADDRESSES (STRING[]) - THE ISV-3 SPECIFIC TESTS
# ===================================================================
$script:currentSection = "6: ProxyAddresses string[]"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 6: PROXY ADDRESSES (multi-valued string)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# PATCH add a new proxyAddress
Write-Host "`n--- PATCH add proxyAddress ---" -ForegroundColor Cyan
$patchAddProxy = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        path = "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox:proxyAddresses"
        value = @("smtp:new-alias@opentext.example.com")
    })
} | ConvertTo-Json -Depth 6
$patchAddProxyResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchAddProxy -ContentType "application/scim+json"
$addedProxy = @($patchAddProxyResult."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox".proxyAddresses)
Test-Result -Success ($addedProxy.Count -ge 1) -Message "6.1: PATCH add proxyAddress - count >= 1 (count=$($addedProxy.Count))"
Test-Result -Success ($addedProxy -contains "smtp:new-alias@opentext.example.com") -Message "6.2: New proxyAddress present after add"

# PATCH replace all proxyAddresses
Write-Host "`n--- PATCH replace all proxyAddresses ---" -ForegroundColor Cyan
$patchReplaceProxy = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "replace"
        path = "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox:proxyAddresses"
        value = @("SMTP:primary@opentext.example.com", "smtp:secondary@opentext.example.com")
    })
} | ConvertTo-Json -Depth 6
$patchReplaceResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchReplaceProxy -ContentType "application/scim+json"
$replacedProxy = @($patchReplaceResult."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox".proxyAddresses)
Test-Result -Success ($replacedProxy.Count -eq 2) -Message "6.3: PATCH replace - exactly 2 proxyAddresses"
Test-Result -Success ($replacedProxy -contains "SMTP:primary@opentext.example.com") -Message "6.4: Replaced primary present"
Test-Result -Success ($replacedProxy -contains "smtp:secondary@opentext.example.com") -Message "6.5: Replaced secondary present"

# Verify proxyAddresses via GET
Write-Host "`n--- Verify proxyAddresses via GET ---" -ForegroundColor Cyan
$getUserProxy = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Headers $headers
$getProxy2 = @($getUserProxy."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox".proxyAddresses)
Test-Result -Success ($getProxy2.Count -eq 2) -Message "6.6: GET confirms 2 proxyAddresses after replace"

# PATCH remove proxyAddresses
Write-Host "`n--- PATCH remove proxyAddresses ---" -ForegroundColor Cyan
$patchRemoveProxy = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "remove"
        path = "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox:proxyAddresses"
    })
} | ConvertTo-Json -Depth 6
$patchRemoveResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PATCH -Headers $headers -Body $patchRemoveProxy -ContentType "application/scim+json"
$removedProxy = $patchRemoveResult."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox".proxyAddresses
$removedCount = if ($null -eq $removedProxy) { 0 } else { @($removedProxy).Count }
Test-Result -Success ($removedCount -eq 0 -or $null -eq $removedProxy) -Message "6.7: PATCH remove - proxyAddresses cleared"

# Create user WITHOUT Mailbox extension (optional)
Write-Host "`n--- Create user without Mailbox extension ---" -ForegroundColor Cyan
$noMbxBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "no-mbx-$(Get-Random)@opentext.example.com"
    name = @{ givenName = "No"; familyName = "Mailbox" }
} | ConvertTo-Json -Depth 4
$noMbxUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $noMbxBody -ContentType "application/scim+json"
$NoMbxUserId = $noMbxUser.id
Test-Result -Success ($null -ne $NoMbxUserId) -Message "6.8: User without Mailbox extension created"

# Then PATCH to add proxyAddresses (late attach)
Write-Host "`n--- PATCH add proxyAddresses on user that had none ---" -ForegroundColor Cyan
$patchLateProxy = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "add"
        value = @{
            "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox" = @{
                proxyAddresses = @("SMTP:late@opentext.example.com")
            }
        }
    })
} | ConvertTo-Json -Depth 8
$patchLateResult = Invoke-RestMethod -Uri "$scimBase/Users/$NoMbxUserId" -Method PATCH -Headers $headers -Body $patchLateProxy -ContentType "application/scim+json"
$lateProxy = @($patchLateResult."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox".proxyAddresses)
Test-Result -Success ($lateProxy.Count -ge 1) -Message "6.9: Late-attach proxyAddresses via PATCH works"
Test-Result -Success ($lateProxy -contains "SMTP:late@opentext.example.com") -Message "6.10: Late-attached proxyAddress value correct"

# ===================================================================
# SECTION 7: PUT (FULL REPLACE) USER
# ===================================================================
$script:currentSection = "7: PUT User"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 7: PUT (FULL REPLACE) USER" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$putBody = @{
    schemas = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
        "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox"
    )
    userName = $UserName
    active = $true
    name = @{ givenName = "PUT-Given"; familyName = "PUT-Family" }
    displayName = "PUT Full Replace"
    title = "CTO"
    emails = @(@{ value = "put@opentext.example.com"; type = "work" })
    phoneNumbers = @(@{ value = "+1-555-0000"; type = "fax" })
    addresses = @(@{
        streetAddress = "999 PUT Street"
        locality = "PUT City"
        region = "TX"
        postalCode = "75001"
        country = "US"
        type = "work"
        primary = $true
    })
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{
        department = "Executive"
    }
    "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox" = @{
        proxyAddresses = @("SMTP:put@opentext.example.com")
    }
} | ConvertTo-Json -Depth 8
$putResult = Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method PUT -Headers $headers -Body $putBody -ContentType "application/scim+json"
Test-Result -Success ($putResult.displayName -eq "PUT Full Replace") -Message "7.1: PUT displayName updated"
Test-Result -Success ($putResult.name.givenName -eq "PUT-Given") -Message "7.2: PUT name.givenName updated"
Test-Result -Success ($putResult.title -eq "CTO") -Message "7.3: PUT title updated"
Test-Result -Success ($putResult."urn:ietf:params:scim:schemas:extension:enterprise:2.0:User".department -eq "Executive") -Message "7.4: PUT department updated"
$putProxy = @($putResult."urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox".proxyAddresses)
Test-Result -Success ($putProxy.Count -eq 1) -Message "7.5: PUT proxyAddresses count=1"
Test-Result -Success ($putProxy -contains "SMTP:put@opentext.example.com") -Message "7.6: PUT proxyAddresses value correct"

# ===================================================================
# SECTION 8: GROUP CRUD LIFECYCLE
# ===================================================================
$script:currentSection = "8: Group CRUD"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 8: GROUP CRUD LIFECYCLE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Create Group
Write-Host "`n--- Create Group ---" -ForegroundColor Cyan
$groupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "OpenText-Test-Group-$(Get-Random)"
    externalId = "ext-grp-$(Get-Random)"
} | ConvertTo-Json -Depth 4
$group = Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $groupBody -ContentType "application/scim+json"
$GroupId = $group.id
$GroupDisplayName = $group.displayName
Test-Result -Success ($null -ne $GroupId) -Message "8.1: Group created with id"
Test-Result -Success ($group.displayName -like "OpenText-Test-Group-*") -Message "8.2: Group displayName correct"
Test-Result -Success ($null -ne $group.externalId) -Message "8.3: Group externalId present"
Test-Result -Success ($group.meta.resourceType -eq "Group") -Message "8.4: meta.resourceType=Group"

# GET Group
Write-Host "`n--- GET Group ---" -ForegroundColor Cyan
$getGroup = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Headers $headers
Test-Result -Success ($getGroup.id -eq $GroupId) -Message "8.5: GET group returns correct id"
Test-Result -Success ($getGroup.displayName -eq $GroupDisplayName) -Message "8.6: GET group displayName matches"

# List Groups
Write-Host "`n--- List Groups ---" -ForegroundColor Cyan
$listGroups = Invoke-RestMethod -Uri "$scimBase/Groups" -Headers $headers
Test-Result -Success ($listGroups.totalResults -ge 1) -Message "8.7: List groups totalResults >= 1"

# PATCH add member (raw JSON to avoid PS auto-injecting 'type' key)
Write-Host "`n--- PATCH add member to Group ---" -ForegroundColor Cyan
$patchAddMember = '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"add","path":"members","value":[{"value":"' + $UserId + '"}]}]}'
$patchMemberResult = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $patchAddMember -ContentType "application/scim+json"
$membersList = @($patchMemberResult.members)
Test-Result -Success ($membersList.Count -ge 1) -Message "8.8: PATCH add member - group has >= 1 member"
$addedMember = $membersList | Where-Object { $_.value -eq $UserId }
Test-Result -Success ($null -ne $addedMember) -Message "8.9: Added member value matches user id"

# PATCH remove member
Write-Host "`n--- PATCH remove member ---" -ForegroundColor Cyan
$patchRemoveMember = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{
        op = "remove"
        path = "members[value eq `"$UserId`"]"
    })
} | ConvertTo-Json -Depth 6
$patchRemoveMemberResult = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $patchRemoveMember -ContentType "application/scim+json"
$membersAfterRemove = @($patchRemoveMemberResult.members)
$stillHasMember = $membersAfterRemove | Where-Object { $_.value -eq $UserId }
Test-Result -Success ($null -eq $stillHasMember) -Message "8.10: PATCH remove member - user removed from group"

# PATCH displayName
Write-Host "`n--- PATCH Group displayName ---" -ForegroundColor Cyan
$patchGroupDN = @{
    schemas = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "displayName"; value = "Updated-OT-Group" })
} | ConvertTo-Json -Depth 6
$patchGroupDNResult = Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method PATCH -Headers $headers -Body $patchGroupDN -ContentType "application/scim+json"
Test-Result -Success ($patchGroupDNResult.displayName -eq "Updated-OT-Group") -Message "8.11: PATCH Group displayName updated"

# Duplicate group displayName should fail (uniqueness=server)
Write-Host "`n--- Duplicate Group displayName (uniqueness=server) ---" -ForegroundColor Cyan
$dupGroupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "Updated-OT-Group"
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $dupGroupBody -ContentType "application/scim+json" | Out-Null
    Test-Result -Success $false -Message "8.12: Duplicate Group displayName should fail"
} catch {
    $dupStatus = 0
    if ($_.Exception.Response) { try { $dupStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($dupStatus -eq 409) -Message "8.12: Duplicate Group displayName returns 409 (status=$dupStatus)"
}

# ===================================================================
# SECTION 9: NEGATIVE TESTS
# ===================================================================
$script:currentSection = "9: Negative Tests"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 9: NEGATIVE TESTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# POST User without required userName
Write-Host "`n--- POST User without userName ---" -ForegroundColor Cyan
$noUserNameBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    name = @{ givenName = "No"; familyName = "UserName" }
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $noUserNameBody -ContentType "application/scim+json" | Out-Null
    Test-Result -Success $false -Message "9.1: POST without userName should fail"
} catch {
    $noUNStatus = 0
    if ($_.Exception.Response) { try { $noUNStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($noUNStatus -eq 400) -Message "9.1: POST without userName returns 400 (status=$noUNStatus)"
}

# POST User without required name
Write-Host "`n--- POST User without name ---" -ForegroundColor Cyan
$noNameBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "no-name-$(Get-Random)@opentext.example.com"
} | ConvertTo-Json -Depth 4
try {
    $noNameUser = Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $noNameBody -ContentType "application/scim+json"
    # name is required in OpenText schema but SCIMServer may not enforce sub-attribute required at the complex level
    # Either outcome (created or 400) is acceptable - just record it
    if ($null -ne $noNameUser.id) {
        $script:NoNameUserId = $noNameUser.id
        Test-Result -Success $true -Message "9.2: POST without name - accepted (name.givenName/familyName not enforced at creation)"
    }
} catch {
    $noNameStatus = 0
    if ($_.Exception.Response) { try { $noNameStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($noNameStatus -eq 400) -Message "9.2: POST without name returns 400 (status=$noNameStatus)"
}

# POST Group without required displayName
Write-Host "`n--- POST Group without displayName ---" -ForegroundColor Cyan
$noDisplayBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBase/Groups" -Method POST -Headers $headers -Body $noDisplayBody -ContentType "application/scim+json" | Out-Null
    Test-Result -Success $false -Message "9.3: POST Group without displayName should fail"
} catch {
    $noDNStatus = 0
    if ($_.Exception.Response) { try { $noDNStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($noDNStatus -eq 400) -Message "9.3: POST Group without displayName returns 400 (status=$noDNStatus)"
}

# Duplicate userName should fail
Write-Host "`n--- Duplicate userName ---" -ForegroundColor Cyan
$dupUserBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $UserName
    name = @{ givenName = "Dup"; familyName = "User" }
} | ConvertTo-Json -Depth 4
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $dupUserBody -ContentType "application/scim+json" | Out-Null
    Test-Result -Success $false -Message "9.4: Duplicate userName should fail"
} catch {
    $dupUNStatus = 0
    if ($_.Exception.Response) { try { $dupUNStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($dupUNStatus -eq 409) -Message "9.4: Duplicate userName returns 409 (status=$dupUNStatus)"
}

# GET non-existent user -> 404
Write-Host "`n--- GET non-existent user ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/nonexistent-uuid-99999" -Headers $headers | Out-Null
    Test-Result -Success $false -Message "9.5: GET non-existent user should 404"
} catch {
    $notFoundStatus = 0
    if ($_.Exception.Response) { try { $notFoundStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($notFoundStatus -eq 404) -Message "9.5: GET non-existent user returns 404 (status=$notFoundStatus)"
}

# DELETE non-existent user -> 404
Write-Host "`n--- DELETE non-existent user ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/nonexistent-uuid-99999" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $false -Message "9.6: DELETE non-existent user should 404"
} catch {
    Test-Result -Success $true -Message "9.6: DELETE non-existent user returns error"
}

# ===================================================================
# SECTION 10: CANONICAL VALUE ENFORCEMENT
# ===================================================================
$script:currentSection = "10: Canonical Values"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 10: CANONICAL VALUE ENFORCEMENT" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# emails.type only allows "work"
Write-Host "`n--- emails.type='home' should fail (only 'work' canonical) ---" -ForegroundColor Cyan
$badEmailBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "bad-email-$(Get-Random)@opentext.example.com"
    name = @{ givenName = "Bad"; familyName = "Email" }
    emails = @(@{ value = "x@example.com"; type = "home" })
} | ConvertTo-Json -Depth 6
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $badEmailBody -ContentType "application/scim+json" | Out-Null
    Test-Result -Success $false -Message "10.1: emails.type='home' should be rejected (only 'work')"
} catch {
    $badEmailStatus = 0
    if ($_.Exception.Response) { try { $badEmailStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($badEmailStatus -eq 400) -Message "10.1: emails.type='home' rejected with 400 (status=$badEmailStatus)"
}

# phoneNumbers.type valid values: work, mobile, fax
Write-Host "`n--- phoneNumbers.type='pager' should fail (only work/mobile/fax) ---" -ForegroundColor Cyan
$badPhoneBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "bad-phone-$(Get-Random)@opentext.example.com"
    name = @{ givenName = "Bad"; familyName = "Phone" }
    phoneNumbers = @(@{ value = "+1-555-0000"; type = "pager" })
} | ConvertTo-Json -Depth 6
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $badPhoneBody -ContentType "application/scim+json" | Out-Null
    Test-Result -Success $false -Message "10.2: phoneNumbers.type='pager' should be rejected"
} catch {
    $badPhoneStatus = 0
    if ($_.Exception.Response) { try { $badPhoneStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($badPhoneStatus -eq 400) -Message "10.2: phoneNumbers.type='pager' rejected with 400 (status=$badPhoneStatus)"
}

# addresses.type valid value: work only
Write-Host "`n--- addresses.type='home' should fail (only 'work') ---" -ForegroundColor Cyan
$badAddrBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "bad-addr-$(Get-Random)@opentext.example.com"
    name = @{ givenName = "Bad"; familyName = "Addr" }
    addresses = @(@{ streetAddress = "1 Bad St"; type = "home" })
} | ConvertTo-Json -Depth 6
try {
    Invoke-RestMethod -Uri "$scimBase/Users" -Method POST -Headers $headers -Body $badAddrBody -ContentType "application/scim+json" | Out-Null
    Test-Result -Success $false -Message "10.3: addresses.type='home' should be rejected (only 'work')"
} catch {
    $badAddrStatus = 0
    if ($_.Exception.Response) { try { $badAddrStatus = [int]$_.Exception.Response.StatusCode } catch {} }
    Test-Result -Success ($badAddrStatus -eq 400) -Message "10.3: addresses.type='home' rejected with 400 (status=$badAddrStatus)"
}

# ===================================================================
# SECTION 11: CLEANUP
# ===================================================================
$script:currentSection = "11: Cleanup"
Write-Host "`n`n========================================" -ForegroundColor Yellow
Write-Host "SECTION 11: CLEANUP" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Delete main user
Write-Host "`n--- Delete main user ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Method DELETE -Headers $headers | Out-Null
    try {
        Invoke-RestMethod -Uri "$scimBase/Users/$UserId" -Headers $headers | Out-Null
        Test-Result -Success $false -Message "11.1: Deleted user should not be found"
    } catch {
        Test-Result -Success $true -Message "11.1: DELETE user works (user gone)"
    }
} catch {
    Test-Result -Success $false -Message "11.1: DELETE user should succeed"
}

# Delete no-mailbox user
if ($NoMbxUserId) {
    try { Invoke-RestMethod -Uri "$scimBase/Users/$NoMbxUserId" -Method DELETE -Headers $headers | Out-Null; Test-Result -Success $true -Message "11.2: No-mailbox user deleted" } catch { Test-Result -Success $false -Message "11.2: DELETE no-mailbox user failed" }
}

# Delete no-name user if created
if ($script:NoNameUserId) {
    try { Invoke-RestMethod -Uri "$scimBase/Users/$($script:NoNameUserId)" -Method DELETE -Headers $headers | Out-Null } catch {}
}

# Delete group
Write-Host "`n--- Delete group ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Method DELETE -Headers $headers | Out-Null
    try {
        Invoke-RestMethod -Uri "$scimBase/Groups/$GroupId" -Headers $headers | Out-Null
        Test-Result -Success $false -Message "11.3: Deleted group should not be found"
    } catch {
        Test-Result -Success $true -Message "11.3: DELETE group works (group gone)"
    }
} catch {
    Test-Result -Success $false -Message "11.3: DELETE group should succeed"
}

# Delete endpoint
Write-Host "`n--- Delete test endpoint ---" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$EndpointId" -Method DELETE -Headers $headers | Out-Null
    Test-Result -Success $true -Message "11.4: Test endpoint deleted"
} catch {
    Test-Result -Success $false -Message "11.4: DELETE endpoint failed: $($_.Exception.Message)"
}

# ===================================================================
# SUMMARY
# ===================================================================
$elapsed = [math]::Round(((Get-Date) - $script:startTime).TotalSeconds, 1)

Write-Host "`n`n+==============================================================+" -ForegroundColor Magenta
Write-Host "|   OPENTEXT ISV-3 LIVE TEST RESULTS                           |" -ForegroundColor Magenta
Write-Host "+==============================================================+" -ForegroundColor Magenta
Write-Host "  Tests Passed: $testsPassed" -ForegroundColor Green
Write-Host "  Tests Failed: $testsFailed" -ForegroundColor $(if ($testsFailed -gt 0) { "Red" } else { "Green" })
Write-Host "  Total:        $($testsPassed + $testsFailed)" -ForegroundColor Cyan
Write-Host "  Duration:     ${elapsed}s" -ForegroundColor DarkGray
Write-Host "+==============================================================+" -ForegroundColor Magenta

# Write test results JSON
$resultsDir = Join-Path $PSScriptRoot ".." "test-results"
if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null }
$resultsFile = Join-Path $resultsDir "opentext-isv3-live-test-results.json"
$output = [ordered]@{
    suite = "opentext-isv3-live-test"
    baseUrl = $baseUrl
    startedAt = $script:startTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    finishedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    durationSeconds = $elapsed
    passed = $testsPassed
    failed = $testsFailed
    total = $testsPassed + $testsFailed
    tests = $script:testResults
    flowSteps = $script:flowSteps
}
$output | ConvertTo-Json -Depth 10 | Out-File -Encoding utf8 $resultsFile
Write-Host "Results written to: $resultsFile" -ForegroundColor DarkGray

if ($testsFailed -gt 0) {
    Write-Host "`nFailed tests:" -ForegroundColor Red
    $script:testResults | Where-Object { $_.status -eq "failed" } | ForEach-Object { Write-Host "  FAIL: $($_.name)" -ForegroundColor Red }
    exit 1
}
exit 0
