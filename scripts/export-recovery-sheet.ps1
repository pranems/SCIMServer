<#
.SYNOPSIS
    Produce a single human-readable recovery sheet: every estate, URL,
    identifier and secret value needed to rebuild or take over this deployment.

.DESCRIPTION
    Written for a human to READ, not for a machine to parse. Open it, read it,
    copy what you need into wherever you keep such things, then DELETE IT.

    WHY A FILE AND NOT A CHAT MESSAGE OR A CONSOLE DUMP.
    Anything printed to a terminal lands in shell history, scrollback and any
    transcript or debug log the editor keeps. Anything pasted into a chat is
    written to a session transcript on disk. Both create copies of your secrets
    in places you are not tracking and cannot easily purge. A single file at a
    path you chose is the one form you can actually delete.

    Nothing here is printed to the console. The script reports only WHAT it
    collected and WHERE it wrote it.

.PARAMETER Path
    Where to write the sheet. Defaults beside the encrypted archive.

.PARAMETER IncludeSecrets
    Required to include secret VALUES. Without it you get a complete inventory
    with every value redacted, which is the safer thing to keep around and is
    usually what you actually want day to day.

.EXAMPLE
    pwsh -File scripts/export-recovery-sheet.ps1 -IncludeSecrets
#>
[CmdletBinding()]
param(
    [string]$Path,
    [switch]$IncludeSecrets
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'scim-estates.ps1')

function Get-DefaultSheetPath {
    $candidates = @(
        (Join-Path $HOME 'OneDrive - Microsoft\Documents\SCIMServer\secrets'),
        (Join-Path $HOME 'OneDrive\Documents\SCIMServer\secrets'),
        (Join-Path $HOME '.scimserver-deploy-backup')
    )
    foreach ($c in $candidates) {
        if (Test-Path (Split-Path $c -Parent)) {
            if (-not (Test-Path $c)) { New-Item -ItemType Directory -Force -Path $c | Out-Null }
            return Join-Path $c ("SCIMServer-RECOVERY-SHEET-{0}.txt" -f (Get-Date -Format 'yyyy-MM-dd'))
        }
    }
    return Join-Path $HOME ("SCIMServer-RECOVERY-SHEET-{0}.txt" -f (Get-Date -Format 'yyyy-MM-dd'))
}

$sheetPath = if ($Path) { $Path } else { Get-DefaultSheetPath }
$redact = -not $IncludeSecrets
function V { param($Value) if ($redact) { '<redacted - re-run with -IncludeSecrets>' } elseif ($null -eq $Value -or "$Value" -eq '') { '<not found>' } else { "$Value" } }

$sb = [Text.StringBuilder]::new()
function W { param([string]$Line = '') [void]$sb.AppendLine($Line) }

W "================================================================================"
W " SCIMServer - RECOVERY SHEET"
W " generated $(Get-Date -Format 'yyyy-MM-dd HH:mm') on $env:COMPUTERNAME"
W " secrets included: $(if ($IncludeSecrets) { 'YES - THIS FILE IS SENSITIVE' } else { 'no - values redacted' })"
W "================================================================================"
W ""
W "READ ME FIRST"
W "-------------"
W "  This file exists so you can copy what you need somewhere durable and then"
W "  DELETE IT. It is plaintext."
W ""
W "  Most of what is here does NOT need to be saved, because it can be recovered:"
W "    * App secrets for the live estates live in Azure Container Apps and can be"
W "      read back at any time with 'az containerapp secret show'."
W "    * Deployment service principal passwords and the auth-proof client secrets"
W "      can be REISSUED at any time. Reissuing is better than restoring, because"
W "      a reset also revokes anything that leaked."
W ""
W "  Exactly one category cannot be recovered: connection strings for a tenant"
W "  whose subscription has EXPIRED. Expiry kills the Azure control plane while"
W "  PostgreSQL keeps serving, so the database is still reachable but its"
W "  connection string can never be read from Azure again. Those are marked"
W "  IRREPLACEABLE below."
W ""

# ------------------------------------------------------------------ tenants
W "================================================================================"
W " 1. TENANTS"
W "================================================================================"

$reg = Get-ScimEstateRegistry
foreach ($t in $reg.tenants) {
    W ""
    W "  $($t.tenantName)   [role: $($t.role)]"
    W "  " + ("-" * 76)
    W "    tenant domain        : $($t.tenantDomain)"
    W "    tenant id            : $($t.tenantId)"
    W "    subscription name    : $($t.subscriptionName)"
    W "    subscription id      : $($t.subscriptionId)"
    W "    deploy SP name       : $($t.deploySpName)"
    W "    deploy SP app id     : $($t.deploySpAppId)"
    W "    deploy SP secret exp : $($t.deploySpSecretExpiresUtc)"
    W "    directory access     : $(if ($t.directoryAccessGranted) { 'granted (Application.ReadWrite.OwnedBy) - app registrations need no sign-in' } else { 'not granted - directory work needs an interactive sign-in' })"
    W "    CLI profile (auto)   : $($t.configDir)"
    W "    CLI profile (you)    : $($t.userConfigDir)"

    $credPath = $t.CredFilePath
    if (Test-Path $credPath) {
        $c = Get-Content $credPath -Raw | ConvertFrom-Json
        W "    deploy SP PASSWORD   : $(V $c.password)"
        W "      (source: $credPath)"
        W "      (reissue instead of restoring:  pwsh -File scripts/setup-deploy-sp.ps1 -Name $($t.key))"
    }
    else {
        W "    deploy SP PASSWORD   : <no credential file at $credPath>"
    }
}

# ------------------------------------------------------------------ estates
W ""
W "================================================================================"
W " 2. ESTATES - URLs, resources and app secrets"
W "================================================================================"

foreach ($e in $reg.estates) {
    W ""
    W "  ESTATE '$($e.id)'   purpose=$($e.purpose)   tenant=$($e.Tenant.tenantName) [$($e.Role)]"
    W "  " + ("-" * 76)
    W "    container app        : $($e.appName)"
    W "    resource group       : $($e.resourceGroup)"
    W "    region               : $($e.location)"
    W "    environment          : $($e.environmentName)  (in rg $($e.environmentResourceGroup))"
    W "    image registry       : $($e.registry)   [$($e.registryAuth)]"
    W "    postgres server      : $($e.pgServerName)  (rg $($e.pgResourceGroup), $($e.pgLocation))"

    $env:AZURE_CONFIG_DIR = $e.Tenant.ConfigDirPath
    $shared = Join-Path $HOME '.azure/cliextensions'
    if (Test-Path $shared) { $env:AZURE_EXTENSION_DIR = $shared }

    $fqdn = az containerapp show -n $e.appName -g $e.resourceGroup --subscription $e.Tenant.subscriptionId `
        --query 'properties.configuration.ingress.fqdn' -o tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and $fqdn) {
        W "    BASE URL             : https://$($fqdn.Trim())"
        W "    admin version        : https://$($fqdn.Trim())/scim/admin/version"
        W "    SCIM base            : https://$($fqdn.Trim())/scim/v2"
        W "    OAuth token endpoint : https://$($fqdn.Trim())/scim/oauth/token"
    }
    else {
        W "    BASE URL             : <cannot resolve - the tenant's control plane is unreachable>"
        if ($e.Role -eq 'retiring') {
            W "                           (expected: this tenant has EXPIRED. The app may still be"
            W "                            serving, but Azure can no longer be queried for its address.)"
        }
    }

    $secretNames = az containerapp secret list -n $e.appName -g $e.resourceGroup --subscription $e.Tenant.subscriptionId --query "[].name" -o tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and $secretNames) {
        W "    app secrets (live in Azure - recoverable at any time):"
        foreach ($n in ($secretNames -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
            $val = az containerapp secret show -n $e.appName -g $e.resourceGroup --subscription $e.Tenant.subscriptionId --secret-name $n --query value -o tsv 2>$null
            W "      $($n.PadRight(20)) : $(V $val)"
        }
        W "      (re-read any time:  az containerapp secret show -n $($e.appName) -g $($e.resourceGroup) --secret-name <name>)"
    }
    else {
        W "    app secrets          : <not readable - control plane unreachable>"
    }
}

# ------------------------------------------------------------------ irreplaceable
W ""
W "================================================================================"
W " 3. IRREPLACEABLE - connection strings for EXPIRED tenants"
W "================================================================================"
W ""
W "  These cannot be re-read from Azure by any means. If you lose them you lose"
W "  the ability to reach those databases, even though the servers are still"
W "  running and still accepting connections."
W ""
W "  Their practical value is a rollback / forensic path only: the data they"
W "  point at has already been carried into the current tenant and verified."
W ""

$dbUrlPath = 'C:\Users\v-prasrane\source\repos\SCIMServer-tenant09\test-results\t09\db-urls.json'
if (Test-Path $dbUrlPath) {
    $j = Get-Content $dbUrlPath -Raw | ConvertFrom-Json
    foreach ($n in $j.PSObject.Properties.Name) {
        $tag = if ($n -like 'T08*') { '  [IRREPLACEABLE - tenant expired]' } else { '  [recoverable from Azure]' }
        W "  $($n.PadRight(10)) : $(V $j.$n)$tag"
    }
    W ""
    W "  (source: $dbUrlPath)"
}
else { W "  <no capture file found at $dbUrlPath>" }

# ------------------------------------------------------------------ auth proofs
W ""
W "================================================================================"
W " 4. AUTH-PROOF IDENTITIES (Entra app registrations used by the test harness)"
W "================================================================================"
W ""
W "  These are the identities the WIF / OAuth / secret-token proofs authenticate"
W "  AS. They live in the DIRECTORY, not the database, so they do not survive a"
W "  tenant rollover and must be rebuilt each time. Reissue rather than restore:"
W "    pwsh -File scripts/setup-auth-proof-apps.ps1 -Tenant <tenant>"
W ""

foreach ($f in (Get-ChildItem (Join-Path $HOME '.scimserver-deploy') -Filter '*-authproofs.json' -ErrorAction SilentlyContinue)) {
    W "  from $($f.Name):"
    $arr = Get-Content $f.FullName -Raw | ConvertFrom-Json
    foreach ($a in $arr) {
        W ""
        W "    $($a.name)"
        W "      purpose        : $($a.purpose)"
        W "      app id         : $($a.appId)"
        W "      tenant id      : $($a.tenantId)"
        W "      CLIENT SECRET  : $(V $a.clientSecret)"
        W "      issuer         : $($a.issuer)"
        W "      jwks uri       : $($a.jwksUri)"
    }
}

# ------------------------------------------------------------------ well-known
W ""
W "================================================================================"
W " 5. WELL-KNOWN SHARED VALUES"
W "================================================================================"
W ""
W "  These are the same across every estate and appear throughout the scripts,"
W "  test suites and documentation. They are development-grade values, not"
W "  customer secrets."
W ""
W "    SCIM shared secret (admin bearer / E2E_TOKEN) : changeme-scim"
W "    OAuth client secret                           : changeme-oauth"
W "    OAuth client id                               : scimserver-client"
W "    Credential KEK (default, never overridden)    : changeme-credential-kek"
W ""
W "  Example call:"
W "    curl -H 'Authorization: Bearer changeme-scim' https://<base>/scim/admin/version"

# ------------------------------------------------------------------ recovery
W ""
W "================================================================================"
W " 6. REBUILDING FROM NOTHING"
W "================================================================================"
W ""
W "  If this workstation is gone, you need exactly three things. None of them"
W "  live only on that machine:"
W "     1. the repository            https://github.com/pranems/SCIMServer"
W "     2. the Azure CLI"
W "     3. the ability to sign in as an administrator"
W ""
W "  Then, in order:"
W "     a. Sign in           . ./scripts/az-tenant.ps1 ; Connect-ScimUser -Entry (Get-ScimTenantMap)['proviam09']"
W "                          Use the BROWSER flow. Device code is blocked by"
W "                          Conditional Access (AADSTS530035) even for a Global"
W "                          Administrator on a compliant device."
W "     b. Deploy SP         pwsh -File scripts/setup-deploy-sp.ps1 -Name proviam09"
W "     c. Directory access  pwsh -File scripts/grant-deploy-sp-directory-access.ps1 -Tenant proviam09"
W "     d. Proof identities  pwsh -File scripts/setup-auth-proof-apps.ps1 -Tenant proviam09"
W "     e. Confirm           . ./scripts/scim-estates.ps1 ; Show-ScimEstates"
W "                          pwsh -File scripts/live-test.ps1 -BaseUrl (Get-ScimEstateBaseUrl -Purpose dev) -ClientSecret changeme-oauth"
W ""
W "  Nothing above requires a secret that exists in only one place."
W ""
W "================================================================================"
W " END - delete this file once you have stored what you need."
W "================================================================================"

$dir = Split-Path $sheetPath -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$sb.ToString() | Set-Content -Path $sheetPath -Encoding utf8

# Report location and shape only. No content.
$lines = ($sb.ToString() -split "`n").Count
Write-Host ""
Write-Host "recovery sheet written" -ForegroundColor Green
Write-Host ("  path    : {0}" -f $sheetPath)
Write-Host ("  size    : {0} bytes, {1} lines" -f (Get-Item $sheetPath).Length, $lines)
Write-Host ("  secrets : {0}" -f $(if ($IncludeSecrets) { 'INCLUDED - treat this file as sensitive and delete it when done' } else { 'redacted' }))
Write-Host ""
Write-Host "Nothing was printed to this console on purpose. Open the file to read it." -ForegroundColor Yellow
