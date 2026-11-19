$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$helper = Join-Path $repoRoot 'scripts\independent-container-runtime.ps1'
if (-not (Test-Path -LiteralPath $helper)) {
    throw 'Independent-runtime preflight is absent: Desktop client/provider/server dependencies cannot be rejected.'
}
. $helper

$failures = [System.Collections.Generic.List[string]]::new()
$temporary = Join-Path ([IO.Path]::GetTempPath()) "scim-runtime-contract-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $temporary
$previous = @{}
foreach ($key in @('DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT')) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    Set-Item -LiteralPath "Env:$key" -Value $null
}
$env:DOCKER_CONFIG = $temporary
$originalExitCode = $global:LASTEXITCODE

function Get-Command {
    param($Name, $ErrorAction)
    if ($Name -like 'docker-credential-*') {
        if ($state.MissingHelper) { return }
        return [pscustomobject]@{ CommandType = 'Application'; Source = $state.HelperPath }
    }
    if ($Name -ne 'docker') { throw "Unexpected command lookup: $Name" }
    if ($state.MissingClient) { return }
    [pscustomobject]@{ CommandType = $state.CommandType; Source = $state.ClientPath }
}

function Get-Item {
    param($LiteralPath, [switch]$Force, $ErrorAction)
    if ($state.ResolvedClientPath -and $LiteralPath -eq $state.ClientPath) {
        $item = [pscustomobject]@{ LinkType = 'SymbolicLink' }
        $item | Add-Member -MemberType ScriptMethod -Name ResolveLinkTarget -Value {
            param($ReturnFinalTarget)
            [pscustomobject]@{ FullName = $state.ResolvedClientPath }
        }
        return $item
    }
    [pscustomobject]@{ LinkType = $null }
}

function docker {
    $state.Calls.Add(($args -join ' '))
    $global:LASTEXITCODE = 0
    switch ($args[0]) {
        'context' {
            if ($args[1] -eq 'show') { return 'scim-trial' }
            if ($state.ContextFailure) { $global:LASTEXITCODE = 1; return }
            $state.Endpoint | ConvertTo-Json -Compress
        }
        'info' {
            if ($state.ServerFailure) { $global:LASTEXITCODE = 1; return }
            if ($state.InvalidJson) { return 'not-json' }
            $state.Info | ConvertTo-Json -Depth 6 -Compress
        }
        'compose' {
            if ($state.ComposeFailure) { $global:LASTEXITCODE = 1; return }
            'Docker Compose version v2.40.3'
        }
        'buildx' {
            if ($state.BuildxFailure) { $global:LASTEXITCODE = 1; return }
            'github.com/docker/buildx v0.30.1'
        }
        default { throw "Preflight attempted a non-read-only operation: $($args[0])" }
    }
}

$cases = @(
    @{ Name = 'independent Linux engine'; Accept = $true },
    @{ Name = 'independent Podman-compatible server'; Accept = $true; Change = { $state.Info.OperatingSystem = 'Fedora Linux'; $state.Info.ServerVersion = '5.8.10' } },
    @{ Name = 'Desktop executable'; Change = { $state.ClientPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' } },
    @{ Name = 'Desktop executable inherited into WSL'; Change = { $state.ClientPath = '/mnt/c/Program Files/Docker/Docker/resources/bin/docker' } },
    @{ Name = 'client symlink into Desktop'; Change = { $state.ResolvedClientPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' } },
    @{ Name = 'shell alias or function'; Change = { $state.CommandType = 'Function' } },
    @{ Name = 'missing client'; Change = { $state.MissingClient = $true } },
    @{ Name = 'Desktop Compose plugin'; Change = { $state.Info.ClientInfo.Plugins[0].Path = 'C:\Program Files\Docker\Docker\resources\cli-plugins\docker-compose.exe' } },
    @{ Name = 'Desktop Buildx plugin'; Change = { $state.Info.ClientInfo.Plugins[1].Path = '/mnt/c/Program Files/Docker/Docker/resources/cli-plugins/docker-buildx.exe' } },
    @{ Name = 'missing plugin provenance'; Change = { $state.Info.ClientInfo.Plugins[0].Path = '' } },
    @{ Name = 'missing Buildx'; Change = { $state.Info.ClientInfo.Plugins = @($state.Info.ClientInfo.Plugins[0]) } },
    @{ Name = 'Desktop server operating system'; Change = { $state.Info.OperatingSystem = 'Docker Desktop' } },
    @{ Name = 'Desktop server name'; Change = { $state.Info.Name = 'docker-desktop' } },
    @{ Name = 'non-Linux server'; Change = { $state.Info.OSType = 'windows' } },
    @{ Name = 'incomplete server identity'; Change = { $state.Info.ServerVersion = '' } },
    @{ Name = 'unreachable server'; Change = { $state.ServerFailure = $true } },
    @{ Name = 'malformed server JSON'; Change = { $state.InvalidJson = $true } },
    @{ Name = 'Desktop named pipe'; Change = { $state.Endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine' } },
    @{ Name = 'failed context lookup'; Change = { $state.ContextFailure = $true } },
    @{ Name = 'explicit Desktop host'; Change = { $env:DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine' } },
    @{ Name = 'host override supersedes saved context'; Accept = $true; Change = { $env:DOCKER_HOST = 'npipe:////./pipe/podman-trial'; $state.Endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine' } },
    @{ Name = 'context override supersedes host override'; Change = { $env:DOCKER_HOST = 'unix:///var/run/docker.sock'; $env:DOCKER_CONTEXT = 'desktop-linux'; $state.Endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine' } },
    @{ Name = 'unauthenticated TCP daemon'; Change = { $state.Endpoint = 'tcp://127.0.0.1:2375' } },
    @{ Name = 'Desktop default credential store'; Config = '{"credsStore":"desktop"}' },
    @{ Name = 'Desktop registry-specific helper'; Config = '{"credHelpers":{"registry.example.test":"desktop"}}' },
    @{ Name = 'independent credential helper'; Accept = $true; Config = '{"credsStore":"wincred"}' },
    @{ Name = 'helper executable inside Desktop'; Config = '{"credsStore":"wincred"}'; Change = { $state.HelperPath = 'C:\Program Files\Docker\Docker\resources\bin\docker-credential-wincred.exe' } },
    @{ Name = 'missing credential helper'; Config = '{"credsStore":"wincred"}'; Change = { $state.MissingHelper = $true } },
    @{ Name = 'malformed client configuration'; Config = '{' },
    @{ Name = 'malformed secret-bearing configuration'; Config = '{"auths":{"registry.example.test":{"auth":"do-not-log-this"}},"bad":}' },
    @{ Name = 'non-object helper mapping'; Config = '{"credHelpers":""}' },
    @{ Name = 'non-object client configuration'; Config = '[]' },
    @{ Name = 'Compose execution fails'; Change = { $state.ComposeFailure = $true } },
    @{ Name = 'Buildx execution fails'; Change = { $state.BuildxFailure = $true } }
)

$expectedErrors = @{
    'Desktop executable' = 'Desktop executable'
    'Desktop executable inherited into WSL' = 'Desktop executable'
    'client symlink into Desktop' = 'executable link'
    'shell alias or function' = 'shell aliases and functions'
    'missing client' = 'independent Docker-compatible executable'
    'Desktop Compose plugin' = 'Desktop executable'
    'Desktop Buildx plugin' = 'Desktop executable'
    'missing plugin provenance' = 'provenance is unavailable'
    'missing Buildx' = 'Exactly one independently installed buildx'
    'Desktop server operating system' = 'server is Docker Desktop'
    'Desktop server name' = 'server is Docker Desktop'
    'non-Linux server' = 'Linux container server'
    'incomplete server identity' = 'complete identity metadata'
    'unreachable server' = 'server is unreachable'
    'malformed server JSON' = 'Conversion from JSON failed'
    'Desktop named pipe' = 'endpoint still targets Docker Desktop'
    'failed context lookup' = 'Cannot inspect'
    'explicit Desktop host' = 'endpoint still targets Docker Desktop'
    'context override supersedes host override' = 'endpoint still targets Docker Desktop'
    'unauthenticated TCP daemon' = 'TCP daemon access is not qualified'
    'Desktop default credential store' = 'Desktop credential helper'
    'Desktop registry-specific helper' = 'Desktop credential helper'
    'helper executable inside Desktop' = 'Desktop executable'
    'missing credential helper' = 'credential-helper executable is unavailable'
    'malformed client configuration' = 'Cannot parse Docker client configuration'
    'malformed secret-bearing configuration' = 'Cannot parse Docker client configuration'
    'non-object helper mapping' = 'credHelpers must be an object'
    'non-object client configuration' = 'configuration must be a JSON object'
    'Compose execution fails' = 'Compose plugin failed'
    'Buildx execution fails' = 'Buildx plugin failed'
}

try {
    foreach ($case in $cases) {
        $env:DOCKER_HOST = $null
        $env:DOCKER_CONTEXT = $null
        $configPath = Join-Path $temporary 'config.json'
        if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath }
        if ($case.Config) { [IO.File]::WriteAllText($configPath, $case.Config) }
        $state = @{
            ClientPath = 'C:\Independent\docker.exe'
            CommandType = 'Application'
            HelperPath = 'C:\Independent\docker-credential-wincred.exe'
            Endpoint = 'unix:///var/run/docker.sock'
            Calls = [System.Collections.Generic.List[string]]::new()
            Info = @{
                Name = 'scim-trial'
                OperatingSystem = 'Ubuntu 24.04'
                OSType = 'linux'
                ServerVersion = '29.1.3'
                ClientInfo = @{ Plugins = @(
                    @{ Name = 'compose'; Path = 'C:\Independent\docker-compose.exe' },
                    @{ Name = 'buildx'; Path = 'C:\Independent\docker-buildx.exe' }
                ) }
            }
        }
        if ($case.Change) { & $case.Change }
        $accepted = $false
        $failure = $null
        try {
            $result = Assert-IndependentContainerRuntime
            $accepted = $true
            if (-not $result.ServerVersion -or $result.ServerOS -ne 'linux' -or
                -not $result.ComposePath -or -not $result.BuildxPath) {
                throw 'Accepted preflight did not return the required runtime evidence.'
            }
        } catch {
            $failure = $_.Exception.Message
        }
        $expected = $case.Accept -eq $true
        $incorrectFailure = -not $expected -and
            (-not $expectedErrors.ContainsKey($case.Name) -or
                $failure -notmatch [regex]::Escape($expectedErrors[$case.Name]))
        if ($accepted -ne $expected -or ($expected -and $failure) -or $incorrectFailure -or
            $failure -match 'do-not-log-this') {
            $failures.Add("$($case.Name): expected acceptance=$expected, actual=$accepted, error=$failure")
            Write-Host "FAIL: $($failures[-1])"
        } else {
            Write-Host "PASS: $($case.Name)"
        }
        if ($case.Name -eq 'context override supersedes host override' -and
            -not ($state.Calls -contains 'context inspect desktop-linux --format {{json .Endpoints.docker.Host}}')) {
            $failures.Add('Explicit DOCKER_CONTEXT was not inspected.')
        }
    }
} finally {
    foreach ($entry in $previous.GetEnumerator()) {
        Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value
    }
    $global:LASTEXITCODE = $originalExitCode
    $configPath = Join-Path $temporary 'config.json'
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath }
    Remove-Item -LiteralPath $temporary
}

if ($failures.Count) {
    $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}
Write-Host "All $($cases.Count) independent-runtime contracts passed; no real runtime was invoked."
