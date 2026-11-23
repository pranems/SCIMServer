[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Reject', 'Lifecycle', 'Reinitialize')]
    [string]$Mode,
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][hashtable]$Headers,
    [ValidateSet('Rest', 'Web')][string]$Transport = 'Rest',
    [string]$OriginalId,
    [string]$UnknownId
)

$ErrorActionPreference = 'Stop'

if ($Mode -eq 'Reinitialize') {
    Initialize-LiveEndpointOwnership
    return
}

if ($Mode -eq 'Reject') {
    $rejected = 0
    foreach ($command in @('Invoke-RestMethod', 'Invoke-WebRequest')) {
        foreach ($method in @('POST', 'PUT', 'PATCH', 'DELETE')) {
            foreach ($id in @($OriginalId, $UnknownId)) {
                $failure = $null
                try {
                    $null = & $command -Uri "$BaseUrl/scim/admin/endpoints/$id" `
                        -Method $method -Headers $Headers -ErrorAction Stop
                } catch {
                    $failure = $_
                }
                if ($null -eq $failure -or
                    $failure.Exception.Message -ne 'Endpoint fixture mutation requires a registered owned response UUID.') {
                    throw "Child $command $method must reject original/unknown UUID before transport."
                }
                $rejected++
            }
        }
    }
    return $rejected
}

$command = if ($Transport -eq 'Rest') {
    'Invoke-RestMethod'
} else {
    'Invoke-WebRequest'
}
$parameters = @{
    Uri = "$BaseUrl/scim/admin/endpoints"
    Method = 'POST'
    Headers = $Headers
    ContentType = 'application/json'
    Body = '{"name":"offline-child-fixture"}'
    ErrorAction = 'Stop'
}
if ($Transport -eq 'Web') { $parameters.SkipHttpErrorCheck = $true }
$response = & $command @parameters
$created = if ($Transport -eq 'Web') {
    $response.Content | ConvertFrom-Json -ErrorAction Stop
} else {
    $response
}
if (-not $created.id) { throw 'Child fixture creation must return a registered UUID.' }
$id = $created.id

$parameters.Uri = "$BaseUrl/scim/admin/endpoints/$id"
$parameters.Method = 'PATCH'
$parameters.Body = '{}'
$null = & $command @parameters

$parameters.Method = 'DELETE'
$parameters.Remove('Body')
$parameters.Remove('ContentType')
$null = & $command @parameters
return $id
