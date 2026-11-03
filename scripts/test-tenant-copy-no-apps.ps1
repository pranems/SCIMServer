[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tenant-copy-safety.ps1')
$global:copyAppMode = ''
function global:az {
    $global:LASTEXITCODE = 0
    switch ($global:copyAppMode) {
        'present' { return '[{"name":"fixture-app"}]' }
        'absent' { return '[]' }
        'null' { return 'null' }
        'empty' { return }
        'denied' { $global:LASTEXITCODE = 1; return }
    }
}
try {
    foreach ($mode in @('present', 'absent', 'null', 'empty', 'denied')) {
        $global:copyAppMode = $mode
        $rejected = $false
        try {
            Assert-CopyTargetWithoutApps -Subscription fixture-sub
        } catch {
            if ($_.Exception.Message -notmatch 'Target application|Azure') { throw }
            $rejected = $true
        }
        if ($rejected -ne ($mode -ne 'absent')) {
            throw "RED: $mode app inventory did not produce the required restore-writer decision."
        }
        Write-Host "PASS: $mode app inventory decision verified"
    }
} finally {
    Remove-Item Function:\az
    Remove-Variable copyAppMode -Scope Global
}
