$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'start-container-engine-wsl.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw 'Independent Engine startup entry point is absent.' }
$calls = [Collections.Generic.List[object]]::new()
$state = @{ FailDaemon = $false; FailTransport = $false }
function wsl {
    $calls.Add(@($args))
    $global:LASTEXITCODE = if (($state.FailDaemon -and $calls.Count -eq 1) -or
        ($state.FailTransport -and $calls.Count -eq 2)) { 1 } else { 0 }
}
$originalExitCode = $global:LASTEXITCODE
try {
    & $scriptPath -Distribution 'SCIM-Contract' -SshPort 22222 -SshUser scimruntime
    if ($calls.Count -ne 2 -or ($calls[0] -join ' ') -notmatch 'systemctl start docker') {
        throw 'Startup must start the selected Engine before its SSH transport.'
    }
    $ssh = $calls[1] -join ' '
    foreach ($required in @('--distribution SCIM-Contract', '/usr/sbin/sshd -D', 'ListenAddress=127.0.0.1',
        'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no', 'PermitRootLogin=no', 'AllowUsers=scimruntime')) {
        if (-not $ssh.Contains($required)) { throw "Missing startup boundary: $required" }
    }
    Write-Host 'PASS: explicit distribution, foreground lifetime, loopback and key-only SSH policy'
    $calls.Clear()
    $state.FailDaemon = $true
    $failure = $null
    try { & $scriptPath -Distribution 'SCIM-Contract' -SshPort 22222 -SshUser scimruntime } catch { $failure = $_.Exception.Message }
    if ($calls.Count -ne 1 -or $failure -notmatch 'Engine failed to start') {
        throw 'A failed Engine start must block SSH startup explicitly.'
    }
    Write-Host 'PASS: failed Engine startup blocks the transport'
    $calls.Clear()
    $state.FailDaemon = $false
    $state.FailTransport = $true
    $failure = $null
    try { & $scriptPath -Distribution 'SCIM-Contract' -SshPort 22222 -SshUser scimruntime } catch { $failure = $_.Exception.Message }
    if ($calls.Count -ne 2 -or $failure -notmatch 'SSH transport failed') {
        throw 'A failed SSH listener must not appear to be a successful runtime start.'
    }
    Write-Host 'PASS: transport failure is explicit without a fallback runtime'
} finally {
    $global:LASTEXITCODE = $originalExitCode
}
