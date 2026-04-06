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
    launcher scripts or environment variables — nothing is hardcoded into
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
#>
param(
    [string]$OutputDir = "standalone",
    [switch]$IncludeNode,
    [string]$NodeVersion,
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
    npm ci --no-audit --no-fund 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
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
REM  SCIMServer v$ProjectVersion — Standalone Launcher
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

# --- start.ps1 (PowerShell — full-featured launcher) ---
@"
<#
.SYNOPSIS
    Start SCIMServer v$ProjectVersion in standalone mode.
.DESCRIPTION
    All configuration is via parameters or environment variables.
    Nothing is hardcoded — set secrets via env vars before deploying to production.
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
REM  SCIMServer v$ProjectVersion — PostgreSQL Mode
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
# SCIMServer v$ProjectVersion — Standalone Package

## Quick Start (In-Memory — No Database)

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

## Requirements

- **Node.js $MinNodeVersion+** (v$( if ($NodeVersion) { $NodeVersion } else { "24" } ) recommended) — unless this package includes a bundled node.exe
- No internet access required
- No Docker required

## What's Included

    dist/              Compiled server code
    node_modules/      Production dependencies (pre-installed)
    public/            Web admin UI
    prisma/            Database schema & migrations (for PostgreSQL mode)
    start.bat          One-click launcher (in-memory mode)
    start.ps1          PowerShell launcher (configurable)
    start-postgres.bat PostgreSQL launcher$( if ($IncludeNode) { "`n    node/              Bundled Node.js v$NodeVersion" } )
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
Write-Host "`n=== Build Complete — SCIMServer v$ProjectVersion ===" -ForegroundColor Green
Write-Host "Standalone package: $OutPath ($folderSizeMB MB)" -ForegroundColor White
if ($IncludeNode) {
    Write-Host "Bundled Node.js:   v$NodeVersion" -ForegroundColor White
}
Write-Host ""
Write-Host "To run:" -ForegroundColor White
Write-Host "  cd $OutputDir" -ForegroundColor Gray
Write-Host "  start.bat                              # in-memory on port $Port" -ForegroundColor Gray
Write-Host "  .\start.ps1 -Port 6000                 # custom port" -ForegroundColor Gray
Write-Host "  .\start.ps1 -SharedSecret `"my-token`"   # custom bearer token" -ForegroundColor Gray
Write-Host ""
