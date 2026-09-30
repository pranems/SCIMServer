$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

$headers = @{ Authorization = "Bearer $env:OWNED_LIVE_TOKEN" }
$script:results = [System.Collections.Generic.List[object]]::new()
function Test-Result {
    param([bool]$Success, [string]$Message)
    $script:results.Add([pscustomobject]@{
        section = $script:currentSection
        success = $Success
        message = $Message
    })
}

. (Join-Path $root 'scripts\live-test-sections\correctness-contracts.ps1')
Invoke-ScimCorrectnessContractTests -BaseUrl $env:OWNED_LIVE_BASE -Headers $headers

$script:currentSection = '9z-DF: P7b PATCH/schema contracts'
$oldBase = $env:SCIM_LIVE_BASE_URL
$oldToken = $env:SCIM_LIVE_TOKEN
try {
    $env:SCIM_LIVE_BASE_URL = $env:OWNED_LIVE_BASE
    $env:SCIM_LIVE_TOKEN = $env:OWNED_LIVE_TOKEN
    $result = & node (Join-Path $PSScriptRoot 'patch-schema.cjs')
    if ($LASTEXITCODE -ne 0) {
        throw 'P7b PATCH/schema contract process failed.'
    }
    $receipt = $result | ConvertFrom-Json -ErrorAction Stop
    Test-Result `
        -Success ($receipt.cases -eq 153 -and $receipt.assertions -eq 905 -and $receipt.endpointCollectionUnchanged) `
        -Message '9z-DF: 153 P7b PATCH/schema cases / 905 assertions'
} catch {
    Test-Result -Success $false -Message "9z-DF: P7b PATCH/schema contracts failed: $($_.Exception.Message)"
} finally {
    $env:SCIM_LIVE_BASE_URL = $oldBase
    $env:SCIM_LIVE_TOKEN = $oldToken
}

$failures = @($script:results | Where-Object { -not $_.success })
@{
    passed = $script:results.Count - $failures.Count
    failed = $failures.Count
    checks = $script:results
} | ConvertTo-Json -Depth 10 | Set-Content $env:OWNED_LIVE_RECEIPT

if ($failures.Count) {
    exit 1
}
