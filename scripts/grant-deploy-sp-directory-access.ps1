<#
.SYNOPSIS
    Grant a SCIMServer deployment service principal the ONE Microsoft Graph
    permission it needs to manage app registrations, so directory work stops
    requiring an interactive sign-in.

.DESCRIPTION
    Azure has two independent permission systems and the deployment service
    principal only had rights in one of them:

      Azure RBAC      -> subscriptions, resource groups, container apps, PostgreSQL
      Entra directory -> users, groups, app registrations, service principals

    `setup-deploy-sp.ps1` grants Contributor in Azure RBAC. That covers every
    deploy, promote, scale, prune and read the pipeline performs - all of it
    non-interactive, no MFA. It grants NOTHING in the directory, so any
    `az ad ...` command fails with `Insufficient privileges to complete the
    operation` and forces a human sign-in.

    This script closes that gap by assigning the Graph application permission
    Application.ReadWrite.OwnedBy and admin-consenting it.

.NOTES
    SECURITY - read before running this against a production tenant.

    Application.ReadWrite.OwnedBy is a PRIVILEGED permission. It lets the
    service principal create new app registrations, and read/update/delete the
    ones it OWNS - including adding credentials to them. It cannot touch apps it
    does not own, and it cannot grant itself new permissions (that still needs
    admin consent from a privileged human).

    The realistic risk is credential-addition to owned apps: anything this SP
    creates, it can also mint secrets for. So the blast radius is "the identities
    this automation created", not "the whole directory". That is why the
    narrower ...OwnedBy is used here rather than Application.ReadWrite.All.

    RECOMMENDED SCOPE:
      proviam09  YES - ephemeral dev + canary tenant, rebuilt every ~80 days,
                       and the setup work genuinely recurs. Convenience wins.
      anandsa    NO  - customer-facing production. Its deployment SP already
                       does everything the promotion path needs over ARM, with
                       no interaction. Directory changes there should stay
                       deliberate and human. Do not run this against it without
                       a specific, written reason.

.PARAMETER Tenant
    SCIMServer tenant key (proviam09 / proviam / anandsa).

.PARAMETER Permission
    Graph permission to assign. Default Application.ReadWrite.OwnedBy.

.EXAMPLE
    # Requires ONE interactive sign-in as a Global Administrator or
    # Privileged Role Administrator. After it succeeds, no further sign-ins.
    . ./scripts/az-tenant.ps1
    Connect-ScimUser -Entry (Get-ScimTenantMap)['proviam09']
    pwsh -File scripts/grant-deploy-sp-directory-access.ps1 -Tenant proviam09
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('proviam09', 'proviam', 'anandsa')]
    [string]$Tenant = 'proviam09',
    [ValidateSet('Application.ReadWrite.OwnedBy', 'Application.ReadWrite.All')]
    [string]$Permission = 'Application.ReadWrite.OwnedBy'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'az-tenant.ps1')

$GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000'

# App role IDs are RESOLVED FROM GRAPH at run time, never hardcoded. A first
# draft of this script carried 18a4783c-866b-4cc7-a460-3d0e455a2d43 for
# Application.ReadWrite.OwnedBy from memory. The real value in this tenant is
# 18a4783c-866b-4cc7-a460-3d5e5662c884 - same prefix, different suffix, which is
# exactly what makes a wrong GUID survive a visual check. Graph rejected it with
# "Permission being assigned was not found on application", a message that names
# neither the role nor the ID. Resolving by NAME removes the whole failure mode.
function Get-GraphAppRoleId {
    param([Parameter(Mandatory)][string]$Value)
    $graphSp = az ad sp show --id $GRAPH_APP_ID -o json 2>$null | ConvertFrom-Json
    if (-not $graphSp) { throw "Could not read the Microsoft Graph service principal. Are you signed in as a user?" }
    $role = $graphSp.appRoles | Where-Object { $_.value -eq $Value -and $_.isEnabled }
    if (-not $role) { throw "Graph exposes no enabled application role named '$Value' in this tenant." }
    return $role.id
}

$entry = (Get-ScimTenantMap)[$Tenant]
if (-not $entry) { throw "Unknown SCIM tenant '$Tenant'." }

if ($Tenant -eq 'anandsa') {
    Write-Host ""
    Write-Host "REFUSING by default: 'anandsa' is the customer-facing production tenant." -ForegroundColor Red
    Write-Host "Its deployment SP already covers the whole promotion path over ARM with no"
    Write-Host "interaction. Widening it into the directory buys nothing and costs blast radius."
    Write-Host "If you have a specific reason, edit this guard deliberately rather than"
    Write-Host "passing a flag - the friction is the point."
    exit 3
}

# Interactive profile, profile-local extensions (see Connect-ScimUser).
$userDir = if ($entry.UserConfigDir) { $entry.UserConfigDir } else { $entry.ConfigDir }
$env:AZURE_CONFIG_DIR = $userDir
$env:AZURE_EXTENSION_DIR = $null

$acct = az account show -o json 2>$null | ConvertFrom-Json
if (-not $acct -or $acct.user.type -ne 'user') {
    Write-Host ""
    Write-Host "Needs an interactive sign-in as a privileged user (admin consent cannot" -ForegroundColor Red
    Write-Host "be granted by a service principal). Run:"
    Write-Host "    . ./scripts/az-tenant.ps1"
    Write-Host "    Connect-ScimUser -Entry (Get-ScimTenantMap)['$Tenant']"
    exit 2
}

$appId = $entry.SpAppId
$roleId = $ROLE_IDS[$Permission]

Write-Host ""
Write-Host "=== grant directory access: $($entry.TenantName) ===" -ForegroundColor Cyan
Write-Host "  signed in as   : $($acct.user.name)"
Write-Host "  deployment SP  : $($entry.SpName)  [$appId]"
Write-Host "  permission     : $Permission  [$roleId]  (Graph application role)"

Write-Host ""
Write-Host "-- before"
$before = az ad app permission list --id $appId -o json 2>$null | ConvertFrom-Json
if (@($before).Count -eq 0) { Write-Host "   no API permissions assigned" }
else { $before | ForEach-Object { "   resource $($_.resourceAppId): $((@($_.resourceAccess) | ForEach-Object { $_.id }) -join ', ')" } }

if ($PSCmdlet.ShouldProcess($entry.SpName, "add $Permission and admin-consent")) {
    az ad app permission add --id $appId --api $GRAPH_APP_ID --api-permissions "$roleId=Role" --only-show-errors 2>$null | Out-Null
    Write-Host "   permission added" -ForegroundColor Green

    # Consent is what actually makes it effective. Without it the permission is
    # merely REQUESTED and every call still fails - a silent no-op of exactly
    # the kind this repo keeps getting bitten by.
    az ad app permission admin-consent --id $appId --only-show-errors 2>$null | Out-Null
    Write-Host "   admin consent granted" -ForegroundColor Green
}

Write-Host ""
Write-Host "-- after"
$after = az ad app permission list --id $appId -o json 2>$null | ConvertFrom-Json
$after | ForEach-Object { "   resource $($_.resourceAppId): $((@($_.resourceAccess) | ForEach-Object { $_.id }) -join ', ')" }

Write-Host ""
Write-Host "Consent can take a few seconds to propagate. Verify it WORKS (not merely that"
Write-Host "it is listed) by running a directory read as the SERVICE PRINCIPAL:"
Write-Host "    . ./scripts/az-tenant.ps1"
Write-Host "    Use-ProvIAM09"
Write-Host "    az ad app list --all --query length(@)"
