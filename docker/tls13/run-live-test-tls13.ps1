<#
.SYNOPSIS
  Runs the full scripts/live-test.ps1 SCIM contract suite against the TLS
  1.3-only standalone instance.

.DESCRIPTION
  live-test.ps1 makes ~1000 Invoke-RestMethod / Invoke-WebRequest calls and has
  no certificate-trust switch. Rather than modify the harness, this wrapper sets
  $global:PSDefaultParameterValues so every HTTP cmdlet in the session skips
  certificate validation, then invokes the harness IN THE SAME SESSION so the
  defaults are inherited.

  This is only acceptable because the target is a local throwaway self-signed
  instance. Never do this against a real endpoint.
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'https://localhost:8443',
    [string]$ClientSecret = 'changeme-oauth',
    [string]$TranscriptPath
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here '..\..')
$liveTest = Join-Path $repoRoot 'scripts\live-test.ps1'

if (-not (Test-Path $liveTest)) { throw "live-test.ps1 not found at $liveTest" }

if (-not $TranscriptPath) {
    $resultsDir = Join-Path $repoRoot 'test-results'
    New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
    $TranscriptPath = Join-Path $resultsDir ("live-test-tls13-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

# Self-signed throwaway certificate. Applies to the whole session, which the
# harness inherits.
$global:PSDefaultParameterValues['Invoke-RestMethod:SkipCertificateCheck'] = $true
$global:PSDefaultParameterValues['Invoke-WebRequest:SkipCertificateCheck'] = $true

Write-Host "Running live-test.ps1 against $BaseUrl" -ForegroundColor Cyan
Write-Host "Transcript: $TranscriptPath" -ForegroundColor DarkGray

Start-Transcript -Path $TranscriptPath -Force | Out-Null
try {
    & $liveTest -BaseUrl $BaseUrl -ClientSecret $ClientSecret
} finally {
    Stop-Transcript | Out-Null
}

Write-Host "`nTranscript written to $TranscriptPath" -ForegroundColor Green
