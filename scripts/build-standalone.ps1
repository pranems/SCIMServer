<#
.SYNOPSIS
    Builds a self-contained SCIMServer package that runs without Docker.
    
.DESCRIPTION
    Creates a standalone folder containing everything needed to run
    SCIMServer on any Windows machine:
      - Compiled API (dist/)
      - Production node_modules
      - Web UI (public/)
      - Prisma schema + migrations
      - Launcher scripts (start.bat, start.ps1)
    
    All configuration (port, secrets, DB) is set at *runtime* via the
    launcher scripts or environment variables - nothing is hardcoded into
    the build.

    Optionally bundles a portable Node.js binary so the target machine
    doesn't even need Node.js installed (-IncludeNode). The Node.js
    version is auto-detected from your local install or can be overridden.

.PARAMETER OutputDir
    Output directory name (default: standalone)

.PARAMETER IncludeNode
    Download and include a portable Node.js binary in the package.
    Auto-detects the currently installed Node.js version unless
    -NodeVersion is explicitly specified.

.PARAMETER NodeVersion
    Node.js version to bundle when -IncludeNode is set.
    If omitted, auto-detects from the currently running node (e.g. "24.0.0").

.PARAMETER IncludePostgres
    Download and include portable PostgreSQL binaries in the package.
    Auto-detects the latest PostgreSQL 17 version unless -PostgresVersion
    is explicitly specified. Generates launcher scripts that initialize
    and start PostgreSQL automatically.

.PARAMETER PostgresVersion
    PostgreSQL version to bundle when -IncludePostgres is set (default: 17.4-1).
    Must match an EDB binary distribution version.

.PARAMETER Port
    Default port for the launcher scripts (default: 8080).
    Users can always override at runtime via -Port or the PORT env var.

.PARAMETER Zip
    Create a .zip archive of the standalone folder

.EXAMPLE
    .\build-standalone.ps1
    .\build-standalone.ps1 -IncludeNode -Zip
    .\build-standalone.ps1 -Port 6000 -IncludeNode -Zip
    .\build-standalone.ps1 -IncludeNode -NodeVersion "22.12.0" -Zip
    .\build-standalone.ps1 -IncludeNode -IncludePostgres -Zip
#>
param(
    [string]$OutputDir = "standalone",
    [switch]$IncludeNode,
    [string]$NodeVersion,
    [switch]$IncludePostgres,
    [string]$PostgresVersion = "17.4-1",
    [int]$Port = 8080,
    [switch]$Zip
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $RepoRoot "api"
$WebDir = Join-Path $RepoRoot "web"
$OutPath = Join-Path $RepoRoot $OutputDir

# ── Auto-detect values from project metadata ──
$pkgJsonPath = Join-Path $ApiDir "package.json"
$pkgJson = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
$ProjectVersion = $pkgJson.version
$ProjectName = $pkgJson.name

# Auto-detect Node.js version if -IncludeNode is set and no explicit version given
if ($IncludeNode -and -not $NodeVersion) {
    try {
        $nodeOutput = & node --version 2>$null
        $NodeVersion = $nodeOutput -replace '^v', ''
        Write-Host "Auto-detected Node.js version: v$NodeVersion" -ForegroundColor Gray
    } catch {
        throw "Cannot auto-detect Node.js version (node not found). Specify -NodeVersion explicitly."
    }
}

# Read minimum Node.js version from engines field for README
$MinNodeVersion = "18"
if ($pkgJson.engines -and $pkgJson.engines.node) {
    $engMatch = [regex]::Match($pkgJson.engines.node, '(\d+)')
    if ($engMatch.Success) { $MinNodeVersion = $engMatch.Groups[1].Value }
}

Write-Host "`n=== SCIMServer Standalone Builder ===" -ForegroundColor Cyan
Write-Host "Project:  $ProjectName v$ProjectVersion" -ForegroundColor Gray
Write-Host "Output:   $OutPath" -ForegroundColor Gray
Write-Host "Port:     $Port (configurable at runtime)" -ForegroundColor Gray
if ($IncludeNode) {
    Write-Host "Node.js:  v$NodeVersion (will be bundled)" -ForegroundColor Gray
}
if ($IncludePostgres) {
    Write-Host "Postgres: v$PostgresVersion (will be bundled)" -ForegroundColor Gray
}
Write-Host ""

# ── Step 1: Clean previous output ──
if (Test-Path $OutPath) {
    Write-Host "[1/7] Cleaning previous build..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $OutPath
}
New-Item -ItemType Directory -Path $OutPath -Force | Out-Null

# ── Step 2: Install API dependencies ──
Write-Host "[2/7] Installing API dependencies..." -ForegroundColor Yellow
Push-Location $ApiDir
try {
    # Try npm ci first; fall back to npm install if file locks prevent clean install
    npm ci --no-audit --no-fund 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "       npm ci failed (file lock?), retrying with npm install..." -ForegroundColor Yellow
        npm install --no-audit --no-fund 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }
} finally { Pop-Location }

# ── Step 3: Generate Prisma client & build TypeScript ──
Write-Host "[3/7] Generating Prisma client & compiling TypeScript..." -ForegroundColor Yellow
Push-Location $ApiDir
try {
    npx prisma generate 2>&1 | Out-Null
    npx tsc -p tsconfig.build.json 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "TypeScript compilation failed" }
} finally { Pop-Location }

# ── Step 4: Build web frontend (if present) ──
$WebDistDir = Join-Path $WebDir "dist"
if (Test-Path (Join-Path $WebDir "package.json")) {
    Write-Host "[4/7] Building web frontend..." -ForegroundColor Yellow
    Push-Location $WebDir
    try {
        npm ci --no-audit --no-fund 2>&1 | Out-Null
        npm run build 2>&1 | Out-Null
    } finally { Pop-Location }
} else {
    Write-Host "[4/7] Skipping web build (no web/ folder)" -ForegroundColor DarkGray
}

# ── Step 5: Assemble standalone folder ──
Write-Host "[5/7] Assembling standalone package..." -ForegroundColor Yellow

# Copy compiled JS
Copy-Item -Recurse (Join-Path $ApiDir "dist") (Join-Path $OutPath "dist")

# Copy production node_modules
Write-Host "       Installing production-only node_modules..." -ForegroundColor Gray
Copy-Item (Join-Path $ApiDir "package.json") (Join-Path $OutPath "package.json")
Copy-Item (Join-Path $ApiDir "package-lock.json") (Join-Path $OutPath "package-lock.json") -ErrorAction SilentlyContinue
Push-Location $OutPath
try {
    npm ci --omit=dev --no-audit --no-fund 2>&1 | Out-Null
    
    # Graft prisma CLI + engines from full install (needed for migrate deploy)
    $srcPrisma = Join-Path $ApiDir "node_modules" "prisma"
    $srcEngines = Join-Path $ApiDir "node_modules" "@prisma" "engines"
    $srcEngVer = Join-Path $ApiDir "node_modules" "@prisma" "engines-version"
    $dstModules = Join-Path $OutPath "node_modules"
    
    if (Test-Path $srcPrisma) {
        Copy-Item -Recurse -Force $srcPrisma (Join-Path $dstModules "prisma")
    }
    if (Test-Path $srcEngines) {
        New-Item -ItemType Directory -Path (Join-Path $dstModules "@prisma") -Force | Out-Null
        Copy-Item -Recurse -Force $srcEngines (Join-Path $dstModules "@prisma" "engines")
    }
    if (Test-Path $srcEngVer) {
        Copy-Item -Recurse -Force $srcEngVer (Join-Path $dstModules "@prisma" "engines-version")
    }
} finally { Pop-Location }

# Copy Prisma schema + migrations (needed if using PostgreSQL mode)
$prismaDir = Join-Path $ApiDir "prisma"
if (Test-Path $prismaDir) {
    Copy-Item -Recurse $prismaDir (Join-Path $OutPath "prisma")
}

# Copy generated Prisma client
$generatedDir = Join-Path $ApiDir "src" "generated"
if (Test-Path $generatedDir) {
    $distGenerated = Join-Path $OutPath "dist" "generated"
    if (-not (Test-Path $distGenerated)) {
        # Prisma generated client may be referenced from dist
        New-Item -ItemType Directory -Path (Join-Path $OutPath "src") -Force | Out-Null
        Copy-Item -Recurse $generatedDir (Join-Path $OutPath "src" "generated")
    }
}

# Copy web frontend
if (Test-Path $WebDistDir) {
    Copy-Item -Recurse $WebDistDir (Join-Path $OutPath "public")
} elseif (Test-Path (Join-Path $ApiDir "public")) {
    Copy-Item -Recurse (Join-Path $ApiDir "public") (Join-Path $OutPath "public")
}

# ── Step 6: Create launcher scripts ──
Write-Host "[6/7] Creating launcher scripts..." -ForegroundColor Yellow

# --- start.bat (Command Prompt) ---
@"
@echo off
REM ============================================
REM  SCIMServer v$ProjectVersion - Standalone Launcher
REM  All settings come from environment variables.
REM  Set them before running, or accept the defaults.
REM ============================================

REM --- Configurable settings (override via env vars) ---
if "%PORT%"==""                 set PORT=$Port
if "%PERSISTENCE_BACKEND%"=="" set PERSISTENCE_BACKEND=inmemory
if "%JWT_SECRET%"==""          set JWT_SECRET=changeme-jwt
if "%SCIM_SHARED_SECRET%"==""  set SCIM_SHARED_SECRET=changeme
if "%OAUTH_CLIENT_SECRET%"=="" set OAUTH_CLIENT_SECRET=changeme-oauth
if "%NODE_ENV%"==""            set NODE_ENV=production

echo.
echo  SCIMServer v$ProjectVersion
echo  Port: %PORT%  Mode: %PERSISTENCE_BACKEND%
echo  Press Ctrl+C to stop.
echo.

REM Use bundled Node.js if present, otherwise system Node.js
if exist "%~dp0node\node.exe" (
    "%~dp0node\node.exe" "%~dp0dist\main.js"
) else (
    node "%~dp0dist\main.js"
)
"@ | Set-Content -Path (Join-Path $OutPath "start.bat") -Encoding ASCII

# --- start.ps1 (PowerShell - full-featured launcher) ---
@"
<#
.SYNOPSIS
    Start SCIMServer v$ProjectVersion in standalone mode.
.DESCRIPTION
    All configuration is via parameters or environment variables.
    Nothing is hardcoded - set secrets via env vars before deploying to production.
.PARAMETER Port
    Port to listen on (default: $Port, or `$env:PORT)
.PARAMETER Backend
    Persistence backend: 'inmemory' or 'prisma' (default: inmemory)
.PARAMETER DatabaseUrl
    PostgreSQL connection string. Implies -Backend prisma.
.PARAMETER SharedSecret
    SCIM bearer token secret (default: `$env:SCIM_SHARED_SECRET or 'changeme')
.PARAMETER JwtSecret
    JWT signing secret (default: `$env:JWT_SECRET or 'changeme-jwt')
.PARAMETER RunMigrations
    Run Prisma migrations before starting (only for prisma backend)
#>
param(
    [int]`$Port = (`$env:PORT -as [int]) -bor $Port,
    [ValidateSet('inmemory','prisma')]
    [string]`$Backend = (`$env:PERSISTENCE_BACKEND, 'inmemory' | Where-Object { `$_ } | Select-Object -First 1),
    [string]`$DatabaseUrl = `$env:DATABASE_URL,
    [string]`$SharedSecret = (`$env:SCIM_SHARED_SECRET, 'changeme' | Where-Object { `$_ } | Select-Object -First 1),
    [string]`$JwtSecret = (`$env:JWT_SECRET, 'changeme-jwt' | Where-Object { `$_ } | Select-Object -First 1),
    [switch]`$RunMigrations
)

`$env:PORT = `$Port
`$env:JWT_SECRET = `$JwtSecret
`$env:SCIM_SHARED_SECRET = `$SharedSecret
`$env:OAUTH_CLIENT_SECRET = (`$env:OAUTH_CLIENT_SECRET, `$SharedSecret | Where-Object { `$_ } | Select-Object -First 1)
`$env:NODE_ENV = (`$env:NODE_ENV, 'production' | Where-Object { `$_ } | Select-Object -First 1)

if (`$DatabaseUrl) {
    `$Backend = "prisma"
    `$env:DATABASE_URL = `$DatabaseUrl
}
`$env:PERSISTENCE_BACKEND = `$Backend

# Resolve Node.js executable (bundled or system)
`$nodeExe = Join-Path `$PSScriptRoot "node" "node.exe"
if (-not (Test-Path `$nodeExe)) { `$nodeExe = "node" }

# Run migrations if requested (prisma backend)
if (`$RunMigrations -and `$Backend -eq "prisma") {
    Write-Host "Running Prisma migrations..." -ForegroundColor Yellow
    `$schemaPath = Join-Path `$PSScriptRoot "prisma" "schema.prisma"
    & `$nodeExe (Join-Path `$PSScriptRoot "node_modules" "prisma" "build" "index.js") migrate deploy --schema `$schemaPath
}

Write-Host ""
Write-Host "SCIMServer v$ProjectVersion" -ForegroundColor Cyan
Write-Host "  Port:    `$Port" -ForegroundColor White
Write-Host "  Mode:    `$Backend" -ForegroundColor White
if (`$Backend -eq "prisma") {
    Write-Host "  DB:      (set via DATABASE_URL)" -ForegroundColor White
}
Write-Host "  Press Ctrl+C to stop.`n" -ForegroundColor Gray

& `$nodeExe (Join-Path `$PSScriptRoot "dist" "main.js")
"@ | Set-Content -Path (Join-Path $OutPath "start.ps1") -Encoding UTF8

# --- start-postgres.bat (with DB) ---
@"
@echo off
REM ============================================
REM  SCIMServer v$ProjectVersion - PostgreSQL Mode
REM  Edit the settings below to match your DB.
REM ============================================

REM --- REQUIRED: Set your database connection string ---
if "%DATABASE_URL%"==""        set DATABASE_URL=postgresql://scim:scim@localhost:5432/scimdb

REM --- Configurable settings (override via env vars) ---
if "%PORT%"==""                 set PORT=$Port
if "%JWT_SECRET%"==""          set JWT_SECRET=changeme-jwt
if "%SCIM_SHARED_SECRET%"==""  set SCIM_SHARED_SECRET=changeme
if "%OAUTH_CLIENT_SECRET%"=="" set OAUTH_CLIENT_SECRET=changeme-oauth

set PERSISTENCE_BACKEND=prisma
set NODE_ENV=production

echo.
echo  Running Prisma migrations...
if exist "%~dp0node\node.exe" (
    "%~dp0node\node.exe" "%~dp0node_modules\prisma\build\index.js" migrate deploy --schema "%~dp0prisma\schema.prisma"
) else (
    npx prisma migrate deploy --schema "%~dp0prisma\schema.prisma"
)

echo.
echo  Starting SCIMServer on port %PORT% (PostgreSQL mode)...
echo  Press Ctrl+C to stop.
echo.

if exist "%~dp0node\node.exe" (
    "%~dp0node\node.exe" "%~dp0dist\main.js"
) else (
    node "%~dp0dist\main.js"
)
"@ | Set-Content -Path (Join-Path $OutPath "start-postgres.bat") -Encoding ASCII

# --- README ---
@"
# SCIMServer v$ProjectVersion - Standalone Package

## Quick Start (In-Memory - No Database)

Double-click **start.bat** or run:

    start.bat

The SCIM server will listen on **http://localhost:$Port**

## PowerShell (more options)

    .\start.ps1                                        # in-memory, port $Port
    .\start.ps1 -Port 6000                             # different port
    .\start.ps1 -SharedSecret "my-token"               # custom bearer token
    .\start.ps1 -DatabaseUrl "postgresql://..." -RunMigrations  # PostgreSQL mode

## Environment Variables

All settings can be configured via environment variables *before* running:

| Variable              | Default         | Description                        |
|-----------------------|-----------------|------------------------------------|
| ``PORT``              | $Port           | HTTP listen port                   |
| ``PERSISTENCE_BACKEND`` | inmemory      | ``inmemory`` or ``prisma``         |
| ``DATABASE_URL``      | *(none)*        | PostgreSQL connection string       |
| ``SCIM_SHARED_SECRET``| changeme        | Bearer token for SCIM endpoints    |
| ``JWT_SECRET``        | changeme-jwt    | JWT signing key                    |
| ``OAUTH_CLIENT_SECRET``| changeme-oauth | OAuth client secret                |
| ``NODE_ENV``          | production      | Node environment                   |

## PostgreSQL Mode

    set DATABASE_URL=postgresql://user:pass@host:5432/dbname
    start-postgres.bat
$( if ($IncludePostgres) { @"

## Bundled PostgreSQL (Fully Airgapped)

Double-click **start-bundled-postgres.bat** - it will:
1. Initialize a local PostgreSQL instance (first run only)
2. Start PostgreSQL on port 5432
3. Create the ``scimdb`` database
4. Run Prisma migrations
5. Start SCIMServer on port $Port

PowerShell version with options:

    .\start-bundled-postgres.ps1                       # defaults
    .\start-bundled-postgres.ps1 -Port 6000            # custom SCIM port
    .\start-bundled-postgres.ps1 -PgPort 5433          # custom PG port

To stop PostgreSQL separately: ``stop-postgres.bat``
"@ } )

## Requirements

- **Node.js $MinNodeVersion+** (v$( if ($NodeVersion) { $NodeVersion } else { "24" } ) recommended) - unless this package includes a bundled node.exe
- No internet access required
- No Docker required

## What's Included

    dist/              Compiled server code
    node_modules/      Production dependencies (pre-installed)
    public/            Web admin UI
    prisma/            Database schema & migrations (for PostgreSQL mode)
    start.bat          One-click launcher (in-memory mode)
    start.ps1          PowerShell launcher (configurable)
    start-postgres.bat PostgreSQL launcher$( if ($IncludeNode) { "`n    node/              Bundled Node.js v$NodeVersion" } )$( if ($IncludePostgres) { "`n    pgsql/             Bundled PostgreSQL v$PostgresVersion`n    pgdata/            PostgreSQL data directory (auto-initialized)`n    start-bundled-postgres.bat   One-click PostgreSQL + SCIMServer`n    start-bundled-postgres.ps1   PowerShell PostgreSQL + SCIMServer`n    stop-postgres.bat            Stop bundled PostgreSQL" } )
"@ | Set-Content -Path (Join-Path $OutPath "README.md") -Encoding UTF8

# ── Step 6b: Optionally download portable Node.js ──
if ($IncludeNode) {
    Write-Host "[6b]   Downloading portable Node.js v$NodeVersion..." -ForegroundColor Yellow
    $nodeDir = Join-Path $OutPath "node"
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeZipUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-$arch.zip"
    $nodeZipPath = Join-Path $env:TEMP "node-portable.zip"
    
    try {
        Invoke-WebRequest -Uri $nodeZipUrl -OutFile $nodeZipPath -UseBasicParsing
        Expand-Archive -Path $nodeZipPath -DestinationPath $env:TEMP -Force
        $extractedDir = Join-Path $env:TEMP "node-v$NodeVersion-win-$arch"
        Copy-Item -Path (Join-Path $extractedDir "node.exe") -Destination $nodeDir
        Remove-Item -Force $nodeZipPath -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $extractedDir -ErrorAction SilentlyContinue
        Write-Host "       Portable Node.js included at node/node.exe" -ForegroundColor Green
    } catch {
        Write-Warning "Could not download Node.js: $_"
        Write-Warning "The standalone package will require Node.js to be installed on the target machine."
    }
}

# ── Step 6c: Optionally download portable PostgreSQL ──
if ($IncludePostgres) {
    Write-Host "[6c]   Downloading portable PostgreSQL v$PostgresVersion..." -ForegroundColor Yellow
    $pgDir = Join-Path $OutPath "pgsql"
    $pgDataDir = Join-Path $OutPath "pgdata"
    New-Item -ItemType Directory -Path $pgDir -Force | Out-Null
    New-Item -ItemType Directory -Path $pgDataDir -Force | Out-Null
    
    # EDB provides ZIP binaries for Windows
    $pgZipUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PostgresVersion-windows-x64-binaries.zip"
    $pgZipPath = Join-Path $env:TEMP "postgresql-portable.zip"
    
    try {
        Write-Host "       Downloading from $pgZipUrl" -ForegroundColor Gray
        Invoke-WebRequest -Uri $pgZipUrl -OutFile $pgZipPath -UseBasicParsing
        Write-Host "       Extracting PostgreSQL binaries..." -ForegroundColor Gray
        Expand-Archive -Path $pgZipPath -DestinationPath $OutPath -Force
        Remove-Item -Force $pgZipPath -ErrorAction SilentlyContinue
        Write-Host "       Portable PostgreSQL included at pgsql/" -ForegroundColor Green
    } catch {
        Write-Warning "Could not download PostgreSQL: `$_"
        Write-Warning "You can manually download the ZIP binaries from https://www.enterprisedb.com/download-postgresql-binaries"
        Write-Warning "Extract to $pgDir and the bundled launcher scripts will work."
        $IncludePostgres = $false
    }

    if ($IncludePostgres) {
        # --- start-bundled-postgres.bat ---
        @"
@echo off
REM ============================================
REM  SCIMServer v$ProjectVersion - Bundled PostgreSQL
REM  Initializes and starts a local PostgreSQL,
REM  then launches SCIMServer connected to it.
REM ============================================

set PGDIR=%~dp0pgsql
set PGDATA=%~dp0pgdata
set PGPORT=5432
set PGUSER=scim
set PGDATABASE=scimdb

REM --- Configurable settings (override via env vars) ---
if "%PORT%"==""                 set PORT=$Port
if "%JWT_SECRET%"==""          set JWT_SECRET=changeme-jwt
if "%SCIM_SHARED_SECRET%"==""  set SCIM_SHARED_SECRET=changeme
if "%OAUTH_CLIENT_SECRET%"=="" set OAUTH_CLIENT_SECRET=changeme-oauth

set PERSISTENCE_BACKEND=prisma
set DATABASE_URL=postgresql://%PGUSER%@localhost:%PGPORT%/%PGDATABASE%
set NODE_ENV=production

REM --- Initialize PostgreSQL data directory if empty ---
if not exist "%PGDATA%\PG_VERSION" (
    echo.
    echo  Initializing PostgreSQL data directory...
    "%PGDIR%\bin\initdb.exe" -D "%PGDATA%" -U %PGUSER% -E UTF8 --no-locale -A trust
    if errorlevel 1 (
        echo  ERROR: PostgreSQL initialization failed.
        pause
        exit /b 1
    )
    echo  PostgreSQL initialized.
)

REM --- Start PostgreSQL ---
echo.
echo  Starting PostgreSQL on port %PGPORT%...
"%PGDIR%\bin\pg_ctl.exe" start -D "%PGDATA%" -l "%~dp0pgdata\postgresql.log" -w -o "-p %PGPORT%"
if errorlevel 1 (
    echo  ERROR: PostgreSQL failed to start. Check pgdata\postgresql.log
    pause
    exit /b 1
)

REM --- Create database if it doesn't exist ---
"%PGDIR%\bin\psql.exe" -U %PGUSER% -p %PGPORT% -tc "SELECT 1 FROM pg_database WHERE datname='%PGDATABASE%'" postgres | findstr /C:"1" >nul 2>&1
if errorlevel 1 (
    echo  Creating database '%PGDATABASE%'...
    "%PGDIR%\bin\createdb.exe" -U %PGUSER% -p %PGPORT% %PGDATABASE%
)

REM --- Run Prisma migrations ---
echo.
echo  Running database migrations...
if exist "%~dp0node\node.exe" (
    "%~dp0node\node.exe" "%~dp0node_modules\prisma\build\index.js" migrate deploy --schema "%~dp0prisma\schema.prisma"
) else (
    npx prisma migrate deploy --schema "%~dp0prisma\schema.prisma"
)

REM --- Start SCIMServer ---
echo.
echo  SCIMServer v$ProjectVersion
echo  Port: %PORT%  Mode: PostgreSQL ^(bundled^)
echo  DB:   %DATABASE_URL%
echo  Press Ctrl+C to stop.
echo.

if exist "%~dp0node\node.exe" (
    "%~dp0node\node.exe" "%~dp0dist\main.js"
) else (
    node "%~dp0dist\main.js"
)

REM --- Stop PostgreSQL on exit ---
echo.
echo  Stopping PostgreSQL...
"%PGDIR%\bin\pg_ctl.exe" stop -D "%PGDATA%" -m fast
"@ | Set-Content -Path (Join-Path $OutPath "start-bundled-postgres.bat") -Encoding ASCII

        # --- stop-postgres.bat ---
        @"
@echo off
REM Stops the bundled PostgreSQL instance
set PGDIR=%~dp0pgsql
set PGDATA=%~dp0pgdata
if exist "%PGDATA%\postmaster.pid" (
    echo Stopping PostgreSQL...
    "%PGDIR%\bin\pg_ctl.exe" stop -D "%PGDATA%" -m fast
    echo PostgreSQL stopped.
) else (
    echo PostgreSQL is not running.
)
"@ | Set-Content -Path (Join-Path $OutPath "stop-postgres.bat") -Encoding ASCII

        # --- start-bundled-postgres.ps1 ---
        @"
<#
.SYNOPSIS
    Start SCIMServer v$ProjectVersion with bundled PostgreSQL.
.DESCRIPTION
    Initializes a local PostgreSQL instance (if needed), starts it,
    runs migrations, and launches SCIMServer - all from bundled binaries.
    No internet, no Docker, no external database required.
.PARAMETER Port
    SCIMServer port (default: $Port)
.PARAMETER PgPort
    PostgreSQL port (default: 5432)
.PARAMETER SharedSecret
    SCIM bearer token secret (default: changeme)
#>
param(
    [int]`$Port = (`$env:PORT -as [int]) -bor $Port,
    [int]`$PgPort = 5432,
    [string]`$SharedSecret = (`$env:SCIM_SHARED_SECRET, 'changeme' | Where-Object { `$_ } | Select-Object -First 1)
)

`$pgDir = Join-Path `$PSScriptRoot "pgsql"
`$pgData = Join-Path `$PSScriptRoot "pgdata"
`$pgUser = "scim"
`$pgDb = "scimdb"

# Resolve Node.js executable
`$nodeExe = Join-Path `$PSScriptRoot "node" "node.exe"
if (-not (Test-Path `$nodeExe)) { `$nodeExe = "node" }

# Resolve PostgreSQL binaries
`$initdb  = Join-Path `$pgDir "bin" "initdb.exe"
`$pg_ctl  = Join-Path `$pgDir "bin" "pg_ctl.exe"
`$psqlExe = Join-Path `$pgDir "bin" "psql.exe"
`$createdb = Join-Path `$pgDir "bin" "createdb.exe"

if (-not (Test-Path `$initdb)) {
    Write-Host "ERROR: Bundled PostgreSQL not found at `$pgDir" -ForegroundColor Red
    Write-Host "Re-run build-standalone.ps1 with -IncludePostgres" -ForegroundColor Yellow
    exit 1
}

# Initialize data directory if needed
if (-not (Test-Path (Join-Path `$pgData "PG_VERSION"))) {
    Write-Host "Initializing PostgreSQL data directory..." -ForegroundColor Yellow
    & `$initdb -D `$pgData -U `$pgUser -E UTF8 --no-locale -A trust
    if (`$LASTEXITCODE -ne 0) { throw "initdb failed" }
}

# Start PostgreSQL
Write-Host "Starting PostgreSQL on port `$PgPort..." -ForegroundColor Yellow
`$pgLog = Join-Path `$pgData "postgresql.log"
& `$pg_ctl start -D `$pgData -l `$pgLog -w -o "-p `$PgPort"
if (`$LASTEXITCODE -ne 0) {
    Write-Host "PostgreSQL failed to start. Check `$pgLog" -ForegroundColor Red
    exit 1
}

# Ensure cleanup on exit
`$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    `$pg_ctl = Join-Path `$PSScriptRoot "pgsql" "bin" "pg_ctl.exe"
    `$pgData = Join-Path `$PSScriptRoot "pgdata"
    if (Test-Path `$pg_ctl) { & `$pg_ctl stop -D `$pgData -m fast 2>`$null }
}

try {
    # Create database if needed
    `$dbExists = & `$psqlExe -U `$pgUser -p `$PgPort -tc "SELECT 1 FROM pg_database WHERE datname='`$pgDb'" postgres 2>`$null
    if (`$dbExists -notmatch '1') {
        Write-Host "Creating database '`$pgDb'..." -ForegroundColor Yellow
        & `$createdb -U `$pgUser -p `$PgPort `$pgDb
    }

    # Set environment
    `$env:PORT = `$Port
    `$env:PERSISTENCE_BACKEND = "prisma"
    `$env:DATABASE_URL = "postgresql://`${pgUser}@localhost:`${PgPort}/`${pgDb}"
    `$env:JWT_SECRET = (`$env:JWT_SECRET, 'changeme-jwt' | Where-Object { `$_ } | Select-Object -First 1)
    `$env:SCIM_SHARED_SECRET = `$SharedSecret
    `$env:OAUTH_CLIENT_SECRET = (`$env:OAUTH_CLIENT_SECRET, `$SharedSecret | Where-Object { `$_ } | Select-Object -First 1)
    `$env:NODE_ENV = "production"

    # Run migrations
    Write-Host "Running database migrations..." -ForegroundColor Yellow
    `$schemaPath = Join-Path `$PSScriptRoot "prisma" "schema.prisma"
    & `$nodeExe (Join-Path `$PSScriptRoot "node_modules" "prisma" "build" "index.js") migrate deploy --schema `$schemaPath

    Write-Host ""
    Write-Host "SCIMServer v$ProjectVersion" -ForegroundColor Cyan
    Write-Host "  Port:     `$Port" -ForegroundColor White
    Write-Host "  Mode:     PostgreSQL (bundled)" -ForegroundColor White
    Write-Host "  DB:       `$(`$env:DATABASE_URL)" -ForegroundColor White
    Write-Host "  PG Log:   `$pgLog" -ForegroundColor White
    Write-Host "  Press Ctrl+C to stop.`n" -ForegroundColor Gray

    & `$nodeExe (Join-Path `$PSScriptRoot "dist" "main.js")
} finally {
    Write-Host "`nStopping PostgreSQL..." -ForegroundColor Yellow
    & `$pg_ctl stop -D `$pgData -m fast 2>`$null
    Write-Host "PostgreSQL stopped." -ForegroundColor Green
}
"@ | Set-Content -Path (Join-Path $OutPath "start-bundled-postgres.ps1") -Encoding UTF8
    }
}

# ── Step 7: Optionally create zip ──
if ($Zip) {
    Write-Host "[7/7] Creating ZIP archive..." -ForegroundColor Yellow
    $zipPath = Join-Path $RepoRoot "SCIMServer-standalone.zip"
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    # Use .NET ZipFile instead of Compress-Archive to handle long paths in node_modules
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($OutPath, $zipPath)
    $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "       Created: $zipPath ($sizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "[7/7] Skipping ZIP (use -Zip to create archive)" -ForegroundColor DarkGray
}

# ── Done ──
$folderSizeMB = [math]::Round(((Get-ChildItem -Recurse $OutPath | Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Host "`n=== Build Complete - SCIMServer v$ProjectVersion ===" -ForegroundColor Green
Write-Host "Standalone package: $OutPath ($folderSizeMB MB)" -ForegroundColor White
if ($IncludeNode) {
    Write-Host "Bundled Node.js:   v$NodeVersion" -ForegroundColor White
}
if ($IncludePostgres) {
    Write-Host "Bundled Postgres:  v$PostgresVersion" -ForegroundColor White
}
Write-Host ""
Write-Host "To run:" -ForegroundColor White
Write-Host "  cd $OutputDir" -ForegroundColor Gray
Write-Host "  start.bat                              # in-memory on port $Port" -ForegroundColor Gray
Write-Host "  .\start.ps1 -Port 6000                 # custom port" -ForegroundColor Gray
Write-Host "  .\start.ps1 -SharedSecret `"my-token`"   # custom bearer token" -ForegroundColor Gray
if ($IncludePostgres) {
    Write-Host "  start-bundled-postgres.bat              # PostgreSQL + SCIMServer" -ForegroundColor Gray
}
Write-Host ""
