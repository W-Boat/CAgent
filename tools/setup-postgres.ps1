<#
  Set up a portable PostgreSQL instance (no admin rights, no Docker).

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools/setup-postgres.ps1

  Steps:
    - extract .tmp/pgsql.zip  -> ./pgsql
    - initdb                  -> ./pgdata  (trust auth, listen on 127.0.0.1 only)
    - start the instance, create role + database for the app
#>
$ErrorActionPreference = "Stop"

$Root      = Split-Path -Parent $PSScriptRoot
$ZipPath   = Join-Path $Root ".tmp\pgsql.zip"
$PgHome    = Join-Path $Root "pgsql"
$PgData    = Join-Path $Root "pgdata"
$Port      = 5432
$SuperUser = "postgres"
$AppUser   = "cagent"
$AppPass   = "cagent_dev_pwd"
$AppDb     = "cagent"

function Info($m) { Write-Host "[postgres] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[postgres] $m" -ForegroundColor Red; exit 1 }

# ---------- 1. extract ----------
if (-not (Test-Path (Join-Path $PgHome "bin\initdb.exe"))) {
  if (-not (Test-Path $ZipPath)) { Fail "missing $ZipPath - download the binaries first" }
  Info "extracting $ZipPath -> $PgHome ..."
  New-Item -ItemType Directory -Force -Path $PgHome | Out-Null
  & tar.exe -xf $ZipPath -C $PgHome
  if ($LASTEXITCODE -ne 0) { Fail "extract failed (tar exit $LASTEXITCODE)" }

  # the zip has an extra pgsql/ level; flatten it
  $nested = Join-Path $PgHome "pgsql"
  if (Test-Path (Join-Path $nested "bin\initdb.exe")) {
    Info "flattening nested pgsql/ folder"
    Get-ChildItem -Path $nested -Force | ForEach-Object {
      Move-Item -Path $_.FullName -Destination $PgHome -Force
    }
    Remove-Item -Recurse -Force $nested
  }
  if (-not (Test-Path (Join-Path $PgHome "bin\initdb.exe"))) { Fail "bin\initdb.exe not found after extract" }
  Info "extract done"
} else {
  Info "found existing $PgHome, skipping extract"
}

$Bin       = Join-Path $PgHome "bin"
$InitDb    = Join-Path $Bin "initdb.exe"
$PgCtl     = Join-Path $Bin "pg_ctl.exe"
$Psql      = Join-Path $Bin "psql.exe"
$Createdb  = Join-Path $Bin "createdb.exe"
$IsReady   = Join-Path $Bin "pg_isready.exe"

# ---------- 2. initdb ----------
if (-not (Test-Path (Join-Path $PgData "PG_VERSION"))) {
  Info "initdb into $PgData ..."
  & $InitDb -D $PgData -U $SuperUser --auth=trust --auth-local=trust --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { Fail "initdb failed (exit $LASTEXITCODE)" }

  $conf = Join-Path $PgData "postgresql.conf"
  $extra = @(
    "",
    "# ---- CAgent portable instance ----",
    "listen_addresses = '127.0.0.1'",
    "port = $Port",
    "max_connections = 200",
    "shared_buffers = 256MB"
  ) -join "`n"
  Add-Content -Path $conf -Value $extra -Encoding ASCII
  Info "initdb done"
} else {
  Info "found existing $PgData, skipping initdb"
}

# ---------- 3. start ----------
& $IsReady -h 127.0.0.1 -p $Port *> $null
$already = ($LASTEXITCODE -eq 0)

if (-not $already) {
  Info "starting PostgreSQL on port $Port ..."
  $log = Join-Path $PgData "server.log"
  & $PgCtl -D $PgData -l $log -w -t 60 start
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $log) { Get-Content $log -Tail 30 | Write-Host }
    Fail "pg_ctl start failed (exit $LASTEXITCODE)"
  }
  Info "started"
} else {
  Info "PostgreSQL already running"
}
& $IsReady -h 127.0.0.1 -p $Port | Write-Host

# ---------- 4. role + database ----------
Info "ensuring role '$AppUser' and database '$AppDb' ..."
$sql = "DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$AppUser') THEN CREATE ROLE $AppUser LOGIN PASSWORD '$AppPass' CREATEDB; END IF; END `$`$;"
& $Psql -h 127.0.0.1 -p $Port -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c $sql | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "create role failed" }

$dbExists = (& $Psql -h 127.0.0.1 -p $Port -U $SuperUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$AppDb'").Trim()
if ($dbExists -ne "1") {
  & $Createdb -h 127.0.0.1 -p $Port -U $SuperUser -O $AppUser -E UTF8 $AppDb
  if ($LASTEXITCODE -ne 0) { Fail "create database failed" }
  Info "database $AppDb created"
} else {
  Info "database $AppDb already exists"
}

& $Psql -h 127.0.0.1 -p $Port -U $SuperUser -d $AppDb -v ON_ERROR_STOP=1 -c "ALTER SCHEMA public OWNER TO $AppUser;" | Out-Null

# ---------- 5. report ----------
$url = "postgresql://" + $AppUser + ":" + $AppPass + "@127.0.0.1:" + $Port + "/" + $AppDb + "?schema=public"
Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " PostgreSQL is ready" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host " DATABASE_URL = $url"
Write-Host " data dir     = $PgData"
Write-Host " stop         = & '$PgCtl' -D '$PgData' stop"
Write-Host " start        = & '$PgCtl' -D '$PgData' -l '$PgData\server.log' start"
Write-Host ""