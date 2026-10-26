@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then try again.
  exit /b 1
)
call npm ci
if errorlevel 1 exit /b 1
call npm run build:win
if errorlevel 1 exit /b 1
echo Archivo Fork setup and portable EXE files are in dist\.
echo These test builds are unsigned unless you configured a signing certificate.
endlocal
