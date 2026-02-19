<#
.SYNOPSIS
    Remote log access for SCIMServer instances (Azure Container Apps / Docker / localhost).

.DESCRIPTION
    Provides four modes for accessing SCIMServer logs remotely via the admin API:

    1. tail    — Real-time SSE log stream (like 'tail -f')
    2. recent  — Fetch the last N log entries from the in-memory ring buffer
    3. download — Download logs as a .ndjson or .json file
    4. config  — View or update the runtime log configuration

.PARAMETER Mode
    Operation mode: tail | recent | download | config

.PARAMETER BaseUrl
    SCIMServer base URL (e.g. https://scimserver.azurecontainerapps.io)
    Default: http://localhost:8080

.PARAMETER Token
    OAuth Bearer token for authenticated access (optional, depends on your auth config)

.PARAMETER Level
    Minimum log level filter: TRACE, DEBUG, INFO, WARN, ERROR, FATAL

.PARAMETER Category
    Log category filter: http, auth, scim.user, scim.group, scim.patch, scim.filter,
    scim.discovery, endpoint, database, backup, oauth, general

.PARAMETER EndpointId
    Filter logs for a specific SCIM endpoint ID

.PARAMETER RequestId
    Filter recent logs by correlation request ID

.PARAMETER Limit
    Max entries for 'recent' or 'download' modes (default: 100)

.PARAMETER Format
    Output format for 'download' mode: ndjson (default) | json

.PARAMETER OutputFile
    File path for 'download' mode. Auto-generated if not specified.

.PARAMETER ConfigUpdate
    JSON string for updating log config (used with -Mode config -Action update)

.PARAMETER Action
    For 'config' mode: get (default) | update | trace | debug | info | warn

.EXAMPLE
    # Tail live logs (all levels)
    .\remote-logs.ps1 -Mode tail -BaseUrl https://myapp.azurecontainerapps.io

.EXAMPLE
    # Tail only WARN+ logs for the auth category
    .\remote-logs.ps1 -Mode tail -BaseUrl https://myapp.azurecontainerapps.io -Level WARN -Category auth

.EXAMPLE
    # Get recent 50 ERROR+ entries
    .\remote-logs.ps1 -Mode recent -Level ERROR -Limit 50

.EXAMPLE
    # Download all logs as NDJSON file
    .\remote-logs.ps1 -Mode download -BaseUrl https://myapp.azurecontainerapps.io

.EXAMPLE
    # Set global log level to TRACE for debugging
    .\remote-logs.ps1 -Mode config -Action trace -BaseUrl https://myapp.azurecontainerapps.io

.EXAMPLE
    # Update full config
    .\remote-logs.ps1 -Mode config -Action update -ConfigUpdate '{"globalLevel":"DEBUG","includePayloads":true}'
#>

param(
    [Parameter(Mandatory)]
    [ValidateSet('tail', 'recent', 'download', 'config')]
    [string]$Mode,

    [string]$BaseUrl = 'http://localhost:8080',

    [string]$Token,

    [ValidateSet('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', '')]
    [string]$Level,

    [string]$Category,
    [string]$EndpointId,
    [string]$RequestId,
    [int]$Limit = 100,

    [ValidateSet('ndjson', 'json', '')]
    [string]$Format = 'ndjson',

    [string]$OutputFile,
    [string]$ConfigUpdate,

    [ValidateSet('get', 'update', 'trace', 'debug', 'info', 'warn', 'error', '')]
    [string]$Action = 'get'
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

# ── Mode: tail (SSE stream) ─────────────────────────────────────────

function Invoke-Tail {
    Write-Step "Live log stream (SSE) — press Ctrl+C to stop"

    $qs = @()
    if ($Level)      { $qs += "level=$Level" }
    if ($Category)   { $qs += "category=$Category" }
    if ($EndpointId) { $qs += "endpointId=$EndpointId" }
    $url = "$AdminBase/stream"
    if ($qs.Count -gt 0) { $url += "?" + ($qs -join '&') }

    Write-Info "URL: $url"
    Write-Info "Filters: level=$($Level ?? 'ALL'), category=$($Category ?? 'ALL'), endpoint=$($EndpointId ?? 'ALL')"
    Write-Host ""

    # Use curl for SSE streaming (Invoke-WebRequest doesn't support streaming well)
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

                    $color = switch ($entry.level) {
                        'TRACE' { 'DarkGray' }
                        'DEBUG' { 'Cyan' }
                        'INFO'  { 'Green' }
                        'WARN'  { 'Yellow' }
                        'ERROR' { 'Red' }
                        'FATAL' { 'Magenta' }
                        default { 'White' }
                    }

                    Write-Host "$ts " -NoNewline
                    Write-Host "$lvl " -ForegroundColor $color -NoNewline
                    Write-Host "$cat$reqId$dur " -NoNewline -ForegroundColor DarkGray
                    Write-Host $entry.message

                    if ($entry.error) {
                        Write-Host "         ERROR: $($entry.error.message)" -ForegroundColor Red
                    }
                }
                catch {
                    # Non-JSON data line — print raw
                    Write-Host $json -ForegroundColor DarkGray
                }
            }
            elseif ($line.StartsWith('event: connected')) {
                Write-Ok "Connected to log stream"
            }
            elseif ($line.StartsWith(':')) {
                # SSE comment / keep-alive ping — ignore
            }
            elseif ($line.Trim()) {
                Write-Host $line -ForegroundColor DarkGray
            }
        }
    }
    catch {
        if ($_.Exception.Message -match 'canceled|interrupt') {
            Write-Host "`n" ; Write-Ok "Stream disconnected"
        } else {
            Write-Err "Stream error: $($_.Exception.Message)"
        }
    }
}

# ── Mode: recent ────────────────────────────────────────────────────

function Invoke-Recent {
    Write-Step "Fetching recent log entries"

    $qs = @("limit=$Limit")
    if ($Level)      { $qs += "level=$Level" }
    if ($Category)   { $qs += "category=$Category" }
    if ($RequestId)  { $qs += "requestId=$RequestId" }
    if ($EndpointId) { $qs += "endpointId=$EndpointId" }
    $url = "$AdminBase/recent?" + ($qs -join '&')

    Write-Info "URL: $url"

    $response = Invoke-RestMethod -Uri $url -Headers (Get-Headers) -Method Get
    Write-Ok "Retrieved $($response.count) entries"
    Write-Host ""

    foreach ($entry in $response.entries) {
        $ts = ($entry.timestamp -split 'T')[1].Substring(0, 12)
        $lvl = $entry.level.PadRight(5)
        $cat = $entry.category.PadRight(14)
        $reqId = if ($entry.requestId) { " [$($entry.requestId.Substring(0, 8))]" } else { '' }
        $dur = if ($entry.durationMs) { " +$($entry.durationMs)ms" } else { '' }

        $color = switch ($entry.level) {
            'TRACE' { 'DarkGray' }
            'DEBUG' { 'Cyan' }
            'INFO'  { 'Green' }
            'WARN'  { 'Yellow' }
            'ERROR' { 'Red' }
            'FATAL' { 'Magenta' }
            default { 'White' }
        }

        Write-Host "$ts " -NoNewline
        Write-Host "$lvl " -ForegroundColor $color -NoNewline
        Write-Host "$cat$reqId$dur " -NoNewline -ForegroundColor DarkGray
        Write-Host $entry.message

        if ($entry.error) {
            Write-Host "         ERROR: $($entry.error.message)" -ForegroundColor Red
            if ($entry.error.stack) {
                Write-Host "         $($entry.error.stack)" -ForegroundColor DarkRed
            }
        }

        if ($entry.data) {
            Write-Host "         $($entry.data | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
        }
    }
}

# ── Mode: download ──────────────────────────────────────────────────

function Invoke-Download {
    Write-Step "Downloading log file"

    $qs = @("limit=$Limit", "format=$Format")
    if ($Level)      { $qs += "level=$Level" }
    if ($Category)   { $qs += "category=$Category" }
    if ($RequestId)  { $qs += "requestId=$RequestId" }
    if ($EndpointId) { $qs += "endpointId=$EndpointId" }
    $url = "$AdminBase/download?" + ($qs -join '&')

    if (-not $OutputFile) {
        $timestamp = (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
        $ext = if ($Format -eq 'json') { 'json' } else { 'ndjson' }
        $OutputFile = "scimserver-logs-$timestamp.$ext"
    }

    Write-Info "URL: $url"
    Write-Info "Output: $OutputFile"

    $headers = Get-Headers
    Invoke-WebRequest -Uri $url -Headers $headers -Method Get -OutFile $OutputFile

    $size = (Get-Item $OutputFile).Length
    $lines = (Get-Content $OutputFile | Measure-Object).Count
    Write-Ok "Downloaded $lines entries ($([math]::Round($size / 1024, 1)) KB) → $OutputFile"
}

# ── Mode: config ────────────────────────────────────────────────────

function Invoke-Config {
    $headers = Get-Headers
    $headers['Content-Type'] = 'application/json'

    switch ($Action) {
        'get' {
            Write-Step "Current log configuration"
            $config = Invoke-RestMethod -Uri $AdminBase -Headers $headers -Method Get
            Write-Host ($config | ConvertTo-Json -Depth 4) -ForegroundColor Cyan
        }
        'update' {
            if (-not $ConfigUpdate) {
                Write-Err "Provide -ConfigUpdate with JSON body"
                Write-Info 'Example: -ConfigUpdate ''{"globalLevel":"DEBUG","includePayloads":true}'''
                return
            }
            Write-Step "Updating log configuration"
            $result = Invoke-RestMethod -Uri $AdminBase -Headers $headers -Method Put -Body $ConfigUpdate
            Write-Ok $result.message
            Write-Host ($result.config | ConvertTo-Json -Depth 4) -ForegroundColor Cyan
        }
        { $_ -in 'trace', 'debug', 'info', 'warn', 'error' } {
            $lvl = $Action.ToUpper()
            Write-Step "Setting global log level → $lvl"
            $result = Invoke-RestMethod -Uri "$AdminBase/level/$lvl" -Headers $headers -Method Put
            Write-Ok $result.message
        }
        default {
            Write-Err "Unknown action: $Action"
        }
    }
}

# ── Main dispatch ────────────────────────────────────────────────────

Write-Host "`n═══════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "  SCIMServer Remote Log Access" -ForegroundColor White
Write-Host "  Target: $BaseUrl" -ForegroundColor DarkGray
Write-Host "═══════════════════════════════════════════════════`n" -ForegroundColor DarkCyan

switch ($Mode) {
    'tail'     { Invoke-Tail }
    'recent'   { Invoke-Recent }
    'download' { Invoke-Download }
    'config'   { Invoke-Config }
}

Write-Host ""
