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
    Name of the ephemeral job. Reused and overwritten between runs.

.PARAMETER KeepJob
    Leave the job resource behind for inspection instead of deleting it.

.PARAMETER DryRun
    Print what would happen and verify connectivity, but copy nothing.

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
    [string]$TargetAppResourceGroup
)

$ErrorActionPreference = 'Stop'
if ($AzureConfigDir) { $env:AZURE_CONFIG_DIR = $AzureConfigDir }

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

az account set --subscription $Subscription 2>$null | Out-Null
$envId = az containerapp env show -n $EnvironmentName -g $TargetResourceGroup --query id -o tsv 2>$null
if (-not $envId) { throw "Container Apps environment '$EnvironmentName' not found in '$TargetResourceGroup'." }

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
    $ssl = 'require'
    if ($qs -and $qs -match 'sslmode=([^&]+)') { $ssl = $Matches[1] }
    [pscustomobject]@{
        DbHost   = $h
        Port     = if ($prt) { $prt } else { '5432' }
        Database = $db
        User     = $user
        Password = $pass
        SslMode  = $ssl
    }
}

$src = Split-PgUri -Uri $SourceConnectionString -Which 'Source'
$dst = Split-PgUri -Uri $TargetConnectionString -Which 'Target'
Say ("source db : " + $src.Database + " as " + $src.User + " (sslmode=" + $src.SslMode + ")")
Say ("target db : " + $dst.Database + " as " + $dst.User + " (sslmode=" + $dst.SslMode + ")")

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
$verifyOnly = @'
set -eu
S="host=$SRC_HOST port=$SRC_PORT dbname=$SRC_DB user=$SRC_USER sslmode=$SRC_SSL"
D="host=$DST_HOST port=$DST_PORT dbname=$DST_DB user=$DST_USER sslmode=$DST_SSL"
echo "=== source reachability ==="
PGPASSWORD="$SRC_PW" psql "$S" -Atc "select 'source ok, tables=' || count(*) from information_schema.tables where table_schema='public'"
echo "=== target reachability ==="
PGPASSWORD="$DST_PW" psql "$D" -Atc "select 'target ok, tables=' || count(*) from information_schema.tables where table_schema='public'"
echo "=== source row counts ==="
PGPASSWORD="$SRC_PW" psql "$S" -Atc "select table_name from information_schema.tables where table_schema='public' order by 1" | while read t; do
  n=$(PGPASSWORD="$SRC_PW" psql "$S" -Atc "select count(*) from \"$t\"")
  echo "  $t = $n"
done
echo "DRY RUN COMPLETE - nothing was written"
'@

$fullCopy = @'
set -eu
S="host=$SRC_HOST port=$SRC_PORT dbname=$SRC_DB user=$SRC_USER sslmode=$SRC_SSL"
D="host=$DST_HOST port=$DST_PORT dbname=$DST_DB user=$DST_USER sslmode=$DST_SSL"

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

echo "=== source row counts BEFORE ==="
PGPASSWORD="$SRC_USE" psql "$S" -Atc "select table_name from information_schema.tables where table_schema='public' order by 1" | while read t; do
  n=$(PGPASSWORD="$SRC_USE" psql "$S" -Atc "select count(*) from \"$t\"")
  echo "  $t = $n"
done

echo "=== dumping ==="
PGPASSWORD="$SRC_USE" pg_dump --no-owner --no-acl --clean --if-exists --format=plain -d "$S" > /tmp/dump.sql
BYTES=$(wc -c < /tmp/dump.sql)
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
PGPASSWORD="$DST_USE" psql "$D" -v ON_ERROR_STOP=1 -q -f /tmp/dump.sql

echo "=== target row counts AFTER ==="
PGPASSWORD="$DST_USE" psql "$D" -Atc "select table_name from information_schema.tables where table_schema='public' order by 1" | while read t; do
  n=$(PGPASSWORD="$DST_USE" psql "$D" -Atc "select count(*) from \"$t\"")
  echo "  $t = $n"
done
echo "COPY COMPLETE"
'@

$script = if ($DryRun) { $verifyOnly } else { $fullCopy }

# Build the job definition as YAML. Passing a multi-line shell script through
# --args on the command line is an escaping minefield; a YAML file is not.
#
# The script becomes a YAML block scalar under `args: - |`. Its content MUST be
# indented DEEPER than the `-` sequence marker, otherwise the parser reads the
# first script line as a new mapping key and fails with "could not find expected ':'".
# `- |` sits at 10 spaces, so the body sits at 12.
$yamlPath = Join-Path ([System.IO.Path]::GetTempPath()) ("scim-pgcopy-" + [guid]::NewGuid().ToString('N') + ".yaml")
$indented = ($script -split "`n" | ForEach-Object { '            ' + $_.TrimEnd("`r") }) -join "`n"

$yaml = @"
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
        value: "$($src.Password)"
      - name: srcpwalt
        value: "$srcPwAlt"
      - name: dstpw
        value: "$($dst.Password)"
      - name: dstpwalt
        value: "$dstPwAlt"
  template:
    containers:
      - name: pgcopy
        image: postgres:17-alpine
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

try {
    Set-Content -Path $yamlPath -Value $yaml -Encoding UTF8

    # Quiesce the target application. Restoring underneath a live replica is a
    # race: the app re-seeds tables between the DROP and the COPY, and the result
    # passes every count check while holding the wrong rows.
    $quiesced = $false
    if (-not $DryRun -and $TargetAppName) {
        $rgForApp = if ($TargetAppResourceGroup) { $TargetAppResourceGroup } else { $TargetResourceGroup }
        Write-Host ""
        Say "stopping target app '$TargetAppName' for the duration of the restore..." 'Yellow'
        az containerapp update -n $TargetAppName -g $rgForApp --min-replicas 0 --max-replicas 0 -o none 2>&1 | Out-Null
        # The CLI abandons its poll before ARM finishes, so confirm by reading state.
        for ($i = 0; $i -lt 30; $i++) {
            $running = az containerapp replica list -n $TargetAppName -g $rgForApp -o tsv --query "length(@)" 2>$null
            if ($running -eq '0' -or [string]::IsNullOrWhiteSpace($running)) { break }
            Start-Sleep -Seconds 10
        }
        $quiesced = $true
        Say "target app stopped" 'Green'
    }

    Write-Host ""
    Say "creating ephemeral job '$JobName'..." 'Yellow'
    az containerapp job delete -n $JobName -g $TargetResourceGroup --yes -o none 2>$null | Out-Null
    $createOut = az containerapp job create -n $JobName -g $TargetResourceGroup --yaml $yamlPath 2>&1 | Out-String
    $created = az containerapp job show -n $JobName -g $TargetResourceGroup --query name -o tsv 2>$null
    if (-not $created) {
        Write-Host $createOut -ForegroundColor Red
        throw "Job creation failed - see the error above."
    }
    Say "job created" 'Green'

    Say "starting execution..." 'Yellow'
    $exec = az containerapp job start -n $JobName -g $TargetResourceGroup -o json 2>$null | ConvertFrom-Json
    $execName = $exec.name
    Say "execution: $execName"

    # Poll the execution rather than trusting any single command's exit code.
    $deadline = (Get-Date).AddMinutes(45)
    $status = ''
    while ((Get-Date) -lt $deadline) {
        $status = az containerapp job execution show -n $JobName -g $TargetResourceGroup `
            --job-execution-name $execName --query properties.status -o tsv 2>$null
        if ($status -in @('Succeeded', 'Failed', 'Stopped')) { break }
        Start-Sleep -Seconds 15
    }
    Say ("execution status: $status") $(if ($status -eq 'Succeeded') { 'Green' } else { 'Red' })

    Write-Host ""
    Write-Host "  ---- job output ----" -ForegroundColor Cyan
    az containerapp job logs show -n $JobName -g $TargetResourceGroup `
        --execution $execName --container pgcopy --tail 300 2>$null

    if ($status -ne 'Succeeded') { throw "Transfer did not succeed (status=$status). See output above." }
}
finally {
    Remove-Item $yamlPath -Force -ErrorAction SilentlyContinue
    if (-not $KeepJob) {
        az containerapp job delete -n $JobName -g $TargetResourceGroup --yes -o none 2>$null | Out-Null
        Say "ephemeral job removed"
    }
    # Always bring the app back, including on failure - leaving it at zero
    # replicas would turn a failed copy into an outage.
    if ($quiesced) {
        $rgForApp = if ($TargetAppResourceGroup) { $TargetAppResourceGroup } else { $TargetResourceGroup }
        Say "restarting target app '$TargetAppName'..." 'Yellow'
        az containerapp update -n $TargetAppName -g $rgForApp --min-replicas 1 --max-replicas 1 -o none 2>&1 | Out-Null
        Say "target app restarted"
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
