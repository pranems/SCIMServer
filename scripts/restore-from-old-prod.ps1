<#
.SYNOPSIS
  Restore old-tenant SCIM data into the new-tenant prod + dev Postgres servers
  while preserving every endpoint/user/group UUID.

.DESCRIPTION
  Five gated stages (run individually or with -Stage all):

    1. snapshot                  - pg_dump new prod + new dev to scripts/state/*.dump
                                   (rollback safety; non-destructive)
    2. prod-restore              - pg_dump old prod -> drop+restore on new prod
                                   (DESTRUCTIVE: replaces new prod data)
    3. dev-restore-from-prod     - pg_dump old prod -> drop+restore on new dev
                                   (DESTRUCTIVE: replaces new dev data)
    4. dev-merge-from-olddev     - Merge old-dev rows whose Endpoint.name does
                                   NOT exist in old prod into new dev
                                   (non-destructive; staging-table + ON CONFLICT)
    5. requestlog-tail           - Copy latest -RequestLogTail rows of
                                   RequestLog from old prod into new prod + new dev
                                   (non-destructive; PK conflict skip)

  Schema parity has been verified: both old and new PG servers are on
  Prisma migration 20260430120000_resource_member_unique_value, so the
  table shapes are byte-identical and pg_dump | pg_restore is a clean
  pipeline with no transformation needed.

    All Postgres tooling runs in containerized postgres:17-alpine (no local
  psql/pg_dump install required, matches what scripts/deploy-azure.ps1 uses).

.PARAMETER Stage
  Which stage(s) to run. Choices:
    snapshot | prod-restore | dev-restore-from-prod | dev-merge-from-olddev |
    requestlog-tail | all

.PARAMETER OldProdPgHost
  Old prod PG FQDN. Default: scimserver2-pg.postgres.database.azure.com

.PARAMETER OldDevPgHost
  Old dev PG FQDN. Default: scimserver-dev-pg.postgres.database.azure.com

.PARAMETER NewProdPgHost
  New prod PG FQDN. Default: scimserver-pg-new2.postgres.database.azure.com

.PARAMETER NewDevPgHost
  New dev PG FQDN. Default: scimserver-pg-dev-new2.postgres.database.azure.com

.PARAMETER OldPassword
  Password for old prod + old dev (both share same admin pw per operator notes).
  Default: prompts interactively. NEVER hardcoded in this file.

.PARAMETER NewProdPasswordFile
  Path to file containing new prod PG password. Default: .pgpass-prod.txt

.PARAMETER NewDevPasswordFile
  Path to file containing new dev PG password. Default: .pgpass-dev.txt

.PARAMETER NewProdAppName
  Container App name for new prod (for post-restore restart). Default: scimserver

.PARAMETER NewProdRg
  RG for new prod Container App. Default: scimserver-prod

.PARAMETER NewDevAppName
  Container App name for new dev. Default: scimserver-dev

.PARAMETER NewDevRg
  RG for new dev Container App. Default: scimserver-dev

.PARAMETER RequestLogTail
  How many of the latest RequestLog rows to copy from old prod. Default: 1000.

.PARAMETER DryRun
  Print every SQL command + row count; do not execute anything destructive.

.PARAMETER Force
  Skip interactive y/N confirmations on destructive stages.

.PARAMETER SkipRestart
  Do not restart the Container App revisions after restore.

.EXAMPLE
  # Dry run all stages
  .\scripts\restore-from-old-prod.ps1 -Stage all -DryRun

.EXAMPLE
  # Real run, prod only, with snapshot + confirmation prompts
  .\scripts\restore-from-old-prod.ps1 -Stage snapshot
  .\scripts\restore-from-old-prod.ps1 -Stage prod-restore

.EXAMPLE
  # Full restore both envs (will prompt twice)
  .\scripts\restore-from-old-prod.ps1 -Stage all

.NOTES
  Created     : 2026-05-20
  Idempotent  : Yes (snapshot creates timestamped files; restore stages can
                be re-run; merge + requestlog use ON CONFLICT skip)
  Safety      : Destructive stages require interactive 'yes' OR -Force
#>

[CmdletBinding()]
param(
    [ValidateSet('snapshot','prod-restore','dev-restore-from-prod','dev-merge-from-olddev','requestlog-tail','all')]
    [string]$Stage = 'all',

    [string]$OldProdPgHost = 'scimserver2-pg.postgres.database.azure.com',
    [string]$OldDevPgHost  = 'scimserver-dev-pg.postgres.database.azure.com',
    [string]$NewProdPgHost = 'scimserver-pg-new2.postgres.database.azure.com',
    [string]$NewDevPgHost  = 'scimserver-pg-dev-new2.postgres.database.azure.com',

    [string]$OldPgUser  = 'scimadmin',
    [string]$NewPgUser  = 'scimadmin',
    [string]$PgDatabase = 'scimdb',

    [securestring]$OldPassword,
    [string]$NewProdPasswordFile = '.pgpass-prod.txt',
    [string]$NewDevPasswordFile  = '.pgpass-dev.txt',

    [string]$NewProdAppName = 'scimserver',
    [string]$NewProdRg      = 'scimserver-prod',
    [string]$NewDevAppName  = 'scimserver-dev',
    [string]$NewDevRg       = 'scimserver-dev',

    [int]$RequestLogTail = 1000,

    [switch]$DryRun,
    [switch]$Force,
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'
$repoRoot   = Split-Path -Parent $PSScriptRoot
$stateDir   = Join-Path $repoRoot 'scripts\state'
$dumpDir    = Join-Path $stateDir 'restore'
$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'
$pgImage    = 'postgres:17-alpine'

if (-not (Test-Path $dumpDir)) { New-Item -ItemType Directory -Path $dumpDir | Out-Null }

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
    Write-Host (" {0}" -f $Title) -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor DarkCyan
}

function Read-PgPasswordFile {
    param([string]$Path)
    $full = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $repoRoot $Path }
    if (-not (Test-Path $full)) { throw "Password file not found: $full" }
    return ((Get-Content $full -Raw).Trim())
}

function ConvertFrom-SecureToPlain {
    param([securestring]$Secure)
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-Connstr {
    param([string]$PgHost, [string]$User, [string]$Database)
    "host=$PgHost port=5432 user=$User dbname=$Database sslmode=require"
}

function Invoke-Psql {
    <#
      Runs a single SQL statement via dockerized psql.
      Returns the raw stdout text.
    #>
    param(
        [Parameter(Mandatory)] [string]$PgHost,
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [string]$Password,
        [Parameter(Mandatory)] [string]$Sql,
        [string]$Database = $PgDatabase,
        [switch]$Tuples
    )
    $args = @('run','--rm','-e',"PGPASSWORD=$Password",$pgImage,'psql',(Get-Connstr -PgHost $PgHost -User $User -Database $Database))
    if ($Tuples) { $args += @('-t','-A') }
    $args += @('-v','ON_ERROR_STOP=1','-c',$Sql)
    & docker @args 2>&1
}

function Invoke-PsqlFile {
    <#
      Runs a SQL script file via dockerized psql (mounted read-only).
    #>
    param(
        [Parameter(Mandatory)] [string]$PgHost,
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [string]$Password,
        [Parameter(Mandatory)] [string]$SqlFile,
        [string]$Database = $PgDatabase
    )
    $abs = (Resolve-Path $SqlFile).Path
    $mount = "$abs`:/tmp/q.sql:ro"
    & docker run --rm -e "PGPASSWORD=$Password" -v $mount $pgImage `
        psql (Get-Connstr -PgHost $PgHost -User $User -Database $Database) `
        -v ON_ERROR_STOP=1 -f /tmp/q.sql 2>&1
}

function Invoke-PgDump {
    <#
      Runs pg_dump in custom format (-Fc), outputs to a host file.
      Supports --exclude-table-data for trimming RequestLog noise.
    #>
    param(
        [Parameter(Mandatory)] [string]$PgHost,
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [string]$Password,
        [Parameter(Mandatory)] [string]$OutputFile,
        [string[]]$ExcludeTableData = @(),
        [string]$Database = $PgDatabase
    )
    $outDir  = Split-Path -Parent $OutputFile
    $outName = Split-Path -Leaf   $OutputFile
    $mount   = "$outDir`:/dump"
    $args = @('run','--rm','-e',"PGPASSWORD=$Password",'-v',$mount,$pgImage,
              'pg_dump',(Get-Connstr -PgHost $PgHost -User $User -Database $Database),
              '-Fc','--no-owner','--no-acl','--verbose','-f',"/dump/$outName")
    foreach ($t in $ExcludeTableData) {
        $args += @('--exclude-table-data',$t)
    }
    & docker @args 2>&1
}

function Invoke-PgRestore {
    <#
      Runs pg_restore from a host file. Default mode: data + schema, clean
      (drops existing objects before restore).
    #>
    param(
        [Parameter(Mandatory)] [string]$PgHost,
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [string]$Password,
        [Parameter(Mandatory)] [string]$DumpFile,
        [switch]$Clean,
        [switch]$DataOnly,
        [string]$Database = $PgDatabase
    )
    $inDir  = Split-Path -Parent $DumpFile
    $inName = Split-Path -Leaf   $DumpFile
    $mount  = "$inDir`:/dump:ro"
    $args = @('run','--rm','-e',"PGPASSWORD=$Password",'-v',$mount,$pgImage,
              'pg_restore','--no-owner','--no-acl','--verbose',
              '-h',$PgHost,'-p','5432','-U',$User,'-d',$Database)
    if ($Clean)    { $args += @('--clean','--if-exists') }
    if ($DataOnly) { $args += @('--data-only') }
    $args += "/dump/$inName"
    & docker @args 2>&1
}

function Get-RowCounts {
    param(
        [Parameter(Mandatory)] [string]$PgHost,
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [string]$Password,
        [string]$Label
    )
    $sql = @'
SELECT json_build_object(
  'Endpoint',           (SELECT COUNT(*) FROM "Endpoint"),
  'EndpointCredential', (SELECT COUNT(*) FROM "EndpointCredential"),
  'ScimResource',       (SELECT COUNT(*) FROM "ScimResource"),
  'ScimResource_User',  (SELECT COUNT(*) FROM "ScimResource" WHERE "resourceType" = 'User'),
  'ScimResource_Group', (SELECT COUNT(*) FROM "ScimResource" WHERE "resourceType" = 'Group'),
  'ResourceMember',     (SELECT COUNT(*) FROM "ResourceMember"),
  'RequestLog',         (SELECT COUNT(*) FROM "RequestLog")
)::text;
'@
    $raw = Invoke-Psql -PgHost $PgHost -User $User -Password $Password -Sql $sql -Tuples
    # docker stderr can interleave; pick the line that parses as JSON
    $json = ($raw | Where-Object { $_ -match '^\s*\{' } | Select-Object -First 1)
    if (-not $json) {
        Write-Host ("WARN: could not parse counts for {0}. Raw output:" -f $Label) -ForegroundColor Yellow
        $raw | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        return $null
    }
    $obj = $json | ConvertFrom-Json
    if ($Label) {
        Write-Host ("[{0}]" -f $Label) -ForegroundColor White
        $obj.PSObject.Properties | ForEach-Object {
            Write-Host ("  {0,-22} {1,8}" -f $_.Name, $_.Value)
        }
    }
    return $obj
}

function Confirm-Destructive {
    param([string]$Description, [string]$Target)
    if ($DryRun) {
        Write-Host ("[dry-run] would prompt: {0} -> {1}" -f $Description, $Target) -ForegroundColor DarkGray
        return
    }
    if ($Force) {
        Write-Host ("FORCE: proceeding without prompt ({0} -> {1})" -f $Description, $Target) -ForegroundColor Yellow
        return
    }
    Write-Host ''
    Write-Host ("DESTRUCTIVE: {0}" -f $Description) -ForegroundColor Red
    Write-Host ("Target     : {0}" -f $Target) -ForegroundColor Red
    $answer = Read-Host "Type 'yes' to proceed (anything else aborts)"
    if ($answer -ne 'yes') { throw "Aborted by operator" }
}

# -----------------------------------------------------------------------------
# Resolve passwords up front (fail fast if missing)
# -----------------------------------------------------------------------------

if (-not $OldPassword) {
    $OldPassword = Read-Host -AsSecureString -Prompt "Old-tenant PG admin password (scimserver2-pg + scimserver-dev-pg)"
}
$oldPwPlain  = ConvertFrom-SecureToPlain $OldPassword
$newProdPw   = Read-PgPasswordFile $NewProdPasswordFile
$newDevPw    = Read-PgPasswordFile $NewDevPasswordFile

Write-Section "Pre-flight: connectivity + row counts"
$cntOldProd = Get-RowCounts -PgHost $OldProdPgHost -User $OldPgUser -Password $oldPwPlain -Label "OLD PROD ($OldProdPgHost)"
$cntOldDev  = Get-RowCounts -PgHost $OldDevPgHost  -User $OldPgUser -Password $oldPwPlain -Label "OLD DEV  ($OldDevPgHost)"
$cntNewProd = Get-RowCounts -PgHost $NewProdPgHost -User $NewPgUser -Password $newProdPw -Label "NEW PROD ($NewProdPgHost)"
$cntNewDev  = Get-RowCounts -PgHost $NewDevPgHost  -User $NewPgUser -Password $newDevPw  -Label "NEW DEV  ($NewDevPgHost)"

if (-not ($cntOldProd -and $cntOldDev -and $cntNewProd -and $cntNewDev)) {
    throw "Pre-flight failed: could not read counts from one or more servers"
}

# -----------------------------------------------------------------------------
# Stage 1: snapshot (non-destructive)
# -----------------------------------------------------------------------------

function Invoke-StageSnapshot {
    Write-Section "STAGE 1: snapshot (rollback safety)"
    $snapProd = Join-Path $dumpDir "new-prod-snapshot-$stamp.dump"
    $snapDev  = Join-Path $dumpDir "new-dev-snapshot-$stamp.dump"
    if ($DryRun) {
        Write-Host "[dry-run] pg_dump $NewProdPgHost -> $snapProd"
        Write-Host "[dry-run] pg_dump $NewDevPgHost  -> $snapDev"
        return
    }
    Write-Host "pg_dump new prod -> $snapProd"
    $out = Invoke-PgDump -PgHost $NewProdPgHost -User $NewPgUser -Password $newProdPw -OutputFile $snapProd
    $out | Where-Object { $_ -match 'error|FATAL' } | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    if (-not (Test-Path $snapProd) -or (Get-Item $snapProd).Length -lt 1024) {
        throw "new-prod snapshot file missing or suspiciously small"
    }
    Write-Host ("  OK ({0:N0} bytes)" -f (Get-Item $snapProd).Length) -ForegroundColor Green

    Write-Host "pg_dump new dev  -> $snapDev"
    $out = Invoke-PgDump -PgHost $NewDevPgHost -User $NewPgUser -Password $newDevPw -OutputFile $snapDev
    $out | Where-Object { $_ -match 'error|FATAL' } | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    if (-not (Test-Path $snapDev) -or (Get-Item $snapDev).Length -lt 1024) {
        throw "new-dev snapshot file missing or suspiciously small"
    }
    Write-Host ("  OK ({0:N0} bytes)" -f (Get-Item $snapDev).Length) -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# Stage 2 + 3: prod-restore + dev-restore-from-prod
# -----------------------------------------------------------------------------

function Invoke-OldProdDump {
    $oldProdDump = Join-Path $dumpDir "old-prod-noreqlog-$stamp.dump"
    if ($DryRun) {
        Write-Host "[dry-run] pg_dump $OldProdPgHost (exclude RequestLog data) -> $oldProdDump"
        # Touch a placeholder so downstream branches don't break in dry-run
        return $oldProdDump
    }
    Write-Host "pg_dump old prod (excluding RequestLog row data) -> $oldProdDump"
    $out = Invoke-PgDump -PgHost $OldProdPgHost -User $OldPgUser -Password $oldPwPlain `
                         -OutputFile $oldProdDump -ExcludeTableData @('public.RequestLog','"public"."RequestLog"','RequestLog')
    $out | Where-Object { $_ -match 'error|FATAL' } | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    if (-not (Test-Path $oldProdDump) -or (Get-Item $oldProdDump).Length -lt 1024) {
        throw "old-prod dump file missing or suspiciously small"
    }
    Write-Host ("  OK ({0:N0} bytes)" -f (Get-Item $oldProdDump).Length) -ForegroundColor Green
    return $oldProdDump
}

function Invoke-RestoreInto {
    param(
        [Parameter(Mandatory)] [string]$PgHost,
        [Parameter(Mandatory)] [string]$Password,
        [Parameter(Mandatory)] [string]$DumpFile,
        [Parameter(Mandatory)] [string]$Label
    )
    if ($DryRun) {
        Write-Host "[dry-run] pg_restore --clean --if-exists into $PgHost ($Label)"
        return
    }
    Write-Host "pg_restore --clean --if-exists into $Label ($PgHost)"
    $out = Invoke-PgRestore -PgHost $PgHost -User $NewPgUser -Password $Password -DumpFile $DumpFile -Clean
    $errs = @($out | Where-Object { $_ -match 'error|FATAL' -and $_ -notmatch 'does not exist.*skipping' })
    if ($errs.Count -gt 0) {
        Write-Host ("pg_restore reported {0} error line(s):" -f $errs.Count) -ForegroundColor Yellow
        $errs | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
    }
}

function Invoke-StageProdRestore {
    param([string]$OldProdDumpFile)
    Write-Section "STAGE 2: prod-restore (old prod -> new prod)"
    Confirm-Destructive -Description "Drop all data in new prod PG and restore from old prod" `
                        -Target $NewProdPgHost
    Invoke-RestoreInto -PgHost $NewProdPgHost -Password $newProdPw -DumpFile $OldProdDumpFile -Label 'NEW PROD'
    if (-not $DryRun) {
        Write-Host ''
        Get-RowCounts -PgHost $NewProdPgHost -User $NewPgUser -Password $newProdPw -Label "NEW PROD (after restore)" | Out-Null
    }
}

function Invoke-StageDevRestoreFromProd {
    param([string]$OldProdDumpFile)
    Write-Section "STAGE 3: dev-restore-from-prod (old prod -> new dev)"
    Confirm-Destructive -Description "Drop all data in new dev PG and restore from old prod" `
                        -Target $NewDevPgHost
    Invoke-RestoreInto -PgHost $NewDevPgHost -Password $newDevPw -DumpFile $OldProdDumpFile -Label 'NEW DEV'
    if (-not $DryRun) {
        Write-Host ''
        Get-RowCounts -PgHost $NewDevPgHost -User $NewPgUser -Password $newDevPw -Label "NEW DEV (after restore)" | Out-Null
    }
}

# -----------------------------------------------------------------------------
# Stage 4: dev-merge-from-olddev
#
#   1. Get distinct Endpoint.name from old prod (these are "already covered").
#   2. On old dev, pg_dump only the rows for endpoints whose name is NOT in that set:
#        - Endpoint           (filter directly)
#        - ScimResource       (filter via endpointId IN ...)
#        - ResourceMember     (filter via groupResourceId IN (matching ScimResource.id))
#        - EndpointCredential (filter via endpointId IN ...)
#      We achieve this by COPY ... TO STDOUT WITH (FORMAT csv, HEADER) and then
#      load into staging tables on new dev + INSERT ... ON CONFLICT DO NOTHING.
# -----------------------------------------------------------------------------

function Invoke-StageDevMergeFromOldDev {
    Write-Section "STAGE 4: dev-merge-from-olddev (additive)"

    # Step 1: figure out which old-dev endpoint NAMEs are NOT in old prod
    $oldProdNames = (Invoke-Psql -PgHost $OldProdPgHost -User $OldPgUser -Password $oldPwPlain `
                                 -Sql 'SELECT name FROM "Endpoint";' -Tuples) `
                    | Where-Object { $_ -and $_.Trim() -ne '' } `
                    | ForEach-Object { $_.Trim() }
    Write-Host ("Old prod endpoint count: {0}" -f $oldProdNames.Count)

    $allOldDevRows = (Invoke-Psql -PgHost $OldDevPgHost -User $OldPgUser -Password $oldPwPlain `
                                  -Sql 'SELECT id || E''\t'' || name FROM "Endpoint";' -Tuples) `
                     | Where-Object { $_ -and $_.Trim() -ne '' }
    $devOnly = @()
    foreach ($row in $allOldDevRows) {
        $parts = $row -split "`t", 2
        if ($parts.Count -lt 2) { continue }
        $id, $name = $parts[0].Trim(), $parts[1].Trim()
        if ($oldProdNames -notcontains $name) {
            $devOnly += [pscustomobject]@{ Id = $id; Name = $name }
        }
    }
    Write-Host ("Old dev endpoint count : {0}" -f $allOldDevRows.Count)
    Write-Host ("Dev-only (to merge)    : {0}" -f $devOnly.Count) -ForegroundColor Green

    if ($devOnly.Count -eq 0) {
        Write-Host "Nothing to merge. Skipping stage 4."
        return
    }

    Write-Host ''
    Write-Host "Dev-only endpoint names:" -ForegroundColor Cyan
    $devOnly | Select-Object -First 50 | ForEach-Object { Write-Host ("  - {0}  ({1})" -f $_.Name, $_.Id) }
    if ($devOnly.Count -gt 50) { Write-Host ("  ... and {0} more" -f ($devOnly.Count - 50)) }

    if ($DryRun) {
        Write-Host "[dry-run] would merge $($devOnly.Count) endpoints + their ScimResources + ResourceMembers + EndpointCredentials into new dev"
        return
    }

    # Step 2: build the merge SQL on the FLY using a single psql session that
    # has dblink-free, per-table COPY round-trips between old-dev (source) and
    # new-dev (target). Simplest portable approach: dump via pg_dump --data-only
    # with --table filter expressions, then restore to staging schema, then move.

    $idList = ($devOnly.Id | ForEach-Object { "'$_'" }) -join ','

    # 2a. Dump dev-only data into a custom-format archive
    $mergeDump = Join-Path $dumpDir "old-dev-merge-$stamp.dump"
    Write-Host ("pg_dump old dev (filtered) -> {0}" -f $mergeDump)
    # pg_dump does NOT support row-level WHERE clauses on individual tables in
    # custom format. Workaround: create a temporary materialized view set on
    # old dev with just the rows we want, dump only those, then drop them.
    $filterSql = @"
CREATE TEMP TABLE IF NOT EXISTS _filter_endpoint_ids (id uuid PRIMARY KEY);
TRUNCATE _filter_endpoint_ids;
INSERT INTO _filter_endpoint_ids (id) VALUES $(($devOnly.Id | ForEach-Object { "('$_')" }) -join ',');
SELECT COUNT(*) AS filter_size FROM _filter_endpoint_ids;
"@
    # NOTE: TEMP tables disappear when psql session ends, so we cannot
    # combine TEMP-table prep with a separate pg_dump invocation. Use a
    # different approach: COPY ... TO STDOUT for each table with inline
    # WHERE clauses, captured to local CSV, then COPY ... FROM on target.

    $tmpDir = Join-Path $dumpDir "merge-$stamp"
    New-Item -ItemType Directory -Path $tmpDir | Out-Null

    function Copy-Table {
        param(
            [string]$TableName,
            [string]$WhereClause,
            [string]$OutFileBase
        )
        $outCsv = Join-Path $tmpDir "$OutFileBase.csv"
        $sql = "\copy (SELECT * FROM `"$TableName`" WHERE $WhereClause) TO STDOUT WITH (FORMAT csv, HEADER true)"
        # Run via stdin so single-quotes in WhereClause survive
        $sqlFile = New-TemporaryFile
        Set-Content -Path $sqlFile.FullName -Value $sql -Encoding ascii
        $out = Invoke-PsqlFile -PgHost $OldDevPgHost -User $OldPgUser -Password $oldPwPlain -SqlFile $sqlFile.FullName
        Remove-Item $sqlFile.FullName -Force
        # psql's \copy writes CSV to its own stdout; we captured it as $out (array of lines)
        $out | Out-File -Encoding ascii -FilePath $outCsv
        $lines = (Get-Content $outCsv | Measure-Object -Line).Lines
        Write-Host ("  {0,-20} rows={1,6} ({2})" -f $TableName, ($lines - 1), $outCsv)
        return $outCsv
    }

    Write-Host "Exporting dev-only rows from old dev:"
    $csvEndpoint = Copy-Table -TableName 'Endpoint'           -WhereClause "id IN ($idList)"                                                     -OutFileBase 'endpoint'
    $csvSr       = Copy-Table -TableName 'ScimResource'       -WhereClause "`"endpointId`" IN ($idList)"                                          -OutFileBase 'scimresource'
    $csvRm       = Copy-Table -TableName 'ResourceMember'     -WhereClause "`"groupResourceId`" IN (SELECT id FROM `"ScimResource`" WHERE `"endpointId`" IN ($idList))" -OutFileBase 'resourcemember'
    $csvEc       = Copy-Table -TableName 'EndpointCredential' -WhereClause "`"endpointId`" IN ($idList)"                                          -OutFileBase 'endpointcredential'

    Write-Host ''
    Write-Host "Loading via staging + INSERT ... ON CONFLICT DO NOTHING into new dev:"
    foreach ($pair in @(
        @{ Table='Endpoint'           ; Csv=$csvEndpoint },
        @{ Table='ScimResource'       ; Csv=$csvSr },
        @{ Table='ResourceMember'     ; Csv=$csvRm },
        @{ Table='EndpointCredential' ; Csv=$csvEc }
    )) {
        $t = $pair.Table
        $csv = $pair.Csv
        if (-not (Test-Path $csv) -or (Get-Item $csv).Length -lt 2) {
            Write-Host ("  {0,-20} skip (empty csv)" -f $t)
            continue
        }
        # Move CSV into a docker-mountable path; run COPY into a TEMP table
        # then INSERT ... SELECT ... ON CONFLICT DO NOTHING.
        $loadSql = @"
CREATE TEMP TABLE staging_$t (LIKE "$t" INCLUDING DEFAULTS);
\copy staging_$t FROM '/tmp/load.csv' WITH (FORMAT csv, HEADER true);
INSERT INTO "$t" SELECT * FROM staging_$t ON CONFLICT DO NOTHING;
SELECT COUNT(*) AS inserted FROM "$t" WHERE "id" IN (SELECT id FROM staging_$t);
DROP TABLE staging_$t;
"@
        $loadFile = New-TemporaryFile
        Set-Content -Path $loadFile.FullName -Value $loadSql -Encoding ascii
        # We need both the SQL file AND the CSV mounted into the container
        $absCsv = (Resolve-Path $csv).Path
        $absSql = (Resolve-Path $loadFile.FullName).Path
        $out = & docker run --rm `
            -e "PGPASSWORD=$newDevPw" `
            -v "$absSql`:/tmp/q.sql:ro" `
            -v "$absCsv`:/tmp/load.csv:ro" `
            $pgImage psql (Get-Connstr -PgHost $NewDevPgHost -User $NewPgUser -Database $PgDatabase) `
            -v ON_ERROR_STOP=1 -f /tmp/q.sql 2>&1
        Remove-Item $loadFile.FullName -Force
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    }

    Write-Host ''
    Get-RowCounts -PgHost $NewDevPgHost -User $NewPgUser -Password $newDevPw -Label "NEW DEV (after merge)" | Out-Null
}

# -----------------------------------------------------------------------------
# Stage 5: requestlog-tail
# -----------------------------------------------------------------------------

function Invoke-StageRequestLogTail {
    Write-Section "STAGE 5: requestlog-tail (latest $RequestLogTail rows from old prod)"

    $csvOut = Join-Path $dumpDir "requestlog-tail-$stamp.csv"

    $copySql = "\copy (SELECT * FROM `"RequestLog`" ORDER BY `"createdAt`" DESC LIMIT $RequestLogTail) TO STDOUT WITH (FORMAT csv, HEADER true)"
    $sqlFile = New-TemporaryFile
    Set-Content -Path $sqlFile.FullName -Value $copySql -Encoding ascii
    Write-Host ("Exporting latest {0} RequestLog rows from old prod -> {1}" -f $RequestLogTail, $csvOut)
    if ($DryRun) {
        Write-Host "[dry-run] would copy + insert into new prod + new dev"
        Remove-Item $sqlFile.FullName -Force
        return
    }
    $out = Invoke-PsqlFile -PgHost $OldProdPgHost -User $OldPgUser -Password $oldPwPlain -SqlFile $sqlFile.FullName
    Remove-Item $sqlFile.FullName -Force
    $out | Out-File -Encoding ascii -FilePath $csvOut
    $lineCount = (Get-Content $csvOut | Measure-Object -Line).Lines
    Write-Host ("  exported rows: {0}" -f ($lineCount - 1)) -ForegroundColor Green

    foreach ($target in @(
        @{ Label='NEW PROD'; PgHost=$NewProdPgHost; Pw=$newProdPw },
        @{ Label='NEW DEV';  PgHost=$NewDevPgHost;  Pw=$newDevPw  }
    )) {
        $loadSql = @"
CREATE TEMP TABLE staging_RequestLog (LIKE "RequestLog" INCLUDING DEFAULTS);
\copy staging_RequestLog FROM '/tmp/load.csv' WITH (FORMAT csv, HEADER true);
INSERT INTO "RequestLog" SELECT * FROM staging_RequestLog ON CONFLICT DO NOTHING;
DROP TABLE staging_RequestLog;
"@
        $loadFile = New-TemporaryFile
        Set-Content -Path $loadFile.FullName -Value $loadSql -Encoding ascii
        $absCsv = (Resolve-Path $csvOut).Path
        $absSql = (Resolve-Path $loadFile.FullName).Path
        Write-Host ("Loading into {0}..." -f $target.Label)
        $out = & docker run --rm `
            -e "PGPASSWORD=$($target.Pw)" `
            -v "$absSql`:/tmp/q.sql:ro" `
            -v "$absCsv`:/tmp/load.csv:ro" `
            $pgImage psql (Get-Connstr -PgHost $target.PgHost -User $NewPgUser -Database $PgDatabase) `
            -v ON_ERROR_STOP=1 -f /tmp/q.sql 2>&1
        Remove-Item $loadFile.FullName -Force
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    }
}

# -----------------------------------------------------------------------------
# Post-restore: restart Container Apps
# -----------------------------------------------------------------------------

function Restart-ContainerApps {
    if ($SkipRestart -or $DryRun) { return }
    Write-Section "Post-restore: restart Container App revisions"
    foreach ($pair in @(
        @{ Name=$NewProdAppName; Rg=$NewProdRg; Label='NEW PROD' },
        @{ Name=$NewDevAppName;  Rg=$NewDevRg;  Label='NEW DEV'  }
    )) {
        Write-Host ("Restarting {0} ({1} / {2})..." -f $pair.Label, $pair.Name, $pair.Rg)
        $rev = az containerapp revision list -n $pair.Name -g $pair.Rg `
                  --query "[?properties.active].name | [0]" -o tsv 2>$null
        if (-not $rev) {
            Write-Host ("  no active revision found - skipping") -ForegroundColor Yellow
            continue
        }
        az containerapp revision restart -n $pair.Name -g $pair.Rg --revision $rev 2>&1 | Out-Null
        Write-Host ("  restarted {0}" -f $rev) -ForegroundColor Green
    }
}

# -----------------------------------------------------------------------------
# Orchestration
# -----------------------------------------------------------------------------

$runAll = ($Stage -eq 'all')

if ($runAll -or $Stage -eq 'snapshot') { Invoke-StageSnapshot }

$oldProdDumpFile = $null
if ($runAll -or $Stage -in @('prod-restore','dev-restore-from-prod')) {
    $oldProdDumpFile = Invoke-OldProdDump
}
if ($runAll -or $Stage -eq 'prod-restore')          { Invoke-StageProdRestore -OldProdDumpFile $oldProdDumpFile }
if ($runAll -or $Stage -eq 'dev-restore-from-prod') { Invoke-StageDevRestoreFromProd -OldProdDumpFile $oldProdDumpFile }
if ($runAll -or $Stage -eq 'dev-merge-from-olddev') { Invoke-StageDevMergeFromOldDev }
if ($runAll -or $Stage -eq 'requestlog-tail')       { Invoke-StageRequestLogTail }

if ($runAll) { Restart-ContainerApps }

Write-Section "Done"
if ($DryRun) {
    Write-Host "Dry run complete - no changes were made." -ForegroundColor Green
} else {
    Write-Host "All requested stages completed." -ForegroundColor Green
    Write-Host "Dump artifacts: $dumpDir"
}
