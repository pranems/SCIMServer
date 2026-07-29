<#
.SYNOPSIS
  Shared helpers for reading the authoritative IETF RFC index and errata feed.

.DESCRIPTION
  Sourced by scripts/sync-rfcs.ps1 (the RFC-corpus currency gate). Kept in its
  own file so the gate and any ad-hoc query share ONE definition of where the
  authoritative data comes from and how it is parsed - the same "one source of
  truth" discipline scripts/node-lts.ps1 applies to the Node LTS table.

  Authoritative sources (all from the RFC Editor, which is the publisher of
  record; datatracker.ietf.org returns HTTP 403 to automated fetch):

    https://www.rfc-editor.org/rfc-index.xml      status + updates/obsoletes graph
    https://www.rfc-editor.org/errata.json        every published erratum
    https://www.rfc-editor.org/rfc/rfc<N>.txt     the normative text itself

  NOTE: rfc-index.xml is ~13 MB and errata.json is ~9 MB. Both are cached under
  the OS temp dir for CacheHours so a developer running the gate repeatedly does
  not hammer the RFC Editor.
#>

# Deliberately NOT Set-StrictMode: rfc-index.xml and errata.json are external
# JSON/XML whose optional elements come back as $null or as a scalar rather than
# an array. StrictMode turns every such absence into a terminating error, which
# in a GATE is worse than useless - it fails loudly for the wrong reason. Every
# collection access below is defensively wrapped in @() instead.

$script:RfcIndexUrl = 'https://www.rfc-editor.org/rfc-index.xml'
$script:RfcErrataUrl = 'https://www.rfc-editor.org/errata.json'
$script:RfcTextUrlFormat = 'https://www.rfc-editor.org/rfc/rfc{0}.txt'
$script:RfcInfoUrlFormat = 'https://www.rfc-editor.org/info/rfc{0}'
$script:RfcErrataUrlFormat = 'https://www.rfc-editor.org/errata_search.php?rfc={0}'

function Get-RfcCachePath {
    param([Parameter(Mandatory)][string]$Name)
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) 'scimserver-rfc-cache'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return (Join-Path $dir $Name)
}

function Get-RfcCachedFile {
    <#
      Downloads $Url to a temp cache file, reusing the cache when it is younger
      than $CacheHours. Returns the local path.
    #>
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$CacheName,
        [int]$CacheHours = 12,
        [int]$TimeoutSec = 300
    )

    $path = Get-RfcCachePath -Name $CacheName
    if (Test-Path $path) {
        $age = (Get-Date) - (Get-Item $path).LastWriteTime
        if ($age.TotalHours -lt $CacheHours) { return $path }
    }

    $previousProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
    } finally {
        $ProgressPreference = $previousProgress
    }
    return $path
}

function Get-RfcIndexEntries {
    <#
      Returns a hashtable keyed by numeric RFC id (as string, e.g. '7643') whose
      values carry the fields the corpus gate cares about.
    #>
    param([int]$CacheHours = 12)

    $path = Get-RfcCachedFile -Url $script:RfcIndexUrl -CacheName 'rfc-index.xml' -CacheHours $CacheHours
    [xml]$xml = Get-Content -LiteralPath $path -Raw

    $map = @{}
    foreach ($entry in $xml.'rfc-index'.'rfc-entry') {
        $docId = [string]$entry.'doc-id'
        if ($docId -notmatch '^RFC(?<num>\d+)$') { continue }
        $num = [string]([int]$Matches['num'])

        $map[$num] = [pscustomobject]@{
            Number       = $num
            Title        = ([string]$entry.title).Trim()
            Status       = ([string]$entry.'current-status').Trim()
            Stream       = ([string]$entry.stream).Trim()
            Year         = [string]$entry.date.year
            Month        = [string]$entry.date.month
            Updates      = @(Get-RfcRelatedNumbers -Node $entry.updates)
            UpdatedBy    = @(Get-RfcRelatedNumbers -Node $entry.'updated-by')
            Obsoletes    = @(Get-RfcRelatedNumbers -Node $entry.obsoletes)
            ObsoletedBy  = @(Get-RfcRelatedNumbers -Node $entry.'obsoleted-by')
        }
    }
    return $map
}

function Get-RfcRelatedNumbers {
    <#
      rfc-index.xml wraps relations as <updates><doc-id>RFC9865</doc-id></updates>.
      A missing element, a single child and multiple children all have to be
      normalised to a string[] of bare numbers, dropping non-RFC ids (BCP/STD).
    #>
    param($Node)
    if ($null -eq $Node) { return @() }

    $ids = @($Node.'doc-id')
    $out = @()
    foreach ($id in $ids) {
        $text = [string]$id
        if ($text -match '^RFC(?<num>\d+)$') { $out += [string]([int]$Matches['num']) }
    }
    return ($out | Sort-Object { [int]$_ })
}

function Get-RfcErrataSummary {
    <#
      Returns a hashtable keyed by numeric RFC id whose values are per-status
      counts, e.g. @{ Verified = 16; Reported = 7; 'Held for Document Update' = 12 }.

      Only the RFCs in -Numbers are retained so the caller does not hold the
      whole 9 MB feed in memory.
    #>
    param(
        [Parameter(Mandatory)][string[]]$Numbers,
        [int]$CacheHours = 12
    )

    $path = Get-RfcCachedFile -Url $script:RfcErrataUrl -CacheName 'errata.json' -CacheHours $CacheHours
    $wanted = @{}
    foreach ($n in $Numbers) { $wanted[$n] = $true }

    $all = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json

    $summary = @{}
    foreach ($n in $Numbers) { $summary[$n] = @{} }

    foreach ($item in $all) {
        # The feed spells this 'doc-id' (hyphen), NOT 'doc_id'. Getting it wrong
        # silently yields zero errata for every RFC rather than an error, so the
        # gate would report "no new errata" forever. Verified 2026-07-29 against
        # https://www.rfc-editor.org/errata.json (7,981 entries).
        $doc = [string]$item.'doc-id'
        if ($doc -notmatch '^RFC(?<num>\d+)$') { continue }
        $num = [string]([int]$Matches['num'])
        if (-not $wanted.ContainsKey($num)) { continue }

        $status = [string]$item.errata_status_code
        if ([string]::IsNullOrWhiteSpace($status)) { $status = 'Unknown' }
        if (-not $summary[$num].ContainsKey($status)) { $summary[$num][$status] = 0 }
        $summary[$num][$status]++
    }
    return $summary
}

function Get-RfcTextUrl { param([Parameter(Mandatory)][string]$Number); return ($script:RfcTextUrlFormat -f $Number) }
function Get-RfcInfoUrl { param([Parameter(Mandatory)][string]$Number); return ($script:RfcInfoUrlFormat -f $Number) }
function Get-RfcErrataUrl { param([Parameter(Mandatory)][string]$Number); return ($script:RfcErrataUrlFormat -f $Number) }

function Get-RfcFileHash {
    <#
      SHA-256 over the file's BYTES with CRLF normalised to LF, so a mirror that
      was checked out with core.autocrlf=true still matches the upstream hash.
      Without this the gate would fire on every Windows clone.
    #>
    param([Parameter(Mandatory)][string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $text = [System.Text.Encoding]::UTF8.GetString($bytes) -replace "`r`n", "`n"
    $normalised = [System.Text.Encoding]::UTF8.GetBytes($text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (($sha.ComputeHash($normalised) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $sha.Dispose()
    }
}
