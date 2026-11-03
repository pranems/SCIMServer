[CmdletBinding()]
param([string]$PgImage = 'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3')
$ErrorActionPreference = 'Stop'
if ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'rotate-tenant-data.ps1') -Raw) -notmatch
    ('image: ' + [regex]::Escape($PgImage))) {
    throw 'RED: Azure copy job does not use the immutable PostgreSQL image tested by this runner.'
}
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'rotate-tenant-data.ps1'), [ref]$tokens, [ref]$errors
)
if ($errors.Count) { throw ($errors | Out-String) }
$assignments = foreach ($name in @('$connectionSetup', '$verifyOnly')) {
    $node = $ast.Find({
        param($n)
        $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq $name
    }, $true)
    if ($node) { $node.Extent.Text }
}
$verify = & ([scriptblock]::Create(($assignments -join "`n") + "`nreturn " + '$verifyOnly'))
$stub = @'
set -eu
cat > /tmp/psql <<'PSQL'
#!/bin/sh
if [ "$PGPASSWORD" != 'synthetic-decoded' ]; then exit 41; fi
case "$*" in
  *'select table_name'*)
    if [ "$FAIL_ENUMERATION" = 1 ]; then exit 42; fi
    exit 0 ;;
esac
echo 0
PSQL
chmod 700 /tmp/psql
export PATH="/tmp:$PATH"
'@
foreach ($failure in @('0', '1')) {
    $output = ($stub + "`n" + $verify) | & docker run --rm --network none --interactive --entrypoint sh `
        --env SRC_HOST=fixture --env SRC_PORT=5432 --env SRC_DB=source --env SRC_USER=fixture --env SRC_SSL=disable `
        --env SRC_PW=synthetic-encoded --env SRC_PW_ALT=synthetic-decoded `
        --env DST_HOST=fixture --env DST_PORT=5432 --env DST_DB=target --env DST_USER=fixture --env DST_SSL=disable `
        --env DST_PW=synthetic-encoded --env DST_PW_ALT=synthetic-decoded --env "FAIL_ENUMERATION=$failure" `
        $PgImage -c 'tr -d "\r" | sh'
    if ($failure -eq '0') {
        if ($LASTEXITCODE -ne 0 -or ($output -join "`n") -notmatch 'DRY RUN COMPLETE') {
            throw 'RED: copy preflight does not authenticate with the same alternate password resolver as full copy.'
        }
        Write-Host 'PASS: preflight resolves both alternate passwords without a data write'
    } else {
        if ($LASTEXITCODE -eq 0 -or ($output -join "`n") -match 'DRY RUN COMPLETE') {
            throw 'Preflight silently accepts failed table enumeration.'
        }
        Write-Host 'PASS: failed source table enumeration cannot report dry-run success'
    }
}
