function Save-NativeProfile {
    param([string]$ContainerId, [string]$Directory, [string]$Role, [bool]$WorkComplete)
    if ($ContainerId -cnotmatch '^[a-f0-9]{64}$' -or $Role -notin @('baseline', 'candidate')) {
        throw 'Invalid owned native profile identity.'
    }
    $receipt = [ordered]@{
        diagnosticOnly = $true; admissionEligible = $false; workComplete = $WorkComplete
        captureStatus = 'FAIL'; failureStage = 'ownership'; exitCode = $null
        filesCollected = $false; containerId = $ContainerId
    }
    try {
        Assert-Owned $ContainerId
        $receipt.failureStage = 'initial-state'
        $inspection = (Invoke-Docker inspect $ContainerId | ConvertFrom-Json)[0]
        if ($inspection.Config.Labels.'scimserver.profile' -cne 'native-function') {
            throw 'Owned container is not an opted-in native profiler.'
        }
        $state = $inspection.State
        $stopped = !$state.Running
        if (!$stopped) {
            $receipt.failureStage = 'flush-signal'
            $null = Invoke-Docker kill --signal=USR2 $ContainerId
            $receipt.failureStage = 'shutdown'
            foreach ($attempt in 1..100) {
                $state = (Invoke-Docker inspect $ContainerId | ConvertFrom-Json)[0].State
                if (!$state.Running) { $stopped = $true; break }
                Start-Sleep -Milliseconds 100
            }
        }
        if (!$stopped) { throw 'Owned native profile shutdown exceeded ten seconds.' }
        $receipt.exitCode = $state.ExitCode
        $receipt.failureStage = 'copy-profile'
        $null = Invoke-Docker cp "${ContainerId}:/tmp/membership.cpuprofile" `
            (Join-Path $Directory "profile-$Role.cpuprofile")
        $receipt.failureStage = 'copy-metadata'
        $null = Invoke-Docker cp "${ContainerId}:/tmp/membership-profile-meta.json" `
            (Join-Path $Directory "profile-$Role-meta.json")
        $receipt.filesCollected = $true
        $receipt.failureStage = 'exit-check'
        if ($state.ExitCode -ne 0) { throw 'Owned native profile stopped with a failed exit; evidence retained.' }
        $receipt.captureStatus = 'COMPLETE'
        $receipt.failureStage = $null
    } finally {
        $receipt | ConvertTo-Json -Depth 5 |
            Set-Content -LiteralPath (Join-Path $Directory "profile-$Role-status.json")
    }
}
