param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$builder = Join-Path $root 'scripts\build-standalone.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($builder, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Builder does not parse: $errors" }
$fixture = Join-Path $root ('test-results\standalone-migration-contract-' + [guid]::NewGuid().ToString('N'))
$OutPath = $fixture
$ApiDir = Join-Path $root 'api'
$ProjectVersion = 'contract'
$MinNodeVersion = '24'
$Port = 18080
$IncludePostgres = $true
$IncludeNode = $false
$NodeVersion = ''
$failures = [System.Collections.Generic.List[string]]::new()
$originalStatus = $env:SCIM_STANDALONE_CONTRACT_EXIT
$env:SCIM_STANDALONE_CONTRACT_EXIT = '23'

function Assert-Contract([bool]$Condition, [string]$Message) {
    if ($Condition) { Write-Host "PASS: $Message" }
    else { $failures.Add($Message); Write-Host "FAIL: $Message" }
}

try {
    $builderText = Get-Content $builder -Raw
    Assert-Contract ($builderText -notmatch '(?m)^\s*npm install(?:\s|$)') 'Clean builder never falls back to lockfile-regenerating npm install'
    foreach ($command in @(
        'npm ci --no-audit --no-fund',
        'npx prisma generate',
        'npm run build',
        'npm ci --omit=dev --no-audit --no-fund'
    )) {
        $pattern = '(?m)^\s*' + [regex]::Escape($command) + '[^\r\n]*\r?\n\s*if \(\$LASTEXITCODE -ne 0\) \{ throw '
        $matches = [regex]::Matches($builderText, [regex]::Escape($command) + '(?:\s|$)').Count
        $guarded = [regex]::Matches($builderText, $pattern).Count
        Assert-Contract ($matches -gt 0 -and $guarded -eq $matches) "Clean builder checks every $command result before continuing"
    }
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    Copy-Item (Join-Path $ApiDir 'package.json') (Join-Path $fixture 'package.json')
    # Evaluate the real generator templates without downloads, installs or a server.
    $templates = $ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.PipelineAst] -and
        $node.Extent.Text -match '(?s)^@".*Set-Content -Path \(Join-Path \$OutPath '
    }, $true)
    foreach ($template in $templates) { Invoke-Expression $template.Extent.Text }
    foreach ($script in Get-ChildItem $fixture -Filter '*.ps1') {
        $null = [System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors)
        Assert-Contract ($errors.Count -eq 0) "$($script.Name) parses"
    }

    $configCopy = $ast.EndBlock.Statements | Where-Object {
        $_.Extent.Text -match '^Copy-Item.*prisma\.config\.ts.*\$OutPath'
    }
    foreach ($statement in $configCopy) { Invoke-Expression $statement.Extent.Text }
    $packagedConfig = Join-Path $fixture 'prisma.config.ts'
    Assert-Contract ((Test-Path $packagedConfig) -and
        ((Get-FileHash $packagedConfig).Hash -eq (Get-FileHash (Join-Path $ApiDir 'prisma.config.ts')).Hash)) 'Package includes the unchanged Prisma 7 datasource config'
    foreach ($name in @('start.ps1', 'start-bundled-postgres.ps1', 'start-postgres.bat', 'start-bundled-postgres.bat')) {
        $text = Get-Content (Join-Path $fixture $name) -Raw
        Assert-Contract ($text -match 'migrate deploy --config') "$name selects the packaged config explicitly"
        Assert-Contract ($text -notmatch 'npx prisma') "$name uses only the packaged CLI, never network-capable npx"
        $guard = if ($name.EndsWith('.ps1')) { '(?s)migrate deploy[^\r\n]*\r?\n\s*if \(\$LASTEXITCODE -ne 0\) \{ throw "Prisma migrations failed' }
                 else { '(?s)migrate deploy.*?\r?\n\)\r?\nif not "%ERRORLEVEL%"=="0" \(' }
        Assert-Contract ($text -match $guard) "$name checks migration failure before application startup"
        if ($name -eq 'start-bundled-postgres.bat') {
            Assert-Contract ($text -match '(?s)if not "%ERRORLEVEL%"=="0" \(\s*echo  ERROR: Prisma migrations failed.*?pg_ctl\.exe" stop.*?exit /b 1') 'Bundled batch stops PostgreSQL on migration failure'
        }
        if ($name -eq 'start-bundled-postgres.ps1') {
            Assert-Contract ($text -match '(?s)finally \{.*?& \$pg_ctl stop') 'Bundled PowerShell retains PostgreSQL cleanup on migration failure'
        }
    }

    New-Item -ItemType Directory -Path (Join-Path $fixture 'node_modules\prisma\build'), (Join-Path $fixture 'dist'), (Join-Path $fixture 'node') -Force | Out-Null
    Copy-Item (Get-Command node).Source (Join-Path $fixture 'node\node.exe')
    @'
if (!process.argv.includes('--config')) {
  console.error('CONTRACT: packaged Prisma config not selected');
  process.exit(23);
}
const expected = require('path').join(__dirname, '..', '..', '..', 'prisma.config.ts');
if (process.argv[process.argv.indexOf('--config') + 1] !== expected) {
  console.error('CONTRACT: config is not rooted in the package');
  process.exit(24);
}
const status = Number(process.env.SCIM_STANDALONE_CONTRACT_EXIT || 23);
console.error(`CONTRACT: migration exit ${status}`);
process.exit(status);
'@ | Set-Content (Join-Path $fixture 'node_modules\prisma\build\index.js')
    "require('fs').writeFileSync(require('path').join(__dirname, 'started'), 'unexpected');" |
        Set-Content (Join-Path $fixture 'dist\main.js')
    & (Join-Path $fixture 'node\node.exe') (Join-Path $fixture 'dist\main.js')
    Assert-Contract (Test-Path (Join-Path $fixture 'dist\started')) 'Startup sentinel detects an executed application'
    Remove-Item (Join-Path $fixture 'dist\started') -ErrorAction SilentlyContinue

    Push-Location $root
    try {
        $output = & pwsh -NoProfile -File (Join-Path $fixture 'start.ps1') -DatabaseUrl 'postgresql://contract:synthetic@127.0.0.1:1/contract' -RunMigrations 2>&1
        $exitCode = $LASTEXITCODE
        Assert-Contract ($exitCode -ne 0) 'PowerShell migration failure returns nonzero'
        Assert-Contract (($output -join "`n") -match 'CONTRACT: migration exit 23') 'PowerShell invoked the packaged CLI with the package-rooted config'
        Assert-Contract (-not (Test-Path (Join-Path $fixture 'dist\started'))) 'PowerShell migration failure never starts the application'
        Assert-Contract (($output -join "`n") -match 'Prisma migrations failed') 'PowerShell migration failure reports the failing phase'
        Remove-Item (Join-Path $fixture 'dist\started') -ErrorAction SilentlyContinue

        if ($IsWindows -or $env:OS -eq 'Windows_NT') {
            $savedUrl = $env:DATABASE_URL
            try {
                $env:DATABASE_URL = 'postgresql://contract:synthetic@127.0.0.1:1/contract'
                $output = & $env:ComSpec /d /c "`"$(Join-Path $fixture 'start-postgres.bat')`"" 2>&1
                $exitCode = $LASTEXITCODE
                Assert-Contract ($exitCode -ne 0) 'Batch migration failure returns nonzero'
                Assert-Contract (($output -join "`n") -match 'CONTRACT: migration exit 23') 'Batch invoked the packaged CLI with the package-rooted config'
                Assert-Contract (-not (Test-Path (Join-Path $fixture 'dist\started'))) 'Batch migration failure never starts the application'
                Assert-Contract (($output -join "`n") -match 'Prisma migrations failed') 'Batch migration failure reports the failing phase'
            } finally { $env:DATABASE_URL = $savedUrl }
        }

        # Cover the system-Node branches too, and ensure success still starts the app.
        Remove-Item (Join-Path $fixture 'node') -Recurse -Force
        $savedStatus = $env:SCIM_STANDALONE_CONTRACT_EXIT
        $savedUrl = $env:DATABASE_URL
        try {
            $env:DATABASE_URL = 'postgresql://contract:synthetic@127.0.0.1:1/contract'
            foreach ($status in @('23', '-23', '0')) {
                $env:SCIM_STANDALONE_CONTRACT_EXIT = $status
                foreach ($name in @('start.ps1', 'start-postgres.bat')) {
                    if ($name.EndsWith('.bat') -and -not ($IsWindows -or $env:OS -eq 'Windows_NT')) { continue }
                    $sentinel = Join-Path $fixture 'dist\started'
                    Remove-Item $sentinel -ErrorAction SilentlyContinue
                    if ($name.EndsWith('.ps1')) {
                        $output = & pwsh -NoProfile -File (Join-Path $fixture $name) -RunMigrations 2>&1
                    } else {
                        $output = & $env:ComSpec /d /c "`"$(Join-Path $fixture $name)`"" 2>&1
                    }
                    $exitCode = $LASTEXITCODE
                    $success = $status -eq '0'
                    Assert-Contract (($exitCode -eq 0) -eq $success) "$name system Node returns the expected status for migration exit $status"
                    Assert-Contract ((Test-Path $sentinel) -eq $success) "$name system Node starts the app only after successful migrations (exit $status)"
                }
            }
        } finally {
            $env:SCIM_STANDALONE_CONTRACT_EXIT = $savedStatus
            $env:DATABASE_URL = $savedUrl
        }

        # A tiny local executable stands in for PostgreSQL, never opening a socket.
        $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
        if (Test-Path $compiler) {
            $pgBin = Join-Path $fixture 'pgsql\bin'
            New-Item -ItemType Directory -Path $pgBin, (Join-Path $fixture 'pgdata') -Force | Out-Null
            $shimSource = Join-Path $fixture 'postgres-contract.cs'
            @'
using System;
using System.IO;
using System.Reflection;
class PostgresContract {
    static int Main(string[] args) {
        string exe = Assembly.GetExecutingAssembly().Location;
        File.AppendAllText(Path.Combine(Path.GetDirectoryName(exe), "calls.txt"),
            Path.GetFileName(exe) + " " + string.Join(" ", args) + Environment.NewLine);
        Console.WriteLine("1");
        return 0;
    }
}
'@ | Set-Content $shimSource
            $shim = Join-Path $pgBin 'pg_ctl.exe'
            & $compiler /nologo /target:exe "/out:$shim" $shimSource
            if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL contract shim compilation failed' }
            foreach ($name in @('initdb', 'psql', 'createdb')) { Copy-Item $shim (Join-Path $pgBin "$name.exe") }
            foreach ($case in @(
                @{ Name = 'start-bundled-postgres.ps1'; Status = '23' },
                @{ Name = 'start-bundled-postgres.bat'; Status = '23' },
                @{ Name = 'start-bundled-postgres.ps1'; Status = '-23' },
                @{ Name = 'start-bundled-postgres.bat'; Status = '-23' }
            )) {
                $name = $case.Name
                $status = $case.Status
                $env:SCIM_STANDALONE_CONTRACT_EXIT = $status
                $sentinel = Join-Path $fixture 'dist\started'
                $pgCalls = Join-Path $pgBin 'calls.txt'
                Remove-Item $sentinel, $pgCalls -ErrorAction SilentlyContinue
                if ($name.EndsWith('.ps1')) {
                    $output = & pwsh -NoProfile -File (Join-Path $fixture $name) 2>&1
                } else {
                    $output = & $env:ComSpec /d /c "`"$(Join-Path $fixture $name)`"" 2>&1
                }
                $exitCode = $LASTEXITCODE
                Assert-Contract ($exitCode -ne 0) "$name migration failure $status returns nonzero"
                Assert-Contract (($output -join "`n") -match "CONTRACT: migration exit $status") "$name invoked the packaged CLI with the package-rooted config (exit $status)"
                Assert-Contract (-not (Test-Path $sentinel)) "$name migration failure $status never starts the application"
                Assert-Contract ((Get-Content $pgCalls -Raw) -match 'pg_ctl.exe stop') "$name migration failure $status stops the PostgreSQL instance it started"
            }
        } else {
            Write-Host 'SKIP: bundled PostgreSQL process contracts require the Windows .NET Framework C# compiler'
        }
    } finally { Pop-Location }
} finally {
    $env:SCIM_STANDALONE_CONTRACT_EXIT = $originalStatus
    Remove-Item $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count) { throw "$($failures.Count) standalone migration contract assertions failed: $($failures -join '; ')" }
Write-Host 'PASS: standalone migration contracts'
