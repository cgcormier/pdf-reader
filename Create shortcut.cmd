@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Create-Shortcut.ps1"
if errorlevel 1 pause
endlocal
