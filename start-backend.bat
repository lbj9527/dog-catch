@echo off
setlocal
chcp 65001 >nul
echo Starting backend...
echo ================================

REM Set SOCKS5 proxy for this process (change port if needed)
set "SOCKS_PROXY=socks5://127.0.0.1:7890"
set "ALL_PROXY=%SOCKS_PROXY%"
set "NO_PROXY=localhost,127.0.0.1,::1"
echo SOCKS_PROXY=%SOCKS_PROXY%

REM Change directory to backend
cd /d "%~dp0backend"

REM Start dev server (nodemon)
npm run dev

endlocal

