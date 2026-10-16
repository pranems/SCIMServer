$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gatePath = Join-Path $repoRoot 'scripts\entra-gallery-scim-e2e.ps1'
$wifWrapperPath = Join-Path $repoRoot 'scripts\wif-e2e-temporary-app.ps1'
$skillPath = Join-Path $repoRoot '.github\skills\entra-gallery-scim-e2e\SKILL.md'
$failures = @()
$mappingHelperPath = Join-Path $repoRoot 'scripts\entra-gallery-mapping.ps1'

function Assert-Contract {
    param(
        [Parameter(Mandatory)] [string]$Description,
        [Parameter(Mandatory)] [bool]$Condition
    )

    if ($Condition) {
        Write-Host "  PASS: $Description" -ForegroundColor Green
        return
    }

    Write-Host "  FAIL: $Description" -ForegroundColor Red
    $script:failures += $Description
}

Write-Host 'Entra gallery provisioning to SCIMServer E2E contract'

Assert-Contract 'reviewed custom-mapping helper exists' (Test-Path -LiteralPath $mappingHelperPath)
& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($gatePath, [ref]$null, [ref]$null)
    $binding = [scriptblock]::Create("[CmdletBinding()]`n$($ast.ParamBlock.Extent.Text)`n`$Modes.Count")
    $refused = $false
    try { & $binding -Modes @() | Out-Null }
    catch { $refused = $_.FullyQualifiedErrorId -like 'ParameterArgumentValidationError*' }
    Assert-Contract 'behavior: empty auth selection is rejected before any remote action' $refused
    Assert-Contract 'behavior: default auth selection retains all three transports' ((& $binding) -eq 3)
}
if (Test-Path -LiteralPath $mappingHelperPath) {
    & {
        . $mappingHelperPath
        $enterprise = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
        $extension = 'urn:scimserver:validation:gallery:2.0:User'
        $profile = @{
            schemas = @(@{ id = 'urn:ietf:params:scim:schemas:core:2.0:User'; attributes = 'all' })
            resourceTypes = @(@{
                name = 'User'
                schemaExtensions = @(@{ schema = $enterprise; required = $false })
            })
            settings = @{ preserved = $true }
        }
        $profileBefore = $profile | ConvertTo-Json -Depth 30 -Compress
        $extended = Add-GalleryUserExtensionProfile -Profile $profile
        Assert-Contract 'behavior: endpoint registers the same mapped attribute without losing profile state' (
            $extended.schemas.Count -eq 2 -and
            $extended.schemas[1].id -eq $extension -and
            $extended.schemas[1].attributes[0].name -eq 'costCode' -and
            $extended.resourceTypes[0].schemaExtensions.Count -eq 2 -and
            $extended.settings.preserved -eq $true -and
            ($profile | ConvertTo-Json -Depth 30 -Compress) -eq $profileBefore
        )
        $schema = @{
            directories = @(@{
                name = 'target'
                objects = @(@{
                    name = 'ScimUser'
                    attributes = @(@{
                        name = "${enterprise}:department"
                        type = 'String'
                        anchor = $false
                        required = $false
                    })
                })
            })
            synchronizationRules = @(@{
                name = 'USERGROUP_OUTBOUND_USERGROUP'
                targetDirectoryName = 'target'
                objectMappings = @(@{
                    sourceObjectName = 'User'
                    targetObjectName = 'ScimUser'
                    attributeMappings = @(@{
                        targetAttributeName = "${enterprise}:department"
                        source = @{ name = 'department'; expression = '[department]' }
                        flowType = 'Always'
                    })
                }, @{
                    sourceObjectName = 'Group'
                    targetObjectName = 'ScimGroup'
                    attributeMappings = @()
                })
            })
        }
        $before = $schema | ConvertTo-Json -Depth 30 -Compress
        $mapped = Add-GalleryCustomUserMapping -Schema $schema
        $mapping = $mapped.synchronizationRules[0].objectMappings[0]
        $attributes = $mapped.directories[0].objects[0].attributes
        Assert-Contract 'behavior: mapping registers the exact custom target and source expression' (
            $attributes.Count -eq 2 -and $attributes[1].name -eq "${extension}:costCode" -and
            $attributes[1].type -eq 'String' -and
            $mapping.attributeMappings.Count -eq 2 -and
            $mapping.attributeMappings[1].targetAttributeName -eq "${extension}:costCode" -and
            $mapping.attributeMappings[1].source.expression -eq '[department]'
        )
        Assert-Contract 'behavior: mapping preserves source schema and unrelated Group mappings' (
            ($schema | ConvertTo-Json -Depth 30 -Compress) -eq $before -and
            $mapped.synchronizationRules[0].objectMappings[1].targetObjectName -eq 'ScimGroup'
        )
        Assert-GalleryCustomUserMapping -Schema $mapped
        $mapped.synchronizationRules[0].objectMappings[0].attributeMappings[1].source.expression = '[jobTitle]'
        $refused = $false
        try { Assert-GalleryCustomUserMapping -Schema $mapped }
        catch { $refused = $_.Exception.Message -like '*read-back*' }
        Assert-Contract 'behavior: a wrong saved source expression fails read-back' $refused
        $mapped = Add-GalleryCustomUserMapping -Schema $schema
        $refused = $false
        try { Add-GalleryCustomUserMapping -Schema $mapped | Out-Null }
        catch { $refused = $_.Exception.Message -like '*already registered*' }
        Assert-Contract 'behavior: duplicate target registration is rejected' $refused

        $schema.directories[0].objects[0].attributes = @()
        $refused = $false
        try { Add-GalleryCustomUserMapping -Schema $schema | Out-Null }
        catch { $refused = $_.Exception.Message -like '*department attribute*' }
        Assert-Contract 'behavior: absent reviewed target template cannot fabricate a mapping' $refused
    }
}

Assert-Contract 'executable gate exists in SCIMServer' (Test-Path -LiteralPath $gatePath)
Assert-Contract 'temporary-app WIF proof wrapper exists in SCIMServer' (Test-Path -LiteralPath $wifWrapperPath)
Assert-Contract 'repository-local skill exists in SCIMServer' (Test-Path -LiteralPath $skillPath)

if ((Test-Path -LiteralPath $gatePath) -and (Test-Path -LiteralPath $skillPath)) {
    $parseErrors = @()
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
        $gatePath,
        [ref]$null,
        [ref]$parseErrors
    )
    Assert-Contract 'gate parses without errors' ($parseErrors.Count -eq 0)

    $gate = Get-Content -LiteralPath $gatePath -Raw
    $skill = Get-Content -LiteralPath $skillPath -Raw

    foreach ($required in @(
        'Get-ScimEstate',
        "Purpose 'dev'",
        'UserConfigDirPath',
        'provisionOnDemand',
        'TokenBasedBearerToken',
        'OAuth2ClientCredentialsGrant',
        'WorkloadIdentityClientAuthentication',
        'USERGROUP_OUTBOUND_USERGROUP',
        'SecretTokenBearerAuthEnabled',
        'OAuthClientCredentialsAuthEnabled',
        'WifCredentialsEnabled',
        'finally',
        'preexistingEndpointIds',
        'preexistingJobIds',
        'UNSUPPORTED',
        'BLOCKED',
        'test-results',
        'ConvertTo-Json'
    )) {
        Assert-Contract "gate contains required safety or coverage marker: $required" $gate.Contains($required)
    }

    Assert-Contract 'gate refuses non-dev estate targets' (
        $gate -match 'Purpose\s+-ne\s+''dev''' -or
        $gate -match 'Purpose\s+-ne\s+"dev"'
    )
    Assert-Contract 'gate verifies the active Graph tenant against the estate registry' (
        $gate -match 'activeTenantId' -and
        $gate -match 'estate\.Tenant\.tenantId' -and
        $gate -match 'does not match the registry dev tenant'
    )
    Assert-Contract 'gate refuses a gallery service principal that already has jobs' (
        $gate -match 'preexistingJobIds\.Count\s+-ne\s+0'
    )
    Assert-Contract 'Graph and SCIM collections never wrap a nullable property directly' (
        $gate -notmatch '@\(\(Invoke-(?:Graph|ScimAdmin)'
    )
    Assert-Contract 'gate verifies exact-ID cleanup' (
        $gate -match 'cleanup.*remaining' -and
        $gate -match 'preexistingEndpointIds'
    )
    Assert-Contract 'gate waits for synchronization-job cleanup convergence' (
        $gate -match 'deletion did not converge' -and
        $gate -match 'collection removal converged'
    )
    Assert-Contract 'gate waits for Graph account-state convergence before provisioning' (
        $gate -match 'Wait-GraphUserAccountEnabled' -and
        $gate -match 'accountEnabled did not converge' -and
        $gate.Contains('"users/${UserId}?`$select=accountEnabled"')
    )
    Assert-Contract 'gate retries until exported account state is visible in SCIM' (
        $gate -match 'Invoke-UserAccountStateProvision' -and
        $gate -match 'successful exports did not produce active='
    )
    Assert-Contract 'gate never persists synchronization secret values' (
        $gate -notmatch 'SecretToken\s*=\s*[^$\r\n]' -and
        $gate -match 'secretKeys'
    )
    Assert-Contract 'gate treats required auth-mode skips as failures' (
        $gate -match 'requiredMode' -and
        $gate -match "Status\s+-in\s+@\('BLOCKED',\s*'UNSUPPORTED',\s*'SKIPPED'\)"
    )
    Assert-Contract 'gate treats blocked plan-only prerequisites as failures' (
        $gate -match "scenario\s+-eq\s+'plan'" -and
        $gate -match "status\s+-eq\s+'BLOCKED'"
    )
    Assert-Contract 'artifact retention cannot produce a successful gate result' (
        $gate -match "cleanupResults.*Where-Object.*-not.*removed" -and
        $gate -notmatch "kind\s+-ne\s+'all'"
    )
    Assert-Contract 'group deprovision requires a semantic SCIM target-state assertion' (
        $gate -match "deprovision group'.*Wait-ScimResource" -or
        ($gate -match 'groupDeprovisionPath' -and $gate -match "Expectation 'group is absent'")
    )
    Assert-Contract 'WIF identifiers use connectivityParameters, never the secrets collection' (
        $gate.Contains('synchronization/connectivityParameters') -and
        $gate.Contains("key = 'entraApplicationIdentifier'") -and
        $gate.Contains("key = 'entraApplicationObjectIdentifier'") -and
        $gate -cnotmatch "key = 'EntraApplicationIdentifier'"
    )
    Assert-Contract 'gallery WIF creates and verifies exact owned federated-credential cleanup' (
        $gate.Contains('createdFederatedCredentials') -and
        $gate.Contains('federatedIdentityCredentials') -and
        $gate.Contains('Federated credential removal did not converge')
    )
    Assert-Contract 'every mode tears down its job before the next mode can configure the principal' (
        $gate -match 'finally\s*\{\s*if \(\$job\)' -and
        $gate.Contains('Remove-OwnedSynchronizationJob -JobId $job.id') -and
        $gate.Contains('$createdJobIds.Remove($JobId)')
    )
    Assert-Contract 'WIF configuration is allowlisted and cannot inherit tenant-wide sync policy' (
        $gate -notmatch 'foreach \(\$pair in \$referenceSecrets\)' -and
        $gate.Contains("key = 'SyncAll'; value = 'false'")
    )
    Assert-Contract 'existing federated trust is detected and requested modes are deduplicated' (
        $gate.Contains('existingGalleryFics') -and
        $gate.Contains('$Modes = @($Modes | Select-Object -Unique)')
    )
    Assert-Contract 'skill invokes the executable gate instead of duplicating it' (
        $skill.Contains('scripts\entra-gallery-scim-e2e.ps1')
    )
    Assert-Contract 'skill invokes the temporary-app WIF proof wrapper' (
        $skill.Contains('scripts\wif-e2e-temporary-app.ps1')
    )
    Assert-Contract 'skill documents no-production and no-existing-job boundaries' (
        $skill.Contains('production') -and
        $skill.Contains('pre-existing')
    )
}

if (Test-Path -LiteralPath $wifWrapperPath) {
    $wrapperParseErrors = @()
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
        $wifWrapperPath,
        [ref]$null,
        [ref]$wrapperParseErrors
    )
    Assert-Contract 'temporary-app WIF proof wrapper parses without errors' ($wrapperParseErrors.Count -eq 0)
    $wrapper = Get-Content -LiteralPath $wifWrapperPath -Raw
    Assert-Contract 'WIF wrapper verifies the active tenant before mutation' (
        $wrapper -match 'estate\.Tenant\.tenantId' -and
        $wrapper -match 'does not match the registry dev tenant'
    )
    Assert-Contract 'WIF wrapper keeps the admin token out of the child command line' (
        $wrapper.Contains('WIF_PROOF_ADMIN_TOKEN') -and
        $wrapper -notmatch '&\s+pwsh[\s\S]{0,300}-AdminToken'
    )
    Assert-Contract 'WIF wrapper snapshots and verifies owned endpoint cleanup' (
        $wrapper.Contains('preexistingEndpointIds') -and
        $wrapper.Contains("name -like 'wif-proof-*'") -and
        $wrapper.Contains('cleanupFailed')
    )
}

& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $gatePath, [ref]$null, [ref]$null
    )
    $definition = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Remove-OwnedSynchronizationJob'
    }, $true)
    if (-not $definition) {
        Assert-Contract 'per-mode teardown function is available for behavioral controls' $false
        return
    }
    . ([scriptblock]::Create($definition.Extent.Text))
    $createdJobIds = [System.Collections.Generic.List[string]]::new()
    $createdJobIds.Add('owned-job')
    $gallerySp = @{ id = 'owned-principal' }
    $state = @{ Deleted = $false; Retain = $false; Cleanup = $false; Calls = 0 }
    function Pause-SynchronizationJob { param($JobId) }
    function Start-Sleep { param($Seconds) }
    function Add-CleanupResult { param($Kind, $Id, $Removed, $Detail) $state.Cleanup = $Removed }
    function Invoke-Graph {
        param($Method, $Path)
        $state.Calls++
        if ($Method -eq 'DELETE') { $state.Deleted = $true; return }
        @{ value = if ($state.Retain) { @(@{ id = 'owned-job' }) } else { @() } }
    }
    Remove-OwnedSynchronizationJob -JobId 'owned-job'
    Assert-Contract 'behavior: confirmed deletion releases the job for the next mode' (
        $state.Deleted -and $state.Cleanup -and $createdJobIds.Count -eq 0
    )
    $callsBefore = $state.Calls
    $refused = $false
    try { Remove-OwnedSynchronizationJob -JobId 'unowned-job' } catch { $refused = $_.Exception.Message -like 'Refusing to delete*' }
    Assert-Contract 'behavior: unowned job deletion is refused before Graph mutation' (
        $refused -and $state.Calls -eq $callsBefore
    )
    $createdJobIds.Add('owned-job')
    $state.Retain = $true
    $state.Cleanup = $false
    $failed = $false
    try { Remove-OwnedSynchronizationJob -JobId 'owned-job' } catch { $failed = $_.Exception.Message -like '*deletion did not converge*' }
    Assert-Contract 'behavior: unconfirmed deletion throws and retains ownership for final cleanup' (
        $failed -and -not $state.Cleanup -and $createdJobIds.Contains('owned-job')
    )
}

& {
    . $mappingHelperPath
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($gatePath, [ref]$null, [ref]$null)
    $definition = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Invoke-ModeScenario'
    }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
    $gallerySp = @{ id = 'owned-principal' }
    $runId = 'contract'
    $graphRoot = 'https://graph.invalid'
    $ruleName = 'USERGROUP_OUTBOUND_USERGROUP'
    $KeepArtifacts = $false
    $state = @{}
    function Add-Result {
        param($Scenario, $Check, $Status, $Detail)
        $state.Checks.Add("$Status/$Check")
        if ($Status -eq 'FAIL') { $state.FailureDetail = $Detail }
    }
    function New-ModeContext {
        param($Mode)
        @{ Slug = $Mode; TargetBase = 'https://scim.invalid'; VerificationHeaders = @{};
            Secrets = @(); ConnectivityParameters = @(@{ key = 'authenticationType'; value = 'wif' }) }
    }
    function New-SynchronizationJob { @{ id = 'owned-job' } }
    function Set-SynchronizationSecrets { param($Pairs) }
    function Set-TestSynchronizationMappings { param($JobId) Get-SynchronizationRule -JobId $JobId }
    function Get-SynchronizationRule {
        param($JobId)
        @{ id = 'rule'; objectMappings = @(
            @{ sourceObjectName = 'User'; targetObjectName = 'User' },
            @{ sourceObjectName = 'Group'; targetObjectName = 'Group' }
        ) }
    }
    function New-SourceUser {
        param($ModeSlug, $Suffix)
        @{ User = @{ id = 'source-user'; userPrincipalName = 'owned@example.invalid' };
            Department = 'SCIM Validation'; AssignmentIds = @('assignment') }
    }
    function New-SourceGroup {
        param($ModeSlug)
        @{ Group = @{ id = 'source-group'; displayName = 'Owned Group' }; AssignmentIds = @('assignment') }
    }
    function Invoke-ExpectedProvision {
        param($JobId, $RuleId, $ObjectId, $ObjectType, $Operation)
        @{ Result = 'Success' }
    }
    function Invoke-ScopedChangeProvision {
        param($JobId, $RuleId, $ObjectId, $ObjectType, $Operation)
        'provisionOnDemand'
    }
    function Invoke-Graph {
        param($Method, $Path, $Body)
        if ($Path -like '*connectivityParameters') {
            return @{ value = @(@{ key = 'authenticationType'; value = 'wif' }) }
        }
        if ($Method -eq 'PATCH' -and $Body.Contains('displayName')) { $state.Name = $Body.displayName }
        if ($Method -eq 'PATCH' -and $Body.Contains('department')) { $state.Department = $Body.department }
        if ($Path -like 'groups/*/members*') { $state.HasMember = $Method -eq 'POST' }
        if ($Method -eq 'DELETE' -and $Path -like 'groups/*/appRoleAssignments/*') { $state.GroupGone = $true }
        if ($Method -eq 'DELETE' -and $Path -like 'users/*/appRoleAssignments/*') { $state.UserGone = $true }
    }
    function Wait-GraphUserAccountEnabled { param($UserId, $Expected) }
    function Wait-GraphGroupMembership { param($GroupId, $MemberId, $Present) }
    function Invoke-UserAccountStateProvision {
        param($JobId, $RuleId, $ObjectId, $UserName, $Headers, $Expected, $Operation)
        @{ id = 'scim-user'; active = $Expected }
    }
    function Wait-ScimResource {
        param($ResourceType, $Attribute, $Value, $Headers, $Predicate, $Expectation)
        if ($state.FailGroup -and $ResourceType -eq 'Groups') { throw 'Controlled Group wait failure.' }
        if ($state.FailUpdate -and $ResourceType -eq 'Users' -and $state.Department -eq 'SCIM Validation Updated') {
            throw 'Controlled User update wait failure.'
        }
        $resource = if ($ResourceType -eq 'Users') {
            @{ id = 'scim-user'; displayName = $state.Name; active = -not $state.UserGone;
                schemas = @($script:galleryExtensionUrn);
                $script:galleryExtensionUrn = @{ costCode = $state.Department } }
        }
        elseif (-not $state.GroupGone) {
            @{ id = 'scim-group'; displayName = $Value;
                members = if ($state.HasMember) { @(@{ value = 'scim-user' }) } else { @() } }
        }
        if (-not (& $Predicate $resource)) { throw "Behavioral fixture failed predicate: $Expectation" }
        $resource
    }
    function Get-SafeExceptionDetail { param($ErrorRecord) $ErrorRecord.Exception.Message }
    function Remove-OwnedSynchronizationJob { param($JobId) $state.Teardown = $true }

    foreach ($mode in @('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity')) {
        $state = @{
            Checks = [System.Collections.Generic.List[string]]::new()
            Department = 'SCIM Validation'
            HasMember = $false; GroupGone = $false; UserGone = $false; Teardown = $false
        }
        Invoke-ModeScenario -Mode $mode
        $missing = @(@('create group', 'update group', 'add group member', 'remove group member', 'deprovision group') |
            Where-Object { "PASS/$_" -notin $state.Checks })
        Assert-Contract "behavior: $mode executes Group CRUD and both membership outcomes" (
            $missing.Count -eq 0
        )
        Assert-Contract "behavior: $mode verifies custom create/update and releases its job" (
            'PASS/create custom extension' -in $state.Checks -and
            'PASS/update custom extension' -in $state.Checks -and
            'PASS/mode outcome' -in $state.Checks -and $state.Teardown
        )
    }
    $state = @{
        Checks = [System.Collections.Generic.List[string]]::new()
        Department = 'SCIM Validation'; FailGroup = $true
    }
    Invoke-ModeScenario -Mode WorkloadIdentity
    Assert-Contract 'behavior: Group timeout identifies the actual failing provisioning stage' (
        $state.FailureDetail -like 'provision source group:*Controlled Group wait failure*' -and
        $state.Teardown
    )
    $state = @{
        Checks = [System.Collections.Generic.List[string]]::new()
        Department = 'SCIM Validation'; FailUpdate = $true
    }
    Invoke-ModeScenario -Mode WorkloadIdentity
    Assert-Contract 'behavior: User update timeout identifies the update stage and still releases its job' (
        $state.FailureDetail -like 'update source user:*Controlled User update wait failure*' -and
        $state.Teardown
    )
}

& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($gatePath, [ref]$null, [ref]$null)
    $definition = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Write-Reports'
    }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
    $Modes = @('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity')
    $runId = 'report-contract'
    $startedAt = [DateTimeOffset]::UtcNow
    $tenantDomain = 'example.invalid'
    $GalleryServicePrincipalName = 'contract-fixture'
    $script:serverVersion = 'contract-only'
    $cleanupResults = @(@{ removed = $true })
    $provisioningObservations = @(@{ operation = 'update user'; action = 'Update' })
    $secretKeys = [System.Collections.Generic.HashSet[string]]::new()
    $OutputDirectory = Join-Path $repoRoot "test-results\gallery-report-contract\$([guid]::NewGuid())"
    try {
        foreach ($case in @('valid', 'missing', 'duplicates', 'plan', 'empty modes')) {
            $Modes = @('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity')
            $PlanOnly = $case -eq 'plan'
            $results = @(
                foreach ($mode in $Modes) {
                    foreach ($check in @('create custom extension', 'update custom extension')) {
                        @{ scenario = "auth:$mode"; check = $check; status = 'PASS' }
                    }
                }
            )
            if ($case -eq 'missing') { $results = @($results | Select-Object -First 5) }
            if ($case -eq 'duplicates') {
                $results | ForEach-Object { $_.scenario = 'auth:SecretToken' }
            }
            if ($case -eq 'empty modes') { $Modes = @() }
            Write-Reports
            $saved = Get-Content -LiteralPath (Join-Path $OutputDirectory 'result.json') -Raw | ConvertFrom-Json
            $expected = if ($case -eq 'valid') { 'PASS:*' } elseif ($case -eq 'plan') { 'NOT_RUN:*' } else { 'FAIL:*' }
            Assert-Contract "behavior: custom report disposition is truthful for $case evidence" (
                $saved.customExtensionDisposition -like $expected
            )
            if ($case -eq 'valid') {
                Assert-Contract 'behavior: report persists provisioning observations independently of acceptance results' (
                    $null -ne $saved.provisioningObservations -and
                    @($saved.provisioningObservations).Count -eq 1 -and
                    $saved.schemaVersion -eq '1.1.0' -and
                    $saved.provisioningObservations[0].operation -eq 'update user'
                )
            }
        }
    }
    finally {
        foreach ($name in @('result.json', 'summary.md')) {
            $path = Join-Path $OutputDirectory $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
        }
        if (Test-Path -LiteralPath $OutputDirectory) { Remove-Item -LiteralPath $OutputDirectory }
    }
}

& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($gatePath, [ref]$null, [ref]$null)
    foreach ($name in @('Get-ProvisionOutcome', 'Invoke-ProvisionOnDemand', 'Add-ProvisionObservation', 'Invoke-ExpectedProvision', 'Invoke-ScopedChangeProvision')) {
        $definition = $ast.Find({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
        }, $true)
        . ([scriptblock]::Create($definition.Extent.Text))
    }
    $gallerySp = @{ id = 'owned-principal' }
    $state = @{ Responses = [System.Collections.Generic.Queue[object]]::new(); Starts = 0 }
    $provisioningObservations = [System.Collections.Generic.List[object]]::new()
    function Start-Sleep { param($Seconds) }
    function Invoke-Graph {
        param($Method, $Path, $Body)
        if ($Method -eq 'POST' -and $Path.EndsWith('/provisionOnDemand')) {
            return $state.Responses.Dequeue()
        }
        if ($Method -eq 'POST' -and $Path.EndsWith('/start')) {
            $state.Starts++
            return
        }
        throw "Unexpected contract Graph call: $Method $Path"
    }
    $importOnly = @{
        key = '{"result":"Success"}'
        value = '{"action":"Skip","provisioningSteps":[{"name":"EntryImport","type":"Import","status":"Success"}]}'
    }
    $export = @{
        key = '{"result":"Success"}'
        value = '{"action":"Update","secret":"must-not-persist","provisioningSteps":[{"name":"EntryExportUpdate","type":"Export","status":"Success"}]}'
    }
    $state.Responses.Enqueue($importOnly)
    $state.Responses.Enqueue($export)
    $outcome = Invoke-ExpectedProvision -JobId owned-job -RuleId rule -ObjectId owned-user -ObjectType User -Operation 'update user'
    Assert-Contract 'behavior: every real provisioning retry records its own operation, attempt and export outcome' (
        $outcome.HasSuccessfulExport -and $provisioningObservations.Count -eq 2 -and
        $provisioningObservations[0].operation -eq 'update user' -and
        $provisioningObservations[0].attempt -eq 1 -and
        -not $provisioningObservations[0].hasSuccessfulExport -and
        $provisioningObservations[1].attempt -eq 2 -and
        $provisioningObservations[1].action -eq 'Update' -and
        $provisioningObservations[1].objectId -eq 'owned-user'
    )
    $state.Responses.Enqueue($importOnly)
    $path = Invoke-ScopedChangeProvision -JobId owned-job -RuleId rule -ObjectId owned-group -ObjectType Group -Operation 'create group'
    Assert-Contract 'behavior: scheduled fallback retains the observed Group outcome without claiming an export' (
        $path -eq 'scheduled-sync-fallback' -and $state.Starts -eq 1 -and
        $provisioningObservations.Count -eq 3 -and
        $provisioningObservations[2].path -eq 'scheduled-sync-fallback' -and
        $provisioningObservations[2].objectType -eq 'Group' -and
        -not $provisioningObservations[2].hasSuccessfulExport
    )
    Assert-Contract 'behavior: provisioning observations contain metadata only, not raw response secrets' (
        $provisioningObservations.Count -gt 0 -and
        ($provisioningObservations | ConvertTo-Json -Depth 8) -notlike '*must-not-persist*' -and
        $provisioningObservations[0].observedAt -match '^\d{4}-\d{2}-\d{2}T.*Z$'
    )
    $allowedKeys = @(
        'observedAt', 'operation', 'jobId', 'objectId', 'objectType', 'attempt',
        'result', 'action', 'stepStatuses', 'hasSuccessfulExport', 'path'
    )
    Assert-Contract 'behavior: every observation has exactly the documented metadata keys' (
        @($provisioningObservations | Where-Object {
            @($_.PSObject.Properties.Name).Count -ne $allowedKeys.Count -or
            @($_.PSObject.Properties.Name | Where-Object { $_ -notin $allowedKeys }).Count -gt 0
        }).Count -eq 0 -and
        $provisioningObservations[1].stepStatuses -eq 'EntryExportUpdate=Success'
    )
    $state.Responses.Enqueue(@{
        key = '{"result":"Failure","details":{"errorCode":"ControlledFailure"}}'
        value = '{"action":"Update","provisioningSteps":[{"name":"EntryExportUpdate","type":"Export","status":"Failure"}]}'
    })
    $failure = $null
    try {
        Invoke-ExpectedProvision -JobId owned-job -RuleId rule -ObjectId owned-user -ObjectType User -Operation 'failed update' | Out-Null
    }
    catch { $failure = $_.Exception.Message }
    Assert-Contract 'behavior: a failed export remains a thrown failure with its observation retained' (
        $failure -like '*failed update provisionOnDemand failed:*ControlledFailure*' -and
        $provisioningObservations.Count -eq 4 -and
        $provisioningObservations[3].result -eq 'Failure' -and
        -not $provisioningObservations[3].hasSuccessfulExport
    )
}

if ($failures.Count -gt 0) {
    throw "Entra gallery E2E contract failed: $($failures -join '; ')"
}

Write-Output 'Entra gallery E2E contract: all checks passed'
