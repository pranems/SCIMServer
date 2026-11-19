[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [ValidateScript({ $_ -notlike 'docker-desktop*' })]
    [string]$Distribution,
    [ValidateRange(1024, 65535)]
    [int]$SshPort = 22222,
    [ValidatePattern('^(?!root$)[a-z_][a-z0-9_-]*$')]
    [string]$SshUser = 'scimruntime'
)

$ErrorActionPreference = 'Stop'
wsl --distribution $Distribution --user root --exec /bin/sh -lc 'systemctl start docker && install -d -m 755 /run/sshd'
if ($LASTEXITCODE -ne 0) {
    throw 'The selected WSL Engine failed to start or prepare its SSH runtime directory.'
}

Write-Host 'Keep this terminal open while using the selected Engine. Stop owned Compose workloads before closing it.'
wsl --distribution $Distribution --user root --exec /usr/sbin/sshd -D -e -p $SshPort `
    -o ListenAddress=127.0.0.1 `
    -o PasswordAuthentication=no `
    -o KbdInteractiveAuthentication=no `
    -o PermitRootLogin=no `
    -o "AllowUsers=$SshUser" `
    -o "PidFile=/run/scimserver-engine-$SshPort-sshd.pid"
if ($LASTEXITCODE -ne 0) {
    throw 'The selected Engine SSH transport failed. Check the port, host keys and approved local account; no fallback runtime was started.'
}
