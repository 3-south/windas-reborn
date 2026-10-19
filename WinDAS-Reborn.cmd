@echo off
rem Starts the local server (Node) and opens the app in its own Edge/Chrome window.
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js is required: https://nodejs.org & pause & exit /b 1)
start "WinDAS server" /min node serve.js
timeout /t 2 /nobreak >nul
start "" msedge --app=http://127.0.0.1:8080/ 2>nul || start "" chrome --app=http://127.0.0.1:8080/
