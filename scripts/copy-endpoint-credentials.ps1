<#
.SYNOPSIS
    Copy EndpointCredential rows between two SCIMServer databases, RE-POINTING
    them at the target's own endpoint ids so they are never orphaned.

.DESCRIPTION
    Why this exists rather than using the admin API: the API cannot preserve a
    secret. `POST /admin/endpoints/:id/credentials` always mints a fresh one
    (`crypto.randomBytes(32)` in admin-credential.controller.ts), so an API
    recreate produces credentials that LOOK right and authenticate differently.
    Copying the row preserves `credentialHash` (so the original secret still
    works) and `secretEnvelope` (so reveal still works).

    THE ORPHAN PROBLEM. Two estates that were carried from different source
    databases hold DIFFERENT ids for the same logical endpoint. Copying a
    credential row verbatim would leave `endpointId` pointing at an endpoint
    that does not exist in the target - the foreign key would reject it, or
    worse, it would attach to the wrong endpoint. Every row therefore has its
    `endpointId` rewritten to the TARGET endpoint's id, which is what makes the
    credentials appear under the right endpoint in the UI.

.PARAMETER Mapping
    One or more 'sourceEndpointId=targetEndpointId' pairs.

.PARAMETER DryRun
    Report what would be copied, and verify the target endpoints exist, without
    writing anything. This is the default posture: pass -Execute to write.

.NOTES
    Runs psql INSIDE Azure as an ephemeral Container Apps job, because the
    PostgreSQL firewalls allow Azure services only - no workstation rule exists
    and adding one leaves a standing exception behind (the previous estate
    accumulated 'AllowMyIP-temp' rules that outlived the machines that needed
    them).

    ON_ERROR_STOP=1 is set deliberately. psql otherwise continues past failures
    and exits 0, which is how a partial restore can look like a success.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceConnectionString,
    [Parameter(Mandatory)][string]$TargetConnectionString,
    [Parameter(Mandatory)][string[]]$Mapping,
    [Parameter(Mandatory)][string]$TargetResourceGroup,
    [Parameter(Mandatory)][string]$EnvironmentName,
    [Parameter(Mandatory)][string]$Subscription,
    [string]$AzureConfigDir,
    [string]$JobName = 'scim-credcopy',
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
function Say { param([string]$m, [string]$c = 'Gray') Write-Host $m -ForegroundColor $c }

if ($AzureConfigDir) { $env:AZURE_CONFIG_DIR = $AzureConfigDir }
$sharedExt = Join-Path $HOME '.azure/cliextensions'
if (Test-Path $sharedExt) { $env:AZURE_EXTENSION_DIR = $sharedExt }

function Split-PgUri {
    param([Parameter(Mandatory)][string]$Uri)
    $u = $Uri -replace '^postgres(ql)?://', ''
    $at = $u.LastIndexOf('@')
    if ($at -lt 0) { throw "Connection string has no credentials section." }
    $creds = $u.Substring(0, $at)
    $rest = $u.Substring($at + 1)
    $colon = $creds.IndexOf(':')
    $user = if ($colon -ge 0) { $creds.Substring(0, $colon) } else { $creds }
    $pass = if ($colon -ge 0) { $creds.Substring($colon + 1) } else { '' }
    $qm = $rest.IndexOf('?')
    $ssl = 'require'
    if ($qm -ge 0) {
        $q = $rest.Substring($qm + 1); $rest = $rest.Substring(0, $qm)
        foreach ($kv in ($q -split '&')) { if ($kv -match '^sslmode=(.+)$') { $ssl = $Matches[1] } }
    }
    $slash = $rest.IndexOf('/')
    $hostport = if ($slash -ge 0) { $rest.Substring(0, $slash) } else { $rest }
    $db = if ($slash -ge 0) { $rest.Substring($slash + 1) } else { 'postgres' }
    $hc = $hostport.LastIndexOf(':')
    $h = if ($hc -ge 0) { $hostport.Substring(0, $hc) } else { $hostport }
    $p = if ($hc -ge 0) { $hostport.Substring($hc + 1) } else { '5432' }
    return [pscustomobject]@{ DbHost = $h; Port = $p; Database = $db; User = $user; Password = $pass; SslMode = $ssl }
}
function Get-DecodedOrSame { param([string]$v) try { $d = [Uri]::UnescapeDataString($v); return $d } catch { return $v } }

$src = Split-PgUri -Uri $SourceConnectionString
$dst = Split-PgUri -Uri $TargetConnectionString
$srcAlt = Get-DecodedOrSame $src.Password
$dstAlt = Get-DecodedOrSame $dst.Password

# Validate the mapping up front - a malformed pair would silently copy nothing.
$pairs = @()
foreach ($m in $Mapping) {
    if ($m -notmatch '^([0-9a-fA-F-]{36})=([0-9a-fA-F-]{36})$') {
        throw "Mapping '$m' is not 'sourceUuid=targetUuid'."
    }
    $pairs += [pscustomobject]@{ Src = $Matches[1]; Dst = $Matches[2] }
}
$mapArg = ($pairs | ForEach-Object { "$($_.Src):$($_.Dst)" }) -join ' '

Say ""
Say "=== endpoint credential copy ===" 'Cyan'
Say ("  source db : {0}/{1}" -f $src.DbHost, $src.Database)
Say ("  target db : {0}/{1}" -f $dst.DbHost, $dst.Database)
Say ("  mappings  : {0}" -f $pairs.Count)
foreach ($p in $pairs) { Say ("     {0}  ->  {1}" -f $p.Src, $p.Dst) }
Say ("  mode      : {0}" -f $(if ($Execute) { 'EXECUTE (will write)' } else { 'DRY RUN (no writes)' })) $(if ($Execute) { 'Yellow' } else { 'Green' })

$mode = if ($Execute) { 'execute' } else { 'dryrun' }

$script = @'
set -e
pick_pw() {
  # Percent-encoding in generated passwords means the raw and decoded forms can
  # BOTH be plausible and only one authenticates. Probe rather than assume.
  for cand in "$1" "$2"; do
    if PGPASSWORD="$cand" psql -h "$3" -p "$4" -U "$5" -d "$6" -c 'SELECT 1' >/dev/null 2>&1; then
      echo "$cand"; return 0
    fi
  done
  echo "AUTH_FAILED" >&2; return 1
}

SPW=$(pick_pw "$SRC_PW" "$SRC_PW_ALT" "$SRC_HOST" "$SRC_PORT" "$SRC_USER" "$SRC_DB")
DPW=$(pick_pw "$DST_PW" "$DST_PW_ALT" "$DST_HOST" "$DST_PORT" "$DST_USER" "$DST_DB")
echo "authenticated to both databases"

SRC_CONN="host=$SRC_HOST port=$SRC_PORT dbname=$SRC_DB user=$SRC_USER sslmode=$SRC_SSL"
DST_CONN="host=$DST_HOST port=$DST_PORT dbname=$DST_DB user=$DST_USER sslmode=$DST_SSL"

: > /tmp/insert.sql
TOTAL=0

for PAIR in $MAPPINGS; do
  S="${PAIR%%:*}"
  D="${PAIR##*:}"

  # The target endpoint MUST exist, or the foreign key would reject the rows -
  # which is exactly the orphan case this tool is meant to prevent.
  EXISTS=$(PGPASSWORD="$DPW" psql "$DST_CONN" -At -c "SELECT count(*) FROM \"Endpoint\" WHERE id='$D';")
  if [ "$EXISTS" != "1" ]; then
    echo "ABORT: target endpoint $D does not exist - copying would orphan the rows"
    exit 9
  fi

  SRCN=$(PGPASSWORD="$SPW" psql "$SRC_CONN" -At -c "SELECT count(*) FROM \"EndpointCredential\" WHERE \"endpointId\"='$S';")
  DSTN=$(PGPASSWORD="$DPW" psql "$DST_CONN" -At -c "SELECT count(*) FROM \"EndpointCredential\" WHERE \"endpointId\"='$D';")
  echo "  $S -> $D   source rows=$SRCN  target rows(before)=$DSTN"
  TOTAL=$((TOTAL + SRCN))

  # %L quotes correctly and renders NULL unquoted, so nullable columns and JSON
  # survive intact. endpointId is replaced with the TARGET id.
  PGPASSWORD="$SPW" psql "$SRC_CONN" -At -c "
    SELECT format(
      'INSERT INTO \"EndpointCredential\" (id,\"endpointId\",\"credentialType\",\"credentialHash\",label,metadata,\"secretEnvelope\",active,\"createdAt\",\"expiresAt\") VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L) ON CONFLICT (id) DO NOTHING;',
      id, '$D', \"credentialType\", \"credentialHash\", label, metadata, \"secretEnvelope\", active, \"createdAt\", \"expiresAt\")
    FROM \"EndpointCredential\" WHERE \"endpointId\"='$S' ORDER BY \"createdAt\";" >> /tmp/insert.sql
done

echo "generated $(wc -l < /tmp/insert.sql) insert statement(s) for $TOTAL source row(s)"

if [ "$MODE" != "execute" ]; then
  echo "DRY RUN - nothing written. Statements that WOULD run:"
  sed 's/\(credentialHash[^,]*\)/<hash redacted>/' /tmp/insert.sql | cut -c1-160
  echo "DRYRUN COMPLETE"
  exit 0
fi

# Back up whatever the target holds for these endpoints before touching it.
for PAIR in $MAPPINGS; do
  D="${PAIR##*:}"
  PGPASSWORD="$DPW" psql "$DST_CONN" -At -c "SELECT id FROM \"EndpointCredential\" WHERE \"endpointId\"='$D';" >> /tmp/pre-existing.txt || true
done
echo "target rows existing before the copy: $(wc -l < /tmp/pre-existing.txt 2>/dev/null || echo 0)"

# ON_ERROR_STOP is what turns a partial failure into a visible one.
PGPASSWORD="$DPW" psql "$DST_CONN" -v ON_ERROR_STOP=1 -f /tmp/insert.sql
echo "insert applied"

for PAIR in $MAPPINGS; do
  S="${PAIR%%:*}"
  D="${PAIR##*:}"
  SRCN=$(PGPASSWORD="$SPW" psql "$SRC_CONN" -At -c "SELECT count(*) FROM \"EndpointCredential\" WHERE \"endpointId\"='$S';")
  DSTN=$(PGPASSWORD="$DPW" psql "$DST_CONN" -At -c "SELECT count(*) FROM \"EndpointCredential\" WHERE \"endpointId\"='$D';")
  ORPH=$(PGPASSWORD="$DPW" psql "$DST_CONN" -At -c "SELECT count(*) FROM \"EndpointCredential\" c LEFT JOIN \"Endpoint\" e ON e.id=c.\"endpointId\" WHERE e.id IS NULL;")
  echo "  VERIFY $D  source=$SRCN target=$DSTN  orphaned-rows-in-target=$ORPH"
  if [ "$SRCN" != "$DSTN" ]; then echo "MISMATCH on $D"; exit 8; fi
  if [ "$ORPH" != "0" ]; then echo "ORPHANS PRESENT"; exit 7; fi
done

echo "COPY COMPLETE"
'@

$envId = az containerapp env show -n $EnvironmentName -g $TargetResourceGroup --subscription $Subscription --query id -o tsv 2>$null
if (-not $envId) { throw "Could not resolve environment '$EnvironmentName' in '$TargetResourceGroup'." }

$indented = ($script -split "`n" | ForEach-Object { '            ' + $_.TrimEnd("`r") }) -join "`n"
$yamlPath = Join-Path ([IO.Path]::GetTempPath()) ("scim-credcopy-" + [guid]::NewGuid().ToString('N') + ".yaml")

$yaml = @"
properties:
  environmentId: $envId
  configuration:
    triggerType: Manual
    replicaTimeout: 1800
    replicaRetryLimit: 0
    manualTriggerConfig:
      parallelism: 1
      replicaCompletionCount: 1
    secrets:
      - name: srcpw
        value: "$($src.Password)"
      - name: srcpwalt
        value: "$srcAlt"
      - name: dstpw
        value: "$($dst.Password)"
      - name: dstpwalt
        value: "$dstAlt"
  template:
    containers:
      - name: credcopy
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
          - name: MAPPINGS
            value: "$mapArg"
          - name: MODE
            value: "$mode"
        resources:
          cpu: 0.5
          memory: 1Gi
"@

Set-Content -Path $yamlPath -Value $yaml -Encoding utf8

az containerapp job delete -n $JobName -g $TargetResourceGroup --subscription $Subscription --yes 2>$null | Out-Null
Say ""
Say "creating job $JobName..." 'Yellow'
az containerapp job create -n $JobName -g $TargetResourceGroup --subscription $Subscription --yaml $yamlPath 2>&1 | Out-Null
Remove-Item $yamlPath -ErrorAction SilentlyContinue

$exec = az containerapp job start -n $JobName -g $TargetResourceGroup --subscription $Subscription -o json 2>$null | ConvertFrom-Json
$execName = $exec.name
Say "execution: $execName"

$status = 'Running'
for ($i = 0; $i -lt 90 -and $status -notin @('Succeeded', 'Failed'); $i++) {
    Start-Sleep -Seconds 10
    $status = az containerapp job execution show -n $JobName -g $TargetResourceGroup --subscription $Subscription `
        --job-execution-name $execName --query properties.status -o tsv 2>$null
}
Say ("status: $status") $(if ($status -eq 'Succeeded') { 'Green' } else { 'Red' })

Say ""
Say "--- job output ---" 'Cyan'
az containerapp job logs show -n $JobName -g $TargetResourceGroup --subscription $Subscription `
    --execution $execName --container credcopy --tail 200 2>$null

if ($status -ne 'Succeeded') { exit 1 }
