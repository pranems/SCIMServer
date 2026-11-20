$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$requirements = @(
    @{ File = 'scripts\dev-deployment-pipeline.ps1'; Boundary = 'docker version --format' },
    @{ File = 'scripts\full-validation-pipeline.ps1'; Boundary = 'docker compose down --remove-orphans' },
    @{ File = 'scripts\pre-push-checks.ps1'; Boundary = 'docker build -t $tag' },
    @{ File = 'scripts\publish-acr.ps1'; Boundary = 'az group show -n $ResourceGroup' }
)
foreach ($requirement in $requirements) {
    $text = Get-Content -LiteralPath (Join-Path $root $requirement.File) -Raw
    $guard = $text.IndexOf('Assert-IndependentContainerRuntime')
    $boundary = $text.IndexOf($requirement.Boundary)
    if ($guard -lt 0 -or $boundary -lt 0 -or $guard -ge $boundary -or
        $text -notmatch "SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME\s+-eq\s+'1'") {
        throw "$($requirement.File) does not enforce activated runtime provenance before its first applicable side effect."
    }
    Write-Host "PASS: $($requirement.File) guards the activated runtime before side effects"
}
$publish = Get-Content -LiteralPath (Join-Path $root 'scripts\publish-acr.ps1') -Raw
if ($publish -notmatch "(?s)if\s*\(\s*-not\s+\`$UseRemoteBuild\s+-and.*?SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME.*?\)\s*\{[^}]*Assert-IndependentContainerRuntime") {
    throw 'Remote ACR builds must remain independent of the local daemon preflight.'
}
Write-Host 'PASS: remote ACR mode does not acquire a local daemon dependency'
$prepush = Get-Content -LiteralPath (Join-Path $root 'scripts\pre-push-checks.ps1') -Raw
if ($prepush.IndexOf('Assert-IndependentContainerRuntime') -lt $prepush.IndexOf("if (`$Mode -eq 'Full')")) {
    throw 'Fast and Validate pre-push modes must not acquire a local daemon dependency.'
}
Write-Host 'PASS: Fast and Validate pre-push modes remain daemon-free'

$validation = Get-Content -LiteralPath (Join-Path $root 'scripts\full-validation-pipeline.ps1') -Raw
if ($validation.Contains('ts-node-dev') -or
    -not $validation.Contains('Start-Process -FilePath "node" -ArgumentList "dist/main.js"') -or
    -not $validation.Contains('Wait-ForEndpoint "$localBaseUrl/scim/health"')) {
    throw 'The local validation lane must run its existing compiled artifact without fetching a removed development runner, and wait on the real health route.'
}
Write-Host 'PASS: local validation uses the compiled Node artifact and actual health route'
