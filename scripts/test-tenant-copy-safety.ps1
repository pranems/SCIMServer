[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'tenant-copy-safety.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw 'RED: tenant copy safety helper is missing' }
. $helper
foreach ($function in @('Invoke-CopyAzJson', 'Get-CopyTargetRevisionState', 'Suspend-CopyTargetWriters',
    'Resume-CopyTargetWriters', 'Initialize-CopyPrivateDirectory', 'Remove-OwnedCopyJob')) {
    if (-not (Get-Command $function -CommandType Function -ErrorAction SilentlyContinue)) {
        throw "Safety function is not available at script scope: $function"
    }
}
$script:assertions = 0
$script:responses = [System.Collections.Generic.Queue[object]]::new()
$script:calls = [System.Collections.Generic.List[string]]::new()

function az {
    $script:calls.Add($args -join ' ')
    if ($script:responses.Count -eq 0) { throw 'Unexpected Azure invocation' }
    $reply = $script:responses.Dequeue()
    $global:LASTEXITCODE = $reply.exit
    return $reply.text
}
function Start-Sleep {}
function Reply([string]$Text, [int]$Exit = 0) {
    $script:responses.Enqueue([pscustomobject]@{ text = $Text; exit = $Exit })
}
function Check([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:assertions++
    Write-Host "PASS: $Message"
}
function Reject([scriptblock]$Operation, [string]$Message) {
    $rejected = $false
    try { & $Operation }
    catch [System.Management.Automation.RuntimeException] {
        if ($_.Exception -is [System.Management.Automation.CommandNotFoundException] -or
            $_.Exception -is [System.Management.Automation.ParameterBindingException]) { throw }
        $rejected = $true
    }
    Check $rejected $Message
}

Reply '' 1
Reject { Invoke-CopyAzJson -Arguments @('containerapp','revision','list') } 'CLI failure is not empty success'
Reply ''
Reject { Invoke-CopyAzJson -Arguments @('containerapp','revision','list') } 'empty CLI response is not zero writers'
Reply 'not-json'
Reject { Invoke-CopyAzJson -Arguments @('containerapp','revision','list') } 'malformed CLI response fails explicitly'
Reply '[{"name":"green","properties":{"active":true}},{"name":"blue","properties":{"active":true}},{"name":"old","properties":{"active":false}}]'
$state = Get-CopyTargetRevisionState -AppName app -ResourceGroup rg -Subscription sub
Check ($state.ActiveRevisions.Count -eq 2) 'all originally active revisions are captured'
Reply '{"name":"green","properties":{}}'
Reject { Get-CopyTargetRevisionState -AppName app -ResourceGroup rg -Subscription sub } 'missing active flag cannot pass quiescence'

Reply ''
Reply ''
Reply '[{"name":"green","properties":{"active":false}},{"name":"blue","properties":{"active":false}},{"name":"old","properties":{"active":false}}]'
Reply '[]'
Reply '[]'
Reply '[]'
Suspend-CopyTargetWriters -AppName app -ResourceGroup rg -Subscription sub -State $state
Check (@($script:calls | Where-Object { $_ -like '*revision deactivate*' }).Count -eq 2) 'every original active revision is deactivated'
Check (@($script:calls | Where-Object { $_ -like '*replica list*--revision old*' }).Count -eq 1) 'inactive revisions are checked for remaining replicas too'

Reply '' 1
Reject { Suspend-CopyTargetWriters -AppName app -ResourceGroup rg -Subscription sub -State $state } 'failed deactivation blocks restore'
Reply ''
Reply ''
Reply '[{"name":"green","properties":{"active":false}}]'
Reply '' 1
Reject { Suspend-CopyTargetWriters -AppName app -ResourceGroup rg -Subscription sub -State $state } 'failed replica read blocks restore'

Reply ''
Reply ''
for ($i = 0; $i -lt 30; $i++) {
    Reply '[{"name":"green","properties":{"active":false}}]'
    Reply '[{"name":"still-running"}]'
}
Reject { Suspend-CopyTargetWriters -AppName app -ResourceGroup rg -Subscription sub -State $state } 'timeout with a remaining writer cannot pass'

Reply ''
Reply ''
Reply '[{"name":"green","properties":{"active":true}},{"name":"blue","properties":{"active":true}}]'
Resume-CopyTargetWriters -AppName app -ResourceGroup rg -Subscription sub -State $state
Check (@($script:calls | Where-Object { $_ -like '*revision activate*' }).Count -eq 2) 'only the originally active revisions are resumed'
Check (@($script:calls | Where-Object { $_ -notlike '*--subscription sub*' -and $_ -like '*-g rg*' }).Count -eq 0) 'all target mutations and readbacks pin the subscription'
Check (@($script:calls | Where-Object { $_ -like '*--min-replicas*' }).Count -eq 0) 'revision suspension does not overwrite scale configuration'
Reply ''
Reply ''
Reply '[{"name":"green","properties":{"active":true}}]'
Reject { Resume-CopyTargetWriters -AppName app -ResourceGroup rg -Subscription sub -State $state } 'resume is not successful unless every original revision is active'
Check ($script:responses.Count -eq 0) 'all expected Azure responses were consumed'
Reply '[{"name":"copy"}]'
Reply '{"tags":{"scimserverCopyRun":"another-run"}}'
$deletesBefore = @($script:calls | Where-Object { $_ -like '*job delete*' }).Count
Reject { Remove-OwnedCopyJob -JobName copy -ResourceGroup rg -Subscription sub -RunId ours } 'another run job is never deleted'
Check (@($script:calls | Where-Object { $_ -like '*job delete*' }).Count -eq $deletesBefore) 'ownership rejection performs no delete'
Reply '[{"name":"copy"}]'
Reply '{"tags":{"scimserverCopyRun":"ours"}}'
Reply ''
Reply '[]'
Remove-OwnedCopyJob -JobName copy -ResourceGroup rg -Subscription sub -RunId ours
Check (@($script:calls | Where-Object { $_ -like '*job delete*' }).Count -eq ($deletesBefore + 1)) 'owned job cleanup is verified'
Reply '[]'
Remove-OwnedCopyJob -JobName copy -ResourceGroup rg -Subscription sub -RunId ours
Check (@($script:calls | Where-Object { $_ -like '*job delete*' }).Count -eq ($deletesBefore + 1)) 'failed creation without a resource is safely verified absent'
Reply '[{"name":"copy"}]'
Reply '{"tags":{"scimserverCopyRun":"ours"}}'
Reply ''
Reply '[{"name":"copy"}]'
Reply '[]'
$cleanupSucceeded = $false
try {
    Remove-OwnedCopyJob -JobName copy -ResourceGroup rg -Subscription sub -RunId ours
    $cleanupSucceeded = $true
} catch {
    if ($_.Exception.Message -notmatch 'Owned copy job still exists') { throw }
}
Check $cleanupSucceeded 'owned job deletion waits for provider absence instead of failing on the first pending read'
Check (@($script:calls | Where-Object { $_ -like 'resource list*--resource-type Microsoft.App/jobs*' }).Count -eq 0) 'job absence uses provider reads rather than generic inventory'
Reply '[{"name":"copy"}]'
Reply '{"tags":{"scimserverCopyRun":"ours"}}'
Reply ''
for ($i = 0; $i -lt 30; $i++) { Reply '[{"name":"copy"}]' }
Reject { Remove-OwnedCopyJob -JobName copy -ResourceGroup rg -Subscription sub -RunId ours } 'owned job remaining after bounded cleanup cannot pass'
Check ($script:responses.Count -eq 0) 'all cleanup responses were consumed'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("scim-copy-test-" + [guid]::NewGuid().ToString('N'))
try {
    Initialize-CopyPrivateDirectory -Path $scratch
    if ($IsWindows) {
        $acl = Get-Acl -LiteralPath $scratch
        Check ($acl.AreAccessRulesProtected -and $acl.Access.Count -eq 1) 'secret scratch is private before writing files'
    }
} finally {
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch }
}
Write-Host "PASS: $script:assertions copy safety assertions; no Azure calls"
