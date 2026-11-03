[CmdletBinding()]
param(
    [ValidateSet('all', 'acl', 'absence', 'recovery', 'names', 'database', 'bootstrap', 'ports', 'unix', 'subnet', 'cleanup')]
    [string]$Case = 'all'
)
$ErrorActionPreference = 'Stop'
if ($Case -eq 'all') {
    $failed = @()
    foreach ($item in @('acl', 'absence', 'recovery', 'names', 'database', 'bootstrap', 'ports', 'unix', 'subnet', 'cleanup')) {
        & pwsh -NoProfile -File $PSCommandPath -Case $item
        if ($LASTEXITCODE -ne 0) { $failed += $item }
    }
    if ($failed.Count) { throw "Review regressions failed: $($failed -join ', ')" }
    Write-Host 'PASS: all ten independent-review regression cases'
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
        if ($state.Case -eq 'cleanup' -and $state.WorkSuccess) {
            return '{"properties":{"outputs":{"serverName":{"value":"fixture-pg"},"serverFqdn":{"value":"fixture-pg.postgres.database.azure.com"},"databaseName":{"value":"scimdb"}}}}'
        }
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
    if (($args -join ' ') -like 'containerapp list*') { return '[]' }
    if (($args -join ' ') -like 'network vnet subnet show*') {
        if ($state.SubnetMode -eq 'create') { $global:LASTEXITCODE = 1; return }
        if ($state.SubnetMode -eq 'delegated') {
            return '{"id":"fixture-subnet","delegations":[{"serviceName":"Microsoft.App/environments"}]}'
        }
        return '{"id":"fixture-subnet","delegations":[]}'
    }
    if (($args -join ' ') -like 'network vnet subnet create*') {
        if (($args -join ' ') -notmatch '--delegations Microsoft.App/environments') { throw 'Required delegation was not requested.' }
        return '{"id":"fixture-subnet","delegations":[{"serviceName":"Microsoft.App/environments"}]}'
    }
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
        { $_ -in @('absence', 'recovery', 'cleanup') } {
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
            if ($Case -eq 'cleanup') {
                $script:cleanupPaths = @()
                $script:allCleanupPaths = @()
                function Remove-Item {
                    param([string]$LiteralPath, [switch]$Force)
                    $script:cleanupPaths += $LiteralPath
                    $script:allCleanupPaths += $LiteralPath
                    if ($LiteralPath -like '*parameters.json') { throw 'fixture parameter cleanup failure' }
                }
                foreach ($workSuccess in @($false, $true)) {
                    $global:rolloverReview.WorkSuccess = $workSuccess
                    $script:cleanupPaths = @()
                    $failure = $null
                    try { Invoke-ScimPostgresProvisioning @parameters | Out-Null }
                    catch { $failure = $_ }
                    $expected = if ($workSuccess) { 'fixture parameter cleanup failure' } else { 'Azure deployment group failed' }
                    if ($failure.Exception.Message -notmatch $expected -or $script:cleanupPaths.Count -ne 2) {
                        throw 'RED: provisioning cleanup masks the primary failure, skips directory cleanup or accepts cleanup-only failure.'
                    }
                }
                break
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
        { $_ -in @('database', 'ports') } {
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
            if ($Case -eq 'ports') {
                foreach ($target in @($correct.Replace(':5432/', ':05432/'), $correct.Replace('/scimdb', '/%73cimdb'))) {
                    $rejected = $false
                    try {
                        & $program -SourceConnectionString $correct -TargetConnectionString $target `
                            -TargetResourceGroup $dev.resourceGroup -Subscription $tenant.subscriptionId -ConfirmNoTargetApps
                    } catch {
                        if ($_.Exception.Message -notmatch 'same database') { throw }
                        $rejected = $true
                    }
                    if (-not $rejected) { throw 'RED: equivalent encoded database identity bypasses source/target rejection.' }
                }
                break
            }
            foreach ($mode in @('mismatch', 'matching', 'matching-padded-port', 'secret', 'missing', 'wrong-database', 'wrong-port', 'wrong-encoded-database')) {
                $global:rolloverReview.BindingMode = $mode
                $global:rolloverReview.AppDatabase = switch ($mode) {
                    'mismatch' { "postgresql://fixture:synthetic@$($dev.pgServerName).postgres.database.azure.com:5432/scimdb" }
                    'wrong-database' { $correct.Replace('/scimdb', '/other') }
                    'wrong-port' { $correct.Replace(':5432/', ':5433/') }
                    'matching-padded-port' { $correct.Replace(':5432/', ':05432/') }
                    'wrong-encoded-database' { $correct.Replace('/scimdb', '/%2573cimdb') }
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
                if ($rejected -eq ($mode -in @('matching', 'matching-padded-port', 'secret'))) {
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
        'unix' {
                $tokens = $null; $errors = $null
                $ast = [System.Management.Automation.Language.Parser]::ParseFile(
                    (Join-Path $PSScriptRoot 'setup-deploy-sp.ps1'), [ref]$tokens, [ref]$errors)
                $function = $ast.Find({ param($node)
                    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Protect-CredFile'
                }, $true)
                if ($function.Extent.Text -match 'SetUnixFileMode|IO\.UnixFileMode') {
                    throw 'RED: credential protection requires .NET 7 APIs unavailable on supported PowerShell 7.2.'
                }
                . ([scriptblock]::Create($function.Extent.Text.Replace(
                    '$IsWindows -or $env:OS -eq ''Windows_NT''', '$false')))
                $file = Join-Path $fixture 'credential.json'
                [IO.File]::WriteAllText($file, '')
                $script:chmodCalls = 0
                $script:chmodFailure = $false
                function chmod {
                    $script:chmodCalls++
                    if (($args -join ' ') -notlike '600 *') { throw 'Incorrect credential permissions requested.' }
                    $global:LASTEXITCODE = if ($script:chmodFailure) { 1 } else { 0 }
                }
                Protect-CredFile -Path $file
                $script:chmodFailure = $true
                $rejected = $false
                try { Protect-CredFile -Path $file } catch { $rejected = $true }
                if (-not $rejected -or $script:chmodCalls -ne 2) { throw 'Unix permission failure was accepted.' }
            }
            'subnet' {
                $tokens = $null; $errors = $null
                $ast = [System.Management.Automation.Language.Parser]::ParseFile(
                    (Join-Path $PSScriptRoot 'deploy-azure.ps1'), [ref]$tokens, [ref]$errors)
                $function = $ast.Find({ param($node)
                    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'GetOrCreate-VnetSubnetId'
                }, $true)
                . ([scriptblock]::Create($function.Extent.Text))
                $parameters = @{ ResourceGroupName = 'fixture'; VirtualNetworkName = 'fixture'; SubnetName = 'aca-infra' }
                if ((Get-Command GetOrCreate-VnetSubnetId).Parameters.ContainsKey('RequiredDelegation')) {
                    $parameters.RequiredDelegation = 'Microsoft.App/environments'
                }
                $caller = $ast.Find({ param($node)
                    $node -is [System.Management.Automation.Language.CommandAst] -and
                    $node.GetCommandName() -eq 'GetOrCreate-VnetSubnetId' -and
                    $node.Extent.Text.Contains('$expectedInfraSubnetName')
                }, $true)
                if (-not $caller -or $caller.Extent.Text -notmatch '-RequiredDelegation ''Microsoft.App/environments''') {
                    throw 'Infrastructure deployment caller does not request the required delegation.'
                }
                foreach ($mode in @('missing', 'delegated', 'create')) {
                    $global:rolloverReview.SubnetMode = $mode
                    $rejected = $false
                    try {
                        $id = GetOrCreate-VnetSubnetId @parameters
                        if ($id -ne 'fixture-subnet') { throw 'Subnet identity was not returned.' }
                    } catch { if ($_.Exception.Message -notmatch 'delegat') { throw }; $rejected = $true }
                    if ($rejected -ne ($mode -eq 'missing')) { throw "Incorrect $mode subnet delegation decision." }
                }
            }
    }
    Write-Host "PASS: $Case independent-review regression"
} finally {
    Microsoft.PowerShell.Management\Remove-Item Function:\Remove-Item -ErrorAction SilentlyContinue
    foreach ($path in @(@($script:allCleanupPaths) + @($script:cleanupPaths) | Select-Object -Unique)) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            Microsoft.PowerShell.Management\Remove-Item -LiteralPath $path -Recurse -Force
        }
        if ($path -like '*parameters.json' -and (Test-Path -LiteralPath (Split-Path $path))) {
            Microsoft.PowerShell.Management\Remove-Item -LiteralPath (Split-Path $path) -Force
        }
    }
    Remove-Item Function:\az
    Remove-Variable rolloverReview -Scope Global
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
