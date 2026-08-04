<#
Live verification of the PATCH profile merge semantics documented in
  docs/ENDPOINT_PROFILE_ARCHITECTURE.md  (Profile Merging on PATCH)
  docs/COMPLETE_API_REFERENCE.md         (PATCH /scim/admin/endpoints/:endpointId)
  docs/ENDPOINT_CREATION_WIKI.md         (Recipe 4)
  docs/SCHEMA_CUSTOMIZATION_GUIDE.md     (section 11)

Every assertion below maps to a specific sentence in those docs. Per R10 the checks
measure OUTCOMES (array contents, preserved keys, persisted state after a rejection),
not merely that a call returned 200.

  .\verify-patch-merge-semantics.ps1 -BaseUrl http://localhost:6000 -Token changeme-scim
#>
param(
  [string]$BaseUrl = "http://localhost:6000",
  [string]$Token   = "changeme-scim"
)

$ErrorActionPreference = 'Stop'
$H    = @{ Authorization = "Bearer $Token" }
$HJ   = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }
$pass = 0
$fail = 0

function Test-Result {
  param([bool]$Success, [string]$Message)
  if ($Success) { $script:pass++; Write-Host "  PASS  $Message" -ForegroundColor Green }
  else          { $script:fail++; Write-Host "  FAIL  $Message" -ForegroundColor Red }
}

function Get-Profile {
  param([string]$Id)
  (Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$Id`?view=full" -Headers $H).profile
}

$name = "docverify-$(Get-Random)"
Write-Host "`n=== Creating endpoint '$name' from the entra-id preset ===" -ForegroundColor Cyan
$create = @{ name = $name; displayName = "Doc verification"; profilePreset = "entra-id" } | ConvertTo-Json
$ep = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints" -Method Post -Headers $HJ -Body $create
$id = $ep.id

try {
  $base = Get-Profile -Id $id
  $baseSchemaIds = @($base.schemas.id)
  $baseRtIds     = @($base.resourceTypes.id)
  $baseSpcKeys   = @($base.serviceProviderConfig.PSObject.Properties.Name)
  Write-Host ("  baseline: {0} schemas, {1} resourceTypes, SPC keys: {2}" -f `
    $baseSchemaIds.Count, $baseRtIds.Count, ($baseSpcKeys -join ','))

  # ---------------------------------------------------------------------------
  # CLAIM 1 - "A section you omit is preserved."
  #           A settings-only PATCH must not touch schemas / resourceTypes / SPC.
  # ---------------------------------------------------------------------------
  Write-Host "`n=== CLAIM 1: omitting a section preserves it ===" -ForegroundColor Cyan
  $body = @{ profile = @{ settings = @{ RequireIfMatch = $true } } } | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Patch -Headers $HJ -Body $body | Out-Null
  $after = Get-Profile -Id $id

  Test-Result -Success ((@($after.schemas.id) -join '|') -eq ($baseSchemaIds -join '|')) `
    -Message "C1.1: settings-only PATCH preserved all $($baseSchemaIds.Count) schemas"
  Test-Result -Success ((@($after.resourceTypes.id) -join '|') -eq ($baseRtIds -join '|')) `
    -Message "C1.2: settings-only PATCH preserved all $($baseRtIds.Count) resourceTypes"
  Test-Result -Success ((@($after.serviceProviderConfig.PSObject.Properties.Name) -join '|') -eq ($baseSpcKeys -join '|')) `
    -Message "C1.3: settings-only PATCH preserved every serviceProviderConfig key"
  Test-Result -Success ("$($after.settings.RequireIfMatch)" -eq 'True') `
    -Message "C1.4: the flag actually changed (RequireIfMatch = $($after.settings.RequireIfMatch))"

  # ---------------------------------------------------------------------------
  # CLAIM 2 - "settings is a per-key merge" - other flags survive.
  # ---------------------------------------------------------------------------
  Write-Host "`n=== CLAIM 2: settings merge per flag ===" -ForegroundColor Cyan
  $body = @{ profile = @{ settings = @{ VerbosePatchSupported = $true } } } | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Patch -Headers $HJ -Body $body | Out-Null
  $after = Get-Profile -Id $id
  Test-Result -Success ("$($after.settings.RequireIfMatch)" -eq 'True' -and "$($after.settings.VerbosePatchSupported)" -eq 'True') `
    -Message "C2.1: the earlier RequireIfMatch survived a later single-flag PATCH"

  # ---------------------------------------------------------------------------
  # CLAIM 3 - serviceProviderConfig is a PER-KEY merge, NOT a full replace.
  #           This is the correction made to the docs on 2026-08-04.
  # ---------------------------------------------------------------------------
  Write-Host "`n=== CLAIM 3: serviceProviderConfig is a per-key merge, not a replace ===" -ForegroundColor Cyan
  $body = @{ profile = @{ serviceProviderConfig = @{ sort = @{ supported = $true } } } } | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Patch -Headers $HJ -Body $body | Out-Null
  $after = Get-Profile -Id $id
  $afterSpcKeys = @($after.serviceProviderConfig.PSObject.Properties.Name)
  $missing = @($baseSpcKeys | Where-Object { $_ -notin $afterSpcKeys })

  Test-Result -Success ($missing.Count -eq 0) `
    -Message "C3.1: sending ONLY 'sort' preserved every other SPC key (missing: $($missing -join ',' ))"
  Test-Result -Success ($after.serviceProviderConfig.sort.supported -eq $true) `
    -Message "C3.2: the key actually sent was overwritten (sort.supported = $($after.serviceProviderConfig.sort.supported))"

  # ---------------------------------------------------------------------------
  # CLAIM 4 - schemas / resourceTypes are REPLACED wholesale.
  # ---------------------------------------------------------------------------
  Write-Host "`n=== CLAIM 4: schemas and resourceTypes are replaced wholesale ===" -ForegroundColor Cyan
  $body = @{
    profile = @{
      schemas = @(
        @{ id = "urn:ietf:params:scim:schemas:core:2.0:User"; name = "User"; attributes = "all" }
      )
      resourceTypes = @(
        @{ id = "User"; name = "User"; endpoint = "/Users"; description = "User"
           schema = "urn:ietf:params:scim:schemas:core:2.0:User"; schemaExtensions = @() }
      )
    }
  } | ConvertTo-Json -Depth 12
  Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Patch -Headers $HJ -Body $body | Out-Null
  $after = Get-Profile -Id $id

  Test-Result -Success (@($after.schemas).Count -eq 1) `
    -Message "C4.1: a 1-element schemas array left exactly 1 schema (was $($baseSchemaIds.Count), now $(@($after.schemas).Count))"
  Test-Result -Success ('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User' -notin @($after.schemas.id)) `
    -Message "C4.2: the EnterpriseUser extension that was NOT resent is gone"
  Test-Result -Success (@($after.resourceTypes).Count -eq 1 -and $after.resourceTypes[0].id -eq 'User') `
    -Message "C4.3: resourceTypes replaced down to the single User type"

  # ---------------------------------------------------------------------------
  # CLAIM 5 - cross-section validation + atomic rejection.
  # ---------------------------------------------------------------------------
  Write-Host "`n=== CLAIM 5: cross-section validation rejects a dangling schema URN, atomically ===" -ForegroundColor Cyan
  $bad = @{
    profile = @{
      resourceTypes = @(
        @{ id = "User"; name = "User"; endpoint = "/Users"; description = "User"
           schema = "urn:ietf:params:scim:schemas:core:2.0:User"; schemaExtensions = @() },
        @{ id = "Group"; name = "Group"; endpoint = "/Groups"; description = "Group"
           schema = "urn:ietf:params:scim:schemas:core:2.0:Group"; schemaExtensions = @() }
      )
    }
  } | ConvertTo-Json -Depth 12
  $status = 0; $detail = ''
  try {
    Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Patch -Headers $HJ -Body $bad | Out-Null
    $status = 200
  } catch {
    $status = [int]$_.Exception.Response.StatusCode
    $detail = ($_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue).message
    if (-not $detail) { $detail = $_.ErrorDetails.Message }
  }
  Test-Result -Success ($status -eq 400) -Message "C5.1: adding a Group resourceType with no Group schema returns 400 (got $status)"
  Test-Result -Success ("$detail" -match 'which is not in the schemas array') `
    -Message "C5.2: the documented literal message is emitted -> $detail"

  $afterBad = Get-Profile -Id $id
  Test-Result -Success (@($afterBad.resourceTypes).Count -eq 1) `
    -Message "C5.3: the rejected PATCH persisted nothing (resourceTypes still 1)"

  # ---------------------------------------------------------------------------
  # CLAIM 6 - read-modify-write adds an extension and it is live in discovery.
  # ---------------------------------------------------------------------------
  Write-Host "`n=== CLAIM 6: read-modify-write adds an extension, live immediately ===" -ForegroundColor Cyan
  $current   = Get-Profile -Id $id
  $newSchema = @{
    id          = "urn:example:params:scim:schemas:extension:device:2.0:Device"
    name        = "Device"
    description = "Custom device extension"
    attributes  = @(
      @{ name = "serialNumber"; type = "string"; multiValued = $false; required = $false
         caseExact = $false; mutability = "readWrite"; returned = "default"; uniqueness = "none" }
    )
  }
  $rts = @($current.resourceTypes)
  ($rts | Where-Object { $_.id -eq 'User' }).schemaExtensions = @(@{ schema = $newSchema.id; required = $false })

  $body = @{
    profile = @{
      schemas       = @($current.schemas) + $newSchema
      resourceTypes = $rts
    }
  } | ConvertTo-Json -Depth 30
  Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Patch -Headers $HJ -Body $body | Out-Null

  $disc = Invoke-RestMethod -Uri "$BaseUrl/scim/endpoints/$id/Schemas" -Headers $H
  Test-Result -Success ($newSchema.id -in @($disc.Resources.id)) `
    -Message "C6.1: the new extension URN is served by GET /endpoints/{id}/Schemas with no restart"

  $discRt = Invoke-RestMethod -Uri "$BaseUrl/scim/endpoints/$id/ResourceTypes" -Headers $H
  $userRt = $discRt.Resources | Where-Object { $_.id -eq 'User' }
  Test-Result -Success ($newSchema.id -in @($userRt.schemaExtensions.schema)) `
    -Message "C6.2: the extension is bound to the User resourceType in discovery"

  # ---------------------------------------------------------------------------
  # CLAIM 7 - top-level fields also follow omit-preserves.
  # ---------------------------------------------------------------------------
  Write-Host "`n=== CLAIM 7: top-level fields follow omit-preserves ===" -ForegroundColor Cyan
  $body = @{ displayName = "Renamed by doc verification" } | ConvertTo-Json
  $r = Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Patch -Headers $HJ -Body $body
  Test-Result -Success ($r.displayName -eq "Renamed by doc verification" -and $r.name -eq $name) `
    -Message "C7.1: displayName changed while name and profile were preserved"
  $afterName = Get-Profile -Id $id
  Test-Result -Success (@($afterName.schemas).Count -eq @($current.schemas).Count + 1) `
    -Message "C7.2: a metadata-only PATCH left the schema set intact"
}
finally {
  Write-Host "`n=== Cleanup ===" -ForegroundColor Cyan
  try {
    Invoke-RestMethod -Uri "$BaseUrl/scim/admin/endpoints/$id" -Method Delete -Headers $H | Out-Null
    Write-Host "  deleted endpoint $id"
  } catch { Write-Host "  cleanup failed: $($_.Exception.Message)" -ForegroundColor Yellow }
}

Write-Host "`n=================================================" -ForegroundColor Cyan
Write-Host (" PASS: {0}   FAIL: {1}" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "=================================================" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
