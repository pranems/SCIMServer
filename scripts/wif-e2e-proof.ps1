<#
.SYNOPSIS
    WIF end-to-end proof harness - validates the FULL Workload Identity Federation
    path against a REAL Microsoft Entra application: assertion acquisition ->
    trust establishment -> token mint (RFC 7523) -> resource provisioning.

.DESCRIPTION
    This is the empirical gate the delivery plan calls for (real SyncFabric/Entra
    assertion capture). It does NOT mock the identity provider: it acquires a
    genuine Entra-issued, Microsoft-signed application token and presents it to
    SCIMServer as an RFC 7523 `client_assertion`, so every layer is exercised for
    real - Entra's JWKS is fetched over the network, the signature is verified
    against Microsoft's published keys, and the minted SCIMServer token is then
    used to provision actual SCIM resources.

    Stages:
      1. Acquire a real Entra app-only token (the assertion / "AT1").
      2. Decode + report its claims (diagnostics only - never trusted unverified).
      3. Create a SCIMServer endpoint and establish a WIF trust matching AT1.
      4. Mint the endpoint's own token ("AT2") via the RFC 7523 wire contract.
      5. Decode + report AT2's claims (proves the W3.2 identity separation).
      6. Provision real SCIM resources with AT2 (Users + Groups CRUD).
      7. Probe negative + variation cases (wrong audience, wrong subject,
         resource policy per W3.4, form client_id binding, RFC 8693 support).
      8. Clean up every artifact it created.

    SECURITY: the raw assertion and the raw minted token are NEVER printed or
    written to disk (guide section 8.5). Only decoded, non-secret CLAIM values
    are reported. The Entra client secret is read from the environment and never
    echoed.

.PARAMETER BaseUrl
    SCIMServer base URL. Defaults to the Azure dev deployment.

.PARAMETER AdminToken
    SCIM admin bearer token (the shared secret).

.PARAMETER AppId
    The Entra application (client) id to use as the workload identity.

.PARAMETER TenantId
    The Entra tenant id that issues the assertion.

.PARAMETER ClientSecret
    The Entra app client secret. Prefer supplying via $env:WIF_TEST_SECRET.

.PARAMETER KeepArtifacts
    Skip cleanup (leaves the endpoint + trust in place for manual inspection).

.EXAMPLE
    pwsh -File scripts/wif-e2e-proof.ps1
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = "https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io",
    [string] $AdminToken = "changeme-scim",
    [string] $AppId = $env:WIF_TEST_APPID,
    [string] $TenantId = $env:WIF_TEST_TENANT,
    [string] $ClientSecret = $env:WIF_TEST_SECRET,
    [int] $MintLatencyBudgetMs = 400,
    [switch] $KeepArtifacts
)

$ErrorActionPreference = "Stop"
$script:Pass = 0
$script:Fail = 0
$script:Findings = @()

function Test-Result {
    param([bool] $Success, [string] $Message)
    if ($Success) { $script:Pass++; Write-Host "PASS: $Message" -ForegroundColor Green }
    else { $script:Fail++; Write-Host "FAIL: $Message" -ForegroundColor Red }
}

function Add-Finding {
    param([string] $Id, [string] $Text)
    $script:Findings += [pscustomobject]@{ Id = $Id; Finding = $Text }
    Write-Host "FINDING [$Id]: $Text" -ForegroundColor Yellow
}

function Write-Section {
    param([string] $Title)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

# Decode a JWT segment (base64url) WITHOUT verifying - diagnostics only.
function ConvertFrom-JwtSegment {
    param([string] $Segment)
    $s = $Segment.Replace('-', '+').Replace('_', '/')
    switch ($s.Length % 4) { 2 { $s += '==' } 3 { $s += '=' } 1 { $s += '===' } }
    [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($s)) | ConvertFrom-Json
}

function Get-JwtParts {
    param([string] $Jwt)
    $seg = $Jwt.Split('.')
    if ($seg.Count -lt 2) { throw "Not a JWT (expected 3 segments, got $($seg.Count))" }
    [pscustomobject]@{
        Header  = ConvertFrom-JwtSegment $seg[0]
        Payload = ConvertFrom-JwtSegment $seg[1]
        Segments = $seg.Count
    }
}

$headers = @{ Authorization = "Bearer $AdminToken"; "Content-Type" = "application/json" }
$JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
$TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"

Write-Host "SCIMServer WIF end-to-end proof (REAL Entra assertion)" -ForegroundColor White
Write-Host "Target : $BaseUrl"
Write-Host "AppId  : $AppId"
Write-Host "Tenant : $TenantId"

if (-not $AppId -or -not $TenantId -or -not $ClientSecret) {
    throw "AppId, TenantId and ClientSecret are required (set WIF_TEST_APPID / WIF_TEST_TENANT / WIF_TEST_SECRET)."
}

$srv = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/version" -Headers $headers
Write-Host "Server : v$($srv.version) ($($srv.storage.persistenceBackend) backend)"

# ─────────────────────────────────────────────────────────────────────────────
Write-Section "STAGE 1-2: acquire + decode the REAL Entra assertion (AT1)"
# ─────────────────────────────────────────────────────────────────────────────
$entraTokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
$assertionResp = Invoke-RestMethod -Uri $entraTokenUrl -Method POST `
    -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type    = "client_credentials"
        client_id     = $AppId
        client_secret = $ClientSecret
        scope         = "api://$AppId/.default"
    }
$assertion = $assertionResp.access_token
Test-Result -Success ([bool]$assertion) -Message "S1.T1: Entra issued a real application token (assertion / AT1)"

$at1 = Get-JwtParts $assertion
Write-Host "`n--- AT1 (Entra assertion) JOSE header ---" -ForegroundColor Gray
$at1.Header | ConvertTo-Json -Depth 5
Write-Host "--- AT1 decoded claims (diagnostics only; NEVER trusted unverified) ---" -ForegroundColor Gray
$at1.Payload | ConvertTo-Json -Depth 5

$at1Iss = $at1.Payload.iss
$at1Sub = $at1.Payload.sub
$at1Aud = $at1.Payload.aud
$at1Tid = $at1.Payload.tid
Test-Result -Success ($at1.Header.alg -eq "RS256") -Message "S2.T1: AT1 is RS256-signed (matches the validator's algorithm pin)"
Test-Result -Success ([bool]$at1Tid) -Message "S2.T2: AT1 carries a tid claim (tenant isolation axis)"
Test-Result -Success ([bool]$at1Sub) -Message "S2.T3: AT1 carries a sub claim (subject binding axis)"

# Entra publishes its keys per tenant; the trust must point at the SAME issuer's JWKS.
$jwksUri = "https://login.microsoftonline.com/$TenantId/discovery/v2.0/keys"
if ($at1Iss -like "https://sts.windows.net/*") {
    $jwksUri = "https://login.microsoftonline.com/$TenantId/discovery/keys"
}
Write-Host "Derived jwksUri for the trust: $jwksUri"

# ─────────────────────────────────────────────────────────────────────────────
Write-Section "STAGE 3: endpoint + WIF trust establishment (config setup)"
# ─────────────────────────────────────────────────────────────────────────────
$ep = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{
    name = "wif-proof-$(Get-Random)"; profilePreset = "rfc-standard"
} | ConvertTo-Json)
$epId = $ep.id
Write-Host "Endpoint: $epId"

# WIF must be enabled per the WI-11 per-method enablement gate before a trust can be created.
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$epId" -Method PATCH -Headers $headers -Body (@{
    profile = @{ settings = @{ WifCredentialsEnabled = "True" } }
} | ConvertTo-Json -Depth 6) | Out-Null

$trustBody = @{
    credentialType = "wif"
    label          = "Entra WIF proof"
    wif            = @{
        assertionProfile = "jwt-bearer"
        expectedIssuer   = $at1Iss
        expectedSubject  = $at1Sub
        expectedAudience = $at1Aud
        jwksUri          = $jwksUri
        allowedTenantId  = $at1Tid
        scope            = "scim.read scim.write"
        issuedTokenTtlSec = 3600
        targetClientId   = "scim-wif-client-proof"
    }
}
$trust = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$epId/credentials" -Method POST -Headers $headers -Body ($trustBody | ConvertTo-Json -Depth 6)
Test-Result -Success ($trust.credentialType -eq "wif") -Message "S3.T1: WIF trust established from the REAL assertion's claims"
$trustJson = $trust | ConvertTo-Json -Depth 8
Test-Result -Success (-not ($trustJson -match '"token"|"clientSecret"|"credentialHash"')) -Message "S3.T2: trust response carries NO secret material"
Write-Host "--- trust create response ---" -ForegroundColor Gray
$trustJson

# ─────────────────────────────────────────────────────────────────────────────
Write-Section "STAGE 4-5: mint AT2 via RFC 7523 + decode it"
# ─────────────────────────────────────────────────────────────────────────────
$tokenUrl = "$BaseUrl/scim/endpoints/$epId/oauth/token"
$mintRaw = Invoke-WebRequest -Uri $tokenUrl -Method POST `
    -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type            = "client_credentials"
        client_id             = "scim-wif-client-proof"
        client_assertion      = $assertion
        client_assertion_type = $JWT_BEARER
    }
Test-Result -Success ($mintRaw.StatusCode -eq 200) -Message "S4.T1: token mint returns HTTP 200 (RFC 6749 5.1, W0.2)"
Test-Result -Success ($mintRaw.Headers['Cache-Control'] -contains 'no-store') -Message "S4.T2: mint response carries Cache-Control: no-store"
Test-Result -Success ($mintRaw.Headers['Pragma'] -contains 'no-cache') -Message "S4.T3: mint response carries Pragma: no-cache"
$mintContent = $mintRaw.Content
if ($mintContent -is [byte[]]) { $mintContent = [System.Text.Encoding]::UTF8.GetString($mintContent) }
$mint = $mintContent | ConvertFrom-Json
if (-not $mint.access_token) {
    # Fall back to Invoke-RestMethod (some PS/proxy combinations do not surface .Content).
    $mint = Invoke-RestMethod -Uri $tokenUrl -Method POST -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type            = "client_credentials"
        client_id             = "scim-wif-client-proof"
        client_assertion      = $assertion
        client_assertion_type = $JWT_BEARER
    }
}
Write-Host "--- mint response body (access_token elided) ---" -ForegroundColor Gray
([pscustomobject]@{
    access_token = "<elided - $($mint.access_token.Length) chars>"
    token_type   = $mint.token_type
    expires_in   = $mint.expires_in
    scope        = $mint.scope
} | ConvertTo-Json)
Test-Result -Success ($mint.token_type -eq "Bearer") -Message "S4.T4: token_type is Bearer"

$at2 = Get-JwtParts $mint.access_token
Write-Host "--- AT2 (SCIMServer-minted) decoded claims ---" -ForegroundColor Gray
$at2.Payload | ConvertTo-Json -Depth 5

# W3.2 - the identity separation this wave delivered.
Test-Result -Success ($at2.Payload.client_id -eq "scim-wif-client-proof") -Message "S5.T1 (W3.2): AT2 client_id is the trust's targetClientId"
Test-Result -Success ($at2.Payload.sub -ne $at1Sub) -Message "S5.T2 (W3.2): AT2 sub is NOT the federated assertion subject"
Test-Result -Success ($at2.Payload.src_sub -eq $at1Sub) -Message "S5.T3 (W3.2): the assertion subject is preserved as the distinct src_sub claim"
Test-Result -Success ($at2.Payload.src_iss -eq $at1Iss) -Message "S5.T4 (WI-17): AT2 carries src_iss source attribution"
Test-Result -Success ($at2.Payload.endpoint_id -eq $epId) -Message "S5.T5: AT2 is endpoint-scoped via the endpoint_id claim"

# W3.8 (guide 13.4 + 13.6) - provenance + a unique token id on every AT2.
foreach ($c in @('auth_method','source_tid','source_oid','jti')) {
    if (-not $at2.Payload.PSObject.Properties.Name.Contains($c)) {
        Add-Finding "AT2-$c" "AT2 does not carry the guide-13.4/13.6 claim '$c'"
    }
}
Test-Result -Success ($at2.Payload.auth_method -eq 'syncfabric-rfc7523') -Message "S5.T7 (W3.8): AT2 names the auth profile that authorized it (auth_method)"
Test-Result -Success ($at2.Payload.source_tid -eq $at1Tid) -Message "S5.T8 (W3.8): AT2 carries the federated tenant as source_tid"
Test-Result -Success ([bool]$at2.Payload.jti) -Message "S5.T9 (W3.8): AT2 carries a unique jti (guide 13.6)"
# Guide section 13.5 - AT2 must never outlive the assertion that authorized it.
$at1Exp = [int]$at1.Payload.exp
$at2Exp = [int]$at2.Payload.exp
Test-Result -Success ($at2Exp -le $at1Exp) -Message "S5.T6 (W3.6/guide 13.5): AT2 expiry ($at2Exp) does not outlive the assertion expiry ($at1Exp)"
if ($at2Exp -gt $at1Exp) {
    Add-Finding "AT2-lifetime" "AT2 outlives AT1 by $($at2Exp - $at1Exp)s - guide 13.5 requires min(ttl, assertion exp, server max)"
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Section "STAGE 6: resource provisioning with the minted token"
# ─────────────────────────────────────────────────────────────────────────────
$scim = "$BaseUrl/scim/v2/endpoints/$epId"
$at2Headers = @{ Authorization = "Bearer $($mint.access_token)"; "Content-Type" = "application/scim+json" }

$userName = "wif.proof.$(Get-Random)@example.com"
$newUser = Invoke-RestMethod -Uri "$scim/Users" -Method POST -Headers $at2Headers -Body (@{
    schemas  = @("urn:ietf:params:scim:schemas:core:2.0:User")
    userName = $userName
    name     = @{ givenName = "Wif"; familyName = "Proof" }
    active   = $true
    emails   = @(@{ value = $userName; primary = $true; type = "work" })
} | ConvertTo-Json -Depth 6)
Test-Result -Success ([bool]$newUser.id) -Message "S6.T1: CREATE User with the WIF-minted token (real provisioning)"

$got = Invoke-RestMethod -Uri "$scim/Users/$($newUser.id)" -Headers $at2Headers
Test-Result -Success ($got.userName -eq $userName) -Message "S6.T2: READ the provisioned user back"

$patched = Invoke-RestMethod -Uri "$scim/Users/$($newUser.id)" -Method PATCH -Headers $at2Headers -Body (@{
    schemas    = @("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations = @(@{ op = "replace"; path = "active"; value = $false })
} | ConvertTo-Json -Depth 6)
Test-Result -Success ($patched.active -eq $false) -Message "S6.T3: PATCH (deactivate) the provisioned user"

$list = Invoke-RestMethod -Uri "$scim/Users?filter=userName eq ""$userName""" -Headers $at2Headers
Test-Result -Success ($list.totalResults -ge 1) -Message "S6.T4: FILTER/LIST users"

$grp = Invoke-RestMethod -Uri "$scim/Groups" -Method POST -Headers $at2Headers -Body (@{
    schemas     = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "wif-proof-group-$(Get-Random)"
    members     = @(@{ value = $newUser.id })
} | ConvertTo-Json -Depth 6)
Test-Result -Success ([bool]$grp.id) -Message "S6.T5: CREATE Group with a member (full provisioning surface)"

Invoke-RestMethod -Uri "$scim/Users/$($newUser.id)" -Method DELETE -Headers $at2Headers | Out-Null
Test-Result -Success $true -Message "S6.T6: DELETE the provisioned user"

# Cross-endpoint replay must be refused.
$otherEp = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{
    name = "wif-proof-other-$(Get-Random)"; profilePreset = "rfc-standard"
} | ConvertTo-Json)
$replay = $false
try { Invoke-RestMethod -Uri "$BaseUrl/scim/v2/endpoints/$($otherEp.id)/Users?count=1" -Headers $at2Headers | Out-Null }
catch { $replay = ($_.Exception.Response.StatusCode.value__ -eq 401) }
Test-Result -Success $replay -Message "S6.T7: AT2 is refused on a DIFFERENT endpoint (no cross-endpoint replay)"
try { Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($otherEp.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

# ─────────────────────────────────────────────────────────────────────────────
Write-Section "STAGE 7: negative + variation probes"
# ─────────────────────────────────────────────────────────────────────────────
function Get-MintError {
    param([hashtable] $Body, [string] $Url = $tokenUrl)
    try {
        Invoke-RestMethod -Uri $Url -Method POST -ContentType "application/x-www-form-urlencoded" -Body $Body | Out-Null
        return [pscustomobject]@{ Status = 200; Error = $null; ReasonCode = $null }
    } catch {
        $resp = $_.Exception.Response
        $status = $resp.StatusCode.value__
        $detail = $null
        try { $detail = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
        return [pscustomobject]@{ Status = $status; Error = $detail.error; ReasonCode = $detail.reason_code }
    }
}

# 7a - a garbage assertion must fail closed (never fall through to another method).
$bad = Get-MintError @{ grant_type = "client_credentials"; client_assertion = "a.b.c"; client_assertion_type = $JWT_BEARER }
Test-Result -Success ($bad.Status -eq 401 -and $bad.Error -eq "invalid_client") -Message "S7.T1: a malformed assertion fails closed -> 401 invalid_client (reason=$($bad.ReasonCode))"

# 7b - wrong-audience trust on a second endpoint: the real assertion must be REJECTED.
$epW = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{
    name = "wif-proof-wrongaud-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json)
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epW.id)" -Method PATCH -Headers $headers -Body (@{
    profile = @{ settings = @{ WifCredentialsEnabled = "True" } } } | ConvertTo-Json -Depth 6) | Out-Null
$wrongTrust = $trustBody.Clone(); $wrongWif = $trustBody.wif.Clone()
$wrongWif.expectedAudience = "api://not-the-real-audience"
$wrongTrust.wif = $wrongWif
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epW.id)/credentials" -Method POST -Headers $headers -Body ($wrongTrust | ConvertTo-Json -Depth 6) | Out-Null
$audFail = Get-MintError -Url "$BaseUrl/scim/endpoints/$($epW.id)/oauth/token" -Body @{
    grant_type = "client_credentials"; client_assertion = $assertion; client_assertion_type = $JWT_BEARER }
Test-Result -Success ($audFail.Status -eq 401 -and $audFail.ReasonCode -eq "wif_audience_mismatch") -Message "S7.T2: a REAL assertion with the wrong expectedAudience is rejected (reason=$($audFail.ReasonCode))"
try { Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epW.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

# 7c - W3.7: the FORM client_id MUST be bound to the trust's targetClientId.
$wrongClient = Get-MintError @{
    grant_type = "client_credentials"; client_id = "totally-wrong-client-id"
    client_assertion = $assertion; client_assertion_type = $JWT_BEARER }
if ($wrongClient.Status -eq 200) {
    Add-Finding "W3.7-binding" "A WRONG form client_id still mints a token - the targetClientId binding is NOT enforced (guide 13.1 requires wif_client_id_mismatch)"
}
Test-Result -Success ($wrongClient.Status -eq 401 -and $wrongClient.ReasonCode -eq "wif_client_id_mismatch") -Message "S7.T3 (W3.7): a wrong form client_id is rejected (reason=$($wrongClient.ReasonCode))"
$noClient = $null
try { $noClient = Invoke-RestMethod -Uri $tokenUrl -Method POST -ContentType "application/x-www-form-urlencoded" -Body @{
    grant_type = "client_credentials"; client_assertion = $assertion; client_assertion_type = $JWT_BEARER } } catch {}
Test-Result -Success ([bool]$noClient.access_token) -Message "S7.T3b (W3.7): a request with NO client_id still mints (backward compatible)"

# 7d - W3.4 resource policy on the wire (requiredExact).
$epR = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{
    name = "wif-proof-res-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json)
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epR.id)" -Method PATCH -Headers $headers -Body (@{
    profile = @{ settings = @{ WifCredentialsEnabled = "True" } } } | ConvertTo-Json -Depth 6) | Out-Null
$resTrust = $trustBody.Clone(); $resWif = $trustBody.wif.Clone()
$resWif.resourceMode = "requiredExact"; $resWif.expectedResource = "https://api.successfactors.com"
$resTrust.wif = $resWif
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epR.id)/credentials" -Method POST -Headers $headers -Body ($resTrust | ConvertTo-Json -Depth 6) | Out-Null
$rTokenUrl = "$BaseUrl/scim/endpoints/$($epR.id)/oauth/token"
$rMissing = Get-MintError -Url $rTokenUrl -Body @{ grant_type = "client_credentials"; client_assertion = $assertion; client_assertion_type = $JWT_BEARER }
Test-Result -Success ($rMissing.ReasonCode -eq "wif_resource_required") -Message "S7.T4 (W3.4): requiredExact + missing resource -> $($rMissing.ReasonCode)"
$rWrong = Get-MintError -Url $rTokenUrl -Body @{ grant_type = "client_credentials"; client_assertion = $assertion; client_assertion_type = $JWT_BEARER; resource = "https://api.other.com" }
Test-Result -Success ($rWrong.ReasonCode -eq "wif_resource_mismatch") -Message "S7.T5 (W3.4): requiredExact + wrong resource -> $($rWrong.ReasonCode)"
$rOkRaw = $null
try {
    $rOkRaw = Invoke-RestMethod -Uri $rTokenUrl -Method POST -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type = "client_credentials"; client_assertion = $assertion; client_assertion_type = $JWT_BEARER; resource = "https://api.successfactors.com" }
} catch {}
Test-Result -Success ([bool]$rOkRaw.access_token) -Message "S7.T6 (W3.4): requiredExact + EXACT resource mints successfully"
try { Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epR.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

# 7e - RFC 8693 token-exchange (Wave 4) must be cleanly unsupported, not half-open.
$ex = Get-MintError @{
    grant_type = $TOKEN_EXCHANGE; subject_token = $assertion
    subject_token_type = "urn:ietf:params:oauth:token-type:jwt"
    audience = "$BaseUrl/scim"; scope = "scim.read scim.write"
    requested_token_type = "urn:ietf:params:oauth:token-type:access_token" }
Test-Result -Success ($ex.Status -eq 400 -and $ex.Error -eq "unsupported_grant_type") -Message "S7.T7: RFC 8693 token-exchange is cleanly refused (400 unsupported_grant_type) - Wave 4 not yet implemented"

# 7f - the metadata must not advertise what is not implemented.
$meta = Invoke-RestMethod -Uri "$BaseUrl/scim/endpoints/$epId/.well-known/oauth-authorization-server"
Write-Host "--- per-endpoint RFC 8414 metadata ---" -ForegroundColor Gray
$meta | ConvertTo-Json -Depth 6
Test-Result -Success (-not ($meta.grant_types_supported -contains $TOKEN_EXCHANGE)) -Message "S7.T8 (W0.3): token-exchange is NOT advertised (no handler yet)"
Test-Result -Success ($meta.token_endpoint_auth_methods_supported -contains "private_key_jwt") -Message "S7.T9 (W0.3): private_key_jwt IS advertised (active WIF trust)"
$prof = @($meta.x_scimserver_wif_profiles | Where-Object { $_.name -eq "syncfabric-rfc7523" })[0]
Test-Result -Success ($prof.client_id_binding -eq "target-client-id") -Message "S7.T10: metadata advertises client_id_binding = target-client-id"

# 7g - connection-info: what does the operator see for this WIF endpoint?
$conn = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$epId/connection-info" -Headers $headers
$wifMethod = @($conn.enabledMethods | Where-Object { $_.method -eq "wif" })[0]
Write-Host "--- connection-info: wif method ---" -ForegroundColor Gray
$wifMethod | ConvertTo-Json -Depth 6
if ($wifMethod.entraFields.clientIdentifier -eq $at1Sub) {
    Add-Finding "conn-clientIdentifier" "connection-info still projects the ASSERTION SUBJECT as Entra 'Client identifier'; the trust's targetClientId ($($trustBody.wif.targetClientId)) is not surfaced (guide 16.2)"
}
Test-Result -Success ($wifMethod.entraAuthenticationMethod -eq "Workload Identity based authentication") -Message "S7.T11: connection-info names the Entra auth-method choice for WIF"
Test-Result -Success ($wifMethod.entraFields.clientIdentifier -eq $trustBody.wif.targetClientId) -Message "S7.T11b (W3.9): connection-info surfaces the trust targetClientId as the Entra Client identifier"
Test-Result -Success ($wifMethod.expectedAssertionSubject -eq $at1Sub) -Message "S7.T11c (W3.9): the expected assertion subject is a DISTINCT field, not the client identity"

# 7h - GUIDE 13.5 LIFETIME CAP: does AT2 ever outlive the assertion that authorized it?
# A 6h issuedTokenTtlSec against a 1h Entra assertion makes the answer unambiguous.
$epL = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{
    name = "wif-proof-ttl-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json)
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epL.id)" -Method PATCH -Headers $headers -Body (@{
    profile = @{ settings = @{ WifCredentialsEnabled = "True" } } } | ConvertTo-Json -Depth 6) | Out-Null
$ttlTrust = $trustBody.Clone(); $ttlWif = $trustBody.wif.Clone()
$ttlWif.issuedTokenTtlSec = 21600   # 6 hours - the server's documented ceiling
$ttlTrust.wif = $ttlWif
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epL.id)/credentials" -Method POST -Headers $headers -Body ($ttlTrust | ConvertTo-Json -Depth 6) | Out-Null
$ttlMint = Invoke-RestMethod -Uri "$BaseUrl/scim/endpoints/$($epL.id)/oauth/token" -Method POST `
    -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type = "client_credentials"; client_assertion = $assertion; client_assertion_type = $JWT_BEARER }
$ttlAt2 = Get-JwtParts $ttlMint.access_token
$overrun = [int]$ttlAt2.Payload.exp - [int]$at1.Payload.exp
Write-Host "AT1 exp=$($at1.Payload.exp)  AT2(6h) exp=$($ttlAt2.Payload.exp)  overrun=${overrun}s" -ForegroundColor Gray
if ($overrun -gt 0) {
    Add-Finding "AT2-lifetime-cap" "With issuedTokenTtlSec=21600 the minted AT2 outlives the authorizing assertion by ${overrun}s (~$([math]::Round($overrun/3600,1))h). Guide 13.5 requires min(ttl, assertion exp, server max)."
}
Test-Result -Success ($overrun -le 0) -Message "S7.T12 (W3.6/guide 13.5): a 6h TTL is capped to the 1h assertion - AT2 never outlives its authorization (overrun=${overrun}s)"
try { Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epL.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

# 7i - the `token-exchange` assertionProfile is storable but has no handler (Wave 4).
$epP = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{
    name = "wif-proof-profile-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json)
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epP.id)" -Method PATCH -Headers $headers -Body (@{
    profile = @{ settings = @{ WifCredentialsEnabled = "True" } } } | ConvertTo-Json -Depth 6) | Out-Null
$xTrust = $trustBody.Clone(); $xWif = $trustBody.wif.Clone()
$xWif.assertionProfile = "token-exchange"
$xTrust.wif = $xWif
$xCreated = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epP.id)/credentials" -Method POST -Headers $headers -Body ($xTrust | ConvertTo-Json -Depth 6)
$xMint = $null
try { $xMint = Invoke-RestMethod -Uri "$BaseUrl/scim/endpoints/$($epP.id)/oauth/token" -Method POST `
    -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type = "client_credentials"; client_assertion = $assertion; client_assertion_type = $JWT_BEARER } } catch {}
if ($xCreated.credentialType -eq "wif" -and $xMint.access_token) {
    Add-Finding "profile-not-routed" "A trust saved with assertionProfile='token-exchange' is accepted AND still mints via the jwt-bearer path - assertionProfile is stored but never routed on (no per-variation selection)."
}
Test-Result -Success ($xCreated.credentialType -eq "wif") -Message "S7.T13 (probe): assertionProfile='token-exchange' is accepted at config time"
Test-Result -Success ($null -eq $xMint.access_token) -Message "S7.T13b (W3.1): a token-exchange-scoped trust does NOT authorize a jwt-bearer request (per-variation routing)"
$xMeta = Invoke-RestMethod -Uri "$BaseUrl/scim/endpoints/$($epP.id)/.well-known/oauth-authorization-server" -Method GET
Test-Result -Success (-not (@($xMeta.token_endpoint_auth_methods_supported) -contains 'private_key_jwt')) -Message "S7.T13c (W3.1): the metadata does NOT advertise private_key_jwt for a token-exchange-only trust"
try { Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epP.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

# 7j - the SIBLING auth method: OAuth2 client credentials (Entra's other choice).
$epO = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body (@{
    name = "wif-proof-oauth-$(Get-Random)"; profilePreset = "rfc-standard" } | ConvertTo-Json)
Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epO.id)" -Method PATCH -Headers $headers -Body (@{
    profile = @{ settings = @{ OAuthClientCredentialsAuthEnabled = "True" } } } | ConvertTo-Json -Depth 6) | Out-Null
$oc = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epO.id)/credentials" -Method POST -Headers $headers -Body (@{
    credentialType = "oauth_client"; label = "entra-oauth2-choice" } | ConvertTo-Json)
Test-Result -Success ([bool]$oc.clientId -and [bool]$oc.clientSecret) -Message "S7.T14: oauth_client credential returns a one-time clientId + clientSecret (Entra's 'Client Identifier'/'Client Secret' fields)"
$ocMint = Invoke-RestMethod -Uri "$BaseUrl/scim/endpoints/$($epO.id)/oauth/token" -Method POST `
    -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type = "client_credentials"; client_id = $oc.clientId; client_secret = $oc.clientSecret }
$ocAt2 = Get-JwtParts $ocMint.access_token
Write-Host "--- AT2 minted via OAuth2 client-credentials (for contrast with WIF) ---" -ForegroundColor Gray
$ocAt2.Payload | ConvertTo-Json -Depth 5
Test-Result -Success ($ocAt2.Payload.client_id -eq $oc.clientId) -Message "S7.T15: client-credentials AT2 client_id is the endpoint's own oauth_client id"
Test-Result -Success (-not $ocAt2.Payload.PSObject.Properties.Name.Contains('src_iss')) -Message "S7.T16: client-credentials AT2 carries NO src_iss (no federated source) - the WIF/non-WIF discriminator"
Test-Result -Success ($ocAt2.Payload.auth_method -eq 'client_secret') -Message "S7.T17 (W3.8): client-credentials AT2 is tagged auth_method=client_secret"
Test-Result -Success (-not $ocAt2.Payload.PSObject.Properties.Name.Contains('source_tid')) -Message "S7.T18 (W3.8): client-credentials AT2 carries NO source_* claims (nothing federated to attribute)"
try { Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($epO.id)" -Method DELETE -Headers $headers | Out-Null } catch {}

# ─────────────────────────────────────────────────────────────────────────────Write-Section "STAGE 8: WARM MINT LATENCY (W1.6 perf gate)"
# ────────────────────────────────────────────────────────────────────────
# The X11 analysis measured the SAME mint at ~2,161ms cold vs ~92ms warm, and
# the JWKS fetch sits synchronously on the mint path with a 10-minute cache and
# no background refresh - so roughly every 10 minutes a real caller pays the
# cold cost. This gate locks the WARM path: a regression that puts a network
# fetch (or an ESM module load) back on every mint shows up immediately.
# Cold-start timing is deliberately NOT asserted here: the JWKS cache is
# process-wide per jwksUri, so whether a given run starts cold depends on what
# else has already hit that IdP on that replica.

$latencySamples = @()
try {
    # Warm once (not measured) so the JWKS + trust lookups are cached.
    Invoke-RestMethod -Uri $tokenUrl -Method POST -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type = "client_credentials"; client_id = "scim-wif-client-proof"
        client_assertion = $assertion; client_assertion_type = $JWT_BEARER } | Out-Null

    foreach ($n in 1..7) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        Invoke-RestMethod -Uri $tokenUrl -Method POST -ContentType "application/x-www-form-urlencoded" -Body @{
            grant_type = "client_credentials"; client_id = "scim-wif-client-proof"
            client_assertion = $assertion; client_assertion_type = $JWT_BEARER } | Out-Null
        $sw.Stop()
        $latencySamples += [int]$sw.ElapsedMilliseconds
    }

    $sorted = $latencySamples | Sort-Object
    $median = $sorted[[math]::Floor($sorted.Count / 2)]
    Write-Host ("warm mint latency ms: min={0} median={1} max={2}  (samples: {3})" -f $sorted[0], $median, $sorted[-1], ($latencySamples -join ', ')) -ForegroundColor Gray
    Test-Result -Success ($median -le $MintLatencyBudgetMs) -Message "S8.T1 (W1.6): warm WIF mint median ${median}ms is within the ${MintLatencyBudgetMs}ms budget"
} catch {
    Test-Result -Success $false -Message "S8.T1 (W1.6): mint latency stage threw: $($_.Exception.Message)"
}

# ────────────────────────────────────────────────────────────────────────if (-not $KeepArtifacts) {
    Write-Section "STAGE 8: cleanup"
    try { Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$epId" -Method DELETE -Headers $headers | Out-Null; Write-Host "deleted endpoint $epId" } catch {}
}

Write-Section "SUMMARY"
Write-Host "Passed : $script:Pass" -ForegroundColor Green
Write-Host "Failed : $script:Fail" -ForegroundColor $(if ($script:Fail -gt 0) { "Red" } else { "Green" })
if ($script:Findings.Count -gt 0) {
    Write-Host "`nFindings (gaps vs the SyncFabric guide):" -ForegroundColor Yellow
    $script:Findings | Format-Table -AutoSize | Out-String | Write-Host
}
if ($script:Fail -gt 0) { exit 1 }
