# Pre-deploy blast-radius check for the P2 caps.
# Existing credentials are never revoked by a cap, but an endpoint already at or
# above a default would refuse the operator's NEXT create. Better to know now.
param([string]$BaseUrl, [string]$Name)

$ErrorActionPreference = 'Stop'
$caps = @{ bearer = 5; oauth_client = 5; wif = 10 }

try {
    $tok = (Invoke-RestMethod -Uri "$BaseUrl/scim/oauth/token" -Method POST -TimeoutSec 30 `
        -Body @{ grant_type = 'client_credentials'; client_id = 'scimserver-client'; client_secret = 'changeme-oauth' } `
        -ContentType 'application/x-www-form-urlencoded').access_token
    $h = @{ Authorization = "Bearer $tok" }
    $eps = (Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Headers $h -TimeoutSec 60).endpoints

    $atRisk = @()
    foreach ($ep in $eps) {
        $creds = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$($ep.id)/credentials" -Headers $h -TimeoutSec 30
        # The response is an ARRAY, not { credentials: [...] } - assuming the
        # wrapper once produced a confident false zero.
        $list = @($creds)
        foreach ($type in $caps.Keys) {
            $n = @($list | Where-Object { $_.credentialType -eq $type -and $_.active }).Count
            if ($n -ge $caps[$type]) {
                $atRisk += [pscustomobject]@{ Endpoint = $ep.name; Type = $type; Active = $n; Cap = $caps[$type] }
            }
        }
    }

    "  {0}: {1} endpoints scanned, {2} at/over a default cap" -f $Name, @($eps).Count, @($atRisk).Count
    $atRisk | ForEach-Object { "      {0}  {1}={2} (cap {3})" -f $_.Endpoint, $_.Type, $_.Active, $_.Cap }
} catch {
    "  {0}: check failed - {1}" -f $Name, $_.Exception.Message
}
