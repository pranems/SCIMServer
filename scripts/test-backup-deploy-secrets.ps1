<#
    Self-test for the secret-archive crypto. Uses a THROWAWAY passphrase and
    synthetic data - never the real archive and never a real secret.

    A backup tool is the last thing you want to discover is broken, so this
    proves the properties that matter rather than assuming them:
      T1 round-trip   what goes in comes out byte-identical
      T2 wrong pass   a wrong passphrase is REJECTED, not silently garbage
      T3 tamper       flipping one ciphertext bit is DETECTED
      T4 tamper-salt  altering the KDF salt is DETECTED (the MAC covers it)
      T5 uniqueness   the same input twice yields different ciphertext
                      (random salt + IV, so no leakage from repeated backups)
#>
[CmdletBinding()] param()
$ErrorActionPreference = 'Stop'

# Load only the crypto helpers, without executing the script body.
$src = Get-Content (Join-Path $PSScriptRoot 'backup-deploy-secrets.ps1') -Raw
$start = $src.IndexOf('function Get-DerivedKeys')
$end = $src.IndexOf('function New-Bundle')
$block = $src.Substring($start, $end - $start)
$ARCHIVE_VERSION = 'scimserver-secret-archive-v1'
# Keep the self-test fast; the shipped script uses 600,000.
$PBKDF2_ITERATIONS = 50000
Invoke-Expression $block

$pass = 'throwaway-self-test-passphrase'
$plain = '{"secret":"not-a-real-secret","n":12345,"unicode":"aeiou accents: aeiou"}'
$p = 0; $f = 0
function Ok($n) { Write-Host "  PASS  $n" -ForegroundColor Green; $script:p++ }
function No($n, $d) { Write-Host "  FAIL  $n - $d" -ForegroundColor Red; $script:f++ }

Write-Host ""
Write-Host "=== secret-archive crypto self-test ===" -ForegroundColor Cyan

# T1
$a = Protect-Payload -PlainText $plain -Passphrase $pass
$back = Unprotect-Payload -Archive ([pscustomobject]$a) -Passphrase $pass
if ($back -eq $plain) { Ok 'T1 round-trip is byte-identical' } else { No 'T1 round-trip' 'output differs' }

# T2
try {
    Unprotect-Payload -Archive ([pscustomobject]$a) -Passphrase 'the-wrong-passphrase' | Out-Null
    No 'T2 wrong passphrase rejected' 'it returned data'
}
catch {
    if ($_.Exception.Message -match 'Authentication failed') { Ok 'T2 wrong passphrase is rejected with an authentication failure' }
    else { No 'T2 wrong passphrase rejected' "unexpected error: $($_.Exception.Message)" }
}

# OrderedDictionary has no Clone in PowerShell, so copy explicitly.
function Copy-Archive {
    param($A)
    return [ordered]@{
        version    = $A.version
        createdUtc = $A.createdUtc
        kdf        = @{ algorithm = $A.kdf.algorithm; iterations = $A.kdf.iterations; saltBase64 = $A.kdf.saltBase64 }
        cipher     = @{ algorithm = $A.cipher.algorithm; ivBase64 = $A.cipher.ivBase64 }
        mac        = @{ algorithm = $A.mac.algorithm; valueBase64 = $A.mac.valueBase64 }
        payload    = $A.payload
    }
}

# T3 - flip a bit in the ciphertext
$t = Copy-Archive $a
$bytes = [Convert]::FromBase64String($t.payload)
$bytes[0] = $bytes[0] -bxor 0x01
$t.payload = [Convert]::ToBase64String($bytes)
try {
    Unprotect-Payload -Archive ([pscustomobject]$t) -Passphrase $pass | Out-Null
    No 'T3 ciphertext tampering detected' 'it decrypted anyway'
}
catch {
    if ($_.Exception.Message -match 'Authentication failed') { Ok 'T3 a single flipped ciphertext bit is detected' }
    else { No 'T3 ciphertext tampering detected' "wrong error: $($_.Exception.Message)" }
}

# T4 - alter the KDF salt. This only fails if the MAC covers the salt, which is
# the point of authenticating the header and not just the body.
$t2 = Copy-Archive $a
$saltBytes = [Convert]::FromBase64String($a.kdf.saltBase64)
$saltBytes[0] = $saltBytes[0] -bxor 0xFF
$t2.kdf = @{ algorithm = $a.kdf.algorithm; iterations = $a.kdf.iterations; saltBase64 = [Convert]::ToBase64String($saltBytes) }
try {
    Unprotect-Payload -Archive ([pscustomobject]$t2) -Passphrase $pass | Out-Null
    No 'T4 salt tampering detected' 'it decrypted anyway'
}
catch {
    if ($_.Exception.Message -match 'Authentication failed') { Ok 'T4 altering the KDF salt is detected' }
    else { No 'T4 salt tampering detected' "wrong error: $($_.Exception.Message)" }
}

# T5 - identical input must not produce identical ciphertext
$b = Protect-Payload -PlainText $plain -Passphrase $pass
if ($b.payload -ne $a.payload -and $b.kdf.saltBase64 -ne $a.kdf.saltBase64 -and $b.cipher.ivBase64 -ne $a.cipher.ivBase64) {
    Ok 'T5 the same input twice yields different salt, IV and ciphertext'
}
else { No 'T5 uniqueness' 'repeated encryption produced reused material' }

Write-Host ""
Write-Host ("passed {0}, failed {1}" -f $p, $f) -ForegroundColor $(if ($f) { 'Red' } else { 'Green' })
if ($f -gt 0) { exit 1 }
Write-Host "secret-archive crypto self-test PASSED" -ForegroundColor Green
