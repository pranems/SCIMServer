param(
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$protocolPath = Join-Path $PSScriptRoot 'membership-protocol.json'
$evaluator = Join-Path $PSScriptRoot 'assess-membership.cjs'
$clientScript = Join-Path $PSScriptRoot 'benchmark-membership.cjs'
$protocol = Get-Content -LiteralPath $protocolPath -Raw | ConvertFrom-Json
& node -e 'require(process.argv[1]).validateProtocol(require(process.argv[2]))' $evaluator $protocolPath
if ($LASTEXITCODE -ne 0) { throw 'Invalid preregistered protocol; no resources allocated.' }
if (!$IsLinux) { throw 'Qualification requires a Linux host, not a Windows-hosted Docker VM.' }
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
}
$envNames = @('POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET',
    'CREDENTIAL_KEK', 'DATABASE_URL', 'SCIM_BENCH_BASE_URL', 'SCIM_BENCH_TOKEN', 'SCIM_BENCH_VERSION')
$priorEnvironment = @{}
foreach ($key in $envNames) { $priorEnvironment[$key] = [Environment]::GetEnvironmentVariable($key) }

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
            & docker exec $pg pg_isready --host=127.0.0.1 -U scim -d postgres *> $null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (!$ready) { throw 'Private PostgreSQL readiness failed.' }
        foreach ($role in @('baseline', 'candidate')) {
            $null = Invoke-Docker exec $pg psql -U scim -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $role"
            $null = Invoke-Docker exec $pg psql -U scim -d $role -v ON_ERROR_STOP=1 `
                -c 'CREATE EXTENSION citext; CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm; CREATE EXTENSION "uuid-ossp"; CREATE EXTENSION pg_stat_statements;'
            $env:DATABASE_URL = '{0}://{1}:{2}@{3}:5432/{4}' -f `
                'postgresql', 'scim', $env:POSTGRES_PASSWORD, 'database', $role
            $id = (Invoke-Docker run -d --network $network --publish 127.0.0.1::8080 `
                --name "$network-$role" --label scimserver.owner=membership-qualification `
                --label "scimserver.run=$run" --cpus 0.5 --memory 1g `
                --env DATABASE_URL --env JWT_SECRET --env OAUTH_CLIENT_SECRET --env SCIM_SHARED_SECRET `
                --env CREDENTIAL_KEK --env NODE_ENV=production --env PERSISTENCE_BACKEND=prisma `
                --env PORT=8080 --entrypoint sh $roles[$role].image `
                -c 'node node_modules/prisma/build/index.js migrate deploy >/dev/null && exec node dist/main.js').Trim()
            if ($id -notmatch '^[a-f0-9]{64}$') { throw 'Invalid owned app id.' }
            $containers.Add($id)
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
            $round++
            $app = $apps[$role]
            Assert-Owned $app.Id
            $beforeCpu = Read-CpuCounters $app.Id
            $beforeSql = Read-QueryCounters $pg $role
            $env:SCIM_BENCH_BASE_URL = $app.Url
            $env:SCIM_BENCH_TOKEN = $env:SCIM_SHARED_SECRET
            $env:SCIM_BENCH_VERSION = $roles[$role].version
            $receiptPath = Join-Path $directory "round-$round-$role.json"
            $client = (Invoke-Docker create --network host --no-healthcheck `
                --label scimserver.owner=membership-qualification --label "scimserver.run=$run" `
                --mount "type=bind,source=$clientScript,target=/tmp/benchmark.cjs,readonly" `
                --env SCIM_BENCH_BASE_URL --env SCIM_BENCH_TOKEN --env SCIM_BENCH_VERSION `
                --env SCIM_BENCH_OUTPUT=/tmp/receipt.json --entrypoint node `
                $protocol.candidate.image /tmp/benchmark.cjs).Trim()
            if ($client -notmatch '^[a-f0-9]{64}$') { throw 'Invalid owned client id.' }
            $containers.Add($client)
            $null = Invoke-Docker start --attach $client
            if ([int](Invoke-Docker inspect --format '{{.State.ExitCode}}' $client) -ne 0) {
                throw 'Client failed a lifecycle, identity, timeout or exact-cleanup assertion.'
            }
            $null = Invoke-Docker cp "${client}:/tmp/receipt.json" $receiptPath
            Start-Sleep -Seconds 2
            $afterCpu = Read-CpuCounters $app.Id
            $afterSql = Read-QueryCounters $pg $role
            $peak = [long](Invoke-Docker exec $app.Id cat /sys/fs/cgroup/memory.peak)
            $oom = Invoke-Docker inspect --format '{{.State.OOMKilled}}' $app.Id
            $rss = @(Invoke-Docker exec $app.Id cat /proc/1/status | Where-Object { $_ -match '^VmRSS:\s+\d+\s+kB$' })
            if ($rss.Count -ne 1 -or $rss[0] -notmatch '^VmRSS:\s+(\d+)\s+kB$') { throw 'Node RSS unavailable.' }
            $rssBytes = [long]$Matches[1] * 1024
            if ($oom -ne 'false' -or $peak -ge 1073741824 -or $rssBytes -ge 402653184) {
                throw 'Original memory/Node RSS acceptance ceiling exceeded.'
            }
            $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
            $rows.Add([pscustomobject]@{
                role = $role; version = $receipt.version; image = $roles[$role].image
                imageId = $app.ImageId; cpuLimit = 0.5; cpuMax = $app.CpuMax; memoryLimit = 1073741824
                warmupIterations = $receipt.warmupIterations; requestCount = $receipt.requestCount
                samples = $receipt.samples; clientNode = $receipt.nodeVersion
                cpuBefore = $beforeCpu; cpuAfter = $afterCpu
                databaseCalls = $afterSql.calls - $beforeSql.calls
                databaseExecutionMs = $afterSql.executionMs - $beforeSql.executionMs
                peakCgroupBytes = $peak; nodeRssBytes = $rssBytes; oomKilled = $false
            })
            $rows.ToArray() | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $directory 'rounds.json')
            Write-Host "Completed $($Block.name) round $round ${role}: 4407 checked requests."
        }
        . (Join-Path $root 'scripts\live-test-sections\minimal-group-members.ps1')
        $script:privacyPassed = 0
        function Test-Result {
            param([bool]$Success, [string]$Message)
            if (!$Success) { throw "Private runtime contract failed: $Message" }
            $script:privacyPassed++
        }
        $null = Invoke-MinimalGroupMembersContract -BaseUrl $apps.candidate.Url `
            -Headers @{ Authorization = "Bearer $env:SCIM_SHARED_SECRET" }
        if ($script:privacyPassed -ne 66) { throw 'Incomplete 66-outcome runtime contract.' }
        Start-Sleep -Seconds 2
        $sql = 'SELECT COALESCE(json_agg(r),''[]'') FROM (SELECT "requestId","endpointId",status,"durationMs","requestHeaders" FROM "RequestLog" WHERE url LIKE ''%/Groups%'' AND (status >= 400 OR method = ''PATCH'') ORDER BY "createdAt" DESC LIMIT 200) r'
        $privateLog = @(Invoke-Docker exec $pg psql -U scim -d candidate -tAc $sql) -join "`n"
        $consoleLog = @(Invoke-Docker logs --tail 300 $apps.candidate.Id 2>&1) -join "`n"
        foreach ($key in @('POSTGRES_PASSWORD', 'SCIM_SHARED_SECRET', 'JWT_SECRET', 'OAUTH_CLIENT_SECRET', 'CREDENTIAL_KEK')) {
            $secret = [Environment]::GetEnvironmentVariable($key)
            if ($privateLog.Contains($secret) -or $consoleLog.Contains($secret)) { throw 'Generated credential leaked into private logs.' }
        }
        $logRows = @($privateLog | ConvertFrom-Json)
        if ($logRows.Count -ne 200) { throw 'Incomplete private runtime log sample.' }
        $errors = @($logRows | Where-Object status -ge 400)
        if (!$errors.Count -or !$consoleLog.Contains($errors[0].requestId.Substring(0, 8)) -or $consoleLog -notmatch 'scim\.group') {
            throw 'Negative-path categorized console correlation missing.'
        }
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
        }
        @{ contractAssertions = 66; checkedRows = 200; rawLogsExported = $false; passed = $true } |
            ConvertTo-Json | Set-Content (Join-Path $directory 'privacy.json')
    } finally {
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
    $sourceHashes | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'source-hashes.json')
    & uname -a > (Join-Path $OutputDirectory 'kernel.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Kernel identity unavailable.' }
    & lscpu > (Join-Path $OutputDirectory 'cpu.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Host CPU identity unavailable.' }
    $null = Invoke-Docker info --format '{{json .}}' |
        Set-Content (Join-Path $OutputDirectory 'docker-info.json')
    foreach ($image in @($protocol.baseline.image, $protocol.candidate.image, $protocol.postgres)) {
        $null = Invoke-Docker pull $image
    }
    $identities = foreach ($role in @('baseline', 'candidate')) {
        $image = $protocol.$role.image
        $version = (Invoke-Docker run --rm --network none --label scimserver.owner=membership-qualification `
            --label "scimserver.run=$run" --entrypoint node $image `
            -p "require('/app/package.json').version").Trim()
        if ($version -cne $protocol.$role.version) { throw 'Pinned image runtime version mismatch.' }
        [pscustomobject]@{ role = $role; reference = $image
            id = (Invoke-Docker image inspect --format '{{.Id}}' $image).Trim(); version = $version }
    }
    $identities += [pscustomobject]@{ role = 'postgres'; reference = $protocol.postgres
        id = (Invoke-Docker image inspect --format '{{.Id}}' $protocol.postgres).Trim() }
    $identities | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'images.json')
    foreach ($block in $protocol.blocks) {
        $directory = Invoke-Block $block
        $assessment = Join-Path $directory 'assessment.json'
        & node $evaluator $protocolPath $block.name (Join-Path $directory 'rounds.json') $assessment
        $exitCode = $LASTEXITCODE
        $summary.Blocks += [ordered]@{ Name = $block.name; Passed = ($exitCode -eq 0) }
        $summary | ConvertTo-Json -Depth 10 | Set-Content $summaryPath
        if ($exitCode -ne 0) { throw "Preregistered $($block.name) limits failed; later blocks not run." }
    }
    $summary.Status = 'PASS: bounded Linux qualification and both prospective comparison orders'
    Write-Host $summary.Status
} catch {
    $summary.Status = 'FAIL: no deployment admission'
    $summary['Failure'] = $_.Exception.Message
    throw
} finally {
    $summary['FinishedAtUtc'] = [DateTime]::UtcNow.ToString('o')
    $summary | ConvertTo-Json -Depth 10 | Set-Content $summaryPath
    foreach ($key in $envNames) {
        [Environment]::SetEnvironmentVariable($key, $priorEnvironment[$key])
    }
}
