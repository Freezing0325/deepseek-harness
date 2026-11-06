@echo off
setlocal
set "PSEXE=powershell"
where pwsh >nul 2>nul && set "PSEXE=pwsh"
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-022.ps1" %*
exit /b %errorlevel%
