[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$checks = @(
    'test-tenant-registry-resolution.ps1',
    'test-tenant-cutover.ps1',
    'test-tenant-credential-storage.ps1',
    'test-tenant-directory-grant.ps1',
    'test-tenant-proof-metadata.ps1',
    'test-tenant-postgres-absence.ps1',
    'test-tenant-copy-no-apps.ps1',
    'test-tenant-copy-log-transport.ps1',
    'test-tenant-copy-safety.ps1',
    'test-tenant-copy-cleanup.ps1'
)
foreach ($check in $checks) {
    & pwsh -NoProfile -File (Join-Path $PSScriptRoot $check)
    if ($LASTEXITCODE -ne 0) { throw "Offline tenant rollover contract failed: $check" }
}
Write-Host "PASS: $($checks.Count) offline tenant rollover contracts; no cloud or Docker access"
