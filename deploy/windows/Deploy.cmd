@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
set "cagent_result=%ERRORLEVEL%"
if not "%cagent_result%"=="0" echo CAgent deployment failed. See the output above.
if "%~1"=="" pause
exit /b %cagent_result%
