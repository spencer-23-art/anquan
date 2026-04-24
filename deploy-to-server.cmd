@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1" %*
if errorlevel 1 (
  echo.
  echo Deploy failed. Check the message above.
  pause
  exit /b 1
)
echo.
echo Deploy finished.
pause
