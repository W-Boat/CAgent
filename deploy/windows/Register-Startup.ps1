$ErrorActionPreference = 'Stop'
$data = Join-Path $PSScriptRoot 'data'
if (-not (Test-Path -LiteralPath (Join-Path $data 'installed.json'))) { throw 'Run Install.ps1 first.' }
$node = Join-Path $PSScriptRoot 'runtime\node\node.exe'
$entry = Join-Path $PSScriptRoot 'run.cjs'
$installationPath = [Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant())
$sha = [Security.Cryptography.SHA256]::Create()
try { $id = [BitConverter]::ToString($sha.ComputeHash($installationPath)).Replace('-','').Substring(0,12) }
finally { $sha.Dispose() }
$taskName = "CAgent-$id"
$localService = [Security.Principal.SecurityIdentifier]::new('S-1-5-19')
$account = $localService.Translate([Security.Principal.NTAccount]).Value
& icacls.exe $PSScriptRoot '/grant:r' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not grant the startup account read access.' }
& icacls.exe $data '/grant:r' '*S-1-5-19:(OI)(CI)M' '/T' '/Q' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not grant the startup account data access.' }
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $entry + '"') -WorkingDirectory $PSScriptRoot
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
$trigger = New-ScheduledTaskTrigger -AtStartup
& (Join-Path $PSScriptRoot 'Stop.ps1')
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Startup task: $taskName"
