$ErrorActionPreference = 'Stop'
$data = Join-Path $PSScriptRoot 'data'
$pidFile = Join-Path $data 'runtime.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'CAgent is stopped.'; return }
$deploymentPid = [int](Get-Content -LiteralPath $pidFile -Raw)
if (-not (Get-Process -Id $deploymentPid -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $pidFile
    Write-Host 'CAgent is stopped.'
    return
}
New-Item -ItemType File -Path (Join-Path $data 'stop.request') -Force | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ((Test-Path -LiteralPath $pidFile) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 400 }
if (Test-Path -LiteralPath $pidFile) { throw 'Timed out while stopping. Review data\runtime-error.log.' }
Write-Host 'CAgent stopped.'
