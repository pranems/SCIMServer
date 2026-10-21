param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][hashtable]$Headers
)

$ErrorActionPreference = 'Stop'
$endpointUrl = "$($BaseUrl.TrimEnd('/'))/scim/admin/endpoints"
$endpointId = $null

function Assert-LifetimeCheck {
    param([bool]$Success, [string]$Message)
    if (-not $Success) { throw $Message }
    [pscustomobject]@{ Success = $true; Message = $Message }
}

try {
    $created = Invoke-RestMethod -Method Post -Uri $endpointUrl -Headers $Headers `
        -ContentType 'application/json' -Body (@{
            name = "token-ttl-live-$([guid]::NewGuid().ToString('N'))"
            profilePreset = 'rfc-standard'
        } | ConvertTo-Json)
    $endpointId = $created.id
    $uri = "$endpointUrl/$endpointId"
    $null = Invoke-RestMethod -Method Patch -Uri $uri -Headers $Headers `
        -ContentType 'application/json' -Body (@{
            profile = @{ settings = @{
                OAuthClientCredentialsAuthEnabled = $true
                WifCredentialsEnabled = $true
                OAuthClientTokenTtlSec = 7200
                WifTokenTtlSec = 10800
            } }
        } | ConvertTo-Json -Depth 5)
    $credential = Invoke-RestMethod -Method Post -Uri "$uri/credentials" -Headers $Headers `
        -ContentType 'application/json' -Body '{"credentialType":"oauth_client"}'
    $tokenUrl = "$($BaseUrl.TrimEnd('/'))/scim/endpoints/$endpointId/oauth/token"
    $mintBody = @{
        grant_type = 'client_credentials'
        client_id = $credential.clientId
        client_secret = $credential.clientSecret
    }
    $minted = Invoke-RestMethod -Method Post -Uri $tokenUrl -ContentType 'application/x-www-form-urlencoded' -Body $mintBody
    Assert-LifetimeCheck ($minted.expires_in -eq 7200) 'OAuth response uses the endpoint 7200-second lifetime.'
    $payload = $minted.access_token.Split('.')[1].Replace('-', '+').Replace('_', '/')
    $payload = $payload.PadRight([int]([Math]::Ceiling($payload.Length / 4.0) * 4), '=')
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    Assert-LifetimeCheck (($claims.exp - $claims.iat) -eq 7200) 'JWT exp minus iat matches expires_in.'
    $allowed = @('access_token', 'token_type', 'expires_in', 'scope')
    $unexpected = @($minted.PSObject.Properties.Name | Where-Object { $_ -notin $allowed })
    Assert-LifetimeCheck ($unexpected.Count -eq 0) 'Token response carries only documented keys.'
    $stored = Invoke-RestMethod -Uri $uri -Headers $Headers
    Assert-LifetimeCheck ($stored.profile.settings.WifTokenTtlSec -eq 10800) 'WIF endpoint default persists through the admin API.'

    foreach ($key in @('OAuthClientTokenTtlSec', 'WifTokenTtlSec')) {
      foreach ($value in @(59, 604801, 60.5)) {
        $invalid = @{ profile = @{ settings = @{ $key = $value } } } | ConvertTo-Json -Depth 5
        $response = Invoke-WebRequest -Method Patch -Uri $uri -Headers $Headers `
            -ContentType 'application/json' -Body $invalid -SkipHttpErrorCheck
        Assert-LifetimeCheck ($response.StatusCode -eq 400) "$key rejects invalid value $value through HTTP."
      }
    }
    $null = Invoke-RestMethod -Method Patch -Uri $uri -Headers $Headers `
        -ContentType 'application/json' -Body (@{
            profile = @{ settings = @{ OAuthClientTokenTtlSec = 604800 } }
        } | ConvertTo-Json -Depth 5)
    $updatedMint = Invoke-RestMethod -Method Post -Uri $tokenUrl `
        -ContentType 'application/x-www-form-urlencoded' -Body $mintBody
    Assert-LifetimeCheck ($updatedMint.expires_in -eq 604800) 'A runtime lifetime update accepts one week without restarting.'
    $null = Invoke-RestMethod -Method Patch -Uri $uri -Headers $Headers `
        -ContentType 'application/json' -Body (@{
            profile = @{ settings = @{ OAuthClientTokenTtlSec = 60 } }
        } | ConvertTo-Json -Depth 5)
    $minimumMint = Invoke-RestMethod -Method Post -Uri $tokenUrl `
        -ContentType 'application/x-www-form-urlencoded' -Body $mintBody
    Assert-LifetimeCheck ($minimumMint.expires_in -eq 60) 'The one-minute minimum reaches the token issuer unchanged.'

    $trust = @{
        expectedIssuer = 'https://login.microsoftonline.com/token-ttl-test/v2.0'
        expectedSubject = 'token-ttl-test-subject'
        expectedAudience = 'api://token-ttl-test'
        jwksUri = 'https://login.microsoftonline.com/token-ttl-test/discovery/v2.0/keys'
        allowedTenantId = 'token-ttl-test'
        issuedTokenTtlSec = 7200
    }
    $wif = Invoke-RestMethod -Method Post -Uri "$uri/credentials" -Headers $Headers `
        -ContentType 'application/json' -Body (@{ credentialType = 'wif'; wif = $trust } | ConvertTo-Json -Depth 5)
    Assert-LifetimeCheck ($wif.wif.issuedTokenTtlSec -eq 7200) 'WIF per-trust lifetime override persists.'
    $trust.Remove('issuedTokenTtlSec')
    $reset = Invoke-RestMethod -Method Put -Uri "$uri/credentials/$($wif.id)" -Headers $Headers `
        -ContentType 'application/json' -Body (@{ wif = $trust } | ConvertTo-Json -Depth 5)
    Assert-LifetimeCheck (-not ($reset.wif.PSObject.Properties.Name -contains 'issuedTokenTtlSec')) `
        'Removing the WIF trust override restores endpoint inheritance.'
} finally {
    if ($endpointId) {
        $null = Invoke-RestMethod -Method Delete -Uri "$endpointUrl/$endpointId" -Headers $Headers
    }
}
