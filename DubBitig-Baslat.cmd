@echo off
cd /d "%~dp0"
if exist "%ProgramFiles%\DubBitig\DubBitig.exe" (
  start "" "%ProgramFiles%\DubBitig\DubBitig.exe"
) else if exist "%LOCALAPPDATA%\Programs\DubBitig\DubBitig.exe" (
  start "" "%LOCALAPPDATA%\Programs\DubBitig\DubBitig.exe"
) else if exist "release-dubbitig\DubBitig-1.6.0-Setup.exe" (
  start "" "release-dubbitig\DubBitig-1.6.0-Setup.exe"
) else (
  call npm.cmd start
)
