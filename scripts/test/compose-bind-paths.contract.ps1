param([string]$DockerCommand = 'docker')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$keys = @(
    'SCIM_CONTAINER_SOURCE_ROOT', 'SCIM_CONTAINER_LOG_DIRECTORY',
    'NPM_REGISTRY', 'API_CONTAINER_NAME', 'DEBUG_API_HOST_PORT',
    'DEBUG_INSPECTOR_HOST_PORT', 'BIND_HOST_IP'
)
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }

try {
    $env:SCIM_CONTAINER_SOURCE_ROOT = '/mnt/scimserver-contract'
    $env:SCIM_CONTAINER_LOG_DIRECTORY = '/mnt/scimserver-contract-logs'
    $json = & $DockerCommand compose -f (Join-Path $root 'docker-compose.yml') config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Compose failed to render the remote bind contract.' }
    $model = ($json -join "`n") | ConvertFrom-Json
    $sql = @($model.services.postgres.volumes | Where-Object target -eq '/docker-entrypoint-initdb.d/01-extensions.sql')
    $logs = @($model.services.api.volumes | Where-Object target -eq '/app/logs')
    if ($sql.Count -ne 1 -or $sql[0].source -ne '/mnt/scimserver-contract/scripts/init-pg-extensions.sql') {
        throw 'Remote SQL bind source was not preserved as a Linux backend path.'
    }
    if ($logs.Count -ne 1 -or $logs[0].source -ne '/mnt/scimserver-contract-logs') {
        throw 'Runtime-specific log isolation path was not preserved.'
    }
    Write-Host 'PASS: remote SQL and isolated log paths survive native Compose rendering'

    $env:NPM_REGISTRY = 'https://registry.example.invalid/'
    $env:API_CONTAINER_NAME = 'scim-debug-contract'
    $env:DEBUG_API_HOST_PORT = '13000'
    $env:DEBUG_INSPECTOR_HOST_PORT = '19229'
    $env:BIND_HOST_IP = '127.0.0.1'
    $json = & $DockerCommand compose -f (Join-Path $root 'docker-compose.yml') -f (Join-Path $root 'docker-compose.debug.yml') config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Compose failed to render the debug bind contract.' }
    $debug = ($json -join "`n") | ConvertFrom-Json
    $source = @($debug.services.api.volumes | Where-Object target -eq '/usr/src/app')
    if ($source.Count -ne 1 -or $source[0].source -ne '/mnt/scimserver-contract/api') {
        throw 'Debug source bind does not target the explicit Linux backend checkout.'
    }
    Write-Host 'PASS: debug source targets the selected backend checkout'

    $ports = @($debug.services.api.ports)
    if ($debug.services.api.container_name -ne 'scim-debug-contract' -or
        $ports.Count -ne 2 -or
        @($ports | Where-Object { $_.host_ip -ne '127.0.0.1' }).Count -ne 0 -or
        @($ports | Where-Object { $_.target -eq 3000 -and $_.published -eq '13000' }).Count -ne 1 -or
        @($ports | Where-Object { $_.target -eq 9229 -and $_.published -eq '19229' }).Count -ne 1) {
        throw 'Debug mode must have an owned name and exactly two explicitly selected loopback ports, without the inherited production port.'
    }
    Write-Host 'PASS: debug ports and container name support isolated loopback trials'

    $command = $debug.services.api.command -join ' '
    $health = $debug.services.api.healthcheck.test -join ' '
    if ($debug.services.api.environment.NPM_CONFIG_REGISTRY -ne 'https://registry.example.invalid/' -or
        $debug.services.api.environment.NODE_OPTIONS -match '--inspect' -or
        $command -notmatch 'npx prisma migrate deploy && exec node --watch --inspect=0\.0\.0\.0:9229' -or
        $health -notmatch '127\.0\.0\.1:3000/scim/health') {
        throw 'Debug bootstrap must use the selected npm transport, inspect only the application and check its actual API port.'
    }
    Write-Host 'PASS: debug bootstrap, inspector ownership and healthcheck target are correct'

    $watch = @($debug.services.api.develop.watch)
    if ($watch.Count -ne 1 -or $watch[0].action -ne 'restart' -or
        [IO.Path]::GetFullPath($watch[0].path) -ne (Join-Path $root 'api\src') -or
        $watch[0].ignore -notcontains 'generated/') {
        throw 'Remote debug mode needs host-side Compose source watching; Linux inotify does not observe Windows edits through this WSL bind.'
    }
    Write-Host 'PASS: host-side Compose watch covers Windows-to-WSL source changes'

    $generated = @($debug.services.api.volumes | Where-Object target -eq '/usr/src/app/src/generated')
    if ($generated.Count -ne 1 -or $generated[0].type -ne 'volume') {
        throw 'Container Prisma generation must not rewrite the Windows host generated client or trigger a source-watch restart loop.'
    }
    Write-Host 'PASS: platform-generated Prisma output is isolated from host sources'

    $env:SCIM_CONTAINER_SOURCE_ROOT = $null
    $env:SCIM_CONTAINER_LOG_DIRECTORY = $null
    $json = & $DockerCommand compose -f (Join-Path $root 'docker-compose.yml') config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Compose failed to render its existing defaults.' }
    $defaults = ($json -join "`n") | ConvertFrom-Json
    $sql = @($defaults.services.postgres.volumes | Where-Object target -eq '/docker-entrypoint-initdb.d/01-extensions.sql')
    if ($sql.Count -ne 1 -or
        [IO.Path]::GetFullPath($sql[0].source) -ne (Join-Path $root 'scripts\init-pg-extensions.sql')) {
        throw 'Default local bind resolution changed.'
    }
    Write-Host 'PASS: existing local checkout bind defaults are preserved'
} finally {
    foreach ($entry in $previous.GetEnumerator()) {
        Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value
    }
}
