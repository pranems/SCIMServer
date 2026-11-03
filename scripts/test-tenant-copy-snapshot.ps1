[CmdletBinding()]
param(
    [string]$PgImage = 'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3',
    [switch]$Baseline
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
