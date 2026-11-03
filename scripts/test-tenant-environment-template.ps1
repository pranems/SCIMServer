[CmdletBinding()]
param([Parameter(Mandatory)][string]$BicepPath)
$ErrorActionPreference = 'Stop'
$output = Join-Path ([IO.Path]::GetTempPath()) ("scim-env-template-" + [guid]::NewGuid().ToString('N') + '.json')
try {
    & $BicepPath build (Join-Path (Split-Path $PSScriptRoot) 'infra\containerapp-env.bicep') --outfile $output
    if ($LASTEXITCODE -ne 0) { throw 'Environment template compilation failed.' }
    $template = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
    $environment = @($template.resources | Where-Object type -eq 'Microsoft.App/managedEnvironments')
    if ($environment.Count -ne 1) { throw 'Expected one managed environment.' }
    $profiles = @($environment[0].properties.workloadProfiles)
    if ($profiles.Count -ne 1 -or $profiles[0].name -ne 'Consumption' -or $profiles[0].workloadProfileType -ne 'Consumption') {
        throw 'RED: delegated-subnet template does not explicitly preserve the source Consumption workload profile.'
    }
    if ($environment[0].properties.appLogsConfiguration.destination -ne 'log-analytics') {
        throw 'Source logging destination changed.'
    }
    Write-Host 'PASS: compiled environment preserves Consumption workload profile and Log Analytics'
} finally {
    if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output }
}
