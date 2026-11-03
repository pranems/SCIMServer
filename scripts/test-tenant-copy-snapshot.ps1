[CmdletBinding()]
param(
    [string]$PgImage = 'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3',
    [switch]$Baseline,
    [ValidateSet('all', 'connections')]
    [string]$Case = 'all'
)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
if ($Baseline) {
    $source = & git -C (Split-Path $PSScriptRoot) --no-pager show 'HEAD:scripts/rotate-tenant-data.ps1'
    if ($LASTEXITCODE -ne 0) { throw 'Could not load unchanged baseline copy program.' }
    $ast = [System.Management.Automation.Language.Parser]::ParseInput(($source -join "`n"), [ref]$tokens, [ref]$errors)
} else {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $PSScriptRoot 'rotate-tenant-data.ps1'), [ref]$tokens, [ref]$errors
    )
}
if ($errors.Count) { throw ($errors | Out-String) }
$assignment = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$fullCopy'
}, $true)
if (-not $assignment) { throw 'Embedded copy program is missing.' }
$setup = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$connectionSetup'
}, $true)
$setupText = if ($setup) { $setup.Extent.Text + "`n" } else { '' }
$copy = & ([scriptblock]::Create($setupText + $assignment.Extent.Text + "`n" + 'return $fullCopy'))
$copy = $copy.Replace("`r", '')
$connectionSetup = & ([scriptblock]::Create($setupText + "`n" + 'return $connectionSetup'))
$parser = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Split-PgUri'
}, $true)
if (-not $parser) { throw 'Copy URI parser is missing.' }
. ([scriptblock]::Create($parser.Extent.Text))
$container = $null
$fixtureRun = [guid]::NewGuid().ToString('N')
function Assert-SourceSnapshotReleased {
    $holders = & docker exec $container psql -U postgres -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = 'copy_source' AND xact_start IS NOT NULL"
    if ($LASTEXITCODE -ne 0 -or $holders -ne '0') {
        throw "RED: completed copy worker left $holders source transactions holding its exported snapshot."
    }
}
$environment = @('--env', 'SRC_HOST=localhost', '--env', 'SRC_PORT=5432',
    '--env', 'SRC_DB=copy_source', '--env', 'SRC_USER=postgres', '--env', 'SRC_SSL=disable',
    '--env', 'SRC_PW=synthetic', '--env', 'SRC_PW_ALT=synthetic',
    '--env', 'DST_HOST=localhost', '--env', 'DST_PORT=5432',
    '--env', 'DST_DB=copy_target', '--env', 'DST_USER=postgres', '--env', 'DST_SSL=disable',
    '--env', 'DST_PW=synthetic', '--env', 'DST_PW_ALT=synthetic')
try {
    Write-Host "Allocating owned PostgreSQL fixture scim-snapshot-$fixtureRun"
    $container = & docker run --detach --rm --network none `
        --name "scim-snapshot-$fixtureRun" --label "scimserverSnapshotTest=$fixtureRun" `
        --tmpfs /var/lib/postgresql:rw,size=256m --env PGDATA=/var/lib/postgresql/snapshot-fixture-data `
        --env POSTGRES_HOST_AUTH_METHOD=trust $PgImage
    if ($LASTEXITCODE -ne 0 -or -not $container) { throw 'Could not start isolated copy test.' }
    $metadata = & docker inspect $container | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $metadata[0].Config.Labels.scimserverSnapshotTest -cne $fixtureRun -or
        -not $metadata[0].HostConfig.Tmpfs.'/var/lib/postgresql') {
        throw 'RED: detached PostgreSQL fixture lacks verified run ownership or tmpfs data storage.'
    }
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        & docker exec $container pg_isready -U postgres | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Isolated copy test database did not become ready.' }
    foreach ($db in @('copy_source', 'copy_target')) {
        & docker exec $container createdb -U postgres $db
        if ($LASTEXITCODE -ne 0) { throw 'Could not create copy-test database.' }
    }
    $redirectDatabase = 'copy_target host=localhost dbname=copy_source'
    $specialDatabase = "copy target'\path"
    $specialUser = "copy user'\path"
    $identitySeed = @"
CREATE DATABASE "$redirectDatabase";
CREATE DATABASE "$specialDatabase";
CREATE ROLE "$specialUser" LOGIN;
"@
    $identitySeed | & docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create connection-identity fixtures.' }
    $identityProbe = $connectionSetup + "`n" + @'
identity=$(PGPASSWORD="$SRC_USE" psql "$S" -XAt -v ON_ERROR_STOP=1 -c "SELECT json_build_object('database', current_database(), 'user', current_user)::text")
printf 'SOURCE_IDENTITY=%s\n' "$identity"
identity=$(PGPASSWORD="$DST_USE" psql "$D" -XAt -v ON_ERROR_STOP=1 -c "SELECT json_build_object('database', current_database(), 'user', current_user)::text")
printf 'TARGET_IDENTITY=%s\n' "$identity"
'@
    $identityCases = @(
        @{ SourceDatabase = 'copy_source'; TargetDatabase = $redirectDatabase; User = 'postgres' },
        @{ SourceDatabase = $specialDatabase; TargetDatabase = $redirectDatabase; User = $specialUser },
        @{ SourceDatabase = $redirectDatabase; TargetDatabase = $specialDatabase; User = $specialUser }
    )
    foreach ($identityCase in $identityCases) {
        $encodedUser = [Uri]::EscapeDataString($identityCase.User)
        $sourceUri = "postgresql://${encodedUser}:synthetic@localhost:5432/$([Uri]::EscapeDataString($identityCase.SourceDatabase))?sslmode=disable"
        $targetUri = "postgresql://${encodedUser}:synthetic@localhost:5432/$([Uri]::EscapeDataString($identityCase.TargetDatabase))?sslmode=disable"
        $sourceIdentity = Split-PgUri -Uri $sourceUri -Which Source
        $targetIdentity = Split-PgUri -Uri $targetUri -Which Target
        $identityEnvironment = $environment + @(
            '--env', "SRC_DB=$($sourceIdentity.Database)", '--env', "DST_DB=$($targetIdentity.Database)",
            '--env', "SRC_USER=$($sourceIdentity.User)", '--env', "DST_USER=$($targetIdentity.User)"
        )
        $output = $identityProbe | & docker exec -i @identityEnvironment $container sh -c 'tr -d "\r" | sh'
        if ($LASTEXITCODE -ne 0) { throw 'Connection-identity probe failed before readback; inspect the PostgreSQL diagnostic.' }
        foreach ($endpoint in @('SOURCE', 'TARGET')) {
            $prefix = "${endpoint}_IDENTITY="
            $observations = @($output | Where-Object { $_.StartsWith($prefix) })
            if ($observations.Count -ne 1) { throw 'Connection-identity readback is missing or ambiguous.' }
            $observed = $observations[0].Substring($prefix.Length) | ConvertFrom-Json
            $expectedDatabase = if ($endpoint -eq 'SOURCE') { $identityCase.SourceDatabase } else { $identityCase.TargetDatabase }
            if ($observed.database -cne $expectedDatabase -or $observed.user -cne $identityCase.User) {
                throw "RED: $endpoint libpq parameters redirected the validated database/login identity."
            }
        }
    }
    Write-Host 'PASS: encoded database parameters cannot redirect source/target identities; spaces, quotes and backslashes remain literal'
    if ($Case -eq 'connections') { return }
    $seed = @'
CREATE TABLE resource (id integer PRIMARY KEY, payload text);
INSERT INTO resource SELECT g, md5(g::text) || md5((g * 2)::text) FROM generate_series(1, 2000) g;
'@
    $seed | & docker exec -i $container psql -U postgres -d copy_source -v ON_ERROR_STOP=1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Source fixture failed.' }
    & docker exec $container psql -U postgres -d copy_target -v ON_ERROR_STOP=1 -c 'CREATE TABLE orphan (id integer)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Target extra-table fixture failed.' }
    $marker = 'echo "=== dumping the fingerprinted snapshot ==="'
    if (-not $copy.Contains($marker)) { throw 'Snapshot termination hook cannot locate the dump boundary.' }
    $terminatedCopy = $copy.Replace($marker, 'kill -TERM $$')
    $output = $terminatedCopy | & docker exec -i @environment $container sh -c 'tr -d "\r" | sh'
    if ($LASTEXITCODE -ne 143) { throw 'Copy termination did not produce the expected signal exit.' }
    Assert-SourceSnapshotReleased
    Write-Host 'PASS: terminating a running copy releases its exported source transaction'
    $output = $copy | & docker exec -i @environment $container sh -c 'tr -d "\r" | sh'
    if ($LASTEXITCODE -eq 0) { throw 'RED: copy accepted a target with an extra table; size/count output is not fidelity proof' }
    if (($output -join "`n") -notmatch 'manifest mismatch') { throw 'Copy rejected the fixture for the wrong reason.' }
    Assert-SourceSnapshotReleased
    Write-Host 'PASS: extra target table is rejected by complete snapshot comparison'
    & docker exec $container psql -U postgres -d copy_target -v ON_ERROR_STOP=1 -c 'DROP TABLE orphan' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not reset target fixture.' }
    $output = $copy | & docker exec -i @environment $container sh -c 'tr -d "\r" | sh'
    if ($LASTEXITCODE -ne 0) { throw ('Valid copy failed: ' + ($output -join "`n")) }
    Assert-SourceSnapshotReleased
    $rows = & docker exec $container psql -U postgres -d copy_target -Atc 'SELECT count(*) FROM resource'
    if ($LASTEXITCODE -ne 0 -or $rows -ne '2000') { throw 'Target data is incomplete.' }
    Write-Host 'PASS: full snapshot copy retains 2000 rows and matching content manifest'
    $marker = 'echo "=== dumping the fingerprinted snapshot ==="'
    if (-not $copy.Contains($marker)) { throw 'Snapshot race hook cannot locate the dump boundary.' }
    $raceWrite = 'PGPASSWORD="$SRC_USE" psql "$S" -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO resource VALUES (2001, ''writer-after-manifest'')"'
    $racingCopy = $copy.Replace($marker, $raceWrite + "`n" + $marker)
    $output = $racingCopy | & docker exec -i @environment $container sh -c 'tr -d "\r" | sh'
    if ($LASTEXITCODE -ne 0) { throw ('Concurrent-write copy failed: ' + ($output -join "`n")) }
    Assert-SourceSnapshotReleased
    $sourceRows = & docker exec $container psql -U postgres -d copy_source -Atc 'SELECT count(*) FROM resource'
    if ($LASTEXITCODE -ne 0) { throw 'Source race readback failed.' }
    $targetRows = & docker exec $container psql -U postgres -d copy_target -Atc 'SELECT count(*) FROM resource'
    if ($LASTEXITCODE -ne 0 -or $sourceRows -ne '2001' -or $targetRows -ne '2000') {
        throw 'Concurrent source write was not isolated from the fingerprinted dump snapshot.'
    }
    Write-Host 'PASS: a source write after fingerprinting does not change the carried snapshot'
} finally {
    if ($container) {
        $owner = & docker inspect --format '{{index .Config.Labels "scimserverSnapshotTest"}}' $container
        if ($LASTEXITCODE -ne 0 -or $owner -cne $fixtureRun) { throw 'Snapshot fixture ownership cannot be verified; refusing removal.' }
        & docker rm --force --volumes $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Copy-test container cleanup failed.' }
        $remaining = @(& docker container ls --all --filter "id=$container" --format '{{.ID}}')
        if ($LASTEXITCODE -ne 0 -or $remaining.Count -ne 0) { throw 'Owned snapshot fixture absence was not verified.' }
    }
}
