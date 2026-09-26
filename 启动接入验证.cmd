@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto path_error
node "%~dp0scripts\start-structured-preview.js" %*
set "preview_exit=%errorlevel%"
if not "%preview_exit%"=="0" pause
exit /b %preview_exit%

:path_error
echo Could not open the preview project folder. Run this file from its original location.
pause
exit /b 1
