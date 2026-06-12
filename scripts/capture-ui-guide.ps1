<#
.SYNOPSIS
    Reproducibly re-shoots ONLY the curated UI_GUIDE.md `prod-*` screenshot set.

.DESCRIPTION
    Implements the "UI Guide Refresh Process" rule in .github/copilot-instructions.md.

    This script does NOT do an uncurated full re-shoot. It captures the small,
    stable set of surfaces that docs/UI_GUIDE.md actually references, at a pinned
    viewport, against a live URL, then optimizes the PNGs (when oxipng/pngquant is
    available) and overlays the existing committed `prod-*` keepers.

    Captures land first in the git-ignored test-results/ui-screenshots/ staging
    folder, then only the curated keepers are copied over docs/screenshots/prod-*.
    Stray captures can therefore never leak into a commit (the deny-by-default
    .gitignore allowlist also enforces this structurally).

.PARAMETER BaseUrl
    Live URL to capture against, e.g.
      https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io
      http://localhost:8080
      http://localhost:4000

.PARAMETER Token
    Bearer token (SCIM_SHARED_SECRET) seeded into localStorage to bypass the
    token gate for the authenticated surfaces. Defaults to the dev/docker value.

.PARAMETER ViewportWidth
    Pinned capture width. Default 1440.

.PARAMETER ViewportHeight
    Pinned capture height. Default 900.

.PARAMETER Apply
    When set, copies the freshly captured keepers over docs/screenshots/prod-*.
    Without it the script captures to the staging folder and prints a summary
    only (dry run), so you can review before overwriting committed images.

.EXAMPLE
    pwsh scripts/capture-ui-guide.ps1 -BaseUrl https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io
    # dry run: capture to test-results/ui-screenshots/, print summary

.EXAMPLE
    pwsh scripts/capture-ui-guide.ps1 -BaseUrl http://localhost:8080 -Apply
    # capture + overlay docs/screenshots/prod-* (review the binary diff before commit)

.NOTES
    Re-shoot is intentional, never blind: review the binary diff and state in the
    commit message which surfaces changed and why (visual-regression discipline).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [string]$Token = 'changeme-scim',

    [int]$ViewportWidth = 1440,

    [int]$ViewportHeight = 900,

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot 'web'
$stageDir = Join-Path $repoRoot 'test-results/ui-screenshots/ui-guide'
$keeperDir = Join-Path $repoRoot 'docs/screenshots'
$tokenKey = 'scimserver.authToken'

# Curated surface map: filename -> route. Mirrors the image references in
# docs/UI_GUIDE.md. KEEP IN SYNC with that file. The token dialog is captured
# WITHOUT a seeded token; every other surface is captured authenticated.
$surfaces = @(
    @{ File = 'prod-token-dialog.png';      Route = '/';                 Auth = $false }
    @{ File = 'prod-01-dashboard.png';       Route = '/';                 Auth = $true }
    @{ File = 'prod-02-endpoints.png';       Route = '/endpoints';        Auth = $true }
    @{ File = 'prod-03-discovery.png';       Route = '/discovery';        Auth = $true }
    @{ File = 'prod-04-operations.png';      Route = '/operations';       Auth = $true }
    @{ File = 'prod-05-workbench.png';       Route = '/workbench';        Auth = $true }
    @{ File = 'prod-06-my-profile.png';      Route = '/me';               Auth = $true }
    @{ File = 'prod-07-manual-provision.png'; Route = '/manual-provision'; Auth = $true }
    @{ File = 'prod-08-logs.png';            Route = '/logs';             Auth = $true }
    @{ File = 'prod-09-settings.png';        Route = '/settings';         Auth = $true }
)

Write-Host "=== capture-ui-guide ===" -ForegroundColor Cyan
Write-Host "BaseUrl : $BaseUrl"
Write-Host "Viewport: ${ViewportWidth}x${ViewportHeight}"
Write-Host "Mode    : $(if ($Apply) { 'APPLY (overlay prod-*)' } else { 'DRY RUN (stage only)' })"
Write-Host ("Surfaces: {0}" -f $surfaces.Count)

if (-not (Test-Path (Join-Path $webDir 'node_modules/playwright'))) {
    throw "Playwright not found in web/node_modules. Run 'cd web; npm ci' first."
}

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

# Build the surface list as JSON for the node capture helper.
$surfacesJson = ($surfaces | ForEach-Object {
    [pscustomobject]@{ file = $_.File; route = $_.Route; auth = $_.Auth }
}) | ConvertTo-Json -Compress -Depth 4
if ($surfaces.Count -eq 1) { $surfacesJson = "[$surfacesJson]" }

$captureScript = Join-Path $stageDir '_capture.mjs'
@"
import { chromium } from 'playwright';

const baseUrl = process.env.CAP_BASE_URL;
const token = process.env.CAP_TOKEN;
const tokenKey = process.env.CAP_TOKEN_KEY;
const outDir = process.env.CAP_OUT_DIR;
const vw = parseInt(process.env.CAP_VW, 10);
const vh = parseInt(process.env.CAP_VH, 10);
const surfaces = JSON.parse(process.env.CAP_SURFACES);

const browser = await chromium.launch();
let failed = 0;
for (const s of surfaces) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh } });
  if (s.auth) {
    // Seed the bearer token so the token gate is bypassed for this surface.
    await context.addInitScript(([k, v]) => {
      window.localStorage.setItem(k, v);
    }, [tokenKey, token]);
  }
  const page = await context.newPage();
  try {
    await page.goto(baseUrl + s.route, { waitUntil: 'networkidle', timeout: 30000 });
    // Settle async data / animations before the shot.
    await page.waitForTimeout(1500);
    const path = outDir + '/' + s.file;
    await page.screenshot({ path, fullPage: true });
    console.log('OK   ' + s.file + '  <- ' + s.route + (s.auth ? '' : '  (no token)'));
  } catch (err) {
    failed++;
    console.error('FAIL ' + s.file + '  <- ' + s.route + '  : ' + err.message);
  } finally {
    await context.close();
  }
}
await browser.close();
process.exit(failed > 0 ? 1 : 0);
"@ | Set-Content -Path $captureScript -Encoding UTF8

Write-Host "`n=== capturing ===" -ForegroundColor Cyan
Push-Location $webDir
try {
    $env:CAP_BASE_URL = $BaseUrl.TrimEnd('/')
    $env:CAP_TOKEN = $Token
    $env:CAP_TOKEN_KEY = $tokenKey
    $env:CAP_OUT_DIR = $stageDir
    $env:CAP_VW = "$ViewportWidth"
    $env:CAP_VH = "$ViewportHeight"
    $env:CAP_SURFACES = $surfacesJson
    node $captureScript
    $captureExit = $LASTEXITCODE
}
finally {
    Pop-Location
    Remove-Item Env:CAP_BASE_URL, Env:CAP_TOKEN, Env:CAP_TOKEN_KEY, Env:CAP_OUT_DIR, Env:CAP_VW, Env:CAP_VH, Env:CAP_SURFACES -ErrorAction SilentlyContinue
}

if ($captureExit -ne 0) {
    Write-Warning "One or more surfaces failed to capture. Review output above before applying."
}

# Optimize the staged PNGs in place when tooling is available (hygiene Rule 5).
$oxipng = Get-Command oxipng -ErrorAction SilentlyContinue
$pngquant = Get-Command pngquant -ErrorAction SilentlyContinue
if ($oxipng) {
    Write-Host "`n=== optimizing (oxipng) ===" -ForegroundColor Cyan
    Get-ChildItem $stageDir -Filter 'prod-*.png' | ForEach-Object { & oxipng -o 4 --strip safe $_.FullName 2>&1 | Out-Null }
}
elseif ($pngquant) {
    Write-Host "`n=== optimizing (pngquant) ===" -ForegroundColor Cyan
    Get-ChildItem $stageDir -Filter 'prod-*.png' | ForEach-Object { & pngquant --force --ext .png --skip-if-larger $_.FullName 2>&1 | Out-Null }
}
else {
    Write-Warning "Neither oxipng nor pngquant found; skipping optimization (hygiene Rule 5)."
}

Write-Host "`n=== staged captures ===" -ForegroundColor Cyan
Get-ChildItem $stageDir -Filter 'prod-*.png' | ForEach-Object {
    "{0,-32} {1,8:N1} KB" -f $_.Name, ($_.Length / 1KB)
}

if (-not $Apply) {
    Write-Host "`nDRY RUN complete. Review staged images under:" -ForegroundColor Yellow
    Write-Host "  $stageDir"
    Write-Host "Re-run with -Apply to overlay docs/screenshots/prod-*." -ForegroundColor Yellow
    return
}

Write-Host "`n=== applying: overlay docs/screenshots/prod-* ===" -ForegroundColor Cyan
foreach ($s in $surfaces) {
    $src = Join-Path $stageDir $s.File
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $keeperDir $s.File) -Force
        Write-Host "copied $($s.File)"
    }
    else {
        Write-Warning "missing staged capture: $($s.File) (keeper left unchanged)"
    }
}

Write-Host "`n=== git diff summary (review binary diff before committing) ===" -ForegroundColor Cyan
Push-Location $repoRoot
try { git status --short docs/screenshots | Out-String | Write-Host } finally { Pop-Location }
Write-Host "Re-shoot is intentional, never blind: state which surfaces changed and why in the commit message." -ForegroundColor Yellow
