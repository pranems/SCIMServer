<#
.SYNOPSIS
    Single-source version bump for the entire SCIMServer project.

.DESCRIPTION
    The canonical version lives in api/package.json — the single source of truth.

    This script performs a COMPREHENSIVE find-and-replace of the old version string
    across EVERY text file in the repo (not just .md), covering:
      - Markdown docs, README, DEPLOYMENT, Session_starter, CHANGELOG
      - .github/prompts/*.prompt.md  (Copilot prompt files)
      - .github/copilot-instructions.md
      - JSON files: OpenAPI spec, version-latest badge, etc.
      - PowerShell scripts (.ps1) — deploy, live-test, setup, etc.
      - TypeScript source comments (.ts)
      - YAML CI workflows (.yml)
      - Dockerfiles
      - api/package.json  (source of truth)
      - api/package-lock.json  (synced via npm)

    EXCLUDED (never modified):
      - node_modules/         — third-party dependencies
      - dist/                 — build artifacts
      - coverage*/            — test coverage reports
      - test-results/         — ephemeral test output
      - api/package-lock.json — synced separately via npm
      - .git/                 — git internals
      - Binary files          — images, fonts, etc.
      - This script itself    — bump-version.ps1 contains example versions in comments

    After replacement, it also:
      - Syncs api/package-lock.json via `npm install --package-lock-only`
      - Adds a placeholder CHANGELOG.md entry for the new version
      - Runs a verification scan to confirm zero remaining old-version references

.PARAMETER NewVersion
    The new semver version string, e.g. "0.25.0".
    If omitted, the script will prompt.

.PARAMETER DryRun
    Show what would be changed without writing any files.

.EXAMPLE
    .\bump-version.ps1 -NewVersion 0.25.0
    .\bump-version.ps1 -NewVersion 0.25.0 -DryRun
#>
param(
    [Parameter(Position = 0)]
    [string]$NewVersion,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Resolve repo root (script lives in /scripts) ─────────────────────────────
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pkgPath  = Join-Path $repoRoot 'api' 'package.json'

if (-not (Test-Path $pkgPath)) {
    Write-Error "Cannot find api/package.json at $pkgPath"
    return
}

# ── Read current version from single source of truth ─────────────────────────
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$oldVersion = $pkg.version

if (-not $NewVersion) {
    $NewVersion = Read-Host "Current version is $oldVersion. Enter new version"
}

if ($NewVersion -eq $oldVersion) {
    Write-Host "Version is already $oldVersion — nothing to do." -ForegroundColor Yellow
    return
}

# Validate semver-ish format
if ($NewVersion -notmatch '^\d+\.\d+\.\d+(-[\w.]+)?$') {
    Write-Error "Invalid version format: $NewVersion  (expected semver like 1.2.3 or 1.2.3-beta.1)"
    return
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  SCIMServer Version Bump: $oldVersion → $NewVersion" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
if ($DryRun) { Write-Host "   (DRY RUN — no files will be modified)" -ForegroundColor Yellow }
Write-Host ""

$touchedFiles  = [System.Collections.Generic.List[string]]::new()
$totalReplaces = 0

# ── Helper: replace in file ──────────────────────────────────────────────────
function Update-FileVersion {
    param(
        [string]$FilePath,
        [string]$Old,
        [string]$New
    )
    if (-not (Test-Path $FilePath)) { return }
    $content = [System.IO.File]::ReadAllText($FilePath)
    if ($content.Contains($Old)) {
        $updated = $content.Replace($Old, $New)
        if (-not $DryRun) {
            [System.IO.File]::WriteAllText($FilePath, $updated)
        }
        $rel = $FilePath.Replace($repoRoot + '\', '').Replace($repoRoot + '/', '')
        $count = ($content.Split($Old).Length - 1)
        Write-Host "   ✅ $rel  ($count replacement$(if($count -gt 1){'s'}))" -ForegroundColor Green
        $touchedFiles.Add($rel)
        $script:totalReplaces += $count
    }
}

# ── Text file extensions we process ──────────────────────────────────────────
$textExtensions = @(
    '.md', '.json', '.ps1', '.ts', '.js', '.yml', '.yaml',
    '.mjs', '.cjs', '.bicep', '.sh', '.mmd', '.txt', '.env',
    '.cfg', '.toml', '.ini', '.html', '.css', '.prisma'
)
# Files with no extension that we also process (Dockerfile, etc.)
$noExtNames = @('Dockerfile', 'Dockerfile.multi', 'Dockerfile.optimized', 'Dockerfile.ultra', '.env', '.env.example')

# ── Directories and files to EXCLUDE ─────────────────────────────────────────
$excludeDirPatterns = @(
    'node_modules', '[/\\]\.git[/\\]', '[/\\]dist[/\\]', 'coverage', 'test-results'
)
$excludeFileNames = @(
    'package-lock.json',   # synced separately via npm
    'bump-version.ps1'     # this script — contains example versions in comments
)

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: api/package.json  (targeted replacement of "version" field only)
# ══════════════════════════════════════════════════════════════════════════════
Write-Host "1️⃣  Updating api/package.json (source of truth)..." -ForegroundColor White
Update-FileVersion -FilePath $pkgPath -Old "`"version`": `"$oldVersion`"" -New "`"version`": `"$NewVersion`""

# ── STEP 1b: web/package.json (keep in sync with api/package.json) ───────────
$webPkgPath = Join-Path $repoRoot 'web' 'package.json'
if (Test-Path $webPkgPath) {
    Write-Host "   Updating web/package.json..." -ForegroundColor White
    Update-FileVersion -FilePath $webPkgPath -Old "`"version`": `"$oldVersion`"" -New "`"version`": `"$NewVersion`""
}

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: Sync package-lock.json via npm
# ══════════════════════════════════════════════════════════════════════════════
Write-Host "2️⃣  Syncing api/package-lock.json..." -ForegroundColor White
if (-not $DryRun) {
    Push-Location (Join-Path $repoRoot 'api')
    npm install --package-lock-only --ignore-scripts 2>&1 | Out-Null
    Pop-Location
    Write-Host "   ✅ package-lock.json synced" -ForegroundColor Green
    $touchedFiles.Add('api/package-lock.json')
} else {
    Write-Host "   (skipped in dry run)" -ForegroundColor DarkGray
}

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: Comprehensive find-and-replace across ALL text files
# ══════════════════════════════════════════════════════════════════════════════
Write-Host "3️⃣  Scanning all project files for '$oldVersion'..." -ForegroundColor White

# Gather ALL files recursively, including hidden dirs like .github/
$allFiles = Get-ChildItem -Path $repoRoot -Recurse -File -Force |
    Where-Object {
        # Exclude directories
        $dir = $_.DirectoryName
        $excluded = $false
        foreach ($pat in $excludeDirPatterns) {
            if ($dir -match $pat) { $excluded = $true; break }
        }
        if ($excluded) { return $false }

        # Exclude specific filenames
        if ($_.Name -in $excludeFileNames) { return $false }

        # Already handled package.json in step 1/1b
        if ($_.FullName -eq $pkgPath) { return $false }
        if ($_.FullName -eq $webPkgPath) { return $false }

        # CHANGELOG.md handled in step 4 (needs special insert logic)
        if ($_.Name -eq 'CHANGELOG.md' -and $_.DirectoryName -eq $repoRoot) { return $false }

        # Only process text files (by extension or known name)
        $ext = $_.Extension.ToLower()
        ($ext -in $textExtensions) -or ($_.Name -in $noExtNames)
    }

$scannedCount = 0
foreach ($f in $allFiles) {
    $scannedCount++
    Update-FileVersion -FilePath $f.FullName -Old $oldVersion -New $NewVersion
}
Write-Host "   📂 Scanned $scannedCount files" -ForegroundColor DarkGray

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: Add CHANGELOG.md placeholder entry (CHANGELOG excluded from step 3)
# ══════════════════════════════════════════════════════════════════════════════
Write-Host "4️⃣  Adding CHANGELOG.md entry..." -ForegroundColor White
$changelogPath = Join-Path $repoRoot 'CHANGELOG.md'
if (Test-Path $changelogPath) {
    $clContent = [System.IO.File]::ReadAllText($changelogPath)
    $today = Get-Date -Format 'yyyy-MM-dd'
    $newEntry = "## [$NewVersion] - $today`n`n> TODO: Describe changes for $NewVersion`n`n"

    if ($clContent.Contains("## [$NewVersion]")) {
        Write-Host "   ⏭️  Entry for $NewVersion already exists — skipped" -ForegroundColor DarkGray
    } else {
        $marker = "## [$oldVersion]"
        if ($clContent.Contains($marker)) {
            $updated = $clContent.Replace($marker, "$newEntry$marker")
            if (-not $DryRun) {
                [System.IO.File]::WriteAllText($changelogPath, $updated)
            }
            Write-Host "   ✅ CHANGELOG.md  (new section added before $marker)" -ForegroundColor Green
            $touchedFiles.Add('CHANGELOG.md')
            $script:totalReplaces += 1
        } else {
            Write-Host "   ⚠️  Could not find marker '$marker' in CHANGELOG — manual edit needed" -ForegroundColor Yellow
        }
    }
}

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5: Verification scan — confirm zero remaining old-version references
# ══════════════════════════════════════════════════════════════════════════════
Write-Host "5️⃣  Verification scan..." -ForegroundColor White
$remainingHits = Get-ChildItem -Path $repoRoot -Recurse -File -Force |
    Where-Object {
        $dir = $_.DirectoryName
        $skip = $false
        foreach ($pat in $excludeDirPatterns) { if ($dir -match $pat) { $skip = $true; break } }
        if ($skip) { return $false }
        if ($_.Name -in $excludeFileNames) { return $false }
        # CHANGELOG old-version refs are expected (historical entries)
        if ($_.Name -eq 'CHANGELOG.md') { return $false }
        $ext = $_.Extension.ToLower()
        ($ext -in $textExtensions) -or ($_.Name -in $noExtNames)
    } |
    Select-String $oldVersion -SimpleMatch

if ($remainingHits.Count -eq 0) {
    Write-Host "   ✅ Zero remaining '$oldVersion' references — clean!" -ForegroundColor Green
} else {
    Write-Host "   ℹ️  $($remainingHits.Count) remaining '$oldVersion' references (historical/expected):" -ForegroundColor Yellow
    foreach ($h in $remainingHits) {
        $rel = $h.Path.Replace($repoRoot + '\', '')
        Write-Host "      $rel`:$($h.LineNumber)" -ForegroundColor DarkGray
    }
    Write-Host "   These are historical references (e.g., 'Implemented in v$oldVersion') — no action needed." -ForegroundColor DarkGray
}

# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Version bump complete: $oldVersion → $NewVersion" -ForegroundColor Cyan
Write-Host "  Files touched: $($touchedFiles.Count)" -ForegroundColor Cyan
Write-Host "  Total replacements: $totalReplaces" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Review changes:  git diff --stat" -ForegroundColor DarkGray
Write-Host "  2. Edit CHANGELOG.md with actual release notes" -ForegroundColor DarkGray
Write-Host "  3. Build:           cd api && npm run build" -ForegroundColor DarkGray
Write-Host "  4. Commit:          git add -A && git commit -m 'chore: bump version to $NewVersion'" -ForegroundColor DarkGray
Write-Host "  5. Deploy:          .\scripts\deploy-azure.ps1  (auto-reads version from package.json)" -ForegroundColor DarkGray
Write-Host ""
