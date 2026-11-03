# Decoding is diagnostic only, not signature verification or authorization.
function ConvertFrom-JwtSegment {
    param([string] $Segment)
    $s = $Segment.Replace('-', '+').Replace('_', '/')
    switch ($s.Length % 4) { 2 { $s += '==' } 3 { $s += '=' } 1 { $s += '===' } }
    [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($s)) | ConvertFrom-Json
}

function Get-JwtParts {
    param([string] $Jwt)
    $seg = $Jwt.Split('.')
    if ($seg.Count -lt 2) { throw "Not a JWT (expected 3 segments, got $($seg.Count))" }
    [pscustomobject]@{
        Header = ConvertFrom-JwtSegment $seg[0]
        Payload = ConvertFrom-JwtSegment $seg[1]
        Segments = $seg.Count
    }
}
