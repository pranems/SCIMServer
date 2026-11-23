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
    $_.Extent.Text -match '^\. .*live-(endpoint-ownership|evidence)\.ps1' -or
    $_.Extent.Text -match '^Initialize-LiveEvidence\b'
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
    $global:__ScimServerLiveEndpointOwnership = [pscustomobject]@{
        preexistingEndpointIds = @()
        orphanGuardArmed = $false
        ownedEndpointHandles = @{}
        endpointCleanupFailures = @()
        endpointRejectionProbe = $null
    }
    # Legacy script state is retained only for the pinned -BaselineRed replay.
    $script:ownedEndpointHandles = @{}
    $script:orphanGuardArmed = $false
    $script:inventory = [pscustomobject]@{ totalResults = 1; endpoints = @([pscustomobject]@{ id = $original; name = 'live-test-original' }) }
    $script:createId = $owned
    $script:createStatus = 201
    $script:deleteStatus = 204
    $script:absenceStatus = 404
    $script:transportFailure = $false
    $script:webContentKind = 'string'
    $script:lastWebResponse = $null
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
    if ($script:emitTransportEvidence) { [Console]::WriteLine("OWNERSHIP_TRANSPORT $m $Uri") }
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
    if ($script:emitTransportEvidence) { [Console]::WriteLine("OWNERSHIP_TRANSPORT $m $Uri") }
    $script:calls.Add([pscustomobject]@{ Uri = $Uri; Method = $m; Headers = $Headers; Body = $Body; ContentType = $ContentType; ErrorAction = $PSBoundParameters['ErrorAction']; Skip = $SkipHttpErrorCheck; Redirect = $AllowInsecureRedirect })
    if ($script:transportFailure) { throw 'mock transport unavailable' }
    $status = if ($m -eq 'DELETE') { $script:deleteStatus } elseif ($m -eq 'POST') { $script:createStatus } else { $script:absenceStatus }
    $content = @{ id = $script:createId } | ConvertTo-Json
    switch ($script:webContentKind) {
        'bytes' { $content = [Text.Encoding]::UTF8.GetBytes($content) }
        'invalid-json' { $content = [Text.Encoding]::UTF8.GetBytes('{ invalid JSON') }
        'invalid-utf8' { $content = [byte[]]@(0xc3, 0x28) }
        'unsupported' { $content = [pscustomobject]@{ id = $script:createId } }
    }
    $script:lastWebResponse = [pscustomobject]@{ StatusCode = $status; Headers = @{}; Content = $content }
    return $script:lastWebResponse
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
$knownCleanupHandle = $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned]
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
$baseline = $global:__ScimServerLiveEndpointOwnership.preexistingEndpointIds
$script:inventory = [pscustomobject]@{ totalResults = 0; endpoints = @() }
Expect-Failure { Initialize-LiveEndpointOwnership } 'An armed baseline must reject reinitialization even before any owned handle exists.'
Assert ([object]::ReferenceEquals($baseline, $global:__ScimServerLiveEndpointOwnership.preexistingEndpointIds) -and $global:__ScimServerLiveEndpointOwnership.preexistingEndpointIds.Contains($original) -and $global:__ScimServerLiveEndpointOwnership.orphanGuardArmed) 'Reinitialization must never erase or disarm the original baseline.'

Reset-Mock
Initialize-LiveEndpointOwnership
Assert $global:__ScimServerLiveEndpointOwnership.orphanGuardArmed 'A complete inventory must arm creation.'
$response = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -Body '{"name":"owned"}' -ContentType 'application/json' -ErrorAction Stop
Assert ($response.id -eq $owned) 'Creation response must be unchanged.'
Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles.ContainsKey($owned.ToUpperInvariant())) 'UUID identity must be case-insensitive.'
$handle = $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned]
$script:createId = $original.ToUpperInvariant()
try {
    Expect-Failure { Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Original response ID must be rejected before assignment.'
    $script:cleanupId = $owned
    Expect-Failure { $script:cleanupId = (Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers).Content } 'Web original response must reject before teardown assignment.'
    Assert ($script:cleanupId -eq $owned) 'Failed original-ID registration must not alter the caller cleanup target.'
    Assert ([object]::ReferenceEquals($handle, $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned])) 'Rejected registration must retain the prior cleanup handle.'
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
Assert $global:__ScimServerLiveEndpointOwnership.orphanGuardArmed 'An explicitly complete empty inventory is valid.'
$script:createId = $owned.ToUpperInvariant()
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Id -eq $owned) 'Registration must normalize UUID casing.'
Expect-Failure { Initialize-LiveEndpointOwnership } 'Reinitialization must not discard retained handles.'
$script:createId = $owned
Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Duplicate owned registration must reject without replacing its handle.'
Invoke-OrphanReconciliation

foreach ($json in @(
    '{"totalResults":0,"endpoints":[]}',
    '{"totalResults":1,"endpoints":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]}'
)) {
    Reset-Mock
    $script:inventory = $json | ConvertFrom-Json -ErrorAction Stop
    Assert ($script:inventory.totalResults -is [long]) 'JSON inventory counts must exercise native Int64 deserialization.'
    Initialize-LiveEndpointOwnership
    Assert $global:__ScimServerLiveEndpointOwnership.orphanGuardArmed 'Complete JSON-deserialized inventory must arm ownership.'
    Assert ($global:__ScimServerLiveEndpointOwnership.preexistingEndpointIds.Count -eq $script:inventory.endpoints.Count) 'JSON inventory must retain every original UUID.'
    if ($script:inventory.totalResults -eq 1) {
        Assert ($global:__ScimServerLiveEndpointOwnership.preexistingEndpointIds.Contains($original)) 'JSON inventory must retain the exact original UUID.'
    }
}

foreach ($countJson in @(
    'true', 'false', '"1"', '1.5', '1.0', '-1',
    '2147483648', '9223372036854775807', '9223372036854775808',
    '0', '2'
)) {
    Reset-Mock
    $script:inventory = (
        '{"totalResults":' + $countJson +
        ',"endpoints":[{"id":"' + $original + '"}]}'
    ) | ConvertFrom-Json -ErrorAction Stop
    Expect-Failure { Initialize-LiveEndpointOwnership } 'Invalid JSON count must fail closed.'
    Assert (-not $global:__ScimServerLiveEndpointOwnership.orphanGuardArmed) 'Invalid JSON count must leave ownership unarmed.'
    Expect-Failure {
        Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
    } 'Invalid JSON count must block fixture creation.'
    Assert (@($script:calls | Where-Object { $_.Method -eq 'POST' }).Count -eq 0) 'Invalid JSON count must reject before creation transport.'
}

foreach ($kind in @('string', 'bytes')) {
    Reset-Mock
    Initialize-LiveEndpointOwnership
    $script:webContentKind = $kind
    $response = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
    Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles.ContainsKey($owned)) 'String and UTF-8 byte create responses must register the exact owned UUID.'
    $representationUnchanged = ($kind -eq 'bytes' -and $response.Content -is [byte[]]) -or
        ($kind -eq 'string' -and $response.Content -is [string])
    Assert ([object]::ReferenceEquals($response, $script:lastWebResponse) -and $representationUnchanged) 'Creation admission must return the original HTTP response and content representation.'
    $null = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints/$owned" -Method DELETE -Headers $headers
    Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Deleted) 'Byte-aware creation admission must retain exact-ID deletion and 404 readback.'
}
foreach ($kind in @('invalid-json', 'invalid-utf8', 'unsupported')) {
    Reset-Mock
    Initialize-LiveEndpointOwnership
    $script:webContentKind = $kind
    Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Invalid create-response representation must fail closed.'
    Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles.Count -eq 0) 'Invalid create-response representation cannot register ownership.'
}

Reset-Mock
Initialize-LiveEndpointOwnership
$entraEp = $minimalEp = $rfcEp = $userOnlyEp = $inlineEp = $null
$patchEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
$profileLifecycle = @($ast.EndBlock.Statements | Where-Object {
    $_ -is [Management.Automation.Language.TryStatementAst] -and
    $_.Body.Extent.Text.Contains('9z.36: Cleaned up PATCH test endpoint')
})
Assert ($profileLifecycle.Count -eq 1) 'The actual profile lifecycle cleanup must be uniquely identified.'
$patchCleanup = @($profileLifecycle[0].Body.Statements | Where-Object {
    $_ -is [Management.Automation.Language.TryStatementAst] -and
    $_.Body.Extent.Text.Contains('$patchEp.id') -and $_.Body.Extent.Text.Contains('-Method DELETE')
})
Assert ($patchCleanup.Count -eq 1) 'The actual early PATCH-endpoint cleanup must be uniquely identified.'
. ([scriptblock]::Create($patchCleanup[0].Extent.Text))
$profileFinally = $profileLifecycle[0].Finally.Extent.Text
. ([scriptblock]::Create($profileFinally.Substring(1, $profileFinally.Length - 2)))
Assert (@($script:calls | Where-Object { $_.Method -eq 'DELETE' -and $_.Uri -eq "$baseUrl/scim/admin/endpoints/$owned" }).Count -eq 1) 'Successful profile cleanup must not DELETE the same owned endpoint again in finally.'
Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Deleted -and
    $global:__ScimServerLiveEndpointOwnership.endpointCleanupFailures.Count -eq 0) 'Successful early profile deletion must retain its verified handle without a cleanup failure.'
Reset-Mock
Initialize-LiveEndpointOwnership
$patchEp = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
$script:deleteStatus = 500
$patchEndpointDeleted = $false
. ([scriptblock]::Create($patchCleanup[0].Extent.Text))
Assert (-not $patchEndpointDeleted -and $patchEp.id -eq $owned -and
    -not $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Deleted) 'Failed early profile deletion must retain its UUID and unsuccessful result.'
$script:deleteStatus = 204
. ([scriptblock]::Create($profileFinally.Substring(1, $profileFinally.Length - 2)))
Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Deleted -and
    $global:__ScimServerLiveEndpointOwnership.endpointCleanupFailures.Count -eq 1) 'Finally must finish failed profile cleanup without erasing its earlier failure.'

foreach ($badId in @($null, '', 'malformed', [guid]::Empty.ToString())) {
    Reset-Mock
    Initialize-LiveEndpointOwnership
    $script:createId = $badId
    Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers } 'Malformed create response must not assign a teardown target.'
    Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles.Count -eq 0) 'Malformed create response cannot register ownership.'
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
        $handle = $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned]
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
$forwardingHandle = $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned]
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
    Assert ($script:probeReuseRejected -and $script:probeUnknownRejected -and $null -eq $global:__ScimServerLiveEndpointOwnership.endpointRejectionProbe) 'Probe admission must be single-use, deny concurrent unknown mutations, and clear in finally.'
    Assert ([object]::ReferenceEquals($forwardingHandle, $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned])) 'A negative HTTP probe must retain the exact known-owned cleanup handle.'
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
$probeCleanupHandle = $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned]
$script:probeStatus = 201
try {
    Expect-Failure { Invoke-LiveEndpointRejectionProbe -Route schemas -OwnedEndpointId $owned -Headers $headers -Body '{}' } 'Unexpected successful rejection probe must fail.'
    Assert ($null -eq $global:__ScimServerLiveEndpointOwnership.endpointRejectionProbe -and [object]::ReferenceEquals($probeCleanupHandle, $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned])) 'Unexpected probe outcome must clear admission without replacing the owned cleanup handle.'
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
Assert $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Deleted 'Reconciliation must still attempt owned cleanup before propagating earlier failure.'

Reset-Mock
$baseUrl = 'http://fixture.invalid/prefix'
Initialize-LiveEndpointOwnership
$null = Invoke-RestMethod -Uri "$baseUrl/SCIM/ADMIN/ENDPOINTS" -Method POST -Headers $headers
Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles.ContainsKey($owned)) 'Base-path and mixed-case creation must retain ownership.'
Expect-Failure { Invoke-WebRequest -Uri "$baseUrl/SCIM/ADMIN/ENDPOINTS/$($original.ToUpperInvariant())" -Method DELETE -Headers $headers } 'Base-path and mixed-case original deletion must reject.'
Invoke-OrphanReconciliation
$baseUrl = 'http://fixture.invalid'

Reset-Mock
Initialize-LiveEndpointOwnership
$script:createStatus = 400
$rejection = Invoke-WebRequest -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers -SkipHttpErrorCheck
Assert ($rejection.StatusCode -eq 400 -and $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles.Count -eq 0) 'HTTP rejection must remain unchanged and cannot register an owned handle.'
$script:createStatus = 201
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
$normalReconciliation = @($ast.EndBlock.Statements | Where-Object { $_.Extent.Text -eq 'Invoke-OrphanReconciliation' })
Assert ($normalReconciliation.Count -eq 1) 'The actual runner must have one normal-exit reconciliation invocation.'
. ([scriptblock]::Create($normalReconciliation[0].Extent.Text))
Assert $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Deleted 'The actual normal-exit reconciliation invocation must clean owned handles.'

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
Assert ($global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles.ContainsKey($owned) -and $global:__ScimServerLiveEndpointOwnership.ownedEndpointHandles[$owned].Deleted) 'Actual nested dot-sourced helper must retain and finish the same owned registry handle.'

# Unlike dot-sourcing, invoking a real .ps1 file introduces a script scope.
foreach ($transport in @('Rest', 'Web')) {
    Reset-Mock
    Initialize-LiveEndpointOwnership
    $boundary = @{
        Calls = [System.Collections.Generic.List[object]]::new()
        CreateId = $owned
        DeleteStatus = 204
        Inventory = $script:inventory
    }
    & {
        function Add-FlowStep { }
        function Invoke-MockRest {
            [CmdletBinding()]
            param($Uri, $Method, $Headers, $Body, $ContentType,
                [switch]$AllowInsecureRedirect, $ResponseHeadersVariable, $StatusCodeVariable)
            $m = if ($Method) { "$Method".ToUpperInvariant() } else { 'GET' }
            $boundary.Calls.Add([pscustomobject]@{ Method = $m; Uri = $Uri })
            $status = if ($m -eq 'POST') { 201 } elseif ($m -eq 'DELETE') { $boundary.DeleteStatus } else { 200 }
            if ($StatusCodeVariable) { Set-Variable -Name $StatusCodeVariable -Value $status -Scope 1 }
            if ($ResponseHeadersVariable) { Set-Variable -Name $ResponseHeadersVariable -Value @{} -Scope 1 }
            if ($m -eq 'GET') { return $boundary.Inventory }
            if ($m -eq 'POST') { return [pscustomobject]@{ id = $boundary.CreateId } }
        }
        function Invoke-MockWeb {
            [CmdletBinding()]
            param($Uri, $Method, $Headers, $Body, $ContentType,
                [switch]$AllowInsecureRedirect, [switch]$SkipHttpErrorCheck)
            $m = if ($Method) { "$Method".ToUpperInvariant() } else { 'GET' }
            $boundary.Calls.Add([pscustomobject]@{ Method = $m; Uri = $Uri })
            $status = if ($m -eq 'POST') { 201 } elseif ($m -eq 'DELETE') { $boundary.DeleteStatus } elseif ($m -eq 'GET') { 404 } else { 200 }
            [pscustomobject]@{
                StatusCode = $status
                Headers = @{}
                Content = if ($m -eq 'POST') { @{ id = $boundary.CreateId } | ConvertTo-Json } else { '' }
            }
        }

        $child = Join-Path $root 'scripts\test\fixtures\live-endpoint-ownership-child.ps1'
        $rejected = & $child -Mode Reject -BaseUrl $baseUrl -Headers $headers `
            -OriginalId $original -UnknownId $unknown
        Assert ($rejected -eq 16) 'Actual child must reject both wrappers and every original/unknown mutation method.'
        Assert ($boundary.Calls.Count -eq 0) 'Actual child original/unknown rejection must precede transport.'

        $childId = & $child -Mode Lifecycle -Transport $transport -BaseUrl $baseUrl -Headers $headers
        $state = $global:__ScimServerLiveEndpointOwnership
        Assert ($childId -eq $owned -and $state.ownedEndpointHandles[$owned].Deleted) 'Actual child must share registration, mutation and verified deletion with its parent.'
        Assert (($boundary.Calls.Method -join ',') -eq 'POST,PATCH,DELETE,GET') 'Actual child lifecycle must use creation, mutation, exact deletion and absence readback.'

        $before = $boundary.Calls.Count
        Expect-Failure {
            & $child -Mode Reinitialize -BaseUrl $baseUrl -Headers $headers
        } 'Actual child must not replace the armed parent inventory.'
        Assert ($boundary.Calls.Count -eq $before -and
            [object]::ReferenceEquals($state, $global:__ScimServerLiveEndpointOwnership) -and
            $state.preexistingEndpointIds.Contains($original)) 'Child reinitialization must reject before inventory transport and retain the original registry.'

        $boundary.CreateId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
        $boundary.DeleteStatus = 500
        Expect-Failure {
            & $child -Mode Lifecycle -Transport $transport -BaseUrl $baseUrl -Headers $headers
        } 'Actual child cleanup failure must propagate.'
        $pending = $state.ownedEndpointHandles[$boundary.CreateId]
        Assert ($null -ne $pending -and -not $pending.Deleted -and
            $state.endpointCleanupFailures.Count -eq 1) 'Child failure must retain its parent-visible handle and sticky cleanup evidence.'

        $boundary.DeleteStatus = 204
        Expect-Failure { Invoke-OrphanReconciliation } 'Parent cleanup must preserve the earlier child cleanup failure.'
        Assert ($pending.Deleted -and $state.endpointCleanupFailures.Count -eq 1) 'Parent must finish child cleanup without erasing its failure.'
        Assert ($boundary.Calls[-2].Method -eq 'DELETE' -and
            $boundary.Calls[-1].Method -eq 'GET' -and
            $boundary.Calls[-2].Uri -eq "$baseUrl/scim/admin/endpoints/$($pending.Id)" -and
            $boundary.Calls[-1].Uri -eq "$baseUrl/scim/admin/endpoints/$($pending.Id)") 'Parent retry must delete and verify only the exact pending child UUID.'
    }
}

# Execute the full actual trap topology after a successful creation, including
# a failure before a caller assigns the returned ID.
function Invoke-LifecycleProcess([string]$scenario) {
    $mockSource = (@('Reset-Mock', 'Invoke-MockRest', 'Invoke-MockWeb') | ForEach-Object {
        "function $_ {`n$((Get-Command $_).Definition)`n}"
    }) -join "`n"
    $fixture = Join-Path ([IO.Path]::GetTempPath()) "scim-owned-lifecycle-$([guid]::NewGuid().ToString('N')).ps1"
    $setup = @"
`$ErrorActionPreference = 'Stop'
`$baseUrl = '$baseUrl'
`$headers = @{ Authorization = 'mock-only' }
`$original = '$original'
`$owned = '$owned'
`$unknown = '$unknown'
"@
    try {
        [IO.File]::WriteAllText($fixture, "$setup`n$mockSource`n$projection`nReset-Mock`n`$script:emitTransportEvidence = `$true`n$scenario")
        $output = & pwsh -NoProfile -NonInteractive -File $fixture 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
    } finally {
        Remove-Item -LiteralPath $fixture -ErrorAction Stop
    }
}
$interrupted = Invoke-LifecycleProcess @'

Initialize-LiveEndpointOwnership
$null = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
throw 'injected lifecycle interruption'
'@
Assert ($interrupted.ExitCode -eq 1 -and $interrupted.Output.Contains('injected lifecycle interruption')) 'Actual trap topology must preserve the interrupted error and fatal exit.'
Assert (@($interrupted.Output -split '\r?\n' | Where-Object { $_ -ceq "OWNERSHIP_TRANSPORT DELETE $baseUrl/scim/admin/endpoints/$owned" }).Count -eq 1) 'Actual trap topology must clean the retained owned response ID.'
Assert (-not $interrupted.Output.Contains("OWNERSHIP_TRANSPORT DELETE $baseUrl/scim/admin/endpoints/$original")) 'Actual trap topology must retain originals.'
Assert ($actualTraps.Count -gt 0) 'The lifecycle projection must include actual top-level traps.'

$recorderInterruption = Invoke-LifecycleProcess @'

Initialize-LiveEndpointOwnership
function Add-FlowStep {
    param($Method)
    if ($Method -eq 'POST') { throw 'injected recorder interruption' }
}
$cleanupTarget = Invoke-RestMethod -Uri "$baseUrl/scim/admin/endpoints" -Method POST -Headers $headers
'@
Assert ($recorderInterruption.ExitCode -eq 1 -and $recorderInterruption.Output.Contains('injected recorder interruption')) 'Recorder failure must remain an interruption, not a success-shaped response.'
Assert (@($recorderInterruption.Output -split '\r?\n' | Where-Object { $_ -ceq "OWNERSHIP_TRANSPORT DELETE $baseUrl/scim/admin/endpoints/$owned" }).Count -eq 1) 'Registration must precede recorder interruption and caller assignment.'
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
