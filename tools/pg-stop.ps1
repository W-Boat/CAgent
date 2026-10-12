<#
  Stop the portable PostgreSQL instance.

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools/pg-stop.ps1
#>
$ErrorActionPreference = "Stop"

$Root   = Split-Path -Parent $PSScriptRoot
$PgBin  = Join-Path $Root "pgsql\bin"
$PgData = Join-Path $Root "pgdata"
$Port   = 5432

$PgCtl = Join-Path $PgBin "pg_ctl.exe"

# pg_ctl stop also needs the restricted token, so signal the process instead.
$pidFile = Join-Path $PgData "postmaster.pid"
if (-not (Test-Path $pidFile)) { Write-Host "[pg] not running (no postmaster.pid)"; exit 0 }

$serverPid = (Get-Content $pidFile -TotalCount 1).Trim()
$proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if (-not $proc) {
  Write-Host "[pg] stale pid file, removing"
  Remove-Item -Force $pidFile
  exit 0
}

Write-Host "[pg] stopping pid $serverPid (fast shutdown) ..." -ForegroundColor Cyan
& (Join-Path $PgBin "pg_ctl.exe") -D $PgData -m fast stop *> $null

# fall back to a hard kill if pg_ctl could not do it
Start-Sleep -Seconds 3
if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
  Write-Host "[pg] pg_ctl had no effect, terminating process tree"
  taskkill /PID $serverPid /T /F *> $null
}

if (Test-Path $pidFile) { Remove-Item -Force $pidFile -ErrorAction SilentlyContinue }
Write-Host "[pg] stopped" -ForegroundColor Green