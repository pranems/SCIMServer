param(
    [Parameter(Mandatory)]
    [string]$Image,
    [switch]$ImageEntrypoint
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$entrypoint = Join-Path $root 'api\docker-entrypoint.sh'
$passed = 0
$failed = 0
$fixtureUrl = 'postgresql://startup-fixture-user:startup-fixture-password@startup-fixture.invalid:5432/fixture_database'
$fixtureMarkers = @($fixtureUrl, 'startup-fixture-user', 'startup-fixture-password', 'startup-fixture.invalid')

function Assert-Contract {
    param([string]$Name, [bool]$Success)
    if ($Success) {
        $script:passed++
        Write-Output "PASS: $Name"
    } else {
        $script:failed++
        Write-Output "FAIL: $Name"
    }
}

$fixture = @'
set -eu
mkdir -p /tmp/entrypoint-contract-bin
cat > /tmp/entrypoint-contract-bin/node <<'NODE'
#!/bin/sh
case "$1" in
  dist/main.js) printf '%s\n' 'entrypoint-application-child-ok' ;;
  node_modules/prisma/build/index.js) printf '%s\n' 'entrypoint-migration-child-ok' ;;
  *) printf '%s\n' 'unexpected-entrypoint-child' >&2; exit 64 ;;
esac
NODE
chmod +x /tmp/entrypoint-contract-bin/node
PATH="/tmp/entrypoint-contract-bin:$PATH"
export PATH
exec /app/docker-entrypoint.sh
'@
$fixture = $fixture.Replace("`r`n", "`n")

foreach ($backend in @('inmemory', 'prisma')) {
    foreach ($configuration in @('configured', 'unset', 'empty')) {
        $arguments = @('run', '--rm', '--network', 'none', '--entrypoint', 'sh')
        if (-not $ImageEntrypoint) {
            $arguments += @('--mount', "type=bind,source=$entrypoint,target=/app/docker-entrypoint.sh,readonly")
        }
        $arguments += @('-e', "PERSISTENCE_BACKEND=$backend")
        if ($configuration -eq 'configured') { $arguments += @('-e', "DATABASE_URL=$fixtureUrl") }
        elseif ($configuration -eq 'empty') { $arguments += @('-e', 'DATABASE_URL=') }
        $arguments += @($Image, '-c', $fixture)
        $output = & docker @arguments 2>&1
        $code = $LASTEXITCODE
        $text = $output -join "`n"
        $label = "$backend/$configuration"
        if ($code -ne 0) {
            $diagnostic = $text
            foreach ($marker in $fixtureMarkers) { $diagnostic = $diagnostic.Replace($marker, '[fixture-redacted]') }
            Write-Output "$label container exit $code"
            Write-Output (($diagnostic -split "`n" | Select-Object -First 8) -join "`n")
        }
        Assert-Contract "$label reaches application child" ($code -eq 0 -and $text.Contains('entrypoint-application-child-ok'))
        $migrationIndex = $text.IndexOf('entrypoint-migration-child-ok')
        $applicationIndex = $text.IndexOf('entrypoint-application-child-ok')
        $migrationPolicy = if ($backend -eq 'prisma') {
            $migrationIndex -ge 0 -and $migrationIndex -lt $applicationIndex
        } else {
            $migrationIndex -lt 0
        }
        Assert-Contract "$label preserves migrate-before-start or InMemory bypass" $migrationPolicy
        $disclosed = @($fixtureMarkers | Where-Object { $text.Contains($_) })
        Assert-Contract "$label discloses no connection URI, username, password or hostname" ($disclosed.Count -eq 0)
        $expected = if ($configuration -eq 'configured') { 'DATABASE_URL: configured' } else { 'DATABASE_URL: (not set)' }
        Assert-Contract "$label reports configuration presence accurately" ($text.Contains($expected))
    }
}

Write-Output "Entrypoint contract: $passed PASS / $failed FAIL"
if ($failed -gt 0) { exit 1 }
