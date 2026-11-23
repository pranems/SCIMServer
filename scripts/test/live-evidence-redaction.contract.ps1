$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$livePath = Join-Path $root 'scripts\live-test.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($livePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Live runner does not parse.' }
$names = @('Convert-FlowBody', 'Convert-FlowHeaders', 'Add-FlowStep', 'Write-VerboseLog', 'Test-Result')
foreach ($name in $names) {
    $definition = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }.GetNewClosure(), $true)
    if (-not $definition) { throw "Missing production function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$helper = Join-Path $root 'scripts\live-evidence.ps1'
if (Test-Path $helper) { . $helper; Initialize-LiveEvidence }
$global:__ScimServerLiveTestFlowSteps = [System.Collections.Generic.List[object]]::new()
$script:flowSteps = $global:__ScimServerLiveTestFlowSteps
$script:currentSection = 'Synthetic redaction contract'
$script:VerboseMode = $true
$script:lastLinkedFlowStepId = 0
$script:testResults = @()
$script:testsPassed = 0
$script:testsFailed = 0
$checks = 0
function Assert-Contract {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
    Write-Verbose "Completed synthetic assertion $script:checks"
}
$secret = 'synthetic-evidence-secret-123456789'
$body = [ordered]@{
    access_token = $secret
    issuedTokenTtlSec = 3600
    nested = [pscustomobject]@{
        token = $secret
        clientSecret = $secret
        secretToken = $secret
        credentialId = 'synthetic-id'
        items = @(@{ client_secret = $secret }, @{ refresh_token = $secret; assertion = $secret })
    }
}
$original = ConvertTo-Json -InputObject $body -Depth 30
$safe = Convert-FlowBody $body
$serialized = ConvertTo-Json -InputObject $safe -Depth 30
Assert-Contract (-not $serialized.Contains($secret)) 'Convert-FlowBody leaks OAuth/admin secret values into evidence.'
Assert-Contract ((ConvertTo-Json -InputObject $body -Depth 30) -ceq $original) 'Redaction changed the original HTTP body.'
Assert-Contract ($safe.issuedTokenTtlSec -eq 3600 -and $safe.nested.credentialId -eq 'synthetic-id') 'Nonsecret metadata was lost.'

foreach ($fixture in @(
    $original,
    [Text.Encoding]::UTF8.GetBytes($original),
    "grant_type=client_credentials&client_secret=$secret&client_assertion=$secret&client_assertion_type=urn%3Atest",
    "failure access_token=$secret; issuedTokenTtlSec=3600",
    "https://example.invalid/scim?client_secret=$secret&count=2#access_token=$secret"
)) {
    $safeFixture = Convert-FlowBody $fixture
    Assert-Contract (-not (ConvertTo-Json -InputObject $safeFixture -Depth 30).Contains($secret)) 'Encoded/string evidence leaked a sentinel.'
}
$headers = @{ Authorization = "Bearer $secret"; Cookie = "session=$secret"; 'Set-Cookie' = @("session=$secret"); 'X-Api-Key' = $secret; ETag = '"v1"' }
$headerOriginal = ConvertTo-Json -InputObject $headers
$safeHeaders = Convert-FlowHeaders $headers
Assert-Contract (-not (ConvertTo-Json -InputObject $safeHeaders).Contains($secret)) 'Request/response headers leaked.'
Assert-Contract ($safeHeaders.ETag -eq '"v1"') 'Diagnostic header was removed.'
Assert-Contract ((ConvertTo-Json -InputObject $headers) -ceq $headerOriginal) 'Original headers changed.'

Add-FlowStep -StartedAt (Get-Date) -Method POST -Uri "https://example.invalid/?token=$secret" -RequestHeaders $headers -RequestBody $body -StatusCode 400 -ResponseHeaders $headers -ResponseBody $original -ErrorMessage "Server echoed $secret"
$trace = ConvertTo-Json -InputObject $script:flowSteps.ToArray() -Depth 30
Assert-Contract (-not $trace.Contains($secret)) 'Flow URL/body/error/header sink leaked.'
Assert-Contract ($script:flowSteps[0].response.status -eq 400) 'Error status was weakened.'
$console = & {
    Write-VerboseLog 'Synthetic response' $body
    Write-VerboseLog 'Synthetic error' "Server echoed $secret"
    Test-Result -Success $false -Message "synthetic failure $secret"
    $failure = [System.Management.Automation.ErrorRecord]::new(
        [InvalidOperationException]::new("Server echoed $secret"), 'SyntheticError',
        [System.Management.Automation.ErrorCategory]::InvalidOperation, $null)
    $failure.ErrorDetails = [System.Management.Automation.ErrorDetails]::new($original)
    Write-LiveEvidenceFailure $failure
} 6>&1 | Out-String
Assert-Contract (-not $console.Contains($secret)) 'Verbose/result console leaked.'
Assert-Contract ($script:testResults[0].status -eq 'failed') 'Failed assertion became success-shaped.'
$longSecret = 'synthetic-long-' + ('x' * 7000)
$longBody = @{ clientSecret = $longSecret; note = 'preserved' }
$longSafe = Convert-FlowBody $longBody
Assert-Contract (-not (ConvertTo-Json -InputObject $longSafe).Contains('synthetic-long-')) 'Truncation leaked a secret prefix.'
$longConsole = & { Write-VerboseLog 'Synthetic long secret' $longBody } 6>&1 | Out-String
Assert-Contract (-not $longConsole.Contains('synthetic-long-')) 'Verbose truncation leaked a prefix.'

$envelope = @{ flowSteps = $script:flowSteps.ToArray(); tests = $script:testResults; baseUrl = "https://example.invalid/?token=$secret" }
$export = ConvertTo-LiveEvidenceJson $envelope
Assert-Contract (-not $export.Contains($secret)) 'Final durable serialization leaked.'
Assert-Contract ($export.Contains('issuedTokenTtlSec')) 'Durable export lost diagnostic structure.'
$array = @(@{ token = $secret }, @(@{ password = $secret }))
$arrayBefore = ConvertTo-Json -InputObject $array -Depth 30
$arraySafe = Convert-FlowBody $array
Assert-Contract (-not (ConvertTo-Json -InputObject $arraySafe -Depth 30).Contains($secret)) 'Nested arrays leaked.'
Assert-Contract ((ConvertTo-Json -InputObject $array -Depth 30) -ceq $arrayBefore) 'Array input was mutated.'
Assert-Contract ($arraySafe.Count -eq 2) 'Array shape was flattened.'
Assert-Contract ($arraySafe[1] -is [array]) 'Nested array boundary was lost.'

foreach ($bad in @("{`"clientSecret`":`"$secret", [byte[]]@(255))) {
    $badBefore = ConvertTo-Json -InputObject $bad
    $errorEvidence = Convert-FlowBody $bad
    Assert-Contract ($errorEvidence.Contains('_evidenceError')) 'Invalid JSON/UTF8 body did not report an explicit evidence shape error.'
    Assert-Contract (-not (ConvertTo-Json -InputObject $errorEvidence).Contains($secret)) 'Invalid body error leaked raw data.'
    Assert-Contract ((ConvertTo-Json -InputObject $bad) -ceq $badBefore) 'Invalid request input was changed.'
}
$cycle = @{}
$cycle.self = $cycle
$caught = $false
try { Convert-FlowBody $cycle | Out-Null } catch { $caught = $_.Exception.Message -eq 'Live evidence body contains a cycle.' }
Assert-Contract $caught 'Cyclic input did not fail explicitly.'
Assert-Contract ($null -eq (Convert-FlowBody $null)) 'Absent body was not preserved as null.'
foreach ($key in @(
    'access_token', 'refresh_token', 'id_token', 'client_secret', 'client_assertion',
    'assertion', 'token', 'clientSecret', 'secretToken', 'bearerToken', 'sharedSecret',
    'password', 'secretEnvelope', 'credentialHash', 'secretHash',
    'Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'X-Api-Key'
)) {
    $unique = "synthetic-material-$key-987654321"
    $isolated = [ordered]@{ earlierDiagnostic = "echo $unique"; $key = $unique }
    $safeIsolated = Convert-FlowBody $isolated
    Assert-Contract (-not (ConvertTo-Json -InputObject $safeIsolated).Contains($unique)) "Material key $key failed isolated redaction or sibling discovery."
    Assert-Contract ($safeIsolated.Contains('earlierDiagnostic')) 'Redaction deleted diagnostic structure.'
}
$metadata = @{ clientSecretState = 'shown'; secretRetained = $true; tokenEndpoint = 'https://example.invalid/token'; credentialId = 'owned'; issuedTokenTtlSec = 3600 }
Assert-Contract ((ConvertTo-Json -InputObject (Convert-FlowBody $metadata)) -ceq (ConvertTo-Json -InputObject $metadata)) 'Secret-like metadata changed.'
$emptyMaterial = Convert-FlowBody @{ token = ''; clientSecret = '[REDACTED]' }
Assert-Contract ($emptyMaterial.token -eq '[REDACTED]') 'Empty/redacted strings are not idempotent material.'
$encoded = 'https://example.invalid/scim?%63lient_secret=synthetic%2Bencoded%2Fmaterial&count=2#assertion=synthetic-fragment'
$encodedSafe = Convert-FlowBody $encoded
Assert-Contract (-not $encodedSafe.Contains('synthetic') -and $encodedSafe.Contains('count=2')) 'Encoded URL keys/values or fragments leaked or lost diagnostics.'
$userinfo = Convert-FlowBody 'https://synthetic-user:synthetic-password@example.invalid/scim'
Assert-Contract (-not $userinfo.Contains('synthetic-') -and $userinfo.EndsWith('/scim')) 'URL user information leaked.'
foreach ($scheme in @('https', 'http', 'postgresql', 'redis', 'mongodb+srv')) {
    foreach ($encoding in @('plain', 'password', 'whole')) {
        Initialize-LiveEvidence
        $password = "synthetic-userinfo-$scheme-791357" + '+/:@'
        $username = if ($encoding -eq 'plain') { 'synthetic-user-name' } else { 'synthetic-user+name@scope' }
        $decodedUserinfo = "${username}:$password"
        $encodedPassword = [Uri]::EscapeDataString($password)
        $encodedWhole = [Uri]::EscapeDataString($decodedUserinfo)
        $wireUserinfo = if ($encoding -eq 'whole') {
            $encodedWhole.ToLowerInvariant()
        } elseif ($encoding -eq 'password') {
            [Uri]::EscapeDataString($username) + ':' + $encodedPassword.ToLowerInvariant()
        } else { "${username}:synthetic-userinfo-$scheme-791357" }
        if ($encoding -eq 'plain') {
            $password = "synthetic-userinfo-$scheme-791357"
            $decodedUserinfo = "${username}:$password"
            $encodedPassword = [Uri]::EscapeDataString($password)
            $encodedWhole = [Uri]::EscapeDataString($decodedUserinfo)
        }
        $uri = "${scheme}://${wireUserinfo}@example.invalid/scim?count=2"
        $credentialBody = [ordered]@{
            earlierDiagnostic = "server echoed $password"
            earlierEncodedDiagnostic = "server echoed $encodedPassword"
            earlierUserinfoDiagnostic = "server echoed $decodedUserinfo"
            earlierEncodedUserinfoDiagnostic = "server echoed $encodedWhole"
            url = $uri
            issuedTokenTtlSec = 3600
            credentialId = 'owned-userinfo-control'
            userName = $username
        }
        $beforeUserinfo = ConvertTo-Json -InputObject $credentialBody -Depth 30
        $safeUserinfo = ConvertTo-LiveEvidence $credentialBody
        $safeUserinfoJson = ConvertTo-LiveEvidenceJson $credentialBody
        Assert-Contract (-not $safeUserinfoJson.Contains($password)) "Recognized $scheme userinfo password leaked into an earlier sibling."
        Assert-Contract (-not $safeUserinfoJson.Contains($encodedPassword) -and -not $safeUserinfoJson.Contains($encodedWhole)) "Encoded $scheme userinfo leaked into an earlier sibling."
        Assert-Contract ($safeUserinfo.url -ceq "${scheme}://[REDACTED]@example.invalid/scim?count=2") "Credential-bearing $scheme URI authority was not redacted precisely."
        Assert-Contract ($safeUserinfo.issuedTokenTtlSec -eq 3600 -and $safeUserinfo.credentialId -ceq 'owned-userinfo-control' -and $safeUserinfo.userName -ceq $username) 'Userinfo discovery changed nonsecret metadata or the standalone username.'
        Assert-Contract ((ConvertTo-Json -InputObject $credentialBody -Depth 30) -ceq $beforeUserinfo) 'Userinfo discovery mutated original inputs.'
        Assert-Contract ((ConvertTo-LiveEvidenceJson $safeUserinfo) -ceq $safeUserinfoJson) 'Userinfo redaction is not idempotent.'
    }
}
$discoveryCases = @(
    @{ name = 'Bearer text sibling'; material = 'BearerFresh791357'; body = [ordered]@{ earlierDiagnostic = 'echo BearerFresh791357'; authorizationText = 'Bearer BearerFresh791357'; issuedTokenTtlSec = 3600 } },
    @{ name = 'Basic text sibling'; material = 'BasicFresh791357'; body = [ordered]@{ earlierDiagnostic = 'echo BasicFresh791357'; authorizationText = 'Basic BasicFresh791357'; issuedTokenTtlSec = 3600 } },
    @{ name = 'Decoded Basic password sibling'; material = 'BasicPasswordFresh791357'; body = [ordered]@{ earlierDiagnostic = 'echo BasicPasswordFresh791357'; authorizationText = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('nonsecret-account:BasicPasswordFresh791357')); issuedTokenTtlSec = 3600 } },
    @{ name = 'Marker substring credential'; sentinel = 'MarkerFresh791357'; material = 'prefix-MarkerFresh791357[REDACTED]-suffix'; body = [ordered]@{ earlierDiagnostic = 'echo prefix-MarkerFresh791357[REDACTED]-suffix'; client_secret = 'prefix-MarkerFresh791357[REDACTED]-suffix'; issuedTokenTtlSec = 3600 } },
    @{ name = 'Marker substring URI password'; sentinel = 'UriMarkerFresh791357'; material = 'prefix-UriMarkerFresh791357[REDACTED]-suffix'; body = [ordered]@{ earlierDiagnostic = 'echo prefix-UriMarkerFresh791357[REDACTED]-suffix'; uri = 'ssh://nonsecret-account:prefix-UriMarkerFresh791357[REDACTED]-suffix@example.invalid/scim'; issuedTokenTtlSec = 3600 } },
    @{ name = 'Username-only URI metadata'; material = 'NonsecretAccountFresh791357'; retain = $true; body = [ordered]@{ userName = 'NonsecretAccountFresh791357'; uri = 'ssh://NonsecretAccountFresh791357@example.invalid/scim'; issuedTokenTtlSec = 3600 } }
)
$discoveryFailures = [System.Collections.Generic.List[string]]::new()
foreach ($case in $discoveryCases) {
    Initialize-LiveEvidence
    $before = ConvertTo-Json -InputObject $case.body -Depth 30
    try {
        $safe = ConvertTo-LiveEvidence $case.body
        $json = ConvertTo-LiveEvidenceJson $case.body
        if ($case.retain) {
            Assert-Contract ($safe.userName -ceq $case.material) 'Username-only URI incorrectly registered nonsecret account metadata as material.'
            Assert-Contract ($safe.uri -ceq 'ssh://[REDACTED]@example.invalid/scim') 'Username-only URI authority was not masked.'
        } else {
            Assert-Contract (-not $json.Contains($case.material)) "Recognized material discovery failed: $($case.name)."
            if ($case.sentinel) {
                Assert-Contract (-not $json.Contains($case.sentinel)) 'Marker-substring material retained its unique sentinel after partial redaction.'
            }
        }
        Assert-Contract ($safe.issuedTokenTtlSec -eq 3600) 'Fresh discovery control lost diagnostic metadata.'
        Assert-Contract ((ConvertTo-Json -InputObject $case.body -Depth 30) -ceq $before) 'Fresh discovery control mutated originals.'
        Assert-Contract ((ConvertTo-LiveEvidenceJson $safe) -ceq $json) 'Fresh discovery control was not idempotent.'
    } catch {
        $discoveryFailures.Add($_.Exception.Message)
    }
}
if ($discoveryFailures.Count) { throw ($discoveryFailures -join "`n") }
$source = Get-Content $livePath -Raw
Assert-Contract (-not $source.Contains('$Token.Substring')) 'OAuth success console still prints token prefixes.'
Assert-Contract ($source.Contains('ConvertTo-LiveEvidenceJson $resultsObj')) 'Final writer bypasses evidence serialization.'
Assert-Contract (-not [regex]::IsMatch($source, '(?m)^.*\bWrite-Host\b[^\r\n]*\$')) 'Runner console has an unprotected dynamic sink.'
$rawDynamicSinks = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
    $node.GetCommandName() -eq 'Write-Host' -and
    $null -ne $node.Find({ param($child)
        $child -is [System.Management.Automation.Language.VariableExpressionAst]
    }, $true)
}, $true))
Assert-Contract ($rawDynamicSinks.Count -eq 0) 'Multiline dynamic runner console bypasses redaction.'
$trapTopology = @($ast.EndBlock.Traps)
$trapSource = ($trapTopology | ForEach-Object { $_.Extent.Text }) -join "`n"
foreach ($cleanupFails in @($false, $true)) {
    $cleanupMode = if ($cleanupFails) { '$true' } else { '$false' }
    $childCode = ". '$helper'; Initialize-LiveEvidence -Secrets @('synthetic-fatal-secret', 'synthetic-cleanup-secret'); " +
        '$script:cleanupObserved = $false; ' +
        "function Invoke-OrphanReconciliation { " +
        '$script:cleanupObserved = $true; ' +
        "Write-LiveEvidenceHost 'CLEANUP_OBSERVED echo synthetic-cleanup-secret'; " +
        "if ($cleanupMode) { throw 'cleanup failed echoed synthetic-cleanup-secret' } }; " +
        $trapSource + "; " +
        "try { throw 'caught synthetic-fatal-secret' } catch { " +
        "if (`$_.Exception.Message -cne 'caught synthetic-fatal-secret' -or `$script:cleanupObserved) { exit 9 }; " +
        "Write-LiveEvidenceHost 'CAUGHT_NEGATIVE_UNCHANGED' }; " +
        "throw 'fatal echoed synthetic-fatal-secret'"
    $childOutput = & pwsh -NoProfile -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))) 2>&1 | Out-String
    Assert-Contract ($LASTEXITCODE -eq 1) 'Full fatal trap topology lost the failure exit code.'
    Assert-Contract ($childOutput.Contains('CLEANUP_OBSERVED')) 'Full script-level trap topology skipped orphan cleanup.'
    Assert-Contract ($childOutput.Contains('CAUGHT_NEGATIVE_UNCHANGED')) 'Caught negative-test errors changed or triggered fatal cleanup.'
    Assert-Contract (-not $childOutput.Contains('synthetic-fatal-secret') -and -not $childOutput.Contains('synthetic-cleanup-secret')) 'Fatal/cleanup errors leaked through full trap topology.'
    Assert-Contract ($childOutput.Contains('Live runner aborted') -and $childOutput.Contains('fatal echoed')) 'Fatal diagnostic was lost after cleanup.'
    if ($cleanupFails) {
        Assert-Contract ($childOutput.Contains('cleanup failed echoed')) 'Cleanup callback failure was silently swallowed.'
    }
}
Assert-Contract ($trapTopology.Count -eq 1) 'Runner has competing script-level fatal traps.'
foreach ($wrapper in @('Invoke-RestMethod', 'Invoke-WebRequest')) {
    $definition = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $wrapper
    }.GetNewClosure(), $true)
    Assert-Contract ($definition.Extent.Text.Contains("Microsoft.PowerShell.Utility\$wrapper @PSBoundParameters")) 'HTTP wrapper stopped forwarding the original bound parameters.'
    Assert-Contract ($definition.Extent.Text.Contains('return $result')) 'HTTP wrapper stopped returning the original response.'
}
$gateSource = Get-Content (Join-Path $root 'scripts\pre-push-checks.ps1') -Raw
Assert-Contract ($gateSource.Contains("'live evidence: pre-serialization redaction contract'")) 'Default pre-push gate does not run the pure evidence contract.'
foreach ($keySet in @(
    @{ keys = @(@{ kid = 'synthetic-public-key'; kty = 'RSA'; n = 'public-modulus'; e = 'AQAB' }) },
    [ordered]@{ keys = @(@{ kid = 'synthetic-public-key'; kty = 'RSA'; n = 'public-modulus'; e = 'AQAB' }) },
    [pscustomobject]@{ keys = @([pscustomobject]@{ kid = 'synthetic-public-key'; kty = 'RSA'; n = 'public-modulus'; e = 'AQAB' }) }
)) {
    Initialize-LiveEvidence
    $before = ConvertTo-Json -InputObject $keySet -Depth 10 -Compress
    $roundTrip = ConvertTo-LiveEvidenceJson $keySet | ConvertFrom-Json
    Assert-Contract ($roundTrip.keys -is [array]) 'Singleton JWKS keys evidence changed from an array to an object.'
    Assert-Contract ($roundTrip.keys.Count -eq 1 -and $roundTrip.keys[0].kid -ceq 'synthetic-public-key') 'A keys-named member corrupted the public JWKS evidence shape.'
    Assert-Contract ($roundTrip.keys[0].n -ceq 'public-modulus') 'Public key metadata was lost.'
    Assert-Contract ((ConvertTo-Json -InputObject $keySet -Depth 10 -Compress) -ceq $before) 'JWKS evidence conversion mutated the original response.'
}
$arrayShape = ConvertTo-LiveEvidenceJson ([ordered]@{ empty = @(); single = @('public-value') }) | ConvertFrom-Json
Assert-Contract ($arrayShape.empty -is [array] -and $arrayShape.empty.Count -eq 0) 'Empty evidence array changed to null.'
Assert-Contract ($arrayShape.single -is [array] -and $arrayShape.single.Count -eq 1 -and $arrayShape.single[0] -ceq 'public-value') 'Singleton scalar evidence array lost its shape.'
foreach ($size in 0..2) {
    $items = [object[]]::new($size)
    for ($index = 0; $index -lt $size; $index++) { $items[$index] = "public-item-$index" }
    $wrapped = [psobject]::AsPSObject($items)
    $safeWrapped = ConvertTo-LiveEvidence $wrapped
    Assert-Contract ($safeWrapped -is [array] -and $safeWrapped.Count -eq $size) 'A PowerShell-wrapped array was mistaken for a custom object or a cycle.'
}
Initialize-LiveEvidence
$wrappedMaterial = [psobject]::AsPSObject(@('synthetic-wrapped-array-material'))
$safeWrappedMaterial = ConvertTo-LiveEvidence ([ordered]@{
    earlier = 'synthetic-wrapped-array-material'
    password = $wrappedMaterial
})
Assert-Contract ($safeWrappedMaterial.earlier -ceq '[REDACTED]' -and $safeWrappedMaterial.password -ceq '[REDACTED]') 'Wrapped array material was not discovered for earlier-sibling masking.'
Assert-Contract ($wrappedMaterial.Count -eq 1 -and $wrappedMaterial[0] -ceq 'synthetic-wrapped-array-material') 'Wrapped array discovery mutated the original value.'
Initialize-LiveEvidence
$keyedMaterial = 'synthetic-dictionary-material-with-keys-member'
$safe = ConvertTo-LiveEvidence ([ordered]@{
    earlier = $keyedMaterial
    password = @{ keys = @($keyedMaterial) }
})
Assert-Contract ($safe.earlier -ceq '[REDACTED]' -and $safe.password -ceq '[REDACTED]') 'A keys-named member bypassed nested material discovery.'
$script:materialPreparations = 0
function ConvertTo-Json {
    param($InputObject, [switch]$Compress, [int]$Depth = 2, [switch]$AsArray)
    if ($InputObject -is [string] -and $InputObject.StartsWith('synthetic-preparation-')) {
        $script:materialPreparations++
    }
    Microsoft.PowerShell.Utility\ConvertTo-Json @PSBoundParameters
}
try {
    Initialize-LiveEvidence -Secrets @('synthetic-preparation-first secret')
    $null = Convert-LiveEvidenceText 'warmup'
    $script:materialPreparations = 0
    foreach ($number in 1..10) {
        $text = Convert-LiveEvidenceText 'synthetic-preparation-first secret metadata'
        Assert-Contract ($text -ceq '[REDACTED] metadata') 'Repeated evidence changed its masking result.'
    }
    Assert-Contract ($script:materialPreparations -eq 0) 'Unchanged evidence material is re-encoded for every text field.'
    Add-LiveEvidenceSecret 'synthetic-preparation-first secret'
    $null = Convert-LiveEvidenceText 'duplicate registration'
    Assert-Contract ($script:materialPreparations -eq 0) 'Duplicate registration rebuilds evidence preparation.'
    Add-LiveEvidenceSecret 'synthetic-preparation-later/secret?'
    $encoded = [Uri]::EscapeDataString('synthetic-preparation-later/secret?')
    $text = Convert-LiveEvidenceText "synthetic-preparation-first secret $encoded"
    Assert-Contract ($text -ceq '[REDACTED] [REDACTED]') 'Newly discovered material is not masked immediately.'
    Assert-Contract ($script:materialPreparations -gt 0) 'New material did not rebuild the evidence preparation.'
    $afterDiscovery = $script:materialPreparations
    $null = Convert-LiveEvidenceText 'unchanged second generation'
    Assert-Contract ($script:materialPreparations -eq $afterDiscovery) 'Second-generation preparation was not reused.'
    Initialize-LiveEvidence -Secrets @('synthetic-preparation-newrun')
    $text = Convert-LiveEvidenceText 'synthetic-preparation-newrun synthetic-preparation-first secret'
    Assert-Contract ($text -ceq '[REDACTED] synthetic-preparation-first secret') 'A fresh run reused stale material with the same registry count.'
    $safe = ConvertTo-LiveEvidence ([ordered]@{
        earlier = 'synthetic-preparation-late-discovery'
        token = 'synthetic-preparation-late-discovery'
    })
    Assert-Contract ($safe.earlier -ceq '[REDACTED]' -and $safe.token -ceq '[REDACTED]') 'Preparation caching broke late-sibling discovery.'
} finally {
    Remove-Item -LiteralPath Function:\ConvertTo-Json
}
$orderedPlan = [ScimServer.LiveEvidence.PreparedReplacements]::new(@('overlap-value', 'overlap'))
Assert-Contract ($orderedPlan.Apply('overlap-value overlap') -ceq '[REDACTED] [REDACTED]') 'Prepared replacements changed overlap ordering.'
$regexPlan = [ScimServer.LiveEvidence.PreparedReplacements]::new(@([regex]::new('(?i:%2f)'), 'literal'))
Assert-Contract ($regexPlan.Apply('%2F %2f literal') -ceq '[REDACTED] [REDACTED] [REDACTED]') 'Prepared replacements changed mixed regex/string behavior.'
$duplicatePlan = [ScimServer.LiveEvidence.PreparedReplacements]::new(@('D', 'D'))
$duplicateReference = 'D'.Replace('D', '[REDACTED]').Replace('D', '[REDACTED]')
Assert-Contract ($duplicatePlan.Apply('D') -ceq $duplicateReference) 'Prepared replacements deduplicated ordered entries.'
$originalCulture = [Threading.Thread]::CurrentThread.CurrentCulture
try {
    [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('tr-TR')
    Initialize-LiveEvidence
    $cultureHeader = 'BAS' + [char]0x0130 + 'C synthetic-culture-material'
    Assert-Contract ([regex]::IsMatch($cultureHeader, '(?i)\bBasic\s+')) 'Culture regression did not exercise the existing authorization expression.'
    Assert-Contract ((Convert-LiveEvidenceText $cultureHeader) -ceq '[REDACTED]') 'Authorization discovery guard changed the regex culture semantics.'
} finally {
    [Threading.Thread]::CurrentThread.CurrentCulture = $originalCulture
}
Write-Host "PASS: $checks live evidence redaction assertions; no HTTP/runtime started."
