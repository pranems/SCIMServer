[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scim-estates.ps1')
$registry = Get-Content (Join-Path $PSScriptRoot 'scim-estates.json') -Raw | ConvertFrom-Json
$source = @($registry.tenants | Where-Object role -eq 'active')[0]
$target = ($source | ConvertTo-Json -Depth 10) | ConvertFrom-Json
$target.key = 'cutover-test-next'
$target.role = 'next'
$target.tenantId = [guid]::NewGuid().ToString()
$target.subscriptionId = [guid]::NewGuid().ToString()
$registry.tenants += $target
foreach ($estate in @($registry.estates | Where-Object tenantKey -eq $source.key)) {
    $copy = ($estate | ConvertTo-Json -Depth 10) | ConvertFrom-Json
    $copy.id = "cutover-test-$($estate.purpose)"
    $copy.tenantKey = $target.key
    $registry.estates += $copy
}
$fixture = $registry | ConvertTo-Json -Depth 30
$temporary = [IO.Path]::GetTempFileName()
$assertions = 0
function Assert-Cutover([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:assertions++
    Write-Host "PASS: $Message"
}
try {
    $fixture | Set-Content -LiteralPath $temporary
    Set-ScimEstateRole -TenantKey $target.key -Role active -RetireTenantKey $source.key -Path $temporary -Confirm:$false
    $after = Get-Content $temporary -Raw | ConvertFrom-Json
    Assert-Cutover (@($after.tenants | Where-Object role -eq 'active').Count -eq 1) 'atomic switch leaves exactly one active tenant'
    Assert-Cutover ((@($after.tenants | Where-Object key -eq $target.key)[0]).role -eq 'active') 'target becomes active'
    Assert-Cutover ((@($after.tenants | Where-Object key -eq $source.key)[0]).role -eq 'retiring') 'source becomes retiring in the same write'
    Assert-Cutover (Test-ScimEstateRegistry -Path $temporary -Quiet) 'atomic registry passes all invariants'
    $oldCustomer = @($registry.tenants | Where-Object role -eq 'permanent') | ConvertTo-Json -Depth 10
    $newCustomer = @($after.tenants | Where-Object role -eq 'permanent') | ConvertTo-Json -Depth 10
    Assert-Cutover ($oldCustomer -ceq $newCustomer) 'customer production tenant is unchanged'
    foreach ($case in @('single-promotion', 'retire-permanent', 'wrong-role', 'same-tenant', 'what-if')) {
        $fixture | Set-Content -LiteralPath $temporary
        $before = (Get-FileHash $temporary).Hash
        $rejected = $false
        try {
            switch ($case) {
                'single-promotion' { Set-ScimEstateRole -TenantKey $target.key -Role active -Path $temporary -Confirm:$false }
                'retire-permanent' { Set-ScimEstateRole -TenantKey $target.key -Role active -RetireTenantKey 'anandsa' -Path $temporary -Confirm:$false }
                'wrong-role' { Set-ScimEstateRole -TenantKey $target.key -Role retiring -RetireTenantKey $source.key -Path $temporary -Confirm:$false }
                'same-tenant' { Set-ScimEstateRole -TenantKey $source.key -Role active -RetireTenantKey $source.key -Path $temporary -Confirm:$false }
                'what-if' { Set-ScimEstateRole -TenantKey $target.key -Role active -RetireTenantKey $source.key -Path $temporary -WhatIf }
            }
        }
        catch [System.Management.Automation.RuntimeException] { $rejected = $true }
        if ($case -ne 'what-if') { Assert-Cutover $rejected "$case is rejected explicitly" }
        Assert-Cutover ((Get-FileHash $temporary).Hash -eq $before) "$case leaves registry bytes unchanged"
    }
    Write-Host "PASS: $assertions cutover assertions; no Azure calls"
}
finally { Remove-Item -LiteralPath $temporary }
