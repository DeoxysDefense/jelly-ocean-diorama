@echo off
rem Double-click once: puts a "Jelly Ocean" shortcut on your desktop and in the Start menu.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"
echo.
pause
