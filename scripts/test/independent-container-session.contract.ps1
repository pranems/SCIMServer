$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'independent-container-runtime.ps1')

$keys = @('PATH', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME',
    'SCIM_CONTAINER_SOURCE_ROOT', 'SCIM_CONTAINER_LOG_DIRECTORY')
$original = @{}
foreach ($key in $keys) { $original[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$client = Join-Path ([IO.Path]::GetTempPath()) 'scim-contract-client\docker.exe'
$configuration = Join-Path ([IO.Path]::GetTempPath()) 'scim-contract-config'

function Assert-IndependentContainerRuntime {
    if ($env:DOCKER_CONTEXT) { throw 'Activation did not clear the inherited context override.' }
    if ($env:DOCKER_HOST -ne 'ssh://scim-contract') { throw 'Requested endpoint was not selected.' }
    if ($env:DOCKER_CONFIG -ne $configuration) { throw 'Requested client configuration was not selected.' }
    if ($env:SCIM_CONTAINER_SOURCE_ROOT -ne '/mnt/contract' -or
        $env:SCIM_CONTAINER_LOG_DIRECTORY -ne '/mnt/logs') {
        throw 'Backend bind paths were not selected together with the runtime.'
    }
    if (-not $env:PATH.StartsWith((Split-Path -Parent $client) + [IO.Path]::PathSeparator)) {
        throw 'Independent client directory was not placed first.'
    }
    if ($script:reject) { throw 'Synthetic runtime rejection.' }
    [pscustomobject]@{ ClientPath = if ($script:wrongClient) { "$client.other" } else { $client } }
}

function Assert-EnvironmentEqual($Expected) {
    foreach ($key in $keys) {
        if ([Environment]::GetEnvironmentVariable($key, 'Process') -cne $Expected[$key]) {
            throw "Rejected activation changed $key."
        }
    }
}

try {
    $env:DOCKER_CONTEXT = 'preserved-context'
    $script:reject = $false
    $script:wrongClient = $false
    $activation = @{
        ClientPath = $client
        ConfigDirectory = $configuration
        Endpoint = 'ssh://scim-contract'
        BindSourceRoot = '/mnt/contract'
        LogDirectory = '/mnt/logs'
    }
    $result = Enable-IndependentContainerRuntime @activation
    if ($result.ClientPath -ne $client -or $env:SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME -ne '1') {
        throw 'Accepted activation did not return client evidence and enable inherited enforcement.'
    }
    Write-Host 'PASS: accepted activation pins client, configuration and endpoint for child processes'

    $before = @{}
    foreach ($key in $keys) { $before[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
    $script:reject = $true
    $message = $null
    try {
        $null = Enable-IndependentContainerRuntime @activation
    } catch { $message = $_.Exception.Message }
    if ($message -ne 'Synthetic runtime rejection.') { throw "Wrong rejection: $message" }
    Assert-EnvironmentEqual $before
    Write-Host 'PASS: runtime rejection restores all inherited process settings'

    $script:reject = $false
    $script:wrongClient = $true
    $message = $null
    try {
        $null = Enable-IndependentContainerRuntime @activation
    } catch { $message = $_.Exception.Message }
    if ($message -notmatch 'requested executable') { throw "Wrong client-selection rejection: $message" }
    Assert-EnvironmentEqual $before
    Write-Host 'PASS: unexpected client resolution is rejected and rolled back'
} finally {
    foreach ($key in $keys) {
        Set-Item -LiteralPath "Env:$key" -Value $original[$key]
    }
}
