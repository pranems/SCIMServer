[CmdletBinding()]
param(
    [string]$PgImage = 'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3',
    [switch]$Baseline,
    [ValidateSet('all', 'connections', 'serialization')]
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
foreach ($functionName in @('Split-PgUri', 'Get-DecodedOrSame')) {
    $parser = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq $functionName
    }, $true)
    if (-not $parser) { throw "Copy input helper $functionName is missing." }
    . ([scriptblock]::Create($parser.Extent.Text))
}
$yamlStart = $ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$indented'
} | Select-Object -First 1
$yamlEnd = $ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$yaml'
} | Select-Object -First 1
if (-not $yamlStart -or -not $yamlEnd) { throw 'Actual job YAML generation boundary is missing.' }
$yamlStatements = $ast.EndBlock.Statements | Where-Object {
    $_.Extent.StartOffset -ge $yamlStart.Extent.StartOffset -and $_.Extent.EndOffset -le $yamlEnd.Extent.EndOffset
} | ForEach-Object { $_.Extent.Text }
$yamlProgram = [scriptblock]::Create(($yamlStatements -join "`n") + "`n" + 'return $yaml')
$apiRoot = Join-Path (Split-Path $PSScriptRoot) 'api'
$yamlModule = Join-Path (Join-Path $apiRoot 'node_modules') 'js-yaml'
function Get-JobFixture {
    param($Source, $Target, [string]$Program)
    $src = $Source; $dst = $Target; $script = $Program
    $srcPwAlt = Get-DecodedOrSame $Source.Password
    $dstPwAlt = Get-DecodedOrSame $Target.Password
    $runId = 'synthetic-snapshot-run'; $envId = '/synthetic/environment'
    $yaml = & $yamlProgram
    $parseYaml = @'
const fs = require('node:fs');
const yaml = require(process.argv[1]);
process.stdout.write(JSON.stringify(yaml.load(fs.readFileSync(0, 'utf8'))));
'@
    $document = $yaml | & node -e $parseYaml $yamlModule
    if ($LASTEXITCODE -ne 0) { throw 'Actual generated job YAML could not be parsed with the existing API YAML dependency.' }
    $job = $document | ConvertFrom-Json
    $expectedNames = @(
        'SRC_HOST', 'SRC_PORT', 'SRC_DB', 'SRC_USER', 'SRC_SSL', 'SRC_PW', 'SRC_PW_ALT',
        'DST_HOST', 'DST_PORT', 'DST_DB', 'DST_USER', 'DST_SSL', 'DST_PW', 'DST_PW_ALT'
    )
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $arguments = [Collections.Generic.List[string]]::new()
    $jobContainer = $job.properties.template.containers[0]
    if ($jobContainer.command.Count -ne 2 -or ($jobContainer.command -join ' ') -cne '/bin/sh -c' -or
        $jobContainer.args.Count -ne 1 -or $jobContainer.args[0] -isnot [string]) {
        throw 'Generated job worker command is not the expected single POSIX program.'
    }
    foreach ($entry in $jobContainer.env) {
        if ($entry.name -cnotin $expectedNames -or -not $names.Add($entry.name)) {
            throw 'Generated job environment has unexpected or duplicate names.'
        }
        if ('value' -in $entry.PSObject.Properties.Name) {
            $value = $entry.value
        } elseif ('secretRef' -in $entry.PSObject.Properties.Name) {
            $secret = @($job.properties.configuration.secrets | Where-Object name -CEQ $entry.secretRef)
            if ($secret.Count -ne 1) { throw 'Generated job secret reference is missing or ambiguous.' }
            $value = $secret[0].value
        } else { throw 'Generated job environment has no value or secret reference.' }
        if ($value -isnot [string]) { throw 'Generated job environment value is not a string.' }
        $arguments.Add('--env')
        $arguments.Add("$($entry.name)=$value")
    }
    if ($names.Count -ne $expectedNames.Count) { throw 'Generated job environment is incomplete.' }
    return [pscustomobject]@{ Environment = $arguments.ToArray(); Program = $jobContainer.args[0] }
}
$container = $null
$fixtureRun = [guid]::NewGuid().ToString('N')
function Assert-SourceSnapshotReleased {
    $holders = & docker exec $container psql -U postgres -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = 'copy_source' AND xact_start IS NOT NULL"
    if ($LASTEXITCODE -ne 0 -or $holders -ne '0') {
        throw "RED: completed copy worker left $holders source transactions holding its exported snapshot."
    }
}
$fixtureSource = Split-PgUri -Uri 'postgresql://postgres:synthetic@localhost:5432/copy_source?sslmode=disable' -Which Source
$fixtureTarget = Split-PgUri -Uri 'postgresql://postgres:synthetic@localhost:5432/copy_target?sslmode=disable' -Which Target
$jobFixture = Get-JobFixture -Source $fixtureSource -Target $fixtureTarget -Program $copy
$environment = $jobFixture.Environment
$copy = $jobFixture.Program
if ($Case -in @('all', 'serialization')) {
    $src = Split-PgUri -Uri 'postgresql://copy%20user%27%22%5Cpath:source%25"\path@localhost/copy%5Cnew?sslmode=disable' -Which Source
    $dst = Split-PgUri -Uri 'postgresql://copy%2520user:target%25''\path@localhost/target%22%5Cpath?sslmode=disable' -Which Target
    $serialized = Get-JobFixture -Source $src -Target $dst -Program $copy
    $expected = @{
        SRC_HOST = $src.DbHost; SRC_PORT = [string]$src.Port; SRC_DB = $src.Database
        SRC_USER = $src.User; SRC_SSL = $src.SslMode; SRC_PW = $src.Password; SRC_PW_ALT = (Get-DecodedOrSame $src.Password)
        DST_HOST = $dst.DbHost; DST_PORT = [string]$dst.Port; DST_DB = $dst.Database
        DST_USER = $dst.User; DST_SSL = $dst.SslMode; DST_PW = $dst.Password; DST_PW_ALT = (Get-DecodedOrSame $dst.Password)
    }
    for ($i = 0; $i -lt $serialized.Environment.Count; $i += 2) {
        $pair = $serialized.Environment[$i + 1] -split '=', 2
        if ($serialized.Environment[$i] -cne '--env' -or -not $expected.ContainsKey($pair[0]) -or
            $pair[1] -cne $expected[$pair[0]]) {
            throw 'Actual YAML round trip changed an environment value.'
        }
    }
    if ($serialized.Program.Replace("`r", '').TrimEnd("`n") -cne $copy.Replace("`r", '').TrimEnd("`n")) {
        throw 'Actual YAML round trip changed the worker program.'
    }
    Write-Host 'PASS: full generated YAML preserves all 14 environment values and worker program without Docker'
    if ($Case -eq 'serialization') { return }
}
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
        $identityFixture = Get-JobFixture -Source $sourceIdentity -Target $targetIdentity -Program $identityProbe
        $identityEnvironment = $identityFixture.Environment
        $output = $identityFixture.Program | & docker exec -i @identityEnvironment $container sh -c 'tr -d "\r" | sh'
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
