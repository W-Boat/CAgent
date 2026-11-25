$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot 'runtime\node\node.exe'
& $node (Join-Path $PSScriptRoot 'start.cjs')
if ($LASTEXITCODE -ne 0) { throw 'CAgent failed to start. Review the output and data\runtime-error.log.' }
