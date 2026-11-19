$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
foreach ($workflow in @('build-test.yml', 'build-and-push.yml', 'publish-ghcr.yml')) {
    $text = Get-Content -LiteralPath (Join-Path $root ".github\workflows\$workflow") -Raw
    if ($text -notmatch 'docker/metadata-action@[a-f0-9]{40}' -or
        -not $text.Contains('labels: ${{ steps.meta.outputs.labels }}')) {
        throw "$workflow does not propagate the established OCI metadata labels to its built image."
    }
    Write-Host "PASS: $workflow propagates pinned metadata-action labels"
}
$publisher = Get-Content -LiteralPath (Join-Path $root '.github\workflows\publish-ghcr.yml') -Raw
foreach ($required in @(
    'IMAGE_TAG=${{ inputs.version }}',
    'type=raw,value=${{ inputs.version }}',
    '${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:sha-${{ github.sha }}',
    '${GITHUB_SHA}" != "${EXPECTED_SHA}'
)) {
    if (-not $publisher.Contains($required)) {
        throw "Dispatch publication lost a required version/source guard: $required"
    }
    Write-Host "PASS: dispatch publication preserves $required"
}
foreach ($caller in @(
    'scripts\pre-push-checks.ps1',
    'scripts\dev-deployment-pipeline.ps1',
    '.github\workflows\build-test.yml'
)) {
    $text = Get-Content -LiteralPath (Join-Path $root $caller) -Raw
    if ($text -notmatch '(?m)^\s*(?:run:\s*)?pwsh[^\r\n]*test-container-runtime\.ps1') {
        throw "$caller does not execute the offline runtime regression gate."
    }
    Write-Host "PASS: $caller executes the offline runtime regression gate"
}
