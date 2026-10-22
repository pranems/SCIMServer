function Invoke-SchemaCacheBindingContract {
    param([string]$BaseUrl, [hashtable]$Headers)

    $script:currentSection = '9z-DS: ResourceType schema-cache bindings'
    $core = 'urn:example:schemas:core:Device'
    $extension = 'urn:example:schemas:extension:ProtectedDevice'
    foreach ($protectedFirst in @($false, $true)) {
        $endpointId = $null
        try {
            $profile = @{
                schemas = @(
                    @{ id = $core; name = 'Device'; attributes = @(
                        @{ name = 'displayName'; type = 'string'; required = $true }
                    ) },
                    @{ id = $extension; name = 'ProtectedDevice'; attributes = @(
                        @{ name = 'hidden'; type = 'string'; returned = 'never' },
                        @{ name = 'password'; type = 'string'; mutability = 'writeOnly' },
                        @{ name = 'serverValue'; type = 'string'; mutability = 'readOnly' },
                        @{ name = 'visible'; type = 'string' }
                    ) }
                )
                resourceTypes = @(
                    @{ id = 'PlainDevice'; name = 'PlainDevice'; endpoint = '/PlainDevices'
                        description = 'Core only'; schema = $core; schemaExtensions = @() },
                    @{ id = 'ProtectedDevice'; name = 'ProtectedDevice'; endpoint = '/ProtectedDevices'
                        description = 'Protected extension'; schema = $core
                        schemaExtensions = @(@{ schema = $extension; required = $false }) }
                )
                serviceProviderConfig = @{
                    patch = @{ supported = $true }; bulk = @{ supported = $false }
                    filter = @{ supported = $true }; changePassword = @{ supported = $false }
                    sort = @{ supported = $true }; etag = @{ supported = $true }
                }
                settings = @{ IgnoreReadOnlyAttributesInPatch = $true }
            }
            $endpoint = Invoke-RestMethod "$BaseUrl/scim/admin/endpoints" -Method POST -Headers $Headers -Body (@{
                name = "live-binding-$([guid]::NewGuid().ToString('N'))"; profile = $profile
            } | ConvertTo-Json -Depth 15)
            $endpointId = $endpoint.id
            $base = "$BaseUrl/scim/endpoints/$endpointId"
            $order = if ($protectedFirst) { @('ProtectedDevices', 'PlainDevices') } else { @('PlainDevices', 'ProtectedDevices') }
            $ids = @{}
            foreach ($path in $order) {
                $body = @{ schemas = @($core); displayName = $path }
                if ($path -eq 'ProtectedDevices') {
                    $body.schemas = @($core, $extension)
                    $body[$extension] = @{
                        hidden = 'synthetic hidden'; password = 'synthetic write-only'
                        serverValue = 'must not persist'; visible = 'public'
                    }
                }
                $created = Invoke-RestMethod "$base/$path" -Method POST -Headers $Headers -Body ($body | ConvertTo-Json -Depth 8)
                $ids[$path] = $created.id
                if ($path -eq 'ProtectedDevices') {
                    Test-Result -Success (($created.$extension | ConvertTo-Json -Compress) -eq '{"visible":"public"}') `
                        -Message "9z-DS: POST hides protected fields and strips readOnly, protected-first=$protectedFirst"
                }
            }
            foreach ($path in ($order + $order)) {
                $read = Invoke-RestMethod "$base/$path/$($ids[$path])" -Headers $Headers
                if ($path -eq 'ProtectedDevices') {
                    Test-Result -Success (($read.$extension | ConvertTo-Json -Compress) -eq '{"visible":"public"}') `
                        -Message "9z-DS: cross-request GET preserves extension rules, protected-first=$protectedFirst"
                    $unexpected = @($read.PSObject.Properties.Name | Where-Object { $_ -notin @('schemas', 'id', 'displayName', 'meta', $extension) })
                    Test-Result -Success ($unexpected.Count -eq 0) -Message '9z-DS: public response key allowlist'
                }
            }
            $resource = "$base/ProtectedDevices/$($ids.ProtectedDevices)"
            $projection = [uri]::EscapeDataString("displayName,${extension}:hidden,${extension}:password,${extension}:visible")
            $read = Invoke-RestMethod "${resource}?attributes=$projection" -Headers $Headers
            Test-Result -Success (($read.$extension | ConvertTo-Json -Compress) -eq '{"visible":"public"}') `
                -Message '9z-DS: explicit attributes cannot disclose hidden/writeOnly fields'
            $list = Invoke-RestMethod "$base/ProtectedDevices" -Headers $Headers
            Test-Result -Success ($list.totalResults -eq 1 -and ($list.Resources[0].$extension | ConvertTo-Json -Compress) -eq '{"visible":"public"}') `
                -Message '9z-DS: list retains values and protection rules'
            $replace = @{ schemas = @($core, $extension); displayName = 'ProtectedDevices' }
            $replace[$extension] = @{ hidden = 'still hidden'; password = 'still write-only'; serverValue = 'PUT must not persist'; visible = 'public' }
            $updated = Invoke-RestMethod $resource -Method PUT -Headers $Headers -Body ($replace | ConvertTo-Json -Depth 8)
            Test-Result -Success (($updated.$extension | ConvertTo-Json -Compress) -eq '{"visible":"public"}') -Message '9z-DS: PUT keeps extension protections'
            $patch = @{ schemas = @('urn:ietf:params:scim:api:messages:2.0:PatchOp'); Operations = @(
                @{ op = 'replace'; path = "${extension}:serverValue"; value = 'PATCH must not persist' },
                @{ op = 'replace'; path = "${extension}:visible"; value = 'public' }
            ) }
            $updated = Invoke-RestMethod $resource -Method PATCH -Headers $Headers -Body ($patch | ConvertTo-Json -Depth 8)
            Test-Result -Success (($updated.$extension | ConvertTo-Json -Compress) -eq '{"visible":"public"}') -Message '9z-DS: PATCH keeps extension protections'
            foreach ($path in $order) {
                $deleted = Invoke-WebRequest "$base/$path/$($ids[$path])" -Method DELETE -Headers $Headers
                Test-Result -Success ($deleted.StatusCode -eq 204) -Message "9z-DS: DELETE $path"
            }
        } catch {
            Test-Result -Success $false -Message "9z-DS: binding regression failed: $($_.Exception.Message)"
        } finally {
            if ($endpointId) {
                try {
                    $null = Invoke-RestMethod "$BaseUrl/scim/admin/endpoints/$endpointId" -Method DELETE -Headers $Headers
                } catch {
                    Test-Result -Success $false -Message "9z-DS: dedicated endpoint cleanup failed: $($_.Exception.Message)"
                }
            }
        }
    }
}
