<#
.SYNOPSIS
    Manage per-endpoint log level overrides on a SCIMServer instance.

.DESCRIPTION
    Convenience script to set, get, or clear per-endpoint log level overrides
    via the SCIMServer admin API. Supports:

    1. set   - Set endpoint log level (DEBUG, TRACE, INFO, WARN, ERROR)
    2. get   - Show current log config (highlights endpoint overrides)
    3. clear - Remove endpoint override (reverts to global level)
    4. tail  - Live-stream logs filtered to a specific endpoint

.PARAMETER Action
    Operation: set | get | clear | tail

.PARAMETER EndpointId
    SCIM endpoint UUID (required for set, clear, tail)

.PARAMETER Level
    Log level to set: TRACE, DEBUG, INFO, WARN, ERROR, FATAL

.PARAMETER BaseUrl
    SCIMServer base URL. Default: http://localhost:8080

.PARAMETER Token
    Bearer token for admin API authentication

.PARAMETER Limit
    Max entries for 'get' recent logs (default: 50)

.EXAMPLE
    # Enable DEBUG for a specific endpoint
    .\endpoint-log.ps1 -Action set -EndpointId 469ddc1b-6444-4472-a646-9b152bdb0dac -Level DEBUG

.EXAMPLE
    # Show current config with all endpoint overrides
    .\endpoint-log.ps1 -Action get

.EXAMPLE
    # Clear endpoint override (revert to global)
    .\endpoint-log.ps1 -Action clear -EndpointId 469ddc1b-6444-4472-a646-9b152bdb0dac

.EXAMPLE
    # Live-tail logs for one endpoint only
    .\endpoint-log.ps1 -Action tail -EndpointId 469ddc1b-6444-4472-a646-9b152bdb0dac

.EXAMPLE
    # Set DEBUG on Azure prod
    .\endpoint-log.ps1 -Action set -EndpointId 469ddc1b-... -Level DEBUG `
        -BaseUrl https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io `
        -Token changeme-scim
#>

param(
    [Parameter(Mandatory)]
    [ValidateSet('set', 'get', 'clear', 'tail')]
    [string]$Action,

    [string]$EndpointId,

    [ValidateSet('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', '')]
    [string]$Level,

    [string]$BaseUrl = 'http://localhost:8080',

    [string]$Token,

    [int]$Limit = 50
)

$ErrorActionPreference = 'Stop'

# ── Helpers ──────────────────────────────────────────────────────────

function Write-Info  { param([string]$msg) Write-Host "   ℹ️  $msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "   ✅ $msg" -ForegroundColor Green }
function Write-Err   { param([string]$msg) Write-Host "   ❌ $msg" -ForegroundColor Red }
function Write-Step  { param([string]$msg) Write-Host "`n🔹 $msg" -ForegroundColor Yellow }

$AdminBase = "$($BaseUrl.TrimEnd('/'))/scim/admin/log-config"

function Get-Headers {
    $h = @{ 'Accept' = 'application/json' }
    if ($Token) { $h['Authorization'] = "Bearer $Token" }
    return $h
}

function Assert-EndpointId {
    if (-not $EndpointId) {
        Write-Err "EndpointId is required for '$Action' action."
        Write-Info "Usage: .\endpoint-log.ps1 -Action $Action -EndpointId <uuid>"
        exit 1
    }
    # Validate UUID format
    if ($EndpointId -notmatch '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
        Write-Err "Invalid EndpointId format. Expected UUID (e.g. 469ddc1b-6444-4472-a646-9b152bdb0dac)"
        exit 1
    }
}

# ── Action: set ──────────────────────────────────────────────────────

function Invoke-Set {
    Assert-EndpointId
    if (-not $Level) {
        Write-Err "Level is required for 'set' action."
        Write-Info "Usage: .\endpoint-log.ps1 -Action set -EndpointId <uuid> -Level DEBUG"
        exit 1
    }

    $lvl = $Level.ToLower()
    $url = "$AdminBase/endpoint/$EndpointId/$lvl"

    Write-Step "Setting endpoint log level"
    Write-Info "Endpoint: $EndpointId"
    Write-Info "Level:    $($Level.ToUpper())"
    Write-Info "URL:      PUT $url"

    $headers = Get-Headers
    $headers['Content-Type'] = 'application/json'

    try {
        $result = Invoke-RestMethod -Uri $url -Headers $headers -Method Put
        Write-Ok "Endpoint log level set to $($Level.ToUpper())"
        if ($result.message) { Write-Info $result.message }

        # Show updated config
        Write-Step "Updated configuration"
        $config = Invoke-RestMethod -Uri $AdminBase -Headers (Get-Headers) -Method Get
        Show-EndpointOverrides $config
    }
    catch {
        Write-Err "Failed: $($_.Exception.Message)"
        if ($_.ErrorDetails.Message) {
            Write-Host "   Response: $($_.ErrorDetails.Message)" -ForegroundColor DarkRed
        }
        exit 1
    }
}

# ── Action: get ──────────────────────────────────────────────────────

function Show-EndpointOverrides {
    param($config)

    $global = if ($config.globalLevel) { $config.globalLevel.ToUpper() } else { 'INFO' }
    Write-Host ""
    Write-Host "   Global level: " -NoNewline
    Write-Host $global -ForegroundColor (Get-LevelColor $global)

    $epLevels = $config.endpointLevels
    if ($epLevels -and ($epLevels | Get-Member -MemberType NoteProperty | Measure-Object).Count -gt 0) {
        Write-Host ""
        Write-Host "   Endpoint overrides:" -ForegroundColor White
        foreach ($prop in $epLevels | Get-Member -MemberType NoteProperty) {
            $id = $prop.Name
            $lvl = $epLevels.$id.ToUpper()
            Write-Host "     $id → " -NoNewline -ForegroundColor DarkGray
            Write-Host $lvl -ForegroundColor (Get-LevelColor $lvl)
        }
    }
    else {
        Write-Host "   Endpoint overrides: (none)" -ForegroundColor DarkGray
    }

    $catLevels = $config.categoryLevels
    if ($catLevels -and ($catLevels | Get-Member -MemberType NoteProperty | Measure-Object).Count -gt 0) {
        Write-Host ""
        Write-Host "   Category overrides:" -ForegroundColor White
        foreach ($prop in $catLevels | Get-Member -MemberType NoteProperty) {
            $cat = $prop.Name
            $lvl = $catLevels.$cat.ToUpper()
            Write-Host "     $($cat.PadRight(16)) → " -NoNewline -ForegroundColor DarkGray
            Write-Host $lvl -ForegroundColor (Get-LevelColor $lvl)
        }
    }
}

function Get-LevelColor {
    param([string]$lvl)
    switch ($lvl) {
        'TRACE' { 'DarkGray' }
        'DEBUG' { 'Cyan' }
        'INFO'  { 'Green' }
        'WARN'  { 'Yellow' }
        'ERROR' { 'Red' }
        'FATAL' { 'Magenta' }
        default { 'White' }
    }
}

function Invoke-Get {
    Write-Step "Current log configuration"

    try {
        $config = Invoke-RestMethod -Uri $AdminBase -Headers (Get-Headers) -Method Get
        Show-EndpointOverrides $config
        Write-Host ""
        Write-Host "   Full config:" -ForegroundColor White
        Write-Host ($config | ConvertTo-Json -Depth 4) -ForegroundColor DarkGray
    }
    catch {
        Write-Err "Failed: $($_.Exception.Message)"
        exit 1
    }
}

# ── Action: clear ────────────────────────────────────────────────────

function Invoke-Clear {
    Assert-EndpointId

    $url = "$AdminBase/endpoint/$EndpointId"

    Write-Step "Clearing endpoint log level override"
    Write-Info "Endpoint: $EndpointId"
    Write-Info "URL:      DELETE $url"

    try {
        Invoke-RestMethod -Uri $url -Headers (Get-Headers) -Method Delete
        Write-Ok "Endpoint override removed - reverted to global level"

        # Show updated config
        Write-Step "Updated configuration"
        $config = Invoke-RestMethod -Uri $AdminBase -Headers (Get-Headers) -Method Get
        Show-EndpointOverrides $config
    }
    catch {
        Write-Err "Failed: $($_.Exception.Message)"
        if ($_.ErrorDetails.Message) {
            Write-Host "   Response: $($_.ErrorDetails.Message)" -ForegroundColor DarkRed
        }
        exit 1
    }
}

# ── Action: tail ─────────────────────────────────────────────────────

function Invoke-Tail {
    Assert-EndpointId

    $qs = @("endpointId=$EndpointId")
    if ($Level) { $qs += "level=$Level" }
    $url = "$AdminBase/stream?" + ($qs -join '&')

    Write-Step "Live log stream for endpoint - press Ctrl+C to stop"
    Write-Info "Endpoint: $EndpointId"
    Write-Info "Level:    $($Level ?? 'ALL')"
    Write-Info "URL:      $url"
    Write-Host ""

    $curlArgs = @('-N', '-s', $url)
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }

    try {
        & curl @curlArgs | ForEach-Object {
            $line = $_
            if ($line.StartsWith('data: ')) {
                $json = $line.Substring(6)
                try {
                    $entry = $json | ConvertFrom-Json
                    $ts = ($entry.timestamp -split 'T')[1].Substring(0, 12)
                    $lvl = $entry.level.PadRight(5)
                    $cat = $entry.category.PadRight(14)
                    $reqId = if ($entry.requestId) { " [$($entry.requestId.Substring(0, 8))]" } else { '' }
                    $dur = if ($entry.durationMs) { " +$($entry.durationMs)ms" } else { '' }

                    $color = Get-LevelColor $entry.level

                    Write-Host "$ts " -NoNewline
                    Write-Host "$lvl " -ForegroundColor $color -NoNewline
                    Write-Host "$cat$reqId$dur " -NoNewline -ForegroundColor DarkGray
                    Write-Host $entry.message

                    if ($entry.error) {
                        Write-Host "         ERROR: $($entry.error.message)" -ForegroundColor Red
                    }
                }
                catch {
                    Write-Host $json -ForegroundColor DarkGray
                }
            }
            elseif ($line.StartsWith('event: connected')) {
                Write-Ok "Connected to log stream"
            }
            elseif ($line.StartsWith(':')) {
                # SSE keep-alive - ignore
            }
            elseif ($line.Trim()) {
                Write-Host $line -ForegroundColor DarkGray
            }
        }
    }
    catch {
        if ($_.Exception.Message -match 'canceled|interrupt') {
            Write-Host "`n" ; Write-Ok "Stream disconnected"
        }
        else {
            Write-Err "Stream error: $($_.Exception.Message)"
        }
    }
}

# ── Main dispatch ────────────────────────────────────────────────────

Write-Host "`n═══════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "  SCIMServer Endpoint Log Manager" -ForegroundColor White
Write-Host "  Target: $BaseUrl" -ForegroundColor DarkGray
Write-Host "═══════════════════════════════════════════════════`n" -ForegroundColor DarkCyan

switch ($Action) {
    'set'   { Invoke-Set }
    'get'   { Invoke-Get }
    'clear' { Invoke-Clear }
    'tail'  { Invoke-Tail }
}

Write-Host ""
