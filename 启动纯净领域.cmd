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

powershell.exe -NoProfile -Command "$root=[IO.Path]::GetFullPath('%~dp0'); $running=Get-CimInstance Win32_Process -Filter 'Name = ''electron.exe''' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like ('*' + $root + '*') -and $_.CommandLine -notmatch '--type=' }; if ($running) { exit 2 }"
if "%errorlevel%"=="2" (
  echo [ERROR] Digital Sanctuary is already running.
  echo Close the existing window before launching an updated build.
  echo.
  pause
  exit /b 2
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found. Install Node.js or add it to PATH.
  echo.
  pause
  exit /b 1
)

echo Building the latest source...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. The previous build was not started.
  pause
  exit /b 1
)

if not exist "%SANCTUARY_MAIN%" (
  echo [ERROR] The built application was not found after building.
  echo.
  pause
  exit /b 1
)

if not exist "%SANCTUARY_RENDERER%" (
  echo [ERROR] The built interface was not found after building.
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
