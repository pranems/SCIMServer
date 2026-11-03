[CmdletBinding()]
param(
    [ValidateSet('all', 'acl', 'absence', 'recovery', 'names', 'database', 'bootstrap')]
    [string]$Case = 'all'
)
$ErrorActionPreference = 'Stop'
if ($Case -eq 'all') {
    $failed = @()
    foreach ($item in @('acl', 'absence', 'recovery', 'names', 'database', 'bootstrap')) {
        & pwsh -NoProfile -File $PSCommandPath -Case $item
        if ($LASTEXITCODE -ne 0) { $failed += $item }
    }
    if ($failed.Count) { throw "Review regressions failed: $($failed -join ', ')" }
    Write-Host 'PASS: all six independent-review regression cases'
    return
}
. (Join-Path $PSScriptRoot 'postgres-provisioning.ps1')
$root = Split-Path $PSScriptRoot
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('scim-review-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixture
$global:rolloverReview = @{
    Case = $Case; Deployments = 0; RecoveryVerified = $false
    Fixture = $fixture; Secret = 'synthetic-only-password'; Calls = @()
}
function global:az {
    $global:LASTEXITCODE = 0
    $state = $global:rolloverReview
    $state.Calls += ($args -join ' ')
    if ($args[0] -eq 'account') {
        return (@{ id = $state.Subscription; tenantId = $state.Tenant } | ConvertTo-Json -Compress)
    }
    if ($args[0] -eq 'postgres') {
        if ($args[1] -eq 'flexible-server' -and $args[2] -eq 'list') {
            return (@(@{ fullyQualifiedDomainName = $state.TargetHost }) | ConvertTo-Json -Compress -AsArray)
        }
        if ($state.Case -eq 'absence') {
            switch ($state.AbsenceMode) {
                'ready' { return '{"state":"Ready"}' }
                'deleting' { return '{"state":"Dropping"}' }
                'empty' { return }
                'denied' { $global:LASTEXITCODE = 1; return '(AuthorizationFailed) Synthetic denial.' }
                'transport' { $global:LASTEXITCODE = 1; return 'Synthetic connection reset.' }
            }
        }
        $global:LASTEXITCODE = 1
        return '(ResourceNotFound) Synthetic server is absent.'
    }
    if ($args[0] -eq 'deployment') {
        $state.Deployments++
        if ($state.Case -eq 'recovery') {
            $records = @(Get-ChildItem -LiteralPath $state.Fixture -Filter credential.json -Recurse)
            if ($records.Count -eq 1) {
                $record = Get-Content -LiteralPath $records[0].FullName -Raw | ConvertFrom-Json
                $state.RecoveryVerified = $record.password -ceq $state.Secret -and
                    $record.serverName -ceq 'fixture-pg' -and
                    $record.subscriptionId -ceq $state.Subscription -and
                    $record.tenantId -ceq $state.Tenant
            }
        }
        $global:LASTEXITCODE = 1
        return
    }
    if (($args -join ' ') -like 'containerapp env show*') { return '{"id":"fixture-environment"}' }
    if (($args -join ' ') -like 'containerapp job logs show*') { return }
    if (($args -join ' ') -like 'containerapp show*') {
        if ($state.BindingMode -eq 'missing') { return '{"properties":{"template":{"containers":[]}}}' }
        $binding = if ($state.BindingMode -eq 'secret') {
            @{ name = 'DATABASE_URL'; secretRef = 'database-url' }
        } else { @{ name = 'DATABASE_URL'; value = $state.AppDatabase } }
        return (@{ properties = @{ template = @{ containers = @(@{
            env = @($binding)
        }) } } } | ConvertTo-Json -Depth 9 -Compress)
    }
    if (($args -join ' ') -like 'containerapp secret list*') {
        return (@(@{ name = 'database-url'; value = $state.AppDatabase }) | ConvertTo-Json -Compress -AsArray)
    }
    throw "Unexpected fixture Azure command: $($args[0..1] -join ' ')"
}
try {
    switch ($Case) {
        'acl' {
            if ($IsWindows) {
                function Set-Acl { Write-Error 'synthetic ACL failure' }
            } else {
                function chmod { $global:LASTEXITCODE = 1 }
            }
            $rejected = $false
            & {
                $ErrorActionPreference = 'Continue'
                try { Initialize-CopyPrivateDirectory -Path (Join-Path $fixture 'private') }
                catch { $rejected = $true }
                if (-not $rejected) { throw 'RED: non-terminating ACL failure from a Continue caller was accepted.' }
            }
        }
        { $_ -in @('absence', 'recovery') } {
            $global:rolloverReview.Subscription = 'fixture-subscription'
            $global:rolloverReview.Tenant = 'fixture-tenant'
            $parameters = @{
                ServerName = 'fixture-pg'; ResourceGroup = 'fixture-rg'; Location = 'eastus'
                SubscriptionId = 'fixture-subscription'; TenantId = 'fixture-tenant'
                Password = $global:rolloverReview.Secret
                TemplatePath = (Join-Path $root 'infra\postgres.bicep')
            }
            if ((Get-Command Invoke-ScimPostgresProvisioning).Parameters.ContainsKey('RecoveryRoot')) {
                $parameters.RecoveryRoot = $fixture
            }
            $modes = if ($Case -eq 'absence') { @('ready', 'deleting', 'empty', 'denied', 'transport') } else { @('allocation-failure') }
            foreach ($mode in $modes) {
                $global:rolloverReview.AbsenceMode = $mode
                $rejected = $false
                try { Invoke-ScimPostgresProvisioning @parameters | Out-Null }
                catch {
                    if ($Case -eq 'absence' -and $_.Exception.Message -notmatch 'Target PostgreSQL') { throw }
                    if ($Case -eq 'recovery' -and $_.Exception.Message -notmatch 'Azure deployment group failed') { throw }
                    $rejected = $true
                }
                if (-not $rejected) { throw 'Expected provisioning failure was accepted.' }
                if ($Case -eq 'absence' -and $global:rolloverReview.Deployments -ne 0) {
                    throw 'RED: existing or unverifiable PostgreSQL server received a deployment/password reset request.'
                }
                if ($Case -eq 'recovery' -and -not $global:rolloverReview.RecoveryVerified) {
                    throw 'RED: no verified server-scoped private credential record existed before allocation.'
                }
            }
        }
        'names' {
            $source = Get-Content (Join-Path $PSScriptRoot 'rotate-tenant-data.ps1') -Raw
            $start = $source.IndexOf('$runId =')
            $end = $source.IndexOf('function Say', $start)
            $program = [scriptblock]::Create($source.Substring($start, $end - $start) + "`n" + 'return $JobName')
            foreach ($prefix in @('scim-replicate-dev-next', 'scim-replicate-canary-prod-next', 'scim-replicate-canary-prod')) {
                $JobName = $prefix
                try { $name = & $program }
                catch { throw "RED: delegated job prefix '$prefix' cannot create a valid Azure job." }
                if ($name.Length -gt 32 -or $name -cnotmatch '^[a-z][a-z0-9-]+[a-z0-9]$') {
                    throw 'Invalid delegated Azure job name.'
                }
            }
        }
        'database' {
            . (Join-Path $PSScriptRoot 'scim-estates.ps1')
            $tenant = (Get-ScimEstateRegistry).tenants | Where-Object role -eq next
            $estates = @((Get-ScimEstateRegistry).estates | Where-Object tenantKey -eq $tenant.key)
            $dev = $estates | Where-Object purpose -eq dev
            $canary = $estates | Where-Object purpose -eq canary-prod
            $global:rolloverReview.Subscription = $tenant.subscriptionId
            $global:rolloverReview.Tenant = $tenant.tenantId
            $global:rolloverReview.TargetHost = "$($canary.pgServerName).postgres.database.azure.com"
            $global:rolloverReview.AppDatabase = "postgresql://fixture:synthetic@$($dev.pgServerName).postgres.database.azure.com:5432/scimdb"
            $source = Get-Content (Join-Path $PSScriptRoot 'rotate-tenant-data.ps1') -Raw
            $end = $source.IndexOf('# A password taken')
            $program = [scriptblock]::Create($source.Substring(0, $end).Replace(
                '$PSScriptRoot', ("'" + $PSScriptRoot.Replace("'", "''") + "'")
            ))
            $correct = "postgresql://fixture:synthetic@$($global:rolloverReview.TargetHost):5432/scimdb"
            foreach ($mode in @('mismatch', 'matching', 'secret', 'missing', 'wrong-database', 'wrong-port')) {
                $global:rolloverReview.BindingMode = $mode
                $global:rolloverReview.AppDatabase = switch ($mode) {
                    'mismatch' { "postgresql://fixture:synthetic@$($dev.pgServerName).postgres.database.azure.com:5432/scimdb" }
                    'wrong-database' { $correct.Replace('/scimdb', '/other') }
                    'wrong-port' { $correct.Replace(':5432/', ':5433/') }
                    default { $correct }
                }
                $rejected = $false
                try {
                    & $program -SourceConnectionString 'postgresql://fixture:synthetic@source.example/scimdb' `
                        -TargetConnectionString $correct -TargetResourceGroup $dev.resourceGroup `
                        -Subscription $tenant.subscriptionId -TargetAppName $dev.appName
                } catch {
                    if ($_.Exception.Message -notmatch 'database.*match|match.*database') { throw }
                    $rejected = $true
                }
                if ($rejected -eq ($mode -in @('matching', 'secret'))) {
                    throw "RED: app/database binding decision is incorrect for $mode."
                }
            }
            if (@($global:rolloverReview.Calls | Where-Object { $_ -match 'deactivate|deployment|job create' }).Count) {
                throw 'Identity rejection occurred after a target mutation.'
            }
        }
        'bootstrap' {
            $source = Get-Content (Join-Path $root 'setup.ps1') -Raw
            $start = $source.IndexOf("Write-Host 'Starting deployment...'")
            $end = $source.IndexOf('if ($LASTEXITCODE -ne 0)', $start)
            $program = [scriptblock]::Create($source.Substring($start, $end - $start))
            $script:legacyStarted = $false
            function Get-Command { return $null }
            function powershell { $script:legacyStarted = $true }
            $rejected = $false
            try { & $program }
            catch { $rejected = $true }
            if (-not $rejected -or $script:legacyStarted) {
                throw 'RED: bootstrap falls back to unsupported Windows PowerShell when pwsh is absent.'
            }
        }
    }
    Write-Host "PASS: $Case independent-review regression"
} finally {
    Remove-Item Function:\az
    Remove-Variable rolloverReview -Scope Global
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
