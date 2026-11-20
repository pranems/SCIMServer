param(
    [string]$Scenario,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$verifier = Join-Path $root 'scripts\verify-deployment.ps1'

if ($Scenario) {
    $id = '00000000-0000-4000-8000-000000000001'
    $endpoint = [pscustomobject]@{ id = $id; name = 'offline fixture'; profilePreset = 'default' }
    $baseline = @{
        countBasis = 'stored-user-group-v1'
        endpointCount = 1
        endpoints = @(@{ id = $id; name = 'offline fixture'; userCount = 0; groupCount = 0 })
    }
    $beforePath = Join-Path $OutputDirectory 'before[contract].json'
    $arguments = @{
        BaseUrl = 'https://offline.invalid'
        Label = 'contract'
        ReportDir = $OutputDirectory
        SnapshotOnly = $true
    }
    if ($Scenario -like 'baseline-*' -or $Scenario -in @('unchanged', 'nonzero', 'decrease', 'increase', 'group-decrease', 'group-increase', 'replacement', 'renamed', 'empty-unchanged', 'user-only')) {
        switch ($Scenario) {
            'baseline-missing' { }
            'baseline-empty-path' { $beforePath = '' }
            'baseline-directory' { New-Item -ItemType Directory -Path $beforePath | Out-Null }
            'baseline-json' { '{broken' | Set-Content -LiteralPath $beforePath }
            default {
                switch ($Scenario) {
                    'baseline-null' { $baseline = $null }
                    'baseline-root-array' { $baseline = @($baseline) }
                    'baseline-basis-missing' { $baseline.Remove('countBasis') }
                    'baseline-basis-visible' { $baseline.countBasis = 'scim-visible-user-group-v1' }
                    'baseline-basis-unknown' { $baseline.countBasis = 'unknown' }
                    'baseline-count-missing' { $baseline.Remove('endpointCount') }
                    'baseline-count-string' { $baseline.endpointCount = '1' }
                    'baseline-count-mismatch' { $baseline.endpointCount = 2 }
                    'baseline-endpoints-missing' { $baseline.Remove('endpoints') }
                    'baseline-endpoints-object' { $baseline.endpoints = $baseline.endpoints[0] }
                    'baseline-id-missing' { $baseline.endpoints[0].Remove('id') }
                    'baseline-id-invalid' { $baseline.endpoints[0].id = 'not-an-id' }
                    'baseline-duplicate' { $baseline.endpoints += $baseline.endpoints[0]; $baseline.endpointCount = 2 }
                    'baseline-user-null' { $baseline.endpoints[0].userCount = $null }
                    'baseline-user-missing' { $baseline.endpoints[0].Remove('userCount') }
                    'baseline-group-string' { $baseline.endpoints[0].groupCount = '0' }
                    'baseline-group-negative' { $baseline.endpoints[0].groupCount = -1 }
                    'decrease' { $baseline.endpoints[0].userCount = 1 }
                    'group-decrease' { $baseline.endpoints[0].groupCount = 1 }
                    'nonzero' { $baseline.endpoints[0].userCount = 3; $baseline.endpoints[0].groupCount = 7 }
                    'user-only' { $baseline.endpoints[0].groupCount = 4 }
                    'empty-unchanged' { $baseline.endpointCount = 0; $baseline.endpoints = @() }
                }
                ConvertTo-Json -InputObject $baseline -Depth 8 | Set-Content -LiteralPath $beforePath
            }
        }
        $arguments.BeforeSnapshot = $beforePath
    }
    if ($Scenario -eq 'full-selected-health-only') {
        $arguments.Remove('SnapshotOnly')
        $arguments.RunLiveTests = $false
    }

    function Invoke-RestMethod {
        param($Uri, $Method, $Body, $ContentType, $TimeoutSec, $Headers, $ErrorAction)
        Add-Content -LiteralPath (Join-Path $OutputDirectory 'requests.txt') -Value $Uri
        if ($Method -and $Method -notin @('Get', 'Post')) { throw 'Unexpected mutating request' }
        if ($Uri -like '*/health') {
            if ($Scenario -eq 'health-failure') { throw 'offline health failure' }
            return @{ status = 'ok' }
        }
        if ($Uri -like '*/oauth/token') { return @{ access_token = 'offline-contract-token' } }
        if ($Headers.Authorization -cne ('Bearer ' + 'offline-contract-token')) { throw 'Missing bearer header' }
        if ($Uri -eq 'https://offline.invalid/scim/admin/endpoints' -or $Uri -like '*/admin/endpoints?count=*') {
            $response = @{ totalResults = 1; endpoints = @($endpoint) }
            switch ($Scenario) {
                'inventory-failure' { throw 'offline inventory failure' }
                'inventory-incomplete' { $response.totalResults = 2 }
                'inventory-null' { $response.totalResults = $null }
                'inventory-missing' { $response.Remove('totalResults') }
                'inventory-string' { $response.totalResults = '1' }
                'inventory-endpoints-missing' { $response.Remove('endpoints') }
                'inventory-endpoints-object' { $response.endpoints = $endpoint }
                'inventory-duplicate' { $response.endpoints += $endpoint; $response.totalResults = 2 }
                'inventory-id-invalid' { $endpoint.id = 'invalid' }
                'replacement' { $endpoint.id = '00000000-0000-4000-8000-000000000002' }
                'renamed' { $endpoint.name = 'renamed offline fixture' }
                'empty' { $response.totalResults = 0; $response.endpoints = @() }
                'empty-unchanged' { $response.totalResults = 0; $response.endpoints = @() }
                'large' {
                    $response.endpoints = @(1..201 | ForEach-Object {
                        [pscustomobject]@{ id = ('00000000-0000-4000-8000-{0:d12}' -f $_); name = 'offline fixture' }
                    })
                    $response.totalResults = 201
                }
            }
            return [pscustomobject]$response
        }
        if ($Uri -like '*/ResourceTypes') {
            return @{ totalResults = 1; Resources = @(@{ id = 'User'; name = 'User'; endpoint = '/Users' }) }
        }
        if ($Uri -notmatch '/scim/admin/endpoints/[0-9a-f-]{36}/stats$') {
            throw 'SCIM visibility is not the authoritative stored-resource measurement path; Group may not be published.'
        }
        if ($Scenario -in @('user-failure', 'group-failure', 'stats-failure')) { throw 'offline stored statistics request failure' }
        $response = @{
            users = @{ total = 0; active = 0; inactive = 0 }
            groups = @{ total = 0; active = 0; inactive = 0 }
        }
        foreach ($family in @('user', 'group')) {
            $counts = $response["${family}s"]
            if ($Scenario -eq 'nonzero') { $counts.total = if ($family -eq 'user') { 3 } else { 7 } }
            if ($Scenario -eq "$family-null") { $counts.total = $null }
            if ($Scenario -eq "$family-missing") { $counts.Remove('total') }
            if ($Scenario -eq "$family-string") { $counts.total = '0' }
            if ($Scenario -eq "$family-boolean") { $counts.total = $false }
            if ($Scenario -eq "$family-array") { $counts.total = @(0) }
            if ($Scenario -eq "$family-object") { $counts.total = @{} }
            if ($Scenario -eq "$family-negative") { $counts.total = -1 }
            if ($Scenario -eq "$family-fraction") { $counts.total = 0.5 }
            if ($Scenario -eq "$family-envelope-missing") { $response.Remove("${family}s") }
            if ($Scenario -eq "$family-envelope-array") { $response["${family}s"] = @($counts) }
        }
        if ($Scenario -eq 'user-only') {
            $response.users.total = 0
            $response.groups.total = 4
        }
        if ($Scenario -eq 'increase') { $response.users.total = 1 }
        if ($Scenario -eq 'group-increase') { $response.groups.total = 1 }
        $response = ConvertTo-Json -InputObject $response -Depth 6 | ConvertFrom-Json
        return [pscustomobject]$response
    }

    if ($Scenario -eq 'user-only') {
        $published = Invoke-RestMethod -Uri "https://offline.invalid/scim/endpoints/$id/ResourceTypes" `
            -Headers @{ Authorization = 'Bearer offline-contract-token' }
        if ($published.totalResults -ne 1 -or $published.Resources[0].id -cne 'User') {
            throw 'User-only fixture must publish User and omit Group.'
        }
    }
    & $verifier @arguments
    exit $LASTEXITCODE
}

$fixture = Join-Path $root ('test-results\verify-deployment-contract-' + [guid]::NewGuid().ToString('N'))
$failures = [System.Collections.Generic.List[string]]::new()
$assertions = 0
function Assert-Contract([bool]$Condition, [string]$Message) {
    $script:assertions++
    if ($Condition) { Write-Host "PASS: $Message" }
    else { $failures.Add($Message); Write-Host "FAIL: $Message" }
}

try {
    New-Item -ItemType Directory -Path $fixture | Out-Null
    $cases = @('user-failure', 'group-failure')
    foreach ($family in @('user', 'group')) {
        foreach ($bad in @('null', 'missing', 'string', 'negative', 'fraction', 'boolean', 'array', 'object', 'envelope-missing', 'envelope-array')) { $cases += "$family-$bad" }
    }
    $cases += @(
        'inventory-failure', 'inventory-incomplete', 'inventory-null', 'inventory-missing',
        'inventory-string', 'inventory-endpoints-missing', 'inventory-endpoints-object',
        'inventory-duplicate', 'inventory-id-invalid',
        'baseline-missing', 'baseline-empty-path', 'baseline-directory', 'baseline-json', 'baseline-null', 'baseline-root-array', 'baseline-count-missing',
        'baseline-basis-missing', 'baseline-basis-visible', 'baseline-basis-unknown',
        'baseline-count-string', 'baseline-count-mismatch', 'baseline-endpoints-missing',
        'baseline-endpoints-object', 'baseline-id-missing', 'baseline-id-invalid',
        'baseline-duplicate', 'baseline-user-null', 'baseline-user-missing',
        'baseline-group-string', 'baseline-group-negative',
        'decrease', 'increase', 'group-decrease', 'group-increase', 'replacement', 'health-failure',
        'zero', 'nonzero', 'empty', 'empty-unchanged', 'unchanged', 'renamed', 'large', 'full-selected-health-only',
        'user-only', 'stats-failure'
    )
    foreach ($case in $cases) {
        $directory = Join-Path $fixture $case
        New-Item -ItemType Directory -Path $directory | Out-Null
        $output = & pwsh -NoProfile -File $PSCommandPath -Scenario $case -OutputDirectory $directory 2>&1
        $status = $LASTEXITCODE
        $text = $output -join "`n"
        $success = $case -in @('zero', 'nonzero', 'empty', 'empty-unchanged', 'unchanged', 'renamed', 'large', 'full-selected-health-only', 'user-only')
        $expected = if ($success) { 0 } elseif ($case -like 'baseline-*') { 2 } else { 1 }
        Assert-Contract ($status -eq $expected) "$case returns exit $expected (actual $status)"
        $snapshotPath = Join-Path $directory 'inventory-contract.json'
        if ($case -like 'baseline-*') {
            Assert-Contract ($text -match 'Invalid BeforeSnapshot') "$case reports the requested baseline prerequisite"
            Assert-Contract (-not (Test-Path $snapshotPath) -and -not (Test-Path (Join-Path $directory 'requests.txt'))) "$case fails before measuring or publishing a snapshot"
        } elseif ($case -in @('decrease', 'increase', 'group-decrease', 'group-increase', 'replacement')) {
            Assert-Contract ($text -match 'DATA DELTA DETECTED') "$case reports a measured preservation delta"
        } elseif (-not $success -and $case -match '^(user|group|inventory|stats)-') {
            Assert-Contract ($text -match 'Inventory snapshot failed') "$case reports failed measurement"
            Assert-Contract (-not (Test-Path $snapshotPath)) "$case never publishes unmeasured success"
            if ($case -match '^(user|group|stats)-') {
                $requests = @(Get-Content -LiteralPath (Join-Path $directory 'requests.txt'))
                Assert-Contract (@($requests | Where-Object { $_ -match '/admin/endpoints/[0-9a-f-]{36}/stats$' }).Count -eq 1) "$case exercises the authoritative stored statistics path"
            }
            if ($case -in @('user-failure', 'group-failure', 'inventory-failure')) {
                $context = switch ($case) {
                    'user-failure' { '00000000-0000-4000-8000-000000000001 stored User/Group statistics' }
                    'group-failure' { '00000000-0000-4000-8000-000000000001 stored User/Group statistics' }
                    'inventory-failure' { 'endpoint inventory request' }
                }
                Assert-Contract ($text.Contains("Inventory snapshot failed ($context):")) "$case identifies the failed measurement boundary"
            }
        } elseif ($success) {
            Assert-Contract (Test-Path $snapshotPath) "$case publishes a measured snapshot"
            if (Test-Path $snapshotPath) {
                $snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
                Assert-Contract ($snapshot.countBasis -ceq 'stored-user-group-v1') "$case labels the authoritative stored count basis"
                $expectedCount = if ($case -eq 'large') { 201 } elseif ($case -like 'empty*') { 0 } else { 1 }
                Assert-Contract ($snapshot.endpointCount -eq $expectedCount -and @($snapshot.endpoints).Count -eq $expectedCount) "$case measures all $expectedCount endpoints"
                $expectedUsers = if ($case -eq 'nonzero') { 3 } else { 0 }
                $expectedGroups = if ($case -eq 'nonzero') { 7 } elseif ($case -eq 'user-only') { 4 } else { 0 }
                Assert-Contract (@($snapshot.endpoints | Where-Object { $_.userCount -cne $expectedUsers -or $_.groupCount -cne $expectedGroups }).Count -eq 0) "$case preserves measured integer resource totals ($expectedUsers Users, $expectedGroups Groups)"
            }
            $requests = @(Get-Content -LiteralPath (Join-Path $directory 'requests.txt'))
            Assert-Contract (@($requests | Where-Object { $_ -match '/admin/endpoints\?' }).Count -eq 0) "$case requests the unpaged endpoint inventory"
            $resourceRequests = @($requests | Where-Object { $_ -match '/stats$' })
            Assert-Contract ($resourceRequests.Count -eq $expectedCount -and
                @($requests | Where-Object { $_ -match '/(Users|Groups)\?' }).Count -eq 0) "$case counts stored resources through canonical admin endpoint ID routes, not SCIM visibility"
        }
    }
    $runner = Join-Path $root 'scripts\test-container-runtime.ps1'
    $dispatches = [System.Collections.Generic.List[string]]::new()
    $rejectVerifier = $false
    function pwsh {
        $dispatches.Add($args[-1])
        $global:LASTEXITCODE = if ($rejectVerifier -and $args[-1] -like '*verify-deployment.contract.ps1') { 17 } else { 0 }
    }
    & $runner
    Assert-Contract (@($dispatches | Where-Object { $_ -like '*verify-deployment.contract.ps1' }).Count -eq 1) 'normal offline runtime runner dispatches preservation contracts exactly once'
    $rejectVerifier = $true
    $rejection = $null
    try { & $runner } catch { $rejection = $_.Exception.Message }
    Assert-Contract ($rejection -match 'verify-deployment \(exit 17\)') 'normal offline runtime runner propagates preservation contract failure'
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
Write-Host "Deployment preservation contracts: $assertions assertions, $($assertions - $failures.Count) passed, $($failures.Count) failed."
if ($failures.Count) { exit 1 }
exit 0
