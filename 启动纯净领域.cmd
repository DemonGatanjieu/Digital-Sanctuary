@echo off
setlocal
title Digital Sanctuary Launcher

cd /d "%~dp0"

set "SANCTUARY_ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
set "SANCTUARY_MAIN=%~dp0apps\desktop\out\main\index.js"
set "SANCTUARY_RENDERER=%~dp0apps\desktop\out\renderer\index.html"

if not exist "%SANCTUARY_ELECTRON%" (
  echo [ERROR] Electron runtime was not found.
  echo.
  pause
  exit /b 1
)

if not exist "%SANCTUARY_MAIN%" (
  echo [ERROR] The built application was not found.
  echo.
  pause
  exit /b 1
)

if not exist "%SANCTUARY_RENDERER%" (
  echo [ERROR] The built interface was not found.
  echo.
  pause
  exit /b 1
)

echo Starting Digital Sanctuary. Please wait...
echo Keep this window open while the app is running.
echo.

start "" /wait "%SANCTUARY_ELECTRON%" .
set "SANCTUARY_EXIT_CODE=%errorlevel%"

if not "%SANCTUARY_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Launcher exited with code %SANCTUARY_EXIT_CODE%.
  echo Keep this window open and report the error shown above.
  pause
)

exit /b %SANCTUARY_EXIT_CODE%
