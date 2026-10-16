[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($RepositoryRoot)
$paths = @($root, (Join-Path $root 'api'), (Join-Path $root 'web'))
$paths += @($paths | ForEach-Object { Join-Path $_ 'node_modules' })

foreach ($path in $paths) {
    try {
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    } catch [System.Management.Automation.ItemNotFoundException] {
        if ($path -eq $root) {
            throw "Dependency ownership: repository root '$root' must exist as a physical directory."
        }
        Write-Host "Dependency ownership ABSENT: $path. Existing missing-dependency prerequisites still apply; nothing was installed."
        continue
    }
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Dependency ownership: linked directory '$path' is refused before validation. Use private physical dependencies verified against this checkout's manifests and lockfiles. No linked target was modified."
    }
    if (-not $item.PSIsContainer) {
        throw "Dependency ownership: '$path' must be a physical directory, not a file."
    }
    Write-Host "Dependency ownership PHYSICAL: $path"
}
