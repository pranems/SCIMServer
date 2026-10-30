[CmdletBinding()]
param(
    [string]$ExpectedAdapter = '2.1.3',
    [string]$AdapterPath,
    [ValidateRange(30, 180)]
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'assert-dependency-ownership.ps1') -RepositoryRoot $root
if ($LASTEXITCODE) { throw 'Dependency ownership preflight failed.' }

$run = [Guid]::NewGuid().ToString('N')
$name = "scim-hono-qualification-$run"
$state = Join-Path $root "test-results\hono-parent-qualification-20261029\run-$run"
New-Item -ItemType Directory -Path $state | Out-Null
$args = @(
    'create', '--name', $name, '--network', 'none', '--read-only',
    '--label', "com.scimserver.hono-qualification=$run",
    '--mount', "type=bind,source=$root\api\node_modules,target=/qualification/node_modules,readonly",
    '--mount', "type=bind,source=$PSScriptRoot\fixtures,target=/qualification/fixtures,readonly",
    '--mount', "type=bind,source=$state,target=/qualification/state",
    '--workdir', '/qualification/state',
    '--env', 'HOME=/qualification/state/home',
    '--env', 'XDG_DATA_HOME=/qualification/state/data',
    '--env', 'XDG_CONFIG_HOME=/qualification/state/config',
    '--env', 'XDG_CACHE_HOME=/qualification/state/cache',
    '--env', 'SCIM_HONO_ISOLATED=1',
    '--env', "EXPECT_ADAPTER=$ExpectedAdapter"
)
if ($AdapterPath) {
    $adapter = (Resolve-Path -LiteralPath $AdapterPath).Path
    $qualificationRoot = Join-Path $root 'test-results\hono-parent-qualification-20261029\'
    if (-not $adapter.StartsWith($qualificationRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Candidate adapter must be an extracted package inside the owned qualification evidence directory.'
    }
    $args += @('--mount', "type=bind,source=$adapter,target=/qualification/node_modules/@hono/node-server,readonly")
}
$args += @('node:24-alpine', 'node', '/qualification/fixtures/prisma-hono-parent.cjs')
$container = $null
try {
    $container = (& docker @args | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $container -notmatch '^[a-f0-9]{64}$') {
        throw 'Could not create the isolated qualification container.'
    }
    $inspection = & docker inspect $container | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $inspection[0].Name -ne "/$name" -or
        $inspection[0].Config.Labels.'com.scimserver.hono-qualification' -ne $run -or
        $inspection[0].HostConfig.NetworkMode -ne 'none' -or
        $inspection[0].HostConfig.PortBindings.PSObject.Properties.Count -gt 0) {
        throw 'Container ownership or network isolation verification failed.'
    }
    $inspection | ConvertTo-Json -Depth 30 | Set-Content (Join-Path $state 'container.json')
    & docker start $container | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Container startup failed.' }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    $resultPath = Join-Path $state 'result.json'
    while (-not (Test-Path -LiteralPath $resultPath)) {
        if ([DateTimeOffset]::UtcNow -gt $deadline) { throw "Parent qualification exceeded $TimeoutSeconds seconds." }
        $status = & docker inspect --format '{{.State.Running}}' $container
        if ($LASTEXITCODE -ne 0 -or $status -ne 'true') { throw 'Parent exited before completing its lifecycle assertions.' }
        Start-Sleep -Seconds 1
    }
    $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
    if ($result.passed -ne $true -or $result.adapter -ne $ExpectedAdapter -or $result.claims.Count -ne 12) {
        throw 'Incomplete or mismatched parent qualification result.'
    }
    Start-Sleep -Seconds 2
    & docker inspect --format '{{json .State}}' $container |
        Set-Content (Join-Path $state 'state-before-cleanup.json')
    Write-Host "PASS: actual parent lifecycle assertions completed. Evidence: $state"
    Write-Host 'Natural process exit is not asserted. Any retained process is explicitly stopped below.'
} finally {
    if ($container -match '^[a-f0-9]{64}$') {
        & docker logs $container *> (Join-Path $state 'parent.log')
        & docker stop --timeout 5 $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not stop owned container $container." }
        $stopped = & docker inspect --format '{{.State.Running}}' $container
        if ($LASTEXITCODE -ne 0 -or $stopped -ne 'false') { throw "Owned container $container is still running." }
        & docker inspect --format '{{json .State}}' $container |
            Set-Content (Join-Path $state 'state-after-cleanup.json')
        & docker rm $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not remove owned container $container." }
        Write-Host "CLEANUP: stopped and removed exact owned container $container."
    }
}
