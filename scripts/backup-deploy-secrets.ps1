<#
.SYNOPSIS
    Back up the SCIMServer deployment secrets that CANNOT be regenerated, as a
    single encrypted, portable file.

.DESCRIPTION
    Most local secret material does not need backing up, and copying it around
    only widens the attack surface. This script exists for the part that does.

    TIER 3 - NO BACKUP NEEDED. The live estates' app secrets (database-url,
    jwt-secret, oauth-client-secret, scim-shared-secret) are stored in Azure
    Container Apps and readable over ARM:
        az containerapp secret list -n <app> -g <rg>
    Azure is already the backup. Copying them locally makes things worse.

    TIER 2 - REGENERATE, DO NOT RESTORE. Deployment service principal passwords
    and auth-proof client secrets can be reissued at any time:
        az ad app credential reset --id <appId> --years 1
        pwsh -File scripts/setup-auth-proof-apps.ps1 -Tenant <tenant>
    Restoring an old secret is strictly worse than minting a new one, because a
    reset also revokes whatever leaked. These are included in the archive only
    so a recovery does not need an interactive sign-in on day one - not because
    they are precious.

    TIER 1 - GENUINELY IRREPLACEABLE. Connection strings for an estate whose
    tenant has EXPIRED. Subscription expiry kills the ARM control plane while
    the PostgreSQL data plane keeps serving, so the database is still reachable
    but its connection string can never be read from Azure again. Lose the file
    and the data is unreachable forever.

    THE BETTER MOVE FOR TIER 1: a connection string is only a means of reaching
    data. Use -DumpExpiredEstates to convert that fragile pointer into a durable
    artifact - an actual dump - because the servers themselves disappear when
    Azure reclaims the subscription.

.NOTES
    CRYPTO. AES-256-CBC with encrypt-then-MAC (HMAC-SHA256), keys derived with
    PBKDF2-HMAC-SHA256 at 600,000 iterations over a random 32-byte salt, random
    IV per file. The MAC covers version, salt and IV as well as the ciphertext,
    and is verified BEFORE any decryption is attempted.

    The passphrase is read directly from the terminal with Read-Host
    -AsSecureString. It is never passed as a parameter, never echoed, and never
    written to a log or to shell history.

.PARAMETER Action
    backup | restore | verify | inspect

.PARAMETER Path
    Archive location. Defaults under the corporate OneDrive folder when present,
    because that is replicated and access-controlled, falling back to the user
    profile.

.EXAMPLE
    pwsh -File scripts/backup-deploy-secrets.ps1 -Action backup

.EXAMPLE
    # Prove the archive is readable. Do this now, not during an incident.
    pwsh -File scripts/backup-deploy-secrets.ps1 -Action verify
#>
[CmdletBinding()]
param(
    [ValidateSet('backup', 'restore', 'verify', 'inspect')]
    [string]$Action = 'backup',
    [string]$Path,
    [string]$RestoreTo,
    [switch]$DumpExpiredEstates
)

$ErrorActionPreference = 'Stop'

$SECRET_DIR = Join-Path $HOME '.scimserver-deploy'
$ARCHIVE_VERSION = 'scimserver-secret-archive-v1'
$PBKDF2_ITERATIONS = 600000

function Get-DefaultArchivePath {
    # Prefer the corporate OneDrive: replicated, access-controlled, and already
    # the home of this project's other off-repo material. Fall back to the user
    # profile if it is not present.
    $candidates = @(
        (Join-Path $HOME 'OneDrive - Microsoft\Documents\SCIMServer\secrets'),
        (Join-Path $HOME 'OneDrive\Documents\SCIMServer\secrets'),
        (Join-Path $HOME '.scimserver-deploy-backup')
    )
    foreach ($c in $candidates) {
        $parent = Split-Path $c -Parent
        if (Test-Path $parent) {
            if (-not (Test-Path $c)) { New-Item -ItemType Directory -Force -Path $c | Out-Null }
            return Join-Path $c 'scimserver-secrets.enc.json'
        }
    }
    $fallback = Join-Path $HOME '.scimserver-deploy-backup'
    if (-not (Test-Path $fallback)) { New-Item -ItemType Directory -Force -Path $fallback | Out-Null }
    return Join-Path $fallback 'scimserver-secrets.enc.json'
}

function Read-Passphrase {
    param([string]$Prompt = 'Passphrase')
    $sec = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-DerivedKeys {
    param([string]$Passphrase, [byte[]]$Salt)
    $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new(
        $Passphrase, $Salt, $PBKDF2_ITERATIONS, [Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        $material = $kdf.GetBytes(64)
        return @{ AesKey = $material[0..31]; MacKey = $material[32..63] }
    }
    finally { $kdf.Dispose() }
}

function Protect-Payload {
    param([string]$PlainText, [string]$Passphrase)

    $salt = [byte[]]::new(32)
    $iv = [byte[]]::new(16)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($salt); $rng.GetBytes($iv) } finally { $rng.Dispose() }

    $keys = Get-DerivedKeys -Passphrase $Passphrase -Salt $salt

    $aes = [Security.Cryptography.Aes]::Create()
    try {
        $aes.KeySize = 256; $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
        $aes.Key = $keys.AesKey; $aes.IV = $iv
        $enc = $aes.CreateEncryptor()
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes($PlainText)
            $cipher = $enc.TransformFinalBlock($bytes, 0, $bytes.Length)
        }
        finally { $enc.Dispose() }
    }
    finally { $aes.Dispose() }

    # Encrypt-then-MAC over everything an attacker could tamper with.
    $macInput = [Text.Encoding]::UTF8.GetBytes($ARCHIVE_VERSION) + $salt + $iv + $cipher
    $hmac = [Security.Cryptography.HMACSHA256]::new($keys.MacKey)
    try { $mac = $hmac.ComputeHash($macInput) } finally { $hmac.Dispose() }

    return [ordered]@{
        version    = $ARCHIVE_VERSION
        createdUtc = (Get-Date).ToUniversalTime().ToString('o')
        kdf        = @{ algorithm = 'PBKDF2-HMAC-SHA256'; iterations = $PBKDF2_ITERATIONS; saltBase64 = [Convert]::ToBase64String($salt) }
        cipher     = @{ algorithm = 'AES-256-CBC'; ivBase64 = [Convert]::ToBase64String($iv) }
        mac        = @{ algorithm = 'HMAC-SHA256'; valueBase64 = [Convert]::ToBase64String($mac) }
        payload    = [Convert]::ToBase64String($cipher)
    }
}

function Unprotect-Payload {
    param($Archive, [string]$Passphrase)

    if ($Archive.version -ne $ARCHIVE_VERSION) { throw "Unknown archive version '$($Archive.version)'." }

    $salt = [Convert]::FromBase64String($Archive.kdf.saltBase64)
    $iv = [Convert]::FromBase64String($Archive.cipher.ivBase64)
    $cipher = [Convert]::FromBase64String($Archive.payload)
    $expected = [Convert]::FromBase64String($Archive.mac.valueBase64)

    $keys = Get-DerivedKeys -Passphrase $Passphrase -Salt $salt

    $macInput = [Text.Encoding]::UTF8.GetBytes($Archive.version) + $salt + $iv + $cipher
    $hmac = [Security.Cryptography.HMACSHA256]::new($keys.MacKey)
    try { $actual = $hmac.ComputeHash($macInput) } finally { $hmac.Dispose() }

    # Fixed-time comparison, and BEFORE decrypting - a wrong passphrase must not
    # reach the cipher at all.
    $diff = 0
    if ($actual.Length -ne $expected.Length) { $diff = 1 }
    else { for ($i = 0; $i -lt $actual.Length; $i++) { $diff = $diff -bor ($actual[$i] -bxor $expected[$i]) } }
    if ($diff -ne 0) { throw "Authentication failed. Either the passphrase is wrong or the archive has been altered." }

    $aes = [Security.Cryptography.Aes]::Create()
    try {
        $aes.KeySize = 256; $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
        $aes.Key = $keys.AesKey; $aes.IV = $iv
        $dec = $aes.CreateDecryptor()
        try { $plain = $dec.TransformFinalBlock($cipher, 0, $cipher.Length) } finally { $dec.Dispose() }
    }
    finally { $aes.Dispose() }

    return [Text.Encoding]::UTF8.GetString($plain)
}

function New-Bundle {
    $files = @{}
    if (Test-Path $SECRET_DIR) {
        Get-ChildItem $SECRET_DIR -File -Filter *.json | ForEach-Object {
            $files[$_.Name] = Get-Content $_.FullName -Raw
        }
    }

    $dbUrls = @{}
    foreach ($p in @(
            'C:\Users\v-prasrane\source\repos\SCIMServer-tenant09\test-results\t09\db-urls.json'
        )) {
        if (Test-Path $p) { $dbUrls[(Split-Path $p -Leaf)] = Get-Content $p -Raw }
    }

    return [ordered]@{
        capturedUtc = (Get-Date).ToUniversalTime().ToString('o')
        machine     = $env:COMPUTERNAME
        # The recovery procedure travels WITH the backup. An archive whose
        # restore instructions live somewhere else is half an archive.
        recovery    = [ordered]@{
            tier3_noBackupNeeded = @(
                'Live estate app secrets are in Azure and readable over ARM:',
                '  az containerapp secret list -n scimserver-dev -g scimserver-dev',
                '  az containerapp secret show  -n <app> -g <rg> --secret-name database-url',
                'Do not restore these from here; Azure is authoritative.'
            )
            tier2_regenerate     = @(
                'Deployment service principal passwords - reissue rather than restore:',
                '  pwsh -File scripts/setup-deploy-sp.ps1 -Name <tenant>',
                '  or: az ad app credential reset --id <appId> --years 1',
                'Auth-proof identities - idempotent, safe to re-run:',
                '  pwsh -File scripts/setup-auth-proof-apps.ps1 -Tenant <tenant>',
                'A reset also REVOKES anything that leaked, so it beats restoring.'
            )
            tier1_irreplaceable  = @(
                'db-urls.json entries for an EXPIRED tenant cannot be re-read from',
                'Azure at all - subscription expiry kills ARM while PostgreSQL keeps',
                'serving. This archive is the only copy. Better still, take an actual',
                'dump while the servers live:',
                '  pwsh -File scripts/backup-deploy-secrets.ps1 -DumpExpiredEstates'
            )
            firstStepAfterRestore = @(
                'Restore, then IMMEDIATELY rotate every credential that was restored.',
                'A backup that has been opened should be treated as one that leaked.'
            )
        }
        deploySecrets = $files
        dbUrls        = $dbUrls
    }
}

$archivePath = if ($Path) { $Path } else { Get-DefaultArchivePath }

switch ($Action) {

    'backup' {
        Write-Host ""
        Write-Host "=== backup deployment secrets ===" -ForegroundColor Cyan
        $bundle = New-Bundle
        Write-Host ("  credential files : {0}" -f $bundle.deploySecrets.Keys.Count)
        $bundle.deploySecrets.Keys | ForEach-Object { Write-Host "     $_" }
        Write-Host ("  db-url captures  : {0}" -f $bundle.dbUrls.Keys.Count)
        $bundle.dbUrls.Keys | ForEach-Object { Write-Host "     $_" }
        Write-Host ("  destination      : {0}" -f $archivePath)
        Write-Host ""
        Write-Host "Choose a passphrase you can retrieve WITHOUT this machine." -ForegroundColor Yellow
        Write-Host "A passphrase stored only on the machine being backed up protects nothing."

        $p1 = Read-Passphrase -Prompt '  passphrase'
        $p2 = Read-Passphrase -Prompt '  confirm   '
        if ($p1 -ne $p2) { throw "Passphrases do not match. Nothing was written." }
        if ($p1.Length -lt 12) { throw "Use at least 12 characters. Nothing was written." }

        $json = $bundle | ConvertTo-Json -Depth 12
        $archive = Protect-Payload -PlainText $json -Passphrase $p1

        $dir = Split-Path $archivePath -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        ($archive | ConvertTo-Json -Depth 6) | Set-Content -Path $archivePath -Encoding utf8

        # Prove it round-trips NOW. An unverified backup is a guess.
        $check = Get-Content $archivePath -Raw | ConvertFrom-Json
        $back = Unprotect-Payload -Archive $check -Passphrase $p1
        if ($back -ne $json) { throw "Round-trip verification FAILED. Do not rely on this archive." }

        Write-Host ""
        Write-Host ("WROTE and VERIFIED {0} ({1} bytes)" -f $archivePath, (Get-Item $archivePath).Length) -ForegroundColor Green
        Write-Host "  round-trip decryption reproduced the input exactly."
        Write-Host ""
        Write-Host "Still to do, and only you can do them:" -ForegroundColor Yellow
        Write-Host "  1. Store the passphrase somewhere retrievable without this machine."
        Write-Host "  2. Confirm this location actually syncs off-device."
        Write-Host "  3. Re-run with -Action verify occasionally; an untested backup is a guess."
    }

    'verify' {
        Write-Host ""
        Write-Host "=== verify archive ===" -ForegroundColor Cyan
        if (-not (Test-Path $archivePath)) { throw "No archive at $archivePath" }
        $archive = Get-Content $archivePath -Raw | ConvertFrom-Json
        Write-Host ("  path    : {0}" -f $archivePath)
        Write-Host ("  created : {0}" -f $archive.createdUtc)
        Write-Host ("  kdf     : {0}, {1} iterations" -f $archive.kdf.algorithm, $archive.kdf.iterations)
        $pass = Read-Passphrase -Prompt '  passphrase'
        $plain = Unprotect-Payload -Archive $archive -Passphrase $pass
        $b = $plain | ConvertFrom-Json
        Write-Host ""
        Write-Host "DECRYPTED AND AUTHENTICATED" -ForegroundColor Green
        Write-Host ("  captured      : {0} on {1}" -f $b.capturedUtc, $b.machine)
        Write-Host ("  credential files: {0}" -f (@($b.deploySecrets.PSObject.Properties.Name) -join ', '))
        Write-Host ("  db-url captures : {0}" -f (@($b.dbUrls.PSObject.Properties.Name) -join ', '))
        Write-Host "  (no secret values printed)"
    }

    'inspect' {
        if (-not (Test-Path $archivePath)) { throw "No archive at $archivePath" }
        $archive = Get-Content $archivePath -Raw | ConvertFrom-Json
        Write-Host ""
        Write-Host "=== archive header (no passphrase needed, no secrets revealed) ===" -ForegroundColor Cyan
        Write-Host ("  path       : {0}" -f $archivePath)
        Write-Host ("  version    : {0}" -f $archive.version)
        Write-Host ("  created    : {0}" -f $archive.createdUtc)
        Write-Host ("  kdf        : {0} x{1}" -f $archive.kdf.algorithm, $archive.kdf.iterations)
        Write-Host ("  cipher     : {0}" -f $archive.cipher.algorithm)
        Write-Host ("  mac        : {0}" -f $archive.mac.algorithm)
        Write-Host ("  payload    : {0} base64 chars" -f $archive.payload.Length)
    }

    'restore' {
        Write-Host ""
        Write-Host "=== restore ===" -ForegroundColor Cyan
        if (-not (Test-Path $archivePath)) { throw "No archive at $archivePath" }
        $target = if ($RestoreTo) { $RestoreTo } else { $SECRET_DIR }
        $archive = Get-Content $archivePath -Raw | ConvertFrom-Json
        $pass = Read-Passphrase -Prompt '  passphrase'
        $b = (Unprotect-Payload -Archive $archive -Passphrase $pass) | ConvertFrom-Json

        if (-not (Test-Path $target)) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
        foreach ($n in $b.deploySecrets.PSObject.Properties.Name) {
            $dest = Join-Path $target $n
            $b.deploySecrets.$n | Set-Content -Path $dest -Encoding utf8
            Write-Host ("  restored {0}" -f $dest) -ForegroundColor Green
        }
        foreach ($n in $b.dbUrls.PSObject.Properties.Name) {
            $dest = Join-Path $target $n
            $b.dbUrls.$n | Set-Content -Path $dest -Encoding utf8
            Write-Host ("  restored {0}" -f $dest) -ForegroundColor Green
        }
        Write-Host ""
        Write-Host "NOW ROTATE EVERYTHING YOU JUST RESTORED." -ForegroundColor Yellow
        $b.recovery.tier2_regenerate | ForEach-Object { Write-Host "  $_" }
    }
}
