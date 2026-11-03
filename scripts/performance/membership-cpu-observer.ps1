function Get-OwnedCgroupRoot {
    param([string]$ContainerId, [string[]]$Membership)
    $matchesV2 = @($Membership | Where-Object { $_ -cmatch '^0::/' })
    if ($ContainerId -cnotmatch '^[a-f0-9]{64}$' -or $matchesV2.Count -ne 1) {
        throw 'Owned cgroup v2 path unavailable.'
    }
    $group = $matchesV2[0].Substring(3)
    if ($group -match '(^|/)\.\.(/|$)' -or
        $group -cnotmatch "(^|/)(docker-)?$ContainerId(\.scope)?$") {
        throw 'Owned cgroup v2 path unavailable.'
    }
    return "/sys/fs/cgroup$group"
}

function Start-CpuObserver {
    param([string]$Script, [string]$CgroupRoot, [string]$Prefix, [long]$DeadlineUtc)
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command node -ErrorAction Stop).Source
    $start.UseShellExecute = $false
    $start.RedirectStandardError = $true
    $start.Environment.Clear()
    if ($IsWindows) {
        $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot')
        if (!$systemRoot) { throw 'Windows observer requires SystemRoot for cryptographic startup.' }
        $start.Environment['SystemRoot'] = $systemRoot
    }
    foreach ($argument in @($Script, 'monitor', $CgroupRoot, "$Prefix-cpu.json",
        "$Prefix-cpu.ready", "$Prefix-cpu.stop", [string]$DeadlineUtc)) {
        $start.ArgumentList.Add($argument)
    }
    $process = [System.Diagnostics.Process]::Start($start)
    return @{
        Process = $process; Errors = $process.StandardError.ReadToEndAsync()
        Ready = "$Prefix-cpu.ready"; Stop = "$Prefix-cpu.stop"; ErrorLog = "$Prefix-cpu.stderr.txt"
    }
}

function Wait-CpuObserverReady {
    param($Observer)
    foreach ($attempt in 1..1000) {
        if ($Observer.Process.HasExited) { throw 'CPU observer exited before readiness; no attribution.' }
        if (Test-Path -LiteralPath $Observer.Ready) { return }
        Start-Sleep -Milliseconds 10
    }
    throw 'CPU observer readiness expired; no attribution.'
}

function Stop-CpuObserver {
    param($Observer)
    $null = New-Item -ItemType File -Path $Observer.Stop
    if (!$Observer.Process.WaitForExit(5000)) {
        Stop-Process -Id $Observer.Process.Id -ErrorAction Stop
        if (!$Observer.Process.WaitForExit(5000)) { throw 'Owned CPU observer could not be stopped.' }
        throw 'Owned CPU observer exceeded shutdown budget; no attribution.'
    }
    $Observer.Errors.GetAwaiter().GetResult() | Set-Content -LiteralPath $Observer.ErrorLog
    if ($Observer.Process.ExitCode -ne 0) { throw 'CPU observer failed; partial receipt retained, no attribution.' }
}
