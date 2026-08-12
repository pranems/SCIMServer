<#
.SYNOPSIS
    Reproducibly re-shoots the curated AUTHENTICATION_GUIDE.md `prod-auth-*` screenshot set.

.DESCRIPTION
    Sibling of scripts/capture-ui-guide.ps1, but for the authentication and
    auth-diagnostics surfaces, which are NOT reachable by URL alone: most of
    them require driving the UI (selecting a method sub-tab, opening a log
    detail drawer, pasting an assertion into the debugger). So each surface
    carries a small action script instead of just a route.

    Captures land in the git-ignored test-results/ui-screenshots/auth-guide
    staging folder. Only with -Apply are the curated keepers copied over
    docs/screenshots/prod-auth-*.

.PARAMETER BaseUrl
    Live URL to capture against.

.PARAMETER EndpointId
    The endpoint to capture. Must have ALL auth methods configured for the full
    set to render - the dev endpoint PRTest-Auth-Methods-ISV-1 is the reference.

.PARAMETER Token
    Bearer token seeded into localStorage.

.PARAMETER Apply
    Overlay docs/screenshots/prod-auth-*. Without it this is a dry run.

.EXAMPLE
    pwsh scripts/capture-auth-guide.ps1 `
      -BaseUrl https://scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io `
      -EndpointId e8edd907-0dfb-415d-b834-abf0d20eb0e0 -Apply

.NOTES
    Re-shoot is intentional, never blind: review the binary diff and say in the
    commit message which surfaces changed and why.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$EndpointId,
    [string]$Token = 'changeme-scim',
    [int]$ViewportWidth = 1440,
    [int]$ViewportHeight = 1000,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$webDir    = Join-Path $repoRoot 'web'
$stageDir  = Join-Path $repoRoot 'test-results/ui-screenshots/auth-guide'
$keeperDir = Join-Path $repoRoot 'docs/screenshots'
$tokenKey  = 'scimserver.authToken'

$ep = $EndpointId
$connect  = "/endpoints/$ep/connect"
$settings = "/endpoints/$ep/settings"
$epLogs   = "/endpoints/$ep/logs"

# A deliberately invalid assertion: the debugger's REJECT output is what makes
# the troubleshooting screenshot useful (it shows expected-vs-received per trust).
$badAssertion = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Uta2lkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwL3YyLjAiLCJhdWQiOiJ3cm9uZy1hdWRpZW5jZSIsInN1YiI6Ijk5OTk5OTk5LTk5OTktOTk5OS05OTk5LTk5OTk5OTk5OTk5OSIsInRpZCI6IjAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMCIsImV4cCI6NDA3MDkwODgwMH0.c2ln'

# Curated surface map. KEEP IN SYNC with the image references in
# docs/AUTHENTICATION_GUIDE.md.
#   act steps: click | clickFirst (prefix match) | fill | wait | scroll | sleep
$surfaces = @(
    @{ File = 'prod-auth-01-connect-overview.png'; Route = $connect; Act = @() }
    @{ File = 'prod-auth-02-connect-shared-secret.png'; Route = $connect; Act = @(
        @{ k = 'click'; t = 'credentials-method-tab-shared_secret' }) }
    @{ File = 'prod-auth-03-connect-bearer.png'; Route = $connect; Act = @(
        @{ k = 'click'; t = 'credentials-method-tab-bearer' }) }
    @{ File = 'prod-auth-04-connect-oauth.png'; Route = $connect; Act = @(
        @{ k = 'click'; t = 'credentials-method-tab-oauth_client' }) }
    @{ File = 'prod-auth-05-connect-wif.png'; Route = $connect; Act = @(
        @{ k = 'click'; t = 'credentials-method-tab-wif' }) }
    # The JWKS host allowlist renders inside the add-trust FORM, not the
    # Advanced accordion - so this shot doubles as the trust-creation form.
    @{ File = 'prod-auth-06-wif-add-trust.png'; Route = $connect; Act = @(
        @{ k = 'click'; t = 'credentials-method-tab-wif' }
        @{ k = 'click'; t = 'wif-add-trust-button' }
        @{ k = 'scroll'; t = 'wif-add-trust-form' }) }
    @{ File = 'prod-auth-07-wif-debug-assertion.png'; Route = $connect; Act = @(
        @{ k = 'click'; t = 'credentials-method-tab-wif' }
        @{ k = 'click'; t = 'wif-advanced-toggle' }
        @{ k = 'scroll'; t = 'wif-debug-assertion' }
        @{ k = 'fill'; t = 'wif-debug-assertion-input'; v = $badAssertion }
        @{ k = 'click'; t = 'wif-debug-assertion-button' }
        @{ k = 'wait'; t = 'wif-debug-assertion-result' }
        @{ k = 'scroll'; t = 'wif-debug-assertion-result' }) }
    @{ File = 'prod-auth-08-auth-diagnostics.png'; Route = $connect; Act = @(
        @{ k = 'scroll'; t = 'connect-tab-auth-diagnostics' }) }
    @{ File = 'prod-auth-09-settings-auth-flags.png'; Route = $settings; Act = @(
        @{ k = 'scroll'; t = 'settings-flag-row-WifCredentialsEnabled' }) }
    @{ File = 'prod-auth-10-logs-auth-chips.png'; Route = $epLogs; Act = @() }
    @{ File = 'prod-auth-11-log-detail-auth.png'; Route = $epLogs; Act = @(
        @{ k = 'clickFirst'; t = 'logs-tab-row-' }
        @{ k = 'wait'; t = 'log-detail-auth-section' }
        @{ k = 'scroll'; t = 'log-detail-auth-section' }) }
    # NOTE: a JWT-decode shot cannot come from the logs - the server never
    # persists a token, so no log JSON block contains a JWT and the inline
    # decode button correctly never renders there. Verifying a trust is the
    # useful per-trust troubleshooting action instead.
    @{ File = 'prod-auth-12-wif-verify.png'; Route = $connect; Act = @(
        @{ k = 'click'; t = 'credentials-method-tab-wif' }
        @{ k = 'clickFirst'; t = 'wif-credential-verify-' }
        @{ k = 'sleep'; v = 3000 }
        @{ k = 'scrollFirst'; t = 'wif-credential-verify-result-' }) }
)

Write-Host "=== capture-auth-guide ===" -ForegroundColor Cyan
Write-Host "BaseUrl   : $BaseUrl"
Write-Host "Endpoint  : $EndpointId"
Write-Host "Viewport  : ${ViewportWidth}x${ViewportHeight}"
Write-Host "Mode      : $(if ($Apply) { 'APPLY (overlay prod-auth-*)' } else { 'DRY RUN (stage only)' })"
Write-Host ("Surfaces  : {0}" -f $surfaces.Count)

if (-not (Test-Path (Join-Path $webDir 'node_modules/playwright'))) {
    throw "Playwright not found in web/node_modules. Run 'cd web; npm ci' first."
}

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

$surfacesJson = ($surfaces | ForEach-Object {
    [pscustomobject]@{ file = $_.File; route = $_.Route; act = $_.Act }
}) | ConvertTo-Json -Compress -Depth 6
if ($surfaces.Count -eq 1) { $surfacesJson = "[$surfacesJson]" }

# The helper MUST live inside web/ - Node resolves bare imports relative to the
# SCRIPT FILE's directory, not the cwd, so a helper under test-results/ can
# never find `playwright` in web/node_modules.
$captureScript = Join-Path $webDir '_auth-guide-capture.mjs'
@'
import { chromium } from 'playwright';

const baseUrl = process.env.CAP_BASE_URL;
const token = process.env.CAP_TOKEN;
const tokenKey = process.env.CAP_TOKEN_KEY;
const outDir = process.env.CAP_OUT_DIR;
const vw = parseInt(process.env.CAP_VW, 10);
const vh = parseInt(process.env.CAP_VH, 10);
const surfaces = JSON.parse(process.env.CAP_SURFACES);

const sel = (t) => '[data-testid="' + t + '"]';
const selPrefix = (t) => '[data-testid^="' + t + '"]';

const browser = await chromium.launch();
let failed = 0;

for (const s of surfaces) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh } });
  await context.addInitScript(([k, v]) => {
    window.localStorage.setItem(k, v);
  }, [tokenKey, token]);
  const page = await context.newPage();
  const notes = [];
  try {
    await page.goto(baseUrl + s.route, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);

    for (const a of s.act || []) {
      if (a.k === 'sleep') { await page.waitForTimeout(a.v); continue; }
      const usePrefix = a.k === 'clickFirst' || a.k === 'scrollFirst';
      const locator = usePrefix ? page.locator(selPrefix(a.t)).first() : page.locator(sel(a.t)).first();
      // 'wait' must NOT pre-check count - the element is expected to appear.
      if (a.k === 'wait') {
        try { await locator.waitFor({ state: 'visible', timeout: 20000 }); }
        catch { notes.push('never-appeared:' + a.t); }
        continue;
      }
      const n = await locator.count();
      if (n === 0) { notes.push('missing:' + a.t); continue; }
      if (a.k === 'click' || a.k === 'clickFirst') {
        await locator.scrollIntoViewIfNeeded();
        await locator.click();
        await page.waitForTimeout(1200);
      } else if (a.k === 'fill') {
        await locator.fill(a.v);
        await page.waitForTimeout(300);
      } else if (a.k === 'scroll' || a.k === 'scrollFirst') {
        await locator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
      }
    }

    await page.waitForTimeout(1200);
    await page.screenshot({ path: outDir + '/' + s.file, fullPage: true });
    console.log('OK   ' + s.file + (notes.length ? '   [' + notes.join(' ') + ']' : ''));
    if (notes.length) failed++;
  } catch (err) {
    failed++;
    console.error('FAIL ' + s.file + '  : ' + err.message);
  } finally {
    await context.close();
  }
}
await browser.close();
process.exit(failed > 0 ? 1 : 0);
'@ | Set-Content -Path $captureScript -Encoding UTF8

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
    Remove-Item $captureScript -Force -ErrorAction SilentlyContinue
    Remove-Item Env:CAP_BASE_URL, Env:CAP_TOKEN, Env:CAP_TOKEN_KEY, Env:CAP_OUT_DIR, Env:CAP_VW, Env:CAP_VH, Env:CAP_SURFACES -ErrorAction SilentlyContinue
}

if ($captureExit -ne 0) {
    Write-Warning "One or more surfaces failed or had missing selectors. Review output before applying."
}

$oxipng = Get-Command oxipng -ErrorAction SilentlyContinue
$pngquant = Get-Command pngquant -ErrorAction SilentlyContinue
if ($oxipng) {
    Write-Host "`n=== optimizing (oxipng) ===" -ForegroundColor Cyan
    Get-ChildItem $stageDir -Filter 'prod-auth-*.png' | ForEach-Object { & oxipng -o 4 --strip safe $_.FullName 2>&1 | Out-Null }
}
elseif ($pngquant) {
    Write-Host "`n=== optimizing (pngquant) ===" -ForegroundColor Cyan
    Get-ChildItem $stageDir -Filter 'prod-auth-*.png' | ForEach-Object { & pngquant --force --ext .png --skip-if-larger $_.FullName 2>&1 | Out-Null }
}
else {
    Write-Warning "Neither oxipng nor pngquant found; skipping optimization."
}

Write-Host "`n=== staged captures ===" -ForegroundColor Cyan
Get-ChildItem $stageDir -Filter 'prod-auth-*.png' | ForEach-Object {
    "{0,-44} {1,8:N1} KB" -f $_.Name, ($_.Length / 1KB)
}

if (-not $Apply) {
    Write-Host "`nDRY RUN complete. Staged under:" -ForegroundColor Yellow
    Write-Host "  $stageDir"
    Write-Host "Re-run with -Apply to overlay docs/screenshots/prod-auth-*." -ForegroundColor Yellow
    return
}

Write-Host "`n=== applying: overlay docs/screenshots/prod-auth-* ===" -ForegroundColor Cyan
foreach ($s in $surfaces) {
    $src = Join-Path $stageDir $s.File
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $keeperDir $s.File) -Force
        Write-Host "copied $($s.File)"
    }
    else {
        Write-Warning "missing staged capture: $($s.File)"
    }
}
Write-Host "`nDone. Review the binary diff before committing." -ForegroundColor Green
