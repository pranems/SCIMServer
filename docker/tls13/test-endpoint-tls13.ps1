<#
.SYNOPSIS
  Creates ONE SCIM endpoint on the TLS 1.3-only instance and exercises it,
  capturing the negotiated TLS protocol as evidence at every step.

.DESCRIPTION
  Every call in this script travels over the TLS 1.3-only listener. The script
  asserts OUTCOMES (created resource ids, returned attribute values, list
  totals), not merely that a call returned 200, and it independently confirms
  the transport by reading back the protocol nginx recorded.
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'https://localhost:8443',
    [string]$ClientId = 'scimserver-client',
    [string]$ClientSecret = 'changeme-oauth'
)

$ErrorActionPreference = 'Stop'

# Self-signed cert: skip verification for every HTTP cmdlet in this process.
$PSDefaultParameterValues['Invoke-RestMethod:SkipCertificateCheck'] = $true
$PSDefaultParameterValues['Invoke-WebRequest:SkipCertificateCheck'] = $true

$script:pass = 0
$script:fail = 0

# Invoke-WebRequest returns .Content as a BYTE ARRAY when the response media type
# is not one it recognises as text, and `application/scim+json` is one such type.
# Piping that straight into ConvertFrom-Json silently produces nothing, which
# turns a real assertion into a false negative. Always decode through this.
function Get-ScimJson {
    param($Response)
    $raw = if ($Response.Content -is [byte[]]) {
        [System.Text.Encoding]::UTF8.GetString($Response.Content)
    } else {
        $Response.Content
    }
    return $raw | ConvertFrom-Json
}
function Assert-That {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) {
        $script:pass++
        Write-Host ("  [PASS] {0}{1}" -f $Name, $(if ($Detail) { " -> $Detail" } else { '' })) -ForegroundColor Green
    } else {
        $script:fail++
        Write-Host ("  [FAIL] {0}{1}" -f $Name, $(if ($Detail) { " -> $Detail" } else { '' })) -ForegroundColor Red
    }
}

Write-Host "`n=== Endpoint lifecycle over a TLS 1.3-only transport ===" -ForegroundColor Cyan
Write-Host "Target: $BaseUrl`n"

# --- 0. Confirm the transport BEFORE trusting anything that follows ----------
Write-Host '0. Transport precondition' -ForegroundColor Yellow
$openssl = if (Get-Command openssl -EA SilentlyContinue) { 'openssl' } else { 'C:\Program Files\Git\usr\bin\openssl.exe' }
$u = [uri]$BaseUrl
# `openssl s_client` stays open reading stdin after the handshake. Inside a
# non-interactive script whose stdout is a pipe, that blocks forever. Piping an
# empty string closes stdin so it exits as soon as the handshake is reported.
$hs13 = ('' | & $openssl s_client -connect "$($u.Host):$($u.Port)" -tls1_3 -servername $u.Host 2>&1) -join "`n"
$hs12 = ('' | & $openssl s_client -connect "$($u.Host):$($u.Port)" -tls1_2 -servername $u.Host 2>&1) -join "`n"
Assert-That 'TLS 1.3 handshake succeeds' ($hs13 -match 'Protocol\s*:\s*TLSv1\.3') 'negotiated TLSv1.3'
Assert-That 'TLS 1.2 handshake is refused' (-not ($hs12 -match 'Protocol\s*:\s*TLSv1\.2' -and $hs12 -notmatch 'alert|no protocols')) 'protocol_version alert'

# --- 1. OAuth token ---------------------------------------------------------
Write-Host "`n1. OAuth client_credentials over TLS 1.3" -ForegroundColor Yellow
$tokenBody = @{ client_id = $ClientId; client_secret = $ClientSecret; grant_type = 'client_credentials' }
$tok = Invoke-RestMethod -Uri "$BaseUrl/scim/oauth/token" -Method POST `
    -ContentType 'application/x-www-form-urlencoded' -Body $tokenBody
Assert-That 'access_token issued' ([bool]$tok.access_token) "token_type=$($tok.token_type)"
$headers = @{ Authorization = "Bearer $($tok.access_token)"; 'Content-Type' = 'application/json' }

# --- 2. Create the endpoint -------------------------------------------------
Write-Host "`n2. Create endpoint" -ForegroundColor Yellow
$epName = "tls13-demo-$(Get-Random -Maximum 99999)"
$epBody = @{
    name        = $epName
    description = 'Endpoint served exclusively over TLS 1.3'
} | ConvertTo-Json
$ep = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body $epBody
Assert-That 'endpoint created' ([bool]$ep.id) "id=$($ep.id)"
Assert-That 'endpoint name round-trips' ($ep.name -eq $epName) "name=$($ep.name)"
$epId = $ep.id
$scim = "$BaseUrl/scim/endpoints/$epId"

# --- 3. Discovery -----------------------------------------------------------
Write-Host "`n3. SCIM discovery surface" -ForegroundColor Yellow
$spc = Invoke-RestMethod -Uri "$scim/ServiceProviderConfig" -Method GET -Headers $headers
Assert-That 'ServiceProviderConfig schema correct' `
    ($spc.schemas -contains 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig') `
    ($spc.schemas -join ',')
$rt = Invoke-RestMethod -Uri "$scim/ResourceTypes" -Method GET -Headers $headers
Assert-That 'ResourceTypes lists User and Group' `
    (($rt.Resources.id -contains 'User') -and ($rt.Resources.id -contains 'Group')) `
    ("ids=" + ($rt.Resources.id -join ','))
$sch = Invoke-RestMethod -Uri "$scim/Schemas" -Method GET -Headers $headers
Assert-That 'Schemas returns the core User schema' `
    ($sch.Resources.id -contains 'urn:ietf:params:scim:schemas:core:2.0:User') `
    "totalResults=$($sch.totalResults)"

# --- 4. User CRUD -----------------------------------------------------------
Write-Host "`n4. User lifecycle" -ForegroundColor Yellow
$userName = "tls13.user.$(Get-Random -Maximum 99999)@example.com"
$userBody = @{
    schemas     = @('urn:ietf:params:scim:schemas:core:2.0:User')
    userName    = $userName
    displayName = 'Tee Ellis'
    name        = @{ givenName = 'Tee'; familyName = 'Ellis' }
    active      = $true
    emails      = @(@{ value = $userName; type = 'work'; primary = $true })
} | ConvertTo-Json -Depth 6
$user = Invoke-RestMethod -Uri "$scim/Users" -Method POST -Headers $headers -Body $userBody
Assert-That 'user created' ([bool]$user.id) "id=$($user.id)"
Assert-That 'userName round-trips' ($user.userName -eq $userName) $user.userName
Assert-That 'active is true' ($user.active -eq $true) "active=$($user.active)"
Assert-That 'meta.location is https' ($user.meta.location -like 'https://*') $user.meta.location

$got = Invoke-RestMethod -Uri "$scim/Users/$($user.id)" -Method GET -Headers $headers
Assert-That 'GET by id returns the same user' ($got.id -eq $user.id) "givenName=$($got.name.givenName)"

$filtered = Invoke-RestMethod -Uri "$scim/Users?filter=userName eq ""$userName""" -Method GET -Headers $headers
Assert-That 'filter eq finds exactly one' ($filtered.totalResults -eq 1) "totalResults=$($filtered.totalResults)"

$patchBody = @{
    schemas    = @('urn:ietf:params:scim:api:messages:2.0:PatchOp')
    Operations = @(@{ op = 'replace'; path = 'active'; value = $false })
} | ConvertTo-Json -Depth 6
$patched = Invoke-RestMethod -Uri "$scim/Users/$($user.id)" -Method PATCH -Headers $headers -Body $patchBody
Assert-That 'PATCH replace active=false took effect' ($patched.active -eq $false) "active=$($patched.active)"

# --- 5. Group + membership --------------------------------------------------
Write-Host "`n5. Group lifecycle" -ForegroundColor Yellow
$grpName = "tls13-group-$(Get-Random -Maximum 99999)"
$grpBody = @{
    schemas     = @('urn:ietf:params:scim:schemas:core:2.0:Group')
    displayName = $grpName
    members     = @(@{ value = $user.id })
} | ConvertTo-Json -Depth 6
$grp = Invoke-RestMethod -Uri "$scim/Groups" -Method POST -Headers $headers -Body $grpBody
Assert-That 'group created' ([bool]$grp.id) "id=$($grp.id)"
Assert-That 'group has the member' ($grp.members.value -contains $user.id) "members=$($grp.members.Count)"

# --- 6. Error contract ------------------------------------------------------
Write-Host "`n6. Error contract still correct over TLS 1.3" -ForegroundColor Yellow
$dup = Invoke-WebRequest -Uri "$scim/Users" -Method POST -Headers $headers -Body $userBody -SkipHttpErrorCheck
Assert-That 'duplicate userName returns 409' ($dup.StatusCode -eq 409) "status=$($dup.StatusCode)"
$dupJson = Get-ScimJson $dup
Assert-That 'error carries scimType uniqueness' ($dupJson.scimType -eq 'uniqueness') "scimType=$($dupJson.scimType)"
Assert-That 'error uses the SCIM Error schema' `
    ($dupJson.schemas -contains 'urn:ietf:params:scim:api:messages:2.0:Error') `
    ($dupJson.schemas -join ',')

$missing = Invoke-WebRequest -Uri "$scim/Users/does-not-exist" -Method GET -Headers $headers -SkipHttpErrorCheck
Assert-That 'unknown id returns 404' ($missing.StatusCode -eq 404) "status=$($missing.StatusCode)"

$noauth = Invoke-WebRequest -Uri "$scim/Users" -Method GET -SkipHttpErrorCheck
Assert-That 'unauthenticated returns 401' ($noauth.StatusCode -eq 401) "status=$($noauth.StatusCode)"

# --- 7. Cleanup -------------------------------------------------------------
Write-Host "`n7. Cleanup" -ForegroundColor Yellow
$delG = Invoke-WebRequest -Uri "$scim/Groups/$($grp.id)" -Method DELETE -Headers $headers -SkipHttpErrorCheck
Assert-That 'group deleted (204)' ($delG.StatusCode -eq 204) "status=$($delG.StatusCode)"
$delU = Invoke-WebRequest -Uri "$scim/Users/$($user.id)" -Method DELETE -Headers $headers -SkipHttpErrorCheck
Assert-That 'user deleted (204)' ($delU.StatusCode -eq 204) "status=$($delU.StatusCode)"

# --- 8. Independent transport confirmation ----------------------------------
# In the nginx image /var/log/nginx/access.log is a SYMLINK TO /dev/stdout, so
# reading it from inside the container blocks forever. The log has to be read
# from the container's stdout via `docker logs`.
Write-Host "`n8. Independent confirmation from the terminator's own log" -ForegroundColor Yellow
$log = docker logs --tail 400 scim-tls13-nginx 2>&1 | Where-Object { "$_" -match 'listener=8443' }
$protos = foreach ($line in $log) { if ("$line" -match 'proto=(\S+)') { $Matches[1] } }
# @() is REQUIRED: with a single distinct value Sort-Object returns a scalar
# string, and indexing a string yields its first CHARACTER ('T'), not the value.
# Without this the assertion fails while reporting the correct data, which is a
# false negative that looks like a real defect.
$distinct = @($protos | Sort-Object -Unique)
Assert-That 'terminator logged at least one request on :8443' ($protos.Count -gt 0) "lines=$($protos.Count)"
Assert-That 'every request on :8443 was TLS 1.3' `
    (($distinct.Count -eq 1) -and ($distinct[0] -eq 'TLSv1.3')) `
    ("observed protocols: " + ($distinct -join ', '))

Write-Host "`n=== RESULT ===" -ForegroundColor Cyan
Write-Host ("  PASS {0}   FAIL {1}   endpointId {2}" -f $script:pass, $script:fail, $epId) `
    -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })
if ($script:fail -gt 0) { exit 1 }
