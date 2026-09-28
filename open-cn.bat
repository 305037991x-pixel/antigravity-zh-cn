@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "HERE=%~dp0"
set "NODE="

for %%N in (node.exe) do if not defined NODE set "NODE=%%~$PATH:N"
if not defined NODE if exist "C:\node.exe" set "NODE=C:\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE for /f "delims=" %%D in ('dir /b /o-d "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do (
  if not defined NODE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe" set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe"
)

if not defined NODE (
  echo [x] node.exe not found. Please install Node.js 18+ and retry.
  pause
  exit /b 1
)

echo [i] node: %NODE%
echo [i] Launching / attaching Antigravity with Chinese UI ...
echo.
rem --launch: 应用没开就先开，然后注入；不加 --once 所以会一直守护
"%NODE%" "%HERE%inject.js" --launch %*
echo.
pause
