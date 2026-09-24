function ConvertFrom-GithubCliJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object]$InputObject
    )

    $text = if ($InputObject -is [array]) {
        (@($InputObject | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
    } else {
        [string]$InputObject
    }
    $text = [regex]::Replace($text, "`e\[[0-?]*[ -/]*[@-~]", '')
    $text = $text.TrimStart([char]0xFEFF)
    return $text | ConvertFrom-Json
}

function Select-GithubWorkflowRun {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object[]]$Runs,
        [Parameter(Mandatory)] [string]$ExpectedHeadSha,
        [Parameter(Mandatory)] [DateTimeOffset]$DispatchedAfter
    )

    $matchingRuns = @($Runs | Where-Object {
        $_.headSha -eq $ExpectedHeadSha -and
        [DateTimeOffset]$_.createdAt -ge $DispatchedAfter
    } | Sort-Object { [DateTimeOffset]$_.createdAt } -Descending)

    if ($matchingRuns.Count -eq 0) {
        return $null
    }

    return $matchingRuns[0]
}
