# Create-OpenTextIsv1Endpoint.ps1
#
# Creates the OpenText-ISV-1 endpoint on a target SCIMServer (dev or prod).
# - Idempotent: if an endpoint with the same name already exists, prints its id and exits 0.
# - Reads inline profile from scripts/opentext-isv-1-profile.json
# - Verifies discovery endpoints (/Schemas, /ResourceTypes, /ServiceProviderConfig)
# - Smoke-creates one User + one Group (cleanup at end) to confirm SCIM CRUD works.
#
# Usage:
#   .\scripts\Create-OpenTextIsv1Endpoint.ps1 -BaseUrl https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io -AdminToken "changeme-scim"
#   .\scripts\Create-OpenTextIsv1Endpoint.ps1 -BaseUrl https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io -AdminToken "changeme-scim"

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $BaseUrl,
    [Parameter(Mandatory = $true)] [string] $AdminToken,
    [string] $EndpointName = "OpenText-ISV-1",
    [string] $ProfilePath = "$PSScriptRoot/opentext-isv-1-profile.json",
    [switch] $SkipSmokeTest
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param([string] $Msg)
    Write-Host ""
    Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Write-Pass {
    param([string] $Msg)
    Write-Host "    [PASS] $Msg" -ForegroundColor Green
}

function Write-Fail {
    param([string] $Msg)
    Write-Host "    [FAIL] $Msg" -ForegroundColor Red
}

function Write-Info {
    param([string] $Msg)
    Write-Host "    [INFO] $Msg" -ForegroundColor DarkGray
}

if (-not (Test-Path $ProfilePath)) {
    throw "Profile file not found: $ProfilePath"
}

$BaseUrl = $BaseUrl.TrimEnd('/')
$adminBase = "$BaseUrl/scim/admin/endpoints"
$adminHeaders = @{ "Authorization" = "Bearer $AdminToken"; "Content-Type" = "application/json" }
$scimHeaders  = @{ "Authorization" = "Bearer $AdminToken"; "Content-Type" = "application/scim+json"; "Accept" = "application/scim+json" }

Write-Step "Target: $BaseUrl"
Write-Info  "Endpoint name: $EndpointName"
Write-Info  "Profile file:  $ProfilePath"

# 1. Idempotent existence check (GET by name)
Write-Step "Checking whether endpoint '$EndpointName' already exists"
$existing = $null
try {
    $existing = Invoke-RestMethod -Uri "$adminBase/by-name/$EndpointName" -Method GET -Headers $adminHeaders
} catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) {
        Write-Fail "Unexpected error querying by-name: $($_.Exception.Message)"
        throw
    }
}

if ($existing) {
    Write-Pass "Endpoint already exists - id=$($existing.id)  scimBasePath=$($existing.scimBasePath)"
    $endpointId = $existing.id
    $scimBase = $existing.scimBasePath
} else {
    Write-Info "Endpoint not found - will create"

    # 2. Load + transform profile (admin POST takes the body verbatim)
    $profileBody = Get-Content -Path $ProfilePath -Raw
    Write-Step "Creating endpoint via POST $adminBase"
    $created = $null
    try {
        $created = Invoke-RestMethod -Uri $adminBase -Method POST -Headers $adminHeaders -Body $profileBody
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            try {
                $stream = $resp.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $errBody = $reader.ReadToEnd()
                Write-Fail "POST failed status=$($resp.StatusCode.value__) body=$errBody"
            } catch { Write-Fail "POST failed: $($_.Exception.Message)" }
        }
        throw
    }
    Write-Pass "Created endpoint id=$($created.id)  scimBasePath=$($created.scimBasePath)"
    $endpointId = $created.id
    $scimBase = $created.scimBasePath
}

if (-not $scimBase) {
    # Compute fallback - profile architecture mounts under /scim/endpoints/{id}
    $scimBase = "/scim/endpoints/$endpointId"
}
$scimRoot = "$BaseUrl$scimBase"
Write-Info "SCIM root: $scimRoot"

# 3. Discovery endpoints
Write-Step "Verifying discovery endpoints"
foreach ($disc in @("/ServiceProviderConfig", "/ResourceTypes", "/Schemas")) {
    $url = "$scimRoot$disc"
    try {
        $resp = Invoke-RestMethod -Uri $url -Method GET -Headers $scimHeaders
        if ($disc -eq "/ResourceTypes") {
            $count = if ($resp.Resources) { $resp.Resources.Count } elseif ($resp.totalResults) { $resp.totalResults } else { 0 }
            Write-Pass "GET $disc -> $count resource types"
        } elseif ($disc -eq "/Schemas") {
            $count = if ($resp.Resources) { $resp.Resources.Count } elseif ($resp.totalResults) { $resp.totalResults } else { 0 }
            Write-Pass "GET $disc -> $count schemas"
        } else {
            Write-Pass "GET $disc -> patch.supported=$($resp.patch.supported) etag.supported=$($resp.etag.supported)"
        }
    } catch {
        Write-Fail "GET $disc failed: $($_.Exception.Message)"
    }
}

if ($SkipSmokeTest) {
    Write-Step "Skipping SCIM smoke test (-SkipSmokeTest)."
    Write-Host ""
    Write-Host "Done. Endpoint id: $endpointId" -ForegroundColor Green
    return
}

# 4. SCIM smoke test (create user + group + cleanup)
Write-Step "SCIM smoke test"
$timestamp = [DateTime]::UtcNow.ToString("yyyyMMddHHmmss")
$smokeUserName = "smoke-user-$timestamp@opentext-isv-1.test"
$userBody = @{
    schemas  = @(
        "urn:ietf:params:scim:schemas:core:2.0:User",
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    )
    userName = $smokeUserName
    name = @{ givenName = "Smoke"; familyName = "Test" }
    displayName = "Smoke Test"
    title = "ISV Smoke Engineer"
    active = $true
    emails = @(@{ value = "smoke@example.com"; type = "work" })
    phoneNumbers = @(@{ value = "+1-555-0100"; type = "mobile" })
    addresses = @(@{
        streetAddress = "1 Microsoft Way"
        locality = "Redmond"
        region = "WA"
        postalCode = "98052"
        country = "US"
        type = "work"
        primary = $true
    })
    proxyAddresses = @(@{ value = "SMTP:smoke@example.com"; type = "primary" })
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{ department = "Provisioning" }
} | ConvertTo-Json -Depth 8

$createdUser = $null
try {
    $createdUser = Invoke-RestMethod -Uri "$scimRoot/Users" -Method POST -Headers $scimHeaders -Body $userBody
    Write-Pass "POST /Users -> id=$($createdUser.id)  userName=$($createdUser.userName)"
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        try {
            $stream = $resp.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errBody = $reader.ReadToEnd()
            Write-Fail "POST /Users status=$($resp.StatusCode.value__) body=$errBody"
        } catch { Write-Fail "POST /Users failed: $($_.Exception.Message)" }
    } else {
        Write-Fail "POST /Users failed: $($_.Exception.Message)"
    }
}

# Negative test: invalid canonical value should be rejected (emails.type only allows "work")
Write-Step "Negative validation: emails.type='home' should fail (only 'work' is canonical)"
$badUserBody = @{
    schemas  = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = "bad-canonical-$timestamp@opentext-isv-1.test"
    name = @{ givenName = "Bad"; familyName = "Canon" }
    emails = @(@{ value = "x@example.com"; type = "home" })
} | ConvertTo-Json -Depth 6
try {
    Invoke-RestMethod -Uri "$scimRoot/Users" -Method POST -Headers $scimHeaders -Body $badUserBody | Out-Null
    Write-Fail "POST /Users with emails.type='home' UNEXPECTEDLY succeeded"
} catch {
    $code = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
    if ($code -eq 400) {
        Write-Pass "POST /Users with emails.type='home' correctly rejected with 400"
    } else {
        Write-Fail "POST /Users with emails.type='home' returned status=$code (expected 400)"
    }
}

# Group create
$groupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "smoke-group-$timestamp"
    members = @()
} | ConvertTo-Json -Depth 4
$createdGroup = $null
try {
    $createdGroup = Invoke-RestMethod -Uri "$scimRoot/Groups" -Method POST -Headers $scimHeaders -Body $groupBody
    Write-Pass "POST /Groups -> id=$($createdGroup.id)  displayName=$($createdGroup.displayName)"
} catch {
    Write-Fail "POST /Groups failed: $($_.Exception.Message)"
}

# Cleanup
if ($createdUser) {
    try { Invoke-RestMethod -Uri "$scimRoot/Users/$($createdUser.id)" -Method DELETE -Headers $scimHeaders | Out-Null; Write-Pass "DELETE smoke user" } catch { Write-Fail "DELETE smoke user failed: $($_.Exception.Message)" }
}
if ($createdGroup) {
    try { Invoke-RestMethod -Uri "$scimRoot/Groups/$($createdGroup.id)" -Method DELETE -Headers $scimHeaders | Out-Null; Write-Pass "DELETE smoke group" } catch { Write-Fail "DELETE smoke group failed: $($_.Exception.Message)" }
}

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " OpenText-ISV-1 endpoint ready on $BaseUrl" -ForegroundColor Cyan
Write-Host "   id           : $endpointId" -ForegroundColor Cyan
Write-Host "   scimBasePath : $scimBase" -ForegroundColor Cyan
Write-Host "   discovery    : $scimRoot/Schemas | /ResourceTypes | /ServiceProviderConfig" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
