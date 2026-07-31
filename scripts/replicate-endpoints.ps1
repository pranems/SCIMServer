<#
.SYNOPSIS
  Replicates endpoint definitions (and optionally a sample of their SCIM data)
  from one SCIMServer deployment to another.

.DESCRIPTION
  Reads are non-mutating on the SOURCE - this never writes to the source
  estate, which is what makes it safe to run with customer-facing prod as the
  source.

  THREE THINGS CANNOT BE REPLICATED, by design of the server:

    1. Endpoint IDs. `CreateEndpointDto` has no `id` field and the service
       always calls randomUUID(), so a replicated endpoint gets a NEW id and
       therefore a NEW SCIM base URL. The script prints an old -> new mapping
       so anything configured against the old URL can be repointed.

    2. User IDs. Same reason. `externalId` IS preserved, so that remains the
       stable cross-estate correlation key.

    3. Credentials. Per-endpoint secrets are stored hashed and never returned
       in plaintext, so replicated endpoints need fresh credentials minted.
       The `authentication` block is deliberately stripped rather than copied,
       because carrying over method definitions whose credential rows do not
       exist on the target produces an endpoint that looks configured but
       cannot authenticate - worse than one that is obviously unconfigured.

  Group members reference user IDs, which change, so members are remapped via
  the user id map built during the copy. A member that cannot be mapped is
  dropped and reported rather than silently sent (which would 400 the group).

.PARAMETER MaxUsers
  Cap on users copied per endpoint. 0 copies none (definitions only).

.PARAMETER NoRelaxStrict
  By default the target's StrictSchemaValidation is temporarily turned OFF for
  the data copy and then restored to its original value.

  This is not a shortcut - it is required for FIDELITY. Measured 2026-07-31 on
  calmsand's OpenText-new-May-22-ProxyAddresses-list-ISV-3: all 50 sampled
  users were rejected by the replica for `name.formatted`,
  `addresses[0].formatted` and enterprise `employeeNumber`. The replica schema
  turned out to be byte-identical to the source, and the SOURCE ITSELF returns
  400 for its own stored user shape - the data predates a later tightening of
  that endpoint's schema. Refusing to relax would silently produce an empty
  replica of a 708-user endpoint; relaxing reproduces the source's actual
  state, legacy rows and all. The original setting is always restored.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string]$SourceBase,
    [Parameter(Mandatory)] [string]$TargetBase,
    [string]$Token = 'changeme-scim',
    [string[]]$Names,
    [int]$MaxUsers = 50,
    [int]$MaxGroups = 50,
    [switch]$NoRelaxStrict,
    [switch]$SkipExisting = $true
)

$ErrorActionPreference = 'Continue'
$h = @{ Authorization = "Bearer $Token" }
$hj = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }
$hs = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/scim+json' }

function Get-Json { param($u, $hdr = $h) try { Invoke-RestMethod -Uri $u -Headers $hdr -TimeoutSec 90 } catch { $null } }

Write-Host ""
Write-Host "=== Replicate endpoints ===" -ForegroundColor Cyan
Write-Host "  source: $SourceBase"
Write-Host "  target: $TargetBase"
Write-Host "  cap   : $MaxUsers users / $MaxGroups groups per endpoint"

$srcList = (Get-Json "$SourceBase/scim/admin/endpoints?count=500").endpoints
$tgtList = (Get-Json "$TargetBase/scim/admin/endpoints?count=500").endpoints
if (-not $srcList) { throw "Could not list source endpoints." }

$tgtNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($e in $tgtList) { [void]$tgtNames.Add($e.name) }

if ($Names) {
    # `pwsh -File script.ps1 -Names 'a','b'` does NOT evaluate the array
    # syntax - everything after -File is passed as a literal string, so
    # $Names arrives as the single value "a,b" and -contains silently matches
    # nothing. Split defensively so both invocation styles behave the same.
    $Names = @($Names | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $srcList = @($srcList | Where-Object { $Names -contains $_.name })
    if ($srcList.Count -eq 0) { throw "None of the requested names matched an endpoint on the source: $($Names -join ', ')" }
} else {
    $srcList = @($srcList | Where-Object { -not $tgtNames.Contains($_.name) })
}

Write-Host "  endpoints to replicate: $($srcList.Count)" -ForegroundColor Yellow
Write-Host ""

$report = @()

foreach ($src in $srcList) {
    $line = [ordered]@{
        name = $src.name; sourceId = $src.id; targetId = ''
        users = 0; usersFailed = 0; groups = 0; groupsFailed = 0
        membersDropped = 0; danglingExtDropped = 0; status = ''
    }

    if ($SkipExisting -and $tgtNames.Contains($src.name)) {
        $line.status = 'SKIPPED (name exists on target)'
        $report += [pscustomobject]$line
        continue
    }

    $full = Get-Json "$SourceBase/scim/admin/endpoints/$($src.id)"
    if (-not $full -or -not $full.profile) {
        $line.status = 'FAILED (could not read source profile)'
        $report += [pscustomobject]$line
        continue
    }

    # Strip runtime-only and non-replicable parts of the profile.
    $profile = $full.profile | ConvertTo-Json -Depth 60 | ConvertFrom-Json
    if ($profile.PSObject.Properties.Name -contains '_schemaCaches') { $profile.PSObject.Properties.Remove('_schemaCaches') }
    if ($profile.PSObject.Properties.Name -contains 'authentication') { $profile.PSObject.Properties.Remove('authentication') }

    # Prune ResourceType schemaExtensions that reference a schema the profile
    # does not actually contain. The create-time validator rejects these
    # ("references extension schema X which is not in the schemas array"), so
    # an endpoint carrying a dangling reference cannot be recreated from its
    # own definition. Found 2026-07-31 on dev's shape-rfc-strict, which
    # advertised urn:scimserver:devshapes:user:hr-extras:1.0 in its User
    # ResourceType while neither its profile.schemas nor its live /Schemas
    # exposed it. That is a pre-existing integrity fault in the SOURCE; the
    # replica is made valid and the drop is reported rather than hidden.
    $known = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($s in @($profile.schemas)) { [void]$known.Add($s.id) }
    foreach ($rt in @($profile.resourceTypes)) {
        if ($rt.PSObject.Properties.Name -contains 'schemaExtensions' -and $rt.schemaExtensions) {
            $keep = @($rt.schemaExtensions | Where-Object { $known.Contains($_.schema) })
            $dropped = @($rt.schemaExtensions).Count - $keep.Count
            if ($dropped -gt 0) {
                $line.danglingExtDropped += $dropped
                Write-Host ("  NOTE {0}: dropped {1} dangling schemaExtension ref(s) from ResourceType '{2}'" -f $src.name, $dropped, $rt.name) -ForegroundColor DarkYellow
            }
            $rt.schemaExtensions = $keep
        }
    }

    $body = @{ name = $full.name; profile = $profile }
    if ($full.displayName) { $body.displayName = $full.displayName }
    if ($full.description) { $body.description = $full.description }

    if (-not $PSCmdlet.ShouldProcess($src.name, 'create endpoint on target')) { continue }

    try {
        $created = Invoke-RestMethod -Method Post -Uri "$TargetBase/scim/admin/endpoints" -Headers $hj `
            -Body ($body | ConvertTo-Json -Depth 60 -Compress) -TimeoutSec 120
    } catch {
        $line.status = "FAILED (create: $($_.Exception.Message))"
        $report += [pscustomobject]$line
        Write-Host ("  {0,-46} CREATE FAILED" -f $src.name) -ForegroundColor Red
        continue
    }

    $newId = $created.id
    $line.targetId = $newId

    # Temporarily relax strict validation so data that predates the endpoint's
    # current schema can still be reproduced. Restored in the finally below.
    $origStrict = $null
    if (-not $NoRelaxStrict -and ($MaxUsers -gt 0 -or $MaxGroups -gt 0)) {
        $origStrict = $created.profile.settings.StrictSchemaValidation
        if ("$origStrict" -eq 'True') {
            try {
                Invoke-RestMethod -Method Patch -Uri "$TargetBase/scim/admin/endpoints/$newId" -Headers $hj `
                    -Body (@{ profile = @{ settings = @{ StrictSchemaValidation = 'False' } } } | ConvertTo-Json -Depth 6) -TimeoutSec 60 | Out-Null
            } catch { $origStrict = $null }
        } else { $origStrict = $null }
    }

    # ── Users ────────────────────────────────────────────────────────
    $userMap = @{}
    if ($MaxUsers -gt 0) {
        $su = Get-Json "$SourceBase/scim/v2/endpoints/$($src.id)/Users?count=$MaxUsers" $hs
        foreach ($u in @($su.Resources)) {
            $p = $u | ConvertTo-Json -Depth 40 | ConvertFrom-Json
            $srcUserId = $p.id
            foreach ($ro in @('id', 'meta', 'groups')) {
                if ($p.PSObject.Properties.Name -contains $ro) { $p.PSObject.Properties.Remove($ro) }
            }
            try {
                $nu = Invoke-RestMethod -Method Post -Uri "$TargetBase/scim/v2/endpoints/$newId/Users" -Headers $hs `
                    -Body ($p | ConvertTo-Json -Depth 40 -Compress) -TimeoutSec 60
                $userMap[$srcUserId] = $nu.id
                $line.users++
            } catch { $line.usersFailed++ }
        }
    }

    # ── Groups (members remapped to the NEW user ids) ─────────────────
    if ($MaxGroups -gt 0) {
        $sg = Get-Json "$SourceBase/scim/v2/endpoints/$($src.id)/Groups?count=$MaxGroups" $hs
        foreach ($g in @($sg.Resources)) {
            $p = $g | ConvertTo-Json -Depth 40 | ConvertFrom-Json
            foreach ($ro in @('id', 'meta')) {
                if ($p.PSObject.Properties.Name -contains $ro) { $p.PSObject.Properties.Remove($ro) }
            }
            if ($p.PSObject.Properties.Name -contains 'members') {
                $mapped = @()
                foreach ($m in @($p.members)) {
                    if ($m.value -and $userMap.ContainsKey($m.value)) {
                        $nm = @{ value = $userMap[$m.value] }
                        if ($m.display) { $nm.display = $m.display }
                        $mapped += $nm
                    } else { $line.membersDropped++ }
                }
                $p.members = $mapped
            }
            try {
                Invoke-RestMethod -Method Post -Uri "$TargetBase/scim/v2/endpoints/$newId/Groups" -Headers $hs `
                    -Body ($p | ConvertTo-Json -Depth 40 -Compress) -TimeoutSec 60 | Out-Null
                $line.groups++
            } catch { $line.groupsFailed++ }
        }
    }

    $line.status = 'OK'
    $report += [pscustomobject]$line
    Write-Host ("  {0,-46} -> {1}  users {2}/{3}  groups {4}/{5}" -f `
            $src.name, $newId, $line.users, ($line.users + $line.usersFailed), $line.groups, ($line.groups + $line.groupsFailed)) -ForegroundColor Green

    # Restore the endpoint's real validation posture.
    if ($origStrict) {
        try {
            Invoke-RestMethod -Method Patch -Uri "$TargetBase/scim/admin/endpoints/$newId" -Headers $hj `
                -Body (@{ profile = @{ settings = @{ StrictSchemaValidation = 'True' } } } | ConvertTo-Json -Depth 6) -TimeoutSec 60 | Out-Null
        } catch {
            Write-Host ("  WARNING: could not restore StrictSchemaValidation on {0}" -f $newId) -ForegroundColor Red
        }
    }
}

Write-Host ""
$report | Format-Table name, status, users, usersFailed, groups, groupsFailed, membersDropped -AutoSize | Out-String -Width 160 | Write-Host
Write-Host "=== ID MAPPING (old -> new) ===" -ForegroundColor Cyan
$report | Where-Object { $_.targetId } | Format-Table name, sourceId, targetId -AutoSize | Out-String -Width 160 | Write-Host

$ok = @($report | Where-Object { $_.status -eq 'OK' }).Count
Write-Host ("replicated {0} of {1} endpoints" -f $ok, $report.Count) -ForegroundColor Yellow
