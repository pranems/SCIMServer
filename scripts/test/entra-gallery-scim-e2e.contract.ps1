$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gatePath = Join-Path $repoRoot 'scripts\entra-gallery-scim-e2e.ps1'
$wifWrapperPath = Join-Path $repoRoot 'scripts\wif-e2e-temporary-app.ps1'
$skillPath = Join-Path $repoRoot '.github\skills\entra-gallery-scim-e2e\SKILL.md'
$failures = @()

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

if ($failures.Count -gt 0) {
    throw "Entra gallery E2E contract failed: $($failures -join '; ')"
}

Write-Output 'Entra gallery E2E contract: all checks passed'
