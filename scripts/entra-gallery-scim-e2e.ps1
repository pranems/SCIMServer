<#
.SYNOPSIS
    Runs bounded Microsoft Entra gallery provisioning E2E checks against the
    registry-resolved SCIMServer dev estate.

.DESCRIPTION
    Creates one synchronization job at a time on an otherwise-unused gallery
    service principal, provisions owned source fixtures through Microsoft
    Graph provisionOnDemand, verifies the resulting SCIM resources, and removes
    every owned Graph and SCIM artifact by exact ID.

    Secret values stay in memory and are never written to the JSON or Markdown
    reports. The gate refuses production targets, a gallery service principal
    with pre-existing jobs, and any WIF reference that is not already present
    on the resolved dev estate. WIF provisions into an owned isolated endpoint.

.PARAMETER Modes
    Authentication modes to exercise. Defaults to all required modes.

.PARAMETER PlanOnly
    Resolve and validate the estate, identities, gallery application, schema,
    and WIF reference without creating fixtures.
#>
[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()]
    [ValidateSet('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity')]
    [string[]]$Modes = @('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity'),
    [string]$GalleryServicePrincipalName = 'PRTest Entra Gallery Provisioning Test app',
    [string]$WifReferenceServicePrincipalName = 'SCIMValidation-WIFConnection',
    [string]$WifEntraApplicationIdentifier = $env:ENTRA_WIF_APPLICATION_ID,
    [string]$AdminToken = 'changeme-scim',
    [int]$ProvisionTimeoutSec = 240,
    [string]$OutputDirectory,
    [switch]$PlanOnly,
    [switch]$KeepArtifacts
)

$ErrorActionPreference = 'Stop'
$Modes = @($Modes | Select-Object -Unique)
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'scim-estates.ps1')
. (Join-Path $PSScriptRoot 'entra-gallery-mapping.ps1')

$graphRoot = 'https://graph.microsoft.com/beta'
$ruleName = 'USERGROUP_OUTBOUND_USERGROUP'
$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$startedAt = [DateTimeOffset]::UtcNow
$requiredMode = @('SecretToken', 'OAuthClientCredentials', 'WorkloadIdentity')
$results = [System.Collections.Generic.List[object]]::new()
$provisioningObservations = [System.Collections.Generic.List[object]]::new()
$createdEndpointIds = [System.Collections.Generic.List[string]]::new()
$createdJobIds = [System.Collections.Generic.List[string]]::new()
$createdUserIds = [System.Collections.Generic.List[string]]::new()
$createdGroupIds = [System.Collections.Generic.List[string]]::new()
$createdFederatedCredentials = [System.Collections.Generic.List[object]]::new()
$cleanupResults = [System.Collections.Generic.List[object]]::new()
$secretKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$originalAzureConfigDir = $env:AZURE_CONFIG_DIR
$graphHeaders = $null
$adminHeaders = $null
$gallerySp = $null
$appRoleIds = @()
$preexistingEndpointIds = @()
$preexistingJobIds = @()
$baseUrl = $null
$tenantDomain = $null
$report = $null
$currentStage = 'initialization'

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot "test-results\entra-gallery-scim-e2e\$runId"
}

function Add-Result {
    param(
        [Parameter(Mandatory)] [string]$Scenario,
        [Parameter(Mandatory)] [string]$Check,
        [Parameter(Mandatory)]
        [ValidateSet('PASS', 'FAIL', 'BLOCKED', 'UNSUPPORTED', 'SKIPPED')]
        [string]$Status,
        [Parameter(Mandatory)] [string]$Detail
    )

    $results.Add([pscustomobject]@{
        scenario = $Scenario
        check = $Check
        status = $Status
        detail = $Detail
        measuredAt = [DateTimeOffset]::UtcNow.ToString('o')
    })

    $color = switch ($Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        default { 'Yellow' }
    }
    Write-Host "[$Status] $Scenario - $Check`: $Detail" -ForegroundColor $color
}

function Add-CleanupResult {
    param(
        [Parameter(Mandatory)] [string]$Kind,
        [Parameter(Mandatory)] [string]$Id,
        [Parameter(Mandatory)] [bool]$Removed,
        [Parameter(Mandatory)] [string]$Detail
    )

    $cleanupResults.Add([pscustomobject]@{
        kind = $Kind
        id = $Id
        removed = $Removed
        detail = $Detail
    })
}

function New-BearerHeaders {
    param(
        [Parameter(Mandatory)] [string]$Token,
        [string]$Accept = 'application/json'
    )

    @{
        Authorization = 'Bearer ' + $Token
        Accept = $Accept
    }
}

function Get-SafeExceptionDetail {
    param([Parameter(Mandatory)] $ErrorRecord)

    $message = [string]$ErrorRecord.Exception.Message
    $raw = [string]$ErrorRecord.ErrorDetails.Message
    if (-not $raw) {
        return $message
    }
    try {
        $parsed = $raw | ConvertFrom-Json
        if ($parsed.error.code -or $parsed.error.message) {
            return "$message GraphError=$($parsed.error.code): $($parsed.error.message)"
        }
    }
    catch {
        return $message
    }
    $message
}

function Invoke-Graph {
    param(
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PATCH', 'PUT', 'DELETE')]
        [string]$Method,
        [Parameter(Mandatory)] [string]$Path,
        [object]$Body
    )

    $parameters = @{
        Uri = if ($Path.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) { $Path } else { "$graphRoot/$($Path.TrimStart('/'))" }
        Method = $Method
        Headers = $graphHeaders
        TimeoutSec = 90
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }
    Invoke-RestMethod @parameters
}

function Invoke-ScimAdmin {
    param(
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PATCH', 'DELETE')]
        [string]$Method,
        [Parameter(Mandatory)] [string]$Path,
        [object]$Body
    )

    $parameters = @{
        Uri = "$baseUrl/$($Path.TrimStart('/'))"
        Method = $Method
        Headers = $adminHeaders
        TimeoutSec = 90
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }
    Invoke-RestMethod @parameters
}

function Get-ExactServicePrincipal {
    param([Parameter(Mandatory)] [string]$DisplayName)

    $escaped = $DisplayName.Replace("'", "''")
    $filter = [uri]::EscapeDataString("displayName eq '$escaped'")
    $response = Invoke-Graph -Method GET -Path "servicePrincipals?`$filter=$filter&`$select=id,appId,displayName,appRoles,appRoleAssignmentRequired,accountEnabled"
    $matches = @($response.value)
    if ($matches.Count -ne 1) {
        throw "Expected exactly one service principal named '$DisplayName'; found $($matches.Count)."
    }
    $matches[0]
}

function New-SynchronizationJob {
    $job = Invoke-Graph -Method POST -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs" -Body @{
        templateId = 'isvonboarding'
    }
    $createdJobIds.Add([string]$job.id)
    $job
}

function Set-SynchronizationSecrets {
    param([Parameter(Mandatory)] [array]$Pairs)

    foreach ($pair in $Pairs) {
        [void]$secretKeys.Add([string]$pair.key)
    }
    Invoke-Graph -Method PUT -Path "servicePrincipals/$($gallerySp.id)/synchronization/secrets" -Body @{
        value = $Pairs
    } | Out-Null
}

function Get-SynchronizationRule {
    param([Parameter(Mandatory)] [string]$JobId)

    $schema = Invoke-Graph -Method GET -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs/$JobId/schema"
    $rules = @($schema.synchronizationRules | Where-Object name -eq $ruleName)
    if ($rules.Count -ne 1) {
        throw "Expected exactly one synchronization rule named $ruleName; found $($rules.Count)."
    }
    $rules[0]
}

function Set-TestSynchronizationMappings {
    param([Parameter(Mandatory)] [string]$JobId)

    $schemaPath = "servicePrincipals/$($gallerySp.id)/synchronization/jobs/$JobId/schema"
    $schema = Invoke-Graph -Method GET -Path $schemaPath
    $rules = @($schema.synchronizationRules | Where-Object name -eq $ruleName)
    if ($rules.Count -ne 1) {
        throw "Expected exactly one synchronization rule named $ruleName; found $($rules.Count)."
    }
    $userMappings = @($rules[0].objectMappings | Where-Object sourceObjectName -eq 'User')
    if ($userMappings.Count -ne 1) {
        throw "Expected exactly one User object mapping; found $($userMappings.Count)."
    }
    $emailMappings = @(
        $userMappings[0].attributeMappings |
            Where-Object targetAttributeName -eq 'emails[type eq "work"].value'
    )
    if ($emailMappings.Count -ne 1) {
        throw "Expected exactly one work-email mapping; found $($emailMappings.Count)."
    }

    # Unlicensed test users have no Exchange-backed `mail` value. The UPN is
    # stable, unique, and already used as userName, so map it to required work
    # email on this owned job rather than weakening the target's Entra profile.
    $emailMappings[0].source.expression = '[userPrincipalName]'
    $emailMappings[0].source.name = 'userPrincipalName'
    $schema = Add-GalleryCustomUserMapping -Schema $schema
    Invoke-Graph -Method PUT -Path $schemaPath -Body $schema | Out-Null
    $saved = Invoke-Graph -Method GET -Path $schemaPath
    Assert-GalleryCustomUserMapping -Schema $saved
    @($saved.synchronizationRules | Where-Object name -eq $ruleName)[0]
}

function Invoke-ProvisionOnDemand {
    param(
        [Parameter(Mandatory)] [string]$JobId,
        [Parameter(Mandatory)] [string]$RuleId,
        [Parameter(Mandatory)] [string]$ObjectId,
        [Parameter(Mandatory)] [ValidateSet('User', 'Group')] [string]$ObjectType,
        [ValidateCount(0, 5)] [string[]]$MemberIds = @()
    )

    if ($ObjectType -ne 'Group' -and $MemberIds.Count -gt 0) {
        throw 'Linked member IDs are only valid for Group provisioning.'
    }
    $subject = @{
        objectId = $ObjectId
        objectTypeName = $ObjectType
    }
    if ($ObjectType -eq 'Group') {
        $subject.links = @{
            members = @($MemberIds | ForEach-Object {
                @{ objectId = $_; objectTypeName = 'User' }
            })
        }
    }
    Invoke-Graph -Method POST -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs/$JobId/provisionOnDemand" -Body @{
        parameters = @(
            @{
                ruleId = $RuleId
                subjects = @($subject)
            }
        )
    }
}

function Get-ProvisionOutcome {
    param([Parameter(Mandatory)] $Response)

    $key = $null
    $value = $null
    $keyRaw = [string]$Response.key
    $valueRaw = [string]$Response.value
    if ($keyRaw) {
        try { $key = $keyRaw | ConvertFrom-Json } catch { $key = $null }
    }
    if ($valueRaw) {
        try { $value = $valueRaw | ConvertFrom-Json } catch { $value = $null }
    }
    $failedSteps = @(
        $value.provisioningSteps |
            Where-Object status -eq 'Failure' |
            ForEach-Object {
                $details = $_ | ConvertTo-Json -Depth 10 -Compress
                if ($details.Length -gt 4000) {
                    $details = $details.Substring(0, 4000) + '...'
                }
                "$($_.name): $($_.description); step=$details"
            }
    )
    $allSteps = @($value.provisioningSteps)
    $stepStatuses = @($allSteps | ForEach-Object { "$($_.name)=$($_.status)" })
    [pscustomobject]@{
        Result = if ($failedSteps.Count -gt 0) { 'Failure' }
            elseif ($key.result) { [string]$key.result }
            elseif (@($allSteps | Where-Object status -eq 'Success').Count -gt 0) { 'Success' }
            else { $keyRaw.Substring(0, [Math]::Min(160, $keyRaw.Length)) }
        ErrorCode = [string]$key.details.errorCode
        ErrorMessage = [string]$key.details.errorMessage
        Action = [string]$value.action
        FailedSteps = $failedSteps
        ResponseValueFormat = if ($value) { 'json' } else { "non-json-length-$($valueRaw.Length)" }
        ResponseValueProperties = @($value.PSObject.Properties.Name) -join ','
        StepStatuses = $stepStatuses -join ','
        HasSuccessfulExport = @(
            $allSteps | Where-Object { $_.type -eq 'Export' -and $_.status -eq 'Success' }
        ).Count -gt 0
    }
}

function Add-ProvisionObservation {
    param(
        [Parameter(Mandatory)] $Outcome,
        [Parameter(Mandatory)] [string]$JobId,
        [Parameter(Mandatory)] [string]$ObjectId,
        [Parameter(Mandatory)] [string]$ObjectType,
        [Parameter(Mandatory)] [string]$Operation,
        [Parameter(Mandatory)] [int]$Attempt
    )

    $observation = [pscustomobject]@{
        observedAt = [DateTime]::UtcNow.ToString('o')
        operation = $Operation
        jobId = $JobId
        objectId = $ObjectId
        objectType = $ObjectType
        attempt = $Attempt
        result = if ($Outcome.Result -in @('Success', 'Failure')) { $Outcome.Result } else { 'Unrecognized' }
        action = $Outcome.Action
        stepStatuses = $Outcome.StepStatuses
        hasSuccessfulExport = [bool]$Outcome.HasSuccessfulExport
        path = 'provisionOnDemand'
    }
    $provisioningObservations.Add($observation)
    $observation
}

function Invoke-ExpectedProvision {
    param(
        [Parameter(Mandatory)] [string]$JobId,
        [Parameter(Mandatory)] [string]$RuleId,
        [Parameter(Mandatory)] [string]$ObjectId,
        [Parameter(Mandatory)] [ValidateSet('User', 'Group')] [string]$ObjectType,
        [Parameter(Mandatory)] [string]$Operation,
        [ValidateCount(0, 5)] [string[]]$MemberIds = @(),
        [scriptblock]$ExportPredicate,
        [switch]$AllowScheduledFallback
    )

    $lastOutcome = $null
    foreach ($attempt in 1..7) {
        if ($attempt -gt 1) {
            Start-Sleep -Seconds 10
        }
        $response = Invoke-ProvisionOnDemand -JobId $JobId -RuleId $RuleId -ObjectId $ObjectId -ObjectType $ObjectType -MemberIds $MemberIds
        $lastOutcome = Get-ProvisionOutcome -Response $response
        $observation = Add-ProvisionObservation -Outcome $lastOutcome -JobId $JobId -ObjectId $ObjectId -ObjectType $ObjectType `
            -Operation $Operation -Attempt $attempt
        $lastOutcome | Add-Member -NotePropertyMembers @{ Observation = $observation; ExportAccepted = $false }
        if ($lastOutcome.Result -eq 'Failure') {
            $failure = @($lastOutcome.ErrorCode, $lastOutcome.ErrorMessage, $lastOutcome.FailedSteps) |
                Where-Object { $_ } |
                ForEach-Object { [string]$_ }
            throw "$Operation provisionOnDemand failed: $($failure -join '; ')"
        }
        if ($lastOutcome.HasSuccessfulExport -and
            ($null -eq $ExportPredicate -or [bool](& $ExportPredicate))) {
            $lastOutcome.ExportAccepted = $true
            return $lastOutcome
        }
    }

    if ($AllowScheduledFallback) {
        return $lastOutcome
    }
    throw "$Operation provisionOnDemand produced no accepted Export step after 7 attempts; result=$($lastOutcome.Result), action=$($lastOutcome.Action), steps=$($lastOutcome.StepStatuses)."
}

function Invoke-ScopedChangeProvision {
    param(
        [Parameter(Mandatory)] [string]$JobId,
        [Parameter(Mandatory)] [string]$RuleId,
        [Parameter(Mandatory)] [string]$ObjectId,
        [Parameter(Mandatory)] [ValidateSet('User', 'Group')] [string]$ObjectType,
        [Parameter(Mandatory)] [string]$Operation,
        [ValidateCount(0, 5)] [string[]]$MemberIds = @(),
        [scriptblock]$ExportPredicate
    )

    $outcome = Invoke-ExpectedProvision -JobId $JobId -RuleId $RuleId -ObjectId $ObjectId -ObjectType $ObjectType `
        -Operation $Operation -MemberIds $MemberIds -ExportPredicate $ExportPredicate -AllowScheduledFallback
    if ($outcome.ExportAccepted) {
        return 'provisionOnDemand'
    }

    $job = Invoke-Graph -Method GET -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs/$JobId"
    if ($job.status.code -in @('Paused', 'Quarantine')) {
        Invoke-Graph -Method POST -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs/$JobId/start" | Out-Null
    }
    elseif ($job.status.code -ne 'Active') {
        throw "$Operation cannot use scheduled fallback while the owned job state is '$($job.status.code)'."
    }
    $outcome.Observation.path = 'scheduled-sync-fallback'
    'scheduled-sync-fallback'
}

function Pause-SynchronizationJob {
    param([Parameter(Mandatory)] [string]$JobId)

    try {
        Invoke-Graph -Method POST -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs/$JobId/pause" | Out-Null
    }
    catch {
        Write-Warning "Unable to pause owned synchronization job $JobId before exact-ID cleanup: $($_.Exception.Message)"
    }
}

function Wait-GraphGroupMembership {
    param(
        [Parameter(Mandatory)] [string]$GroupId,
        [Parameter(Mandatory)] [string]$MemberId,
        [Parameter(Mandatory)] [bool]$Present
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    do {
        $response = Invoke-Graph -Method GET -Path "groups/$GroupId/members?`$select=id"
        $containsMember = @($response.value.id) -contains $MemberId
        if ($containsMember -eq $Present) {
            return
        }
        Start-Sleep -Seconds 2
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    throw "Graph group membership did not converge to Present=$Present within 60 seconds."
}

function Wait-GraphUserAccountEnabled {
    param(
        [Parameter(Mandatory)] [string]$UserId,
        [Parameter(Mandatory)] [bool]$Expected
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    do {
        $user = Invoke-Graph -Method GET -Path "users/${UserId}?`$select=accountEnabled"
        if ([bool]$user.accountEnabled -eq $Expected) {
            return
        }
        Start-Sleep -Seconds 2
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    throw "Graph user accountEnabled did not converge to $Expected within 60 seconds."
}

function Invoke-UserAccountStateProvision {
    param(
        [Parameter(Mandatory)] [string]$JobId,
        [Parameter(Mandatory)] [string]$RuleId,
        [Parameter(Mandatory)] [string]$ObjectId,
        [Parameter(Mandatory)] [string]$UserName,
        [Parameter(Mandatory)] [hashtable]$Headers,
        [Parameter(Mandatory)] [bool]$Expected,
        [Parameter(Mandatory)] [string]$Operation
    )

    foreach ($attempt in 1..4) {
        Invoke-ExpectedProvision -JobId $JobId -RuleId $RuleId -ObjectId $ObjectId -ObjectType User -Operation $Operation | Out-Null
        $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
        do {
            $resource = Find-ScimResource -ResourceType Users -Attribute userName -Value $UserName -Headers $Headers
            if ($null -ne $resource -and [bool]$resource.active -eq $Expected) {
                return $resource
            }
            Start-Sleep -Seconds 3
        } while ([DateTimeOffset]::UtcNow -lt $deadline)
        if ($attempt -lt 4) {
            Start-Sleep -Seconds 10
        }
    }

    throw "$Operation successful exports did not produce active=$Expected in SCIM after 4 attempts."
}

function Wait-AppRoleAssignment {
    param(
        [Parameter(Mandatory)] [ValidateSet('User', 'Group')] [string]$ObjectType,
        [Parameter(Mandatory)] [string]$PrincipalId
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    $collection = $ObjectType.ToLowerInvariant() + 's'
    do {
        $assignmentResponse = Invoke-Graph -Method GET -Path "$collection/$PrincipalId/appRoleAssignments"
        $assignments = @($assignmentResponse.value | Where-Object resourceId -eq $gallerySp.id)
        if ($assignments.Count -gt 0) {
            return
        }
        Start-Sleep -Seconds 2
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    throw "App-role assignment for principal $PrincipalId did not become readable within 60 seconds."
}

function New-SourceUser {
    param(
        [Parameter(Mandatory)] [string]$ModeSlug,
        [Parameter(Mandatory)] [string]$Suffix
    )

    $alias = "scim-e2e-$ModeSlug-$runId-$Suffix".ToLowerInvariant()
    $password = 'Q9!' + [guid]::NewGuid().ToString('N') + 'aZ'
    $user = Invoke-Graph -Method POST -Path 'users' -Body @{
        accountEnabled = $true
        displayName = "SCIM E2E $ModeSlug $Suffix $runId"
        mailNickname = $alias.Replace('-', '')
        userPrincipalName = "$alias@$tenantDomain"
        givenName = 'Gallery'
        surname = 'Provisioning'
        jobTitle = 'E2E Engineer'
        department = 'SCIM Validation'
        companyName = 'SCIMServer'
        officeLocation = 'Dev Estate'
        preferredLanguage = 'en-US'
        employeeId = $runId.Substring($runId.Length - 8)
        employeeType = 'Test'
        streetAddress = '1 Validation Way'
        city = 'Redmond'
        state = 'WA'
        country = 'US'
        postalCode = '98052'
        usageLocation = 'US'
        otherMails = @("$alias@example.test")
        businessPhones = @('+1 555 0100')
        mobilePhone = '+1 555 0101'
        passwordProfile = @{
            forceChangePasswordNextSignIn = $false
            password = $password
        }
    }
    $createdUserIds.Add([string]$user.id)

    $assignmentIds = @(
        foreach ($roleId in $appRoleIds) {
            $assignment = Invoke-Graph -Method POST -Path "users/$($user.id)/appRoleAssignments" -Body @{
                principalId = $user.id
                resourceId = $gallerySp.id
                appRoleId = $roleId
            }
            [string]$assignment.id
        }
    )
    Wait-AppRoleAssignment -ObjectType User -PrincipalId $user.id
    [pscustomobject]@{
        User = $user
        AssignmentIds = $assignmentIds
        Department = 'SCIM Validation'
    }
}

function New-SourceGroup {
    param([Parameter(Mandatory)] [string]$ModeSlug)

    $displayName = "SCIM E2E $ModeSlug Group $runId"
    $group = Invoke-Graph -Method POST -Path 'groups' -Body @{
        displayName = $displayName
        description = "Owned Entra gallery provisioning fixture $runId"
        mailEnabled = $false
        mailNickname = ("scime2e$ModeSlug$runId" -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()
        securityEnabled = $true
        groupTypes = @()
        isAssignableToRole = $false
        visibility = 'Private'
    }
    $createdGroupIds.Add([string]$group.id)

    $assignmentIds = @(
        foreach ($roleId in $appRoleIds) {
            $assignment = Invoke-Graph -Method POST -Path "groups/$($group.id)/appRoleAssignments" -Body @{
                principalId = $group.id
                resourceId = $gallerySp.id
                appRoleId = $roleId
            }
            [string]$assignment.id
        }
    )
    Wait-AppRoleAssignment -ObjectType Group -PrincipalId $group.id
    [pscustomobject]@{
        Group = $group
        AssignmentIds = $assignmentIds
    }
}

function Find-ScimResource {
    param(
        [Parameter(Mandatory)] [ValidateSet('Users', 'Groups')] [string]$ResourceType,
        [Parameter(Mandatory)] [string]$Attribute,
        [Parameter(Mandatory)] [string]$Value,
        [Parameter(Mandatory)] [hashtable]$Headers
    )

    $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
    $filter = [uri]::EscapeDataString("$Attribute eq `"$escaped`"")
    $response = Invoke-RestMethod -Uri "$script:targetBase/$ResourceType`?filter=$filter" -Headers $Headers -TimeoutSec 60
    $resources = @($response.Resources)
    if ($resources.Count -gt 1) {
        throw "Expected at most one $ResourceType resource for $Attribute='$Value'; found $($resources.Count)."
    }
    if ($resources.Count -eq 1) { return $resources[0] }
    return $null
}

function Wait-ScimResource {
    param(
        [Parameter(Mandatory)] [ValidateSet('Users', 'Groups')] [string]$ResourceType,
        [Parameter(Mandatory)] [string]$Attribute,
        [Parameter(Mandatory)] [string]$Value,
        [Parameter(Mandatory)] [hashtable]$Headers,
        [Parameter(Mandatory)] [scriptblock]$Predicate,
        [Parameter(Mandatory)] [string]$Expectation
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($ProvisionTimeoutSec)
    $last = $null
    do {
        $last = Find-ScimResource -ResourceType $ResourceType -Attribute $Attribute -Value $Value -Headers $Headers
        if (& $Predicate $last) {
            return $last
        }
        Start-Sleep -Seconds 3
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    throw "Timed out after ${ProvisionTimeoutSec}s waiting for $ResourceType $Attribute='$Value' to satisfy: $Expectation."
}

function New-ScimEndpoint {
    param(
        [Parameter(Mandatory)] [string]$ModeSlug,
        [Parameter(Mandatory)] [string]$Setting
    )

    $endpoint = Invoke-ScimAdmin -Method POST -Path 'scim/admin/endpoints' -Body @{
        name = "entra-gallery-e2e-$ModeSlug-$runId".ToLowerInvariant()
        displayName = "Entra Gallery E2E $ModeSlug $runId"
        description = "Owned by scripts/entra-gallery-scim-e2e.ps1 run $runId"
        profilePreset = 'entra-id'
    }
    $createdEndpointIds.Add([string]$endpoint.id)
    $profile = Add-GalleryUserExtensionProfile -Profile $endpoint.profile
    $profile.settings[$Setting] = 'True'
    Invoke-ScimAdmin -Method PATCH -Path "scim/admin/endpoints/$($endpoint.id)" -Body @{
        profile = $profile
    } | Out-Null
    $endpoint
}

function New-ModeContext {
    param([Parameter(Mandatory)] [string]$Mode)

    $modeSlug = switch ($Mode) {
        'SecretToken' { 'secret' }
        'OAuthClientCredentials' { 'oauth' }
        'WorkloadIdentity' { 'wif' }
    }

    if ($Mode -eq 'WorkloadIdentity') {
        $referenceSp = Get-ExactServicePrincipal -DisplayName $WifReferenceServicePrincipalName
        $referenceJobResponse = Invoke-Graph -Method GET -Path "servicePrincipals/$($referenceSp.id)/synchronization/jobs"
        $referenceJobs = @($referenceJobResponse.value | Where-Object { $null -ne $_ })
        if ($referenceJobs.Count -ne 1) {
            throw "Expected one WIF reference job on '$WifReferenceServicePrincipalName'; found $($referenceJobs.Count)."
        }
        $referenceSecretResponse = Invoke-Graph -Method GET -Path "servicePrincipals/$($referenceSp.id)/synchronization/secrets"
        $referenceSecrets = @($referenceSecretResponse.value | Where-Object { $null -ne $_ })
        $connectivityResponse = Invoke-Graph -Method GET -Path "servicePrincipals/$($referenceSp.id)/synchronization/connectivityParameters"
        $connectivity = @($connectivityResponse.value | Where-Object { $null -ne $_ })
        $resourceAppId = [string]($connectivity | Where-Object key -eq 'entraApplicationIdentifier').value
        $referenceObjectId = [string]($connectivity | Where-Object key -eq 'entraApplicationObjectIdentifier').value
        if (-not $resourceAppId -or $referenceObjectId -ne $referenceSp.id) {
            throw 'WIF reference must contain a resource application ID and its own service-principal object ID.'
        }
        if ($WifEntraApplicationIdentifier -and $WifEntraApplicationIdentifier -ne $resourceAppId) {
            throw 'The explicit WIF application ID does not match the reviewed reference connectivity parameters.'
        }
        $authenticationType = $referenceSecrets | Where-Object key -eq 'AuthenticationType'
        if ($authenticationType.value -ne 'WorkloadIdentityClientAuthentication') {
            throw "WIF reference connector AuthenticationType is not WorkloadIdentityClientAuthentication."
        }
        $sourceBasePair = $referenceSecrets | Where-Object key -eq 'BaseAddress'
        if (-not $sourceBasePair.value) {
            throw 'WIF reference connector has no BaseAddress.'
        }
        $sourceBaseUri = [uri]$sourceBasePair.value
        if ($sourceBaseUri.AbsolutePath -notmatch '^/scim/(?:v2/)?endpoints/([0-9a-fA-F-]{36})/?$') {
            throw 'WIF reference BaseAddress does not identify one SCIMServer endpoint.'
        }
        $referenceEndpointId = $Matches[1].ToLowerInvariant()
        $wifEndpoint = Invoke-ScimAdmin -Method GET -Path "scim/admin/endpoints/$referenceEndpointId"
        if ($wifEndpoint.profile.settings.WifCredentialsEnabled -notin @($true, 'True')) {
            throw 'Dev WIF target endpoint does not have WifCredentialsEnabled.'
        }
        $filter = [uri]::EscapeDataString("appId eq '$resourceAppId'")
        $spResponse = Invoke-Graph -Method GET -Path "servicePrincipals?`$filter=$filter&`$select=id"
        $resourceSps = @($spResponse.value | Where-Object { $null -ne $_ })
        if ($resourceSps.Count -ne 1) {
            throw 'Expected exactly one WIF resource service principal in the dev tenant.'
        }
        $endpoint = New-ScimEndpoint -ModeSlug $modeSlug -Setting 'WifCredentialsEnabled'
        $endpointId = [string]$endpoint.id
        $targetBase = "$baseUrl/scim/endpoints/$endpointId"
        Invoke-ScimAdmin -Method POST -Path "scim/admin/endpoints/$endpointId/credentials" -Body @{
            credentialType = 'wif'
            label = "Entra gallery E2E $runId"
            wif = @{
                assertionProfile = 'jwt-bearer'
                expectedIssuer = "https://login.microsoftonline.com/$($estate.Tenant.tenantId)/v2.0"
                expectedSubject = [string]$resourceSps[0].id
                expectedAudience = $resourceAppId
                jwksUri = "https://login.microsoftonline.com/$($estate.Tenant.tenantId)/discovery/v2.0/keys"
                allowedTenantId = [string]$estate.Tenant.tenantId
                scope = 'scim.read scim.write'
                issuedTokenTtlSec = 3600
                targetClientId = "entra-gallery-e2e-$runId"
            }
        } | Out-Null

        $pairs = @(
            @{ key = 'AuthenticationType'; value = 'WorkloadIdentityClientAuthentication' }
            @{ key = 'BaseAddress'; value = $targetBase }
            @{ key = 'Oauth2TokenExchangeUri'; value = "$baseUrl/scim/endpoints/$endpointId/oauth/token" }
            @{ key = 'Oauth2ClientId'; value = "entra-gallery-e2e-$runId" }
            @{ key = 'SyncNotificationSettings'; value = '{"Enabled":false,"DeleteThresholdEnabled":false}' }
            @{ key = 'SkipOutOfScopeDeletions'; value = 'false' }
            @{ key = 'SyncAll'; value = 'false' }
        )
        $filter = [uri]::EscapeDataString("appId eq '$resourceAppId'")
        $appResponse = Invoke-Graph -Method GET -Path "applications?`$filter=$filter&`$select=id"
        $apps = @($appResponse.value | Where-Object { $null -ne $_ })
        if ($apps.Count -ne 1) {
            throw 'Expected exactly one reviewed WIF resource application in the dev tenant.'
        }
        $applicationId = [string]$apps[0].id
        $ficResponse = Invoke-Graph -Method GET -Path "applications/$applicationId/federatedIdentityCredentials"
        $referenceFics = @($ficResponse.value | Where-Object {
            $_.subject.EndsWith("/$referenceObjectId", [StringComparison]::Ordinal) -and
            $_.issuer.TrimEnd('/') -eq "https://login.microsoftonline.com/$($estate.Tenant.tenantId)/v2.0" -and
            $_.audiences -contains 'api://AzureADTokenExchange'
        })
        if ($referenceFics.Count -ne 1) {
            throw 'Expected one tenant-bound federated credential for the reviewed reference service principal.'
        }
        $referenceFic = $referenceFics[0]
        $subject = $referenceFic.subject.Substring(0, $referenceFic.subject.Length - $referenceObjectId.Length) + $gallerySp.id
        $existingGalleryFics = @($ficResponse.value | Where-Object {
            $_.issuer -eq $referenceFic.issuer -and $_.subject -eq $subject
        })
        if ($existingGalleryFics.Count -gt 1 -or
            ($existingGalleryFics.Count -eq 1 -and $existingGalleryFics[0].audiences -notcontains 'api://AzureADTokenExchange')) {
            throw 'Existing gallery federation does not match the reviewed token-exchange audience.'
        }
        if ($existingGalleryFics.Count -eq 0) {
            $fic = Invoke-Graph -Method POST -Path "applications/$applicationId/federatedIdentityCredentials" -Body @{
                name = "entra-gallery-e2e-$runId"
                issuer = $referenceFic.issuer
                subject = $subject
                audiences = @('api://AzureADTokenExchange')
            }
            $createdFederatedCredentials.Add([pscustomobject]@{ ApplicationId = $applicationId; Id = [string]$fic.id })
        }

        return [pscustomobject]@{
            Mode = $Mode
            Slug = $modeSlug
            TargetBase = $targetBase
            VerificationHeaders = $adminHeaders
            Secrets = @($pairs)
            ConnectivityParameters = @(
                @{ key = 'entraApplicationIdentifier'; value = $resourceAppId }
                @{ key = 'entraApplicationObjectIdentifier'; value = [string]$gallerySp.id }
                @{ key = 'authenticationType'; value = 'WorkloadIdentityClientAuthentication' }
                @{ key = 'baseAddress'; value = $targetBase }
                @{ key = 'oauth2TokenExchangeUri'; value = "$baseUrl/scim/endpoints/$endpointId/oauth/token" }
                @{ key = 'oauth2ClientId'; value = "entra-gallery-e2e-$runId" }
            )
            EndpointId = $endpointId
            OwnsEndpoint = $true
        }
    }

    if ($Mode -eq 'SecretToken') {
        $endpoint = New-ScimEndpoint -ModeSlug $modeSlug -Setting 'SecretTokenBearerAuthEnabled'
        $credential = Invoke-ScimAdmin -Method POST -Path "scim/admin/endpoints/$($endpoint.id)/credentials" -Body @{
            credentialType = 'bearer'
            label = "Entra gallery E2E $runId"
        }
        if (-not $credential.token) {
            throw 'SCIMServer did not return the one-time endpoint bearer token.'
        }
        $targetBase = "$baseUrl/scim/endpoints/$($endpoint.id)"
        return [pscustomobject]@{
            Mode = $Mode
            Slug = $modeSlug
            TargetBase = $targetBase
            VerificationHeaders = New-BearerHeaders -Token ([string]$credential.token) -Accept 'application/scim+json'
            Secrets = @(
                @{ key = 'AuthenticationType'; value = 'TokenBasedBearerToken' }
                @{ key = 'BaseAddress'; value = $targetBase }
                @{ key = 'SecretToken'; value = [string]$credential.token }
                @{ key = 'SyncNotificationSettings'; value = '{"Enabled":false,"DeleteThresholdEnabled":false}' }
                @{ key = 'SkipOutOfScopeDeletions'; value = 'false' }
                @{ key = 'SyncAll'; value = 'false' }
            )
            EndpointId = [string]$endpoint.id
            OwnsEndpoint = $true
        }
    }

    $endpoint = New-ScimEndpoint -ModeSlug $modeSlug -Setting 'OAuthClientCredentialsAuthEnabled'
    $credential = Invoke-ScimAdmin -Method POST -Path "scim/admin/endpoints/$($endpoint.id)/credentials" -Body @{
        credentialType = 'oauth_client'
        label = "Entra gallery E2E $runId"
    }
    if (-not $credential.clientId -or -not $credential.clientSecret) {
        throw 'SCIMServer did not return the one-time OAuth client credential.'
    }
    $targetBase = "$baseUrl/scim/endpoints/$($endpoint.id)"
    $mint = Invoke-RestMethod -Uri "$targetBase/oauth/token" -Method POST -ContentType 'application/x-www-form-urlencoded' -Body @{
        grant_type = 'client_credentials'
        client_id = $credential.clientId
        client_secret = $credential.clientSecret
    } -TimeoutSec 60
    return [pscustomobject]@{
        Mode = $Mode
        Slug = $modeSlug
        TargetBase = $targetBase
        VerificationHeaders = New-BearerHeaders -Token ([string]$mint.access_token) -Accept 'application/scim+json'
        Secrets = @(
            @{ key = 'AuthenticationType'; value = 'OAuth2ClientCredentialsGrant' }
            @{ key = 'BaseAddress'; value = $targetBase }
            @{ key = 'Oauth2TokenExchangeUri'; value = "$targetBase/oauth/token" }
            @{ key = 'Oauth2ClientId'; value = [string]$credential.clientId }
            @{ key = 'Oauth2ClientSecret'; value = [string]$credential.clientSecret }
            @{ key = 'SyncNotificationSettings'; value = '{"Enabled":false,"DeleteThresholdEnabled":false}' }
            @{ key = 'SkipOutOfScopeDeletions'; value = 'false' }
            @{ key = 'SyncAll'; value = 'false' }
        )
        EndpointId = [string]$endpoint.id
        OwnsEndpoint = $true
    }
}

function Invoke-ModeScenario {
    param([Parameter(Mandatory)] [string]$Mode)

    $scenario = "auth:$Mode"
    $context = $null
    $job = $null
    $userFixture = $null
    $groupFixture = $null
    $modeStage = 'prepare connector target'
    try {
        $context = New-ModeContext -Mode $Mode
        $script:targetBase = $context.TargetBase
        Add-Result $scenario 'connector configuration' 'PASS' "Prepared an owned connector target using $Mode without persisting secret values."

        $modeStage = 'create synchronization job'
        $job = New-SynchronizationJob
        $modeStage = 'configure synchronization secrets'
        Set-SynchronizationSecrets -Pairs $context.Secrets
        if ($Mode -eq 'WorkloadIdentity') {
            $modeStage = 'configure WIF connectivity parameters'
            Invoke-Graph -Method PATCH -Path "servicePrincipals/$($gallerySp.id)/synchronization/connectivityParameters" -Body @{
                value = $context.ConnectivityParameters
            } | Out-Null
            $configurationConverged = $false
            foreach ($attempt in 1..12) {
                $configured = Invoke-Graph -Method GET -Path "servicePrincipals/$($gallerySp.id)/synchronization/connectivityParameters"
                $mismatches = @(
                    foreach ($expected in $context.ConnectivityParameters) {
                        $actual = @($configured.value | Where-Object key -eq $expected.key)
                        if ($actual.Count -ne 1 -or $actual[0].value -ne $expected.value) {
                            $expected.key
                        }
                    }
                )
                if ($mismatches.Count -eq 0) {
                    $configurationConverged = $true
                    break
                }
                Start-Sleep -Seconds 5
            }
            if (-not $configurationConverged) {
                throw "WIF connectivity read-back did not converge for: $($mismatches -join ', ')."
            }
            Add-Result $scenario 'WIF connectivity read-back' 'PASS' 'Persisted auth type, target URLs, client ID, and both application identifiers match the owned configuration.'
        }
        $modeStage = 'configure owned synchronization mapping'
        $rule = Set-TestSynchronizationMappings -JobId $job.id
        $mappingPairs = @($rule.objectMappings | ForEach-Object { "$($_.sourceObjectName)->$($_.targetObjectName)" })
        if (-not ($mappingPairs -match '^User->') -or -not ($mappingPairs -match '^Group->')) {
            throw "The gallery rule does not contain both User and Group object mappings: $($mappingPairs -join ', ')."
        }
        Add-Result $scenario 'gallery schema' 'PASS' "Resolved $ruleName with User/Group mappings, required work email, and verified custom costCode mapping."

        $modeStage = 'create and assign source user'
        $userFixture = New-SourceUser -ModeSlug $context.Slug -Suffix 'primary'
        $upn = [string]$userFixture.User.userPrincipalName
        $modeStage = 'provision source user'
        $createUserPath = 'provisionOnDemand'
        if ($Mode -eq 'WorkloadIdentity') {
            $createUserPath = Invoke-ScopedChangeProvision -JobId $job.id -RuleId $rule.id -ObjectId $userFixture.User.id -ObjectType User -Operation 'create user'
            Add-Result $scenario 'create user provisioning result' 'PASS' "Submitted create through $createUserPath."
        }
        else {
            $provisionOutcome = Invoke-ExpectedProvision -JobId $job.id -RuleId $rule.id -ObjectId $userFixture.User.id -ObjectType User -Operation 'create user'
            Add-Result $scenario 'create user provisioning result' 'PASS' "result=$($provisionOutcome.Result), action=$($provisionOutcome.Action), valueFormat=$($provisionOutcome.ResponseValueFormat), valueProperties=$($provisionOutcome.ResponseValueProperties), steps=$($provisionOutcome.StepStatuses)"
        }
        $scimUser = Wait-ScimResource -ResourceType Users -Attribute userName -Value $upn -Headers $context.VerificationHeaders `
            -Predicate { param($resource) $null -ne $resource } -Expectation 'resource exists'
        if ($createUserPath -eq 'scheduled-sync-fallback') {
            Pause-SynchronizationJob -JobId $job.id
        }
        Add-Result $scenario 'create user' 'PASS' 'Entra provisionOnDemand created the mapped SCIM User.'
        if ($scimUser.schemas -notcontains $script:galleryExtensionUrn -or
            $scimUser.($script:galleryExtensionUrn).costCode -cne $userFixture.Department) {
            throw 'Entra User create did not export the exact reviewed custom costCode value.'
        }
        Add-Result $scenario 'create custom extension' 'PASS' 'The created User includes the registered extension and exact source department value.'

        $modeStage = 'update source user'
        $updatedDisplayName = "SCIM E2E Updated $Mode $runId"
        $updatedDepartment = 'SCIM Validation Updated'
        Invoke-Graph -Method PATCH -Path "users/$($userFixture.User.id)" -Body @{
            displayName = $updatedDisplayName
            department = $updatedDepartment
            jobTitle = 'Senior E2E Engineer'
        } | Out-Null
        Invoke-ExpectedProvision -JobId $job.id -RuleId $rule.id -ObjectId $userFixture.User.id -ObjectType User -Operation 'update user' | Out-Null
        $scimUser = Wait-ScimResource -ResourceType Users -Attribute userName -Value $upn -Headers $context.VerificationHeaders `
            -Predicate {
                param($resource)
                $resource.displayName -eq $updatedDisplayName -and
                $resource.($script:galleryExtensionUrn).costCode -ceq $updatedDepartment
            } -Expectation 'updated displayName and exact custom costCode are visible'
        Add-Result $scenario 'update user' 'PASS' 'Entra provisionOnDemand updated core and enterprise-mapped source attributes.'
        Add-Result $scenario 'update custom extension' 'PASS' 'The updated source department replaced the persisted custom costCode value.'

        $modeStage = 'disable source user'
        Invoke-Graph -Method PATCH -Path "users/$($userFixture.User.id)" -Body @{ accountEnabled = $false } | Out-Null
        Wait-GraphUserAccountEnabled -UserId $userFixture.User.id -Expected $false
        $scimUser = Invoke-UserAccountStateProvision -JobId $job.id -RuleId $rule.id -ObjectId $userFixture.User.id `
            -UserName $upn -Headers $context.VerificationHeaders -Expected $false -Operation 'disable user'
        Add-Result $scenario 'disable user' 'PASS' 'Entra account disable propagated to SCIM active=false.'

        $modeStage = 'reenable source user'
        Invoke-Graph -Method PATCH -Path "users/$($userFixture.User.id)" -Body @{ accountEnabled = $true } | Out-Null
        Wait-GraphUserAccountEnabled -UserId $userFixture.User.id -Expected $true
        $scimUser = Invoke-UserAccountStateProvision -JobId $job.id -RuleId $rule.id -ObjectId $userFixture.User.id `
            -UserName $upn -Headers $context.VerificationHeaders -Expected $true -Operation 'reenable user'
        Add-Result $scenario 'reenable user' 'PASS' 'The connector restored active=true before membership and deprovision checks.'

        $modeStage = 'create and assign source group'
        $groupFixture = New-SourceGroup -ModeSlug $context.Slug
        $groupName = [string]$groupFixture.Group.displayName
        $modeStage = 'provision source group'
        $createGroupPath = Invoke-ScopedChangeProvision -JobId $job.id -RuleId $rule.id -ObjectId $groupFixture.Group.id -ObjectType Group -Operation 'create group'
        $scimGroup = Wait-ScimResource -ResourceType Groups -Attribute displayName -Value $groupName -Headers $context.VerificationHeaders `
            -Predicate { param($resource) $null -ne $resource } -Expectation 'resource exists'
        if ($createGroupPath -eq 'scheduled-sync-fallback') {
            Pause-SynchronizationJob -JobId $job.id
        }
        Add-Result $scenario 'create group' 'PASS' "Entra created the mapped SCIM Group via $createGroupPath."

        $modeStage = 'add source group member'
        Invoke-Graph -Method POST -Path "groups/$($groupFixture.Group.id)/members/`$ref" -Body @{
            '@odata.id' = "$graphRoot/directoryObjects/$($userFixture.User.id)"
        } | Out-Null
        Wait-GraphGroupMembership -GroupId $groupFixture.Group.id -MemberId $userFixture.User.id -Present $true
        $addMembershipPredicate = {
            param($resource)
            $null -ne $resource -and @($resource.members.value) -contains $scimUser.id
        }
        $addMembershipPath = Invoke-ScopedChangeProvision -JobId $job.id -RuleId $rule.id -ObjectId $groupFixture.Group.id -ObjectType Group `
            -Operation 'add group member' -MemberIds @($userFixture.User.id) -ExportPredicate {
                & $addMembershipPredicate (Find-ScimResource -ResourceType Groups -Attribute displayName -Value $groupName -Headers $context.VerificationHeaders)
            }
        $scimGroup = Wait-ScimResource -ResourceType Groups -Attribute displayName -Value $groupName -Headers $context.VerificationHeaders `
            -Predicate $addMembershipPredicate -Expectation 'member contains the provisioned user'
        if ($addMembershipPath -eq 'scheduled-sync-fallback') {
            Pause-SynchronizationJob -JobId $job.id
        }
        Add-Result $scenario 'add group member' 'PASS' "Entra membership addition propagated to the SCIM Group via $addMembershipPath."

        $modeStage = 'remove source group member'
        Invoke-Graph -Method DELETE -Path "groups/$($groupFixture.Group.id)/members/$($userFixture.User.id)/`$ref" | Out-Null
        Wait-GraphGroupMembership -GroupId $groupFixture.Group.id -MemberId $userFixture.User.id -Present $false
        $removeMembershipPredicate = {
            param($resource)
            $null -ne $resource -and -not (@($resource.members.value) -contains $scimUser.id)
        }
        $removeMembershipPath = Invoke-ScopedChangeProvision -JobId $job.id -RuleId $rule.id -ObjectId $groupFixture.Group.id -ObjectType Group `
            -Operation 'remove group member' -MemberIds @($userFixture.User.id) -ExportPredicate {
                & $removeMembershipPredicate (Find-ScimResource -ResourceType Groups -Attribute displayName -Value $groupName -Headers $context.VerificationHeaders)
            }
        $scimGroup = Wait-ScimResource -ResourceType Groups -Attribute displayName -Value $groupName -Headers $context.VerificationHeaders `
            -Predicate $removeMembershipPredicate `
            -Expectation 'member no longer contains the provisioned user'
        if ($removeMembershipPath -eq 'scheduled-sync-fallback') {
            Pause-SynchronizationJob -JobId $job.id
        }
        Add-Result $scenario 'remove group member' 'PASS' "Entra membership removal propagated to the SCIM Group via $removeMembershipPath."

        $modeStage = 'update source group'
        $updatedGroupName = "$groupName Updated"
        Invoke-Graph -Method PATCH -Path "groups/$($groupFixture.Group.id)" -Body @{ displayName = $updatedGroupName } | Out-Null
        Invoke-ExpectedProvision -JobId $job.id -RuleId $rule.id -ObjectId $groupFixture.Group.id -ObjectType Group -Operation 'update group' | Out-Null
        Wait-ScimResource -ResourceType Groups -Attribute displayName -Value $updatedGroupName -Headers $context.VerificationHeaders `
            -Predicate { param($resource) $null -ne $resource } -Expectation 'updated group name is visible' | Out-Null
        $groupName = $updatedGroupName
        Add-Result $scenario 'update group' 'PASS' 'Entra provisionOnDemand updated the SCIM Group displayName.'

        $modeStage = 'deprovision source user'
        foreach ($assignmentId in $userFixture.AssignmentIds) {
            Invoke-Graph -Method DELETE -Path "users/$($userFixture.User.id)/appRoleAssignments/$assignmentId" | Out-Null
        }
        $userDeprovisionPath = Invoke-ScopedChangeProvision -JobId $job.id -RuleId $rule.id -ObjectId $userFixture.User.id -ObjectType User -Operation 'deprovision user'
        $deprovisioned = Wait-ScimResource -ResourceType Users -Attribute userName -Value $upn -Headers $context.VerificationHeaders `
            -Predicate { param($resource) $null -eq $resource -or $resource.active -eq $false } -Expectation 'resource is absent or inactive'
        if ($userDeprovisionPath -eq 'scheduled-sync-fallback') {
            Pause-SynchronizationJob -JobId $job.id
        }
        Add-Result $scenario 'deprovision user' 'PASS' "Removing app assignment caused deletion or standards-compatible soft deactivation via $userDeprovisionPath."

        if ($groupFixture) {
            $modeStage = 'deprovision source group'
            foreach ($assignmentId in $groupFixture.AssignmentIds) {
                Invoke-Graph -Method DELETE -Path "groups/$($groupFixture.Group.id)/appRoleAssignments/$assignmentId" | Out-Null
            }
            $groupDeprovisionPath = Invoke-ScopedChangeProvision -JobId $job.id -RuleId $rule.id -ObjectId $groupFixture.Group.id -ObjectType Group -Operation 'deprovision group'
            Wait-ScimResource -ResourceType Groups -Attribute displayName -Value $groupName -Headers $context.VerificationHeaders `
                -Predicate { param($resource) $null -eq $resource } -Expectation 'group is absent' | Out-Null
            if ($groupDeprovisionPath -eq 'scheduled-sync-fallback') {
                Pause-SynchronizationJob -JobId $job.id
            }
            Add-Result $scenario 'deprovision group' 'PASS' "Removing app assignment was propagated for the owned Group via $groupDeprovisionPath."
        }

        Add-Result $scenario 'mode outcome' 'PASS' "$Mode completed its required connector-to-SCIMServer flow."
    }
    catch {
        $detail = "$modeStage`: $(Get-SafeExceptionDetail $_)"
        Add-Result $scenario 'mode outcome' 'FAIL' $detail
    }
    finally {
        if ($job) {
            if ($KeepArtifacts) {
                throw 'KeepArtifacts retains the current job; refusing to reconfigure its principal for another mode.'
            }
            Remove-OwnedSynchronizationJob -JobId $job.id
        }
    }
}

function Remove-OwnedSynchronizationJob {
    param([Parameter(Mandatory)] [string]$JobId)

    if ($JobId -notin $createdJobIds) {
        throw "Refusing to delete synchronization job $JobId because this run does not own it."
    }
    Pause-SynchronizationJob -JobId $JobId
    Start-Sleep -Seconds 3
    foreach ($attempt in 1..3) {
        try {
            Invoke-Graph -Method DELETE -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs/$JobId" | Out-Null
            break
        }
        catch {
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds 5
        }
    }
    foreach ($attempt in 1..12) {
        $jobResponse = Invoke-Graph -Method GET -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs"
        $jobIds = @($jobResponse.value | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_.id })
        if ($JobId -notin $jobIds) {
            [void]$createdJobIds.Remove($JobId)
            Add-CleanupResult -Kind 'synchronizationJob' -Id $JobId -Removed $true -Detail 'Deleted by exact ID; collection removal converged.'
            return
        }
        Start-Sleep -Seconds 5
    }
    throw "Synchronization job $JobId deletion did not converge."
}

function Remove-OwnedArtifacts {
    if ($KeepArtifacts) {
        Add-CleanupResult -Kind 'all' -Id $runId -Removed $false -Detail 'KeepArtifacts was explicitly selected.'
        return
    }

    foreach ($jobId in @($createdJobIds)) {
        try {
            Remove-OwnedSynchronizationJob -JobId $jobId
        }
        catch {
            Add-CleanupResult -Kind 'synchronizationJob' -Id $jobId -Removed $false -Detail $_.Exception.Message
        }
    }
    foreach ($groupId in @($createdGroupIds)) {
        try {
            Invoke-Graph -Method DELETE -Path "groups/$groupId" | Out-Null
            Add-CleanupResult -Kind 'sourceGroup' -Id $groupId -Removed $true -Detail 'Deleted by exact ID.'
        }
        catch {
            Add-CleanupResult -Kind 'sourceGroup' -Id $groupId -Removed $false -Detail $_.Exception.Message
        }
    }
    foreach ($credential in $createdFederatedCredentials) {
        try {
            $path = "applications/$($credential.ApplicationId)/federatedIdentityCredentials"
            Invoke-Graph -Method DELETE -Path "$path/$($credential.Id)" | Out-Null
            $remaining = Invoke-Graph -Method GET -Path $path
            if (@($remaining.value | Where-Object id -eq $credential.Id).Count -ne 0) {
                throw 'Federated credential removal did not converge.'
            }
            Add-CleanupResult -Kind 'federatedCredential' -Id $credential.Id -Removed $true -Detail 'Deleted and verified by exact owned ID.'
        }
        catch {
            Add-CleanupResult -Kind 'federatedCredential' -Id $credential.Id -Removed $false -Detail $_.Exception.Message
        }
    }
    foreach ($userId in @($createdUserIds)) {
        try {
            Invoke-Graph -Method DELETE -Path "users/$userId" | Out-Null
            Add-CleanupResult -Kind 'sourceUser' -Id $userId -Removed $true -Detail 'Deleted by exact ID.'
        }
        catch {
            Add-CleanupResult -Kind 'sourceUser' -Id $userId -Removed $false -Detail $_.Exception.Message
        }
    }
    foreach ($endpointId in @($createdEndpointIds)) {
        try {
            Invoke-ScimAdmin -Method DELETE -Path "scim/admin/endpoints/$endpointId" | Out-Null
            Add-CleanupResult -Kind 'scimEndpoint' -Id $endpointId -Removed $true -Detail 'Deleted by exact ID.'
        }
        catch {
            Add-CleanupResult -Kind 'scimEndpoint' -Id $endpointId -Removed $false -Detail $_.Exception.Message
        }
    }

    if ($gallerySp) {
        try {
            $remainingJobResponse = Invoke-Graph -Method GET -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs"
            $remainingJobs = @($remainingJobResponse.value | Where-Object { $null -ne $_ })
            $cleanupJobRemaining = @(
                $remainingJobs |
                    ForEach-Object { [string]$_.id } |
                    Where-Object { $_ -notin $preexistingJobIds }
            )
            Add-CleanupResult -Kind 'cleanup-job-verification' -Id $gallerySp.id -Removed ($cleanupJobRemaining.Count -eq 0) `
                -Detail "Owned remaining job count: $($cleanupJobRemaining.Count)."
        }
        catch {
            Add-CleanupResult -Kind 'cleanup-job-verification' -Id $gallerySp.id -Removed $false -Detail $_.Exception.Message
        }
    }
    if ($adminHeaders) {
        try {
            $remainingEndpointResponse = Invoke-ScimAdmin -Method GET -Path 'scim/admin/endpoints?count=500'
            $remainingEndpoints = @($remainingEndpointResponse.endpoints | Where-Object { $null -ne $_ })
            $cleanupEndpointRemaining = @(
                $remainingEndpoints |
                    ForEach-Object { [string]$_.id } |
                    Where-Object { $_ -notin $preexistingEndpointIds }
            )
            Add-CleanupResult -Kind 'cleanup-endpoint-verification' -Id 'dev-estate' -Removed ($cleanupEndpointRemaining.Count -eq 0) `
                -Detail "Owned remaining endpoint count: $($cleanupEndpointRemaining.Count)."
        }
        catch {
            Add-CleanupResult -Kind 'cleanup-endpoint-verification' -Id 'dev-estate' -Removed $false -Detail $_.Exception.Message
        }
    }
}

function Write-Reports {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $modeOutcomes = foreach ($mode in $Modes) {
        $modeResults = @($results | Where-Object scenario -eq "auth:$mode")
        $status = if ($modeResults.status -contains 'FAIL') { 'FAIL' }
        elseif ($modeResults.status -contains 'BLOCKED') { 'BLOCKED' }
        elseif ($modeResults.status -contains 'PASS') { 'PASS' }
        else { 'SKIPPED' }
        [pscustomobject]@{ mode = $mode; status = $status }
    }
    $missingExtensionChecks = @(
        foreach ($mode in $Modes) {
            foreach ($check in @('create custom extension', 'update custom extension')) {
                $outcomes = @($results | Where-Object {
                    $_.scenario -eq "auth:$mode" -and $_.check -eq $check
                })
                if ($outcomes.Count -ne 1 -or $outcomes[0].status -ne 'PASS') {
                    "$mode/$check"
                }
            }
        }
    )
    $extensionDisposition = if ($PlanOnly) {
        'NOT_RUN: plan-only intake does not provision the reviewed custom mapping.'
    }
    elseif ($Modes.Count -gt 0 -and $missingExtensionChecks.Count -eq 0) {
        'PASS: the reviewed department-to-costCode mapping was verified on create and update in every requested auth mode.'
    }
    else {
        'FAIL: the reviewed custom mapping did not complete create and update verification in every requested auth mode.'
    }
    $report = [pscustomobject]@{
        schemaVersion = '1.1.0'
        runId = $runId
        startedAt = $startedAt.ToString('o')
        completedAt = [DateTimeOffset]::UtcNow.ToString('o')
        estatePurpose = 'dev'
        serverVersion = $script:serverVersion
        tenantDomain = $tenantDomain
        galleryServicePrincipalName = $GalleryServicePrincipalName
        modes = @($modeOutcomes)
        results = @($results)
        provisioningObservations = @($provisioningObservations)
        cleanup = @($cleanupResults)
        secretKeys = @($secretKeys | Sort-Object)
        secretsPersisted = $false
        customExtensionDisposition = $extensionDisposition
    }
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'result.json') -Encoding utf8

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("# Entra Gallery Provisioning E2E - $runId")
    $lines.Add('')
    $lines.Add("- Estate: dev")
    $lines.Add("- SCIMServer version: $($script:serverVersion)")
    $lines.Add("- Started: $($startedAt.ToString('o'))")
    $lines.Add("- Secret values persisted: no")
    $lines.Add('')
    $lines.Add('| Mode | Outcome |')
    $lines.Add('|---|---|')
    foreach ($mode in $modeOutcomes) {
        $lines.Add("| $($mode.mode) | $($mode.status) |")
    }
    $lines.Add('')
    $lines.Add('| Scenario | Check | Status | Detail |')
    $lines.Add('|---|---|---|---|')
    foreach ($item in $results) {
        $detail = ([string]$item.detail).Replace('|', '\|').Replace("`r", ' ').Replace("`n", ' ')
        $lines.Add("| $($item.scenario) | $($item.check) | $($item.status) | $detail |")
    }
    $lines.Add('')
    $lines.Add("Custom extension disposition: $extensionDisposition")
    $lines | Set-Content -LiteralPath (Join-Path $OutputDirectory 'summary.md') -Encoding utf8
    $script:report = $report
}

try {
    $currentStage = 'resolve dev estate'
    $estate = Get-ScimEstate -Purpose 'dev'
    if ($estate.Purpose -ne 'dev') {
        throw "Resolved estate purpose '$($estate.Purpose)' is not dev."
    }
    $baseUrl = (Get-ScimEstateBaseUrl -Purpose 'dev').TrimEnd('/')
    if (-not $baseUrl.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Resolved dev BaseUrl is not HTTPS: $baseUrl"
    }
    $tenantDomain = [string]$estate.Tenant.tenantDomain
    $env:AZURE_CONFIG_DIR = [string]$estate.Tenant.UserConfigDirPath

    $currentStage = 'acquire delegated Graph token'
    $activeTenantId = az account show --query tenantId -o tsv
    if ($LASTEXITCODE -ne 0 -or $activeTenantId -ne [string]$estate.Tenant.tenantId) {
        throw "Active Azure CLI tenant '$activeTenantId' does not match the registry dev tenant '$($estate.Tenant.tenantId)'."
    }
    $graphToken = az account get-access-token --resource-type ms-graph --query accessToken -o tsv
    if ($LASTEXITCODE -ne 0 -or -not $graphToken) {
        throw 'The current interactive tenant profile cannot acquire a Microsoft Graph token.'
    }
    $graphHeaders = New-BearerHeaders -Token ([string]$graphToken)

    if (-not $AdminToken) {
        throw 'AdminToken is required for the SCIMServer administrative plane.'
    }
    $adminHeaders = New-BearerHeaders -Token $AdminToken
    $currentStage = 'read SCIMServer admin version'
    $version = Invoke-ScimAdmin -Method GET -Path 'scim/admin/version'
    $script:serverVersion = [string]$version.version

    $currentStage = 'resolve dedicated gallery service principal'
    $gallerySp = Get-ExactServicePrincipal -DisplayName $GalleryServicePrincipalName
    if (-not $gallerySp.accountEnabled) {
        throw "Gallery service principal '$GalleryServicePrincipalName' is disabled."
    }
    $appRoles = @(
        $gallerySp.appRoles |
            Where-Object {
                $_.isEnabled -and
                @($_.allowedMemberTypes) -contains 'User' -and
                $_.displayName -in @('msiam_access', 'User')
            }
    )
    if ($appRoles.Count -lt 1) {
        throw "Expected at least one enabled provisioning entitlement role on '$GalleryServicePrincipalName'."
    }
    $appRoleIds = @($appRoles | ForEach-Object { [string]$_.id })

    $currentStage = 'verify gallery synchronization job ownership'
    $preexistingJobResponse = Invoke-Graph -Method GET -Path "servicePrincipals/$($gallerySp.id)/synchronization/jobs"
    $preexistingJobs = @($preexistingJobResponse.value | Where-Object { $null -ne $_ })
    $preexistingJobIds = @($preexistingJobs | ForEach-Object { [string]$_.id })
    if ($preexistingJobIds.Count -ne 0) {
        throw "Refusing to use '$GalleryServicePrincipalName' because it has $($preexistingJobIds.Count) pre-existing synchronization job(s)."
    }
    $currentStage = 'snapshot SCIM endpoint inventory'
    $preexistingEndpointResponse = Invoke-ScimAdmin -Method GET -Path 'scim/admin/endpoints?count=500'
    $preexistingEndpoints = @($preexistingEndpointResponse.endpoints | Where-Object { $null -ne $_ })
    $preexistingEndpointIds = @($preexistingEndpoints | ForEach-Object { [string]$_.id })

    Add-Result 'intake' 'dev estate and identity boundary' 'PASS' "Resolved the active dev estate, matching interactive tenant profile, and unused gallery service principal."

    if ($PlanOnly) {
        $currentStage = 'create plan-only schema probe job'
        $probeJob = New-SynchronizationJob
        $currentStage = 'read plan-only gallery schema'
        $probeRule = Get-SynchronizationRule -JobId $probeJob.id
        Add-Result 'plan' 'gallery schema' 'PASS' "Resolved $($probeRule.name) without configuring credentials or provisioning objects."
        if ($Modes -contains 'WorkloadIdentity') {
            $currentStage = 'resolve WIF reference'
            $referenceSp = Get-ExactServicePrincipal -DisplayName $WifReferenceServicePrincipalName
            $referenceJobResponse = Invoke-Graph -Method GET -Path "servicePrincipals/$($referenceSp.id)/synchronization/jobs"
            $referenceJobs = @($referenceJobResponse.value | Where-Object { $null -ne $_ })
            if ($referenceJobs.Count -eq 1) {
                Add-Result 'plan' 'WIF reference' 'PASS' 'Resolved one existing WIF reference job; secret values were not persisted.'
            }
            else {
                Add-Result 'plan' 'WIF reference' 'BLOCKED' "Expected one WIF reference job; found $($referenceJobs.Count)."
            }
        }
    }
    else {
        foreach ($mode in $Modes) {
            Invoke-ModeScenario -Mode $mode
        }
    }
}
catch {
    Add-Result 'gate' 'execution' 'BLOCKED' "$currentStage`: $($_.Exception.Message)"
}
finally {
    try {
        Remove-OwnedArtifacts
    }
    catch {
        Add-CleanupResult -Kind 'cleanup' -Id $runId -Removed $false -Detail $_.Exception.Message
    }
    $env:AZURE_CONFIG_DIR = $originalAzureConfigDir
    Write-Reports
}

$requiredFailures = @(
    $results | Where-Object {
        ($_.status -eq 'FAIL') -or
        ($_.scenario -eq 'gate' -and $_.status -eq 'BLOCKED') -or
        ($_.scenario -eq 'plan' -and $_.status -eq 'BLOCKED') -or
        ($_.scenario -like 'auth:*' -and
            $_.scenario.Substring(5) -in $requiredMode -and
            $_.check -eq 'mode outcome' -and
            $_.status -in @('BLOCKED', 'UNSUPPORTED', 'SKIPPED'))
    }
)
$cleanupFailures = @($cleanupResults | Where-Object { -not $_.removed })

Write-Host "`nArtifacts: $OutputDirectory"
Write-Host "Results: $(@($results | Where-Object status -eq 'PASS').Count) PASS, $(@($results | Where-Object status -eq 'FAIL').Count) FAIL"
if ($requiredFailures.Count -gt 0 -or $cleanupFailures.Count -gt 0) {
    exit 1
}
