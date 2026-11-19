function Enable-IndependentContainerRuntime {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$ClientPath,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$ConfigDirectory,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$Endpoint,
        [string]$BindSourceRoot,
        [string]$LogDirectory
    )

    $client = [IO.Path]::GetFullPath($ClientPath)
    if ([IO.Path]::GetFileName($client) -notin @('docker', 'docker.exe')) {
        throw 'Select an independent docker executable, not a command wrapper.'
    }
    $previous = @{}
    foreach ($key in @('PATH', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME',
        'SCIM_CONTAINER_SOURCE_ROOT', 'SCIM_CONTAINER_LOG_DIRECTORY')) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    }
    $accepted = $false
    try {
        $env:PATH = (Split-Path -Parent $client) + [IO.Path]::PathSeparator + $env:PATH
        $env:DOCKER_CONFIG = [IO.Path]::GetFullPath($ConfigDirectory)
        $env:DOCKER_CONTEXT = $null
        $env:DOCKER_HOST = $Endpoint
        $env:SCIM_CONTAINER_SOURCE_ROOT = $BindSourceRoot
        $env:SCIM_CONTAINER_LOG_DIRECTORY = $LogDirectory
        $evidence = Assert-IndependentContainerRuntime
        $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
        if (-not [string]::Equals([IO.Path]::GetFullPath($evidence.ClientPath), $client, $comparison)) {
            throw 'Runtime activation did not resolve the requested executable.'
        }
        $env:SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME = '1'
        $accepted = $true
        $evidence
    } finally {
        if (-not $accepted) {
            foreach ($entry in $previous.GetEnumerator()) {
                Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value -ErrorAction Stop
            }
        }
    }
}

function Assert-IndependentContainerRuntime {
    [CmdletBinding()]
    param()

    function Assert-IndependentExecutable([string]$Path) {
        if ([string]::IsNullOrWhiteSpace($Path)) {
            throw 'Runtime executable provenance is unavailable.'
        }
        $desktopPattern = '(?i)(?:^|[\\/])(?:Docker[\\/]Docker|docker-desktop)(?:[\\/]|$)'
        if ($Path -match $desktopPattern) {
            throw 'The container toolchain still references a Docker Desktop executable.'
        }
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if ($item.LinkType) {
            $target = $item.ResolveLinkTarget($true)
            if (-not $target -or $target.FullName -match $desktopPattern) {
                throw 'A container executable link is unresolved or points into Docker Desktop.'
            }
        }
    }

    $client = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $client -or $client.CommandType -ne 'Application') {
        throw 'An independent Docker-compatible executable is required; shell aliases and functions are not accepted.'
    }
    Assert-IndependentExecutable $client.Source

    $configDirectory = $env:DOCKER_CONFIG
    if (-not $configDirectory) { $configDirectory = Join-Path $HOME '.docker' }
    $configPath = Join-Path $configDirectory 'config.json'
    if (Test-Path -LiteralPath $configPath) {
        $configText = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop
        try {
            $config = $configText | ConvertFrom-Json -AsHashtable -ErrorAction Stop
        } catch [System.ArgumentException] {
            throw 'Cannot parse Docker client configuration; repair it without logging secret values.'
        }
        if ($config -isnot [System.Collections.IDictionary]) {
            throw 'The Docker client configuration must be a JSON object.'
        }
        $helpers = @()
        if ($config['credsStore']) { $helpers += $config['credsStore'] }
        if ($config.Contains('credHelpers')) {
            if ($config['credHelpers'] -isnot [System.Collections.IDictionary]) {
                throw 'Docker credHelpers must be an object.'
            }
            $helpers += $config['credHelpers'].Values
        }
        foreach ($helper in ($helpers | Select-Object -Unique)) {
            if ($helper -isnot [string] -or $helper -notmatch '^[A-Za-z0-9._-]+$') {
                throw 'A Docker credential-helper name is invalid.'
            }
            if ($helper -match '^desktop(?:\.|$)') {
                throw 'Docker client credentials still depend on the Desktop credential helper; migrate them without copying secret values.'
            }
            $command = Get-Command "docker-credential-$helper" -ErrorAction SilentlyContinue
            if (-not $command -or $command.CommandType -ne 'Application') {
                throw 'A configured independent credential-helper executable is unavailable.'
            }
            Assert-IndependentExecutable $command.Source
        }
    }

    if ($env:DOCKER_CONTEXT -or -not $env:DOCKER_HOST) {
        $context = $env:DOCKER_CONTEXT
        if (-not $context) {
            $context = & docker context show 2>&1
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($context -join ''))) {
                throw 'Cannot resolve the selected Docker context.'
            }
        }
        $endpointJson = & docker context inspect $context --format '{{json .Endpoints.docker.Host}}' 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the selected Docker endpoint.' }
        $endpoint = ($endpointJson -join "`n") | ConvertFrom-Json -ErrorAction Stop
    } else {
        $endpoint = $env:DOCKER_HOST
    }
    if ($endpoint -isnot [string] -or [string]::IsNullOrWhiteSpace($endpoint)) {
        throw 'The selected Docker endpoint is unavailable.'
    }
    if ($endpoint -match '(?i)dockerDesktop|docker-desktop|desktop-linux') {
        throw 'The selected endpoint still targets Docker Desktop.'
    }
    if ($endpoint -match '^(?i)tcp:') {
        throw 'TCP daemon access is not qualified by this preflight; use a local Unix socket, named pipe, or qualified SSH transport.'
    }
    if ($endpoint -notmatch '^(?i)(unix|npipe|ssh)://') {
        throw 'The selected Docker endpoint uses an unsupported transport.'
    }

    $infoJson = & docker info --format '{{json .}}' 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'The selected independent container server is unreachable. Start the intended approved runtime explicitly; this check does not start or switch runtimes.'
    }
    $info = ($infoJson -join "`n") | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($info -isnot [System.Collections.IDictionary] -or $info['OSType'] -ne 'linux' -or
        -not $info['ServerVersion'] -or -not $info['OperatingSystem'] -or -not $info['Name']) {
        throw 'A reachable Linux container server with complete identity metadata is required.'
    }
    if ($info['OperatingSystem'] -match '(?i)Docker Desktop' -or
        $info['Name'] -match '(?i)docker-desktop') {
        throw 'The selected server is Docker Desktop.'
    }
    if ($info['ClientInfo'] -isnot [System.Collections.IDictionary]) {
        throw 'Docker-compatible client plugin provenance is unavailable.'
    }
    $paths = @{}
    foreach ($name in @('compose', 'buildx')) {
        $plugins = @($info['ClientInfo']['Plugins'] | Where-Object { $_['Name'] -eq $name })
        if ($plugins.Count -ne 1) { throw "Exactly one independently installed $name plugin is required." }
        Assert-IndependentExecutable $plugins[0]['Path']
        $paths[$name] = $plugins[0]['Path']
    }
    $null = & docker compose version 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'The independently installed Compose plugin failed its version check.' }
    $null = & docker buildx version 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'The independently installed Buildx plugin failed its version check.' }

    [pscustomobject]@{
        ClientPath = $client.Source
        ServerVersion = $info['ServerVersion']
        ServerOS = $info['OSType']
        ComposePath = $paths['compose']
        BuildxPath = $paths['buildx']
    }
}
