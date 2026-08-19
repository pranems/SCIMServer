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
# Prefer the NON-INTERACTIVE automation profile. Since 2026-08-13 the deployment
# service principal holds the Graph role Application.ReadWrite.OwnedBy (granted
# by grant-deploy-sp-directory-access.ps1), so it can create and manage the apps
# it owns without a human. Fall back to the interactive profile only if that
# grant is missing.
function Select-ScimIdentity {
    param($Entry)

    # 1. automation profile (service principal) - no MFA, no browser
    $env:AZURE_CONFIG_DIR = $Entry.ConfigDir
    $env:AZURE_EXTENSION_DIR = $null
    $a = az account show -o json 2>$null | ConvertFrom-Json
    if ($a -and $a.tenantId -eq $Entry.Tenant) {
        # Cached identity is not the same as a WORKING one. Probe the actual
        # capability rather than assuming the role assignment is effective.
        $probe = az ad sp show --id $Entry.SpAppId --query id -o tsv 2>$null
        if ($LASTEXITCODE -eq 0 -and $probe) {
            return [pscustomobject]@{ Kind = 'sp'; Account = $a; SpObjectId = $probe }
        }
    }

    # 2. interactive profile (user)
    $env:AZURE_CONFIG_DIR = if ($Entry.UserConfigDir) { $Entry.UserConfigDir } else { $Entry.ConfigDir }
    $env:AZURE_EXTENSION_DIR = $null
    $u = az account show -o json 2>$null | ConvertFrom-Json
    if ($u -and $u.tenantId -eq $Entry.Tenant -and $u.user.type -eq 'user') {
        return [pscustomobject]@{ Kind = 'user'; Account = $u; SpObjectId = $null }
    }

    return $null
}

Write-Host ""
Write-Host "=== auth-proof app registrations: $($entry.TenantName) ===" -ForegroundColor Cyan
Write-Host "  tenant id   : $($entry.Tenant)"

$id = Select-ScimIdentity -Entry $entry
if (-not $id) {
    Write-Host ""
    Write-Host "No usable identity for this tenant." -ForegroundColor Red
    Write-Host "Preferred (no sign-in): grant the deployment SP directory access once -"
    Write-Host "    pwsh -File scripts/grant-deploy-sp-directory-access.ps1 -Tenant $Tenant"
    Write-Host "Otherwise sign in interactively:"
    Write-Host "    . ./scripts/az-tenant.ps1"
    Write-Host "    Connect-ScimUser -Entry (Get-ScimTenantMap)['$Tenant']"
    exit 2
}
Write-Host ("  identity    : {0}  [{1}]" -f $id.Account.user.name, $id.Kind) -ForegroundColor Green
Write-Host ("  profile dir : {0}" -f $env:AZURE_CONFIG_DIR)

# Idempotency lookup differs by identity. Application.ReadWrite.OwnedBy does NOT
# grant directory-wide read, so a service principal cannot `az ad app list`; it
# CAN read the objects it owns. Using the wrong one silently returns nothing and
# would create a duplicate every run, because Entra display names are not unique.
function Find-ExistingApp {
    param([string]$DisplayName, $Id)
    if ($Id.Kind -eq 'sp') {
        $owned = az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$($Id.SpObjectId)/ownedObjects" -o json 2>$null | ConvertFrom-Json
        return @($owned.value | Where-Object { $_.displayName -eq $DisplayName -and $_.'@odata.type' -eq '#microsoft.graph.application' })
    }
    return @(az ad app list --display-name $DisplayName -o json 2>$null | ConvertFrom-Json)
}

# Generation-free names. The tenant-08 originals carried 'Calmsand', which named
# the wrong estate; nothing here encodes a tenant generation either, so these
# names stay correct across every future rollover (see gap G15).
$apps = @(
    @{ Name = 'SCIMServer-Proof-WIF';         Purpose = 'workload-identity-federation end-to-end proof' }
    @{ Name = 'SCIMServer-Proof-OAuth2Creds'; Purpose = 'OAuth2 client-credentials proof' }
    @{ Name = 'SCIMServer-Proof-SecretToken'; Purpose = 'secret-token proof' }
)

# Entra is eventually consistent. An app created a moment ago is frequently not
# yet readable, so `az ad sp create` and `az ad app credential reset` both fail
# with "Resource '<id>' does not exist" when run immediately after `az ad app
# create`. The first version of this script fired those commands once, swallowed
# stderr, and printed "service principal created" / "client secret issued"
# UNCONDITIONALLY - so it reported success while leaving 2 of 3 apps with no
# service principal and all 3 with an EMPTY secret. Every identity it produced
# was unusable, and the script said it had worked.
#
# Retry, then VERIFY the outcome. Never announce an action; announce a checked
# result.
function Invoke-WithPropagationRetry {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [Parameter(Mandatory)][string]$What,
        [int]$Attempts = 8,
        [int]$DelaySeconds = 8
    )
    for ($i = 1; $i -le $Attempts; $i++) {
        $out = & $Action 2>&1
        if ($LASTEXITCODE -eq 0) { return $out }
        if ($i -lt $Attempts) { Start-Sleep -Seconds $DelaySeconds }
    }
    throw "$What failed after $Attempts attempts. Last output: $(($out | Out-String).Trim())"
}

# `az ad app credential reset` prints a WARNING to stderr about protecting the
# secret. Invoke-WithPropagationRetry merges stderr so failures are reportable,
# which means the captured text is "WARNING: ..." followed by the JSON body -
# and ConvertFrom-Json chokes on the W. Take everything from the first brace.
function ConvertFrom-JsonLoose {
    param([Parameter(Mandatory)]$InputObject)
    $text = ($InputObject | Out-String)
    $start = $text.IndexOf('{')
    if ($start -lt 0) { throw "No JSON object found in output: $($text.Trim())" }
    return $text.Substring($start) | ConvertFrom-Json
}

$results = @()
foreach ($a in $apps) {
    Write-Host ""
    Write-Host "-- $($a.Name)" -ForegroundColor Cyan

    $existing = Find-ExistingApp -DisplayName $a.Name -Id $id
    if (@($existing).Count -gt 0) {
        $appId = $existing[0].appId
        Write-Host "   already exists, reusing appId $appId" -ForegroundColor Yellow
    }
    elseif ($PSCmdlet.ShouldProcess($a.Name, 'az ad app create')) {
        $created = az ad app create --display-name $a.Name --sign-in-audience AzureADMyOrg -o json | ConvertFrom-Json
        $appId = $created.appId
        Write-Host "   created appId $appId" -ForegroundColor Green
    }
    else {
        Write-Host "   WHATIF: would create"
        continue
    }

    # A service principal is REQUIRED for the client-credentials grant; the app
    # registration alone cannot get a token.
    $spId = az ad sp show --id $appId --query id -o tsv 2>$null
    if (-not $spId) {
        Invoke-WithPropagationRetry -What "service principal for $($a.Name)" -Action {
            az ad sp create --id $appId -o none
        } | Out-Null
        $spId = Invoke-WithPropagationRetry -What "service principal read-back for $($a.Name)" -Action {
            az ad sp show --id $appId --query id -o tsv
        }
    }
    Write-Host "   service principal verified: $spId" -ForegroundColor Green

    if ($PSCmdlet.ShouldProcess($a.Name, 'reset credential')) {
        $raw = Invoke-WithPropagationRetry -What "client secret for $($a.Name)" -Action {
            az ad app credential reset --id $appId --years $SecretYears --append -o json
        }
        $cred = ConvertFrom-JsonLoose $raw
        if (-not $cred.password) {
            throw "client secret for $($a.Name) came back EMPTY. Refusing to write an unusable credential file."
        }
        Write-Host "   client secret issued and non-empty, expires in $SecretYears year(s)" -ForegroundColor Green
        $results += [pscustomobject]@{
            name         = $a.Name
            purpose      = $a.Purpose
            appId        = $appId
            spObjectId   = $spId
            tenantId     = $entry.Tenant
            clientSecret = $cred.password
            issuer       = "https://login.microsoftonline.com/$($entry.Tenant)/v2.0"
            jwksUri      = "https://login.windows.net/$($entry.Tenant)/discovery/v2.0/keys"
        }
    }
}

if ($results.Count -gt 0) {
    # OUTCOME CHECK. Existence of an app, a service principal and a non-empty
    # secret are all PRESENCE checks. The identity exists for exactly one job -
    # minting a real Entra token - so acquire one before claiming success.
    Write-Host ""
    Write-Host "-- verifying each identity can actually acquire a token" -ForegroundColor Cyan
    $failed = @()
    foreach ($rr in $results) {
        $body = @{
            client_id     = $rr.appId
            client_secret = $rr.clientSecret
            scope         = "$($rr.appId)/.default"
            grant_type    = 'client_credentials'
        }
        $got = $false
        for ($i = 1; $i -le 8; $i++) {
            try {
                $tok = Invoke-RestMethod -Method Post `
                    -Uri "https://login.microsoftonline.com/$($entry.Tenant)/oauth2/v2.0/token" `
                    -Body $body -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
                if ($tok.access_token) {
                    Write-Host ("   {0}: TOKEN OK (attempt {1})" -f $rr.name, $i) -ForegroundColor Green
                    $got = $true
                    break
                }
            }
            catch {
                if ($i -lt 8) { Start-Sleep -Seconds 8 }
            }
        }
        if (-not $got) {
            Write-Host ("   {0}: TOKEN FAILED - identity is not usable" -f $rr.name) -ForegroundColor Red
            $failed += $rr.name
        }
    }

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

    if ($failed.Count -gt 0) {
        Write-Host "INCOMPLETE: $($failed.Count) identity/identities could not acquire a token: $($failed -join ', ')" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Next: run the WIF proof against the estate, e.g."
Write-Host "  pwsh -File scripts/wif-e2e-proof.ps1"
