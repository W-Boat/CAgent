@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Database.ps1" %*
set "cagent_result=%ERRORLEVEL%"
if not "%cagent_result%"=="0" echo CAgent database update failed. See the output above.
if "%~1"=="" pause
exit /b %cagent_result%
