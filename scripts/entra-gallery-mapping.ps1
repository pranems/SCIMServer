$script:galleryExtensionUrn = 'urn:scimserver:validation:gallery:2.0:User'
$script:galleryExtensionAttribute = 'costCode'

function Add-GalleryUserExtensionProfile {
    param([Parameter(Mandatory)] $Profile)

    $copy = $Profile | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
    $users = @($copy.resourceTypes | Where-Object name -eq 'User')
    if ($users.Count -ne 1) {
        throw 'Expected exactly one User ResourceType for the reviewed gallery extension.'
    }
    if (@($copy.schemas | Where-Object id -eq $script:galleryExtensionUrn).Count -ne 0) {
        throw 'The gallery extension is already registered in the endpoint profile.'
    }
    $copy.schemas = @($copy.schemas) + @(@{
        id = $script:galleryExtensionUrn
        name = 'GalleryValidation'
        description = 'Owned Entra gallery mapping validation'
        attributes = @(@{
            name = $script:galleryExtensionAttribute
            type = 'string'
            multiValued = $false
            required = $false
            mutability = 'readWrite'
            returned = 'default'
            caseExact = $true
            uniqueness = 'none'
        })
    })
    $users[0].schemaExtensions = @($users[0].schemaExtensions) + @(@{
        schema = $script:galleryExtensionUrn
        required = $false
    })
    $copy
}

function Get-GalleryUserMappingContext {
    param([Parameter(Mandatory)] $Schema)

    $rules = @($Schema.synchronizationRules | Where-Object name -eq 'USERGROUP_OUTBOUND_USERGROUP')
    if ($rules.Count -ne 1) {
        throw 'Expected exactly one reviewed gallery synchronization rule.'
    }
    $users = @($rules[0].objectMappings | Where-Object sourceObjectName -eq 'User')
    if ($users.Count -ne 1) {
        throw 'Expected exactly one User mapping for the reviewed gallery extension.'
    }
    $directories = @($Schema.directories | Where-Object name -eq $rules[0].targetDirectoryName)
    $targets = @($directories | ForEach-Object { $_.objects } |
        Where-Object name -eq $users[0].targetObjectName)
    if ($directories.Count -ne 1 -or $targets.Count -ne 1) {
        throw 'Expected exactly one target directory and User object definition.'
    }
    @{ UserMapping = $users[0]; Target = $targets[0] }
}

function Add-GalleryCustomUserMapping {
    param([Parameter(Mandatory)] $Schema)

    $copy = $Schema | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
    $context = Get-GalleryUserMappingContext -Schema $copy
    $user = $context.UserMapping
    $target = $context.Target

    $targetName = "${script:galleryExtensionUrn}:$script:galleryExtensionAttribute"
    if (@($target.attributes | Where-Object name -eq $targetName).Count -ne 0 -or
        @($user.attributeMappings | Where-Object targetAttributeName -eq $targetName).Count -ne 0) {
        throw 'The custom gallery target is already registered.'
    }
    $department = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department'
    $attributes = @($target.attributes | Where-Object name -eq $department)
    $mappings = @($user.attributeMappings | Where-Object targetAttributeName -eq $department)
    if ($attributes.Count -ne 1 -or $mappings.Count -ne 1 -or
        $attributes[0].type -ne 'String' -or $mappings[0].source.name -ne 'department') {
        throw 'Expected the reviewed scalar department attribute and source mapping.'
    }
    $attribute = $attributes[0] | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
    $attribute.name = $targetName
    $attribute.anchor = $false
    $attribute.required = $false
    $attribute.caseExact = $true
    $mapping = $mappings[0] | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
    $mapping.targetAttributeName = $targetName
    $target.attributes = @($target.attributes) + @($attribute)
    $user.attributeMappings = @($user.attributeMappings) + @($mapping)
    $copy
}

function Assert-GalleryCustomUserMapping {
    param([Parameter(Mandatory)] $Schema)

    $context = Get-GalleryUserMappingContext -Schema $Schema
    $targetName = "${script:galleryExtensionUrn}:$script:galleryExtensionAttribute"
    $attributes = @($context.Target.attributes | Where-Object name -eq $targetName)
    $mappings = @($context.UserMapping.attributeMappings | Where-Object targetAttributeName -eq $targetName)
    if ($attributes.Count -ne 1 -or $mappings.Count -ne 1 -or
        $attributes[0].type -ne 'String' -or
        $attributes[0].caseExact -ne $true -or
        $mappings[0].source.name -ne 'department' -or
        $mappings[0].source.expression -ne '[department]') {
        throw 'Custom gallery mapping read-back does not match the reviewed target and source expression.'
    }
}
