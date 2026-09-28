@echo off
chcp 65001 >nul
rem Remove the logon autostart shortcut created by install-autostart.bat
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Antigravity-CN.lnk"

if exist "%LNK%" (
  del "%LNK%"
  echo [ok] Autostart removed.
) else (
  echo [i] Nothing to remove - autostart was not installed.
)
echo.
pause
