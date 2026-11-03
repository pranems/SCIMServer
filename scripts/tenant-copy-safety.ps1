function Invoke-CopyAzJson {
    param([string[]]$Arguments)
    $text = & az @Arguments --only-show-errors -o json
    if ($LASTEXITCODE -ne 0) { throw "Azure $($Arguments[0..1] -join ' ') failed." }
    $json = $text -join "`n"
    if ([string]::IsNullOrWhiteSpace($json)) { throw 'Azure returned no verifiable JSON.' }
    $value = ConvertFrom-Json -InputObject $json -NoEnumerate -ErrorAction Stop
    if ($null -eq $value) { throw 'Azure returned null instead of verifiable state.' }
    return $value
}

function Invoke-CopyAzAction {
    param([string[]]$Arguments)
    & az @Arguments --only-show-errors -o none | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Azure $($Arguments[0..2] -join ' ') failed." }
}

function Assert-CopyLogTransportAvailable {
    $previous = $env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL
    try {
        $env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL = 'no'
        & az containerapp job logs show --help --only-show-errors | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw 'Copy log transport is unavailable; resolve the selected profile logging dependency before creating a transfer job.'
        }
    } finally {
        $env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL = $previous
    }
}

function Assert-CopyTargetWithoutApps {
    param([string]$Subscription)
    $apps = @(Invoke-CopyAzJson -Arguments @('containerapp', 'list', '--subscription', $Subscription))
    if ($apps.Count -ne 0) {
        throw 'Target application inventory is not empty; specify and suspend the target app before restoring.'
    }
}

function Assert-CopyTargetDatabase {
    param([string]$AppName, [string]$ResourceGroup, [string]$Subscription, [psobject]$Database)
    $ErrorActionPreference = 'Stop'
    $app = Invoke-CopyAzJson -Arguments @(
        'containerapp', 'show', '-n', $AppName, '-g', $ResourceGroup, '--subscription', $Subscription
    )
    $bindings = @($app.properties.template.containers | ForEach-Object {
        $_.env | Where-Object name -eq 'DATABASE_URL'
    })
    if ($bindings.Count -eq 0) { throw 'Target app database binding is unavailable; database identity cannot be matched.' }
    $secrets = @()
    if (@($bindings | Where-Object secretRef).Count) {
        $secrets = @(Invoke-CopyAzJson -Arguments @(
            'containerapp', 'secret', 'list', '-n', $AppName, '-g', $ResourceGroup,
            '--subscription', $Subscription, '--show-values'
        ))
    }
    foreach ($binding in $bindings) {
        $value = $binding.value
        if ($binding.secretRef) {
            $secret = @($secrets | Where-Object name -eq $binding.secretRef)
            if ($secret.Count -ne 1) { throw 'Target app database secret is unavailable; database identity cannot be matched.' }
            $value = $secret[0].value
        }
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw 'Target app database value is unavailable; database identity cannot be matched.'
        }
        $actual = Split-PgUri -Uri $value -Which 'Target app'
        if ($actual.DbHost.TrimEnd('.') -ine $Database.DbHost.TrimEnd('.') -or
            $actual.Port -ne $Database.Port -or
            $actual.Database -cne $Database.Database) {
            throw 'Target app database does not match the restore database; refusing writer suspension and restore.'
        }
    }
}

function Get-CopyTargetRevisionState {
    param([string]$AppName, [string]$ResourceGroup, [string]$Subscription)
    $revisions = @(Invoke-CopyAzJson -Arguments @(
        'containerapp', 'revision', 'list', '-n', $AppName, '-g', $ResourceGroup,
        '--subscription', $Subscription
    ))
    foreach ($revision in $revisions) {
        if ([string]::IsNullOrWhiteSpace($revision.name) -or $revision.properties.active -isnot [bool]) {
            throw 'Target revision identity or active state is unavailable.'
        }
    }
    if (@($revisions.name | Sort-Object -Unique).Count -ne $revisions.Count) {
        throw 'Target revision identities are ambiguous.'
    }
    [pscustomobject]@{
        Revisions = @($revisions | ForEach-Object name)
        ActiveRevisions = @($revisions | Where-Object { $_.properties.active } | ForEach-Object name)
    }
}

function Suspend-CopyTargetWriters {
    param([string]$AppName, [string]$ResourceGroup, [string]$Subscription, [psobject]$State)
    foreach ($revision in $State.ActiveRevisions) {
        Invoke-CopyAzAction -Arguments @(
            'containerapp', 'revision', 'deactivate', '-n', $AppName, '-g', $ResourceGroup,
            '--revision', $revision, '--subscription', $Subscription
        )
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $current = Get-CopyTargetRevisionState -AppName $AppName -ResourceGroup $ResourceGroup -Subscription $Subscription
        $replicasRemain = $false
        foreach ($revision in $current.Revisions) {
            $replicas = @(Invoke-CopyAzJson -Arguments @(
                'containerapp', 'replica', 'list', '-n', $AppName, '-g', $ResourceGroup,
                '--revision', $revision, '--subscription', $Subscription
            ))
            if ($replicas.Count -ne 0) { $replicasRemain = $true }
        }
        if ($current.ActiveRevisions.Count -eq 0 -and -not $replicasRemain) { return }
        Start-Sleep -Seconds 10
    }
    throw 'Target writers did not stop within five minutes; restore is refused.'
}

function Resume-CopyTargetWriters {
    param([string]$AppName, [string]$ResourceGroup, [string]$Subscription, [psobject]$State)
    foreach ($revision in $State.ActiveRevisions) {
        Invoke-CopyAzAction -Arguments @(
            'containerapp', 'revision', 'activate', '-n', $AppName, '-g', $ResourceGroup,
            '--revision', $revision, '--subscription', $Subscription
        )
    }

    $current = Get-CopyTargetRevisionState -AppName $AppName -ResourceGroup $ResourceGroup -Subscription $Subscription
    if ((($current.ActiveRevisions | Sort-Object) -join "`n") -cne (($State.ActiveRevisions | Sort-Object) -join "`n")) {
        throw 'Target revision reactivation is incomplete or an unexpected writer exists.'
    }
}

function Initialize-CopyPrivateDirectory {
        param([string]$Path)
        $ErrorActionPreference = 'Stop'
        if (Test-Path -LiteralPath $Path) { throw 'Copy scratch directory already exists.' }
        $null = New-Item -ItemType Directory -Path $Path
        if ($IsWindows) {
            $acl = [System.Security.AccessControl.DirectorySecurity]::new()
            $acl.SetAccessRuleProtection($true, $false)
            $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
            $acl.SetOwner($sid)
            $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
            ))
            Set-Acl -LiteralPath $Path -AclObject $acl
        } else {
            & chmod 700 $Path
            if ($LASTEXITCODE -ne 0) { throw 'Could not restrict copy scratch permissions.' }
        }
    }

function Remove-OwnedCopyJob {
        param([string]$JobName, [string]$ResourceGroup, [string]$Subscription, [string]$RunId)
        $present = @(Invoke-CopyAzJson -Arguments @(
            'containerapp', 'job', 'list', '-g', $ResourceGroup, '--subscription', $Subscription,
            '--query', "[?name=='$JobName']"
        ))
        if ($present.Count -eq 0) { return }
        if ($present.Count -ne 1) { throw 'Copy job identity is ambiguous.' }
        $job = Invoke-CopyAzJson -Arguments @(
            'containerapp', 'job', 'show', '-n', $JobName, '-g', $ResourceGroup,
            '--subscription', $Subscription
        )
        if ($job.tags.scimserverCopyRun -cne $RunId) { throw 'Refusing to delete a job owned by another copy run.' }
        Invoke-CopyAzAction -Arguments @(
            'containerapp', 'job', 'delete', '-n', $JobName, '-g', $ResourceGroup,
            '--subscription', $Subscription, '--yes'
        )
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $remaining = @(Invoke-CopyAzJson -Arguments @(
                'containerapp', 'job', 'list', '-g', $ResourceGroup, '--subscription', $Subscription,
                '--query', "[?name=='$JobName']"
            ))
            if ($remaining.Count -eq 0) { return }
            Start-Sleep -Seconds 2
        }
        throw 'Owned copy job still exists after bounded deletion verification.'
    }
