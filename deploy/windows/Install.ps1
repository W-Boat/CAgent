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
    [string]$RestoreBundle,
    [SecureString]$RestorePassphrase,
    [switch]$EnableTestAccounts,
    [switch]$SkipTestAccounts,
    [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot 'runtime\node\node.exe'
$data = Join-Path $PSScriptRoot 'data'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'CAgent requires 64-bit Windows.' }
$required = @('runtime\node\node.exe', 'runtime\pgsql\bin\postgres.exe', 'runtime\pgsql\bin\initdb.exe',
    'apps\api\dist\src\main.js', 'apps\api\prisma\schema.prisma', 'apps\web\dist\index.html')
foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) {
        throw "Missing package file: $name. Extract the complete installation package."
    }
}
if (-not $KeyBundle) {
    $defaultBundle = Join-Path $PSScriptRoot 'provider.cagent-keys'
    if (Test-Path -LiteralPath $defaultBundle -PathType Leaf) { $KeyBundle = $defaultBundle }
}
if (-not $RestoreBundle) {
    $defaultRestore = Join-Path $PSScriptRoot 'restore.cagent-backup'
    if (Test-Path -LiteralPath $defaultRestore -PathType Leaf) { $RestoreBundle = $defaultRestore }
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
if ($EnableTestAccounts -and $SkipTestAccounts) { throw 'Select only one test account option.' }
if ($EnableTestAccounts -or (-not $SkipTestAccounts -and $ListenAddress -in @('127.0.0.1', '::1'))) {
    $setupArgs += @('--test-accounts', 'true')
}
$passwords = @{}
if ($KeyBundle) {
    $setupArgs += @('--keys', (Resolve-Path -LiteralPath $KeyBundle).Path)
    if (-not $KeyPassphrase) { $KeyPassphrase = Read-Host 'API key bundle passphrase' -AsSecureString }
    $passwords.keys = $KeyPassphrase
}
if ($RestoreBundle) {
    $restorePath = (Resolve-Path -LiteralPath $RestoreBundle).Path
    $ready = Join-Path $data 'installed.json'
    $setupArgs += @('--restore', $restorePath)
    if (-not (Test-Path -LiteralPath $ready -PathType Leaf)) {
        if (-not $RestorePassphrase) { $RestorePassphrase = Read-Host 'Platform backup passphrase (first install)' -AsSecureString }
        $passwords.restore = $RestorePassphrase
    }
}
if ($KeyBundle -or $RestoreBundle) {
    $inputValues = @{}
    try {
        foreach ($entry in $passwords.GetEnumerator()) {
            $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($entry.Value)
            try { $inputValues[$entry.Key] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer) }
        }
        $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        ($inputValues | ConvertTo-Json -Compress) | & $node @setupArgs
    } finally { $inputValues.Clear() }
} else {
    & $node @setupArgs
}
if ($LASTEXITCODE -ne 0) { throw 'Installation failed. Review the output and data\postgres.log.' }
if (-not $NoStart) {
    & $node (Join-Path $PSScriptRoot 'start.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'CAgent failed to start. Review the output and data\runtime-error.log.' }
}
if (Test-Path -LiteralPath (Join-Path $data 'initial-login.txt')) { Write-Host "Initial administrator credentials: $data\initial-login.txt" }
$testFile = Join-Path $data 'test-accounts.json'
if (Test-Path -LiteralPath $testFile -PathType Leaf) {
    $testUsers = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($testFile))
    foreach ($testUser in $testUsers) {
        $expires = [DateTimeOffset]$testUser.expiresAt
        if ($expires -gt [DateTimeOffset]::UtcNow) {
            $roleName = if ($testUser.role -eq 'super_admin') { 'Test super administrator' } else { 'Test student' }
            Write-Host "$roleName ($($expires.UtcDateTime.ToString('u')))"
            Write-Host "  Email: $($testUser.email)"
            Write-Host "  Password: $($testUser.password)"
        }
    }
    Write-Host "Local test credentials file: $testFile"
}
