$ErrorActionPreference = 'Stop'
$contracts = @(
    'independent-container-runtime',
    'independent-container-session',
    'start-container-engine-wsl',
    'compose-bind-paths',
    'container-pipeline-preflight',
    'standalone-migrations',
    'container-image-metadata',
    'verify-deployment'
)
foreach ($contract in $contracts) {
    Write-Host "Running $contract"
    pwsh -NoProfile -File (Join-Path $PSScriptRoot "test\$contract.contract.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Container runtime contract failed: $contract (exit $LASTEXITCODE)"
    }
}
