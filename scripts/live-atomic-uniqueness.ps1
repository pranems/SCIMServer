param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [string]$Token = $env:E2E_TOKEN
)
$ErrorActionPreference = 'Stop'
$target = [Uri]$EndpointUrl
if (-not $target.IsLoopback -or $target.Scheme -ne 'http' -or -not $Token) {
    throw 'This smoke requires a task-owned loopback endpoint and explicit token.'
}
. "$PSScriptRoot\live-test-sections\atomic-uniqueness.ps1"
$count = Invoke-ScimAtomicUniquenessContract -EndpointUrl $EndpointUrl -Headers @{ Authorization = "Bearer $Token" }
Write-Output "atomic uniqueness live contract: $count assertions passed"
