@echo off
chcp 65001 >nul
rem Install "start Chinese UI automatically at logon":
rem create a shortcut to start-cn.bat in the Startup folder (minimized window).
setlocal
set "HERE=%~dp0"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Antigravity-CN.lnk"

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%HERE%start-cn.bat'; $s.WorkingDirectory='%HERE%'; $s.WindowStyle=7; $s.Description='Antigravity Chinese UI injector'; $s.Save()"

if exist "%LNK%" (
  echo [ok] Autostart installed:
  echo      %LNK%
  echo      A minimized window will keep the translator alive after logon.
) else (
  echo [x] Failed to create the shortcut. Run this file as your own user, not as administrator.
)
echo.
pause
