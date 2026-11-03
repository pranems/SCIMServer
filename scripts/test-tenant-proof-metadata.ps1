[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'setup-auth-proof-apps.ps1'), [ref]$tokens, [ref]$errors
)
if ($errors.Count) { throw ($errors | Out-String) }
$function = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Get-ProofTokenMetadata'
}, $true)
if (-not $function) { throw 'RED: proof bootstrap does not verify actual token issuer/audience metadata.' }
. (Join-Path $PSScriptRoot 'jwt-parts.ps1')
. ([scriptblock]::Create($function.Extent.Text))
$tenant = [guid]::NewGuid().ToString()
$app = [guid]::NewGuid().ToString()
function New-TestToken {
    param($Claims)
    $segments = @(@{ alg = 'RS256' }, $Claims) | ForEach-Object {
        [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($_ | ConvertTo-Json -Compress))).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    }
    ($segments -join '.') + '.fixture'
}
foreach ($version in @('1.0', '2.0')) {
    $issuer = if ($version -eq '1.0') { "https://sts.windows.net/$tenant/" } else { "https://login.microsoftonline.com/$tenant/v2.0" }
    $claims = @{ ver = $version; iss = $issuer; tid = $tenant; aud = $app; sub = 'fixture-subject' }
    if ($version -eq '1.0') { $claims.appid = $app } else { $claims.azp = $app }
    $metadata = Get-ProofTokenMetadata -Token (New-TestToken $claims) -TenantId $tenant -AppId $app
    $keys = if ($version -eq '1.0') { "https://login.microsoftonline.com/$tenant/discovery/keys" } else { "https://login.microsoftonline.com/$tenant/discovery/v2.0/keys" }
    if ($metadata.issuer -ne $issuer -or $metadata.jwksUri -ne $keys -or $metadata.subject -ne 'fixture-subject') { throw "Incorrect $version proof metadata." }
    Write-Host "PASS: $version issuer and key discovery follow actual claims"
}
foreach ($field in @('tid', 'aud', 'iss', 'appid', 'sub')) {
    $claims = @{ ver = '1.0'; iss = "https://sts.windows.net/$tenant/"; tid = $tenant; aud = $app; appid = $app; sub = 'fixture-subject' }
    $claims[$field] = if ($field -eq 'sub') { '' } else { 'unexpected' }
    $rejected = $false
    try { Get-ProofTokenMetadata -Token (New-TestToken $claims) -TenantId $tenant -AppId $app | Out-Null }
    catch { if ($_.Exception.Message -notlike '*Proof token*') { throw }; $rejected = $true }
    if (-not $rejected) { throw "Invalid $field accepted." }
    Write-Host "PASS: invalid $field blocks usable proof metadata"
}
