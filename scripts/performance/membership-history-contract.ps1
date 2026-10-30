param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'scripts\live-test-sections\minimal-group-members.ps1')
$script:outcomes = 0
function Test-Result {
    param([bool]$Success, [string]$Message)
    if (!$Success) { throw "Private runtime contract failed: $Message" }
    $script:outcomes++
}
$null = Invoke-MinimalGroupMembersContract -BaseUrl $BaseUrl `
    -Headers @{ Authorization = "Bearer $env:SCIM_SHARED_SECRET" }
if ($script:outcomes -ne 66) { throw 'Incomplete original 66-outcome runtime contract.' }
@{ diagnosticOnly = $true; assertions = $script:outcomes; complete = $true } |
    ConvertTo-Json | Set-Content -LiteralPath $OutputPath
