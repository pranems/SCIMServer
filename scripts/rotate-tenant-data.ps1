<#
.SYNOPSIS
    Copy an entire SCIMServer database from one tenant's PostgreSQL to another's,
    running the transfer INSIDE Azure so no data crosses a workstation.

.DESCRIPTION
    The ProvIAM estates live on ephemeral tenants that expire on a roughly 80-85
    day boundary, so this migration is a RECURRING operation, not a one-off. Two
    design decisions follow from that:

    1. USE pg_dump, NOT A MODEL-AWARE COPIER.
       A copier that enumerates tables by hand has to be maintained in step with
       the schema, and it will drift. api/src/scripts/mirror-prod-to-dev.ts proved
       this: it silently copied 5 of 8 Prisma models and dropped the
       EndpointCredential.secretEnvelope column. pg_dump is schema-agnostic, so it
       is complete by construction and stays correct when a table is added.

    2. RUN THE TRANSFER IN AZURE, NOT ON THE OPERATOR'S MACHINE.
       Both source and target PostgreSQL servers already carry the Azure firewall
       rule 0.0.0.0-0.0.0.0, which is Azure's special "allow any Azure service"
       rule. Anything running inside Azure can therefore reach both servers with
       NO firewall change on either side - in particular none on the retiring
       tenant, which must be left untouched. A workstation is not in Azure, so
       routing through it would require adding a client-IP rule to the source.

    The transfer runs as an ephemeral Container Apps job in the TARGET tenant's
    existing managed environment. Nothing is left running afterwards.

    The tenant boundary is irrelevant to this path: PostgreSQL authenticates with
    its own username and password over TLS and gates access by IP. Entra roles
    and subscription ownership govern the control plane only.

.PARAMETER SourceConnectionString
    postgresql://... for the database being copied FROM. Read-only usage.

.PARAMETER TargetConnectionString
    postgresql://... for the database being copied INTO. Existing objects are
    dropped and recreated from the dump.

.PARAMETER TargetResourceGroup
    Resource group in the target tenant that hosts the Container Apps environment.

.PARAMETER EnvironmentName
    Container Apps managed environment used to run the job.

.PARAMETER Subscription
    Target subscription id.

.PARAMETER AzureConfigDir
    Isolated az CLI profile directory for the target tenant.

.PARAMETER JobName
    Prefix of the ephemeral job. A unique run suffix prevents overwriting jobs.

.PARAMETER KeepJob
    Leave the job resource behind for inspection instead of deleting it.

.PARAMETER DryRun
    Print what would happen and verify connectivity, but copy nothing.

.PARAMETER ConfirmNoTargetApps
    Permit a restore without TargetAppName only after verifying that the target
    subscription has no Container Apps. Intended for a new tenant's isolated trial.

.EXAMPLE
    pwsh scripts/rotate-tenant-data.ps1 `
        -SourceConnectionString $src -TargetConnectionString $dst `
        -TargetResourceGroup scimserver-prod -EnvironmentName scimserver-env `
        -Subscription 8cb58fd6-cf6f-4334-9fe0-3b12f93a6596 `
        -AzureConfigDir "$HOME/.azure-proviam09" -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$SourceConnectionString,
    [Parameter(Mandatory)] [string]$TargetConnectionString,
    [Parameter(Mandatory)] [string]$TargetResourceGroup,
    [string]$EnvironmentName = 'scimserver-env',
    [Parameter(Mandatory)] [string]$Subscription,
    [string]$AzureConfigDir,
    [string]$JobName = 'scim-pgcopy',
    [switch]$KeepJob,
    [switch]$DryRun,

    # Container app in the target that must be stopped for the duration of the
    # restore. A running replica re-seeds tables while pg_dump --clean is dropping
    # and recreating them, which silently produces a target that looks healthy but
    # holds application-seeded rows instead of carried ones. Measured 2026-08-07:
    # the JwksHostAllowlistEntry table came back with six freshly-seeded rows and
    # brand-new IDs instead of the seven carried rows, losing a manually-added host.
    [string]$TargetAppName,
    [string]$TargetAppResourceGroup,
    [switch]$ConfirmNoTargetApps
)

$ErrorActionPreference = 'Stop'
if ($AzureConfigDir) { $env:AZURE_CONFIG_DIR = $AzureConfigDir }
. (Join-Path $PSScriptRoot 'scim-estates.ps1')
. (Join-Path $PSScriptRoot 'tenant-copy-safety.ps1')
$runId = [guid]::NewGuid().ToString('N')
$JobName = $JobName.Substring(0, [Math]::Min(19, $JobName.Length)).TrimEnd('-')
$JobName = "$JobName-$($runId.Substring(0, 12))"
if ($JobName.Length -gt 32 -or $JobName -cnotmatch '^[a-z][a-z0-9-]+[a-z0-9]$') {
    throw 'Copy job prefix must produce a lowercase Azure job name of at most 32 characters.'
}

function Say { param([string]$m, [string]$c = 'Gray') Write-Host "  $m" -ForegroundColor $c }

Write-Host ""
Write-Host "SCIMServer cross-tenant database rotation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Never echo a connection string. Show only enough to confirm the right servers.
function HostOf { param([string]$u) if ($u -match '@([^:/]+)') { $Matches[1] } else { '(unparsed)' } }
Say ("source   : " + (HostOf $SourceConnectionString))
Say ("target   : " + (HostOf $TargetConnectionString))
Say ("job env  : $EnvironmentName in $TargetResourceGroup")
Say ("dry run  : $DryRun")

Invoke-CopyAzAction -Arguments @('account', 'set', '--subscription', $Subscription)
$account = Invoke-CopyAzJson -Arguments @('account', 'show')
$tenant = @((Get-ScimEstateRegistry).tenants | Where-Object subscriptionId -eq $Subscription)
if ($tenant.Count -ne 1 -or $account.id -ne $Subscription -or $account.tenantId -ne $tenant[0].tenantId -or $tenant[0].role -eq 'permanent') {
    throw 'Copy target is not the expected registered non-customer tenant/subscription.'
}
$environment = Invoke-CopyAzJson -Arguments @(
    'containerapp', 'env', 'show', '-n', $EnvironmentName, '-g', $TargetResourceGroup,
    '--subscription', $Subscription
)
$envId = $environment.id
if (-not $envId) { throw "Container Apps environment '$EnvironmentName' not found in '$TargetResourceGroup'." }
Assert-CopyLogTransportAvailable

# --------------------------------------------------------------------------
# Decompose the connection strings into discrete PG* variables.
#
# libpq parses a postgresql:// URI as PERCENT-ENCODED, so a password containing
# a bare '%' fails with `invalid percent-encoded token` before it ever opens a
# socket. That is exactly what broke the tenant-08 canary-prod carry: the
# generated prod password contained '%s', the dev password happened not to, and
# so the failure looked environment-specific through three wrong diagnoses.
#
# Passing PGHOST / PGUSER / PGPASSWORD / PGDATABASE / PGSSLMODE avoids URI
# parsing altogether, so no character in the password can be reinterpreted.
# --------------------------------------------------------------------------
function Split-PgUri {
    param([Parameter(Mandatory)][string]$Uri, [Parameter(Mandatory)][string]$Which)
    # Anchor on the LAST '@' so a password containing '@' still splits correctly.
    if ($Uri -notmatch '^postgres(?:ql)?://(.+)@([^@]+)$') { throw "$Which connection string is not a postgresql:// URI." }
    $creds = $Matches[1]
    $rest = $Matches[2]
    # Split creds on the FIRST ':' so a password containing ':' survives.
    $ci = $creds.IndexOf(':')
    if ($ci -lt 0) { throw "$Which connection string has no password." }
    $user = $creds.Substring(0, $ci)
    $pass = $creds.Substring($ci + 1)
    if ($rest -notmatch '^([^:/]+)(?::(\d+))?/([^?]+)(?:\?(.*))?$') { throw "$Which connection string has an unparseable host/database part." }
    $h = $Matches[1]; $prt = $Matches[2]; $db = $Matches[3]; $qs = $Matches[4]
    $port = 5432
    if ($prt -and (-not [int]::TryParse($prt, [ref]$port) -or $port -lt 1 -or $port -gt 65535)) {
        throw "$Which connection string has an invalid PostgreSQL port."
    }
    $ssl = 'require'
    if ($qs -and $qs -match 'sslmode=([^&]+)') { $ssl = $Matches[1] }
    [pscustomobject]@{
        DbHost   = $h
        Port     = $port
        Database = [Uri]::UnescapeDataString($db)
        User     = $user
        Password = $pass
        SslMode  = $ssl
    }
}

$src = Split-PgUri -Uri $SourceConnectionString -Which 'Source'
$dst = Split-PgUri -Uri $TargetConnectionString -Which 'Target'
if ($src.DbHost.TrimEnd('.') -ieq $dst.DbHost.TrimEnd('.') -and $src.Port -eq $dst.Port -and $src.Database -ceq $dst.Database) {
    throw 'Source and target identify the same database; copy is refused.'
}
$targetServers = @(Invoke-CopyAzJson -Arguments @(
    'postgres', 'flexible-server', 'list', '--subscription', $Subscription
))
if (@($targetServers | Where-Object { $_.fullyQualifiedDomainName -ieq $dst.DbHost.TrimEnd('.') }).Count -ne 1) {
    throw 'Target PostgreSQL host does not belong to the verified target subscription.'
}
Say ("source db : " + $src.Database + " as " + $src.User + " (sslmode=" + $src.SslMode + ")")
Say ("target db : " + $dst.Database + " as " + $dst.User + " (sslmode=" + $dst.SslMode + ")")
if ($ConfirmNoTargetApps -and $TargetAppName) {
    throw 'Specify either the target app or explicit absent-app proof, not both.'
}
if ($TargetAppName) {
    $rgForApp = if ($TargetAppResourceGroup) { $TargetAppResourceGroup } else { $TargetResourceGroup }
    Assert-CopyTargetDatabase -AppName $TargetAppName -ResourceGroup $rgForApp -Subscription $Subscription -Database $dst
}
if (-not $DryRun -and -not $TargetAppName) {
    if (-not $ConfirmNoTargetApps) {
        throw 'Restore requires TargetAppName or explicit ConfirmNoTargetApps proof.'
    }
    Assert-CopyTargetWithoutApps -Subscription $Subscription
}

# --------------------------------------------------------------------------
# A password taken from a postgresql:// URI is ambiguous, and the two SCIMServer
# estates proved it by failing in OPPOSITE directions:
#
#   prod password contains '%s'  -> NOT a valid percent-escape, so libpq refuses
#                                   the URI outright ("invalid percent-encoded
#                                   token") and only the RAW password works.
#   dev  password contains '%99' -> a VALID percent-escape, so libpq silently
#                                   DECODES it, and only the DECODED password
#                                   authenticates.
#
# Nothing in the connection string says which was intended, so guessing either
# way breaks one estate. Supply both and let the container use whichever one
# actually authenticates.
# --------------------------------------------------------------------------
function Get-DecodedOrSame {
    param([string]$Value)
    try { return [System.Uri]::UnescapeDataString($Value) } catch { return $Value }
}
$srcPwAlt = Get-DecodedOrSame $src.Password
$dstPwAlt = Get-DecodedOrSame $dst.Password
Say ("source password has an alternate percent-decoded form : " + ($srcPwAlt -ne $src.Password))
Say ("target password has an alternate percent-decoded form : " + ($dstPwAlt -ne $dst.Password))

# --------------------------------------------------------------------------
# The transfer script that runs inside the container.
#
#   --no-owner --no-acl : role names differ between servers, so ownership and
#                         grants from the source are meaningless on the target.
#   --clean --if-exists : drop the target's objects first, so the result is the
#                         source's state rather than a merge. The target is
#                         freshly provisioned, so nothing of value is lost.
#   ON_ERROR_STOP=1     : fail loudly. Without it psql reports success while
#                         having skipped every failing statement.
#
# _prisma_migrations travels with the dump, so the application does not try to
# re-apply migrations against an already-current database on next boot.
# --------------------------------------------------------------------------
$connectionSetup = @'
set -eu
pg_value() {
  printf "'"
  printf '%s' "$1" | sed "s/['\\\\]/\\\\&/g"
  printf "'"
}
S="host=$(pg_value "$SRC_HOST") port=$(pg_value "$SRC_PORT") dbname=$(pg_value "$SRC_DB") user=$(pg_value "$SRC_USER") sslmode=$(pg_value "$SRC_SSL")"
D="host=$(pg_value "$DST_HOST") port=$(pg_value "$DST_PORT") dbname=$(pg_value "$DST_DB") user=$(pg_value "$DST_USER") sslmode=$(pg_value "$DST_SSL")"
# Pick whichever password form authenticates. See the note in the PowerShell
# caller: a password taken out of a postgresql:// URI may be the raw string or
# the percent-decoded one, and the two estates need opposite answers.
pick_pw() {
  conn="$1"; a="$2"; b="$3"
  if PGPASSWORD="$a" psql "$conn" -Atc 'select 1' >/dev/null 2>&1; then echo "$a"; return 0; fi
  if PGPASSWORD="$b" psql "$conn" -Atc 'select 1' >/dev/null 2>&1; then echo "$b"; return 0; fi
  return 1
}

if ! SRC_USE=$(pick_pw "$S" "$SRC_PW" "$SRC_PW_ALT"); then
  echo "FATAL: neither password form authenticates against the SOURCE"; exit 91
fi
if ! DST_USE=$(pick_pw "$D" "$DST_PW" "$DST_PW_ALT"); then
  echo "FATAL: neither password form authenticates against the TARGET"; exit 92
fi
echo "credentials resolved for both endpoints"
'@

$verifyOnly = $connectionSetup + "`n" + @'
echo "=== source reachability ==="
PGPASSWORD="$SRC_USE" psql "$S" -XAt -v ON_ERROR_STOP=1 -c "select 'source ok, tables=' || count(*) from information_schema.tables where table_schema='public'"
echo "=== target reachability ==="
PGPASSWORD="$DST_USE" psql "$D" -XAt -v ON_ERROR_STOP=1 -c "select 'target ok, tables=' || count(*) from information_schema.tables where table_schema='public'"
echo "=== source row counts ==="
PGPASSWORD="$SRC_USE" psql "$S" -XAt -v ON_ERROR_STOP=1 -c "select table_name from information_schema.tables where table_schema='public' order by 1" > /tmp/source-tables.tsv
while read -r t; do
  n=$(PGPASSWORD="$SRC_USE" psql "$S" -XAt -v ON_ERROR_STOP=1 -c "select count(*) from \"$t\"")
  echo "  $t = $n"
done < /tmp/source-tables.tsv
echo "DRY RUN COMPLETE - nothing was written"
'@

$fullCopy = $connectionSetup + "`n" + @'
cat > /tmp/manifest.sql <<'MANIFEST_SQL'
SET TIME ZONE 'UTC';
DO $body$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  LOOP
    EXECUTE format(
      'INSERT INTO copy_manifest SELECT %L, count(*), md5(coalesce(string_agg(h, %L ORDER BY h), %L)) FROM (SELECT md5(to_jsonb(t)::text) AS h FROM %I.%I t) s',
      r.tablename, '', '', r.schemaname, r.tablename
    );
  END LOOP;
END
$body$;
SELECT table_name || E'\t' || row_count || E'\t' || payload_hash FROM copy_manifest ORDER BY table_name;
MANIFEST_SQL

mkfifo -m 600 /tmp/snapshot-input
PGPASSWORD="$SRC_USE" psql "$S" -XqAt -v ON_ERROR_STOP=1 < /tmp/snapshot-input > /tmp/snapshot.out 2>/tmp/snapshot.err &
snapshot_pid=$!
exec 3> /tmp/snapshot-input
release_snapshot() {
  work_status=$?
  trap - EXIT
  exec 3>&-
  if ! rm /tmp/snapshot-input; then
    echo "FATAL: owned source snapshot input cleanup failed" >&2
    if [ "$work_status" -eq 0 ]; then work_status=97; fi
  fi
  if wait "$snapshot_pid"; then exit "$work_status"; fi
  echo "FATAL: source snapshot client did not close cleanly" >&2
  if [ "$work_status" -eq 0 ]; then exit 97; fi
  exit "$work_status"
}
trap release_snapshot EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n' >&3
snapshot=''
for attempt in $(seq 1 30); do
  snapshot=$(head -n 1 /tmp/snapshot.out)
  if printf '%s\n' "$snapshot" | grep -Eq '^[0-9A-F]+-[0-9A-F]+-[0-9]+$'; then break; fi
  if ! kill -0 "$snapshot_pid" 2>/dev/null; then echo "FATAL: source snapshot could not be held"; exit 93; fi
  sleep 1
done
if ! printf '%s\n' "$snapshot" | grep -Eq '^[0-9A-F]+-[0-9A-F]+-[0-9]+$'; then
  echo "FATAL: source snapshot is unavailable"; exit 93
fi
{
  printf 'CREATE TEMP TABLE copy_manifest (table_name text, row_count bigint, payload_hash text);\n'
  printf "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '%s';\n" "$snapshot"
  cat /tmp/manifest.sql
  printf 'ROLLBACK;\n'
} | PGPASSWORD="$SRC_USE" psql "$S" -XqAt -v ON_ERROR_STOP=1 > /tmp/source-manifest.tsv

echo "=== dumping the fingerprinted snapshot ==="
PGPASSWORD="$SRC_USE" pg_dump --snapshot "$snapshot" --no-owner --no-acl --format=custom -d "$S" --file /tmp/dump.archive
BYTES=$(wc -c < /tmp/dump.archive)
echo "dump bytes: $BYTES"

# A failed pg_dump leaves an empty or truncated file, and restoring it then
# reports success - a copy that looks clean and moved nothing, while --clean
# empties the target. The tenant-08 prod carry did exactly that: 0-byte dump,
# rc=0 restore, emptied target. Refuse anything implausibly small.
if [ "$BYTES" -lt 10000 ]; then
  echo "FATAL: dump is only $BYTES bytes - refusing to restore a truncated or empty dump"
  exit 90
fi

echo "=== restoring ==="
if ! PGPASSWORD="$DST_USE" pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl -d "$D" /tmp/dump.archive > /tmp/restore.out 2>/tmp/restore.err; then
  echo "FATAL: restore failed; target must remain suspended"; exit 94
fi
{
  printf 'CREATE TEMP TABLE copy_manifest (table_name text, row_count bigint, payload_hash text);\n'
  cat /tmp/manifest.sql
} | PGPASSWORD="$DST_USE" psql "$D" -XqAt -v ON_ERROR_STOP=1 > /tmp/target-manifest.tsv
if ! cmp -s /tmp/source-manifest.tsv /tmp/target-manifest.tsv; then
  echo "FATAL: source/target manifest mismatch; target must remain suspended"; exit 95
fi
invalid=$(PGPASSWORD="$DST_USE" psql "$D" -XqAt -v ON_ERROR_STOP=1 -c \
  "SELECT (SELECT count(*) FROM pg_index WHERE NOT indisvalid) + (SELECT count(*) FROM pg_constraint WHERE NOT convalidated)")
if [ "$invalid" != '0' ]; then echo "FATAL: target indexes or constraints are invalid"; exit 96; fi
echo "COPY COMPLETE: snapshot manifest matches"
echo "tables verified: $(wc -l < /tmp/target-manifest.tsv)"
sha256sum /tmp/source-manifest.tsv /tmp/target-manifest.tsv
'@

$script = if ($DryRun) { $verifyOnly } else { $fullCopy }

# Build the job definition as YAML. Passing a multi-line shell script through
# --args on the command line is an escaping minefield; a YAML file is not.
#
# The script becomes a YAML block scalar under `args: - |`. Its content MUST be
# indented DEEPER than the `-` sequence marker, otherwise the parser reads the
# first script line as a new mapping key and fails with "could not find expected ':'".
# `- |` sits at 10 spaces, so the body sits at 12.
$yamlDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("scim-pgcopy-" + $runId)
$yamlPath = Join-Path $yamlDirectory 'job.yaml'
$indented = ($script -split "`n" | ForEach-Object { '            ' + $_.TrimEnd("`r") }) -join "`n"
$srcPasswordJson = ConvertTo-Json -InputObject $src.Password -Compress
$srcAlternateJson = ConvertTo-Json -InputObject $srcPwAlt -Compress
$dstPasswordJson = ConvertTo-Json -InputObject $dst.Password -Compress
$dstAlternateJson = ConvertTo-Json -InputObject $dstPwAlt -Compress

$yaml = @"
tags:
  scimserverCopyRun: $runId
properties:
  environmentId: $envId
  configuration:
    triggerType: Manual
    replicaTimeout: 3600
    replicaRetryLimit: 0
    manualTriggerConfig:
      parallelism: 1
      replicaCompletionCount: 1
    secrets:
      - name: srcpw
        value: $srcPasswordJson
      - name: srcpwalt
        value: $srcAlternateJson
      - name: dstpw
        value: $dstPasswordJson
      - name: dstpwalt
        value: $dstAlternateJson
  template:
    containers:
      - name: pgcopy
        image: postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3
        command:
          - /bin/sh
          - -c
        args:
          - |
$indented
        env:
          - name: SRC_HOST
            value: "$($src.DbHost)"
          - name: SRC_PORT
            value: "$($src.Port)"
          - name: SRC_DB
            value: "$($src.Database)"
          - name: SRC_USER
            value: "$($src.User)"
          - name: SRC_SSL
            value: "$($src.SslMode)"
          - name: SRC_PW
            secretRef: srcpw
          - name: SRC_PW_ALT
            secretRef: srcpwalt
          - name: DST_HOST
            value: "$($dst.DbHost)"
          - name: DST_PORT
            value: "$($dst.Port)"
          - name: DST_DB
            value: "$($dst.Database)"
          - name: DST_USER
            value: "$($dst.User)"
          - name: DST_SSL
            value: "$($dst.SslMode)"
          - name: DST_PW
            secretRef: dstpw
          - name: DST_PW_ALT
            secretRef: dstpwalt
        resources:
          cpu: 1.0
          memory: 2Gi
"@

$jobCreated = $false
$jobCreateAttempted = $false
$copySucceeded = $false
$targetState = $null
$stopAttempted = $false
$copyFailure = $null
$cleanupFailures = [Collections.Generic.List[System.Management.Automation.ErrorRecord]]::new()
try {
    Initialize-CopyPrivateDirectory -Path $yamlDirectory
    Set-Content -Path $yamlPath -Value $yaml -Encoding UTF8

    # Quiesce the target application. Restoring underneath a live replica is a
    # race: the app re-seeds tables between the DROP and the COPY, and the result
    # passes every count check while holding the wrong rows.
    if (-not $DryRun -and $TargetAppName) {
        $rgForApp = if ($TargetAppResourceGroup) { $TargetAppResourceGroup } else { $TargetResourceGroup }
        Write-Host ""
        Say "stopping target app '$TargetAppName' for the duration of the restore..." 'Yellow'
        $targetState = Get-CopyTargetRevisionState -AppName $TargetAppName -ResourceGroup $rgForApp -Subscription $Subscription
        Say "original active revisions: $($targetState.ActiveRevisions -join ', ')"
        $stopAttempted = $true
        Suspend-CopyTargetWriters -AppName $TargetAppName -ResourceGroup $rgForApp -Subscription $Subscription -State $targetState
        Say "target app stopped" 'Green'
    }

    Write-Host ""
    Say "creating ephemeral job '$JobName'..." 'Yellow'
    $jobCreateAttempted = $true
    Invoke-CopyAzAction -Arguments @(
        'containerapp', 'job', 'create', '-n', $JobName, '-g', $TargetResourceGroup,
        '--yaml', $yamlPath, '--subscription', $Subscription
    )
    $jobCreated = $true
    Say "job created" 'Green'

    Say "starting execution..." 'Yellow'
    $exec = Invoke-CopyAzJson -Arguments @(
        'containerapp', 'job', 'start', '-n', $JobName, '-g', $TargetResourceGroup,
        '--subscription', $Subscription
    )
    $execName = $exec.name
    if (-not $execName) { throw 'Copy execution identity is missing.' }
    Say "execution: $execName"

    # Poll the execution rather than trusting any single command's exit code.
    $deadline = (Get-Date).AddMinutes(45)
    $status = ''
    while ((Get-Date) -lt $deadline) {
        $execution = Invoke-CopyAzJson -Arguments @(
            'containerapp', 'job', 'execution', 'show', '-n', $JobName, '-g', $TargetResourceGroup,
            '--job-execution-name', $execName, '--subscription', $Subscription
        )
        $status = $execution.properties.status
        if (-not $status) { throw 'Copy execution status is unavailable.' }
        if ($status -in @('Succeeded', 'Failed', 'Stopped')) { break }
        Start-Sleep -Seconds 15
    }
    Say ("execution status: $status") $(if ($status -eq 'Succeeded') { 'Green' } else { 'Red' })

    Write-Host ""
    Write-Host "  ---- job output ----" -ForegroundColor Cyan
    az containerapp job logs show -n $JobName -g $TargetResourceGroup `
        --execution $execName --container pgcopy --tail 300 --subscription $Subscription --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw 'Copy execution logs could not be retrieved.' }

    if ($status -ne 'Succeeded') { throw "Transfer did not succeed (status=$status). See output above." }
    $copySucceeded = $true
}
catch {
    $copyFailure = $_
}
finally {
    try {
        if ($stopAttempted) {
            if ($copySucceeded) {
                Resume-CopyTargetWriters -AppName $TargetAppName -ResourceGroup $rgForApp -Subscription $Subscription -State $targetState
                Say 'original target revisions reactivated; scale configuration preserved' 'Green'
            } else {
                Write-Warning "Copy failed. Target revisions remain suspended; reconcile data before reactivation."
            }
        }
    } catch {
        $cleanupFailures.Add($_)
    }
    try {
        if ($jobCreateAttempted -and -not $KeepJob) {
            Remove-OwnedCopyJob -JobName $JobName -ResourceGroup $TargetResourceGroup -Subscription $Subscription -RunId $runId
            Say 'owned ephemeral job absence verified'
        }
    } catch {
        $cleanupFailures.Add($_)
    }
    try {
        if (Test-Path -LiteralPath $yamlPath) { Remove-Item -LiteralPath $yamlPath -Force }
        if (Test-Path -LiteralPath $yamlDirectory) { Remove-Item -LiteralPath $yamlDirectory }
    } catch {
        $cleanupFailures.Add($_)
    }
}

foreach ($failure in $cleanupFailures) {
    Write-Warning "Copy cleanup failed: $($failure.Exception.Message)"
}
if ($copyFailure) { throw $copyFailure }
if ($cleanupFailures.Count -gt 0) { throw $cleanupFailures[0] }

Write-Host ""
Write-Host "Done." -ForegroundColor Green
