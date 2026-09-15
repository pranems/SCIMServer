$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $repoRoot 'scripts/verify-opentext-isv6-corrections.ps1'
$source = Get-Content -LiteralPath $scriptPath -Raw
$failures = @()

function Assert-Contains {
    param([string]$Pattern, [string]$Message)

    if ($source -notmatch $Pattern) { $script:failures += $Message }
}

Assert-Contains "Get-ScimEstateBaseUrl\s+-Purpose" 'estate URL must resolve through scim-estates.ps1'
Assert-Contains "\[string\]\`$EndpointId\s*=\s*'10d6845a-a1fd-4151-aab0-3d7b0c5f0e01'" 'default must target the verified ISV-6 endpoint'
Assert-Contains "Group\.members\.type" 'must verify Group.members.type'
Assert-Contains "canonicalValues" 'must verify Group.members.type canonical values'
Assert-Contains "Group\.members\.\`$ref" 'must verify Group.members.$ref reference types'
Assert-Contains "User\.name requiredness" 'must verify User.name requiredness'
Assert-Contains "User givenName/familyName requiredness" 'must verify givenName and familyName requiredness'
Assert-Contains "urn:opentext:scim:schemas:extension:mailbox:2\\\.0:\(User\|Group\)" 'must select both vendor-owned mailbox schemas'
Assert-Contains "caseExact\s+-eq\s+\`$true" 'must require caseExact true'
Assert-Contains "multiValued\s+-eq\s+\`$true" 'must require multiValued true'
Assert-Contains "etag\.supported\s+-eq\s+\`$false" 'must preserve the endpoint ETag policy'
Assert-Contains "protected profile section" 'must guard unrelated profile sections by hash'
Assert-Contains "56fb6d0aa6cacec16dea046b55b14c721dbaa8dd8246f2510d584664c19894cc" 'must pin the corrected stored schema profile'
Assert-Contains "if \(\`$failures\.Count -gt 0\) \{ exit 1 \}" 'must return a failing exit code when any invariant fails'

$syntaxErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$syntaxErrors)
if ($syntaxErrors.Count -gt 0) {
    $failures += "verifier has PowerShell syntax errors: $($syntaxErrors.Message -join '; ')"
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
    exit 1
}

Write-Host 'PASS: OpenText ISV-6 verifier contract is complete and parseable.' -ForegroundColor Green
