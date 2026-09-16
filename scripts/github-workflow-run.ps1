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
