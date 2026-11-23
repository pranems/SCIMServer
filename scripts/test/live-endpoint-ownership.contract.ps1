param([switch]$BaselineRed)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sourcePath = Join-Path $root 'scripts\live-test.ps1'
$source = Get-Content -LiteralPath $sourcePath -Raw
if ($BaselineRed) {
    $source = (git -C $root show '554f42023fdde30918ef378987cc8f3135e4ed3a:scripts/live-test.ps1') -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Pinned baseline is unavailable.' }
}
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'live-test.ps1 must parse before lifecycle controls run.' }
if (-not $BaselineRed -and -not $source.Contains('Initialize-LiveEndpointOwnership')) {
    throw 'RED: actual live runner does not initialize complete original endpoint ownership before creation.'
}

# Project the real functions and every top-level trap, not a replacement trap.
# Replace only the module-qualified transport with in-process mocks.
$firstFunction = $ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] } | Select-Object -First 1
$actualTraps = @($ast.EndBlock.Traps | Where-Object { $null -ne $_ })
$lifecycleNodes = @($ast.EndBlock.Statements) + $actualTraps
$projection = ($lifecycleNodes | Where-Object {
    $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] -or
    $_ -is [System.Management.Automation.Language.TrapStatementAst] -or
    ($_.Extent.StartOffset -lt $firstFunction.Extent.StartOffset -and $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ne '$ErrorActionPreference') -or
    $_.Extent.Text -match '^\. .*live-endpoint-ownership\.ps1'
} | Sort-Object { $_.Extent.StartOffset } | ForEach-Object { $_.Extent.Text }) -join "`n"
$projection = $projection.Replace('Microsoft.PowerShell.Utility\Invoke-RestMethod', 'Invoke-MockRest')
$projection = $projection.Replace('Microsoft.PowerShell.Utility\Invoke-WebRequest', 'Invoke-MockWeb')
$projection = $projection.Replace('$PSScriptRoot', (Join-Path $root 'scripts'))
$original = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
$owned = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
$unknown = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
$script:assertions = 0
function Assert($condition, $message) {
    if (-not $condition) { throw $message }
    $script:assertions++
}
function Expect-Failure([scriptblock]$action, [string]$message) {
    $failed = $false
    try { & $action } catch { $failed = $true }
    Assert $failed $message
}
function Reset-Mock {
    $script:ownedEndpointHandles = @{}
    $script:orphanGuardArmed = $false
    $script:inventory = [pscustomobject]@{ totalResults = 1; endpoints = @([pscustomobject]@{ id = $original; name = 'live-test-original' }) }
    $script:createId = $owned
    $script:createStatus = 201
    $script:deleteStatus = 204
    $script:absenceStatus = 404
    $script:transportFailure = $false
    $script:failOwnedRead = $false
    $script:probeStatus = 404
    $script:probeReuseRejected = $false
    $script:probeUnknownRejected = $false
    $script:endpointRejectionProbe = $null
    $script:calls = [System.Collections.Generic.List[object]]::new()
}
function Invoke-MockRest {
    [CmdletBinding()]
    param($Uri, $Method, $Headers, $Body, $ContentType, [switch]$AllowInsecureRedirect,
        $ResponseHeadersVariable, $StatusCodeVariable)
    $m = if ($Method) { "$Method".ToUpperInvariant() } else { 'GET' }
    $script:calls.Add([pscustomobject]@{ Uri = $Uri; Method = $m; Headers = $Headers; Body = $Body; ContentType = $ContentType; HasContentType = $PSBoundParameters.ContainsKey('ContentType'); ErrorAction = $PSBoundParameters['ErrorAction']; Redirect = $AllowInsecureRedirect })
    $status = 200
    $result = $script:inventory
    if ($script:transportFailure) { throw 'mock transport unavailable' }
    if ($script:failOwnedRead -and $m -eq 'GET' -and $Uri -match $owned) { throw 'injected nested helper interruption' }
    if ($m -eq 'DELETE') { $status = $script:deleteStatus; $result = $null }
    if ($m -eq 'POST') {
        $status = $script:createStatus
        $result = [pscustomobject]@{ id = $script:createId }
    }
    $isProbe = $m -eq 'POST' -and $Uri -match '/00000000-0000-0000-0000-000000000000/(schemas|resource-types)$'
    if ($isProbe) {
        $status = $script:probeStatus
        try { $null = Get-LiveEndpointRequest -Uri $Uri -Method POST } catch { $script:probeReuseRejected = $true }
        try { $null = Get-LiveEndpointRequest -Uri "$baseUrl/scim/admin/endpoints/$unknown/schemas" -Method POST } catch { $script:probeUnknownRejected = $true }
    }
    if ($StatusCodeVariable) { Set-Variable -Name $StatusCodeVariable -Value $status -Scope 1 }
    if ($ResponseHeadersVariable) { Set-Variable -Name $ResponseHeadersVariable -Value @{} -Scope 1 }
    if ($isProbe -and $status -ge 400) {
        $httpResponse = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]$status)
        throw [Microsoft.PowerShell.Commands.HttpResponseException]::new('mock rejection response', $httpResponse)
    }
    return $result
}
function Invoke-MockWeb {
    [CmdletBinding()]
    param($Uri, $Method, $Headers, $Body, $ContentType, [switch]$AllowInsecureRedirect, [switch]$SkipHttpErrorCheck)
    $m = if ($Method) { "$Method".ToUpperInvariant() } else { 'GET' }
    $script:calls.Add([pscustomobject]@{ Uri = $Uri; Method = $m; Headers = $Headers; Body = $Body; ContentType = $ContentType; ErrorAction = $PSBoundParameters['ErrorAction']; Skip = $SkipHttpErrorCheck; Redirect = $AllowInsecureRedirect })
    if ($script:transportFailure) { throw 'mock transport unavailable' }
    $status = if ($m -eq 'DELETE') { $script:deleteStatus } elseif ($m -eq 'POST') { $script:createStatus } else { $script:absenceStatus }
    return [pscustomobject]@{ StatusCode = $status; Headers = @{}; Content = (@{ id = $script:createId } | ConvertTo-Json) }
}
. ([scriptblock]::Create($projection))
$baseUrl = 'http://fixture.invalid'
$headers = @{ Authorization = 'mock-only'; 'X-Sentinel' = 'forwarded' }

if ($BaselineRed) {
    Reset-Mock
    $script:inventory.endpoints += [pscustomobject]@{ id = $unknown; name = 'concurrent-operator-endpoint' }
    $script:inventory.totalResults = 2
    $sweep = $ast.EndBlock.Statements | Where-Object {
        $_ -is [System.Management.Automation.Language.TryStatementAst] -and $_.Extent.Text.Contains('$testEndpoints =')
    }
    if (@($sweep).Count -ne 1) { throw 'Pinned baseline final lifecycle sweep was not found.' }
    . ([scriptblock]::Create($sweep.Extent.Text))
    Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' -and $_.Uri -match $original }).Count -gt 0) 'Baseline reproduction must exercise the actual original-ID delete.'
    Write-Output 'RED: actual pinned baseline final sweep deletes an original live-test-named endpoint.'
    $script:calls.Clear()
    $script:preexistingEndpointIds = @($original)
    $script:orphanGuardArmed = $true
    $script:orphanReconciled = $false
    Invoke-OrphanReconciliation
    Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' -and $_.Uri -match $unknown }).Count -gt 0) 'Baseline reconciliation reproduction must exercise the concurrent unowned delete.'
    Write-Output 'RED: actual pinned baseline reconciliation deletes a concurrent unowned endpoint.'
    $script:orphanGuardArmed = $false
    throw 'RED: both actual baseline cleanup lifecycles violate fixture ownership (mock-only).'
}

Reset-Mock
Initialize-LiveEndpointOwnership
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
$knownCleanupHandle = $script:ownedEndpointHandles[$owned]
$script:inventory.endpoints += [pscustomobject]@{ id = $unknown; name = 'concurrent-unowned' }
$script:inventory.totalResults = 2
$admitted = [System.Collections.Generic.List[string]]::new()
try {
    foreach ($method in @('POST', 'PUT', 'PATCH')) {
        foreach ($wrapper in @('Rest', 'Web')) {
            $rejected = $false
            try {
                if ($wrapper -eq 'Rest') {
                    $null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$unknown/schemas" -Method $method -Headers $headers -Body '{}'
                } else {
                    $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$unknown/schemas" -Method $method -Headers $headers -Body '{}' -SkipHttpErrorCheck
                }
            } catch { $rejected = $true }
            if (-not $rejected) { $admitted.Add("$wrapper $method") }
        }
    }
} finally {
    Invoke-OrphanReconciliation
}
Assert ($knownCleanupHandle.Deleted) 'Unknown mutation negative controls must retain and clean the known-owned finally handle.'
Assert ($admitted.Count -eq 0) "RED: concurrent unknown endpoint mutation reached transport: $($admitted -join ', ')."
Assert (@($script:calls | Where-Object { $_.Uri -match $unknown -and $_.Method -in @('POST','PUT','PATCH') }).Count -eq 0) 'Unknown mutation rejection must occur before transport.'

Reset-Mock
Initialize-LiveEndpointOwnership
$baseline = $script:preexistingEndpointIds
$script:inventory = [pscustomobject]@{ totalResults = 0; endpoints = @() }
Expect-Failure { Initialize-LiveEndpointOwnership } 'An armed baseline must reject reinitialization even before any owned handle exists.'
Assert ([object]::ReferenceEquals($baseline, $script:preexistingEndpointIds) -and $script:preexistingEndpointIds.Contains($original) -and $script:orphanGuardArmed) 'Reinitialization must never erase or disarm the original baseline.'

Reset-Mock
Initialize-LiveEndpointOwnership
Assert $script:orphanGuardArmed 'A complete inventory must arm creation.'
$response = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body '{"name":"owned"}' -ContentType 'application/json' -ErrorAction Stop
Assert ($response.id -eq $owned) 'Creation response must be unchanged.'
Assert ($script:ownedEndpointHandles.ContainsKey($owned.ToUpperInvariant())) 'UUID identity must be case-insensitive.'
$handle = $script:ownedEndpointHandles[$owned]
$script:createId = $original.ToUpperInvariant()
try {
    Expect-Failure { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Original response ID must be rejected before assignment.'
    $script:cleanupId = $owned
    Expect-Failure { $script:cleanupId = (Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers).Content } 'Web original response must reject before teardown assignment.'
    Assert ($script:cleanupId -eq $owned) 'Failed original-ID registration must not alter the caller cleanup target.'
    Assert ([object]::ReferenceEquals($handle, $script:ownedEndpointHandles[$owned])) 'Rejected registration must retain the prior cleanup handle.'
    Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$original" -Method DELETE -Headers $headers } 'Original DELETE must be rejected.'
    Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$unknown" -Method DELETE -Headers $headers } 'Concurrent unowned DELETE must be rejected.'
    Expect-Failure { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$original" -Method PATCH -Headers $headers -Body '{}' } 'Original endpoint mutation must be rejected.'
    Expect-Failure { Invoke-RestMethod -Uri "$baseUrl/scim/endpoints/$original/Users" -Method POST -Headers $headers -Body '{}' } 'Original resource seeding must be rejected.'
    Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' }).Count -eq 0) 'Negative controls must never transport an original DELETE.'
} finally {
    $script:inventory.endpoints += [pscustomobject]@{ id = $unknown; name = 'live-test-concurrent' }
    $script:inventory.totalResults = 2
    Invoke-OrphanReconciliation
}
Assert $handle.Deleted 'The known-owned finally handle must finish verified cleanup.'
Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' -and $_.Uri -match $unknown }).Count -eq 0) 'Concurrent unknown endpoints must be retained.'
Assert (@($script:calls | Where-Object { $_.Method -eq 'GET' -and $_.Uri -match $owned }).Count -eq 1) 'Cleanup must read back the exact owned ID.'
Invoke-OrphanReconciliation
Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' }).Count -eq 1) 'Completed cleanup must not delete twice.'
Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$owned" -Name 'already cleaned fixture'
Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' }).Count -eq 1) 'Final teardown must not repeat a verified successful DELETE.'

Reset-Mock
$script:inventory = [pscustomobject]@{ totalResults = 0; endpoints = @() }
Initialize-LiveEndpointOwnership
Assert $script:orphanGuardArmed 'An explicitly complete empty inventory is valid.'
$script:createId = $owned.ToUpperInvariant()
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
Assert ($script:ownedEndpointHandles[$owned].Id -eq $owned) 'Registration must normalize UUID casing.'
Expect-Failure { Initialize-LiveEndpointOwnership } 'Reinitialization must not discard retained handles.'
$script:createId = $owned
Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Duplicate owned registration must reject without replacing its handle.'
Invoke-OrphanReconciliation

foreach ($badId in @($null, '', 'malformed', [guid]::Empty.ToString())) {
    Reset-Mock
    Initialize-LiveEndpointOwnership
    $script:createId = $badId
    Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Malformed create response must not assign a teardown target.'
    Assert ($script:ownedEndpointHandles.Count -eq 0) 'Malformed create response cannot register ownership.'
}

foreach ($bad in @(
    $null,
    [pscustomobject]@{ endpoints = @() },
    [pscustomobject]@{ totalResults = 0 },
    [pscustomobject]@{ totalResults = 2; endpoints = @([pscustomobject]@{ id = $original }) },
    [pscustomobject]@{ totalResults = 1; endpoints = @([pscustomobject]@{ id = 'not-a-uuid' }) },
    [pscustomobject]@{ totalResults = 1; endpoints = @([pscustomobject]@{ id = $null }) },
    [pscustomobject]@{ totalResults = 2; endpoints = @([pscustomobject]@{ id = $original }, [pscustomobject]@{ id = $original.ToUpperInvariant() }) },
    [pscustomobject]@{ totalResults = '1'; endpoints = @([pscustomobject]@{ id = $original }) },
    [pscustomobject]@{ totalResults = 0; endpoints = $null }
)) {
    Reset-Mock
    $script:inventory = $bad
    Expect-Failure { Initialize-LiveEndpointOwnership } 'Malformed/incomplete inventory must fail closed.'
    Expect-Failure { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Failed inventory must block creation.'
    Assert (@($script:calls | Where-Object { $_.Method -eq 'POST' }).Count -eq 0) 'Blocked creation must not reach transport.'
}

foreach ($transport in @('Rest', 'Web')) {
    foreach ($failure in @('delete-status', 'still-present', 'readback-error', 'transport')) {
        Reset-Mock
        Initialize-LiveEndpointOwnership
        $script:createId = $owned
        $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body '{"name":"owned"}' -ContentType 'application/json' -SkipHttpErrorCheck
        $handle = $script:ownedEndpointHandles[$owned]
        switch ($failure) {
            'delete-status' { $script:deleteStatus = 500 }
            'still-present' { $script:absenceStatus = 200 }
            'readback-error' { $script:absenceStatus = 503 }
            'transport' { $script:transportFailure = $true }
        }
        # Existing section catches cannot turn failed teardown into a clean run.
        Expect-Failure {
            if ($transport -eq 'Rest') {
                Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/$owned" -Method DELETE -Headers $headers
            } else {
                Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$owned" -Method DELETE -Headers $headers -SkipHttpErrorCheck
            }
        } 'Cleanup failure must throw.'
        Assert (-not $handle.Deleted) 'Failed cleanup must retain a pending owned handle.'
        Expect-Failure { Invoke-OrphanReconciliation } 'Reconciliation failure must propagate.'
    }
}

Reset-Mock
Initialize-LiveEndpointOwnership
$script:createId = $owned
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body '{"name":"owned"}' -ContentType 'application/json' -ErrorAction Stop
$call = $script:calls[-1]
Assert ($call.Uri -eq "$baseUrl/scim/admin/endpoints" -and $call.Method -eq 'POST') 'URI and method forwarding must be unchanged.'
Assert ($call.Body -eq '{"name":"owned"}' -and $call.ContentType -eq 'application/json') 'Body/content type forwarding must be unchanged.'
Assert ($call.Headers['X-Sentinel'] -eq 'forwarded' -and $call.ErrorAction -eq 'Stop' -and $call.Redirect) 'Headers, common parameters and redirect forwarding must be unchanged.'
$null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$owned" -Method PATCH -Headers $headers -Body '{}' -ContentType 'application/json' -SkipHttpErrorCheck -ErrorAction Stop
Assert $script:calls[-1].Skip 'Web SkipHttpErrorCheck forwarding must be unchanged.'
$forwardingHandle = $script:ownedEndpointHandles[$owned]
foreach ($route in @('schemas', 'resource-types')) {
    $probeParameters = @{ Route = $route; OwnedEndpointId = $owned; Headers = $headers; Body = '{}'; ErrorAction = 'Stop' }
    if ($route -eq 'schemas') { $probeParameters.ContentType = 'application/json' }
    $probeError = $null
    try { $null = Invoke-LiveEndpointRejectionProbe @probeParameters } catch { $probeError = $_ }
    Assert ($null -ne $probeError -and [int]$probeError.Exception.Response.StatusCode -eq 404) 'The explicit rejection probe must preserve the real HTTP 404 exception.'
    $probeCall = $script:calls[-1]
    Assert ($probeCall.Uri -eq "$baseUrl/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/$route" -and $probeCall.Method -eq 'POST') 'Explicit probe admission must forward only the exact sentinel URI and POST method.'
    Assert ($probeCall.Body -eq '{}' -and $probeCall.Headers['X-Sentinel'] -eq 'forwarded' -and $probeCall.ErrorAction -eq 'Stop') 'Probe body, headers and common parameters must forward unchanged.'
    Assert ($probeCall.HasContentType -eq ($route -eq 'schemas')) 'Probe content type presence must remain identical to its actual caller.'
    Assert ($script:probeReuseRejected -and $script:probeUnknownRejected -and $null -eq $script:endpointRejectionProbe) 'Probe admission must be single-use, deny concurrent unknown mutations, and clear in finally.'
    Assert ([object]::ReferenceEquals($forwardingHandle, $script:ownedEndpointHandles[$owned])) 'A negative HTTP probe must retain the exact known-owned cleanup handle.'
}
Expect-Failure { Invoke-LiveEndpointRejectionProbe -Route schemas -OwnedEndpointId $original -Headers $headers -Body '{}' } 'An original ID cannot act as the rejection probe cleanup handle.'
Expect-Failure { Invoke-LiveEndpointRejectionProbe -Route credentials -OwnedEndpointId $owned -Headers $headers -Body '{}' } 'Probe admission cannot expand to another route.'
Expect-Failure { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/schemas" -Method POST -Headers $headers -Body '{}' } 'Bare sentinel POST must reject outside explicit admission.'
foreach ($status in @(200, 503)) {
    $script:absenceStatus = $status
    $before = $script:calls.Count
    Expect-Failure { Invoke-LiveEndpointRejectionProbe -Route schemas -OwnedEndpointId $owned -Headers $headers -Body '{}' } 'Probe preflight must require exact sentinel HTTP 404.'
    Assert (@($script:calls | Select-Object -Skip $before | Where-Object Method -eq 'POST').Count -eq 0) 'Failed sentinel absence must not transport a mutation.'
}
$script:absenceStatus = 404
Invoke-OrphanReconciliation

Reset-Mock
Initialize-LiveEndpointOwnership
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
$probeCleanupHandle = $script:ownedEndpointHandles[$owned]
$script:probeStatus = 201
try {
    Expect-Failure { Invoke-LiveEndpointRejectionProbe -Route schemas -OwnedEndpointId $owned -Headers $headers -Body '{}' } 'Unexpected successful rejection probe must fail.'
    Assert ($null -eq $script:endpointRejectionProbe -and [object]::ReferenceEquals($probeCleanupHandle, $script:ownedEndpointHandles[$owned])) 'Unexpected probe outcome must clear admission without replacing the owned cleanup handle.'
} finally {
    Expect-Failure { Invoke-OrphanReconciliation } 'Unexpected probe success must remain sticky through owned cleanup.'
}
Assert $probeCleanupHandle.Deleted 'Sticky probe failure must still permit cleanup of the retained owned handle.'

Reset-Mock
Initialize-LiveEndpointOwnership
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
$script:deleteStatus = 500
Expect-Failure { Remove-TestResource -Uri "$baseUrl/scim/admin/endpoints/$owned" -Name 'failed cleanup' } 'Final cleanup helper must propagate failure.'
$script:deleteStatus = 204
Expect-Failure { Invoke-OrphanReconciliation } 'A later successful retry cannot erase prior cleanup failure evidence.'
Assert $script:ownedEndpointHandles[$owned].Deleted 'Reconciliation must still attempt owned cleanup before propagating earlier failure.'

Reset-Mock
$baseUrl = 'http://fixture.invalid/prefix'
Initialize-LiveEndpointOwnership
$null = Invoke-RestMethod -Uri "$baseUrl/SCIM/ADMIN/ENDPOINTS" -Method POST -Headers $headers
Assert ($script:ownedEndpointHandles.ContainsKey($owned)) 'Base-path and mixed-case creation must retain ownership.'
Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/SCIM/ADMIN/ENDPOINTS/$($original.ToUpperInvariant())" -Method DELETE -Headers $headers } 'Base-path and mixed-case original deletion must reject.'
Invoke-OrphanReconciliation
$baseUrl = 'http://fixture.invalid'

Reset-Mock
Initialize-LiveEndpointOwnership
$script:createStatus = 400
$rejection = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -SkipHttpErrorCheck
Assert ($rejection.StatusCode -eq 400 -and $script:ownedEndpointHandles.Count -eq 0) 'HTTP rejection must remain unchanged and cannot register an owned handle.'
$script:createStatus = 201
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
$normalReconciliation = @($ast.EndBlock.Statements | Where-Object { $_.Extent.Text -eq 'Invoke-OrphanReconciliation' })
Assert ($normalReconciliation.Count -eq 1) 'The actual runner must have one normal-exit reconciliation invocation.'
. ([scriptblock]::Create($normalReconciliation[0].Extent.Text))
Assert $script:ownedEndpointHandles[$owned].Deleted 'The actual normal-exit reconciliation invocation must clean owned handles.'

Reset-Mock
Initialize-LiveEndpointOwnership
$script:failOwnedRead = $true
$script:helperResults = [System.Collections.Generic.List[bool]]::new()
& {
    function Test-Result {
        param([bool]$Success, [string]$Message)
        $script:helperResults.Add($Success)
    }
    . (Join-Path $root 'scripts\live-test-sections\endpoint-snapshot.ps1')
    Invoke-EndpointSnapshotContract -BaseUrl $baseUrl -Headers $headers -SharedSecret 'mock-only'
}
Assert ($script:helperResults.Count -eq 2 -and -not $script:helperResults[0] -and $script:helperResults[1]) 'Actual nested helper must observe the injected interruption and still verify cleanup.'
Assert ($script:ownedEndpointHandles.ContainsKey($owned) -and $script:ownedEndpointHandles[$owned].Deleted) 'Actual nested dot-sourced helper must retain and finish the same owned registry handle.'

# Execute the full actual trap topology after a successful creation, including
# a failure before a caller assigns the returned ID.
Reset-Mock
$interrupted = [scriptblock]::Create($projection + @'

Initialize-LiveEndpointOwnership
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
throw 'injected lifecycle interruption'
'@)
Expect-Failure { . $interrupted } 'Actual trap topology must preserve the interrupted error.'
Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' -and $_.Uri -match $owned }).Count -eq 1) 'Actual trap topology must clean the retained owned response ID.'
Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' -and $_.Uri -match $original }).Count -eq 0) 'Actual trap topology must retain originals.'
Assert ($actualTraps.Count -gt 0) 'The lifecycle projection must include actual top-level traps.'

Reset-Mock
$recorderInterruption = [scriptblock]::Create($projection + @'

Initialize-LiveEndpointOwnership
function Add-FlowStep {
    param($Method)
    if ($Method -eq 'POST') { throw 'injected recorder interruption' }
}
$cleanupTarget = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
'@)
Expect-Failure { . $recorderInterruption } 'Recorder failure must remain an interruption, not a success-shaped response.'
Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' -and $_.Uri -match $owned }).Count -eq 1) 'Registration must precede recorder interruption and caller assignment.'
Assert ($source -notmatch '\$testEndpoints\s*=.*Where-Object.*live-test-') 'The actual final name-based deletion sweep must be removed.'
foreach ($route in @('schemas', 'resource-types')) {
    $probeBlocks = @($ast.FindAll({ param($node)
        $node -is [System.Management.Automation.Language.TryStatementAst] -and
        $node.Extent.Text.Contains("Invoke-LiveEndpointRejectionProbe -Route $route ")
    }, $true))
    Assert ($probeBlocks.Count -eq 1 -and $probeBlocks[0].Extent.Text.Contains('$statusCode -eq 404')) 'Each actual nonexistent-ID mutation probe must use explicit admission and retain its HTTP 404 assertion.'
}
Assert ($source.IndexOf('Initialize-LiveEndpointOwnership', $source.IndexOf('# ORPHAN-ENDPOINT')) -lt $source.IndexOf('# TEST SECTION 1:')) 'Actual inventory initialization must precede the first creation section.'
$gates = Get-Content (Join-Path $root 'scripts\pre-push-checks.ps1') -Raw
Assert ($gates.Contains('live-endpoint-ownership.contract.ps1')) 'The focused contract must run in default gates.'
Write-Output "live endpoint ownership contract: $script:assertions assertions passed"
