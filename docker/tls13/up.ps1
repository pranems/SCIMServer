<#
.SYNOPSIS
  Brings up a standalone TLS 1.3-only SCIM Server and PROVES the policy is in
  effect before declaring success.

.DESCRIPTION
  Generates a throwaway self-signed certificate, starts the stack, then runs a
  negative control: the TLS 1.3-only listener MUST refuse a TLS 1.2 handshake.
  A stack that comes up but does not actually refuse TLS 1.2 is a FAILURE here,
  not a pass. Presence of the container is not correctness of the policy.

.PARAMETER SkipCerts
  Reuse the existing certs/ pair instead of regenerating.
#>
[CmdletBinding()]
param(
    [switch]$SkipCerts
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here

function Find-OpenSsl {
    foreach ($c in @('openssl', 'C:\Program Files\Git\usr\bin\openssl.exe')) {
        try { & $c version *> $null; return $c } catch { }
    }
    throw 'openssl not found. Install it or add Git for Windows to PATH.'
}

try {
    $openssl = Find-OpenSsl
    Write-Host "openssl: $openssl" -ForegroundColor DarkGray

    if (-not $SkipCerts) {
        New-Item -ItemType Directory -Force -Path certs | Out-Null
        Write-Host 'Generating throwaway self-signed certificate...' -ForegroundColor Cyan
        & $openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 `
            -subj '/CN=localhost' `
            -addext 'subjectAltName=DNS:localhost,DNS:scim-tls13.local,DNS:scim-tls12.local,IP:127.0.0.1' `
            -keyout certs/key.pem -out certs/cert.pem 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'certificate generation failed' }
    }

    Write-Host 'Starting stack...' -ForegroundColor Cyan
    docker compose -f docker-compose.tls13.yml up -d
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }

    # Readiness means "the app answered through the TLS 1.3 listener", NOT "the
    # app returned 200". /scim/admin/version requires auth, so a 401 from the
    # application is a perfectly good liveness signal: it proves the request
    # traversed TLS, nginx and the app. Treating 401 as not-ready is the bug
    # this comment exists to prevent recurring.
    Write-Host 'Waiting for the API to answer through the TLS 1.3 listener...' -ForegroundColor Cyan
    $ready = $false
    for ($i = 1; $i -le 60; $i++) {
        try {
            $r = Invoke-WebRequest -Uri 'https://localhost:8443/health' `
                -SkipCertificateCheck -TimeoutSec 5 -SkipHttpErrorCheck
            if ($r.StatusCode -gt 0) {
                $ready = $true
                Write-Host "  answered: HTTP $($r.StatusCode) from /health" -ForegroundColor Green
                break
            }
        } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) { throw 'API never answered through the TLS 1.3 listener' }

    # ------------------------------------------------------------------
    # NEGATIVE CONTROL. The gate is not "it started", it is "1.2 is refused".
    # ------------------------------------------------------------------
    Write-Host "`nProving the TLS policy is actually in effect..." -ForegroundColor Cyan
    $fail = $false

    # `openssl s_client` keeps reading stdin after the handshake, which blocks a
    # non-interactive script. Piping an empty string closes stdin.
    $t12on13 = ('' | & $openssl s_client -connect localhost:8443 -tls1_2 -servername localhost 2>&1) -join "`n"
    if ($t12on13 -match 'Protocol\s*:\s*TLSv1\.2' -and $t12on13 -notmatch 'alert|failure|no protocols') {
        Write-Host '  [FAIL] :8443 ACCEPTED TLS 1.2. The policy is NOT in effect.' -ForegroundColor Red
        $fail = $true
    } else {
        Write-Host '  [PASS] :8443 refused TLS 1.2' -ForegroundColor Green
    }

    $t13on13 = ('' | & $openssl s_client -connect localhost:8443 -tls1_3 -servername localhost 2>&1) -join "`n"
    if ($t13on13 -match 'Protocol\s*:\s*TLSv1\.3') {
        Write-Host '  [PASS] :8443 accepted TLS 1.3' -ForegroundColor Green
    } else {
        Write-Host '  [FAIL] :8443 did not accept TLS 1.3' -ForegroundColor Red
        $fail = $true
    }

    $t12on12 = ('' | & $openssl s_client -connect localhost:8444 -tls1_2 -servername localhost 2>&1) -join "`n"
    if ($t12on12 -match 'Protocol\s*:\s*TLSv1\.2') {
        Write-Host '  [PASS] :8444 control accepted TLS 1.2 (so cert/DNS/backend are all fine)' -ForegroundColor Green
    } else {
        Write-Host '  [FAIL] :8444 control did not accept TLS 1.2 - the comparison is not attributable.' -ForegroundColor Red
        $fail = $true
    }

    if ($fail) { throw 'TLS policy verification FAILED. Do not run tests against this stack.' }

    Write-Host "`nReady." -ForegroundColor Green
    Write-Host '  TLS 1.3 ONLY : https://localhost:8443' -ForegroundColor Green
    Write-Host '  control 1.2+3: https://localhost:8444' -ForegroundColor DarkGray
}
finally {
    Pop-Location
}
