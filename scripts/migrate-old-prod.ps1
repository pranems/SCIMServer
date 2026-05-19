#requires -Version 7
<#
.SYNOPSIS
    Migrates endpoint configs + user/group data from old prod (scimserver2) to new prod + new dev.

.DESCRIPTION
    Walks every source endpoint, then for each one:
      1. Reads the full endpoint config (?view=full) including profile + settings + schemas.
      2. POSTs to each target /scim/admin/endpoints with name + displayName + description + profile.
      3. Paginates /scim/endpoints/{srcId}/Users -> POSTs each to /scim/endpoints/{newId}/Users.
         Builds srcUserId -> newUserId map for group member rewriting.
      4. Paginates /scim/endpoints/{srcId}/Groups -> POSTs each to /scim/endpoints/{newId}/Groups
         with members[].value rewritten via the userId map.

    Idempotent: skips an endpoint on a target if the target already has an endpoint with the same name.

.PARAMETER SourceBaseUrl
    Old prod base URL (no trailing slash). Default: https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io

.PARAMETER SourceClientId
    OAuth client_id for source. Default: scimserver-client

.PARAMETER SourceClientSecret
    OAuth client_secret for source. Default: changeme-oauth

.PARAMETER TargetBaseUrls
    Array of target base URLs (no trailing slash).

.PARAMETER TargetClientId
    OAuth client_id for targets. Default: scimserver-client

.PARAMETER TargetClientSecret
    OAuth client_secret for targets. Default: changeme-oauth

.PARAMETER WhatIf
    Print what would be migrated, don't actually POST anything.

.EXAMPLE
    .\scripts\migrate-old-prod.ps1 -TargetBaseUrls @(
        'https://scimserver.proudbush-ae90986e.eastus.azurecontainerapps.io',
        'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
    )
#>
[CmdletBinding()]
param(
    [string]$SourceBaseUrl = 'https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io',
    [string]$SourceClientId = 'scimserver-client',
    [string]$SourceClientSecret = 'changeme-oauth',
    [Parameter(Mandatory)] [string[]]$TargetBaseUrls,
    [string]$TargetClientId = 'scimserver-client',
    [string]$TargetClientSecret = 'changeme-oauth',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-OAuthToken {
    param([string]$BaseUrl, [string]$ClientId, [string]$ClientSecret)
    $body = @{ grant_type = 'client_credentials'; client_id = $ClientId; client_secret = $ClientSecret } | ConvertTo-Json
    $r = Invoke-RestMethod -Uri "$BaseUrl/scim/oauth/token" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30
    return $r.access_token
}

function Invoke-Json {
    param(
        [string]$Method = 'GET',
        [Parameter(Mandatory)] [string]$Url,
        [Parameter(Mandatory)] [string]$Token,
        [object]$Body,
        [string]$ContentType = 'application/json',
        [int]$TimeoutSec = 60
    )
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/scim+json' }
    if ($Method -eq 'GET') {
        return Invoke-RestMethod -Uri $Url -Headers $headers -Method GET -TimeoutSec $TimeoutSec
    }
    $jsonBody = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 30 -Compress }
    return Invoke-RestMethod -Uri $Url -Headers $headers -Method $Method -Body $jsonBody -ContentType $ContentType -TimeoutSec $TimeoutSec
}

function Get-AllScimResources {
    param([string]$BaseUrl, [string]$Token, [string]$EndpointId, [string]$ResourceType, [int]$PageSize = 100)
    $all = @()
    $startIndex = 1
    while ($true) {
        $url = "$BaseUrl/scim/endpoints/$EndpointId/$ResourceType`?startIndex=$startIndex&count=$PageSize"
        $page = Invoke-Json -Method GET -Url $url -Token $Token -TimeoutSec 60
        if (-not $page.Resources -or $page.Resources.Count -eq 0) { break }
        $all += $page.Resources
        if ($all.Count -ge $page.totalResults) { break }
        $startIndex += $page.Resources.Count
    }
    return ,$all
}

function Remove-ServerSideFields {
    param([object]$Resource)
    # Strip fields the target server will assign on POST
    $r = $Resource | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $r.PSObject.Properties.Remove('id') | Out-Null
    $r.PSObject.Properties.Remove('meta') | Out-Null
    return $r
}

function Migrate-Endpoint {
    param(
        [string]$SourceBaseUrl, [string]$SourceToken,
        [string]$TargetBaseUrl, [string]$TargetToken,
        [object]$SourceSummary
    )

    $srcId = $SourceSummary.id
    $name = $SourceSummary.name

    Write-Host "  [$name] (src=$srcId)" -ForegroundColor Cyan

    # 1. Check if target already has an endpoint with this name (idempotent)
    $targetEndpoints = Invoke-Json -Method GET -Url "$TargetBaseUrl/scim/admin/endpoints?view=summary" -Token $TargetToken
    $existing = $targetEndpoints.endpoints | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($existing) {
        Write-Host "    SKIP: target already has endpoint name='$name' (id=$($existing.id))" -ForegroundColor Yellow
        return @{ Created = $false; NewId = $existing.id; Users = 0; Groups = 0 }
    }

    # 2. Fetch full source config
    $src = Invoke-Json -Method GET -Url "$SourceBaseUrl/scim/admin/endpoints/$srcId`?view=full" -Token $SourceToken

    # 3. Build POST payload for target (only fields create-endpoint.dto accepts)
    $createDto = @{
        name = $src.name
        displayName = $src.displayName
        description = $src.description
        profile = $src.profile
    }
    # Strip null/empty
    if (-not $createDto.displayName) { $createDto.Remove('displayName') | Out-Null }
    if (-not $createDto.description) { $createDto.Remove('description') | Out-Null }

    if ($DryRun) {
        Write-Host "    DRY-RUN: would POST endpoint, then replay users + groups" -ForegroundColor Magenta
        return @{ Created = $false; NewId = $null; Users = 0; Groups = 0 }
    }

    # 4. Create endpoint on target
    $created = Invoke-Json -Method POST -Url "$TargetBaseUrl/scim/admin/endpoints" -Token $TargetToken -Body $createDto
    $newId = $created.id
    Write-Host "    Created target endpoint id=$newId" -ForegroundColor Green

    # 5. Replay users (build srcUserId -> newUserId map)
    $userMap = @{}
    $userCount = 0
    try {
        $srcUsers = Get-AllScimResources -BaseUrl $SourceBaseUrl -Token $SourceToken -EndpointId $srcId -ResourceType 'Users'
        foreach ($u in $srcUsers) {
            $payload = Remove-ServerSideFields -Resource $u
            try {
                $newU = Invoke-Json -Method POST -Url "$TargetBaseUrl/scim/endpoints/$newId/Users" -Token $TargetToken -Body $payload -ContentType 'application/scim+json'
                $userMap[$u.id] = $newU.id
                $userCount++
            } catch {
                Write-Host "      USER FAIL [$($u.userName)]: $($_.Exception.Message)" -ForegroundColor Red
                if ($_.ErrorDetails) { Write-Host "        $($_.ErrorDetails.Message)" -ForegroundColor DarkRed }
            }
        }
        Write-Host "    Migrated $userCount/$($srcUsers.Count) users" -ForegroundColor Green
    } catch {
        Write-Host "    USERS PAGINATION FAIL: $($_.Exception.Message)" -ForegroundColor Red
    }

    # 6. Replay groups (rewrite members[].value via userMap)
    $groupCount = 0
    try {
        $srcGroups = Get-AllScimResources -BaseUrl $SourceBaseUrl -Token $SourceToken -EndpointId $srcId -ResourceType 'Groups'
        foreach ($g in $srcGroups) {
            $payload = Remove-ServerSideFields -Resource $g
            if ($payload.members) {
                $newMembers = @()
                foreach ($m in $payload.members) {
                    if ($userMap.ContainsKey($m.value)) {
                        $m2 = $m | ConvertTo-Json -Depth 10 | ConvertFrom-Json
                        $m2.value = $userMap[$m.value]
                        if ($m2.PSObject.Properties.Name -contains '$ref') {
                            $m2.'$ref' = $m2.'$ref' -replace [regex]::Escape($m.value), $userMap[$m.value]
                        }
                        $newMembers += $m2
                    } else {
                        # Member references a user we didn't migrate (or external) - drop with warning
                        Write-Host "      MEMBER DROPPED (no userMap entry for $($m.value))" -ForegroundColor DarkYellow
                    }
                }
                $payload.members = $newMembers
            }
            try {
                $null = Invoke-Json -Method POST -Url "$TargetBaseUrl/scim/endpoints/$newId/Groups" -Token $TargetToken -Body $payload -ContentType 'application/scim+json'
                $groupCount++
            } catch {
                Write-Host "      GROUP FAIL [$($g.displayName)]: $($_.Exception.Message)" -ForegroundColor Red
                if ($_.ErrorDetails) { Write-Host "        $($_.ErrorDetails.Message)" -ForegroundColor DarkRed }
            }
        }
        Write-Host "    Migrated $groupCount/$($srcGroups.Count) groups" -ForegroundColor Green
    } catch {
        Write-Host "    GROUPS PAGINATION FAIL: $($_.Exception.Message)" -ForegroundColor Red
    }

    return @{ Created = $true; NewId = $newId; Users = $userCount; Groups = $groupCount }
}

# ===========================
# Main
# ===========================
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  SCIM Server Cross-Tenant Migration" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Source : $SourceBaseUrl"
foreach ($t in $TargetBaseUrls) { Write-Host "  Target : $t" }
Write-Host "  DryRun : $DryRun"
Write-Host ""

# Get source token + list
Write-Host "Authenticating to source..." -ForegroundColor Cyan
$srcToken = Get-OAuthToken -BaseUrl $SourceBaseUrl -ClientId $SourceClientId -ClientSecret $SourceClientSecret
Write-Host "  Source token obtained" -ForegroundColor Green

$srcList = Invoke-Json -Method GET -Url "$SourceBaseUrl/scim/admin/endpoints?view=summary" -Token $srcToken
Write-Host "  Source has $($srcList.endpoints.Count) endpoints"
Write-Host ""

# Authenticate to each target
$targetTokens = @{}
foreach ($t in $TargetBaseUrls) {
    Write-Host "Authenticating to target: $t" -ForegroundColor Cyan
    $targetTokens[$t] = Get-OAuthToken -BaseUrl $t -ClientId $TargetClientId -ClientSecret $TargetClientSecret
    Write-Host "  Target token obtained" -ForegroundColor Green
}
Write-Host ""

# Migrate
$summary = @{}
foreach ($target in $TargetBaseUrls) {
    Write-Host "===========================================" -ForegroundColor Magenta
    Write-Host "  Migrating to: $target" -ForegroundColor Magenta
    Write-Host "===========================================" -ForegroundColor Magenta
    $created = 0; $skipped = 0; $usersTotal = 0; $groupsTotal = 0; $failed = 0
    foreach ($ep in $srcList.endpoints) {
        try {
            $result = Migrate-Endpoint -SourceBaseUrl $SourceBaseUrl -SourceToken $srcToken `
                                       -TargetBaseUrl $target -TargetToken $targetTokens[$target] `
                                       -SourceSummary $ep
            if ($result.Created) { $created++ } else { $skipped++ }
            $usersTotal += $result.Users
            $groupsTotal += $result.Groups
        } catch {
            Write-Host "  [$($ep.name)] ENDPOINT FAIL: $($_.Exception.Message)" -ForegroundColor Red
            if ($_.ErrorDetails) { Write-Host "    $($_.ErrorDetails.Message)" -ForegroundColor DarkRed }
            $failed++
        }
    }
    $summary[$target] = @{ Created = $created; Skipped = $skipped; Users = $usersTotal; Groups = $groupsTotal; Failed = $failed }
    Write-Host ""
}

Write-Host "===========================================" -ForegroundColor Green
Write-Host "  Migration Complete" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
foreach ($target in $TargetBaseUrls) {
    $s = $summary[$target]
    Write-Host "  $target"
    Write-Host "    Endpoints created: $($s.Created), skipped (already exist): $($s.Skipped), failed: $($s.Failed)"
    Write-Host "    Users migrated: $($s.Users)"
    Write-Host "    Groups migrated: $($s.Groups)"
}
