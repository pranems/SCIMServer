<#
.SYNOPSIS
  Proves that TLS policy is selected PER HOSTNAME on a single port, and that
  both the accepted and the refused handshakes are observable.

.DESCRIPTION
  All four cases below hit the SAME port (8443) on the SAME nginx with the SAME
  certificate. The only thing that varies is the SNI hostname and the client's
  maximum TLS version. That isolation is what makes the outcome attributable to
  the TLS profile and nothing else.
#>
[CmdletBinding()]
param([int]$Port = 8443)

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Assert-That {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:pass++; Write-Host "  [PASS] $Name -> $Detail" -ForegroundColor Green }
    else { $script:fail++; Write-Host "  [FAIL] $Name -> $Detail" -ForegroundColor Red }
}

Add-Type -AssemblyName System.Net.Http

function Connect-WithSni {
    param([string]$Sni, [System.Security.Authentication.SslProtocols]$Protocols)
    $tcp = [System.Net.Sockets.TcpClient]::new()
    try {
        $tcp.Connect('127.0.0.1', $Port)
        $ssl = [System.Net.Security.SslStream]::new($tcp.GetStream(), $false, { $true })
        try {
            $ssl.AuthenticateAsClient($Sni, $null, $Protocols, $false)
            return [pscustomobject]@{ Ok = $true; Protocol = $ssl.SslProtocol.ToString(); Error = '' }
        } finally { $ssl.Dispose() }
    } catch {
        $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
        return [pscustomobject]@{ Ok = $false; Protocol = ''; Error = $e.Message }
    } finally { $tcp.Dispose() }
}

$tls12 = [System.Security.Authentication.SslProtocols]::Tls12
$tls13 = [System.Security.Authentication.SslProtocols]::Tls13

Write-Host "`n=== Per-hostname TLS policy on a single port ($Port) ===" -ForegroundColor Cyan
Write-Host 'Same port, same nginx, same certificate. Only the SNI name varies.' -ForegroundColor DarkGray
Write-Host ''

$a = Connect-WithSni 'tls13.localhost' $tls12
Assert-That 'tls13.localhost REFUSES a TLS 1.2-only client' (-not $a.Ok) $(if ($a.Ok) { "accepted $($a.Protocol)" } else { $a.Error })

$b = Connect-WithSni 'tls13.localhost' $tls13
Assert-That 'tls13.localhost ACCEPTS a TLS 1.3 client' ($b.Ok -and $b.Protocol -match '13') "negotiated $($b.Protocol)"

$c = Connect-WithSni 'tls12.localhost' $tls12
Assert-That 'tls12.localhost ACCEPTS a TLS 1.2-only client' ($c.Ok -and $c.Protocol -match '12') "negotiated $($c.Protocol)"

$d = Connect-WithSni 'tls12.localhost' $tls13
Assert-That 'tls12.localhost ACCEPTS a TLS 1.3 client' ($d.Ok -and $d.Protocol -match '13') "negotiated $($d.Protocol)"

# The refusal must be OBSERVABLE, not silent. This is the part that distinguishes
# a diagnosable endpoint from one that just drops connections.
Start-Sleep -Milliseconds 700
$logs = docker logs --tail 200 scim-tls13-nginx 2>&1 | ForEach-Object { "$_" }
$attempt12 = $logs | Where-Object { $_ -match 'EVENT=handshake_attempt' -and $_ -match 'sni=tls13\.localhost' -and $_ -match 'offered_max=TLSv1\.2' }
Assert-That 'the REFUSED attempt was logged with the offered version' ([bool]$attempt12) `
    $(if ($attempt12) { 'ssl_preread recorded offered_max=TLSv1.2 on tls13.localhost' } else { 'no attempt line found' })

$rejected = $logs | Where-Object { $_ -match 'SSL_do_handshake\(\) failed' }
Assert-That 'the rejection itself was logged' ([bool]$rejected) `
    $(if ($rejected) { 'error log shows SSL_do_handshake() failed' } else { 'no rejection line found' })

Write-Host "`n=== RESULT ===" -ForegroundColor Cyan
Write-Host ("  PASS {0}   FAIL {1}" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
