[CmdletBinding()]
param(
    [ValidateRange(1,65535)][int]$WebPort = 8080,
    [ValidateRange(1,65535)][int]$ApiPort = 3001,
    [ValidateRange(1,65535)][int]$DbPort = 55432,
    [string]$ListenAddress = '127.0.0.1',
    [string]$SiteOrigin,
    [ValidatePattern('^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')][string]$AdminEmail = 'admin@cagent.local',
    [string]$KeyBundle,
    [SecureString]$KeyPassphrase,
    [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot 'runtime\node\node.exe'
$data = Join-Path $PSScriptRoot 'data'
if (-not $KeyBundle) {
    $defaultBundle = Join-Path $PSScriptRoot 'provider.cagent-keys'
    if (Test-Path -LiteralPath $defaultBundle -PathType Leaf) { $KeyBundle = $defaultBundle }
}
if (-not $SiteOrigin) {
    if ($ListenAddress -ne '127.0.0.1') { throw 'Specify -SiteOrigin when binding to a LAN address.' }
    $SiteOrigin = if ($WebPort -eq 80) { 'http://127.0.0.1' } else { "http://127.0.0.1:$WebPort" }
}
if (-not (Test-Path -LiteralPath (Join-Path $data '.private-acl'))) {
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $data '/inheritance:r' '/grant:r' "*${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the data directory.' }
    New-Item -ItemType File -Path (Join-Path $data '.private-acl') -Force | Out-Null
}
$setupArgs = @((Join-Path $PSScriptRoot 'setup.cjs'), $WebPort, $ApiPort, $DbPort, $ListenAddress, $SiteOrigin, $AdminEmail.ToLowerInvariant())
if ($KeyBundle) {
    $setupArgs += (Resolve-Path -LiteralPath $KeyBundle).Path
    if (-not $KeyPassphrase) { $KeyPassphrase = Read-Host 'API key bundle passphrase' -AsSecureString }
    $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($KeyPassphrase)
    try {
        $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer) | & $node @setupArgs
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer) }
} else {
    & $node @setupArgs
}
if ($LASTEXITCODE -ne 0) { throw 'Installation failed. Review the output and data\postgres.log.' }
if (-not $NoStart) {
    & $node (Join-Path $PSScriptRoot 'start.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'CAgent failed to start. Review the output and data\runtime-error.log.' }
}
if (Test-Path -LiteralPath (Join-Path $data 'initial-login.txt')) { Write-Host "Initial administrator credentials: $data\initial-login.txt" }
