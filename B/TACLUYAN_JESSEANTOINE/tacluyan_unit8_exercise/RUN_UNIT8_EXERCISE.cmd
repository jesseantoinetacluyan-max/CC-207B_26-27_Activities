@echo off
setlocal
cd /d "%~dp0"
echo Starting Unit 8 Profile Exercise in Chrome...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\unit8_flutter.ps1" -Action run
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo.
if not "%RESULT%"=="0" echo ERROR: Flutter did not start successfully. Keep the error output above.
pause
exit /b %RESULT%
