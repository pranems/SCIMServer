param(
    [string]$OutputDirectory,
    [switch]$TraceDiagnostic,
    [switch]$ProfileDiagnostic
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$protocolPath = Join-Path $PSScriptRoot 'membership-protocol.json'
$evaluator = Join-Path $PSScriptRoot 'assess-membership.cjs'
$clientScript = Join-Path $PSScriptRoot 'benchmark-membership.cjs'
$protocol = Get-Content -LiteralPath $protocolPath -Raw | ConvertFrom-Json
& node -e 'require(process.argv[1]).validateProtocol(require(process.argv[2]))' $evaluator $protocolPath
if ($LASTEXITCODE -ne 0) { throw 'Invalid preregistered protocol; no resources allocated.' }
if (!$IsLinux) { throw 'Qualification requires a Linux host, not a Windows-hosted Docker VM.' }
if ($TraceDiagnostic -and $ProfileDiagnostic) { throw 'Choose one diagnostic mode, never combined instrumentation.' }
if (!$TraceDiagnostic -and !$ProfileDiagnostic -and $env:SCIM_BENCH_TRACE) { throw 'Diagnostic trace cannot enter qualification.' }
if ($env:SCIM_BENCH_PROFILE -or $env:NODE_OPTIONS) { throw 'Inherited application profiling/options are not permitted.' }
$cpuTrace = Join-Path $PSScriptRoot 'membership-cpu-trace.cjs'
if ($TraceDiagnostic) { . (Join-Path $PSScriptRoot 'membership-cpu-observer.ps1') }
$nativeProfile = Join-Path $PSScriptRoot 'membership-v8-profile.cjs'
$profileBootstrap = Join-Path $PSScriptRoot 'membership-profile-bootstrap.cjs'
if ($ProfileDiagnostic) { . (Join-Path $PSScriptRoot 'membership-v8-profile.ps1') }
$run = [guid]::NewGuid().ToString('N')
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root "test-results\membership-qualification-$run" }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Refusing to overwrite an existing campaign.' }
$null = New-Item -ItemType Directory -Path $OutputDirectory
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$summaryPath = Join-Path $OutputDirectory 'campaign.json'
$summary = [ordered]@{
    Run = $run; StartedAtUtc = [DateTime]::UtcNow.ToString('o'); Status = 'RUNNING'
    OriginalWindowsAdmission = 'FAIL/unresolved; not replaced retrospectively'
    StatisticalFalseFailureRate = 'Not estimated by this bounded qualification'
    Blocks = @()
    Mode = $(if ($TraceDiagnostic) { 'CPU timeline diagnostic only' }
        elseif ($ProfileDiagnostic) { 'Native function diagnostic only' } else { 'Performance qualification' })
    AdmissionEligible = $false
}
$campaignClock = [System.Diagnostics.Stopwatch]::StartNew()
$workMinutes = if ($TraceDiagnostic -or $ProfileDiagnostic) { 15 } else { 60 }
$workDeadlineUtc = [DateTimeOffset]::UtcNow.AddMinutes($workMinutes).ToUnixTimeMilliseconds()
$summary['WorkDeadlineUtc'] = [DateTimeOffset]::FromUnixTimeMilliseconds($workDeadlineUtc).ToString('o')
$envNames = @('POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET',
    'CREDENTIAL_KEK', 'DATABASE_URL', 'SCIM_BENCH_BASE_URL', 'SCIM_BENCH_TOKEN', 'SCIM_BENCH_VERSION',
    'SCIM_BENCH_DEADLINE_UTC', 'SCIM_BENCH_TRACE')
$priorEnvironment = @{}
foreach ($key in $envNames) { $priorEnvironment[$key] = [Environment]::GetEnvironmentVariable($key) }

function Assert-WithinDeadline {
    $limit = if ($TraceDiagnostic -or $ProfileDiagnostic) { 15 } else { 60 }
    if ($campaignClock.Elapsed.TotalMinutes -ge $limit) {
        throw 'Campaign work deadline reached; cleanup and upload time is reserved, no admission.'
    }
}

function Invoke-Docker {
    $value = & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed: $($args[0])" }
    return $value
}

function Assert-Owned {
    param([string]$Id, [switch]$Network)
    $labels = if ($Network) {
        Invoke-Docker network inspect --format '{{json .Labels}}' $Id
    } else {
        Invoke-Docker inspect --format '{{json .Config.Labels}}' $Id
    }
    $actual = $labels | ConvertFrom-Json
    if ($actual.'scimserver.owner' -cne 'membership-qualification' -or
        $actual.'scimserver.run' -cne $run) { throw 'Refusing an unowned resource operation.' }
}

function Read-CpuCounters {
    param([string]$Id)
    $values = @{}
    foreach ($line in @(Invoke-Docker exec $Id cat /sys/fs/cgroup/cpu.stat)) {
        $key, $value = $line -split '\s+', 2
        $values[$key] = [long]$value
    }
    foreach ($key in @('usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec')) {
        if (!$values.ContainsKey($key)) { throw 'Required cgroup v2 CPU counters unavailable.' }
    }
    return $values
}

function Read-QueryCounters {
    param([string]$Pg, [string]$Database)
    if ($Database -notin @('baseline', 'candidate')) { throw 'Unknown private database.' }
    $sql = "SELECT json_build_object('calls',COALESCE(sum(calls),0),'executionMs',COALESCE(sum(total_exec_time),0)) FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname='$Database') AND query NOT LIKE '%pg_stat_statements%'"
    return ((@(Invoke-Docker exec $Pg psql -U scim -d $Database -tAc $sql) -join "`n") | ConvertFrom-Json)
}

function Invoke-Block {
    param($Block)
    $network = "scim-qualification-$($run.Substring(0, 12))-$($Block.name)"
    $containers = [System.Collections.Generic.List[string]]::new()
    $apps = @{}
    $profileTargets = @{}
    $workComplete = $false
    $workFailure = $null
    $rows = [System.Collections.Generic.List[object]]::new()
    $directory = Join-Path $OutputDirectory $Block.name
    $null = New-Item -ItemType Directory -Path $directory
    $baseline = if ($Block.sameImage) { $protocol.candidate } else { $protocol.baseline }
    $roles = @{ baseline = $baseline; candidate = $protocol.candidate }
    try {
        $null = Invoke-Docker network create --label scimserver.owner=membership-qualification `
            --label "scimserver.run=$run" $network
        $env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
        $env:SCIM_SHARED_SECRET = [guid]::NewGuid().ToString('N')
        $env:JWT_SECRET = [guid]::NewGuid().ToString('N')
        $env:OAUTH_CLIENT_SECRET = [guid]::NewGuid().ToString('N')
        $env:CREDENTIAL_KEK = [guid]::NewGuid().ToString('N')
        $pg = (Invoke-Docker run -d --network $network --network-alias database `
            --name "$network-pg" --label scimserver.owner=membership-qualification `
            --label "scimserver.run=$run" --mount 'type=tmpfs,destination=/var/lib/postgresql/data' `
            --env POSTGRES_USER=scim --env POSTGRES_PASSWORD --env POSTGRES_DB=postgres `
            $protocol.postgres -c shared_preload_libraries=pg_stat_statements).Trim()
        if ($pg -notmatch '^[a-f0-9]{64}$') { throw 'Invalid owned PostgreSQL id.' }
        $containers.Add($pg)
        $ready = $false
        foreach ($attempt in 1..60) {
            Assert-WithinDeadline
            & docker exec $pg pg_isready --host=127.0.0.1 -U scim -d postgres *> $null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (!$ready) { throw 'Private PostgreSQL readiness failed.' }
        foreach ($role in @('baseline', 'candidate')) {
            Assert-WithinDeadline
            $null = Invoke-Docker exec $pg psql -U scim -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $role"
            $null = Invoke-Docker exec $pg psql -U scim -d $role -v ON_ERROR_STOP=1 `
                -c 'CREATE EXTENSION citext; CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm; CREATE EXTENSION "uuid-ossp"; CREATE EXTENSION pg_stat_statements;'
            $env:DATABASE_URL = '{0}://{1}:{2}@{3}:5432/{4}' -f `
                'postgresql', 'scim', $env:POSTGRES_PASSWORD, 'database', $role
            $profileArguments = @()
            $appCommand = 'node node_modules/prisma/build/index.js migrate deploy >/dev/null && exec node dist/main.js'
            if ($ProfileDiagnostic) {
                $profileArguments = @('--label', 'scimserver.profile=native-function',
                    '--mount', "type=bind,source=$profileBootstrap,target=/tmp/profile-bootstrap.cjs,readonly",
                    '--env', 'SCIM_BENCH_PROFILE=1', '--env', 'SCIM_BENCH_PROFILE_DIRECTORY=/tmp')
                $appCommand = 'node node_modules/prisma/build/index.js migrate deploy >/dev/null && exec node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=membership.cpuprofile --require /tmp/profile-bootstrap.cjs dist/main.js'
            }
            $id = (Invoke-Docker run -d --network $network --publish 127.0.0.1::8080 `
                --name "$network-$role" --label scimserver.owner=membership-qualification `
                --label "scimserver.run=$run" --cpus 0.5 --memory 1g `
                --env DATABASE_URL --env JWT_SECRET --env OAUTH_CLIENT_SECRET --env SCIM_SHARED_SECRET `
                --env CREDENTIAL_KEK --env NODE_ENV=production --env PERSISTENCE_BACKEND=prisma `
                --env PORT=8080 @profileArguments --entrypoint sh $roles[$role].image `
                -c $appCommand).Trim()
            if ($id -notmatch '^[a-f0-9]{64}$') { throw 'Invalid owned app id.' }
            $containers.Add($id)
            if ($ProfileDiagnostic) { $profileTargets[$role] = $id }
            $inspect = (Invoke-Docker inspect $id | ConvertFrom-Json)[0]
            if ($inspect.HostConfig.NanoCpus -ne 500000000 -or $inspect.HostConfig.Memory -ne 1073741824) {
                throw 'Actual app allocation differs from the original admission envelope.'
            }
            $cpuMax = (Invoke-Docker exec $id cat /sys/fs/cgroup/cpu.max).Trim()
            if ($cpuMax -cne '50000 100000') { throw 'Actual CPU period/quota differs from the original default.' }
            $port = Invoke-Docker port $id 8080/tcp
            if ($port -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'App must be loopback-only.' }
            $url = "http://127.0.0.1:$($Matches[1])"
            $healthy = $false
            foreach ($attempt in 1..90) {
                Assert-WithinDeadline
                & curl --silent --output /dev/null --write-out '%{http_code}' "$url/scim/health" `
                    --max-time 2 > (Join-Path $directory "health-$role.txt")
                if ($LASTEXITCODE -eq 0 -and (Get-Content (Join-Path $directory "health-$role.txt") -Raw) -eq '200') {
                    $healthy = $true; break
                }
                Start-Sleep -Seconds 1
            }
            if (!$healthy) { throw 'Private application readiness failed.' }
            $apps[$role] = @{ Id = $id; Url = $url; CpuMax = $cpuMax; ImageId = $inspect.Image }
        }
        $schedule = if ($Block.order -eq 'BAAB') {
            @('candidate', 'baseline', 'baseline', 'candidate')
        } else { @('baseline', 'candidate', 'candidate', 'baseline') }
        $round = 0
        foreach ($role in $schedule) {
            Assert-WithinDeadline
            $round++
            $app = $apps[$role]
            Assert-Owned $app.Id
            $resource = [ordered]@{
                block = $Block.name; round = $round; role = $role; status = 'FAIL'; complete = $false
                failureStage = 'cpu-before'; image = $roles[$role].image; imageId = $app.ImageId
                cpuLimit = 0.5; cpuMax = $app.CpuMax; memoryLimit = 1073741824
                cpuBefore = $null; cpuAfter = $null
                databaseBefore = $null; databaseAfter = $null
                databaseCalls = $null; databaseExecutionMs = $null
                peakCgroupBytes = $null; nodeRssBytes = $null; oomKilled = $null
            }
            $observer = $null
            $roundFailure = $null
            try {
                if ($TraceDiagnostic) {
                    $resource['diagnosticOnly'] = $true
                    $appPid = [int](Invoke-Docker inspect --format '{{.State.Pid}}' $app.Id)
                    if ($appPid -le 0) { throw 'Owned app PID unavailable for CPU observation.' }
                    $membership = @(Get-Content -LiteralPath "/proc/$appPid/cgroup")
                    $cgroup = Get-OwnedCgroupRoot -ContainerId $app.Id -Membership $membership
                    $prefix = Join-Path $directory "round-$round-$role"
                    $observer = Start-CpuObserver -Script $cpuTrace -CgroupRoot $cgroup `
                        -Prefix $prefix -DeadlineUtc $workDeadlineUtc
                    Wait-CpuObserverReady $observer
                    $env:SCIM_BENCH_TRACE = '1'
                }
                if ($ProfileDiagnostic) {
                    $resource['diagnosticOnly'] = $true
                    $env:SCIM_BENCH_TRACE = '1'
                }
                $beforeCpu = Read-CpuCounters $app.Id
                $resource.cpuBefore = $beforeCpu
                $resource.failureStage = 'database-before'
                $beforeSql = Read-QueryCounters $pg $role
                $resource.databaseBefore = $beforeSql
                $resource.failureStage = 'client'
                $env:SCIM_BENCH_BASE_URL = $app.Url
                $env:SCIM_BENCH_TOKEN = $env:SCIM_SHARED_SECRET
                $env:SCIM_BENCH_VERSION = $roles[$role].version
                $env:SCIM_BENCH_DEADLINE_UTC = [string]$workDeadlineUtc
                $receiptPath = Join-Path $directory "round-$round-$role.json"
                $traceEnvironment = if ($TraceDiagnostic -or $ProfileDiagnostic) { @('--env', 'SCIM_BENCH_TRACE') } else { @() }
                $client = (Invoke-Docker create --network host --no-healthcheck `
                    --label scimserver.owner=membership-qualification --label "scimserver.run=$run" `
                    --mount "type=bind,source=$clientScript,target=/tmp/benchmark.cjs,readonly" `
                    --env SCIM_BENCH_BASE_URL --env SCIM_BENCH_TOKEN --env SCIM_BENCH_VERSION --env SCIM_BENCH_DEADLINE_UTC `
                    @traceEnvironment `
                    --env SCIM_BENCH_OUTPUT=/tmp/receipt.json --entrypoint node `
                    $protocol.candidate.image /tmp/benchmark.cjs).Trim()
                if ($client -notmatch '^[a-f0-9]{64}$') { throw 'Invalid owned client id.' }
                $containers.Add($client)
                & docker start --attach $client
                $transportExit = $LASTEXITCODE
                $clientFailure = $null
                try {
                    $clientExit = [int](Invoke-Docker inspect --format '{{.State.ExitCode}}' $client)
                    @{ transportExit = $transportExit; clientExit = $clientExit } |
                        ConvertTo-Json | Set-Content (Join-Path $directory "round-$round-$role-status.json")
                } catch {
                    $clientFailure = $_
                }
                try {
                    $null = Invoke-Docker cp "${client}:/tmp/receipt.json" $receiptPath
                } catch {
                    if ($null -eq $clientFailure) { throw }
                    Write-Warning 'Client receipt copy also failed; primary status error retained.'
                }
                if ($null -ne $clientFailure) { throw $clientFailure }
                $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
                if (!$TraceDiagnostic -and !$ProfileDiagnostic -and $receipt.PSObject.Properties.Name -contains 'diagnosticOnly') {
                    throw 'Diagnostic client receipt cannot enter qualification.'
                }
                if (($TraceDiagnostic -or $ProfileDiagnostic) -and $receipt.diagnosticOnly -ne $true) {
                    throw 'Diagnostic client omitted explicit non-admission marker.'
                }
                if ($transportExit -ne 0 -or $clientExit -ne 0 -or $receipt.status -cne 'PASS' -or $receipt.complete -ne $true) {
                    throw 'Failed/partial client receipt retained; no admission or later round.'
                }
                $resource.failureStage = 'work-deadline'
                Assert-WithinDeadline
                Start-Sleep -Seconds 2
                $resource.failureStage = 'cpu-after'
                $afterCpu = Read-CpuCounters $app.Id
                $resource.cpuAfter = $afterCpu
                $resource.failureStage = 'database-after'
                $afterSql = Read-QueryCounters $pg $role
                $resource.databaseAfter = $afterSql
                $resource.databaseCalls = $afterSql.calls - $beforeSql.calls
                $resource.databaseExecutionMs = $afterSql.executionMs - $beforeSql.executionMs
                $resource.failureStage = 'peak-memory'
                $peak = [long](Invoke-Docker exec $app.Id cat /sys/fs/cgroup/memory.peak)
                $resource.peakCgroupBytes = $peak
                $resource.failureStage = 'oom-state'
                $oom = Invoke-Docker inspect --format '{{.State.OOMKilled}}' $app.Id
                if ($oom -notin @('true', 'false')) { throw 'Container OOM state unavailable.' }
                $resource.oomKilled = $oom -eq 'true'
                $resource.failureStage = 'node-rss'
                $rss = @(Invoke-Docker exec $app.Id cat /proc/1/status | Where-Object { $_ -match '^VmRSS:\s+\d+\s+kB$' })
                if ($rss.Count -ne 1 -or $rss[0] -notmatch '^VmRSS:\s+(\d+)\s+kB$') { throw 'Node RSS unavailable.' }
                $rssBytes = [long]$Matches[1] * 1024
                $resource.nodeRssBytes = $rssBytes
                $resource.complete = $true
                $resource.failureStage = 'acceptance-limits'
                if ($resource.oomKilled -or $peak -ge 1073741824 -or $rssBytes -ge 402653184) {
                    throw 'Original memory/Node RSS acceptance ceiling exceeded.'
                }
                $resource.status = 'PASS'
                $resource.failureStage = $null
            } catch {
                $roundFailure = $_
                throw
            } finally {
                $hadRoundFailure = $null -ne $roundFailure
                $observerFailure = $null
                try {
                    if ($observer) { Stop-CpuObserver $observer }
                } catch {
                    $observerFailure = $_
                    $resource['observerStopFailed'] = $true
                    $resource.status = 'FAIL'
                    if (!$hadRoundFailure) {
                        $roundFailure = $_
                        $resource.failureStage = 'cpu-observer-stop'
                    }
                    Write-Warning 'CPU observer shutdown failed; first round error retained.'
                }
                try {
                    $resource | ConvertTo-Json -Depth 10 |
                        Set-Content (Join-Path $directory "round-$round-$role-resources.json")
                } catch {
                    if ($null -eq $roundFailure) { throw }
                    Write-Warning 'Resource receipt write failed; first round error retained.'
                }
                if (!$hadRoundFailure -and $null -ne $observerFailure) { throw $observerFailure }
            }
            $row = [pscustomobject]@{
                role = $role; version = $receipt.version; image = $roles[$role].image
                status = $receipt.status; complete = $receipt.complete
                imageId = $app.ImageId; cpuLimit = 0.5; cpuMax = $app.CpuMax; memoryLimit = 1073741824
                warmupIterations = $receipt.warmupIterations; requestCount = $receipt.requestCount
                samples = $receipt.samples; clientNode = $receipt.nodeVersion
                cpuBefore = $beforeCpu; cpuAfter = $afterCpu
                databaseCalls = $afterSql.calls - $beforeSql.calls
                databaseExecutionMs = $afterSql.executionMs - $beforeSql.executionMs
                peakCgroupBytes = $peak; nodeRssBytes = $rssBytes; oomKilled = $false
            }
            if ($TraceDiagnostic -or $ProfileDiagnostic) { $row | Add-Member -NotePropertyName diagnosticOnly -NotePropertyValue $true }
            if ($ProfileDiagnostic) { $row | Add-Member -NotePropertyName appContainerId -NotePropertyValue $app.Id }
            $rows.Add($row)
            $rows.ToArray() | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $directory 'rounds.json')
            Write-Host "Completed $($Block.name) round $round ${role}: 4407 checked requests."
        }
        Assert-WithinDeadline
        . (Join-Path $root 'scripts\live-test-sections\minimal-group-members.ps1')
        $script:privacyPassed = 0
        $privacy = [ordered]@{
            status = 'FAIL'; complete = $false; passed = $false; failureStage = 'functional'
            contractAssertions = 0; checkedRows = 0; validatedRows = 0; rawLogsExported = $false
            correlation = [ordered]@{
                errorRows = $null; requestIdPresent = $null; categoryPresent = $null; sameRecordPresent = $null
            }
        }
        $privacyFailure = $null
        try {
            function Test-Result {
                param([bool]$Success, [string]$Message)
                Assert-WithinDeadline
                if (!$Success) { throw "Private runtime contract failed: $Message" }
                $script:privacyPassed++
            }
            $null = Invoke-MinimalGroupMembersContract -BaseUrl $apps.candidate.Url `
                -Headers @{ Authorization = "Bearer $env:SCIM_SHARED_SECRET" }
            if ($script:privacyPassed -ne 66) { throw 'Incomplete 66-outcome runtime contract.' }
            $privacy.failureStage = 'log-flush'
            $null = Invoke-RestMethod -Uri "$($apps.candidate.Url)/scim/admin/logs/flush" `
                -Method Post -Headers @{ Authorization = "Bearer $env:SCIM_SHARED_SECRET" } -TimeoutSec 30 -ErrorAction Stop
            $privacy.failureStage = 'log-snapshot'
            $sql = 'SELECT COALESCE(json_agg(r),''[]'') FROM (SELECT "requestId","endpointId",status,"durationMs","requestHeaders","responseHeaders","requestBody","responseBody","authDecision" FROM "RequestLog" WHERE url LIKE ''%/Groups%'' AND (status >= 400 OR method = ''PATCH'') ORDER BY "createdAt" DESC LIMIT 200) r'
            $privateLog = @(Invoke-Docker exec $pg psql -U scim -d candidate -tAc $sql) -join "`n"
            $consoleLog = @(Invoke-Docker logs --tail 300 $apps.candidate.Id 2>&1) -join "`n"
            $privacy.failureStage = 'secret-scan'
            foreach ($key in @('POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK')) {
                $secret = [Environment]::GetEnvironmentVariable($key)
                if ($privateLog.Contains($secret) -or $consoleLog.Contains($secret)) { throw 'Generated credential leaked into private logs.' }
            }
            $privacy.failureStage = 'row-count'
            $logRows = @($privateLog | ConvertFrom-Json)
            $privacy.checkedRows = $logRows.Count
            if ($logRows.Count -ne 200) { throw 'Incomplete private runtime log sample.' }
            $privacy.failureStage = 'correlation'
            $errors = @($logRows | Where-Object status -ge 400)
            $privacy.correlation.errorRows = $errors.Count
            $privacy.correlation.requestIdPresent = $errors.Count -gt 0 -and
                $consoleLog.Contains($errors[0].requestId.Substring(0, 8))
            $privacy.correlation.categoryPresent = $consoleLog -match 'scim\.group'
            $privacy.correlation.sameRecordPresent = $false
            if ($errors.Count -gt 0) {
                $requestPrefix = [regex]::Escape($errors[0].requestId.Substring(0, 8))
                foreach ($line in ($consoleLog -split '\r?\n')) {
                    if ($line.StartsWith('{"timestamp":')) {
                        $record = $line | ConvertFrom-Json -ErrorAction Stop
                        if ($record.category -ceq 'scim.group' -and $record.requestId -ceq $errors[0].requestId) {
                            $privacy.correlation.sameRecordPresent = $true
                            break
                        }
                    } elseif (($line -replace '\x1b\[[0-9;]*m', '') -match
                        "^\d{2}:\d{2}:\d{2}\.\d{3}\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+scim\.group\s+\[$requestPrefix\]") {
                        $privacy.correlation.sameRecordPresent = $true
                        break
                    }
                }
            }
            if (!$privacy.correlation.sameRecordPresent) {
                throw 'Negative-path categorized console correlation missing.'
            }
            $privacy.failureStage = 'row-contract'
            foreach ($row in $logRows) {
                $requestId = [guid]::Empty
                $endpointId = [guid]::Empty
                $headers = $row.requestHeaders | ConvertFrom-Json
                if (![guid]::TryParse($row.requestId, [ref]$requestId) -or
                    ![guid]::TryParse($row.endpointId, [ref]$endpointId) -or
                    $null -eq $row.durationMs -or $row.durationMs -lt 0 -or
                    $row.status -notin @(200, 201, 400) -or $headers.authorization -cne '[REDACTED]') {
                    throw 'Runtime log status/correlation/duration/redaction failure.'
                }
                $privacy.validatedRows++
            }
            $privacy.status = 'PASS'
            $privacy.complete = $true
            $privacy.passed = $true
            $privacy.failureStage = $null
        } catch {
            $privacyFailure = $_
            throw
        } finally {
            $privacy.contractAssertions = $script:privacyPassed
            $campaignFailure = $null
            try {
                $privacy | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $directory 'privacy.json')
            } catch {
                if ($null -eq $privacyFailure) { throw }
                Write-Warning 'Privacy receipt write failed; primary privacy error retained.'
            }
        }
        Assert-WithinDeadline
        $workComplete = $true
    } catch {
        $workFailure = $_
        throw
    } finally {
        $finalization = [ordered]@{
            primaryWorkFailed = ($null -ne $workFailure); captureFailed = $false
            failedCaptureRoles = @(); cleanupComplete = $false; failureStage = 'capture'
        }
        $finalizationFailure = $null
        try {
            if ($ProfileDiagnostic) {
                foreach ($role in @('baseline', 'candidate')) {
                    if (!$profileTargets.ContainsKey($role)) { continue }
                    try {
                        Save-NativeProfile -ContainerId $profileTargets[$role] -Directory $directory `
                            -Role $role -WorkComplete $workComplete
                    } catch {
                        $finalization.captureFailed = $true
                        $finalization.failedCaptureRoles += $role
                        Write-Warning "Native $role profile capture failed: $($_.Exception.Message)"
                    }
                }
            }
            $finalization.failureStage = 'cleanup'
            for ($index = $containers.Count - 1; $index -ge 0; $index--) {
                Assert-Owned $containers[$index]
                $null = Invoke-Docker rm --force $containers[$index]
            }
            $networks = @(Invoke-Docker network ls --filter "name=^$network$" --format '{{.Name}}')
            if ($networks -contains $network) {
                Assert-Owned $network -Network
                $null = Invoke-Docker network rm $network
            }
            $remaining = @(Invoke-Docker ps -aq --filter "label=scimserver.run=$run")
            $remainingNetworks = @(Invoke-Docker network ls -q --filter "label=scimserver.run=$run")
            if ($remaining.Count -or $remainingNetworks.Count) { throw 'Exact owned cleanup readback failed.' }
            @{ containersAbsent = $true; networksAbsent = $true; run = $run } |
                ConvertTo-Json | Set-Content (Join-Path $directory 'cleanup.json')
            $finalization.cleanupComplete = $true
            $finalization.failureStage = $null
            if ($finalization.captureFailed) {
                $finalization.failureStage = 'capture'
                if ($null -eq $workFailure) { throw 'Native profile capture failed; partial receipts retained after exact cleanup.' }
            }
        } catch {
            $finalizationFailure = $_
            if ($null -eq $workFailure) { throw }
            Write-Warning 'Secondary diagnostic finalization failure; primary work error retained.'
        } finally {
            try {
                $finalization | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $directory 'finalization.json')
            } catch {
                if ($null -eq $workFailure -and $null -eq $finalizationFailure) { throw }
                Write-Warning 'Finalization receipt write failed; primary error retained.'
            }
        }
    }
    return $directory
}

try {
    $summary | ConvertTo-Json -Depth 10 | Set-Content $summaryPath
    Copy-Item -LiteralPath $protocolPath -Destination (Join-Path $OutputDirectory 'protocol.json')
    $sourceHashes = @{}
    foreach ($file in @($protocolPath, $evaluator, $clientScript, $PSCommandPath,
        (Join-Path $root 'scripts\live-test-sections\minimal-group-members.ps1'))) {
        $sourceHashes[[IO.Path]::GetFileName($file)] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    }
    if ($TraceDiagnostic) {
        foreach ($file in @($cpuTrace, (Join-Path $PSScriptRoot 'membership-cpu-observer.ps1'))) {
            $sourceHashes[[IO.Path]::GetFileName($file)] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        }
    }
    if ($ProfileDiagnostic) {
        foreach ($file in @($nativeProfile, $profileBootstrap, $cpuTrace,
            (Join-Path $PSScriptRoot 'membership-v8-profile.ps1'))) {
            $sourceHashes[[IO.Path]::GetFileName($file)] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        }
    }
    $sourceHashes | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'source-hashes.json')
    & uname -a > (Join-Path $OutputDirectory 'kernel.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Kernel identity unavailable.' }
    & lscpu > (Join-Path $OutputDirectory 'cpu.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Host CPU identity unavailable.' }
    $null = Invoke-Docker info --format '{{json .}}' |
        Set-Content (Join-Path $OutputDirectory 'docker-info.json')
    foreach ($image in @($protocol.baseline.image, $protocol.candidate.image, $protocol.postgres)) {
        Assert-WithinDeadline
        $null = Invoke-Docker pull $image
    }
    $identities = foreach ($role in @('baseline', 'candidate')) {
        $image = $protocol.$role.image
        $version = (Invoke-Docker run --rm --network none --label scimserver.owner=membership-qualification `
            --label "scimserver.run=$run" --entrypoint node $image `
            -p "require('/app/package.json').version").Trim()
        if ($version -cne $protocol.$role.version) { throw 'Pinned image runtime version mismatch.' }
        $identity = [pscustomobject]@{ role = $role; reference = $image
            id = (Invoke-Docker image inspect --format '{{.Id}}' $image).Trim(); version = $version }
        if ($ProfileDiagnostic) {
            $nodeVersion = (Invoke-Docker run --rm --network none `
                --label scimserver.owner=membership-qualification --label "scimserver.run=$run" `
                --entrypoint node $image -p process.version).Trim()
            $identity | Add-Member -NotePropertyName nodeVersion -NotePropertyValue $nodeVersion
        }
        $identity
    }
    $identities += [pscustomobject]@{ role = 'postgres'; reference = $protocol.postgres
        id = (Invoke-Docker image inspect --format '{{.Id}}' $protocol.postgres).Trim() }
    $identities | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'images.json')
    foreach ($block in $protocol.blocks) {
        if ($ProfileDiagnostic -and ($block.sameImage -or $block.order -cne 'BAAB')) { continue }
        Assert-WithinDeadline
        $directory = Invoke-Block $block
        if ($TraceDiagnostic) {
            & node $cpuTrace analyze $directory
            if ($LASTEXITCODE -ne 0) { throw 'CPU timeline analysis failed; no attribution or admission.' }
            $summary.Blocks += [ordered]@{ Name = $block.name; DiagnosticComplete = $true; AdmissionEligible = $false }
            break
        }
        if ($ProfileDiagnostic) {
            & node $nativeProfile analyze $directory
            if ($LASTEXITCODE -ne 0) { throw 'Native function analysis failed; no attribution or admission.' }
            $summary.Blocks += [ordered]@{ Name = $block.name; DiagnosticComplete = $true; AdmissionEligible = $false }
            break
        }
        $assessment = Join-Path $directory 'assessment.json'
        & node $evaluator $protocolPath $block.name (Join-Path $directory 'rounds.json') $assessment
        $exitCode = $LASTEXITCODE
        $summary.Blocks += [ordered]@{ Name = $block.name; Passed = ($exitCode -eq 0) }
        $summary | ConvertTo-Json -Depth 10 | Set-Content $summaryPath
        if ($exitCode -ne 0) { throw "Preregistered $($block.name) limits failed; later blocks not run." }
    }
    if ($TraceDiagnostic) {
        $summary.Status = 'DIAGNOSTIC COMPLETE: CPU temporal association only; not release admission'
    } elseif ($ProfileDiagnostic) {
        $summary.Status = 'DIAGNOSTIC COMPLETE: native function observations only; not release admission'
    } else {
        $summary.Status = 'PASS: bounded Linux qualification and both prospective comparison orders'
        $summary.AdmissionEligible = $true
    }
} catch {
    $campaignFailure = $_
    $summary.Status = 'FAIL: no deployment admission'
    $summary.AdmissionEligible = $false
    $summary['Failure'] = $_.Exception.Message
    throw
} finally {
    try {
        $summary['FinishedAtUtc'] = [DateTime]::UtcNow.ToString('o')
        $summary | ConvertTo-Json -Depth 10 | Set-Content $summaryPath
    } catch {
        $summary.Status = 'FAIL: no deployment admission'
        $summary.AdmissionEligible = $false
        if ($null -eq $campaignFailure) { throw }
        Write-Warning 'Campaign receipt write failed; primary campaign error retained.'
    } finally {
        foreach ($key in $envNames) {
            [Environment]::SetEnvironmentVariable($key, $priorEnvironment[$key])
        }
    }
}
Write-Host $summary.Status
