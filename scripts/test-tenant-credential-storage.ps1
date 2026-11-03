[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'setup-deploy-sp.ps1'), [ref]$tokens, [ref]$errors
)
if ($errors.Count) { throw ($errors | Out-String) }
$function = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Protect-CredFile'
}, $true)
if (-not $function) { throw 'Credential protector is missing.' }
. ([scriptblock]::Create($function.Extent.Text))
$file = Join-Path ([IO.Path]::GetTempPath()) ("scim-cred-test-" + [guid]::NewGuid().ToString('N') + '.json')
$rejected = $false
try { Protect-CredFile -Path $file }
catch [System.Management.Automation.RuntimeException] { $rejected = $true }
if (-not $rejected) { throw 'RED: credential protector silently accepts failure instead of blocking secret persistence' }
Write-Host 'PASS: nonexistent credential file fails explicitly'
try {
    [IO.File]::WriteAllText($file, '')
    Protect-CredFile -Path $file
    Protect-CredFile -Path $file
    if ($IsWindows) {
        $acl = Get-Acl -LiteralPath $file
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $identities = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
        if (-not $acl.AreAccessRulesProtected -or $identities.Count -ne 1 -or $identities[0] -ne $sid) {
            throw 'Credential file is not restricted to the capturing Windows user.'
        }
    }
    Write-Host 'PASS: credential ACL is private before any secret is written'
} finally {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
}
