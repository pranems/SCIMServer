param([Parameter(Mandatory)][string]$BaseUrl)
$ErrorActionPreference = 'Stop'
if (([uri]$BaseUrl).Host -ne '127.0.0.1') { throw 'Local disposable smoke target required.' }
if (-not $env:SCIM_P5_SMOKE_SECRET) { throw 'Smoke credential must be supplied in memory.' }
$script:passed = 0
$script:failed = 0
function Test-Result {
    param([bool]$Success, [string]$Message)
    if ($Success) { $script:passed++ } else { $script:failed++; Write-Host "FAIL: $Message" }
}
. "$PSScriptRoot\..\live-test-sections\search-contract.ps1"
Invoke-ScimSearchContractTests -BaseUrl $BaseUrl -Headers @{ Authorization = "Bearer $env:SCIM_P5_SMOKE_SECRET" }
Write-Host "Search live assertions: $script:passed passed, $script:failed failed"
if ($script:failed) { exit 1 }
