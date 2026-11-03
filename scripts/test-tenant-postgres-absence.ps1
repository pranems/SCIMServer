[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'postgres-provisioning.ps1')
$global:pgAbsenceMode = ''
function global:az {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'resource' -and $args[1] -eq 'list') { return '[]' }
    switch ($global:pgAbsenceMode) {
        'deleting' { return '{"state":"Dropping"}' }
        'ready' { return '{"state":"Ready"}' }
        'missing' { $global:LASTEXITCODE = 1; return '(ResourceNotFound) The selected server was not found.' }
        'denied' { $global:LASTEXITCODE = 1; return '(AuthorizationFailed) Access denied.' }
        'transport' { $global:LASTEXITCODE = 1; return 'Connection reset.' }
        'empty' { return }
    }
}
try {
    foreach ($mode in @('deleting', 'ready', 'missing', 'denied', 'transport', 'empty')) {
        $global:pgAbsenceMode = $mode
        $rejected = $false
        try {
            Assert-ScimPostgresTargetAbsent -ServerName fixture-pg -ResourceGroup fixture-rg -SubscriptionId fixture-sub
        } catch {
            if ($_.Exception.Message -notmatch 'Target PostgreSQL') { throw }
            $rejected = $true
        }
        if ($rejected -ne ($mode -ne 'missing')) {
            throw "RED: $mode target with an empty generic resource list did not produce the required absence decision."
        }
        Write-Host "PASS: $mode target absence decision verified"
    }
} finally {
    Remove-Item Function:\az
    Remove-Variable pgAbsenceMode -Scope Global
}
