@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to start Gem Coder.
  echo Ask your instructor for help installing Node.js, then try again.
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo Node.js could not be started correctly.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 18 (
  echo Gem Coder requires Node.js 18 or newer. This computer has Node.js %NODE_MAJOR%.
  echo Ask your instructor for help updating Node.js, then try again.
  pause
  exit /b 1
)

echo Starting Gem Coder. Keep this window open while you use it.
node "%~dp0companion.mjs" --serve-app --open
echo.
echo Gem Coder stopped.
pause
