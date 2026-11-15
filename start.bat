@echo off
setlocal EnableExtensions

rem ======================================================================
rem  deepseek-harness Desktop launcher
rem
rem  Starts the unpackaged Desktop shell from this checkout, pointed at the
rem  review-orb DSH_HOME. That home's desktop profile declares the
rem  experimental orb form and the better bundle, so this launches the orb
rem  build known here as better-dsh.
rem
rem  Usage: double-click, or run start.bat from any directory.
rem  Unattended launches: set DSH_START_NO_PAUSE=1 so a failure does not
rem  wait for a key press.
rem
rem  Text is ASCII on purpose: cmd parses .bat files in the OEM code page,
rem  so non-ASCII text here breaks on non-matching locales.
rem ======================================================================

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"
if errorlevel 1 (
  echo [ERROR] cannot enter "%REPO%"
  goto :fail
)

if not exist "%REPO%\pnpm-workspace.yaml" (
  echo [ERROR] not a deepseek-harness checkout: "%REPO%"
  goto :fail
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm is not on PATH
  echo         install it with: npm install -g pnpm
  goto :fail
)

if not exist "%REPO%\apps\desktop\node_modules\electron" (
  echo [ERROR] dependencies are not installed in "%REPO%"
  echo         run pnpm install, or fix-build.bat when the install fails
  goto :fail
)

rem The orb form is declared by the profile manifest, not by the bundles, so
rem the launch needs a home whose desktop profile carries that declaration.
set "DSH_HOME=%REPO%\apps\desktop\.desktop-build\review-orb\home"
if not exist "%DSH_HOME%\profiles\desktop\package.json" (
  echo [ERROR] no desktop profile in "%DSH_HOME%"
  echo         prepare one as described under Local form review in
  echo         apps\desktop\README.md, then run this script again
  goto :fail
)

rem An inherited Electron Node mode makes the launcher start without a window.
set "ELECTRON_RUN_AS_NODE="
rem Keep the detached Renderer DevTools closed.
set "DSH_DESKTOP_OPEN_DEVTOOLS=0"

rem The orb form keeps its window out of the taskbar, so its last position is
rem the only way to say where a launch will show up.
set "LAYOUT=%REPO%\apps\desktop\.desktop-build\development\electron-user-data\form-layout.json"
set "ORBINFO="
if exist "%LAYOUT%" for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "try { $raw = Get-Content -LiteralPath $env:LAYOUT -Raw; $o = ConvertFrom-Json -InputObject $raw; '{0},{1}' -f $o.orb.x, $o.orb.y } catch { }"`) do set "ORBINFO=%%p"

rem One running instance owns the inspector ports, so a second launch cannot
rem bind them and exits instead of opening a window.
set "RUNNING="
for /f "delims=" %%p in ('netstat -ano ^| findstr /c:"127.0.0.1:9229"') do set "RUNNING=1"
if defined RUNNING (
  echo [ERROR] a Desktop instance already owns the main inspector port 9229
  if defined ORBINFO echo         look for the orb at %ORBINFO%; drag it, or close that instance first
  goto :fail
)

rem start:desktop reuses the current build and fails without artifacts, so
rem fall back to dev:desktop, which builds before launching.
set "TARGET=start:desktop"
if not exist "%REPO%\apps\desktop\lib\main.js" set "TARGET=dev:desktop"
if not exist "%REPO%\apps\desktop-host\lib\index.js" set "TARGET=dev:desktop"

echo ==================================================
echo  deepseek-harness Desktop
echo  repo : %REPO%
echo  home : %DSH_HOME%
echo  form : orb (112 px, always on top, no taskbar entry)
if defined ORBINFO echo  orb  : last position %ORBINFO% (drag it to move)
echo  task : pnpm run %TARGET%
echo ==================================================
echo.
echo Click the orb for the chat dialog. Preparing the runtime and starting
echo Electron prints little and can take a minute, so leave this window open;
echo closing it ends the app as well.
echo.

call pnpm run %TARGET%
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo [ERROR] the launcher exited with code %CODE%
  goto :fail
)
echo.
echo Desktop closed.
exit /b 0

:fail
if defined DSH_START_NO_PAUSE exit /b 1
echo.
echo Press any key to close this window.
pause >nul
exit /b 1
