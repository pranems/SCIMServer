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
