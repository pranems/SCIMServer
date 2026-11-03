[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tenant-copy-safety.ps1')
$global:copyLogExit = 0
$global:copyLogCalls = [Collections.Generic.List[string]]::new()
function global:az {
    $global:copyLogCalls.Add($args -join ' ')
    if ($env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL -ne 'no') {
        throw 'Log preflight did not disable unapproved automatic extension installation.'
    }
    $global:LASTEXITCODE = $global:copyLogExit
}
$previous = $env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL
try {
    $env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL = 'yes_prompt'
    foreach ($exit in @(1, 0)) {
        $global:copyLogExit = $exit
        $rejected = $false
        try {
            Assert-CopyLogTransportAvailable
        } catch {
            if ($_.Exception.Message -notmatch 'Copy log transport') { throw }
            $rejected = $true
        }
        if ($rejected -ne ($exit -ne 0)) {
            throw 'RED: missing copy-log command is not rejected before a transfer starts.'
        }
        if ($env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL -ne 'yes_prompt') {
            throw 'Log preflight did not restore the original process extension preference.'
        }
        Write-Host "PASS: log command exit $exit and process preference restoration"
    }
    if ($global:copyLogCalls.Count -ne 2 -or
        @($global:copyLogCalls | Where-Object { $_ -notlike 'containerapp job logs show --help*' }).Count) {
        throw 'Log availability proof performed an unexpected command or failed to check the command.'
    }
    Write-Host 'PASS: log preflight checks the actual command without creating or starting jobs'
} finally {
    $env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL = $previous
    Remove-Item Function:\az
    Remove-Variable copyLogExit, copyLogCalls -Scope Global
}
