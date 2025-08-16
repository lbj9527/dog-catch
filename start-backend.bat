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

REM ================================
REM SMTP settings for real email sending (edit accordingly)
REM Example for common SMTP providers. Keep quotes to avoid special char issues.
set "SMTP_HOST=smtp.gmail.com"
set "SMTP_PORT=465"
set "SMTP_SECURE=true"
set "SMTP_USER=wangcong95278@gmail.com"
set "SMTP_PASS="
set "SMTP_FROM=Subtitle Dog <wangcong95278@gmail.com>"
echo SMTP configured for %SMTP_HOST%:%SMTP_PORT%

REM Change directory to backend
cd /d "%~dp0backend"

REM Start dev server (nodemon)
npm run dev

endlocal

