<#
.SYNOPSIS
  Shows every TLS handshake ATTEMPT against the instance, and whether it was
  accepted or rejected.

.DESCRIPTION
  A rejected TLS handshake normally leaves no trace anywhere: no HTTP request is
  parsed, so no access log line exists, and the SCIM application never learns the
  connection happened. This report reconstructs the full picture from three
  sources that nginx emits:

    1. STREAM layer (ssl_preread) - one line per CONNECTION ATTEMPT, with the
       highest TLS version the client OFFERED and the SNI it asked for. This
       fires even for connections that are about to be refused.
    2. HTTP access log - one line per request that COMPLETED a handshake, with
       the protocol and cipher actually negotiated.
    3. HTTP error log at info level - the handshake FAILURES, with the alert.

  Correlating 1 against 2 and 3 is what turns "it did not work" into "the client
  offered only TLS 1.2 and the strict profile refused it".

.PARAMETER Tail
  How many container log lines to consider. Default 2000.

.PARAMETER Last
  How many rows to show in each table. Default 15.
#>
[CmdletBinding()]
param(
    [int]$Tail = 2000,
    [int]$Last = 15,
    [string]$Container = 'scim-tls13-nginx'
)

$raw = docker logs --tail $Tail $Container 2>&1 | ForEach-Object { "$_" }

function Get-Field {
    param([string]$Line, [string]$Name)
    if ($Line -match "$Name=(\S+)") { return $Matches[1] } else { return '' }
}

# --- 1. Connection attempts, from the ssl_preread stream layer --------------
$attempts = foreach ($l in $raw) {
    if ($l -match 'EVENT=handshake_attempt') {
        [pscustomobject]@{
            Time       = ($l -split ' ')[0]
            Client     = Get-Field $l 'client'
            SNI        = $(if ((Get-Field $l 'sni') -eq '-') { '(none)' } else { Get-Field $l 'sni' })
            OfferedMax = Get-Field $l 'offered_max'
            ALPN       = Get-Field $l 'alpn'
            RoutedTo   = Get-Field $l 'routed_to'
        }
    }
}

# --- 2. Requests that completed a handshake ---------------------------------
$requests = foreach ($l in $raw) {
    if ($l -match 'EVENT=request') {
        [pscustomobject]@{
            Time     = ($l -split ' ')[0]
            Profile  = Get-Field $l 'profile'
            Proto    = Get-Field $l 'proto'
            Cipher   = Get-Field $l 'cipher'
            Status   = Get-Field $l 'status'
            Request  = $(if ($l -match '"([^"]*)"\s*$') { $Matches[1] } else { '' })
        }
    }
}

# --- 3. Handshake failures, from the error log ------------------------------
$rejects = foreach ($l in $raw) {
    if ($l -match 'SSL_do_handshake\(\) failed|SSL_read\(\) failed.*alert') {
        $reason = if ($l -match 'SSL:\s*error:[0-9A-Fa-f]+:(.+?)\)') { $Matches[1].Trim() } else { 'unknown' }
        [pscustomobject]@{
            Time   = $(if ($l -match '^(\d{4}/\d{2}/\d{2} \S+)') { $Matches[1] } else { '' })
            Client = $(if ($l -match 'client: (\S+?),') { $Matches[1] } else { '' })
            Server = $(if ($l -match 'server: (\S+?),') { $Matches[1] } else { '' })
            Reason = $reason
        }
    }
}

Write-Host ''
Write-Host '===============================================================' -ForegroundColor Cyan
Write-Host ' TLS HANDSHAKE REPORT' -ForegroundColor Cyan
Write-Host '===============================================================' -ForegroundColor Cyan

Write-Host "`n-- 1. CONNECTION ATTEMPTS (seen by ssl_preread, includes refusals) --" -ForegroundColor Yellow
if ($attempts) {
    $attempts | Select-Object -Last $Last | Format-Table -AutoSize
} else { Write-Host '   none' -ForegroundColor DarkGray }

Write-Host '-- 2. HANDSHAKES THAT SUCCEEDED (request served) --' -ForegroundColor Yellow
if ($requests) {
    $requests | Select-Object -Last $Last | Format-Table -AutoSize
} else { Write-Host '   none' -ForegroundColor DarkGray }

Write-Host '-- 3. HANDSHAKES THAT WERE REJECTED --' -ForegroundColor Yellow
if ($rejects) {
    $rejects | Select-Object -Last $Last | Format-Table -AutoSize
} else { Write-Host '   none' -ForegroundColor DarkGray }

Write-Host '-- 4. SUMMARY --' -ForegroundColor Yellow
Write-Host ("   connection attempts observed : {0}" -f @($attempts).Count)
Write-Host ("   requests served              : {0}" -f @($requests).Count)
Write-Host ("   handshakes rejected          : {0}" -f @($rejects).Count)

if ($attempts) {
    Write-Host "`n   highest TLS version OFFERED by clients:"
    $attempts | Group-Object OfferedMax | Sort-Object Name |
        ForEach-Object { Write-Host ("     {0,-10} {1} attempts" -f $_.Name, $_.Count) }
    Write-Host '   routed to profile:'
    $attempts | Group-Object RoutedTo | Sort-Object Name |
        ForEach-Object { Write-Host ("     {0,-26} {1} attempts" -f $_.Name, $_.Count) }
}
if ($requests) {
    Write-Host '   protocol actually NEGOTIATED:'
    $requests | Group-Object Proto | Sort-Object Name |
        ForEach-Object { Write-Host ("     {0,-10} {1} requests" -f $_.Name, $_.Count) }
}
Write-Host ''
