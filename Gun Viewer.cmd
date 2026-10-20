@echo off
rem One-click launcher: installs Electron on first run, then opens the viewer.
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)
if not exist "models" (
  echo No "models" folder yet. Extract the models first: see docs\EXTRACTION.md
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" . --focus %*
