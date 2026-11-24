$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pipeline = Join-Path $repoRoot 'scripts\dev-deployment-pipeline.ps1'
$fullValidationPipeline = Join-Path $repoRoot 'scripts\full-validation-pipeline.ps1'
$verifyDeployment = Join-Path $repoRoot 'scripts\verify-deployment.ps1'
$failures = @()

function Invoke-Assert {
    param(
        [Parameter(Mandatory)] [string]$Description,
        [Parameter(Mandatory)] [bool]$Condition
    )

    if ($Condition) {
        Write-Host "  PASS: $Description" -ForegroundColor Green
    }
    else {
        Write-Host "  FAIL: $Description" -ForegroundColor Red
        $script:failures += $Description
    }
}

Write-Host 'Dev deployment pipeline evidence contract'
Write-Host "  Script under test: $pipeline"

Invoke-Assert -Description 'pipeline script exists' -Condition (Test-Path -LiteralPath $pipeline)
Invoke-Assert -Description 'full validation pipeline script exists' -Condition (Test-Path -LiteralPath $fullValidationPipeline)

$parseErrors = @()
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    $pipeline, [ref]$null, [ref]$parseErrors
)
Invoke-Assert -Description 'pipeline script parses without errors' -Condition ($parseErrors.Count -eq 0)

$content = Get-Content -LiteralPath $pipeline -Raw
$fullValidationContent = Get-Content -LiteralPath $fullValidationPipeline -Raw
$verifyDeploymentContent = Get-Content -LiteralPath $verifyDeployment -Raw
$backendMatrixContent = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\test-all-modes.ps1') -Raw
Invoke-Assert -Description 'the direct Prisma E2E gate keeps serial assertions while suppressing application console chatter' `
    -Condition ($content.Contains("Invoke-Gate '2.2' 'API E2E jest (1,217 baseline, prisma)' { npm run test:e2e -- --runInBand --silent }"))
Invoke-Assert -Description 'the Prisma matrix lane uses the same serial quiet-console command' `
    -Condition ($backendMatrixContent.Contains("-Command 'npm run test:e2e -- --runInBand --silent'"))
Invoke-Assert -Description 'Stage 4.8 executes the full Entra gallery gate without mode or retention overrides' `
    -Condition ($content.Contains("Invoke-Gate '4.8' 'Entra gallery provisioning vs dev'") -and
        $content.Contains('scripts/entra-gallery-scim-e2e.ps1 -OutputDirectory $galleryOutputDirectory') -and
        $content.Contains('$galleryEvidence.serverVersion -ne $version'))
Invoke-Assert -Description 'Playwright keeps the readable line reporter' `
    -Condition ($content -match 'playwright\s+test\s+--reporter=line,json')
$writesJsonReport = ($content -match '\$playwrightJsonPath\s*=\s*Join-Path\s+\$ReportDir') -and
    ($content -match 'PLAYWRIGHT_JSON_OUTPUT_FILE\s*=\s*\$playwrightJsonPath') -and
    ($content -match 'playwright-dev-\$timestamp\.json')
Invoke-Assert -Description 'Playwright writes machine-readable results under the deployment report directory' `
    -Condition $writesJsonReport
$restoresJsonReporter = ($content -match 'previousPlaywrightJsonOutput') -and ($content -match "(?s)SetEnvironmentVariable\(\s*'PLAYWRIGHT_JSON_OUTPUT_FILE'")
Invoke-Assert -Description 'Playwright reporter environment is restored after the gate' `
    -Condition $restoresJsonReporter
$enablesCompleteShapeCoverage = $content -match "E2E_SHAPE_COVERAGE\s*=\s*'1'"
Invoke-Assert -Description 'Playwright enables the complete seeded profile-shape matrix' `
    -Condition $enablesCompleteShapeCoverage
$rejectsSkippedBrowserCases = ($content -match 'stats\.skipped') -and
    ($content -match 'Playwright reported \$skippedBrowserCases skipped case')
Invoke-Assert -Description 'Playwright fails the authoritative gate when any browser case is skipped' `
    -Condition $rejectsSkippedBrowserCases
$restoresDevOnlyBrowserFlags = ($content -match 'previousE2EAllowMutations') -and
    ($content -match 'previousE2EShapeCoverage') -and
    ($content -match "(?s)SetEnvironmentVariable\(\s*'E2E_ALLOW_MUTATIONS'") -and
    ($content -match "(?s)SetEnvironmentVariable\(\s*'E2E_SHAPE_COVERAGE'")
Invoke-Assert -Description 'Playwright restores dev-only browser flags before later promotion stages' `
    -Condition $restoresDevOnlyBrowserFlags
$promotionClearsDevOnlyBrowserFlags = ($verifyDeploymentContent -match 'previousE2EAllowMutations') -and
    ($verifyDeploymentContent -match 'previousE2EShapeCoverage') -and
    ($verifyDeploymentContent -match '(?s)SetEnvironmentVariable\(\s*''E2E_ALLOW_MUTATIONS'',\s*\$null') -and
    ($verifyDeploymentContent -match '(?s)SetEnvironmentVariable\(\s*''E2E_SHAPE_COVERAGE'',\s*\$null')
Invoke-Assert -Description 'promotion verification clears inherited dev-only browser flags' `
    -Condition $promotionClearsDevOnlyBrowserFlags

$usesOwnedPostgres = ($content -match 'scimserver\.owner=dev-deployment-pipeline') -and
    ($content -match 'scimserver\.run=\$postgresRunId') -and
    ($content -match '127\.0\.0\.1::5432') -and
    ($content -match 'type=tmpfs,destination=/var/lib/postgresql/data')
Invoke-Assert -Description 'Stage 2 uses a labeled task-owned PostgreSQL container on a random loopback port with tmpfs storage' `
    -Condition $usesOwnedPostgres

$buildsValidPostgresUrl = ($content -match '\$env:DATABASE_URL\s*=\s*''\{0\}://\{1\}:\{2\}@\{3\}:\{4\}/\{5\}\?schema=public''\s*-f') -and
    ($content -match '''postgresql'',\s*''scim'',\s*''scim'',\s*''127\.0\.0\.1'',\s*\$postgresPort,\s*''scimdb''')
Invoke-Assert -Description 'Stage 2 constructs a valid PostgreSQL URL without embedding a credential URI literal' `
    -Condition $buildsValidPostgresUrl

$rejectsSharedDatabase = ($content -notmatch 'docker ps --filter "publish=5432"') -and
    ($content -notmatch 'docker rm -f scim-dev-pipeline-pg')
Invoke-Assert -Description 'Stage 2 never reuses a listener on port 5432 or removes a fixed-name container' `
    -Condition $rejectsSharedDatabase

$guardsExactCleanup = ($content -match 'Assert-OwnedPostgresContainer') -and
    ($content -match 'docker rm -f \$postgresContainerId') -and
    ($content -match 'exact owned PostgreSQL container was not removed')
Invoke-Assert -Description 'Stage 2 verifies ownership before exact-ID cleanup and verifies removal' `
    -Condition $guardsExactCleanup

$localMirrorIsNonShipping = ($content -match '\$localMirrorTag\s*=\s*"local-\$ImageTag"') -and
    ($content -notmatch '"\$RegistryAcr/scimserver:latest"\s*\r?\n\s*\)')
Invoke-Assert -Description 'the optional local ACR mirror uses a non-shipping tag and never overwrites latest' `
    -Condition $localMirrorIsNonShipping

$importsImmutableAndLatest = ($content -match '--image\s+"scimserver:\$\{version\}"') -and
    ($content -match '--image\s+''scimserver:latest''')
Invoke-Assert -Description 'ACR version and latest are both imported from the CI-built GHCR artifact' `
    -Condition $importsImmutableAndLatest

$preservesSemanticTag = ($content -match '\$existingVersionDigest') -and
    ($content -match '\$previousVersion') -and
    ($content -match '\$runtimeInputsChanged') -and
    ($content -match 'semantic version tag already exists; reusing immutable artifact') -and
    ($content -match 'Runtime image inputs changed without a version bump')
Invoke-Assert -Description 'an existing semantic version is reused and runtime changes require a version bump' `
    -Condition $preservesSemanticTag

$deploysVerifiedDigest = ($content -match '\$runtimeSourceCommit') -and
    ($content -match '\$sourceShaDigest') -and
    ($content -match 'Semantic tag matches runtime source SHA digest') -and
    ($content -match '\$verifiedGhcrDigest') -and
    ($content -match '\$deployImage\s*=\s*"\$RegistryGhcr@\$verifiedGhcrDigest"') -and
    ($content -match '--source\s+"\$\{RegistryGhcr\}@\$\{verifiedGhcrDigest\}"')
Invoke-Assert -Description 'publication binds semantic tags to the runtime source SHA and deploys the verified digest' `
    -Condition $deploysVerifiedDigest

$verifiesRegistryDigestParity = ($content -match 'GHCR and ACR version/latest digest parity') -and
    ($content -match '\$ghcrDigest\s+-ne\s+\$acrVersionDigest') -and
    ($content -match '\$ghcrDigest\s+-ne\s+\$acrLatestDigest')
Invoke-Assert -Description 'the pipeline verifies GHCR, ACR version, and ACR latest digest parity' `
    -Condition $verifiesRegistryDigestParity

$waitsForExactRevision = ($content -match '\$expectedRevision\s*=\s*"\$DevAppName--\$revisionSuffix"') -and
    ($content -match 'latestRevisionName') -and
    ($content -match 'latestReadyRevisionName') -and
    ($content -match 'trafficWeight') -and
    ($content -match '\$consecutiveReadyChecks\s+-ge\s+2')
Invoke-Assert -Description 'dev readiness requires the exact intended revision healthy at 100 percent plus two authenticated probes' `
    -Condition $waitsForExactRevision

Invoke-Assert -Description 'local Docker validation refreshes base images even when layer cache is disabled' `
    -Condition ($fullValidationContent -match 'docker\s+compose\s+build\s+--no-cache\s+--pull')

$isolatesDockerValidation = ($fullValidationContent -match '\$DockerProjectName') -and
    ($fullValidationContent -match '\$env:COMPOSE_PROJECT_NAME') -and
    ($fullValidationContent -match '\$env:API_HOST_PORT\s*=\s*\[string\]\$DockerPort') -and
    ($fullValidationContent -match '\$env:POSTGRES_HOST_PORT\s*=\s*\[string\]\$DockerPostgresPort') -and
    ($fullValidationContent -match 'docker compose port api 8080') -and
    ($fullValidationContent -notmatch 'Get-FreeTcpPort')
Invoke-Assert -Description 'local Docker validation lets Docker atomically allocate host ports for a unique Compose project' `
    -Condition $isolatesDockerValidation

$composeContent = Get-Content -LiteralPath (Join-Path $repoRoot 'docker-compose.yml') -Raw
$parameterizesCompose = ($composeContent -match '\$\{BIND_HOST_IP:-0\.0\.0\.0\}:\$\{API_HOST_PORT:-8080\}:8080') -and
    ($composeContent -match '\$\{BIND_HOST_IP:-0\.0\.0\.0\}:\$\{POSTGRES_HOST_PORT:-5432\}:5432') -and
    ($composeContent -match '\$\{API_CONTAINER_NAME:-scimserver-api\}') -and
    ($composeContent -match '\$\{POSTGRES_CONTAINER_NAME:-scimserver-postgres\}')
Invoke-Assert -Description 'docker-compose keeps standard defaults while allowing isolated validation bindings' `
    -Condition $parameterizesCompose

$usesNumericLoopback = $fullValidationContent -match '\$dockerBaseUrl\s*=\s*"http://127\.0\.0\.1:\$dockerPort"'
Invoke-Assert -Description 'isolated Docker live tests use numeric loopback rather than host DNS' `
    -Condition $usesNumericLoopback

$failsWhenLiveTestsFail = ($fullValidationContent -match '\$phase1Result\s+-eq\s+"FAILED"') -and
    ($fullValidationContent -match '\$phase2Result\s+-eq\s+"FAILED"') -and
    ($fullValidationContent -match 'exit 1')
Invoke-Assert -Description 'full validation exits nonzero when either live-test lane fails' `
    -Condition $failsWhenLiveTestsFail

$usesNamedLiveArguments = ($fullValidationContent -match '\$localLiveArgs\s*=\s*@\{') -and
    ($fullValidationContent -match '\$dockerLiveArgs\s*=\s*@\{') -and
    ($fullValidationContent -match '&\s+\$liveTestScript\s+@localLiveArgs') -and
    ($fullValidationContent -match '&\s+\$liveTestScript\s+@dockerLiveArgs')
Invoke-Assert -Description 'full validation invokes both live lanes with named hashtable splatting' `
    -Condition $usesNamedLiveArguments

$checksLiveExitCodes = ([regex]::Matches(
    $fullValidationContent,
    'if\s*\(\$LASTEXITCODE\s+-ne\s+0\)\s*\{\s*throw\s+"Live tests'
).Count -eq 2)
Invoke-Assert -Description 'full validation turns both child live-test exit codes into gate failures' `
    -Condition $checksLiveExitCodes

$cleansValidationEstate = ($fullValidationContent -match '\[switch\]\$KeepDocker') -and
    ($fullValidationContent -match '(?m)^function Stop-ValidationCompose') -and
    ($fullValidationContent -match '(?m)^function Complete-ValidationCompose') -and
    ($fullValidationContent -match 'docker compose --project-directory \$repoRoot down --volumes --remove-orphans') -and
    ($fullValidationContent -match 'if\s*\(\$KeepDocker\)') -and
    ([regex]::Matches($fullValidationContent, 'Complete-ValidationCompose').Count -ge 5)
Invoke-Assert -Description 'full validation removes its containers, network, and volume by default with explicit opt-in retention' `
    -Condition $cleansValidationEstate

$usesRunUniqueProject = ($fullValidationContent -match '\[guid\]::NewGuid\(\)') -and
    ($fullValidationContent -notmatch 'scimserver-validation-\$PID')
Invoke-Assert -Description 'default validation project identity remains unique after the launching process exits' `
    -Condition $usesRunUniqueProject

& {
    $prunePath = Join-Path $repoRoot 'scripts\prune-revisions.ps1'
    $pruneAst = [System.Management.Automation.Language.Parser]::ParseFile($prunePath, [ref]$null, [ref]$null)
    $Subscription = 'synthetic-approved-subscription'
    $subscriptionArgs = @()
    $scopeAssignment = $pruneAst.Find({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$subscriptionArgs'
    }, $true)
    if ($scopeAssignment) { . ([scriptblock]::Create($scopeAssignment.Extent.Text)) }
    $commands = @($pruneAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'az'
    }, $true))
    $AppName = 'current-dev'
    $ResourceGroup = 'current-group'
    $r = @{ name = 'owned-old-revision' }
    $state = @{}
    function az { $state.Args = @($args); $global:LASTEXITCODE = 0; return '[]' }
    Invoke-Assert 'pruning has exactly three cloud operations and no automatic account switch' ($commands.Count -eq 3)
    foreach ($command in $commands) {
        & ([scriptblock]::Create($command.Extent.Text)) | Out-Null
        $index = [array]::IndexOf($state.Args, '--subscription')
        Invoke-Assert "executed pruning operation keeps explicit scope without switching account: $($command.CommandElements[1].Extent.Text)" `
            ($state.Args[0] -eq 'containerapp' -and $index -ge 0 -and $state.Args[$index + 1] -eq $Subscription)
    }
    Invoke-Assert 'dev pipeline passes admitted subscription to its pruning dependency' `
        ($content.Contains("'prune-revisions.ps1') -ResourceGroup " + '$DevResourceGroup -AppName $DevAppName -Keep $devKeep -Subscription $devSubscriptionId'))
    $Subscription = $null
    if ($scopeAssignment) { . ([scriptblock]::Create($scopeAssignment.Extent.Text)) }
    Invoke-Assert 'standalone pruning without explicit scope preserves optional caller behavior without a switch' `
        (@($subscriptionArgs).Count -eq 0)
}

& {
    . (Join-Path $repoRoot 'scripts\scim-estates.ps1')
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($pipeline, [ref]$null, [ref]$null)
    $active = Get-ScimEstate -Purpose dev
    $canaryEstate = Get-ScimEstate -Purpose 'canary-prod'
    $devSubscriptionId = $active.Tenant.subscriptionId
    $registrySubscriptionId = $null
    $canarySubscriptionId = $null
    $canaryAdmission = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.IfStatementAst] -and
        $node.Extent.Text.StartsWith('if ($AutoCanary -and -not $SkipDeploy)') -and
        $node.Extent.Text.Contains('$canarySubscriptionId =')
    }, $true)
    $AutoCanary = $true
    $SkipDeploy = $false
    $CanaryAppName = $null
    $CanaryResourceGroup = $null
    if ($canaryAdmission) { . ([scriptblock]::Create($canaryAdmission.Extent.Text)) }
    Invoke-Assert 'canary defaults and scope derive from the actual current-role admission block' `
        ($CanaryAppName -eq $canaryEstate.appName -and $CanaryResourceGroup -eq $canaryEstate.resourceGroup -and
            $canarySubscriptionId -eq $canaryEstate.Tenant.subscriptionId)
    if ($canaryAdmission) {
        $CanaryAppName = 'foreign-canary'
        $rejected = $false
        try { . ([scriptblock]::Create($canaryAdmission.Extent.Text)) } catch {
            $rejected = $_.Exception.Message.Contains('Canary target mismatch')
        }
        Invoke-Assert 'foreign explicit canary target is rejected before any cloud command' $rejected
        $CanaryAppName = $canaryEstate.appName
    }
    $scopeAssignment = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$registrySubscriptionId'
    }, $true)
    if ($scopeAssignment) { . ([scriptblock]::Create($scopeAssignment.Extent.Text)) }
    $acrCommands = @($ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'az' -and $node.CommandElements[1].Extent.Text -eq 'acr'
    }, $true))
    $canaryCommand = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'az' -and $node.Extent.Text.Contains('$CanaryAppName')
    }, $true)
    $RegistryAcr = 'approvedmirror.azurecr.io'
    $acrName = 'approvedmirror'
    $RegistryGhcr = 'ghcr.io/example/scimserver'
    $verifiedGhcrDigest = 'sha256:' + ('a' * 64)
    $version = '1.2.3'
    $CanaryAppName = $canaryEstate.appName
    $CanaryResourceGroup = $canaryEstate.resourceGroup
    $state = @{}
    function az { $state.Args = @($args); $global:LASTEXITCODE = 0; return 'offline-result' }
    Invoke-Assert 'exact nonempty ACR command population is retained (login, two imports, tags, two manifests)' ($acrCommands.Count -eq 6)
    foreach ($command in $acrCommands) {
        $state.Args = @()
        & ([scriptblock]::Create($command.Extent.Text)) | Out-Null
        $index = [array]::IndexOf($state.Args, '--subscription')
        Invoke-Assert "executed ACR command uses active approved mirror scope: $($command.CommandElements[2].Extent.Text)" `
            ($index -ge 0 -and $state.Args[$index + 1] -eq $devSubscriptionId)
    }
    $state.Args = @()
    & ([scriptblock]::Create($canaryCommand.Extent.Text)) | Out-Null
    $index = [array]::IndexOf($state.Args, '--subscription')
    Invoke-Assert 'executed canary ingress read uses resolved current canary subscription' `
        ($index -ge 0 -and $state.Args[$index + 1] -eq $canaryEstate.Tenant.subscriptionId)
    Invoke-Assert 'approved mirror subscription is derived from admitted active dev, never ambient' `
        ($registrySubscriptionId -eq $devSubscriptionId)
    $nameAssignment = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$acrName'
    }, $true)
    $tagAssignment = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$acrTags'
    }, $true)
    $DryRun = $true
    foreach ($mirror in @('', 'approvedmirror.azurecr.io')) {
        $RegistryAcr = $mirror
        $state.Args = @()
        $completed = $false
        try {
            . ([scriptblock]::Create($nameAssignment.Extent.Text))
            . ([scriptblock]::Create($tagAssignment.Extent.Text))
            $completed = $true
        } catch {}
        Invoke-Assert "DryRun tag inspection neither needs a mirror nor dispatches Azure: '$mirror'" `
            ($completed -and $state.Args.Count -eq 0)
    }
}

& {
    . (Join-Path $repoRoot 'scripts\scim-estates.ps1')
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($pipeline, [ref]$null, [ref]$null)
    $devEstate = Get-ScimEstate -Purpose dev
    $devSubscriptionId = $devEstate.Tenant.subscriptionId
    $DevAppName = $devEstate.appName
    $DevResourceGroup = $devEstate.resourceGroup
    $resolver = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Resolve-ActiveDevIngress'
    }, $true)
    if ($resolver) { . ([scriptblock]::Create($resolver.Extent.Text)) }
    $inheritedResolution = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.IfStatementAst] -and
        $node.Extent.Text.StartsWith('if (-not $DevFqdn)')
    }, $true)
    $state = @{}
    function az {
        $state.Reads++
        $state.Args = @($args)
        if ($args[0] -ne 'containerapp' -or $args[1] -ne 'show') {
            $state.Mutations++
            throw 'Offline hostname contract refuses all other Azure commands.'
        }
        $global:LASTEXITCODE = $state.Exit
        return $state.Host
    }
    $cases = @(
        @{ Name = 'default resolves authoritative active ingress'; Accept = $true },
        @{ Name = 'matching explicit current ingress is preserved'; Fqdn = 'current-dev.example.test'; Accept = $true },
        @{ Name = 'case-insensitive matching hostname is admitted'; Fqdn = 'CURRENT-DEV.EXAMPLE.TEST'; Accept = $true },
        @{ Name = 'trailing DNS dot preserves the authoritative hostname'; Fqdn = 'current-dev.example.test.'; Accept = $true },
        @{ Name = 'foreign explicit host is rejected before fixture dispatch'; Fqdn = 'foreign.example.test'; Accept = $false; Error = 'DevFqdn mismatch' },
        @{ Name = 'URL instead of hostname is rejected'; Fqdn = 'https://current-dev.example.test'; Accept = $false; Error = 'DevFqdn mismatch' },
        @{ Name = 'green label is unsupported by the dev pipeline'; Fqdn = 'current-dev---green.example.test'; Accept = $false; Error = 'DevFqdn mismatch' },
        @{ Name = 'unavailable ingress is rejected'; Empty = $true; Accept = $false; Error = 'Could not resolve' },
        @{ Name = 'failed ARM read with misleading output is rejected'; Exit = 1; Accept = $false; Error = 'Could not resolve' },
        @{ Name = 'malformed authoritative ingress is rejected'; Host = 'https://current-dev.example.test'; Accept = $false; Error = 'Could not resolve' },
        @{ Name = 'DryRun default performs no read'; Dry = $true; Accept = $true },
        @{ Name = 'DryRun explicit hostname performs no read'; Dry = $true; Fqdn = 'plan-only.example.test'; Accept = $true },
        @{ Name = 'SkipDeploy capture still rejects foreign hostname'; Skip = $true; Fqdn = 'foreign.example.test'; Accept = $false; Error = 'DevFqdn mismatch' }
    )
    foreach ($case in $cases) {
        $state.Clear()
        $state.Reads = 0
        $state.Mutations = 0
        $state.Fixtures = 0
        $state.Args = @()
        $state.Host = if ($case.Empty) { '' } elseif ($case.Host) { $case.Host } else { 'current-dev.example.test' }
        $state.Exit = if ($case.Exit) { $case.Exit } else { 0 }
        $DryRun = [bool]$case.Dry
        $SkipDeploy = [bool]$case.Skip
        $DevFqdn = $case.Fqdn
        $accepted = $false
        $message = ''
        try {
            if ($resolver) {
                $DevFqdn = Resolve-ActiveDevIngress -Estate $devEstate -DevFqdn $DevFqdn -DryRun:$DryRun
            } else {
                . ([scriptblock]::Create($inheritedResolution.Extent.Text))
            }
            $accepted = $true
            $state.Fixtures++
        } catch { $message = $_.Exception.Message }
        Invoke-Assert "ingress semantic outcome: $($case.Name)" `
            ($accepted -eq $case.Accept -and ($case.Accept -or $message.Contains($case.Error)))
        Invoke-Assert "ingress rejects before fixture mutation: $($case.Name)" `
            ($state.Mutations -eq 0 -and ($case.Accept -or $state.Fixtures -eq 0))
        if ($DryRun) {
            Invoke-Assert "DryRun ingress has no cloud read: $($case.Name)" ($state.Reads -eq 0)
        } elseif ($accepted -and $case.Accept) {
            $index = [array]::IndexOf($state.Args, '--subscription')
            Invoke-Assert "explicit or default ingress is authoritatively scoped: $($case.Name)" `
                ($state.Reads -eq 1 -and $index -ge 0 -and $state.Args[$index + 1] -eq $devSubscriptionId -and
                    $DevFqdn -eq 'current-dev.example.test')
        }
    }
    Invoke-Assert 'authoritative ingress admission is wired before dev HTTP capture' `
        ($content.IndexOf('$DevFqdn = Resolve-ActiveDevIngress') -gt 0 -and
            $content.IndexOf('$DevFqdn = Resolve-ActiveDevIngress') -lt $content.IndexOf('# Capture before-deploy state of dev'))
}

& {
    . (Join-Path $repoRoot 'scripts\scim-estates.ps1')
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($pipeline, [ref]$null, [ref]$null)
    $admission = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Assert-ActiveDevDeploymentAdmission'
    }, $true)
    $prereq = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Test-PrereqOrExit'
    }, $true)
    if ($admission) { . ([scriptblock]::Create($admission.Extent.Text)) }
    . ([scriptblock]::Create($prereq.Extent.Text))
    $active = Get-ScimEstate -Purpose dev
    $registryFixture = Get-ScimEstateRegistry
    $retiring = $registryFixture.estates | Where-Object { $_.purpose -eq 'dev' -and $_.Role -eq 'retiring' } | Select-Object -First 1
    $state = @{}
    function Get-ScimEstateRegistry { return $state.Registry }
    function az {
        if (($args -join ' ') -ne 'account show --output json' -and
            ($args -join ' ') -ne 'account show --output none') {
            $state.Mutations++
            throw 'Offline contract refuses all other Azure commands.'
        }
        $state.Reads++
        $global:LASTEXITCODE = $state.Exit
        if ($args[-1] -eq 'json') { $state.Account | ConvertTo-Json -Compress }
    }
    function docker { $state.ContainerReads++; $global:LASTEXITCODE = 0 }
    function Get-Command { return $true }
    $previousRuntimeRequirement = $env:SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME
    $previousExit = $global:LASTEXITCODE
    $env:SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME = '0'
    $cases = @(
        @{ Name = 'current cached tenant/subscription with explicit approved mirror'; Mirror = 'approvedmirror.azurecr.io'; Accept = $true },
        @{ Name = 'retiring tenant is rejected'; Tenant = $retiring.Tenant.tenantId; Mirror = 'approvedmirror.azurecr.io'; Accept = $false; Error = 'context mismatch' },
        @{ Name = 'wrong subscription is rejected'; Sub = $retiring.Tenant.subscriptionId; Mirror = 'approvedmirror.azurecr.io'; Accept = $false; Error = 'context mismatch' },
        @{ Name = 'missing approved mirror is rejected for anonymous GHCR dev'; Accept = $false; Error = 'No approved ACR mirror' },
        @{ Name = 'GHCR is not an ACR mirror'; Mirror = 'ghcr.io/owner/image'; Accept = $false; Error = 'ACR login server' },
        @{ Name = 'image path is not an ACR login server'; Mirror = 'approvedmirror.azurecr.io/scimserver'; Accept = $false; Error = 'ACR login server' },
        @{ Name = 'registry-declared managed identity ACR supplies the default'; DeclaredAcr = $true; Accept = $true; ExpectedMirror = 'declaredmirror.azurecr.io' },
        @{ Name = 'explicit mirror overrides compatible registry default'; DeclaredAcr = $true; Mirror = 'approvedmirror.azurecr.io'; Accept = $true },
        @{ Name = 'undeclared ACR authentication is not a compatible default'; UnknownAuth = $true; Accept = $false; Error = 'No approved ACR mirror' },
        @{ Name = 'wrong app target is rejected'; App = 'unapproved-app'; Mirror = 'approvedmirror.azurecr.io'; Accept = $false; Error = 'Dev target mismatch' },
        @{ Name = 'wrong resource group is rejected'; Group = 'unapproved-group'; Mirror = 'approvedmirror.azurecr.io'; Accept = $false; Error = 'Dev target mismatch' },
        @{ Name = 'matching explicit app and resource group are admitted'; App = $active.appName; Group = $active.resourceGroup; Mirror = 'approvedmirror.azurecr.io'; Accept = $true },
        @{ Name = 'disabled subscription is rejected'; Disabled = $true; Mirror = 'approvedmirror.azurecr.io'; Accept = $false; Error = 'cached Azure account' },
        @{ Name = 'unavailable cached account is rejected'; Exit = 1; Mirror = 'approvedmirror.azurecr.io'; Accept = $false; Error = 'cached Azure account' },
        @{ Name = 'empty cached identity is rejected'; Empty = $true; Mirror = 'approvedmirror.azurecr.io'; Accept = $false; Error = 'cached Azure account' },
        @{ Name = 'DryRun does not require account or mirror'; Dry = $true; Exit = 1; Accept = $true },
        @{ Name = 'SkipDeploy does not require account or mirror'; Skip = $true; Exit = 1; Accept = $true }
    )
    try {
        foreach ($case in $cases) {
            $state.Clear()
            $state.Exit = if ($case.Exit) { $case.Exit } else { 0 }
            $state.Reads = 0
            $state.Mutations = 0
            $state.ContainerReads = 0
            $state.Registry = $registryFixture | ConvertTo-Json -Depth 30 | ConvertFrom-Json
            $fixtureActive = $state.Registry.estates | Where-Object { $_.purpose -eq 'dev' -and $_.Role -eq 'active' }
            if ($case.DeclaredAcr -or $case.UnknownAuth) {
                $fixtureActive.registry = 'declaredmirror.azurecr.io/scimserver'
                $fixtureActive.registryAuth = if ($case.UnknownAuth) { 'anonymous' } else { 'managed-identity' }
            }
            $state.Account = if ($case.Empty) { @{} } else { @{
                tenantId = if ($case.Tenant) { $case.Tenant } else { $active.Tenant.tenantId }
                id = if ($case.Sub) { $case.Sub } else { $active.Tenant.subscriptionId }
                state = if ($case.Disabled) { 'Disabled' } else { 'Enabled' }
            } }
            $accepted = $false
            $message = ''
            try {
                if ($admission) {
                    $result = Assert-ActiveDevDeploymentAdmission -RegistryAcr $case.Mirror `
                        -DevAppName $case.App -DevResourceGroup $case.Group `
                        -DryRun:([bool]$case.Dry) -SkipDeploy:([bool]$case.Skip)
                } else {
                    # Exercise inherited account prerequisite and parameter default, not a missing-function failure.
                    if (-not $case.Dry -and -not $case.Skip -and -not $case.Exit) { Test-PrereqOrExit }
                    $default = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'RegistryAcr' }
                    $result = [pscustomobject]@{ RegistryAcr = if ($case.Mirror) { $case.Mirror } else { $default.DefaultValue.SafeGetValue() } }
                }
                $accepted = $true
            } catch { $message = $_.Exception.Message }
            Invoke-Assert "admission: $($case.Name)" ($accepted -eq $case.Accept -and
                ($case.Accept -or $message.Contains($case.Error)))
            Invoke-Assert "admission dispatches no mutation: $($case.Name)" ($state.Mutations -eq 0)
            if ($case.Dry -or $case.Skip) {
                Invoke-Assert "nondeployment admission performs no account lookup: $($case.Name)" ($state.Reads -eq 0)
            } elseif ($accepted -and $case.Accept) {
                $expectedMirror = if ($case.ExpectedMirror) { $case.ExpectedMirror } else { $case.Mirror }
                Invoke-Assert "approved mirror is preserved: $($case.Name)" ($result.RegistryAcr -eq $expectedMirror)
                Invoke-Assert 'admitted identity comes from the current role, not the historical alias' `
                    ($result.Estate.Tenant.tenantId -eq $active.Tenant.tenantId -and
                        $result.Estate.Tenant.subscriptionId -eq $active.Tenant.subscriptionId)
            }
        }
        Invoke-Assert 'deployment admission runs before prerequisites and state capture' `
            ($content.IndexOf('$deploymentAdmission = Assert-ActiveDevDeploymentAdmission') -gt 0 -and
                $content.IndexOf('$deploymentAdmission = Assert-ActiveDevDeploymentAdmission') -lt $content.IndexOf("`nTest-PrereqOrExit"))
        Invoke-Assert 'pipeline has no historical ACR default or retiring sign-in advice' `
            ($content -notmatch 'acrscimsrv09\.azurecr\.io' -and $content -notmatch 'Use-ProvIAM09')
        Invoke-Assert 'dev ARM lookups are explicitly pinned to admitted subscription' `
            ($content -match 'containerapp show.*--subscription \$devSubscriptionId')
        $DryRun = $true
        $state.Exit = 0
        $state.Reads = 0
        $state.ContainerReads = 0
        Test-PrereqOrExit
        Invoke-Assert 'DryRun prerequisites dispatch no Azure or container commands' `
            ($state.Reads -eq 0 -and $state.ContainerReads -eq 0)
    } finally {
        $env:SCIM_REQUIRE_INDEPENDENT_CONTAINER_RUNTIME = $previousRuntimeRequirement
        $global:LASTEXITCODE = $previousExit
    }
}

& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($pipeline, [ref]$null, [ref]$null)
    $resolver = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Resolve-ReleaseSourceImage'
    }, $true)
    if ($resolver) { . ([scriptblock]::Create($resolver.Extent.Text)) }
    $sourceGate = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-Gate' -and
        $node.CommandElements[1].Value -eq '4.3c'
    }, $true)
    $pullGate = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-Gate' -and
        $node.CommandElements[1].Value -eq '4.4'
    }, $true)
    $runtime = '1' * 40
    $published = '2' * 40
    $newHead = '3' * 40
    $unrelated = '4' * 40
    $expectedDigest = 'sha256:' + ('a' * 64)
    $RegistryGhcr = 'registry.example.test/owner/image'
    $runtimeInputPaths = @('Dockerfile', 'api/src', 'web/src')
    $originalDigest = $script:verifiedGhcrDigest
    $originalSource = $script:verifiedSourceCommit
    $originalHead = $script:expectedHeadSha
    $originalExit = $global:LASTEXITCODE
    $cases = @(
        @{ Name = 'fresh runtime merge'; Runtime = $published; Head = $published; Source = $published; Commits = @(); Accept = $true },
        @{ Name = 'fresh publication after tooling-only merge'; Runtime = $runtime; Head = $published; Source = $published; Commits = @($published); Accept = $true },
        @{ Name = 'immutable reuse after later docs-only merge'; Runtime = $runtime; Head = $newHead; Source = $published; Commits = @($newHead, $published); Accept = $true },
        @{ Name = 'missing matching source tag'; Runtime = $runtime; Head = $newHead; Source = $null; Commits = @($newHead, $published); Accept = $false },
        @{ Name = 'unrelated source branch'; Runtime = $runtime; Head = $newHead; Source = $unrelated; Commits = @($newHead, $published); Accept = $false },
        @{ Name = 'runtime input drift'; Runtime = $published; Head = $newHead; Source = $published; Commits = @($newHead); DiffExit = 1; Accept = $false },
        @{ Name = 'unmerged source'; Runtime = $published; Head = $newHead; Source = $published; Commits = @($newHead); AncestorExit = 1; Accept = $false },
        @{ Name = 'Git history failure'; Runtime = $runtime; Head = $newHead; Source = $published; Commits = @($newHead, $published); HistoryExit = 128; Accept = $false },
        @{ Name = 'semantic source digest drift'; Runtime = $published; Head = $published; Source = $published; Commits = @(); SourceDigest = 'sha256:' + ('b' * 64); Accept = $false },
        @{ Name = 'latest digest drift'; Runtime = $published; Head = $published; Source = $published; Commits = @(); LatestDigest = 'sha256:' + ('b' * 64); Accept = $false }
    )
    function Get-RemoteImageDigest {
        param($Reference)
        if ($state.Source -and $Reference -eq "${RegistryGhcr}:sha-$($state.Source)") {
            return $(if ($state.SourceDigest) { $state.SourceDigest } else { $expectedDigest })
        }
        return $null
    }
    function git {
        $global:LASTEXITCODE = 0
        switch ($args[0]) {
            'rev-list' {
                $global:LASTEXITCODE = [int]$state.HistoryExit
                $state.Commits
            }
            'merge-base' { $global:LASTEXITCODE = [int]$state.AncestorExit }
            'diff' { $global:LASTEXITCODE = [int]$state.DiffExit }
            default { throw "Unexpected Git command in provenance fixture: $($args[0])" }
        }
    }
    function docker {
        $global:LASTEXITCODE = 0
        switch ($args[0]) {
            'logout' { }
            'rmi' { }
            'pull' {
                if ($args[1] -notin @("${RegistryGhcr}:$version", "${RegistryGhcr}:latest", "${RegistryGhcr}:sha-$($state.Source)")) {
                    $global:LASTEXITCODE = 1
                }
            }
            'image' {
                $digest = if ($args[2] -eq "${RegistryGhcr}:latest" -and $state.LatestDigest) {
                    $state.LatestDigest
                } else { $expectedDigest }
                "${RegistryGhcr}@$digest"
            }
            default { throw "Unexpected Docker command in provenance fixture: $($args[0])" }
        }
    }
    try {
        foreach ($case in $cases) {
            $state = $case
            $runtimeSourceCommit = $case.Runtime
            $script:expectedHeadSha = $case.Head
            $existingVersionDigest = $expectedDigest
            $version = '0.55.54'
            $sourceShaDigest = Get-RemoteImageDigest "${RegistryGhcr}:sha-$runtimeSourceCommit"
            $script:verifiedGhcrDigest = $null
            $script:verifiedSourceCommit = $runtimeSourceCommit
            $accepted = $false
            try {
                & ($sourceGate.CommandElements[3].ScriptBlock.GetScriptBlock())
                $sourceVerified = $script:verifiedGhcrDigest -eq $expectedDigest -and
                    $script:verifiedSourceCommit -eq $case.Source
                if ($sourceVerified) {
                    $publishedSourceCommit = $script:verifiedSourceCommit
                    $verifiedGhcrDigest = $script:verifiedGhcrDigest
                    & ($pullGate.CommandElements[3].ScriptBlock.GetScriptBlock())
                    $accepted = $true
                }
            } catch {
                Write-Host "  Provenance fixture $($case.Name): $($_.Exception.Message)"
            }
            Invoke-Assert "release provenance: $($case.Name)" ($accepted -eq $case.Accept)
        }
    } finally {
        $script:verifiedGhcrDigest = $originalDigest
        $script:verifiedSourceCommit = $originalSource
        $script:expectedHeadSha = $originalHead
        $global:LASTEXITCODE = $originalExit
    }
}

& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($pipeline, [ref]$null, [ref]$null)
    $imageHelper = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Get-ValidatedLocalImageId'
    }, $true)
    if ($imageHelper) {
        . ([scriptblock]::Create($imageHelper.Extent.Text))
    }
    $buildGate = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-Gate' -and
        $node.CommandElements[1].Value -eq '4.1'
    }, $true)
    $mirrorGate = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-Gate' -and
        $node.CommandElements[1].Value -eq '4.2b'
    }, $true)
    $validationProjectName = 'scimserver-validation-aabbccddeeff'
    $RegistryAcr = 'registry.example.test'
    $ImageTag = 'fixture'
    $localMirrorTag = "local-$ImageTag"
    $localImageId = $null
    $expectedImageId = 'sha256:' + ('a' * 64)
    $state = @{ Project = $null; ImageId = $expectedImageId; Available = $true; Tagged = $null; Pushed = $null }
    $originalExit = $global:LASTEXITCODE
    function pwsh {
        $index = [array]::IndexOf($args, '-DockerProjectName')
        $state.Project = if ($index -ge 0) { $args[$index + 1] } else { $null }
        $global:LASTEXITCODE = 0
    }
    function docker {
        $global:LASTEXITCODE = 0
        switch ($args[0]) {
            'image' {
                $reference = [string]$args[2]
                if ($state.Available -and $state.Project -and
                    ($reference -eq "$($state.Project)-api" -or $reference -eq $state.Tagged)) {
                    $state.ImageId
                } else {
                    $global:LASTEXITCODE = 1
                }
            }
            'tag' {
                if ($args[1] -ne $expectedImageId) { $global:LASTEXITCODE = 1 }
                else { $state.Tagged = $args[2] }
            }
            'push' { $state.Pushed = $args[1] }
            default { throw 'The cleaned validation estate has no containers to query.' }
        }
    }
    try {
        & ($buildGate.CommandElements[3].ScriptBlock.GetScriptBlock())
        Invoke-Assert 'the parent passes its exact run-owned project identity to isolated validation' `
            ($state.Project -eq $validationProjectName)
        $mirrored = $false
        try {
            & ($mirrorGate.CommandElements[3].ScriptBlock.GetScriptBlock())
            $mirrored = $state.Pushed -eq "$RegistryAcr/scimserver:$localMirrorTag"
        } catch {
            Write-Host "  Mirror fixture: $($_.Exception.Message)"
        }
        Invoke-Assert 'the surviving validated image is mirrored by immutable ID after container cleanup' $mirrored
        if ($imageHelper) {
            foreach ($case in @(
                @{ Available = $false; ImageId = $expectedImageId; Name = 'missing image' },
                @{ Available = $true; ImageId = 'not-an-image-id'; Name = 'invalid image identity' }
            )) {
                $state.Available = $case.Available
                $state.ImageId = $case.ImageId
                $rejected = $false
                try { Get-ValidatedLocalImageId -ProjectName $validationProjectName | Out-Null }
                catch { $rejected = $true }
                Invoke-Assert "validated-image lookup rejects $($case.Name)" $rejected
            }
        }
    } finally {
        $global:LASTEXITCODE = $originalExit
    }
}

& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($pipeline, [ref]$null, [ref]$null)
    $definition = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Invoke-Gate'
    }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
    $originalResults = $script:results
    $originalExit = $global:LASTEXITCODE
    $DryRun = $false
    $state = @{ Executed = $false }
    function Add-Result {
        param($Stage, $Gate, $Status, $Detail, $DurationSec)
        $script:results += [pscustomobject]@{ Stage = $Stage; Gate = $Gate; Status = $Status }
    }
    try {
        foreach ($case in @(
            @{ Earlier = '2.6'; Next = '4.1' },
            @{ Earlier = '3b.5'; Next = '4.3' },
            @{ Earlier = '4.1'; Next = '4.2a' },
            @{ Earlier = '4.3'; Next = '4.5' },
            @{ Earlier = '4.6'; Next = '4.8' },
            @{ Earlier = '4.7'; Next = '5.3' }
        )) {
            $script:results = @([pscustomobject]@{ Stage = $case.Earlier; Status = 'FAIL' })
            $state.Executed = $false
            $allowed = Invoke-Gate -Stage $case.Next -Gate 'contract mutation' -Command {
                $state.Executed = $true
                $global:LASTEXITCODE = 0
            }
            Invoke-Assert "failed $($case.Earlier) blocks $($case.Next) before command execution" (
                -not $allowed -and -not $state.Executed -and
                $script:results[-1].Status -eq 'SKIPPED' -and $script:results[0].Status -eq 'FAIL'
            )
        }
        foreach ($stage in @('2.3', '4.1')) {
            $script:results = @(if ($stage -eq '2.3') {
                @([pscustomobject]@{ Stage = '2.2'; Status = 'FAIL' })
            } else { @([pscustomobject]@{ Stage = '2.6'; Status = 'PASS' }) })
            $state.Executed = $false
            $allowed = Invoke-Gate -Stage $stage -Gate 'contract positive control' -Command {
                $state.Executed = $true
                $global:LASTEXITCODE = 0
            }
            Invoke-Assert "positive control preserves executable $stage evidence" (
                $allowed -and $state.Executed -and $script:results[-1].Status -eq 'PASS'
            )
        }
        $postDeploy = @($ast.EndBlock.Statements | Where-Object {
            $_ -is [System.Management.Automation.Language.IfStatementAst] -and
            $_.Extent.Text.Contains("'prune-revisions.ps1'")
        })
        Invoke-Assert 'post-deploy state and pruning block is available for behavioral control' ($postDeploy.Count -eq 1)
        if ($postDeploy.Count -eq 1) {
            $script:results = @([pscustomobject]@{ Stage = '2.6'; Status = 'FAIL' })
            $state.Executed = $false
            $SkipDeploy = $false
            $ReportDir = $env:TEMP
            function Write-Stage { param($num, $title) }
            function Invoke-RestMethod { $state.Executed = $true; throw 'Contract refuses remote calls.' }
            function Get-ScimEstateRevisionKeep { $state.Executed = $true; return 2 }
            function Invoke-ContractPrune { $state.Executed = $true }
            function Join-Path {
                param($Path, $ChildPath)
                if ($ChildPath -eq 'prune-revisions.ps1') { return 'Invoke-ContractPrune' }
                Microsoft.PowerShell.Management\Join-Path $Path $ChildPath
            }
            & ([scriptblock]::Create($postDeploy[0].Extent.Text))
            Invoke-Assert 'failed prerequisites prevent post-deploy state capture and pruning' (-not $state.Executed)
            $pruning = @($postDeploy[0].FindAll({
                param($node)
                $node -is [System.Management.Automation.Language.IfStatementAst] -and
                $node.Extent.Text.Contains('Get-ScimEstateRevisionKeep')
            }, $true) | Sort-Object { $_.Extent.Text.Length })[0]
            $script:results = @([pscustomobject]@{ Stage = '6.1'; Status = 'FAIL' })
            $state.Executed = $false
            & ([scriptblock]::Create($pruning.Extent.Text))
            Invoke-Assert 'failed data integrity prevents pruning within the post-deploy stage' (
                -not $state.Executed -and $script:results[-1].Status -eq 'SKIPPED'
            )
        }
    }
    finally {
        $script:results = $originalResults
        $global:LASTEXITCODE = $originalExit
    }
}

& {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($pipeline, [ref]$null, [ref]$null)
    $command = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-Gate' -and
        $node.CommandElements[1].Extent.Text -eq "'4.8'"
    }, $true)
    if (-not $command) {
        Invoke-Assert 'gallery gate command exists for behavioral controls' $false
        return
    }
    $gateBody = $command.CommandElements[3].ScriptBlock.GetScriptBlock()
    $version = 'test-version'
    $ReportDir = $env:TEMP
    $timestamp = 'contract-only'
    $state = @{ Exit = 0; Evidence = $null }
    function pwsh { $global:LASTEXITCODE = $state.Exit }
    function Get-Content { param($LiteralPath, [switch]$Raw) $state.Evidence | ConvertTo-Json -Depth 10 }
    $originalExit = $global:LASTEXITCODE
    try {
        foreach ($case in @('valid', 'child failure', 'wrong version', 'missing mode', 'missing outcome', 'failed cleanup',
            'skipped check', 'missing custom outcome', 'missing membership outcome', 'unsupported check', 'failed custom disposition')) {
            $state.Exit = 0
            $state.Evidence = @{
                serverVersion = $version
                customExtensionDisposition = 'PASS: reviewed mapping proved'
                modes = @('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity') | ForEach-Object { @{ mode = $_; status = 'PASS' } }
                results = @(
                    foreach ($mode in @('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity')) {
                        foreach ($check in @('create user', 'update user', 'disable user', 'reenable user', 'deprovision user',
                            'create custom extension', 'update custom extension', 'create group', 'update group',
                            'add group member', 'remove group member', 'deprovision group', 'mode outcome')) {
                            @{ scenario = "auth:$mode"; check = $check; status = 'PASS' }
                        }
                    }
                )
                cleanup = @(@{ removed = $true })
            }
            switch ($case) {
                'child failure' { $state.Exit = 1 }
                'wrong version' { $state.Evidence.serverVersion = 'old-version' }
                'missing mode' { $state.Evidence.modes = @($state.Evidence.modes | Select-Object -First 2) }
                'missing outcome' { $state.Evidence.results = @() }
                'failed cleanup' { $state.Evidence.cleanup[0].removed = $false }
                'skipped check' { $state.Evidence.results += @{ status = 'SKIPPED' } }
                'missing custom outcome' {
                    $state.Evidence.results = @($state.Evidence.results | Where-Object {
                        $_.scenario -ne 'auth:OAuthClientCredentials' -or $_.check -ne 'update custom extension'
                    })
                }
                'missing membership outcome' {
                    $state.Evidence.results = @($state.Evidence.results | Where-Object {
                        $_.scenario -ne 'auth:WorkloadIdentity' -or $_.check -ne 'remove group member'
                    })
                }
                'unsupported check' { $state.Evidence.results += @{ status = 'UNSUPPORTED' } }
                'failed custom disposition' { $state.Evidence.customExtensionDisposition = 'FAIL: mapping not proved' }
            }
            $passed = $true
            try { & $gateBody } catch { $passed = $false }
            Invoke-Assert "gallery evidence behavior: $case" ($passed -eq ($case -eq 'valid'))
        }
    }
    finally {
        $global:LASTEXITCODE = $originalExit
    }
}

Write-Host ''
if ($failures.Count -eq 0) {
    Write-Host 'All deployment evidence assertions passed.' -ForegroundColor Green
    exit 0
}

Write-Host "$($failures.Count) deployment evidence assertion(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
exit 1
