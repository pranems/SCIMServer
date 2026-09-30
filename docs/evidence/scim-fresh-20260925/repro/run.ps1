[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('Check', 'Generate', 'UnitPatch', 'UnitContracts', 'BaselineHttp', 'Observations', 'HttpRed', 'History')]
  [string]$Lane
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$oldLocation = Get-Location
$savedEnvironment = @{}
foreach ($key in @('PERSISTENCE_BACKEND', 'DATABASE_URL', 'NODE_ENV', 'LOG_FILE')) {
  $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
$code = 0
try {
  Set-Location $root
  & node (Join-Path $PSScriptRoot 'runtime.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Pinned-source safety check failed.' }
  $env:PERSISTENCE_BACKEND = 'inmemory'
  $env:DATABASE_URL = 'postgresql://127.0.0.1:1/scim_fresh_analysis_never_connect'
  $env:NODE_ENV = 'test'
  $env:LOG_FILE = ''

  switch ($Lane) {
    Check {
      foreach ($file in Get-ChildItem $PSScriptRoot -Filter '*.cjs' -File) {
        & node --check $file.FullName
        if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $($file.Name)" }
      }
      Write-Output 'All analysis-only JavaScript files parse.'
    }
    Generate {
      Set-Location (Join-Path $root 'api')
      & npm run prisma:generate
      $code = $LASTEXITCODE
    }
    UnitPatch {
      Set-Location (Join-Path $root 'api')
      $tests = @(
        'src\domain\patch\user-patch-engine.spec.ts',
        'src\domain\patch\group-patch-engine.spec.ts',
        'src\domain\patch\generic-patch-engine.spec.ts',
        'src\domain\validation\schema-validator.spec.ts',
        'src\modules\scim\utils\scim-patch-path.spec.ts'
      )
      & npm test -- --runInBand --cacheDirectory '..\test-results\fresh-analysis\repro\jest-cache' --runTestsByPath @tests
      $code = $LASTEXITCODE
    }
    UnitContracts {
      Set-Location (Join-Path $root 'api')
      $tests = @(
        'src\modules\endpoint\endpoint-config.interface.spec.ts',
        'src\modules\endpoint\endpoint-config-conformance.spec.ts',
        'src\modules\endpoint\endpoint-config-ui-coverage.spec.ts',
        'src\modules\scim\common\scim-attribute-projection.spec.ts',
        'src\domain\validation\rfc-compliant-subattributes.spec.ts',
        'src\oauth\egress-policy.spec.ts',
        'src\modules\scim\filters\scim-filter-parser.spec.ts'
      )
      & npm test -- --runInBand --cacheDirectory '..\test-results\fresh-analysis\repro\jest-cache' --runTestsByPath @tests
      $code = $LASTEXITCODE
    }
    BaselineHttp {
      Set-Location (Join-Path $root 'api')
      $tests = @(
        'test\e2e\advanced-patch.e2e-spec.ts',
        'test\e2e\schema-validation.e2e-spec.ts',
        'test\e2e\generic-filter-operators.e2e-spec.ts',
        'test\e2e\discovery-enforcement-parity.e2e-spec.ts',
        'test\e2e\endpoint-profile.e2e-spec.ts',
        'test\e2e\bulk-operations.e2e-spec.ts',
        'test\e2e\me-endpoint.e2e-spec.ts',
        'test\e2e\etag-conditional.e2e-spec.ts',
        'test\e2e\sorting.e2e-spec.ts'
      )
      & npm run test:e2e -- --runInBand --cacheDirectory '..\test-results\fresh-analysis\repro\jest-cache' --runTestsByPath @tests
      $code = $LASTEXITCODE
    }
    Observations {
      & node (Join-Path $PSScriptRoot 'observations.cjs')
      $code = $LASTEXITCODE
    }
    HttpRed {
      Set-Location (Join-Path $root 'api')
      $configArgs = @('--config', (Join-Path $PSScriptRoot 'jest.red.config.cjs'))
      $target = Join-Path $PSScriptRoot 'http-probes.spec.cjs'
      $discoveredJson = & node '.\node_modules\jest\bin\jest.js' @configArgs --listTests --json
      if ($LASTEXITCODE -ne 0) { throw 'Opt-in RED discovery failed.' }
      $discovered = @(ConvertFrom-Json -InputObject ($discoveredJson -join "`n"))
      if ($discovered.Count -ne 1 -or $discovered[0] -ne $target) {
        throw 'Refusing RED execution: discovery did not select exactly the analysis-only spec.'
      }
      & node '.\node_modules\jest\bin\jest.js' @configArgs --runTestsByPath $target --runInBand --forceExit
      $code = $LASTEXITCODE
    }
    History {
      & node (Join-Path $PSScriptRoot 'history.cjs')
      $code = $LASTEXITCODE
    }
  }
} finally {
  foreach ($key in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process')
  }
  Set-Location $oldLocation
}
exit $code
