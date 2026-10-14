# copilot-customizations.contract.ps1 - Copilot harness customization contract.
#
# Verifies that reusable repository workflows use Agent Skills, that every
# required skill can be discovered, and that active automation no longer
# points at prompt files that the Copilot harness does not load.

[CmdletBinding()]
param(
    [ValidateSet('Index', 'Head')]
    [string]$GitTree = 'Index'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failures = @()

function Invoke-Assert {
    param(
        [Parameter(Mandatory)] [string]$Description,
        [Parameter(Mandatory)] [bool]$Condition
    )

    if ($Condition) {
        Write-Host "  PASS: $Description" -ForegroundColor Green
    }
    else {
        Write-Host "  FAIL: $Description" -ForegroundColor Red
        $script:failures += $Description
    }
}

function ConvertFrom-SkillFrontmatter {
    param([Parameter(Mandatory)] [string]$Frontmatter)

    $values = @{}
    foreach ($line in ($Frontmatter -split '\r?\n')) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        if ($line -notmatch '^(?<key>[A-Za-z][A-Za-z0-9-]*):\s*(?<value>.+)$') {
            throw "unsupported YAML line '$line'"
        }

        $key = $Matches['key']
        $rawValue = $Matches['value'].Trim()
        $firstCharacter = $rawValue.Substring(0, 1)
        if ($firstCharacter -in @("'", '"')) {
            if ($rawValue.Length -lt 2 -or $rawValue.Substring($rawValue.Length - 1, 1) -ne $firstCharacter) {
                throw "unterminated quoted scalar for '$key'"
            }
            $value = $rawValue.Substring(1, $rawValue.Length - 2)
        }
        else {
            if ($rawValue -match ':\s' -or $rawValue -match '\s#') {
                throw "plain scalar for '$key' contains YAML syntax and must be quoted"
            }
            $value = $rawValue
        }

        if ($values.ContainsKey($key)) {
            throw "duplicate frontmatter key '$key'"
        }
        $values[$key] = $value
    }

    return $values
}

$treeFiles = if ($GitTree -eq 'Head') {
    @(git -C $repoRoot ls-tree -r --name-only HEAD)
}
else {
    @(git -C $repoRoot ls-files --cached)
}
if ($LASTEXITCODE -ne 0) {
    throw "Unable to enumerate Git $GitTree tree."
}
$treePrefix = if ($GitTree -eq 'Head') { 'HEAD:' } else { ':' }

function Get-TreeFileContent {
    param([Parameter(Mandatory)] [string]$Path)

    $lines = @(& git -C $repoRoot show "$treePrefix$Path" 2>$null)
    if ($LASTEXITCODE -ne 0) {
        return $null
    }
    return [string]::Join("`n", $lines)
}

function Test-TreePath {
    param([Parameter(Mandatory)] [string]$Path)

    $normalizedPath = $Path.Replace('\', '/').TrimEnd('/')
    return (
        $treeFiles -contains $normalizedPath -or
        @($treeFiles | Where-Object { $_.StartsWith("$normalizedPath/", [StringComparison]::Ordinal) }).Count -gt 0
    )
}

$requiredSkills = @(
    'addmissingtests',
    'apicontractverification',
    'auditagainstrfc',
    'auditandupdatedocs',
    'bundlebudgetaudit',
    'codereviewselfaudit',
    'crossbackendparityaudit',
    'deepideaevaluation',
    'dependencycvesweep',
    'deployandpromote',
    'devdeploymentpipeline',
    'endpointconfigflagaudit',
    'entra-gallery-scim-e2e',
    'error-handling-verification',
    'fullvalidationpipeline',
    'gatestrategyselfaudit',
    'generatecommitmessage',
    'lintandstaticanalysis',
    'logging-verification',
    'performancebenchmark',
    'planselection',
    'playwrightspechygieneaudit',
    'prismamigrationaudit',
    'promptchainarchitecture',
    'runphaseworkflow',
    'runphaseworkflowenterprise',
    'runphaseworkflowmvp',
    'securityaudit',
    'securitybestpracticesintake',
    'selfimprovingtask',
    'session-startup',
    'sessionwrapup',
    'standupstatus',
    'syncfabric-scimserver-auth-evolution',
    'uitestandvalidation',
    'updateprojecthealth'
)

$explicitOnlySkills = $requiredSkills |
    Where-Object { $_ -ne 'entra-gallery-scim-e2e' }

Write-Host 'Copilot harness customization contract'
Write-Host "  Repository: $repoRoot"
Write-Host "  Git tree:   $GitTree"

Invoke-Assert -Description '.github/skills exists in the selected Git tree' `
    -Condition (Test-TreePath '.github/skills')

$promptFiles = @(
    $treeFiles | Where-Object { $_ -like '*.prompt.md' }
)
Invoke-Assert -Description 'no legacy *.prompt.md files remain' -Condition ($promptFiles.Count -eq 0)
if ($promptFiles.Count -gt 0) {
    $promptFiles | ForEach-Object {
        Write-Host "    Legacy prompt: $_" -ForegroundColor DarkYellow
    }
}

foreach ($skillName in $requiredSkills) {
    $skillPath = ".github/skills/$skillName/SKILL.md"
    $exists = Test-TreePath $skillPath
    Invoke-Assert -Description "skill '$skillName' has SKILL.md" -Condition $exists
    if (-not $exists) {
        continue
    }

    $content = Get-TreeFileContent $skillPath
    $frontmatterMatch = [regex]::Match(
        $content,
        '\A---\r?\n(?<frontmatter>.*?)\r?\n---(?:\r?\n|$)',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    Invoke-Assert -Description "skill '$skillName' has YAML frontmatter" `
        -Condition $frontmatterMatch.Success
    if (-not $frontmatterMatch.Success) {
        continue
    }

    $frontmatter = $frontmatterMatch.Groups['frontmatter'].Value
    $frontmatterValues = $null
    try {
        $frontmatterValues = ConvertFrom-SkillFrontmatter $frontmatter
        Invoke-Assert -Description "skill '$skillName' has valid flat YAML frontmatter" -Condition $true
    }
    catch {
        Invoke-Assert -Description "skill '$skillName' has valid flat YAML frontmatter" -Condition $false
        Write-Host "    $($_.Exception.Message)" -ForegroundColor DarkYellow
        continue
    }

    $declaredName = [string]$frontmatterValues['name']

    Invoke-Assert -Description "skill '$skillName' name matches its directory" `
        -Condition ($declaredName -ceq $skillName)
    Invoke-Assert -Description "skill '$skillName' name uses portable characters" `
        -Condition ($declaredName -cmatch '^[a-z0-9-]{1,64}$')
    Invoke-Assert -Description "skill '$skillName' has a description" `
        -Condition (-not [string]::IsNullOrWhiteSpace([string]$frontmatterValues['description']))
    Invoke-Assert -Description "skill '$skillName' omits prompt-only frontmatter" `
        -Condition ((@('agent', 'mode', 'model', 'tools') |
            Where-Object { $frontmatterValues.ContainsKey($_) }).Count -eq 0)
    $body = $content.Substring($frontmatterMatch.Length)
    Invoke-Assert -Description "skill '$skillName' body is not wrapped in a legacy prompt fence" `
        -Condition ($body -notmatch '(?m)^```prompt\s*$')

    if ($skillName -in $explicitOnlySkills) {
        Invoke-Assert -Description "migrated skill '$skillName' remains explicit-only" `
            -Condition ([string]$frontmatterValues['disable-model-invocation'] -eq 'true')
    }
}

$addMissingWorkflow = Get-TreeFileContent '.github/skills/addmissingtests/references/workflow.md'
Invoke-Assert -Description 'addmissingtests self-updates its executable workflow resource' `
    -Condition (
        $addMissingWorkflow -match '\.github/skills/addmissingtests/references/workflow\.md' -and
        $addMissingWorkflow -notmatch 'apply them directly to this file \(`\.github/skills/addmissingtests/SKILL\.md`\)'
    )

$apiContractWorkflow = Get-TreeFileContent '.github/skills/apicontractverification/references/workflow.md'
Invoke-Assert -Description 'apicontractverification self-updates and stages its executable workflow resource' `
    -Condition (
        $apiContractWorkflow -match '\.github/skills/apicontractverification/references/workflow\.md' -and
        $apiContractWorkflow -notmatch 'git add \.github/skills/apicontractverification/SKILL\.md'
    )

$syncFabricWorkflow = Get-TreeFileContent '.github/skills/syncfabric-scimserver-auth-evolution/references/workflow.md'
Invoke-Assert -Description 'SyncFabric workflow inventories skills rather than deleted prompts' `
    -Condition (
        $syncFabricWorkflow -match '\.github[\\/]skills[\\/]' -and
        $syncFabricWorkflow -notmatch '\.github[\\/]prompts[\\/]'
    )
Invoke-Assert -Description 'SyncFabric workflow evolves skillVersion metadata' `
    -Condition (
        $syncFabricWorkflow -match 'increment the skill version' -and
        $syncFabricWorkflow -notmatch 'increment the prompt version'
    )
Invoke-Assert -Description 'SyncFabric guide-only boundary permits its repository-owned resources without unrelated writes' `
    -Condition (
        $syncFabricWorkflow -match 'repository-owned skill resources are an explicit exception' -and
        $syncFabricWorkflow -match 'only under `\.github/skills/syncfabric-scimserver-auth-evolution/`' -and
        $syncFabricWorkflow -match 'do not otherwise modify either source repository'
    )

$tenantMigrationPlan = Get-TreeFileContent 'docs/TENANT_09_MIGRATION_PLAN.md'
Invoke-Assert -Description 'tenant migration plan names Agent Skills at cutover' `
    -Condition ($tenantMigrationPlan -notmatch 'both prompt files')

$agenticPlan = Get-TreeFileContent 'docs/agentic/AGENTIC_ENGINEERING_ANALYSIS_AND_ADOPTION.md'
Invoke-Assert -Description 'active agentic plan governs Agent Skill lifecycle' `
    -Condition (
        $agenticPlan -notmatch 'new prompt requires' -and
        $agenticPlan -notmatch 'Retiring a prompt requires'
    )

$skillMarkdownFiles = @($treeFiles | Where-Object {
    $_.StartsWith('.github/skills/', [StringComparison]::Ordinal) -and
    $_.EndsWith('.md', [StringComparison]::OrdinalIgnoreCase)
})
foreach ($markdownFile in $skillMarkdownFiles) {
    $content = Get-TreeFileContent $markdownFile
    $relativeLinks = [regex]::Matches($content, '\]\((?<target>[^)]+)\)') |
        ForEach-Object { $_.Groups['target'].Value.Trim() } |
        Where-Object {
            $_ -notmatch '^(?:https?://|mailto:|#)' -and
            $_ -notmatch '[<>{}|*]' -and
            $_ -notmatch '^(?:path(?:#|$)|[\[$])'
        }

    foreach ($relativeLink in $relativeLinks) {
        $pathPart = ($relativeLink -split '#', 2)[0]
        if ([string]::IsNullOrWhiteSpace($pathPart)) {
            continue
        }

        $markdownDirectory = Split-Path -Parent $markdownFile
        $absolutePath = [IO.Path]::GetFullPath(
            (Join-Path $repoRoot (Join-Path $markdownDirectory $pathPart))
        )
        $resolvedPath = [IO.Path]::GetRelativePath($repoRoot, $absolutePath).Replace('\', '/')
        Invoke-Assert -Description "relative link '$relativeLink' resolves from '$markdownFile'" `
            -Condition (Test-TreePath $resolvedPath)
    }
}

$activeLegacyReferencePrefixes = @(
    '.github/',
    'scripts/',
    'api/test/e2e/',
    'web/'
)
$activeLegacyReferences = @()
foreach ($path in $treeFiles) {
    if ($path -eq 'scripts/test/copilot-customizations.contract.ps1') {
        continue
    }
    if (@($activeLegacyReferencePrefixes | Where-Object {
        $path.StartsWith($_, [StringComparison]::Ordinal)
    }).Count -eq 0) {
        continue
    }

    $content = Get-TreeFileContent $path
    if ($null -ne $content -and $content -match '(\.github[\\/]prompts|\.prompt\.md|#prompt:)') {
        $activeLegacyReferences += $path
    }
}
Invoke-Assert -Description 'active automation has no legacy prompt references' `
    -Condition ($activeLegacyReferences.Count -eq 0)
if ($activeLegacyReferences.Count -gt 0) {
    $activeLegacyReferences | Sort-Object -Unique | ForEach-Object {
        Write-Host "    Legacy reference: $_" -ForegroundColor DarkYellow
    }
}

$gateWalker = Get-TreeFileContent 'scripts/run-all-gates.ps1'
Invoke-Assert -Description 'gate walker registers SkillPath entries' `
    -Condition ($gateWalker -match '\bSkillPath\s*=')
Invoke-Assert -Description 'gate walker has no PromptPath entries' `
    -Condition ($gateWalker -notmatch '\bPromptPath\s*=')
Invoke-Assert -Description 'gate walker records skill acknowledgement state' `
    -Condition ($gateWalker -match 'SKILL_NOT_ACKNOWLEDGED')

$prePushChecks = Get-TreeFileContent 'scripts/pre-push-checks.ps1'
Invoke-Assert -Description 'pre-push validates the pushed HEAD customization tree' `
    -Condition (
        $prePushChecks -match 'copilot-customizations\.contract\.ps1' -and
        $prePushChecks -match '-GitTree Head'
    )

Write-Host ''
if ($failures.Count -eq 0) {
    Write-Host 'All Copilot customization contract assertions passed.' -ForegroundColor Green
    exit 0
}

Write-Host "$($failures.Count) contract assertion(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
exit 1
