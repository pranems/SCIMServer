$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pipeline = Join-Path $repoRoot 'scripts\dev-deployment-pipeline.ps1'
$fullValidationPipeline = Join-Path $repoRoot 'scripts\full-validation-pipeline.ps1'
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
Invoke-Assert -Description 'Playwright keeps the readable line reporter' `
    -Condition ($content -match 'playwright\s+test\s+--reporter=line,json')
$writesJsonReport = ($content -match 'PLAYWRIGHT_JSON_OUTPUT_FILE\s*=\s*Join-Path\s+\$ReportDir') -and ($content -match 'playwright-dev-\$timestamp\.json')
Invoke-Assert -Description 'Playwright writes machine-readable results under the deployment report directory' `
    -Condition $writesJsonReport
$restoresJsonReporter = ($content -match 'previousPlaywrightJsonOutput') -and ($content -match "(?s)SetEnvironmentVariable\(\s*'PLAYWRIGHT_JSON_OUTPUT_FILE'")
Invoke-Assert -Description 'Playwright reporter environment is restored after the gate' `
    -Condition $restoresJsonReporter

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

Write-Host ''
if ($failures.Count -eq 0) {
    Write-Host 'All deployment evidence assertions passed.' -ForegroundColor Green
    exit 0
}

Write-Host "$($failures.Count) deployment evidence assertion(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
exit 1
