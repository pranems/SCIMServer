param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
try {
    $source = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Exact checkout source unavailable.' }
    git diff --exit-code
    if ($LASTEXITCODE -ne 0) { throw 'Tracked checkout inputs were modified.' }
    $null = New-Item -ItemType Directory -Path $OutputDirectory -ErrorAction Stop
    $version = (Get-Content -LiteralPath 'api\package.json' -Raw | ConvertFrom-Json).version
    docker build --pull --label "org.opencontainers.image.revision=$source" `
        --build-arg "IMAGE_TAG=$source" --iidfile (Join-Path $OutputDirectory 'image-id.txt') .
    if ($LASTEXITCODE -ne 0) { throw 'Exact-checkout image build failed.' }
    $image = (Get-Content -LiteralPath (Join-Path $OutputDirectory 'image-id.txt') -Raw).Trim()
    docker image inspect --format `
        '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"sourceCommit":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}' `
        $image | Set-Content (Join-Path $OutputDirectory 'identity.json')
    if ($LASTEXITCODE -ne 0) { throw 'Exact-checkout image identity unavailable.' }
    & node (Join-Path $PSScriptRoot 'assess-membership.cjs') --checkout-image `
        (Join-Path $PSScriptRoot 'membership-protocol.json') (Join-Path $OutputDirectory 'identity.json') `
        $source $version (Join-Path $OutputDirectory 'protocol.json')
    if ($LASTEXITCODE -ne 0) { throw 'Current-image protocol binding failed.' }
} finally {
    Pop-Location
}
