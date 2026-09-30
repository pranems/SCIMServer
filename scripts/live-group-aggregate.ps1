param(
    [Parameter(Mandatory)][string]$EndpointUrl,
    [string]$Token = $env:E2E_TOKEN
)
$ErrorActionPreference = 'Stop'
$target = [Uri]$EndpointUrl
if (-not $target.IsLoopback -or $target.Scheme -ne 'http' -or -not $Token -or
    $target.AbsolutePath -notmatch '^/scim/v2/endpoints/[a-fA-F0-9-]{36}/?$' -or
    $target.Query -or $target.Fragment -or $target.UserInfo) {
    throw 'Requires an explicit owned loopback HTTP endpoint and token, with no query, fragment or user info.'
}
. "$PSScriptRoot\live-test-sections\group-aggregate.ps1"
$count = Invoke-ScimGroupAggregateContract -EndpointUrl $EndpointUrl -Headers @{ Authorization = "Bearer $Token" }
Write-Output "group aggregate live contract: $count assertions passed"
