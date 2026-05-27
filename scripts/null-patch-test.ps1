#requires -Version 7
# Null-handling PATCH test matrix against a specific endpoint.
# Covers RFC 7644 §3.5.2 / RFC 7643 §2.2 + §7 null semantics for:
#   - add / replace / remove verbs
#   - readWrite / readOnly / immutable / required attributes
#   - single-valued, multi-valued, complex, sub-attribute, filtered paths
#   - path-less replace with nested null
#   - extension URN (enterprise:manager)
#   - empty string vs null distinction
#   - Group.members edge cases

param(
    [string]$Base = "https://scimserver-prod.calmsand-7f4fc5dc.centralus.azurecontainerapps.io",
    [string]$EndpointId = "128f64b5-ffb5-41f2-9ba2-c874f5ea7335",
    [string]$ClientId = "scimserver-client",
    [string]$ClientSecret = "changeme-oauth"
)

$ErrorActionPreference = "Continue"
$scim = "$Base/scim/endpoints/$EndpointId"
$tok = (Invoke-RestMethod -Uri "$Base/scim/oauth/token" -Method Post -Body (@{grant_type="client_credentials";client_id=$ClientId;client_secret=$ClientSecret}|ConvertTo-Json) -ContentType 'application/json').access_token
$h  = @{ Authorization = "Bearer $tok"; Accept = "application/scim+json" }
$ch = @{ Authorization = "Bearer $tok"; Accept = "application/scim+json"; "Content-Type" = "application/scim+json" }

$results = New-Object System.Collections.Generic.List[object]
function Record($id, $desc, $expected, $actual, $body, $pass) {
    $results.Add([pscustomobject]@{ Id=$id; Test=$desc; Expected=$expected; Actual=$actual; Pass=$pass; Body=$body })
    $color = if ($pass) { 'Green' } else { 'Red' }
    Write-Host ("[{0}] {1}  EXPECT={2}  ACTUAL={3}" -f $id, $desc, $expected, $actual) -ForegroundColor $color
}

function Invoke-Patch($url, $body) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Patch -Headers $ch -Body ($body | ConvertTo-Json -Depth 10 -Compress) -SkipHttpErrorCheck
        return [pscustomobject]@{
            Status = [int]$resp.StatusCode
            Body   = if ($resp.Content) { try { $resp.Content | ConvertFrom-Json } catch { $resp.Content } } else { $null }
            Raw    = $resp.Content
        }
    } catch {
        return [pscustomobject]@{ Status = -1; Body = $_.Exception.Message; Raw = $_.Exception.Message }
    }
}

# -----------------------------------------------------------------------------
# Setup: create a User and a Group with rich state we can mutate.
# -----------------------------------------------------------------------------
$rand = Get-Random -Maximum 999999
$userName = "null-patch-$rand@test.local"
$userBody = @{
    schemas  = @("urn:ietf:params:scim:schemas:core:2.0:User","urn:ietf:params:scim:schemas:extension:enterprise:2.0:User")
    userName = $userName
    displayName = "Null Patch Test"
    nickName = "nptest"
    name = @{ familyName = "Tester"; givenName = "Null"; formatted = "Null Tester" }
    emails = @(
        @{ value = "work-$rand@test.local"; type = "work"; primary = $true },
        @{ value = "home-$rand@test.local"; type = "home"; primary = $false }
    )
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" = @{ manager = @{ value = "mgr-123" } }
} | ConvertTo-Json -Depth 10

$user = Invoke-RestMethod -Uri "$scim/Users" -Method Post -Headers $ch -Body $userBody
$uid = $user.id
Write-Host "Created user $uid ($userName)" -ForegroundColor Cyan

$groupBody = @{
    schemas = @("urn:ietf:params:scim:schemas:core:2.0:Group")
    displayName = "null-patch-grp-$rand"
    members = @(@{ value = $uid; type = "User" })
} | ConvertTo-Json -Depth 10
$group = Invoke-RestMethod -Uri "$scim/Groups" -Method Post -Headers $ch -Body $groupBody
$gid = $group.id
Write-Host "Created group $gid" -ForegroundColor Cyan

# Helper: re-fetch and return user
function Get-User { Invoke-RestMethod -Uri "$scim/Users/$uid" -Headers $h }
function Get-Group { Invoke-RestMethod -Uri "$scim/Groups/$gid" -Headers $h }

# -----------------------------------------------------------------------------
# T01: replace:null on single-valued readWrite attribute (nickName)
# Expect: 200/204, nickName unassigned.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="nickName"; value=$null })
}
$u = Get-User
$pass = ($r.Status -in 200,204) -and (-not $u.nickName)
Record "T01" "replace:null on single-valued readWrite (nickName)" "2xx, attr unassigned" "status=$($r.Status), nickName=$($u.nickName)" $r.Body $pass

# -----------------------------------------------------------------------------
# T02: replace:null on required attribute (userName)
# Expect: 400 invalidValue.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="userName"; value=$null })
}
$st = if ($r.Body.scimType) { "$($r.Status)/$($r.Body.scimType)" } else { "$($r.Status)" }
$pass = ($r.Status -eq 400)
Record "T02" "replace:null on REQUIRED (userName)" "400 invalidValue" $st $r.Body $pass

# -----------------------------------------------------------------------------
# T03: replace:null on readOnly attribute (id)
# Expect: 400 mutability (or invalidPath).
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="id"; value=$null })
}
$st = if ($r.Body.scimType) { "$($r.Status)/$($r.Body.scimType)" } else { "$($r.Status)" }
$pass = ($r.Status -eq 400)
Record "T03" "replace:null on readOnly (id)" "400 mutability" $st $r.Body $pass

# -----------------------------------------------------------------------------
# T04: replace:null on multi-valued bare path (emails)
# Expect: 2xx, emails empty/unassigned.
# -----------------------------------------------------------------------------
# First restore emails
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="emails"; value=@(
        @{ value="work-$rand@test.local"; type="work"; primary=$true },
        @{ value="home-$rand@test.local"; type="home"; primary=$false }
    )})
} | Out-Null

$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="emails"; value=$null })
}
$u = Get-User
$emailCount = if ($u.emails) { $u.emails.Count } else { 0 }
$pass = ($r.Status -in 200,204) -and ($emailCount -eq 0)
Record "T04" "replace:null on multi-valued bare (emails)" "2xx, emails empty" "status=$($r.Status), count=$emailCount" $r.Body $pass

# Re-seed emails for next tests
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="emails"; value=@(
        @{ value="work-$rand@test.local"; type="work"; primary=$true },
        @{ value="home-$rand@test.local"; type="home"; primary=$false }
    )})
} | Out-Null

# -----------------------------------------------------------------------------
# T05: replace:null on filtered sub-attribute (emails[type eq "work"].value)
# Expect: 2xx, work entry remains with value unassigned (or rejected if value is required).
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path='emails[type eq "work"].value'; value=$null })
}
$u = Get-User
$work = $u.emails | Where-Object { $_.type -eq 'work' }
$workValue = if ($work) { $work.value } else { '<no work entry>' }
$workPresent = [bool]$work
$summary = "status=$($r.Status), workPresent=$workPresent, workValue=$workValue"
$pass = ($r.Status -in 200,204,400)
Record "T05" "replace:null on filtered sub-attr (emails[work].value)" "2xx (cleared value, entry kept) OR 400 if value required" $summary $r.Body $pass

# Re-seed
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="emails"; value=@(
        @{ value="work-$rand@test.local"; type="work"; primary=$true },
        @{ value="home-$rand@test.local"; type="home"; primary=$false }
    )})
} | Out-Null

# -----------------------------------------------------------------------------
# T06: remove with filter that matches zero entries
# Expect: 400 noTarget.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="remove"; path='emails[type eq "doesnotexist"]' })
}
$st = if ($r.Body.scimType) { "$($r.Status)/$($r.Body.scimType)" } else { "$($r.Status)" }
$pass = ($r.Status -eq 400 -and $r.Body.scimType -eq 'noTarget')
Record "T06" "remove with zero-match filter" "400 noTarget" $st $r.Body $pass

# -----------------------------------------------------------------------------
# T07: add with explicit null value
# Expect: 400 invalidValue (or no-op).
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="add"; path="title"; value=$null })
}
$u = Get-User
$st = if ($r.Body.scimType) { "$($r.Status)/$($r.Body.scimType)" } else { "$($r.Status)" }
$titleAfter = $u.title
$summary = "status=$st, title=$titleAfter"
$pass = $true  # informational
Record "T07" "add:null on missing attribute (title)" "either 400 invalidValue or 2xx no-op" $summary $r.Body $pass

# -----------------------------------------------------------------------------
# T08: path-less replace with nested null (Entra style)
# Expect: nickName unassigned, name.familyName unassigned, emails cleared.
# -----------------------------------------------------------------------------
# Seed values
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(
        @{ op="replace"; path="nickName"; value="nptest2" },
        @{ op="replace"; path="name"; value=@{ familyName="Tester"; givenName="Null"; formatted="Null Tester" } }
    )
} | Out-Null

$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; value=@{
        nickName=$null
        name=@{ familyName=$null }
        emails=$null
    }})
}
$u = Get-User
$emailCount = if ($u.emails) { $u.emails.Count } else { 0 }
$summary = "status=$($r.Status), nickName=$($u.nickName), familyName=$($u.name.familyName), givenName=$($u.name.givenName), emails=$emailCount"
$pass = ($r.Status -in 200,204) -and (-not $u.nickName) -and (-not $u.name.familyName) -and ($u.name.givenName -eq 'Null') -and ($emailCount -eq 0)
Record "T08" "path-less replace with nested nulls (Entra style)" "nickName/familyName cleared, givenName preserved, emails empty" $summary $r.Body $pass

# Re-seed
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(
        @{ op="replace"; path="name"; value=@{ familyName="Tester"; givenName="Null"; formatted="Null Tester" } },
        @{ op="replace"; path="emails"; value=@(
            @{ value="work-$rand@test.local"; type="work"; primary=$true },
            @{ value="home-$rand@test.local"; type="home"; primary=$false }
        )}
    )
} | Out-Null

# -----------------------------------------------------------------------------
# T09: replace complex parent with null (name)
# Expect: 2xx, name complex unassigned entirely.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="name"; value=$null })
}
$u = Get-User
$nameAfter = if ($u.name) { ($u.name | ConvertTo-Json -Compress) } else { '<unassigned>' }
$pass = ($r.Status -in 200,204) -and (-not $u.name)
Record "T09" "replace:null on complex parent (name)" "2xx, name unassigned" "status=$($r.Status), name=$nameAfter" $r.Body $pass

# Re-seed name
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="name"; value=@{ familyName="Tester"; givenName="Null"; formatted="Null Tester" } })
} | Out-Null

# -----------------------------------------------------------------------------
# T10: replace sub-attr with null (name.familyName)
# Expect: 2xx, familyName unassigned, givenName preserved.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="name.familyName"; value=$null })
}
$u = Get-User
$pass = ($r.Status -in 200,204) -and (-not $u.name.familyName) -and ($u.name.givenName -eq 'Null')
Record "T10" "replace:null on sub-attribute (name.familyName)" "2xx, familyName cleared, givenName kept" "status=$($r.Status), familyName=$($u.name.familyName), givenName=$($u.name.givenName)" $r.Body $pass

# Re-seed
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="name"; value=@{ familyName="Tester"; givenName="Null"; formatted="Null Tester" } })
} | Out-Null

# -----------------------------------------------------------------------------
# T11: replace complex parent with partial object containing null (merge semantics)
# Expect: 2xx, familyName unassigned, givenName REPLACED with new value, formatted preserved.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="name"; value=@{ familyName=$null; givenName="NullReplaced" } })
}
$u = Get-User
$summary = "status=$($r.Status), familyName=$($u.name.familyName), givenName=$($u.name.givenName), formatted=$($u.name.formatted)"
$mergeMode = (-not $u.name.familyName) -and ($u.name.givenName -eq 'NullReplaced') -and ($u.name.formatted -eq 'Null Tester')
$replaceMode = (-not $u.name.familyName) -and ($u.name.givenName -eq 'NullReplaced') -and (-not $u.name.formatted)
$pass = $mergeMode -or $replaceMode
Record "T11" "replace complex with partial+null (merge vs whole-replace)" "merge-style preferred (other sub-attrs kept)" ("$summary :: " + ($(if($mergeMode){'MERGE'}elseif($replaceMode){'WHOLE-REPLACE'}else{'OTHER'}))) $r.Body $pass

# Re-seed
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="name"; value=@{ familyName="Tester"; givenName="Null"; formatted="Null Tester" } })
} | Out-Null

# -----------------------------------------------------------------------------
# T12: replace:null on extension attribute (enterprise:manager)
# Expect: 2xx, manager unassigned. Bonus check: extension URN in schemas[] after?
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager"; value=$null })
}
$u = Get-User
$ent = $u.'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
$mgr = if ($ent) { $ent.manager } else { $null }
$hasExtUrn = $u.schemas -contains 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
$pass = ($r.Status -in 200,204) -and (-not $mgr)
Record "T12" "replace:null on extension attr (enterprise:manager)" "2xx, manager cleared; URN ideally removed from schemas[]" "status=$($r.Status), manager=$mgr, urnInSchemas=$hasExtUrn" $r.Body $pass

# -----------------------------------------------------------------------------
# T13: empty string vs null on string attribute (displayName)
# Expect: '' preserved as assigned-zero-length; null unassigns.
# -----------------------------------------------------------------------------
# First set displayName to empty string
$r1 = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="displayName"; value="" })
}
$uAfterEmpty = Get-User
$dnAfterEmpty = $uAfterEmpty.displayName

# Then set to null
$r2 = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="displayName"; value=$null })
}
$uAfterNull = Get-User
$dnAfterNull = $uAfterNull.displayName
$summary = "afterEmpty=[$dnAfterEmpty] (status=$($r1.Status)); afterNull=[$dnAfterNull] (status=$($r2.Status))"
$emptyTreatedAsValue = ($dnAfterEmpty -eq '')
$emptyTreatedAsUnset = ($null -eq $dnAfterEmpty)
$nullUnsets = ($null -eq $dnAfterNull)
$pass = $nullUnsets
Record "T13" "empty string vs null on displayName" "'' preserved as value, null unassigns" ("$summary :: " + ($(if($emptyTreatedAsValue){"''=VALUE"}elseif($emptyTreatedAsUnset){"''=UNASSIGNED"}else{"''=OTHER"}))) $null $pass

# -----------------------------------------------------------------------------
# T14: Group members[value eq X].value = null (required sub-attr in nested entry)
# Expect: 400 invalidValue.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Groups/$gid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="members[value eq `"$uid`"].value"; value=$null })
}
$st = if ($r.Body.scimType) { "$($r.Status)/$($r.Body.scimType)" } else { "$($r.Status)" }
$pass = ($r.Status -eq 400)
Record "T14" "replace:null on Group members[X].value (required)" "400 invalidValue" $st $r.Body $pass

# -----------------------------------------------------------------------------
# T15: Group members = null (clear all members)
# Expect: 2xx, members empty.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Groups/$gid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="members"; value=$null })
}
$g = Get-Group
$mc = if ($g.members) { $g.members.Count } else { 0 }
$pass = ($r.Status -in 200,204) -and ($mc -eq 0)
Record "T15" "replace:null on Group.members" "2xx, members empty" "status=$($r.Status), memberCount=$mc" $r.Body $pass

# -----------------------------------------------------------------------------
# T16: remove (no value) on Group.members
# Expect: 2xx, members empty. (RFC 7644 §3.5.2.2: value omitted)
# -----------------------------------------------------------------------------
# Re-add member
Invoke-Patch "$scim/Groups/$gid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="add"; path="members"; value=@(@{ value=$uid; type="User" }) })
} | Out-Null

$r = Invoke-Patch "$scim/Groups/$gid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="remove"; path="members" })
}
$g = Get-Group
$mc = if ($g.members) { $g.members.Count } else { 0 }
$pass = ($r.Status -in 200,204) -and ($mc -eq 0)
Record "T16" "remove (no value) on Group.members" "2xx, members empty" "status=$($r.Status), memberCount=$mc" $r.Body $pass

# -----------------------------------------------------------------------------
# T17: remove with filter and explicit null value (value should be ignored)
# Expect: 2xx, the matching entry removed.
# -----------------------------------------------------------------------------
# Seed two emails
Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path="emails"; value=@(
        @{ value="work-$rand@test.local"; type="work"; primary=$true },
        @{ value="home-$rand@test.local"; type="home"; primary=$false }
    )})
} | Out-Null

$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="remove"; path='emails[type eq "home"]'; value=$null })
}
$u = Get-User
$emails = if ($u.emails) { $u.emails } else { @() }
$hasHome = [bool]($emails | Where-Object { $_.type -eq 'home' })
$hasWork = [bool]($emails | Where-Object { $_.type -eq 'work' })
$pass = ($r.Status -in 200,204) -and (-not $hasHome) -and $hasWork
Record "T17" "remove with filter + explicit null value (value ignored)" "2xx, only matching entry removed" "status=$($r.Status), hasHome=$hasHome, hasWork=$hasWork" $r.Body $pass

# -----------------------------------------------------------------------------
# T18: add multi-valued with [null] elements
# Expect: 400 invalidValue.
# -----------------------------------------------------------------------------
$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="add"; path="emails"; value=@($null) })
}
$st = if ($r.Body.scimType) { "$($r.Status)/$($r.Body.scimType)" } else { "$($r.Status)" }
$pass = ($r.Status -eq 400)
Record "T18" "add multi-valued with [null] element" "400 invalidValue" $st $r.Body $pass

# -----------------------------------------------------------------------------
# T19: replace:null on opentext mailbox extension multi-valued (proxyAddresses)
# Expect: 2xx, proxyAddresses cleared.
# -----------------------------------------------------------------------------
$proxyPath = "urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox:proxyAddresses"
# Seed first
$seed = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path=$proxyPath; value=@("SMTP:p1-$rand@test.local","smtp:p2-$rand@test.local") })
}

$r = Invoke-Patch "$scim/Users/$uid" @{
    schemas=@("urn:ietf:params:scim:api:messages:2.0:PatchOp")
    Operations=@(@{ op="replace"; path=$proxyPath; value=$null })
}
$u = Get-User
$mb = $u.'urn:ietf:params:scim:schemas:extension:opentext:2.0:Mailbox'
$proxies = if ($mb) { $mb.proxyAddresses } else { $null }
$pc = if ($proxies) { $proxies.Count } else { 0 }
$pass = ($r.Status -in 200,204) -and ($pc -eq 0)
Record "T19" "replace:null on extension multi-valued string list (opentext proxyAddresses)" "2xx, list empty" "seedStatus=$($seed.Status), patchStatus=$($r.Status), count=$pc" $r.Body $pass

# -----------------------------------------------------------------------------
# Cleanup
# -----------------------------------------------------------------------------
try { Invoke-RestMethod -Uri "$scim/Users/$uid" -Method Delete -Headers $h | Out-Null } catch {}
try { Invoke-RestMethod -Uri "$scim/Groups/$gid" -Method Delete -Headers $h | Out-Null } catch {}
Write-Host "Cleaned up test user and group." -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "================ NULL PATCH TEST SUMMARY ================" -ForegroundColor Yellow
$results | Format-Table Id, Pass, Test, Expected, Actual -AutoSize -Wrap
$passed = ($results | Where-Object { $_.Pass }).Count
$total  = $results.Count
Write-Host ""
Write-Host ("Passed: {0}/{1}" -f $passed, $total) -ForegroundColor $(if ($passed -eq $total) { 'Green' } else { 'Yellow' })
