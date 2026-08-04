param([Parameter(Mandatory)][string]$NewVersion)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$rx = '^\s*"version":\s*"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?",\s*$'

# package.json: exactly ONE version line, in the first few lines.
foreach ($f in @('api/package.json', 'web/package.json')) {
    $lines = [System.IO.File]::ReadAllLines($f)
    $n = 0
    for ($i = 0; $i -lt 12; $i++) {
        if ($lines[$i] -match $rx) {
            $lines[$i] = $lines[$i] -replace '"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?"', ('"' + $NewVersion + '"')
            $n++
            break
        }
    }
    [System.IO.File]::WriteAllLines($f, $lines)
    "{0,-26} {1} version line updated" -f $f, $n
}

# package-lock.json: TWO version lines (root + packages[""]), both in the header.
foreach ($f in @('api/package-lock.json', 'web/package-lock.json')) {
    if (-not (Test-Path $f)) { continue }
    $lines = [System.IO.File]::ReadAllLines($f)
    $n = 0
    for ($i = 0; $i -lt 12; $i++) {
        if ($lines[$i] -match $rx) {
            $lines[$i] = $lines[$i] -replace '"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?"', ('"' + $NewVersion + '"')
            $n++
        }
    }
    [System.IO.File]::WriteAllLines($f, $lines)
    "{0,-26} {1} version line(s) updated" -f $f, $n
}
