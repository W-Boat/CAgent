[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$InputJson,
    [Parameter(Mandatory=$true)][string]$OutputBundle,
    [SecureString]$KeyPassphrase
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $InputJson).Path
$destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputBundle)
if (-not $KeyPassphrase) { $KeyPassphrase = Read-Host 'Create a transfer passphrase (at least 12 characters)' -AsSecureString }
$buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($KeyPassphrase)
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer) | & (Join-Path $PSScriptRoot 'runtime\node\node.exe') `
        (Join-Path $PSScriptRoot 'keys.cjs') $source $destination
    if ($LASTEXITCODE -ne 0) { throw 'Could not create encrypted API key bundle.' }
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer) }
