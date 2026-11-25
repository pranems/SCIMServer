param([string]$BuilderPath)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$source = if ($BuilderPath) { $BuilderPath } else { Join-Path $root 'scripts\build-standalone.ps1' }
$fixture = Join-Path $root ('test-results\native-preparation-' + [guid]::NewGuid().ToString('N'))
$failures = [System.Collections.Generic.List[string]]::new()
$savedUrl = $env:DATABASE_URL
$savedLocation = Get-Location
$global:NativePreparationContract = @{
    Calls = [System.Collections.Generic.List[string]]::new()
    FailureStage = ''
    GenerationUrl = $null
    BuildUrl = $null
}

function Assert-Contract([bool]$Condition, [string]$Message) {
    if ($Condition) { Write-Host "PASS: $Message" }
    else { $failures.Add($Message); Write-Host "FAIL: $Message" }
}

function npm {
    $global:NativePreparationContract.Calls.Add('npm ' + ($args -join ' '))
    $global:LASTEXITCODE = if ($global:NativePreparationContract.FailureStage -eq 'install') { 17 } else { 0 }
}

function Get-Command {
    param([string]$Name, [string]$ErrorAction)
    if ($global:NativePreparationContract.FailureStage -eq 'missing-node' -and $Name -eq 'node') { return }
    Microsoft.PowerShell.Core\Get-Command -Name $Name -ErrorAction $ErrorAction
}

function npx {
    $global:NativePreparationContract.Calls.Add('npx ' + ($args -join ' '))
    if ($args[0] -eq 'prisma') {
        $global:NativePreparationContract.GenerationUrl = $env:DATABASE_URL
        $global:LASTEXITCODE = if ($global:NativePreparationContract.FailureStage -eq 'generate') { 19 } else { 0 }
        if ($LASTEXITCODE -eq 0) {
            New-Item -ItemType Directory -Path 'src\generated\prisma' -Force | Out-Null
            Set-Content 'src\generated\prisma\client.ts' 'contract generated source'
        }
    } else {
        $global:NativePreparationContract.BuildUrl = $env:DATABASE_URL
        if (-not (Test-Path 'src\generated\prisma\client.ts')) { throw 'Build ran without generated source.' }
        $global:LASTEXITCODE = if ($global:NativePreparationContract.FailureStage -eq 'build') { 21 } else { 0 }
        if ($LASTEXITCODE -eq 0) {
            New-Item -ItemType Directory -Path 'dist' -Force | Out-Null
            Set-Content 'dist\main.js' 'contract compiled source'
        }
    }
}

try {
    New-Item -ItemType Directory -Path "$fixture\scripts", "$fixture\api", "$fixture\standalone" -Force | Out-Null
    Copy-Item $source "$fixture\scripts\build-standalone.ps1"
    Copy-Item "$root\api\package.json" "$fixture\api\package.json"
    Copy-Item "$root\api\package-lock.json" "$fixture\api\package-lock.json"
    $lockHash = (Get-FileHash "$fixture\api\package-lock.json").Hash
    Set-Content "$fixture\standalone\retained" 'existing package must remain untouched'
    New-Item -ItemType Directory -Path "$fixture\api\node_modules\prisma\build", "$fixture\api\node_modules\typescript\bin" -Force | Out-Null
    Set-Content "$fixture\api\node_modules\prisma\build\index.js" 'contract local CLI'
    Set-Content "$fixture\api\node_modules\typescript\bin\tsc" 'contract local compiler'

    foreach ($stage in @('install', 'generate', 'build', 'none', 'missing-cli', 'missing-compiler', 'missing-node')) {
        foreach ($url in @($null, 'caller-owned-datasource-sentinel')) {
            $global:NativePreparationContract.FailureStage = $stage
            $global:NativePreparationContract.Calls.Clear()
            $global:NativePreparationContract.GenerationUrl = $null
            $global:NativePreparationContract.BuildUrl = $null
            $env:DATABASE_URL = $url
            foreach ($path in @("$fixture\api\src\generated", "$fixture\api\dist")) {
                if (Test-Path $path) { Remove-Item $path -Recurse -Force }
            }
            if ($stage -eq 'missing-cli') {
                if (Test-Path "$fixture\api\node_modules\prisma\build\index.js") {
                    Remove-Item "$fixture\api\node_modules\prisma\build\index.js"
                }
            } elseif (-not (Test-Path "$fixture\api\node_modules\prisma\build\index.js")) {
                Set-Content "$fixture\api\node_modules\prisma\build\index.js" 'contract local CLI'
            }
            if ($stage -eq 'missing-compiler') {
                if (Test-Path "$fixture\api\node_modules\typescript\bin\tsc") {
                    Remove-Item "$fixture\api\node_modules\typescript\bin\tsc"
                }
            } elseif (-not (Test-Path "$fixture\api\node_modules\typescript\bin\tsc")) {
                Set-Content "$fixture\api\node_modules\typescript\bin\tsc" 'contract local compiler'
            }
            $message = $null
            try { & "$fixture\scripts\build-standalone.ps1" -PrepareOnly | Out-Null }
            catch { $message = $_.Exception.Message }

            $expected = switch ($stage) {
                'missing-node' { @() }
                'install' { @('npm ci --no-audit --no-fund') }
                'missing-cli' { @('npm ci --no-audit --no-fund') }
                'missing-compiler' { @('npm ci --no-audit --no-fund') }
                'generate' { @('npm ci --no-audit --no-fund', 'npx prisma generate') }
                default { @('npm ci --no-audit --no-fund', 'npx prisma generate', 'npx tsc -p tsconfig.build.json') }
            }
            Assert-Contract (($global:NativePreparationContract.Calls -join '|') -ceq ($expected -join '|')) "$stage executes only the ordered preparation stages"
            Assert-Contract ((Get-Location).Path -eq $savedLocation.Path) "$stage restores the caller location"
            Assert-Contract ($env:DATABASE_URL -ceq $url) "$stage restores the caller datasource"
            Assert-Contract (Test-Path "$fixture\standalone\retained") "$stage does not clean or assemble a package"
            Assert-Contract ((Get-FileHash "$fixture\api\package-lock.json").Hash -eq $lockHash) "$stage preserves the lockfile"
            if ($stage -in @('generate', 'build', 'none')) {
                Assert-Contract ($global:NativePreparationContract.GenerationUrl -eq 'postgresql://build:build@127.0.0.1:1/build') "$stage generation uses only the nonconnecting build datasource"
            }
            if ($stage -in @('build', 'none')) {
                Assert-Contract ($global:NativePreparationContract.BuildUrl -ceq $url) "$stage restores the datasource before compilation"
            }
            if ($stage -eq 'none') {
                Assert-Contract ($null -eq $message -and (Test-Path "$fixture\api\dist\main.js")) 'Successful preparation returns compiled API without packaging'
            } else {
                $errorPattern = switch ($stage) {
                    'install' { 'API clean dependency installation failed \(exit 17\)' }
                    'generate' { 'Prisma client generation failed \(exit 19\)' }
                    'build' { 'TypeScript compilation failed \(exit 21\)' }
                    'missing-cli' { 'Local Prisma CLI.*missing' }
                    'missing-compiler' { 'Local TypeScript compiler.*missing' }
                    'missing-node' { "Required build tool 'node' is missing" }
                }
                Assert-Contract ($message -match $errorPattern) "$stage reports the failing stage explicitly"
            }
        }
    }
    foreach ($option in @('IncludeNode', 'IncludePostgres', 'Zip')) {
        $global:NativePreparationContract.Calls.Clear()
        $message = $null
        $options = @{$option = $true}
        try { & "$fixture\scripts\build-standalone.ps1" -PrepareOnly @options | Out-Null }
        catch { $message = $_.Exception.Message }
        Assert-Contract ($message -match 'PrepareOnly cannot be combined' -and $global:NativePreparationContract.Calls.Count -eq 0) "Preparation rejects packaging option $option before installation"
    }
} finally {
    $env:DATABASE_URL = $savedUrl
    Set-Location $savedLocation
    Remove-Item $fixture -Recurse -Force
    Remove-Variable NativePreparationContract -Scope Global
}

if ($failures.Count) { throw "$($failures.Count) native preparation contract assertions failed." }
Write-Host 'PASS: native preparation contracts complete.'
