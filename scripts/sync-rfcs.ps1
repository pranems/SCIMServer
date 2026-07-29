<#
.SYNOPSIS
  Keeps the mirrored RFC corpus under docs/rfcs/ and docs/auth/rfcs/ provably
  current with the IETF RFC Editor. Audit mode by default; -Update refreshes.

.DESCRIPTION
  WHY THIS EXISTS
  ---------------
  This repo mirrors RFC plain text so normative wording can be cited line-for-
  line without a network round-trip. A mirror is a snapshot, and a snapshot rots
  in three distinct ways that no other gate in this repo can see:

    1. A NEW RFC starts updating one we depend on. RFC 7643 and RFC 7644 were
       both updated by RFC 9865 (Oct 2025) and RFC 9967 (May 2026). Until
       2026-07-29 the corpus mirrored neither, and docs/rfcs/README.md claimed
       only "RFC 7643 was updated by RFC 9865" - already stale by one RFC.
    2. Errata get VERIFIED, changing what the normative text actually means.
       RFC 7643 erratum 8415 (verified 2025-10-28) removed "complex" from the
       legal values of subAttributes.type, settling a nesting ambiguity that
       implementers had been reading the other way for a decade. Nothing about
       the mirrored rfc7643.txt changes when that happens.
    3. The mirrored file silently diverges from upstream (bad copy, partial
       download, well-meaning edit). A corpus you cannot trust byte-for-byte is
       worse than no corpus, because it is cited as authoritative.

  This is the same lesson as scripts/audit-base-images.ps1 (an EOL runtime with
  no CVE is invisible to a CVE scanner) and scripts/audit-deployment-doc.ps1 (a
  confidently wrong doc terminates an investigation in the wrong place). A
  correctness gate cannot see a CURRENCY problem. So currency gets its own gate.

  SELF-EXTENDING BY CONSTRUCTION
  ------------------------------
  Check C3 walks the updates/obsoletes graph: every RFC listed as updating or
  obsoleting something we mirror MUST itself be mirrored, or carry an explicit
  waiver with a reason. When the IETF publishes the next RFC that updates 7643,
  the next -Online run rewrites updatedBy, C3 goes red, and the corpus demands
  the new document with no edit to this script. That is the same construction as
  check C3 in audit-deployment-doc.ps1.

  OFFLINE vs ONLINE
  -----------------
  Checks C1-C5 are OFFLINE: pure local consistency, deterministic, no network.
  They are safe on pre-push and in an air-gapped build.
  Checks O1-O3 need the network and run only with -Online (monthly CI job, or
  on demand). Splitting them this way keeps the fast path fast and honest: an
  offline run reports "not checked", never "passed".

.PARAMETER Online
  Additionally verify status, updates/obsoletes graph, errata counts and the
  upstream byte hash against https://www.rfc-editor.org.

.PARAMETER Update
  Rewrite the manifest from live upstream data and download any RFC text that is
  missing or has drifted. Implies -Online. This is the ONLY sanctioned way to
  edit docs/rfcs/rfc-manifest.json.

.PARAMETER MaxAgeDays
  How stale the manifest's lastVerified date may be before C4 fails. Default 90.

.PARAMETER Quiet
  Suppress per-check narration; print only the verdict.

.EXAMPLE
  pwsh -File scripts/sync-rfcs.ps1
  Offline audit. This is what pre-push runs.

.EXAMPLE
  pwsh -File scripts/sync-rfcs.ps1 -Online
  Full audit including upstream drift, new updating RFCs and new errata.

.EXAMPLE
  pwsh -File scripts/sync-rfcs.ps1 -Update
  Refresh the corpus + manifest after the RFC Editor publishes something new.

.LINK
  https://www.rfc-editor.org/rfc-index.xml
.LINK
  https://www.rfc-editor.org/errata.json
#>
[CmdletBinding()]
param(
    [switch]$Online,
    [switch]$Update,
    [int]$MaxAgeDays = 90,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/rfc-index.ps1"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'docs/rfcs/rfc-manifest.json'

# Both mirror folders are governed by ONE manifest so neither can drift out of
# scope. Adding a third folder here is the only change needed to govern it.
$mirrorFolders = @('docs/rfcs', 'docs/auth/rfcs')

if ($Update) { $Online = $true }

$failures = @()
$warnings = @()
$notChecked = @()

function Write-Step {
    param([string]$Text)
    if (-not $Quiet) { Write-Host $Text }
}

function Add-Failure {
    param([string]$Check, [string]$Message)
    $script:failures += [pscustomobject]@{ Check = $Check; Message = $Message }
}

# ── Load manifest ────────────────────────────────────────────────────────────
if (-not (Test-Path $manifestPath)) {
    if (-not $Update) {
        Write-Host "FAIL - manifest not found: docs/rfcs/rfc-manifest.json" -ForegroundColor Red
        Write-Host "       Run: pwsh -File scripts/sync-rfcs.ps1 -Update" -ForegroundColor Yellow
        exit 1
    }
    $manifest = [pscustomobject]@{
        '$schema'    = './rfc-manifest.schema.json'
        lastVerified = ''
        sources      = [pscustomobject]@{}
        mirrors      = @()
        waivers      = @()
    }
} else {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}

$mirrors = @($manifest.mirrors)
$waivers = @()
if ($manifest.PSObject.Properties.Name -contains 'waivers' -and $manifest.waivers) {
    $waivers = @($manifest.waivers)
}

# ── -Update: refresh every mirror from upstream ──────────────────────────────
if ($Update) {
    Write-Step 'Refreshing RFC corpus from https://www.rfc-editor.org ...'
    $index = Get-RfcIndexEntries -CacheHours 0
    $numbers = @($mirrors | ForEach-Object { [string]$_.rfc })
    $errata = Get-RfcErrataSummary -Numbers $numbers -CacheHours 0
    $today = (Get-Date).ToString('yyyy-MM-dd')

    foreach ($m in $mirrors) {
        $num = [string]$m.rfc
        $abs = Join-Path $repoRoot $m.file

        if (-not $index.ContainsKey($num)) {
            Add-Failure -Check 'UPDATE' -Message "RFC $num is not present in rfc-index.xml."
            continue
        }
        $entry = $index[$num]

        $needsDownload = -not (Test-Path $abs)
        if (-not $needsDownload) {
            $upstreamPath = Get-RfcCachedFile -Url (Get-RfcTextUrl -Number $num) -CacheName "rfc$num.txt" -CacheHours 0
            if ((Get-RfcFileHash -Path $upstreamPath) -ne (Get-RfcFileHash -Path $abs)) { $needsDownload = $true }
        }
        if ($needsDownload) {
            $upstreamPath = Get-RfcCachedFile -Url (Get-RfcTextUrl -Number $num) -CacheName "rfc$num.txt" -CacheHours 0
            $dir = Split-Path -Parent $abs
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Copy-Item -LiteralPath $upstreamPath -Destination $abs -Force
            Write-Step ("  downloaded  {0}" -f $m.file)
            $m.retrieved = $today
        }

        $m.title = $entry.Title
        $m.status = $entry.Status
        $m.published = ('{0}-{1}' -f $entry.Year, $entry.Month)
        $m.updatedBy = @($entry.UpdatedBy)
        $m.obsoletedBy = @($entry.ObsoletedBy)
        $m.sha256 = Get-RfcFileHash -Path $abs

        $counts = [ordered]@{}
        if ($errata.ContainsKey($num)) {
            foreach ($k in ($errata[$num].Keys | Sort-Object)) { $counts[$k] = $errata[$num][$k] }
        }
        $m.errata = [pscustomobject]$counts
    }

    $manifest.lastVerified = $today
    $manifest.sources = [pscustomobject][ordered]@{
        index      = 'https://www.rfc-editor.org/rfc-index.xml'
        errata     = 'https://www.rfc-editor.org/errata.json'
        textFormat = 'https://www.rfc-editor.org/rfc/rfc{N}.txt'
        infoFormat = 'https://www.rfc-editor.org/info/rfc{N}'
    }

    ($manifest | ConvertTo-Json -Depth 8) + "`n" | Set-Content -LiteralPath $manifestPath -Encoding utf8 -NoNewline
    Write-Step ("  manifest written ({0} mirrors, lastVerified {1})" -f $mirrors.Count, $today)

    # Re-read so the audit below runs against exactly what was persisted.
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $mirrors = @($manifest.mirrors)
}

# ── C1: coverage - manifest and disk agree on WHICH files are mirrored ───────
Write-Step 'C1  corpus coverage (every mirrored .txt is declared, and vice versa)'
$declared = @{}
foreach ($m in $mirrors) {
    $declared[($m.file -replace '\\', '/')] = $m
    $abs = Join-Path $repoRoot $m.file
    if (-not (Test-Path $abs)) {
        Add-Failure -Check 'C1' -Message ("manifest declares {0} but the file does not exist." -f $m.file)
    }
}
foreach ($folder in $mirrorFolders) {
    $absFolder = Join-Path $repoRoot $folder
    if (-not (Test-Path $absFolder)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $absFolder -Filter '*.txt' -File)) {
        $rel = ('{0}/{1}' -f $folder, $f.Name)
        if (-not $declared.ContainsKey($rel)) {
            Add-Failure -Check 'C1' -Message ("{0} is mirrored on disk but absent from rfc-manifest.json. Add it (with -Update) or delete it." -f $rel)
        }
    }
}

# ── C2: integrity - on-disk bytes match the recorded hash ────────────────────
Write-Step 'C2  mirror integrity (on-disk SHA-256 matches the manifest)'
foreach ($m in $mirrors) {
    $abs = Join-Path $repoRoot $m.file
    if (-not (Test-Path $abs)) { continue }
    $actual = Get-RfcFileHash -Path $abs
    if ($actual -ne [string]$m.sha256) {
        Add-Failure -Check 'C2' -Message ("{0} has been modified. RFC mirrors are verbatim and MUST NOT be edited. expected={1} actual={2}" -f $m.file, $m.sha256, $actual)
    }
}

# ── C3: closure - anything that updates/obsoletes us is itself mirrored ──────
# This is the self-extending check. A newly published RFC that updates 7643
# lands in updatedBy on the next -Online run and immediately fails here.
Write-Step 'C3  update/obsolete closure (nothing that changes a mirrored RFC is missing)'
$mirroredNumbers = @{}
foreach ($m in $mirrors) { $mirroredNumbers[[string]$m.rfc] = $true }
$waived = @{}
foreach ($w in $waivers) { $waived[[string]$w.rfc] = [string]$w.reason }

foreach ($m in $mirrors) {
    $related = @()
    if ($m.PSObject.Properties.Name -contains 'updatedBy' -and $m.updatedBy) { $related += @($m.updatedBy) }
    if ($m.PSObject.Properties.Name -contains 'obsoletedBy' -and $m.obsoletedBy) { $related += @($m.obsoletedBy) }

    foreach ($r in ($related | Select-Object -Unique)) {
        $rNum = [string]$r
        if ($mirroredNumbers.ContainsKey($rNum)) { continue }
        if ($waived.ContainsKey($rNum)) {
            $warnings += ("C3  RFC {0} updates/obsoletes RFC {1} and is NOT mirrored. Waived: {2}" -f $rNum, $m.rfc, $waived[$rNum])
            continue
        }
        Add-Failure -Check 'C3' -Message ("RFC {0} updates or obsoletes RFC {1} (which we mirror) but is not in the corpus. Run -Update after adding it to rfc-manifest.json, or add a waivers[] entry with a reason. https://www.rfc-editor.org/info/rfc{0}" -f $rNum, $m.rfc)
    }

    if ($m.PSObject.Properties.Name -contains 'obsoletedBy' -and @($m.obsoletedBy).Count -gt 0) {
        $warnings += ("C3  RFC {0} is OBSOLETED by RFC {1}. Every doc citing it needs review." -f $m.rfc, (@($m.obsoletedBy) -join ', '))
    }
}

# ── C4: freshness ────────────────────────────────────────────────────────────
Write-Step ("C4  manifest freshness (lastVerified within {0} days)" -f $MaxAgeDays)
$lastVerified = [string]$manifest.lastVerified
if ([string]::IsNullOrWhiteSpace($lastVerified)) {
    Add-Failure -Check 'C4' -Message 'manifest has no lastVerified date. Run -Update.'
} else {
    $parsed = [datetime]::MinValue
    if (-not [datetime]::TryParse($lastVerified, [ref]$parsed)) {
        Add-Failure -Check 'C4' -Message ("lastVerified '{0}' is not a parsable date." -f $lastVerified)
    } else {
        $age = [int]((Get-Date) - $parsed).TotalDays
        if ($age -gt $MaxAgeDays) {
            Add-Failure -Check 'C4' -Message ("corpus last verified against the RFC Editor {0} days ago ({1}), limit is {2}. Run: pwsh -File scripts/sync-rfcs.ps1 -Update" -f $age, $lastVerified, $MaxAgeDays)
        } else {
            Write-Step ("    last verified {0} ({1} days ago)" -f $lastVerified, $age)
        }
    }
}

# ── C5: README linkage - every mirror is discoverable from its folder README ─
Write-Step 'C5  README linkage (every mirrored file is listed in its folder README)'
$readmeCache = @{}
foreach ($m in $mirrors) {
    # Split-Path returns a backslash-separated parent on Windows; the messages and
    # the README lookup must both use forward slashes so output is copy-pasteable
    # on any platform.
    $folder = (Split-Path -Parent ($m.file -replace '\\', '/')) -replace '\\', '/'
    $readmeRel = ('{0}/README.md' -f $folder)
    $readmeAbs = Join-Path $repoRoot $readmeRel
    if (-not (Test-Path $readmeAbs)) {
        Add-Failure -Check 'C5' -Message ("{0} is missing; the mirror folder must document its contents." -f $readmeRel)
        continue
    }
    if (-not $readmeCache.ContainsKey($readmeRel)) {
        $readmeCache[$readmeRel] = Get-Content -LiteralPath $readmeAbs -Raw
    }
    $leaf = Split-Path -Leaf $m.file
    if ($readmeCache[$readmeRel] -notmatch [regex]::Escape($leaf)) {
        Add-Failure -Check 'C5' -Message ("{0} does not mention {1}. An undocumented mirror is an unfindable mirror." -f $readmeRel, $leaf)
    }
}

# ── O1-O3: upstream verification ─────────────────────────────────────────────
if ($Online) {
    Write-Step 'O1  upstream text drift (mirrored bytes match www.rfc-editor.org)'
    Write-Step 'O2  metadata drift (status + updates/obsoletes graph)'
    Write-Step 'O3  errata drift (new verified errata since lastVerified)'

    $index = Get-RfcIndexEntries
    $numbers = @($mirrors | ForEach-Object { [string]$_.rfc })
    $errata = Get-RfcErrataSummary -Numbers $numbers

    foreach ($m in $mirrors) {
        $num = [string]$m.rfc

        # O1
        $abs = Join-Path $repoRoot $m.file
        if (Test-Path $abs) {
            $upstream = Get-RfcCachedFile -Url (Get-RfcTextUrl -Number $num) -CacheName "rfc$num.txt"
            $upstreamHash = Get-RfcFileHash -Path $upstream
            if ($upstreamHash -ne [string]$m.sha256) {
                Add-Failure -Check 'O1' -Message ("RFC {0} text upstream differs from the mirror. Run -Update. {1}" -f $num, (Get-RfcTextUrl -Number $num))
            }
        }

        # O2
        if (-not $index.ContainsKey($num)) {
            Add-Failure -Check 'O2' -Message ("RFC {0} is not in rfc-index.xml." -f $num)
        } else {
            $entry = $index[$num]
            if ($entry.Status -ne [string]$m.status) {
                Add-Failure -Check 'O2' -Message ("RFC {0} status changed: manifest='{1}' upstream='{2}'. {3}" -f $num, $m.status, $entry.Status, (Get-RfcInfoUrl -Number $num))
            }
            $manifestUpdatedBy = @()
            if ($m.PSObject.Properties.Name -contains 'updatedBy' -and $m.updatedBy) { $manifestUpdatedBy = @($m.updatedBy | ForEach-Object { [string]$_ }) }
            $upstreamUpdatedBy = @($entry.UpdatedBy | ForEach-Object { [string]$_ })
            if (($manifestUpdatedBy -join ',') -ne ($upstreamUpdatedBy -join ',')) {
                Add-Failure -Check 'O2' -Message ("RFC {0} 'Updated by' changed: manifest=[{1}] upstream=[{2}]. A NEW RFC now modifies a document this repo relies on - read it, then run -Update. {3}" -f $num, ($manifestUpdatedBy -join ','), ($upstreamUpdatedBy -join ','), (Get-RfcInfoUrl -Number $num))
            }
            $manifestObsoletedBy = @()
            if ($m.PSObject.Properties.Name -contains 'obsoletedBy' -and $m.obsoletedBy) { $manifestObsoletedBy = @($m.obsoletedBy | ForEach-Object { [string]$_ }) }
            $upstreamObsoletedBy = @($entry.ObsoletedBy | ForEach-Object { [string]$_ })
            if (($manifestObsoletedBy -join ',') -ne ($upstreamObsoletedBy -join ',')) {
                Add-Failure -Check 'O2' -Message ("RFC {0} 'Obsoleted by' changed: manifest=[{1}] upstream=[{2}]. {3}" -f $num, ($manifestObsoletedBy -join ','), ($upstreamObsoletedBy -join ','), (Get-RfcInfoUrl -Number $num))
            }
        }

        # O3
        $manifestErrata = @{}
        if ($m.PSObject.Properties.Name -contains 'errata' -and $m.errata) {
            foreach ($p in $m.errata.PSObject.Properties) { $manifestErrata[$p.Name] = [int]$p.Value }
        }
        $liveErrata = @{}
        if ($errata.ContainsKey($num)) { foreach ($k in $errata[$num].Keys) { $liveErrata[$k] = [int]$errata[$num][$k] } }

        foreach ($status in (@($manifestErrata.Keys) + @($liveErrata.Keys) | Select-Object -Unique | Sort-Object)) {
            $was = if ($manifestErrata.ContainsKey($status)) { $manifestErrata[$status] } else { 0 }
            $now = if ($liveErrata.ContainsKey($status)) { $liveErrata[$status] } else { 0 }
            if ($was -eq $now) { continue }

            $msg = ("RFC {0} errata '{1}' changed {2} -> {3}. {4}" -f $num, $status, $was, $now, (Get-RfcErrataUrl -Number $num))
            if ($status -eq 'Verified') {
                # A newly VERIFIED erratum changes what the normative text means.
                # Erratum 8415 on RFC 7643 is the worked example: it removed
                # 'complex' from the legal subAttributes.type values.
                Add-Failure -Check 'O3' -Message ($msg + ' A newly VERIFIED erratum can change normative meaning - read it, update the affected explainer, then run -Update.')
            } else {
                $warnings += ('O3  ' + $msg)
            }
        }
    }
} else {
    $notChecked += 'O1 upstream text drift'
    $notChecked += 'O2 status + updates/obsoletes graph'
    $notChecked += 'O3 errata drift'
}

# ── Verdict ──────────────────────────────────────────────────────────────────
if (-not $Quiet) {
    Write-Host ''
    Write-Host ("RFC corpus: {0} mirrored document(s) across {1}." -f $mirrors.Count, ($mirrorFolders -join ', '))
}

foreach ($w in $warnings) { Write-Host ("WARN  {0}" -f $w) -ForegroundColor Yellow }

if ($notChecked.Count -gt 0 -and -not $Quiet) {
    Write-Host ''
    Write-Host 'NOT CHECKED (offline run) - these need -Online:' -ForegroundColor DarkGray
    foreach ($n in $notChecked) { Write-Host ("  - {0}" -f $n) -ForegroundColor DarkGray }
}

if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host ("FAIL - {0} RFC-corpus currency problem(s):" -f $failures.Count) -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host ("  [{0}] {1}" -f $f.Check, $f.Message) -ForegroundColor Red
    }
    Write-Host ''
    Write-Host 'Fix: pwsh -NoProfile -File scripts/sync-rfcs.ps1 -Update' -ForegroundColor Yellow
    Write-Host 'Docs: docs/rfcs/README.md' -ForegroundColor Yellow
    exit 1
}

if (-not $Quiet) {
    $scope = if ($Online) { 'C1-C5 + O1-O3' } else { 'C1-C5 (offline)' }
    Write-Host ("PASS - RFC corpus is current and intact ({0})." -f $scope) -ForegroundColor Green
}
exit 0
