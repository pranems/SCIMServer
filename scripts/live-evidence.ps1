# Evidence copies only. The HTTP runner retains the original bodies and responses.
# Apply the prepared ordered plan without a PowerShell loop for every text field.
if (-not ('ScimServer.LiveEvidence.PreparedReplacements' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text.RegularExpressions;

namespace ScimServer.LiveEvidence
{
    public sealed class PreparedReplacements
    {
        private readonly object[] entries;

        public PreparedReplacements(object[] entries)
        {
            this.entries = (object[])entries.Clone();
        }

        public string Apply(string text)
        {
            foreach (object entry in entries)
            {
                if (entry is Regex pattern)
                    text = pattern.Replace(text, "[REDACTED]");
                else
                    text = text.Replace((string)entry, "[REDACTED]");
            }
            return text;
        }
    }
}
'@
}

function Initialize-LiveEvidence {
    param([string[]]$Secrets = @())
    # Nested script calls change $script scope; share the root flow's run state.
    $global:__ScimServerLiveEvidenceSecrets = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $global:__ScimServerLiveEvidencePreparation = @{ MaterialCount = -1; Replacements = $null }
    foreach ($secret in $Secrets) {
        if ($secret) { $null = $global:__ScimServerLiveEvidenceSecrets.Add($secret) }
    }
}

function Test-LiveEvidenceSecretKey {
    param([string]$Key)
    # Match material, not metadata such as credentialId or issuedTokenTtlSec.
    return $Key -match '^(?:.*[-_])?(?:secret|password|passwd|pwd|token|access_token|refresh_token|id_token|client_secret|client_assertion|assertion|authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|passphrase|jwt|bearer)$|^(?:clientSecret|secretToken|bearerToken|sharedSecret|accessToken|refreshToken|idToken|clientAssertion|secretEnvelope|secretHash|credentialHash|privateKey|signingKey|x-api-key)$'
}

function Add-LiveEvidenceSecret {
    param($Value)
    if ($Value -is [string]) {
        if (-not $Value -or $Value -ceq '[REDACTED]') { return }
        $null = $global:__ScimServerLiveEvidenceSecrets.Add($Value)
        if ($Value -match '^(?:Bearer|Basic)\s+(.+)$') {
            Add-LiveEvidenceSecret $Matches[1]
        }
    } elseif ($Value -is [System.Collections.IDictionary]) {
        foreach ($key in $Value.PSBase.Keys) { Add-LiveEvidenceSecret $Value[$key] }
    } elseif ($Value -is [System.Collections.IEnumerable]) {
        foreach ($item in $Value) { Add-LiveEvidenceSecret $item }
    } elseif ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) { Add-LiveEvidenceSecret $property.Value }
    }
}

function Add-LiveEvidenceUserInfo {
    param([string]$Raw, [string]$Decoded)
    if ($Raw -ceq '[REDACTED]' -or $Decoded -ceq '[REDACTED]') { return }
    $decodedSeparator = $Decoded.IndexOf(':')
    # Username-only authorities are masked, but their account metadata is not
    # secret material. Full user:password credentials and passwords are.
    if ($decodedSeparator -lt 0) { return }
    Add-LiveEvidenceSecret $Raw
    Add-LiveEvidenceSecret $Decoded
    $separator = $Raw.IndexOf(':')
    if ($separator -ge 0) {
        Add-LiveEvidenceSecret ($Raw.Substring($separator + 1))
    }
    Add-LiveEvidenceSecret ($Decoded.Substring($decodedSeparator + 1))
}

function Convert-LiveEvidenceText {
    param([AllowEmptyString()][string]$Text)
    # Discover authority credentials before masking them, so the second copy
    # also protects earlier siblings that echo userinfo or its password.
    if ($Text.Contains('://')) {
        $Text = [regex]::Replace($Text, '(?<scheme>[A-Za-z][A-Za-z0-9+.-]*://)(?<userinfo>[^/\s?#@]+)@', {
            param($match)
            $raw = $match.Groups['userinfo'].Value
            Add-LiveEvidenceUserInfo -Raw $raw -Decoded ([Uri]::UnescapeDataString($raw))
            return $match.Groups['scheme'].Value + '[REDACTED]@'
        })
    }
    # Free text, URLs and form assignments use the same exact material-key policy.
    $assignment = '(?<![\w%.-])["'']?(?<key>(?>[\w%.-]+))["'']?\s*(?<separator>=|:)'
    $assignments = @()
    if ($Text.Contains('=') -or $Text.Contains(':')) {
        $assignments = [regex]::Matches($Text, $assignment)
    }
    for ($index = $assignments.Count - 1; $index -ge 0; $index--) {
        $match = $assignments[$index]
        $key = [Uri]::UnescapeDataString($match.Groups['key'].Value)
        if (Test-LiveEvidenceSecretKey $key) {
            $tail = $Text.Substring($match.Index + $match.Length)
            $value = [regex]::Match($tail, '^\s*(?:"(?:\\.|[^"])*"|''[^'']*''|[^\s&;,#]+)')
            $raw = $value.Value.Trim().Trim('"', "'")
            Add-LiveEvidenceSecret ([Uri]::UnescapeDataString($raw.Replace('+', ' ')))
            $Text = $Text.Substring(0, $match.Index) +
                $match.Groups['key'].Value + $match.Groups['separator'].Value + '[REDACTED]' +
                $tail.Substring($value.Length)
        }
    }
    if ($Text.IndexOf('Bearer', [StringComparison]::CurrentCultureIgnoreCase) -ge 0 -or
        $Text.IndexOf('Basic', [StringComparison]::CurrentCultureIgnoreCase) -ge 0) {
        $Text = [regex]::Replace($Text, '(?i)\b(?<scheme>Bearer|Basic)\s+(?<material>[A-Za-z0-9._~+/=\[\]-]+)', {
            param($match)
            $material = $match.Groups['material'].Value
            Add-LiveEvidenceSecret $match.Value
            if ($match.Groups['scheme'].Value -ieq 'Basic' -and
                $material -match '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$') {
                $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($material))
                Add-LiveEvidenceUserInfo -Raw $decoded -Decoded $decoded
            }
            return '[REDACTED]'
        })
    }
    # Material only grows within a run. Rebuild encoding and regex preparation
    # after discovery, not for every field in both evidence-copy passes.
    if ($global:__ScimServerLiveEvidencePreparation.MaterialCount -ne $global:__ScimServerLiveEvidenceSecrets.Count) {
        $replacements = [System.Collections.Generic.List[object]]::new()
        foreach ($secret in @($global:__ScimServerLiveEvidenceSecrets | Sort-Object Length -Descending)) {
            foreach ($variant in @($secret, [Uri]::EscapeDataString($secret), [System.Net.WebUtility]::UrlEncode($secret), (ConvertTo-Json -InputObject $secret -Compress).Trim('"'))) {
                if ($variant.Contains('%')) {
                    $pattern = [regex]::Replace([regex]::Escape($variant), '%[0-9A-Fa-f]{2}', {
                        param($escape) return '(?i:' + $escape.Value + ')'
                    })
                    $replacements.Add([regex]::new($pattern))
                } elseif ($variant) {
                    $replacements.Add($variant)
                }
            }
        }
        $global:__ScimServerLiveEvidencePreparation = @{
            MaterialCount = $global:__ScimServerLiveEvidenceSecrets.Count
            Replacements = [ScimServer.LiveEvidence.PreparedReplacements]::new($replacements.ToArray())
        }
    }
    return $global:__ScimServerLiveEvidencePreparation.Replacements.Apply($Text)
}

function Copy-LiveEvidenceValue {
    param($Value, [System.Collections.Generic.List[object]]$Ancestors, [int]$Depth = 0)
    if ($Depth -gt 60) { throw 'Live evidence exceeds the supported nesting depth.' }
    if ($null -eq $Value) { return $null }
    if ($Value -is [byte[]]) {
        try { $Value = [Text.UTF8Encoding]::new($false, $true).GetString($Value) }
        catch { return [ordered]@{ _evidenceError = 'Invalid UTF8 body'; byteCount = $Value.Length } }
    }
    if ($Value -is [string]) {
        if ($Value -ceq '[REDACTED]') { return $Value }
        $trimmed = $Value.TrimStart()
        if ($trimmed.StartsWith('{') -or $trimmed.StartsWith('[') -or $trimmed.StartsWith('"')) {
            try { $decoded = ConvertFrom-Json -InputObject $Value -Depth 60 -NoEnumerate -ErrorAction Stop }
            catch { return [ordered]@{ _evidenceError = 'Invalid JSON body'; characterCount = $Value.Length } }
            if ($decoded -is [string]) {
                return ConvertTo-Json -InputObject (Convert-LiveEvidenceText $decoded) -Compress
            }
            return Copy-LiveEvidenceValue $decoded $Ancestors ($Depth + 1)
        }
        return Convert-LiveEvidenceText $Value
    }
    if ($Value -is [ValueType]) { return $Value }
    foreach ($ancestor in $Ancestors) {
        if ([object]::ReferenceEquals($ancestor, $Value)) { throw 'Live evidence body contains a cycle.' }
    }
    $Ancestors.Add($Value)
    try {
        if ($Value -is [System.Collections.IDictionary] -or
            ($Value -is [pscustomobject] -and $Value -isnot [System.Collections.IEnumerable])) {
            $copy = [ordered]@{}
            $keys = if ($Value -is [System.Collections.IDictionary]) { @($Value.PSBase.Keys) } else { @($Value.PSObject.Properties.Name) }
            foreach ($key in $keys) {
                if ($Value -is [System.Collections.IDictionary]) {
                    $item = $Value[$key]
                } else {
                    $item = $Value.PSObject.Properties[$key].Value
                }
                if (Test-LiveEvidenceSecretKey $key) {
                    # Validate first so a cycle cannot bypass the explicit shape error.
                    $null = Copy-LiveEvidenceValue $item $Ancestors ($Depth + 1)
                    Add-LiveEvidenceSecret $item
                    $copy[$key] = '[REDACTED]'
                } else {
                    $copy[$key] = Copy-LiveEvidenceValue $item $Ancestors ($Depth + 1)
                }
            }
            return $copy
        }
        if ($Value -is [System.Collections.IEnumerable]) {
            $copy = [System.Collections.Generic.List[object]]::new()
            foreach ($item in $Value) { $copy.Add((Copy-LiveEvidenceValue $item $Ancestors ($Depth + 1))) }
            return ,$copy.ToArray()
        }
        throw 'Live evidence body has an unsupported object type.'
    } finally {
        $Ancestors.RemoveAt($Ancestors.Count - 1)
    }
}

function ConvertTo-LiveEvidence {
    param($Value)
    if ($null -eq $global:__ScimServerLiveEvidenceSecrets) { throw 'Live evidence redaction is not initialized.' }
    # Discover all material before copying again: an earlier diagnostic can echo
    # a secret declared in a later sibling, without mutating the caller's object.
    $null = Copy-LiveEvidenceValue $Value ([System.Collections.Generic.List[object]]::new())
    $copy = Copy-LiveEvidenceValue $Value ([System.Collections.Generic.List[object]]::new())
    return ,$copy
}

function ConvertTo-LiveEvidenceJson {
    param($Value)
    $safe = ConvertTo-LiveEvidence $Value
    return ConvertTo-Json -InputObject $safe -Depth 60 -ErrorAction Stop
}

function Format-LiveEvidence {
    param($Value, [int]$Limit = 300)
    $safe = ConvertTo-LiveEvidence $Value
    $text = if ($safe -is [string]) { $safe } else { ConvertTo-Json -InputObject $safe -Depth 60 -Compress -ErrorAction Stop }
    if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit - 3) + '...' }
    return $text
}

function Write-LiveEvidenceHost {
    param([string]$Object, [ConsoleColor]$ForegroundColor, [switch]$NoNewline)
    $parameters = @{ Object = Convert-LiveEvidenceText $Object }
    if ($PSBoundParameters.ContainsKey('ForegroundColor')) { $parameters.ForegroundColor = $ForegroundColor }
    if ($NoNewline) { $parameters.NoNewline = $true }
    Write-Host @parameters
}

function Write-LiveEvidenceFailure {
    param([System.Management.Automation.ErrorRecord]$Failure)
    $text = Format-LiveEvidence ([ordered]@{
        message = $Failure.Exception.Message
        detail = $Failure.ErrorDetails.Message
    }) -Limit 2000
    Write-LiveEvidenceHost "Live runner aborted: $text" -ForegroundColor Red
}
