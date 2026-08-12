<#
.SYNOPSIS
    Create (or re-create) the Entra app registrations that the auth PROOFS
    authenticate as, in a given SCIMServer tenant.

.DESCRIPTION
    The WIF, OAuth2 client-credentials and secret-token end-to-end proofs each
    need an Entra identity to authenticate AS. Those identities are not part of
    the SCIMServer estate - they live in the directory, so they do NOT survive a
    tenant rollover the way database rows do, and `rotate-tenant-data.ps1`
    cannot carry them.

    Because the ephemeral tenant is replaced roughly every 80 days, recreating
    them is a RECURRING task. It was manual until 2026-08-12, which is why the
    tenant-08 originals were named `SCIMServer-Calmsand-*` - a name that was
    already misleading (they never lived in the calmsand tenant) and that this
    script deliberately does not reproduce.

    Note on the WIF app: the tenant-08 original had ZERO federated identity
    credentials. The proof works by acquiring an ordinary client-credentials
    token from the tenant and presenting it to SCIMServer as an assertion. So
    each app needs an app registration PLUS a client secret, not a federated
    credential.

.PARAMETER Tenant
    SCIMServer tenant key from az-tenant.ps1 (proviam09 / proviam / anandsa).

.PARAMETER SecretYears
    Lifetime of the generated client secrets. Defaults to 1 year, which safely
    outlives an ephemeral tenant.

.PARAMETER OutFile
    Where to write the resulting identities and secrets. Defaults to
    ~/.scimserver-deploy/<tenant>-authproofs.json - deliberately OUTSIDE the
    repository, because the file contains client secrets.

.PARAMETER WhatIf
    Report what would be created without creating anything.

.EXAMPLE
    # 1. Sign in interactively ONCE - the deployment service principal cannot do
    #    this. It is an Azure RBAC Contributor with no Microsoft Graph rights, so
    #    `az ad app create` returns "Insufficient privileges to complete the
    #    operation". Creating app registrations needs a user with the Application
    #    Developer (or Application Administrator) directory role.
    . ./scripts/az-tenant.ps1
    Connect-ScimUser -Name proviam09

    # 2. Create the three proof identities
    pwsh -File scripts/setup-auth-proof-apps.ps1 -Tenant proviam09
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('proviam09', 'proviam', 'anandsa')]
    [string]$Tenant = 'proviam09',
    [int]$SecretYears = 1,
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'az-tenant.ps1')

$entry = (Get-ScimTenantMap)[$Tenant]
if (-not $entry) { throw "Unknown SCIM tenant '$Tenant'." }

# Use the INTERACTIVE profile, not the service-principal one. This is the whole
# reason az-tenant.ps1 keeps them in separate directories.
$userDir = if ($entry.UserConfigDir) { $entry.UserConfigDir } else { $entry.ConfigDir }
$env:AZURE_CONFIG_DIR = $userDir
Set-ScimAzExtensionDir

Write-Host ""
Write-Host "=== auth-proof app registrations: $($entry.TenantName) ===" -ForegroundColor Cyan
Write-Host "  tenant id   : $($entry.Tenant)"
Write-Host "  profile dir : $userDir"

$acct = az account show -o json 2>$null | ConvertFrom-Json
if (-not $acct) {
    Write-Host ""
    Write-Host "NOT SIGNED IN to this tenant's interactive profile." -ForegroundColor Red
    Write-Host "Creating app registrations needs a USER with the Application Developer role;"
    Write-Host "the deployment service principal is Azure-RBAC only and will be denied by Graph."
    Write-Host ""
    Write-Host "Run this first, then re-run this script:" -ForegroundColor Yellow
    Write-Host "    . ./scripts/az-tenant.ps1"
    Write-Host "    Connect-ScimUser -Name $Tenant"
    exit 2
}
if ($acct.user.type -eq 'servicePrincipal') {
    Write-Host ""
    Write-Host "Signed in as a SERVICE PRINCIPAL ($($acct.user.name))." -ForegroundColor Red
    Write-Host "That identity cannot create app registrations. Use Connect-ScimUser -Name $Tenant."
    exit 2
}
if ($acct.tenantId -ne $entry.Tenant) {
    Write-Host ""
    Write-Host "Signed into the WRONG tenant: $($acct.tenantId), expected $($entry.Tenant)." -ForegroundColor Red
    exit 2
}
Write-Host "  signed in as: $($acct.user.name) [$($acct.user.type)]" -ForegroundColor Green

# Generation-free names. The tenant-08 originals carried 'Calmsand', which named
# the wrong estate; nothing here encodes a tenant generation either, so these
# names stay correct across every future rollover (see gap G15).
$apps = @(
    @{ Name = 'SCIMServer-Proof-WIF';         Purpose = 'workload-identity-federation end-to-end proof' }
    @{ Name = 'SCIMServer-Proof-OAuth2Creds'; Purpose = 'OAuth2 client-credentials proof' }
    @{ Name = 'SCIMServer-Proof-SecretToken'; Purpose = 'secret-token proof' }
)

$results = @()
foreach ($a in $apps) {
    Write-Host ""
    Write-Host "-- $($a.Name)" -ForegroundColor Cyan

    $existing = az ad app list --display-name $a.Name -o json 2>$null | ConvertFrom-Json
    if (@($existing).Count -gt 0) {
        $appId = $existing[0].appId
        Write-Host "   already exists, reusing appId $appId" -ForegroundColor Yellow
    }
    elseif ($PSCmdlet.ShouldProcess($a.Name, 'az ad app create')) {
        $created = az ad app create --display-name $a.Name --sign-in-audience AzureADMyOrg -o json | ConvertFrom-Json
        $appId = $created.appId
        Write-Host "   created appId $appId" -ForegroundColor Green
        # A service principal is required for the client-credentials grant; the
        # app registration alone cannot get a token.
        az ad sp create --id $appId -o none 2>$null
        Write-Host "   service principal created"
    }
    else {
        Write-Host "   WHATIF: would create"
        continue
    }

    if ($PSCmdlet.ShouldProcess($a.Name, 'reset credential')) {
        $cred = az ad app credential reset --id $appId --years $SecretYears --append -o json | ConvertFrom-Json
        Write-Host "   client secret issued, expires in $SecretYears year(s)"
        $results += [pscustomobject]@{
            name         = $a.Name
            purpose      = $a.Purpose
            appId        = $appId
            tenantId     = $entry.Tenant
            clientSecret = $cred.password
            issuer       = "https://login.microsoftonline.com/$($entry.Tenant)/v2.0"
            jwksUri      = "https://login.windows.net/$($entry.Tenant)/discovery/v2.0/keys"
        }
    }
}

if ($results.Count -gt 0) {
    if (-not $OutFile) {
        $dir = Join-Path $HOME '.scimserver-deploy'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $OutFile = Join-Path $dir "$Tenant-authproofs.json"
    }
    $results | ConvertTo-Json -Depth 5 | Set-Content -Path $OutFile -Encoding utf8
    Write-Host ""
    Write-Host "Wrote $($results.Count) identity/identities to $OutFile" -ForegroundColor Green
    Write-Host "That file contains CLIENT SECRETS. It is outside the repo on purpose - never commit it."
    Write-Host ""
    $results | Select-Object name, appId, purpose | Format-Table -AutoSize
}

Write-Host "Next: run the WIF proof against the estate, e.g."
Write-Host "  pwsh -File scripts/wif-e2e-proof.ps1"
