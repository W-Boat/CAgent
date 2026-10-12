<#
  Start the portable PostgreSQL instance.

  Why not `pg_ctl start`?  On Windows, pg_ctl creates a restricted token and a job
  object for the server process.  Inside the DSH sandbox that call fails with
  "could not create restricted token: error code 87".  Starting postgres.exe
  directly (detached via Start-Process) avoids the restricted token entirely.

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools/pg-start.ps1
#>
$ErrorActionPreference = "Stop"

$Root   = Split-Path -Parent $PSScriptRoot
$PgBin  = Join-Path $Root "pgsql\bin"
$PgData = Join-Path $Root "pgdata"
$Port   = 5432

function Info($m) { Write-Host "[pg] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[pg] $m" -ForegroundColor Red; exit 1 }

$IsReady = Join-Path $PgBin "pg_isready.exe"
& $IsReady -h 127.0.0.1 -p $Port *> $null
if ($LASTEXITCODE -eq 0) { Info "already running on port $Port"; exit 0 }

# remove a stale pid file left behind by a killed server
$pidFile = Join-Path $PgData "postmaster.pid"
if (Test-Path $pidFile) {
  $stale = (Get-Content $pidFile -TotalCount 1).Trim()
  $alive = Get-Process -Id $stale -ErrorAction SilentlyContinue
  if (-not $alive) {
    Info "removing stale postmaster.pid (pid $stale)"
    Remove-Item -Force $pidFile
  } else {
    <#
      The pid looks alive, yet the port is closed -- almost certainly **pid reuse**:
      postgres exited long ago and its number was handed to an unrelated process.

      The pid file is still stale and must be removed, otherwise postgres refuses
      to start, claiming "another instance is already running".  This branch used
      to Fail outright, which is misleading: it makes you believe a postgres is
      running, so you go debug "why can't I connect" when the real cause is simply
      that nothing was ever started.

      The port is the authoritative signal: pg_isready above already confirmed it
      is closed, and a live postgres always holds its port -- so reaching here
      means it is not serving.

      NOTE: keep this file ASCII-only.  It is launched via Windows PowerShell 5.1
      (`powershell -NoProfile ...`), which reads .ps1 as ANSI unless there is a
      BOM -- non-ASCII comments get mangled into stray quotes and break parsing.
    #>
    Info "postmaster.pid points at pid $stale (process exists but port is closed -> pid reuse); removing as stale"
    Remove-Item -Force $pidFile
  }
}

$log = Join-Path $PgData "server.log"
Info "starting postgres.exe on port $Port ..."
$p = Start-Process -FilePath (Join-Path $PgBin "postgres.exe") `
                   -ArgumentList @("-D", $PgData, "-p", "$Port") `
                   -RedirectStandardOutput $log `
                   -RedirectStandardError (Join-Path $PgData "server.err.log") `
                   -WindowStyle Hidden -PassThru

# wait for readiness
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  & $IsReady -h 127.0.0.1 -p $Port *> $null
  if ($LASTEXITCODE -eq 0) {
    Info "ready after $([math]::Round(($i+1)*0.5,1))s (pid $($p.Id))"
    exit 0
  }
  if ($p.HasExited) {
    if (Test-Path $log) { Get-Content $log -Tail 30 | Write-Host }
    Fail "postgres.exe exited with code $($p.ExitCode)"
  }
}
Fail "timed out waiting for PostgreSQL to accept connections"