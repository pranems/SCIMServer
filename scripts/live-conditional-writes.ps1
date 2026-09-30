param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [string]$Token = $env:E2E_TOKEN
)
$ErrorActionPreference = 'Stop'
$target = [Uri]$EndpointUrl
if (-not $target.IsLoopback -or $target.Scheme -ne 'http' -or -not $Token) {
    throw 'This owned-runtime smoke requires an explicit loopback HTTP endpoint and token.'
}
. "$PSScriptRoot\live-test-sections\conditional-writes.ps1"
$count = Invoke-ScimConditionalWriteContract -EndpointUrl $EndpointUrl -Headers @{ Authorization = "Bearer $Token" }
Write-Output "conditional live contract: $count assertions passed"
